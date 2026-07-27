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
  block: ["ShiftLeft", "ShiftRight"],
  dodge: ["Space"],
  attack: ["Mouse0", "KeyJ"],
  heavy: ["Mouse2", "KeyK"],
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
      if (!this.down.has(c)) this.pressed.add(c);
      this.down.add(c);
    };
    this._onMouseUp = (e) => { this.down.delete(`Mouse${e.button}`); };
    this._onMouseMove = (e) => {
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    };

    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
    window.addEventListener("blur", this._onBlur);
    window.addEventListener("mousedown", this._onMouseDown);
    window.addEventListener("mouseup", this._onMouseUp);
    window.addEventListener("mousemove", this._onMouseMove);
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

    // Rotate the input into world space so "forward" means "away from camera".
    const cos = Math.cos(cameraYaw), sin = Math.sin(cameraYaw);
    const wx = mx * cos + mz * sin;
    const wz = -mx * sin + mz * cos;
    const mag = Math.hypot(wx, wz);
    const moveX = mag > 1 ? wx / mag : wx;
    const moveZ = mag > 1 ? wz / mag : wz;

    // --- buttons -----------------------------------------------------------
    const padBtn = (i) => !!(pad && pad.buttons[i] && pad.buttons[i].pressed);
    const attack = this.wasPressed("attack") || padBtn(2);       // X / square
    const heavy = this.wasPressed("heavy") || padBtn(3);         // Y / triangle
    const block = this.isDown("block") || padBtn(6) || (pad && pad.buttons[6] && pad.buttons[6].value > 0.4);
    const dodge = this.wasPressed("dodge") || padBtn(1);         // B / circle

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
    window.removeEventListener("mousemove", this._onMouseMove);
  }
}
