// DIAGNOSTIC (no src edits): where and why do Wicks (minions), summons and monsters stall on their way?
//
//   node _harness/_tmp_diag_minion_stuck.ts [--seeds 6] [--seed0 1] [--minutes 25] [--maps rift,bridge] [--scen idle,bots]
//        [--kill auto|none] [--out _harness/_reports/diag_minion_stuck]
//
// For every seed x map x scenario a full match is stepped headless (30 Hz, deterministic). Scenarios:
//   idle  every fighter stands at its spawn (no controller): pure minion physics, towers fall on a seed-driven
//         schedule (kill=auto: the mid outer tower of one team at 4-9 min, the other team's later, the inner too)
//   bots  the normal seats play (fighters in lane, kills, pushes)
// Every ~0.27 s each minion's arc-length progress along its lane route is sampled; a 3.2 s window with < 0.5 m of
// forward progress while it is not fighting (order not ATTACK, no swing, not holding the lane end) is a STALL
// (an episode is logged once, at onset); a window with > 2.5 m walked and < 0.5 m net progress, or with >= 3
// heading reversals, is an OSCILLATION. Monsters and summons: no 0.5 m gain on the distance to their order point
// in 3.2 s while > 2 m from it.
// Each episode records what the body touches: structure obstacle discs (alive or fallen), blocked nav cells,
// bodies within touching range, the waypoint it aims at, the nav path it holds, its watchdog counters. A root
// cause label is derived from that.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CatalogT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup } from '../src/contracts/sim.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import { createSim, worldOf } from '../src/sim/sim.ts';
import { killEntity } from '../src/sim/combat.ts';
import { attackable } from '../src/sim/attack.ts';
import { ORDER_ATTACK, ORDER_ATTACK_MOVE, ORDER_MOVE, type Entity } from '../src/sim/entity.ts';
import type { World } from '../src/sim/world.ts';
import { structuresOf, type StructEntry } from '../src/sim/units/structures.ts';
import { minionState } from '../src/sim/units/minions.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const SEEDS = Number(opt('seeds', '6'));
const SEED0 = Number(opt('seed0', '1'));
const MINUTES = Number(opt('minutes', '25'));
const MAPS = opt('maps', 'rift,bridge').split(',');
const SCENS = opt('scen', 'idle,bots').split(',');
const KILL = opt('kill', 'auto');
const OUT = opt('out', join(HERE, '_reports', 'diag_minion_stuck'));

const SAMPLE_TICKS = 8;
const WIN = 12;
const STALL_GAIN = 0.5;
const HEAT_CELL = 3;
const SEC = (s: StructEntry): string => s.def.id;
const LANE = (s: StructEntry): string => s.def.lane ?? '';
const TIER = (s: StructEntry): string => /outer/.test(s.def.unit) ? 'outer' : /inner/.test(s.def.unit) ? 'inner' : /lantern/.test(s.def.unit) ? 'lantern' : 'other';

function loadCatalog(): CatalogT {
  const r = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
  if (!r.catalog) { console.error('content build failed'); process.exit(77); }
  return r.catalog;
}

