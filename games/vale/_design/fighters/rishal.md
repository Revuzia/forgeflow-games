# Rishal · Striker: art brief

`rishal` · Aubade (he) · standard (anchor 1.9 m, authored at 1.8 m) · 1.8 m · res_heat · melee 1.7 m phys · difficulty 3

> Source of truth: `_design/ROSTER.md` §3 entry 3, `content/fighters/rishal.json`, `content/skins/rishal.json`. Look law: `STYLE_BIBLE.md` (Fighters, Look rules), `_design/tokens.json` `fighter`, `WORLD.md` §2 (faces). Pipeline: `CONTRACT.md` §12, `art/README.md` and `art/blender/fighters/_template.py`; the section numbers below follow the template's 0-11. Art authors the numbers marked *start value*; the `lineup_qa` / three QA measurements decide.

Banned for every fighter: gears, clock hands, gold filigree, gems, glowing runes, metallic bevels, teal-and-gold, red-versus-green. Every material is non-metallic (metalness 0): "iron" and "steel" mean matte, painted, oxidised-looking stone or ironstone, never a bright edge. Only the `accent` material emits; dawnglass and lampresin are glossy but never emissive.

## 0. Brief

| Field | Value |
|---|---|
| `ID` (file name = content id) | `rishal` |
| `TITLE` (collection title, never an epithet) | Glass runner |
| `ROLE_MASS` | `striker` (Striker; `class_striker`) |
| `ORIGIN` | `aubade`: glass visor |
| Fight job | Cuts lines of glass through the back line and is gone before anyone can answer. |
| Positions | `dialcross` / `grovehunter` · bot `diver`, preferred range 2 m |
| Height | **1.8 m** (class: standard (anchor 1.9 m, authored at 1.8 m)); 91 px at 1080p, 61 px at 720p (vertical px = 50.5 × height m; horizontal 82.1 px per m) |
| `art.height` / `collisionRadius` / `moveSpeed` | 1.8 m / 0.5 m / 3.55 m/s: author `run` for **3.55 m/s** (`runRefSpeed`); the content JSON still carries the 3.6 placeholder until `art.json` is copied back |
| Weapon + motion | two dawnglass knives, `dual`, carried in a reverse grip along the forearms; weight `light`, stance `low`. |
| `CARD` = `FighterDef.palette` | primary `#9AA6B4` · secondary `#D9D4C8` (collection and draft backdrops; already in the JSON) |
| Kit (for the body notes) | passive **Split Glass** · a1 **Glass Dash** · a2 **Glint Cut** · a3 **Feint** · ult **Long Glint** |

## 1. Silhouette at 96 px

- **Mass: Striker, forward diagonal.** A narrow body (shoulders 0.42 m, hips 0.30 m) leaning 10 degrees in `idle` and 15 degrees in `run`, with every long form swept backward at 25-30 degrees. Asymmetric points: a long left pauldron spike (0.30 m, angled up and back) and a short right plate.
- **Hook:** a swept comb of backward strokes. Two hard gull-grey crest plates (each at least 30 cm, 36 cm authored, carved stone, rigid) sweep back from the blade-shaped dawnglass visor, and two reversed glass knives jut 0.18 m behind the elbows. Four parallel diagonals trail behind a clean front: the silhouette points where he is going.
- **Size:** crest 36 cm = 30 px of horizontal sweep at 1080p; each knife blade 42 cm = 34 px; the whole figure is 91 px tall at 1080p (61 px at 720p), the smallest of half A except Ilsheta.
- **At 64 px:** a narrow leaning figure with a spiky back edge and a single long left shoulder spike; no element wider than the shoulders in front.
- **Facing from above:** the visor's blade tip points forward, the left pauldron spike is on the left, and the crest runs back along the spine.

Pairs to test first (IoU <= 0.80 at 64 px):

- **Rishal / Kemdo:** lean 15 degrees with a spiky back edge versus an upright inverted wedge with a tall pole.
- **Rishal / Burdam:** narrow leaning figure versus a wide wedge.
- **Rishal / Nurrow** (half B Striker): the other forward diagonal; test once Nurrow's model exists, and if IoU passes 0.80 swap which shoulder carries the long spike.

