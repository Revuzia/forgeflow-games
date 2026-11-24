// Unified input: keyboard + mouse, touch (virtual stick, orbit drag, buttons) and gamepad.
// Produces what the sim wants (a WORLD-space move vector, jump held, a form request, restart)
// plus camera orbit deltas for the renderer.

import { FORM_NAMES } from '../sim/constants.js';

// The four form buttons, by slot: which form a slot means depends on the element being played
// (setForms). Pressing the slot of the form you are in asks for that form again, which the sim
// treats as its special.
const KEY_SLOTS = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 };
const PAD_SLOTS = [[2, 0], [3, 1], [1, 2], [5, 3]];      // gamepad button -> slot: X, Y, B, RB

export class Input {
  /**
   * @param {HTMLElement} surface element that receives mouse drags for camera orbit (the canvas)
   * @param {object} cb { onOrbit(dx,dy), onPause(), onAnyGesture(), onDismissHint(), getForms():{current, allowed[]},
   *                 onDevice('keyboard'|'pad') - the player just used that device (touch is reported by the touch layer) }
   */
  constructor(surface, cb) {
    this.cb = cb;
    this.enabled = false;
    this.keys = new Set();
    this.touchMove = { x: 0, y: 0 };      // from the virtual stick
    this.touchJump = false;
    this.jumpLatch = false;               // a press shorter than one frame still counts for one tick
    this.formQueue = null;
    this.restartHeld = false; this.restartLatch = false;
    this.padMove = { x: 0, y: 0 }; this.padLook = { x: 0, y: 0 }; this.padJump = false; this.padPrev = [];
    this.moveX = 0; this.moveY = 0;       // camera-space, after merging devices
    this.usedKeyboard = false;
    this.forms = FORM_NAMES.slice();      // the active element's forms, in button order

    const kd = (e) => {
      if (e.repeat) { if (this.enabled && isGameKey(e.code)) e.preventDefault(); return; }
      cb.onAnyGesture && cb.onAnyGesture();
      if (e.code === 'Escape' || e.code === 'KeyP') { cb.onPause && cb.onPause(); e.preventDefault(); return; }
      if (!this.enabled) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isGameKey(e.code)) e.preventDefault();
      this.usedKeyboard = true;
      cb.onDevice && cb.onDevice('keyboard');
      this.keys.add(e.code);
      if (e.code === 'Space') this.jumpLatch = true;
      else if (KEY_SLOTS[e.code] !== undefined) this.formQueue = this.forms[KEY_SLOTS[e.code]];
      else if (e.code === 'KeyQ') this._cycle(-1);
      else if (e.code === 'KeyE') this._cycle(1);
      else if (e.code === 'KeyR') this.restartLatch = true;
      else if (e.code === 'KeyH' || e.code === 'Enter') cb.onDismissHint && cb.onDismissHint();
    };
    const ku = (e) => { this.keys.delete(e.code); };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', () => this.releaseAll());

    // mouse drag orbits (touch orbit is handled by the touch layer so it can coexist with the stick)
    let dragId = null, lx = 0, ly = 0;
    surface.addEventListener('pointerdown', (e) => {
      cb.onAnyGesture && cb.onAnyGesture();
      if (e.pointerType === 'touch' || !this.enabled) return;
      if (e.pointerType === 'mouse') cb.onDevice && cb.onDevice('keyboard');
      dragId = e.pointerId; lx = e.clientX; ly = e.clientY;
      try { surface.setPointerCapture(e.pointerId); } catch (err) { /* not capturable: fine */ }
      e.preventDefault();
    });
    surface.addEventListener('pointermove', (e) => {
      if (e.pointerId !== dragId) return;
      cb.onOrbit && cb.onOrbit(e.clientX - lx, e.clientY - ly);
      lx = e.clientX; ly = e.clientY;
    });
    const end = (e) => { if (e.pointerId === dragId) dragId = null; };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _cycle(dir) {
    const f = this.cb.getForms ? this.cb.getForms() : null;
    if (!f) return;
    const list = this.forms.filter((n) => f.allowed.includes(n));
    if (list.length < 2) return;
    const i = Math.max(0, list.indexOf(f.pending || f.current));
    this.formQueue = list[(i + dir + list.length) % list.length];
  }

