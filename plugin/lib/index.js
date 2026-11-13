/**
 * dshsea-fish: go fishing for DeepSeek Harness plugins.
 *
 * dsh has no built-in way to find a plugin you do not already know the name of. dshsea.com keeps
 * every repo tagged `dsh-plugin` as a creature in an ocean, and knows which of them really declare
 * a DSH bundle. This plugin gives the agent one tool, `dshsea_fish` (cast with a few words about
 * what the user needs, and it reels in a handful of installable plugins that fit), and gives the
 * user a fishing panel in the client that lists every match for a bait (client/client.js).
 *
 * It only recommends. Nothing is installed by this plugin: the tool returns the install command and
 * the user decides. The catalogue is unreviewed community code, and the tool says so.
 *
 * All data comes from static files on dshsea.com; the only write is a "this one was landed" counter.
 * No `@deepseek-ai/*` imports: a profile-installed plugin resolves modules from its own directory,
 * where the harness packages are not reachable, so everything goes through `ctx` and Node built-ins.
 */

export const name = 'dshsea-fish'

const SITE = 'https://dshsea.com'
const TOOL_NAME = 'dshsea_fish'
const CHUNK = 400
const SEARCH_BUCKETS = 64
const REPO_BUCKETS = 256
const TIMEOUT_MS = 12_000
const CACHE_MS = 30 * 60_000

/* ---------- shared with the site: keep in step with src/lib/search.ts and src/lib/species.ts ---------- */

