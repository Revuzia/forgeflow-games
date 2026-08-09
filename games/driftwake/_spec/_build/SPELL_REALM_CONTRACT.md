# DRIFTWAKE — SPELL REALM CONTRACT (Task D1)

---

## ⚑ OWNER OVERRIDE — 2026-08-07, later than the body of this document

The owner named specific realm spells after this contract was written. **These win over
the identities proposed below.** Where a row is unchanged, this document's answer stands.

Owner's words: *"we have a cold spiral, we can do a SAND TORNADO. The wave is still fine
for sand. In sand instead of frozen spikes we can do a SAND explosion that blows up the
area, and it should show properly in collision/sand leaving a mark and damaging those
around it. Ash would be FIREBALL instead of wave (work on the FX on this), can do FIRE
CONE hands as one, etc."*

### The binding table, as overridden

| Slot | Cold | Sand | Ash |
|---|---|---|---|
| **LMB** primary | Frost Bolt (sharp shard) | Fulgurite Dart | Cinder Spike |
| **1** held stream (ex-LMB Ribbon) | Water/ice ribbon | Scourging Ribbon (grit rope) | **FIRE CONE from the hands** ⚑ |
| **2** crescent (Sweep) | Frost Wave | **Sand wave — unchanged** ⚑ | **FIREBALL** ⚑ |
| **3** eruption (Bloom) | Mini-Vortex | Blowout | Ember Burst |
| **4** stance-break disc (Crystallize) | Crystal Spikes | **SAND EXPLOSION** ⚑ *(replaces the Fulgurite Spires proposal)* | Basalt Columns |
| **5** three helices (Vortex) | Great Vortex (the cold spiral) | **SAND TORNADO** ⚑ | Firestorm |

### Notes that change implementation

1. **Sand slot 4 is now an explosion, not spires.** The mechanic is unchanged — it is
   still the expanding stance-break AoE with the same radius, damage, stun and poise —
   but it presents as a detonation rather than growth. The owner asked specifically that
   it *"show properly in collision/sand leaving a mark and damaging those around it"*:
   that mark is not decoration, it must be a real crater written through
   `ctx.deform.brush(...)`, the same persistent depression/berm/compression field that
   already remembers footprints for about a minute. Spec the crater as depth + outward
   berm, not a flat decal. The Fulgurite Spires writeup below is retired for Sand —
   keep it on file, it is the natural fallback if the explosion reads badly at speed.

2. **Ash slot 2 is a fireball, and this is the one place the MECHANIC actually diverges.**
   The Sweep is a 13.6 m ploughing crescent whose combat job is the knockback tool
   (`cc: {type:"knockback", dur:0.4, mag:4}`). A plain projectile would delete that role
   and unbalance Ash. RESOLUTION: implement it as a **thrown fireball that detonates into
   a radial blast** — travel reads as a fireball, the blast keeps the crescent's
   knockback, arc damage and poise numbers. Flag to the owner if the throw delay changes
   the feel; do not silently drop the knockback.

3. **Ash slot 1 is a fire cone from the hands.** This maps cleanly: the Ribbon is already
   a *held channel* originating at the right hand (`spellSystem._handPosition`), so a
   held cone is the same input contract and the same per-tick damage shape. Cone spread
   replaces the rope's path.

4. Everything else keeps this document's answers, including the geology arguments that
   earned them: Ash basalt columns are natively hexagonal, so `crystals.js`'s `RING = 6`
   prism is the geologically correct primitive rather than a reuse hack.

---

**Scope:** the rebind (LMB → a new primary bolt, everything else pushed one key), the
18 per-realm spell identities (6 slots × 3 realms), the uniform-only realm swap, the
new bolt's full spec, and the headless probe that proves all of it.

**Status of every number below:** either quoted from `src/` at a cited `file:line`, or
quoted from `_spec/COMBAT_DESIGN.md` §1.1, or explicitly marked `PROPOSED` /
`UNMEASURED`. Nothing here is invented and presented as measured.

**The governing rule, from owner directive 4 (2026-08-07):** *the mechanic is constant
across realms; the fiction and the FX change.* Every damage number, radius, duration,
cooldown and mana cost in `COMBAT_DESIGN §1.1` and `combatData.js` is realm-invariant.
A realm swap writes uniforms and renames strings. It never writes a gameplay number.

---

## 1. THE REBIND TABLE

### 1.1 Slot map

