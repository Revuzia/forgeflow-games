# Ardit · Plinth: art brief

`ardit` · Aubade (he) · large (anchor 2.4 m, authored at 2.35 m) · 2.35 m · res_light · melee 1.9 m phys · difficulty 1

> Source of truth: `_design/ROSTER.md` §3 entry 9, `content/fighters/ardit.json`, `content/skins/ardit.json`. Look law: `STYLE_BIBLE.md` (Fighters, Look rules), `_design/tokens.json` `fighter`, `WORLD.md` §2 (faces). Pipeline: `CONTRACT.md` §12, `art/README.md` and `art/blender/fighters/_template.py`; the section numbers below follow the template's 0-11. Art authors the numbers marked *start value*; the `lineup_qa` / three QA measurements decide.

Banned for every fighter: gears, clock hands, gold filigree, gems, glowing runes, metallic bevels, teal-and-gold, red-versus-green. Every material is non-metallic (metalness 0): "iron" and "steel" mean matte, painted, oxidised-looking stone or ironstone, never a bright edge. Only the `accent` material emits; dawnglass and lampresin are glossy but never emissive.

## 0. Brief

| Field | Value |
|---|---|
| `ID` (file name = content id) | `ardit` |
| `TITLE` (collection title, never an epithet) | Pavise bearer |
| `ROLE_MASS` | `plinth` (Plinth; `class_plinth`) |
| `ORIGIN` | `aubade`: glass visor |
| Fight job | Tilts a pane of dawnglass that disarms the fighters swinging at his team. |
| Positions | `grovehunter` / `lampglass` · bot `frontline`, preferred range 2 m |
| Height | **2.35 m** (class: large (anchor 2.4 m, authored at 2.35 m)); 119 px at 1080p, 79 px at 720p (vertical px = 50.5 × height m; horizontal 82.1 px per m) |
| `art.height` / `collisionRadius` / `moveSpeed` | 2.35 m / 0.68 m / 3.35 m/s: author `run` for **3.35 m/s** (`runRefSpeed`); the content JSON still carries the 3.6 placeholder until `art.json` is copied back |
| Weapon + motion | short spear (right hand, `prop.R`) and a tall dawnglass pavise (left forearm, `prop.L`), `one_hand`; weight `heavy`, stance `wide`. The pavise is the second prop: it moves with the left arm in every clip. |
| `CARD` = `FighterDef.palette` | primary `#CFCAC0` · secondary `#8496A8` (collection and draft backdrops; already in the JSON) |
| Kit (for the body notes) | passive **Turned Blades** · a1 **Lancing Run** · a2 **Glare** · a3 **Spire Strike** · ult **Muster** |

## 1. Silhouette at 96 px

- **Mass: Plinth block.** Flat crown, widest at the shoulders, square stance: shoulders 0.78 m, hips 0.48 m (1.6 : 1, rule at least 1.4). The flat-crowned helm is 0.34 m wide, so the top of the figure is one square cap on one square pair of shoulders.
- **Hook:** a **tall pale rectangle beside the body**. The dawnglass pavise is 1.5 m tall and 0.62 m wide (76 px by 51 px at 1080p): a clear pane in a chalk frame, the only shield in the roster. A blued spire tip, 0.16 m, stands on its top edge and carries the accent.
- **Below the pavise:** a short spear in the right hand (shaft 6 cm thick, 1.35 m, leaf head 0.22 m) held upright, so the silhouette is a block with a tall rectangle on the left and a thin vertical on the right.
- **Size:** 119 px tall at 1080p (79 px at 720p). Aubade architecture rule: the pavise plus its spire tip is 1.66 m tall on a 0.62 m footprint, a ratio of 2.7, which reads as a standing spire window.
- **At 64 px:** a flat-topped dark block, one pale rectangle half its height again on the left, one thin line on the right. Nothing is thinner than 6 cm (5 px at 1080p).
- **Facing from above:** the visor slit and nasal ridge point forward, the pavise is on the left, the spear on the right; the spire tip is the highest point and the first thing seen.

Pairs to test first (IoU <= 0.80 at 64 px):

