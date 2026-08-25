# BLACKRIDGE — Gunfeel + AI Combat Spec (v1)

The FEEL half of the CoD bar. Every constant here is a NUMBER a build agent can
implement without asking. Grounded in:

- `pipeline/knowledge/GAME_DOCTRINE.md` §2 (buffered inputs 0.35 s, bot fairness
  300–800 ms reaction + ~0.018 rad jitter, roll-once-and-latch, ≤2 attack tokens,
  every engagement ends), §3 (light pools, DPR 1.5), §5 (verification), §6 (shell).
- `pipeline/knowledge/reference_review_2026-07/adoption_plan.json` — Operation
  Ironhold fairness constants (fire-token director, muzzle-block raycast, 0.2 s ADS
  settle, 40% ADS speed penalty, 3 s breath hold) and Claude-of-Duty perf forensics.
- `games/last-circle/runtime/` — what already works (shared `effectiveSpread`
  crosshair-truth model, swept-segment ballistics with nearest-hit arbitration,
  recoil recover-accumulators, click-edge + 420 ms fire buffer, whiz-by cracks,
  utility-scored bot brains, HRTF positional audio, layered recorded+synth SFX)
  and what falls short of the CoD bar (flat 1.4x binary move spread → now graded;
  no slide/mantle-into-fire chain; sine-wobble aim error instead of a perception
  model; no cover scoring, no squads, no suppression, no barks; camera recoil
  absent because third-person — BLACKRIDGE is first-person, recoil IS the camera).

Sim conventions carry over unchanged (doctrine §4): THREE-free deterministic sim,
fixed dt = 1/60 s, one mulberry32 stream per system (`movement`, `weapons`,
`bots`, `fx`, `audio` each own a seed), view reads events only, every deferred
callback epoch-guarded. three.js via the same importmap as last-circle/driftwake
(`three@0.172.0` CDN pin — see `games/last-circle/index.html:20`).

Units: metres, seconds, degrees (° noted; 1° = 0.01745 rad). All "TTK" = time
from first hit landing to kill (N shots ⇒ (N−1) × shot interval).

---

## 1. MOVEMENT

Player and bots run the SAME movement code (last-circle rule — the brain writes
the input struct, nothing else).

### 1.1 Speeds (m/s)

| State                | Speed | Notes |
|----------------------|-------|-------|
| Walk forward         | 4.6   | strafe ×0.9 (4.14), backpedal ×0.76 (3.5) |
| Sprint               | 6.4   | forward only; input arc ±45°; weapon lowered |
| Tactical sprint      | 7.3   | double-tap W or second Shift press; max 4.0 s, then drops to sprint; 2.5 s recharge while not sprinting; weapon across chest |
| ADS walk             | 2.55  | walk × weapon `adsMoveMult` (§2); Ironhold's 40% ADS penalty band |
| Crouch walk          | 2.4   | |
| Slide (entry)        | 7.8   | see 1.4 |
| In-air (max)         | entry speed, no gain | |

No prone in v1. Reason: bot bodies are Meshy auto-rigs and last-circle's crouch
lesson holds — the hit capsule may only shrink to what the visible pose actually
does, and we have no prone clip; a prone player with a standing-height capsule
for bots to shoot at is a lie in the other direction. Cut, not deferred silently.

### 1.2 Acceleration / air control

- Ground accel: 28 m/s² toward wish velocity; decel (no input / reverse): 34 m/s²
  — counter-strafe stops in ~0.19 s from walk. Time to full walk ≈ 0.25 s,
  to full sprint ≈ 0.45 s (sprint ramps through walk first).
- Air: gravity −20 m/s²; jump velocity 6.6 m/s (apex 1.09 m); air accel
  8 m/s², air control factor 0.35 (steering only, never exceeds entry
  horizontal speed); coyote time 80 ms; jump input buffered 0.35 s (§1.8).
- Jump spread/handling penalty while airborne: §2.5 table.

### 1.3 Crouch

- Toggle or hold (setting; default hold on C, toggle on Ctrl).
- Stand↔crouch camera lerp: 140 ms, cubic ease.
- Capsule: standing 1.80 m / eye 1.62 m; crouched capsule 1.35 m / eye 1.10 m —
  and the BOT capsule only shrinks if the crouch clip actually plays on that
  body (last-circle `hasCrouchClip` guard, verbatim).
- Hip spread ×0.75 crouched.

### 1.4 Slide (the MW2019 signature verb)

- Trigger: crouch pressed while sprinting AND ground speed ≥ 5.8 AND on ground.
- Entry: velocity set to 7.8 m/s along current move direction (locked at entry;
  steering during slide ≤ 25°/s yaw influence on velocity).
- Friction curve: v(t) = 7.8 · e^(−t/0.55). Slide ends when v ≤ 2.6 m/s
  (~0.60 s) → stands into crouch. Min slide duration 0.30 s (early crouch
  release still plays 0.30 s).
- Slide-jump: jump during slide keeps 90% of current horizontal velocity;
  0.9 s slide cooldown starts on ANY slide end (prevents bunny-slide chains).
- Camera: eye drops to 0.90 m over 110 ms; FOV +4° over 120 ms, released over
  200 ms at slide end; camera roll 2.5° toward slide-lean side, recovering with
  the FOV. Can fire during slide (hip only, spread ×1.6); cannot ADS until
  0.15 s after slide ends.
- Downhill (support slope > 8°): decay τ stretches to 0.9 and end threshold
  drops to 2.0 m/s.

### 1.5 Mantle

- Detect: ledge top 0.75–1.35 m above feet, ≤ 0.85 m ahead, ≥ 0.6 m clearance
  above ledge; triggered by jump held/pressed against the wall (buffered 0.35 s)
  or automatically when airborne toward the ledge.
- Duration: 380 ms for ledges ≤ 1.0 m ("vault"), 500 ms above ("clamber").
  Weapon lowered; no fire during; fire input buffered and released on completion
  + weapon raise 150 ms (so mantle-into-shot is one fluid chain).
