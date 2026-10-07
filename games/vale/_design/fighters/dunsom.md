# Dunsom · Caster: art brief

`dunsom` · Serenade (he) · standard, tall end (anchor 1.9 m, authored at 2.05 m) · 2.05 m · res_light · ranged 5.2 m magic · difficulty 3

> Source of truth: `_design/ROSTER.md` §3 entry 5, `content/fighters/dunsom.json`, `content/skins/dunsom.json`. Look law: `STYLE_BIBLE.md` (Fighters, Look rules), `_design/tokens.json` `fighter`, `WORLD.md` §2 (faces). Pipeline: `CONTRACT.md` §12, `art/README.md` and `art/blender/fighters/_template.py`; the section numbers below follow the template's 0-11. Art authors the numbers marked *start value*; the `lineup_qa` / three QA measurements decide.

Banned for every fighter: gears, clock hands, gold filigree, gems, glowing runes, metallic bevels, teal-and-gold, red-versus-green. Every material is non-metallic (metalness 0): "iron" and "steel" mean matte, painted, oxidised-looking stone or ironstone, never a bright edge. Only the `accent` material emits; dawnglass and lampresin are glossy but never emissive.

## 0. Brief

| Field | Value |
|---|---|
| `ID` (file name = content id) | `dunsom` |
| `TITLE` (collection title, never an epithet) | Dusk herder |
| `ROLE_MASS` | `caster` (Caster; `class_caster`) |
| `ORIGIN` | `serenade`: carved or lacquered mask |
| Fight job | Moves the enemy where his team wants them: pulled into the pool, pushed off the carry. |
| Positions | `dialcross` / `lampglass` · bot `artillery`, preferred range 7 m |
| Height | **2.05 m** (class: standard, tall end (anchor 1.9 m, authored at 2.05 m)); 104 px at 1080p, 69 px at 720p (vertical px = 50.5 × height m; horizontal 82.1 px per m) |
| `art.height` / `collisionRadius` / `moveSpeed` | 2.05 m / 0.55 m / 3.35 m/s: author `run` for **3.35 m/s** (`runRefSpeed`); the content JSON still carries the 3.6 placeholder until `art.json` is copied back |
| Weapon + motion | a shepherd's crook taller than he is, `staff`; weight `medium`, stance `neutral`. A lampresin lantern hangs in the hook. |
| `CARD` = `FighterDef.palette` | primary `#4E4A5C` · secondary `#A48F6E` (collection and draft backdrops; already in the JSON) |
| Kit (for the body notes) | passive **Settling** · a1 **Draw In** · a2 **Crook Sweep** · a3 **Step Through Dusk** · ult **Driving Hour** |

## 1. Silhouette at 96 px

- **Mass: Caster, line plus disc.** A tall, thin body (shoulders 0.40 m) under a broad round felt hood-rim 0.62 m across (the disc, 51 px at 1080p), with a crook 2.55 m tall (the line) whose hook rises 0.50 m above the hood and bends forward.
- **Hook:** the crook's hook with the lantern hanging in it (0.14 m wide, 0.22 m tall) above and in front of the disc. The lantern is the accent and the topmost form on the figure.
- **Size:** the figure is 104 px tall at 1080p (69 px at 720p); the crook shaft is 6 cm thick (5 px), the minimum feature size, and the hook is 7 cm.
- **At 64 px:** a thin vertical line, a flat disc one head below the crown, a long coat, and one taller vertical (the crook) with a small hook at the top. The disc is round and shallow with a visible gap between its rim and the shoulders.
- **Facing from above:** the mask's beak shows under the front of the rim, the crook's hook bends toward the front, and the coat's front panel is a single long fold.

Pairs to test first (IoU <= 0.80 at 64 px):

