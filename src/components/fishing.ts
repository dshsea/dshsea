// Fishing: pick a bait for what you need, cast, and reel in one plugin.
// The bait decides who bites (src/lib/bait.ts), claimed creatures bite more readily, and every landed
// catch is counted on the server (worker/index.js, POST /api/catch) so authors can see theirs being found.
import { creatureSrc, tintDeg, traits, depthOf, fmtDepth, type SpeciesId } from '../lib/species';

type Row = [string, number, string, (string | 0)?, (string | 0)?, (SpeciesId | 0)?, (string | 0)?, (0 | 1)?];
export type Catch = [name: string, stars: number, species: SpeciesId, hue: number, path: string];
/** Kept in the visitor's logbook: today's casts, and the last few things they landed. */
export type FishLog = { day: string; used: number; total: number; mine: Catch[]; recent: number[]; best?: [name: string, stars: number] };
export type Landed = { key: string; name: string; stars: number; species: SpeciesId; hue: number; rarity: string; path: string };
type Target = Landed & { index: number; desc: string; depth: number; url: string; repo: string | null; slug: string | null; missed: boolean; inst: boolean };
type Deps = {
  /** The page's translations; `t.fish` holds the fishing strings. */
  t: Record<string, any>;
  base: string; count: number; chunk: number;
  /** Indices of claimed creatures, and of the biggest ones. */
  claimed: number[]; giants: number[];
  log: FishLog;
  save: () => void;
  /** Extra casts earned today. */
  bonus: () => number;
  toast: (text: string) => void;
  blip: () => void;
  openSheet: (id: string) => void;
  jump: (index: number) => void;
  names: () => Promise<string[]>;
  /** Records a catch in the field guide. */
  landed: (c: Landed) => void;
  post: (path: string, data: unknown) => Promise<Response>;
  /** Opens the wish bottle form with this text in it. */
  wish: (text: string) => void;
};

const CASTS = 5;
const RANK: Record<string, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pickOne = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

