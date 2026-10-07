# Kemdo · Breaker: art brief

`kemdo` · Hourless (she) · standard, tall end (anchor 1.9 m, authored at 2.10 m) · 2.1 m · res_heat · melee 2.1 m phys · difficulty 2

> Source of truth: `_design/ROSTER.md` §3 entry 8, `content/fighters/kemdo.json`, `content/skins/kemdo.json`. Look law: `STYLE_BIBLE.md` (Fighters, Look rules), `_design/tokens.json` `fighter`, `WORLD.md` §2 (faces). Pipeline: `CONTRACT.md` §12, `art/README.md` and `art/blender/fighters/_template.py`; the section numbers below follow the template's 0-11. Art authors the numbers marked *start value*; the `lineup_qa` / three QA measurements decide.

Banned for every fighter: gears, clock hands, gold filigree, gems, glowing runes, metallic bevels, teal-and-gold, red-versus-green. Every material is non-metallic (metalness 0): "iron" and "steel" mean matte, painted, oxidised-looking stone or ironstone, never a bright edge. Only the `accent` material emits; dawnglass and lampresin are glossy but never emissive.

## 0. Brief

| Field | Value |
|---|---|
| `ID` (file name = content id) | `kemdo` |
| `TITLE` (collection title, never an epithet) | Burning glass |
| `ROLE_MASS` | `breaker` (Breaker; `class_breaker`) |
| `ORIGIN` | `hourless`: wrap or hood (with a carved eye-band) |
| Fight job | Dives one target, empties her Heat bar in two seconds, vents and goes again. |
| Positions | `grovehunter` / `shadehold` · bot `diver`, preferred range 2 m |
| Height | **2.1 m** (class: standard, tall end (anchor 1.9 m, authored at 2.10 m)); 106 px at 1080p, 71 px at 720p (vertical px = 50.5 × height m; horizontal 82.1 px per m) |
| `art.height` / `collisionRadius` / `moveSpeed` | 2.1 m / 0.6 m / 3.45 m/s: author `run` for **3.45 m/s** (`runRefSpeed`); the content JSON still carries the 3.6 placeholder until `art.json` is copied back |
| Weapon + motion | a long two-hand glaive whose head is a burning-glass lens in a wrapped stone frame, `two_hand`; weight `medium`, stance `wide`. |
| `CARD` = `FighterDef.palette` | primary `#8A7A66` · secondary `#D7C9A6` (collection and draft backdrops; already in the JSON) |
| Kit (for the body notes) | passive **Cooling Kill** · a1 **Long Thrust** · a2 **Heat Shimmer** · a3 **Vent** · ult **Held Focus** |

## 1. Silhouette at 96 px

- **Mass: Breaker, inverted wedge.** Heavy rigid shoulder wraps (0.95 m across with the wraps) narrowing through a belted waist to bound shins and narrow boots: shoulders : hips is 2.0. One oversized weapon on one side.
- **Hook:** the glaive on her right side, tilted 12 degrees outward, 2.70 m long: the lens near its top is a 40 cm glass disc angled upward, which reads as a bright ellipse from the 52 degree camera (33 px wide, 25 px tall at 1080p). The accent ring surrounds the lens and blooms only during wind-ups.
- **Size:** the figure is 106 px tall at 1080p (71 px at 720p); the glaive's lens centre sits at 2.2 m, level with the top of the hood (2.10 m) and 0.45 m to the right of the head; the blade tip stands about 0.6 m above the head.
- **At 64 px:** a wide wedge with a hooded head, a thin vertical pole on the right with a round bright disc at its top, a slim tapered lower body. The hood and the lens are separate round shapes at different heights.
- **Facing from above:** the brow eave projects 8 cm forward, the glaive stands on the right, and the shoulder wraps are heavier on the right (the weapon side) by 10%.

Pairs to test first (IoU <= 0.80 at 64 px):

