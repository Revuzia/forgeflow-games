(() => {
  const tc = globalThis.__TCACHE__; if (!tc) return 'no tcache';
  const lod = tc.lod, g = lod.grid, f = lod.fields, A = tc.fieldTex.A.image.data, n = g.count;
  let mis = 0, texWetLand = 0, arrWetLand = 0, lvlHi = 0, ex = [];
  for (let c = 0; c < n; c++) {
    const s = A[c * 4], wl = A[c * 4 + 2], wd = A[c * 4 + 3];
    if (Math.abs(wd - f.waterDepth[c]) > 1e-3 || Math.abs(wl - f.waterLevel[c]) > 1e-2) mis++;
    if (wd > 0.1 && s > 1) texWetLand++;
    if (f.waterDepth[c] > 0.1 && f.surface[c] > 1) arrWetLand++;
    if (wl > s + 0.5 && s > 1) { lvlHi++; if (ex.length < 12) ex.push([c, +s.toFixed(1), +wl.toFixed(1), +wd.toFixed(2)]); }
  }
  // the camera, in the planet body frame (the planet group's inverse world matrix)
  const st = window.__GENESIS__.state();
  return { n, mis, texWetLand, arrWetLand, lvlHi, ex, cam: st.camera, sel: lod.selected.length, R: lod.radius };
})()
