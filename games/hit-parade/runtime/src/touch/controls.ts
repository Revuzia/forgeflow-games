// HIT PARADE - on-screen touch controls (lane UI; CONTRACT_MOBILE M2). Engine from dyefield/runtime/src/touch/controls.ts:
// Pointer Events only (pointerType 'touch'), every touch tracked by pointerId and captured (setPointerCapture), any
// number of simultaneous touches (stick + two buttons is the baseline). The overlay #hp-touch sits above the HUD (z 30)
// and below the menus (40); game.ts shows it only in touch mode while a bout is on screen.
//
// Layout = the SIMPLE "PAD" of FIGHTING_DESIGN 5c (landscape, right-handed; leftHanded mirrors it; CSS px x `scale`,
// every hit target >= 44 px, all inside env(safe-area-inset-*)):
//   STICK   floating: a touch that starts in the left 45 % below the top HUD band. Base 120, knob 52, radial deadzone
//           15 %. 8-way sectors with a 60-degree UP sector so a jump needs intent (up family 30..150 deg: 7 / 8 / 9 =
//           30 / 60 / 30 deg; left / right 52.5 deg each; the down family 202.5..337.5 deg, 45 deg each). Output =
//           screen-relative UP / DOWN / LEFT / RIGHT bits of the CONTRACT 4.4 input word; holding away = block, down-away =
//           crouch block (the sim reads that from the word).
//   L M H 72 and SP 84 in an arc round the thumb; PARRY 64 above; THROW 60 and IMPACT 60 (macro buttons);
//   SUPER   64, the S+H macro, shown only while SHOWTIME holds >= 1 bar (pulses at 3);
//   ASSIST  a chip: a tap latches ASSIST for 1 s (holding a modifier while tapping is awkward on glass); held = held.
//   PAUSE   44, top centre under the timer -> onPause handlers (game.ts routes them into the ESC pause path).
//   STEP    CHANGED(UI3D) (CONTRACT §35.2): two 56 px buttons ABOVE the stick's home - IN (circle away from the camera, bit 13
//           STEP_IN) and OUT (toward it, bit 14 STEP_OUT). A tap = SIDESTEP, a hold = SIDEWALK (circle-walk round the ring);
//           the sim tells the two apart by how long the bit is held, the overlay only holds / latches it like any button.
//           Anchored to the stick side (left edge; the right edge when left-handed), part of EDIT LAYOUT like the rest.
// A press stays alive while the thumb slides off the button (captured) until it lifts. TouchState is CONTRACT 18.5:
// `held` = the bits held right now (stick direction + buttons + the ASSIST latch), `latched` = bits pressed since the
// last tick (OR-ed in here, cleared by input.ts at each tick), so a tap shorter than one tick still reaches the sim.
// EDIT LAYOUT (editLayout(true)): drag a button to move it, tap one to select it and BIGGER / SMALLER it, RESET, DONE ->
// onLayout handlers get the TouchLayout ({id: {dx, dy, s}}) for the settings store; setOptions({layout}) applies one.
// CHANGED(wf6 fixer) VO-D3 (CONTRACT §35.26): BUTTON SIZE is FITTED to the screen. The pad scaled about the bottom corners
// with no check against the top HUD or the PAUSE disc: at the slider's own maximum (130 %) on the 667 x 375 phone THROW sat
// on PAUSE (a throw could pause the game) and IMPACT under P2's NERVE / RATINGS (844 x 390 too). layout() now takes the
// largest button size <= the setting (never below min(1, setting): the shipped 100 % layout is verified clean) at which
// every button the player has not moved stays under the HUD's measured bottom (HUD_SELECTOR, + 6 px, never above the
// band), clear of PAUSE and 4 px clear of its neighbours. The spread (button offsets, the stick) may stay up to 12 %
// smaller than the button size - the 100 % layout leaves >= 16 % between neighbours - so a short phone still gets bigger
// discs (readback `fitScale` = disc size, `fitSpread` = offsets).

import './touch.css';

export type TouchButtonId = 'l' | 'm' | 'h' | 's' | 'parry' | 'impact' | 'throw' | 'super' | 'assist' | 'pause' | 'stepin' | 'stepout';
export type TouchLayout = Record<string, { dx: number; dy: number; s: number }>;
export interface TouchOptions { scale: number; opacity: number; leftHanded: boolean; haptics: boolean; layout: TouchLayout | null }
/** CONTRACT 18.5 (input.ts owns the instance as `Input.touch`): TouchControls writes, input.ts consumes it each tick */
export interface TouchState { held: number; latched: number; active: number }
export function createTouchState(): TouchState { return { held: 0, latched: 0, active: 0 }; }

