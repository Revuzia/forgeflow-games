// owner15 r1 verifier (temp): the two live wall clicks that ended far short — what the nav says about them
import { buildContent, defaultOptions } from '../tools/build_content.ts';
import { createSim } from '../src/sim/sim.ts';
import { pickLoadout } from '../src/sim/bots/index.ts';
const built = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
const rc = built.catalog!;
const fs = rc.fighters.map((f) => f.id).sort();
function fresh(who: string, structuresOff: boolean) {
  const mode = rc.modes.find((m) => m.id === 'rift')!, q = rc.queues.find((x) => x.mode === 'rift')!;
  const seats = Array.from({ length: mode.teams * mode.perTeam }, (_, i) => { const fighter = i === 0 ? who : fs[(i * 3) % fs.length]; return { player: i, team: Math.floor(i / mode.perTeam), name: `p${i}`, fighter, skin: rc.skins.find((s) => s.fighter === fighter)!.id, controller: 'human', loadout: pickLoadout(rc, fighter, mode.rules.itemPool ?? '', undefined as never), colorIndex: i }; });
  const sim = createSim(rc, { matchId: 'wc', seed: 5, queue: q.id, mode: 'rift', map: mode.map, seats, catalogVersion: rc.version, practice: { waves: false } } as never, { pregameSeconds: 0 });
  sim.step();
  if (structuresOff) { sim.command(0, { type: 'practice', action: 'toggleStructures' } as never); sim.step(); }
  return sim;
}
const cases = [['ervet', 64.01, 50.92, 56.82, 44.87], ['dunsom', 54.75, 14.25, 52.19, 20.42]] as const;
for (const off of [true, false]) for (const [who, mx, my, gx, gy] of cases) {
  const sim = fresh(who, off); const w = sim.world; const me = w.players[0].ent!;
  me.x = mx; me.y = my; me.path.length = 0; w.hashDirty = true;
  const n = w.nav; const o = { x: 0, y: 0 };
  const snap = n.snapGoal(mx, my, gx, gy, o, me.radius);
  const nw = { x: 0, y: 0 }; const nwOk = n.nearestWalkable(gx, gy, nw);
  // the walkable cells along the click ray (hero → click)
  const ray: string[] = []; for (let k = 0; k <= 20; k++) { const x = mx + (gx - mx) * k / 20, y = my + (gy - my) * k / 20; ray.push(n.walkable(x, y) ? 'w' : '#'); }
  sim.command(0, { type: 'move', x: gx, y: gy } as never);
  for (let i = 0; i < 150; i++) sim.step();
  console.log(JSON.stringify({ off, who, me: [mx, my], click: [gx, gy], snapOk: snap, snap: [+o.x.toFixed(2), +o.y.toFixed(2)], nearestWalkable: nwOk ? [+nw.x.toFixed(2), +nw.y.toFixed(2), +Math.hypot(nw.x - gx, nw.y - gy).toFixed(2)] : null, compMe: n.componentAt(mx, my), compNW: nwOk ? n.componentAt(nw.x, nw.y) : null, ray: ray.join(''), end: [+me.x.toFixed(2), +me.y.toFixed(2)], endDist: +Math.hypot(me.x - gx, me.y - gy).toFixed(2), moved: +Math.hypot(me.x - mx, me.y - my).toFixed(2), order: me.order }));
}
{
  const sim = fresh('ervet', true); const n = sim.world.nav; const out: number[] = [];
  const ok = n.findPath(64.01, 50.92, 57.75, 44.75, out, 0.5);
  let L = 0, px = 64.01, py = 50.92; for (let i = 0; i < out.length; i += 2) { L += Math.hypot(out[i] - px, out[i + 1] - py); px = out[i]; py = out[i + 1]; }
  console.log('path to nearest walkable', ok, 'len', L.toFixed(2), 'straight', Math.hypot(64.01 - 57.75, 50.92 - 44.75).toFixed(2), out.map((v) => v.toFixed(1)).join(' '));
  const ss = sim.world.entities.filter((e) => e.kind === 'structure' && Math.hypot(e.x - 61, e.y - 48) < 8).map((e) => [e.def, e.x, e.y, e.alive]);
  console.log('structures near', JSON.stringify(ss));
  // grid around, 1 m step
  for (let y = 54; y >= 42; y -= 1) { let row = ''; for (let x = 54; x <= 68; x += 1) row += (Math.abs(x - 64) < 0.6 && Math.abs(y - 51) < 0.6) ? 'H' : (Math.abs(x - 57) < 0.6 && Math.abs(y - 45) < 0.6) ? 'C' : n.walkable(x, y) ? '.' : '#'; console.log(y, row); }
}
