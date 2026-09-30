// DYEFIELD — on-screen touch controls (CONTRACT_MOBILE M2). Pointer Events only: every control reacts to
// pointerType 'touch', tracks each touch by pointerId and captures it (setPointerCapture), so any number of
// simultaneous touches work (move + look + FIRE is the baseline). The overlay (#df-touch) sits in #ui above the HUD
// (z-index 30) and below the menus (40) and the boot cards (900); it is shown only in touch mode while a match is in
// play or paused behind the pause card (the Game calls setVisible every frame).
//
// Layout (landscape, right-handed; `leftHanded` mirrors the stick / buttons / zones; PAUSE stays top-left): CSS px ×
// `scale` (0.8–1.3), every hit target ≥ 44 × 44 CSS px, all inside env(safe-area-inset-*):
//   MOVE     floating stick: a touch that starts in the left 45 % below the top HUD band. Base Ø120 appears under the
//            thumb, knob Ø52. Output = analog moveX / moveZ in [−1, 1], measured from where the thumb LANDED (the logical
//            origin: a touch-down alone always reads 0): radial deadzone 0.12, then linear. Past the rim the origin
//            follows the finger (drag-follow). The DRAWN base is that origin clamped fully on screen inside the safe
//            area (a thumb landing at an edge draws the base a little inward — it never deflects the stick; review
//            A-A1), the knob sits at the output vector on it. Released → 0. Idle: a faint base at home.
//   LOOK     any touch in the right 55 % that does not start on a button: Δyaw = −dx·0.0040·sens·accel,
//            Δpitch = −dy·0.0032·sens·accel, accel = 1 + 0.6·clamp((speed − 600 px/s) / 1400, 0, 1).
//   FIRE     Ø88 held = fire held; a drag that starts on FIRE also looks (fire-and-aim). Icon = the kit's cut-out.
//   JUMP     Ø64 (right of / below FIRE) press latches jump.   SLICK Ø64 (left of FIRE) held = slick held.
//   SUB      Ø56 (above FIRE) press latches sub; dimmed below the sub's tank cost.
//   SPECIAL  Ø64 (above-left of FIRE) press latches special; a conic charge ring 0..1, a ready pulse; dimmed until ready.
//   PAUSE    Ø44 top-left → onPause handlers (main.ts routes them into the ESC pause path). Fires on release.
//   MAP      a tap on the HUD minimap (#df-minimap) → onMap handlers (the Input's 'map' UI action).
// Idle opacity = `opacity` (0.35–1); a pressed control is 1.0 and scaled 0.94. No text selection, no callout, no
// tap highlight (touch.css). Haptics (navigator.vibrate, feature-detected; a no-op on iOS): 8 ms per button press;
// the Game asks for 60 ms on WASHED; [12, 40, 12] when the special turns ready (setMeters' rising edge).
//
// The TouchState is shared with Input (input.ts owns the instance): this module writes it, Input.intent() and
// Input.takeTouchLook() read it. `active` counts the touches currently down (Input's mode switch waits for 0).

import './touch.css';
import { WEAPONS } from '../core/data.ts';
import { KIT_ICONS, SVG } from '../ui/icons.ts';

export interface TouchOptions { sens: number; scale: number; opacity: number; leftHanded: boolean; haptics: boolean }

/** Shared with Input (input.ts owns the instance): TouchControls writes, Input.intent()/takeTouchLook() read. */
export interface TouchState {
  moveX: number; moveZ: number;              // analog, camera-relative, |v| ≤ 1
  lookYaw: number; lookPitch: number;        // accumulated radians since the last takeTouchLook()
  held: Set<'fire' | 'slick'>;
  latched: Set<'jump' | 'sub' | 'special'>;
  active: number;                            // touches currently down (mode switching waits for 0)
}

export function createTouchState(): TouchState {
  return { moveX: 0, moveZ: 0, lookYaw: 0, lookPitch: 0, held: new Set(), latched: new Set(), active: 0 };
}

