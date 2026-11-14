// BLOCKTOOTH v2 — the v2 toast stack (GOAL MET, RESTRUCTURED, revive, the one-time UPROAR hint) below the
// broadcast toast slot (FEATURES_V2 §4.1, §8.4). Lane L8. UI.
//
// Placement: left 1.6u, in its own layer (z 55: above the tabloid, below settings), starting BELOW the
// broadcast `.bt-alert` slots so it never touches them. Measured in Chrome (2026-09-25, scratch
// _harness/scratch/l8/measure_alerts.py, every ALERTS entry cloned into the live alert box): the tallest
// broadcast toast (`.bt-alert.toast`, top 5.40u) ends at 10.25u at both 1280×720 and 1920×1080 (the
// layout is all in u), and the urgent strap (`.bt-alert.urgent`: boss / elite / phase, left-anchored)
// spans 12.40u–16.90u. So the stack starts at 17.4u (hud_v2.css `--tst-top`), not at 12.4u, which
// would sit inside the urgent strap.
//
// Timing (§8.4): each toast holds 4.5 s (RESTRUCTURED 2 s, revive 3.5 s), new toasts START ≥ 3 s apart
// (queued), ≤ 2 on screen. Nodes are pooled (2), text written once per toast, enter/exit by transform +
// opacity transitions. Test hook (§13.3): [data-v2="toast"] on visible toasts.
//
// Modal gate (F4 critic fix): the toasts are play-screen furniture. While any full screen is up (a
// `.bt-screen` layer without `bt-hidden`: draft, pause, settings, tabloid, goals, slate, title, select,
// the cinematic) the layer is hidden, the hold timers of visible toasts are PAUSED (resumed with at
// least 1.5 s left) and the queue does not advance; so a GOAL MET / RESTRUCTURED toast never draws over
// a screen and none is lost. The check is a class-only DOM query on a 150 ms poll that only runs while
// something is queued or on screen.
//
// Keyed toasts: pushFor(t, hold, {key, front, alive}) — `front` jumps the queue and the 3 s gap (the
// one-time UPROAR hint must arrive WHILE the meter is ready, not after the player already fired);
// `alive()` is re-checked before showing and on every poll while shown (false → dropped / slides out at
// once); dismissHudToast(key) drops it explicitly.

import './hud_v2.css';
import type { ToastSpec, ToastsApi } from '../v2types.ts';
import { div } from './dom.ts';
import { glyphSvg } from './icons.ts';

const HOLD_S = 4.5;
const EVO_HOLD_S = 2;
const GAP_S = 3;
const MAX_ON = 2;
const MAX_QUEUE = 8;
const EXIT_MS = 260;
const POLL_MS = 150;
const RESUME_MIN_MS = 1500;
const AFTER_MODAL_MS = 350;       // a beat after a screen closes before a held toast slides in

export interface ToastOpts {
  /** identifies the toast for dismissHudToast (and replaces a queued one with the same key) */
  key?: string;
  /** jump the queue and the 3 s start gap (a visible toast is pushed out if both nodes are busy) */
  front?: boolean;
  /** still relevant? checked before showing and while shown; false → dropped / exits now */
  alive?: () => boolean;
}

interface Node {
  root: HTMLDivElement; g: HTMLDivElement; k: HTMLDivElement; h: HTMLDivElement; s: HTMLDivElement;
  busy: boolean; exiting: boolean; timer: number; endAt: number; remain: number;
  key: string; alive: (() => boolean) | null;
}
interface Queued { spec: ToastSpec; hold: number; key: string; alive: (() => boolean) | null; front: boolean }

let sink: Toasts | null = null;

/** Push from another L8 module (ability bar: revive + the UPROAR hint) into the live toast stack. */
export function pushHudToast(t: ToastSpec, holdS?: number, opts?: ToastOpts): void { if (sink) sink.pushFor(t, holdS, opts); }
/** Drop a keyed toast: removed from the queue, or slid out now if on screen. */
export function dismissHudToast(key: string): void { if (sink) sink.dismiss(key); }

/** Is a full screen (modal) up? Any `.bt-screen` layer without `bt-hidden` under `root`. */
export function modalOpen(root: ParentNode): boolean { return !!root.querySelector('.bt-screen:not(.bt-hidden)'); }

