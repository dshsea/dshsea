// Lookup for repo landing pages: repos are spread over REPO_BUCKETS files by a hash of their name,
// so the Worker can find any one of them by reading a single small file.
import type { APIRoute } from 'astro';
import { getCatalog, repoPage, REPO_BUCKETS, type RepoPage } from '../../../lib/projects';
import { hashKey } from '../../../lib/species';

let buckets: Record<string, RepoPage>[] | null = null;
function all() {
  if (buckets) return buckets;
  buckets = Array.from({ length: REPO_BUCKETS }, () => ({}));
  getCatalog().entries.forEach((e, i) => {
    if (e.repo) buckets![hashKey(e.key) % REPO_BUCKETS][e.key] = repoPage(i)!;
  });
  return buckets;
}
export function getStaticPaths() {
  return Array.from({ length: REPO_BUCKETS }, (_, b) => ({ params: { b: String(b) } }));
}
export const GET: APIRoute = ({ params }) =>
  new Response(JSON.stringify(all()[Number(params.b)]), { headers: { 'Content-Type': 'application/json' } });