export type TouchButtonId = 'fire' | 'jump' | 'slick' | 'sub' | 'special' | 'pause';

/** CONTRACT_MOBILE M2 numbers (CSS px at scale 1, radians per px) */
export const TOUCH = {
  moveZone: 0.45,
  stickBase: 120,
  stickKnob: 52,
  deadzone: 0.12,
  lookYawPerPx: 0.0040,
  lookPitchPerPx: 0.0032,
  accelFromPxS: 600,
  accelSpanPxS: 1400,
  accelGain: 0.6,
  minTarget: 44,
  scaleMin: 0.8,
  scaleMax: 1.3,
  opacityMin: 0.35,
  opacityMax: 1,
  hapticPress: 8,
  /** a MAP tap: released within this travel (px) and time (ms) */
  tapSlopPx: 14,
  tapMs: 600,
} as const;

/**
 * The thumb cluster, right-handed: button centre as (distance from the right safe edge, distance from the bottom safe
 * edge) and diameter, all CSS px at scale 1. Checked for overlap at every scale: the closest pair (FIRE ↔ SPECIAL,
 * 104.7 px apart vs 76 px of radii) keeps a gap of ≥ 22 px × scale.
 */
const CLUSTER: ReadonlyArray<{ id: Exclude<TouchButtonId, 'pause'>; dx: number; dy: number; d: number; label: string }> = [
  { id: 'jump', dx: 52, dy: 50, d: 64, label: 'Jump' },
  { id: 'fire', dx: 146, dy: 96, d: 88, label: 'Fire (drag to aim)' },
  { id: 'slick', dx: 246, dy: 58, d: 64, label: 'Slick (hold to swim and drink)' },
  { id: 'sub', dx: 126, dy: 202, d: 56, label: 'Sub weapon' },
  { id: 'special', dx: 220, dy: 170, d: 64, label: 'Special' },
];
/** the stick's home spot: base centre this far (px at scale 1, plus the base radius) in from the bottom corner */
const STICK_HOME_PAD = 34;
const PAUSE_D = 44;
const PAUSE_PAD = 10;

const ICON_JUMP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 14.5 12 7.5l7 7" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>'
  + '<path d="M7 19.5h10" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
const ICON_SLICK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2c3 4 5.6 7.2 5.6 10.4a5.6 5.6 0 0 1-11.2 0C6.4 10.4 9 7.2 12 3.2z" fill="currentColor" stroke="#14203a" stroke-width="1.6" stroke-linejoin="round"/>'
  + '<path d="M3 20.4c1.5-1.2 3-1.2 4.5 0s3 1.2 4.5 0 3-1.2 4.5 0 3 1.2 4.5 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4.2" height="14" rx="1.6" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.6" fill="currentColor"/></svg>';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

interface Track {
  kind: 'stick' | 'look' | 'btn' | 'map' | 'none';
  id: TouchButtonId | null;
  el: HTMLElement;
  /** last position + event time (look deltas) */
  x: number; y: number; t: number;
  /** where it started (MAP tap slop) */
  sx: number; sy: number; st: number;
  /** a FIRE drag also looks */
  look: boolean;
}

interface Btn { id: TouchButtonId; el: HTMLElement; icon: HTMLElement; d: number; down: number; dimmed: boolean }

type Fn = () => void;

