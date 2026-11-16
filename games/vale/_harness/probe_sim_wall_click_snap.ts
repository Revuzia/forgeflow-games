// probe (lane SIM, movement, ruling 43): a click into a wall or a structure goes to the open point nearest the click that
// the hero can reach, and a stuck hero (its straight walk gains under 1 m) takes the way round to it (orch1 controls r3
// verifier, two MAJORs on ruling 41's snap):
//   repros  the verifier's four exact cases: nav.snapGoal's stuck rescue (phase C) ran only when phase A picked nothing,
//           and A picks any point in line of walk 0.25 m nearer than the wall stop, so C never ran: RIFT ervet ended 7.84 m
//           from a click 0.31 m from an open cell (route 14.0 m, cap 23.1), BRIDGE kemdo moved 0.78 m and stopped 12.51 m
//           short (open 0.42 m, route 26.0 m, cap 27.8), RIFT ardit 2.34 m (open 0.78 m), RIFT odrum 5.33 m (open 0.56 m).
//           The snap ends within 0.3 m of the open cell's distance, the walk within 1.2 m.
//   stuck   the verifier's sweep (_tmp_vfy_ctl_r3_wallclick.ts, its gates A and B), every fighter, structures on, RIFT and
//           BRIDGE, body-free (Wicks and monsters removed every tick; the other fighters parked in their base, clicks
//           near them skipped, so a body block is not a snap fault): a stuck click whose open cell within 2.5 m is
//           reachable at <= 2 x straight + 2 m ends within that cell's distance + 1.2 m (gate A, 0), and no click ends
//           further from the click than the hero started (+0.3 m, gate B, 0).
//   walls   the round-4 verifier's walls sweep (verify_controls_sim_orch.ts walls, seed 5, shallow and deep, one fighter a
//           radius), with its nav taken from the live sim (the verifier kept the first sim's nav after refreshing the sim,
//           so its reference saw that sim's fallen towers: every 'far' it flagged, e.g. BRIDGE burdam +2.63 m, was the
//           reference reading a different map): 0 ends > 1 m past the best reachable point (far); a walk longer than
//           1.6 x net + 1 m or more than 1 m away from the click only on a stuck click (the rescue's way round, ruling 41).
//   node _harness/probe_sim_wall_click_snap.ts [--n 800]
import { buildContent, defaultOptions } from '../tools/build_content.ts';
import { createSim } from '../src/sim/sim.ts';
import { pickLoadout } from '../src/sim/bots/index.ts';
import { killEntity } from '../src/sim/combat.ts';
import { ORDER_NONE, type Entity } from '../src/sim/entity.ts';
import type { World } from '../src/sim/world.ts';
import { check, finish, section } from './fixtures/sim_fixture.ts';

const argv = process.argv.slice(2);
const N = Number(argv[argv.indexOf('--n') + 1] ?? 800) || 800;
const built = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
if (!built.catalog) { console.log('SKIP content build failed'); process.exit(77); }
const rc = built.catalog;
const fs = rc.fighters.map((f) => f.id).sort();
const f2 = (n: number): string => n.toFixed(2);

function fresh(first: string, modeId: string, seed: number, lineup: (i: number) => string) {
  const mode = rc.modes.find((m) => m.id === modeId)!, queue = rc.queues.find((q) => q.mode === modeId)!;
  const seats = Array.from({ length: mode.teams * mode.perTeam }, (_, i) => { const fighter = i === 0 ? first : lineup(i);
    return { player: i, team: Math.floor(i / mode.perTeam), name: `p${i}`, fighter, skin: rc.skins.find((s) => s.fighter === fighter)!.id, controller: 'human', loadout: pickLoadout(rc, fighter, mode.rules.itemPool ?? '', undefined as never), colorIndex: i }; });
  const sim = createSim(rc, { matchId: 'wall_snap', seed, queue: queue.id, mode: modeId, map: mode.map, seats, catalogVersion: rc.version } as never, { pregameSeconds: 0 });
  sim.step();
  return sim;
}
const clearBodies = (w: World): void => { for (const e of [...w.entities]) if (e.alive && (e.kind === 'minion' || e.kind === 'monster')) killEntity(w, e, null); };
const parkOthers = (w: World, me: Entity): void => {
  for (const p of w.players) if (p.ent && p.ent !== me) { const b = w.mapDef.bases.find((q) => q.team === p.team); if (b) { p.ent.x = b.spawn[0]; p.ent.y = b.spawn[1]; p.ent.path.length = 0; p.ent.order = ORDER_NONE; } }
};
function routeLen(w: World, x0: number, y0: number, x1: number, y1: number, r: number): number {
  const route: number[] = [];
  if (!w.nav.findPath(x0, y0, x1, y1, route, r)) return Infinity;
  let l = 0, qx = x0, qy = y0;
  for (let i = 0; i < route.length; i += 2) { l += Math.hypot(route[i] - qx, route[i + 1] - qy); qx = route[i]; qy = route[i + 1]; }
  return Math.hypot(qx - x1, qy - y1) < 1e-3 ? l : Infinity;
}

