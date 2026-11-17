// PF-00 (PG_PHYS; PLAYGROUND_BUILD 14.2, T13, D-60): the phone factor F and the unit weights LIFE's motion gate needs.
//   node _harness/pf00.mjs [--port 5368] [--reps 7] [--rounds 3]
// The SAME workload (_harness/pf00_work.ts) runs in node on this container and in headless Chromium with a 4x CPU throttle (CDP Emulation.setCPUThrottlingRate),
// interleaved round by round; F = Chromium-throttled ms / node ms for one awake detail-3 whole (rest, and pressed: c_whole). The unit weights are node cost ratios
// to c_whole (pressed): a detail-2 piece, a touching pair's extra, a sleeper; the props near a body in ms. One heavy job (a browser): port 5368 only (SESSION3).
import { startVite, launch } from './pw.mjs';
import { pf00Run } from './pf00_work.ts';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const PORT = arg('port', 5368), REPS = arg('reps', 7), ROUNDS = arg('rounds', 3), THROTTLE = 4;
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const vite = await startVite(PORT);
const browser = await launch();
const out = { node: [], chrome: [] };
try {
  const page = await browser.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(`${vite.url}_harness/physview/pf00.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__PF__ && window.__PF__.ready, null, { timeout: 120000 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  for (let r = 0; r < ROUNDS; r++) {
    out.node.push(pf00Run(REPS, 120));
    out.chrome.push(await page.evaluate(([reps]) => window.__PF__.run(reps, 120), [REPS]));
    console.log(`round ${r + 1}: node press ${out.node[r].press.toFixed(3)} ms, chrome x${THROTTLE} press ${out.chrome[r].press.toFixed(3)} ms`);
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  if (problems.length) console.log('PAGE PROBLEMS', problems);
} finally {
  await browser.close();
  vite.stop();
}
const pick = (side, k) => med(out[side].map((o) => o[k]));
const res = {};
for (const k of ['rest', 'press', 'piece', 'pair', 'sleeper', 'props']) res[k] = { node: pick('node', k), chrome: pick('chrome', k) };
const F = { rest: res.rest.chrome / res.rest.node, press: res.press.chrome / res.press.node };
const cw = res.press.node;
const weights = {
  piece: res.piece.node / cw,
  pairExtra: (res.pair.node - 2 * res.rest.node) / cw,
  sleeper: res.sleeper.node / cw,
  propsMs: res.props.node - res.press.node,
};
const perRound = out.node.map((o, r) => ({ nodePress: o.press, chromePress: out.chrome[r].press, F: out.chrome[r].press / o.press, nodeRest: o.rest, chromeRest: out.chrome[r].rest }));
console.log(JSON.stringify({ throttle: THROTTLE, rounds: ROUNDS, reps: REPS, ms: res, F, cWholeNodeMs: cw, weights, perRound, sleeperAsleep: out.node.every((o) => o.sleeperAsleep), piecesAwake: out.node.every((o) => o.piecesAwake), pairTouch: out.node.map((o) => o.pairTouch) }, null, 2));