Internal engine ids are **stable and must never be renumbered** —
`spellSystem.js:157` builds `[sweep, ribbon, bloom, crystallize, vortex]` = ids 1..5.
The new primary bolt takes **internal id 6** (1–5 are taken; 6 is the next free integer
and keeps `progression.js:505`'s `id >= 1 && id <= 5` guard a one-character change).

| Slot (new) | Slot (today) | Fiction | Internal id | Engine object |
|---|---|---|---|---|
| **LMB** | *(new)* | primary bolt | **6** | `spells.bolt` (new `BoltField`) |
| **1** | LMB (hold) | held stream / whip + throw | **2** | `spells.ribbon` (`ribbon.js`) |
| **2** | 1 | ploughing crescent | **1** | `spells.sweep` (`sweep.js`) |
| **3** | 2 | targeted eruption | **3** | `spells.bloom` (`bloom.js`) |
| **4** | 3 | stance-break spike disc | **4** | `spells.crystallize` (`crystallize.js`) |
| **5** | 4 | three lifting helices | **5** | `spells.vortex` (`vortex.js`) |

### 1.2 Every file:line that encodes a binding today

Each row is a place the rebind must land. Nothing else in `src/` references a bind —
verified by `grep -rn "spellPressed|Digit[0-9]|spellHeld2" src/`, whose only other hits
are doc comments (`targeting.js:24`, `input.js:10-21`) and truthiness-only reads
(`crosshair.js:205` fires the cast pulse on any non-zero id and needs no per-key entry).

| # | File:line | What it encodes | Change |
|---|---|---|---|
| 1 | `src/core/input.js:218-223` | `SPELL_KEYS = {Digit1:1, Digit2:3, Digit3:4, Digit4:5}` | → `{Digit2:1, Digit3:3, Digit4:4, Digit5:5}`. **Digit1 must NOT appear here** — see §1.3. |
| 2 | `src/core/input.js:132` | `if (e.button === 0) input.spellHeld2 = true` | delete; LMB becomes the bolt press (§4.9) |
| 3 | `src/core/input.js:141` | `if (e.button === 0) input.spellHeld2 = false` | delete; replaced by a `Digit1` keydown/keyup pair |
| 4 | `src/core/input.js:78` | `spellPressed: 0` — comment says "0 = none, else 1..5" | comment → "1..6" |
| 5 | `src/core/input.js:83, 114, 207` | `spellHeld2` declaration + the two clear sites (pointerlock, blur) | keep verbatim; only the *writer* moves. Contract 1 (`input.js:10-19`) still binds: plain writable data property, never an accessor, never cached in a module local. |
| 6 | `src/core/input.js:262` | `endFrame()` clears `spellPressed` | unchanged |
| 7 | `src/ui/spellbar.js:31-48` | `SLOTS` array — `{id:2,bind:"LMB"} , {id:1,bind:"1"}, {id:3,bind:"2"}, {id:4,bind:"3"}, {id:5,bind:"4"}` | prepend `{id:6, bind:"LMB", name:"bolt", glyph:…}`; relabel the five existing binds to `1,2,3,4,5` |
| 8 | `src/ui/spellbar.js:186` | `_flashUntil = {1:0, 3:0, 4:0, 5:0}` | add `6:0`. (The ribbon, id 2, is deliberately absent — it is a hold, not a cast edge.) |
| 9 | `src/ui/spellbar.js:188-189` | `_cdFrac`/`_cdText = {1:-1, 3:-1, 4:-1, 5:-1}` | **unchanged** — the bolt has cooldown 0 (`COMBAT_DESIGN §1.1`, `combatData.js:69`) and must never render a wipe |
| 10 | `src/ui/spellbar.js:192` | `_lockState = {1..5: null}` | add `6: null` |
| 11 | `src/ui/spellbar.js:241` | `for (const idStr of ["1","3","4","5"])` — the cooldown-wipe loop | **unchanged**; must not gain `"6"` |
| 12 | `src/ui/spellbar.js:214-218` | `this.spells.ribbon.held` lights `_slot[2]` | unchanged mechanically; that slot's label is now `"1"` |
| 13 | `src/spells/spellSystem.js:75` | `STRIKE_DELAY = {1:.71, 3:.66, 4:.95, 5:.98}` | add `6: 0` (§4.3) |
| 14 | `src/spells/spellSystem.js:82` | `MANA_COST = {1:15, 3:25, 4:30, 5:45}` | add `6: 0` (`combatData.js:69`) |
| 15 | `src/spells/spellSystem.js:90` | `COOLDOWN = {1:4, 3:6, 4:10, 5:14}` | add `6: 0` |
| 16 | `src/spells/spellSystem.js:186` | `_cdUntil = {1:0, 3:0, 4:0, 5:0}` | add `6: 0` (harmless; `cooldownFrac` early-outs on `!total`, `:459`) |
| 17 | `src/spells/spellSystem.js:157` | `this.spells = [sweep, ribbon, bloom, crystallize, vortex]` | append `this.bolt` — it must be in the array or `_cancelAll()` (`:484`) and `activeCount` (`:489`) skip it |
| 18 | `src/spells/spellSystem.js:333-335` | `_dispatch()`: `holdRibbon(input.spellHeld2 …)` then `if (key && key !== 2) this.cast(key)` | keep the `!== 2` guard verbatim; it is what stops the hold double-firing |
| 19 | `src/spells/spellSystem.js:351-418` | `cast(key)` — the `key===2` early-out at `:360`, the `key===1` flat-aim branch at `:384`, the `key===3||4` eye-ray at `:392`, the `key===5` at `:415` | add a `key===6` branch: capture the eye-ray target with the bolt's own leash (`aimPoint(..., 40, 18)` — `combatData.js:61`) and schedule |
| 20 | `src/spells/spellSystem.js:425-430` | `_schedule(key,a0,a1,a2)` — single-slot `_pending` | **structural change**: the bolt fires at 0.45 s cadence; one slot cannot hold a bolt and a Vortex wind-up at once. Either give the bolt its own `_pendingBolt` slot, or (recommended) let `key===6` bypass `_schedule` entirely since `STRIKE_DELAY[6] = 0` |
| 21 | `src/spells/spellSystem.js:433-450` | `_drainPending()` — `if key===1 … 3 … 4 … 5` | add the `6` arm only if 20 chose the scheduled path |
| 22 | `src/spells/spellSystem.js:471-482` | `holdRibbon()` — gates on `unlocked.has(2)` | unchanged |
| 23 | `src/combat/combatData.js:53-119` | `SPELLS` keyed by **owner bind** (`LMB`,`1`,`2`,`3`,`4`), each row carrying `engineKey` | full re-key: `LMB` row's `engineKey` 2 → **6**; a **new `1` row** carries the stream (engineKey 2, the `whip` block moved out of the LMB row); today's `1`→`2`, `2`→`3`, `3`→`4`, `4`→`5` |
| 24 | `src/combat/combatData.js:122` | `UNLOCKS = {LMB:1, 1:1, 2:2, 3:4, 4:6}` | re-key to the new binds |
| 25 | `src/combat/combatData.js:126` | `AUGMENTS = {LMB:9, 1:12, 3:15, 2:20, 4:25}` | re-key to the new binds |
| 26 | `src/combat/combatData.js:11-16` | the key-mapping docblock ("Bolt = engine key 2, no delay — fires on release, tap auto-releases after 0.15 s wind") | rewrite: Bolt = engine key 6, fires on press |
| 27 | `src/combat/combatData.js:783-802` | `combatData.bolt` + `combatData.whip` — the flat aggregate `spellHits` reads | `bolt` now describes a real projectile, not the ribbon's thrown head; `whip` stays and becomes the *whole* damage profile of key 1 (§4.9) |
| 28 | `src/character/meshChar.js:149` | `CAST_BY_KEY = {1:CL_CAST, 3:CL_CAST3, 4:CL_CAST4, 5:CL_CAST5}` | add `6: CL_CAST3` **on the additive layer only** (§4.3) |
| 29 | `src/character/meshChar.js:150-151` | `CAST_RATE` per clip | add a bolt-specific rate — **UNMEASURED**, see §4.3 |
| 30 | `src/character/meshChar.js:805-830` | the two cast branches (full-body at `:805`, additive at `:820`) both index `CAST_BY_KEY[ch.castWave]` | the bolt must route to the `:820` additive branch, never `:805` |
| 31 | `src/progression/progression.js:61` | `UNLOCK_LEVEL = {2:1, 1:1, 3:2, 4:4, 5:6}` | add `6: 1` (the bolt is the L1 filler — `COMBAT_DESIGN §0`: "Bolt + Wave at L1") |
| 32 | `src/progression/progression.js:505` | `if (id >= 1 && id <= 5) this.unlocked.add(id)` — save-load guard | → `id <= 6` |
| 33 | `src/progression/progression.js:617-620` | `_unlockCheck()` iterates `UNLOCK_LEVEL` | no code change; picks up id 6 automatically |
| 34 | `index.html:211` | hint: `… lmb water stream … 1-4 spells …` | → `… lmb frost bolt … 1 water stream … 2-5 spells …` |
| 35 | `game_meta.json` `controls_keyboard` | `… 1-5 cast the five spells (2 is a held cast) …` | → `LMB primary bolt · 1-5 cast the five spells (1 is a held cast)` |
| 36 | `src/main.js:902` | the how-to "Spells" prose | rewrite for the new binds |
| 37 | `src/audio/audio.js:611-614` | `_spellEdge(0,1,…) (1,3,…) (2,4,…) (3,5,…)` | add slot 4 for key 6 |
| 38 | `src/audio/audio.js:160-161` | `_spellActive`/`_spellT` are 4-element arrays | grow to 5 |
| 39 | `src/audio/voices.js:686-760` | `fire(key)` branches on 1/3/4/5 | add a key-6 branch. **There is no recorded bolt asset** — the `SMP_*` set is `CRACK0/1/2, SHIMMER, SWEEP, BLOOM, VORTEX` (`voices.js:542-548`) — so a synth voice is required or the bolt is silent. |

### 1.3 Why Digit1 must stay out of `SPELL_KEYS`

`_dispatch()` (`spellSystem.js:333-335`) polls the hold and *then* edge-fires
`input.spellPressed`. The ribbon is excluded from the edge path by the literal
`key !== 2` guard at `:335`. If `Digit1` were added to `SPELL_KEYS` mapping to 2, the
guard would still swallow it — but `spellbar.js:261`'s cast flash and
`crosshair.js:205`'s cast pulse both read `input.spellPressed` directly and would flash
a hold every frame the key repeats. Drive the hold from a dedicated
`keydown`/`keyup` pair on `Digit1` writing `input.spellHeld2`, exactly as the mouse
handlers do today (`input.js:132/141`), so the harness pin contract (`input.js:10-19`)
is untouched.

---

## 2. THE 18 IDENTITIES (6 slots × 3 realms)

**Read this first.** Every row's *Mechanic* cell says the same thing on purpose: the
hit geometry, the damage, the CC and the durations are the `COMBAT_DESIGN §1.1` /
`combatData.js` numbers and **do not change with realm**. Only the fiction, the
material and the particle treatment change. Where a row says "renderer reuse", it
means the identical draw call with different uniform values — see §3.

Realm accents are the locked art direction from
`F:\GrokUI\projects\default\assets_gen\driftwake_enemies_tpose_cold_sand_ash\LOOK.md`:
Cold = ice-cyan / pale blue rime / crystalline plate / white frost edge · Sand =
tan-ochre grit leather / bleached bronze / dusty bronze trim / wind-scoured · Ash =
charcoal black plate / soot grey leather / dull cinder-orange trim / scorched metal.

---

### SLOT LMB — the primary bolt (internal id 6)

**Mechanic, all three realms:** 12 dmg ±10%, splash 4 @ r 1.2 m, 1 element stack,
10 poise, 0 mana, 0 cd, 0.45 s fire cycle, 21 m/s, 40 m leash / 18 m fallback,
`padRadius` 0.205 m, speed-falloff 12→7 above 12 m/s with the stack suppressed
(`combatData.js:783-794`, `COMBAT_DESIGN §1.1` Bolt row). **Renderer:** the new
`BoltField` — one mesh, one material, one draw, 12-slot pool (§4). Realm changes are
uniform writes only.

| Realm | Name | What the player sees | Element / status |
|---|---|---|---|
| **Cold** | **Rime Lance** | An elongated hexagonal bipyramid of clear ice, ~0.62 m long × 0.11 m across, oriented along velocity. Ice-cyan body with a white frost edge picked out by grazing Fresnel; interior visibly transmits the sky. Trail: a thin condensation vapour ribbon — spray particles, `kind` 0 (powder), drag 4.0, life 0.3 s, so it hangs where the bolt has been. Impact: a tight frost-dust burst, a 0.28 m glaze brush into the terrain ice channel, and a 0.12 s cyan flash light. | **ice** — *Chill*: 1 stack, max 5, −6 % move/stack, 3 s refresh; at 5 → **Brittle**, ×1.2 damage taken 4 s |
| **Sand** | **Fulgurite Dart** | The same bipyramid, now fused desert glass: a bleached-bronze translucent core inside a tan-ochre grit crust that abrades off along the flight, so the silhouette sharpens as it travels. Rougher than the ice (no clean interior image, a smeared warm sky reflection instead). Trail: grit, `kind` 1 (clod — hard-edged, ballistic), drag 1.6, so it falls behind and down rather than hanging. Impact: an ochre dust puff and a small vitrified ring — the same brush, warm-tinted. | **sand** — *Abrade*: identical numbers; at 5 → **Scoured** (the Brittle window, renamed) |
| **Ash** | **Cinder Spike** | The same bipyramid, now a molten slug: charcoal-black crust with cinder-orange incandescence bleeding out of the ridge lines and the tip, which is where the crust has torn. Reads as a fireball at 21 m/s because the trail carries it — soot-grey smoke plus bright embers, `kind` 1, drag 0.7, low drag so the embers streak backward in a plume. Impact: an ember starburst, a scorch decal, and the brightest of the three flash lights. | **fire** — *Scorch*: identical numbers; at 5 → **Cracked** |

> **On owner directive 3 ("in ASH spells will be FIREBALLS"):** the *silhouette* stays a
> sharp bipyramid, because a single 12-triangle primitive is what keeps this at one draw
> call and 144 triangles (§4.6). The fireball read is delivered by the surface (molten
> crust, glowing fracture lines) and the ember plume, not by swapping the mesh for a
> sphere. If the owner wants a literal round fireball, the honest cost is a second
> geometry and a second draw call — flag it, do not assume it.

---

### SLOT 1 — the held stream (internal id 2, `ribbon.js`)

**Mechanic, all three realms:** held channel. Whip: 6 dmg/tick at 4 Hz + 1 m nudge to
everything the 46-sample × 0.20 m chain at 0.205 m radius touches
(`combatData.js:797-802`, `spellHits.js:230-286`). 0 mana (`RIBBON_DRAIN = 0`,
`spellSystem.js:83`). Scores the ground through `_score()` (`ribbon.js:721-755`).
**Renderer:** `WaterBody` `PROFILE_TUBE`, one strand of eight, `SECTION_ASPECT` 1.55
elliptical section (`ribbon.js:101`). Declares **no light** in any realm — that is a
standing decision, documented at `ribbon.js:705-711`, and it survives the reskin.

| Realm | Name | What the player sees | Element / status |
|---|---|---|---|
| **Cold** | **Rime Ribbon** | Near-clear water, milkiness 0.14 (`ribbon.js:702`). Foam white at the head and wherever `stretch` thins it. Skimming the snow flattens the section (the `ground` term, `ribbon.js:675-677`) and glazes a thin blue line. | ice / Chill |
| **Sand** | **Scourging Ribbon** | A rope of streaming grit rather than liquid: milkiness up to ~0.62 so it is nearly opaque, tan-ochre body, bleached-bronze mica flecks catching the sun (the existing grazing-glint term carries this — `glintIntensity`). It does not glaze; it *sinters*, leaving a glass streak in the same terrain ice channel, warm-tinted. Shed droplets become grains: `kind` 1, warm albedo. | sand / Abrade |
| **Ash** | **Ember Lash** | A whip of slag. Charcoal crust over a cinder-orange core, and the core shows **exactly where the ribbon is stretched thin** — `stretch = clamp(1.35 − speed·0.055, 0.55, 1.35)` (`ribbon.js:669`) already keys thickness to how fast the tip was moving, so a fast swing tears the crust and the lash lights up along the arc it just drew. This is the single best fiction/code coincidence in the set: no new per-sample data is needed, the crack mask is `1 − stretch`. Ground contact burns a scar instead of a glaze. | fire / Scorch |

---

### SLOT 2 — the ploughing crescent (internal id 1, `sweep.js`)

**Mechanic, all three realms:** travelling crescent. 20 dmg at arc centre, `bell(u)`-
tapered to 0 at the horns, ×env; knockback 4 m + 0.4 s stagger; 25 poise; 15 mana;
4 s cd; `CURVE` 5.5 m, `ARC0/1` 0.52→0.96 rad, `PEAK` 2.15 m, `LIFE` 2.4 s, reach
13.6 m; ploughs a channel with berms via `_plough()` (`sweep.js:36-49, 214-266`;
`combatData.js:808-820`). **Renderer:** `WaterBody` `PROFILE_SHEET`, one strand, the
wake's own section integral with `curl` in the twist slot (`sweep.js:180-184`).

| Realm | Name | What the player sees | Element / status |
|---|---|---|---|
| **Cold** | **Frost Wave** | A crescent of slush, milkiness 0.48 (`sweep.js:193`), hooking over its own face; heavy white foam along the whole leading edge, heaviest at centre. Low grazing cyan light (`sweep.js:197-200`). | ice / Chill |
| **Sand** | **Dune Surge** | The identical section integral read as a **slipface avalanche**: a breaking wall of dry sand, milkiness ~0.88 (dry sand transmits nothing), tan-ochre with a wind-scoured bleached crest. The foam channel becomes the airborne grit veil torn off the lip — the same channel, a warm dusty albedo instead of white. Light warm-ochre and **dimmer** (×0.85), because sand does not glow. | sand / Abrade |
| **Ash** | **Pyroclastic Surge** | The strongest fiction of the three, because a pyroclastic density current *is* literally a ground-hugging breaking wave with a burning front. Charcoal body, milkiness ~0.80; the foam channel becomes an **incandescent tear-line** — cinder-orange where the crest curls and shears, dying to grey along the horns where `bell(u)` takes the amplitude to nothing. Light bright orange, ×1.45 intensity — the brightest wave of the three. | fire / Scorch |

---

### SLOT 3 — the targeted eruption (internal id 3, `bloom.js`)

**Mechanic, all three realms:** one-shot sphere r 2.0 m at the aimed ground point,
35 dmg at the epicentre → 18 at the rim (100 % inside the inner 40 %); lingering
column, tube r 0.66 m × 5.6 m tall, 1.75 s, 8 DPS contact; 0.7 s stagger + 40 % slow
1.5 s; 30 poise; 25 mana; 6 s cd; 22 m eye-ray cap / 13 m fallback. **This is the
anti-stealth / reveal key in every realm** (`COMBAT_DESIGN §1.1` Mini-Vortex row;
`combatData.js:823-836`; `spellHits.js:414-497`). **Renderer:** `WaterBody`
`PROFILE_TUBE`, one strand, plus the crater brush, the throw ring and the fallout
curtain (`bloom.js:199-304`), plus **two** lights — one down in the crater, one riding
the head (`bloom.js:186-195`).

| Realm | Name | What the player sees | Element / status |
|---|---|---|---|
| **Cold** | **Powder Bloom** | A blue-white column of powder and water, flared head, waisted middle, broad foot; collapses back down its own axis; a slow glittering fallout curtain drifting through the frame for 3.4 s. | ice / Chill |
| **Sand** | **Blowout** | A sand **blowout** — the wind-erosion hollow the desert makes for itself. The column is a jet of grit shot through with bleached-bronze glass shards that catch the sun as they tumble (glint up, `kind` 1 clods at a higher share). The crater rim reads as a scoured hollow, not a splash crater. The fallout hangs *longer* than Cold's, which the existing curtain already supports — drag 4.6 (`bloom.js:301`) is the highest in the project. | sand / Abrade |
| **Ash** | **Fumarole** | A vent tearing open in the ash crust: a jet of black smoke with an incandescent throat, the crust at the base glowing where it cracked. The crater light (`bloom.js:186-189`) stops being a lighting trick and *becomes the vent* — held orange for the full column life, which is what makes the hole read as open rather than shadowed. Fallout is fine grey ash falling slowly with a scatter of bright embers among it. | fire / Scorch |

---

### SLOT 4 — the stance-break spike disc (internal id 4, `crystallize.js`)

**Mechanic, all three realms:** the expanding disc, r 0.18 → 2.23 m over
`PLANT_TIME` 0.85 s, 34 prisms on a golden-angle spiral, per-prism test as each plants;
30 dmg one-shot per enemy; **stun 1.5 s — the kit's only hard stun**; 60 poise — the
stance-break tool; 30 mana; 10 s cd; prisms stand 34–42 s as a hazard; the patch stays
glazed on the terrain's ~15-minute ice-channel decay (`crystallize.js:1-33, 121-161`;
`combatData.js:839-849`; `spellHits.js:503-545`). **Renderer:** `CrystalField` — one
draw, 96-slot pool, 18 triangles per prism, `RING = 6` (`crystals.js:31-35, 329-362`).