## 2. Proportions and shape (template 1)

- **Standard class**, light end: height 1.80 m, head 0.285 m (6.3 heads). Long legs for a runner (0.88 m of the 1.80 m is leg).
- **Stylized heroic:** hands x1.45 (the knife hands read), boots x1.2 wide with a low wedge heel, narrow waist, a long neck (0.07 m) so the visor and crest sweep clear of the pauldrons.
- *Start values:*

```python
PROPORTIONS = rig.proportions(height=1.80, head=0.285, neck=0.07, shoulder_width=0.42, hip_width=0.19, leg=0.88,
                              thigh_frac=0.50, arm=0.60, upper_arm_frac=0.52, hand=0.20, foot=0.30,
                              ankle_height=0.09, spine_curve=0.02, stance=0.035, toe_out_deg=6.0, knee_bend=0.02)
SHAPE = body.shape(girth=0.94, torso_w=0.96, torso_d=0.95, chest=0.98, waist=0.88, hips=0.94, arm=0.95, forearm=1.1,
                   leg=0.92, calf=1.0, hand=1.45, neck=1.2, head_w=1.05, head_d=1.04, jaw=1.0, feet=False)
```

## 3. Face (template 3)

- **Aubade glass visor.** One blade-shaped dawnglass pane (`kit.glass_visor`), 0.20 m long, curving from the brow to the cheek over a carved chalk face-plate with ink almond recesses behind the glass. The visor's tip is the beak: it points forward and is the facing cue from above. A top ridge fin runs along the visor's upper edge and back into the crest root; the ridge carries the accent.
- No bare face, no hair; the crest is carved stone plates, not feathers or hair cards.

## 4. Armour, cloth and props (template 4)

- **Crest.** Two stone plates in gull-grey (`chalk`), each 36 cm long, 9 cm wide at the root, 2-4 cm bevels, stacked 6 cm apart and swept back at 28 degrees; rigid, bound to the head bone.
- **Pauldrons.** Asymmetric honed `stone` plates: left 0.20 m wide with a 0.30 m spike angled up and back; right 0.16 m wide and round. A chalk gorget below the visor.
- **Torso.** A short cool-slate tabard (`cloth`) over a close under-suit, a leather chest strap, a scarf of light linen (`cloth2`) knotted behind (rigid, one-bone `x_scarf`, a short 0.25 m panel). Forearm guards of honed stone, the reverse-grip knives mounted along their outer sides.
- **Legs.** Close dark leggings (`under`), ironstone shin plates, light boots with a wedge heel (`leather`).
- **Props: two knives** (prop space: grip at the origin, blade -Z for reverse grip). Dawnglass blade 0.42 m long, 5 cm wide, 1.5 cm thick, 2 cm bevels along both edges (glossy, never emissive, no bright edge); leather-wrapped hilt 0.12 m, an ironstone guard. The blade is long enough to read as a spike behind the elbow.

Sockets (`art.json` `sockets`; the standard set stays exactly as in the content JSON):

`origin root`, `chest chest`, `head head`, `hand_r hand.R`, `hand_l hand.L`, `weapon / weapon_r prop.R`, `weapon_l prop.L`, `foot_r foot.R`, `foot_l foot.L`, plus the extras `knife_tip_r x_knife_tip_r` and `knife_tip_l x_knife_tip_l` (where Glass Dash and Feint lay their tracks) and `visor_ridge x_visor_ridge` (the accent fin).

## 5. Palette (template 5)

Hexes are authored albedo in the bible vocabulary (`materials.bible_palette` roles). None of the reserved relationship hues (Dawn azure `#3F9CFF`, Dusk marigold `#FF9A1F`, Noonwhite `#F4EFE2`) dominates: every large-area colour is below 40% saturation inside the azure (200-225°) and marigold (25-50°) hue bands, and no large area is lighter than L* 86. The `accent` role is authored azure; the renderer tints it per viewer.

