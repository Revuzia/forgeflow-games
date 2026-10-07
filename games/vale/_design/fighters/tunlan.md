# Tunlan · Caster: art brief

`tunlan` · Serenade (she) · standard, tall end (anchor 1.9 m, authored at 2.05 m) · 2.05 m · res_heat · ranged 5.2 m magic · difficulty 2

> Source of truth: `_design/ROSTER.md` §3 entry 14, `content/fighters/tunlan.json`, `content/skins/tunlan.json`. Look law: `STYLE_BIBLE.md` (Fighters, Look rules), `_design/tokens.json` `fighter`, `WORLD.md` §2 (faces). Pipeline: `CONTRACT.md` §12, `art/README.md` and `art/blender/fighters/_template.py`; the section numbers below follow the template's 0-11. Art authors the numbers marked *start value*; the `lineup_qa` / three QA measurements decide.

Banned for every fighter: gears, clock hands, gold filigree, gems, glowing runes, metallic bevels, teal-and-gold, red-versus-green. Every material is non-metallic (metalness 0): "iron" and "steel" mean matte, painted, oxidised-looking stone or ironstone, never a bright edge. Only the `accent` material emits; dawnglass and lampresin are glossy but never emissive.

## 0. Brief

| Field | Value |
|---|---|
| `ID` (file name = content id) | `tunlan` |
| `TITLE` (collection title, never an epithet) | Shadow puppeteer |
| `ROLE_MASS` | `caster` (Caster; `class_caster`) |
| `ORIGIN` | `serenade`: carved or lacquered mask |
| Fight job | Throws lamp-shadows of beasts over the enemy line and sends them running. |
| Positions | `dialcross` / `shaftlight` · bot `burst`, preferred range 6.5 m |
| Height | **2.05 m** (class: standard, tall end (anchor 1.9 m, authored at 2.05 m)); 104 px at 1080p, 69 px at 720p (vertical px = 50.5 × height m; horizontal 82.1 px per m) |
| `art.height` / `collisionRadius` / `moveSpeed` | 2.05 m / 0.55 m / 3.35 m/s: author `run` for **3.35 m/s** (`runRefSpeed`); the content JSON still carries the 3.6 placeholder until `art.json` is copied back |
| Weapon + motion | a hanging lamp and her hands, `focus`; weight `light`, stance `neutral`. The lamp is part of the hat (a rigid hanging prop), and the long jointed fingers do the shadow gestures. |
| `CARD` = `FighterDef.palette` | primary `#463C38` · secondary `#B49A78` (collection and draft backdrops; already in the JSON) |
| Kit (for the body notes) | passive **Startle** · a1 **Hound Shadow** · a2 **Hand Shadow** · a3 **Lamp Flare** · ult **Shadow Play** |

## 1. Silhouette at 96 px

- **Mass: Caster, line plus disc.** A tall, narrow body, shoulders 0.40 m and hips 0.26 m, under a **wide flat lampshade hat 1.0 m across**: the disc is 82 px wide at 1080p on a body that is 33 px wide, an aspect ratio of 2.5 : 1.
- **Hook:** a **wide flat disc with a bright point at its front edge**. The hat is 1.0 m across and 0.10 m thick with a slightly raised centre (0.14 m tall at the crown), and a small lantern hangs 0.16 m below the front brim in front of the mask: a single bright point at the end of a flat bar.
- **Below the disc:** a long, narrow felt robe to the ankle with rigid front and back panels, and long jointed fingers (carved wooden finger segments, 0.12 m each) that make the shadow gestures; the hands are the second read in the casting poses.
- **Size:** 104 px tall at 1080p (69 px at 720p); at 2.05 m she is the tallest Caster with Vashil.
- **At 64 px:** a thin vertical under a flat horizontal disc, with one small bright notch at the front brim. Nothing is thinner than 6 cm (5 px at 1080p) in the silhouette.
- **Facing from above:** the lantern and the beak keel on the mask point forward; the hat's front brim is marked by the lantern hook, the back brim is plain.

Pairs to test first (IoU <= 0.80 at 64 px):

