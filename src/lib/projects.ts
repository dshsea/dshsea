import fs from 'node:fs';
import path from 'node:path';
import { loadProjects, CATEGORIES } from '../../scripts/lib/load-projects.mjs';
import { traits, depthOf, type Rarity, type SpeciesId } from './species';

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

export { CATEGORIES };
export const SITE = 'https://dshsea.com';
export const REPO = 'dshsea/dshsea';
export const REPO_URL = `https://github.com/${REPO}`;

export const fmt = (n: number) => n.toLocaleString('en-US');
