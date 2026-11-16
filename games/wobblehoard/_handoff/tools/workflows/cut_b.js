export const meta = {
  name: 'squish-cut-b',
  description: 'Squish Keeper CUT-B: make the first true-cut slice FEEL right (physics contact P5, neck P4, render framing SR2, shell parting + harness re-spec S4), re-run the gate, then two independent verifiers with running reports and one fix round',
  phases: [
    { title: 'Leg 1', detail: 'PHYS P5 (collide: flush faces, no hop onto the twin, no launch) | RENDER SR2 (framing honours the safe insets)' },
    { title: 'Leg 2', detail: 'PHYS P4 (neck latch, depth, centring) | SHELL S4 (parting, harness re-spec, bar labels)' },
    { title: 'Gate', detail: 'integration: the whole browser harness by script, gate pictures, X13 numbers on 12 families' },
    { title: 'Verify', detail: 'two independent verifiers on a snapshot (running reports), then one fix round and re-verification' },
  ],
}

const REPO = 'C:/Users/TestRun/Claude Claw/squish-keeper-build/games/wobblehoard'
const SCR = 'C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-AppData-Roaming-Claude-scratch-workspaces-10f6a62c-5610-424a-ba29-8c51dbde9f88-b3ecf43b-de12-4070-80de-e1daecc887bf-scratch-2026-10-06-8a5967/3b1103ab-0174-4d88-adc9-dd448a718f0d/scratchpad'

const PRE = `You are a senior engineer on Squish Keeper (folder ${REPO}; Windows; Bash tool with POSIX syntax and forward slashes; your scratch folder is ${SCR}/<your lane>/).
FIRST read ${REPO}/_handoff/briefs/CUT_A.md COMPLETELY (the owner's words, the HARD BUDGET and the environment rules bind you; this is the second build round, CUT-B: tasks P4, P5, P8, SR2 and S4 are now IN scope, the Minis style and the clean style both exist), then ${REPO}/_handoff/reports/CUT_A_GATE.md (9 KB: what the owner saw and what is wrong: READ sections 1, 3 and 5), then your lane's running report (CUT_A_PHYS.md, CUT_A_RENDER.md or CUT_A_SHELL.md). The build contract is ${REPO}/_spec/CUT2.md, 969 lines: NEVER read it whole; read only the line ranges your task names (3 model = 86-120; 4 physics geometry = 121-174; 5 solver = 175-265: 5.1 launch fix 179-188, 5.2 resting 189-197, 5.3 fold limit 198-201, 5.4 neck 202-217, 5.5 collide 218-228, 5.6 planCut 229-237; 6 shell cutting = 266-328 (6.5 scripted parting = 300-315); 8 render = 388-462; 9 audio/meter/text/debug = 463-507; 12 acceptance = 608-663; 13 gates = 664-689; 14 tasks and file ownership = 690-750). Quote before you claim (path:line).
The owner has seen the first pictures of the real cut and says they look great. What is NOT yet right (CUT_A_GATE.md): after Split in two the starter Dollop's halves hop (one climbs 0.64 m onto its twin), capnap launches 2.25 m/s and kneadle hops, a horizontal swipe slides the upper piece 0.9 to 1.3 m, the Cut bar and dock cover the lower 30 percent of a 960x600 frame, and 8 old chunk-era harness rows are red by design.
KEEP A RUNNING REPORT: after every finished item write it (measured numbers, next step) to your lane's report file in ${REPO}/_handoff/reports/ (at most 12 KB): an interruption (the session was restarted once already and killed two verifiers that had written nothing) must lose little.
Edit only the files your lane owns (CUT2.md 14 "File ownership"). tsc clean after every task. Never run a git write command; the orchestrator commits. At the end return the structured summary.`

const LEG_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    tasksDone: { type: 'array', items: { type: 'string' } },
    tasksNotDone: { type: 'array', items: { type: 'string' } },
    measured: { type: 'array', items: { type: 'string' } },
    filesChanged: { type: 'array', items: { type: 'string' } },
    reportPath: { type: 'string' },
    blockers: { type: 'array', items: { type: 'string' } },
    requestsToOtherLanes: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'tasksDone', 'tasksNotDone', 'measured', 'filesChanged', 'reportPath', 'blockers', 'requestsToOtherLanes'],
}
const task = (lane, label, text) => agent(`${PRE}\n\nYOUR LANE: ${lane}. YOUR LEG: ${label}.\n${text}`, { label, phase: label.split(':')[0], schema: LEG_SCHEMA })

