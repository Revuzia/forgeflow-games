# Odrum · Slinger: art brief

`odrum` · Serenade (he) · standard (anchor 1.9 m, authored at 1.9 m) · 1.9 m · res_light · ranged 5.6 m phys · difficulty 2

> Source of truth: `_design/ROSTER.md` §3 entry 4, `content/fighters/odrum.json`, `content/skins/odrum.json`. Look law: `STYLE_BIBLE.md` (Fighters, Look rules), `_design/tokens.json` `fighter`, `WORLD.md` §2 (faces). Pipeline: `CONTRACT.md` §12, `art/README.md` and `art/blender/fighters/_template.py`; the section numbers below follow the template's 0-11. Art authors the numbers marked *start value*; the `lineup_qa` / three QA measurements decide.

Banned for every fighter: gears, clock hands, gold filigree, gems, glowing runes, metallic bevels, teal-and-gold, red-versus-green. Every material is non-metallic (metalness 0): "iron" and "steel" mean matte, painted, oxidised-looking stone or ironstone, never a bright edge. Only the `accent` material emits; dawnglass and lampresin are glossy but never emissive.

## 0. Brief

| Field | Value |
|---|---|
| `ID` (file name = content id) | `odrum` |
| `TITLE` (collection title, never an epithet) | Amber setter |
| `ROLE_MASS` | `slinger` (Slinger; `class_slinger`) |
| `ORIGIN` | `serenade`: carved or lacquered mask |
| Fight job | Pours resin under the enemy front line; whoever is still standing in it when it sets is stuck. |
| Positions | `shaftlight` / `shadehold` · bot `marksman`, preferred range 5.6 m |
| Height | **1.9 m** (class: standard (anchor 1.9 m, authored at 1.9 m)); 96 px at 1080p, 64 px at 720p (vertical px = 50.5 × height m; horizontal 82.1 px per m) |
| `art.height` / `collisionRadius` / `moveSpeed` | 1.9 m / 0.55 m / 3.35 m/s: author `run` for **3.35 m/s** (`runRefSpeed`); the content JSON still carries the 3.6 placeholder until `art.json` is copied back |
| Weapon + motion | a 2.2 m walnut staff-sling carried level across the shoulders like a yoke, `staff`; weight `medium`, stance `neutral`. |
| `CARD` = `FighterDef.palette` | primary `#7A6550` · secondary `#BBA27F` (collection and draft backdrops; already in the JSON) |
| Kit (for the body notes) | passive **Cracked Amber** · a1 **Resin Shot** · a2 **Swing Out** · a3 **Step and Load** · ult **Amber Hour** |

## 1. Silhouette at 96 px

- **Mass: Slinger, horizontal.** A long weapon held across the body. The 2.2 m staff-sling rides level across the shoulders at 1.52 m, 181 px wide at 1080p against a figure 96 px tall: the widest horizontal read in the roster.
- **Hook:** a rigid resin pot hangs at each end of the yoke (0.24 m wide, 0.26 m tall, hung 0.10 m below the staff on a short rigid cord), so the bar ends in two blobs. The accent windows are in the two pots.
- **Under the bar:** a narrow upright body (shoulders 0.46 m), a domed felt cap 0.34 m across and a knee-length felt jerkin.
- **At 64 px:** a horizontal bar one head below the crown, two hanging blobs at the ends, a narrow body below: a balance scale. No other fighter has a bar this wide, but check the span: skins may not exceed the 2.2 m span by more than 10% (2.42 m).
- **Facing from above:** the sling pouch hangs at the staff's right end (a leather bag, 0.14 m), the mask's beak points forward, and the cap has a 4 cm stitched front peak.

Pairs to test first (IoU <= 0.80 at 64 px):

- **Odrum / Lisvel** (half B): a thin bow at waist height versus a yoke at shoulder height with hanging pots.
- **Odrum / Dunsom** (both Serenade, both staff users): a horizontal bar and a narrow cap versus a vertical crook and a broad round hood-rim.
- **Odrum / Marund:** a narrow figure under a wide bar versus a wide disc over a stooped block.

## 2. Proportions and shape (template 1)

