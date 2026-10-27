// VALE harness — foliage read check (r12 M11): the real client (render bench, real map, real post chain) at the
// gameplay camera over one Needlegrass thicket per map, with fighters placed in it through a PRESENTATION-ONLY
// view patch (the renderer reads a copy of the sim's view with a few fighters moved and, for the leak test, an
// enemy's visibility bit cleared; the sim itself runs untouched). Fog of war off (the placed fighters are not
// where the sim's vision is), VFX hidden, UI (rings, bars) on.
//
//   shots (into --dir, default _harness/_shots):
//     foliage_<map>_<tag>.png         your fighter, an ally and a VISIBLE enemy in the brush (bend round all
//                                     three, fade round you and the ally)
//     foliage_<map>_<tag>_hidden.png  the same with the enemy out of your vision (no bend, no fade, nothing drawn)
//     foliage_<map>_<tag>_empty.png   the thicket with nobody in it
//     foliage_<map>_<tag>_wood.png    (maps with Dialwood) a 1:1 crop of the canopy, a boulder and a stone
//   --canon 1 also copies foliage_<map>_<tag>.png to _harness/_shots/foliage_<map>.png
//
//   leak test (the numbers printed and written to --report): an enemy alone in the brush, rendered at one fixed
//   clock (dt 0) three ways — absent (left where the sim has it), present but out of vision, present and visible —
//   and the display pixels of a box round its spot compared: hidden vs absent must be IDENTICAL (bit-exact: the
//   grass never moves for a unit the viewer cannot see), visible vs absent must differ (the bend is live).
//   The brush slots the terrain received (terrain.brush.snapshot()) are listed per case.
//
//   node _harness/shot_foliage.mjs [--maps rift,bridge,fray] [--q high] [--tag after] [--dir <dir>] [--canon 0]
//                                   [--report <file.json>] [--thicket <index>]
// VALE_URL picks the dev server (default http://localhost:5190).

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const MAPS = opt('maps', 'rift,bridge,fray').split(',');
const Q = opt('q', 'high');
const TAG = opt('tag', 'after');
const DIR = opt('dir', join(HERE, '_shots'));
const CANON = opt('canon', '0') === '1';
const REPORT = opt('report', '');
const THICKET = opt('thicket', '');
const RES = { high: [1920, 1080], low: [1280, 720], medium: [1920, 1080], ultra: [1920, 1080] };
mkdirSync(DIR, { recursive: true });

