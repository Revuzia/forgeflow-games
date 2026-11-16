// verifier (orch1 controls r2, SIM lens): independent Wick stuck sweep. Not a registered probe.
//   node _harness/_tmp_vfy_ctl_r2_minsweep.ts --seeds 8 --seed0 301 --minutes 25 --out <json>
// Scenarios: 'bots' (all ten seats played by bots, towers fall naturally) and 'fall' (fighters stand at spawn, every
// road's outer then inner towers are killed on a per-seed schedule from 3:00 to 14:00, sides alternating).
// Own criteria (not the lane's): sampled every 10 ticks, a Wick's window resets when it covers >= 1.0 m of ground from
// the window start or starts a swing. STUCK: an 8 s window with no swing, < 1.0 m of ground, no hard CC / root, more than
// 10 m from its road's ends, and no attackable enemy within 9 m (nothing to do but walk). STALL (report, and gated at
// 15 s): the same with an enemy near (a Wick that never gets to swing yet never moves).
import { writeFileSync } from 'node:fs';
import type { CatalogT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup, SimEvent } from '../src/contracts/sim.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import { createSim, worldOf } from '../src/sim/sim.ts';
import { killEntity } from '../src/sim/combat.ts';
import { attackable } from '../src/sim/attack.ts';
import { CC_HARD, CC_ROOT, type Entity } from '../src/sim/entity.ts';
import { structuresOf } from '../src/sim/units/structures.ts';
import type { World } from '../src/sim/world.ts';
const { buildContent, defaultOptions } = await import('../tools/build_content.ts');

