# Grid Rush — Settings System Spec

Status: DESIGN / ready-to-paste. Author does NOT edit `game.js`, `index.html`, or
`styles/main.css` (changed in parallel). This doc gives (1) the established
ForgeFlow settings pattern, (2) the exact state/config fields to add, (3) a
self-contained `runtime/settings.js` module, and (4) precise game.js / audio.js
hook points (function + current line) for every setting.

---

## 1. Pattern other ForgeFlow games use

There is **no shared settings component** (no `settings.js`/`options.js` in
`game_controls.js`; grep for `games/*/**/settings*.js` → none). Two games own the
canonical in-game settings pattern; everything else only uses the shared shell.

### Shared shell — `game_controls.js` (every game, loaded before game code)
Floating bottom-right bar with **Fullscreen / Mute / Pause / Report-Bug** only.
- Universal mute wraps `Audio` + `AudioContext` constructors and broadcasts a
  `window` `"mutechange"` `CustomEvent` (`detail.muted`). Grid Rush already listens
  (`wireMute()`, game.js:355). Mute is persisted at `localStorage["ff_muted"]`.
- Blocks the page context menu with a capturing `contextmenu` `preventDefault`
  (game_controls.js:65) — so **right-mouse-button is free for gameplay** (needed for
  the cruise-steer feature below; no context menu will pop).
- Drives `window.__PAUSE__.toggle()` (Grid Rush exposes it at game.js:362).

The shell is NOT a settings menu — volumes, sensitivity, FOV, keybinds are each
game's own responsibility.

### Canonical settings pattern — Last Circle (`runtime/3d/royale/hud.js`)
The strongest reference. Copy this shape.
- **One settings object** `W.settings`, loaded once with defaults merged over a
  single JSON blob:
  `Object.assign(def, JSON.parse(localStorage.getItem("lc_settings")||"{}"))`
  (ffg_royale3d.js:232-233). Defaults: `{ masterVol:0.8, musicVol:0.5, sfxVol:0.9,
  sensitivity:1.0, adsSensitivity:0.8, graphics:"medium", ... }`.
- **`showSettings(W)`** builds an overlay (`layer("settings", {zIndex:60})`) with a
  reusable **`slider(box, label, val, onChange)`** helper — a `range` input
  `min0 max1 step0.01` plus a live `NN%` readout (hud.js:1439-1446).
- Live-apply on change: `applyAudio(W)` pushes volumes into the audio graph,
  `applyGraphics(W)` retunes the renderer; **`save(W)`** writes the whole blob back to
  `localStorage["lc_settings"]` (hud.js:1447-1460).
- Sensitivity is read at use-site every frame:
  `sens = (ads ? adsSensitivity : sensitivity) * 0.0022` (player.js:368).
- Reachable from the **menu** (`⚙ SETTINGS` ghost button, hud.js:518) **and** the
  **pause** overlay.

### Secondary reference — Dungeon Forge (`runtime/3d/menu.js`)
Same idea, simpler: a **⚙ gear button in the main menu** (menu.js:166/199) **and a
`⚙ Settings` button in the pause overlay** (menu.js:427/434) both call
`g.showSettings(...)`; persisted to `localStorage` under a game prefix.

**Takeaway applied to Grid Rush:** one `this.settings` object, one JSON blob in
`localStorage` (`gridrush_settings`), a `slider()`-style overlay reachable from the
menu launch panel AND the pause box, values read live at each use-site, live-apply
for audio, `save()` on every change. Grid Rush already stores `gridrush_callsign`
the same way (game.js:379/504), so the storage convention matches.

---

## 2. State to add — `this.settings` schema

Single object, single localStorage key `gridrush_settings`. All ranges chosen so the
**defaults reproduce today's feel** (steer already lowered to 1.75/0.92; `steerSens`
default `1.0` keeps it).

