// The ocean in 3D (three.js). Depth is virtual and unbounded: the wheel, touch, keys and the dive
// button move the diver, and creatures are loaded chunk by chunk around the current depth.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SPECIES_IDS, SPECIES_RARITY, creatureSrc, tintDeg, zoneFor, traits, depthOf, fmtDepth, evolution, hashKey, DEPTH_START, DEPTH_STEP, type SpeciesId } from '../lib/species';
import { initFishing, type FishLog } from './fishing';
import { SPECIES, creatureMaterial, speciesGeometry, schoolFishGeometry } from './creatures3d';
import {
  TRAIL, clamp, smooth, rand, BASIC_VERT, WATER_FRAG, SKY_FRAG, RAY_FRAG, PLANKTON_VERT, PLANKTON_FRAG,
  haloTexture, lampTexture, pingTexture, labelTexture, labelMaterial, createSound,
} from './ocean-env';

type Row = [string, number, string, string?, string?, (SpeciesId | 0)?, (string | 0)?];
type Screen = { x: number; y: number; r: number; d: number } | null;
type Creature = {
  index: number; key: string; name: string; desc: string; stars: number; depth: number; url: string; repo: string | null;
  slug: string | null; species: SpeciesId; rarity: string; hue: number;
  group: THREE.Group; mesh: THREE.Mesh; mat: THREE.ShaderMaterial; halo: THREE.Sprite; label: THREE.Sprite;
  base: THREE.Vector3; az: number; frac: number; size: number; shape: THREE.Vector3; phase: number; speed: number; swims: boolean;
  hay: string; near: number; revealAt: number; spinAt: number; known: boolean; screen: Screen;
  /** Welcome reef: the depth this copy is pinned at, instead of where the creature really lives. */
  pin: number | null;
};
type Payload = {
  base: string;
  fresh: Row[];
  meta: { count: number; chunk: number; landmarks: [number, string, number][] };
  claimed: Record<string, number>;
  t: Record<string, any>;
};

const K = 0.053; // world units per metre
const START_DEPTH = -34; // the diver starts above the water
const GHOST_DEPTH = 244; // just below the welcome reef
const WINDOW = 820; // metres of ocean kept alive above and below the diver
const LOG_KEY = 'dshsea-log-v1';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtStars = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
const frac = (v: number) => v - Math.floor(v);

const STOPS: [number, number][] = [[0, 0x1f9fc4], [200, 0x126fa6], [1000, 0x0b3a74], [4000, 0x071a40], [6000, 0x040c22], [10400, 0x02040c]];
const stopColors = STOPS.map(([, hex]) => new THREE.Color(hex));
const farColor = new THREE.Color();
/** Water colour. Below the charts the dark slowly drifts between blue, violet and green, so no two regions feel alike. */
function colorAt(depth: number, out: THREE.Color) {
  for (let i = 1; i < STOPS.length; i++) {
    if (depth <= STOPS[i][0]) return out.lerpColors(stopColors[i - 1], stopColors[i], (depth - STOPS[i - 1][0]) / (STOPS[i][0] - STOPS[i - 1][0]));
  }
  farColor.setHSL(frac(0.64 + 0.2 * Math.sin(depth / 21000) + 0.1 * Math.sin(depth / 5300)), 0.75, 0.035 + 0.012 * Math.sin(depth / 9000));
  return out.lerpColors(stopColors[stopColors.length - 1], farColor, smooth(10400, 16000, depth));
}

