// VALE harness — live-play verify of the click / pathing fixes (ruling 33). A RIFT practice match in real Chrome,
// real mouse and keys (Playwright → CDP input), with a chosen fighter. Records every command the client sent, the
// hero's sim order / position every frame, and for each scenario what was intended vs what was sent / attacked.
//
//   node _harness/verify_controls_live.mjs <fighterId> [--tag x]   → _harness/_reports/controls_<fighter>.json
//   shots _harness/_shots/controls_<fighter>_*.png
//
// Harness-only practice commands (structures off, heal, teleport) go through the client's original send and are
// tagged 'harness'; everything else the controller sends is logged as a player command.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, shot, vale, waitFor } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const FIGHTER = args.find((a) => !a.startsWith('--')) ?? 'lisvel';
const OUT = join(HERE, '_reports', `ctl_r3live_${process.env.CLICK ? 'clickwave' : 'holdwave'}_${FIGHTER}${process.env.START_T ? '_late' : ''}.json`);
mkdirSync(dirname(OUT), { recursive: true });
const report = { at: new Date().toISOString(), fighter: FIGHTER, scenarios: {}, drift: null, logs: [] };
const log = (...a) => console.log(...a);
let shotN = 0;
const snap = (page, name) => shot(page, `owner15_controls_r3_${process.env.CLICK ? 'clickwave' : 'holdwave'}_${FIGHTER}_${String(++shotN).padStart(2, '0')}_${name}`).catch(() => null);