const argv = process.argv.slice(2);
const opt = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = Number(opt('seeds', '8')), SEED0 = Number(opt('seed0', '301')), MIN = Number(opt('minutes', '25'));
const MAPS = opt('maps', 'rift,bridge').split(','), SCENS = opt('scen', 'bots,fall').split(',');
const OUT = opt('out', '');
const built = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
const cat: CatalogT = built.catalog!;
const f1 = (n: number) => n.toFixed(1);
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function lineup(modeId: string, seed: number): MatchSetup {
  const mode = cat.modes.find((m) => m.id === modeId)!;
  const queue = cat.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? cat.queues.find((q) => q.mode === mode.id)!;
  const all = cat.fighters.map((f) => f.id).sort();
  const roles = cat.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0)).map((r) => r.id);
  // a seeded shuffle, different from the lane probe's (seed + slot + team) rotation
  let s = seed * 7919 + 13; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const deck = all.slice(); for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  const seats: SeatSetup[] = [];
  for (let i = 0; i < mode.teams * mode.perTeam; i++) {
    const team = Math.floor(i / mode.perTeam), slot = i % mode.perTeam;
    const role = mode.roles ? roles[slot % roles.length] : undefined;
    const fighter = deck[i % deck.length];
    const skin = cat.skins.find((k) => k.fighter === fighter)?.id ?? '';
    seats.push({ player: i, team, name: `p${i}`, fighter, skin, role, loadout: pickLoadout(cat, fighter, mode.rules.itemPool ?? '', role),
      controller: 'bot', botDifficulty: (['novice', 'adept', 'veteran'] as const)[(seed + team) % 3], colorIndex: i } as SeatSetup);
  }
  return { matchId: `vsw-${modeId}-${seed}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: cat.version };
}

interface Tr { x: number; y: number; t: number }
interface Hit { map: string; scen: string; seed: number; t: string; id: number; team: number; at: string; ground: number; dur: number; why: string; near: string }
const stuck: Hit[] = [], stall: Hit[] = [], runs: unknown[] = [];
const scratch: Entity[] = [];
function nearStruct(w: World, x: number, y: number): string {
  let best = '', bd = Infinity;
  for (const s of structuresOf(w)) { const d = Math.hypot(s.ent.x - x, s.ent.y - y); if (d < bd) { bd = d; best = `${s.def.id}${s.ent.alive ? '' : '(down)'} ${f1(d)}m`; } }
  return best;
}
for (const modeId of MAPS) for (const scen of SCENS) for (let k = 0; k < SEEDS; k++) {
  const seed = SEED0 + k, t0 = Date.now();
  const setup = lineup(modeId, seed);
  const sim = createSim(cat, setup, { bots: scen === 'bots' ? createBots(cat, setup) : (() => null), pregameSeconds: 0 });
  const w0 = worldOf(sim);
  const ends: [number, number][] = [];
  for (const l of w0.mapDef.lanes) { ends.push([l.path[0][0], l.path[0][1]]); ends.push([l.path[l.path.length - 1][0], l.path[l.path.length - 1][1]]); }
  // tower schedule for 'fall': each road, outer then inner, per side, staggered by seed
  const sched: { t: number; id: string; done: boolean }[] = [];
  if (scen === 'fall') {
    const ss = structuresOf(w0).filter((s) => s.def.lane && /tower|needle|outer|inner/i.test(`${s.def.unit} ${s.def.id}`));
    let r = seed * 31 + 7; const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
    for (const s of ss) {
      const inner = /inner/i.test(`${s.def.unit} ${s.def.id}`);
      const t = 180 + rnd() * 420 + (inner ? 240 + rnd() * 240 : 0);
      sched.push({ t, id: s.def.id, done: false });
    }
  }
  const tracks = new Map<number, Tr>(), swung = new Set<number>();
  let wicks = 0; const seen = new Set<number>();
  for (let tick = 0; sim.view.phase !== 'ended' && tick < MIN * 1800; tick++) {
    const evs: SimEvent[] = sim.step();
    const w = worldOf(sim);
    for (const e of evs) if (e.e === 'attack') swung.add(e.src);
    if (w.phase !== 'live') continue;
    for (const sc of sched) if (!sc.done && w.time >= sc.t) {
      sc.done = true;
      const s = structuresOf(w).find((q) => q.def.id === sc.id);
      if (s && s.ent.alive) killEntity(w, s.ent, null);
    }
    if (w.tick % 10 !== 0) continue;
    for (const e of w.entities) {
      if (e.kind !== 'minion' || !e.alive) continue;
      if (!seen.has(e.id)) { seen.add(e.id); wicks++; }
      let tr = tracks.get(e.id);
      const did = swung.has(e.id); swung.delete(e.id);
      if (!tr || did || Math.hypot(e.x - tr.x, e.y - tr.y) >= 1.0 || (e.ccMask & (CC_HARD | CC_ROOT)) !== 0) { tracks.set(e.id, { x: e.x, y: e.y, t: w.tick }); continue; }
      const dur = (w.tick - tr.t) / 30;
      if (dur < 8) continue;
      if (ends.some(([x, y]) => Math.hypot(e.x - x, e.y - y) < 10)) continue;
      const n = w.query(e.x, e.y, 9, scratch);
      let foe = false;
      for (let i = 0; i < n; i++) if (attackable(w, e, scratch[i]) && Math.hypot(scratch[i].x - e.x, scratch[i].y - e.y) - scratch[i].radius <= 9) { foe = true; break; }
      const h: Hit = { map: modeId, scen, seed, t: mmss(w.time), id: e.id, team: e.team, at: `${f1(e.x)},${f1(e.y)}`, ground: Math.hypot(e.x - tr.x, e.y - tr.y), dur,
        why: `order ${e.order} wind ${e.atkWindup >= 0 ? 1 : 0} path ${e.path.length}`, near: nearStruct(w, e.x, e.y) };
      if (!foe) { stuck.push(h); tracks.set(e.id, { x: e.x, y: e.y, t: w.tick }); }
      else if (dur >= 15) { stall.push(h); tracks.set(e.id, { x: e.x, y: e.y, t: w.tick }); }
    }
  }
  const wEnd = worldOf(sim);
  const row = { map: modeId, scen, seed, end: mmss(wEnd.time), phase: sim.view.phase, wicks, secs: (Date.now() - t0) / 1000,
    towersDown: structuresOf(wEnd).filter((s) => !s.ent.alive).length };
  runs.push(row);
  console.log(JSON.stringify(row), 'stuck so far', stuck.length, 'stall15', stall.length);
}
console.log('STUCK', stuck.length); for (const s of stuck.slice(0, 30)) console.log('  ', JSON.stringify(s));
console.log('STALL15', stall.length); for (const s of stall.slice(0, 30)) console.log('  ', JSON.stringify(s));
if (OUT) writeFileSync(OUT, JSON.stringify({ runs, stuck, stall }, null, 1));
