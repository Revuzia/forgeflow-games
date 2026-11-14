The following is the complete synthesized build brief, returned as the deliverable.

---

# ASCENDANT — WORLD 5 BUILD BRIEF · PRISM CROWN (`rainbow`)

**Provenance.** Winner by combined judge total: **Design index 2 — PRISM GATE + COLOUR BLOOM** (J1 50 + J2 42 = **92**, vs design 0 = 84, design 1 = 83.5). Both judges independently picked it. This brief is design 2 with all 8 of Judge 1's grafts, all 7 of Judge 2's grafts, and every named judge concern resolved (ledger in §10).

**Verified this session** (build lanes may rely on these without re-checking): `hub.js:184-189` portals use `yaw = deg·D2R` outward (0/π/2/π/−π/2 at +X/+Z/−X/−Z), confirmed by `game.js:126-131`; `portalArch` hardcodes `R = 21.0` (`hub.js:99`); `OUTER = −0.90`, tiers are 0.45 m auto-steps (`hub.js:140,193`); balustrade rails at deg 30/60, r 22.5, s `[0.55,1.15,10.8]` (`hub.js:216-223`), newel post at deg 45 (`hub.js:226-229`); `reachcheck.mjs:105-108` — `HAZARD_KINDS` lacks `lasergrid`/`lasersweep` today; `hazards/index.js:381,402` — REQUIRED's `object` check (`isObj`) rejects arrays; `game.js:937` clamps difficulty to 1..10. Per judge verification (not re-checked): `stageselect.js:683` clamp 0..10, `save.js:36`, `boot.js:415`, `pendulum.js:267` sphere kills, temple-3 = 400.6 m / 106 objects / 68 hazards / par 205 s.

---

## 1 · World identity

| Field | Value |
|---|---|
| id | `rainbow` |
| name | **PRISM CROWN** |
| subtitle | `THE LIGHT AFTER THE STORM` |
| blurb | "The bridge the storm left behind. Every lesson, in every colour, one last time." |
| theme | `rainbow` (new `themes.js` block, same key set as `temple:`) |
| accent | `0xff7ad9` (magenta-pink — distinct from all four world accents, from HOT `0xff1044`, and from finish `0xd9b6ff`) |
| stages | `rainbow-1` FIRST LIGHT · `rainbow-2` THE SPLIT · `rainbow-3` WHITE LIGHT |
| difficulty | `10` on all three stages (engine clamp verified `game.js:937`; the curve past the ceiling lives in the design, not the number) |
| par (ms) | rainbow-1 `150000` · rainbow-2 `178000` · rainbow-3 `215000` |

New trap archetypes: **`prismgate`** (travelling-aperture light wall — "the window is the door") and **`bloom`** (expanding shockwave ring — jump the LOW class, duck the HIGH class).

---

## 2 · Hub portal spec (replaces the winner's dais wholesale — Judge 2 graft 1, Judge 1 required fix)

