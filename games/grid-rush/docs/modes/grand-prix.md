# Grid Rush — GRAND PRIX (CUP) Mode Spec

Status: **DESIGN / ready-to-paste.** Author does NOT edit `runtime/game.js`,
`index.html`, or `runtime/config.js` (changed in parallel). This doc gives
(1) the thin-wrapper principle, (2) the exact mode-registry contract + where the
engine calls each hook (function + current line), (3) the series-state shape +
points table, (4) a self-contained `runtime/modes/grand-prix.js` module, (5) the
between-race **CUP STANDINGS** and final **CHAMPION** screens (self-injected DOM +
CSS, since `index.html`/`main.css` are off-limits), and (6) the precise
`game.js` / `index.html` paste points for whoever owns those files.

Design goal: **a Grand Prix is a series wrapper, not a new race.** The engine still
owns exactly ONE race at a time — `startRace()` builds it, `checkCheckpoints()`
finishes racers, the `phase==='finished'` block ends it. The mode owns the loop
*around* that race: pick the next circuit, award points, show standings, call
`startRace()` again, and after circuit #5 crown a champion. No physics, AI, item,
HUD, or race-end code is duplicated.

---

## 1. The single-race lifecycle the mode rides on

Everything the mode plugs into already exists in `game.js` today:

| Stage | Code (current line) | What it does the mode reuses |
|---|---|---|
| Build a race | `startRace()` @ **501** | Reads `this.trackId` (**508**), rebuilds `Track`, spawns player `'local'` + bots `'bot-0'…'bot-4'` (**514, 523**), resets `finishedOrder=[]` / `_raceOver` (**537-538**), `phase='countdown'`. |
| Racer crosses line | `checkCheckpoints()` @ **1077-1086** | Sets `r.finished=true`, `r.finishTime`, pushes `r.id` into `this.finishedOrder` in **crossing order** (**1081**). |
| Player finishes → results | `endRace()` @ **1373** | `phase='finished'`, shows `#results` overlay while AI keep racing. |
| Race truly over | `update()` finished block @ **723-732** | Flips `_raceOver` when the whole field is in **or** 18 s grace elapses (**724-728**), then `this.playing=false` (**731**). |
| Ranking | `ranking()` @ **1242** | Full field sorted: finished by `finishTime`, then non-finished (DNF) by `progress`. |
| Back to menu | `returnMenu()` @ **628** | Tears down the race, shows menu. |

Two facts that make the wrapper safe:

- **Racer ids are stable across every race** — player is always `'local'`, bots are
  always `'bot-0'…'bot-4'` (`startRace()` **514/523**). So points keyed by `id`
  accumulate reliably from circuit to circuit.
- **`this.trackId` is read once at the top of `startRace()` (508).** Set it *before*
  calling `startRace()` and the engine builds whatever circuit you point it at —
  that single line is the entire chaining mechanism.

---

## 2. Mode-registry contract + exact engine hook points

The registry adds one slot, `this.mode` (default `null`), and calls five optional
hooks. Each hook is a one-line `this.mode?.hook?.(…)` insertion — the engine has no
GP-specific code, so single-race play is byte-for-byte unchanged when `mode===null`.

```js
// The contract this mode implements:
mode.setup(game)              // once, when the player launches a cup
mode.onRacerFinish(game, r)   // optional flavor — each racer crosses the line
mode.update(game, dt)         // per-frame (reserved; no-op for GP)
mode.hudExtra(game)           // per-frame — inject "RACE n/5" onto the HUD
mode.checkEnd(game)           // once, the frame the race is truly over
```

| Hook | Engine call site (function @ current line) | Exact line to add |
|---|---|---|
| `setup` | new `#btn-grand-prix` handler in `bindUI()` (add near **403**) | `this.mode = createGrandPrix(); this.mode.setup(this); this.startRace();` |
| `onRacerFinish` | `checkCheckpoints()`, right after `this.finishedOrder.push(r.id)` @ **1081** | `this.mode?.onRacerFinish?.(this, r);` |
| `update` | `update()` racing/finished block, after `this.updateHud();` @ **714** | `this.mode?.update?.(this, dt);` |
| `hudExtra` | end of `updateHud()`, before the closing `}` @ **1319** | `this.mode?.hudExtra?.(this);` |
| `checkEnd` | `update()` finished block @ **731** (see §6 for the 3-line wrap) | `this.mode?.checkEnd?.(this);` |

