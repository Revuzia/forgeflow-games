# Sukri · Tender: art brief

`sukri` · Hourless (he) · compact (anchor 1.6 m, authored at 1.65 m) · 1.65 m · res_light · ranged 5.0 m magic · difficulty 2

> Source of truth: `_design/ROSTER.md` §3 entry 16, `content/fighters/sukri.json`, `content/skins/sukri.json`. Look law: `STYLE_BIBLE.md` (Fighters, Look rules), `_design/tokens.json` `fighter`, `WORLD.md` §2 (faces). Pipeline: `CONTRACT.md` §12, `art/README.md` and `art/blender/fighters/_template.py`; the section numbers below follow the template's 0-11. Art authors the numbers marked *start value*; the `lineup_qa` / three QA measurements decide.

Banned for every fighter: gears, clock hands, gold filigree, gems, glowing runes, metallic bevels, teal-and-gold, red-versus-green. Every material is non-metallic (metalness 0): "iron" and "steel" mean matte, painted, oxidised-looking stone or ironstone, never a bright edge. Only the `accent` material emits; dawnglass and lampresin are glossy but never emissive.

## 0. Brief

| Field | Value |
|---|---|
| `ID` (file name = content id) | `sukri` |
| `TITLE` (collection title, never an epithet) | Rim wanderer |
| `ROLE_MASS` | `tender` (Tender; `class_tender`) |
| `ORIGIN` | `hourless`: wrap or hood |
| Fight job | Draws a caught ally back to the group; when he falls low, nobody beside him can be touched for a breath. |
| Positions | `lampglass` · bot `sustain`, preferred range 5 m |
| Height | **1.65 m** (class: compact (anchor 1.6 m, authored at 1.65 m)); 83 px at 1080p, 56 px at 720p (vertical px = 50.5 × height m; horizontal 82.1 px per m) |
| `art.height` / `collisionRadius` / `moveSpeed` | 1.65 m / 0.5 m / 3.4 m/s: author `run` for **3.4 m/s** (`runRefSpeed`); the content JSON still carries the 3.6 placeholder until `art.json` is copied back |
| Weapon + motion | walking staff with a crook, `staff`, in the right hand; weight `medium`, stance `neutral`. The glass cup of noon light hangs from the crook on a rigid hook. |
| `CARD` = `FighterDef.palette` | primary `#7B7266` · secondary `#D9CDA8` (collection and draft backdrops; already in the JSON) |
| Kit (for the body notes) | passive **Spare Hour** · a1 **Mote Toss** · a2 **Draw Near** · a3 **Wrap Cast** · ult **Gather In** |

## 1. Silhouette at 96 px

- **Mass: Tender, round plus a light vessel.** A round, open, hooded wanderer in thick rigid wraps: shoulders 0.62 m (wrap bands included), hips 0.50 m, a hood 0.52 m wide. The silhouette is nearly a circle, widest at the chest and rounded top and bottom.
- **Hook:** a **swinging cup of light, a bright low-centre point under a wide round hood**. A glass cup 0.16 m tall and 0.14 m wide hangs from the staff's crook at chest height (1.15 m) on a 0.10 m rigid hook; it is the only bright thing below the hood and it swings with the walk. The cup's core bead holds the accent.
- **Staff:** a plain walking staff, 1.5 m, with a 0.18 m crook at the top, held at the side so the cup hangs 0.25 m out from the chest.
- **Size:** 83 px tall at 1080p (56 px at 720p); the compact class: the round mass makes him as wide as he is tall.
- **At 64 px:** a dark round body under a round hood with one bright dot at chest height on one side. Nothing is thinner than 6 cm (5 px at 1080p): the staff shaft is 5 cm and sits next to the body, outside the silhouette test's minimum feature.
- **Facing from above:** the face disc's nose ridge points forward, the staff and cup are on the right, the hood's seam runs down the back.

Pairs to test first (IoU <= 0.80 at 64 px):

