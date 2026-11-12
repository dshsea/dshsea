// Shared loader + validator for data/projects/*.yaml.
// Used by the Astro site (src/lib/projects.ts) and by scripts/validate.mjs (CI).
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

export const CATEGORIES = ['tools', 'ui', 'memory', 'skills', 'models', 'workflow', 'apps', 'fun', 'resources'];

const ALLOWED_KEYS = ['name', 'repo', 'url', 'category', 'description', 'description_zh', 'author', 'x', 'added', 'species'];
// Claimed projects may pick a species. Whales are earned (100k+ stars), not picked.
export const PICKABLE_SPECIES = [
  'fish', 'jellyfish', 'seahorse', 'pufferfish', 'eel', 'crab', 'starfish', 'shrimp', 'nudibranch',
  'anglerfish', 'turtle', 'octopus', 'squid', 'cuttlefish', 'lionfish', 'sunfish', 'nautilus',
  'shark', 'hammerhead', 'manta', 'narwhal', 'dolphin', 'swordfish',
];
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const MIN_DEPTH = 260;
export const MAX_DEPTH = 9800;
/** The seabed. 1024 × 10, obviously. */
export const SEABED_DEPTH = 10240;

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rarityFor(stars) {
  if (stars >= 100000) return 'legendary';
  if (stars >= 10000) return 'epic';
  if (stars >= 1000) return 'rare';
  return 'common';
}

function validateEntry(slug, raw) {
  const errors = [];
  const err = (m) => errors.push(`${slug}.yaml: ${m}`);
  if (!SLUG_RE.test(slug)) err('file name must be lowercase letters, digits and dashes (e.g. my-plugin.yaml)');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    err('file must be a YAML mapping');
    return errors;
  }
  for (const k of Object.keys(raw)) if (!ALLOWED_KEYS.includes(k)) err(`unknown key "${k}"`);
  const str = (k) => (typeof raw[k] === 'string' ? raw[k].trim() : '');
  if (!str('name')) err('"name" is required');
  else if (str('name').length > 40) err('"name" must be 40 characters or fewer');
  if (!CATEGORIES.includes(raw.category)) err(`"category" must be one of: ${CATEGORIES.join(', ')}`);
  const d = str('description');
  if (d.length < 10 || d.length > 200) err('"description" must be 10–200 characters');
  if (raw.description_zh !== undefined && (str('description_zh').length < 4 || str('description_zh').length > 200))
    err('"description_zh" must be 4–200 characters');
  if (!raw.repo && !raw.url) err('one of "repo" (owner/name) or "url" is required');
  if (raw.repo !== undefined && !REPO_RE.test(String(raw.repo))) err('"repo" must look like owner/name');
  if (raw.url !== undefined && !/^https:\/\/[^\s]+$/.test(String(raw.url))) err('"url" must be an https:// URL');
  const added = raw.added instanceof Date ? raw.added.toISOString().slice(0, 10) : String(raw.added ?? '');
  if (!DATE_RE.test(added) || Number.isNaN(Date.parse(added))) err('"added" must be a date like 2026-11-12');
  if (raw.x !== undefined && !/^[A-Za-z0-9_]{1,15}$/.test(String(raw.x))) err('"x" must be an X handle without the @');
  if (raw.species !== undefined && !PICKABLE_SPECIES.includes(raw.species)) err(`"species" must be one of: ${PICKABLE_SPECIES.join(', ')}`);
  if (raw.author !== undefined && (typeof raw.author !== 'string' || raw.author.length > 40)) err('"author" must be a short string');
  return errors;
}

/**
 * @param {string} root repository root
 * @returns {{ projects: any[], errors: string[] }}
 */
export function loadProjects(root) {
  const dir = path.join(root, 'data', 'projects');
  const starsFile = path.join(root, 'data', 'stars.json');
  const starData = fs.existsSync(starsFile) ? JSON.parse(fs.readFileSync(starsFile, 'utf8')) : {};
  const errors = [];
  const projects = [];
  const seen = new Map();

  for (const file of fs.readdirSync(dir).sort()) {
    if (file.startsWith('.') || file.startsWith('_')) continue;
    if (!file.endsWith('.yaml')) {
      errors.push(`${file}: only .yaml files belong in data/projects`);
      continue;
    }
    const slug = file.slice(0, -5);
    let raw;
    try {
      raw = parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (e) {
      errors.push(`${file}: invalid YAML (${e.message.split('\n')[0]})`);
      continue;
    }
    const entryErrors = validateEntry(slug, raw);
    if (entryErrors.length) {
      errors.push(...entryErrors);
      continue;
    }
    const repo = raw.repo ? String(raw.repo) : null;
    const url = raw.url ? String(raw.url) : `https://github.com/${repo}`;
    const key = (repo ?? url).toLowerCase().replace(/\/$/, '');
    if (seen.has(key)) {
      errors.push(`${file}: duplicate of ${seen.get(key)}.yaml`);
      continue;
    }
    seen.set(key, slug);
    const added = raw.added instanceof Date ? raw.added.toISOString().slice(0, 10) : String(raw.added);
    const meta = repo ? starData[repo] : undefined;
    const stars = meta?.stars ?? 0;
    projects.push({
      slug,
      name: raw.name.trim(),
      repo,
      url,
      category: raw.category,
      description: raw.description.trim(),
      descriptionZh: raw.description_zh ? String(raw.description_zh).trim() : null,
      author: raw.author ?? (repo ? repo.split('/')[0] : null),
      x: raw.x ? String(raw.x) : null,
      species: raw.species ?? null,
      added,
      created: meta?.created ?? added,
      stars,
      rarity: rarityFor(stars),
      hue: hashString(slug) % 360,
    });
  }

  // Depth = seniority. Oldest project lives deepest; depths are spread evenly by age rank.
  const byAge = [...projects].sort((a, b) => a.created.localeCompare(b.created) || a.slug.localeCompare(b.slug));
  const n = byAge.length;
  byAge.forEach((p, i) => {
    const t = n > 1 ? i / (n - 1) : 0.5;
    p.depth = Math.round(MAX_DEPTH - t * (MAX_DEPTH - MIN_DEPTH));
  });

  projects.sort((a, b) => a.depth - b.depth);
  return { projects, errors };
}