| Field         | Type   | Default | Range / step   | Feeds                                             |
|---------------|--------|---------|----------------|---------------------------------------------------|
| `steerSens`   | number | `1.0`   | 0.5–2.0 / 0.05 | Player steer rate (scales steerBase/steerHighSpeed)|
| `invertSteer` | bool   | `false` | —              | Player steer input sign                           |
| `mouseSteer`  | bool   | `false` | —              | Enable position-based mouse steering              |
| `mouseSens`   | number | `1.0`   | 0.3–2.5 / 0.05 | Mouse-steer + cruise-steer gain                   |
| `cruiseSteer` | bool   | `true`  | —              | Enable RMB-hold cruise steer                      |
| `masterVol`   | number | `0.8`   | 0–1 / 0.01     | Master gain (multiplies music + sfx)              |
| `musicVol`    | number | `0.7`   | 0–1 / 0.01     | Music bus (× master)                              |
| `sfxVol`      | number | `1.0`   | 0–1 / 0.01     | SFX bus (× master)                                |
| `cameraDist`  | number | `1.0`   | 0.7–1.5 / 0.05 | Chase-cam distance multiplier                     |
| `fov`         | number | `68`    | 60–90 / 1      | Base camera FOV (boost adds +10)                  |

`config.js` needs **no change** — `PHYSICS.steerBase (1.75)` / `steerHighSpeed (0.92)`
stay as the baseline that `steerSens` multiplies. (Optional: export the ranges as
consts if you prefer them centralized; the module below owns them instead.)

---

## 3. Ready-to-paste module — `runtime/settings.js` (NEW FILE)

Self-contained: loads/saves the blob, injects its own `<style>` + overlay, injects a
trigger button into the menu launch panel and the pause box (idempotent — skips if an
element with `[data-gr-settings]` already exists so a parallel HTML edit can own the
buttons instead), and calls back into the game for live audio apply. Returns the LIVE
values object; `game.settings` reads it every frame.

