export const meta = {
  name: 'vale-integration-pass',
  description: 'VALE integration pass: every cross-lane handoff and wave leftover, fixed in file-disjoint lanes, adversarially verified, then cross-lane stitch and a whole-build gate',
  phases: [
    { title: 'Fix', detail: 'one engineer per package, lanes in parallel on disjoint files (plan: _design/reviews/fixwaves/integration_plan.json)' },
    { title: 'Verify', detail: 'adversarial verifier per lane re-measures every item; targeted refix + verify-only recheck' },
    { title: 'Stitch', detail: 'items that depend on another lane, after every lane is done' },
    { title: 'Gate', detail: 'whole-build gate over the integrated tree, then an independent gate check' },
  ],
}

const REPO = '/Users/sitskovich/Developer/forgeflow-games/games/vale'
const BR = 'claude/youthful-ramanujan-gdud5w'
const ENV = 'export PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH; export CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"'
const BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 --python <script>'
const PLAN = args.plan || '_design/reviews/fixwaves/integration_plan.json'

const LANES = {
  engine: { name: 'Engine: render, VFX, performance & build hygiene',
    owns: ['src/render/** (except src/render/menu.ts)', 'content/vfx.json', '_design/tokens.json', '_harness/overlay_regress.mjs', '_harness/value_probe.mjs', '_harness/vfx_gallery.mjs', '_harness/perf_1080.mjs', '_harness/web/render_bench.ts', 'new _harness probes for your items', 'package.json', 'vite.config.ts', 'tools/build_content.ts', 'tools/package_deploy.ts', 'tools/secret_scan*', 'tools/vfx/**'] },
  client: { name: 'Client front door & HUD (UI code and UI art)',
    owns: ['src/ui/** (incl. state.ts, app.tsx, audio_port.ts, styles)', 'src/render/menu.ts', 'src/session/settings.ts', 'src/session/grants.ts', 'src/session/online_link.ts', 'content/ui/** (home, modes, icons)', 'public/**', 'tools/imagegen/**', 'tools/ui_icons.py', 'content/client.json', 'content/strings.en.json', '_design/sections/client_hud.md', '_harness/e2e.mjs', '_harness/hud_renders.mjs', '_harness/icon_probe.mjs', '_harness/sweep_720.mjs'] },
  audio: { name: 'Audio',
    owns: ['src/audio/**', 'audio/** (cues, synth, build.py, build_music.py)', 'content/audio.json', 'src/boot/main.ts', '_harness/audio_probe.mjs', '_harness/probe_audio_*.mjs'] },
  systems: { name: 'Gameplay, bots, contracts & systems content',
    owns: ['src/sim/**', 'src/contracts/**', 'src/session/{draft,draft_brain,local_session,bots_link,setup,economy}.ts', 'content/units.json', 'content/items.json', 'content/setup.json', 'content/team_buffs.json', 'content/modes.json', 'content/queues.json', 'content/fighters/*.json', 'content/skins/*.json', 'content/classes*.json', 'content/roles*.json', '_harness/pacing.ts', '_harness/probe_sim_*.ts', '_harness/probe_items.ts', '_harness/probe_kits_*.ts', '_design/sections/items_setup.md', '_design/sections/modes_economy.md', '_design/ROSTER.md', '_design/reviews/fixwaves/W4_*', 'server/room.ts'] },
  world: { name: 'World art: maps, landmarks & units',
    owns: ['art/blender/maps/**', 'art/blender/units/**', 'art/blender/props/**', 'art/blender/proto/** (map/unit files only)', 'art/blender/sky.py', 'art/out/maps/**', 'art/out/units/**', 'art/out/props/**', 'art/renders/maps/**', 'art/renders/units/**', 'art/renders/props/**', 'content/maps/*.json', 'content/map_*.json', '_design/tools/map_gen.py'] },
  chars: { name: 'Character art: fighters, face chips, plates',
    owns: ['art/blender/fighters/**', 'art/blender/portraits.py', 'art/blender/parts_sheet.py', 'art/blender/ui/**', 'art/out/fighters/**', 'art/out/backdrops/**', 'art/renders/fighters/**', 'art/renders/lineup/**', '_design/fighters/*.md'] },
  lead: { name: 'Lead: design docs, registries and unowned harness',
    owns: ['_design/** files no other lane lists (STYLE_BIBLE.md, DESIGN_NOTE.md, WORLD.md, research/protected_names.json, reviews/final_parity_open.json, reviews/fixwaves/* except W4_* and integration_plan.json)', 'README.md', 'HANDOFF.md', 'tools/names_check.ts', '_harness/run_probes.ts', 'any other _harness file no lane lists'] },
}
const SHARED = 'art/blender/common/** is shared by lanes world and chars: only additive, backward-compatible changes there (new functions/params with old defaults kept).'

