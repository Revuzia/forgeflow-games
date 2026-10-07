# Ulkro · Slinger: art brief

`ulkro` · Hourless (she) · standard (anchor 1.9 m, authored at 1.85 m) · 1.85 m · res_tally · ranged 5.4 m phys · difficulty 3

> Source of truth: `_design/ROSTER.md` §3 entry 13, `content/fighters/ulkro.json`, `content/skins/ulkro.json`. Look law: `STYLE_BIBLE.md` (Fighters, Look rules), `_design/tokens.json` `fighter`, `WORLD.md` §2 (faces). Pipeline: `CONTRACT.md` §12, `art/README.md` and `art/blender/fighters/_template.py`; the section numbers below follow the template's 0-11. Art authors the numbers marked *start value*; the `lineup_qa` / three QA measurements decide.

Banned for every fighter: gears, clock hands, gold filigree, gems, glowing runes, metallic bevels, teal-and-gold, red-versus-green. Every material is non-metallic (metalness 0): "iron" and "steel" mean matte, painted, oxidised-looking stone or ironstone, never a bright edge. Only the `accent` material emits; dawnglass and lampresin are glossy but never emissive.

## 0. Brief

| Field | Value |
|---|---|
| `ID` (file name = content id) | `ulkro` |
| `TITLE` (collection title, never an epithet) | Dart hunter |
| `ROLE_MASS` | `slinger` (Slinger; `class_slinger`) |
| `ORIGIN` | `hourless`: wrap or hood |
| Fight job | Never stops moving: every stride she runs loads her next throw. |
| Positions | `shaftlight` / `grovehunter` · bot `marksman`, preferred range 5.4 m |
| Height | **1.85 m** (class: standard (anchor 1.9 m, authored at 1.85 m)); 93 px at 1080p, 62 px at 720p (vertical px = 50.5 × height m; horizontal 82.1 px per m) |
| `art.height` / `collisionRadius` / `moveSpeed` | 1.85 m / 0.5 m / 3.5 m/s: author `run` for **3.5 m/s** (`runRefSpeed`); the content JSON still carries the 3.6 placeholder until `art.json` is copied back |
| Weapon + motion | spear-thrower (atlatl), `one_hand`, on the right forearm with a long dart laid along it; weight `light`, stance `low`. The back quiver of darts is part of the body, not a prop. |
| `CARD` = `FighterDef.palette` | primary `#6B6052` · secondary `#A39C8C` (collection and draft backdrops; already in the JSON) |
| Kit (for the body notes) | passive **Run-up** · a1 **Hurl** · a2 **Bound** · a3 **Hamstring Dart** · ult **Long Run** |

## 1. Silhouette at 96 px

- **Mass: Slinger, horizontal, on a runner.** A lean hunter, shoulders 0.40 m and hips 0.28 m, leaning 8 degrees forward in `idle` and 12 degrees in `run`. A long **spear-thrower lies across the right forearm with a 1.6 m dart laid along it**, a pale bar 131 px wide at 1080p at chest height, pointing forward.
- **Hook:** a **crest of five radiating dart shafts behind the hood**. Five darts stand in the back quiver in a fan, each showing 0.55 m above the shoulder and spread 15 degrees apart (-30 to +30 degrees from vertical, tipped back), their leaf heads at the tips. From the camera the crest reads as a spray of lines behind the head over a horizontal bar: no other fighter has both.
- **Head:** a deep hood in a wide sandstone wrap, the face a narrow carved-wood eye-slit band over a linen wrap; the hood's point trails 0.20 m behind the nape.
- **Size:** 93 px tall at 1080p (62 px at 720p); the crest adds 28 px above the hood, and the dart on the thrower is the widest single read.
- **At 64 px:** a leaning figure with a fan of thin lines behind the head and one long horizontal bar at the chest. The darts are 6 cm shafts (5 px at 1080p), the thinnest forms on the figure.
- **Facing from above:** the eye-slit band is the beak (it extends 3 cm), the thrower and its dart point forward on the right, and the crest sweeps back.

Pairs to test first (IoU <= 0.80 at 64 px):