| Realm | Name | What the player sees | Element / status |
|---|---|---|---|
| **Cold** | **Crystal Spikes** | Hexagonal ice prisms, ice-cyan, refractive, lit through from behind, tallest at the centre and leaning outward as they go. The ground under them glazes to roughness 0.07 and stays a visible slick from across the field. | ice / Chill |
| **Sand** | **Fulgurite Spires** | **Lightning glass.** Fulgurite is what actually happens when energy is dumped into sand, and it is natively a spiky, hollow, branching spire — so this is not a recolour, it is the same physical event in a different medium. Bleached bronze-white fused silica, much rougher and more opaque than ice (a smeared warm reflection, not a clean transmitted image), with a tan grit crust at every base where the sand vitrified. The glaze channel becomes a sheet of desert glass. | sand / Abrade |
| **Ash** | **Basalt Columns** | **Columnar jointing.** Basalt cools into *hexagonal* columns — the Giant's Causeway — which means `crystals.js`'s six-sided prism (`RING = 6`, `crystals.js:35`) is not merely reusable here, it is the geologically correct primitive. Charcoal-black columns shoved up out of the ash, opaque and rough, with cinder-orange still glowing **in the joints between them**, fading over the 34–42 s stand time as they cool. The glaze becomes a cooled lava skin. Same mesh, opposite material: emissive in the cracks instead of refractive through the body. | fire / Scorch |

