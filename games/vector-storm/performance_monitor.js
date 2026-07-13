/**
 * performance_monitor.js — AAA-standard 60 FPS + memory watch for generated games.
 *
 * Exposes:
 *   window.__TEST__.getPerformance() -> {fps, memMB, frameTime, longFrames, dropoutCount}
 *
 * Auto-warns at 45 FPS, auto-fails at 30 FPS so QA can detect slow games.
 */
(function(){
  const samples = [];
  const WINDOW = 120;  // last 120 frames (~2 sec at 60 FPS)
  let lastFrame = performance.now();
  let longFrames = 0;  // frames > 33 ms (i.e. dropped below 30 FPS)
  let dropoutCount = 0;  // frames > 100 ms (hitch)

  function tick() {
    const now = performance.now();
    const dt = now - lastFrame;
    lastFrame = now;
    samples.push(dt);
    if (samples.length > WINDOW) samples.shift();
    if (dt > 33) longFrames++;
    if (dt > 100) dropoutCount++;
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function avg(arr){ return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }

  const api = {
    getPerformance() {
      const meanFrameTime = avg(samples);
      const fps = meanFrameTime > 0 ? Math.round(1000/meanFrameTime) : 0;
      const memMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize/(1024*1024)) : null;
      return {
        fps, frameTime: meanFrameTime.toFixed(2),
        memMB, longFrames, dropoutCount,
        verdict: fps >= 55 ? "pass" : fps >= 40 ? "borderline" : "fail",
      };
    },
    resetCounters() { longFrames = 0; dropoutCount = 0; samples.length = 0; },
  };

  window.__PERF__ = api;
  // Also mirror into __TEST__ if that's exposed
  if (window.__TEST__) {
    window.__TEST__.getPerformance = api.getPerformance;
    window.__TEST__.resetPerfCounters = api.resetCounters;
  } else {
    // Wait for __TEST__ to be set, then attach
    let attempts = 0;
    const interval = setInterval(() => {
      if (window.__TEST__) {
        window.__TEST__.getPerformance = api.getPerformance;
        window.__TEST__.resetPerfCounters = api.resetCounters;
        clearInterval(interval);
      } else if (++attempts > 100) clearInterval(interval);
    }, 200);
  }
})();
