# Marund · Plinth: art brief

`marund` · Serenade (he) · large (anchor 2.4 m, authored at 2.35 m) · 2.35 m · res_light · melee 1.9 m phys · difficulty 1

> Source of truth: `_design/ROSTER.md` §3 entry 1, `content/fighters/marund.json`, `content/skins/marund.json`. Look law: `STYLE_BIBLE.md` (Fighters, Look rules), `_design/tokens.json` `fighter`, `WORLD.md` §2 (faces). Pipeline: `CONTRACT.md` §12, `art/README.md` and `art/blender/fighters/_template.py`; the section numbers below follow the template's 0-11. Art authors the numbers marked *start value*; the `lineup_qa` / three QA measurements decide.

Banned for every fighter: gears, clock hands, gold filigree, gems, glowing runes, metallic bevels, teal-and-gold, red-versus-green. Every material is non-metallic (metalness 0): "iron" and "steel" mean matte, painted, oxidised-looking stone or ironstone, never a bright edge. Only the `accent` material emits; dawnglass and lampresin are glossy but never emissive.

## 0. Brief

| Field | Value |
|---|---|
| `ID` (file name = content id) | `marund` |
| `TITLE` (collection title, never an epithet) | Dome mason |
| `ROLE_MASS` | `plinth` (Plinth; `class_plinth`) |
| `ORIGIN` | `serenade`: carved or lacquered mask |
| Fight job | Raises a dome no enemy can step into, so the ally who got caught has three safe seconds. |
| Positions | `lampglass` / `shadehold` · bot `warden`, preferred range 2 m |
| Height | **2.35 m** (class: large (anchor 2.4 m, authored at 2.35 m)); 119 px at 1080p, 79 px at 720p (vertical px = 50.5 × height m; horizontal 82.1 px per m) |
| `art.height` / `collisionRadius` / `moveSpeed` | 2.35 m / 0.68 m / 3.35 m/s: author `run` for **3.35 m/s** (`runRefSpeed`); the content JSON still carries the 3.6 placeholder until `art.json` is copied back |
| Weapon + motion | short-hafted ironstone maul, `two_hand`; weight `heavy`, stance `wide`. Casts lift the maul overhead. |
| `CARD` = `FighterDef.palette` | primary `#6E6358` · secondary `#A58A6C` (collection and draft backdrops; already in the JSON) |
| Kit (for the body notes) | passive **Hearthside** · a1 **Shoulder In** · a2 **Shelter Dome** · a3 **Mortar Pail** · ult **Domefall** |

## 1. Silhouette at 96 px

- **Mass: Plinth block.** Flat crown, widest at the shoulders, square stance. The dome-cap is 0.90 m wide, the shoulders 0.78 m and the hips 0.48 m, so cap : hips is 1.9 and shoulders : hips is 1.6 (rule: at least 1.4).
- **Hook:** the shallow ironstone dome-cap is a flat-topped disc over both shoulders, the only rounded mass among the Plinths. It is 74 px wide at 1080p (49 px at 720p) and carries the three accent windows in its rim.
- **Below the cap:** a stooped trunk that narrows to a square stance, a heavy front apron, and the maul head hanging at the right knee as a 40 x 24 cm block (33 px wide), which reads as a second block under the disc.
- **At 64 px:** the top quarter is one flat-topped disc more than twice as wide as either leg; the legs are two short squares; the maul is a dark block at the right knee. Nothing is thinner than 6 cm (5 px at 1080p).
- **Facing from above:** the mask's beak keel shows 4 cm below the cap's front rim, the apron hangs on the front, and the maul lies on the right.
- **Read order (threat, side, health, self, objective):** the disc is the first read, the apron the second; the accent windows sit on the rim where the health bar's 0.35 m head offset never covers them.

Pairs to test first (IoU <= 0.80 at 64 px):

- **Marund / Hesmi** (both large Plinths): Marund's disc is wider than his shoulders and has no gaps; Hesmi's rack is narrower than her shoulders and is three tall slabs with gaps. If IoU passes 0.80, widen the cap to 0.95 m before touching Hesmi.
- **Marund / Ardit** (half B): flat dome-cap over the shoulders versus a tall pavise beside the body.
- **Marund / Burdam:** a block with a flat crown versus an inverted wedge with a diagonal bar above the head.

