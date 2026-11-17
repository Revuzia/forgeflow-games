// probe (lane SIM, Wicks, ruling 46): marching Wicks walk the drawn lane line, not chords between its vertices.
// Owner 2026-11-15: "they dont follow the traight path and move slightly under the path and come back around ... at
// the top lane closer to the 2nd tower". Diagnosis _design/reviews/orch1/wobble_diagnosis.md: followLane aimed at the
// vertex ~9 m ahead (corner cut 0.5-0.7 m at the 12-20 deg bends by the inner needle), every column aimed at the same
// vertex (pinch + separation), and a post-fight rejoin walked a long diagonal to the next vertex. Fix (units/minions.ts):
// a carrot LANE_LOOK m ahead on the polyline, each Wick keeps its column slot, a rejoin aims from its projection.
//
// Scenarios: idle (fighters stand, towers alive, 8 min) and bots (all ten seats played, 14 min); maps RIFT (three
// roads) and BRIDGE; seeds 3,7,11,19,23,31. Every tick, every Wick:
//   free   its order is not ATTACK, not chasing, not stepping out, not passing its wave, no attackable enemy in aggro
//   clear  > 3 m from any live structure rim, any live body not of its team and any Wick of its own held under 0.6 of
//          its walk; > 16 m of arc from its spawn end and > 6 m from the far end; no forced movement (dash, knock, fear,
//          taunt, hard CC, or shoved over 1.5 × its walk in a tick)
//   d      signed offset from the lane polyline, left of its travel +; off = d − its column slot
// Bars (every map, road, team and 4 m arc bin; both scenarios):
//   B1 wave centroid  mean off of a wave's free+clear Wicks, not settling, in a bin (a wave: the Wicks of a road and
//                     side passing the bin together, no 2 s gap; waves of ≥ 2 Wicks with ≥ 15 samples there; a lone
//                     Wick is B2's):
//                     median |.| ≤ 0.20 m, max ≤ 0.30 m (raw mean d, slots not taken off, is reported beside it)
//   settling         a Wick that turns free (a fight over) or comes out of forced movement with |off| > 0.3 m,
//                    until |off| ≤ 0.3 m or 3 + 2|off| m of arc on: left out of B1 and B2 (its return is B4); one still off after that counts again
//   B2 single Wick    free+clear samples, not settling: |off| p95 ≤ 0.6 m, max ≤ 1.2 m
//   B3 no reversal    0 Wicks free+clear for a whole 0.5 s whose net move along the road is < −0.3 m
//   B4 rejoin         a Wick turning free with |off| > 1 m: arc walked until |off| ≤ 0.5 m, p95 ≤ 6 m (max and
//                     overshoots past the line reported; episodes cut short by a new fight are dropped)
//   B5 timing         idle, waves 1-3: the first tick a Wick of the wave is within rim + 8 m of each of its own towers
//                     on its road (the march), and the first damage between Wicks of wave n of both sides per road (first
//                     contact, the meeting): within ±0.5 s of BASE (the values at HEAD c0d09e682 with units/minions.ts at
//                     271560c8f, before ruling 46). A wave's first hit on any enemy Wick (a leftover of the wave before:
//                     the fight before, not the walk) is reported as contact_any. --record prints the table instead.
//   B7 lantern        (reported) free Wicks walking a nav detour (e.path) in their first 20 m of arc, no enemy in aggro
//   B6 determinism    RIFT idle seed 7 twice (3 min): identical x,y trace hash.
//   node _harness/probe_sim_minion_lane_line.ts [--seeds 3,7,11,19,23,31] [--maps rift,bridge] [--scen idle,bots]
//        [--idle-min 8] [--bots-min 14] [--record] [--verbose]
import type { CatalogT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup, SimEvent } from '../src/contracts/sim.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import { createSim, worldOf } from '../src/sim/sim.ts';
import { attackable } from '../src/sim/attack.ts';
import { CC_FEAR, CC_HARD, CC_TAUNT, ORDER_ATTACK, type Entity } from '../src/sim/entity.ts';
import { structuresOf } from '../src/sim/units/structures.ts';
import { minionState } from '../src/sim/units/minions.ts';
import { behaviorOf } from '../src/sim/units/common.ts';
import type { World } from '../src/sim/world.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const argv = process.argv.slice(2);
const opt = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const SEEDS = opt('seeds', '3,7,11,19,23,31').split(',').map(Number);
const MAPS = opt('maps', 'rift,bridge').split(',');
const SCENS = opt('scen', 'idle,bots').split(',');
const IDLE_MIN = Number(opt('idle-min', '8')), BOTS_MIN = Number(opt('bots-min', '14'));
const RECORD = argv.includes('--record'), VERBOSE = argv.includes('--verbose');
const SETTLE = 0.3, SETTLE_ARC = 3;
const BIN = 4, SPAWN_SKIP = 16, END_SKIP = 6, CLEAR = 3, WIN = 15;
const built = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
if (!built.catalog) { console.log('SKIP content build failed'); process.exit(77); }
const catalog: CatalogT = built.catalog;