- **Ardit / Marund** (the other Plinth pair in the lineup): flat dome-cap over the shoulders versus a tall pavise beside the body. If IoU passes 0.80, make the pavise 0.10 m taller before touching Marund's cap.
- **Ardit / Hesmi:** a block with one pale rectangle on the left versus a block with a rack of three dark slabs on the back.
- **Ardit / Vashil** (both pale Aubade): a block with a side rectangle versus a thin line under a halo.

## 2. Proportions and shape (template 1)

- **Large class** (anchor 2.4 m): height 2.35 m, head 0.36 m (6.5 heads, measured without the helm crown). The helm adds 0.05 m.
- **Stylized heroic:** hands x1.6, forearms x1.35 (the left forearm carries the pavise, so it is the heaviest limb), boots x1.3 wide, a short neck (0.05 m) so the pauldrons rise to the visor. An upright stance: `spine_curve` 0.01.
- *Start values*, scaled from the reference breaker by 2.35 / 1.9:

```python
PROPORTIONS = rig.proportions(height=2.35, head=0.36, neck=0.05, shoulder_width=0.62, hip_width=0.25, leg=1.02,
                              thigh_frac=0.50, arm=0.74, upper_arm_frac=0.52, hand=0.26, foot=0.38,
                              ankle_height=0.12, spine_curve=0.01, stance=0.06, toe_out_deg=8.0, knee_bend=0.012)
SHAPE = body.shape(girth=1.1, torso_w=1.18, torso_d=1.08, chest=1.16, waist=1.0, hips=0.9, arm=1.15, forearm=1.4,
                   leg=0.95, calf=1.05, hand=1.6, neck=1.2, head_w=1.05, head_d=1.04, jaw=1.0, feet=False)
```

## 3. Face (template 3)

- **Aubade glass visor.** A flat-crowned helm of honed chalk (`kit.glass_visor` on a carved face-plate) with one horizontal dawnglass pane, 0.22 m wide and 8 cm tall, over ink recesses, and a nasal ridge of 4 cm that is the beak and the facing cue from above. The crown is flat and 0.34 m wide; a 2 cm chalk rim runs round it.
- No bare face, no hair, no plume; the crown is carved stone only.

## 4. Armour, cloth and props (template 4)

- **Pauldrons.** Square honed `stone` plates, 0.36 m wide each, flat on top, with a 3 cm bevel. They are the widest horizontal edge on the figure and carry the Plinth read.
- **Cuirass and tabard.** A blued painted-plate cuirass (`cloth`, matte, no gloss) under a chalk tabard that hangs to the knee in two rigid panels (one `x_tabard` bone each, at most 2 sway bones); a light linen scarf (`cloth2`) at the throat.
- **Arms and legs.** Blued vambraces, the left one carrying the pavise grip; ironstone greaves over dark leggings; heavy `leather` boots.
- **Pavise** (left forearm, `prop.L`, grip behind the pane): chalk frame 1.5 m x 0.62 m, 6 cm wide with 3 cm bevels; the pane inside is clear dawnglass 1.38 m x 0.50 m, 1.5 cm thick, glossy and never emissive. A blued spire tip, 0.16 m tall and 0.07 m wide at the base, stands on the top edge; an accent glass inlay is cut into its face. The pane keeps its transparent look from all angles (an opaque pale backing at 40% of its area keeps it from reading as a hole).
- **Spear** (right hand, `prop.R`): ash shaft 1.35 m, 6 cm thick, leaf head in dawnglass 0.22 m, a chalk collar. Carried upright at rest.

Sockets (`art.json` `sockets`; the standard set stays exactly as in the content JSON):

`origin root`, `chest chest`, `head head`, `hand_r hand.R`, `hand_l hand.L`, `weapon / weapon_r prop.R`, `weapon_l prop.L`, `foot_r foot.R`, `foot_l foot.L`, plus the extras `pavise_top x_pavise_top` (Glare's cone and Muster's beacon start here) and `spear_tip x_spear_tip` (the hit point of Lancing Run).

## 5. Palette (template 5)