function lineup(catalog: CatalogT, modeId: string, seed: number): MatchSetup {
  const mode = catalog.modes.find((m) => m.id === modeId)!;
  const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id)!;
  const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0)).map((r) => r.id);
  const natives = new Map<string, string[]>();
  for (const f of catalog.fighters) { const l = natives.get(f.role) ?? []; l.push(f.id); natives.set(f.role, l); }
  for (const l of natives.values()) l.sort();
  const all = catalog.fighters.map((f) => f.id).sort();
  const n = mode.teams * mode.perTeam;
  const pool = mode.rules.itemPool ?? '';
  const seats: SeatSetup[] = [];
  for (let i = 0; i < n; i++) {
    const team = Math.floor(i / mode.perTeam), slot = i % mode.perTeam;
    const role = mode.roles ? roles[slot % roles.length] : undefined;
    const pl = (role && natives.get(role)) || all;
    const fighter = pl[(seed + slot + team) % pl.length];
    const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? catalog.skins.find((s) => s.fighter === fighter)?.id ?? '';
    seats.push({
      player: i, team, name: catalog.botNames[i % catalog.botNames.length], fighter, skin, role,
      loadout: pickLoadout(catalog, fighter, pool, role),
      controller: 'bot', botDifficulty: 'adept', colorIndex: i,
    } as SeatSetup);
  }
  return { matchId: `diag-${modeId}-${seed}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}

interface Ep {
  kind: string; def: string; team: number; id: number; lane: number; map: string; scen: string; seed: number;
  t: number; x: number; y: number; gain: number; walked: number; flips: number; type: 'stall' | 'osc' | 'chase';
  dur: number;
  struct: string; structGap: number; wallGap: number; deadStructNear: string;
  bodies: { n: number; ally: number; enemy: number; fighting: number; fighters: number; stalled: number };
  wp: number; wpDist: number; wpInObstacle: string; wpBlocked: boolean; wpSpacing: number; lateral: number; s: number; laneLen: number;
  order: number; pathLeft: number; noProgress: number; arriveStall: number; lane38: number;
  enemyD: number; enemyKind: string;
  cause: string;
}
interface Track { hist: { x: number; y: number; s: number }[]; ep: Ep | null; epStart: number }

interface LaneG { pts: [number, number][]; cum: number[]; len: number; index: number; id: string }
function laneGeom(w: World): LaneG[] {
  return w.mapDef.lanes.map((l, index) => {
    const pts = l.path.map((p) => [p[0], p[1]] as [number, number]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, cum, len: cum[cum.length - 1], index, id: l.id };
  });
}
function project(g: LaneG, x: number, y: number): { s: number; d: number } {
  let bs = 0, bd = Infinity;
  for (let i = 1; i < g.pts.length; i++) {
    const [ax, ay] = g.pts[i - 1], [bx, by] = g.pts[i];
    const abx = bx - ax, aby = by - ay, l2 = abx * abx + aby * aby;
    let t = l2 > 1e-12 ? ((x - ax) * abx + (y - ay) * aby) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (ax + abx * t), y - (ay + aby * t));
    if (d < bd) { bd = d; bs = g.cum[i - 1] + t * Math.sqrt(l2); }
  }
  return { s: bs, d: bd };
}
function structGap(w: World, x: number, y: number, deadToo: boolean): { name: string; gap: number; alive: boolean } {
  let best = { name: '', gap: Infinity, alive: true };
  for (const s of structuresOf(w)) {
    const e = s.ent;
    if (!deadToo && !e.alive) continue;
    const g = Math.hypot(e.x - x, e.y - y) - (e.radius + 0.35);
    if (g < best.gap) best = { name: `${SEC(s)}@${e.x.toFixed(1)},${e.y.toFixed(1)}${e.alive ? '' : '(dead)'}`, gap: g, alive: e.alive };
  }
  return best;
}
function blockedGap(w: World, x: number, y: number, maxR = 3): number {
  const nav = w.nav;
  for (let r = 0; r <= maxR; r += nav.cell * 0.5) {
    const steps = r === 0 ? 1 : Math.max(8, Math.ceil(r * 8));
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      if (!nav.walkable(x + Math.cos(a) * r, y + Math.sin(a) * r)) return r;
    }
  }
  return Infinity;
}
function bodiesAt(w: World, e: Entity, stalled: Set<number>): Ep['bodies'] {
  const b = { n: 0, ally: 0, enemy: 0, fighting: 0, fighters: 0, stalled: 0 };
  for (const o of w.entities) {
    if (o === e || !o.alive || o.static || o.kind === 'structure' || o.kind === 'projectile' || o.kind === 'zone') continue;
    if (Math.hypot(o.x - e.x, o.y - e.y) - (o.radius + e.radius) > 0.35) continue;
    b.n++;
    if (o.team === e.team) b.ally++; else b.enemy++;
    if (o.kind === 'fighter') b.fighters++;
    if (o.order === ORDER_ATTACK || o.atkWindup >= 0 || o.atkTarget >= 0) b.fighting++;
    if (stalled.has(o.id)) b.stalled++;
  }
  return b;
}
function nearestEnemy(w: World, e: Entity): { d: number; kind: string } {
  let d = Infinity, kind = '';
  for (const o of w.entities) {
    if (o.team === e.team || !o.alive || o.kind === 'projectile' || o.kind === 'zone' || o.kind === 'ward' || o.kind === 'pickup') continue;
    if (!attackable(w, e, o)) continue;
    const g = Math.hypot(o.x - e.x, o.y - e.y) - o.radius - e.radius;
    if (g < d) { d = g; kind = o.kind; }
  }
  return { d, kind };
}
function classify(ep: Ep): string {
  // a minion with an enemy inside its aggro range (7 m) is queueing in a fight, not stuck: reported apart
  const eng = ep.enemyD < 7 && ep.kind === 'minion';
  if (ep.type === 'chase') return (ep.structGap < 0.8 ? 'chase-stuck-at-structure' : ep.wallGap < 1.0 ? 'chase-stuck-at-wall' : ep.bodies.n >= 2 ? 'chase-stuck-in-crowd' : 'chase-stuck-open') + ':' + ep.enemyKind;
  if (ep.wpBlocked) return 'waypoint-blocked-cell';
  if (ep.wpInObstacle) return 'waypoint-inside-obstacle:' + ep.wpInObstacle;
  const live = ep.struct && !ep.struct.endsWith('(dead)');
  if (eng && !(ep.structGap < 0.6 && live) && !(ep.wallGap < 0.7)) return 'queue-engaged:' + ep.enemyKind;
  if (ep.structGap < 0.6 && live && ep.bodies.n >= 2) return 'struct-gap-crowd:' + ep.struct.split('@')[0];
  if (ep.structGap < 0.6 && live) return 'struct-collider:' + ep.struct.split('@')[0];
  if (ep.deadStructNear && ep.wallGap < 0.7) return 'dead-structure-remains';
  if (ep.wallGap < 0.7 && ep.bodies.n >= 1) return 'wall-plus-body';
  if (ep.wallGap < 0.7) return 'wall';
  if (ep.bodies.fighting >= 1 && ep.bodies.n >= 2) return 'crowd-behind-fighters';
  if (ep.bodies.stalled >= 1 && ep.bodies.n >= 1) return 'crowd-behind-stalled';
  if (ep.bodies.n >= 3) return 'crowd';
  if (ep.bodies.fighters >= 1) return 'fighter-body';
  if (ep.bodies.n >= 1) return 'pair-block';
  if (ep.type === 'osc') return 'oscillation-open-ground';
  if (ep.lateral > 4) return 'off-lane-recover';
  return 'open-ground-unknown';
}

interface RunStat { map: string; scen: string; seed: number; end: number; eps: Ep[]; cross: { band: string; team: number; alive: boolean; sec: number }[]; kills: string[] }

function runOne(catalog: CatalogT, modeId: string, scen: string, seed: number): RunStat {
  const setup = lineup(catalog, modeId, seed);
  const factory = scen === 'bots' ? createBots(catalog, setup) : null;
  const sim = createSim(catalog, setup, { bots: factory ?? (() => null), pregameSeconds: 0 });
  const lanes = laneGeom(worldOf(sim));
  const tracks = new Map<number, Track>();
  const stalledNow = new Set<number>();
  const eps: Ep[] = [];
  const cross: RunStat['cross'] = [];
  const kills: string[] = [];
  const bandEnter = new Map<string, { t: number; alive: boolean }>();
  const sched: { t: number; match: (s: StructEntry) => boolean; done: boolean }[] = [];
  if (KILL === 'auto') {
    const w0 = worldOf(sim);
    const mid = (w0.mapDef.lanes.find((l) => /seat|mid/.test(l.id)) ?? w0.mapDef.lanes[Math.floor(w0.mapDef.lanes.length / 2)]).id;
    const side = seed % 2, other = 1 - side;
    const t0 = 240 + (seed % 3) * 150;
    sched.push({ t: t0, match: (s) => s.ent.team === side && LANE(s) === mid && TIER(s) === 'outer', done: false });
    sched.push({ t: t0 + 90, match: (s) => s.ent.team === other && LANE(s) === mid && TIER(s) === 'outer', done: false });
    sched.push({ t: t0 + 200, match: (s) => s.ent.team === side && LANE(s) === mid && TIER(s) === 'inner', done: false });
    if (seed % 3 === 0) sched.push({ t: t0 + 30, match: (s) => s.ent.team === side && LANE(s) !== mid && TIER(s) === 'outer', done: false });
    if (seed % 3 === 1) sched.push({ t: t0 + 60, match: (s) => s.ent.team === other && LANE(s) !== mid && TIER(s) === 'outer', done: false });
  }
  const limit = MINUTES * 60 * 30;
  let tick = 0;
  while (sim.view.phase !== 'ended' && tick < limit) {
    sim.step(); tick++;
    const w = worldOf(sim);
    if (w.phase === 'pregame') continue;
    for (const sc of sched) {
      if (sc.done || w.time < sc.t) continue;
      sc.done = true;
      for (const s of structuresOf(w)) if (s.ent.alive && sc.match(s)) { killEntity(w, s.ent, null); kills.push(`${(w.time / 60).toFixed(1)}m ${SEC(s)}`); }
    }
    if (tick % SAMPLE_TICKS !== 0) continue;
    stalledNow.clear();
    const seen = new Set<number>();
    for (const e of w.entities) {
      if (!e.alive || e.static) continue;
      const isMin = e.kind === 'minion';
      if (!isMin && e.kind !== 'monster' && e.kind !== 'summon') continue;
      seen.add(e.id);
      let lane = -1, s = 0, latd = 0;
      const m = isMin ? minionState(e) : undefined;
      if (isMin && m) {
        let bd = Infinity;
        const p0 = m.path[0], pe = m.path[m.path.length - 1];
        for (const g of lanes) {
          const g0 = g.pts[0], ge = g.pts[g.pts.length - 1];
          const mine = (g0[0] === p0[0] && g0[1] === p0[1] && ge[0] === pe[0] && ge[1] === pe[1]) || (g0[0] === pe[0] && g0[1] === pe[1] && ge[0] === p0[0] && ge[1] === p0[1]);
          if (!mine) continue;
          const p = project(g, e.x, e.y);
          if (p.d < bd) { bd = p.d; lane = g.index; s = p.s; latd = p.d; }
        }
        if (lane >= 0 && e.team === 1) s = lanes[lane].len - s;
      }
      const goalD = Math.hypot(e.orderX - e.x, e.orderY - e.y);
      const prog = isMin && lane >= 0 ? s : -goalD;
      let tr = tracks.get(e.id);
      if (!tr) { tr = { hist: [], ep: null, epStart: 0 }; tracks.set(e.id, tr); }
      tr.hist.push({ x: e.x, y: e.y, s: prog });
      if (tr.hist.length > WIN + 1) tr.hist.shift();
      if (isMin && lane >= 0) {
        for (const st of structuresOf(w)) {
          if (st.ent.team === e.team || TIER(st) !== 'outer' || LANE(st) !== lanes[lane].id) continue;
          const key = `${e.id}:${SEC(st)}`;
          const sp = project(lanes[lane], st.ent.x, st.ent.y).s;
          const ss = e.team === 1 ? lanes[lane].len - sp : sp;
          const inBand = Math.abs(ss - s) < 9;
          if (inBand && !bandEnter.has(key)) bandEnter.set(key, { t: w.time, alive: st.ent.alive });
          if (!inBand && bandEnter.has(key) && s > ss) { { const en = bandEnter.get(key)!; cross.push({ band: SEC(st), team: e.team, alive: en.alive, sec: w.time - en.t }); } bandEnter.delete(key); }
        }
      }
      if (tr.hist.length <= WIN) continue;
      const a = tr.hist[0], b = tr.hist[tr.hist.length - 1];
      const gain = b.s - a.s;
      let walked = 0, flips = 0, lastSign = 0;
      for (let i = 1; i < tr.hist.length; i++) {
        walked += Math.hypot(tr.hist[i].x - tr.hist[i - 1].x, tr.hist[i].y - tr.hist[i - 1].y);
        const ds = tr.hist[i].s - tr.hist[i - 1].s;
        const sg = ds > 0.08 ? 1 : ds < -0.08 ? -1 : 0;
        if (sg !== 0) { if (lastSign !== 0 && sg !== lastSign) flips++; lastSign = sg; }
      }
      // atkTarget is never cleared on an attack-move, so "fighting" needs a live target actually in reach
      const tg = e.atkTarget >= 0 ? w.live(e.atkTarget) : null;
      const reach = tg ? Math.hypot(tg.x - e.x, tg.y - e.y) - e.radius - tg.radius - e.stats.range : Infinity;
      const fighting = e.order === ORDER_ATTACK || (m?.chasing ?? false) || e.atkWindup >= 0 || e.atkAnim > 0 || e.cast !== null || (!!tg && tg.alive && reach < 1.5);
      const endHold = isMin && lane >= 0 && s > lanes[lane].len - 3.5;
      const onMove = e.order === ORDER_MOVE || e.order === ORDER_ATTACK_MOVE;
      const idleByDesign = !onMove || (!isMin && goalD < 2) || e.stats.moveSpeed <= 0;
      let kind: 'stall' | 'osc' | 'chase' | null = null;
      // a chase that does not close: ordered to attack something out of reach while it hardly moves
      const otg = e.order === ORDER_ATTACK ? w.live(e.orderTarget) : null;
      const oreach = otg ? Math.hypot(otg.x - e.x, otg.y - e.y) - e.radius - otg.radius - e.stats.range : 0;
      if (otg && oreach > 1.5 && walked < 1.0 && e.ccMask === 0 && e.stats.moveSpeed > 0 && !e.cast && e.atkWindup < 0) kind = 'chase';
      if (!kind && !fighting && !endHold && !idleByDesign && e.ccMask === 0) {
        const cond = isMin ? gain < STALL_GAIN : gain < STALL_GAIN && goalD > 2;
        if (cond && walked < 2.5) kind = 'stall';
        else if (cond) kind = 'osc';
        else if (flips >= 3 && walked > 2.5 && gain < 1.5) kind = 'osc';
      }
      if (kind) stalledNow.add(e.id);
      const nowT = w.time;
      if (kind && !tr.ep) {
        const sgAny = structGap(w, e.x, e.y, true), sgLive = structGap(w, e.x, e.y, false);
        const wpIdx = m ? Math.min(m.wp, m.path.length - 1) : -1;
        const wp: readonly [number, number] = m ? m.path[wpIdx] : [e.orderX, e.orderY];
        const prevW = m && wpIdx > 0 ? m.path[wpIdx - 1] : wp;
        let wpObs = '';
        for (const st of structuresOf(w)) if (st.ent.alive && Math.hypot(st.ent.x - wp[0], st.ent.y - wp[1]) < st.ent.radius + 0.35) wpObs = SEC(st);
        const ep: Ep = {
          kind: e.kind, def: e.def, team: e.team, id: e.id, lane, map: modeId, scen, seed,
          t: nowT - (WIN * SAMPLE_TICKS) / 30, x: e.x, y: e.y, gain, walked, flips, type: kind, dur: 0,
          struct: sgLive.gap < 3 ? sgLive.name : sgAny.gap < 2 ? sgAny.name : '', structGap: Math.min(sgLive.gap, sgAny.gap < 1.2 ? sgAny.gap : Infinity),
          wallGap: blockedGap(w, e.x, e.y), deadStructNear: sgAny.gap < 2.5 && !sgAny.alive ? sgAny.name : '',
          bodies: bodiesAt(w, e, stalledNow),
          wp: wpIdx, wpDist: Math.hypot(wp[0] - e.x, wp[1] - e.y), wpInObstacle: wpObs, wpBlocked: !w.nav.walkable(wp[0], wp[1]),
          wpSpacing: Math.hypot(wp[0] - prevW[0], wp[1] - prevW[1]), lateral: latd, s, laneLen: lane >= 0 ? lanes[lane].len : 0,
          order: e.order, pathLeft: Math.max(0, (e.path.length >> 1) - (e.pathIdx >> 1)), noProgress: e.noProgress, arriveStall: e.arriveStall, lane38: e.lane.length >> 1,
          enemyD: 0, enemyKind: '', cause: '',
        };
        { const ne = nearestEnemy(w, e); ep.enemyD = ne.d; ep.enemyKind = ne.kind; }
        ep.cause = classify(ep);
        tr.ep = ep; tr.epStart = nowT;
        eps.push(ep);
      } else if (!kind && tr.ep) { tr.ep.dur = nowT - tr.epStart; tr.ep = null; }
      else if (kind && tr.ep) tr.ep.dur = nowT - tr.epStart;
    }
    for (const id of [...tracks.keys()]) if (!seen.has(id)) { const tr = tracks.get(id)!; if (tr.ep) tr.ep.dur = w.time - tr.epStart; tracks.delete(id); }
  }
  return { map: modeId, scen, seed, end: worldOf(sim).time, eps, cross, kills };
}

const catalog = loadCatalog();
const runs: RunStat[] = [];
for (const modeId of MAPS) for (const scen of SCENS) for (let k = 0; k < SEEDS; k++) {
  const seed = SEED0 + k;
  const t0 = Date.now();
  const r = runOne(catalog, modeId, scen, seed);
  runs.push(r);
  console.log(`${modeId} ${scen} seed ${seed}: ended ${(r.end / 60).toFixed(1)} min, ${r.eps.length} episodes, kills [${r.kills.join('; ')}] (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

const all = runs.flatMap((r) => r.eps);
interface Heat { map: string; kind: string; cx: number; cy: number; n: number; sec: number; teams: number[]; scen: Record<string, number>; causes: Record<string, number>; lanes: Record<string, number>; worst: Ep; structs: Record<string, number>; seeds: Set<number> }
const heat = new Map<string, Heat>();
const real = all.filter((e) => !e.cause.startsWith('queue-engaged'));
for (const e of real) {
  const key = `${e.map}|${e.kind}|${Math.floor(e.x / HEAT_CELL)}|${Math.floor(e.y / HEAT_CELL)}`;
  let h = heat.get(key);
  if (!h) { h = { map: e.map, kind: e.kind, cx: (Math.floor(e.x / HEAT_CELL) + 0.5) * HEAT_CELL, cy: (Math.floor(e.y / HEAT_CELL) + 0.5) * HEAT_CELL, n: 0, sec: 0, teams: [0, 0], scen: {}, causes: {}, lanes: {}, worst: e, structs: {}, seeds: new Set() }; heat.set(key, h); }
  h.n++; h.sec += e.dur + 3.2; if (e.team >= 0 && e.team < 2) h.teams[e.team]++;
  h.scen[e.scen] = (h.scen[e.scen] ?? 0) + 1;
  h.causes[e.cause] = (h.causes[e.cause] ?? 0) + 1;
  h.lanes[String(e.lane)] = (h.lanes[String(e.lane)] ?? 0) + 1;
  if (e.struct) { const k = e.struct.replace(/\(dead\)/, ''); h.structs[k] = (h.structs[k] ?? 0) + 1; }
  h.seeds.add(e.seed);
  if (e.dur > h.worst.dur) h.worst = e;
}
const cells = [...heat.values()];
const spots: { cells: Heat[]; n: number; sec: number }[] = [];
const used = new Set<Heat>();
for (const c of cells.sort((a, b) => b.n - a.n)) {
  if (used.has(c)) continue;
  const grp = [c]; used.add(c);
  for (let i = 0; i < grp.length; i++) for (const o of cells) if (!used.has(o) && o.map === c.map && o.kind === c.kind && Math.abs(o.cx - grp[i].cx) <= HEAT_CELL + 0.01 && Math.abs(o.cy - grp[i].cy) <= HEAT_CELL + 0.01) { used.add(o); grp.push(o); }
  spots.push({ cells: grp, n: grp.reduce((a, g) => a + g.n, 0), sec: grp.reduce((a, g) => a + g.sec, 0) });
}
spots.sort((a, b) => b.sec - a.sec);

const lines: string[] = [];
lines.push(`# minion stall diagnosis: ${runs.length} runs, ${SEEDS} seeds from ${SEED0}, ${MINUTES} min cap; ${all.length} episodes`);
for (const r of runs) lines.push(`run ${r.map} ${r.scen} seed ${r.seed}: ${(r.end / 60).toFixed(1)} min, ${r.eps.length} episodes; scheduled kills: ${r.kills.join('; ') || '-'}`);
lines.push('');
const bykind: Record<string, number> = {};
for (const e of all) bykind[`${e.map}/${e.kind}/${e.type}`] = (bykind[`${e.map}/${e.kind}/${e.type}`] ?? 0) + 1;
lines.push('episodes by map/kind/type: ' + JSON.stringify(bykind));
const bycause: Record<string, { n: number; sec: number }> = {};
for (const e of all) { const c = bycause[`${e.map}/${e.kind}/${e.cause}`] ??= { n: 0, sec: 0 }; c.n++; c.sec += e.dur + 3.2; }
lines.push('');
lines.push('## root causes (map/kind/cause: episodes, stalled seconds)');
for (const [k, v] of Object.entries(bycause).sort((a, b) => b[1].sec - a[1].sec)) lines.push(`${k}: ${v.n} episodes, ${v.sec.toFixed(0)} s`);
lines.push('');
lines.push(`## heat list (spots, worst first; ${real.length} episodes of ${all.length} with no enemy in aggro range or touching a collider; queue-engaged episodes are a fight line waiting its turn and are left out)`);
for (const sp of spots.slice(0, 40)) {
  const c = sp.cells[0];
  const xs = sp.cells.map((g) => g.cx), ys = sp.cells.map((g) => g.cy);
  const cause: Record<string, number> = {}, scen: Record<string, number> = {}, lns: Record<string, number> = {}, st: Record<string, number> = {};
  let t0 = 0, t1 = 0; const seeds = new Set<number>();
  for (const g of sp.cells) { t0 += g.teams[0]; t1 += g.teams[1]; for (const [k, v] of Object.entries(g.causes)) cause[k] = (cause[k] ?? 0) + v; for (const [k, v] of Object.entries(g.scen)) scen[k] = (scen[k] ?? 0) + v; for (const [k, v] of Object.entries(g.lanes)) lns[k] = (lns[k] ?? 0) + v; for (const [k, v] of Object.entries(g.structs)) st[k] = (st[k] ?? 0) + v; for (const s of g.seeds) seeds.add(s); }
  const worst = sp.cells.map((g) => g.worst).sort((a, b) => b.dur - a.dur)[0];
  lines.push(`- ${c.map} ${c.kind} @ x ${Math.min(...xs) - 1.5}..${Math.max(...xs) + 1.5}, y ${Math.min(...ys) - 1.5}..${Math.max(...ys) + 1.5}: ${sp.n} episodes, ${sp.sec.toFixed(0)} s stalled, seeds ${seeds.size}, teams t0 ${t0} / t1 ${t1}, scen ${JSON.stringify(scen)}, lane idx ${JSON.stringify(lns)}`);
  lines.push(`    causes ${JSON.stringify(cause)}  nearest structs ${JSON.stringify(st)}`);
  lines.push(`    worst: ${worst.def} team ${worst.team} #${worst.id} seed ${worst.seed} ${worst.scen} at t=${(worst.t / 60).toFixed(2)} min pos (${worst.x.toFixed(2)}, ${worst.y.toFixed(2)}) dur ${worst.dur.toFixed(1)} s ${worst.type} gain ${worst.gain.toFixed(2)} walked ${worst.walked.toFixed(1)} flips ${worst.flips}; structGap ${worst.structGap.toFixed(2)} (${worst.struct || '-'}) wallGap ${worst.wallGap.toFixed(2)} bodies ${JSON.stringify(worst.bodies)}; wp ${worst.wp} dist ${worst.wpDist.toFixed(1)} spacing ${worst.wpSpacing.toFixed(1)} inObstacle '${worst.wpInObstacle}' blockedCell ${worst.wpBlocked}; lateral ${worst.lateral.toFixed(1)} order ${worst.order} pathLeft ${worst.pathLeft} noProg ${worst.noProgress} arrStall ${worst.arriveStall} lane38 ${worst.lane38}`);
}
lines.push('');
lines.push('## transit time through +-9 m of lane round each outer tower (enemy minions), seconds');
const cb: Record<string, number[]> = {};
for (const r of runs) for (const c of r.cross) (cb[`${r.map} ${c.band} ${c.alive ? 'alive' : 'fallen'}`] ??= []).push(c.sec);
const pct = (a: number[], p: number): number => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
for (const [k, v] of Object.entries(cb).sort()) lines.push(`${k}: n ${v.length} p50 ${pct(v, 0.5).toFixed(1)} p95 ${pct(v, 0.95).toFixed(1)} max ${Math.max(...v).toFixed(1)}`);

function segD2(a: [number, number], b: [number, number], x: number, y: number): number {
  const abx = b[0] - a[0], aby = b[1] - a[1], l2 = abx * abx + aby * aby;
  let t = l2 > 1e-12 ? ((x - a[0]) * abx + (y - a[1]) * aby) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return (x - a[0] - abx * t) ** 2 + (y - a[1] - aby * t) ** 2;
}
lines.push('');
lines.push('## static audit (lane waypoints, tower discs)');
for (const modeId of MAPS) {
  const sim = createSim(catalog, lineup(catalog, modeId, 1), { pregameSeconds: 0 });
  const w = worldOf(sim);
  const lg = laneGeom(w);
  for (const g of lg) {
    for (let i = 0; i < g.pts.length; i++) {
      const [x, y] = g.pts[i];
      const sg = structGap(w, x, y, false);
      const blocked = !w.nav.walkable(x, y);
      if (sg.gap < 1.0 || blocked) lines.push(`${modeId} ${g.id} wp${i} (${x},${y}): ${blocked ? 'BLOCKED cell; ' : ''}struct gap ${sg.gap.toFixed(2)} (${sg.name})`);
    }
    for (let i = 1; i < g.pts.length; i++) if (!w.nav.lineOfWalk(g.pts[i - 1][0], g.pts[i - 1][1], g.pts[i][0], g.pts[i][1], 0.45)) lines.push(`${modeId} ${g.id} segment ${i - 1}->${i} not walkable for r=0.45 (route detours)`);
  }
  for (const s of structuresOf(w)) {
    const e = s.ent, r = e.radius + 0.35;
    let best = { g: lg[0], d: Infinity, i: 1 };
    for (const g of lg) for (let i = 1; i < g.pts.length; i++) { const d = Math.sqrt(segD2(g.pts[i - 1], g.pts[i], e.x, e.y)); if (d < best.d) best = { g, d, i }; }
    const [ax, ay] = best.g.pts[best.i - 1], [bx, by] = best.g.pts[best.i];
    const L = Math.hypot(bx - ax, by - ay) || 1, tx = (bx - ax) / L, ty = (by - ay) / L, nx = -ty, ny = tx;
    // free width of the road across the lane normal at the lane point nearest the tower, and 3 / 6 m either side along it
    const pr = project(best.g, e.x, e.y);
    const at = (s0: number): { x: number; y: number } => { let k = 1; while (k < best.g.pts.length - 1 && best.g.cum[k] < s0) k++; const f = (s0 - best.g.cum[k - 1]) / ((best.g.cum[k] - best.g.cum[k - 1]) || 1); return { x: best.g.pts[k - 1][0] + (best.g.pts[k][0] - best.g.pts[k - 1][0]) * f, y: best.g.pts[k - 1][1] + (best.g.pts[k][1] - best.g.pts[k - 1][1]) * f }; };
    const width = (px: number, py: number): number => { let a = 0, b = 0; while (a < 20 && w.nav.walkable(px + nx * a, py + ny * a)) a += 0.1; while (b < 20 && w.nav.walkable(px - nx * b, py - ny * b)) b += 0.1; return a + b; };
    const ws = [-6, -3, 0, 3, 6].map((d) => { const q = at(Math.max(0, Math.min(best.g.len, pr.s + d))); return width(q.x, q.y); });
    // which side of the lane the tower stands on, and how far its rim leaves a walkable strip
    const sideSign = (e.x - ax) * nx + (e.y - ay) * ny >= 0 ? 1 : -1;
    const wallBehind = (() => { for (let t = r + 0.05; t < 10; t += 0.1) if (w.nav.walkable(e.x + sideSign * nx * t, e.y + sideSign * ny * t)) { let u = t; while (u < 10 && w.nav.walkable(e.x + sideSign * nx * u, e.y + sideSign * ny * u)) u += 0.1; return +(u - t).toFixed(1); } return 0; })();
    lines.push(`${modeId} ${SEC(s)} (${e.def} team ${e.team}) at (${e.x}, ${e.y}) disc r ${r.toFixed(2)}: ${best.d.toFixed(2)} m off lane ${best.g.id}; road width across the lane at -6/-3/0/+3/+6 m: ${ws.map((v) => v.toFixed(1)).join(' / ')} m; strip behind the tower ${wallBehind} m`);
  }
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT + '.txt', lines.join('\n') + '\n');
writeFileSync(OUT + '.json', JSON.stringify({ runs: runs.map((r) => ({ map: r.map, scen: r.scen, seed: r.seed, end: r.end, kills: r.kills })), episodes: all, spots: spots.slice(0, 60).map((s) => ({ n: s.n, sec: s.sec, cells: s.cells.map((c) => ({ map: c.map, kind: c.kind, cx: c.cx, cy: c.cy, n: c.n, causes: c.causes })) })) }));
console.log(lines.join('\n'));
