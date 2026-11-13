# Grid Rush — Battle Arena / "DATA DUEL" Mode Spec

Status: DESIGN / ready-to-paste. Author does **NOT** edit `game.js`, `index.html`, or
`config.js` (changed in parallel — the mode-registry lands there). This doc delivers:
(1) the design decision for the arena, (2) the exact mode-registry contract + game.js
hook points I need, (3) the shield/KO data model, (4) how every offensive gadget
drains a shield (with the tiny `items.js` companion patch), (5) respawn/elimination,
(6) win conditions, (7) HUD additions, (8) menu routing, (9) the full self-contained
`runtime/modes/battle-arena.js` module, and (10) a verification checklist.

Line numbers cite the current files (read this session). Everything the parallel
mode-registry author must add is labeled **[registry work]**; the two `items.js` edits
are labeled **[items.js patch]**; the mode module itself is the only fully new file I
own here.

---

## 1. Design decision — the arena is the circuit ribbon, no laps

**Recommendation: reuse the active circuit's closed ribbon as the arena. Add no new
geometry. Remove laps.** Rationale (grounded in the code, not preference):

- **Walls already exist.** `projectRacer()` (game.js:1052-1062) clamps any racer whose
  `|lateral| > TRACK_HALF_WIDTH + 0.8` back onto the ribbon and kills the outward
  velocity component. That IS an enclosing wall on both edges of a closed loop — a
  bounded space with zero new collision code.
- **Physics is welded to the track.** `driveRacer()` calls `this.projectRacer(r)`
  (game.js:963) and sets `r.position.y` from `track.sampleAt()` (game.js:1050) every
  frame. A free-floating plaza would need a parallel physics/ground/wall path, and I am
  forbidden from editing `game.js`. Reusing the ribbon means the **entire existing
  driving model, hazard system, item pads, collisions, and unstick recovery keep
  working unchanged** — the mode only layers shields/KO/win-logic on top.
- **The loop is a legitimate combat ring.** Think roller-derby / F-Zero battle: 6 karts
  circulating one closed neon ribbon, dropping mines on the shared racing line, forking
  Volt Lash at whoever is `trackS`-ahead (already how `volt_lash` targets, items.js:167-169),
  EMP-blooming the pack, planting Gravity Wells on the line. Rubber-band physics
  (`rubberBandBehind` 1.12 / `rubberBandLead` 0.92, config.js:33-34) keeps the field from
  stringing out. Item pads and hazards are the ammo and the terrain.
- **"No laps" is a one-flag change.** The mode exposes `usesLaps = false`; the game skips
  `checkCheckpoints()` (so no lap increment, no finish line), hides the LAP HUD, and
  swaps the banner text. `trackS` still accumulates (used by `volt_lash` targeting and
  the minimap) — we simply never gate on it.

**Arena selection:** the player still picks a circuit and chassis on the existing menu;
in Battle mode that circuit's ribbon *is* the arena. Compact circuits (VOLT CANYON
radius 698, NULL SPIRE 756) give tighter, more aggressive duels; wide ones (GLASS
HARBOR 1034) give a looser brawl. No new arena content required for v1.

**Deferred (v2, needs game.js physics work — out of scope here):** a dedicated bounded
plaza (flat disc + ring wall) would require its own ground/wall projection to replace
`projectRacer`'s ribbon snap. Documented as future work; not shipped now because it
cannot be done without editing `game.js`.

---

## 2. Mode-registry contract + game.js hook points  **[registry work]**

The parallel work adds a mode registry and an active-mode slot to the game. This is the
contract the Battle mode is written against. **Race mode stays behaviourally identical**
— it is expressed as a thin default mode so the two share one code path.

### 2.1 New files the registry work creates

`runtime/modes/index.js`:
```js
import { RaceMode } from './race.js';
import { BattleArenaMode } from './battle-arena.js';

export const MODES = { race: RaceMode, battle: BattleArenaMode };
export const DEFAULT_MODE = 'race';
```