- **Standard class**: height 1.90 m, head 0.30 m (6.3 heads). A lean slinger: narrow shoulders (0.46 m), because the yoke supplies the width.
- **Stylized heroic:** hands x1.4 (they hold the staff), boots x1.2 wide; arms long enough to hook over the yoke in `idle` (arm 0.62 m).
- *Start values:*

```python
PROPORTIONS = rig.proportions(height=1.90, head=0.30, neck=0.06, shoulder_width=0.46, hip_width=0.20, leg=0.85,
                              thigh_frac=0.50, arm=0.62, upper_arm_frac=0.52, hand=0.21, foot=0.31,
                              ankle_height=0.095, spine_curve=0.02, stance=0.04, toe_out_deg=8.0, knee_bend=0.014)
SHAPE = body.shape(girth=0.98, torso_w=1.0, torso_d=1.0, chest=1.0, waist=0.92, hips=0.94, arm=1.0, forearm=1.15,
                   leg=0.94, calf=1.0, hand=1.4, neck=1.2, head_w=1.08, head_d=1.06, jaw=1.05, feet=False)
```

## 3. Face (template 3)

- **Serenade carved ochre mask.** A carved mask in ochre sandstone (`kit.carved_mask`): planar facets, a brow shelf of at least 6 cm, ink almond eye recesses and a beak keel (`kit.mask_beak`, 4 cm) as the facing cue. A domed felt cap (`cloth2`) sits above it, with a 4 cm stitched peak; the cap's brim shades the brow without hiding the eyes at the portrait angle.
- No bare face, no hair; a linen mouth-wrap (`cloth2`) under the mask.

## 4. Armour, cloth and props (template 4)

- **Jerkin.** A knee-length heavy felt jerkin (`cloth`) with sculpted vertical folds, a front panel on one `x_jerkin_f` chain and a back panel on `x_jerkin_b`; rolled sleeves; leather cross-straps. A leather pellet pouch on the right hip (for the resin pellets of Step and Load), rigid.
- **Legs.** Dark trousers (`under`), waxed-leather boots (x1.2 wide) with ironstone toe caps.
- **Prop: the yoke, a staff-sling** (prop space: grip at the origin, shaft +Z, length 2.2 m). Carved pale walnut (`wood`, oiled, not dark) with three 6 cm grip bands (`leather`) and a ring of lampresin at each end. The right end carries the sling: a leather pouch 0.14 m with a short rigid cord loop. At rest the staff sits across the shoulders; in casts it comes off into both hands.
- **Pots.** Two carved sandstone pots (`sandstone`), 0.24 m wide, hung on short rigid leather cords from the staff ends. Each has a rim opening showing lampresin resin and a round `accent` window 12 cm across on the side facing the camera. The pots are rigid children of the staff (`x_pot_l`, `x_pot_r` as sockets, no sway), clear of the shoulders by 8 cm in every pose.

Sockets (`art.json` `sockets`; the standard set stays exactly as in the content JSON):

`origin root`, `chest chest`, `head head`, `hand_r hand.R`, `hand_l hand.L`, `weapon / weapon_r prop.R`, `weapon_l prop.L`, `foot_r foot.R`, `foot_l foot.L`, plus the extras `weapon_tip x_sling_pouch` (the lob origin for Resin Shot and Amber Hour), `pot_l x_pot_l` and `pot_r x_pot_r` (resin drip and the glow bloom), and `pellet x_pellet` (the amber bead shown on the pouch when Step and Load is armed).

## 5. Palette (template 5)

Hexes are authored albedo in the bible vocabulary (`materials.bible_palette` roles). None of the reserved relationship hues (Dawn azure `#3F9CFF`, Dusk marigold `#FF9A1F`, Noonwhite `#F4EFE2`) dominates: every large-area colour is below 40% saturation inside the azure (200-225°) and marigold (25-50°) hue bands, and no large area is lighter than L* 86. The `accent` role is authored azure; the renderer tints it per viewer.

