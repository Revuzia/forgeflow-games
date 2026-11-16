// TEMP owner15 lane-AI r1 adversarial LIVE verifier: the real client sim + renderer in Chrome (_harness/web/_tmp_ai_live.html,
// a render_bench copy whose bot seats take ?diff=), seat 0 a scripted human-like player (autopilot laning between scripted
// scenes: overextend alone, dive the carry beside its support, push a road into the base), passive monitors over every
// fighter (idle, dither, low-HP retreat / finish, fog beelines, sieges + defenders, objectives with numbers, deaths alone).
//   node _harness/_tmp_vfy_owner15_ai_live.mjs --mode rift --diff veteran --seed 5 [--cap 26]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, shot } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const opt = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const MODE = opt('mode', 'rift'), DIFF = opt('diff', 'veteran'), SEED = Number(opt('seed', 5));
const CAP = Number(opt('cap', MODE === 'fray' ? 12 : MODE === 'bridge' ? 22 : 28)) * 60;
const BRAIN = opt('brain', '_tmp_ai_live_brain.js');
const WATCH = opt('watch', null)?.split(':').map(Number) ?? null;
const TAG = `vfy_ai44_r1${BRAIN.includes('r1b') ? 'b' : ''}${WATCH ? 'w' : ''}_${MODE}_${DIFF}_s${SEED}`;
const OUT = join(HERE, '_reports', `${TAG}.json`);
mkdirSync(dirname(OUT), { recursive: true });

const MAPS = {
  rift: { bases: { 0: [8.5, 55], 1: [161.5, 55] }, mid: 85 },
  bridge: { bases: { 0: [7, 22], 1: [149, 22] }, mid: 78 },
  fray: { bases: {}, mid: 0 },
};
// the script: [match second, scenario, cfg]
const PLANS = {
  rift: BRAIN.includes('r1b') ? [
    [380, 'overextend', { spot: [106, 27] }],
    [620, 'dive', { road: [92, 97] }],
    [900, 'push', { name: 'the middle road', road: [[115, 55], [124, 57.8], [138, 52.2], [148.5, 55], [155, 55]], dur: 260 }],
    [1200, 'overextend', { spot: [108, 66] }],
    [1380, 'dive', { road: [92, 97] }],
  ] : [
    [300, 'overextend', { spot: [98, 13] }],
    [560, 'dive', { road: [92, 97] }],
    [840, 'push', { name: 'the middle road', road: [[115, 55], [124, 57.8], [138, 52.2], [148.5, 55], [155, 55]], dur: 260 }],
    [1260, 'dive', { road: [92, 97] }],
  ],
  bridge: [
    [330, 'dive', { road: [90, 22] }],
    [600, 'push', { name: 'the span', road: [[99, 19], [115, 25], [127, 19], [134.5, 25.4], [143.5, 22]], dur: 260 }],
    [960, 'dive', { road: [90, 22] }],
  ],
  fray: [],
};

