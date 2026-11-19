(async () => { const G = window.__GENESIS__, t = globalThis.__TCACHE__; if (!t) return 'no cache';
  const snap = () => JSON.stringify({ why: t.stats.why, wf: t.stats.wf, bakes: t.stats.bakesTotal, stale: t.stats.stale, live: t.stats.live, cached: t.stats.cached, pix: t.stats.pixPct });
  const out = ['0x ' + snap()];
  for (const [sp, n] of [[1, 20], [100, 8], [1000, 4]]) { G.setSpeed(sp); const t0 = performance.now(); await G.frames(n); out.push(sp + 'x ' + n + 'f ' + ((performance.now() - t0) / 1000).toFixed(0) + 's ' + snap()); }
  G.setSpeed(0); return out.join('\n'); })()
