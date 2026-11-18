# PG_RENDER lane brief: places, props, squishmoji bubbles, eyes, poses and looks on the Three.js stage

Read first, in this order: `_handoff/STATUS.md`, `_handoff/briefs/COMMON.md`, `_handoff/briefs/SESSION3.md` (it wins where they differ), then this
brief. Paths are relative to `games/wobblehoard`.

**Revision 3 (2026-11-15, after the adversarial review; PLAYGROUND_BUILD.md 2 D-60 to D-84 and 23).** What changed for you: **Home's view**
(D-67): with LIFE on, Home keeps today's framing of the mat slots in use, and a new **`visibleTable(out)`** reports the table area inside the
frame and outside the HUD insets, which the shell turns into Home's LIFE bounds, the Felt Ball's bounds and the arrival test of Home's things
(by projection one body shows only about +-0.76 m of table on 390 x 844); **every place has a tall layout** (D-68) that `setPlayBounds` frames
inside the insets (RD-17: at least 100 CSS px at the front and 80 px mid on 390 x 844); every place chunk draws both layouts; the emote colour
fixes (one accent at 3:1 on the cream fill); **Calm or reduced motion: every new motion is a fade**, and a wish re-glance is an opacity lift;
particle presets for the reaction cells (D-80); new rows RD-16 and RD-17; your first-load share is capped at 16 KB.

**Revision 4 (2026-11-16, after `_handoff/design/CONFIRM.md`; PLAYGROUND_BUILD.md D-85 to D-93).** What changed for you: **`visibleTable`'s box is
exact** (the full visible depth by the near row's x range, clipped to +-3.4 m; PLAYGROUND_BUILD 9) and the shell turns it into Home's corral
rectangle (with the slots) and the Felt Ball's bounds, while Home's things show by their data's party size (`fromN`, PLACES 4.1's spot table,
D-87, D-88); **RD-16** checks a whole body at every LIFE target and use spot, every slot inside the corral rectangle and every shown thing in view;
the Keepsake Shelf is 1.2 x 0.45 x 0.30 m with two rows of ten and the Warm Lamp's glow is r 1.2; the cabin's swing pivots moved (PLACES 4.2,
D-91); S03's soft boop needs a **render wiggle** on the booped body (0.05 R at 3 Hz for 0.6 s, 2 Hz in Calm or with reduced motion: `setBodyPose`);
the away chunk's cap is **90 KB** (D-92); section 24 of PLAYGROUND_BUILD asks the orchestrator whether the one-squishy portrait framing at Home
should count the Felt Ball's spot as `framingFor` counts a capsule (FN-01: do not build it before that answer).

## You own
- `src/render/**`: additions to `stage.ts` and `material.ts`, and new modules: `emotes.ts`, the place host `place.ts` (the away chunk), the props kit,
  water, marks, weather presets, `places/<id>.ts` (one lazy chunk per place)
- `_harness/browser_render.mjs` (new sections `place`, `props`, `emote`, `marks`, `pose`, `homeview`, `size`), `_harness/renderview/**`
- Running report: **`_handoff/reports/PG_RENDER.md`**. Port 5364. Scratch:
  `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_render/`

## You must not touch
`src/shell`, `src/ui`, `src/input` (the bubble hit areas, word labels, the Journal and Travel are DOM: PG_SHELL), `src/physics`, `src/audio`,
`src/life`, `src/data`, `src/core`, `src/collection`, `index.html` (the CSP), `vite.config.ts`. Contract changes: additive and optional in the
PLAYGROUND block only, reported. No git write command.

## When you may start
S0 work now, in the renderview (emotes, faces, poses, sleep skip, the lite chunk mesh, eyes through jelly, `visibleTable`): nobody else is in
`src/render`. The place host and the cabin chunk (S1) need PG_DATA's `place_hearthlog.ts` (both layouts) and PG_PHYS's pose layout; build them
against PLACES 4.2 and a stub `poses` array in the renderview until those land.

