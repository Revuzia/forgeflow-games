// Colosseum — input.
//
// Produces the SAME command struct the AI's Brain produces, so the combat sim
// cannot tell a human from a bot. That is not tidiness for its own sake: it is
// what lets a networked client send the identical payload, and what lets a
// replay or a demo drive the player slot with recorded commands.
//
// DIRECTIONAL ATTACKS: the brief calls for directional attack and block, so the
// direction has to come from somewhere the player controls WITHOUT a menu. The
// convention used here is the one fighting games settled on — direction is read
// from the movement stick/keys at the moment of the input:
//     forward + attack  -> thrust
//     left / right      -> the matching side cut
//     neutral or back   -> high cut
// It is discoverable in one bout and needs no extra buttons.

import { clamp } from "./util.js";
import { DIR } from "../data/weapons.js";

const DEFAULT_BINDS = {
  forward: ["KeyW", "ArrowUp"],
  back: ["KeyS", "ArrowDown"],
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  // MOUSE SCHEME (2026-07-28, direct player feedback): LEFT CLICK is the
  // attack — tap for a light cut, HOLD past the charge threshold and release
  // for the big committed overhead. RIGHT CLICK is the guard, where every
  // action player expects it (Shift stays as the keyboard fallback). Mouse2
  // used to fire the heavy directly, which read as "right click attacks".
  block: ["ShiftLeft", "ShiftRight", "Mouse2"],
  dodge: ["Space"],
  attack: ["Mouse0", "KeyJ"],
  heavy: ["MouseCharge", "KeyK"],
  // `armoury` and `pause` are declared so the rebinding store knows the key
  // names, but boot.js handles Tab and Escape as raw key events because they
  // must work while the sim is paused and emitting no commands.
  armoury: ["Tab"],
  pause: ["Escape"],
};
// Removed: `swap` (KeyQ) and `interact` (KeyE). Both were declared here and
// read by nothing — command() never emitted them and no consumer looked. A
// loadout has one weapon and the arena has nothing to interact with, so there
// was no verb behind either key; they only ever appeared in the store page.

