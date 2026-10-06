# Verification charters (session 2): independent checks of render, shell and physics

Read `COMMON.md` and `RESUME.md` first (machine, paths, protocol). A verifier changes no source file and runs no git write command. It
works on a **snapshot of the committed commit named in the task** (`git archive` + a `node_modules` junction; see RESUME.md section 1), on
its own port, one heavy job at a time. The verifier writes one report file, `_handoff/reports/<NAME>.md` (the only repo file it creates),
and returns the structured summary the task asks for.

Every finding has: id, severity (MAJOR = breaks a gate, a safety rule, the owner's requirement or a core feel; MINOR = visible or
measurable but the product works; NOTE), a repro command with its output, and the file and line when known. A claim of "fixed" or
"passes" must quote the number you measured. If you could not check something, say so; do not round up.

## RENDER, lens A: flash safety, robustness, bundle, memory

1. Copy `_handoff/verify_render/*` to your scratch and port the paths (`/home/user/...`, `/tmp/...`). Use port 5370 or 5371.
2. Re-run the repro of **every** finding in `_handoff/verify_render/VERDICT.md` (MAJOR 1, minors 2 to 13, and the known items) against
   the snapshot and report each as FIXED, STILL FAILS or CHANGED, with the number. In particular: `adv.mjs` chains (Mythic skipped then a
   quick Common at 30 fps; the 480x300 med 60 fps list), `gov_fuzz.mjs`, `alpha_probe.mjs` / `rawpx.mjs` / `black2.mjs`, `robust.mjs`
   (`misuse_mid`, `throwing_callbacks`, `twenty`).
3. Flash gate for the new cut visuals (`CUT.md` X09): 10 rapid cuts and a Reconnect all, in normal and Calm, through the real stage
   API (`setCutSeam`, `setBridge`, parting pieces), and a cut adjacent to a ceremony. At most 3 luminance transitions in any 1 s (aim 2),
   no screen flash, with the verifier's own measurement code.