> This is the row owner directive 4 named explicitly ("Spikes for ICE in cold will no
> longer be SPIKES but must be something else SIMILAR within its realm"). Both answers
> are real-world objects that a real-world energy dump produces in that medium, and both
> are hexagonal — so the mechanic, the mesh and the fiction all agree with no
> compromise anywhere.

---

### SLOT 5 — the three lifting helices (internal id 5, `vortex.js`)

**Mechanic, all three realms:** player-following cylinder; ring 0.9 → 3.1 m while held,
retreating at 2.2 m/s on fade; height 4.8 m × env; 0.55 ramp + 3.0 hold + 1.1 fade =
4.65 s; 15 DPS × env (≈55 total) + 20 fling impact; **lift** for fodder/light, flung
8–12 m along the player's aim on release; heavy 50 % slow, boss 25 %; 8 poise/s;
45 mana; 14 s cd; strips the ground on a rotating ring and gives it back from the
outside in (`vortex.js:32-44, 197-245`; `combatData.js:852-868`;
`spellHits.js:552-665`). **Renderer:** three `WaterBody` `PROFILE_TUBE` strands out of
eight, plus the highest particle emission rate in the project — 2600/s
(`vortex.js:264`).

| Realm | Name | What the player sees | Element / status |
|---|---|---|---|
| **Cold** | **Great Vortex** | Three near-opaque white helices (milkiness 0.88, `vortex.js:193`) wound round the player, wide at the bottom where they pick snow up and waisted above; grains launched *along* the helices with the helix's own tangential velocity so the spray spirals without the particle system knowing what a vortex is. | ice / Chill |
| **Sand** | **Haboob Coil** | A dust devil, which is the most literal of the three — the same shape occurs in this medium every day. Ochre helices, milkiness ~0.92 (dust occludes harder than snow), grains as grit with a slightly longer life so the column reads as denser and dirtier. The ground strip reads as the dune being scoured down to hardpan. Light warm and dim (×0.85). | sand / Abrade |
| **Ash** | **Firestorm** | Three ropes of burning ash: charcoal bodies with cinder-orange leading edges — and the leading edge is free, because the helix already writes a `foam` value that rises toward the bottom (`vortex.js:181`), so the incandescence lands exactly where the column is picking material up. Grains are embers, longer-lived, streaking up past the top of the column. Brightest light of the three (×1.45). | fire / Scorch |

---

### 2.1 The status question — recommendation and justification

**Recommendation: rename the status per realm; keep the mechanic byte-identical.**
Chill → Abrade → Scorch. 1 stack per bolt hit, max 5, −6 % move speed per stack, 3 s
refresh, and at 5 stacks a 4 s ×1.2 damage-taken window (Brittle → Scoured → Cracked).

Five reasons, each grounded:

1. **The TTK tables are computed against one stack curve.** `COMBAT_DESIGN §1.2`'s
   Brittle loop ("Bolt×5 → Spikes → Bolt spam ≈ 42 effective DPS") and every §8.1 TTK
   row assume one status. Three mechanics means three balance passes for one beat.
2. **Thirty enemy rows already encode locks against named keys.** `combatData.js`'s
   `ENEMIES` array references Wave-KB immunity (`:187`, `:307`, `:444`), Spike-stun as
   the *only* opener (`:307`), Mini-Vortex reveal (`:197`, `:317`, `:493`) and Bolt
   behaviour (`:257`, `:380`, `:423`, `:503`) — across all three realms. Those rows are
   written against constant mechanics. Change the mechanic per realm and every one of
   them needs re-auditing.
3. **The registry implements one CC matrix, indexed by tier.** `damageable.js`'s §5.2
   matrix and `LIFTABLE` table (quoted in `spellHits.js:22-31`) are tier-indexed only.
   Per-realm mechanics adds a fourth axis to a table that is already the hardest thing
   in the combat stack to reason about.
4. **The realm bands overlap.** Sand is 8–20 and Ash is 18–30 (`combatData.js:645`), so
   a player crosses between realms while both are level-appropriate and would be
   carrying two live mental models of their own kit. The reskin is meant to make each
   realm *look* like a new game (owner directive 3), not to make the player relearn it.
5. **The one objection is answerable.** "A slow doesn't read as fire." It reads fine —
   burning hampers movement in every ARPG that has ever shipped a burn debuff, and the
   5-stack payoff renames cleanly to **Cracked** (charred plate splits → takes more).
   No mechanic change is needed to make the fiction land.

**What genuinely changes per realm:** the status *name*, its icon/colour on the enemy
health bar, and the stack VFX on the enemy body (rime frosting → grit caking → soot
charring). All three are strings and uniform writes.

---

## 3. THE SWAP MECHANISM

### 3.1 The claim, stated precisely

A realm swap must cost: **no material rebuild, no new draw calls, no shader
recompile.** All three are achievable, and none of the six spells needs a `#define`
variant. Here is why, and what it costs.

### 3.2 The one-time source change vs the per-swap cost

Today's realm-specific look lives in **compile-time GLSL constants**:

| Constant | file:line | Today's value |
|---|---|---|
| `WATER_ABSORB` | `src/shaders/water.glsl.js:185` | `vec3(3.40, 0.72, 0.34)` |
| water scatter tint | `src/shaders/water.glsl.js:309` | `mix(vec3(0.40,0.80,1.0), vec3(0.72,0.94,1.0), …)` |
| `slushAlbedo` | `src/shaders/water.glsl.js:329` | `vec3(0.86, 0.90, 0.96)` |
| `foamAlbedo` | `src/shaders/water.glsl.js:348` | `vec3(0.93, 0.955, 0.99)` |
| water spell-light tint | `src/shaders/water.glsl.js:404` | `mix(vec3(0.35,0.62,0.78), vec3(0.9), vMilk)` |
| `ICE_ABSORB` | `src/shaders/crystal.glsl.js:107` | `vec3(2.35, 0.60, 0.24)` |
| crystal `deepTint` | `src/shaders/crystal.glsl.js:184` | `mix(vec3(0.42,0.74,1.0), vec3(0.86,0.95,1.0), …)` |
| crystal frost albedo | `src/shaders/crystal.glsl.js:196` | `vec3(0.88, 0.915, 0.965)` |
| crystal spell-light tint | `src/shaders/crystal.glsl.js:232` | `mix(vec3(0.3,0.6,0.85), vec3(0.88), frost)` |
| spray albedo | `src/shaders/spray.glsl.js:192` | `vec3(0.92, 0.94, 0.98)` |

Promoting each of these to a uniform is a **one-time source edit**, compiled once at
boot when the material is first built — which already happens, and is already covered
by the warm-up path (`waterBody.js:325-349`, `crystals.js:293-298`, whose docblocks
record that hiding the mesh during warm-up moved a ~250 ms and a ~156 ms hitch onto the
first cast respectively). **After that edit, a realm swap recompiles nothing:** it
writes numbers into `{value}` boxes the programs already sample at draw time.

That contract is not new here — it is the one `spellLights.js:14-28` already documents
and relies on ("Three keeps a `{ value }` box per uniform and reads it at draw time").

### 3.3 The block

Owned by `SpellSystem`, alongside `this.globals` (`spellSystem.js:114-121`) and
`this.spellUniforms` (`:130`), and spread into the same three materials by the same
`Object.assign` those materials already use (`waterBody.js:146-151`,
`crystals.js:99-106`, and the new `BoltField`).

```js
/** The realm palette. Written on a realm boundary; read at draw time. */
this.realmUniforms = {
    uRealmAbsorb:   { value: new THREE.Vector3() },  // water.glsl:185 / crystal.glsl:107
    uRealmScatter0: { value: new THREE.Vector3() },  // water.glsl:309 lo
    uRealmScatter1: { value: new THREE.Vector3() },  // water.glsl:309 hi
    uRealmBody:     { value: new THREE.Vector3() },  // water.glsl:329 / crystal.glsl:196
    uRealmFoam:     { value: new THREE.Vector3() },  // water.glsl:348
    uRealmGrain:    { value: new THREE.Vector3() },  // spray.glsl:192
    uRealmLitTint:  { value: new THREE.Vector3() },  // water.glsl:404 / crystal.glsl:232
    uRealmEmissive: { value: new THREE.Vector3() },  // NEW. cold/sand = (0,0,0)
    // (roughness, translucency 0..1, emissiveMaskPow, reserved)
    uRealmSurface:  { value: new THREE.Vector4() },
};
```

Plus two **CPU-side** realm scalars that are not uniforms at all, because they already
have a home in existing per-strand data:

```js
this.realm = "cold";
this._milk  = { sweep: 0.48, ribbon: 0.14, bloom: 0.42, vortex: 0.88 };  // cold
this._light = { r: 1, g: 1, b: 1, mult: 1 };  // multiplies each spell's lights.add()
```

`_milk` feeds the existing `water.setParams(s, profile, milkiness, alpha, count)`
argument (`waterBody.js:221-227`) at `sweep.js:193`, `ribbon.js:702`, `bloom.js:180`,
`vortex.js:193`. That is a write into a `Float32Array` slot that is *already* uploaded
every frame — zero new cost, zero new uniforms.

`_light` multiplies the rgb the spells pass to `lights.add()` at `sweep.js:197-200`,
`bloom.js:186-195`, `crystallize.js:103`, `vortex.js:104-107`. `ribbon.js` declares no
light and stays that way.

### 3.4 The write pattern

`enemyVis.js:216-224` (`_writeShardState`) is the house pattern for **per-draw** data:
a `Float32Array` in one `{value}` box (`enemyVis.js:265-266`), mutated in
`onBeforeRender`, "the uniform box's contents change per draw and Three re-uploads just
those 4 floats" (`enemyVis.js:212-214`).

A realm palette is **per-event** data, not per-draw. The correct analogue is therefore
strictly *cheaper* than the house pattern: same `{value}`-box contract, written once on
the swap, with **no `onBeforeRender` hook at all**.

```js
/** @param {"cold"|"sand"|"ash"} name */
setRealm(name) {
    const p = REALM_PALETTE[name];      // frozen 3-row table, module scope
    if (!p || name === this.realm) return;
    this.realm = name;
    const u = this.realmUniforms;
    u.uRealmAbsorb.value.set(p.absorb[0],  p.absorb[1],  p.absorb[2]);
    u.uRealmScatter0.value.set(...);      // …one .set() per box, all preallocated
    u.uRealmEmissive.value.set(p.emis[0], p.emis[1], p.emis[2]);
    u.uRealmSurface.value.set(p.rough, p.translucency, p.emisPow, 0);
    this._milk  = p.milk;                 // frozen object, no copy
    this._light = p.light;
    this.bolt.setRealm(p);                // pool-side: trail kind/drag/life
}
```

**Allocation on swap: zero** — every target is a preallocated `Vector3`/`Vector4` and
every source is a frozen literal. **Frequency: once per realm crossing.** **Draw calls
changed: zero.** **Programs compiled: zero** — provable, see §5 assertion F.

### 3.5 Per-spell: exactly which uniforms change

| Spell | Material | Uniforms it reads from the block | Non-uniform realm input |
|---|---|---|---|
| **LMB bolt** (id 6) | `BoltField` (new) | `uRealmBody`, `uRealmEmissive`, `uRealmSurface`, `uRealmGrain`, `uRealmLitTint` | trail `kind`/drag/life (JS, passed to `spray.emit`); impact light rgb |
| **1 stream** (id 2) | `WaterBody` | `uRealmAbsorb`, `uRealmScatter0/1`, `uRealmBody`, `uRealmFoam`, `uRealmLitTint`, `uRealmEmissive`, `uRealmSurface` | `_milk.ribbon` → `setParams` at `ribbon.js:702`; shed-particle `kind` at `ribbon.js:793-794`; the Ash crust-crack mask is `1 − stretch`, already computed at `ribbon.js:669` |
| **2 crescent** (id 1) | `WaterBody` | same block (shared material — one set of boxes serves every strand) | `_milk.sweep` at `sweep.js:193`; light rgb at `sweep.js:199`; spray `kind` at `sweep.js:307` |
| **3 eruption** (id 3) | `WaterBody` | same block | `_milk.bloom` at `bloom.js:180`; **two** light rgb at `bloom.js:188/193`; curtain drag at `bloom.js:301` |
| **4 spike disc** (id 4) | `CrystalField` | `uRealmAbsorb`, `uRealmBody`, `uRealmEmissive`, `uRealmSurface`, `uRealmLitTint` | light rgb at `crystallize.js:103`; frost-spray `kind` at `crystallize.js:181` |
| **5 helices** (id 5) | `WaterBody` | same block | `_milk.vortex` at `vortex.js:193`; light rgb at `vortex.js:106`; grain life at `vortex.js:301` |
| *(shared)* | `SprayField` | `uRealmGrain` | — |

**Note the leverage:** four of the six spells share ONE material (`WaterBody` —
"one mesh, one material, one draw, eight strands", `waterBody.js:1`). One `.set()` per
box reskins Sweep, Ribbon, Bloom and Vortex simultaneously.

### 3.6 The one hard case, and why it still needs no variant

**Crystallize is the only spell whose realm identity crosses a material boundary:**
Cold ice is *refractive and translucent*; Ash basalt is *opaque and emissive*. The
crystal fragment stage today does a **three-sample dispersive** refraction —
`refract(-V, N, 1.0/1.3050 | 1.3090 | 1.3170)` at `crystal.glsl.js:165-167` — plus an
internal-transport back-scatter term at `:183`. Ash basalt needs none of it.

Two ways to serve both:

- **(a) One program, one blend. RECOMMENDED.** Keep both paths and lerp:
  `color = mix(opaqueShading, refractedShading, uRealmSurface.y)` with
  `translucency` = 1.0 cold / 0.45 sand / 0.05 ash, and add
  `color += uRealmEmissive * jointMask` unconditionally (cold/sand write `(0,0,0)`).
  Cost: both paths evaluated every fragment, no branch, no variant, no recompile.
  The three dispersive `textureLod(uSkyLUT, …)` fetches are already there and are not
  duplicated — what is added is ALU, not bandwidth. (If that ALU ever measures hot,
  the *cheap* lever is the one `enemyVis.js:151-157` already took for the same
  material family: collapse three refraction samples to one. That is still a source
  edit compiled once, not a per-swap cost.)
- **(b) A `#define REALM_OPAQUE` variant.** Rejected. It doubles the program count for
  the crystal material *and* its 2 shadow-cascade caster materials
  (`crystals.js:135-143`) *and* its prepass material (`crystals.js:165-172`) — 4 extra
  programs — and it re-pays the pipeline-specialisation cost the warm-up exists to
  hide (`crystals.js:282-291` records a measured 156 ms hitch when that warm-up was
  skipped). Paying that at a realm boundary is exactly the stutter the boundary must
  not have.

**So: no spell needs a `#define` variant. All eighteen identities are reachable by
uniform writes alone.**

**Honest cost note (UNMEASURED):** option (a) adds fragment ALU to the crystal
material. I have not measured it and will not invent a number. The bound is small and
statable: the crystal mesh is one draw of at most 1,728 triangles (96 prisms × 18 —
`crystals.js:327-328`) against a measured baseline of 22 draws / 1,799,120 triangles.
The measurement belongs in the D-perf pass, with the acceptance criterion "frame time
in Ash within noise of Cold on the same seed and the same camera".

---

## 4. THE NEW PRIMARY BOLT — full specification

### 4.1 Numbers (all from `combatData.js` / `COMBAT_DESIGN §1.1`)

| Property | Value | Source |
|---|---|---|
| Damage | 12, ±10 % variance, no crits | `combatData.js:59, 784, 788` |
| Damage above the speed gate | 7 | `combatData.js:62, 785` |
| Speed gate | 12 m/s horizontal | `combatData.js:62, 786` |
| Restore delay after dropping below | 0.4 s | `combatData.js:62, 787` |
| Element stack | 1 (max 5, −6 %/stack, 3 s refresh; 5 → ×1.2 taken 4 s). **Suppressed above the gate** | `combatData.js:65-66, 790` |
| Splash | 4 damage, 0.6–1.2 m, adjacent targets only (the direct hit excluded) | `combatData.js:67, 791-792`; `spellHits.js:209-214` |
| Poise | 10 | `combatData.js:69, 789` |
| Mana | **0** — the resource-neutral filler | `combatData.js:69` |
| Cooldown | **0** | `combatData.js:69` |
| Fire cycle | 0.45 s → 26.7 DPS planted, 15.6 kiting | `combatData.js:60`; `COMBAT_DESIGN §1.2` |
| Projectile speed | 21 m/s | `combatData.js:61` |
| Range | 40 m aim leash, 18 m fallback | `combatData.js:61` |
| Hit radius (`padRadius`) | 0.205 m | `combatData.js:793` |
| Tip snap to the crosshair point | 0.6 m | `combatData.js:61` |

### 4.2 Fire model — **hold to auto-repeat, tap fires one**

Today's LMB is a hold whose *release* throws (`ribbon.js:181-212`), with a 0.15 s
"tap wind" auto-release (`combatData.js:57`). That model exists only because the bolt
was the ribbon's thrown phase. With a dedicated projectile it should go.

**Recommended:** LMB down fires immediately and starts a 0.45 s repeat timer; holding
LMB fires every 0.45 s; releasing stops it. `tapWindS` is deleted. This is the model
`COMBAT_DESIGN §1.2` already computes DPS against ("12 / 0.45 s → 26.7").

**Anti-kite rule, unchanged in substance, moved in timing.** `spellHits.js:129-134`
runs the falloff clock continuously and correctly — `_fastUntil = registry.time + 0.4`
refreshed every frame the player is above the gate. Today `_boltMoving` is captured on
the *release* frame (`spellHits.js:157-163`). With no release, capture it **per
projectile at spawn** and carry it on the pool slot. Semantics are identical: "was the
player above 12 m/s within the last 0.4 s when this bolt left the hand".

### 4.3 Cast animation — and the one thing I could not verify

`CAST_BY_KEY` (`meshChar.js:149`) maps keys to clips; `STRIKE_DELAY`
(`spellSystem.js:75`) is each clip's measured strike time divided by its `CAST_RATE`,
and the docblock at `spellSystem.js:73` mandates "re-measure BOTH together if the clips
or rates change".

The natural clip for a one-handed bolt is `CL_CAST3` (1H Magic Attack 03,
`meshChar.js:141/149`), whose measured strike is **0.824 s at rate 1.25 → 0.66 s**
(`spellSystem.js:70-73`). **A 0.66 s wind-up cannot serve a 0.45 s fire cycle** — the
arm would fall permanently behind the stream.

**Recommendation, with the uncertainty stated:**

- `STRIKE_DELAY[6] = 0` — the bolt spawns at the hand on the press frame. The muzzle
  *is* the hand, so there is nothing to wait for.
- Route the bolt to the **additive** cast layer, never the full-body one. `meshChar.js`
  already has both: full-body at `:805-819`, additive at `:820-830`. An additive arm
  flick over a running or surfing base is exactly what a 2.2 Hz primary needs, and it
  will not fight locomotion.
- `CAST_BY_KEY[6] = CL_CAST3`, with a bolt-specific `CAST_RATE` **that is UNMEASURED**.
  It must be measured through `_harness/footphase.html` before ship, per the
  `spellSystem.js:73` rule. Do not guess it into the table.

### 4.4 "Sharp bolt" geometry

Owner directive 2: *"if possible make it like a sharp bolt."*

**Recommended: an elongated hexagonal bipyramid oriented along velocity, reusing the
existing shard primitive.** `buildShardGeometry()` (`enemyVis.js:587-604`) builds
exactly this and nothing else: vertex 0 at `(0,0,0)` is the base apex, a 6-vertex ring
at `y = 0.3, r = 1`, and the tip at `(0,1,0)` — a short cone below the ring and a long
cone above it. Eight vertices, **12 triangles**.

Scale it `(0.055, 0.62, 0.055)` in local space (0.11 m across, 0.62 m long) and orient
local `+Y` along the velocity vector. Sharp by construction, and free — the primitive
already exists and is already proven in the shipped build.

### 4.5 Pool size — **12**, derived

Max flight time = range / speed = 40 / 21 = **1.905 s** (`combatData.js:61`). At the
0.45 s fire cycle a continuously-firing player has `ceil(1.905 / 0.45) = 5` bolts in
the air at once. Double it for the splash-hold frames and any second source, round up:
**12**. Cost: 12 × 12 = **144 triangles**, against a measured baseline of 1,799,120.

### 4.6 One draw call

Same mechanism as the two systems that already do it, for the same reason:

- `WaterBody` — "one mesh, one material, one draw, eight strands … a zero radius puts
  every vertex of that strand on one point, so its triangles have no area and the
  rasteriser skips them. **The draw call and the vertex count therefore do not depend
  on how many spells are up**" (`waterBody.js:1-15`).
- `CrystalField` — "one draw, one 3 × 96 upload, and no geometry generated at any
  point. A crystal that is not alive has zero growth, hence zero height, which collapses
  every one of its eighteen triangles onto its base point" (`crystals.js:1-8`).

`BoltField` copies it exactly:

- One `BufferGeometry`, `position` attribute = `(boltIndex, vertexIndex, 0)` — carries
  no geometry, same encoding as `crystals.js:334-340` and `waterBody.js:386-391`.
- One `12 × 2` `RGBA32F` `DataTexture`, `NearestFilter`, `flipY = false`, every read a
  `texelFetch` — the pattern and its WebGL2 justification are spelled out at
  `waterBody.js:104-115`. Row 0 = `(x, y, z, scale)`, row 1 = `(dx, dy, dz, age01)`.
- One `RawShaderMaterial`, `glslVersion: GLSL3`, uniforms = `globals` +
  `realmUniforms` + `sky.uniforms` + `shadows.receiverUniforms(...)` + `lights.uniforms`
  — the same `Object.assign` shape as `crystals.js:99-106`.
- `frustumCulled = false`, `matrixAutoUpdate = false`,
  `boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)` — mandatory, and
  `waterBody.js:406-409` records exactly what happens without it.
- A dead bolt has `scale = 0` → all 12 triangles collapse to a point → skipped.
- `renderOrder = 1`, with the terrain and crystals; opaque-ish, `depthWrite = true`.
- **Draw calls: +1, unconditional.** Baseline 22 → 23.

**`warmUp()` / `finishWarmUp()` are mandatory.** `SpellSystem.warmUp` (`:525-528`)
already stands real geometry up in the water and the crystals before the warm frames,
and both docblocks record the measured hitch (~250 ms, ~156 ms) that happens without
it. Add `this.bolt.warmUp(x, y, z)` there and `this.bolt.finishWarmUp()` at `:534-537`,
and add `this.bolt.mesh` to `warmUpMeshes` (`:221-223`).

### 4.7 Trail and impact — no new systems

- **Trail:** the existing `SprayField`, through the same `ctx.spray.emit(...)` call
  `sweep.js:308` and `vortex.js:292` make. `PROPOSED` rate: 90 particles/s/bolt ×
  `ctx.sprayScale`, life 0.25–0.40 s. Realm differences are arguments, not code:
  Cold `kind` 0 (powder) drag 4.0 — vapour that hangs; Sand `kind` 1 (clod) drag 1.6 —
  grit that falls; Ash `kind` 1 drag 0.7 — embers that streak. **Zero new draw calls.**
- **Impact:** the ribbon's `_splash()` (`ribbon.js:515-577`) scaled down — a wide, low
  fan of ~40 particles (its own docblock explains why wide-and-low is the correct
  shape), one `deform.brush(x, z, 0.28, …)`, and a 0.12 s light.
- **Camera trauma:** `rig.addTrauma(0.03)`. **Not** the ribbon's 0.09
  (`ribbon.js:576`) — at 2.2 impacts/second that is a permanent shake.

### 4.8 The light-pool rule — a real constraint, found by reading

`MAX_SPELL_LIGHTS = 4` (`spellLights.js:32`), and `add()` **drops the fifth silently**
(`spellLights.js:83`, and the docblock at `:71-76` says that is the intended failure).
Five bolts in flight each declaring a light would evict every other spell's light every
frame.

**Rule: an in-flight bolt declares NO light. Only the impact declares one, for 0.12 s,
and only if fewer than 3 slots are already taken.** Cold and Sand impacts are dim
anyway; Ash's is the one that matters and it is the one this protects.

### 4.9 What changes because the Ribbon is no longer LMB

1. **`spellHits._bolt()` (`spellHits.js:147-206`) must be rewritten.** It currently
   reads `rib.thrown`, `rib.tipX/Y/Z` and `rib._splashed`. It becomes a loop over the
   bolt pool, each slot running the same `reg.segmentHit(prev…, cur…, padRadius)` swept
   test — which is the anti-tunnelling rule and must survive verbatim
   (`spellHits.js:170-179`: at 21 m/s and 13 fps the head moves ~1.6 m per frame).
   Each slot carries its own `_boltSpent` / `_boltHitId` / `_boltMoving`.
2. **`spellHits._whip()` (`spellHits.js:230-286`) stays on the ribbon, unchanged**, and
   becomes the *entire* damage profile of key 1: 6/tick at 4 Hz + 1 m nudge, radius
   0.205 m along the live spine.
3. **OPEN DECISION — the ribbon's throw.** The ribbon still throws on release
   (`ribbon.js:181-212`) and still splashes (`:515`), but with `_bolt()` re-pointed at
   the new pool, **no `§1.1` row covers the thrown body any more.** Two options:
   - **RECOMMENDED:** keep the throw as a *visual* release — the burst, the splash
     spray and the `deform.brush()` all stay, damage does not. Key 1 remains the
     whip channel it is specified as, and cannot silently out-damage the LMB it just
     handed its job to.
   - Or give the throw its own §1.1 row and numbers. That is a design change, not an
     implementation detail, and it needs the owner.
     **This is a gate: do not pick one silently.**
4. **`input.spellHeld2`'s writer moves from mouse to `Digit1`** (`input.js:132/141` →
   a keydown/keyup pair). Contract 1 (`input.js:10-19`) survives: it stays a plain,
   configurable, writable data property, never an accessor, never cached in a module
   local — or every harness ribbon shot silently becomes an idle stand.