`runtime/modes/race.js` (thin wrapper — preserves today's lap race exactly):
```js
export const RaceMode = {
  id: 'race',
  usesLaps: true,
  // Everything else is the game's existing lap logic; no hooks needed.
  checkEnd(game) { return !!game.player?.finished; },
};
```

`runtime/modes/battle-arena.js` — the full module in §9 below.

### 2.2 Hooks the mode may implement (all optional, null-safe `?.`)

| Hook | When the game calls it | Battle mode uses it for |
|------|------------------------|-------------------------|
| `mode.setup(game)` | once in `startRace()`, **after** all racers are placed, **before** countdown | init shields/KO/timer, inject HUD, set banner, hide LAP HUD |
| `mode.teardown(game)` | in `clearRace()` | remove injected HUD, restore LAP HUD |
| `mode.update(game, dt)` | every racing frame, after item/collision resolution | timers, shield regen, gravity-well crush, respawns |
| `mode.onGadgetHit(game, victim, attackerId, kind)` | at each offensive-gadget *landing* | drain a shield, attribute KO |
| `mode.hudExtra(game)` | last line of `updateHud()` | paint shields / KO / match timer / KO feed |
| `mode.checkEnd(game)` | every racing frame (replaces the lap end-check) | decide match over + winner |
| `mode.results(game)` | top of `refreshResults()` | render the custom results screen |
| `mode.usesLaps` (property, not a call) | read wherever lap logic branches | `false` → skip laps/checkpoints/lap HUD |

Two of these — `onGadgetHit`, `teardown`, `results`, `hudExtra` — are **new** beyond the
five named in the brief; they are the minimum needed for a correct, attributable shield
system and a self-contained HUD. All are optional, so Race mode ignores them.

### 2.3 Exact game.js edits the registry work performs

**(a) Constructor** — after `this._spaceWasDown = false;` (game.js:125):
```js
    this.modeId = 'race';   // set by the menu (§8)
    this.mode = null;       // resolved from MODES in startRace()
```
Add the import near the top (with the other imports, ~line 20):
```js
import { MODES, DEFAULT_MODE } from './modes/index.js';
```

**(b) `startRace()`** — resolve + set up the mode. After the rival-creation loop
(after game.js:535, i.e. once `this.racers` is fully built) and before the phase/
countdown block:
```js
    this.mode = MODES[this.modeId] || MODES[DEFAULT_MODE];
    this.mode.setup?.(this);
```
Then gate the banner (game.js:550). Replace:
```js
    if (this.els.banner) this.els.banner.textContent = `${def.name} · ${LAPS} LAPS · DATA ORBS LIVE`;
```
with (Battle mode overwrites the banner in its `setup`, so only set the lap banner when
the mode uses laps):
```js
    if (this.els.banner && this.mode.usesLaps !== false)
      this.els.banner.textContent = `${def.name} · ${LAPS} LAPS · DATA ORBS LIVE`;
```

**(c) `clearRace()`** — teardown (game.js:476, before disposing the track):
```js
    this.mode?.teardown?.(this);
```

**(d) `update()` racing block** — four small insertions.

Guard the per-racer loop so downed racers are frozen (game.js:691, at the top of the
`for (const r of this.racers)` body):
```js
      for (const r of this.racers) {
        if (this.mode?.usesLaps === false && !r.alive) { this.syncMesh(r); continue; }
        if (!r.finished) {
          if (this.mode?.usesLaps !== false) this.checkCheckpoints(r);  // ← gate laps
          this.checkItemPads(r);
          this.checkHazards(r);
          this.unstickIfNeeded(r, dt);
        } else {
          this.syncMesh(r);
        }
      }
```
(Only two lines change: the `!r.alive` freeze guard, and wrapping `checkCheckpoints` in
`usesLaps !== false`. Everything else is the existing loop.)

Drive the mode after item resolution (right after the `this.itemWorld.update(...)` call
ends, game.js:710):
```js
      this.mode?.update?.(this, dt);
```

Replace the lap-specific end block (game.js:719-732) with a mode-aware version that is
**identical for Race mode** and mode-driven for Battle:
```js
      const laps = this.mode?.usesLaps !== false;
      if (this.phase === 'racing') {
        const over = this.mode?.checkEnd ? this.mode.checkEnd(this) : this.player?.finished;
        if (over) this.endRace();
      }
      if (this.phase === 'finished') {
        if (laps) {
          if (
            this.finishedOrder.length >= this.racers.length ||
            this.raceTime - this.player.finishTime > 18
          ) this._raceOver = true;
          this.refreshResults();
          if (this._raceOver) this.playing = false;
        } else {
          // Battle: results are frozen at match end; stop the sim, keep the overlay.
          this._raceOver = true;
          this.refreshResults();
          this.playing = false;
        }
      }
```

**(e) `updateHud()`** — skip the LAP field for non-lap modes and call `hudExtra` last.
Wrap the lap line (game.js:1293):
```js
    if (this.els.lap && this.mode?.usesLaps !== false)
      this.els.lap.innerHTML = `${Math.min(p.lap, LAPS)}<span class="unit">/ ${LAPS}</span>`;
```
Add as the final line of `updateHud()` (after the leaders block, game.js:1318):
```js
    this.mode?.hudExtra?.(this);
```

**(f) `refreshResults()`** — let the mode own the results DOM. At the very top of
`refreshResults()` (game.js:1382):
```js
    if (this.mode?.results) {
      const R = this.mode.results(this);
      if (this.els.resultsTitle) this.els.resultsTitle.textContent = R.title;
      if (this.els.resultsStats) this.els.resultsStats.innerHTML = R.rows.join('');
      return;
    }
```

That is the complete game.js surface — ~10 small, mode-gated insertions, none of which
change Race-mode behaviour.

---

## 3. Shield / KO data model

The `Racer` class (game.js:22-72) is **not** modified. JS objects are extensible, so the
mode attaches its own fields per racer in `setup()`/`_initRacer()`. Fields:

| Field on racer | Type | Meaning |
|----------------|------|---------|
| `shield` | int | current shields (starts `SHIELD_MAX = 3`) |
| `maxShield` | int | cap (3) |
| `kos` | int | KOs this racer has scored (win metric) |
| `timesKO` | int | times this racer has been knocked out (tiebreak) |
| `koState` | `'active' \| 'down' \| 'out'` | alive / respawning / eliminated |
| `downTimer` | float | seconds left while `'down'` (kos rules) |
| `hitFreeT` | float | seconds since last shield loss (drives regen) |
| `spawnGrace` | float | invulnerable seconds after (re)spawn |
| `_wellCd` | float | per-racer cooldown between gravity-well crush ticks |

Reused existing fields: **`alive`** (game.js:42) — set `false` on KO to freeze the racer
(`driveRacer` early-returns on `!r.alive`, game.js:822; `resolveCollisions` filters it,
game.js:991; `itemWorld.update` skips it, items.js:115). **`finished`/`finishTime`** —
set on elimination in survival rules so the existing ranking treats them as out.

Grep confirms `alive` is written **only** in the `Racer` constructor today, so the mode
fully owns its lifecycle — no other code toggles it.

---

## 4. How each offensive gadget drains a shield

**Choke point:** `applyStun()` (items.js:279-294) is the single truth for "an offensive
gadget actually landed" — it returns `'hit'` (landed), `'blocked'` (Static Veil ate it,
veil consumed), or `'phased'` (Phase Skate). Static Veil therefore protects a shield
**for free**: a blocked hit never becomes a shield loss because `onGadgetHit` only fires
on `'hit'`. That is the desired interaction (veil = a consumable 1-hit block; shield =
the KO health pool; the two stay independent).

