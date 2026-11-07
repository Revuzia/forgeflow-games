// VALE harness — lane GE: same-page A/B frames of the world at the real game camera (28.5 m, 1080p), on a real match
// frame from the render bench. The sim is held, VFX and UI are off, the fog of war is off, so the only thing that differs
// between A and B is the switch under test: a shader uniform set live on the world materials (no second build, no second
// page, so another lane's edit or a load spike cannot leak into the comparison).
//
//   node _harness/gfx_ge_frames.mjs --tag base [--maps rift,bridge,fray] [--q high] [--t 75] [--seed 7] [--spots lane0,centre]
//   node _harness/gfx_ge_frames.mjs --tag ge1 --uniform uGeGround --a 0 --b 1 [--tele 1] [--gpu 1]
//
// Per spot: <out>/<map>_<q>_<spot>[_a|_b].png, and in the report the central-block high-pass luma std (luma minus its 9x9
// box mean, shot_lane's "ground hp"), frame luma p5 / p50 / p95 / p99, and with --tele the telegraph read: over the pixels
// the bench's telegraph set changes by >= 6 (their footprint), the ground's own high-pass with the telegraphs off, and the
// telegraph's mean luma delta over it (the ratio is how far the telegraph stands clear of the stone).
// --gpu 1: the switch's GPU cost, A and B alternating 8 times in the same page (timer query, p25 of 60 frames each, so another lane's load spike does not set it; ms per frame), with
// the load average beside it. Out: _harness/_shots/gfx_ge/<tag>/, report: _harness/_reports/gfx_ge_<tag>.json

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const TAG = opt('tag', 'run'), MAPS = opt('maps', 'rift,bridge,fray').split(','), Q = opt('q', 'high');
const T = Number(opt('t', 75)), SEED = Number(opt('seed', 7)), UNI = opt('uniform', ''), VA = Number(opt('a', 0)), VB = Number(opt('b', 1));
const TELE = opt('tele', '0') === '1', GPU = opt('gpu', '0') === '1', ONLY = opt('spots', '');
const OUT = join(HERE, '_shots', 'gfx_ge', TAG);
mkdirSync(OUT, { recursive: true });

function install() {
  const b = window.__VALE_BENCH__, R = b.renderer;
  const fx = R.vfx.screen.fx;
  R.vfx.draw = () => {}; R.vfx.group.visible = false; R.vfx.clear(); fx.setDead = () => {}; fx.reset();
  R.fog.enabled = false;
  const ctx = R.gl.getContext();
  const grab = () => {
    const w = ctx.drawingBufferWidth, h = ctx.drawingBufferHeight;
    R.gl.setRenderTarget(null);
    const buf = new Uint8Array(w * h * 4);
    ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
    const L = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) L[i] = 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];
    return { w, h, L };
  };
  const hpField = ({ w, h, L }) => {
    const r = 4, I = new Float64Array((w + 1) * (h + 1)), H = new Float32Array(w * h);
    for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) { s += L[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + s; } }
    for (let y = r; y < h - r - 1; y++) for (let x = r; x < w - r - 1; x++) {
      const x0 = x - r, x1 = x + r + 1, y0 = y - r, y1 = y + r + 1;
      H[y * w + x] = L[y * w + x] - (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((2 * r + 1) ** 2);
    }
    return H;
  };
  const stats = (f) => {
    const { w, h, L } = f, H = hpField(f);
    let n = 0, s2 = 0, sm = 0;
    for (let y = Math.floor(h * 0.25); y < Math.floor(h * 0.75); y++) for (let x = Math.floor(w * 0.25); x < Math.floor(w * 0.75); x++) { const d = H[y * w + x]; s2 += d * d; sm += L[y * w + x]; n++; }
    const so = Float32Array.from(L).sort();
    const pc = (p) => +so[Math.floor(p * (so.length - 1))].toFixed(1);
    return { hp: +Math.sqrt(s2 / n).toFixed(2), mean: +(sm / n).toFixed(1), p5: pc(0.05), p50: pc(0.5), p95: pc(0.95), p99: pc(0.99) };
  };
  const mats = () => {
    const out = new Set();
    R.scene.traverse((o) => { if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) out.add(m); });
    return [...out];
  };
  window.__GE__ = {
    /** set a uniform on every world material that declares it: returns how many */
    set: (name, v) => {
      let n = 0;
      for (const m of mats()) { const u = R.gl.properties.get(m)?.uniforms?.[name]; if (u) { u.value = v; n++; } }
      return n;
    },
    at: (x, y) => { b.focus(x, y); b.zoom(28.5); R.director.telegraphs.length = 0; b.clearAim(); for (let i = 0; i < 90; i++) R.render(1 / 60); return stats(grab()); },   // 90: the camera has settled, A and B frame the same pixels
    tele: (x, y) => {
      b.focus(x, y); b.zoom(28.5); R.director.telegraphs.length = 0; b.clearAim();
      for (let i = 0; i < 40; i++) R.render(1 / 60);
      const off = grab(), H = hpField(off);
      b.telegraphTest(x, y);
      for (let i = 0; i < 18; i++) R.render(1 / 60);
      const on = grab();
      let n = 0, s = 0, s2 = 0;
      for (let i = 0; i < on.L.length; i++) { const d = Math.abs(on.L[i] - off.L[i]); if (d >= 6) { n++; s += d; s2 += H[i] * H[i]; } }
      R.director.telegraphs.length = 0; b.clearAim();
      const hp = n ? Math.sqrt(s2 / n) : 0, delta = n ? s / n : 0;
      return { footprintHp: +hp.toFixed(2), telePx: n, teleDelta: +delta.toFixed(1), ratio: +(delta / Math.max(0.1, hp)).toFixed(2) };
    },
  };
  return true;
}