- **Sukri / Ilsheta** (the two Tenders): a wide round hood with a low swinging cup versus a tall chimney visor with a chest lamp; Ilsheta's top is a vertical cylinder, Sukri's is a round dome.
- **Sukri / Hesmi** (both Hourless hooded wrappers): a compact round figure with a cup versus a large block with a flat-topped shard rack on the back.
- **Sukri / Ulkro** (both Hourless hooded): a round hood and a low cup versus a leaning hood with a fan of darts above the shoulder.

## 2. Proportions and shape (template 1)

- **Compact class** (anchor 1.6 m): height 1.65 m, head 0.30 m (5.5 heads, measured without the hood), a short neck (0.05 m), a stout trunk. The heads-to-height ratio is the lowest in the roster: the compact read.
- **Stylized heroic:** hands x1.5, forearms x1.2, boots x1.3 wide, a wide waist (the wraps), `spine_curve` 0.04 and a gentle stoop: `stance` 0.06.
- *Start values*, scaled from the reference breaker by 1.65 / 1.9 with the wraps widening the torso:

```python
PROPORTIONS = rig.proportions(height=1.65, head=0.30, neck=0.05, shoulder_width=0.50, hip_width=0.30, leg=0.74,
                              thigh_frac=0.50, arm=0.56, upper_arm_frac=0.52, hand=0.20, foot=0.28,
                              ankle_height=0.08, spine_curve=0.04, stance=0.06, toe_out_deg=8.0, knee_bend=0.015)
SHAPE = body.shape(girth=1.18, torso_w=1.25, torso_d=1.2, chest=1.2, waist=1.1, hips=1.05, arm=1.12, forearm=1.2,
                   leg=0.95, calf=1.05, hand=1.5, neck=1.1, head_w=1.1, head_d=1.08, jaw=1.0, feet=False)
```

## 3. Face (template 3)

- **Hourless hood and face disc.** A thick round hood (`kit.hood`, one rigid shell, 0.52 m wide, a dome with a 4 cm rolled edge) over a plain round carved-wood face disc 0.17 m across, set in the hood opening, with two small eye slits, a short nose ridge (4 cm, the beak and the facing cue) and a carved smile line. A linen cloth covers the jaw below the disc. No bare face, no hair.
- The hood's rolled edge shades the disc from the 52 degree camera; the disc must sit 3 cm behind the hood edge so the slits show in the portrait.

## 4. Armour, cloth and props (template 4)

- **Wraps.** Thick layered wraps (`cloth`) in three rigid bands round the torso, widest at the chest, with a rigid shoulder cape of two pale stone-coloured plates (`stone`); one rigid front panel to the knee. The wraps are the round mass.
- **Arms.** Thick sleeve wraps with leather bracers; the right hand holds the staff, the left is free and carries a coil of weighted cord at the belt (rigid, for Wrap Cast).
- **Legs.** Wrapped shins (`cloth2`), soft waxed-leather boots (`leather`) with a rounded toe.
- **Walking staff** (`prop.R`, grip at the origin, shaft along +Z): ash 1.5 m long and 5 cm thick with a crook of 0.18 m at the top, a leather grip 0.20 m at the middle and an ironstone ferrule at the foot.
- **Cup of noon light** (hangs from the crook on a 0.10 m rigid hook, `x_cup`): a clear dawnglass cup 0.16 m tall and 0.14 m wide with 2 cm bevels, glossy and never emissive; an ironstone rim band 2 cm thick; an accent core bead 3 cm across at its centre and a 2 cm accent rim inlay. The cup swings as one rigid prop: the staff-hook is a one-bone `x_cup_hook` pendulum (one of at most 2 sway bones).

Sockets (`art.json` `sockets`; the standard set stays exactly as in the content JSON):

`origin root`, `chest chest`, `head head`, `hand_r hand.R`, `hand_l hand.L`, `weapon / weapon_r prop.R`, `weapon_l prop.L`, `foot_r foot.R`, `foot_l foot.L`, plus the extras `cup x_cup` (the accent core; Mote Toss, Draw Near and Gather In start here) and `cord x_cord` (the cord coil at the belt where Wrap Cast leaves).

## 5. Palette (template 5)