- Camera: 6 cm dip at grab, pull-over ease-in-out; no roll.
- Same collider test the bullets use (shared sim colliders — never a second
  geometry list; last-circle's LOS/bullet divergence lesson).

### 1.6 Head-bob

Viewmodel-heavy, camera-light (motion-sickness discipline — the camera gets 30%
of the amplitude, the viewmodel the rest):

| State  | Vertical amp (camera) | Freq    | Lateral amp | Extra |
|--------|----------------------|---------|-------------|-------|
| Walk   | 0.48 cm              | 2.1 Hz  | 0.27 cm @ 1.05 Hz | — |
| Sprint | 0.84 cm              | 2.6 Hz  | 0.42 cm @ 1.3 Hz  | camera roll ±0.4° @ 1.3 Hz |
| Tac sprint | 1.0 cm           | 2.9 Hz  | 0.5 cm      | viewmodel pumps across chest |
| Crouch | 0.30 cm              | 1.5 Hz  | 0.18 cm     | — |
| ADS    | ×0.25 of state above | —       | —           | breath sway instead (§2.6) |

Viewmodel bob = camera numbers ×2.3, phase-locked to footstep events (a step
SOUND lands on a bob TROUGH — audio/visual lockstep sells weight).
Settings: bob slider 0–100% (default 100), applies to camera share only.

### 1.7 Landing dip

- Fall height ≥ 1.5 m: camera down 4 cm over 90 ms, recover 220 ms cubic-out.
- Fall ≥ 4.0 m: 9 cm over 120 ms, recover 320 ms; landing thud SFX; hip spread
  ×1.35 for 0.4 s. No fall damage in v1 (map has no lethal drops; revisit if
  level design adds them).

### 1.8 Input buffering + sprint-out (doctrine §2: buffer 0.35 s)

ALL verb inputs (fire edge, reload, weapon switch, jump, slide/crouch, mantle)
are BUFFERED 0.35 s and fire on the first valid tick. Last-circle's 420 ms
fire-edge buffer proved the pattern; generalize it to every verb.

Sprint-out time (sprint release or fire press → first shot possible):

| Weapon  | Sprint-out | Tac-sprint-out |
|---------|-----------|----------------|
| SMG     | 160 ms    | 240 ms |
| Pistol  | 130 ms    | 195 ms |
| AR      | 210 ms    | 315 ms |
| DMR     | 290 ms    | 435 ms |

Fire pressed during sprint buffers and releases the shot the frame sprint-out
elapses. Fire-to-sprint lockout: 0.25 s after last shot before sprint engages.
ADS from sprint: sprint-out then ADS-in run CONCURRENTLY (max of the two, not
the sum) — this is the MW feel; sequential gating reads sluggish.

---

## 2. WEAPONS

Four originals. NO real-gun or CoD names. Damage model: 100 HP, no armor, CoD
regen (§6). Head/body zones only (no limb table v1): head = top 14% of capsule
AND within 0.20 m of capsule axis — last-circle's calibrated head band, verbatim
(the full-width head disc paid 2.5× on shoulder grazes; keep the fix).

### 2.1 Core table

| | **M-72 "Warden"** (AR) | **KS-23 "Vesper"** (SMG) | **LR-1 "Corvus"** (DMR) | **GS-9 "Pike"** (pistol) |
|---|---|---|---|---|
| Fire mode | full auto | full auto | semi | semi |
| RPM | 750 | 900 | 257 (233 ms min interval, click-buffered) | 380 |
| Damage (near) | 28 | 25 | 60 | 30 |
| Damage (far floor) | 22 | 17 | 48 | 19 |
| Falloff start→end (m) | 32→58 | 14→32 | 45→90 | 12→26 |
| Head multiplier | 1.40 | 1.35 | 1.65 | 1.80 |
| Mag / reserve | 30 / 120 | 32 / 128 | 15 / 60 | 12 / 48 |
| Reload tactical / empty (s) | 2.1 / 2.6 | 1.8 / 2.3 | 2.4 / 3.0 | 1.5 / 1.9 |
| ADS time (ms) | 250 | 205 | 340 | 180 |
| ADS FOV (base 74° vert) | 55° (1.35×) | 58° (1.28×) | 34° (2.2×, scope overlay) | 60° (1.23×) |
| adsMoveMult (× walk) | 0.55 | 0.62 | 0.42 | 0.70 |
| Hip spread base (half-angle) | 2.4° | 2.0° | 4.5° | 1.8° |
| Raise / holster (s) | 0.45 / 0.30 | 0.40 / 0.28 | 0.55 / 0.35 | 0.30 / 0.22 |
| Muzzle velocity (§3) | 700 m/s | 999 ("hitscan") | 850 m/s | 999 ("hitscan") |

TTK verification (body, 100 HP — the CoD 150–400 ms band):

- Warden near: 4 shots → 3 × 80 ms = **240 ms**; far: 5 shots → **320 ms**. ✔
- Vesper near: 4 shots → 3 × 66.7 ms = **200 ms**; far: 6 shots → **333 ms**. ✔
- Corvus near: 2 shots → **233 ms**; far: 3 shots → 466 ms (marksman rifle past
  90 m — outside its effective range, accepted). Head+body near: still 2-shot
  (99+60) — deliberately NOT a 1-shot headshot (no-frustration rule; the 105-dmg
  one-tap was last-circle's most-audited weapon). ✔
- Pike near: 4 shots → 3 × 158 ms = **474 ms** — sidearm exemption, documented:
  its job is the 2-headshot skill line (54 × 2 = 108 → **158 ms**), not the band.

Role ladder: Vesper wins ≤ 14 m, Warden owns 15–58 m, Corvus owns 45 m+,
Pike is the fast-swap finisher (swap 0.30 s raise beats any reload).

### 2.2 Reload mechanics

- Tactical (round chambered, mag retained) vs empty (adds bolt/slide rack) —
  the two times in the table. The sim emits `reloadStart{empty}` /
  `reloadDone`; animation MUST span exactly `reloadS` (last-circle's sniper
  dead-hand lesson — no motionless gun inside the window).
- Reload-cancel: sprint, weapon switch, or slide cancels reload BEFORE the
  ammo-commit point; after it, the mag count is already written. Commit point =
  65% through the timer (mag seats). Cancel restores the pre-reload mag.
- Auto-reload on dry fire if reserve > 0 (0.25 s dry-click first). Dry click
  SFX + magazine HUD flash.
- Ammo pickup from dead bots: +1 mag of that class, walkover.

### 2.3 Recoil — per-shot kick vector tables

First-person: recoil IS the camera (aim and camera are one ray — last-circle's
"camera-pitch kick = second aim recoil" warning applies only to third-person;
here the kick drives aim, exactly one recoil).

Mechanic: on each shot, add (pitch°, yaw°) from the weapon's pattern table
(index = shots fired in this continuous burst; loop the tail segment) to the aim
AND to a recover-accumulator. Recovery: starting 80 ms after the last shot,
recenter the accumulated kick at 12°/s until 100% of the UNCOMPENSATED remainder
is returned (player mouse-pulldown reduces the accumulator — subtract mouse
delta-down from it first, never over-return; last-circle's accumulator pattern).
ADS recoil = table × 1.0; hip recoil = table × 0.85 (hip pays in spread, not kick).

**Warden (AR)** — learnable climb-then-right-drift, loop 17–20:

| Shot # | pitch° | yaw° |
|---|---|---|
| 1 | 0.55 | +0.02 |
| 2 | 0.40 | −0.03 |
| 3 | 0.38 | +0.05 |
| 4 | 0.34 | +0.08 |
| 5 | 0.30 | +0.10 |
| 6 | 0.28 | +0.12 |
| 7 | 0.26 | +0.10 |
| 8 | 0.25 | −0.06 |
| 9 | 0.24 | −0.10 |
| 10 | 0.24 | −0.12 |
| 11 | 0.23 | −0.08 |
| 12 | 0.23 | +0.06 |
| 13–16 | 0.22 | alternate ±0.09 |
| 17–30 | 0.21 | loop [+0.08, +0.04, −0.05, −0.09] |

30-round full-auto total uncompensated climb ≈ 7.5° — heavy enough to demand
pulldown, patterned enough to learn. Per-shot random jitter ±12% on both axes
(from the `weapons` rng stream, so probes are deterministic per seed).

> **Amendment 2026-08-25 (first-shot signature).** Measured live
> (`_harness/recoilfeel.py`): the shipped tables reproduced exactly, but the
> first-shot kick was only +5% (Warden 0.42 vs 0.40) / +8% (Vesper 0.26 vs
> 0.24) over the followups — below the genre standard's "first-shot kick
> noticeably larger than followups". Row 1 pitch raised: Warden 0.42 → 0.55
> (1.38× shot 2), Vesper 0.26 → 0.34 (1.42× shot 2). Corvus/Pike unchanged —
> semi-autos fully settle between shots (measured), so every shot already IS
> the full punch. The earlier prose here claimed ≈8.1° full-mag climb; the
> table itself sums to 7.39° (live-verified) — prose corrected to the table,
> now ≈7.5° with the new row 1. TTK, jitter, recovery, hip ×0.85 untouched.

**Vesper (SMG)** — fast, low, buzzy; loop 9–12:

| Shot # | pitch° | yaw° |
|---|---|---|
| 1 | 0.34 | +0.03 |
| 2 | 0.24 | −0.04 |
| 3 | 0.22 | +0.06 |
| 4 | 0.20 | +0.08 |
| 5 | 0.19 | −0.07 |
| 6 | 0.18 | −0.09 |
| 7 | 0.18 | +0.07 |
| 8 | 0.17 | +0.05 |
| 9–32 | 0.16 | loop [+0.07, −0.06, −0.08, +0.06] |

Jitter ±18% (buzzier than the AR by design).

**Corvus (DMR)** — one big honest kick per shot:
pitch 1.9° + yaw ±0.25° (roll once per shot), recovery 14°/s starting 60 ms
after the shot; viewmodel kick 9.5 (last-circle vmKick scale — reads as the
action cycling through the 233 ms interval). Jitter ±10%.

**Pike (pistol)**: pitch 0.85°, yaw ±0.15°, recovery 12°/s. Jitter ±15%.

Viewmodel punch (visual, on top of camera kick — the 5 cm barrel-axis slide,
last-circle scale): Warden 0.75, Vesper 0.5, Corvus 1.9, Pike 0.7; decay 6/s.

### 2.4 ADS model

- ADS-in eases the FOV with smoothstep over `adsTimeMs`; the accuracy state
  flips when progress ≥ 1.0 — spread bonus, scope overlay, and FOV all gate on
  the SAME progress value (COMBAT_CALIBRATION's visual/mechanical-agreement
  rule; never two timelines).
- ADS accuracy: Warden/Vesper/Pike at full ADS have spread 0° — the recoil
  pattern is the only deviation (CoD model). Corvus at full ADS: sway (§2.6).
- Partial ADS (mid-lerp) fires at hip spread × (1 − 0.8 × progress).
- ADS settle: after ADS completes, 0.2 s of residual settle sway amp ×2 → ×1
  (Ironhold's 0.2 s settle — quickscoping pays a small tax without a hard gate).
- ADS sensitivity: monitor-distance coefficient 1.0 (zoom-proportional), no
  separate slider in v1.
- Aim assist: **OFF. Mouse only. No magnetism, no friction, no bullet bend.**
  Stated here so nobody "helpfully" adds it.

### 2.5 Hip spread state model (shared crosshair-truth function)

ONE function `effectiveSpread(weaponId, state)` used by firing AND the
crosshair (last-circle's hardest-won lesson — the reticle must draw the number
the bullets use):

```
spread = base                           (per-weapon, §2.1)
       × (ads ? (1 − 0.8·adsProgress) : 1)      → 0.2× mid-lerp … 0 at full ADS (except Corvus)
       × (1 + min(0.65, speed_mps × 0.06))      → walk +27.6%, sprint +38.4% (graded, never binary)
       × (airborne ? 1.9 : 1)
       × (sliding ? 1.6 : 1)
       × (crouched ? 0.75 : 1)
       × (stationary ≥0.4s AND no shot ≥0.45s ? 0.55 : 1)   → steady-aim bonus (NOT last-circle's 0.15 laser)
       × (0.4s after ≥4m landing ? 1.35 : 1)
```

Shots sample uniformly inside the cone (per-pellet rng from `weapons` stream).

### 2.6 Sway (idle vs moving) + breath hold

- Hip/lowered: none (bob covers it).
- ADS Warden/Vesper/Pike: layered-sine drift, amp 0.030° / 0.022° / 0.026°,
  base freqs 0.9 + 1.7 Hz (two incommensurate sines per axis, last-circle
  pattern, applied DIFFERENTIALLY so it never displaces the mouse aim).
- ADS moving: amp ×2.2.
- Corvus ADS: amp 0.05° idle, ×2.5 moving. **Hold breath**: Shift while scoped
  → amp ×0.06 for up to 4.5 s meter; release/empty → refill 1.8 s; running the
  meter dry = WINDED, amp ×1.7 until refilled past 50% (last-circle
  breath/winded state machine, retuned).

### 2.7 Viewmodel

- Viewmodel FOV: 60° (independent of world FOV; world default 74° vertical,
  settings 60–90).
- Weapon drag/lag: viewmodel position lags camera translation with τ = 45 ms
  (max offset 3.2 cm), rotation lags with τ = 65 ms (max 4°) — the MW "weapon
  has mass" read.
- Weapons are Meshy/staged GLBs per doctrine §7 (no primitive hero assets —
  last-circle's composed-box AR/SMG are explicitly BELOW the bar; the asset
  spec owns generation; this spec owns motion).

### 2.8 First-shot audio-visual signature

The first round of every burst (≥ 0.5 s since last shot) gets:
- Muzzle flash scale ×1.2, flash light intensity ×1.25 (§4.2).
- Mechanical layer +2 dB and 15% longer action transient (§7.1).
- One full tracer even on non-tracer rounds.
This is the "first shot pop" that makes semi-auto and burst discipline feel
authored rather than sampled.

---

## 3. BALLISTICS

### 3.1 Hitscan vs projectile

Last-circle architecture verbatim: everything is a projectile stepped in
sub-segments (cap 2.5 m/sub-step) with swept segment-vs-collider tests and
nearest-hit arbitration (world solved FIRST, nearest actor candidate, nearer
wins — the through-cover bug class stays dead). "Hitscan" = speed 999 m/s.

| Weapon | Speed | Why |
|---|---|---|
| Vesper, Pike | 999 ("hitscan") | CQB weapons; travel time would read as lag under 32 m |
| Warden | 700 m/s | 58 m max effective → 83 ms flight; barely-there lead at range, free authenticity |
| Corvus | 850 m/s | 90 m → 106 ms; rewards leading movers, sells the marksman fantasy |

Tracers rendered for ALL weapons regardless: 1-in-2 rounds for Warden/Vesper,
every round for Corvus/Pike; cosmetic tracer speed cap 300 m/s (visible streak,
last-circle rule); tracer = stretched instanced particle, warm white 0xffd9a0.

### 3.2 Penetration (thin cover)

Material classes tagged on colliders (`matClass`): `soft` (drywall, planks,
sheet-metal fence ≤ 0.15 m), `metal_thin` (car doors, lockers ≤ 0.10 m),
`hard` (concrete, brick, engine blocks, ground — never penetrable).

| Weapon | Penetrates | Damage retained | Max thickness |
|---|---|---|---|
| Warden | soft, metal_thin | 0.70 | 0.25 m |
| Vesper | soft only | 0.45 | 0.15 m |
| Corvus | soft, metal_thin | 0.85 | 0.40 m |
| Pike | none | — | — |

One penetration event max per bullet. Exit spawns impact FX on BOTH faces
(entry + exit, offset along the ray). Spread adds +0.8° deviation after
penetration. Bots respect the same table via the shared trace (and their
muzzle-block check, §5.7, uses `hard` only — they MAY shoot you through soft
cover they saw you duck behind: authored wallbang moments, capped by the
fairness rule that they must have confirmed you ≤ 1.5 s ago).

### 3.3 Falloff

Linear lerp from near damage at `falloff[0]` to far damage at `falloff[1]`,
flat beyond (table §2.1) — same shape as last-circle `hitDamage`, but the floor
is the far VALUE, not a 0.4 ratio (keeps the TTK table exact).

### 3.4 Flinch (being hit)

- Player hit: view kick pitch 0.12° per 10 damage taken (max 0.5° per event),
  random yaw ±40% of the pitch; recover with the normal recoil recovery.
  Deliberately LOW (MW-style — getting shot should not remove aim agency).
- Bots hit: aim-error injection +0.8° for 0.35 s per hit taken (suppression
  counterplay: shooting first makes their return fire worse; stacks cap 2×).

---

## 4. HIT FEEDBACK CHAIN (every link specified)

Latency budget for the whole chain: impact event → all feedback ≤ 1 frame.

### 4.1 Hitmarker

- Visual: 4 white ticks at 45° (arm length 7 px, gap 5 px from center, 2 px
  stroke, 90% opacity), spawn at scale 1.15 → 1.0 over 60 ms, hold, gone by
  220 ms. New hits retrigger (no stacking alpha).
- Headshot variant: ticks +20% length, small top-notch accent.
- Kill variant: red (#ff3b30), scale 1.35 → 1.0, lives 320 ms.
- Audio: hit tick = 2.4 kHz band-limited click, 30 ms, −14 dB under SFX bus;
  headshot 3.1 kHz; kill = layered 700 Hz thock + the tick (the "kill thunk"),
  −8 dB. These are UI-bus sounds — never positional, never reverbed.

### 4.2 Impact FX per surface (`impact` event carries surface + face normal)

| Surface | Particles | Decal | SFX key |
|---|---|---|---|
| flesh | 8 dark-red 0.06 m puffs, 0.35 s, gravity −4 | none | imp_flesh (wet thap) |
| concrete/brick | 6 gray chips + 1 dust puff 0.25 m, 0.5 s | 64-pool bullet-hole, 18 s fade | imp_stone |
| metal | 5 spark streaks (stretch 3×), 0.3 s + ring | scorch dot | imp_metal (ring 2.8 kHz) |
| wood | 7 splinters, 0.45 s | hole | imp_wood |
| dirt/grass | 1 puff 0.35 m + 4 clods, 0.6 s | none | imp_dirt |
| glass | shatter: pane swap to broken mesh + 12 shards | — | imp_glass |

Muzzle flash: sprite cross + pooled point light (doctrine §3 — FIXED pool,
visible:true intensity 0, NEVER add/remove): pool of 3 flash lights, granted to
player + 2 nearest on-screen shooters; intensity 0→18→0 over 55 ms, range 9 m,
color 0xffc27a. Everyone else: sprite only. Night map: flashes are information
— bots and players both reveal on fire (§5.2).

Blood: puffs only, no decals/pools/gore (portal rating).

### 4.3 Damage direction indicator

Arc segment at 48 px radius from screen center, 70° wide, centered on attacker
azimuth (screen-relative, live-updating for 200 ms then frozen), red at 85%
opacity → 0 over 600 ms. Max 4 concurrent (oldest evicted). Plus a 1-frame
directional vignette bias (the red creeps 12% further in from the hit side).

### 4.4 Kill confirmation

- Kill hitmarker + thunk (§4.1).
- Banner center-lower: "⨯ ELIMINATED — <name>" 1.4 s, small caps, no XP spam.
- Kill feed top-right (killer ▸ weapon icon ▸ victim), 4 rows, 6 s TTL —
  ALWAYS display-names via the weapon-name map, never internal ids
  (last-circle's "killed by glauncher" lesson).
- Last-squad-member kill triggers a music stinger (§7.5).

### 4.5 Screen shake budget (restraint = AAA)

TOTAL concurrent shake is clamped to 1.2° amplitude, roll component ≤ 0.5°.
The COMPLETE list of allowed sources — nothing else may shake, ever:

| Source | Amp | Duration | Falloff |
|---|---|---|---|
| Own shots | **0** — recoil IS the kick; adding shake double-punishes aim | — | — |
| Explosion | 0.8° at ≤ 6 m | 300 ms decay | linear to 0 at 18 m |
| Taking a hit | flinch (§3.4), not shake | — | — |
| Grenade bounce nearby | 0 (audio cue only) | — | — |
| Landing ≥ 4 m | camera dip (§1.7), not shake | — | — |

### 4.6 Crosshair states

- Hip: 4-line cross with gap px = tan(spread°) / tan(vFOV/2) × (screenH/2) —
  the LIVE `effectiveSpread` output, one shared model (§2.5). Expands and
  contracts continuously; no fake bloom animation.
- ADS: crosshair hidden; the weapon's sights are the reticle (Corvus: scope
  overlay with fine cross, sway-driven).
- Hit/kill markers overlay the crosshair center (§4.1).
- Reload / dry: small ammo-state glyph under the crosshair (spinner during
  reload matching reloadS exactly; red outline flash on dry).

---

## 5. BOT AI (squads of AI soldiers — the mission's cast)

Architecture: last-circle's proven shape — per-bot utility-scored FSM over a
blackboard, staggered think (0.15 s near player / 0.4 s far), brains WRITE THE
INPUT STRUCT only; movement/weapons run through the player's code paths. New on
top: perception meter, squad director with tokens, cover scoring, suppression,
barks. All rng from the `bots` stream (deterministic per seed).

### 5.1 Perception — awareness meter (0→1), not binary sight

Per bot per target: `awareness += fillRate × dt`, decays 0.25/s when no
stimulus. Thresholds: 0.5 → INVESTIGATE (move to look), 1.0 → confirmed target
(COMBAT; roll reaction §5.6).

```
fillRate = baseFill                         (2.5/s — full lock in 0.4 s at point blank)
         × distFactor:  clamp(1 − d / detectRange, 0, 1)
         × facingFactor: 1.0 inside 110° cone; 0.35 in 110–160° periphery (≤12 m only); 0 behind
         × lightFactor:  night map — per-navnode light 0..1: 0.30 + 0.70 × light
         × stanceFactor: crouched 0.6; sliding 1.2
         × speedFactor:  0.7 + 0.3 × (targetSpeed / 6.4)
```

`detectRange` (night mission): 18 + 62 × light — 80 m under a floodlight,
28 m in deep shadow, 18 m floor in blackness. Muzzle flash: firing sets the
shooter's effective light to 1.0 for 1.2 s within 120 m line-of-sight
(flashes are information both ways).

### 5.2 Hearing (updates LAST-KNOWN only — never a direct lock; adoption-plan rule)

| Event | Radius | Position fuzz |
|---|---|---|
| Gunshot | 300 m (alert), 120 m (accurate sector) | ±6 m / ±25° beyond 120 m |
| Sprint footsteps | 14 m | ±3 m |
| Walk footsteps | 7 m | ±3 m |
| Crouch walk | 2.5 m | ±2 m |
| Reload | 10 m | ±2 m |
| Slide / mantle | 12 m | ±3 m |
| Grenade bounce | 20 m | exact |

Heard-only stimulus caps awareness at 0.85: a bot must SEE you (or be hit) to
confirm. Being hit = instant awareness 1.0 toward the shot's origin sector.

### 5.3 State machine

`PATROL → INVESTIGATE → COMBAT ⇄ {FLANK, SUPPRESS} → RETREAT`, plus DEAD.

| State | Behavior | Exit |
|---|---|---|
| PATROL | authored route waypoints, walk 4.6, scan yaw ±60° at 25°/s; idle barks | awareness ≥ 0.5 → INVESTIGATE; hit/awareness 1.0 → COMBAT |
| INVESTIGATE | move to stimulus (walk; sprint if gunshot), search cone sweep 6 s at last-known, then widen 10 m for 8 s | confirm → COMBAT; nothing after 14 s → PATROL (alert-patrol: detectRange ×1.2 for 60 s) |
| COMBAT | fight from cover per role + tokens (§5.4–5.7) | target dead → 3 s hold → INVESTIGATE last-known; hp < 35 → RETREAT check |
| FLANK | director-assigned: path to a flank node ≥ 50° off the player-to-squad axis, sprint, no firing until repositioned (commit — doctrine: no reactive self-cancel) | arrival or 12 s cap → COMBAT |
| SUPPRESS | fire timed bursts AT the player's cover edge (§5.8) | token reassigned → COMBAT |
| RETREAT | trigger: hp < 35 AND (squad has ≥ 2 alive) AND roll 0.6 once (latched); fall back to rear cover node, heal-idle 6 s (bots regen §6 at ×0.7 rate) | recovered ≥ 70 hp → COMBAT; squad down to 1 → last-stand (never retreats, aggression +25%) |

Every bout ends (doctrine §2): per-engagement referee clock — if COMBAT runs
40 s with zero damage EITHER way, the director forces one FLANK + resets
grenade eligibility; at 75 s, all preferred ranges halve (they push). The
engagement clock resets on any damage or any death (new-spawn rule).

### 5.4 Squads + roles

Mission cast spawns in squads of 3–4: `pointman` (closest engagement band,
SMG), `support` ×1–2 (AR), `marksman` (DMR, holds the longest sightline).
Squad shares one blackboard: last-known player pos (the ONLY wallhack-free
shared fact — bots never read the true player transform outside their own
perception), token state, grenade cooldown, alive count. Losing the whole squad
except one flips the survivor to last-stand. Bot count on screen ≤ 12 alive
(perf + doctrine crowd rules; mission beats stagger spawns).

### 5.5 Fairness constants per difficulty band (doctrine §2 + Ironhold)

| Band | Reaction roll (ms, uniform) | Aim jitter σ (rad) | First-burst forced miss | Burst pause (s) |
|---|---|---|---|---|
| Recruit | 650–800 | 0.030 | first 2 rounds offset 1.8–2.5° | 0.8–1.2 |
| Regular | 500–700 | 0.022 | first 2 rounds offset 1.5–2.2° | 0.6–1.0 |
| Hardened | 380–550 | 0.018 | first round offset 1.2–1.8° | 0.5–0.9 |
| Veteran | 300–420 | 0.012 | none | 0.4–0.7 |

- All reaction values inside the doctrine 300–800 ms band. No band ever fires
  the same tick it confirms.
- Jitter is Gaussian per SHOT (σ above) around an aim point that tracks with a
  velocity-lead error of ±30% (they lead movers imperfectly).
- Additional error multipliers (stack on σ): acquire ×3 decaying to ×1 over
  0.6 s (last-circle's overshoot warm-up); target airborne/sliding ×1.5;
  bot itself moving ×1.5; bot hit recently §3.4 flinch.
- No damage multipliers, no HP inflation, ever: bots have 100 HP at every band
  and deal table damage. Difficulty = perception + reaction + accuracy +
  aggression ONLY.
- Mission mix: beat 1 = recruit/regular, mid = regular/hardened, finale =
  hardened + max 2 veterans per squad.

### 5.6 Roll-once-and-latch (doctrine — the certainty-by-reroll trap)

Reaction delay: rolled ONCE at awareness 1.0, latched; re-rolled only after the
target is lost ≥ 2 s and re-confirmed. Burst length, aim-high (headshot intent:
0 / 0 / 0.10 / 0.18 chance by band), strafe direction, retreat decision — each
rolled once per triggering event and latched. NOTHING per-tick.

### 5.7 Attack tokens + muzzle discipline (director)

- Director grants **max 2 fire tokens** per squad (doctrine ≤2) + **1 suppress
  token**. Non-holders reposition, flank, or hold cover. Re-arbitrated every
  4 s or on a holder's death; nearest-with-LOS wins ties.
- Cross-squad cap: max 3 damaging attackers on the player in any 250 ms window,
  mission-wide (the director defers the newest squad).
- **Muzzle-block raycast** (Ironhold): before any trigger pull, ray muzzle →
  aim point; if blocked by `hard` within 1.2 m, DON'T fire — reposition. Bots
  never shoot their own cover, walls the player can't be shot through, or
  squadmates (friendly capsule on the ray within 15 m = hold fire + "Move!"
  bark).
- Burst discipline counts BLOWS, not ticks (doctrine): burstLeft decremented
  per ROUND fired (Warden bots 3–5, Vesper 5–8, Corvus 1, Pike 2–3), then the
  band's pause. Magazines are real: bots reload (same reloadS), and reloading
  bots break for lateral cover (last-circle behavior, kept).

### 5.8 Cover selection scoring

Cover nodes are authored map data (navnode + `coverDir` + height full/half).
On COMBAT entry / every 6 s / on cover compromised (took ≥ 20 damage there):

```
score(node) = 3.0 × blocksLOS(threat)              (hard occluder on threat ray)
            + 1.5 × inPreferredBand(weapon)         (pointman 8–18 m, support 15–35 m, marksman 35–80 m)
            + 1.0 / (1 + 0.15 × distToNode)
            + 0.8 × flankSafety                     (no second known threat sees it)
            − 2.0 × claimed(node)                   (min spacing 4 m — one bot per node)
            − 1.5 × insidePlayerLastAimCone(±15°)   (don't run at the barrel)
            − 1.0 × requiresCrossingOpenLOS > 8 m
```

Take the max; claim it (token on the node). Half cover = crouch behind it,
peek to fire (stand 0.6–1.1 s, fire burst, duck 1.2–2.0 s — rolled per cycle).
Full cover = lean-step out sideways 0.5 m to fire.

### 5.9 Grenades (frags only, v1)

Eligibility: fire-token holder AND player static in one cover ≥ 6 s AND range
8–30 m AND ballistic arc solvable (reuse last-circle `arcPitch` bisection
against grenade v0 = 16 m/s, g = −20, fuse 3.8 s). Squad cooldown 20 s; max 1
live grenade mission-wide.

Telegraph chain (honesty): bark "Frag out!" + windup pose 1.2 s BEFORE release
→ bounce SFX → HUD grenade indicator (icon + direction arrow) within 6 m →
3.8 s fuse from release means ≥ 2.6 s of escape time at the player's 6.4 m/s
sprint = escapable from the 5.5 m radius with ≥ 0.8 s margin. Damage 110 center
→ 15 at 5.5 m (linear); through `hard` cover: 25% (crouching behind full cover
survives with 72+ hp).

Player frags: 2 carried, same physics, cook allowed (fuse runs from pin),
throw 22 m/s.

### 5.10 Reaction barks plan

v1 voice = radio-click + short synthesized squelch burst + SUBTITLE line
(honest about no recorded VO; a Suno/VO pass can replace the audio later
without touching triggers). Per-bot cooldown 4 s, global 2 s, priority queue
(man-down > grenade > contact > the rest). Trigger table:

| Event | Line (subtitle) | Trigger |
|---|---|---|
| First confirm | "Contact! On me!" | squad's first awareness 1.0 |
| Lost visual | "Lost him — eyes open." | 4 s after last confirm |
| Flank assigned | "Moving to cut him off!" | FLANK entry (tells the player it's coming — fairness) |
| Suppressing | "Covering fire!" | SUPPRESS entry |
| Grenade | "Frag out!" | 1.2 s pre-release (§5.9) |
| Player grenade seen | "Grenade! Move!" | player frag lands within 8 m of any bot |
| Reloading | "Loading!" | reloadStart with player confirmed |
| Man down | "Man down, <name>'s hit!" | squadmate death, survivor has LOS to body |
| Last man | "You're all I've got left…" | squad reduced to 1 |
| Push order | "He's weak — push!" | referee 75 s push OR player damaged ≥ 60 in 3 s |
| Hit reaction | "I'm hit!" | bot drops below 40 hp |
| Idle patrol | 3 rotating flavor lines | PATROL, ≥ 25 s spacing |

Barks are INFORMATION (flank/grenade warnings are deliberate fairness leaks) —
never fake ("Flanking!" with no flank assigned is banned; store-copy honesty
rule applied to dialogue).

---

## 6. HEALTH MODEL

- 100 HP. CoD-style regen: delay **4.5 s** from last damage, then **35 HP/s**
  (empty→full ≈ 2.8 s). No health pickups, no armor v1.
- Bots: same 100 HP; regen only in RETREAT state at ×0.7 rate (24.5 HP/s) —
  a broken-off bot comes back healthy, which sells RETREAT as a real verb.
- Hurt vignette: radial red, alpha = (1 − hp/100)^1.6 × 0.55; below 30 hp it
  pulses ±0.12 alpha at 1.2 Hz; below 25 hp add 20% desaturation.
- Audio muffle: below 35 hp, master lowpass sweeps 20 kHz → 1.1 kHz
  (setTargetAtTime τ = 0.12 s), heartbeat layer 58 → 82 bpm scaled by
  (1 − hp/35); both release over 1.5 s as regen passes 50 hp.
- Explosion within 6 m: 2.2 s tinnitus ring + duck −10 dB, max once per 20 s.
- Damage direction + flinch per §3.4/§4.3. Death: 1.2 s slow-fade kill-cam-less
  cut to the shell's mission-failed flow (ESC/forfeit contracts per doctrine §6).
- *Amendment 2026-08-25 (owner playtest — low-health legibility + survivability):*
  hp fractions normalize by tuning maxHp (sp 100 / pvp 110), and:
  (a) **damage-reactive health bar** per visual_target §6 amendment — fades in on
  damage, segmented 10 ticks, amber ≤60%, red ≤30%, fades 1.5 s after regen
  completes; the permanent-bar ban stands. (b) The critical **pulse is
  tempo-matched to the heartbeat bpm** (58→82 by 1 − hp/35) instead of flat
  1.2 Hz; same ±0.12 depth. (c) Desat is two-stage: saturate(.8) below 30 hp,
  saturate(.62) below 15. (d) Muffle sweep curve steepened to (hp/35)^1.6,
  endpoints unchanged. (e) **Laboured-breathing loop** (synth bandpass noise,
  23→37 bpm by depth) below 30 hp, hysteresis release at 40; one soft
  recovery breath when regen completes after dipping below 50.
  (f) **Difficulty scales damage the PLAYER RECEIVES from bots** (CoD lever):
  CASUAL ×0.60 (+ campaign authored bands shifted one rung down), STANDARD
  ×0.80, HARD ×1.00 = byte-identical pre-amendment lethality. Bot-vs-bot,
  player-outgoing, and §5.5 band honesty untouched; selector defaults
  STANDARD, persisted, shared campaign/PVP.

---

## 7. AUDIO SPEC

Web Audio, HRTF PannerNode positional (last-circle graph: master → music/sfx
buses, per-sound spatial gain, shared synthetic-impulse ConvolverNode).
Recorded one-shots where physics demands it (CC0: Free Firearm Sound Library +
Kenney, the exact sourcing pattern of `last-circle/assets/audio/sfx/` —
LICENSE files ship in-repo); synthesis for everything tonal; every recorded
call site keeps a synth fallback (degrade to synth, never to silence).

### 7.1 Layered gunshot design (the three-layer stack, per shot)

| Layer | Content | Timing | Per-weapon character |
|---|---|---|---|
| Mechanical | action clack: 3–6 kHz bandpassed transient + spring rattle | 0–40 ms | Warden tight double-click; Vesper buzzy short; Corvus heavy bolt CHUNK (fills part of the 233 ms interval); Pike crisp slide |
| Body | boom 80–300 Hz + crack 800 Hz–2 kHz | 5–160 ms | recorded FFSL takes, 2–3 per weapon, ±6% rate + gain jitter per play (decorrelation, last-circle `sample()`) |
| Tail | environment decay | 60 ms–1.8 s | from the SHOOTER's reverb zone (§7.3), convolved |

First-shot pop per §2.8. Player's own shots: mechanical +3 dB relative (you
hear YOUR gun's action; enemies mostly hear body+crack).

### 7.2 Distance variants (bot fire = information, PUBG lesson kept)

| Ring | Mix | Extras |
|---|---|---|
| 0–30 m | full 3-layer | — |
| 30–90 m | mechanical −12 dB, crack dominant, tail +40% | playback delayed dist/343 s (audible flight delay — free authenticity) |
| 90–300 m | body only, lowpass 1.4 kHz, tail 1.2 s+ | night-quiet: +2 dB audibility vs day baseline |

Whiz-by: rounds passing < 3 m of the camera emit the supersonic crack (90 ms,
2–4 kHz snap) — last-circle `whizBy`, verbatim (it's the only "you are under
fire" cue that needs no eyes).

### 7.3 Interior reverb zones

Map volumes tagged `reverbZone`; camera zone drives a shared ConvolverNode with
SYNTHESIZED impulses (no IR files):

| Zone | RT60 | Predelay | Notes |
|---|---|---|---|
| exterior (night) | 0.25 s slap | 90 ms single echo | distant dog/wind bed |
| warehouse | 1.1 s | 18 ms | the showcase interior |
| corridor | 0.5 s | 8 ms | flutter component |
| small room | 0.35 s | 5 ms | — |

Crossfade 250 ms on zone change. A shooter's TAIL uses the SHOOTER's zone; the
listener's wet/dry uses the CAMERA's zone (interior fight heard from outside =
muffled boom through the door: lowpass 900 Hz when zones differ and no LOS).

### 7.4 Footsteps + foley

- Surface from ground material map: concrete / metal / dirt / grass / glass.
  Kenney CC0 sets (4 variants each), rate-jittered ±8%.
- Cadence: walk 1.85 Hz, sprint 2.6 Hz (+3 dB), crouch 1.2 Hz (−8 dB).
  Player's own steps −10 dB relative to bots at equal distance (hear THEM).
- Foley: reload stages (mag_out / mag_in / rack as separate cues placed at the
  animation's actual beats), weapon raise cloth, slide scrape (0.6 s loop while
  sliding), mantle grunt+cloth, landing thud scaled by fall height.

### 7.5 Procedural score (FFG no-duplicate-music rule — per-game, generated)

All Web-Audio synthesized, unique to BLACKRIDGE (no track reuse from any FFG
game). Two-layer adaptive bed, crossfaded by game state:

- **Tense ambient** (default): D-minor root drone 55 + 110 Hz (detuned saw pair
  through lowpass 400 Hz), filtered-noise wind bed, sparse bell-synth pulse
  every 6–9 s (rng from `audio` stream). −18 dB under SFX.
- **Combat layer**: 92 BPM percussion (synth kick 4-floor + noise-snare
  backbeat) + bass stab pattern on the drone root, + high tension arp added
  when ≥ 2 squads engaged. Crossfade IN 1.2 s on any bot reaching COMBAT;
  OUT 5 s after 8 s with zero bots in COMBAT.
- **Stingers**: squad-wiped = 2-note resolve stab; mission-finale beat adds a
  rising layer; player death = low boom + music duck.
- Mix ceiling: music never exceeds −12 dB vs weapon SFX during combat (guns own
  the mix — CoD discipline).

Menus reuse the tense-ambient bed at −6 dB with the combat layer muted.

---

## 8. ACCEPTANCE TESTS (doctrine §5 — done = observed effect)

Deterministic headless probes (`tools/probe_*.mjs`, exit-code) + in-page test
surface (`window.__FFG3D__.__test`) + scripted persona playtests driving the
REAL sim on fixed seeds. Input-layer tests dispatch REAL KeyboardEvent /
MouseEvent (doctrine: a buffer test through a direct sim call bypasses the
buffer). Re-run the full battery after EVERY combat-layer change; verdicts
never round up.

### 8.1 Numeric probes (exit-code gates)

| Probe | Asserts |
|---|---|
| `probe_ttk.mjs` | Per-weapon TTK at 5 range samples matches §2.1 math exactly; **band check: Warden/Vesper/Corvus body TTK within 150–400 ms at effective range** (Pike exempt, asserted ≥ 400 as designed); head-mult paths exact |
| `probe_recoil.mjs` | Pattern tables reproduce per seed; 30-round Warden full-auto 95th-percentile impact envelope at 30 m ≤ 3.2° radius; recovery returns 100% of uncompensated kick within 0.30 s ± 1 frame |
| `probe_spread.mjs` | `effectiveSpread` = the crosshair's number for 20 sampled states (shared-model identity, not similarity); slide/air/crouch multipliers exact |
| `probe_movement.mjs` | Slide v(t) curve ± 2%; slide-jump retains 90%; mantle 380/500 ms; sprint-out delays ± 15 ms; accel time-to-walk 0.25 s ± 0.03 |
| `probe_penetration.mjs` | Damage retained per material table; one-pen max; `hard` never penetrated; exit FX event emitted both faces |
| `probe_fairness.mjs` | Over 30 seeds: zero bot shots before its rolled reaction elapses; reaction rolls within band and LATCHED (variance of re-reads = 0); jitter σ within ± 10% of band spec; ≤ 2 fire tokens per squad and ≤ 3 damaging attackers in any 250 ms window; zero muzzle-blocked trigger pulls; burstLeft counts ROUNDS (fired-round histogram matches burst spec) |
| `probe_engagement_ends.mjs` | 30 seeds of scripted stalemate: referee forces flank at 40 s ± 2, push at 75 s ± 2; no COMBAT episode exceeds 90 s; passivity never wins by timeout |
| `probe_grenade.mjs` | Bark precedes release by 1.2 s ± 1 tick; escape margin ≥ 0.8 s at sprint from radius edge; squad cooldown honored; ≤ 1 live grenade |
| `probe_input_buffer.mjs` (in-page) | Real mousedown during sprint-out/reload-tail/mantle fires on first eligible tick ≤ 0.35 s; semi-auto: 1 click = 1 shot at any click rate |
| `probe_feedback_latency.mjs` (in-page) | impact event → hitmarker draw + tick sound trigger in the SAME frame |

### 8.2 Persona playtests (scripted personas, real sim, 20 seeds each)

| Persona | Script | Pass bars |
|---|---|---|
| **Novice** | 400–500 ms delayed inputs, walks (never sprints in combat), hip-fires < 10 m, ADS elsewhere, no slide, reloads in the open | survives mission beat 1 on Recruit-mix ≥ **60%**; completes full mission on Recruit ≥ **40%**; median deaths-per-run ≤ 4 (checkpoint respawns) |
| **Tactician** | cover-to-cover, ADS bursts 3–5, pre-aims corners, relocates after 2 bursts, throws frag at suppressed clusters, retreats < 40 hp | clears full mission on Regular-mix ≥ **70%**; on Hardened-mix ≥ **45%**; ends beats with ≥ 50 hp median |
| **Rusher** | tac-sprint + slide entries, Vesper only, never ADS > 20 m, pushes every contact | clears beat 1 on Regular ≥ **50%**; full mission ≥ **25%** (rushing viable early, punished late — the intended skill curve); dies to flanks/tokens, NOT to sub-band reaction times (assert: every rusher death traces to a shot fired ≥ reaction-min after confirm) |

Plus the fairness-feel bar: median time from FIRST bot damage on the player to
player death when caught in the open ≥ **1.2 s** on Regular, ≥ **0.7 s** on
Veteran (bots must never insta-melt — measured, not vibed).

### 8.3 Feel + perf gates (shared with the perf spec, listed for completeness)

- First firefight: 0 new shader programs (compileAsync pre-warm ×2, RT bound —
  doctrine §3), muzzle-flash light pool fixed-size.
- p99 frame time during a 12-bot firefight with grenades ≥ 45 fps-equivalent on
  the reference rig; hitches attributed (program vs texture) per doctrine.
- Deployed-URL verification: version marker + one new-code fingerprint + one
  scripted firefight on production via the test surface before "done" is said.

---

## Appendix A — event vocabulary (sim → view bridge)

`shotFired(actor, weaponId, muzzle, dir)` · `tracer{...}` · `impact(pos+normal,
surface)` · `hitMarker(owner, target, dmg, isHead, killed)` · `reloadStart(a,
wpn, empty)` / `reloadDone` · `weaponEquipped` · `dryFire` · `whizBy(pos,
missDist)` · `explosion(pos, r)` · `grenadeOut(bot, target)` · `bark(botId,
key)` · `botStateChange(botId, from, to)` · `engagementClock(episodeId, t)` ·
`playerHit(dmg, dirAzimuth)` · `playerDown` · `squadWiped(squadId)` ·
`zoneChange(reverbZone)` · `footstep(actor, surface, gait)`.

All feedback in §4/§7 subscribes to these; the view never reaches into sim
state (doctrine §4). Bot fairness counters (§8.1) are event-count
instrumentation on this same vocabulary — the probes and the game share one
truth.

## Appendix B — deliberate cuts (so nobody "finds" them missing)

- No prone (capsule honesty, §1.1). No lean-peek for the player v1 (bots peek;
  player counterplay is movement — revisit v1.1). No melee (4 weapons is the
  scope; a knife with no animation budget is a primitive-asset trap). No
  killstreaks/perks (mission showcase, not MP meta). No aim assist (mouse).
  No suppressors/attachments v1 (the perception model is ready for them —
  `audible radius` and `flash light` are already per-shot parameters).
