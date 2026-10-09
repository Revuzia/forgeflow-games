// GENESIS — lookdev LIFE: a fabricator of peoples, settlements, buildings and herds for the render-dev world
// (`?source=lookdev`), so the life visuals can be developed and photographed without the sim (CONTRACT.md §15.6).
//
// It writes into the lookdev home world's fields (road wear, farmland, the wildfire and its scar) and serves the same
// snapshot blocks the sim will: SettlementView[], a BuildingBlock and MoverBlocks for agents and animals, all indexed by
// the CONTENT registries (src/data via render/life/catalog.ts), never by private numbers.
//
//   * a stone-age camp at a forest edge by water: tents, lean-tos, a hearth circle, a totem;
//   * a bronze-age village by a river: thatched huts, mudbrick houses, granaries, kilns, a furnace, pens, a ziggurat;
//   * an iron-age town: stone and timber houses on streets, a market, forges, a library, a columned temple, and a
//     stone wall with towers (the renderer turns wall segments crossed by streets into gatehouses);
//   * an early-industrial port city: brick houses and tenements, factories with stacks, a cathedral, a domed library,
//     a market hall, docks with boats, a shipyard and a lighthouse on the coast;
//   * a burning hamlet beside a forest on fire (burning and ruined houses, people fleeing), a hive colony, and a
//     scatter of hamlets of every era (night lights from orbit).
// Streets come from the same road-network extraction the renderer's ribbon roads use (render/life/roadnet.ts), so
// houses line the drawn streets. About 3 000 people walk, carry, work, farm, chop, build, fish, pray, trade, play,
// sit, sleep and flee; herds graze, packs roam, flocks circle, shoals swim, a locust swarm hangs over a field.
// Motion is analytic in the tick (frozen when paused), like the sim's movers.

import type { BuildingBlock, FieldName, MoverBlock, SettlementView } from '../sim/types.ts';
import { AgentFlag, AnimState, BuildingFlag } from '../sim/types.ts';
import type { IcoGrid } from '../sim/grid/icogrid.ts';
import { Rng, hashFloat } from '../sim/core/rng.ts';
import {
  animalIndex, buildingAt, buildingIndex, itemIndex, lightKindForEra, materialIndex, speciesAt, speciesIndex,
} from '../render/life/catalog.ts';
import { extractRoads, roadWidth, type RoadChain } from '../render/life/roadnet.ts';

type Fields = Partial<Record<FieldName, Float32Array>>;
type V3 = [number, number, number];

export interface LifeWorld {
  g: IcoGrid;
  R: number;
  f: Fields;
  /** terrain height (surface) per cell */
  h: Float32Array;
  slope: Float32Array;
  distOcean: Float32Array;
  distWater: Float32Array;
  riverCell: Uint8Array;
  seed: number;
}

type SiteKind = 'camp' | 'village' | 'town' | 'city' | 'burning' | 'hive' | 'hamlet';

interface Frame { c: V3; e: V3; n: V3 }

interface Site {
  id: number;
  kind: SiteKind;
  cell: number;
  frame: Frame;
  era: string;
  radius: number;
  name: string;
  species: number;
  alignment: number;
  chains: Chain2[];
  buildings: number[];
  population: number;
  agents: number;
}

/** a road chain in a settlement's local plane (metres) with cumulative length */
interface Chain2 { x: number[]; z: number[]; s: number[]; wear: number[]; len: number }

interface Bld {
  x: number; z: number; site: Site; dir: V3;
  type: number; mat: number; style: number; rot: number; scale: number;
  progress: number; damage: number; flags: number; light: number; r: number; w: number; d: number;
}

/** agent motion models */
interface Agent {
  site: Site;
  species: number;
  /** 0 stand, 1 walk a chain range (ping-pong), 2 circle, 3 line back and forth */
  mode: number;
  x: number; z: number;          // stand / circle centre / line start (local m)
  x2: number; z2: number;        // line end
  chain: Chain2 | null; s0: number; s1: number; lane: number;
  radius: number;
  speed: number;                 // m / tick
  heading: number;               // stand heading (local, rad from north toward east)
  anim: number; animMove: number;
  phase: number; flags: number; carry: number; scale: number; tint: number; id: number; group: number; alt: number;
  /** a stander's unit position, computed once */
  cached?: V3;
}

interface Herd {
  species: number; cx: number; cz: number; site: Site; radius: number; members: number; drift: number;
  kind: 'graze' | 'pack' | 'flock' | 'shoal' | 'swarm' | 'pen' | 'solo';
  alt: number; speed: number; seed: number; tint: number; group: number;
}

const ERA_CLOTH: Record<string, number[]> = {
  stone: [0x6e5236, 0x8a6a4a, 0x5a4430, 0x7a5c3c],
  clay: [0xb8a888, 0x8a6a4a, 0xa0784e, 0xc8b898],
  bronze: [0xc8b898, 0xa04a2a, 0xb8a888, 0x8a6a4a, 0x3a5a7a, 0xd0c4a8],
  iron: [0x7a2a22, 0x2a4a6a, 0xc0b498, 0x4a5a2a, 0x8a6a3a, 0x6a3a5a],
  medieval: [0x6a1e1a, 0x1e3a5a, 0x3a4a22, 0xb0a080, 0x5a3a20, 0x8a7a40],
  steam: [0x2a2a2e, 0x3a3228, 0x1e2a3a, 0x5a4a3a, 0x6a6a62, 0x7a2222, 0xc8c0b0],
  electric: [0x2a3a5a, 0x5a5a5e, 0x8a3a2a, 0xd0c8b8, 0x2a4a3a, 0x9a8a5a],
};

