IMPL REPORT: WOBBLEHOARD render round 2, finish (render lane)

SUMMARY
Round 2 is done and checked. The final full harness run (node _harness/browser_render.mjs, port 5364, 56 min) printed **ALL RENDER CHECKS PASSED: 198/198 ok**, with 0 console errors or warnings. `npx tsc --noEmit -p tsconfig.json` is clean.

- **The reported Mythic merge skip failure no longer happens.** The working tree was clean at HEAD f14d3b8 when I started; the last report on disk had crashed (page closed) before reaching the skip section, so I could not see the original failure. My standalone repro, before any of my edits, gave Mythic merge natural vs skip a mean fingerprint difference of 0.14/255 (threshold 1.5). The earlier fast-forward of each body view's own clock had already fixed it.
- I then worked through items A to F and the three verifier lenses. Each change below came from something I measured or saw in a frame:
  - **Clipped merge burst.** The merge result sprang open to 1.3x and hopped above the top of the frame: the silhouette reached up to -63 px at 1280x800 in every tier. Now the merge frames the pad 12% wider (eased in while the parents slide, eased back during T4), the puppet overshoot is exactly 1.25x, and the rise is lower. The closest silhouette is now 63 to 80 px from the top at 1280x800.
  - **Sky band (A1).** The lighter band at the top of the frame came from a horizon glow that rose over the first 4 degrees above the horizon; the default camera pitch cut the frame top inside that rise. The glow now peaks at the horizon and falls off both up and down. The worst band/kink measure dropped from 2.05 to 0.96/255.
  - **Muddy colours at the burst.**
    - Epic: coral light over a green result read as khaki. The tier tell is now released within 0.5 s, it is weaker for Epic, Legendary and Mythic, the lineage colour swirl is lighter, and the burst lights the table in the tier colour instead.
    - Mythic: the flash read as plain green; it is now pastel white.
  - **Capsule ownership.** A meter-full drop during a reveal used to be placed off screen and was then deleted when the reveal ended. The reveal now owns the capsule it opens, and a capsule dropped during a reveal is independent, lands on screen and survives.
  - **Contract conformance.** `CapsuleHandle.landed` and `screenPoint()` now behave as `src/contracts.ts` describes: the capsule is not tappable while falling or fading in.
  - **Robustness.**
    - A disposed stage returns inert handles instead of throwing.
    - Unknown tier strings are drawn as Common, and a merge with no parents no longer throws.
    - A crossfade is skipped while the context is lost or the stage is disposed.
    - The auto quality governor never dropped a tier on a device slower than 2.5 fps (it threw away every sample over 400 ms); it now counts them, clamped to 100 ms.
  - **Material family cap.** The jelly now honours the per-family translucency cap from CONTRACT section 11. This was flagged as open for the render lane in checkpoint 20; it was not in my brief.
  - **Cleanup.** Removed per-frame allocations from the ceremony and stage update paths, and removed dead code.

FILES (all inside my lane; no git commands that change the repo were run)
- `src/render/ceremony.ts`: merge framing (`MERGE_FRAMING`), the 1.25x pop (`POP` and `POP_CALM`), rise speed (`HOP_VY`), burst colours (`TELL_AT_BURST`, `MIX_AT_BURST`), the reveal taking over the capsule, pastel Mythic flash, sanitised specs, reusable mote spec, dead code removed.
- `src/render/stage.ts`: the reveal's own capsule slot (`revealCap`), placement of a capsule dropped during a ceremony, inert handles after `dispose()`, `safeTier` on `addBody` / `setBodyTier`, crossfade guard, header documentation for the shell.
- `src/render/capsule.ts`: `touchedDown` (`landed` / `onLand` / `screenPoint` per the contract).
- `src/render/bodyview.ts`: `extraPoolTell` (ceremony pool light in the tier colour); removed an unused field.
- `src/render/decals.ts`: `setColorRGB`.
- `src/render/table.ts`: horizon-peaked dusk glow, halved amplitude.
- `src/render/material.ts`: `drawnTranslucency()` applies the family cap.
- `src/render/rarity.ts`: `safeTier`.
- `src/render/quality.ts`: governor sample clamp.
- `_harness/renderview/view.ts`: `runCeremony` now reports how close each body comes to the top and sides of the frame (`minTopPx` / `minSidePx`).
- `_harness/browser_render.mjs`, new checks:
  - family translucency cap
  - capsule ownership, and a drop during a reveal
  - every ceremony body stays below the frame top (all tiers, both ceremonies, and the 390x844 three-parent merge)
  - a rarity sheet for an opaque family (wisplet, marshmallow)
  - the calm-capsule check rewritten for the new "no point until landed" behaviour; I did not loosen it: it is now stricter (tappable exactly at onLand, y range 0)