export class TouchControls {
  readonly root: HTMLElement;
  private readonly state: TouchState;
  private opts: TouchOptions;
  private readonly pad: HTMLElement;
  private readonly safeProbe: HTMLElement;
  private readonly stickEl: HTMLElement;
  private readonly knobEl: HTMLElement;
  private readonly btns = new Map<TouchButtonId, Btn>();
  private readonly tracks = new Map<number, Track>();
  private readonly pauseFns: Fn[] = [];
  private readonly mapFns: Fn[] = [];
  private readonly offs: Fn[] = [];
  private visible = false;
  private disposed = false;
  // stick
  private stickId: number | null = null;
  private ox = 0; private oy = 0;               // the stick's logical origin (px, client): where the thumb landed, dragged along past the rim
  private cx = 0; private cy = 0;               // the DRAWN base centre: the origin clamped fully on screen inside the safe area
  private homeX = 0; private homeY = 0;
  private baseR = TOUCH.stickBase / 2;
  // geometry
  private W = 0; private H = 0;
  private safe = { l: 0, t: 0, r: 0, b: 0 };
  private band = 64;
  // meters
  private lastFrac = -1;
  private lastReady: boolean | null = null;
  private lastSub: boolean | null = null;
  /** read-back: total look radians produced (monotonic, never zeroed by take) */
  private totalYaw = 0;
  private totalPitch = 0;
  private kitId = '';

