// Lookup for owner pages (/u/owner), bucketed by a hash of the owner's name. Read by worker/index.js.
import type { APIRoute } from 'astro';
import { ownerPages, OWNER_BUCKETS, type OwnerPage } from '../../../lib/projects';
import { hashKey } from '../../../lib/species';

let buckets: Record<string, OwnerPage>[] | null = null;
function all() {
  if (buckets) return buckets;
  buckets = Array.from({ length: OWNER_BUCKETS }, () => ({}));
  for (const [key, page] of ownerPages()) buckets[hashKey(key) % OWNER_BUCKETS][key] = page;
  return buckets;
}
export function getStaticPaths() {
  return Array.from({ length: OWNER_BUCKETS }, (_, b) => ({ params: { b: String(b) } }));
}
export const GET: APIRoute = ({ params }) =>
  new Response(JSON.stringify(all()[Number(params.b)]), { headers: { 'Content-Type': 'application/json' } });