`checkEnd` firing exactly once: `update()` only runs while `this.playing` is true
(`animate()` gate @ **648**). The finished block sets `this.playing=false` on the
transition frame, so the very next `animate()` frame skips `update()`. Calling
`checkEnd` immediately after `this.playing=false` therefore fires it once; the mode
*also* guards with a `scored` flag so it is idempotent regardless.

---

## 3. Series state, points, circuit order

```js
export const CUP_ORDER = [           // all 5 circuits, back-to-back
  'prism_boulevard',                 // downtown ribbon (easy opener)
  'volt_canyon',                     // tight gorge
  'glass_harbor',                    // wide coastal cruise
  'null_spire',                      // vertical figure-eight
  'echo_yards',                      // industrial freight loops (finale)
];

// Points by finishing PLACE (index 0 = 1st). 6 racers → 6 entries.
// 10→8 gap rewards the win; smooth 1-pt steps below keep mid-pack races meaningful.
export const CUP_POINTS = [10, 8, 6, 5, 4, 3];
```

The live series object (created in `setup`, lives on the mode instance):

```js
series = {
  order:   CUP_ORDER.slice(), // circuit ids in run order
  index:   0,                 // 0-based index of the circuit in progress
  points:  {},                // racerId -> cumulative cup points
  names:   {},                // racerId -> callsign (last seen; for display)
  vehicles:{},                // racerId -> chassis name (for display)
  wins:    {},                // racerId -> race wins (1st tiebreak)
  lastRank:{},                // racerId -> place in the most recent race (2nd tiebreak)
  lastAward:{},               // racerId -> points from the race just scored (the "+N")
  scored:  false,             // has the CURRENT race been scored yet?
};
```

**Championship sort** (used on every standings render): `points` desc → `wins` desc
→ `lastRank` asc. Deterministic, no coin-flips.

---

## 4. `runtime/modes/grand-prix.js` (self-contained, paste-ready)

Reuses the existing `.screen .hidden .results-panel .results-title .results-stats
.mode-btn .ghost` classes (already in `main.css`) for free, and injects only a
small `#gp-*` style block for the bits those classes don't cover. Nothing here
touches physics, AI, items, or the renderer.

