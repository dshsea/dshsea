// Sitemaps for the owner pages, which the Worker renders.
import type { APIRoute } from 'astro';
import { ownerPages, SITE } from '../lib/projects';

const PER = 10000;
export function getStaticPaths() {
  return Array.from({ length: Math.max(1, Math.ceil(ownerPages().size / PER)) }, (_, n) => ({ params: { n: String(n) } }));
}
export const GET: APIRoute = ({ params }) => {
  const n = Number(params.n);
  const body = [...ownerPages().keys()].slice(n * PER, (n + 1) * PER).map((k) => `<url><loc>${SITE}/u/${k}</loc></url>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`, {
    headers: { 'Content-Type': 'application/xml' },
  });
};