| Role | Hex | L* | Hue / sat | Where it is used |
|---|---|---|---|---|
| `dawnglass` | `#B9D0E2` | 82 | 206° / 18% | visor pane, knife blades |
| `chalk` | `#CDCECB` | 83 | 80° / 1% | gull-grey crest plates, gorget, face-plate |
| `stone` | `#B5B9BD` | 75 | 210° / 4% | pauldrons (long left spike), forearm guards |
| `cloth2` | `#CCCCC4` | 82 | 60° / 4% | scarf, collar |
| `cloth` | `#74808C` | 53 | 210° / 17% | cool-slate tabard and under-suit |
| `leather` | `#403D3B` | 26 | 24° / 8% | chest strap, boots, hilt wraps |
| `ironstone` | `#3E4146` | 27 | 218° / 11% | shin plates, knife guards |
| `under` | `#33363B` | 23 | 218° / 14% | leggings |
| `ink` | `#17181B` | 8 | 225° / 15% | visor recesses behind the glass |
| `accent` | `#3F9CFF` | 63 | 211° / 75% | the visor ridge fin |


## 6. Value gradient (template 6)

Light head, dark feet: the bible bands measured on screen by `lineup_qa` (top quarter L* 70-85, middle 45-65, feet 20-35; at least 40% of the silhouette at rest value). The means below are area-weighted estimates of the authored albedo before the `VALUE_GRADIENT_STOPS` ramp (x0.62 at the feet to x1.06 at the crown) and the baked top light, so the on-screen top band sits a little higher.

| Band | Target L* | Mix (share of the band) | Mean L* |
|---|---|---|---|
| top quarter (crown to chest) | 70-85 | chalk 28%, stone 28%, cloth2 14%, dawnglass 12%, cloth 10%, leather 4%, ironstone 4% | **73** |
| middle half | 45-65 | cloth 48%, leather 16%, under 12%, stone 10%, dawnglass 8%, cloth2 6% | **51** |
| feet quarter (shins down) | 20-35 | under 46%, leather 30%, ironstone 20%, cloth 4% | **26** |

The crest, the visor and the pauldron spike carry the top quarter (L* 73); the slate tabard is the middle (L* 51); dark leggings and boots are the feet. The knife blades are dawnglass (L* 82) but sit in the middle band along the forearms, which keeps the mid mean at 51 without a bright stripe: if lineup_qa flags the blades as the brightest mid-band value, tint them 3 L* darker.

## 7. Accent (template 7)

The visor ridge fin, about 30 x 6 cm = 180 cm2 against roughly 9,900 cm2 of silhouette: **about 1.8%** (budget 5%), 100% in the top half (all on the head). At rest the emissive is 0.8; it blooms to 1.5 or more only in the wind-up of Long Glint, as a warning that the 9 m rush is coming. The ridge is on top of the head, so a viewer sees the colour from any angle, including from above.

## 8. Motion (template 8)

`MOTION = anim.motion_profile(weight="light", weapon="dual", stance="low", run_ref_speed=3.55, blocks=BLOCKS)`

`BLOCKS` (override both arm blocks, because each hand holds a knife):
- **guard / idle:** both knives reversed, forearms close to the ribs, blades pointing back; weight on the front foot, the lean at 10 degrees, knees bent (`stance` low).
- **run:** a sprinter's arms, the knives trailing, the lean at 15 degrees; contact 0.28, light bob; the crest and the scarf stay rigid.
- **lobby:** the right knife spinning in the hand (see below), the left hand on the hip.

Four distinct ability gestures. Frame counts are multiples of 5 at 30 fps; the impact is at exactly 40% of the clip (frame = 0.4 × N). The sim's `castTime` is the windup before the effect lands; the clip's impact frame is the visual hit. A `castTime` of 0 means the effect starts at once, so the anticipation stays at 4 frames or fewer and the gesture must not hide a dash.