## 2. Proportions and shape (template 1)

- **Large class** (anchor 2.4 m): height 2.35 m, head 0.37 m (6.35 heads, measured without the cap). With the cap the head mass is 0.9 m wide and 0.55 m tall.
- **Stylized heroic:** hands x1.6, forearms x1.35, boots x1.3 wide, a short neck (0.05 m) so the cap sits on the shoulders. Stooped: the chest leans 6 degrees forward and `spine_curve` is 0.05.
- *Start values*, scaled from the reference breaker by 2.35 / 1.9:

```python
PROPORTIONS = rig.proportions(height=2.35, head=0.37, neck=0.05, shoulder_width=0.62, hip_width=0.25, leg=1.02,
                              thigh_frac=0.50, arm=0.74, upper_arm_frac=0.52, hand=0.26, foot=0.38,
                              ankle_height=0.12, spine_curve=0.05, stance=0.07, toe_out_deg=9.0, knee_bend=0.014)
SHAPE = body.shape(girth=1.12, torso_w=1.2, torso_d=1.12, chest=1.2, waist=1.0, hips=0.88, arm=1.2, forearm=1.4,
                   leg=0.95, calf=1.05, hand=1.6, neck=1.2, head_w=1.1, head_d=1.08, jaw=1.1, feet=False)
```

## 3. Face (template 3)

- **Serenade carved mask.** A pale-walnut lacquered mask (`kit.carved_mask`): planar facets, a brow shelf of at least 6 cm, ink almond eye recesses and a beak keel (`kit.mask_beak`, 4 cm) as the facing cue. A linen mouth-wrap (`cloth2`) covers the jaw. No bare face, no hair.
- The cap's rim shades the mask from the 52 degree camera, so the mask is mostly a portrait and splash read; the rim must still clear the brow by 3 cm so the eyes are never fully hidden in the portrait.

## 4. Armour, cloth and props (template 4)

- **Dome-cap (the signature).** One honed-dialstone shell, shallow dome, 0.90 m across the rim, 8 cm thick at the rim with 2-4 cm bevels, and a flat cut crown 0.50 m across (the flat crown is the Plinth read). Three horizontal banding grooves 2 cm deep, painted ironstone, like the drum of a Lamp Dome. It rests on two felt shoulder rolls and never touches the neck.
- **Windows.** Three openings in the rim at 0 and +/-42 degrees from facing, 9 x 14 cm each, framed in lampresin and glazed with the `accent` material. These are the only glow.
- **Apron.** Heavy felt front panel, 0.52 m wide and 0.95 m long to the shins, with three sculpted folds 1.6 cm deep, on one `x_apron_f` chain (one bone); a shorter back panel (0.70 m) on `x_apron_b`. Two sway bones in total.
- **Torso and limbs.** Linen shirt with rolled sleeves (`cloth2`), leather forearm wraps over big forearms, dark trousers, big leather boots with ironstone toe caps and shin greaves cut as flat slabs.
- **Belt.** Leather, with a carved pale-ash mortar pail (0.24 m tall, rope handle) on the left hip and a flat wooden trowel through the belt.
- **Prop: the maul** (prop space: grip at the origin, haft +Z). A 0.95 m walnut haft with two lampresin binding bands; an ironstone head block 0.40 x 0.24 x 0.24 m with 3 cm chamfers. Guard pose: head forward at hip height on the right, both hands on the haft.

Sockets (`art.json` `sockets`; the standard set stays exactly as in the content JSON):

`origin root`, `chest chest`, `head head`, `hand_r hand.R`, `hand_l hand.L`, `weapon / weapon_r prop.R`, `weapon_l prop.L`, `foot_r foot.R`, `foot_l foot.L`, plus the extras `weapon_tip x_maul_head` (hit chips for Shoulder In and Domefall), `cap_crown x_cap_crown` (dome and Domefall anchor above the flat crown) and `pail x_pail` (Mortar Pail origin on the left hip).

## 5. Palette (template 5)

Hexes are authored albedo in the bible vocabulary (`materials.bible_palette` roles). None of the reserved relationship hues (Dawn azure `#3F9CFF`, Dusk marigold `#FF9A1F`, Noonwhite `#F4EFE2`) dominates: every large-area colour is below 40% saturation inside the azure (200-225°) and marigold (25-50°) hue bands, and no large area is lighter than L* 86. The `accent` role is authored azure; the renderer tints it per viewer.

