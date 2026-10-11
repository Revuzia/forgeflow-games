// GENESIS — the gamepad (CONTRACT.md §16: "gamepad (standard mapping; virtual cursor)", radial on the stick): polls
// the W3C standard-mapping pad each frame, moves a virtual cursor with the left stick (the hand and every pointer tool
// use it like a mouse), reports the right stick for the camera and the radial, and turns buttons into named edges
// ('A', 'RT', 'Up' …) that the shell maps to actions through the keybind registry (gamepad bindings are rebindable).
// The cursor shows while the pad is in use and hides when the mouse moves.

import { PAD_BUTTONS } from './keybinds.ts';
import { h } from './dom.ts';

export interface PadFrame {
  connected: boolean;
  /** sticks after the dead zone, −1..1 (y down) */
  lx: number; ly: number; rx: number; ry: number;
  /** triggers 0..1 */
  lt: number; rt: number;
}

export class Gamepad {
  readonly cursorEl: HTMLDivElement;
  /** the virtual cursor (CSS px) */
  x = window.innerWidth / 2;
  y = window.innerHeight / 2;
  /** the pad was the last thing touched */
  active = false;
  private prev: boolean[] = [];
  private lastUse = -1e9;
  deadzone = 0.18;
  speed = 900;
  enabled = true;
  /**
   * the left stick drives a camera mode (walking, photo) instead of the cursor: the cursor stays in the middle of the
   * screen (powers and the hand work where the eye looks) and hides
   */
  locked = false;
  /** button edges: (name, pressed) */
  onButton: ((name: string, down: boolean) => void) | null = null;
  /** a one-shot listener for rebinding (the next button pressed) */
  private nextWaiters: ((name: string | null) => void)[] = [];
  readonly frameState: PadFrame = { connected: false, lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 };

  constructor(layer: HTMLElement) {
    this.cursorEl = h('div', { class: 'gn-padcursor' }, h('i'));
    this.cursorEl.hidden = true;
    layer.appendChild(this.cursorEl);
    window.addEventListener('pointermove', () => { if (this.active) { this.active = false; this.cursorEl.hidden = true; } });
    window.addEventListener('gamepadconnected', () => { this.prev = []; });
  }

  private axis(v: number): number {
    const a = Math.abs(v);
    if (a < this.deadzone) return 0;
    return Math.sign(v) * ((a - this.deadzone) / (1 - this.deadzone)) ** 1.6;
  }

  /** poll once per frame */
  poll(dt: number): PadFrame {
    const f = this.frameState;
    f.connected = false;
    f.lx = f.ly = f.rx = f.ry = f.lt = f.rt = 0;
    if (!this.enabled || typeof navigator === 'undefined' || !navigator.getGamepads) return f;
    let pad: globalThis.Gamepad | null = null;
    for (const p of navigator.getGamepads()) if (p && p.connected) { pad = p; break; }
    if (!pad) return f;
    f.connected = true;
    f.lx = this.axis(pad.axes[0] ?? 0); f.ly = this.axis(pad.axes[1] ?? 0);
    f.rx = this.axis(pad.axes[2] ?? 0); f.ry = this.axis(pad.axes[3] ?? 0);
    f.lt = pad.buttons[6]?.value ?? 0; f.rt = pad.buttons[7]?.value ?? 0;
    const now = performance.now();
    if (f.lx || f.ly || f.rx || f.ry) this.touch(now);
    // the cursor (held in the middle while a camera mode has the stick)
    if (this.locked) { this.x = window.innerWidth / 2; this.y = window.innerHeight / 2; }
    else if (f.lx || f.ly) {
      const W = window.innerWidth, H = window.innerHeight;
      this.x = Math.min(W - 2, Math.max(2, this.x + f.lx * this.speed * dt));
      this.y = Math.min(H - 2, Math.max(2, this.y + f.ly * this.speed * dt));
    }
    // buttons → edges
    for (let i = 0; i < PAD_BUTTONS.length && i < pad.buttons.length; i++) {
      const b = pad.buttons[i];
      const down = b.pressed || b.value > 0.5;
      if (down !== !!this.prev[i]) {
        this.prev[i] = down;
        this.touch(now);
        const name = PAD_BUTTONS[i];
        if (down && this.nextWaiters.length) { for (const w of this.nextWaiters.splice(0)) w(name); continue; }
        this.onButton?.(name, down);
      }
    }
    if (this.active) {
      this.cursorEl.hidden = this.locked;
      this.cursorEl.style.transform = `translate(${this.x.toFixed(1)}px, ${this.y.toFixed(1)}px)`;
    }
    if (now - this.lastUse > 6000 && this.active) { this.active = false; this.cursorEl.hidden = true; }
    return f;
  }

  private touch(now: number): void {
    this.lastUse = now;
    if (!this.active) { this.active = true; this.cursorEl.hidden = false; }
  }

  /** is a button down now */
  isDown(name: string): boolean {
    const i = (PAD_BUTTONS as readonly string[]).indexOf(name);
    return i >= 0 && !!this.prev[i];
  }

  /** the next button pressed (rebinding); null when cancelled */
  nextButton(signal: AbortSignal): Promise<string | null> {
    return new Promise((ok) => {
      const w = (n: string | null) => ok(n);
      this.nextWaiters.push(w);
      signal.addEventListener('abort', () => { const i = this.nextWaiters.indexOf(w); if (i >= 0) this.nextWaiters.splice(i, 1); ok(null); });
    });
  }

  /** where the cursor is when the pad drives it */
  pointer(): [number, number] | null { return this.active ? [this.x, this.y] : null; }
}
