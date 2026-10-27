// VALE harness — ambient life (r12 M14): the real client (render bench, real map, real post chain) at the gameplay
// camera, VFX hidden (the ambient layer is world, not VFX), fog of war off for the value reads.
//
//   per map and tier:
//     · the T0 value law, layer-only (as r12 §1.1's telegraph probe): the effects, the critters and the props each drawn
//       ALONE (every other world object hidden, lit as in play, over black, through the post chain and the grade): the
//       effects' own on-screen L* MAX must stay <= 60 (tokens vfx.tiers.T0: every pixel, not a percentile); the critters
//       and the props (scenery) p95 <= 60 and max <= 72 (luma 180, r12 B5's environment cap); p50 / p99 reported. In
//       situ: the share of the frame the layer changes (ambientEffects ON vs OFF at one clock; props stay: they are
//       scenery), and the lamp flames in play (effects ON vs OFF at a lamp spot, critters hidden: the flame over its
//       own ground): p99 <= 60 (the flame band, r12 M14: L* 55-60)
//     · determinism: the frame at T, T + 1.25 s and T again (dt 0): 0 px may differ on return (particles are pure
//       functions of the clock; the critters only move with dt)
//     · the toggle: OFF draws no ambient particle and no critter (stats().ambient)
//     · canopy motes on screen (RIFT, a sweep of jungle spots): <= 30
//     · flee: a VISIBLE enemy (a presentation-only view patch, as shot_foliage.mjs) set 1.5 m from a resting critter:
//       it takes off within 0.5 s; the same enemy OUT of the viewer's vision: the critter never takes off (no leak;
//       its own idle hops go on)
//     · cost: renderer.stats().ambient.ms (the layer's own CPU time per frame, EMA) and a direct mean / p95 of
//       AmbientLayer.update over 240 frames with the match running, plus the draw calls ON vs OFF
//   shots (into --dir, default _harness/_shots/ambient): ambient_<map>_<q>.png (+ _off), ambient_<map>_<q>_<spot>.png
//   --canon 1 copies the High shot of each map's canonical spot to _harness/_shots/ambient_<map>.png
//
//   node _harness/shot_ambient.mjs [--maps rift,bridge,fray] [--q high,low] [--canon 0] [--dir <dir>] [--report <json>]
// VALE_URL picks the dev server (default http://localhost:5190). Exit 1 when a check fails.

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const MAPS = opt('maps', 'rift,bridge,fray').split(',');
const QS = opt('q', 'high,low').split(',');
const DIR = opt('dir', join(HERE, '_shots', 'ambient'));
const CANON = opt('canon', '0') === '1';
const REPORT = opt('report', join(HERE, '_reports', 'ambient.json'));
const RES = { high: [1920, 1080], low: [1280, 720], medium: [1920, 1080], ultra: [1920, 1080] };
mkdirSync(DIR, { recursive: true });

/** each map's canonical spot (a stretch of its ambient life at the gameplay camera) and a few more */
const SPOTS = {
  rift: { canon: [85.0, 70.0], more: { base: [23.0, 47.5], wood: [44.0, 64.0], shrine: [85.0, 9.0] }, sweep: [[48, 62], [62, 48], [40, 30], [122, 62], [108, 80], [130, 40], [60, 90], [85, 20]], flame: [23.0, 47.5] },
  bridge: { canon: [100.0, 15.0], more: { snap: [78.0, 20.0], gate: [150.0, 22.0], south: [40.0, 30.0] }, sweep: [], flame: [150.0, 22.0] },
  fray: { canon: [10.0, 11.0], more: { rim: [32.0, 8.0], corner: [56.0, 54.0] }, sweep: [], flame: [56.0, 54.0] },
};

