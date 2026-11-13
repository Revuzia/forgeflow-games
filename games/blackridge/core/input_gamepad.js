// core/input_gamepad.js — gamepad layer + gamepad menu navigation (lane PAD, 2026-11).
//
// Drives the SAME input.state verbs the keyboard, mouse and touch layers write
// (core/input.js), so the sim cannot tell a controller from a key. Polled once
// per rendered frame from input.update(dt) (boot viewUpdates), which runs in
// the rAF loop AND in the harness's stepFrames — no polling of its own.
//
// STANDARD MAPPING (W3C "standard" gamepad; Xbox and PlayStation report the
// same indices — only the printed glyphs differ):
//
//   L stick  move            L3   sprint (or auto-sprint at full forward push)
//   R stick  look            R3   reserved: melee (no melee verb in the sim yet)
//   RT       fire            LT   aim down sights
//   A / X    jump            B/O  crouch · slide while sprinting (toggle or hold)
//   X / []   reload — HOLD = interact
//   Y / /\   swap weapon     RB   frag (hold = cook, release = throw)
//   LB       TACTICAL: flash / smoke / concussion ([equipment lane]; the CoD
//            bumper pair - LB tactical, RB lethal; a tripmine kit plants on RB).
//            The signal sweep that lived here moved to D-pad DOWN, so all four
//            call-ins share the D-pad.
//   D-pad    down signal sweep · up mortar · right airstrike · left orbital
//            (designate: RT confirm, LT / B cancel)
//   R3       inspect weapon (moved off D-pad down; melee has no sim verb yet)
//   Start    pause           Back/View  scoreboard (hold)
//
// MENUS: whenever input is gated (title, PVP menu, pause, settings, debrief),
// the pad drives a generic SPATIAL focus over the visible, top-most buttons —
// no menu file knows a controller exists. D-pad / L stick move, A activates,
// B (or Start) sends Escape (every overlay already treats Escape as back),
// left/right on a slider steps it.
//
// Pure math (dead zone, curves, acceleration) is exported for the selftest;
// nothing at module scope touches the DOM.

export const BTN = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
  BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16,
};

// Full-deflection look rates at sensitivity 1.00 (rad/s): ~195°/s yaw,
// ~137°/s pitch before acceleration — a mid "standard" console feel.
export const LOOK_YAW_RATE = 3.4;
export const LOOK_PITCH_RATE = 2.4;
export const OUTER_DEADZONE = 0.98;
export const ACCEL_DELAY = 0.20;   // s at full deflection before the ramp starts
export const ACCEL_RAMP = 0.45;    // s to reach the full bonus
export const ACCEL_MAX = 0.8;      // bonus at padAccel 1.0 (+80% yaw rate)
export const HOLD_INTERACT_S = 0.30;

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function smoothstep(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }

/** Radial dead zone with rescale: |v| <= inner -> 0, |v| >= outer -> 1, linear
 *  between, direction preserved. Kills drift without a dead "notch" after it. */
export function radialDeadzone(x, y, inner, outer = OUTER_DEADZONE) {
  x = Number.isFinite(x) ? x : 0; y = Number.isFinite(y) ? y : 0;
  const m = Math.hypot(x, y);
  if (m <= inner || m < 1e-6) return { x: 0, y: 0, mag: 0 };
  const mag = clamp((m - inner) / Math.max(1e-6, outer - inner), 0, 1);
  return { x: (x / m) * mag, y: (y / m) * mag, mag };
}

/** Response curve over magnitude m in [0,1]:
 *  linear   m
 *  standard m^2 — precise near centre (genre default)
 *  dynamic  cubic near centre blending to linear at the rim: finest small
 *           corrections, full speed for flicks. */
export function responseCurve(m, kind) {
  m = clamp(m, 0, 1);
  if (kind === "linear") return m;
  if (kind === "dynamic") {
    const t = smoothstep(0.55, 1.0, m);
    return m * m * m * (1 - t) + m * t;
  }
  return m * m; // standard
}