const RULES = (lane) => `PROJECT: VALE, an original 3D lane-brawler (MOBA) in ${REPO}, git branch ${BR}. Three.js WebGL2 client, Preact signals, zod content catalog, deterministic 30 Hz sim. The owner's bar: League-of-Legends-level quality, 100 % original. LoL is ONLY A GAUGE of quality and polish: never copy a LoL champion, ability, item, effect, icon, UI layout, rule, number or name; every fix is VALE's own (_design/STYLE_BIBLE.md, _design/WORLD.md). Never download video files and never save any LoL image into the repo.
CONTEXT: six parity fix waves (W1 engine, W2 client, W3 audio, W4 systems, W5a world art, W5b character art) just finished. Integration run 1 already ran (verdicts: _design/reviews/fixwaves/integ_<lane>_verify<n>.json; its plan: integration_plan.json). Their plan is _design/reviews/final_parity_review.md + final_parity_open.json; their verdicts are _design/reviews/fixwaves/<wave>_verify<n>.json. This INTEGRATION PASS closes what crossed lanes: every handoff one lane wrote for another, every item a verifier left open, and the lead's own list. The work list is ${PLAN} (lanes.<lane>.packages[k].items[], lanes.<lane>.stitch[]). Each item has id, source (who asked), what (the exact change), files and done (the criterion).
YOU ARE IN LANE "${lane}": ${LANES[lane].name}. YOUR LANE OWNS ONLY: ${LANES[lane].owns.join('; ')}. ${(lane === 'world' || lane === 'chars') ? SHARED : ''}
CONCURRENCY: the other lanes (${Object.keys(LANES).filter(k => k !== lane).join(', ')}) edit the same working tree at the same time on disjoint files. Never edit files outside your list; if an item needs another lane's file, do not touch it, return it in handoffs (to: lane key, what: the exact change). If typecheck / content:check / probes fail in files you do not own, another lane is mid-edit: do not fix or revert them, re-run later; only your own files must be clean. NEVER run git stash, git checkout -- <path>, git restore, git reset, git clean, or anything that changes files you do not own. Do not stop or restart the dev server on :5190 (start it only if it is down: \`cd ${REPO} && npm run dev -- --port 5190 > /tmp/vale_dev.log 2>&1 &\`); a GUI Blender the owner opened may be running: leave it.
GIT: commit only your own paths: \`git add <your paths> && git commit -m "vale integ ${lane}: <what>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- <your paths>\`, then \`git push origin ${BR}\`. If .git/index.lock exists or the push races, retry a few times a few seconds apart (a short loop with sleep 3). Never force-push, amend others' commits, or rewrite history. Commit after each finished item. A WIP safety sync (commits titled "vale wip sync") may commit your in-progress files every 20 min; that is fine.
CODE RULES: erasable TypeScript only (no enum, namespace, parameter properties, decorators); the sim is deterministic (no Math.random / Date / wall-clock in src/sim; use the sim's RNG); keep sim and presentation separate; no content ids hard-coded in src/ (data-driven from content/); cosmetics never change stats; the zod catalog must validate (\`npm run content:check\`). Scripts: npm run typecheck | content:check | probe | check | build; \`npm run content\` republishes dist-catalog for the dev server. Node env: \`${ENV}; cd ${REPO}\`. Python venv: ~/Developer/forgeflow-games/.venv/bin/python3. Blender 5.2 headless: \`${BLENDER}\`.
OWNER RULINGS (binding, _design/reviews/fixwaves/owner_rulings.md, owner-delegated, count as sign-off): Longshade sundial plate (tears gone, lamp eyes kept); Odrum Shadeprint warm amber lacquer #B39272 with honey-amber eye inlays; Rishal accent = visor ridge blade + two left-temple fins (rear vanes removed, skins never recolour them); the W4 systems re-key is signed off (the probe_sim_rekey 10 % gate stays); Dunsom's gold beak becomes a short rounded bill no longer than the eye-to-chin height; the Hooded Lamp ward's pointed finial becomes a rounded knob. Nothing is pending owner input; never ask the owner anything and never route work "to owner". Items about rotating or purging API keys are closed by the owner: skip them.
SENSITIVITY (blocker class anywhere): no tall, pointed or conical hoods; no masks/faces that read as horror, hockey mask, plague-doctor beak or blank mannequin; Wicks have no face (no eye-like light pairs, no mouth).
SECRETS: never print, echo or log any API key or token. Images are generated only through tools/imagegen/run_xai.py (it reads the key itself). All 3D models are procedural Blender builds. NO DEPLOY: no Cloudflare, no upload, no publishing of any kind.
MACHINE LIMITS (10-core / 16 GB Mac shared with up to 6 other agents): Blender, harness Chrome (_harness/pw.mjs) and three_snapshot queue for 3 machine-wide heavy slots ("[heavy] ... waiting" is normal: wait, never kill or bypass the queue; ad-hoc heavy commands go through \`python3 art/blender/common/heavy.py run -- <cmd>\`). Run ONE Blender/harness at a time, long runs with a generous Bash timeout (up to 600000 ms) or in the background with a log you poll. Use the repo harnesses on the real Chrome GPU. perf_1080 gates use --prod. At most 3 parallel node sim processes.
BUDGET (hard; you cannot be messaged later): per package at most 3 full Blender rebuilds of any one model or map, at most 3 full perf_1080 / e2e sweeps, at most 4 full soak runs; batch edits before re-measuring. Aim to finish a package within about 2 hours. Stop polishing an item once its criterion is met. Guide bands missed by <= 2 L* are minors to report. If a criterion cannot be met within budget, report partly/not_done with the measured numbers: honesty beats a false "done".
TRIAGE FIRST: many handoffs were already handled by a later package. For each item, check the current code/content/art (grep, read, measure) BEFORE changing anything; if it is already done, mark it "already_done" with the file:line or measurement that proves it, and move on.
NO HANGS: never run a command that can block forever (tail -f, watch, a pipe or heredoc waiting on stdin, an interactive prompt, a server in the foreground). Long runs go in the background with a log and a bounded poll loop (e.g. up to 60 checks, sleep 10). Kill any helper process you started before you finish.
EVIDENCE: every status cites a reproducible artifact (shot/report path, command, file:line, measured number). Shots go to _harness/_shots/integ_${lane}_*, reports to _harness/_reports/integ_${lane}_* (git-ignored).`

