# Nurrow · Striker: art brief

`nurrow` · Serenade (she) · standard (anchor 1.9 m, authored at 1.8 m) · 1.8 m · res_tally · melee 1.7 m phys · difficulty 3

> Source of truth: `_design/ROSTER.md` §3 entry 11, `content/fighters/nurrow.json`, `content/skins/nurrow.json`. Look law: `STYLE_BIBLE.md` (Fighters, Look rules), `_design/tokens.json` `fighter`, `WORLD.md` §2 (faces). Pipeline: `CONTRACT.md` §12, `art/README.md` and `art/blender/fighters/_template.py`; the section numbers below follow the template's 0-11. Art authors the numbers marked *start value*; the `lineup_qa` / three QA measurements decide.

Banned for every fighter: gears, clock hands, gold filigree, gems, glowing runes, metallic bevels, teal-and-gold, red-versus-green. Every material is non-metallic (metalness 0): "iron" and "steel" mean matte, painted, oxidised-looking stone or ironstone, never a bright edge. Only the `accent` material emits; dawnglass and lampresin are glossy but never emissive.

## 0. Brief

| Field | Value |
|---|---|
| `ID` (file name = content id) | `nurrow` |
| `TITLE` (collection title, never an epithet) | Lull singer |
| `ROLE_MASS` | `striker` (Striker; `class_striker`) |
| `ORIGIN` | `serenade`: carved or lacquered mask |
| Fight job | Sings everyone around her target to sleep and takes the one left awake. |
| Positions | `grovehunter` / `dialcross` · bot `burst`, preferred range 2 m |
| Height | **1.8 m** (class: standard (anchor 1.9 m, authored at 1.8 m)); 91 px at 1080p, 61 px at 720p (vertical px = 50.5 × height m; horizontal 82.1 px per m) |
| `art.height` / `collisionRadius` / `moveSpeed` | 1.8 m / 0.5 m / 3.55 m/s: author `run` for **3.55 m/s** (`runRefSpeed`); the content JSON still carries the 3.6 placeholder until `art.json` is copied back |
| Weapon + motion | curved snuffer-blade, `one_hand`, in the right hand; weight `light`, stance `low`. The free left hand is the "lull" hand and is always a little open. |
| `CARD` = `FighterDef.palette` | primary `#3E3440` · secondary `#8C6F5A` (collection and draft backdrops; already in the JSON) |
| Kit (for the body notes) | passive **Quiet Kill** · a1 **Felt Step** · a2 **Lullaby Dart** · a3 **Snuff** · ult **Lull the Rest** |

## 1. Silhouette at 96 px

- **Mass: Striker, forward diagonal.** A lean, crouched figure: shoulders 0.40 m, hips 0.28 m, leaning 12 degrees into the stance in `idle` and 15 degrees in `run`, with everything long swept back.
- **Hook:** a **wide conical hat shaped like a lamp snuffer**, 0.70 m across at the brim and 0.42 m tall, tilted forward 20 degrees over the face. From the 52 degree camera the cone reads as an off-centre point leaning toward where she is going. The hat's iron rim (a dark ring, 3 cm thick) holds the accent.
- **Behind the hat:** a felt mantle ending in three trailing points (rigid plates, 0.30 m long) that sweep back along the spine, so the back edge of the silhouette is spiked, like Rishal's but lower and softer.
- **Size:** 91 px tall at 1080p (61 px at 720p); the hat is 57 px wide, the widest single read on the figure.
- **At 64 px:** a forward-leaning figure under a pale cone, with three small points trailing behind; the hat's rim is a thin dark ring. Nothing is thinner than 6 cm (5 px at 1080p).
- **Facing from above:** the hat tilts toward the front and its point is the facing cue; the blade is on the right, the open left hand is forward.

Pairs to test first (IoU <= 0.80 at 64 px):

