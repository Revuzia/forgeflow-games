# Ilsheta · Tender: art brief

`ilsheta` · Aubade (she) · compact, tall end (anchor 1.6 m, authored at 1.72 m) · 1.72 m · res_light · ranged 5.4 m magic · difficulty 1

> Source of truth: `_design/ROSTER.md` §3 entry 6, `content/fighters/ilsheta.json`, `content/skins/ilsheta.json`. Look law: `STYLE_BIBLE.md` (Fighters, Look rules), `_design/tokens.json` `fighter`, `WORLD.md` §2 (faces). Pipeline: `CONTRACT.md` §12, `art/README.md` and `art/blender/fighters/_template.py`; the section numbers below follow the template's 0-11. Art authors the numbers marked *start value*; the `lineup_qa` / three QA measurements decide.

Banned for every fighter: gears, clock hands, gold filigree, gems, glowing runes, metallic bevels, teal-and-gold, red-versus-green. Every material is non-metallic (metalness 0): "iron" and "steel" mean matte, painted, oxidised-looking stone or ironstone, never a bright edge. Only the `accent` material emits; dawnglass and lampresin are glossy but never emissive.

## 0. Brief

| Field | Value |
|---|---|
| `ID` (file name = content id) | `ilsheta` |
| `TITLE` (collection title, never an epithet) | Lamp hanger |
| `ROLE_MASS` | `tender` (Tender; `class_tender`) |
| `ORIGIN` | `aubade`: glass visor |
| Fight job | Hangs a healing lamp on the ally in the most trouble; the light follows them wherever they run. |
| Positions | `lampglass` · bot `sustain`, preferred range 6 m |
| Height | **1.72 m** (class: compact, tall end (anchor 1.6 m, authored at 1.72 m)); 87 px at 1080p, 58 px at 720p (vertical px = 50.5 × height m; horizontal 82.1 px per m) |
| `art.height` / `collisionRadius` / `moveSpeed` | 1.72 m / 0.5 m / 3.35 m/s: author `run` for **3.35 m/s** (`runRefSpeed`); the content JSON still carries the 3.6 placeholder until `art.json` is copied back |
| Weapon + motion | a dawnglass lamp held at the chest on a short hook-staff, `focus`; weight `light`, stance `neutral`. |
| `CARD` = `FighterDef.palette` | primary `#C9D3D6` · secondary `#E8E2D2` (collection and draft backdrops; already in the JSON) |
| Kit (for the body notes) | passive **Warm Hands** · a1 **Glint Bolt** · a2 **Hung Lamp** · a3 **Dawnglass Shell** · ult **Every Window Lit** |

## 1. Silhouette at 96 px

- **Mass: Tender, round with a light vessel.** A bell-shaped hooded linen mantle (widest at the hips, 0.78 m, arms held a little away from the body: an open stance) carrying a lamp at the chest.
- **Hook:** the chimney visor, a tall clear cylinder 0.30 m high and 0.14 m wide on top of the head, flaring at the cheek and narrowing at the crown like a lamp chimney. It is the brightest vertical on the figure (11 px wide, 15 px tall at 1080p). The accent is the lamp core at the chest.
- **Size:** the figure is 87 px tall at 1080p (58 px at 720p), the smallest of half A; the lamp (0.20 m, 16 px) hangs at 1.20 m on the hook-staff.
- **At 64 px:** a round bell with a small bright vertical cap, a lighter patch at the chest (the lamp), and a thin hook-staff diagonal on the right. No hard corners anywhere.
- **Facing from above:** the chimney's flare points forward (the visor beak), the mantle opens at the front to show the lamp, and the hook-staff is on the right.

Pairs to test first (IoU <= 0.80 at 64 px):

- **Ilsheta / Sukri** (half B Tender): a vertical chimney visor over a bell mantle versus a wide hood with a low cup.
- **Ilsheta / Dunsom:** a round open bell with a chimney versus a tall thin line with a flat disc.
- **Ilsheta / Marund:** a round soft bell versus a hard-edged block with a flat disc.

