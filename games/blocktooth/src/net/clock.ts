// BLOCKTOOTH - net/clock.ts (lane B-NET). The lockstep pump clock.
//
// The authority's clock must keep ticking when its tab is hidden: rAF stops and main-thread timers drop to ~1 Hz in a
// background tab (LAST CIRCLE notes, netcode.md 7.1). A dedicated Worker's timers are not throttled that way, so the
// clock is a tiny inline Worker (Blob URL: no extra file for Vite to bundle) posting a message at `hz`; the session
// pumps the lockstep peer on every message. LockstepPeer measures real elapsed time itself (performance.now
// accumulators), so the post rate only sets the granularity: 60 Hz = half-tick resolution. Falls back to setInterval
// where Workers or Blob URLs are unavailable (CSP); `kind` says which one runs.

const WORKER_SRC = 'let iv=null;onmessage=(e)=>{const d=e.data||{};if(iv){clearInterval(iv);iv=null;}if(d.ms>0)iv=setInterval(()=>postMessage(0),d.ms);};';

export class PumpClock {
  readonly hz: number;
  kind: 'worker' | 'interval' | 'stopped' = 'stopped';
  ticks = 0;
  private worker: Worker | null = null;
  private url: string | null = null;
  private iv: ReturnType<typeof setInterval> | null = null;

  constructor(hz = 60) { this.hz = hz; }

  start(cb: () => void): void {
    this.stop();
    const ms = Math.max(4, Math.round(1000 / this.hz));
    const run = (): void => { this.ticks++; try { cb(); } catch (e) { console.warn('[clock] pump', e); } };
    try {
      if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
        this.url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
        const w = new Worker(this.url);
        w.onmessage = run;
        w.onerror = () => { this.fallback(ms, run); };
        w.postMessage({ ms });
        this.worker = w;
        this.kind = 'worker';
        return;
      }
    } catch { /* CSP or no Worker: fall through */ }
    this.fallback(ms, run);
  }

  private fallback(ms: number, run: () => void): void {
    this.killWorker();
    if (this.iv) clearInterval(this.iv);
    this.iv = setInterval(run, ms);
    this.kind = 'interval';
  }

  private killWorker(): void {
    if (this.worker) { try { this.worker.postMessage({ ms: 0 }); this.worker.terminate(); } catch { /* gone */ } this.worker = null; }
    if (this.url) { try { URL.revokeObjectURL(this.url); } catch { /* gone */ } this.url = null; }
  }

  stop(): void {
    this.killWorker();
    if (this.iv) { clearInterval(this.iv); this.iv = null; }
    this.kind = 'stopped';
  }
}

export function nowMs(): number { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