function install() {
  const b = window.__VALE_BENCH__, R = b.renderer, host = b.host, gl = R.gl, ctx = gl.getContext();
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
  R.vfx.draw = () => {}; R.vfx.group.visible = false; R.vfx.clear();
  R.fog.enabled = false;
  const setAmb = (on) => { R.ambientOn = on; R.ambient?.configure(on, R.q.tier); };
  const settle = (n, dt = 1 / 30) => { for (let i = 0; i < n; i++) { host.pump(dt); R.render(dt); } };
  const read = () => {
    const w = gl.domElement.width, h = gl.domElement.height;
    const buf = new Uint8Array(w * h * 4);
    ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
    return { w, h, buf };
  };
  const lstar = (r, g, bb) => {
    const L = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const Y = 0.2126 * L(r) + 0.7152 * L(g) + 0.0722 * L(bb);
    return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;
  };
  const pct = (a, k) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * k))] : null);
  /** pixels of `on` that differ from `off` (sum |d| > 6): their L* in `on` */
  const diffL = (on, off) => {
    const ls = []; let n = 0;
    for (let i = 0; i < on.buf.length; i += 4) {
      const d = Math.abs(on.buf[i] - off.buf[i]) + Math.abs(on.buf[i + 1] - off.buf[i + 1]) + Math.abs(on.buf[i + 2] - off.buf[i + 2]);
      if (d > 6) { n++; ls.push(lstar(on.buf[i], on.buf[i + 1], on.buf[i + 2])); }
    }
    ls.sort((a, c) => a - c);
    const r1 = (x) => (x === null ? null : Math.round(x * 10) / 10);
    return { px: n, share: +(n / (on.buf.length / 4) * 100).toFixed(3), p50: r1(pct(ls, 0.5)), p95: r1(pct(ls, 0.95)), p99: r1(pct(ls, 0.99)), max: r1(ls.length ? ls[ls.length - 1] : null) };
  };
  const same = (a, c) => { let n = 0; for (let i = 0; i < a.buf.length; i += 4) if (a.buf[i] !== c.buf[i] || a.buf[i + 1] !== c.buf[i + 1] || a.buf[i + 2] !== c.buf[i + 2]) n++; return n; };
  const at = (T) => { R.time = T; R.render(0); R.time = T; R.render(0); };
  const propMeshes = () => (R.ambient?.group.children ?? []).filter((o) => o.name === 'vale_ambient_props');
  const api = {
    focus: (x, y) => { b.focus(x, y); b.zoom(28.5); settle(45); },
    stats: () => R.stats().ambient,
    settle,
    /** the value law (layer-only renders: each part of the ambient layer alone, lit as in play, over black, through
     *  the post chain: its own on-screen L*) + determinism + the toggle at the current spot */
    reads: () => {
      settle(6);
      const T0 = R.time;
      setAmb(true); at(T0); const on = read(); const sOn = R.stats().ambient;
      const callsOn = R.stats().sceneCalls;
      setAmb(false); at(T0); const off = read(); const sOff = R.stats().ambient;
      const callsOff = R.stats().sceneCalls;
      setAmb(true); at(T0);
      const inSitu = diffL(on, off);
      // determinism: T, T + 1.25, T
      at(T0 + 1.25); const later = read(); at(T0); const back = read();
      // layer-only: hide every world object but the lights and the ambient layer; keep one part of the layer
      const layer = (which) => {
        // the frame's own update re-shows actors and critters, so the hiding happens right before the post chain draws
        const pr = R.post.render.bind(R.post);
        R.post.render = (d) => {
          const hid = [];
          for (const o of R.scene.children) {
            if (o === R.ambient.group || o.isLight || o === R.sun?.target) continue;
            if (o.visible) { o.visible = false; hid.push(o); }
          }
          const kids = R.ambient.group.children, was = kids.map((k) => k.visible);
          kids.forEach((k) => {
            const kind = k.name === 'vale_ambient_particles' ? 'effects' : k.name === 'vale_ambient_props' ? 'props' : 'critters';
            k.visible = k.visible && kind === which;
            if (kind === 'props') k.castShadow = false;
          });
          const bg = R.scene.background; R.scene.background = null;
          const od = R.overlay.draw; R.overlay.draw = () => {};              // bars, rings, telegraphs: not ambient
          try { pr(d); } finally {
            R.overlay.draw = od; R.scene.background = bg;
            kids.forEach((k, i) => { k.visible = was[i]; if (k.name === 'vale_ambient_props') k.castShadow = true; });
            for (const o of hid) o.visible = true;
          }
        };
        at(T0); const img = read();
        R.post.render = pr;
        // the part's own pixels: anything not black
        const ls = []; let n = 0;
        for (let i = 0; i < img.buf.length; i += 4) {
          if (img.buf[i] + img.buf[i + 1] + img.buf[i + 2] <= 6) continue;
          n++; ls.push(lstar(img.buf[i], img.buf[i + 1], img.buf[i + 2]));
        }
        ls.sort((a, c) => a - c);
        const r1 = (x) => (x === null ? null : Math.round(x * 10) / 10);
        return { px: n, p50: r1(pct(ls, 0.5)), p95: r1(pct(ls, 0.95)), p99: r1(pct(ls, 0.99)), max: r1(ls.length ? ls[ls.length - 1] : null) };
      };
      const own = { effects: layer('effects'), critters: layer('critters'), props: layer('props') };
      at(T0);
      return {
        inSitu, own, movedPx: same(on, later), returnPx: same(on, back),
        on: { particles: sOn.particles, critters: sOn.crittersDrawn, onScreen: sOn.onScreen, calls: callsOn },
        off: { particles: sOff.particles, critters: sOff.crittersDrawn, calls: callsOff },
      };
    },
    /** the lamp flames in play: effects ON vs OFF at one clock with the critters hidden (the flame over its own ground) */
    flame: () => {
      settle(6);
      const T0 = R.time;
      const crit = () => (R.ambient?.group.children ?? []).filter((o) => o.name !== 'vale_ambient_particles' && o.name !== 'vale_ambient_props');
      const pr = R.post.render.bind(R.post);
      R.post.render = (d) => { const cs = crit(), was = cs.map((k) => k.visible); cs.forEach((k) => { k.visible = false; }); try { pr(d); } finally { cs.forEach((k, i) => { k.visible = was[i]; }); } };
      try {
        setAmb(true); at(T0); const on = read();
        setAmb(false); at(T0); const off = read();
        setAmb(true); at(T0);
        return diffL(on, off);
      } finally { R.post.render = pr; }
    },
    /** cost: AmbientLayer.update timed directly over n frames with the match running */
    cost: (n = 240) => {
      const amb = R.ambient; const orig = amb.update.bind(amb); const ts = [];
      amb.update = (...a) => { const t0 = performance.now(); orig(...a); ts.push(performance.now() - t0); };
      settle(n, 1 / 60);
      amb.update = orig;
      ts.sort((a, c) => a - c);
      const mean = ts.reduce((s, x) => s + x, 0) / ts.length;
      return { frames: ts.length, meanMs: +mean.toFixed(4), p95Ms: +pct(ts, 0.95).toFixed(4), maxMs: +ts[ts.length - 1].toFixed(4), emaMs: R.stats().ambient.ms };
    },
    /** flee: a visible enemy 1.5 m from a resting, on-screen critter; then the same with the enemy out of vision */
    flee: () => {
      const me = b.you();
      const enemy = host.view.entities.find((e) => e.kind === 'fighter' && e.team !== me.team && e.alive);
      const crit = () => R.ambient.critterStates();
      const pick = crit().findIndex((c) => c.visible && c.state === 'idle');
      if (!enemy || pick < 0) return { skipped: !enemy ? 'no enemy fighter' : 'no resting critter on screen' };
      const c0 = crit()[pick];
      const runCase = (mask) => {
        over.clear();
        over.set(enemy.id, { x: c0.x + 1.5, y: c0.y, mask });
        let took = null; const t0 = R.time;
        for (let i = 0; i < 30; i++) { host.pump(1 / 30); R.render(1 / 30); const s = crit()[pick]; if (took === null && s.state !== 'idle') took = +(R.time - t0).toFixed(3); }
        const s = crit()[pick];
        over.clear();
        return { tookOffS: took, state: s.state, moved: +Math.hypot(s.x - c0.x, s.y - c0.y).toFixed(2) };
      };
      // the leak case first (the critter must not move at all), then the visible one
      const hidden = runCase(0);
      const visible = runCase(0xff);
      return { critter: c0.id, at: [+c0.x.toFixed(1), +c0.y.toFixed(1)], hidden, visible };
    },
    /** canopy motes on screen (max over spots) */
    sweep: (spots) => {
      let worst = 0; const per = [];
      for (const [x, y] of spots) { b.focus(x, y); b.zoom(28.5); settle(4); const n = R.stats().ambient.onScreen; const k = Object.entries(n).filter(([id]) => /canopy/.test(id)).reduce((s, [, v]) => s + v, 0); per.push(k); worst = Math.max(worst, k); }
      return { worst, per };
    },
  };
  window.__AMB__ = api;
  return { ok: true };
}

