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
const OUT = join(HERE, '_reports', `controls_terrain_${FIGHTER}.json`);
mkdirSync(dirname(OUT), { recursive: true });
const report = { at: new Date().toISOString(), fighter: FIGHTER, scenarios: {}, drift: null, logs: [] };
const log = (...a) => console.log(...a);
let shotN = 0;
const snap = (page, name) => shot(page, `controls_r2terrain_${FIGHTER}_${String(++shotN).padStart(2, '0')}_${name}`).catch(() => null);

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
  {
    const collect = () => vale(page, (v) => {
      const c = v.state.match.value, W = c.sim.world, R = v.state.renderer, nav = W.nav;
      const out = [];
      for (let sy = 150; sy < 790; sy += 24) for (let sx = 180; sx < 1740; sx += 24) {
        const g = R.pickGround(sx, sy); if (!g) continue;
        const wk = nav.walkable(g.x, g.y);
        let nearOther = false;
        for (let a = 0; a < 8 && !nearOther; a++) { const q = nav.walkable(g.x + Math.cos(a * 0.785) * 1.2, g.y + Math.sin(a * 0.785) * 1.2); if (q !== wk) nearOther = true; }
        if (nearOther) out.push({ sx, sy, gx: g.x, gy: g.y, walkable: wk });
      }
      return out;
    });
    const res = [];
    for (let i = 0; i < 36; i++) {
      if (i % 6 === 0) { await park(); if (i % 12 === 6) { await vale(page, () => { const c = window.__vale.state.match.value; const W = c.sim.world; const e = W.entity(window.__H.me); window.__harness({ type: 'practice', action: 'teleport', x: e.x - 14, y: e.y + 6 }); }); await sleep(600); } }
      const cc = (await collect()).filter((c) => inView({ x: c.sx, y: c.sy }) && Math.hypot(c.sx - 960, c.sy - 500) > 120);
      const want = i % 2 === 0;
      const pool = cc.filter((c) => c.walkable === !want);
      if (!pool.length) { res.push({ skip: 'no candidate' }); continue; }
      const tg = pool[Math.floor(Math.random() * pool.length)];
      const s0 = await state();
      await page.mouse.move(tg.sx, tg.sy);
      await page.mouse.click(tg.sx, tg.sy, { button: 'right' });
      await sleep(200);
      const s1 = await waitIdle(9000);
      const ended = s1.me.order === 0;
      await sleep(1500);
      const s2 = await state();
      const cmds = await cmdsSince(s0.ncmd);
      const r = { i, walkable: tg.walkable, goal: [+tg.gx.toFixed(2), +tg.gy.toFixed(2)], cmds: cmds.map((c) => c.type + (c.attackMove ? ':am' : '') + (c.target !== undefined ? '#' + c.target : '')), secs: +(s1.t - s0.t).toFixed(2), ended, endDist: +Math.hypot(s1.me.x - tg.gx, s1.me.y - tg.gy).toFixed(2), orderAfter: s2.me.order };
      if (!ended) {
        const tr = await traceFrom(s0.t);
        r.trace = tr.filter((_, k) => k % 6 === 0).map((p) => [+p.t.toFixed(2), +p.x.toFixed(2), +p.y.toFixed(2), p.order, p.ot, +(p.ox ?? -1).toFixed?.(2), +(p.oy ?? -1).toFixed?.(2), p.atk, p.st]);
        r.nearUnits = (await state()).units.filter((u) => Math.hypot(u.x - s2.me.x, u.y - s2.me.y) < 5).map((u) => [u.id, u.kind, u.team, +u.x.toFixed(1), +u.y.toFixed(1), u.st]);
        await snap(page, `stuck_${i}`);
      }
      res.push(r);
      log(JSON.stringify({ ...r, trace: r.trace ? r.trace.length : undefined }));
    }
    report.scenarios.terrainClicks = res;
  }

  // ── idle drift over the whole run: movement while the sim order is none, with no command in the last 0.3 s ──
  report.drift = await vale(page, () => {
    const T = window.__H.trace, C = window.__H.cmds;
    const eps = [];
    let cur = null;
    for (let i = 1; i < T.length; i++) {
      const a = T[i - 1], b = T[i];
      const recent = C.some((c) => c.t <= b.t && c.t > b.t - 0.3);
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const idle = a.order === 0 && b.order === 0 && a.alive && b.alive && !recent && d < 3;   // d < 3: not a teleport
      if (idle && d > 1e-4) { if (!cur) cur = { t0: a.t, t1: b.t, dist: 0, st: new Set() }; cur.t1 = b.t; cur.dist += d; cur.st.add(b.st); }
      else if (cur && (!idle || d <= 1e-4)) { if (cur.dist > 0.15) eps.push({ t0: +cur.t0.toFixed(2), t1: +cur.t1.toFixed(2), dist: +cur.dist.toFixed(2), st: [...cur.st] }); cur = null; }
    }
    // orders that changed with no command: move → something else (not none) or none → move/attack
    const flips = [];
    for (let i = 1; i < T.length; i++) { const a = T[i - 1], b = T[i]; if (a.order !== b.order && b.order !== 0 && !C.some((c) => c.t <= b.t + 1e-6 && c.t > b.t - 0.25)) flips.push({ t: +b.t.toFixed(2), from: a.order, to: b.order }); }
    return { episodes: eps, totalDist: +eps.reduce((s, e) => s + e.dist, 0).toFixed(2), uncommandedOrderStarts: flips.slice(0, 20), nFlips: flips.length, samples: T.length, commands: C.length };
  });
  log('drift', JSON.stringify(report.drift));
  await snap(page, 'end');
} catch (e) {
  report.error = String(e?.stack ?? e).slice(0, 800);
  console.log('ERROR', report.error);
  await snap(page, 'ERROR');
} finally {
  report.logs = logs.slice(0, 30);
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  log('report', OUT);
  await browser.close();
}
