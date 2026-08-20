// core/render/dynres.js [A6] — dynamic resolution 1.0→1.5 under frame-time
// control (ARCH §3.13, verbatim thresholds):
//   p95 of the last 120 frames > 20 ms  → step DPR DOWN 0.1 (floor 1.0)
//   < 13 ms for 300 consecutive frames  → step UP 0.1
//                                          (ceiling = min(1.5, device DPR))
// DPR never exceeds 1.5 (doctrine §3 / gfx.DPR_CAP). At the floor the planar
// reflection auto-offs (reflect.js reads globalThis.__BR_DYNRES__ — this
// signature has no ctx, so the seam is a documented global). post.js
// auto-tracks the drawing buffer, so a DPR step needs no resize plumbing.
//
// Zero per-frame allocation: own 120-slot ring + preallocated sort scratch;
// p95 recomputed every 30 frames, not per frame.
//
// Frozen export: createDynres(renderer, perf) → { update() }.

const WINDOW = 120;
const CHECK_EVERY = 30;
const UP_STREAK = 300;
const DOWN_P95_MS = 20;
const UP_MS = 13;
const STEP = 0.1;
const FLOOR = 1.0;

export function createDynres(renderer, perf) {
  const ceiling = Math.min(1.5, window.devicePixelRatio || 1);
  const ring = new Float32Array(WINDOW);
  const scratch = new Float32Array(WINDOW);
  let head = 0, filled = 0;
  let sinceCheck = 0;
  let upStreak = 0;
  let cooldown = 0; // frames to wait after a step before judging again

  function p95() {
    const n = filled;
    if (n === 0) return 0;
    for (let i = 0; i < n; i++) scratch[i] = ring[i];
    scratch.subarray(0, n).sort();
    return scratch[Math.min(n - 1, Math.floor(0.95 * n))];
  }

  function setDpr(v) {
    const clamped = Math.max(FLOOR, Math.min(ceiling, Math.round(v * 10) / 10));
    if (Math.abs(clamped - renderer.getPixelRatio()) < 0.001) return false;
    renderer.setPixelRatio(clamped);
    // re-apply the CSS size so the drawing buffer actually changes; post.js
    // notices the buffer change next render and resizes its chain.
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    console.info(`[dynres] DPR → ${clamped.toFixed(1)}${clamped <= FLOOR + 1e-6 ? " (floor — planar reflection auto-offs)" : ""}`);
    return true;
  }

  const api = {
    update() {
      const ms = perf.live.frameMs;
      if (!(ms > 0)) return;
      ring[head] = ms;
      head = (head + 1) % WINDOW;
      if (filled < WINDOW) filled++;

      upStreak = ms < UP_MS ? upStreak + 1 : 0;
      if (cooldown > 0) { cooldown--; return; }

      // step-up path: 300 consecutive fast frames
      if (upStreak >= UP_STREAK && renderer.getPixelRatio() < ceiling - 1e-6) {
        if (setDpr(renderer.getPixelRatio() + STEP)) {
          upStreak = 0;
          cooldown = WINDOW; // let the ring refill at the new cost
        }
        return;
      }

      // step-down path: p95 judged every 30 frames on a full window
      if (++sinceCheck >= CHECK_EVERY && filled >= WINDOW) {
        sinceCheck = 0;
        if (p95() > DOWN_P95_MS && renderer.getPixelRatio() > FLOOR + 1e-6) {
          if (setDpr(renderer.getPixelRatio() - STEP)) {
            upStreak = 0;
            cooldown = WINDOW;
          }
        }
      }
    },
    // ---- private additions ----
    atFloor() { return renderer.getPixelRatio() <= FLOOR + 1e-6 && ceiling > FLOOR; },
    dpr() { return renderer.getPixelRatio(); },
    ceiling,
  };

  // reflect.js (created before dynres in boot order, no shared ctx in this
  // frozen signature) reads the floor state through this documented global.
  globalThis.__BR_DYNRES__ = api;
  return api;
}
