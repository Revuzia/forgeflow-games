# Vashil · Caster: art brief

`vashil` · Aubade (he) · standard, tall end (anchor 1.9 m, authored at 2.05 m) · 2.05 m · res_light · ranged 5.3 m magic · difficulty 1

> Source of truth: `_design/ROSTER.md` §3 entry 15, `content/fighters/vashil.json`, `content/skins/vashil.json`. Look law: `STYLE_BIBLE.md` (Fighters, Look rules), `_design/tokens.json` `fighter`, `WORLD.md` §2 (faces). Pipeline: `CONTRACT.md` §12, `art/README.md` and `art/blender/fighters/_template.py`; the section numbers below follow the template's 0-11. Art authors the numbers marked *start value*; the `lineup_qa` / three QA measurements decide.

Banned for every fighter: gears, clock hands, gold filigree, gems, glowing runes, metallic bevels, teal-and-gold, red-versus-green. Every material is non-metallic (metalness 0): "iron" and "steel" mean matte, painted, oxidised-looking stone or ironstone, never a bright edge. Only the `accent` material emits; dawnglass and lampresin are glossy but never emissive.

## 0. Brief

| Field | Value |
|---|---|
| `ID` (file name = content id) | `vashil` |
| `TITLE` (collection title, never an epithet) | Bell ringer |
| `ROLE_MASS` | `caster` (Caster; `class_caster`) |
| `ORIGIN` | `aubade`: glass visor |
| Fight job | Rings wide notes over the enemy front line; anyone struck by two of them stops cold. |
| Positions | `dialcross` / `shaftlight` · bot `artillery`, preferred range 7 m |
| Height | **2.05 m** (class: standard, tall end (anchor 1.9 m, authored at 2.05 m)); 104 px at 1080p, 69 px at 720p (vertical px = 50.5 × height m; horizontal 82.1 px per m) |
| `art.height` / `collisionRadius` / `moveSpeed` | 2.05 m / 0.55 m / 3.35 m/s: author `run` for **3.35 m/s** (`runRefSpeed`); the content JSON still carries the 3.6 placeholder until `art.json` is copied back |
| Weapon + motion | long striking rod, `staff`, held upright in the right hand; weight `light`, stance `neutral`. The halo of bells is part of the head, not a prop. |
| `CARD` = `FighterDef.palette` | primary `#E1DCCF` · secondary `#A7B5C2` (collection and draft backdrops; already in the JSON) |
| Kit (for the body notes) | passive **Hum** · a1 **Peal** · a2 **Glass Chime** · a3 **Ring Out** · ult **Morning Toll** |

## 1. Silhouette at 96 px

- **Mass: Caster, line plus disc.** Tall and straight: shoulders 0.40 m, hips 0.26 m, a pale robe falling in one unbroken column from the shoulders to a dark hem. The vertical line is the body, the disc is the halo.
- **Hook:** a **bright ring of seven small glass bells above the head**. A chalk ring 0.80 m across floats 0.14 m above the visor on three rigid struts, and seven dawnglass bells, each 0.12 m tall and 0.07 m wide, hang from it at equal spacing; the ring is 66 px wide at 1080p. The bell clappers hold the accent.
- **Below the halo:** a long ash striking rod, 1.75 m, held upright at the right shoulder, its glass striker head (0.12 m) rising level with the top of the halo.
- **Size:** 104 px tall at 1080p (69 px at 720p); at 2.05 m he is the tallest Caster with Tunlan, and the halo makes the head the widest part of the figure.
- **At 64 px:** a thin vertical under a bright ring with small bumps along its lower edge (the bells), and a thin vertical rod beside him. Nothing is thinner than 6 cm (5 px at 1080p) in the silhouette except the clappers, which are inside the bells.
- **Facing from above:** the arched visor's point faces forward, the halo's three struts mark the front (one strut) and the back (two), the rod is on the right.

Pairs to test first (IoU <= 0.80 at 64 px):

