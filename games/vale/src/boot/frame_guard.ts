// VALE boot — what the frame loop does when a frame throws (W1-E, TECH-09). Pure counting, no DOM, so
// _harness/probe_frame_guard.ts runs it under node. The UI's loop (ui/app.tsx startFrameLoop) hands every pump and
// every draw to a FrameGuard:
//   * a match whose pump throws on 30 consecutive frames is over: onPumpDead(match) fires once (the app ends it as
//     interrupted: no rating change, profile saved, Home, a toast) and the dead match is never pumped again;
//   * a renderer whose draw throws on 30 consecutive frames fires onRenderDead(1) once (the app shows the lost
//     plate and re-runs the renderer's setup), and if the next 30 frames fail too onRenderDead(2) (plate stays, the
//     console is quiet); a draw that works again fires onRenderOk (the plate goes).
// Errors are logged on the first failure and then every 10th, never 60 lines a second.
//
// DEV FAULT INJECTION (a dev build with ?dev=1 only): ?fault=pump:<match seconds> throws in the pump from that match
// time on; ?fault=render:<seconds since boot> throws in the draw from then on. e.g. &fault=pump:20.

export const FAIL_LIMIT = 30;

export interface Fault { pump?: number; render?: number }
export function parseFault(search: string, dev: boolean): Fault {
  const out: Fault = {};
  if (!dev) return out;
  const v = new URLSearchParams(search).get('fault');
  if (!v) return out;
  for (const part of v.split(',')) {
    const [k, n] = part.split(':');
    const t = Number(n);
    if ((k === 'pump' || k === 'render') && Number.isFinite(t) && t >= 0) out[k] = t;
  }
  return out;
}

export interface GuardOptions<M> {
  fault?: Fault;
  limit?: number;
  onPumpDead(match: M, err: unknown): void;
  onRenderDead(attempt: 1 | 2, err: unknown): void;
  onRenderOk(): void;
  log?(msg: string, err: unknown): void;
}

export class FrameGuard<M> {
  private match: M | null = null;
  private pumpFails = 0;
  private pumpDead = false;
  private renderFails = 0;
  private renderStage: 0 | 1 | 2 = 0;      // 0 ok · 1 plate shown, setup retried · 2 still failing after the retry
  private readonly limit: number;
  private readonly fault: Fault;
  private bootAt: number | null = null;

  private readonly o: GuardOptions<M>;
  constructor(o: GuardOptions<M>) { this.o = o; this.limit = o.limit ?? FAIL_LIMIT; this.fault = o.fault ?? {}; }

  private say(msg: string, n: number, err: unknown): void { if (n === 1 || n % 10 === 0) (this.o.log ?? ((m, e) => console.error(m, e)))(msg, err); }

  /** run one pump of `match` (matchTime = its sim seconds, for the dev fault) */
  pump(match: M, matchTime: number, fn: () => void): void {
    if (match !== this.match) { this.match = match; this.pumpFails = 0; this.pumpDead = false; }
    if (this.pumpDead) return;
    try {
      if (this.fault.pump !== undefined && matchTime >= this.fault.pump) throw new Error(`injected pump fault at ${matchTime.toFixed(1)} s`);
      fn();
      this.pumpFails = 0;
    } catch (err) {
      this.pumpFails++;
      this.say(`[vale] match pump (${this.pumpFails}/${this.limit})`, this.pumpFails, err);
      if (this.pumpFails >= this.limit) { this.pumpDead = true; this.o.onPumpDead(match, err); }
    }
  }

  /** run one draw; `nowMs` = a clock for the dev fault */
  draw(nowMs: number, fn: () => void): void {
    this.bootAt ??= nowMs;
    try {
      if (this.fault.render !== undefined && nowMs - this.bootAt >= this.fault.render * 1000) throw new Error('injected render fault');
      fn();
      this.renderFails = 0;
      if (this.renderStage !== 0) { this.renderStage = 0; this.o.onRenderOk(); }
    } catch (err) {
      this.renderFails++;
      if (this.renderStage < 2) this.say(`[vale] render (${this.renderFails}/${this.limit})`, this.renderFails, err);
      if (this.renderFails >= this.limit && this.renderStage < 2) {
        this.renderFails = 0;
        this.renderStage = (this.renderStage + 1) as 1 | 2;
        this.o.onRenderDead(this.renderStage, err);
      }
    }
  }

  get pumpIsDead(): boolean { return this.pumpDead; }
  get renderState(): 0 | 1 | 2 { return this.renderStage; }
}