const { browser, page, logs } = await open(`/_harness/web/_tmp_ai_live.html?mode=${MODE}&q=low&t=0&seed=${SEED}&dev=1&hud=0&manual=1&diff=${DIFF}`, { wait: false, hmr: false });
const rep = { mode: MODE, diff: DIFF, seed: SEED, shots: [] };
let shotN = 0;
const snap = async (s) => {
  if (shotN >= (WATCH && !String(s.tag).startsWith("watch") ? 12 : 22)) return;
  await page.evaluate((s) => {
    const B = window.__VALE_BENCH__;
    let x = s.x, y = s.y;
    if (s.id != null) { const e = B.host.view.entity(s.id); if (e) { x = e.x; y = e.y; } }
    if (x == null) return;
    B.focus(x, y); B.zoom?.(40); for (let i = 0; i < 4; i++) B.renderer.render(1 / 30);
  }, s);
  const p = await shot(page, `${TAG}_${String(++shotN).padStart(2, '0')}_${s.tag}`);
  rep.shots.push(p);
};
try {
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready, null, { timeout: 240000 });
  await page.addScriptTag({ path: join(HERE, 'web', BRAIN) });
  rep.lineup = await page.evaluate((cfg) => {
    window.__AI.install(cfg);
    return window.__VALE_BENCH__.host.view.players.map((p) => ({ player: p.player, team: p.team, fighter: p.fighter, role: p.role, controller: p.controller }));
  }, { mode: MODE, ...MAPS[MODE] });
  console.log('lineup', JSON.stringify(rep.lineup));
  const plan = PLANS[MODE].slice();
  let nextPeriodic = 240;
  for (;;) {
    const r = await page.evaluate(() => window.__AI.run(5));
    for (const s of r.shots) await snap(s);
    if (!r.scen && plan.length && r.t >= plan[0][0] && r.me?.alive && r.me.hp >= 85) {
      const [, name, cfg] = plan.shift();
      await page.evaluate(([n, c]) => window.__AI.startScenario(n, c), [name, cfg]);
    }
    if (r.t >= nextPeriodic) {
      nextPeriodic += 240;
      const f = await page.evaluate(() => window.__VALE_BENCH__.fight());
      if (f) await snap({ tag: `t${Math.round(r.t / 60)}min_busiest`, x: f.x, y: f.y });
      console.log(`t=${r.t.toFixed(0)} me=${JSON.stringify(r.me)} scen=${r.scen}`);
    }
    if (WATCH && r.t >= WATCH[1] && r.t <= WATCH[2]) {
      const w = await page.evaluate((pl) => {
        const v = window.__VALE_BENCH__.host.view; const P = v.players.find((p) => p.player === pl); const e = v.entity(P.entity);
        const d = (a) => +Math.hypot(a.x - e.x, a.y - e.y).toFixed(1);
        return { t: +v.time.toFixed(0), x: +e.x.toFixed(1), y: +e.y.toFixed(1), st: e.state, hp: Math.round(100 * e.hp / e.maxHp), alive: e.alive,
          own: v.entities.filter((s) => s.kind === 'structure' && s.team === e.team && d(s) < 30).map((s) => `${s.def}@${d(s)}${s.alive ? '' : '(dead)'}:${Math.round(100 * s.hp / s.maxHp)}%`),
          foes: v.entities.filter((f) => f.kind === 'fighter' && f.alive && f.team !== e.team && d(f) < 35).map((f) => `p${v.players.find((p) => p.entity === f.id).player}@${d(f)}${(f.visibleMask & (1 << e.team)) ? '' : '(hidden)'}`),
          allies: v.entities.filter((f) => f.kind === 'fighter' && f.alive && f.team === e.team && f.id !== e.id && d(f) < 35).map((f) => `p${v.players.find((p) => p.entity === f.id).player}@${d(f)}`),
          wicks: v.entities.filter((m) => m.kind === 'minion' && m.alive && m.team !== e.team && d(m) < 25).length };
      }, WATCH[0]);
      rep.watch = rep.watch || []; rep.watch.push(w); console.log('WATCH', JSON.stringify(w));
      if (!rep.watchShots || rep.watchShots < 3) { rep.watchShots = (rep.watchShots || 0) + 1; await snap({ tag: `watch_p${WATCH[0]}_t${w.t}`, x: w.x, y: w.y }); }
    }
    if (r.ended || r.t >= CAP) { rep.endT = r.t; rep.ended = r.ended; break; }
  }
  Object.assign(rep, await page.evaluate(() => {
    const A = window.__AI, v = window.__VALE_BENCH__.host.view;
    for (const op of A.lowOpen.values()) { op.outcome = 'open'; op.attackers = op.attackersOnIt.size; delete op.attackersOnIt; delete op.foeIds; A.lowEp.push(op); }
    for (const sg of A.sieges.values()) A.siegeLog.push(sg);
    return {
      result: v.result ? { winningTeam: v.result.winningTeam, reason: v.result.reason, duration: v.result.duration } : null,
      players: v.players.map((p) => ({ player: p.player, team: p.team, role: p.role, k: p.kills, d: p.deaths, a: p.assists, cs: p.cs, gold: p.goldEarned, placement: p.placement })),
      timeline: A.tl, scenarios: A.scen, idle: A.idle, dither: A.dither, lowHp: A.lowEp, deaths: A.deaths, objectives: A.objectives,
      fights: A.fights, fightSizeAvg: A.fightSizes.length ? +(A.fightSizes.reduce((s, x) => s + x, 0) / A.fightSizes.length).toFixed(1) : 0,
      sieges: A.siegeLog, coreW: A.coreW || [], beelines: A.beelines, structFalls: A.structFalls,
      faults: window.__VALE_BENCH__.host.faults,
    };
  }));
} catch (e) {
  rep.error = String(e?.stack ?? e).slice(0, 1200); console.log('ERROR', rep.error);
} finally {
  rep.logs = logs.slice(0, 20);
  writeFileSync(OUT, JSON.stringify(rep, null, 1));
  console.log('report', OUT, 'shots', shotN);
  await browser.close();
}
