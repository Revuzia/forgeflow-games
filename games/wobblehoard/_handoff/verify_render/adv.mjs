// Lens 1c: adversarial sequences for the flash budget: ceremonies chained the way a fast-tapping player (Fast open, a queue of
// capsules, tap-to-skip) can chain them. Per-frame luminance at 60 fps, counted exactly like the harness (zigzag >= 0.04 mean linear
// luminance, worst 1 s window; > 3 = fail) and WCAG-style (>= 0.1). node adv.mjs [w] [h] [quality]
import { setup, save, zigzag, zigzagRel, worstWindow } from './common.mjs';
const [W = '480', H = '300', Q = 'med'] = process.argv.slice(2);
const env = await setup({ width: Math.max(+W, 400), height: Math.max(+H, 300) });
console.log('body:', env.info);
const dt = 1 / +(process.env.FPS ?? 60);
const out = {};
await env.page.evaluate(([w, h, q]) => window.__V__.newStage(w, h, q), [+W, +H, Q]);
// a sequence = list of steps: { start: 'capsule'|'merge', tier, quick, at (seconds after the previous START), skipAt (seconds after its own start) }
const SEQS = {
  quickpops5: [0, 1, 2, 3, 4].map(() => ({ kind: 'capsule', tier: 'common', quick: true, gap: 0.0 })),               // each starts when the previous ends
  quickpops5_uncommon: [0, 1, 2, 3, 4].map(() => ({ kind: 'capsule', tier: 'uncommon', quick: true, gap: 0.0 })),
  mythicSkipThenQuick: [{ kind: 'capsule', tier: 'mythic', skipAt: 1.73 }, { kind: 'capsule', tier: 'uncommon', quick: true, startAt: 1.81 }],
  legendarySkipThenQuick: [{ kind: 'capsule', tier: 'legendary', skipAt: 1.53 }, { kind: 'capsule', tier: 'uncommon', quick: true, startAt: 1.61 }],
  mergeMythicSkipThenQuick: [{ kind: 'merge', tier: 'mythic', skipAt: 2.88 }, { kind: 'capsule', tier: 'uncommon', quick: true, startAt: 2.96 }],
  mythicSkipThenUncommon: [{ kind: 'capsule', tier: 'mythic', skipAt: 1.73 }, { kind: 'capsule', tier: 'uncommon', startAt: 1.81 }],
  mythicSkipThenQuickCommon: [{ kind: 'capsule', tier: 'mythic', skipAt: 1.73 }, { kind: 'capsule', tier: 'common', quick: true, startAt: 1.81 }],
  mythicThenCommon: [{ kind: 'capsule', tier: 'mythic', skipAt: 1.70 }, { kind: 'capsule', tier: 'common', startAt: 1.70 }],
  epicCapsules3: [0, 1, 2].map(() => ({ kind: 'capsule', tier: 'epic', gap: 0.0 })),
  capsuleRareQueue_skip: [0, 1, 2, 3].map(() => ({ kind: 'capsule', tier: 'rare', skipAt: 1.0, gap: 0.05 })),
};
const ONLY = (process.env.SEQ ?? '').split(',').filter(Boolean);
const DTS = +(process.env.FPS ?? 60);
for (const [name, seq] of Object.entries(SEQS)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  const r = await env.page.evaluate(async ([seq, dt]) => {
    const V = window.__V__, c = V.ctx, st = c.stage;
    const g = V.GN.genomeFromParam(''); c.play = V.mkBody(g); st.setBody(c.play, g); st.setCalmEffects(false); V.frames(30, dt);
    const L = [], light = [], marks = [];
    let f = 0, cur = null, curStart = 0, idx = 0, skipped = false;
    const start = (s) => {
      const tier = s.tier;
      cur = s.kind === 'capsule' ? st.playCapsuleReveal({ result: { genome: V.resultGenome(tier), tier }, createBody: V.mkBody, quick: !!s.quick }, { onBeat: (b) => marks.push(`${b}@${(f * dt).toFixed(2)}`) })
        : st.playMergeCeremony({ parents: [{ genome: g }, { genome: g }], result: { genome: V.resultGenome(tier), tier }, createBody: V.mkBody }, { onBeat: (b) => marks.push(`${b}@${(f * dt).toFixed(2)}`) });
      curStart = f * dt; skipped = false; marks.push(`START ${s.kind}:${tier}${s.quick ? ':quick' : ''}@${(f * dt).toFixed(2)}`);
    };
    start(seq[0]); idx = 1;
    let endAt = -1;
    for (; f < 60 * 14; f++) {
      const t = f * dt, s = seq[idx - 1];
      if (s && s.skipAt !== undefined && !skipped && t - curStart >= s.skipAt) { cur.skip(); skipped = true; marks.push(`skip@${t.toFixed(2)}`); }
      const nx = seq[idx];
      if (!cur.active && endAt < 0) endAt = t;
      if (nx) {
        const due = nx.startAt !== undefined ? t >= nx.startAt - 1e-9 : endAt >= 0 && t >= endAt + (nx.gap ?? 0) - 1e-9;
        if (due) { if (cur.resultBody) c.play = cur.resultBody; start(nx); idx++; endAt = -1; }
      } else if (endAt >= 0 && t > endAt + 0.8) break;
      if (!cur.active && cur.resultBody && c.play !== cur.resultBody) c.play = cur.resultBody;
      V.frame(dt, true);
      L.push(V.lum().L); light.push(st.info.screenLight);
    }
    return { L, light, marks, granted: st.flash.granted, refused: st.flash.refused };
  }, [seq, dt]);
  const res = { win04: worstWindow(zigzag(r.L, 0.04), dt), win02: worstWindow(zigzag(r.L, 0.02), dt), wcag: worstWindow(zigzagRel(r.L, 0.1), dt), lightRamps: r.light.filter((v, i) => v > 0.01 && (i === 0 || r.light[i - 1] <= 0.01)).length, maxLight: Math.max(...r.light), Lmin: Math.min(...r.L), Lmax: Math.max(...r.L), granted: r.granted, refused: r.refused, marks: r.marks.join(' ') };
  res.flips04 = zigzag(r.L, 0.04).map((k) => +(k * dt).toFixed(2));
  // ramp start times
  res.rampStarts = r.light.map((v, i) => (v > 0.01 && (i === 0 || r.light[i - 1] <= 0.01) ? +(i * dt).toFixed(2) : null)).filter((x) => x !== null);
  out[name] = res;
  save(`adv_${name}.json`, { L: r.L, light: r.light, marks: r.marks });
  console.log(name, JSON.stringify({ win04: res.win04, win02: res.win02, wcag: res.wcag, ramps: res.rampStarts, flips04: res.flips04, L: [res.Lmin.toFixed(3), res.Lmax.toFixed(3)], maxLight: res.maxLight.toFixed(3) }));
  console.log('   ', res.marks);
}
save('adv_summary.json', { out, console: env.bad });
console.log('console problems:', env.bad.length, env.bad.slice(0, 10));
await env.close();