- **Tunlan / Dunsom** (both Serenade Casters with a disc and a lantern): Tunlan's disc is a rigid flat shade 1.0 m across with the lantern hanging below its front edge and nothing above it; Dunsom's disc is a soft felt hood-rim with a tall crook rising 0.5 m above it and the lantern hung in the crook. If IoU passes 0.80, raise the crook's height before changing the shade.
- **Tunlan / Vashil** (the other Caster): a wide flat disc on a slim body versus a ring of seven bells above the head and a long rod.
- **Tunlan / Nurrow** (both hatted): a flat disc 1.0 m wide versus a tilted cone 0.70 m wide; they differ in aspect ratio and in height.

## 2. Proportions and shape (template 1)

- **Standard class**, tall end: height 2.05 m, head 0.30 m (6.8 heads, measured without the hat). Long legs and a long neck so the disc floats above the shoulders.
- **Stylized heroic:** hands x1.5 (long fingers), forearms x1.1, boots x1.2 wide, a long neck (0.08 m), a narrow waist. An upright, slightly forward-leaning stance: `spine_curve` 0.02.
- *Start values*:

```python
PROPORTIONS = rig.proportions(height=2.05, head=0.30, neck=0.08, shoulder_width=0.40, hip_width=0.20, leg=0.95,
                              thigh_frac=0.50, arm=0.66, upper_arm_frac=0.52, hand=0.22, foot=0.29,
                              ankle_height=0.09, spine_curve=0.02, stance=0.03, toe_out_deg=6.0, knee_bend=0.012)
SHAPE = body.shape(girth=0.92, torso_w=0.92, torso_d=0.92, chest=0.94, waist=0.86, hips=0.9, arm=0.92, forearm=1.1,
                   leg=0.92, calf=1.0, hand=1.5, neck=1.25, head_w=1.04, head_d=1.03, jaw=1.0, feet=False)
```

## 3. Face (template 3)

- **Serenade carved mask.** A lacquered pale mask (`kit.carved_mask`), planar facets, a brow shelf of at least 6 cm, ink almond eye recesses with a faint half-smile, and a beak keel (`kit.mask_beak`, 4 cm) as the facing cue. A linen mouth-wrap (`cloth2`) covers the jaw. No bare face, no hair.
- The hat's brim shades the mask from the 52 degree camera, so the mask is mostly a portrait and splash read; the brim must clear the brow by 5 cm and the lantern hangs clear of the eyes (0.10 m in front of the mask).

## 4. Armour, cloth and props (template 4)

- **Hat.** A rigid flat lampshade (`sandstone`, pale lacquered paper over a walnut ring), 1.0 m across and 0.10 m thick with a raised crown 0.14 m tall; a 3 cm ironstone rim; the underside is walnut and shows only in the low-angle portrait. It sits on a head band (`x_hat` is one rigid node on the head bone, no sway).
- **Lamp.** A lantern 0.14 m tall on a 0.16 m rigid hook under the front brim: a matte ironstone cage of four slats around a smoked-lampresin bead, with an accent glass core 3 cm across at the centre. The cage must stay duller than the core.
- **Robe.** A long felt robe (`cloth`) with two rigid front panels and one back panel (one bone each, at most 2 sway bones), a waxed-leather sash (`leather`), linen cuffs (`cloth2`).
- **Hands.** Carved wooden finger segments (`wood`), long and jointed, stylized (no skin shader); fingers are at least 6 cm wide in profile, so the gestures read at 96 px.
- **Legs.** Close dark leggings (`under`) under the robe hem, soft waxed-leather boots.

Sockets (`art.json` `sockets`; the standard set stays exactly as in the content JSON):

`origin root`, `chest chest`, `head head`, `hand_r hand.R`, `hand_l hand.L`, `weapon / weapon_r prop.R`, `weapon_l prop.L`, `foot_r foot.R`, `foot_l foot.L`, plus the extras `lamp x_lamp` (the accent core; Lamp Flare and Shadow Play start here) and `hand_gesture_r x_gesture_r` / `hand_gesture_l x_gesture_l` (the points where the Hound Shadow and Hand Shadow leave her fingers).

## 5. Palette (template 5)

