# Grid Rush — TIME TRIAL + GHOST Mode Spec

Status: DESIGN / ready-to-paste. Author does **not** edit `runtime/game.js`,
`index.html`, or `runtime/config.js` (changed in parallel by the mode-registry work).
This doc gives (1) the design, (2) the exact mode-registry contract with **precise
game.js call sites (function + current line)**, (3) the ghost record/replay format,
(4) a self-contained `runtime/modes/time-trial.js` module, (5) the HUD + results, and
(6) the menu entry.

Every game.js line number is from the current `runtime/game.js`. Track lengths and the
storage budget in §3 are computed from the real `TRACKS` params via the exact
`Track.build()` formula (not estimated).

---

## 1. Design

**One player, no rivals, race the clock.** On each circuit the game keeps *your best
full run* as a **ghost**: position + yaw sampled at a fixed rate for the whole 3-lap
run, plus the finish time. On the next attempt a **translucent ghost kart** replays
that run in lockstep with your race clock, and the HUD shows a live **delta-to-ghost**
(how far ahead/behind you are, in seconds, at your current track distance). Beat the
time and the ghost is overwritten; both the ghost and the best time persist to
`localStorage` **per circuit**.

Why this shape:
- **Solo** — the mode declares `rivalCount = 0`, so `startRace()` spawns no AI. No
  collisions, no rubber-band, no items-from-rivals to perturb a clean lap. (Data-orb
  pads and hazards stay — they're part of the circuit; the ghost drove them too.)
- **The ghost is a pure visual** — it is **not** a `Racer` and never enters
  `this.racers`, so it is invisible to `resolveCollisions`, `ranking`,
  `checkCheckpoints`, `checkHazards`, and the item world. It is owned entirely by the
  mode object (`this.ghostMesh`), added to `game.scene` in `setup`, removed in
  `teardown`.
- **Delta is distance-anchored, not clock-anchored** — the classic racing readout:
  "at the distance you're at now, how much sooner/later did the ghost reach it." That
  needs the ghost's *distance→time* curve, so each sample also stores the run's
  cumulative `trackS` (§3).

Acceptance for "done" (observed effect, not "it compiled"): see the checklist in §8.

---

## 2. Mode-registry contract

The parallel work adds a registry (`this.mode` on the game, chosen from the menu). This
mode plugs into the **five hooks named in the task** plus **three integration points it
genuinely needs** — each justified below. All calls are null-safe (`this.mode?.x?.()`)
so a bare descriptor like Grand Prix (no hooks) runs today's behavior unchanged.

### 2.1 The five task hooks — exact call sites

| Hook | game.js call site (insert) | What the mode does |
|------|----------------------------|--------------------|
| `setup(game)` | `startRace()`, **after line 550** (the banner line) and before `this.playMusic()` (551) | load ghost, spawn translucent kart parked at sample 0, reset recorder, inject/reset HUD + hide standings, set the TT banner |
| `update(game, dt)` | `update()`, **after `this.updateProgress();` (line 712)** | record player at fixed rate; pose the ghost by `raceTime`; compute live delta |
| `onRacerFinish(game, racer)` | `checkCheckpoints()`, **after line 1081** (`…finishedOrder.push(r.id)`) | player only: compare `finishTime` to best; if faster, save ghost + time; stash results summary |
| `hudExtra(game)` | `updateHud()`, **after the leaders block, before the method closes (~line 1318)** | paint BEST + DELTA each frame |
| `checkEnd(game)` | `update()`, **replace the condition on line 720** | return `player.finished` → end the instant the solo run ends |

Exact edits:

**`setup` — startRace (after line 550):**
```js
    if (this.els.banner) this.els.banner.textContent = `${def.name} · ${LAPS} LAPS · DATA ORBS LIVE`;
    this.mode?.setup?.(this);   // ← ADD: TT setup overwrites the banner for time trial
    this.playMusic();
```
(Grand Prix has no `setup`, so its banner on line 550 stands. TT's `setup` sets its own
banner last, so it wins.)

**`update` — the racing/finished branch (after line 712):**
```js
      this.updateProgress();
      this.mode?.update?.(this, dt);   // ← ADD
      this.updateCamera(dt);
```

**`checkEnd` — replace line 720:**
```js
      // was: if (this.phase === 'racing' && this.player?.finished) {
      if (this.phase === 'racing' && (this.mode?.checkEnd ? this.mode.checkEnd(this) : this.player?.finished)) {
        this.endRace();
      }
```
Behavior is identical for Grand Prix (no `checkEnd` → falls back to the old condition).
For TT, `checkEnd` returns `player.finished`; with one racer the existing grace logic on
lines 723-731 (`finishedOrder.length >= this.racers.length` → `1 >= 1`) sets
`_raceOver` and stops the loop the same frame — no waiting on absent AI.

**`onRacerFinish` — checkCheckpoints (after line 1081):**
```js
            if (!this.finishedOrder.includes(r.id)) this.finishedOrder.push(r.id);
            this.mode?.onRacerFinish?.(this, r);   // ← ADD (fires once per racer finish)
```

**`hudExtra` — end of updateHud (after the leaders `if` block, ~line 1318):**
```js
        .join('');
    }
    this.mode?.hudExtra?.(this);   // ← ADD (runs every frame in countdown + racing + finished)
  }
```

### 2.2 Three extra integration points this mode needs

The five hooks above cannot, by themselves, make the mode **solo**, **clean up its
ghost**, or **own the results screen**. Each is minimal and null-safe.

**(a) `rivalCount` (property) — make it solo.** `startRace()` hardcodes
`1 + RIVAL_COUNT`. Read the mode's count instead. **Edit lines 512 and 520:**
```js
    const rivalCount = this.mode?.rivalCount ?? RIVAL_COUNT;   // ← line 512 area
    const total = 1 + rivalCount;
    …
    for (let i = 0; i < rivalCount; i++) {   // ← was: i < RIVAL_COUNT  (line 520)
```
TT sets `rivalCount = 0`; Grand Prix sets `rivalCount = RIVAL_COUNT`. *(Alternative if
the registry prefers not to touch the loop: `setup` could `scene.remove` + splice the
AI racers after they're built — but that wastes 5 mesh builds every race, so gating the
loop is the right call.)*

**(b) `teardown(game)` — release the ghost.** The ghost mesh must be removed and
disposed whenever a race ends or the player leaves, or it leaks across races. `clearRace()`
is the single choke point (called by both `startRace` at line 507 and `returnMenu` at
line 632). **Add as the first line of `clearRace()` (after line 476):**
```js
  clearRace() {
    this.mode?.teardown?.(this);   // ← ADD: remove/dispose ghost + hide injected HUD
    if (this.track) {
```
Sequence on "Race Again": `startRace` → `clearRace` (teardown removes the old ghost) →
build track → `setup` (spawn the possibly-updated ghost). Clean.

**(c) `results(game)` — own the results screen.** For a solo run the default
`refreshResults()` renders a one-line ranking and a Grand-Prix title ("GRID CROWN — 1st").
TT needs "YOUR TIME / BEST / VS GHOST" and a "NEW GHOST RECORD" title. **Add a delegate at
the top of `refreshResults()` (line 1382):**
```js
  refreshResults() {
    if (this.mode?.results) { this.mode.results(this); return; }   // ← ADD
    const rank = this.ranking();
```
Grand Prix has no `results` → default renders as today.

> **Why `results` and not `hudExtra` for the results panel:** for a solo racer the frame
> that sets `player.finished` runs `updateHud` (→ `hudExtra`) *before* `checkEnd`→`endRace`
> flips `phase` to `'finished'`, and the very next frame `playing` is already `false` so
> `update`/`updateHud` never run again. So `hudExtra` never observes `phase === 'finished'`
> here. `refreshResults()` is the only code that runs at results time (from `endRace` at
> line 1377 and the finished branch at line 730), so results must route through it.

### 2.3 Registry + game.js constructor

`runtime/modes/index.js`:
```js
import { RIVAL_COUNT } from '../config.js';
import { TimeTrialMode } from './time-trial.js';

// Grand Prix = today's 6-racer race. A bare descriptor: no hooks → every this.mode?.x?.()
// is a no-op and game.js runs exactly as it does now.
export const GrandPrixMode = { id: 'grand_prix', label: 'GRAND PRIX', rivalCount: RIVAL_COUNT };

export const MODES = { grand_prix: GrandPrixMode, time_trial: TimeTrialMode };
export const DEFAULT_MODE = 'grand_prix';
```
game.js constructor — near the other race state (**after line 117**, `this.vehicleId = 'prism';`):
```js
    import { MODES, DEFAULT_MODE } from './modes/index.js';   // top-of-file import
    …
    this.modeId = localStorage.getItem('gridrush_mode') || DEFAULT_MODE;
    this.mode = MODES[this.modeId] || MODES[DEFAULT_MODE];
```

---

## 3. Ghost record / replay — sample rate, interpolation, storage

### 3.1 Sample rate

`SAMPLE_HZ = 10` → `SAMPLE_DT = 0.1 s`. Fixed-interval, keyed off `game.raceTime`
(which is `0` at the first racing frame and advances by `dt` only in the racing branch,
game.js:687 — so sample index `i` maps to `raceTime ≈ i × SAMPLE_DT`, no per-sample
timestamp needed).

10 Hz is ample for an *interpolated* ghost: at a fast ~55 u/s the kart moves ~5.5 units
between samples, against a `TRACK_HALF_WIDTH` of 21.375 and corner radii in the
hundreds — the linear-interp chord error is sub-lane and invisible for a translucent
kart. Higher rates only inflate storage.

### 3.2 What each sample stores — 5 × Float32

`[ x, y, z, yaw, s ]` per sample (`STRIDE = 5`):
- `x, y, z` — world position, replayed verbatim (captures your actual line, drift
  drift-out, height on `null_spire`, etc.). `y` is kept, not recomputed, so vertical
  circuits replay exactly.
- `yaw` — heading, interpolated wrap-aware (§3.3) and written to `mesh.rotation.y`
  (matches `syncMesh`, game.js:1254).
- `s` — the run's cumulative `trackS` at that sample. Used **only** for the
  distance-anchored delta (§3.4). `player.trackS` is monotonic across all 3 laps
  (game.js `projectRacer` accumulates it, 1040-1044; `updateProgress` mirrors it), so
  ghost `s` and live `player.trackS` share one coordinate — comparable directly with no
  lap-wrap math.

### 3.3 Replay interpolation

Ghost pose at wall-clock `t = game.raceTime`:
```
f = t / SAMPLE_DT ;  i = floor(f) ;  frac = f - i
pos = lerp(sample[i], sample[i+1], frac)                 // component-wise
yaw = sample[i].yaw + wrapAngle(sample[i+1].yaw - sample[i].yaw) * frac
```
`wrapAngle` (math.js:20) keeps the short way round the ±π seam. When `i >= n-1` the
ghost holds its final pose parked on the line. During the countdown `raceTime` is `0`,
so the ghost sits at sample 0 (both karts launch together on "GRID OPEN").

### 3.4 Delta-to-ghost (distance → time inversion)

At the player's current distance `P = player.trackS`, find the ghost sample interval
`[c, c+1]` with `s[c] ≤ P ≤ s[c+1]` (advance a persistent cursor — `P` is monotonic, so
this is O(1) amortized), then:
```
frac        = (P - s[c]) / (s[c+1] - s[c])
ghostTimeAtP = (c + frac) * SAMPLE_DT        // when the ghost reached distance P
delta        = raceTime - ghostTimeAtP        // <0 → player AHEAD, >0 → BEHIND
```
Edge cases: `P` below `s[0]` → `delta = raceTime` (≈0 at the line); `P` beyond the
ghost's last distance (you out-ran a ghost that already finished) → `delta = raceTime -
bestTime` (clamped, shows AHEAD).

### 3.5 Storage schema + size budget

Per-circuit key `gridrush_ghost_<circuitId>`, value = JSON:
```json
{
  "v": 2,
  "circuit": "prism_boulevard",
  "vehicle": "prism",
  "time": 84.21,
  "dt": 0.1,
  "n": 843,
  "data": "<base64 of a Float32Array, length n*5, interleaved x,y,z,yaw,s>"
}
```
Plus a tiny aggregate `gridrush_tt_records` = `{ "<circuitId>": <bestSeconds> }` so the
menu can show best times **without** decoding any ghost blob. Both are written together
on a new record.

The float payload is packed as base64 of the `Float32Array` buffer (pack/unpack in the
module, §4). Float32 is machine-endian; ghosts are read back only on the same device
(localStorage is per-origin, per-device), so endianness is always consistent.

**Budget — computed from real track lengths** (exact `Track.build()` formula, N=220,
3 laps, ~42 u/s average with corners/hazards; 10 Hz; 5 floats/sample):

| Circuit | lap length | 3-lap length | ~run @42 u/s | samples | base64 size |
|---------|-----------:|-------------:|-------------:|--------:|------------:|
| prism_boulevard | 4045 | 12136 | 289 s | 2890 | ~77 KB |
| volt_canyon | 3512 | 10537 | 251 s | 2510 | ~67 KB |
| glass_harbor | 4856 | 14568 | 347 s | 3470 | ~91 KB |
| null_spire | 3779 | 11336 | 270 s | 2700 | ~72 KB |
| echo_yards | 4424 | 13272 | 316 s | 3160 | ~84 KB |

Worst case all five stored ≈ **0.4 MB**, against a ~5 MB `localStorage` origin quota —
comfortable. A hard `MAX_SAMPLES = 6000` (≈600 s) bounds memory/quota even for a very
slow run; a run that exceeds it stops appending (won't produce a saved ghost that long,
which is not a real completion anyway). `saveGhost` wraps `setItem` in try/catch so a
quota failure keeps the in-memory best and simply skips persistence.

---

## 4. Ready-to-paste module — `runtime/modes/time-trial.js` (NEW FILE)

Self-contained: loads/saves ghosts, builds the translucent kart, records + replays,
computes delta, injects its own HUD + styles, and renders results. Imports only
`three`, `config`, `vehicles`, `math` (all reachable from `runtime/modes/`).

```js
/* Grid Rush — modes/time-trial.js
 * Solo TIME TRIAL vs a GHOST of your best run for this circuit.
 * Registry contract: see docs/modes/time-trial.md §2.
 *   rivalCount = 0            → startRace spawns no AI
 *   setup / update / onRacerFinish / hudExtra / checkEnd / results / teardown
 */
import * as THREE from 'three';
import { VEHICLES, LAPS } from '../config.js';
import { buildVehicleMesh } from '../vehicles.js';
import { clamp, lerp, wrapAngle, formatTime } from '../math.js';

const SAMPLE_HZ = 10;
const SAMPLE_DT = 1 / SAMPLE_HZ;     // 0.1 s between ghost samples
const STRIDE = 5;                    // floats/sample: x, y, z, yaw, s
const MAX_SAMPLES = 6000;            // ~600 s hard bound
const GHOST_OPACITY = 0.32;
const SCHEMA = 2;

const keyGhost = (c) => `gridrush_ghost_${c}`;
const KEY_RECORDS = 'gridrush_tt_records';   // { circuitId: bestSeconds } — menu badges

// ── storage ──────────────────────────────────────────────────────────────
function loadRecords() {
  try { return JSON.parse(localStorage.getItem(KEY_RECORDS) || '{}'); } catch { return {}; }
}
export function bestTimeFor(circuitId) {
  const r = loadRecords();
  return typeof r[circuitId] === 'number' ? r[circuitId] : null;
}
function packFloats(f32) {                 // Float32Array → base64
  const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let bin = '';
  const CH = 0x8000;                       // chunk to dodge String.fromCharCode arg limits
  for (let i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(bin);
}
function unpackFloats(b64) {                // base64 → Float32Array
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Float32Array(u8.buffer);
}
function loadGhost(circuit) {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(keyGhost(circuit)) || 'null'); } catch { raw = null; }
  if (!raw || raw.v !== SCHEMA || !raw.data) return null;
  let flat;
  try { flat = unpackFloats(raw.data); } catch { return null; }
  const n = raw.n || Math.floor(flat.length / STRIDE);
  if (n < 2) return null;
  return { time: raw.time, dt: raw.dt || SAMPLE_DT, n, vehicle: raw.vehicle || 'prism', flat };
}
function saveGhost(circuit, g) {
  const payload = { v: SCHEMA, circuit, time: g.time, dt: SAMPLE_DT, n: g.n, vehicle: g.vehicle, data: packFloats(g.flat) };
  try {
    localStorage.setItem(keyGhost(circuit), JSON.stringify(payload));
    const rec = loadRecords(); rec[circuit] = g.time;
    localStorage.setItem(KEY_RECORDS, JSON.stringify(rec));
  } catch { /* quota — keep in-memory best, skip persist */ }
}

