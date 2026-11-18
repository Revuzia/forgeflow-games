# R6_RENDER: round 6, the RENDER lane (src/render and the render harness: _harness/renderview/*, _harness/browser_render.mjs; port 5364)

Brief: the orchestrator's round-6 task (SESSION3.md machine rules; owner decisions D-95 revised and D-96 at the end of `_spec/PLAYGROUND_BUILD.md`).
No earlier R6_RENDER report existed: this is the first round-6 render engineer. Started 2026-11-18 at HEAD 861665740 (live = 23c684a60).
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/r6_render/`. No git write command is run.

## Status (updated after every finished item)
| Item | What | State |
|---|---|---|
| 0 | baseline | DONE: tsc 0 errors (2.2 s); `renderview/pg_node_checks` 40 ok / 0 FAIL |
| 1 | Lanternroof and Cloudloft looks (`src/render/places/lanternroof.ts`, `cloudloft.ts`), wide + tall shots judged, RD rows, bytes | DONE: 6 shot rounds judged; place run 2 ALL PASSED; bytes 24.0 / 18.2 KB of 45 |
| 2 | the squirt arc (LIFE_EV.SQUIRT seam of R6_DATA 3) as a stage member | DONE (`stage.squirtFx`, contracts.ts); row ok in run 2; the shell's call is a request |
| 3 | the Ice Pond reads as ice (a glide streak and sheen under a sliding body) | DONE (frostbell.ts, bodies feed); rows ok phone + desktop |
| 4 | look issues (Frostbell tall floor + olive band, Ripple's Shell Chimes, Rainleaf's list) and a postcard picture for each of the seven places | DONE (shot rounds e, f); postcards row ok; the shell's call is a request |
| 5 | the render references to the three dropped places | DONE: none by name; the Keepsake Shelf ignores bits 5 / 6 / 8 |

## 0. Baseline (HEAD 861665740 with the other round-6 lanes' uncommitted edits in the tree)
- `npx tsc --noEmit -p tsconfig.json`: 0 errors.
- `node _harness/renderview/pg_node_checks.ts`: 40 ok, 0 FAIL.
- Render references to the dropped places at the start (grep of src/render, _harness/renderview, browser_render.mjs for fizz / cog / hollow /
  magnet / turntable / echo): none by name; `place.ts` LOADERS hold only hearthlog, ripple, frostbell, rainleaf. The one D-96 leftover is the
  Keepsake Shelf (`homekit.ts`): it draws 20 keepsake slots and would show bits 5 / 6 / 8 (retired by R6_DATA) from an old save.

## 1. Lanternroof and Cloudloft (BUILT; the RD rows wait for the place run)
**Host changes (`place.ts`, the away chunk):** LOADERS + `lanternroof`, `cloudloft`; `PlaceBuilt.bodies` + a bodies feed in `update(..., B, nB)`
(visible bodies' centre, live radius, view id, stride 5, at most 12; filled only for a place that asks: Cloudloft's dents, Frostbell's glide
streaks); `PropKit.local()` (a pattern over the part's local position and normal); `PropKit.surface(..., bump)` (the glsl's height `pBH` tilts the
normal: lit billows / drifts); `surface` declares vec4 arrays and takes the instance matrix into `vWP` (an instanced part's pattern was in local
coordinates); `card` declares Vector3 / Vector4 uniforms. The harness (`renderview/pg.ts` PLACES, `browser_render.mjs` PLACE_IDS) knows the two.
**What the place camera does (measured, it decides the look):** `fitPlace` puts the camera far back with a long lens and only 8.6 degrees down
(desktop 1280x800: y 3.51, z 19.75, lens 15; phone 390x844: y 3.43, z 15.71, lens 35). A desktop frame's TOP is 1.1 degrees UNDER the eye line
and its top HUD row covers down to -3.4: the "sky" a desktop sees is the far distance under the horizon. So skies are drawn by direction on far
cards (Lanternroof's backdrop draws the moon and stars at infinity: they stay put when the player orbits), and anything that must show in every
frame stands between -7 and -3.4 degrees.
Shot rounds (`scratchpad/r6_render/shots.mjs <ids> <tag>`: the harness's `placeShot`, 4 bodies, phone 390x844 + desktop 1280x800; shots in
`scratchpad/r6_render/shots/`):
| round | Lanternroof: what was wrong -> changed | Cloudloft: what was wrong -> changed |
|---|---|---|
| a | the roof ended at the parapet: the frame's lower third looked down a black facade; a magenta sky (the low sky is horizon colour); the moon above every desktop frame; the lanterns dull beige balls | brown-pink "dusty plain" floor; far banks flat plateaus with seams; a 4-degree sun cut by its card's edge; RD-13 tall **0.365** (bar 0.35) |
| b | a terrace on a bigger zinc roof; one backdrop card (city glow, dusk, ink, stars, the moon) and a skyline with lit windows; lanterns lit from inside with halos. Left: the moon a grey smudge (acos near 1 is coarse on SwiftShader), the 0.3 m front wall hid 2 m of floor and the front bodies' feet, the zinc a glossy white sheet | cumulus banks (a union of round bumps), a windowed sun glow; floor still sand-like |
| c | moon by the az / el difference (crisp); the front wall is a 7 cm curb under an open iron rail at 0.3 m; matte zinc; the Star Scope a brass tube on a tripod | the cloud sea billows up outside the bounds (behind and at the sides, never in front); the kite far behind (it climbs the sky by perspective, visible on desktop); read as dunes |
| d | (zinc falls into shadow toward the camera, coral lanterns more coral) | round domes on a jittered grid, near-white tops and blue-lavender hollows; the sun half risen over a far bank; RD-13 tall 0.356 -> darker tops, no column (a streaked column read as a glass tube) |

## 2. The squirt arc (BUILT)
`StageLike.squirtFx?(fromId, toId, drops, dirX?, dirZ?): boolean` (contracts.ts, additive; stage.ts one line into the away chunk's
`PlaceHost.squirt`). Draws `drops` (LIFE's `sub`: 12, or 4 in Calm / reduced motion) along a 0.4 s ballistic arc (SQUIRT.arcS) from the top of
`fromId` to the upper half of `toId`, or 1.2 m ahead along (dirX, dirZ) when toId is 255 / negative / not a body (no direction: sideways toward the
frame's middle). The drops leave over 0.12 s (a little stream), streaked along their flight, lagoon-cream, normal blend, in a pool of their own
(40; the presets' autonomy budget never starves a squirt the player made); 7 splash motes where they land, none in Calm or with reduced motion.
False at Home or for an unknown squirter. Zero allocation per frame. **Request to PG_SHELL (R6_SHELL):** on LIFE_EV.SQUIRT call
`stage.squirtFx(ev.a, ev.b, ev.sub, fx, fz)` (fx, fz: the squirter's facing if the host has it), with the squirt sound.
Harness: `pg.squirt()` + browser row "R6 squirt" (12 + 7 drops, mid-flight between the two bodies and above both, Calm 4 and no splash, at nobody,
refused at Home and for an unknown id).

## 3. The Ice Pond reads as ice (BUILT)
frostbell.ts asks for the bodies feed. A body whose centre is over the pond, resting on it (y under 1.35 R) and moving 0.12..8 m/s leaves a glide
streak every 0.07 m (two fine parallel scratches 0.28 m long behind it, bright lagoon-cream, fading over 2.5 s; 20 kept) and a moving sheen under
it (by its speed share); the pond also takes the sky's sheen at grazing angles. Reduced motion: no streaks, the sheen only. Works in both layouts
from the layout's own patch. Harness: `pg.iceGlide(kind)` + browser rows "R6 Frostbell phone / desktop" (a body moved across at 0.7 m/s:
streaks >= 6 and a sheen; a still body none; all faded 3 s after).
Also Cloudloft's dents use the same feed: `pg.cloudDents()` + row "R6 Cloudloft" (a live dent under a resting body, a fading one left behind
after a 1 m move, gone in 7 s).

## 4. Look issues and postcards (BUILT; shot round e judged, round f pending)
| place | issue (PG_RENDER round 3 list) | change |
|---|---|---|
| Frostbell | tall frame: a plain blue-teal snow floor; wide: an olive band at the horizon | the snow is a height now (drifts 0.5 x big noise, sastrugi wind ridges along x), lit by the low sun through the bump; the far snow takes a pale lavender-cream haze itself from 25 to 40 m (the fog no longer mixes cream into blue: no olive band; a lagoon haze tried first read as a teal lake); a few snow-capped rocks outside the bounds (tall: the front corners; wide: the sides). Snowy props keep the unbumped snow (`snowProp`) |
| Ripple | Shell Chimes stack in depth (data yaw 1.571); tall sky a flat peach block | each shell its own tone (coral, cream, lagoon, amber, dusk-coral), ribbed, turned a little its own way and sized 0.9..1.14: a stack reads as five shells (the yaw itself is PG_DATA's: request stands); fair-weather clouds drawn by direction in the low sky (rows at 0.2..3 degrees: the band a phone sees between the HUD and the sea) |
| Rainleaf | tall near ground a plain umber-to-teal gradient; the finale's five drips not choreographed | clods and furrows as a height (bump), dark teal moss in small patches; the finale: once the rain has stopped, five bright drops fall from the Drip Leaf's tip 0.75 s apart (none with reduced motion) |
| all seven | blank postcards on the Places sheet | `src/render/postcard.ts`: `drawPostcard(canvas, id, {width?, height?, dpr?}): boolean` draws a still procedural picture per place (2D canvas, no WebGL, the eight tokens, seeded): Home's mat under the lamp; the cabin's log wall, window, fire and rug; Ripple's sun, sea and surf; Frostbell's ranges, snow and ice pond; Rainleaf's leaves, rain and puddle; Lanternroof's moon, stars, skyline and lantern line; Cloudloft's sun, cloud sea and Sunbow; each with a little squishy. `POSTCARDS` lists the seven ids. False for any other id (the dropped three included) |
**Request to PG_SHELL (R6_SHELL), the Travel sheet (`src/ui/later-journal.ts`):** replace the blank `<span class="jn-sky">` with a `<canvas class="jn-sky">`
and, after it is in the DOM (so it has a CSS box), `import('../render/postcard.ts').then(({ drawPostcard }) => drawPostcard(cv, p.id))`; keep the
CSS gradient as the fallback when it returns false. The module is about 5 KB and pulls in nothing else.

## 5. The dropped places in the render (DONE)
grep of src/render, _harness/renderview, _harness/browser_render.mjs: no look, loader, harness place or postcard names Fizzwell, Cogwhistle or Echo
Hollow (the four loaders before this round never had them). `homekit.ts` setKeepsakes masks bits 5, 6, 8 (Bubble Ring, Little Brass Cog, Glow
Crystal, retired by R6_DATA 1): an old save holding one loads and shows an empty slot there (no live player can hold them: their finales never
shipped, so no live shelf changes).

## Bytes (PLAYGROUND_BUILD 14.3's one-file method: rolldown, the module alone, imports external, minified ES; `scratchpad/r6_render/size.mjs`; HEAD = 861665740)
| chunk | modules | bytes | budget |
|---|---|---|---|
| away | place.ts 19 505 (HEAD 16 207, +3 298: loaders, bodies feed, squirt, local / bump / array helpers) + placeview.ts 2 047 | **21.6 KB** | 90 |
| Lanternroof (new) | lanternroof.ts 19 967 + audio 784 + data 3 829 | **24.0 KB** | 45 |
| Cloudloft (new) | cloudloft.ts 14 298 + audio 739 + data 3 549 | **18.2 KB** | 45 |
| Ripple | ripple.ts 10 220 (+1 495) + audio 1 000 + data 3 703 | **14.6 KB** | 45 |
| Frostbell | frostbell.ts 12 839 (+2 421) + audio 1 200 + data 4 127 | **17.7 KB** | 45 |
| Rainleaf | rainleaf.ts 9 513 (+610) + audio 804 + data 3 745 | **13.7 KB** | 45 |
| cabin | hearthlog.ts 13 679 (unchanged) | as round 3 | 45 |
| render first load | stage.ts +60 B (the squirtFx member), homekit.ts +0 B (the mask folds into the constant) | 14 549 + 60 = **14.3 KB** | 16 |
| postcards | postcard.ts 6 968 B: wherever the shell imports it (a later-* chunk or its own lazy chunk) | 6.8 KB | (the shell's) |

## Place run 1 (`node _harness/browser_render.mjs --only=place --port=5364`, 47 min, log `scratchpad/r6_render/place_run1.log`; real soft body, med, SwiftShader)
**94 ok, 2 FAIL, 0 console problems.** Rows for the two new places (phone tall / desktop wide):
| row | Lanternroof | Cloudloft |
|---|---|---|
| RD-01 loads and is set | ok / ok | ok / ok |
| RD-08 set + props draw calls (bar 60) | 32 / 32 (8 868 / 9 428 triangles) | 27 / 27 (42 344 triangles: the billowing cloud sea is one 120 x 120 grid) |
| RD-13 play-area luminance (bar 0.35) | 0.081 / 0.104 | 0.320 / 0.278 |
| RD-17 1 m squishy (tall 100 / 80 px; wide 150 px mid) | 102.9 / 83.8 px; 152.1 px | the same (the camera frames the bounds) |
| RD-17 corner model margin | 7.8 / 25.6 px | 7.8 / 25.6 px |
| RD-03 ceremony dim | 0 (a night place: none) | 0.3: in 1.20 s, out 1.20 s |
| RD-03 flash gate (<= 3 in any 1 s) | **FAIL 14** (capsule uncommon), luminance 0.018..0.161 | 3 (capsule rare), 0.232..0.378: AT the gate, like Ripple and Frostbell |
| P13 finale | took; 0.074 -> 0.075, reversal 0.0003 (the lanterns' song is the place's own) | host-eased: 3.00 s, Calm 6.00 s, back 3.00 s; 0.292 -> 0.405, reversal 0.0003 |
Other rows: RD-07 12 swaps over all six places: programs 20 -> 20, textures 4 -> 4, geometries 24 -> 24. R6 Frostbell glide phone: streaks 12,
sheen 1, still 0, faded 0; desktop: streaks 18. R6 Cloudloft dents: live 1, after a move 2, 7 s later 1. R6 postcards: 7 drawn, luminance spread
223..242, same twice, dropped refused. RD-13 of the S2 places after the look changes: Ripple 0.328 tall / 0.255 wide, Frostbell 0.310 / 0.306,
Rainleaf 0.120 / 0.131 (shot round e). The four older places' rows unchanged in kind (all ok).
**FAIL 1, R6 squirt:** a harness bug, not the squirt: the row read `body.center` after the run and got 0 / 0 for both bodies (the drops' middle
-0.04 m, 0.86 m up, 19 drops, Calm 4, at nobody, refusals all as wanted); the scenario now reads the stage's drawn centres before the squirt.
**FAIL 2, RD-03 Lanternroof flash gate: a real bug, found and fixed.** Bisected with `scratchpad/r6_render/flash.mjs` (one reveal at 320 x 240,
per-frame luminance, hiding material groups): the zinc deck (y -0.012) lay UNDER the whole terrace and z-fought the tiles when the ceremony moved
the camera: frames 34..52 of an uncommon reveal alternated 0.088 / 0.018..0.047. The deck now lies only in front of the terrace; the same reveal
is flat (0.080..0.112, one smooth swell).
Shots looked at after run 1 and changed: the Cloudloft finale (a lagoon fill turned the cloud sea grey-green, 0.29 -> 0.41: a rose-violet
fill, key 470 -> 400); Frostbell's far snow (still a faint olive-teal band in `ice_glide_desktop.png`: the far snow is lit by the lagoon fill
alone, and cream under lagoon light IS that olive; the haze is now a periwinkle albedo at 0.75) and the glide streaks drawn wider (0.02 m + 0.8
fwidth: thin lines vanished at the grazing view); postcards (dark between the cabin's logs; lavender, not grey-green, clouds on Cloudloft's).

## Requests to other lanes (round 6)
- **PG_SHELL / R6_SHELL:** (1) LIFE_EV.SQUIRT -> `stage.squirtFx(ev.a, ev.b, ev.sub, facingX, facingZ)` with the squirt sound (section 2).
  (2) The Travel sheet's postcards: a `<canvas class="jn-sky">` and `drawPostcard(cv, p.id)` from `src/render/postcard.ts` (section 4; vite.config.ts
  already lists postcard.ts as lazy-only). (3) Lanternroof's Night Breeze: each frame `stage.thingFx(-1, 3, world.gustLevel(k))` for the breeze zone
  (the lanterns sway and gust streaks drift with physics' gusts; until it is called the look runs its own gust clock with the zone's every-s and
  for-s, as physics does). (4) The Star Scope's tap: `stage.thingFx(5, 1, 1)` draws a slow comet across the sky (6 s; none with reduced motion);
  the Lantern Line's tap `thingFx(0, 1, amount)` lights every lantern for its glowS; the chimney's `thingFx(3, 1, 1)` a deeper breath. (5) The
  finales: `thingFx(-1, 2, 1 | 0)` as for the other places: Lanternroof's lanterns glow one by one in time (the place's own), Cloudloft's sun rises
  and the bow of light fades in (host-eased, 3 s / Calm 6 s). (6) Nothing else is needed for the glide streaks and the dents: the stage feeds
  the bodies to the place itself.
- **PG_DATA / R6_DATA:** (1) Ripple's Shell Chimes still lie along z (yaw 1.571) on the wide layout: the render now makes a stack read as five
  shells, but a yaw near 0.5 would show the row. (2) Cloudloft's tall spawn spots (your item 2) are untouched by the render.
- **PG_PHYS / R6_PHYS:** the Vane Disc is drawn still (no turntable, by order); if one is built, its pose would turn the painted rose (a mover
  slot is free: things[1]).
- **Orchestrator:** (1) RD-03's flash gate: Cloudloft joins Ripple and Frostbell AT the gate (3 transitions in one 1 s window: the bright places;
  the 0.3 ceremony dim keeps them there, no margin). (2) The place camera looks only 8.6 degrees down from 16 to 20 m back with a long lens: on a
  desktop the top HUD row covers everything above 3.4 degrees under the eye line, so a place's sky is mostly unseen there (the looks put their
  moon, sun and kite where every frame shows them); a steeper rest pitch for places would show more ground and less of this, but it is the shipped
  framing (RD-14 / RD-17 rows), so I did not touch it.

## Place run 2 (`--only=place --places=lanternroof,frostbell,cloudloft --port=5364`, log `scratchpad/r6_render/place_run2.log`): **ALL RENDER CHECKS PASSED, 57 ok, 0 console problems**
(The six-place rows that do not depend on `--places`: RD-07 swaps, presets, the R6 rows, ran again.) The two run-1 FAILs are gone:
- RD-03 Lanternroof flash gate: **2** transitions (capsule legendary), luminance 0.080..0.162 (was 14, 0.018..0.161).
- R6 squirt: drops 19 (12 + 7), mid-flight (-0.04, 0.86) between x -0.60 and 0.40, above both; Calm 4; at nobody 19; refused at Home and for an unknown id.
- RD-03 flash: Frostbell 3, Cloudloft 3 (AT the gate, as round 3's bright places). P13 Cloudloft 3.00 / Calm 6.00 / back 3.00 s, 0.292 -> 0.362
  after the rose-violet finale fill (was 0.405), reversal 0.0003; Lanternroof took, 0.074 -> 0.074.
- RD-13: Lanternroof 0.081 / 0.104, Frostbell 0.306 / 0.305, Cloudloft 0.320 / 0.278.

## Shot round f (after run 2: Frostbell's periwinkle fill, wider glide streaks, Ripple's clouds, Rainleaf's moss, bigger squirt drops; `shots.mjs` + `pg.squirt`)
RD-13 by the harness's own measure: Frostbell **0.295** tall / **0.292** wide (no olive left at the far snow or the frame's foot: a lagoon fill on
cream snow was the olive), Ripple 0.328 / 0.255 (small fair-weather clouds in the phone's sky band), Rainleaf 0.115 / 0.127; squirt 19 / Calm 4
(the drops are 4 to 5 cm now: 2 cm ones were specks at 20 m; against the lagoon sea they are still low contrast, on sand they read).
These last edits (Frostbell fill and snow tone, squirt drop size, the postcard colour fixes) were NOT re-run through `browser_render.mjs`;
their rows do not measure colour or drop size (RD-13 above is the harness's own placeShot measure).

## Final numbers (end of round 6, this lane)
| check | HEAD 861665740 | now |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.json` | 0 errors | **0 errors** |
| renderview/pg_node_checks | 40 ok | **40 ok, 0 FAIL** |
| browser_render `--only=place` | (4 places) | run 1: 94 ok / 2 FAIL (both fixed); run 2 (3 places + the six-place rows): **57 ok, 0 FAIL, ALL PASSED** |
| probe_pg_data (reads place.ts / stage.ts pins) | R6_DATA's end: 3 FAIL (known) | **the same 3 FAIL** (Home B5 one-out phone, cabin tall rocker, Cloudloft tall spawn): none from this lane |
Not re-run (no import of a changed module, no text pin on one): probe_app, shellview/node_checks, probe_gestures, probe_trophies, probe_merge,
probe_playground, probe_pg_lifequests, probe_life, probe_chatter, probe_journal, probe_quests. The other published render sections (main, cer, cut,
many, emote, pose, homeview) were not run: this round changed no first-load render module but stage.ts (one optional member delegating to the
away chunk) and homekit.ts (the keepsake mask: no live save can hold bits 5 / 6 / 8).