```js
/**
 * Grid Rush — GRAND PRIX (CUP) mode.
 * A thin wrapper over the single-race pipeline: run all 5 circuits back-to-back,
 * award points by finishing place, accumulate, crown a champion.
 * Implements the mode-registry contract:
 *   setup · onRacerFinish · update · hudExtra · checkEnd
 * The engine owns ONE race; this mode owns the SERIES around it.
 */
import { TRACKS } from '../config.js';

export const CUP_ORDER = [
  'prism_boulevard', 'volt_canyon', 'glass_harbor', 'null_spire', 'echo_yards',
];
export const CUP_POINTS = [10, 8, 6, 5, 4, 3]; // by place, index 0 = 1st

export function createGrandPrix() {
  return {
    id: 'grand_prix',
    label: 'GRAND PRIX',
    series: null,
    _overlay: null,
    _hud: null,
    _atChampion: false,

    // ── lifecycle ─────────────────────────────────────────────────────────
    /** Called ONCE by the menu handler. Inits series + points the engine at
     *  circuit #1. Caller invokes game.startRace() immediately after. */
    setup(game) {
      this.series = {
        order: CUP_ORDER.slice(),
        index: 0,
        points: {}, names: {}, vehicles: {}, wins: {}, lastRank: {}, lastAward: {},
        scored: false,
      };
      this._injectStyle();
      this._ensureOverlay(game);
      this._ensureHud(game);
      game.trackId = this.series.order[0]; // engine reads this in startRace()
    },

    /** Optional flavor: one toast when the PLAYER crosses the line. Core scoring
     *  does NOT depend on this — checkEnd derives everything from game state. */
    onRacerFinish(game, racer) {
      if (racer.isPlayer) {
        game.flashToast?.(`CUP RACE ${this.series.index + 1}: P${game.finishedOrder.length}`);
      }
    },

    /** Reserved per-frame hook. GP needs nothing here (series advances on
     *  race-over only) — kept a no-op so the contract stays symmetric. */
    update(_game, _dt) {},

    /** Per-frame HUD line: "GRAND PRIX · RACE n/5". */
    hudExtra(game) {
      const s = this.series;
      if (!s || !this._hud) return;
      this._hud.textContent = `GRAND PRIX · RACE ${s.index + 1}/${s.order.length}`;
    },

    /** Called once, the frame the race is truly over (_raceOver). Scores the
     *  race, then shows standings (or the champion screen after circuit #5). */
    checkEnd(game) {
      const s = this.series;
      if (!s || s.scored) return true;
      s.scored = true;

      const order = this._classify(game); // finishers (crossing order) + DNF by progress
      s.lastAward = {};
      order.forEach((r, i) => {
        const pts = CUP_POINTS[i] || 0;
        s.lastAward[r.id] = pts;
        s.points[r.id] = (s.points[r.id] || 0) + pts;
        s.names[r.id] = r.callsign;
        s.vehicles[r.id] = r.vehicle?.name || '';
        s.lastRank[r.id] = i + 1;
      });
      const winId = order[0]?.id;
      if (winId) s.wins[winId] = (s.wins[winId] || 0) + 1;

      if (s.index >= s.order.length - 1) this._showChampion(game);
      else this._showStandings(game);
      return true;
    },

    // ── internals ─────────────────────────────────────────────────────────
    /** Full 6-deep classification: engine's crossing order first, DNF (never
     *  crossed) appended by remaining track progress. */
    _classify(game) {
      const finishers = game.finishedOrder
        .map((id) => game.racers.find((r) => r.id === id))
        .filter(Boolean);
      const dnf = game.racers
        .filter((r) => !game.finishedOrder.includes(r.id))
        .sort((a, b) => b.progress - a.progress);
      return finishers.concat(dnf);
    },

    _standings(s) {
      return Object.keys(s.points)
        .map((id) => ({
          id, pts: s.points[id], name: s.names[id] || id,
          veh: s.vehicles[id] || '', wins: s.wins[id] || 0, last: s.lastRank[id] || 99,
          add: s.lastAward[id] || 0,
        }))
        .sort((a, b) => b.pts - a.pts || b.wins - a.wins || a.last - b.last);
    },

    /** Advance to the next circuit and RE-RUN THE SINGLE-RACE PIPELINE. */
    _continue(game) {
      const s = this.series;
      s.index += 1;
      s.scored = false;
      this._hide();
      game.els.results?.classList.add('hidden');
      game.trackId = s.order[s.index]; // ← the whole chaining trick
      game.startRace();                // ← reuse everything
    },

    _restart(game) {           // "RUN IT BACK" on the champion screen
      this._hide();
      this.setup(game);
      game.startRace();
    },

    _finishSeries(game) {      // leave GP, back to menu
      this._hide();
      this._atChampion = false;
      game.mode = null;
      game.returnMenu();
    },

    _hide() { this._overlay?.classList.add('hidden'); },

    // ── screens (self-injected DOM) ───────────────────────────────────────
    _ensureOverlay(game) {
      if (this._overlay) return;
      const el = document.createElement('div');
      el.id = 'gp-standings';
      el.className = 'screen hidden';
      el.innerHTML =
        `<div class="results-panel gp-panel">
           <div id="gp-title" class="results-title">CUP STANDINGS</div>
           <div id="gp-sub" class="gp-sub"></div>
           <div id="gp-rows" class="results-stats gp-rows"></div>
           <div id="gp-next" class="gp-next"></div>
           <div class="gp-btns">
             <button id="gp-continue" class="mode-btn" type="button">CONTINUE</button>
             <button id="gp-quit" class="mode-btn ghost" type="button">QUIT CUP</button>
           </div>
         </div>`;
      (document.getElementById('app') || document.body).appendChild(el);
      el.querySelector('#gp-continue').addEventListener('click', () => {
        if (this._atChampion) this._finishSeries(game);
        else this._continue(game);
      });
      el.querySelector('#gp-quit').addEventListener('click', () => {
        if (this._atChampion) this._restart(game);
        else this._finishSeries(game);
      });
      this._overlay = el;
    },

    _rowsHtml(rows, { crown = false } = {}) {
      return rows
        .map((r, i) => {
          const me = r.id === 'local' ? ' me' : '';
          const tag = crown && i === 0 ? '♛ ' : '';
          const add = r.add ? `<span class="gp-add">+${r.add}</span>` : '';
          return `<div class="gp-row${me}">
                    <span class="gp-pos">${i + 1}</span>
                    <span class="gp-name">${tag}${r.name}</span>
                    <span class="gp-veh">${r.veh}</span>
                    ${add}
                    <span class="gp-pts">${r.pts}</span>
                  </div>`;
        })
        .join('');
    },

    _showStandings(game) {
      const s = this.series;
      this._atChampion = false;
      const done = TRACKS[s.order[s.index]]?.name || 'CIRCUIT';
      const nextName = TRACKS[s.order[s.index + 1]]?.name || '';
      this._overlay.querySelector('#gp-title').textContent = 'CUP STANDINGS';
      this._overlay.querySelector('#gp-sub').textContent =
        `${done} COMPLETE · RACE ${s.index + 1}/${s.order.length}`;
      this._overlay.querySelector('#gp-rows').innerHTML =
        this._rowsHtml(this._standings(s));
      this._overlay.querySelector('#gp-next').textContent = `NEXT ▸ ${nextName}`;
      this._overlay.querySelector('#gp-continue').textContent = 'CONTINUE';
      this._overlay.querySelector('#gp-quit').textContent = 'QUIT CUP';
      game.els.results?.classList.add('hidden');
      this._overlay.classList.remove('hidden');
    },

    _showChampion(game) {
      const s = this.series;
      this._atChampion = true;
      const rows = this._standings(s);
      const champ = rows[0];
      this._overlay.querySelector('#gp-title').textContent =
        champ.id === 'local' ? 'GRID CHAMPION — YOU' : `GRID CHAMPION — ${champ.name}`;
      this._overlay.querySelector('#gp-sub').textContent =
        `${s.order.length}-CIRCUIT CUP · FINAL STANDINGS`;
      this._overlay.querySelector('#gp-rows').innerHTML =
        this._rowsHtml(rows, { crown: true });
      this._overlay.querySelector('#gp-next').textContent = '';
      this._overlay.querySelector('#gp-continue').textContent = 'MAIN MENU';
      this._overlay.querySelector('#gp-quit').textContent = 'RUN IT BACK';
      game.els.results?.classList.add('hidden');
      this._overlay.classList.remove('hidden');
    },

    // ── HUD chip + injected style ─────────────────────────────────────────
    _ensureHud(game) {
      if (this._hud) return;
      const el = document.createElement('div');
      el.id = 'gp-hud';
      (game.els.hud || document.getElementById('hud'))?.appendChild(el);
      this._hud = el;
    },

    _injectStyle() {
      if (document.getElementById('gp-style')) return;
      const st = document.createElement('style');
      st.id = 'gp-style';
      st.textContent = `
        #gp-hud{position:absolute;top:54px;left:50%;transform:translateX(-50%);
          font:700 13px/1 'Orbitron',sans-serif;letter-spacing:.14em;color:#00f0ff;
          text-shadow:0 0 10px rgba(0,240,255,.6);pointer-events:none;z-index:6}
        #gp-standings .gp-sub{font:600 12px/1.4 'Share Tech Mono',monospace;
          letter-spacing:.18em;color:#ff8ad8;opacity:.85;margin:-.25rem 0 .75rem}
        #gp-standings .gp-rows{display:flex;flex-direction:column;gap:.28rem}
        #gp-standings .gp-row{display:grid;
          grid-template-columns:1.6rem 1fr auto 2.4rem 2.6rem;align-items:center;
          gap:.5rem;padding:.32rem .55rem;border:1px solid rgba(0,240,255,.14);
          border-radius:7px;background:rgba(6,4,18,.55);
          font:600 13px/1 'Share Tech Mono',monospace;color:#e8f7ff}
        #gp-standings .gp-row.me{border-color:#00f0ff;
          background:rgba(0,240,255,.12);box-shadow:0 0 14px rgba(0,240,255,.25)}
        #gp-standings .gp-pos{color:#ff2bd6;font-weight:800;text-align:center}
        #gp-standings .gp-veh{color:#8aa;font-size:11px;opacity:.8}
        #gp-standings .gp-add{color:#39ff88;font-size:11px;text-align:right}
        #gp-standings .gp-pts{color:#ffe566;font-weight:800;text-align:right;
          font-size:15px}
        #gp-standings .gp-next{margin:.85rem 0 .35rem;text-align:center;
          font:700 14px/1 'Orbitron',sans-serif;letter-spacing:.16em;color:#39ff88;
          text-shadow:0 0 10px rgba(57,255,136,.5)}
        #gp-standings .gp-btns{display:flex;gap:.6rem;justify-content:center;
          margin-top:.4rem}`;
      document.head.appendChild(st);
    },
  };
}
```

