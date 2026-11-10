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
- CONTAINER RESTART ~20:18Z: src/tests intact (tsc clean). unatt2 got seed 1 only: 13 ages (B1 >= 3 OK; a moon's
  `making` was counted -> probe now filters planet 0). script1 seeds 1-3: scriptedOrder flood->covenant->tower->scattering
  TRUE 3/3, story max 8 sentences/age, generations <= 12, ms 3-5, legends 11-12 per run (all gen 1 within 32 y; gen 2
  unit-tested), legend max 97 chars, told lines 4. The scripted flood is `covenant.offer` (debug "as if a great flood"):
  a real god flood on babel breaks the host's pride (harm) and the tower then never comes; logged in the probe header.
- arc-covenant 7/7 (+ free text). RUNS relaunched: unatt3a.log (unattended 1-4 + scripted 4), unatt3b.log (5-8).
- RESTART 2 (usage pause) killed unatt3; seeds 1-2 survived. unatt4a/b.log (01:05Z) finished the rest.
- B1 MEASURED (60 y unattended, 8 seeds): ages 12, 3, 11, 7, 12, 7, 5, 5 -> >= 3 on 8/8 PASS (plenty -> silence -> trust /
  tower / builders / natural ruin). Epithet "the Silent One" 8/8. Story: max 8 sentences/age, generations 2-6, never
  "The End", 2.8-3.8 ms. Natural great destructions opened offers on seeds 3, 5, 7 (no bow: no god answered).
- B1 scripted (babel 32 y, 4 seeds): flood -> covenant -> tower -> scattering in order 4/4 PASS. B4: legends 9-12 per
  run by year 32, max 85-106 chars (<= 140), told lines 4-5; gen-2 differs (unit test). B2 story 4-5 ms (babel ~400 agents).
- GATE: check1.log (slot.sh npm run check) queued ~01:2xZ.
