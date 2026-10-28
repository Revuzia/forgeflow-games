// VALE harness — actor + overlay regression (r12 B1 · B2 · M10 · M6) in the real renderer (render bench,
// real RIFT match, real post chain, real Chrome GPU at 1920×1080).
//
//   node _harness/overlay_regress.mjs [--t 75] [--q low,medium,high,ultra] [--name overlay] [--perf 1]
//
//   B1   hover a live enemy (fighter, then a wick / monster) for 180 frames: the scene's node count is the
//        same before and after (the outline hull is prebuilt; hovering only restyles it), the actor's
//        outline is at the hover width, and the console stays clean. Clean rim: with rings and bars held
//        off, the pixels the hover changes lie OUTSIDE the unit's silhouette (the hover pass' own mask,
//        eroded 2 px): ≤ 0.5 % of the silhouette may change (no interior seams, no back-face specks), and
//        the rim itself must draw ≥ 150 px. The interior share is read from the same pair rendered with the
//        post chain's SMAA off: SMAA runs after the overlay (grade.passOrder) and antialiases the rim's inner
//        edge into the body by design, up to 3 px deep through its local-contrast test (diagonals included),
//        which on a small wick is ≈ 0.3–0.6 % of the silhouette and no seam. The rim count stays as shown.
//   B2   per quality tier, a layer-only render of the telegraph pass (into an 8-bit target, alpha > 0 counted):
//        an injected enemy delayed circle (r 3 m, delay 0.6 s) must draw ≥ 5,000 px two frames in, and an own
//        rect aim (9 × 0.9 m + its range ring) ≥ 20,000 px. Fails below either threshold on any tier.
//   M10  every live, visible fighter / wick / monster carries the 1 px rest outline.
//   M6   an injected damage event flashes its victim (an enemy fighter, then an enemy wick) on the impact
//        frame and the flash is gone by 150 ms; render-only (the sim is held, so fog, a death or a wave cannot
//        take the victim away mid-envelope). Fog return: a crit, the victim out of vision for 1 s, back: no
//        flash and no squash may replay.
//   CPU  every actor outside the frustum (+ shadow reach) is culled (root hidden); every visible on-screen
//        instanced unit (UnitDef.art.instanced) is drawn by the crowd, not by a model of its own.
//   perf (--perf 1): GPU time of a full frame with outlines on vs off at the densest fight (timer query,
//        else a finish()-fenced wall clock), and the actors' animation LOD split.
// Exit 1 on any failure. Report: _harness/_reports/overlay_regress.json; shots: _harness/_shots/<name>_*.png.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, shot } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const T = Number(opt('t', 75));
const TIERS = opt('q', 'low,medium,high,ultra').split(',');
const NAME = opt('name', 'overlay');
const PERF = opt('perf', '0') === '1';
const MIN_AREA_PX = 5000, MIN_AIM_PX = 20000;

const report = { t: T, tiers: {}, b1: null, m10: null, m6: null, perf: null, failures: [] };
const fail = (m) => { report.failures.push(m); console.log('FAIL', m); };