## 2. Proportions and shape (template 1)

- **Compact class, tall end**: height 1.72 m, head 0.27 m (6.4 heads, measured with the chimney visor's glass, not above it). Light and rounded: a longer torso than leg for the mantle's bell.
- **Stylized heroic:** hands x1.45 (they carry the lamp), boots x1.2 wide, a round open stance (feet 0.07 m apart more than the standard stance).
- *Start values:*

```python
PROPORTIONS = rig.proportions(height=1.72, head=0.27, neck=0.06, shoulder_width=0.40, hip_width=0.21, leg=0.78,
                              thigh_frac=0.50, arm=0.56, upper_arm_frac=0.52, hand=0.19, foot=0.28,
                              ankle_height=0.085, spine_curve=0.02, stance=0.06, toe_out_deg=8.0, knee_bend=0.012)
SHAPE = body.shape(girth=1.0, torso_w=1.0, torso_d=1.02, chest=1.0, waist=0.96, hips=1.04, arm=0.95, forearm=1.1,
                   leg=0.92, calf=1.0, hand=1.45, neck=1.2, head_w=1.06, head_d=1.04, jaw=1.0, feet=False)
```

## 3. Face (template 3)

- **Aubade glass visor, shaped like a lamp chimney.** One tall dawnglass pane (`kit.glass_visor` stretched to a chimney: 0.30 m high, 0.14 m wide, flaring to 0.18 m at the cheek) over a carved chalk face-plate with ink almond recesses and a beak keel inside the glass. The flare at the cheek points forward: it is the facing cue from above. Glass is glossy and never emissive.
- A heavy linen hood frames the chimney (rigid, `kit.hood`); no bare face, no hair.

## 4. Armour, cloth and props (template 4)

- **Mantle.** Heavy hooded linen (`cloth2` above, `cloth` below) in a bell, sculpted folds (5 folds, 2 cm deep), open at the front. The two front panels hang on two one-bone chains (`x_mantle_l`, `x_mantle_r`: two sway bones in total); the back panel is fixed to the spine. The hem fades to `cloth3` (dark slate) for the feet band.
- **Under-dress and legs.** A close dress (`cloth`), dark leggings (`under`), plain leather boots with ironstone toe caps, a leather belt with a hook where the lamp hangs when not held.
- **Prop: the hook-staff** (prop space: grip at the origin, shaft +Z, length 0.95 m). Pale carved ash (`wood`), a hook at the top bending forward 0.12 m with 2-4 cm bevels.
- **Lamp.** A dawnglass body 0.14 m across and 0.22 m tall (glossy, not emissive) in a chalk top ring and base ring (honed stone), hung from the hook; an `accent` core, a flame-shaped inlay 12 x 18 cm, sits inside the glass. The lamp hangs at 1.20 m (70% of the height) in `idle`.

Sockets (`art.json` `sockets`; the standard set stays exactly as in the content JSON):

`origin root`, `chest chest`, `head head`, `hand_r hand.R`, `hand_l hand.L`, `weapon / weapon_r prop.R`, `weapon_l prop.L`, `foot_r foot.R`, `foot_l foot.L`, plus the extras `weapon_tip x_lamp` (the origin of Glint Bolt and the Hung Lamp release) and `visor_top x_chimney_top` (the Every Window Lit glow).

## 5. Palette (template 5)

Hexes are authored albedo in the bible vocabulary (`materials.bible_palette` roles). None of the reserved relationship hues (Dawn azure `#3F9CFF`, Dusk marigold `#FF9A1F`, Noonwhite `#F4EFE2`) dominates: every large-area colour is below 40% saturation inside the azure (200-225°) and marigold (25-50°) hue bands, and no large area is lighter than L* 86. The `accent` role is authored azure; the renderer tints it per viewer.

| Role | Hex | L* | Hue / sat | Where it is used |
|---|---|---|---|---|
| `dawnglass` | `#C0D6E8` | 85 | 207° / 17% | chimney visor, lamp glass |
| `cloth2` | `#CCCAC1` | 81 | 49° / 5% | hooded mantle upper half, collar |
| `chalk` | `#D4CEBF` | 83 | 43° / 10% | face-plate, lamp rings |
| `cloth` | `#8A959D` | 61 | 205° / 12% | mantle lower half, under-dress |
| `cloth3` | `#566068` | 40 | 207° / 17% | mantle hem (darker slate) |
| `wood` | `#B9A284` | 68 | 34° / 29% | the hook-staff (pale ash) |
| `leather` | `#4C443E` | 29 | 26° / 18% | belt, boots |
| `under` | `#40444A` | 29 | 216° / 14% | leggings |
| `ironstone` | `#47443F` | 29 | 37° / 11% | toe caps |
| `ink` | `#17181B` | 8 | 225° / 15% | face-plate recesses behind the glass |
| `accent` | `#3F9CFF` | 63 | 211° / 75% | the lamp core |

Nothing here is saturated: the cool glass is at most 19% saturation and the linen is under 6%. The mantle (L* 81) is the lightest large area on any half-A fighter but stays below the near-white limit (L* 86) so it never reads as Noonwhite.

## 6. Value gradient (template 6)

Light head, dark feet: the bible bands measured on screen by `lineup_qa` (top quarter L* 70-85, middle 45-65, feet 20-35; at least 40% of the silhouette at rest value). The means below are area-weighted estimates of the authored albedo before the `VALUE_GRADIENT_STOPS` ramp (x0.62 at the feet to x1.06 at the crown) and the baked top light, so the on-screen top band sits a little higher.

| Band | Target L* | Mix (share of the band) | Mean L* |
|---|---|---|---|
| top quarter (crown to chest) | 70-85 | cloth2 52%, dawnglass 14%, cloth 14%, chalk 8%, wood 6%, leather 6% | **75** |
| middle half | 45-65 | cloth 60%, leather 12%, cloth2 10%, chalk 6%, dawnglass 6%, wood 6% | **62** |
| feet quarter (shins down) | 20-35 | under 44%, leather 32%, ironstone 12%, cloth3 12% | **30** |

The pale mantle and the chimney carry the top quarter (L* 75); the lower mantle is a cool slate (L* 61, near the top of the middle range, so watch it: the mid mean is 62 against a 65 ceiling); the hem, leggings and boots are the feet band. If the middle band measures over 65, darken `cloth` by 4 L* rather than the top band.

## 7. Accent (template 7)

The lamp core, a flame-shaped inlay 12 x 18 cm = 216 cm2 against roughly 12,000 cm2 of silhouette: **about 1.8%** (budget 5%), in the top half (the lamp hangs at 1.20 m; it rises to 1.5 m in `cast_a2` and `cast_ult`). At rest the emissive is 0.8; it blooms to 1.5 or more only in the wind-up of Every Window Lit (she lights the lamp before she lights every window). The lamp hangs in front of the chest, so the colour reads from the front and the sides, and the chimney's glass does not hide it.

## 8. Motion (template 8)

`MOTION = anim.motion_profile(weight="light", weapon="focus", stance="neutral", run_ref_speed=3.35, blocks=BLOCKS)`

`BLOCKS`:
- **guard / idle:** the hook-staff in the right hand at the chest with the lamp hanging in front of it, the left hand under the lamp's base as if steadying it; the shoulders sway 2 degrees.
- **run_fwd / run_back:** the lamp held close to the chest in both hands, a light quick stride (contact 0.28); the mantle panels trail rigidly.
- **lobby:** the lamp lifted to eye level in both hands.

Four distinct ability gestures. Frame counts are multiples of 5 at 30 fps; the impact is at exactly 40% of the clip (frame = 0.4 × N). The sim's `castTime` is the windup before the effect lands; the clip's impact frame is the visual hit. A `castTime` of 0 means the effect starts at once, so the anticipation stays at 4 frames or fewer and the gesture must not hide a dash.

| Clip | Frames (impact) | Sim ability | Gesture |
|---|---|---|---|
| `cast_a1` | 25 (f10) | **Glint Bolt** · castTime 0.25 s · 9 m bolt, slow 25% | The right arm thrusts the hook-staff forward with the lamp at arm's length while the left hand flicks the lamp's shutter; at f10 the light spits (the bolt leaves the lamp). Hold the arm to f16, then draw it back and recover to guard by f25. Silhouette: one long arm with the lamp at the end. |
| `cast_a2` | 30 (f12) | **Hung Lamp** · castTime 0.2 s · lamp on an ally within 8 m, 4 s | She lifts the lamp off the hook with the left hand and hangs it on an unseen peg above the target: both arms rise (f0-f9), the hook-staff tip traces a small arc, and at f12 she lets go with the hand opening upward (up means help). Follow-through: the hand stays raised to f20, then lowers; recover by f30. Silhouette: one raised arm. |
| `cast_a3` | 20 (f8) | **Dawnglass Shell** · castTime 0 s · shield an ally or herself, haste 1 s | Instant (castTime 0): she cups the lamp with both hands at the chest for 3 frames, then spreads her palms outward and pushes at f8 like opening a pane of glass; the mantle panels flare open. Recover to guard by f20. Silhouette: arms wide, the bell opening. |
| `cast_ult` | 45 (f18) | **Every Window Lit** · castTime 0.3 s · lamps on every ally within 9 m, 5 s | She holds the hook-staff and lamp high overhead in both hands (f0-f12) and rises onto her toes, the mantle flaring; the staff tip traces a slow wide circle, kindling each window (f12-f18); at f18 the lamp flares (the accent bloom) with her arms wide. Hold f18-f30, lower to rest by f45. Silhouette: a tall figure with the lamp as a star above her head. |

Other clips: `run` at 3.35 m/s (light, foot slide under 8%); `attack1` a small lamp flick forward, `attack2` a hook-staff tap (20 frames, impact f8; both are ranged magic bolts); `death` kneels and sets the lamp gently on the ground as she falls (the lamp stays upright; ends at rest); `recall` cups the lamp and bows over it; `stunned` clutches the lamp to her chest; `dash` and `taunt` follow the standard generators (the taunt raises the lamp and tilts the chimney).

**`idle_lobby`** (loops, closed first = last pose): Careful and warm. She tends the lamp: lifts the chimney cap, trims the wick with two fingers, cups the lamp against a draft that is not there, then peers at the light with her head tilted so the chimney visor catches it. A gentle side-to-side sway. 120 frames.

**`victory`** (ends in a hold): She hangs the lamp on the hook and holds it out at arm's length toward the camera, the other hand over her chest, with a slight bow: the lamp stays lit. Final hold: the lamp held out, the head bowed 10 degrees, the mantle open. 60 frames, then the hold.

## 9. Skins (template 9)

Palette swaps plus optional extra geometry read from `ctx.skin["extra"]`. Every skin keeps the rig, clips, silhouette class (height ±5%, footprint ±10%), accent locations and value gradient; none adds metal, a single saturated full-body colour, or a reserved hue above 40% saturation. Names, tiers and descriptions come from `content/skins/ilsheta.json`. The named hex is the identity colour of the skin: where it falls outside a band's L* range, the surface steps lighter or darker by band and the identity hex is used at its own band.

### `ilsheta_base`: Ilsheta (base)

Points at the base files (`assets/fighters/ilsheta/ilsheta.glb`). The palette is section 5.

### `ilsheta_stillwater`: Stillwater Lamp (standard)

*"A sea-glass lamp and a wet-stone mantle, with reed plates ringing the visor, from the shallows of the Fallen Shaft."*

A sea-glass lamp (`#8FB3A8`, hue 162, outside the heal band) and a wet-stone mantle (`#59666A`), with reed plates ringing the visor, from the shallows of the Fallen Shaft. The wet stone is the mantle's lower half and hem; the hood and shoulders step lighter so the top quarter holds its value. The chimney visor stays clear dawnglass (only the lamp turns sea-glass). **Extra geometry:** six rigid reed plates (0.10 x 0.04 m, 1 cm thick) fanned around the chimney's base collar, clear of the glass so the visor reads clear; no sway bones.

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `cloth2` | `#B9C6CA` | 79 | 194° / 8% | mantle hood and shoulders, pale wet stone |
| `chalk` | `#C9CFCB` | 83 | 140° / 3% | lamp rings |
| `cloth` | `#59666A` | 42 | 194° / 16% | the named wet-stone mantle #59666A |
| `cloth3` | `#434F53` | 33 | 195° / 19% | mantle hem |
| `wood` | `#B7A98F` | 70 | 39° / 22% | reed-pale hook-staff |
| `sea_glass` | `#8FB3A8` | 70 | 162° / 20% | the named sea-glass lamp #8FB3A8 |
| `reed` | `#8E9672` | 61 | 73° / 24% | reed plates around the visor |

Value bands (area-weighted): top **72** (70-85) · mid **50** (45-65) · feet **29** (20-35).

`SKINS` entry: `{"id": "ilsheta_stillwater", "palette": {...as above...}, "extra": {"reed_plates": True}, "card": {"primary": "#59666A", "secondary": "#8FB3A8"}}`

### `ilsheta_first_bell`: First Bell Lamp (deluxe)

*"The honour of the year's first bell: a pale dial-stone mantle carved with ten hour-marks over a dark hem, and a small glass bell inside the lamp."*

The honour of the year's first bell: a pale dial-stone mantle (`#CFCAC0`) carved with ten hour-marks over a dark base (`#3A3633`), which keeps the value gradient. **Extra geometry:** a small dawnglass bell (0.07 m tall, rigid) hung inside the lamp's glass in front of the accent core (the core must stay visible behind it), and ten carved hour-marks (6 cm long ticks, equally spaced round the mantle hem, 4 mm relief). The hour-marks are plain ticks: no numerals, no radial lines meeting at a centre, nothing that reads as a clock hand.

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `cloth2` | `#CFCAC0` | 81 | 40° / 7% | the named pale dial-stone mantle #CFCAC0 |
| `chalk` | `#D4CEBF` | 83 | 43° / 10% | lamp rings |
| `cloth` | `#8C8780` | 57 | 35° / 9% | warm grey lower mantle |
| `cloth3` | `#3A3633` | 23 | 26° / 12% | the named dark base #3A3633 (hem) |

Value bands (area-weighted): top **75** (70-85) · mid **60** (45-65) · feet **28** (20-35).

`SKINS` entry: `{"id": "ilsheta_first_bell", "palette": {...as above...}, "extra": {"glass_bell": True, "hour_marks": True}, "card": {"primary": "#3A3633", "secondary": "#CFCAC0"}}`

## 10-11. Export and renders

- Splash: `SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92}`. The outstretched lamp points toward the UI side of the frame; the pale mantle needs the darker Aubade backdrop, so keep the sun behind-left and the lamp out of the highlight.
- Portrait (512 square, `idle_lobby` t 0, yaw 28): the chimney visor and the hood, the lamp's glow in the lower corner. Icon (128 square): the chimney visor with the lamp core below it.
- GLB budget 10-25k tris and at most 1.2 MB, base and both skins.

## Per-fighter checks (on top of the template checklist)

- [ ] The chimney visor reads as a bright vertical cylinder above a round bell at 64 px; no hard corner on the outline.
- [ ] IoU against Sukri (once half B exists), Dunsom and Marund <= 0.80.
- [ ] The middle band stays at or under 65 L* (the mantle is the risk) and no large area passes L* 86.
- [ ] The lamp core is the only emissive pixel at rest; the lamp glass and the chimney are never emissive.
- [ ] `cast_a3` has at most 4 frames of anticipation (castTime 0).
