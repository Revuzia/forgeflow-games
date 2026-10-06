// Lens 3: look-dev captures (my own framing / timing choices), written to out/look/<set>/*.png.
//   node look.mjs <set> [w] [h] [quality] [dpr]
// sets: capsule (every tier: tell, burst peak, drop, final), merge (in-play same-species parents: fold, charge end, burst peak, rise, final),
//       merge3, calm, extra
import { setup, b64, S } from './common.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const [SET = 'capsule', W = '1280', H = '800', Q = 'med', DPR = '1'] = process.argv.slice(2);
const w = +W, h = +H;
const dir = `${S}/out/look/${SET}_${w}x${h}_${Q}`;
mkdirSync(dir, { recursive: true });
const env = await setup({ width: w, height: h });
console.log('body:', env.info);
const TI = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
const CAPB = [1.6, 2.0, 2.6, 3.2, 3.9, 4.5], PRE = [0, 0, 0.3, 0.5, 0.8, 1.0], MB = [1.3, 1.5, 1.8, 2.1, 2.4, 2.8], MER = [2.2, 2.6, 3.2, 3.8, 4.5, 5.2];
await env.page.evaluate(([w, h, Q, dpr]) => window.__V__.newStage(w, h, Q, dpr), [w, h, Q, +DPR]);
async function cer(name, o) {
  const t0 = Date.now();
  const r = await env.page.evaluate(async (o) => {
    const V = window.__V__, c = V.ctx;
    const g = o.playGenome ? o.playGenome : V.GN.genomeFromParam('');
    c.play = V.mkBody(g); c.stage.setBody(c.play, g); if (o.playTier) c.stage.setBodyTier(c.stage.primaryBodyId(), o.playTier); V.frames(40, 1 / 30);
    if (o.spec === 'play') o.spec = V.playMergeSpec(o.parentTier, o.tier, o.parents ?? 2, o.seed ?? 7);
    const r = await V.run({ ...o, dt: 1 / 30, record: false });
    return { shots: r.shots, beats: r.beats.map((b) => b.beat + '@' + b.t.toFixed(2)), spec: o.spec ? { parents: o.spec.parents.map((p) => p.genome.species + ' h' + p.genome.hue), result: o.spec.result.genome.species + ' h' + o.spec.result.genome.hue } : null };
  }, o);
  for (const [k, png] of Object.entries(r.shots)) writeFileSync(`${dir}/${name}_${k}.png`, b64(png));
  console.log(name, ((Date.now() - t0) / 1000).toFixed(0) + 's', r.beats.join(' '), r.spec ? JSON.stringify(r.spec) : '');
}
const pad = (o) => o;
try {
  if (SET === 'capsule' || SET === 'calm') {
    const calm = SET === 'calm';
    for (let i = 0; i < 6; i++) {
      if (calm && ![0, 2, 5].includes(i)) continue;
      const k = calm ? 0.65 : 1, burst = (0.65 + PRE[i]) * k;
      await cer(`cap_${i}${TI[i]}`, { kind: 'capsule', tier: TI[i], calm, at: pad({ a_neutral: 0.2 * k, b_tell: burst - 0.07, c_burstpeak: burst + 0.1, d_drop: burst + 0.33 * k, e_final: CAPB[i] * k - 0.05 }) });
    }
  }
  if (SET === 'merge' || SET === 'calm') {
    const calm = SET === 'calm';
    for (let i = 0; i < 6; i++) {
      if (calm && ![0, 2, 5].includes(i)) continue;
      const k = calm ? 0.65 : 1;
      // in-play: parents are two instances of ONE species of the tier below (or the same tier when i = 0)
      const parentTier = TI[Math.max(0, i - 1)];
      await cer(`mer_${i}${TI[i]}`, { kind: 'merge', tier: TI[i], calm, spec: 'play', parentTier, seed: 5 + i, at: pad({ a_press: 0.4 * k, b_fold: 0.7 * k, c_chargeend: MB[i] * k - 0.04, d_burstpeak: MB[i] * k + 0.1, e_rise: (MB[i] + 0.45) * k, f_final: (MER[i] + (i > 0 ? 0.4 : 0)) * k - 0.05 }) });
    }
  }
  if (SET === 'merge3') {
    for (const i of [2, 5]) await cer(`mer3_${i}${TI[i]}`, { kind: 'merge', tier: TI[i], spec: 'play', parents: 3, parentTier: TI[i - 1], seed: 11, at: { a_slide: 0.25, b_press: 0.42, c_fold: 0.7, d_chargeend: MB[i] - 0.04, e_burstpeak: MB[i] + 0.1, f_final: MER[i] + 0.35 } });
  }
  if (SET === 'harnessmerge') {   // the harness's own mismatched parents, for comparison with the in-play spec
    await cer('hmer_2rare', { kind: 'merge', tier: 'rare', at: { b_fold: 0.7, c_chargeend: 1.76, d_burstpeak: 1.9 } });
  }
  if (SET === 'extra') {
    // the play body sliding off for a capsule reveal when it is an Epic (orbiting motes trail) and a Legendary
    await cer('slide_epic_play', { kind: 'capsule', tier: 'rare', playGenome: null, playTier: 'epic', at: { a: 0.1, b: 0.2, c: 0.3 } });
    await cer('quickpop', { kind: 'capsule', tier: 'common', quick: true, at: { a: 0.3, b: 0.42, c: 0.75 } });
    // a meter-full capsule waiting on the table when a merge starts (the HUD queues capsules on the table)
    const r = await env.page.evaluate(async () => {
      const V = window.__V__, c = V.ctx, st = c.stage, out = {};
      const g = V.GN.genomeFromParam(''); c.play = V.mkBody(g); st.setBody(c.play, g); V.frames(30, 1 / 30);
      const cap = st.dropCapsule(); V.frames(70, 1 / 30);
      out.capWaiting = V.png();
      const spec = V.playMergeSpec('common', 'rare', 2, 3);
      const h = st.playMergeCeremony({ ...spec, createBody: V.mkBody });
      V.frames(6, 1 / 30); out.at02 = V.png();
      V.frames(7, 1 / 30); out.at042 = V.png();
      let k = 0; while (h.active && k < 200) { V.frame(1 / 30, false); k++; }
      c.play = h.resultBody; V.frames(5, 1 / 30); out.after = V.png();
      cap.remove(); V.frames(2, 1 / 30);
      // tier-up merge: the last frame before done vs the first frame after (particles cleared at the end)
      const spec2 = V.playMergeSpec('rare', 'epic', 2, 4);
      const h2 = st.playMergeCeremony({ ...spec2, createBody: V.mkBody });
      let f = 0; const D = h2.duration;
      while (h2.active && f < 400) { if (Math.abs(f / 30 - (D - 1 / 30)) < 1e-6 || (f / 30 < D - 1 / 30 && (f + 1) / 30 >= D - 1 / 30)) { out.tierUpLast = V.png(); out.pLast = st.info.particles; } V.frame(1 / 30, false); f++; }
      out.pAfter = st.info.particles; out.tierUpAfter = V.png();
      return out;
    });
    for (const k of ['capWaiting', 'at02', 'at042', 'after', 'tierUpLast', 'tierUpAfter']) if (r[k]) writeFileSync(`${dir}/x_${k}.png`, b64(r[k]));
    console.log('particles before/after end of the tier-up merge:', r.pLast, r.pAfter);
  }
} catch (e) { console.log('THREW', e); }
console.log('console problems:', env.bad.length, env.bad.slice(0, 10));
await env.close();
