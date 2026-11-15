// DIAGNOSTIC (no src edits): do Wicks walking their road leave the lane line (owner 2026-11-15: "they dont follow the
// straight path and move slightly under the path and come back around ... top lane ... closer to the 2nd tower")?
//
//   node _harness/_tmp_wobble_sim.ts sweep [--seeds 3,7,11,19,23,31] [--minutes 14] [--scen idle,bots] [--towers alive,kill]
//        [--out _harness/_reports/wobble_sim]
//   node _harness/_tmp_wobble_sim.ts trace --seed 7 --scen idle --towers alive --ids 123,456 [--t0 60 --t1 120] [--out f]
//   node _harness/_tmp_wobble_sim.ts trail --seed 7 --scen idle --towers alive --box x0,y0,x1,y1 [--t0 0 --t1 840] --out f.svg
//
// RIFT only. Every tick every Wick is projected on its road polyline (the lane's waypoint path, in team-0 order): arc s
// (map-fixed, from team 0's end), signed lateral offset d (+ = left of team-0 travel = for the top straight +y = screen
// DOWN; the default camera looks down -y-up: screen up = -y), and its heading vs the road tangent. Samples are split
// FIGHTING (attack order, chase flag, swing/windup/anim, cast, or an attackable enemy within its aggro range) vs FREE.
// Excursions: a FREE Wick whose |d| goes over 1.0 m and back under 0.5 m is an episode; its outward drift is split into
// STEER (the step toward its aim: nav A* corner, its lane waypoint, a snapped order point, a step-out spot) and PUSH
// (what separation/walls added on top of the step), plus whether it fought in the 4 s before (return-after-chase).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CatalogT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup } from '../src/contracts/sim.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import { createSim, worldOf } from '../src/sim/sim.ts';
import { killEntity } from '../src/sim/combat.ts';
import { attackable } from '../src/sim/attack.ts';
import { ORDER_ATTACK, ORDER_ATTACK_MOVE, type Entity } from '../src/sim/entity.ts';
import type { World } from '../src/sim/world.ts';
import { structuresOf, type StructEntry } from '../src/sim/units/structures.ts';
import { minionState } from '../src/sim/units/minions.ts';
import { behaviorOf } from '../src/sim/units/common.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const MODE = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'sweep';
const opt = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const SEEDS = opt('seeds', '3,7,11,19,23,31').split(',').map(Number);
const MINUTES = Number(opt('minutes', '14'));
const SCENS = opt('scen', 'idle,bots').split(',');
const TOWERS = opt('towers', 'alive,kill').split(',');
const OUT = opt('out', join(HERE, '_reports', 'wobble_sim'));
const SEG = 4;
const HB = 0.02, HN = 600;   // |d| histogram: 2 cm bins to 12 m
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
  return { matchId: `wobble-${modeId}-${seed}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}

interface LaneG { id: string; pts: [number, number][]; cum: number[]; len: number }
function laneGeom(w: World): LaneG[] {
  return w.mapDef.lanes.map((l) => {
    const pts = l.path.map((p) => [p[0], p[1]] as [number, number]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { id: l.id, pts, cum, len: cum[cum.length - 1] };
  });
}
const PR = { s: 0, d: 0, ox: 0, oy: 0, tx: 0, ty: 0, seg: 0 };
function project(g: LaneG, x: number, y: number): void {
  let bd = Infinity;
  for (let i = 1; i < g.pts.length; i++) {
    const [ax, ay] = g.pts[i - 1], [bx, by] = g.pts[i];
    const abx = bx - ax, aby = by - ay, l2 = abx * abx + aby * aby, L = Math.sqrt(l2);
    let t = ((x - ax) * abx + (y - ay) * aby) / l2;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + abx * t, qy = ay + aby * t;
    const dd = (x - qx) * (x - qx) + (y - qy) * (y - qy);
    if (dd < bd) {
      bd = dd; PR.s = g.cum[i - 1] + t * L; PR.ox = x - qx; PR.oy = y - qy; PR.tx = abx / L; PR.ty = aby / L; PR.seg = i;
    }
  }
  const dist = Math.sqrt(bd);
  PR.d = (PR.tx * PR.oy - PR.ty * PR.ox) >= 0 ? dist : -dist;
}
function laneOf(lanes: LaneG[], path: readonly (readonly [number, number])[]): number {
  const p0 = path[0], pe = path[path.length - 1];
  for (let k = 0; k < lanes.length; k++) {
    const g = lanes[k], g0 = g.pts[0], ge = g.pts[g.pts.length - 1];
    if ((g0[0] === p0[0] && g0[1] === p0[1] && ge[0] === pe[0] && ge[1] === pe[1]) || (g0[0] === pe[0] && g0[1] === pe[1] && ge[0] === p0[0] && ge[1] === p0[1])) return k;
  }
  return -1;
}

const qbuf: Entity[] = [];
function enemyInAggro(w: World, e: Entity, aggro: number): boolean {
  const n = w.query(e.x, e.y, aggro + 3, qbuf);
  for (let i = 0; i < n; i++) {
    const o = qbuf[i];
    if (o.team === e.team || !o.alive || o.kind === 'projectile' || o.kind === 'zone' || o.kind === 'ward' || o.kind === 'pickup') continue;
    if (Math.hypot(o.x - e.x, o.y - e.y) - o.radius > aggro) continue;
    if (attackable(w, e, o)) return true;
  }
  return false;
}
function neighbours(w: World, e: Entity): { ally: number; enemy: number; struct: number } {
  const n = w.query(e.x, e.y, e.radius + 2.5, qbuf);
  const r = { ally: 0, enemy: 0, struct: 0 };
  for (let i = 0; i < n; i++) {
    const o = qbuf[i];
    if (o === e || !o.alive || o.kind === 'projectile' || o.kind === 'zone' || o.kind === 'ward' || o.kind === 'pickup') continue;
    if (Math.hypot(o.x - e.x, o.y - e.y) - o.radius - e.radius > 0.15) continue;
    if (o.kind === 'structure') r.struct++; else if (o.team === e.team) r.ally++; else r.enemy++;
  }
  return r;
}

interface Bin { cd: Float64Array; cy: Float64Array; cn: Float64Array; h: Uint32Array; n: number; free: number; over1: number; over15: number; down1: number; plus1: number; head: number; headN: number; fightN: number; maxD: number; maxAt: string }
const newBin = (): Bin => ({ cd: new Float64Array(4), cy: new Float64Array(4), cn: new Float64Array(4), h: new Uint32Array(HN), n: 0, free: 0, over1: 0, over15: 0, down1: 0, plus1: 0, head: 0, headN: 0, fightN: 0, maxD: 0, maxAt: '' });
interface Ep {
  run: string; seed: number; scen: string; towers: string; id: number; def: string; team: number; lane: string;
  t0: number; t1: number; s0: number; s1: number; sMax: number; x: number; y: number; maxD: number; signD: number; downY: number;
  steerOut: number; pushOut: number; pathTicks: number; directTicks: number; flankTicks: number; snapTicks: number; ticks: number;
  foughtBefore: number; allyTouchTicks: number; structTouchTicks: number; enemyTouchTicks: number; cause: string;
}
interface Tr {
  lane: number; col: number; lastFight: number; px: number; py: number; ph: number;
  ep: Ep | null; outD: number;
}

interface Ctx { catalog: CatalogT; seed: number; scen: string; towers: string; onTick?: (w: World, tick: number) => void; trackIds?: Set<number> }

function runOne(c: Ctx, bins: Map<string, Bin>, eps: Ep[], lanes0: { lanes: LaneG[] }): { end: number; kills: string[] } {
  const setup = lineup(c.catalog, 'rift', c.seed);
  const factory = c.scen === 'bots' ? createBots(c.catalog, setup) : null;
  const sim = createSim(c.catalog, setup, { bots: factory ?? (() => null), pregameSeconds: 0 });
  const w0 = worldOf(sim);
  const lanes = laneGeom(w0);
  lanes0.lanes = lanes;
  const kills: string[] = [];
  const sched: { t: number; team: number; tier: string; done: boolean }[] = [];
  if (c.towers === 'kill') {
    // every outer tower of one side falls at 2:30-4:30 (seed), the other side's 60 s later; the inner ones stay up
    const side = c.seed % 2, t0 = 150 + (c.seed % 3) * 60;
    sched.push({ t: t0, team: side, tier: 'outer', done: false }, { t: t0 + 60, team: 1 - side, tier: 'outer', done: false });
  }
  const tracks = new Map<number, Tr>();
  const runKey = `${c.scen}/${c.towers}/s${c.seed}`;
  const limit = MINUTES * 60 * 30;
  // pre-step positions and the aim each Wick walks toward
  const pre = new Map<number, { x: number; y: number }>();
  let tick = 0;
  while (sim.view.phase !== 'ended' && tick < limit) {
    let w = worldOf(sim);
    pre.clear();
    for (const e of w.entities) if (e.kind === 'minion' && e.alive) pre.set(e.id, { x: e.x, y: e.y });
    sim.step(); tick++;
    w = worldOf(sim);
    if (w.phase === 'pregame') continue;
    for (const sc of sched) {
      if (sc.done || w.time < sc.t) continue;
      sc.done = true;
      for (const s of structuresOf(w)) if (s.ent.alive && s.ent.team === sc.team && TIER(s) === sc.tier) { killEntity(w, s.ent, null); kills.push(`${(w.time / 60).toFixed(2)}m ${s.def.id}`); }
    }
    c.onTick?.(w, tick);
    const seen = new Set<number>();
    for (const e of w.entities) {
      if (e.kind !== 'minion' || !e.alive || !e.unit) continue;
      const m = minionState(e) as unknown as { path: [number, number][]; wp: number; chasing: boolean; flankUntil?: number; lastWpX: number; lastWpY: number } | undefined;
      if (!m) continue;
      seen.add(e.id);
      let tr = tracks.get(e.id);
      if (!tr) { tr = { lane: laneOf(lanes, m.path), col: -9, lastFight: -1e9, px: e.x, py: e.y, ph: NaN, ep: null, outD: 0 }; tracks.set(e.id, tr); }
      if (tr.lane < 0) continue;
      const g = lanes[tr.lane];
      project(g, e.x, e.y);
      const s = PR.s, d = PR.d, ad = Math.abs(d), tx = PR.tx * (e.team === 1 ? -1 : 1), ty = PR.ty * (e.team === 1 ? -1 : 1);
      const nx = -PR.ty, ny = PR.tx;   // lane normal (+d side)
      // spawn column (rows of three, COL_GAP 1.1 m): read off the first sample's offset, in the walker's own left/right
      if (tr.col === -9) { const dl = e.team === 1 ? -d : d; tr.col = Math.max(-1, Math.min(1, Math.round(dl / 1.1))); }
      const beh = behaviorOf(e.unit);
      const fighting = e.order === ORDER_ATTACK || m.chasing || e.atkWindup >= 0 || e.atkAnim > 0 || !!e.cast || enemyInAggro(w, e, beh.aggroRange);
      if (fighting) tr.lastFight = tick;
      const flank = (m.flankUntil ?? -1) > w.tick;
      const endZone = s < 6 || s > g.len - 6;   // spawn rows / holding the far end
      const key = `${g.id}|${e.team}|${Math.floor(s / SEG)}`;
      let b = bins.get(key); if (!b) { b = newBin(); bins.set(key, b); }
      b.n++;
      const p = pre.get(e.id);
      const mx = p ? e.x - p.x : 0, my = p ? e.y - p.y : 0, mv = Math.hypot(mx, my);
      if (fighting) b.fightN++;
      else if (!endZone) {
        b.free++;
        b.h[Math.min(HN - 1, Math.floor(ad / HB))]++;
        b.cd[tr.col + 1] += d; b.cy[tr.col + 1] += PR.oy; b.cn[tr.col + 1]++;
        b.cd[3] += d; b.cy[3] += PR.oy; b.cn[3]++;
        if (ad > 1) { b.over1++; if (PR.oy > 0) b.down1++; if (d > 0) b.plus1++; }
        if (ad > 1.5) b.over15++;
        if (ad > b.maxD) { b.maxD = ad; b.maxAt = `${runKey} #${e.id} t=${w.time.toFixed(1)} (${e.x.toFixed(2)},${e.y.toFixed(2)})`; }
        if (mv > 1e-3) {
          const c2 = (mx * tx + my * ty) / mv;
          b.head += Math.acos(Math.max(-1, Math.min(1, c2))); b.headN++;
        }
      }
      // excursion bookkeeping (free Wicks off the ends)
      const sinceFight = tick - tr.lastFight;
      if (!tr.ep && !fighting && !endZone && ad > 1.0) {
        tr.ep = {
          run: runKey, seed: c.seed, scen: c.scen, towers: c.towers, id: e.id, def: e.def, team: e.team, lane: g.id,
          t0: w.time, t1: w.time, s0: s, s1: s, sMax: s, x: e.x, y: e.y, maxD: ad, signD: Math.sign(d), downY: PR.oy > 0 ? 1 : -1,
          steerOut: 0, pushOut: 0, pathTicks: 0, directTicks: 0, flankTicks: 0, snapTicks: 0, ticks: 0,
          foughtBefore: sinceFight < 120 ? sinceFight / 30 : -1, allyTouchTicks: 0, structTouchTicks: 0, enemyTouchTicks: 0, cause: '',
        };
        tr.outD = ad;
      }
      if (tr.ep) {
        const ep = tr.ep;
        ep.ticks++; ep.t1 = w.time; ep.s1 = s;
        if (ad > ep.maxD) { ep.maxD = ad; ep.sMax = s; ep.x = e.x; ep.y = e.y; ep.signD = Math.sign(d); ep.downY = PR.oy > 0 ? 1 : -1; }
        if (e.path.length > 0 && e.pathIdx * 2 < e.path.length) ep.pathTicks++; else ep.directTicks++;
        if (flank) ep.flankTicks++;
        const wpI = Math.min(m.wp, m.path.length - 1), wp = m.path[wpI];
        if (e.order === ORDER_ATTACK_MOVE && Math.hypot(e.orderX - wp[0], e.orderY - wp[1]) > 0.3 && !flank) ep.snapTicks++;
        const nb = neighbours(w, e);
        if (nb.ally) ep.allyTouchTicks++; if (nb.struct) ep.structTouchTicks++; if (nb.enemy) ep.enemyTouchTicks++;
        // outward split: the intended step toward the aim vs the push on top of it
        if (p && mv > 1e-4) {
          const onPath = e.path.length > 0 && e.pathIdx * 2 < e.path.length;
          const ax = onPath ? e.path[e.pathIdx * 2] : e.orderX, ay = onPath ? e.path[e.pathIdx * 2 + 1] : e.orderY;
          const ux = ax - p.x, uy = ay - p.y, ul = Math.hypot(ux, uy) || 1;
          const step = Math.min(e.stats.moveSpeed / 30, ul);
          const ix = (ux / ul) * step, iy = (uy / ul) * step;
          const sg = Math.sign(d) || 1;
          const steerLat = (ix * nx + iy * ny) * sg, pushLat = ((mx - ix) * nx + (my - iy) * ny) * sg;
          if (steerLat > 0) ep.steerOut += steerLat;
          if (pushLat > 0) ep.pushOut += pushLat;
        }
        if (fighting || ad < 0.5 || endZone) {
          ep.cause = ep.flankTicks > 0 ? 'step-out' : ep.foughtBefore >= 0 ? 'return-after-fight'
            : ep.pushOut > ep.steerOut ? (ep.structTouchTicks > ep.ticks * 0.2 ? 'push:structure' : ep.enemyTouchTicks > ep.allyTouchTicks ? 'push:enemy-bodies' : 'push:ally-separation')
            : ep.pathTicks > ep.directTicks ? 'steer:nav-path' : ep.snapTicks > ep.ticks * 0.3 ? 'steer:snapped-order' : 'steer:direct-to-waypoint';
          if (fighting) ep.cause += '(ended-in-fight)';
          eps.push(ep); tr.ep = null;
        }
      }
      tr.px = e.x; tr.py = e.y;
    }
    for (const id of [...tracks.keys()]) if (!seen.has(id)) tracks.delete(id);
  }
  return { end: worldOf(sim).time, kills };
}

