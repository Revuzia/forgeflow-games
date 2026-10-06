// Lens 1a: per-frame luminance of EVERY tier ceremony (capsule reveal incl. the shell's drop + squeeze, merge), normal and calm,
// at 60 fps, independent of the harness: global mean relative luminance, a 3x3 grid of local means, centre colour, saturated red.
//   node flash.mjs [w] [h] [quality] [dt] [tag]
import { setup, save, zigzag, zigzagRel, worstWindow } from './common.mjs';
const [W = 480, H = 300, Q = 'med', DTS = '60', TAG = 'desk'] = process.argv.slice(2);
const w = +W, h = +H, dt = 1 / +DTS;
const env = await setup({ width: Math.max(w, 400), height: Math.max(h, 300) });
console.log('body real:', env.info);
const TI = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
const CAP = { common: 1.6, uncommon: 2.0, rare: 2.6, epic: 3.2, legendary: 3.9, mythic: 4.5 };
const MER = { common: 2.2, uncommon: 2.6, rare: 3.2, epic: 3.8, legendary: 4.5, mythic: 5.2 };
const out = {};
try {
  await env.page.evaluate(([w, h, Q]) => window.__V__.newStage(w, h, Q), [w, h, Q]);
  const jobs = [];
  for (const calm of [false, true]) for (const kind of ['capsule', 'merge']) for (const tier of TI) jobs.push({ kind, tier, calm });
  jobs.push({ kind: 'merge', tier: 'mythic', calm: false, tierUp: true }, { kind: 'merge', tier: 'epic', calm: false, parents: 3 }, { kind: 'capsule', tier: 'common', calm: false, quick: true }, { kind: 'capsule', tier: 'uncommon', calm: true, quick: true });
  for (const j of jobs) {
    const t0 = Date.now();
    const r = await env.page.evaluate(async ([j, dt]) => {
      const V = window.__V__, c = V.ctx;
      const g = V.GN.genomeFromParam(''); c.play = V.mkBody(g); c.stage.setBody(c.play, g); c.stage.setCalmEffects(false); V.frames(30, dt);
      const r = await V.run({ ...j, dt, preRecord: 6, settle: 40 });
      return { rec: r.rec.map((x) => ({ f: x.f, L: x.L, g9: x.g9, c: x.crgb, red: x.red, light: x.light ?? 0, maxPix: x.maxPix })), beats: r.beats, seconds: r.seconds, duration: r.duration, doneResolved: r.doneResolved, maxLight: r.maxLight, bodies: r.bodies, primaryIsResult: r.primaryIsResult, stats: r.stats, errors: V.errors.slice() };
    }, [j, dt]);
    const L = r.rec.map((x) => x.L);
    const res = { budget: (j.kind === 'capsule' ? (j.quick ? 0.8 : CAP[j.tier]) : MER[j.tier] + (j.tierUp ? 0.4 : 0)) * (j.calm ? 0.65 : 1), seconds: r.seconds, duration: r.duration, beats: r.beats.map((b) => `${b.beat}@${b.t.toFixed(3)}`), done: r.doneResolved, bodies: r.bodies, primaryIsResult: r.primaryIsResult, maxLight: r.maxLight, stats: r.stats };
    res.durErrPct = (100 * (r.seconds - res.budget)) / res.budget;
    res.Lmin = Math.min(...L); res.Lmax = Math.max(...L);
    for (const thr of [0.04, 0.02, 0.01]) res[`win@${thr}`] = worstWindow(zigzag(L, thr), dt).n;
    res['winWCAG0.1'] = worstWindow(zigzagRel(L, 0.1), dt).n;
    // local: each of the 9 cells
    let loc04 = { n: 0 }, locW = { n: 0 }, locCell = -1, maxCellSwing = 0;
    for (let k = 0; k < 9; k++) {
      const C = r.rec.map((x) => x.g9[k]);
      const a = worstWindow(zigzag(C, 0.04), dt), b = worstWindow(zigzagRel(C, 0.1), dt);
      if (a.n > loc04.n) { loc04 = a; locCell = k; }
      if (b.n > locW.n) locW = b;
      maxCellSwing = Math.max(maxCellSwing, Math.max(...C) - Math.min(...C));
    }
    res.localWin04 = loc04.n; res.localCell = locCell; res.localWinWCAG = locW.n; res.maxCellSwing = maxCellSwing;
    // warm/cool alternation of the centre colour (coral vs cyan): w = R - (G+B)/2 in linear light
    const hue = r.rec.map((x) => x.c[0] - (x.c[1] + x.c[2]) / 2);
    for (const thr of [0.01, 0.02, 0.04]) res[`warmCoolFlips@${thr}`] = worstWindow(zigzag(hue, thr), dt).n;
    res.maxRedFrac = Math.max(...r.rec.map((x) => x.red));
    res.errors = r.errors;
    const key = `${j.kind}:${j.tier}${j.calm ? ':calm' : ''}${j.tierUp ? ':tierUp' : ''}${j.parents ? ':p' + j.parents : ''}${j.quick ? ':quick' : ''}`;
    out[key] = res;
    save(`flash_${TAG}_${key.replace(/:/g, '_')}.json`, { L, g9: r.rec.map((x) => x.g9), light: r.rec.map((x) => x.light), beats: r.beats });
    console.log(key, `${((Date.now() - t0) / 1000).toFixed(0)}s`, `dur ${r.seconds.toFixed(3)}/${res.budget.toFixed(2)} (${res.durErrPct.toFixed(1)}%)`, `L ${res.Lmin.toFixed(3)}..${res.Lmax.toFixed(3)}`,
      `win04 ${res['win@0.04']} win02 ${res['win@0.02']} win01 ${res['win@0.01']} wcag ${res['winWCAG0.1']} | local04 ${res.localWin04}(cell ${locCell}) localWCAG ${res.localWinWCAG} swing ${maxCellSwing.toFixed(3)} | warmcool ${res['warmCoolFlips@0.01']}/${res['warmCoolFlips@0.02']} red ${res.maxRedFrac.toFixed(4)} light ${r.maxLight.toFixed(3)} done ${r.doneResolved} bodies ${r.bodies}`);
    console.log('   beats', res.beats.join(' '));
  }
} catch (e) { console.log('THREW', e); }
save(`flash_${TAG}_summary.json`, { out, consoleBad: env.bad });
console.log('console problems:', env.bad.length, env.bad.slice(0, 10));
await env.close();
