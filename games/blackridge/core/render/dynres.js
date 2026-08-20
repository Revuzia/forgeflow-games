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
// PANIC PATH (iter05, measured). The rule above is tuned for a build that is
// NEAR budget and drifts over it; it cannot rescue one that opens far over.
// Measured on this box at DPR 1.5 (EXT_disjoint_timer_query_webgl2, GPU
// disjoint false): the S3 static frame costs ~109 ms and a live mission frame
// ~300 ms. gfx.js boots at min(devicePixelRatio, 1.5), so on any 1.5-DPR
// display the game STARTS there — and the specced path needs 120 frames just
// to fill its window before it may judge, then five step-downs each behind a
// 30-frame check and a 120-frame cooldown. At 9 fps that is ~13 s before the
// first correction and ~90 s to reach the floor: a minute and a half of
// single-digit frame rate on the first mission the player ever loads.
//
// So the DOWN rule is allowed to act on a partial window when the evidence is
// unambiguous — p95 above 2x the step-down threshold, i.e. worse than half
// the frame rate the threshold defends. Thresholds themselves are unchanged
// (ARCH §3.13 verbatim) and the fast path is unreachable in a build that is
// merely a little slow.
//
// NECESSARY, NOT SUFFICIENT — stated here so nobody reads a step-down as a
// fix: the FLOOR is DPR 1.0 and the same measurement puts the static frame at
// ~49 ms there, still 3x the 16.7 ms p50 budget. Resolution scaling cannot
// close this gap; ~65% of the frame is the post chain (measured: 70.7 of
// 109.2 ms at DPR 1.5, scene-only render 38.5 ms), which is post.js's to fix.
//
// Frozen export: createDynres(renderer, perf) → { update() }.

const WINDOW = 120;
const CHECK_EVERY = 30;
const UP_STREAK = 300;
const DOWN_P95_MS = 20;
const UP_MS = 13;
const STEP = 0.1;
const FLOOR = 1.0;
// Panic path: enough samples to be a measurement rather than one bad frame,
// and a cost so far over budget that waiting cannot be the right answer.
const PANIC_MIN_SAMPLES = 20;
const PANIC_P95_MS = DOWN_P95_MS * 2;
const PANIC_COOLDOWN = 30;

export function createDynres(renderer, perf) {
  const ceiling = Math.min(1.5, window.devicePixelRatio || 1);
  const ring = new Float32Array(WINDOW);
  const scratch = new Float32Array(WINDOW);
  let head = 0, filled = 0;
  let sinceCheck = 0;
  let upStreak = 0;
  let cooldown = 0; // frames to wait after a step before judging again
  let steps = { down: 0, up: 0, panic: 0 }; // harness-visible history

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

      // PANIC step-down: act on a partial window when the frame is more than
      // twice the step-down threshold. Same rule ("p95 over budget → step
      // down"), just not made to wait 120 frames to notice a 100 ms frame.
      if (filled >= PANIC_MIN_SAMPLES && filled < WINDOW &&
          renderer.getPixelRatio() > FLOOR + 1e-6 && p95() > PANIC_P95_MS) {
        if (setDpr(renderer.getPixelRatio() - STEP)) {
          steps.down++; steps.panic++;
          upStreak = 0;
          sinceCheck = 0;
          cooldown = PANIC_COOLDOWN; // short: still far over, judge again soon
        }
        return;
      }

      // step-up path: 300 consecutive fast frames
      if (upStreak >= UP_STREAK && renderer.getPixelRatio() < ceiling - 1e-6) {
        if (setDpr(renderer.getPixelRatio() + STEP)) {
          steps.up++;
          upStreak = 0;
          cooldown = WINDOW; // let the ring refill at the new cost
        }
        return;
      }

      // step-down path: p95 judged every 30 frames on a full window
      if (++sinceCheck >= CHECK_EVERY && filled >= WINDOW) {
        sinceCheck = 0;
        const p = p95();
        if (p > DOWN_P95_MS && renderer.getPixelRatio() > FLOOR + 1e-6) {
          if (setDpr(renderer.getPixelRatio() - STEP)) {
            steps.down++;
            upStreak = 0;
            // Still catastrophically slow after a step? Do not sit out 120
            // frames of it — re-judge on the short cooldown.
            cooldown = p > PANIC_P95_MS ? PANIC_COOLDOWN : WINDOW;
          }
        }
      }
    },
    // ---- private additions ----
    atFloor() { return renderer.getPixelRatio() <= FLOOR + 1e-6 && ceiling > FLOOR; },
    dpr() { return renderer.getPixelRatio(); },
    ceiling,
    // Harness-visible state (perfprobe records it): a run that passed only
    // because dynres quietly dropped resolution is not the same result as a
    // run that held its DPR, and the verdict must be able to tell them apart.
    report() {
      return { dpr: renderer.getPixelRatio(), ceiling, floor: FLOOR,
               samples: filled, p95: +p95().toFixed(2),
               atFloor: api.atFloor(), steps: { ...steps } };
    },
  };

  // reflect.js (created before dynres in boot order, no shared ctx in this
  // frozen signature) reads the floor state through this documented global.
  globalThis.__BR_DYNRES__ = api;
  return api;
}
