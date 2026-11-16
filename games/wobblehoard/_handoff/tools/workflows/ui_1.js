export const meta = {
  name: 'squish-ui-1',
  description: 'Squish Keeper UI build, part 1: B0 foundations + B1 UI sound in parallel, then B2a the jelly glyph sheet (stops there so the owner can approve the lettering before everything is built on it)',
  phases: [
    { title: 'Leg 1', detail: 'UI-A B0 foundations (tokens, kit, icons, a11y hooks) | AUDIO B1 UI sounds' },
    { title: 'Leg 2', detail: 'UI-B B2a: the drawn jelly alphabet and its glyph sheet (owner gate)' },
  ],
}

const REPO = 'C:/Users/TestRun/Claude Claw/squish-keeper-build/games/wobblehoard'
const SCR = 'C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-AppData-Roaming-Claude-scratch-workspaces-10f6a62c-5610-424a-ba29-8c51dbde9f88-b3ecf43b-de12-4070-80de-e1daecc887bf-scratch-2026-10-06-8a5967/3b1103ab-0174-4d88-adc9-dd448a718f0d/scratchpad'

const PRE = `You are a senior front-end / audio engineer on Squish Keeper (folder ${REPO}; Windows; Bash tool with POSIX syntax and forward slashes; your scratch folder is ${SCR}/ui/<batch>/).
FIRST read ${REPO}/_handoff/briefs/UI_BUILD.md COMPLETELY (the owner's words, the HARD BUDGET and the environment rules bind you), then ${REPO}/_spec/UI.md in full (30 KB, the build contract), then ${REPO}/_handoff/briefs/RESUME.md quickly, and ${REPO}/_handoff/design/UI_SQUISH_NOW.md (10 KB: what is wrong today, with file and line). Quote before you claim (path:line).
If ${REPO}/_handoff/reports/UI_RUN.md exists, a previous engineer stopped mid-task: CONTINUE from it, never redo finished steps. Edit only the files your batch owns. tsc must stay clean after every step. Never run a git write command; the orchestrator commits.`

const LEG_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    stepsDone: { type: 'array', items: { type: 'string' } },
    stepsNotDone: { type: 'array', items: { type: 'string' } },
    measured: { type: 'array', items: { type: 'string' }, description: 'key numbers (contrast, sizes, bytes, counts) with results' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    pictures: { type: 'array', items: { type: 'string' }, description: 'paths of the key screenshots / sheets you made' },
    reportPath: { type: 'string' },
    blockers: { type: 'array', items: { type: 'string' } },
    requestsToOrchestrator: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'stepsDone', 'stepsNotDone', 'measured', 'filesChanged', 'pictures', 'reportPath', 'blockers', 'requestsToOrchestrator'],
}
const leg = (lane, label, text) => agent(`${PRE}\n\nYOUR BATCH: ${lane}. LEG: ${label}.\n${text}`, { label, phase: label.split(':')[0], schema: LEG_SCHEMA })

phase('Leg 1')
const leg1 = await parallel([
  () => leg('B0 Foundations (UI-A)', 'Leg 1: ui-b0', `Build UI.md section 8 batch B0 exactly: src/ui/theme.ts (tokens: colour incl. plum / surface3 / ring plus ink halo / opaque tool surfaces, the type scale, spacing, radii, elevation, motion durations and easings: today only colour exists), base.css, kit.css, a11y.css hooks (Calm, contrast-more and forced-colors tokens that every component class inherits), icons.ts (one original SVG icon family by the family rules in UI.md 3.3, replacing the ad-hoc glyphs the audit counted), motion.ts, layout.ts, the new CONTRAST_PAIRS in probe_app.ts, and the _harness/uikit/ skeleton: a page that shows every component in every state on mock data at the 8 kit sizes in 4 modes (normal, calm, contrast, forced-colors) with a shoot script (node _harness/uikit/shoot.mjs --batch B0; use pw.mjs; ports 5430-5434). Components of 3.3 (buttons with the full state matrix, switches, sliders, segmented controls, chips, cards, panels, modals, tooltips, toasts) are styled in kit.css but not yet wired into screens. Read the kit sheets you take and fix what an art director would reject. Do NOT restyle existing screens yet (later batches do). Existing checks stay green (run node_checks, probe_app and the browser sections the changed CSS could affect with --only=). Your first request to the orchestrator is already done (UiKind, SquishAudio.ui?, Settings.uiSounds are in contracts.ts and settings.ts).`),
  () => leg('B1 UI sound (AUDIO)', 'Leg 1: ui-b1', `Build UI.md section 7 "UI sound" and batch B1: src/audio/ui.ts (new) + the engine hook in src/audio/engine.ts so SquishAudio.ui({ kind, calm }) works: 12 procedural soft sine / triangle kinds (tick press select on off open close back error toast trophy sticker) on one pentatonic scale, peak <= -18 dBFS (stats().peak <= 0.126), gap 40-400 ms per kind, mute-aware, dropped before the first unlock and during ceremonies (except toast and trophy), no sound for hover on touch; the uiSounds setting (already in contracts.ts / settings.ts) gates it; src/input/haptics.ts gets the light uiTap haptic (the LOCK-SHELL engineer owns that file later; keep your change small and named). Probe rows in _harness/probe_audio.mjs: all 12 kinds counted in audio.stats(), none before unlock, peaks, rate limits, mute. You cannot listen: measure (level, length, click-free edges, pitch set) and say so. Bundle: report the bytes added (gzip).`),
])
log(`leg 1: ${leg1.map((r) => (r ? r.status : 'null')).join(', ')}`)
if (leg1.some((r) => !r)) return { stoppedAt: 'leg 1', leg1, note: 'an engineer returned nothing (usage limit?)' }

phase('Leg 2')
const leg2 = await leg('B2a Jelly glyph sheet (UI-B)', 'Leg 2: ui-b2a', `Build ONLY the first deliverable of batch B2 (UI.md 5 "THE SQUISHY DISPLAY TYPE" and 8 B2): the drawn jelly alphabet as SVG glyph paths in code (src/ui/jelly/glyphs.ts + a small renderer; A to Z, 0 to 9 and the punctuation the UI uses), authored the way UI.md 5 decides, with jelly shading (body gradient, gloss, soft contact shadow; CSSOM / classes only, no inline style attributes written as strings of CSS in HTML) and the optical-size rules (counter rule). Produce a GLYPH SHEET page in the kit (src/ui or _harness/uikit) and PNGs of it: the full alphabet + numerals at the cap sizes 24, 36 and 64 px, the words SQUISH KEEPER, HOARD, SETTINGS, TROPHIES, MENU, WAKE IT UP, a rarity word each (COMMON ... MYTHIC), and big numerals 0123456789, at 1280x800 and 390x844, normal and Calm modes. READ the pictures as a demanding art director: are the letters beautiful, readable, original, clearly jelly, consistent in weight and spacing, legible at 24 px? Iterate on the shapes until they are (spend your leg on the letterforms, not on plumbing). Measure the bytes (gzip). STOP after the sheet: the owner approves the lettering before anything is built on it. Do not build the title card yet. Save the final PNGs (small, at most 6 files) in ${REPO}/_handoff/reports/ui_glyph_sheet/ and describe in the report what you see in them.`)
log(`leg 2: ${leg2 ? leg2.status : 'null'}`)
return { leg1, leg2 }