// B5 baseline (idle, the 6-seed means at c20d06630, before ruling 46): `map|road|t<team>|w<wave>|<own tower>` the wave
// reaching the tower, `map|road|w<wave>|contact` its first Wick-on-Wick damage (seconds)
const BASE: Record<string, number> = {
  'bridge|road_span|t0|w1|a_span_needle_inner': 24.67, 'bridge|road_span|t0|w1|a_span_needle_outer': 29.63, 'bridge|road_span|t0|w2|a_span_needle_inner': 49.67,
  'bridge|road_span|t0|w2|a_span_needle_outer': 54.63, 'bridge|road_span|t0|w3|a_span_needle_inner': 74.67, 'bridge|road_span|t0|w3|a_span_needle_outer': 79.63,
  'bridge|road_span|t1|w1|s_span_needle_inner': 24.67, 'bridge|road_span|t1|w1|s_span_needle_outer': 29.63, 'bridge|road_span|t1|w2|s_span_needle_inner': 49.67,
  'bridge|road_span|t1|w2|s_span_needle_outer': 54.63, 'bridge|road_span|t1|w3|s_span_needle_inner': 74.67, 'bridge|road_span|t1|w3|s_span_needle_outer': 79.63,
  'bridge|road_span|w1|contact': 38.8, 'bridge|road_span|w2|contact': 64.23, 'bridge|road_span|w3|contact': 89,
  'rift|road_high|t0|w1|a_high_needle_inner': 37.3, 'rift|road_high|t0|w1|a_high_needle_outer': 44.47, 'rift|road_high|t0|w2|a_high_needle_inner': 67.3,
  'rift|road_high|t0|w2|a_high_needle_outer': 74.47, 'rift|road_high|t0|w3|a_high_needle_inner': 97.3, 'rift|road_high|t0|w3|a_high_needle_outer': 104.47,
  'rift|road_high|t1|w1|s_high_needle_inner': 37.3, 'rift|road_high|t1|w1|s_high_needle_outer': 44.47, 'rift|road_high|t1|w2|s_high_needle_inner': 67.3,
  'rift|road_high|t1|w2|s_high_needle_outer': 74.47, 'rift|road_high|t1|w3|s_high_needle_inner': 97.3, 'rift|road_high|t1|w3|s_high_needle_outer': 104.47,
  'rift|road_high|w1|contact': 55.2, 'rift|road_high|w2|contact': 85.37, 'rift|road_high|w3|contact': 115.7,
  'rift|road_low|t0|w1|a_low_needle_inner': 37.3, 'rift|road_low|t0|w1|a_low_needle_outer': 44.47, 'rift|road_low|t0|w2|a_low_needle_inner': 67.3,
  'rift|road_low|t0|w2|a_low_needle_outer': 74.47, 'rift|road_low|t0|w3|a_low_needle_inner': 97.3, 'rift|road_low|t0|w3|a_low_needle_outer': 104.47,
  'rift|road_low|t1|w1|s_low_needle_inner': 37.3, 'rift|road_low|t1|w1|s_low_needle_outer': 44.47, 'rift|road_low|t1|w2|s_low_needle_inner': 67.3,
  'rift|road_low|t1|w2|s_low_needle_outer': 74.47, 'rift|road_low|t1|w3|s_low_needle_inner': 97.3, 'rift|road_low|t1|w3|s_low_needle_outer': 104.47,
  'rift|road_low|w1|contact': 55.2, 'rift|road_low|w2|contact': 85.5, 'rift|road_low|w3|contact': 115.57,
  'rift|road_seat|t0|w1|a_seat_needle_inner': 34.67, 'rift|road_seat|t0|w1|a_seat_needle_outer': 39.67, 'rift|road_seat|t0|w2|a_seat_needle_inner': 64.67,
  'rift|road_seat|t0|w2|a_seat_needle_outer': 69.67, 'rift|road_seat|t0|w3|a_seat_needle_inner': 94.67, 'rift|road_seat|t0|w3|a_seat_needle_outer': 99.67,
  'rift|road_seat|t1|w1|s_seat_needle_inner': 34.67, 'rift|road_seat|t1|w1|s_seat_needle_outer': 39.63, 'rift|road_seat|t1|w2|s_seat_needle_inner': 64.67,
  'rift|road_seat|t1|w2|s_seat_needle_outer': 69.63, 'rift|road_seat|t1|w3|s_seat_needle_inner': 94.67, 'rift|road_seat|t1|w3|s_seat_needle_outer': 99.63,
  'rift|road_seat|w1|contact': 49.4, 'rift|road_seat|w2|contact': 79.47, 'rift|road_seat|w3|contact': 109.63,
};

