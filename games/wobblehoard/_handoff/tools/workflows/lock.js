export const meta = {
  name: 'squish-lock',
  description: 'Squish Keeper LOCK + MULTI-PULL + GROUND FIX: Shift taps lock a fully stretched pull where it is, Esc / a press releases, 5 fingers on phones, a floor under every grab; PHYS and SHELL in parallel, then real-input integration, two independent verifiers and one fix round',
  phases: [
    { title: 'Build', detail: 'PHYS slots, locks, ground floor | SHELL Shift key, Esc, gestures, driver, hint' },
    { title: 'Integrate', detail: 'real mouse / keyboard / touch on the live game, lock marker, sound, pictures' },
    { title: 'Verify', detail: 'two independent verifiers (physics, shell) with running reports, one fix round, re-verify' },
  ],
}

const REPO = 'C:/Users/TestRun/Claude Claw/squish-keeper-build/games/wobblehoard'
const SCR = 'C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-AppData-Roaming-Claude-scratch-workspaces-10f6a62c-5610-424a-ba29-8c51dbde9f88-b3ecf43b-de12-4070-80de-e1daecc887bf-scratch-2026-10-06-8a5967/3b1103ab-0174-4d88-adc9-dd448a718f0d/scratchpad'
const MODEL = 'sonnet'

const PRE = `You are a senior engineer on Squish Keeper (folder ${REPO}; Windows; Bash tool with POSIX syntax and forward slashes; your scratch folder is ${SCR}/<your lane>/).
FIRST read ${REPO}/_spec/LOCK.md COMPLETELY (4 KB: the owner's words and decisions, the rules, the build outline), then the 'Hard budget' and 'Environment and rules' sections of ${REPO}/_handoff/briefs/CUT_A.md (they bind you: 3 hours and about 250 tool calls per leg, a RUNNING REPORT written after every finished step, no whole-harness runs, node entry points not npx, ports 5450 to 5459 for you, never a git write command, tsc clean after every step, never loosen a check), then ${REPO}/_handoff/briefs/RESUME.md quickly. Quote before you claim (path:line).
THE OWNER'S WORDS (2026-10-06, repeated 2026-10-09: "clicking SHIFT after a full hold still doesn't lock the squishy where it is"): "What if left click and hold, then clicking SHIFT locks in the pull, and then I can left click and hold, SHIFT, to lock it into a lone place. A star for example has 5 corners: it would be cool to lock all of them in and do a 5 way stretch. We can only LOCK with SHIFT when it is FULLY stretched, and it retains the hold XP." Decisions: tap Shift while a lobe is pulled with the left mouse and fully stretched (pull level >= 0.95) locks it where it is and frees the mouse; pressing a locked lobe lets it snap back; Esc releases all; phones: up to 5 fingers on the squishy (each its own press / pull), no lock on phones; hold XP pays on RELEASE as if held the whole time, capped as today (1.0 + 0.65 x min(held, 3) per lobe, freshness applies); locking pays nothing itself. Plus the GROUND FIX: pulling the squishy INTO the ground folds it (measured: a lone finger dragged down past the pick-up line folds 5 of 12 species to about 180 degrees, twangle turns inside out) because only a Shift pair has a floor (SHIFT_FLOOR_Y): give every grab target and the carry a floor, and make the probe NOT clamp the target above the table.
THE SEAM (both lanes code to exactly this; PHYS adds it to src/contracts.ts, additive and optional, in ONE small commit-ready edit at the start of its leg, and says so in its report; the SHELL engineer feature-detects it): SoftBodyLike gains lockGrab?(slot: number): boolean (true when it locked: the grab on that slot has pull >= 0.95; the patch keeps its goal at the locked target; the grab slot is freed), releaseLock?(index: number | 'all'): void (fires the normal 'snap' event per lock with heldFor = the whole hold since the grab and intensity = the pull level, so the meter pays it as a pull), lockAt?(point: V3): number (index of the lock whose patch the world point is on, else -1), SoftMetrics.locked?: number (count). The finger / grab slot id widens from 0 | 1 to 0 | 1 | 2 | 3 | 4 (fingerDown, fingerMove, fingerUp, fingerPressure, grab, grabMove, grabRelease, tip, and the event 'finger' fields); a slot beyond the old two is only used by touch fingers on phones. The twoHanded latch (commit 19f62137) counts locks as hands: two or more hands (fingers, grabs, locks) mean the body is never picked up. At most 6 locks (4 on low quality); a lock beyond that is refused cleanly.
Lanes: PHYS owns src/physics/softbody.ts (the grab / finger / carry / lock regions only: the CUT team's regions are not being edited this week but their tests must stay green) and the LOCK block of src/contracts.ts. SHELL owns src/input/*, src/shell/driver.ts, src/shell/game.ts (the input port only), src/ui/hint.ts, the keys line of the Settings panel copy (src/ui/screens/screenCopy.ts or src/ui/settingsPanel.ts), the live-region strings, and _harness/shellview rows for input. The UI team's files (toolbar, menu) are not yours.`

