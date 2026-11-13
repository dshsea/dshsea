// Checks which crawled repos are really installable DeepSeek Harness plugins, into data/bundles.json.
// DSH installs a package only when its package.json declares `dsh.bundle` (and is not private), so a
// repo tagged `dsh-plugin` is not necessarily one. Only the root package.json is read: a monorepo
// that keeps its bundles in workspaces shows up as "not found" here, not as broken.
// Each run checks every repo it has not seen, plus the ones checked longest ago, up to LIMIT.
//   GITHUB_TOKEN=... node scripts/sync-bundles.mjs [limit]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'data', 'bundles.json');
const wild = JSON.parse(fs.readFileSync(path.join(root, 'data', 'wild.json'), 'utf8'));
/** { "owner/repo": [date checked, npm package name or 0] } */
const known = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const LIMIT = Number(process.argv[2] ?? process.env.BUNDLE_LIMIT ?? 12000);
const CONCURRENCY = 16;
const token = process.env.GITHUB_TOKEN;
const today = new Date().toISOString().slice(0, 10);

const keys = wild.map((r) => r[0].toLowerCase());
const live = new Set(keys);
for (const k of Object.keys(known)) if (!live.has(k)) delete known[k]; // gone from the ocean
// Never-checked first, then the stalest.
const todo = keys.sort((a, b) => (known[a]?.[0] ?? '').localeCompare(known[b]?.[0] ?? '')).slice(0, LIMIT);

async function check(key) {
  const url = `https://raw.githubusercontent.com/${key}/HEAD/package.json`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(20000) });
      if (res.status === 404) return 0;
      if (res.ok) {
        try {
          const pkg = JSON.parse(await res.text());
          const patch = pkg?.dsh?.bundle?.patch;
          const declared = typeof patch === 'string' || (Array.isArray(patch) && patch.length > 0);
          return declared && pkg.private !== true && typeof pkg.name === 'string' ? pkg.name.slice(0, 214) : 0;
        } catch {
          return 0; // not JSON
        }
      }
      if (res.status !== 429 && res.status < 500) return undefined;
    } catch {
      /* network trouble: retry */
    }
    await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
  }
  return undefined; // unknown: keep whatever was known
}

let done = 0, failed = 0;
async function worker() {
  for (;;) {
    const key = todo.pop();
    if (!key) return;
    const result = await check(key);
    if (result === undefined) failed++;
    else known[key] = [today, result];
    if (++done % 1000 === 0) console.log(`${done} checked (${failed} failed)`);
  }
}
const total = todo.length;
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
if (total && failed > total * 0.5) {
  console.error(`${failed} of ${total} checks failed; refusing to write data/bundles.json.`);
  process.exit(1);
}
const sorted = Object.keys(known).sort();
fs.writeFileSync(file, `{\n${sorted.map((k) => `${JSON.stringify(k)}:${JSON.stringify(known[k])}`).join(',\n')}\n}\n`);
const yes = sorted.filter((k) => known[k][1]).length;
console.log(`Checked ${total} (${failed} failed). ${yes} of ${sorted.length} known repos declare a DSH bundle.`);
