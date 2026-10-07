# Lisvel · Slinger: art brief

`lisvel` · Aubade (she) · standard (anchor 1.9 m, authored at 1.85 m) · 1.85 m · res_light · ranged 5.9 m phys · difficulty 1

> Source of truth: `_design/ROSTER.md` §3 entry 12, `content/fighters/lisvel.json`, `content/skins/lisvel.json`. Look law: `STYLE_BIBLE.md` (Fighters, Look rules), `_design/tokens.json` `fighter`, `WORLD.md` §2 (faces). Pipeline: `CONTRACT.md` §12, `art/README.md` and `art/blender/fighters/_template.py`; the section numbers below follow the template's 0-11. Art authors the numbers marked *start value*; the `lineup_qa` / three QA measurements decide.

Banned for every fighter: gears, clock hands, gold filigree, gems, glowing runes, metallic bevels, teal-and-gold, red-versus-green. Every material is non-metallic (metalness 0): "iron" and "steel" mean matte, painted, oxidised-looking stone or ironstone, never a bright edge. Only the `accent` material emits; dawnglass and lampresin are glossy but never emissive.

## 0. Brief

| Field | Value |
|---|---|
| `ID` (file name = content id) | `lisvel` |
| `TITLE` (collection title, never an epithet) | Morning archer |
| `ROLE_MASS` | `slinger` (Slinger; `class_slinger`) |
| `ORIGIN` | `aubade`: glass visor |
| Fight job | Shoots from far back and leaves lines of morning light her team can run along. |
| Positions | `shaftlight` / `lampglass` · bot `marksman`, preferred range 5.9 m |
| Height | **1.85 m** (class: standard (anchor 1.9 m, authored at 1.85 m)); 93 px at 1080p, 62 px at 720p (vertical px = 50.5 × height m; horizontal 82.1 px per m) |
| `art.height` / `collisionRadius` / `moveSpeed` | 1.85 m / 0.5 m / 3.35 m/s: author `run` for **3.35 m/s** (`runRefSpeed`); the content JSON still carries the 3.6 placeholder until `art.json` is copied back |
| Weapon + motion | ash longbow, 1.9 m, `bow`, held level across the body; weight `light`, stance `neutral`. Arrows come from the hip quiver, not from a prop on the bow. |
| `CARD` = `FighterDef.palette` | primary `#D8D2C2` · secondary `#8E9AA6` (collection and draft backdrops; already in the JSON) |
| Kit (for the body notes) | passive **Reach of Morning** · a1 **Dawn Line** · a2 **Backstep** · a3 **Morning Draw** · ult **Sun Corridor** |

## 1. Silhouette at 96 px

- **Mass: Slinger, horizontal.** A slim archer, shoulders 0.40 m and hips 0.28 m, holding a **1.9 m ash longbow level across her body** at chest height. The bow is 156 px wide at 1080p while she is 93 px tall: the figure is wider than it is tall, the strongest horizontal read in the roster.
- **Hook:** the longest thin horizontal in the roster. The bow's limbs are flat ash strips 6 cm wide and 2.5 cm thick (the string is a 1 cm line that does not count toward the silhouette); each tip ends in a 0.10 m glass cap that holds the accent.
- **Second read:** a gull-feather quiver at the left hip, six arrows with grey fletching standing 0.20 m above the hip, and a flat glass visor band across the eyes under a chalk head-wrap.
- **Size:** 93 px tall at 1080p (62 px at 720p); at 1.85 m she is the second-tallest Slinger by a hair, so the bow, not the height, carries the read.
- **At 64 px:** a thin figure with one long pale horizontal line through the chest and a small notch at the hip. Nothing is thinner than 6 cm in the silhouette except the string.
- **Facing from above:** the visor band is the beak (it extends 3 cm forward of the face), the bow lies across the front, and the quiver is on the left hip.

Pairs to test first (IoU <= 0.80 at 64 px):

