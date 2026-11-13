# Claim your creature

Every public GitHub repo tagged [`dsh-plugin`](https://github.com/topics/dsh-plugin) already swims in the ocean on [dshsea.com](https://dshsea.com) as a **wild** creature. A weekly crawl picks up new ones on its own, so the first step is just to add that topic to your repo.

Every wild creature has a page at `dshsea.com/r/<owner>/<repo>` that links to the repo. You can put a badge in your README without claiming anything:

```md
[![on dshsea](https://dshsea.com/badge.svg)](https://dshsea.com/r/<owner>/<repo>)
```

**Claiming** a creature makes it yours. Claimed creatures get:

- their own page (`dshsea.com/p/<name>`), share card and README badge
- your own description, in English and optionally Chinese
- the species you pick
- a spell on the **welcome reef**: the eight most recently claimed creatures swim right under the surface, where every diver enters, with their names lit, and are listed on the home page until newer claims take their place

To claim, add one YAML file to [`data/projects/`](data/projects) and open a pull request. The quickest way is the **Claim it** button on a creature's card, or [dshsea.com/submit](https://dshsea.com/submit).

## The file

`data/projects/my-plugin.yaml` — the file name (lowercase letters, digits, dashes) becomes your URL.

```yaml
name: "My Plugin"
repo: owner/my-plugin   # GitHub repo. Not on GitHub? Use `url: https://example.com` instead.
category: tools
description: "One or two sentences on what it does (10-200 characters)."
added: 2026-11-12       # today
# optional
species: manta
description_zh: "中文简介"
x: your_x_handle
```

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | Up to 40 characters |
| `repo` or `url` | one of them | `owner/name`, or an `https://` URL |
| `category` | yes | `tools`, `ui`, `memory`, `skills`, `models`, `workflow`, `apps`, `fun` or `resources`. Used for filtering on the list page |
| `description` | yes | 10–200 characters |
| `added` | yes | `YYYY-MM-DD` |
| `species` | no | See below. Without it you keep the species you had in the wild |
| `description_zh`, `author`, `x` | no | Chinese description, display name, X handle |

## How a creature is made

- **Species.** Wild creatures get one by chance, from a pool that depends on stars: common (under 20), rare (20+), epic (1,000+). Claimed creatures can pick any of these with `species`: `fish`, `jellyfish`, `seahorse`, `pufferfish`, `eel`, `crab`, `starfish`, `shrimp`, `nudibranch`, `anglerfish`, `turtle`, `octopus`, `squid`, `cuttlefish`, `lionfish`, `sunfish`, `nautilus`, `shark`, `hammerhead`, `manta`, `narwhal`, `dolphin`, `swordfish`. At 100k+ stars every project becomes a whale; that one is earned, not picked.
- **Size** comes from stars.
- **Depth** comes from age and has no limit. The newest project swims 260 m down; each older one lives 32 m below the next. Every new plugin pushes the whole ocean a little deeper.
- **Colour, pattern and proportions** are derived from the repo name, so no two creatures look alike.

## House rules

- Plugins, tools, apps, tutorials and sites about DeepSeek Harness are all welcome.
- The project must be public and reachable, with a README or landing page that says what it does.
- One entry per project. No malware, no jailbreak kits, no paid-link farms. The crawl skips these too; if one slipped through, open an issue.
- A badge in your README is appreciated, never required. You will find it on your project page.
- Want your wild creature removed? Open an issue, or drop the `dsh-plugin` topic and it will be gone after the next crawl.

## Check locally (optional)

```sh
pnpm install
pnpm validate   # checks every file in data/projects
pnpm dev        # see your creature swim
```

More on running and deploying the site: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
