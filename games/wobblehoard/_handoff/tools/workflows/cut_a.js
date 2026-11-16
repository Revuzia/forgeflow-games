export const meta = {
  name: 'squish-cut-a',
  description: 'Squish Keeper CUT-A: the first slice of the TRUE CUT (two real halves, one eye per half) plus the Minis style, three legs of two budgeted engineers, then integration, two independent verifiers, one fix round',
  phases: [
    { title: 'Leg 1', detail: 'PHYS: P0, P1a, P1b (pure region and piece modules). SHELL: S0 prep refactor, S1 cut tree' },
    { title: 'Leg 2', detail: 'PHYS: P2, P3 (constructor, planCut, prepareCut, placeAt). RENDER: R1 part 1' },
    { title: 'Leg 3', detail: 'SHELL: S2 first half + Minis + style setter. RENDER: R1 part 2' },
    { title: 'Gate', detail: 'integration on the real stack (Milestone A), filmstrips, bundle gate' },
    { title: 'Verify', detail: 'two independent verifiers on a snapshot: physics lens, shell + render lens' },
    { title: 'Fix', detail: 'one fix round, then re-verify only the changed areas' },
  ],
}

const REPO = 'C:/Users/TestRun/Claude Claw/squish-keeper-build/games/wobblehoard'
const SCR = 'C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-AppData-Roaming-Claude-scratch-workspaces-10f6a62c-5610-424a-ba29-8c51dbde9f88-b3ecf43b-de12-4070-80de-e1daecc887bf-scratch-2026-10-06-8a5967/3b1103ab-0174-4d88-adc9-dd448a718f0d/scratchpad'

const PRE = `You are a senior engineer on Squish Keeper (folder ${REPO}; Windows; Bash tool with POSIX syntax and forward slashes; your scratch folder is ${SCR}/<your lane>/).
FIRST read ${REPO}/_handoff/briefs/CUT_A.md COMPLETELY (the owner's words, the scope of this slice, the HARD BUDGET and the environment rules: they bind you), then ${REPO}/_handoff/briefs/RESUME.md quickly. The build contract is ${REPO}/_spec/CUT2.md, 969 lines: NEVER read it whole; read only the line ranges your task names (sections: 3 model = lines 86-120; 4 physics geometry = 121-174; 5 solver = 175-265 (5.1 launch fix 179-188, 5.2 resting 189-197, 5.3 fold limit 198-201, 5.4 neck 202-217, 5.5 collide 218-228, 5.6 planCut 229-237, 5.7 setRegion 238-254); 6 shell cutting = 266-328; 7 reconnect = 329-387; 8 render = 388-462; 9 audio/meter/text/debug = 463-507; 10 contract = 508-592 (ALREADY APPLIED to src/contracts.ts by the orchestrator: read the code, do not edit it); 12 acceptance = 608-663; 13 gates = 664-689; 14 tasks and file ownership = 690-750). Also read ${REPO}/_spec/CUT_MINIS.md (short). Quote before you claim (path:line).
If a running report for your lane already exists in ${REPO}/_handoff/reports/ (CUT_A_PHYS.md, CUT_A_SHELL.md, CUT_A_RENDER.md), a previous engineer stopped mid-task: CONTINUE from it, never redo finished tasks.
You may edit only the files your lane owns (CUT2.md 14, "File ownership"). tsc must stay clean after every task. Never run a git write command. At the end of your leg return the structured summary; the orchestrator commits.`

const LEG_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    tasksDone: { type: 'array', items: { type: 'string' } },
    tasksNotDone: { type: 'array', items: { type: 'string' } },
    measured: { type: 'array', items: { type: 'string' }, description: 'the key numbers (probe rows, bars, perf) with their results' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    reportPath: { type: 'string' },
    blockers: { type: 'array', items: { type: 'string' } },
    requestsToOtherLanes: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'tasksDone', 'tasksNotDone', 'measured', 'filesChanged', 'reportPath', 'blockers', 'requestsToOtherLanes'],
}

const task = (lane, label, text) => agent(`${PRE}\n\nYOUR LANE: ${lane}. YOUR LEG: ${label}.\n${text}`, { label, phase: label.split(':')[0], schema: LEG_SCHEMA })