- **Nurrow / Rishal** (the other forward diagonal): a pale cone hat and a soft felt-point back edge versus a narrow blade visor and a hard crest comb. Test early; if IoU passes 0.80, widen the hat brim to 0.80 m before touching Rishal.
- **Nurrow / Tunlan** (both hatted): a tilted cone 0.42 m tall versus a flat disc 1 m wide on a tall figure; they differ in aspect ratio and in height.
- **Nurrow / Ulkro** (hooded and forward): a pale hat cone versus a deep dark hood with a crest of dart shafts.

## 2. Proportions and shape (template 1)

- **Standard class**, light end: height 1.80 m, head 0.285 m (6.3 heads, measured without the hat). Long legs for a stalker (0.88 m of the 1.80 m is leg).
- **Stylized heroic:** hands x1.45 (the open left hand reads), boots x1.2 wide with a soft sole, a narrow waist, a long neck (0.07 m) so the hat's tilt reads. A crouched stance: `stance` 0.04, `knee_bend` 0.03.
- *Start values*:

```python
PROPORTIONS = rig.proportions(height=1.80, head=0.285, neck=0.07, shoulder_width=0.40, hip_width=0.18, leg=0.88,
                              thigh_frac=0.50, arm=0.60, upper_arm_frac=0.52, hand=0.20, foot=0.30,
                              ankle_height=0.09, spine_curve=0.03, stance=0.04, toe_out_deg=5.0, knee_bend=0.03)
SHAPE = body.shape(girth=0.93, torso_w=0.94, torso_d=0.94, chest=0.96, waist=0.88, hips=0.92, arm=0.94, forearm=1.1,
                   leg=0.92, calf=1.0, hand=1.45, neck=1.2, head_w=1.05, head_d=1.04, jaw=1.0, feet=False)
```

## 3. Face (template 3)

- **Serenade carved mask, a sleeping face.** A pale-walnut lacquered mask (`kit.carved_mask`): planar facets, a brow shelf of at least 6 cm, almond eyes carved as **closed lids** (a gentle downward curve, ink-painted), a small carved smile, and a beak keel (`kit.mask_beak`, 4 cm) as the facing cue. A linen mouth-wrap (`cloth2`) covers the jaw. No bare face, no hair.
- The hat's brim shades the mask from the 52 degree camera, so the mask is mostly a portrait and splash read; the brim must still clear the brow by 4 cm so the closed lids show in the portrait.

## 4. Armour, cloth and props (template 4)

- **Hat.** A lacquered cone (`sandstone`, a pale ochre lacquer, rigid) 0.70 m wide at the brim, 0.42 m tall, tilted forward 20 degrees on a head band; an ironstone rim 3 cm thick runs round the brim and carries six accent glass inlays; the inside is `ink`.
- **Mantle.** A felt mantle (`cloth`, a plum-grey) over the shoulders, ending behind in three rigid trailing points (0.30 m long, one bone `x_mantle` for the set, at most 2 sway bones); a short plate of the same felt over the left shoulder.
- **Torso and arms.** A close under-suit (`under`), a waxed-leather chest wrap (`leather`), linen sleeve wraps (`cloth2`) on both forearms; the left hand is bare-fingered carved wood (stylized hand, no skin shader).
- **Legs.** Close dark leggings, soft waxed-leather boots with a low wedge heel (`leather`).
- **Snuffer-blade** (`prop.R`, grip at the origin, blade along -Z): a curved ironstone blade 0.55 m long, 5 cm wide, 1.5 cm thick, with a hooked back (the snuffer hook, 6 cm) and a 2 cm bevel along the edge, matte and painted (no bright edge); a lacquered wood handle 0.18 m, a leather wrap.

Sockets (`art.json` `sockets`; the standard set stays exactly as in the content JSON):