Scratch scripts are in `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/render-finish/`: `look.mjs` (look-dev captures), `skipprobe.mjs`, `robust.mjs`, `full5.log`, `full5_report.json`.

GATES (final full run unless stated)
- **G0 typecheck: PASS.** `tsc` clean. A `vite build` to scratch had no StubBody in the bundle (823 of 1229 KB).
- **Durations within 10% of DESIGN 6.1: PASS.**
  - Capsule: 1.60 / 2.00 / 2.60 / 3.23 / 3.93 / 4.53 s against 1.6 / 2.0 / 2.6 / 3.2 / 3.9 / 4.5.
  - Merge: 2.20 / 2.60 / 3.23 / 3.83 / 4.53 / 5.23 s against 2.2 / 2.6 / 3.2 / 3.8 / 4.5 / 5.2.
  - Tier-up merges (Rare, Epic, Mythic): 3.63 / 4.23 / 5.63 s. Quick pop: 0.83 s. Three-parent merge: 3.83 s.
- **Beats on the audio time map (SOUND.md): PASS.** Burst at 0.65 / 0.65 / 0.95 / 1.15 / 1.45 / 1.65 s for the capsule and 1.3 / 1.5 / 1.8 / 2.1 / 2.4 / 2.8 s for the merge. Preroll at 0.65 s. Every beat fires once and in order.
- **DESIGN 6.3 escalation row, exactly: PASS.** Every tier and both ceremonies. Example (Mythic merge): 224 particles, 3 rings, 5% push, 25 degree arc, time scale 0.4 for 0.5 s, one light ramp, nothing dropped.
- **Flash probe: PASS.**
  - The worst 1-second window has 2 luminance transitions (limit 3, swing threshold 0.04).
  - Screen alpha peaks at 0.093 (Common) to 0.213 (Mythic), cap 0.25.
  - FlashGovernor against adversarial input: 12 requests in 1 s get 2 flashes; rings are at least 500 ms apart; coral and cyan never alternate faster than 2 Hz; calm mode gets no flash and no ring.
- **skip() lands on the same final frame: PASS.** Mean fingerprint difference 0.12 to 0.80/255 (threshold 1.5). Crossfade is 4 frames (0.13 s); the result is hidden on 0 frames.
  - My own script skipped at 50 ms, mid-burst and after done: Epic capsule and Common/Legendary merges at 50 ms, mid-burst and 0.9 s; skip after done only on a Rare merge. The differences I can still see in its output are at most 0.52 (Common merge), with no exceptions.
- **Calm mode, every tier: PASS.** Durations x0.65 (for example Mythic merge 3.40 s against 3.38), screen light 0, camera fx 0, no slow-motion, particles x0.3 (67 against 224), rings become fades, no ramps. The capsule fades in (onLand at frame 28, y range 0).
- **Multi-body / leaks: PASS.**
  - 20 cycles of adding and removing three bodies (Common / Rare / Mythic): memory flat at 11 geometries, 3 textures, 13 programs.
  - 3 bodies x 18 cycles with ceremonies: lap 3 equals lap 2.
  - `dispose()` leaves 0 geometries, 0 programs and only 2 textures (owned by three itself).
  - JS heap: 0.18 KB per frame.
  - My own script, 20 ceremonies in a row: renderer memory repeats with period 6 (by tier) and the heap stays flat at 29 to 32 MB.
- **Robustness (my own script, 0 console errors): PASS.** No throw and `done` resolves for:
  - a ceremony started over a running one
  - `dispose()` mid-burst
  - context lost mid-ceremony, then skip and restore, then a three-parent merge with two resizes
  - capsule removed mid-squeeze
- **Item A: PASS.**
  - Sky: worst column step 0.45/255, worst band/kink 0.96/255, over 12 framings (4 aspect ratios x 3 pitches).
  - Low tier, pressed: no straight seam (0.35, same as med).
  - Low vs med at the same frozen pose: 6.26 / 8.01 / 14.47 against limits 8 / 10 / 16.
- **Item C (rarity): PASS.** The smallest difference between adjacent tiers is 2.55/255. The family cap is honoured: 0 of 3000 samples over the cap.
- **Capsule drop: PASS.** Desktop: lands in 41 frames, whole on screen, tappable. Phone: whole on screen, tappable.
- **Ceremony drivers: PASS.** Native drivers: `setFold` reaches 1, tremble during the charge, one `burstOpen`. Drivers hidden: the procedural puppet reaches fold 1.00.
- **Every body stays inside the top of the frame: PASS.** 19 to 40 px margin on the 320x240 probe; 227 px for the three-parent merge on 390x844.
- **Cost (SwiftShader, relative only): PASS.**
  - One body: low 150 / med 307 / high 474 ms.
  - Three bodies cost x2.40 (low) / x2.24 (med) / x1.98 (high) of one body (limit 3.6).
  - The auto governor dropped to low at 409 ms/frame.
