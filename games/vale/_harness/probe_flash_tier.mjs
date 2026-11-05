// VALE harness — CW1 r2 refix 1 (handoff:CW4:landmarks, B5 flash): why a T4 landing peaks lower on Low than on High.
// value_probe's flash test (the same disc mean over the same injected Domefall, the same 48 frames) repeated on one page per
// variant, so one render-tier difference is measured at a time:
//   asis          the tier as it stands
//   bloom         post.setQuality with the bloom flipped
//   density       the particle density of High (1)
//   lights        the flash-light pool of High (4)
//   gain=<l>/<f>  PostChain.setBloomStandIn: the gains on an envelope's lift and on the effects' light (post.ts NO_BLOOM_*)
//   node _harness/probe_flash_tier.mjs [--map bridge] [--tier low] [--variants asis,bloom,density,lights] [--t 75] [--seed 7] [--out <json>]
import { writeFileSync } from 'node:fs';
import { open } from './pw.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const MAP = opt('map', 'bridge'), TIER = opt('tier', 'low'), T = +opt('t', 75), SEED = +opt('seed', 7), OUT = opt('out', '');
const VARIANTS = opt('variants', 'asis,bloom,density,lights').split(',');
const RES = { low: [1280, 720] }; const [w, h] = RES[TIER] ?? [1920, 1080];
const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=${MAP}&q=${TIER}&t=${T}&seed=${SEED}&dev=1&hud=0&manual=1`, { wait: false, hmr: false, width: w, height: h });
await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 180000 });
const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
await B((b) => b.frames(60, 1 / 30));
await page.waitForTimeout(5000);
await B((b) => b.frames(6, 1 / 30));
const rows = {};
for (const v of VARIANTS) {
  rows[v] = await B(async (b, v) => {
    const R = b.renderer, gl = R.gl, ctx = gl.getContext(), fx = R.vfx.screen.fx, D = R.director;
    const q0 = { ...R.post.quality }, dens0 = R.vfx.density, lights0 = R.vfx.lights.length;
    const [name, val] = v.split('=');
    if (name === 'bloom') R.post.setQuality({ ...q0, bloom: !q0.bloom });
    if (name === 'density') R.vfx.density = 1;
    if (name === 'lights') R.vfx.setLightCount(4);
    if (name === 'gain') { const [lift, fx] = val.split('/').map(Number); R.post.setBloomStandIn({ lift, fx }); }
    for (const k of ['beats', 'lastPulse', 'pulseQ', 'castAt']) D[k]?.clear?.();
    const overlay0 = R.overlay.draw; R.overlay.draw = () => {};
    const fog0 = R.fog.enabled; R.fog.enabled = false;
    const render = (n) => { for (let i = 0; i < n; i++) R.render(1 / 60); };
    const me = b.you();
    b.focus(me.x, me.y); b.zoom(28.5);
    R.vfx.clear(); fx.reset();
    render(12);
    const disc = (x, y, r) => {
      const W = gl.domElement.width, H = gl.domElement.height;
      gl.setRenderTarget(null);
      const buf = new Uint8Array(W * H * 4); ctx.readPixels(0, 0, W, H, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
      const sx = W / R.cssW, pts = [];
      for (let k = 0; k < 32; k++) { const a = (k / 32) * Math.PI * 2; const p = R.worldToScreen(x + Math.cos(a) * r, y + Math.sin(a) * r, 0); pts.push([p.x * sx, p.y * sx]); }
      const ins = (px, py) => { let o = false; for (let i = 0, j = 31; i < 32; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) o = !o; } return o; };
      let s = 0, n = 0, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const [px, py] of pts) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
      for (let py = Math.max(0, Math.floor(y0)); py < Math.min(H, Math.ceil(y1)); py++) for (let px = Math.max(0, Math.floor(x0)); px < Math.min(W, Math.ceil(x1)); px++) {
        if (!ins(px + 0.5, py + 0.5)) continue;
        const i = ((H - 1 - py) * W + px) * 4; s += 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]; n++;
      }
      return n ? s / n : 0;
    };
    const base = disc(me.x, me.y, 3.5);
    const t = b.host.view.time;
    R.injectEvents([{ e: 'area', t, src: me.id, ability: 'marund_domefall', x: me.x, y: me.y, shape: { kind: 'circle', radius: 3.5 }, delay: 0, vfx: 'marund_ult_domefall', telegraph: 'everyone' }]);
    const series = [];
    for (let i = 0; i < 48; i++) { R.render(1 / 60); series.push(+disc(me.x, me.y, 3.5).toFixed(1)); }
    R.vfx.clear(); fx.reset(); R.overlay.draw = overlay0; R.fog.enabled = fog0;
    if (name === 'bloom') R.post.setQuality(q0);
    if (name === 'density') R.vfx.density = dens0;
    if (name === 'lights') R.vfx.setLightCount(lights0);
    if (name === 'gain') R.post.setBloomStandIn(null);
    render(4);
    const peak = Math.max(...series);
    return { base: +base.toFixed(1), peak, ratio: +(peak / Math.max(1, base)).toFixed(2), peakF: series.indexOf(peak), series };
  }, v);
  const r = rows[v];
  console.log(`${MAP} ${TIER} ${v.padEnd(12)} ${r.base} -> ${r.peak} ${r.ratio}x at frame ${r.peakF}  first beat ${Math.max(...r.series.slice(0, 8))}`);
}
if (OUT) writeFileSync(OUT, JSON.stringify({ map: MAP, tier: TIER, rows, logs: logs.slice(0, 8) }, null, 1));
await browser.close();