- **Vashil / Tunlan** (the other Caster): a ring of bells above the head over a thin pale column versus a wide flat lampshade hat with a lantern below it; Vashil's disc is a ring above the head, Tunlan's is a hat on it.
- **Vashil / Ardit** (both pale Aubade): a thin column under a ring versus a block with a tall pavise beside it.
- **Vashil / Ilsheta** (the Aubade Tender): a straight column with a ring above and a rod beside versus a round open figure with a chimney visor and a chest lamp.

## 2. Proportions and shape (template 1)

- **Standard class**, tall end: height 2.05 m, head 0.30 m (6.8 heads, measured without the halo). Long legs under the robe (0.95 m) and a long neck (0.08 m) so the halo floats clear of the shoulders.
- **Stylized heroic:** hands x1.4, forearms x1.1, boots x1.2 wide (mostly hidden by the hem), a narrow waist. A very upright stance: `spine_curve` 0.0.
- *Start values*:

```python
PROPORTIONS = rig.proportions(height=2.05, head=0.30, neck=0.08, shoulder_width=0.40, hip_width=0.20, leg=0.95,
                              thigh_frac=0.50, arm=0.66, upper_arm_frac=0.52, hand=0.21, foot=0.29,
                              ankle_height=0.09, spine_curve=0.0, stance=0.03, toe_out_deg=5.0, knee_bend=0.01)
SHAPE = body.shape(girth=0.92, torso_w=0.92, torso_d=0.92, chest=0.94, waist=0.86, hips=0.9, arm=0.92, forearm=1.05,
                   leg=0.92, calf=1.0, hand=1.4, neck=1.25, head_w=1.03, head_d=1.02, jaw=1.0, feet=False)
```

## 3. Face (template 3)

- **Aubade glass visor.** An arch-shaped dawnglass pane (`kit.glass_visor`), 0.22 m tall and 0.12 m wide with a pointed top like a bell window, over a carved chalk face-plate and ink recesses. The arch's point is the beak and the facing cue from above. A chalk cowl covers the crown under the halo; no bare face, no hair.
- The halo's lowest bell hangs 0.10 m above the visor so the pane is never covered in the portrait.

## 4. Armour, cloth and props (template 4)

- **Halo.** A chalk ring 0.80 m across and 3 cm thick (`chalk`, rigid) on three struts 0.14 m tall, seven dawnglass bells hanging from it (rigid, 0.12 m tall, 2 cm bevels, glossy and never emissive), each carrying one accent clapper bead 2 cm across. One rigid mesh on the head bone: no sway.
- **Robe.** A long chalk-pale robe (`chalk`, with a blue-grey inner panel `cloth`) falling from stone shoulder plates to the ankle in three rigid panels (front, back, left; one bone each, at most 2 sway bones in total); a pale linen sash (`cloth2`) and a chalk collar; a dark `ironstone` hem band 0.30 m tall.
- **Arms.** Wide pale sleeves with leather bracers; the right hand holds the rod, the left is free and carries a small bell on a cord at the wrist (rigid, 5 cm).
- **Legs.** Close leggings (`under`) and light boots, mostly hidden by the hem.
- **Striking rod** (`prop.R`, grip at the origin, shaft along +Z): ash 1.75 m long and 4 cm thick with a leather grip 0.20 m at the middle and a dawnglass striker head 0.12 m long with a chalk collar at the top.

Sockets (`art.json` `sockets`; the standard set stays exactly as in the content JSON):

`origin root`, `chest chest`, `head head`, `hand_r hand.R`, `hand_l hand.L`, `weapon / weapon_r prop.R`, `weapon_l prop.L`, `foot_r foot.R`, `foot_l foot.L`, plus the extras `rod_head x_rod_head` (every Peal and Morning Toll starts here) and `halo x_halo` (the bells; the accent clappers ride on it).

## 5. Palette (template 5)

Hexes are authored albedo in the bible vocabulary (`materials.bible_palette` roles). None of the reserved relationship hues (Dawn azure `#3F9CFF`, Dusk marigold `#FF9A1F`, Noonwhite `#F4EFE2`) dominates: every large-area colour is below 40% saturation inside the azure (200-225°), marigold (25-50°), heal (125-150°) and tritan (340-350°) hue bands, and no large area is lighter than L* 86. The `accent` role is authored azure; the renderer tints it per viewer.