| Clip | Frames (impact) | Sim ability | Gesture |
|---|---|---|---|
| `cast_a1` | 15 (f6) | **Glass Dash** · castTime 0 s · 5 m dash, track laid, 2 charges | Instant (castTime 0): a 3-frame crouch with both knives dragged back, then the sprint; the lean peaks at 35 degrees at f6 while the sim dashes him at 16 m/s, the knife tips skimming the ground behind (the track). Follow-through is the optional `dash` clip (a loop of the sprint pose). Silhouette: a long low diagonal. |
| `cast_a2` | 25 (f10) | **Glint Cut** · castTime 0.15 s · two slashes, 0.2 s apart | A crossing X: the right knife cuts outward at f10 (the impact), the left follows at f16 (0.2 s later is 6 frames), the shoulders snapping 40 degrees each way; anticipation 4 frames, recover by f25. Silhouette: both arms flick wide, then close. |
| `cast_a3` | 20 (f8) | **Feint** · castTime 0 s · spring 4 m away, lay a track | Instant: a head fake, the right shoulder dropping into a false lunge for 3 frames, then he springs backward; the body arcs back, knives spread wide, one foot leaving the ground, the apex at f8 (the impact is the peak of the arc) and a landing at f14 with knees bent. Recover to guard by f20. Silhouette: a backward-leaning arc, the knives as two wings. |
| `cast_ult` | 35 (f14) | **Long Glint** · castTime 0.2 s · 9 m unstoppable rush, 3 Cuts, track | A still coil: knees low, both knives crossed at the chest and pointing backward, the head down (f0-f6, a held pose that does not freeze: the shoulders breathe). At f14 the burst: full extension, the body near-horizontal, both knives forward and low, one on each side of the line. Hold the skid f14-f26 while the sim rushes him 9 m, then rise. Silhouette: a coiled comb, then a spear. |

Other clips: `run` at 3.55 m/s (light, foot slide under 8%); `attack1` a quick right-knife jab, `attack2` a left-knife slash (both 20 frames, impact f8); `death` a spin and fall onto his back with the knives flung wide (ends at rest); `recall` presses the two knives together and bows his head; `stunned` stumbles on his heels; the optional `dash` is the sprint loop; `taunt` flips a knife and catches it.

**`idle_lobby`** (loops, closed first = last pose): Restless and quick. He bounces on his toes, flips the right knife once around his finger (a rigid prop: no sway), glances back over his shoulder as if someone is following, taps the left boot twice, and rolls his neck so the crest swings. He never stands still for more than a second. 90 frames.

**`victory`** (ends in a hold): He skids to a stop and drops to a knee, draws a short chalk line on the ground with the knife's glass tip, rises, and flicks the knife once. Final hold: arms crossed behind him with the knives pointing back, chin up, turned a quarter away from the camera: a runner at the finish line. 45 frames, then the hold.

## 9. Skins (template 9)

Palette swaps plus optional extra geometry read from `ctx.skin["extra"]`. Every skin keeps the rig, clips, silhouette class (height ±5%, footprint ±10%), accent locations and value gradient; none adds metal, a single saturated full-body colour, or a reserved hue above 40% saturation. Names, tiers and descriptions come from `content/skins/rishal.json`. The named hex is the identity colour of the skin: where it falls outside a band's L* range, the surface steps lighter or darker by band and the identity hex is used at its own band.

### `rishal_base`: Rishal (base)

Points at the base files (`assets/fighters/rishal/rishal.glb`). The palette is section 5.

### `rishal_chalkline`: Chalkline Runner (standard)

*"Ink-grey steel drawn over with chalk line-work, the way Aubade children sketch runners on the spire walls."*