- **Dunsom / Tunlan** (half B Caster): both wear a wide round headpiece. Dunsom's is a felt hood-rim 0.62 m across that sits low over the brow, over a long coat, with a crook rising above it; Tunlan's lampshade is wider and flatter. If IoU passes 0.80, raise the crook's hook by 0.1 m and narrow the rim to 0.58 m.
- **Dunsom / Ilsheta:** a tall thin line with a flat disc versus a round open figure with a vertical chimney.
- **Dunsom / Odrum:** a vertical crook and a broad round hood-rim versus a horizontal yoke and a narrow cap.

## 2. Proportions and shape (template 1)

- **Standard class, tall end**: height 2.05 m measured at the crown of the hood-rim (the crook and the lantern are props and do not set `art.height`: measure the rest pose with the crook in the hand, as the template does, so the health bar sits at the head), head 0.32 m (6.4 heads).
- **Stylized heroic:** hands x1.45 (the crook hands), boots x1.2 wide, a slim body kept narrow so the disc and the crook carry the read; a long neck (0.065 m) lets the hood-rim sit clear of the shoulders.
- *Start values:*

```python
PROPORTIONS = rig.proportions(height=2.05, head=0.32, neck=0.065, shoulder_width=0.42, hip_width=0.20, leg=0.93,
                              thigh_frac=0.50, arm=0.66, upper_arm_frac=0.52, hand=0.22, foot=0.32,
                              ankle_height=0.095, spine_curve=0.02, stance=0.035, toe_out_deg=7.0, knee_bend=0.012)
SHAPE = body.shape(girth=0.92, torso_w=0.94, torso_d=0.94, chest=0.95, waist=0.9, hips=0.92, arm=0.95, forearm=1.1,
                   leg=0.92, calf=0.98, hand=1.45, neck=1.25, head_w=1.06, head_d=1.04, jaw=1.0, feet=False)
```

## 3. Face (template 3)

- **Serenade carved ochre mask** (`kit.carved_mask`): planar facets, a brow shelf of at least 6 cm, ink almond eye recesses and a beak keel (`kit.mask_beak`, 4 cm) as the facing cue, framed by a deep felt hood whose broad round rim is the disc (`kit.hood` with a flat brim; the hood is rigid, no sway). A scarf (`cloth2`) covers the lower face.
- The rim must clear the brow by 3 cm so the eyes read at the portrait angle; the rim is rigid and never droops.

## 4. Armour, cloth and props (template 4)

- **Hood-rim.** Heavy felt (`cloth2`, pale dusk-lavender grey), a shallow cone 0.62 m across the rim, 4 cm thick at the edge with 2-4 cm bevels, a stitched edge band. It is the lightest large form on the figure.
- **Coat.** A long heavy felt coat to the shins (`cloth`) with sculpted vertical folds (4 folds, 1.8 cm deep), a front panel on `x_coat_f` and a back panel on `x_coat_b` (one bone each), wide cuffs, a leather belt, a knotted linen scarf (`cloth2`, rigid).
- **Legs.** Slim dark trousers (`under`), plain leather boots (x1.2 wide) with ironstone toe caps.
- **Prop: the crook** (prop space: grip at the origin, shaft +Z, length 2.55 m). Pale carved wood (`wood`), 6 cm shaft with a spiral grip wrap (`leather`) at the hands, a 7 cm hook with 2-4 cm bevels, bending forward 0.30 m. The ferrule is carved ironstone (no metal tip).
- **Lantern.** A carved dark-wood frame (`wood_dark`, 0.14 x 0.22 m, four posts and a cap), lampresin glass panes, an `accent` core 10 x 16 cm inside. It hangs from the hook on one 1-bone pendulum chain `x_lantern` (the only sway bone on the figure; amplitude at most 6 degrees, heavily damped, so the accent never blurs).

Sockets (`art.json` `sockets`; the standard set stays exactly as in the content JSON):

