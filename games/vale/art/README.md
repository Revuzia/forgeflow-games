# VALE — art pipeline (lane ART)

Blender 5.2 (5.1 compatible), headless and deterministic. Every fighter, skin, unit, landmark,
map scene and sky is produced by a script in `art/blender/`, built by `art/build.py`, checked
against CONTRACT §12 by `art/build.py check`, and exported as GLB/HDR/PNG into `art/out/`
(tracked; the content build maps `art/out/...` to `assets/...`).

```
python3 art/build.py proof            # the technical mannequin, end to end (+ sample sky + check)
python3 art/build.py fighter <id>     # one fighter + its skins     (args pass through: --fast, --no-render,
python3 art/build.py fighters         # every fighters/*.py          --no-bake, --no-skins, --skin <id>,
python3 art/build.py unit <id> | units                               --no-optimize, --clip-sheet)
python3 art/build.py map <id>  | maps
python3 art/build.py sky <id>  | skies   # presets in art/blender/sky_presets.json
python3 art/build.py portraits [<id>]    # re-render portrait/splash/icon/turntable from art/.cache
python3 art/build.py check               # validate every GLB + art.json in art/out, write art/out/manifest.json
python3 art/build.py all                 # fighters, units, maps, skies, check
```

**Running Blender.** With `$BLENDER` set (Windows: `set BLENDER=C:\Program Files\Blender
Foundation\Blender 5.1\blender.exe`) each script runs as
`"$BLENDER" --background --factory-startup --python-exit-code 1 --python <script> -- <args>`.
Without it, the script runs as `python3 <script> -- <args>` against the `bpy` wheel. Scripts read
their own arguments after `--` either way, and import `bpy` before anything from `mathutils`.
Option names are filtered against the running Blender's operators (`scene.op_kwargs`), so an
exporter/UV option renamed between 5.1 and 5.2 falls back to its default with a log line instead
of crashing. Optional tools: `node` (gltf-transform optimisation, three.js QA, art.json schema
check; skipped with a warning if missing), `ffmpeg` (render denoise + contact-sheet labels;
skipped if missing — then raise samples) and a Chromium for the three.js QA renders (`$CHROME`,
or Playwright's browser cache; skipped if none).
Cycles CPU only. EEVEE is never used (no GPU/EGL on the build host).

## Layout

```
art/build.py                      runner + contract check + manifest
art/blender/common/               the shared library (one module per concern)
  scene.py      reset (metric, 30 fps, Cycles, AgX), seeds, collections, paths, timers, args
  rig.py        VALE_BIPED_1 from a proportions dict, x_ chains, sockets, prop frame
  body.py       parametric humanoid base body (lofted anatomy) + boots/fists
  mesh.py       lofts/sweeps, skin-modifier bodies, voxel union with junction fillets,
                conformed armour plates, cloth panels, decimation, cleanup, skin weights
  materials.py  stylized-PBR node materials from a palette, value gradient, `accent`
  bake.py       UV layout, exploded selected-to-active Cycles bakes, ORM packing, glTF material
  anim.py       FK/IK skeleton, pose library, easing, standard clip generators, secondary motion
  export.py     glTF export (+ EXT_mesh_gpu_instancing scatter), gltf-transform optimise
  render.py     portrait / splash / icon / turntable contact sheet (Cycles + ffmpeg denoise)
  sky.py        equirect HDR sky (physical sky + painted procedural cloud deck)
  imageops.py   numpy image ops (no Pillow: Blender's Windows Python has none)
  fighter.py    Part / Context / binding helpers;  pipeline.py: the fighter build
art/blender/fighters/<id>.py      one hand-authored script per fighter (+ skins); `_template.py`
art/blender/fighters/_proof_mannequin.py   the technical proof (not game content)
art/blender/units|maps|landmarks/ unit / map / landmark scripts (files starting with `_` are skipped)
art/blender/sky.py, sky_presets.json, portraits.py
art/tools/optimize.mjs            gltf-transform pass (dedup, drop constant rest tracks, resample, prune)
art/tools/inspect_glb.mjs         nodes, bones, clips (+durations), materials, textures, tris
art/tools/three_load_test.mjs     loads a GLB with three r186 GLTFLoader in Node and checks it (+Z facing,
                                  colour spaces, loop seams, run foot slide, art.json height)
art/tools/three_snapshot.mjs      renders a GLB with the REAL three r186 renderer (headless Chromium):
                                  gameplay-camera facings, key poses, close-ups; --clips = clip sheet;
                                  reports facing, px height at 1080p and accent coverage
art/tools/validate_art_json.mjs   parses art.json / skins.json with src/contracts/catalog.ts (zod)
art/out/                          shipped outputs (tracked) + manifest.json; ids starting with `_`
                                  (the proof, the template demo) write to art/out/<id>/, never fighters/
art/renders/                      QA renders (turntables, sky previews, build reports)
art/.cache/                       .blend snapshots (gitignored)
```

## Conventions

**Axes and units.** Blender Z-up, 1 unit = 1 m, models face **-Y**, feet at Z = 0, object transforms
left at identity (so object-space texture coordinates are world coordinates). The glTF exporter
maps (x, y, z) -> (x, z, -y): models face **+Z** in three.js.

**VALE_BIPED_1.** `root, hips, spine, chest, neck, head, shoulder/upper_arm/forearm/hand .L/.R,
thigh/shin/foot/toe .L/.R, prop.R (child of hand.R), prop.L (child of hand.L)`; extras use the
`x_` prefix (`rig.add_chain` -> `x_<name>_<i>`, `rig.add_socket`). A-pose rest: arms 45° below
horizontal, 9° forward, soft elbows (10°) and knees. `rig.proportions(...)` drives it: height,
head, neck, shoulder_width, hip_width, leg, thigh_frac, arm, upper_arm_frac, hand, foot,
ankle_height, spine_curve, stance, toe_out_deg, a_pose_deg, arm_forward_deg, elbow_bend_deg,
knee_bend, shoulder_drop. Non-bipeds still carry every standard bone, placed sensibly.

**Bone roll (local axes).** +Y along the bone. Every body bone rolls its local **+Z to the
character's front**; foot, toe and prop bones point forward and roll +Z **up**. Therefore, in
Euler XYZ degrees (what `anim` poses use): **+X swings the bone tip forward** (spine/neck/head
bend forward, thigh flexes, upper arm raises forward, elbow flexes, foot dorsiflexes), knee
flexion is **-X** on the shin, Y twists, Z bends sideways. For .L/.R pairs X is symmetric and
Y/Z are mirrored (`anim.mirror` swaps sides and negates Y and Z).

**Props.** Model props at the world origin with the grip at the origin, main axis +Z (blade or
shaft up) and the front/edge toward -Y; `rig.prop_matrix(info, 'prop.R')` places them in the
hand. prop bones' +Y is the held item's axis — `anim.Aim` points it.

**three.js names.** three's PropertyBinding strips `.` from node names: `prop.R` is `propR`,
`upper_arm.L` is `upper_armL` in the loaded scene. Clip tracks already use the sanitised names;
look sockets up with `THREE.PropertyBinding.sanitizeNodeName(name)`.

**Clips** (one Blender action per clip, named exactly as the clip, stashed on a muted NLA
track; the exporter's `ACTIONS` mode writes one glTF animation each, sampled at 30 fps):
required `idle, run, attack1, attack2, cast_a1, cast_a2, cast_a3, cast_ult, death, recall,
idle_lobby, victory`; generated optional `channel, dash, stunned`; fighters may add `crit,
spawn, taunt`. Timing rules:
- attack/cast frame counts are multiples of 5 and the **impact is at exactly 40 %** (frame
  0.4·N): anticipation 0–24 %, accelerating strike, impact 40 %, overshoot/follow-through 52 %,
  settle to guard at 100 %. Weight classes scale durations (light 0.85×, medium 1×, heavy 1.2×).
- loops (`idle` 72 f, `run`, `recall` 60 f, `idle_lobby` 96 f, `channel`, `stunned`) close
  exactly (first pose == last pose; `check` verifies the seam).
- `run` is authored for `run_ref_speed` m/s: the planted foot moves back at exactly that speed
  (analytic leg IK), so playback scaled by speed / runRefSpeed never slides. Cycle 20 frames
  (medium), contact fraction 0.32, two hip bobs per cycle, counter-rotating chest, arm swing.
- no root motion (root never animates; hips carry bob/sway); `death` is non-looping and ends
  lying still with both hands and the held item resting ON the ground (hand IK `pos` + `Aim`);
  `victory` ends in a hold.
- per-clip info (frames, duration, loop, impact, run stride) is in the build report and in
  `art/out/.../art.json`.

**Authoring clips** (`anim.py`). Poses are dicts of bone-local Euler degrees plus
`hips_loc` (world metres) and `ik` targets: `FootTarget` (planted feet, heel/ball pivots),
`HandTarget(rel=...)` (wrist relative to the shoulder in arm lengths, in the chest's frame, so
torso twist carries the arcs; or `pos`, or `to_prop` for two-handed grips) and `Aim` (point the
held item). Generators: `standard_clips(skel, profile, overrides)`; profile =
`motion_profile(weight=light|medium|heavy, weapon=none|one_hand|two_hand|staff|bow|dual|focus,
stance=neutral|guard|wide|low, run_ref_speed=..., **knobs)`. Building blocks for bespoke clips:
`guard`, `stance`, `gesture_keys(profile, 'attack1'|'attack2'|'thrust'|'sweep'|'slam'|'raise')`,
`keyed([(t, pose, ease)])`, `layered`, `add`, `mirror`, `lerp_pose`, easing (`inout`, `accel`,
`snap`, `back`, `settle`...), `osc`. x_ chains get `secondary_motion` (damped springs: gravity,
inertia, drivers such as "thighs push the tabard").

**Materials.** Node materials end in one Principled BSDF named `BSDF`; `bake.py` routes its
inputs to emission for the bakes. Library: `painted_metal`, `leather`, `cloth`, `skin`, `stone`,
`wood`, `gem` (`gem_*`, kept emissive), `accent` (REQUIRED, emissive, kept), `flat`.
`standard_set(palette, gradient)` gives the usual roles: metal, trim, dark_metal, cloth, cloth2,
under, leather, leather_dark, skin, wood, accent. Painted cues: edge highlight (pointiness),
cavity dirt (local AO), brush blotches/strokes, and the **value gradient** (object Z: ×0.58 at the
feet -> ×1.08 at the head, gamma 0.8; `VALUE_GRADIENT` per fighter). Colours come from the
palette dict (`materials.palette(...)`), which the style bible owns.

**Accent coverage.** The `accent` must read at the game camera: the three.js QA measures its
share of the silhouette (8 facings, 54° pitch, 24° vFOV, 29 m) and the build warns outside
~1.5–6 % (bible proposals: 4–6 %, top half). A gem the size of a thumbnail is 0.5 % and invisible;
the proof uses a crest fin, two pauldron ridge strips, the chest gem and the eye slit (≈3.7 %).

**Shipped materials per fighter GLB:** `body` (base colour JPEG q90 + ORM PNG [R=AO, G=rough,
B=metal] + tangent normal PNG, 1024²) and `accent` (factor-only emissive; the renderer tints its
emissive with the team/player colour). Kept materials (`accent`, `gem_*`, `glow_*`) are split into
a second skinned mesh `<id>_accent` sharing the skeleton.

**Budgets** (enforced by `check`): fighter and skin 10–25k tris, ≤ 6 MB (skin ≤ 4.5 MB) and
textures ≤ 1024²; minion 1.5–4k; monster 4–12k; structure 4–20k; map scene ≤ 700k tris counting
every EXT_mesh_gpu_instancing instance; landmark textures ≤ 2048².

## Modelling a fighter (no primitives)

- **Body:** `body.humanoid_parts(info, shape)` lofts anatomy (superellipse sections with
  front/back depth) from the rig joints; `mesh.union_fillet` voxel-unions the parts and smooths
  only where parts meet, giving a sculpt-like high mesh with per-region materials. Its low is a
  symmetric collapse-decimation (`Part(high=..., tris=...)`); bone heat weights with a proximity
  fallback for any vertex heat misses.
- **Armour:** `mesh.plate(Cylindrical/Spherical projection, outline rows, target=...)` builds a
  structured grid inside an outline, ray-projects it onto the body (or previous plates, so
  layers stack), smooths the height field so it reads as rigid metal, adds a raised rim (trim
  material), an edge wall, bevels and weighted normals. Inner shells are omitted unless
  `inner=True` (half the tris; plates are not seen from behind). `shape_fn` adds ridges, flares,
  crests; `r_fn` makes pure parametric shells (domes, knee cops).
- **Cloth:** `mesh.cloth_panel` hangs a solidified panel from an attachment curve with folds,
  flare, a shaped hem and body clearance; bind it to an `x_` chain (`('chain', name, root)`).
- **Props / horns / blades / tails:** `mesh.loft` / `mesh.sweep` along smooth paths with caps.
- **Binding:** `'auto'`, `'bone:<name>'` (rigid), `('zblend', lower, upper, z0, z1)`,
  `('dblend', a, b, origin, axis, d0, d1)`, `('chain', chain, root)`, `'transfer'`.
- **Armour conform (automatic, `ARMOUR_CONFORM = False` to opt out):** after binding, every body
  vertex casts 5 rays (normal + 4 tilted 32°) at the rigid covers (plates, helmets, hoods; not x_
  cloth or props). Covered vertices take the cover's weights, so heat-weighted skin can never push
  through a plate in a pose (the proof's shoulder blades did, through the back plate, in `idle`),
  and faces hidden in every direction are deleted (keeping one ring next to anything visible): the
  proof drops ~1.3k invisible body triangles. Then `Mesh.validate()` runs before UVs, so the bake,
  the report and the GLB share one topology (the exporter otherwise "repairs" it mid-export).
- **Plates at a pole** (Spherical rows starting at v = 0, domes, helmets, hoods) collapse that row
  to one apex: per-column radii along the same ray made collinear slivers with flipped shading.

## Baking

Per asset: smart-project UVs (per-part texel weights, concave packing), then **exploded**
selected-to-active Cycles bakes — every part and its bake source are moved 6 m apart, and the
bake sources are joined into one object whose original object-space positions are kept in a
`vale_obj` attribute, so procedural textures do not move and overlapping layers (lames, belts
over plates) never bleed into each other. Passes: base colour (emission trick), roughness +
metallic packed in one emission pass, tangent normal (sculpt -> low, material bump included),
AO on the assembled low (real inter-part occlusion). Tangent normals tilted beyond ~70° (cage-ray
misses on tiny rim/bevel islands, ~0.6 % of the proof's texels) are reset to flat. ORM is packed with numpy. Joining the
sources matters: Blender casts each pixel against every selected object, so 36 separate sources
cost 57 s per fighter, one joined source 14 s.

## Rendering

AgX + "Medium High Contrast" (graceful emissive roll-off; matches three's AgXToneMapping if the
renderer uses it). Studio key (warm) + fill (cool) + two rims (card secondary colour).
Portrait 512² (rendered 768², 128 samples, nlmeans, downsampled) on a painted backdrop from the
fighter's card palette; icon 128² (256², 96 samples); splash 1600×900 (128 samples, shadow-catcher
ground over a painted sky/horizon backdrop, subject on the right third); turntable contact sheet
(8 angles + run contact, attack1 impact, cast_ult impact, death end) in `art/renders/`.
Portrait, splash and turntable pose the fighter's REAL clip set (generated + `clip_overrides`).

**In-engine QA (three.js r186).** Cycles cannot show what the game shows (the baked AO map, three's
tangent frame, glTF material mapping, back-face culling of single-sided plates, the accent tint),
so every build also writes `three_<id>.png` with `three_snapshot.mjs`: 8 facings at the gameplay
camera at true 1080p pixel size, run/attack/slam/ult/death poses, a team-tinted accent, close-ups
with the baked maps. The build fails if the model does not face +Z in three.

## Sky

`sky.py` renders Blender's physical sky (MULTIPLE_SCATTERING) with a painted procedural cloud
deck evaluated in the world shader through a 2048×1024 equirect camera, normalised so the mean
sky radiance is 1.0 (then `exposure` stops) and saved as Radiance `.hdr`. The image centre is
world +X and the right half turns toward three's +Z (as three samples equirect maps);
`sky.sun_dir_three(az, el)` gives the matching `lighting.sunDir`. Parameters: sun elevation /
azimuth, haze (turbidity), cloud cover / scale / softness / tint, sky tint, ground colour, sun
disc (off: the renderer's directional light is the sun), seed.

## Adding a fighter

1. `cp art/blender/fighters/_template.py art/blender/fighters/<id>.py`, set `ID = "<id>"`.
2. Fill the sections: PROPORTIONS, SHAPE, PALETTE + CARD, MOTION, `rig_extras` (x_ chains),
   `model` (hand-authored parts — branch on `ctx.skin` for skin-only geometry), `chain_config`,
   `clip_overrides` (bespoke clips), `SKINS` (palette swaps + `extra` geometry flags; same rig).
3. `python3 art/build.py fighter <id> --fast --no-skins` while iterating (look at
   `art/renders/fighters/<id>/turntable.png`; `--clip-sheet`), then a full build.
4. `python3 art/build.py check` and `node art/tools/three_load_test.mjs art/out/fighters/<id>/<id>.glb`;
   look at `art/renders/fighters/<id>/three_<id>.png` (the in-engine view) and, with
   `--clip-sheet`, `three_clips_<id>.png` (every clip × 8 frames in three).
5. Copy `art/out/fighters/<id>/art.json` VERBATIM into the fighter's content JSON as `art` (CONTENT
   lane). It is exactly a `FighterArt` (zod `.strict()`; `check` parses it with
   src/contracts/catalog.ts): model, portrait, splash, icon, `height` = measured top of the
   rest-pose mesh (crest/horns included, for the health bar), runRefSpeed, clips, sockets,
   accentMaterial. `skins.json` holds each skin's SkinDef asset fields (id, fighter, model,
   portrait, splash); CONTENT adds name, tier, desc, releasedIn. Clip frames/impact/stride are in
   the build report.

## Measured here (4 CPUs, no GPU, bpy 5.2.2 wheel)

See `art/renders/_proof/build_report__proof_mannequin.json` for the latest numbers.

| step (proof mannequin, `build.py proof --clip-sheet`, 2026-10-07, after the art review) | time |
|---|---|
| rig + materials | 0.2 s |
| model (fused body + 42 hand-placed parts) | 13.6 s |
| decimate + bind + armour conform (1,679 body verts re-weighted, 1,303 hidden tris culled) | 3.6 s |
| UV smart project + concave pack | 10.2 s |
| bake 1024² (base 2.9 s, rough/metal 1.4 s, normal 1.8 s, AO 48 spp 11.4 s) | 18.1 s |
| clips (15 clips sampled with IK + secondary motion) | 0.2 s |
| GLB export + gltf-transform | 2.4 s |
| renders: portrait 42 s, icon 3 s, splash 38 s, turntable 16 s | 104 s |
| three.js QA: sheet 12 s (+ clip sheet 22 s with `--clip-sheet`) | 34 s |
| **base build** | **187 s** |
| skin rebuild (`_proof_mannequin_ember`: model, bake, GLB, portrait, splash, three QA) | 105 s |
| sky 2048×1024, 16 spp (whole script) | 32 s |
| **`python3 art/build.py proof --clip-sheet` end to end (sky + base + skin + check)** | **5 min 25 s** |

Outputs: `art/out/_proof/_proof_mannequin.glb` (24,585 tris, 3.40 MB of which ~1.9 MB textures,
28 joints, 15 clips; 106 px tall at 1080p default zoom; accent 3.7 % of the silhouette),
`_proof_mannequin_ember.glb` (skin), `portrait.png`, `splash.png`, `icon.png`, skin portrait and
splash, `sky.hdr`, `art.json` (strict FighterArt), `skins.json`; QA in `art/renders/_proof/`
(`turntable.png`, `three__proof_mannequin.png`, `three_clips__proof_mannequin.png`, build reports).