- **Ulkro / Lisvel** (the other Slinger): a short thrower with a crest of darts and a deep hood versus a 1.9 m bow and a clean head.
- **Ulkro / Odrum:** a bar at chest height with a spray behind the head versus a yoke at shoulder height with two hanging pots.
- **Ulkro / Nurrow** (the other forward-leaning figure): a hood with a fan of lines versus a pale cone hat; the crest keeps them apart.

## 2. Proportions and shape (template 1)

- **Standard class**: height 1.85 m, head 0.29 m (6.4 heads, measured without the hood). Long legs for a runner (0.90 m of the 1.85 m is leg).
- **Stylized heroic:** hands x1.4, boots x1.2 wide with a soft sole, a narrow waist, a medium neck (0.065 m). A forward-leaning stance: `spine_curve` 0.03, `stance` 0.035.
- *Start values*:

```python
PROPORTIONS = rig.proportions(height=1.85, head=0.29, neck=0.065, shoulder_width=0.40, hip_width=0.19, leg=0.90,
                              thigh_frac=0.50, arm=0.61, upper_arm_frac=0.52, hand=0.20, foot=0.30,
                              ankle_height=0.09, spine_curve=0.03, stance=0.035, toe_out_deg=6.0, knee_bend=0.025)
SHAPE = body.shape(girth=0.93, torso_w=0.94, torso_d=0.93, chest=0.96, waist=0.88, hips=0.92, arm=0.95, forearm=1.1,
                   leg=0.93, calf=1.0, hand=1.4, neck=1.2, head_w=1.04, head_d=1.03, jaw=1.0, feet=False)
```

## 3. Face (template 3)

- **Hourless hood and wrap.** A deep sandstone hood (`kit.hood`, one rigid shell with a 0.20 m trailing point) over a linen face wrap (`cloth2`) across the nose and mouth, and a narrow carved-wood eye-slit band (`kit.glass_visor` style, but wood, 0.18 m wide and 4 cm tall) across the eyes with ink recesses. The band extends 3 cm forward as the beak and the facing cue. No bare face, no hair.
- The hood's brim shades the slit from the 52 degree camera, so the band is mostly a portrait read; the brim must clear the brow by 3 cm so the slit shows in the portrait.

## 4. Armour, cloth and props (template 4)

- **Torso.** A warm brown-grey wrap tunic (`cloth`) with a crossed leather chest strap (`leather`) that holds the quiver; shoulder wraps of pale stone-coloured linen plates (`stone`, rigid) on both shoulders.
- **Arms.** Sandstone sleeve wraps (`sandstone`), a leather bracer on the right forearm that carries the thrower.
- **Legs.** Close dark leggings (`under`), wrapped shins (`cloth2`) and soft waxed-leather boots with a low heel.
- **Spear-thrower** (`prop.R`, grip at the origin, blade along -Z): a bleached carved-wood thrower 0.90 m long, 6 cm wide and 3 cm thick with a hooked peg at the back and a leather grip 0.12 m. The dart laid along it is a pale shaft 1.6 m long, 6 cm thick, with a dawnglass leaf head 0.16 m long carrying an accent inlay.
- **Back quiver** (`x_quiver` on the upper back, rigid): a leather tube 0.50 m tall holding five darts in a fan; each shaft shows 0.55 m above the shoulder (pale wood, 6 cm), each leaf head is dawnglass 0.14 m long with one accent inlay. The quiver and the darts are one rigid mesh moving with the spine.

Sockets (`art.json` `sockets`; the standard set stays exactly as in the content JSON):

`origin root`, `chest chest`, `head head`, `hand_r hand.R`, `hand_l hand.L`, `weapon / weapon_r prop.R`, `weapon_l prop.L`, `foot_r foot.R`, `foot_l foot.L`, plus the extras `dart_tip x_dart_tip` (every Hurl and Run-up dart leaves here) and `quiver x_quiver` (the Hamstring Dart is drawn from here).

## 5. Palette (template 5)

