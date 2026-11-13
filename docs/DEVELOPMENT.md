# Development

[Astro](https://astro.build) site with one small Cloudflare Worker. Requires Node 24 (see `.nvmrc`) and pnpm.

```sh
pnpm install
pnpm dev          # http://localhost:4321 (no bottles or leaderboard: those need the Worker)
pnpm build        # validates data, then builds to dist/
npx wrangler d1 execute dshsea --local --file worker/schema.sql   # once, for local bottles and leaderboard
npx wrangler dev  # serves the build with the Worker, exactly as in production
pnpm sync-stars   # refresh stars for claimed projects
GITHUB_TOKEN=... node scripts/sync-wild.mjs   # re-crawl all dsh-plugin repos (about 15 minutes)
```

| Path | What |
| --- | --- |
| `data/projects/*.yaml` | One file per claimed project |
| `data/wild.json` | Every crawled `dsh-plugin` repo: `[repo, stars, created, description]` |
| `data/stars.json` | Stars for claimed projects, refreshed daily by a GitHub Action |
| `scripts/lib/load-projects.mjs` | Loader and validator shared by the site and CI |
| `src/components/ocean3d.ts` | The 3D ocean (three.js): diving, creature streaming, field guide, bounty, bottles, photo mode |
| `src/components/ocean-env.ts` | Its shaders, textures and sound |
| `src/components/creatures3d.ts` | Procedural creature models and their shader |
| `src/components/viewer.ts` | Single-creature 3D viewer on project pages |
| `src/components/ocean.ts` | Lightweight fallback for devices without WebGL2 (or `?2d`) |
| `src/lib/species.ts` | Species, rarity, evolution and zone rules |
| `src/pages/data/` | The ocean as static JSON chunks, the search index, and the lookups for repo and owner pages |
| `src/pages/r/[...repo].astro`, `src/pages/u/[owner].astro` | Landing pages for one repo and one owner. Built once as templates; the Worker fills them in per request, because there are more of them than a static host takes files |
| `src/pages/all/` | Paginated index of every plugin, for crawlers |
| `worker/index.js` | The only server code: renders `/r/*` and `/u/*`, and serves `/api/*` |
| `worker/schema.sql` | D1 tables for bottles and the leaderboard |
| `public/creatures/*.webp` | Still renders of each species. Regenerate with `pnpm render-species` after changing the models (needs `pnpm dev` running and Chrome) |
| `src/pages/og/`, `src/pages/badge/` | Share cards and README badges, generated at build time |

Deployed on Cloudflare Workers: `pnpm build`, then `npx wrangler deploy` (see `wrangler.jsonc`).

## Moderating bottles and the leaderboard

Bottles are limited to 140 characters, no links, five a day per visitor; three reports hide one automatically. Leaderboard scores are self-reported by the browser, so treat the board as a toy. To take something down by hand:

```sh
npx wrangler d1 execute dshsea --remote --command "UPDATE bottles SET hidden = 1 WHERE id = 123"
npx wrangler d1 execute dshsea --remote --command "UPDATE scores SET hidden = 1 WHERE name = 'someone'"
```