  /** The element changed: `list` is its four forms in button order. */
  setForms(list) { this.forms = list.slice(); this.formQueue = null; }

  /** Called by the touch layer. */
  requestForm(name) { this.formQueue = name; }
  setTouchMove(x, y) { this.touchMove.x = x; this.touchMove.y = y; }
  setTouchJump(down) { this.touchJump = down; if (down) this.jumpLatch = true; }
  requestRestart() { this.restartLatch = true; }

  releaseAll() {
    this.keys.clear(); this.touchMove.x = this.touchMove.y = 0; this.touchJump = false;
    this.jumpLatch = false; this.restartLatch = false; this.formQueue = null;
  }

  /** Poll the gamepad once per frame. Returns right-stick look for the renderer. */
  pollGamepad() {
    let pad = null;
    try {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) if (p && p.connected) { pad = p; break; }
    } catch (e) { pad = null; }
    if (!pad) { this.padMove.x = this.padMove.y = 0; this.padLook.x = this.padLook.y = 0; this.padJump = false; return this.padLook; }
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
    const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    const edge = (i) => b(i) && !this.padPrev[i];
    this.padMove.x = dz(pad.axes[0] || 0) + (b(15) ? 1 : 0) - (b(14) ? 1 : 0);
    this.padMove.y = -dz(pad.axes[1] || 0) + (b(12) ? 1 : 0) - (b(13) ? 1 : 0);
    this.padLook.x = dz(pad.axes[2] || 0); this.padLook.y = dz(pad.axes[3] || 0);
    // any real pad input (a press, or a stick pushed well off centre) means the player is on the pad
    let active = Math.hypot(this.padMove.x, this.padMove.y) > 0.5 || Math.hypot(this.padLook.x, this.padLook.y) > 0.5;
    for (let i = 0; i < pad.buttons.length && !active; i++) if (edge(i)) active = true;
    if (active && this.cb.onDevice) this.cb.onDevice('pad');
    if (edge(0)) { this.jumpLatch = true; this.cb.onAnyGesture && this.cb.onAnyGesture(); }
    this.padJump = b(0);
    if (this.enabled) {
      for (const [button, slot] of PAD_SLOTS) if (edge(button)) this.formQueue = this.forms[slot];   // X, Y, B, RB
      if (edge(4)) this._cycle(-1);                // LB
      if (edge(8)) this.restartLatch = true;       // Back/View
    }
    if (edge(9)) this.cb.onPause && this.cb.onPause(); // Start
    this.padPrev = pad.buttons.map((x) => x.pressed);
    return this.padLook;
  }

  /** Update the merged camera-space stick (call once per frame, before sampling). */
  frame() {
    const k = this.keys;
    let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let y = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    x += this.touchMove.x + this.padMove.x; y += this.touchMove.y + this.padMove.y;
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    this.moveX = this.enabled ? x : 0; this.moveY = this.enabled ? y : 0;
  }

  /**
   * One sim tick's worth of input. `yaw` is the camera yaw: the stick is camera-relative,
   * the sim wants world axes. `first` is true for the first tick of a frame: one-shot
   * requests (form, restart) are delivered once.
   */
  sample(yaw, out) {
    const s = Math.sin(yaw), c = Math.cos(yaw);
    // camera forward = (-sin, -cos), right = (cos, -sin)
    out.mx = this.moveX * c - this.moveY * s;
    out.mz = -this.moveX * s - this.moveY * c;
    const held = this.enabled && (this.keys.has('Space') || this.touchJump || this.padJump);
    out.jump = held || (this.enabled && this.jumpLatch);
    this.jumpLatch = false;
    out.form = this.enabled ? this.formQueue : null;
    this.formQueue = null;
    out.restart = this.enabled && (this.restartLatch || this.keys.has('KeyR'));
    this.restartLatch = false;
    return out;
  }
}

function isGameKey(code) {
  return code === 'Space' || code.startsWith('Arrow') || code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD';
}
