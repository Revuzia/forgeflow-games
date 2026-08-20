// core/perf.js [A0] — frame ring, p50/p95/p99, hitch attribution
// (architecture §3.18). Report p99 and attribute hitches, never averages
// (doctrine §3). Hitch + programs jump = shader compile; + textures jump =
// upload stall (adoption_plan p99 verdict spec).

const RING = 600; // ~10 s of frames at 60 fps

export function createPerf(renderer) {
  const ring = new Float32Array(RING);
  const sorted = new Float32Array(RING);
  let head = 0, filled = 0, frames = 0;
  const hitches = []; // {i, ms, cause} — capped
  let lastPrograms = 0, lastTextures = 0;

  // Live counter object — exposed as __FPS__.perfStats (R11). Same object
  // every frame, mutated in place; harnesses may hold a reference.
  const live = {
    fps: 0, frameMs: 0, drawCalls: 0, triangles: 0,
    programs: 0, geometries: 0, textures: 0, frames: 0,
  };

  function percentile(p, n) {
    if (n === 0) return 0;
    // copy the live window then sort — called from stats()/benchDump only,
    // never per frame.
    for (let i = 0; i < n; i++) sorted[i] = ring[i];
    const view = sorted.subarray(0, n).sort();
    return view[Math.min(n - 1, Math.floor(p * n))];
  }

  function median(n) { return percentile(0.5, n); }

  const perf = {
    live,

    // Called by boot once per frame with the frame-to-frame delta in ms.
    // Reads renderer.info itself (autoReset=false; boot owns the one reset).
    frame(ms) {
      ring[head] = ms;
      head = (head + 1) % RING;
      if (filled < RING) filled++;
      frames++;

      const info = renderer.info;
      const programs = info.programs ? info.programs.length : 0;
      const textures = info.memory ? info.memory.textures : 0;

      // hitch = frame > max(2*median, median+8ms)
      const med = filled > 30 ? approximateMedian() : 16.7;
      if (filled > 30 && ms > Math.max(2 * med, med + 8)) {
        let cause = "unknown";
        if (programs > lastPrograms) cause = "shader-compile";
        else if (textures > lastTextures) cause = "upload";
        if (hitches.length < 200) hitches.push({ i: frames, ms: Math.round(ms * 10) / 10, cause });
      }
      lastPrograms = programs;
      lastTextures = textures;

      live.frameMs = ms;
      live.fps = ms > 0 ? Math.round(1000 / ms) : 0;
      live.drawCalls = info.render ? info.render.calls : 0;
      live.triangles = info.render ? info.render.triangles : 0;
      live.programs = programs;
      live.geometries = info.memory ? info.memory.geometries : 0;
      live.textures = textures;
      live.frames = frames;
    },

    stats() {
      const n = filled;
      return {
        fps: live.fps,
        p50: round1(percentile(0.5, n)),
        p95: round1(percentile(0.95, n)),
        p99: round1(percentile(0.99, n)),
        hitches: hitches.slice(-25),
        drawCalls: live.drawCalls,
        triangles: live.triangles,
        programs: live.programs,
        geometries: live.geometries,
        textures: live.textures,
        frames,
      };
    },

    benchDump() {
      return JSON.stringify({
        ...perf.stats(),
        hitchesTotal: hitches.length,
        ringFilled: filled,
      });
    },

    resetHitches() { hitches.length = 0; },
  };

  // Cheap running median estimate for the hitch gate (exact percentile sort
  // per frame would be per-frame work the budget bans).
  let medEst = 16.7;
  function approximateMedian() {
    const ms = ring[(head + RING - 1) % RING];
    medEst += (ms > medEst ? 0.02 : -0.02) * medEst;
    return medEst;
  }

  function round1(x) { return Math.round(x * 10) / 10; }

  return perf;
}
