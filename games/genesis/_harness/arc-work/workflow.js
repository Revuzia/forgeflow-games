export const meta = {
  name: 'genesis-arc-2',
  description: 'Continue the GENESIS arc after a container restart: assess what landed, finish stage A (moods, tower, flood warning), then defiance, covenant + Book of Ages, with verify loops and release',
  phases: [
    { title: 'Assess', detail: 'inventory ARC.md against the code; write arc-work/STATE.md' },
    { title: 'Build A', detail: 'moods + tower + flood warning: sim || ui || render' },
    { title: 'Verify A', detail: '4 lenses, 3 skeptics, fix until dry (max 4)' },
    { title: 'Build B', detail: 'defiance' },
    { title: 'Verify B', detail: '4 lenses, 3 skeptics, fix until dry (max 4)' },
    { title: 'Build C', detail: 'covenant + Book of Ages' },
    { title: 'Verify C', detail: '4 lenses, 3 skeptics, fix until dry (max 4)' },
    { title: 'Final', detail: 'whole-arc review, fix loop, gate, build, CDN smoke' },
  ],
}
const ROOT = '/home/user/forgeflow-games/games/genesis'
const ARC = ROOT + '/_harness/arc-work'
const SCR = ROOT + '/_harness/scratch/arc'
const SPEC = ROOT + '/_spec/ARC.md'
const COMMON = `
You are a senior engineer on GENESIS, a multi-planet living-world god game (TypeScript; deterministic sim in a Web Worker; three.js
WebGL2 renderer; authored music). Project root: ${ROOT} (repo forgeflow-games; ships on forgeflowgames.com in an 888x500 sandboxed
iframe). THE BINDING SPEC IS ${SPEC} (read §0, §6 contracts, §8 acceptance, §9 lanes, §10 flood warning, and the sections for your
items, narrowly). Background: _spec/STATUS.md, _spec/LIVING.md §0 and §3.
The owner asked for five features (ARC §1-§5): visible moods (Hearts), pride and the Tower (confuse tongues / strike / warn / let it
stand), open defiance, the covenant (rainbow vow), the Book of Ages (the game's purpose: the story a world tells about its god; no score).
Plus §10, the river's warning before a natural flood. The owner declined a scripted Great Flood: do not build one.
TONE: Genesis-inspired with the game's own invented peoples and names; no quoted scripture; no real deity names. Owner rules: survivable
wrath by default, real animals only, no creature, nothing Black & White-like, the approved music untouched (new SFX cues via the event
map are fine), NEVER lower render quality.
A CONTAINER RESTART at ~00:40Z on 2026-11-07 erased everything git-ignored: _harness/scratch/** (all ledgers, probes, tree copies, logs)
and node_modules (reinstalled). What was committed survives. LESSONS (binding): keep your ledger and any probe script you will need
again in ${ARC}/ (tracked; autosync commits it every 20 min); bulky output (logs, saves, screenshots, tree copies) goes to ${SCR}/;
port finished work into the live src/ and tests/ at the end of every stint, never leave it only in a tree copy.
Toolchain: Node 22 runs .ts directly; gate: npm run check; build: npm run build; shots: node _harness/shots.mjs <spec> --port=<port>
(Playwright via the preinstalled Chromium); CDN smoke: node _harness/cdn.mjs. Test surface: window.__GENESIS__. Saves: core/serialize.ts +
core/migrate15.ts (new state MUST migrate old saves). Determinism is required (seeded hashFloat, no Math.random in sim).
RULES: other agents work in parallel; edit only the files your role names; read a file right before editing it; never revert another's
work. No git add/commit/stash/checkout/reset/restore (autosync commits).
EFFICIENCY (binding; 4-CPU shared machine): read narrowly (grep -n, sed -n, Read with offset/limit; never whole files over ~400 lines);
heavy jobs (sim runs over a minute, shot runs, the full suite) go through ${ROOT}/_harness/slot.sh (3 machine-wide):
setsid nohup _harness/slot.sh node _harness/shots.mjs spec.json --port=P > log 2>&1 &. Iterate with focused tests (node --test
tests/x.test.ts); full npm run check through slot.sh at most once per stint that changed code (slot.sh --status first; no second full
suite while one runs on the same tree). Wait with ONE blocking call of up to ~9 minutes, never short-sleep polling. Never renice negative.
`
const STINT = {
  type: 'object',
  properties: {
    done: { type: 'boolean', description: 'true only when every item of your brief is done and verified' },
    summary: { type: 'string' }, finished: { type: 'array', items: { type: 'string' } }, remaining: { type: 'array', items: { type: 'string' } },
    files: { type: 'array', items: { type: 'string' } }, verification: { type: 'string' }, gaps: { type: 'array', items: { type: 'string' } },
    waitingOn: { type: 'string', description: "a shell command that exits 0 once the runs you wait on are done; else ''" },
    unattended: { type: 'boolean' },
  },
  required: ['done', 'summary', 'finished', 'remaining', 'files', 'verification', 'gaps', 'waitingOn'],
}
const STINT_NOTE = (i, max, base) => `
STINT ${i} of at most ${max}: you are one of a series of short-lived engineers on this brief, each with a FRESH context. Read your
LEDGER ${ARC}/${base}.md (create it if missing) and ${ARC}/STATE.md first and trust them. Take the next items in priority order, finish
each completely (verified, ported to live src) and update the ledger after each. RETURN when done, or after about 70 tool calls, or when
all that is left is waiting on a long run (PID, output path, next step in the ledger; set waitingOn to a shell test). done=true only when
every item of the brief is done and verified. After a container restart every process is gone: check ledger PIDs with kill -0 and
restart (slot.sh); if ${SCR} vanished, rebuild what you need from the ledger.`
const WAITED = { type: 'object', properties: { ready: { type: 'boolean' }, minutes: { type: 'number' }, note: { type: 'string' } }, required: ['ready', 'note'] }
async function waitFor(cond, label, phaseName) {
  return agent(`You are a waiter. Do NOTHING except wait for this shell condition to succeed (exit 0), from ${ROOT}:
  ${cond}
Use ONE Bash call per wait, each at most 9 minutes: timeout 540 bash -c 'until ${cond.replace(/'/g, "'\\''")}; do sleep 30; done'
(Bash tool timeout 600000). Stop after 80 minutes in all. Do not read files, start or stop anything. Return ready, minutes waited, a one-line note.`,
  { label, phase: phaseName, effort: 'low', schema: WAITED })
}
async function stints(prompt, opts, max) {
  const out = []
  for (let i = 1; i <= max; i++) {
    const o = Object.assign({}, opts, { label: `${opts.label}-s${i}`, schema: STINT })
    let r = await agent(prompt + STINT_NOTE(i, max, opts.label), o)
    if (!r) r = await agent(prompt + STINT_NOTE(i, max, opts.label) + '\nNOTE: the previous attempt at this stint died part-way: read the ledger and the tree.', Object.assign({}, o, { label: o.label + '-retry' }))
    if (!r) { log(`${o.label} died twice (usage limit?) - ledger keeps progress`); return null }
    out.push(r)
    log(`${opts.label} stint ${i}: ${r.finished.length} finished, ${r.remaining.length} remaining${r.done ? ' - DONE' : r.waitingOn ? ' - waiting on: ' + r.waitingOn : ''}`)
    if (r.done || r.unattended) break
    if (r.waitingOn) {
      for (let k = 0; k < 4; k++) {
        const w = await waitFor(r.waitingOn, `${opts.label}-wait${i}.${k}`, opts.phase)
        if (!w || w.ready) break
      }
    }
  }
  const last = out[out.length - 1]
  if (!last.done) log(`${opts.label}: not done after ${max} stints; remaining: ${last.remaining.join('; ')}`)
  return { done: last.done, summary: last.summary, remaining: last.remaining, gaps: last.gaps, files: [...new Set(out.flatMap((s) => s.files))] }
}
const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: {
  severity: { type: 'string', enum: ['critical', 'major', 'minor'] }, area: { type: 'string', enum: ['sim', 'ui', 'render'] },
  file: { type: 'string' }, problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' } },
  required: ['severity', 'area', 'problem', 'evidence', 'fix'] } } }, required: ['findings'] }
