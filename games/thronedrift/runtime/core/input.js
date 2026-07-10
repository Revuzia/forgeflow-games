// Thronedrift — unified keyboard / mouse / touch input.
// Physical key codes are used so WASD positions also serve ZQSD (AZERTY) users.
// HUD pipes virtual joystick + touch ability buttons into this same object.

export class Input {
  constructor() {
    this.keys = new Set();
    // virtual joystick vector (-1..1), zero when inactive
    this.joyX = 0; this.joyZ = 0;
    this.basicHeld = false;        // spam attack (J / left mouse / touch)
    this._abilityEdges = [false, false, false];
    this.abilityHeld = [false, false, false];  // held state (Bulwark block = hold)
    this._toggleEdge = false;      // warrior weapon-mode swap (TAB / F / touch)
    this._pauseEdge = false;
    this.pointer = { x: 0, y: 0, down: false }; // NDC coords for aim raycast
    this.enabled = false;
    // camera controls: wheel/pinch zoom + right-drag orbit (yaw) and pitch
    this.camZoom = 1; this.camYaw = 0; this.camPitch = 1;
    this._rightDrag = null;
    this._pinch = new Map();

    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (e.code === "Tab") e.preventDefault();
      this.keys.add(e.code);
      if (!this.enabled) return;
      if (e.code === "KeyJ" || e.code === "Space") this.basicHeld = true;
      if (e.code === "Digit1" || e.code === "KeyU") this._press(0, true);
      if (e.code === "Digit2" || e.code === "KeyI") this._press(1, true);
      if (e.code === "Digit3" || e.code === "KeyO") this._press(2, true);
      if (e.code === "Tab" || e.code === "KeyF") this._toggleEdge = true;
      if (e.code === "Escape" || e.code === "KeyP") this._pauseEdge = true;
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") this._dashEdge = true;
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
      if (e.code === "KeyJ" || e.code === "Space") this.basicHeld = false;
      if (e.code === "Digit1" || e.code === "KeyU") this._press(0, false);
      if (e.code === "Digit2" || e.code === "KeyI") this._press(1, false);
      if (e.code === "Digit3" || e.code === "KeyO") this._press(2, false);
    });
    window.addEventListener("blur", () => { this.keys.clear(); this.basicHeld = false; this.abilityHeld = [false, false, false]; });
  }

  bindCanvas(canvas) {
    canvas.addEventListener("contextmenu", (e) => e.preventDefault()); // right-drag orbits
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.camZoom = Math.min(1.9, Math.max(0.5, this.camZoom * (1 + e.deltaY * 0.0011)));
    }, { passive: false });
    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "touch") {
        // two-finger pinch on the canvas = zoom (joystick/buttons live on HUD)
        this._pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
        return;
      }
      if (e.button === 2) { this._rightDrag = { x: e.clientX, y: e.clientY }; return; }
      this.pointer.down = true;
      if (this.enabled) this.basicHeld = true;
      this._updPointer(e, canvas);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch" && this._pinch.has(e.pointerId)) {
        const pts = this._pinch;
        if (pts.size === 2) {
          const [a, b] = [...pts.values()];
          const before = Math.hypot(a.x - b.x, a.y - b.y);
          pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const [a2, b2] = [...pts.values()];
          const after = Math.hypot(a2.x - b2.x, a2.y - b2.y);
          if (before > 0) this.camZoom = Math.min(1.6, Math.max(0.55, this.camZoom * (before / after)));
        } else pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        return;
      }
      if (this._rightDrag) {
        this.camYaw += (e.clientX - this._rightDrag.x) * 0.006;
        this.camPitch = Math.min(1.6, Math.max(0.45, this.camPitch + (e.clientY - this._rightDrag.y) * 0.004)); // drag DOWN looks down; wide range for full angle control
        this._rightDrag = { x: e.clientX, y: e.clientY };
        return;
      }
      this._updPointer(e, canvas);
    });
    window.addEventListener("pointerup", (e) => {
      this._pinch.delete(e.pointerId);
      if (e.button === 2) { this._rightDrag = null; return; }
      if (e.pointerType === "touch") return;
      this.pointer.down = false; this.basicHeld = this.keys.has("KeyJ") || this.keys.has("Space");
    });
    window.addEventListener("pointercancel", (e) => this._pinch.delete(e.pointerId));
  }

  _updPointer(e, canvas) {
    const r = canvas.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  _press(i, down) {
    if (down && !this.abilityHeld[i]) this._abilityEdges[i] = true;
    this.abilityHeld[i] = down;
  }

  // called by HUD touch controls
  setJoystick(x, z) { this.joyX = x; this.joyZ = z; }
  touchBasic(down) { if (this.enabled || !down) this.basicHeld = down; }
  touchAbility(i, down) { if (this.enabled || !down) this._press(i, down); }
  touchToggle() { if (this.enabled) this._toggleEdge = true; }

  // movement vector from keys + joystick, normalized
  moveVec() {
    let x = 0, z = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) z -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) z += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) x -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) x += 1;
    x += this.joyX; z += this.joyZ;
    const m = Math.hypot(x, z);
    if (m > 1) { x /= m; z /= m; }
    return { x, z, mag: Math.min(m, 1) };
  }

  // edge-triggered reads (consume)
  abilityPressed(i) { const v = this._abilityEdges[i]; this._abilityEdges[i] = false; return v; }
  togglePressed() { const v = this._toggleEdge; this._toggleEdge = false; return v; }
  dashPressed() { const v = this._dashEdge; this._dashEdge = false; return v; }
  touchDash() { if (this.enabled) this._dashEdge = true; }
  pausePressed() { const v = this._pauseEdge; this._pauseEdge = false; return v; }
  clearEdges() { this._abilityEdges = [false, false, false]; this._toggleEdge = false; this._pauseEdge = false; }
}
