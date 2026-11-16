// DIAGNOSTIC (no src edits), root-cause judge for the owner's 2026-11-15 "minions move slightly under the path" report.
// Counterfactual test of the corner-cut claim: the same RIFT match with every Wick's lane path either untouched (base)
// or resampled every 1 m along the SAME polyline (dense: followLane's WAYPOINT_REACH loop then always aims 2.5-3.5 m
// ahead on the line, i.e. a carrot follower; the drawn road and every vertex are unchanged). If the dip is the waypoint
// corner cut, dense collapses it; if it came from the tower footprint / nav / separation / ruling 39 it would not.
//
//   node _harness/_tmp_wobble_cf.ts [--seeds 3,7,11] [--minutes 6] [--mode base,dense] [--bots 0|1]
//
// Metrics (free = marching Wicks: no attack order, not chasing, not stepping out, no attackable enemy within aggro,
// > 3 m from any live structure rim): per lane x team x 4 m arc bin, |d| p50/p95/max; wave-centroid d per bin (the mean
// of the wave's free Wicks in that bin = the dip the eye reads); count of heading reversals > 90 deg vs road tangent.
import { createSim, worldOf } from '../src/sim/sim.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import { attackable } from '../src/sim/attack.ts';
import { ORDER_ATTACK, type Entity } from '../src/sim/entity.ts';
import type { World } from '../src/sim/world.ts';
import type { CatalogT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup } from '../src/contracts/sim.ts';
import { minionState } from '../src/sim/units/minions.ts';
import { behaviorOf } from '../src/sim/units/common.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const argv = process.argv.slice(2);
const opt = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const SEEDS = opt('seeds', '3,7,11').split(',').map(Number);
const MINUTES = Number(opt('minutes', '6'));
const MODES = opt('mode', 'base,dense').split(',');
const BOTS = opt('bots', '0') === '1';
const SEG = 4;

