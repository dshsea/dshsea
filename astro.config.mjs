import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://dshsea.com',
  output: 'static',
  trailingSlash: 'ignore',
  // The repo-page template is not a real page; its sitemaps are generated in src/pages/sitemap-repos-[n].xml.ts.
  integrations: [sitemap({ filter: (page) => !page.includes('_template') })],
});
