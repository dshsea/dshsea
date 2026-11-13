import fs from 'node:fs';
import path from 'node:path';
import { loadProjects, CATEGORIES } from '../../scripts/lib/load-projects.mjs';
import { traits, depthOf, fmtDepth, zoneFor, tintDeg, evolution, type Rarity, type SpeciesId } from './species';
import { dict } from './i18n';

/** One creature in the ocean: either crawled from GitHub ("wild") or claimed through a PR. */
export type Entry = {
  key: string; name: string; repo: string | null; url: string; stars: number; created: string;
  desc: string; descZh: string | null; slug: string | null; pick: SpeciesId | null; category: string | null;
  /** The repo declares a DSH bundle, so `dsh plugin add` can install it (data/bundles.json). */
  inst: boolean;
};
/** A claimed project: it has its own page, share card and badge. */
export type Project = {
  slug: string; name: string; repo: string | null; url: string; category: string;
  description: string; descriptionZh: string | null; author: string | null; x: string | null;
  added: string; created: string; stars: number;
  key: string; index: number; depth: number; rarity: Rarity; hue: number; seed: number; species: SpeciesId; inst: boolean;
};

export const CHUNK = 400;
let cache: { entries: Entry[]; projects: Project[] } | null = null;

function build() {
  const root = process.cwd();
  const { projects: claimed, errors } = loadProjects(root);
  if (errors.length) throw new Error(`Invalid project data:\n${errors.join('\n')}`);
  const wildFile = path.join(root, 'data', 'wild.json');
  const wild: [string, number, string, string][] = fs.existsSync(wildFile) ? JSON.parse(fs.readFileSync(wildFile, 'utf8')) : [];

  const bundleFile = path.join(root, 'data', 'bundles.json');
  const bundles: Record<string, [string, string | 0]> = fs.existsSync(bundleFile) ? JSON.parse(fs.readFileSync(bundleFile, 'utf8')) : {};
  const inst = (key: string) => !!bundles[key]?.[1];
  const map = new Map<string, Entry>();
  for (const [full, stars, created, desc] of wild) {
    map.set(full.toLowerCase(), {
      key: full.toLowerCase(), name: full.split('/')[1], repo: full, url: `https://github.com/${full}`,
      stars, created, desc, descZh: null, slug: null, pick: null, category: null, inst: inst(full.toLowerCase()),
    });
  }
  const bySlug = new Map<string, any>();
  for (const p of claimed as any[]) {
    const key = (p.repo ?? p.url).toLowerCase().replace(/\/$/, '');
    const w = map.get(key);
    bySlug.set(p.slug, p);
    map.set(key, {
      key, name: p.name, repo: p.repo, url: p.url, stars: w?.stars ?? p.stars, created: w?.created ?? p.created,
      desc: p.description, descZh: p.descriptionZh, slug: p.slug, pick: p.species, category: p.category, inst: inst(key),
    });
  }
  // Newest first: index 0 swims just under the surface, the oldest project is the deepest.
  const entries = [...map.values()].sort((a, b) => b.created.localeCompare(a.created) || a.key.localeCompare(b.key));
  const projects: Project[] = [];
  entries.forEach((e, index) => {
    if (!e.slug) return;
    const p = bySlug.get(e.slug);
    projects.push({
      slug: p.slug, name: p.name, repo: p.repo, url: p.url, category: p.category,
      description: p.description, descriptionZh: p.descriptionZh, author: p.author, x: p.x, added: p.added,
      created: e.created, stars: e.stars, key: e.key, index, depth: depthOf(index), inst: e.inst, ...traits(e.key, e.stars, e.pick),
    });
  });
  return { entries, projects };
}

export function getCatalog() {
  return (cache ??= build());
}
export const getProjects = () => getCatalog().projects;
/**
 * The welcome reef: the most recently claimed creatures swim just under the surface, where every
 * diver enters, until newer claims take their place. Ties on the date go to the bigger project.
 */
export const REEF_SIZE = 8;
export const getFresh = () =>
  [...getProjects()].sort((a, b) => b.added.localeCompare(a.added) || b.stars - a.stars || a.slug.localeCompare(b.slug)).slice(0, REEF_SIZE);

/**
 * A chunk of the ocean as the browser receives it. Wild rows are [repo, stars, desc]; claimed rows carry more.
 * The eighth element is 1 when the repo is installable; wild rows are padded with zeros to reach it.
 */
export function chunkRows(n: number) {
  return getCatalog().entries.slice(n * CHUNK, (n + 1) * CHUNK).map((e) =>
    e.slug
      ? [e.repo ?? e.url, e.stars, e.desc, e.slug, e.name, e.pick ?? 0, e.descZh ?? 0, e.inst ? 1 : 0]
      : e.inst ? [e.repo, e.stars, e.desc, 0, 0, 0, 0, 1] : [e.repo, e.stars, e.desc],
  );
}

// ----- one landing page per GitHub repo (/r/owner/repo) -----
export const REPO_BUCKETS = 256;
/** Everything a repo page shows, as strings. The keys double as the `__TOKEN__` names in the page template. */
export type RepoPage = {
  KEY: string; REPO: string; NAME: string; OWNER: string; OWNER_KEY: string; DESC: string; META: string; STARS: string; CREATED: string;
  DEPTH: string; ZONE: string; SPECIES: string; SPECIES_NAME: string; RARITY: string; RARITY_NAME: string; TINT: string; HUE: string; EVOLVE: string;
  /** Neighbours in the water column: three above, three below. */
  N: string[];
  /** Slug, when the repo has been claimed: its page lives at /p/<slug> instead. */
  P?: string;
  /** 1 when the repo is installable. */
  I?: 1;
};
const en = dict('en');
const DATE = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

