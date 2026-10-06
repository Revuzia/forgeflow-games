// Raw framebuffer (premultiplied) values inside the alpha-0 region of the calm Common reveal at burst + 9 frames, and under a waiting capsule.
import { setup } from './common.mjs';
const env = await setup({ width: 1280, height: 800 });
const r = await env.page.evaluate(async () => {
  const V = window.__V__; V.newStage(1280, 800, 'med', 1);
  const c = V.ctx, st = c.stage, gl = st.renderer.getContext(), out = {};
  const raw = (pts) => { st.render(); const px = new Uint8Array(4); return pts.map(([x, y]) => { gl.readPixels(x, 800 - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return Array.from(px); }); };
  const scan = () => { st.render(); const n = 1280 * 800; const buf = new Uint8Array(n * 4); gl.readPixels(0, 0, 1280, 800, gl.RGBA, gl.UNSIGNED_BYTE, buf); let a0 = 0, sumRGBa0 = [0, 0, 0], over = 0; for (let i = 0; i < buf.length; i += 4) { if (buf[i + 3] === 0) { a0++; sumRGBa0[0] += buf[i]; sumRGBa0[1] += buf[i + 1]; sumRGBa0[2] += buf[i + 2]; } if (buf[i] > buf[i + 3] || buf[i + 1] > buf[i + 3] || buf[i + 2] > buf[i + 3]) over++; } return { alpha0: a0, meanRGBwhereAlpha0: sumRGBa0.map((s) => +(s / Math.max(1, a0)).toFixed(1)), rgbGreaterThanAlpha: over }; };
  V.frames(40, 1 / 30); const cap0 = st.dropCapsule(); V.frames(80, 1 / 30);
  out.waiting = scan(); cap0.remove(); V.frames(2, 1 / 30);
  const g = V.GN.genomeFromParam(''); c.play = V.mkBody(g); st.setBody(c.play, g); V.frames(40, 1 / 30);
  st.setCalmEffects(true);
  const cap = st.dropCapsule(); let k = 0; while (!cap.landed && k < 200) { V.frame(1 / 30, false); k++; } V.frames(20, 1 / 30);
  for (let i = 0; i < 15; i++) { cap.setSqueeze(i / 15); V.frame(1 / 30, false); }
  let burst = -1, f = 0;
  const h = st.playCapsuleReveal({ result: { genome: V.resultGenome('common'), tier: 'common' }, createBody: V.mkBody, capsule: cap }, { onBeat: (b) => { if (b === 'burst') burst = f; } });
  while (h.active && (burst < 0 || f < burst + 9)) { V.frame(1 / 30, false); f++; }
  out.calm = scan(); out.calmPts = raw([[600, 550], [560, 600], [650, 520]]);
  return out;
});
console.log(JSON.stringify(r));
await env.close();
