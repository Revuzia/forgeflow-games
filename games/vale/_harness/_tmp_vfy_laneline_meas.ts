// VERIFIER (laneline r1, no src edits): independent measure of the ruling-47 lane-line bars, simpler exclusions than
// probe_sim_minion_lane_line.ts (no "settling", no "own held Wick" exclusions).
//   node _harness/_tmp_vfy_laneline_meas.ts [--maps rift,bridge] [--seeds 3,7,11,19,23,31] [--scen idle,bots] [--idle-min 8] [--bots-min 14]
// free  : order not ATTACK, not chasing, not stepping out (tick < flankUntil), no attackable enemy within aggro
// clear : > 3 m from any live structure rim, > 3 m from any live body that is not a Wick of its own team; arc > 16 m from
//         its spawn end and > 6 m from the far end
// off   : signed lateral offset from the lane polyline minus its column slot (slot 0 when the build has none)
// Per map|lane|team|4 m bin: wave centroid (mean off of one wave's free+clear Wicks, waves of >= 2 Wicks, >= 15 samples):
// median |.| and max |.|; single Wick |off| p95 / max; reversals: free+clear Wick whose 15-tick net move along its travel
// direction is < -0.3 m.
import type { CatalogT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup } from '../src/contracts/sim.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import { createSim, worldOf } from '../src/sim/sim.ts';
import { attackable } from '../src/sim/attack.ts';
import { ORDER_ATTACK, type Entity } from '../src/sim/entity.ts';
import type { World } from '../src/sim/world.ts';
import { minionState } from '../src/sim/units/minions.ts';
import { behaviorOf } from '../src/sim/units/common.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const argv = process.argv.slice(2);
const opt = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const MAPS = opt('maps', 'rift,bridge').split(',');
const SEEDS = opt('seeds', '3,7,11,19,23,31').split(',').map(Number);
const SCENS = opt('scen', 'idle,bots').split(',');
const IDLE_MIN = Number(opt('idle-min', '8')), BOTS_MIN = Number(opt('bots-min', '14'));
const SEG = 4;
const STRICT = opt('strict', '0') === '1';
const r = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
if (!r.catalog) { console.error('content build failed'); process.exit(77); }
const catalog: CatalogT = r.catalog;