5. **LMB is now a press, and LMB is also the pointer-lock gesture** (`input.js:103-105`).
   The `if (!input.locked) return` guard at `input.js:128` already prevents the
   lock-acquiring click from firing a bolt. It was cosmetic before; it is load-bearing
   now. Do not remove it.
6. **`spellbar.js:31-48`**: a new LMB slot is prepended, and the stream's slot label
   changes `"LMB"` → `"1"`. `_slot[2]`'s `.held` logic (`:214-218`) is unchanged.
7. **Audio**: `_spellEdge` gains a 5th slot (`audio.js:611-614`, arrays at `:160-161`),
   and `voices.js:686` gains a key-6 branch with a **synth** voice — there is no
   recorded bolt sample in `SMP_*` (`voices.js:542-548`).

---

## 5. HEADLESS TEST PLAN — `_harness/realmspell.py`

Shaped like `_harness/spellprobe.py`: Playwright → `chromium` channel `chrome`,
`--use-angle=d3d11`, the same `BOOT` readiness gate on `globalThis.SNOWFLOW`
(`spellprobe.py:36-42`), everything driven through `pg.evaluate` against the
`SNOWFLOW` contract (`main.js:1001-1047`), results to `realmspell_last.json`.

**Two harness facts that shape the design:**

- The harness cannot forge pointer lock (`input.js:12-17`), so LMB cannot be driven
  through a real `MouseEvent`. Drive it with `SNOWFLOW.spells.cast(6)`, and pin the
  hold with `Object.defineProperty` exactly as contract 1 prescribes. Keys 2–5 *can* be
  driven with real `KeyboardEvent`s (`_harness/shots.js` `key()` already does).
