// probe (lane SIM, movement): Wicks never get stuck on their road (owner 2026-11-15: "there are spots where the npcs
// minions get stuck in the midline when getting through i believe first tower"; ruling 39).
//
//   node _harness/probe_sim_minion_flow.ts [--seeds 6] [--seed0 1] [--minutes 25] [--maps rift,bridge] [--scen player,idle]
//        [--out _harness/_reports/minion_flow.json]
//
// For every map x seed x scenario a whole match is stepped headless (30 Hz) to its end or the minute cap:
//   player  the other nine seats are played as usual; seat 0 is a scripted PLAYER on the mid road (the owner's case):
//           it walks to its own first mid tower and loiters in the tower's neck while the waves pass: it stands in
//           the gap for a few seconds, holds the right button across the tower (a move re-sent every 500 ms, ruling
//           38) and back, stands beside it, shoots in place at the wave (Shift + left-click, ruling 39), recalls to
//           base when low and walks back
//   idle    every fighter stands at its spawn: pure Wick physics; the mid outer towers fall on a seed schedule (the
//           first-tower ruins), and on RIFT one outer tower of another road
// Every 10 ticks each Wick's arc-length progress along its own road is sampled. A Wick is STUCK when for 6 s it gains
// under 0.5 m along its road while it is free to walk: no attack order, no swing or windup, no hard CC or root, no
// attackable enemy within its aggro range + 1.5 m (a Wick queuing behind a fight or waiting for its turn at a tower is
// fighting, not stuck), and more than 8 m from its road's end (holding the end is its job); a Wick that came 1 m nearer
// its road in the window is walking back to it after a chase (ruling 42), not stuck. Gate: 0 stuck Wicks on
// every road of both maps (all six seeds, both scenarios).
// A Wick is IDLE (what a viewer reads as stuck, fighting or not) when for 6 s it neither swings nor gains 0.5 m along its
// road nor covers 1 m of ground, away from its road's end and not held by CC: a melee Wick waiting behind the front row
// for a target it never reaches (ruling 39 steps it out to an open attack spot). Gate: 0 idle Wicks as well. A Wick at
// the back of its own wave's blob (an enemy within aggro, 3+ allied Wicks pressed on it) creeps with the crowd: counted
// as queued, not idle, unless it holds an attack order: a Wick FROZEN in an attack order (6 s with no swing and under
// 0.75 m of ground, the orch1 r2 verifier's bar: the back of a blob sieging a base lantern at 0.2 m/s) is counted on its
// own, gate 0 (the creep watch in units/minions.ts steps it out to an open attack spot or another enemy).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CatalogT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup } from '../src/contracts/sim.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import { createSim, worldOf } from '../src/sim/sim.ts';
import { killEntity } from '../src/sim/combat.ts';
import { attackable } from '../src/sim/attack.ts';
import { CC_HARD, CC_ROOT, ORDER_ATTACK, type Entity } from '../src/sim/entity.ts';
import type { World } from '../src/sim/world.ts';
import { structuresOf, type StructEntry } from '../src/sim/units/structures.ts';
import { flankSpot, minionState } from '../src/sim/units/minions.ts';
import { behaviorOf } from '../src/sim/units/common.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const SEEDS = Number(opt('seeds', '6'));
const SEED0 = Number(opt('seed0', '1'));
const MINUTES = Number(opt('minutes', '25'));
const MAPS = opt('maps', 'rift,bridge').split(',');
const SCENS = opt('scen', 'player,idle').split(',');
const OUT = opt('out', join(HERE, '_reports', 'minion_flow.json'));
const SAMPLE = 10;
/** a Wick that came this much (m) nearer its road over the window is walking back to it, not stuck */
const RETURN_GAIN = 1;
/** --trace map,scen,seed,id,from,to: print one Wick's state every 0.5 s (diagnosis) */
const TRACE = ((t) => t ? { map: t[0], scen: t[1], seed: Number(t[2]), id: Number(t[3]), from: Number(t[4]), to: Number(t[5]) } : null)(opt('trace', '') ? opt('trace', '').split(',') : null);
const STUCK_TICKS = 180;
const STUCK_GAIN = 0.5;
const END_NEAR = 8;
const FREE_PAD = 1.5;
const f1 = (n: number): string => n.toFixed(1);