function lineup(modeId: string, seed: number, bots: boolean): MatchSetup {
  const mode = catalog.modes.find((m) => m.id === modeId)!;
  const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id)!;
  const roles = catalog.roles.filter((x) => x.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0)).map((x) => x.id);
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
  void bots;
  return { matchId: `vfyll-${modeId}-${seed}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}
type P = [number, number];
interface G { id: string; pts: P[]; cum: number[]; len: number }
const geom = (w: World): G[] => w.mapDef.lanes.map((l) => {
  const pts = l.path.map((p) => [p[0], p[1]] as P); const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { id: l.id, pts, cum, len: cum[cum.length - 1] };
});
function project(g: G, x: number, y: number): { s: number; d: number; tx: number; ty: number } {
  let bd = Infinity, s = 0, ox = 0, oy = 0, tx = 1, ty = 0;
  for (let i = 1; i < g.pts.length; i++) {
    const [ax, ay] = g.pts[i - 1], [bx, by] = g.pts[i]; const abx = bx - ax, aby = by - ay, L2 = abx * abx + aby * aby, L = Math.sqrt(L2);
    if (L2 < 1e-12) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby) / L2)); const qx = ax + abx * t, qy = ay + aby * t;
    const dd = (x - qx) ** 2 + (y - qy) ** 2;
    if (dd < bd) { bd = dd; s = g.cum[i - 1] + t * L; ox = x - qx; oy = y - qy; tx = abx / L; ty = aby / L; }
  }
  const dist = Math.sqrt(bd);
  return { s, d: (tx * oy - ty * ox) >= 0 ? dist : -dist, tx, ty };
}
const q: Entity[] = [];
function freeClear(w: World, e: Entity): [boolean, boolean] {
  const m = minionState(e) as unknown as { chasing: boolean; flankUntil: number };
  if (e.order === ORDER_ATTACK || m.chasing || w.tick < m.flankUntil) return [false, false];
  const aggro = behaviorOf(e.unit!).aggroRange;
  const n = w.query(e.x, e.y, aggro + 6, q);
  let clear = true;
  for (let i = 0; i < n; i++) {
    const o = q[i];
    if (!o.alive || o === e || o.kind === 'projectile' || o.kind === 'zone' || o.kind === 'ward' || o.kind === 'pickup') continue;
    const gap = Math.hypot(o.x - e.x, o.y - e.y) - o.radius;
    if (o.team !== e.team && gap <= aggro && attackable(w, e, o)) return [false, false];
    if (gap < 3 && !(o.kind === 'minion' && o.team === e.team)) clear = false;
  }
  return [true, clear];
}
const pct = (a: number[], p: number): number => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

for (const scen of SCENS) for (const map of MAPS) {
  const bins = new Map<string, number[]>();
  const cent = new Map<string, Map<string, { s: number; n: number; ids: Set<number> }>>();
  let rev = 0; const revAt: string[] = []; let freeN = 0;
  const mins = scen === 'idle' ? IDLE_MIN : BOTS_MIN;
  for (const seed of SEEDS) {
    const setup = lineup(map, seed, scen === 'bots');
    const sim = createSim(catalog, setup, { bots: scen === 'bots' ? createBots(catalog, setup) : () => null, pregameSeconds: 0 });
    const lanes = geom(worldOf(sim));
    const tr = new Map<number, { lane: number; dir: number; wave: number; hist: { x: number; y: number; ok: boolean }[] }>();
    for (let tick = 0; tick < mins * 1800 && sim.view.phase !== 'ended'; tick++) {
      sim.step();
      const w = worldOf(sim);
      for (const e of w.entities) {
        if (e.kind !== 'minion' || !e.alive || !e.unit) continue;
        const m = minionState(e) as unknown as { path: P[]; slot?: number } | undefined;
        if (!m || m.path.length < 3) continue;
        let t = tr.get(e.id);
        if (!t) {
          const p0 = m.path[0], pe = m.path[m.path.length - 1];
          let lane = -1, dir = 1;
          lanes.forEach((g, k) => { const a = g.pts[0], b = g.pts[g.pts.length - 1];
            if (a[0] === p0[0] && a[1] === p0[1] && b[0] === pe[0] && b[1] === pe[1]) { lane = k; dir = 1; }
            else if (a[0] === pe[0] && a[1] === pe[1] && b[0] === p0[0] && b[1] === p0[1]) { lane = k; dir = -1; } });
          t = { lane, dir, wave: Math.round(w.time / 5), hist: [] }; tr.set(e.id, t);
        }
        if (t.lane < 0) continue;
        const g = lanes[t.lane];
        const [fr, cl] = freeClear(w, e);
        const pr = project(g, e.x, e.y);
        const arcFromSpawn = t.dir > 0 ? pr.s : g.len - pr.s;
        const ok = fr && cl && arcFromSpawn > 16 && arcFromSpawn < g.len - 6;
        t.hist.push({ x: e.x, y: e.y, ok }); if (t.hist.length > 16) t.hist.shift();
        if (!ok) continue;
        // STRICT (--strict 1): only a Wick actually walking (net 0.5 s move >= 0.8 x its walk speed) - not queued behind its wave
        if (STRICT) { if (t.hist.length < 16) continue; const h0 = t.hist[0]; if (Math.hypot(e.x - h0.x, e.y - h0.y) < 0.8 * e.stats.moveSpeed * 0.5) continue; }
        // d is + left of the polyline's own direction; the slot is + left of the Wick's travel
        const dTravel = pr.d * t.dir;
        const off = dTravel - (m.slot ?? 0);
        freeN++;
        const k = `${g.id}|${e.team}|${Math.floor(pr.s / SEG) * SEG}`;
        let b = bins.get(k); if (!b) bins.set(k, b = []); b.push(Math.abs(off));
        let c = cent.get(k); if (!c) cent.set(k, c = new Map()); const wk = `${seed}/${t.wave}`; let cw = c.get(wk); if (!cw) c.set(wk, cw = { s: 0, n: 0, ids: new Set() });
        cw.s += off; cw.n++; cw.ids.add(e.id);
        if (t.hist.length === 16 && t.hist.every((h) => h.ok)) {
          const h0 = t.hist[0], vx = e.x - h0.x, vy = e.y - h0.y;
          const along = (vx * pr.tx + vy * pr.ty) * t.dir;
          if (along < -0.3) { rev++; if (revAt.length < 5) revAt.push(`${g.id} t${e.team} s${pr.s.toFixed(1)} seed${seed} ${w.time.toFixed(1)}s #${e.id} along ${along.toFixed(2)}`); }
        }
      }
    }
  }
  console.log(`\n=== ${STRICT ? 'STRICT ' : ''}${scen} ${map} seeds ${SEEDS.join(',')} ${mins} min  free+clear samples ${freeN}  reversals ${rev} ${revAt.join(' | ')}`);
  const keys = [...bins.keys()].sort((a, b) => { const [la, ta, sa] = a.split('|'), [lb, tb, sb] = b.split('|'); return la.localeCompare(lb) || +ta - +tb || +sa - +sb; });
  const worst = new Map<string, { cMed: number; cMedK: string; cMax: number; cMaxK: string; p95: number; p95K: string; mx: number; mxK: string; n: number; over12: number }>();
  for (const k of keys) {
    const b = bins.get(k)!; if (b.length < 100) continue;
    const [ln, tm] = k.split('|'); const lk = `${ln} t${tm}`;
    let W = worst.get(lk); if (!W) worst.set(lk, W = { cMed: 0, cMedK: '', cMax: 0, cMaxK: '', p95: 0, p95K: '', mx: 0, mxK: '', n: 0, over12: 0 });
    const p95 = pct(b, 0.95), mx = Math.max(...b);
    const cs = [...cent.get(k)!.values()].filter((v) => v.n >= 15 && v.ids.size >= 2).map((v) => Math.abs(v.s / v.n));
    const cMed = pct(cs, 0.5), cMax = cs.length ? Math.max(...cs) : 0;
    W.n += b.length; W.over12 += b.filter((x) => x > 1.2).length;
    if (cMed > W.cMed) { W.cMed = cMed; W.cMedK = k; }
    if (cMax > W.cMax) { W.cMax = cMax; W.cMaxK = k; }
    if (p95 > W.p95) { W.p95 = p95; W.p95K = k; }
    if (mx > W.mx) { W.mx = mx; W.mxK = k; }
  }
  for (const [lk, W] of worst) console.log(`  ${lk.padEnd(14)} n ${W.n}  centroid worst-bin median ${W.cMed.toFixed(3)} (${W.cMedK}) max ${W.cMax.toFixed(3)} (${W.cMaxK})  single p95 ${W.p95.toFixed(3)} (${W.p95K}) max ${W.mx.toFixed(3)} (${W.mxK}) samples>1.2m ${W.over12}`);
}