// ── translucent ghost kart (fresh materials per build → safe to mutate) ────
function buildGhostMesh(vehicleId) {
  const mesh = buildVehicleMesh(VEHICLES[vehicleId] || VEHICLES.prism);
  mesh.traverse((o) => {
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      m.transparent = true;
      m.opacity = (m.opacity == null ? 1 : m.opacity) * GHOST_OPACITY;
      m.depthWrite = false;
    }
    o.renderOrder = 3;
  });
  return mesh;
}

// ── HUD injection ──────────────────────────────────────────────────────────
function injectHudStyle() {
  if (document.getElementById('gr-tt-style')) return;
  const s = document.createElement('style');
  s.id = 'gr-tt-style';
  s.textContent = `
  #gr-tt-hud{display:contents;}
  #gr-tt-delta{font-family:var(--font-display,"Orbitron",sans-serif);font-weight:800;
    font-size:1.15rem;letter-spacing:.02em;color:#ffe566;}
  #gr-tt-delta.ahead{color:#39ff88;} #gr-tt-delta.behind{color:#ff5a7a;}
  .gr-tt-row{display:flex;justify-content:space-between;gap:1.4rem;padding:.3rem 0;
    font-family:var(--font-mono,"Share Tech Mono",monospace);letter-spacing:.06em;color:#c8dcff;}
  .gr-tt-row b{font-family:var(--font-display,"Orbitron",sans-serif);color:#fff;}
  .gr-tt-row.big{font-size:1.15rem;} .gr-tt-row.note{color:#8fd;justify-content:center;}
  .gr-tt-row.ahead,.gr-tt-row.ahead b{color:#39ff88;}
  .gr-tt-row.behind,.gr-tt-row.behind b{color:#ff5a7a;}`;
  document.head.appendChild(s);
}

