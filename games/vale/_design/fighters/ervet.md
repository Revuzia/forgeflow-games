# Ervet · Breaker: art brief

`ervet` · Aubade (she) · large, lean end (anchor 2.4 m, authored at 2.1 m) · 2.1 m · res_light · melee 2.0 m phys · difficulty 2

> Source of truth: `_design/ROSTER.md` §3 entry 10, `content/fighters/ervet.json`, `content/skins/ervet.json`. Look law: `STYLE_BIBLE.md` (Fighters, Look rules), `_design/tokens.json` `fighter`, `WORLD.md` §2 (faces). Pipeline: `CONTRACT.md` §12, `art/README.md` and `art/blender/fighters/_template.py`; the section numbers below follow the template's 0-11. Art authors the numbers marked *start value*; the `lineup_qa` / three QA measurements decide.

Banned for every fighter: gears, clock hands, gold filigree, gems, glowing runes, metallic bevels, teal-and-gold, red-versus-green. Every material is non-metallic (metalness 0): "iron" and "steel" mean matte, painted, oxidised-looking stone or ironstone, never a bright edge. Only the `accent` material emits; dawnglass and lampresin are glossy but never emissive.

## 0. Brief

| Field | Value |
|---|---|
| `ID` (file name = content id) | `ervet` |
| `TITLE` (collection title, never an epithet) | Glass blade |
| `ROLE_MASS` | `breaker` (Breaker; `class_breaker`) |
| `ORIGIN` | `aubade`: glass visor |
| Fight job | Shatters her own blade into the enemy line, fights fast with the hilt, then swings it whole again. |
| Positions | `shadehold` / `dialcross` · bot `skirmisher`, preferred range 2 m |
| Height | **2.1 m** (class: large, lean end (anchor 2.4 m, authored at 2.1 m)); 106 px at 1080p, 71 px at 720p (vertical px = 50.5 × height m; horizontal 82.1 px per m) |
| `art.height` / `collisionRadius` / `moveSpeed` | 2.1 m / 0.6 m / 3.45 m/s: author `run` for **3.45 m/s** (`runRefSpeed`); the content JSON still carries the 3.6 placeholder until `art.json` is copied back |
| Weapon + motion | oversized dawnglass greatsword, `two_hand`, carried point-low on the right side; weight `medium`, stance `guard`. Three blade states share one set of clips (see section 4): whole, Hilt and Great. |
| `CARD` = `FighterDef.palette` | primary `#B9C4CC` · secondary `#5D6B7C` (collection and draft backdrops; already in the JSON) |
| Kit (for the body notes) | passive **Dawnglass Edge** · a1 **Heavy Arc / Quick Jab** · a2 **Glass Guard / Shard Kick** · a3 **Shatter / Reform** · ult **Whole Again** |

## 1. Silhouette at 96 px

- **Mass: Breaker, inverted wedge.** A heavy blued mantle makes shoulders 0.80 m against hips of 0.30 m (2.7 : 1) and greaves of 0.22 m at the ankle: the figure narrows steadily from the shoulders to the feet.
- **Hook:** a **1.6 m translucent blade carried point-low** on the right side, a pale diagonal bar from hip to ankle (81 px long at 1080p) that no other fighter has. The blade is 0.16 m wide and 2 cm thick; the crossguard (0.44 m) holds the accent.
- **Hilt form** is a deliberately different read: the blade is gone and a short jagged stub of 0.30 m (a broken sliver of the same glass) stands in the fist, so the silhouette loses its long diagonal and becomes a plain wedge. This is the cue that she is fast and fragile.
- **Great form** (the ultimate) is the whole blade again but oversized: 2.2 m long and 0.30 m wide, still point-low, longer than she is tall below the shoulder.
- **Size:** 106 px tall at 1080p (71 px at 720p). The wedge reads from the mantle's flat top edge down to a pointed base.
- **At 64 px:** a dark top-heavy triangle with one pale diagonal on the right (whole) or no diagonal at all (Hilt). Nothing is thinner than 6 cm (5 px): the blade's 16 cm face is the thinnest part.
- **Facing from above:** the slit visor's tip points forward, the blade lies on the right, the longer mantle point (the left pauldron) is on the left.

Pairs to test first (IoU <= 0.80 at 64 px):