- **Lisvel / Odrum** (the other horizontal): a thin bow at chest height with no pots versus a yoke at shoulder height with two hanging pots. If IoU passes 0.80, lower Lisvel's bow 0.08 m or lengthen it to 2.0 m.
- **Lisvel / Ulkro** (the other Slinger): a long level bow and a clean head versus a short thrower on the forearm and a crest of five darts behind a deep hood.
- **Lisvel / Vashil** (both pale Aubade): a horizontal bar through a slim body versus a vertical rod under a halo.

## 2. Proportions and shape (template 1)

- **Standard class**: height 1.85 m, head 0.29 m (6.4 heads). Long legs for a runner of the line (0.88 m of the 1.85 m is leg); a slight back-lean to balance the bow's reach.
- **Stylized heroic:** hands x1.4, boots x1.2 wide, a narrow waist, a medium neck (0.065 m). An open, upright stance: `stance` 0.03.
- *Start values*:

```python
PROPORTIONS = rig.proportions(height=1.85, head=0.29, neck=0.065, shoulder_width=0.40, hip_width=0.19, leg=0.88,
                              thigh_frac=0.50, arm=0.61, upper_arm_frac=0.52, hand=0.20, foot=0.29,
                              ankle_height=0.09, spine_curve=0.02, stance=0.03, toe_out_deg=6.0, knee_bend=0.015)
SHAPE = body.shape(girth=0.94, torso_w=0.95, torso_d=0.94, chest=0.97, waist=0.88, hips=0.93, arm=0.95, forearm=1.1,
                   leg=0.92, calf=1.0, hand=1.4, neck=1.2, head_w=1.05, head_d=1.03, jaw=1.0, feet=False)
```

## 3. Face (template 3)

- **Aubade glass visor band.** One flat dawnglass band (`kit.glass_visor`), 0.20 m wide and 5 cm tall, across the eyes over a carved chalk face-plate with ink recesses behind the glass; it extends 3 cm forward of the face as the beak and the facing cue. A chalk head-wrap covers the crown and the nape. No bare face, no hair.
- The band is flat, not curved, so it reads as a clean horizontal bar under the wrap at 96 px.

## 4. Armour, cloth and props (template 4)

- **Torso.** A short linen tunic (`cloth2`) under a blue-grey leather-and-felt tabard (`cloth`) that ends at the hip in two rigid panels (one `x_tabard` bone each); a chalk gorget; a broad chest strap (`leather`) that holds the quiver.
- **Arms.** Light linen sleeves, leather bracers; the left forearm carries a rigid chalk bracer (the bow arm), the right hand a leather tab.
- **Legs.** Close leggings (`under`), light ash-and-leather boots with a low wedge heel.
- **Longbow** (`prop.L` carries the bow in the left hand; the right hand draws): ash limbs 1.9 m long, 6 cm wide, 2.5 cm thick, with 2 cm bevels and a gentle recurve at the tips; a leather grip 0.14 m at the centre; two dawnglass tip caps 0.10 m long (glossy, never emissive) carrying accent inlays; a string as a 1 cm rigid ribbon (the draw clips deform it with one extra bone `x_string`, so the string is the only non-rigid prop part and counts as one of the two sway bones allowed).
- **Quiver** (`x_quiver` on the left hip, rigid): a waxed-leather tube 0.40 m tall with six arrows standing 0.20 m above the rim, fletched with gull-grey feather plates (rigid, not sim); the arrows in the shot are VFX.

Sockets (`art.json` `sockets`; the standard set stays exactly as in the content JSON):

`origin root`, `chest chest`, `head head`, `hand_r hand.R`, `hand_l hand.L`, `weapon / weapon_r prop.R`, `weapon_l prop.L`, `foot_r foot.R`, `foot_l foot.L`, plus the extras `arrow_nock x_arrow_nock` (every shot and Dawn Line start here) and `bow_tip_l x_bow_tip_l` / `bow_tip_r x_bow_tip_r` (the accent caps).

## 5. Palette (template 5)