## Files (this lane)
`src/render/place.ts`, `src/render/stage.ts` (+1 member), `src/render/homekit.ts` (mask), `src/render/postcard.ts` (new), `src/render/places/lanternroof.ts`
(new), `src/render/places/cloudloft.ts` (new), `src/render/places/frostbell.ts`, `src/render/places/ripple.ts`, `src/render/places/rainleaf.ts`;
`src/contracts.ts` (StageLike.squirtFx, additive, optional); `_harness/renderview/pg.ts` (PLACES + the two; scenarios squirt, iceGlide, cloudDents,
postcards); `_harness/browser_render.mjs` (PLACE_IDS + the two, Cloudloft's finale hosted, rows R6 squirt / Cloudloft dents / postcards / Frostbell
glide x2). Scratch tools: `scratchpad/r6_render/shots.mjs`, `flash.mjs`, `size.mjs`.

## Not done / known (honest list)
- The shell does not call anything new yet: `squirtFx`, the postcards, the Night Breeze's gust level, the Star Scope's comet and the finales of
  the two new places are reachable only from the harness until R6_SHELL wires them (requests above). Nothing of the two new places is shipped.
- Lanternroof's Vane Disc is drawn still (no turntable in physics, D-96). Its comet, the lantern glow on a bump and the chimney's breath are not
  seen in a browser shot (no row: the comet needs thingFx, the glow needs a posed chime).
- Cloudloft's billowing sea is one 120 x 120 grid (42 k triangles in one draw); fine on SwiftShader's frame rows, not measured on a phone GPU.
  Its cloud domes show some faceting where domes meet; its finale turns the near clouds a warm mauve (judged acceptable, not loved).
- Cloudloft sits AT RD-03's flash gate (3 transitions in its worst 1 s window), like Ripple and Frostbell; no margin. Lanternroof has 2.
- The squirt drops are low contrast against Ripple's sea (fine on sand). Reduced motion keeps LIFE's 4 drops (R6_DATA's choice) and no splash.
- RENDER items left from earlier rounds and not in this round's scope: PLAYGROUND_BUILD 24.1 (a) (Home's one-out portrait framing for the Felt Ball:
  probe_pg_data's "DT-01 Home B5" FAIL), `stampMark`, `setBodyWater`, RD-02 in each place, the PC's three published-tree render FAILs.
- No git write command was run. Nothing of this lane is left running (`ps` checked; the browser jobs on port 5366 are R6_SHELL's).
