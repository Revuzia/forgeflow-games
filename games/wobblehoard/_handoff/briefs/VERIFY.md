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

**Lens C, quiet performance.** Run **alone**: the orchestrator guarantees no other heavy job. `perf47.ts`, `perf.ts` workloads A and B for every
family, then 2, 4 and 6 whole bodies with `collide`, and 6 pieces versus 2 whole bodies (`CUT.md` X08). Report the load average or
CPU usage before and after, mean and p99 ms per frame, and the 2.0 ms bar. State plainly which numbers meet the bar and which do not.