| Role | Hex | L* | Hue / sat | Where it is used |
|---|---|---|---|---|
| `chalk` | `#D9D4C6` | 85 | 44° / 9% | halo ring, robe upper, collar, face-plate, cowl |
| `dawnglass` | `#B9D0E2` | 82 | 206° / 18% | the seven bells, visor pane, rod striker |
| `stone` | `#B7BCC0` | 76 | 207° / 5% | shoulder plates, bracers |
| `cloth2` | `#CFCFC8` | 83 | 60° / 3% | sash, sleeves |
| `wood` | `#D4C9B0` | 81 | 42° / 17% | ash rod |
| `cloth` | `#7D8996` | 57 | 211° / 17% | blue-grey inner robe panel |
| `ironstone` | `#3D434B` | 28 | 214° / 19% | the dark hem band |
| `leather` | `#433E3A` | 27 | 27° / 13% | bracers, grip, boots |
| `under` | `#313439` | 22 | 218° / 14% | leggings |
| `ink` | `#17181B` | 8 | 225° / 15% | visor recess |
| `accent` | `#3F9CFF` | 63 | 211° / 75% | seven bell clapper beads |

## 6. Value gradient (template 6)

Light head, dark feet: the bible bands measured on screen by `lineup_qa` (top quarter L* 70-85, middle 45-65, feet 20-35; at least 40% of the silhouette at rest value). The means below are area-weighted estimates of the authored albedo before the `VALUE_GRADIENT_STOPS` ramp (x0.62 at the feet to x1.06 at the crown) and the baked top light, so the on-screen top band sits a little higher.

| Band | Target L* | Mix (share of the band) | Mean L* |
|---|---|---|---|
| top quarter (crown to chest) | 70-85 | chalk 30%, dawnglass 22%, stone 14%, cloth2 12%, wood 8%, cloth 10%, ironstone 4% | **77** |
| middle half | 45-65 | cloth 52%, chalk 12%, cloth2 10%, leather 10%, wood 8%, stone 8% | **63** |
| feet quarter (shins down) | 20-35 | ironstone 36%, under 30%, leather 28%, cloth 6% | **27** |

The halo, the bells, the cowl and the collar carry the top quarter; the pale robe over a blue-grey panel carries the middle; the dark hem band, leggings and boots are the feet. The robe's pale upper falls in the middle band too: the blue-grey inner panel keeps the middle mean in range. If lineup_qa shows the middle above 65, widen the inner panel by 5%.

## 7. Accent (template 7)

Seven clapper beads, each about 2 cm across (3 cm2) = 21 cm2, against roughly 8,800 cm2 of silhouette including the halo: **about 0.25%** (budget 5%), 100% in the top half (the bells hang at about 1.95-2.0 m). At rest the emissive is 0.8; it blooms to 1.5 or more in the wind-ups of Peal and Morning Toll, as a warning that a stun is coming; the clappers swing, so they shimmer with the bell sway of the `idle` clip. Seven points spread round a 0.8 m ring, so the colour reads from any angle, including from above.

## 8. Motion (template 8)

`MOTION = anim.motion_profile(weight="light", weapon="staff", stance="neutral", run_ref_speed=3.35, blocks=BLOCKS)`

