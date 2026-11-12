// The ocean, in depth order, CHUNK creatures per file. The browser fetches chunks as you dive.
import type { APIRoute } from 'astro';
import { getCatalog, chunkRows, CHUNK } from '../../../lib/projects';

export function getStaticPaths() {
  const chunks = Math.max(1, Math.ceil(getCatalog().entries.length / CHUNK));
  return Array.from({ length: chunks }, (_, n) => ({ params: { n: String(n) } }));
}
export const GET: APIRoute = ({ params }) =>
  new Response(JSON.stringify(chunkRows(Number(params.n))), { headers: { 'Content-Type': 'application/json' } });
