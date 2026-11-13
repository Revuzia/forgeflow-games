// VALE harness — round-4 live verify of the click / pathing fixes (ruling 38), extending verify_controls_r3.mjs: held-button re-send, Shift-hold attack-move, flags on every walk.
// near misses at measured 4/8/12 px, wall-face clicks in four screen directions, hold-steer along walls and through a wave.
// node _harness/verify_controls_r4.mjs <fighterId> → _harness/_reports/controls_r4_<fighter>.json, shots controls_r4_*.png
// (base notes:) live-play verify of the click / pathing fixes (ruling 33). A RIFT practice match in real Chrome,
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
const OUT = join(HERE, '_reports', `controls_r4_${FIGHTER}.json`);
mkdirSync(dirname(OUT), { recursive: true });
const report = { at: new Date().toISOString(), fighter: FIGHTER, scenarios: {}, drift: null, logs: [] };
const log = (...a) => console.log(...a);
let _seed = 0x9e3779b9 ^ [...FIGHTER].reduce((s, c) => s * 31 + c.charCodeAt(0), 7);
const rnd = () => { _seed |= 0; _seed = (_seed + 0x6d2b79f5) | 0; let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
let shotN = 0;
const snap = (page, name) => shot(page, `controls_r4_${FIGHTER}_${String(++shotN).padStart(2, '0')}_${name}`).catch(() => null);

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
      if (e) { const H = window.__H; if (H.prevWind !== undefined) { if (e.atkWindup > 0 && (H.prevWind <= 0 || e.atkWindup > H.prevWind + 1e-6)) (H.atkEv ??= []).push({ t: W.time, start: true, tgt: e.atkTarget }); else if (H.prevWind > 0 && e.atkWindup === -1 && H.prevWind - (W.time - H.prevWT) > 0.03) (H.atkEv ??= []).push({ t: W.time, cancel: true, left: H.prevWind - (W.time - H.prevWT), order: e.order, tgt: e.atkTarget }); } H.prevWind = e.atkWindup; H.prevWT = W.time; }
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
  // ── r3 instrumentation: at every pointerdown (capture, before the controller), what the real pick sees ──
  await vale(page, () => {
    const v = window.__vale, R = v.state.renderer, H = window.__H;
    H.downs = [];
    const foe = (u) => u.alive && u.targetable && u.team !== H.team && (u.visibleMask & (1 << H.team)) !== 0;
    const gapTo = (x, y, id) => {
      if (id === null || id === undefined || typeof id !== 'number') return null;
      const only = { filter: (u) => u.id === id };
      if (R.pickEntity(x, y, { ...only, slop: 0 }) === id) return 0;
      if (R.pickEntity(x, y, { ...only, slop: 60 }) !== id) return 99;
      let lo = 0, hi = 60;
      for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (R.pickEntity(x, y, { ...only, slop: m }) === id) hi = m; else lo = m; }
      return +hi.toFixed(2);
    };
    H.gapTo = gapTo;
    window.addEventListener('pointerdown', (e) => {
      const x = e.clientX, y = e.clientY;
      const on = R.pickEntity(x, y, { filter: foe });
      const slopMF = R.pickEntity(x, y, { filter: (u) => foe(u) && (u.kind === 'minion' || u.kind === 'fighter'), slop: 14 });
      const g = R.pickGround(x, y);
      const amRule = (fOnly) => {
        const ok = (u) => foe(u) && (!fOnly || u.kind === 'fighter');
        const on = R.pickEntity(x, y, { filter: ok, slop: 14 });
        if (on !== null) return on;
        if (!g) return 'ground';
        let best = null, bd = Infinity;
        for (const u of v.state.match.value.view.entities) { if (!ok(u) || u.kind === 'pickup' || u.kind === 'projectile' || u.kind === 'zone') continue; const at = R.unitPos(u.id) ?? u; const d = Math.hypot(at.x - g.x, at.y - g.y) - u.radius; if (d <= (fOnly ? 3 : 2) && (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && best !== null && u.id < best))) { bd = d; best = u.id; } }
        return best ?? 'ground';
      };
      H.downs.push({ amRule: amRule(false), amRuleF: amRule(true), t: v.state.match.value.sim.world.time, x, y, button: e.button, shift: e.shiftKey, intended: H.intended, onBox: on, slopPick: slopMF, gapIntended: gapTo(x, y, H.intended), ground: R.pickGround(x, y) });
    }, { capture: true });
  });
  const lastDown = () => vale(page, () => window.__H.downs[window.__H.downs.length - 1] ?? null);
  const setIntended = (id) => vale(page, (v, id) => { window.__H.intended = id; }, id);

  /** trace metrics for a move toward ground point g starting at sim time t0 */
  const moveMetrics = async (t0, g, tEnd) => vale(page, (v, a) => {
    const T = window.__H.trace.filter((p) => p.t >= a.t0 && (a.tEnd === null || p.t <= a.tEnd));
    if (!T.length) return null;
    const d = (p) => Math.hypot(p.x - a.g.x, p.y - a.g.y);
    const d0 = d(T[0]);
    let path = 0, maxAway = 0, regress = 0, minD = d0, teleports = 0;
    for (let i = 1; i < T.length; i++) {
      const s = Math.hypot(T[i].x - T[i - 1].x, T[i].y - T[i - 1].y);
      if (s > 3) { teleports++; continue; }
      path += s;
      const di = d(T[i]);
      maxAway = Math.max(maxAway, di - d0);
      regress = Math.max(regress, di - minD);
      minD = Math.min(minD, di);
    }
    const end = T[T.length - 1];
    return { d0: +d0.toFixed(2), path: +path.toFixed(2), net: +Math.hypot(end.x - T[0].x, end.y - T[0].y).toFixed(2), endDist: +d(end).toFixed(2), maxAway: +maxAway.toFixed(2), regress: +regress.toFixed(2), teleports, end: { x: +end.x.toFixed(2), y: +end.y.toFixed(2) }, order: end.order };
  }, { t0, g, tEnd: tEnd ?? null });
  const postPath = async (t0) => vale(page, (v, t0) => { const T = window.__H.trace.filter((p) => p.t >= t0); let s = 0; for (let i = 1; i < T.length; i++) { const d = Math.hypot(T[i].x - T[i - 1].x, T[i].y - T[i - 1].y); if (d < 3) s += d; } return +s.toFixed(3); }, t0);
  const fmt = (cmds) => cmds.map((c) => c.type + (c.target !== undefined ? '#' + c.target : '') + (c.attackMove ? ':am' : '')).join(',');
  const flags = [];   // every case: moved away > 1 m, kept moving with no command, wrong target
  report.flags = flags;

  // ── N. plain right-click near misses on moving enemy minions at 4 / 8 / 12 px (and 0 = centre, 24 = control) ──
  {
    const planNear = (id, off, dir) => vale(page, (v, a) => {
      const R = v.state.renderer, H = window.__H, act = R.actors.get(a.id);
      if (!act) return { err: 'no actor' };
      const foe = (u) => u.alive && u.targetable && u.team !== H.team && (u.visibleMask & (1 << H.team)) !== 0;
      const f = R.worldToScreen(act.x, act.y, act.h), hd = R.worldToScreen(act.x, act.y, act.h + act.artHeight);
      const only = { filter: (u) => u.id === a.id };
      for (const d of [a.dir, -a.dir]) for (const fr of [0.5, 0.35, 0.65]) {
        const y = f.y + (hd.y - f.y) * fr, ax = f.x + (hd.x - f.x) * fr;
        if (a.off === 0) {
          const p = { x: ax, y };
          if (R.pickEntity(p.x, p.y, { filter: foe }) === a.id) return { p, dir: 0, fr };
          continue;
        }
        let k = 0; while (k < 300 && R.pickEntity(ax + d * k, y, only) === a.id) k++;
        if (k >= 300 || k === 0) continue;
        // last inside pixel ax + d*(k-1); bisect the edge to 0.05 px
        let lo = k - 1, hi = k;
        for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (R.pickEntity(ax + d * m, y, only) === a.id) lo = m; else hi = m; }
        const p = { x: ax + d * (hi + a.off), y };
        if (R.pickEntity(p.x, p.y, { filter: foe }) !== null) continue;     // on another box
        const sl = R.pickEntity(p.x, p.y, { filter: (u) => foe(u) && (u.kind === 'minion' || u.kind === 'fighter'), slop: 14 });
        if (a.off <= 13 && sl !== a.id) continue;      // another enemy is nearer: ambiguous, not a test of this unit
        if (a.off > 14 && R.pickEntity(p.x, p.y, { filter: foe, slop: 14 }) !== null) continue;   // the control must be clear of every box
        return { p, dir: d, fr, gapPlanned: H.gapTo(p.x, p.y, a.id) };
      }
      return { err: 'no clean side' };
    }, { id, off, dir });
    const res = {};
    for (const off of [0, 4, 8, 12, 24]) {
      const n = off === 0 ? 6 : off === 24 ? 6 : 8;
      const out = [];
      let skips = 0;
      for (let i = 0; i < n && skips < 12; i++) {
        await ensureWave();
        const s = await state();
        const foes = s.units.filter((u) => u.foe && u.kind === 'minion' && inView({ x: u.sx, y: u.sy }));
        const moving = foes.filter((u) => u.st === 'move');
        const pool = moving.length ? moving : foes;
        if (!pool.length) { i--; skips++; await park(); continue; }
        const u = pool[Math.floor(rnd() * pool.length)];
        await setIntended(u.id);
        const pl = await planNear(u.id, off, rnd() < 0.5 ? 1 : -1);
        if (pl.err || !inView(pl.p)) { i--; skips++; continue; }
        if (!(await page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.classList.contains('hudsurface') ?? false, pl.p))) { i--; skips++; continue; }
        const n0 = (await state()).ncmd;
        await page.mouse.move(pl.p.x, pl.p.y);
        await page.mouse.click(pl.p.x, pl.p.y, { button: 'right' });
        await sleep(60);
        const dn = await lastDown();
        const cmds = await cmdsSince(n0);
        const c0 = cmds.find((c) => c.type === 'attack' || c.type === 'move');
        const sent = !c0 ? 'none' : c0.type === 'attack' ? c0.target : 'move';
        const want = off <= 12 ? u.id : 'move';
        // what the rule says at the instant of the click (the unit moved since planning)
        const ruleAtClick = dn ? (dn.onBox ?? dn.slopPick ?? 'move') : null;
        const r = { off, intended: u.id, moving: u.st === 'move', sent, ok: sent === want, ruleAtClick, consistent: sent === ruleAtClick, gapPlanned: pl.gapPlanned, gapAtClick: dn?.gapIntended, at: [Math.round(pl.p.x), Math.round(pl.p.y)], side: pl.dir, extra: cmds.length - 1 };
        out.push(r);
        if (!r.ok) flags.push({ scenario: 'near', ...r });
        if (!r.ok || i === 0) await snap(page, `near${off}_${i}${r.ok ? '' : '_MISS'}`);
        await sleep(sent === 'move' ? 900 : 400);
        await page.keyboard.press('KeyS'); await sleep(250);
      }
      res['off' + off] = { ok: out.filter((r) => r.ok).length, n: out.length, consistent: out.filter((r) => r.consistent).length, skips, trials: out };
      log('near', off, `${res['off' + off].ok}/${out.length} ok, rule-consistent ${res['off' + off].consistent}/${out.length}, skips ${skips}`);
    }
    report.scenarios.nearSweep = res;
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
        const a0 = Math.atan2(dy, dx);
        for (const r of [4.5, 3.5, 5.5, 2.8]) for (let k = 0; k < 16; k++) { const an = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.39; const x = f.x + Math.cos(an) * r, y = f.y + Math.sin(an) * r; if (W.nav.walkable(x, y)) { window.__harness({ type: 'practice', action: 'teleport', x, y }); return true; } }
        return false;
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
      const u = pool[Math.floor(rnd() * pool.length)];
      intended = u.id;
      const geo = await vale(page, (v, id) => {
        const R = v.state.renderer, a = R.actors.get(id), u = v.state.match.value.view.entity(id);
        const f = R.worldToScreen(a.x, a.y, a.h), hd = R.worldToScreen(a.x, a.y, a.h + a.artHeight), side = R.worldToScreen(a.x + u.radius + 0.15, a.y, a.h);
        return { fx: f.x, fy: f.y, hy: hd.y, rx: Math.max(16, Math.abs(side.x - f.x)) };
      }, u.id);
      sp = mode === 'center' ? { x: geo.fx, y: (geo.fy + geo.hy) / 2 } : { x: geo.fx + geo.rx + 8 * (rnd() < 0.5 ? 1 : -1) * 1 + (rnd() < 0.5 ? 0 : -2 * (geo.rx + 8)) , y: (geo.fy + geo.hy) / 2 };
      if (mode === 'near') {
        sp = null;
        for (const dir of rnd() < 0.5 ? [1, -1] : [-1, 1]) for (const yy of [(geo.fy + geo.hy) / 2, geo.fy - 6, geo.hy + 4]) {
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
        const u = pool[Math.floor(rnd() * pool.length)];
        const nb = all.filter((w) => w.id !== u.id && Math.hypot(w.x - u.x, w.y - u.y) < 4);
        let cx = 0, cy = 0; for (const w of nb) { cx += w.x; cy += w.y; }
        let dx, dy;
        if (nb.length) { cx /= nb.length; cy /= nb.length; dx = u.x - cx; dy = u.y - cy; } else { const a = rnd() * 6.28; dx = Math.cos(a); dy = Math.sin(a); }
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
        const u = foes[Math.floor(rnd() * foes.length)];
        const a = rnd() * 6.28, d = 0.9 + rnd() * 1.6;
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
    if (under && !under.startsWith('div.hudsurface')) return { mode, skip: 'a HUD element over the point: ' + under };
    await setIntended(intended);
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

  for (const [mode, n, opt] of [['fonly', 4, { kind: 'fighter', off: 1.8 }], ['shift', 8], ['amove', 8]]) {
    const res = [];
    for (let i = 0; i < n; i++) { const r = await trial(mode, opt); r.down = await lastDown(); if (!r.skip && r.down) { r.ruleAtClick = mode === 'fonly' ? r.down.amRuleF : r.down.amRule; r.consistent = r.ruleAtClick === r.sent || (r.ruleAtClick === 'ground' && r.sent === 'amove-ground'); } if (r.skip) r.dbg = await vale(page, (v) => { const c = v.state.match.value, H = window.__H, R = v.state.renderer; return c.view.entities.filter((u) => u.kind === 'fighter' && u.id !== H.me).map((u) => ({ id: u.id, team: u.team, alive: u.alive, vis: (u.visibleMask & (1 << H.team)) !== 0, x: +u.x.toFixed(1), y: +u.y.toFixed(1), s: R.worldToScreen(u.x, u.y, 0) })); }); res.push(r); if (!r.skip && !r.ok) flags.push({ scenario: mode, ...r }); if (i === 0 || (!r.skip && !r.ok)) await snap(page, `${mode}_${i}${r.ok === false ? '_MISS' : ''}`); }
    report.scenarios[mode] = res;
    const done = res.filter((r) => !r.skip);
    log(mode, `${done.filter((r) => r.ok).length}/${done.length} ok`, JSON.stringify(res));
  }

  // ── W. right-clicks on wall faces left / right / ahead / behind (screen directions) ─────────────────────
  /** world unit vector for a screen direction at the hero */
  const worldDir = (sv) => vale(page, (v, sv) => {
    const R = v.state.renderer, c = v.state.match.value, e = c.sim.world.entity(window.__H.me);
    const s0 = R.worldToScreen(e.x, e.y, 0), s1 = R.worldToScreen(e.x + 1, e.y, 0), s2 = R.worldToScreen(e.x, e.y + 1, 0);
    const a = s1.x - s0.x, b = s2.x - s0.x, cc = s1.y - s0.y, d = s2.y - s0.y, det = a * d - b * cc;
    const wx = (d * sv.x - b * sv.y) / det, wy = (-cc * sv.x + a * sv.y) / det, L = Math.hypot(wx, wy);
    return { x: wx / L, y: wy / L };
  }, sv);
  const wallSpots = (w, Lmin, Lmax) => vale(page, (v, a) => {
    const c = v.state.match.value, W = c.sim.world, nav = W.nav;
    const avoid = c.view.entities.filter((u) => u.alive && (u.kind === 'structure' || u.kind === 'monster'));
    const out = [];
    for (let x = 3; x < nav.sizeX - 3; x += 1.7) for (let y = 3; y < nav.sizeY - 3; y += 1.7) {
      if (!nav.walkable(x, y)) continue;
      let clear = true; for (let k = 0; k < 8 && clear; k++) if (!nav.walkable(x + Math.cos(k * 0.785) * 1.0, y + Math.sin(k * 0.785) * 1.0)) clear = false;
      if (!clear) continue;
      if (avoid.some((u) => Math.hypot(u.x - x, u.y - y) < 9)) continue;
      let L = -1; for (let s = 0.1; s <= a.Lmax + 0.05; s += 0.05) if (!nav.walkable(x + a.w.x * s, y + a.w.y * s)) { L = s; break; }
      if (L < a.Lmin) continue;
      // a solid face: unwalkable 0.3 .. 1.6 m past it, and walkable beside the line (a face, not a pillar tip)
      let solid = true; for (let s = 0.3; s <= 1.6; s += 0.2) if (nav.walkable(x + a.w.x * (L + s), y + a.w.y * (L + s))) solid = false;
      if (!solid) continue;
      out.push({ x, y, L });
    }
    return out;
  }, { w, Lmin, Lmax });
  const goSpot = async (sp) => {
    await vale(page, (v, p) => window.__harness({ type: 'practice', action: 'teleport', x: p.x, y: p.y }), sp);
    await page.keyboard.press('KeyS');
    await sleep(900);
  };
  const DIRS = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, ahead: { x: 0, y: -1 }, behind: { x: 0, y: 1 } };
  {
    const res = [];
    for (const [dn, sv] of Object.entries(DIRS)) {
      const w = await worldDir(sv);
      const spots = await wallSpots(w, 2.5, 6.5);
      if (!spots.length) { res.push({ dir: dn, skip: 'no wall spot' }); continue; }
      let done = 0;
      for (let k = 0; k < 20 && done < 4; k++) {
        const sp = spots[Math.floor(rnd() * spots.length)];
        await goSpot(sp);
        const s0 = await state();
        if (Math.hypot(s0.me.x - sp.x, s0.me.y - sp.y) > 0.5) continue;
        const kind = ['into', 'oblique+', 'oblique-', 'face'][done];
        let g;
        if (kind === 'into') g = { x: sp.x + w.x * (sp.L + 0.7), y: sp.y + w.y * (sp.L + 0.7) };
        else if (kind === 'face') g = { x: sp.x + w.x * (sp.L - 0.3), y: sp.y + w.y * (sp.L - 0.3) };
        else { const an = (kind === 'oblique+' ? 1 : -1) * 0.45, cx = Math.cos(an), sx = Math.sin(an); const ww = { x: w.x * cx - w.y * sx, y: w.x * sx + w.y * cx }; g = { x: sp.x + ww.x * (sp.L / Math.cos(an) + 0.8), y: sp.y + ww.y * (sp.L / Math.cos(an) + 0.8) }; }
        const meta = await vale(page, (v, a) => {
          const nav = v.state.match.value.sim.world.nav;
          // the straight-walk stop: the last walkable point along hero → click
          const L = Math.hypot(a.g.x - a.h.x, a.g.y - a.h.y); let stop = { ...a.h };
          for (let s = 0; s <= L; s += 0.05) { const p = { x: a.h.x + (a.g.x - a.h.x) * s / L, y: a.h.y + (a.g.y - a.h.y) * s / L }; if (!nav.walkable(p.x, p.y)) break; stop = p; }
          return { walkable: nav.walkable(a.g.x, a.g.y), stop, stopToClick: Math.hypot(stop.x - a.g.x, stop.y - a.g.y) };
        }, { g, h: { x: s0.me.x, y: s0.me.y } });
        const p = await toScreen(g.x, g.y);
        if (!inView(p)) continue;
        if ((await pickAt(p.x, p.y, 14)) !== null) continue;
        await setIntended('move');
        const n0 = s0.ncmd;
        await page.mouse.move(p.x, p.y); await sleep(60);
        await page.mouse.click(p.x, p.y, { button: 'right' });
        await sleep(150);
        const s1 = await waitIdle(10000);
        const m = await moveMetrics(s0.t, g, s1.t);
        await sleep(1500);
        const post = await postPath(s1.t);
        const cmds = await cmdsSince(n0);
        const r = { dir: dn, kind, clickWalkable: meta.walkable, cmd: fmt(cmds), ended: s1.me.order === 0, secs: +(s1.t - s0.t).toFixed(2), ...m, stopToClick: +meta.stopToClick.toFixed(2), endVsStraightStop: +(m.endDist - meta.stopToClick).toFixed(2), postArrive: post };
        res.push(r);
        done++;
        const bad = [];
        if (m.maxAway > 1) bad.push('moved away > 1 m');
        if (post > 0.3) bad.push('kept moving after arrival');
        if (!r.ended) bad.push('order never ended');
        if (r.endVsStraightStop > 0.75) bad.push('ended > 0.75 m further from the click than the straight stop');
        if (m.path > 1.6 * Math.max(m.net, 0.3) + 1) bad.push('path > 1.6 x net + 1');
        if (!/^move$/.test(r.cmd)) bad.push('sent ' + r.cmd);
        if (bad.length) flags.push({ scenario: 'wallClick', bad, ...r });
        if (done === 1 || bad.length) await snap(page, `wall_${dn}_${kind}${bad.length ? '_BAD' : ''}`);
      }
    }
    report.scenarios.wallClicks = res;
    log('W', JSON.stringify(res));
  }

  // ── WH. hold-steer along a wall: press on the face ahead, drag parallel to it for ~2 s, release, mouse still ──
  {
    const res = [];
    for (const [dn, sv] of Object.entries(DIRS)) {
      const w = await worldDir(sv);
      const spots = await wallSpots(w, 2.0, 4.0);
      // the face must run on for 6 m to either side
      let sp = null;
      for (let k = 0; k < 30 && !sp; k++) {
        const c = spots[Math.floor(rnd() * spots.length)];
        if (!c) break;
        const ok = await vale(page, (v, a) => {
          const nav = v.state.match.value.sim.world.nav, t = { x: -a.w.y, y: a.w.x };
          for (let s = -6; s <= 6; s += 0.5) { const bx = a.c.x + t.x * s, by = a.c.y + t.y * s; if (!nav.walkable(bx, by)) return false; let L = -1; for (let q = 0.1; q <= a.c.L + 1; q += 0.05) if (!nav.walkable(bx + a.w.x * q, by + a.w.y * q)) { L = q; break; } if (L < 0 || Math.abs(L - a.c.L) > 0.3) return false; if (nav.walkable(bx + a.w.x * (a.c.L + 0.8), by + a.w.y * (a.c.L + 0.8))) return false; }
          return true;
        }, { c, w });
        if (ok) sp = c;
      }
      if (!sp) { res.push({ dir: dn, skip: 'no long face' }); continue; }
      await goSpot(sp);
      const s0 = await state();
      const t = { x: -w.y, y: w.x };
      const along = rnd() < 0.5 ? 1 : -1;
      const pts = [];
      for (let i = 0; i <= 16; i++) { const s = along * i * 0.35; pts.push({ x: sp.x + w.x * (sp.L + 0.6) + t.x * s, y: sp.y + w.y * (sp.L + 0.6) + t.y * s }); }
      await setIntended('move');
      let p = await toScreen(pts[0].x, pts[0].y);
      if (!inView(p)) { res.push({ dir: dn, skip: 'face off screen' }); continue; }
      await page.mouse.move(p.x, p.y);
      await page.mouse.down({ button: 'right' });
      let maxProj = -1e9, back = 0;
      const projs = [];
      for (const q of pts.slice(1)) {
        p = await toScreen(q.x, q.y);   // the camera follows the hero: re-aim at the same ground point along the face
        await page.mouse.move(p.x, p.y, { steps: 2 });
        await sleep(110);
      }
      const relG = pts[pts.length - 1];
      await page.mouse.up({ button: 'right' });
      const s1 = await waitIdle(6000);
      const tr = await traceFrom(s0.t);
      for (const q of tr) { const pr = (q.x - sp.x) * w.x + (q.y - sp.y) * w.y; maxProj = Math.max(maxProj, pr); back = Math.max(back, maxProj - pr); projs.push(pr); }
      const tRel = (await state()).t;
      const gaps = await vale(page, (v, a) => { const nav = v.state.match.value.sim.world.nav; return a.tr.filter((q) => q.t <= a.tRel).map((q) => { for (let s = 0; s <= 4; s += 0.03) if (!nav.walkable(q.x + a.w.x * s, q.y + a.w.y * s)) return s; return 4; }); }, { tr, w, tRel: s1.t });
      let touched = false, gapAfter = 0; for (const gq of gaps) { if (gq < 0.6) touched = true; else if (touched) gapAfter = Math.max(gapAfter, gq); }
      let along_ = 0; { const e = tr[tr.length - 1]; along_ = ((e.x - sp.x) * t.x + (e.y - sp.y) * t.y) * along; }
      const m = await moveMetrics(s0.t, relG, s1.t);
      const nStill = (await state()).ncmd;
      await sleep(2500);
      const post = await postPath(s1.t);
      const cmdsStill = (await state()).ncmd - nStill;
      const cmds = await cmdsSince(s0.ncmd);
      const wtr = await vale(page, (v, a) => ({ tr: window.__H.trace.filter((p) => p.t >= a.t0).filter((_, i) => i % 6 === 0).map((p) => [+p.t.toFixed(2), +p.x.toFixed(2), +p.y.toFixed(2), p.order, p.st, p.atk]), cmds: window.__H.cmds.filter((c) => c.t >= a.t0).map((c) => [+c.t.toFixed(2), c.cmd.type, c.cmd.x, c.cmd.y]) }), { t0: s0.t });
      const r = { trace: wtr, tEnd: s1.t, dir: dn, faceDist: +sp.L.toFixed(2), localGapAfterTouch: +gapAfter.toFixed(2), touched, cmds: cmds.length, kinds: [...new Set(cmds.map((c) => c.type))], stepBackFromWall: +back.toFixed(2), slidAlong: +along_.toFixed(2), cursorTravel: 5.6, ended: s1.me.order === 0, endToRelease: m?.endDist, maxAwayFromRelease: m?.maxAway, postArrive: post, cmdsWhileStill: cmdsStill };
      res.push(r);
      const bad = [];
      if (back > 0.3) bad.push('stepped back from the wall > 0.3 m');
      if (gapAfter > 0.8) bad.push('left the face > 0.8 m while pressing into it');
      if (post > 0.3) bad.push('kept moving after arrival');
      if (cmdsStill > 0) bad.push('commands with a still mouse');
      if (!r.ended) bad.push('order never ended');
      if (bad.length) flags.push({ scenario: 'holdWall', bad, ...r });
      await snap(page, `holdwall_${dn}${bad.length ? '_BAD' : ''}`);
    }
    report.scenarios.holdAlongWall = res;
    log('WH', JSON.stringify(res));
  }

  // ── HW. hold-steer through the enemy wave to a point past it (cursor kept on that ground point) ─────────
  {
    const res = [];
    for (let i = 0; i < 6; i++) {
      const STILL = i >= 3;   // trials 3..5: the mouse held still after the press (no re-aim)
      await park();
      const c2 = await clash();
      if (c2.d === undefined) { res.push({ skip: 'no wave' }); continue; }
      const ux = c2.bx - c2.ax, uy = c2.by - c2.ay, L = Math.hypot(ux, uy) || 1;
      let g = null;
      for (let k = 0; k < 36 && !g; k++) {
        const fw = 2 + (k % 6) * 1.2, lat = (Math.floor(k / 6) - 2.5) * 1.1 + ((i % 4) - 1.5) * 0.4;
        const gg = { x: c2.bx + (ux / L) * fw - (uy / L) * lat, y: c2.by + (uy / L) * fw + (ux / L) * lat };
        if (!(await vale(page, (v, g) => v.state.match.value.sim.world.nav.walkable(g.x, g.y), gg))) continue;
        const pp = await toScreen(gg.x, gg.y);
        if (!inView(pp) || (await pickAt(pp.x, pp.y, 14)) !== null) continue;
        g = gg;
      }
      if (!g) { res.push({ skip: 'no clear point past the wave' }); continue; }
      await setIntended('move');
      const s0 = await state();
      let p = await toScreen(g.x, g.y);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down({ button: 'right' });
      const t0w = Date.now();
      let reached = false, sel = 0;
      while (Date.now() - t0w < 7000) {
        await sleep(140);
        p = await toScreen(g.x, g.y);
        const sel1 = await vale(page, (v, a) => { const pk = v.state.renderer.pickEntity(a.x, a.y, { filter: (u) => u.alive && u.team !== window.__H.team, slop: 0 }); return pk; }, p);
        if (sel1 !== null) sel++;
        if (inView(p) && !STILL) await page.mouse.move(p.x, p.y, { steps: 1 });
        const s = await state();
        if (Math.hypot(s.me.x - g.x, s.me.y - g.y) < 0.8) { reached = true; break; }
        if (STILL && s.me.order === 0) break;
      }
      await page.mouse.up({ button: 'right' });
      const s1 = await waitIdle(5000);
      const m = await moveMetrics(s0.t, g, s1.t);
      await sleep(1500);
      const post = await postPath(s1.t);
      const cmds = await cmdsSince(s0.ncmd);
      const trc = await vale(page, (v, a) => { const T = window.__H.trace.filter((p) => p.t >= a.t0 && p.t <= a.t1 + 1.5); return { tr: T.filter((_, i) => i % 6 === 0).map((p) => [+p.t.toFixed(2), +p.x.toFixed(2), +p.y.toFixed(2), p.order, p.st]), cmds: window.__H.cmds.filter((c) => c.t >= a.t0 && c.t <= a.t1 + 1.5).map((c) => [+c.t.toFixed(2), c.cmd.type, c.cmd.x !== undefined ? +c.cmd.x.toFixed(2) : c.cmd.target, c.cmd.y !== undefined ? +c.cmd.y.toFixed(2) : null]) }; }, { t0: s0.t, t1: s1.t });
      const r = { still: STILL, g: { x: +g.x.toFixed(2), y: +g.y.toFixed(2) }, trace: trc, straight: m?.d0, path: m?.path, endDist: m?.endDist, maxAway: m?.maxAway, regress: m?.regress, reached, secs: +(s1.t - s0.t).toFixed(2), cmds: cmds.length, kinds: [...new Set(cmds.map((c) => c.type + (c.target !== undefined ? '#' + c.target : '')))], cursorOverEnemyFrames: sel, ended: s1.me.order === 0, postArrive: post };
      res.push(r);
      const bad = [];
      if (m && m.maxAway > 1) bad.push('moved away > 1 m');
      if (post > 0.3) bad.push('kept moving after release');
      if (cmds.some((c) => c.type === 'attack')) bad.push('a hold-steer became an attack');
      if (m && m.endDist > 2) bad.push('ended > 2 m from the held point');
      if (m && m.path > 1.6 * m.d0 + 1) bad.push('path > 1.6 x straight + 1');
      // r4: with the mouse held still, every move sent is the pressed point (re-sends never follow the camera's ground)
      const mv = cmds.filter((c) => c.type === 'move');
      r.moveCmds = mv.length; r.distinctPts = new Set(mv.map((c) => c.x.toFixed(3) + ',' + c.y.toFixed(3))).size;
      if (STILL && r.distinctPts > 1) bad.push('held-still re-sends drifted to ' + r.distinctPts + ' points');
      if (STILL && !reached && m && m.endDist > 2 && mv.length < 2) bad.push('held still, stopped > 2 m short and never re-sent');
      if (bad.length) flags.push({ scenario: 'holdThroughWave', bad, ...r });
      if (i === 0 || bad.length) await snap(page, `holdwave_${i}${bad.length ? '_BAD' : ''}`);
    }
    report.scenarios.holdThroughWave = res;
    log('HW', JSON.stringify(res));
  }

  // ── F2. plain move straight through the enemy wave to a point 6 m past it ─────────────────────
  {
    const res = [];
    for (let i = 0; i < 4; i++) {
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
      { const mm = await moveMetrics(s0.t, g, s1.t); const bad = []; if (mm && mm.maxAway > 1) bad.push('moved away > 1 m'); if (path > 0.3) bad.push('kept moving after arrival'); if (s1.me.order !== 0) bad.push('order never ended'); if (wpath > 1.6 * straight + 1) bad.push('path > 1.6 x straight + 1'); if (bad.length) flags.push({ scenario: 'throughWave', bad, straight, wpath, endDist: Math.hypot(s1.me.x - g.x, s1.me.y - g.y), maxAway: mm?.maxAway }); }
      res.push({ straight: +straight.toFixed(2), walked: +wpath.toFixed(2), reversals: rev, walkable: walk, onEnemyBox: onBox, cmd: cmds.map((c) => c.type + (c.target !== undefined ? '#' + c.target : '')).join(','), ended: s1.me.order === 0, secs: +(s1.t - s0.t).toFixed(2), endDist: +Math.hypot(s1.me.x - g.x, s1.me.y - g.y).toFixed(2), postArrivePath: +path.toFixed(2) });
      if (i === 0) await snap(page, 'F2_through_wave');
    }
    report.scenarios.throughWave = res;
    log('F2', JSON.stringify(res));
  }

  // ── HR. r4: right button pressed on a ground point past the wave and held perfectly still for 5 s ──────
  // (the camera follows the hero; re-sends must all be the pressed point, every ~500 ms only while > 2 m short)
  {
    const res = [];
    for (let i = 0; i < 4; i++) {
      await park();
      const c2 = await clash();
      if (c2.d === undefined) { res.push({ skip: 'no wave' }); continue; }
      const ux = c2.bx - c2.ax, uy = c2.by - c2.ay, L = Math.hypot(ux, uy) || 1;
      let g = null, p = null;
      for (let k = 0; k < 36 && !g; k++) {
        const fw = 2 + (k % 6) * 1.2, lat = (Math.floor(k / 6) - 2.5) * 1.1;
        const gg = { x: c2.bx + (ux / L) * fw - (uy / L) * lat, y: c2.by + (uy / L) * fw + (ux / L) * lat };
        if (!(await vale(page, (v, g) => v.state.match.value.sim.world.nav.walkable(g.x, g.y), gg))) continue;
        const pp = await toScreen(gg.x, gg.y);
        if (!inView(pp) || (await pickAt(pp.x, pp.y, 14)) !== null) continue;
        g = gg; p = pp;
      }
      if (!g) { res.push({ skip: 'no clear point past the wave' }); continue; }
      await setIntended('move');
      const s0 = await state();
      await page.mouse.move(p.x, p.y); await sleep(60);
      await page.mouse.down({ button: 'right' });
      await sleep(5000);
      const sMid = await state();
      await page.mouse.up({ button: 'right' });
      const s1 = await waitIdle(5000);
      const m = await moveMetrics(s0.t, g, s1.t);
      await sleep(1500);
      const post = await postPath(s1.t);
      const C = await vale(page, (v, a) => window.__H.cmds.filter((c) => c.t >= a.t0).map((c) => ({ t: c.t, wall: c.wall, ...c.cmd })), { t0: s0.t });
      const mv = C.filter((c) => c.type === 'move');
      const pts = new Set(mv.map((c) => c.x.toFixed(3) + ',' + c.y.toFixed(3)));
      const gaps = mv.slice(1).map((c, k) => Math.round(c.wall - mv[k].wall));
      const r = { g: { x: +g.x.toFixed(2), y: +g.y.toFixed(2) }, straight: m?.d0, path: m?.path, endDist: m?.endDist, maxAway: m?.maxAway, regress: m?.regress, sends: mv.length, distinctPts: pts.size, gapsMs: gaps, otherCmds: C.filter((c) => c.type !== 'move').map((c) => c.type), distAtRelease: +Math.hypot(sMid.me.x - g.x, sMid.me.y - g.y).toFixed(2), ended: s1.me.order === 0, postArrive: post };
      res.push(r);
      const bad = [];
      if (pts.size > 1) bad.push('re-sends drifted to ' + pts.size + ' points');
      if (gaps.some((x) => x < 400)) bad.push('re-sent faster than 500 ms');
      if (m && m.maxAway > 1) bad.push('moved away > 1 m');
      if (r.distAtRelease > 2) bad.push('still > 2 m short after holding 5 s');
      if (post > 0.3) bad.push('kept moving after release');
      if (bad.length) flags.push({ scenario: 'holdStill', bad, ...r });
      if (i === 0 || bad.length) await snap(page, `holdstill_${i}${bad.length ? '_BAD' : ''}`);
    }
    report.scenarios.holdStill = res;
    log('HR', JSON.stringify(res));
  }

  // ── SH. r4: Shift + right button held on ground past the wave (attack-move, held 5 s) ──────────────
  // the attack-move must keep fighting (re-sends never cancel a windup or swap targets), no stray plain move
  {
    const res = [];
    for (let i = 0; i < 4; i++) {
      await park();
      const c2 = await clash();
      if (c2.d === undefined) { res.push({ skip: 'no wave' }); continue; }
      const ux = c2.bx - c2.ax, uy = c2.by - c2.ay, L = Math.hypot(ux, uy) || 1;
      let g = null, p = null;
      for (let k = 0; k < 16 && !g; k++) {
        const fw = 3 + (k % 4) * 1.5, lat = (Math.floor(k / 4) - 1.5) * 1.2;
        const gg = { x: c2.bx + (ux / L) * fw - (uy / L) * lat, y: c2.by + (uy / L) * fw + (ux / L) * lat };
        if (!(await vale(page, (v, g) => v.state.match.value.sim.world.nav.walkable(g.x, g.y), gg))) continue;
        const pp = await toScreen(gg.x, gg.y);
        if (!inView(pp) || (await pickAt(pp.x, pp.y, 14)) !== null) continue;
        // the attack-move rule must say ground here (a ground attack-move, not a picked unit)
        g = gg; p = pp;
      }
      if (!g) { res.push({ skip: 'no clear point past the wave' }); continue; }
      await setIntended('amove-ground');
      const s0 = await state();
      const ev0 = await vale(page, () => window.__H.atkEv?.length ?? 0);
      await page.mouse.move(p.x, p.y); await sleep(60);
      await page.keyboard.down('Shift');
      await page.mouse.down({ button: 'right' });
      await sleep(5000);
      await page.mouse.up({ button: 'right' });
      await page.keyboard.up('Shift');
      await sleep(300);
      const C = await vale(page, (v, a) => window.__H.cmds.filter((c) => c.t >= a.t0).map((c) => ({ t: c.t, wall: c.wall, ...c.cmd })), { t0: s0.t });
      const tr = await traceFrom(s0.t);
      // attack target switches while the attack-move was alive, and windups started (the 'st' attack state / atk changes)
      let switches = 0, last = -1; const tg = [];
      for (const q of tr) { if (q.atk >= 0 && q.atk !== last) { if (last >= 0) switches++; last = q.atk; tg.push(q.atk); } }
      const atkEvents = await vale(page, (v, a) => (window.__H.atkEv ?? []).slice(a), ev0);
      const mv = C.filter((c) => c.type === 'move');
      const plain = mv.filter((c) => !c.attackMove);
      const attacks = C.filter((c) => c.type === 'attack');
      const m = await moveMetrics(s0.t, g);
      const dn = await lastDown();
      const r = { g: { x: +g.x.toFixed(2), y: +g.y.toFixed(2) }, ruleAtClick: dn?.amRule, sends: mv.length, plainMoves: plain.length, attackCmds: attacks.map((c) => c.target), targets: tg, switches, swingsStarted: atkEvents.filter((e) => e.start).length, swingsCancelled: atkEvents.filter((e) => e.cancel).length, maxAway: m?.maxAway, orders: [...new Set(tr.map((q) => q.order))] };
      res.push(r);
      const bad = [];
      if (plain.length) bad.push('a held Shift+RMB sent a plain move');
      if (r.swingsCancelled > 0) bad.push(r.swingsCancelled + ' windups cancelled during the held attack-move');
      if (bad.length) flags.push({ scenario: 'shiftHold', bad, ...r });
      if (i === 0 || bad.length) await snap(page, `shifthold_${i}${bad.length ? '_BAD' : ''}`);
      await page.keyboard.press('KeyS'); await sleep(300);
    }
    report.scenarios.shiftHold = res;
    log('SH', JSON.stringify(res));
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
