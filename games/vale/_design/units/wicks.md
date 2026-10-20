# Wicks · lane minions: art brief

`shieldwick` (melee, 1.1 m) · `glimwick` (caster, 1.0 m) · `greatwick` (siege, 1.5 m) · `brightwick` (super, 1.7 m), each in two cultures: **Aubade** (west, team 0) and **Serenade** (east, team 1). That makes eight GLBs: `art/out/units/<kind>_<faction>.glb`.

> Sources of truth: `content/units.json` (heights, collision radii, attack timing, move speed), `_design/STYLE_BIBLE.md` (look law), `_design/WORLD.md` §2 (the two sides), `_spec/CONTRACT.md` §12 (budgets, `art.teamModels`), `HANDOFF.md` "Art 2.0 method", reference build `art/blender/fighters/marund.py`.
>
> Code: `art/blender/units/wick_common.py` (shared spec base, palettes, helpers, runner; do not fork it) and one module per kind, `art/blender/units/wick_<kind>.py`. Concepts: `_design/concept/wicks/<kind>_<faction>.webp`, contact sheet `art/renders/units/wick_concepts.jpg`.

Wicks are the small lamp-bearers that walk the roads. Each one is a deep hood with **no face**: inside the hood is only lamplight. A heavy cloak hides the body, small boots show under it, and the one lamp the wick carries names its job. They are the most numerous models on screen (up to about 40 at once), so they read by mass and light rather than detail.

---

## 0. Hard rules (every wick, every concept, every model)

1. **No tall, pointed or conical hood, ever.** Above all, never a pale or white pointed hood over a dark face opening: that silhouette evokes a real-world hate-group hood. Hoods are **rounded**, cowled, swept back or domed. The Aubade spire motif goes on **props, shoulders, shield ribs, lamp caps and a short finial knob or low crown ring on a round hood**. A finial or crown ring rises no more than **15% of the figure height** above the hood crown (the targets below use 5-8%). A swept-back hood tip must droop **back and down** behind the head, never up. Check this in the 64 px silhouette and in the three.js QA at the game camera. A spire on a back-lantern must never line up behind the hood so that the two read as one point from the front (§3.3).
2. **No face.** No eyes, no glowing eye slits, no mouth, no skin, no hair. The hollow is dark, with a soft lamp glow deep inside (the `accent`). Two bright points in a hood read as eyes, and in a small brown hooded figure as a well-known film character, so keep the glow a single soft volume: an ellipsoid set back in the hollow, wider than it is tall.
3. **Same kind = same job silhouette.** A player must tell melee, caster, siege and super apart at a glance, whatever the culture. Both factions of a kind share the prop layout (sides, heights, reach), the mass class and the height (CONTRACT §12: one `height`, `clips` and collision radius per unit). Cultures differ in hood shape, materials, trims and lamp design only.
4. **Original.** Nothing borrowed from another game's minions or creeps (no armoured melee soldiers, no robed casters with floating orbs, no siege carts, no big buff-minion brutes). Wicks are lamp-bearers: the lamp is the weapon, the hood is the face.
5. Bible bans: no gears, clock hands, gold filigree, gems, glowing runes, metallic bevels, teal-and-gold or red-versus-green. Every material has metalness 0. "Iron" is matte, painted, oxidised-looking stone. Only `accent` emits: dawnglass and lampresin are glossy but never emissive.

---

## 1. The family (shared by all eight)