| Role | Hex | L* | Hue / sat | Where it is used |
|---|---|---|---|---|
| `stone` | `#D0C6B3` | 80 | 39° / 14% | dome-cap shell, flat crown, shoulder plates |
| `ironstone` | `#4A4038` | 28 | 27° / 24% | cap banding paint, maul head, toe caps, shin greaves |
| `wood` | `#B99B78` | 66 | 32° / 35% | lacquered pale-walnut mask, mortar pail |
| `wood_dark` | `#58443A` | 31 | 20° / 34% | maul haft, trowel handle, belt slab |
| `cloth` | `#87776A` | 51 | 27° / 21% | felt apron, felt shoulder rolls, back panel |
| `cloth2` | `#D0C5B1` | 80 | 39° / 15% | linen shirt, collar, mouth-wrap |
| `under` | `#3A3430` | 22 | 24° / 17% | trousers |
| `leather` | `#4B3B30` | 26 | 24° / 36% | belt, forearm wraps, boots, straps |
| `lampresin` | `#BF8F52` | 63 | 34° / 57% | window frames, haft binding bands (under 4% of the silhouette) |
| `ink` | `#17181B` | 8 | 225° / 15% | mask eye recesses, deepest cap groove |
| `accent` | `#3F9CFF` | 63 | 211° / 75% | the three window glazings in the cap rim |

Lampresin is the one warm saturated role (hue 34 degrees, 57% saturation). It stays under 4% of the silhouette (windows frames and two binding bands), so no reserved-hue area passes the 8% limit.

## 6. Value gradient (template 6)

Light head, dark feet: the bible bands measured on screen by `lineup_qa` (top quarter L* 70-85, middle 45-65, feet 20-35; at least 40% of the silhouette at rest value). The means below are area-weighted estimates of the authored albedo before the `VALUE_GRADIENT_STOPS` ramp (x0.62 at the feet to x1.06 at the crown) and the baked top light, so the on-screen top band sits a little higher.

| Band | Target L* | Mix (share of the band) | Mean L* |
|---|---|---|---|
| top quarter (crown to chest) | 70-85 | stone 58%, cloth2 15%, cloth 9%, wood 7%, ironstone 4%, lampresin 4%, leather 3% | **72** |
| middle half | 45-65 | cloth 40%, cloth2 22%, under 14%, leather 13%, ironstone 6%, wood_dark 5% | **48** |
| feet quarter (shins down) | 20-35 | under 46%, leather 30%, ironstone 18%, cloth 6% | **26** |

The cap's crown and rim are the lightest large form (L* 80); the felt under it is mid; the apron hem darkens toward the boots. If the measured top band comes in under 70, lighten `stone` before touching the mask: the cap is more than half of the top quarter. The mask sits in the cap's shadow and is allowed to read mid-light (L* 66).

## 7. Accent (template 7)

Three window glazings in the cap rim, about 336 cm2 in total against roughly 16,500 cm2 of silhouette: **about 2%** (budget 5%), 100% in the top half (rim height 1.9-2.1 m). At rest the emissive is 0.8, below bloom; it blooms to 1.5 or more only during the wind-ups of Shelter Dome and Domefall (a glow is a warning). Seen from the 52 degree camera the front window and one side window are visible, so the colour reads from both sides of a fight.

## 8. Motion (template 8)

`MOTION = anim.motion_profile(weight="heavy", weapon="two_hand", stance="wide", run_ref_speed=3.35, blocks=BLOCKS)`

`BLOCKS` (arm blocks over `anim.ONE_HAND`, wrist relative to the shoulder in arm lengths, chest frame):
- **guard / idle:** the maul across the body, head forward-right at hip height, hands 0.35 m apart on the haft; weight settles slowly, the cap never tilts more than 3 degrees.
- **run_fwd / run_back:** the maul low in the right hand, head down and behind; the left arm swings short. The chest counter-rotates 4 degrees so the cap stays level (a swaying disc would blur the silhouette).
- **lobby:** the maul head on the ground, both hands stacked on the haft.