Hexes are authored albedo in the bible vocabulary (`materials.bible_palette` roles). None of the reserved relationship hues (Dawn azure `#3F9CFF`, Dusk marigold `#FF9A1F`, Noonwhite `#F4EFE2`) dominates: every large-area colour is below 40% saturation inside the azure (200-225°), marigold (25-50°), heal (125-150°) and tritan (340-350°) hue bands, and no large area is lighter than L* 86. The `accent` role is authored azure; the renderer tints it per viewer.

| Role | Hex | L* | Hue / sat | Where it is used |
|---|---|---|---|---|
| `dawnglass` | `#B8D0E2` | 82 | 206° / 19% | visor band, bow tip caps |
| `chalk` | `#D6D2C6` | 84 | 45° / 7% | head-wrap, gorget, face-plate, bow-arm bracer |
| `wood` | `#D4C3A2` | 79 | 40° / 24% | ash bow limbs, quiver tube (pale ash) |
| `cloth2` | `#CFCEC6` | 83 | 53° / 4% | linen tunic and sleeves |
| `stone` | `#B2B8BD` | 74 | 207° / 6% | gull-grey fletching plates, shoulder tabs |
| `cloth` | `#707D8B` | 52 | 211° / 19% | blue-grey tabard |
| `leather` | `#433E3A` | 27 | 27° / 13% | chest strap, bracers, boots, grip |
| `under` | `#313439` | 22 | 218° / 14% | leggings |
| `ink` | `#17181B` | 8 | 225° / 15% | visor recess |
| `accent` | `#3F9CFF` | 63 | 211° / 75% | two bow-tip cap inlays |

## 6. Value gradient (template 6)

Light head, dark feet: the bible bands measured on screen by `lineup_qa` (top quarter L* 70-85, middle 45-65, feet 20-35; at least 40% of the silhouette at rest value). The means below are area-weighted estimates of the authored albedo before the `VALUE_GRADIENT_STOPS` ramp (x0.62 at the feet to x1.06 at the crown) and the baked top light, so the on-screen top band sits a little higher.

| Band | Target L* | Mix (share of the band) | Mean L* |
|---|---|---|---|
| top quarter (crown to chest) | 70-85 | chalk 24%, cloth2 24%, wood 18%, dawnglass 12%, stone 10%, cloth 8%, leather 4% | **77** |
| middle half | 45-65 | cloth 40%, cloth2 14%, leather 16%, under 12%, wood 10%, stone 8% | **53** |
| feet quarter (shins down) | 20-35 | under 44%, leather 38%, cloth 14%, wood 4% | **30** |

The head-wrap, the linen tunic and the pale bow carry the top quarter; the blue-grey tabard carries the middle; dark leggings and boots are the feet. The long pale bow crosses the top band and the upper middle band: if lineup_qa shows the bow as the brightest mid-band stripe, tint the lower limb 3 L* darker.

## 7. Accent (template 7)

The two bow-tip cap inlays, about 8 x 2 cm each = 32 cm2, against roughly 9,800 cm2 of silhouette (the bow adds about 1,000 cm2): **about 0.3%** (budget 5%), 100% in the top half (the bow is held at chest height, about 1.30 m). At rest the emissive is 0.8; it blooms to 1.5 or more in the wind-up of Sun Corridor, as a warning that the 14 m shaft is coming. The two caps are 1.9 m apart, so the colour reads from any angle, including from above.

## 8. Motion (template 8)

`MOTION = anim.motion_profile(weight="light", weapon="bow", stance="neutral", run_ref_speed=3.35, blocks=BLOCKS)`

`BLOCKS` (the left hand holds the bow, the right hand draws):
- **guard / idle:** the bow level across the body at chest height in the left hand, the right hand loosely at the string; weight even, the head turned a little as if tracking something far away.
- **run:** the bow carried level in front of the chest, the right arm pumping; contact 0.28, a light bob; the quiver and the tabard panels stay rigid.
- **lobby:** the bow lowered, the right hand conducting four counts; see below.

