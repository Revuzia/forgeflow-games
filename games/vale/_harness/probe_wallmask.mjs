// VALE harness — env F4 gate: how much of a fighter stays readable when it stands on walkable ground just NORTH of
// cover (a cliff block, its Dialwood, a landmark: the cover sits between it and the camera at 52°, 28.5 m),
// COUNTING the occluded silhouette (actors.ts setXray, ink.ts xray).
//
//   visibility = |N − N without the fighter| / |S − S without the fighter| over the fighter's screen box
//     N  the frame as drawn: the fighter's body flat magenta (no shadow, rest ink and flash hidden), its silhouette
//        drawn as the renderer decides (relationship colour)
//     S  the same frame with the cover hidden (vale_cliffs, vale_rock_stacks, vale_scatter, landmarks)
//   A pixel counts when it changes by > 40 (sum of |ΔRGB|). Fog of war off, VFX and overlay off.
//   Each spot is measured twice: with the silhouette (the gate) and with it forced off (the cover alone).
//   Spots: walkable cells whose nearest wall straight south (+y, toward the camera) is 0.2-2.6 m away, spread over
//   the map in four distance bands (the nav grid and the map's own wall polygons).
//
//   node _harness/probe_wallmask.mjs [rift|bridge|fray] [--n 48] [--out <json>] [--shots <prefix>]
//   exit 1 when any spot leaves the fighter under 50 % readable with the silhouette.
import { writeFileSync } from 'node:fs';
import { open, shot } from './pw.mjs';