const PKG_SCHEMA = { type: 'object', properties: {
  items: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, status: { type: 'string', enum: ['done', 'already_done', 'partly', 'not_done', 'skipped'] }, evidence: { type: 'string' } }, required: ['id', 'status', 'evidence'] } },
  commits: { type: 'array', items: { type: 'string' } },
  handoffs: { type: 'array', items: { type: 'object', properties: { to: { type: 'string' }, what: { type: 'string' } }, required: ['to', 'what'] } },
  notes: { type: 'string' },
}, required: ['items', 'commits', 'handoffs', 'notes'] }

const VERIFY_SCHEMA = { type: 'object', properties: {
  pass: { type: 'boolean', description: 'true only if every blocker and major item passes and nothing regressed' },
  items: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
    status: { type: 'string', enum: ['pass', 'partly', 'fail', 'not_measured'] }, evidence: { type: 'string' }, fixHint: { type: 'string' } },
    required: ['id', 'severity', 'status', 'evidence'] } },
  regressions: { type: 'array', items: { type: 'string' } },
  summary: { type: 'string' },
}, required: ['pass', 'items', 'regressions', 'summary'] }

const brief = (rs) => rs.length ? rs.map(r => `- ${r.key}: ${(r.items || []).map(i => `${i.id}=${i.status}`).join(', ')}${(r.handoffs || []).length ? `; handoffs: ${r.handoffs.map(h => `${h.to}: ${h.what}`).join(' | ')}` : ''}`).join('\n') : '(none yet)'