export class Input {
  constructor({ binds = null, storage = null } = {}) {
    this.binds = { ...DEFAULT_BINDS, ...(binds || {}) };
    this.loadBinds(storage);

    this.down = new Set();
    this.pressed = new Set();     // edge-triggered, cleared each consume()
    this.mouse = { x: 0, y: 0, dx: 0, dy: 0 };
    this.pointerLocked = false;
    this.gamepadIndex = null;
    this.enabled = true;

    // Camera-relative movement needs the camera's yaw; the owner writes it.
    this.cameraYaw = 0;
    // Strafe handedness, persisted through Settings. false = the fixed default.
    this.invertStrafe = false;
    try {
      const v = localStorage.getItem("colosseum_invert_strafe");
      if (v !== null) this.invertStrafe = JSON.parse(v);
    } catch (e) { /* first run */ }

    this._onKeyDown = (e) => {
      if (!this.enabled) return;
      if (e.code === "Tab") e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    };
    this._onKeyUp = (e) => { this.down.delete(e.code); };
    this._onBlur = () => { this.down.clear(); };   // never leave a key stuck
    this._onMouseDown = (e) => {
      if (!this.enabled) return;
      const c = `Mouse${e.button}`;
      // LMB is tap-vs-charge: the verb is decided on RELEASE (see mouseup),
      // so button 0 only records when the press began. Everything else stays
      // edge-on-down.
      if (e.button === 0) { this._m0DownAt = performance.now(); this.down.add(c); return; }
      if (!this.down.has(c)) this.pressed.add(c);
      this.down.add(c);
    };
    this._onMouseUp = (e) => {
      this.down.delete(`Mouse${e.button}`);
      if (e.button === 0 && this._m0DownAt) {
        const held = performance.now() - this._m0DownAt;
        this._m0DownAt = 0;
        // Tap = light attack. Held past the threshold = CHARGE: the heavy
        // overhead, released when the player lets go.
        this.pressed.add(held >= 300 ? "MouseCharge" : "Mouse0");
      }
    };

    // ------------------------------------------------------------------
    // TOUCH: the game was flatly unplayable on phones — zero touch input
    // existed. Industry-standard mobile melee mapping:
    //   left half   = virtual stick (move)
    //   right half  = tap: attack · hold >=220 ms: block · flick: dodge
    // The stick is analog into moveX/moveZ; verbs feed the same edge/held
    // sets the keyboard uses, so the sim sees one command shape.
    // ------------------------------------------------------------------
    this._touch = { stick: null, sx: 0, sy: 0, mx: 0, mz: 0,
                    act: null, ax: 0, ay: 0, at: 0, holding: false,
                    attack: false, dodge: false };
    this._onTouchStart = (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        const half = t.clientX < window.innerWidth / 2;
        const T = this._touch;
        if (half && T.stick === null) {
          T.stick = t.identifier; T.sx = t.clientX; T.sy = t.clientY;
          this._stickUI(true, t.clientX, t.clientY);
        } else if (!half && T.act === null) {
          T.act = t.identifier; T.ax = t.clientX; T.ay = t.clientY;
          T.at = performance.now(); T.holding = false;
        }
      }
      if (e.cancelable) e.preventDefault();
    };
    this._onTouchMove = (e) => {
      const T = this._touch;
      for (const t of e.changedTouches) {
        if (t.identifier === T.stick) {
          const dx = (t.clientX - T.sx) / 52, dy = (t.clientY - T.sy) / 52;
          const m = Math.hypot(dx, dy) || 1;
          const k = Math.min(1, m);
          T.mx = (dx / m) * k; T.mz = -(dy / m) * k;
          this._stickUI(true, T.sx, T.sy, t.clientX, t.clientY);
        }
      }
      if (e.cancelable) e.preventDefault();
    };
    this._onTouchEnd = (e) => {
      const T = this._touch;
      for (const t of e.changedTouches) {
        if (t.identifier === T.stick) {
          T.stick = null; T.mx = 0; T.mz = 0; this._stickUI(false);
        } else if (t.identifier === T.act) {
          const dt = performance.now() - T.at;
          const dist = Math.hypot(t.clientX - T.ax, t.clientY - T.ay);
          if (dist > 60) T.dodge = true;            // flick
          else if (dt < 220 && !T.holding) T.attack = true;  // tap
          T.act = null; T.holding = false;
        }
      }
    };
    this._onMouseMove = (e) => {
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    };