phase('Leg 1')
const leg1 = await parallel([
  () => task('PHYS', 'Leg 1: phys-p5', `Task P5 of CUT2.md 14 (line 708), with section 5.5 (218-228), 5.1 to 5.3 and 13. The flush-pair contact: the four scoped changes of 5.5 (scoped to pairs that contain a piece, so whole-body contact is untouched) + capFlat; probe rows L1, L7, L8, L9 (50 species x 3 planes with the REAL birth velocities, the fold bar) and L10 on 50 species; investigate swishel trial 1 (163 degrees) and marigel x0.5 (95 degrees). Success is MEASURED against X13 (rise <= 0.06 m, speed <= 1.0 m/s up, settle <= 1.2 m/s from 0.1 s after the swap) on the 12 family representatives of CUT_A_GATE.md section 3 (dollop, twangle, puddlo, crumbit, chunkle, wisplet, crimpo, boingle, dimpla, wrigglo, capnap, kneadle) through the whole game core in node (probe or script in _harness/ that drives the shell's Cutter with the real SoftBody, as the gate integration lane did: see its report) for: Split in two with the eye-midline plane, a swipe between the eyes, a level swipe: report the table before and after. The birth pop (1.1 to 2.7 m/s for one frame on every family) is part of the problem; the gate lane tried a 3 cm birth gap and REVERTED it (it removed the pop in node but not the real launches): so find the real cause with measurements (the contact normal at flush faces, the per-particle vs whole-body momentum removal, the foot) and fix it in softbody.ts collide / the constructor. Do not do P4 (the neck) here. Whole-body contact tests (probe_softbody, probe_cut B2 rows) must stay green; frame cost with 2 pieces must stay <= 1.1 x two whole bodies.`),
  () => task('RENDER', 'Leg 1: render-sr2', `Task SR2 (CUT2.md 8.6 framing and UI.md 4.2): StageLike.framingFor must honour setSafeInsets, so the squishy and its pieces are centred between insets.top and H - insets.bottom: the toolbar dock and the Cut options bar must never cover a piece (today they hide the lower 30 percent at 960x600, and 20 to 28 percent of the pieces at 844x390 / 568x320, and 2.2 percent at 358x201). hudBinding.ts already sends the correct insets (read it, do not edit it; it is the UI lane's). Frame TWO halves and Minis (two bodies side by side) so that nothing touches the top edge when one piece rests on the other, at 960x600, 390x844, 844x390, 568x320, 358x201, 320x568. Also keep the camera peek out of this task. Render probes for the framing (a cover measurement in the render harness: the share of each body's screen disc under the reported insets, bar 0 at rest and <= 25 percent transient) and the shell rows that read the cover (browser_shell sections fix2-dock, fix1-cover, toolbar-grid: run them with --only=; do not edit them, report). Also: the Reconnect bridge draws as a pale pill (CUT_A_GATE.md): improve it toward a soft gooey neck only if cheap (an hour at most). Files: src/render/*, _harness/renderview/*, _harness/browser_render.mjs.`),
])
log(`leg 1: ${leg1.map((r) => (r ? r.status : 'null')).join(', ')}`)
if (leg1.some((r) => !r)) { return { stoppedAt: 'leg 1', leg1, note: 'an engineer returned nothing (usage limit or restart?). Re-run with resumeFromRunId.' } }

