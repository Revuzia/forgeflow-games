# Hesmi · Plinth: art brief

`hesmi` · Hourless (she) · large (anchor 2.4 m, authored at 2.30 m) · 2.3 m · res_unlit · melee 1.8 m phys · difficulty 2

> Source of truth: `_design/ROSTER.md` §3 entry 7, `content/fighters/hesmi.json`, `content/skins/hesmi.json`. Look law: `STYLE_BIBLE.md` (Fighters, Look rules), `_design/tokens.json` `fighter`, `WORLD.md` §2 (faces). Pipeline: `CONTRACT.md` §12, `art/README.md` and `art/blender/fighters/_template.py`; the section numbers below follow the template's 0-11. Art authors the numbers marked *start value*; the `lineup_qa` / three QA measurements decide.

Banned for every fighter: gears, clock hands, gold filigree, gems, glowing runes, metallic bevels, teal-and-gold, red-versus-green. Every material is non-metallic (metalness 0): "iron" and "steel" mean matte, painted, oxidised-looking stone or ironstone, never a bright edge. Only the `accent` material emits; dawnglass and lampresin are glossy but never emissive.

## 0. Brief

| Field | Value |
|---|---|
| `ID` (file name = content id) | `hesmi` |
| `TITLE` (collection title, never an epithet) | Shard bearer |
| `ROLE_MASS` | `plinth` (Plinth; `class_plinth`) |
| `ORIGIN` | `hourless`: wrap or hood (with a carved eye-band) |
| Fight job | Plants shards of the fallen needle whose shadows slow the enemy, then fall on them. |
| Positions | `shadehold` / `grovehunter` · bot `frontline`, preferred range 2 m |
| Height | **2.3 m** (class: large (anchor 2.4 m, authored at 2.30 m)); 116 px at 1080p, 78 px at 720p (vertical px = 50.5 × height m; horizontal 82.1 px per m) |
| `art.height` / `collisionRadius` / `moveSpeed` | 2.3 m / 0.68 m / 3.35 m/s: author `run` for **3.35 m/s** (`runRefSpeed`); the content JSON still carries the 3.6 placeholder until `art.json` is copied back |
| Weapon + motion | stone-gauntleted fists, motion `none`; weight `heavy`, stance `guard`. The shards on her back are body mass, not a held weapon. |
| `CARD` = `FighterDef.palette` | primary `#5C5A63` · secondary `#8C8478` (collection and draft backdrops; already in the JSON) |
| Kit (for the body notes) | passive **Shade-Fed** · a1 **Plant Shard** · a2 **Shoulder the Stone** · a3 **Stand Firm** · ult **Felled Shard** |

## 1. Silhouette at 96 px

- **Mass: Plinth block.** A broad hooded wanderer in layered rigid wraps: shoulders 0.80 m, hips 0.50 m (1.6 times), a square stance, and a flat crown.
- **Hook:** a rack of three needle-stone shards strapped upright on her back, **cut flat at one height 0.30 m above the hood**. The rack is 0.50 m wide (3 shards 0.14 m wide, 4 cm gaps), wider than her head (0.34 m) and narrower than her shoulders: a flat-topped slab standing on her back. The cut tops are 41 px wide at 1080p; the figure is 116 px tall at 1080p (77 px at 720p), the tallest of half A after Marund.
- **Height rule:** the shard tops are the highest mesh, so `art.height` = 2.30 m is the rack's flat top; the hood crown is at 2.00 m (head 0.32 m, 6.25 heads to the hood crown).
- **At 64 px:** a block with a flat slab standing above the head, three vertical gaps in the slab (the shards), two big fists at the hips. The slab is narrower than the shoulders and the gaps are at least 4 cm (3 px at 1080p; keep them 5 cm if the 64 px read needs it).
- **Facing from above:** the stone eye-band and the face wrap point forward, the rack sits on the back (so the cut tops are behind the head), and the fists are at the front.

Pairs to test first (IoU <= 0.80 at 64 px):

