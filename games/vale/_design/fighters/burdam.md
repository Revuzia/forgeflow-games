# Burdam · Breaker: art brief

`burdam` · Serenade (he) · large, lean end (anchor 2.4 m, authored at 2.15 m) · 2.15 m · res_tally · melee 2 m phys · difficulty 1

> Source of truth: `_design/ROSTER.md` §3 entry 2, `content/fighters/burdam.json`, `content/skins/burdam.json`. Look law: `STYLE_BIBLE.md` (Fighters, Look rules), `_design/tokens.json` `fighter`, `WORLD.md` §2 (faces). Pipeline: `CONTRACT.md` §12, `art/README.md` and `art/blender/fighters/_template.py`; the section numbers below follow the template's 0-11. Art authors the numbers marked *start value*; the `lineup_qa` / three QA measurements decide.

Banned for every fighter: gears, clock hands, gold filigree, gems, glowing runes, metallic bevels, teal-and-gold, red-versus-green. Every material is non-metallic (metalness 0): "iron" and "steel" mean matte, painted, oxidised-looking stone or ironstone, never a bright edge. Only the `accent` material emits; dawnglass and lampresin are glossy but never emissive.

## 0. Brief

| Field | Value |
|---|---|
| `ID` (file name = content id) | `burdam` |
| `TITLE` (collection title, never an epithet) | Grudge holder |
| `ROLE_MASS` | `breaker` (Breaker; `class_breaker`) |
| `ORIGIN` | `serenade`: carved or lacquered mask |
| Fight job | Stays on whoever hurt him and makes every one of them pay it back at once. |
| Positions | `shadehold` / `grovehunter` · bot `skirmisher`, preferred range 2 m |
| Height | **2.15 m** (class: large, lean end (anchor 2.4 m, authored at 2.15 m)); 109 px at 1080p, 72 px at 720p (vertical px = 50.5 × height m; horizontal 82.1 px per m) |
| `art.height` / `collisionRadius` / `moveSpeed` | 2.15 m / 0.62 m / 3.45 m/s: author `run` for **3.45 m/s** (`runRefSpeed`); the content JSON still carries the 3.6 placeholder until `art.json` is copied back |
| Weapon + motion | ironstone cleaver as long as he is tall, `two_hand`; weight `heavy`, stance `wide`. Carried on the right shoulder, overhead chops. |
| `CARD` = `FighterDef.palette` | primary `#5E4F45` · secondary `#9A7B62` (collection and draft backdrops; already in the JSON) |
| Kit (for the body notes) | passive **Long Memory** · a1 **Bear Down** · a2 **Stubborn** · a3 **Old Wound** · ult **Settled Account** |

## 1. Silhouette at 96 px