function install(thIdx) {
  const b = window.__VALE_BENCH__, R = b.renderer, host = b.host, gl = R.gl, ctx = gl.getContext();
  const world = host.view;
  const m = b.catalog.maps.find((x) => x.id === host.setup.map);
  // ── the view patch: { id → { x, y, mask? } } applied to copies of the sim's entities ──
  const over = new Map();
  const realGet = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(host), 'view').get;
  const patch = (v) => {
    if (!over.size) return v;
    const ents = v.entities.map((e) => {
      const o = over.get(e.id);
      if (!o) return e;
      const c = Object.assign(Object.create(Object.getPrototypeOf(e)), e);
      c.x = o.x; c.y = o.y; c.vx = 0; c.vy = 0;
      if (o.mask !== undefined) c.visibleMask = o.mask;
      return c;
    });
    const byId = new Map(ents.map((e) => [e.id, e]));
    const pv = Object.create(v);
    Object.defineProperty(pv, 'entities', { value: ents });
    pv.entity = (id) => byId.get(id) ?? v.entity(id);
    pv.visionGrid = (t) => v.visionGrid(t);
    return pv;
  };
  Object.defineProperty(host, 'view', { configurable: true, get() { return patch(realGet.call(host)); } });
  // ── VFX hidden, fog off ──
  R.vfx.draw = () => {}; R.vfx.group.visible = false; R.vfx.clear();
  R.fog.enabled = false;
  // ── the thicket: the requested one, else the one nearest the map's first lane's 30 % point ──
  const pip = (x, y, poly) => { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
  const th = m.thickets ?? [];
  const cen = (p) => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
  let k = Number.isFinite(thIdx) && thIdx >= 0 ? thIdx : 0;
  if (!(Number.isFinite(thIdx) && thIdx >= 0) && th.length) {
    // the largest thicket (room for three fighters)
    const area = (p) => Math.abs(p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0)) / 2;
    k = th.map((p, i) => [area(p), i]).sort((a, c) => c[0] - a[0])[0][1];
  }
  const poly = th[k];
  const [cx, cy] = cen(poly);
  // the thicket's long axis (its bbox), so the three spots spread along it
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const wx = Math.max(...xs) - Math.min(...xs), wy = Math.max(...ys) - Math.min(...ys);
  const ax = wx >= wy ? [1, 0] : [0, 1];
  const inside = (d) => { const x = cx + ax[0] * d, y = cy + ax[1] * d; return pip(x, y, poly) ? [x, y] : null; };
  const spread = Math.min(3.0, (Math.max(wx, wy) / 2) - 0.9);
  const me = b.you();
  const ents = world.entities;
  const ally = ents.find((e) => e.kind === 'fighter' && e.team === me.team && e.id !== me.id && e.alive);
  const enemy = ents.find((e) => e.kind === 'fighter' && e.team !== me.team && e.alive);
  const spots = { me: inside(-spread) ?? [cx, cy], ally: inside(0.2) ?? [cx, cy], enemy: inside(spread) ?? [cx, cy] };
  const settle = (n, dt = 1 / 30) => { for (let i = 0; i < n; i++) { host.pump(dt); R.render(dt); } };
  const readBox = (x, y, r) => {
    const w = gl.domElement.width, h = gl.domElement.height, sx = w / R.cssW;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [dx, dy, hh] of [[-r, -r, 0], [r, -r, 0], [-r, r, 0], [r, r, 0], [-r, -r, 1.6], [r, -r, 1.6], [-r, r, 1.6], [r, r, 1.6]]) {
      const p = R.worldToScreen(x + dx, y + dy, hh); x0 = Math.min(x0, p.x * sx); x1 = Math.max(x1, p.x * sx); y0 = Math.min(y0, p.y * sx); y1 = Math.max(y1, p.y * sx);
    }
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(w, Math.ceil(x1)); y1 = Math.min(h, Math.ceil(y1));
    const bw = x1 - x0, bh = y1 - y0;
    const buf = new Uint8Array(bw * bh * 4);
    ctx.readPixels(x0, h - y1, bw, bh, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
    return { box: [x0, y0, bw, bh], buf };
  };
  const diff = (a, c) => { let n = 0, mx = 0; for (let i = 0; i < a.buf.length; i += 4) { const d = Math.abs(a.buf[i] - c.buf[i]) + Math.abs(a.buf[i + 1] - c.buf[i + 1]) + Math.abs(a.buf[i + 2] - c.buf[i + 2]); if (d) { n++; mx = Math.max(mx, d); } } return { px: n, of: a.buf.length / 4, max: mx }; };
  const slots = () => R.terrain?.brush?.snapshot() ?? null;
  const api = {
    info: () => ({ map: m.id, thicket: k, centre: [cx, cy], spots, me: me.id, ally: ally?.id, enemy: enemy?.id }),
    focus: (dx = 0) => { b.focus(cx + dx, cy); b.zoom(28.5); },
    set: (cfg) => {
      over.clear();
      if (cfg.me) over.set(me.id, { x: spots.me[0], y: spots.me[1] });
      if (cfg.ally && ally) over.set(ally.id, { x: spots.ally[0], y: spots.ally[1] });
      if (cfg.enemy && enemy) over.set(enemy.id, { x: spots.enemy[0], y: spots.enemy[1], mask: cfg.enemy === 'hidden' ? 0 : 0xff });
    },
    settle,
    /** the leak test: the enemy alone; absent / hidden / visible at one fixed clock */
    leak: () => {
      const [ex, ey] = spots.enemy;
      api.set({}); api.focus(); settle(45);
      const T0 = R.time;
      const shotAt = (cfg) => { api.set(cfg); settle(30); R.time = T0; R.render(0); R.time = T0; R.render(0); return { px: readBox(ex, ey, 1.3), slots: slots() }; };
      const absent = shotAt({});
      const hidden = shotAt({ enemy: 'hidden' });
      const visible = shotAt({ enemy: 'visible' });
      const absent2 = shotAt({});
      return {
        box: absent.px.box,
        hiddenVsAbsent: diff(hidden.px, absent.px), visibleVsAbsent: diff(visible.px, absent.px), absentRepeat: diff(absent2.px, absent.px),
        slots: { absent: absent.slots, hidden: hidden.slots, visible: visible.slots },
      };
    },
    /** a canopy / boulder / stone spot near the thicket for the wood crop */
    woodSpot: () => {
      let best = null;
      R.terrain?.group.traverse((o) => {
        if (!o.isInstancedMesh || !/^vale_boulders/.test(o.parent?.name ?? '')) return;
        const mm = new o.matrixWorld.constructor();
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, mm);
          const x = mm.elements[12], y = mm.elements[14];
          const d = Math.hypot(x - cx, y - cy);
          if (!best || d < best.d) best = { x, y, d };
        }
      });
      return best;
    },
  };
  window.__FOL__ = api;
  return api.info();
}

