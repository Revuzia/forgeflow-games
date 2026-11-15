# GENESIS improvement plan

Built from the seven audits and the critic's corrections. I did not re-open the code myself, so file:line pointers are the auditors' and critic's; where they disagreed I took the critic's verified reading.

## 1. The 10 things that most improve the game for a player

1. **Playable frame rate and memory on the Mac** (about 2 fps, 5.7 GB tab + GPU): owned by the existing PERF lane; everything else is judged through it.
2. **Fix the three visible world bugs**: water sheet over hills, white cloud bands at 456 m and 220 m, houses standing in the lake.
3. **Gate and live-verify stage C** (covenant, Book of Ages): the code exists but has never passed a full gate or been seen with real data.
4. **Make the arc reachable in a normal session**: a proper "One speech" card, 3-5 premise scenarios, and time that eases down for prayers, defiance and age turns.
5. **Make the Book worth reading**: a full-screen reading view, a human read-through of generated prose, and no silence/trust age churn.
6. **Say what to do after the opening**: a few one-time, dismissible whispers (first prayer, first heart sign, first age), with owner-approved text.
7. **Make defiance and the covenant visible at 40-80 m**: hurl by day, idol, burning shrine, rainbow, gathering, broken ring.
8. **Lift the mid-range look**: far-tree colour and shading, house and Tower silhouettes, plains and shoreline variation.
9. **Do not lose a world**: WebGL context-loss handling, resume from autosave after a crash, persistent storage, a private-window warning.
10. **Give sound some drama**: ambience ducking and designed silence, settlement character by era, and sounds for the silent story events.

## 2. Work lanes

File ownership is exclusive per lane. The quick-win batch (section 3) runs first and alone, then the lanes start.

### PERF lane (exists; owns `src/render` hot paths: `terrainmat.ts`, `ocean.ts`, `clouds.ts`, `vegetation.ts`, pipeline)
Cross-impacts only:
- **Render fixes queue behind it.** Lane A's water and cloud fixes edit `ocean.ts`, `clouds.ts` and `terrainmat.ts`; hand them over in agreed windows.
- **Memory.** Publish a memory budget per preset (MAC-ROUND5 section E: 2.6 GB tab, 3.1 GB GPU, swap rising).
- **Input at low fps.** Long-press is frame-polled (`src/ui/handinput.ts:183-197`) and fires 1-1.5 s late at 2 fps; add "wheel opens on long press" as a PERF acceptance case.
- **Arc snapshot cost.** `epithetOf` runs every snapshot (`story.ts:459`, `:575`); lane C caches it and reports numbers.
- **Unregistered switches.** `fieldtex.ts:97`, `planetview.ts:24`, `upload.ts:101`, `renderer.ts:145/213`, `vegetation.ts:833/1995` should go through `perfswitch.ts`.

### Lane A: Render correctness (opus)
- **Goal:** remove the Mac-only bugs that have been guessed at for 3-4 rounds.
- **Why opus:** depth and precision faults that only reproduce on Metal/ANGLE, in a volumetric shader.
- **Owns:** new debug-view files, `sky/clouds.ts` deck-tunnel section and the `ocean.ts` fragment, both only in PERF hand-off windows.
- **Tasks:**
  1. Add a `?wsdebug=1` heat map of the water-to-ground gap and thickness, and get one Mac screenshot before any fix.
  2. Fix the water sheet: discard where depth is under 5-10 cm or water level is not above the terrain's own ground height; fade over tree-cover cells (`ocean.ts` VERT ~l.100).
  3. Fix the cloud bands: use the deck's local top and base at the camera instead of global shell radii (`clouds.ts:1416`, `:1720`), and crossfade to sky colour rather than white.
  4. Feather far cumulus silhouettes (edge erosion, darker base, rim light) with no extra march steps.
- **Proof:** owner Mac shots at the four fixed cameras (standard landing, Amonshis hill, Rubolhin lake, 456 m stop) before and after; a probe stepping the owner's altitudes logging `uNearR` and local density. SwiftShader shots do not count.
- **Owner decision first:** none. It does need the owner's Mac shots, which is why the screenshot key in section 3 goes first.