Hexes are authored albedo in the bible vocabulary (`materials.bible_palette` roles). None of the reserved relationship hues (Dawn azure `#3F9CFF`, Dusk marigold `#FF9A1F`, Noonwhite `#F4EFE2`) dominates: every large-area colour is below 40% saturation inside the azure (200-225°), marigold (25-50°), heal (125-150°) and tritan (340-350°) hue bands, and no large area is lighter than L* 86. The `accent` role is authored azure; the renderer tints it per viewer.

| Role | Hex | L* | Hue / sat | Where it is used |
|---|---|---|---|---|
| `cloth2` | `#D3CCBA` | 82 | 43° / 12% | the hood shell, jaw cloth, shin wraps |
| `wood` | `#D1C3A4` | 79 | 41° / 22% | the face disc, staff |
| `stone` | `#B9B4A6` | 73 | 44° / 10% | shoulder cape plates |
| `dawnglass` | `#BDD2E0` | 83 | 204° / 16% | the cup of light (clear) |
| `cloth` | `#7E766A` | 50 | 36° / 16% | thick wraps (three bands, front panel) |
| `leather` | `#453D35` | 26 | 30° / 23% | bracers, belt, boots |
| `under` | `#372F2B` | 20 | 20° / 22% | leggings, wrap shadows |
| `ironstone` | `#4A4540` | 30 | 30° / 14% | cup rim, staff ferrule, hook |
| `ink` | `#17161A` | 8 | 255° / 15% | eye slits, hood interior |
| `accent` | `#3F9CFF` | 63 | 211° / 75% | the cup core bead and rim inlay |

## 6. Value gradient (template 6)

Light head, dark feet: the bible bands measured on screen by `lineup_qa` (top quarter L* 70-85, middle 45-65, feet 20-35; at least 40% of the silhouette at rest value). The means below are area-weighted estimates of the authored albedo before the `VALUE_GRADIENT_STOPS` ramp (x0.62 at the feet to x1.06 at the crown) and the baked top light, so the on-screen top band sits a little higher.

| Band | Target L* | Mix (share of the band) | Mean L* |
|---|---|---|---|
| top quarter (crown to chest) | 70-85 | cloth2 44%, wood 18%, stone 18%, dawnglass 8%, cloth 8%, ironstone 2%, ink 2% | **75** |
| middle half | 45-65 | cloth 52%, leather 14%, stone 8%, cloth2 10%, wood 8%, under 8% | **52** |
| feet quarter (shins down) | 20-35 | leather 40%, under 32%, cloth2 8%, ironstone 12%, cloth 8% | **31** |

The pale hood, the face disc and the shoulder cape carry the top quarter; the thick brown-grey wraps carry the middle; boots and leggings are the feet. The wrapped shins add a lighter stripe to the feet band: if lineup_qa shows feet above 35, tint the shin wraps 4 L* darker.

## 7. Accent (template 7)

