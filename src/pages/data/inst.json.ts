// Which creatures are installable DSH plugins: { bits: base64 }, one bit per creature index. A few KB.
import type { APIRoute } from 'astro';
import { installBits } from '../../lib/projects';

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ bits: installBits() }), { headers: { 'Content-Type': 'application/json' } });