export const TimeTrialMode = {
  id: 'time_trial',
  label: 'TIME TRIAL',
  rivalCount: 0,

  // per-race state (all reset in setup)
  ghost: null, ghostMesh: null, rec: null, _acc: 0, _cursor: 0, _delta: null,
  _summary: null, _hud: null,

  menuMeta(game) {
    const b = bestTimeFor(game.trackId);
    return b != null ? `SOLO · BEST ${formatTime(b)}` : 'SOLO · NO GHOST YET';
  },

  setup(game) {
    this.rec = [];
    this._acc = SAMPLE_DT;      // force a sample on the first racing frame (t≈0)
    this._cursor = 0;
    this._delta = null;
    this._summary = null;

    this.ghost = loadGhost(game.trackId);
    if (this.ghost) {
      this.ghostMesh = buildGhostMesh(this.ghost.vehicle);
      this._poseGhost(game, 0);          // park at sample 0 for the countdown
      game.scene.add(this.ghostMesh);
    } else {
      this.ghostMesh = null;
    }

    this._ensureHud();
    this._chrome(game, true);

    if (game.els.banner) {
      game.els.banner.textContent = this.ghost
        ? `TIME TRIAL · ${LAPS} LAPS · GHOST ${formatTime(this.ghost.time)}`
        : `TIME TRIAL · ${LAPS} LAPS · SET A GHOST`;
    }
  },

  update(game, dt) {
    const p = game.player;
    if (!p) return;

    // 1) record player at a fixed rate while actually racing
    if (game.phase === 'racing' && !p.finished && this.rec.length < MAX_SAMPLES * STRIDE) {
      this._acc += dt;
      while (this._acc >= SAMPLE_DT && this.rec.length < MAX_SAMPLES * STRIDE) {
        this._acc -= SAMPLE_DT;
        this.rec.push(p.position.x, p.position.y, p.position.z, p.yaw, p.trackS);
      }
    }
    // 2) drive the ghost by the race clock
    if (this.ghostMesh) this._poseGhost(game, game.raceTime);
    // 3) live delta at the player's current distance
    this._delta = this.ghost ? this._deltaAt(game, p.trackS) : null;
  },

  onRacerFinish(game, racer) {
    if (!racer.isPlayer) return;
    const time = racer.finishTime;
    const prev = bestTimeFor(game.trackId);
    const improved = prev == null || time < prev;
    if (improved && this.rec.length >= 2 * STRIDE) {
      const flat = Float32Array.from(this.rec);
      saveGhost(game.trackId, { time, n: flat.length / STRIDE, dt: SAMPLE_DT, vehicle: game.vehicleId, flat });
    }
    this._summary = { time, prev, improved };
  },

  checkEnd(game) { return !!game.player?.finished; },

  hudExtra(game) {
    if (!this._hud) return;
    const b = bestTimeFor(game.trackId);
    this._hud.best.textContent = b != null ? formatTime(b) : '—:—.—';
    const d = this._delta, el = this._hud.delta;
    if (d == null || game.phase !== 'racing') {
      el.textContent = this.ghost ? '+0.00' : 'NO GHOST';
      el.className = '';
    } else {
      el.textContent = (d < 0 ? '-' : '+') + Math.abs(d).toFixed(2);
      el.className = d < 0 ? 'ahead' : 'behind';
    }
  },

  results(game) {
    const s = this._summary || { time: game.player?.finishTime ?? 0, prev: bestTimeFor(game.trackId), improved: false };
    if (game.els.resultsTitle) game.els.resultsTitle.textContent = s.improved ? 'NEW GHOST RECORD' : 'RUN COMPLETE';
    const host = game.els.resultsStats;
    if (!host) return;
    const rows = [`<div class="gr-tt-row big">YOUR TIME <b>${formatTime(s.time)}</b></div>`];
    if (s.prev != null) {
      const best = Math.min(s.time, s.prev);
      const dvs = s.time - s.prev;
      rows.push(`<div class="gr-tt-row">BEST <b>${formatTime(best)}</b></div>`);
      rows.push(`<div class="gr-tt-row ${dvs <= 0 ? 'ahead' : 'behind'}">VS GHOST <b>${dvs <= 0 ? '-' : '+'}${Math.abs(dvs).toFixed(2)}s</b></div>`);
    } else {
      rows.push(`<div class="gr-tt-row note">FIRST GHOST SET — race again to chase it</div>`);
    }
    host.innerHTML = rows.join('');
  },

  teardown(game) {
    if (this.ghostMesh) {
      game.scene.remove(this.ghostMesh);
      this.ghostMesh.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
      this.ghostMesh = null;
    }
    this.ghost = null; this.rec = null; this._delta = null;
    this._chrome(game, false);
  },

  // ── internals ────────────────────────────────────────────────────────────
  _poseGhost(game, t) {
    const g = this.ghost, mesh = this.ghostMesh;
    if (!g || !mesh) return;
    mesh.rotation.order = 'YXZ';
    const f = t / g.dt;
    let i = Math.floor(f);
    if (i >= g.n - 1) {                       // run complete → hold final pose
      const o = (g.n - 1) * STRIDE;
      mesh.position.set(g.flat[o], g.flat[o + 1], g.flat[o + 2]);
      mesh.rotation.y = g.flat[o + 3];
      return;
    }
    if (i < 0) i = 0;
    const frac = f - i, a = i * STRIDE, b = (i + 1) * STRIDE;
    mesh.position.set(
      lerp(g.flat[a],     g.flat[b],     frac),
      lerp(g.flat[a + 1], g.flat[b + 1], frac),
      lerp(g.flat[a + 2], g.flat[b + 2], frac)
    );
    mesh.rotation.y = g.flat[a + 3] + wrapAngle(g.flat[b + 3] - g.flat[a + 3]) * frac;
  },

  _deltaAt(game, playerS) {
    const g = this.ghost;
    const sIdx = (k) => g.flat[k * STRIDE + 4];
    if (playerS <= sIdx(0)) return game.raceTime;
    if (playerS >= sIdx(g.n - 1)) return game.raceTime - g.time;
    let c = clamp(this._cursor, 0, g.n - 2);
    while (c < g.n - 2 && sIdx(c + 1) < playerS) c++;   // advance
    while (c > 0 && sIdx(c) > playerS) c--;             // retreat (spin/knockback)
    this._cursor = c;
    const s0 = sIdx(c), s1 = sIdx(c + 1), seg = s1 - s0;
    const frac = seg > 1e-4 ? (playerS - s0) / seg : 0;
    return game.raceTime - (c + frac) * g.dt;
  },

  _ensureHud() {
    if (this._hud) return;
    injectHudStyle();
    const wrap = document.createElement('div');
    wrap.id = 'gr-tt-hud';
    wrap.innerHTML =
      `<div class="inst"><div class="inst-label">BEST</div><div id="gr-tt-best" class="inst-value">—:—.—</div></div>` +
      `<div class="inst"><div class="inst-label">VS GHOST</div><div id="gr-tt-delta">NO GHOST</div></div>`;
    (document.getElementById('bottom-cluster') || document.getElementById('hud'))?.appendChild(wrap);
    this._hud = { wrap, best: wrap.querySelector('#gr-tt-best'), delta: wrap.querySelector('#gr-tt-delta') };
  },

  _chrome(game, on) {
    // hide the multiplayer POSITION + STANDINGS insts while solo; show the TT HUD
    const pos = document.getElementById('hud-pos')?.closest('.inst');
    const lead = document.getElementById('hud-leaders')?.closest('.inst');
    for (const el of [pos, lead]) if (el) el.style.display = on ? 'none' : '';
    if (this._hud) this._hud.wrap.style.display = on ? '' : 'none';
  },
};
```

Notes:
- `#gr-tt-hud` uses `display:contents` so its two `.inst` children flow into the
  `#bottom-cluster` flex row as siblings of SPEED/LAP/TIME (which stay).