- **Round-1 checks: PASS.** All still green.

LOOK: WHAT I JUDGED AND WHAT I CHANGED BECAUSE OF IT
- **Before my edits** (`_shots/render/ceremony_{capsule,merge,merge3}_desktop.png`, `film/*.jpg`, `rarity_sheet*.png`, `phone_390x844.png`, cropped and contrast-boosted):
  - Merge burst clipped at the top in every tier (for example `merge_epic_4_burst.jpg`). Fixed with the framing and the 1.25x pop.
  - Rows framed inconsistently (the Rare row was bigger). Fixed by the merge framing.
  - Pink lighter band in the top 30 to 45 px. Fixed by the horizon glow.
  - Epic burst khaki. Fixed with the tell and pool changes.
  - Mythic burst flash plain green. Now pastel white.
  - Mythic and Legendary result bodies blown out to flat white. Lower tell for those tiers.
- **Final run, all re-read:** `rarity_sheet.png`, `rarity_sheet_marshmallow.png`, `rarity_sheet_phone.png`, `ceremony_capsule_desktop.png`, `ceremony_merge_desktop.png`, `ceremony_merge3_desktop.png`, `ceremony_merge_phone.png`, `ceremony_merge3_phone.png`, `film/merge_epic_4_burst.jpg`, `film/capsule_legendary_6_final.jpg`, `press_held_low` vs `press_held_med_same_pose`. Scratch-run versions of `ceremony_capsule_phone.png` were also checked.
  - Rarity escalates clearly from Common to Mythic on DOLLOP, seeds 16 and 19, and the opaque marshmallow.
  - The capsule stays neutral until the crack.
  - Bursts are one ramp and stay in frame.
  - Low tier is close to med with no seam.

KNOWN ISSUES (plain)
- **Skip is not pixel-identical to the natural end.** It is 0.12 to 0.80/255 off: the natural end lands the real soft body with a nudge, skip resets it, and the poses still differ slightly 3 s later.
- **Skip timing and missing beats.** The stage does not refuse a skip before 350 ms; the shell has to apply that gate. A skip before 'burst' means 'preroll' and 'burst' never fire, so the shell must stop the merge hum itself.
- **Merge framing moves the camera even for Common.** The 12% framing ease in and out is a slow zoom although the DESIGN 6.3 camera column for Common says "none". Calm keeps the play framing and cuts to the result's framing at the burst instead.
- **Phone 390x844, minor.** The Mythic dome and the Rare/Epic auras touch the frame sides (the halos, not the bodies).
- **Rarity, minor.** Uncommon differs from Common mainly by the lagoon light pool and a few flecks. Epic's two-tone barely shows on a tan opaque body.
- **Bursts are still bright.** At the peak 80 ms, Legendary and Mythic result bodies are still very bright (pinkish-white, white-teal), by intent but bright.
- **No native ceremony drivers in physics yet.** The real body has no `setFold` / `tremble` / `burstOpen`, so the puppet is what players see; the native path is tested only through the stub.
- **createBody throwing.** If `createBody` throws inside `play*()`, the error reaches the caller and any views already created stay until the next `clearBodies()`.
- **Stale capsule handles.** `CapsuleRevealSpec.capsule` is not honoured when it is stale: the reveal always takes the current capsule, or a standing one.
- **Machine load.** These timings come from a shared 4-core machine where other agents were running browsers, so perf and governor numbers are noisy.

CONTRACT CHANGES
None to `src/contracts.ts` (not my file). Behaviour notes for its owner:
- `CapsuleHandle.landed` and `screenPoint()` now follow the existing text (true and non-null from the first touchdown or the end of the calm fade, the same moment `onLand` fires; null while falling or opening).
- The reveal owns its capsule.
- A disposed stage returns inert handles.
- Unknown tiers are drawn as Common.
- The jelly honours `translucencyMaxOf(familyOf(species))`.

STAGE_API_FOR_SHELL
`createStage(canvas)` from `src/render/stage.ts`; every round-2 `StageLike` member is implemented.

1. **Each frame**
   - Step every body the shell added (`body.step(dt)`), then `stage.update(dt, { time, pointerNdc })`, then `stage.render()`.
   - The stage steps only the bodies it creates through `spec.createBody`, until it hands them over.

2. **Play body**
   - `stage.setBody(body, genome)` (equal to `clearBodies()` plus `addBody` at 'common'), then `stage.setBodyTier(stage.primaryBodyId(), tierOf(genome.species))`.
   - Extra bodies: `addBody(body, genome, { tier, position })`. The position is a render offset only, so raycast the raw body with `origin - position`.
   - Also available: `removeBody(id)`, `clearBodies()`.