Hexes are authored albedo in the bible vocabulary (`materials.bible_palette` roles). None of the reserved relationship hues (Dawn azure `#3F9CFF`, Dusk marigold `#FF9A1F`, Noonwhite `#F4EFE2`) dominates: every large-area colour is below 40% saturation inside the azure (200-225°), marigold (25-50°), heal (125-150°) and tritan (340-350°) hue bands, and no large area is lighter than L* 86. The `accent` role is authored azure; the renderer tints it per viewer.

| Role | Hex | L* | Hue / sat | Where it is used |
|---|---|---|---|---|
| `dawnglass` | `#B8D0E2` | 82 | 206° / 19% | pavise pane, helm visor, spear head |
| `chalk` | `#D2CFC6` | 83 | 45° / 6% | helm crown, pavise frame, tabard |
| `stone` | `#B4B9BE` | 75 | 210° / 5% | square pauldrons, gorget |
| `cloth2` | `#CBCAC2` | 81 | 53° / 4% | scarf |
| `cloth` | `#6F7B88` | 51 | 211° / 18% | blued cuirass, vambraces |
| `leather` | `#403C39` | 26 | 26° / 11% | boots, belt, grip wraps |
| `ironstone` | `#3D434B` | 28 | 214° / 19% | greaves, spire tip |
| `under` | `#2F3237` | 21 | 218° / 15% | leggings |
| `ink` | `#17181B` | 8 | 225° / 15% | visor recesses |
| `accent` | `#3F9CFF` | 63 | 211° / 75% | spire-tip inlay |

## 6. Value gradient (template 6)

Light head, dark feet: the bible bands measured on screen by `lineup_qa` (top quarter L* 70-85, middle 45-65, feet 20-35; at least 40% of the silhouette at rest value). The means below are area-weighted estimates of the authored albedo before the `VALUE_GRADIENT_STOPS` ramp (x0.62 at the feet to x1.06 at the crown) and the baked top light, so the on-screen top band sits a little higher.

| Band | Target L* | Mix (share of the band) | Mean L* |
|---|---|---|---|
| top quarter (crown to chest) | 70-85 | chalk 30%, stone 28%, dawnglass 16%, cloth2 10%, cloth 10%, ironstone 6% | **74** |
| middle half | 45-65 | cloth 40%, chalk 16%, leather 14%, under 10%, stone 10%, dawnglass 10% | **55** |
| feet quarter (shins down) | 20-35 | under 40%, leather 32%, ironstone 24%, cloth 4% | **25** |

The helm, the pauldrons and the pavise frame carry the top quarter; the blued cuirass and the pale pavise pane carry the middle; greaves and boots are the feet. The pane is nearly transparent in the render, so its albedo share is small: if lineup_qa shows the middle band above 65, darken the pavise backing by 3 L*.

## 7. Accent (template 7)

The spire-tip inlay, about 12 x 4 cm = 48 cm2 plus a 10 x 2 cm helm brow line (20 cm2), against roughly 14,000 cm2 of silhouette (the pavise adds a third of it): **about 0.5%** (budget 5%), 100% in the top half (the spire tip stands at about 1.7 m; the brow line is on the head). At rest the emissive is 0.8; it blooms to 1.5 or more in the wind-ups of Glare and Muster, as a warning that a disarm is coming. The tip is the highest point of the figure, so the colour is visible from any angle, including from above.

## 8. Motion (template 8)

`MOTION = anim.motion_profile(weight="heavy", weapon="one_hand", stance="wide", run_ref_speed=3.35, blocks=BLOCKS)`

`BLOCKS` (override both arm blocks, because the left arm always carries the pavise):
- **guard / idle:** the pavise grounded at the left side with its top edge leaning 8 degrees outward, the spear upright in the right hand; feet wide, weight even.
- **run:** the pavise held back and low on the left, tilted so it does not hide the legs, the spear carried upright; contact 0.34, a heavy bob of 2 cm; the tabard panels sway one bone each.
- **lobby:** the pavise angled to catch the light, the spear grounded; see below.

