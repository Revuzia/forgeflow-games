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

## Fix round 3 (review: 2 open majors + the in-game notes) — 2026-10-27
Majors: (1) Serenade back-lantern lost the concept (flat accent tiles edge to edge = a blue-tiled birdcage, thin smooth
bands read as grey wood, a pale cream lid with six spokes = a pie, two pale domes stacked on a post at 52 deg); (2) the
hood light read as a tongue in an open mouth on both factions (a uniform hard-edged emissive disc lying on the sill).
In-game notes: Aubade blue-grey cloth weak under the ally azure, Serenade tan / amber weak under the enemy marigold,
the light small from above, surfaces flat / plastic. Shared targets: one soft light centred in a dark hollow, clean
inner lip, Art 2.0 paint, team read from both seats, hoods L* <= 65, gates.
- New scratch QA (scratchpad/wick_greatwick/tools): gw_review.mjs (the shieldwick review harness re-aimed: hood,
  lantern, true1x, metrics with the accent split into opaque cores and see-through glow, a three.js pick), gw_ingame.mjs
  + gw_ingame.py (a real Rift match from seat 0 and seat 5 at the same sim times, per greatwick on screen: accent pixels
  of the viewer's tint vs a 3 px ring round them, CIE Lab dE76 / dL / hue; the hood's L* round its crown),
  hollow_probe.py / uvfind.py (what a ray through the hood opening hits, by part).