Hexes are authored albedo in the bible vocabulary (`materials.bible_palette` roles). None of the reserved relationship hues (Dawn azure `#3F9CFF`, Dusk marigold `#FF9A1F`, Noonwhite `#F4EFE2`) dominates: every large-area colour is below 40% saturation inside the azure (200-225°), marigold (25-50°), heal (125-150°) and tritan (340-350°) hue bands, and no large area is lighter than L* 86. The `accent` role is authored azure; the renderer tints it per viewer.

| Role | Hex | L* | Hue / sat | Where it is used |
|---|---|---|---|---|
| `sandstone` | `#D9CBAA` | 82 | 42° / 22% | the lampshade hat (pale lacquered paper) |
| `wood` | `#CDB892` | 76 | 39° / 29% | carved mask, finger segments |
| `cloth2` | `#CEC5B6` | 80 | 38° / 12% | mouth-wrap, cuffs, collar |
| `cloth` | `#7C6C66` | 47 | 16° / 18% | felt robe |
| `lampresin` | `#A8916F` | 61 | 36° / 34% | the lantern bead and its glass (smoked, small area) |
| `ironstone` | `#4B4140` | 29 | 5° / 15% | hat rim, lantern cage |
| `leather` | `#43362F` | 24 | 21° / 30% | sash, boots |
| `under` | `#342C2B` | 19 | 7° / 17% | leggings |
| `ink` | `#17161A` | 8 | 255° / 15% | eye recesses, lantern cage shadow |
| `accent` | `#3F9CFF` | 63 | 211° / 75% | the lantern core |

## 6. Value gradient (template 6)

Light head, dark feet: the bible bands measured on screen by `lineup_qa` (top quarter L* 70-85, middle 45-65, feet 20-35; at least 40% of the silhouette at rest value). The means below are area-weighted estimates of the authored albedo before the `VALUE_GRADIENT_STOPS` ramp (x0.62 at the feet to x1.06 at the crown) and the baked top light, so the on-screen top band sits a little higher.

| Band | Target L* | Mix (share of the band) | Mean L* |
|---|---|---|---|
| top quarter (crown to chest) | 70-85 | sandstone 44%, wood 22%, cloth2 14%, cloth 8%, ironstone 6%, lampresin 4%, ink 2% | **72** |
| middle half | 45-65 | cloth 52%, leather 14%, cloth2 12%, under 8%, wood 8%, ironstone 6% | **47** |
| feet quarter (shins down) | 20-35 | under 40%, leather 34%, cloth 18%, ironstone 8% | **26** |

The big pale hat carries the top quarter by area; the felt robe carries the middle; the hem, leggings and boots are the feet. The hat is above the head band, so the top band is mostly its upper surface, which the camera sees at 52 degrees. If lineup_qa shows the hat as brighter than L* 86 under the baked top light, tint the crown 2 L* darker.

## 7. Accent (template 7)

The lantern core (a 3 cm bead, about 7 cm2 seen from the front), a 2 cm accent ring on the lantern cap (about 6 cm2) and a 4 x 1 cm accent notch on the hat's front rim above the lantern (4 cm2), against roughly 11,000 cm2 of silhouette including the hat: **about 0.15%** (budget 5%), 100% in the top half (the lantern hangs at about 1.75 m and the rim notch at 1.95 m). At rest the emissive is 0.8; it blooms to 1.5 or more in the wind-ups of Hound Shadow and Shadow Play, as a warning that a fear is coming. From the 52 degree camera the disc hides the lantern's upper half, so the rim notch keeps the colour readable from the front and from above.

## 8. Motion (template 8)

`MOTION = anim.motion_profile(weight="light", weapon="focus", stance="neutral", run_ref_speed=3.35, blocks=BLOCKS)`

`BLOCKS` (both hands are free; the lamp is on the hat):
- **guard / idle:** both hands held loosely in front of the chest with the fingers half-curled as if about to shape something; the head tilted so the lamp hangs a little forward; weight even.
- **run:** a long gliding stride, the arms close to the body, the fingers relaxed; contact 0.30, a light bob; the hat and the robe panels stay rigid.
- **lobby:** the hands making shadow animals; see below.

