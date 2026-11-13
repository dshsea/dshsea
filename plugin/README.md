# dshsea-fish

Go fishing for DeepSeek Harness plugins, without leaving dsh.

dsh can install a plugin once you know its name, but it has no way to find one. [dshsea.com](https://dshsea.com) keeps every repo tagged `dsh-plugin` (30,000+) as a creature in an ocean and knows which of them really install. This plugin brings that into dsh in two ways.

**A fishing panel.** A round button with a hook appears at the right edge of the dsh client (web and desktop). Open it, say what you need as bait, and cast: every plugin that takes the bait is listed at once, best match first, each with its description, a button that copies its install command, and its repository. No limits and nothing to win first. If you feel like playing, "lucky cast" hooks one of the listed fish at random and you reel it in by hand without snapping the line.

**A tool for the agent**, `dshsea_fish`, so you can also just ask:

> fish me a plugin that reviews SQL migrations

The agent casts with a few keywords, reads what comes up, and tells you which ones fit and why, each with its repository link and install command.

## Install

```sh
dsh plugin --profile tui add "github:dshsea/dshsea#path:/plugin"
```

Swap `tui` for the profile you use (`web`, `headless`, …), then restart dsh.

## What it does, and does not do

- **It recommends; it never installs.** The panel copies the install command and the tool returns it as text. The plugins in the ocean are unreviewed community code, and the agent is told to show you the repository and let you decide.
- **Only installable plugins bite.** A repo has to declare a DSH bundle in its `package.json` to be caught.
- **Repeated casts bring up different fish**, best matches first.
- **Nothing found?** The agent points you at [dshsea.com/wishes](https://dshsea.com/wishes), where you can wish for the plugin and authors look for ideas.
- **Choosing a plugin is counted.** When you copy a plugin's install command or open its repository from the panel, or tell the agent which one you want, the plugin's page on dshsea.com shows it as hooked once more. That request carries the repository name and nothing else.

All data is read from static files on dshsea.com. The plugin has no dependencies and no configuration.

## Development

```sh
node tools/selftest.mjs "release notes"
```

runs the tool against the live site with a stand-in for the harness context. The search index it reads is built by [`src/lib/search.ts`](../src/lib/search.ts); the tokenizer there and in `lib/index.js` must stay the same.

---

**中文**：装上后 dsh 客户端右侧会出现一个鱼钩按钮，点开后说出需求、抛竿，所有咬钩的可安装插件会直接列出来，可以一键复制安装命令；想玩的话再点「手气一竿」自己收线。也可以在 dsh 里直接说「帮我钓一个做 SQL 迁移审查的插件」，agent 会去 dshsea.com 的三万多个插件里钓几个可安装的上来，告诉你哪个合适，并给出仓库地址和安装命令。它只推荐，不会替你安装。
