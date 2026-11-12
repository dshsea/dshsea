// Sitemaps for the repo landing pages, which the Worker renders and @astrojs/sitemap therefore cannot see.
import type { APIRoute } from 'astro';
import { getCatalog, SITE } from '../lib/projects';

const PER = 10000;
const urls = () => getCatalog().entries.filter((e) => e.repo && !e.slug).map((e) => `${SITE}/r/${e.key}`);
export function getStaticPaths() {
  return Array.from({ length: Math.max(1, Math.ceil(urls().length / PER)) }, (_, n) => ({ params: { n: String(n) } }));
}
export const GET: APIRoute = ({ params }) => {
  const n = Number(params.n);
  const body = urls().slice(n * PER, (n + 1) * PER).map((u) => `<url><loc>${u.replace(/&/g, '&amp;')}</loc></url>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`, {
    headers: { 'Content-Type': 'application/xml' },
  });
};