// ---------------------------------------------------------------- Leg 1
phase('Leg 1')
const leg1 = await parallel([
  () => task('PHYS', 'Leg 1: phys-1', `Tasks P0, P1a, P1b of CUT2.md 14 (lines 702-704), with sections 3, 4 and 13 (and 5.4 for P0's neck-centring). Files: new src/physics/region.ts and piece.ts, the one P0 change in src/physics/softbody.ts (centreGB), new _harness/probe_truecut.ts (register it in _harness/run_probes.ts), plus _harness/cutregion_checks.ts if the spec names it. Probe rows G1 to G7, C2, L10, L5, L6 on all 50 species with the spec's plane sets, using the SPEC'S BARS; report every number. P0: apply the neck-centring half of ${REPO}/_handoff/reports/SHELL_4_FIX2_physics_goal_centroid.patch (if the file is missing, say so and implement the centring from section 5.4). The pure modules must have zero per-step allocation where they are called per step, be deterministic, and carry the resumable stages with maxStages (4.5). Do not touch the constructor (that is the next leg).`),
  () => task('SHELL', 'Leg 1: shell-1', `Tasks S0 and S1 of CUT2.md 14 (lines 718-719), with sections 6 (266-328) and 9.3 (473-500) for the strings. S0: every cut string to a new src/shell/cutText.ts with the revised wording of 9.3; the cut wiring out of src/shell/hudBinding.ts (around lines 243-340) into a new src/shell/cutBinding.ts; cutBar.setPieces signature extended with the owner's cut style fields (CUT_A.md, "SR1": style and canChangeStyle; the control itself is the UI lane's, but the setter and fields must exist); an Undo cut button only if cheap and DISABLED/hidden (Undo is not in this slice); a no-op Cutter.prewarm() and its call in game.ts setTool. S0 is the ONLY time you touch hudBinding.ts, cutBar.ts and game.ts. The shell fix round just finished and is committed: read the current cut.ts, do not rewrite it yet (the next leg does). S1: new src/shell/cutRegion.ts (the cut tree: cutPiece, lca, group, joinGroup, isWhole, cutStack, serialisation to a one-cell PieceRegion) plus the X18 property tests in a NEW file _harness/shellview/cut_checks.ts. The old cut rows in node_checks.ts and browser_shell.mjs must keep passing until S2 replaces them; run node_checks and probe_app and report. Commit nothing; the orchestrator commits and the UI lane starts right after S0.`),
])
log(`leg 1: ${leg1.map((r) => (r ? r.status : 'null')).join(', ')}`)
if (leg1.some((r) => !r)) { return { stoppedAt: 'leg 1', leg1, note: 'an engineer returned nothing (usage limit?). Re-run with resumeFromRunId after checking the running reports.' } }

// ---------------------------------------------------------------- Leg 2
phase('Leg 2')
const leg2 = await parallel([
  () => task('PHYS', 'Leg 2: phys-2', `Tasks P2 and P3 of CUT2.md 14 (lines 705-706), with sections 5.1 (the launch fix: every goal has zero mass-weighted mean), 5.2, 5.3, 5.6 and 13. The previous leg built region.ts, piece.ts and the G rows (read CUT_A_PHYS.md). P2: the constructor takes opts.piece.region (initRest, frame, PieceInfo publication, no lift with a region, FRAC_MIN 0.124, per-hinge fold arrays, frac truth, meanEdge, capFlat); the legacy build (a whole at at, a scaled whole = Minis, the old chunk) stays accepted. P3: planCut ('at', 'median', 'latched'), prepareCut(budgetMs, maxStages) with the nudge ladder and the 'thin'/'loose' returns, placeAt with re-homing; the one probe_cut.ts X02 row that asserts clamped === 0.125 becomes 0.124 in this commit. Probe rows L2, L3, L6, C1, C2 and the launch speed row (a new piece must not launch: report the max speed over the first 1 s on 50 species x 3 planes against the spec's bar). Old probe_cut rows keep passing except where CUT2.md 14 says they are re-specified (P9 is NOT in this slice). Do not do P4 to P9.`),
  () => task('RENDER', 'Leg 2: render-1', `Task R1 of CUT2.md 14 (line 713), PART 1, with section 8 (388-462) and 12.1 (641-663). Files: src/render/*, _harness/renderview/*, _harness/browser_render.mjs. Part 1: BodyProxy.piece and morphT pass-through, stubBody piece support (a dev clipRest stub, or call PHYS's pure builder src/physics/piece.ts once it exists: check), PieceBuild (cap classification, subdivision with class split, split normals, aCap / aCapP / aCapD / aRest attributes), ONE cut-face look (flat, matte-to-glossy by the family's existing material parameters; not the 12 family looks), the dev members of 8.7. Render probes RP1, RP3, RP4 on the stub. Keep the old chunk path (AddBodyOpts.chunk) working for bodies without piece. Do not do eyes/core/clip yet (part 2).`),
])
log(`leg 2: ${leg2.map((r) => (r ? r.status : 'null')).join(', ')}`)
if (leg2.some((r) => !r)) { return { stoppedAt: 'leg 2', leg1, leg2, note: 'an engineer returned nothing. Re-run with resumeFromRunId.' } }