| Role | Hex | L* | Hue / sat | Where it is used |
|---|---|---|---|---|
| `sandstone` | `#D8C19D` | 79 | 37° / 27% | carved ochre mask, resin pots |
| `cloth2` | `#CDBFA8` | 78 | 37° / 18% | domed felt cap, mouth-wrap, collar |
| `wood` | `#C2A683` | 70 | 33° / 32% | the staff-sling yoke (oiled pale walnut) |
| `wood_dark` | `#634C3E` | 34 | 23° / 37% | staff end caps, cord pegs |
| `cloth` | `#8D7D6B` | 53 | 32° / 24% | felt jerkin and sleeves |
| `lampresin` | `#C48D4A` | 63 | 33° / 62% | resin in the pots, staff-end rings (under 4% of the silhouette) |
| `leather` | `#4D3D32` | 27 | 24° / 35% | cross-straps, pouch, boots, grip bands |
| `under` | `#3A3532` | 23 | 23° / 14% | trousers |
| `ironstone` | `#453B35` | 26 | 23° / 23% | toe caps |
| `ink` | `#17181B` | 8 | 225° / 15% | mask eye recesses |
| `accent` | `#3F9CFF` | 63 | 211° / 75% | the two pot windows |

The yoke is the largest warm area: it is pale oiled walnut (hue 34 degrees, 32% saturation), under the 40% limit. Lampresin is the one saturated warm role and stays under 4% of the silhouette.

## 6. Value gradient (template 6)

Light head, dark feet: the bible bands measured on screen by `lineup_qa` (top quarter L* 70-85, middle 45-65, feet 20-35; at least 40% of the silhouette at rest value). The means below are area-weighted estimates of the authored albedo before the `VALUE_GRADIENT_STOPS` ramp (x0.62 at the feet to x1.06 at the crown) and the baked top light, so the on-screen top band sits a little higher.

| Band | Target L* | Mix (share of the band) | Mean L* |
|---|---|---|---|
| top quarter (crown to chest) | 70-85 | cloth2 32%, sandstone 26%, wood 26%, cloth 6%, lampresin 4%, leather 3%, wood_dark 3% | **71** |
| middle half | 45-65 | cloth 50%, leather 16%, under 12%, wood 8%, sandstone 8%, wood_dark 6% | **48** |
| feet quarter (shins down) | 20-35 | under 46%, leather 34%, ironstone 14%, cloth 6% | **26** |

The yoke sits at shoulder height, inside the top quarter, so it must be pale walnut (L* 70), not dark walnut; the felt cap and the ochre mask are the lightest forms. The jerkin is mid (L* 53); the trousers and boots are the feet band. If the top band measures under 70, lighten the yoke before the cap.

## 7. Accent (template 7)

Two round pot windows, 12 cm across (226 cm2) against roughly 15,800 cm2 of silhouette: **about 1.4%** (budget 5%), both in the top half (the pots hang at 1.16-1.42 m, 61-75% of the height). At rest the emissive is 0.8; the pots bloom to 1.5 or more only in the wind-ups of Resin Shot and Amber Hour (the windows read as resin about to be thrown). In `idle` the window on the camera side is always visible because the pots hang in front of the bar's plane.

## 8. Motion (template 8)

`MOTION = anim.motion_profile(weight="medium", weapon="staff", stance="neutral", run_ref_speed=3.35, blocks=BLOCKS)`

`BLOCKS`:
- **guard / idle:** the staff across the shoulders, both forearms hooked over it, hands hanging; the pots hang level. Breathing lifts the bar 1 cm.
- **run_fwd / run_back:** the staff stays on the shoulders (hands on the bar 0.5 m apart), the pots bob with the shoulders but stay rigid to the staff; contact 0.32.
- **lobby:** arms hooked over the bar, the right hand free to tap a pot.

Four distinct ability gestures. Frame counts are multiples of 5 at 30 fps; the impact is at exactly 40% of the clip (frame = 0.4 × N). The sim's `castTime` is the windup before the effect lands; the clip's impact frame is the visual hit. A `castTime` of 0 means the effect starts at once, so the anticipation stays at 4 frames or fewer and the gesture must not hide a dash.