  constructor(host: HTMLElement, state: TouchState, opts: TouchOptions) {
    this.state = state;
    this.opts = TouchControls.clean(opts);
    const root = document.createElement('div');
    root.id = 'df-touch';
    root.className = 'dft-root';                  // never 'df-touch': that class is <html>'s input-mode flag (M1)
    root.hidden = true;
    root.setAttribute('aria-label', 'Touch controls');
    this.root = root;

    this.safeProbe = document.createElement('div');
    this.safeProbe.className = 'dft-safe';
    this.pad = document.createElement('div');
    this.pad.className = 'dft-pad';
    this.stickEl = document.createElement('div');
    this.stickEl.className = 'dft-stick';
    this.knobEl = document.createElement('div');
    this.knobEl.className = 'dft-knob';
    this.stickEl.append(this.knobEl);
    root.append(this.safeProbe, this.pad, this.stickEl);

    const mk = (id: TouchButtonId, d: number, label: string, iconHtml: string): Btn => {
      const e = document.createElement('div');
      e.className = `dft-btn dft-${id}`;
      e.dataset.id = id;
      e.setAttribute('role', 'button');
      e.setAttribute('aria-label', label);
      const icon = document.createElement('span');
      icon.className = 'dft-ico';
      icon.innerHTML = iconHtml;
      e.append(icon);
      root.append(e);
      const b: Btn = { id, el: e, icon, d, down: 0, dimmed: false };
      this.btns.set(id, b);
      this.listen(e, b);
      return b;
    };
    for (const c of CLUSTER) {
      const icon = c.id === 'jump' ? ICON_JUMP : c.id === 'slick' ? ICON_SLICK : c.id === 'sub' ? (SVG['jelly-charge'] ?? '') : '';
      mk(c.id, c.d, c.label, icon);
    }
    mk('pause', PAUSE_D, 'Pause', ICON_PAUSE);
    this.listen(this.pad, null);

    host.append(root);
    const relayout = (): void => { if (this.visible) this.layout(); };
    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', relayout);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', relayout);
    // the safe-area insets can change without a resize event (WebKit may update env() after the rotation's resize):
    // the probe box is sized by env(safe-area-inset-*), so its own resize re-lays the controls out
    let ro: ResizeObserver | null = null;
    try { ro = new ResizeObserver(relayout); ro.observe(this.safeProbe); } catch { ro = null; }
    this.offs.push(() => {
      window.removeEventListener('resize', relayout);
      window.removeEventListener('orientationchange', relayout);
      vv?.removeEventListener('resize', relayout);
      ro?.disconnect();
    });
    this.applyOptions();
  }

  private static clean(o: Partial<TouchOptions>, base?: TouchOptions): TouchOptions {
    const b = base ?? { sens: 1, scale: 1, opacity: 0.75, leftHanded: false, haptics: true };
    return {
      sens: clamp(num(o.sens, b.sens), 0.05, 10),
      scale: clamp(num(o.scale, b.scale), TOUCH.scaleMin, TOUCH.scaleMax),
      opacity: clamp(num(o.opacity, b.opacity), TOUCH.opacityMin, TOUCH.opacityMax),
      leftHanded: typeof o.leftHanded === 'boolean' ? o.leftHanded : b.leftHanded,
      haptics: typeof o.haptics === 'boolean' ? o.haptics : b.haptics,
    };
  }

  // ───────────────────────────── the API ─────────────────────────────
  /** shown only in touch mode while a match is on screen (the Game decides every frame; a no-op when unchanged) */
  setVisible(on: boolean): void {
    if (this.disposed || on === this.visible) return;
    this.visible = on;
    if (!on) this.releaseAll();
    this.root.hidden = !on;
    if (on) this.layout();
  }

  setOptions(o: Partial<TouchOptions>): void {
    this.opts = TouchControls.clean(o, this.opts);
    this.applyOptions();
  }

  /** the FIRE icon (the kit's cut-out) and the SPECIAL glyph of that kit */
  setKit(kitId: string): void {
    if (kitId === this.kitId) return;
    this.kitId = kitId;
    const fire = this.btns.get('fire');
    if (fire) {
      const src = KIT_ICONS[kitId];
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        img.draggable = false;
        fire.icon.replaceChildren(img);
      } else fire.icon.textContent = '';
    }
    const sp = this.btns.get('special');
    const kit = WEAPONS.kits.find((k) => k.id === kitId);
    const spId = kit ? String(kit.special) : '';
    const spRow = WEAPONS.specials.find((s) => s.id === spId);
    if (sp) {
      sp.icon.innerHTML = SVG[spId] ?? '';
      sp.el.setAttribute('aria-label', `Special${spRow?.name ? ` — ${spRow.name}` : ''}`);
    }
    const sub = this.btns.get('sub');
    const subRow = WEAPONS.subs.find((s) => s.id === (kit ? String(kit.sub) : ''));
    if (sub && subRow?.name) sub.el.setAttribute('aria-label', `Sub weapon — ${subRow.name}`);
  }

  /** per frame, cheap: DOM writes only when a value changes (the ring in 1 % steps) */
  setMeters(m: { specialFrac: number; specialReady: boolean; subReady: boolean }): void {
    const f = Math.round(clamp(num(m.specialFrac, 0), 0, 1) * 100) / 100;
    const sp = this.btns.get('special');
    if (sp && f !== this.lastFrac) {
      this.lastFrac = f;
      sp.el.style.setProperty('--p', String(f));
    }
    if (sp && m.specialReady !== this.lastReady) {
      const was = this.lastReady;
      this.lastReady = m.specialReady;
      sp.el.classList.toggle('ready', m.specialReady);
      this.setDim(sp, !m.specialReady);
      if (m.specialReady && was === false && this.visible) this.vibrate([12, 40, 12]);
    }
    const sub = this.btns.get('sub');
    if (sub && m.subReady !== this.lastSub) {
      this.lastSub = m.subReady;
      this.setDim(sub, !m.subReady);
    }
  }

  onPause(fn: () => void): () => void {
    this.pauseFns.push(fn);
    return () => { const i = this.pauseFns.indexOf(fn); if (i >= 0) this.pauseFns.splice(i, 1); };
  }

  /** additive to the M2 API: a tap on the HUD minimap (main.ts routes it to the Input's 'map' UI action) */
  onMap(fn: () => void): () => void {
    this.mapFns.push(fn);
    return () => { const i = this.mapFns.indexOf(fn); if (i >= 0) this.mapFns.splice(i, 1); };
  }

  /** respects `haptics`; feature-detected (iOS Safari has no navigator.vibrate) */
  vibrate(pattern: number | number[]): void {
    if (!this.opts.haptics || this.disposed) return;
    try {
      const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
      if (typeof nav.vibrate === 'function') nav.vibrate(pattern);
    } catch { /* blocked (no user activation yet) */ }
  }

  dispose(): void {
    if (this.disposed) return;
    this.releaseAll();
    this.disposed = true;
    for (const f of this.offs) { try { f(); } catch { /* ignore */ } }
    this.offs.length = 0;
    this.pauseFns.length = 0;
    this.mapFns.length = 0;
    this.root.remove();
  }

  /** CONTRACT_MOBILE M10 read-back (additive; main.ts folds it into __DF__.touch()) */
  readback(): {
    visible: boolean; stick: { x: number; y: number; active: boolean }; lookRad: { yaw: number; pitch: number };
    held: string[]; latched: string[]; active: number; leftHanded: boolean; scale: number; opacity: number;
    buttons: Array<{ id: string; rect: { x: number; y: number; w: number; h: number }; dimmed: boolean }>;
  } {
    const r3 = (v: number): number => Math.round(v * 1000) / 1000;
    const buttons: Array<{ id: string; rect: { x: number; y: number; w: number; h: number }; dimmed: boolean }> = [];
    for (const b of this.btns.values()) {
      const rc = b.el.getBoundingClientRect();
      buttons.push({ id: b.id, rect: { x: Math.round(rc.left * 10) / 10, y: Math.round(rc.top * 10) / 10, w: Math.round(rc.width * 10) / 10, h: Math.round(rc.height * 10) / 10 }, dimmed: b.dimmed });
    }
    const st = this.stickEl.getBoundingClientRect();
    buttons.push({ id: 'stick', rect: { x: Math.round(st.left * 10) / 10, y: Math.round(st.top * 10) / 10, w: Math.round(st.width * 10) / 10, h: Math.round(st.height * 10) / 10 }, dimmed: false });
    return {
      visible: this.visible,
      stick: { x: r3(this.state.moveX), y: r3(this.state.moveZ), active: this.stickId !== null },
      lookRad: { yaw: r3(this.totalYaw), pitch: r3(this.totalPitch) },
      held: [...this.state.held], latched: [...this.state.latched], active: this.state.active,
      leftHanded: this.opts.leftHanded, scale: this.opts.scale, opacity: this.opts.opacity, buttons,
    };
  }

  // ───────────────────────────── layout ─────────────────────────────
  private applyOptions(): void {
    this.root.style.setProperty('--dft-o', String(this.opts.opacity));
    this.root.classList.toggle('lh', this.opts.leftHanded);
    // the HUD reads the hand and the size band (ui/styles.css: html.df-touch:has(#df-touch.lh / .big / .bigger)) to keep
    // its blocks clear of the larger thumb cluster and stick home
    this.root.classList.toggle('big', this.opts.scale >= 1.15);
    this.root.classList.toggle('bigger', this.opts.scale >= 1.25);
    if (this.visible) this.layout();
  }

  private measure(): void {
    this.W = this.root.clientWidth || window.innerWidth;
    this.H = this.root.clientHeight || window.innerHeight;
    const r = this.safeProbe.getBoundingClientRect();
    const rr = this.root.getBoundingClientRect();
    this.safe = {
      l: Math.max(0, r.left - rr.left), t: Math.max(0, r.top - rr.top),
      r: Math.max(0, rr.right - r.right), b: Math.max(0, rr.bottom - r.bottom),
    };
    // the top HUD band (crests / timer / gauge): the stick never starts in it
    this.band = this.safe.t + clamp(this.H * 0.18, 56, 120);
  }

  private layout(): void {
    this.measure();
    const s = this.opts.scale;
    const lh = this.opts.leftHanded;
    const { W, H, safe } = this;
    const place = (e: HTMLElement, cx: number, cy: number, d: number): void => {
      e.style.width = `${d}px`;
      e.style.height = `${d}px`;
      e.style.left = `${cx - d / 2}px`;
      e.style.top = `${cy - d / 2}px`;
    };
    for (const c of CLUSTER) {
      const b = this.btns.get(c.id);
      if (!b) continue;
      const d = Math.max(TOUCH.minTarget, c.d * s);
      const cy = H - safe.b - c.dy * s;
      const cx = lh ? safe.l + c.dx * s : W - safe.r - c.dx * s;
      place(b.el, cx, cy, d);
    }
    const pb = this.btns.get('pause');
    if (pb) {
      const d = Math.max(TOUCH.minTarget, PAUSE_D * s);
      place(pb.el, safe.l + PAUSE_PAD + d / 2, safe.t + PAUSE_PAD + d / 2, d);
    }
    this.baseR = (TOUCH.stickBase * s) / 2;
    const knob = TOUCH.stickKnob * s;
    this.knobEl.style.width = `${knob}px`;
    this.knobEl.style.height = `${knob}px`;
    const off = STICK_HOME_PAD * s + this.baseR;
    this.homeX = lh ? W - safe.r - off : safe.l + off;
    this.homeY = H - safe.b - off;
    if (this.stickId === null) this.placeStick(this.homeX, this.homeY, 0, 0);
    else { this.drawnCentre(); this.placeStick(this.cx, this.cy, this.state.moveX, -this.state.moveZ); }
  }

  /** the drawn base centre = the logical origin kept fully on screen inside the safe area (it never moves the output) */
  private drawnCentre(): void {
    const R = this.baseR;
    this.cx = clamp(this.ox, this.safe.l + R, Math.max(this.safe.l + R, this.W - this.safe.r - R));
    this.cy = clamp(this.oy, this.safe.t + R, Math.max(this.safe.t + R, this.H - this.safe.b - R));
  }

  /** base centre (client px) + knob offset as a fraction of the radius */
  private placeStick(cx: number, cy: number, kx: number, ky: number): void {
    const d = this.baseR * 2;
    const e = this.stickEl.style;
    e.width = `${d}px`;
    e.height = `${d}px`;
    e.left = `${cx - this.baseR}px`;
    e.top = `${cy - this.baseR}px`;
    this.knobEl.style.transform = `translate(-50%, -50%) translate3d(${(kx * this.baseR).toFixed(1)}px, ${(ky * this.baseR).toFixed(1)}px, 0)`;
  }

  private setDim(b: Btn, on: boolean): void {
    if (b.dimmed === on) return;
    b.dimmed = on;
    b.el.classList.toggle('dim', on);
  }

  // ───────────────────────────── pointers ─────────────────────────────
  private listen(el: HTMLElement, btn: Btn | null): void {
    const down = (e: PointerEvent): void => this.onDown(e, el, btn);
    const move = (e: PointerEvent): void => this.onMove(e);
    const up = (e: PointerEvent): void => this.onUp(e, false);
    const cancel = (e: PointerEvent): void => this.onUp(e, true);
    const ctx = (e: Event): void => e.preventDefault();
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('lostpointercapture', cancel);
    el.addEventListener('contextmenu', ctx);
    this.offs.push(() => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('lostpointercapture', cancel);
      el.removeEventListener('contextmenu', ctx);
    });
  }

  /** the stick's side of the screen: the left 45 % (right-handed) or the right 45 % (left-handed) */
  private stickSide(x: number): boolean {
    return this.opts.leftHanded ? x >= this.W * (1 - TOUCH.moveZone) : x < this.W * TOUCH.moveZone;
  }

  /** MOVE zone = the stick's side below the top HUD band */
  private moveZone(x: number, y: number): boolean {
    return y >= this.band && this.stickSide(x);
  }

  private onMinimap(x: number, y: number): boolean {
    const mm = document.getElementById('df-minimap');
    if (!mm) return false;
    const r = mm.getBoundingClientRect();
    return r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  private onDown(e: PointerEvent, el: HTMLElement, btn: Btn | null): void {
    if (e.pointerType !== 'touch' || !this.visible || this.disposed) return;
    e.preventDefault();
    if (this.tracks.has(e.pointerId)) return;
    const x = e.clientX, y = e.clientY;
    const tr: Track = { kind: 'none', id: null, el, x, y, t: e.timeStamp, sx: x, sy: y, st: e.timeStamp, look: false };
    if (btn) {
      tr.kind = 'btn';
      tr.id = btn.id;
      tr.look = btn.id === 'fire';
      this.press(btn);
    } else if (this.onMinimap(x, y)) {
      tr.kind = 'map';                             // a tap; a drag past the slop becomes the stick (onMove)
    } else if (this.moveZone(x, y)) {
      if (this.stickId === null) { this.startStick(tr, e.pointerId, x, y); this.stick(x, y); }
    } else if (!this.stickSide(x)) {
      tr.kind = 'look';                            // the look side, at any height (buttons catch their own touches)
    }                                              // else: the stick side's top band (HUD) — tracked, inert
    try { el.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
    this.tracks.set(e.pointerId, tr);
    this.state.active = this.tracks.size;
  }

  /**
   * the floating stick starts: its logical origin is exactly where the thumb landed (so the touch-down itself reads 0
   * — review A-A1: clamping the ORIGIN on screen made a thumb landing near the left / bottom edge read up to a full
   * deflection with no drag, and a drag inward then still read the wrong way); the drawn base is kept fully on screen
   */
  private startStick(tr: Track, id: number, x: number, y: number): void {
    tr.kind = 'stick';
    this.stickId = id;
    this.ox = x;
    this.oy = y;
    this.drawnCentre();
    this.stickEl.classList.add('on');
  }

  private onMove(e: PointerEvent): void {
    const tr = this.tracks.get(e.pointerId);
    if (!tr || this.disposed) return;
    if (e.cancelable) e.preventDefault();
    if (tr.kind === 'map') {
      // a drag that started on the minimap is the zone's own gesture, not a MAP tap: the stick on the stick side (the HUD
      // may sit inside the stick zone), a look on the look side (left-handed, the minimap sits there — review A-A7: that
      // drag used to go dead). tr.x / tr.y / tr.t still hold the touch-down, so the first look delta covers the slop.
      if (Math.hypot(e.clientX - tr.sx, e.clientY - tr.sy) <= TOUCH.tapSlopPx) return;
      if (!this.stickSide(tr.sx)) tr.kind = 'look';
      else if (!this.moveZone(tr.sx, tr.sy) || this.stickId !== null) { tr.kind = 'none'; return; }
      else this.startStick(tr, e.pointerId, tr.sx, tr.sy);
    }
    if (tr.kind === 'stick') { this.stick(e.clientX, e.clientY); return; }
    if (tr.kind !== 'look' && !(tr.kind === 'btn' && tr.look)) return;
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const evs = list.length ? list : [e];
    const k = this.opts.sens;
    for (const ev of evs) {
      const dx = ev.clientX - tr.x, dy = ev.clientY - tr.y;
      if (!dx && !dy) continue;
      const dtMs = Math.max(4, ev.timeStamp - tr.t);
      const speed = Math.hypot(dx, dy) / (dtMs / 1000);
      const accel = 1 + TOUCH.accelGain * clamp((speed - TOUCH.accelFromPxS) / TOUCH.accelSpanPxS, 0, 1);
      const dyaw = -dx * TOUCH.lookYawPerPx * k * accel;
      const dpitch = -dy * TOUCH.lookPitchPerPx * k * accel;
      this.state.lookYaw += dyaw;
      this.state.lookPitch += dpitch;
      this.totalYaw += dyaw;
      this.totalPitch += dpitch;
      tr.x = ev.clientX; tr.y = ev.clientY; tr.t = ev.timeStamp;
    }
  }

  private onUp(e: PointerEvent, cancelled: boolean): void {
    const tr = this.tracks.get(e.pointerId);
    if (!tr) return;
    this.end(e.pointerId, tr, cancelled ? null : e);
  }

  private end(id: number, tr: Track, e: PointerEvent | null): void {
    this.tracks.delete(id);
    this.state.active = this.tracks.size;
    try { if (tr.el.hasPointerCapture(id)) tr.el.releasePointerCapture(id); } catch { /* gone */ }
    if (tr.kind === 'stick' && this.stickId === id) {
      this.stickId = null;
      this.state.moveX = 0;
      this.state.moveZ = 0;
      this.stickEl.classList.remove('on');
      this.placeStick(this.homeX, this.homeY, 0, 0);
    } else if (tr.kind === 'btn' && tr.id) {
      const b = this.btns.get(tr.id);
      if (b) this.release(b);
      if (tr.id === 'pause' && e && b) {
        const r = b.el.getBoundingClientRect();
        const pad = 12;
        if (e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad) {
          for (const f of [...this.pauseFns]) { try { f(); } catch (err) { console.error('[dyefield] touch pause', err); } }
        }
      }
    } else if (tr.kind === 'map' && e) {
      if (Math.hypot(e.clientX - tr.sx, e.clientY - tr.sy) <= TOUCH.tapSlopPx && e.timeStamp - tr.st <= TOUCH.tapMs) {
        for (const f of [...this.mapFns]) { try { f(); } catch (err) { console.error('[dyefield] touch map', err); } }
      }
    }
  }

  /** stick: analog output from the logical origin with a radial deadzone, drag-follow past the rim */
  private stick(x: number, y: number): void {
    const R = this.baseR;
    let dx = x - this.ox, dy = y - this.oy;
    let d = Math.hypot(dx, dy);
    if (d > R) {
      // drag-follow: the origin slides so the finger sits on its rim
      const k = (d - R) / d;
      this.ox += dx * k;
      this.oy += dy * k;
      dx = x - this.ox; dy = y - this.oy;
      d = R;
    }
    this.drawnCentre();
    const mag = R > 0 ? Math.min(1, d / R) : 0;
    const dz = TOUCH.deadzone;
    let ox = 0, oy = 0;
    if (mag > dz && d > 1e-6) {
      const out = (mag - dz) / (1 - dz);
      ox = (dx / d) * out;
      oy = (dy / d) * out;
    }
    this.state.moveX = ox;
    this.state.moveZ = -oy;                        // screen up = forward
    this.placeStick(this.cx, this.cy, R > 0 ? dx / R : 0, R > 0 ? dy / R : 0);
  }

  private press(b: Btn): void {
    b.down++;
    b.el.classList.add('down');
    switch (b.id) {
      case 'fire': this.state.held.add('fire'); break;
      case 'slick': this.state.held.add('slick'); break;
      case 'jump': this.state.latched.add('jump'); break;
      case 'sub': this.state.latched.add('sub'); break;
      case 'special': this.state.latched.add('special'); break;
      default: break;
    }
    this.vibrate(TOUCH.hapticPress);
  }

  private release(b: Btn): void {
    b.down = Math.max(0, b.down - 1);
    if (b.down > 0) return;
    b.el.classList.remove('down');
    if (b.id === 'fire') this.state.held.delete('fire');
    else if (b.id === 'slick') this.state.held.delete('slick');
  }

  /** drop every touch (hidden / disposed): releases captures, zeroes the stick, clears held + latched */
  private releaseAll(): void {
    for (const [id, tr] of [...this.tracks]) this.end(id, tr, null);
    this.tracks.clear();
    this.state.active = 0;
    this.stickId = null;
    this.state.moveX = 0;
    this.state.moveZ = 0;
    this.state.lookYaw = 0;
    this.state.lookPitch = 0;
    this.state.held.clear();
    this.state.latched.clear();
    for (const b of this.btns.values()) { b.down = 0; b.el.classList.remove('down'); }
    this.stickEl.classList.remove('on');
  }
}