const { browser, page, logs } = await open('/?dev=1', { hmr: false });
const sleep = (ms) => page.waitForTimeout(ms);
try {
  const frames = () => page.waitForFunction(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))), null, { timeout: 60000 });
  const click = async (l) => { await l.waitFor({ state: 'visible', timeout: 20000 }); await frames(); await l.click({ timeout: 20000 }); };
  const SCR = '.scr--practice:not(.is-leaving)';
  await sleep(1500); await frames();
  await click(page.locator('.nav__item', { hasText: 'Play' })); await sleep(500);
  await click(page.locator('.play__links button', { hasText: 'Practice' }));
  await waitFor(page, (v) => v.router.route.value.screen === 'practice', 10000);
  await sleep(800);
  const name = FIGHTER[0].toUpperCase() + FIGHTER.slice(1);
  let card = page.locator(`${SCR} .fcard`).filter({ hasText: name }).first();
  if (!(await card.count())) card = page.locator(`${SCR} .fcard[aria-label*="${name}"]`).first();
  await click(card); await sleep(300);
  // a sparring partner (an enemy fighter on the map, for the fighters-only check)
  await click(page.locator(`${SCR} .select__btn[aria-label^="Sparring partner"]`).first());
  const opts = page.locator(`${SCR} .select.is-open [role=option]`);
  await opts.first().waitFor({ state: 'visible', timeout: 5000 });
  await opts.nth(1).click(); await sleep(300);
  await click(page.getByRole('button', { name: 'Start practice' }));
  await waitFor(page, (v) => v.state.match.value?.view.phase === 'live', 180000);
  await waitFor(page, (v) => { const c = v.state.match.value, R = v.state.renderer; const me = c.view.players[c.you]; return !!R.actors.get(me.entity)?.model; }, 60000);
  await page.locator('.hud .dbar').first().waitFor({ state: 'visible', timeout: 60000 });
  const who = await vale(page, (v) => { const c = v.state.match.value; const me = c.view.players[c.you]; const e = c.view.entity(me.entity); return { def: e.def, team: me.team, range: c.sim.world.entity(me.entity).stats.range }; });
  report.hero = who;
  log('hero', who);
  await page.mouse.move(960, 500);

  // instrumentation (sim side, read only) + harness send
  await vale(page, (v) => {
    const c = v.state.match.value, W = c.sim.world;
    const me = c.view.players[c.you];
    const orig = c.send.bind(c);
    window.__H = { cmds: [], trace: [], orig, me: me.entity, team: me.team };
    c.send = (cmd) => { window.__H.cmds.push({ t: W.time, wall: performance.now(), cmd: JSON.parse(JSON.stringify(cmd)) }); orig(cmd); };
    window.__harness = (cmd) => orig(cmd);
    const tick = () => {
      const e = W.entity(me.entity);
      if (e) window.__H.trace.push({ t: W.time, x: e.x, y: e.y, order: e.order, ot: e.orderTarget, ox: e.orderX, oy: e.orderY, atk: e.atkTarget, st: c.view.entity(me.entity)?.state, alive: e.alive, ncmd: window.__H.cmds.length });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__healer = setInterval(() => orig({ type: 'practice', action: 'heal' }), 2500);
    orig({ type: 'practice', action: 'toggleStructures' });
  });

  // fast-forward until the first waves meet
  await vale(page, (v) => v.state.match.value.setTimeScale(8));
  const clash = async () => vale(page, (v) => {
    const c = v.state.match.value, team = window.__H.team;
    const dummy = v.cv.c.units.find((u) => u.behavior?.dummy)?.id;
    const mins = c.view.entities.filter((e) => e.kind === 'minion' && e.alive && e.def !== dummy);
    const mine = mins.filter((e) => e.team === team), foe = mins.filter((e) => e.team !== team);
    let best = null;
    for (const a of mine) for (const b of foe) { const d = Math.hypot(a.x - b.x, a.y - b.y); if (!best || d < best.d) best = { d, ax: a.x, ay: a.y, bx: b.x, by: b.y }; }
    return best ? { ...best, nMine: mine.length, nFoe: foe.length, t: c.view.time } : { nMine: mine.length, nFoe: foe.length, t: c.view.time };
  });
  let cl = null;
  for (let i = 0; i < 400; i++) { cl = await clash(); if (cl.d !== undefined && cl.d < 9) break; await sleep(250); }
  await vale(page, (v) => v.state.match.value.setTimeScale(1));
  log('clash', cl);
  if (!cl?.d) throw new Error('no wave clash found');
  // stand 4 m behind our minion, on our side
  const park = async () => {
    const c2 = await clash();
    if (c2.d === undefined) return null;
    const ux = (c2.ax - c2.bx), uy = (c2.ay - c2.by), L = Math.hypot(ux, uy) || 1;
    const p = { x: c2.ax + (ux / L) * 4, y: c2.ay + (uy / L) * 4 };
    await vale(page, (v, p) => window.__harness({ type: 'practice', action: 'teleport', x: p.x, y: p.y }), p);
    await page.keyboard.press('KeyS');
    await sleep(700);
    return c2;
  };
  await park();
  await snap(page, 'parked');

  // page helpers
  /** screen px that pickGround maps to sim (x, y) */
  const toScreen = (x, y) => vale(page, (v, p) => {
    const R = v.state.renderer;
    let s = R.worldToScreen(p.x, p.y, 0);
    for (let i = 0; i < 3; i++) { const g = R.pickGround(s.x, s.y); if (!g) break; const a = R.worldToScreen(p.x, p.y, 0), b = R.worldToScreen(g.x, g.y, 0); s = { x: s.x + (a.x - b.x), y: s.y + (a.y - b.y) }; }
    return { x: s.x, y: s.y };
  }, { x, y });
  const state = () => vale(page, (v) => {
    const c = v.state.match.value, H = window.__H, W = c.sim.world;
    const e = W.entity(H.me);
    const R = v.state.renderer;
    const dummy = v.cv.c.units.find((u) => u.behavior?.dummy)?.id;
    const units = c.view.entities.filter((u) => u.alive && u.targetable && (u.kind === 'minion' || u.kind === 'fighter' || u.kind === 'structure' || u.kind === 'monster' || u.kind === 'summon') && u.id !== H.me)
      .map((u) => { const s = R.worldToScreen(u.x, u.y, 0); return { id: u.id, kind: u.def === dummy ? 'dummy' : u.kind, team: u.team, foe: u.team !== H.team && (u.visibleMask & (1 << H.team)) !== 0, x: u.x, y: u.y, r: u.radius, st: u.state, sx: s.x, sy: s.y }; });
    return { t: W.time, me: { x: e.x, y: e.y, order: e.order, ot: e.orderTarget, atk: e.atkTarget, alive: e.alive }, ncmd: H.cmds.length, units };
  });
  const cmdsSince = (n) => vale(page, (v, n) => window.__H.cmds.slice(n).map((c) => c.cmd), n);
  /** is the screen point on any enemy pick box (the real pick: enemies only, slop 0)? */
  const pickAt = (sx, sy, slop = 0) => vale(page, (v, a) => {
    const R = v.state.renderer, H = window.__H;
    return R.pickEntity(a.sx, a.sy, { filter: (u) => u.alive && u.targetable && u.team !== H.team && (u.visibleMask & (1 << H.team)) !== 0, slop: a.slop });
  }, { sx, sy, slop });
  const inViewBox = (s) => s.x > 40 && s.x < 1880 && s.y > 110 && s.y < 930;
  let surf = null;
  const refreshSurf = async () => { surf = await page.evaluate(() => { const out = []; for (let y = 100; y < 1080; y += 10) { const row = []; for (let x = 0; x < 1920; x += 10) { const e = document.elementFromPoint(x, y); row.push(e && e.classList.contains('hudsurface') ? 1 : 0); } out.push(row); } return out; }); };
  const onSurf = (p) => { if (!surf) return true; const r = surf[Math.floor((p.y - 100) / 10)], ok = (x, y) => { const rr = surf[Math.floor((y - 100) / 10)]; return !!rr && rr[Math.floor(x / 10)] === 1; }; return !!r && ok(p.x, p.y) && ok(p.x - 12, p.y) && ok(p.x + 12, p.y) && ok(p.x, p.y - 12) && ok(p.x, p.y + 12); };
  const inView = (s) => inViewBox(s) && onSurf(s);
  const waitIdle = async (ms = 5000) => { const t0 = Date.now(); for (;;) { const s = await state(); if (s.me.order === 0) return s; if (Date.now() - t0 > ms) return s; await sleep(100); } };
  const traceFrom = (t0) => vale(page, (v, t0) => window.__H.trace.filter((p) => p.t >= t0), t0);
  const ensureWave = async () => { const s = await state(); const foes = s.units.filter((u) => u.foe && u.kind === 'minion' && inView({ x: u.sx, y: u.sy })); if (foes.length < 3) { await park(); } };

  await refreshSurf();
  await vale(page, () => {
    const v = window.__vale, c = v.state.match.value, W = c.sim.world, H = window.__H;
    window.__M = [];
    const tick = () => {
      const e = W.entity(H.me);
      if (e) {
        let nb = 0, nbE = 0;
        for (const u of c.view.entities) { if (!u.alive || u.id === H.me || !(u.kind === 'minion' || u.kind === 'fighter')) continue; const d = Math.hypot(u.x - e.x, u.y - e.y) - (u.radius ?? 0.5) - e.radius; if (d < 0.6) { nb++; if (u.team !== H.team) nbE++; } }
        window.__M.push({ t: W.time, x: e.x, y: e.y, order: e.order, ox: e.orderX, oy: e.orderY, path: e.path.length, lane: e.lane.length, laneIdx: e.laneIdx, stall: e.arriveStall, pinned: e.arrivePinned, wst: e.watchStage, wf: e.watchFails, dear: e.laneDear, cc: !!(e.stunned || e.rooted), nb, nbE, ncmd: H.cmds.length });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  if (process.env.START_T) {
    await vale(page, (v) => v.state.match.value.setTimeScale(8));
    for (let k = 0; k < 600; k++) { const t = await vale(page, (v) => v.state.match.value.view.time); if (t >= Number(process.env.START_T)) break; await sleep(250); }
    await vale(page, (v) => v.state.match.value.setTimeScale(1));
    log('fast-forwarded to', await vale(page, (v) => v.state.match.value.view.time));
  }
  const N = Number(process.env.TRIALS ?? 10);
  const res = [];
  for (let i = 0; i < N; i++) {
    await park();
    const c2 = await clash();
    if (c2.d === undefined) { res.push({ skip: 'no clash' }); continue; }
    const ux = c2.bx - c2.ax, uy = c2.by - c2.ay, L = Math.hypot(ux, uy) || 1;
    let g = null, p = null;
    for (let k = 0; k < 16; k++) {
      const fw = 2 + (k % 4) * 1.0, lat = ((i % 3) - 1) * 1.5 + (Math.floor(k / 4) - 1.5) * 1.2;
      const gg = { x: c2.bx + (ux / L) * fw + lat * (-uy / L), y: c2.by + (uy / L) * fw + lat * (ux / L) };
      if (!(await vale(page, (v, g) => v.state.match.value.sim.world.nav.walkable(g.x, g.y), gg))) continue;
      const pp = await toScreen(gg.x, gg.y);
      if (!inView(pp)) continue;
      if ((await pickAt(pp.x, pp.y, 14)) !== null) continue;
      g = gg; p = pp; break;
    }
    if (!g) { res.push({ skip: 'no clear point' }); continue; }
    const s0 = await state();
    await page.mouse.move(p.x, p.y); await sleep(80);
    const under = await vale(page, (v, p) => { const R = v.state.renderer; const any = R.pickEntity(p.x, p.y, { filter: (u) => u.alive && u.targetable, slop: 14 }); const el = document.elementFromPoint(p.x, p.y); return { anyPick: any, cls: el ? [...el.classList].join('.') : null }; }, p);
    if (process.env.CLICK) { await page.mouse.click(p.x, p.y, { button: 'right' }); await sleep(6000); }
    else {
      await page.mouse.down({ button: 'right' });
      for (let k = 0; k < 20; k++) { await sleep(300); const q = await toScreen(g.x, g.y); if (inViewBox(q)) await page.mouse.move(q.x, q.y); }
      await page.mouse.up({ button: 'right' });
    }
    const s1 = await waitIdle(6000);
    const M = await vale(page, (v, t0) => window.__M.filter((q) => q.t >= t0), s0.t);
    const cmds = await vale(page, (v, n) => window.__H.cmds.slice(n).map((c) => ({ t: +c.t.toFixed(2), type: c.cmd.type, x: c.cmd.x !== undefined ? +c.cmd.x.toFixed(2) : undefined, y: c.cmd.y !== undefined ? +c.cmd.y.toFixed(2) : undefined, target: c.cmd.target, am: c.cmd.attackMove })), s0.ncmd);
    let wpath = 0, minD = 1e9, regress = 0, rev = 0, lastDir = null, acc = { x: 0, y: 0 };
    for (let k = 1; k < M.length; k++) {
      const dx = M[k].x - M[k - 1].x, dy = M[k].y - M[k - 1].y; wpath += Math.hypot(dx, dy);
      const dg = Math.hypot(M[k].x - g.x, M[k].y - g.y); minD = Math.min(minD, dg); regress = Math.max(regress, dg - minD);
      acc.x += dx; acc.y += dy;
      if (Math.hypot(acc.x, acc.y) > 0.5) { const d = Math.atan2(acc.y, acc.x); if (lastDir !== null) { let dd = Math.abs(d - lastDir); if (dd > Math.PI) dd = 2 * Math.PI - dd; if (dd > Math.PI / 2) rev++; } lastDir = d; acc = { x: 0, y: 0 }; }
    }
    const crowd = await vale(page, (v, g) => v.state.match.value.view.entities.filter((u) => u.alive && (u.kind === 'minion' || u.kind === 'fighter') && Math.hypot(u.x - g.x, u.y - g.y) - (u.radius ?? 0.5) < 1.2).length, g);
    const endDist = Math.hypot(s1.me.x - g.x, s1.me.y - g.y);
    // a compact timeline every ~0.25 s
    const tl = []; let lastT = -1;
    for (const q of M) if (q.t - lastT >= 0.25) { lastT = q.t; tl.push([+(q.t - s0.t).toFixed(2), +q.x.toFixed(2), +q.y.toFixed(2), q.order, +Math.hypot(q.x - g.x, q.y - g.y).toFixed(2), q.path, q.lane, q.stall, q.pinned, q.wst, q.wf, q.nb, q.nbE, q.ncmd]); }
    const r = { i, matchT: +s0.t.toFixed(1), goal: [+g.x.toFixed(2), +g.y.toFixed(2)], start: [+s0.me.x.toFixed(2), +s0.me.y.toFixed(2)], straight: +Math.hypot(g.x - s0.me.x, g.y - s0.me.y).toFixed(2), walked: +wpath.toFixed(2), reversals: rev, regress: +regress.toFixed(2), endDist: +endDist.toFixed(2), crowdAtGoal: crowd, under, cmds };
    if (endDist > 2 || rev >= 3) r.timeline = tl;
    res.push(r);
    log('trial', JSON.stringify({ ...r, timeline: undefined, cmds: cmds.length }));
    if (endDist > 2 || rev >= 3) await snap(page, `hold_${i}_FAIL`); else if (i === 0) await snap(page, `hold_${i}`);
  }
  report.scenarios.holdThroughWave = res;
  report.tlCols = ['dt', 'x', 'y', 'order', 'dGoal', 'path', 'lane', 'stall', 'pinned', 'watchStage', 'watchFails', 'bodiesTouching', 'enemyTouching', 'ncmd'];
} catch (e) {
  report.error = String(e?.stack ?? e).slice(0, 800);
  console.log('ERROR', report.error);
} finally {
  report.logs = logs.slice(0, 30);
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  log('report', OUT);
  await browser.close();
}