function pct(b: Bin, p: number): number {
  const tot = b.free - 0; let acc = 0;
  if (tot <= 0) return NaN;
  for (let i = 0; i < HN; i++) { acc += b.h[i]; if (acc >= p * tot) return (i + 0.5) * HB; }
  return HN * HB;
}
function merge(dst: Bin, src: Bin): void {
  for (let i = 0; i < HN; i++) dst.h[i] += src.h[i];
  for (let i = 0; i < 4; i++) { dst.cd[i] += src.cd[i]; dst.cy[i] += src.cy[i]; dst.cn[i] += src.cn[i]; }
  dst.n += src.n; dst.free += src.free; dst.over1 += src.over1; dst.over15 += src.over15; dst.down1 += src.down1; dst.plus1 += src.plus1;
  dst.head += src.head; dst.headN += src.headN; dst.fightN += src.fightN;
  if (src.maxD > dst.maxD) { dst.maxD = src.maxD; dst.maxAt = src.maxAt; }
}

function laneXY(g: LaneG, s: number): [number, number] {
  let k = 1; while (k < g.pts.length - 1 && g.cum[k] < s) k++;
  const f = (s - g.cum[k - 1]) / ((g.cum[k] - g.cum[k - 1]) || 1);
  return [g.pts[k - 1][0] + (g.pts[k][0] - g.pts[k - 1][0]) * f, g.pts[k - 1][1] + (g.pts[k][1] - g.pts[k - 1][1]) * f];
}