export async function initOcean3D() {
  const canvas = $<HTMLCanvasElement>('ocean');
  const payload = JSON.parse($('ocean-data').textContent!) as Payload;
  const t = payload.t;
  const { count, chunk: CHUNK } = payload.meta;
  const SEABED = depthOf(Math.max(count - 1, 0)) + 420;
  const MAX_DEPTH = SEABED - 30;
  const SEABED_Y = -SEABED * K;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const params = new URLSearchParams(location.search);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  try {
    await Promise.all([document.fonts.load('600 32px Inter'), document.fonts.load('500 25px Inter')]);
  } catch {
    /* labels fall back to a system font */
  }

  const scene = new THREE.Scene();
  const fog = new THREE.FogExp2(0x0b3a74, 0.026);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 900);
  camera.rotation.order = 'YXZ';

  // Uniforms shared by every material, updated once per frame.
  const G = {
    uTime: { value: 0 },
    uFogColor: { value: new THREE.Color(0x0b3a74) },
    uFogDensity: { value: 0.026 },
    uSun: { value: 1 },
    uAmbient: { value: 0.5 },
    uCaustic: { value: 1 },
    uLightDir: { value: new THREE.Vector3(0.35, 1, 0.45).normalize() },
    uLampPos: { value: new THREE.Vector3(0, -5, -8) },
    uLampOn: { value: 0 },
    uPing: { value: new THREE.Vector4(0, 0, 0, 0) },
    uPingA: { value: 0 },
  };
  const sunDir = new THREE.Vector3(0, 0.055, -1).normalize();
  let vw = window.innerWidth, vh = window.innerHeight, mobile = vw < 640, portrait = vw / vh < 0.8, baseFov = 55;

  // ----- sky, sun and water surface -----
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(700, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uSunDir: { value: sunDir }, uTime: G.uTime,
        uC0: { value: new THREE.Color(0xffc37a) }, uC1: { value: new THREE.Color(0xf0707a) },
        uC2: { value: new THREE.Color(0x6b2d73) }, uC3: { value: new THREE.Color(0x1a1446) },
      },
      vertexShader: BASIC_VERT, fragmentShader: SKY_FRAG,
    }),
  );
  sky.renderOrder = -10;
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: {
        uTime: G.uTime, uFogColor: G.uFogColor, uFogDensity: G.uFogDensity, uSunDir: { value: sunDir },
        uHorizon: { value: new THREE.Color(0xffa26b) }, uZenith: { value: new THREE.Color(0x3a1c5c) },
      },
      vertexShader: BASIC_VERT, fragmentShader: WATER_FRAG,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  scene.add(sky, water);

  const rayMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uOpacity: { value: 0.2 } }, vertexShader: BASIC_VERT, fragmentShader: RAY_FRAG,
  });
  const rays = new THREE.Group();
  const rr = rand(7);
  for (let i = 0; i < 16; i++) {
    const len = 26 + rr() * 22;
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(1.6 + rr() * 3.2, len), rayMat);
    const a = rr() * Math.PI * 2, rad = 5 + rr() * 26;
    beam.position.set(Math.sin(a) * rad, -len / 2 + 0.2, -Math.cos(a) * rad - 4);
    beam.rotation.set(0, rr() * Math.PI, 0.22 + rr() * 0.12);
    beam.userData.phase = rr() * 6;
    rays.add(beam);
  }
  scene.add(rays);

  // ----- plankton, marine snow, bubbles -----
  const trail = Array.from({ length: TRAIL }, () => new THREE.Vector4(0, 9999, 0, -99));
  let trailHead = 0;
  function makePoints(n: number, o: { color: number; hot?: number; size: number; rise: number; ring?: boolean; react?: boolean; additive?: boolean; seed: number }) {
    const r = rand(o.seed);
    const pos = new Float32Array(n * 3), seeds = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (r() - 0.5) * 70;
      pos[i * 3 + 1] = r() * 60;
      pos[i * 3 + 2] = -r() * 48 + 4;
      seeds[i] = r();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false, blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: {
        uTime: G.uTime, uLampPos: G.uLampPos, uLampOn: G.uLampOn, uPing: G.uPing, uPingA: G.uPingA,
        uCamY: { value: 0 }, uRise: { value: o.rise }, uSize: { value: o.size }, uScale: { value: 1 }, uBox: { value: 60 },
        uColor: { value: new THREE.Color(o.color) }, uHot: { value: new THREE.Color(o.hot ?? o.color) },
        uRing: { value: o.ring ? 1 : 0 }, uReact: { value: o.react ? 1 : 0 }, uTrail: { value: trail },
      },
      vertexShader: PLANKTON_VERT, fragmentShader: PLANKTON_FRAG,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
    return mat;
  }
  const pointMats = [
    makePoints(mobile ? 2000 : 4200, { color: 0x4f86a8, hot: 0x66ffe0, size: 0.1, rise: -0.2, react: true, additive: true, seed: 11 }),
    makePoints(700, { color: 0xcfe9ff, size: 0.06, rise: -0.3, seed: 17 }),
    makePoints(140, { color: 0xd8f6ff, size: 0.34, rise: 2.6, ring: true, seed: 23 }),
  ];

  const haloTex = haloTexture();
  const tmpColor = new THREE.Color();
  const dummy = new THREE.Object3D();

  // ----- the logbook: what this visitor has discovered, kept in localStorage -----
  type Find = [name: string, stars: number, species: SpeciesId, hue: number, path: string];
  type Log = {
    seen: Record<string, 1>; species: Record<string, number>; rarity: Record<string, 1>; best: Find[]; ach: Record<string, 1>; deepest: number;
    /** Daily bounty: the day it belongs to, when the hunt began, how long it took (0 = not caught), and the streak. */
    bounty: { day: string; start: number; ms: number; streak: number; last: string };
    /** Leaderboard identity: a random id kept in this browser, and the chosen name. */
    board: { id: string; name: string };
    fish: FishLog;
  };
  let log: Log = { seen: {}, species: {}, rarity: {}, best: [], ach: {}, deepest: 0, bounty: { day: '', start: 0, ms: 0, streak: 0, last: '' }, board: { id: '', name: '' }, fish: { day: '', used: 0, total: 0, mine: [], recent: [] } };
  try {
    log = { ...log, ...JSON.parse(localStorage.getItem(LOG_KEY) ?? '{}') };
  } catch {
    /* private mode: the log just lasts for this visit */
  }
  let logDirty = false, toastBusy = false;
  const toasts: string[] = [];
  function toast(text: string) {
    toasts.push(text);
    if (toastBusy) return;
    toastBusy = true;
    const el = $('toast');
    const next = () => {
      const msg = toasts.shift();
      if (!msg) {
        toastBusy = false;
        return;
      }
      el.textContent = msg;
      el.classList.add('show');
      setTimeout(() => {
        el.classList.remove('show');
        setTimeout(next, 350);
      }, 2600);
    };
    next();
  }

  // Achievements: [id, earned?]. Titles and descriptions come from the translations.
  const seenCount = () => Object.keys(log.seen).length;
  const speciesCount = () => Object.keys(log.species).length;
  const ACH: [string, () => boolean][] = [
    ['first', () => seenCount() >= 1], ['d25', () => seenCount() >= 25], ['d100', () => seenCount() >= 100], ['d500', () => seenCount() >= 500],
    ['sp8', () => speciesCount() >= 8], ['sp16', () => speciesCount() >= 16], ['spAll', () => speciesCount() >= SPECIES_IDS.length],
    ['rare', () => !!log.rarity.rare], ['epic', () => !!log.rarity.epic], ['whale', () => !!log.species.whale],
    ['dive1', () => log.deepest >= 1000], ['dive11', () => log.deepest >= 11000], ['dive100', () => log.deepest >= 100000],
    ['bottom', () => log.deepest >= SEABED - 80], ['photo', () => !!log.ach.photo], ['fish', () => log.fish.total >= 1],
  ];
  function checkAchievements() {
    for (const [id, earned] of ACH) {
      if (log.ach[id] || !earned()) continue;
      log.ach[id] = 1;
      toast(t.achToast.replace('{name}', t.ach[id][0]));
      sound.blip();
    }
  }
  function renderLog() {
    $('log-seen').textContent = fmt(seenCount());
    $('log-species').textContent = `${speciesCount()}/${SPECIES_IDS.length}`;
    $('log-deepest').textContent = fmtDepth(log.deepest);
  }
  function renderDex() {
    const img = (species: SpeciesId, hue: number | null) => {
      const el = document.createElement('img');
      el.src = creatureSrc(species);
      el.alt = '';
      if (hue !== null) el.style.filter = `hue-rotate(${tintDeg(hue)}deg)`;
      return el;
    };
    $('dex-grid').replaceChildren(...SPECIES_IDS.map((id) => {
      const n = log.species[id] ?? 0;
      const li = document.createElement('li');
      li.dataset.rarity = SPECIES_RARITY[id];
      li.classList.toggle('locked', !n);
      const name = document.createElement('b');
      name.textContent = n ? t.speciesNames[id] : '???';
      const sub = document.createElement('small');
      sub.textContent = n ? `× ${fmt(n)}` : t.rarityNames[SPECIES_RARITY[id]];
      li.append(img(id, null), name, sub);
      return li;
    }));
    const best = $('dex-best');
    best.replaceChildren(...log.best.map(([name, stars, species, hue, path]) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = path;
      a.textContent = name;
      const st = document.createElement('span');
      st.textContent = `★ ${fmt(stars)}`;
      li.append(img(species, hue), a, st);
      return li;
    }));
    if (!log.best.length) best.textContent = t.bestEmpty;
    $('dex-ach').replaceChildren(...ACH.map(([id]) => {
      const li = document.createElement('li');
      li.classList.toggle('done', !!log.ach[id]);
      const b = document.createElement('b');
      b.textContent = t.ach[id][0];
      li.append(b, t.ach[id][1]);
      return li;
    }));
    $('dex-ach-count').textContent = `${Object.keys(log.ach).length}/${ACH.length}`;
  }
  const pageOf = (c: { slug: string | null; repo: string | null }) =>
    c.slug ? `${payload.base}/p/${c.slug}` : c.repo ? `/r/${c.repo.toLowerCase()}` : payload.base || '/';
  function discover(c: Creature) {
    if (c.known) return;
    c.known = true;
    log.seen[c.key] = 1;
    log.rarity[c.rarity] = 1;
    const firstOfKind = !log.species[c.species];
    log.species[c.species] = (log.species[c.species] ?? 0) + 1;
    if (firstOfKind) {
      toast(t.newSpecies.replace('{species}', t.speciesNames[c.species]).replace('{rarity}', t.rarityNames[c.rarity]));
      sound.blip();
    }
    if (c.index === bountyIndex && !log.bounty.ms) bountyCaught(c);
    // Keep the six biggest finds for the field guide.
    if (c.stars > 0 && (log.best.length < 6 || c.stars > log.best[log.best.length - 1][1])) {
      log.best = [...log.best, [c.name, c.stars, c.species, c.hue, pageOf(c)] as Find].sort((x, y) => y[1] - x[1]).slice(0, 6);
    }
    logDirty = true;
  }
  setInterval(() => {
    if (!logDirty) return;
    logDirty = false;
    checkAchievements();
    renderLog();
    if (!$('dex').hidden) renderDex();
    submitScore();
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(log));
    } catch {
      /* ignore */
    }
  }, 1000);
  $('logbook').addEventListener('click', () => {
    renderDex();
    openSheet('dex');
  });
  /** Only one sheet at a time. */
  function openSheet(id: string) {
    for (const el of document.querySelectorAll<HTMLElement>('.sheet')) el.hidden = el.id !== id;
  }
  for (const x of document.querySelectorAll<HTMLElement>('[data-close]')) x.addEventListener('click', () => (x.closest<HTMLElement>('.sheet')!.hidden = true));

  // ----- creatures: streamed in around the diver, disposed when left behind -----
  const chunks = new Map<number, Row[] | null>();
  function wantChunk(n: number) {
    if (chunks.has(n)) return;
    chunks.set(n, null);
    fetch(`/data/c/${n}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((rows) => chunks.set(n, rows))
      .catch(() => setTimeout(() => chunks.delete(n), 4000));
  }
  const live = new Map<number, Creature>();
  let spread = 1, pendingOpen = -1;

  function place(c: Creature) {
    const u = frac(c.index * 0.61803398875 + 0.13);
    // Wider than the view: there is always more off to the side if you look around.
    c.az = (u * 2 - 1) * spread;
    const r = (portrait ? 15 : 9.5) + c.frac * (portrait ? 17 : 10) + c.size * 1.2;
    c.base.set(Math.sin(c.az) * r, -(c.pin ?? c.depth) * K + (frac(c.index * 0.377) - 0.5) * 1.2, -Math.cos(c.az) * r);
  }
  /** `pin` puts a copy of a claimed creature on the welcome reef (index < 0) at that depth. */
  function spawn(index: number, row: Row, pin: number | null = null) {
    const repoOrUrl = row[0];
    const isUrl = repoOrUrl.startsWith('http');
    const key = repoOrUrl.toLowerCase().replace(/\/$/, '');
    const stars = row[1];
    const tr = traits(key, stars, row[5] || null);
    const spec = SPECIES[tr.species];
    const name = row[4] ?? repoOrUrl.split('/').pop()!;
    const desc = (payload.base === '/zh' && row[6]) || row[2] || '';
    const phase = (tr.hue / 360) * Math.PI * 2;
    const mat = creatureMaterial(G, tr.species, tr.hue, phase, reduced, tr.seed);
    const mesh = new THREE.Mesh(speciesGeometry(tr.species), mat);
    const size = (0.75 + Math.log10(stars + 10) * 0.33) * (tr.rarity === 'legendary' ? 1.45 : tr.rarity === 'epic' ? 1.15 : 1);
    // No two alike: each individual is a little longer, taller or stockier than the species average.
    const shape = new THREE.Vector3(0.88 + frac(tr.seed * 7.31) * 0.3, 0.86 + frac(tr.seed * 3.17) * 0.3, 0.86 + frac(tr.seed * 5.71) * 0.3);
    if (spec.translucent) mesh.renderOrder = 2;
    const group = new THREE.Group();
    group.add(mesh);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTex, color: tmpColor.setHSL(((tr.hue + 30) % 360) / 360, 0.9, 0.6).clone(), blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, fog: false, opacity: 0,
    }));
    halo.scale.setScalar(Math.min(size * 5, 9));
    halo.renderOrder = -1;
    const { tex, aspect } = labelTexture(name, pin === null ? `★ ${fmtStars(stars)}` : `✦ ${t.reefTag} · ★ ${fmtStars(stars)}`);
    if (pin !== null) (halo.material as THREE.SpriteMaterial).color.set(0xffd27a);
    const label = new THREE.Sprite(labelMaterial(tex));
    label.scale.set(aspect, 1, 1);
    label.position.y = -size * spec.drop - 0.75;
    label.renderOrder = 5;
    (label.material as THREE.SpriteMaterial).opacity = 0;
    group.add(halo, label);
    scene.add(group);
    const c: Creature = {
      index, key, name, desc, stars, pin, depth: depthOf(pin === null ? index : payload.claimed[row[3]!] ?? 0), url: isUrl ? repoOrUrl : `https://github.com/${repoOrUrl}`, repo: isUrl ? null : repoOrUrl,
      slug: row[3] ?? null, species: tr.species, rarity: tr.rarity, hue: tr.hue,
      group, mesh, mat, halo, label, base: new THREE.Vector3(), az: 0, frac: frac(index * 0.7548776662), size, shape, phase,
      speed: 0.2 + ((tr.hue * 7) % 100) / 520, swims: spec.swims, near: 0, revealAt: -99, spinAt: -99, known: !!log.seen[key], screen: null,
      hay: `${repoOrUrl} ${name} ${desc} ${tr.species} ${t.speciesNames[tr.species]}`.toLowerCase(),
    };
    place(c);
    group.position.copy(c.base);
    live.set(index, c);
    if (pendingOpen >= 0 && pendingOpen === index) {
      pendingOpen = -1;
      openCard(c);
    }
  }
  function despawn(c: Creature) {
    scene.remove(c.group);
    c.mat.dispose();
    (c.label.material as THREE.SpriteMaterial).map!.dispose();
    c.label.material.dispose();
    c.halo.material.dispose();
    live.delete(c.index);
    if (selected === c) closeCard();
    if (hovered === c) hovered = null;
  }

  // ----- "your project here": a hologram waiting for a body -----
  const ghostMat = creatureMaterial(G, 'fish', 170, 1, reduced);
  ghostMat.transparent = true;
  ghostMat.depthWrite = false;
  ghostMat.uniforms.uHolo.value = 1;
  ghostMat.uniforms.uGlowColor.value.set(0x9af5ff);
  const ghost = new THREE.Group();
  const ghostMesh = new THREE.Mesh(speciesGeometry('fish'), ghostMat);
  ghostMesh.scale.setScalar(1.3);
  ghost.add(ghostMesh);
  {
    const { tex, aspect } = labelTexture(t.ghostLabel, null);
    const s = new THREE.Sprite(labelMaterial(tex));
    s.scale.set(0.75 * aspect, 0.75, 1);
    s.position.y = -1.5;
    ghost.add(s);
  }
  scene.add(ghost);
  let ghostScreen: Screen = null;

  // ----- ambient life that repeats forever: schools every few kilometres, a leviathan now and then -----
  type Fish = { r: number; a: number; y: number; s: number; w: number; off: THREE.Vector3 };
  type School = { mesh: THREE.InstancedMesh; mat: THREE.ShaderMaterial; offset: number; band: number; depth: number; fish: Fish[] };
  const schoolGeo = schoolFishGeometry();
  const SCHOOL_EVERY = 2600;
  function makeSchool(offset: number, n: number, seed: number): School {
    const r = rand(seed);
    const mat = creatureMaterial(G, 'fish', 200, 0, reduced);
    mat.uniforms.uGlow.value = 0.12;
    const mesh = new THREE.InstancedMesh(schoolGeo, mat, n);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const fish = Array.from({ length: n }, () => ({
      r: 6 + r() * 12, a: r() * Math.PI * 2, y: (r() - 0.5) * 9, s: 0.2 + r() * 0.2, w: 0.16 + r() * 0.16, off: new THREE.Vector3(),
    }));
    return { mesh, mat, offset, band: -1, depth: offset, fish };
  }
  const schools = [makeSchool(330, mobile ? 90 : 160, 31), makeSchool(1250, 110, 37), makeSchool(2050, 80, 41)];

  const levMat = creatureMaterial(G, 'whale', 215, 2, reduced);
  levMat.uniforms.uFogScale.value = 0.3;
  levMat.uniforms.uGlow.value = 0.35;
  levMat.uniforms.uBase.value.setRGB(0.05, 0.12, 0.3);
  levMat.uniforms.uSpeed.value = 0.25;
  const leviathan = new THREE.Mesh(speciesGeometry('whale'), levMat);
  leviathan.scale.setScalar(27);
  scene.add(leviathan);
  const LEV_EVERY = 9000, LEV_OFFSET = 5300;

  // ----- seabed, coral, chest: the floor under the oldest project -----
  const bedGeo = new THREE.PlaneGeometry(360, 360, 110, 110);
  bedGeo.rotateX(-Math.PI / 2);
  {
    const p = bedGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const flat = smooth(3, 16, Math.hypot(x, z + 9));
      p.setY(i, (Math.sin(x * 0.11) * Math.cos(z * 0.13) * 2.2 + Math.sin(x * 0.37 + z * 0.29) * 0.7 + Math.max(0, Math.sin(x * 0.045 + 1.3) * Math.sin(z * 0.05)) * 9) * flat);
    }
    bedGeo.computeVertexNormals();
  }
  const bed = new THREE.Mesh(bedGeo, new THREE.MeshStandardMaterial({ color: 0x2c3672, roughness: 0.95, metalness: 0 }));
  bed.position.y = SEABED_Y;
  scene.add(bed, new THREE.AmbientLight(0x6f86ff, 0.4));
  const chestLight = new THREE.PointLight(0xffc860, 70, 40, 1.8);
  chestLight.position.set(0, SEABED_Y + 2.4, -8);
  scene.add(chestLight);

  const coralGeo = new THREE.CylinderGeometry(0.25, 1, 1, 7, 1);
  coralGeo.translate(0, 0.5, 0);
  const coral = new THREE.InstancedMesh(coralGeo, new THREE.MeshBasicMaterial(), 320);
  {
    const r = rand(99);
    for (let i = 0; i < 320; i++) {
      let x = 0, z = 0;
      do {
        const a = r() * Math.PI * 2, rad = 6 + r() * r() * 80;
        x = Math.sin(a) * rad;
        z = -Math.cos(a) * rad - 9;
      } while (Math.hypot(x, z) < 7 || (Math.abs(x) < 4.5 && z < 0 && z > -14));
      dummy.position.set(x, SEABED_Y - 0.25, z);
      dummy.rotation.set((r() - 0.5) * 0.5, r() * 3, (r() - 0.5) * 0.5);
      dummy.scale.set(0.07 + r() * 0.13, 0.4 + r() * r() * 2.6, 0.07 + r() * 0.13);
      dummy.updateMatrix();
      coral.setMatrixAt(i, dummy.matrix);
      coral.setColorAt(i, tmpColor.setHSL(r() < 0.5 ? 0.45 + r() * 0.12 : 0.78 + r() * 0.17, 1, 0.5).multiplyScalar(1.25));
    }
  }
  scene.add(coral);

  const chest = new THREE.Group();
  {
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b3d1e, roughness: 0.8 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc94d, roughness: 0.3, metalness: 0.9, emissive: 0x8a5a00, emissiveIntensity: 0.6 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 1.4), wood);
    box.position.y = 0.55;
    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, 1.1, -0.7);
    lidPivot.rotation.x = -0.55;
    const halfCyl = (radius: number, length: number, mat: THREE.Material, x: number) => {
      const g = new THREE.CylinderGeometry(radius, radius, length, 24, 1, false, -Math.PI / 2, Math.PI);
      g.rotateZ(Math.PI / 2);
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, 0, 0.7);
      return m;
    };
    lidPivot.add(halfCyl(0.7, 2.2, wood, 0));
    for (const x of [-0.8, 0, 0.8]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.14, 1.46), gold);
      band.position.set(x, 0.55, 0);
      chest.add(band);
      lidPivot.add(halfCyl(0.73, 0.16, gold, x));
    }
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.12), gold);
    lock.position.set(0, 0.95, 0.74);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.3, 0.8) }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 1.05;
    chest.add(box, lidPivot, lock, glow);
  }
  const chestHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: 0xffc860, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.4 }));
  chestHalo.scale.setScalar(8);
  chestHalo.position.y = 1.2;
  chest.add(chestHalo);
  {
    const { tex, aspect } = labelTexture(fmtDepth(SEABED), null);
    const s = new THREE.Sprite(labelMaterial(tex));
    s.scale.set(0.9 * aspect, 0.9, 1);
    s.position.y = 3.5;
    chest.add(s);
  }
  chest.position.set(0, SEABED_Y, -8);
  chest.rotation.y = -0.4;
  scene.add(chest);
  const chestCentre = new THREE.Vector3(0, SEABED_Y + 0.9, -8);
  let chestScreen: Screen = null;

  // ----- the diver's lamp and the sonar ring -----
  const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: lampTexture(), color: new THREE.Color(2.6, 2.2, 1.5), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, fog: false, opacity: 0 }));
  lampGlow.scale.setScalar(1.25);
  const shell = new THREE.Sprite(new THREE.SpriteMaterial({ map: pingTexture(), color: new THREE.Color(0.5, 1.6, 1.3), transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false, blending: THREE.AdditiveBlending }));
  shell.visible = false;
  scene.add(lampGlow, shell);

  // ----- post-processing -----
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.7, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const splash = document.createElement('div');
  splash.id = 'splash';
  document.body.appendChild(splash);
  const flash = (dark: boolean) => {
    splash.classList.toggle('dark', dark);
    splash.classList.remove('go');
    void splash.offsetWidth;
    splash.classList.add('go');
  };

  const sound = createSound();
  const soundBtn = $('sound');
  soundBtn.hidden = false;
  soundBtn.addEventListener('click', () => soundBtn.setAttribute('aria-pressed', String(sound.toggle())));

  function resize() {
    vw = window.innerWidth;
    vh = window.innerHeight;
    mobile = vw < 640;
    portrait = vw / vh < 0.8;
    const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(vw, vh, false);
    composer.setPixelRatio(dpr);
    composer.setSize(vw, vh);
    camera.aspect = vw / vh;
    baseFov = portrait ? 62 : 55;
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
    const scale = (vh * dpr) / (2 * Math.tan(THREE.MathUtils.degToRad(baseFov / 2)));
    for (const m of pointMats) m.uniforms.uScale.value = scale;
    const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(baseFov / 2)) * camera.aspect);
    spread = portrait ? hHalf * 1.15 : Math.min(hHalf * 1.5, 1.3);
    for (const c of live.values()) place(c);
    ghost.position.set(portrait ? 2.6 : 6.5, -GHOST_DEPTH * K, portrait ? -15 : -11);
  }

  // ----- state -----
  let depthTarget = START_DEPTH, camDepth = START_DEPTH, lastDepth = START_DEPTH, fling = 0, pitchVel = 0, fovKick = 0;
  let turbo = 0, turboHeld = 0; // direction (+1 down, -1 up) and seconds held
  let yaw = 0, mouseX = 0, mouseY = 0, pointerX = -1, pointerY = -1, lastPointerAt = -99, pointerIsMouse = false;
  let lookYaw = 0, lookPitch = 0, dragging = false, dragMoved = 0, dragX = 0, dragY = 0, lastDragAt = -99;
  let hovered: Creature | 'ghost' | 'chest' | null = null;
  let selected: Creature | null = null;
  let query = '';
  let wasAbove = true, pingStart = -99, hintShown = false, time = 0, lastGauge = -1;
  let wantPhoto = false, trackAt = 0, trackTarget = -1;

  const proj = new THREE.Vector3(), ray = new THREE.Vector3(), tmp = new THREE.Vector3(), pingPos = new THREE.Vector3();
  const lampTarget = new THREE.Vector3(0, -5, -8), lastTrail = new THREE.Vector3(0, 9999, 0);
  function toScreen(p: THREE.Vector3, radius: number): Screen {
    proj.copy(p).project(camera);
    if (proj.z > 1 || proj.z < -1) return null;
    const d = camera.position.distanceTo(p);
    const focal = vh / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    return { x: (proj.x * 0.5 + 0.5) * vw, y: (-proj.y * 0.5 + 0.5) * vh, r: Math.max(24, (radius / d) * focal * 1.05), d };
  }
  function pick(x: number, y: number): typeof hovered {
    let best: Creature | null = null, bestD = Infinity;
    for (const c of live.values()) {
      const s = c.screen;
      if (!s || s.d > 60) continue;
      if (Math.hypot(x - s.x, y - s.y) < s.r && s.d < bestD) {
        best = c;
        bestD = s.d;
      }
    }
    if (best) return best;
    if (ghostScreen && Math.hypot(x - ghostScreen.x, y - ghostScreen.y) < ghostScreen.r) return 'ghost';
    if (chestScreen && Math.hypot(x - chestScreen.x, y - chestScreen.y) < chestScreen.r) return 'chest';
    return null;
  }
  function pointerRay(x: number, y: number, dist: number, out: THREE.Vector3) {
    ray.set((x / vw) * 2 - 1, -(y / vh) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
    return out.copy(camera.position).addScaledVector(ray, dist);
  }
  function ping(at: THREE.Vector3) {
    pingPos.copy(at);
    G.uPing.value.set(at.x, at.y, at.z, 0);
    pingStart = time;
    sound.ping();
  }
  /** Jump straight to a depth. Used by search, the gauge, "surprise me" and deep links. */
  function teleport(depth: number) {
    depthTarget = camDepth = lastDepth = clamp(depth, START_DEPTH, MAX_DEPTH);
    fling = 0;
    for (const c of [...live.values()]) despawn(c);
    for (const id of [...liveBottles.keys()]) dropBottle(id);
    flash(depth > 0);
  }

  // ----- frame -----
  let lastNow = performance.now();
  const fogColor = new THREE.Color(), hotColor = new THREE.Color();
  const HORIZON = new THREE.Color(0xffa26b);
  const hero = document.querySelector<HTMLElement>('.hero')!;

  function frame() {
    const now = performance.now();
    const dt = Math.min((now - lastNow) / 1000, 0.05);
    lastNow = now;
    time += dt * (reduced ? 0.15 : 1);
    G.uTime.value = time;
    const ease = (rate: number) => 1 - Math.exp(-dt * rate);

    // Diving: input moves the target depth, the camera eases after it.
    if (turbo) {
      turboHeld += dt;
      depthTarget += turbo * Math.min(150 * Math.exp(Math.min(turboHeld, 7) * 0.75), 25000) * dt;
    }
    if (Math.abs(fling) > 1) {
      depthTarget += fling * dt;
      fling *= Math.exp(-dt * 2.2);
    }
    depthTarget = clamp(depthTarget, START_DEPTH, MAX_DEPTH);
    camDepth += (depthTarget - camDepth) * ease(turbo ? 14 : 7);
    const vel = (camDepth - lastDepth) / Math.max(dt, 0.001);
    lastDepth = camDepth;
    const speed = Math.abs(vel);
    pitchVel += (clamp(vel * 0.0003, -0.34, 0.34) - pitchVel) * ease(4);
    fovKick += (clamp(speed * 0.004, 0, 22) - fovKick) * ease(3);
    const camY = -camDepth * K;
    const above = camY > 0;
    const depth = Math.max(camDepth, 0);
    if (depth > log.deepest + 25) {
      log.deepest = depth;
      logDirty = true;
    }

    if (!dragging && time - lastDragAt > 2.5) {
      lookYaw += (0 - lookYaw) * ease(1.2);
      lookPitch += (0 - lookPitch) * ease(1.2);
    }
    const basePitch = THREE.MathUtils.lerp(0.14, -0.05, smooth(START_DEPTH, 20, camDepth)) - 0.3 * Math.exp(-(((camDepth - 3) / 22) ** 2));
    const selYaw = selected ? -selected.az * 0.75 : 0;
    yaw += (selYaw - mouseX * 0.16 + lookYaw - yaw) * ease(3);
    camera.position.set(Math.sin(time * 0.23) * 0.25, camY + Math.sin(time * 0.5) * (above ? 0.05 : 0.12), 0);
    camera.rotation.set(basePitch - pitchVel - mouseY * 0.07 + lookPitch - (selected && mobile ? 0.2 : 0), yaw, Math.sin(time * 0.31) * 0.012);
    camera.fov = baseFov + fovKick;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    // The title sinks out of the way as the dive begins.
    const out = smooth(START_DEPTH, 14, camDepth);
    hero.style.opacity = String(1 - out);
    hero.style.transform = `translateY(${-out * 90}px)`;
    hero.style.visibility = out >= 1 ? 'hidden' : 'visible';

    if (above !== wasAbove) {
      wasAbove = above;
      flash(false);
      sound.splash();
      if (!above && !hintShown) {
        hintShown = true;
        const hint = $('hint');
        hint.textContent = matchMedia('(hover: hover)').matches ? t.hintMouse : t.hintTouch;
        hint.classList.add('show');
        setTimeout(() => hint.classList.remove('show'), 9000);
      }
    }

    // Environment by depth.
    if (above) {
      fogColor.copy(HORIZON);
      fog.density = 0.0012;
    } else {
      colorAt(depth, fogColor);
      fog.density = 0.024 + 0.006 * smooth(200, 3000, depth);
    }
    fog.color.copy(fogColor);
    G.uFogColor.value.copy(fogColor);
    G.uFogDensity.value = above ? 0.0 : fog.density;
    G.uSun.value = 0.06 + 0.95 * Math.exp(-depth / 450);
    G.uAmbient.value = 0.4 + 0.16 * Math.exp(-depth / 900);
    G.uCaustic.value = Math.exp(-depth / 280);
    scene.background = fogColor;
    sky.visible = above;
    sky.position.copy(camera.position);
    water.visible = depth < 3000;
    water.position.set(camera.position.x, 0, camera.position.z);
    rays.visible = !above && depth < 900;
    rayMat.uniforms.uOpacity.value = 0.2 * Math.exp(-depth / 320);
    for (const r of rays.children) r.rotation.z = 0.25 + Math.sin(time * 0.25 + r.userData.phase) * 0.06;
    for (const m of pointMats) m.uniforms.uCamY.value = camY;
    (pointMats[0].uniforms.uHot.value as THREE.Color).copy(hotColor.setHSL(frac(0.46 + 0.22 * Math.sin(depth / 13000)), 1, 0.62));
    bloom.strength = above ? 0.32 : 0.45 + 0.45 * smooth(300, 3500, depth);
    sound.setDepth(depth, above);

    // The lamp follows the pointer, a few metres in front of the diver.
    const pointerLive = pointerX >= 0 && (pointerIsMouse || now / 1000 - lastPointerAt < 3);
    G.uLampOn.value += ((pointerLive && !above ? 1 : 0) - G.uLampOn.value) * ease(4);
    if (pointerLive) pointerRay(pointerX, pointerY, portrait ? 12 : 8.5, lampTarget);
    const lamp = G.uLampPos.value;
    lamp.lerp(lampTarget, ease(9));
    lampGlow.position.copy(lamp);
    lampGlow.material.opacity = 0.7 * G.uLampOn.value;
    if (G.uLampOn.value > 0.3 && lastTrail.distanceTo(lamp) > 0.5) {
      lastTrail.copy(lamp);
      trail[trailHead].set(lamp.x, lamp.y, lamp.z, time);
      trailHead = (trailHead + 1) % TRAIL;
    }

    const pingAge = time - pingStart;
    const pingR = pingAge * 13;
    G.uPing.value.w = pingR;
    G.uPingA.value = pingAge >= 0 && pingAge < 3.2 ? 1 - pingAge / 3.2 : 0;
    shell.visible = G.uPingA.value > 0;
    if (shell.visible) {
      shell.position.copy(pingPos);
      shell.scale.setScalar(Math.max(pingR * 2, 0.01));
      shell.material.opacity = G.uPingA.value * 0.8;
    }

    // Stream creatures in and out. While rocketing down nothing is loaded: the water is a blur anyway.
    const i0 = clamp(Math.floor((camDepth - WINDOW - DEPTH_START) / DEPTH_STEP), 0, count - 1);
    const i1 = clamp(Math.ceil((camDepth + WINDOW - DEPTH_START) / DEPTH_STEP), 0, count - 1);
    if (speed < 900 && !above && count) {
      for (let n = Math.floor(i0 / CHUNK); n <= Math.floor(i1 / CHUNK); n++) wantChunk(n);
      let budget = 3;
      for (let i = i0; i <= i1 && budget > 0; i++) {
        if (live.has(i)) continue;
        const rows = chunks.get(Math.floor(i / CHUNK));
        if (!rows) continue;
        spawn(i, rows[i % CHUNK]);
        budget--;
      }
    }
    // The welcome reef: the newest claims, pinned where every dive begins.
    if (!above && camDepth < 700) {
      let budget = 2;
      for (let k = 0; k < payload.fresh.length && budget > 0; k++) {
        if (live.has(-1 - k)) continue;
        spawn(-1 - k, payload.fresh[k], 44 + k * 26);
        budget--;
      }
    }
    for (const c of live.values()) if (c.pin !== null ? camDepth > 1000 : c.index < i0 - 6 || c.index > i1 + 6) despawn(c);

    for (const c of live.values()) {
      c.group.visible = !above;
      if (above) {
        c.screen = null;
        continue;
      }
      const active = hovered === c || selected === c;
      c.near += ((active ? 1 : 0) - c.near) * ease(2.5);
      const a = time * c.speed + c.phase;
      const ax = 1.2 + c.frac * 1.6, az = 0.7;
      const g = c.group.position;
      g.set(c.base.x + Math.sin(a) * ax, c.base.y + Math.sin(time * 0.7 + c.phase * 2) * 0.3, c.base.z + Math.cos(a) * az);
      // Curious: a hovered or selected creature drifts towards the diver.
      tmp.copy(camera.position).sub(g);
      const dist0 = tmp.length();
      g.addScaledVector(tmp.normalize(), c.near * Math.min(2.6, dist0 * 0.22));
      // A creature you have just met does a little twirl.
      const sp = clamp((time - c.spinAt) / 1.1, 0, 1);
      const twirl = sp < 1 ? (1 - (1 - sp) ** 3) * Math.PI * 2 : 0;
      if (c.swims) c.mesh.rotation.set(0, Math.atan2(Math.sin(a) * az, Math.cos(a) * ax) + twirl, 0);
      else c.mesh.rotation.set(0, Math.sin(time * 0.3 + c.phase) * 0.6 + twirl, Math.sin(time * 0.5 + c.phase) * 0.08);
      const grow = c.size * (1 + c.near * 0.12);
      c.mesh.scale.set(c.shape.x * grow, c.shape.y * grow, c.shape.z * grow);

      const isMatch = !query || c.hay.includes(query);
      const lampNear = G.uLampOn.value * Math.exp(-g.distanceToSquared(lamp) / (c.size * c.size * 9));
      if (G.uPingA.value > 0 && Math.abs(g.distanceTo(pingPos) - pingR) < 1.6) c.revealAt = time;
      const reveal = clamp(1 - (time - c.revealAt) / 6, 0, 1);
      // Identifying a creature takes light: the lamp, a sonar ping, or meeting it up close.
      if (!c.known && (lampNear > 0.55 || reveal > 0.9)) discover(c);
      const deepGlow = 0.1 + 0.75 * smooth(150, 2600, c.pin ?? c.depth);
      c.mat.uniforms.uGlow.value = Math.min(1.1, deepGlow + c.near * 0.18 + lampNear * 0.2 + reveal * 0.25 + (query && isMatch ? 0.3 + Math.sin(time * 5) * 0.15 : 0));
      c.mat.uniforms.uDim.value += ((isMatch ? 0 : 0.88) - c.mat.uniforms.uDim.value) * 0.15;
      const s = (c.screen = toScreen(g, c.size));
      const dist = s ? s.d : 99;
      (c.halo.material as THREE.SpriteMaterial).opacity = isMatch ? (0.04 + (c.pin !== null ? 0.16 : deepGlow * 0.2) + c.near * 0.08 + reveal * 0.1) * (0.35 + 0.65 * smooth(70, 12, dist)) : 0;
      // Names stay hidden until a creature has been discovered.
      // ...except on the welcome reef, where the newcomers are introduced to everyone.
      const nearLabel = c.pin !== null ? smooth(46, 30, dist) : c.known ? (mobile ? smooth(38, 24, dist) : smooth(22, 13, dist)) : 0;
      const lm = c.label.material as THREE.SpriteMaterial;
      lm.opacity += ((isMatch ? Math.max(nearLabel, c.near, reveal, lampNear, query ? 1 : 0) : 0.08) - lm.opacity) * ease(6);
    }

    ghost.visible = !above && camDepth < 700;
    ghost.position.y = -GHOST_DEPTH * K + Math.sin(time) * 0.2;
    ghostMesh.rotation.y = Math.sin(time * 0.6) * 0.7;
    ghostMat.uniforms.uOpacity.value = hovered === 'ghost' ? 1 : 0.7 + Math.sin(time * 2.4) * 0.2;
    ghostScreen = ghost.visible ? toScreen(ghost.position, 1.5) : null;

    for (const sc of schools) {
      const band = Math.max(0, Math.round((depth - sc.offset) / SCHOOL_EVERY));
      if (band !== sc.band) {
        // A different school in every band: new colours each time.
        sc.band = band;
        sc.depth = sc.offset + band * SCHOOL_EVERY;
        const h = frac(0.55 + band * 0.173 + sc.offset * 0.0007);
        (sc.mat.uniforms.uBase.value as THREE.Color).setHSL(h, 0.78, 0.42);
        (sc.mat.uniforms.uAccent.value as THREE.Color).setHSL(frac(h + 0.2), 0.85, 0.6);
        (sc.mat.uniforms.uGlowColor.value as THREE.Color).setHSL(frac(h + 0.1), 1, 0.62);
      }
      const y0 = -sc.depth * K;
      sc.mesh.visible = !above && Math.abs(y0 - camY) < 50 && sc.depth < SEABED - 300;
      if (!sc.mesh.visible) continue;
      sc.fish.forEach((f, i) => {
        const a = f.a + time * f.w;
        tmp.set(Math.sin(a) * f.r, y0 + f.y + Math.sin(time * 0.8 + f.a * 3) * 0.4, -Math.cos(a) * f.r - 3);
        proj.copy(tmp).add(f.off).sub(lamp);
        const push = G.uLampOn.value * Math.max(0, 1 - proj.length() / 4.5);
        f.off.addScaledVector(proj.normalize(), push * dt * 16).multiplyScalar(1 - ease(0.9));
        dummy.position.copy(tmp).add(f.off);
        dummy.rotation.set(0, -a + push * 1.2, 0);
        dummy.scale.setScalar(f.s);
        dummy.updateMatrix();
        sc.mesh.setMatrixAt(i, dummy.matrix);
      });
      sc.mesh.instanceMatrix.needsUpdate = true;
    }

    const levY = -(LEV_OFFSET + Math.max(0, Math.round((depth - LEV_OFFSET) / LEV_EVERY)) * LEV_EVERY) * K;
    leviathan.visible = !above && Math.abs(levY - camY) < 110;
    if (leviathan.visible) leviathan.position.set((((time * 0.011) % 1) * 2 - 1) * 170, levY + Math.sin(time * 0.2) * 3, -78);

    const nearBed = camDepth > SEABED - 2200;
    bed.visible = coral.visible = chest.visible = chestLight.visible = nearBed;
    chestScreen = nearBed ? toScreen(chestCentre, 1.7) : null;
    if (nearBed) chestHalo.material.opacity = 0.34 + Math.sin(time * 2) * 0.08;

    for (const lb of liveBottles.values()) {
      lb.group.visible = !above;
      lb.group.position.y = lb.y + Math.sin(time * 0.8 + lb.phase) * 0.35;
      (lb.sprite.material as THREE.SpriteMaterial).rotation = Math.sin(time * 0.6 + lb.phase) * 0.35 + 0.3;
      lb.screen = above ? null : toScreen(lb.group.position, 0.9);
    }

    if (pointerX >= 0 && pointerIsMouse && !dragging) {
      const h = pick(pointerX, pointerY);
      if (h !== hovered) {
        hovered = h;
        if (h && h !== 'ghost' && h !== 'chest') discover(h);
      }
      canvas.style.cursor = h || pickBottle(pointerX, pointerY) ? 'pointer' : 'grab';
    }

    // The tracker points at the nearest giant this visitor has not identified yet.
    if (time - trackAt > 0.4) {
      trackAt = time;
      let best = -1, bestDist = Infinity;
      for (const [index, key] of payload.meta.landmarks) {
        if (log.seen[key]) continue;
        const dist = Math.abs(depthOf(index) - camDepth);
        if (dist < bestDist) {
          bestDist = dist;
          best = index;
        }
      }
      updateBountyPill();
      syncBottles();
      trackTarget = best;
      const el = $('tracker');
      el.hidden = best < 0 || above;
      if (best >= 0) {
        const delta = depthOf(best) - camDepth;
        const near = Math.abs(delta) < 160;
        el.classList.toggle('near', near);
        el.lastElementChild!.textContent = near ? t.trackNear : (delta > 0 ? t.trackBelow : t.trackAbove).replace('{d}', fmtDepth(Math.abs(delta)));
      }
    }

    const gd = Math.round(depth);
    if (gd !== lastGauge) {
      lastGauge = gd;
      $('gauge-depth').textContent = fmtDepth(gd);
      $('gauge-zone').textContent = speed > 900 ? `${vel > 0 ? '↓' : '↑'} ${fmtDepth(speed)}/s` : t.zones[zoneFor(gd)];
      $('gauge-marker').style.top = `${(gd / SEABED) * 100}%`;
      document.body.classList.toggle('dived', camDepth > 2);
    }

    composer.render(dt);
    if (wantPhoto) {
      wantPhoto = false;
      takePhoto(); // must read the canvas in the same task it was drawn in
    }
    requestAnimationFrame(frame);
  }

  // ----- daily bounty: one creature, the same for everyone, picked by the date -----
  const today = new Date().toISOString().slice(0, 10);
  const bountyIndex = count ? hashKey(`bounty:${today}`) % count : -1;
  const bountyDepth = depthOf(Math.max(bountyIndex, 0));
  // The clue is a 1 km band (about 30 creatures); where the target sits inside it changes daily.
  const bandLo = Math.max(0, bountyDepth - 100 - (hashKey(`band:${today}`) % 800));
  const bandHi = bandLo + 1000;
  if (log.bounty.day !== today) log.bounty = { ...log.bounty, day: today, start: 0, ms: 0 };
  const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  let bountyRow: Row | null = null;
  function renderBounty() {
    if (!bountyRow) return;
    const repo = bountyRow[0];
    const tr = traits(repo.toLowerCase().replace(/\/$/, ''), bountyRow[1], bountyRow[5] || null);
    const name = bountyRow[4] ?? repo.split('/').pop()!;
    const found = log.bounty.ms > 0;
    const img = $<HTMLImageElement>('bounty-img');
    img.src = creatureSrc(tr.species);
    img.style.setProperty('--tint', `${tintDeg(tr.hue)}deg`);
    $('bounty-sheet').classList.toggle('found', found);
    const clues = [
      `${t.speciesNames[tr.species]} · ${t.rarityNames[tr.rarity]} · ★ ${fmt(bountyRow[1])}`,
      t.clueZone.replace('{a}', fmtDepth(bandLo)).replace('{b}', fmtDepth(bandHi)),
      found ? name : t.clueName.replace('{c}', name[0].toUpperCase()).replace('{n}', String(name.length)),
    ];
    $('bounty-clues').replaceChildren(...clues.map((c) => Object.assign(document.createElement('li'), { textContent: c })));
    const result = $('bounty-result');
    result.hidden = !found;
    result.textContent = `${t.bountyFound.replace('{t}', clock(log.bounty.ms))} · ${t.bountyStreak.replace('{n}', String(log.bounty.streak))}`;
    $('bounty-go').hidden = found;
    const share = $('bounty-share') as HTMLAnchorElement;
    share.hidden = !found;
    share.href = `https://x.com/intent/post?text=${encodeURIComponent(t.bountyTweet.replace('{t}', clock(log.bounty.ms)).replace('{n}', String(log.bounty.streak)))}&url=${encodeURIComponent(location.origin + (payload.base || '/'))}`;
  }
  function bountyCaught(c: Creature) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    log.bounty.ms = Math.max(1000, Date.now() - (log.bounty.start || Date.now()));
    log.bounty.streak = log.bounty.last === yesterday ? log.bounty.streak + 1 : 1;
    log.bounty.last = today;
    logDirty = true;
    toast(t.bountyToast.replace('{name}', c.name));
    renderBounty();
    setTimeout(() => openSheet('bounty-sheet'), 1200);
  }
  function updateBountyPill() {
    const el = $('bounty');
    if (!bountyRow) return;
    el.hidden = false;
    const inZone = !log.bounty.ms && camDepth >= bandLo && camDepth <= bandHi;
    el.classList.toggle('hot', inZone);
    el.lastElementChild!.textContent = log.bounty.ms ? t.bountyDone : inZone ? t.bountyIn : t.bounty;
  }
  if (bountyIndex >= 0) {
    fetch(`/data/c/${Math.floor(bountyIndex / CHUNK)}.json`)
      .then((r) => r.json())
      .then((rows: Row[]) => (bountyRow = rows[bountyIndex % CHUNK]))
      .catch(() => {});
  }
  $('bounty').addEventListener('click', () => {
    if (!log.bounty.start) {
      log.bounty.start = Date.now(); // the clock starts when the clues are first read
      logDirty = true;
    }
    renderBounty();
    openSheet('bounty-sheet');
  });
  $('bounty-go').addEventListener('click', () => {
    $('bounty-sheet').hidden = true;
    teleport(bandLo);
  });

  // ----- bottles and leaderboard: the two things that talk to the server (worker/index.js) -----
  type Bottle = { id: number; depth: number; text: string; name: string; created: number };
  type LiveBottle = { b: Bottle; group: THREE.Group; sprite: THREE.Sprite; y: number; phase: number; screen: Screen };
  const BOTTLE_BAND = 20000;
  const bottleBands = new Map<number, Bottle[] | null>();
  const liveBottles = new Map<number, LiveBottle>();
  let apiOk = true; // turns false where there is no server (astro dev), and the features hide
  let bottleTex: THREE.Texture | null = null;
  function bottleTexture() {
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 192;
    const g = c.getContext('2d')!;
    g.lineJoin = 'round';
    g.beginPath(); // body, shoulders, neck
    g.moveTo(26, 178); g.lineTo(70, 178); g.quadraticCurveTo(80, 178, 80, 166); g.lineTo(80, 92);
    g.quadraticCurveTo(80, 70, 60, 58); g.lineTo(60, 26); g.lineTo(36, 26); g.lineTo(36, 58);
    g.quadraticCurveTo(16, 70, 16, 92); g.lineTo(16, 166); g.quadraticCurveTo(16, 178, 26, 178);
    g.closePath();
    g.fillStyle = 'rgba(150,255,225,0.28)';
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(215,255,244,0.95)';
    g.stroke();
    g.fillStyle = '#c99a5b'; // cork
    g.fillRect(38, 8, 20, 20);
    g.fillStyle = '#fff3d0'; // the note
    g.save();
    g.translate(48, 126);
    g.rotate(-0.25);
    g.fillRect(-13, -30, 26, 60);
    g.restore();
    return new THREE.CanvasTexture(c);
  }
  function wantBand(n: number) {
    if (n < 0 || bottleBands.has(n) || !apiOk) return;
    bottleBands.set(n, null);
    fetch(`/api/bottles?band=${n}`)
      .then((r) => {
        // A 404 or an HTML answer means there is no server here at all (astro dev): stop asking.
        if (r.status === 404 || !r.headers.get('content-type')?.includes('json')) apiOk = false;
        return r.ok && apiOk ? r.json() : Promise.reject();
      })
      .then((list: Bottle[]) => {
        bottleBands.set(n, list);
        $('bottle-btn').hidden = false;
      })
      // A dropped connection is not the same thing: forget the attempt and try again shortly.
      .catch(() => setTimeout(() => bottleBands.delete(n), 5000));
  }
  function dropBottle(id: number) {
    const lb = liveBottles.get(id);
    if (!lb) return;
    scene.remove(lb.group);
    lb.sprite.material.dispose();
    liveBottles.delete(id);
  }
  function syncBottles() {
    const band = Math.floor(Math.max(camDepth, 0) / BOTTLE_BAND);
    for (const n of [band - 1, band, band + 1]) {
      wantBand(n);
      for (const b of bottleBands.get(n) ?? []) {
        const far = Math.abs(b.depth - camDepth);
        if (far < 800 && !liveBottles.has(b.id)) {
          bottleTex ??= bottleTexture();
          const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: bottleTex, color: 0xa8a8a8, transparent: true, depthWrite: false, fog: false }));
          sprite.scale.set(0.75, 1.5, 1);
          const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: 0x9affe0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.35 }));
          halo.scale.setScalar(3.4);
          halo.renderOrder = -1;
          const group = new THREE.Group();
          group.add(halo, sprite);
          const h = hashKey(`bottle:${b.id}`);
          // Always inside the default view: a bottle nobody can see is no fun.
          const az = (((h % 1000) / 1000) * 2 - 1) * 0.42;
          const r = 6 + ((h >>> 10) % 300) / 100;
          const y = -b.depth * K;
          group.position.set(Math.sin(az) * r, y, -Math.cos(az) * r);
          scene.add(group);
          liveBottles.set(b.id, { b, group, sprite, y, phase: (h % 628) / 100, screen: null });
        } else if (far > 1100) dropBottle(b.id);
      }
    }
  }
  function pickBottle(x: number, y: number): LiveBottle | null {
    for (const lb of liveBottles.values()) {
      if (lb.screen && lb.screen.d < 45 && Math.hypot(x - lb.screen.x, y - lb.screen.y) < Math.max(lb.screen.r, 30)) return lb;
    }
    return null;
  }
  let reading: Bottle | null = null;
  function readBottle(lb: LiveBottle) {
    reading = lb.b;
    $('bottle-where').textContent = t.bottleFound.replace('{d}', fmtDepth(lb.b.depth));
    $('bottle-text').textContent = lb.b.text;
    $('bottle-by').textContent = `— ${lb.b.name}, ${new Date(lb.b.created * 1000).toLocaleDateString()}`;
    openSheet('bottle-read');
    sound.blip();
  }
  const post = (path: string, data: unknown) =>
    fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  $('bottle-report').addEventListener('click', () => {
    if (!reading) return;
    void post('/api/bottles/report', { id: reading.id });
    dropBottle(reading.id);
    for (const list of bottleBands.values()) {
      const i = list?.findIndex((b) => b.id === reading!.id) ?? -1;
      if (i >= 0) list!.splice(i, 1);
    }
    $('bottle-read').hidden = true;
    toast(t.bottleReported);
  });
  $('bottle-btn').addEventListener('click', () => {
    $('bottle-error').hidden = true;
    openSheet('bottle-write');
  });
  const bottleForm = $<HTMLFormElement>('bottle-form');
  (bottleForm.elements.namedItem('name') as HTMLInputElement).value = log.board.name;
  bottleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(bottleForm);
    const depth = Math.round(Math.max(camDepth, 0));
    let error = 'other';
    try {
      const res = await post('/api/bottles', { depth, text: data.get('text'), name: data.get('name') });
      const body = await res.json();
      if (res.ok) {
        const band = Math.floor(depth / BOTTLE_BAND);
        bottleBands.set(band, [body as Bottle, ...(bottleBands.get(band) ?? [])]);
        (bottleForm.elements.namedItem('text') as HTMLTextAreaElement).value = '';
        $('bottle-write').hidden = true;
        toast(t.bottleSent.replace('{d}', fmtDepth(depth)));
        return;
      }
      error = body.error in t.bottleErr ? body.error : 'other';
    } catch {
      /* network error: generic message */
    }
    const el = $('bottle-error');
    el.textContent = t.bottleErr[error];
    el.hidden = false;
  });

  type Score = { name: string; seen: number; species: number; deepest: number; fish: number; fishbest: number; fishname: string };
  let boardTab = 'dive';
  let lastScoreAt = 0;
  const myScore = () => ({ id: log.board.id, name: log.board.name, seen: seenCount(), species: speciesCount(), deepest: Math.round(log.deepest), ach: Object.keys(log.ach).length,
    fish: log.fish.total, fishbest: log.fish.best?.[1] ?? 0, fishname: log.fish.best?.[0] ?? '' });
  function submitScore(force = false) {
    if (!log.board.id || (!force && Date.now() - lastScoreAt < 45000)) return Promise.resolve(null);
    lastScoreAt = Date.now();
    return post('/api/score', myScore()).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  async function renderBoard() {
    const tab = boardTab, fishTab = tab === 'fish';
    const sub = $('board-sub');
    sub.textContent = sub.dataset[tab]!;
    $('board-you').textContent = '';
    const list = $('board-list');
    list.textContent = t.boardLoading;
    $('board-join').hidden = !!log.board.id;
    const rank = await submitScore(true);
    let rows: Score[];
    try {
      const res = await fetch(fishTab ? '/api/board?by=fish' : '/api/board', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      rows = await res.json();
    } catch {
      list.textContent = t.boardFail;
      return;
    }
    if (tab !== boardTab) return; // switched tabs while loading
    const place = rank ? (fishTab ? rank.fishRank : rank.rank) : 0;
    $('board-you').textContent = place ? t.boardYou.replace('{n}', String(place)) : '';
    list.replaceChildren(...rows.map((r) => {
      const li = document.createElement('li');
      li.classList.toggle('me', !!log.board.id && r.name === log.board.name && (fishTab ? r.fish === log.fish.total : r.seen === seenCount()));
      const name = document.createElement('b');
      name.textContent = r.name;
      const seen = document.createElement('span');
      seen.textContent = fishTab ? t.boardLanded.replace('{n}', fmt(r.fish)) : `${fmt(r.seen)} ${t.logSeen} · ${r.species}/${SPECIES_IDS.length}`;
      const deep = document.createElement('span');
      deep.textContent = fishTab ? t.boardBest.replace('{name}', r.fishname).replace('{stars}', fmt(r.fishbest)) : fmtDepth(r.deepest);
      li.append(name, seen, deep);
      return li;
    }));
    if (!rows.length) list.textContent = t.boardEmpty;
  }
  // The Leaderboard link in the top bar opens the panel in place, so a dive is not interrupted.
  document.querySelector('a[data-board]')?.addEventListener('click', (e) => {
    e.preventDefault();
    openSheet('board-sheet');
    void renderBoard();
  });
  $('board-tabs').addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-tab]');
    if (!b) return;
    boardTab = b.dataset.tab!;
    for (const x of $('board-tabs').children) x.setAttribute('aria-pressed', String(x === b));
    void renderBoard();
  });
  $<HTMLFormElement>('board-join').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const input = form.elements.namedItem('name') as HTMLInputElement;
    log.board = { id: crypto.randomUUID(), name: input.value.trim() };
    const ok = await submitScore(true);
    if (!ok) {
      log.board = { id: '', name: '' };
      input.setCustomValidity(t.boardErr);
      input.reportValidity();
      input.setCustomValidity('');
      return;
    }
    logDirty = true;
    void renderBoard();
  });

  // ----- photo mode: the current view as a captioned picture, ready to post -----
  function takePhoto() {
    // The subject is whatever identified creature is closest to the middle of the frame.
    let subject: Creature | null = selected;
    if (!subject) {
      let bestD = Infinity;
      for (const c of live.values()) {
        if (!c.known || !c.screen || c.screen.d > 40) continue;
        const d = Math.hypot(c.screen.x - vw / 2, c.screen.y - vh / 2);
        if (d < bestD && d < Math.min(vw, vh) * 0.42) {
          bestD = d;
          subject = c;
        }
      }
    }
    const W = 1600, H = Math.round((1600 * vh) / vw);
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d')!;
    g.drawImage(canvas, 0, 0, W, H);
    const shade = g.createLinearGradient(0, H * 0.62, 0, H);
    shade.addColorStop(0, 'rgba(2,7,20,0)');
    shade.addColorStop(1, 'rgba(2,7,20,0.82)');
    g.fillStyle = shade;
    g.fillRect(0, H * 0.62, W, H * 0.38);
    const depthText = fmtDepth(Math.max(camDepth, 0));
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#ffffff';
    g.font = '400 76px "Instrument Serif", Georgia, serif';
    g.fillText(subject ? subject.name : depthText, 60, H - 96, W - 420);
    g.font = '500 28px Inter, system-ui, sans-serif';
    g.fillStyle = '#6ef3d6';
    g.fillText(subject ? `${t.speciesNames[subject.species]} · ${t.rarityNames[subject.rarity]} · ${fmtDepth(subject.depth)} · ★ ${fmt(subject.stars)}` : t.zones[zoneFor(Math.max(camDepth, 0))], 60, H - 50, W - 420);
    g.textAlign = 'right';
    g.fillStyle = '#ffffff';
    g.font = 'italic 400 46px "Instrument Serif", Georgia, serif';
    g.fillText('dshsea.com', W - 60, H - 52);
    const url = cv.toDataURL('image/jpeg', 0.9);
    ($('shot-img') as HTMLImageElement).src = url;
    const save = $('shot-save') as HTMLAnchorElement;
    save.href = url;
    save.download = `dshsea-${subject ? subject.name.replace(/[^\w.-]+/g, '-') : Math.round(Math.max(camDepth, 0)) + 'm'}.jpg`;
    const text = subject
      ? t.photoTweetAt.replace('{name}', subject.name).replace('{species}', t.speciesNames[subject.species].toLowerCase()).replace('{depth}', fmtDepth(subject.depth))
      : t.photoTweet.replace('{depth}', depthText);
    ($('shot-post') as HTMLAnchorElement).href =
      `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(location.origin + (subject ? pageOf(subject) : payload.base || '/'))}`;
    openSheet('shot');
    flash(false);
    if (!log.ach.photo) {
      log.ach.photo = 1;
      toast(t.achToast.replace('{name}', t.ach.photo[0]));
      logDirty = true;
    }
  }
  $('photo').addEventListener('click', () => (wantPhoto = true));
  // Following the signal drops you a little above the target: the last stretch is yours to search.
  $('tracker').addEventListener('click', () => {
    if (trackTarget >= 0) teleport(depthOf(trackTarget) - 140);
  });

  // ----- diving controls -----
  const inPanel = (el: EventTarget | null) => el instanceof Element && !!el.closest('#card, #egg, .sheet, #sonar-results, input');
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey || inPanel(e.target)) return;
    e.preventDefault();
    depthTarget += e.deltaY * (e.deltaMode === 1 ? 40 : 1) * 1.15;
  }, { passive: false });
  let touchY = 0, touchT = 0;
  canvas.addEventListener('touchstart', (e) => {
    touchY = e.touches[0].clientY;
    touchT = performance.now();
    fling = 0;
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    const y = e.touches[0].clientY, nowT = performance.now();
    const dy = touchY - y;
    depthTarget += dy * 2.6;
    fling = (dy * 2.6) / Math.max((nowT - touchT) / 1000, 0.008);
    touchY = y;
    touchT = nowT;
    e.preventDefault();
  }, { passive: false });
  const hold = (el: HTMLElement, dir: number) => {
    const start = (e: Event) => {
      e.preventDefault();
      turbo = dir;
      turboHeld = 0;
      el.classList.add('held');
    };
    const stop = () => {
      if (turbo === dir) turbo = 0;
      el.classList.remove('held');
    };
    el.addEventListener('pointerdown', start);
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, stop);
  };
  hold($('dive'), 1);
  hold($('rise'), -1);
  $('random').addEventListener('click', () => {
    if (!count) return;
    const i = Math.floor(Math.random() * count);
    pendingOpen = i;
    teleport(depthOf(i));
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCard();
      for (const id of ['egg', 'dex', 'shot', 'bounty-sheet', 'bottle-write', 'bottle-read', 'board-sheet']) $(id).hidden = true;
      $('fish-sheet').querySelector<HTMLElement>('[data-close]')!.click();
      return;
    }
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'p') wantPhoto = true;
    if (e.key === '/') {
      e.preventDefault();
      sonar.focus();
    } else if (e.key === 'ArrowDown' || e.key === ' ') {
      e.preventDefault();
      if (e.repeat) {
        if (!turbo) turboHeld = 0;
        turbo = 1;
      } else depthTarget += 160;
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (e.repeat) {
        if (!turbo) turboHeld = 0;
        turbo = -1;
      } else depthTarget -= 160;
    } else if (e.key === 'PageDown') depthTarget += 900;
    else if (e.key === 'PageUp') depthTarget -= 900;
    else if (e.key === 'Home') teleport(START_DEPTH);
    else if (e.key === 'End') teleport(MAX_DEPTH);
  });
  window.addEventListener('keyup', (e) => {
    if (['ArrowDown', 'ArrowUp', ' '].includes(e.key)) turbo = 0;
  });

  // ----- pointer: lamp, look-around, clicks -----
  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => {
    pointerX = e.clientX;
    pointerY = e.clientY;
    pointerIsMouse = e.pointerType === 'mouse';
    lastPointerAt = performance.now() / 1000;
    dragMoved = 0;
    if (!pointerIsMouse) return;
    dragging = true;
    dragX = e.clientX;
    dragY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    pointerX = e.clientX;
    pointerY = e.clientY;
    pointerIsMouse = e.pointerType === 'mouse';
    lastPointerAt = performance.now() / 1000;
    if (pointerIsMouse) {
      mouseX = (e.clientX / vw) * 2 - 1;
      mouseY = (e.clientY / vh) * 2 - 1;
    }
    if (dragging) {
      const dx = e.clientX - dragX, dy = e.clientY - dragY;
      dragX = e.clientX;
      dragY = e.clientY;
      dragMoved += Math.abs(dx) + Math.abs(dy);
      if (dragMoved > 6) {
        lookYaw = clamp(lookYaw + dx * 0.004, -1.25, 1.25);
        lookPitch = clamp(lookPitch + dy * 0.003, -0.6, 0.6);
        lastDragAt = time;
        canvas.style.cursor = 'grabbing';
      }
    } else if (!pointerIsMouse) dragMoved += 2;
  });
  const endDrag = () => {
    dragging = false;
    canvas.style.cursor = hovered ? 'pointer' : 'grab';
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => {
    if (!dragging) pointerX = pointerY = -1;
    hovered = null;
  });
  canvas.addEventListener('click', (e) => {
    if (dragMoved > 6) return; // that was a look-around drag or a swipe, not a click
    const bottle = pickBottle(e.clientX, e.clientY);
    if (bottle) return readBottle(bottle);
    const hit = pick(e.clientX, e.clientY);
    if (hit === 'ghost') location.href = `${payload.base}/submit`;
    else if (hit === 'chest') $('egg').hidden = false;
    else if (hit) openCard(hit);
    else {
      closeCard();
      if (camDepth > 0) ping(pointerRay(e.clientX, e.clientY, portrait ? 12 : 8.5, tmp));
    }
  });

  // ----- card -----
  const card = $('card');
  function openCard(c: Creature) {
    selected = c;
    c.revealAt = time;
    c.spinAt = time;
    discover(c);
    const img = $<HTMLImageElement>('card-img');
    img.src = creatureSrc(c.species);
    img.style.setProperty('--tint', `${tintDeg(c.hue)}deg`);
    $('card-name').textContent = c.name;
    $('card-kind').textContent = `${t.speciesNames[c.species]} · ${t.rarityNames[c.rarity]}`;
    card.dataset.rarity = c.rarity;
    card.dataset.wild = String(!c.slug);
    $('card-desc').textContent = c.desc || t.noDesc;
    const ev = evolution(c.stars);
    $('card-evolve').textContent = ev ? t.evolve.replace('{n}', fmt(ev.need)).replace('{rarity}', t.rarityNames[ev.next].toLowerCase()) : t.evolveMax;
    $('card-depth').textContent = fmtDepth(c.depth);
    $('card-stars').textContent = `★ ${fmt(c.stars)}`;
    $('card-status').textContent = c.slug ? t.claimed : t.wild;
    ($('card-visit') as HTMLAnchorElement).href = c.url;
    const page = pageOf(c);
    const details = $('card-details') as HTMLAnchorElement;
    details.textContent = t.details;
    details.href = page;
    const claim = $('card-claim') as HTMLAnchorElement;
    claim.hidden = !!c.slug || !c.repo;
    claim.href = `${payload.base}/submit?repo=${encodeURIComponent(c.repo ?? '')}`;
    const text = t.shareTweet.replace('{name}', c.name).replace('{species}', t.speciesNames[c.species].toLowerCase()).replace('{depth}', fmtDepth(c.depth));
    ($('card-share') as HTMLAnchorElement).href =
      `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(location.origin + page)}`;
    card.hidden = false;
  }
  function closeCard() {
    selected = null;
    card.hidden = true;
  }
  $('card-close').addEventListener('click', closeCard);
  $('egg-close').addEventListener('click', () => ($('egg').hidden = true));
  $('egg-depth').textContent = fmtDepth(SEABED);

  // ----- sonar: lights up what is nearby, and searches all the names in the ocean -----
  const sonar = $<HTMLInputElement>('sonar');
  const results = $('sonar-results');
  let names: string[] | null = null, namesLower: string[] = [], hits: number[] = [];
  const loadNames = () =>
    names ? Promise.resolve() : fetch('/data/names.json').then((r) => r.json()).then((list: string[]) => {
      names = list;
      namesLower = list.map((n) => n.toLowerCase());
    });
  function jump(index: number) {
    pendingOpen = index;
    const c = live.get(index);
    teleport(depthOf(index));
    if (c) pendingOpen = index;
    // The search is done: clear it so the neighbours are not left dimmed.
    sonar.value = '';
    query = '';
    results.hidden = true;
    sonar.blur();
  }
  function search() {
    query = sonar.value.trim().toLowerCase();
    hits = [];
    if (query && names) {
      // Repo-name matches first, then owner matches.
      const second: number[] = [];
      for (let i = 0; i < namesLower.length && hits.length < 8; i++) {
        const n = namesLower[i], at = n.indexOf(query);
        if (at < 0) continue;
        if (at > n.indexOf('/')) hits.push(i);
        else if (second.length < 8) second.push(i);
      }
      hits = hits.concat(second).slice(0, 8);
    }
    results.replaceChildren(...hits.map((i) => {
      const b = document.createElement('button');
      const name = document.createElement('span');
      name.textContent = names![i];
      const d = document.createElement('small');
      d.textContent = fmtDepth(depthOf(i));
      b.append(name, d);
      b.addEventListener('click', () => jump(i));
      return b;
    }));
    if (query && names && !hits.length) results.textContent = t.sonarNone;
    results.hidden = !query;
  }
  sonar.addEventListener('focus', () => void loadNames().then(search));

  // ----- fishing (fishing.ts): a catch counts as a discovery -----
  const fishing = initFishing({
    t, base: payload.base, count, chunk: CHUNK, log: log.fish,
    claimed: Object.values(payload.claimed), giants: payload.meta.landmarks.map(([i]) => i),
    save: () => (logDirty = true),
    bonus: () => (log.bounty.day === today && log.bounty.ms ? 2 : 0),
    toast, blip: () => sound.blip(), openSheet, jump, post,
    names: () => loadNames().then(() => namesLower),
    landed(c) {
      const liveOne = [...live.values()].find((x) => x.key === c.key);
      if (liveOne) liveOne.known = true;
      if (log.seen[c.key]) return;
      log.seen[c.key] = 1;
      log.rarity[c.rarity] = 1;
      log.species[c.species] = (log.species[c.species] ?? 0) + 1;
      if (c.stars > 0 && (log.best.length < 6 || c.stars > log.best[log.best.length - 1][1])) {
        log.best = [...log.best, [c.name, c.stars, c.species, c.hue, c.path] as Find].sort((x, y) => y[1] - x[1]).slice(0, 6);
      }
    },
  });
  sonar.addEventListener('input', () => {
    search();
    if (query && camDepth > 0) ping(tmp.set(0, camera.position.y, -2));
  });
  sonar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && hits.length) jump(hits[0]);
    else if (e.key === 'Escape') {
      sonar.value = '';
      search();
      sonar.blur();
    }
  });

  // ----- gauge: the whole ocean on one line, with the giants marked -----
  const dots = $('gauge-dots');
  for (const [index, name] of payload.meta.landmarks) {
    const i = document.createElement('i');
    i.style.top = `${(depthOf(index) / SEABED) * 100}%`;
    i.title = name;
    dots.append(i);
  }
  $('gauge-bar').addEventListener('click', (e) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    teleport(clamp((e.clientY - rect.top) / rect.height, 0, 1) * SEABED);
  });

  window.addEventListener('resize', resize);
  resize();
  checkAchievements();
  renderLog();

  // Deep links: ?seek=<claimed slug or owner/repo>, ?d=<metres>.
  const seek = params.get('seek');
  if (seek) {
    const claimedAt = payload.claimed[seek];
    if (claimedAt !== undefined) jump(claimedAt);
    else void loadNames().then(() => {
      const i = namesLower.indexOf(seek.toLowerCase());
      if (i >= 0) jump(i);
    });
  } else if (params.has('d')) teleport(Number(params.get('d')) || 0);
  // The Fish link in the top bar opens the panel in place; from other pages it arrives as /?fish.
  document.querySelector('a[data-fish]')?.addEventListener('click', (e) => {
    e.preventDefault();
    fishing.open();
  });
  if (params.has('fish')) fishing.open();

  document.body.classList.add('ocean-3d');
  requestAnimationFrame(frame);
}
