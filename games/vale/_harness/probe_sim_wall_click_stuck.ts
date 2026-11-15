// probe (lane SIM, movement): a click into a wall or a structure never does nothing while an open point beside the click
// is in reach (orch1 verify r2 on ruling 39, MAJOR: ervet at (64.01, 50.92) beside RIFT team-0 needle_outer, a right-
// click inside the wall at (56.82, 44.87) moved the hero 0.00 m; nav.snapGoal returned the hero's own position because
// the only way to the open point 0.94 m from the click (15.5 m round the tower against 8.8 m straight) broke the detour
// cap and first stepped away from the click). The walker stands against the obstacle, so its straight walk gains
// nothing: then the way round is taken (nav SNAP_STUCK_*).
//   repro   the verifier's exact case on the real map (structures on and off): the hero ends within 1.2 m of the click
//   sweep   RIFT and BRIDGE: heroes on open cells touching a wall or a structure footprint, clicks on blocked cells 4-12 m
//           away whose nearest open cell (same component) is within 2.5 m of the click and reachable within
//           2 x straight + 2 m: 0 snaps that leave the hero where it stands (gate); the snap is never further from the
//           click than the hero started
import { buildContent, defaultOptions } from '../tools/build_content.ts';
import { createSim } from '../src/sim/sim.ts';
import { pickLoadout } from '../src/sim/bots/index.ts';
import { check, finish, section } from './fixtures/sim_fixture.ts';

const built = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
if (!built.catalog) { console.log('SKIP content build failed'); process.exit(77); }
const rc = built.catalog;
const fs = rc.fighters.map((f) => f.id).sort();
const f2 = (n: number): string => n.toFixed(2);

function fresh(who: string, modeId: string, structuresOff: boolean): ReturnType<typeof createSim> {
  const mode = rc.modes.find((m) => m.id === modeId)!, q = rc.queues.find((x) => x.mode === modeId)!;
  const seats = Array.from({ length: mode.teams * mode.perTeam }, (_, i) => {
    const fighter = i === 0 ? who : fs[(i * 3) % fs.length];
    return { player: i, team: Math.floor(i / mode.perTeam), name: `p${i}`, fighter, skin: rc.skins.find((s) => s.fighter === fighter)!.id, controller: 'human', loadout: pickLoadout(rc, fighter, mode.rules.itemPool ?? '', undefined as never), colorIndex: i };
  });
  const sim = createSim(rc, { matchId: 'wall_click', seed: 5, queue: q.id, mode: modeId, map: mode.map, seats, catalogVersion: rc.version, practice: { waves: false } } as never, { pregameSeconds: 0 });
  sim.step();
  if (structuresOff) { sim.command(0, { type: 'practice', action: 'toggleStructures' } as never); sim.step(); }
  return sim;
}

section('repro: ervet beside the RIFT team-0 mid outer tower clicks inside the wall behind it', () => {
  for (const off of [true, false]) {
    const sim = fresh('ervet', 'rift', off);
    const w = sim.world, me = w.players[0].ent!;
    for (const p of w.players) if (p.ent && p.ent !== me) { const b = w.mapDef.bases.find((q) => q.team === p.team); if (b) { p.ent.x = b.spawn[0]; p.ent.y = b.spawn[1]; } }
    me.x = 64.01; me.y = 50.92; me.path.length = 0; w.hashDirty = true;
    const gx = 56.82, gy = 44.87;
    const o = { x: 0, y: 0 };
    w.nav.snapGoal(me.x, me.y, gx, gy, o, me.radius);
    check(`structures ${off ? 'off' : 'on'}: the snap is the open point beside the click, not the hero`, Math.hypot(o.x - gx, o.y - gy) < 1.2, [f2(o.x), f2(o.y)]);
    sim.command(0, { type: 'move', x: gx, y: gy } as never);
    for (let i = 0; i < 150; i++) sim.step();
    const d = Math.hypot(me.x - gx, me.y - gy);
    check(`structures ${off ? 'off' : 'on'}: the hero walks round and ends within 1.2 m of the click (was 9.4 m, 0 m moved)`, d < 1.2, { end: [f2(me.x), f2(me.y)], d: f2(d) });
  }
});