// ---------------------------------------------------------------- Leg 3
phase('Leg 3')
const leg3 = await parallel([
  () => task('SHELL', 'Leg 3: shell-2', `Task S2 FIRST HALF of CUT2.md 14 (line 720) plus the Minis style, with sections 6 (266-328), 7.5-7.6 (378-387), 9 and CUT_MINIS.md. The previous legs built cutText/cutBinding/cutRegion (CUT_A_SHELL.md) and PHYS's planCut/prepareCut/placeAt/pure region module (CUT_A_PHYS.md). Rewrite src/shell/cut.ts on the new physics: pieces and anchor, plan and refusals (including the loose-crumbs refusal line), the neck, pre-build and placeAt, the swap, the scripted parting (replaces the steering stopgap; including the near-level case), Split in two (eye-midline first press via stage.eyeAnchors, then the median plane), swipe cuts, Reconnect all (the last join is a fresh createBody(genome)), the leave paths, prewarm, text. MAX_PIECES for the clean style is a constant set to 2 for this slice. MINIS style: Cutter.style / setStyle('clean'|'minis') per CUT_A.md SR1; in Minis every piece is built with the legacy scaled-whole path (PieceOpts { frac, chunk: false }, no region), each with its own face, any piece can be the receiver of a join, the old limits (6 / 4 pieces, none under 1/8) apply, Reconnect all ends in a fresh whole. Not in this slice: join gestures between non-twins, Undo cut, the camera peek, S4 (the harness re-spec: keep the old rows green where they still apply; for rows that encode the old chunk behaviour list them for the orchestrator, do not delete them yet). Run node_checks and probe_app and report; the real-physics node rows may stay red-by-design where the old chunk build is now unused (list them).`),
  () => task('RENDER', 'Leg 3: render-2', `Task R1 of CUT2.md 14 (line 713), PART 2, with section 8 (388-462) and 12.1. The previous leg did part 1 (read CUT_A_RENDER.md). Part 2: eyes (membership by the piece that contains them, pose, clip of a straddled eye at the live cut face), core offset and clip (the ember core), aRest continuity (pattern continuity across the cut), StageLike.eyeAnchors (8.7), setPrimaryBody and idempotent addBody if the shell needs them (read what SHELL's leg 3 uses: CUT_A_SHELL.md), face-aware seam hook only as far as section 8.5 says for milestone A. Render probes RP1, RP3, RP4, RP5, RP7 on the real piece builder from PHYS where it exists (src/physics/piece.ts), else the stub. Filmstrips of a centre cut between the eyes and a swipe through an eye as images you READ and judge (is it clearly a halved squishy with one eye on each side, a flat cut face, no ball?). If the clipped-eye path fails RP2 choose the fallback ladder of 8.3 and say so.`),
])
log(`leg 3: ${leg3.map((r) => (r ? r.status : 'null')).join(', ')}`)
if (leg3.some((r) => !r)) { return { stoppedAt: 'leg 3', leg1, leg2, leg3, note: 'an engineer returned nothing. Re-run with resumeFromRunId.' } }

// ---------------------------------------------------------------- Gate
phase('Gate')
const gate = await task('INTEGRATION', 'Gate: integrate', `Task S5a of CUT2.md 14 (line 725) and 15 step 4: MILESTONE A on the REAL stack (real SoftBody, real stage, real shell), with MAX_PIECES 2 for the clean style. Fix only integration glue (in whichever file needs it; list each edit); anything deeper goes to requestsToOtherLanes. Produce, as images you READ and judge, at 960x600 and a 390x844 phone: Split in two between the eyes at a TURNED camera; a swipe between the eyes; a swipe through an eye; a horizontal swipe on gel, putty, sticky and foam; Reconnect all; and the Minis style (Split in two makes two complete minis with a full face each; Reconnect all). For each: is it clearly halves with one eye each side, a flat cut face, no little ball, no launch, nothing out of frame? Measure: pieces' volumes vs shares, the max speed of each piece in the first second on 12 species (one per family), frame cost vs 2 whole bodies, and the bundle gates (vite build prints G0 and G0b). Run ONLY node_checks, probe_app, probe_cut, probe_truecut and the browser sections that touch the cut (--only=). Save the images under ${REPO}/_handoff/reports/cut_a_gate/ (small PNGs, at most 12 files). Write ${REPO}/_handoff/reports/CUT_A_GATE.md (at most 10 KB): a plain verdict for the owner (what you see in each image) and the numbers.`)
log(`gate: ${gate ? gate.status : 'null'}`)
if (!gate) return { stoppedAt: 'gate', leg1, leg2, leg3 }

