// The only server code on dshsea.com. Static files are served by Cloudflare before this runs.
// It handles three things:
//   /r/owner/repo  one landing page per repo, and
//   /u/owner       one page per GitHub owner: the Astro build emits each page once as a template full
//                  of __TOKENS__ plus a bucketed lookup, and this fills one into the other;
//   /api/*         bottles, the leaderboard and fishing counts, stored in D1 (see worker/schema.sql).

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
    ).bind(id, name, int(body.seen, 60000), int(body.species, 24), int(body.deepest, 5e6), int(body.ach, 16), now(), iph).run();
    const rank = await db
      .prepare('SELECT COUNT(*) + 1 AS r FROM scores WHERE hidden = 0 AND seen > (SELECT seen FROM scores WHERE id = ?)').bind(id).first();
    return json({ ok: true, rank: rank.r });
  }

  // ----- fishing: how many times each repo has been landed -----
  if (route === 'GET /api/catch') {
    const key = repoKey(url.searchParams.get('repo'));
    if (!key) return json({ error: 'bad request' }, 400);
    return json({ n: await caught(db, key) }, 200, { 'Cache-Control': 'public, max-age=60' });
  }
  if (route === 'GET /api/catch/top') {
    const { results } = await db.prepare('SELECT repo, n FROM catches ORDER BY n DESC, updated DESC LIMIT 8').all();
    return json(results, 200, { 'Cache-Control': 'public, max-age=60' });
  }
  if (route === 'POST /api/catch') {
    const key = repoKey(body.repo);
    // Only repos that are really in the ocean can be counted.
    if (!key || !(await lookup(env, url, 'r', 256, key))) return json({ error: 'not found' }, 404);
    const iph = await ipHash(request);
    const day = Math.floor(now() / DAY);
    // One visitor counts once per repo per day, and for at most 12 repos a day.
    const { n } = await db.prepare('SELECT COUNT(*) AS n FROM hooks WHERE iph = ?').bind(iph).first();
    const fresh = n < 12 && (await db.prepare('INSERT OR IGNORE INTO hooks (iph, repo, day) VALUES (?, ?, ?)').bind(iph, key, day).run()).meta.changes > 0;
    if (fresh) {
      await db.prepare('INSERT INTO catches (repo, n, updated) VALUES (?1, 1, ?2) ON CONFLICT(repo) DO UPDATE SET n = n + 1, updated = ?2').bind(key, now()).run();
      // The IP hash rotates daily, so older rows can never match again.
      if (Math.random() < 0.02) await db.prepare('DELETE FROM hooks WHERE day < ?').bind(day - 1).run();
    }
    return json({ n: Math.max(1, await caught(db, key)) });
  }
  const badge = request.method === 'GET' && url.pathname.match(/^\/api\/badge\/([^/]+\/[^/]+)\.svg$/);
  if (badge) {
    const key = repoKey(decode(badge[1]));
    if (!key) return json({ error: 'bad request' }, 400);
    return new Response(catchBadge(await caught(db, key)), { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=1800' } });
  }
  return json({ error: 'not found' }, 404);
}
const repoKey = (v) => {
  const key = String(v ?? '').toLowerCase();
  return /^[a-z0-9_.-]{1,60}\/[a-z0-9_.-]{1,110}$/.test(key) ? key : null;
};
const caught = async (db, key) => (await db.prepare('SELECT n FROM catches WHERE repo = ?').bind(key).first())?.n ?? 0;
// Same look as public/badge.svg.
function catchBadge(n) {
  const right = n ? `hooked ${n.toLocaleString('en-US')} time${n === 1 ? '' : 's'}` : 'not hooked yet';
  const W = Math.round(82 + right.length * 6.6 + 22);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="28" viewBox="0 0 ${W} 28" role="img" aria-label="dshsea: ${right}">
<title>How many times divers have fished this plugin out of the dshsea ocean</title>
<defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#0d3f7c"/><stop offset="1" stop-color="#04102a"/></linearGradient><clipPath id="r"><rect width="${W}" height="28" rx="14"/></clipPath></defs>
<g clip-path="url(#r)"><rect width="${W}" height="28" fill="url(#g)"/><rect width="82" height="28" fill="#6ef3d6"/></g>
<path d="M12 21c0-9 7-12 9.5-6.5" fill="none" stroke="#04102a" stroke-width="1.8" stroke-linecap="round"/>
<circle cx="21.5" cy="14.5" r="3.2" fill="#04102a"/>
<g font-family="Inter,Helvetica Neue,Arial,sans-serif" font-size="12"><text x="29" y="18.2" font-weight="700" fill="#04102a">dshsea</text><text x="93" y="18.2" fill="#dbe8ff">${right}</text></g>
</svg>`;
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