- **Mass: Breaker, inverted wedge.** Massive pauldrons narrowing to waxed-leather boots, one oversized weapon on one side. Shoulders with pauldrons 1.05 m wide, belt 0.50 m, boots 0.42 m across the pair: shoulders : hips is 2.1.
- **Hook:** the notched cleaver rests on the right shoulder and rises behind and above the head as a long diagonal bar, 1.45 m of blade at about 55 degrees: about 90 px long on screen at 1080p. Its back carries five notches; the accent sits in them.
- **Asymmetry:** the right pauldron is a three-tier stack (the cleaver's cradle), the left a single huge plate with a flat top: the heavier shoulder sits on the weapon side, so facing reads from above.
- **At 64 px:** one diagonal bar above the head, a wide trapezoid of shoulders, a tapering torso, two small dark feet. The head is small relative to the shoulders (6.3 heads, head 0.34 m).
- **Distinct from Kemdo** (the other Breaker): Burdam's weapon is a broad blade (34 cm at the heel) with no round element and the pauldrons are huge; Kemdo is hooded and lean, with a thin vertical pole and a round lens.

Pairs to test first (IoU <= 0.80 at 64 px):

- **Burdam / Kemdo** (both Breakers): broad diagonal cleaver and stacked pauldrons versus a thin vertical glaive with a disc head and slim wraps.
- **Burdam / Marund:** inverted wedge with a diagonal bar versus a block with a flat disc crown.
- **Burdam / Rishal:** wide wedge, upright, versus a narrow figure leaning 15 degrees.

## 2. Proportions and shape (template 1)

- **Large class, lean end**: height 2.15 m (the body at the crown of the cowl; `art.height` is measured without the cleaver, whose tip stands about 0.8 m above the head when carried), head 0.34 m (6.3 heads). The pauldrons, not the height, carry the large read.
- **Stylized heroic:** hands x1.55, forearms x1.3, boots x1.25 wide; a short thick neck. Barrel chest, narrow waist and hips: the wedge is built into the body before the armour is added.
- *Start values:*

```python
PROPORTIONS = rig.proportions(height=2.15, head=0.34, neck=0.055, shoulder_width=0.58, hip_width=0.21, leg=0.94,
                              thigh_frac=0.50, arm=0.69, upper_arm_frac=0.52, hand=0.24, foot=0.35,
                              ankle_height=0.105, spine_curve=0.03, stance=0.06, toe_out_deg=9.0, knee_bend=0.014)
SHAPE = body.shape(girth=1.06, torso_w=1.14, torso_d=1.06, chest=1.16, waist=0.9, hips=0.88, arm=1.14, forearm=1.3,
                   leg=0.92, calf=1.0, hand=1.55, neck=1.3, head_w=1.1, head_d=1.08, jaw=1.1, feet=False)
```

## 3. Face (template 3)

- **Serenade ledger mask.** A pale-ochre lacquered mask (`kit.carved_mask`) scored with vertical tally cuts (a normal-map relief 3 mm deep: the cuts are texture, the brow shelf of at least 6 cm and the beak keel are geometry). Ink almond eye recesses; the keel is the facing cue. A heavy felt cowl bunches around the neck and frames the mask. No bare face, no hair.
- The mask is the brightest value on the figure (L* 79); the cowl is a step darker.

## 4. Armour, cloth and props (template 4)

- **Pauldrons.** Oxidised-iron look, matte and non-metallic, rust-grey (`rust`, desaturated) with darker staining only in the recesses. Right: three overlapping tiers, 0.55 x 0.42 m, 8 cm thick with 2-4 cm bevels, forming a cradle for the cleaver. Left: one plate 0.60 x 0.45 m with a flat top and horizontal ledger-line relief (one row per day, 6 rows, 1.5 cm deep). Edge chalking on the convex edges lifts the top band.
- **Torso.** A waxed-leather harness crossing the chest diagonally (left shoulder to right hip), a heavy leather belt, a felt tunic (`cloth`), a bundle of five carved tally sticks hanging on the left of the belt (rigid, 0.20 m, no sway).
- **Legs.** Tapered ironstone tassets over dark leggings, waxed-leather boots (x1.25 wide) with ironstone toe caps.
- **Prop: the cleaver** (prop space: grip at the origin, haft +Z). Haft 0.70 m, wrapped (`leather`), pommel a flat disc; blade 1.45 m long, 34 cm at the heel tapering to a 20 cm squared tip, honed `stone` with an ironstone spine. Seven notches along the back (spine), each a 9 cm wide, 7 cm deep chevron cut; the five nearest the heel carry accent slabs. 3 cm bevels on the edge, never a bright metal edge: the cutting edge is a honed band at most one step lighter than the blade.

Sockets (`art.json` `sockets`; the standard set stays exactly as in the content JSON):

`origin root`, `chest chest`, `head head`, `hand_r hand.R`, `hand_l hand.L`, `weapon / weapon_r prop.R`, `weapon_l prop.L`, `foot_r foot.R`, `foot_l foot.L`, plus the extras `weapon_tip x_blade_tip` (the cleaver's tip: Bear Down and Old Wound chips) and `notch x_notch_mid` (centre of the accent notches: the Grudge mark glint).

## 5. Palette (template 5)

Hexes are authored albedo in the bible vocabulary (`materials.bible_palette` roles). None of the reserved relationship hues (Dawn azure `#3F9CFF`, Dusk marigold `#FF9A1F`, Noonwhite `#F4EFE2`) dominates: every large-area colour is below 40% saturation inside the azure (200-225°) and marigold (25-50°) hue bands, and no large area is lighter than L* 86. The `accent` role is authored azure; the renderer tints it per viewer.

| Role | Hex | L* | Hue / sat | Where it is used |
|---|---|---|---|---|
| `sandstone` | `#D4C2A0` | 79 | 39° / 25% | ledger mask (pale ochre lacquer) |
| `cloth2` | `#C6B9A5` | 76 | 36° / 17% | felt cowl, collar |
| `rust` | `#B8A794` | 69 | 32° / 20% | pauldrons, tassets (oxidised-iron look, matte) |
| `stone` | `#CCC5B8` | 80 | 39° / 10% | cleaver blade and cutting edge band |
| `ironstone` | `#4B4039` | 28 | 23° / 24% | blade spine, toe caps, tassets, deepest recesses |
| `leather` | `#554336` | 30 | 25° / 36% | harness, belt, boots, haft wrap |
| `cloth` | `#86796D` | 52 | 29° / 19% | felt tunic |
| `wood_dark` | `#5A4639` | 31 | 24° / 37% | tally sticks, pommel |
| `under` | `#3A3735` | 23 | 24° / 9% | leggings |
| `ink` | `#17181B` | 8 | 225° / 15% | mask eye recesses |
| `accent` | `#3F9CFF` | 63 | 211° / 75% | five accent slabs set in the cleaver-back notches |


## 6. Value gradient (template 6)

Light head, dark feet: the bible bands measured on screen by `lineup_qa` (top quarter L* 70-85, middle 45-65, feet 20-35; at least 40% of the silhouette at rest value). The means below are area-weighted estimates of the authored albedo before the `VALUE_GRADIENT_STOPS` ramp (x0.62 at the feet to x1.06 at the crown) and the baked top light, so the on-screen top band sits a little higher.

| Band | Target L* | Mix (share of the band) | Mean L* |
|---|---|---|---|
| top quarter (crown to chest) | 70-85 | rust 34%, stone 26%, cloth2 18%, sandstone 14%, leather 4%, ironstone 4% | **71** |
| middle half | 45-65 | cloth 36%, leather 18%, rust 18%, under 12%, stone 10%, wood_dark 6% | **49** |
| feet quarter (shins down) | 20-35 | under 40%, leather 32%, ironstone 20%, rust 8% | **30** |

The pauldrons are the biggest top-band surface and are oxidised iron: keep them rust-grey (L* 69) with chalked convex edges, not dark. The mask (L* 79) and the cleaver's honed blade (L* 80) carry the light; the dark leather harness is thin. If the top band measures under 70, lighten `rust` by 3 L* before touching the mask. The tassets and boots darken toward the feet band.

## 7. Accent (template 7)

Five slabs in the cleaver's back notches, 9 x 6 cm each, about 270 cm2 against roughly 18,000 cm2 of silhouette: **about 1.5%** (budget 5%), all above 1.4 m when the cleaver rests on the shoulder, so 100% in the top half. At rest the emissive is 0.8; it blooms to 1.5 or more only during the wind-ups of Stubborn and Settled Account (the notches light one by one as Grudge stacks fill: the slabs are one material, so the stack read is a VFX job, not a per-slab emissive).

## 8. Motion (template 8)

`MOTION = anim.motion_profile(weight="heavy", weapon="two_hand", stance="wide", run_ref_speed=3.45, blocks=BLOCKS)`

`BLOCKS` (reference breaker pattern, `guard` / `run_fwd` / `run_back`): the cleaver rests on the right shoulder, blade up and back, the right hand at the haft's mid-point, the left hand low at the belt (free for the Settled Account pull).
- **guard / idle:** weight on the back foot, the blade angle 55 degrees above horizontal; the shoulders rise 2 cm on each breath.
- **run:** the cleaver stays on the shoulder (the right arm swings short), the left arm pumps; contact 0.38, heavy bob.
- **lobby:** the cleaver on the right shoulder with the right hand on the haft, the left thumb running over the blade-back notches.

Four distinct ability gestures. Frame counts are multiples of 5 at 30 fps; the impact is at exactly 40% of the clip (frame = 0.4 × N). The sim's `castTime` is the windup before the effect lands; the clip's impact frame is the visual hit. A `castTime` of 0 means the effect starts at once, so the anticipation stays at 4 frames or fewer and the gesture must not hide a dash.

| Clip | Frames (impact) | Sim ability | Gesture |
|---|---|---|---|
| `cast_a1` | 25 (f10) | **Bear Down** · castTime 0.1 s · lunge up to 5 m to a target, chop | Pulls the cleaver off the shoulder in one overhand arc while the left foot plants; a lunge forward with a 20 degree lean (the sim dashes him to the target). Anticipation 4 frames (castTime 0.1 s). The chop lands at f10 with the blade 20 degrees past vertical, the weight dropped onto the front foot. Follow-through to f17, recover to the shoulder by f25. Silhouette: the diagonal bar swings down in front. |
| `cast_a2` | 30 (f12) | **Stubborn** · castTime 0 s · brace, +armor and tenacity 3 s, stamp when it ends | Instant effect (castTime 0): the gesture starts as a lock-in. He plants the cleaver tip in the ground in front of him and folds both hands on the pommel (f0-f8), head down, chest lifting; at f12 the stance locks wide (the "set" pose). Hold to f24 as the buff stays up, then breathe out and lift. The stamp 3 s later (when the buff ends) has no clip of its own: it is the VFX ring closing at his feet, so `cast_a2` ends with the cleaver planted and the pose already reads as braced. Silhouette: a T, blade up as the post. |
| `cast_a3` | 30 (f12) | **Old Wound** · castTime 0.25 s · 4 m, 100 degree cone | Wide horizontal sweep from the right shoulder across the body to the left (f0-f8 draw back, 90 degree torso turn), the blade at waist height at f12 with the full arc through the cone, then a 100 degree follow-through and a deliberate pause at f20 (the old wound reopening). Silhouette: a long horizontal bar sweeping at belly height. |
| `cast_ult` | 45 (f18) | **Settled Account** · castTime 0.35 s · 7 m pull and stun, per-Grudge damage | The left arm reaches out open-palmed and the right holds the cleaver back (f0-f10); at f18 the left fist closes and yanks back to the chest as the cleaver comes down behind it and the tip stamps the ground, the whole body rocking back 10 degrees: a ring closing. Hold the stamp f18-f30, then straighten. Silhouette: one arm out, then a collapsing wedge. |

Other clips: `run` at 3.45 m/s (heavy, foot slide under 8%); `attack1` an overhand chop from the shoulder, `attack2` a backhand horizontal cut (40 frames, impact f16); `death` falls to one knee, then forward over the cleaver, which stays planted (ends at rest on the ground); `recall` plants the cleaver and lights a stub of tally stick with his thumb; `stunned` staggers back a half step; `dash` and `taunt` follow the standard generators (the taunt notches a tally stick).

**`idle_lobby`** (loops, closed first = last pose): A patient, stern host. He shifts the cleaver from one shoulder to the other every few seconds, runs his thumb along the notches in its back as if counting, then tilts his head 5 degrees and nods at something only he remembers. 120 frames.

**`victory`** (ends in a hold): He does not celebrate. He plants the cleaver tip, takes a tally stick from his belt, scores it once with his thumbnail, and nods. Final hold: the cleaver planted, the left hand open and held out palm up: a host's gesture, "you are forgiven". 60 frames, then the hold.

## 9. Skins (template 9)

Palette swaps plus optional extra geometry read from `ctx.skin["extra"]`. Every skin keeps the rig, clips, silhouette class (height ±5%, footprint ±10%), accent locations and value gradient; none adds metal, a single saturated full-body colour, or a reserved hue above 40% saturation. Names, tiers and descriptions come from `content/skins/burdam.json`. The named hex is the identity colour of the skin: where it falls outside a band's L* range, the surface steps lighter or darker by band and the identity hex is used at its own band.

### `burdam_base`: Burdam (base)

Points at the base files (`assets/fighters/burdam/burdam.glb`). The palette is section 5.

### `burdam_stillwater`: Stillwater Cleaver (standard)

*"Wet basalt armour with river-glass inlays and rigid reed plates, from the shallows of the Fallen Shaft."*

Wet-basalt armour (`#4D5A5C`) with river-glass inlays (`#8FB3A8`, hue 162, 20% saturation) and rigid reed plates (`#7D8460`) over the shoulders, from the shallows of the Fallen Shaft. The basalt is the lower armour and tassets; the pauldron tops step lighter so the top quarter holds its value. **Extra geometry:** three rigid reed plates fanned over each shoulder (2 cm thick, flat, no sway bones) and river-glass inlays set in the pauldron tiers; nothing taller than the cleaver.

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `sandstone` | `#D4C9A9` | 81 | 45° / 20% | ledger mask (pale ochre lacquer) |
| `cloth2` | `#C2C3B8` | 78 | 65° / 6% | felt cowl, collar |
| `rust` | `#9AA7A9` | 68 | 188° / 9% | pauldron tops, lighter wet basalt |
| `stone` | `#C4C8C4` | 80 | 120° / 2% | cleaver blade |
| `ironstone` | `#4D5A5C` | 37 | 188° / 16% | the named basalt #4D5A5C (tassets, greaves, spine) |
| `leather` | `#554A3E` | 32 | 31° / 27% | harness, belt, boots, haft wrap |
| `cloth` | `#6E7B7B` | 51 | 180° / 11% | wet-stone tunic |
| `under` | `#343B3D` | 24 | 193° / 15% | leggings |
| `reed` | `#7D8460` | 54 | 72° / 27% | reed plates over the shoulders |
| `dawnglass` | `#8FB3A8` | 70 | 162° / 20% | river-glass inlays |

Value bands (area-weighted): top **73** (70-85) · mid **49** (45-65) · feet **33** (20-35).

`SKINS` entry: `{"id": "burdam_stillwater", "palette": {...as above...}, "extra": {"reed_plates": True, "river_glass": True}, "card": {"primary": "#3E4A4C", "secondary": "#8FB3A8"}}`

### `burdam_almanac`: Almanac Ledger (deluxe)

*"Pauldrons printed like ruled pages, day-marks down the cleaver's back and a rigid almanac board hung at his belt."*

Pauldrons printed like ruled parchment pages (`#D8CDB4`, ink ledger lines `#2E2A26`) and day-marks printed down the cleaver's back. The ink `#2E2A26` is the deep tone (spine, toe caps, ruled lines). **Extra geometry:** a rigid almanac board hung at the belt on the right (0.20 x 0.26 m, 2 cm thick, carved walnut with a parchment face, no sway bone); the ruled lines and the day-marks are texture. The accent notches and slabs are unchanged.

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `cloth2` | `#C6B9A5` | 76 | 36° / 17% | cowl |
| `rust` | `#D8CDB4` | 83 | 42° / 17% | parchment-printed pauldrons (the named #D8CDB4) |
| `stone` | `#CFC8B8` | 81 | 42° / 11% | cleaver blade with day-marks |
| `ironstone` | `#2E2A26` | 17 | 30° / 17% | the ink #2E2A26 (spine, toe caps, ruled lines) |
| `cloth` | `#8A7F72` | 54 | 33° / 17% | warm grey tunic |

Value bands (area-weighted): top **76** (70-85) · mid **52** (45-65) · feet **29** (20-35).

`SKINS` entry: `{"id": "burdam_almanac", "palette": {...as above...}, "extra": {"almanac_board": True}, "card": {"primary": "#4A453E", "secondary": "#D8CDB4"}}`

## 10-11. Export and renders

- Splash: `SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92}`. The final hold (cleaver planted, open left hand) is a calm pose; the camera is on the character's left so the stacked right pauldron and the notched blade-back face the viewer.
- Portrait (512 square, `idle_lobby` t 0, yaw 28): the ledger mask in the felt cowl, the left pauldron's ruled relief, the cleaver's edge entering from the top right. Icon (128 square): the scored mask with one lit notch above it.
- GLB budget 10-25k tris and at most 1.2 MB, base and both skins.

## Per-fighter checks (on top of the template checklist)

- [ ] Shoulders : hips >= 1.4 (target 2.0) and the diagonal bar reads in black at 64 px.
- [ ] IoU against Kemdo <= 0.80 (test first), then Marund and Rishal.
- [ ] The cleaver stays on the shoulder through `idle` and `run` without clipping the cowl; the five notch slabs face the camera side; `art.height` (2.15 m) is measured without the cleaver.
- [ ] No bright metal edge: the cleaver's edge band is honed stone at L* 80-84, never above 85.
- [ ] The Settled Account pull reads at 64 px: one arm out, then the wedge collapsing.
