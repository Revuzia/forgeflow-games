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

interface Node { root: HTMLDivElement; g: HTMLDivElement; k: HTMLDivElement; h: HTMLDivElement; s: HTMLDivElement; busy: boolean; timer: number }
interface Queued { spec: ToastSpec; hold: number }

let sink: Toasts | null = null;

/** Push from another L8 module (ability bar: revive + the UPROAR hint) into the live toast stack. */
export function pushHudToast(t: ToastSpec, holdS?: number): void { if (sink) sink.pushFor(t, holdS); }

export class Toasts implements ToastsApi {
  private readonly layer: HTMLDivElement;
  private readonly stack: HTMLDivElement;
  private readonly nodes: Node[] = [];
  private readonly queue: Queued[] = [];
  private lastStart = -1e9;
  private pumpTimer = 0;

  constructor(root: HTMLElement) {
    this.layer = div('bt-layer bt-v2toasts', root);
    this.stack = div('bt-tst', this.layer);
    for (let i = 0; i < MAX_ON; i++) {
      const r = div('bt-toast off', this.stack);
      const g = div('bt-toast-g', r);
      const t = div('bt-toast-t', r);
      const k = div('bt-toast-k', t);
      const h = div('bt-toast-h', t);
      const s = div('bt-toast-s', t);
      this.nodes.push({ root: r, g, k, h, s, busy: false, timer: 0 });
    }
    sink = this;
  }

  push(t: ToastSpec): void { this.pushFor(t); }

  pushFor(t: ToastSpec, holdS?: number): void {
    const hold = holdS ?? (/^RESTRUCTURED/.test(t.kicker) ? EVO_HOLD_S : HOLD_S);
    if (this.queue.length >= MAX_QUEUE) this.queue.shift();
    this.queue.push({ spec: t, hold });
    this.pump();
  }

  clear(): void {
    this.queue.length = 0;
    if (this.pumpTimer) { clearTimeout(this.pumpTimer); this.pumpTimer = 0; }
    for (const n of this.nodes) {
      if (n.timer) { clearTimeout(n.timer); n.timer = 0; }
      n.busy = false;
      n.root.className = 'bt-toast off';
      delete n.root.dataset.v2;
    }
    this.lastStart = -1e9;
  }

  private pump(): void {
    if (this.pumpTimer || !this.queue.length) return;
    const now = performance.now();
    const wait = this.lastStart + GAP_S * 1000 - now;
    const free = this.nodes.find((n) => !n.busy);
    if (wait > 0 || !free) {
      this.pumpTimer = window.setTimeout(() => { this.pumpTimer = 0; this.pump(); }, Math.max(50, wait > 0 ? wait : 200));
      return;
    }
    const q = this.queue.shift() as Queued;
    this.lastStart = now;
    this.show(free, q);
    if (this.queue.length) this.pump();
  }

  private show(n: Node, q: Queued): void {
    const t = q.spec;
    n.busy = true;
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
    requestAnimationFrame(() => requestAnimationFrame(() => { if (n.busy && n.root.dataset.v2) n.root.className = 'bt-toast'; }));
    n.timer = window.setTimeout(() => {
      n.root.className = 'bt-toast out';
      n.timer = window.setTimeout(() => {
        n.timer = 0;
        n.busy = false;
        n.root.className = 'bt-toast off';
        delete n.root.dataset.v2;
        this.pump();
      }, EXIT_MS);
    }, q.hold * 1000);
  }
}