/** CONTRACT 4.4 bits (+ CHANGED(UI3D) §35.2 STEP_IN 13 / STEP_OUT 14) */
export const BIT = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, L: 16, M: 32, H: 64, S: 128, ASSIST: 256, THROW: 512, PARRY: 1024, IMPACT: 2048, STEP_IN: 8192, STEP_OUT: 16384 } as const;
/** CHANGED(UI3D): every defined word bit (0x1fff -> 0x7fff: the STEP bits reach input.ts) */
export const WORD_MASK = 0x7fff;

export const TOUCH = {
  moveZone: 0.45, stickBase: 120, stickKnob: 52, deadzone: 0.15, minTarget: 44, scaleMin: 0.8, scaleMax: 1.3,
  opacityMin: 0.35, opacityMax: 1, hapticPress: 8, assistLatchMs: 1000, editScaleMin: 0.7, editScaleMax: 1.5,
} as const;

/**
 * the right-hand cluster at scale 1: centre (px from the right safe edge, px from the bottom safe edge), diameter.
 * CHANGED(UI3D): `left: true` entries (the STEP pair) are measured from the LEFT safe edge instead - the stick's side, above
 * its home (stick home centre = 94 px in / 94 px up, base radius 60: the pair sits 14 px over the base's top edge, 16 px apart).
 */
const CLUSTER: ReadonlyArray<{ id: Exclude<TouchButtonId, 'pause'>; dx: number; dy: number; d: number; bits: number; label: string; left?: boolean }> = [
  { id: 's', dx: 62, dy: 70, d: 84, bits: BIT.S, label: 'SP' },
  { id: 'h', dx: 150, dy: 44, d: 72, bits: BIT.H, label: 'H' },
  { id: 'm', dx: 156, dy: 128, d: 72, bits: BIT.M, label: 'M' },
  { id: 'l', dx: 238, dy: 86, d: 72, bits: BIT.L, label: 'L' },
  { id: 'parry', dx: 84, dy: 160, d: 64, bits: BIT.PARRY, label: 'PARRY' },
  { id: 'impact', dx: 160, dy: 212, d: 60, bits: BIT.IMPACT, label: 'IMPACT' },
  { id: 'throw', dx: 240, dy: 172, d: 60, bits: BIT.THROW, label: 'THROW' },
  { id: 'super', dx: 50, dy: 244, d: 64, bits: BIT.S | BIT.H, label: 'SUPER' },
  { id: 'assist', dx: 318, dy: 40, d: 52, bits: BIT.ASSIST, label: 'ASSIST' },
  { id: 'stepin', dx: 58, dy: 196, d: 56, bits: BIT.STEP_IN, label: 'IN', left: true },
  { id: 'stepout', dx: 130, dy: 196, d: 56, bits: BIT.STEP_OUT, label: 'OUT', left: true },
];
const PAUSE_D = 44;
/** CHANGED(wf6 fixer) VO-D3: the top HUD blocks the pad must stay under (their measured bottom edge) */
const HUD_SELECTOR = '.hp-bars, .hp-side, .hp-show';
const PAUSE_TOP = 96;            // pause centre, px below the top safe edge (under the HUD timer + pips; >= 20 % of the height)
const STICK_HOME_PAD = 34;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** 8-way direction bits from a stick vector (x right, y UP), per the sector table in the header */
export function sectorBits(x: number, y: number): number {
  let a = (Math.atan2(y, x) * 180) / Math.PI;
  if (a < 0) a += 360;
  if (a >= 337.5 || a < 30) return BIT.RIGHT;
  if (a < 60) return BIT.UP | BIT.RIGHT;
  if (a <= 120) return BIT.UP;
  if (a <= 150) return BIT.UP | BIT.LEFT;
  if (a < 202.5) return BIT.LEFT;
  if (a <= 247.5) return BIT.DOWN | BIT.LEFT;
  if (a < 292.5) return BIT.DOWN;
  return BIT.DOWN | BIT.RIGHT;
}

interface Track { kind: 'stick' | 'btn' | 'edit' | 'none'; id: TouchButtonId | null; el: HTMLElement; sx: number; sy: number; ox: number; oy: number; moved: boolean }
interface Btn { id: TouchButtonId; el: HTMLElement; d: number; bits: number; down: number; dimmed: boolean; hidden: boolean; cx: number; cy: number }
type Fn = () => void;