export class Toasts implements ToastsApi {
  private readonly root: HTMLElement;
  private readonly layer: HTMLDivElement;
  private readonly stack: HTMLDivElement;
  private readonly nodes: Node[] = [];
  private readonly queue: Queued[] = [];
  private lastStart = -1e9;
  private pumpTimer = 0;
  private pollTimer = 0;
  private held = false;           // a modal is up: layer hidden, timers paused
  private heldUntil = 0;          // performance.now() before which nothing new starts (after a modal)

  constructor(root: HTMLElement) {
    this.root = root;
    this.layer = div('bt-layer bt-v2toasts', root);
    this.stack = div('bt-tst', this.layer);
    for (let i = 0; i < MAX_ON; i++) {
      const r = div('bt-toast off', this.stack);
      const g = div('bt-toast-g', r);
      const t = div('bt-toast-t', r);
      const k = div('bt-toast-k', t);
      const h = div('bt-toast-h', t);
      const s = div('bt-toast-s', t);
      this.nodes.push({ root: r, g, k, h, s, busy: false, exiting: false, timer: 0, endAt: 0, remain: 0, key: '', alive: null });
    }
    sink = this;
  }

  push(t: ToastSpec): void { this.pushFor(t); }

  pushFor(t: ToastSpec, holdS?: number, opts?: ToastOpts): void {
    const hold = holdS ?? (/^RESTRUCTURED/.test(t.kicker) ? EVO_HOLD_S : HOLD_S);
    const key = opts?.key ?? '';
    if (key) for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i].key === key) this.queue.splice(i, 1);
    const q: Queued = { spec: t, hold, key, alive: opts?.alive ?? null, front: !!opts?.front };
    if (opts?.front) {
      this.queue.unshift(q);
      this.startNow();
    } else {
      if (this.queue.length >= MAX_QUEUE) this.queue.shift();
      this.queue.push(q);
      this.pump();
    }
    this.ensurePoll();
  }

  dismiss(key: string): void {
    if (!key) return;
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i].key === key) this.queue.splice(i, 1);
    for (const n of this.nodes) if (n.busy && !n.exiting && n.key === key) this.exit(n);
  }

  clear(): void {
    this.queue.length = 0;
    if (this.pumpTimer) { clearTimeout(this.pumpTimer); this.pumpTimer = 0; }
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = 0; }
    for (const n of this.nodes) {
      if (n.timer) { clearTimeout(n.timer); n.timer = 0; }
      n.busy = false; n.exiting = false; n.key = ''; n.alive = null;
      n.root.className = 'bt-toast off';
      delete n.root.dataset.v2;
    }
    this.lastStart = -1e9;
    this.held = false;
    this.heldUntil = 0;
    this.layer.classList.remove('bt-hidden');
  }

  // ─────────────────────────────── internals ───────────────────────────────

  /** a `front` toast: bypass the gap; free a node if both are busy */
  private startNow(): void {
    if (this.pumpTimer) { clearTimeout(this.pumpTimer); this.pumpTimer = 0; }
    if (this.held || performance.now() < this.heldUntil) { this.pump(); return; }
    const free = this.nodes.find((n) => !n.busy);
    if (!free) {
      // push the visible toast closest to its end out at once (its node frees after the exit slide)
      let victim: Node | null = null;
      for (const n of this.nodes) if (n.busy && !n.exiting && (!victim || n.endAt < victim.endAt)) victim = n;
      if (victim) this.exit(victim);
      this.pump();
      return;
    }
    const q = this.nextValid();
    if (!q) return;
    this.lastStart = performance.now();
    this.show(free, q);
    if (this.queue.length) this.pump();
  }

  private nextValid(): Queued | null {
    while (this.queue.length) {
      const q = this.queue.shift() as Queued;
      if (!q.alive || safeAlive(q.alive)) return q;
    }
    return null;
  }

  private pump(): void {
    if (this.pumpTimer || !this.queue.length) return;
    const now = performance.now();
    if (this.held) return;                        // resumed by the poll when the screen closes
    // a `front` toast keeps its no-gap privilege while it waits for a node
    const gapWait = this.queue[0].front ? 0 : this.lastStart + GAP_S * 1000 - now;
    const wait = Math.max(this.heldUntil - now, gapWait);
    const free = this.nodes.find((n) => !n.busy);
    if (wait > 0 || !free) {
      this.pumpTimer = window.setTimeout(() => { this.pumpTimer = 0; this.pump(); }, Math.max(50, wait > 0 ? wait : 200));
      return;
    }
    const q = this.nextValid();
    if (!q) return;
    this.lastStart = now;
    this.show(free, q);
    if (this.queue.length) this.pump();
  }

  private show(n: Node, q: Queued): void {
    const t = q.spec;
    n.busy = true; n.exiting = false; n.key = q.key; n.alive = q.alive;
    n.g.innerHTML = glyphSvg(t.glyph, t.glyph === 'evo' ? '#ffd166' : t.glyph === 'ribbon' ? '#ff6f5e' : '#4fb3b0');
    n.k.textContent = t.kicker;
    // game.ts sends RESTRUCTURED as kicker + 'RESTRUCTURED: NAME' title: the kicker already says it
    n.h.textContent = t.title.startsWith(t.kicker + ': ') ? t.title.slice(t.kicker.length + 2) : t.title;
    n.s.textContent = t.sub;
    n.root.dataset.tone = t.glyph === 'evo' ? 'evo' : t.glyph === 'megaphone' ? 'gold' : '';
    // newest at the bottom of the stack: move this node last
    this.stack.appendChild(n.root);
    n.root.className = 'bt-toast out';
    n.root.dataset.v2 = 'toast';
    // two frames later: slide in (the 'out' pose must be styled once for the transition to run)
    requestAnimationFrame(() => requestAnimationFrame(() => { if (n.busy && !n.exiting && n.root.dataset.v2) n.root.className = 'bt-toast'; }));
    this.arm(n, q.hold * 1000);
    this.ensurePoll();
  }

  private arm(n: Node, ms: number): void {
    if (n.timer) clearTimeout(n.timer);
    n.endAt = performance.now() + ms;
    n.timer = window.setTimeout(() => { n.timer = 0; this.exit(n); }, ms);
  }

  private exit(n: Node): void {
    if (!n.busy || n.exiting) return;
    if (n.timer) { clearTimeout(n.timer); n.timer = 0; }
    n.exiting = true;
    n.root.className = 'bt-toast out';
    n.timer = window.setTimeout(() => this.release(n), EXIT_MS);
  }

  private release(n: Node): void {
    if (n.timer) { clearTimeout(n.timer); n.timer = 0; }
    n.busy = false; n.exiting = false; n.key = ''; n.alive = null;
    n.root.className = 'bt-toast off';
    delete n.root.dataset.v2;
    this.pump();
  }

  private ensurePoll(): void {
    if (this.pollTimer) return;
    this.pollTimer = window.setInterval(() => this.poll(), POLL_MS);
    this.poll();
  }

  /** modal gate + alive() checks; stops itself when nothing is queued or on screen */
  private poll(): void {
    const modal = modalOpen(this.root);
    if (modal && !this.held) {
      this.held = true;
      this.layer.classList.add('bt-hidden');
      if (this.pumpTimer) { clearTimeout(this.pumpTimer); this.pumpTimer = 0; }
      const now = performance.now();
      for (const n of this.nodes) {
        if (!n.busy) continue;
        if (n.exiting) { this.release(n); continue; }
        n.remain = Math.max(RESUME_MIN_MS, n.endAt - now);
        if (n.timer) { clearTimeout(n.timer); n.timer = 0; }
      }
    } else if (!modal && this.held) {
      this.held = false;
      this.layer.classList.remove('bt-hidden');
      this.heldUntil = performance.now() + AFTER_MODAL_MS;
      for (const n of this.nodes) if (n.busy && !n.exiting && !n.timer) this.arm(n, n.remain + AFTER_MODAL_MS);
      this.pump();
    }
    if (!this.held) {
      for (const n of this.nodes) if (n.busy && !n.exiting && n.alive && !safeAlive(n.alive)) this.exit(n);
    }
    const idle = !this.queue.length && this.nodes.every((n) => !n.busy);
    if (idle && this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = 0; }
  }
}

function safeAlive(f: () => boolean): boolean {
  try { return !!f(); } catch { return false; }
}
