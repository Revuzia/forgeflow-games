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