function setupFor(modeId: string, seed: number): MatchSetup {
  const mode = catalog.modes.find((m) => m.id === modeId)!;
  const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id)!;
  const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0)).map((r) => r.id);
  const natives = new Map<string, string[]>();
  for (const f of catalog.fighters) { const l = natives.get(f.role) ?? []; l.push(f.id); natives.set(f.role, l); }
  for (const l of natives.values()) l.sort();
  const all = catalog.fighters.map((f) => f.id).sort();
  const seats: SeatSetup[] = [];
  for (let i = 0; i < mode.teams * mode.perTeam; i++) {
    const team = Math.floor(i / mode.perTeam), slot = i % mode.perTeam;
    const role = mode.roles ? roles[slot % roles.length] : undefined;
    const pl = (role && natives.get(role)) || all;
    const fighter = pl[(seed + slot + team) % pl.length];
    const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? catalog.skins.find((s) => s.fighter === fighter)?.id ?? '';
    seats.push({ player: i, team, name: `p${i}`, fighter, skin, role, loadout: pickLoadout(catalog, fighter, mode.rules.itemPool ?? '', role),
      controller: 'bot', botDifficulty: 'adept', colorIndex: i } as SeatSetup);
  }
  return { matchId: `laneline-${modeId}-${seed}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}

type P = [number, number];
interface Road { id: string; pts: P[]; cum: number[]; len: number }
function roadsOf(w: World): Road[] {
  return w.mapDef.lanes.filter((l) => l.path.length >= 2).map((l) => {
    const pts = l.path.map((p) => [p[0], p[1]] as P); const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { id: l.id, pts, cum, len: cum[cum.length - 1] };
  });
}
/** arc s from the road's first point, signed d (left of the road's own direction +), its unit tangent */
function project(g: Road, x: number, y: number): { s: number; d: number; tx: number; ty: number } {
  let bd = Infinity, s = 0, d = 0, tx = 1, ty = 0;
  for (let i = 1; i < g.pts.length; i++) {
    const [ax, ay] = g.pts[i - 1], [bx, by] = g.pts[i]; const abx = bx - ax, aby = by - ay, L = Math.hypot(abx, aby);
    if (L < 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / (L * L)));
    const ox = x - ax - abx * t, oy = y - ay - aby * t, dd = ox * ox + oy * oy;
    if (dd < bd) { bd = dd; s = g.cum[i - 1] + t * L; tx = abx / L; ty = aby / L; d = (tx * oy - ty * ox) >= 0 ? Math.sqrt(dd) : -Math.sqrt(dd); }
  }
  return { s, d, tx, ty };
}
const pct = (a: number[], p: number): number => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const q: Entity[] = [];

interface Track { road: number; wave: number; slot: number; freeRun: number; hist: number[]; wasFree: boolean;
  rj: { s0: number; off0: number; done: boolean } | null; lastS: number; settle: number; settleArc: number; px: number; py: number; forced: boolean }
interface Acc {
  centroid: Map<string, Map<string, { off: number; d: number; n: number; ids: Map<number, { n: number; off: number; fr: number; t: number }> }>>;   // bin key → wave key → sums
  single: Map<string, number[]>;                                                  // bin key → |off|
  rev: { key: string; at: string }[]; revIds: Set<string>;
  rejoin: number[]; rejoinWorst: string; rejoinOvershoot: number;
  timing: Map<string, number[]>;
  grp: Map<string, { last: number; idx: number }>;
  singleWho: Map<string, { n: number; off: number; t: number }>;
  detour: Set<string>;
  detourAt: Map<string, number>;
  samples: number;
}
const newAcc = (): Acc => ({ centroid: new Map(), single: new Map(), rev: [], revIds: new Set(), rejoin: [], rejoinWorst: '', rejoinOvershoot: 0, timing: new Map(), samples: 0, grp: new Map(), singleWho: new Map(), detour: new Set(), detourAt: new Map() });

function freeOf(w: World, e: Entity): boolean {
  const m = minionState(e)!;
  if (e.order === ORDER_ATTACK || m.chasing || w.tick < m.flankUntil || e.passOwn) return false;
  const aggro = behaviorOf(e.unit!).aggroRange;
  const n = w.query(e.x, e.y, aggro + 2, q);
  for (let i = 0; i < n; i++) {
    const o = q[i];
    if (o === e || !o.alive || o.team === e.team) continue;
    if (Math.hypot(o.x - e.x, o.y - e.y) - o.radius <= aggro && attackable(w, e, o)) return false;
  }
  return true;
}
function clearOf(w: World, e: Entity): boolean {
  if (e.dash || (e.ccMask & (CC_HARD | CC_FEAR | CC_TAUNT)) !== 0) return false;
  const n = w.query(e.x, e.y, CLEAR + 3, q);
  for (let i = 0; i < n; i++) {
    const o = q[i];
    if (o === e || !o.alive || o.kind === 'projectile' || o.kind === 'zone' || o.kind === 'ward' || o.kind === 'pickup') continue;
    // its own side's Wicks block when they stand or are held up (under 0.6 of their walk: fighting, a jammed blob it
    // presses through); fighters of its side ghost
    if (o.kind !== 'structure' && o.team === e.team) {
      const sp = o.stats.moveSpeed * 0.6;
      if (o.kind !== 'minion' || o.vx * o.vx + o.vy * o.vy >= sp * sp) continue;
    }
    if (Math.hypot(o.x - e.x, o.y - e.y) - o.radius - e.radius < CLEAR) return false;
  }
  return true;
}

function runOne(map: string, scen: string, seed: number, acc: Acc, minutes: number, hashOnly = false): string {
  const setup = setupFor(map, seed);
  const fac = scen === 'bots' ? createBots(catalog, setup) : null;
  const sim = createSim(catalog, setup, { bots: (seat, host) => (fac ? fac(seat, host) : null), pregameSeconds: 0 });
  const w0 = worldOf(sim);
  const roads = roadsOf(w0);
  const towers = structuresOf(w0).filter((s) => /needle/.test(s.def.unit) && s.def.lane).map((s) => ({ id: s.def.id, lane: s.def.lane!, team: s.ent.team, ent: s.ent }));
  const tr = new Map<number, Track>();
  const firstT = new Map<string, number>();
  let hash = 2166136261;
  const limit = minutes * 60 * 30;
  for (let tick = 0; tick < limit && sim.view.phase !== 'ended'; tick++) {
    const evs: SimEvent[] = sim.step();
    const w = worldOf(sim);
    if (scen === 'idle' && !hashOnly) for (const ev of evs) {
      if (ev.e !== 'damage') continue;
      const a = w.entity(ev.src), b = w.entity(ev.dst);
      if (!a || !b || a.kind !== 'minion' || b.kind !== 'minion' || a.team === b.team) continue;
      const ta = tr.get(a.id), tb = tr.get(b.id); if (!ta || ta.wave > 3) continue;
      // the meeting: a Wick of wave n hitting a Wick of the enemy's wave n (the march; gated). A wave n Wick's first hit on
      // any enemy Wick (a leftover of wave n − 1 that won its fight further up the road) is reported beside it: it
      // follows the fight before, not the walk
      const k = `${map}|${roads[ta.road].id}|w${ta.wave}|contact`, ka = `${k}_any`;
      if (!firstT.has(ka)) firstT.set(ka, w.time);
      if (tb && tb.wave === ta.wave && !firstT.has(k)) firstT.set(k, w.time);
    }
    for (const e of w.entities) {
      if (e.kind !== 'minion' || !e.alive || !e.unit) continue;
      const m = minionState(e); if (!m || m.path.length < 2) continue;
      if (hashOnly) { hash = Math.imul(hash ^ Math.round(e.x * 1e4), 16777619); hash = Math.imul(hash ^ Math.round(e.y * 1e4), 16777619); continue; }
      let t = tr.get(e.id);
      if (!t) {
        const p0 = m.path[0];
        const road = roads.findIndex((g) => { const a = e.team === 0 ? g.pts[0] : g.pts[g.pts.length - 1]; return a[0] === p0[0] && a[1] === p0[1]; });
        const mm = m as unknown as { slot?: number };
        t = { road, wave: 0, slot: mm.slot ?? 0, freeRun: 0, hist: [], wasFree: false, rj: null, lastS: NaN, settle: NaN, settleArc: 0, px: e.x, py: e.y, forced: false };
        // wave number from spawn time (first + (n − 1) × interval)
        const mw = w.rules.minionWaves!;
        t.wave = Math.round((e.spawnTime - mw.first) / mw.interval) + 1;
        tr.set(e.id, t);
      }
      if (t.road < 0) continue;
      const g = roads[t.road];
      const pr = project(g, e.x, e.y);
      const dir = e.team === 0 ? 1 : -1;
      const sT = e.team === 0 ? pr.s : g.len - pr.s;            // arc from its own spawn end
      const dT = pr.d * dir;                                      // left of ITS travel +
      const off = dT - t.slot;
      // B5 timing (idle, waves 1-3)
      if (scen === 'idle' && t.wave <= 3) for (const tw of towers) {
        if (tw.lane !== g.id || !tw.ent.alive || tw.team !== e.team) continue;
        if (Math.hypot(tw.ent.x - e.x, tw.ent.y - e.y) - tw.ent.radius > 8) continue;
        const k = `${map}|${g.id}|t${e.team}|w${t.wave}|${tw.id}`;
        if (!firstT.has(k)) firstT.set(k, w.time);
      }
      const free = freeOf(w, e);
      // shoved faster than it walks (a knock, a blink landing on it): forced, and settling from there like after a fight
      const shoved = Math.hypot(e.x - t.px, e.y - t.py) > e.stats.moveSpeed / 30 * 1.5;
      t.px = e.x; t.py = e.y;
      // … or feared, taunted, stunned, knocked: forced movement
      const forced = shoved || !!e.dash || (e.ccMask & (CC_HARD | CC_FEAR | CC_TAUNT)) !== 0;
      const wasForced = t.forced; t.forced = forced;
      if (free && sT < 20 && e.path.length > 0 && !acc.detour.has(`${seed}#${e.id}`)) { acc.detour.add(`${seed}#${e.id}`); if (VERBOSE) { const k3 = `${g.id} t${e.team} s${Math.floor(sT / 4) * 4} slot${t.slot.toFixed(2)}`; acc.detourAt.set(k3, (acc.detourAt.get(k3) ?? 0) + 1); } }
      const clear = free && !forced && clearOf(w, e) && sT > SPAWN_SKIP && sT < g.len - END_SKIP;
      // B4 rejoin episodes
      if (free && !t.wasFree && Math.abs(off) > 1) t.rj = { s0: sT, off0: off, done: false };
      // settling back on its column after a fight (any |off| > SETTLE): out of B1/B2 until |off| ≤ SETTLE or SETTLE_ARC + 2|off| m on
      if (free && !forced && (!t.wasFree || wasForced) && Math.abs(off) > SETTLE) { t.settle = sT; t.settleArc = SETTLE_ARC + 2 * Math.abs(off); }
      if (!free || forced || Math.abs(off) <= SETTLE || sT - t.settle > t.settleArc) t.settle = NaN;
      if (!free && t.rj && !t.rj.done) t.rj = null;
      if (t.rj && free) {
        if (!t.rj.done && Math.abs(off) <= 0.5) {
          t.rj.done = true; const arc = sT - t.rj.s0; acc.rejoin.push(arc);
          if (arc >= Math.max(...acc.rejoin)) acc.rejoinWorst =`${map}/${scen}/s${seed} ${g.id} t${e.team} #${e.id} off ${t.rj.off0.toFixed(2)} → ≤0.5 in ${arc.toFixed(1)} m @${w.time.toFixed(1)}s`;
          (t.rj as { s1?: number }).s1 = sT;
        } else if (t.rj.done) {
          const s1 = (t.rj as { s1?: number }).s1 ?? sT;
          if (sT - s1 > 10) t.rj = null;
          else if (Math.sign(off) !== Math.sign(t.rj.off0) && Math.abs(off) > 0.5) { acc.rejoinOvershoot++; t.rj = null; }
        }
      }
      t.wasFree = free;
      t.freeRun = free ? t.freeRun + 1 : 0;
      // B3 reversal: free+clear for a whole 0.5 s window
      if (clear) { t.hist.push(sT); if (t.hist.length > WIN + 1) t.hist.shift(); } else t.hist.length = 0;
      if (t.hist.length === WIN + 1 && t.hist[WIN] - t.hist[0] < -0.3) {
        const id = `${map}/${scen}/${seed}#${e.id}`;
        if (!acc.revIds.has(id)) { acc.revIds.add(id); acc.rev.push({ key: id, at: `${g.id} t${e.team} s${sT.toFixed(1)} ${w.time.toFixed(1)}s net ${(t.hist[WIN] - t.hist[0]).toFixed(2)} m` }); }
      }
      if (!clear) continue;
      acc.samples++;
      const bk = `${map}|${scen}|${g.id}|t${e.team}|s${Math.floor(sT / BIN) * BIN}`;
      const inRejoin = !Number.isNaN(t.settle);
      if (!inRejoin) {
        let b = acc.single.get(bk); if (!b) acc.single.set(bk, b = []); b.push(Math.abs(off));
        if (VERBOSE && Math.abs(off) > 0.6) { const k2 = `${bk}|${seed}#${e.id}`; const o = acc.singleWho.get(k2); if (!o || o.n < 1e9) acc.singleWho.set(k2, { n: (o?.n ?? 0) + 1, off: Math.max(o?.off ?? 0, Math.abs(off)), t: o?.t ?? w.time }); }
      }
      if (inRejoin) continue;
      let c = acc.centroid.get(bk); if (!c) acc.centroid.set(bk, c = new Map());
      // a wave is what passes the bin together (Wicks of one road and side, no 2 s gap): waves that merged after a
      // fight walk as one blob and are judged as one
      const gk = `${bk}|${seed}`; let gr = acc.grp.get(gk); if (!gr) acc.grp.set(gk, gr = { last: -Infinity, idx: 0 });
      if (w.time - gr.last > 2) gr.idx++;
      gr.last = w.time;
      const wk = `${seed}/${gr.idx}`; let cw = c.get(wk); if (!cw) c.set(wk, cw = { off: 0, d: 0, n: 0, ids: new Map() });
      cw.off += off; cw.d += dT; cw.n++;
      { let r = cw.ids.get(e.id); if (!r) cw.ids.set(e.id, r = { n: 0, off: 0, fr: Infinity, t: w.time }); r.n++; r.off += off; r.fr = Math.min(r.fr, t.freeRun); }
    }
    if (!hashOnly && tick % 300 === 0) for (const id of tr.keys()) { const e = w.entity(id); if (!e || !e.alive) tr.delete(id); }
  }
  for (const [k, v] of firstT) { let a = acc.timing.get(k); if (!a) acc.timing.set(k, a = []); a.push(v); }
  return (hash >>> 0).toString(16);
}

