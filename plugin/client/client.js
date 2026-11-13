// dshsea-fish, client half: the fishing panel.
//
// A small round button sits at the edge of the dsh client. It opens a panel where you say what you
// need (the bait) and cast. Everything that takes the bait is listed at once, best match first:
// real, installable DeepSeek Harness plugins, each with its install command and repository. Finding
// the plugin is the point, so nothing stands between the cast and the list.
//
// The fishing game is the optional part: "lucky cast" hooks one of the listed fish at random and
// you reel it in by hand. It changes nothing about what you can find.
//
// The panel never talks to another origin: it asks the host half (lib/index.js) through three
// routes, /dshsea-fish/search, /land and /creature. Nothing is installed from here; the install
// command is copied to the clipboard for the user to run.

window.__ModuleLoader__.load({
  id: 'dshsea-fish',
  factory: () => {
    const zh = (navigator.language || '').toLowerCase().startsWith('zh')
    const T = zh
      ? {
          open: '去钓鱼', title: '去钓鱼', sub: '说出你的需求当饵，抛竿，看看哪些 dsh 插件咬钩。',
          baits: [['', '随便来点'], ['code review', '代码审查'], ['test', '测试'], ['git commit release', 'Git 与发版'], ['docs markdown', '文档写作'], ['sql database', '数据与 SQL'],
            ['frontend react ui', '前端'], ['docker deploy', '运维部署'], ['security', '安全'], ['agent workflow', 'Agent 与工作流'], ['game fun', '纯属好玩']],
          custom: '你需要什么？例如：sql 迁移审查', cast: '抛竿', casting: '线放下去了……', bites: '{n} 条鱼咬了「{q}」', bitesAny: '随手一竿，捞上来 {n} 条', more: '再捞一些', lucky: '手气一竿', luckyTip: '从这批鱼里随机钓一条，自己收线', waiting: '线已经放下去了，等着……', waitBtn: '等待中…', bite: '咬钩了！快提竿！', strike: '提竿！',
          reelHint: '按住收线。线快绷断时松手，它挣扎时也要松一松。', reel: '按住收线', tension: '鱼线张力',
          lost: { slow: '慢了一步，它吃完饵走了。', snap: '线断了。', away: '它吐掉钩子跑了。' }, teaser: '那是一只{rarity}的{species}。',
          none: '这片海里还没有鱼吃「{q}」这个饵。', noneTip: '换几个关键词试试，中英文都可以。真的没有的话，可以去许个愿。', wish: '去许愿', fail: '线空着回来了：{e}', again: '再来一竿', back: '回到列表',
          hooked: '已被潜水员钓起 {n} 次', install: '安装命令', copy: '复制安装命令', copied: '已复制，粘贴到终端执行', restart: '装完重启 dsh 生效。这些是未经审核的社区插件，装之前先看看仓库。',
          github: 'GitHub ↗', page: 'dshsea 页面 ↗', from: '来自 {depth} 深处',
        }
      : {
          open: 'Go fishing', title: 'Go fishing', sub: 'Say what you need as bait, cast, and see which dsh plugins bite.',
          baits: [['', 'Surprise me'], ['code review', 'Code review'], ['test', 'Testing'], ['git commit release', 'Git & releases'], ['docs markdown', 'Docs & writing'], ['sql database', 'Data & SQL'],
            ['frontend react ui', 'Frontend'], ['docker deploy', 'DevOps'], ['security', 'Security'], ['agent workflow', 'Agents & workflows'], ['game fun', 'Just for fun']],
          custom: 'What do you need? e.g. sql migration review', cast: 'Cast', casting: 'Line is out…', bites: '{n} took the bait “{q}”', bitesAny: 'A blind cast brought up {n}', more: 'Bring up more', lucky: 'Lucky cast', luckyTip: 'Hook one of these at random and reel it in yourself', waiting: 'Line is out. Wait for it…', waitBtn: 'Waiting…', bite: 'A bite! Strike now!', strike: 'Strike!',
          reelHint: 'Hold to reel in. Let go before the line snaps, and ease off when it thrashes.', reel: 'Hold to reel', tension: 'Line tension',
          lost: { slow: 'Too slow. It took the bait and left.', snap: 'The line snapped.', away: 'It spat the hook and got away.' }, teaser: 'It was a {rarity} {species}.',
          none: 'No fish in this sea takes “{q}” yet.', noneTip: 'Try other keywords, in English or Chinese. If it really does not exist, wish for it.', wish: 'Wish for it', fail: 'The line came back empty: {e}', again: 'Cast again', back: 'Back to the list',
          hooked: 'Hooked by divers: {n}×', install: 'Install command', copy: 'Copy install command', copied: 'Copied: paste it in a terminal', restart: 'Restart dsh after installing. These are unreviewed community plugins: look at the repository first.',
          github: 'GitHub ↗', page: 'dshsea page ↗', from: 'from {depth} down',
        }

    const CSS = `
      .dsf-fab{position:fixed;right:18px;bottom:108px;z-index:2147483000;width:44px;height:44px;border-radius:50%;border:1px solid rgba(110,243,214,.5);cursor:pointer;
        background:linear-gradient(160deg,#0d3f7c,#04102a);color:#6ef3d6;box-shadow:0 8px 24px rgba(0,0,0,.35);display:grid;place-items:center;transition:transform .2s}
      .dsf-fab:hover{transform:scale(1.08)}
      .dsf-panel{position:fixed;right:18px;bottom:162px;z-index:2147483001;width:min(460px,calc(100vw - 24px));max-height:calc(100vh - 190px);overflow:auto;
        background:#081229;color:#eaf2ff;border:1px solid rgba(170,205,255,.28);border-radius:20px;padding:20px;box-shadow:0 30px 80px rgba(0,0,0,.55);
        font:14px/1.5 Inter,system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;animation:dsf-in .25s ease-out}
      @keyframes dsf-in{from{opacity:0;transform:translateY(10px)}}
      .dsf-panel *{box-sizing:border-box}
      .dsf-panel h2{font:400 26px/1.1 "Instrument Serif",Georgia,"Songti SC",serif;margin:0 30px 4px 0;color:#fff}
      .dsf-sub{color:#93a8c9;font-size:13px;margin:0 0 14px}
      .dsf-x{position:absolute;top:12px;right:12px;width:28px;height:28px;border-radius:50%;border:0;cursor:pointer;background:rgba(255,255,255,.08);color:#93a8c9;font-size:16px;line-height:1}
      .dsf-x:hover{color:#fff;background:rgba(255,255,255,.16)}
      .dsf-chips{display:flex;flex-wrap:wrap;gap:6px}
      .dsf-chips button{font:500 12px inherit;font-family:inherit;color:#eaf2ff;cursor:pointer;padding:6px 11px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(170,205,255,.28)}
      .dsf-chips button:hover{background:rgba(255,255,255,.12)}
      .dsf-chips button[aria-pressed=true]{color:#03131f;background:#6ef3d6;border-color:#6ef3d6}
      .dsf-input{display:block;width:100%;margin-top:10px;font:14px inherit;font-family:inherit;color:#eaf2ff;outline:none;background:rgba(2,7,20,.6);border:1px solid rgba(170,205,255,.28);border-radius:12px;padding:9px 12px}
      .dsf-input:focus{border-color:#6ef3d6}
      .dsf-btn{display:inline-flex;align-items:center;justify-content:center;font:600 14px inherit;font-family:inherit;color:#03131f;cursor:pointer;border:0;border-radius:999px;padding:11px 20px;
        background:linear-gradient(135deg,#8af7df,#6cc8ff);text-decoration:none;user-select:none;-webkit-user-select:none;touch-action:none}
      .dsf-btn:disabled{opacity:.45;cursor:default}
      .dsf-btn.dsf-alt{color:#eaf2ff;background:rgba(255,255,255,.1);box-shadow:inset 0 0 0 1px rgba(255,255,255,.2);font-weight:500;padding:8px 14px;font-size:13px}
      .dsf-wide{width:100%;margin-top:14px;padding:14px}
      .dsf-held{filter:brightness(.85);transform:scale(.98)}
      .dsf-pond{--pull:0;position:relative;height:170px;border-radius:14px;overflow:hidden;border:1px solid rgba(170,205,255,.2);background:linear-gradient(#1b86b4 0,#0f5c96 26%,#0a2f66 62%,#050f2a 100%)}
      .dsf-pond::before{content:"";position:absolute;left:0;right:0;top:30px;height:2px;background:rgba(255,255,255,.35)}
      .dsf-line{position:absolute;left:50%;top:0;width:1px;height:30px;background:rgba(255,255,255,.7)}
      .dsf-bobber{position:absolute;left:50%;top:22px;width:12px;height:16px;margin-left:-6px;border-radius:50% 50% 46% 46%;background:linear-gradient(#ff6b5e 50%,#fff 50%);animation:dsf-bob 2.4s ease-in-out infinite}
      @keyframes dsf-bob{50%{transform:translateY(3px) rotate(4deg)}}
      [data-dsf=bite] .dsf-bobber{animation:dsf-tug .28s ease-in-out infinite}
      [data-dsf=reel] .dsf-bobber{animation:none;transform:translateY(9px)}
      @keyframes dsf-tug{50%{transform:translateY(12px)}}
      .dsf-shadow{position:absolute;left:50%;top:104px;width:120px;height:60px;margin-left:-60px;object-fit:contain;filter:brightness(0) blur(1.5px);opacity:.5;
        transform:translateY(calc(var(--pull) * -62px)) scale(calc(.8 + var(--pull) * .35));animation:dsf-lurk 3s ease-in-out infinite}
      @keyframes dsf-lurk{50%{margin-left:-44px}}
      .dsf-surge{border-color:rgba(255,140,120,.8)}
      .dsf-surge .dsf-shadow{animation:dsf-thrash .16s linear infinite;opacity:.75}
      @keyframes dsf-thrash{0%{margin-left:-70px}50%{margin-left:-50px}100%{margin-left:-70px}}
      .dsf-status{margin:12px 0 8px;min-height:1.5em}
      [data-dsf=bite] .dsf-status{color:#f5d27a;font-weight:600}
      .dsf-meters{display:grid;gap:5px;font-size:10px;color:#93a8c9;letter-spacing:.14em;text-transform:uppercase}
      .dsf-panel:not([data-dsf=reel]) .dsf-meters{visibility:hidden}
      .dsf-meter{height:10px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden}
      .dsf-meter i{display:block;height:100%;width:0;border-radius:999px;background:#6ef3d6}
      .dsf-meter i[data-level=mid]{background:#f5d27a}
      .dsf-meter i[data-level=high]{background:#ff6b5e}
      .dsf-meter.dsf-prog{height:4px}
      .dsf-meter.dsf-prog i{background:#6cc8ff}
      [data-dsf=bite] .dsf-act{animation:dsf-pulse .5s ease-in-out infinite}
      @keyframes dsf-pulse{50%{transform:scale(1.03)}}
      .dsf-head{display:flex;align-items:center;gap:14px;margin:4px 0 10px}
      .dsf-head img{width:120px;height:90px;object-fit:contain;flex:none;animation:dsf-land .6s cubic-bezier(.2,1.4,.4,1)}
      @keyframes dsf-land{from{transform:translateY(50px) scale(.6);opacity:0}}
      .dsf-chip{display:inline-block;font-size:11px;font-weight:500;line-height:1;padding:5px 9px;border-radius:999px;color:#93a8c9;background:rgba(160,200,255,.1)}
      .dsf-chip[data-rarity=rare]{color:#9ad6ff;background:rgba(110,190,255,.14)}
      .dsf-chip[data-rarity=epic]{color:#dcb4ff;background:rgba(190,130,255,.16)}
      .dsf-chip[data-rarity=legendary]{color:#f5d27a;background:rgba(245,210,122,.15)}
      .dsf-name{font:400 22px/1.15 "Instrument Serif",Georgia,"Songti SC",serif;margin:6px 0 2px;overflow-wrap:anywhere;color:#fff}
      .dsf-meta{color:#f5d27a;font-size:12px;margin:0}
      .dsf-desc{color:#c9d9f0;font-size:13px;margin:0 0 8px;max-height:6.2em;overflow:auto;overflow-wrap:anywhere}
      .dsf-count{color:#6ef3d6;font-size:12px;margin:0 0 10px;min-height:1.4em}
      .dsf-label{font-size:10px;color:#93a8c9;letter-spacing:.14em;text-transform:uppercase;margin:0 0 4px}
      .dsf-install{display:flex;align-items:center;gap:8px;padding:7px 7px 7px 11px;border-radius:12px;background:rgba(2,7,20,.6);border:1px solid rgba(170,205,255,.2)}
      .dsf-install code{flex:1;min-width:0;font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:#c9f7ec;overflow-x:auto;white-space:nowrap;scrollbar-width:none}
      .dsf-note{font-size:11.5px;color:#93a8c9;margin:6px 0 12px}
      .dsf-row{display:flex;flex-wrap:wrap;gap:8px}
      .dsf-center{text-align:center;padding:18px 0 4px}
      .dsf-search{display:flex;gap:8px;margin-bottom:10px}
      .dsf-search .dsf-input{margin:0;flex:1;min-width:0}
      .dsf-search .dsf-btn{flex:none}
      .dsf-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:14px 0 8px;font-size:12px;color:#93a8c9}
      .dsf-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
      .dsf-item{display:grid;grid-template-columns:54px 1fr;gap:4px 12px;padding:11px 12px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(170,205,255,.16);animation:dsf-in .3s ease-out backwards}
      .dsf-item img{grid-row:1 / span 2;width:54px;height:42px;object-fit:contain;align-self:center}
      .dsf-item b{font-weight:600;color:#fff;overflow-wrap:anywhere}
      .dsf-item small{color:#f5d27a;font-weight:400;margin-left:6px;white-space:nowrap}
      .dsf-item p{margin:0;font-size:12.5px;color:#c9d9f0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
      .dsf-item .dsf-row{grid-column:1 / -1;margin-top:6px}
      .dsf-item .dsf-btn{padding:6px 12px;font-size:12px}
      .dsf-foot{display:flex;justify-content:center;margin-top:12px}
      .dsf-big{font:400 24px/1.2 "Instrument Serif",Georgia,"Songti SC",serif;color:#f5d27a;margin:0 0 6px}
      @media (prefers-reduced-motion:reduce){.dsf-bobber,.dsf-shadow,.dsf-head img,.dsf-act{animation:none!important}}
    `
    const RANK = { common: 0, rare: 1, epic: 2, legendary: 3 }
    const el = (tag, cls, text) => {
      const node = document.createElement(tag)
      if (cls) node.className = cls
      if (text !== undefined) node.textContent = text
      return node
    }
    const api = (path) => fetch(path, { headers: { accept: 'application/json' }, cache: 'no-store' }).then(async (r) => {
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      return body
    })
    const creature = (species) => `/dshsea-fish/creature?s=${encodeURIComponent(species)}`
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

    function mount() {
      const fab = el('button', 'dsf-fab')
      fab.type = 'button'
      fab.title = T.open
      fab.setAttribute('aria-label', T.open)
      fab.innerHTML = '<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M9 1.5v8.2a3 3 0 1 1-6 0V8.5M9 1.5l4 2.5-4 1.5"/></svg>'
      document.body.appendChild(fab)

      let panel = null, state = 'idle', run = 0, cur = null, profile = ''
      let hold = false, tension = 0, progress = 0, elapsed = 0, slack = 0, surgeEnd = 0, nextSurge = 0, last = 0, biteTimer = 0
      let body, act, pond, shadow, statusEl, tensionEl, progressEl, customEl, listBox

      const set = (s) => {
        state = s
        if (panel) panel.dataset.dsf = s
      }
      function close() {
        run++
        clearTimeout(biteTimer)
        hold = false
        panel?.remove()
        panel = null
        state = 'idle'
      }
      function open() {
        if (panel) return close()
        query = ''
        results = []
        total = 0
        panel = el('section', 'dsf-panel')
        panel.setAttribute('role', 'dialog')
        panel.setAttribute('aria-label', T.title)
        const x = el('button', 'dsf-x', '×')
        x.type = 'button'
        x.addEventListener('click', close)
        body = el('div')
        panel.append(x, el('h2', '', T.title), body)
        document.body.appendChild(panel)
        showSetup()
      }
      fab.addEventListener('click', open)

      // ----- say what you need, cast, and read the list -----
      let query = '', results = [], total = 0, loading = false
      function showSetup() {
        set('idle')
        const form = el('form', 'dsf-search')
        customEl = el('input', 'dsf-input')
        customEl.maxLength = 60
        customEl.placeholder = T.custom
        customEl.value = query
        const go = el('button', 'dsf-btn', T.cast)
        form.append(customEl, go)
        form.addEventListener('submit', (e) => {
          e.preventDefault()
          void find(customEl.value.trim())
        })
        const chips = el('div', 'dsf-chips')
        for (const [value, label] of T.baits) {
          const b = el('button', '', label)
          b.type = 'button'
          b.addEventListener('click', () => {
            customEl.value = value
            void find(value)
          })
          chips.append(b)
        }
        listBox = el('div')
        body.replaceChildren(el('p', 'dsf-sub', T.sub), form, chips, listBox)
        if (results.length) renderList()
        else customEl.focus()
      }
      const land = (c) => api(`/dshsea-fish/land?repo=${encodeURIComponent(c.repo)}`).catch(() => null)
      const copyButton = (c) => {
        const copy = el('button', 'dsf-btn', T.copy)
        copy.type = 'button'
        copy.addEventListener('click', () => {
          const command = `dsh plugin --profile ${profile || 'tui'} add github:${c.repo}`
          void navigator.clipboard?.writeText(command).then(() => {
            copy.textContent = T.copied
            setTimeout(() => (copy.textContent = T.copy), 1800)
          })
          void land(c) // choosing a plugin is what counts as hooking it
        })
        return copy
      }
      const linkButton = (label, href, c) => {
        const a = el('a', 'dsf-btn dsf-alt', label)
        a.href = href
        a.target = '_blank'
        a.rel = 'noopener'
        if (c) a.addEventListener('click', () => void land(c))
        return a
      }
      function item(c, at) {
        const li = el('li', 'dsf-item')
        li.style.animationDelay = `${Math.min(at, 8) * 45}ms`
        const img = el('img')
        img.alt = ''
        img.loading = 'lazy'
        img.src = creature(c.art.species)
        img.style.filter = `hue-rotate(${c.art.tint}deg)`
        img.title = `${c.species} · ${c.rarity} · ${T.from.replace('{depth}', c.depth)}`
        const name = el('b', '', c.repo)
        name.append(el('small', '', `★ ${c.stars.toLocaleString('en-US')}`))
        const row = el('div', 'dsf-row')
        row.append(copyButton(c), linkButton(T.github, c.github, c), linkButton(T.page, c.page))
        li.append(img, name, el('p', '', c.description || '—'), row)
        return li
      }
      function renderList() {
        const bar = el('div', 'dsf-bar')
        bar.append(el('span', '', (query ? T.bites.replace('{q}', query) : T.bitesAny).replace('{n}', String(query ? total : results.length))))
        const lucky = el('button', 'dsf-btn dsf-alt', `🎣 ${T.lucky}`)
        lucky.type = 'button'
        lucky.title = T.luckyTip
        lucky.addEventListener('click', () => void luckyCast())
        bar.append(lucky)
        const list = el('ul', 'dsf-list')
        results.forEach((c, at) => list.append(item(c, at % 8)))
        const out = [bar, list]
        if (!query || results.length < total) {
          const foot = el('div', 'dsf-foot')
          const more = el('button', 'dsf-btn dsf-alt', T.more)
          more.type = 'button'
          more.addEventListener('click', () => void find(query, true))
          foot.append(more)
          out.push(foot)
        }
        out.push(el('p', 'dsf-note', T.restart))
        listBox.replaceChildren(...out)
      }
      async function find(text, more = false) {
        if (loading) return
        loading = true
        const me = ++run
        if (!more) {
          query = text.slice(0, 60)
          results = []
          total = 0
          listBox.replaceChildren(el('p', 'dsf-status', T.casting))
        }
        try {
          const r = await api(`/dshsea-fish/search?bait=${encodeURIComponent(query)}&offset=${query ? results.length : 0}`)
          if (me !== run || !panel) return
          profile = r.profile || profile
          if (r.matched === false) {
            const box = el('div', 'dsf-center')
            box.append(el('p', 'dsf-big', T.none.replace('{q}', query)), el('p', 'dsf-sub', T.noneTip), linkButton(T.wish, `https://dshsea.com/${zh ? 'zh/' : ''}wishes`))
            return listBox.replaceChildren(box)
          }
          const known = new Set(results.map((c) => c.repo))
          results = results.concat(r.catches.filter((c) => !known.has(c.repo)))
          total = Math.max(r.total, results.length)
          renderList()
        } catch (e) {
          if (me === run && panel) listBox.replaceChildren(el('p', 'dsf-status', T.fail.replace('{e}', e.message)))
        } finally {
          loading = false
        }
      }

      function showPlay() {
        pond = el('div', 'dsf-pond')
        shadow = el('img', 'dsf-shadow')
        shadow.alt = ''
        shadow.hidden = true
        pond.append(el('i', 'dsf-line'), el('i', 'dsf-bobber'), shadow)
        statusEl = el('p', 'dsf-status', T.waiting)
        statusEl.setAttribute('role', 'status')
        const meters = el('div', 'dsf-meters')
        const m1 = el('div', 'dsf-meter'), m2 = el('div', 'dsf-meter dsf-prog')
        tensionEl = el('i')
        progressEl = el('i')
        m1.append(tensionEl)
        m2.append(progressEl)
        meters.append(el('span', '', T.tension), m1, m2)
        act = el('button', 'dsf-btn dsf-wide dsf-act', T.waitBtn)
        act.type = 'button'
        act.disabled = true
        act.addEventListener('pointerdown', (e) => {
          if (state !== 'reel') return
          act.setPointerCapture(e.pointerId)
          press(true)
        })
        for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) act.addEventListener(ev, () => press(false))
        act.addEventListener('click', () => {
          if (state === 'bite') strike()
        })
        act.addEventListener('contextmenu', (e) => e.preventDefault())
        body.replaceChildren(pond, statusEl, meters, act)
      }
      const press = (down) => {
        if (state === 'reel') hold = down
        act?.classList.toggle('dsf-held', state === 'reel' && down)
      }

      // ----- lucky cast: the optional game. One of the listed fish, at random, reeled in by hand. -----
      async function luckyCast() {
        if (!results.length || (state !== 'idle' && state !== 'result' && state !== 'lost')) return
        const me = ++run
        const c = results[Math.floor(Math.random() * results.length)]
        cur = null
        showPlay()
        set('wait')
        shadow.src = creature(c.art.species)
        shadow.hidden = false
        await sleep(1200 + Math.random() * 1800)
        if (me !== run || state !== 'wait') return
        cur = c
        set('bite')
        statusEl.textContent = T.bite
        act.disabled = false
        act.textContent = T.strike
        act.focus()
        biteTimer = setTimeout(() => {
          if (me === run && state === 'bite') lose('slow')
        }, 1800 - (RANK[c.art.rarity] ?? 0) * 150)
      }

      function strike() {
        clearTimeout(biteTimer)
        set('reel')
        statusEl.textContent = T.reelHint
        act.textContent = T.reel
        hold = false
        tension = 0.3
        progress = 0.12
        elapsed = slack = surgeEnd = 0
        nextSurge = 1.4
        last = performance.now()
        requestAnimationFrame(tick)
      }
      function tick(now) {
        if (state !== 'reel' || !cur || !panel) return
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now
        elapsed += dt
        const r = RANK[cur.art.rarity] ?? 0
        if (elapsed > nextSurge) {
          surgeEnd = elapsed + 0.5 + Math.random() * 0.5
          nextSurge = surgeEnd + 1.1 + Math.random() * 1.6 - r * 0.15
        }
        const surging = elapsed < surgeEnd
        if (hold) {
          tension += (0.5 + 0.1 * r + (surging ? 1.2 + 0.25 * r : 0)) * dt
          progress += (dt / (3.2 + 1.6 * r)) * (surging ? 0.3 : 1)
        } else {
          tension -= 0.85 * dt
          progress -= (0.05 + 0.03 * r + (surging ? 0.08 : 0)) * dt
        }
        tension = Math.max(0, tension)
        progress = Math.max(0, progress)
        slack = tension <= 0 ? slack + dt : 0
        tensionEl.style.width = `${Math.min(1, tension) * 100}%`
        tensionEl.dataset.level = tension > 0.82 ? 'high' : tension > 0.58 ? 'mid' : 'ok'
        progressEl.style.width = `${Math.min(1, progress) * 100}%`
        pond.style.setProperty('--pull', String(Math.min(1, progress)))
        pond.classList.toggle('dsf-surge', surging)
        if (tension >= 1) return lose('snap')
        if (slack > 2.6 || elapsed > 40) return lose('away')
        if (progress >= 1) return win()
        requestAnimationFrame(tick)
      }

      const againRow = () => {
        const row = el('div', 'dsf-row')
        const again = el('button', 'dsf-btn', T.again)
        again.type = 'button'
        again.addEventListener('click', () => void luckyCast())
        const back = el('button', 'dsf-btn dsf-alt', T.back)
        back.type = 'button'
        back.addEventListener('click', showSetup)
        row.append(again, back)
        return row
      }
      function lose(why) {
        const c = cur
        hold = false
        set('lost')
        const box = el('div', 'dsf-center')
        box.append(el('p', 'dsf-big', T.lost[why]), el('p', 'dsf-sub', T.teaser.replace('{rarity}', c.rarity.toLowerCase()).replace('{species}', c.species.toLowerCase())))
        const row = againRow()
        row.style.justifyContent = 'center'
        box.append(row)
        body.replaceChildren(box)
      }
      function win() {
        const c = cur
        hold = false
        set('result')
        const head = el('div', 'dsf-head')
        const img = el('img')
        img.alt = ''
        img.src = creature(c.art.species)
        img.style.filter = `hue-rotate(${c.art.tint}deg) drop-shadow(0 12px 20px rgba(0,0,0,.35))`
        const info = el('div')
        const chip = el('span', 'dsf-chip', `${c.species} · ${c.rarity}`)
        chip.dataset.rarity = c.art.rarity
        info.append(chip, el('h3', 'dsf-name', c.repo), el('p', 'dsf-meta', `★ ${c.stars.toLocaleString('en-US')} · ${T.from.replace('{depth}', c.depth)}`))
        head.append(img, info)
        const count = el('p', 'dsf-count')
        const actions = el('div', 'dsf-row')
        actions.append(copyButton(c), linkButton(T.github, c.github, c), linkButton(T.page, c.page))
        const again = againRow()
        again.style.marginTop = '14px'
        body.replaceChildren(head, el('p', 'dsf-desc', c.description || '—'), count, actions, el('p', 'dsf-note', T.restart), again)
        // Reeling it in by hand counts too.
        void land(c).then((res) => {
          if (cur === c && res?.ok && res.hooked > 0) count.textContent = T.hooked.replace('{n}', res.hooked.toLocaleString('en-US'))
        })
      }

      // Space strikes and reels while the panel is up, unless the user is typing somewhere.
      const typing = (t) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      const onDown = (e) => {
        if (e.key === 'Escape' && panel) return close()
        if (e.key !== ' ' || !panel || typing(e.target) || (state !== 'bite' && state !== 'reel')) return
        e.preventDefault()
        e.stopPropagation()
        if (e.repeat) return
        if (state === 'bite') strike()
        else press(true)
      }
      const onUp = (e) => {
        if (e.key === ' ' && state === 'reel') press(false)
      }
      window.addEventListener('keydown', onDown, true)
      window.addEventListener('keyup', onUp, true)

      return () => {
        close()
        fab.remove()
        window.removeEventListener('keydown', onDown, true)
        window.removeEventListener('keyup', onUp, true)
      }
    }

    const module = { exports: {} }
    module.exports.apply = function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-plugin', 'dshsea-fish')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'dshsea-fish: styles')
      ctx.effect(() => mount(), 'dshsea-fish: fishing panel')
    }
    return module.exports
  },
})