| | Value |
|---|---|
| Anatomy | Stylized chunky minion: the hood is about 1/3 of the height (shieldwick, glimwick) or 1/4 (greatwick, brightwick). The body is a bell-shaped cloak to the shins, with small dark boots and mitten hands (the thumb is a separate lobe). No visible legs above the boots. |
| Rig | `VALE_BIPED_1` at minion proportions (`Wick.legacy_proportions()` is the start: rig height = 0.86 × H, a big head inside the hood, short legs and arms). Re-fit the joints to the concept before sculpting, as on Marund. |
| Clips | `idle`, `run`, `attack1`, `death` (the content `art.clips`). The standard generators fill the rest of the required set, and the renderer plays only these four. Author `run` at the content `moveSpeed` (MOTION `run_ref_speed`). The renderer sets run time-scale = speed / moveSpeed, and lands `attack1`'s 40% impact on the sim windup. |
| Height | The content `art.height` is the top of the main mass, within ±5%: the hood crown with its knob on shieldwick (1.1 m) and glimwick (1.0 m), the back-lantern roof on greatwick (1.5 m) and the crown ring on brightwick (1.7 m). Thin tips may rise above it: the glimwick pole, the lantern spires or lid. Both factions of a kind share the number. The health bar sits at height + 0.35 m. |
| Facing | +Z in three.js (the pipeline gate). The hood opening faces forward. |
| Budget | 1.5-4k tris (CONTRACT §12). Targets: shieldwick and glimwick ≤ 3.0k, greatwick ≤ 3.6k, brightwick ≤ 4.0k. Base colour 1024², normal and ORM 256 (wick_common sets `TEXTURE_SIZE = 1024`, `TEXTURE_SIZES = {"normal": 256, "orm": 256}`; raise normal to 512 only if the cloak folds go mushy). GLB ≤ 500 KB each (the legacy 512² builds are 330-360 KB; eight models load per match). |
| Sway | At most 1 sway bone (`x_lamp` on the glimwick's hanging lamp). The cloak is rigid drapery with sculpted folds. |
| Feature size | Every part at least 4.5 cm thick (a 4.5 cm pole is 3.7 px at 1080p). Smaller details are paint. |

**On screen:** vertical 50.5 px/m and horizontal 82.1 px/m at 1080p (STYLE_BIBLE camera). That makes shieldwick 56 px, glimwick 51 px, greatwick 76 px and brightwick 86 px tall (two thirds of that at 720p). Design each silhouette to read at **64 px**: run the IoU check at 64 px (tokens `fighter.silhouette`). Within a faction, any two kinds must have IoU ≤ 0.80. Across factions, the same kind must have IoU ≥ 0.70.

**Read order inside a wave:** job (prop mass) → side (accent colour) → culture (hood and stone). Accent colour carries side. Hood shape and material carry culture, which is the same for every viewer: *stone tells you whose land; light tells you whose side.*

---

## 2. The two cultures

### 2.1 Aubade (west, team 0): dawn people

- **Shapes:** upward lines. Long straight vertical cloak folds, a hem cut into shallow points, a narrow chalk stole hanging straight down the front, stepped plates. Spire points live on props and shoulders only.
- **Hood:** a soft **rounded cowl**, as round on top as a helmet, swept back at the nape. The opening is a rounded arch framed by a **carved chalk rim** 3-4 cm wide with a shallow scroll relief (paint). On top sits a **small round chalk knob with a short point**, 5-7 cm tall (shieldwick, glimwick, greatwick); brightwick has a low crown ring instead (§3.4). A thin **accent seam** runs from the brow over the crown and down the back of the hood. This is the Aubade hood mark.
- **Lamps:** narrow, tall, four- or six-sided **dawnglass** lanterns in chalk frames with pointed chalk caps. Each has an accent core.
- **Materials:** `chalk`, `cloth2` (pale blue-grey linen), `cloth` (cool blue-grey wool), `stone` (blue-grey dialstone, the "blued steel" read, never metallic), `wood` (pale ash), `dawnglass`, `under`/`leather`/`ironstone` (dark slate).

### 2.2 Serenade (east, team 1): dusk people

- **Shapes:** rounded and heavy. A wide bell cloak with two dark horizontal bands near the hem, a short felt mantle over the shoulders, domes and drums, banded forms.
- **Hood:** a **low, broad felt dome**, wider than it is tall, on a **thick rolled collar** of dark felt. The opening is a rounded arch with a dark felt rim. An **accent crown band** circles the dome just above the opening. This is the Serenade hood mark.
- **Lamps:** squat, round **lampresin** lanterns in matte ironstone cages with domed lids. Each has an accent core.
- **Materials:** `cloth2` (sand felt), `cloth` (warm umber felt), `sandstone` (ochre), `ironstone`, `wood`/`wood_dark` (walnut), `lampresin`, `leather` (dark umber waxed).

### 2.3 Palettes (authored albedo; `wick_common.FACTION_PALETTES`)

No large area may exceed 40% saturation inside the reserved hue bands: azure 200-225° and marigold 25-50°. The `accent` is authored Dawn azure `#3F9CFF` on every wick, and the renderer tints it per viewer (ally azure, enemy marigold).

**Aubade**

| Role | Hex | L* | Hue / sat | Where |
|---|---|---|---|---|
| `chalk` | `#D6D3CA` | 85 | 45° / 6% | hood rim, knob, stole, shield face, pauldrons, lamp frames, hammer head |
| `cloth2` | `#BFC6CC` | 80 | 208° / 6% | hood linen, tabard |
| `cloth` | `#6E7A86` | 51 | 210° / 18% | cloak, sleeves |
| `stone` | `#98A2AC` | 66 | 210° / 12% | bands, bindings, caps |
| `wood` | `#B9AB93` | 71 | 38° / 21% | hafts, pole, back frame |
| `wood_dark` | `#6A6358` | 42 | 37° / 17% | grips, wraps |
| `dawnglass` | `#A9C4DC` | 78 | 208° / 23% | lamp panes (glossy, not emissive) |
| `under` | `#3A3F47` | 26 | 217° / 18% | trousers, the lining seen at the hem |
| `leather` | `#36373B` | 23 | 228° / 8% | boots, mitts, straps |
| `ironstone` | `#3E434A` | 28 | 215° / 16% | soles, hem band, toe caps |
| `ink` | `#15171B` | 8 | - | the hood hollow |

**Serenade**

| Role | Hex | L* | Hue / sat | Where |
|---|---|---|---|---|
| `cloth2` | `#C9AF8A` | 73 | 35° / 31% | dome hood felt, mantle, tabard |
| `sandstone` | `#C3A47A` | 69 | 35° / 37% | shield ring pads, pauldron bands, hammer bands |
| `stone` | `#A39580` | 62 | 36° / 21% | caps, knobs |
| `cloth` | `#765E4E` | 42 | 24° / 34% | cloak, sleeves (dusty umber, never orange) |
| `wood` | `#9A7A58` | 53 | 31° / 43% | lamp frames (small areas only) |
| `wood_dark` | `#5A4436` | 31 | 23° / 40% | hafts, pole, back frame |
| `lampresin` | `#BF8F52` | 63 | 34° / 57% | lamp panes (glossy, not emissive; ≤ 4% of the silhouette) |
| `ironstone` | `#4B4039` | 28 | 23° / 24% | rolled collar, cages, shield dome, hem bands, hammer head |
| `under` | `#3B302A` | 21 | 21° / 29% | trousers |
| `leather` | `#45362C` | 24 | 24° / 36% | boots, mitts, straps |
| `ink` | `#17150F` | 7 | - | the hood hollow |

### 2.4 Value gradient (light top, dark feet)

Bible bands as measured on screen: top quarter L* 70-85, middle half 45-65, feet quarter 20-35.

- **Aubade:** the pale hood and chalk rim make the top. The cloak is mid, and the bottom quarter darkens through a **6-8 cm `ironstone` hem band** plus the boots. The concepts measure 47-52 in the bottom quarter, which is too light, so the hem band and the `VALUE_GRADIENT_STOPS` ramp must bring it to 30-38. Wicks may sit a little above the fighter feet band, because the cloak covers the shins.
- **Serenade:** the sand dome hood and mantle make the top. The concepts paint them darker and more saturated (measured top quarter 35-63), so lift them to the palette (§5.2). The cloak is mid-dark. The two ironstone hem bands and the boots make the feet.

---

## 3. The kinds

Shared prop sides: **the lamp or weapon is in the right hand** (screen-left in the front view) and **the shield is on the left arm**. The two-hand props (greatwick hammer, brightwick staff) have their head on the wick's left (the hammer head) or upper left (the staff lamp). Heights below are measured from the ground.

### 3.1 shieldwick · melee · 1.1 m · collision 0.45 m · windup 0.35 s · moveSpeed 3.25

**64 px read:** a squat bell with a **big round disc on its left side** and a short lantern-mace raised on its right. The disc is the job.

| | Shared | Aubade (`shieldwick_aubade`) | Serenade (`shieldwick_serenade`) |
|---|---|---|---|
| Hood | crown 1.04 m, 0.42 m wide | rounded cowl, chalk rim, knob to 1.10 m, seam over the crown | low dome 0.46 m wide, crown 1.08 m, rolled collar 0.50 m wide at 0.70 m, crown band |
| Cloak | 0.30 m at the shoulders → 0.56 m at the hem (0.16 m) | straight vertical folds, pointed hem, chalk stole down the front, wrapped forearms | wide bell, two ironstone hem bands, sand mantle to the elbows |
| Shield | Ø 0.44 m, 5 cm thick, on the left forearm, face turned 35° out and forward, top edge at 0.78 m | flat chalk disc, a raised vertical rib rising to a 6 cm spire point above the rim, dawnglass boss Ø 0.12 m (accent core) | low ironstone dome with four ochre sandstone pads and an ironstone rim, lampresin boss Ø 0.12 m (accent core) |
| Lamp-mace | 0.38 m haft in the right hand, head up at 0.85 m | narrow four-sided dawnglass lantern head 0.16 m tall in a chalk frame with a pointed cap | squat round lampresin lantern 0.13 m in an ironstone cage, domed lid, walnut haft |
| Boots | 0.10 m tall, 0.17 m long | dark slate | dark umber |

**Accent:** hood light, hood seam (A) or crown band (S), shield boss core, mace-lantern core. Four areas, target 4.5-6% at the game camera.

**Motion** (`weight="light", weapon="one_hand", stance="guard", run_ref_speed=3.25`):
- `idle`: shield up at chest height, small breathing bob, the mace lantern swinging a few degrees, the hood turning left then right once per loop (scanning the lane).
- `run`: a short, quick, waddling stride. The shield stays tucked to the chest, the mace arm pumps, and the hood stays level.
- `attack1` (impact at 40%, mapped to the 0.35 s windup): shield shove forward (anticipation, 4 frames), then an overhead mace chop that lands at the impact frame, and a recoil back behind the shield.
- `death`: knees buckle, the wick sits back, tips forward onto the shield and lies over it; the lantern rests on the ground. Ends at rest.

### 3.2 glimwick · caster · 1.0 m · collision 0.40 m · windup 0.30 s · moveSpeed 3.25 · ranged bolt 5 m

**64 px read:** a slim bell plus **one tall vertical line with a lamp hanging off its top**. The lamp is the disc, the pole is the line (the bible's caster mass).

| | Shared | Aubade | Serenade |
|---|---|---|---|
| Hood | crown 0.95 m, 0.38 m wide | rounded cowl, chalk rim, knob to 1.00 m, seam | low dome 0.42 m wide, rolled collar, crown band |
| Cloak | slimmer: 0.26 m → 0.48 m at the hem | straight folds, pointed hem, chalk stole, wrapped forearms | bell, two hem bands, sand mantle |
| Pole | 4.5 cm thick, in the right hand, foot by the right boot, tip at 1.32 m. A crook arm at 1.20 m reaches 0.20 m forward and out, and the lamp hangs on a 6 cm cord or chain with its centre at 1.08 m, in front of and above the hood | pale ash, slender chalk spire finial 10 cm at the tip, angled chalk crook | walnut, round ironstone knob at the tip, level crook with a ring |
| Lamp | 0.14 m tall | narrow six-sided dawnglass lantern, pointed chalk cap and drop | squat round lampresin lantern, ironstone cage, domed lid |
| Left hand | empty, palm open and forward: the casting hand | | |

**Accent:** hood light, hood seam or band, lamp core (the biggest share; the lamp is the caster's read).

**Motion** (`weight="light", weapon="one_hand", stance="neutral", run_ref_speed=3.25`; the pole is held upright by `prop.R`, not as a two-hand staff; `x_lamp` swings):
- `idle`: the pole planted, the lamp swaying on `x_lamp` (about 6° with a 2 s period), the left palm turning up once per loop.
- `run`: the pole carried upright and tilted 10° forward, the lamp trailing, the left arm swinging short.
- `attack1` (0.30 s windup): the pole lifts 10 cm and tips forward 20° so the lamp swings out toward the target, and the open left palm pushes forward on the impact frame (the bolt leaves the lamp). Then it settles.
- `death`: the pole topples to the right first, then the wick sinks straight down into its cloak (the hood ends on the cloak pile) and the lamp rolls a little. Ends at rest.

### 3.3 greatwick · siege · 1.5 m · collision 0.65 m · windup 0.40 s · moveSpeed 3.2 · lob 6.5 m at structures

**64 px read:** a stocky bell carrying **a big lantern block on its back that rises above the hood**, with a heavy hammer across the body. The back-lantern is the job: "the one with the house on its back".

| | Shared | Aubade | Serenade |
|---|---|---|---|
| Hood | crown 1.18 m, 0.46 m wide (1/4 of the figure) | rounded cowl, chalk rim, knob, seam | low dome, rolled collar, crown band |
| Body | broad: shoulders 0.52 m, hem 0.70 m | straight folds, pointed hem, chalk stole with a dawnglass clasp | bell, two hem bands, sand mantle, belt |
| Back-lantern | 0.62 m wide (wider than the shoulders), body from 0.92 to 1.48 m, on a frame of two posts and a shoulder yoke, set 0.10 m behind the hood | **box**: tall dawnglass panes in a chalk frame, a low four-sided chalk roof to 1.52 m, **four short corner spires** to 1.62 m (no centre spire behind the hood), pale ash frame | **drum**: a ring of lampresin windows between two ironstone bands, a low felt-and-ironstone domed lid to 1.56 m, walnut frame with leather straps |
| Hammer | haft 0.85 m held across the body in both hands (head on the wick's left), head 0.30 × 0.18 × 0.18 m | chalk head with wedge faces and blue-grey `stone` bindings, pale ash haft | ironstone drum head with two sandstone bands and a small lampresin window ring, walnut haft |

**Accent:** hood light, hood seam or band, **back-lantern core** (the largest single accent of any wick: it shows from the front over the hood, from the sides and from above), plus the hammer window ring on Serenade only if the total stays ≤ 6%.

**Motion** (`weight="heavy", weapon="two_hand", stance="wide", run_ref_speed=3.2`):
- `idle`: the hammer held across the hips, a slow breathing heave, the lantern rocking 2° on the yoke.
- `run`: a heavy, rolling waddle. The lantern stays near level (the chest counter-rotates) and the hammer is carried diagonally.
- `attack1` (0.40 s windup): a full overhead two-hand swing from low behind the right hip, up over the shoulder, forward. At the impact frame the hammer head stops at its highest forward point (that is where the lob leaves), and the follow-through drops the head to the ground in front.
- `death`: the hammer drops, the wick sits back heavily against its lantern frame and topples backward, lantern first. Ends at rest.

### 3.4 brightwick · super · 1.7 m · collision 0.70 m · windup 0.40 s · moveSpeed 3.3 · melee 1.8 m

**64 px read:** tall and broad. **Pauldrons make the widest point**, a **crown of small lamps** sits on the hood, and a long staff runs diagonally across the body with a lantern at the upper end. It reads as "the crowned one".

| | Shared | Aubade | Serenade |
|---|---|---|---|
| Hood | crown 1.58 m, 0.44 m wide | rounded cowl, chalk rim, seam down the back (no knob: the crown replaces it) | low dome, rolled collar |
| Crown-lamp ring | sits on the hood crown, top at 1.70 m (12 cm, 7%) | low chalk circlet with **six short chalk points (8-10 cm)**, each holding a small dawnglass lamp (accent cores) | a flush ironstone band 9 cm tall with **seven round lampresin windows** (accent cores), the felt dome showing above |
| Shoulders | pauldrons 0.70 m across | stepped chalk plates, each rising into two short upward points (≤ 10 cm) | rounded ironstone domes with ochre sandstone bands and a round boss |
| Body | shoulders 0.56 m, hem 0.78 m, cloak to the ankles | chalk-white tabard with an **accent vertical stripe**, straight-fold cloak, pointed hem | sand tabard with an **accent sash** at the waist and an accent chevron at the tabard hem, umber cloak with two hem bands |
| Staff | 1.65 m, held diagonally in both hands, foot low on the wick's right, lantern head up on the left at 1.55-1.65 m | pale ash, tall pointed dawnglass lantern in a chalk frame with a slender spire cap | walnut, round caged lampresin lantern with an ironstone cap and knob |

**Accent:** hood light, crown-ring lamps, tabard stripe or sash, staff-lantern core. Target 5-7%; the super wick may glow the most.

**Motion** (`weight="heavy", weapon="two_hand", stance="wide", run_ref_speed=3.3`):
- `idle`: the staff diagonal, a slow heave, the crown level, a half-step settle once per loop.
- `run`: a long, heavy stride. The staff is held diagonally and steady, the crown level.
- `attack1` (0.40 s windup): the staff lifts overhead in both hands and slams the lantern head down in front at the impact frame (melee 1.8 m), then recovers to diagonal.
- `death`: drops to one knee with the staff planted, holds briefly, then slides sideways off the staff to the ground; the crown stays on the hood. Ends at rest.

---

## 4. Accent (the team read)

The `accent` material is the **only** thing that tells ally from enemy, and wicks are small and crowded, so it is generous by design:

- At least three accent areas per wick: the **hood light** (the soft core in the hollow, set back 3-4 cm, with no eye-like points), the **hood mark** (Aubade seam, Serenade crown band) and the **lamp core** of the carried lamp. Shields, crowns, tabards and the back-lantern add more, as listed per kind.
- Three.js QA `accentPct` at the game camera: shieldwick and glimwick 4.5-6%, greatwick 5-6%, brightwick 5-7%. At least 60% of it in the top half (`accentTopHalfPct`). The pipeline warns above 6%; for brightwick that warning is expected and accepted.
- Model every lamp core and band as its own `accent` part (an ellipsoid inside the panes, a torus band, a strip). Painted glows in the concepts are **not** team colour: a painted amber halo on a Serenade hood would read as "enemy" to a Serenade player. Erase painted glows and spill from the projection plates (§5.2), and let the accent geometry carry all the light.
- At rest the emissive is 0.8, below bloom (the renderer sets it). Wicks have no ability wind-ups, so their accent never blooms.

---

## 5. Concepts and projection

### 5.1 The eight concepts (2026-10-20)

| Id | Picked raw | Notes |
|---|---|---|
| `shieldwick_aubade` | `__2` (round 2) | rounded cowl with a knob, regenerated with the round-hood prompt so the Aubade hood matches the other three kinds. The front view shows a small hood flap on the wick's left: model it swept back and down, or drop it. `__3` is the round-1 image the lead accepted (a spike finial), kept as an alternative. |
| `shieldwick_serenade` | `__2` | |
| `glimwick_aubade` | `__1` (round 2) | `__2` was rejected (two glowing eyes) |
| `glimwick_serenade` | `__2` | lit hollow without a centre orb (`__1` had an eye-like orb) |
| `greatwick_aubade` | `__1` (round 2) | `__2` was rejected (pointed hood tip) |
| `greatwick_serenade` | `__3` | `__2` with its painted glowing eyes retouched out (both round-1 variants had eyes). Its hood has a small forward flop: model it as a rounded dome with a soft brow, like the other Serenade hoods. |
| `brightwick_aubade` | `__1` (round 2) | `__2` held the staff upright, breaking the shared diagonal |
| `brightwick_serenade` | `__1` | |

The round-1 Aubade glimwick, greatwick and brightwick concepts had tall conical hoods. They were rejected under rule 0.1 and never used. Their prompts were rewritten (round hood, knob or low crown ring, "never pointed, never conical, never tall") in `tools/imagegen/manifest.json`.

### 5.2 Projection notes for the builders

1. **Plates:** `python3 art/tools/concept_plates.py wicks/<kind>_<faction> --height <H>` (repo venv). It writes `art/.cache/concept/wicks/<id>_{front,back,mask}.png` and `_plates.json`. All eight were cut once with defaults on 2026-10-20 (the `wicks/` cache folder exists; recreate it if the cache is wiped). Check `<id>_mask.png` before projecting. Known problems in the default cut:
   - `greatwick_aubade`: the front frame (top 203, sole 1285) disagrees with the back (top 222, sole 1348). The front sole row is too high: the slate boots fail the dark-boot test and the feet are cut out of the mask. Fix the threshold or set `front.ground` by hand. Left as is, the front painting lands about 5% too large on the model.
   - `greatwick_serenade`: front sole 1368 against back 1346. Check which one is right.
   - The thin lantern spires (Aubade greatwick) and pole tips are partly eroded. Build them as geometry and let `flat` or the nearest paint cover them.
2. **Projection height:** the plate `top` is the first row of the cut wider than 12 px, so it is often **not the hood crown**. It is the crook and lamp on glimwick, the lantern roof on greatwick, and the crown ring or staff lantern on brightwick. Pass that row's real height on your model as `--height` and as `PROJECTION["height"]`, not the content height. A wrong height scales the painting off the model.
3. **Serenade colour:** the Serenade concepts are painted warmer, darker and far more saturated than the palette: cloak at hue 22-25° and 60-78% saturation, against 34% in the palette, and a top quarter at L* 35-63 against the 70-85 target. Projected as-is, they break the reserved-marigold rule and the top value band. Grade the plates before projecting with `wick_common.graded_projection(...)`, which pulls saturation down in the warm band, lifts the top band and refills painted glow. A start that was tried on glimwick: `sat=0.45, top_lift=1.3, glow=(0.8, 0.5)`. Then check the three.js QA against §2.3.
4. **Painted glows:** erase painted lamp halos and glow spill on the felt and linen. `graded_projection(..., glow=(min_value, min_saturation))` refills bright saturated pixels from the surrounding paint: about `(0.8, 0.5)` for Serenade amber and `(0.85, 0.2)` for Aubade pale blue. `concept_plates.py --erase-saturated-above` also works, but on Serenade its "gold" test matches the orange cloak too, so check the mask. Accent parts are emissive and not painted.
5. **Top plates:** the 52° camera sees hood crowns, the brightwick crown ring and the greatwick lantern roof from above. Give near-flat tops a top plate or a `flat` colour (HANDOFF Art 2.0 step 3).

---

## 6. Build, QA, wiring

```
export PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH
export CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 \
    --python art/blender/units/wick_<kind>.py -- --faction aubade      # or serenade; default: both
```

- Each kind module builds `<kind>_aubade` and `<kind>_serenade`; `--faction legacy` rebuilds today's `<kind>.glb` from the frozen legacy geometry. `art/blender/units/wicks.py` is the thin driver: legacy by default, `--faction both` builds all eight. `--fast` iterates, `--clip-sheet` adds the clip strip, and renders are always off (wicks ship no portrait, splash or icon).
- Outputs: `art/out/units/<id>.glb`, `art/renders/units/three_<id>.png`, `build_report_<id>.json`.
- Gates: the three.js load test passes, facing +Z, tris and GLB inside §1, `accentPct` inside §4, a 64 px silhouette pass (rule 0.1 and §1 IoU), and a side-by-side of concept and `three_<id>.png` reviewed by eye.
- Wiring (content lane, when all eight pass): `content/units.json` `art.teamModels = ["assets/units/<kind>_aubade.glb", "assets/units/<kind>_serenade.glb"]`. Keep `art.model` (FRAY and neutral fallback) and `height`. Then the content build and probes.