// ---------------------------------------------------------------- Verify
phase('Verify')
const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    findings: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, severity: { type: 'string', enum: ['MAJOR', 'MINOR'] }, title: { type: 'string' }, repro: { type: 'string' }, evidence: { type: 'string' } }, required: ['id', 'severity', 'title', 'repro', 'evidence'] } },
    reportPath: { type: 'string' },
  },
  required: ['verdict', 'findings', 'reportPath'],
}
const vprompt = (lens, port, what) => `${PRE.replace('You are a senior engineer', 'You are an INDEPENDENT VERIFIER (you did not write this code), a senior engineer')}

YOUR LANE: VERIFY (${lens}). Verify the committed working tree as it stands on a SNAPSHOT (method: ${REPO}/_handoff/briefs/VERIFY.md; use ports ${port} to ${port + 2}). BUDGET: at most 3 hours and 250 tool calls; the report at most 12 KB; run only what you need, not the whole 68 minute browser harness. Do NOT edit the game. ${what}
Use REAL pointer events (Playwright mouse, keyboard, CDP touch), not the debug hook, for anything about input. Judge pictures you took. Findings need a repro and evidence; MAJOR = does not deliver the owner's request ("a REAL cut, one eye each side, clean cuts, not a little ball"; the Minis style) or breaks an existing guarantee. Write the report to ${REPO}/_handoff/reports/CUT_A_VERIFY_${lens.toUpperCase().replace(/[^A-Z]/g, '')}.md and return the structured result.`
const verifiers = await parallel([
  () => agent(vprompt('physics', 5410, 'Lens PHYSICS: CUT2.md 12 and 13 rows X01, X02, X04, X07, X08, X13, X21 to X23 and the G/L/C/M rows that exist; volumes, the launch speed of every new piece on all 50 species x 3 planes (the old defect: 1.5 to 14 m/s), folds, determinism, allocation, perf (6 pieces <= 2 bodies, here 2 pieces), Reconnect all exact (rest shape, genome, volume), Minis volumes and faces on 50 species.'), { label: 'verify-phys', phase: 'Verify', schema: VERIFY_SCHEMA }),
  () => agent(vprompt('shellrender', 5413, 'Lens SHELL + RENDER: the owner scenarios in a real browser at 960x600 and 390x844: Split in two between the eyes at a turned camera, swipes (between the eyes, through an eye, horizontal), the refusal lines, Reconnect all, the leave paths (switch, Hoard, capsule, hidden tab), Minis (style setter, two complete faces, joins), the Cut bar text, keyboard-only use (X10), the flash gate (X09), the cut-face picture on at least 6 families, the size gates G0/G0b, a console/CSP check, and that nothing pays the meter.'), { label: 'verify-shell-render', phase: 'Verify', schema: VERIFY_SCHEMA }),
])
log(`verify: ${verifiers.map((v) => (v ? v.verdict + ' ' + v.findings.length : 'null')).join(', ')}`)
const findings = verifiers.filter(Boolean).flatMap((v) => v.findings.map((f) => ({ ...f, from: v.reportPath })))

// ---------------------------------------------------------------- Fix
phase('Fix')
let fix = null, reverify = []
if (findings.length) {
  fix = await task('ALL', 'Fix: fix-1', `Fix the verifiers' findings (reports: ${verifiers.filter(Boolean).map((v) => v.reportPath).join(', ')}): MAJORs first, then MINORs that are cheap. You may edit any file the finding lives in, one finding at a time, tsc clean after each; re-run each finding's own repro. Findings that are PHYS-owned deep problems and cannot be fixed in 3 hours: say so with the measured state instead of loosening a check. Findings: ${JSON.stringify(findings).slice(0, 6000)}`)
  if (fix) {
    reverify = (await parallel(verifiers.filter(Boolean).map((v, i) => () => agent(vprompt(i === 0 ? 'physics-r1' : 'shellrender-r1', 5420 + i * 3, `RE-VERIFICATION of the fix round: re-run ONLY the findings in ${v.reportPath} (their own repros) and a short regression pass of the rows next to them. Fix report: ${fix.reportPath}.`), { label: `reverify-${i === 0 ? 'phys' : 'shell-render'}`, phase: 'Fix', schema: VERIFY_SCHEMA })))).filter(Boolean)
  }
}
return { leg1, leg2, leg3, gate, verifiers, fix, reverify }