`origin root`, `chest chest`, `head head`, `hand_r hand.R`, `hand_l hand.L`, `weapon / weapon_r prop.R`, `weapon_l prop.L`, `foot_r foot.R`, `foot_l foot.L`, plus the extras `weapon_tip x_crook_hook` (the pull and sweep origin), `lantern x_lantern` (the accent and the Driving Hour bloom) and `ferrule x_crook_foot` (the ground stab).

## 5. Palette (template 5)

Hexes are authored albedo in the bible vocabulary (`materials.bible_palette` roles). None of the reserved relationship hues (Dawn azure `#3F9CFF`, Dusk marigold `#FF9A1F`, Noonwhite `#F4EFE2`) dominates: every large-area colour is below 40% saturation inside the azure (200-225°) and marigold (25-50°) hue bands, and no large area is lighter than L* 86. The `accent` role is authored azure; the renderer tints it per viewer.

| Role | Hex | L* | Hue / sat | Where it is used |
|---|---|---|---|---|
| `cloth2` | `#CAC5D4` | 80 | 260° / 7% | felt hood-rim, scarf |
| `sandstone` | `#D0BC9C` | 77 | 37° / 25% | carved ochre mask |
| `wood` | `#C0A383` | 69 | 31° / 32% | the crook (pale carved wood) |
| `wood_dark` | `#5A493E` | 32 | 24° / 31% | lantern frame, belt toggle |
| `cloth` | `#777385` | 49 | 253° / 14% | long felt coat, cuffs |
| `lampresin` | `#C9954E` | 65 | 35° / 61% | lantern glass panes (under 4% of the silhouette) |
| `leather` | `#42382E` | 24 | 30° / 30% | belt, boots, grip wrap |
| `under` | `#35323B` | 21 | 260° / 15% | trousers |
| `ironstone` | `#444048` | 28 | 270° / 11% | toe caps, crook ferrule |
| `ink` | `#17181B` | 8 | 225° / 15% | mask eye recesses |
| `accent` | `#3F9CFF` | 63 | 211° / 75% | the lantern core |

Lampresin stays under 4% of the silhouette (the lantern panes). The hood-rim felt is a pale dusk-lavender grey (hue 260 degrees, 7% saturation), well away from both reserved hues; the card primary `#4E4A5C` is the backdrop only.

## 6. Value gradient (template 6)

Light head, dark feet: the bible bands measured on screen by `lineup_qa` (top quarter L* 70-85, middle 45-65, feet 20-35; at least 40% of the silhouette at rest value). The means below are area-weighted estimates of the authored albedo before the `VALUE_GRADIENT_STOPS` ramp (x0.62 at the feet to x1.06 at the crown) and the baked top light, so the on-screen top band sits a little higher.

| Band | Target L* | Mix (share of the band) | Mean L* |
|---|---|---|---|
| top quarter (crown to chest) | 70-85 | cloth2 60%, wood 12%, sandstone 10%, cloth 8%, lampresin 4%, leather 4%, wood_dark 2% | **72** |
| middle half | 45-65 | cloth 62%, leather 14%, under 10%, wood 8%, cloth2 6% | **46** |
| feet quarter (shins down) | 20-35 | under 48%, leather 30%, cloth 16%, ironstone 6% | **27** |

The hood-rim is the lightest large form (L* 80) and the whole disc sits in the top quarter, which is why the top mean is a comfortable 72. The coat is mid (L* 49): do not let it go darker than L* 45 or the middle band drops under range. The hem and boots darken toward the feet.

## 7. Accent (template 7)

The lantern core, 10 x 16 cm = 160 cm2 against roughly 11,000 cm2 of silhouette: **about 1.5%** (budget 5%), 100% in the top half (the lantern hangs at 2.1-2.35 m). At rest the emissive is 0.8; it blooms to 1.5 or more only in the wind-up of Driving Hour (the lantern flares before the herd is driven). The lantern sits above the hood-rim, so it is visible from every side and from above.

## 8. Motion (template 8)

`MOTION = anim.motion_profile(weight="medium", weapon="staff", stance="neutral", run_ref_speed=3.35, blocks=BLOCKS)`

