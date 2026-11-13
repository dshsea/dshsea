# dshsea

**English** · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md)

**[dshsea.com](https://dshsea.com)** — the deep sea of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Every DeepSeek Harness plugin is a creature somewhere in a bottomless ocean: more than 30,000 of them, 24 species, no two alike. Dive, light them up to identify them, fill your field guide, and claim yours.

[![The surface at dusk](docs/hero.jpg)](https://dshsea.com)

| | |
| --- | --- |
| [![](docs/shallow.jpg)](https://dshsea.com) | [![](docs/deep.jpg)](https://dshsea.com) |
| **Dive.** Scroll, swipe, or hold the button and fall for kilometres. Names stay hidden until your lamp or a sonar ping identifies a creature. | **No bottom in sight.** The newest plugin swims at 260 m; every older one lives 32 m deeper. The water changes colour as you go. |
| [![](docs/sonar.jpg)](https://dshsea.com) | [![](docs/card.jpg)](https://dshsea.com) |
| **Sonar.** Search every plugin by name and jump straight to it. | **Meet it.** Each creature links to its repo, shows how many stars it needs to evolve, and can be claimed by its author. |
| [![](docs/field-guide.jpg)](https://dshsea.com) | [![](docs/bounty.jpg)](https://dshsea.com) |
| **Field guide.** 24 species to collect, 15 achievements, a leaderboard, and a tracker that points at the nearest giant. | **Daily bounty.** One creature a day, the same for everyone. You get three clues and a 1 km stretch of water. |
| [![](docs/owner-card.jpg)](https://dshsea.com/u) | [![](docs/repo-page.jpg)](https://dshsea.com/r/victorgol/dsh-wallpaper) |
| **What lives in your GitHub?** `dshsea.com/u/<you>` gathers all of your creatures and draws a card to share. | **A page for every plugin.** `dshsea.com/r/owner/repo` exists for every repo tagged `dsh-plugin`, with a link back to it. |

Also in the water: **bottles** (leave a note at any depth for the next diver) and a **photo mode** (`P`) that turns what you see into a captioned picture.

## How it fills up

- **Wild creatures.** A weekly GitHub Action crawls every repo tagged `dsh-plugin` into `data/wild.json`. They all appear in the ocean automatically.
- **Claimed creatures.** Authors claim theirs by adding one YAML file under [`data/projects/`](data/projects) in a PR. Claimed creatures get a page, a share card, a badge and a species of their choice. The eight newest claims also swim on the **welcome reef**, right under the surface where every diver enters, and are named on the home page. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Contributing

Claiming a creature, the entry format and the house rules are in [CONTRIBUTING.md](CONTRIBUTING.md). Running the site yourself is covered in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
