// GENESIS — miracle gestures (CONTRACT.md §16.5; hold G or the middle mouse button, or the gamepad's LT): draw a shape
// with the hand and the miracle it names is cast where it was drawn, as large as it was drawn. A glowing trail follows
// the stroke; while drawing, a card shows the shapes the powers know (powers.json `gesture`: spiral = water, zigzag =
// lightning, double zigzag = storm, circle = shield, triangle = fire, V = heal, wave = forest, square = food, star =
// meteor, heart = fertility, caret = teach, line = wood, tilde = calm, arrow = fireball). Recognition is the
// $1-style recogniser in unistroke.ts, limited to the shapes some power uses.

import type { GroundHit, UiHost } from './host.ts';
import type { Power } from './powers.ts';
import { Unistroke, shapePolyline, type Pt } from './unistroke.ts';
import { h, clear } from './dom.ts';
import { icon } from './icons.ts';

export interface GestureDeps {
  host: UiHost;
  /** cast a power at a ground point with a radius in metres (null: its default) */
  cast(p: Power, hit: GroundHit | null, radius: number | null): void;
}

const MIN_SCORE = 0.7;

export class Gestures {
  readonly canvas: HTMLCanvasElement;
  readonly card: HTMLDivElement;
  private ctx: CanvasRenderingContext2D;
  private deps: GestureDeps;
  private rec = new Unistroke();
  private pts: { x: number; y: number; t: number }[] = [];
  private fading: { pts: { x: number; y: number }[]; until: number; label: string; ok: boolean } | null = null;
  active = false;
  private cardVersion = -1;
  /** the last recognition (test surface) */
  last: { name: string; score: number; power: string | null } | null = null;

  constructor(parent: HTMLElement, canvasLayer: HTMLElement, deps: GestureDeps) {
    this.deps = deps;
    this.canvas = h('canvas', { class: 'gn-gesture-canvas' }) as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.card = h('div', { class: 'gn-panel gn-gest-card' });
    this.card.hidden = true;
    canvasLayer.append(this.canvas);
    parent.append(this.card);
  }

  begin(x?: number, y?: number): void {
    if (!this.active) this.deps.host.sound('gesture.start');
    this.active = true;
    this.armed = false;
    this.pts = [];
    this.fading = null;
    if (x !== undefined && y !== undefined) this.point(x, y);
    this.renderCard();
    this.card.hidden = false;
    this.resize();
  }

  point(x: number, y: number): void {
    if (!this.active) return;
    const l = this.pts[this.pts.length - 1];
    if (l && Math.hypot(x - l.x, y - l.y) < 2) return;
    this.pts.push({ x, y, t: performance.now() });
  }

  /** armed from the dock / the palette / the menu: the card shows and the next left drag on the world draws */
  armed = false;
  arm(on: boolean): void {
    this.armed = on;
    if (on) this.renderCard();
    this.card.hidden = !on;
  }

  cancel(): void {
    this.active = false;
    this.armed = false;
    this.pts = [];
    this.card.hidden = true;
  }

  /** the stroke ended: recognise and cast */
  end(): void {
    if (!this.active) return;
    this.active = false;
    this.card.hidden = true;
    const pts = this.pts;
    this.pts = [];
    if (pts.length < 6) return;
    const powers = this.deps.host.powers.gestures();
    const allowed = new Set([...powers.keys()].filter((g) => this.rec.names().includes(g)));
    const r = this.rec.recognize(pts.map((p) => [p.x, p.y] as Pt), allowed);
    const trail = pts.map((p) => ({ x: p.x, y: p.y }));
    if (!r || r.score < MIN_SCORE) {
      const near = r ? `${r.name}${powers.get(r.name) ? ` (${powers.get(r.name)!.name})` : ''}` : '';
      this.fading = { pts: trail, until: performance.now() + 1400, label: near ? `Not quite — nearest: ${near}` : 'Not a shape I know', ok: false };
      this.last = r ? { name: r.name, score: r.score, power: null } : null;
      this.deps.host.sound('gesture.fail');
      return;
    }
    const p = powers.get(r.name)!;
    this.last = { name: r.name, score: r.score, power: p.id };
    this.fading = { pts: trail, until: performance.now() + 1500, label: `${p.name}`, ok: true };
    this.deps.host.sound('gesture.ok');
    // where and how big: the stroke's middle and half its span, on the ground
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const host = this.deps.host;
    const hit = host.groundAt(cx, cy) ?? host.cursorGround() ?? host.focusGround();
    let radius: number | null = null;
    if (hit) {
      const edge = host.groundAt(cx + Math.max(x1 - x0, y1 - y0) / 2, cy);
      const pv = host.view.planet(hit.planet);
      if (edge && pv && edge.planet === hit.planet) radius = Math.acos(Math.min(1, hit.dir[0] * edge.dir[0] + hit.dir[1] * edge.dir[1] + hit.dir[2] * edge.dir[2])) * pv.params.radius;
    }
    this.deps.cast(p, hit, radius);
  }