`BLOCKS`:
- **guard / idle:** the crook upright in the right hand, the butt on the ground beside the right foot; the left hand rests on the right wrist; the lantern hangs forward of the hook. The hood-rim stays level.
- **run_fwd / run_back:** the crook carried across the body at 30 degrees, both hands on it; a long stride with a light contact (0.30); the coat panels trail rigidly.
- **lobby:** both hands stacked on the crook, the head tilting under the rim.

Four distinct ability gestures. Frame counts are multiples of 5 at 30 fps; the impact is at exactly 40% of the clip (frame = 0.4 × N). The sim's `castTime` is the windup before the effect lands; the clip's impact frame is the visual hit. A `castTime` of 0 means the effect starts at once, so the anticipation stays at 4 frames or fewer and the gesture must not hide a dash.

| Clip | Frames (impact) | Sim ability | Gesture |
|---|---|---|---|
| `cast_a1` | 30 (f12) | **Draw In** · castTime 0.25 s · hook a point up to 9 m, draw enemies 2 m | The crook extends full length toward the point (f0-f9, the hook turned toward the target), then a hard reeling yank back toward his hip: the catch is at f12, the body rocking back 12 degrees, the free hand clenching. Follow-through to f20 as the crook sweeps back, recover to guard by f30. Silhouette: a line that extends and snaps back. |
| `cast_a2` | 35 (f14) | **Crook Sweep** · castTime 0.3 s · 7 x 2 m line, push 2.5 m | A low sweep of the crook along the ground like sweeping a path: both hands on the shaft, a wide pivot from his left to his right at knee height with the hook leading. The crook is parallel to the ground at f14 (the impact, mid-sweep); the coat panels rotate with him. Recover to guard by f35. Silhouette: a long horizontal line, the disc staying level. |
| `cast_a3` | 20 (f8) | **Step Through Dusk** · castTime 0 s · blink 4 m | Instant (castTime 0): the crook planted, a 3-frame cross-step sideways through his own shade, a shoulders-squared arrival at f8 with the free hand raised to the hood-rim in a salute (the impact is the arrival pose). The pose reads on both ends of the blink: the same silhouette without motion blur. Recover to guard by f20. |
| `cast_ult` | 45 (f18) | **Driving Hour** · castTime 0.35 s · 5 m ring herded to a point, 2.5 m eruption | The crook sweeps a full horizontal ring around him at chest height as he turns 360 degrees (f0-f14, the herding circle); at f18 the hook points at the destination point with the arm extended, the lantern swinging forward, and he stamps the crook butt: the drive. Hold the point to f30, then relax by f45. Silhouette: a spinning ring, then one long pointing line. |

Other clips: `run` at 3.35 m/s (medium, foot slide under 8%); `attack1` a crook flick forward (a ranged magic bolt), `attack2` a back-handed flick (both 25 frames, impact f10); `death` lets go of the crook, which falls across him, and he folds at the knees; `recall` hangs the lantern at eye level and cups it; `stunned` clutches the crook as it wobbles; `dash` and `taunt` follow the standard generators (the taunt rings the lantern against the hook).

**`idle_lobby`** (loops, closed first = last pose): A watchful shepherd. He leans on the crook with both hands stacked, lifts the lantern with the hook to look into it, counts under his breath (the head nods in threes), then tilts the hood-rim to look at the sky. The lantern sways within its 6 degree amplitude. 120 frames.

**`victory`** (ends in a hold): He plants the crook, lifts the lantern high on the hook, and bows deeply from the waist with a hand on the hood-rim, the coat panels swinging. Final hold: bowed 30 degrees, the hand on the rim, the crook upright beside him: a shepherd's bow to the flock. 60 frames, then the hold.

## 9. Skins (template 9)

