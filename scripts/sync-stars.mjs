// Refreshes data/stars.json (stars + creation date per GitHub repo).
// Run by .github/workflows/sync-stars.yml on a schedule; the site build itself never hits the network.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjects } from './lib/load-projects.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'data', 'stars.json');
const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const { projects } = loadProjects(root);
const token = process.env.GITHUB_TOKEN;
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'dshsea-sync' };
if (token) headers.Authorization = `Bearer ${token}`;

const next = {};
let failed = 0;
for (const p of projects) {
  if (!p.repo) continue;
  try {
    const res = await fetch(`https://api.github.com/repos/${p.repo}`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    next[p.repo] = { stars: data.stargazers_count, created: data.created_at.slice(0, 10) };
  } catch (e) {
    failed++;
    console.warn(`! ${p.repo}: ${e.message}${previous[p.repo] ? ' (keeping previous value)' : ''}`);
    if (previous[p.repo]) next[p.repo] = previous[p.repo];
  }
}

const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n');
console.log(`Synced ${Object.keys(sorted).length} repos (${failed} failed).`);