Four distinct ability gestures. Frame counts are multiples of 5 at 30 fps; the impact is at exactly 40% of the clip (frame = 0.4 × N). The sim's `castTime` is the windup before the effect lands; the clip's impact frame is the visual hit. A `castTime` of 0 means the effect starts at once, so the anticipation stays at 4 frames or fewer and the gesture must not hide a dash.

| Clip | Frames (impact) | Sim ability | Gesture |
|---|---|---|---|
| `cast_a1` | 25 (f10) | **Shoulder In** · castTime 0.15 s · charge 4.5 m, knockback 2 m | Drops the left shoulder under the cap rim with the maul tucked back along the right hip. Anticipation is only 4 frames (castTime 0.15 s), then a forward lean of 25 degrees; at f10 the shoulder and rim hit the line, head ducked under the rim. Follow-through to f18 with a dragging boot, recover by f25. Silhouette: the disc tips forward like a battering ram. |
| `cast_a2` | 40 (f16) | **Shelter Dome** · castTime 0.25 s · 3 m no-entry dome, 2.5-3.5 s | Lifts the maul overhead, horizontal, in both hands (f0-f10, the cap tilts back 8 degrees). The haft end drives into the ground in front at f16 with both hands stacked on the pommel, stance widening to its widest. Holds the plant until f30 (a "no entry" guard that matches the dome), then relaxes. Silhouette: a symmetric T over a planted post. |
| `cast_a3` | 30 (f12) | **Mortar Pail** · castTime 0.25 s · mortar lob up to 8 m | The left hand dips into the belt pail and flings a handful of wet mortar forward, underhand, with a deep two-step swing; release at f12 as the hand opens. The pail stays on the belt; the splash is VFX. The maul stays in the right hand, head down, as a counterweight. Silhouette: one long diagonal arm. |
| `cast_ult` | 45 (f18) | **Domefall** · castTime 0.3 s · leap up to 7 m, 3.5 m landing | A deep crouch f0-f8 (the cap dips between the shoulders), the leap f8-f16 with the maul overhead (no root motion: the sim moves him; the clip lifts the hips by up to 0.5 m at f13 and keeps the cap level), and the landing slam at f18 with both feet and the maul. Kneeling hold f18-f30 while the dome-shell VFX splits, then rise to guard by f45. |

Other clips: `run` at 3.35 m/s (heavy contact 0.38, foot slide under 8%); `attack1` a short overhead chop, `attack2` a sideways swing with the shoulder (both heavy, 40 frames, impact f16); `death` a slow fold to the knees, then forward onto the maul (ends at rest on the ground); `recall` lifts the cap off with both hands and sets it back on; `stunned` knees buckle with the cap slipping; `dash` and `taunt` follow the standard generators.

**`idle_lobby`** (loops, closed first = last pose): A patient craftsman. Every few seconds he taps the maul head into his palm twice, runs a thumb along the cap's rim as if checking a mortar line, then lifts the pail at his hip and peers into it. His weight shifts slowly; the cap stays level. 120 frames.

**`victory`** (ends in a hold): He sets the maul head on the ground and stacks both hands on the haft, nods once, and knocks twice on the cap with a knuckle: the dome holds. Final hold: hands stacked, chin slightly raised, one boot forward, the cap catching the light. 60 frames, then the hold.

## 9. Skins (template 9)

Palette swaps plus optional extra geometry read from `ctx.skin["extra"]`. Every skin keeps the rig, clips, silhouette class (height ±5%, footprint ±10%), accent locations and value gradient; none adds metal, a single saturated full-body colour, or a reserved hue above 40% saturation. Names, tiers and descriptions come from `content/skins/marund.json`. The named hex is the identity colour of the skin: where it falls outside a band's L* range, the surface steps lighter or darker by band and the identity hex is used at its own band.

### `marund_base`: Marund (base)

Points at the base files (`assets/fighters/marund/marund.glb`). The palette is section 5.

### `marund_gorgewalk`: Gorgewalk Mason (standard)

*"A slate cowl bound with iron bands and rigid gorge-rope, as worn by the keepers of the Needlespan gorge. A coil of rope sits on his left shoulder."*