const pkgPrompt = (lane, k, n, prior) => `${RULES(lane)}

You are the "${lane}" lane engineer for package ${k + 1}/${n}. YOUR ITEMS: ${PLAN} → lanes.${lane}.packages[${k}].items (read them, and the sources they cite, before you start). Do the items that need no other lane's work; leave lanes.${lane}.stitch alone (it runs later).
Earlier packages in this lane (already committed):
${brief(prior)}
Blockers first, then majors, then minors. Meet each item's done-criterion and MEASURE it. Before each commit: \`npm run typecheck\` clean for your files, \`npm run content:check -- --allow-missing-assets\` if you touched content, the relevant probes. Return per-item status with evidence, commit hashes, handoffs (to another lane key) and short notes.`

const verifyPrompt = (lane, rs, n) => `${RULES(lane)}

You are the ADVERSARIAL VERIFIER for integration lane "${lane}", round ${n}. Items: ${PLAN} → lanes.${lane}.packages[*].items. The engineers claim:
${brief(rs)}
Full claims: ${JSON.stringify(rs.map(r => ({ key: r.key, items: r.items }))).slice(0, 12000)}
Do NOT trust claims: re-measure yourself. Check every blocker/major item (including "already_done" claims: confirm them in the current tree) and spot-check minors. Look for regressions in this lane's area (typecheck in lane files, the lane's probes, e2e for UI, perf_1080 --prod for render, value_probe for maps, the art gates for models). Sensitivity: look at every new image/model render yourself. Default to fail when uncertain or unmeasured. Your ONLY edit: write your verdict JSON to _design/reviews/fixwaves/integ${args.tag || ''}_${lane}_verify${n}.json and commit+push that one file. Do not fix anything. Give a concrete fixHint for each failure.`

const refixPrompt = (lane, fails, n, prior) => `${RULES(lane)}

You are the "${lane}" lane engineer for REFIX round ${n}. The adversarial verifier failed these items (fix ONLY these):
${JSON.stringify(fails).slice(0, 14000)}
Earlier work in this lane:
${brief(prior)}
Fix each one (or prove the verifier wrong with a measurement), re-measure with the verifier's harness, commit+push. Budget for this round: at most 3 full rebuilds/sweeps in total. Return per-item status with evidence.`

const recheckPrompt = (lane, fails, fx, n) => `${RULES(lane)}

You are the ADVERSARIAL VERIFIER for integration lane "${lane}", VERIFY-ONLY round ${n}. Re-check ONLY these previously failed items (plus any regression the refix caused and any blocker-class new problem you see):
${JSON.stringify(fails).slice(0, 12000)}
The refix engineer claims: ${JSON.stringify(fx && fx.items || []).slice(0, 6000)}
Re-measure yourself; default to fail when uncertain. Your ONLY edit: write your verdict JSON to _design/reviews/fixwaves/integ${args.tag || ''}_${lane}_verify${n}.json and commit+push that one file.`

const failing = (vv) => (vv && vv.items || []).filter(x => x.status !== 'pass' && x.severity !== 'minor')