section('repros: the verifier r3 stuck clicks (A picked a point in line of walk, so the rescue never ran)', () => {
  const cases: [string, string, number, number, number, number, number][] = [
    ['rift', 'ervet', 111.81, 15.02, 109.41, 25.51, 0.31],
    ['bridge', 'kemdo', 125.51, 15.54, 112.45, 13.45, 0.42],
    ['rift', 'ardit', 133.30, 17.87, 136.57, 16.87, 0.78],
    ['rift', 'odrum', 49.75, 59.07, 52.92, 70.30, 0.56],
  ];
  for (const [mode, f, hx, hy, cx, cy, open] of cases) {
    const sim = fresh(f, mode, 9, (i) => fs[(i * 3) % fs.length]);
    const w = sim.world, me = w.players[0].ent!;
    parkOthers(w, me);
    for (const e of w.entities) if (e.kind === 'structure') e.stats.ad = 0;
    me.x = hx; me.y = hy; me.path.length = 0; me.order = ORDER_NONE; w.hashDirty = true; sim.step();
    const o = { x: 0, y: 0 };
    w.nav.snapGoal(me.x, me.y, cx, cy, o, me.radius);
    const sd = Math.hypot(o.x - cx, o.y - cy);
    check(`${mode} ${f}: the snap is the open point by the click (${f2(open)} m), not the wall stop`, sd <= open + 0.3, { snap: [f2(o.x), f2(o.y)], d: f2(sd) });
    sim.command(0, { type: 'move', x: cx, y: cy } as never);
    for (let q = 0; q < 360; q++) { me.hp = me.maxHp; sim.step(); if (q > 3 && me.order === ORDER_NONE) break; }
    const d = Math.hypot(me.x - cx, me.y - cy);
    check(`${mode} ${f}: the hero walks round and ends within ${f2(open + 1.2)} m of the click`, d <= open + 1.2, { end: [f2(me.x), f2(me.y)], d: f2(d) });
  }
});

function rng(seed: number): () => number { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; }; }