- **Hesmi / Marund** (both large Plinths): a tall narrow flat-topped rack of three slabs with gaps behind the head versus a low wide disc over the shoulders. If IoU passes 0.80, widen the gaps to 6 cm or raise the rack to 0.35 m above the hood before touching Marund.
- **Hesmi / Burdam:** a flat-topped block versus an inverted wedge with a diagonal bar.
- **Hesmi / Kemdo** (both Hourless, both hooded): a block with a flat rack versus a wedge with a thin pole and a lens.

## 2. Proportions and shape (template 1)

- **Large class**: body to the hood crown 2.00 m, head 0.32 m (6.25 heads), total 2.30 m with the rack.
- **Stylized heroic:** hands x1.7 (the gauntlets are the weapon), forearms x1.4, boots x1.3 wide, a short neck hidden by the hood and the wraps.
- *Start values:*

```python
PROPORTIONS = rig.proportions(height=2.00, head=0.32, neck=0.05, shoulder_width=0.60, hip_width=0.26, leg=0.90,
                              thigh_frac=0.50, arm=0.70, upper_arm_frac=0.52, hand=0.27, foot=0.36,
                              ankle_height=0.11, spine_curve=0.02, stance=0.07, toe_out_deg=8.0, knee_bend=0.012)
# the rack adds 0.30 m: art.height is measured on the finished mesh (2.30 m)
SHAPE = body.shape(girth=1.1, torso_w=1.16, torso_d=1.1, chest=1.16, waist=1.0, hips=0.9, arm=1.2, forearm=1.4,
                   leg=0.95, calf=1.05, hand=1.7, neck=1.1, head_w=1.08, head_d=1.06, jaw=1.0, feet=False)
```

## 3. Face (template 3)