  /** recognise points without drawing (test surface): the shape and the power it casts */
  recognize(points: Pt[]): { name: string; score: number; power: string | null } | null {
    const powers = this.deps.host.powers.gestures();
    const r = this.rec.recognize(points, new Set(powers.keys()));
    return r ? { name: r.name, score: r.score, power: r.score >= MIN_SCORE ? powers.get(r.name)?.id ?? null : null } : null;
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(window.innerWidth * dpr), hh = Math.round(window.innerHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== hh) { this.canvas.width = w; this.canvas.height = hh; }
  }

  /** draw the trail (call every frame) */
  frame(): void {
    const ctx = this.ctx;
    const now = performance.now();
    const drawing = this.active && this.pts.length > 1;
    const fade = this.fading && now < this.fading.until ? this.fading : null;
    if (!drawing && !fade) {
      if (this.canvas.style.opacity !== '0') { ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); this.canvas.style.opacity = '0'; }
      if (this.fading && now >= this.fading.until) this.fading = null;
      return;
    }
    this.resize();
    this.canvas.style.opacity = '1';
    const dpr = this.canvas.width / Math.max(1, window.innerWidth);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const pts = drawing ? this.pts : fade!.pts;
    const a = fade ? Math.max(0, (fade.until - now) / 1500) : 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const col = fade && !fade.ok ? '240,164,107' : '243,223,174';
    // a soft glow under a bright core; the newest part brightest while drawing
    for (const [w, al] of [[14, 0.12], [7, 0.28], [2.6, 0.95]] as const) {
      ctx.strokeStyle = `rgba(${col},${al * a})`;
      ctx.lineWidth = w;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
    if (drawing) {
      const p = pts[pts.length - 1];
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 16);
      g.addColorStop(0, 'rgba(255,246,220,0.9)');
      g.addColorStop(1, 'rgba(243,223,174,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, 16, 0, Math.PI * 2); ctx.fill();
    }
    if (fade) {
      let x = 0, y = 0;
      for (const p of pts) { x += p.x; y += p.y; }
      x /= pts.length; y /= pts.length;
      ctx.font = '600 22px "GN Digits", "Cormorant Garamond", Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(${col},${Math.min(1, a * 1.4)})`;
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 8;
      ctx.fillText(fade.label, x, y);
      ctx.shadowBlur = 0;
    }
  }

  /** the card of shapes and the miracles they cast */
  private renderCard(): void {
    const book = this.deps.host.powers;
    if (this.cardVersion === book.version && this.card.childElementCount) return;
    this.cardVersion = book.version;
    clear(this.card);
    this.card.append(h('div', { class: 'gn-gest-h' }, h('span', { html: icon('gesture') }), h('span', { text: 'Draw a shape' })));
    const grid = h('div', { class: 'gn-gest-grid' });
    for (const [shape, p] of book.gestures()) {
      const poly = shapePolyline(shape, 30, 3);
      grid.append(h('div', { class: 'gn-gest-item', title: p.desc },
        h('span', { class: 'gn-gest-shape', html: poly ? `<svg viewBox="0 0 30 30"><polyline points="${poly}"/></svg>` : '' }),
        h('span', { class: 'gn-gest-name', text: p.name }),
        h('span', { class: 'gn-gest-sh', text: shape.replace('-', ' ') })));
    }
    this.card.append(grid);
  }
}
