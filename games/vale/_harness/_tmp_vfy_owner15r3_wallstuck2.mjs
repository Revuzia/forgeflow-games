// orch1 controls r3 LIVE verifier (temp): wall / structure 'stuck' clicks in the real client (ruling 43 snap phase C), structures ON.
// Original header kept below.
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
const OUT = join(HERE, '_reports', `owner15r3_wallstuck2_${FIGHTER}.json`);
mkdirSync(dirname(OUT), { recursive: true });
const report = { at: new Date().toISOString(), fighter: FIGHTER, scenarios: {}, drift: null, logs: [] };
const log = (...a) => console.log(...a);
let shotN = 0;
const snap = (page, name) => shot(page, `owner15_controls_r3_wallstuck2_${FIGHTER}_${String(++shotN).padStart(2, '0')}_${name}`).catch(() => null);

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
  });


  const toScreen = (x, y) => vale(page, (v, p) => {
    const R = v.state.renderer;
    let s = R.worldToScreen(p.x, p.y, 0);
    for (let i = 0; i < 3; i++) { const g = R.pickGround(s.x, s.y); if (!g) break; const a = R.worldToScreen(p.x, p.y, 0), b = R.worldToScreen(g.x, g.y, 0); s = { x: s.x + (a.x - b.x), y: s.y + (a.y - b.y) }; }
    return { x: s.x, y: s.y };
  }, { x, y });
  const me = () => vale(page, () => { const c = window.__vale.state.match.value, e = c.sim.world.entity(window.__H.me); return { t: c.sim.world.time, x: e.x, y: e.y, order: e.order, r: e.radius, ncmd: window.__H.cmds.length }; });
  const tp = async (x, y) => { await vale(page, (v, p) => window.__harness({ type: 'practice', action: 'teleport', x: p.x, y: p.y }), { x, y }); await page.keyboard.press('KeyS'); await sleep(700); };
  const waitIdle = async (ms) => { const t0 = Date.now(); await sleep(250); for (;;) { const s = await me(); if (s.order === 0 || Date.now() - t0 > ms) return s; await sleep(120); } };
  // reference: the open cell nearest the click (hero's component) and its route length; straight-walk gain
  const ref = (cx, cy) => vale(page, (v, q) => {
    const c = v.state.match.value, W = c.sim.world, nav = W.nav, e = W.entity(window.__H.me);
    const comp = nav.componentAt ? nav.componentAt(e.x, e.y) : null;
    let best = null;
    for (let rr = 0.05; rr <= 2.5 && !best; rr += 0.05) for (let a = 0; a < 64; a++) {
      const x = q.cx + Math.cos(a / 64 * 6.2832) * rr, y = q.cy + Math.sin(a / 64 * 6.2832) * rr;
      if (!nav.walkable(x, y)) continue; if (comp !== null && nav.componentAt(x, y) !== comp) continue;
      const route = []; if (!nav.findPath(e.x, e.y, x, y, route, e.radius)) continue;
      let L = 0, px = e.x, py = e.y; for (let i = 0; i < route.length; i += 2) { L += Math.hypot(route[i] - px, route[i + 1] - py); px = route[i]; py = route[i + 1]; }
      if (Math.hypot(px - x, py - y) > 0.05) continue;
      best = { x, y, d: rr, route: L, straight: Math.hypot(x - e.x, y - e.y) }; break;
    }
    // straight walk gain: march toward the click until blocked
    let g = 0; const L0 = Math.hypot(q.cx - e.x, q.cy - e.y), ux = (q.cx - e.x) / L0, uy = (q.cy - e.y) / L0;
    for (let s = 0.1; s < L0; s += 0.1) { if (!nav.walkable(e.x + ux * s, e.y + uy * s)) break; g = s; }
    return { open: best, startDist: L0, straightGain: g, clickWalkable: nav.walkable(q.cx, q.cy) };
  }, { cx, cy });
  const clickAt = async (cx, cy, tag) => {
    const s0 = await me();
    const sp = await toScreen(cx, cy);
    if (!(sp.x > 60 && sp.x < 1860 && sp.y > 110 && sp.y < 960)) return { tag, skip: 'offscreen' };
    const under = await page.evaluate((p) => { const e = document.elementFromPoint(p.x, p.y); return e && e.classList.contains('hudsurface') ? null : (e ? e.tagName + '.' + [...e.classList].join('.') : 'none'); }, sp);
    if (under) return { tag, skip: 'hud ' + under };
    await vale(page, () => { const c = window.__vale.state.match.value, W = c.sim.world; for (const e of W.entities) if (e.kind === 'structure' && e.team !== window.__H.team) e.stats.ad = 0; });
    const ent = await vale(page, (v, p) => { const R = v.state.renderer; const u = R.pickEntity(p.x, p.y, { filter: (u) => u.alive && u.targetable, slop: 0 }); return u ? (u.kind ?? true) : null; }, sp);
    if (ent) return { tag, skip: 'entity under cursor ' + ent };
    const g = await vale(page, (v, p) => window.__vale.state.renderer.pickGround(p.x, p.y), sp);
    const rf = await ref(g.x, g.y);
    await page.mouse.move(sp.x, sp.y, { steps: 2 }); await sleep(50);
    await page.mouse.click(sp.x, sp.y, { button: 'right' });
    const s1 = await waitIdle(14000);
    await sleep(400);
    const s2 = await me();
    const cmds = await vale(page, (v, n) => window.__H.cmds.slice(n).map((c) => c.cmd.type + (c.cmd.target !== undefined ? '#' + c.cmd.target : '')), s0.ncmd);
    const tr = await vale(page, (v, t0) => window.__H.trace.filter((p) => p.t >= t0), s0.t);
    let walked = 0; for (let i = 1; i < tr.length; i++) walked += Math.hypot(tr[i].x - tr[i - 1].x, tr[i].y - tr[i - 1].y);
    let rev = 0, prevD = null, dir = 0; for (const p of tr) { const d = Math.hypot(p.x - g.x, p.y - g.y); if (prevD !== null) { const nd = Math.sign(Math.round((d - prevD) * 50)); if (nd !== 0 && dir !== 0 && nd !== dir && Math.abs(d - prevD) > 0) rev++; if (nd !== 0) dir = nd; } prevD = d; }
    if (tr.some((p) => !p.alive)) return { tag, skip: 'hero died' };
    const end = Math.hypot(s2.x - g.x, s2.y - g.y);
    const gatedA = !!rf.open && rf.open.route <= 2 * rf.open.straight + 2;
    const failA = gatedA && end > rf.open.d + 1.2;
    const failB = end > rf.startDist + 0.3;
    const drift = Math.hypot(s2.x - s1.x, s2.y - s1.y);
    const ctx = await vale(page, (v, q) => { const c = v.state.match.value, W = c.sim.world, e = W.entity(window.__H.me); const bodies = W.entities.filter((u) => u.alive && u !== e && (u.kind === 'minion' || u.kind === 'fighter' || u.kind === 'monster' || u.kind === 'structure' || u.kind === 'summon') && Math.hypot(u.x - e.x, u.y - e.y) < u.radius + e.radius + 0.6).map((u) => u.kind + ':' + u.team); const snap = { x: 0, y: 0 }; W.nav.snapGoal(q.sx, q.sy, q.gx, q.gy, snap, e.radius); return { bodies, cc: e.cc ?? null, snap: [+snap.x.toFixed(2), +snap.y.toFixed(2)], snapD: +Math.hypot(snap.x - q.gx, snap.y - q.gy).toFixed(2), heroToSnap: +Math.hypot(snap.x - e.x, snap.y - e.y).toFixed(2) }; }, { sx: s0.x, sy: s0.y, gx: g.x, gy: g.y });
    return { tag, click: [+g.x.toFixed(2), +g.y.toFixed(2)], cmds, clickWalkable: rf.clickWalkable, start: +rf.startDist.toFixed(2), straightGain: +rf.straightGain.toFixed(2), stuck: rf.straightGain < 1 && !rf.clickWalkable, open: rf.open ? { d: +rf.open.d.toFixed(2), route: +rf.open.route.toFixed(2), straight: +rf.open.straight.toFixed(2) } : null, end: +end.toFixed(2), walked: +walked.toFixed(2), secs: +(s1.t - s0.t).toFixed(2), ended: s1.order === 0, driftAfterIdle: +drift.toFixed(2), gatedA, failA, failB, ctx };
  };
  const out = { repros: [], sweep: [] };
  await vale(page, () => window.__vale.state.renderer.camera.setZoom(36)); await sleep(600);
  // 1. the verifier r3 RIFT repros (hero start, click)
  for (const [hx, hy, cx, cy, open, who] of [[111.81, 15.02, 109.41, 25.51, 0.31, 'ervet'], [133.30, 17.87, 136.57, 16.87, 0.78, 'ardit'], [49.75, 59.07, 52.92, 70.30, 0.56, 'odrum']]) {
    await tp(hx, hy);
    const r = await clickAt(cx, cy, `repro ${who}`);
    r.wantOpen = open; out.repros.push(r);
    log('repro', JSON.stringify(r));
    await snap(page, `repro_${who}`);
  }
  // 2. sweep: hero by structures / walls, clicks on blocked ground 1-12 m away
  let seed = 12345 + FIGHTER.length * 77; const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  const N = Number(process.env.N ?? 36);
  const structs = await vale(page, () => window.__vale.state.match.value.view.entities.filter((e) => e.kind === 'structure' && e.alive).map((e) => ({ x: e.x, y: e.y, r: e.radius })));
  let tries = 0;
  while (out.sweep.length < N && tries++ < N * 12) {
    const near = rnd() < 0.6;
    const pos = await vale(page, (v, q) => {
      const c = v.state.match.value, W = c.sim.world, nav = W.nav, [MW, MH] = W.mapDef.size;
      const main = nav.componentAt(W.mapDef.bases[0].spawn[0], W.mapDef.bases[0].spawn[1]);
      let hx, hy;
      if (q.s) { const a = q.a * 6.283, d = q.s.r + 0.6 + q.b * 8; hx = q.s.x + Math.cos(a) * d; hy = q.s.y + Math.sin(a) * d; }
      else { hx = 2 + q.a * (MW - 4); hy = 2 + q.b * (MH - 4); }
      if (!nav.walkable(hx, hy) || nav.componentAt(hx, hy) !== main) return null;
      // a blocked click 1-12 m away
      for (let k = 0; k < 40; k++) { const a = (q.c + k * 0.618) * 6.283, d = 1 + ((q.d + k * 0.37) % 1) * 11; const cx = hx + Math.cos(a) * d, cy = hy + Math.sin(a) * d; if (cx < 1 || cy < 1 || cx > MW - 1 || cy > MH - 1) continue; if (!nav.walkable(cx, cy)) return { hx, hy, cx, cy }; }
      return null;
    }, { s: near ? structs[Math.floor(rnd() * structs.length)] : null, a: rnd(), b: rnd(), c: rnd(), d: rnd() });
    if (!pos) continue;
    await tp(pos.hx, pos.hy);
    const r = await clickAt(pos.cx, pos.cy, near ? 'structure' : 'wall');
    if (r.skip) { (out.skips ??= []).push(r.skip); continue; }
    out.sweep.push(r);
    if (r.failA || r.failB) { log('FAIL', JSON.stringify(r)); await snap(page, `fail_${out.sweep.length}`); }
  }
  const sw = out.sweep;
  report.summary = { n: sw.length, stuck: sw.filter((r) => r.stuck).length, gatedA: sw.filter((r) => r.gatedA).length, failA: sw.filter((r) => r.failA).length, failB: sw.filter((r) => r.failB).length, notEnded: sw.filter((r) => !r.ended).length, maxEndOverOpen: Math.max(...sw.filter((r) => r.open).map((r) => +(r.end - r.open.d).toFixed(2))), maxDrift: Math.max(...sw.map((r) => r.driftAfterIdle)), stuckEnds: sw.filter((r) => r.stuck).map((r) => [r.open?.d ?? null, r.end, r.walked]) };
  report.scenarios = out;
  log('summary', JSON.stringify(report.summary));
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
