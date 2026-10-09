export const meta = {
  name: 'squish-ui-2',
  description: 'Squish Keeper UI build, part 2: title + boot on the approved jelly type (B2b) with the toolbar structure (B3a), then options bars (B3b) with the Hoard family (B5), then HUD wiring and toolbar harness rows (B3c, B3d). Stops with the toolbar ready for the owner to see.',
  phases: [
    { title: 'Leg 1', detail: 'UI-B B2b title card, boot card, brand | UI-C B3a toolbar structure, layout wiring, HUD css extraction' },
    { title: 'Leg 2', detail: 'UI-C B3b options bars, cut contract, hint, quick switch, meter ring, tool caption | UI-E B5 Hoard family' },
    { title: 'Leg 3', detail: 'UI-C B3c wiring (hudBinding, keyboard, hud, boot) + B3d toolbar harness rows + sheets' },
  ],
}

const REPO = 'C:/Users/TestRun/Claude Claw/squish-keeper-build/games/wobblehoard'
const SCR = 'C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-AppData-Roaming-Claude-scratch-workspaces-10f6a62c-5610-424a-ba29-8c51dbde9f88-b3ecf43b-de12-4070-80de-e1daecc887bf-scratch-2026-10-06-8a5967/3b1103ab-0174-4d88-adc9-dd448a718f0d/scratchpad'

const PRE = `You are a senior front-end engineer on Squish Keeper (folder ${REPO}; Windows; Bash tool with POSIX syntax and forward slashes; your scratch folder is ${SCR}/ui/<batch>/).
FIRST read ${REPO}/_handoff/briefs/UI_BUILD.md COMPLETELY (the owner's words, the HARD BUDGET and the environment rules bind you), then ${REPO}/_spec/UI.md in full (30 KB, the build contract), then ${REPO}/_handoff/reports/UI_RUN.md (the running report: what B0, B1 and B2a built and their open requests: READ the 'requests' sections, they carry decisions), and ${REPO}/_handoff/briefs/RESUME.md quickly. Quote before you claim (path:line).
If your batch already has a block in UI_RUN.md, a previous engineer stopped mid-task: CONTINUE from it, never redo finished steps. Edit only the files your batch owns (UI.md 8 "Ownership"); two engineers work in parallel on different batches, so respect the split below. tsc must stay clean after every step. Never run a git write command; the orchestrator commits.
OWNER DECISIONS SINCE UI.md: the jelly lettering (src/ui/jelly, the glyph sheet) is APPROVED as drawn; the title lockup uses the per-letter BOUNCE (a fixed tilt and lift per letter, wobble when poked; off in Calm and reduced motion). The CUT team's task S0 has landed (src/shell/cutText.ts, cutBinding.ts, cutBar fields incl. the cut style 'clean' | 'minis' and canChangeStyle): build the style control against Cutter.style / setStyle (CUT_A.md SR1); if the Cutter does not offer it yet, keep the control behind a flag with a stub. The CUT team is editing src/shell/cut.ts, src/physics/*, src/render/*: do not touch those. Known from earlier legs: the new css files base.css, kit.css, a11y.css are NOT imported by the app yet (the first batch that wires a screen adds the three imports in that order and migrates --wh-font to --wh-font-ui as the B0 report says); amend UI.md 3.1 only if you must (plum name collision is resolved as DERIVED.plumBright).`

const LEG_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    stepsDone: { type: 'array', items: { type: 'string' } },
    stepsNotDone: { type: 'array', items: { type: 'string' } },
    measured: { type: 'array', items: { type: 'string' } },
    filesChanged: { type: 'array', items: { type: 'string' } },
    pictures: { type: 'array', items: { type: 'string' } },
    reportPath: { type: 'string' },
    blockers: { type: 'array', items: { type: 'string' } },
    requestsToOrchestrator: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'stepsDone', 'stepsNotDone', 'measured', 'filesChanged', 'pictures', 'reportPath', 'blockers', 'requestsToOrchestrator'],
}
const leg = (lane, label, text) => agent(`${PRE}\n\nYOUR BATCH: ${lane}. LEG: ${label}.\n${text}`, { label, phase: label.split(':')[0], schema: LEG_SCHEMA })

