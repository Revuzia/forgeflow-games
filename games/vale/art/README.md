# VALE — art pipeline (lane ART)

Blender 5.2 (5.1 compatible), headless and deterministic. Every fighter, skin, unit, landmark, map
scene and sky is produced by a script in `art/blender/`, built by `art/build.py`, checked against
CONTRACT §12 by `art/build.py check`, and exported as GLB/HDR/PNG into `art/out/` (tracked; the
content build maps `art/out/...` to `assets/...`). **The style bible is law**
(`_design/STYLE_BIBLE.md` "Fighters" and "Look rules", `_design/tokens.json` `fighter`,
`_design/WORLD.md` §2); this README says how the pipeline enforces it.

```
python3 art/build.py fighter <id>       # one fighter + its skins     (args pass through: --fast, --no-render,
python3 art/build.py fighters           # every fighters/*.py          --no-bake, --no-skins, --skin <id>,
python3 art/build.py proof              # the pre-bible technical proof --no-optimize, --clip-sheet)
python3 art/build.py fighter _lookdev_reference   # the BIBLE REFERENCE fighter (art/out/_lookdev/)
python3 art/build.py fighter _template --fast     # the production template demo (art/out/_template/)
python3 art/build.py unit <id> | units
python3 art/build.py map <id>  | maps
python3 art/build.py sky <id>  | skies  # presets in art/blender/sky_presets.json
python3 art/build.py portraits [<id>]   # re-render portrait/splash/icon/turntable from art/.cache
python3 art/build.py check              # validate every GLB + art.json in art/out, write art/out/manifest.json
python3 art/build.py all                # fighters, units, maps, skies, check
python3 art/tools/lineup_qa.py -- a.glb b.glb ... [--name roster]    # readability QA (see below)
node art/tools/three_load_test.mjs <glb> [--budget-kb 1172] [--skin-only]
```

