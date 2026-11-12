// The only server code on dshsea.com. Static files are served by Cloudflare before this runs; it is
// reached for everything else, which means the repo landing pages: /r/owner/repo.
// The Astro build emits that page once, as a template full of __TOKENS__ (src/pages/r/[...repo].astro),
// plus a lookup spread over 256 files (src/pages/data/r/[b].json.ts). This fills one into the other.
const BUCKETS = 256;

// Must match hashKey() in src/lib/species.ts.
function hashKey(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    // Repo pages exist in English only.
    if (path.startsWith('/zh/r/')) return Response.redirect(url.origin + path.slice(3), 301);

    const m = path.match(/^\/r\/([^/]+)\/([^/]+)\/?$/);
    if (m && (request.method === 'GET' || request.method === 'HEAD')) {
      let key = null;
      try {
        key = decodeURIComponent(`${m[1]}/${m[2]}`).toLowerCase();
      } catch {
        /* malformed escape: fall through to the 404 page */
      }
      const bucket = key && (await env.ASSETS.fetch(new URL(`/data/r/${hashKey(key) % BUCKETS}.json`, url)));
      const page = bucket && bucket.ok ? (await bucket.json())[key] : null;
      if (page) {
        if (page.P) return Response.redirect(`${url.origin}/p/${page.P}`, 301);
        if (path !== `/r/${key}`) return Response.redirect(`${url.origin}/r/${key}`, 301);
        const template = await (await env.ASSETS.fetch(new URL('/r/_template/', url))).text();
        const raw = {
          NEIGHBOURS: page.N.map((r) => `<li><a href="/r/${esc(r.toLowerCase())}">${esc(r)}</a></li>`).join(''),
          JSON_LD: JSON.stringify({
            '@context': 'https://schema.org', '@type': 'SoftwareSourceCode', name: page.NAME, description: page.DESC,
            codeRepository: `https://github.com/${page.REPO}`,
            author: { '@type': 'Person', name: page.OWNER, url: `https://github.com/${page.OWNER}` },
          }).replace(/</g, '\\u003c'),
        };
        // One pass, so text that happens to contain a token (a description, say) is never expanded again.
        const html = template
          .replace('<meta name="robots" content="noindex">', '')
          .replace(/__([A-Z_]+)__/g, (all, k) => (k in raw ? raw[k] : typeof page[k] === 'string' ? esc(page[k]) : all));
        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
        });
      }
    }
    // Anything else gets the static 404 page.
    return env.ASSETS.fetch(request);
  },
};
