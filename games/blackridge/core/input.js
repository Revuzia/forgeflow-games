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
// DELIBERATELY NOT DONE: no input smoothing, no interpolation, no acceleration
// curve, no aim assist. For a shooter RAW and 1:1 is correct — smoothing buys
// prettiness with latency and reads as floaty. Look is applied to input.state
// the instant the event lands (zero added latency) and the render camera reads
// input.state directly the same frame.
// ---------------------------------------------------------------------------

import { WEAPONS } from "./weapons/weapon_data.js";

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
    switchTo: null, // weaponId | null — consumed by buildCmd
    interact: false,
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

  function aimZoomScale() {
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
    const user = (settings && Number.isFinite(settings.adsSens)) ? settings.adsSens : 1;
    return zoom * (1 + (user - 1) * e);
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
        interact: on ? (state.interact || latch.interact) : false,
      };
      state.switchTo = null; // one-shot: consumed by the snapshot
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
  };

  function refreshMove() {
    state.moveX = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
    state.moveZ = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  }

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    keys[e.code] = true;
    switch (e.code) {
      case "KeyW": case "KeyA": case "KeyS": case "KeyD": refreshMove(); break;
      case "Space": press("jump"); e.preventDefault(); break;
      case "ControlLeft": case "ControlRight": case "KeyC": state.crouch = true; break;
      case "ShiftLeft": case "ShiftRight": state.sprint = true; break;
      case "KeyR": press("reload"); break;
      case "KeyG": press("grenade"); break;
      case "KeyF": press("interact"); break;
      case "Digit1": state.switchTo = "slot1"; break;
      case "Digit2": state.switchTo = "slot2"; break;
    }
  });

  window.addEventListener("keyup", (e) => {
    keys[e.code] = false;
    switch (e.code) {
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
    if (!input.enabled || !input.pointerLocked) return;
    const s = LOOK_SCALE * (settings ? settings.sens : 1.0) * aimZoomScale();
    input.addLook(-e.movementX * s, -e.movementY * s);
  });

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