/** deterministic LCG */
function rng(seed: number): () => number { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

section('sweep: heroes against walls and structures, clicks into the blocked side', () => {
  for (const modeId of ['rift', 'bridge']) {
    const sim = fresh('ervet', modeId, false);
    const w = sim.world, n = w.nav, c = n.cell;
    const me = w.players[0].ent!;
    const r = me.radius;
    const R = rng(modeId === 'rift' ? 11 : 23);
    // hero spots: open cells with a blocked cell within 1 cell (standing against the obstacle)
    const spots: number[] = [];
    for (let cy = 1; cy < n.h - 1; cy++) for (let cx = 1; cx < n.w - 1; cx++) {
      const i = cy * n.w + cx;
      if (n.blocked[i]) continue;
      const px = (cx + 0.5) * c, py = (cy + 0.5) * c;
      if (!n.walkable(px, py) || n.componentAt(px, py) < 0) continue;
      let edge = false;
      for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) if (n.blocked[i + dy * n.w + dx]) { edge = true; break; }
      if (edge) spots.push(i);
    }
    let tried = 0, stuck = 0, away = 0;
    const worst: unknown[] = [];
    const o = { x: 0, y: 0 }, nw = { x: 0, y: 0 }, path: number[] = [];
    for (let k = 0; k < 40000 && tried < 600; k++) {
      const i = spots[Math.floor(R() * spots.length)];
      const hx = ((i % n.w) + 0.5) * c, hy = (Math.floor(i / n.w) + 0.5) * c;
      const a = R() * Math.PI * 2, D = 4 + R() * 8;
      const gx = hx + Math.cos(a) * D, gy = hy + Math.sin(a) * D;
      if (gx < 1 || gy < 1 || gx > w.mapDef.size[0] - 1 || gy > w.mapDef.size[1] - 1 || n.walkable(gx, gy)) continue;
      // only clicks whose straight walk is blocked right at the hero (the case the old snap answered with "stay")
      const t = { x: 0, y: 0 };
      n.raycast(hx, hy, gx, gy, t);
      if (Math.hypot(t.x - hx, t.y - hy) > 0.6) continue;
      if (!n.nearestWalkable(gx, gy, nw) || Math.hypot(nw.x - gx, nw.y - gy) > 2.5 || n.componentAt(nw.x, nw.y) !== n.componentAt(hx, hy)) continue;
      path.length = 0;
      if (!n.findPath(hx, hy, nw.x, nw.y, path, r)) continue;
      let L = 0, px = hx, py = hy;
      for (let j = 0; j + 1 < path.length; j += 2) { L += Math.hypot(path[j] - px, path[j + 1] - py); px = path[j]; py = path[j + 1]; }
      const S = Math.hypot(nw.x - hx, nw.y - hy);
      if (L > 2 * S + 2 - 0.5) continue;   // a clear "way round in reach" case (0.5 m margin for the planner's own route)
      tried++;
      n.snapGoal(hx, hy, gx, gy, o, r);
      const moved = Math.hypot(o.x - hx, o.y - hy);
      if (moved < 0.3) { stuck++; if (worst.length < 6) worst.push({ hero: [f2(hx), f2(hy)], click: [f2(gx), f2(gy)], open: [f2(nw.x), f2(nw.y)], route: f2(L), straight: f2(S) }); }
      if (Math.hypot(o.x - gx, o.y - gy) > Math.hypot(hx - gx, hy - gy) + 1e-6) away++;
    }
    console.log(`  ${modeId}: ${spots.length} edge spots, ${tried} blocked-at-the-hero clicks with an open point in reach; stuck ${stuck}, snap further than the hero ${away}`);
    check(`${modeId}: enough cases sampled (>= 100)`, tried >= 100, tried);
    check(`${modeId}: 0 clicks that leave the hero where it stands (gate)`, stuck === 0, worst);
    check(`${modeId}: no snap further from the click than the hero`, away === 0, away);
  }
});

finish('probe_sim_wall_click_stuck');
