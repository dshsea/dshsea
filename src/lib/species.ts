// Species, rarity, traits and ocean zones. The 3D models live in src/components/creatures3d.ts;
// the still images in public/creatures/ are rendered from them by scripts/render-species.mjs.

export const SPECIES_IDS = [
  'fish', 'jellyfish', 'seahorse', 'pufferfish', 'eel', 'crab', 'starfish', 'shrimp', 'nudibranch',
  'anglerfish', 'turtle', 'octopus', 'squid', 'cuttlefish', 'lionfish', 'sunfish', 'nautilus',
  'shark', 'hammerhead', 'manta', 'narwhal', 'dolphin', 'swordfish',
  'whale',
] as const;
export type SpeciesId = (typeof SPECIES_IDS)[number];
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

/** Which species each rarity can be. Common ones are weighted towards plain fish. */
export const POOLS: Record<Rarity, SpeciesId[]> = {
  common: ['fish', 'fish', 'fish', 'jellyfish', 'seahorse', 'pufferfish', 'eel', 'crab', 'starfish', 'shrimp', 'nudibranch'],
  rare: ['anglerfish', 'turtle', 'octopus', 'squid', 'cuttlefish', 'lionfish', 'sunfish', 'nautilus'],
  epic: ['shark', 'hammerhead', 'manta', 'narwhal', 'dolphin', 'swordfish'],
  legendary: ['whale'],
};
export const SPECIES_RARITY = Object.fromEntries(
  (Object.entries(POOLS) as [Rarity, SpeciesId[]][]).flatMap(([r, ids]) => ids.map((id) => [id, r])),
) as Record<SpeciesId, Rarity>;

// Thresholds follow the real distribution: about 1 in 25 dsh plugins has 20+ stars, 1 in 270 has 1,000+.
export function rarityFor(stars: number): Rarity {
  if (stars >= 100000) return 'legendary';
  if (stars >= 1000) return 'epic';
  if (stars >= 20) return 'rare';
  return 'common';
}

/** What a creature becomes next, and how many more stars that takes. Null once it is a whale. */
export function evolution(stars: number): { next: Rarity; need: number } | null {
  for (const [at, next] of [[20, 'rare'], [1000, 'epic'], [100000, 'legendary']] as const) {
    if (stars < at) return { next, need: at - stars };
  }
  return null;
}

export function hashKey(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type Traits = { species: SpeciesId; rarity: Rarity; hue: number; seed: number };
/**
 * Everything about a creature's looks follows from its key (owner/repo, lower-cased) and its stars,
 * so the build and the browser always agree. Claimed projects may pick their own species.
 */
export function traits(key: string, stars: number, pick?: SpeciesId | null): Traits {
  const h = hashKey(key);
  const rarity = rarityFor(stars);
  const pool = POOLS[rarity];
  const species = rarity === 'legendary' ? 'whale' : pick && pick !== 'whale' ? pick : pool[(h >>> 9) % pool.length];
  return { species, rarity, hue: h % 360, seed: ((h >>> 17) % 1000) / 1000 };
}

/** The hue the still renders were photographed at. */
export const REF_HUE = 200;
export const creatureSrc = (id: SpeciesId) => `/creatures/${id}.webp`;
/** Degrees to rotate a still render so it matches a project's hue. */
export const tintDeg = (hue: number) => (((hue - REF_HUE) % 360) + 360) % 360;
/** Inline style for an <img class="creature">. */
export const tintStyle = (hue: number) => `--tint:${tintDeg(hue)}deg`;

// Depth is seniority and has no floor: every project sits STEP metres below the next newer one.
// The first 260 m are kept clear for the welcome reef (the newest claims) and the "your project?" ghost.
export const DEPTH_START = 260;
export const DEPTH_STEP = 32;
export const depthOf = (index: number) => DEPTH_START + index * DEPTH_STEP;

export const ZONES = [
  { from: 0, id: 'sunlight' },
  { from: 200, id: 'twilight' },
  { from: 1000, id: 'midnight' },
  { from: 4000, id: 'abyss' },
  { from: 6000, id: 'hadal' },
  { from: 11000, id: 'below' },
  { from: 60000, id: 'quiet' },
  { from: 250000, id: 'old' },
] as const;
export type ZoneId = (typeof ZONES)[number]['id'];

export function zoneFor(depth: number): ZoneId {
  let z: ZoneId = 'sunlight';
  for (const zone of ZONES) if (depth >= zone.from) z = zone.id;
  return z;
}

export const fmtDepth = (m: number) => (m < 10000 ? `${Math.round(m).toLocaleString('en-US')} m` : `${(m / 1000).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} km`);