The cup core bead (3 cm across, 7 cm2) and the 2 cm rim inlay ring (about 10 cm2), against roughly 7,500 cm2 of silhouette: **about 0.2%** (budget 5%), 100% in the top half (the cup hangs at about 1.15 m, above the 0.83 m half-height). At rest the emissive is 0.8; it blooms to 1.5 or more in the wind-up of Gather In, as a warning that a team-wide pull is coming. The cup swings on its hook, so the colour reads from any angle, including from above (the cup hangs 0.25 m out from the body, clear of the hood's brim).

## 8. Motion (template 8)

`MOTION = anim.motion_profile(weight="medium", weapon="staff", stance="neutral", run_ref_speed=3.4, blocks=BLOCKS)`

`BLOCKS` (the right hand holds the staff; the left is free):
- **guard / idle:** the staff held at the right side, the cup hanging from the crook a little out from the chest, the left hand loose at the belt; a soft stoop, weight even; the cup swings in a slow 4 degree pendulum.
- **run:** a rolling, steady walk-run, the staff carried across the body, the cup swinging; contact 0.32, a gentle bob of 2 cm; the hood and the shoulder cape stay rigid.
- **lobby:** the staff grounded, the cup lifted slightly; see below.

Four distinct ability gestures. Frame counts are multiples of 5 at 30 fps; the impact is at exactly 40% of the clip (frame = 0.4 × N). The sim's `castTime` is the windup before the effect lands; the clip's impact frame is the visual hit. A `castTime` of 0 means the effect starts at once, so the anticipation stays at 4 frames or fewer and the gesture must not hide a dash.

| Clip | Frames (impact) | Sim ability | Gesture |
|---|---|---|---|
| `cast_a1` | 25 (f10) | **Mote Toss** · castTime 0.25 s · 8 m lob, heal and damage | The staff swings forward and the cup tips: a short underhand lob in which the hook flicks the cup's contents toward the target (f0-f8, a held tilt), the mote leaving the cup at f10; the left hand follows through palm-up. Recover by f25. Silhouette: the cup swinging out on an arc, then back. |
| `cast_a2` | 15 (f6) | **Draw Near** · castTime 0.15 s · pull an ally up to 5 m, shield | Quick: the crook extends toward the ally with the right arm straight (f0-f3), then a sharp tug back at f6 as the sim pulls the ally in; the left hand opens in a welcoming gesture. Recover by f15. Silhouette: a long arm and staff, then a short one. On himself (cast on self) the same clip is a bow of the staff: the crook taps his own chest. |
| `cast_a3` | 25 (f10) | **Wrap Cast** · castTime 0.25 s · 8 m weighted wrap, root | The left hand uncoils the weighted cord from the belt and swings it overhead once (f0-f8), then throws it overhand at f10; the staff stays planted. Recover by f25. Silhouette: a thin loop above the head, then a long throwing arm. |
| `cast_ult` | 40 (f16) | **Gather In** · castTime 0.4 s · 10 m gather, 4 m dust ring | He raises the staff overhead with the cup high and sweeps the free arm in a wide inward arc, as if gathering a flock (f0-f12, a held pose that breathes: the cup swings); at f16 the cup flares (the accent blooms) and both arms draw to the chest. Hold f16-f30 with the cup swinging and the staff grounded, then lower. Silhouette: a round figure with a raised staff, then a hunched, drawn-in circle. |

Other clips: `run` at 3.4 m/s (medium, foot slide under 8%); `attack1` a tap of the staff and a flick of the cup that throws a bolt of light, `attack2` an underhand push of the cup (both 20 frames, impact f8, the bolt leaves at the impact frame); `death` kneels, sets the staff down and lets the cup roll to a stop (ends at rest); `recall` holds the cup in both hands and breathes on it; `stunned` staggers with the cup swinging wildly; `dash` is the rolling run loop; `taunt` raises the cup and clinks it against the staff, a clear glass note.

**`idle_lobby`** (loops, closed first = last pose): Patient and kind. He pauses on the road, turns his head to check that nobody has fallen behind, counts the people he can see with the crook as though on his fingers, finds the number right, and sets off a step before stopping again. The cup swings and settles. He smiles with the carved disc's smile line. 120 frames.

**`victory`** (ends in a hold): He sets the staff against his shoulder and lifts the cup from the hook, holds it out in his open hand as if offering a drink of noon, and the cup's light brightens the carved disc. Final hold: the cup offered at chest height, the staff on the shoulder, the hood turned a quarter from the camera. 50 frames, then the hold.

## 9. Skins (template 9)

Palette swaps plus optional extra geometry read from `ctx.skin["extra"]`. Every skin keeps the rig, clips, silhouette class (height ±5%, footprint ±10%), accent locations and value gradient; none adds metal, a single saturated full-body colour, or a reserved hue above 40% saturation. Names, tiers and descriptions come from `content/skins/sukri.json`. The named hex is the identity colour of the skin: where it falls outside a band's L* range, the surface steps lighter or darker by band and the identity hex is used at its own band.

### `sukri_base`: Sukri (base)

Points at the base files (`assets/fighters/sukri/sukri.glb`). The palette is section 5.

### `sukri_stillwater`: Stillwater Wanderer (standard)

*"Wet-stone wraps and a river-glass cup, with rigid reed plates on the hood, the colours of the Fallen Shaft shallows."*

Wet-stone wraps (`#59666A`) and a river-glass cup (`#8FB3A8`, hue 162, outside the heal band's 125-150). The wet-stone is dark, so the middle band re-mixes: the paler stone cape plates and the linen share carry more of it. **Extra geometry:** rigid reed plates on the hood, five flat strips 0.20 m long and 4 cm wide laid in a fan over the hood's dome; they stay inside the +5% height limit and duller than the accent.

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `cloth` | `#59666A` | 42 | 194° / 16% | the named wet-stone wraps #59666A |
| `dawnglass` | `#8FB3A8` | 70 | 162° / 20% | the named river-glass cup #8FB3A8 (glossy, not emissive) |
| `reed` | `#A6AC8E` | 69 | 72° / 17% | rigid reed plates on the hood (about 10% of the top band) |
| `stone` | `#C0BCB0` | 76 | 45° / 8% | shoulder cape, paler |
| `cloth2` | `#D6D1C2` | 84 | 45° / 9% | hood shell and cloth |

Value bands (area-weighted): top **76** (70-85) · mid **52** (45-65) · feet **31** (20-35).

This skin re-mixes the bands: the wet-stone wraps are darker than the base wraps, so the cape plates and the linen take a larger share of the middle band.

`SKINS` entry: `{"id": "sukri_stillwater", "palette": {...as above...}, "extra": {"reed_plates": True}, "card": {"primary": "#59666A", "secondary": "#8FB3A8"}}`

### `sukri_shadeprint`: Shadeprint Wanderer (deluxe)

*"Ink wraps with light rims and a pale hood, printed in ink and light. The cup holds violet light."*

Ink wraps (`#2B2A33`) with light-rimmed edges and a pale hood (`#B7B4BE`), printed in ink and light. `vfxTint` is `#6C5BA8` (hue 253, outside every reserved band), so the cup's light and his VFX are violet. The ink wraps are dark, so the middle band re-mixes: every wrap band carries a pale printed rim (`rim`), which supplies the value; the pale hood carries the top quarter. **No extra geometry.**

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `cloth2` | `#B7B4BE` | 74 | 258° / 5% | the named pale hood #B7B4BE (also the jaw cloth) |
| `cloth` | `#2B2A33` | 17 | 247° / 18% | the named ink wraps #2B2A33 |
| `rim` | `#C6C3CE` | 79 | 256° / 5% | the light-rimmed printed edges of every wrap band |
| `stone` | `#C0BDC8` | 77 | 256° / 5% | shoulder cape, pale |
| `wood` | `#C8BFB0` | 78 | 38° / 12% | face disc and staff |
| `dawnglass` | `#C5CFE0` | 83 | 218° / 12% | the cup of violet light (clear glass; the violet is VFX) |

Value bands (area-weighted): top **73** (70-85) · mid **54** (45-65) · feet **32** (20-35).

This skin re-mixes the bands: the ink wraps are 22% of the middle band and the light-rimmed printed edges (`rim`) are 38%; a middle band that was mostly ink would fail the L* 45 floor.

`SKINS` entry: `{"id": "sukri_shadeprint", "palette": {...as above...}, "extra": {}, "card": {"primary": "#2B2A33", "secondary": "#B7B4BE"}}`

## 10-11. Export and renders

- Splash: `SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "yaw": 22.0}`. The offered cup is the brightest point in the frame at screen-centre-right, the hood turned a quarter from the camera.
- Portrait (512 square, `idle_lobby` t 0, yaw 28): the hood's rolled edge, the face disc and the cup at the lower corner. Icon (128 square): the face disc under the hood with the cup glowing in the corner.
- GLB budget 10-25k tris and at most 1.2 MB, base and both skins.

## Per-fighter checks (on top of the template checklist)

- [ ] The figure is nearly circular (the width across the chest, wraps included, is at least 0.9 times the height from hem to hood top) and reads as a round mass with one bright dot in black at 64 px.
- [ ] IoU against Ilsheta, Hesmi and Ulkro <= 0.80; the hood is a dome, never a cylinder.
- [ ] The hood, the shoulder cape and the cup are rigid; the cup hook is one pendulum bone; the wraps use no sway bones.
- [ ] The cup core and rim inlay are the only emissive material; the glass cup stays glossy and never glows.
- [ ] `cast_a2` carries a clear extend frame and a clear tug frame (f3 and f6) so Draw Near reads as a pull; the self-cast reuses the clip.