```js
/* Grid Rush — settings.js
 * Settings panel (menu + pause), persisted to localStorage as one JSON blob.
 * Pattern: Last Circle (blob + slider overlay + live apply) / Dungeon Forge
 * (gear in menu + Settings in pause). Shell (game_controls.js) still owns
 * Fullscreen/Mute/Pause; this owns steer/mouse/volume/camera.
 *
 * Integration (game.js constructor, AFTER this.sfx + this.camera exist,
 * BEFORE this.bindUI()):
 *     import { installSettings } from './settings.js';
 *     installSettings(this);                 // sets this.settings (live object)
 *     this.camera.fov = this.settings.fov;
 *     this.camera.updateProjectionMatrix();
 *     this.applyVolume();
 */

const LS_KEY = 'gridrush_settings';

export const SETTINGS_DEFAULTS = Object.freeze({
  steerSens: 1.0,      // 0.5–2.0  scales player steer rate
  invertSteer: false,
  mouseSteer: false,   // position-based mouse steering
  mouseSens: 1.0,      // 0.3–2.5  mouse + cruise gain
  cruiseSteer: true,   // hold RIGHT mouse button + move L/R to steer
  masterVol: 0.8,      // 0–1
  musicVol: 0.7,       // 0–1
  sfxVol: 1.0,         // 0–1
  cameraDist: 1.0,     // 0.7–1.5  chase-cam distance
  fov: 68,             // 60–90    base FOV
});

// [min, max, step, unit]  unit: '%' | 'x' | 'deg'
const RANGES = {
  steerSens: [0.5, 2.0, 0.05, 'x'],
  mouseSens: [0.3, 2.5, 0.05, 'x'],
  masterVol: [0, 1, 0.01, '%'],
  musicVol: [0, 1, 0.01, '%'],
  sfxVol: [0, 1, 0.01, '%'],
  cameraDist: [0.7, 1.5, 0.05, 'x'],
  fov: [60, 90, 1, 'deg'],
};
const AUDIO_KEYS = new Set(['masterVol', 'musicVol', 'sfxVol']);

function load() {
  const v = { ...SETTINGS_DEFAULTS };
  try { Object.assign(v, JSON.parse(localStorage.getItem(LS_KEY) || '{}')); } catch (e) {}
  return v;
}
function save(v) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch (e) {}
}
function fmt(key, val) {
  const unit = RANGES[key]?.[3];
  if (unit === '%') return Math.round(val * 100) + '%';
  if (unit === 'x') return val.toFixed(2) + '×';
  if (unit === 'deg') return Math.round(val) + '°';
  return String(val);
}

function injectStyle() {
  if (document.getElementById('gr-settings-style')) return;
  const s = document.createElement('style');
  s.id = 'gr-settings-style';
  s.textContent = `
  #gr-settings{position:absolute;inset:0;z-index:40;display:none;align-items:center;
    justify-content:center;background:#04000ccc;backdrop-filter:blur(4px);
    font-family:var(--font-mono,"Share Tech Mono",monospace);color:#e8f7ff;}
  #gr-settings.show{display:flex;}
  .gr-set-box{width:min(460px,94vw);max-height:88vh;overflow:auto;padding:1.3rem 1.5rem;
    background:var(--glass,rgba(8,4,22,0.92));border:1px solid var(--stroke,rgba(0,240,255,0.45));
    border-radius:14px;box-shadow:0 0 50px #ff2bd628,inset 0 0 30px #00f0ff08;}
  .gr-set-title{font-family:var(--font-display,"Orbitron",sans-serif);font-weight:800;
    letter-spacing:.14em;color:var(--cyan,#00f0ff);text-align:center;margin-bottom:1rem;
    font-size:1.05rem;}
  .gr-set-group{font-size:.56rem;letter-spacing:.18em;color:var(--magenta,#ff2bd6);
    margin:.9rem 0 .35rem;text-transform:uppercase;}
  .gr-row{display:flex;align-items:center;gap:.6rem;margin:.3rem 0;font-size:.64rem;
    letter-spacing:.06em;}
  .gr-row>label{flex:0 0 42%;color:#c8dcffcc;}
  .gr-row input[type=range]{flex:1;accent-color:var(--cyan,#00f0ff);height:4px;cursor:pointer;}
  .gr-row .gr-val{flex:0 0 46px;text-align:right;font-family:var(--font-display,"Orbitron",sans-serif);
    color:var(--yellow,#ffe566);font-size:.62rem;}
  .gr-toggle{margin-left:auto;position:relative;width:38px;height:20px;border-radius:20px;
    border:1px solid var(--stroke,rgba(0,240,255,0.45));background:#00000060;cursor:pointer;
    transition:.15s;flex:0 0 38px;}
  .gr-toggle::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;
    border-radius:50%;background:#889;transition:.15s;}
  .gr-toggle.on{background:#00f0ff22;border-color:var(--cyan,#00f0ff);box-shadow:0 0 10px #00f0ff40;}
  .gr-toggle.on::after{left:20px;background:var(--cyan,#00f0ff);box-shadow:0 0 8px #00f0ff;}
  .gr-set-actions{display:flex;gap:.6rem;margin-top:1.1rem;}
  .gr-set-actions button{flex:1;padding:.7rem;border-radius:8px;cursor:pointer;
    font-family:var(--font-display,"Orbitron",sans-serif);font-weight:700;letter-spacing:.12em;
    font-size:.72rem;transition:.12s;}
  .gr-btn-done{border:1px solid var(--cyan,#00f0ff);background:#00f0ff22;color:#fff;}
  .gr-btn-reset{border:1px solid rgba(255,255,255,.16);background:transparent;color:#aab;}
  .gr-btn-done:hover{box-shadow:0 0 16px #00f0ff55;}
  .gr-btn-reset:hover{border-color:var(--magenta,#ff2bd6);color:#fff;}
  .gr-set-hint{font-size:.54rem;color:#8aa;line-height:1.5;margin-top:.7rem;}`;
  document.head.appendChild(s);
}

export function installSettings(game) {
  const values = load();
  game.settings = values;               // live ref — read every frame by game code

  injectStyle();

  // ── overlay ──────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'gr-settings';
  const box = document.createElement('div');
  box.className = 'gr-set-box';
  overlay.appendChild(box);
  document.getElementById('app')?.appendChild(overlay) ||
    document.body.appendChild(overlay);

  const rerenderers = [];
  function commit(key) { save(values); if (AUDIO_KEYS.has(key)) game.applyVolume?.(); }

  function slider(parent, key, label) {
    const [min, max, step] = RANGES[key];
    const row = document.createElement('div');
    row.className = 'gr-row';
    const lab = document.createElement('label'); lab.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step;
    const val = document.createElement('span'); val.className = 'gr-val';
    const paint = () => { inp.value = values[key]; val.textContent = fmt(key, values[key]); };
    inp.addEventListener('input', () => {
      values[key] = parseFloat(inp.value); val.textContent = fmt(key, values[key]); commit(key);
    });
    row.append(lab, inp, val); parent.appendChild(row); rerenderers.push(paint); paint();
  }
  function toggle(parent, key, label) {
    const row = document.createElement('div');
    row.className = 'gr-row';
    const lab = document.createElement('label'); lab.textContent = label;
    const t = document.createElement('div'); t.className = 'gr-toggle'; t.setAttribute('role', 'switch');
    const paint = () => t.classList.toggle('on', !!values[key]);
    t.addEventListener('click', () => { values[key] = !values[key]; paint(); commit(key); });
    row.append(lab, t); parent.appendChild(row); rerenderers.push(paint); paint();
  }
  function group(text) {
    const g = document.createElement('div'); g.className = 'gr-set-group'; g.textContent = text;
    box.appendChild(g);
  }

  const title = document.createElement('div');
  title.className = 'gr-set-title'; title.textContent = 'SETTINGS';
  box.appendChild(title);

  group('Steering');
  slider(box, 'steerSens', 'Keyboard steer');
  toggle(box, 'invertSteer', 'Invert steering');
  group('Mouse');
  toggle(box, 'mouseSteer', 'Mouse steering');
  slider(box, 'mouseSens', 'Mouse sensitivity');
  toggle(box, 'cruiseSteer', 'Right-click cruise steer');
  group('Audio');
  slider(box, 'masterVol', 'Master volume');
  slider(box, 'musicVol', 'Music');
  slider(box, 'sfxVol', 'SFX');
  group('Camera');
  slider(box, 'cameraDist', 'Camera distance');
  slider(box, 'fov', 'Field of view');

  const hint = document.createElement('div');
  hint.className = 'gr-set-hint';
  hint.textContent = 'Hold RIGHT mouse button and move left/right to cruise-steer like A / D.';
  box.appendChild(hint);

  const actions = document.createElement('div');
  actions.className = 'gr-set-actions';
  const reset = document.createElement('button');
  reset.className = 'gr-btn-reset'; reset.textContent = 'RESET';
  reset.addEventListener('click', () => {
    Object.assign(values, SETTINGS_DEFAULTS);
    save(values); game.applyVolume?.();
    game.camera.fov = values.fov; game.camera.updateProjectionMatrix();
    rerenderers.forEach((fn) => fn());
  });
  const done = document.createElement('button');
  done.className = 'gr-btn-done'; done.textContent = 'DONE';
  done.addEventListener('click', close);
  actions.append(reset, done); box.appendChild(actions);

  function open() { rerenderers.forEach((fn) => fn()); overlay.classList.add('show'); }
  function close() { overlay.classList.remove('show'); }
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && overlay.classList.contains('show')) {
      e.stopPropagation(); close();
    }
  }, true); // capture so it closes settings before game.js Esc pause/resume runs

  // ── trigger buttons (idempotent) ─────────────────────────────────────
  // Wire any pre-existing opener the parallel HTML edit may have added:
  document.querySelectorAll('[data-gr-settings]').forEach((el) => el.addEventListener('click', open));
  const injectBtn = (host, text, ghost) => {
    if (!host) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mode-btn' + (ghost ? ' ghost' : '');
    b.textContent = text;
    b.addEventListener('click', open);
    return b;
  };
  // Menu: only inject if the parallel edit didn't already add an opener there.
  if (!document.querySelector('.launch-panel [data-gr-settings]')) {
    const menuBtn = injectBtn(document.querySelector('.launch-panel'), '⚙ SETTINGS', true);
    const controls = document.querySelector('.launch-panel .controls-card');
    if (menuBtn) controls ? controls.before(menuBtn) : document.querySelector('.launch-panel')?.appendChild(menuBtn);
  }
  // Pause: insert a Settings button above QUIT.
  if (!document.querySelector('.pause-box [data-gr-settings]')) {
    const pauseBtn = injectBtn(document.querySelector('.pause-box'), 'SETTINGS', true);
    const quit = document.getElementById('btn-quit');
    if (pauseBtn) quit ? quit.before(pauseBtn) : document.querySelector('.pause-box')?.appendChild(pauseBtn);
  }

  game.openSettings = open;   // exposed so a menu/pause button can call it directly
  game.closeSettings = close;
  return values;
}
```

Notes:
- Opening from the pause box works because the game is already paused (that button
  only exists on the pause overlay); the settings overlay `z-index:40` sits above the
  pause overlay `z-index:30`. Closing returns to whatever was underneath (menu or
  pause) — the game does not auto-resume.
- The Esc listener is `capture:true` so pressing Esc inside settings closes settings
  and `stopPropagation()` prevents game.js's Esc handler (game.js:415) from also
  toggling pause in the same keypress.

---

## 4. game.js hook points (function + current line)

Apply these edits to `runtime/game.js`. Line numbers are from the current file.

### 4.0 — Load + first apply (constructor)
**After line 125 (`this._spaceWasDown = false;`)** add mouse/cruise state + a settings
slot:
```js
    this._mouseX = (typeof innerWidth === 'number' ? innerWidth : 1280) / 2;
    this._cruising = false;
    this._cruiseAnchorX = 0;
    this.settings = null; // set by installSettings()
```
Add the import at the top with the other imports (near line 20):
```js
import { installSettings } from './settings.js';
```
**Before `this.bindUI();` (line 159)** — `this.sfx` (line 107) and `this.camera`
(line 90) already exist:
```js
    installSettings(this);                 // sets this.settings
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
    this.applyVolume();
```

### 4.1 — Keyboard steer sensitivity  →  `driveRacer()`, steerRate calc (lines 880-884)
Multiply the steer rate by `steerSens` **for the player only** (bots untouched — this
is why it goes here and not in a shared PHYSICS constant). Replace:
```js
    const steerRate =
      lerp(PHYSICS.steerBase, PHYSICS.steerHighSpeed, clamp(r.speed / maxSp, 0, 1)) *
      v.handle *
      (r.drifting ? PHYSICS.driftSteerMul : 1) *
      (r.airborne ? 0.55 : 1);
```
with:
```js
    const steerRate =
      lerp(PHYSICS.steerBase, PHYSICS.steerHighSpeed, clamp(r.speed / maxSp, 0, 1)) *
      v.handle *
      (r.isPlayer ? (this.settings?.steerSens ?? 1) : 1) *
      (r.drifting ? PHYSICS.driftSteerMul : 1) *
      (r.airborne ? 0.55 : 1);
```
This is mathematically "scale steerBase/steerHighSpeed" — `steerRate` IS the lerp of
those two, and `r.yaw += steer * steerRate * dt` (line 886) applies it. Drift auto-
trigger (`Math.abs(steer) > 0.85`, line 877) still uses the clamped ±1 input, so drift
feel is unchanged.

### 4.2 — Invert + mouse steer + cruise  →  `updatePlayer()` (lines 727-755)
Replace the whole body from the steer setup through the `driveRacer` call. New body:
```js
  updatePlayer(dt) {
    const p = this.player;
    if (!p || p.finished) return;
    const s = this.settings;

    // A/Left = +1 (screen-left), D/Right = -1.  (steering convention, game.js:731)
    let steer = 0;
    let throttle = 0;
    let brake = 0;
    let reverse = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) steer += 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) steer -= 1;

    // Position-based mouse steer: cursor right of center → steer right (-).
    if (s?.mouseSteer && !this._cruising) {
      const half = innerWidth / 2;
      let norm = (this._mouseX - half) / half;       // -1 far-left .. +1 far-right
      if (Math.abs(norm) < 0.06) norm = 0;           // 6% center deadzone
      steer += -norm * (s.mouseSens || 1);
    }
    // Right-click cruise: proportional to drag from the press anchor. Moving the
    // mouse LEFT (mouseX < anchor) yields +steer (left), like holding A.
    if (this._cruising && s?.cruiseSteer) {
      const CRUISE_PX = 240;                          // px travel for full lock
      steer += ((this._cruiseAnchorX - this._mouseX) / CRUISE_PX) * (s.mouseSens || 1);
    }
    if (s?.invertSteer) steer = -steer;
    steer = clamp(steer, -1, 1);

    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) throttle = 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) {
      if (p.speed > 4 && p.velocity.dot(p.forward) > 0.5) brake = 1;
      else reverse = 1;
    }

    const space = this.keys.has('Space');
    let jump = false;
    if (space && !this._spaceWasDown) jump = true;
    this._spaceWasDown = space;

    const burst = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    this.driveRacer(p, dt, steer, throttle, brake, reverse, jump, burst);
  }
```
`clamp` is already imported (game.js:18). Keyboard, mouse-position and cruise are
summed then clamped, so they compose; the setting-level `invertSteer` flips the sum
(the `mirror_fog` item's `r.steerInvert` at driveRacer:871 still flips again on top —
correct: two inverts cancel).

### 4.3 — Mouse listeners for cruise + tracking  →  `bindUI()` (lines 428-432)
Replace the existing mousedown/mouseup pair:
```js
    window.addEventListener('mousedown', (e) => {
      this.mouseDown.add(e.button);
      if (e.button === 0 && this.playing && !this.paused) this.tryUseItem(this.player);
    });
    window.addEventListener('mouseup', (e) => this.mouseDown.delete(e.button));
```
with (adds RMB cruise + a mousemove tracker):
```js
    window.addEventListener('mousemove', (e) => { this._mouseX = e.clientX; });
    window.addEventListener('mousedown', (e) => {
      this.mouseDown.add(e.button);
      if (e.button === 0 && this.playing && !this.paused) this.tryUseItem(this.player);
      if (e.button === 2) { this._cruising = true; this._cruiseAnchorX = e.clientX; } // RMB cruise
    });
    window.addEventListener('mouseup', (e) => {
      this.mouseDown.delete(e.button);
      if (e.button === 2) this._cruising = false;
    });
```
No `contextmenu` handler needed here — `game_controls.js:65` already suppresses it
page-wide with a capturing listener, so RMB never opens a menu.

### 4.4 — Master / music / SFX volume
**(a) `audio.js` — `RaceAudio`.** Add a master scalar. In the constructor (audio.js:3-8)
add:
```js
    this._master = 1;
    this._baseGain = 0.22;
```
In `ensure()` replace `this._gain.gain.value = 0.22;` (audio.js:16) with:
```js
    this._gain.gain.value = this.muted ? 0 : this._baseGain * this._master;
```
In `setMuted()` replace `if (this._gain) this._gain.gain.value = this.muted ? 0 : 0.22;`
(audio.js:28) with:
```js
    if (this._gain) this._gain.gain.value = this.muted ? 0 : this._baseGain * this._master;
```
Add a method:
```js
  setMasterVolume(scale) {
    this._master = Math.max(0, Math.min(1, scale));
    if (this._gain && !this.muted) this._gain.gain.value = this._baseGain * this._master;
  }
```

**(b) `game.js` — `_setMusic()` (lines 583-604).** Apply `master × musicVol` to the
element and remember the base so `applyVolume()` can re-scale live. Replace the body:
```js
  _setMusic(src, vol) {
    try {
      const scale = this.settings ? this.settings.masterVol * this.settings.musicVol : 1;
      this._musicBase = vol;
      if (this.music && this._musicSrc === src) {
        this.music.volume = vol * scale;
        if (this.music.paused) void this.music.play().catch(() => {});
        return;
      }
      if (this.music) { this.music.pause(); this.music = null; }
      this._musicSrc = src;
      const a = new Audio(src);
      a.loop = true;
      a.volume = vol * scale;
      this.music = a;
      void a.play().catch(() => {});
    } catch {
      /* ignore */
    }
  }
```
`playMusic()` (0.32) and `playMenuMusic()` (0.22) keep passing their base volumes —
the scale is applied inside `_setMusic`, so no change there.

**(c) `game.js` — add `applyVolume()`** (put it next to `playMusic`, ~line 606). The
settings module calls this on any audio-slider change:
```js
  applyVolume() {
    const s = this.settings;
    if (!s) return;
    this.sfx.setMasterVolume(s.masterVol * s.sfxVol);
    if (this.music) this.music.volume = (this._musicBase ?? 0.3) * s.masterVol * s.musicVol;
  }
```
This coexists with the shell's mute: mute toggles `.muted`/`suspend`, master sets the
gain/volume level — independent axes.

### 4.5 — Camera distance + FOV  →  `updateCamera()` (lines 1254, 1261-1265)
Replace line 1254:
```js
    const behind = p.forward.clone().multiplyScalar(-12 - Math.min(4, p.speed * 0.05));
```
with:
```js
    const distMul = this.settings?.cameraDist ?? 1;
    const behind = p.forward.clone().multiplyScalar((-12 - Math.min(4, p.speed * 0.05)) * distMul);
```
Replace the FOV block (lines 1261-1264):
```js
    const fovT =
      p.overclockTimer > 0 || ((this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && p.turbine > 2)
        ? 78
        : 68;
```
with (base FOV from settings, boost adds +10 — preserves today's 68→78 boost):
```js
    const baseFov = this.settings?.fov ?? 68;
    const fovT =
      p.overclockTimer > 0 || ((this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) && p.turbine > 2)
        ? baseFov + 10
        : baseFov;
```
`this.camera.updateProjectionMatrix()` already runs every frame at line 1266, so FOV
changes apply live with no extra call during play. (The constructor apply in 4.0
covers the menu/idle camera before the first race.)

---

## 5. Optional HTML/CSS ownership (instead of JS-injected triggers)

The module injects its own trigger buttons and styles, so **no HTML/CSS edit is
required**. If the parallel `index.html`/`main.css` work prefers to own the buttons,
add an element carrying `data-gr-settings` and the module will wire it (and skip its
own injection for that host):

`index.html` — inside `.launch-panel` (e.g. before the `.controls-card` at line 151):
```html
<button class="mode-btn ghost" type="button" data-gr-settings>⚙ SETTINGS</button>
```
`index.html` — inside `.pause-box`, before `#btn-quit` (line 246):
```html
<button class="mode-btn ghost" type="button" data-gr-settings>SETTINGS</button>
```
No CSS needed — `.mode-btn.ghost` already exists (main.css:318). The overlay styles
ship inside the module's injected `<style id="gr-settings-style">`; move them into
`main.css` verbatim if you prefer them in the stylesheet (drop the `injectStyle()`
call if you do).

---

## 6. Verification checklist (post-integration)

Load acceptance = observed effect, not "it compiled":
1. Menu → `⚙ SETTINGS` opens the overlay; every control shows its default; move each
   slider → readout updates; RESET restores defaults visibly.
2. Reload page → values persist (localStorage `gridrush_settings` present).
3. In race: raise `Keyboard steer` → car yaws faster for the same A/D hold; AI rivals
   unchanged (steer only scales for `isPlayer`).
4. `Invert steering` ON → A now steers right.
5. `Mouse steering` ON → cursor left/right of center steers; center 6% deadzone holds
   straight.
6. Hold RIGHT mouse button, drag left → steers left proportionally; release → steer
   returns to keyboard; no context menu appears.
7. `Master`/`Music`/`SFX` sliders change loudness live (music element volume + SFX
   gain); shell Mute still silences everything and un-mute restores the slider level.
8. `Camera distance` pushes the chase cam in/out; `Field of view` widens/narrows and
   the SHIFT boost still adds +10.
9. Pause (Esc) → `SETTINGS` button opens overlay above the pause box; Esc inside
   settings closes settings only (does not resume the race).