Palette swaps plus optional extra geometry read from `ctx.skin["extra"]`. Every skin keeps the rig, clips, silhouette class (height ±5%, footprint ±10%), accent locations and value gradient; none adds metal, a single saturated full-body colour, or a reserved hue above 40% saturation. Names, tiers and descriptions come from `content/skins/dunsom.json`. The named hex is the identity colour of the skin: where it falls outside a band's L* range, the surface steps lighter or darker by band and the identity hex is used at its own band.

### `dunsom_base`: Dunsom (base)

Points at the base files (`assets/fighters/dunsom/dunsom.glb`). The palette is section 5.

### `dunsom_highrim`: Highrim Herder (standard)

*"A pale hood of wind-carved sandstone and a bleached walnut crook, weathered on the high rim where the wind never stops."*

A pale wind-carved sandstone hood (`#CDBB9C`, 24% saturation) and a bleached walnut crook (`#BFAE95`), from the high rim where the wind never stops. The coat stays the base dusk-grey so the value gradient holds. **No extra geometry**; the hood-rim carries a faint carved wind-grain relief (texture) and nothing taller.

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `cloth2` | `#CDBB9C` | 77 | 38° / 24% | the named wind-carved hood #CDBB9C and scarf |
| `wood` | `#BFAE95` | 72 | 36° / 22% | the named bleached crook #BFAE95 |

Value bands (area-weighted): top **71** (70-85) · mid **46** (45-65) · feet **27** (20-35).

`SKINS` entry: `{"id": "dunsom_highrim", "palette": {...as above...}, "extra": {}, "card": {"primary": "#6E5F4E", "secondary": "#CDBB9C"}}`

### `dunsom_almanac`: Almanac Crook (deluxe)

*"A hood printed with tables of the day and an ink-black crook hung with folded almanac pages."*

A parchment hood printed with tables of the day (`#D8CDB4`) and an ink-black crook (`#2E2A26`) hung with folded almanac pages. The ink crook is thin and tall, so its dark value touches only a small share of the top band; the hood-rim carries the light. **Extra geometry:** three folded almanac pages (0.12 x 0.16 m each, rigid 1 cm plates, on short rigid cords) hung from the crook below the hook; they are rigid and add no sway bone. The footprint stays within +10%. The printed tables are texture.

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `cloth2` | `#D8CDB4` | 83 | 42° / 17% | the named parchment hood #D8CDB4 and scarf |
| `wood` | `#2E2A26` | 17 | 30° / 17% | the named ink crook #2E2A26 |
| `wood_dark` | `#2E2A26` | 17 | 30° / 17% | ink lantern frame |
| `cloth` | `#85818F` | 55 | 257° / 10% | lighter dusk-grey coat so the middle band holds |

Value bands (area-weighted): top **72** (70-85) · mid **48** (45-65) · feet **28** (20-35).

`SKINS` entry: `{"id": "dunsom_almanac", "palette": {...as above...}, "extra": {"almanac_pages": True}, "card": {"primary": "#4A453E", "secondary": "#D8CDB4"}}`

## 10-11. Export and renders

- Splash: `SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92}`. The bow hold keeps the crook inside the frame; use `fill` 0.84 so the lantern above the hood-rim is not cropped.
- Portrait (512 square, `idle_lobby` t 0, yaw 28): the mask under the hood-rim with the lantern glowing in the top corner. Icon (128 square): the mask under the rim and the lantern.
- GLB budget 10-25k tris and at most 1.2 MB, base and both skins.

## Per-fighter checks (on top of the template checklist)

- [ ] The crook shaft is at least 6 cm and reads as a continuous vertical line at 64 px; the disc is round, shallow and level in every pose.
- [ ] IoU against Tunlan (once half B exists), Ilsheta and Odrum <= 0.80.
- [ ] The lantern's pendulum amplitude is at most 6 degrees and it is the only sway bone; the accent never blurs in `run`.
- [ ] `art.height` is measured at the hood-rim crown, not at the crook tip or the lantern.
- [ ] `cast_a3` has at most 4 frames of anticipation (castTime 0).
