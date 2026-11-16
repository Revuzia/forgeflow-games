export const meta = {
  name: 'squish-ui-5',
  description: 'Squish Keeper UI verification: three independent verifiers on a git-archive snapshot of the committed UI (art director with the parity scorecard; accessibility and modes; performance, size, regression, portal), running reports, one fix round, re-verification of the findings only',
  phases: [
    { title: 'Verify', detail: 'V1 art director | V2 accessibility + modes | V3 robustness, performance, size, regression, portal' },
    { title: 'Fix', detail: 'one fix round, then re-verify only the findings' },
  ],
}

const REPO = 'C:/Users/TestRun/Claude Claw/squish-keeper-build/games/wobblehoard'
const ROOT = 'C:/Users/TestRun/Claude Claw/squish-keeper-build'
const SCR = 'C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-AppData-Roaming-Claude-scratch-workspaces-10f6a62c-5610-424a-ba29-8c51dbde9f88-b3ecf43b-de12-4070-80de-e1daecc887bf-scratch-2026-10-06-8a5967/3b1103ab-0174-4d88-adc9-dd448a718f0d/scratchpad'
const MODEL = 'sonnet'
const COMMIT = '44cc7aca'

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    findings: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, severity: { type: 'string', enum: ['MAJOR', 'MINOR'] }, title: { type: 'string' }, repro: { type: 'string' }, evidence: { type: 'string' } }, required: ['id', 'severity', 'title', 'repro', 'evidence'] } },
    reportPath: { type: 'string' },
  },
  required: ['verdict', 'findings', 'reportPath'],
}
const FIX_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    fixed: { type: 'array', items: { type: 'string' } },
    notFixed: { type: 'array', items: { type: 'string' } },
    measured: { type: 'array', items: { type: 'string' } },
    filesChanged: { type: 'array', items: { type: 'string' } },
    reportPath: { type: 'string' },
  },
  required: ['status', 'fixed', 'notFixed', 'measured', 'filesChanged', 'reportPath'],
}

const vprompt = (lens, tag, port, what) => `You are an INDEPENDENT VERIFIER (you did not write this code), a senior front-end / QA engineer on Squish Keeper (folder ${REPO}; Windows; Bash tool with POSIX syntax and forward slashes; scratch ${SCR}/verify_ui_${tag}/).
FIRST read ${REPO}/_handoff/briefs/UI_BUILD.md (its HARD BUDGET and environment rules bind you), ${REPO}/_spec/UI.md IN FULL (the build contract: sections 2 scorecard, 4 toolbar, 5 type, 6 screens, 7 motion / sound / modes, 9 acceptance K01 to K16, 9.1), ${REPO}/_handoff/briefs/VERIFY.md (the snapshot idea; use ports ${port} to ${port + 2}) and ${REPO}/_handoff/reports/UI_B7.md (what the builders claim and their own listed weak spots).
SNAPSHOT: do NOT verify the live tree (other engineers are editing physics, render and input in it right now). Make a stable copy of the commit ${COMMIT}: mkdir your scratch snapshot folder, then git -C "${ROOT}" archive ${COMMIT} games/wobblehoard | tar -x -C <snapshot>, then a directory junction for node_modules to ${REPO}/node_modules (cmd /c mklink /J), exactly as VERIFY.md describes for the junction. Do NOT edit the game; no git write commands.
BUDGET: at most 3 hours and about 250 tool calls; the report at most 12 KB; do not run more of the 68 minute browser harness than your lens needs. WRITE A RUNNING REPORT from the start: create ${REPO}/_handoff/reports/UI_VERIFY_${tag}.md first and append after EVERY finished item (an earlier restart killed two verifiers that had written nothing).
YOUR LENS: ${lens}. ${what}
Use REAL pointer, keyboard and touch events (Playwright mouse / keyboard / CDP touch), measure on real pixels, judge the pictures you take. Findings need a repro and evidence; MAJOR = does not reach the bar of UI.md or breaks something. End with the structured result.`