phase('Leg 1')
const leg1 = await parallel([
  () => leg('B2b Title, boot (UI-B)', 'Leg 1: ui-b2b', `Build the rest of UI.md batch B2 on the approved lettering: the jelly helpers the glyph leg named but did not build (setJelly / fitJelly / pokeJelly / wobble, the per-letter bounce), src/ui/titleCard.ts and the title screen per UI.md 4 and 6 (jelly lockup with the 1.2 s intro, the tagline plate, the 'Wake it up' CTA, the Settings / How to play / Trophies / Credits chips as UI.md 6 specifies them (the destinations come in later batches: chips whose screen does not exist yet are hidden behind a flag), the Snd toggle), src/ui/boot.css, index.html (the loading card, count-driven lines), src/shell/boot.ts per-import progress events. The accessible name stays 'SQUISH KEEPER' (one h1; the three existing title checks may be re-specified only if the DOM changes: write the reason). Add the three css imports (base, kit, a11y, in that order) and jelly.css where the title needs them, and migrate fonts as the B0 report says ONLY for the screens you restyle. DO NOT edit src/ui/hud.ts, hoard.css, styles.css, hudBinding.ts (the toolbar engineer owns the HUD files this leg: the brand in the HUD is built in B3c). Type goes into the first-play chunk (+2.7 KB gzip JS): report G0b. Read the title at 1280x800, 390x844, 320x568, 844x390 and 358x201, normal and Calm, as an art director and iterate until it is beautiful. Run the title browser sections and probe_app; the three title checks must pass or be re-specified with a reason.`),
  () => leg('B3a Toolbar structure (UI-C)', 'Leg 1: ui-b3a', `Build UI.md batch B3 step a (section 4 THE TOOLBAR, 4.1 to 4.3 and 8): src/ui/toolbar.ts (roving-tabindex tools Hand, Cut, Snap, the Hoard group, the More overflow, the attachment slot with caret, the tool caption chip), the layout wiring in layout.ts for the 8 kit sizes incl. 358x201 and 888x500, the toolbar kit page and sheets at the 8 sizes in 4 modes, and as the FIRST step of this leg move the HUD rules out of hoard.css / styles.css into src/ui/hud.css (same selectors, no visual change; run the HUD browser sections to prove it) so the Hoard engineer can work in hoard.css in parallel. You own hoard.css / styles.css / hud.css this leg only for that move and for HUD rules; the Hoard engineer (B5) owns Hoard rules in hoard.css from your first commit on: do the move FIRST and write 'HUD CSS MOVED' in UI_RUN.md the moment it is done (they wait for that line). The toolbar must not be wired into the live HUD yet (that is B3c): build it, show it on the kit page with mock data. DO NOT edit hud.ts, hudBinding.ts, keyboard.ts, boot.ts, titleCard.ts, index.html (B2b and B3c). Read every sheet as an art director: does it look like a crafted toolbar (icons, selected state, labels, caret, caption), does it fit a 320x568 phone beside the meter ring, name plate and capsule dock, and the 358x201 portal box?`),
])
log(`leg 1: ${leg1.map((r) => (r ? r.status : 'null')).join(', ')}`)
if (leg1.some((r) => !r)) return { stoppedAt: 'leg 1', leg1, note: 'an engineer returned nothing (usage limit?)' }