## Read (completely)
`_spec/PLAYGROUND_BUILD.md` 2 (D-25, D-26, D-37, D-41, D-46, D-48, D-50, **D-67, D-68, D-80**), 7 (the StageLike members, revision 3:
`setPlayBounds` with the layout inside the insets, `visibleTable`, `bindProps` with the fixed prop order), **9 (your spec)**, 13 (chunks), 14
(budgets: 14.3 your 16 KB first-load cap, 14.4 on-screen size), 17 T10, 18 (the RENDER rows RD-01 to RD-17), 19, 23; `_spec/PLACES.md` 1 (P1, P7
to P10, P13, P14: **P7 the two layouts and the tall frame, P8 the camera**), 2.3 (the place frame), every place's "Look" paragraph and its signature
verb and finale spectacle (4.1 to 4.10; **4.1 Home's view and arrival rule; 4.2 the cabin's two layouts**), 3 (the channel rule: which cells need
a particle preset); `_spec/LIFE.md` 5.1 (the render pose limits), 7 (squishmoji: icons, sizes, colours, motion, taps, photos), 9 (pieces), L7 and
L8 (no camera from autonomy; eyes only); `_spec/UI.md` (the icon family's stroke and terminals, line 33; tokens; 18: reduced motion and Calm);
`_handoff/maps/RENDER.md`; `_handoff/reports/SHELL_4.md` "Seams for PLAYGROUND" 2 (`stage.setBody` clears every view, bodies.ts 112) and its
render findings (the "four-eyed" look through a clear jelly, the bridge's tube look).

## Build: S0 "Life at Home" (first load: the stage chunk)
1. **`emotes.ts`**: one instanced, alpha-blended billboard draw, renderOrder 40 and up, depth test off, a pool of 8 slots; the 24 icons of LIFE 7.1
   as SDF shapes (at most 4 primitives each) in one fragment shader, no texture (CSP-safe); styles say, think and group (double outline, count dots
   1 to 3), the sparkle badge; cream fill at 0.92 alpha, ink icon, **one accent per icon, each at least 3:1 on the cream fill** (the leaf lagoon
   only; the moon an ink crescent with an amber fill; the postcard a sky band inside an ink frame, RD-04), a 1.5 px plum outline; at least 36 CSS
   px with a 22 px icon on a phone, 40 / 26 px on a desktop, x0.85 for a group, 40 / 46 px for a wish; in 0.15 s (0.6 to 1.0 with 6% overshoot),
   hold 1.6 s, out 0.25 s; **Calm or reduced motion (each on its own): a 0.25 s fade, and a wish's re-glance is a 0.2 s opacity lift, never a
   grow** (RD-09); **never a flash, nothing bobs**; anchor 1.3 x rest radius above the top, inside the safe insets, stacked, slid clear of the
   capsule, never over the reveal plate; `emote`, `clearEmote`, `emoteScreen` (out-param, zero allocation), `setEmotesInPhoto` (default on).
2. **Faces**: `setBodyGaze` (the pointer always wins on a touched body), `setBodyExpression` (none, happy, sleepy, surprised, shy, proud; eyes only:
   no mouth, no blush).
3. **`setBodyPose`** in the jelly vertex stage AND the same transform on the eye anchors on the CPU (face.ts fits the beads to the sim footprint):
   lean at most 0.1 R, sway at most 0.05 R at at most 4 Hz (a shiver 7 Hz at 0.015 R), slow breathing while asleep (and the slow, deep breaths of
   a basking firm or pop dome squishy, PLACES 3.1). The sway phase comes from the shell (`LifeIntents.e`, or `musicClock`'s beat for the render
   only).
4. **`setBodyAsleep`** skips the fine-mesh evaluation (eyes still blink, the pose still sways); **`AddBodyOpts.lite`** draws chunks with the low fine
   mesh (2562 vertices) on med and high.
5. **Eyes seen through another body's jelly are depth-faded** (RD-12: SHELL-4 reported a squishy's eyes crisp through a clear jelly in front).
6. **No camera motion from autonomy** (D-37, RD-14): at Home with LIFE on, the one-body follow (stage.ts about 533) and `framingFor`'s live
   framing follow only player-caused motion (a toss) and otherwise frame the mat slots in use. The neck-swell stopgap in `framingFor` stays
   Home-only until PHYS fixes the swell (T10).
7. **`visibleTable(out)`** (D-67, RD-16): [xMin, zMin, xMax, zMax] of the table seen inside the frame and outside the HUD insets at the rest
   framing of the slots in use (the camera scales with the body, stage.ts 468), true when valid; **exactly** (revision 4, D-87): z from the ground
   row under the top inset line to the ground row under the bottom inset line, x the near row's range (the narrowest), each clipped to +-3.4 m; it must match the rendered frame within 0.05 m at
   390 x 844 and 1280 x 800 with 1 to 5 bodies at body scale 0.8, 1.0 and 1.25. Measured by projection with the stage's constants (fov 35, pitch
   0.27, target y 0.42, distance max(3.0, 2.4 / aspect)): one body on 390 x 844 sees about +-0.76 m at the table centre, on 1280 x 800 about
   +-1.51 m with no table in front of the body (the bottom HUD covers z > 0.3 x scale).