const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith('--') && !/^\d/.test(a)) ?? 'rift';
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const N = +opt('n', 48), OUT = opt('out', ''), SHOTS = opt('shots', '');
const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=${mode}&q=high&t=12&dev=1&hud=0&manual=1`, { wait: false, hmr: false });
await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 180000 });
const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
await B((b) => b.frames(30, 1 / 30));
await new Promise((r) => setTimeout(r, 4000));
await B((b) => b.frames(10, 1 / 30));
await B((b) => {
  const R = b.renderer;
  R.fog.enabled = false;
  R.vfx.draw = () => {}; R.vfx.group.visible = false; R.overlay.draw = () => {}; R.vfx.clear();
  const occ = [];
  R.scene.traverse((o) => { if (['vale_cliffs', 'vale_rock_stacks', 'vale_scatter'].includes(o.name)) occ.push(o); });
  // landmarks: the GLB scenes the renderer adds to the terrain group (not the terrain's own vale_* parts)
  const tg = R.scene.getObjectByName('vale_terrain');
  for (const c of tg ? tg.children : []) if (!c.name.startsWith('vale_')) occ.push(c);
  b.$w = {
    Mat: null, occ,
    ent: (id) => b.host.view.entities.find((e) => e.id === id),
    place: (id, x, y) => { const e = b.$w.ent(id); e.x = x; e.y = y; e.order = 0; e.vx = 0; e.vy = 0; b.host.view.hashDirty = true; },
    settle: (id, x, y) => { b.$w.place(id, x, y); for (let i = 0; i < 7; i++) { b.host.pump(1 / 30); b.$w.place(id, x, y); } b.host.pump(1 / 30); },
    walk: (x, y) => b.host.view.nav.walkable(x, y),
    box: (id) => {
      const a = R.actors.get(id); if (!a || !a.model) return null;
      const cam = R.rig.camera; cam.updateMatrixWorld(); a.root.updateMatrixWorld(true);
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; const v = new cam.position.constructor();
      a.model.traverseVisible((o) => {
        if (!o.isMesh || o.userData.valeOutline) return;
        const n = o.geometry.getAttribute('position').count;
        for (let i = 0; i < n; i += 3) { o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); v.project(cam); const sx = (v.x * 0.5 + 0.5) * R.cssW, sy = (-v.y * 0.5 + 0.5) * R.cssH; x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); }
      });
      return { w: Math.round(x1 - x0), h: Math.round(y1 - y0), x0: Math.round(x0), y0: Math.round(y0) };
    },
    grab: (r) => {
      const canvas = R.gl.domElement; const sx = canvas.width / R.cssW, sy = canvas.height / R.cssH;
      const t = document.createElement('canvas'); t.width = Math.max(1, Math.round(r.w * sx)); t.height = Math.max(1, Math.round(r.h * sy));
      const g = t.getContext('2d'); g.drawImage(canvas, r.x0 * sx, r.y0 * sy, r.w * sx, r.h * sy, 0, 0, t.width, t.height);
      return g.getImageData(0, 0, t.width, t.height).data;
    },
    vis: (u, xray) => {
      const U = R.actors.get(u); const r0 = b.$w.box(u);
      if (!U || !r0 || r0.w < 2 || r0.h < 2) return null;
      const r = { x0: Math.max(0, r0.x0 - 4), y0: Math.max(0, r0.y0 - 4), w: Math.min(r0.w + 8, R.cssW - Math.max(0, r0.x0 - 4)), h: Math.min(r0.h + 8, R.cssH - Math.max(0, r0.y0 - 4)) };
      const saved = [];
      const Mat = b.$w.Mat;
      U.model.traverse((o) => {
        if (!o.isMesh || o.userData.valeXray) return;
        saved.push([o, o.material, o.castShadow, o.visible]);
        if (o.userData.valeOutline) { o.visible = false; return; }
        o.castShadow = false; o.material = Mat;
      });
      const setX = U.setXray;
      if (!xray) U.setXray = (on, c) => setX.call(U, false, c);
      let a, c, drawn;
      try {
        const g = () => { R.render(0.0001); return b.$w.grab(r); };
        const cnt = (A, Bf) => { let n = 0; for (let i = 0; i < A.length; i += 4) { if (Math.abs(A[i] - Bf[i]) + Math.abs(A[i + 1] - Bf[i + 1]) + Math.abs(A[i + 2] - Bf[i + 2]) > 40) n++; } return n; };
        const Nn = g(); drawn = U.xray; U.model.visible = false; const NF = g(); U.model.visible = true;
        for (const o of b.$w.occ) o.visible = false;
        const Sx = g(); U.model.visible = false; const SF = g(); U.model.visible = true;
        for (const o of b.$w.occ) o.visible = true;
        a = cnt(Nn, NF); c = cnt(Sx, SF);
      } finally {
        U.setXray = setX;
        for (const [o, m, cs, v] of saved) { o.material = m; o.castShadow = cs; o.visible = v; }
        R.render(0.0001);
      }
      return { vis: +(a / Math.max(1, c)).toFixed(3), px: a, pxFull: c, xray: drawn };
    },
    /** walkable cells (0.5 m grid) by the distance to the first wall cell straight south (+y), within 4 m */
    scan: () => {
      const m = b.catalog.maps.find((x) => x.id === b.host.setup.map); const [W, H] = m.size;
      const st = { cells: 0, d0_11: 0, d11_265: 0 }; const cand = [];
      const pip = (px, py, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], q = poly[j]; if ((a[1] > py) !== (q[1] > py) && px < (q[0] - a[0]) * (py - a[1]) / (q[1] - a[1]) + a[0]) c = !c; } return c; };
      const inWall = (px, py) => m.walls.some((w) => pip(px, py, w));
      for (let y = 0.25; y < H; y += 0.5) for (let x = 0.25; x < W; x += 0.5) {
        if (!b.$w.walk(x, y)) continue; st.cells++;
        let d = null; for (let s = 0.1; s <= 4; s += 0.1) { const yy = y + s; if (yy >= H) break; if (inWall(x, yy)) { d = s; break; } }
        if (d == null) continue;
        if (d <= 1.1) st.d0_11++; else if (d <= 2.65) st.d11_265++;
        if (Math.round((x - 0.25) * 2) % 7 === 0 && y > 2 && y < H - 2 && x > 2 && x < W - 2) cand.push([x, y, +d.toFixed(1)]);
      }
      return { st, cand };
    },
  };
});
await B(async (b) => {
  const url = performance.getEntriesByType('resource').map((x) => x.name).find((n) => /\/deps\/three(\.module)?\.js/.test(n) || /node_modules\/three\/build\/three\.module\.js/.test(n));
  if (!url) throw new Error('three module url not found');
  const T = await import(url);
  const m = new T.MeshBasicMaterial({ color: 0xff00ff }); m.toneMapped = false; m.fog = false;
  b.$w.Mat = m;
});
const you = await B((b) => b.you());
const scan = await B((b) => b.$w.scan());
const bins = [[0.2, 0.7], [0.7, 1.1], [1.1, 1.7], [1.7, 2.6]];
const per = Math.ceil(N / bins.length);
const spots = [];
for (const [lo, hi] of bins) {
  const c = scan.cand.filter((p) => p[2] > lo && p[2] <= hi);
  for (let i = 0; i < per && c.length; i++) spots.push(c[Math.floor((i + 0.5) * c.length / per)]);
}
const rows = [];
for (const [x, y, d] of spots) {
  const v = await B((b, p) => {
    b.$w.settle(p.you, p.x, p.y); b.focus(p.x, p.y); b.zoom(28.5);
    for (let i = 0; i < 30; i++) b.renderer.render(1 / 30);
    const e = b.$w.ent(p.you);
    const on = b.$w.vis(p.you, true), off = b.$w.vis(p.you, false);
    return { at: [+e.x.toFixed(2), +e.y.toFixed(2)], vis: on?.vis ?? null, px: on?.px, pxFull: on?.pxFull, xray: on?.xray ?? false, visCover: off?.vis ?? null };
  }, { you: you.id, x, y });
  rows.push({ want: [x, y], wallSouthM: d, ...v });
  if (SHOTS && rows.length % 6 === 1) {
    const r = await B((b, p) => { b.renderer.render(0.0001); const q = b.$w.box(p.you); return q; }, { you: you.id });
    if (r) {
      const cx = r.x0 + r.w / 2, cy = r.y0 + r.h / 2;
      await shot(page, `${SHOTS}_${String(rows.length).padStart(2, '0')}_d${d}`, { x: Math.max(0, Math.round(cx - 240)), y: Math.max(0, Math.round(cy - 180)), width: 480, height: 360 });
    }
  }
}
const binOf = (key) => bins.map(([lo, hi]) => {
  const r = rows.filter((w) => w.wallSouthM > lo && w.wallSouthM <= hi && w[key] != null);
  const v = r.map((w) => w[key]).sort((a, c) => a - c);
  return { bin: [lo, hi], n: r.length, median: v[Math.floor(v.length / 2)] ?? null, min: v[0] ?? null, under50: r.filter((w) => w[key] < 0.5).length };
});
const measured = rows.filter((w) => w.vis != null);
const out = {
  map: mode, fighter: you, navCells: scan.st,
  shareFullyBehind: +(scan.st.d0_11 / scan.st.cells).toFixed(4), sharePartlyBehind: +(scan.st.d11_265 / scan.st.cells).toFixed(4),
  spots: measured.length, under50: measured.filter((w) => w.vis < 0.5).length, under50Cover: measured.filter((w) => w.visCover < 0.5).length,
  minVis: Math.min(...measured.map((w) => w.vis)), xrayDrawn: measured.filter((w) => w.xray).length,
  byBin: binOf('vis'), byBinCover: binOf('visCover'), rows, logs: logs.filter((l) => !/favicon|toNonIndexed/.test(l)).slice(0, 8),
};
console.log(JSON.stringify({ ...out, rows: undefined }, null, 1));
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 1));
await browser.close();
process.exit(out.under50 > 0 || measured.length === 0 ? 1 : 0);
