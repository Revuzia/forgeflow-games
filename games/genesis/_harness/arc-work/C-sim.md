# C-sim ledger (sim engineer, stage C: §4 Covenant + §5 the Book) — trust this file

## Plan
C1 covenant.ts (ruined, great, offers, vows, pre/post-check, bow, kept/broken memory) -> C2 story.ts (annals, godActs,
ages, story, epithets, Generations, views) -> C3 legends.ts (wordFor, legends, tower.apart) -> probe B1/C lines -> gate.

## Stint 1 (2026-11-09 ~19:3xZ)
- C1 BUILT: src/sim/god/covenant.ts NEW (organisational split like defiance.ts). regard.ts ActCtx.ruined + noteRuined
  (harm.ts wreckBuildings) + actHooks.closed (endAct -> covenant actClosed: act totals kept in the act's store `D<k>`/`R<k>`,
  great once `G<pl>`, spare-the-many post-check `S<pl>`, natural doubt `N<k>`); foretoldAt exported. relationship.ts: WRATHFUL
  wrapper adds `covenant` enum to every harmful cast (also to tower.strike / defiance.answer, which own `wrath`), pre-check
  refuses with `refusal`, a cast sent with 'break' that the pre-check would refuse breaks the covenant; covenantHourly
  (before naturalOmens), covenantDaily, views, query('covenants'), fearMigration 5 days under a kept covenant. prayers.ts
  lapse x lapseScale. gatherings GATHER_KIND.covenant = 4 (tasks.ts anim lookUp/pray by id parity, gatherDone faith).
  types.ts CommandResult.refusal. state.ts: CovenantOffer.shown?, Covenant.shower?, RelState.arcSince? (C2). content.ts
  placeholders event/household/towns/vowWords/means/legend. events.json covenant.* + legend.retold.
  Freeform: covenantIntents (make / ask "what did I promise"), ", and break my covenant" in parseFreeform (BREAK_VOW).
- tests/arc-covenant.test.ts NEW 5/5 (C1-C4, warn-first, decline, save/load).
- C2 BUILT: src/sim/god/story.ts NEW (annals, godActs via relationship afterAct noteGodAct, silenceYears, first wrong,
  wandering count (fearMigration, confuse), ages (events by precedence, condition clocks in arcSince, numbering, old-world
  migration), story query, epithets, Generations, promises, views PlanetSnap.age/epithet, query ages/story, `arc.age`).
  scripture.json: title/opening/ages/ordinal/open/again/firstwrong/plentyEnd/next/nextCall/godPart/character/closing/note/
  epithet/generations/promise (+ C3 legend/legendCause/legendHeart/storyNumbers). scripture_lint fragment allowlist
  extended (firstwrong, epithet, generations.apart, storyNumbers, promise years) and title-case age names exempt from the
  "God" rule. Freeform "what kind of god am I" / "tell me our story" answered with the character lines + epithet.
- C3 BUILT: src/sim/god/legends.ts NEW (wordFor, legendsDaily once a year per town, compose with drift and the 140 cap,
  refresh once per event per town via memory.peak/refreshed, Book told line via storyHooks); heart.theyCall; tower.apart.words.
- Probe: _harness/probes/arc-book.ts (unattended | scripted) + _harness/arc-work/C-sim-runs.sh.
- Tests NEW: arc-ages (4), arc-legends (2), arc-covenant (+determinism = 6). All green focused.
- RUNS: script1.log (scripted 1-4, 32 y; seed 1 had the old age naming), unatt1 KILLED (silence<->trust flip-flop every
  3 y, 17 ages on seed 1 -> FIX: a condition age holds while its condition holds; numbering only for place-named kinds).
  unatt2.log (unattended 1-8, 60 y, the fix) queued 20:13Z.