4. Bundle: `vite build` the snapshot, then grep `dist` for the dev members (`createStageDev`, `loseContext`, `restoreContext`, `StubBody`,
   `renderview`, `__RV__`, `lifecycle3`). None may ship from `src/render`. Report anything else dev-only that ships (for example the
   shell's `__shot`) separately as out of the render lane.
5. Memory and leaks: 20 mixed ceremonies flat; dispose mid-ceremony leaves 0 geometries and programs; 20 rounds of "cut into 6 and
   reconnect all" leave geometry, texture and program counts flat; context loss and restore; no page or console error.
6. Per-frame allocation in the ceremony, cut seam, bridge and strand paths; determinism (two runs give identical frames or hashes).
7. Run the full `_harness/browser_render.mjs` once on the snapshot. Report the counts, failures verbatim, console problems and minutes.
8. `npx tsc --noEmit -p tsconfig.json` clean.

## RENDER, lens B: look, layout and the cut visuals (you can see images: Read every sheet and judge as a demanding art director)

1. **Gallery.** All 50 species at 1280x800 and 390x844. Say which pairs a player could confuse at a glance, and which silhouettes
   do not read (the physics lane still lists wrigglo, pastrel, thumbly, boingle and crimpo as weak: note whether the render look rescues them).
2. **Capsule placement.** On 1280x800, 1920x1080, 390x844, 844x390, 568x320 and 320x256, with and without the shell's safe insets: the
   capsule never lands in front of the squishy, under the HUD, or off-screen. Re-check the old "phone capsule in front of the squishy" case.
3. **Mat.** 2 to 5 bodies framed on desktop and phone; no camera jump when `setBody` is called with mat bodies out.
4. **Cut visuals.** A piece with no face (`chunk`) that matches the family material, colour and pattern; the seam glow (a glow, never a
   flash); the parting strand per family (long for sticky and slime, barely visible for gel); the reconnect bridge; 6 pieces on the mat
   framed; Calm variants softer. Film strips at mid-neck, right after separation, bridge, whole again. Say what looks wrong or cheap.
5. **No regression of the rarity ceremonies.** Contact sheets Common to Mythic for both ceremonies at desktop and phone: merge T2 tell reads
   for Uncommon, Rare and Epic; Epic motes are not laser lines; capsule halves do not read as a mouth; phone halos clear of the edges;
   Legendary and Mythic bursts are not blinding.
6. Judge honestly: list every art problem with severity and a screenshot path. A PASS means no MAJOR and a short minor list.

## SHELL, lens A: the Cut tool and its rules on the real stack (`_spec/CUT.md`, `_spec/FUN.md`)

Drive the real game (`?dev=1&lab=1` where the harness does) with the real physics, render and audio engine in the browser harness.
1. Prove **X01 to X10** of `CUT.md` section 6 one by one at the level of the whole app (the physics-only ones are covered by
   `probe_cut.ts`: run it too). Cut into 2, 4 and 6 pieces by swipe and by the **Split in two** button; refuse a cut that leaves a piece
   under 1/8 and a 7th piece (4th on `low` quality), cleanly, with the live-region line.
2. Reconnect: drag a piece into another (0.4 s hold, and release while touching); **Reconnect all** (about 1.2 s); the result equals the
   original genome, size and silhouette (X04) and the Hoard never shows a piece (X05).
3. Every **leave path** reconnects first: switch squishy, open the Hoard, open a capsule, start a merge, the tab hidden for more than
   60 s, reload; instantly when off screen.
4. The meter: a cut and a reconnect pay nothing; a poke on a piece pays like a poke on a whole squishy; no double pay when
   `CALIBRATION.bendWithPress` is involved (X06).
5. Toss a piece; stack pieces; the `lift`, `toss` and `bump` events reach `audio.lift`, `audio.toss`, `audio.bump` and a haptic (spy on the
   real engine's methods; do not accept a stub that you wrote).
6. Run the browser shell harness sections for SHELL-4 and the whole harness once; `probe_app`, `shellview/node_checks.ts`, `probe_cut.ts`,
   `tsc`. Report counts and failures verbatim.

## SHELL, lens B: tray, Snap, UX, accessibility on desktop and phone (judge the screenshots as a product designer)

1. The **Toys tray** (Hand, Cut, Snap shown; Stamp and Roll absent or clearly "soon"): open and close, keyboard (`T`, arrows, Enter when
   shortcuts are on), focus management, Escape, 1280x800 and 390x844, 320 px reflow, reduced motion, Calm effects.
2. **Snap**: HUD hidden, camera turn, backdrop tint, a saved PNG that is really a PNG of the squishies (open it; check size and that it is not
   blank or black), the HUD comes back, nothing is paid.
3. The play view stays clean: the meter status line does not peek out under the Hoard card; long species names fit the phone name tag;
   nothing overlaps at 390x844, 844x390, 568x320, 320x568.
4. Screen-reader live-region lines for cut, reconnect, snap, tool changes. No keyboard trap. Focus visible.
5. The three title checks and the 5-squishy quick switcher still hold. Report every visual defect with a screenshot path.

## PHYSICS (checkpoint 47 and later): independent re-verification

Use the scripts in `_handoff/verify_physics/` (copy and fix paths; `--root` points at your snapshot). Do not loosen a threshold.

**Lens A, the old verdict's sets on the new commit.** `hop.ts` (squeeze and release: no particle more than 10 mm above the table, all 50
species x 3 genomes x 2 pressure profiles), `pullset.ts` (full pulls: creases over 120 degrees), `rubset.ts` (rubs on catalog bodies, template
and soft-corner), `attack.ts` (7,128 scenarios), `cer_iso.ts`, the realistic and drag sets (`dense.ts`, `realistic.ts` if saved), the
family-swap discrimination test (`run_swaps.sh`), `probe_softbody`, `probe_species`, `probe_families`, `probe_cut`, `run_probes`. Compare
each number with the engineer's claims in `impl_reports.md` and with the old verdict. Also listen to nothing; look at the filmstrips from
`browser_physics.mjs` (`family_demo`) for putty, sticky, slime, marshmallow and a toss.

**Lens B, phase 2 attack (new).** Cuts down to 1/8 and six pieces deep; random reconnect orders; reconnect all from every depth (result equals
the original: shape RMS under 0.002 R0, same volume, same genome); tosses at 6 m/s into the table, the mat's rim and other pieces; a mixed
stack of 5 whole bodies for 10 s (sag allowed, sinking or tunnelling not); NaN, Infinity and out-of-range inputs to every new method
(`measureCut`, `setNeck`, `setFrac`, `collide`, the pick-up and toss calls) must not poison state; determinism (the same script twice gives
the same hash); zero allocation per step in steady state with 2, 4 and 6 bodies; no piece folds, hops or tunnels (the probe_softbody limits per
piece); volume conservation through every cut and reconnect.

**Lens B, addendum: the two-handed pick-up rule (session 2, owner report "squish two sides and pull now LIFTS the squishy").** The fix is a
latch in `softbody.ts` `updateGrabs` (`twoHanded`): only a lone hand may start a carry (a grab target asked past `LIFT_OVER` x maxPull); while
two fingers (a press or a grab on each slot) are on the body it is stretched and held to the mat, and the latch lasts until every finger is up.
Break it: every ordering of fingerDown / fingerPressure / grab / grabMove / fingerUp / grabRelease on slots 0 and 1 (random sequences, at least
10,000, plus the hand-written cases: two grabs on opposite sides, press + grab, top press (Space) + grab, one finger lifting early, the second
finger arriving after the first pull is already past the limit, a carry in progress when a second finger lands, a release hand-over) on all 50
species x 3 genomes. Required: `metrics.carried` is never set by a pull that started while two fingers were on the body; the latch is never
stuck (a lone pull after every finger was up always lifts); a carry that began one-handed still hands over and throws as before; no NaN, no
penetration, no fold beyond the probe limits at the clamp; determinism (the same script twice gives the same hash); no allocation per step.
`_harness/probe_cut.ts` has the permanent row (B3b); the saved repro is in the orchestrator's scratch (`lift/lift_repro.ts`), do not rely on it.

**Lens C, quiet performance.** Run **alone**: the orchestrator guarantees no other heavy job. `perf47.ts`, `perf.ts` workloads A and B for every
family, then 2, 4 and 6 whole bodies with `collide`, and 6 pieces versus 2 whole bodies (`CUT.md` X08). Report the load average or
CPU usage before and after, mean and p99 ms per frame, and the 2.0 ms bar. State plainly which numbers meet the bar and which do not.

## ECON: "short taps pay nothing" (owner decision 2026-10-06; reverses the earlier "ordinary tapping always earns")

Independent re-check of the economy change. A tap (the 'poke' SoftEvent, and a squeeze released under 0.4 s) pays 0 SP, makes no spark and does
not move the meter ring; squeezes held >= 0.4 s, stretches and holds pay as before (re-tuned so the pace holds). Work in a snapshot, no browser.
1. **Hunt for any path where a tap still pays**: the poke rule, the double-tap gap, freshness, the medley bonus (an unpaid tap must not unlock it),
   a squeeze under 0.4 s, `previewTouch` (the pending arc), the ghost economy and restock/task rewards, the shell's `xp.ts` constants path, the
   server SQL drafts in COLLECTION and TRADE (quoted pay values must match the code; they stay marked NOT APPLIED).
2. **Re-run the economy simulation yourself** (`_harness/sim_economy.ts`) from a clean copy and compare with the engineer's table: median active
   minutes per capsule for the squeezing, pulling and mixed archetypes in the 3.0 to 3.8 band; what a pure tapper now earns (it should be 0:
   report it plainly); bots and the per-minute valve and daily cap still bound machine-speed play. If the pace left the band, MERGE_COST = 2
   depends on it: say so.
3. Probes: `probe_economy`, `probe_collection`, `probe_merge`, `shellview/node_checks.ts`, `probe_app`, `tsc`: counts and failures verbatim. Every
   check the engineer re-specified needs a written reason in its report; check each reason is honest (not a loosened threshold in disguise).
4. Docs and quotes: DESIGN 5.4, FUN.md section 2, and every place that quotes a pay value agree with `meter.ts`.

## SHELL input: Shift + drag pulls both sides on PC (owner decision 2026-10-06)

Independent re-check of the gesture change in `src/input/gestures.ts`, `pointer.ts` and the shell glue (`game.ts` PointerIn, `driver.ts`).
1. **Differential test**: the pre-change gesture machine (`git show HEAD:games/wobblehoard/src/input/gestures.ts`, the commit the task names) and the
   new one must emit identical actions for at least 20,000 random pointer sequences that never set `shift` (taps, squishes, rubs, pulls, orbit,
   two fingers, cancels). Any difference is a MAJOR regression.
2. **Mirror fuzz**: random sequences with Shift on and off (set before the press, set during the press, released mid-drag), Space's synthetic
   pointer holding the other slot, a second touch, cancels, `cancelAll`, a hit test that fails at the mirror point, the body moving. Invariants:
   every emitted `grab` is later released exactly once; no action after `cancelAll`; no stuck slot (a later press always gets a slot); a mirror
   never starts when the other slot is busy; touch (non-mouse) never mirrors; the mirrored target is the reflection of the real one through the
   body's screen centre; determinism.
3. **Real physics**: drive the real `SoftBody` from the gesture actions (as `driver.ts` does): a Shift pull past 1.15 x maxPull never sets
   `metrics.carried` and stretches to the maximum on both sides; a plain one-finger pull still lifts; no NaN, fold or penetration; the meter pays
   a Shift pull as one pull (report the numbers).
4. In a real browser if the render tree is stable (your own port, at most one browser): Playwright mouse + `keyboard.down('Shift')` on the real
   game: both sides stretch, release restores, the hint line mentions Shift on desktop only. If the render lane's in-progress edits break the
   page, say so and rely on 1 to 3.
5. `probe_gestures`, `shellview/node_checks.ts`, `probe_app`, `tsc`: counts and failures verbatim.
