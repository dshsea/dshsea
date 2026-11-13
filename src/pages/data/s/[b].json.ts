// The search index, one bucket per file: { token: [creature index, …] }. See src/lib/search.ts.
import type { APIRoute } from 'astro';
import { searchBuckets, SEARCH_BUCKETS } from '../../../lib/search';

export function getStaticPaths() {
  return Array.from({ length: SEARCH_BUCKETS }, (_, b) => ({ params: { b: String(b) } }));
}
export const GET: APIRoute = ({ params }) =>
  new Response(JSON.stringify(searchBuckets()[Number(params.b)]), { headers: { 'Content-Type': 'application/json' } });
