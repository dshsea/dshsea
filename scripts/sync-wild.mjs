// Crawls every public repo tagged `dsh-plugin` into data/wild.json: the "wild" creatures.
// GitHub search returns at most 1,000 results per query, so the crawl bisects the creation-date
// range until every slice fits. Run weekly by .github/workflows/sync-wild.yml.
//   GITHUB_TOKEN=... node scripts/sync-wild.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'data', 'wild.json');
const TOPIC = 'dsh-plugin';
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('GITHUB_TOKEN is required (the search API allows 30 requests a minute with one).');
  process.exit(1);
}
// Not listed, ever. See CONTRIBUTING.md.
const BLOCK = /jailbreak|purge|破甲|越狱|free[- ]?model|免费.*不限量/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let requests = 0;
async function search(from, to, page) {
  const q = `topic:${TOPIC} created:${from}..${to}`;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=100&page=${page}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(2150); // stay under 30 searches a minute
    requests++;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'dshsea-sync' } });
    if (res.ok) return res.json();
    const wait = res.status === 403 || res.status === 429 ? 65000 : 5000 * (attempt + 1);
    console.warn(`  HTTP ${res.status}, retrying in ${wait / 1000}s`);
    await sleep(wait);
  }
  throw new Error(`search failed for ${from}..${to} page ${page}`);
}

const iso = (ms) => `${new Date(ms).toISOString().slice(0, 19)}Z`;
const repos = new Map();
async function crawl(fromMs, toMs) {
  const first = await search(iso(fromMs), iso(toMs), 1);
  if (first.total_count > 1000 && toMs - fromMs > 1000) {
    const mid = Math.floor((fromMs + toMs) / 2 / 1000) * 1000;
    await crawl(fromMs, mid);
    await crawl(mid + 1000, toMs);
    return;
  }
  let items = first.items;
  for (let page = 1; ; page++) {
    for (const r of items) {
      if (r.private || r.disabled) continue;
      const text = `${r.full_name} ${r.description ?? ''} ${(r.topics ?? []).join(' ')}`;
      if (BLOCK.test(text)) continue;
      let d = (r.description ?? '').replace(/\s+/g, ' ').trim();
      if (d.length > 160) d = `${d.slice(0, 157).trimEnd()}…`;
      repos.set(r.full_name.toLowerCase(), [r.full_name, r.stargazers_count, r.created_at.slice(0, 10), d]);
    }
    if (page * 100 >= Math.min(first.total_count, 1000) || !items.length) break;
    items = (await search(iso(fromMs), iso(toMs), page + 1)).items;
  }
  console.log(`${iso(fromMs).slice(0, 16)} .. ${iso(toMs).slice(0, 16)}: ${first.total_count} (total ${repos.size}, ${requests} requests)`);
}

await crawl(Date.parse('2012-01-01T00:00:00Z'), Math.floor(Date.now() / 1000) * 1000);
if (repos.size < 100) {
  console.error(`Only ${repos.size} repos found; refusing to overwrite data/wild.json.`);
  process.exit(1);
}
// Oldest first, so the file diffs stay small as new repos are appended.
const list = [...repos.values()].sort((a, b) => a[2].localeCompare(b[2]) || a[0].localeCompare(b[0]));
fs.writeFileSync(out, `[\n${list.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`);
console.log(`Wrote ${list.length} repos to data/wild.json`);