Hexes are authored albedo in the bible vocabulary (`materials.bible_palette` roles). None of the reserved relationship hues (Dawn azure `#3F9CFF`, Dusk marigold `#FF9A1F`, Noonwhite `#F4EFE2`) dominates: every large-area colour is below 40% saturation inside the azure (200-225°), marigold (25-50°), heal (125-150°) and tritan (340-350°) hue bands, and no large area is lighter than L* 86. The `accent` role is authored azure; the renderer tints it per viewer.

| Role | Hex | L* | Hue / sat | Where it is used |
|---|---|---|---|---|
| `sandstone` | `#D6CAB0` | 82 | 41° / 18% | deep hood shell, sleeve wraps |
| `wood` | `#D9CFB8` | 83 | 42° / 15% | bleached thrower, dart shafts, eye-slit band |
| `cloth2` | `#CFC8BA` | 81 | 40° / 10% | face wrap, shin wraps |
| `stone` | `#B3AEA2` | 71 | 42° / 9% | shoulder wrap plates |
| `dawnglass` | `#B9CFE0` | 82 | 206° / 17% | dart leaf heads |
| `cloth` | `#7E7466` | 49 | 35° / 19% | brown-grey wrap tunic |
| `leather` | `#443B33` | 26 | 28° / 25% | chest strap, boots, bracer, quiver tube |
| `under` | `#352F2B` | 20 | 24° / 19% | leggings |
| `ironstone` | `#4A4540` | 30 | 30° / 14% | hooked peg, hood trim |
| `ink` | `#17161A` | 8 | 255° / 15% | hood interior, slit recesses |
| `accent` | `#3F9CFF` | 63 | 211° / 75% | six dart-head inlays (five quiver darts and the laid dart) |

## 6. Value gradient (template 6)

Light head, dark feet: the bible bands measured on screen by `lineup_qa` (top quarter L* 70-85, middle 45-65, feet 20-35; at least 40% of the silhouette at rest value). The means below are area-weighted estimates of the authored albedo before the `VALUE_GRADIENT_STOPS` ramp (x0.62 at the feet to x1.06 at the crown) and the baked top light, so the on-screen top band sits a little higher.

| Band | Target L* | Mix (share of the band) | Mean L* |
|---|---|---|---|
| top quarter (crown to chest) | 70-85 | sandstone 32%, wood 24%, cloth2 12%, stone 12%, dawnglass 8%, cloth 6%, ironstone 4%, ink 2% | **75** |
| middle half | 45-65 | cloth 42%, leather 18%, under 10%, wood 12%, stone 8%, sandstone 10% | **51** |
| feet quarter (shins down) | 20-35 | under 42%, leather 36%, cloth2 10%, ironstone 12% | **29** |

The hood, the pale darts and the thrower carry the top quarter; the brown-grey tunic carries the middle; dark leggings and boots are the feet. The crest of pale shafts adds light to the top band without adding mass. If lineup_qa shows the laid dart as the brightest mid-band stripe, tint it 3 L* darker.

## 7. Accent (template 7)

