# dshsea

[English](README.md) · **简体中文** · [日本語](README.ja.md) · [한국어](README.ko.md)

**[dshsea.com](https://dshsea.com)** —— [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的深海。

每个 DeepSeek Harness 插件都是无底深海里的一只生物：三万多只，24 个物种，没有两只一模一样。下潜，用灯照亮来识别它们，集齐图鉴，然后认领你的那一只。

[![黄昏的海面](docs/hero.jpg)](https://dshsea.com)

| | |
| --- | --- |
| [![](docs/shallow.jpg)](https://dshsea.com) | [![](docs/deep.jpg)](https://dshsea.com) |
| **下潜。** 滚轮、滑动，或者按住按钮一路坠落几公里。生物的名字默认隐藏，被你的灯或声呐照到才会显示。 | **看不到底。** 最新的插件游在 260 米，每老一个就再深 32 米。越往下，水色也在变。 |
| [![](docs/sonar.jpg)](https://dshsea.com) | [![](docs/card.jpg)](https://dshsea.com) |
| **声呐。** 按名字搜索任何一个插件，直接传送过去。 | **认识它。** 每只生物都链接到自己的仓库，显示还差多少 star 进化，作者可以认领。 |
| [![](docs/field-guide.jpg)](https://dshsea.com) | [![](docs/bounty.jpg)](https://dshsea.com) |
| **图鉴。** 24 个物种、15 个成就、排行榜，以及指向最近巨兽的追踪信号。 | **每日悬赏。** 每天一只，所有人目标相同。给你三条线索和 1 公里的水域。 |
| [![](docs/owner-card.jpg)](https://dshsea.com/u) | [![](docs/repo-page.jpg)](https://dshsea.com/r/victorgol/dsh-wallpaper) |
| **你的 GitHub 里住着什么？** `dshsea.com/u/<你>` 汇总你的所有生物，并生成一张可分享的卡片。 | **每个插件都有一页。** 所有带 `dsh-plugin` topic 的仓库都有 `dshsea.com/r/owner/repo`，并链接回仓库。 |

海里还有**钓鱼**（按需求选饵、抛竿、收线，钓上来一个可安装的插件；每个仓库页都显示它被钓起过多少次）、**许愿瓶**（许愿一个还不存在的插件，给别人的愿望投票，看[最想要的插件](https://dshsea.com/zh/wishes)）和**拍照模式**（按 `P`），把眼前的画面变成带说明的图片。

## 生物从哪来

- **野生生物。** 每周一次的 GitHub Action 会把所有带 `dsh-plugin` topic 的仓库抓进 `data/wild.json`，它们会自动出现在海里。
- **已认领的生物。** 作者在 [`data/projects/`](data/projects) 下加一个 YAML 文件并提 PR 即可认领。认领后拥有独立页面、分享卡片、徽章，还能自选物种。最新认领的 8 只还会出现在**迎新礁**：海面正下方、每个潜水员入水的地方，并在首页点名。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 参与

认领方式、文件格式和收录规则见 [CONTRIBUTING.md](CONTRIBUTING.md)。本地运行和部署见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)（英文）。