Ink-grey armour (`#3A3F47`, matte painted, non-metal) drawn over with chalk line-work (`#E6E0D2`, in lines at most 1 cm wide so that no area reads as Noonwhite, covering at most 20% of the surface) and a feather crest in `#A7A9AC`. The ink-grey is the deep tone (shins, boots, recesses); the pauldrons and chest step lighter so the top quarter holds its value, and the line-work (children's runner sketches: stick figures, speed lines, a sun) is texture only. **No extra geometry.**

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `chalk` | `#A7A9AC` | 69 | 216° / 3% | the named crest #A7A9AC |
| `stone` | `#BAC0C6` | 77 | 210° / 6% | pauldrons, lighter ink-grey |
| `cloth2` | `#C9C9C1` | 81 | 60° / 4% | scarf |
| `cloth` | `#7B8390` | 55 | 217° / 15% | tabard, mid ink-grey |
| `ironstone` | `#3A3F47` | 26 | 217° / 18% | the named ink-grey #3A3F47 (shins, guards) |
| `under` | `#2E3238` | 21 | 216° / 18% | leggings |
| `linework` | `#E6E0D2` | 89 | 42° / 9% | chalk line-work (thin lines only, at most 20% of the surface; exempt from the L* 86 area rule) |

Value bands (area-weighted): top **73** (70-85) · mid **52** (45-65) · feet **25** (20-35).

`SKINS` entry: `{"id": "rishal_chalkline", "palette": {...as above...}, "extra": {}, "card": {"primary": "#3A3F47", "secondary": "#E6E0D2"}}`

### `rishal_lamplit`: Lamplit Visor (deluxe)

*"A smoked lampresin visor and walnut armour borrowed from the evening side, with a small lamp cage on the crest."*

A smoked-lampresin visor (`#A38C6B`) and walnut armour (`#5E4D3E`), both at no more than 35% saturation, borrowed from the evening side. The walnut `#5E4D3E` is the leather and strap tone (L* 34, so it sits in the feet band and on the thin chest strap); the guards go darker and the pauldrons, crest and chest step lighter. **Extra geometry:** a small lamp cage on the crest's front plate, an open cage of four carved-wood slats around a lampresin bead, at most 0.08 m tall (the +5% height limit is 0.09 m); the accent ridge on the visor is unchanged and the cage must stay duller than it.

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `dawnglass` | `#A38C6B` | 60 | 35° / 34% | the named smoked-lampresin visor #A38C6B (still glass: glossy, not emissive) |
| `chalk` | `#D5CDBF` | 83 | 38° / 10% | crest plates, pale |
| `stone` | `#BFB09A` | 73 | 36° / 19% | walnut-light pauldrons and guards |
| `cloth2` | `#D8D0C0` | 84 | 40° / 11% | scarf |
| `cloth` | `#8B7A68` | 52 | 31° / 25% | warm tabard |
| `leather` | `#5E4D3E` | 34 | 28° / 34% | the named walnut #5E4D3E (strap, boots) |
| `ironstone` | `#3F3730` | 24 | 28° / 24% | walnut-dark forearm guards and shin plates |
| `under` | `#3A332D` | 22 | 28° / 22% | leggings |

Value bands (area-weighted): top **71** (70-85) · mid **50** (45-65) · feet **27** (20-35).

`SKINS` entry: `{"id": "rishal_lamplit", "palette": {...as above...}, "extra": {"lamp_cage": True}, "card": {"primary": "#4A4036", "secondary": "#A38C6B"}}`

## 10-11. Export and renders

- Splash: `SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "yaw": 22.0}`. The arms-crossed-behind hold keeps the crest and the knives sweeping toward screen-right, away from the UI side; the visor tip points into the frame.
- Portrait (512 square, `idle_lobby` t 0, yaw 28): the visor and the crest in profile with the left pauldron spike entering the frame. Icon (128 square): the visor blade and the ridge fin.
- GLB budget 10-25k tris and at most 1.2 MB, base and both skins.

## Per-fighter checks (on top of the template checklist)

- [ ] The figure leans 10 degrees in `idle` and 15 degrees in `run` (measure the chest axis), and the backward comb reads in black at 64 px.
- [ ] IoU against Kemdo and Burdam <= 0.80; the left shoulder spike is visible from the camera side.
- [ ] Both crest plates are at least 30 cm long and rigid; the scarf is one bone.
- [ ] The knife blades never become the brightest mid-band pixels; the accent ridge is the only emissive material.
- [ ] `cast_a1` and `cast_a3` have at most 4 frames of anticipation (castTime 0): the dash must not be hidden by a long wind-up.
