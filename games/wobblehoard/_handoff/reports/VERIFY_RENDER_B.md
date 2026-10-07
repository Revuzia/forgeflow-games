# VERIFY_RENDER_B: independent render verification, lens B (look, layout, cut visuals)

Status: DONE (all six items). **VERDICT: FAIL, one MAJOR (B-M1: a 4-body play mat hides a squishy behind another, the play body itself in the default case) and 8 minors.**
Everything else of lens B passes or is a minor; tsc clean; 0 console / page errors in every browser run of this lens. What is NOT covered is listed in "Not checked" at the end.

- Verifier: independent (did not write the render code; RENDER_R.md read only after the first pass of items 1 to 5, to find what it did not test).
- Snapshot: `C:\Users\TestRun\AppData\Local\Temp\vrb\games\wobblehoard` (copy of the LIVE tree incl. then-uncommitted WIP in
  `src/render/ceremony.ts` and `src/render/stage.ts` on top of HEAD af1d77f2; that exact tree is now committed as HEAD 58fb66ec).
- snapshotHash: `5171e13798e3e03e` (250 files, identical to live at copy time; live still hashes the same).
- Port: 5371. Scripts: scratchpad `verify\render_b\scripts`. Shots: scratchpad `verify\render_b\shots` (paths below are relative to it).
- Items (VERIFY.md RENDER lens B): 1 Gallery, 2 Capsule placement, 3 Mat, 4 Cut visuals, 5 Ceremony regression, 6 Verdict.
- Machine note: CPU load read 100% the whole time (another verifier runs a heavy job on this PC), so SwiftShader runs are slow; no results depend on timing.

## Continuation (session 2, second verifier-B agent, after the usage-limit cut-off)
- Live tree vs the snapshot, checked: `treehash` of the live folder = `5171e13798e3e03e` (250 files, HEAD 58fb66ec, `git diff HEAD` on src/, _harness/, vite.config.ts is empty);
  the snapshot's `src/` is byte-identical to the live `src/` (`diff -rq` lists only `_harness/renderview/view.ts`, which carries the cut-off verifier's snapshot-only harness edits
  (a `RV.RealBody` getter and four extra film stills). So the snapshot is reused; no new snapshot made. One more snapshot-only harness edit by me: a private `cacheDir` (`.vite-vrb`) in the
  snapshot's `vite.config.ts` (the live and the first snapshot had none), because the other verifier's vite (port 5370) shares `G\node_modules\.vite` through the same junction.
- Already finished and reused (not re-measured): items 1 to 4 below. Item 5 (rarity ceremonies) had its desktop capture and sheets, and a phone capture cut off after merge-epic:
  this continuation re-runs the phone capture, builds the phone sheets, measures the phone halos, the capsule-half "mouth" and the Epic mote look, and writes the findings and verdict.

## Progress log
- [setup] snapshot made (33 s), node_modules replaced by a junction to G\node_modules. Viewer smoke test: real soft body, tier med, 0 console problems.
- [item 1 captured] 50 species x (1280x800, 390x844), real soft body, tier med, genome seed 1, own capture script `scripts/gallery.mjs`,
  479 s, 0 console/page errors on both pages. Sheets: `sheets/gallery_desk_{1,2,3}.png`, `sheets/gallery_phone_{1..4}.png`; frames `gallery/{desk,phone}_<idx>_<id>.png`.

## Item 1: gallery (50 species)  [DONE, first pass]

Method: each species at its own catalog tier (`showTier`), `speciesBaseGenome(id, 1)`, 150 settle frames of the real soft body, 1280x800 and
390x844, tier med. 0 console or page errors on both pages. Looked at all 7 sheets plus single frames. Own numeric aid (`scripts/pairs.mjs`:
48x48 silhouette IoU + Lab colour distance from the frame difference with the body hidden; it includes the tier aura, so it over-states
similarity for Epic and up, use it only as a pointer).

What reads well: every one of the 50 renders with eyes, a clean silhouette and no clipping on either frame; rarity escalation is unmistakable
(Common plain, Uncommon cyan pool, Rare violet halo, Epic red ring and halo, Legendary gold glow + ring, Mythic dome with constellation).
Twelve families are visibly different materials (matte felt for the foam and dough lanes, wet gloss for gel, beaded skin for the bead lane).

Pairs a player could confuse at a glance (silhouette AND colour close; sheet pointers in brackets):
- Legendary: ambrosel / fossilo / glimglop (all warm orange-amber blobs with the same gold core and orange ring; ambrosel vs fossilo measures
  IoU 0.92, colour distance 2.7). This is the worst trio. [`sheets/gallery_desk_3.png`, row 1 and 2]
- Mythic: skeinara / constello / prismelo (same dome, same constellation dots, violet vs blue vs teal; skeinara vs constello colour distance 7.6).
  Constello is rescued by its bead skin and bigger eyes, prismelo by its teal-green iridescence; skeinara vs constello is the close one.
- Common: crimpo / thumbly (identical wide low dough pebble, only yellow vs pink; both matte felt), and thumbly / wisplet (both pale pink flat
  blobs; wisplet has sleepy lids and a smooth skin). puddlo / glugbean (both flat ovals; teal slit eyes vs orange round eyes).
- Epic: taffelin / cindergoo (red-orange blobs with the same red ring). Rare: gloopsy / hushpuff (wide rounded rectangles, teal vs lavender).