const VERDICTS = { type: 'object', properties: { verdicts: { type: 'array', items: { type: 'object', properties: {
  index: { type: 'number' }, real: { type: 'boolean' }, note: { type: 'string' } }, required: ['index', 'real', 'note'] } } }, required: ['verdicts'] }
const OWN = {
  sim: 'src/sim/**, src/data/**, tests/** except tests/ui*, tests/render*, tests/audio*, _harness/probes/arc*',
  ui: 'src/ui/**, src/app.ts, src/main.ts, src/testsurface.ts, index.html, src/client/**, src/audio/eventmap.ts and src/audio/sfx.ts (new SFX cues only; never the music), tests/ui*, tests/audio*',
  render: 'src/render/**, tests/render*, tests/godgen*',
}
const PORT = { sim: 5310, ui: 5311, render: 5312 }

phase('Assess')
const state = await agent(COMMON + `
YOUR ROLE: ASSESSOR — READ-ONLY for src/** and tests/** (write only ${ARC}/STATE.md). Work out exactly what of ARC.md is in the live
tree: git log --since="2026-11-06 15:00" --stat -- src tests _spec; grep for every §6 contract name (state fields, commands, views,
events, queries, AnimState poses, files named in §9.1). For each of §1, §2, §3, §4, §5, §10 and each §8 acceptance line write: landed /
partial (what is missing) / absent, with file:line evidence. Run the focused tests that exist for the arc (tests/flood-warning, render-hearts,
render-silt, ui-flood-*) and typecheck (npx tsc --noEmit -p .) and record the result. Write ${ARC}/STATE.md; return a short summary.`,
  { label: 'assess', phase: 'Assess' })