const report = { tool: '_harness/gfx_ge_frames.mjs', tag: TAG, q: Q, t: T, seed: SEED, uniform: UNI || null, a: VA, b: VB, generated: new Date().toISOString(), load: loadavg().map((x) => +x.toFixed(2)), maps: {} };
const [W, H] = Q === 'low' ? [1280, 720] : [1920, 1080];
for (const map of MAPS) {
  const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=${map}&q=${Q}&t=${T}&seed=${SEED}&dev=1&hud=0&manual=1`, { wait: false, hmr: false, width: W, height: H });
  try {
    await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 240000 });
    const B = (f, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [f.toString(), a]);
    await B((b) => b.frames(60, 1 / 30));
    await page.waitForTimeout(6000);
    await B((b) => b.frames(6, 1 / 30));
    await page.evaluate(`(${install.toString()})()`);
    const spots = await B((b) => {
      const m = b.catalog.maps.find((x) => x.id === b.host.setup.map), [SX, SY] = m.size, s = {};
      const along = (path, f) => {
        let L = 0; for (let i = 1; i < path.length; i++) L += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
        let d = L * f;
        for (let i = 1; i < path.length; i++) { const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); if (d <= l) { const t = d / l; return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t]; } d -= l; }
        return path[path.length - 1];
      };
      m.lanes.forEach((l, i) => { s[`lane${i}`] = along(l.path, 0.3); });
      if (m.lanes.length === 1) s.lane_mid = along(m.lanes[0].path, 0.5);
      if (m.lanes.length >= 3) { s.jungle = [SX * 0.33, SY * 0.28]; s.jungle2 = [SX * 0.62, SY * 0.7]; }
      s.centre = [SX / 2, SY / 2];
      if (!m.lanes.length) { s.north = [SX / 2, SY * 0.3]; s.rim = [SX / 2, SY * 0.1]; s.rim2 = [SX * 0.13, SY * 0.5]; }
      const st = m.structures?.[0]; if (st) s.tower = [st.at[0] + 1, st.at[1] + 2];
      const base = m.bases?.[0]; if (base && Array.isArray(base.spawn)) s.base = [base.spawn[0] + 6, base.spawn[1]];
      return s;
    });
    const want = ONLY ? Object.entries(spots).filter(([k]) => ONLY.split(',').includes(k)) : Object.entries(spots);
    const G = (f, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__GE__, x), [f.toString(), a]);
    // prototype: hand the ground a baked map from disk (no content build), stored as the shipped asset is (sRGB, v = map y)
    const CONTACT = opt(`contact-${map}`, '');
    if (CONTACT) {
      const url = `data:image/png;base64,${readFileSync(CONTACT).toString('base64')}`;
      await page.evaluate(async ([u]) => {
        const G = window.__GE__, R = window.__VALE_BENCH__.renderer;
        const im = await createImageBitmap(await (await fetch(u)).blob(), { imageOrientation: 'flipY' });
        const c = new OffscreenCanvas(im.width, im.height), x = c.getContext('2d'); x.drawImage(im, 0, 0);
        const px = x.getImageData(0, 0, im.width, im.height).data;
        let ground; R.scene.traverse((o) => { if (o.name === 'vale_ground') ground = o; });
        const U = R.gl.properties.get(ground.material).uniforms, DT = U.uGeTile.value.constructor;
        const t = new DT(new Uint8Array(px.buffer.slice(0)), im.width, im.height);
        t.colorSpace = 'srgb'; t.magFilter = t.minFilter = 1006; t.generateMipmaps = false; t.needsUpdate = true;
        U.uTexContact.value = t;
      }, [url]);
    }
    const out = (report.maps[map] = { spots: Object.fromEntries(want), frames: {} });
    for (const [k, xy] of want) {
      const row = (out.frames[k] = {});
      const variants = UNI ? [['a', VA], ['b', VB]] : [['', null]];
      for (const [sfx, v] of variants) {
        if (v !== null) out.uniformHits = await G((g, a) => g.set(a[0], a[1]), [UNI, v]);
        const s = await G((g, a) => g.at(a[0], a[1]), xy);
        await page.screenshot({ path: join(OUT, `${map}_${Q}_${k}${sfx ? `_${sfx}` : ''}.png`) });
        if (TELE) s.tele = await G((g, a) => g.tele(a[0], a[1]), xy);
        row[sfx || 'base'] = s;
      }
      console.log(map, k, JSON.stringify(row));
    }
    if (GPU && UNI) {
      out.gpu = await page.evaluate(async ([uni, a, b]) => {
        const G = window.__GE__, B = window.__VALE_BENCH__;
        const q = (v) => new Promise((res) => {
          G.set(uni, v);
          const gl = B.renderer.gl.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
          if (!ext) return res(null);
          const times = []; let i = 0;
          const step = () => {
            const qq = gl.createQuery();
            gl.beginQuery(ext.TIME_ELAPSED_EXT, qq);
            B.renderer.render(1 / 60);
            gl.endQuery(ext.TIME_ELAPSED_EXT);
            const poll = () => {
              if (gl.getQueryParameter(qq, gl.QUERY_RESULT_AVAILABLE)) { times.push(gl.getQueryParameter(qq, gl.QUERY_RESULT) / 1e6); gl.deleteQuery(qq); if (++i < 60) requestAnimationFrame(step); else { times.sort((x, y) => x - y); res(+times[times.length >> 2].toFixed(2)); } } else requestAnimationFrame(poll);
            };
            requestAnimationFrame(poll);
          };
          step();
        });
        const seq = [...Array(8).keys()].map((i) => (i % 2 ? ['b', b] : ['a', a])), outp = [];
        for (const [k, v] of seq) outp.push([k, await q(v)]);
        return outp;
      }, [UNI, VA, VB]);
      out.gpuLoad = loadavg().map((x) => +x.toFixed(2));
      console.log(map, 'gpu ms (p25 of 60 frames, a b alternating)', JSON.stringify(out.gpu), 'load', out.gpuLoad.join(' '));
    }
    out.logs = logs.filter((l) => !/favicon|toNonIndexed/.test(l)).slice(0, 6);
  } finally {
    await browser.close();
  }
  writeFileSync(join(HERE, '_reports', `gfx_ge_${TAG}.json`), JSON.stringify(report, null, 1));
}
console.log('report', join(HERE, '_reports', `gfx_ge_${TAG}.json`));
