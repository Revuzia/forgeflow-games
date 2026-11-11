// VALE harness — MAX env ENV-10: the drifting cloud shadow, A/B in one page (worldUniforms.valeCloud.x 0 | tier value),
// plus a drift strip (the same spot 0 / 10 / 20 s later, sim frozen, only the shared clock moves) and mean display luma.
//   node _harness/max_env_cloud_ab.mjs [--mode rift] [--q high] [--nofog]
import { mkdirSync, writeFileSync } from 'node:fs';
import { openBench, B, grab } from './gfx_lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const q = arg('q', 'high'), mode = arg('mode', 'rift'), amt = arg('amt', null) == null ? null : Number(arg('amt', 0));
const OUT = '_harness/_shots/maxenv/cloud'; mkdirSync(OUT, { recursive: true });
const spots = { rift: { lane: [62, 52], seat: [85, 55], core: [22, 55] }, bridge: { deck: [45, 22] }, fray: { centre: [32, 32] } }[mode];
const { browser, page } = await openBench({ q, t: 20, mode });
if (process.argv.includes('--nofog')) await B(page, (b) => { b.renderer.fog.enabled = false; });
const res = { mode, q, spots: {} };
for (const [k, [x, y]] of Object.entries(spots)) {
  await B(page, (b, p) => { b.focus(p[0], p[1]); b.zoom(28.5); b.frames(30, 1 / 30); }, [x, y]);
  const lum = async (amt, adv, name) => {
    const r = await B(page, (b, a) => {
      b.renderer.post.setCloud(a.amt);
      b.renderer.render(a.adv); b.renderer.render(0);
      const gl = b.renderer.gl.getContext(), Wd = gl.drawingBufferWidth, H = gl.drawingBufferHeight, px = new Uint8Array(Wd * H * 4);
      gl.readPixels(0, 0, Wd, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let s = 0; for (let i = 0; i < Wd * H; i++) s += 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
      return { luma: +(s / (Wd * H)).toFixed(2) };
    }, { amt, adv });
    await grab(page, `${OUT}/${mode}_${k}_${name}.png`);
    return r;
  };
  res.spots[k] = { off: await lum(0, 0, 'off'), on: await lum(amt, 0, 'on'), on10: await lum(amt, 10, 'on_t10'), on20: await lum(amt, 10, 'on_t20') };
  console.log(k, JSON.stringify(res.spots[k]));
}
writeFileSync(`${OUT}/${mode}_${q}.json`, JSON.stringify(res, null, 1));
await browser.close();
