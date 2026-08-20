// core/input.js [A0] — pointer lock, key/mouse state, cmd builder
// (architecture §3.4, amended: cmd gains `grenade:bool` — R6 ships player
// frags, combat_spec §5.9 "cook allowed" means held-state semantics: pin
// pulled on press, thrown on release; the sim edge-detects).
//
// HARNESS CONTRACT (driftwake ARCHITECTURE §2 rule): every field of
// input.state is a PLAIN configurable data property — the harness pins them
// with Object.defineProperty. Never accessors, never read through cached
// locals: buildCmd() reads input.state.* fresh on every call.

const PITCH_LIMIT = 1.55; // rad, just short of straight up/down
const LOOK_SCALE = 0.0022; // rad per px at sens 1.0

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

  const input = {
    state,
    enabled: false, // gated false in menu/pause (hotkey gate, doctrine §6)
    pointerLocked: false,

    buildCmd() {
      // Snapshot for ONE sim tick. Reads state.* fresh (never cached).
      const cmd = {
        moveX: input.enabled ? state.moveX : 0,
        moveZ: input.enabled ? state.moveZ : 0,
        yaw: state.yaw,
        pitch: state.pitch,
        jump: input.enabled ? state.jump : false,
        crouch: input.enabled ? state.crouch : false,
        sprint: input.enabled ? state.sprint : false,
        fire: input.enabled ? state.fire : false,
        ads: input.enabled ? state.ads : false,
        reload: input.enabled ? state.reload : false,
        grenade: input.enabled ? state.grenade : false,
        switchTo: input.enabled ? state.switchTo : null,
        interact: input.enabled ? state.interact : false,
      };
      state.switchTo = null; // one-shot: consumed by the snapshot
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
      case "Space": state.jump = true; e.preventDefault(); break;
      case "ControlLeft": case "ControlRight": case "KeyC": state.crouch = true; break;
      case "ShiftLeft": case "ShiftRight": state.sprint = true; break;
      case "KeyR": state.reload = true; break;
      case "KeyG": state.grenade = true; break;
      case "KeyF": state.interact = true; break;
      case "Digit1": state.switchTo = "slot1"; break;
      case "Digit2": state.switchTo = "slot2"; break;
    }
  });

  window.addEventListener("keyup", (e) => {
    keys[e.code] = false;
    switch (e.code) {
      case "KeyW": case "KeyA": case "KeyS": case "KeyD": refreshMove(); break;
      case "Space": state.jump = false; break;
      case "ControlLeft": case "ControlRight": case "KeyC": state.crouch = false; break;
      case "ShiftLeft": case "ShiftRight": state.sprint = false; break;
      case "KeyR": state.reload = false; break;
      case "KeyG": state.grenade = false; break;
      case "KeyF": state.interact = false; break;
    }
  });

  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) state.fire = true;
    if (e.button === 2) state.ads = true;
    // Pointer lock on first canvas click while a mission is live.
    if (input.enabled && !input.pointerLocked) input.lock();
  });

  window.addEventListener("mouseup", (e) => {
    if (e.button === 0) state.fire = false;
    if (e.button === 2) state.ads = false;
  });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("mousemove", (e) => {
    // Yaw/pitch applied immediately (zero look latency); they enter the sim
    // via the next cmd. Sim-stored aim is authoritative for ballistics.
    if (!input.enabled || !input.pointerLocked) return;
    const s = LOOK_SCALE * (settings ? settings.sens : 1.0);
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
  });

  return input;
}