/** Look acceleration multiplier after `heldS` seconds at full deflection. */
export function accelMultiplier(heldS, amount) {
  if (!(amount > 0) || heldS <= ACCEL_DELAY) return 1;
  return 1 + ACCEL_MAX * clamp(amount, 0, 1) * smoothstep(0, ACCEL_RAMP, heldS - ACCEL_DELAY);
}

/** Yaw/pitch delta (radians) for one frame of right stick. */
export function lookDelta(rx, ry, dt, o) {
  const dz = radialDeadzone(rx, ry, o.dead);
  if (dz.mag <= 0) return { dYaw: 0, dPitch: 0, mag: 0 };
  const c = responseCurve(dz.mag, o.curve) / dz.mag; // reshape magnitude, keep direction
  const ax = dz.x * c, ay = dz.y * c;
  const k = (o.scale == null ? 1 : o.scale) * (o.slow == null ? 1 : o.slow);
  const acc = o.accel == null ? 1 : o.accel;
  return {
    dYaw: -ax * LOOK_YAW_RATE * (o.sensX || 1) * acc * k * dt,
    dPitch: -ay * LOOK_PITCH_RATE * (o.sensY || 1) * k * dt * (o.invertY ? -1 : 1),
    mag: dz.mag,
  };
}

export function padLayout(id) {
  const s = String(id || "");
  if (/xbox|xinput|045e/i.test(s)) return "xbox";
  return /054c|playstation|dualshock|dualsense|wireless controller|ps[345]/i.test(s) ? "ps" : "xbox";
}

export const GLYPHS = {
  xbox: { fire: "RT", ads: "LT", jump: "A", crouch: "B", reload: "X", interact: "HOLD X", swap: "Y",
    grenade: "RB", tactical: "LB", streak: "D-PAD", inspect: "R3", pause: "MENU", score: "VIEW", sprint: "L3",
    move: "L-STICK", look: "R-STICK", confirm: "A", back: "B", designateOk: "RT", designateCancel: "LT" },
  ps: { fire: "R2", ads: "L2", jump: "✕", crouch: "○", reload: "□", interact: "HOLD □", swap: "△",
    grenade: "R1", tactical: "L1", streak: "D-PAD", inspect: "R3", pause: "OPTIONS", score: "TOUCHPAD", sprint: "L3",
    move: "L-STICK", look: "R-STICK", confirm: "✕", back: "○", designateOk: "R2", designateCancel: "L2" },
  kbm: { fire: "LMB", ads: "RMB", jump: "SPACE", crouch: "C", reload: "R", interact: "F", swap: "Q",
    grenade: "G", tactical: "E", streak: "6-9", inspect: "I", pause: "ESC", score: "TAB", sprint: "SHIFT",
    move: "WASD", look: "MOUSE", confirm: "ENTER", back: "ESC", designateOk: "LMB", designateCancel: "RMB" },
  touch: { fire: "FIRE", ads: "AIM", jump: "JUMP", crouch: "CROUCH", reload: "RELOAD", interact: "USE", swap: "SWAP",
    grenade: "GRENADE", tactical: "TAC", streak: "TRAY", inspect: "—", pause: "II", score: "SCORE", sprint: "PUSH STICK",
    move: "LEFT THUMB", look: "RIGHT THUMB", confirm: "TAP", back: "II", designateOk: "FIRE", designateCancel: "AIM" },
};

// ===================================================================== menus
const FOCUS_STYLE_ID = "br-padfocus-style";
const NAV_SEL = "button, [data-a], .a10-item, input[type=range], [role=button], a[href], select";

