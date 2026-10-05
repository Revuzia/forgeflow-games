// BLOCKTOOTH ONLINE VS — one view instance per seat (lane B-VIEW).
//
// Some views are written against the World CURSOR (w.titan / w.ult / w.meta alias the BOUND player, core/players.ts) and
// keep single-titan state (UltView: one roar at a time). In VS every seat can roar at once, so each seat gets its own
// instance: for every seat the cursor is bound to it and the instance sees only that seat's events (ev.p === slot); the
// cursor is left on the view seat afterwards. Solo: exactly one instance, the frame passes through untouched
// (byte-identical to mounting the view directly).

import type { SimEvent, World } from '../core/types.ts';
import { bindPlayer } from '../core/players.ts';
import type { FrameInfo, ViewCtx, ViewModule } from './viewtypes.ts';

export class PerSeat implements ViewModule {
  private readonly ctx: ViewCtx;
  private readonly make: (ctx: ViewCtx) => ViewModule;
  private readonly inst: ViewModule[] = [];
  private n = 1;
  private readonly fi: FrameInfo = { alpha: 1, dt: 0, time: 0, events: [], camDist: 1, frozen: false };
  private readonly evBuf: SimEvent[] = [];

  constructor(ctx: ViewCtx, make: (ctx: ViewCtx) => ViewModule) {
    this.ctx = ctx;
    this.make = make;
    this.inst.push(make(ctx));
  }

  private at(i: number): ViewModule {
    let v = this.inst[i];
    if (!v) { v = this.make(this.ctx); this.inst[i] = v; }
    return v;
  }

  mount(w: World): void | Promise<void> {
    this.n = Math.max(1, w.players.length);
    if (w.mode !== 'vs') return this.inst[0].mount(w);
    const pending: Promise<void>[] = [];
    for (let i = 0; i < this.n; i++) {
      bindPlayer(w, i);
      const r = this.at(i).mount(w);
      if (r) pending.push(r);
    }
    bindPlayer(w, w.view);
    if (pending.length) return Promise.all(pending).then(() => undefined);
  }

  update(w: World, f: FrameInfo): void {
    if (w.mode !== 'vs') { this.inst[0].update(w, f); return; }
    const g = this.fi;
    g.alpha = f.alpha; g.dt = f.dt; g.time = f.time; g.camDist = f.camDist; g.frozen = f.frozen;
    const ev = f.events, buf = this.evBuf;
    for (let i = 0; i < this.n; i++) {
      buf.length = 0;
      for (let k = 0; k < ev.length; k++) if (ev[k].p === i) buf.push(ev[k]);
      g.events = buf;
      bindPlayer(w, i);
      this.inst[i].update(w, g);
    }
    bindPlayer(w, w.view);
  }

  unmount(): void {
    for (const v of this.inst) v.unmount();
  }

  resumeAfterEnd(): void {
    for (const v of this.inst) if (v.resumeAfterEnd) v.resumeAfterEnd();
  }
}
