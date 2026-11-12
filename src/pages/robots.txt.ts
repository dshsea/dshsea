import type { APIRoute } from 'astro';
import { getCatalog, SITE } from '../lib/projects';

export const GET: APIRoute = () => {
  const repoMaps = Math.max(1, Math.ceil(getCatalog().entries.filter((e) => e.repo && !e.slug).length / 10000));
  const lines = [
    'User-agent: *', 'Allow: /', 'Disallow: /r/_template/', '',
    `Sitemap: ${SITE}/sitemap-index.xml`,
    ...Array.from({ length: repoMaps }, (_, n) => `Sitemap: ${SITE}/sitemap-repos-${n}.xml`),
  ];
  return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain' } });
};