export function createMenuNav() {
  let focused = null;
  function ensureStyle() {
    if (typeof document === "undefined" || document.getElementById(FOCUS_STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = FOCUS_STYLE_ID;
    st.textContent = `.br-padfocus{outline:2px solid #d9a441 !important;outline-offset:3px !important;
      box-shadow:0 0 0 5px rgba(217,164,65,.22) !important;}`;
    document.head.appendChild(st);
  }
  function layerOf(el) {
    let n = el;
    while (n && n.parentElement && n.parentElement !== document.body) n = n.parentElement;
    return n;
  }
  function shown(el) {
    if (el.disabled) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
    return true;
  }
  function candidates() {
    // the portal's own chrome (fullscreen / mute / report, ids "__ff…") is not game UI
    const all = Array.from(document.querySelectorAll(NAV_SEL)).filter((el) =>
      el.tagName !== "CANVAS" && !(el.closest && el.closest('[id^="__ff"]')) && shown(el));
    const W = window.innerWidth, H = window.innerHeight;
    // top-most test where the element is on screen: whatever the browser would
    // hit at its centre must be it (or inside it) — overlays hide what's beneath
    const layers = new Set();
    const onTop = [];
    for (const el of all) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cx < 0 || cy < 0 || cx > W || cy > H) continue;
      const hit = document.elementFromPoint(cx, cy);
      if (hit && (hit === el || el.contains(hit) || hit.contains(el))) { onTop.push(el); layers.add(layerOf(el)); }
    }
    // + scrolled-out rows of the SAME top layers (a long settings panel)
    const set = new Set(onTop);
    for (const el of all) if (!set.has(el) && layers.has(layerOf(el))) {
      const sp = el.closest && el.closest(".a10-panel");
      if (sp) set.add(el);
    }
    return Array.from(set);
  }
  function setFocus(el) {
    if (focused && focused !== el) focused.classList.remove("br-padfocus");
    focused = el;
    if (!el) return;
    ensureStyle();
    el.classList.add("br-padfocus");
    try { el.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) { /* old engines */ }
  }
  function ensureFocus(list) {
    list = list || candidates();
    if (focused && list.includes(focused) && document.contains(focused)) return focused;
    // prefer a highlighted row (pause's .on), else the first in reading order
    const pick = list.find((e) => e.classList.contains("on") && e.classList.contains("a10-item")) || list.slice().sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return (ra.top - rb.top) || (ra.left - rb.left);
    })[0] || null;
    setFocus(pick);
    return pick;
  }
  function move(dx, dy) {
    const list = candidates();
    const had = focused && list.includes(focused) && document.contains(focused);
    const cur = ensureFocus(list);
    if (!cur || !had) return cur; // first press only shows the ring
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bestS = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      const vx = r.left + r.width / 2 - ax, vy = r.top + r.height / 2 - ay;
      const along = vx * dx + vy * dy;
      if (along <= 4) continue;
      // across = GAP between the two rects on the other axis (0 when they
      // overlap), so a left-aligned list of unequal widths reads as a column
      const across = dx !== 0
        ? Math.max(0, r.top - a.bottom, a.top - r.bottom)
        : Math.max(0, r.left - a.right, a.left - r.right);
      const s = along + across * 2.2;
      if (s < bestS) { bestS = s; best = el; }
    }
    if (best) setFocus(best);
    return focused;
  }
  function activate() {
    const el = ensureFocus();
    if (!el) return null;
    if (el.tagName === "INPUT" && el.type === "range") return el;
    el.click();
    return el;
  }
  function adjust(dir) {
    const el = focused;
    if (!el || el.tagName !== "INPUT" || el.type !== "range") return false;
    const step = Number(el.step) || 0.01, min = Number(el.min), max = Number(el.max);
    const v = clamp(Number(el.value) + dir * step, min, max);
    el.value = String(Math.round(v / step) * step);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  function clear() { setFocus(null); }
  return { move, activate, adjust, clear, ensureFocus, candidates, get focused() { return focused; } };
}

// =================================================================== gamepad
/**
 * hooks: {
 *   input, state, settings, press(k), release(k), refreshMove(),
 *   setDevice(d), lookScale() -> zoom x padAdsSens, slow() -> assist multiplier,
 *   key(code, type)
 * }
 */