`origin root`, `chest chest`, `head head`, `hand_r hand.R`, `hand_l hand.L`, `weapon / weapon_r prop.R`, `weapon_l prop.L`, `foot_r foot.R`, `foot_l foot.L`, plus the extras `hat_rim x_hat_rim` (the accent ring; Lull the Rest's sleep ring starts here) and `dart_hand x_dart_hand` (the left fingertips where the Lullaby Dart leaves).

## 5. Palette (template 5)

Hexes are authored albedo in the bible vocabulary (`materials.bible_palette` roles). None of the reserved relationship hues (Dawn azure `#3F9CFF`, Dusk marigold `#FF9A1F`, Noonwhite `#F4EFE2`) dominates: every large-area colour is below 40% saturation inside the azure (200-225°), marigold (25-50°), heal (125-150°) and tritan (340-350°) hue bands, and no large area is lighter than L* 86. The `accent` role is authored azure; the renderer tints it per viewer.

| Role | Hex | L* | Hue / sat | Where it is used |
|---|---|---|---|---|
| `sandstone` | `#DCCDAE` | 83 | 40° / 21% | the snuffer hat (pale ochre lacquer) |
| `wood` | `#CDB490` | 75 | 35° / 30% | the carved sleeping-face mask, handle |
| `cloth2` | `#CBC3B8` | 79 | 35° / 9% | mouth-wrap, sleeve wraps |
| `cloth` | `#867682` | 51 | 315° / 12% | felt mantle and its trailing points, tabard |
| `ironstone` | `#4A4045` | 28 | 330° / 14% | hat rim, blade, greaves |
| `leather` | `#3E3530` | 23 | 21° / 23% | chest wrap, boots, grip |
| `under` | `#342C33` | 19 | 308° / 15% | under-suit, leggings |
| `ink` | `#17161A` | 8 | 255° / 15% | inside of the hat, eye recesses |
| `accent` | `#3F9CFF` | 63 | 211° / 75% | six glass inlays on the hat rim |

## 6. Value gradient (template 6)

Light head, dark feet: the bible bands measured on screen by `lineup_qa` (top quarter L* 70-85, middle 45-65, feet 20-35; at least 40% of the silhouette at rest value). The means below are area-weighted estimates of the authored albedo before the `VALUE_GRADIENT_STOPS` ramp (x0.62 at the feet to x1.06 at the crown) and the baked top light, so the on-screen top band sits a little higher.

| Band | Target L* | Mix (share of the band) | Mean L* |
|---|---|---|---|
| top quarter (crown to chest) | 70-85 | sandstone 46%, wood 24%, cloth2 12%, cloth 10%, ironstone 5%, ink 3% | **72** |
| middle half | 45-65 | cloth 44%, leather 16%, under 12%, cloth2 12%, wood 8%, ironstone 8% | **46** |
| feet quarter (shins down) | 20-35 | under 44%, leather 34%, ironstone 18%, cloth 4% | **23** |

The pale hat and the mask carry the top quarter; the plum-grey felt mantle carries the middle; dark leggings and boots are the feet. The hat is large enough that the top band holds even though its rim and underside are dark. If lineup_qa shows the hat as the brightest mid-band pixel when she crouches, tint the lower third of the cone 3 L* darker.

## 7. Accent (template 7)

Six rim inlays, each about 4 x 1.5 cm = 36 cm2 in total, against roughly 9,500 cm2 of silhouette including the hat: **about 0.4%** (budget 5%), 100% in the top half (the rim is on the head, about 1.7 m up). At rest the emissive is 0.8; it blooms to 1.5 or more in the wind-ups of Lullaby Dart and Lull the Rest, as a warning that a sleep is coming. The rim is a ring at the widest part of the hat, so the colour reads from any angle, including from above.

## 8. Motion (template 8)

`MOTION = anim.motion_profile(weight="light", weapon="one_hand", stance="low", run_ref_speed=3.55, blocks=BLOCKS)`

`BLOCKS` (the right hand holds the blade; the left hand is the lull hand):
- **guard / idle:** the blade held low behind the right hip, the left hand open at chest height with the fingers loosely curled; the lean at 12 degrees, knees bent, the head tilted so the hat points slightly down.
- **run:** a stalker's run, the lean at 15 degrees, the left hand trailing open, the blade low and quiet; contact 0.26, a light bob; the hat and the mantle points stay rigid.
- **lobby:** the left hand conducting a slow rhythm; see below.

Four distinct ability gestures. Frame counts are multiples of 5 at 30 fps; the impact is at exactly 40% of the clip (frame = 0.4 × N). The sim's `castTime` is the windup before the effect lands; the clip's impact frame is the visual hit. A `castTime` of 0 means the effect starts at once, so the anticipation stays at 4 frames or fewer and the gesture must not hide a dash.

| Clip | Frames (impact) | Sim ability | Gesture |
|---|---|---|---|
| `cast_a1` | 15 (f6) | **Felt Step** · castTime 0.1 s · 4 m lunge, stops at the first fighter | Almost instant (castTime 0.1): a 2-frame crouch with the blade low and behind, then a soundless step-lunge; the body goes near-horizontal by f6 as the sim dashes her at 18 m/s, the blade forward and low, the hat leading. Follow-through is the optional `dash` clip. Silhouette: a long low diagonal under a cone. |
| `cast_a2` | 25 (f10) | **Lullaby Dart** · castTime 0.25 s · 8 m dart, sleep | The left hand rises to the lips in a hush (f0-f6, the head tilting back so the hat tips up), then flicks the dart off the fingertips at f10 (the impact), the hat dropping forward again; the blade hand stays low. Recover by f25. Silhouette: a pale cone tipping back, a flick forward. |
| `cast_a3` | 20 (f8) | **Snuff** · castTime 0.15 s · adjacent enemy, silence | A quick capping motion: the blade hand sweeps from low-back up and over and down in a hooked arc, as if snuffing a flame, landing at f8; the hat dips with the shoulder and the left hand closes into a fist. Silhouette: a hooked arc under the cone. |
| `cast_ult` | 40 (f16) | **Lull the Rest** · castTime 0.25 s · 6 m lunge, sleep ring 5 m | Both arms open wide like drawing a curtain, the head lifting so the hat points at the target (f0-f10, a held pose that breathes: the fingers move); at f16 she lunges (the sim dashes her at 20 m/s) with the blade forward and lands beside the target, the left hand lowered palm-down as the room falls quiet. Hold f16-f30, then straighten. Silhouette: a wide T, then a spear under a cone. |

Other clips: `run` at 3.55 m/s (light, foot slide under 8%); `attack1` a quick right-hand hooked slash, `attack2` a left-hand open-palm tap followed by a right slash (both 20 frames, impact f8); `death` folds slowly, the hat rolling off to one side and the mantle settling (ends at rest); `recall` lowers the blade and hums with a hand over her heart; `stunned` blinks and sways; `dash` is the stalker-run loop; `taunt` tips the hat forward with two fingers and yawns.

**`idle_lobby`** (loops, closed first = last pose): Drowsy and watchful at once. She sways slowly to a tune only she hears, the left hand conducting the rhythm, the hat nodding once as if she might nod off, then snapping up with the mask turned a quarter toward the camera. Every few seconds she lifts a finger to her lips. She never sits and never sleeps. 120 frames.

**`victory`** (ends in a hold): She slips the blade into her belt, tips the hat back, and spreads both hands over the camera as if smoothing a blanket; the closed-lid mask seems to smile. Final hold: the hat tilted forward over the face, one finger at the lips, the mantle points trailing behind, a quarter turned from the camera. 50 frames, then the hold.

## 9. Skins (template 9)

Palette swaps plus optional extra geometry read from `ctx.skin["extra"]`. Every skin keeps the rig, clips, silhouette class (height ±5%, footprint ±10%), accent locations and value gradient; none adds metal, a single saturated full-body colour, or a reserved hue above 40% saturation. Names, tiers and descriptions come from `content/skins/nurrow.json`. The named hex is the identity colour of the skin: where it falls outside a band's L* range, the surface steps lighter or darker by band and the identity hex is used at its own band.

### `nurrow_base`: Nurrow (base)

Points at the base files (`assets/fighters/nurrow/nurrow.glb`). The palette is section 5.

### `nurrow_noon_fair`: Noon Fair Snuffer (standard)

*"The snuffer hat painted with lacquer moths in rose-lilac and chalk, dressed for the Shadowless Noon fair. The mask has painted half-lids."*

The hat is painted with lacquer moths in rose-lilac (`#B48AA6`, hue 320, outside every reserved band) and chalk, in a ring around the cone; the mask has painted half-lids over its closed lids. The ironstone rim and the accent inlays are unchanged. The pale ground of the hat stays light so the top quarter holds its value; the moths are paint only (no emissive, no extra geometry). **No extra geometry.**

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `sandstone` | `#E2D6C3` | 86 | 37° / 14% | the hat ground, pale chalky ochre (the moths are texture) |
| `moth` | `#B48AA6` | 62 | 320° / 23% | the named rose-lilac lacquer moths #B48AA6 (about 15% of the hat, painted) |
| `wood` | `#D3C0A0` | 79 | 38° / 24% | mask, with painted half-lids |
| `cloth` | `#8C7886` | 53 | 318° / 14% | felt mantle, a little lighter and warmer |

Value bands (area-weighted): top **75** (70-85) · mid **47** (45-65) · feet **23** (20-35).

`SKINS` entry: `{"id": "nurrow_noon_fair", "palette": {...as above...}, "extra": {}, "card": {"primary": "#6A4F5E", "secondary": "#E2D6C3"}}`

### `nurrow_shadeprint`: Shadeprint Snuffer (deluxe)

*"An ink hat with a light rim over a pale mask, printed in ink and light. Her lullabies leave violet shadows."*

An ink-wash hat (`#2B2A33` on the brim band and underside) whose cone is printed pale with light-rimmed ink lines, over a pale mask (`#B7B4BE`); the felt mantle is printed light-and-ink so the value gradient holds. `vfxTint` is `#6C5BA8` (hue 253, outside every reserved band), so her sleep VFX are violet. **No extra geometry.**

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `sandstone` | `#2B2A33` | 17 | 247° / 18% | the named ink-wash hat #2B2A33 (brim band and underside, about 8% of the top band) |
| `chalk` | `#D8D5DE` | 86 | 260° / 4% | the hat's pale printed cone and light rims |
| `wood` | `#B7B4BE` | 74 | 258° / 5% | the named pale mask #B7B4BE |
| `cloth` | `#847C8E` | 53 | 267° / 13% | mantle, light-and-ink print |
| `ironstone` | `#4B4955` | 32 | 250° / 14% | hat rim underside, blade |

Value bands (area-weighted): top **71** (70-85) · mid **47** (45-65) · feet **24** (20-35).

This skin re-mixes the top band: the ink-wash is limited to the hat's brim band and underside (8% of the band), and the printed pale cone (`chalk`, 40%) and the pale mask (26%) carry the value; a hat that was mostly ink would fail the L* 70 floor.

`SKINS` entry: `{"id": "nurrow_shadeprint", "palette": {...as above...}, "extra": {}, "card": {"primary": "#2B2A33", "secondary": "#B7B4BE"}}`

## 10-11. Export and renders

- Splash: `SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "yaw": 22.0}`. The hat tilted toward the frame, the mantle points trailing to screen-right, the lifted finger at the lips.
- Portrait (512 square, `idle_lobby` t 0, yaw 28): the hat's tilt, the closed-lid mask and the rim inlays. Icon (128 square): the mask under the hat's brim.
- GLB budget 10-25k tris and at most 1.2 MB, base and both skins.

## Per-fighter checks (on top of the template checklist)

- [ ] The figure leans 12 degrees in `idle` and 15 degrees in `run` (measure the chest axis); the tilted cone reads as a forward point in black at 64 px.
- [ ] IoU against Rishal and Tunlan <= 0.80; the cone is at least 0.70 m across and the mantle points are visible from the camera side.
- [ ] The hat, the mantle points and the blade are rigid; the mantle uses one bone for its three points; the hat never hides both eyes in the portrait.
- [ ] The rim inlays are the only emissive material; no glow on the blade or the hat.
- [ ] `cast_a1` has at most 3 frames of anticipation (castTime 0.1): the lunge must not be hidden by a long wind-up.