Physics lane's weak five, does the render look rescue them?
- boingle: a plain glossy cyan sphere. Reads as "ball", unique round silhouette; the only perfect sphere in the roster, so it is distinct,
  but it is the least characterful species (no feature in the silhouette). Partly rescued (colour and gloss), not by shape.
- crimpo: yellow felt pebble. Only the colour separates it from thumbly. NOT rescued by shape.
- thumbly: pink felt pebble. Same as crimpo; also close to wisplet in hue. NOT rescued by shape.
- wrigglo: teal bean with a sparkle trail and a pale pool. Reads as a bean/tadpole body; close to glugbean's flat bean in shape (colour and
  sparkle differ). Partly rescued.
- pastrel: flat wedge with orange and yellow bands and the Epic ring. Rescued (banding + ring + wedge).
So: pastrel and wrigglo are rescued by the look; boingle is distinct but bland; crimpo and thumbly are not rescued (the shape is shared and the
look separates them by hue only).

## Item 2: capsule placement  [DONE, first pass]

Two independent measurements.

(a) END TO END, the real game (`?dev=1`, the real meter earns a capsule via `__WH__.shell.grant(1)`, the shell's own `reportInsets`
sends the safe insets), `scripts/cap_game.mjs`, 256 s, 0 console/page errors. The shell reports insets top 56, bottom 77 (74 on a 390 wide
portrait, 72 at 320x256). Capsule centre / size from `capsuleScreen()`, body from `bodyScreen()`, box = centre +- (0.75, 1.4) x r/1.35.
| frame | capsule box (x0,y0,x1,y1) | safe band y | in frame | under HUD rect | overlaps body |
|---|---|---|---|---|---|
| 1280x800 | 949,306,1101,588 | 56..723 | yes | none | no (gap 98 px) |
| 1920x1080 | 1378,413,1582,795 | 56..1003 | yes | none | no (gap 133) |
| 390x844 | 293,405,353,517 | 56..770 | yes | none | no |
| 844x390 | 573,150,647,286 | 56..313 | yes | none | no |
| 568x320 | 402,117,460,225 | 56..243 | yes | none | no |
| 320x256 | 247,88,291,168 | 56..184 | yes | none | no |
Turning the phone 390x844 -> 844x390 -> 390x844 (and 568x320 -> 320x568 -> back): after each turn the waiting capsule glides to a clean spot
beside the squishy; landscape results equal the direct landscape run to the pixel (610,218 r66), portrait after the round trip is at 320,444
r62 (first landing 323,461 r54: slightly larger, still clean). The old case "phone capsule in front of the squishy" is FIXED: on 390x844 the
capsule stands to the right of the squishy at 0.80x size, never over it.
Screenshots: `capgame_*.png`, sheets `sheets/capgame_portrait.png`, `sheets/capgame_land.png`.
Minor seen in the real HUD: at 568x320 the capsule's lowest ~12 px (y 203..225) sits under the transient hint pill ("Tap to poke...");
`reportInsets` deliberately ignores that pill. See finding B-m4.

(b) STAGE LEVEL, my own pixel measurement (`scripts/cap_stage.mjs`): the capsule silhouette (capsule rig only, no table shadow) vs the body (jelly +
face, no tier FX) vs the tier FX, as the difference between renders with parts hidden; 6 frame sizes x {stage default insets (bottom 72), the
shell's real insets} x 7 species (dollop, crimpo (widest), twangle (tallest), chunkle (largest), ambrosel (Legendary), skeinara and constello
(Mythic)) = 84 cases, 0 off-screen, 0 under the top inset, every `hitTest` at the capsule centre true, capsule landed in all.
- Ordinary bodies (Common..Epic-size, no dome): overlap with the body 0 px in all 60 cases at every size; capsule at 1.0x on desktop, 0.8x /
  0.66x on a 390 portrait phone; beside the squishy.
- "Without" vs "with" the shell's insets (stage default bottom 72 / top 0 vs the real 56 / 77): the capsule stands within 1 px of the same place in 37 of 42 species x
  frame pairs; the 5 that differ are the small landscape frames (568x320 dollop, crimpo, twangle, chunkle; 844x390 chunkle), by 5 to 21 px, always toward the safe band.
- Under the bottom HUD band by the silhouette: 568x320 twangle 4 px (shell insets) / 10 px (stage default); 320x256 chunkle 5 px (both). Nothing else.
- Overlap with the body pixels on the Mythic bodies in small frames: constello 568x320 23.6% of the capsule's pixels (zCap -0.29: it is placed
  BEHIND the body, and shows through it), 390x844 3.8%, skeinara 568x320 6.1%. All other cases 0 to 1.4%.
- Overlap with the tier FX (dome / halo / ring) of Legendary and Mythic bodies: 15 to 19% of the capsule on desktop, 17 to 52% on phones. For a
  Mythic body the capsule stands against the dome's rim: the dome washes its inner half and it reads as a hollow glass hoop (hard to find).
  Seen at EVERY frame size (`sheets/capstage_hi.png`, `capstage/1280x800_shell_skeinara.png`). See finding B-m1.

## Item 3: the play mat  [first pass; camera-jump numbers below once measured]