### 4.1 Shield-damage table

| Gadget | Today's effect | Battle shield effect | Wiring path |
|--------|----------------|----------------------|-------------|
| **Pulse Mine** | contact stun via `itemWorld` onHit → `applyStun(r,1.0,0.45)` (game.js:703) | **−1** on detonation | game.js onHit forwards `res==='hit'` |
| **Volt Lash** | stuns racer ahead `applyStun(target,1.1,0.35)` (items.js:172) | **−1** | `items.js` `hit` event → tryUseItem forward |
| **EMP Bloom** | AoE stun `r<22`, `applyStun(o,1.35,0.5)` each (items.js:217) | **−1 per victim** | `items.js` `hit` event per victim |
| **Gravity Well** | pull field, no stun (items.js:78-96, 127-133) | **−1** if it drags you into the inner crush zone | `mode.update` scans `game.itemWorld.entities` |
| **Mirror Fog** | inverts victim steering (items.js:194) | **0** (kept as pure disruption; `SHIELD_DMG.mirror_fog=1` flips it on) | — |
| Data Siphon | steals a held gadget | 0 (utility) | — |
| Phase Skate / Overclock / Warp Anchor / Static Veil | self / defensive | 0 | — |

`SHIELD_DMG` lives in the module (§9) so the balance is one edit, not a hunt.

### 4.2 `items.js` companion patch  **[items.js patch]**

`items.js` is not one of the frozen files. Two tiny additions make `onGadgetHit`
attributable **and** veil-correct (today the `lash` event fires even when Veil blocked,
so forwarding raw events would wrongly drain a shield). Emit a uniform `hit` event
**only when the stun actually lands**.

**Volt Lash** — replace items.js:170-174:
```js
      if (target && target.id !== racer.id) {
        applyStun(target, 1.1, 0.35);
        events.push({ kind: 'lash', from: racer.id, to: target.id });
        events.push({ kind: 'toast', text: `VOLT LASH → ${target.callsign}`, who: racer.id });
```
with (capture the result; only emit `hit` on a real landing):
```js
      if (target && target.id !== racer.id) {
        const res = applyStun(target, 1.1, 0.35);
        events.push({ kind: 'lash', from: racer.id, to: target.id });
        if (res === 'hit') events.push({ kind: 'hit', to: target.id, by: racer.id, gadget: 'volt_lash' });
        events.push({ kind: 'toast', text: `VOLT LASH → ${target.callsign}`, who: racer.id });
```

**EMP Bloom** — in the landed (non-veil) branch, items.js:216-218:
```js
          } else {
            applyStun(o, 1.35, 0.5);
          }
```
becomes:
```js
          } else {
            applyStun(o, 1.35, 0.5);
            events.push({ kind: 'hit', to: o.id, by: racer.id, gadget: 'emp_bloom' });
          }
```

These are additive — no existing event or FX path changes, so Race mode is unaffected
(it just ignores the new `hit` events).

### 4.3 game.js forward sites  **[registry work]**

**Pulse Mine** — the mine `onHit` callback in `update()` already computes `res`
(game.js:702-710). It currently drops the `type`/`ownerId`/`speedKill` args that
`ItemWorld.update` passes (`onHit(r, 'pulse_mine', e.ownerId, 0.55)`, items.js:123).
Capture them and forward on a real hit:
```js
      this.itemWorld.update(dt, this.racers, (r, kind, ownerId, sk) => {
        const res = applyStun(r, 1.0, 0.45);
        if (res === 'hit') this.mode?.onGadgetHit?.(this, r, ownerId, kind || 'pulse_mine');
        if (r.isPlayer && res === 'hit') {
          this.flashToast('HIT — PULSE MINE');
          this.sfx.hit();
          this.fx.addShake(0.55);
          this.fx.burst(r.position, 0xff6b2b, 16, 14);
        }
      });
```