- The ghost's materials are **fresh** per `buildVehicleMesh` call, so lowering their
  opacity never touches the player kart. `depthWrite:false` + `renderOrder:3` reads as a
  hologram (may show faintly through walls — desirable for a ghost).
- The final periodic sample can sit up to one `SAMPLE_DT` (≤0.1 s, a few units) short of
  the exact finish line — invisible, and the *time* shown is always the true
  `finishTime` (stored separately, not derived from sample count).

---

## 5. HUD + results

- **BEST** and **VS GHOST** are injected into `#bottom-cluster` (§4 `_ensureHud`); the
  solo-meaningless **POSITION** and **STANDINGS** insts are hidden while the mode is
  active and restored on `teardown` (`_chrome`).
- **VS GHOST** paints every frame from `_delta`: `-1.23` green when ahead, `+0.84` red
  when behind, `NO GHOST` when no ghost exists, `+0.00` before the clock starts.
- **Results** (`results()`) overwrites the title with `NEW GHOST RECORD` / `RUN
  COMPLETE` and lists YOUR TIME / BEST / VS GHOST (or the first-ghost note). The existing
  `RACE AGAIN` / `MAIN MENU` buttons need no change — `RACE AGAIN` calls `startRace()`
  (game.js:407-410), which re-runs `setup` against the freshly-saved ghost.