export function repoPage(index: number): RepoPage | null {
  const { entries } = getCatalog();
  const e = entries[index];
  if (!e?.repo) return null;
  const tr = traits(e.key, e.stars, e.pick);
  const depth = depthOf(index);
  const [owner, name] = e.repo.split('/');
  const desc = e.desc || `A DeepSeek Harness plugin by ${owner}. Nobody has told its story yet.`;
  const meta = `${name} by ${owner}: ${desc}`;
  const N: string[] = [];
  for (let i = index - 3; i <= index + 3; i++) if (i !== index && entries[i]?.repo) N.push(entries[i].repo!);
  return {
    KEY: e.key, REPO: e.repo, NAME: name, OWNER: owner, OWNER_KEY: owner.toLowerCase(), DESC: desc, META: meta.length > 158 ? `${meta.slice(0, 157)}…` : meta,
    STARS: fmt(e.stars), CREATED: DATE.format(new Date(`${e.created}T00:00:00Z`)),
    DEPTH: fmtDepth(depth), ZONE: en.zones[zoneFor(depth)], SPECIES: tr.species, SPECIES_NAME: en.speciesNames[tr.species],
    RARITY: tr.rarity, RARITY_NAME: en.rarityNames[tr.rarity], TINT: String(tintDeg(tr.hue)), HUE: String(tr.hue),
    EVOLVE: evolveText(e.stars),
    N, ...(e.slug ? { P: e.slug } : {}), ...(e.inst ? { I: 1 as const } : {}),
  };
}
export function evolveText(stars: number, lang: 'en' | 'zh' = 'en') {
  const t = dict(lang);
  const ev = evolution(stars);
  return ev ? t.evolve(fmt(ev.need), t.rarityNames[ev.next]) : t.evolveMax;
}

// ----- one page per GitHub owner (/u/owner): all of their creatures -----
export const OWNER_BUCKETS = 64;
/** [name, page path, species, tint degrees, species name, rarity, stars, depth] */
export type OwnerRow = [string, string, string, number, string, string, string, string];
export type OwnerPage = { KEY: string; OWNER: string; COUNT: string; STARS: string; DEEPEST: string; META: string; L: OwnerRow[] };
let owners: Map<string, OwnerPage> | null = null;
export function ownerPages(): Map<string, OwnerPage> {
  if (owners) return owners;
  const groups = new Map<string, { owner: string; rows: { e: Entry; index: number }[] }>();
  getCatalog().entries.forEach((e, index) => {
    if (!e.repo) return;
    const owner = e.repo.split('/')[0];
    const g = groups.get(owner.toLowerCase()) ?? { owner, rows: [] };
    g.rows.push({ e, index });
    groups.set(owner.toLowerCase(), g);
  });
  owners = new Map();
  for (const [key, g] of groups) {
    const rows = g.rows.sort((a, b) => b.e.stars - a.e.stars || a.index - b.index);
    const stars = rows.reduce((n, r) => n + r.e.stars, 0);
    const deepest = Math.max(...rows.map((r) => depthOf(r.index)));
    owners.set(key, {
      KEY: key, OWNER: g.owner, COUNT: fmt(rows.length), STARS: fmt(stars), DEEPEST: fmtDepth(deepest),
      META: `${g.owner} has ${fmt(rows.length)} DeepSeek Harness plugin${rows.length === 1 ? '' : 's'} swimming in the dshsea ocean, down to ${fmtDepth(deepest)}: ${rows.slice(0, 4).map((r) => r.e.name).join(', ')}${rows.length > 4 ? ' and more' : ''}.`,
      // The page shows the 120 biggest; the count above is the real total.
      L: rows.slice(0, 120).map(({ e, index }) => {
        const tr = traits(e.key, e.stars, e.pick);
        return [e.name, pagePath(e), tr.species, tintDeg(tr.hue), en.speciesNames[tr.species], tr.rarity, fmt(e.stars), fmtDepth(depthOf(index))];
      }),
    });
  }
  return owners;
}

/** The command that installs a repo as a DSH plugin. `tui` is the profile most people run. */
export const installCmd = (repo: string) => `dsh plugin --profile tui add github:${repo}`;
/** Which creatures are installable, one bit per index, base64: the browser's fishing reads it. */
export function installBits() {
  const { entries } = getCatalog();
  const bytes = new Uint8Array(Math.ceil(entries.length / 8));
  entries.forEach((e, i) => {
    if (e.inst) bytes[i >> 3] |= 1 << (i & 7);
  });
  return Buffer.from(bytes).toString('base64');
}

/** Where a creature's own page lives. */
export const pagePath = (e: Entry) => (e.slug ? `/p/${e.slug}` : e.repo ? `/r/${e.key}` : '/');

export { CATEGORIES };
export const SITE = 'https://dshsea.com';
export const REPO = 'dshsea/dshsea';
export const REPO_URL = `https://github.com/${REPO}`;

export function fmt(n: number) {
  return n.toLocaleString('en-US');
}
