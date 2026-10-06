// Repro for the pure-black blob inside the flying lower capsule half (first seen: out/look/calm_1280x800_med/cap_2rare_d_drop.png).
// Every frame from the burst for 0.6 s: count pixels with max(R,G,B) <= 3; save the worst frame.  node black_probe.mjs [w] [h] [quality]
import { setup, b64, S } from './common.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [W = '1280', H = '800', Q = 'med'] = process.argv.slice(2);
const dir = `${S}/out/look/black_probe`; mkdirSync(dir, { recursive: true });
const env = await setup({ width: +W, height: +H });
const res = [];
for (const [tier, calm] of [['rare', true], ['rare', false], ['common', true], ['mythic', true], ['epic', false]]) {
  const r = await env.page.evaluate(async ([w, h, q, tier, calm]) => {
    const V = window.__V__;
    if (!V.ctx || V.ctx.w !== w) V.newStage(w, h, q, 1);
    const c = V.ctx, st = c.stage, dt = 1 / 30;
    const g = V.GN.genomeFromParam(''); c.play = V.mkBody(g); st.setBody(c.play, g); st.setCalmEffects(calm); V.frames(30, dt);
    const cap = st.dropCapsule(); let k = 0; while (!cap.landed && k < 200) { V.frame(dt, false); k++; } V.frames(20, dt);
    for (let i = 0; i < 15; i++) { cap.setSqueeze(i / 15); V.frame(dt, false); }
    let burstF = -1, f = 0; const counts = []; let worst = { n: 0, png: null, t: 0 };
    const h2 = st.playCapsuleReveal({ result: { genome: V.resultGenome(tier), tier, isNew: true }, createBody: V.mkBody, capsule: cap }, { onBeat: (b) => { if (b === 'burst') burstF = f; } });
    const cc = document.createElement('canvas'); cc.width = w; cc.height = h; const x = cc.getContext('2d', { willReadFrequently: true });
    while (h2.active && f < 300) {
      V.frame(dt, true); f++;
      if (burstF >= 0 && f - burstF <= 20) {
        x.drawImage(c.canvas, 0, 0); const d = x.getImageData(0, 0, w, h).data; let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] <= 3 && d[i + 1] <= 3 && d[i + 2] <= 3) n++;
        counts.push(n);
        if (n > worst.n) worst = { n, png: c.canvas.toDataURL('image/png'), t: f * dt };
      }
    }
    c.play = h2.resultBody; st.setCalmEffects(false);
    return { counts, worst: { n: worst.n, t: worst.t, png: worst.png } };
  }, [+W, +H, Q, tier, calm]);
  if (r.worst.png) writeFileSync(`${dir}/${tier}${calm ? '_calm' : ''}_${W}x${H}_${Q}_worst.png`, b64(r.worst.png));
  res.push({ tier, calm, blackPixelsPerFrameAfterBurst: r.counts.join(','), worst: r.worst.n, at: +r.worst.t.toFixed(2) });
  console.log(JSON.stringify(res[res.length - 1]));
}
console.log('console', env.bad.slice(0, 5));
await env.close();
