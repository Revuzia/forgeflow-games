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
const OUT = join(HERE, '_reports', `owner15r2_shoot_${FIGHTER}.json`);
mkdirSync(dirname(OUT), { recursive: true });
const report = { at: new Date().toISOString(), fighter: FIGHTER, scenarios: {}, drift: null, logs: [] };
const log = (...a) => console.log(...a);
let shotN = 0;
const snap = (page, name) => shot(page, `owner15_controls_r2_${FIGHTER}_${String(++shotN).padStart(2, '0')}_${name}`).catch(() => null);

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
  const SH = {};
  const range = report.hero.range;

  // SH1 enemy in range: Shift + left-click on/near an enemy minion inside reach
  {
    await ensureWave();
    const out = [];
    for (let k = 0; k < 3; k++) {
      await page.keyboard.press('KeyS'); await sleep(400);
      const { s } = await meScr();
      const foes = s.units.filter((u) => u.foe && u.kind === 'minion' && inView({ x: u.sx, y: u.sy }))
        .map((u) => ({ ...u, d: Math.hypot(u.x - s.me.x, u.y - s.me.y) - u.r })).sort((a, b) => a.d - b.d);
      const f = foes[k] ?? foes[0];
      if (!f) { out.push({ k, skip: 'no visible foe' }); await park(); continue; }
      if (f.d > range + 0.3) {   // step close enough with a harness teleport (stand 0.8 range away)
        const ux = s.me.x - f.x, uy = s.me.y - f.y, L = Math.hypot(ux, uy) || 1;
        await vale(page, (v, p) => window.__harness({ type: 'practice', action: 'teleport', x: p.x, y: p.y }), { x: f.x + (ux / L) * (f.r + range * 0.7), y: f.y + (uy / L) * (f.r + range * 0.7) });
        await page.keyboard.press('KeyS'); await sleep(500);
      }
      const s1 = await state();
      const ff = s1.units.find((u) => u.id === f.id);
      if (!ff) { out.push({ k, skip: 'foe gone' }); continue; }
      const off = k === 2 ? 30 : 0;   // k=2: click 30 px beside it (nearest-to-click acquisition)
      const n0 = s1.ncmd, t0 = s1.t;
      await shiftClick(ff.sx + off, ff.sy + off * 0.3);
      await sleep(1400);
      const cmds = await cmdsSince(n0);
      const tr = sumAtk(await atkFrom(t0));
      const s2 = await state();
      const hpAfter = s2.units.find((u) => u.id === f.id);
      out.push({ k, off, foe: f.id, dEdge: +Math.hypot(ff.x - s1.me.x, ff.y - s1.me.y).toFixed(2), range, cmds: cmds.map((c) => c.type + (c.target !== undefined ? ':t' + c.target : '') + (c.fighters ? ':F' : '')), ...tr });
      await snap(page, `SH1_enemy_${k}`);
    }
    SH.enemyInRange = out;
    log('SH1', JSON.stringify(out));
  }

  // SH2 empty ground in 8 directions (away from / across / toward the wave): fires/swings, never moves
  {
    await page.keyboard.press('KeyS'); await sleep(400);
    const out = [];
    for (let i = 0; i < 8; i++) {
      const { s, p } = await meScr();
      const a = (i / 8) * Math.PI * 2;
      const tx = s.me.x + Math.cos(a) * 4.5, ty = s.me.y + Math.sin(a) * 4.5;
      const sp = await toScreen(tx, ty);
      if (!inViewBox(sp)) { out.push({ i, skip: 'offscreen' }); continue; }
      const n0 = s.ncmd, t0 = s.t;
      await shiftClick(sp.x, sp.y);
      await sleep(1300);
      const cmds = await cmdsSince(n0);
      const tr = sumAtk(await atkFrom(t0));
      out.push({ i, dir: +(a * 180 / Math.PI).toFixed(0), cmds: cmds.map((c) => c.type + (c.target !== undefined ? ':t' + c.target : '')), ...tr });
      if (i % 3 === 0) await snap(page, `SH2_ground_dir${i}`);
    }
    SH.groundDirs = out;
    log('SH2', JSON.stringify(out));
  }

  // SH3 hold Shift + left while sweeping the cursor in a full circle for 4 s
  {
    await ensureWave();
    await page.keyboard.press('KeyS'); await sleep(400);
    const { s, p } = await meScr();
    const n0 = s.ncmd, t0 = s.t;
    const pt = (i) => ({ x: p.x + Math.cos(i * 0.157) * 220, y: p.y + Math.sin(i * 0.157) * 140 });
    await page.mouse.move(pt(0).x, pt(0).y);
    await page.keyboard.down('Shift'); await sleep(40);
    await page.mouse.down();
    const w0 = Date.now();
    for (let i = 1; i <= 40; i++) { await page.mouse.move(pt(i).x, pt(i).y, { steps: 2 }); await sleep(90); if (i === 20) await snap(page, 'SH3_sweep_mid'); }
    const held = (Date.now() - w0) / 1000;
    await page.mouse.up();
    await sleep(40); await page.keyboard.up('Shift');
    const sRel = await state();
    await sleep(1500);
    const cmds = await cmdsSince(n0);
    const trHold = sumAtk(await atkFrom(t0, sRel.t));
    const trAfter = sumAtk(await atkFrom(sRel.t + 0.35));
    const after = await atkFrom(sRel.t + 0.6);
    const atkSpeed = await vale(page, () => { const c = window.__vale.state.match.value; return c.sim.world.entity(window.__H.me).stats.attackSpeed ?? null; });
    // aim follows the cursor: distinct attackAt points
    const pts = cmds.filter((c) => c.type === 'attackAt').map((c) => [Math.round(c.x * 2) / 2, Math.round(c.y * 2) / 2].join(','));
    SH.holdSweep = { heldS: +held.toFixed(2), cmds: cmds.length, kinds: [...new Set(cmds.map((c) => c.type))], distinctAims: new Set(pts).size, atkSpeed, hold: trHold, afterRelease: trAfter, orderLateAfter: [...new Set(after.map((q) => q.order))] };
    log('SH3', JSON.stringify(SH.holdSweep));
  }

  // SH3b let go of Shift while the button stays down: it stops
  {
    await page.keyboard.press('KeyS'); await sleep(300);
    const { s, p } = await meScr();
    await page.mouse.move(p.x + 200, p.y - 40);
    await page.keyboard.down('Shift'); await sleep(40);
    await page.mouse.down();
    await sleep(1200);
    await page.keyboard.up('Shift');
    const sUp = await state();
    await sleep(1200);
    await page.mouse.up();
    await sleep(300);
    const cmdsAfter = (await cmdsSince(sUp.ncmd));
    const trAfter = sumAtk(await atkFrom(sUp.t + 0.4));
    SH.releaseModifier = { cmdsAfterShiftUp: cmdsAfter.map((c) => c.type), ...trAfter };
    log('SH3b', JSON.stringify(SH.releaseModifier));
  }

  // SH4 while moving: walk, then Shift + left-click toward the wave: stops and shoots
  {
    await ensureWave();
    const out = [];
    for (let k = 0; k < 2; k++) {
      await page.keyboard.press('KeyS'); await sleep(300);
      const { s, p } = await meScr();
      const foes = s.units.filter((u) => u.foe && inView({ x: u.sx, y: u.sy }));
      // walk away from / across the wave 8 m
      const tgt = k === 0 ? { x: p.x - 300, y: p.y + 60 } : { x: p.x + 40, y: p.y - 260 };
      await page.mouse.move(tgt.x, tgt.y); await page.mouse.click(tgt.x, tgt.y, { button: 'right' });
      await sleep(450);
      const s1 = await state();
      const aim = foes[0] ? await toScreen(foes[0].x, foes[0].y) : { x: p.x + 200, y: p.y };
      const n0 = s1.ncmd, t0 = s1.t;
      await shiftClick(aim.x, aim.y);
      const s2 = await state();
      await sleep(1300);
      const tr = await atkFrom(s2.t + 0.15);
      const sm = sumAtk(tr);
      out.push({ k, movedBefore: +Math.hypot(s1.me.x - s.me.x, s1.me.y - s.me.y).toFixed(2), cmds: (await cmdsSince(n0)).map((c) => c.type), ...sm });
      await snap(page, `SH4_moving_${k}`);
    }
    SH.whileMoving = out;
    log('SH4', JSON.stringify(out));
  }

  // SH5 fog: a Shift + left-click on a hidden enemy (if any is on screen) or far into the dark: never targets the unseen, never moves
  {
    await page.keyboard.press('KeyS'); await sleep(300);
    const hidden = await vale(page, () => {
      const v = window.__vale, c = v.state.match.value, H = window.__H, R = v.state.renderer;
      return c.view.entities.filter((u) => u.alive && u.team !== H.team && (u.kind === 'minion' || u.kind === 'fighter') && (u.visibleMask & (1 << H.team)) === 0)
        .map((u) => ({ id: u.id, kind: u.kind, x: u.x, y: u.y, s: R.worldToScreen(u.x, u.y, 0) }));
    });
    let visHidden = hidden.filter((h) => inView(h.s));
    const out = [];
    if (!visHidden[0] && hidden[0]) {
      // stand 13 m short of the nearest hidden enemy (on our side of it), so it is on screen but still unseen
      const me0 = (await state()).me;
      const h = hidden.slice().sort((a, b) => Math.hypot(a.x - me0.x, a.y - me0.y) - Math.hypot(b.x - me0.x, b.y - me0.y))[0];
      for (const dd of [13, 11.5, 10]) {
        const ux = me0.x - h.x, uy = me0.y - h.y, L = Math.hypot(ux, uy) || 1;
        await vale(page, (v, p) => window.__harness({ type: 'practice', action: 'teleport', x: p.x, y: p.y }), { x: h.x + (ux / L) * dd, y: h.y + (uy / L) * dd });
        await page.keyboard.press('KeyS'); await sleep(900);
        await refreshSurf();
        const hid2 = await vale(page, () => {
          const v = window.__vale, c = v.state.match.value, H = window.__H, R = v.state.renderer;
          return c.view.entities.filter((u) => u.alive && u.team !== H.team && (u.kind === 'minion' || u.kind === 'fighter') && (u.visibleMask & (1 << H.team)) === 0)
            .map((u) => ({ id: u.id, kind: u.kind, x: u.x, y: u.y, s: R.worldToScreen(u.x, u.y, 0) }));
        });
        for (const x of hid2) if (!hidden.some((y) => y.id === x.id)) hidden.push(x);
        visHidden = hid2.filter((q) => inView(q.s));
        if (visHidden[0]) break;
      }
    }
    const { s, p } = await meScr();
    const pts = [];
    if (visHidden[0]) pts.push({ why: 'hidden ' + visHidden[0].kind, id: visHidden[0].id, x: visHidden[0].s.x, y: visHidden[0].s.y });
    // far ground on the play surface (not the HUD), 12-16 m out
    for (const a of [0.3, 0.8, 1.6, 2.2, 2.9, 3.6, 4.3, 5.0, 5.7]) {
      if (pts.filter((q) => q.why.startsWith('far')).length >= 2) break;
      for (const rr of [16, 14, 12, 10, 9]) { const sp = await toScreen(s.me.x + Math.cos(a) * rr, s.me.y + Math.sin(a) * rr); if (inView(sp)) { pts.push({ why: 'far ground ' + rr + 'm', x: sp.x, y: sp.y }); break; } }
    }
    for (const q of pts) {
      if (!inView(q)) { out.push({ ...q, skip: 'offscreen' }); continue; }
      const s1 = await state();
      await shiftClick(q.x, q.y);
      await sleep(1200);
      const cmds = await cmdsSince(s1.ncmd);
      out.push({ why: q.why, hid: q.id, cmds: cmds.map((c) => c.type + (c.target !== undefined ? ':t' + c.target : '')), targetedHidden: cmds.some((c) => c.target !== undefined && hidden.some((h) => h.id === c.target)), targetVisAtSend: await vale(page, (v, n) => window.__H.cmds.slice(n).map((c) => c.tvis), s1.ncmd), ...sumAtk(await atkFrom(s1.t)) });
    }
    SH.fog = { hiddenTotal: hidden.length, hiddenOnScreen: visHidden.length, out };
    await snap(page, 'SH5_fog');
    log('SH5', JSON.stringify(SH.fog));
  }

  // SH6 Z (fighters only) + Shift + left-click on a minion: fighters flag, never takes the minion
  {
    await park(); await refreshSurf();
    await page.keyboard.press('KeyS'); await sleep(300);
    const s = await state();
    const f = s.units.filter((u) => u.foe && u.kind === 'minion' && inView({ x: u.sx, y: u.sy })).sort((a, b) => Math.hypot(a.x - s.me.x, a.y - s.me.y) - Math.hypot(b.x - s.me.x, b.y - s.me.y))[0];
    const fighter = s.units.find((u) => u.foe && u.kind === 'fighter');
    if (f) {
      await shiftClick(f.sx, f.sy, true);
      await sleep(1200);
      const cmds = await cmdsSince(s.ncmd);
      const tr = sumAtk(await atkFrom(s.t));
      SH.fightersOnly = { minion: f.id, fighterVisible: fighter ? { id: fighter.id, d: +Math.hypot(fighter.x - s.me.x, fighter.y - s.me.y).toFixed(1) } : null, cmds: cmds.map((c) => c.type + (c.target !== undefined ? ':t' + c.target : '') + (c.fighters ? ':F' : '')), tookMinion: tr.atkTargets?.includes(f.id) ?? false, ...tr };
    } else SH.fightersOnly = { skip: 'no minion' };
    await snap(page, 'SH6_z');
    log('SH6', JSON.stringify(SH.fightersOnly));
  }

  // R regressions: plain left-click selects only; right-click ground moves; right-click enemy attacks; Shift+RMB and A-click attack-move
  {
    await ensureWave();
    const out = {};
    await page.keyboard.press('KeyS'); await sleep(300);
    let s = await state();
    let f = s.units.filter((u) => u.foe && u.kind === 'minion' && inView({ x: u.sx, y: u.sy }))[0];
    if (f) { await page.mouse.move(f.sx, f.sy); await page.mouse.click(f.sx, f.sy); await sleep(800); const c = await cmdsSince(s.ncmd); const tr = sumAtk(await atkFrom(s.t)); out.leftClickEnemy = { cmds: c.map((x) => x.type), ...tr }; }
    await page.keyboard.press('KeyS'); await sleep(300);
    s = await state();
    let { p } = await meScr();
    await page.mouse.move(p.x - 250, p.y + 80); await page.mouse.click(p.x - 250, p.y + 80); await sleep(800);
    out.leftClickGround = { cmds: (await cmdsSince(s.ncmd)).map((x) => x.type), ...sumAtk(await atkFrom(s.t)) };
    s = await state();
    await page.mouse.move(p.x - 250, p.y + 80); await page.mouse.click(p.x - 250, p.y + 80, { button: 'right' }); await sleep(1800);
    let s2 = await state();
    out.rightClickGround = { cmds: (await cmdsSince(s.ncmd)).map((x) => x.type + (x.attackMove ? ':am' : '')), moved: +Math.hypot(s2.me.x - s.me.x, s2.me.y - s.me.y).toFixed(2) };
    await ensureWave();
    await page.keyboard.press('KeyS'); await sleep(300);
    s = await state();
    f = s.units.filter((u) => u.foe && u.kind === 'minion' && inView({ x: u.sx, y: u.sy }))[0];
    if (f) { await page.mouse.move(f.sx, f.sy); await page.mouse.click(f.sx, f.sy, { button: 'right' }); await sleep(1200); out.rightClickEnemy = { foe: f.id, cmds: (await cmdsSince(s.ncmd)).map((x) => x.type + (x.target !== undefined ? ':t' + x.target : '')), ...sumAtk(await atkFrom(s.t)) }; }
    await page.keyboard.press('KeyS'); await sleep(300);
    s = await state(); ({ p } = await meScr());
    await page.mouse.move(p.x + 260, p.y - 90); await page.keyboard.down('Shift'); await page.mouse.click(p.x + 260, p.y - 90, { button: 'right' }); await page.keyboard.up('Shift'); await sleep(1500);
    out.shiftRightClick = { cmds: (await cmdsSince(s.ncmd)).map((x) => x.type + (x.attackMove ? ':am' : '') + (x.target !== undefined ? ':t' + x.target : '')) };
    await page.keyboard.press('KeyS'); await sleep(300);
    s = await state(); ({ p } = await meScr());
    await page.mouse.move(p.x + 260, p.y + 60); await page.keyboard.press('KeyA'); await sleep(100); await page.mouse.click(p.x + 260, p.y + 60); await sleep(1500);
    out.aClick = { cmds: (await cmdsSince(s.ncmd)).map((x) => x.type + (x.attackMove ? ':am' : '') + (x.target !== undefined ? ':t' + x.target : '')) };
    await snap(page, 'R_regress');
    SH.regress = out;
    log('R', JSON.stringify(out));
  }
  report.scenarios.shoot = SH;

  // aim line visible while Shift is held (renderer telegraph count) — screenshot evidence
  {
    const { p } = await meScr();
    await page.mouse.move(p.x + 180, p.y - 60);
    await page.keyboard.down('Shift'); await sleep(300);
    await snap(page, 'AIM_line');
    await page.keyboard.up('Shift');
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