- `#hud-time` (game.js:1295, `formatTime(this.raceTime)`) already shows the live clock —
  no change; it *is* the time-trial timer.

---

## 6. Start / restart flow

1. **Menu → LAUNCH GRID** with `modeId === 'time_trial'`. `startRace()` builds the track,
   places only the player (`rivalCount = 0`), then `setup` loads the circuit's ghost,
   parks the translucent kart at sample 0, and resets the recorder.
2. **Countdown (3.4 s)** — `raceTime` is `0`; the ghost holds sample 0. Both launch on
   "GRID OPEN".
3. **Racing** — recorder samples the player at 10 Hz; the ghost replays the stored best
   by `raceTime`; VS GHOST updates live.
4. **Finish** — `checkEnd` ends immediately (solo). `onRacerFinish` compares to the best
   and, if faster, writes the new ghost + time. `results` shows the outcome.
5. **RACE AGAIN** → `startRace` → `clearRace` (`teardown` removes the old ghost) →
   `setup` (spawns the *updated* ghost). Chase your improved self.
6. **QUIT / MAIN MENU** → `returnMenu` → `clearRace` → `teardown` (ghost gone, standings
   HUD restored).

**Optional quick-restart (`R`):** the mode may add its own listener in `setup` and remove
it in `teardown` (`window.addEventListener('keydown', this._onKey)`), calling
`game.startRace()` when `game.playing && game.phase !== 'menu'`. Left out of the module
above to keep the surface minimal; add if playtesting wants instant retries.