| Clip | Frames (impact) | Sim ability | Gesture |
|---|---|---|---|
| `cast_a1` | 30 (f12) | **Resin Shot** · castTime 0.25 s · lob up to 9 m, resin pool 2.5 m | The staff comes off the shoulders into both hands (f0-f5), the right pot tilts to pour resin into the sling pouch (f5-f9), then an overhead swing down and forward with the release at f12: the pouch snaps open, the lob arcs high. Follow-through to f20 with the staff pointing at the target, recover to the shoulders by f30. Silhouette: the bar swings from horizontal to a long diagonal. |
| `cast_a2` | 30 (f12) | **Swing Out** · castTime 0.2 s · whirl, 3 m, slow and haste | A full 360 degree whirl at waist height with the staff in both hands, the pots at the ends sweeping a wide circle; the impact at f12 is the first pass through the front, the whirl ends at f20 with him already leaning into a run (the haste). Silhouette: a spinning cross, then a lunge forward. |
| `cast_a3` | 20 (f8) | **Step and Load** · castTime 0 s · hop 3.5 m, next attack loaded | Instant (castTime 0): a short hop back (a tucked-knee hop for the sim dash), the right hand thumbing a resin pellet from the hip pouch into the sling (f0-f6), landing at f8 with the staff held at 45 degrees and a small amber bead visible in the sling pouch (the "loaded" read). Silhouette: a crouched hop with the bar tilting up. |
| `cast_ult` | 45 (f18) | **Amber Hour** · castTime 0.35 s · lob up to 12 m, 5 m pool | He lifts the whole yoke off the shoulders and whirls it in a big vertical windmill, two full circles (f0-f14), the pots whipping around with the staff (rigid), then a full-body lean back and a throw: the great resin ball leaves the pouch at f18. Follow-through to f30 with the staff low and the pots swinging to rest, then back to the shoulders by f45. Silhouette: a spinning wheel, then a long arm. |

Other clips: `run` at 3.35 m/s (medium, foot slide under 8%); `attack1` a short pellet flick from the sling, `attack2` a staff jab (25 frames, impact f10; a ranged basic attack: the lob is the `attack` sfx/vfx, the clip is the flick); `death` slumps to his knees and sets the yoke down in front of him (ends at rest); `recall` hangs both pots on the staff and bows; `stunned` the bar slips off one shoulder; `dash` and `taunt` follow the standard generators.

**`idle_lobby`** (loops, closed first = last pose): Easygoing. He leans on the yoke with both arms hooked over it, taps the nearest pot with a knuckle to hear it ring, dips a finger in the resin and pulls a thread, rolls it between finger and thumb, and bobs his head to a tune only he hears. 120 frames.

**`victory`** (ends in a hold): He swings the yoke up onto his shoulders with a flourish, one pot catching the light, and tips his cap with two fingers; a single drop of resin falls from a pot rim. Final hold: arms hooked over the bar, one foot forward, the cap tipped. 60 frames, then the hold.

## 9. Skins (template 9)

Palette swaps plus optional extra geometry read from `ctx.skin["extra"]`. Every skin keeps the rig, clips, silhouette class (height ±5%, footprint ±10%), accent locations and value gradient; none adds metal, a single saturated full-body colour, or a reserved hue above 40% saturation. Names, tiers and descriptions come from `content/skins/odrum.json`. The named hex is the identity colour of the skin: where it falls outside a band's L* range, the surface steps lighter or darker by band and the identity hex is used at its own band.

### `odrum_base`: Odrum (base)

Points at the base files (`assets/fighters/odrum/odrum.glb`). The palette is section 5.

### `odrum_noon_fair`: Noon Fair Yoke (standard)

*"A rose-lilac lacquered yoke hung with painted paper lanterns and rigid ribbons, dressed for the Shadowless Noon fair."*