Optional tiny registry (`runtime/modes/index.js`) if the engine wants a lookup map:

```js
import { createGrandPrix } from './grand-prix.js';
export const MODES = { grand_prix: createGrandPrix };
```

---

## 5. The two screens

**CUP STANDINGS** (after circuits 1-4) reuses the `#results` panel chrome and reads:

```
              CUP STANDINGS
     VOLT CANYON COMPLETE · RACE 2/5
   1  RIX-7        GLASS PHANTOM  +10   18
   2  YOU          PRISM SLED     +8    15   ← highlighted row (id 'local')
   3  HALO         VOLT RUNNER    +6    12
   …
             NEXT ▸ GLASS HARBOR
        [ CONTINUE ]   [ QUIT CUP ]
```

- Columns: place · callsign · chassis · **+points this race** (green) · **cup total** (yellow).
- Sorted by cup total (championship sort from §3), player row lit in brand cyan.
- `CONTINUE` → `_continue()` → sets `trackId` to `NEXT` and calls `startRace()`.
- `QUIT CUP` → `_finishSeries()` → `game.returnMenu()`.

**CHAMPION** (after circuit 5) same panel, different copy: title `GRID CHAMPION —
YOU` / `— <name>`, a crown (♛) on P1, no NEXT line, buttons relabelled to
`MAIN MENU` (→ menu) and `RUN IT BACK` (→ `_restart()`, fresh cup from circuit 1).

