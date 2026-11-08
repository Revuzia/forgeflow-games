# B-ui ledger (UI engineer, stage B: §3 Open defiance) — trust this file

Sim side of §3 not built when this started (no `defy` events, no `defiance.answer`); UI codes to §6 and stubs via
`__GENESIS__.arc.stub` (§6.7). Already present from stage A: audio `defy`/`defy.answered` entries, crowd.shout/stone.knock
recipes, HUD fist pulse on a new `SettlementView.defiant.tick`, inspector Defiance bar + answered line.

## Stint 1 (2026-11-08)
- DONE toasts (src/ui/toasts.ts): `defy` -> first act of each kind per town (`planet:settlement:kind`) is a toast
  "Defiance · Aru" with the present-tense voice line (hearts.ts defyToastText: "In Aru they are throwing stones at your
  storm.") and ONE button "Look" (lookAt the event pos or the town); the sim's chronicle line of the same tick is claimed
  (repeats and their w2/w3 lines never pop as milestones; still in the chronicle). `defy.answered` -> "Answered · Aru"
  with the sim's claimed line, else defyAnsweredText fallback (patience at day 10 = "The sky did not answer Aru.").
- DONE chip/orbit (hearts.ts heartGlyph): a fresh `SettlementView.defiant` shows the fist whatever the heart kind (even
  with no heart), tooltip adds DEFY_WORDS ("they threw stones at the storm"); living.ts orbit mark gets `gn-lmark-defy`
  (crimson glow) while the act is in the view. HUD 10 s pulse unchanged (now also for non-defiant-kind towns).
- DONE inspector (inspector.ts settlementHearts): under the Defiance bar "Lately they threw stones at the storm."
  (from `defiant`) and "What the god answered: <heart.answered>" (gold), both in words, sim-composed answered string.
- DONE audio (eventmap.ts): `defy` kind idol -> `stone.knock` (news 0.35 gap 20); other kinds crowd.shout variant=kind.
- DONE freeform (freeform.ts): DEFY_EXAMPLES 'forgive {town}', 'be patient with {town}', 'how do the people of {town}
  feel?' offered first while a town has a defiant act (defiantTown = newest). Help row 'defiance' in controlstext.ts
  (no answer button; your next deed is the answer; say "forgive Aru" ...); CONTROLS.md regenerated.
- DONE stub: arcstub.ts kind 'events' (one-shot events/chronicle into the next snapshot); §6.7 edited +
  contract-changes.md entry. testsurface comment updated.
- Tests: tests/ui-arc-defiance.test.ts (6) + ui-arc-hearts (title assertion updated) + audio-arc (idol/burn/hurl);
  focused ui-arc-*, audio*, ui-meta, ui-flood-*: 63/63; tsc clean.
- Shots spec _harness/arc-work/specs/ui-defiance.json (babel seed 1, worker, stubbed; port 5311; log scratch/arc/b-ui/).
  Run 1 (18:22-18:29Z) 3/3, 0 console errors. LOOKED:
  b-defy-insp.png: under Defiance bar "Lately they threw stones at the storm." (red) and "What the god answered: struck
  twice, shown mercy once" (gold), dusk + remember below; fits the inspector -> OK.
  b-defy-chip.png (2500 m): chip "Shenyaar by the Lake" + red fist + proud tower mark; tooltip "...They raise their fists
  · they boast · they threw stones at the storm" -> OK (pulse already over: the capture took >10 s real).
  b-defy-toasts.png: DEFECT: the two defy toasts were trimmed out of the 2-toast column by the same-tick answered toast
  and the sim's tower.begun milestone (equal pri 4, oldest dropped). FIX: first defy toast pri 5 (as the flood
  warning); unit test "a first defiant act outranks...". Spec shot 1 now stubs defy only. Rerun --only=b-defy-toasts
  queued 18:30Z (ticket #6, log scratch/arc/b-ui/shots2.log).
- Full gate: slot.sh npm run check started 18:22Z (PID 5598), log scratch/arc/b-ui/check.log (started before the pri
  fix; the pri fix is covered by focused tests).
- Rerun b-defy-toasts (18:5xZ) 1/1, 0 console errors. LOOKED: two "Defiance · <town>" toasts in the voice ("In Shenyaar
  by the Lake they are throwing stones at your storm." / "At dusk in Ashuk by the Lake they are cursing the sky."), each
  with the single gold LOOK button; the claimed chronicle line shows in the ticker only -> OK.
- GATE: npm run check (scratch/arc/b-ui/check.log) 830/830 pass, fail 0 -> GREEN. Post-fix focused tests + tsc green.

## NEXT (stint 2, once the sim lands §3)
1. Remove nothing: the stub path stays. Run ui-defiance.json WITHOUT stubs on a live recipe (defiance.set + a god storm,
   D3) and look: real `defy` toasts, real `heart.answered`, chip fist on a real `SettlementView.defiant`.
2. If the sim's freeform phrases differ from DEFY_EXAMPLES ('forgive {town}', 'be patient with {town}'), align the chips
   (tests/ui-arc-defiance.test.ts checks them against ARC §6.5).
3. If the sim composes `defy.answered` toasts' chronicle lines with another settlement ref, check claim() still catches them.
