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
const OUT = join(HERE, '_reports', `controls_${FIGHTER}.json`);
mkdirSync(dirname(OUT), { recursive: true });
const report = { at: new Date().toISOString(), fighter: FIGHTER, scenarios: {}, drift: null, logs: [] };
const log = (...a) => console.log(...a);
let shotN = 0;
const snap = (page, name) => shot(page, `controls_${FIGHTER}_${String(++shotN).padStart(2, '0')}_${name}`).catch(() => null);

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
  // ── A. right-click hold-steer ──────────────────────────────────────────────────────────────────
  {
    const res = [];
    // A1 drag along an arc, release; then a still mouse for 3 s
    await page.keyboard.press('KeyS'); await sleep(300);
    let s0 = await state();
    const t0 = s0.t, n0 = s0.ncmd;
    const pts = []; for (let i = 0; i <= 20; i++) { const a = -0.6 + i * 0.06; pts.push({ x: 960 + Math.cos(a) * -260, y: 470 + Math.sin(a) * 160 }); }
    await page.mouse.move(pts[0].x, pts[0].y);
    await page.mouse.down({ button: 'right' });
    for (const p of pts.slice(1)) { await page.mouse.move(p.x, p.y, { steps: 2 }); await sleep(70); }
    const relG = await vale(page, (v, p) => v.state.renderer.pickGround(p.x, p.y), pts[pts.length - 1]);
    await page.mouse.up({ button: 'right' });
    const s1 = await waitIdle(6000);
    await sleep(3000);
    const s2 = await state();
    const tr = await traceFrom(s1.t);
    const drift = tr.length ? Math.hypot(tr[tr.length - 1].x - tr[0].x, tr[tr.length - 1].y - tr[0].y) : null;
    const cmds = await cmdsSince(n0);
    res.push({ name: 'drag_arc_release', cmds: cmds.length, kinds: [...new Set(cmds.map((c) => c.type + (c.attackMove ? ':am' : '')))], endToRelease: Math.hypot(s1.me.x - relG.x, s1.me.y - relG.y), orderAfter: s1.me.order, driftAfterArrive3s: drift, cmdsWhileStill: s2.ncmd - s1.ncmd });
    await snap(page, 'A1_drag_release');
    // A2 press and hold perfectly still for 3 s (the locked camera follows the hero)
    await ensureWave();
    s0 = await state();
    const n2 = s0.ncmd;
    await page.mouse.move(960 + 230, 470 + 40);
    const g0 = await vale(page, (v) => v.state.renderer.pickGround(960 + 230, 470 + 40));
    await page.mouse.down({ button: 'right' });
    await sleep(3000);
    const sA = await state();
    await page.mouse.up({ button: 'right' });
    const sB = await waitIdle(4000);
    await sleep(1500);
    const sC = await state();
    const cmds2 = await cmdsSince(n2);
    res.push({ name: 'hold_still_3s', cmds: cmds2.length, endToClick: Math.hypot(sB.me.x - g0.x, sB.me.y - g0.y), orderWhileHeld: sA.me.order, movedAfterRelease: Math.hypot(sC.me.x - sB.me.x, sC.me.y - sB.me.y) });
    await snap(page, 'A2_hold_still');
    // A3 hold and wiggle tiny (< 8 px) for 2 s — a shaky hand
    s0 = await state();
    const n3 = s0.ncmd;
    await page.mouse.move(960 - 200, 470 - 60);
    await page.mouse.down({ button: 'right' });
    for (let i = 0; i < 20; i++) { await page.mouse.move(960 - 200 + (i % 2 ? 3 : -3), 470 - 60 + (i % 3) - 1); await sleep(100); }
    await page.mouse.up({ button: 'right' });
    await waitIdle(4000);
    res.push({ name: 'hold_shaky_2s', cmds: (await cmdsSince(n3)).length });
    report.scenarios.holdSteer = res;
    log('A', JSON.stringify(res));
  }

  // ── B. single clicks near terrain / walls ─────────────────────────────────────────────────────
  {
    await park();
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
    const cand = await collect();
    // spread picks: up to 6 unwalkable-edge points and 6 walkable-edge points
    const pick = (arr, n) => { const o = []; const step = Math.max(1, Math.floor(arr.length / n)); for (let i = 0; i < arr.length && o.length < n; i += step) o.push(arr[i]); return o; };
    const res = [];
    for (let i = 0; i < 14; i++) {
      const cc = (await collect()).filter((c) => inView({ x: c.sx, y: c.sy }) && Math.hypot(c.sx - 960, c.sy - 500) > 120);
      const want = i % 2 === 0;   // alternate: an unwalkable point by a wall, a walkable one by a wall
      const pool = cc.filter((c) => c.walkable === !want);
      if (!pool.length) { res.push({ skip: 'no candidate', walkable: !want }); continue; }
      const tg = pool[Math.floor(Math.random() * pool.length)];
      const s0 = await state();
      const n0 = s0.ncmd;
      // the camera follows: re-aim at the same ground point
      const sp = { x: tg.sx, y: tg.sy };
      await page.mouse.move(sp.x, sp.y);
      const under = await page.evaluate((p) => { const e = document.elementFromPoint(p.x, p.y); return e ? e.tagName.toLowerCase() + '.' + [...e.classList].join('.') : null; }, sp);
      await page.mouse.click(sp.x, sp.y, { button: 'right' });
      await sleep(200);
      const s1 = await waitIdle(9000);
      const ended = s1.me.order === 0;
      await sleep(1500);
      const tr = await traceFrom(s1.t);
      let path = 0; for (let i = 1; i < tr.length; i++) path += Math.hypot(tr[i].x - tr[i - 1].x, tr[i].y - tr[i - 1].y);
      const cmds = await cmdsSince(n0);
      res.push({ under, secs: +(s1.t - s0.t).toFixed(2), walkable: tg.walkable, cmd: cmds.map((c) => c.type + (c.target !== undefined ? '#' + c.target : '')).join(','), ended, endDist: +Math.hypot(s1.me.x - tg.gx, s1.me.y - tg.gy).toFixed(2), postArrivePath15s: +path.toFixed(2) });
    }
    report.scenarios.terrainClicks = res;
    await snap(page, 'B_terrain');
    log('B', JSON.stringify(res));
  }

  // generic unit-click trial
  /**
   * mode: 'near' (plain RMB 8 px outside the box), 'center' (plain RMB on the body), 'shift' (Shift+RMB on ground
   * 0.9 m from the intended minion in a cluster), 'amove' (A then LMB, same point), 'gap' (plain RMB on ground in
   * a gap between enemy minions: intended = a move)
   */
  const trial = async (mode, opt = {}) => {
    if (mode === 'fonly') {
      // stand 4.5 m from the sparring fighter (toward our side), so it is in view with whatever is around it
      const ok = await vale(page, (v) => {
        const c = v.state.match.value, H = window.__H, W = c.sim.world;
        const f = c.view.entities.find((u) => u.kind === 'fighter' && u.team !== H.team && u.alive);
        if (!f) return false;
        const me = W.entity(H.me);
        const dx = me.x - f.x, dy = me.y - f.y, L = Math.hypot(dx, dy) || 1;
        window.__harness({ type: 'practice', action: 'teleport', x: f.x + (dx / L) * 4.5, y: f.y + (dy / L) * 4.5 });
        return true;
      });
      if (!ok) return { mode, skip: 'no enemy fighter' };
      await page.keyboard.press('KeyS');
      await sleep(900);
    } else await ensureWave();
    const s = await state();
    const foes = s.units.filter((u) => u.foe && (opt.kind ? u.kind === opt.kind : u.kind === 'minion') && inView({ x: u.sx, y: u.sy }));
    if (!foes.length) return { mode, skip: 'no foes in view' };
    let intended = null, sp = null, ground = null;
    if (mode === 'near' || mode === 'center') {
      const moving = foes.filter((u) => u.st === 'move');
      const pool = moving.length ? moving : foes;
      const u = pool[Math.floor(Math.random() * pool.length)];
      intended = u.id;
      const geo = await vale(page, (v, id) => {
        const R = v.state.renderer, a = R.actors.get(id), u = v.state.match.value.view.entity(id);
        const f = R.worldToScreen(a.x, a.y, a.h), hd = R.worldToScreen(a.x, a.y, a.h + a.artHeight), side = R.worldToScreen(a.x + u.radius + 0.15, a.y, a.h);
        return { fx: f.x, fy: f.y, hy: hd.y, rx: Math.max(16, Math.abs(side.x - f.x)) };
      }, u.id);
      sp = mode === 'center' ? { x: geo.fx, y: (geo.fy + geo.hy) / 2 } : { x: geo.fx + geo.rx + 8 * (Math.random() < 0.5 ? 1 : -1) * 1 + (Math.random() < 0.5 ? 0 : -2 * (geo.rx + 8)) , y: (geo.fy + geo.hy) / 2 };
      if (mode === 'near') {
        sp = null;
        for (const dir of Math.random() < 0.5 ? [1, -1] : [-1, 1]) for (const yy of [(geo.fy + geo.hy) / 2, geo.fy - 6, geo.hy + 4]) {
          if (sp) break;
          const p = { x: geo.fx + dir * (geo.rx + 8), y: yy };
          if (!inView(p)) continue;
          if ((await pickAt(p.x, p.y, 0)) !== null) continue;
          if ((await pickAt(p.x, p.y, 14)) !== u.id) continue;
          sp = p;
        }
        if (!sp) return { mode, skip: 'no clean near-miss side' };
      }
    } else if (mode === 'shift' || mode === 'amove' || mode === 'fonly') {
      // a foe with another foe within 2.5 m (a cluster); click 0.9 m outward from the cluster centre, on no box
      const all = s.units.filter((u) => u.foe);
      const cluster = foes.filter((u) => foes.some((w) => w.id !== u.id && Math.hypot(w.x - u.x, w.y - u.y) < 2.5));
      const pool = mode === 'fonly' ? foes : (cluster.length ? cluster : foes);
      for (let k = 0; k < 12 && !sp; k++) {
        const u = pool[Math.floor(Math.random() * pool.length)];
        const nb = all.filter((w) => w.id !== u.id && Math.hypot(w.x - u.x, w.y - u.y) < 4);
        let cx = 0, cy = 0; for (const w of nb) { cx += w.x; cy += w.y; }
        let dx, dy;
        if (nb.length) { cx /= nb.length; cy /= nb.length; dx = u.x - cx; dy = u.y - cy; } else { const a = Math.random() * 6.28; dx = Math.cos(a); dy = Math.sin(a); }
        const L = Math.hypot(dx, dy) || 1;
        // rotate a little each attempt
        const ang = Math.atan2(dy, dx) + (k % 2 ? 1 : -1) * 0.35 * Math.floor(k / 2);
        const off = opt.off ?? 0.9;
        const g = { x: u.x + Math.cos(ang) * (u.r + off), y: u.y + Math.sin(ang) * (u.r + off) };
        const cand = all.filter((w) => mode !== 'fonly' || w.kind === 'fighter');
        // nearest by edge to g must be u (genre: the one nearest the click)
        let best = null, bd = Infinity; for (const w of cand) { const d = Math.hypot(w.x - g.x, w.y - g.y) - w.r; if (d < bd) { bd = d; best = w; } }
        if (best?.id !== u.id) continue;
        const p = await toScreen(g.x, g.y);
        if (!inView(p)) continue;
        if ((await pickAt(p.x, p.y, 14)) !== null) continue;   // not on (or within slop of) any box
        intended = u.id; sp = p; ground = g;
      }
      if (!sp) return { mode, skip: 'no clean near-miss point' };
    } else if (mode === 'gap') {
      // a ground point among/just past the enemy minions with >= 0.7 m edge clearance to every unit; not on any box (slop 0) but maybe within slop
      const all = s.units;
      for (let k = 0; k < 40 && !sp; k++) {
        const u = foes[Math.floor(Math.random() * foes.length)];
        const a = Math.random() * 6.28, d = 0.9 + Math.random() * 1.6;
        const g = { x: u.x + Math.cos(a) * (u.r + d), y: u.y + Math.sin(a) * (u.r + d) };
        if (all.some((w) => Math.hypot(w.x - g.x, w.y - g.y) - w.r < 0.7)) continue;
        const ok = await vale(page, (v, g) => v.state.match.value.sim.world.nav.walkable(g.x, g.y), g);
        if (!ok) continue;
        const p = await toScreen(g.x, g.y);
        if (!inView(p)) continue;
        if ((await pickAt(p.x, p.y, 0)) !== null) continue;
        sp = p; ground = g; intended = 'move';
      }
      if (!sp) return { mode, skip: 'no gap' };
    }
    const under = await page.evaluate((p) => { const e = document.elementFromPoint(p.x, p.y); return e ? e.tagName.toLowerCase() + '.' + [...e.classList].slice(0, 2).join('.') : null; }, sp);
    const n0 = (await state()).ncmd;
    const slopHit = mode === 'gap' ? await pickAt(sp.x, sp.y, 14) : null;
    await page.mouse.move(sp.x, sp.y);
    await sleep(80);   // hover settles (50 ms cadence)
    if (mode === 'shift') { await page.keyboard.down('Shift'); await page.mouse.click(sp.x, sp.y, { button: 'right' }); await page.keyboard.up('Shift'); }
    else if (mode === 'fonly') { await page.keyboard.down('KeyZ'); await page.keyboard.down('Shift'); await page.mouse.click(sp.x, sp.y, { button: 'right' }); await page.keyboard.up('Shift'); await page.keyboard.up('KeyZ'); }
    else if (mode === 'amove') { await page.keyboard.press('KeyA'); await sleep(40); await page.mouse.click(sp.x, sp.y, { button: 'left' }); }
    else await page.mouse.click(sp.x, sp.y, { button: 'right' });
    await sleep(60);
    const cmds = await cmdsSince(n0);
    const c0 = cmds.find((c) => c.type === 'attack' || c.type === 'move');
    const sent = !c0 ? 'none' : c0.type === 'attack' ? c0.target : c0.attackMove ? (c0.prefer ?? 'amove-ground') : 'move';
    // did the hero then attack the intended within 3 s (attacks: atk target on the trace)?
    const t0 = (await state()).t;
    if (mode === 'gap') { await sleep(200); await waitIdle(8000); } else await sleep(3000);
    const tr = await traceFrom(t0);
    const hits = [...new Set(tr.map((p) => p.atk).filter((x) => x >= 0))];
    const out = { mode, under: under?.startsWith('div.hudsurface') ? undefined : under, at: [Math.round(sp.x), Math.round(sp.y)], intended, sent, ok: sent === intended, attackedAfter: hits.slice(0, 4), extraCmds: cmds.length - 1 };
    if (mode === 'gap') { const end = tr[tr.length - 1]; out.slopWouldHit = slopHit; out.endDist = +Math.hypot(end.x - ground.x, end.y - ground.y).toFixed(2); out.orderEnd = end.order; }
    await page.keyboard.press('KeyS');
    await sleep(250);
    return out;
  };

  for (const [mode, n, opt] of [['center', 6], ['near', 10], ['shift', 10], ['amove', 8], ['gap', 10], ['fonly', 3, { kind: 'fighter', off: 1.8 }]]) {
    const res = [];
    for (let i = 0; i < n; i++) { const r = await trial(mode, opt); res.push(r); if (i === 0 || (!r.skip && !r.ok)) await snap(page, `${mode}_${i}${r.ok === false ? '_MISS' : ''}`); }
    report.scenarios[mode] = res;
    const done = res.filter((r) => !r.skip);
    log(mode, `${done.filter((r) => r.ok).length}/${done.length} ok`, JSON.stringify(res));
  }

  // ── F2. plain move straight through the enemy wave to a point 6 m past it ─────────────────────
  {
    const res = [];
    for (let i = 0; i < 6; i++) {
      await park();
      const c2 = await clash();
      const ux = c2.bx - c2.ax, uy = c2.by - c2.ay, L = Math.hypot(ux, uy) || 1;
      let g = null, p = null, walk = false, onBox = null;
      for (let k = 0; k < 12; k++) {
        const fw = 1.5 + (k % 4) * 1.2, lat = ((i % 4) - 1.5) * 1.5 + (Math.floor(k / 4) - 1) * 1.5;
        const gg = { x: c2.bx + (ux / L) * fw + lat * (-uy / L), y: c2.by + (uy / L) * fw + lat * (ux / L) };
        const ww = await vale(page, (v, g) => v.state.match.value.sim.world.nav.walkable(g.x, g.y), gg);
        if (!ww) continue;
        const pp = await toScreen(gg.x, gg.y);
        if (!inView(pp)) continue;
        if ((await pickAt(pp.x, pp.y, 14)) !== null) continue;
        g = gg; p = pp; walk = ww; break;
      }
      if (!g) { res.push({ skip: 'no clear point past the wave' }); continue; }
      const s0 = await state();
      await page.mouse.move(p.x, p.y); await sleep(60);
      await page.mouse.click(p.x, p.y, { button: 'right' });
      await sleep(200);
      const cmds = await cmdsSince(s0.ncmd);
      if (i === 1) { await sleep(2000); await snap(page, 'F2_mid_walk'); }
      const s1 = await waitIdle(12000);
      const wtr = await traceFrom(s0.t);
      let wpath = 0, rev = 0, lastDir = null, acc = { x: 0, y: 0 };
      for (let k = 1; k < wtr.length; k++) {
        const dx = wtr[k].x - wtr[k - 1].x, dy = wtr[k].y - wtr[k - 1].y; wpath += Math.hypot(dx, dy);
        acc.x += dx; acc.y += dy;
        if (Math.hypot(acc.x, acc.y) > 0.4) { const d = Math.atan2(acc.y, acc.x); if (lastDir !== null) { let dd = Math.abs(d - lastDir); if (dd > Math.PI) dd = 2 * Math.PI - dd; if (dd > Math.PI / 2) rev++; } lastDir = d; acc = { x: 0, y: 0 }; }
      }
      const straight = Math.hypot(g.x - s0.me.x, g.y - s0.me.y);
      await sleep(1500);
      const tr = await traceFrom(s1.t);
      let path = 0; for (let k = 1; k < tr.length; k++) path += Math.hypot(tr[k].x - tr[k - 1].x, tr[k].y - tr[k - 1].y);
      res.push({ straight: +straight.toFixed(2), walked: +wpath.toFixed(2), reversals: rev, walkable: walk, onEnemyBox: onBox, cmd: cmds.map((c) => c.type + (c.target !== undefined ? '#' + c.target : '')).join(','), ended: s1.me.order === 0, secs: +(s1.t - s0.t).toFixed(2), endDist: +Math.hypot(s1.me.x - g.x, s1.me.y - g.y).toFixed(2), postArrivePath: +path.toFixed(2) });
      if (i === 0) await snap(page, 'F2_through_wave');
    }
    report.scenarios.throughWave = res;
    log('F2', JSON.stringify(res));
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