8. `setObstacles` (the capsule lands clear of prop footprints), `bodyScreenPoint` (out-param), `bindProps` (the props in `PropWorldLike`'s fixed
   order, with `propThing` and `propPart`).
9. Home's things (PLACES 4.1): the Felt Ball, the Music Box, the Snooze Rug (a darker stitched felt disc), the Warm Lamp (a 0.36 m base, its shade
   reaching 0.6 m) and its glow (r 1.2), the Keepsake Shelf (1.2 x 0.45 x 0.30 m, two rows of ten) with 20 small procedural keepsakes (QUESTS 10),
   all tiny, in the stage chunk, at the spots of PLACES 4.1's table; each drawn only once it has arrived (the shell tells you: its event and the
   party at least its `fromN`; parked below it),
   with a little scale-in (**Calm or reduced motion: a fade**). With no thing out, Home is today's frame bit for bit.

## Build: S1 "Hearthlog Cabin"
10. **The place host** (`place.ts`, in the away chunk): sky presets through `Table.setSky` (the 9 uniforms and fog, table.ts 198-204) or a place
    sky shader; a ground mesh with its own band-limited noise (top at y = 0); 3 to 6 backdrop cards (renderOrder -99 to -51, low poly); weather through
    `Particles` with a normal-blend option; the three lights as stage fields with the jelly's `uKeyDir`, `uRimDir`, `uKeyCol`, `uRimCol` and
    `KEY_TINT` re-derived per place (material.ts 329-338, 386-390); env panels as data with `EnvHub.rebuild` and the old cube disposed; the ceremony
    dim easing over at least 1.0 s; context loss rebuilds the place env (stage.ts 615-625); `loadPlace` (a lazy import with a bare `'three'`
    specifier) and `setPlace` under the ScreenFx snapshot crossfade (never a flash).
11. **`setPlayBounds` for both layouts** (P8, D-68, RD-17): frame the bounds of the layout in use so that a body anywhere inside them, a back
    body's bubble included, stays inside the HUD safe insets; for the tall layout on 390 x 844 the designer's fit used pitch 0.5 rad at about 14 m
    (inside the allowed pitch 0.15 to 0.9) and got about 101 CSS px for a 1 m squishy at the front and 83 px mid (57 px with the wide layout
    framed whole). Report the px numbers per place and layout. A rotation re-frames at the next idle moment under the crossfade (the shell drives
    it); never a camera move from autonomy.
12. **The props kit**: shared geometries and materials per kind (MeshStandardMaterial with `hub.apply`), `InstancedMesh` for repeated statics, movers
    posed from the bound `poses` (8 floats a prop), opaque props at renderOrder 0 to 9 before the jellies, one instanced contact-shadow draw.
    **Particle presets for the reaction cells** (D-80): a steam wisp (normal blend, the weather twin) for the warm cells that say "steam", drips, a
    soft bubble cling, embers; each counts against the autonomy particle cap (LIFE 10.1), x0.3 in Calm, none with reduced motion.
13. **`places/hearthlog.ts`** (lazy; at most 45 KB together with PG_AUDIO's `src/audio/places/hearthlog.ts` and PG_DATA's
    `src/data/place_hearthlog.ts`, which the size gate counts with it, PLAYGROUND_BUILD 13 and T1), **both layouts from the same kit**: round-log
    walls in plum and dusk, the stone fireplace with the amber firelight key and embers (additive, 24 / 16 / 8 by tier, x0.3 in Calm, none with
    reduced motion), the back window with snow behind the pane (a card), the braided coral and cream rug, the 2.2 m Rocker Board, the Yarn Ball,
    the Pillow Swing under a ceiling beam (it swings across the room in the wide layout and toward the camera in the tall one; both pivots moved in
    revision 4, PLACES 4.2), the Snug Basket,
    the Singing Kettle with its steam puff when it whistles; mean luminance about 0.20; token colours only.
