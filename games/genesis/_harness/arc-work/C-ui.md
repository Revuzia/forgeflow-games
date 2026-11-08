# C-ui ledger (UI engineer, stage C: §4 Covenant + §5 the Book) — trust this file

Sim side of §4/§5 NOT built at start (types.ts has the §6.2 views: PlanetSnap.covenant/covenantOffer/age/epithet,
SettlementView.covenant; no CommandResult.refusal, no queries covenants/story/ages, no events emitted). Audio cues
for covenant.* / chronicle.age already in eventmap.ts + sfx.ts from stage A. UI codes to §6 and stubs via
`__GENESIS__.arc.stub` (§6.7).

## Plan (stint 1)
1. src/ui/book.ts (new, pure): covenant choice words, vow words, promise rows, age line, title card, Book export,
   paragraph -> chronicle entry matching, refusal helpers, open-book phrases.
2. decision.ts: covenant offer card (4 vows, Say nothing, Decide later; same placement/pill).
3. arcstub.ts: kinds 'story', 'covenants', 'refusal' (query/cmd interception) + simclient hook. §6.7 + contract-changes.
4. app.ts cmd: refusal.kind==='covenant' -> confirm "This breaks your promise..." [Break it] [Hold].
5. living.ts Promises section + wrath notch at 0.3 under `gentle`.
6. chronicle.ts Book / Every day tabs, export of the Book.
7. hud.ts age line (clickable: opens the Book) + title card; inspector "Under the promise..." + "Read the book of X".
8. saves.ts meta age/epithet + Continue line. freeform "tell me our story" opens the Book.
9. tests/ui-arc-covenant.test.ts, tests/ui-arc-book.test.ts; shots spec _harness/arc-work/specs/ui-covenant-book.json.

## Stint 1 (2026-11-08) — built (all on stubs; sim §4/§5 absent)
- book.ts (new, pure): VOW_LABEL/VOW_SAYS, covenantChoice, declineCommand, covenantRefusal, breakCommand (cast ->
  covenant:'break'; words -> ", and break my covenant"), confirmWords, covenantTownNames, wrathNotch, covenantRows,
  promiseLine, underPromise, ageLine, titleCard, AgeWatch (no card on first age / new world / load / rewind / jump),
  StoryView + asStory, bookBlocks (§5.5 order), bookExport md/html/txt, bookFileName, paragraphPlace (paragraph ->
  chronicle entry by normalized text -> its settlement/agent ref), openBookIntent.
- decision.ts: covenant offer on the same card (`update(..., offer)`; shell passes dpv.covenantOffer), "Say nothing"
  (covenant.decline) + "Decide later" (pill "After the Flood of Aru", rainbow icon); spectral border; CovenantConfirm
  class (Break it / Hold / Esc / 20 s). app.ts cmd: refusal.kind==='covenant' (non-quiet, not already break) -> confirm,
  Break it -> this.cmd(breakCommand(c)). Cue left to the sim's covenant.refused event (ui.deny) to avoid a double.
- living.ts: Promises section (query 'covenants' every 2.5 s; fallback to PlanetSnap.covenant), wrath notch at 0.3
  (rainbow tick, tooltip "Your promise to Aru: always gentle") under a kept gentle covenant.
- chronicle.ts: tabs Book / Every day (Book default once the story has an age unless chosen), openBook(town), story
  asked on open + every 8 s, export exports the Book ("The Book of the ... .md"), paragraphs that match a chronicle
  line with a place are buttons that fly there; town book has "The Book of <world>" back button.
- hud.ts: age line under the date (button -> ui.book; small caps; "since year N" — deliberate: the date line right
  above already shows the current year), title card "Here begins *X*." 4 s, pointer-events none, muted on title.
- shell.ts: action 'ui.book' / 'ui.book@<id>'; inspector "Their story" section: "Under the promise of year N (kept)"
  + "Read the book of Aru". saves.ts: SaveMeta.age/epithet, card line "The Age of the Bow · they call you the
  Patient"; title.ts Continue sub "the Age of the Bow, year 212". freeform.ts: open-book phrases open the Book.
- arcstub.ts: kinds story / covenants / refusal (+ simclient query/cmd hook). §6.7 edited, contract-changes.md entry.
- testsurface arc: silence, confirm, breakIt, hold, book, bookState, bookExport, age. controlstext rows 'a promise',
  'the Book'; CONTROLS.md + game_meta regenerated.
- Tests: tests/ui-arc-covenant.test.ts (8), tests/ui-arc-book.test.ts (8). ui-*.test.ts 119/119, audio 
  + ui-arc 88/88, tsc clean.
- Shots: _harness/arc-work/specs/ui-covenant-book.json (log scratch/arc/c-ui/shots.log), started 19:09Z.
- Shots run 1 (19:09Z): the 1600x900 shot opened a new page, so window.__towns was gone and it FAILED; killed the run. LOOKED
  at what had been taken: the offer card's title was cut short by "Say nothing" + "Decide later" -> FIX: "Say nothing" moved
  to its own bottom row ("Or make no promise, and let them wait."), the why line names the towns only when they are short,
  options are 45 px. The inspector shot did not show the promise line (stub set too late) -> the stub now goes in earlier.
  In the Book, each sentence sat on its own line and the float drop cap pushed into the next one -> FIX: an age is one
  passage of prose with a raised gold initial.
- Shots run 2 (shots2.log), 11/11. LOOKED at all of them:
  c-offer: the full title "After the Flood of Shenyaar by the Lake", meta, why, 4 vows, Say nothing row; the age line
  under the date in small caps -> OK. c-offer-pill -> pill "After the Flood of ..." OK. c-confirm: "This breaks your promise to
  the people of A and B. They will remember." / "You promised: always gentle." [Hold][Break it] -> OK. c-promises / c-notch:
  Promises rows (kept four years / broken in year N, household, towns, eye); the notch tick sits under the thumb at 0.30,
  tooltip OK. c-insp: "Their story" with "Under the promise of year 2 (kept)" + "Read the book of ..." -> OK. c-book /
  c-book-ages / c-book-full: title, italic opening, ornament, character lines, WHAT THEY CALL YOU + gold italic epithet,
  ages with serif headings, YEARS small grey, "since year 33 · now", prose, the italic "As it is told now" line -> reads
  well at 888x500 and at 1600x900. DEFECT: the linked sentence (a button) broke the line -> FIX: span role=link (not
  re-shot; a CSS/DOM-only change). c-agecard: "HERE BEGINS / The Age of the Bow." caught mid-fade, legible -> OK. c-save:
  the save card shows "The Age of the Bow · they call you the One Who Keeps Its Word" -> OK.
- GATE: npm run check (scratch/arc/c-ui/check.log) 846/847; the 1 failure is worker.test 'worker protocol round trip'
  ('achieved 79x' throughput under machine load, sim lane, not touched); it passes when rerun alone -> GREEN.

## NEXT (stint 2, once the sim lands §4/§5)
1. Run ui-covenant-book.json WITHOUT stubs on a live recipe (covenant.offer debug -> card; covenant.make; a flood cast ->
   real refusal -> confirm; arc.age -> title card; query('story') -> Book). Re-shoot c-book-ages to see the inline link.
2. Check the sim's shapes against the readings in contract-changes.md (age.since = tick; covenants query shape; offer
   name/household strings; CommandResult.refusal). If CommandResult gets a typed `refusal`, drop the cast in book.ts.
3. If the sim answers the open-book free text with words, check the toast is not doubled by the app's own result toast
   (freeform sends quiet:true and toasts r.msg itself).