Four distinct ability gestures. Frame counts are multiples of 5 at 30 fps; the impact is at exactly 40% of the clip (frame = 0.4 × N). The sim's `castTime` is the windup before the effect lands; the clip's impact frame is the visual hit. A `castTime` of 0 means the effect starts at once, so the anticipation stays at 4 frames or fewer and the gesture must not hide a dash.

| Clip | Frames (impact) | Sim ability | Gesture |
|---|---|---|---|
| `cast_a1` | 20 (f8) | **Lancing Run** · castTime 0.15 s · 7 m run, stops at the first fighter, airborne 0.75 s | Two-frame crouch behind the pavise, then the charge: the pavise swings forward and the spear drops to a low horizontal thrust, shoulders driving; the lunge peaks at f8 as the sim dashes him at 16 m/s. Recover by f20 with the spear back upright. Silhouette: a battering ram, pale pane first. |
| `cast_a2` | 30 (f12) | **Glare** · castTime 0.3 s · 5 m, 70 degree cone, disarm | The left arm lifts the pavise and tilts it 35 degrees toward the sun, the spear point dropping to guard; at f12 the pane catches the light (the accent blooms in the wind-up, f0-f12) and the cone releases. The right hand flicks open as if sprinkling light. Silhouette: the pale rectangle swings from vertical to a sail. |
| `cast_a3` | 25 (f10) | **Spire Strike** · castTime 0.25 s · 2.5 m slam, slow | The pavise lifts edge-first overhead in the left hand (the spire tip pointing down), the knees bend, and at f10 he drives the spire tip into the ground, the pane trembling but staying rigid. Recover to guard by f25. Silhouette: a tall pale T, then a stake. |
| `cast_ult` | 40 (f16) | **Muster** · castTime 0.35 s · 5 s beacon, aura, disarm edge | He plants the pavise upright in front of him and steps behind it, both hands rising to its frame (the spear laid across his shoulder, held by the crook of the arm); at f16 the accent flares along the spire tip and the whole figure stands tall and still. Hold f16-f30, then lower to guard. Silhouette: a pale spire with a figure behind it. |

Other clips: `run` at 3.35 m/s (heavy, foot slide under 8%); `attack1` a spear thrust, `attack2` a pavise bash with the left arm (both 25 frames, impact f10); `death` drops to one knee behind the pavise, which falls forward flat, and he sinks onto his side (ends at rest); `recall` stands the pavise up, folds both hands on the spear and bows his head; `stunned` staggers with the pavise slipping; `dash` is the charge loop with the pavise forward; `taunt` raps the spear shaft twice on the pavise frame (a clear glass note).

**`idle_lobby`** (loops, closed first = last pose): Patient and courteous. He stands behind the pavise, turns it a few degrees to catch the light, wipes a smudge from the pane with his cuff, glances over the top at the camera and gives a small apologetic nod, then settles his weight and lets the pavise lean. He never raises the spear. 120 frames.

**`victory`** (ends in a hold): He steps out from behind the pavise for the first time, plants it, and tilts it so the sun passes across his visor. Final hold: the pavise planted at the left, the spear grounded at the right, chin up, the visor catching the light, a quarter turned from the camera: a wall that has turned to face the morning. 50 frames, then the hold.

## 9. Skins (template 9)

Palette swaps plus optional extra geometry read from `ctx.skin["extra"]`. Every skin keeps the rig, clips, silhouette class (height ±5%, footprint ±10%), accent locations and value gradient; none adds metal, a single saturated full-body colour, or a reserved hue above 40% saturation. Names, tiers and descriptions come from `content/skins/ardit.json`. The named hex is the identity colour of the skin: where it falls outside a band's L* range, the surface steps lighter or darker by band and the identity hex is used at its own band.

### `ardit_base`: Ardit (base)

Points at the base files (`assets/fighters/ardit/ardit.glb`). The palette is section 5.

### `ardit_chalkline`: Chalkline Pavise (standard)

*"Ink-grey steel with chalk line-work drawn across the pavise frame, in the style of the Aubade chalk drawings. The glass stays clear."*