Because both screens live in a mode-owned `#gp-standings` overlay, the engine's own
`#results` overlay (shown by `endRace()` the instant the player crosses) is simply
hidden by `checkEnd` when the standings appear — giving a clean two-beat: *your
race result* → *the cup standings*.

---

## 6. Exact `game.js` / `index.html` paste points

Ten one-to-three-line insertions; every one is guarded by `this.mode?.…?.()`, so
single-race play is unaffected when no cup is running.

**`game.js`**

1. **Import** — after the existing imports (top, ~**20**):
   ```js
   import { createGrandPrix } from './modes/grand-prix.js';
   ```
2. **Default slot** — in the constructor, after `this.phase = 'menu';` (**110**):
   ```js
   this.mode = null;
   ```
3. **Isolate single race** — inside the `#btn-start` handler (**400-403**), first line:
   ```js
   this.mode = null; // a normal launch clears any leftover cup
   ```
4. **Menu entry** — in `bindUI()`, right after the `#btn-start` handler (**403**):
   ```js
   document.getElementById('btn-grand-prix')?.addEventListener('click', () => {
     this.sfx.resume();
     this.mode = createGrandPrix();
     this.mode.setup(this);  // inits series, sets this.trackId = CUP_ORDER[0]
     this.startRace();       // engine builds circuit #1
   });
   ```