async function runLane(lane, nPkgs) {
  const results = []
  for (let k = 0; k < nPkgs; k++) {
    const r = await agent(pkgPrompt(lane, k, nPkgs, results), { label: `${lane}:pkg${k + 1}`, phase: 'Fix', schema: PKG_SCHEMA, agentType: 'general-purpose' })
    results.push({ key: `pkg${k + 1}`, ...(r || { items: [], commits: [], handoffs: [], notes: 'agent died' }) })
    log(`${lane}:pkg${k + 1} → ${(r && r.items || []).map(x => `${x.id}=${x.status}`).join(', ')}`)
  }
  let v = await agent(verifyPrompt(lane, results, 1), { label: `${lane}:verify1`, phase: 'Verify', schema: VERIFY_SCHEMA, agentType: 'general-purpose' })
  let n = 1
  while (v && failing(v).length && n <= 2) {
    if (n === 2 && !failing(v).some(x => x.severity === 'blocker')) break
    const fails = failing(v)
    const fx = await agent(refixPrompt(lane, fails, n, results), { label: `${lane}:refix${n}`, phase: 'Verify', schema: PKG_SCHEMA, agentType: 'general-purpose' })
    results.push({ key: `refix${n}`, ...(fx || { items: [], commits: [], handoffs: [], notes: 'agent died' }) })
    n++
    const rv = await agent(recheckPrompt(lane, fails, fx, n), { label: `${lane}:verify${n}`, phase: 'Verify', schema: VERIFY_SCHEMA, agentType: 'general-purpose' })
    if (!rv) break
    const byId = new Map(v.items.map(x => [x.id, x]))
    for (const x of rv.items) byId.set(x.id, x)
    v = { ...rv, items: [...byId.values()], pass: [...byId.values()].every(x => x.status === 'pass' || x.severity === 'minor') }
  }
  log(`${lane}: verify ${v && v.pass ? 'PASS' : 'OPEN'} (${failing(v).length} blocker/major open)`)
  return { lane, results, verdict: v }
}

// args: { packages: { engine: 2, client: 2, ... }, stitch: ['systems', ...], maxLanes?: 6 }
const PKGS = args.packages || {}
const order = Object.keys(PKGS).filter(l => LANES[l] && PKGS[l] > 0)
const MAX = args.maxLanes || 6

phase('Fix')
const laneOut = new Array(order.length)
let next = 0
await Promise.all(Array.from({ length: Math.min(MAX, order.length) }, async () => {
  while (next < order.length) {
    const i = next++
    try { laneOut[i] = await runLane(order[i], PKGS[order[i]]) } catch (e) { laneOut[i] = { lane: order[i], results: [], verdict: null, error: String(e) } }
  }
}))

// Stitch: items that needed another lane first, plus handoffs the lanes wrote during this pass.
phase('Stitch')
const newHandoffs = laneOut.filter(Boolean).flatMap(o => o.results.flatMap(r => (r.handoffs || []).map(h => ({ from: o.lane, ...h }))))
const stitchLanes = [...new Set([...(args.stitch || []), ...newHandoffs.map(h => h.to).filter(t => LANES[t])])].filter(l => !(args.excludeLanes || []).includes(l))
const stitchOut = await parallel(stitchLanes.map(lane => () => agent(`${RULES(lane)}

You are the "${lane}" lane engineer for the STITCH round. Every lane has finished its own packages. Do (1) lanes.${lane}.stitch in ${PLAN} (items that waited for another lane; that lane's work is now committed: check it is there), and (2) these handoffs other lanes wrote during this pass:
${JSON.stringify(newHandoffs.filter(h => h.to === lane)).slice(0, 10000)}
Triage first (some may already be done). Measure each, commit+push. Return per-item status with evidence; any further cross-lane need goes in handoffs (the gate engineer will take it).`, { label: `${lane}:stitch`, phase: 'Stitch', schema: PKG_SCHEMA, agentType: 'general-purpose' })))
const stitchRes = stitchLanes.map((l, i) => ({ lane: l, ...(stitchOut[i] || { items: [], handoffs: [], notes: 'agent died' }) }))
for (const s of stitchRes) log(`${s.lane}:stitch → ${(s.items || []).map(x => `${x.id}=${x.status}`).join(', ')}`)

if (args.noGate) {
  return {
    lanes: laneOut.filter(Boolean).map(o => ({ lane: o.lane, pass: !!(o.verdict && o.verdict.pass), open: (o.verdict && o.verdict.items || []).filter(x => x.status !== 'pass'), regressions: o.verdict && o.verdict.regressions || [], packages: o.results.map(r => ({ key: r.key, items: (r.items || []).map(i => `${i.id}=${i.status}`), commits: r.commits, notes: (r.notes || '').slice(0, 500) })), handoffs: o.results.flatMap(r => (r.handoffs || []).map(h => ({ from: `${o.lane}:${r.key}`, ...h }))), error: o.error })),
    stitch: stitchRes.map(s => ({ lane: s.lane, items: (s.items || []).map(i => `${i.id}=${i.status}`), handoffs: s.handoffs })),
    gate: 'skipped (args.noGate)',
  }
}