**Volt Lash / EMP Bloom** — `tryUseItem()` already iterates `result.events`
(game.js:1208). Add one branch that forwards the new `hit` events:
```js
      if (ev.kind === 'hit') {
        const v = this.racers.find((x) => x.id === ev.to);
        if (v) this.mode?.onGadgetHit?.(this, v, ev.by, ev.gadget);
      }
```

**Gravity Well** — no event; handled entirely inside `mode.update` by reading
`game.itemWorld.entities` (each well carries `ownerId`, `radius`, `pos`; items.js:87-95).

---

## 5. KO, respawn, elimination

### 5.1 Taking a shield hit — `onGadgetHit(game, victim, attackerId, kind)`
1. Ignore if `victim.koState !== 'active'` (already down/out) or `victim.spawnGrace > 0`
   (spawn i-frames).
2. `dmg = SHIELD_DMG[kind] ?? 1`; if `dmg <= 0` return (e.g. Mirror Fog).
3. `victim.shield -= dmg; victim.hitFreeT = 0;` small hit FX + shake if it's the player.
4. If `victim.shield <= 0` → **KO** (`_ko`). Else a small "shield down" toast for the
   player.

### 5.2 Knockout — `_ko(game, victim, attackerId)`
- `victim.shield = 0; victim.timesKO++;`
- Credit the attacker: `attacker.kos++` (skip self-KO and eliminated attackers).
- Big FX: `game.fx.burst(victim.position, victim.vehicle.color, 26, 18)`,
  `game.fx.empRing(victim.position, 0xffe566)`, `game.fx.addShake(0.5)` when the player
  is involved, `game.sfx.hit()`. Push a KO-feed entry `{by, who, t}`.
- **Freeze:** `victim.alive = false; victim.velocity.set(0,0,0); victim.speed = 0;
  victim.item = null;` (`driveRacer` early-returns on `!alive`, so the kart goes inert.)
- Toast: player KO'd → `KNOCKED OUT`; player scored a KO → `KO → <name>`.
- **Branch on rules:**
  - `survival` → `victim.koState = 'out'; victim.finished = true;
    victim.finishTime = game.raceTime;` (marks eliminated; the game's per-racer loop
    now just syncs their frozen mesh).
  - `kos` → `victim.koState = 'down'; victim.downTimer = KO_DOWN_TIME;` (will respawn).

### 5.3 Respawn (kos rules) — `_respawn(game, victim)`
Fired from `mode.update` when `downTimer` reaches 0. Place back on the centerline at the
victim's current `trackS` so they never respawn inside a wall/hazard:
```js
    const samp = game.track.sampleAt(victim.trackS);
    victim.position.copy(samp.pos);
    victim.position.y = samp.pos.y + 1.15;          // PHYSICS.hoverHeight
    victim._lastS = samp.s;                          // keep projectRacer from jumping trackS
    victim.yaw = Math.atan2(samp.tangent.x, samp.tangent.z);
    victim.velocity.set(0, 0, 0); victim.speed = 0;
    victim.shield = victim.maxShield;
    victim.koState = 'active'; victim.alive = true;
    victim.spawnGrace = SPAWN_GRACE;                 // brief i-frames
    victim.hitFreeT = 0; victim.stun = 0;
    victim.airborne = false; victim.hopY = 0; victim.vy = 0;
    game.fx.burst(victim.position, 0x39ff88, 16, 12);
    if (victim.isPlayer) game.flashToast('RESPAWN');
```
`spawnGrace` makes `onGadgetHit` a no-op while it ticks down, so you can't be
spawn-camped. Gravity-well crush and mine contact both respect it.

### 5.4 Downed-racer safety
While `alive === false`, the per-racer loop guard (§2.3d) skips
`checkHazards/checkItemPads/unstickIfNeeded` and only syncs the mesh, so a downed kart
can't pick up gadgets, get re-stunned, or be teleported by the unstick recovery. AI
`updateAI` already `continue`s on `!alive` via `driveRacer`'s early return; the guard
makes it explicit and cheap.

---

## 6. Win conditions — `checkEnd(game)` + tiebreaks

Two rule sets, chosen from the menu (§8). Default **`kos`** (timed, forgiving — the
player is never benched watching); **`survival`** is the classic last-standing toggle.

### `kos` — Most KOs in the time limit
- Match runs `MATCH_TIME` seconds (default 120). `checkEnd` returns `true` when
  `game.raceTime >= MATCH_TIME`.
- **Winner:** highest `kos`. Tiebreak: fewest `timesKO`, then most `shield` remaining.
- KO'd racers respawn (§5.3), so the field stays full and the clock decides it.