export function initFishing(d: Deps) {
  const f = d.t.fish;
  const fl = d.log;
  const sheet = $('fish-sheet');
  const act = $<HTMLButtonElement>('fish-act');
  const custom = $<HTMLInputElement>('fish-custom');
  const shadow = $<HTMLImageElement>('fish-shadow');
  const pond = $('fish-pond');
  const today = new Date().toISOString().slice(0, 10);
  if (fl.day !== today) {
    fl.day = today;
    fl.used = 0;
  }
  const left = () => Math.max(0, CASTS + d.bonus() - fl.used);
  const claimed = new Set(d.claimed), giants = new Set(d.giants);

  let state = 'idle', bait = 'any', water = 'any', run = 0;
  let cur: Target | null = null;
  const set = (s: string) => (sheet.dataset.state = state = s);
  const status = (text: string) => ($('fish-status').textContent = text);

  // ----- setup: bait, water, what you have landed, what everyone lands -----
  function chips(id: string, attr: string, onPick: (v: string) => void) {
    const box = $(id);
    box.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>(`[data-${attr}]`);
      if (!b) return;
      for (const x of box.children) x.setAttribute('aria-pressed', String(x === b));
      onPick(b.dataset[attr]!);
    });
  }
  chips('fish-baits', 'bait', (v) => {
    bait = v;
    custom.value = '';
  });
  chips('fish-waters', 'water', (v) => (water = v));
  custom.addEventListener('input', () => {
    if (custom.value.trim()) for (const x of $('fish-baits').children) x.setAttribute('aria-pressed', 'false');
    else $('fish-baits').querySelector(`[data-bait="${bait}"]`)?.setAttribute('aria-pressed', 'true');
  });

  function row(c: Catch) {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = creatureSrc(c[2]);
    img.alt = '';
    img.style.filter = `hue-rotate(${tintDeg(c[3])}deg)`;
    const a = document.createElement('a');
    a.href = c[4];
    a.textContent = c[0];
    const st = document.createElement('span');
    st.textContent = `★ ${fmt(c[1])}`;
    li.append(img, a, st);
    return li;
  }
  let topLoaded = 0;
  function renderSetup() {
    const n = left();
    $('fish-left').textContent = n ? f.left.replace('{n}', String(n)) : f.none;
    $<HTMLButtonElement>('fish-cast').disabled = !n;
    for (const el of sheet.querySelectorAll<HTMLButtonElement>('[data-again]')) el.hidden = !n;
    const mine = $('fish-mine');
    mine.replaceChildren(...fl.mine.map(row));
    if (!fl.mine.length) mine.textContent = f.mineEmpty;
    if (Date.now() - topLoaded < 60000) return;
    topLoaded = Date.now();
    fetch('/api/catch/top')
      .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : []))
      .then((rows: { repo: string; n: number }[]) => {
        $('fish-top-wrap').hidden = !rows.length;
        $('fish-top').replaceChildren(...rows.map((r) => {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = `/r/${r.repo}`;
          a.textContent = r.repo;
          const s = document.createElement('span');
          s.textContent = f.times.replace('{n}', fmt(r.n));
          li.append(a, s);
          return li;
        }));
      })
      .catch(() => {});
  }
  function open() {
    if (state === 'result' || state === 'lost' || state === 'none') set('idle');
    renderSetup();
    d.openSheet('fish-sheet');
  }
  $('fish').addEventListener('click', open);

  // ----- who bites -----
  // Only installable plugins bite, when there are any to choose from: a catch should be something you can use.
  let instBits: Promise<Uint8Array | null> | null = null;
  const loadInst = () =>
    (instBits ??= fetch('/data/inst.json').then((r) => r.json()).then((j: { bits: string }) => Uint8Array.from(atob(j.bits), (ch) => ch.charCodeAt(0))).catch(() => null));
  let baitIndex: Promise<Record<string, number[]>> | null = null;
  const loadBait = () => (baitIndex ??= fetch('/data/bait.json').then((r) => r.json()));
  async function choose(): Promise<Target | null> {
    const third = Math.ceil(d.count / 3);
    const [lo, hi] = water === 'top' ? [0, third] : water === 'mid' ? [third, third * 2] : water === 'deep' ? [third * 2, d.count] : [0, d.count];
    const inWater = (i: number) => i >= lo && i < hi;
    const fresh = (i: number) => !fl.recent.includes(i);
    const bits = await loadInst();
    const usable = (i: number) => !bits || !!(bits[i >> 3] & (1 << (i & 7)));
    let pool: number[] | null = null;
    const missed = false;
    const text = custom.value.trim().toLowerCase();
    if (text) {
      const names = await d.names();
      pool = [];
      for (let i = 0; i < names.length; i++) if (names[i].includes(text)) pool.push(i);
      const good = pool.filter(usable);
      if (good.length) pool = good;
      if (!pool.length) return { missed: true } as Target; // nothing to catch: see cast()
    } else if (bait !== 'any') {
      pool = (await loadBait())[bait] ?? null;
      const good = pool?.filter(usable);
      if (good?.length) pool = good;
    }

    let index: number;
    if (pool?.length) {
      let c = pool.filter((i) => inWater(i) && fresh(i));
      if (!c.length) c = pool.filter(fresh);
      if (!c.length) c = pool;
      // Claimed creatures bite five times as readily, the giants twice.
      const weight = (i: number) => (claimed.has(i) ? 5 : giants.has(i) ? 2 : 1);
      let roll = Math.random() * c.reduce((n, i) => n + weight(i), 0);
      index = c[c.length - 1];
      for (const i of c) {
        roll -= weight(i);
        if (roll <= 0) {
          index = i;
          break;
        }
      }
    } else {
      // No bait: mostly anything at all, with a fair chance of a claimed creature or a giant.
      const roll = Math.random();
      const near = (set: Set<number>) => [...set].filter((i) => inWater(i) && fresh(i) && usable(i));
      const special = roll < 0.25 ? near(claimed) : roll < 0.35 ? near(giants) : [];
      index = special.length ? pickOne(special) : lo + Math.floor(Math.random() * (hi - lo));
      // A few tries to land on an installable one.
      for (let tries = 0; !special.length && !usable(index) && tries < 12; tries++) index = lo + Math.floor(Math.random() * (hi - lo));
    }
    const rows: Row[] = await fetch(`/data/c/${Math.floor(index / d.chunk)}.json`).then((r) => r.json());
    const r = rows[index % d.chunk];
    if (!r) return null;
    const isUrl = r[0].startsWith('http');
    const key = r[0].toLowerCase().replace(/\/$/, '');
    const tr = traits(key, r[1], r[5] || null);
    const slug = r[3] || null, repo = isUrl ? null : r[0];
    return {
      index, key, missed, slug, repo, stars: r[1], species: tr.species, hue: tr.hue, rarity: tr.rarity, depth: depthOf(index),
      inst: !!r[7], name: r[4] || r[0].split('/').pop()!, desc: (d.base === '/zh' && r[6]) || r[2] || '',
      url: isUrl ? r[0] : `https://github.com/${r[0]}`,
      path: slug ? `${d.base}/p/${slug}` : repo ? `/r/${key}` : d.base || '/',
    };
  }

  // ----- cast, wait, strike -----
  let biteTimer = 0;
  async function cast() {
    if (left() <= 0 || (state !== 'idle' && state !== 'result' && state !== 'lost')) return;
    fl.used++;
    d.save();
    const me = ++run;
    cur = null;
    set('wait');
    status(f.waiting);
    act.disabled = true;
    act.textContent = f.waitBtn;
    shadow.hidden = true;
    pond.style.setProperty('--pull', '0');
    const picking = choose().catch(() => null);
    void picking.then((tgt) => {
      if (me !== run || !tgt || tgt.missed) return;
      shadow.src = creatureSrc(tgt.species);
      shadow.hidden = false;
    });
    const [tgt] = await Promise.all([picking, sleep(1700 + Math.random() * 2600)]);
    if (me !== run || state !== 'wait') return;
    if (tgt?.missed) {
      // Nothing in the sea matches that bait: the cast comes back, and it is a wish worth making.
      fl.used--;
      d.save();
      set('none');
      $('fish-none-text').textContent = f.noFish.replace('{q}', custom.value.trim());
      renderSetup();
      return;
    }
    if (!tgt) {
      // Nothing was at stake: the cast comes back.
      fl.used--;
      d.save();
      set('idle');
      renderSetup();
      d.toast(f.fail);
      return;
    }
    cur = tgt;
    set('bite');
    status(f.bite);
    act.disabled = false;
    act.textContent = f.strike;
    act.focus();
    d.blip();
    biteTimer = window.setTimeout(() => {
      if (me === run && state === 'bite') lose('slow');
    }, 1700 - RANK[tgt.rarity] * 150);
  }

  // ----- the fight: hold to reel, ease off before the line snaps -----
  let hold = false, tension = 0, progress = 0, elapsed = 0, slack = 0, surgeEnd = 0, nextSurge = 0, last = 0;
  function strike() {
    clearTimeout(biteTimer);
    set('reel');
    status(f.reelHint);
    act.textContent = f.reel;
    hold = false;
    tension = 0.3;
    progress = 0.12;
    elapsed = slack = surgeEnd = 0;
    nextSurge = 1.4;
    last = performance.now();
    requestAnimationFrame(tick);
  }
  function tick(now: number) {
    if (state !== 'reel' || !cur) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    elapsed += dt;
    const r = RANK[cur.rarity];
    if (elapsed > nextSurge) {
      surgeEnd = elapsed + 0.5 + Math.random() * 0.5;
      nextSurge = surgeEnd + 1.1 + Math.random() * 1.6 - r * 0.15;
    }
    const surging = elapsed < surgeEnd;
    if (hold) {
      tension += (0.5 + 0.1 * r + (surging ? 1.2 + 0.25 * r : 0)) * dt;
      progress += (dt / (3.2 + 1.6 * r)) * (surging ? 0.3 : 1);
    } else {
      tension -= 0.85 * dt;
      progress -= (0.05 + 0.03 * r + (surging ? 0.08 : 0)) * dt;
    }
    tension = Math.max(0, tension);
    progress = Math.max(0, progress);
    slack = tension <= 0 ? slack + dt : 0;
    $('fish-tension').style.width = `${Math.min(1, tension) * 100}%`;
    $('fish-tension').dataset.level = tension > 0.82 ? 'high' : tension > 0.58 ? 'mid' : 'ok';
    $('fish-progress').style.width = `${Math.min(1, progress) * 100}%`;
    pond.style.setProperty('--pull', String(Math.min(1, progress)));
    pond.classList.toggle('surge', surging);
    if (tension >= 1) return lose('snap');
    if (slack > 2.6 || elapsed > 40) return lose('away');
    if (progress >= 1) return win();
    requestAnimationFrame(tick);
  }
  const press = (down: boolean) => {
    if (state === 'reel') hold = down;
    act.classList.toggle('held', state === 'reel' && down);
  };
  act.addEventListener('pointerdown', (e) => {
    if (state !== 'reel') return;
    act.setPointerCapture(e.pointerId);
    press(true);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) act.addEventListener(ev, () => press(false));
  act.addEventListener('click', () => {
    if (state === 'bite') strike();
  });
  act.addEventListener('contextmenu', (e) => e.preventDefault());
  // Space works too. Capture phase, so the ocean's own Space (dive) never sees it.
  const spaceIsOurs = (e: KeyboardEvent) => e.key === ' ' && !sheet.hidden && (state === 'bite' || state === 'reel' || state === 'wait');
  window.addEventListener('keydown', (e) => {
    if (!spaceIsOurs(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return;
    if (state === 'bite') strike();
    else press(true);
  }, true);
  window.addEventListener('keyup', (e) => {
    if (e.key !== ' ' || state !== 'reel') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    press(false);
  }, true);

  function lose(why: string) {
    const c = cur!;
    press(false);
    set('lost');
    pond.classList.remove('surge');
    $('fish-lost-text').textContent = f.lost[why];
    $('fish-lost-teaser').textContent = f.teaser.replace('{rarity}', d.t.rarityNames[c.rarity].toLowerCase()).replace('{species}', d.t.speciesNames[c.species].toLowerCase());
    renderSetup();
  }

  // ----- landed -----
  function win() {
    const c = cur!;
    press(false);
    set('result');
    pond.classList.remove('surge');
    d.blip();
    fl.total++;
    fl.mine = [[c.name, c.stars, c.species, c.hue, c.path] as Catch, ...fl.mine.filter((m) => m[4] !== c.path)].slice(0, 12);
    fl.recent = [...fl.recent, c.index].slice(-40);
    if (!fl.best || c.stars >= fl.best[1]) fl.best = [c.name, c.stars];
    d.landed(c);
    d.save();

    const species = d.t.speciesNames[c.species], rarity = d.t.rarityNames[c.rarity];
    const img = $<HTMLImageElement>('fish-img');
    img.src = creatureSrc(c.species);
    img.style.setProperty('--tint', `${tintDeg(c.hue)}deg`);
    const kind = $('fish-kind');
    kind.textContent = `${species} · ${rarity}`;
    kind.dataset.rarity = c.rarity;
    $('fish-name').textContent = c.name;
    $('fish-desc').textContent = c.desc || d.t.noDesc;
    $('fish-meta').textContent = `★ ${fmt(c.stars)} · ${fmtDepth(c.depth)}`;
    const count = $('fish-count');
    count.textContent = '';
    ($('fish-visit') as HTMLAnchorElement).href = c.url;
    ($('fish-details') as HTMLAnchorElement).href = c.path;
    const inst = $('fish-install');
    inst.hidden = !c.inst || !c.repo;
    inst.querySelector('code')!.textContent = `dsh plugin --profile tui add github:${c.repo}`;
    const claim = $('fish-claim') as HTMLAnchorElement;
    claim.hidden = !!c.slug || !c.repo;
    claim.href = `${d.base}/submit?repo=${encodeURIComponent(c.repo ?? '')}`;
    const text = f.tweet.replace('{name}', c.name).replace('{rarity}', rarity.toLowerCase()).replace('{species}', species.toLowerCase()).replace('{depth}', fmtDepth(c.depth));
    ($('fish-share') as HTMLAnchorElement).href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(location.origin + c.path)}`;
    const save = $('fish-save') as HTMLAnchorElement;
    save.removeAttribute('href');
    void card(c, species, rarity).then((url) => {
      if (cur !== c || !url) return;
      save.href = url;
      save.download = `dshsea-catch-${c.name.replace(/[^\w.-]+/g, '-')}.jpg`;
    });
    if (c.repo) {
      d.post('/api/catch', { repo: c.key })
        .then((r) => (r.ok ? r.json() : null))
        .then((res: { n: number } | null) => {
          if (cur !== c || !res?.n) return;
          count.textContent = res.n > 1 ? f.hooked.replace('{n}', fmt(res.n)) : f.hookedFirst;
          topLoaded = 0;
        })
        .catch(() => {});
    }
    renderSetup();
  }
  $('fish-dive').addEventListener('click', () => {
    if (!cur) return;
    sheet.hidden = true;
    d.jump(cur.index);
  });
  $('fish-cast').addEventListener('click', () => void cast());
  $('fish-rebait').addEventListener('click', () => {
    set('idle');
    custom.focus();
  });
  $('fish-wish').addEventListener('click', () => {
    const q = custom.value.trim();
    set('idle');
    d.wish(`${d.t.bottlePlaceholder.replace(/[….]+$/, '')} ${q}`);
  });
  for (const el of sheet.querySelectorAll('[data-again]')) el.addEventListener('click', () => void cast());
  // Closing the panel mid-cast abandons that cast.
  sheet.querySelector('[data-close]')!.addEventListener('click', () => {
    clearTimeout(biteTimer);
    run++;
    press(false);
    set('idle');
  });

  /** The catch as a picture to post. */
  async function card(c: Target, species: string, rarity: string): Promise<string | null> {
    const W = 1200, H = 630;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d')!;
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0d3f7c');
    bg.addColorStop(0.55, '#06183c');
    bg.addColorStop(1, '#02040c');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(880, 300, 20, 880, 300, 380);
    glow.addColorStop(0, `hsla(${c.hue}, 85%, 62%, 0.42)`);
    glow.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
    // The line it came up on.
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(880, 0);
    g.lineTo(880, 150);
    g.stroke();
    try {
      const img = new Image();
      img.src = creatureSrc(c.species);
      await img.decode();
      const s = Math.min(520 / img.width, 360 / img.height);
      g.filter = `hue-rotate(${tintDeg(c.hue)}deg)`;
      g.drawImage(img, 880 - (img.width * s) / 2, 320 - (img.height * s) / 2, img.width * s, img.height * s);
      g.filter = 'none';
    } catch {
      /* the card still reads without the picture */
    }
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#6ef3d6';
    g.font = '600 24px Inter, system-ui, sans-serif';
    g.fillText(f.cardTop.replace('{depth}', fmtDepth(c.depth)), 64, 120);
    g.fillStyle = '#ffffff';
    let size = 96;
    do g.font = `400 ${size}px "Instrument Serif", Georgia, serif`;
    while (g.measureText(c.name).width > 560 && (size -= 6) > 40);
    g.fillText(c.name, 64, 250, 560);
    g.fillStyle = '#c9d9f0';
    g.font = '500 30px Inter, system-ui, sans-serif';
    g.fillText(`${species} · ${rarity} · ★ ${fmt(c.stars)}`, 64, 310, 560);
    if (c.repo) {
      g.fillStyle = 'rgba(201,217,240,0.7)';
      g.font = '400 24px Inter, system-ui, sans-serif';
      g.fillText(`github.com/${c.repo}`, 64, 356, 560);
    }
    g.fillStyle = '#ffffff';
    g.font = 'italic 400 48px "Instrument Serif", Georgia, serif';
    g.fillText('dshsea.com', 64, H - 60);
    try {
      return cv.toDataURL('image/jpeg', 0.9);
    } catch {
      return null;
    }
  }

  return { open };
}