const out = { tag: TAG, q: Q, maps: {} };
for (const map of MAPS) {
  const [W, H] = RES[Q] ?? RES.high;
  const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=${map}&q=${Q}&t=20&dev=1&hud=0&manual=1`, { wait: false, width: W, height: H, hmr: false });
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 180000 });
  const err = await page.evaluate(() => window.__VALE_BENCH__?.error);
  if (err) { console.error(map, err); await browser.close(); continue; }
  await page.evaluate(() => window.__VALE_BENCH__.frames(30, 1 / 30));
  await new Promise((r) => setTimeout(r, 6000));                       // props and landmarks land in real time
  const info = await page.evaluate(`(${install.toString()})(${THICKET === '' ? -1 : Number(THICKET)})`);
  const F = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__FOL__, x), [fn.toString(), a]);
  const res = { info };
  res.leak = await F((f) => f.leak());
  const name = (s) => join(DIR, `foliage_${map}_${TAG}${s}.png`);
  await F((f) => { f.set({}); f.focus(); f.settle(40); });
  await page.screenshot({ path: name('_empty') });
  await F((f) => { f.set({ me: 1, ally: 1, enemy: 'hidden' }); f.focus(); f.settle(40); });
  await page.screenshot({ path: name('_hidden') });
  res.slotsHidden = await page.evaluate(() => window.__VALE_BENCH__.renderer.terrain?.brush?.snapshot() ?? null);
  await F((f) => { f.set({ me: 1, ally: 1, enemy: 'visible' }); f.focus(); f.settle(40); });
  await page.screenshot({ path: name('') });
  res.slotsAll = await page.evaluate(() => window.__VALE_BENCH__.renderer.terrain?.brush?.snapshot() ?? null);
  if (CANON) copyFileSync(name(''), join(HERE, '_shots', `foliage_${map}.png`));
  const wood = await F((f) => f.woodSpot());
  if (wood) {
    await F((f, p) => { f.set({}); window.__VALE_BENCH__.focus(p.x, p.y + 2.5); window.__VALE_BENCH__.zoom(28.5); f.settle(40); }, wood);
    const c = await page.evaluate((p) => { const R = window.__VALE_BENCH__.renderer; const s = R.worldToScreen(p.x, p.y, 0); return [s.x, s.y]; }, wood);
    const cw = Math.round(W * 0.42), ch = Math.round(H * 0.5);
    const x0 = Math.max(0, Math.min(W - cw, Math.round(c[0] - cw / 2))), y0 = Math.max(0, Math.min(H - ch, Math.round(c[1] - ch * 0.6)));
    await page.screenshot({ path: name('_wood'), clip: { x: x0, y: y0, width: cw, height: ch } });
    res.wood = wood;
  }
  res.errors = logs.filter((l) => /error/i.test(l)).slice(0, 8);
  out.maps[map] = res;
  const L = res.leak;
  console.log(`${map}: thicket ${info.thicket} at ${info.centre.map((v) => v.toFixed(1))}  leak hidden-vs-absent ${L.hiddenVsAbsent.px}/${L.hiddenVsAbsent.of} px (max ${L.hiddenVsAbsent.max})  visible-vs-absent ${L.visibleVsAbsent.px} px  repeat ${L.absentRepeat.px} px  slots all=${JSON.stringify(res.slotsAll)}`);
  await browser.close();
}
if (REPORT) { mkdirSync(dirname(REPORT), { recursive: true }); writeFileSync(REPORT, JSON.stringify(out, null, 1)); }