3. **Meter-full capsule drop**
   - `audio.meterFull({ quiet: fingerDown })`, haptic [10], then `cap = stage.dropCapsule({ onLand: () => { haptic [18] } })`.
   - Calm: it fades in where it stands, and `onLand` fires after about 0.45 s.
   - It lands beside the play body (in front of it on portrait), or beside the pad during a ceremony.
   - Until `onLand` (`cap.landed`), `screenPoint()` is null and `hitTest()` is false.
   - Another `dropCapsule()` replaces an unopened capsule. Queueing up to 5 is the HUD's job.

4. **Hold to open**
   - On pointerdown, if `cap.hitTest(cssX, cssY [, slop = 14])` (CSS pixels over the canvas): every frame call `cap.setSqueeze(holdSeconds / 0.5)` and optionally `audio.capsuleBeat({ beat: 'grab', progress })`.
   - Release early: `cap.setSqueeze(0)`.
   - At 1, or on a tap: ask the server for the result, then immediately call `playCapsuleReveal`.
   - Never open while the play body is being squished.

5. **Capsule reveal**
   - `h = stage.playCapsuleReveal({ result: { genome, tier, isNew }, createBody: (g) => new SoftBody(g), capsule: cap, quick: fastOpen && repeatCommonOrUncommon, keepCurrent: false }, { onBeat })`.
   - From this call the reveal owns `cap`: its `screenPoint` is null and `setSqueeze` / `remove` are ignored.
   - Beats from `onBeat(beat, { t, tier })`:
     - 'grab' at 0: `capsuleBeat` grab.
     - 'crack' at 0.35 s: `capsuleBeat` crack. The tier light leaks through the cracks from here.
     - 'preroll' (Rare and up, 0.65 s): `audio.reveal({ tier, isNew, mythicVariant, calm })`.
     - 'burst' (0.65 s plus the preroll): `capsuleBeat({ beat: 'burst', tier })` and the DESIGN 6.7 haptic.
     - 'reveal' (burst plus 0.35 s): for Common/Uncommon `audio.reveal(...)`; show the name plate and the NEW / x2 chip.
     - 'settle' (the end).
   - Calm scales every time by 0.65; pass `calm` to audio too.
   - The current squishy slides off and is removed. With `keepCurrent` it slides aside and stays, but is no longer primary.

6. **Merge**
   - After the 0.5 s pad hold and the server decision: `h = stage.playMergeCeremony({ parents: [MERGE_COST x { genome, tier }] (2 or 3), result: { genome, tier, tierUp, isNew }, createBody }, { onBeat })`.
   - All visible bodies, including the play body, are hidden at the start and removed at the end.
   - Beats:
     - 'press' at 0: `mh = audio.mergeStart({ tier, calm })`, rumble.
     - 'fold' at 0.4 s.
     - 'charge' at 0.9 s.
     - 'burst' at 1.3 / 1.5 / 1.8 / 2.1 / 2.4 / 2.8 s: `mh.burst({ tier, tierUp, mythicVariant })` and the haptic.
     - 'reveal' (burst plus 0.2 s): name plate, NEW / spare, TIER UP banner. The stage itself adds the 0.4 s tier-up accent at the end.
     - 'settle'.
   - Durations: 2.2 / 2.6 / 3.2 / 3.8 / 4.5 / 5.2 s, plus 0.4 s for a tier-up, x0.65 in calm.

7. **Skip**
   - Any tap after 350 ms (the shell's gate), or the "Skip animations" setting right after starting: `h.skip()`.
   - It crossfades to the final frame in 120 ms and fires 'reveal' and 'settle' if they have not fired yet.
   - If 'reveal' arrives without a 'burst' first, stop the merge hum (`mh.stop()`) or play the short motif.

8. **Calm mode**
   - Call `stage.setCalmEffects(settings.calm)` before a ceremony. It is on by default under `prefers-reduced-motion`.
   - Effects: no camera moves, slow-motion, flash or pulses; particles x0.3; rings become fades; durations x0.65; the capsule fades in.
   - `setShakeScale` is a separate setting.

9. **When the ceremony ends**
   - `await h.done`. It never rejects, and it also resolves when the ceremony is interrupted or the stage is disposed.
   - Then `body = h.resultBody`: the stage has stopped stepping it, it is the primary body (`primaryBodyId() === h.resultBodyId`) and it already carries the result tier.
   - Step it, raycast it and send fingers to it. Its offset is 0 and its physics origin is the world origin. Do NOT call `setBody()` on it.
   - Update the HUD and collection, re-enable input, and drop the next queued capsule if any.
   - Starting a new ceremony resolves a running one at its final frame. After `stage.dispose()`, the play calls return inert handles (`done` resolved, `resultBody` null).