phase('Leg 2')
const leg2 = await parallel([
  () => leg('B3b Options bars (UI-C)', 'Leg 2: ui-b3b', `Build UI.md batch B3 step b: the options bars (src/ui/optionsBar.ts new, cutBar.ts, snapBar.ts restyled on the kit), cutContract.ts (CutLike and the style control: Clean cut | Minis segmented control bound to Cutter.style / setStyle, hidden or disabled with the plain reason 'Reconnect first to change the cut style' when canChangeStyle is false), the hint pill, quickSwitch, meterRing and the tool caption on the new kit, per UI.md 4.4 and 6. Kit-page sheets at the 8 sizes. Not wired into the live HUD yet (B3c wires). Do not edit hud.ts, hudBinding.ts, keyboard.ts, boot.ts, titleCard.ts, index.html, ui/hoard/**, hoard.css (B5 and B3c). Read the sheets as an art director.`),
  () => leg('B5 Hoard family (UI-E)', 'Leg 2: ui-b5', `Build UI.md batch B5: the Hoard (gallery, tabs Shelf / Gift / Today, filters, Sort, plinth grid with the double-rim tier frames), the detail card, the merge pad and Tidy-up, Restock and Tasks, the reveal plate, gem.ts, speciesIcon.ts on the new kit, in src/ui/hoard/** and hoard.css (Hoard rules only: the HUD rules were moved to hud.css by the toolbar engineer in leg 1, check UI_RUN.md says 'HUD CSS MOVED'). Keep every selector the existing browser sections use (UI.md 9.1) unless you re-specify with the written reason. Fix the audit's worst Hoard weaknesses by name (species names breaking one letter per line on the phone; the hold-to-merge label at 1.48:1; two identical close buttons; the nested styles). Run the hoard and merge browser sections (--only=) and probe_app. Read the screens at 1280x800 and 390x844 (and 320x568) as an art director.`),
])
log(`leg 2: ${leg2.map((r) => (r ? r.status : 'null')).join(', ')}`)
if (leg2.some((r) => !r)) return { stoppedAt: 'leg 2', leg1, leg2, note: 'an engineer returned nothing' }

phase('Leg 3')
const leg3 = await leg('B3c + B3d Wiring and harness (UI-C)', 'Leg 3: ui-b3c', `Build UI.md batch B3 steps c and d: wire the toolbar, options bars and the new title/HUD into the live app: hudBinding.ts (onToys becomes onTool; the tray and the word Toys disappear everywhere UI.md 4.6 lists: labels, aria, strings, keyboard help, ids, css, the 'toys' icon key), input/keyboard.ts (T key becomes the tool keys; Esc precedence per 4.5), hud.ts (the brand: the jelly wordmark at small size), boot.ts wiring, named no-op stubs for the B4 entry points (openMenu, toggleFullscreen, openPhotoCard, pause) so tsc stays green, the live-region wording of 4.5, the Hoard group in the toolbar. Then re-specify the browser harness rows that name Toys (UI.md 9.1: grep -n -i 'toys\\|wh-toys\\|\\.toy\\b' _harness/browser_shell.mjs; each row re-specified with the reason 'the owner changed the design on 2026-10-08', not deleted) and add the toolbar rows (UI.md 9 K02 hit boxes, K04 keyboard, the collision grid K11 at the 8 sizes). The B2b / B3a / B3b / B5 engineers' work is in the tree: read their UI_RUN.md blocks. Run the browser sections that touch HUD, tray, Cut, Snap, hoard and title with --only= (listed in the header of browser_shell.mjs), tsc, probe_app, node_checks. Take screenshots of the LIVE game (play view) at 1280x800, 390x844, 320x568, 844x390 and the portal sizes 888x500 and 358x201, with the Hand, Cut (options bar open) and Snap tools, READ them as an art director and fix what is ugly or overlapping. Save 6 key PNGs of the live play view in ${REPO}/_handoff/reports/ui_toolbar/ for the owner and describe what you see. Word check: grep the built dist and src for the word 'Toys' (must be 0 outside comments about history and the pets plan).`)
log(`leg 3: ${leg3 ? leg3.status : 'null'}`)
return { leg1, leg2, leg3 }