function loadCatalog(): CatalogT {
  const r = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
  if (!r.catalog) { console.error('content build failed'); process.exit(77); }
  return r.catalog;
}
function lineup(catalog: CatalogT, seed: number): MatchSetup {
  const mode = catalog.modes.find((m) => m.id === 'rift')!;
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
    seats.push({ player: i, team, name: catalog.botNames[i % catalog.botNames.length], fighter, skin, role, loadout: pickLoadout(catalog, fighter, mode.rules.itemPool ?? '', role), controller: 'bot', botDifficulty: 'adept', colorIndex: i } as SeatSetup);
  }
  return { matchId: `wobblecf-${seed}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}

type P = [number, number];
interface G { id: string; pts: P[]; cum: number[] }
const geom = (w: World): G[] => w.mapDef.lanes.map((l) => {
  const pts = l.path.map((p) => [p[0], p[1]] as P); const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { id: l.id, pts, cum };
});
function project(g: G, x: number, y: number): { s: number; d: number; tx: number; ty: number } {
  let bd = Infinity, s = 0, ox = 0, oy = 0, tx = 1, ty = 0;
  for (let i = 1; i < g.pts.length; i++) {
    const [ax, ay] = g.pts[i - 1], [bx, by] = g.pts[i]; const abx = bx - ax, aby = by - ay, L2 = abx * abx + aby * aby, L = Math.sqrt(L2);
    const t = Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / L2)); const qx = ax + abx * t, qy = ay + aby * t;
    const dd = (x - qx) ** 2 + (y - qy) ** 2;
    if (dd < bd) { bd = dd; s = g.cum[i - 1] + t * L; ox = x - qx; oy = y - qy; tx = abx / L; ty = aby / L; }
  }
  const dist = Math.sqrt(bd);
  return { s, d: (tx * oy - ty * ox) >= 0 ? dist : -dist, tx, ty };   // + = +y side on the top road = screen DOWN
}
function densify(path: readonly (readonly [number, number])[]): P[] {
  const out: P[] = [[path[0][0], path[0][1]]];
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i]; const L = Math.hypot(bx - ax, by - ay); const n = Math.max(1, Math.round(L));
    for (let k = 1; k <= n; k++) out.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
  }
  return out;
}
const q: Entity[] = [];
function free(w: World, e: Entity): boolean {
  const m = minionState(e) as unknown as { chasing: boolean; flankUntil: number };
  if (e.order === ORDER_ATTACK || m.chasing || w.tick < m.flankUntil) return false;
  const aggro = behaviorOf(e.unit!).aggroRange;
  const n = w.query(e.x, e.y, aggro + 6, q);
  for (let i = 0; i < n; i++) {
    const o = q[i];
    if (!o.alive || o === e || o.kind === 'projectile' || o.kind === 'zone' || o.kind === 'ward' || o.kind === 'pickup') continue;
    const gap = Math.hypot(o.x - e.x, o.y - e.y) - o.radius;
    if (o.kind === 'structure' && gap < 3) return false;
    if (o.team !== e.team && gap <= aggro && attackable(w, e, o)) return false;
  }
  return true;
}
const pct = (a: number[], p: number): number => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const catalog = loadCatalog();
for (const mode of MODES) {
  const bins = new Map<string, number[]>();               // lane|team|seg -> |d| of free Wick samples
  const cent = new Map<string, Map<string, number[]>>();  // lane|team|seg -> wave key -> d samples (signed)
  let rev = 0, revAt = '', freeN = 0;
  for (const seed of SEEDS) {
    const setup = lineup(catalog, seed);
    const sim = createSim(catalog, setup, { bots: BOTS ? createBots(catalog, setup) : () => null, pregameSeconds: 0 });
    const lanes = geom(worldOf(sim));
    const tr = new Map<number, { lane: number; wave: number; ph: number; x: number; y: number }>();
    for (let tick = 0; tick < MINUTES * 1800 && sim.view.phase !== 'ended'; tick++) {
      sim.step();
      const w = worldOf(sim);
      for (const e of w.entities) {
        if (e.kind !== 'minion' || !e.alive || !e.unit) continue;
        const m = minionState(e) as unknown as { path: P[]; wp: number } | undefined;
        if (!m) continue;
        let t = tr.get(e.id);
        if (!t) {
          const p0 = m.path[0], pe = m.path[m.path.length - 1];
          const lane = lanes.findIndex((g) => { const a = g.pts[0], b = g.pts[g.pts.length - 1]; return (a[0] === p0[0] && a[1] === p0[1] && b[0] === pe[0] && b[1] === pe[1]) || (a[0] === pe[0] && a[1] === pe[1] && b[0] === p0[0] && b[1] === p0[1]); });
          t = { lane, wave: Math.round(w.time / 5), ph: NaN, x: e.x, y: e.y }; tr.set(e.id, t);
          if (mode === 'dense' && lane >= 0) { const dp = densify(m.path); const wpPt = m.path[m.wp]; m.path = dp; m.wp = dp.findIndex((p) => Math.abs(p[0] - wpPt[0]) < 1e-9 && Math.abs(p[1] - wpPt[1]) < 1e-9); }
        }
        const lx = t.x, ly = t.y; t.x = e.x; t.y = e.y;
        if (t.lane < 0 || lanes[t.lane].id === 'road_seat') continue;
        if (!free(w, e)) { t.ph = NaN; continue; }
        const g = lanes[t.lane]; const pr = project(g, e.x, e.y);
        if (pr.s < 6 || pr.s > g.cum[g.cum.length - 1] - 6) continue;
        freeN++;
        const k = `${g.id}|${e.team}|${Math.floor(pr.s / SEG) * SEG}`;
        let b = bins.get(k); if (!b) bins.set(k, b = []); b.push(Math.abs(pr.d));
        let c = cent.get(k); if (!c) cent.set(k, c = new Map()); const wk = `${seed}/${t.wave}`; let cw = c.get(wk); if (!cw) c.set(wk, cw = []); cw.push(pr.d);
        // heading vs travel direction along the road (team 1 walks the polyline backwards)
        const vx = e.x - lx, vy = e.y - ly;
        const sp = Math.hypot(vx, vy);
        if (Number.isFinite(sp) && sp > 0.02) {
          const dir = e.team === 1 ? -1 : 1; const cos = (vx * pr.tx + vy * pr.ty) * dir / sp;
          if (cos < 0) { rev++; if (!revAt) revAt = `${g.id} t${e.team} s${pr.s.toFixed(1)} seed${seed} ${w.time.toFixed(1)}s #${e.id}`; }
        }
      }
    }
  }
  // report
  console.log(`\n=== mode ${mode}  seeds ${SEEDS.join(',')}  ${MINUTES} min  bots ${BOTS ? 1 : 0}  free samples ${freeN}  reversals>90deg ${rev} ${revAt}`);
  const keys = [...bins.keys()].sort((a, b) => { const [la, ta, sa] = a.split('|'), [lb, tb, sb] = b.split('|'); return la.localeCompare(lb) || +ta - +tb || +sa - +sb; });
  let worstP95 = 0, worstMax = 0, worstCent = 0, worstK = '', worstCK = '';
  const lines: string[] = [];
  for (const k of keys) {
    const b = bins.get(k)!; if (b.length < 200) continue;
    const p95 = pct(b, 0.95), mx = Math.max(...b);
    const cs = [...cent.get(k)!.values()].filter((v) => v.length >= 15).map((v) => v.reduce((x, y) => x + y, 0) / v.length);
    const cMax = cs.length ? Math.max(...cs.map(Math.abs)) : NaN, cMed = pct(cs, 0.5);
    if (p95 > worstP95) { worstP95 = p95; worstK = k; }
    worstMax = Math.max(worstMax, mx);
    if (cMax > worstCent) { worstCent = cMax; worstCK = k; }
    const [ln, tm, s] = k.split('|');
    if (opt('all', '0') === '1' || (ln === 'road_high' && ((tm === '0' && +s <= 60) || (tm === '1' && +s >= 108)))) lines.push(`  ${k.padEnd(18)} n ${String(b.length).padStart(6)}  |d| p50 ${pct(b, 0.5).toFixed(2)} p95 ${p95.toFixed(2)} max ${mx.toFixed(2)}  wave-centroid d med ${cMed.toFixed(2)} max|.| ${cMax.toFixed(2)} (${cs.length} waves)`);
  }
  console.log(lines.join('\n'));
  console.log(`  WORST over all side-lane bins: |d| p95 ${worstP95.toFixed(2)} (${worstK}), max ${worstMax.toFixed(2)}, wave-centroid |d| ${worstCent.toFixed(2)} (${worstCK})`);
}
