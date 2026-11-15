// probe (lane SIM, movement): the live verifier's held-button repros at the RIFT mid first tower (orch1
// verify_controls_live HOLD-DITHER / HOLD-PINNED-CRAWL / HOLD-REGRESS, commit 098ac7436; ruling 39), on the real map.
//   dither  the hero holds the right button (the same point re-sent every 500 ms) from beside its own mid outer
//           tower to a point past its own wave standing in the tower's neck: it gets there with no back-and-forth
//           (< 3 reversals of >= 0.5 m legs in any 4 s, no regress > 1 m)
//   crawl   an enemy clump pressed on the south wall of the road between the hero and its point: the held move walks
//           round it (or ends cleanly when there is no way), never crawling along the wall for seconds
//   allies  a stand-still allied wave filling the whole neck: the hero walks through its own Wicks; Wicks walking
//           the road pass a hero standing in the neck (neither shoves the other off its spot)
import { buildContent, defaultOptions } from '../tools/build_content.ts';
import { createSim } from '../src/sim/sim.ts';
import { pickLoadout } from '../src/sim/bots/index.ts';
import { spawnUnit } from '../src/sim/spawn.ts';
import { ORDER_NONE, type Entity } from '../src/sim/entity.ts';
import type { World } from '../src/sim/world.ts';
import { minionState } from '../src/sim/units/minions.ts';
import { check, finish, section } from './fixtures/sim_fixture.ts';

const built = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
if (!built.catalog) { console.log('SKIP content build failed'); process.exit(77); }
const rc = built.catalog;
const fs = rc.fighters.map((f) => f.id).sort();
const WICK = rc.modes.find((m) => m.id === 'rift')!.rules.minionWaves!.composition[0].unit;
const f2 = (n: number): string => n.toFixed(2);

function fresh(who: string): { w: World; sim: ReturnType<typeof createSim>; me: Entity } {
  const mode = rc.modes.find((m) => m.id === 'rift')!, q = rc.queues.find((x) => x.mode === 'rift')!;
  const seats = Array.from({ length: 10 }, (_, i) => {
    const fighter = i === 0 ? who : fs[(i * 3) % fs.length];
    return { player: i, team: i < 5 ? 0 : 1, name: `p${i}`, fighter, skin: rc.skins.find((s) => s.fighter === fighter)!.id, controller: 'human', loadout: pickLoadout(rc, fighter, mode.rules.itemPool ?? '', undefined as never), colorIndex: i };
  });
  const sim = createSim(rc, { matchId: 'hold_tower', seed: 5, queue: q.id, mode: 'rift', map: mode.map, seats, catalogVersion: rc.version, practice: { waves: false } } as never, { pregameSeconds: 0 });
  sim.step();
  const w = sim.world;
  for (const e of w.entities) if (e.kind === 'structure') e.stats.ad = 0;
  for (const p of w.players) if (p.ent && p.ent !== w.players[0].ent) { p.ent.x = p.team === 0 ? 10 : 160; p.ent.y = 55; }
  const me = w.players[0].ent!;
  w.hashDirty = true;
  return { w, sim, me };
}
const place = (w: World, e: Entity, x: number, y: number): void => { e.x = x; e.y = y; e.path.length = 0; e.pathGoalX = NaN; e.order = ORDER_NONE; w.hashDirty = true; };
/** a Wick that stands where it is put (no lane brain, no auto attack) */
function stand(w: World, team: number, x: number, y: number): Entity {
  const u = spawnUnit(w, WICK, team, x, y);
  u.autoAttack = false;
  return u;
}
interface Held { end: number; revs: number; worst4s: number; regress: number; path: number; secs: number }
function holdTo(sim: ReturnType<typeof createSim>, me: Entity, gx: number, gy: number, ticks: number, keep?: () => void): Held {
  const x0 = me.x, y0 = me.y, L = Math.hypot(gx - x0, gy - y0), ux = (gx - x0) / L, uy = (gy - y0) / L;
  let ext = 0, dir = 0, minD = L, regress = 0, path = 0, px = me.x, py = me.y, done = ticks;
  const revAt: number[] = [];
  for (let q = 0; q < ticks; q++) {
    if (q % 15 === 0 && Math.hypot(me.x - gx, me.y - gy) > 2) sim.command(0, { type: 'move', x: gx, y: gy });
    me.hp = me.maxHp; keep?.(); sim.step();
    path += Math.hypot(me.x - px, me.y - py); px = me.x; py = me.y;
    const p = (me.x - x0) * ux + (me.y - y0) * uy;
    if (dir === 0) { if (p - ext >= 0.5) { dir = 1; ext = p; } else if (ext - p >= 0.5) { dir = -1; ext = p; } }
    else if (dir > 0) { if (p > ext) ext = p; else if (ext - p >= 0.5) { revAt.push(q); dir = -1; ext = p; } }
    else { if (p < ext) ext = p; else if (p - ext >= 0.5) { revAt.push(q); dir = 1; ext = p; } }
    const d = Math.hypot(me.x - gx, me.y - gy);
    regress = Math.max(regress, d - minD); minD = Math.min(minD, d);
    if (d < 0.4 && me.order === ORDER_NONE) { done = q; break; }
  }
  let worst = 0;
  for (let i = 0; i < revAt.length; i++) { let k = i; while (k + 1 < revAt.length && revAt[k + 1] - revAt[i] <= 120) k++; worst = Math.max(worst, k - i + 1); }
  return { end: Math.hypot(me.x - gx, me.y - gy), revs: revAt.length, worst4s: worst, regress, path, secs: done / 30 };
}