14. **Body looks** in the jelly program: `uToast` (with `uHeatPos` from `setHeatPoint`), `uWet`, `uFrost`; cache key `wh-jelly-v5`; each checked on
    the WH_LOW path; with every look at 0 the gallery is pixel-identical to v4 (RD-02). The finale spectacle: the fire swells and the embers rise in
    time (**Calm or reduced motion: a slow glow**). The strand look when a tacky body leaves a prop (the shell triggers it, D-54).

## Build: S2 and S3
S2: water (one translucent surface per water zone drawn after the jellies, depth test on and depth write off, the render-only edge ring, the
under-the-waterline tint from `setBodyWater`), marks (one ring buffer of instanced quads, 64 / 48 / 24 by tier, the decal alpha trick of decals.ts
100-104), snow and rain (normal blend), `uSand` and `uSnow`, the ceremony dim for the bright places, and the chunks of Ripple Shore, Frostbell Ridge
and Rainleaf Garden in both layouts with their spectacles (the sunset; the stars over a snuggle; the leaves' drips in key). S3: Fizzwell Tub,
Cogwhistle Bench, Lanternroof (parapets on three sides and a low one in front; twinkling stars as a shader, never a flash), Echo Hollow, Cloudloft,
and their spectacles, each in both layouts.

## Acceptance ids you must make pass
RD-01 to RD-17 (browser, port 5364): S0 needs RD-04, RD-05, RD-06, RD-09, RD-10, RD-11, RD-12, RD-14 and **RD-16** in the renderview; S1 adds
RD-01, RD-02, RD-03, RD-07, RD-08, RD-13 and **RD-17** for Home and Hearthlog (both layouts); RD-15 from S2. You also make the screenshot for FN-02
possible (four families by the fireplace) and SZ-02's chunk sizes. Run per-place rows only for places whose chunk or the shared kit changed (name a
hash of each chunk in the report) and one full sweep before each slice ships: the full render run is already about 52 minutes (JUDGE_FEASIBILITY
F25). One browser at a time.

## Budgets
Render CPU at most 4.5 ms a frame on a med phone; under today's 8.9 KB allocated a frame; at most 60 draw calls for a place's set and props in
each layout (RD-08); 4 asleep bodies at most 0.3x the CPU update of 4 awake (RD-05); 6 pieces against 2 wholes at most 1.2x (RD-06, from x1.32 to
x1.45 today); play-area mean linear luminance at most 0.35 per place, no pastel (L at least 0.80 with chroma under 0.09), token colours only
(`src/ui/theme.ts` 4-13) in OKLCH mixes (RD-13); each place at most 45 KB with its audio recipe and data module, the away chunk at most 90 KB
(revision 4, D-92: report its bytes at S1's first step; the estimate is 44 to 66 KB with PG_AUDIO's ambience bed and prop voices);
**your first-load share at most 16 KB** minified (gaze, expressions, poses, looks, `visibleTable`, the emote draw, Home's thing meshes;
PLAYGROUND_BUILD 14.3); after every step report the minified bytes of each new or grown module (14.3's one-file rolldown build); the flash gate of
DESIGN 6.6 (at most 2 flashes a second, RD-03).

## Never
A camera move caused by autonomy; a flash; a mouth or a blush; a heart icon; a texture, model, font or image file; a colour outside the token mixes;
a grow or pulse in Calm or with reduced motion.

## OWNER DECISION 2026-11-18 (D-96): the place list is seven, not ten
The owner saw concept sketches of the five undrawn places and decided: "lantern roof and cloudloft ONLY."
- **Kept (7):** Home, Hearthlog Cabin (open), Ripple Shore, Frostbell Ridge, Rainleaf Garden ("for sure must work"), Lanternroof, Cloudloft.
- **Dropped (3):** Fizzwell Tub, Cogwhistle Bench, Echo Hollow. Do not build their visuals, physics (magnet, turntable) or shell wiring.
  Their data, sound and quest rows must not ship in the build or show anywhere to the player (remove them from the chunks and from the
  quest, wish, fact and keepsake totals: no stamp, wish or count may name or depend on a dropped place). The Float setting stays as it is.
- Order: beach, mountain, garden first; then Lanternroof and Cloudloft (wind gusts and the updraft are the only new physics).
- The owner also said two open 3D places "is NOT enough": opening places is the priority after the first deploy.