**Placement: diagonal at deg 45** (between NEON at 0 and FOUNDRY at 90 — the contract's sanctioned diagonal option), on its own raised plate. The winner's deg-225 dais is DELETED from the plan: it collided with the deg-224 overlook slab (0.60 m headroom) — confirmed by both judges.

All additions are appends to `hub.js` `objects[]` (contract law 8). Use the file's own `at(deg, r, y)` and `D2R` idioms. `OUTER = −0.90`.

```js
// Raised plate — top at OUTER+1.35 = 0.45, clear of the r-22.5 balustrade
// (plate radial span 17.4..21.8 vs rail inner face 22.225: 0.425 m clear;
// arch legs at r≈21.2 land ON the plate; the deg-45 newel post sits 1.5 m
// behind the gate panel — untouched, per append-only law 8)
{ kind:'platform', p: at(45, 19.6, 0.00), s:[4.4, 0.9, 7.0], rot:[0, -45*D2R, 0], mat:'stone',  glow: 0x2c4c6e },
// Three-step stair, every rise exactly 0.45 m = the auto-step (fixes design 0's
// over-tall stair that Judge 1 flagged): promenade -0.90 → -0.45 → 0.00 → plate 0.45
{ kind:'platform', p: at(45, 16.2, -0.90), s:[1.6, 0.9, 3.2], rot:[0, -45*D2R, 0], mat:'stone' },
{ kind:'platform', p: at(45, 17.4, -0.45), s:[1.6, 0.9, 3.2], rot:[0, -45*D2R, 0], mat:'stone' },
// The arch itself (helper's hardcoded R=21.0 is coherent with this plate)
...portalArch({ deg: 45, tint: 0xff7ad9, label: 'PRISM CROWN', sub: 'THE LIGHT AFTER THE STORM', floorTop: 0.45 }),
```

```js
// portals[] append — yaw PINNED DELIBERATELY to the empirical convention
// portals yaw = deg*D2R (verified hub.js:184-189 + game.js:126-131).
// Never facingIn()/facingOut(): hub.js:157-164 documents that space-mix as a shipped bug.
{ world: 'rainbow', p: at(45, 20.6, 0.55), yaw: Math.PI / 4 },   // 0.55 = floorTop 0.45 + 0.1
```

**Sky spectacle (Judge grafts J1-6 / J2-5, zero play-surface luminance):** one distant deco rainbow — seven thin concentric arc bands (band width 0.35 m, spacing 0.15 m, hexes from §4) in a vertical plane, chord from az 45° to az −20° at r ≈ 60 m outside the rim, apex y ≈ +20. `mat:'emissive'`, luminance ≤ 2× scene (distant scenery, not trim). From the arrival spawn (ARRIVE_DEG 157.5 looking inward at −22.5°) the arc spans the view axis, so world 5 is visible from the first frame. Pure deco, far outside the play corridor.

**Integration checklist (contract table, instantiated):**
1. `runtime/core/save.js:36` — `DEFAULT_WORLD_ORDER` → `['neon','foundry','spire','temple','rainbow']` (sequential unlock after all of temple: already enforced).
2. `runtime/data/index.js` — WORLDS append: `{ id:'rainbow', name:'PRISM CROWN', subtitle:'THE LIGHT AFTER THE STORM', theme:'rainbow', accent:0xff7ad9, blurb:<§1>, stages:['rainbow-1','rainbow-2','rainbow-3'] }`.
3. `runtime/data/index.js:~307` — three lazy imports `'rainbow-N': () => import('./stages/rainbow-N.js')`.
4. `runtime/world/themes.js` — new `rainbow:` block, same key set as `temple:`, carrying the hue-collision ledger comment (§4).
5. `runtime/boot.js:415` — extend valid-id copy to "… rainbow-3".
6. `content.json` / `game_meta.json` — every "four worlds" → "five worlds".

---

## 3 · Palette + explicit glare budget

**Rule: base is neutral, spectrum is trim.** A rainbow world is the maximum-risk glare trap (contract law 5); hue lives on strips and light, never on faces.

| Token | Hex | Use |
|---|---|---|
| OPAL | `0xe9e6f0` | matte white-stone walking surfaces, emissive 0 |
| SMOKE | `0x241f2e` | dark cloudglass structure — the dark-adapted scene stays dark |
| Band 0 RED | `0xff5a4d` | vermilion — deliberately held off HOT `0xff1044` |
| Band 1 ORANGE | `0xffa03c` | pip/strip only, never furnace light (foundry accent is `0xff8a3c`) |
| Band 2 YELLOW | `0xf5e63d` | lemon; GOLD signage stays text-on-post form, so shape disambiguates |
| Band 3 GREEN | `0x3ddc84` | trim strips only, never beacon/pillar forms (MINT `0x18d69a` = checkpoints keeps its unique form) |
| Band 4 BLUE | `0x38b6ff` | |
| Band 5 INDIGO | `0x4f6bff` | |
| Band 6 VIOLET | `0x9a5cff` | deep — far from finish lavender `0xd9b6ff`, which stays finish-only |
| HOT | `0xff1044` | THE kill colour: every lethal prismgate thread and bloom leading edge carries a HOT core, whatever band it wears |
| IVORY | `0xfff8e6` | safe edges + the aperture frame you aim for |
| GOLD | `0xffc35c` | teaching signs + embossed pips |
| MINT | `0x18d69a` | checkpoints (untouched) |
| Accent | `0xff7ad9` | portal/world card |

**Hue-collision ledger** — ships verbatim as a comment block atop the `themes.js` `rainbow:` entry (graft J1-8 / J2-5): band-red vs HOT · band-violet vs finish · band-orange vs foundry accent · band-yellow vs GOLD · band-green vs MINT, each with the resolution above.

**Glare budget (numbers the dark-adapted review checks against):**
- Band hue may appear ONLY on: edge strips **≤ 0.3 m** wide, prismgate filaments **≤ 0.1 m**, bloom ring tubes (≤ ringW 0.5 m), pips, banners, light shafts.
- Source:surface luminance **3–8× scene**, everywhere, no exceptions.
- Prismgate lattice: filaments ≤ 0.1 m at ≥ 0.55 m spacing — lit area of any gate face **≤ 18 %** of its span (an open lattice, never a lit wall — answers Judge 2's "wall-sized filament" concern).
- Total hue-trim emissive **≤ 5 %** of screen area in any normal play view; 2 Hz warn blinks limited to the single active element.
- rainbow-3 finale "white light": NOT a lit plane — a **≤ 0.4 m** luminous leading edge (≤ 6× scene) with a HOT thread, atop a dark volumetric smoke-gradient body (≤ 1.5× scene).
- Gate: dark-adapted screenshot review at ≥ 3 checkpoints per stage.

---

## 4 · Trap A — PRISM GATE

- **kind:** `'prismgate'` · **file:** `runtime/hazards/prismgate.js`, exporting `prismgate(def, ctx)` returning `{mesh, colliders:[], kills, update(t,dt), reset(t), dispose}` per the Hazard shape `makeHazard` normalises.
- **Registration:** `runtime/hazards/index.js` → `HAZARDS.prismgate` (KIND_ROUTE derivation routes it automatically); `HAZARD_META { label:'Prism Gate', killer:true, solid:false, telegraph:true }`.

**Data schema (defaults in parentheses):**
```
{ kind:'prismgate',
  p:[x,y,z],            // wall centre
  s:[d,h,w],            // lattice span; d ≤ 0.5, plane faces ±X
  period:Number,        // MUST equal seq.length * (dwell + travel) — validator enforces to 1e-6
  seq:[0..6, ...],      // band index = hue AND slot position (0=red=leftmost/lowest … 6=violet)
  slots:'z'|'y' ('z'),
  dwell:Number (2.4),   // s the window holds open
  travel:Number (0.5),  // s the aperture slides between stops
  window:{w (1.6), h (2.2)},
  phase:0..1 (0),
  relay:{group:String, index:int}?  // optional relay-chain membership
}
```
- **REQUIRED** entry: `{ p:'vec3', s:'vec3', period:'number' }` — `seq` MUST be validated in **SEMANTIC**, because REQUIRED's `object` check rejects arrays (verified `index.js:381,402` — graft J1-5).
- **SEMANTIC:** `dwell>0`; `travel>0`; `seq` non-empty, every entry an integer 0..6; `window.w ≥ 1.6` and `window.h ≥ 2.2` hard-failed (player h 1.8, r 0.35 — crouch never silently required); slot pitch ≤ 3.2 m per ≥ 0.5 s travel (aperture speed ≤ 6.4 m/s < run 8.6 — the window is always chaseable); `period == seq.length*(dwell+travel)`; relay law in §6.

**update(t) maths** (pure in the stage clock, no colliders, no randomness):
```
u = ((t / period) + phase) mod 1
k = floor(u * seq.length)                       // current stop
f = u * seq.length - k                          // 0..1 within this stop
tf = travel / (dwell + travel)
slot(b) = -(span - window.w)/2 + b * (span - window.w)/6   // span = s[2] ('z') or s[1] ('y')
centre  = f < tf ? lerp(slot(seq[(k-1+n) mod n]), slot(seq[k]), smoothstep(f/tf))
                 : slot(seq[k])                 // holding dwell
```
**Kill shape:** four AABBs tiling the lattice plane around the aperture, recomputed each `update`, registered via `hz.kills`; thickness `s[0]`. For the house gate `s=[0.4, 4.0, 12.0]`, `window 1.6×2.2` at centre offset `c`: LEFT `z ∈ [−6.0, c−0.8]`, RIGHT `z ∈ [c+0.8, +6.0]`, ABOVE `y ∈ [p.y−2.0+2.2, p.y+2.0]` over `z ∈ [c−0.8, c+0.8]`, BELOW zero-height when the window sits on the deck. The aperture interior contributes nothing — a true pass-through. `colliders:[]` (solid:false): a failed read is a death, never a wall-bonk ambiguity.

**Readability channels (law 6 — complete without colour):** ① lattice hue = current stop, and spectral order IS slot order; ② travelling IVORY chevron frame on the aperture (shape+position); ③ each slot column carries **N+1 embossed GOLD pips** = slot index (graft J1-3 — zero-hue, zero-motion, countable at distance) and brightens 0.8 s before the window slides there; ④ every lethal filament carries a **HOT `0xff1044` core**; ⑤ tick SFX per slide; ⑥ a **metronome tower** per gate court shows the clock as POSITION — a light climbing notches (graft J1-6).

**Counterplay:** all-phase-safe staging deck per gate (watch one full `seq` ≤ one period, enter on a dwell); dwell tiers 2.4 s teaching / 1.6 s mid / 1.2 s finale relays; the window is slower than you — chase it or wait in the pre-telegraphed next slot; visible flank bailout ledge on every gate over void; gates at most one leg past a checkpoint.

**Staging plan:** taught in isolation twice in rainbow-1 I; vertical (`slots:'y'`) grammar taught rainbow-1 IV; relays from rainbow-1 V; belt-into-gate rainbow-2 ORANGE; 7-stop relay finale rainbow-3 V.

**Live-probe acceptance (ship gate):**
- **Control (must die):** a body standing in the lattice plane 1.0 m off-aperture, held one full period → dead within the first window.
- **Pass (must survive):** a body standing in the aperture through a full 2.4 s dwell → alive; PLUS a scripted run riding the window through a 3-gate relay (§6 overlap law) → alive.

---

## 5 · Trap B — COLOUR BLOOM (with grafted HIGH ring class)

- **kind:** `'bloom'` · **file:** `runtime/hazards/bloom.js`, exporting `bloom(def, ctx)`, same Hazard shape.
- **Registration:** `HAZARDS.bloom`; `HAZARD_META { label:'Colour Bloom', killer:true, solid:false, telegraph:true }`.

**Data schema (defaults in parentheses):**
```
{ kind:'bloom',
  p:[x,y,z],            // emitter centre on the deck
  rmax:Number,          // m
  period:Number,        // s
  band:0..6,            // hue AND speed class in one field
  ring:'low'|'high' ('low'),   // GRAFT J1-1 / J2-2: the jump/duck dual grammar
  ringH:Number (1.0, low only, ≤ 1.1 hard-failed),
  ringW:Number (0.5),
  gaps:[{fromDeg,toDeg}] ([]), // authored shadow sectors behind cover
  quiet:Number (1.2),   // s dark tail after the ring dies (teaching beats use 2.0)
  phase:0..1 (0)
}
```
**Speed table — game-wide LAW, lives in bloom.js as `SPEED_BY_BAND`, monotonic non-increasing with band (graft J2-3), validator refuses any override:** red/orange **6.0 m/s** · yellow/green **4.2** · blue/indigo/violet **3.0**.

- **REQUIRED:** `{ p:'vec3', rmax:'number', period:'number' }`.
- **SEMANTIC (units bug FIXED — both judges):** `band` integer 0..6; `ring ∈ {'low','high'}`; low: `ringH ≤ 1.1` hard-failed (the jump guarantee); **`period ≥ rmax / SPEED_BY_BAND[band] + quiet`** (all seconds — one emitter never stacks two live rings); **`rmax / SPEED_BY_BAND[band] ≥ 0.74 s`** (= 1.2× the 0.615 s airtime, design 0's invariant, graft J2-2); `gaps` sectors within 0..360 and non-inverted; **high rings only on continuous deck runs** — the staging pass rejects a high-ring emitter whose `rmax` circle crosses a gap the route jumps.

**update(t) maths:** `tau = ((t/period) + phase) mod 1; r = SPEED_BY_BAND[band] * tau * period` while `r ≤ rmax`, else dormant. Emitter "inhales" (dims) through the last 0.6 s before each pulse, with a **pitched tick at T−0.4 s** (graft J1-1) — pitch rises with band, timbre differs by ring class.

**Kill shape** (sphere kills are engine-native — pendulum precedent): `n = clamp(ceil(2π·r / 1.2), 12, 64)` spheres re-spaced around the circumference each update — circumference-scaled, so no phantom gaps at any radius (design 0's fixed-16 bug, avoided).
- **LOW ring:** sphere radius `max(ringW·0.6, ringH·0.5)`, centres at deck + ringH/2. Band top ≤ 1.1 m vs full-hold apex 2.09 → **≥ 0.9 m jump margin**; an airborne player above ringH is never clipped — "a metronome, not a wall".
- **HIGH ring (grafted, fixed numbers, no override):** band bottom **1.25 m**, top **2.75 m** → spheres radius **0.75** centred at deck + **2.00 m**. Crouch 1.05 clears under with 0.20 m margin; band top 2.75 > apex 2.09, so **jumping over is structurally impossible** — the read is load-bearing, the margin generous.
- `gaps` sectors spawn no kill spheres; the light visibly breaks around cover.

**Readability channels:** ① band hue = speed class at any distance; ② **silhouette** — a low ring visibly touches the floor, a high ring visibly hangs with daylight beneath (full read for colourblind players); ③ **chevron studs pointing UP** on low rings (= jump), **pennant fins hanging DOWN** on high rings (= duck) (graft J1-1); ④ **N+1 GOLD pips** on the emitter housing = speed class (graft J1-3); ⑤ HOT `0xff1044` thread on every leading edge; ⑥ concentric etched distance rings every 2 m around each emitter, upgraded with a **floor sundial** — etched tick-ring with one lit crawler per emitter showing ring position even when occluded (graft J2-3); ⑦ inhale-flash 0.6 s + T−0.4 s tick; ⑧ outward-panning whoosh. Emitters only on decks ≥ 2.4 m wide — the ring passes any point in ~0.1 s and always vacates (law 2: timing wave, never an occupancy sweep).

**Counterplay:** LOW — jump the edge as it arrives (~0.6 s airborne vs ~0.1 s pass); HIGH — pre-position and hold crouch; or stand in a gap sector behind cover. Paired emitters always phase-offset on ONE shared clock, so a clockOffset respawn reruns the exact rhythm.

**Staging plan:** rainbow-1 II teaches LOW in isolation (blue, 3.0 m/s, quiet 2.0); rainbow-1 IV teaches HIGH on the breather deck; rainbow-2 RED introduces the 6.0 m/s class by GOLD sign; mixed classes from rainbow-2 GREEN; Moire pocket corridor rainbow-2 VIOLET; full remix rainbow-3.

**Live-probe acceptance (ship gate):**
- **Controls (must die):** grounded body at mid-radius on a LOW ring's path → dead at ring arrival. Standing (h 1.8) body on a HIGH ring's path → dead. Full-hold **jumping** body at a HIGH ring (feet at apex 2.09, body spanning into the 1.25–2.75 band) → dead — proves the no-cheese bound.
- **Passes (must survive):** body airborne at LOW-ring arrival → alive. **Crouched** (1.05) body under a HIGH ring → alive. Body inside an authored `gaps` sector, grounded, full period → alive.
- `axecheck` N/A by shape; `respawncheck` still sweeps every checkpoint against every emitter's `rmax`.

---

## 6 · Shared validator laws (new, live in `hazards/index.js` SEMANTIC + the staging pass)

1. **Rational superperiod (graft J1-4):** all periodic emitters sharing one space (a relay group, a bloom pair, a gate court) must have periods whose composite pattern repeats within **≤ 16 s** (LCM check); validator WARNS otherwise — compound rhythms stay learnable from one observation at the staging deck.
2. **Relay spill (graft J2-4):** consecutive gates in a `relay.group` share `period`, and gate *i+1*'s dwell at the handoff stop must open **≥ 0.4 s before** gate *i*'s closes — data-level `dwellOverlap ≥ 0.4`, validator-enforced, so riding the window through a relay is guaranteed walkable, never hand-tuned.
3. **Monotonic speed law (graft J2-3):** `SPEED_BY_BAND` is the single game-wide table; any stage data that implies a different band→speed mapping is refused.
4. **Warn-is-still-solid** stays the vanish-cycle convention everywhere it appears (refuge tiles are `cycle` or solid, never crumble — contract law 3).

---

## 7 · Stage briefs

### rainbow-1 — FIRST LIGHT · 300 m · 9 checkpoints · difficulty 10 · par 150 s

**Movements** (design 2, with grafted teaching furniture):
- **I THE OPAL CAUSEWAY (x 0–60):** arrival above the cloud sea; house three-jump warm-up (1.3 flat / 3.4 at +0.9 off-axis / 3.3 flat). First **prismgate** in total isolation: 3-stop seq, dwell 2.4 s, all-phase-safe staging deck, flank bailout visible. Second gate: 5 stops, dwell 2.0 s.
- **II THE BLOOM GARDEN (60–130):** first **LOW bloom** alone — blue (3.0 m/s) on a wide etched disc with sundial, quiet 2.0 s; then bloom on ice (momentum vs timing); then two emitters half-phase offset, one shared clock; coin on a satellite disc requiring both rings crossed out of phase.
- **III SPLIT LANES (130–200):** gates sight-readable from spectrum order; movers threading apertures on the shared clock; vanish steps under a gate — every refuge `cycle` or solid. **FORCED-PAUSE ISLAND (graft J1-1/J2-7):** the only forward tile is a cycle-vanish tile whose warn window overlaps the gate's dwell — the player must stand ON the blinking tile to make the window. GOLD sign: `BLINKING IS STILL SOLID`.
- **IV THE LANDING (200–250):** breather + coin; **HIGH bloom taught here** on the breather deck (blue, 3.0 m/s, deck 4 m wide, GOLD sign below); then the wind shaft with a `slots:'y'` gate — the aperture climbs one slot per stop.
- **V THE REFRACTION HALL (250–300):** set piece.

**Checkpoint table** (all pre-spike; clockOffsets rising per law 4 — integers in seconds, build lane may nudge ±one beat to align dwells but must keep them strictly rising):

| cp | x (m) | fronts | clockOffset |
|---|---|---|---|
| 0 | 0 | spawn | 0 |
| 1 | 30 | gate 1 staging deck | 6 |
| 2 | 62 | Bloom Garden entry | 13 |
| 3 | 92 | offset bloom pair | 21 |
| 4 | 130 | Split Lanes entry | 30 |
| 5 | 166 | vanish-under-gate + pause island | 40 |
| 6 | 200 | Landing / high-bloom teach | 51 |
| 7 | 228 | wind shaft (`slots:'y'` gate) | 63 |
| 8 | 250 | Refraction Hall entry | 76 |

**Hazard mix** (~30 dynamic, 8 families; ~90 objects total — over the ≥45/≥150 m/≥4 cp/≥8-from-≥4 floor): prismgate 5 (2 teaching) · bloom 5 (4 low incl. 2 teaching, 1 high teaching) · vanish 6 · mover 5 · ice 4 · wind 2 · laser 2 · jumppad 1.

**Set piece — THE REFRACTION HALL:** three prismgates in series on ONE shared clock (relay group, dwellOverlap 0.6 s, superperiod 12 s), apertures relayed so one unbroken line threads all three during consecutive dwells; smoked-glass walls make all three windows visible from the entry deck; full-length flank bailout ledge. CP8 immediately before entry.

**Signage (GOLD, text-on-post):** `THE WINDOW IS THE DOOR — WATCH ONE FULL PASS` (gate 1) · `COUNT THE PIPS` (gate 2) · `JUMP THE RIPPLE` (first bloom) · `BLINKING IS STILL SOLID` (pause island) · `LOW ROLLS — JUMP · HIGH HANGS — DUCK` (Landing) · glyph/pip legend at the metronome tower.

### rainbow-2 — THE SPLIT · 340 m · 10 checkpoints · difficulty 10 · par 178 s

**Structure:** white light enters a prism and the stage is the split — seven band terraces, each pairing ONE new trap with ONE legacy family ("your old alphabet, spoken in colour"). Every terrace entry is a staging deck with a GOLD sign naming the pairing.

- **RED (0–45):** fast LOW blooms (6.0 m/s — speed class named on the entry sign) + crushers on the same clock.
- **ORANGE (45–95):** foundry quote — conveyor feeding a prismgate, belt power 4.5 (half authority: refusing the ride is always possible); ride the belt INTO the window on its dwell.
- **YELLOW (95–140):** speedpads + a 7-stop gate with dwell tightening 2.0 → 1.6 s.
- **GREEN (140–185):** blooms with authored `gaps` — cover pillars cast visible shadows the ring breaks around; sticky tar between covers makes position a spend. First LOW+HIGH mix.
- **BLUE (185–235):** spire quote — ice arc in crosswind; `slots:'y'` gate riding an updraft.
- **INDIGO (235–285):** one LOW + one HIGH bloom bracketing three cross-route pendulums (law 1 blade `{w,h,d}` correct; law 2 cross-route; axecheck + staging map per blade).
- **VIOLET (285–340):** **THE MOIRE POCKET (graft J1-7)** — a 24 m corridor with counter-phased blue emitters (3.0 m/s, period 9 s, shared clock, half-phase offset) at both ends: the interleaved wavetrains leave one safe pocket ≥ 2.4 m wide drifting at ~1.4 m/s that the player rides the corridor's length (pocket kinematics proven by the live-probe script, below); then the set-piece bridge.

**Checkpoint table:**

| cp | x (m) | fronts | clockOffset |
|---|---|---|---|
| 0 | 0 | spawn / RED deck | 0 |
| 1 | 32 | RED crusher-bloom clock | 8 |
| 2 | 62 | ORANGE belt-into-gate | 17 |
| 3 | 95 | YELLOW entry | 27 |
| 4 | 126 | 7-stop gate | 38 |
| 5 | 158 | GREEN gap-sector field | 50 |
| 6 | 190 | BLUE ice arc | 63 |
| 7 | 224 | `slots:'y'` updraft gate | 77 |
| 8 | 256 | INDIGO pendulum bracket | 92 |
| 9 | 288 | Moire corridor + Double Rainbow | 108 |

**Hazard mix** (~41 dynamic, 10 families; ~100 objects): prismgate 7 · bloom 8 (5 low, 3 high) · pendulum 4 (all cross-route) · crusher 3 · conveyor 3 · ice 5 · wind 3 · vanish 4 · sticky 2 · speedpad 2.

**Set piece — THE DOUBLE RAINBOW:** twin arched bridge over open sky; counter-phased LOW emitters at both ends send rings toward each other while a prismgate stands at the apex; a crossing at pace is exactly two ring-jumps with the window's dwell arriving as you land the second (shared clock, superperiod 12 s). Coin: a catwalk slung UNDER the arch — below both rings, above nothing at all.

**Signage:** terrace-pairing sign at each entry (e.g. `RED — FAST LIGHT, SLOW IRON`), `THE BELT IS A CHOICE` (ORANGE), `THE POCKET WALKS — WALK WITH IT` (Moire).

### rainbow-3 — WHITE LIGHT · 405 m · 12 checkpoints · difficulty 10 · par 215 s

**The graduation exam** — five movements, one per world, each quoting a signature beat of that world's third stage on sight, each with a new-trap overlay; then the coda.

- **I NEON REMEMBERED (0–80):** rain-glass vanish steps (the shattering-stair quote) descending under a slow prismgate; lasers between steps.
- **II THE RISING TIDE (80–160):** foundry-3's flood — risinglava in a basin of island slabs while LOW blooms pulse across them; the tide sets the pace, the rings set the feet.
- **III THE SPIRE WIND (160–240):** ice arc over nothing in cross-shear wind; `slots:'y'` gate climbing an updraft; pendulums crossing the arc (axecheck + staging map per blade).
- **IV THE TEMPLE ENGINE (240–320):** rotor/saw machine deck, backward belt, double bloom (one LOW + one HIGH) on one clock — densest dressing in the stage and none of it lethal, so the four things that ARE lethal read instantly.
- **V THE SEVEN STAIR (320–390):** seven band steps to the spire; a 7-gate relay in series, one stop per band, dwell 1.2 s, dwellOverlap 0.4 s, the window climbing the stair with you while blooms pulse below — riding the window is the intended line, taught in rainbow-1 IV.
- **CODA (390–405):** THE WHITE GATE.

**Checkpoint table** (hard legs — movements IV/V — ≤ 30 m; both required sprints on 8 m+ runways):

| cp | x (m) | fronts | clockOffset |
|---|---|---|---|
| 0 | 0 | spawn | 0 |
| 1 | 40 | shattering stair | 7 |
| 2 | 80 | Rising Tide basin | 15 |
| 3 | 118 | mid-tide bloom islands | 24 |
| 4 | 160 | Spire Wind arc | 34 |
| 5 | 198 | updraft gate + pendulums | 45 |
| 6 | 240 | Temple Engine entry | 57 |
| 7 | 268 | backward belt | 70 |
| 8 | 294 | double-bloom clock | 84 |
| 9 | 320 | Seven Stair base | 99 |
| 10 | 350 | mid-relay landing | 115 |
| 11 | 378 | coda — pins the race; chase arms at x 384 | 132 |

**Hazard mix** (~56 dynamic, 17 kinds; ~115 objects — temple-3 finale scale): prismgate 8 · bloom 7 (4 low, 3 high) · vanish 8 · laser 5 · lasergrid 2 · risinglava 1 · crusher 3 · saw 2 · rotor 5 · pendulum 4 · ice 6 · wind 3 · mover 6 · conveyor 2 · jumppad 2 · speedpad 1 · chase 1 (Y-axis).

**Set piece — THE WHITE GATE:** a **Y-axis chase** per the temple-3 collapse doctrine (axis load-bearing: kill depth points DOWN into empty sky; footprint sized to the final spire only, so it is structurally incapable of touching a player still in movement IV at any clock value): a floor of white light rises out of the cloud sea at **1.6 m/s**, visible for its whole life, arming only past CP11, built to the §3 glare spec (≤ 0.4 m luminous leading edge + HOT thread on a dark volumetric body). The player climbs the spire through the final relay as it steps all seven stops — then holds the game's one WHITE window. It parks **0.8 m under the gate floor**, the one surface it never takes. Par meets the light on the climb; step through white into the VIOLET `0xd9b6ff` finish. White = all seven colours = all five worlds.

**Signage:** one per movement naming the quoted world (`NEON REMEMBERED`, …), `THE LIGHT CLIMBS — SO DO YOU` at CP11.

---

## 8 · Harness + ship gates

1. **`_harness/reachcheck.mjs:107-108`** — extend `HAZARD_KINDS` with **`'prismgate'`, `'bloom'`, AND the already-missing `'lasergrid'`, `'lasersweep'`** (verified absent this session; the temple-3 lag bug — grafts J1-2/J2-6). `LANDABLE` (line 105) is **unchanged**: neither new kind contributes standable surface (both `killer:true, solid:false`).
2. `hazards/index.js`: HAZARDS + HAZARD_META + REQUIRED + SEMANTIC entries per §4–6; KIND_ROUTE derivation routes both automatically — cannot be silently unreachable.
3. Both modules: `update(t,dt)`/`reset(t)` pure in the stage clock; no `Math.random()`; kills via `hz.kills` so `_placeBuilt` registers them.
4. **Ship gates (all must pass):** `modulecheck` (now 56+3/0) · `reachcheck` (now 19/0, three new stages) · `geomcheck` (includes the new hub plate/stair/arch) · `axecheck` PASSABLE + staging map for every pendulum (rainbow-2 INDIGO ×3, rainbow-3 III ×4) · `respawncheck all` 0 unprompted deaths (every checkpoint swept against gate lattices, bloom `rmax` circles, and the chase footprint) · **live probes §4/§5** including the Moire-pocket ride script (scripted walker in the pocket survives the full 24 m; a control walker 3 m behind the pocket dies) · dark-adapted screenshot review against the §3 numbers, ≥ 3 views per stage.

---

## 9 · Difficulty rationale (one paragraph, binding)

All three stages ship `difficulty: 10` — the engine clamp (verified `game.js:937`) means the curve past temple-3 lives in the design. rainbow-1 holds temple-3's mechanical ceiling while resetting cognitive load: both new verbs taught in strict isolation with staging decks, GOLD signs, the forced-pause island and flank ledges. rainbow-2 escalates by PAIRING (one new trap × one legacy family per terrace), never by tightening jumps beyond the envelope (flat safe 4.4 / sprint safe 6.4, sprints only on 8 m+ runways). rainbow-3 is the graduation exam — five sight-readable world quotes plus the game's only 7-gate relay — with the coda a Y-axis chase built to the collapse doctrine. Every death stays cheap: hard legs ≤ 30 m, every checkpoint pre-spike with a strictly rising `clockOffset` so every respawn is a rerun, never a lottery; every fairness claim above is enforced by a validator or a live probe, not asserted.

---

## 10 · Judge-concern resolution ledger

| Concern (judge) | Resolution |
|---|---|
| Winner's deg-220/225 dais collides with deg-224 slab, brackets the overlook climb, "top of the climb" false (J1, J2) | Placement replaced wholesale with the deg-45 diagonal plate (§2) — Judge 2's priority-1 graft; clears rails/newel/overlook with numbers shown |
| `facingOut(225)` right only by coincidence — pin the yaw (J1, J2) | Yaw pinned to the verified empirical convention: `yaw: Math.PI/4` = 45·D2R at deg 45; `facingIn`/`facingOut` explicitly banned for `portals[]` (§2) |
| Design 0's 3-step stair exceeded the 0.45 m auto-step (J1) | Stair respecified: three rises of exactly 0.45 m from the promenade to plate top 0.45 (§2) |
| Winner missed the HAZARD_KINDS harness extension (J1, J2) | §8-1, including lasergrid/lasersweep; LANDABLE untouched with the reason stated |
| Bloom SEMANTIC mixed metres and seconds (J1, J2) | Fixed: `period ≥ rmax/SPEED_BY_BAND[band] + quiet`, all seconds (§5) |
| Wall-sized filament lattices + rising white plane threaten glare law 5 (J1, J2) | Explicit numeric glare budget: ≤18 % lit gate face, ≤0.1 m filaments, ≤5 % screen trim, finale as ≤0.4 m edge on a dark body (§3) |
| Both traps are window-timing → clock-waiting risk (J2) | Bloom is a motion trap; window-riding is the intended expert line (aperture ≤ 6.4 m/s < run 8.6); Moire pocket ride and belt-into-gate keep the player moving (§7) |
| `seq` array vs REQUIRED's isObj (J1 graft 5) | `seq` validated in SEMANTIC; verified `index.js:381,402` this session (§4) |
| Fixed-16-sphere phantom gaps (design 0's flaw, both judges) | Bloom uses circumference-scaled `clamp(ceil(2πr/1.2),12,64)` counts (§5) |
| Relay walkability hand-tuned (J2 graft 4) | `dwellOverlap ≥ 0.4 s` validator law (§6-2) |
| Compound rhythms unlearnable (J1 graft 4) | ≤ 16 s superperiod validator warning (§6-1) |

File homes recap: `runtime/hazards/prismgate.js` · `runtime/hazards/bloom.js` · registrations in `runtime/hazards/index.js` · stages `runtime/data/stages/rainbow-{1,2,3}.js` · hub appends in `runtime/data/stages/hub.js` · theme in `runtime/world/themes.js` · unlock in `runtime/core/save.js:36` · copy in `runtime/boot.js:415`, `content.json`, `game_meta.json` · harness edit in `_harness/reachcheck.mjs:107-108`. Contract source: `C:\Users\TestRun\Claude Claw\forgeflow-games\games\ascendant\_spec\RAINBOW_CONTRACT.md`.