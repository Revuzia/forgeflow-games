// probe (lane SIM, movement, ruling 43): no Wick ever stands still, by the orch1 controls r3 verifier's strict definition
// (_tmp_vfy_ctl_r3_minsweep.ts, independent of probe_sim_minion_flow, NO exemption classes):
//   STILL  a live Wick that for 6 s covers < 1.0 m of ground (max distance from where the window began), emits no
//          'attack' event, is not under hard CC / root at any sample, and is > 8 m from the end of its own road.
//   LONG   the same for 12 s.
// The verifier found 13 STILL (0 LONG) on seeds 301-308: 12 melee back-row Wicks in an attack order with 3+ allied Wicks
// pressed on them, their target 4.7-5.4 m off, high and low roads 15:00-22:00 of all-bot games (a brightwick boxed
// behind ten of its own glimwicks creeping 0.1 m/s; the step-out found no open spot). Ruling 42: with no open attack spot
// round its target it walks through its own wave to the front (units/minions.ts passOwn, bodypath ghosts).
// Scenarios: bots (all ten seats played, towers fall naturally), idle (fighters stand; every road's outer and inner
// towers of both teams are killed at seed-random times 2:30-14:00), mixed (team 0 played, team 1 idle). Gate: STILL 0 and
// LONG 0 on every map, scenario and seed.
//   node _harness/probe_sim_wick_still.ts [--seeds 6] [--seed0 301] [--minutes 25] [--maps rift,bridge] [--scen bots,idle,mixed] [--out f]
import { writeFileSync } from 'node:fs';
import type { CatalogT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup, SimEvent } from '../src/contracts/sim.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import { createSim, worldOf } from '../src/sim/sim.ts';
import { killEntity } from '../src/sim/combat.ts';
import { attackable } from '../src/sim/attack.ts';
import { CC_HARD, CC_ROOT, type Entity } from '../src/sim/entity.ts';
import { structuresOf } from '../src/sim/units/structures.ts';
import { minionState } from '../src/sim/units/minions.ts';
import { behaviorOf } from '../src/sim/units/common.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const argv = process.argv.slice(2);
const opt = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const SEEDS = Number(opt('seeds', '6')), SEED0 = Number(opt('seed0', '301')), MINUTES = Number(opt('minutes', '25'));
const MAPS = opt('maps', 'rift,bridge').split(','), SCENS = opt('scen', 'bots,idle,mixed').split(',');
const OUT = opt('out', '');
const W_STILL = 6 * 30, W_LONG = 12 * 30, GROUND = 1.0, END_NEAR = 8, SAMPLE = 5;
const built = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
if (!built.catalog) { console.log('SKIP content'); process.exit(77); }
const catalog: CatalogT = built.catalog;