export function createGamepad(hooks) {
  const { input, state, settings } = hooks;
  const nav = createMenuNav();
  const prev = new Array(17).fill(false);
  const cur = new Array(17).fill(false);
  let index = -1, id = "", layout = "xbox";
  let had = false;
  let driving = { move: false, sprint: false, ads: false, crouch: false, fire: false };
  let sprintLatch = false;
  let xHeld = -1, interactOn = false;
  let fullHeld = 0;
  let navRepeat = { dir: "", t: 0 };
  let refocusT = 0;
  let wasMenu = null;
  const frame = { look: { x: 0, y: 0, mag: 0 }, move: { x: 0, y: 0, mag: 0 }, active: false };

  const S = (k, d) => (settings && settings[k] != null ? settings[k] : d);

  function pick() {
    const list = (typeof navigator !== "undefined" && navigator.getGamepads) ? navigator.getGamepads() : null;
    if (!list) return null;
    if (index >= 0 && list[index] && list[index].connected !== false) return list[index];
    let fallback = null;
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      if (!g || g.connected === false) continue;
      if (g.mapping === "standard") { index = i; return g; }
      if (!fallback) fallback = g;
    }
    if (fallback) index = fallback.index != null ? fallback.index : list.indexOf(fallback);
    return fallback;
  }

  function btnVal(g, i) {
    const b = g.buttons && g.buttons[i];
    if (!b) return 0;
    return typeof b === "object" ? (b.value || (b.pressed ? 1 : 0)) : Number(b) || 0;
  }

  function releaseGameplay() {
    if (driving.fire) hooks.release("fire");
    hooks.release("jump"); hooks.release("reload"); hooks.release("grenade"); hooks.release("tactical");
    if (interactOn) hooks.release("interact");
    interactOn = false; xHeld = -1;
    if (driving.move) { state.moveX = 0; state.moveZ = 0; hooks.refreshMove(); }
    if (driving.sprint) state.sprint = false;
    if (driving.ads) state.ads = false;
    if (driving.crouch) state.crouch = false;
    driving = { move: false, sprint: false, ads: false, crouch: false, fire: false };
    sprintLatch = false; fullHeld = 0;
  }

  const edge = (i) => cur[i] && !prev[i];
  const up = (i) => !cur[i] && prev[i];

  function gameplay(g, dt) {
    const dl = S("padDeadL", 0.1);
    const mv = radialDeadzone(g.axes[0] || 0, g.axes[1] || 0, dl);
    frame.move = mv;
    // ---- move
    if (mv.mag > 0) {
      state.moveX = mv.x; state.moveZ = -mv.y; driving.move = true;
    } else if (driving.move) {
      driving.move = false; state.moveX = 0; state.moveZ = 0; hooks.refreshMove();
    }
    // ---- sprint
    const fwd = -mv.y;
    let sprint;
    if (S("padSprint", "l3") === "auto") sprint = mv.mag >= 0.92 && fwd > 0.7;
    else {
      if (edge(BTN.L3)) sprintLatch = true; // CoD rule: L3 engages, stopping / aiming drops it
      if (mv.mag < 0.25 || fwd < 0.3 || cur[BTN.LT]) sprintLatch = false;
      sprint = sprintLatch;
    }
    if (sprint !== driving.sprint || (sprint && !state.sprint)) { state.sprint = sprint; driving.sprint = sprint; }

    // ---- triggers (designate mode borrows them: RT confirms, LT / B cancel)
    if (input.designate) {
      if (edge(BTN.RT)) input.confirmDesignate();
      if (edge(BTN.LT) || edge(BTN.B)) input.cancelDesignate();
    } else {
      if (edge(BTN.RT)) { hooks.press("fire"); driving.fire = true; }
      if (edge(BTN.LT)) { state.ads = true; driving.ads = true; }
      if (edge(BTN.B)) {
        if (S("padCrouch", "toggle") === "hold") state.crouch = true;
        else state.crouch = !state.crouch;
        driving.crouch = true;
      }
    }
    if (up(BTN.RT) && driving.fire) { hooks.release("fire"); driving.fire = false; }
    if (up(BTN.LT) && driving.ads) { state.ads = false; driving.ads = false; }
    if (up(BTN.B) && S("padCrouch", "toggle") === "hold" && driving.crouch) { state.crouch = false; driving.crouch = false; }

    // ---- face buttons / bumpers
    if (edge(BTN.A)) hooks.press("jump");
    if (up(BTN.A)) hooks.release("jump");
    if (edge(BTN.X)) { hooks.press("reload"); xHeld = 0; }
    if (cur[BTN.X] && xHeld >= 0) {
      xHeld += dt;
      if (!interactOn && xHeld >= HOLD_INTERACT_S) { hooks.press("interact"); interactOn = true; }
    }
    if (up(BTN.X)) { hooks.release("reload"); if (interactOn) hooks.release("interact"); interactOn = false; xHeld = -1; }
    if (edge(BTN.Y)) state.switchTo = "next";
    if (edge(BTN.RB)) hooks.press("grenade");
    if (up(BTN.RB)) hooks.release("grenade");
    if (edge(BTN.LB)) hooks.press("tactical");           // [equipment lane]
    if (up(BTN.LB)) hooks.release("tactical");
    if (edge(BTN.DOWN)) { input.cancelDesignate(); state.streak = 1; } // signal sweep
    if (edge(BTN.UP)) input.designateTier(2);
    if (edge(BTN.RIGHT)) input.designateTier(3);
    if (edge(BTN.LEFT)) input.designateTier(4);
    if (edge(BTN.R3)) input.inspect();
    if (edge(BTN.START)) { hooks.key("Escape", "keydown"); hooks.key("Escape", "keyup"); }
    if (edge(BTN.BACK)) hooks.key("Tab", "keydown");
    if (up(BTN.BACK)) hooks.key("Tab", "keyup");

    // ---- look stick (applied by input.update after the assist has run)
    const dr = S("padDeadR", 0.1);
    const lk = radialDeadzone(g.axes[2] || 0, g.axes[3] || 0, dr);
    frame.look = lk;
    if (lk.mag >= 0.97) fullHeld += dt; else fullHeld = 0;
  }

  function menu(g, dt) {
    const dl = Math.max(0.35, S("padDeadL", 0.1));
    const mv = radialDeadzone(g.axes[0] || 0, g.axes[1] || 0, dl);
    let dir = "";
    if (cur[BTN.UP]) dir = "u"; else if (cur[BTN.DOWN]) dir = "d";
    else if (cur[BTN.LEFT]) dir = "l"; else if (cur[BTN.RIGHT]) dir = "r";
    else if (mv.mag > 0) dir = Math.abs(mv.x) > Math.abs(mv.y) ? (mv.x > 0 ? "r" : "l") : (mv.y > 0 ? "d" : "u");
    if (dir) {
      let fire = false;
      if (dir !== navRepeat.dir) { navRepeat = { dir, t: 0.38 }; fire = true; }
      else { navRepeat.t -= dt; if (navRepeat.t <= 0) { navRepeat.t = 0.11; fire = true; } }
      if (fire) {
        hooks.setDevice("pad");
        const horiz = dir === "l" || dir === "r";
        if (!(horiz && nav.adjust(dir === "r" ? 1 : -1))) {
          nav.move(dir === "l" ? -1 : dir === "r" ? 1 : 0, dir === "u" ? -1 : dir === "d" ? 1 : 0);
        }
      }
    } else navRepeat.dir = "";
    // the focused button vanished (screen changed under it): re-seat the ring
    // on the new screen, throttled — only while the pad is the active device
    if (input.lastDevice === "pad" && !(nav.focused && nav.focused.isConnected && nav.focused.getClientRects().length)) {
      refocusT -= dt;
      if (refocusT <= 0) { refocusT = 0.2; nav.ensureFocus(); }
    }
    if (edge(BTN.A)) nav.activate();
    if (edge(BTN.B) || edge(BTN.START)) { hooks.key("Escape", "keydown"); hooks.key("Escape", "keyup"); }
  }

  function update(dt) {
    frame.active = false;
    frame.look = { x: 0, y: 0, mag: 0 };
    const g = pick();
    if (!g) {
      if (had) { had = false; index = -1; releaseGameplay(); nav.clear(); prev.fill(false); }
      return frame;
    }
    if (!had) { had = true; id = g.id || ""; layout = padLayout(id); }
    const thr = S("padTrigger", 0.25);
    let any = false;
    for (let i = 0; i < 17; i++) {
      const v = btnVal(g, i);
      const trig = i === BTN.LT || i === BTN.RT;
      // triggers: threshold with hysteresis; buttons: pressed flag / >0.5
      cur[i] = trig ? (prev[i] ? v > thr * 0.7 : v >= thr) : v > 0.5;
      if (cur[i] && !prev[i]) any = true;
    }
    const dlA = S("padDeadL", 0.1) + 0.15, drA = S("padDeadR", 0.1) + 0.15;
    if (Math.hypot(g.axes[0] || 0, g.axes[1] || 0) > dlA || Math.hypot(g.axes[2] || 0, g.axes[3] || 0) > drA) any = true;
    if (any) hooks.setDevice("pad");

    const inMenu = !input.enabled;
    if (inMenu !== wasMenu) {
      if (inMenu) releaseGameplay(); else nav.clear();
      wasMenu = inMenu;
    }
    if (inMenu) menu(g, dt); else gameplay(g, dt);
    frame.active = !inMenu;
    for (let i = 0; i < 17; i++) prev[i] = cur[i];
    return frame;
  }

  /** Apply this frame's right-stick look (after the assist computed `slow`). */
  function applyLook(dt, scale, slow) {
    if (!frame.active || frame.look.mag <= 0) return { dYaw: 0, dPitch: 0 };
    const d = lookDelta(frame.look.x, frame.look.y, dt, {
      dead: 0, curve: S("padCurve", "standard"),
      sensX: S("padSensX", 1), sensY: S("padSensY", 1),
      invertY: S("invertY", "off") === "on",
      accel: accelMultiplier(fullHeld, S("padAccel", 0.5)),
      scale, slow,
    });
    input.addLook(d.dYaw, d.dPitch);
    return d;
  }

  function rumble(strong, weak, ms) {
    try {
      const list = navigator.getGamepads ? navigator.getGamepads() : null;
      const g = list && index >= 0 ? list[index] : null;
      if (!g) return false;
      const va = g.vibrationActuator;
      if (va && typeof va.playEffect === "function") {
        const p = va.playEffect(va.type || "dual-rumble", { startDelay: 0, duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) });
        if (p && p.catch) p.catch(() => {});
        return true;
      }
      const h = g.hapticActuators && g.hapticActuators[0];
      if (h && h.pulse) { const p = h.pulse(Math.max(strong, weak), ms); if (p && p.catch) p.catch(() => {}); return true; }
    } catch (e) { /* no haptics */ }
    return false;
  }

  if (typeof window !== "undefined") {
    window.addEventListener("gamepadconnected", (e) => {
      if (index < 0 && e.gamepad) { index = e.gamepad.index; had = false; }
    });
    window.addEventListener("gamepaddisconnected", (e) => {
      if (e.gamepad && e.gamepad.index === index) { index = -1; had = false; releaseGameplay(); nav.clear(); prev.fill(false); }
    });
  }

  return {
    update, applyLook, rumble, nav,
    get connected() { return had; },
    get layout() { return layout; },
    get id() { return id; },
    get frame() { return frame; },
    get moving() { return frame.move.mag > 0.2; },
    get looking() { return frame.look.mag > 0.05; },
  };
}