const catalog = loadCatalog();

if (MODE === 'sweep') {
  const all = new Map<string, Map<string, Bin>>();   // group -> bins
  const eps: Ep[] = [];
  const runs: string[] = [];
  const lanesHold = { lanes: [] as LaneG[] };
  let structs: { id: string; team: number; x: number; y: number; lane: string; tier: string }[] = [];
  for (const scen of SCENS) for (const towers of TOWERS) {
    const grp = new Map<string, Bin>();
    for (const seed of SEEDS) {
      const t0 = Date.now();
      const bins = new Map<string, Bin>();
      const r = runOne({ catalog, seed, scen, towers }, bins, eps, lanesHold);
      for (const [k, v] of bins) { let d = grp.get(k); if (!d) { d = newBin(); grp.set(k, d); } merge(d, v); }
      const line = `run ${scen}/${towers} seed ${seed}: ${(r.end / 60).toFixed(1)} min, kills [${r.kills.join('; ')}] (${((Date.now() - t0) / 1000).toFixed(0)} s)`;
      runs.push(line); console.log(line);
    }
    all.set(`${scen}/${towers}`, grp);
  }
  { const sim = createSim(catalog, lineup(catalog, 'rift', 1), { pregameSeconds: 0 }); const w = worldOf(sim);
    structs = structuresOf(w).map((s) => ({ id: s.def.id, team: s.ent.team, x: s.ent.x, y: s.ent.y, lane: s.def.lane ?? '', tier: TIER(s) })); }
  const lanes = lanesHold.lanes;
  const nearStruct = (x: number, y: number): string => {
    let best = '', bd = 9;
    for (const s of structs) { const dd = Math.hypot(s.x - x, s.y - y); if (dd < bd) { bd = dd; best = `${s.id}(${dd.toFixed(1)}m)`; } }
    return best;
  };
  const L: string[] = [];
  L.push(`# Wick lateral wobble on RIFT: seeds ${SEEDS.join(',')}, ${MINUTES} min, scen ${SCENS.join(',')}, towers ${TOWERS.join(',')}; segments of ${SEG} m along each road (s from team 0's end)`);
  L.push(...runs);
  L.push('sign: d>0 = left of team-0 travel; "down" = world +y = screen DOWN under the default camera (screen up = -y)');
  // combined over all groups, and per group
  const combined = new Map<string, Bin>();
  for (const grp of all.values()) for (const [k, v] of grp) { let d = combined.get(k); if (!d) { d = newBin(); combined.set(k, d); } merge(d, v); }
  const table = (title: string, bins: Map<string, Bin>, only?: (k: string, b: Bin) => boolean): void => {
    L.push(''); L.push(`## ${title}`);
    L.push('lane team seg(s m) @xy | free n | p50 p95 max |d| m | >1.0 m  >1.5 m (free share) | down-share of >1 | +d share | mean heading off-road deg | nearest structure');
    const keys = [...bins.keys()].sort((a, b) => { const [la, ta, sa] = a.split('|'), [lb, tb, sb] = b.split('|'); return la.localeCompare(lb) || +ta - +tb || +sa - +sb; });
    for (const k of keys) {
      const b = bins.get(k)!;
      if (b.free < 50 || (only && !only(k, b))) continue;
      const [ln, tm, sg] = k.split('|');
      const g = lanes.find((x) => x.id === ln)!;
      const [cx, cy] = laneXY(g, (+sg + 0.5) * SEG);
      L.push(`${ln} t${tm} ${+sg * SEG}-${+sg * SEG + SEG} @(${cx.toFixed(1)},${cy.toFixed(1)}) | ${b.free} | ${pct(b, 0.5).toFixed(2)} ${pct(b, 0.95).toFixed(2)} ${b.maxD.toFixed(2)} | ${(100 * b.over1 / b.free).toFixed(1)}% ${(100 * b.over15 / b.free).toFixed(1)}% | ${b.over1 ? (100 * b.down1 / b.over1).toFixed(0) + '%' : '-'} | ${b.over1 ? (100 * b.plus1 / b.over1).toFixed(0) + '%' : '-'} | ${b.headN ? (b.head / b.headN * 180 / Math.PI).toFixed(1) : '-'} | ${nearStruct(cx, cy)}`);
    }
  };
  // hot segments
  const hot = [...combined.entries()].filter(([, b]) => b.free >= 200).map(([k, b]) => ({ k, b, sh: b.over1 / b.free })).sort((a, b) => b.sh - a.sh);
  L.push(''); L.push('## hottest segments, all scenarios combined (share of FREE samples > 1.0 m)');
  for (const h of hot.slice(0, 25)) {
    const [ln, tm, sg] = h.k.split('|'); const g = lanes.find((x) => x.id === ln)!; const [cx, cy] = laneXY(g, (+sg + 0.5) * SEG);
    L.push(`${ln} t${tm} s ${+sg * SEG}-${+sg * SEG + SEG} @(${cx.toFixed(1)},${cy.toFixed(1)}): >1 m ${(100 * h.sh).toFixed(1)}%, >1.5 m ${(100 * h.b.over15 / h.b.free).toFixed(1)}%, p95 ${pct(h.b, 0.95).toFixed(2)}, max ${h.b.maxD.toFixed(2)} [${h.b.maxAt}], down ${h.b.over1 ? (100 * h.b.down1 / h.b.over1).toFixed(0) : '-'}%, near ${nearStruct(cx, cy)}; per scen: ${[...all.entries()].map(([gk, gb]) => { const x = gb.get(h.k); return x && x.free ? `${gk} ${(100 * x.over1 / x.free).toFixed(1)}%` : `${gk} -`; }).join(', ')}`);
  }
  // per-lane summary
  L.push(''); L.push('## per lane x team, all scenarios (free samples away from the road ends)');
  for (const g of lanes) for (const tm of [0, 1]) {
    const b = newBin();
    for (const [k, v] of combined) { const [ln, t] = k.split('|'); if (ln === g.id && +t === tm) merge(b, v); }
    L.push(`${g.id} t${tm}: free ${b.free}, p50 ${pct(b, 0.5).toFixed(2)} p95 ${pct(b, 0.95).toFixed(2)} max ${b.maxD.toFixed(2)}, >1 m ${(100 * b.over1 / b.free).toFixed(2)}%, >1.5 m ${(100 * b.over15 / b.free).toFixed(2)}%, down-share ${b.over1 ? (100 * b.down1 / b.over1).toFixed(0) : '-'}%`);
  }
  // formation: mean signed offset per spawn column (walker's left / middle / right) and of all free Wicks, per segment
  L.push(''); L.push('## formation: mean signed screen-down offset (world +y, m) per spawn column L/M/R (walker-relative) and all; mean d (+ = left of team-0 travel); all scenarios');
  for (const g of lanes) for (const tm of [0, 1]) {
    const rows: string[] = [];
    for (let sg = 0; sg * SEG < g.len; sg++) {
      const b = combined.get(`${g.id}|${tm}|${sg}`); if (!b || b.free < 200) continue;
      const f = (a: Float64Array, i: number): string => b.cn[i] > 50 ? (a[i] / b.cn[i]).toFixed(2) : '-';
      const [cx, cy] = laneXY(g, (sg + 0.5) * SEG);
      rows.push(`${g.id} t${tm} ${sg * SEG}-${sg * SEG + SEG} @(${cx.toFixed(1)},${cy.toFixed(1)}): down L ${f(b.cy, 2)} M ${f(b.cy, 1)} R ${f(b.cy, 0)} all ${f(b.cy, 3)} | d L ${f(b.cd, 2)} M ${f(b.cd, 1)} R ${f(b.cd, 0)} all ${f(b.cd, 3)} | n ${b.cn[3]} | ${nearStruct(cx, cy)}`);
    }
    L.push(...rows);
  }
  // near the towers: +-8 m of each structure's projection
  L.push(''); L.push('## +-8 m round each road tower (projection on its road), all scenarios, per walking team');
  for (const st of structs) {
    if (st.tier !== 'outer' && st.tier !== 'inner') continue;
    const g = lanes.find((x) => x.id === st.lane); if (!g) continue;
    project(g, st.x, st.y); const ss = PR.s, sd = PR.d;
    for (const tm of [0, 1]) {
      const b = newBin();
      for (const [k, v] of combined) { const [ln, t, sg] = k.split('|'); const mid = (+sg + 0.5) * SEG; if (ln === g.id && +t === tm && Math.abs(mid - ss) <= 8) merge(b, v); }
      if (!b.free) continue;
      L.push(`${st.id} (team ${st.team}, at s ${ss.toFixed(1)}, d ${sd.toFixed(2)}) walkers t${tm}: free ${b.free}, p50 ${pct(b, 0.5).toFixed(2)} p95 ${pct(b, 0.95).toFixed(2)} max ${b.maxD.toFixed(2)}, >1 m ${(100 * b.over1 / b.free).toFixed(1)}%, >1.5 m ${(100 * b.over15 / b.free).toFixed(1)}%, down ${b.over1 ? (100 * b.down1 / b.over1).toFixed(0) : '-'}%, +d ${b.over1 ? (100 * b.plus1 / b.over1).toFixed(0) : '-'}%`);
    }
  }
  // excursion episodes
  L.push(''); L.push(`## excursions (free Wick > 1.0 m off, back under 0.5 m): ${eps.length}`);
  const byCause: Record<string, { n: number; m: number }> = {};
  for (const e of eps) { const c = byCause[e.cause] ??= { n: 0, m: 0 }; c.n++; c.m = Math.max(c.m, e.maxD); }
  for (const [k, v] of Object.entries(byCause).sort((a, b) => b[1].n - a[1].n)) L.push(`${k}: ${v.n} (max ${v.m.toFixed(2)} m)`);
  // excursion hot cells (by lane, team, 4 m of sMax)
  const cell = new Map<string, Ep[]>();
  for (const e of eps) { if (e.cause.includes('ended-in-fight')) continue; const k = `${e.lane}|${e.team}|${Math.floor(e.sMax / SEG)}`; (cell.get(k) ?? cell.set(k, []).get(k)!).push(e); }
  const cells = [...cell.entries()].sort((a, b) => b[1].length - a[1].length);
  L.push(''); L.push('## excursion hot cells (free start and end, by lane/team/4 m of the peak): top 15');
  for (const [k, list] of cells.slice(0, 15)) {
    const [ln, tm, sg] = k.split('|'); const g = lanes.find((x) => x.id === ln)!; const [cx, cy] = laneXY(g, (+sg + 0.5) * SEG);
    const cs: Record<string, number> = {}; let down = 0, plus = 0; const scen: Record<string, number> = {};
    for (const e of list) { cs[e.cause] = (cs[e.cause] ?? 0) + 1; if (e.downY > 0) down++; if (e.signD > 0) plus++; scen[`${e.scen}/${e.towers}`] = (scen[`${e.scen}/${e.towers}`] ?? 0) + 1; }
    const worst = list.slice().sort((a, b) => b.maxD - a.maxD)[0];
    const med = list.map((e) => e.maxD).sort((a, b) => a - b)[Math.floor(list.length / 2)];
    L.push(`${ln} t${tm} s ${+sg * SEG}-${+sg * SEG + SEG} @(${cx.toFixed(1)},${cy.toFixed(1)}) near ${nearStruct(cx, cy)}: ${list.length} excursions, median peak ${med.toFixed(2)} m, down ${(100 * down / list.length).toFixed(0)}%, +d ${(100 * plus / list.length).toFixed(0)}%; causes ${JSON.stringify(cs)}; scen ${JSON.stringify(scen)}`);
    L.push(`    worst: ${worst.run} #${worst.id} ${worst.def} t ${worst.t0.toFixed(1)}-${worst.t1.toFixed(1)} s ${worst.s0.toFixed(1)}->${worst.s1.toFixed(1)} peak ${worst.maxD.toFixed(2)} at (${worst.x.toFixed(2)},${worst.y.toFixed(2)}) steerOut ${worst.steerOut.toFixed(2)} pushOut ${worst.pushOut.toFixed(2)} path/direct ${worst.pathTicks}/${worst.directTicks} snap ${worst.snapTicks} flank ${worst.flankTicks} fought ${worst.foughtBefore.toFixed(1)} s before; touch ally/struct/enemy ${worst.allyTouchTicks}/${worst.structTouchTicks}/${worst.enemyTouchTicks} of ${worst.ticks}`);
  }
  for (const [gk, grp] of all) table(`segments, ${gk} (only segments with > 1 % of free samples over 1 m)`, grp, (_k, b) => b.over1 / b.free > 0.01);
  table('all segments, all scenarios combined', combined);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT + '.txt', L.join('\n') + '\n');
  writeFileSync(OUT + '.json', JSON.stringify({ runs, episodes: eps, structs, lanes: lanes.map((g) => ({ id: g.id, pts: g.pts, len: g.len })) }));
  console.log(L.slice(0, 120).join('\n'));
} else if (MODE === 'trace') {
  // tick-by-tick dump of chosen Wicks (positions, offset, order, nav path, waypoint, flags, touching bodies)
  const ids = new Set(opt('ids', '').split(',').filter(Boolean).map(Number));
  const T0 = Number(opt('t0', '0')), T1 = Number(opt('t1', '1e9'));
  const lines: string[] = [];
  const lanesHold = { lanes: [] as LaneG[] };
  const prev = new Map<number, { x: number; y: number }>();
  runOne({
    catalog, seed: Number(opt('seed', '7')), scen: opt('scen', 'idle'), towers: opt('towers', 'alive'),
    onTick: (w) => {
      if (w.time < T0 || w.time > T1) return;
      for (const id of ids) {
        const e = w.live(id); if (!e) continue;
        const m = minionState(e) as unknown as { path: [number, number][]; wp: number; chasing: boolean; flankUntil?: number } | undefined;
        if (!m || e.kind !== 'minion') continue;
        const g = lanesHold.lanes[laneOf(lanesHold.lanes, m.path)];
        project(g, e.x, e.y);
        const p = prev.get(id); prev.set(id, { x: e.x, y: e.y });
        const nb: string[] = [];
        const n = w.query(e.x, e.y, e.radius + 2.5, qbuf);
        for (let i = 0; i < n; i++) { const o = qbuf[i]; if (o === e || !o.alive || o.kind === 'projectile' || o.kind === 'zone') continue; const gap = Math.hypot(o.x - e.x, o.y - e.y) - o.radius - e.radius; if (gap < 0.15) nb.push(`${o.kind[0]}${o.team === e.team ? '+' : '-'}#${o.id}(${gap.toFixed(2)})`); }
        const onPath = e.path.length > 0 && e.pathIdx * 2 < e.path.length;
        const wp = m.path[Math.min(m.wp, m.path.length - 1)];
        const beh = behaviorOf(e.unit!);
        lines.push(`t ${w.time.toFixed(2)} #${id} (${e.x.toFixed(2)},${e.y.toFixed(2)}) s ${PR.s.toFixed(2)} d ${PR.d.toFixed(2)} step ${p ? `${(e.x - p.x).toFixed(3)},${(e.y - p.y).toFixed(3)}` : '-'} ord ${e.order} oxy (${e.orderX.toFixed(2)},${e.orderY.toFixed(2)}) wp${m.wp}(${wp[0]},${wp[1]}) path ${onPath ? e.path.slice(e.pathIdx * 2).map((v) => v.toFixed(1)).join(',') : '-'} chase ${m.chasing ? 1 : 0} flank ${(m.flankUntil ?? -1) > w.tick ? 1 : 0} atkT ${e.atkTarget} wind ${e.atkWindup} aggro ${enemyInAggro(w, e, beh.aggroRange) ? 1 : 0} np ${e.noProgress} touch ${nb.join(' ')}`);
      }
    },
  }, new Map(), [], lanesHold);
  const out = opt('out', join(HERE, '_reports', 'wobble_trace.txt'));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, lines.join('\n') + '\n');
  console.log(`${lines.length} lines -> ${out}`);
} else if (MODE === 'trail') {
  // top-down SVG of every Wick's trail in a box (free = team colour, fighting = grey), walls / blocked cells, towers, road
  const [x0, y0, x1, y1] = opt('box', '25,10,50,30').split(',').map(Number);
  const T0 = Number(opt('t0', '0')), T1 = Number(opt('t1', '1e9'));
  const S = 30;   // px per m
  const segs: string[] = [];
  const last = new Map<number, { x: number; y: number }>();
  const lanesHold = { lanes: [] as LaneG[] };
  let navSvg = '', structSvg = '';
  const teamF = opt('team', '');
  runOne({
    catalog, seed: Number(opt('seed', '7')), scen: opt('scen', 'idle'), towers: opt('towers', 'alive'),
    onTick: (w, tick) => {
      if (!navSvg) {
        const c = w.nav.cell; const parts: string[] = [];
        for (let y = y0; y < y1; y += c) for (let x = x0; x < x1; x += c) if (!w.nav.walkable(x + c / 2, y + c / 2)) parts.push(`<rect x="${((x - x0) * S).toFixed(1)}" y="${((y - y0) * S).toFixed(1)}" width="${(c * S).toFixed(1)}" height="${(c * S).toFixed(1)}"/>`);
        navSvg = `<g fill="#cfc6b8">${parts.join('')}</g>`;
        structSvg = structuresOf(w).filter((s) => s.ent.x > x0 - 3 && s.ent.x < x1 + 3 && s.ent.y > y0 - 3 && s.ent.y < y1 + 3).map((s) => `<circle cx="${((s.ent.x - x0) * S).toFixed(1)}" cy="${((s.ent.y - y0) * S).toFixed(1)}" r="${(s.ent.radius * S).toFixed(1)}" fill="none" stroke="#333" stroke-width="2"/><text x="${((s.ent.x - x0) * S + 4).toFixed(1)}" y="${((s.ent.y - y0) * S - 4).toFixed(1)}" font-size="13">${s.def.id}</text>`).join('');
      }
      if (w.time < T0 || w.time > T1 || tick % 2 !== 0) return;
      for (const e of w.entities) {
        if (e.kind !== 'minion' || !e.alive) continue;
        if (teamF !== '' && e.team !== +teamF) continue;
        const l = last.get(e.id); last.set(e.id, { x: e.x, y: e.y });
        if (!l || e.x < x0 || e.x > x1 || e.y < y0 || e.y > y1) continue;
        const m = minionState(e) as unknown as { chasing: boolean };
        const beh = behaviorOf(e.unit!);
        const fight = e.order === ORDER_ATTACK || m.chasing || e.atkWindup >= 0 || enemyInAggro(w, e, beh.aggroRange);
        const col = fight ? '#999999' : e.team === 0 ? '#1f6fd1' : '#d1421f';
        segs.push(`<line x1="${((l.x - x0) * S).toFixed(1)}" y1="${((l.y - y0) * S).toFixed(1)}" x2="${((e.x - x0) * S).toFixed(1)}" y2="${((e.y - y0) * S).toFixed(1)}" stroke="${col}" stroke-opacity="0.25" stroke-width="1.5"/>`);
      }
    },
  }, new Map(), [], lanesHold);
  const road = lanesHold.lanes.map((g) => `<polyline fill="none" stroke="#000" stroke-width="2" stroke-dasharray="6 4" points="${g.pts.map((p) => `${((p[0] - x0) * S).toFixed(1)},${((p[1] - y0) * S).toFixed(1)}`).join(' ')}"/>` + g.pts.map((p) => `<circle cx="${((p[0] - x0) * S).toFixed(1)}" cy="${((p[1] - y0) * S).toFixed(1)}" r="4" fill="#000"/>`).join('')).join('');
  const W = (x1 - x0) * S, H = (y1 - y0) * S;
  const grid: string[] = [];
  for (let x = Math.ceil(x0); x <= x1; x += 1) grid.push(`<line x1="${((x - x0) * S)}" y1="0" x2="${((x - x0) * S)}" y2="${H}" stroke="#eee" stroke-width="${x % 5 === 0 ? 1.5 : 0.5}"/>`);
  for (let y = Math.ceil(y0); y <= y1; y += 1) grid.push(`<line x1="0" y1="${((y - y0) * S)}" x2="${W}" y2="${((y - y0) * S)}" stroke="#eee" stroke-width="${y % 5 === 0 ? 1.5 : 0.5}"/>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 40}" viewBox="0 0 ${W} ${H + 40}"><rect width="100%" height="100%" fill="#fff"/>${grid.join('')}${navSvg}${segs.join('')}${road}${structSvg}<text x="6" y="${H + 26}" font-size="14">RIFT x ${x0}..${x1}, y ${y0}..${y1} (screen up = -y); blue team 0 free, red team 1 free, grey fighting; dashed = lane waypoint path; tan = blocked nav cells</text></svg>`;
  const out = opt('out', join(HERE, '_reports', 'wobble_trail.svg'));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, svg);
  console.log(`${segs.length} segments -> ${out}`);
}
