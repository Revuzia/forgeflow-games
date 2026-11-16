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
const OUT = join(HERE, '_reports', `ctl_r2live_moveshoot_${FIGHTER}.json`);
mkdirSync(dirname(OUT), { recursive: true });
const report = { at: new Date().toISOString(), fighter: FIGHTER, scenarios: {}, drift: null, logs: [] };
const log = (...a) => console.log(...a);
let shotN = 0;
const snap = (page, name) => shot(page, `owner15_controls_r2_moveshoot_${FIGHTER}_${String(++shotN).padStart(2, '0')}_${name}`).catch(() => null);

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
    c.send = (cmd) => { const tv = cmd && cmd.target !== undefined ? c.view.entity(cmd.target) : null; window.__H.cmds.push({ t: W.time, wall: performance.now(), cmd: JSON.parse(JSON.stringify(cmd)), tvis: tv ? ((tv.visibleMask & (1 << me.team)) !== 0) : null }); orig(cmd); };
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

  // ── owner15 r1: Shift + left-click attack in place ─────────────────────────────────────────────
  await vale(page, () => {
    const v = window.__vale, c = v.state.match.value, W = c.sim.world, H = window.__H;
    window.__A = [];
    let prevCd = 0;
    const tick = () => {
      const e = W.entity(H.me);
      if (e) {
        const started = e.atkCd > prevCd + 1e-6;   // the cooldown restarted: an attack began
        prevCd = e.atkCd;
        window.__A.push({ t: W.time, x: e.x, y: e.y, order: e.order, cd: e.atkCd, wind: e.atkWindup, aimed: !!e.atkAimed, atk: e.atkTarget, started, face: e.facing ?? e.angle ?? null, hp: e.hp });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const atkFrom = (t0, t1 = 1e9) => vale(page, (v, a) => window.__A.filter((p) => p.t >= a.t0 && p.t <= a.t1), { t0, t1 });
  const meScr = async () => { const s = await state(); return { s, p: await toScreen(s.me.x, s.me.y) }; };
  const sumAtk = (tr) => {
    if (!tr.length) return { n: 0 };
    let maxDrift = 0;
    for (const p of tr) maxDrift = Math.max(maxDrift, Math.hypot(p.x - tr[0].x, p.y - tr[0].y));
    return { n: tr.length, attacks: tr.filter((p) => p.started).length, aimed: tr.some((p) => p.aimed), maxDrift: +maxDrift.toFixed(3), orders: [...new Set(tr.map((p) => p.order))], atkTargets: [...new Set(tr.map((p) => p.atk).filter((x) => x >= 0))], startedOn: tr.filter((p) => p.started).map((p) => (p.aimed ? 'aim' : p.atk)), startT: tr.filter((p) => p.started).map((p) => +(p.t - tr[0].t).toFixed(2)) };
  };
  const shiftClick = async (sx, sy, z = false) => {
    await page.mouse.move(sx, sy, { steps: 3 }); await sleep(60);
    if (z) await page.keyboard.down('KeyZ');
    await page.keyboard.down('Shift'); await sleep(40);
    await page.mouse.click(sx, sy);
    await sleep(40); await page.keyboard.up('Shift');
    if (z) await page.keyboard.up('KeyZ');
  };
  // MS: while moving, Shift + left-click toward the wave (6 trials): full sim trace from click - 0.2 s to + 2.2 s
  {
    const out = [];
    for (let k = 0; k < 6; k++) {
      await ensureWave();
      await page.keyboard.press('KeyS'); await sleep(1700);   // let any cooldown run out
      const { s, p } = await meScr();
      const foes = s.units.filter((u) => u.foe && u.kind === 'minion' && inView({ x: u.sx, y: u.sy }));
      const dirs = [{ x: -300, y: 60 }, { x: 40, y: -260 }, { x: 60, y: 240 }, { x: -260, y: -120 }, { x: 280, y: 160 }, { x: -120, y: 260 }];
      const tgt = { x: p.x + dirs[k].x, y: p.y + dirs[k].y };
      await page.mouse.move(tgt.x, tgt.y); await page.mouse.click(tgt.x, tgt.y, { button: 'right' });
      await sleep(450);
      const s1 = await state();
      // aim: an enemy (k even) or empty ground 4 m off to the side (k odd)
      let aim, aimKind;
      if (k % 2 === 0 && foes[0]) { const f = foes.sort((a, b) => Math.hypot(a.x - s1.me.x, a.y - s1.me.y) - Math.hypot(b.x - s1.me.x, b.y - s1.me.y))[0]; aim = await toScreen(f.x, f.y); aimKind = 'foe' + f.id + ' d' + (Math.hypot(f.x - s1.me.x, f.y - s1.me.y) - f.r).toFixed(1); }
      else { aim = await toScreen(s1.me.x + 3, s1.me.y - 3); aimKind = 'ground'; }
      const n0 = s1.ncmd, t0 = s1.t;
      await shiftClick(aim.x, aim.y);
      await sleep(2200);
      const cmds = await cmdsSince(n0);
      const tCmd = await vale(page, (v, n) => window.__H.cmds.slice(n).find((c) => c.cmd.type === 'attackAt')?.t ?? null, n0);
      const tr = await atkFrom(t0);
      const atC = tr.filter((q) => tCmd !== null && q.t >= tCmd);
      const startAfter = atC.filter((q) => q.started).map((q) => ({ dt: +(q.t - tCmd).toFixed(2), aimed: q.aimed, atk: q.atk }));
      const cdAtCmd = atC[0]?.cd ?? null;
      let moveAfter = 0; for (let i = 1; i < atC.length; i++) moveAfter += Math.hypot(atC[i].x - atC[i - 1].x, atC[i].y - atC[i - 1].y);
      const stopAt = (() => { for (let i = 1; i < atC.length; i++) if (Math.hypot(atC[i].x - atC[i - 1].x, atC[i].y - atC[i - 1].y) < 1e-4) return +(atC[i].t - tCmd).toFixed(2); return null; })();
      out.push({ k, aimKind, movedBefore: +Math.hypot(s1.me.x - s.me.x, s1.me.y - s.me.y).toFixed(2), cmds: cmds.map((c) => c.type + (c.target !== undefined ? ':t' + c.target : '')), cdAtCmd: cdAtCmd === null ? null : +cdAtCmd.toFixed(2), startAfter, moveAfterCmd: +moveAfter.toFixed(3), stopAt, orders: [...new Set(atC.map((q) => q.order))] });
      await snap(page, `MS_${k}`);
    }
    report.scenarios.moveShoot = out;
    log('MS', JSON.stringify(out));
  }
  // ZS: Z + Shift + left-click on a minion with no fighter in range (4 trials): command flag, what the attack started on
  {
    const out = [];
    for (let k = 0; k < 4; k++) {
      await park(); await refreshSurf();
      await page.keyboard.press('KeyS'); await sleep(1700);
      const s = await state();
      const f = s.units.filter((u) => u.foe && u.kind === 'minion' && inView({ x: u.sx, y: u.sy })).sort((a, b) => Math.hypot(a.x - s.me.x, a.y - s.me.y) - Math.hypot(b.x - s.me.x, b.y - s.me.y))[k % 2];
      if (!f) { out.push({ k, skip: 'no minion' }); continue; }
      await shiftClick(f.sx, f.sy, true);
      await sleep(1500);
      const cmds = await vale(page, (v, n) => window.__H.cmds.slice(n), s.ncmd);
      const tCmd = cmds.find((c) => c.cmd.type === 'attackAt')?.t ?? null;
      const tr = (await atkFrom(s.t)).filter((q) => tCmd !== null && q.t >= tCmd);
      out.push({ k, minion: f.id, dEdge: +(Math.hypot(f.x - s.me.x, f.y - s.me.y) - f.r).toFixed(2), cmds: cmds.map((c) => c.cmd.type + (c.cmd.target !== undefined ? ':t' + c.cmd.target : '') + (c.cmd.fighters ? ':F' : '')), startedOn: tr.filter((q) => q.started).map((q) => (q.aimed ? 'aim' : q.atk)), orders: [...new Set(tr.map((q) => q.order))] });
    }
    report.scenarios.zShift = out;
    log('ZS', JSON.stringify(out));
  }
} catch (e) {
  report.error = String(e?.stack ?? e).slice(0, 800);
  console.log('ERROR', report.error);
} finally {
  report.logs = logs.slice(0, 30);
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  log('report', OUT);
  await browser.close();
}