### Lane B: World sim (opus for task 1, then sonnet)
- **Goal:** buildings sit on dry land and rising water reads as a story.
- **Why opus then sonnet:** task 1 changes placement under determinism and save compatibility; the rest is wiring and tests on top of its helper.
- **Owns:** `src/sim/people/buildings.ts`, `settlement.ts`, `people/world.ts`, `src/sim/life/*`, `_harness/detban.ts`, new sim tests.
- **Tasks:**
  1. (opus) Add one `dryAt(point)` helper sampling the building's own point and footprint. Use it at `buildings.ts:314, 356, 396` and `settlement.ts:567/599`. Name the 0.15/0.5/0.6/1.5 thresholds. Add a daily sweep that ruins a finished non-dock building standing in more than 0.3 m.
  2. (sonnet) Regression test on babel seed 307987276 plus two more seeds: no completed non-dock building under water.
  3. (sonnet) Graduated wet/ruined house state with one chronicle line per town (ordinary lake and river rise only).
  4. (sonnet) Extend detban to flag unsorted `Object.keys` and Map iteration; fix `commands.ts:336`; add a save-load-hash-equals-continue test.
  5. (sonnet) Promote the eastwater and babel probes to short seeded tests; check in frozen save fixtures per arc stage.
  6. (opus, later) Lapse-consistency probe: 30 years at 1x-equivalent against 1000x and 3000x; report which system diverges first.
  7. (sonnet, measure only) 20-seed founding-band survival probe and 30-seed days-to-first-settlement probe. Build nothing from them without evidence.
- **Proof:** determinism harness green, new tests, and one looked-at shot of Rubolhin after the fix.
- **Owner decision first:** none.

### Lane C: Arc sim and story (sonnet for gate and probes, opus for balance and spec)
- **Goal:** stage C gated and trusted; Open Rebellion specified.
- **Why split:** the gate, probes and ledger are specified in `C-sim.md`; trust balance, age naming and the §11 spec need judgement against the rulings.
- **Owns:** `src/sim/god/*`, `src/data/scripture.json`, `_spec/ARC.md`, `_harness/arc-work/*` ledgers, `_harness/probes/arc-*`.
- **Tasks:**
  1. (sonnet) Run `slot.sh npm run check` once on the live tree; add the arc scenario to determinism (tower, covenant, break, defiance, save at y40, load, run to y80 equals a straight run).
  2. (sonnet) Cache the epithet per tick; measure `perf_worker` throughput at 1500 agents and snapshot time (target 8 ms or less).
  3. (sonnet) Run the 25-year trust-ceiling probe (C3) and the 8-seed unattended tower probe (T2); record numbers.
  4. (opus) Wire `trustGainScale` (`covenant.ts:527`, no caller); add the painted-storm no-flood check and the spare-the-many estimate; unit tests in `tests/arc-covenant.test.ts`.
  5. (opus) Age hysteresis in `story.ts` (one-year lapse before silence or trust reopens); a neutral or blank epithet until the god has acted; re-run B1 on 8 seeds.
  6. (opus) Paired 16-seed probe for D5 (memory of answers), with a recommendation to the owner.
  7. (sonnet, opus review) Dump 6 Books and read them end to end; extend `scripture.json` variants; add a test that no two ages share a sentence.
  8. (opus) Write ARC §11 Open Rebellion in the §1-§10 format, plus a §12 list of deferred items. Spec only; no code until stage C is gated and PERF releases.
- **Proof:** the gate result recorded in the ledger, probe numbers, the read-through notes, and owner sign-off on §11.
- **Owner decision first:** the flood wording (question 1) blocks tasks 4 and 7; tower pacing (question 4) follows task 3.

### Lane D: Arc visuals and look (opus)
- **Goal:** the arc's moments and the mid-range world look finished.
- **Why opus:** judged by eye; procedural architecture and pose readability.
- **Owns:** `src/render/life/buildings.ts`, `buildinggen.ts`, `tower.ts`, `buildingmat.ts`, `farcrown.ts`, `groundcover.ts`, `render/fx/*`, signs and pose files.
- **Tasks:**
  1. Live shots of stage B: hurl by day at 40 m and 20 m, idol, curse at dusk, burning shrine. Strengthen silhouettes if they read weakly.
  2. Live shots of stage C without stubs: rainbow at 40 m and 300 m, gathering, broken-covenant ring, the Book on a 30-year world.
  3. Render safety net for wet dwellings (`buildings.ts:744` uses `wet` for docks only), after lane B task 1.
  4. Far trees: per-tree hue jitter and species mix, crown shading (`farcrown.ts:83`, `:162`). The terrain-under-canopy part waits for PERF.
  5. Tower and houses: tier banding, buttresses, stair, summit flame, setback shading; wider roof and wall variation that survives LOD1.
  6. Shoreline band and reeds through `groundcover.ts`; no trunks below the waterline.
  7. Disaster and miracle gallery, day and night; fix the worst three. Night series for towns and the Tower.
  8. Plains variation and horizon haze in `terrainmat.ts`: last, in a PERF window.
- **Proof:** before and after shots that someone has looked at, with verdicts written in `B-render.md` and `C-ui.md`; owner Mac shots for final sign-off.
- **Owner decision first:** question 1, before polishing the flood-to-rainbow path in task 2.