for (const who of fs.filter((f) => /dunsom|ulkro|tunlan|lisvel/.test(f)).concat(fs.slice(0, 2))) {
  section(`dither (${who}): a held move past its own wave standing in the mid first tower's neck`, () => {
    const { w, sim, me } = fresh(who);
    place(w, me, 60.5, 54.2);
    // the allied wave holding at its tower (3 staggered rows across the neck north of the tower and east of it)
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) stand(w, 0, 63.6 + r * 1.05 + (c % 2) * 0.5, 53.9 + c * 1.15);
    for (let c = 0; c < 3; c++) stand(w, 0, 64.4 + c * 1.0, 51.2);
    // the enemy wave beyond (fighting, standing)
    for (let c = 0; c < 5; c++) stand(w, 1, 72.5 + (c % 2) * 0.6, 52 + c * 1.1);
    const h = holdTo(sim, me, 69.48, 50.66, 30 * 9);
    check(`${who}: reaches the held point`, h.end < 1, { end: f2(h.end), secs: f2(h.secs) });
    check(`${who}: < 3 reversals (>= 0.5 m) in any 4 s, regress <= 1 m`, h.worst4s < 3 && h.regress <= 1, { revs: h.revs, worst4s: h.worst4s, regress: f2(h.regress), path: f2(h.path) });
  });
  section(`crawl (${who}): an enemy clump on the south wall between the hero and its point`, () => {
    const { w, sim, me } = fresh(who);
    place(w, me, 64, 51);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) stand(w, 1, 66.4 + r * 0.95, 50.9 + c * 0.95);
    const h = holdTo(sim, me, 70, 50.7, 30 * 8);
    check(`${who}: walks round the clump to the point`, h.end < 1, { end: f2(h.end), secs: f2(h.secs), path: f2(h.path) });
    check(`${who}: no back-and-forth`, h.worst4s < 3 && h.regress <= 1, { revs: h.revs, worst4s: h.worst4s, regress: f2(h.regress) });
  });
}

section('allies: a stand-still allied wave filling the neck does not stop its own fighter', () => {
  const { w, sim, me } = fresh(fs[0]);
  place(w, me, 59, 55);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) stand(w, 0, 63 + r * 0.9, 53.8 + c * 1.05);
  const h = holdTo(sim, me, 68, 55, 30 * 6);
  check('the hero walks through its own Wicks to the point (straight, under 3 s)', h.end < 0.6 && h.secs < 3 && h.path < 9.6, { end: f2(h.end), secs: f2(h.secs), path: f2(h.path) });
});

section('allies: Wicks walking the road pass a hero standing in the tower\'s neck; the hero is not shoved', () => {
  const { w, sim, me } = fresh(fs[1]);
  place(w, me, 63.5, 55);
  const wicks: Entity[] = [];
  for (let i = 0; i < 9; i++) { const u = spawnUnit(w, WICK, 0, 54 - Math.floor(i / 3) * 1.3, 53.9 + (i % 3) * 1.1); wicks.push(u); }
  for (const u of wicks) { u.order = 2; u.orderX = 80; u.orderY = u.y; u.orderReqX = 80; u.orderReqY = u.y; }
  const x0 = me.x, y0 = me.y;
  let shove = 0;
  for (let q = 0; q < 30 * 8; q++) { for (const u of wicks) if (u.alive && u.order === ORDER_NONE && u.x < 79) { u.order = 2; u.orderX = 80; u.orderY = 55; u.path.length = 0; u.pathGoalX = NaN; } sim.step(); shove = Math.max(shove, Math.hypot(me.x - x0, me.y - y0)); }
  const past = wicks.filter((u) => u.x > 70).length;
  check('every Wick got past the hero', past === wicks.length, { past, of: wicks.length, xs: wicks.map((u) => f2(u.x)) });
  check('the hero was not shoved (<= 0.05 m)', shove <= 0.05, f2(shove));
  void minionState;
});

finish('probe_sim_hold_tower');