- **Ervet / Kemdo** (inverted wedge with a tall pole on one side): a low diagonal blade versus an upright glaive. Kemdo's pole is vertical, Ervet's blade is at 55 degrees from vertical, point-low.
- **Ervet / Burdam:** a translucent blade carried low versus a dark cleaver lying across the shoulder (a bar above the head).
- **Ervet in Hilt form / Rishal:** the Hilt silhouette must not read as a Striker; keep the mantle at full width in both forms.

## 2. Proportions and shape (template 1)

- **Large class**, lean end (anchor 2.4 m): height 2.10 m, head 0.32 m (6.5 heads). Narrow waist and long legs so the wedge reads.
- **Stylized heroic:** hands x1.5, forearms x1.3, boots x1.2 wide, a medium neck (0.06 m) so the visor sits clear of the mantle. A forward-leaning guard stance: `spine_curve` 0.03.
- *Start values*, scaled from the reference breaker by 2.1 / 1.9:

```python
PROPORTIONS = rig.proportions(height=2.10, head=0.32, neck=0.06, shoulder_width=0.56, hip_width=0.22, leg=0.98,
                              thigh_frac=0.50, arm=0.68, upper_arm_frac=0.52, hand=0.23, foot=0.33,
                              ankle_height=0.10, spine_curve=0.03, stance=0.05, toe_out_deg=7.0, knee_bend=0.02)
SHAPE = body.shape(girth=1.0, torso_w=1.15, torso_d=1.02, chest=1.12, waist=0.86, hips=0.88, arm=1.05, forearm=1.3,
                   leg=0.9, calf=1.0, hand=1.5, neck=1.2, head_w=1.04, head_d=1.03, jaw=1.0, feet=False)
```

## 3. Face (template 3)

- **Aubade glass visor.** One tall slit pane of dawnglass (`kit.glass_visor`), 0.26 m tall and 6 cm wide, over a carved chalk face-plate with an ink recess behind the glass. The slit's lower tip lengthens into a 4 cm beak that is the facing cue from above. A chalk brow plate runs back into a low rigid crest (0.12 m).
- No bare face, no hair; the crest is carved stone, one rigid piece.

## 4. Armour, cloth and props (template 4)

- **Mantle.** A heavy blued-steel mantle in matte painted plates (`cloth`, no gloss): three overlapping shoulder lames on each side, 0.80 m across at its widest, flat on top and a little higher on the left, with 3 cm bevels. It is the widest edge on the figure and carries the Breaker read.
- **Torso and arms.** A close under-suit (`under`), a chalk breastplate, blued vambraces; a light linen scarf (`cloth2`) knotted at the right shoulder (rigid, one-bone `x_scarf`).
- **Legs.** Narrow ironstone greaves over dark leggings and dark `leather` boots, so the figure narrows to a point.
- **Greatsword** (`prop.R`, grip at the origin, blade along -Z; at rest the grip is at chest height on the right, pommel at the shoulder, the blade angled 55 degrees down and forward, point 0.35 m above the ground). The whole blade is dawnglass 1.6 m x 0.16 m x 2 cm with 2 cm bevels, glossy, never emissive; a chalk crossguard 0.44 m wide with a carved-stone pommel; leather-wrapped grip 0.30 m. The accent is two glass inlays in the crossguard's ends.
- **Three blade states in one GLB**, as separate mesh nodes the renderer toggles by form: `blade_whole` (above), `blade_hilt` (the same crossguard and grip with a 0.30 m jagged stub, sharing the grip and the accent inlays) and `blade_great` (2.2 m x 0.30 m x 3 cm, the same material). The skeleton and clips are identical for all three; only the prop node changes. The shard field Shatter leaves is a VFX preset, not geometry.

Sockets (`art.json` `sockets`; the standard set stays exactly as in the content JSON):

`origin root`, `chest chest`, `head head`, `hand_r hand.R`, `hand_l hand.L`, `weapon / weapon_r prop.R`, `weapon_l prop.L`, `foot_r foot.R`, `foot_l foot.L`, plus the extras `blade_tip x_blade_tip` (where Heavy Arc's sweep and Shatter's smash start; the tip moves with the active blade node) and `crossguard x_crossguard` (the accent).

## 5. Palette (template 5)