### Lane E: UI and player flow (opus for design, sonnet for accessibility)
- **Goal:** the player can find, follow and read the story.
- **Why split:** the Book view, whisper voice and input timing need design judgement; accessibility items have checkable acceptance.
- **Owns:** `src/ui/*` except `saves.ts`; `src/data/scenarios.json`, `powers.json`; `styles.css`.
- **Tasks:**
  1. (opus) Full-screen Book reading view (`book.ts`, `chronicle.ts`): serif page, chapter navigation by age, camera restored on close, open, close and page-turn sounds.
  2. (opus) One-time whispers after the opening (`opening.ts`, `living.ts`): first prayer, first heart sign, first Decision, first age. Each is hushable and non-judging.
  3. (opus) Auto-ease for moments: extend `slowGreat` to prayers, defiant acts, tower start and age turns, with a Look toast. Windows stay in sim ticks.
  4. (opus) Long-press on a timer armed in `down()`, keeping the `heldFor()`/`downSeen` guard (`handinput.ts:204`); fake-clock test.
  5. (sonnet) 3-5 premise scenarios in the existing schema with a "what to watch" line; `content.test` coverage.
  6. (sonnet) Neutral wheel entries for existing arc commands (answer, warn, vow, read the Book); a "What you did" Chronicle tab.
  7. (sonnet) Accessibility: dialog roles and focus return, a text-size and high-contrast setting, a second non-colour cue for regard and mood, reduce-motion read by camera fly-to and cinematics.
  8. (opus) Last-page card when a people dies: read the Book, rewind, begin again. No unlocks.
  9. (sonnet) Live integration tests per arc UI surface on a real babel world; layout matrix at 1280x720 to 2560x1440 and scale 0.8/1/2.
- **Proof:** DOM tests, looked-at shots of each surface on live data, owner read of all whisper text.
- **Owner decision first:** question 3 (whispers and auto-ease).

### Lane F: Audio (sonnet for mapping and tests, opus for mix)
- **Goal:** dynamics and a sense of place, without touching the score.
- **Why split:** event mapping is mechanical; ducking, silence and new beds are tuned by ear.
- **Owns:** `src/audio/*` except `assets/` and `authored.ts`, which stay untouched.
- **Tasks:**
  1. (opus) Ambience ducking driven by cue priority (`engine.ts:581`, `:705-708`).
  2. (opus) Designed silence: bird and insect rates drop on `warning` and after high-priority news (`ambience.ts:260-264`).
  3. (opus) Settlement one-shots by era and building type; real herd-animal calls.
  4. (opus) News severity scaling above 100x; a covenant sound family as sound design, not score.
  5. (sonnet) Fake-clock test that the duck returns to 1; news reach attenuation tests.
- **Proof:** unit tests, and an owner listen on laptop speakers and headphones; nothing here has been heard by an auditor.
- **Owner decision first:** none; question 6 covers the music coverage report.

### Lane G: Resilience and release (opus for recovery, sonnet for the rest)
- **Goal:** failures are survivable and the deploy is repeatable.
- **Why split:** restoring GL resources and respawning the worker cross the renderer, worker protocol and saves; the rest is config and scripts.
- **Owns:** `src/app.ts`, `src/main.ts`, `src/client/simclient.ts`, `src/ui/saves.ts`, `vite.config.ts`, `package.json`, `public/*`, `.github/`, `_harness/README.md`.
- **Tasks:**
  1. (opus) Context loss: `preventDefault`, pause, forced autosave, calm card, then restore or reload into the autosave.
  2. (opus) Keep the last save blob on the main thread; the fatal cards (`app.ts:285`, `:823`) offer "Resume from last autosave".
  3. (sonnet) Diagnostics ring buffer with a "Copy diagnostics" button; worker fallbacks surfaced in the overlay. No upload.
  4. (sonnet) Bundle: `manualChunks`, lazy photo mode, mod UI and launch fx, size budget in `npm run check`; long immutable caching for hashed assets.
  5. (sonnet) Browser matrix and smoke script for Chrome, Safari 17+ and Firefox; feature cards for module workers and OffscreenCanvas; verify universal mute.
  6. (sonnet) Opt-in Playwright smoke (boot, non-black canvas, first snapshot); About/Data panel; confirm the test surface cannot alter saves in production.
- **Proof:** fake-Worker and `WEBGL_lose_context` tests, bundle sizes recorded, smoke run per browser.
- **Owner decision first:** question 2 (any quality step-down offer); question 6 if Safari cannot decode ogg.

## 3. Quick wins: one sonnet batch, run first