Method (`scripts/mat_shared.mjs`): the way `src/shell/mat.ts` + `bodies.ts` build it with the REAL physics (shared space): the play body at the origin,
each extra BUILT at `layout[k] - layout[0]` with `PieceOpts { frac:1, chunk:false, at }`, drawn where it simulates, `collide(others)` once per frame,
420 frames to settle (a snapshot-only harness getter `RV.RealBody` was added to `_harness/renderview/view.ts` of the snapshot to build them; src/
untouched). Three species sets (A commons of mixed size: dollop, twangle, chunkle, wisplet, kneadle; B Epic..Mythic: skeinara, ambrosel, selenuff,
prismelo, glimglop; C mid commons) x n = 2..5 x 1280x800 / 390x844 / 844x390. Overlap = share of the smaller body's own pixels (jelly + face, no tier FX)
that another body covers on screen. 36 captures, `mat_shared/*.png`, sheets `sheets/mat_shared_desk.png`, `sheets/mat_shared_phone.png`.
Framing: the union of the bodies is inside the frame in all 36 cases (min margin 0 px only where a Mythic/Legendary aura, not a body, reaches the
frame edge, e.g. 844x390 set B n=4: the aura touches y=0 and y=389).
Layout from `stage.matLayout(n)` (world x, z): n=2 (0,0),(1.31,0); n=3 one row 1.28 apart; n=4 a 2 x 2 GRID with the columns aligned ((0,0),(1.35,0),(0,1.23),
(1.35,1.23)); n=5 staggered 3 + 2.
| n | 1280x800 worst pair overlap (A / B / C) | 390x844 (A / B / C) | 844x390 (A / B / C) |
|---|---|---|---|
| 2 | 0 / 0.04 / 0 | 0 / 0.30 / 0.17 | 0 / 0.04 / 0 |
| 3 | 0 / 0.04 / 0 | 0.52 / 0.35 / 0.28 | 0 / 0.04 / 0 |
| 4 | 0.91 / 0.90 / 0.56 | 0.89 / 0.64 / 0.27 | 0.88 / 0.94 / 0.54 |
| 5 | 0.54 / 0.74 / 0.29 | 0.43 / 0.41 / 0.43 | 0.58 / 0.93 / 0.31 |
So n = 2 and 3 on a wide frame are clean. n = 4 (which is the MAT LIMIT at quality med, the default tier) puts the back row directly behind the front row:
the back body is 41% to 94% hidden (91% for the play body itself in set A on desktop), and the back bodies' EYES show through the translucent front jelly
(three eyes on one red body in `mat_shared/1280x800_A_n4.png`). n = 5 is staggered and legible but crowded. On a phone even n = 3 already has a front body
covering half of the one behind. See finding B-M1.

Camera jump when `setBody` is called with mat bodies out: FIXED (measured). `scripts/mat_jump.mjs`: shared-space mat (3 to 5 bodies), then the shell's swap
(`stage.setBody(new play body)` = clear + add, then every extra's view straight back), 180 frames of the real physics; ON SCREEN, per frame, how far each body's
centre and its apparent height move. 5 cases x 3 frame sizes (small -> big, big -> small, same size with 5 out, Common -> Mythic dome, wide -> tall):
- first frame after the swap: the extras do not move at all (0 px in all 15 cases); only the replaced play body changes (it is a different body).
- worst single-frame step of any body's centre: 9.8 px at 1280x800 (0.8% of the width, wide -> tall with 4 out), 3.3 px at 390x844, 7.0 px at 844x390; worst
  single-frame change of apparent height 0.9%. The camera then eases (cam scale e.g. 1.577 -> 1.361 over about 3 s). No jump in and back out: the scale moves
  one way.
Residual (NOTE, B-n1): in the scale series from my first (render-offset) run, 8 of 9 swap cases dip by 0.8% to 2.8% before settling (for example 390x844, 5 out:
2.310 -> 2.254 -> 2.329), a slight in-and-out of the zoom, over about 1 s; on screen it is the few px above, so I do not count it as a jump.

## Item 4: cut visuals  [first pass done; calm + 6 pieces + phone looked at]

Method: the REAL soft body through the harness's `realCutProbe` (it replays the shell's own call order: per cut `body.setNeck` + `stage.setCutSeam` for the neck, the swap to
two pieces built with `PieceOpts`, `stage.partPieces`, `Reconnect all` = `setFrac` + `setBridge` per frame + `moveTo`, then a fresh whole through `setBody`), one species per
material family (12 families: dollop, twangle, puddlo, crumbit, chunkle, wisplet, thumbly, boingle, dimpla, wrigglo, capnap, kneadle), 1280x800 and 390x844, normal and Calm,
film stills at mid-neck, end of neck, right after separation (+0 / 120 / 300 / 600 ms / 1 s), bridge (0.06 .. 0.95 s) and whole again; 5 cuts down to 6 pieces for 6 species on
desktop and 4 on a phone. 12 + 6 + 4 + 3 + 3 runs, 0 console or page errors in all of them. Sheets: `sheets/cut_desk_<species>.png`, `sheets/cut_desk_calm_*.png`, `sheets/cut_phone_*.png`,
`sheets/six_desk.png`, `sheets/six_phone.png`, `sheets/strands.png`, `sheets/whole_swap.png`.