Four distinct ability gestures. Frame counts are multiples of 5 at 30 fps; the impact is at exactly 40% of the clip (frame = 0.4 × N). The sim's `castTime` is the windup before the effect lands; the clip's impact frame is the visual hit. A `castTime` of 0 means the effect starts at once, so the anticipation stays at 4 frames or fewer and the gesture must not hide a dash.

| Clip | Frames (impact) | Sim ability | Gesture |
|---|---|---|---|
| `cast_a1` | 30 (f12) | **Hound Shadow** · castTime 0.3 s · 9 m piercing hound, fear | She makes the hound with both hands: wrists together, fingers extended, the thumbs as ears and the lower fingers as a jaw that opens and closes (f0-f10, a held pose that breathes); at f12 the jaws snap open and the hands thrust forward as the shadow leaps off her fingers. Recover by f30. Silhouette: a pair of hands forming a snarling head, then a lunge. |
| `cast_a2` | 25 (f10) | **Hand Shadow** · castTime 0.25 s · 7 m grip, slow or stun | The right hand rises with the fingers spread wide like a great shadow palm (f0-f8), then closes in a slow grip at f10 as the shadow hand takes hold of the target; the left hand steadies the lamp. Recover by f25. Silhouette: a large open hand that becomes a fist. |
| `cast_a3` | 15 (f6) | **Lamp Flare** · castTime 0.15 s · 3 m push and slow | A flick: the left hand knocks the hat's front brim up and the lamp swings out on its hook, the whole figure leaning away; at f6 the lamp reaches the end of its swing and flares. The accent blooms for one beat. Recover by f15. Silhouette: the hat tips and the lamp swings clear of the brim. |
| `cast_ult` | 40 (f16) | **Shadow Play** · castTime 0.3 s · 9 m, 50 degree cone, fear | Both arms rise high and wide, the fingers spreading into the horns, wings and claws of a huge beast, the head tilting back so the hat tips up (f0-f12, a held pose that breathes: the fingers move in turn); at f16 the arms sweep forward and down and the shadow beast fills the cone. Hold f16-f30, then lower. Silhouette: a thin figure under a disc with a monster's outline between her arms. |

Other clips: `run` at 3.35 m/s (light, foot slide under 8%); `attack1` a quick two-finger flick that throws a bolt of lamplight, `attack2` a flat-palm push (both 20 frames, impact f8, the bolt leaves at the impact frame); `death` bows, the hat tipping off and rolling a little, and she folds to the ground (ends at rest); `recall` cups both hands around the lantern and blows it out; `stunned` jolts with the hat bobbing; `dash` is the glide loop; `taunt` makes a rabbit shadow and wiggles its ears at the camera.

**`idle_lobby`** (loops, closed first = last pose): Mischievous and absorbed. She turns to the side to put her hands in the lamp's light and makes shadow animals one after another: a bird, a rabbit, a hound, then a bigger thing she stops herself from finishing. She grins behind the mask, tips the hat back, and starts again. 120 frames.

**`victory`** (ends in a hold): She stands before the lantern and casts one enormous shadow, a great hound, then bows to it and the shadow bows back. Final hold: the hat tipped forward, both hands cupped at the chest as if holding a small bird, a quarter turned from the camera. 55 frames, then the hold.

## 9. Skins (template 9)

Palette swaps plus optional extra geometry read from `ctx.skin["extra"]`. Every skin keeps the rig, clips, silhouette class (height ±5%, footprint ±10%), accent locations and value gradient; none adds metal, a single saturated full-body colour, or a reserved hue above 40% saturation. Names, tiers and descriptions come from `content/skins/tunlan.json`. The named hex is the identity colour of the skin: where it falls outside a band's L* range, the surface steps lighter or darker by band and the identity hex is used at its own band.

### `tunlan_base`: Tunlan (base)

Points at the base files (`assets/fighters/tunlan/tunlan.glb`). The palette is section 5.

### `tunlan_noon_fair`: Noon Fair Puppets (standard)

*"A painted paper lampshade hat in rose-lilac and chalk, dressed for the Shadowless Noon fair. Two rigid puppet rods hang at her belt."*

