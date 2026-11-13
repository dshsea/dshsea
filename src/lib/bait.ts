// Fishing baits: each one is a kind of need. The build matches them against every repo's name and
// description (src/pages/data/bait.json.ts); the browser only ever sees lists of creature indices.
export const BAITS: [id: string, match: RegExp][] = [
  ['review', /review|lint|audit|refactor|code.?quality/i],
  ['test', /test|tdd|coverage|\bqa\b|\be2e\b/i],
  ['git', /\bgit\b|github|commit|pull.?request|\bprs?\b|changelog|release/i],
  ['docs', /\bdocs?\b|documentation|readme|markdown|writing|wiki|blog/i],
  ['data', /\bsql\b|database|postgres|mysql|sqlite|\bdata\b|analytics|\bcsv\b/i],
  ['web', /frontend|front-end|react|\bvue\b|svelte|\bcss\b|\bui\b|\bux\b|tailwind|next\.?js|design/i],
  ['devops', /docker|deploy|kubernetes|\bk8s\b|\bci\b|devops|terraform|\baws\b|cloud|infra/i],
  ['security', /security|secret|vulnerab|pentest|\bauth\b|\bcve\b/i],
  ['agent', /agent|workflow|orchestrat|\bmcp\b|memory|automation/i],
  ['fun', /game|\bfun\b|joke|\bpet\b|music|\bart\b|meme|pixel|emoji/i],
];
export const BAIT_IDS = ['any', ...BAITS.map(([id]) => id)];
/** How many creatures a bait list holds at most. */
export const BAIT_CAP = 600;
