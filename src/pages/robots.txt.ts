import type { APIRoute } from 'astro';
import { getCatalog, ownerPages, SITE } from '../lib/projects';

export const GET: APIRoute = () => {
  const repoMaps = Math.max(1, Math.ceil(getCatalog().entries.filter((e) => e.repo && !e.slug).length / 10000));
  const lines = [
    'User-agent: *', 'Allow: /', 'Disallow: /r/_template/', 'Disallow: /u/_template/', 'Disallow: /api/', '',
    `Sitemap: ${SITE}/sitemap-index.xml`,
    ...Array.from({ length: repoMaps }, (_, n) => `Sitemap: ${SITE}/sitemap-repos-${n}.xml`),
    ...Array.from({ length: Math.max(1, Math.ceil(ownerPages().size / 10000)) }, (_, n) => `Sitemap: ${SITE}/sitemap-owners-${n}.xml`),
  ];
  return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain' } });
};
