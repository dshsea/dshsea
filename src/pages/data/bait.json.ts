// Which creatures bite on which bait: { baitId: [creature index, …] }. Loaded when someone first casts.
import type { APIRoute } from 'astro';
import { getCatalog } from '../../lib/projects';
import { BAITS, BAIT_CAP } from '../../lib/bait';
import { hashKey } from '../../lib/species';

export const GET: APIRoute = () => {
  const { entries } = getCatalog();
  const out: Record<string, number[]> = {};
  for (const [id, match] of BAITS) {
    const hits: number[] = [];
    entries.forEach((e, i) => {
      if (match.test(`${e.name} ${e.desc}`)) hits.push(i);
    });
    // Too many takers: claimed creatures and the biggest ones stay, the rest is a fixed sample.
    const score = (i: number) => (entries[i].slug ? 1e9 : 0) + entries[i].stars * 1000 + (hashKey(entries[i].key) % 1000);
    out[id] = hits.length > BAIT_CAP ? hits.sort((a, b) => score(b) - score(a)).slice(0, BAIT_CAP).sort((a, b) => a - b) : hits;
  }
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
};