const NAMES = ['Aru', 'Kesh by the Falls', 'Temuun', 'Old Varrow', 'Saltmouth', 'Embersfield', 'the Comb', 'Lio', 'Hesh', 'Ombra',
  'Tarn', 'Ravel', 'Uskar', 'Mir by the Ford', 'Pell', 'Gorrin', 'Ystad', 'Calder', 'Nimh', 'Brask', 'Odo', 'Vey'];

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export class LookdevLife {
  readonly settlements: SettlementView[] = [];
  buildings: BuildingBlock;
  private agents: MoverBlock;
  private animals: MoverBlock;
  private agentList: Agent[] = [];
  private herds: Herd[] = [];
  private herdIndex: { herd: Herd; k: number }[] = [];
  private sites: Site[] = [];
  private blds: Bld[] = [];
  private w: LifeWorld;
  private rng: Rng;
  private lastBuildTick = -1e9;

  constructor(w: LifeWorld) {
    this.w = w;
    this.rng = new Rng(w.seed * 31 + 7);
    this.pickSites();
    for (const s of this.sites) this.streets(s);
    this.interRoads();
    for (const s of this.sites) {
      const near = w.g.cellsWithin(s.frame.c[0], s.frame.c[1], s.frame.c[2], (s.radius + 140) / w.R).slice();
      const chains = extractRoads(w.g, w.f.road!, near, w.R, 0.6, 2);
      s.chains = chains.map((c) => this.chainLocal(s, c)).filter((c) => c.len > 4);
    }
    for (const s of this.sites) this.layout(s);
    this.fields();
    this.buildings = this.makeBuildingBlock();
    for (const s of this.sites) this.people(s);
    this.wildlife();
    this.agents = this.makeMovers(this.agentList.length);
    this.animals = this.makeMovers(this.herdIndex.length);
    for (const s of this.sites) {
      const lightK = lightKindForEra(eraIdx(s.era));
      this.settlements.push({
        id: s.id, name: s.name, species: s.species, pos: [...s.frame.c], population: s.population, agents: s.agents,
        cohort: Math.max(0, s.population - s.agents), alignment: s.alignment, belief: 0.4 + 0.4 * hashFloat(s.id, 3), god: 0,
        era: s.era, color: [0xa04030, 0x3060a0, 0xc09030, 0x408050, 0x804090][s.id % 5], polity: s.id, language: s.id,
        nightLight: Math.min(1, 0.25 + lightK * 0.18), knowledgeCount: 5 + eraIdx(s.era) * 9, flags: 0,
      });
    }
  }

  // ───────────────────────────── geometry helpers ─────────────────────────────

  private frameAt(c: number): Frame {
    const P = this.w.g.pos;
    const p: V3 = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
    let ex = p[2], ez = -p[0];
    const el = Math.hypot(ex, ez) || 1;
    ex /= el; ez /= el;
    const e: V3 = [ex, 0, ez];
    const n: V3 = [p[1] * ez, p[2] * ex - p[0] * ez, -p[1] * ex];
    return { c: p, e, n };
  }
  private toDir(f: Frame, x: number, z: number): V3 {
    const R = this.w.R;
    const dx = f.c[0] + (f.e[0] * x + f.n[0] * z) / R, dy = f.c[1] + (f.e[1] * x + f.n[1] * z) / R, dz = f.c[2] + (f.e[2] * x + f.n[2] * z) / R;
    const l = Math.hypot(dx, dy, dz);
    return [dx / l, dy / l, dz / l];
  }
  private toLocal(f: Frame, d: ArrayLike<number>): [number, number] {
    const R = this.w.R;
    const k = 1 / Math.max(1e-6, d[0] * f.c[0] + d[1] * f.c[1] + d[2] * f.c[2]);
    // gnomonic projection onto the tangent plane (straight lines stay straight)
    const px = d[0] * k - f.c[0], py = d[1] * k - f.c[1], pz = d[2] * k - f.c[2];
    return [(px * f.e[0] + py * f.e[1] + pz * f.e[2]) * R, (px * f.n[0] + py * f.n[1] + pz * f.n[2]) * R];
  }
  private sample(name: FieldName, d: V3): number {
    const a = this.w.f[name];
    return a ? this.w.g.sample(a, d[0], d[1], d[2]) : 0;
  }
  /** heading (rad from north toward east) of local direction (dx east, dz north) */
  private static heading(dx: number, dz: number): number { return Math.atan2(dx, dz); }

  // ───────────────────────────── sites ─────────────────────────────

  private pickSites(): void {
    const { g, R, h, slope, distOcean, distWater, f } = this.w;
    const N = g.count;
    const T = f.temperature!, M = f.moisture!, W = f.water!, TR = f.tree!;
    const P = g.pos;
    const taken: number[] = [];
    const farFrom = (c: number, minM: number) => taken.every((t) => Math.acos(Math.min(1, P[c * 3] * P[t * 3] + P[c * 3 + 1] * P[t * 3 + 1] + P[c * 3 + 2] * P[t * 3 + 2])) * R > minM);
    // slope over LAND only: a coastal cell's drop to the sea floor is not a hillside
    const landSlope = (c: number) => {
      let m = 0;
      for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) { const o = g.nbr[e]; if (W[o] < 0.3) m = Math.max(m, Math.abs(h[o] - h[c])); }
      return m / (g.meanEdgeAngle * R);
    };
    const flatAround = (c: number, rM: number) => {
      let s = 0, k = 0, wet = 0, n = 0;
      for (const o of g.cellsWithin(P[c * 3], P[c * 3 + 1], P[c * 3 + 2], rM / R)) { n++; if (W[o] > 0.3) { wet++; continue; } s += landSlope(o); k++; }
      return { slope: s / Math.max(1, k), wet: wet / Math.max(1, n) };
    };
    const best = (score: (c: number) => number, minSep: number): number => {
      let bc = -1, bs = -Infinity;
      for (let c = 0; c < N; c += 1) {
        if (h[c] < 1.5 || W[c] > 0.15) continue;
        const sc = score(c);
        if (sc > bs && farFrom(c, minSep)) { bs = sc; bc = c; }
      }
      if (bc >= 0) taken.push(bc);
      return bc;
    };
    const temperate = (c: number) => (T[c] > 5 && T[c] < 27 ? 1 : 0);
    // the city: a coast with flat land behind it, near a river mouth if possible
    const city = best((c) => {
      if (!temperate(c) || distOcean[c] > 2 || h[c] > 40 || landSlope(c) > 0.2) return -Infinity;
      const a = flatAround(c, 260);
      if (a.wet > 0.55 || a.wet < 0.05) return -Infinity;
      return -a.slope * 30 + (distWater[c] <= 1 ? 1 : 0) + (1 - Math.abs(g.lat[c]) / 1.2) * 2 - Math.abs(a.wet - 0.25) * 4;
    }, 800);
    const town = best((c) => {
      if (!temperate(c) || distWater[c] > 2 || distOcean[c] < 3 || landSlope(c) > 0.18 || h[c] > 140) return -Infinity;
      const a = flatAround(c, 200);
      if (a.slope > 0.22 || a.wet > 0.25) return -Infinity;
      return -a.slope * 30 + (1 - Math.abs(g.lat[c]) / 1.2) * 2 + hashFloat(c, 5) * 0.5;
    }, 900);
    const village = best((c) => {
      if (!temperate(c) || distWater[c] > 2 || landSlope(c) > 0.2 || h[c] > 150) return -Infinity;
      const a = flatAround(c, 140);
      if (a.slope > 0.24 || a.wet > 0.3) return -Infinity;
      return -a.slope * 20 + M[c] + hashFloat(c, 7) * 0.5;
    }, 800);
    const camp = best((c) => {
      if (T[c] < 3 || T[c] > 28 || distWater[c] > 3 || slope[c] > 0.2) return -Infinity;
      let trees = 0;
      for (const o of g.cellsWithin(P[c * 3], P[c * 3 + 1], P[c * 3 + 2], 160 / R)) trees += TR[o];
      return -Math.abs(trees / 9 - 0.45) * 4 - slope[c] * 8 + hashFloat(c, 9) * 0.3 - (TR[c] > 0.5 ? 2 : 0);
    }, 700);
    const burning = best((c) => {
      if (T[c] < 4 || T[c] > 28 || slope[c] > 0.18 || TR[c] > 0.35) return -Infinity;
      let trees = 0;
      for (const o of g.cellsWithin(P[c * 3], P[c * 3 + 1], P[c * 3 + 2], 140 / R)) trees += TR[o];
      return trees * 0.3 - slope[c] * 5 + hashFloat(c, 11) * 0.3;
    }, 700);
    const hive = best((c) => {
      if (T[c] < 14 || M[c] > 0.42 || slope[c] > 0.18) return -Infinity;
      return (0.42 - M[c]) * 4 + hashFloat(c, 13) * 0.3;
    }, 600);
    const sites: [number, SiteKind, string, number][] = [
      [city, 'city', 'steam', 300], [town, 'town', 'iron', 210], [village, 'village', 'bronze', 120],
      [camp, 'camp', 'stone', 40], [burning, 'burning', 'medieval', 70], [hive, 'hive', 'stone', 60],
    ];
    // hamlets of every era scattered over the land (lights on the night side)
    const hamletEras = ['clay', 'bronze', 'iron', 'classical', 'medieval', 'gunpowder', 'steam', 'electric', 'medieval', 'iron', 'electric', 'classical', 'steam', 'gunpowder'];
    for (let i = 0; i < hamletEras.length; i++) {
      const c = best((cc) => {
        if (T[cc] < 2 || T[cc] > 30 || slope[cc] > 0.2 || h[cc] > 180) return -Infinity;
        return hashFloat(cc, 17 + i) + (distWater[cc] <= 2 ? 0.4 : 0) + (distOcean[cc] <= 3 ? 0.3 : 0);
      }, 380);
      if (c >= 0) sites.push([c, 'hamlet', hamletEras[i], 55]);
    }
    let id = 0;
    for (const [c, kind, era, radius] of sites) {
      if (c < 0) continue;
      this.sites.push({
        id: id, kind, cell: c, frame: this.frameAt(c), era, radius, name: NAMES[id % NAMES.length],
        species: kind === 'hive' ? speciesIndex('hive') : speciesIndex('plains-folk'),
        alignment: kind === 'burning' ? -0.2 : kind === 'town' && id % 2 ? -0.5 : 0.2 + 0.5 * hashFloat(c, 19),
        chains: [], buildings: [], population: 0, agents: 0,
      });
      id++;
    }
  }

  // ───────────────────────────── streets ─────────────────────────────

  /** step from cell `c` along local heading (dx, dz) of the site frame */
  private stepToward(c: number, f: Frame, dx: number, dz: number): number {
    const g = this.w.g, P = g.pos;
    let best = -1, bd = -Infinity;
    const cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2];
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const o = g.nbr[e];
      const vx = P[o * 3] - cx, vy = P[o * 3 + 1] - cy, vz = P[o * 3 + 2] - cz;
      const ve = vx * f.e[0] + vy * f.e[1] + vz * f.e[2], vn = vx * f.n[0] + vy * f.n[1] + vz * f.n[2];
      const d = (ve * dx + vn * dz) / (Math.hypot(ve, vn) || 1);
      if (d > bd) { bd = d; best = o; }
    }
    return best;
  }

  private mark(c: number, v: number): void {
    const road = this.w.f.road!;
    if (this.w.f.water![c] > 0.3) return;
    road[c] = Math.max(road[c], v);
  }

  /** street plan in cells: spokes and rings; the worn ground of the settlement around them */
  private streets(s: Site): void {
    const g = this.w.g, f = s.frame;
    const road = this.w.f.road!;
    const P = g.pos;
    const area = g.cellsWithin(f.c[0], f.c[1], f.c[2], s.radius / this.w.R).slice();
    const worn = s.kind === 'camp' || s.kind === 'hive' ? 0.42 : 0.4;
    for (const c of area) if (this.w.f.water![c] < 0.3) road[c] = Math.max(road[c], worn);
    const plan: Record<SiteKind, { spokes: number; len: number; rings: number[]; main: number }> = {
      camp: { spokes: 0, len: 0, rings: [], main: 0.5 },
      hive: { spokes: 0, len: 0, rings: [], main: 0.5 },
      hamlet: { spokes: 2, len: 2, rings: [], main: 0.72 },
      burning: { spokes: 2, len: 2, rings: [], main: 0.72 },
      village: { spokes: 3, len: 3, rings: [], main: 0.8 },
      town: { spokes: 4, len: 5, rings: [2], main: 0.92 },
      city: { spokes: 6, len: 7, rings: [2, 4], main: 0.95 },
    };
    const pl = plan[s.kind];
    const a0 = hashFloat(s.cell, 23) * Math.PI * 2;
    for (let k = 0; k < pl.spokes; k++) {
      const a = a0 + (k / pl.spokes) * Math.PI * 2 + (s.kind === 'hamlet' || s.kind === 'burning' ? (k ? Math.PI * 0.9 - Math.PI : 0) : 0);
      let c = s.cell;
      this.mark(c, pl.main);
      for (let i = 0; i < pl.len; i++) {
        c = this.stepToward(c, f, Math.sin(a), Math.cos(a));
        if (c < 0) break;
        this.mark(c, pl.main - 0.04 * i);
      }
    }
    // rings: the cells at a graph distance, joined around
    for (const rk of pl.rings) {
      const dist = new Map<number, number>([[s.cell, 0]]);
      let frontier = [s.cell];
      for (let d = 1; d <= rk; d++) {
        const next: number[] = [];
        for (const c of frontier) for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
          const o = g.nbr[e];
          if (!dist.has(o)) { dist.set(o, d); next.push(o); }
        }
        frontier = next;
      }
      for (const c of frontier) this.mark(c, 0.8);
      void P;
    }
  }

  /** roads between the settlements (trails for the small ones, broad roads between the towns) */
  private interRoads(): void {
    const pairs: [SiteKind, SiteKind, number][] = [['city', 'town', 0.88], ['town', 'village', 0.8], ['village', 'camp', 0.62], ['town', 'burning', 0.7], ['village', 'hamlet', 0.66]];
    for (const [a, b, v] of pairs) {
      const sa = this.sites.find((s) => s.kind === a);
      // the nearest site of kind b
      let sb: Site | undefined;
      let bd = Infinity;
      for (const s of this.sites) {
        if (s.kind !== b || !sa) continue;
        const d = Math.acos(Math.min(1, s.frame.c[0] * sa.frame.c[0] + s.frame.c[1] * sa.frame.c[1] + s.frame.c[2] * sa.frame.c[2]));
        if (d < bd) { bd = d; sb = s; }
      }
      if (sa && sb && bd * this.w.R < 2600) this.path(sa.cell, sb.cell, v);
    }
  }

  /** A* on slope / water between two cells, marking the road */
  private path(a: number, b: number, v: number): void {
    const { g, slope, f } = this.w;
    const N = g.count, P = g.pos, W = f.water!;
    const cost = new Float32Array(N).fill(Infinity);
    const from = new Int32Array(N).fill(-1);
    const open: [number, number][] = [[0, a]];
    cost[a] = 0;
    const bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
    let guard = 0;
    while (open.length && guard++ < 200000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, c] = open[bi];
      open[bi] = open[open.length - 1]; open.pop();
      if (c === b) break;
      for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
        const o = g.nbr[e];
        const wet = W[o] > 0.3 ? (this.w.riverCell[o] === 1 ? 10 : 500) : 0;
        const st = cost[c] + 1 + slope[o] * 40 + wet;
        if (st < cost[o]) {
          cost[o] = st; from[o] = c;
          const dd = Math.acos(Math.min(1, P[o * 3] * bx + P[o * 3 + 1] * by + P[o * 3 + 2] * bz)) / g.meanEdgeAngle;
          open.push([st + dd, o]);
        }
      }
    }
    for (let c = b; c >= 0 && c !== a; c = from[c]) { this.mark(c, v); f.tree![c] *= 0.3; }
  }

  private chainLocal(s: Site, c: RoadChain): Chain2 {
    const x: number[] = [], z: number[] = [], sa: number[] = [];
    let len = 0;
    for (let i = 0; i < c.pts.length / 3; i++) {
      const [lx, lz] = this.toLocal(s.frame, [c.pts[i * 3], c.pts[i * 3 + 1], c.pts[i * 3 + 2]]);
      if (i > 0) len += Math.hypot(lx - x[i - 1], lz - z[i - 1]);
      x.push(lx); z.push(lz); sa.push(len);
    }
    return { x, z, s: sa, wear: c.wear, len };
  }

  /** point and unit tangent on a local chain at arc length t */
  private at(ch: Chain2, t: number): [number, number, number, number, number] {
    const s = Math.max(0, Math.min(ch.len, t));
    let lo = 0, hi = ch.s.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ch.s[m] <= s) lo = m; else hi = m; }
    const ds = ch.s[hi] - ch.s[lo] || 1;
    const k = (s - ch.s[lo]) / ds;
    const x = ch.x[lo] + (ch.x[hi] - ch.x[lo]) * k, z = ch.z[lo] + (ch.z[hi] - ch.z[lo]) * k;
    let tx = ch.x[hi] - ch.x[lo], tz = ch.z[hi] - ch.z[lo];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    const wear = ch.wear[lo] + (ch.wear[hi] - ch.wear[lo]) * k;
    return [x, z, tx, tz, wear];
  }

  // ───────────────────────────── buildings ─────────────────────────────

  private bType(id: string, fallback: string): number {
    let i = buildingIndex(id);
    if (i < 0) i = buildingIndex(fallback);
    return Math.max(0, i);
  }

  /** is a footprint free (no water, gentle, off the streets, clear of other buildings)? */
  private canPlace(s: Site, x: number, z: number, w: number, d: number, rot: number, allowWater = false, ignoreRoads = false): boolean {
    const r = 0.5 * Math.hypot(w, d);
    for (const bi of s.buildings) {
      const b = this.blds[bi];
      if (Math.hypot(b.x - x, b.z - z) < r + b.r + 1.2) return false;
    }
    if (!ignoreRoads) {
      for (const ch of s.chains) {
        for (let i = 0; i < ch.x.length; i += 2) {
          const dd = Math.hypot(ch.x[i] - x, ch.z[i] - z);
          if (dd < Math.min(w, d) * 0.5 + roadWidth(ch.wear[i]) * 0.5 + 0.8) return false;
        }
      }
    }
    const c = Math.cos(rot), sn = Math.sin(rot);
    let hi = -Infinity, lo = Infinity, wet = 0;
    for (const [a, b] of [[0, 0], [-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] as [number, number][]) {
      // local footprint axes: X = (cos, -sin) east/north..., Z = (sin, cos)
      const px = x + a * w * c + b * d * sn, pz = z - a * w * sn + b * d * c;
      const dir = this.toDir(s.frame, px, pz);
      const hh = this.sample('surface', dir);
      hi = Math.max(hi, hh); lo = Math.min(lo, hh);
      if (this.sample('water', dir) > 0.08) wet++;
    }
    if (!allowWater && wet > 0) return false;
    // (piers stand in the water: their footprint spans shore and sea floor)
    if (!allowWater && hi - lo > Math.max(1.6, Math.max(w, d) * 0.22)) return false;
    return true;
  }

  private add(s: Site, typeId: string, fallback: string, matId: string, x: number, z: number, rot: number, scale = 1, extra: Partial<Bld> = {}): number {
    const type = this.bType(typeId, fallback);
    const look = buildingAt(type);
    const w = look.w * scale, d = look.d * scale;
    const era = eraIdx(s.era);
    const lk = lightKindForEra(era);
    const b: Bld = {
      x, z, site: s, dir: this.toDir(s.frame, x, z), type, mat: Math.max(0, materialIndex(matId)), style: (s.id * 3 + Math.floor(this.rng.float() * 3)) & 7,
      rot: this.bodyHeading(s, x, z, rot), scale, progress: 1, damage: 0, flags: BuildingFlag.occupied | (look.fire ? BuildingFlag.working : 0),
      light: lk * 256 + Math.round((0.35 + 0.6 * this.rng.float()) * 255), r: 0.5 * Math.hypot(w, d), w, d, ...extra,
    };
    this.blds.push(b);
    s.buildings.push(this.blds.length - 1);
    return this.blds.length - 1;
  }

  /** a local heading (site frame) → the heading in the building's own tangent frame (what the renderer reads) */
  private bodyHeading(s: Site, x: number, z: number, rot: number): number {
    const f = s.frame;
    const vx = f.e[0] * Math.sin(rot) + f.n[0] * Math.cos(rot), vy = f.e[1] * Math.sin(rot) + f.n[1] * Math.cos(rot), vz = f.e[2] * Math.sin(rot) + f.n[2] * Math.cos(rot);
    const p = this.toDir(f, x, z);
    let ex = p[2], ez = -p[0];
    const el = Math.hypot(ex, ez) || 1;
    ex /= el; ez /= el;
    const nx = p[1] * ez, ny = p[2] * ex - p[0] * ez, nz = -p[1] * ex;
    return Math.atan2(vx * ex + vz * ez, vx * nx + vy * ny + vz * nz);
  }

  /** try a spiral of spots around (x, z) until one fits */
  private placeNear(s: Site, typeId: string, fallback: string, matId: string, x: number, z: number, rot: number | null, scale = 1, extra: Partial<Bld> = {}, maxR = 80): number {
    const look = buildingAt(this.bType(typeId, fallback));
    const w = look.w * scale, d = look.d * scale;
    for (let i = 0; i < 90; i++) {
      const rr = i === 0 ? 0 : 4 + i * (maxR / 90);
      const a = i * 2.39996;
      const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
      // face the nearest street when no heading is given
      const rt = rot ?? this.faceStreet(s, px, pz);
      if (this.canPlace(s, px, pz, w, d, rt)) return this.add(s, typeId, fallback, matId, px, pz, rt, scale, extra);
    }
    return -1;
  }

  private faceStreet(s: Site, x: number, z: number): number {
    let bd = Infinity, bx = 0, bz = 1;
    for (const ch of s.chains) for (let i = 0; i < ch.x.length; i += 3) {
      const d = Math.hypot(ch.x[i] - x, ch.z[i] - z);
      if (d < bd) { bd = d; bx = ch.x[i] - x; bz = ch.z[i] - z; }
    }
    if (bd === Infinity) { bx = -x; bz = -z; }
    return LookdevLife.heading(bx, bz);
  }

  /** houses along both sides of every street of the site */
  private lineStreets(s: Site, pick: (dist: number, rng: Rng) => [string, string, string, number] | null, maxDist: number, gap = 2.5): void {
    for (const ch of s.chains) {
      for (const side of [-1, 1]) {
        let t = 4 + this.rng.float() * 4;
        while (t < ch.len - 4) {
          const [px, pz, tx, tz, wear] = this.at(ch, t);
          const dist = Math.hypot(px, pz);
          const choice = dist < maxDist ? pick(dist, this.rng) : null;
          if (!choice) { t += 8; continue; }
          const [id, fb, mat, scale] = choice;
          const look = buildingAt(this.bType(id, fb));
          const w = look.w * scale, d = look.d * scale;
          // side normal (left of travel = (−tz, tx))
          const nx = -tz * side, nz = tx * side;
          const off = roadWidth(wear) * 0.5 + 1.6 + d / 2;
          const bx = px + nx * off, bz = pz + nz * off;
          const rot = LookdevLife.heading(-nx, -nz);
          if (this.canPlace(s, bx, bz, w, d, rot)) {
            this.add(s, id, fb, mat, bx, bz, rot, scale);
            t += w + gap + this.rng.float() * gap;
          } else t += 3;
        }
      }
    }
  }

  private layout(s: Site): void {
    const rng = this.rng;
    switch (s.kind) {
      case 'camp': {
        this.add(s, 'hearth', 'hearth', 'fieldstone', 0, 0, 0, 1.2, { flags: BuildingFlag.working | BuildingFlag.lit });
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2 + rng.float() * 0.3, r = 11 + rng.float() * 5;
          this.placeNear(s, i % 3 === 2 ? 'lean-to' : 'hut', 'hut', i % 3 === 2 ? 'wood' : 'hide', Math.sin(a) * r, Math.cos(a) * r, LookdevLife.heading(-Math.sin(a), -Math.cos(a)), 0.95 + rng.float() * 0.2, {}, 10);
        }
        this.placeNear(s, 'store-pit', 'hut', 'hide', 6, -16, null, 1);
        this.placeNear(s, 'store-pit', 'hut', 'wood', -14, -6, null, 1);
        this.placeNear(s, 'shrine', 'hearth', 'wood', 0, 24, null, 1);
        s.population = 70; break;
      }
      case 'hive': {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2, r = i === 0 ? 0 : 22;
          this.placeNear(s, 'hive-mound', 'hut', i % 2 ? 'resin' : 'chitin', Math.sin(a) * r, Math.cos(a) * r, a, i === 0 ? 1.4 : 0.9 + rng.float() * 0.3, { light: 1 * 256 + 90 }, 12);
        }
        s.population = 140; break;
      }
      case 'village': {
        this.placeNear(s, 'temple', 'temple', 'mudbrick', 0, 0, null, 0.75, { flags: BuildingFlag.sacred | BuildingFlag.lit });
        this.placeNear(s, 'well', 'well', 'fieldstone', 14, 8, null);
        this.placeNear(s, 'hearth', 'hearth', 'fieldstone', -12, 10, null, 1, { flags: BuildingFlag.working | BuildingFlag.lit });
        for (let i = 0; i < 2; i++) this.placeNear(s, 'granary', 'granary', 'mudbrick', 40 * (i ? 1 : -1), 30, null);
        for (let i = 0; i < 2; i++) this.placeNear(s, 'kiln', 'kiln', 'mudbrick', 55, -30 + i * 14, null);
        this.placeNear(s, 'oven', 'kiln', 'mudbrick', -30, -20, null);
        this.placeNear(s, 'furnace', 'kiln', 'mudbrick', -60, -40, null);
        this.placeNear(s, 'workshop', 'house', 'wattle', 30, -50, null);
        this.lineStreets(s, (dist, r) => r.float() < 0.35 ? ['hut', 'hut', r.float() < 0.5 ? 'thatch' : 'wattle', 0.9 + r.float() * 0.2] : ['house', 'house', r.float() < 0.6 ? 'mudbrick' : 'wattle', 0.85 + r.float() * 0.25], 125);
        for (let i = 0; i < 2; i++) this.placeNear(s, 'pen', 'pen', 'wood', -90 + i * 40, 70, null, 0.9, {}, 50);
        // two houses going up
        for (let i = 0; i < 2; i++) { const bi = this.placeNear(s, 'house', 'house', 'mudbrick', 70, 60 + i * 15, null); if (bi >= 0) Object.assign(this.blds[bi], { progress: 0.35 + i * 0.3 }); }
        s.population = 380; break;
      }
      case 'town': {
        this.placeNear(s, 'market', 'market', 'stone', 0, 0, null, 1, {}, 60);
        this.placeNear(s, 'temple', 'temple', 'stone', 40, 35, null, 1.05, { flags: BuildingFlag.sacred | BuildingFlag.lit }, 70);
        this.placeNear(s, 'library', 'temple', 'stone', -40, 30, null, 1, {}, 70);
        this.placeNear(s, 'well', 'well', 'stone', 18, -12, null);
        for (let i = 0; i < 2; i++) this.placeNear(s, 'forge', 'forge', 'fieldstone', -80 + i * 160, -60, null, 1, { flags: BuildingFlag.working | BuildingFlag.lit });
        for (let i = 0; i < 3; i++) this.placeNear(s, 'granary', 'granary', 'timber', -120 + i * 120, 120, null);
        for (let i = 0; i < 3; i++) this.placeNear(s, 'workshop', 'house', i % 2 ? 'timber' : 'stone', 90 * Math.cos(i * 2.1), 90 * Math.sin(i * 2.1), null);
        this.placeNear(s, 'mill', 'workshop', 'timber', 150, 30, null);
        this.lineStreets(s, (dist, r) => {
          const u = r.float();
          if (dist < 120) return ['house', 'house', u < 0.5 ? 'stone' : u < 0.8 ? 'timber' : 'wattle', 0.85 + r.float() * 0.3];
          return u < 0.25 ? ['hut', 'hut', 'thatch', 1] : ['house', 'house', u < 0.6 ? 'wattle' : 'timber', 0.85 + r.float() * 0.2];
        }, 195);
        for (let i = 0; i < 3; i++) { const bi = this.placeNear(s, 'house', 'house', 'stone', -60 + i * 50, -110, null); if (bi >= 0) Object.assign(this.blds[bi], { progress: 0.25 + i * 0.25 }); }
        this.wallRing(s, 205);
        s.population = 1100; break;
      }
      case 'city': {
        this.placeNear(s, 'market', 'market', 'brick', 0, 0, null, 1.2, {}, 60);
        this.placeNear(s, 'temple', 'temple', 'stone', -50, 40, null, 1.2, { flags: BuildingFlag.sacred | BuildingFlag.lit }, 80);
        this.placeNear(s, 'library', 'temple', 'stone', 55, 40, null, 1.1, {}, 80);
        this.placeNear(s, 'school', 'library', 'brick', 60, -60, null, 1, {}, 80);
        this.placeNear(s, 'observatory', 'library', 'stone', -170, 150, null, 1, {}, 80);
        this.placeNear(s, 'well', 'well', 'stone', -20, -18, null);
        // industry by the water
        const sea = this.seaward(s);
        for (let i = 0; i < 3; i++) this.placeNear(s, 'factory', 'workshop', 'brick', sea[0] * 150 + Math.cos(i * 2) * 60, sea[1] * 150 + Math.sin(i * 2) * 60, null, 0.85, { flags: BuildingFlag.working | BuildingFlag.lit }, 120);
        for (let i = 0; i < 4; i++) this.placeNear(s, 'workshop', 'house', 'brick', Math.cos(i * 1.6) * 120, Math.sin(i * 1.6) * 120, null);
        this.placeNear(s, 'mill', 'workshop', 'brick', -sea[0] * 240, -sea[1] * 240, null, 1, {}, 80);
        this.placeNear(s, 'forge', 'forge', 'brick', -90, -60, null, 1, { flags: BuildingFlag.working | BuildingFlag.lit });
        this.harbour(s, sea);
        this.lineStreets(s, (dist, r) => {
          const u = r.float();
          if (dist < 150) return ['house', 'house', u < 0.75 ? 'brick' : 'stone', 0.95 + r.float() * 0.4];
          if (dist < 260) return ['house', 'house', u < 0.6 ? 'brick' : u < 0.85 ? 'timber' : 'stone', 0.85 + r.float() * 0.3];
          return u < 0.5 ? ['house', 'house', 'timber', 0.9] : null;
        }, 330, 1.6);
        for (let i = 0; i < 3; i++) { const bi = this.placeNear(s, 'house', 'house', 'brick', 140, -150 + i * 30, null); if (bi >= 0) Object.assign(this.blds[bi], { progress: 0.2 + i * 0.3 }); }
        s.population = 4200; break;
      }
      case 'burning': {
        this.placeNear(s, 'hearth', 'hearth', 'fieldstone', 0, 0, null);
        this.lineStreets(s, (_d, r) => ['house', 'house', r.float() < 0.6 ? 'wattle' : 'timber', 0.9 + r.float() * 0.2], 75, 3);
        for (let i = 0; i < 4; i++) this.placeNear(s, 'hut', 'hut', 'thatch', Math.cos(i * 1.7) * 40, Math.sin(i * 1.7) * 40, null);
        this.placeNear(s, 'granary', 'granary', 'wattle', 30, -30, null);
        // the fire came from the forest side: the nearest houses burn, some have already fallen
        const fx = this.forestward(s);
        for (const bi of s.buildings) {
          const b = this.blds[bi];
          const along = (b.x * fx[0] + b.z * fx[1]) / 60;
          const k = hashFloat(bi, 71);
          if (along > 0.2 + k * 0.4) Object.assign(b, { flags: (b.flags | BuildingFlag.burning) & ~BuildingFlag.occupied, damage: 0.25 + 0.4 * k });
          else if (along > -0.2 && k < 0.45) Object.assign(b, { flags: BuildingFlag.ruined, damage: 0.85 });
        }
        s.population = 60; break;
      }
      case 'hamlet': {
        const era = eraIdx(s.era);
        const mat = era <= 2 ? 'wattle' : era <= 4 ? 'timber' : era <= 7 ? 'stone' : 'brick';
        this.placeNear(s, era <= 3 ? 'hearth' : 'well', 'well', 'fieldstone', 0, 0, null);
        if (era >= 5) this.placeNear(s, era >= 6 ? 'temple' : 'shrine', 'shrine', 'stone', 20, 10, null, 0.6, { flags: BuildingFlag.sacred | BuildingFlag.lit });
        if (era >= 9) this.placeNear(s, 'radio-mast', 'tower', 'steel', -40, 30, null, 1, { flags: BuildingFlag.lit }, 40);
        if (era === 8) this.placeNear(s, 'factory', 'workshop', 'brick', -35, -25, null, 0.6, { flags: BuildingFlag.working | BuildingFlag.lit }, 40);
        this.lineStreets(s, (_d, r) => [r.float() < 0.25 && era <= 4 ? 'hut' : 'house', 'house', r.float() < 0.7 ? mat : 'timber', 0.85 + r.float() * 0.3], 70, 3);
        this.placeNear(s, 'granary', 'granary', era <= 2 ? 'wattle' : 'timber', 35, -35, null);
        s.population = 60 + Math.round(hashFloat(s.id, 5) * 90); break;
      }
    }
  }

  /** local direction (unit) toward the sea from a coastal site */
  private seaward(s: Site): [number, number] {
    let bx = 0, bz = 0;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      for (const r of [120, 220, 320]) {
        const d = this.toDir(s.frame, Math.sin(a) * r, Math.cos(a) * r);
        const wd = this.sample('water', d);
        if (wd > 1.5 && this.sample('salinity', d) > 0.5) { bx += Math.sin(a) * wd; bz += Math.cos(a) * wd; }
      }
    }
    const l = Math.hypot(bx, bz) || 1;
    return [bx / l, bz / l];
  }

  private forestward(s: Site): [number, number] {
    let bx = 0, bz = 0;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const t = this.sample('tree', this.toDir(s.frame, Math.sin(a) * 110, Math.cos(a) * 110));
      bx += Math.sin(a) * t; bz += Math.cos(a) * t;
    }
    const l = Math.hypot(bx, bz) || 1;
    return [bx / l, bz / l];
  }

  /** docks out into the sea, a shipyard on the shore, a lighthouse on the headland */
  private harbour(s: Site, sea: [number, number]): void {
    const base = Math.atan2(sea[0], sea[1]);
    let docks = 0;
    let headland: [number, number] | null = null, headScore = -1;
    for (let i = -10; i <= 10; i++) {
      const a = base + i * 0.09;
      const dx = Math.sin(a), dz = Math.cos(a);
      // march out to the shoreline
      let shore = -1;
      for (let r = 40; r < 520; r += 4) {
        if (this.sample('water', this.toDir(s.frame, dx * r, dz * r)) > 0.6) { shore = r; break; }
      }
      if (shore < 0) continue;
      // headland: the shore point with the most sea around it
      let wet = 0;
      for (let k = 0; k < 8; k++) { const b = (k / 8) * Math.PI * 2; if (this.sample('water', this.toDir(s.frame, dx * (shore - 12) + Math.sin(b) * 40, dz * (shore - 12) + Math.cos(b) * 40)) > 0.5) wet++; }
      if (wet > headScore) { headScore = wet; headland = [dx * (shore - 14), dz * (shore - 14)]; }
      if (docks < 6 && i % 3 === 0) {
        const look = buildingAt(this.bType('dock', 'dock'));
        const L = Math.max(look.w, look.d);
        const cx = dx * (shore + L * 0.32), cz = dz * (shore + L * 0.32);
        if (this.canPlace(s, cx, cz, look.w, look.d, a, true, true)) { this.add(s, 'dock', 'dock', 'timber', cx, cz, a, 1); docks++; }
      }
    }
    // shipyard on the shore beside the docks, its slip toward the water
    const sy = buildingAt(this.bType('shipyard', 'dock'));
    for (const off of [0.55, -0.55, 0.8, -0.8]) {
      const a = base + off;
      let shore = -1;
      for (let r = 40; r < 520; r += 4) if (this.sample('water', this.toDir(s.frame, Math.sin(a) * r, Math.cos(a) * r)) > 0.6) { shore = r; break; }
      if (shore < 0) continue;
      const r = shore - sy.d * 0.15;
      if (this.canPlace(s, Math.sin(a) * r, Math.cos(a) * r, sy.w, sy.d, a, true, true)) { this.add(s, 'shipyard', 'dock', 'timber', Math.sin(a) * r, Math.cos(a) * r, a, 1); break; }
    }
    if (headland) this.placeNear(s, 'lighthouse', 'tower', 'stone', headland[0], headland[1], null, 1, { flags: BuildingFlag.lit, light: 2 * 256 + 255 }, 30);
  }

  /** a stone wall around the town: segments tangent to the ring, towers at every fourth joint */
  private wallRing(s: Site, radius: number): void {
    const seg = 15;
    const n = Math.max(12, Math.round((2 * Math.PI * radius) / seg));
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = radius * (1 + 0.08 * Math.sin(a * 3 + s.id));
      pts.push([Math.sin(a) * r, Math.cos(a) * r]);
    }
    for (let i = 0; i < n; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % n];
      const cx = (ax + bx) / 2, cz = (az + bz) / 2;
      const len = Math.hypot(bx - ax, bz - az);
      const dir = this.toDir(s.frame, cx, cz);
      if (this.sample('water', dir) > 0.1) continue;
      const look = buildingAt(this.bType('wall', 'wall'));
      const scale = len / Math.max(look.w, look.d);
      const rot = LookdevLife.heading(bx - ax, bz - az);
      // segments crossing a street are left to the renderer, which draws them as gatehouses
      this.add(s, 'wall', 'wall', 'stone', cx, cz, rot, scale);
      if (i % 4 === 0) this.add(s, 'tower', 'tower', 'stone', ax, az, rot, 1.1, { flags: BuildingFlag.lit });
    }
  }

  // ───────────────────────────── fields ─────────────────────────────

  /** farmland around the settlements, the wildfire beside the burning hamlet, worn ground */
  private fields(): void {
    const { g, f } = this.w;
    const P = g.pos;
    const CR = f.crop!, CS = f.cropSpecies!, TR = f.tree!, SH = f.shrub!, GR = f.grass!, FI = f.fire!, BU = f.burnt!, W = f.water!;
    const SA = f.sand, SO = f.soil;
    for (const s of this.sites) {
      if (s.kind === 'camp' || s.kind === 'hive') continue;
      const reach = s.kind === 'city' ? 520 : s.kind === 'town' ? 420 : s.kind === 'village' ? 320 : 180;
      for (const c of g.cellsWithin(s.frame.c[0], s.frame.c[1], s.frame.c[2], reach / this.w.R)) {
        if (W[c] > 0.2 || this.w.slope[c] > 0.22 || f.road![c] > 0.55) continue;
        const d = Math.acos(Math.min(1, P[c * 3] * s.frame.c[0] + P[c * 3 + 1] * s.frame.c[1] + P[c * 3 + 2] * s.frame.c[2])) * this.w.R;
        if (d < s.radius * 0.7) {
          // built-up ground: trodden yards and verges, not beach sand or forest
          TR[c] *= 0.15;
          if (SA) SA[c] *= 0.05;
          if (SO) SO[c] = Math.max(SO[c], 0.35);
          GR[c] = Math.max(GR[c], 0.6);
          continue;
        }
        if (hashFloat(Math.floor(P[c * 3] * 50), Math.floor(P[c * 3 + 1] * 50), Math.floor(P[c * 3 + 2] * 50), 77 + s.id) < 0.72) {
          CR[c] = Math.max(CR[c], 0.6 + 0.4 * hashFloat(c, 5));
          CS[c] = 26 + Math.floor(hashFloat(c, 9) * 4);
          TR[c] *= 0.1; SH[c] *= 0.3; GR[c] = Math.max(GR[c] * 0.6, 0.3);
        }
      }
    }
    // the wildfire: a burning front in the forest beside the hamlet, the burnt scar behind it
    const b = this.sites.find((s) => s.kind === 'burning');
    if (b) {
      const [fx, fz] = this.forestward(b);
      for (const c of g.cellsWithin(b.frame.c[0], b.frame.c[1], b.frame.c[2], 420 / this.w.R)) {
        const [lx, lz] = this.toLocal(b.frame, [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]]);
        const along = lx * fx + lz * fz;
        const across = Math.abs(-lx * fz + lz * fx);
        if (across > 260) continue;
        if (along > 140 && along < 330) BU[c] = Math.max(BU[c], smooth(140, 200, along) * (1 - smooth(200, 260, across)));
        if (along > 40 && along < 175 && TR[c] + SH[c] > 0.15) FI[c] = Math.max(FI[c], (0.55 + 0.45 * hashFloat(c, 3)) * (1 - smooth(150, 230, across)));
      }
      // the burning houses' cells
      for (const bi of b.buildings) {
        const bb = this.blds[bi];
        if (bb.flags & BuildingFlag.burning) { const c = g.nearestCell(bb.dir[0], bb.dir[1], bb.dir[2]); FI[c] = Math.max(FI[c], 0.5); }
      }
    }
  }

  private makeBuildingBlock(): BuildingBlock {
    const n = this.blds.length;
    const blk: BuildingBlock = {
      count: n, id: new Uint32Array(n), type: new Uint16Array(n), material: new Uint8Array(n), style: new Uint8Array(n),
      pos: new Float32Array(n * 3), rot: new Float32Array(n), scale: new Float32Array(n), progress: new Float32Array(n),
      flags: new Uint16Array(n), light: new Uint16Array(n), settlement: new Int32Array(n), damage: new Float32Array(n),
    };
    for (let i = 0; i < n; i++) {
      const b = this.blds[i];
      blk.id[i] = 1000 + i; blk.type[i] = b.type; blk.material[i] = b.mat; blk.style[i] = b.style;
      blk.pos[i * 3] = b.dir[0]; blk.pos[i * 3 + 1] = b.dir[1]; blk.pos[i * 3 + 2] = b.dir[2];
      blk.rot[i] = b.rot; blk.scale[i] = b.scale; blk.progress[i] = b.progress; blk.flags[i] = b.flags | (b.light ? BuildingFlag.lit : 0);
      blk.light[i] = b.light; blk.settlement[i] = b.site.id; blk.damage[i] = b.damage;
    }
    return blk;
  }

  // ───────────────────────────── people ─────────────────────────────

  private clothTint(s: Site, rng: Rng): number {
    const sp = speciesAt(s.species);
    const pal = ERA_CLOTH[s.era] ?? ERA_CLOTH.iron;
    if (s.kind === 'hive') {
      const c = sp.cloths[Math.floor(rng.float() * sp.cloths.length)] ?? [0.4, 0.3, 0.1];
      return (Math.round(Math.pow(c[0], 1 / 2.2) * 255) << 16) | (Math.round(Math.pow(c[1], 1 / 2.2) * 255) << 8) | Math.round(Math.pow(c[2], 1 / 2.2) * 255);
    }
    return pal[Math.floor(rng.float() * pal.length)];
  }

  private agent(s: Site, a: Partial<Agent>): Agent {
    const rng = this.rng;
    const child = rng.float() < (s.kind === 'camp' ? 0.25 : 0.16);
    const elder = !child && rng.float() < 0.1;
    const female = rng.float() < 0.5;
    let flags = (child ? AgentFlag.child : 0) | (elder ? AgentFlag.elder : 0) | (female ? AgentFlag.female : 0);
    if (a.flags) flags |= a.flags;
    const ag: Agent = {
      site: s, species: s.species, mode: 0, x: 0, z: 0, x2: 0, z2: 0, chain: null, s0: 0, s1: 0, lane: 0, radius: 0,
      speed: 0.14 + rng.float() * 0.05, heading: rng.float() * Math.PI * 2, anim: AnimState.idle, animMove: AnimState.walk,
      phase: rng.float(), flags, carry: -1, scale: child ? 0.58 + rng.float() * 0.1 : elder ? 0.94 : 0.92 + rng.float() * 0.16,
      tint: this.clothTint(s, rng), id: 1 + this.agentList.length, group: s.id, alt: 0, ...a,
    };
    if (a.flags) ag.flags = flags;
    this.agentList.push(ag);
    s.agents++;
    return ag;
  }

  private walker(s: Site, anim: number, carry = -1): void {
    if (!s.chains.length) return;
    const rng = this.rng;
    const ch = s.chains[Math.floor(rng.float() * s.chains.length)];
    const a = rng.float() * ch.len, b = rng.float() * ch.len;
    const ag = this.agent(s, { mode: 1, chain: ch, s0: Math.min(a, b), s1: Math.max(a, b) + 6, lane: (rng.float() - 0.5) * 2, animMove: anim, carry });
    if (ag.flags & AgentFlag.child) { ag.animMove = rng.float() < 0.6 ? AnimState.run : AnimState.walk; ag.speed *= 1.4; ag.carry = -1; }
    if (ag.flags & AgentFlag.elder) ag.speed *= 0.7;
  }

  /** someone at a spot doing something (facing a target) */
  private stander(s: Site, x: number, z: number, anim: number, face: number, carry = -1, flags = 0): Agent {
    return this.agent(s, { mode: 0, x, z, anim, animMove: anim, heading: face, carry, flags });
  }

  private ring(s: Site, cx: number, cz: number, n: number, r0: number, r1: number, anims: number[], faceIn = true, carry = -1): void {
    for (let i = 0; i < n; i++) {
      const a = this.rng.float() * Math.PI * 2, r = r0 + this.rng.float() * (r1 - r0);
      const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      if (this.sample('water', this.toDir(s.frame, x, z)) > 0.05) continue;
      const face = faceIn ? LookdevLife.heading(cx - x, cz - z) : this.rng.float() * Math.PI * 2;
      this.stander(s, x, z, anims[Math.floor(this.rng.float() * anims.length)], face, carry);
    }
  }

  private bldOf(s: Site, typeId: string): Bld[] {
    const t = buildingIndex(typeId);
    return s.buildings.map((i) => this.blds[i]).filter((b) => b.type === t);
  }

  /** a working spot in front of a building */
  private front(b: Bld, dist: number, side = 0): [number, number, number] {
    const f = b.site.frame;
    // b.rot is the heading in the building's own frame ≈ the site frame nearby
    void f;
    const hx = Math.sin(b.rot), hz = Math.cos(b.rot);
    const x = b.x + hx * (b.d / 2 + dist) + hz * side, z = b.z + hz * (b.d / 2 + dist) - hx * side;
    return [x, z, LookdevLife.heading(b.x - x, b.z - z)];
  }

  private people(s: Site): void {
    const rng = this.rng;
    const wood = itemIndex('wood'), basket = itemIndex('basket'), pot = itemIndex('pot'), meat = itemIndex('meat'), stone = itemIndex('stone');
    const axe = itemIndex('stone-axe'), hoe = itemIndex('hoe'), sickle = itemIndex('sickle'), spear = itemIndex('stone-spear');
    const iaxe = itemIndex('iron-tools'), sword = itemIndex('iron-sword'), book = itemIndex('book'), fish = itemIndex('fish'), gun = itemIndex('firearm');
    const era = eraIdx(s.era);
    const farmTool = era <= 1 ? itemIndex('digging-stick') : rng.float() < 0.5 ? hoe : sickle;
    const carries = [wood, basket, pot, stone, era >= 3 ? itemIndex('grain') : meat];
    const walkers = (n: number) => { for (let i = 0; i < n; i++) { const c = rng.float() < 0.35 ? carries[Math.floor(rng.float() * carries.length)] : -1; this.walker(s, c >= 0 ? AnimState.carry : AnimState.walk, c); } };
    // workers in the fields around
    const fieldWork = (n: number, reach: number) => {
      for (let i = 0; i < n * 3 && n > 0; i++) {
        const a = rng.float() * Math.PI * 2, r = s.radius * 0.8 + rng.float() * reach;
        const x = Math.sin(a) * r, z = Math.cos(a) * r;
        const d = this.toDir(s.frame, x, z);
        if (this.sample('crop', d) < 0.45 || this.sample('water', d) > 0.05) continue;
        const ang = rng.float() * Math.PI * 2;
        this.agent(s, { mode: 3, x, z, x2: x + Math.sin(ang) * 14, z2: z + Math.cos(ang) * 14, speed: 0.02, animMove: rng.float() < 0.6 ? AnimState.dig : AnimState.work, carry: farmTool });
        n--;
      }
    };
    // woodcutters at the forest's edge
    const woodcut = (n: number) => {
      for (let i = 0; i < n * 6 && n > 0; i++) {
        const a = rng.float() * Math.PI * 2, r = s.radius + 20 + rng.float() * 120;
        const x = Math.sin(a) * r, z = Math.cos(a) * r;
        const d = this.toDir(s.frame, x, z);
        if (this.sample('tree', d) < 0.4 || this.sample('water', d) > 0.05) continue;
        this.stander(s, x, z, AnimState.chop, rng.float() * Math.PI * 2, era >= 4 ? iaxe : axe);
        if (rng.float() < 0.5) this.stander(s, x + 2, z + 1.5, AnimState.carry, rng.float() * Math.PI * 2, wood);
        n--;
      }
    };
    switch (s.kind) {
      case 'camp': {
        // around the fire: sitting, eating, telling, a few asleep, children, dancers
        this.ring(s, 0, 0, 16, 2.4, 3.6, [AnimState.sit, AnimState.sit, AnimState.eat, AnimState.teach]);
        this.ring(s, 0, 0, 8, 4.5, 6, [AnimState.dance, AnimState.cheer], false);
        this.ring(s, 0, 0, 6, 7, 10, [AnimState.sleep], false);
        this.ring(s, 0, 0, 8, 6, 18, [AnimState.work, AnimState.idle, AnimState.idle], false);
        for (let i = 0; i < 6; i++) { const a = rng.float() * 6.28; this.agent(s, { mode: 2, x: Math.sin(a) * 12, z: Math.cos(a) * 12, radius: 4 + rng.float() * 6, speed: 0.22, animMove: AnimState.run, flags: AgentFlag.child }); }
        // hunters coming home with meat, gatherers with baskets
        for (let i = 0; i < 8; i++) { const a = rng.float() * 6.28; this.agent(s, { mode: 3, x: Math.sin(a) * 90, z: Math.cos(a) * 90, x2: Math.sin(a) * 14, z2: Math.cos(a) * 14, speed: 0.13, animMove: AnimState.carry, carry: i % 2 ? meat : basket }); }
        for (let i = 0; i < 4; i++) { const a = rng.float() * 6.28; this.agent(s, { mode: 3, x: Math.sin(a) * 30, z: Math.cos(a) * 30, x2: Math.sin(a) * 120, z2: Math.cos(a) * 120, speed: 0.15, animMove: AnimState.walk, carry: spear }); }
        woodcut(4);
        this.ring(s, 0, 24, 4, 1.5, 2.5, [AnimState.pray, AnimState.mourn]);
        break;
      }
      case 'hive': {
        for (const bi of s.buildings) {
          const b = this.blds[bi];
          this.ring(s, b.x, b.z, 14, b.r + 0.5, b.r + 6, [AnimState.work, AnimState.build, AnimState.idle, AnimState.dig], true);
        }
        for (let i = 0; i < 40; i++) { const a = rng.float() * 6.28, r = 10 + rng.float() * 60; this.agent(s, { mode: 3, x: Math.sin(a) * r, z: Math.cos(a) * r, x2: Math.sin(a + 1) * 25, z2: Math.cos(a + 1) * 25, speed: 0.16, animMove: AnimState.carry, carry: basket }); }
        break;
      }
      case 'village': walkers(140); fieldWork(60, 160); woodcut(8); break;
      case 'town': walkers(480); fieldWork(90, 200); woodcut(10); break;
      case 'city': walkers(1100); fieldWork(70, 220); break;
      case 'burning': break;
      case 'hamlet': walkers(16); fieldWork(10, 100); break;
    }
    // at the buildings
    for (const b of this.bldOf(s, 'temple')) {
      const [x, z, face] = this.front(b, 10);
      this.ring(s, x, z, s.kind === 'city' ? 40 : s.kind === 'town' ? 26 : 16, 1, 9, [AnimState.pray, AnimState.pray, AnimState.pray, AnimState.idle]);
      this.stander(s, x + Math.sin(face) * -7, z + Math.cos(face) * -7, AnimState.teach, face + Math.PI, era >= 4 ? book : -1, AgentFlag.priest);
    }
    for (const b of this.bldOf(s, 'market')) this.ring(s, b.x, b.z, s.kind === 'city' ? 90 : 50, 3, Math.max(b.w, b.d) * 0.55, [AnimState.idle, AnimState.idle, AnimState.teach, AnimState.walk, AnimState.cheer, AnimState.eat], false, -1);
    // the town watch drilling by the market: pairs sparring with swords and spears, an onlooker cheering
    if (s.kind === 'town') {
      const sword = itemIndex('iron-sword'), spear = itemIndex('bronze-spear');
      for (const b of this.bldOf(s, 'market').slice(0, 1)) {
        const [x, z, face] = this.front(b, 8);
        for (let i = 0; i < 2; i++) {
          const ox = x + Math.cos(face) * (i * 4 - 2), oz = z - Math.sin(face) * (i * 4 - 2);
          this.stander(s, ox, oz, AnimState.fight, face + Math.PI / 2, i ? spear : sword);
          this.stander(s, ox + Math.sin(face + Math.PI / 2) * 1.5, oz + Math.cos(face + Math.PI / 2) * 1.5, AnimState.fight, face - Math.PI / 2, sword);
        }
        this.stander(s, x + Math.sin(face) * 3, z + Math.cos(face) * 3, AnimState.cheer, face + Math.PI);
      }
    }
    for (const kind of ['forge', 'furnace', 'kiln', 'oven']) for (const b of this.bldOf(s, kind)) {
      const [x, z, face] = this.front(b, 1.6);
      this.stander(s, x, z, AnimState.work, face, era >= 4 ? itemIndex('iron-tools') : itemIndex('stone'));
      this.stander(s, x + 1.8, z - 0.8, AnimState.carry, face + 1.2, kind === 'kiln' ? pot : wood);
    }
    for (const b of this.bldOf(s, 'workshop')) { const [x, z, face] = this.front(b, 2, 2); this.stander(s, x, z, AnimState.work, face, itemIndex('bronze-tools')); }
    for (const b of this.bldOf(s, 'factory')) for (let i = 0; i < 6; i++) { const [x, z, face] = this.front(b, 3 + i * 1.5, (i % 3 - 1) * 3); this.stander(s, x, z, i % 2 ? AnimState.carry : AnimState.work, face + (rng.float() - 0.5), i % 2 ? itemIndex('coal') : -1); }
    for (const b of this.bldOf(s, 'dock')) {
      const hx = Math.sin(b.rot), hz = Math.cos(b.rot);
      for (let i = 0; i < 3; i++) { const t = 2 + i * 5; this.stander(s, b.x + hx * t + hz * 2.6, b.z + hz * t - hx * 2.6, i === 0 ? AnimState.fish : AnimState.carry, b.rot + Math.PI / 2, i === 0 ? itemIndex('fishing-net') : fish); }
      // fishers out on the water beyond the pier: a raft, rowing boats, a sail boat (AgentFlag.boat; carry = the boat)
      const vessels = ['raft', 'boat', 'boat', 'sailship'];
      for (let i = 0; i < vessels.length; i++) {
        const t = b.d / 2 + 9 + i * 8 + rng.float() * 4, side = (rng.float() - 0.5) * 22;
        const x = b.x + hx * t + hz * side, z = b.z + hz * t - hx * side;
        if (this.sample('water', this.toDir(s.frame, x, z)) < 0.8) continue;
        this.stander(s, x, z, AnimState.fish, b.rot + (rng.float() - 0.5) * 2.2, itemIndex(vessels[i]), AgentFlag.boat);
      }
    }
    for (const b of this.bldOf(s, 'well')) this.ring(s, b.x, b.z, 4, 1.4, 2.2, [AnimState.idle, AnimState.carry, AnimState.teach], true, pot);
    for (const b of this.bldOf(s, 'hearth')) if (s.kind !== 'camp') this.ring(s, b.x, b.z, 7, 2.2, 3.4, [AnimState.sit, AnimState.eat, AnimState.cheer]);
    // builders on the rising houses
    for (const bi of s.buildings) {
      const b = this.blds[bi];
      if (b.progress >= 1) continue;
      for (let i = 0; i < 4; i++) { const [x, z, face] = this.front(b, 0.8 + rng.float() * 1.5, (rng.float() - 0.5) * b.w); this.stander(s, x, z, i % 3 === 2 ? AnimState.carry : AnimState.build, face, i % 3 === 2 ? stone : itemIndex('stone-axe')); }
    }
    // guards on the walls and at the gates
    for (const b of this.bldOf(s, 'tower')) this.stander(s, b.x, b.z + 3.5, AnimState.idle, this.rng.float() * 6.28, era >= 7 ? gun : sword, AgentFlag.soldier | AgentFlag.armed);
    // the burning hamlet: people fleeing, mourning, carrying water
    if (s.kind === 'burning') {
      const [fx, fz] = this.forestward(s);
      for (let i = 0; i < 26; i++) {
        const sx = (rng.float() - 0.5) * 60, sz = (rng.float() - 0.5) * 60;
        this.agent(s, { mode: 3, x: sx, z: sz, x2: sx - fx * 160, z2: sz - fz * 160, speed: 0.3, animMove: AnimState.flee, carry: rng.float() < 0.3 ? basket : -1 });
      }
      this.ring(s, -fx * 45, -fz * 45, 8, 2, 8, [AnimState.mourn, AnimState.mourn, AnimState.pray]);
      // the dead the mourners kneel by
      for (let i = 0; i < 2; i++) this.stander(s, -fx * 45 + (i - 0.5) * 1.6, -fz * 45 + (i - 0.5) * 0.6, AnimState.dead, rng.float() * Math.PI * 2);
      for (let i = 0; i < 6; i++) { const t = rng.float(); this.stander(s, fx * 25 * t + (rng.float() - 0.5) * 20, fz * 25 * t + (rng.float() - 0.5) * 20, AnimState.carry, LookdevLife.heading(fx, fz), pot); }
    }
    // sleepers outdoors at the camp; elders sitting by their doors in the towns
    if (s.kind === 'town' || s.kind === 'city' || s.kind === 'village') {
      let n = 0;
      for (const bi of s.buildings) {
        if (n > (s.kind === 'city' ? 70 : 30)) break;
        const b = this.blds[bi];
        if (rng.float() > 0.18 || b.progress < 1) continue;
        const [x, z, face] = this.front(b, 0.9, (rng.float() - 0.5) * b.w * 0.5);
        this.stander(s, x, z, rng.float() < 0.6 ? AnimState.sit : AnimState.idle, face + Math.PI, -1, AgentFlag.elder);
        n++;
      }
    }
  }

  // ───────────────────────────── animals ─────────────────────────────

  private herd(h: Herd): void {
    this.herds.push(h);
    for (let k = 0; k < h.members; k++) this.herdIndex.push({ herd: h, k });
  }

  private wildlife(): void {
    const rng = this.rng;
    const { g, f } = this.w;
    const TR = f.tree!, GR = f.grass!, W = f.water!;
    let group = 0;
    const tint = (sp: number) => sp;
    for (const s of this.sites) {
      const F = s.frame;
      const find = (pred: (d: V3) => boolean, r0: number, r1: number): [number, number] | null => {
        for (let i = 0; i < 40; i++) {
          const a = rng.float() * Math.PI * 2, r = r0 + rng.float() * (r1 - r0);
          const x = Math.sin(a) * r, z = Math.cos(a) * r;
          if (pred(this.toDir(F, x, z))) return [x, z];
        }
        return null;
      };
      const meadow = (d: V3) => this.sample('water', d) < 0.02 && this.sample('tree', d) < 0.35 && this.sample('grass', d) > 0.25 && this.sample('road', d) < 0.35;
      const edge = (d: V3) => this.sample('water', d) < 0.02 && this.sample('tree', d) > 0.25 && this.sample('tree', d) < 0.6;
      const sea = (d: V3) => this.sample('water', d) > 3;
      const add = (sp: string, at: [number, number] | null, kind: Herd['kind'], n: number, radius: number, alt = 0, speed = 0.02) => {
        if (!at) return;
        this.herd({ species: animalIndex(sp), cx: at[0], cz: at[1], site: s, radius, members: n, drift: rng.float() * 6.28, kind, alt, speed, seed: rng.float(), tint: tint(0), group: group++ });
      };
      if (s.kind === 'camp' || s.kind === 'village' || s.kind === 'town' || s.kind === 'hamlet') {
        add('deer', find(edge, 120, 320), 'graze', 6 + Math.floor(rng.float() * 6), 18);
        add('songbird', find(meadow, 40, 200), 'flock', 14, 30, 22, 0.25);
      }
      if (s.kind === 'camp') { add('boar', find(edge, 100, 260), 'graze', 5, 10); add('wolf', find(edge, 200, 380), 'pack', 5, 40, 0, 0.18); add('bear', find(edge, 200, 400), 'solo', 1, 6); add('wild-horse', find(meadow, 150, 360), 'graze', 8, 22); }
      if (s.kind === 'village') {
        for (const b of this.bldOf(s, 'pen')) this.herd({ species: animalIndex(rng.float() < 0.5 ? 'sheep' : 'goat'), cx: b.x, cz: b.z, site: s, radius: Math.min(b.w, b.d) * 0.35, members: 9, drift: 0, kind: 'pen', alt: 0, speed: 0.01, seed: rng.float(), tint: 0, group: group++ });
        add('sheep', find(meadow, 140, 260), 'graze', 16, 20);
        add('chicken', [12, -8], 'graze', 7, 6);
        add('dog', [-6, 12], 'graze', 2, 8);
        add('bison', find(meadow, 280, 480), 'graze', 14, 30);
      }
      if (s.kind === 'town') {
        add('cattle', find(meadow, 230, 380), 'graze', 12, 22);
        add('horse', find(meadow, 230, 380), 'graze', 6, 14);
        add('sheep', find(meadow, 240, 420), 'graze', 18, 26);
        add('chicken', [30, -40], 'graze', 6, 6); add('dog', [10, 60], 'graze', 3, 15);
        add('wild-goat', find((d) => this.sample('water', d) < 0.02 && this.sample('surface', d) > 100, 200, 600), 'graze', 7, 15);
      }
      if (s.kind === 'city') {
        const [sx, sz] = this.seaward(s);
        add('gull', [sx * 260, sz * 260], 'flock', 18, 40, 18, 0.3);
        add('gull', [sx * 380 + 40, sz * 380], 'flock', 10, 25, 26, 0.35);
        for (let i = 0; i < 5; i++) add('fish-shoal', find(sea, 300, 700), 'shoal', 1, 14, -2.5, 0.05);
        add('whale', find(sea, 800, 1300), 'solo', 1, 30, -0.5, 0.06);
        add('horse', [0, 40], 'graze', 3, 30); add('dog', [-30, 0], 'graze', 4, 50);
      }
      if (s.kind === 'hamlet' && eraIdx(s.era) >= 3) add('cattle', find(meadow, 90, 200), 'graze', 6, 14);
      if (s.kind === 'hive') { add('desert-lizard', find((d) => this.sample('water', d) < 0.02, 40, 200), 'graze', 3, 20); add('locust-swarm', find(meadow, 150, 400) ?? [120, 40], 'swarm', 1, 25, 4, 0.05); }
      if (s.kind === 'burning') add('vulture', [0, 0], 'flock', 5, 45, 55, 0.2);
    }
    void g; void TR; void GR; void W;
  }

  // ───────────────────────────── snapshot ─────────────────────────────

  private makeMovers(n: number): MoverBlock {
    return {
      count: n, id: new Uint32Array(n), species: new Uint16Array(n), pos: new Float32Array(n * 3), vel: new Float32Array(n * 3),
      alt: new Float32Array(n), heading: new Float32Array(n), anim: new Uint8Array(n), phase: new Float32Array(n), flags: new Uint16Array(n),
      carry: new Int16Array(n), group: new Int32Array(n), scale: new Float32Array(n), tint: new Uint32Array(n),
    };
  }

  /** local (x, z) + velocity (m/tick) → the mover's unit position / velocity and heading */
  private put(m: MoverBlock, i: number, f: Frame, x: number, z: number, vx: number, vz: number, heading: number): void {
    const d = this.toDir(f, x, z);
    m.pos[i * 3] = d[0]; m.pos[i * 3 + 1] = d[1]; m.pos[i * 3 + 2] = d[2];
    const R = this.w.R;
    m.vel[i * 3] = (f.e[0] * vx + f.n[0] * vz) / R; m.vel[i * 3 + 1] = (f.e[1] * vx + f.n[1] * vz) / R; m.vel[i * 3 + 2] = (f.e[2] * vx + f.n[2] * vz) / R;
    m.heading[i] = heading;
  }

  /** blocks for a snapshot at `tick` (positions analytic in the tick) */
  snapshot(tick: number): { agents: MoverBlock; animals: MoverBlock; buildings: BuildingBlock | null } {
    const A = this.agents;
    for (let i = 0; i < this.agentList.length; i++) {
      const a = this.agentList[i];
      const f = a.site.frame;
      A.id[i] = a.id; A.species[i] = a.species; A.flags[i] = a.flags; A.carry[i] = a.carry; A.group[i] = a.group;
      A.scale[i] = a.scale; A.tint[i] = a.tint; A.alt[i] = a.alt; A.phase[i] = a.phase;
      if (a.mode === 0) {
        if (!a.cached) { this.put(A, i, f, a.x, a.z, 0, 0, a.heading); a.cached = [A.pos[i * 3], A.pos[i * 3 + 1], A.pos[i * 3 + 2]]; }
        else { A.pos[i * 3] = a.cached[0]; A.pos[i * 3 + 1] = a.cached[1]; A.pos[i * 3 + 2] = a.cached[2]; A.vel[i * 3] = A.vel[i * 3 + 1] = A.vel[i * 3 + 2] = 0; A.heading[i] = a.heading; }
        A.anim[i] = a.anim;
      } else if (a.mode === 1 && a.chain) {
        const span = Math.max(1, a.s1 - a.s0);
        const u = (tick * a.speed + a.phase * span * 2) % (span * 2);
        const fwd = u < span;
        const s = a.s0 + (fwd ? u : span * 2 - u);
        const [px, pz, tx, tz, wear] = this.at(a.chain, s);
        const sgn = fwd ? 1 : -1;
        // keep to a lane of the street (people walk on both sides)
        const lane = a.lane * roadWidth(wear) * 0.35 * sgn;
        this.put(A, i, f, px - tz * lane, pz + tx * lane, tx * a.speed * sgn, tz * a.speed * sgn, LookdevLife.heading(tx * sgn, tz * sgn));
        A.anim[i] = a.animMove;
      } else if (a.mode === 2) {
        const w = a.speed / Math.max(1, a.radius);
        const t = tick * w + a.phase * 6.28;
        const x = a.x + Math.sin(t) * a.radius, z = a.z + Math.cos(t) * a.radius;
        const vx = Math.cos(t) * a.radius * w, vz = -Math.sin(t) * a.radius * w;
        this.put(A, i, f, x, z, vx, vz, LookdevLife.heading(vx, vz));
        A.anim[i] = a.animMove;
      } else {
        const L = Math.hypot(a.x2 - a.x, a.z2 - a.z) || 1;
        const u = (tick * a.speed + a.phase * L * 2) % (L * 2);
        const fwd = u < L;
        const k = (fwd ? u : L * 2 - u) / L;
        const dx = (a.x2 - a.x) / L, dz = (a.z2 - a.z) / L, sgn = fwd ? 1 : -1;
        this.put(A, i, f, a.x + (a.x2 - a.x) * k, a.z + (a.z2 - a.z) * k, dx * a.speed * sgn, dz * a.speed * sgn, LookdevLife.heading(dx * sgn, dz * sgn));
        A.anim[i] = a.animMove;
      }
    }
    const M = this.animals;
    for (let i = 0; i < this.herdIndex.length; i++) {
      const { herd: h, k } = this.herdIndex[i];
      const f = h.site.frame;
      const sd = hashFloat(h.group, k, 3);
      M.id[i] = 50000 + i; M.species[i] = h.species; M.group[i] = h.group; M.flags[i] = 0; M.carry[i] = -1;
      M.scale[i] = 0.85 + 0.3 * hashFloat(h.group, k, 5); M.tint[i] = Math.floor(hashFloat(h.group, k, 7) * 0xffffff); M.phase[i] = sd;
      // the herd's centre wanders slowly around its anchor
      const da = h.drift + tick * 0.0004;
      const hcx = h.cx + Math.sin(da) * h.radius * 0.6, hcz = h.cz + Math.cos(da) * h.radius * 0.6;
      if (h.kind === 'flock' || h.kind === 'pack' || h.kind === 'shoal') {
        const w = h.speed / Math.max(4, h.radius);
        const t = tick * w + k * (h.kind === 'pack' ? 0.18 : 0.45) + h.seed * 6.28;
        const rr = h.radius * (0.75 + 0.5 * hashFloat(h.group, k, 9));
        const x = hcx + Math.sin(t) * rr, z = hcz + Math.cos(t) * rr;
        const vx = Math.cos(t) * rr * w, vz = -Math.sin(t) * rr * w;
        this.put(M, i, f, x, z, vx, vz, LookdevLife.heading(vx, vz));
        M.alt[i] = h.alt + (h.kind === 'flock' ? 6 * Math.sin(t * 2 + k) + 4 * hashFloat(h.group, k, 11) : 0);
        M.anim[i] = h.kind === 'flock' ? AnimState.fly : h.kind === 'shoal' ? AnimState.swim : AnimState.run;
      } else if (h.kind === 'swarm') {
        this.put(M, i, f, hcx, hcz, 0, 0, 0);
        M.alt[i] = h.alt; M.anim[i] = AnimState.fly;
      } else {
        // grazing: members scattered around the centre, mostly heads down, a few walking or watching
        const a = hashFloat(h.group, k, 13) * 6.28, r = Math.sqrt(hashFloat(h.group, k, 17)) * h.radius;
        const x = (h.kind === 'pen' ? h.cx : hcx) + Math.sin(a) * r, z = (h.kind === 'pen' ? h.cz : hcz) + Math.cos(a) * r;
        const st = hashFloat(h.group, k, Math.floor(tick / 300) + 19);
        const anim = st < 0.6 ? AnimState.graze : st < 0.85 ? AnimState.idle : AnimState.walk;
        const hd = hashFloat(h.group, k, 23) * 6.28 + (h.kind === 'solo' ? tick * 0.002 : 0);
        const v = anim === AnimState.walk ? h.speed : 0;
        this.put(M, i, f, x, z, Math.sin(hd) * v, Math.cos(hd) * v, hd);
        M.alt[i] = h.alt; M.anim[i] = anim;
      }
    }
    // construction creeps on (re-sent only when it does)
    let blk: BuildingBlock | null = null;
    if (Math.abs(tick - this.lastBuildTick) > 240) {
      this.lastBuildTick = tick;
      let changed = false;
      for (let i = 0; i < this.blds.length; i++) {
        const b = this.blds[i];
        if (b.progress >= 1) continue;
        const p = 0.15 + ((b.progress + tick / 40000) % 0.84);
        if (Math.abs(p - this.buildings.progress[i]) > 0.01) { this.buildings.progress[i] = p; changed = true; }
      }
      if (changed) { this.buildings = { ...this.buildings }; blk = this.buildings; }
    }
    return { agents: A, animals: M, buildings: blk };
  }
}

function eraIdx(era: string): number {
  return ['stone', 'fire', 'clay', 'bronze', 'iron', 'classical', 'medieval', 'gunpowder', 'steam', 'electric', 'space'].indexOf(era);
}