---

## 7. Menu entry

The **mode selector** is registry-level (it chooses `this.mode`), not owned by
`TimeTrialMode`. Add a two-button toggle to the launch panel. Since `index.html` changes
in parallel, either the registry's menu installer injects it, or the HTML edit adds it —
both wire the same `data-mode` buttons.

HTML (inside `.launch-panel`, above `#btn-start` at index.html:149):
```html
<div class="mode-select">
  <span class="label">MODE</span>
  <button class="mode-pill active" data-mode="grand_prix" type="button">GRAND PRIX</button>
  <button class="mode-pill" data-mode="time_trial" type="button">TIME TRIAL</button>
</div>
```
Wiring (registry installer, or inside `bindUI` near the track/vehicle buttons,
game.js:382-398):
```js
import { MODES } from './modes/index.js';
document.querySelectorAll('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    this.modeId = btn.dataset.mode;
    this.mode = MODES[this.modeId] || this.mode;
    localStorage.setItem('gridrush_mode', this.modeId);
    this.refreshSelectionUI();   // update the RIVALS meta row (below)
  });
});
```
`refreshSelectionUI` (game.js:435) can show the mode's tagline in the RIVALS meta row
(index.html:146, `<b>5 AI</b>`): give it `id="meta-rivals"` and set
`this.mode.menuMeta ? this.mode.menuMeta(this) : '5 AI'` — so TIME TRIAL reads
`SOLO · BEST 1:24.21` (or `SOLO · NO GHOST YET`) per the selected circuit, pulled from
the cheap `gridrush_tt_records` aggregate. Circuit selection already calls
`refreshSelectionUI` (game.js:387), so switching circuits refreshes the best-time badge.