**Running Blender.** With `$BLENDER` set (Windows: `set BLENDER=C:\Program Files\Blender
Foundation\Blender 5.2\blender.exe`) each script runs as
`"$BLENDER" --background --factory-startup --python-exit-code 1 --python <script> -- <args>`.
Without it, the script runs as `python3 <script> -- <args>` against the `bpy` wheel. Scripts read
their own arguments after `--` either way, and import `bpy` before anything from `mathutils`.
Option names are filtered against the running Blender's operators (`scene.op_kwargs`). Optional
tools: `node` (gltf-transform compression, three.js QA, art.json schema check; `npm install` in
`games/vale` brings gltf-transform and `sharp` for WebP), `ffmpeg` (render denoise + labels) and a
Chromium for the three.js QA renders (`$CHROME` or Playwright's cache). Cycles CPU only: EEVEE is
never used, and the bpy wheel has no OpenImageDenoise, so renders are denoised with ffmpeg `nlmeans`.

## Layout

```
art/build.py                      runner + contract check + manifest
art/blender/common/               the shared library (one module per concern)
  scene.py      reset (metric, 30 fps, Cycles), seeds, collections, paths, timers, args
  rig.py        VALE_BIPED_1 from a proportions dict, x_ chains, sockets, prop frame
  body.py       parametric humanoid base body (lofted anatomy) + boots/fists
  mesh.py       lofts/sweeps, voxel union with junction fillets, conformed plates, cloth panels
                (sculpted folds, rolled hems), carved slabs (blades, tablets), decimation, skin weights
  kit.py        BIBLE KIT: carved masks + beak, glass visors, hoods, scarves, mantles, stone slab
                pauldrons, limb shells, heavy drapes, accent inlays, crests, sundial clasps
  materials.py  bible material vocabulary (honed stone, chalk, ironstone, dawnglass, lampresin,
                carved wood, heavy cloth, waxed leather, ink, accent), baked-in painted shading,
                value gradient; the legacy metal set (proof only)
  bake.py       UV layout, exploded selected-to-active Cycles bakes, AO into base colour, ORM, glTF material
  anim.py       FK/IK skeleton, pose library, easing, strike timing (strike_keys), overlap (drag,
                lerp_pose_w), standard clip generators, secondary motion (+ floor constraint)
  export.py     glTF export, gltf-transform compression (quantize + WebP + int16 rotations), three QA
  render.py     splash / portrait / icon (bible conventions, painted map backdrop) + turntable QA
  sky.py        equirect HDR sky (physical sky + painted procedural cloud deck)
  imageops.py   numpy image ops: Kuwahara paint filter, blur, LUT grade, L*, denoise, labels
  fighter.py    Part / Context / binding helpers;  pipeline.py: the fighter build
art/blender/fighters/<id>.py      one hand-authored script per fighter (+ skins), from _template.py
art/blender/fighters/_lookdev_reference.py   the BIBLE REFERENCE fighter (sets the bar; not roster)
art/blender/fighters/_template.py            the PRODUCTION TEMPLATE (runnable caster demo)
art/blender/fighters/_proof_mannequin.py     the pre-bible technical proof (metal; legacy materials)
art/grade/                        vale_grade_01 LUT library (gradelib.py) + generator
art/tools/optimize.mjs            gltf-transform: dedup, drop rest tracks, resample, prune, --fighter =
                                  KHR_mesh_quantization + EXT_texture_webp (sharp) + int16 rotation tracks
art/tools/three_load_test.mjs     loads a GLB with three r186 GLTFLoader in Node and checks it (+Z
                                  facing, colour spaces, loop seams, run foot slide, WebP validity, budget)
art/tools/three_snapshot.mjs      the REAL three r186 renderer in headless Chromium (decodes the WebP):
                                  gameplay-camera facings, key poses, close-ups; --clips = clip sheet
art/tools/lineup_qa.py            roster readability QA at the game camera (IoU, value bands, accent)
art/tools/inspect_glb.mjs, validate_art_json.mjs
art/out/                          shipped outputs (tracked); ids starting with `_` write to art/out/<sub>/
art/renders/                      QA renders (turntables, clip sheets, lineups, skies, build reports)
art/.cache/                       .blend snapshots + baked texture sources (gitignored)
```

## The bible in the pipeline (fighters)

| Bible rule | How the pipeline does it | Where |
|---|---|---|
| Carved masks or glass visors; no faces, no hair cards | `kit.carved_mask` (planar facets, brow shelf, ink almond eye recesses) + `kit.mask_beak` (keel = facing cue from above); `kit.glass_visor`; `kit.hood` wraps | kit.py |
| Vale materials only; banned: metallic bevels, gems, gold filigree, gears, clock hands, glowing runes, teal-and-gold | `materials.bible_set`: every role is non-metallic; the only emissive is `accent` | materials.py |
| Stylized heroic proportions, head readable at 96 px | 6-6.5 heads (`head` 0.29-0.31 m at 1.9 m), `SHAPE.hand` 1.4-1.6, boots `width` 1.2-1.3, oversized weapon | rig.py / body.py |
| Bevels 2-4 cm as brushstrokes | plates/slabs/shells take `bevel_w` 0.008-0.02 with 2-3 segments on thick (2-4.5 cm) forms; edge chalk paints them | mesh.py, kit.py |
| Shading baked into base colour (hand-painted under PBR light) | cavity darkening (local AO), convex edge chalking (Bevel-node edge mask x AO), top light (+-15 % by normal Z), value gradient, whole-body AO x0.6 multiplied into the base colour (`bake_asset(ao_into_base=0.6)`); tokens.json `bakeIntoBaseColor` | materials.py, bake.py |
| Value gradient: top quarter L* 70-85, middle 45-65, feet 20-35 | palette values per band (light mask/hood/shoulders, mid tunic, dark legs/boots) + `VALUE_GRADIENT_STOPS` Z ramp; measured on screen by `lineup_qa` | fighter file, lineup_qa.py |
| `accent` <= 5 %, top half, below bloom at rest | carved glass inlays/fins (`kit.inlay`, `kit.crest`, `kit.sundial_clasp`) on crown/shoulders/chest; emissive 0.8 at rest; three QA and lineup_qa measure the share | kit.py, materials.accent |
| Role is mass; silhouette IoU <= 0.80 at 64 px | ROLE_MASS in the brief; `lineup_qa` IoU matrix against the roster | lineup_qa.py |
| Rigid drapery, <= 2 sway bones | `kit.drape` panels on one-bone `x_` chains (or one chain of two); `ChainCfg.floor` keeps them above the ground | rig.py, anim.py |
| Splash: subject in grid columns 7-12, UI in 1-6; sun behind-left of camera | `render.fighter_renders` (see Renders) | render.py |

### Material vocabulary (`materials.bible_set(palette, gradient)`)

| Role | Bible material | Palette key | Use |
|---|---|---|---|
| `chalk` | chalk limestone (Aubade) | chalk | masks, top-band stone (the brightest value) |
| `stone` | honed dialstone | stone | pauldrons, blades, tablets |
| `sandstone` | ochre sandstone (Serenade) | sandstone | warm stone pieces |
| `ironstone` | ironstone (speckled) | ironstone | greaves, knees, spines: the dark feet band |
| `dawnglass` | cool glass (glossy, NOT emissive) | dawnglass | visors, edges, halos, lenses |
| `lampresin` | warm amber resin (glossy, NOT emissive) | lampresin | vessels, inlays |
| `wood`, `wood_dark` | carved pale ash / walnut | wood, wood_dark | bracers, grips, clasps, staffs |
| `cloth`, `cloth2`, `under` | heavy linen / felt, light linen, dark under-suit | cloth, cloth2, under | tunic, hood/scarf, legs |
| `leather` | waxed leather | leather | belts, straps, gloves, boots |
| `ink` | carved-recess paint | ink | mask eye recesses, deep grooves |
| `accent` | the readability inlay (emissive, tinted per viewer) | accent | REQUIRED, <= 5 %, top half |

Fighters add roles with `extra_materials(ctx)` (the reference adds a madder `felt`). Skins swap
palette values; they never add metal or a single saturated full-body colour, and keep team hues
(azure 200-225 deg, marigold 25-50 deg) out of albedo above 40 % saturation.

## The production template (`fighters/_template.py`)

Copy it to `fighters/<id>.py`; the file is organised in this order (the shared pipeline runs it):

0. **brief** — `ID` (== file name == content id), `TITLE`, `ROLE_MASS`, `ORIGIN` (aubade visor /
   serenade mask / hourless wrap)
1. **proportions** — `PROPORTIONS` (heroic, 6-6.5 heads; height class 1.6 / 1.9 / 2.4 m) + `SHAPE`
2. **body** — `body.humanoid_parts` + `body.boot`, fused by `mesh.union_fillet`, materials by region
3. **face** — `kit.carved_mask` (+ `kit.mask_beak`) | `kit.glass_visor` | `kit.hood`
4. **armour / cloth / props** — `kit.slab_pauldron`, `kit.limb_shell`, `kit.scarf`, `kit.mantle`,
   `kit.drape`, `mesh.slab` (blades, tablets: `bands` for spine / blade / glass edge), `mesh.loft`, `mesh.plate`
5. **palette** — `PALETTE = materials.bible_palette(...)` from the brief + `CARD` (UI colours)
6. **value gradient** — `VALUE_GRADIENT_STOPS`; choose palette values per band
7. **accent placement** — inlays/fins in the top half only (crown, shoulders, chest, weapon head)
8. **motion** — `MOTION = anim.motion_profile(weight, weapon, stance, run_ref_speed, blocks=BLOCKS)`
   (`BLOCKS` override the arm blocks: guard, run_fwd, run_back, lobby, ...) + `clip_overrides(ctx)`:
   cast_a1 / a2 / a3 / ult must be four DISTINCT gestures (impact at 40 % via `anim.strike_keys`)
9. **skins** — `SKINS = [{"id": "<id>_<variant>", "palette": {...}, "extra": {...}, "card": {...}}]`;
   `model()` reads `ctx.skin["extra"]` for skin-only geometry; same rig, clips, silhouette class
   (height +-5 %, footprint +-10 %), accent locations and value gradient
10. **export** — automatic: `<id>.glb` with every clip; `<skin_id>.glb` mesh + skeleton only (the
    client plays the BASE GLB's clips on skins by bone name); art.json; skins.json
11. **renders** — automatic; `SPLASH` overrides pose/camera/map (render.SPLASH_DEFAULTS)

The per-fighter **checklist** is at the top of `_template.py` (tris 10-25k; GLB <= 1.2 MB; rig;
<= 2 sway bones per drapery; required clips, multiples of 5, impact at 40 %, loops closed; run foot
slide; four distinct ability gestures; silhouette IoU <= 0.80; facing from above; value bands;
accent <= 5 % top half; banned motifs; splash composition; portrait/icon; art.json copied verbatim).

### `art.json` = exactly a `FighterArt` (zod `.strict()`, `src/contracts/catalog.ts`)

```json
{ "model": "assets/fighters/<id>/<id>.glb", "portrait": "assets/fighters/<id>/portrait.png",
  "splash": "assets/fighters/<id>/splash.png", "icon": "assets/fighters/<id>/icon.png",
  "height": 1.97, "scale": 1, "runRefSpeed": 3.45,
  "clips": { "idle": "idle", "run": "run", "attack1": "attack1", "attack2": "attack2",
             "cast_a1": "cast_a1", "cast_a2": "cast_a2", "cast_a3": "cast_a3", "cast_ult": "cast_ult",
             "death": "death", "recall": "recall", "idle_lobby": "idle_lobby", "victory": "victory",
             "channel": "channel", "dash": "dash", "stunned": "stunned" },
  "sockets": { "origin": "root", "chest": "chest", "head": "head", "hand_r": "hand.R", "hand_l": "hand.L",
               "weapon_r": "prop.R", "weapon_l": "prop.L", "foot_r": "foot.R", "foot_l": "foot.L",
               "weapon_tip": "x_blade_tip" },
  "accentMaterial": "accent" }
```

No other keys (strict). `height` = measured top of the rest-pose mesh (health bar placement).
`skins.json` holds each skin's SkinDef asset fields (`id`, `fighter`, `model`, `portrait`,
`splash`); CONTENT adds `name`, `tier`, `desc`, `releasedIn`. The base skin id is `<id>_base` and
points at the base files (VOCAB.md). Copy art.json VERBATIM into `content/fighters/<id>.json` `art`.

### Output files (VOCAB.md asset paths; art/out maps 1:1 to assets/)

```
art/out/fighters/<id>/<id>.glb             assets/fighters/<id>/<id>.glb
art/out/fighters/<id>/portrait.png         512²   head and shoulders, three-quarter
art/out/fighters/<id>/splash.png           1600x900 front three-quarter, subject in columns 7-12
art/out/fighters/<id>/icon.png             128²   mask close-up
art/out/fighters/<id>/<skin_id>.glb, <skin_id>_portrait.png, <skin_id>_splash.png
art/out/fighters/<id>/art.json, skins.json
art/renders/fighters/<id>/turntable.png, three_<id>.png, three_clips_<id>.png, build_report_<sid>.json
```

## Conventions

**Axes and units.** Blender Z-up, 1 unit = 1 m, models face **-Y**, feet at Z = 0, object
transforms left at identity (object-space texture coordinates are world coordinates). The glTF
exporter maps (x, y, z) -> (x, z, -y): models face **+Z** in three.js.

**VALE_BIPED_1.** `root, hips, spine, chest, neck, head, shoulder/upper_arm/forearm/hand .L/.R,
thigh/shin/foot/toe .L/.R, prop.R (child of hand.R), prop.L (child of hand.L)`; extras use the
`x_` prefix (`rig.add_chain` -> `x_<name>_<i>`, `rig.add_socket`). A-pose rest. `rig.proportions(...)`
drives it (height, head, neck, shoulder_width, hip_width, leg, thigh_frac, arm, upper_arm_frac,
hand, foot, ankle_height, spine_curve, stance, toe_out_deg, a_pose_deg, arm_forward_deg,
elbow_bend_deg, knee_bend, shoulder_drop).

**Bone roll (local axes).** +Y along the bone. Every body bone rolls its local **+Z to the
character's front**; foot, toe and prop bones point forward and roll +Z **up**. In Euler XYZ degrees
(what `anim` poses use): **+X swings the bone tip forward** (spine/neck/head bend forward, thigh
flexes, upper arm raises forward, elbow flexes, foot dorsiflexes), knee flexion is **-X** on the
shin, Y twists, Z bends sideways. `anim.mirror` swaps sides and negates Y and Z.

**Props.** Model props at the world origin with the grip at the origin, main axis +Z and the
front/edge toward -Y; `rig.prop_matrix(info, 'prop.R')` places them in the hand. `mesh.slab`
builds blades in exactly that frame (YZ plane, thickness along X).

**three.js names.** three's PropertyBinding strips `.` from node names: `prop.R` is `propR`. Clip
tracks already use the sanitised names; look sockets up with
`THREE.PropertyBinding.sanitizeNodeName(name)`.

## Motion

One Blender action per clip, named exactly as the clip, stashed on a muted NLA track; the exporter
writes one glTF animation each, sampled at 30 fps. Required: `idle, run, attack1, attack2, cast_a1,
cast_a2, cast_a3, cast_ult, death, recall, idle_lobby, victory`; generated optional `channel, dash,
stunned`; fighters may add `crit, spawn, taunt`.

**Strike timing** (`anim.strike_keys(profile, wind, hit, follow)`, used by every generated
attack/cast and by bespoke ones; frame counts are multiples of 5, impact at exactly 40 %):

| t | key | what it adds |
|---|---|---|
| 0.00 | guard | |
| 0.08 | counter | anticipation of the anticipation: torso dips 10 % away from the wind-up, weight drops |
| 0.22 | wind | the wind-up |
| 0.29 | coil | moving hold: the wind-up drifts 8 % further, slowing in (never a freeze) |
| 0.34 | drive | successive breaking of joints: hips 60 %, spine 45 %, chest 30 %, weapon 18 % |
| **0.40** | **impact** | accelerating into the hit; hips drop (weight: light 0.7, medium 1.0, heavy 1.35) |
| 0.46 | hold | impact hold: 25 % drift toward the follow-through so the hit reads |
| 0.58 | follow | follow-through; head, neck and a free off hand drag (60-70 %) |
| 0.78 | recover | half way back |
| 1.00 | guard | `settle` ease: ~6 % overshoot that dies out |

Overlap helpers: `anim.lerp_pose_w(a, b, t, {bone or ik key: t})` (per-part timing) and
`anim.drag(sample, frames, {"head": 1.5, "neck": 1.0})` (time lag on parts that do not carry the
weapon, so the impact stays exact). The run trails the arms by ~0.6 frame; the ult adds a counter
rise, a moving-hold gather, a 5 % overshoot and a settle; victory a crouch-and-rise. Feet are
planted by analytic IK; `run` moves the planted foot at exactly `run_ref_speed` (no slide at
`speed / runRefSpeed` playback). Loops (`idle` 72 f, `run`, `recall` 60 f, `idle_lobby` 96 f,
`channel`, `stunned`) close exactly. No root motion. `death` ends at rest on the ground; x_ chains
have a floor constraint (`ChainCfg.floor`), so drapes never swing through it.

## Baking

Per asset: smart-project UVs (per-part texel weights, concave packing), then **exploded**
selected-to-active Cycles bakes (parts 6 m apart; sources joined into one object whose original
positions are kept in `vale_obj`, so procedural textures do not move). Passes: base colour
(emission trick), roughness + metallic, tangent normal, AO on the assembled low (real inter-part
occlusion). Bible fighters multiply that AO into the base colour (x0.6, eased) and lift the ORM
occlusion so the two do not double up. ORM is packed with numpy.

## Export and compression

`export.optimize(glb, fighter=True)` runs `art/tools/optimize.mjs --fighter`: dedup, drop constant
rest tracks, resample, **KHR_mesh_quantization** (positions 14 bit, normals 10, UVs 12, weights 8),
**EXT_texture_webp** (sharp; base colour q80, normal q88, ORM q72) and **normalized int16 rotation
tracks** (core glTF 2.0). three r186 GLTFLoader reads all of it natively (no Draco/Meshopt/KTX2
decoders). Budget: **<= 1.2 MB per fighter or skin GLB** at 10-25k tris; `three_load_test.mjs
--budget-kb 1172` checks it, validates every WebP and plays every clip; `three_snapshot.mjs` decodes
the real WebP in Chromium.

## Renders (`render.fighter_renders`, bible conventions)

* **Lighting:** ONE sun behind-left of the camera at the bible's fighter key (view 225 deg / 45 deg,
  0.9 x the map sun, the map's sun colour), the map's sky HDR as fill (ambient 0.65), a soft
  painterly rim from behind-right. **Khronos PBR Neutral** view transform, then the locked
  **vale_grade_01** LUT applied in numpy: the game's exact chain.
* **Splash 1600x900:** the victory hold, FRONT three-quarter (camera on the fighter's left; the
  fighter faces screen-left into the frame), subject centred at ~73 % of the width (grid columns
  7-12; UI owns 1-6), feet grounded with a shadow-catcher shadow, slight hero angle.
* **Painted map backdrop:** `render.map_backdrop` builds soft set dressing INSIDE the shifted
  camera frustum: Aubade spires (stacked chalk tiers, dawnglass belfries) screen-left, Serenade
  domes on banded drums screen-right, the fallen needle, the dial floor with paving and converging
  hour-lines, aerial haze by distance; rendered under the map sky (`art/out/maps/<map>/sky.hdr`)
  at 3/4 size, Kuwahara-painted, softened and composited under the fighter.
* **Portrait 512²:** head and shoulders, three-quarter, the lobby idle (weapon away from the face).
* **Icon 128²:** mask close-up on a painted sky; reads at a glance.
* **Turntable** (QA): 8 angles + run contact, attack1 impact, cast_ult impact, death end.

## Readability QA (`art/tools/lineup_qa.py`)

Imports N GLBs, poses `idle` frame 0 and renders each ALONE at the game camera (pitch 52 deg,
vertical FOV 26 deg, 28.5 m, 1920x1080: a 1.9 m fighter is ~96 px), per facing (0/90/180/270), with
the fighter key + map sky, PBR Neutral + LUT. Writes `art/renders/lineup/<name>.png` (colour on the
lane colour, grayscale L*, black silhouette) and `<name>.json`: height px, value bands (L* of the
top quarter / middle / bottom quarter of the silhouette), accent share (+ top-half share), and the
pairwise silhouette IoU at 64 px (masks aligned on the fighter origin; same-fighter skin pairs are
reported but not gated) plus a height-normalised IoU.

## Sky

`sky.py` renders Blender's physical sky (MULTIPLE_SCATTERING) with a painted procedural cloud deck
through a 2048x1024 equirect camera, normalised to mean radiance 1.0, saved as Radiance `.hdr`.
Image centre = world +X, right half toward three's +Z; `sky.sun_dir_three(az, el)` gives
`lighting.sunDir`. Locked outputs: `art/out/maps/{map_rift,map_bridge,map_fray,menu_rim}/sky.hdr`
(+ lighting.json) and the grade `art/out/grade/vale_grade_01.cube`.

## Measured here (4 shared CPUs, no GPU, bpy 5.2.2 wheel)

MEASURED_TABLE

## Known issues / next steps

KNOWN_ISSUES