A rose-lilac lacquered yoke (`#B48AA6`, hue 320), the pots replaced by painted paper lanterns (`#E2D6C4`), and rigid ribbons dressed for the Shadowless Noon fair. **Extra geometry:** two paper lanterns replace the pots (round shells 0.26 m, the accent window stays on the camera side and is the only emissive); two ribbon pairs, one at each staff end, on **two sway bones in total** (`x_ribbon_l`, `x_ribbon_r`, one bone each, damped, 0.25 m long); the span stays under 2.42 m. The lantern paper is the lightest area (L* 86) and stays under 8% of the silhouette.

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `sandstone` | `#D8C19D` | 79 | 37° / 27% | mask |
| `cloth2` | `#D0C3AE` | 79 | 37° / 16% | cap |
| `wood` | `#B48AA6` | 62 | 320° / 23% | the named lilac lacquered yoke #B48AA6 |
| `lampresin` | `#C48D4A` | 63 | 33° / 62% | lantern frame rims |
| `paper` | `#E2D6C4` | 86 | 36° / 13% | the named paper lanterns #E2D6C4 |

Value bands (area-weighted): top **70** (70-85) · mid **47** (45-65) · feet **26** (20-35).

`SKINS` entry: `{"id": "odrum_noon_fair", "palette": {...as above...}, "extra": {"paper_lanterns": True, "ribbons": True}, "card": {"primary": "#6A4F5F", "secondary": "#E2D6C4"}}`

### `odrum_shadeprint`: Shadeprint Yoke (deluxe)

*"Ink-wash below, pale above, with light-rimmed edges; his resin pots become ink pots and his pools set in violet."* `vfxTint` `#7A6BB0`.

Ink-wash lower body (`#2B2A33`) with light-rimmed edges and a pale upper body (`#B7B4BE`), so the value gradient holds; the pots become ink pots (dark bodies with a pale rim and the accent window). `vfxTint` is `#7A6BB0` (hue 253): it tints the resin pools and the pot-rim resin only, never the accent. **Extra geometry:** none; the ink pots are the same shape with a pale rim band.

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `sandstone` | `#B7B4BE` | 74 | 258° / 5% | the named pale upper body #B7B4BE (mask) |
| `cloth2` | `#CFCBD6` | 82 | 262° / 5% | pale cap |
| `wood` | `#C9C5D0` | 80 | 262° / 5% | pale yoke |
| `wood_dark` | `#2B2A33` | 17 | 247° / 18% | ink staff end caps |
| `cloth` | `#8A8896` | 57 | 249° / 9% | ink-wash jerkin, mid |
| `lampresin` | `#7A6BB0` | 49 | 253° / 39% | violet-grey resin rim (matches `vfxTint` #7A6BB0) |
| `leather` | `#3A3942` | 24 | 247° / 14% | ink straps and boots |
| `under` | `#34333C` | 22 | 247° / 15% | ink trousers |
| `ironstone` | `#2B2A33` | 17 | 247° / 18% | the named ink #2B2A33 (toe caps) |
| `pot` | `#2B2A33` | 17 | 247° / 18% | the named ink #2B2A33 (pot bodies) |

Value bands (area-weighted): top **70** (70-85) · mid **49** (45-65) · feet **24** (20-35).

`SKINS` entry: `{"id": "odrum_shadeprint", "palette": {...as above...}, "extra": {"ink_pots": True}, "card": {"primary": "#2B2A33", "secondary": "#B7B4BE"}}`

## 10-11. Export and renders

- Splash: `SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92}`. The tipped-cap hold lets the yoke run across the frame at 73% of the width; the span fills the subject columns, so use `fill` 0.80 to keep the pots inside the frame.
- Portrait (512 square, `idle_lobby` t 0, yaw 28): the mask under the cap with the near pot and its lit window in the corner of the frame. Icon (128 square): the mask and cap with the pot window beside it.
- GLB budget 10-25k tris and at most 1.2 MB, base and both skins.

## Per-fighter checks (on top of the template checklist)

- [ ] The yoke spans 2.2 m (+/-10% in skins) and reads as a horizontal bar one head below the crown in black at 64 px.
- [ ] IoU against Dunsom and Marund <= 0.80; check Lisvel when half B exists.
- [ ] The pots stay rigid on the staff in every clip and clear the shoulders by at least 8 cm; no sway bone in the base model.
- [ ] The camera-side pot window is visible in `idle`, `run` and the four casts; the windows are the only emissive pixels at rest.
- [ ] `cast_a3` has at most 4 frames of anticipation (castTime 0).
