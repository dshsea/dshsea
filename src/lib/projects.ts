import fs from 'node:fs';
import path from 'node:path';
import { loadProjects, CATEGORIES } from '../../scripts/lib/load-projects.mjs';
import { traits, depthOf, fmtDepth, zoneFor, tintDeg, type Rarity, type SpeciesId } from './species';
import { dict } from './i18n';

/** One creature in the ocean: either crawled from GitHub ("wild") or claimed through a PR. */
export type Entry = {
  key: string; name: string; repo: string | null; url: string; stars: number; created: string;
  desc: string; descZh: string | null; slug: string | null; pick: SpeciesId | null; category: string | null;
};
/** A claimed project: it has its own page, share card and badge. */
export type Project = {
  slug: string; name: string; repo: string | null; url: string; category: string;
  description: string; descriptionZh: string | null; author: string | null; x: string | null;
  added: string; created: string; stars: number;
  key: string; index: number; depth: number; rarity: Rarity; hue: number; seed: number; species: SpeciesId;
};

export const CHUNK = 400;
let cache: { entries: Entry[]; projects: Project[] } | null = null;

function build() {
  const root = process.cwd();
  const { projects: claimed, errors } = loadProjects(root);
  if (errors.length) throw new Error(`Invalid project data:\n${errors.join('\n')}`);
  const wildFile = path.join(root, 'data', 'wild.json');
  const wild: [string, number, string, string][] = fs.existsSync(wildFile) ? JSON.parse(fs.readFileSync(wildFile, 'utf8')) : [];

  const map = new Map<string, Entry>();
  for (const [full, stars, created, desc] of wild) {
    map.set(full.toLowerCase(), {
      key: full.toLowerCase(), name: full.split('/')[1], repo: full, url: `https://github.com/${full}`,
      stars, created, desc, descZh: null, slug: null, pick: null, category: null,
    });
  }
  const bySlug = new Map<string, any>();
  for (const p of claimed as any[]) {
    const key = (p.repo ?? p.url).toLowerCase().replace(/\/$/, '');
    const w = map.get(key);
    bySlug.set(p.slug, p);
    map.set(key, {
      key, name: p.name, repo: p.repo, url: p.url, stars: w?.stars ?? p.stars, created: w?.created ?? p.created,
      desc: p.description, descZh: p.descriptionZh, slug: p.slug, pick: p.species, category: p.category,
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
      created: e.created, stars: e.stars, key: e.key, index, depth: depthOf(index), ...traits(e.key, e.stars, e.pick),
    });
  });
  return { entries, projects };
}

export function getCatalog() {
  return (cache ??= build());
}
export const getProjects = () => getCatalog().projects;

/** A chunk of the ocean as the browser receives it. Wild rows are [repo, stars, desc]; claimed rows carry more. */
export function chunkRows(n: number) {
  return getCatalog().entries.slice(n * CHUNK, (n + 1) * CHUNK).map((e) =>
    e.slug
      ? [e.repo ?? e.url, e.stars, e.desc, e.slug, e.name, e.pick ?? 0, e.descZh ?? 0]
      : [e.repo, e.stars, e.desc],
  );
}

// ----- one landing page per GitHub repo (/r/owner/repo) -----
export const REPO_BUCKETS = 256;
/** Everything a repo page shows, as strings. The keys double as the `__TOKEN__` names in the page template. */
export type RepoPage = {
  KEY: string; REPO: string; NAME: string; OWNER: string; DESC: string; META: string; STARS: string; CREATED: string;
  DEPTH: string; ZONE: string; SPECIES: string; SPECIES_NAME: string; RARITY: string; RARITY_NAME: string; TINT: string; HUE: string;
  /** Neighbours in the water column: three above, three below. */
  N: string[];
  /** Slug, when the repo has been claimed: its page lives at /p/<slug> instead. */
  P?: string;
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
    KEY: e.key, REPO: e.repo, NAME: name, OWNER: owner, DESC: desc, META: meta.length > 158 ? `${meta.slice(0, 157)}…` : meta,
    STARS: fmt(e.stars), CREATED: DATE.format(new Date(`${e.created}T00:00:00Z`)),
    DEPTH: fmtDepth(depth), ZONE: en.zones[zoneFor(depth)], SPECIES: tr.species, SPECIES_NAME: en.speciesNames[tr.species],
    RARITY: tr.rarity, RARITY_NAME: en.rarityNames[tr.rarity], TINT: String(tintDeg(tr.hue)), HUE: String(tr.hue),
    N, ...(e.slug ? { P: e.slug } : {}),
  };
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