const LEG_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    stepsDone: { type: 'array', items: { type: 'string' } },
    stepsNotDone: { type: 'array', items: { type: 'string' } },
    measured: { type: 'array', items: { type: 'string' } },
    filesChanged: { type: 'array', items: { type: 'string' } },
    reportPath: { type: 'string' },
    blockers: { type: 'array', items: { type: 'string' } },
    requestsToOtherLanes: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'stepsDone', 'stepsNotDone', 'measured', 'filesChanged', 'reportPath', 'blockers', 'requestsToOtherLanes'],
}
const job = (lane, label, text) => agent(`${PRE}\n\nYOUR LANE: ${lane}. LEG: ${label}.\nRunning report: ${REPO}/_handoff/reports/LOCK_${lane.split(' ')[0].toUpperCase()}.md (at most 12 KB; if it exists, continue from it).\n${text}`, { label, phase: label.split(':')[0], schema: LEG_SCHEMA, model: MODEL })

phase('Build')
const build = await parallel([
  () => job('PHYS', 'Build: lock-phys', `Build LOCK.md section 3 PHYS: (a) the contract edit above; (b) up to 5 concurrent finger/grab slots in softbody.ts (the touch fingers; everything per slot), a lock list: lockGrab keeps the grabbed patch's goal at its locked target after the pointer leaves and counts the hold time since the grab; releaseLock fires the normal snap event (heldFor = the whole hold, intensity = the pull level); lockAt; metrics.locked; (c) the twoHanded latch counts locks as hands; a locked body cannot be lifted or tossed; (d) the GROUND FIX: a floor for every grab target and for the carry (read SHIFT_FLOOR_Y, startCarry, updateGrabs), and a probe that does NOT clamp the target above the table: new rows in _harness/probe_cut.ts or a new _harness/probe_lock.ts (register in run_probes.ts) with INDEPENDENT measurements: for 12+ species: a long drag straight down, angled down, sideways with the real un-clamped targets: fold angle (bar: no crease past 120 degrees), volume (0.85 to 1.15 of rest), no inversion, no particle below the table; (e) every fold, hop and robustness gate per lock count (1 to 6 lobes on a species with many lobes: find the species with 5 or more tips in src/data/species.ts and src/physics/shape.ts), orders of lock and release, NaN, determinism (two runs equal hashes), zero allocation per step, perf with 6 locks no worse than 2 whole bodies. Existing physics probes stay green: probe_softbody --quick, probe_cut, probe_flush (quick) and probe_truecut.`),
  () => job('SHELL', 'Build: lock-shell', `Build LOCK.md section 3 SHELL: the Shift keydown (not on key repeat, not inside a form control, Shift alone must not count as a key used for the hint) calls lockGrab on the active mouse pull (feature-detected; when the pull is below 0.95 or the body cannot lock: nothing happens, no sound); a mirrored Shift pull (Shift held when the pull began, src/input/gestures.ts) stays as it is, and a Shift tap during a mirrored pair locks both hands when both are fully stretched; a press on a locked lobe (lockAt) releases it (it snaps back and the meter sees a normal pull release); Esc releases all locks (BEFORE it closes a panel only when a lock exists and no panel is open: read how Esc is routed in src/input/keyboard.ts and the UI's Esc precedence in UI.md 4.5); the gesture machine's Slot widens to 0 to 4 for touch (src/input/gestures.ts, keep the 128 rows of probe_gestures green and add rows for 3, 4 and 5 fingers); src/shell/driver.ts maps each finger to a physics slot; the meter sees each release as a normal pull (do not change src/core/meter.ts); the hint and the Settings keys line say 'Shift while stretched fully locks a pull; Esc lets go'; leaving releases every lock first (switching squishy, Hoard, capsule, merge, Cut or Snap tool, hidden tab over 60 s, reload: LOCK.md rule 3). Also a tiny UI feedback hook the render lane can use: game.ts exposes the lock points to the stage via an optional stage.setLockMarkers?(points: V3[]) call (feature-detected; render adds it in the next leg), and calls audio.ui({ kind: 'on' }) at a lock and ({ kind: 'off' }) at a release when SquishAudio.ui exists. Until PHYS lands lockGrab, build against a mock body in _harness (extend the existing mocks) and keep node_checks, probe_app, probe_gestures green. Rows for: Shift tap with a full pull locks, below 0.95 does nothing, a second lobe, Esc releases all, a press releases one, leave paths, hint text.`),
])
log(`build: ${build.map((r) => (r ? r.status : 'null')).join(', ')}`)
if (build.some((r) => !r)) return { stoppedAt: 'build', build, note: 'an engineer returned nothing. Re-run with resumeFromRunId.' }

