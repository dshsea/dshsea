# dshsea

**[dshsea.com](https://dshsea.com)** — the deep sea of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Every DeepSeek Harness plugin is a creature somewhere in a bottomless ocean: tens of thousands of them, 24 species, no two alike. Dive, light them up to discover them, and claim yours.

每个 DeepSeek Harness 插件都是无底深海里的一只生物。下潜、用灯照亮来发现它们，然后认领你的那一只。

## How it fills up

- **Wild creatures.** A weekly GitHub Action crawls every repo tagged `dsh-plugin` into `data/wild.json`. They all appear in the ocean automatically.
- **Claimed creatures.** Authors claim theirs by adding one YAML file under [`data/projects/`](data/projects) in a PR. Claimed creatures get a page, a share card, a badge and a species of their choice. See [CONTRIBUTING.md](CONTRIBUTING.md).

认领方式见 [CONTRIBUTING.md](CONTRIBUTING.md)：在 `data/projects/` 下加一个 YAML 文件并提 PR。

## Development

Static [Astro](https://astro.build) site, no backend. Requires Node 24 (see `.nvmrc`) and pnpm.

```sh
pnpm install
pnpm dev          # http://localhost:4321
pnpm build        # validates data, then builds to dist/
pnpm sync-stars   # refresh stars for claimed projects
GITHUB_TOKEN=... node scripts/sync-wild.mjs   # re-crawl all dsh-plugin repos (about 15 minutes)
```

| Path | What |
| --- | --- |
| `data/projects/*.yaml` | One file per claimed project |
| `data/wild.json` | Every crawled `dsh-plugin` repo: `[repo, stars, created, description]` |
| `data/stars.json` | Stars and creation dates, refreshed daily by a GitHub Action |
| `scripts/lib/load-projects.mjs` | Loader and validator shared by the site and CI |
| `src/components/ocean3d.ts` | The 3D ocean (three.js): diving, creature streaming, discovery log, interaction |
| `src/components/ocean-env.ts` | Its shaders, textures and sound |
| `src/pages/data/` | The ocean as static JSON chunks, fetched as you dive, plus the search index |
| `src/components/creatures3d.ts` | Procedural creature models and their shader |
| `src/components/ocean.ts` | Lightweight fallback for devices without WebGL2 (or `?2d`) |
| `src/components/viewer.ts` | Single-creature 3D viewer on project pages |
| `src/lib/species.ts` | Species, rarity and zone rules |
| `public/creatures/*.webp` | Still renders of each species, tinted per project. Regenerate with `pnpm render-species` after changing the models (needs `pnpm dev` running and Chrome installed) |
| `src/pages/og/`, `src/pages/badge/` | Share cards and README badges, generated at build time |

Deployed on Cloudflare: build command `pnpm build`, output directory `dist`.

---

Unofficial community project. Not affiliated with DeepSeek.
