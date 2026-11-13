// The only server code on dshsea.com. Static files are served by Cloudflare before this runs.
// It handles three things:
//   /r/owner/repo  one landing page per repo, and
//   /u/owner       one page per GitHub owner: the Astro build emits each page once as a template full
//                  of __TOKENS__ plus a bucketed lookup, and this fills one into the other;
//   /api/*         bottles and the leaderboard, stored in D1 (see worker/schema.sql).

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
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const htmlPage = (body) => new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });

async function lookup(env, url, dir, buckets, key) {
  const res = await env.ASSETS.fetch(new URL(`/data/${dir}/${hashKey(key) % buckets}.json`, url));
  return res.ok ? (await res.json())[key] ?? null : null;
}
/** Fills a template in one pass, so text that happens to contain a token is never expanded again. */
async function render(env, url, template, page, raw) {
  const tpl = await (await env.ASSETS.fetch(new URL(template, url))).text();
  return htmlPage(
    tpl
      .replace('<meta name="robots" content="noindex">', '')
      .replace(/__([A-Z_]+)__/g, (all, k) => (k in raw ? raw[k] : typeof page[k] === 'string' ? esc(page[k]) : all)),
  );
}
function decode(part) {
  try {
    return decodeURIComponent(part).toLowerCase();
  } catch {
    return null; // malformed escape
  }
}

// Keep in step with the row markup in src/pages/u/[owner].astro.
const ownerRows = (rows) =>
  rows.map(([name, path, species, tint, speciesName, rarity, stars, depth]) =>
    `<li data-rarity="${rarity}"><a href="${esc(path)}"><img class="creature" src="/creatures/${species}.webp" style="--tint:${tint}deg" alt="" loading="lazy"><b>${esc(name)}</b><span>${esc(speciesName)} · ★ ${stars} · ${depth}</span></a></li>`).join('');

