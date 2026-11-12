// Fallback for browsers without WebGL2 (or with ?2d): no 3D and no streaming, just the claimed
// creatures as images down a tall gradient page. The full ocean needs the 3D version.
import { creatureSrc, tintDeg, zoneFor, fmtDepth, type SpeciesId } from '../lib/species';

type CreatureData = { slug: string; name: string; desc: string; stars: number; depth: number; species: SpeciesId; hue: number; rarity: string; url: string };
type Creature = CreatureData & { el: HTMLElement; hay: string };

const GAP = 380; // pixels between neighbours; real depths are far too large to scroll
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtStars = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

export function initOcean() {
  const payload = JSON.parse($('ocean-data').textContent!) as { creatures: CreatureData[]; t: Record<string, any>; base: string };
  const t = payload.t;
  const spacer = $('ocean-spacer');
  document.body.classList.add('ocean-2d');
  spacer.style.position = 'relative';
  for (const id of ['dive', 'rise', 'random']) $(id).hidden = true;

  let surface = 0;
  const topOf = (i: number) => surface + (i + 1) * GAP;

  function tile(tag: 'button' | 'a', species: SpeciesId, hue: number, width: number, title: string, sub?: string) {
    const el = document.createElement(tag);
    el.className = 'fb';
    el.style.setProperty('--w', `${width}px`);
    const img = document.createElement('img');
    img.className = 'creature';
    img.src = creatureSrc(species);
    img.alt = '';
    img.loading = 'lazy';
    img.style.setProperty('--tint', `${tintDeg(hue)}deg`);
    const name = document.createElement('span');
    name.textContent = title;
    el.append(img, name);
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      el.append(s);
    }
    spacer.append(el);
    return el;
  }

  const creatures: Creature[] = payload.creatures.map((c, i) => {
    const el = tile('button', c.species, c.hue, 90 + Math.log10(c.stars + 10) * 26, c.name, `★ ${fmtStars(c.stars)} · ${fmtDepth(c.depth)}`);
    el.style.animationDelay = `${-(i * 1.37) % 6}s`;
    el.style.left = `${(0.16 + ((i * 0.61803398875) % 1) * 0.68) * 100}%`;
    const creature = { ...c, el, hay: `${c.name} ${c.desc} ${c.species} ${t.speciesNames[c.species]}`.toLowerCase() };
    el.addEventListener('click', () => openCard(creature));
    return creature;
  });
  const ghost = tile('a', 'fish', 170, 120, t.ghostLabel) as HTMLAnchorElement;
  ghost.href = `${payload.base}/submit`;
  ghost.style.opacity = '0.55';
  ghost.style.left = '76%';

  function layout() {
    surface = Math.round(window.innerHeight * 0.64);
    spacer.style.height = `${topOf(creatures.length) + Math.round(window.innerHeight * 0.4)}px`;
    creatures.forEach((c, i) => (c.el.style.top = `${topOf(i)}px`));
    ghost.style.top = `${surface + 120}px`;
  }

  function onScroll() {
    // The gauge reads the depth of whichever creature is nearest the middle of the screen.
    const i = Math.round((window.scrollY + window.innerHeight / 2 - surface) / GAP) - 1;
    const c = creatures[Math.max(0, Math.min(creatures.length - 1, i))];
    const d = i < 0 || !c ? 0 : c.depth;
    $('gauge-depth').textContent = fmtDepth(d);
    $('gauge-zone').textContent = t.zones[zoneFor(d)];
    $('gauge-marker').style.top = `${Math.min(1, window.scrollY / Math.max(1, document.body.scrollHeight - window.innerHeight)) * 100}%`;
    document.body.classList.toggle('dived', window.scrollY > window.innerHeight * 0.25);
  }

  const card = $('card');
  function openCard(c: Creature) {
    const page = `${payload.base}/p/${c.slug}`;
    const img = $<HTMLImageElement>('card-img');
    img.src = creatureSrc(c.species);
    img.style.setProperty('--tint', `${tintDeg(c.hue)}deg`);
    $('card-name').textContent = c.name;
    $('card-kind').textContent = `${t.speciesNames[c.species]} · ${t.rarityNames[c.rarity]}`;
    card.dataset.rarity = c.rarity;
    $('card-desc').textContent = c.desc;
    $('card-depth').textContent = fmtDepth(c.depth);
    $('card-stars').textContent = `★ ${fmt(c.stars)}`;
    $('card-status').textContent = t.claimed;
    ($('card-visit') as HTMLAnchorElement).href = c.url;
    const details = $('card-details') as HTMLAnchorElement;
    details.textContent = t.details;
    details.href = page;
    const text = t.shareTweet.replace('{name}', c.name).replace('{species}', t.speciesNames[c.species].toLowerCase()).replace('{depth}', fmtDepth(c.depth));
    ($('card-share') as HTMLAnchorElement).href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(location.origin + page)}`;
    card.hidden = false;
  }
  $('card-close').addEventListener('click', () => (card.hidden = true));
  $('egg-close').addEventListener('click', () => ($('egg').hidden = true));

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function diveTo(c: Creature, smooth = true) {
    window.scrollTo({ top: Math.max(0, topOf(creatures.indexOf(c)) - window.innerHeight / 2), behavior: smooth && !reduced ? 'smooth' : 'auto' });
    openCard(c);
  }

  const sonar = $<HTMLInputElement>('sonar');
  let matches: Creature[] = [];
  sonar.addEventListener('input', () => {
    const q = sonar.value.trim().toLowerCase();
    matches = q ? creatures.filter((c) => c.hay.includes(q)) : [];
    for (const c of creatures) {
      c.el.classList.toggle('dim', !!q && !matches.includes(c));
      c.el.classList.toggle('hit', !!q && matches.includes(c));
    }
  });
  sonar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && matches.length) diveTo(matches[0]);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      card.hidden = true;
      $('egg').hidden = true;
    }
  });

  window.addEventListener('resize', layout);
  window.addEventListener('scroll', onScroll, { passive: true });
  layout();
  const target = creatures.find((c) => c.slug === new URLSearchParams(location.search).get('seek'));
  if (target) diveTo(target, false);
  onScroll();
}