What works (art director's view):
- The seam glow is a real GLOW: a soft warm-cream band down the cut plane that grows with the neck, with the pinch geometry reading as a splitting squishy
  (`seamglow/dollop_normal.jpg`: the best frame of the set). It stays on the cut faces for ~0.1 to 0.3 s after separation and fades. Never a flash (numbers below).
- The faceless piece (`chunk`) is bit-exact the same material: for 18 species of all 12 families and all 6 tiers, the pixel difference between a whole body with its face and tier FX off and the
  same body added as a chunk is 0.000 (mean) and 0.0 (max) (`scripts/chunk_match.mjs`); the chunk has no face (`face.group.visible` false in 18 of 18); the tier FX stay with the face piece
  (by design), so a cut Mythic leaves plain-looking chunks.
- Six pieces: every cut limit, every piece in the same colour / skin; the smallest piece is 99 px wide at 1280x800 (chunkle) and 41 px on a 390 phone (chunkle, 60 px typical): small but legible.
- Phone framing: during the whole cut + reconnect the top of the pieces stays at least 104 px below the frame top (all four species, 5 cuts).

What looks wrong or cheap (see findings):
1. The Reconnect bridge as a strong visual exists only when the pieces are far apart: on boingle (firm silicone) it is a long straight CREAM rod with flared ends between two cyan balls,
   a "dumbbell / bone", opaque, not the jelly colour (`sheets/cut_desk_boingle.png` h1..i1). When the pieces overlap (most families) no neck is visible and the chunk just rolls over the
   face piece, partly hiding its face (puddlo i1: the face piece's eyes show through the front piece). (The weak bridge visibility the owner accepted as a shell timing issue.)
2. Parting strands differ by family as specified only for sticky: twangle (sticky) shows three braided golden threads for about a second; wrigglo (slime) shows a short thick curved band that
   reads like a clip or bracket, not a long stretchy thread; dollop / kneadle / thumbly show a hairline for 1 to 2 frames (as specified for gel); puddlo none. See B-m2.
3. Calm is NOT meaningfully softer at the seam: the seam band's added luminance with the glow on vs off is +63.2 (normal) vs +57.0 (Calm) on dollop, +41.8 vs +34.5 on wrigglo,
   +58.5 vs +59.2 on twangle (`scripts/seam_glow.mjs`, real body, neck 0.7, 1280x800, 0..255 scale); mid-neck stills in normal and Calm are pixel-identical in the seam column (stripe
   excess 33.2 vs 33.2 on wrigglo, 105.5 vs 105.5 on dollop). What Calm does soften: the stage's cut glow figure (0.52 -> 0.14) and the strand count (6 -> 3 on a 5-cut run). See B-m3.
4. A one-frame POP when Reconnect all completes (the fresh whole replaces the face piece via `setBody`): mean linear luminance steps by +0.071 (kneadle), -0.061 (skeinara), -0.044 (taffelin),
   -0.034 (nuzzo), +0.033 (glimglop) in ONE frame (Common species <= 0.009), relaxing over ~8 frames, in normal and Calm. The adjacent stills (`sheets/whole_swap.png`) show the tier pool light and the
   Mythic dome/ring size changing at that frame; the body does not move. It is one swing (up or down) plus the relaxation, within the 3 per second limit, but it is a visible tick at the moment the
   toy becomes whole again. See B-m5.
5. Pieces leave the frame: on the 1280x800 six-piece runs the highest point of the pieces is above the frame top by 24 px (dollop, neck), 203 px (chunkle, neck/pieces) and 1101 px (boingle: the
   pieces are thrown several body heights up); on the 2-piece runs chunkle and twangle end with a piece partly out of frame (`framed.inFrame` false). The phone frame never clips. This is mostly the
   physics throwing pieces (firm silicone / popdome), but the camera does not follow. See B-n2.
6. At the instant of separation the two new pieces overlap each other on screen for 1 to 3 frames (wrigglo c_apart_0, dollop c_apart_0), then spring apart.

Glow, never a flash (own measure, `scripts/cut_luma.mjs`, 480x300, mean linear luminance per frame at 30 fps, 5 cuts + Reconnect all, real body):
| species | mode | luma min..max | worst single-frame step | >=0.04 swings per second | screen light |
|---|---|---|---|---|---|
| twangle / wrigglo / dollop / puddlo | normal and Calm | 0.040..0.094 | 0.005 to 0.019 | 0 | 0 |
| kneadle (putty, Uncommon) | normal / Calm | 0.056..0.128 / 0.058..0.150 | 0.045 / 0.073 (both at the end-of-Reconnect swap) | counted 0 by a strict reversal rule; the swap is 1 swing + relaxation | 0 |
No frame of the cut ever raised the screen light (0 in all runs): the cut visuals use no full-screen flash.

## Item 5: rarity ceremonies (capsule + merge), desktop part  [DONE by the cut-off agent's capture, judged by this agent; phone part below when finished]
Method: `scripts/cer_sheets.mjs desk both` (340 s, real soft body, 1280x800, tier med, normal motion, 0 console/page errors: `logs/cer_desk.log` ends `bad []`): per tier and kind, 7 deterministic stills at beat-relative
times (capsule: crack, pre-burst, burst +0.05 s, +0.3 s, drop, reveal, settled; merge: fold, end of charge, burst +0.05, +0.3, +0.8, reveal, settled) plus the mean linear luminance of the whole frame.
Sheets: `sheets/cer_desk_capsule.png`, `sheets/cer_desk_merge.png`; stills `cer/{capsule,merge}_desk_<tier>_<moment>.jpg`.
Whole-frame mean linear luminance (base -> peak), desktop: capsule common 0.063 -> 0.104, uncommon 0.096, rare 0.117, epic 0.127, legendary 0.183, mythic 0.209; merge common 0.165 (the Common burst itself), uncommon 0.123, rare 0.143, epic 0.170, legendary 0.233, mythic 0.286.
Screen-light ramp (governor) peak 0.090 / 0.108 / 0.135 / 0.153 / 0.162 / 0.171 (the stage's own number, cap 0.25).
- Merge T2 tell (end of charge): Common white-cream ball, Uncommon pale cyan, Rare violet, Epic red-orange, Legendary gold with a rising beam, Mythic pink-white inside a glass bubble: six different colours, each its own tier colour, no longer the "everything cream / pink" of the old verdict (old minor 8: FIXED, judged on `sheets/cer_desk_merge.png` column 2). Weak spot: the Epic ball (red-orange) is close to the orange parents' own colour.
- Epic motes: at burst +0.3 s (capsule and merge) a few short, tapered pink streaks stand out from both sides of the body at eye height, 60 to 90 px long, and white glints; none crosses the frame (old minor 6: FIXED; `cer/capsule_desk_epic_d_burst300.jpg`). Art note (NOTE B-n3): on a face they sit exactly where cat whiskers would, so the Epic reveal reads "whiskers" for 0.3 s.
- Capsule halves vs the "mouth": no U-shaped half under the eyes in any tier, any still (old minor 7: FIXED as to the mouth). At burst +0.05 s the two halves are still visible as two small pale hoops (one at the cheek, one under the body: `cer/capsule_desk_epic_c_burst.jpg`, `capsule_desk_legendary_c_burst.jpg`); the engineer says they are gone ~0.14 s later; by +0.3 s they are not on any still. NOTE B-n4: for about 3 frames they read as two little wire rings floating on the face.
- Legendary and Mythic bursts: bright by design (frame mean luma 0.18 to 0.29 against a 0.06 base, and the governor's screen-light peak 0.16 to 0.17), the body is pastel white and the scene stays readable (floor, dome rim and the tier pool visible) on every still of `cer_desk_capsule.png` / `cer_desk_merge.png`; the Mythic dome has a soft rainbow rim and is not white-out. Not blinding by my reading of the stills (flash safety proper is lens A's).
- Escalation Common to Mythic reads in every column of both sheets (pool, halo, ring, pillar, dome), each rung visibly bigger than the one before.

### Item 5, phone part (390x844, tier med)  [DONE]
Re-captured in full by this agent (`scripts/cer_sheets.mjs phone both`, 179 s, `logs/cer_phone2.log` ends `bad []` and `EXIT 0`; the cut-off agent's phone run had died after merge-epic). Sheets: `sheets/cer_phone_capsule_{1,2}.png`,
`sheets/cer_phone_merge_{1,2}.png`; stills `cer/{capsule,merge}_phone_<tier>_<moment>.jpg`. Whole-frame mean luma (base 0.053 capsule / 0.069 merge) peak: capsule 0.104 / 0.095 / 0.110 / 0.127 / 0.174 / 0.197;
merge 0.112 / 0.090 / 0.107 / 0.129 / 0.168 / 0.204 (Common..Mythic); governor screen-light peak 0.090 / 0.108 / 0.135 / 0.153 / 0.162 / 0.171 (capsule) and the same list ending 0.176 for the Mythic merge.
- Everything on the desktop list holds on the phone: six clearly different T2 tells, the escalation Common to Mythic, no U-shaped half under the eyes, Legendary / Mythic bursts bright and readable, nothing blinding.
- Halos at rest (own measure `scripts/halo_edge.mjs`, `logs/halo_edge.log`: frame with the tier FX group on vs off, mean |RGB diff| over the 4 px side columns, rows 20..80%): for the harness's habitual species
  (dollop-sized: spirelo, taffelin, ambrosel, constello, hushpuff, pastrel, somnuff) 0.00 to 0.60 /255 at 390x844, 360x640, 320x568 (the FX reach x = 7..8 px from the sides on Legendary at 320..360 wide), 0.00 at 844x390 and 1280x800 for all 12 species.
  EXCEPTION: **Mythic skeinara** at 390x844 / 360x640 / 320x568: edge diff 10.26 / 14.33 / 15.55 /255, 13% / 18% / 19% of the edge pixels change by > 6/255, the FX span x = 0..389 of 390: the Mythic dome fills the whole frame width and its rim is cut by both sides
  (`halo/390x844_mythic_std_skeinara.jpg`, `halo/320x568_mythic_std_skeinara.jpg`). See B-m6 (all-species count below).
- Halos at rest, ALL rare..mythic species (own measure `scripts/halo_all.mjs`, `logs/halo_all.log`, 25 species x 3 portrait sizes, 241 s, 0 console problems): the Mythic dome fills the whole frame width and is cut by both sides for
  **2 of the 3 Mythic species at every portrait phone size**: skeinara edge diff 10.26 / 14.33 / 15.55 and prismelo 17.89 / 23.57 / 24.41 /255 at 390x844 / 360x640 / 320x568 (FX span x = 0..W-1; 13% to 25% of the edge pixels changed by more than 6/255); constello 0.00.
  All 8 Legendary and all Rare / Epic species stay 7 to 9 px or more clear of the sides (edge diff <= 0.60). 844x390 and 1280x800: 0.00 for the 12 species of `halo_edge.mjs`. (`halo_all/390x844_mythic_prismelo.jpg`, `halo_all/360x640_mythic_prismelo.jpg` are the evidence stills.)
  The engineer's "edge columns mythic 0.00 /255" holds for the harness's own species (the dollop-sized test body) only. => B-m6.
- Epic motes while the old play body slides off at the start of a capsule reveal (old minor 6, `scripts/cer_slide.mjs desk`, `sheets/slide_desk.png`): a few short pink streaks (about 30 px at 340 px tile width, i.e. ~100 px at 1280) trail the sliding body at the capsule's height at t=0.25 s;
  none crosses the frame; Legendary / Mythic show only a few specks. FIXED.
- NEW (found while doing the slide check): the WAITING capsule beside a Rare-or-better play body renders as an empty glass hoop at quality med and high (`scripts/cap_hollow.mjs`, `sheets/cap_hollow.png`; low is fine). See B-m7.

## Item 1 extra (this continuation): the phone's real quality tier  [DONE]
The real game starts on `auto` (med) and drops to `low` on a slow device; the cut-off verifier's real-game runs on the phone frames reported `low`, and the engineer judged its phone gallery at low. My gallery (item 1) is at med, so I measured what `low` does
to the same pose (`scripts/lowmed.mjs`, 50 species, 390x844, the same frozen pose rendered at med and at low, tier FX hidden; body-only mean colour in Lab; 189 s; `logs/lowmed.log`, `bad []`):
**median colour shift dE 10.2, p90 21.0, max 26.7; 12 of the 50 species shift by more than dE 14.** Top: crumbit 26.7 (cream-beige at med, golden ochre at low), dimpla 23.6 (pale khaki -> saturated olive), thumbly 23.0 (pastel pink -> coral), plumpet 22.3
(crimson -> violet-magenta), slumbrel 21.0, hushpuff 20.4, boingle 16.8 (pale aqua -> green), burrbin 16.6. Sheet: `sheets/lowmed_top8.png`, stills `lowmed/<idx>_<id>_{med,low}.jpg`. The engineer's harness gate covers three genomes only (8 / 10 / 16 of 255); this is the all-50 number. => B-m8.

## Findings (ids used in the text above)
MAJOR
- **B-M1  A 4-body play mat hides a squishy behind another; the play body itself is the one hidden.** `stage.matLayout(4)` is a 2 x 2 grid with aligned columns (`src/render/stage.ts` lines 623 to 624: landscape `[-0.66,-0.7, 0.66,-0.7, -0.66,0.5, 0.66,0.5]`, portrait `[-0.55,-1.15, 0.55,-1.15, -0.55,0.8, 0.55,0.8]`), and the play body (index 0) is the back-left slot; the shell places mat bodies from exactly this
  (`src/shell/mat.ts` `offsets()`), and 4 is the mat limit at quality med, the default (`MAT_LIMIT`: low 3, med 4, high 5). Measured with the real physics, built in shared space as the shell does (`scripts/mat_shared.mjs`, 3 species sets x n = 2..5 x 1280x800 / 390x844 / 844x390,
  36 captures, `logs/mat_shared.log`; overlap = share of the smaller body's own pixels covered by another body): n = 4 worst pair 0.91 / 0.90 / 0.56 (1280x800 sets A / B / C), 0.89 / 0.64 / 0.27 (390x844), 0.88 / 0.94 / 0.54 (844x390); the covered body's eyes show through the front jelly
  (three eyes on one red body: `mat_shared/1280x800_A_n4.png`, sheet `sheets/mat_shared_desk.png`). n = 2 and 3 on a wide frame are clean (0 to 0.04), n = 5 is staggered and legible (0.29 to 0.74 on desktop: crowded, not hidden). On a phone even n = 3 has a front body covering 28 to 52% of the one behind.
  Why MAJOR: RENDER.md item 4 and FUN.md ask for 2 to 5 bodies on the mat; "framed" is met (every union box inside the frame) but one of four toys is up to 94% invisible, in the default configuration, and the engineer's own harness mat section tests n = 2 / 3 / 5 only, so n = 4 was never looked at.
  Fix direction (not mine to edit): stagger the n = 4 rows like n = 5 does (offset the back row by half a spacing) and keep the play body in the front row.
  Repro: from the snapshot, `node <scripts>\mat_shared.mjs A,B,C` (needs the snapshot-only `RV.RealBody` getter in `_harness/renderview/view.ts`), then read the `maxPairOverlap` column of the `n 4` rows in `logs/mat_shared.log`.
MINOR
- **B-m1  Mythic / Legendary tier FX against the waiting capsule.** At the stage level, 84 cases (`scripts/cap_stage.mjs`): the capsule never overlaps the body pixels (0 px in 60 of 60 ordinary cases) and is never off screen, but for Legendary and Mythic bodies 15 to 19% of the capsule's pixels (desktop) and 17 to 52% (phones) lie in the dome / halo / ring; beside a Mythic dome it reads as a hollow glass hoop. Constello at 568x320: the capsule is placed BEHIND the body (zCap -0.29), 23.6% of its pixels under body pixels. Repro: `node cap_stage.mjs dollop,crimpo,twangle,chunkle,ambrosel,skeinara,constello`, `sheets/capstage_hi.png`.
- **B-m2  Parting strands do not differ by family as specified for slime.** twangle (sticky): three braided golden threads for about a second (good); wrigglo (slime): a short thick curved band that reads like a clip or bracket, not a long stretchy thread; dollop / kneadle / thumbly (gel, putty, mochi): a hairline for 1 to 2 frames (as specified); puddlo: none. Repro: `node strand_sheet.mjs`, `sheets/strands.png`.
- **B-m3  Calm is not visibly softer at the cut seam.** Seam band added luminance, glow on vs off, 0..255: dollop +63.2 normal / +57.0 Calm, wrigglo +41.8 / +34.5, twangle +58.5 / +59.2; mid-neck stills in normal and Calm are pixel-identical in the seam column (`scripts/seam_glow.mjs`). The code does halve the seam strength in calm (`stage.ts` line 755 `govK`, `bodyview.ts` line 199), but the shader saturates (`material.ts` line 260: `min(jSeam,1.3) * 2.4`), so half of full still reads as full. What Calm does soften: the strand count (6 -> 3) and the glow figure (0.52 -> 0.14).
- **B-m4  The shell's transient hint pill covers the capsule's foot** at 568x320 (the lowest ~12 px of the capsule, y 203..225, sit under "Tap to poke..."); `reportInsets` ignores the pill by design; the engineer reports ~15 px at 844x390 too. Shell element, listed because it touches the capsule rule. Repro: `scripts/cap_game.mjs`, `capgame_568x320.png`.
- **B-m5  A one-frame luminance tick when Reconnect all completes** (the fresh whole replaces the face piece through `setBody`): mean linear luma steps by +0.071 (kneadle), -0.061 (skeinara), -0.044 (taffelin), -0.034 (nuzzo), +0.033 (glimglop) in ONE frame, relaxing over ~8 frames, normal and Calm; Common species <= 0.009. The tier pool light and the Mythic dome / ring size change at that frame; the body does not move. One swing plus relaxation, inside the 3-per-second limit, but a visible tick at the moment the toy becomes whole. Repro: `node luma_dump.mjs`, `sheets/whole_swap.png`.
- **B-m6  The Mythic dome is cut by both sides of a portrait phone for 2 of the 3 Mythic species** (skeinara, prismelo): edge diff 10.26 / 14.33 / 15.55 and 17.89 / 23.57 / 24.41 /255 at 390x844 / 360x640 / 320x568, FX span x = 0..W-1. The engineer's "mythic 0.00" holds for its own test body only. Repro: `node halo_all.mjs` (25 species x 3 sizes, 241 s), `halo_all/390x844_mythic_prismelo.jpg`. The charter's "phone halos clear of the edges" is therefore met for Rare, Epic, Legendary (>= 7 px clear) and constello, not for the other two Mythics.
- **B-m7  The WAITING capsule looks like an empty glass hoop beside a Rare-or-better play body at quality med and high** (frosted fill missing; low is fine; Common / Uncommon are fine). Stage level, real stage, 1280x800 (`scripts/cap_hollow.mjs`, `sheets/cap_hollow.png`): med rare slightly glassy, epic / legendary / mythic hollow; same at high; at low an opaque milky pill. Bisect (`scripts/cap_bisect.mjs`, Epic seed 16, med): capsule box mean luma 61.7 baseline -> **100.1 with the play body's `view.rarity.group` hidden** (hiding fx, pool, shadow, strands changes nothing: 61.7 / 62.5 / 61.7 / 61.7); with the body hidden 110.3. So the tier FX group changes what the transmissive capsule shows. Seen at the stage level in the viewer harness; the real shell goes through the same stage module but I did not repeat it there. It also shows in the first 0.25 s of every capsule reveal with an Epic+ body (`sheets/slide_desk.png`, `sheets/grab_hollow.png`). The capsule still hits (hitTest true) and opens; the reward object just loses its look exactly for the players who hold Epic or better.
- **B-m8  Colour identity changes between the med and the low quality tier** (see "Item 1 extra": median dE 10.2, max 26.7, 12 of 50 species above 14). The engineer lists it as a known, unfixed weakness; the all-50 numbers are mine.
NOTE
- B-n1: after `setBody` with mat bodies out, 8 of 9 swap cases dip the camera scale by 0.8% to 2.8% before settling (for example 390x844, 5 out: 2.310 -> 2.254 -> 2.329); on screen it is a few px; I do not count it as a jump (O2 camera jump: FIXED, worst single-frame centre step 9.8 px at 1280x800, 3.3 px at 390x844, 7.0 px at 844x390; the extras move 0 px on the first frame after the swap; `logs/mat_jump.log`).
- B-n2: on 1280x800 six-piece runs the pieces rise above the frame top (24 px dollop, 203 px chunkle, 1101 px boingle) and two-piece chunkle / twangle runs end with a piece partly out of frame. This is the physics neck swell the owner said is known (putty / slow-rise / firm-silicone families); the render stopgap in `stage.ts` `framingFor` does not follow a thrown piece. The phone frame never clips (top of the pieces >= 104 px below the frame top).
- B-n3: the Epic reveal's short pink streaks sit at eye height on both sides of the face and read as cat whiskers for ~0.3 s.
- B-n4: at burst +0.05 s of Epic / Legendary / Mythic reveals the two capsule halves are still two small pale hoops on the face (one at the cheek, one under the chin); gone by +0.3 s. No U-shaped half under the eyes in any tier.
- B-n5: in a merge the Epic T2 ball is red-orange, close to the orange parents' own colour; the other five tells are unmistakable.
- B-n6: six-piece framing on desktop leaves the pieces small in a wide frame (chunkle: 99 px wide at 1280x800; 41 px on a 390 phone, 60 typical): legible, not generous.
- Confusable pairs and weak silhouettes (item 1): see the item 1 section; the render look rescues pastrel and wrigglo, partly boingle, NOT crimpo / thumbly.
- Known and NOT render faults, seen again, not reported as findings: the cut neck morph's swell on putty / slow-rise / firm-silicone (physics); the weak Reconnect bridge visibility (shell timing: the pieces already overlap at the shell's SETTLE_GAP).

## Old VERDICT items for lens B (verify_render/VERDICT.md minors 6, 7, 8 and the phone halos), re-judged
| old item | now | evidence |
|---|---|---|
| minor 6: Epic motes stretch to laser lines when the play body slides off | FIXED | `sheets/slide_desk.png`: a few short streaks, none across the frame |
| minor 7: capsule halves read as wire hoops / a U "mouth" | FIXED for the mouth; hoops visible ~3 frames (B-n4) | `cer/capsule_desk_epic_c_burst.jpg`; no U in any of the 12 capsule sheet rows |
| minor 8: merge T2 tell does not read for Uncommon / Rare / Epic | FIXED (Epic weakest, B-n5) | `sheets/cer_desk_merge.png`, `sheets/cer_phone_merge_{1,2}.png` column 2 |
| known: phone halos touch the frame sides | PARTLY FIXED: Rare / Epic / Legendary clear; 2 of 3 Mythic still cut (B-m6) | `logs/halo_all.log` |
| known: Legendary / Mythic bursts bright | UNCHANGED by design; readable, not blinding on the stills; luma peaks capsule 0.183 / 0.209, merge 0.233 / 0.286 desktop; 0.174 / 0.197 and 0.168 / 0.204 phone | `logs/cer_desk.log`, `logs/cer_phone2.log` |

## What the engineer's report did not test (read after my first pass) and what I did about it
- Mat n = 4: not tested by the engineer (harness: 2 / 3 / 5). Tested here: B-M1.
- Phone colour consistency: engineer: "NOT fixed (measured below if time allows)", never measured beyond 3 genomes. Measured here: B-m8.
- Phone halos: the engineer's check uses the dollop-sized body; here all 25 rare+ species: B-m6.
- Capsule beside an Epic+ body: the engineer's capsule sheets use a Common play body; here: B-m7.
- The engineer judged its phone sheets at `low`; mine are at `med`. Both look right on the ceremony sheets; the colour difference between them is B-m8.

## Numbers (commands in the sections above)
tsc: `node node_modules\typescript\bin\tsc --noEmit -p tsconfig.json` in the snapshot: no output, exit 0. Console / page errors: 0 in every run (gallery 2 pages, cap_game, cap_stage, mat, mat_shared, mat_jump, the 12 + 6 + 4 + 3 + 3 cut runs, cer_desk, cer_phone2, halo_edge, halo_all, cer_slide, cap_hollow, cap_bisect, lowmed).
Browser time this continuation: cer_phone2 179 s, halo_edge ~4 min, halo_all 242 s, cer_slide ~1 min, cap_hollow and cap_bisect ~1.5 min each, lowmed 189 s; one heavy job at a time, port 5371.

## Not checked
- The full `_harness/browser_render.mjs` and flash safety of the ceremonies and chains (lens A's job; I only read luminance and the governor's screen-light peaks).
- The real shell for B-m7 (capsule hollow) and B-m6 (dome clipped): measured at the stage level in the viewer harness (same stage module), not re-run in the real game with a Rare+ / Mythic play body.
- The gallery at `low` on desktop and the ceremonies at `low` (the engineer's phone sheets are `low`; mine are `med`); the cut visuals at `low`.
- `high` quality for the mat, the cut visuals and the gallery (only B-m7's capsule was seen at high).
- Cut visuals for the 38 species not among the 12 family representatives; six pieces for 6 species on desktop and 4 on phone only.
- Real GPUs: everything ran on SwiftShader software WebGL2, so frame timing and the transmission look on a real GPU may differ.

## Cleanup
The snapshot's `node_modules` junction was removed with `cmd /c rmdir` (G's `node_modules` intact: `typescript/bin/tsc` and `vite/bin/vite.js` still present). Every vite (port 5371) and browser this continuation started had exited before then (checked with Get-CimInstance; the chrome-headless-shell and vite --port 5370 still on the machine belong to the render-A verifier's `vra` snapshot, not to me). The snapshot folder `C:\Users\TestRun\AppData\Local\Temp\vrb` (without node_modules) and my scratch stay for the orchestrator to inspect. Nothing in the repo was touched except this file.