// a tiny deterministic rng for the schedule (not the sim's)
function mulberry(a: number): () => number { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function setupFor(modeId: string, seed: number, played: (team: number) => boolean): MatchSetup {
  const mode = catalog.modes.find((m) => m.id === modeId)!;
  const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id)!;
  const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0)).map((r) => r.id);
  const natives = new Map<string, string[]>();
  for (const f of catalog.fighters) { const l = natives.get(f.role) ?? []; l.push(f.id); natives.set(f.role, l); }
  for (const l of natives.values()) l.sort();
  const all = catalog.fighters.map((f) => f.id).sort();
  const pool = mode.rules.itemPool ?? '';
  const rnd = mulberry(seed * 7919 + 17);
  const seats: SeatSetup[] = [];
  for (let i = 0; i < mode.teams * mode.perTeam; i++) {
    const team = Math.floor(i / mode.perTeam), slot = i % mode.perTeam;
    const role = mode.roles ? roles[slot % roles.length] : undefined;
    const pl = (role && natives.get(role)) || all;
    const fighter = pl[Math.floor(rnd() * pl.length)];
    const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? catalog.skins.find((s) => s.fighter === fighter)?.id ?? '';
    seats.push({ player: i, team, name: `p${i}`, fighter, skin, role, loadout: pickLoadout(catalog, fighter, pool, role),
      controller: 'bot', botDifficulty: (seed + i) % 3 === 0 ? 'veteran' : 'adept', colorIndex: i } as SeatSetup);
    void played;
  }
  return { matchId: `vfy3-${modeId}-${seed}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}

interface Ep { map: string; scen: string; seed: number; t: string; dur: number; id: number; team: number; at: string; road: string; struct: string; enemyNear: boolean; pressed: number; order: number; ot: string; distEnd: number }
const near: Entity[] = [];
const fm = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const f1 = (n: number): string => n.toFixed(1);

function runOne(map: string, scen: string, seed: number): { eps: Ep[]; end: number; wicks: number; secs: number; towersFell: number } {
  const t0 = Date.now();
  const played = (team: number): boolean => scen === 'bots' || (scen === 'mixed' && team === 0);
  const setup = setupFor(map, seed, played);
  const fac = scen === 'idle' ? null : createBots(catalog, setup);
  const sim = createSim(catalog, setup, { bots: (seat, host) => (fac && played(seat.team) ? fac(seat, host) : null), pregameSeconds: 0 });
  const w0 = worldOf(sim);
  const roads = w0.mapDef.lanes;
  // tower schedule (idle and mixed): every road, both teams, outer then inner at seed-random times
  const rnd = mulberry(seed * 104729 + map.length);
  const sched: { t: number; team: number; road: string; tier: RegExp; done: boolean }[] = [];
  if (scen !== 'bots') for (const r of roads) for (const team of [0, 1]) {
    const to = 150 + rnd() * 450; sched.push({ t: to, team, road: r.id, tier: /outer/, done: false });
    if (rnd() < 0.6) sched.push({ t: to + 60 + rnd() * 240, team, road: r.id, tier: /inner/, done: false });
  }
  const roadOf = new Map<number, { road: string; ex: number; ey: number }>();
  const track = new Map<number, { t0: number; x0: number; y0: number; maxD: number; attacked: boolean; cc: boolean }>();
  const lastAtk = new Map<number, number>();
  const eps: Ep[] = [];
  const seen = new Set<number>();
  const limit = MINUTES * 60 * 30;
  let towersFell = 0;
  for (let tick = 0; sim.view.phase !== 'ended' && tick < limit; tick++) {
    const evs: SimEvent[] = sim.step();
    const w = worldOf(sim);
    for (const ev of evs) {
      if (ev.e === 'attack') lastAtk.set(ev.src, w.tick);
      if (ev.e === 'death' && ev.kind === 'structure') towersFell++;
    }
    if (w.phase !== 'live') continue;
    for (const sc of sched) {
      if (sc.done || w.time < sc.t) continue;
      sc.done = true;
      for (const s of structuresOf(w)) if (s.ent.alive && s.ent.team === sc.team && (s.def.lane ?? '') === sc.road && sc.tier.test(s.def.unit)) { killEntity(w, s.ent, null); break; }
    }
    if (w.tick % SAMPLE !== 0) continue;
    for (const e of w.entities) {
      if (e.kind !== 'minion' || !e.alive) continue;
      const m = minionState(e); if (!m) continue;
      seen.add(e.id);
      let ro = roadOf.get(e.id);
      if (!ro) {
        const p = m.path; const end = p[p.length - 1];
        const road = roads.find((l) => (l.path[0][0] === p[0][0] && l.path[0][1] === p[0][1]) || (l.path[l.path.length - 1][0] === p[0][0] && l.path[l.path.length - 1][1] === p[0][1]))?.id ?? '?';
        ro = { road, ex: end[0], ey: end[1] }; roadOf.set(e.id, ro);
      }
      const distEnd = Math.hypot(e.x - ro.ex, e.y - ro.ey);
      let tr = track.get(e.id);
      const reset = (): void => { track.set(e.id, { t0: w.tick, x0: e.x, y0: e.y, maxD: 0, attacked: false, cc: false }); };
      if (!tr) { reset(); continue; }
      const d = Math.hypot(e.x - tr.x0, e.y - tr.y0);
      const atk = (lastAtk.get(e.id) ?? -1) > tr.t0;
      const cc = (e.ccMask & (CC_HARD | CC_ROOT)) !== 0;
      if (d >= GROUND || atk || cc || distEnd < END_NEAR) { reset(); continue; }
      const dur = w.tick - tr.t0;
      if (dur === W_STILL || dur === W_LONG || (dur > W_LONG && dur % (W_LONG) === 0)) {
        let enemyNear = false, pressed = 0;
        const ar = (e.unit ? behaviorOf(e.unit).aggroRange : 7) + 1.5;
        const n = w.query(e.x, e.y, ar, near);
        for (let i = 0; i < n; i++) { const o = near[i]; if (o !== e && attackable(w, e, o)) enemyNear = true;
          if (o !== e && o.alive && o.kind === 'minion' && o.team === e.team && Math.hypot(o.x - e.x, o.y - e.y) < e.radius + o.radius + 0.3) pressed++; }
        let struct = '', bd = Infinity;
        for (const s of structuresOf(w)) { const dd = Math.hypot(s.ent.x - e.x, s.ent.y - e.y) - s.ent.radius; if (dd < bd) { bd = dd; struct = `${s.def.id}${s.ent.alive ? '' : '(fallen)'} ${f1(dd)}m`; } }
        const o = w.entity(e.orderTarget);
        eps.push({ map, scen, seed, t: fm(w.time), dur: Math.round(dur / 30), id: e.id, team: e.team, at: `${f1(e.x)},${f1(e.y)}`, road: ro.road, struct, enemyNear, pressed, order: e.order,
          ot: o ? `${o.kind}${o.alive ? '' : '+dead'} ${f1(Math.hypot(o.x - e.x, o.y - e.y) - o.radius - e.radius)}m vis${(o.visibleMask >> e.team) & 1}` : '-', distEnd: Math.round(distEnd) });
      }
    }
    for (const id of track.keys()) { const e = w.entity(id); if (!e || !e.alive) track.delete(id); }
  }
  return { eps, end: worldOf(sim).time, wicks: seen.size, secs: (Date.now() - t0) / 1000, towersFell };
}

const allEps: Ep[] = []; const runs: unknown[] = [];
for (const map of MAPS) for (const scen of SCENS) for (let seed = SEED0; seed < SEED0 + SEEDS; seed++) {
  const r = runOne(map, scen, seed);
  allEps.push(...r.eps);
  const still = r.eps.filter((e) => e.dur === 6).length, long = r.eps.filter((e) => e.dur >= 12).length;
  runs.push({ map, scen, seed, min: +(r.end / 60).toFixed(1), wicks: r.wicks, still, long, secs: Math.round(r.secs) });
  console.log(`${map} ${scen} s${seed}: ${f1(r.end / 60)} min, ${r.wicks} Wicks, still6 ${still}, long12 ${long} (${Math.round(r.secs)} s)`);
  for (const e of r.eps.slice(0, 6)) console.log('   ', JSON.stringify(e));
}
const still = allEps.filter((e) => e.dur === 6), long = allEps.filter((e) => e.dur >= 12);
const cls = (l: Ep[]): Record<string, number> => { const o: Record<string, number> = {}; for (const e of l) { const k = `${e.enemyNear ? 'enemyNear' : 'free'}/${e.pressed >= 3 ? 'pressed3+' : 'open'}`; o[k] = (o[k] ?? 0) + 1; } return o; };
console.log(`TOTAL still6 ${still.length} ${JSON.stringify(cls(still))}; long12 ${long.length} ${JSON.stringify(cls(long))}`);
if (OUT) writeFileSync(OUT, JSON.stringify({ runs, still: still.length, long: long.length, classes: { still: cls(still), long: cls(long) }, episodes: allEps }, null, 1));
console.log(still.length === 0 ? 'PASS 0 still Wicks (6 s)' : `FAIL ${still.length} still (6 s) Wick episodes`);
console.log(long.length === 0 ? 'PASS 0 long Wicks (12 s)' : `FAIL ${long.length} long (12 s) Wick episodes`);
console.log(`probe_sim_wick_still: ${still.length + long.length === 0 ? 'pass' : 'FAIL'}`);
if (still.length + long.length > 0) process.exit(1);
