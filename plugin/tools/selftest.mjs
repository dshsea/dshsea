// Drives the plugin against the live dshsea.com with a stand-in for the harness context:
//   node tools/selftest.mjs ["some bait"]
// It checks that the tool registers, that a cast returns well-formed catches, and that an
// impossible bait is reported as such. It does not report a catch, so nothing is counted.
import { apply, name } from '../lib/index.js'

let tool = null, section = null
const services = {
  tools: { register: (def) => ((tool = def), () => {}) },
  systemPrompt: { section: (s) => ((section = s), () => {}) },
}
const ctx = {
  inject: (names, fn) => fn({ get: (n) => services[n], effect: (run) => run() }),
  effect: (run) => run(),
}
apply(ctx)
const fail = (msg) => {
  console.error(`FAIL: ${msg}`)
  process.exit(1)
}
if (name !== 'dshsea-fish' || !tool || tool.name !== 'dshsea_fish') fail('the tool did not register')
if (!section?.text.includes('dshsea_fish')) fail('the prompt section did not register')

const exec = { signal: new AbortController().signal }
const bait = process.argv[2] ?? 'test coverage'
const first = await tool.execute({ bait, count: 3 }, exec)
console.log(tool.output.render({}, first)[0].text)
if (first.catches.length !== 3) fail(`expected 3 catches for “${bait}”, got ${first.catches.length}`)
for (const c of first.catches) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(c.repo) || !c.install.endsWith(`github:${c.repo}`) || !c.page.startsWith('https://dshsea.com/')) fail(`malformed catch ${JSON.stringify(c)}`)
}
const second = await tool.execute({ bait, count: 3 }, exec)
if (second.catches.some((c) => first.catches.some((f) => f.repo === c.repo))) fail('a second cast repeated a catch')
const none = await tool.execute({ bait: 'zzqqxxnothing' }, exec)
if (none.catches.length || !none.message.includes('/wishes')) fail('an impossible bait should point at the wishes page')
const surprise = await tool.execute({}, exec)
if (!surprise.catches.length) fail('a surprise cast came back empty')
console.log('\nOK: registered, cast, repeat cast, no-match and surprise all behave.')