Four distinct ability gestures. Frame counts are multiples of 5 at 30 fps; the impact is at exactly 40% of the clip (frame = 0.4 × N). The sim's `castTime` is the windup before the effect lands; the clip's impact frame is the visual hit. A `castTime` of 0 means the effect starts at once, so the anticipation stays at 4 frames or fewer and the gesture must not hide a dash.

| Clip | Frames (impact) | Sim ability | Gesture |
|---|---|---|---|
| `cast_a1` | 25 (f10) | **Dawn Line** · castTime 0.25 s · 10 m piercing arrow, lit path | A draw and release: the bow rises from level to aim along the cast direction (f0-f8, the right hand drawing to the cheek, the string bone stretching), and the arrow leaves at f10 with a small recoil; the follow-through is the right hand opening. Recover by f25. Silhouette: a horizontal bar becoming a long diagonal. |
| `cast_a2` | 15 (f6) | **Backstep** · castTime 0.1 s · 3 m hop away | Almost instant (castTime 0.1): both feet leave the ground, the knees drawing up, the bow held level and the free hand nocking an arrow in the air; the apex is at f6 as the sim hops her 3 m at 16 m/s; she lands in a ready stance. Follow-through is the optional `dash` clip. Silhouette: a little bird of a figure with a bar across it. |
| `cast_a3` | 20 (f8) | **Morning Draw** · castTime 0 s · +attack speed for 4 s | Instant: the right hand sweeps back to the quiver, pulls three arrows and fans them between the fingers at f8, her chest lifting with a breath; then they snap back into the quiver and the hand returns to the string. The anticipation is two frames. Silhouette: a bright fan of arrows at the shoulder for a moment. |
| `cast_ult` | 35 (f14) | **Sun Corridor** · castTime 0.35 s · 14 m shaft after 0.75 s | She raises the bow over her head and draws toward the sky (f0-f10, a held pose that breathes: the string bone trembles); at f14 she lowers it to the aim line and looses a great arrow that lands the shaft of light; the body leans back with the shot. Hold the follow-through f14-f26, bow level along the cast line, then lower. Silhouette: a wide diagonal, then a long horizontal bar. |

Other clips: `run` at 3.35 m/s (light, foot slide under 8%); `attack1` a quick draw and release, `attack2` a draw with a half-step back (both 20 frames, impact f8, the arrow leaves at the impact frame); `death` drops the bow, falls to her knees and topples sideways (ends at rest); `recall` lowers the bow and holds the string like a harp, humming; `stunned` stumbles with the bow raised; `dash` is the hop loop; `taunt` taps the bow tip on the ground twice, a clear glass note.

**`idle_lobby`** (loops, closed first = last pose): Open and unhurried. She stands with the bow lowered, the right hand conducting four slow counts of the dawn motif, then stops, head tilted, as if waiting for someone else to supply the fifth. She looks over her shoulder at the camera, smiles behind the visor, and counts again. 120 frames.

**`victory`** (ends in a hold): She looses an arrow along the ground and a line of light runs out from her feet toward the camera's far side; she steps onto it. Final hold: the bow level across her body, the free hand raised to the visor in a salute to the dawn, a quarter turned from the camera, the glass tip caps catching the light. 50 frames, then the hold.

## 9. Skins (template 9)

Palette swaps plus optional extra geometry read from `ctx.skin["extra"]`. Every skin keeps the rig, clips, silhouette class (height ±5%, footprint ±10%), accent locations and value gradient; none adds metal, a single saturated full-body colour, or a reserved hue above 40% saturation. Names, tiers and descriptions come from `content/skins/lisvel.json`. The named hex is the identity colour of the skin: where it falls outside a band's L* range, the surface steps lighter or darker by band and the identity hex is used at its own band.

### `lisvel_base`: Lisvel (base)

Points at the base files (`assets/fighters/lisvel/lisvel.glb`). The palette is section 5.

### `lisvel_gorgewalk`: Gorgewalk Longbow (standard)

*"Slate-grey limbs bound with rigid gorge-rope and an iron-pinned quiver, as carried by the keepers of the Needlespan gorge."*