Hexes are authored albedo in the bible vocabulary (`materials.bible_palette` roles). None of the reserved relationship hues (Dawn azure `#3F9CFF`, Dusk marigold `#FF9A1F`, Noonwhite `#F4EFE2`) dominates: every large-area colour is below 40% saturation inside the azure (200-225°), marigold (25-50°), heal (125-150°) and tritan (340-350°) hue bands, and no large area is lighter than L* 86. The `accent` role is authored azure; the renderer tints it per viewer.

| Role | Hex | L* | Hue / sat | Where it is used |
|---|---|---|---|---|
| `dawnglass` | `#B6CEE0` | 82 | 206° / 19% | blade (translucent), visor pane |
| `chalk` | `#CFCFCB` | 83 | 60° / 2% | breastplate, crossguard, face-plate, crest |
| `stone` | `#AEB6BD` | 74 | 208° / 8% | upper mantle lames |
| `cloth2` | `#C6C7C1` | 80 | 70° / 3% | scarf |
| `cloth` | `#6A7683` | 49 | 211° / 19% | blued mantle and vambraces |
| `leather` | `#403D3B` | 26 | 24° / 8% | boots, grip wrap, belt |
| `ironstone` | `#3B4048` | 27 | 217° / 18% | greaves |
| `under` | `#303338` | 21 | 218° / 14% | leggings, under-suit |
| `ink` | `#17181B` | 8 | 225° / 15% | visor recess |
| `accent` | `#3F9CFF` | 63 | 211° / 75% | crossguard inlays |

## 6. Value gradient (template 6)

Light head, dark feet: the bible bands measured on screen by `lineup_qa` (top quarter L* 70-85, middle 45-65, feet 20-35; at least 40% of the silhouette at rest value). The means below are area-weighted estimates of the authored albedo before the `VALUE_GRADIENT_STOPS` ramp (x0.62 at the feet to x1.06 at the crown) and the baked top light, so the on-screen top band sits a little higher.

| Band | Target L* | Mix (share of the band) | Mean L* |
|---|---|---|---|
| top quarter (crown to chest) | 70-85 | stone 34%, chalk 28%, dawnglass 14%, cloth2 8%, cloth 10%, ironstone 6% | **73** |
| middle half | 45-65 | cloth 38%, under 16%, dawnglass 14%, chalk 12%, leather 12%, stone 8% | **52** |
| feet quarter (shins down) | 20-35 | under 38%, leather 32%, ironstone 26%, cloth 4% | **25** |

The mantle's upper lames and the breastplate carry the top quarter; the blued mantle lower edge, the under-suit and the pale blade carry the middle; narrow greaves and boots are the feet. The blade is translucent, so its albedo share stays small. In Hilt form the blade is missing from the mid band: the bands hold without it.

## 7. Accent (template 7)

The two crossguard inlays, about 10 x 3 cm each = 60 cm2, against roughly 11,500 cm2 of silhouette: **about 0.5%** (budget 5%), 100% in the top half. She carries the greatsword with the grip at chest height (about 1.30 m, pommel at the shoulder) and the blade angled down and forward, so the crossguard is in the top half even though the blade is point-low (the point hangs about 0.35 m above the ground). At rest the emissive is 0.8; it blooms to 1.5 or more in the wind-ups of Shatter and Whole Again, as a warning that a big hit is coming. In Hilt form the same crossguard stays on the stub, so the accent never moves.

## 8. Motion (template 8)

`MOTION = anim.motion_profile(weight="medium", weapon="two_hand", stance="guard", run_ref_speed=3.45, blocks=BLOCKS)`