1. Rewrite `STATE.md` as a truthful built/verified/unverified table per ARC section.
2. Give "One speech" (babel) its own card, icon and premise line in `newworld.ts` CARDS; add the missing picker DOM test.
3. Add `tower.lost` and `secession` cues; map or explicitly null `collapsed`, `fire.out`, `aid` and the rest; a test that fails on any unmapped sim event.
4. `navigator.storage.persist()` after the first save; a "saves unavailable, export your world" banner in private windows.
5. Seed `prefs.reduceMotion` from `prefers-reduced-motion` on first run.
6. Screenshot key that saves a PNG at real canvas size with the perf header; add the four fixed-camera shots to `MAC-TEST-PROTOCOL.md`.
7. One line on the power card when harm is scaled by survivable wrath (`tools.ts:286` area); default unchanged.
8. Move the regard-chip explanation out of `title=` (`living.ts:244`) into a focusable popover and the F1 card.
9. Settings: neutral audio copy, Disasters toggle disabled until its query returns, surface `edgePan` and `slowGreat`.
10. `game_meta.json`: add `has_mobile_support:false`, check genre and difficulty against the pipeline enums, trim `controls_keyboard`, state "English only, desktop only".
11. Toasts on a live babel world: fix kind-to-heading mapping, replace the "CUSTOM" label, cap at two visible.
12. `.github` workflow running `npm ci` and `npm run check`; `npm run release-check` (build, meta validation, sizes, refuse a dirty stamp).
13. Gate the `/__shot` endpoint behind `GENESIS_SHOTS=1`; confirm `dist/` and `_shots` are gitignored; write `_harness/README.md`.
14. Wind bed: tests at wind speed 0 and low altitude; zero floor with hysteresis if the test shows a constant hiss.
15. Truecolor thumbnail re-export from the best preset (after lane A fixes).
16. Check what the player sees when free text is not understood, and report it.

The store description rewrite around the Book of Ages waits for the stage C gate.

## 4. Items dropped

**Wrong or stale:**
- "babel is hidden": it is listed, last, looking like a mod pack. Kept only as the re-card in quick win 2.
- "The wheel did not open on the Mac": that line is the pass for the round-4 bug. Kept only as the late long-press fix.
- "No arc save migration": `migrate15.ts:76-78` has it. Kept only as frozen fixtures.
- "Stage C sim is on stubs" (world-sim 9, code-health 7, ui-ux 6): the sim is in the tree and the stub is null unless set. No `stageC` flag, no hiding docs.
- "Pause integration not confirmed": `src/ui/embed.ts:49, :55` does it.
- "No until-something-happens control": step menus exist; narrowed to auto-ease.
- "Story screens are silent": only open, close and page-turn clicks are missing.
- Lake houses reported three times: merged into lane B task 1 and lane D task 3.

**Against a ruling, not to be built:**
- Automatic or default quality reduction of any kind, "default touch to Low", "what Low can cut", a "Lower quality" button on failure cards (question 2).
- Billboard crossfade for distant animals.
- Hidden founding-band mortality scaling: measure only.
- A constrained mode named "Just", and "unlock a final epithet".
- Promoting mercy verbs as "what the Book rewards": verbs are added in neutral order and wording.
- "Let time pass until something is asked of me" auto-advance, and prayer windows in real seconds (breaks determinism).
- A crash beacon without consent.
- Re-encoding or lazy-loading the approved music without the owner's say.
- Polishing the flood-to-covenant path before question 1 is answered.

**Deferred past launch:** full touch and tablet input (L, opus), splitting the giant files, per-biome palette tests, the economy "known for" epithet, seasonal behaviour, wildlife behaviours, the minimum-spec iGPU benchmark.

## 5. Open questions for the owner

1. **Flood content against "No Great Flood".** `scripture.json:233` ships the epithet "the One Who Drowned the World", and the covenant is triggered "as if a great flood" and sealed with a no-flood vow. *Recommend:* keep local river floods and the flood warning; rename world-drowning wording; let any great destruction trigger the covenant, with the vow worded to match.
2. **May the game ever offer a lower preset on a slow machine?** *Recommend:* yes, only as a visible offer the player accepts, one step at a time, never automatic and never changing defaults. Until you say yes, nothing is built.
3. **Guidance and pacing.** *Recommend:* approve four or five one-time whispers (you approve the text) and automatic easing down to slow speed for prayers, defiance and age turns; reject any skip-ahead control.
4. **Tower pacing in attended play.** *Recommend:* leave the sim as it is (unattended target only) and rely on the "One speech" card as the guaranteed showcase, after the 8-seed re-check.
5. **Open Rebellion.** *Recommend:* have the ARC §11 spec written now for your review, and build it only after stage C passes its gate and PERF releases.
6. **Music coverage and Safari.** Eleven eras share four pieces (`authored.ts:168-170`), and Safari ogg decoding is unverified. *Recommend:* accept four pieces for launch, verify Safari, and if it cannot decode, choose between a container re-encode of the same recordings and the existing procedural fallback.