let fail = 0;
const out: string[] = [];
const bad = (s: string): void => { fail++; out.push(`  FAIL ${s}`); };
const t0 = Date.now();
const timing = new Map<string, number[]>();
for (const map of MAPS) for (const scen of SCENS) {
  const acc = newAcc();
  for (const seed of SEEDS) runOne(map, scen, seed, acc, scen === 'idle' ? IDLE_MIN : BOTS_MIN);
  for (const [k, v] of acc.timing) timing.set(k, v);
  // B1 + B2 per bin
  let worstCMed = 0, worstCMax = 0, worstRaw = 0, worstP95 = 0, worstMax = 0, kC = '', kS = '', kM = '', kR = '';
  let bins = 0;
  for (const [bk, c] of acc.centroid) {
    const cs = [...c.values()].filter((v) => v.n >= 15 && v.ids.size >= 2);
    if (cs.length === 0) continue;
    bins++;
    const offs = cs.map((v) => Math.abs(v.off / v.n)), raws = cs.map((v) => Math.abs(v.d / v.n));
    const med = pct(offs, 0.5), mx = Math.max(...offs), rmx = Math.max(...raws);
    if (med > worstCMed) worstCMed = med;
    if (mx > worstCMax) { worstCMax = mx; kC = bk; }
    if (rmx > worstRaw) { worstRaw = rmx; kR = bk; }
    if (med > 0.20) bad(`B1 ${bk}: wave-centroid median |off| ${med.toFixed(2)} > 0.20 (${cs.length} waves)`);
    if (mx > 0.30) bad(`B1 ${bk}: wave-centroid max |off| ${mx.toFixed(2)} > 0.30 (${cs.length} waves)`);
    if (VERBOSE) out.push(`    ${bk.padEnd(34)} centroid med ${med.toFixed(2)} max ${mx.toFixed(2)} raw max ${rmx.toFixed(2)} (${cs.length} waves)`);
    if (VERBOSE && mx > 0.3) {
      const [wk2, v] = [...c].filter(([, v]) => v.n >= 15 && v.ids.size >= 2).sort((a, b) => Math.abs(b[1].off / b[1].n) - Math.abs(a[1].off / a[1].n))[0];
      out.push(`      worst wave ${wk2}: ${[...v.ids].map(([id, r]) => `#${id} n${r.n} off ${(r.off / r.n).toFixed(2)} freeFor ${(r.fr / 30).toFixed(1)}s @${r.t.toFixed(1)}`).join(' | ')}`);
    }
  }
  for (const [bk, b] of acc.single) {
    if (b.length < 30) continue;
    const p95 = pct(b, 0.95), mx = Math.max(...b);
    if (p95 > worstP95) { worstP95 = p95; kS = bk; }
    if (mx > worstMax) { worstMax = mx; kM = bk; }
    if (p95 > 0.6) bad(`B2 ${bk}: single-Wick |off| p95 ${p95.toFixed(2)} > 0.6 (n ${b.length})`);
    if (VERBOSE && (p95 > 0.6 || mx > 1.2)) out.push(`      over 0.6: ${[...acc.singleWho].filter(([k]) => k.startsWith(`${bk}|`)).sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([k, v]) => `${k.slice(bk.length + 1)} n${v.n} max ${v.off.toFixed(2)} @${v.t.toFixed(1)}`).join(' | ')}`);
    if (mx > 1.2) bad(`B2 ${bk}: single-Wick |off| max ${mx.toFixed(2)} > 1.2 (n ${b.length})`);
  }
  out.push(`${map} ${scen}: ${acc.samples} free+clear samples, ${bins} bins; B1 centroid worst median ${worstCMed.toFixed(2)}, max ${worstCMax.toFixed(2)} (${kC}); raw mean-d max ${worstRaw.toFixed(2)} (${kR})`);
  out.push(`  B2 single Wick |off| worst p95 ${worstP95.toFixed(2)} (${kS}), max ${worstMax.toFixed(2)} (${kM})`);
  out.push(`  B7 lantern detours in the first 20 m: ${acc.detour.size} Wicks${VERBOSE ? ` ${[...acc.detourAt].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}: ${v}`).join('; ')}` : ''}`);
  out.push(`  B3 reversals ${acc.rev.length}${acc.rev.length ? `: ${acc.rev.slice(0, 5).map((r) => `${r.key} ${r.at}`).join('; ')}` : ''}`);
  if (acc.rev.length > 0) bad(`B3 ${map} ${scen}: ${acc.rev.length} marching Wicks reversed`);
  const rj = acc.rejoin;
  if (pct(rj, 0.95) > 6) bad(`B4 ${map} ${scen}: rejoin arc p95 ${pct(rj, 0.95).toFixed(1)} m > 6`);
  out.push(`  B4 rejoins ${rj.length}: arc to |off| ≤ 0.5 p50 ${pct(rj, 0.5).toFixed(1)} p95 ${pct(rj, 0.95).toFixed(1)} max ${rj.length ? Math.max(...rj).toFixed(1) : '-'} m; overshoot ${acc.rejoinOvershoot}${rj.length ? `; worst ${acc.rejoinWorst}` : ''}`);
}
// B5 timing
const rec: Record<string, number> = {};
for (const [k, v] of [...timing].sort()) rec[k] = Math.round(v.reduce((a, b) => a + b, 0) / v.length * 100) / 100;
if (RECORD) { console.log(`BASE ${JSON.stringify(rec)}`); if (VERBOSE) for (const [k, v] of [...timing].sort()) console.log(`  ${k} ${v.map((x) => x.toFixed(2)).join(' ')}`); }
else if (SCENS.includes('idle') && SEEDS.join() === '3,7,11,19,23,31') {
  let n = 0, worst = 0, wk = '';
  for (const [k, b] of Object.entries(BASE)) {
    if (!MAPS.includes(k.split('|')[0])) continue;
    const v = rec[k];
    if (v === undefined) { bad(`B5 ${k}: no arrival (base ${b} s)`); continue; }
    const dlt = v - b;
    if (k.endsWith('_any')) { if (Math.abs(dlt) > 0.5) out.push(`  B5 (reported) ${k}: ${v.toFixed(2)} s vs base ${b.toFixed(2)} (${dlt >= 0 ? '+' : ''}${dlt.toFixed(2)})`); continue; }
    n++;
    if (Math.abs(dlt) > Math.abs(worst)) { worst = dlt; wk = k; }
    if (Math.abs(dlt) > 0.5) bad(`B5 ${k}: ${v.toFixed(2)} s vs base ${b.toFixed(2)} (${dlt >= 0 ? '+' : ''}${dlt.toFixed(2)})${VERBOSE ? ` per seed ${timing.get(k)!.map((x) => x.toFixed(2)).join(' ')}` : ''}`);
  }
  out.push(`B5 timing: ${n} arrivals and first contacts (6-seed means) vs before ruling 46, worst ${worst >= 0 ? '+' : ''}${worst.toFixed(2)} s (${wk})`);
} else out.push('B5 timing: skipped (needs the idle scenario on the default seeds)');
// B6 determinism
if (MAPS.includes('rift')) {
  const h1 = runOne('rift', 'idle', 7, newAcc(), 3, true), h2 = runOne('rift', 'idle', 7, newAcc(), 3, true);
  out.push(`B6 determinism: rift idle seed 7 3 min hash ${h1} / ${h2}`);
  if (h1 !== h2) bad('B6 trace hashes differ');
}
console.log(out.join('\n'));
console.log(`${fail === 0 ? 'PASS' : `FAIL (${fail})`} probe_sim_minion_lane_line ${((Date.now() - t0) / 1000).toFixed(0)} s`);
process.exit(fail === 0 ? 0 : 1);