section(`stuck sweep: every fighter, structures on, body-free, ${N / 10} clicks a fighter a map (verifier r3 gates A and B)`, () => {
  let total = 0, gated = 0, failA = 0, failB = 0;
  const bad: string[] = [];
  for (const modeId of ['rift', 'bridge']) for (const f of fs) {
    let sim = fresh(f, modeId, 9, (i) => fs[(i * 3) % fs.length]);
    const rnd = rng(7 + f.length * 131 + (modeId === 'bridge' ? 17 : 0) + f.charCodeAt(0) * 7);
    let n = 0, tries = 0;
    while (n < N / 10 && tries++ < 200000) {
      if (sim.world.tick > 30 * 500 || sim.world.phase !== 'live') sim = fresh(f, modeId, 9, (i) => fs[(i * 3) % fs.length]);
      const w = sim.world, nav = w.nav, me = w.players[0].ent!;
      parkOthers(w, me);
      for (const e of w.entities) if (e.kind === 'structure') e.stats.ad = 0;
      const structs = w.entities.filter((e) => e.kind === 'structure' && e.alive);
      const [W, H] = w.mapDef.size;
      let hx: number, hy: number;
      if (rnd() < 0.6) { const s = structs[Math.floor(rnd() * structs.length)]; const a = rnd() * 6.283, d = s.radius + 0.5 + rnd() * 8; hx = s.x + Math.cos(a) * d; hy = s.y + Math.sin(a) * d; }
      else { hx = 2 + rnd() * (W - 4); hy = 2 + rnd() * (H - 4); }
      const main = nav.componentAt(w.mapDef.bases[0].spawn[0], w.mapDef.bases[0].spawn[1]);
      if (!nav.walkable(hx, hy) || nav.componentAt(hx, hy) !== main) continue;
      const a = rnd() * 6.283, d = 1 + rnd() * 13, cx = hx + Math.cos(a) * d, cy = hy + Math.sin(a) * d;
      if (cx < 0.5 || cy < 0.5 || cx > W - 0.5 || cy > H - 0.5 || nav.walkable(cx, cy)) continue;
      if (w.players.some((p) => p.ent && p.ent !== me && (Math.hypot(p.ent.x - hx, p.ent.y - hy) < 12 || Math.hypot(p.ent.x - cx, p.ent.y - cy) < 12))) continue;
      const c = nav.cell; let best = Infinity, bx = 0, by = 0;
      for (let gy = Math.floor((cy - 3) / c); gy <= Math.floor((cy + 3) / c); gy++) for (let gx = Math.floor((cx - 3) / c); gx <= Math.floor((cx + 3) / c); gx++) {
        const px = (gx + 0.5) * c, py = (gy + 0.5) * c, dd = Math.hypot(px - cx, py - cy);
        if (dd < best && nav.walkable(px, py) && nav.componentAt(px, py) === main && nav.walkable(px + me.radius * 0.7, py) && nav.walkable(px - me.radius * 0.7, py) && nav.walkable(px, py + me.radius * 0.7) && nav.walkable(px, py - me.radius * 0.7)) { best = dd; bx = px; by = py; }
      }
      if (!isFinite(best) || best > 2.5) continue;
      clearBodies(w);
      me.x = hx; me.y = hy; me.path.length = 0; me.order = ORDER_NONE; w.hashDirty = true; sim.step();
      if (Math.hypot(me.x - hx, me.y - hy) > 0.3) continue;
      const x0 = me.x, y0 = me.y, d0 = Math.hypot(cx - x0, cy - y0);
      const rl = routeLen(w, x0, y0, bx, by, me.radius), straight = Math.hypot(bx - x0, by - y0);
      sim.command(0, { type: 'move', x: cx, y: cy } as never);
      for (let q = 0; q < 30 * 12; q++) { me.hp = me.maxHp; clearBodies(sim.world); sim.step(); if (q > 3 && me.order === ORDER_NONE) break; }
      n++; total++;
      const dEnd = Math.hypot(me.x - cx, me.y - cy);
      const rt = { x: 0, y: 0 }; nav.raycast(x0, y0, cx, cy, rt); const gain = d0 - Math.hypot(rt.x - cx, rt.y - cy);
      const isGated = gain < 1 && rl <= 2 * straight + 2 && d0 > best + 0.6;
      if (isGated) gated++;
      if (isGated && dEnd > best + 1.2) { failA++; if (bad.length < 10) bad.push(`A ${modeId} ${f} (${f2(x0)},${f2(y0)})->(${f2(cx)},${f2(cy)}) open ${f2(best)} route ${f2(rl)}/${f2(straight)} end ${f2(dEnd)}`); }
      if (dEnd > d0 + 0.3) { failB++; if (bad.length < 10) bad.push(`B ${modeId} ${f} (${f2(x0)},${f2(y0)})->(${f2(cx)},${f2(cy)}) start ${f2(d0)} end ${f2(dEnd)}`); }
    }
  }
  console.log(`  clicks ${total}, stuck with an open cell in reach ${gated}, A fails ${failA}, B fails ${failB}`);
  for (const b of bad) console.log('   ', b);
  check('enough stuck clicks sampled (>= 120)', gated >= 120, gated);
  check('gate A: 0 stuck clicks ending > 1.2 m past the reachable open cell', failA === 0, failA);
  check('gate B: 0 clicks ending further from the click than the hero started', failB === 0, failB);
});