Six dart-head inlays, each about 4 x 1.2 cm = 29 cm2 in total, against roughly 9,300 cm2 of silhouette (the crest adds about 700 cm2): **about 0.3%** (budget 5%), 100% in the top half (the five quiver heads stand at about 1.9-2.1 m above the ground behind the head, and the laid dart's head is at chest height, 1.35 m). At rest the emissive is 0.8; it blooms to 1.5 or more in the wind-up of Hurl at four Run-up stacks and in the wind-up of Long Run. The fan of five heads means the colour reads from any angle, including from above.

## 8. Motion (template 8)

`MOTION = anim.motion_profile(weight="light", weapon="one_hand", stance="low", run_ref_speed=3.5, blocks=BLOCKS)`

`BLOCKS` (the right arm holds the thrower and its dart; the left hand is free):
- **guard / idle:** the thrower arm cocked back with the dart laid forward, the left hand loose at the hip; the lean at 8 degrees, weight on the balls of the feet.
- **run:** a long hunter's stride, the lean at 12 degrees, the thrower arm carried forward and level, the left arm pumping; contact 0.25, a light bob, the longest stride in the roster; the crest and the quiver stay rigid.
- **lobby:** a small restless jog in place; see below.

Four distinct ability gestures. Frame counts are multiples of 5 at 30 fps; the impact is at exactly 40% of the clip (frame = 0.4 × N). The sim's `castTime` is the windup before the effect lands; the clip's impact frame is the visual hit. A `castTime` of 0 means the effect starts at once, so the anticipation stays at 4 frames or fewer and the gesture must not hide a dash.

| Clip | Frames (impact) | Sim ability | Gesture |
|---|---|---|---|
| `cast_a1` | 30 (f12) | **Hurl** · castTime 0.3 s · 10 m long dart, +25% per Run-up stack | The thrower arm draws back over the shoulder with the dart (f0-f10, the weight shifting to the back foot, the left arm pointing at the target for aim), and at f12 the arm whips forward and the dart leaves; the body follows through into a long step, the front knee bent. Recover by f30. Silhouette: a long bar drawn back, then thrown forward. At four stacks the accent blooms in the wind-up. |
| `cast_a2` | 15 (f6) | **Bound** · castTime 0.1 s · 4 m leap, +2 Run-up stacks | Almost instant (castTime 0.1): a skip-step and a long leap, one knee up and both arms spread with the thrower trailing; the apex is at f6 as the sim leaps her 4 m at 16 m/s, and she lands already running. Follow-through is the optional `dash` clip. Silhouette: a stretched diagonal with the crest streaming behind. |
| `cast_a3` | 20 (f8) | **Hamstring Dart** · castTime 0.2 s · 6 m dart, slow, reveal | She snaps a short dart from the quiver over her shoulder with the left hand (f0-f5) and flicks it low and sidearm at f8, the body dipping into a crouch as the dart skims toward the legs; the right arm keeps the thrower level. Recover to guard by f20. Silhouette: a crouch with one hand thrown out low. |
| `cast_ult` | 25 (f10) | **Long Run** · castTime 0.2 s · 5 s run form, +35% move speed | A sprint start: a deep breath and a crouch (f0-f5, a short held pose), then the first two strides burst out at f10 and the clip ends mid-stride, flowing straight into `run`; the crest and the quiver rattle in one rigid motion. The accent blooms in the wind-up (f0-f5). Silhouette: a coil, then a stretched runner. |

Other clips: `run` at 3.5 m/s (light, foot slide under 8%; in Long Run the renderer plays it 1.35 times faster); `attack1` a quick overhand throw of a short dart, `attack2` a sidearm throw with a half-step (both 20 frames, impact f8, the dart leaves at the impact frame); `death` stumbles and rolls onto her back, the darts spilling to one side (ends at rest); `recall` plants the thrower and checks the darts in her quiver one by one; `stunned` staggers with the crest rattling; `dash` is the leap loop; `taunt` taps the thrower twice on her shoulder and nods at the horizon.

**`idle_lobby`** (loops, closed first = last pose): She cannot stand still. She jogs lightly in place, checks the darts in her quiver with a thumb, glances at the far horizon as if something is moving there, shifts to a long stride and back, then looks at the camera with her head on one side as if asking why anyone is waiting. 90 frames.

**`victory`** (ends in a hold): She skids to a stop in a puff of dust, plants the thrower and a dart point-down, and looks along the line she just ran. Final hold: the thrower over her shoulder, one dart raised, the other hand shading her eyes toward the horizon, a quarter turned from the camera: she is already looking for the next hill. 45 frames, then the hold.

## 9. Skins (template 9)

Palette swaps plus optional extra geometry read from `ctx.skin["extra"]`. Every skin keeps the rig, clips, silhouette class (height ±5%, footprint ±10%), accent locations and value gradient; none adds metal, a single saturated full-body colour, or a reserved hue above 40% saturation. Names, tiers and descriptions come from `content/skins/ulkro.json`. The named hex is the identity colour of the skin: where it falls outside a band's L* range, the surface steps lighter or darker by band and the identity hex is used at its own band.

### `ulkro_base`: Ulkro (base)

Points at the base files (`assets/fighters/ulkro/ulkro.glb`). The palette is section 5.

### `ulkro_highrim`: Highrim Thrower (standard)

*"Sandstone wraps, a bleached thrower and pale dart shafts, wind-carved like the high rim of the dial."*

Sandstone wraps (`#CDBB9C`, hue 38, 25% saturation), a bleached thrower and pale dart shafts, the colours of the wind-carved rim. The wraps are the pale tone, so the top quarter holds easily; the tunic and boots stay mid and dark. **No extra geometry.**

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `sandstone` | `#CDBB9C` | 77 | 38° / 24% | the named sandstone wraps #CDBB9C (hood and sleeves) |
| `wood` | `#E0D8C6` | 87 | 42° / 12% | bleached thrower and dart shafts |
| `cloth` | `#85796A` | 51 | 33° / 20% | tunic |
| `stone` | `#BDB6A8` | 74 | 40° / 11% | shoulder wraps |

Value bands (area-weighted): top **75** (70-85) · mid **52** (45-65) · feet **29** (20-35).

`SKINS` entry: `{"id": "ulkro_highrim", "palette": {...as above...}, "extra": {}, "card": {"primary": "#8E8068", "secondary": "#E0D8C6"}}`

### `ulkro_long_evening`: Long Evening Darts (deluxe)

*"A plum hood and smoked-amber dart heads from the Serenade dusk festival. A rigid lacquered fan stands behind the quiver."*

A plum lacquer hood (`#5B3A5E`, hue 295) and smoked-amber dart heads (`#9C8566`, 35% saturation). The plum hood is dark, so the top band re-mixes: the hood is only the hood's shadowed shell and brim (10% of the top band) while the pale shoulder wraps, the face wrap and the dart shafts carry the value. **Extra geometry:** a rigid lacquered fan, 0.30 m wide and 0.04 m deep, stands behind the quiver as a backdrop for the five darts (it stays inside the +10% footprint limit and duller than the accent).

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `sandstone` | `#5B3A5E` | 30 | 295° / 38% | the named plum hood #5B3A5E (the hood shell and brim only) |
| `dawnglass` | `#9C8566` | 57 | 34° / 35% | the named smoked-amber dart heads #9C8566 (glossy glass, not emissive) |
| `wood` | `#E2D8C4` | 87 | 40° / 13% | pale dart shafts and thrower |
| `stone` | `#C9C1B3` | 78 | 38° / 11% | pale shoulder wraps |
| `cloth2` | `#D2CBBE` | 82 | 39° / 10% | face wrap |

Value bands (area-weighted): top **72** (70-85) · mid **47** (45-65) · feet **29** (20-35).

This skin re-mixes the top band: the plum hood is 10% of it and the pale shafts, wraps and shoulders carry the value.

`SKINS` entry: `{"id": "ulkro_long_evening", "palette": {...as above...}, "extra": {"lacquer_fan": True}, "card": {"primary": "#4A3548", "secondary": "#9C8566"}}`

## 10-11. Export and renders

- Splash: `SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "yaw": 22.0}`. The crest of darts fans out toward screen-right with the horizon hand raised; the thrower over her shoulder.
- Portrait (512 square, `idle_lobby` t 0, yaw 28): the hood, the eye-slit band and two of the quiver darts. Icon (128 square): the eye-slit band under the hood with the crest tips above.
- GLB budget 10-25k tris and at most 1.2 MB, base and both skins.

## Per-fighter checks (on top of the template checklist)

- [ ] The five-dart crest and the laid dart both read in black at 64 px: a spray of lines behind the head and one horizontal bar at the chest.
- [ ] IoU against Lisvel, Odrum and Nurrow <= 0.80; the crest is at least 0.5 m above the shoulder.
- [ ] The quiver, the darts and the thrower are rigid; the hood point is one rigid shell with no sway bone.
- [ ] The six dart-head inlays are the only emissive material; the dawnglass heads stay glossy and never glow.
- [ ] The `run` clip has the longest stride in the roster at 3.5 m/s with foot slide under 8%, and `cast_ult` ends mid-stride so it blends straight into `run`.