const built = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
if (!built.catalog) { console.log('SKIP content build failed'); process.exit(77); }
const catalog: CatalogT = built.catalog;

function lineup(modeId: string, seed: number, human0: boolean): MatchSetup {
  const mode = catalog.modes.find((m) => m.id === modeId)!;
  const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id)!;
  const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0)).map((r) => r.id);
  const natives = new Map<string, string[]>();
  for (const f of catalog.fighters) { const l = natives.get(f.role) ?? []; l.push(f.id); natives.set(f.role, l); }
  for (const l of natives.values()) l.sort();
  const all = catalog.fighters.map((f) => f.id).sort();
  const pool = mode.rules.itemPool ?? '';
  const seats: SeatSetup[] = [];
  for (let i = 0; i < mode.teams * mode.perTeam; i++) {
    const team = Math.floor(i / mode.perTeam), slot = i % mode.perTeam;
    const role = mode.roles ? roles[slot % roles.length] : undefined;
    const pl = (role && natives.get(role)) || all;
    const fighter = pl[(seed + slot + team) % pl.length];
    const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? catalog.skins.find((s) => s.fighter === fighter)?.id ?? '';
    seats.push({
      player: i, team, name: `p${i}`, fighter, skin, role, loadout: pickLoadout(catalog, fighter, pool, role),
      controller: i === 0 && human0 ? 'human' : 'bot', botDifficulty: 'adept', colorIndex: i,
    } as SeatSetup);
  }
  return { matchId: `flow-${modeId}-${seed}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}

interface LaneG { pts: [number, number][]; cum: number[]; len: number }
function geom(path: readonly (readonly [number, number])[]): LaneG {
  const pts = path.map((p) => [p[0], p[1]] as [number, number]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, len: cum[cum.length - 1] };
}
/** distance (m) from (x, y) to the road (projectOff) */
let projectOff = 0;
function project(g: LaneG, x: number, y: number): number {
  let bs = 0, bd = Infinity;
  for (let i = 1; i < g.pts.length; i++) {
    const [ax, ay] = g.pts[i - 1], [bx, by] = g.pts[i];
    const abx = bx - ax, aby = by - ay, l2 = abx * abx + aby * aby;
    let t = l2 > 1e-12 ? ((x - ax) * abx + (y - ay) * aby) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (ax + abx * t), y - (ay + aby * t));
    if (d < bd) { bd = d; bs = g.cum[i - 1] + t * Math.sqrt(l2); }
  }
  projectOff = bd;
  return bs;
}
const near: Entity[] = [];
/** free to walk: nothing to fight within reach of its aggro, not attacking, not held */
function free(w: World, e: Entity): boolean {
  if (e.order === ORDER_ATTACK || e.atkWindup >= 0 || e.atkAnim > 0 || e.cast || e.dash) return false;
  if ((e.ccMask & (CC_HARD | CC_ROOT)) !== 0) return false;
  const r = (e.unit ? behaviorOf(e.unit).aggroRange : 7) + FREE_PAD;
  const n = w.query(e.x, e.y, r, near);
  for (let i = 0; i < n; i++) { const o = near[i]; if (o !== e && attackable(w, e, o)) return false; }
  return true;
}

/** queued in its own wave's crowd: an enemy within aggro and >= QUEUE_TOUCH allied Wicks pressed against it (the back of a
 *  blob pushing into a base: it creeps with the crowd; not a stuck Wick) */
const QUEUE_TOUCH = 3;
function queued(w: World, e: Entity): boolean {
  if (free(w, e)) return false;
  const n = w.query(e.x, e.y, e.radius + 1.2, near);
  let k = 0;
  for (let i = 0; i < n; i++) { const o = near[i]; if (o !== e && o.alive && o.kind === 'minion' && o.team === e.team && Math.hypot(o.x - e.x, o.y - e.y) < e.radius + o.radius + 0.3) k++; }
  return k >= QUEUE_TOUCH;
}
let queuedN = 0;
let boxedN = 0;
/** an attack-order Wick queued with no way out: pressed on by 3+ allied Wicks and no open attack spot round its target */
function boxed(w: World, e: Entity): boolean {
  const t = w.live(e.orderTarget);
  return !!t && queued(w, e) && !flankSpot(w, e, t);
}
const IDLE_GROUND = 0.75;
const frozenAll: Stuck[] = [];

interface Stuck { map: string; scen: string; seed: number; t: string; id: number; team: number; at: string; s: string; road: string; struct: string; bodies: number; fighterD: string; order: number; path: number; np: number; ot?: string }
interface Track { since: number; s0: number; off0: number; g: LaneG; road: string; idle: number; ix: number; iy: number; is0: number }

function structNear(w: World, x: number, y: number): string {
  let best = '', bd = Infinity;
  for (const s of structuresOf(w)) { const d = Math.hypot(s.ent.x - x, s.ent.y - y) - s.ent.radius; if (d < bd) { bd = d; best = `${s.def.id}${s.ent.alive ? '' : '(fallen)'} ${f1(d)} m`; } }
  return best;
}

/** the scripted player on seat 0: loiters in its own first mid tower's neck while the waves pass */
function player(w: World, me: Entity, tower: StructEntry | undefined, laneG: LaneG, base: { x: number; y: number }, cmd: (c: Parameters<World['command']>[1]) => void, st: { phase: number; until: number; low: boolean }): void {
  if (!me.alive || !tower) return;
  const t = w.tick;
  if (st.low) { if (me.hp >= me.maxHp * 0.95) st.low = false; else return; }
  if (me.hp < me.maxHp * 0.3) { st.low = true; cmd({ type: 'recall' }); return; }
  // the tower's spot along the road and the road's direction there (toward the enemy)
  const s = project(laneG, tower.ent.x, tower.ent.y);
  const at = (ds: number): { x: number; y: number } => {
    const q = Math.max(0, Math.min(laneG.len, s + ds));
    let i = 1; while (i < laneG.cum.length - 1 && laneG.cum[i] < q) i++;
    const a = laneG.pts[i - 1], b = laneG.pts[i], seg = laneG.cum[i] - laneG.cum[i - 1] || 1, u = (q - laneG.cum[i - 1]) / seg;
    return { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u };
  };
  if (t < st.until) {
    // a held right button: the same point re-sent every 500 ms (ruling 38)
    if (st.phase % 4 === 1 && t % 15 === 0) { const p = at(9); cmd({ type: 'move', x: p.x, y: p.y }); }
    if (st.phase % 4 === 3 && t % 15 === 0) { const p = at(-7); cmd({ type: 'move', x: p.x, y: p.y }); }
    // shooting in place at the wave (ruling 39), every 6 ticks while held
    if (st.phase % 4 === 2 && t % 6 === 0) { const p = at(6); cmd({ type: 'attackAt', x: p.x, y: p.y } as never); }
    return;
  }
  st.phase++;
  st.until = t + 30 * (3 + (st.phase % 3) * 2);
  if (st.phase % 4 === 0) { const p = at(0.5); cmd({ type: 'move', x: p.x, y: p.y }); }          // stand in the neck beside the tower
  if (Math.hypot(me.x - tower.ent.x, me.y - tower.ent.y) > 30) { const p = at(-2); cmd({ type: 'move', x: p.x, y: p.y }); st.until = t + 30 * 12; }
  void base;
}

function runOne(modeId: string, scen: string, seed: number): { stuck: Stuck[]; idle: Stuck[]; end: number; wicks: number; secs: number } {
  const t0 = Date.now();
  const setup = lineup(modeId, seed, scen === 'player');
  const factory = scen === 'player' ? createBots(catalog, setup) : null;
  const sim = createSim(catalog, setup, { bots: factory ?? (() => null), pregameSeconds: 0 });
  const w0 = worldOf(sim);
  const roads = w0.mapDef.lanes;
  const mid = (roads.find((l) => /seat|mid|span/.test(l.id)) ?? roads[Math.floor(roads.length / 2)]).id;
  const tracks = new Map<number, Track>();
  const stuck: Stuck[] = [];
  const idle: Stuck[] = [];
  const geoms = new Map<string, LaneG>();
  const laneOf = (path: readonly (readonly [number, number])[]): { g: LaneG; road: string } => {
    const k = `${path[0][0]},${path[0][1]}>${path[path.length - 1][0]},${path[path.length - 1][1]}`;
    let g = geoms.get(k);
    if (!g) { g = geom(path); geoms.set(k, g); }
    const road = roads.find((l) => (l.path[0][0] === path[0][0] && l.path[0][1] === path[0][1]) || (l.path[l.path.length - 1][0] === path[0][0] && l.path[l.path.length - 1][1] === path[0][1]))?.id ?? '?';
    return { g, road };
  };
  // idle: the mid first towers fall on a seed schedule (and one other road's on RIFT)
  const sched: { t: number; team: number; road: string; tier: RegExp; done: boolean }[] = [];
  if (scen === 'idle') {
    const side = seed % 2, other = 1 - side, ta = 240 + (seed % 3) * 150;
    sched.push({ t: ta, team: side, road: mid, tier: /outer/, done: false }, { t: ta + 90, team: other, road: mid, tier: /outer/, done: false });
    const others = roads.filter((l) => l.id !== mid);
    if (others.length) sched.push({ t: ta + 45, team: other, road: others[seed % others.length].id, tier: /outer/, done: false });
  }
  // the scripted player's own first mid tower and its road (team 0 walks the road forward)
  const me = w0.players[0].ent!;
  const midRoad = roads.find((l) => l.id === mid)!;
  const myRoad = geom(midRoad.path.map((p) => [p[0], p[1]] as [number, number]));
  const first = (): StructEntry | undefined => structuresOf(worldOf(sim)).filter((s) => s.ent.team === me.team && (s.def.lane ?? '') === mid && /outer/.test(s.def.unit) && s.ent.alive)[0]
    ?? structuresOf(worldOf(sim)).filter((s) => s.ent.team === me.team && (s.def.lane ?? '') === mid && s.ent.alive)[0];
  const base = { x: me.x, y: me.y };
  const pst = { phase: 0, until: 0, low: false };
  let wicks = 0;
  const seen = new Set<number>();
  const limit = MINUTES * 60 * 30;
  for (let tick = 0; sim.view.phase !== 'ended' && tick < limit; tick++) {
    sim.step();
    const w = worldOf(sim);
    if (w.phase !== 'live') continue;
    for (const sc of sched) {
      if (sc.done || w.time < sc.t) continue;
      sc.done = true;
      for (const s of structuresOf(w)) if (s.ent.alive && s.ent.team === sc.team && (s.def.lane ?? '') === sc.road && sc.tier.test(s.def.unit)) { killEntity(w, s.ent, null); break; }
    }
    if (scen === 'player' && w.time > 75) player(w, me, first(), myRoad, base, (c) => sim.command(0, c), pst);
    if (TRACE && TRACE.map === modeId && TRACE.scen === scen && TRACE.seed === seed && w.time >= TRACE.from && w.time <= TRACE.to && w.tick % 15 === 0) {
      const e = w.entity(TRACE.id);
      if (e && e.alive) {
        const ot = w.entity(e.orderTarget);
        const m = minionState(e)!;
        const nb = w.entities.filter((o) => o !== e && o.alive && o.kind !== 'projectile' && o.kind !== 'zone' && Math.hypot(o.x - e.x, o.y - e.y) < 2.2).map((o) => `${o.kind[0]}${o.team}${o.static ? 'S' : ''}#${o.id}o${o.order}${o.atkWindup >= 0 ? 'W' : ''}np${o.noProgress}@${f1(o.x)},${f1(o.y)}`);
        console.log(`  trace t${f1(w.time)} (${f1(e.x)},${f1(e.y)}) ord${e.order} to(${f1(e.orderX)},${f1(e.orderY)}) ot:${ot ? `${ot.kind}${ot.alive ? '' : '+dead'}@${f1(ot.x)},${f1(ot.y)} vis${(ot.visibleMask >> e.team) & 1}` : '-'} path${e.path.length >> 1}/${e.pathIdx} np${e.noProgress} as${e.arriveStall} wd${f1(e.atkWindup)} an${f1(e.atkAnim)} fl${m.flankUntil - w.tick} cT${m.chaseT} near[${nb.join(' ')}]`);
      }
    }
    if (w.tick % SAMPLE !== 0) continue;
    for (const e of w.entities) {
      if (e.kind !== 'minion' || !e.alive) continue;
      const m = minionState(e);
      if (!m) continue;
      if (!seen.has(e.id)) { seen.add(e.id); wicks++; }
      let tr = tracks.get(e.id);
      const { g, road } = tr ?? laneOf(m.path);
      const s = project(g, e.x, e.y), off = projectOff;
      if (!tr) { tr = { since: w.tick, s0: s, off0: off, g, road, idle: w.tick, ix: e.x, iy: e.y, is0: s }; tracks.set(e.id, tr); continue; }
      // IDLE (what a viewer reads as stuck, fight or no fight): 6 s with no swing, under 0.5 m along the road and under
      // 0.75 m of ground (the orch1 r2 verifier's bar), away from the road's end and not held by CC
      if (g.len - s < END_NEAR || e.atkWindup >= 0 || e.atkAnim > 0 || e.cast || (e.ccMask & (CC_HARD | CC_ROOT)) !== 0 || s - tr.is0 >= STUCK_GAIN || Math.hypot(e.x - tr.ix, e.y - tr.iy) >= IDLE_GROUND) {
        tr.idle = w.tick; tr.ix = e.x; tr.iy = e.y; tr.is0 = s;
      } else if (w.tick - tr.idle >= STUCK_TICKS && e.order === ORDER_ATTACK && boxed(w, e)) {
        // boxed in by its own wave (3+ allied Wicks pressed on it and no open attack spot round its target that it can
        // walk to): the back of the queue, which the orch1 r2 verifier classed as queued; counted, not gated
        boxedN++;
        tr.idle = w.tick; tr.ix = e.x; tr.iy = e.y; tr.is0 = s;
      } else if (w.tick - tr.idle >= STUCK_TICKS && e.order === ORDER_ATTACK) {
        // holding an attack order 6 s without a swing or 0.75 m of ground: frozen behind its own blob (orch1 r2: the back
        // of a 3-4 Wick blob sieging a base lantern, 0.2 m/s); the creep watch steps it out, so none may be left
        frozenAll.push({ map: modeId, scen, seed, t: `${Math.floor(w.time / 60)}:${String(Math.floor(w.time % 60)).padStart(2, '0')}`, id: e.id, team: e.team,
          at: `(${f1(e.x)}, ${f1(e.y)})`, s: `${f1(s)}/${f1(g.len)}`, road, struct: structNear(w, e.x, e.y), bodies: 0, fighterD: '', order: e.order, path: e.path.length >> 1, np: e.noProgress,
          ot: (() => { const o = w.entity(e.orderTarget); return o ? `${o.kind} ${f1(Math.hypot(o.x - e.x, o.y - e.y) - o.radius - e.radius)} m` : '?'; })() } as Stuck);
        tr.idle = w.tick; tr.ix = e.x; tr.iy = e.y; tr.is0 = s;
      } else if (w.tick - tr.idle >= STUCK_TICKS && queued(w, e)) {
        queuedN++;
        tr.idle = w.tick; tr.ix = e.x; tr.iy = e.y; tr.is0 = s;
      } else if (w.tick - tr.idle >= STUCK_TICKS) {
        idle.push({ map: modeId, scen, seed, t: `${Math.floor(w.time / 60)}:${String(Math.floor(w.time % 60)).padStart(2, '0')}`, id: e.id, team: e.team,
          at: `(${f1(e.x)}, ${f1(e.y)})`, s: `${f1(s)}/${f1(g.len)}`, road, struct: structNear(w, e.x, e.y), bodies: 0, fighterD: '', order: e.order, path: e.path.length >> 1, np: e.noProgress,
          ot: e.order === ORDER_ATTACK ? (() => { const o = w.entity(e.orderTarget); return o ? `${o.kind} ${f1(Math.hypot(o.x - e.x, o.y - e.y) - o.radius - e.radius)} m` : '?'; })() : '' } as Stuck);
        tr.idle = w.tick; tr.ix = e.x; tr.iy = e.y; tr.is0 = s;
      }
      // walking back to its road after a chase pulled it off (orch1 r3 controls: two Wicks dragged 12 m into the low
      // jungle by a fighter, returning at full speed, gained nothing along the road for 6 s): coming back is progress
      if (g.len - s < END_NEAR || !free(w, e) || s - tr.s0 >= STUCK_GAIN || tr.off0 - off >= RETURN_GAIN) { tr.since = w.tick; tr.s0 = s; tr.off0 = off; continue; }
      if (w.tick - tr.since >= STUCK_TICKS) {
        let bodies = 0, fd = Infinity;
        for (const o of w.entities) {
          if (o === e || !o.alive || o.kind === 'projectile' || o.kind === 'zone') continue;
          const d = Math.hypot(o.x - e.x, o.y - e.y);
          if (d < e.radius + o.radius + 0.3) bodies++;
          if (o.kind === 'fighter') fd = Math.min(fd, d);
        }
        stuck.push({ map: modeId, scen, seed, t: `${Math.floor(w.time / 60)}:${String(Math.floor(w.time % 60)).padStart(2, '0')}`, id: e.id, team: e.team,
          at: `(${f1(e.x)}, ${f1(e.y)})`, s: `${f1(s)}/${f1(g.len)}`, road, struct: structNear(w, e.x, e.y), bodies, fighterD: f1(fd), order: e.order, path: e.path.length >> 1, np: e.noProgress });
        tr.since = w.tick; tr.s0 = s; tr.off0 = off;
      }
    }
    for (const id of tracks.keys()) { const e = w.entity(id); if (!e || !e.alive) tracks.delete(id); }
  }
  return { stuck, idle, end: worldOf(sim).time, wicks, secs: (Date.now() - t0) / 1000 };
}