- **Kemdo / Burdam** (both Breakers): a thin vertical pole with a round lens, a hood and slim wraps versus a broad diagonal blade and stacked pauldrons.
- **Kemdo / Dunsom:** a wedge body with the lens off to the right of the head versus a thin body with a flat disc ON the head and a crook rising above it. If IoU passes 0.80, tilt Kemdo's glaive to 16 degrees.
- **Kemdo / Hesmi** (both Hourless, hooded): a wedge with a pole and a lens versus a block with a flat rack.

## 2. Proportions and shape (template 1)

- **Standard class, tall end**: height 2.10 m (the hood crown, measured on the body mesh without the glaive: the prop's tip stands higher and must not set the health-bar height), head 0.33 m (6.4 heads).
- **Stylized heroic:** hands x1.55, forearms x1.3, boots x1.2 wide; a barrel chest and a narrow waist and hips build the wedge into the body before the wraps are added.
- *Start values:*

```python
PROPORTIONS = rig.proportions(height=2.10, head=0.33, neck=0.055, shoulder_width=0.55, hip_width=0.22, leg=0.94,
                              thigh_frac=0.50, arm=0.68, upper_arm_frac=0.52, hand=0.23, foot=0.33,
                              ankle_height=0.10, spine_curve=0.025, stance=0.055, toe_out_deg=8.0, knee_bend=0.014)
SHAPE = body.shape(girth=1.02, torso_w=1.1, torso_d=1.04, chest=1.14, waist=0.9, hips=0.9, arm=1.1, forearm=1.3,
                   leg=0.9, calf=0.95, hand=1.55, neck=1.2, head_w=1.08, head_d=1.06, jaw=1.0, feet=False)
```

## 3. Face (template 3)

- **Hourless hood and wrap.** A rigid hood (`kit.hood`) with a linen face wrap over the nose and jaw (`cloth2`), and a carved sandstone brow eave, a short shelf 8 cm deep and 0.20 m wide over the eyes with a narrow ink slit under it (the sun-shade of a woman who works under a lens). The eave's forward edge is the facing cue from above.
- No bare face, no hair.

## 4. Armour, cloth and props (template 4)

- **Shoulder wraps.** Heavy rigid layered wraps (`cloth`), three bands per shoulder, sculpted folds 2 cm deep, 10% heavier on the right (weapon side); they form the top of the wedge and are rigid bone-bound shapes with no sway.
- **Torso and legs.** A close linen under-shirt (`cloth2`), a wide leather belt, a waist wrap, trousers (`under`) bound from the knee to the ankle with leather lacing (the bound shins), narrow boots (x1.2 wide) with ironstone toe caps.
- **Prop: the glaive** (prop space: grip at the origin, shaft +Z, length 2.70 m). A 1.95 m carved pale-ash haft (`wood`) with two leather grip wraps; at the top a wrapped stone frame (`stone`, honed, 0.50 m tall, wrapped in `cloth2` bands), a 40 cm dawnglass lens in it (glossy, never emissive) angled 25 degrees toward the sky, an `accent` ring (outer 46 cm, inner 40 cm) set in the frame round the lens, and above it a carved ironstone blade tip 0.25 m long (the thrust point; no metal edge). The glaive is carried vertically at 12 degrees outward on her right side.

Sockets (`art.json` `sockets`; the standard set stays exactly as in the content JSON):

`origin root`, `chest chest`, `head head`, `hand_r hand.R`, `hand_l hand.L`, `weapon / weapon_r prop.R`, `weapon_l prop.L`, `foot_r foot.R`, `foot_l foot.L`, plus the extras `weapon_tip x_blade_tip` (the Long Thrust line), `lens x_lens` (the Held Focus beam source and the lens glint) and `vent x_vent_chest` (the Vent blast origin).

## 5. Palette (template 5)

Hexes are authored albedo in the bible vocabulary (`materials.bible_palette` roles). None of the reserved relationship hues (Dawn azure `#3F9CFF`, Dusk marigold `#FF9A1F`, Noonwhite `#F4EFE2`) dominates: every large-area colour is below 40% saturation inside the azure (200-225°) and marigold (25-50°) hue bands, and no large area is lighter than L* 86. The `accent` role is authored azure; the renderer tints it per viewer.

| Role | Hex | L* | Hue / sat | Where it is used |
|---|---|---|---|---|
| `cloth2` | `#D8CEB8` | 83 | 41° / 15% | hood, face wrap, under-shirt, frame wraps |
| `sandstone` | `#CDB996` | 76 | 38° / 27% | brow eave |
| `cloth` | `#9A8D7C` | 59 | 34° / 19% | heavy shoulder wraps, waist wrap |
| `stone` | `#C4BCA9` | 76 | 42° / 14% | the glaive's wrapped stone frame |
| `dawnglass` | `#C3D8E6` | 85 | 204° / 15% | the 40 cm burning-glass lens |
| `wood` | `#B79C7F` | 66 | 31° / 31% | the glaive haft (pale ash) |
| `leather` | `#4F4034` | 28 | 27° / 34% | belt, lacing, boots, grip wraps |
| `under` | `#3B3532` | 23 | 20° / 15% | bound trousers |
| `ironstone` | `#483F38` | 27 | 26° / 22% | toe caps, blade tip |
| `ink` | `#17181B` | 8 | 225° / 15% | the eye slit under the eave |
| `accent` | `#3F9CFF` | 63 | 211° / 75% | the ring round the lens |

Nothing is saturated above 40% in the marigold hue band: the wraps are a desaturated warm sand (hue 35 degrees, 20% saturation) and the lens is cool glass at 18%.

## 6. Value gradient (template 6)

Light head, dark feet: the bible bands measured on screen by `lineup_qa` (top quarter L* 70-85, middle 45-65, feet 20-35; at least 40% of the silhouette at rest value). The means below are area-weighted estimates of the authored albedo before the `VALUE_GRADIENT_STOPS` ramp (x0.62 at the feet to x1.06 at the crown) and the baked top light, so the on-screen top band sits a little higher.

| Band | Target L* | Mix (share of the band) | Mean L* |
|---|---|---|---|
| top quarter (crown to chest) | 70-85 | cloth2 36%, cloth 28%, stone 13%, dawnglass 8%, wood 6%, sandstone 5%, leather 4% | **72** |
| middle half | 45-65 | cloth 52%, leather 18%, under 12%, wood 6%, stone 6%, cloth2 6% | **52** |
| feet quarter (shins down) | 20-35 | under 46%, leather 34%, ironstone 12%, cloth 8% | **28** |

The hood, the shoulder wraps, the stone frame and the lens carry the top quarter (L* 72); the under-shirt and wraps are the middle; the bound shins, belt and boots are dark. The lens and its frame are the brightest forms but sit beside the head, so the head still reads first because the face wrap is the lightest large area at L* 83. If the lens competes with the face in `lineup_qa`, darken the lens glass by 4 L* (it is glass, so the specular still glints).

## 7. Accent (template 7)

The lens ring, outer 46 cm and inner 40 cm = about 405 cm2 against roughly 15,000 cm2 of silhouette: **about 2.7%** (budget 5%), 100% in the top half (the ring is at 2.0-2.4 m). At rest the emissive is 0.8; the ring blooms to 1.5 or more only in the wind-up of Held Focus (a glow is a warning: the sun is about to be focused). The ring is visible from above because the lens is tilted up 25 degrees.

## 8. Motion (template 8)

`MOTION = anim.motion_profile(weight="medium", weapon="two_hand", stance="wide", run_ref_speed=3.45, blocks=BLOCKS)`

`BLOCKS`:
- **guard / idle:** the glaive upright at the right side, the right hand at chest height on the haft and the left hand low, ready to slide; the lens tilted up. Weight on the back foot.
- **run_fwd / run_back:** the glaive angled forward at 35 degrees, both hands on it, the butt trailing; contact 0.32.
- **lobby:** the glaive held in the left hand, the right thumb on the lens frame.

Four distinct ability gestures. Frame counts are multiples of 5 at 30 fps; the impact is at exactly 40% of the clip (frame = 0.4 × N). The sim's `castTime` is the windup before the effect lands; the clip's impact frame is the visual hit. A `castTime` of 0 means the effect starts at once, so the anticipation stays at 4 frames or fewer and the gesture must not hide a dash.

| Clip | Frames (impact) | Sim ability | Gesture |
|---|---|---|---|
| `cast_a1` | 25 (f10) | **Long Thrust** · castTime 0.25 s · thrust along a 4.5 m line | The rear foot drives, the glaive is levelled in both hands (the front hand guides, the rear hand pushes), and at f10 her arms are fully extended with the lens pointing along the line; the body extends to a long diagonal. Hold to f15, retract by f25. Silhouette: a single long horizontal line through the body. |
| `cast_a2` | 20 (f8) | **Heat Shimmer** · castTime 0 s · dash 5 m, shimmer 2 s | Instant (castTime 0): she drags the glaive low behind her (the butt along the ground) and sprints, anticipation 3 frames; the skid at f8 with the lens flaring (a specular glint only, no emissive). Recover by f20. Silhouette: a low run with a trailing pole. |
| `cast_a3` | 25 (f10) | **Vent** · castTime 0 s · vent 50 Heat, 3 m blast | Instant (castTime 0): she plants the glaive butt in the ground and throws both arms wide with her head back, exhaling; at f10 the chest expands and the heavy shoulder wraps flare open 8 degrees (rigid, bone-driven) with a stamp. Hold the open pose f10-f18, then lower. Silhouette: a wide X with the glaive upright as the centre post. |
| `cast_ult` | 40 (f16) | **Held Focus** · castTime 0.25 s · lens beam on an enemy within 6 m, 3 s | She lifts the glaive in both hands and tilts the head forward 60 degrees like a mirror toward the target, the rear hand under the frame, on a wide braced stance; she goes completely still at f16 (the impact: the lens locks and the accent ring blooms). Hold the aim f16-f30 and recover by f40. Author the optional `channel` clip as a 90-frame loop of the aim hold with slow breathing (for the three seconds the spot follows the target). Silhouette: the glaive tilted at the target, a still wedge. |

Other clips: `run` at 3.45 m/s (medium, foot slide under 8%); `attack1` a short two-hand thrust, `attack2` a butt-stroke (30 frames, impact f12); `death` kneels and lets the glaive fall forward with the lens catching the sun (ends at rest); `recall` shades the lens with her hand and bows over it; `stunned` clutches the haft as the lens wobbles; the optional `dash` is a sprint loop with the glaive trailing; `taunt` flashes a glint with the lens.

**`idle_lobby`** (loops, closed first = last pose): Shy and playful. She adjusts the lens angle with her thumb, catches a glint of sunlight on the ground and moves the bright dot around like a toy, squints, then shades the lens with her free hand as if scolding it. 120 frames.

**`victory`** (ends in a hold): She tilts the lens into the sun and shields her eyes with her left forearm, turned half away, one boot on a low stone. Final hold: the glaive raised, the lens turned to the sun, her face turned away from the light. 60 frames, then the hold.

## 9. Skins (template 9)

Palette swaps plus optional extra geometry read from `ctx.skin["extra"]`. Every skin keeps the rig, clips, silhouette class (height ±5%, footprint ±10%), accent locations and value gradient; none adds metal, a single saturated full-body colour, or a reserved hue above 40% saturation. Names, tiers and descriptions come from `content/skins/kemdo.json`. The named hex is the identity colour of the skin: where it falls outside a band's L* range, the surface steps lighter or darker by band and the identity hex is used at its own band.

### `kemdo_base`: Kemdo (base)

Points at the base files (`assets/fighters/kemdo/kemdo.glb`). The palette is section 5.

### `kemdo_highrim`: Highrim Glaive (standard)

*"A frame of wind-scoured sandstone and pale wraps, from the high rim where the light is harshest."*

A wind-scoured sandstone frame (`#CDBB9C`) and pale wraps (`#DCD3C2`), from the high rim where the light is harshest. The pale wraps are the hood and shoulder tops; the wraps step darker toward the waist so the middle band holds. **No extra geometry**; a faint wind-grain relief on the frame is texture.

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `cloth2` | `#DCD3C2` | 85 | 39° / 12% | the named pale wraps #DCD3C2 (hood, face wrap, frame wraps) |
| `cloth` | `#A39887` | 63 | 36° / 17% | sand shoulder and waist wraps |
| `stone` | `#CDBB9C` | 77 | 38° / 24% | the named wind-scoured frame #CDBB9C |

Value bands (area-weighted): top **74** (70-85) · mid **54** (45-65) · feet **28** (20-35).

`SKINS` entry: `{"id": "kemdo_highrim", "palette": {...as above...}, "extra": {}, "card": {"primary": "#7A6C58", "secondary": "#DCD3C2"}}`

### `kemdo_long_evening`: Long Evening Lens (deluxe)

*"Plum wraps, a smoked-amber frame and a lilac-tinted lens from the Serenade dusk festival, with rigid lacquer tassel plates."*

Plum wraps (`#5B3A5E`), a smoked-amber frame (`#9C8566`) and a lilac-tinted lens (`#B9A6D6`, hue 264, outside every reserved band) from the Serenade dusk festival. The identity plum is the bound shins and the lacing; the shoulder wraps step lighter lilac-plum so the top quarter holds its value. **Extra geometry:** four rigid lacquer tassel plates (0.05 x 0.12 m, 1 cm thick) hung in a fan from the frame's lower edge, rigid with no sway bones, kept inside the footprint limit (+10%); the accent ring is unchanged and the tassels must stay duller than it.

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `cloth2` | `#D3C6D3` | 81 | 300° / 6% | lilac-pale hood and face wrap |
| `cloth` | `#AE9BB0` | 66 | 294° / 12% | lilac-plum shoulder and waist wraps |
| `stone` | `#9C8566` | 57 | 34° / 35% | the named smoked-amber frame #9C8566 |
| `dawnglass` | `#B9A6D6` | 71 | 264° / 22% | the named lilac lens #B9A6D6 |
| `wood` | `#B7A08A` | 67 | 29° / 25% | dusk-pale haft |
| `under` | `#5B3A5E` | 30 | 295° / 38% | the named plum #5B3A5E (bound shins, lacing) |
| `ironstone` | `#3E2B40` | 21 | 294° / 33% | plum-dark toe caps and blade tip |

Value bands (area-weighted): top **71** (70-85) · mid **55** (45-65) · feet **31** (20-35).

`SKINS` entry: `{"id": "kemdo_long_evening", "palette": {...as above...}, "extra": {"tassel_plates": True}, "card": {"primary": "#4A3550", "secondary": "#B9A6D6"}}`

## 10-11. Export and renders

- Splash: `SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92}`. The raised lens against the low sun is the hero pose; keep the lens inside the frame (`fill` 0.84) and let the specular glint land near the top of the frame, not on the face.
- Portrait (512 square, `idle_lobby` t 0, yaw 28): the hood with the brow eave and the lens catching light at the edge. Icon (128 square): the brow eave over the eye slit and the lens ring.
- GLB budget 10-25k tris and at most 1.2 MB, base and both skins.

## Per-fighter checks (on top of the template checklist)

- [ ] The wedge (shoulders : hips >= 1.4, target 2.0) and the vertical glaive with its lens read in black at 64 px.
- [ ] IoU against Burdam, Dunsom (the pole-and-disc pair) and Hesmi <= 0.80.
- [ ] The lens is a bright ellipse at the 52 degree camera and is never emissive: only the accent ring emits; the lens does not outshine the face wrap.
- [ ] `art.height` is the hood crown (2.10 m), measured without the glaive; `weapon_tip`, `lens` and `vent` sockets exist.
- [ ] `cast_a2` and `cast_a3` have at most 4 frames of anticipation (castTime 0); the optional `channel` aim-hold loop closes.