export class TouchControls {
  readonly root: HTMLElement;
  private readonly state: TouchState;
  private opts: TouchOptions;
  private readonly pad: HTMLElement;
  private readonly safeProbe: HTMLElement;
  private readonly stickEl: HTMLElement;
  private readonly knobEl: HTMLElement;
  private readonly editBar: HTMLElement;
  private readonly btns = new Map<TouchButtonId, Btn>();
  private readonly tracks = new Map<number, Track>();
  private readonly pauseFns: Fn[] = [];
  private readonly layoutFns: Array<(l: TouchLayout) => void> = [];
  private readonly offs: Fn[] = [];
  private visible = false;
  private disposed = false;
  private editing = false;
  private editSel: TouchButtonId | null = null;
  private editLayoutDraft: TouchLayout = {};
  private stickId: number | null = null;
  private ox = 0; private oy = 0; private cx = 0; private cy = 0; private homeX = 0; private homeY = 0;
  private baseR = TOUCH.stickBase / 2;
  private W = 0; private H = 0;
  private safe = { l: 0, t: 0, r: 0, b: 0 };
  private band = 64;
  /** CHANGED(wf6 fixer) VO-D3: the disc size / offset spread the pad was laid out at (<= opts.scale; see layout) */
  private fitScale = 1;
  private fitSpread = 1;
  private assistUntil = 0;
  private assistTimer = 0;
  /** the stick's direction bits and the buttons' bits, composed into state.held */
  private dir = 0;
  private btnHeld = 0;
  private lastShow = -1;
  /** read-back counters: presses per button and words read with a direction */
  readonly stats = { presses: {} as Record<string, number>, dirWords: 0, reads: 0 };