phase('Leg 2')
const leg2 = await parallel([
  () => task('PHYS', 'Leg 2: phys-p4', `Task P4 of CUT2.md 14 (line 707) and the tuning part of P8 (line 711), with section 5.4 (202-217: the neck: latch, depth, generalised centring) and 13. The previous leg fixed the contact (read CUT_A_PHYS.md). P4: setNeck(plane, t, depth) with the latched rest plane and depth 0..1; the net-momentum measurement of 5.4 (50 species x 3 planes, bar 0.5 m/s at the swap) and the oblique-plane depth reduction if more than 2 miss; the swap-continuity metric; fit the per-family depth table (putty and slow-rise shallow, sticky and slime deep) and report it for the SHELL engineer (CUT2.md 6.3: gel / gummy / water / silicone / pop dome / beads 0.35, marshmallow 0.5, putty and slow-rise <= 0.25, sticky and slime 0.9: judge by measurement of the swell: the old swell on putty / slow-rise / firm silicone was x1.66 to x1.94; the bar is <= x1.25 on all families). Tuning: only what the X13 table and the L rows still show. Do not edit src/shell.`),
  () => task('SHELL', 'Leg 2: shell-s4', `Task S4 of CUT2.md 14 (lines 722-723) plus the parting. (1) S4-0 mechanical gate: grep -n -i "chunk\\|face piece\\|faceAnchor\\|SETTLE_\\|lobeCentres\\|halving\\|too small to split\\|peel" over _harness/ and every hit dispositioned in your report (re-spec / delete / keep with the reason); the 8 red rows named in CUT_A_GATE.md section 3 (X03 x2, SETTLE_S, SETTLE_GAP, X01 x2, A-F3 x2) are re-specified with the written reason 'the owner changed the design on 2026-10-08' (CUT2.md 14 lists each), new rows X03' to X06 and X10 to X12 in the NEW files _harness/shellview/cut_checks.ts and _harness/cut_browser.mjs; keep MAX_PIECES_CLEAN a constant the rows read. Also the cut-real / cut-x browser rows that expect 6 or 4 pieces must follow that constant. (2) The scripted parting (CUT2.md 6.5, lines 300-315): a horizontal swipe made the upper piece slide 0.9 to 1.3 m on the 16 degree slope: tune the parting (including the near-level case: hold the pair's relative offset, symmetric ramp, release) against the physics numbers of the previous leg (CUT_A_PHYS.md: the contact fix is in) and report X19 (parting reaches the gap +-20 percent by PART_S and holds to 4 s, drift < 1 cm). (3) src/shell/cutText.ts exports the Cut bar labels in the CutBarLabels shape of src/ui/cutContract.ts and cutBinding.ts passes them (the UI lane's request; read cutContract.ts, do not edit it). Run node_checks, probe_app, cutter_checks, cut_checks and the browser sections you touch with --only= (NOT the whole harness). Files: src/shell/{cut,cutRegion,cutText,cutBinding,bodies,debugHook}.ts, _harness/shellview/*, _harness/cut_browser.mjs and the cut rows of _harness/browser_shell.mjs.`),
])
log(`leg 2: ${leg2.map((r) => (r ? r.status : 'null')).join(', ')}`)
if (leg2.some((r) => !r)) { return { stoppedAt: 'leg 2', leg1, leg2, note: 'an engineer returned nothing. Re-run with resumeFromRunId.' } }