- (2) HOOD LIGHT, both: ONE smooth UV-ellipsoid core (exact low_mesh, 96 tris) in the MIDDLE of the hollow, 8 cm back,
  wider than tall (A 10 x 6 cm, S 14 x 8 cm), dark hollow above, below and to both sides. Its soft falloff: a see-through
  LINING of light over the hollow's deep half (rings marched onto the hood's inner wall from 9 cm in + a back cap,
  1.2 cm off the wall, 84 tris), material `glow_halo1` (KEEP prefix glow_: unbaked), renamed `accent` and alpha-BLENDED
  (0.20) in the GLB by glb_metallic_zero, so the renderer tints it per viewer with the core (it tints every material
  named accent; factor-only, the load test passes). Nested shells concentric with the core were tried first (1.42x
  alpha 0.40, 1.80x 0.17): their stepped rings read as an iris round a pupil -> replaced by the lining. The ink spill
  round the light reduced (glow_r 9 -> 4.5 cm: a wide pale lift ringed the walls).
  Inner lip: the chalk rim's (A) and the felt roll's (S) inner walls inked (lit, they read as lips round the hole).
  Serenade hollow: a tan / grey sliver in the back-bottom corner was the mantle collar (and the tunic's top) rising
  through the hood's floor (decimated lows bridging the carve; the head-bound hood dips in the idle breath): both now
  carved 6 cm under the hollow's deep part (SER_ARCH_SINK, behind the opening plane only), the faces that carve leaves
  and the hood's own deep corner inked (SER_ARCH_DEEP), + an ink floor plate 1.2 cm over the hollow floor (8 tris).
  A ~3 px grey fleck remains in the extreme 0.6 m close-up from the wick's left; nothing at eye level / 52 deg.
- (1) SERENADE DRUM rebuilt (the concept's lamp): two HEAVY BLOCK-CUT ironstone courses (8 carved hull blocks each,
  two outer facets, chamfered, hand-cut jitter, broken top corners, 7.5 mm joints, the upper course laid half a block
  round), 8 ironstone posts standing 1.8 cm proud of 8 LAMPRESIN PANES, each pane framing ONE domed accent core (82 x
  72 % of the window) in a deep smoky resin margin with a frosted bloom toward the core (`_pp_resin`), a low padded TAN
  felt lid (#A88C64, was cream) with FOUR crossed dark leather straps (#3F2F25) and a button (was six pale spokes), a
  floor slab under the ring. Painters `_pp_blocks` (per-block tone, dark joint ends, chisel dressing; chamfer light and
  joint cavities from the hulls' own field) and `_pp_resin`.
- LANTERN GLOW: one see-through accent fan round every lamp core (A dawnglass 1.22x, S resin 1.18x; same material as
  the hood lining): the team light spreads into the glass instead of stopping at a hard oval. The Aubade cores are
  domed fans now (68 tris; the 3-ring dome hulls cost 398).
- PAINT: cloth / felt / leather / wood / stone matte (a MAXIMUM node on each role's roughness before the bake: cloth
  0.93; the baked ORM held cloth at 0.74 = a plastic sheen); the hoods painted (`_pp_cowl`: soft folds back from the
  rim, a nape crease, brushwork, a deeper drape) instead of a smooth flat fill; cloak folds and brushwork stronger
  (fold_light A 1.05 / S 1.1, brush 0.075 / 0.065).
- VALUES / TEAM READ: hoods A #939FAB -> #7E8A97, S #C6AB86 -> #A58C69, Serenade mantle #A88B66; dark beds round the
  seam (#38414C, 3.4 cm) and the crown band (#3B2F26, 3.6 cm); Aubade dawnglass deeper and greyer (#7F8D9A, dim frost:
  a near-white bloom out-valued the ally azure), chalk rim / knob / clasp a shade under the chalk; Serenade resin panes
  smoky (#8A6640 / #523822). FACTION_PALETTES (wick_common.py) unchanged.
- Budget trims (Serenade): cloak 500 -> 428, mantle 360 -> 304, hood 320 -> 296, hammer head 220 -> 160, sleeves 128 ->
  112, A-frame 130 -> 112, pack 90 -> 72, rim 120 -> 112, collar 92 -> 84.
- FINAL (both --clip-sheet; three.js load test OK, facing +Z):
  aubade 3429 tris, 461 KiB, pipeline accent 7.31 % (top half 69.4 %); serenade 3600 tris, 479 KiB, 4.92 % (64.6 %).
  The pipeline counts the see-through glow as full accent: split at the game camera (8 facings, gw_review metrics):
  aubade opaque cores 5.46 % + glow 2.12 % (alpha-weighted ~5.9 %), serenade 4.59 % + 0.75 % (~4.75 %).
  Value bands (three.js AgX, 8 facings, median top / mid / bottom): A 75 / 61 / 48, S 65 / 46 / 43.
  In game (Rift, seed 7, t 602-931, zoom 28.5 + 16, seat 0 = west and seat 5 = east, median per greatwick; baseline =
  the round-2 GLBs at the same sim times): Aubade under the ally azure dL +11.2 (was -2.6), dE76 40.1 (43.5), ring
  L* 47 (61); Aubade under the enemy marigold dE 63.9 (66.5), dL +15.9 (+6.7); Serenade under the enemy marigold dE 63.6
  (38.1), dL +37.1 (+14.1), ring L* 27 / C* 15 (57 / 24); Serenade under the ally azure dE 56.5 (58.0). Hood L* p50:
  Aubade 57-60 (59-71), Serenade 40-44 (68); p80 Aubade 67-77 (the chalk rim and knob).
  Pose check (proto/wick_greatwick_pose.py): run planted (min -0.001), attack1 impact f12 head 1.21 / 1.27 m high,
  0.89 / 0.94 m in front, death at rest from f30-40 with the lantern on the ground (min 0.000 / -0.004).
  Renders: three_greatwick_*.png, three_clips_greatwick_*.png, paint_greatwick_*.png, compare_greatwick.jpg
  (concept | three.js front, 3/4 | game camera ally / enemy). Review set (scratchpad/wick_greatwick/review: beauty,
  hood, lantern, true1x, game52_x3; ig_final2: in-game shots from both seats).
  Open: the Aubade ally read stays chroma-led (dHue ~1: azure on the faction's blue-grey; value now +11); the hollow
  lining reads as a dim lit interior at eye level (dark lip band all round, never a ring round the core); the
  Serenade pipeline accent 4.9 % sits just under the brief's 5 % (opaque 4.6 %) with the cores framed by resin.

## Fix round 4 (wicks fix round 3 review, 2026-10-27; all four kinds in one pass)
- SHARED HOOD LIGHT (wick_common: cap_mesh / halo_mesh / inject_halo / install_halo_export): the core is the front of a
  16-round ellipsoid, wider than tall, ~3 cm behind the opening and centred between the sill and the arch top; round it a
  HALO cap 2.0 x the core (a shallow dome through the core's middle: no parallax slide in 3/4 or leaned views), drawn with
  the kept material `glow_halo`. The export hook (before the optimizer) renames it `accent` (BLEND; the renderer and the
  crowd path tint every material of that name per viewer) and writes COLOR_0 with vertex alpha 0.85 over the core's
  outline falling as (1 - s)^1.5 to 0 at the rim (per cap, from its own geometry: PCA of the welded vertices). The accent
  stays factor-only (load test green). Lamp panes can use `glow_halo_lamp` (1.6 x, used on the greatwick Aubade lantern).
- Measured (three.js, the review's rv.mjs close-ups, 3/4 eye level, ally tint), L* every 3 px out from the core's edge:
  before 60 -> 16 (shieldwick) / 60 -> 3 (brightwick) in one step; now e.g. shieldwick Aubade 61 55 49 45 40 36 32 28 25 22
  19 17, above 51 49 44 39 34 30 26 21 17 14 12 10 8; the same soft fall on all eight (scratchpad wick_r4/close,
  hood_sheet_r4.png). Core centre in the opening (eye level, 3/4): shieldwick A 0.47, greatwick A 0.51, brightwick A 0.50,
  glimwick A 0.46 / S 0.52 (was 0.16 on the sill).
- In game (Rift seed 7, t 74 / 84, zoom 28.5, High 1080p and Low 720p, seats 0 and 5; review tools ig.mjs + analyze.py,
  working-tree GLBs served in every wick slot): see the per-kind lines below. Fighters' top quarter in the same frames
  L* 42-66.
- greatwick: the hood light rebuilt on the shared core + halo (A 8.4 x 5 cm, S 9.6 x 5.6 cm), the see-through hood lining
  (hoodglow1) dropped. Accent gate: Aubade lantern face cores 0.72 x linear (about half the area) with the shared soft
  pane glow (glow_halo_lamp, 1.6 x, alpha 0.85 -> 0) instead of the flat 'sticker' oval + ring, the roof light well and its
  disc removed (closed chalk roof); Serenade drum window cores x1.06. Values: the lantern's chalk #D6D3CA -> #9A978F
  (roof #929088, ash frame #958972), the hood #77828E, the knob #A8A49B; Serenade hood #958061 (lit 0.68-0.98), mantle
  #A08562, the drum lid lowered 3.2 cm (to 1.478), a step darker (#7E6A51) and FRAMED by a broad ironstone rim round its
  foot with a small iron knob (no crossed straps, no strap grooves: the hot-cross bun). Tris: S mantle 304 -> 250, tunic
  428 -> 400.
  Gates: A 3459 tris / 453 KiB / accent 5.48 % (top half 68 %), S 3451 / 488 KiB / 5.15 % (65 %) - 149 tris headroom;
  load test OK, clips present.
  In game: Aubade under azure dE76 48.4-49.1, under marigold 74-76; Serenade 62-79; hood top quarter A 60-65 (was 64-73),
  S 57-64 (was 68-69); body p95 A 62-65 (was 71-74), S 60-63 (was 70-71); azure band 2-3 % (A), marigold 3-17 % (S).
  Open: drum band faceting (8 flat blocks per course) and the pane / drum paint are still procedural, not Art 2.0
  projected painting.

## Fix round 6 (review:wick:2, score 6.5: the greatwick major + the minors that touch it) — 2026-10-27
Scope: art/blender/units/wick_greatwick.py only (wick_common.py unchanged: its round-5 core alpha falloff, 2.3 x hood
halo and black-diffuse lamp halo are picked up by the rebuild). Both factions rebuilt one after the other.
- FORMS (major): every Serenade part that broke into shards is an exact game mesh now (meta low_mesh, smooth shaded):
  the mantle an OPEN radial strip round the back from one side of the V notch to the other, each column's top the
  highest row whose ray still finds felt (radial_low's closed grid filled the carved collar's rays 5 cm off the axis:
  lit slabs in the hollow; dropping those faces left ragged holes), 192 tris; the collar a 6-sided tube; the A-frame two
  5-sided struts + two yoke bars; the pack a rounded block + two strap bands; the hammer head a 10-round lathe (flanges
  and the two sandstone bands as clean rings, 280 tris); the drum's two courses ROUND chamfered oval lathes (20 round,
  the 8 flat hull blocks per course faceted the drum into an octagon; the blocks, 7 mm joints, a lit arris and broken
  top corners are painted); the lid a 16-round lathe (rim roll, felt dome, knob): the decimated lid's crease baked into
  a dark caret on every lid.
- PAINT (major): `_finish` / gw_finish, the glimwick's paint means over the procedural and hybrid paint of both
  factions: the concept's own strokes as gains (wick_common.detail_ratio, 0.40-0.65; own-region texels seen square on,
  the hood openings excluded), felt / wool nap (wick_common.nap), lit convex edges and dark seams from each part's own
  SDF (the folds, rolls and band seams, never the game mesh's facets); painted crease + crest on the Serenade felt
  folds (fold light 1.1 -> 1.3); hammer bands with worn lips, chips and scuffs (#B09370, a step under the palette: the
  clean rings read near-white at hip height); the V under the Serenade chin painted as a shadowed dark felt collar
  (#3A2D24), not ink (a black wedge there was the 'spike under the chin').
- Aubade lantern (minor, halo ring): SMOKED dawnglass (#4A535D, no pale bloom) + the shared black-diffuse lamp halo.
  In game (zoom 11, ally tint) a pane row through a core now runs pane 19-20 -> 34 -> 51 -> 62 (core) -> 51 -> 34 ->
  20 (was 48 -> 39 -> 70 -> 39 -> 48: a dark ring round each glow).
- Serenade drum windows (minor): cores 25 % smaller (0.66 x the half window, was 0.87), each in the shared soft lamp
  glow (a flat annulus, glow_halo_lamp, 1.6 x) over a visible SMOKY lampresin pane (#5C4127 by the core, #3E2B1C at the
  frame: the glow only adds light, and keeps a value step under the marigold tint); the hammer window is an accent lens
  framed in dark iron (no amber resin ring on ally-blue wicks).
- Reserved marigold band (minor): gw_reserved clamps the Serenade paint to HSV sat 0.37 in hue 25-50 (0.30 for
  near-black texels; the lampresin panes kept). Authored GLB texels (review glbtex.py): marigold > 40 % 10.4 % of
  used texels, 0.3 % above V 0.35 (was 18.9 / 2.2 %); the rest are near-black (V < 0.25: ink, resin margin).
- Budget: Serenade 3525 tris (3451; the round drum and the lathes paid by a trimmed crown band 180 -> 144, hood rim
  112 -> 104, drum cores / halos 8 round), GLB 440,588 B (was 499,560: the flat-shaded hull blocks' split vertices
  gone); Aubade 3459 tris, 464,800 B.
- Gates (final builds, --clip-sheet): three.js load test OK both, facing +Z, clips idle/run/attack1/death present;
  pipeline accentPct A 5.50 % (top half 67.8 %), S 5.36 % (64 %); mesh top A 1.625, S 1.486.
- In game (review tools ig.mjs + analyze.py, Rift seed 7, t 74/84/99, zoom 28.5, High 1080p and Low 720p, seats 0
  and 5, the glimwick slot served as a greatwick too; working-tree GLBs):
  hood top-quarter L* A 60.0 / 61.6 (ally H/L), 63.3 / 64.7 (enemy); S 56.9 / 58.9 (ally), 61.8 / 63.4 (enemy): all <= 65.
  dE76 accent vs ring: A ally 47.3 / 48.0 (dL 19-21), enemy 74.8 / 77.4; S ally 65.5 / 61.7, enemy 76.5 / 67.4.
  top / mid / bottom L*: A 44-48 / 38-44 / 28-37, S 46-53 / 30-36 / 16-25. Accent area A 5.6-6.9 %, S 5.2-5.6 %.
  Serenade body in the marigold HSV band: ally tint 1.6-5.0 % (0.2-0.6 % above V 0.35); under the enemy tint 15.7-19.8 %
  (8.4-8.5 % above V 0.35) = the marigold team light on the lamp panes and its bloom, not the paint.
- Review sheet: review_greatwick_r6.jpg (rows: three.js close-ups Serenade / Aubade at eye level and 3/4; in-game
  greatwicks at 52 deg x 3 from seat 0 and seat 5). paint_greatwick_*.png regenerated.
  Open: the concept-detail coverage is modest (5-24 % of a part's texels see their own paint square on); the
  Aubade enemy-Low hood top quarter sits at 64.7 (p90 66.2), 0.3 under the cap; compare_greatwick.jpg and
  lineup_greatwick.png are from round 4 (not regenerated).

## Fix round 7 (verify:wick (wave-b-finish), score 6.8: the greatwick major, Serenade) — 2026-10-28
Scope: art/blender/units/wick_greatwick.py (+ proto/wick_greatwick_mantle.py, a no-build geometry check: per-part flat
colours from eye level / 52 deg and r-z slices through the mantle axis). Serenade rebuilt; Aubade untouched (no shared
code path changed; its GLB is the r6 one).
- ROOT CAUSE of the eye-level torn-paper teeth: the mantle was bound by bone heat, which gave its front columns 25-31 %
  forearm + 37-42 % upper arm (and, being the first 'auto' part, the armour conform ran on it); the hammer grip dragged
  the lapels' tops 10-17 cm down out of the hood in idle (measured on the cached rig), so the raw top edge, its lining
  and the ink texels by the hollow showed as pale / dark teeth by the hood and either side of the V.
  Now `bind_mantle` (bind ("gw_mantle",)): the cloak's hips / spine / chest by height, 35 % neck at the tucked top, an
  arm share over the shoulders growing toward the hem (shoulder <= 0.22, upper arm <= 0.38), never at the top edge, no
  forearm; ARMOUR_CONFORM off for Serenade (the hidden legs stay unconformed, as before).
- MANTLE TOP: one smooth curve (0.884 at the lapels rising to the felt's crown 0.946 from 32 to 62 deg, smoothed so no
  column sits above its neighbours; the probe had left a 4.9 cm step between the 34 and 46 deg columns) and TUCKED: a
  turned-in row from the top edge into the hood / collar felt, grid-searched per column (deepest point within 2.5 cm of
  the wanted rise, the segment clear of the hollow by 6 mm: by the opening's sides the hood is a thin wall), 1.6-6.5 cm
  inside. The tuck band is painted as felt going into shadow (#4A3B2F; lit it drew a pale ring at the hood's foot). The
  mantle's ink rules dropped / narrowed (a 1.4 cm pad inked the lapels' tops, which meet the chin just under the
  hollow's floor, in triangle patches).
- V NOTCH: each lapel edge is TURNED felt: a facing column folded 2.6 cm in behind the edge and 6 mm toward the notch,
  the strip oriented as one surface so the smooth normals round each fold; paint `turn`: the facing a shadowed dark
  felt (#5E4A39), a lit roll along the fold, a soft shade line where the turned thickness ends.
- PACK: a flat-faced 3 x 3 x 3 rounded block (`roundbox_flat_low`: inner grid lines on the flat faces' borders; the
  2 x 2 x 2 block's normals tilted 45 deg across whole faces, so the paint light and the normal map's per-triangle
  corrections drew triangles), the two straps paint only (6 mm proud: no game-camera silhouette; the high keeps them for
  the bake), `_pp_pack` lit by the sculpt's own normals (`field_normals`). With the sun shadow off the pack face is one
  smooth gradient (scratch close1ns vs close0ns); with it, the only edge left is the drum's cast shadow.
- Budget: mantle 192 -> 240 tris (back columns 165 / 195 dropped: under the pack), pack 88 -> 108; total 3593 (cap
  3600), GLB 444,052 B. Gates: three load test OK, facing +Z, clips idle/run/attack1/death (+ standard set), accentPct
  5.36 % (top half 64 %), mesh top 1.486.
- Kept: the round drum, the clean hammer bands, no chin spike, the game-camera read (in game, review ig.mjs, Rift seed 7
  t74/84/99 High seats 0/5, the glimwick slot served as greatwick: same read as r6, the mantle edge clean).
- §0 check (both factions, game camera x3 at yaws 0/45/90/180/270/315 + eye level / 52 deg close-ups): one soft core in
  each hollow, no eye pair or mouth in the hood; the Aubade's two pane cores at 45 / 315 deg sit on two faces of the
  lantern box behind the hood (a lantern, not a face); the Serenade V under the chin reads as two felt lapels over the
  tunic, not a mouth.
- Review sheet: review_greatwick_r7.jpg (top HEAD r6, bottom r7: eye-level head x3, neck front / 3-4, pack back 3-4
  with and without the sun shadow, game camera x3). paint_greatwick_serenade.png regenerated.

## Fix round 8 (verify greatwick r1, the r7 mantle-binding regression, Serenade) — 2026-10-28
Scope: art/blender/units/wick_greatwick.py (+ proto/wick_greatwick_mantlepose.py, the posed-mantle clearance check).
Serenade rebuilt; Aubade untouched (its death bow factor is 1.0 and its stunned is the standard one; GLB is r6/r7's).
- ROOT CAUSE (measured): the r7 `bind_mantle` left the strip's turned-in tuck row and top row on the torso (chest + a
  little neck), while the hood is 100 % head. Any head pitch over the chest moved the hood off them: on the cached r7
  rig, attack1 t 0.37 put 258 strip samples outside the felt INSIDE the opening's prism (4.3 cm deep), death t 0.42
  put 576 there (10.9 cm deep, the tuck 10.5 cm OUT of the felt), and the shared `stunned` slump (neck 10 + head 14,
  wobbling to 38 deg over the chest; minions play it under hard CC / knock-ups) 698 (tuck -9.6 cm). The pale tabs.
- BIND (`mantle_weights`, MANTLE_HEAD): the r7 torso / arm weighting, then a HEAD share blended over it per strip
  row: the tuck and top rows 1.0 all round (rigid with the hood and the collar, as fully as the hood: the tuck keeps
  its rest depth, 1.8 cm under the chin, >= 1.6 cm everywhere, on every frame); on the front columns (to 60 deg, faded
  to the torso by 90) the 36 % row 1.0, the 70 % row 0.6, the hem / lip 0.2, so the lapels go with the chin instead of
  being swallowed by it. Each strip vertex is matched to its grid point (serenade_parts' _MANTLE_BIND: side angle, row).
  (Tried and rejected on the clearance check: top rows only (death still 420 samples in the opening, 10 cm); top rows
  + 36 % row 0.6 (death 302).)
- MOTION, Serenade only: the death bows the hood half as far over the chest (neck/head pitch x 0.5: land 8 + 9, rest
  6 + 6 deg; a 34 deg bow drove the low hood's chin 14 cm into its own chest, so head-bound lapels then sank into the
  tunic: 473 samples, 8.4 cm); resting tilt re-solved 67.3 deg. `_stunned_serenade`: the same slump and wobble bent
  at the WAIST (spine 24 + 6, chest 4, neck 1, head 2 + small wobble), so chest, mantle and hood sag as one load.
- CHECK (proto/wick_greatwick_mantlepose.py on the built rig, every frame): opening intrusions / lapel rise near the
  hood / tuck depth / sink into the tunic. idle 0 / 0.0 cm / 1.6 / 0; run 0 / 0.0 / 1.6 / 0; attack1 0 / 1.7 / 1.6 / 0;
  death 0 / 1.8 / 1.6 / 0; stunned 0 / 0.8 / 1.6 / 0: PASS (r7: attack1 258, death 576, stunned 698 in the opening).
  Not wick clips (reported only): cast_ult 82 and recall 64 samples (1.5 cm) in the opening.
- CLOSE-UPS (EEVEE, Rift sky + sun, accent tinted; r7 GLB from dda0586c vs r8): attack1 t 0.18-0.42 neck front / 3/4 /
  side and game camera x3 yaw 0 / 315, death t 0.2-1.0 x3 + x1, stunned 0 / 0.5, idle 0.3, run 0.25, ally + enemy.
  r7's tabs in the opening (attack1 0.33, death 0.6-1.0) are gone: one soft glow in a clean dark opening, the
  lapels below the rim as at rest. In game (review ig_burst, seat 0 High, t74 burst, the glimwick slot served as
  greatwick, same sim state as the verifier's r6 / r7 bursts): entity 64 b07-b10 shows no tab in front of the
  opening's rim any more; the lapels sit below it as in r6 (a lapel edge still shows under the rim's corner in b09).
- Gates: 3593 tris (cap 3600), GLB 444,324 B; three load test + QA OK, facing +Z, 15 clips, accentPct 5.35 % (64 %
  top half), mesh top 1.486; body double-sided, metallicFactor 0.
- Review sheet: review_greatwick_r8.jpg (r7 | r8 pairs: eye-level attack1 neck, game camera x3 attack1 / death ally +
  enemy, in-game burst r6 / r7 / r8, stunned).
- Not done (optional minors): the hem-fold glint from the back and the crown band's paint specks (both pre-r7, not
  visible at game scale); the pane pairs stay a watch item.

## Fix round 9 (verify greatwick r2 + final parity W5a: the Serenade lapel tuck / tips, the ~open_rest exemption) — 2026-10-28
Scope: art/blender/units/wick_greatwick.py (serenade_parts' mantle strip) + proto/wick_greatwick_mantlepose.py. Serenade
rebuilt; Aubade untouched.
- GATE: the posed-mantle check no longer exempts rest intrusions (`~open_rest` removed): the tuck and top rows ride the
  head rigidly, so a rest intrusion shows on every frame. r8's strip FAILS it (12 rest samples in the opening's prism,
  1.25 cm out of the felt, on the turned-in quads between the 34 and 46 degree columns). NEW rest gate on the GAME
  meshes: strip samples behind the opening's plane whose sight line to an eye-level or 52-degree camera (yaws 0/+-35/
  +-70; 52: 0/+-45) leaves through the opening past the cached build's own hood / rim / collar / floor / light lows
  (BVH ray casts). It catches what the SDF test misses (the decimated low's thin side walls): r8's strip 22 samples,
  this round's 0. `--grid-from-code` (+ `--match-grid`, `--grid-npy`, `--grid-colors`) checks / renders a strip change
  on the cached rig without a build.
- TUCK: each column's tuck is chosen with its neighbours (5 passes over the front columns to 75 deg): the turned-in
  quads either side are penalised for samples in the opening and out of the felt (1.0) or within 2.5 cm of it and
  not 1.5 cm in (0.3); the tuck stays >= 1.6 cm in the felt and >= 3 cm from the hollow; beside the hollow (to 62 deg)
  it stays UNDER the hollow's floor (the search reaches 9 cm under the top), the column segment clears the hollow by
  12 mm (was 6). Result: tuck 1.75-6.5 cm in, the 46 / 60 deg tucks under the floor (r8: 46 up at z 0.947 in the thin
  side wall, the quad to 34 crossed the hollow's lower corner = the lit sliver at eye level).
- LAPELS: the tops' inner corners rounded off and dropped under the opening rim (SER_LAPEL_DROP 4.5 cm at the notch
  edge, easing to nothing by 50 deg; the turned facing's top a further 1.2 cm down): tops 0.839 at the notch (r8 0.884,
  1.3 cm above the sill rim's top) - the pale points no longer reach the rim at eye level.
- CHECK (built rig, every frame): REST 0 (felt) / 0 (game mesh); idle, run, attack1, death, stunned: open 0, rise
  <= 1.2 cm (r8 1.8), tuck >= 1.75 cm, sink 0: MANTLEPOSE PASS. Report _harness/_reports/fw_W5a_greatwick_mantlepose.{log,json}.
- Gates: 3593 tris (cap 3600), GLB 441,716 B, three load test + QA OK, facing +Z, 15 clips, accentPct 5.35 % (64 % top
  half), mesh top 1.486.
- Close-ups (EEVEE, Rift sky, ally tint; r8 GLB vs r9): _harness/_shots/fw_W5a_greatwick_neck_{idle_0.3,idle_0.0,
  run_0.25,attack1_0.25,attack1_0.33}_r8_r9.png - the sliver in the opening (side-r, 3/4-r) is gone, the lapel tips sit
  under the rim; game camera x3 (enemy tint) fw_W5a_greatwick_serenade_game3_enemy.png.
- Not done (minor): the attack1 t0.25-0.33 lapel flare at 3/4-r (a lapel standing out as its own tab) is unchanged:
  grading the lapels' 70 % / hem head share down (0.45 / 0.12) lifts attack1's rise to 3.3 cm (gate 2 cm), so
  MANTLE_HEAD stays as r8's.