Slate-grey bow limbs (`#6E747C`, hue 214, 11% saturation) bound with rigid gorge-rope (`#9A8F7A`) at the grip and the tips, and an iron-pinned quiver: the pins are painted ironstone, matte, no bright edge. The slate limbs are the deep tone of the bow; the head-wrap and the tunic stay light so the top quarter holds its value. **No extra geometry** (the rope is a texture and one rigid collar at each end).

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `wood` | `#6E747C` | 49 | 214° / 11% | the named slate-grey limbs #6E747C (bow, quiver tube) |
| `rope` | `#9A8F7A` | 60 | 39° / 21% | the named gorge-rope #9A8F7A (grip and tip bindings) |
| `chalk` | `#D2D2CE` | 84 | 60° / 2% | head-wrap, gorget, pale stone |
| `cloth2` | `#CFCFCA` | 83 | 60° / 2% | tunic |
| `cloth` | `#6B7885` | 50 | 210° / 20% | tabard |
| `ironstone` | `#3F4348` | 28 | 213° / 12% | quiver pins, buckles |

Value bands (area-weighted): top **75** (70-85) · mid **49** (45-65) · feet **29** (20-35).

This skin re-mixes the top band: the slate bow is darker than the ash bow, so the head-wrap and tunic take a larger share of the band.

`SKINS` entry: `{"id": "lisvel_gorgewalk", "palette": {...as above...}, "extra": {}, "card": {"primary": "#6E747C", "secondary": "#9A8F7A"}}`

### `lisvel_almanac`: Almanac Longbow (deluxe)

*"Parchment-printed limbs and ink fletching from the season almanac. The arrows are fletched with rigid page-cut plates."*

Bow limbs printed with parchment (`#D8CDB4`) ruled in fine ink lines, and ink fletching (`#2E2A26`) on the quiver arrows, like a page of the almanac. **Extra geometry:** the six quiver arrows are fletched with rigid page-cut plates (flat 3 x 8 cm rectangles, 3 mm thick) instead of the gull-feather plates; the quiver's silhouette stays within the footprint limit.

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `wood` | `#D8CDB4` | 83 | 42° / 17% | the named parchment-printed limbs #D8CDB4 (ruled in ink, texture only) |
| `fletching` | `#2E2A26` | 17 | 30° / 17% | the named ink fletching #2E2A26 (page plates on the arrows, 4% of the top band) |
| `chalk` | `#D6D2C6` | 84 | 45° / 7% | head-wrap, gorget |
| `cloth` | `#7A7E86` | 53 | 220° / 9% | tabard, parchment-grey |

Value bands (area-weighted): top **78** (70-85) · mid **54** (45-65) · feet **30** (20-35).

This skin re-mixes the top band: the ink fletching plates are 4% of the top band (the rest of the arrow is pale).

`SKINS` entry: `{"id": "lisvel_almanac", "palette": {...as above...}, "extra": {"page_fletching": True}, "card": {"primary": "#4A4640", "secondary": "#D8CDB4"}}`

## 10-11. Export and renders

- Splash: `SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "yaw": 22.0}`. The bow level across the frame and the salute hand at the visor; the line of light runs out toward screen-right, away from the UI side.
- Portrait (512 square, `idle_lobby` t 0, yaw 28): the visor band, the head-wrap and the near bow tip cap. Icon (128 square): the visor band under the wrap, with one bow tip in the corner.
- GLB budget 10-25k tris and at most 1.2 MB, base and both skins.

## Per-fighter checks (on top of the template checklist)

- [ ] The bow is at least 1.9 m, level across the body, and reads as a long horizontal in black at 64 px; the string is excluded from the silhouette test.
- [ ] IoU against Odrum and Ulkro <= 0.80; the bow is visibly thinner and higher than Odrum's yoke.
- [ ] The string is the only non-rigid prop part and uses one bone; the quiver, the tabard and the bow limbs are rigid.
- [ ] The two tip-cap inlays are the only emissive material; the glass visor and tip caps are glossy but never glow.
- [ ] The `cast_a1` draw and the `attack1` draw release the arrow exactly at the impact frame (f10 and f8).