A slate cowl with matte painted iron bands (non-metal) and rigid gorge-rope wrapped over the shoulders, iron pins at the rope ends. The cowl's crown steps lighter (`stone`) so the top quarter keeps its value; the named slate `#6E747C` is the felt and the lower cowl band. **Extra geometry:** a rope coil plate on the left shoulder (0.16 m across, 5 cm thick), a rigid plate on the cap's shoulder roll, no sway bones.

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `stone` | `#BAC0C6` | 77 | 210° / 6% | cowl crown and rim |
| `ironstone` | `#3F4349` | 28 | 216° / 14% | matte iron bands and pins |
| `wood` | `#B09478` | 63 | 30° / 32% | mask lacquer, pale |
| `cloth` | `#6E747C` | 49 | 214° / 11% | slate felt apron and rolls (the named #6E747C) |
| `cloth2` | `#CDC6B6` | 80 | 42° / 11% | linen |
| `under` | `#33363A` | 22 | 214° / 12% | trousers |
| `leather` | `#463A31` | 25 | 26° / 30% | belt, forearm wraps, boots, straps |
| `rope` | `#9A8F7A` | 60 | 39° / 21% | gorge-rope wraps and the coil plate |

Value bands (area-weighted): top **70** (70-85) · mid **47** (45-65) · feet **26** (20-35).

`SKINS` entry: `{"id": "marund_gorgewalk", "palette": {...as above...}, "extra": {"rope_coil": True}, "card": {"primary": "#4A4F55", "secondary": "#9A8F7A"}}`

### `marund_long_evening`: Long Evening Cowl (deluxe)

*"Plum lacquer and smoked-amber windows from the Serenade dusk festival, with a small lamp finial set on the cowl's flat top."*

Plum lacquer on the cowl and apron with smoked-amber windows (35% saturation) in the rim. The identity plum `#5B3A5E` is the deep lacquer (cap bands, toe caps, maul head); the surfaces step lighter by band. **Extra geometry:** a small lamp finial on the cap's flat crown, at most 0.10 m tall (the +5% height limit is 0.117 m), made of carved wood and a lampresin vessel; the finial is skin-only and must not become the brightest value. The windows stay the only accent (the accent glazing is unchanged).

| Role | Hex | L* | Hue / sat | Change |
|---|---|---|---|---|
| `stone` | `#D0BCCB` | 78 | 315° / 10% | cowl crown, lilac-plum lacquer |
| `ironstone` | `#5B3A5E` | 30 | 295° / 38% | the identity plum #5B3A5E (cap bands, toe caps, maul head) |
| `wood` | `#B99B78` | 66 | 32° / 35% | lacquered pale-walnut mask, mortar pail |
| `cloth` | `#8E6E98` | 51 | 286° / 28% | plum apron |
| `cloth2` | `#D6CAD3` | 83 | 315° / 6% | linen, a pale lilac-grey |
| `under` | `#2F2630` | 17 | 294° / 21% | trousers |
| `leather` | `#3E2E36` | 21 | 330° / 26% | boots, belt, wraps |
| `lampresin` | `#9C8566` | 57 | 34° / 35% | smoked-amber window frames and the finial vessel |

Value bands (area-weighted): top **72** (70-85) · mid **47** (45-65) · feet **22** (20-35).

`SKINS` entry: `{"id": "marund_long_evening", "palette": {...as above...}, "extra": {"lamp_finial": True}, "card": {"primary": "#4A3550", "secondary": "#9C8566"}}`

## 10-11. Export and renders

- Splash: `SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92}`. The final hold (hands stacked on the maul, the cap catching the low sun) fits columns 7-12; the sun is behind-left of the camera so the rim and crown take the top light.
- Portrait (512 square, head and shoulders, `idle_lobby` t 0, yaw 28): the cap rim must clear the frame top by 8%; frame the mask below it with the mouth-wrap. Icon (128 square): the mask under the rim, the three windows lit.
- GLB budget 10-25k tris and at most 1.2 MB, base and both skins.

## Per-fighter checks (on top of the template checklist)

- [ ] Shoulders : hips >= 1.4 on the silhouette (target 1.6) and the crown is flat in black at 64 px.
- [ ] Silhouette IoU against Hesmi <= 0.80 (test first), then Burdam and every roster fighter.
- [ ] The cap stays level (tilt <= 3 degrees) in `run`, `idle` and the four casts; the cap never clips the shoulder rolls in `death`.
- [ ] The three windows are the only emissive pixels at rest and stay below bloom (emissive <= 0.8).
- [ ] The maul head reads as a separate block at the right knee in `idle` and `run`.