Ink-grey armour (`#3A3F47`, matte painted, non-metal) with chalk line-work (`#E6E0D2`) drawn across the pavise frame and tabard, in lines at most 1 cm wide so that no area reads as Noonwhite, covering at most 20% of the surface. The ink-grey is the deep tone (greaves, boots, vambraces); the pauldrons and the helm step lighter so the top quarter holds its value. The pane stays clear: no tint, no etching. **No extra geometry.**

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `chalk` | `#BDBFC2` | 77 | 216° / 3% | helm crown and frame, lighter ink-grey |
| `stone` | `#B9BEC4` | 77 | 213° / 6% | pauldrons |
| `cloth` | `#7A828D` | 54 | 215° / 13% | cuirass, mid ink-grey |
| `ironstone` | `#3A3F47` | 26 | 217° / 18% | the named ink-grey #3A3F47 (greaves, spire tip) |
| `under` | `#2E3238` | 21 | 216° / 18% | leggings |
| `linework` | `#E6E0D2` | 89 | 42° / 9% | chalk line-work (thin lines only, at most 20% of the surface; exempt from the L* 86 area rule) |

Value bands (area-weighted): top **73** (70-85) · mid **56** (45-65) · feet **25** (20-35).

`SKINS` entry: `{"id": "ardit_chalkline", "palette": {...as above...}, "extra": {}, "card": {"primary": "#3A3F47", "secondary": "#E6E0D2"}}`

### `ardit_first_bell`: First Bell Pavise (deluxe)

*"The pavise is etched with ten hour-marks, one for each seat of the Shadowless Noon, over pale dial-stone armour and dark greaves."*

The FRAY winners' honour: the pavise frame is etched with ten hour-marks (a carved texture, 2 mm deep, not emissive), the armour is pale dial-stone and the greaves are dark, which keeps the value gradient steep. **Extra geometry:** a small glass bell, 0.08 m tall with a rigid 3 cm bail, hung above the spire tip (the +5% height limit is 0.12 m; the bell stays inside it and duller than the accent inlay).

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `chalk` | `#D8D2C4` | 84 | 42° / 9% | frame and helm, warm dial-stone |
| `stone` | `#CFC8BA` | 81 | 40° / 10% | pale dial-stone pauldrons |
| `cloth` | `#8D8A84` | 58 | 40° / 6% | cuirass, pale dial-stone grey |
| `ironstone` | `#38363A` | 23 | 270° / 7% | dark greaves and vambraces |
| `leather` | `#3A332D` | 22 | 28° / 22% | boots, dark |
| `under` | `#34322F` | 21 | 36° / 10% | leggings, dark |

Value bands (area-weighted): top **76** (70-85) · mid **58** (45-65) · feet **23** (20-35).

`SKINS` entry: `{"id": "ardit_first_bell", "palette": {...as above...}, "extra": {"bell": True}, "card": {"primary": "#4A4640", "secondary": "#D8D2C4"}}`

## 10-11. Export and renders

- Splash: `SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "yaw": 22.0}`. The planted pavise stands on the left of the frame and catches the low sun from behind-left; the visor looks into the frame, clear of the UI side.
- Portrait (512 square, `idle_lobby` t 0, yaw 28): the helm, the visor and the top of the pavise with its spire tip. Icon (128 square): the visor slit under the flat crown, the spire tip on the edge.
- GLB budget 10-25k tris and at most 1.2 MB, base and both skins.

## Per-fighter checks (on top of the template checklist)

- [ ] The shoulders are at least 1.4 times the hips, the crown is flat, and the pavise reads as a tall pale rectangle in black at 64 px.
- [ ] IoU against Marund and Hesmi <= 0.80; the pavise never hides both legs from the camera (check the run clip).
- [ ] The pavise is rigid and moves only with the left arm; the tabard panels use one bone each.
- [ ] The accent inlay is the only emissive material; the pane never glows and the bell on the first_bell skin is duller than the accent.
- [ ] `cast_a1` has at most 3 frames of anticipation before the charge (castTime 0.15), and the pavise stays in front of the body during the dash.
