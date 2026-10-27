# greatwick (siege wick, 1.5 m): Art 2.0 build progress

Owner files: art/blender/units/wick_greatwick.py, art/blender/proto/wick_greatwick_*.py,
art/out/units/greatwick_{aubade,serenade}.glb, art/renders/units/*greatwick*.

## Milestones
- 2026-10-20 10:17 start. Read brief §0-§6 (greatwick §3.3), concepts, wick_common, marund (+ v2 fit), burdam
  (paint-pose + bind wrappers). Measured both concepts on a grid:
  - Aubade (front cx 573 / ground ~1372, back cx 1506 / ground ~1370, ~762 px/m from the roof top 1.52 m):
    hood crown 1.20, knob 1.28, lantern panes 1.13-1.40, roof 1.53, spires 1.62, haft ~0.46, hem ~0.10,
    lantern frame only 0.37 m wide (roof 0.47): narrower than the hood (0.53) -> brief wants 0.62.
  - Serenade (front cx ~527 / ground ~1352, back cx 1521 / ground ~1345, ~755 px/m from the lid top 1.56 m):
    hood crown 1.33 (13 cm above Aubade), drum 1.14-1.47 x 0.71-0.75 m, lid 1.56, haft ~0.52, hem 0.15.
  - The shared plate cut: Aubade front sole row 1285 is wrong (boots at 1305-1385); feet cut out of the mask.
  Plan: sculpt each faction in CONCEPT space (pixel-true fit), then per-part warps move parts into the
  shared model layout (Aubade lantern widened, Serenade upper body lowered so the hood crown is ~1.25 and the
  drum narrowed); the paint pass inverts the warps (paint pose, as burdam does) so the projection stays exact.
- 10:38-10:56 plates (proto/wick_greatwick_plates.py, hand-set frames) + fit (proto/wick_greatwick_fit.py):
  fit_greatwick_{aubade,serenade}.png. Both factions sculpted in concept space, warped into the shared layout.
- 11:19-11:36 rig (fit_proportions: arm angles solved onto the sheet's fists), clips idle/run/attack1/death
  (proto/wick_greatwick_pose.py numeric pose check), paint pass (paint pose + own-region erosion + tints + top
  paint), first full builds: aubade 3102 tris 425 KiB accent 5.73 %, serenade 3290 tris 417 KiB accent 5.31 %;
  three.js load test OK both.
- 14:05 (resumed after a usage-limit pause) review of three_greatwick_*.png: Serenade reads well. Aubade hood
  reads too tall/bullet-shaped (top ellipsoid narrower than the sheet's helmet crown: 0.36 m vs 0.43 m at 1.10 m)
  and its knob carries a cone point: with a pale hood over the dark opening that is too close to rule 0.1.
  Plan: broad helmet crown + a round ball knob (no point); accent up to ~6-6.5 % on both; the Serenade oculus
  core reads as a faceted blue gem on the lid (bible: no gems) -> a flush glowing disc.
- 14:20 build1/2: Aubade hood rebuilt as a broad helmet dome (`helmet()`: superellipse lathe, n=3, crown 1.19,
  0.43 m wide at 1.10 like the sheet) + a round ball knob (no point; top 1.257 = 4.5 % of the figure). Accent:
  Aubade light well 0.156 x 0.148, seams 1.35 cm -> 6.28 %; Serenade oculus = a flush glowing pool 2 cm down
  (the proud dome read as a blue gem), wider (r 0.12), hood light x1.12, crown band 1.85 cm -> 6.0 %.
- 14:35 Serenade mantle: hard-edged umber patches through it were the decimated tunic + sleeve caps crossing
  the 3.5 cm shell -> tunic kept 5-7 cm inside above the belt, sleeve caps tucked (top_dz -2.5 cm, r 7.8 cm),
  shell 4.2 cm, smooth edge with the two lapels (the scallop decimated into a torn-paper zigzag), 300 tris,
  flat-painterly sand felt. New proto/wick_greatwick_paintcheck.py (unlit base colour of the built mesh, 5
  views): the hoods' sides took neighbouring paint (Aubade: chalk rim + ash frame; Serenade: the back strap)
  -> both hoods flat-painterly (palette hex, crown light 0.8-1.2, key light, brush noise), crown top patch kept.
- 14:50 Serenade mantle reshaped: `capelet()` (convex profile = rounded shoulders; the straight cone read as a
  lampshade), 8 cm thick, a V collar notch between the two pointed lapels (the hood's chin sits in the V, as on
  the sheet). Aubade: the pale "chin" in the hood opening was the cloak's neck seen through the hollow (and
  the hood light sat inside it) -> the neck is inked, the light is a flat pool on the hollow floor 3.5 cm
  behind the lip. Accent re-balanced: Aubade 6.30 %, Serenade 5.98 %.
- 15:05 pose check (proto/wick_greatwick_pose.py): attack1 impact f12 head at z 1.29 m in front, follow-through
  f20 at 0.22 m in front; death ends propped on the lantern (lantern -1 cm, chest 80 deg); run feet within 2 cm.
  lineup_qa (scratch copy): IoU64 same kind across factions 0.87 (brief >= 0.70), vs the other kinds <= 0.63
  (<= 0.80). Value bands at the game camera: Aubade 78/58/54 (feet too light), Serenade 33/46/24 (the drum
  lantern makes the top dark) -> a per-faction value ramp in the paint pass (`gw_ramp`): Aubade lower bell
  x0.66-0.84 (hammer exempt); Serenade drum bands/posts/lid x1.28-1.32, lid straps walnut.
- 15:15 FINAL builds (both, --clip-sheet): aubade 3102 tris, 405 KiB, accent 6.30 % (top half 79 %);
  serenade 3390 tris, 427 KiB, accent 5.98 % (top half 85 %); three.js load test OK, facing +Z, mesh top
  1.62 / 1.55 m (lantern roof 1.52 / lid 1.545 = content height 1.5 within 5 %; spires / oculus ring above).
  lineup_qa after the ramp: Aubade top/mid/bottom L* 78/58/50 front (the chalk hammer, exempt, sits in the
  bottom quarter), 72/57/32 side and back; Serenade 46-48/32-47/19-28 (top band below 70: the dark ironstone
  drum cage of the sheet is the top quarter; same family trait as brightwick_serenade at 42-60).
  Review sheets: compare_greatwick.jpg (concept | three.js close + game camera), paint_greatwick_*.png (unlit
  paint, 5 views), three_greatwick_*.png, three_clips_greatwick_*.png, fit_greatwick_*.png.

## Fix pass (independent review: 5 major, 6 minor)
- 15:15 fix pass start. Plan: (1) Aubade hood: the opening to the sheet's tall arch (the wide oval read as a
  gaping mouth) + the light as a soft ellipsoid at mid-height, set back; (5) Aubade lantern rebuilt portrait
  (single tall dawnglass panes, thin chalk frame, low roof with little overhang, 0.93-1.53 m, set 0.10 m behind
  the hood); (2) paint: hard-surface props procedural-painterly (no projection smears / ghosts), cloth ghosts
  rejected by a per-part colour model; (3) death: a skinned ground solve per frame (no float, no rebound key);
  (4) run: slower cadence, longer stride, big roll + heave, planted feet solved to the ground; minors: Serenade
  back collar + straps + rounded mantle edge, round opening rim, round oculus, metallicFactor 0, value ramps,
  attack1 wind-up low behind the hip.
- 15:30-16:20 fix pass, first round (both factions rebuilt 4x):
  - (1) Aubade hood: the opening carve is now a TaperEllipsoid (the sheet's arch: narrow brow, wide sill) centred
    BEHIND the cowl front (centred in front of it, the hole came out 0.25 x 0.24 m: probed with a depth scan);
    0.33 x 0.34 m now. The light: ONE ellipsoid 0.13 x 0.09 m at mid-height, 3.5 cm behind the lip (no pool on
    the floor). The chalk rim is a flat sunk band (4 cm wide, 1.2 cm proud) with the sheet's chin point; the ink
    no longer lightens toward the lip (the pale lip ring read as lips). Serenade gets the same carve fix and a
    mid-height light.
  - (5) Aubade lantern rebuilt in model space, PORTRAIT: body 0.41 x 0.30 m, 0.955-1.53 m, one tall dawnglass
    pane per face (role dawnglass: glossy, not emissive) with a tall accent core oval on each, chalk posts that
    run on up into the four corner spires, a 3 cm eave, a square light well; 0.48 m behind the axis (0.06-0.08 m
    behind the hood). Accent 5.4-5.5 % (was 6.30).
  - (2) paint: every hard-surface prop and trim is procedural-painterly (gw_proc: stone with mottle / cracks /
    chips / stone blocks, wood grain on per-texel axes, felt nap, dawnglass gradient + sheen); projected cloth
    keeps the sheet but never samples ghost colours (gw_exclude: CIE Lab tests per part: the Aubade cloak and
    sleeves reject warm b* > 3 and chalk L* > 80, the cloak the black robe gap L* < 20; the Serenade tunic and
    sleeves reject sand L* > 55-58). Hammer top patch (mirrored inkblot) dropped.
  - (8) Serenade: a tilted rolled felt collar that shows at the back (nape reduced), leather straps over the
    shoulders, the mantle's back drape lowered to a soft U (0.66 at the centre) with a rolled edge, the opening rim
    48 stations + its own 180 tris (no octagon). (7) The lid oculus is gone (a glowing disc in a ring of straps
    read as a gem, round or not): the lid is the sheet's closed padded dome with crossed straps and a button; the
    window ring moved out flush with the posts (8 posts) and carries the accent: 5.17 %.
  - (3) death: every frame solved onto the ground against the numpy-skinned game mesh (`_Ground`: the exported
    weights, linear blend) with the hammer and arms excluded from the support (the hammer aim is raised by
    bisection if it would dip); no rebound key; `lie` set where the lantern and the back hem both touch
    (Aubade 67.5, Serenade 74.5 deg). Probe (three.js, 30 fps): lowest vertex 0.000 on every frame.
  - (4) run: 14 frames (0.467 s, 4.3 steps/s; was 0.333 s), 0.75 m step, 26 % contact + flight, heave 5 cm,
    sway +-5-6 cm, roll 6.5 deg (chest gives 3.6 back: the lantern rocks), lantern bob 8.5 cm; planted boots
    solved to z = 0 every frame, swinging ones clear 1.2 cm, the bell never under the ground (the body rides up);
    the cloak's thigh share 0.42 -> 0.22 (it dipped the hem 9 cm). Probe: feet 0.000 when planted.
  - (10) attack1 wind-up: the head low behind the right hip (it was held out sideways at chest height).
  - (9) metallicFactor 0 on every material of the two GLBs (an export.optimize wrapper in the module patches the
    GLB JSON; the lossy ORM's metal channel is then ignored).

## Fix pass 2 (independent review: 2 major, 6 minor) — 2026-10-21
- 00:20 start. Read the review; close-up tool: proto/wick_greatwick_paintcheck.py `--zoom out.png` (studio-lit or
  `--unlit` close-ups: hood, torso, 3/4, hammer, lantern, side, back, top) and `--parts` (one colour per part).
  Findings: the Aubade "slash flaps" were the cloak cutting through straight stole boxes; the "fang" chin hooks were the
  two ends of a tube rim dipping into the chin; the "dark neck block" was the cloak's neck filling the bottom of the
  opening (inked); the hammer's "two blocks" were a stone-joint groove cut right through the head.
- 00:30-00:45 geometry. New SDF helpers: Shell (a skin of a field between two levels: bands that hug a dome exactly),
  PolyDist, AngleSlab, VPrism, WarpedField, back_line (the outermost back surface, model space).
  * Aubade hood: a BIB (the cowl comes down over the chest to the chin), opening narrowed to the sheet's measured arch
    (0.25 wide, 0.79-1.08 m; a 0.33 m one read as a round mouth), the chalk rim a flat 4 cm carved band laid on the cowl
    (Shell) ending in a solid pointed chin tab; cloak cut under the cowl (0.79 m); seams tubes 2.9 cm with a painted
    dark channel (value contrast). Stoles: shells of the smooth bell (hang flat, never cut). Clasp: a 0.10 m chalk ring
    medallion with a domed accent lens. Hammer: ONE chamfered chalk head (12 edges cut at 45 degrees), stepped striking
    ends, broken corners, a lashing band + an X over each face; a straight haft buried in the head. Sleeves: a bell
    forearm and a turned-back cuff ring; mitts: squared fists with a knuckle ridge and a thumb. Lantern widened to
    0.47 x 0.33 m body (0.53 roof), 0.92-1.53 m, 0.50 m back; each pane a lit accent slab 0.29 x 0.31 m in a deep
    dawnglass margin.
  * Serenade: the opening a broad flat-bottomed arch (taper 0.30) framed by a SOFT FELT COWL EDGE (a 2.4 cm shell laid
    on the dome, 3 cm over the brow, 6-8 cm at the sides and chin) instead of the black torus (porthole); the crown band a
    flat 5 cm inlaid band (Shell x AngleSlab) arching over the opening, dark felt edges painted either side; straps end
    at the shoulder crest sunk into the felt (no squares through the lapels); hammer bands flat annuli (no torn edge);
    drum rebuilt in MODEL space: 0.62 x 0.41 m, body 0.965-1.385, lid 1.52, seated 3 cm behind the hood (no sky between),
    flat ironstone rings, 8 posts (20 tris each: 12 decimated into wedges), the window ring an annulus 1.3 cm behind the
    posts; an A-frame of walnut posts that follow the built back (mantle, tunic) down to the belt, a yoke under the drum;
    a small accent lens in the pommel's end (the right side's team light).
- 00:45-01:00 paint. Hybrid cloth (gw_hybrid): the projection only where it is the part's own paint AND seen square on
  (soft own-region weight x graze), a procedural cloth fill elsewhere (the Serenade tunic's side streaks, its hard seam
  and the sleeves' smears came from nearest-filled excluded / hidden texels); the sculpt's own folds painted over both
  (folds().ridge: dark crease lines, lit crests); the Serenade hem rolls and belt painted their own felt / leather from
  the sculpt's tori; the tunic never samples grey (C* < 11: the sheet's ironstone hammer) or near-black paint. Sleeves,
  mitts, mantle, boots: procedural (cuff band + forearm wraps, finger lines, felt). Hard surfaces: edge wear and
  cavities from each part's own SDF (_edges: convex edges lit, creases dark), the Aubade rim a carved groove (the cross
  notches read as teeth round a mouth: dropped), linen stoles with hem lines and a weave, ash with stronger grain.
  Mantle: no sampled top patch (it brought the sheet's dark collar in as soot), the lining darkening only on surfaces
  that face the axis and away from the sky. Value: Aubade feet ramp 0.42 at the hem, the hammer's striking end soiled;
  Serenade hood / lid lifted (#D4BE99 / #DAC4A0), ironstone mid-dark #776B61 (the window light keeps a dark frame
  under either tint).
- 00:50 clips. Run: a 10-frame no-flight waddle (each foot planted half the cycle, heel strike + toe-off roll about the
  anim foot pivots, the body lowest at the weight change); probe at 24 fps: lowest vertex -0.007..0.000 every frame,
  planted foot 0.133 m/frame (3.2 m/s), a toe tip at 0 +- 1 cm. Attack1: the hammer clamped to the ground on the
  follow-through (lowest -0.006, was -0.076). Death: the resting tilt SOLVED (lantern and back hem down together:
  65.3 / 67.1 deg), legs folded inside the robe (end toe tips 0.12-0.19 m, were 0.35-0.49), knees buckle at once
  (sit 0.17, topple 0.30, lantern down 0.40, a rock, still by 0.56).
- 01:41 FINAL (both built with --clip-sheet; three.js load test OK, facing +Z):
  aubade 3482 tris, 434 KiB, accent 8.74 % (top half 80 %); serenade 3594 tris, 430 KiB, accent 7.75 % (top half 68 %)
  (the pipeline's 6 % warning is expected: the reviewer's lineup floor is 5 % per facing).
  lineup_qa (game light, 4 facings): accent aubade 6.51/5.53/9.02/5.90 %, serenade 6.60/4.95/8.01/5.73 %; value bands
  aubade 78.3/61.6/41.9 (the chalk hammer head sits in the bottom quarter at 52 deg), serenade 61.8/48.1/34.7 (the
  drum's ironstone frame is the top quarter; kept mid-dark so the windows read under the marigold tint);
  IoU64 same kind 0.869, vs the other kinds <= 0.65.
  Review images regenerated: three_greatwick_*.png, three_clips_greatwick_*.png, paint_greatwick_*.png,
  fit_greatwick_*.png, compare_greatwick.jpg (concept | three.js front, 3/4 | game camera ally / enemy tint).

## Fix pass 3 (independent review: 5 major, 8 minor) — 2026-10-21 02:09-03:02, cut off by a usage limit
(reconstructed on 2026-10-27 from the module and the session record; the log was not written at the time)
- (1)(2) hood hollows: the ink pass moved AFTER the top paint (the crown patch painted the hollow's up-facing floor pale:
  the 'ghost face' / 'white grin'), every hood texel inside the carve (+ pad) inked, a soft neutral lift round the
  light (glow_r 7.5 cm); one soft light ellipsoid in the arch's frame. Serenade opening rebuilt: a broad flat-bottomed
  arch leaned back 8 degrees (16 pushed the sill out as a lower jaw), no brow over it, a soft dark felt edge (5 cm
  brow and sides, 2.4 cm sill), the collar's front arc dropped under the lapels (it read as a beard); mantle and
  tunic cut out of the hollow.
- (5)(7) Aubade lantern rebuilt: body 0.56 x 0.28 m (0.62 with the eave), 0.92-1.53 m, chalk posts + mullions, one
  lit slab per pane, a light well; an ash shelf on a BACK FRAME of two posts that follow the built back to the waist,
  a shoulder yoke, a waist bar, a bar under the shelf, two braces (no cantilever).
- (3) Serenade drum: ONE carved ironstone part (genus 0): two heavy block bands, eight flat-floored window recesses
  3.5 cm deep, the posts what is left between them; a padded felt lid with six sunk walnut ribs and a button (no
  separate strap tubes); A-frame of walnut posts down the back to the belt.
- (4)(13) tunic: two continuous rolled hem bands + belt as sculpted tori, soft felt folds; mantle 8 cm felt with a
  rolled edge tube round the hem and the lapels; the over-the-shoulder straps dropped; ironstone painted as broad
  planes (no granite speckle); the hammer head a spool (flanged caps), its pommel light dropped.
- (8) one accent seam (brow -> crown -> back), never two meeting at the knob. (10) Aubade hem cut into 14 shallow
  points. (11) run 12 frames (0.40 s, was 0.333).
- The last build of that session (03:00) left the Serenade drum's glow panels ON THE GROUND (see below).

## Fix pass 3, continued — 2026-10-27
- 08:44 resumed. Found: greatwick_serenade.glb failed the three.js load test ("mesh reaches -0.088 m below the
  ground"): the drum's glow panels were centred on z = 0 (the window floor points F live on the drum axis' z = 0
  plane) -> a ring of blue tiles on the ground behind the wick, the windows unlit lampresin. Fixed (+ zc).
- 08:50 drum glow: the 8 thin slabs decimated to 1112 tris (or, capped, collapsed some boxes to 8 faces) -> 1.5 cm
  slabs sunk in the floor, 7 mm proud, and the game mesh built as the exact boxes (`_boxes_low`: 12 tris a box, flat
  shaded; meta low_boxes). Half-lit 'N' windows remained: a decimated web of the drum body bridged some recesses ->
  drum_body 380 -> 520 tris (clean windows).
- 09:00 hollow probe (scratch raycast from the 52-degree camera, per part, with the base colour): Aubade hollow all
  ink + light; Serenade showed the TUNIC's top through the back of the hollow (L 0.34, mid umber) and the mantle's
  lapel tips in its lower corners (L 0.63 sand): the review's 'white grin'. Both now inked in their own sculpt
  space (tunic: up-facing texels only, `nz_min`; mantle: pad 1.4 cm) -> tunic L 0.06, mantle L 0.17 in the hollow.
- 09:05 crown band: sand teeth on its edges (the snout's blend and the felt noise rose through the 1 cm inlay once
  decimated, and the 160-tri band lost edge vertices) -> a 2 cm inlay (-1..+1 cm about the bare dome), a BED sunk
  into the hood under its footprint (Shell x AngleSlab - the rim prism), band 240 tris: clean edges.
- 09:10 (12) death underside: the Serenade bell's flat bottom decimated into a fan of long triangles that shaded as a
  radial 'lampshade' -> a 3.5 cm felt-cushion dome inside the hem roll (bell to 0.10 m); the Aubade's pointed hem
  shows boots in a dark lining (kept). (13) the Serenade hammer's sandstone bands were a separate part whose low
  crossed the head's low (torn-paper zigzag) -> raised rings of the head's own mesh, painted by the spool painter.
- 09:15 (6) accent: the Serenade hammer window is glossy LAMPRESIN now (brief: accent only while <= 6 %); the
  Aubade roof light well 0.12 x 0.10 m and the side slabs widened (side facings 3.3 -> 4.1 % in lineup_qa).
- 09:25 FINAL (both built with --clip-sheet; three.js load test OK, facing +Z):
  aubade 3481 tris, 410 KiB, accent 6.96 % (top half 79.6 %), mesh top 1.616 (roof 1.53, corner spires 1.62);
  serenade 3858 tris, 436 KiB, accent 6.65 % (top half 71.1 %), mesh top 1.544 (lid).
  lineup_qa (4 facings): accent aubade 5.7/4.1/7.5/4.1 %, serenade 6.2/4.5/5.2/4.6 %; value bands aubade
  76.6/59.9/41.4 front (the chalk hammer head in the bottom quarter; 20-31 at the other facings), serenade
  64.2/47.6/27.0 front (top quarter = the dark ironstone drum of the sheet: 53-71 by facing, below the 70 target);
  IoU64 same kind 0.82-0.86, vs the other kinds <= 0.63.
  Pose check (proto/wick_greatwick_pose.py): attack1 impact f12 head 1.29 / 1.36 m high, 0.84 / 0.88 m in front;
  death at rest from f30 (lantern on the ground, chest 72 / 69 deg); run feet planted (min -0.001).
  Review images: three_greatwick_*.png, three_clips_greatwick_*.png, paint_greatwick_*.png, fit_greatwick_*.png,
  compare_greatwick.jpg (concept | three.js front, 3/4 | game camera 1:1 x2 ally / enemy).
  Open: accent sits 0.6-1 point over the brief's 5-6 % (inside the task's 6-12 %); Serenade top-quarter value is
  under 70 by design of the dark drum; run cycle 0.40 s (brightwick 0.467 s) to keep the feet planted.

## Fix pass 4 (independent review: 2 major, 9 minor) — 2026-10-27
- 09:40 start. Majors: (1) Aubade hammer X straps taper into blades past the head + the head reads as a soft pillow
  (lost the carved chalk block); (2) paint far below the concept (flat vinyl + mottle, Aubade bell a soot ramp with no
  hem band, Serenade cloth pinkish greige and hood/lid near-white cream). Minors: hood light a faceted glossy puck,
  Serenade drum on a thin stalk (2/3 body width), Aubade lantern a squat cabinet (mullions), Serenade hood a porthole,
  run too light, attack1 a sideways swat, Serenade 3858 tris > 3.6k + accent over 5-6 %, stale paint sheet / window
  notch / strap streaks, Aubade hood too pale.
- 09:50 (1) EXACT carved geometry: new hull helpers (`hull_tris`, `HullField`, `carved_block`, `prism_block`, `oval_disc`,
  `hull_sp`; meta low_hulls -> `_hulls_low`, flat shaded). Aubade hammer head = a waist block + two stepped WEDGE
  striking blocks (1.6-1.8 cm proud, striking faces 1.4 cm smaller, 2.4 cm chamfers, two broken corners, 2-3 mm
  hand-carved jitter): 172 tris; lashing = a wrap band + flat X straps lying on the front / back faces, ends tucked
  under the striking blocks (inside the outline: no blades) + an octagonal ferrule: 104 tris (was 230 + 160).
- 09:55 (5) Aubade lantern: one tall pane per face (mullions gone), body 0.47 x 0.30 m, panes 0.95-1.42, oval accent
  cores (12-gon front / back, 10-gon sides), frosted dawnglass painted with a pale neutral falloff round each core;
  posts exact 28-tri prisms. (3) hood light: an exact 20-gon lens (3 rings, 116 tris), mid-height, 7 cm deep; GLB
  accent roughnessFactor 0.25 -> 1.0 (export.optimize wrapper): no glint, no faceted outline.
- 10:00 (2) paint: `_fold_shade` paints the sculpt's folds as LIGHT (the fold slope tilts the normal against the
  sheets' key, warm lights / cool (Aubade) or red-umber (Serenade) shades, crease lines, lit crests); the Aubade
  ironstone hem band (#3E434A, 7.5 cm, lit lip) painted after the projection mix; the soot ramp replaced by a gentle
  0.74-1.0; Aubade cloth #627890 (211 / 32 %), cowl a mid blue-grey #899CB3 (L* ~63, was pale linen), no top patch;
  Serenade umber #7A5640 (23 / 48 %), sand felt #B5946A / #B39570, lid #A88A65 (were #D2B994-#DCC8A4 cream), the
  sheet's crown patch dropped; baked AO into the base 0.3 -> 0.5. (10) the strap streaks gone with the bands option.
- 10:05 (4) Serenade drum 0.71 x 0.54 m (R 0.355, sy 0.76; was 0.63 x 0.42), 2.4 cm window recesses under a slimmer
  upper band (the 6 cm step hid the top third of each window at 52 deg), raised 2.5 cm (lid 1.54, mesh top 1.558);
  A-frame posts r 3.1 cm + a brace per side from the post low on the back up to the drum's back rim + front and back
  yokes (the side read is an A, not a stalk). Lid ribs 30 deg either side of the front (a front rib made a notch).
  (6) hood: a BELL arch (0.36 at the sill, round 0.30 top), the felt roll 3.6 cm (was 5); crown band 3.1 cm over the
  opening (3.7 at the sides / back), arching 1.2 cm over the rim; its game mesh an exact ribbon on the cowl's outer
  surface (`band_ribbon`, 180 tris): the decimated inlaid shell showed sand teeth through both edges. (10) hammer
  window an exact 12-gon lens, its lampresin ring painted on the outer face by normal (the position test notched it).
- 10:10 (7) run: heave 5.2 cm, hips roll 10, chest gives back 46 % (5.8 deg lantern rock), sway 6 cm, a landing dip
  and a late chest nod, hammer bounce 3.4 cm; the hidden legs left out of the bell check and the Aubade hem raised
  2.3 cm (its points under the roll capped the heave). Probe: hips bob 4.6 (A) / 4.8 cm (S), was 2.6; chest roll
  +-5.8 deg, was +-3; planted feet -0.001 m. (8) attack1: wind low behind the right hip (0.17), coil (0.21), OVERHEAD
  at 0.31 (head 1.58 / 1.67 m, above and behind the right shoulder, outboard of the lantern: x -0.43), the torso arched
  back, then slammed to the impact (0.40: head 1.21 / 1.27 m high, 0.89 / 0.94 m in front) with the torso pitched
  forward and turned; a hem guard re-solves the hips so the committed hit never cuts the hem into the ground.
- 10:36 FINAL (both --clip-sheet; three.js load test OK, facing +Z):
  aubade 3411 tris, 449 KiB, accent 5.90 % (top half 84.9 %), mesh top 1.62 (corner spires; roof 1.535);
  serenade 3580 tris, 432 KiB, accent 5.97 % (top half 60.2 %), mesh top 1.558 (lid button).
  lineup (game chain, 4 facings): accent A 4.4/4.1/5.3/4.1 %, S 4.9/3.7/7.0/4.0 %; value bands A 77/56/48 front
  (chalk hammer head in the bottom quarter; 30-35 at the other facings), S 56/41/26 (top = the ironstone drum + lid);
  IoU64 A vs S 0.82. Lit three.js samples: Serenade tunic #A3836C hue 25 / 34 % (was 21 / 23 %).
  Pose: attack1 hem min 0.000 every frame; death at rest from f30 (lantern 0.00); run feet planted.
  Sheets: three_greatwick_*.png, three_clips_greatwick_*.png, paint_greatwick_*.png (regenerated from the final
  GLBs), fit_greatwick_*.png, compare_greatwick.jpg, lineup_greatwick.png (game chain: PBR Neutral + vale_grade_01).
  Open: three.js sheets use AgX, which greys the Aubade cloth (10 % sat lit) and pales the Serenade sand; the game
  chain (lineup_greatwick.png) shows the authored warmth. Serenade side facings 3.7-4.0 % (the back 7.0 %).

## Fix pass 5 (independent review: 1 major, 8 minor) — 2026-10-27
- 10:52 start. Major: (1) attack1 wind-up snaps (1.0-1.3 m hammer jumps in one 33 ms key, a frozen 100 ms hold,
  wind-up faster than the slam; the haft cuts the cloak at 0.117). Minors: (2) paint flat (facets on sleeves / tunic /
  mantle, polygonal pane cores, fragmented UVs), (3) Serenade drum cantilevered (centre 0.55 m back: 'lamp on stilts';
  hood + lid two equal domes), (4) Aubade lantern 0.49 m < shoulders (brief 0.62), (5) Aubade cloth in the azure band,
  (6) value bands (Aubade feet light, Serenade top dark), (7) hood light a hard disc (cyclops), Aubade knob on a neck,
  pointed chin tab, sawtooth hem, (8) death pops (hammer slams in 2 frames, hand.L 148 deg key, 2.5 cm hop, hammer
  stays gripped 19 cm up), (9) Serenade umber too saturated (#7A5640 48 %).
- 11:00-11:20 (1) attack1 REWRITTEN on a C1 key spline (`_KeySpline`: non-uniform Catmull-Rom tangents, cubic Hermite
  segments, a tangent break at the impact and at the head's landing) through a key table (grip, haft dir, left fist
  along the haft, elbow poles, torso, hips, feet); the head's roll is parallel-transported along the haft keys and
  spread between anchors (`_roll_ups`: the old keys flipped the striking-face axis ~180 deg between the hit and the
  follow-through = the 170 deg hand.R key). Timing: gather 0-0.05, the HOIST 0.05-0.29 (up the front of the chest and
  over to behind the right shoulder, one arc), the hang 0.29-0.32 (still drifting), the SLAM 0.32-0.40 over the top
  (the left foot steps in with a 3.5 cm lift), the head tips and falls to the ground 0.40-0.56, absorbed, hauled back
  to the carry by 1.0. Left-arm poles chosen per key (the old pole lay along the reach overhead: elbow flips).
  New probe proto/wick_greatwick_motion.py (the current module's clips on the cached rig, numpy-skinned, at the
  30 fps key times: head step / speed, worst local bone rotation step, haft-in-cloak points, lowest points).
  Before: max head step 1.233 m (one key), 171 deg hand.R, 14 haft-in-cloak keys. After (A / S): hoist steps
  0.23-0.35 / 0.24-0.36 m per key (7-10.5 m/s), slam 0.56 + 0.92 / 0.58 + 0.95 m (17-29 m/s: 2.7x the hoist),
  worst bone step 81 / 75 deg (the wrist as the head falls), haft in the cloak 1-3 keys of 1 point.
  The brief's 'from low behind the right hip' start is dropped: in a 0.40 s windup the head would travel ~4 m and the
  wind-up could not be slower than the slam; the gather dips the head at the hip instead.
- 11:20-11:30 (8) death REWRITTEN as a sampler: the body keys (recoil 'out', not 'snap'; the lantern lands AT the
  solved tilt + one 2 deg rock: the lie + 2.5 over-tilt lifted the body 2.5 cm for a frame) solved onto the ground
  first; then the hammer FALLS under gravity (pitch ~ t^2, 0.24 s) in the loosened right fist, its head rolling onto
  its side, lands, and lies there: every later frame its pitch is solved so the head rests ON the ground; the right
  fist goes down to the ground beside the body (world-space targets blended from the carry: no rel->pos switch); the
  left fist lets go by a quaternion blend of the arm bones from the grip solution (the 148 deg hand.L key was the
  to_prop end frame switching off in one key), the fist keeps its grip shape. Probe: max head step 0.13 m, max bone
  step 32 deg, body and hammer lowest 0.000 at rest (was 0.19 m), hips step <= 3.3 cm (the lantern's landing, down).
- 11:20-11:33 geometry + paint (3 builds):
  * (4) Aubade lantern 0.57 x 0.33 m body (hw 0.235 -> 0.285, hd 0.150 -> 0.165), 0.63 m with the eave (brief 0.62,
    wider than the 0.54 m shoulders); lantern_y 0.45 -> 0.465 (the deeper box keeps its front off the hood's back).
  * (3) Serenade drum shallower and seated over the shoulders: sy 0.76 -> 0.62 (0.44 m deep), centre y 0.565 -> 0.50
    (front on the collar's back, back edge 0.84 -> 0.72); a felt PACK (two leather straps, painted by `_pp_pack`) fills
    the back from the shoulder blades to the drum's floor (the braces and the open sky under the drum read as stilts).
  * (7) hood lights: a smooth-shaded round ellipsoid (3 rings + poles, 16 around), WIDE and LOW in the hollow (~2.4x
    wider than tall, ~70-80 % of the opening's width, the family's read as on glimwick) instead of the flat-shaded
    lens at mid-height (pupil). Aubade knob: a squat bun seated on the crown (no neck); the rim's pointed chin tab
    removed (a broad flat foot course); the hem cut into 9 shallow 3.2 cm points (was 14 x 5 cm: torn).
  * (2) lantern cores: domed oval lenses (`dome_oval`, smooth shaded, 16 / 12 around) and the dawnglass painted with a
    deep margin at the frame and a strong frosted near-white bloom round each core (light inside frosted glass); the
    normal map 256 -> 512 (the low facets showed through the sleeves, tunic and mantle shading); Serenade sleeves
    cuff only (the three wraps read as chevrons).
  * (5)(9) palette: Aubade cloth #627890 (32 %) -> palette #6E7A86 (18 %), cowl #899CB3 -> #939FAB (14 %), bindings
    #8B97A3, fold tints neutralised; Serenade umber #7A5640 (23 deg / 48 %) -> #74604F (28 deg / 32 %), fold tints
    neutralised. (6) Aubade feet ramp 0.64 at the hem (was 0.74), hem band 7.5 -> 9 cm, the hammer's lower half
    soiled (x0.74); Serenade hood / mantle / lid lifted toward the palette's sand (#C6AB86 / #C2A47E / #BFA37D), the
    drum's ironstone #4E433B -> #5C4F45. Accent: crown band 3.5 cm, seam 3 cm, the drum's glow panels fill more of
    each window, the Aubade side cores larger.
- 11:33 builds 1-3 checked (three.js load OK both; A 3631 tris 466 KiB accent 6.4 %, S 3612 tris 466 KiB 6.44 %).
  lineup (game chain, 4 facings): accent A 4.8/4.2/6.5/4.5 %, S 5.6/3.5/7.3/3.8 % (sides were A 4.1/4.1, S 3.7/4.0);
  value bands A 78/57/47 front (34/29/35 at the other facings), S 61/46/27 front. -> the stoles' feet darker (a ramp of
  their own), the hammer's lower half x0.68, the drum's ironstone #66584C, the drum windows 3 cm taller (thinner bands).
- 11:37 FINAL (both built with --clip-sheet; three.js load test OK, facing +Z):
  aubade 3631 tris, 463 KiB, accent 6.4 % (top half 73 %), mesh top 1.625 (spires; roof 1.535);
  serenade 3610 tris, 467 KiB, accent 7.12 % (top half 66.5 %), mesh top 1.552 (lid).
  GLB key check (scratch glbprobe: the exported keys at 30 fps): attack1 max head step 0.96 / 0.91 m, only on the
  slam's last key into the impact (f12); wind-up steps <= 0.35 m; worst local bone step 75 / 81 deg (was 172);
  death max head step 0.13 m (was 0.57), worst bone step 30-32 deg (was 148), lowest vertex -0.005 / 0.000,
  the hammer resting on the ground; run unchanged (planted, lowest -0.002).
  lineup (game chain, 4 facings, lineup_greatwick.png): accent A 4.8/4.2/6.5/4.5 %, S 6.2/4.0/8.5/4.2 %;
  value bands A 78/57/46 front (bottom 29-34 at the other facings), S 62/47/27 front (top 52-64 by facing);
  IoU64 A vs S 0.85.
  Open: the Aubade front bottom quarter stays ~46 (the chalk hammer head, the job read, sits there at 52 deg; the
  other facings are in band); the Serenade top quarter stays 52-64 (the ironstone drum bands of the sheet; lifted
  from 46-56); low-poly facets still show on the bells in extreme close-ups (budget 3.6k); the base UVs stay
  fragmented (the shared unwrap, uv_coverage 0.66-0.71). The accent is one uniform emissive (the renderer's
  tint): the 'soft volume' comes from shape (wide, low, smooth-shaded ellipsoid; domed lens cores in a frosted
  bloom painted on the glass), not from a gradient.