The hat is painted paper in rose-lilac (`#B48AA6`, hue 320, outside every reserved band) and chalk, as the Noon Fair puppet-shops paint theirs; the felt robe is a muted plum-grey. **Extra geometry:** two rigid puppet rods at the belt, 0.45 m long and 2 cm thick (a carved-wood stick with a small paper head), hanging at the left hip; they stay inside the +10% footprint limit.

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `sandstone` | `#E2D6C3` | 86 | 37° / 14% | the hat ground, pale chalky ground (the lilac paint is texture) |
| `lilac` | `#B48AA6` | 62 | 320° / 23% | the named rose-lilac paint #B48AA6 (about 20% of the hat, painted in a ring pattern) |
| `cloth` | `#85727B` | 50 | 332° / 14% | felt robe, plum-grey |
| `wood` | `#D3C0A0` | 79 | 38° / 24% | mask and fingers |

Value bands (area-weighted): top **75** (70-85) · mid **48** (45-65) · feet **27** (20-35).

`SKINS` entry: `{"id": "tunlan_noon_fair", "palette": {...as above...}, "extra": {"puppet_rods": True}, "card": {"primary": "#6A4F5E", "secondary": "#E2D6C3"}}`

### `tunlan_lamplit`: Lamplit Shadows (deluxe)

*"A walnut shade-hat with lampresin panels. Her shadows fall in muted violet."*

A walnut shade-hat (`#5E4D3E`) with lampresin panels (`#A38C6B`, 34% saturation) lit from within like paper lanterns. `vfxTint` is `#6A5C7A` (hue 268), so her shadows are muted violet and stay out of the harm band. The walnut ring and rim are dark, so the top band re-mixes: the walnut is only the hat's ring and the crown rim, and the panels, the mask and the cuffs carry the value. **No extra geometry.**

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `sandstone` | `#5E4D3E` | 34 | 28° / 34% | the named walnut shade-hat #5E4D3E (the hat ring and the crown rim only, 6% of the top band) |
| `panel` | `#CDB98F` | 76 | 41° / 30% | lampresin panel paper, lit from within (the named #A38C6B is the panel's shaded edge, 3% of the band) |
| `lampresin` | `#A38C6B` | 60 | 35° / 34% | the named lampresin #A38C6B (the panel edges and the lantern bead) |
| `cloth` | `#7F6D60` | 47 | 25° / 24% | felt robe, warm walnut grey |
| `wood` | `#D3C0A0` | 79 | 38° / 24% | mask and fingers |

Value bands (area-weighted): top **71** (70-85) · mid **47** (45-65) · feet **26** (20-35).

This skin re-mixes the top band: the walnut is 6% of it, the lit panel paper is 42%, and the mask, the cuffs and the lampresin edges carry the rest.

`SKINS` entry: `{"id": "tunlan_lamplit", "palette": {...as above...}, "extra": {}, "card": {"primary": "#4A4036", "secondary": "#A38C6B"}}`

## 10-11. Export and renders

- Splash: `SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "yaw": 22.0}`. The great hound shadow is a VFX layer thrown on the splash backdrop; the lantern is the brightest point in the frame and sits clear of the UI side.
- Portrait (512 square, `idle_lobby` t 0, yaw 28): the hat's brim from below the front, the lantern and the mask. Icon (128 square): the lantern under the brim over the mask's eyes.
- GLB budget 10-25k tris and at most 1.2 MB, base and both skins.

## Per-fighter checks (on top of the template checklist)

- [ ] The hat is at least 1.0 m across and flat, and the figure reads as a thin vertical under a horizontal disc with a bright notch in black at 64 px.
- [ ] IoU against Dunsom, Vashil and Nurrow <= 0.80; nothing rises above the hat (no crook, no halo).
- [ ] The hat, the lantern hook and the robe panels are rigid; the robe uses at most 2 sway bones; the fingers are at least 6 cm wide in profile.
- [ ] The lantern core and the hat-rim notch are the only emissive materials; the lampresin stays glossy and never glows.
- [ ] The `cast_a1` hound hands and the `cast_ult` beast hands read as different gestures in three_clips_tunlan.png (a head versus a full body).
