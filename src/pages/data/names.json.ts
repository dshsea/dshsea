// Search index (about 360 KB gzipped for 30k repos): every creature's repo (or name), in depth order. Loaded when the sonar is first used.
import type { APIRoute } from 'astro';
import { getCatalog } from '../../lib/projects';

export const GET: APIRoute = () =>
  new Response(JSON.stringify(getCatalog().entries.map((e) => e.repo ?? e.name)), { headers: { 'Content-Type': 'application/json' } });