    // RMB is the guard now — the browser context menu would eat every block.
    this._onCtx = (e) => { if (this.enabled) e.preventDefault(); };

    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
    window.addEventListener("blur", this._onBlur);
    window.addEventListener("mousedown", this._onMouseDown);
    window.addEventListener("mouseup", this._onMouseUp);
    window.addEventListener("contextmenu", this._onCtx);
    window.addEventListener("mousemove", this._onMouseMove);
    window.addEventListener("touchstart", this._onTouchStart, { passive: false });
    window.addEventListener("touchmove", this._onTouchMove, { passive: false });
    window.addEventListener("touchend", this._onTouchEnd);
    window.addEventListener("touchcancel", this._onTouchEnd);
    window.addEventListener("gamepadconnected", (e) => { this.gamepadIndex = e.gamepad.index; });
    window.addEventListener("gamepaddisconnected", () => { this.gamepadIndex = null; });
  }

  // -- binding ------------------------------------------------------------

  loadBinds(storage) {
    try {
      const s = storage || (typeof localStorage !== "undefined" ? localStorage : null);
      const raw = s && s.getItem("colosseum_binds");
      if (raw) this.binds = { ...this.binds, ...JSON.parse(raw) };
    } catch (e) { /* defaults are fine */ }
  }

  saveBinds(storage) {
    try {
      const s = storage || (typeof localStorage !== "undefined" ? localStorage : null);
      if (s) s.setItem("colosseum_binds", JSON.stringify(this.binds));
      return true;
    } catch (e) { return false; }
  }

  rebind(action, code) {
    if (!this.binds[action]) return false;
    this.binds[action] = [code];
    this.saveBinds();
    return true;
  }

  isDown(action) {
    const codes = this.binds[action] || [];
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  wasPressed(action) {
    const codes = this.binds[action] || [];
    for (const c of codes) if (this.pressed.has(c)) return true;
    return false;
  }

  // -- gamepad --------------------------------------------------------------

  _pad() {
    if (this.gamepadIndex === null || !navigator.getGamepads) return null;
    return navigator.getGamepads()[this.gamepadIndex] || null;
  }

  /** Deadzoned left stick, or null when no pad. */
  _stick(pad) {
    if (!pad || pad.axes.length < 2) return null;
    const x = pad.axes[0], y = pad.axes[1];
    const m = Math.hypot(x, y);
    if (m < 0.22) return { x: 0, y: 0 };
    // Rescale past the deadzone so slow walking is still available.
    const s = (m - 0.22) / 0.78 / m;
    return { x: x * s, y: y * s };
  }

  // -- the command ----------------------------------------------------------

  /**
   * Build one tick's command for the combat sim.
   * @param {object} ctx { cameraYaw, targetAngle }
   * @returns {object} the same shape Brain.update() returns
   */
  /** Faint stick indicator so a thumb knows where its anchor is. */
  _stickUI(show, x = 0, y = 0, tx = null, ty = null) {
    if (!this._stickEl) {
      const mk = (size, alpha) => {
        const d = document.createElement("div");
        d.style.cssText = `position:fixed;width:${size}px;height:${size}px;border-radius:50%;` +
          `border:2px solid rgba(232,220,192,${alpha});pointer-events:none;z-index:60;display:none;` +
          `transform:translate(-50%,-50%)`;
        document.body.appendChild(d);
        return d;
      };
      this._stickEl = mk(104, 0.35);
      this._nubEl = mk(44, 0.6);
    }
    this._stickEl.style.display = show ? "block" : "none";
    this._nubEl.style.display = show ? "block" : "none";
    if (show) {
      this._stickEl.style.left = `${x}px`; this._stickEl.style.top = `${y}px`;
      this._nubEl.style.left = `${tx ?? x}px`; this._nubEl.style.top = `${ty ?? y}px`;
    }
  }

  command({ cameraYaw = this.cameraYaw, targetAngle = null } = {}) {
    if (!this.enabled) return {};
    const pad = this._pad();

    // --- movement, in camera space ---------------------------------------
    let mx = 0, mz = 0;
    if (this.isDown("right")) mx += 1;
    if (this.isDown("left")) mx -= 1;
    if (this.isDown("forward")) mz += 1;
    if (this.isDown("back")) mz -= 1;
    const st = this._stick(pad);
    if (st && (st.x || st.y)) { mx += st.x; mz -= st.y; }
    // virtual stick (touch)
    const T = this._touch;
    if (T && T.stick !== null) { mx += T.mx; mz += T.mz; }
    // a right-side hold >=220 ms is a held guard
    if (T && T.act !== null && !T.holding && performance.now() - T.at >= 220) T.holding = true;

    // STRAFE WAS MIRRORED: A walked right and D walked left.
    //
    // Same class of bug as the forward/back inversion — the lateral basis
    // vector derived from cameraYaw comes out as the player's LEFT under this
    // atan2(x, z) convention, not their right. Reported from play, which beats
    // deriving it from the trigonometry a second time and getting the same
    // sign wrong.
    //
    // `invertStrafe` exposes it in Settings anyway, because handedness
    // preference is real and some players will want it the other way round
    // regardless of which one is "correct".
    mx = this.invertStrafe ? mx : -mx;

    // Rotate the input into world space so "forward" means "away from camera".
    const cos = Math.cos(cameraYaw), sin = Math.sin(cameraYaw);
    const wx = mx * cos + mz * sin;
    const wz = -mx * sin + mz * cos;
    const mag = Math.hypot(wx, wz);
    const moveX = mag > 1 ? wx / mag : wx;
    const moveZ = mag > 1 ? wz / mag : wz;

    // --- buttons -----------------------------------------------------------
    // GAMEPAD EDGES. buttons[i].pressed is HELD state — using it raw meant a
    // held B chain-dodged the whole stamina bar in one press and a held X
    // machine-gunned attack intents. One-shot verbs fire on the rising edge;
    // block stays held because a guard IS a held stance.
    this._padPrev = this._padPrev || {};
    const padHeld = (i) => !!(pad && pad.buttons[i] && pad.buttons[i].pressed);
    const padEdge = (i) => {
      const now = padHeld(i);
      const was = !!this._padPrev[i];
      this._padPrev[i] = now;
      return now && !was;
    };
    const attack = this.wasPressed("attack") || padEdge(2) || !!(T && T.attack);
    const heavy = this.wasPressed("heavy") || padEdge(3);        // Y / triangle
    const block = this.isDown("block") || padHeld(6) || (pad && pad.buttons[6] && pad.buttons[6].value > 0.4) ||
                  !!(T && T.holding);
    const dodge = this.wasPressed("dodge") || padEdge(1) || !!(T && T.dodge);
    if (T) { T.attack = false; T.dodge = false; }   // one-shot touch verbs

    // --- attack direction from movement intent -----------------------------
    let attackDir = DIR.HIGH;
    if (attack || heavy) {
      // Compare movement to facing: pushing toward the enemy is a thrust,
      // pushing sideways is the matching cut.
      if (mag > 0.35) {
        const moveAngle = Math.atan2(moveX, moveZ);
        const ref = targetAngle !== null ? targetAngle : moveAngle;
        let rel = moveAngle - ref;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        if (Math.abs(rel) < Math.PI / 4) attackDir = DIR.THRUST;
        else if (rel > 0) attackDir = DIR.RIGHT;
        else attackDir = DIR.LEFT;
      }
      // A heavy input always swings high — the big committed overhead.
      if (heavy) attackDir = DIR.HIGH;
    }

    // Blocking uses the same read, so you guard the side you lean toward.
    let blockDir = DIR.HIGH;
    if (block && mag > 0.35) {
      const moveAngle = Math.atan2(moveX, moveZ);
      const ref = targetAngle !== null ? targetAngle : moveAngle;
      let rel = moveAngle - ref;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      if (Math.abs(rel) > (3 * Math.PI) / 4) blockDir = DIR.HIGH;
      else if (rel > Math.PI / 4) blockDir = DIR.RIGHT;
      else if (rel < -Math.PI / 4) blockDir = DIR.LEFT;
      else blockDir = DIR.THRUST;
    }

    return {
      moveX, moveZ,
      face: targetAngle,          // the sim turns toward this
      attack: attack || heavy,
      attackDir, block, blockDir, dodge,
      heavy,
    };
  }

  /** Clear edge-triggered state. Call once per frame AFTER command(). */
  /** Persisted so the choice survives a reload. */
  setInvertStrafe(on) {
    this.invertStrafe = !!on;
    try { localStorage.setItem("colosseum_invert_strafe", JSON.stringify(this.invertStrafe)); } catch (e) {}
  }

  consume() {
    this.pressed.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
  }

  dispose() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("blur", this._onBlur);
    window.removeEventListener("mousedown", this._onMouseDown);
    window.removeEventListener("mouseup", this._onMouseUp);
    window.removeEventListener("contextmenu", this._onCtx);
    window.removeEventListener("mousemove", this._onMouseMove);
  }
}
