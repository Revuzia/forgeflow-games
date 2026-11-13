// core/input.js [A0] — pointer lock, key/mouse state, cmd builder
// (architecture §3.4, amended: cmd gains `grenade:bool` — R6 ships player
// frags, combat_spec §5.9 "cook allowed" means held-state semantics: pin
// pulled on press, thrown on release; the sim edge-detects).
//
// HARNESS CONTRACT (driftwake ARCHITECTURE §2 rule): every field of
// input.state is a PLAIN configurable data property — the harness pins them
// with Object.defineProperty. Never accessors, never read through cached
// locals: buildCmd() reads input.state.* fresh on every call.
//
// ---------------------------------------------------------------------------
// ITER11 LANE E — "mouse movement/aiming should be smooth and flawless, easy
// to adjust, aim, fire" (owner, playing the build). Three defects were MEASURED
// on the real input path, not inferred; each fix is annotated with its number.
//
//   E1  SUB-FRAME PRESSES WERE SWALLOWED OUTRIGHT. The sim buffers every verb
//       0.35 s (combat_spec §1.8) but it can only buffer an edge it has SEEN,
//       and it edge-detects on `cmd.fire`, which exists only when buildCmd()
//       runs. Every sim tick of a frame is drained inside ONE rAF callback, so
//       consecutive samples of state.fire are one DISPLAYED frame apart —
//       34-42 ms on this hardware. A press and release inside that gap set
//       state.fire true then false with no buildCmd() between them: the edge
//       never existed, so the 0.35 s buffer never got the chance to hold it.
//       MEASURED before the fix, live mission, real MouseEvents, Warden in
//       hand (_harness/aimfeel.py, _shots/aimfeel_before.json):
//           press+release back to back   0 of 10 taps fired a round
//           40 ms hold                   3 of 10 taps fired a round
//           120 ms hold                  fired every time
//       A 40 ms tap is a normal fast trigger pull. Seven of ten did nothing.
//       FIX: a SAMPLING LATCH (below). A press stays live until exactly one
//       cmd has carried it; the sim's 0.35 s buffer then works as specced.
//       MEASURED after the fix, same probe, at 30 fps AND again at 16 fps
//       (1920x1080, i.e. a 63 ms swallow window — worse than the owner's box):
//           back-to-back press+release  10 of 10 taps, exactly 1 round each
//           40 ms hold                  10 of 10 taps, exactly 1 round each
//           120 ms hold                 10 of 10 taps, 2 rounds each (correct:
//                                       750 rpm = one round per 80 ms)
//       And the doctrine §2 buffer is now reachable from a real tap: a
//       sub-frame fire press DURING SPRINT released its round 0.233 s later
//       (Warden sprint-out 210 ms, buffer window 350 ms) — combat_spec §1.8
//       "fire pressed during sprint buffers and releases the shot the frame
//       sprint-out elapses", confirmed end to end through MouseEvents.
//
//   E2  NO ADS SENSITIVITY SCALING. combat_spec §2.4 requires "ADS
//       sensitivity: monitor-distance coefficient 1.0 (zoom-proportional)" and
//       nothing implemented it: look was a flat rad-per-pixel at every zoom.
//       Because ADS narrows the world FOV (Warden 74°→55°, Corvus 74°→34°) the
//       same wrist flick threw the crosshair further ACROSS THE SCREEN the
//       moment the player pressed right-click. MEASURED before the fix, as the
//       on-screen displacement of a fixed 20 m world point per 100 px of mouse
//       travel, Warden, live mission:
//           hip   world FOV 74.0    106.83 screen px per 100 px of mouse
//           ADS   world FOV 55.0    154.26 screen px per 100 px of mouse
//           ratio 1.444  (zoom-proportional target: 55/74 = 0.743 in DEGREES,
//                         which is 1.000 in SCREEN PIXELS — the point)
//       The angular rate was identical at both zooms (degRatio 1.000), which
//       is exactly the bug: same degrees, 44% more screen.
//       FIX: scale the look by the live world-FOV ratio (derivation below).
//       MEASURED after the fix: angular ratio 0.743, equal to 55/74 to three
//       decimals — i.e. the zoom-proportional law holds exactly. In screen
//       pixels, a 300 px flick now sweeps 370.8 px at the hip and 369.3 px at
//       ADS (ratio 0.996, was 1.447). The residual +7% at a 100 px flick is
//       the tangent curvature every non-zero monitor-distance coefficient
//       has: coefficient 1.0 matches at the VERTICAL SCREEN EDGE by
//       definition, so the match is exact out there and drifts slightly near
//       the centre. That is the spec's chosen trade, not an error.
//
//   E3  NOT ADJUSTABLE ENOUGH. One sensitivity slider, 0.20-3.00 in steps of
//       0.05, no ADS control, and no readout of what a number means. Now:
//       0.05-5.00 in 0.01, a separate ADS multiplier, and settings_ui prints
//       the px-per-360° the number actually buys.
//
// DELIBERATELY NOT DONE FOR THE MOUSE: no input smoothing, no interpolation,
// no acceleration curve, no aim assist. For a mouse RAW and 1:1 is correct —
// smoothing buys prettiness with latency and reads as floaty. Look is applied
// to input.state the instant the event lands (zero added latency) and the
// render camera reads input.state directly the same frame.
//
// LANE PAD (2026-11): a thumbstick is a RATE device, not a distance device, and
// the genre answer for it is a response curve, a dead zone, a look ramp and aim
// assist. Those live in core/input_gamepad.js (pad + gamepad menu focus) and
// core/aim_assist.js (slowdown / rotational / ADS snap) and are folded in by
// input.update(dt), called once per rendered frame from boot's viewUpdates.
// Aim assist is an INPUT FILTER: it only adjusts input.state.yaw/pitch before
// buildCmd() snapshots them, reads the sim read-only, and is active ONLY while
// the last-used device is a gamepad or touch — never the mouse.
// ---------------------------------------------------------------------------