function hashKey(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
const STOP = new Set(('dsh plugin plugins deepseek harness the and for with from that this your you are can not all any use using used via into ' +
  'its has have will more than out one new based support supports simple easy tool tools code ai llm 插件 一个 使用 支持 可以 工具 的插').split(' '))
export function tokenize(text) {
  const out = new Set()
  for (const word of String(text).toLowerCase().split(/[^a-z0-9一-鿿]+/)) {
    if (!word) continue
    for (const part of word.match(/[a-z0-9]+|[一-鿿]+/g) ?? []) {
      if (/^[a-z0-9]/.test(part)) {
        const w = part.length > 3 && part.endsWith('s') && !part.endsWith('ss') ? part.slice(0, -1) : part
        if (w.length >= 2 && w.length <= 24 && !/^\d+$/.test(w)) out.add(w)
      } else {
        for (let i = 0; i + 1 < part.length; i++) out.add(part.slice(i, i + 2))
      }
    }
  }
  return [...out].filter((w) => !STOP.has(w))
}

/* ---------- reading the ocean ---------- */

const cache = new Map()
async function getJson(path, signal) {
  const hit = cache.get(path)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data
  const res = await fetch(SITE + path, {
    headers: { accept: 'application/json', 'user-agent': 'dshsea-fish' },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`dshsea.com answered ${res.status} for ${path}`)
  const data = await res.json()
  cache.set(path, { at: Date.now(), data })
  if (cache.size > 80) cache.delete(cache.keys().next().value)
  return data
}

const fmtDepth = (index) => {
  const m = 260 + index * 32
  return m < 10000 ? `${m.toLocaleString('en-US')} m` : `${(m / 1000).toFixed(1)} km`
}
/** The profile this dsh was started with, for install commands. A guess when it cannot be read. */
function profileName() {
  // A profile-installed plugin lives in <DSH_HOME>/profiles/<name>/node_modules/, which names it.
  const here = /[\\/]profiles[\\/]([\w-]+)[\\/]node_modules[\\/]/.exec(decodeURIComponent(import.meta.url))
  if (here) return here[1]
  const argv = process.argv
  const at = argv.indexOf('--profile')
  if (at >= 0 && /^[\w-]+$/.test(argv[at + 1] ?? '')) return argv[at + 1]
  // `dsh web`: the profile is the first argument.
  if (/^[a-z][\w-]*$/.test(argv[2] ?? '') && argv[2] !== 'plugin') return argv[2]
  if (process.env.DSH_PROFILE && /^[\w-]+$/.test(process.env.DSH_PROFILE)) return process.env.DSH_PROFILE
  return process.versions.electron ? 'desktop' : 'tui'
}
const installCommand = (repo) => `dsh plugin --profile ${profileName()} add github:${repo}`

/** Ranks every installable plugin that takes the bait, best first. `tokens` is empty for no bait. */
async function rank(bait, signal) {
  const tokens = tokenize(bait).slice(0, 8)
  const score = new Map()
  if (tokens.length) {
    const lists = await Promise.all(tokens.map(async (t) => (await getJson(`/data/s/${hashKey(t) % SEARCH_BUCKETS}.json`, signal))[t] ?? []))
    lists.forEach((list) => {
      // Rarer words say more; a word's own list is already best-first.
      const weight = 1 + 3 / Math.sqrt(list.length || 1)
      list.forEach((i, at) => score.set(i, (score.get(i) ?? 0) + weight * (1 - at / (list.length * 4))))
    })
  }
  return { tokens, order: [...score.entries()].sort((a, b) => b[1] - a[1]).map(([i]) => i) }
}
/** A handful of installable plugins picked at random, for a cast with no bait. */
async function surprise(n, signal) {
  const { bits } = await getJson('/data/inst.json', signal)
  const bytes = Buffer.from(bits, 'base64')
  const all = []
  for (let i = 0; i < bytes.length * 8; i++) if (bytes[i >> 3] & (1 << (i & 7))) all.push(i)
  const out = new Set()
  for (let tries = 0; out.size < n && tries < n * 4 && all.length; tries++) out.add(all[Math.floor(Math.random() * all.length)])
  return [...out]
}
/** Everything worth saying about the creature at this index, or null when it is not a GitHub repo. */
async function describe(index, signal) {
  const rows = await getJson(`/data/c/${Math.floor(index / CHUNK)}.json`, signal)
  const row = rows[index % CHUNK]
  if (!row || typeof row[0] !== 'string' || row[0].startsWith('http')) return null
  const repo = row[0], key = repo.toLowerCase()
  // The repo's page data carries its species and rarity, already worked out by the site.
  const page = (await getJson(`/data/r/${hashKey(key) % REPO_BUCKETS}.json`, signal).catch(() => ({})))[key] ?? {}
  return {
    repo,
    description: row[2] || '',
    stars: row[1],
    species: page.SPECIES_NAME ?? 'Fish',
    rarity: page.RARITY_NAME ?? 'Common',
    // For the fishing panel only (client/client.js): which picture to show, and how to tint it.
    art: { species: page.SPECIES ?? 'fish', rarity: page.RARITY ?? 'common', tint: Number(page.TINT) || 0 },
    depth: fmtDepth(index),
    page: page.P ? `${SITE}/p/${page.P}` : `${SITE}/r/${key}`,
    github: `https://github.com/${repo}`,
    install: installCommand(repo),
  }
}

/**
 * The plain answer to "what is there for this?": the best matches in order, `limit` at a time from
 * `offset`. This is what the fishing panel lists. No bait gives a random handful.
 */
export async function search(bait, limit, offset, signal) {
  const { tokens, order } = await rank(bait, signal)
  if (tokens.length && !order.length) return { matched: false, total: 0, catches: [] }
  const picked = tokens.length ? order.slice(offset, offset + limit) : await surprise(limit, signal)
  const catches = (await Promise.all(picked.map((i) => describe(i, signal).catch(() => null)))).filter(Boolean)
  return { matched: true, total: tokens.length ? order.length : catches.length, catches }
}

/**
 * Casts for the agent: up to `count` matches, the best one first and a little luck among the next
 * few. `seen` holds indices already shown in this process, so a second cast with the same bait
 * brings up something else.
 */
export async function cast(bait, count, seen, signal) {
  const { tokens, order } = await rank(bait, signal)
  if (tokens.length && !order.length) return { matched: false, catches: [] }
  const pool = tokens.length ? order : await surprise(40, signal)
  const fresh = pool.filter((i) => !seen.has(i))
  const from = (fresh.length >= count ? fresh : pool).slice(0, Math.max(count * 4, 12))
  const picked = []
  while (picked.length < count && from.length) {
    const at = picked.length === 0 ? 0 : Math.floor(Math.random() ** 2 * from.length)
    picked.push(from.splice(at, 1)[0])
  }
  const catches = []
  for (const index of picked) {
    const c = await describe(index, signal)
    if (!c) continue
    seen.add(index)
    catches.push(c)
  }
  return { matched: true, catches }
}

/** Tells dshsea that the user landed this one. Best effort: a failure here is nobody's problem. */
export async function land(repo, signal) {
  const key = String(repo).toLowerCase().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '')
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(key)) return { ok: false, repo: key, hooked: 0 }
  try {
    const res = await fetch(`${SITE}/api/catch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dshsea-client': 'fish-plugin', 'user-agent': 'dshsea-fish' },
      body: JSON.stringify({ repo: key }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return { ok: false, repo: key, hooked: 0 }
    return { ok: true, repo: key, hooked: (await res.json()).n ?? 0 }
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    return { ok: false, repo: key, hooked: 0 }
  }
}

/* ---------- the tool ---------- */

const CAVEAT = 'These are unreviewed community plugins. Show the user the repository and let them decide; do not run the install command yourself unless they ask you to.'

function renderCatches(bait, catches) {
  const lines = catches.map((c, i) =>
    `${i + 1}. ${c.repo} — a ${c.rarity.toLowerCase()} ${c.species.toLowerCase()} from ${c.depth} down, ★ ${c.stars}\n` +
    `   ${c.description || '(no description)'}\n` +
    `   ${c.github}\n` +
    `   its page: ${c.page}\n` +
    `   install: ${c.install}`)
  return `${bait ? `Bait “${bait}”` : 'A surprise cast'} brought up ${catches.length}:\n\n${lines.join('\n\n')}\n\n${CAVEAT}\n` +
    `When the user picks one, call ${TOOL_NAME} again with land set to its owner/repo so the catch is counted.`
}

const definition = {
  name: TOOL_NAME,
  description: [
    'Go fishing for DeepSeek Harness (dsh) plugins on dshsea.com, an ocean of 30,000+ community plugins.',
    'Use it when the user wants to find, discover or be recommended a dsh plugin, or says they want to "fish".',
    '',
    'To cast: set `bait` to 2-5 keywords for what the user needs, e.g. "sql migration review" or "release notes changelog".',
    'Most plugin descriptions are in English or Chinese; use words in either. Leave `bait` empty for a surprise catch.',
    'The result is a few installable plugins, each with its repository, description, stars and install command.',
    'Read the descriptions, tell the user which ones fit their need and why, and keep the fishing flavour (species, rarity, depth) light.',
    'Cast again with different words if nothing fits; a repeated cast brings up different fish.',
    '',
    'To land: when the user chooses one, call again with `land` set to its "owner/repo". That only counts the catch on dshsea.com.',
    'This tool never installs anything. Give the user the install command; run it only if they ask.',
  ].join('\n'),
  parameters: {
    type: 'object',
    properties: {
      bait: { type: 'string', description: 'A few keywords for what the user needs. Empty for a surprise catch.' },
      count: { type: 'number', description: 'How many to bring up, 1 to 5. Default 3.' },
      land: { type: 'string', description: 'owner/repo of the plugin the user chose. Counts the catch; use instead of bait.' },
    },
    required: [],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        message: { type: 'string' },
        catches: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              repo: { type: 'string' }, description: { type: 'string' }, stars: { type: 'number' }, species: { type: 'string' },
              rarity: { type: 'string' }, depth: { type: 'string' }, page: { type: 'string' }, github: { type: 'string' }, install: { type: 'string' },
            },
            required: ['repo', 'description', 'stars', 'species', 'rarity', 'depth', 'page', 'github', 'install'],
          },
        },
      },
      required: ['message', 'catches'],
    },
    render: (_args, value) => [{ type: 'text', text: value.message }],
  },
}

export function apply(ctx) {
  /** Indices already shown since the plugin loaded, so repeated casts vary. */
  const seen = new Set()

  ctx.inject(['tools'], (toolsCtx) => {
    const tools = toolsCtx.get('tools')
    if (tools === undefined || tools === null) return
    const tool = {
      ...definition,
      async execute(args, exec) {
        const input = args !== null && typeof args === 'object' ? args : {}
        const signal = exec?.signal
        if (typeof input.land === 'string' && input.land.trim() !== '') {
          const res = await land(input.land.trim(), signal)
          const message = res.ok
            ? `Landed ${res.repo}. Divers have hooked it ${res.hooked} time${res.hooked === 1 ? '' : 's'} now.\nInstall: ${installCommand(res.repo)}\nIts page: ${SITE}/r/${res.repo}`
            : `Could not count that catch (dshsea.com did not recognise “${res.repo}”), but nothing else depends on it.\nInstall: ${installCommand(res.repo)}`
          return { message, catches: [] }
        }
        const bait = typeof input.bait === 'string' ? input.bait.trim().slice(0, 120) : ''
        const count = Math.max(1, Math.min(5, Math.round(Number(input.count) || 3)))
        if (seen.size > 400) seen.clear()
        const { matched, catches } = await cast(bait, count, seen, signal)
        if (!catches.length) {
          return {
            message: matched
              ? 'The line came back empty. Try again.'
              : `No installable plugin in the ocean takes the bait “${bait}”. Try other words (English or Chinese, 2-5 keywords). ` +
                `If it really does not exist yet, the user can wish for it at ${SITE}/wishes, where plugin authors look for ideas.`,
            catches: [],
          }
        }
        // `art` is for the panel; the tool's output schema does not carry it.
        return { message: renderCatches(bait, catches), catches: catches.map(({ art, ...c }) => c) }
      },
    }
    ctx.effect(() => tools.register(tool), 'dshsea-fish: dshsea_fish tool')
  })

  // ----- routes for the fishing panel (client/client.js) -----
  // The panel runs in the dsh client, which should not have to reach another origin itself, so it
  // asks this half to search, to report a plugin the user chose, and to fetch creature pictures.
  ctx.inject(['webServer'], (hostCtx) => {
    const server = hostCtx.get ? hostCtx.get('webServer') : hostCtx.webServer
    if (server === undefined || server === null || typeof server.register !== 'function') return
    const send = (response, status, body, type = 'application/json; charset=utf-8') => {
      try {
        response.writeHead(status, { 'content-type': type, 'cache-control': type.startsWith('image/') ? 'max-age=86400' : 'no-store' })
        response.end(body)
      } catch {
        /* the client went away */
      }
    }
    const route = (path, handler) =>
      hostCtx.effect(
        () =>
          server.register({
            kind: 'exact',
            path,
            handler: (request, response) => {
              if (request?.method && request.method !== 'GET') return send(response, 405, '{"error":"GET only"}')
              const query = new URL(request?.url ?? path, 'http://localhost').searchParams
              Promise.resolve(handler(query, response)).catch((e) => send(response, 502, JSON.stringify({ error: String(e?.message ?? e) })))
            },
          }),
        `dshsea-fish: ${path}`,
      )
    route('/dshsea-fish/search', async (query, response) => {
      const offset = Math.max(0, Math.min(240, Math.floor(Number(query.get('offset')) || 0)))
      const result = await search((query.get('bait') ?? '').trim().slice(0, 120), 8, offset)
      send(response, 200, JSON.stringify({ ...result, profile: profileName() }))
    })
    route('/dshsea-fish/land', async (query, response) => send(response, 200, JSON.stringify(await land(query.get('repo') ?? ''))))
    route('/dshsea-fish/creature', async (query, response) => {
      const species = query.get('s') ?? ''
      if (!/^[a-z]{2,20}$/.test(species)) return send(response, 400, '{"error":"bad species"}')
      const res = await fetch(`${SITE}/creatures/${species}.webp`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!res.ok) return send(response, 404, '{"error":"not found"}')
      send(response, 200, Buffer.from(await res.arrayBuffer()), 'image/webp')
    })
  })

  ctx.inject(['systemPrompt'], (promptCtx) => {
    const prompt = promptCtx.get('systemPrompt')
    if (prompt === undefined || prompt === null) return
    const text = [
      '## Finding dsh plugins (dshsea_fish)',
      `When the user wants to find or be recommended a DeepSeek Harness plugin, or asks to go fishing, call \`${TOOL_NAME}\` with a few keywords as bait.`,
      'Present the catches as recommendations: what each does and why it fits. Always show the repository link and the install command.',
      'The plugins are unreviewed community code. Never install one on your own initiative.',
      `When the user picks one, call \`${TOOL_NAME}\` with \`land\` set to its owner/repo.`,
    ].join('\n')
    promptCtx.effect(() => prompt.section({ name: 'dshsea-fish', order: 160, text }), 'dshsea-fish: prompt section')
  })
}