`BLOCKS` (the Hilt state is a clip-speed and prop change, not a second clip set):
- **guard / idle:** the blade point-low along the right leg, the left hand on the grip below the right; knees soft, weight forward.
- **run:** the blade trailing low and behind, both hands on the grip; contact 0.30, light bob. In Hilt form the renderer plays `run` at 1.2 times speed (the sim's +20% move speed) with the stub held close.
- **lobby:** the blade grounded point-down, both hands on the pommel; see below.

Four distinct ability gestures. Frame counts are multiples of 5 at 30 fps; the impact is at exactly 40% of the clip (frame = 0.4 × N). The sim's `castTime` is the windup before the effect lands; the clip's impact frame is the visual hit. A `castTime` of 0 means the effect starts at once, so the anticipation stays at 4 frames or fewer and the gesture must not hide a dash.

| Clip | Frames (impact) | Sim ability | Gesture |
|---|---|---|---|
| `cast_a1` | 20 (f8) | **Heavy Arc** (castTime 0.3 s, 3.5 m, 140 degree cone) and **Quick Jab** (castTime 0.1 s, 3 m dash) | One stroke that serves both forms: a cross-body diagonal that ends in a forward lunge at f8. With the whole blade it sweeps a wide arc (the blade's length draws the cone); with the stub it reads as a short stabbing jab (the same body motion with a short prop). Anticipation 4 frames. Silhouette: a diagonal bar swinging through the front, or a short lunge. |
| `cast_a2` | 25 (f10) | **Glass Guard** (castTime 0.1 s, shield) and **Shard Kick** (castTime 0.2 s, 3 shards, 6 m) | She plants the blade (or the stub) point-down in front of her and braces behind it, the free leg flicking forward at f10; whole: the blade stands as a pale wall and the shield wraps her; Hilt: the stub drives into the ground and the leg-kick throws the shards. One body clip with a plant and a kick that coincide. Silhouette: a wide stance behind a vertical bar. |
| `cast_a3` | 30 (f12) | **Shatter** (castTime 0.3 s, 3 m smash, forms Hilt) and **Reform** (castTime 0.2 s, 2 m) | Both hands raise the prop overhead (f0-f8, a held crouch, not a freeze) and bring it down at f12: with the whole blade this smashes it into the ground (the renderer swaps `blade_whole` for `blade_hilt` at f12 and the shard field appears); played from Hilt form the same arc gathers the shards (the renderer swaps `blade_hilt` for `blade_whole` at f12). Silhouette: a tall overhead line, then a broken stub. |
| `cast_ult` | 35 (f14) | **Whole Again** (castTime 0.3 s, 6 m leap, forms Great) | A deep crouch with the blade drawn behind her (f0-f6), a held pose that breathes; at f14 she is airborne at the top of the arc (the sim dashes her 6 m) with the blade overhead, and she lands with it swung down; at the landing the renderer swaps in `blade_great` and the accent flares. Hold the landing f14-f26, then rise. Silhouette: a coil, then an arc, then a long pale diagonal. |

Other clips: `run` at 3.45 m/s (medium, foot slide under 8%); `attack1` a diagonal slash, `attack2` a return slash (both 25 frames, impact f10; the Hilt form plays them 1.3 times faster); `death` drops the blade, falls to her knees and topples sideways (ends at rest); `recall` grounds the prop and folds both hands over the pommel; `stunned` staggers with the blade point dragging; `dash` is a lunge loop; `taunt` taps the blade flat on her shoulder twice, a clear glass note.

**`idle_lobby`** (loops, closed first = last pose): Focused and a little vain about her blade. She turns the grounded sword to catch the light, taps the flat with a knuckle to listen to it, tilts her head as if the note is slightly wrong, then smiles behind the visor and checks it again. She never lets the point leave the floor. 120 frames.

**`victory`** (ends in a hold): She raises the blade and strikes it point-down into the ground, where it breaks with a bright glass note (the renderer swaps to the stub), then she turns the stub over in her fist and the blade is whole again in her other hand. Final hold: the whole blade grounded, both hands on the pommel, chin up, a quarter turned from the camera. 55 frames, then the hold.

## 9. Skins (template 9)

Palette swaps plus optional extra geometry read from `ctx.skin["extra"]`. Every skin keeps the rig, clips, silhouette class (height ±5%, footprint ±10%), accent locations and value gradient; none adds metal, a single saturated full-body colour, or a reserved hue above 40% saturation. Names, tiers and descriptions come from `content/skins/ervet.json`. The named hex is the identity colour of the skin: where it falls outside a band's L* range, the surface steps lighter or darker by band and the identity hex is used at its own band.

### `ervet_base`: Ervet (base)

Points at the base files (`assets/fighters/ervet/ervet.glb`). The palette is section 5.

### `ervet_stillwater`: Stillwater Blade (standard)

*"A river-glass blade and wet-stone armour, the colours of the Fallen Shaft shallows."*

A river-glass blade (`#8FB3A8`, hue 162, 20% saturation, outside the heal band's 125-150 limits) and wet-stone armour (`#4D5A5C`). The wet-stone is the deep tone (mantle, greaves, boots); the upper lames and breastplate step lighter so the top quarter holds its value. The blade stays glossy and translucent. **No extra geometry.**

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `dawnglass` | `#8FB3A8` | 70 | 162° / 20% | the named river-glass blade #8FB3A8 and visor |
| `chalk` | `#CDD2CE` | 84 | 132° / 2% | breastplate and crossguard, pale stone |
| `stone` | `#B5BFBE` | 77 | 174° / 5% | upper mantle lames |
| `cloth` | `#4D5A5C` | 37 | 188° / 16% | the named wet-stone #4D5A5C (mantle, vambraces) |
| `ironstone` | `#3A4446` | 28 | 190° / 17% | greaves |
| `under` | `#2F3739` | 22 | 192° / 18% | leggings |

Value bands (area-weighted): top **71** (70-85) · mid **47** (45-65) · feet **26** (20-35).

`SKINS` entry: `{"id": "ervet_stillwater", "palette": {...as above...}, "extra": {}, "card": {"primary": "#4D5A5C", "secondary": "#8FB3A8"}}`

### `ervet_lamplit`: Lamplit Blade (deluxe)

*"A smoked lampresin blade and walnut armour. A small lamp cage hangs from the pommel."*

A smoked lampresin blade (`#A38C6B`, 34% saturation) and walnut armour (`#5E4D3E`), borrowed from the evening side. The walnut is the leather and mantle tone; the plates and the breastplate step lighter. The blade stays glossy and translucent, never emissive. **Extra geometry:** a small lamp cage on the pommel, an open cage of four carved-wood slats around a lampresin bead, at most 0.07 m tall; it stays duller than the accent.

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `dawnglass` | `#A38C6B` | 60 | 35° / 34% | the named smoked lampresin blade #A38C6B (still glass: glossy, not emissive) |
| `chalk` | `#DBD4C7` | 85 | 39° / 9% | breastplate and crossguard, pale |
| `stone` | `#C9BCA7` | 77 | 37° / 17% | upper mantle lames, walnut-light |
| `cloth` | `#7C6B59` | 46 | 31° / 28% | mantle, warm walnut mid |
| `leather` | `#5E4D3E` | 34 | 28° / 34% | the named walnut #5E4D3E (boots, grip) |
| `ironstone` | `#3F3730` | 24 | 28° / 24% | greaves, walnut-dark |
| `under` | `#3A332D` | 22 | 28° / 22% | leggings |

Value bands (area-weighted): top **71** (70-85) · mid **50** (45-65) · feet **27** (20-35).

`SKINS` entry: `{"id": "ervet_lamplit", "palette": {...as above...}, "extra": {"lamp_cage": True}, "card": {"primary": "#4A4036", "secondary": "#A38C6B"}}`

## 10-11. Export and renders

- Splash: `SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "yaw": 22.0}`. The whole blade grounded at the front, the wedge of the mantle turned a quarter from the camera, the long diagonal pointing toward the frame centre.
- Portrait (512 square, `idle_lobby` t 0, yaw 28): the visor, the beak and the mantle's flat top edge with the crest. Icon (128 square): the slit visor and the brow-plate accent.
- GLB budget 10-25k tris and at most 1.2 MB, base and both skins.

## Per-fighter checks (on top of the template checklist)

- [ ] The shoulders are at least 2.5 times the hips and the whole figure narrows to the feet: it reads as an inverted wedge in black at 64 px, in whole and Hilt form.
- [ ] IoU against Kemdo and Burdam <= 0.80 in the whole form, and the Hilt form does not read as a Striker (IoU against Rishal and Nurrow <= 0.80).
- [ ] `blade_whole`, `blade_hilt` and `blade_great` share one grip transform, so the hands never move when the renderer swaps them; the accent inlays stay at the crossguard and the brow plate.
- [ ] The blade is glossy and translucent in every state and never emissive; only the accent inlays emit.
- [ ] `cast_a2` carries a clear plant frame and a clear kick frame at f10 so both Glass Guard and Shard Kick read from the one clip.