- Determinism: pin the RNG with `resetRandom(seed)` (`bending.js:38`) before every
  measured cast, or the ±10 % bolt variance (`combatData.js:788`) and every spray/
  scatter jitter make two runs incomparable.

**New `SNOWFLOW` surface the probe needs** (exposed the way `deform` and `crosshair`
are — `main.js:1005-1013`): `spells.setRealm(name)`, `spells.realm`,
`spells.realmUniforms`, `spells.bolt` (pool + `liveCount`).

### The assertions

| # | Name | Per | What it asserts | Catches |
|---|---|---|---|---|
| **A** | BINDING | 6 slots × 3 realms | Dispatch the real input for a slot, step ~8 frames, assert *that* engine object went `active` (or `held`) and **no other did**. | an off-by-one in `SPELL_KEYS`, a stale `spellbar` id, a missed `CAST_BY_KEY` row |
| **B** | GATES | 6 × 3 | Mana debited == `MANA_COST[id]`; `cooldownFrac(id)` == 1 immediately after; `cooldownLeft(id)` ≈ `COOLDOWN[id]`. **LMB and key 1 must show mana 0 and cd 0.** | a bolt that accidentally inherits a cooldown; a mis-keyed `MANA_COST` |
| **C** | STRIKE TIMING | 4 scheduled slots × 3 | Time from `cast(id)` to the spell's `active` edge == `STRIKE_DELAY[id]` ± 1 frame. LMB asserts **0** (same-frame). | a `_schedule`/`_drainPending` regression from the id-6 branch |
| **D** | **MECHANIC INVARIANCE** | 6 × 3 | With the same seed, the same pinned dummy at the same offset, and the same cast: total damage, poise, CC type and CC duration read off the registry must be **exactly equal across Cold, Sand and Ash**. | **the single test that enforces owner directive 4.** Any realm that changed a gameplay number fails here. |
| **E** | FX DIVERGENCE | 3 realms | Snapshot `spells.realmUniforms` after each `setRealm`. Every palette vector must **differ** pairwise across all three realms (no silently-unswapped channel), and `uRealmEmissive` must be `(0,0,0)` for cold and sand and non-zero for ash. | a reskin that only half-landed — the failure mode where Sand looks like tinted Cold |
| **F** | **NO RECOMPILE, NO NEW DRAWS** | 3 swaps | Read `renderer.info.programs.length` before and after every `setRealm`; assert **unchanged**. Read `renderer.info.render.calls` in each realm; assert identical, and equal to baseline **+1** (the bolt mesh). | the whole §3 claim. This is the proof, not the argument. |
| **G** | LIGHT-POOL SAFETY | 3 realms | Hold LMB 3 s (≈7 bolts), assert `spells.lights.count` never exceeds `MAX_SPELL_LIGHTS` = 4 (`spellLights.js:32`) **and** that a Vortex cast during the spam still gets its light — i.e. bolts never evict. | §4.8. Silent eviction (`spellLights.js:83`) produces no error at all. |
| **H** | STRAND SAFETY | 3 realms | Vortex takes 3 strands (`vortex.js:26`), ribbon/bloom/sweep 1 each, `HandWeave` 1, out of `STRAND_MAX` 8 (`waterBody.js:33`). Under an all-keys stress: `water.liveStrands` ≤ 8, `acquire()` never returns −1 for a spell cast, and **the bolt takes zero strands**. | a bolt implemented on the water body would starve the Vortex — the exact failure `handWeave.js:54` already guards against |
| **I** | POOL BOUND | 3 realms | `spells.bolt.liveCount` never exceeds 12 under 3 s of hold; every slot returns to free within `range/speed` = 1.905 s + splash hold. | a leaked slot; §4.5's derivation being wrong |
| **J** | SPEED FALLOFF | 3 realms | Fire planted → 12 ±10 % and a stack applied. Pin `controller.speed` above 12, fire → 7 ±10 % and **no stack**. Drop below the gate, wait 0.4 s, fire → 12 again. | `spellHits.js:129-134` + the spawn-time capture of §4.2 |