const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=rift&q=high&t=${T}&dev=1&hud=0&manual=1`, { wait: false, hmr: false });
await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 240000 });
const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
await B((b) => b.frames(60, 1 / 30));
const errorsBefore = logs.filter((l) => /\[(error|pageerror)\]/.test(l)).length;

// ── page helpers (installed once) ─────────────────────────────────────────────────────────────────
await B((b) => {
  const R = b.renderer;
  b.__nodes = () => { let n = 0; R.scene.traverse(() => n++); return n; };
  /** layer-only render of the telegraph pass into an 8-bit target; px with alpha > 0 */
  b.__telePx = () => {
    const gl = R.gl;
    const RT = new R.overlay.teleTarget.constructor(1920, 1080);
    gl.setRenderTarget(RT); gl.setClearColor(0x000000, 0); gl.clear(true, true, false);
    const ac = gl.autoClear; gl.autoClear = false; gl.render(R.overlay.teleScene, R.rig.camera); gl.autoClear = ac; gl.setRenderTarget(null);
    const buf = new Uint8Array(1920 * 1080 * 4); gl.readRenderTargetPixels(RT, 0, 0, 1920, 1080, buf);
    let n = 0; for (let i = 3; i < buf.length; i += 4) if (buf[i] > 0) n++;
    RT.dispose();
    return n;
  };
  b.__me = () => { const v = b.host.view; const p = v.players.find((x) => x.player === 0); return v.entity(p.entity); };
  b.__actors = () => [...R.actors.values()];
});

// ── B2: telegraphs + aim on every tier ──────────────────────────────────────────────────────────────
for (const tier of TIERS) {
  const r = await B((b, tier) => {
    b.setQuality(tier);
    const R = b.renderer;
    const me = b.__me();
    b.focus(me.x, me.y); b.zoom(28.5); b.clearAim();
    R.director.telegraphs.length = 0;
    b.frames(3, 1 / 60);
    const empty = b.__telePx();
    const v = b.host.view;
    const enemy = v.entities.find((e) => e.kind === 'fighter' && e.team !== me.team);
    R.injectEvents([{ e: 'area', t: v.time, src: enemy.id, ability: 'regress', x: me.x + 2, y: me.y, shape: { kind: 'circle', radius: 3 }, delay: 0.6, telegraph: 'everyone' }]);
    b.frames(2, 1 / 60);
    const area = b.__telePx();
    const sweep = R.director.telegraphs.length;
    b.frames(60, 1 / 60);                      // landed + flash over
    R.director.telegraphs.length = 0;
    R.setAim({ shape: 'rect', x: me.x, y: me.y, dir: 0.35, length: 9, width: 0.9, range: 9, casterX: me.x, casterY: me.y });
    b.frames(2, 1 / 60);
    const aim = b.__telePx();
    b.clearAim(); b.frames(1, 1 / 60);
    return { tier: R.stats().tier, empty, area, aim, sweep, side: R.teles.mesh.material.side };
  }, tier);
  report.tiers[tier] = r;
  console.log('B2', tier, JSON.stringify(r));
  if (r.area < MIN_AREA_PX) fail(`B2 ${tier}: enemy delayed circle drew ${r.area} px (< ${MIN_AREA_PX})`);
  if (r.aim < MIN_AIM_PX) fail(`B2 ${tier}: rect aim drew ${r.aim} px (< ${MIN_AIM_PX})`);
}
await B((b) => b.setQuality('high'));

// ── B1: hover for 180 frames (enemy fighter, then a wick, then a monster) ───────────────────────────
const b1 = await B((b) => {
  const R = b.renderer;
  const me = b.__me();
  const out = [];
  // the sim is held (render only, no host pump) so the scene graph changes only if the hover changes it
  const render = (n) => { for (let i = 0; i < n; i++) R.render(1 / 60); };
  for (const kind of ['fighter', 'minion', 'monster']) {
    const a = b.__actors().find((x) => x.view && x.model && x.view.alive && x.visible && x.view.kind === kind && x.view.team !== me.team);
    if (!a) { out.push({ kind, skipped: 'none visible' }); continue; }
    b.focus(a.x, a.y); render(60);           // leaving corpses finish and late props land before counting
    const sub = () => { let n = 0; a.root.traverse(() => n++); return n; };
    const before = b.__nodes(), subBefore = sub();
    let err = null;
    b.hover(a.id);
    try { render(1); } catch (e) { err = String(e).slice(0, 160); }
    const afterFirst = b.__nodes();
    const width = a.outlineWidth;
    try { render(179); } catch (e) { err = err ?? String(e).slice(0, 160); }
    const after = b.__nodes(), subAfter = sub();
    b.hover(null); render(1);
    // clean rim: the frame with the hover vs without (time held: render(0)), rings and bars held off
    const rp = R.rings.push, bp = R.bars.push;
    R.rings.push = () => {}; R.bars.push = () => {};
    const gl = R.gl.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const grab = () => { R.render(0); R.render(0); const px = new Uint8Array(W * H * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    const off = grab();
    b.hover(a.id);
    const on = grab();
    let mask = null;
    try { const t = R.hoverRim.target; mask = new Uint8Array(t.width * t.height * 4); R.gl.readRenderTargetPixels(t, 0, 0, t.width, t.height, mask); if (t.width !== W || t.height !== H) mask = null; } catch { mask = null; }
    // the same pair without the final SMAA pass (the hover's own pixels: seams and specks show here, AA does not)
    const pq = R.post.quality;
    R.post.setQuality({ ...pq, aa: 'off' });
    const onRaw = grab();
    b.hover(null);
    const offRaw = grab();
    R.post.setQuality(pq);
    b.hover(null); R.rings.push = rp; R.bars.push = bp; render(1);
    let rim = null;
    if (mask) {
      // the mask came back as RED (1 byte per px) or RGBA: read the red channel either way
      const stride = mask.length >= W * H * 4 && mask.slice(W * H, W * H * 4).some((v) => v) ? 4 : 1;
      const inMask = (x, y) => mask[(y * W + x) * stride] > 127;
      let silhouette = 0, interior = 0, interiorAA = 0, outside = 0;
      const diff = (p, q, i) => Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]);
      for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
        const i = (y * W + x) * 4;
        const d = diff(on, off, i);
        const m = inMask(x, y);
        // eroded 2 px: the mask is the unexpanded hull, the body's own edge pixels may differ from it by one
        const deep = m && inMask(x - 2, y) && inMask(x + 2, y) && inMask(x, y - 2) && inMask(x, y + 2);
        if (deep) { silhouette++; if (diff(onRaw, offRaw, i) > 48) interior++; if (d > 48) interiorAA++; } else if (!m && d > 48) outside++;
      }
      rim = { silhouette, interior, interiorAA, outside, interiorShare: silhouette ? +(interior / silhouette).toFixed(4) : null };
    }
    out.push({ kind, id: a.id, def: a.def, crowd: !!a.crowdBake, before, afterFirst, after, subBefore, subAfter, width, restWidth: a.outlineWidth, rim, err });
  }
  return out;
});
report.b1 = b1;
console.log('B1', JSON.stringify(b1));
for (const h of b1) {
  if (h.skipped) continue;
  if (h.err) fail(`B1 ${h.kind}: ${h.err}`);
  if (h.before !== h.after || h.before !== h.afterFirst || h.subBefore !== h.subAfter) fail(`B1 ${h.kind}: scene nodes ${h.before} → ${h.afterFirst} → ${h.after} (actor ${h.subBefore} → ${h.subAfter})`);
  if (Math.abs(h.width - 2.5) > 1e-6) fail(`B1 ${h.kind}: hover outline ${h.width} px (want 2.5)`);
  if (!h.rim || !h.rim.silhouette) fail(`B1 ${h.kind}: could not read the hover silhouette mask`);
  else {
    if (h.rim.outside < 150) fail(`B1 ${h.kind}: the hover rim drew ${h.rim.outside} px outside the silhouette (< 150)`);
    if (h.rim.interiorShare > 0.005) fail(`B1 ${h.kind}: the hover changed ${h.rim.interior} px inside the silhouette (${(h.rim.interiorShare * 100).toFixed(2)} % > 0.5 %: seams or specks)`);
  }
}
if (!b1.some((h) => !h.skipped)) fail('B1: no enemy unit visible to hover');
const errorsAfter = logs.filter((l) => /\[(error|pageerror)\]/.test(l)).length;
if (errorsAfter > errorsBefore) fail(`B1: ${errorsAfter - errorsBefore} console error(s): ${logs.filter((l) => /\[(error|pageerror)\]/.test(l)).slice(-2).join(' | ').slice(0, 300)}`);

// ── M10: rest outlines on every live, visible unit ──────────────────────────────────────────────────
const m10 = await B((b) => {
  const f = b.fight(); if (f) { b.focus(f.x, f.y); b.frames(4, 1 / 60); }
  // on screen only: off-frustum actors drop their hull (it would cost vertex work for nothing)
  const R = b.renderer;
  const rows = b.__actors().filter((a) => a.view && a.model && a.visible && a.view.alive && ['fighter', 'minion', 'monster'].includes(a.view.kind) && R.worldToScreen(a.x, a.y, 1).visible);
  const missing = rows.filter((a) => a.outlineWidth !== 1).map((a) => `${a.view.kind}:${a.def}:${a.outlineWidth}`);
  // CPU: culling and the crowd on this frame
  const all = b.__actors().filter((a) => a.view && a.model && a.visible);
  const offscreenDrawn = all.filter((a) => a.root.visible && !R.worldToScreen(a.x, a.y, 1).visible && Math.hypot(a.x - R.rig.focus.x, a.y - R.rig.focus.z) > 40).map((a) => a.def);
  const crowdUnits = all.filter((a) => a.crowdBake && a.root.visible && a.view.alive && a.leaving < 0).length;
  return { units: rows.length, missing, culled: all.filter((a) => !a.root.visible).length, drawn: all.filter((a) => a.root.visible).length, offscreenDrawn, crowdUnits, crowdInstances: R.crowd.instances, crowdSets: R.crowd.setCount };
});
report.m10 = m10;
console.log('M10', JSON.stringify(m10));
if (m10.missing.length) fail(`M10: ${m10.missing.length} unit(s) without the rest outline: ${m10.missing.slice(0, 4).join(', ')}`);
if (m10.offscreenDrawn.length) fail(`CPU: ${m10.offscreenDrawn.length} actor(s) far off screen still drawn: ${m10.offscreenDrawn.slice(0, 4).join(', ')}`);
if (m10.crowdInstances < m10.crowdUnits) fail(`CPU: ${m10.crowdUnits} instanced unit(s) visible but the crowd drew ${m10.crowdInstances}`);
await shot(page, `${NAME}_fight_outlines`);

// ── M6: the victim flashes on the impact frame, gone by 150 ms; nothing replays after fog ─────────────
const m6 = await B((b) => {
  const R = b.renderer;
  const me = b.__me();
  const v = b.host.view;
  // render-only: the sim is held, so the victim cannot leave vision, die or walk off mid-envelope
  const render = (n) => { for (let i = 0; i < n; i++) R.render(1 / 60); };
  const out = [];
  for (const kind of ['fighter', 'minion']) {
    // in the viewer's vision (fog), anywhere on the map: the camera goes to it (an off-screen actor is culled)
    const a = b.__actors().find((x) => x.view && x.model && x.view.alive && x.visible && x.leaving < 0 && x.view.kind === kind && x.view.team !== me.team);
    if (!a) { out.push({ kind, skipped: 'no visible enemy' }); continue; }
    b.focus(a.x, a.y); render(12);
    if (!a.root.visible) { out.push({ kind, skipped: 'still culled after focusing on it' }); continue; }
    const rows = [];
    for (const [dtype, crit] of [['physical', false], ['magic', false], ['true', false], ['physical', true]]) {
      R.injectEvents([{ e: 'damage', t: v.time, src: me.id, dst: a.id, amount: 40, dtype, crit, shielded: 0 }]);
      render(1);
      const peak = a.flashLevel;
      render(5);               // ≈ 83 ms
      const at83 = a.flashLevel;
      render(5);               // ≈ 167 ms
      const at167 = a.flashLevel;
      rows.push({ dtype, crit, peak: +peak.toFixed(3), at83: +at83.toFixed(3), at167 });
    }
    render(12);
    // fog return: a crit, the victim out of vision for 1 s (the viewer's fog says so), then back
    R.injectEvents([{ e: 'damage', t: v.time, src: me.id, dst: a.id, amount: 400, dtype: 'physical', crit: true, shielded: 0 }]);
    render(2);
    const hit = { flash: +a.flashLevel.toFixed(3), squash: +(1 - a.model.scale.y / a.baseScale).toFixed(4) };
    const ev = R.entityVisible;
    R.entityVisible = function (e) { return e.id === a.id ? false : ev.call(this, e); };
    render(60);
    R.entityVisible = ev;
    render(1);
    const back = { flash: a.flashLevel, squash: +(1 - a.model.scale.y / a.baseScale).toFixed(4) };
    out.push({ kind, victim: a.def, crowd: !!a.crowdBake, rows, hit, back });
  }
  return out;
});
report.m6 = m6;
console.log('M6', JSON.stringify(m6));
for (const vct of m6) {
  if (vct.skipped) { if (vct.kind === 'fighter') fail(`M6: ${vct.skipped}`); continue; }
  for (const r of vct.rows) {
    if (!(r.peak > 0.3)) fail(`M6 ${vct.kind} ${r.dtype}${r.crit ? ' crit' : ''}: flash ${r.peak} on the impact frame`);
    if (r.at167 !== 0) fail(`M6 ${vct.kind} ${r.dtype}: flash still ${r.at167} at 167 ms`);
  }
  if (!(vct.hit.flash > 0.3)) fail(`M6 ${vct.kind} fog: the crit before the fog did not flash (${vct.hit.flash})`);
  if (vct.back.flash !== 0 || Math.abs(vct.back.squash) > 1e-4) fail(`M6 ${vct.kind} fog: back from 1 s out of vision still flashing ${vct.back.flash} / squashed ${vct.back.squash}`);
}

// ── perf: outline cost (GPU) and the animation LOD split ────────────────────────────────────────────
if (PERF) {
  const perf = await B(async (b) => {
    const R = b.renderer;
    const f = b.fight(); if (f) b.focus(f.x, f.y);
    // spectator zoom (44 m) so the densest fight puts as many outlined units on screen as the match has
    R.rig.spectator = true; b.zoom(44);
    b.frames(30, 1 / 60);
    const gl = R.gl.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const proto = Object.getPrototypeOf(b.__actors().find((a) => a.model));
    const orig = proto.setOutline;
    const outlined = () => b.__actors().filter((a) => a.visible && a.outlineWidth > 0 && R.worldToScreen(a.x, a.y, 1).visible).length;
    const gpuFrame = async () => {
      if (ext) {
        const q = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        b.frames(1, 0);
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        for (let i = 0; i < 200; i++) {
          await new Promise((r) => setTimeout(r, 5));
          if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
        }
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
        gl.deleteQuery(q);
        return disjoint ? null : ns / 1e6;
      }
      const px = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      b.frames(1, 0);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return performance.now() - t0;
    };
    // (1) interleaved full frames, outlines on / off, 120 samples each (trimmed mean drops the top and bottom 15 %)
    const on = [], off = [];
    let unitsOn = 0;
    const offFn = function (px, c) { return orig.call(this, 0, c, 0); };
    for (let round = 0; round < 120; round++) {
      proto.setOutline = orig; b.frames(1, 0);
      unitsOn = Math.max(unitsOn, outlined());
      const a1 = await gpuFrame(); if (a1 !== null) on.push(a1);
      proto.setOutline = offFn; b.frames(1, 0);
      const a2 = await gpuFrame(); if (a2 !== null) off.push(a2);
    }
    proto.setOutline = orig;
    b.frames(1, 0);
    // (2) the outline pass alone, on top of the real scene: the full scene renders into a 1080p target first
    // (its depth rejects the hulls' hidden back faces, as in the real frame), then only the outline meshes
    // (layer 5) render into it under a timer query: the cost the outlines add to a frame
    let hullOnly = null;
    if (ext) {
      const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
      const hulls = [];
      // per-actor hulls and the crowd's instanced outline draws (one per crowd set)
      R.scene.traverse((o) => { if ((o.name === 'vale_outline' || o.name === 'crowd_outline') && shown(o)) hulls.push(o); });
      for (const h of hulls) h.layers.enable(5);
      const cam = R.rig.camera, mask = cam.layers.mask;
      const RT = new R.overlay.teleTarget.constructor(1920, 1080, { depthBuffer: true, type: 1016 /* HalfFloatType */ });
      const g = R.gl;
      const samples = [], base = [];
      for (let i = 0; i < 40; i++) {
        g.setRenderTarget(RT); g.clear(true, true, false);
        const ac = g.autoClear; g.autoClear = false;
        const q0 = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q0);
        g.render(R.scene, cam);                         // the scene, hulls included…
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        cam.layers.set(5);
        const q = gl.createQuery();
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        g.render(R.scene, cam);                         // …then the hulls once more on its depth: their cost alone
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        cam.layers.mask = mask;
        g.autoClear = ac;
        g.setRenderTarget(null);
        for (let k = 0; k < 200; k++) { await new Promise((r) => setTimeout(r, 5)); if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break; }
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) { samples.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6); base.push(gl.getQueryParameter(q0, gl.QUERY_RESULT) / 1e6); }
        gl.deleteQuery(q); gl.deleteQuery(q0);
      }
      for (const h of hulls) h.layers.disable(5);
      RT.dispose();
      const m = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
      const p10 = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.1)];
      // on a shared GPU the median carries other processes' work; the low percentiles are the outlines' own cost
      hullOnly = { hullDraws: hulls.length, outlineMedianMs: m(samples), outlineP10Ms: p10(samples), outlineMinMs: Math.min(...samples), sceneMedianMs: m(base), sceneP10Ms: p10(base), samples: samples.length };
    }
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
    const trim = (a) => { const s = [...a].sort((x, y) => x - y); const k = Math.floor(s.length * 0.15); const t = s.slice(k, s.length - k); return t.length ? t.reduce((x, y) => x + y, 0) / t.length : null; };
    // animation LOD split this frame
    const cam = R.rig.camera;
    const st = R.stats();
    return {
      method: ext ? 'EXT_disjoint_timer_query_webgl2' : 'finish-fenced wall clock (CPU + GPU)',
      outlinedUnits: unitsOn, actors: st.actors, calls: st.sceneCalls, tris: st.sceneTriangles,
      onMedianMs: med(on), offMedianMs: med(off), onTrimMs: trim(on), offTrimMs: trim(off),
      deltaMedianMs: med(on) !== null && med(off) !== null ? med(on) - med(off) : null,
      deltaTrimMs: trim(on) !== null && trim(off) !== null ? trim(on) - trim(off) : null,
      hullOnly, samples: [on.length, off.length], camDistance: cam.position.distanceTo(R.rig.focus),
      drawnActors: b.__actors().filter((a) => a.root.visible).length, culledActors: b.__actors().filter((a) => a.visible && !a.root.visible).length,
      crowdInstances: R.crowd.instances, crowdSets: R.crowd.setCount,
    };
  });
  report.perf = perf;
  console.log('PERF', JSON.stringify(perf));
}

mkdirSync(join(HERE, '_reports'), { recursive: true });
writeFileSync(join(HERE, '_reports', 'overlay_regress.json'), JSON.stringify(report, null, 1));
await browser.close();
console.log(report.failures.length ? `overlay_regress: ${report.failures.length} FAILURE(S)` : 'overlay_regress: PASS');
process.exit(report.failures.length ? 1 : 0);