phase('Gate')
const leftovers = {
  open: laneOut.filter(Boolean).map(o => ({ lane: o.lane, open: (o.verdict && o.verdict.items || []).filter(x => x.status !== 'pass'), regressions: o.verdict && o.verdict.regressions || [] })),
  stitchHandoffs: stitchRes.flatMap(s => (s.handoffs || []).map(h => ({ from: s.lane, ...h }))),
  stitchOpen: stitchRes.flatMap(s => (s.items || []).filter(x => x.status === 'partly' || x.status === 'not_done').map(x => ({ lane: s.lane, ...x }))),
}
const gateRules = RULES('lead').replace(/YOU ARE IN LANE "lead"[^\n]*\n/, 'YOU ARE THE GATE ENGINEER: every lane is finished and idle, so you may edit ANY file in the repo to fix integration breakage (still: no stash/reset/checkout of others\' work, commit with "vale integ gate: <what>").\n')
const gate = await agent(`${gateRules}

You are the INTEGRATION GATE engineer. Run the whole-build gate on the integrated tree and fix what breaks:
1. \`npm run content\` (republish dist-catalog), \`npm run typecheck\`, \`npm run content:check\` (no --allow-missing-assets: every referenced asset must exist), \`npm run probe\`, \`npm run build\`.
2. \`node _harness/e2e.mjs flow\` and the HUD/e2e sweeps the client lane uses; \`node _harness/perf_1080.mjs --prod\` (all presets); \`node _harness/value_probe.mjs\`; \`node _harness/icon_probe.mjs\`; the audio build gates (audio/build.py --check or the probe_audio_* set); \`node _harness/probe_sim_bot_soak.ts\` quick mode.
3. Fix every failure (any file), re-run, commit+push. Then take these leftovers (cross-lane items still open, and handoffs nobody took): ${JSON.stringify(leftovers).slice(0, 14000)}
Do the ones you can within budget (3 full sweeps of each harness); report the rest honestly with numbers.
Return per-gate and per-leftover status with evidence.`, { label: 'gate', phase: 'Gate', schema: PKG_SCHEMA, agentType: 'general-purpose' })

const gateCheck = await agent(`${gateRules.replace('YOU ARE THE GATE ENGINEER', 'YOU ARE THE GATE VERIFIER (read-only except your verdict file)')}

You are the ADVERSARIAL GATE VERIFIER. Independently run the whole-build gate on the current tree: npm run typecheck, content:check (no allow-missing), probe, build; _harness/e2e.mjs flow; perf_1080 --prod; value_probe; icon_probe; the audio gates. The gate engineer claims: ${JSON.stringify(gate && gate.items || []).slice(0, 8000)}
Report every gate as an item (pass/fail with the measured numbers) and any regression. Default to fail when unmeasured. Your ONLY edit: write _design/reviews/fixwaves/integ_gate_verify.json and commit+push that one file.`, { label: 'gate:verify', phase: 'Gate', schema: VERIFY_SCHEMA, agentType: 'general-purpose' })

return {
  lanes: laneOut.filter(Boolean).map(o => ({ lane: o.lane, pass: !!(o.verdict && o.verdict.pass), open: (o.verdict && o.verdict.items || []).filter(x => x.status !== 'pass'), packages: o.results.map(r => ({ key: r.key, items: (r.items || []).map(i => `${i.id}=${i.status}`), commits: r.commits, notes: (r.notes || '').slice(0, 500) })), error: o.error })),
  stitch: stitchRes.map(s => ({ lane: s.lane, items: (s.items || []).map(i => `${i.id}=${i.status}`), handoffs: s.handoffs })),
  gate: gate && { items: gate.items, notes: (gate.notes || '').slice(0, 1500), handoffs: gate.handoffs },
  gateVerdict: gateCheck,
}