Run shape, mirroring `spellprobe.py:191-302`: one browser, one page, boot-gate,
then `for realm in ("cold","sand","ash"): pg.evaluate("…setRealm(realm)")` and the
A–J block inside, with `--sections` to run a subset. Output a single
`realmspell_last.json` keyed `{realm: {assertion: result}}`, and print a PASS/FAIL
matrix so a failing cell names its own slot and realm.

---

## 6. Out-of-scope findings surfaced, not fixed

1. **The ribbon's throw has no damage row after the rebind** (§4.9 item 3). It is a
   design gate for the owner, not an implementation choice. Recommendation: visual-only.
2. **No cast clip in the shipped GLB fits a 0.45 s fire cycle.** `CL_CAST3`'s measured
   strike is 0.66 s at its shipped rate (`spellSystem.js:70-73`). §4.3's additive-layer
   answer works, but the bolt-specific `CAST_RATE` is **UNMEASURED** and must go through
   `_harness/footphase.html` before ship.
3. **No recorded bolt audio exists.** `SMP_*` covers sweep, bloom, crystallise (3
   cracks + shimmer) and vortex only (`voices.js:542-548`). Key 6 needs either a new
   asset or a synth voice, or the primary attack is silent.
4. **`crystals.js` has two free, already-uploaded per-prism float channels.** Row 2 is
   documented `(growth, seed, tint, -)` at `crystals.js:61`; `plant()` writes `0` to
   both `tint` and the reserved slot (`crystals.js:209-212`); the vertex stage reads
   only `c.y` (`crystal.glsl.js:45, 54`). If per-prism realm variation is ever wanted
   (e.g. cooling basalt joints fading at different rates), it costs **zero** extra
   upload. Not needed for the 18 identities as specified.
5. **`main.js:868`'s tagline already says "a world of drifting realms"** and
   `main.js:902` already promises "Each realm you cross adds its own element to the
   kit" — the copy is ahead of the code. Both strings are in the rebind table (rows 36
   and, indirectly, the how-to) and should be reconciled in the same pass.
