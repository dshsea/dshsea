// A static search index over the installable plugins, for clients that cannot download the whole
// catalogue: the dsh fishing plugin (plugin/lib/index.js) reads it. Tokens are spread over
// SEARCH_BUCKETS files by hash, each mapping token -> creature indices, best first.
// tokenize() and hashKey() are duplicated in the plugin: keep the two in step.
import { getCatalog } from './projects';
import { hashKey } from './species';

export const SEARCH_BUCKETS = 64;
const PER_TOKEN = 250;
// Words that say nothing in this ocean.
const STOP = new Set(('dsh plugin plugins deepseek harness the and for with from that this your you are can not all any use using used via into ' +
  'its has have will more than out one new based support supports simple easy tool tools code ai llm 插件 一个 使用 支持 可以 工具 的插').split(' '));

export function tokenize(text: string): string[] {
  const out = new Set<string>();
  for (const word of text.toLowerCase().split(/[^a-z0-9一-鿿]+/)) {
    if (!word) continue;
    for (const part of word.match(/[a-z0-9]+|[一-鿿]+/g) ?? []) {
      if (/^[a-z0-9]/.test(part)) {
        // Plurals fold into the singular.
        const w = part.length > 3 && part.endsWith('s') && !part.endsWith('ss') ? part.slice(0, -1) : part;
        if (w.length >= 2 && w.length <= 24 && !/^\d+$/.test(w)) out.add(w);
      } else {
        // Chinese has no spaces: index every pair of characters.
        for (let i = 0; i + 1 < part.length; i++) out.add(part.slice(i, i + 2));
      }
    }
  }
  return [...out].filter((w) => !STOP.has(w));
}

let buckets: Record<string, number[]>[] | null = null;
export function searchBuckets() {
  if (buckets) return buckets;
  const { entries } = getCatalog();
  const postings = new Map<string, number[]>();
  entries.forEach((e, i) => {
    if (!e.inst || !e.repo) return;
    for (const t of tokenize(`${e.repo} ${e.name} ${e.desc} ${e.descZh ?? ''}`)) {
      const list = postings.get(t);
      if (list) list.push(i);
      else postings.set(t, [i]);
    }
  });
  const score = (i: number) => (entries[i].slug ? 1e9 : 0) + entries[i].stars * 1000 + (hashKey(entries[i].key) % 1000);
  buckets = Array.from({ length: SEARCH_BUCKETS }, () => ({}));
  for (const [token, list] of postings) {
    // A word a tenth of the ocean uses tells nobody anything.
    if (list.length > entries.length / 10) continue;
    buckets[hashKey(token) % SEARCH_BUCKETS][token] = list.sort((a, b) => score(b) - score(a)).slice(0, PER_TOKEN);
  }
  return buckets;
}