phase('Verify')
const verifiers = await parallel([
  () => agent(vprompt('V1 ART DIRECTOR', 'v1', 5540, 'Fill the PARITY SCORECARD of UI.md section 2: for every named criterion give the studio level (BLOCKTOOTH / DYEFIELD per the reference memos in _handoff/design/UI_REF_*.md and UI_SQUISH_NOW.md), the target, and YOUR score 1 to 5 of the built UI with a picture as evidence; score every screen (title and loading, play HUD with the toolbar and the three tools plus Table | Float, Menu / pause, Settings, How to play, Credits, Hoard shelf / card, merge pad and Tidy-up, tasks, reveal plates, Trophies, Records, toasts, offline and error cards, photo card) at the 7 design sizes (1280x800, 888x500, 390x844, 844x390, 568x320, 358x201, 320x568), and list everything cheap, inconsistent, ugly, cramped, clipped, low-contrast or off-brand with a screenshot name. Check the drawn jelly lettering at every use (title, headings, rarity names, numerals): legible, consistent, bounce only in the title and off in Calm. A score under 3 on any screen at any size, or any target not met, is a finding.'), { label: 'verify-ui-v1', phase: 'Verify', schema: VERIFY_SCHEMA, model: MODEL }),
  () => agent(vprompt('V2 ACCESSIBILITY AND MODES', 'v2', 5543, 'K01 text and UI contrast on REAL PIXELS for every text box on every screen and state (text 4.5, large text and UI parts 3; screenshots with and without text, Playwright bypassCSP), K02 hit boxes by an elementFromPoint grid at the 8 kit sizes, K03 reflow at 320x568, text-spacing, rtl, a 50-character nickname, an Arial-only stack, K04 a Tab-only walk of every screen incl. the Esc precedence (UI.md 4.5) and focus return, K08 forced-colors and contrast-more pixel diffs (switch on vs off, selected segment, slider fill, active tool differ; jelly shows real text) and Calm (0 transform animations after settle), K14 jelly accessible names (one rendered h1, aria-labels, the glyph counter rule), K16 tooltips (WCAG 1.4.13 hoverable, dismissable, persistent), live-region lines for every action (tool pick, Table / Float, cut, locks if present), screen-reader names of every control, the ordering of the DOM, prefers-reduced-motion. Also the Table | Float pair and the toolbar roving tabindex.'), { label: 'verify-ui-v2', phase: 'Verify', schema: VERIFY_SCHEMA, model: MODEL }),
  () => agent(vprompt('V3 ROBUSTNESS, PERFORMANCE, SIZE, REGRESSION, PORTAL', 'v3', 5546, 'FIRST start the WHOLE browser harness on your snapshot in the background as a plain script (node _harness/browser_shell.mjs --quick --port=' + (5546) + ' > a log in your scratch; about 70 minutes; do not watch it: read the log once at the end and classify every failure: UI / CUT / LOCK / pre-existing; rows that name Toys or the Settings gravity row must already be re-specified). Meanwhile: K05 the size gates G0 and G0b from a real vite build of the snapshot and the CSS caps (<= 120 KB raw and <= 30 KB gzip), K06 frame cost with the HUD animating vs hidden (interleaved A/B, delta of medians <= 1.0 ms, also at 4x CPU throttle and in Quality low; no layout shift; no transition: all), K07 strict CSP on the built dist served with the documented CSP headers: 0 violations on every screen incl. boot and the photo card, K09 UI sounds (12 kinds counted, none before unlock, none on touch hover, peaks <= 0.126, mute), K10 the exact PORTAL sandbox: serve the dist inside _harness/portal/bridge_host.html at 888x500 and 358x201 with the portal iframe sandbox and allow strings (see _handoff/design/PUBLISH_CHECKLIST_SHORT.md): __PAUSE__ / pause and resume, fullscreen (denied gracefully), the photo card works without allow-downloads, the bridge messages (whoami, achievement once per slug, score, save/load) match the memo and standalone mode posts nothing, localStorage works, K11 collision grid (nothing under the dock / Cut bar / toasts at 8 sizes and heights 460 / 568 / 640 / 740), K12 the Toys end-state grep (0 outside history comments), offline / error / context-loss cards, a hostile settings blob, reload in every state, a 30-minute idle soak is NOT required.'), { label: 'verify-ui-v3', phase: 'Verify', schema: VERIFY_SCHEMA, model: MODEL }),
])
log(`verify: ${verifiers.map((v) => (v ? v.verdict + ' ' + v.findings.length : 'null')).join(', ')}`)
const findings = verifiers.filter(Boolean).flatMap((v) => v.findings.map((f) => ({ ...f, from: v.reportPath })))

phase('Fix')
let fix = null, reverify = []
if (findings.length) {
  fix = await agent(`You are a senior front-end engineer on Squish Keeper (folder ${REPO}; Windows; Bash tool with POSIX syntax and forward slashes; scratch ${SCR}/ui_fix/). FIRST read ${REPO}/_handoff/briefs/UI_BUILD.md (HARD BUDGET and environment rules bind you: 3 hours / about 250 tool calls, node entry points not npx, ports 5550 to 5559, no git write commands, tsc clean, never loosen a check) and ${REPO}/_spec/UI.md sections 2 and 9. Fix the independent verifiers' findings in the LIVE tree (the CUT and LOCK teams are editing src/physics, src/render, src/shell/cut*.ts, src/input and driver.ts: do not touch those): reports ${verifiers.filter(Boolean).map((v) => v.reportPath).join(', ')}. MAJORs first, then cheap MINORs; one finding at a time, tsc clean after each, re-run each finding's own repro; keep the K05 CSS caps (<= 120,000 B raw and <= 30 kB gzip; delete dead rules to make room, never raise the cap) and every existing check green. A finding you cannot fix in 3 hours: say so with the measured state. Write a running block in ${REPO}/_handoff/reports/UI_RUN.md (at most 3 KB). Findings: ${JSON.stringify(findings).slice(0, 8000)}`, { label: 'Fix: ui-fix', phase: 'Fix', schema: FIX_SCHEMA, model: MODEL })
  if (fix) {
    reverify = (await parallel(verifiers.filter(Boolean).map((v, i) => () => agent(vprompt('RE-VERIFICATION of ' + ['V1', 'V2', 'V3'][i], 'r' + (i + 1), 5560 + i * 3, `RE-VERIFY the fix round: re-run ONLY the findings in ${v.reportPath} (their own repros / measurements) and a short regression pass of the rows next to them, on a FRESH git-archive of the current HEAD instead of ${COMMIT} (git -C "${ROOT}" rev-parse HEAD) if the fix report ${fix.reportPath} says its files are committed, else on a snapshot of the live files named in that report. Do not repeat what passed.`), { label: `reverify-ui-v${i + 1}`, phase: 'Fix', schema: VERIFY_SCHEMA, model: MODEL })))).filter(Boolean)
  }
}
return { verifiers, fix, reverify }