const all: Stuck[] = [];
const idleAll: Stuck[] = [];
const runs: unknown[] = [];
for (const map of MAPS) for (const scen of SCENS) for (let seed = SEED0; seed < SEED0 + SEEDS; seed++) {
  const r = runOne(map, scen, seed);
  all.push(...r.stuck);
  idleAll.push(...r.idle);
  runs.push({ map, scen, seed, minutes: Number((r.end / 60).toFixed(1)), wicks: r.wicks, stuck: r.stuck.length, idle: r.idle.length, secs: Math.round(r.secs) });
  console.log(`${map} ${scen} seed ${seed}: ${f1(r.end / 60)} min, ${r.wicks} Wicks, ${r.stuck.length} stuck, ${r.idle.length} idle (${Math.round(r.secs)} s)`);
  for (const s of r.idle.slice(0, 4)) console.log(`   idle ${JSON.stringify(s)}`);
  for (const s of r.stuck.slice(0, 6)) console.log(`   stuck ${JSON.stringify(s)}`);
}
try { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), gate: '0 stuck, 0 idle, 0 frozen in an attack order', stuck: all.length, idle: idleAll.length, frozen: frozenAll.length, queued: queuedN, boxed: boxedN, runs, episodes: all, idleEpisodes: idleAll, frozenEpisodes: frozenAll }, null, 1) + '\n'); } catch { /* report only */ }
const byRoad = new Map<string, number>();
for (const s of all) byRoad.set(`${s.map}/${s.road}`, (byRoad.get(`${s.map}/${s.road}`) ?? 0) + 1);
console.log(`stuck Wicks: ${all.length} ${JSON.stringify(Object.fromEntries(byRoad))}`);
console.log(`idle Wicks: ${idleAll.length} (queued in their own wave's crowd, not counted: ${queuedN}; boxed in an attack order with no open spot: ${boxedN})`);
console.log(`frozen in an attack order (6 s, no swing, < 0.75 m): ${frozenAll.length}`);
for (const s of frozenAll.slice(0, 8)) console.log(`   frozen ${JSON.stringify(s)}`);
if (all.length > 0 || idleAll.length > 0 || frozenAll.length > 0) { console.log(`FAIL ${all.length} stuck, ${idleAll.length} idle and ${frozenAll.length} frozen Wick episode(s) (gate 0, 0 and 0)`); process.exit(1); }
console.log('PASS 0 stuck and 0 idle Wicks on every road of every map');