`BLOCKS` (the right hand holds the rod upright; the left is free):
- **guard / idle:** the rod upright at the right shoulder, the left hand loose at the hip; very upright, the head level so the halo sits flat; the bells hang still (they are rigid, the bell sway is the whole halo's one-bone rock of 2 degrees).
- **run:** a long gliding stride, the rod carried upright, the left arm light; contact 0.30, a light bob; the hem panels sway one bone each.
- **lobby:** the rod grounded, the left hand ringing the wrist bell; see below.

Four distinct ability gestures. Frame counts are multiples of 5 at 30 fps; the impact is at exactly 40% of the clip (frame = 0.4 × N). The sim's `castTime` is the windup before the effect lands; the clip's impact frame is the visual hit. A `castTime` of 0 means the effect starts at once, so the anticipation stays at 4 frames or fewer and the gesture must not hide a dash.

| Clip | Frames (impact) | Sim ability | Gesture |
|---|---|---|---|
| `cast_a1` | 25 (f10) | **Peal** · castTime 0.2 s · ring of sound at a point up to 9 m | He lifts the rod overhead and draws a wide circle in the air with its head (f0-f8), and at f10 strikes the invisible ring, the halo rocking so the bells ring; the left hand opens to the target. Recover by f25. Silhouette: the rod becomes a circle, the halo tilts. |
| `cast_a2` | 15 (f6) | **Glass Chime** · castTime 0.2 s · 9 m chime-bolt | A fast flick: the rod tip jabs forward and snaps back at f6 as the chime-bolt leaves, the halo giving one bright bell-note rock; the body stays still. Recover by f15. Silhouette: a thin vertical becoming a thin forward line, then back. |
| `cast_a3` | 20 (f8) | **Ring Out** · castTime 0.2 s · 3.5 m, 90 degree cone, push | A two-handed horizontal swing: the left hand joins the rod and sweeps it across the front in a 90 degree arc, f8 at the centre of the arc, the shoulders turning with it; the halo swings out and settles. Silhouette: a wide horizontal bar swept across the front. |
| `cast_ult` | 40 (f16) | **Morning Toll** · castTime 0.3 s · three tolls on a 4.5 m area | He raises the rod high with both hands and his head back so the halo tilts up and every bell rings (f0-f12, a held pose that breathes: the bells sway in turn); at f16 he brings the rod head down onto the ground like a hammer on a great bell, the halo ringing; the tolls land after the clip ends the strike. Hold f16-f30 with the rod grounded and the bells still sounding, then lift. Silhouette: a tall rod, then a rod grounded under a ringing halo. |

Other clips: `run` at 3.35 m/s (light, foot slide under 8%); `attack1` a tap of the rod head forward, `attack2` a two-step tap-and-twirl (both 20 frames, impact f8, the bolt leaves at the impact frame); `death` rings the rod once on the ground and sinks to his knees, the halo tilting and the rod falling across his lap (ends at rest); `recall` grounds the rod and rings the wrist bell three times; `stunned` jolts with the halo ringing; `dash` is the glide loop; `taunt` taps the rod head on the halo ring to make a clear bell note.

**`idle_lobby`** (loops, closed first = last pose): Polite and a little early. He stands upright with the rod grounded, rings the wrist bell once and listens to it with his head tilted, then checks the halo's bells one by one with a finger, finds one slightly flat and smiles, as if that was the point. He glances at the sun, then the camera, and nods. 120 frames.

**`victory`** (ends in a hold): He raises the rod and strikes a bright bell-note, then another, then holds the third stroke back with a smile; the halo rings the first two. Final hold: the rod grounded at the right, the left hand raised with one finger up (the stroke he did not ring), the halo level, a quarter turned from the camera. 55 frames, then the hold.

## 9. Skins (template 9)

Palette swaps plus optional extra geometry read from `ctx.skin["extra"]`. Every skin keeps the rig, clips, silhouette class (height ±5%, footprint ±10%), accent locations and value gradient; none adds metal, a single saturated full-body colour, or a reserved hue above 40% saturation. Names, tiers and descriptions come from `content/skins/vashil.json`. The named hex is the identity colour of the skin: where it falls outside a band's L* range, the surface steps lighter or darker by band and the identity hex is used at its own band.

### `vashil_base`: Vashil (base)

Points at the base files (`assets/fighters/vashil/vashil.glb`). The palette is section 5.

### `vashil_chalkline`: Chalkline Bells (standard)

*"An ink-grey robe with chalk line-work drawn on it, in the style of the Aubade chalk drawings. The bells stay clear glass."*

An ink-grey robe (`#3A3F47`, matte painted, non-metal) drawn over with chalk line-work (`#E6E0D2`, in lines at most 1 cm wide so that no area reads as Noonwhite, covering at most 20% of the surface): spire sketches, bell shapes and a sun. The robe is the deep tone, so the middle band re-mixes; the halo, the bells, the cowl and the collar stay light so the top quarter holds its value. The bells stay clear glass. **No extra geometry.**

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `cloth` | `#3A3F47` | 26 | 217° / 18% | the named ink-grey robe #3A3F47 (inner robe and sleeves) |
| `chalk` | `#D9D4C6` | 85 | 44° / 9% | halo ring, collar, cowl, outer robe panels (chalk line-work is texture) |
| `cloth2` | `#C9C9C1` | 81 | 60° / 4% | sash |
| `linework` | `#E6E0D2` | 89 | 42° / 9% | chalk line-work (thin lines only, at most 20% of the surface; exempt from the L* 86 area rule) |

Value bands (area-weighted): top **79** (70-85) · mid **65** (45-65) · feet **26** (20-35).

This skin re-mixes the bands: the ink-grey robe is dark, so the pale outer robe panels (`chalk`) carry the middle band and the ink-grey is a smaller share of it.

`SKINS` entry: `{"id": "vashil_chalkline", "palette": {...as above...}, "extra": {}, "card": {"primary": "#3A3F47", "secondary": "#E6E0D2"}}`

### `vashil_first_bell`: First Bell Halo (deluxe)

*"Ten bells instead of seven, one for each hour-mark of the Shadowless Noon, over a pale dial-stone robe and a dark hem."*

The FRAY winners' honour: the halo carries **ten bells**, one for each hour-mark, over a pale dial-stone robe with a dark hem, which keeps the value gradient steep. **Extra geometry:** three extra bells (and their clapper beads) on the same ring, closer together; the halo's diameter stays 0.80 m, so the footprint is unchanged and the new bells stay inside the halo's footprint. The accent now has ten clapper beads, still under 0.5% of the silhouette.

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `chalk` | `#D8D2C4` | 84 | 42° / 9% | halo ring and robe, warm dial-stone |
| `cloth` | `#8D8A84` | 58 | 40° / 6% | inner robe panel, dial-stone grey |
| `stone` | `#C9C4B8` | 79 | 42° / 8% | pale dial-stone shoulder plates |
| `ironstone` | `#38363A` | 23 | 270° / 7% | the dark hem band |
| `under` | `#34322F` | 21 | 36° / 10% | leggings |
| `leather` | `#3A332D` | 22 | 28° / 22% | boots, bracers, dark |

Value bands (area-weighted): top **78** (70-85) · mid **63** (45-65) · feet **24** (20-35).

`SKINS` entry: `{"id": "vashil_first_bell", "palette": {...as above...}, "extra": {"bells": 10}, "card": {"primary": "#4A4640", "secondary": "#D8D2C4"}}`

## 10-11. Export and renders

- Splash: `SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "yaw": 22.0}`. The halo catches the low sun from behind-left with every bell lit; the raised finger is on the camera side.
- Portrait (512 square, `idle_lobby` t 0, yaw 28): the arched visor, the lowest bells and the chalk ring. Icon (128 square): the arched visor under the ring with two bells.
- GLB budget 10-25k tris and at most 1.2 MB, base and both skins.

## Per-fighter checks (on top of the template checklist)

- [ ] The halo is at least 0.8 m across and reads as a bright ring above the head in black at 64 px; the body reads as a thin vertical column.
- [ ] IoU against Tunlan, Ardit and Ilsheta <= 0.80; nothing wider than the halo above the shoulders.
- [ ] The halo, the rod and the robe panels are rigid; the halo rocks as one bone (2 degrees); the robe uses at most 2 sway bones.
- [ ] The clapper beads are the only emissive material; the bells and the visor are glossy but never glow.
- [ ] The `cast_ult` strike is exactly at f16 and the halo keeps ringing through the hold; the three tolls are VFX and sim timing, not extra clip frames.