5. **`update` hook** — in `update()`, after `this.updateHud();` (**714**):
   ```js
   this.mode?.update?.(this, dt);
   ```
6. **`onRacerFinish` hook** — in `checkCheckpoints()`, right after
   `this.finishedOrder.push(r.id)` (**1081**):
   ```js
   this.mode?.onRacerFinish?.(this, r);
   ```
7. **`checkEnd` hook** — in the `phase==='finished'` block, replace line **731**
   (`if (this._raceOver) this.playing = false;`) with:
   ```js
   if (this._raceOver) {
     this.playing = false;
     this.mode?.checkEnd?.(this);
   }
   ```
8. **`hudExtra` hook** — at the end of `updateHud()`, before its closing `}` (**1319**):
   ```js
   this.mode?.hudExtra?.(this);
   ```
9. **Clean quit** — in `returnMenu()` (**628-642**), first line of the body:
   ```js
   this.mode = null; // abandoning a cup (pause → QUIT TO MENU) drops the series
   ```

**`index.html`**

10. **Button** — in the launch panel, right after `#btn-start` (**149**):
    ```html
    <button id="btn-grand-prix" class="mode-btn ghost" type="button">
      ⚑ GRAND PRIX · 5-CIRCUIT CUP
    </button>
    ```

---

## 7. Chaining flow

```
menu ─[⚑ GRAND PRIX]─▶ setup(game)            series.index=0, trackId=CUP_ORDER[0]
                        startRace()            ← engine builds circuit #1
                          │
              ┌───────────┴─ race runs (physics/AI/items/HUD all stock) ─┐
              │  onRacerFinish×N (flavor)   hudExtra "RACE n/5" each frame │
              └───────────┬──────────────────────────────────────────────┘
             _raceOver → playing=false → checkEnd(game)
                          │  score race (classify → +CUP_POINTS → totals)
             index<4 ?  ──┤
               yes → _showStandings ─[CONTINUE]─▶ index++ ; trackId=next ; startRace() ─┐
                └────────────────────────────────────────────────────────────────────┘ loop
               no  → _showChampion ─[MAIN MENU]─▶ _finishSeries → returnMenu()
                                   └[RUN IT BACK]▶ _restart → setup + startRace()
```

`_continue()` is the loop: bump `index`, clear `scored`, set `trackId`, call the
untouched `startRace()`. That single call rebuilds the track, respawns the same six
ids, resets `finishedOrder`/`_raceOver`, and runs the exact same race code — the cup
is nothing more than five of those calls with a standings screen between each.

---

## 8. Edge cases (handled)

- **DNF scoring.** `checkEnd` classifies via `game.finishedOrder` (finishers, exact
  crossing order) then appends non-finishers by `progress`. A racer stuck at the
  18 s grace still gets the correct low points; nobody is skipped, no place is
  double-awarded (`scored` flag makes it idempotent).
- **Quit mid-cup.** `QUIT CUP`, `MAIN MENU`, or pause → `QUIT TO MENU` all route to
  `returnMenu()`, which nulls `this.mode` (edit #9). The next single race is clean.
- **Single race untouched.** All hooks are `this.mode?.…?.()`; `#btn-start` nulls the
  mode (edit #3). With `mode===null` the engine behaves exactly as today.
- **Id stability.** Points key on `'local'`/`'bot-i'`, which `startRace()` re-issues
  identically every circuit — totals accumulate correctly across all five.
- **Ties.** Championship sort breaks ties deterministically: points → wins →
  most-recent-race place. No random tiebreak.
- **`checkEnd` fire-once.** Called on the frame `playing` flips false (so `update()`
  won't run again) *and* guarded by `scored` — belt and suspenders.
- **No CSS/markup edits.** The standings/champion overlay and HUD chip are DOM the
  mode injects into `#app`/`#hud`, styled by an injected `#gp-style` block plus the
  existing `.results-panel`/`.mode-btn` classes. Nothing in `index.html`/`main.css`
  needs to change beyond the one menu button.
```