// ---------- /api ----------
const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);
const BAND = 20000; // bottles are fetched in 20 km bands
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const int = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
/** A hash of the caller's IP that changes every day: enough to rate-limit, useless for tracking. */
async function ipHash(request) {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  const data = new TextEncoder().encode(`${ip}|${Math.floor(now() / DAY)}|dshsea`);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function api(request, env, url) {
  const db = env.DB;
  if (!db) return json({ error: 'storage is not configured' }, 503);
  const route = `${request.method} ${url.pathname}`;
  let body = {};
  if (request.method === 'POST') {
    // Only the site itself may write.
    if (request.headers.get('Origin') !== url.origin) return json({ error: 'forbidden' }, 403);
    try {
      body = await request.json();
    } catch {
      return json({ error: 'bad request' }, 400);
    }
  }

  if (route === 'GET /api/bottles') {
    const band = int(url.searchParams.get('band'), 1e6);
    const { results } = await db
      .prepare('SELECT id, depth, text, name, created FROM bottles WHERE hidden = 0 AND depth >= ? AND depth < ? ORDER BY created DESC LIMIT 60')
      .bind(band * BAND, (band + 1) * BAND).all();
    return json(results, 200, { 'Cache-Control': 'public, max-age=30' });
  }
  if (route === 'POST /api/bottles') {
    const text = clean(body.text, 140);
    const name = clean(body.name, 20) || 'a diver';
    const depth = int(body.depth, 5e6);
    if (text.length < 2) return json({ error: 'empty' }, 400);
    // No links: a bottle is a note, not an advert.
    if (/https?:|www\.|[a-z0-9-]+\.(com|net|org|io|cn|xyz|top|me|co|app|dev|ru|cc)\b/i.test(`${text} ${name}`)) return json({ error: 'links' }, 400);
    const iph = await ipHash(request);
    const { n } = await db.prepare('SELECT COUNT(*) AS n FROM bottles WHERE iph = ? AND created > ?').bind(iph, now() - DAY).first();
    if (n >= 5) return json({ error: 'limit' }, 429);
    const created = now();
    const res = await db.prepare('INSERT INTO bottles (depth, text, name, created, iph) VALUES (?, ?, ?, ?, ?)').bind(depth, text, name, created, iph).run();
    return json({ id: res.meta.last_row_id, depth, text, name, created });
  }
  if (route === 'POST /api/bottles/report') {
    // Three reports take a bottle out of the water until someone looks at it.
    await db.prepare('UPDATE bottles SET reports = reports + 1, hidden = CASE WHEN reports >= 2 THEN 1 ELSE hidden END WHERE id = ?').bind(int(body.id, 1e12)).run();
    return json({ ok: true });
  }
  if (route === 'GET /api/board') {
    const { results } = await db
      .prepare('SELECT name, seen, species, deepest, ach FROM scores WHERE hidden = 0 ORDER BY seen DESC, deepest DESC LIMIT 25').all();
    return json(results, 200, { 'Cache-Control': 'no-store' });
  }
  if (route === 'POST /api/score') {
    const id = String(body.id ?? '');
    const name = clean(body.name, 20);
    if (!/^[a-z0-9-]{16,40}$/.test(id) || name.length < 2 || /https?:|www\.|\.(com|net|org|io|cn)\b/i.test(name)) return json({ error: 'bad request' }, 400);
    const iph = await ipHash(request);
    const known = await db.prepare('SELECT 1 AS x FROM scores WHERE id = ?').bind(id).first();
    if (!known) {
      const { n } = await db.prepare('SELECT COUNT(*) AS n FROM scores WHERE iph = ? AND updated > ?').bind(iph, now() - DAY).first();
      if (n >= 3) return json({ error: 'limit' }, 429);
    }
    // Scores are self-reported, so only sanity limits apply; see README.
    await db.prepare(
      `INSERT INTO scores (id, name, seen, species, deepest, ach, updated, iph) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(id) DO UPDATE SET name = ?2, seen = MAX(seen, ?3), species = MAX(species, ?4), deepest = MAX(deepest, ?5), ach = MAX(ach, ?6), updated = ?7, iph = ?8`,
    ).bind(id, name, int(body.seen, 60000), int(body.species, 24), int(body.deepest, 5e6), int(body.ach, 15), now(), iph).run();
    const rank = await db
      .prepare('SELECT COUNT(*) + 1 AS r FROM scores WHERE hidden = 0 AND seen > (SELECT seen FROM scores WHERE id = ?)').bind(id).first();
    return json({ ok: true, rank: rank.r });
  }
  return json({ error: 'not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path.startsWith('/api/')) return api(request, env, url);
    // Repo and owner pages exist in English only.
    if (path.startsWith('/zh/r/') || path.startsWith('/zh/u/')) return Response.redirect(url.origin + path.slice(3), 301);
    const read = request.method === 'GET' || request.method === 'HEAD';

    const repo = read && path.match(/^\/r\/([^/]+)\/([^/]+)\/?$/);
    if (repo) {
      const key = decode(`${repo[1]}/${repo[2]}`);
      const page = key && (await lookup(env, url, 'r', 256, key));
      if (page) {
        if (page.P) return Response.redirect(`${url.origin}/p/${page.P}`, 301);
        if (path !== `/r/${key}`) return Response.redirect(`${url.origin}/r/${key}`, 301);
        return render(env, url, '/r/_template/', page, {
          NEIGHBOURS: page.N.map((r) => `<li><a href="/r/${esc(r.toLowerCase())}">${esc(r)}</a></li>`).join(''),
          JSON_LD: JSON.stringify({
            '@context': 'https://schema.org', '@type': 'SoftwareSourceCode', name: page.NAME, description: page.DESC,
            codeRepository: `https://github.com/${page.REPO}`,
            author: { '@type': 'Person', name: page.OWNER, url: `https://github.com/${page.OWNER}` },
          }).replace(/</g, '\\u003c'),
        });
      }
    }

    const owner = read && path.match(/^\/u\/([^/]+)\/?$/);
    if (owner) {
      const key = decode(owner[1]);
      const page = key && (await lookup(env, url, 'u', 64, key));
      if (page) {
        if (path !== `/u/${key}`) return Response.redirect(`${url.origin}/u/${key}`, 301);
        return render(env, url, '/u/_template/', page, { ROWS: ownerRows(page.L) });
      }
      // Nobody by that name in the ocean: back to the lookup form, which explains.
      if (key && /^[a-z0-9-]{1,40}$/.test(key)) return Response.redirect(`${url.origin}/u/?none=${key}`, 302);
    }
    // Anything else gets the static 404 page.
    return env.ASSETS.fetch(request);
  },
};