phase('Integrate')
const integ = await job('INTEGRATION', 'Integrate: lock-integrate', `Make it work for REAL on the live game with REAL input (Playwright mouse and keyboard, CDP touch), 960x600 and 390x844: left press on a lobe, drag until fully stretched (metrics.pull >= 0.95), tap Shift: the lobe stays locked where it is, the mouse is free; press and fully stretch a second lobe, Shift again; on a species with 5 or more tips lock all of them (a 5-way stretch); press a locked lobe: it snaps back and pays; Esc releases the rest; Shift pressed too early does nothing; the hold XP: measure the SP paid on release against the cap (1.0 + 0.65 x min(held, 3)); phones: 3, 4 and 5 touch fingers on the squishy at once (CDP multi-touch), the body is never picked up while two or more hands are on it. Add the lock marker in the render lane's stage (src/render: stage.setLockMarkers?(points): a thin ring or glow at each locked patch, calm variant, flash governor applies; keep it small, an hour) and verify the lock sound call. Fix integration glue in whichever file needs it (list each edit); deeper problems go to requestsToOtherLanes. Read screenshots as an art director (is a locked lobe clearly locked?). Save at most 8 small PNGs in ${REPO}/_handoff/reports/lock_gate/ and write ${REPO}/_handoff/reports/LOCK_GATE.md (at most 8 KB) with a plain verdict for the owner and the numbers. Run ONLY the sections you touch (node_checks, probe_app, probe_gestures, probe_lock, browser sections with --only=).`)
log(`integrate: ${integ ? integ.status : 'null'}`)
if (!integ) return { stoppedAt: 'integrate', build }

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
FIRST read ${REPO}/_spec/LOCK.md, the 'Hard budget' and 'Environment' sections of ${REPO}/_handoff/briefs/CUT_A.md, ${REPO}/_handoff/briefs/VERIFY.md (the snapshot method; use ports ${port} to ${port + 2}) and ${REPO}/_handoff/reports/LOCK_GATE.md. Verify the committed working tree on a SNAPSHOT; do NOT edit the game; no git write commands.
BUDGET: at most 3 hours and 250 tool calls; the report at most 12 KB; no 70 minute whole harness. WRITE A RUNNING REPORT: create ${REPO}/_handoff/reports/LOCK_VERIFY_${tag}.md at the START and append after EVERY finished item (a restart already killed two verifiers that had written nothing).
YOUR LENS: ${lens}. ${what}
Use REAL pointer / keyboard / touch events, not the debug hook. Findings need a repro and evidence; MAJOR = does not deliver the owner's request or breaks an existing guarantee. End with the structured result.`
const verifiers = await parallel([
  () => agent(vprompt('PHYSICS', 'phys', 5460, 'Locks on 50 species: 1 to 6 locks, orders of lock and release, folds (no crease past 120 degrees), volume, no inversion, NaN, determinism (equal hashes), allocation, perf (6 locks <= 2 whole bodies), the ground fix with UN-CLAMPED downward targets on 50 species (the old defect: 5 of 12 folded to 180 degrees, twangle inside out), the twoHanded rule with locks, pickup unchanged for a lone hand, whole-body physics probes unchanged (probe_softbody quick, probe_cut, probe_flush quick).'), { label: 'verify-lock-phys', phase: 'Verify', schema: VERIFY_SCHEMA, model: MODEL }),
  () => agent(vprompt('SHELL', 'shell', 5463, 'The owner scenarios in a real browser with real input: Shift tap after a full pull locks (and does nothing before 0.95), a second and a fifth lobe on a many-tipped species, a press releases one, Esc releases all, the mirrored Shift pull unchanged, 3 to 5 touch fingers on a phone, XP on release against the cap (no double pay, nothing paid for locking or for leaving locks standing), the leave paths release locks, Settings and hint text, the Shift key not counted as a key used, key repeat ignored, Shift inside a form control ignored, the meter and tasks unaffected, the marker and the sound.'), { label: 'verify-lock-shell', phase: 'Verify', schema: VERIFY_SCHEMA, model: MODEL }),
])
log(`verify: ${verifiers.map((v) => (v ? v.verdict + ' ' + v.findings.length : 'null')).join(', ')}`)
const findings = verifiers.filter(Boolean).flatMap((v) => v.findings.map((f) => ({ ...f, from: v.reportPath })))
let fix = null, reverify = []
if (findings.length) {
  fix = await job('ALL', 'Verify: lock-fix', `Fix the verifiers' findings (reports: ${verifiers.filter(Boolean).map((v) => v.reportPath).join(', ')}): MAJORs first, then cheap MINORs; one at a time, tsc clean after each, re-run each finding's own repro. A deep PHYS problem you cannot fix in 3 hours: say so with the measured state instead of loosening a check. Findings: ${JSON.stringify(findings).slice(0, 6000)}`)
  if (fix) {
    reverify = (await parallel(verifiers.filter(Boolean).map((v, i) => () => agent(vprompt(i === 0 ? 'PHYSICS re-verification' : 'SHELL re-verification', i === 0 ? 'physr1' : 'shellr1', 5470 + i * 3, `RE-VERIFY the fix round: re-run ONLY the findings in ${v.reportPath} (their own repros) and a short regression pass of the rows next to them. Fix report: ${fix.reportPath}.`), { label: `reverify-lock-${i === 0 ? 'phys' : 'shell'}`, phase: 'Verify', schema: VERIFY_SCHEMA, model: MODEL })))).filter(Boolean)
  }
}
return { build, integ, verifiers, fix, reverify }