CSS: `.mode-pill` can reuse `.mode-btn.ghost` styling; `.active` mirrors the existing
`.circuit-card.active` treatment — no new tokens needed.

---

## 8. Verification checklist (post-integration)

Done = observed effect, not "it compiled":
1. Menu → **TIME TRIAL** → LAUNCH: exactly **one** kart on the grid, no AI cones; banner
   reads `TIME TRIAL · 3 LAPS · SET A GHOST` on a virgin circuit.
2. Finish a clean run → results show **NEW GHOST RECORD** + YOUR TIME; reload the page →
   `localStorage.gridrush_ghost_<circuit>` and `gridrush_tt_records[<circuit>]` present.
3. **RACE AGAIN** → a translucent kart launches with you and retraces run #1; the two
   karts diverge exactly where you drove differently.
4. **VS GHOST** goes green `-x.xx` when you pull ahead, red `+x.xx` when you fall behind,
   and reads `NO GHOST` on a circuit with no record.
5. Beat the time → results show `VS GHOST -x.xxs`; next RACE AGAIN chases the *new*
   (faster) ghost. Miss it → old ghost is kept, results show `+x.xxs`.
6. Switch circuit in the menu → RIVALS meta row shows that circuit's `SOLO · BEST …`
   (or NO GHOST YET); its ghost — not another circuit's — loads on launch.
7. QUIT to menu, start a Grand Prix → 6 karts, standings + position HUD back, no ghost,
   default results — i.e. the mode cleaned up fully (`teardown`).
8. Long run on GLASS HARBOR (longest circuit): ghost still ≤ ~0.1 MB in storage; no
   frame-rate drop from the ghost (one extra translucent mesh, no physics).