phase('Gate')
const gate = await task('INTEGRATION', 'Gate: integrate-2', `Re-run the Milestone A gate (CUT2.md 15 step 4 and the method of CUT_A_GATE.md, which you read): FIRST start the WHOLE browser harness in the background as a plain script (node _harness/browser_shell.mjs --quick --port=5405 > a log under your scratch; it takes about 70 minutes: do NOT watch it, look at the log once when everything else is done and report every failure verbatim). Meanwhile, on ports 5406-5409: the 12 sheets of the first gate again (Split in two between the eyes at a turned camera; a swipe between the eyes; a swipe through an eye; a horizontal swipe on gel, putty, sticky, foam; Reconnect all; Minis) at 960x600 and 390x844 with the NEW toolbar in the picture, judged by eye; the X13 table on the 12 families (rise, speed, settle, end state), the volumes vs shares, frame cost vs 2 whole bodies, the bundle gates; before/after against CUT_A_GATE.md. Fix only integration glue; deeper problems go to requestsToOtherLanes. Save at most 12 small PNGs in ${REPO}/_handoff/reports/cut_b_gate/ and write ${REPO}/_handoff/reports/CUT_B_GATE.md (at most 10 KB): a plain verdict for the owner (what you see in each picture, what is still wrong) and the numbers.`)
log(`gate: ${gate ? gate.status : 'null'}`)
if (!gate) return { stoppedAt: 'gate', leg1, leg2 }

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
const vprompt = (lens, tag, port, what) => `You are an INDEPENDENT VERIFIER (you did not write this code), a senior engineer on Squish Keeper (folder ${REPO}; Windows; Bash tool with POSIX syntax and forward slashes; scratch ${SCR}/verify_${tag}/).
FIRST read ${REPO}/_handoff/briefs/CUT_A.md (budget and environment rules bind you), ${REPO}/_handoff/briefs/VERIFY.md (the snapshot method; use ports ${port} to ${port + 2}), and ${REPO}/_handoff/reports/CUT_B_GATE.md. Contract: ${REPO}/_spec/CUT2.md (969 lines: read only the ranges you need: 12 acceptance = 608-663, 13 gates = 664-689). Verify the committed working tree on a SNAPSHOT; do NOT edit the game; no git write commands.
BUDGET: at most 3 hours and 250 tool calls; the report at most 12 KB; do not run the 70 minute whole browser harness (the integration lane ran it: read its log result). WRITE A RUNNING REPORT: create ${REPO}/_handoff/reports/CUT_B_VERIFY_${tag}.md at the START and append after EVERY finished item (a restart already killed two verifiers that had written nothing).
YOUR LENS: ${lens}. ${what}
Use REAL pointer events (Playwright mouse, keyboard, CDP touch), not the debug hook, for anything about input. Judge pictures you took. Findings need a repro and evidence; MAJOR = does not deliver the owner's request ("a REAL cut, one eye each side, clean cuts, not a little ball"; the Minis style; Reconnect all exact) or breaks an existing guarantee. End with the structured result.`
const verifiers = await parallel([
  () => agent(vprompt('PHYSICS', 'phys', 5410, 'CUT2.md 12 and 13 rows X01, X02, X04, X07, X08, X13, X19 to X23 and the G / L / C / M rows that exist: volumes, the X13 launch table on all 50 species x 3 planes (the old defect was 1.5 to 14 m/s: bars rise <= 0.06 m, speed <= 1.0 m/s, settle <= 1.2 m/s), folds, determinism, allocation per step, perf (2 pieces <= 1.1 x two whole bodies), the neck swell on every family (bar <= x1.25), Reconnect all EXACT (rest shape, genome, volume), Minis volumes and faces on all 50 species, whole-body physics unchanged (probe_softbody quick).'), { label: 'verify-phys', phase: 'Verify', schema: VERIFY_SCHEMA }),
  () => agent(vprompt('SHELL + RENDER', 'shellrender', 5413, 'The owner scenarios in a real browser at 960x600 and 390x844 with the NEW toolbar: Split in two between the eyes at a turned camera, swipes (between the eyes, through an eye, horizontal), the refusal lines, Reconnect all, the leave paths (switch, Hoard, capsule, hidden tab), Minis (style control in the Cut bar, two complete faces, joins), keyboard-only use (X10), the flash gate (X09), the cut-face picture on at least 6 families, framing (nothing covered by the dock or the Cut bar: SR2), the size gates G0 / G0b, console and CSP, and that nothing pays the meter.'), { label: 'verify-shell-render', phase: 'Verify', schema: VERIFY_SCHEMA }),
])
log(`verify: ${verifiers.map((v) => (v ? v.verdict + ' ' + v.findings.length : 'null')).join(', ')}`)
const findings = verifiers.filter(Boolean).flatMap((v) => v.findings.map((f) => ({ ...f, from: v.reportPath })))

let fix = null, reverify = []
if (findings.length) {
  fix = await task('ALL', 'Verify: fix-1', `Fix the verifiers' findings (reports: ${verifiers.filter(Boolean).map((v) => v.reportPath).join(', ')}): MAJORs first, then cheap MINORs; one finding at a time, tsc clean after each, re-run each finding's own repro. Findings that are deep PHYS problems you cannot fix in 3 hours: say so with the measured state instead of loosening a check. Findings: ${JSON.stringify(findings).slice(0, 6000)}`)
  if (fix) {
    reverify = (await parallel(verifiers.filter(Boolean).map((v, i) => () => agent(vprompt(i === 0 ? 'PHYSICS re-verification' : 'SHELL + RENDER re-verification', i === 0 ? 'physr1' : 'shellrenderr1', 5420 + i * 3, `RE-VERIFY the fix round: re-run ONLY the findings in ${v.reportPath} (their own repros) and a short regression pass of the rows next to them. Fix report: ${fix.reportPath}.`), { label: `reverify-${i === 0 ? 'phys' : 'shell-render'}`, phase: 'Verify', schema: VERIFY_SCHEMA })))).filter(Boolean)
  }
}
return { leg1, leg2, gate, verifiers, fix, reverify }