/** the round-4 verifier's walls sweep, nav taken from the live sim */
section('walls sweep (round-4 verifier, seed 5): 0 far; long or away walks only on stuck clicks', () => {
  const byR = new Map<number, string>();
  for (const f of rc.fighters) { const r = (f as { collisionRadius: number }).collisionRadius; if (!byR.has(r)) byR.set(r, f.id); }
  const lcg = (seed: number) => { let s = seed; return (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; }; };
  let far = 0, longFree = 0, awayFree = 0, stuckLong = 0, clicks = 0;
  const bad: string[] = [];
  for (const modeId of ['rift', 'bridge']) for (const [rad, who] of byR) for (const kind of ['shallow', 'deep'] as const) {
    const NK = kind === 'shallow' ? 160 : 60;
    const lineup = (i: number): string => fs[(i * 5 + 5) % fs.length];
    let sim = fresh(who, modeId, 5, lineup);
    let w = sim.world, me = w.players[0].ent!;
    for (const e of w.entities) if (e.kind === 'structure') e.stats.ad = 0;
    const [W, H] = w.mapDef.size;
    const rnd = lcg(31337 + Math.round(rad * 1000) + (modeId === 'bridge' ? 7 : 0) + (kind === 'deep' ? 99 : 0));
    const t = { x: 0, y: 0 }, route: number[] = [];
    let n = 0, tries = 0;
    while (n < NK && tries++ < 400000) {
      const nav = w.nav, main = nav.componentAt(w.mapDef.bases[0].spawn[0], w.mapDef.bases[0].spawn[1]);
      const hx = 3 + rnd() * (W - 6), hy = 3 + rnd() * (H - 6);
      if (!nav.walkable(hx, hy) || nav.componentAt(hx, hy) !== main) continue;
      let cx: number, cy: number;
      const a = rnd() * Math.PI * 2, ux = Math.cos(a), uy = Math.sin(a);
      if (kind === 'shallow') {
        if (n % 2 === 0) {
          let hit = -1;
          for (let d = 0.1; d < 7; d += 0.05) if (!nav.walkable(hx + ux * d, hy + uy * d)) { hit = d; break; }
          if (hit < 0) continue;
          const depth = 0.1 + rnd() * 1.4, lat = (rnd() - 0.5) * 1.5;
          cx = hx + ux * (hit + depth) - uy * lat; cy = hy + uy * (hit + depth) + ux * lat;
        } else { const d = 0.8 + rnd() * 8; cx = hx + ux * d; cy = hy + uy * d; }
        if (cx < 0 || cy < 0 || cx >= W || cy >= H || nav.walkable(cx, cy)) continue;
        if (!nav.nearestWalkable(cx, cy, t, 6) || Math.hypot(t.x - cx, t.y - cy) > 1.5) continue;
      } else {
        const d = 3 + rnd() * 10; cx = hx + ux * d; cy = hy + uy * d;
        if (cx < 1 || cy < 1 || cx >= W - 1 || cy >= H - 1 || nav.walkable(cx, cy)) continue;
        if (nav.nearestWalkable(cx, cy, t, 16) && Math.hypot(t.x - cx, t.y - cy) < 1.5) continue;
      }
      if (w.phase !== 'live' || w.tick > 30 * 600) { sim = fresh(who, modeId, 5, lineup); w = sim.world; me = w.players[0].ent!; for (const e of w.entities) if (e.kind === 'structure') e.stats.ad = 0; continue; }
      if (w.entities.some((e) => e !== me && e.alive && !e.static && e.kind !== 'projectile' && e.kind !== 'zone' && (Math.hypot(e.x - hx, e.y - hy) < 14 || Math.hypot(e.x - cx, e.y - cy) < 10))) continue;
      me.x = hx; me.y = hy; me.path.length = 0; me.pathGoalX = NaN; me.order = ORDER_NONE; w.hashDirty = true; sim.step();
      if (Math.hypot(me.x - hx, me.y - hy) > 0.3) continue;
      const x0 = me.x, y0 = me.y, d0 = Math.hypot(x0 - cx, y0 - cy);
      nav.raycast(x0, y0, cx, cy, t);
      const gain = d0 - Math.hypot(t.x - cx, t.y - cy);
      let len = 0, away = 0, px = x0, py = y0;
      sim.command(0, { type: 'move', x: cx, y: cy } as never);
      for (let q = 0; q < 300; q++) { me.hp = me.maxHp; sim.step(); len += Math.hypot(me.x - px, me.y - py); px = me.x; py = me.y; away = Math.max(away, Math.hypot(me.x - cx, me.y - cy) - d0); if (q > 2 && me.order === ORDER_NONE) break; }
      if (w.phase !== 'live') continue;
      n++; clicks++;
      const net = Math.hypot(me.x - x0, me.y - y0);
      nav.raycast(x0, y0, cx, cy, t);
      let ref = Math.hypot(t.x - cx, t.y - cy);
      const c = nav.cell, R = Math.min(ref, 16);
      const cells: [number, number, number][] = [];
      for (let gy = Math.floor((cy - R) / c); gy <= Math.floor((cy + R) / c); gy++) for (let gx = Math.floor((cx - R) / c); gx <= Math.floor((cx + R) / c); gx++) {
        const qx = (gx + 0.5) * c, qy = (gy + 0.5) * c, dd = Math.hypot(qx - cx, qy - cy);
        if (dd < ref && nav.walkable(qx, qy) && nav.componentAt(qx, qy) === main) cells.push([dd, qx, qy]);
      }
      cells.sort((p, q) => p[0] - q[0]);
      let tried = 0;
      for (const [dd, qx0, qy0] of cells) {
        if (tried++ > 60) break;
        if (!nav.findPath(x0, y0, qx0, qy0, route, me.radius)) continue;
        let l = 0, qx = x0, qy = y0, aw = 0;
        for (let i = 0; i < route.length; i += 2) {
          for (const fr of [0.25, 0.5, 0.75, 1]) { const ix = qx + (route[i] - qx) * fr, iy = qy + (route[i + 1] - qy) * fr; aw = Math.max(aw, Math.hypot(ix - cx, iy - cy) - d0); }
          l += Math.hypot(route[i] - qx, route[i + 1] - qy); qx = route[i]; qy = route[i + 1];
        }
        if (Math.hypot(qx - qx0, qy - qy0) < 1e-3 && l <= Math.hypot(qx0 - x0, qy0 - y0) * 1.3 + 0.5 && aw <= 0.5) { ref = dd; break; }
      }
      const exc = Math.hypot(me.x - cx, me.y - cy) - ref;
      const isLong = len > 1.6 * net + 1, isAway = away > 1, stuck = gain < 1;
      if (exc > 1) { far++; if (bad.length < 10) bad.push(`far +${f2(exc)} ${modeId} ${who} (${f2(x0)},${f2(y0)})->(${f2(cx)},${f2(cy)})`); }
      if ((isLong || isAway) && stuck) stuckLong++;
      if (isLong && !stuck) { longFree++; if (bad.length < 10) bad.push(`long ${f2(len)}/${f2(net)} gain ${f2(gain)} ${modeId} ${who} (${f2(x0)},${f2(y0)})->(${f2(cx)},${f2(cy)})`); }
      if (isAway && !stuck) { awayFree++; if (bad.length < 10) bad.push(`away ${f2(away)} gain ${f2(gain)} ${modeId} ${who} (${f2(x0)},${f2(y0)})->(${f2(cx)},${f2(cy)})`); }
    }
  }
  console.log(`  clicks ${clicks}: far ${far}; long or away on a stuck click (the rescue's way round) ${stuckLong}; long ${longFree} / away ${awayFree} otherwise`);
  for (const b of bad) console.log('   ', b);
  check('enough clicks (>= 1500)', clicks >= 1500, clicks);
  check('0 walks ending > 1 m past the best reachable point', far === 0, far);
  check('0 long walks (> 1.6 x net + 1 m) unless the click was stuck', longFree === 0, longFree);
  check('0 walks > 1 m away from the click unless the click was stuck', awayFree === 0, awayFree);
});

finish('probe_sim_wall_click_snap');