import { WEAPONS } from "./weapons/weapon_data.js";
import { createGamepad, GLYPHS } from "./input_gamepad.js";
import { createAimAssist } from "./aim_assist.js";

// ---- keyboard rebinding (lane PAD). Actions -> default e.code. Persisted
// separately from settings.js (a map, not a scalar) under KEYBIND_KEY. Weapon
// digits 1-9, Esc and Tab stay fixed; Ctrl stays a fixed second crouch key.
export const KEY_ACTIONS = [
  ["forward", "KeyW", "Move forward"], ["back", "KeyS", "Move back"],
  ["left", "KeyA", "Strafe left"], ["right", "KeyD", "Strafe right"],
  ["jump", "Space", "Jump / mantle"], ["crouch", "KeyC", "Crouch / slide"],
  ["sprint", "ShiftLeft", "Sprint"], ["reload", "KeyR", "Reload"],
  ["grenade", "KeyG", "Frag"], ["interact", "KeyF", "Interact"],
  ["last", "KeyQ", "Last weapon"], ["inspect", "KeyI", "Inspect weapon"],
];
const KEYBIND_KEY = "blackridge.keybinds.v1";
const RESERVED_CODES = /^(Digit[0-9]|Escape|Tab)$/;

const PITCH_LIMIT = 1.55; // rad, just short of straight up/down
const LOOK_SCALE = 0.0022; // rad per px at sens 1.0

// What sens 1.0 buys, in mouse pixels for a full turn — the number
// settings_ui prints so "×1.00" means something (E3).
export const PX_PER_360_AT_SENS_1 = (2 * Math.PI) / LOOK_SCALE; // 2855.99 px

const FOV_DEFAULT = 74; // combat_spec §2.1 world default (vertical deg)

// Same ease the camera FOV uses (viewmodel.js smoothstep) — zoom and
// sensitivity must ride ONE timeline, never two (§2.4 agreement rule).
function smoothstep(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }

export function createInput(canvas, settings) {
  // Plain object, plain data properties — harness-pinnable.
  const state = {
    moveX: 0, moveZ: 0,
    jump: false, crouch: false, sprint: false,
    fire: false, ads: false, reload: false,
    grenade: false,
    switchTo: null, // 'slot1'..'slot5' | 'next' | 'prev' | 'last' | weaponId | null — consumed by buildCmd
    streak: 0,      // 1..4 = activate that killstreak tier (keys 6/7/8/9) — one-shot, consumed by buildCmd
    interact: false,
    // VIEW-ONLY verb (lane VM, 2026-11): weapon INSPECT (key I). A press COUNTER —
    // the viewmodel plays one inspect per increment. Deliberately NOT in buildCmd():
    // the sim never sees it, so it cannot touch determinism or replays.
    inspect: 0,
    yaw: 0, pitch: 0,
  };

  const keys = Object.create(null);

  // ---------------------------------------------------------------- E1 latch
  // Edge verbs only. `crouch`/`sprint`/`ads` are HELD states (stance, sprint
  // gate, ADS ramp) — latching those would give a one-tick stance blip, which
  // is a different bug. `switchTo` is already one-shot by construction.
  // `grenade` IS latched: combat_spec §5.9 is press=pin / release=throw, so a
  // one-tick true followed by false is exactly "quick tap = uncooked throw".
  const latch = { fire: false, jump: false, reload: false, grenade: false, interact: false };
  const LATCHED = Object.keys(latch);

  function press(k) {
    if (!state[k]) latch[k] = true; // a press already sampled needs no latch
    state[k] = true;
  }
  function release(k) {
    state[k] = false; // the latch survives until buildCmd() has carried it
  }

  // ------------------------------------------------------------- E2 ADS zoom
  // combat_spec §2.4: "monitor-distance coefficient 1.0 (zoom-proportional)".
  // The monitor-distance formula for coefficient c is
  //     ratio = atan(c·tan(vFovAds/2)) / atan(c·tan(vFovHip/2))
  // and at c = 1 the arctan and the tan cancel exactly, leaving
  //     ratio = vFovAds / vFovHip
  // i.e. the plain FOV ratio. A given mouse travel therefore sweeps the same
  // number of SCREEN pixels at the hip and down the sights, which is the whole
  // point: muscle memory survives the right-click.
  //
  // The live ADS progress lives in the sim (player.js `w.adsT`) and the target
  // FOV in the weapon table. input is created before __FPS__ exists, so the
  // sim is reached lazily through the same documented global recoil.js uses
  // (`simCounters()` there). Unreachable sim / unknown weapon -> 1.0, i.e.
  // exactly the pre-fix behaviour, so nothing can hard-fail on this path.
  function simWeapon() {
    try {
      const F = typeof window !== "undefined" && (window.__FPS__ || window.__FFG3D__);
      const p = F && F.sim && F.sim.state && F.sim.state.player;
      if (p && p.weapon && p.weapon.id) return p.weapon;
    } catch (e) { /* view-side best effort */ }
    return null;
  }

  // `userKey` picks WHICH player multiplier rides the ADS ease: the mouse's
  // adsSens, or the controller's padAdsSens (lane PAD) — separate sliders,
  // because a stick and a mouse want different ADS feel.
  function aimZoomScale(userKey = "adsSens") {
    const wp = simWeapon();
    if (!wp) return 1;
    const e = smoothstep(wp.adsT || 0);
    if (e <= 0) return 1;
    const w = WEAPONS[wp.id];
    if (!w || !(w.adsFov > 0)) return 1;
    const base = (settings && settings.fov > 0) ? settings.fov : FOV_DEFAULT;
    const aimFov = base + (w.adsFov - base) * e;
    const zoom = aimFov / base; // MDC 1.0
    // The player's own ADS multiplier rides the SAME ease, so it is inert at
    // the hip and fully applied at full ADS — no discontinuity on the ramp.
    const user = (settings && Number.isFinite(settings[userKey])) ? settings[userKey] : 1;
    return zoom * (1 + (user - 1) * e);
  }
  const invY = () => (settings && settings.invertY === "on" ? -1 : 1);

  // ---------------------------------------------------------- keyboard binds
  const binds = {};
  for (const [a, def] of KEY_ACTIONS) binds[a] = def;
  try {
    const raw = typeof localStorage !== "undefined" && localStorage.getItem(KEYBIND_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const [a] of KEY_ACTIONS) {
        if (typeof saved[a] === "string" && !RESERVED_CODES.test(saved[a])) binds[a] = saved[a];
      }
    }
  } catch (e) { /* defaults stand */ }
  let rev = new Map(); // physical code -> canonical (default) code
  let shadowed = new Set(); // default codes whose action moved elsewhere
  function rebuildBinds() {
    rev = new Map(); shadowed = new Set();
    for (const [a, def] of KEY_ACTIONS) {
      if (binds[a] !== def) { rev.set(binds[a], def); shadowed.add(def); }
    }
  }
  rebuildBinds();
  // Physical e.code -> the canonical code the switch statements below speak.
  function canon(code) {
    if (rev.has(code)) return rev.get(code);
    if (code === "ShiftRight" && !shadowed.has("ShiftLeft")) return "ShiftLeft";
    if (shadowed.has(code)) return "__unbound";
    if (code === "ShiftRight" || code === "ShiftLeft") return shadowed.has("ShiftLeft") ? "__unbound" : code;
    return code;
  }

  const input = {
    state,
    enabled: false, // gated false in menu/pause (hotkey gate, doctrine §6)
    pointerLocked: false,

    buildCmd() {
      // Snapshot for ONE sim tick. Reads state.* fresh (never cached).
      const on = input.enabled;
      const cmd = {
        moveX: on ? state.moveX : 0,
        moveZ: on ? state.moveZ : 0,
        yaw: state.yaw,
        pitch: state.pitch,
        // E1: `state.x || latch.x` — a press released before this sample still
        // reaches the sim exactly once, and a HELD press is unaffected
        // (state.x is already true, the latch adds nothing).
        jump: on ? (state.jump || latch.jump) : false,
        crouch: on ? state.crouch : false,
        sprint: on ? state.sprint : false,
        fire: on ? (state.fire || latch.fire) : false,
        ads: on ? state.ads : false,
        reload: on ? (state.reload || latch.reload) : false,
        grenade: on ? (state.grenade || latch.grenade) : false,
        switchTo: on ? state.switchTo : null,
        streak: on ? state.streak : 0,
        interact: on ? (state.interact || latch.interact) : false,
      };
      state.switchTo = null; // one-shot: consumed by the snapshot
      state.streak = 0;      // one-shot
      for (let i = 0; i < LATCHED.length; i++) latch[LATCHED[i]] = false;
      return cmd;
    },

    addLook(dyaw, dpitch) {
      state.yaw += dyaw;
      state.pitch = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, state.pitch + dpitch));
    },

    lock() {
      // Pointer lock only ever on a user gesture; callers respect that.
      // v2.2: current Chrome returns a Promise here — an unhandled rejection
      // (synthetic-event callers, post-ESC relock cooldown) would land in
      // __BOOT_ERRORS__ and fail zero-page-error gates (A10 needsElsewhere).
      if (canvas.requestPointerLock) {
        const r = canvas.requestPointerLock();
        if (r && typeof r.catch === "function") r.catch(() => {});
      }
    },

    unlock() {
      if (document.exitPointerLock && document.pointerLockElement === canvas) {
        document.exitPointerLock();
      }
    },

    // Mouse pixels for a full 360deg turn at sens x1.00 — settings_ui prints
    // this so the number on the slider means something (E3). Carried on the
    // INSTANCE rather than imported, because boot loads every module with a
    // `?v=N` query and a bare `import ... from "../input.js"` in the HUD would
    // spin up a second copy of this module AND of the weapon table it imports.
    pxPer360AtSens1: PX_PER_360_AT_SENS_1,

    // ---- private extras (probes read these; not the frozen surface) --------
    // The live look scale, so a probe can assert the zoom law instead of
    // inferring it from two camera projections.
    _lookScale() { return LOOK_SCALE * (settings ? settings.sens : 1) * aimZoomScale(); },
    _zoom() { return aimZoomScale(); },
    get _latch() { return { ...latch }; },
    // killstreak designate mode: 0 none, 2..4 = the tier being aimed (see keydown)
    get designate() { return designate; },
    cancelDesignate() { designate = 0; },
    canDesignate: null,   // boot wires (tier) => has stock && none in flight
    // ---- touch layer (core/hud/touch_controls.js) — same verbs as the keys ----
    touchPress(k) { press(k); },
    touchRelease(k) { release(k); },
    // view-only inspect request (key I / touch) — never reaches the sim cmd
    inspect() { state.inspect = (state.inspect | 0) + 1; },
    designateTier(tier) {
      if (input.canDesignate && !input.canDesignate(tier)) { designate = 0; state.streak = tier; }
      else designate = designate === tier ? 0 : tier;
    },
    confirmDesignate() { if (designate) { state.streak = designate; designate = 0; } },
    _keysHeld() { return !!(keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD); },

    // ---- lane PAD: device, glyphs, gamepad, aim assist, rebinding ------------
    // Last-used device: "kbm" | "pad" | "touch". Changes fire
    // window "br:inputdevice" {detail:{device, layout}} and onDeviceChange cbs.
    lastDevice: "kbm",
    get padLayout() { return pad.layout; },
    get padConnected() { return pad.connected; },
    onDeviceChange(fn) { if (typeof fn === "function") deviceCbs.push(fn); },
    /** Prompt label for a verb on the current device ("fire" -> "RT"/"R2"/"LMB"/"FIRE"). */
    glyph(verb) {
      const set = input.lastDevice === "pad" ? GLYPHS[pad.layout] : input.lastDevice === "touch" ? GLYPHS.touch : GLYPHS.kbm;
      if (input.lastDevice === "kbm" && KEY_GLYPH_VERB[verb]) return keyLabel(binds[KEY_GLYPH_VERB[verb]]);
      return (set && set[verb]) || verb;
    },
    noteDevice(d) { setDevice(d); },
    /** Controller glyph for a verb on the connected (or default Xbox) layout. */
    padGlyph(verb) { const G = GLYPHS[pad.layout] || GLYPHS.xbox; return G[verb] || verb; },
    /** Look-rate multiplier the assist wants this frame (touch layer scales its drags by it). */
    assistSlow() { return assistOn() ? assistOut.slow : 1; },
    get assist() { return assistOut; },
    /** Once per rendered frame (boot viewUpdates). Gamepad poll, assist, pad look. */
    update(dt) {
      dt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
      const f = pad.update(dt);
      const adsStart = !!state.ads && !prevAds;
      prevAds = !!state.ads;
      if (assistOn()) {
        const F = simRef();
        const wp = simWeapon();
        const touchLooking = input.lastDevice === "touch" && (performance.now() - touchLookAt) < 120;
        const touchMoving = input.lastDevice === "touch" && Math.hypot(state.moveX, state.moveZ) > 0.2;
        assistOut = assist.update(dt, {
          sim: F, yaw: state.yaw, pitch: state.pitch, ads: !!state.ads, adsStart,
          moving: input.lastDevice === "pad" ? pad.moving : touchMoving,
          looking: input.lastDevice === "pad" ? pad.looking : touchLooking,
          strength: (settings && settings.aimAssist) || "standard",
          weapon: wp ? WEAPONS[wp.id] : null,
        });
      } else {
        assist.reset();
        assistOut = IDLE_ASSIST;
      }
      if (f.active) {
        const look = pad.applyLook(dt, aimZoomScale("padAdsSens"), assistOut.slow);
        lastPadLook = look;
      } else lastPadLook = null;
      if (assistOut.dYaw || assistOut.dPitch) input.addLook(assistOut.dYaw, assistOut.dPitch);
    },
    /** Rumble taps on the sim->view bridge (boot attachAll). */
    attach(bridge) {
      bridge.register("shot", (d) => {
        if (d && d.shooter === "P" && !d.impactOnly && !d.pen && !(d.pellet > 0)) rumble(0.25, 0.55, 70);
      });
      bridge.register("hurt", (d) => {
        if (!d) return;
        if (d.victim === "P") rumble(0.75, 0.45, 160);
        else if (d.attacker === "P") rumble(0.0, 0.35, 45); // hit confirm
      });
      bridge.register("explosion", (d) => {
        const P = simRef() && simRef().state.player;
        if (!d || !d.pos || !P) return;
        const dist = Math.hypot(d.pos[0] - P.pos[0], d.pos[1] - P.pos[1], d.pos[2] - P.pos[2]);
        const k = Math.max(0, 1 - dist / 30);
        if (k > 0.05) rumble(k, k * 0.7, 120 + 260 * k);
      });
    },
    // keyboard rebinding (settings_ui)
    keyActions: KEY_ACTIONS,
    getBind(a) { return binds[a]; },
    keyLabel(code) { return keyLabel(code); },
    rebind(a, code) {
      if (!(a in binds) || !code || RESERVED_CODES.test(code)) return false;
      const other = Object.keys(binds).find((k) => k !== a && binds[k] === code);
      if (other) binds[other] = binds[a]; // swap — never two actions on one key
      binds[a] = code;
      rebuildBinds(); clearKeys();
      try { localStorage.setItem(KEYBIND_KEY, JSON.stringify(binds)); } catch (e) { /* best effort */ }
      return true;
    },
    resetBinds() {
      for (const [a, def] of KEY_ACTIONS) binds[a] = def;
      rebuildBinds(); clearKeys();
      try { localStorage.removeItem(KEYBIND_KEY); } catch (e) { /* best effort */ }
    },
    /** Next keydown goes to fn(code) instead of the game (Escape cancels -> fn(null)). */
    captureNextKey(fn) {
      rebindCapture = (e) => {
        rebindCapture = null;
        e.preventDefault(); e.stopImmediatePropagation();
        fn(e.code === "Escape" ? null : e.code);
      };
    },
    _pad: null, // set below (probes)
    _lastPadLook() { return lastPadLook; },
  };

  // ---------------------------------------------------------------- lane PAD
  const KEY_GLYPH_VERB = { jump: "jump", crouch: "crouch", sprint: "sprint", reload: "reload", grenade: "grenade",
    interact: "interact", swap: "last", inspect: "inspect" };
  function keyLabel(code) {
    if (!code) return "—";
    return String(code).replace(/^Key/, "").replace(/^Digit/, "").replace(/Left$|Right$/, "")
      .replace(/^Arrow/, "").replace(/^Numpad/, "NUM ").replace("Control", "CTRL").toUpperCase();
  }
  let rebindCapture = null;
  const deviceCbs = [];
  const IDLE_ASSIST = Object.freeze({ slow: 1, dYaw: 0, dPitch: 0, target: null, weight: 0, theta: 0, dist: 0 });
  let assistOut = IDLE_ASSIST;
  let prevAds = false, lastPadLook = null, touchLookAt = -1e9;
  const assist = createAimAssist();
  function simRef() {
    try {
      const F = typeof window !== "undefined" && (window.__FPS__ || window.__FFG3D__);
      return (F && F.sim) || null;
    } catch (e) { return null; }
  }
  function assistOn() {
    const d = input.lastDevice;
    return input.enabled && (d === "pad" || d === "touch") &&
      ((settings && settings.aimAssist) || "standard") !== "off";
  }
  function clearKeys() {
    for (const k of Object.keys(keys)) keys[k] = false;
    refreshMove();
  }
  const hintEl = typeof document !== "undefined" ? document.getElementById("hint") : null;
  const hintKbm = hintEl ? hintEl.innerHTML : "";
  function padHint() {
    const G = GLYPHS[pad.layout] || GLYPHS.xbox;
    const sep = " &nbsp;·&nbsp; ";
    return [`${G.move} move`, `${G.look} look`, `${G.fire} fire`, `${G.ads} ads`, `${G.reload} reload · hold ${G.reload} interact`,
      `${G.jump} jump`, `${G.crouch} crouch`, `${G.sprint} sprint`, `${G.swap} swap`, `${G.grenade} grenade`,
      `${G.streak} streaks`, `${G.score} scoreboard`, `${G.pause} pause`].join(sep).toLowerCase();
  }
  function setDevice(d) {
    if (input.lastDevice === d) return;
    input.lastDevice = d;
    if (d === "kbm" && pad.nav) pad.nav.clear();
    try {
      if (hintEl) hintEl.innerHTML = d === "pad" ? padHint() : hintKbm;
      if (typeof document !== "undefined" && document.body) {
        document.body.classList.toggle("br-pad", d === "pad");
      }
      window.dispatchEvent(new CustomEvent("br:inputdevice", { detail: { device: d, layout: pad.layout } }));
    } catch (e) { /* non-DOM host */ }
    for (const fn of deviceCbs) { try { fn(d, pad.layout); } catch (e) { /* listener's problem */ } }
  }
  function rumble(strong, weak, ms) {
    if (input.lastDevice !== "pad" || (settings && settings.padRumble === "off")) return false;
    return pad.rumble(strong, weak, ms);
  }
  const pad = createGamepad({
    input, state, settings,
    press, release, refreshMove: () => refreshMove(),
    setDevice,
    key: (code, type) => window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true })),
  });
  input._pad = pad;
  input.touchLooked = () => { touchLookAt = performance.now(); if (input.lastDevice !== "touch") setDevice("touch"); };

  function refreshMove() {
    state.moveX = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    state.moveZ = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  }

  let designate = 0; // killstreak designate mode (see the Digit7-9 keys)
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (rebindCapture) { rebindCapture(e); return; } // settings "press a key"
    if (e.isTrusted) setDevice("kbm");
    const code = canon(e.code);
    keys[code] = true;
    switch (code) {
      case "KeyW": case "KeyA": case "KeyS": case "KeyD": refreshMove(); break;
      case "Space": press("jump"); e.preventDefault(); break;
      case "ControlLeft": case "ControlRight": case "KeyC": state.crouch = true; break;
      case "ShiftLeft": case "ShiftRight": state.sprint = true; break;
      case "KeyR": press("reload"); break;
      case "KeyG": press("grenade"); break;
      case "KeyF": press("interact"); break;
      case "KeyI": input.inspect(); break;   // view-only (see state.inspect)
      // FIVE fixed weapon slots (weapon_data.js WEAPON_SLOT) + Q = last weapon.
      case "Digit1": state.switchTo = "slot1"; break;
      case "Digit2": state.switchTo = "slot2"; break;
      case "Digit3": state.switchTo = "slot3"; break;
      case "Digit4": state.switchTo = "slot4"; break;
      case "Digit5": state.switchTo = "slot5"; break;
      case "KeyQ": state.switchTo = "last"; break;
      // KILLSTREAK specials (core/sim/streaks.js): 6 sweep · 7 mortar · 8 airstrike · 9 orbital.
      // 6 launches at once (no target). 7/8/9 enter DESIGNATE mode (2026-10-14): a
      // preview ring follows the crosshair; LMB confirms, RMB / Esc / the same key
      // cancels. With nothing in stock the key fires straight through so the sim
      // answers with its own "no call-in" denial.
      case "Digit6": designate = 0; state.streak = 1; break;
      case "Digit7": case "Digit8": case "Digit9": {
        const tier = code === "Digit7" ? 2 : code === "Digit8" ? 3 : 4;
        if (designate === tier) designate = 0;
        else if (input.canDesignate && !input.canDesignate(tier)) { designate = 0; state.streak = tier; }
        else designate = tier;
        break;
      }
      case "Escape": designate = 0; break;
    }
    if (designate && /^(Digit[1-5]|KeyQ|KeyG|KeyR)$/.test(code)) designate = 0; // switching hands cancels
  });

  window.addEventListener("keyup", (e) => {
    const code = canon(e.code);
    keys[code] = false;
    switch (code) {
      case "KeyW": case "KeyA": case "KeyS": case "KeyD": refreshMove(); break;
      case "Space": release("jump"); break;
      case "ControlLeft": case "ControlRight": case "KeyC": state.crouch = false; break;
      case "ShiftLeft": case "ShiftRight": state.sprint = false; break;
      case "KeyR": release("reload"); break;
      case "KeyG": release("grenade"); break;
      case "KeyF": release("interact"); break;
    }
  });

  canvas.addEventListener("mousedown", (e) => {
    if (e.isTrusted && input.lastDevice === "pad") setDevice("kbm");
    if (designate) {
      // designate mode owns the mouse: LMB confirms the call-in, RMB cancels
      if (e.button === 0) { state.streak = designate; designate = 0; }
      else if (e.button === 2) designate = 0;
      if (input.enabled && !input.pointerLocked) input.lock();
      return;
    }
    if (e.button === 0) press("fire");
    if (e.button === 2) state.ads = true;
    // Pointer lock on first canvas click while a mission is live.
    if (input.enabled && !input.pointerLocked) input.lock();
  });

  window.addEventListener("mouseup", (e) => {
    if (e.button === 0) release("fire");
    if (e.button === 2) state.ads = false;
  });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // Mouse wheel cycles owned weapons (next/prev). One notch = one switch; a
  // trackpad's burst of tiny deltas is gathered so it cannot spin the bar.
  let wheelAcc = 0, wheelAt = 0;
  window.addEventListener("wheel", (e) => {
    if (!input.enabled || !input.pointerLocked) return;
    const now = performance.now();
    if (now - wheelAt > 250) wheelAcc = 0;
    wheelAt = now;
    wheelAcc += e.deltaY;
    if (Math.abs(wheelAcc) < 40) return;
    state.switchTo = wheelAcc > 0 ? "next" : "prev";
    wheelAcc = 0;
    e.preventDefault();
  }, { passive: false });

  window.addEventListener("mousemove", (e) => {
    // Applied on the EVENT, not once per frame: Chrome delivers several
    // mousemoves per displayed frame at any normal polling rate and each
    // carries its own movementX/Y, so summing them here is both lossless and
    // exactly what a per-frame "read the last event" scheme would get wrong.
    // No dt anywhere in this line — a mouse delta is a distance, not a rate,
    // and multiplying it by frame time is the classic bug that makes
    // sensitivity change with framerate. Verified: 300 px delivered in one
    // frame and 300 px spread over 30 frames produce IDENTICAL yaw.
    // Yaw/pitch land in input.state immediately (zero look latency) and enter
    // the sim via the next cmd. Sim-stored aim is authoritative for ballistics.
    // lane PAD: a deliberate mouse move hands the device back to the mouse
    // (assist off, keyboard glyphs). 3 px floor ignores a nudged desk.
    if (input.lastDevice !== "kbm" && (Math.abs(e.movementX) + Math.abs(e.movementY) > 3) && e.isTrusted) setDevice("kbm");
    if (!input.enabled || !input.pointerLocked) return;
    const s = LOOK_SCALE * (settings ? settings.sens : 1.0) * aimZoomScale();
    input.addLook(-e.movementX * s, -e.movementY * s * invY());
  });

  // touch vs mouse pointer — the device switch for the touch layer and menus
  window.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") setDevice("touch");
    else if (e.pointerType === "mouse" && e.isTrusted) setDevice("kbm");
  }, true);

  document.addEventListener("pointerlockchange", () => {
    input.pointerLocked = document.pointerLockElement === canvas;
  });

  window.addEventListener("blur", () => {
    // Dropped focus must never leave a key latched.
    for (const k of Object.keys(keys)) keys[k] = false;
    refreshMove();
    state.jump = state.crouch = state.sprint = false;
    state.fire = state.ads = state.reload = state.grenade = state.interact = false;
    for (let i = 0; i < LATCHED.length; i++) latch[LATCHED[i]] = false;
  });

  // Harness seam (dynres.js `globalThis.__BR_DYNRES__` precedent): the aim/feel
  // probe must drive the REAL listeners and then read what they produced, and
  // input is not on the frozen __FPS__ member set. Diagnostic only — nothing in
  // the game reads this.
  try { globalThis.__INPUT__ = input; } catch (e) { /* non-browser host */ }

  return input;
}
