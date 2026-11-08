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