if (!state) return { incomplete: 'assess' }

const LANE_BRIEF = {
  sim: 'the sim side: state, decisions, commands (registry + freeform phrases), views/events/queries per §6, chronicle lines, save migration, determinism, focused tests and multi-seed measurement for §8 frequencies (probe scripts in _harness/probes/ or ' + ARC + ')',
  ui: 'the UI side: Hearts layer, signs/prompts/windows, the choice moments, chronicle and Book reader, freeform help text, SFX cues via the event map; screenshots you LOOK at in 888x500',
  render: 'the render side: what the items draw in the world (heart poses, tower stages, confusion ring, defiance, idol, rainbow), at every quality preset without lowering any; frame times measured before/after; screenshots you LOOK at',
}
const builder = (lane, stage, items, round) => stints(COMMON + `
YOUR ROLE: ${lane.toUpperCase()} ENGINEER, stage ${stage} (${round}). You own ${OWN[lane]}. Use port ${PORT[lane]} for shots.
Build ${items} — ${LANE_BRIEF[lane]}. Start from ${ARC}/STATE.md (what already landed; do not redo it). Code to the §6 contracts exactly;
if a contract must change, edit §6 in ARC.md and note it in ${ARC}/contract-changes.md. Tests for code; shots you LOOK at for visuals;
multi-seed runs for sim behaviour. End with the gate green.`, { label: `${stage}-${lane}${round === 'build' ? '' : '-' + round}`, phase: `Build ${stage}` }, 7)