- **Hourless wrap and hood.** A deep rigid hood (`kit.hood`) and a layered face wrap (`cloth2`) over the nose and jaw. Across the eyes sits a carved honed-dialstone eye-band (0.20 m wide, 0.06 m tall, 3 cm bevels) with a narrow ink slit: the "mask" of the Hourless, which keeps the face unseen and gives a facing cue (the band's lower edge is a 4 cm keel pointing forward).
- No bare face, no hair; the hood never droops.

## 4. Armour, cloth and props (template 4)

- **Wraps.** Layered rigid wraps on the shoulders and chest (three overlapping bands, sculpted folds 2 cm deep, `cloth` and `cloth2`), a leather harness crossing the chest that carries the rack, a heavy belt. No cape: the rack owns the back.
- **Gauntlets.** Honed-dialstone gauntlets (`gauntlet`) from the elbow to the knuckles, 0.30 m long with 2-4 cm bevels, big fists (hand x1.7). Both hands are empty in every clip.
- **Legs.** Wrapped trousers (`under`), plain leather boots with ironstone toe caps and flat shin slabs.
- **The shard rack.** Three needle-stone shards, 0.14 m wide, 0.09 m thick, side by side with 4 cm gaps, strapped to a carved-wood cross brace and the chest harness. Each shard has two zones: the **cut band**, the top 0.30 m above the hood line, is a freshly cut, honed pale face (`stone`) with the flat cut top and an `accent` inlay (12 x 12 cm) set into the top; below it the weathered needle-stone is dark ironstone, the darkest stone on the roster (L* 32). All cuts are flat and level at one height; bevels 2-4 cm; no point, no gem facets.

Sockets (`art.json` `sockets`; the standard set stays exactly as in the content JSON):

`origin root`, `chest chest`, `head head`, `hand_r hand.R`, `hand_l hand.L`, `weapon / weapon_r prop.R`, `weapon_l prop.L`, `foot_r foot.R`, `foot_l foot.L`, plus the extras `shard_mid x_shard_mid` (the cut top of the middle shard: the Plant Shard and Felled Shard origin), `fist_r x_fist_r` and `fist_l x_fist_l` (the Shoulder the Stone and Stand Firm clacks) and `rack_top x_rack_top`.

## 5. Palette (template 5)

Hexes are authored albedo in the bible vocabulary (`materials.bible_palette` roles). None of the reserved relationship hues (Dawn azure `#3F9CFF`, Dusk marigold `#FF9A1F`, Noonwhite `#F4EFE2`) dominates: every large-area colour is below 40% saturation inside the azure (200-225°) and marigold (25-50°) hue bands, and no large area is lighter than L* 86. The `accent` role is authored azure; the renderer tints it per viewer.

| Role | Hex | L* | Hue / sat | Where it is used |
|---|---|---|---|---|
| `cloth2` | `#CEC8BB` | 81 | 41° / 9% | hood, face wrap, inner shoulder wraps |
| `stone` | `#D3CEC3` | 83 | 41° / 8% | the honed cut bands of the three shards (top 0.30 m), the eye-band |
| `cloth` | `#A39E95` | 65 | 39° / 9% | outer shoulder and chest wraps |
| `ironstone` | `#4C4A53` | 32 | 253° / 11% | weathered shard bodies below the cut, toe caps, shin slabs, the cross brace trim |
| `gauntlet` | `#8A867D` | 56 | 42° / 9% | honed-dialstone gauntlets |
| `leather` | `#4A4036` | 28 | 30° / 27% | harness, belt, boots |
| `under` | `#34323A` | 21 | 255° / 14% | wrapped trousers |
| `ink` | `#17181B` | 8 | 225° / 15% | eye-band slit |
| `accent` | `#3F9CFF` | 63 | 211° / 75% | the three cut-top inlays |


## 6. Value gradient (template 6)

Light head, dark feet: the bible bands measured on screen by `lineup_qa` (top quarter L* 70-85, middle 45-65, feet 20-35; at least 40% of the silhouette at rest value). The means below are area-weighted estimates of the authored albedo before the `VALUE_GRADIENT_STOPS` ramp (x0.62 at the feet to x1.06 at the crown) and the baked top light, so the on-screen top band sits a little higher.

| Band | Target L* | Mix (share of the band) | Mean L* |
|---|---|---|---|
| top quarter (crown to chest) | 70-85 | stone 38%, cloth2 30%, cloth 18%, ironstone 10%, leather 4% | **72** |
| middle half | 45-65 | cloth 50%, gauntlet 14%, under 14%, leather 12%, ironstone 10% | **50** |
| feet quarter (shins down) | 20-35 | under 46%, leather 30%, ironstone 16%, cloth 8% | **28** |

The pale honed cut bands, the hood and the shoulder wraps carry the top quarter (L* 72). The weathered shard bodies are the darkest stone on the roster (L* 32), but they sit mostly behind the head and shoulders, in the middle band (the rack's lower two thirds). If the top band measures under 70, lengthen the honed cut band by 3 cm before lightening the hood; if the roster read "darkest stone" matters in the splash, keep the cut band at 0.30 m and darken only the part below the hood line.

## 7. Accent (template 7)

Three cut-top inlays, 12 x 12 cm each = 432 cm2 against roughly 18,400 cm2 of silhouette: **about 2.3%** (budget 5%), 100% in the top half (the cut tops are at 2.30 m). At rest the emissive is 0.8; the three tops bloom to 1.5 or more only in the wind-up of Felled Shard (a glow is a warning: she is about to drop the great shard). From the 52 degree camera the three tops are visible from the front and the sides because they stand above the head.

## 8. Motion (template 8)

`MOTION = anim.motion_profile(weight="heavy", weapon="none", stance="guard", run_ref_speed=3.35, blocks=BLOCKS)`

`BLOCKS` (weapon `none`: the arm blocks are fists):
- **guard / idle:** both fists at chest height, forearms vertical, elbows out; the weight settles slowly and the rack never tilts more than 3 degrees.
- **run_fwd / run_back:** a heavy lean forward (heavy lean 13 degrees), fists pumping at the ribs; the rack stays level (the chest counter-rotates 4 degrees).
- **lobby:** arms hanging, fists loose.

Four distinct ability gestures. Frame counts are multiples of 5 at 30 fps; the impact is at exactly 40% of the clip (frame = 0.4 × N). The sim's `castTime` is the windup before the effect lands; the clip's impact frame is the visual hit. A `castTime` of 0 means the effect starts at once, so the anticipation stays at 4 frames or fewer and the gesture must not hide a dash.

| Clip | Frames (impact) | Sim ability | Gesture |
|---|---|---|---|
| `cast_a1` | 35 (f14) | **Plant Shard** · castTime 0.3 s · plant a shard up to 6 m, 9 m shadow | She reaches back over her shoulder as if drawing a shard from the rack (f0-f8; the rack stays full: the planted shard is the `hesmi_a1_shadow` VFX mesh), brings the empty fist forward and down in a two-handed stab, and plants it in the ground at f14 with a deep lunge on the front foot. Hold the stab to f24, then rise by f35. Silhouette: a long diagonal from the back of the rack to the planted fist. |
| `cast_a2` | 25 (f10) | **Shoulder the Stone** · castTime 0.1 s · shoulder charge 4.5 m, knock aside | A low shoulder charge: chin tucked, the right shoulder dropped forward under the hood, the left fist back (the sim dashes her at 13 m/s; anticipation 3 frames, castTime 0.1 s). The contact pose at f10 is a near-horizontal lean of 30 degrees, the rack tilting forward with her. Follow-through to f17, recover by f25. Silhouette: a battering block with the slab leaning forward. |
| `cast_a3` | 25 (f10) | **Stand Firm** · castTime 0 s · brace 2.5 s, +armor and tenacity | Instant (castTime 0): she crosses her forearms in front of her face at f3 and the gauntlets clack together at f10 (the impact: stone on stone), feet set wide, the chest expanding and the rack lowering 3 cm. Hold the crossed guard to f20, lower to guard by f25. Silhouette: a symmetric X over a wide square. |
| `cast_ult` | 50 (f20) | **Felled Shard** · castTime 0.35 s · great shard dropped at a point up to 9 m, 12 x 5 m shadow | Both gauntlets rise overhead, hands interlaced, as if catching the weight of the sky (f0-f14), rising onto her toes with her head back and the rack tipping back; at f20 she heaves forward and down with both fists in a hammer-throw, a 20 degree forward lean and a stamp: the great shard falls (VFX `hesmi_ult_shard`, 0.75 s later). Hold the heave f20-f32 while the shadow stretches, rise by f50. Silhouette: a tall comb of arms and rack, then a collapsing block. |

Other clips: `run` at 3.35 m/s (heavy, foot slide under 8%); `attack1` a short right hook, `attack2` a left hook (both heavy, 40 frames, impact f16); `death` a kneeling collapse with the rack dropping last, forward onto her fists (ends at rest); `recall` kneels and sets both fists on the ground, listening; `stunned` staggers with the rack swaying 3 degrees; `dash` and `taunt` follow the standard generators (the taunt clacks the gauntlets).

**`idle_lobby`** (loops, closed first = last pose): Immovable, a standing stone. She stays still for long beats, then rolls one shoulder so the rack clinks, taps a shard with a knuckle to hear it ring, looks down at the shadow of her own rack on the ground as if reading the hour from it, then up again. 120 frames.

**`victory`** (ends in a hold): She sets her feet, plants a fist on the ground, then crosses her arms and lifts her chin: a standing stone. A slow settle, no flourish. Final hold: arms crossed, chin raised, the three cut tops catching the light. 60 frames, then the hold.

## 9. Skins (template 9)

Palette swaps plus optional extra geometry read from `ctx.skin["extra"]`. Every skin keeps the rig, clips, silhouette class (height ±5%, footprint ±10%), accent locations and value gradient; none adds metal, a single saturated full-body colour, or a reserved hue above 40% saturation. Names, tiers and descriptions come from `content/skins/hesmi.json`. The named hex is the identity colour of the skin: where it falls outside a band's L* range, the surface steps lighter or darker by band and the identity hex is used at its own band.

### `hesmi_base`: Hesmi (base)

Points at the base files (`assets/fighters/hesmi/hesmi.glb`). The palette is section 5.

### `hesmi_gorgewalk`: Gorgewalk Shards (standard)

*"Slate shards bound with rigid gorge-rope and iron pins, and slate wraps for the long walk across the Needlespan."*

Slate shards bound with rigid gorge-rope (`#9A8F7A`), matte painted iron pins and slate wraps (`#6E747C`), made for the long walk across the Needlespan. The slate wraps are the mid-band wraps; the hood and shoulder tops step lighter so the top quarter holds its value. **Extra geometry:** rope bindings round each shard below the cut band (three coils of 3 cm rope, rigid) and four iron pins through the cross brace; the rope never rises above the cut band, so the flat top stays clean.

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `cloth2` | `#C2C6CA` | 80 | 210° / 4% | hood and face wrap, pale slate |
| `stone` | `#D0D3D5` | 84 | 204° / 2% | honed cut bands and the eye-band, cool |
| `cloth` | `#A5AAAF` | 69 | 210° / 6% | shoulder wraps, lighter slate |
| `ironstone` | `#5E646D` | 42 | 216° / 14% | slate shard bodies |
| `gauntlet` | `#9096A0` | 62 | 218° / 10% | slate gauntlets |
| `slate` | `#6E747C` | 49 | 214° / 11% | the named slate wraps #6E747C (mid-band wraps) |
| `rope` | `#9A8F7A` | 60 | 39° / 21% | gorge-rope bindings |

Value bands (area-weighted): top **73** (70-85) · mid **46** (45-65) · feet **30** (20-35).

`SKINS` entry: `{"id": "hesmi_gorgewalk", "palette": {...as above...}, "extra": {"rope_binding": True, "iron_pins": True}, "card": {"primary": "#4A4F55", "secondary": "#9A8F7A"}}`

### `hesmi_shadeprint`: Shadeprint Shards (deluxe)

*"Ink shards with light-rimmed edges over pale wraps; her shadows fall in deep violet."* `vfxTint` `#6C5BA8`.

Ink shards (`#2B2A33`) with light-rimmed edges over pale wraps (`#B7B4BE`) above: the value gradient holds because the light sits on the rims and the upper body, and the ink sits low. `vfxTint` `#6C5BA8` (hue 253) tints her shadows (the Plant Shard strip and the great shadow) in deep violet; it is never albedo and never the accent. **Extra geometry:** none; the light rims are a painted 1 cm edge band on every shard bevel.

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `cloth2` | `#B7B4BE` | 74 | 258° / 5% | the named pale wraps #B7B4BE (hood, face wrap) |
| `stone` | `#D6D3DB` | 85 | 263° / 4% | light-rimmed honed cut bands |
| `cloth` | `#B0AEBB` | 72 | 249° / 7% | pale-lilac shoulder wraps |
| `ironstone` | `#2B2A33` | 17 | 247° / 18% | the named ink shards #2B2A33 |
| `gauntlet` | `#6F6D79` | 47 | 250° / 10% | dusk-grey gauntlets |
| `leather` | `#3A3942` | 24 | 247° / 14% | ink harness and boots |
| `under` | `#34333C` | 22 | 247° / 15% | ink trousers |

Value bands (area-weighted): top **72** (70-85) · mid **50** (45-65) · feet **26** (20-35).

`SKINS` entry: `{"id": "hesmi_shadeprint", "palette": {...as above...}, "extra": {"light_rims": True}, "card": {"primary": "#2B2A33", "secondary": "#B7B4BE"}}`

## 10-11. Export and renders

- Splash: `SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92}`. The crossed-arms hold puts the flat rack against the sky; the camera at the character's left shows the rack's three cut tops and the eye-band at once.
- Portrait (512 square, `idle_lobby` t 0, yaw 28): the hood, the eye-band and the rack's cut tops above it. Icon (128 square): the eye-band under the hood with one cut top.
- GLB budget 10-25k tris and at most 1.2 MB, base and both skins.

## Per-fighter checks (on top of the template checklist)

- [ ] The rack is 0.50 m wide and flat-topped 0.30 m above the hood, with three visible 4 cm gaps; the slab reads narrower than the shoulders in black at 64 px.
- [ ] IoU against Marund (test first), Burdam and Kemdo <= 0.80.
- [ ] `art.height` is 2.30 m (the rack top); the hood crown is at 2.00 m. The overhead health bar clears the rack.
- [ ] The rack stays level (tilt <= 3 degrees) in `idle`, `run` and the clack of `cast_a3`; no shard clips the hood.
- [ ] The cut-top inlays are the only emissive pixels at rest; `cast_a3` has at most 4 frames of anticipation (castTime 0).