  constructor(host: HTMLElement, state: TouchState, opts: Partial<TouchOptions> = {}) {
    this.state = state;
    this.opts = TouchControls.clean(opts);
    const root = document.createElement('div');
    root.id = 'hp-touch';
    root.className = 'hpt-root';               // never 'hp-touch': that class is <html>'s input-mode flag (M1)
    root.hidden = true;
    root.setAttribute('aria-label', 'Touch controls');
    this.root = root;
    this.safeProbe = document.createElement('div');
    this.safeProbe.className = 'hpt-safe';
    this.pad = document.createElement('div');
    this.pad.className = 'hpt-pad';
    this.stickEl = document.createElement('div');
    this.stickEl.className = 'hpt-stick';
    this.knobEl = document.createElement('div');
    this.knobEl.className = 'hpt-knob';
    this.stickEl.append(this.knobEl);
    root.append(this.safeProbe, this.pad, this.stickEl);
    const mk = (id: TouchButtonId, d: number, bits: number, label: string): void => {
      const e = document.createElement('div');
      e.className = `hpt-btn hpt-${id}`;
      e.dataset.id = id;
      e.setAttribute('role', 'button');
      e.setAttribute('aria-label', label);
      const lab = document.createElement('span');
      // CHANGED(UI) P2 (verifier: labels overflowed their discs on an iPhone, DPR 3): words of 4+ letters use the condensed
      // face and every label is shrunk to fit its disc (fitLabels, after each layout and once the fonts have loaded)
      lab.className = label.length >= 4 && id !== 'pause' ? 'hpt-lbl long' : 'hpt-lbl';
      lab.textContent = id === 'pause' ? '' : label;
      if (id === 'pause') lab.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/></svg>';
      e.append(lab);
      root.append(e);
      const b: Btn = { id, el: e, d, bits, down: 0, dimmed: false, hidden: false, cx: 0, cy: 0 };
      this.btns.set(id, b);
      this.listen(e, b);
    };
    for (const c of CLUSTER) mk(c.id, c.d, c.bits, c.label);
    mk('pause', PAUSE_D, 0, 'PAUSE');
    this.listen(this.pad, null);
    // EDIT LAYOUT toolbar
    this.editBar = document.createElement('div');
    this.editBar.className = 'hpt-edit';
    this.editBar.hidden = true;
    const hint = document.createElement('span');
    hint.className = 'hint';
    this.editBar.append(hint);
    // inside this touch-action:none overlay a tap right after a drag gets no synthesized click from the browser's
    // gesture detector: touches activate on pointerup (inside the button), mouse / keyboard on click
    const tb = (cls: string, fn: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `hpt-ebtn ${cls}`;
      let lastTouch = -1e9;
      b.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch { /* gone */ } } });
      b.addEventListener('pointerup', (e) => {
        if (e.pointerType !== 'touch') return;
        const r = b.getBoundingClientRect();
        if (e.clientX < r.left - 12 || e.clientX > r.right + 12 || e.clientY < r.top - 12 || e.clientY > r.bottom + 12) return;
        lastTouch = performance.now();
        e.stopPropagation();
        fn();
      });
      b.addEventListener('click', (e) => { e.stopPropagation(); if (performance.now() - lastTouch > 600) fn(); });
      this.editBar.append(b);
      return b;
    };
    tb('smaller', () => this.resizeSel(-0.1));
    tb('bigger', () => this.resizeSel(0.1));
    tb('reset', () => { this.editLayoutDraft = {}; this.layout(); });
    tb('done', () => this.editLayout(false));
    root.append(this.editBar);
    this.setEditLabels({ hint: 'DRAG A BUTTON TO MOVE IT. TAP ONE TO RESIZE IT.', smaller: 'SMALLER', bigger: 'BIGGER', reset: 'RESET', done: 'DONE' });

    host.append(root);
    const relayout = (): void => { if (this.visible) this.layout(); };
    // the label fit measures real glyphs: re-fit once the web fonts are in
    try { void document.fonts?.ready.then(relayout); } catch { /* no FontFaceSet */ }
    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', relayout);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', relayout);
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
    const b = base ?? { scale: 1, opacity: 0.75, leftHanded: false, haptics: true, layout: null };
    return {
      scale: clamp(num(o.scale, b.scale), TOUCH.scaleMin, TOUCH.scaleMax),
      opacity: clamp(num(o.opacity, b.opacity), TOUCH.opacityMin, TOUCH.opacityMax),
      leftHanded: typeof o.leftHanded === 'boolean' ? o.leftHanded : b.leftHanded,
      haptics: typeof o.haptics === 'boolean' ? o.haptics : b.haptics,
      layout: o.layout === undefined ? b.layout : (o.layout && typeof o.layout === 'object' ? o.layout : null),
    };
  }

  // ─────────────────────────── API (CONTRACT_MOBILE M2) ───────────────────────────
  setVisible(on: boolean): void {
    if (this.disposed || on === this.visible) return;
    this.visible = on;
    if (!on) { this.releaseAll(); if (this.editing) this.editLayout(false); }
    this.root.hidden = !on;
    if (on) {
      this.layout();
      // CHANGED(wf6 fixer) VO-D3: the HUD may lay out in the same frame the overlay appears - fit again once it has
      try { requestAnimationFrame(() => { if (this.visible && !this.disposed) this.layout(); }); } catch { /* no rAF */ }
    }
  }

  setOptions(o: Partial<TouchOptions>): void { this.opts = TouchControls.clean(o, this.opts); this.applyOptions(); }

  /** localised labels for the EDIT LAYOUT bar (strings.json touch.*) */
  setEditLabels(l: { hint: string; smaller: string; bigger: string; reset: string; done: string }): void {
    const q = (s: string): HTMLElement | null => this.editBar.querySelector(s);
    const set = (s: string, v: string): void => { const e = q(s); if (e) e.textContent = v; };
    set('.hint', l.hint); set('.smaller', l.smaller); set('.bigger', l.bigger); set('.reset', l.reset); set('.done', l.done);
  }

  /** per frame, cheap: SUPER shows at >= 1 SHOWTIME bar (pulses at 3); PARRY / IMPACT dim during STAGE FRIGHT */
  setMeters(m: { showtime: number; nerve: number; stageFright: boolean }): void {
    const bars = Math.floor(Math.max(0, num(m.showtime, 0)) / 10000);
    if (bars !== this.lastShow) {
      const was = this.lastShow;
      this.lastShow = bars;
      const sup = this.btns.get('super');
      if (sup) {
        const hide = bars < 1;
        if (hide !== sup.hidden) { sup.hidden = hide; sup.el.classList.toggle('off', hide); if (hide) this.forceRelease(sup); }
        sup.el.classList.toggle('max', bars >= 3);
      }
      const sp = this.btns.get('s');
      sp?.el.style.setProperty('--p', String(Math.min(1, bars / 3)));
      if (bars >= 3 && was >= 0 && was < 3 && this.visible) this.vibrate([12, 40, 12]);
    }
    for (const id of ['parry', 'impact'] as const) {
      const b = this.btns.get(id);
      if (b && b.dimmed !== m.stageFright) { b.dimmed = m.stageFright; b.el.classList.toggle('dim', m.stageFright); }
    }
  }

  /** held | latched, clearing latched - what input.ts does at each sim tick (the lab and harness use it directly) */
  readWord(): number {
    const w = this.state.held | this.state.latched;
    this.state.latched = 0;
    this.stats.reads++;
    if (w & 15) this.stats.dirWords++;
    return w & WORD_MASK;
  }

  onPause(fn: () => void): () => void { this.pauseFns.push(fn); return () => { const i = this.pauseFns.indexOf(fn); if (i >= 0) this.pauseFns.splice(i, 1); }; }
  onLayout(fn: (l: TouchLayout) => void): () => void { this.layoutFns.push(fn); return () => { const i = this.layoutFns.indexOf(fn); if (i >= 0) this.layoutFns.splice(i, 1); }; }

  /** EDIT LAYOUT mode: buttons stop producing input; drags move them; DONE (or editLayout(false)) saves */
  editLayout(on: boolean): void {
    if (on === this.editing) return;
    if (on) { this.releaseAll(); this.editLayoutDraft = { ...(this.opts.layout ?? {}) }; this.editSel = null; }
    this.editing = on;
    this.root.classList.toggle('editing', on);
    this.editBar.hidden = !on;
    for (const b of this.btns.values()) b.el.classList.remove('sel');
    if (!on) {
      this.opts = { ...this.opts, layout: Object.keys(this.editLayoutDraft).length ? { ...this.editLayoutDraft } : null };
      for (const f of [...this.layoutFns]) { try { f(this.opts.layout ?? {}); } catch (e) { console.error('[hit-parade] touch layout', e); } }
    }
    this.layout();
  }

  vibrate(pattern: number | number[]): void {
    if (!this.opts.haptics || this.disposed) return;
    try {
      const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
      if (typeof nav.vibrate === 'function') nav.vibrate(pattern);
    } catch { /* no user activation yet */ }
  }

  dispose(): void {
    if (this.disposed) return;
    this.releaseAll();
    this.disposed = true;
    for (const f of this.offs) { try { f(); } catch { /* ignore */ } }
    this.offs.length = 0;
    this.pauseFns.length = 0;
    this.layoutFns.length = 0;
    this.root.remove();
  }

  /** CONTRACT_MOBILE M10 read-back */
  readback(): Record<string, unknown> {
    const r1 = (v: number): number => Math.round(v * 10) / 10;
    const buttons: Array<{ id: string; rect: { x: number; y: number; w: number; h: number }; dimmed: boolean; hidden: boolean }> = [];
    for (const b of this.btns.values()) {
      if (b.hidden) continue;
      const rc = b.el.getBoundingClientRect();
      buttons.push({ id: b.id, rect: { x: r1(rc.left), y: r1(rc.top), w: r1(rc.width), h: r1(rc.height) }, dimmed: b.dimmed, hidden: b.hidden });
    }
    const st = this.stickEl.getBoundingClientRect();
    buttons.push({ id: 'stick', rect: { x: r1(st.left), y: r1(st.top), w: r1(st.width), h: r1(st.height) }, dimmed: false, hidden: false });
    return {
      visible: this.visible, editing: this.editing, dir: this.dir, held: this.state.held, latched: this.state.latched,
      active: this.state.active, stick: { active: this.stickId !== null }, assist: performance.now() < this.assistUntil,
      leftHanded: this.opts.leftHanded, scale: this.opts.scale, fitScale: Math.round(this.fitScale * 1000) / 1000, fitSpread: Math.round(this.fitSpread * 1000) / 1000, opacity: this.opts.opacity, layout: this.opts.layout,
      buttons, stats: { presses: { ...this.stats.presses }, dirWords: this.stats.dirWords, reads: this.stats.reads },
      labels: this.visible ? this.labelFit() : [],
    };
  }

  // ─────────────────────────── layout ───────────────────────────
  private applyOptions(): void {
    this.root.style.setProperty('--hpt-o', String(this.opts.opacity));
    this.root.classList.toggle('lh', this.opts.leftHanded);
    this.root.classList.toggle('big', this.opts.scale >= 1.15);
    if (this.visible) this.layout();
  }

  private measure(): void {
    this.W = this.root.clientWidth || window.innerWidth;
    this.H = this.root.clientHeight || window.innerHeight;
    const r = this.safeProbe.getBoundingClientRect();
    const rr = this.root.getBoundingClientRect();
    this.safe = { l: Math.max(0, r.left - rr.left), t: Math.max(0, r.top - rr.top), r: Math.max(0, rr.right - r.right), b: Math.max(0, rr.bottom - r.bottom) };
    this.band = this.safe.t + clamp(this.H * 0.18, 56, 120);
  }

  /** CHANGED(wf6 fixer) VO-D3: the lowest bottom edge (px from the overlay's top) of the visible top-HUD blocks, 0 = none */
  private hudBottom(): number {
    let b = 0;
    try {
      const top = this.root.getBoundingClientRect().top;
      for (const e of Array.from(document.querySelectorAll<HTMLElement>(HUD_SELECTOR))) {
        const r = e.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || r.top - top > this.H * 0.45) continue;   // hidden, or not a TOP block
        b = Math.max(b, r.bottom - top);
      }
    } catch { /* no DOM */ }
    return b;
  }

  /**
   * CHANGED(wf6 fixer) VO-D3: [disc size q, spread p] for a setting `s`: the largest q <= s (>= min(1, s)) with a spread
   * p in [q / 1.12, q] at which every unmoved button clears the top HUD, PAUSE and its neighbours
   */
  private fitPad(s: number, L: TouchLayout): [number, number] {
    const { W, H, safe } = this;
    const lh = this.opts.leftHanded;
    const topLimit = Math.max(this.band, this.hudBottom() + 6);
    const lo = Math.min(1, s);
    const px = W / 2, py = safe.t + Math.max(PAUSE_TOP, H * 0.2);
    const pts: Array<[number, number, number]> = [];
    const ok = (q: number, p: number): boolean => {
      const pr = Math.max(TOUCH.minTarget, PAUSE_D * q) / 2;
      pts.length = 0;
      for (const c of CLUSTER) {
        const o = L[c.id];
        if (o && (o.dx || o.dy)) continue;                      // a button the player placed is the player's call
        const r = Math.max(TOUCH.minTarget, c.d * q * (o?.s ?? 1)) / 2;
        const fromLeft = !!c.left !== lh;
        const cx = fromLeft ? safe.l + c.dx * p : W - safe.r - c.dx * p;
        const cy = H - safe.b - c.dy * p;
        if (cy - r < topLimit) return false;
        if (Math.hypot(cx - px, cy - py) < r + pr + 6) return false;
        for (const [x, y, rr] of pts) if (Math.hypot(cx - x, cy - y) < r + rr + 4) return false;
        pts.push([cx, cy, r]);
      }
      return true;
    };
    for (let q = s; ; q = Math.max(lo, q - 0.02)) {
      for (let p = q; p >= q / 1.12 - 1e-6; p -= 0.02) if (ok(q, p)) return [q, p];
      if (q <= lo + 1e-6) return [lo, lo];
    }
  }

  private layout(): void {
    this.measure();
    const lh = this.opts.leftHanded;
    const { W, H, safe } = this;
    const L = this.editing ? this.editLayoutDraft : (this.opts.layout ?? {});
    const [s, sp] = this.fitPad(this.opts.scale, L);
    this.fitScale = s;
    this.fitSpread = sp;
    const place = (b: Btn, cx: number, cy: number, d: number): void => {
      const r = d / 2;
      cx = clamp(cx, safe.l + r, W - safe.r - r);
      cy = clamp(cy, safe.t + r, H - safe.b - r);
      b.cx = cx; b.cy = cy;
      const e = b.el.style;
      e.width = `${d}px`; e.height = `${d}px`; e.left = `${cx - r}px`; e.top = `${cy - r}px`;
      e.fontSize = `${Math.max(11, d * 0.26)}px`;
    };
    for (const c of CLUSTER) {
      const b = this.btns.get(c.id);
      if (!b) continue;
      const o = L[c.id];
      const d = Math.max(TOUCH.minTarget, c.d * s * (o?.s ?? 1));
      const dx = (lh ? -1 : 1) * (o?.dx ?? 0);
      // CHANGED(UI3D): the STEP pair hangs off the stick's edge (left; right when left-handed), the rest off the other
      const fromLeft = !!c.left !== lh;
      const cx = (fromLeft ? safe.l + c.dx * sp : W - safe.r - c.dx * sp) + dx;
      const cy = H - safe.b - c.dy * sp + (o?.dy ?? 0);
      place(b, cx, cy, d);
    }
    const pb = this.btns.get('pause');
    if (pb) place(pb, W / 2, safe.t + Math.max(PAUSE_TOP, H * 0.2), Math.max(TOUCH.minTarget, PAUSE_D * s));
    this.baseR = (TOUCH.stickBase * sp) / 2;
    const knob = TOUCH.stickKnob * sp;
    this.knobEl.style.width = `${knob}px`;
    this.knobEl.style.height = `${knob}px`;
    const off = STICK_HOME_PAD * sp + this.baseR;
    this.homeX = lh ? W - safe.r - off : safe.l + off;
    this.homeY = H - safe.b - off;
    if (this.stickId === null) this.placeStick(this.homeX, this.homeY, 0, 0);
    this.fitLabels();
  }

  /**
   * CHANGED(UI) P2: every label fits inside its disc: the width the text may use is the chord of the disc at the label's
   * half height (minus the 3 px ring and 3 px air); a label wider than that is scaled down (never below 9 px).
   */
  private fitLabels(): void {
    for (const b of this.btns.values()) {
      const lab = b.el.firstElementChild as HTMLElement | null;
      if (!lab || !lab.textContent || b.hidden) continue;
      const d = b.d * this.fitScale * (this.layoutScale(b.id));
      const base = lab.classList.contains('long') ? Math.max(12, d * 0.3) : Math.max(11, d * 0.26);
      lab.style.fontSize = `${base.toFixed(1)}px`;
      const r = lab.getBoundingClientRect();
      if (r.width < 1) continue;
      const R = Math.max(TOUCH.minTarget, d) / 2 - 6;
      const hh = r.height / 2;
      const avail = 2 * Math.sqrt(Math.max(0, R * R - hh * hh));
      if (r.width > avail) lab.style.fontSize = `${Math.max(9, base * (avail / r.width)).toFixed(1)}px`;
    }
  }

  private layoutScale(id: TouchButtonId): number {
    const L = this.editing ? this.editLayoutDraft : (this.opts.layout ?? {});
    return L[id]?.s ?? 1;
  }

  /** read-back for mobile.py: each label's width vs the chord it may use (fit = inside) */
  labelFit(): Array<{ id: string; w: number; avail: number; fs: number; fit: boolean }> {
    const out: Array<{ id: string; w: number; avail: number; fs: number; fit: boolean }> = [];
    for (const b of this.btns.values()) {
      const lab = b.el.firstElementChild as HTMLElement | null;
      if (!lab || !lab.textContent || b.hidden) continue;
      const rl = lab.getBoundingClientRect();
      const rb = b.el.getBoundingClientRect();
      const R = rb.width / 2 - 6;
      const hh = rl.height / 2;
      const avail = 2 * Math.sqrt(Math.max(0, R * R - hh * hh));
      out.push({ id: b.id, w: Math.round(rl.width * 10) / 10, avail: Math.round(avail * 10) / 10, fs: parseFloat(lab.style.fontSize) || 0, fit: rl.width <= avail + 0.5 });
    }
    return out;
  }

  private placeStick(cx: number, cy: number, kx: number, ky: number): void {
    const d = this.baseR * 2;
    const e = this.stickEl.style;
    e.width = `${d}px`; e.height = `${d}px`; e.left = `${cx - this.baseR}px`; e.top = `${cy - this.baseR}px`;
    this.knobEl.style.transform = `translate(-50%, -50%) translate3d(${(kx * this.baseR).toFixed(1)}px, ${(ky * this.baseR).toFixed(1)}px, 0)`;
  }

  private drawnCentre(): void {
    const R = this.baseR;
    this.cx = clamp(this.ox, this.safe.l + R, Math.max(this.safe.l + R, this.W - this.safe.r - R));
    this.cy = clamp(this.oy, this.safe.t + R, Math.max(this.safe.t + R, this.H - this.safe.b - R));
  }

  // ─────────────────────────── pointers ───────────────────────────
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
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel); el.removeEventListener('lostpointercapture', cancel); el.removeEventListener('contextmenu', ctx);
    });
  }

  private stickSide(x: number): boolean { return this.opts.leftHanded ? x >= this.W * (1 - TOUCH.moveZone) : x < this.W * TOUCH.moveZone; }

  private onDown(e: PointerEvent, el: HTMLElement, btn: Btn | null): void {
    if (e.pointerType !== 'touch' || !this.visible || this.disposed) return;
    e.preventDefault();
    if (this.tracks.has(e.pointerId)) return;
    const x = e.clientX, y = e.clientY;
    const tr: Track = { kind: 'none', id: null, el, sx: x, sy: y, ox: 0, oy: 0, moved: false };
    if (this.editing) {
      if (btn && btn.id !== 'pause') {
        tr.kind = 'edit';
        tr.id = btn.id;
        const o = this.editLayoutDraft[btn.id] ?? { dx: 0, dy: 0, s: 1 };
        tr.ox = o.dx; tr.oy = o.dy;
        this.selectEdit(btn.id);
      }
    } else if (btn) {
      if (btn.hidden) return;
      tr.kind = 'btn';
      tr.id = btn.id;
      this.press(btn);
    } else if (y >= this.band && this.stickSide(x) && this.stickId === null) {
      tr.kind = 'stick';
      this.stickId = e.pointerId;
      this.ox = x; this.oy = y;
      this.drawnCentre();
      this.stickEl.classList.add('on');
      this.stick(x, y);
    }
    try { el.setPointerCapture(e.pointerId); } catch { /* gone */ }
    this.tracks.set(e.pointerId, tr);
    this.state.active = this.tracks.size;
  }

  private onMove(e: PointerEvent): void {
    const tr = this.tracks.get(e.pointerId);
    if (!tr || this.disposed) return;
    if (e.cancelable) e.preventDefault();
    if (tr.kind === 'stick') { this.stick(e.clientX, e.clientY); return; }
    if (tr.kind === 'edit' && tr.id) {
      const dx = e.clientX - tr.sx, dy = e.clientY - tr.sy;
      if (!tr.moved && Math.hypot(dx, dy) < 6) return;
      tr.moved = true;
      const cur = this.editLayoutDraft[tr.id] ?? { dx: 0, dy: 0, s: 1 };
      // stored in the right-handed frame; a left-handed layout mirrors dx at placement
      this.editLayoutDraft[tr.id] = { dx: Math.round(tr.ox + (this.opts.leftHanded ? -dx : dx)), dy: Math.round(tr.oy + dy), s: cur.s };
      this.layout();
    }
  }

  private onUp(e: PointerEvent, cancelled: boolean): void {
    const tr = this.tracks.get(e.pointerId);
    if (!tr) return;
    this.tracks.delete(e.pointerId);
    this.state.active = this.tracks.size;
    try { if (tr.el.hasPointerCapture(e.pointerId)) tr.el.releasePointerCapture(e.pointerId); } catch { /* gone */ }
    if (tr.kind === 'stick' && this.stickId === e.pointerId) {
      this.stickId = null;
      this.dir = 0;
      this.compose();
      this.stickEl.classList.remove('on');
      this.placeStick(this.homeX, this.homeY, 0, 0);
    } else if (tr.kind === 'btn' && tr.id) {
      const b = this.btns.get(tr.id);
      if (b) this.release(b);
      if (tr.id === 'pause' && !cancelled && b) {
        const r = b.el.getBoundingClientRect();
        const pad = 12;
        if (e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad) {
          for (const f of [...this.pauseFns]) { try { f(); } catch (err) { console.error('[hit-parade] touch pause', err); } }
        }
      }
    }
  }

  /** stick: 8-way bits from the thumb's offset to where it landed; drag-follow past the rim */
  private stick(x: number, y: number): void {
    const R = this.baseR;
    let dx = x - this.ox, dy = y - this.oy;
    let d = Math.hypot(dx, dy);
    if (d > R) {
      const k = (d - R) / d;
      this.ox += dx * k; this.oy += dy * k;
      dx = x - this.ox; dy = y - this.oy;
      d = R;
    }
    this.drawnCentre();
    const mag = R > 0 ? Math.min(1, d / R) : 0;
    this.dir = mag > TOUCH.deadzone ? sectorBits(dx, -dy) : 0;
    this.compose();
    this.stickEl.dataset.dir = String(this.dir);
    this.placeStick(this.cx, this.cy, R > 0 ? dx / R : 0, R > 0 ? dy / R : 0);
  }

  private press(b: Btn): void {
    b.down++;
    b.el.classList.add('down');
    this.stats.presses[b.id] = (this.stats.presses[b.id] ?? 0) + 1;
    if (b.id === 'assist') {
      // ASSIST latches for 1 s after a tap (holding a modifier while tapping L is awkward on glass)
      this.assistUntil = performance.now() + TOUCH.assistLatchMs;
      window.clearTimeout(this.assistTimer);
      this.assistTimer = window.setTimeout(() => this.compose(), TOUCH.assistLatchMs + 16);
    }
    this.state.latched |= b.bits;                   // pressed since the last tick: reaches the sim even if released first
    this.recomputeHeld();
    this.vibrate(TOUCH.hapticPress);
  }

  private release(b: Btn): void {
    b.down = Math.max(0, b.down - 1);
    if (b.down > 0) return;
    b.el.classList.remove('down');
    this.recomputeHeld();
  }

  private forceRelease(b: Btn): void { b.down = 0; b.el.classList.remove('down'); this.recomputeHeld(); }

  private recomputeHeld(): void {
    let h = 0;
    for (const x of this.btns.values()) if (x.down > 0) h |= x.bits;
    this.btnHeld = h;
    this.compose();
  }

  /** state.held = stick direction | held buttons | the ASSIST latch */
  private compose(): void {
    let h = this.dir | this.btnHeld;
    if (performance.now() < this.assistUntil) h |= BIT.ASSIST;
    this.state.held = h;
  }

  private selectEdit(id: TouchButtonId): void {
    this.editSel = id;
    for (const b of this.btns.values()) b.el.classList.toggle('sel', b.id === id);
  }

  private resizeSel(ds: number): void {
    const id = this.editSel;
    if (!id) return;
    const cur = this.editLayoutDraft[id] ?? { dx: 0, dy: 0, s: 1 };
    this.editLayoutDraft[id] = { ...cur, s: Math.round(clamp(cur.s + ds, TOUCH.editScaleMin, TOUCH.editScaleMax) * 100) / 100 };
    this.layout();
  }

  private releaseAll(): void {
    for (const [id, tr] of [...this.tracks]) { try { if (tr.el.hasPointerCapture(id)) tr.el.releasePointerCapture(id); } catch { /* gone */ } }
    this.tracks.clear();
    this.state.active = 0;
    this.stickId = null;
    this.dir = 0;
    this.btnHeld = 0;
    this.state.held = 0;
    this.state.latched = 0;
    this.assistUntil = 0;
    window.clearTimeout(this.assistTimer);
    for (const b of this.btns.values()) { b.down = 0; b.el.classList.remove('down'); }
    this.stickEl.classList.remove('on');
  }
}