### `survival` — Last kart standing
- No respawn; a KO sets `koState='out'`.
- `checkEnd` returns `true` when the number of `koState !== 'out'` racers `<= 1`, **or**
  when the player is out (player-centric end, matching Race mode's "results the moment
  the player finishes" convention, game.js:720).
- **Winner:** the sole survivor if one remains; otherwise (player-out end) the current
  leader by (still-alive first, then `kos`, then `shield`).
- If the timer (`MATCH_TIME`, optional in survival) expires with multiple alive, fall
  back to the `kos` ranking.

`checkEnd` sets `this.over = true` and caches `this.winner` on first true so results are
stable across the frozen `finished` frames.

---

## 7. HUD additions

Two surfaces, both driven by `hudExtra(game)`:

**(a) A self-injected battle panel** — the mode injects its own DOM into `#hud` in
`setup()` and removes it in `teardown()`, exactly like `settings.js` injects its overlay
(the established repo pattern; see `docs/settings-spec.md` §3). No `index.html` edit
required. The panel shows:
- **Shield pips** for the player: `▮▮▮` → `▮▮▯` → `▮▯▯` … (filled/empty, `maxShield`
  wide), tinted by the player's vehicle color; flashes red on loss.
- **KO count**: `KO ×N` (the win metric).
- **Match timer**: `kos` → countdown `M:SS` (`MATCH_TIME − raceTime`, clamped ≥ 0);
  `survival` → `SURVIVAL · N LEFT` (alive count).
- **KO feed**: last ~3 entries, `A ▸ B` (attacker knocks out victim), auto-expiring.

**(b) Standings list** — `hudExtra` rebuilds the existing `#hud-leaders` list
(`els.leaders`, painted each frame by `updateHud`, game.js:1310) into battle standings:
each row shows rank, callsign, `shield` pips, and `×kos`, with the eliminated dimmed and
the player row marked `.me`. Because `hudExtra` is the **last** line of `updateHud`
(§2.3e), it wins over the default leader paint for Battle mode.

The LAP `.inst` block in `#bottom-cluster` is hidden in `setup()`
(`game.els.lap.closest('.inst').style.display='none'`) and restored in `teardown()`, so
the lap counter doesn't show in a mode with no laps.

---

## 8. Menu → mode routing

### 8.1 `index.html` markup  **[registry work / parallel HTML edit]**
Add a mode selector to the launch panel. Suggested placement: inside `.launch-panel`
(index.html:130), above the `CALLSIGN` label. Two `data-mode` buttons + a `data-rules`
toggle that only matters for Battle:
```html
<span class="label">MODE</span>
<div class="mode-select">
  <button class="mode-pick active" data-mode="race" type="button">GRID RACE · 3 LAPS</button>
  <button class="mode-pick" data-mode="battle" type="button">DATA DUEL · ARENA</button>
</div>
<div class="rules-select hidden" data-battle-only>
  <button class="rules-pick active" data-rules="kos" type="button">MOST KOs · 2:00</button>
  <button class="rules-pick" data-rules="survival" type="button">LAST STANDING</button>
</div>
```
The LAPS/RIVALS meta rows (index.html:145-146) can be swapped for MODE/RULES when Battle
is active — cosmetic; the bindUI wiring (§8.2) drives it. No CSS is strictly required
(`.mode-btn`/`.ghost` exist); style `.mode-pick`/`.rules-pick` to taste in `main.css`.

### 8.2 `bindUI()` wiring  **[registry work]**
Alongside the existing `[data-track]` / `[data-vehicle]` handlers (game.js:382-398):
```js
    document.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-mode]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.modeId = btn.dataset.mode;                       // 'race' | 'battle'
        const battle = this.modeId === 'battle';
        document.querySelectorAll('[data-battle-only]').forEach((el) => el.classList.toggle('hidden', !battle));
      });
    });
    document.querySelectorAll('[data-rules]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-rules]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.battleRules = btn.dataset.rules;                 // 'kos' | 'survival'
      });
    });
```
`this.battleRules` defaults to `'kos'` (set it next to `this.modeId` in the constructor,
§2.3a: `this.battleRules = 'kos';`). `startRace()` already reads `this.modeId` via the
registry (§2.3b); the Battle module reads `game.battleRules` in `setup()`. The existing
`#btn-start` LAUNCH button is unchanged — it calls `startRace()`, which now routes
through whichever mode is selected.

---

## 9. `runtime/modes/battle-arena.js` — full module (NEW FILE)

Self-contained. No `THREE` import needed (it mutates existing vectors and calls
`game.fx` / `game.track` / `game.sfx`). All tunables at the top.

```js
/* Grid Rush — Battle Arena / "DATA DUEL" mode.
 * Plugs into the mode-registry contract (docs/modes/battle-arena.md §2).
 * Arena = the active circuit's closed ribbon (walls = projectRacer lateral clamp);
 * NO laps. Offensive gadgets drain shields; 0 shields = KO. Win = last standing
 * (survival) or most KOs before the clock (kos).
 */

const BATTLE = Object.freeze({
  SHIELD_MAX: 3,
  KO_DOWN_TIME: 4.0,     // s knocked out before respawn (kos rules)
  SPAWN_GRACE: 2.2,      // s invulnerable after (re)spawn
  REGEN_TIME: 8.0,       // s hit-free to regen +1 shield (kos rules; 0 = disabled)
  MATCH_TIME: 120,       // s match length (kos rules)
  WELL_CRUSH_FRAC: 0.42, // inner fraction of a gravity well that crushes a shield
  WELL_HIT_CD: 1.2,      // s per-racer cooldown between well crush ticks
  DEFAULT_RULES: 'kos',  // 'kos' | 'survival'
  SHIELD_DMG: { pulse_mine: 1, volt_lash: 1, emp_bloom: 1, gravity_well: 1, mirror_fog: 0 },
});

const HUD_ID = 'gr-battle-hud';
const STYLE_ID = 'gr-battle-style';

function ord(n) { return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`; }
function pips(cur, max) {
  let s = '';
  for (let i = 0; i < max; i++) s += i < cur ? '▮' : '▯';
  return s;
}
function fmtClock(t) {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const BattleArenaMode = {
  id: 'battle',
  usesLaps: false,

  // ── lifecycle ──────────────────────────────────────────────────────────
  setup(game) {
    this.rules = game.battleRules === 'survival' ? 'survival' : BATTLE.DEFAULT_RULES;
    this.matchTime = BATTLE.MATCH_TIME;
    this.over = false;
    this.winner = null;
    this.koFeed = [];       // { by, who, t }
    this._flash = 0;        // player shield-loss flash timer

    for (const r of game.racers) this._initRacer(r);

    // Banner + hide the LAP HUD (no laps here).
    if (game.els.banner) {
      const arena = game.track?.def?.name || 'ARENA';
      const label = this.rules === 'survival' ? 'LAST STANDING' : `MOST KOs · ${fmtClock(this.matchTime)}`;
      game.els.banner.textContent = `DATA DUEL · ${arena} · ${label}`;
    }
    this._lapInst = game.els.lap?.closest?.('.inst') || null;
    if (this._lapInst) this._lapInst.style.display = 'none';

    this._injectHud(game);
  },

  teardown(game) {
    if (this._lapInst) this._lapInst.style.display = '';
    document.getElementById(HUD_ID)?.remove();
  },

  _initRacer(r) {
    r.maxShield = BATTLE.SHIELD_MAX;
    r.shield = BATTLE.SHIELD_MAX;
    r.kos = 0;
    r.timesKO = 0;
    r.koState = 'active';
    r.downTimer = 0;
    r.hitFreeT = 0;
    r.spawnGrace = BATTLE.SPAWN_GRACE;
    r._wellCd = 0;
    r.alive = true;
    r.finished = false;
  },

  // ── per-frame ──────────────────────────────────────────────────────────
  update(game, dt) {
    if (this.over) return;
    this._flash = Math.max(0, this._flash - dt);

    for (const r of game.racers) {
      r.spawnGrace = Math.max(0, r.spawnGrace - dt);
      r._wellCd = Math.max(0, r._wellCd - dt);

      if (r.koState === 'down') {
        r.downTimer -= dt;
        if (r.downTimer <= 0) this._respawn(game, r);
        continue;
      }
      if (r.koState !== 'active') continue;

      // Shield regen (kos rules only): hit-free for REGEN_TIME → +1 shield.
      if (this.rules === 'kos' && BATTLE.REGEN_TIME > 0 && r.shield < r.maxShield) {
        r.hitFreeT += dt;
        if (r.hitFreeT >= BATTLE.REGEN_TIME) {
          r.shield += 1;
          r.hitFreeT = 0;
          if (r.isPlayer) game.flashToast(`SHIELD +1 · ${r.shield}/${r.maxShield}`);
        }
      }
    }

    // Gravity-well crush: reading itemWorld directly (no event exists for wells).
    for (const e of game.itemWorld?.entities || []) {
      if (e.type !== 'gravity_well') continue;
      const crushR = e.radius * BATTLE.WELL_CRUSH_FRAC;
      for (const r of game.racers) {
        if (r.koState !== 'active' || r.spawnGrace > 0 || r._wellCd > 0) continue;
        if (r.id === e.ownerId) continue;
        if (r.position.distanceTo(e.pos) < crushR) {
          r._wellCd = BATTLE.WELL_HIT_CD;
          this.onGadgetHit(game, r, e.ownerId, 'gravity_well');
        }
      }
    }
  },

  // ── shield damage ──────────────────────────────────────────────────────
  onGadgetHit(game, victim, attackerId, kind) {
    if (!victim || victim.koState !== 'active' || victim.spawnGrace > 0) return;
    const dmg = BATTLE.SHIELD_DMG[kind] ?? 1;
    if (dmg <= 0) return;

    victim.shield -= dmg;
    victim.hitFreeT = 0;
    game.fx.burst(victim.position, 0xff2bd6, 8, 10);
    if (victim.isPlayer) { game.fx.addShake(0.28); this._flash = 0.4; }

    if (victim.shield <= 0) this._ko(game, victim, attackerId);
    else if (victim.isPlayer) game.flashToast(`SHIELD ${victim.shield}/${victim.maxShield}`);
  },

  _ko(game, victim, attackerId) {
    victim.shield = 0;
    victim.timesKO += 1;
    const attacker = game.racers.find((x) => x.id === attackerId);
    if (attacker && attacker !== victim && attacker.koState !== 'out') attacker.kos += 1;
    this.koFeed.unshift({ by: attacker?.callsign || 'ARENA', who: victim.callsign, t: 3.2 });
    this.koFeed.length = Math.min(this.koFeed.length, 4);

    game.fx.burst(victim.position, victim.vehicle.color, 26, 18);
    game.fx.empRing(victim.position, 0xffe566);
    if (victim.isPlayer || attacker?.isPlayer) game.fx.addShake(0.5);
    game.sfx.hit?.();

    victim.alive = false;
    victim.velocity.set(0, 0, 0);
    victim.speed = 0;
    victim.item = null;

    if (victim.isPlayer) game.flashToast('KNOCKED OUT');
    else if (attacker?.isPlayer) game.flashToast(`KO → ${victim.callsign}`);

    if (this.rules === 'survival') {
      victim.koState = 'out';
      victim.finished = true;
      victim.finishTime = game.raceTime;
    } else {
      victim.koState = 'down';
      victim.downTimer = BATTLE.KO_DOWN_TIME;
    }
  },

  _respawn(game, victim) {
    const samp = game.track.sampleAt(victim.trackS);
    victim.position.copy(samp.pos);
    victim.position.y = samp.pos.y + 1.15;
    victim._lastS = samp.s;
    victim.yaw = Math.atan2(samp.tangent.x, samp.tangent.z);
    victim.velocity.set(0, 0, 0);
    victim.speed = 0;
    victim.shield = victim.maxShield;
    victim.koState = 'active';
    victim.alive = true;
    victim.spawnGrace = BATTLE.SPAWN_GRACE;
    victim.hitFreeT = 0;
    victim.stun = 0;
    victim.airborne = false;
    victim.hopY = 0;
    victim.vy = 0;
    game.fx.burst(victim.position, 0x39ff88, 16, 12);
    if (victim.isPlayer) game.flashToast('RESPAWN');
  },

  // ── end + results ───────────────────────────────────────────────────────
  checkEnd(game) {
    if (this.over) return true;
    const aliveN = game.racers.filter((r) => r.koState !== 'out').length;

    if (this.rules === 'survival') {
      const playerOut = game.player && game.player.koState === 'out';
      if (aliveN <= 1 || playerOut) { this.over = true; this.winner = this._standings(game)[0]; return true; }
      return false;
    }
    // kos
    if (game.raceTime >= this.matchTime) { this.over = true; this.winner = this._standings(game)[0]; return true; }
    return false;
  },

  _standings(game) {
    // Alive first; then by KOs, fewer times-KO'd, more shields. In survival, an
    // eliminated racer's finishTime (later = higher) breaks ties among the out.
    return [...game.racers].sort((a, b) => {
      const ao = a.koState === 'out', bo = b.koState === 'out';
      if (ao !== bo) return ao ? 1 : -1;
      if (ao && bo) return (b.finishTime || 0) - (a.finishTime || 0);
      if (b.kos !== a.kos) return b.kos - a.kos;
      if (a.timesKO !== b.timesKO) return a.timesKO - b.timesKO;
      return b.shield - a.shield;
    });
  },

  results(game) {
    const rank = this._standings(game);
    const place = rank.findIndex((r) => r.id === game.player.id) + 1;
    const won = place === 1;
    const title = won
      ? 'GRID CROWN — DUEL WON'
      : `DATA DUEL · ${ord(place)} of ${rank.length}`;
    const rows = rank.map((r, i) => {
      const me = r.id === game.player.id ? ' style="color:#00f0ff"' : '';
      const out = r.koState === 'out' ? ' · OUT' : '';
      return `<div${me}>${i + 1}. ${r.callsign} — ${r.kos} KO · ${pips(Math.max(0, r.shield), r.maxShield)}${out} · ${r.vehicle.name}</div>`;
    });
    return { title, rows };
  },

  // ── HUD ──────────────────────────────────────────────────────────────────
  _injectHud(game) {
    if (!document.getElementById(STYLE_ID)) {
      const s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = `
      #${HUD_ID}{position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:8;
        display:flex;flex-direction:column;align-items:center;gap:.3rem;pointer-events:none;
        font-family:var(--font-display,"Orbitron",sans-serif);text-align:center;}
      #${HUD_ID} .bt-timer{font-size:1.5rem;font-weight:800;letter-spacing:.1em;color:#e8f7ff;
        text-shadow:0 0 12px #00f0ff88;}
      #${HUD_ID} .bt-stat{display:flex;gap:1.1rem;align-items:center;font-size:.8rem;letter-spacing:.08em;}
      #${HUD_ID} .bt-pips{font-size:1.05rem;letter-spacing:.12em;color:#00f0ff;text-shadow:0 0 8px #00f0ff;}
      #${HUD_ID} .bt-pips.hit{color:#ff2bd6;text-shadow:0 0 12px #ff2bd6;}
      #${HUD_ID} .bt-ko{color:#ffe566;}
      #${HUD_ID} .bt-feed{display:flex;flex-direction:column;gap:.15rem;font-family:var(--font-mono,"Share Tech Mono",monospace);
        font-size:.62rem;color:#c8dcffcc;letter-spacing:.04em;min-height:1.2em;}`;
      document.head.appendChild(s);
    }
    const host = game.els.hud || document.getElementById('hud');
    if (!host || document.getElementById(HUD_ID)) return;
    const el = document.createElement('div');
    el.id = HUD_ID;
    el.innerHTML =
      '<div class="bt-timer" data-bt="timer">0:00</div>' +
      '<div class="bt-stat"><span class="bt-pips" data-bt="pips">▮▮▮</span>' +
      '<span class="bt-ko" data-bt="ko">KO ×0</span></div>' +
      '<div class="bt-feed" data-bt="feed"></div>';
    host.appendChild(el);
    this._hud = {
      timer: el.querySelector('[data-bt="timer"]'),
      pips: el.querySelector('[data-bt="pips"]'),
      ko: el.querySelector('[data-bt="ko"]'),
      feed: el.querySelector('[data-bt="feed"]'),
    };
  },

  hudExtra(game) {
    const p = game.player;
    if (!p || !this._hud) return;

    // Timer / mode line
    if (this.rules === 'survival') {
      const aliveN = game.racers.filter((r) => r.koState !== 'out').length;
      this._hud.timer.textContent = `SURVIVAL · ${aliveN} LEFT`;
    } else {
      this._hud.timer.textContent = fmtClock(this.matchTime - game.raceTime);
    }

    // Player shields + KO
    this._hud.pips.textContent = pips(Math.max(0, p.shield), p.maxShield);
    this._hud.pips.classList.toggle('hit', this._flash > 0);
    this._hud.pips.style.color = this._flash > 0 ? '' : `#${p.vehicle.color.toString(16).padStart(6, '0')}`;
    this._hud.ko.textContent = `KO ×${p.kos}`;

    // KO feed (expiring)
    for (const f of this.koFeed) f.t -= 1 / 60;
    this.koFeed = this.koFeed.filter((f) => f.t > 0);
    this._hud.feed.innerHTML = this.koFeed.map((f) => `${f.by} ▸ ${f.who}`).join('<br>');

    // Standings list (override the default leader paint for battle)
    if (game.els.leaders) {
      const rank = this._standings(game);
      game.els.leaders.innerHTML = rank
        .map((r, i) => {
          const me = r.id === p.id ? ' me' : '';
          const dim = r.koState === 'out' ? ' style="opacity:.45"' : '';
          return `<div class="${me}"${dim}><span class="pos">${i + 1}</span>${r.callsign} ${pips(Math.max(0, r.shield), r.maxShield)} ×${r.kos}</div>`;
        })
        .join('');
    }
  },
};
```

Note: `hudExtra`'s KO-feed decay uses a fixed `1/60` step for simplicity; if you want
frame-rate-independent decay, move the `f.t -= dt` into `update(game, dt)` instead (the
mode already iterates there) and leave `hudExtra` read-only.

---

## 10. Config note

`config.js` is **not** edited — all Battle tunables live in the `BATTLE` object at the
top of the module (§9). If you later prefer them centralized, export a `BATTLE` block
from `config.js` and import it here; the module is the single source for now so balance
changes are one file. The mode reuses `TRACKS`/`VEHICLES`/`ITEMS`/`PHYSICS` exactly as
Race mode does — Battle changes *rules*, not content.

---

## 11. Verification checklist (observed effect, not "it compiled")

1. Menu shows MODE selector; picking **DATA DUEL** reveals the RULES toggle; LAUNCH
   starts a match on the selected circuit + chassis.
2. Banner reads `DATA DUEL · <ARENA> · MOST KOs · 2:00` (or `LAST STANDING`); the LAP
   counter is gone from the bottom cluster.
3. Battle HUD shows a centered timer, 3 shield pips, `KO ×0`, and an (empty) KO feed.
4. Drive into a rival's **Pulse Mine** → lose exactly 1 pip; **Volt Lash** from behind →
   the racer ahead loses 1 pip; **EMP Bloom** in a pack → every non-veiled kart in range
   loses 1 pip; **Gravity Well** → a kart dragged into the core loses 1 pip (once per
   ~1.2 s), and never the owner.
5. **Static Veil** up → the next offensive gadget consumes the veil and costs **no**
   shield (blocked, not a hit).
6. Third pip lost → KO: explosion FX, `KNOCKED OUT`/`KO → NAME` toast, KO feed gains
   `A ▸ B`, attacker's `KO ×N` increments.
7. `kos` rules: KO'd kart is frozen ~4 s then respawns on the centerline with full
   shields and ~2 s i-frames (a gadget fired during grace does nothing). Timer hits 0 →
   results, winner = most KOs.
8. `survival` rules: KO'd karts stay out (dimmed in standings); match ends when one kart
   remains or the player is out; results title = `GRID CROWN — DUEL WON` when the player
   is last standing.
9. Standings list shows per-kart shield pips + `×kos`, player highlighted, eliminated
   dimmed.
10. Return to menu, pick **GRID RACE**, launch → the classic 3-lap race is byte-for-byte
    unchanged (mode selector defaulting to `race`, `usesLaps` true, no battle HUD).
```