const LENSES = (items) => [
  ['correctness', 0, `READ the arc's diff (git log -p --since="2026-11-06 15:00" -- src tests, focus on ${items}) for real bugs: determinism, save migration (load an old save), sim tick perf, weakened tests, contract mismatches between sim/ui/render.`],
  ['sim', 0, `Run multi-seed worlds (through slot.sh) and measure ${items} against ARC.md §8: frequencies, consequences that happen and last, nothing degenerate (every world, never, or a death spiral).`],
  ['owner', 5351, `Play it as the owner would (888x500 and full size, 1x and fast): ${items}. Visible without clicking, understandable, moving, faithful in tone, giving the game purpose? Look at your screenshots.`],
  ['publish', 5352, 'npm run build; node _harness/cdn.mjs; the built game in an 888x500 iframe: zero console errors, frame time not worse than before the arc at the default preset, old saves load.'],
]
async function verifyLoop(stage, items, maxRounds) {
  const rounds = []
  for (let r = 1; r <= maxRounds; r++) {
    const rv = await parallel(LENSES(items).map(([k, port, how]) => () => agent(COMMON + `
YOUR ROLE: VERIFIER (${k}), stage ${stage} round ${r} — READ-ONLY for src/** and tests/**${port ? ` (port ${port})` : ''}; scratch ${SCR}/verify-${stage}-r${r}-${k}/.
${how} Report only real, evidenced problems, most severe first. Missing pieces of the spec for ${items} count as major.`,
    { label: `verify${stage}-${k}-r${r}`, phase: `Verify ${stage}`, schema: FINDINGS })))
    const found = rv.filter(Boolean).flatMap((x) => x.findings || [])
    const major = found.filter((f) => f.severity !== 'minor')
    log(`stage ${stage} round ${r}: ${found.length} findings, ${major.length} critical/major`)
    if (!major.length) { rounds.push({ round: r, minor: found, dry: true }); break }
    const L = major.map((f, i) => Object.assign({ index: i }, f))
    const SK = [['reproduce', 'REPRODUCE each; real only if you saw it.'], ['intent', 'A genuine shortfall against ARC.md and the owner, or taste/misreading?'], ['fix', 'Is the proposed fix right and in proportion?']]
    const votes = (await parallel(SK.map(([k, how]) => () => agent(COMMON + `
YOUR ROLE: SKEPTIC (${k}) — READ-ONLY. Try to REFUTE each finding; default real=false when unsubstantiated. ${how}
One verdict per index. FINDINGS: ${JSON.stringify(L)}`, { label: `skeptic${stage}-${k}-r${r}`, phase: `Verify ${stage}`, schema: VERDICTS })))).filter(Boolean)
    const C = L.filter((f) => { const vs = votes.map((v) => (v.verdicts || []).find((x) => x.index === f.index)).filter(Boolean); return vs.filter((v) => v.real).length * 2 > vs.length })
    log(`stage ${stage} round ${r}: ${C.length}/${L.length} confirmed`)
    if (!C.length) { rounds.push({ round: r, found, dry: true }); break }
    const fx = await parallel(['sim', 'ui', 'render'].map((a) => () => { const mine = C.filter((f) => f.area === a); return mine.length ? builder(a, stage, 'these confirmed findings: ' + JSON.stringify(mine), `r${r}`) : Promise.resolve('none') }))
    rounds.push({ round: r, confirmed: C, fixes: fx })
  }
  return rounds
}
const STAGES = [
  ['A', '§1 Visible moods, §2 Pride and the Tower (confusing tongues, striking it down, a warning prophet, letting it stand) and §10 the river\'s warning before a flood (much of §10 landed: finish and verify it)'],
  ['B', '§3 Open defiance'],
  ['C', '§4 Covenant and §5 the Book of Ages'],
]
const results = []
for (const [stage, items] of STAGES) {
  phase(`Build ${stage}`)
  const built = await parallel(['sim', 'ui', 'render'].map((lane) => () => builder(lane, stage, items, 'build')))
  phase(`Verify ${stage}`)
  const rounds = await verifyLoop(stage, items, 4)
  results.push({ stage, built, rounds })
}
phase('Final')
const finalRounds = await verifyLoop('F', 'the whole arc §1-§5 and §10 together over a long world (a people that grows proud, builds, defies, is judged, covenanted, and whose ages read as a story)', 3)
const rel = await stints(COMMON + `
YOUR ROLE: RELEASE ENGINEER. Record ARC.md §8 acceptance as met (or exactly what is not and why) in ARC.md and STATUS.md; README/CONTROLS
updated for new commands, keys and windows; one final gate through slot.sh (green); npm run build; node _harness/cdn.mjs (pass). Write
${ARC}/FINAL.md: what was built per feature, how it was verified, what is left. done=true only when all pass.`, { label: 'release', phase: 'Final' }, 4)
return { state, results, finalRounds, release: rel }