const out = { at: new Date().toISOString(), maps: {} };
let fail = 0;
const check = (cond, msg) => { if (!cond) { fail++; console.log(`  FAIL ${msg}`); } };
for (const map of MAPS) {
  out.maps[map] = {};
  for (const q of QS) {
    const [W, H] = RES[q] ?? RES.high;
    const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=${map}&q=${q}&t=20&dev=1&hud=0&manual=1`, { wait: false, width: W, height: H, hmr: false });
    await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 180000 });
    const err = await page.evaluate(() => window.__VALE_BENCH__?.error);
    if (err) { console.error(map, q, err); fail++; await browser.close(); continue; }
    await page.evaluate(() => window.__VALE_BENCH__.frames(30, 1 / 30));
    await new Promise((r) => setTimeout(r, 7000));                      // props, critters and landmarks land in real time
    await page.evaluate(`(${install.toString()})()`);
    const F = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__AMB__, x), [fn.toString(), a]);
    const S = SPOTS[map];
    const res = {};
    await F((f, p) => f.focus(p[0], p[1]), S.canon);
    res.reads = await F((f) => f.reads());
    const name = (s) => join(DIR, `ambient_${map}_${q}${s}.png`);
    await page.screenshot({ path: name('') });
    await page.evaluate(() => { const R = window.__VALE_BENCH__.renderer; R.ambientOn = false; R.ambient.configure(false, R.q.tier); R.render(0); });
    await page.screenshot({ path: name('_off') });
    await page.evaluate(() => { const R = window.__VALE_BENCH__.renderer; R.ambientOn = true; R.ambient.configure(true, R.q.tier); R.render(0); });
    if (CANON && q === 'high') copyFileSync(name(''), join(HERE, '_shots', `ambient_${map}.png`));
    for (const [k, p] of Object.entries(S.more)) { await F((f, pp) => f.focus(pp[0], pp[1]), p); await page.screenshot({ path: name(`_${k}`) }); }
    res.flee = await F((f, p) => { f.focus(p[0], p[1]); return f.flee(); }, S.canon);
    if (res.flee.skipped && S.more) for (const p of Object.values(S.more)) { if (!res.flee.skipped) break; res.flee = await F((f, pp) => { f.focus(pp[0], pp[1]); return f.flee(); }, p); }
    if (S.sweep.length) res.sweep = await F((f, s) => f.sweep(s), S.sweep);
    if (S.flame) res.flame = await F((f, p) => { f.focus(p[0], p[1]); return f.flame(); }, S.flame);
    await F((f, p) => f.focus(p[0], p[1]), S.canon);
    res.cost = await F((f) => f.cost(240));
    res.logs = logs.filter((l) => !/404|toNonIndexed/.test(l)).slice(0, 6);
    out.maps[map][q] = res;
    const r = res.reads;
    const o = r.own, fmt = (x) => `${x.px} px L* p95 ${x.p95} p99 ${x.p99} max ${x.max}`;
    console.log(`${map} ${q}: own L* · effects ${fmt(o.effects)} · critters ${fmt(o.critters)} · props ${fmt(o.props)}`);
    console.log(`  in situ ${r.inSitu.share} % of the frame · moved ${r.movedPx} return ${r.returnPx} · on ${r.on.particles}p/${r.on.critters}c (${r.on.calls} calls) off ${r.off.particles}p/${r.off.critters}c (${r.off.calls} calls)`);
    console.log(`  flee ${JSON.stringify(res.flee)}${res.sweep ? `  motes on screen ${JSON.stringify(res.sweep)}` : ''}`);
    if (res.flame) console.log(`  lamp flames in play: ${res.flame.px} px L* p95 ${res.flame.p95} p99 ${res.flame.p99} max ${res.flame.max}`);
    console.log(`  cost ${JSON.stringify(res.cost)}`);
    check(o.effects.max === null || o.effects.max <= 60, `${map} ${q}: ambient effects own L* max ${o.effects.max} > 60 (T0)`);
    for (const k of ['critters', 'props']) {
      check(o[k].p95 === null || o[k].p95 <= 60, `${map} ${q}: ambient ${k} own L* p95 ${o[k].p95} > 60`);
      check(o[k].max === null || o[k].max <= 72, `${map} ${q}: ambient ${k} own L* max ${o[k].max} > 72 (luma 180, B5)`);
    }
    if (res.flame && res.flame.px) check(res.flame.p99 <= 60, `${map} ${q}: lamp flames in play L* p99 ${res.flame.p99} > 60 (flame band 55-60)`);
    check(r.returnPx === 0, `${map} ${q}: the frame did not return bit-exact to its clock (${r.returnPx} px)`);
    check(r.off.particles === 0 && r.off.critters === 0, `${map} ${q}: ambientEffects off still draws ${r.off.particles} particles / ${r.off.critters} critters`);
    if (!res.flee.skipped) {
      check(res.flee.hidden.tookOffS === null && res.flee.hidden.state === 'idle', `${map} ${q}: a critter reacted to an enemy the viewer cannot see (${JSON.stringify(res.flee.hidden)})`);
      check(res.flee.visible.tookOffS !== null && res.flee.visible.tookOffS <= 0.5, `${map} ${q}: a critter did not take off from a visible enemy within 0.5 s (${JSON.stringify(res.flee.visible)})`);
    }
    if (res.sweep) check(res.sweep.worst <= 30, `${map} ${q}: ${res.sweep.worst} canopy motes on screen (> 30)`);
    if (q === 'high') check(res.cost.meanMs <= 0.3, `${map} ${q}: ambient update ${res.cost.meanMs} ms > 0.3 ms`);
    await browser.close();
  }
}
mkdirSync(dirname(REPORT), { recursive: true });
writeFileSync(REPORT, JSON.stringify(out, null, 1));
console.log(`report ${REPORT}${fail ? ` · ${fail} FAIL` : ' · all checks pass'}`);
process.exit(fail ? 1 : 0);
