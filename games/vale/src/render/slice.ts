// VALE render — main-thread time slicing (W4-C fix round, ruling 67): the loading screen and the first frames of a
// match never hold the main thread in one long task. Heavy CPU work (the procedural terrain, the fighters' LODs and
// hulls, the scatter, the templates' warm-up) is cut into steps and the page gets a turn between them, so the loading
// bar moves, input is answered and the browser can draw (the owner's tester: "the game froze their computer").
//
//   nextTask()                 a promise resolved in a NEW task (MessageChannel: no 4 ms setTimeout clamp, runs while
//                              the tab is hidden too); `await nextTask()` between two heavy steps ends the task
//   runSliced(gen, budgetMs)   drives a generator, a step at a time, and yields to the page whenever the steps run so
//                              far in this task have taken budgetMs; resolves to the generator's return value. The
//                              longest single step is kept (sliceStats) so the device report can show it
//   later(job)                 queue a job of the shared low-priority queue (one job per turn, budgetMs per turn)

type Waiter = () => void;
const waiting: Waiter[] = [];
let port: MessagePort | null = null;
try {
  const ch = new MessageChannel();
  ch.port1.onmessage = (): void => { waiting.shift()?.(); };
  port = ch.port2;
} catch { port = null; }
const post = (res: Waiter): void => { if (port) { waiting.push(res); port.postMessage(0); } else setTimeout(res, 0); };

// A run of short tasks back to back can still keep the page from drawing (Chrome draws between tasks when it gets
// round to it): when the page has not drawn for FRAME_GAP_MS, a waiter is let go only after the next frame (or after
// HIDDEN_MS when no frame comes: a hidden tab draws nothing)
const FRAME_GAP_MS = 40, HIDDEN_MS = 50;
let lastFrame = typeof performance !== 'undefined' ? performance.now() : 0;
const afterFrame: Waiter[] = [];
let watching = false;
function watch(): void {
  if (watching || typeof requestAnimationFrame !== 'function') return;
  watching = true;
  const release = (): void => { for (const w of afterFrame.splice(0)) post(w); };
  const timer = setTimeout(() => { watching = false; lastFrame = performance.now(); release(); }, HIDDEN_MS);
  requestAnimationFrame(() => {
    clearTimeout(timer);
    lastFrame = performance.now();
    watching = false;
    release();
  });
}

/** a promise resolved in a new task, after a frame when the page has not drawn for a while */
export function nextTask(): Promise<void> {
  return new Promise((res) => {
    if (typeof requestAnimationFrame === 'function' && performance.now() - lastFrame > FRAME_GAP_MS) { afterFrame.push(res); watch(); return; }
    post(res);
  });
}
// the game's own frames count as frames drawn
export function frameDrawn(): void { lastFrame = performance.now(); }

/** the longest single step any sliced job ran (ms), and which */
export const sliceStats = { worstStepMs: 0, worstStep: '', steps: 0 };

/** a step's label: the generator yields a string naming what it just finished (or nothing) */
export async function runSliced<T>(gen: Generator<string | void, T, void>, budgetMs = 24, alive: () => boolean = () => true): Promise<T | null> {
  let t0 = performance.now();
  let last = t0;
  for (;;) {
    const r = gen.next();
    const now = performance.now();
    const step = now - last;
    sliceStats.steps++;
    if (step > sliceStats.worstStepMs) { sliceStats.worstStepMs = step; sliceStats.worstStep = typeof r.value === 'string' ? r.value : '?'; }
    if (r.done) return r.value;
    last = now;
    if (now - t0 >= budgetMs) {
      await nextTask();
      if (!alive()) { gen.return(undefined as unknown as T); return null; }
      t0 = last = performance.now();
    }
  }
}

/** run a generator to its end in this task (the synchronous path: tools, probes, a scene that must exist now) */
export function runNow<T>(gen: Generator<string | void, T, void>): T {
  for (;;) { const r = gen.next(); if (r.done) return r.value; }
}

const jobs: (() => boolean | void)[] = [];
let pumping = false;
/** queue a job (true = call me again next turn); jobs run one turn at a time, budgetMs a turn, in order */
export function later(job: () => boolean | void, budgetMs = 12): void {
  jobs.push(job);
  if (pumping) return;
  pumping = true;
  void (async () => {
    while (jobs.length) {
      await nextTask();
      const t0 = performance.now();
      while (jobs.length && performance.now() - t0 < budgetMs) {
        const j = jobs[0];
        let again = false;
        try { again = j() === true; } catch (e) { console.warn('[vale] sliced job', e); }
        if (!again) jobs.shift();
      }
    }
    pumping = false;
  })();
}
