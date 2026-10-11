// GENESIS — procedural ships (CONTRACT.md §12, §15.6): every vessel a people can make, from lashed logs to a town that
// flies between the worlds, built in code out of the mesh kit (render/gen/meshkit.ts) — no assets.
//
//   raft            lashed logs, a steering oar, a square scrap of cloth on a pole
//   boat            a planked boat with a lugsail (or oars shipped)
//   sailship        by era: a single-masted cog with castles (bronze → medieval), a three-masted carrack / galleon
//                   (gunpowder), a three-masted steam clipper with a funnel (steam and later); sails are their own
//                   cloth grids (aCloth) that the ship material billows in the wind
//   airship         a rigid zeppelin: doped-fabric envelope over polygonal girders, cruciform tail with rudders and
//                   elevators, a control gondola with windows, engine cars with propellers
//   rocket          by era: a bamboo-and-paper war rocket on its guide stick (gunpowder), a two-stage riveted liquid
//                   rocket with big fins and a roll pattern (electric), a two-stage liquid rocket with an open truss
//                   interstage, finned first stage, service module, capsule and escape tower (space)
//   orbiter         a two-stage launcher with a payload fairing over a satellite that unfolds its solar wings in orbit
//   generation-ship a super-heavy core with six strap-on boosters under a giant fairing; in space the ark itself:
//                   engine block, tank cluster, truss spine, a rotating habitat ring on spokes, a forward shield
//   lander          the descent forms: a service module with four landing legs under the capsule (rocket), a squat
//                   six-legged ark lander (generation ship)
//   gate            the event-horizon disc of a star gate (the ring itself is the star-gate building)
//
// A ShipModel is a list of PARTS (separate geometries with a pivot) so render/life/ships.ts can animate them: stages
// separate and tumble away, fairing halves swing open and fall, landing legs unfold, the habitat ring turns, solar
// wings unfold, propellers spin. Local frame: spacecraft stand on +Y (engines at the bottom, the base at y = 0);
// boats and airships have +Z at the bow and +Y up (boats: y = 0 is the waterline; airships: y = 0 is the hull axis).
// Surfaces (aKit.x) are the ship material's codes (SS below) plus the building kit's wood / cloth / rope codes.

import type { BufferGeometry } from 'three';
import { KitBuilder, mixc, mulc, rgb, type V3 } from './meshkit.ts';
import { SURF } from '../life/catalog.ts';
import { Rng } from '../../sim/core/rng.ts';

type RGB = [number, number, number];

/** ship surface codes (the ship material, render/life/ships.ts); wood, cloth and rope use the building kit's codes */
export const SS = {
  paint: 40, metal: 41, tile: 42, foam: 43, foil: 44, solar: 45, glass: 46, bell: 47, fabric: 48, checker: 49,
  rivet: 50, rubber: 51, brass: 52, paper: 53, lamp: 54, black: 55, sailcloth: 56, steel: 57, horizon: 58,
  planks: SURF.planks, beam: SURF.beam, bark: SURF.bark, rope: SURF.rope, iron: SURF.iron, lacquer: SURF.lacquer, cloth: SURF.cloth,
} as const;

/** part codes (aKit.y): what a face does in the shader */
export const SPART = { hull: 0, engine: 1, glass: 2, lamp: 3, sail: 4, prop: 5, ring: 6, flag: 7, frost: 8, portal: 9 } as const;

export type ShipShape = 'raft' | 'boat' | 'sailship' | 'airship' | 'rocket' | 'orbiter' | 'generation-ship' | 'lander' | 'ark-lander' | 'gate' | 'satellite' | 'ark';

/** how a part moves */
export type PartRole = 'static' | 'stage' | 'fairing' | 'leg' | 'ring' | 'prop' | 'wing' | 'tower' | 'sail' | 'portal' | 'booster';

export interface EngineMount {
  /** nozzle exit centre (local), exit radius (m), the stage it belongs to, thrust share */
  pos: V3;
  radius: number;
  stage: number;
  /** a vacuum engine (wide plume) / a sea-level one (tight plume with Mach diamonds) */
  vacuum: boolean;
}

export interface ShipPart {
  name: string;
  geo: BufferGeometry;
  role: PartRole;
  /** the stage index it goes with (0 = first stage, jettisoned first); -1 = the ship proper */
  stage: number;
  /** animation pivot (local) and axis */
  pivot: V3;
  axis: V3;
  /** cloth (billowing sails): drawn with the sail variant of the ship material */
  cloth: boolean;
}

export interface ShipModel {
  shape: ShipShape;
  era: string;
  /** overall height (spacecraft, along +Y) or length (boats, airships, along Z), and the bounding radius */
  height: number;
  radius: number;
  parts: ShipPart[];
  engines: EngineMount[];
  /** heights (local y) where each stage ends (separation planes), first stage first */
  stageTops: number[];
  /** the fairing's base height (jettison), or -1 */
  fairingBase: number;
  /** crew-access / umbilical heights on a launcher (for the pad rig), the body radius there */
  umbilicals: { y: number; r: number }[];
  /** body radius at the base (pad rig, lit ground) */
  baseRadius: number;
}

// ───────────────────────────── palette (linear albedo) ─────────────────────────────

const WHITE: RGB = rgb(0.74, 0.74, 0.72);
const OFFWHITE: RGB = rgb(0.62, 0.6, 0.55);
const BLACK: RGB = rgb(0.035, 0.035, 0.038);
const DARK: RGB = rgb(0.09, 0.09, 0.1);
const STEELC: RGB = rgb(0.52, 0.53, 0.55);
const ALU: RGB = rgb(0.6, 0.61, 0.62);
const OLIVE: RGB = rgb(0.16, 0.18, 0.1);
const GREYPAINT: RGB = rgb(0.32, 0.33, 0.33);
const FOAMC: RGB = rgb(0.42, 0.16, 0.04);
const GOLD: RGB = rgb(0.8, 0.55, 0.16);
const BELLC: RGB = rgb(0.16, 0.15, 0.15);
const BRASSC: RGB = rgb(0.62, 0.42, 0.16);
const WOOD: RGB = rgb(0.2, 0.12, 0.065);
const WOOD_DARK: RGB = rgb(0.11, 0.07, 0.04);
const WOOD_PALE: RGB = rgb(0.33, 0.24, 0.15);
const TAR: RGB = rgb(0.05, 0.04, 0.035);
const CANVAS: RGB = rgb(0.62, 0.56, 0.45);
const ROPE: RGB = rgb(0.24, 0.19, 0.12);
const RED: RGB = rgb(0.42, 0.05, 0.03);
const FABRIC: RGB = rgb(0.6, 0.58, 0.52);
const BAMBOO: RGB = rgb(0.42, 0.33, 0.16);
const PAPER_RED: RGB = rgb(0.5, 0.08, 0.04);
const IRON: RGB = rgb(0.12, 0.11, 0.1);
const GLASSC: RGB = rgb(0.03, 0.04, 0.05);
const SOLARC: RGB = rgb(0.03, 0.05, 0.14);

// ───────────────────────────── the part builder ─────────────────────────────

class Parts {
  readonly list: { name: string; k: KitBuilder; role: PartRole; stage: number; pivot: V3; axis: V3; cloth: boolean }[] = [];
  part(name: string, role: PartRole = 'static', stage = -1, pivot: V3 = [0, 0, 0], axis: V3 = [0, 1, 0], cloth = false): KitBuilder {
    const k = new KitBuilder();
    this.list.push({ name, k, role, stage, pivot, axis, cloth });
    return k;
  }
  build(): ShipPart[] {
    return this.list.filter((p) => p.k.idx.length > 0).map((p) => ({ name: p.name, geo: p.k.build(), role: p.role, stage: p.stage, pivot: p.pivot, axis: p.axis, cloth: p.cloth }));
  }
}

const TAU = Math.PI * 2;

/** a bell nozzle hanging down: exit (rim) at y0, throat at y0 + len; outside and inside surfaces */
function bell(k: KitBuilder, cx: number, cz: number, y0: number, len: number, rExit: number, rThroat: number, sides: number, col: RGB = BELLC): void {
  const n = 7;
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // a parabolic contour: wide at the exit, pinching to the throat
    const r = rThroat + (rExit - rThroat) * Math.pow(1 - t, 1.6);
    out.push([r, y0 + t * len]);
  }
  k.lathe(cx, cz, out, sides, SS.bell, SPART.engine, col, 0.9, 1);
  const inner = out.map(([r, y]) => [Math.max(0.01, r - 0.025), y] as [number, number]).reverse();
  k.lathe(cx, cz, inner, sides, SS.bell, SPART.engine, mulc(col, 0.6), 0.4, 0.8);
  // the combustion chamber and turbopump plumbing above the throat
  k.cylinder(cx, cz, y0 + len, y0 + len + rThroat * 2.2, rThroat * 1.6, rThroat * 1.3, Math.max(8, sides >> 1), SS.metal, SPART.hull, mulc(STEELC, 0.8), { top: true });
}

/** a cylindrical tank section (uv: u around in metres, v = height) */
function tank(k: KitBuilder, y0: number, y1: number, r0: number, r1: number, surf: number, col: RGB, sides = 28): void {
  k.cylinder(0, 0, y0, y1, r0, r1, sides, surf, SPART.hull, col, { aoLow: 0.92, aoHigh: 1 });
}

/** a closing bulkhead / dome on a tank top (lathe) */
function dome(k: KitBuilder, y0: number, r: number, h: number, surf: number, col: RGB, sides = 28, part: number = SPART.hull): void {
  const prof: [number, number][] = [];
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    prof.push([Math.max(0.01, r * Math.cos(a)), y0 + h * Math.sin(a)]);
  }
  k.lathe(0, 0, prof, sides, surf, part, col, 1, 1);
}

/** an ogive / conical nose from radius r at y0 to a point at y0 + h */
function ogive(k: KitBuilder, y0: number, r: number, h: number, surf: number, col: RGB, sides = 28, tipR = 0.02): void {
  const prof: [number, number][] = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // tangent ogive: radius falls slowly at first then curves to the tip
    const rr = Math.max(tipR, r * Math.sqrt(Math.max(0, 1 - t * t)) * (1 - 0.18 * t));
    prof.push([rr, y0 + t * h]);
  }
  k.lathe(0, 0, prof, sides, surf, SPART.hull, col, 1, 1);
}

/** a trapezoidal fin (a slab with thickness) on the +X side, rotated by yaw about +Y */
function fin(k: KitBuilder, yaw: number, rBody: number, yRoot0: number, yRoot1: number, span: number, yTip0: number, yTip1: number, thick: number, surf: number, col: RGB): void {
  k.push(0, 0, 0, yaw);
  const x0 = rBody - 0.02, x1 = rBody + span;
  // the fin plane is z = 0; slab corners CCW from +Z
  k.slab([x0, yRoot0, thick / 2], [x1, yTip0, thick / 2], [x1, yTip1, thick / 2], [x0, yRoot1, thick / 2], thick, surf, SPART.hull, col, surf, mulc(col, 0.8), 1);
  k.pop();
}

/** a ring of truss struts between two radii / heights (an open interstage, a tower) */
function truss(k: KitBuilder, y0: number, y1: number, r0: number, r1: number, n: number, w: number, col: RGB, surf: number = SS.metal): void {
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
    const p = (a: number, y: number, r: number): V3 => [Math.cos(a) * r, y, Math.sin(a) * r];
    k.beam(p(a0, y0, r0), p(a1, y1, r1), w, w, surf, SPART.hull, col, 0.9);
    k.beam(p(a1, y0, r0), p(a0, y1, r1), w, w, surf, SPART.hull, col, 0.9);
    k.beam(p(a0, y0, r0), p(a0, y1, r1), w * 1.2, w * 1.2, surf, SPART.hull, col, 0.9);
  }
  // rings top and bottom
  k.tube(Array.from({ length: n * 2 + 1 }, (_, i) => { const a = (i / (n * 2)) * TAU; return [Math.cos(a) * r0, y0, Math.sin(a) * r0] as V3; }), new Array(n * 2 + 1).fill(w * 0.9), 5, surf, SPART.hull, col);
  k.tube(Array.from({ length: n * 2 + 1 }, (_, i) => { const a = (i / (n * 2)) * TAU; return [Math.cos(a) * r1, y1, Math.sin(a) * r1] as V3; }), new Array(n * 2 + 1).fill(w * 0.9), 5, surf, SPART.hull, col);
}

/** a raceway / cable tunnel along the body on the side at angle a */
function raceway(k: KitBuilder, a: number, r: number, y0: number, y1: number, col: RGB): void {
  k.push(0, 0, 0, -a);
  k.box(r - 0.02, y0, -0.16, r + 0.16, y1, 0.16, SS.paint, SPART.hull, col, { skip: ['bottom'] });
  k.pop();
}

/** small lamps (navigation / beacon) */
function lamp(k: KitBuilder, x: number, y: number, z: number, s: number): void {
  k.box(x - s, y - s, z - s, x + s, y + s, z + s, SS.lamp, SPART.lamp, rgb(0.6, 0.1, 0.08), {});
}

/** a window (dark glass quad lifted a few mm off a surface whose outward normal is n at point c) */
function windowQuad(k: KitBuilder, c: V3, n: V3, up: V3, w: number, h: number): void {
  const rx = up[1] * n[2] - up[2] * n[1], ry = up[2] * n[0] - up[0] * n[2], rz = up[0] * n[1] - up[1] * n[0];
  const o: V3 = [c[0] + n[0] * 0.02, c[1] + n[1] * 0.02, c[2] + n[2] * 0.02];
  const P = (i: number, j: number): V3 => [o[0] + rx * w * i + up[0] * h * j, o[1] + ry * w * i + up[1] * h * j, o[2] + rz * w * i + up[2] * h * j];
  k.quad(P(-0.5, -0.5), P(0.5, -0.5), P(0.5, 0.5), P(-0.5, 0.5), SS.glass, SPART.glass, GLASSC, 1);
}

// ───────────────────────────── launchers ─────────────────────────────

interface StageSpec { y0: number; y1: number; r: number }

/** the space-era crewed rocket: finned first stage, open truss interstage, second stage, service module, capsule, escape tower */
function spaceRocket(P: Parts, rng: Rng, lander: boolean): Omit<ShipModel, 'shape' | 'era' | 'parts'> {
  const engines: EngineMount[] = [];
  const R = 1.9;
  const S1: StageSpec = { y0: 0, y1: 17, r: R };
  const S2: StageSpec = { y0: 19.6, y1: 28, r: R };
  if (!lander) {
    // ── stage 1 ──
    const k = P.part('stage1', 'stage', 0);
    // engine skirt: a flared thrust section with heat shield at the base
    k.cylinder(0, 0, 0.6, 2.6, R * 1.12, R, 32, SS.paint, SPART.hull, mulc(WHITE, 0.92), { bottom: true });
    tank(k, 2.6, S1.y1, R, R, SS.paint, WHITE, 32);
    // roll pattern: black quadrants on the top of the stage and a black band at the bottom of the tank
    tank(k, 13.2, 16.4, R + 0.004, R + 0.004, SS.checker, WHITE, 32);
    tank(k, 2.6, 3.4, R + 0.004, R + 0.004, SS.black, BLACK, 32);
    // engines: one centre, four around
    const pts: [number, number][] = [[0, 0], [1.05, 0], [-1.05, 0], [0, 1.05], [0, -1.05]];
    for (const [x, z] of pts) {
      bell(k, x, z, -1.6, 2.2, 0.48, 0.16, 18);
      engines.push({ pos: [x, -1.6, z], radius: 0.48, stage: 0, vacuum: false });
    }
    // fins at the four quarters, between the outer engines
    for (let i = 0; i < 4; i++) fin(k, Math.PI / 4 + (i * Math.PI) / 2, R * 1.08, 0.7, 5.6, 2.1, 0.7, 2.9, 0.16, SS.paint, mulc(WHITE, 0.9));
    raceway(k, 0.2, R, 2.8, 16.8, mulc(WHITE, 0.8));
    raceway(k, Math.PI + 0.2, R, 2.8, 16.8, mulc(WHITE, 0.8));
    // the open truss interstage rides up with stage 1 (the second stage's engine shows through it)
    truss(k, S1.y1, S2.y0, R * 0.97, R * 0.97, 12, 0.12, mulc(STEELC, 0.75));
  }
  // ── stage 2 ──
  const k2 = P.part('stage2', 'stage', lander ? -1 : 1);
  if (!lander) {
    tank(k2, S2.y0, S2.y1, R, R, SS.paint, WHITE, 32);
    tank(k2, S2.y1 - 2.2, S2.y1 - 0.4, R + 0.004, R + 0.004, SS.checker, WHITE, 32);
    k2.cylinder(0, 0, S2.y0 - 0.25, S2.y0, R * 0.9, R, 32, SS.metal, SPART.hull, ALU, { bottom: true });
    bell(k2, 0, 0, S2.y0 - 2.7, 2.45, 1.05, 0.22, 24);
    engines.push({ pos: [0, S2.y0 - 2.7, 0], radius: 1.05, stage: 1, vacuum: true });
    raceway(k2, 0.2, R, S2.y0 + 0.2, S2.y1 - 0.2, mulc(WHITE, 0.8));
  }
  // ── service module (+ legs when it is the lander) ──
  const base = lander ? 1.4 : S2.y1;
  const smTop = base + 3.0;
  const ks = P.part('service', 'static', -1);
  // adapter cone (spacecraft adapter) on the launcher; a short skirt on the lander
  if (!lander) ks.cylinder(0, 0, base, base + 0.7, R, 1.6, 32, SS.paint, SPART.hull, WHITE, {});
  ks.cylinder(0, 0, lander ? base : base + 0.7, smTop, 1.6, 1.6, 28, SS.metal, SPART.hull, mulc(ALU, 0.95), { bottom: lander });
  // radiator panels and RCS quads around the service module
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    ks.push(0, 0, 0, -a);
    ks.box(1.6, smTop - 1.0, -0.22, 1.82, smTop - 0.5, 0.22, SS.metal, SPART.hull, mulc(ALU, 0.7), {});
    for (const dz of [-0.2, 0.2]) ks.cylinder(1.86, dz, smTop - 0.75, smTop - 0.55, 0.04, 0.07, 6, SS.bell, SPART.engine, BELLC, {});
    ks.box(1.601, base + 1.0, -0.5, 1.63, smTop - 1.2, 0.5, SS.paint, SPART.hull, mulc(WHITE, 1.05), {});
    ks.pop();
  }
  bell(ks, 0, 0, base - (lander ? 1.3 : 0.4) , lander ? 1.3 : 0.9, lander ? 0.62 : 0.55, 0.14, 18);
  engines.push({ pos: [0, base - (lander ? 1.3 : 0.4), 0], radius: lander ? 0.62 : 0.55, stage: lander ? 0 : 2, vacuum: !lander });
  if (lander) {
    // four landing legs: struts from the module's skirt to round foot pads, hinged at the top (pivot) to fold up
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      const hinge: V3 = [ca * 1.55, smTop - 0.6, sa * 1.55];
      const kl = P.part(`leg${i}`, 'leg', -1, hinge, [-sa, 0, ca]);
      const foot: V3 = [ca * 3.4, -0.05, sa * 3.4];
      kl.tube([hinge, [ca * 2.9, 0.9, sa * 2.9], foot], [0.11, 0.1, 0.09], 8, SS.metal, SPART.hull, ALU, {});
      kl.beam([ca * 1.6, base + 0.4, sa * 1.6], [ca * 2.9, 0.9, sa * 2.9], 0.08, 0.08, SS.metal, SPART.hull, mulc(ALU, 0.8), 0.9);
      kl.cylinder(foot[0], foot[2], -0.12, 0.02, 0.42, 0.36, 12, SS.foil, SPART.hull, GOLD, { top: true });
    }
  }
  // ── capsule ──
  const kc = P.part('capsule', 'static', -1);
  const cb = smTop;
  // heat shield (black, slightly domed), the conical crew cabin, the docking tunnel
  kc.lathe(0, 0, [[0.02, cb - 0.18], [0.9, cb - 0.12], [1.62, cb]], 28, SS.tile, SPART.hull, BLACK, 0.8, 1);
  kc.lathe(0, 0, [[1.62, cb], [1.55, cb + 0.25], [0.55, cb + 3.0], [0.46, cb + 3.05]], 28, SS.paint, SPART.hull, mixc(WHITE, OFFWHITE, 0.4), 0.95, 1);
  kc.cylinder(0, 0, cb + 3.05, cb + 3.5, 0.42, 0.42, 16, SS.metal, SPART.hull, ALU, { top: true });
  for (const a of [0.35, -0.35]) {
    const ca = Math.cos(a), sa = Math.sin(a);
    const y = cb + 1.5;
    const r = 1.62 + (0.55 - 1.62) * ((y - cb - 0.25) / 2.75);
    const slope = (1.62 - 0.55) / 2.75;
    const nl = Math.hypot(1, slope);
    windowQuad(kc, [ca * r, y, sa * r], [ca / nl, slope / nl, sa / nl], [-ca * slope / nl, 1 / nl, -sa * slope / nl], 0.32, 0.36);
  }
  // hatch outline (a darker plate)
  kc.push(0, 0, 0, Math.PI);
  kc.box(1.05, cb + 0.9, -0.38, 1.13, cb + 1.85, 0.38, SS.paint, SPART.hull, mulc(OFFWHITE, 0.8), {});
  kc.pop();
  let height = cb + 3.5;
  const umbilicals: { y: number; r: number }[] = [];
  if (!lander) {
    // escape tower: a truss pyramid carrying the escape motor with four canted nozzles
    const kt = P.part('tower', 'tower', 2);
    const t0 = cb + 3.5, t1 = t0 + 2.6;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + Math.PI / 4;
      kt.beam([Math.cos(a) * 0.7, cb + 2.2, Math.sin(a) * 0.7], [Math.cos(a) * 0.22, t1, Math.sin(a) * 0.22], 0.07, 0.07, SS.metal, SPART.hull, mulc(STEELC, 0.6), 0.9);
      kt.beam([Math.cos(a) * 0.55, cb + 2.8, Math.sin(a) * 0.55], [Math.cos(a + Math.PI / 2) * 0.35, t0 + 1.6, Math.sin(a + Math.PI / 2) * 0.35], 0.05, 0.05, SS.metal, SPART.hull, mulc(STEELC, 0.6), 0.9);
    }
    kt.cylinder(0, 0, t1, t1 + 2.6, 0.3, 0.3, 16, SS.paint, SPART.hull, mulc(WHITE, 0.95), {});
    kt.lathe(0, 0, [[0.3, t1 + 2.6], [0.24, t1 + 3.1], [0.08, t1 + 3.5], [0.02, t1 + 3.6]], 16, SS.paint, SPART.hull, RED, 1, 1);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      kt.cylinder(Math.cos(a) * 0.3, Math.sin(a) * 0.3, t1 + 0.2, t1 + 0.55, 0.11, 0.07, 8, SS.bell, SPART.engine, BELLC, {});
    }
    height = t1 + 3.6;
    umbilicals.push({ y: 12.4, r: R }, { y: 22.4, r: R }, { y: 30.4, r: 1.6 });
    void rng;
  }
  return {
    height, radius: Math.max(height * 0.5, 4), engines, stageTops: lander ? [] : [S1.y1, S2.y0 + (S2.y1 - S2.y0)],
    fairingBase: -1, umbilicals, baseRadius: lander ? 3.4 : R * 1.12,
  };
}

/** the electric-era rocket: a riveted, finned first stage in a roll pattern carrying a slim upper stage and capsule */
function electricRocket(P: Parts, rng: Rng): Omit<ShipModel, 'shape' | 'era' | 'parts'> {
  const engines: EngineMount[] = [];
  const R1 = 0.9, R2 = 0.62;
  const k = P.part('stage1', 'stage', 0);
  // tail section flares a little toward the fins; tank checker in the roll pattern
  k.cylinder(0, 0, 0.3, 2.4, R1 * 0.85, R1, 24, SS.rivet, SPART.hull, OLIVE, { bottom: true });
  tank(k, 2.4, 8.6, R1, R1, SS.checker, mulc(WHITE, 0.92), 24);
  k.cylinder(0, 0, 8.6, 11.6, R1, R2 * 1.02, 24, SS.rivet, SPART.hull, OLIVE, {});
  for (let i = 0; i < 4; i++) fin(k, (i * Math.PI) / 2, R1 * 0.86, 0.1, 3.6, 1.55, -0.2, 0.9, 0.12, SS.checker, mulc(WHITE, 0.9));
  // graphite jet vanes under the nozzle and one large engine
  bell(k, 0, 0, -0.9, 1.3, 0.42, 0.15, 18, mulc(IRON, 1.4));
  engines.push({ pos: [0, -0.9, 0], radius: 0.42, stage: 0, vacuum: false });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    k.box(Math.cos(a) * 0.2 - 0.04, -1.25, Math.sin(a) * 0.2 - 0.04, Math.cos(a) * 0.44 + 0.04, -0.6, Math.sin(a) * 0.44 + 0.04, SS.black, SPART.hull, DARK, {});
  }
  // stage 2 (separates at 11.6)
  const k2 = P.part('stage2', 'stage', 1);
  k2.cylinder(0, 0, 11.6, 12.0, R2 * 1.02, R2, 20, SS.black, SPART.hull, DARK, { bottom: true });
  tank(k2, 12.0, 17.2, R2, R2, SS.rivet, mulc(GREYPAINT, 1.2), 20);
  for (let i = 0; i < 3; i++) fin(k2, (i * TAU) / 3, R2, 12.0, 13.6, 0.5, 11.9, 12.5, 0.07, SS.rivet, OLIVE);
  bell(k2, 0, 0, 11.0, 0.95, 0.36, 0.12, 14);
  engines.push({ pos: [0, 11.0, 0], radius: 0.36, stage: 1, vacuum: true });
  // the capsule: a blunt cone with portholes
  const kc = P.part('capsule', 'static', -1);
  kc.lathe(0, 0, [[R2, 17.2], [R2 * 0.98, 17.5], [0.3, 19.6], [0.12, 19.9], [0.02, 19.95]], 20, SS.rivet, SPART.hull, mulc(STEELC, 0.75), 1, 1);
  windowQuad(kc, [0.5, 18.2, 0], [0.93, 0.36, 0], [-0.36, 0.93, 0], 0.22, 0.22);
  windowQuad(kc, [-0.5, 18.2, 0], [-0.93, 0.36, 0], [0.36, 0.93, 0], 0.22, 0.22);
  lamp(kc, 0, 19.95, 0, 0.05);
  void rng;
  return { height: 20, radius: 10, engines, stageTops: [11.6, 17.2], fairingBase: -1, umbilicals: [{ y: 6, r: R1 }, { y: 14, r: R2 }], baseRadius: R1 + 1.4 };
}

/** a gunpowder war rocket: bamboo tube wrapped in red paper and cord, an iron head, a long guide stick */
function gunpowderRocket(P: Parts, rng: Rng): Omit<ShipModel, 'shape' | 'era' | 'parts'> {
  const k = P.part('stage1', 'stage', 0);
  const r = 0.11, L = 1.5;
  const y0 = 2.0;
  // bamboo with nodes every ~30 cm
  const prof: [number, number][] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const node = Math.abs((t * 5) % 1 - 0.5) < 0.06 ? 1.08 : 1;
    prof.push([r * node, y0 + t * L]);
  }
  k.lathe(0, 0, prof, 12, SS.paper, SPART.hull, BAMBOO, 1, 1);
  // paper wraps and cord lashings
  for (let i = 0; i < 3; i++) k.cylinder(0, 0, y0 + 0.2 + i * 0.45, y0 + 0.42 + i * 0.45, r * 1.06, r * 1.06, 12, SS.paper, SPART.hull, PAPER_RED, {});
  for (let i = 0; i < 6; i++) k.cylinder(0, 0, y0 + 0.08 + i * 0.27, y0 + 0.12 + i * 0.27, r * 1.1, r * 1.1, 10, SS.rope, SPART.hull, ROPE, {});
  // the iron head and its barbs
  k.lathe(0, 0, [[r * 1.05, y0 + L], [r * 1.25, y0 + L + 0.05], [0.04, y0 + L + 0.45], [0.005, y0 + L + 0.52]], 10, SS.iron, SPART.hull, IRON, 1, 1);
  // the guide stick, lashed along the side, and paper vanes at its end
  k.tube([[r + 0.03, y0 + L * 0.9, 0], [r + 0.04, 0.1, 0]], [0.025, 0.018], 6, SS.bark, SPART.hull, WOOD_PALE, {});
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    k.quad([r + 0.04, 0.15, 0], [r + 0.04 + Math.cos(a) * 0.14, 0.2, Math.sin(a) * 0.14], [r + 0.04 + Math.cos(a) * 0.14, 0.55, Math.sin(a) * 0.14], [r + 0.04, 0.55, 0], SS.paper, SPART.hull, PAPER_RED, 1);
  }
  // the fuse
  k.tube([[0, y0 - 0.02, 0], [0.05, y0 - 0.15, 0.02], [0.08, y0 - 0.3, 0.0]], [0.008, 0.008, 0.006], 4, SS.rope, SPART.hull, ROPE, {});
  void rng;
  return { height: y0 + L + 0.52, radius: 2, engines: [{ pos: [0, y0, 0], radius: r * 0.8, stage: 0, vacuum: false }], stageTops: [], fairingBase: -1, umbilicals: [], baseRadius: 0.4 };
}

/** an orbiter launcher: two stages and a payload fairing over the satellite */
function orbiterLauncher(P: Parts, rng: Rng): Omit<ShipModel, 'shape' | 'era' | 'parts'> {
  const engines: EngineMount[] = [];
  const R = 1.6;
  const k = P.part('stage1', 'stage', 0);
  k.cylinder(0, 0, 0.5, 2.2, R * 1.1, R, 28, SS.paint, SPART.hull, WHITE, { bottom: true });
  tank(k, 2.2, 15, R, R, SS.paint, WHITE, 28);
  tank(k, 6, 10.5, R + 0.004, R + 0.004, SS.foam, FOAMC, 28);
  tank(k, 12.2, 14.6, R + 0.004, R + 0.004, SS.checker, WHITE, 28);
  for (const [x, z] of [[0.75, 0], [-0.75, 0], [0, 0.75], [0, -0.75]] as [number, number][]) {
    bell(k, x, z, -1.4, 1.9, 0.42, 0.14, 16);
    engines.push({ pos: [x, -1.4, z], radius: 0.42, stage: 0, vacuum: false });
  }
  for (let i = 0; i < 4; i++) fin(k, Math.PI / 4 + (i * Math.PI) / 2, R * 1.06, 0.6, 3.6, 1.2, 0.5, 1.6, 0.12, SS.paint, mulc(WHITE, 0.92));
  truss(k, 15, 17, R * 0.96, R * 0.96, 10, 0.1, mulc(STEELC, 0.75));
  const k2 = P.part('stage2', 'stage', 1);
  tank(k2, 17, 23, R, R, SS.paint, WHITE, 28);
  k2.cylinder(0, 0, 16.8, 17, R * 0.9, R, 28, SS.metal, SPART.hull, ALU, { bottom: true });
  bell(k2, 0, 0, 15.0, 1.95, 0.85, 0.18, 20);
  engines.push({ pos: [0, 15.0, 0], radius: 0.85, stage: 1, vacuum: true });
  // the satellite rides inside the fairing (built by satellite(), offset to y = 23.4)
  const fb = 23.0, fr = 1.85;
  for (const side of [0, 1]) {
    const a0 = side * Math.PI, a1 = a0 + Math.PI;
    const kf = P.part(`fairing${side}`, 'fairing', 2, [Math.cos(a0 + Math.PI / 2) * fr, fb, Math.sin(a0 + Math.PI / 2) * fr], [Math.cos(a0), 0, Math.sin(a0)]);
    kf.cylinder(0, 0, fb, fb + 4.2, fr, fr, 16, SS.paint, SPART.hull, WHITE, { arc: [a0, a1] });
    // ogive half
    const n = 7;
    let prev: [number, number] = [fr, fb + 4.2];
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const rr = Math.max(0.02, fr * Math.sqrt(Math.max(0, 1 - t * t)));
      const y = fb + 4.2 + t * 3.2;
      kf.cylinder(0, 0, prev[1], y, prev[0], rr, 16, SS.paint, SPART.hull, WHITE, { arc: [a0, a1] });
      prev = [rr, y];
    }
    // the seam rail
    kf.box(Math.cos(a0) * fr - 0.05, fb, Math.sin(a0) * fr - 0.05, Math.cos(a0) * fr + 0.05, fb + 4.2, Math.sin(a0) * fr + 0.05, SS.metal, SPART.hull, ALU, {});
  }
  void rng;
  return { height: fb + 7.4, radius: 16, engines, stageTops: [15, 23], fairingBase: fb, umbilicals: [{ y: 12.4, r: R }, { y: 22.4, r: R }], baseRadius: R * 1.1 };
}

/** a satellite: foil-wrapped bus, a high-gain dish, two solar wings (parts 'wing0/1' unfold about their roots) */
function satellite(P: Parts, y0: number, deployed: boolean): void {
  const k = P.part('payload', 'static', -1);
  k.box(-0.65, y0, -0.65, 0.65, y0 + 1.7, 0.65, SS.foil, SPART.hull, GOLD, {});
  k.box(-0.5, y0 + 1.7, -0.5, 0.5, y0 + 2.0, 0.5, SS.metal, SPART.hull, ALU, {});
  // the dish on a short mast
  k.tube([[0, y0 + 2.0, 0], [0, y0 + 2.5, 0]], [0.05, 0.05], 6, SS.metal, SPART.hull, ALU, {});
  const prof: [number, number][] = [];
  for (let i = 0; i <= 5; i++) { const t = i / 5; prof.push([0.02 + t * 0.8, y0 + 2.5 + t * t * 0.3]); }
  k.lathe(0, 0, prof, 18, SS.paint, SPART.hull, mulc(WHITE, 1.1), 0.8, 1);
  k.lathe(0, 0, prof.map(([r, y]) => [r, y - 0.02] as [number, number]).reverse(), 18, SS.metal, SPART.hull, ALU, 0.6, 1);
  k.tube([[0, y0 + 2.5, 0], [0, y0 + 2.95, 0]], [0.02, 0.01], 4, SS.metal, SPART.hull, ALU, {});
  lamp(k, 0.66, y0 + 1.6, 0, 0.04);
  for (const side of [-1, 1]) {
    const root: V3 = [side * 0.66, y0 + 0.85, 0];
    const kw = P.part(side < 0 ? 'wing0' : 'wing1', 'wing', -1, root, [0, 0, side]);
    kw.beam(root, [side * 1.1, y0 + 0.85, 0], 0.05, 0.05, SS.metal, SPART.hull, ALU, 0.9);
    // three panels side by side (they fold flat against the bus when stowed)
    for (let i = 0; i < 3; i++) {
      const x0 = side * (1.1 + i * 1.25), x1 = side * (1.1 + i * 1.25 + 1.2);
      const a: V3 = [x0, y0 + 0.2, 0.02], b: V3 = [x1, y0 + 0.2, 0.02], c: V3 = [x1, y0 + 1.5, 0.02], d: V3 = [x0, y0 + 1.5, 0.02];
      if (side > 0) kw.slab(a, b, c, d, 0.03, SS.solar, SPART.hull, SOLARC, SS.metal, ALU, 1);
      else kw.slab(b, a, d, c, 0.03, SS.solar, SPART.hull, SOLARC, SS.metal, ALU, 1);
    }
  }
  void deployed;
}

/** the super-heavy launcher of a generation ship: a wide core, six strap-on boosters, a giant fairing */
function arkLauncher(P: Parts, rng: Rng): Omit<ShipModel, 'shape' | 'era' | 'parts'> {
  const engines: EngineMount[] = [];
  const R = 4.2;
  const k = P.part('stage1', 'stage', 0);
  k.cylinder(0, 0, 0.6, 3.4, R * 1.06, R, 40, SS.steel, SPART.hull, mulc(ALU, 0.92), { bottom: true });
  tank(k, 3.4, 28, R, R, SS.steel, ALU, 40);
  tank(k, 24, 27.4, R + 0.006, R + 0.006, SS.black, BLACK, 40);
  for (let i = 0; i < 9; i++) {
    const a = (i / 8) * TAU;
    const rr = i === 8 ? 0 : 2.6;
    bell(k, Math.cos(a) * rr, Math.sin(a) * rr, -2.2, 2.8, 0.8, 0.24, 20);
    engines.push({ pos: [Math.cos(a) * rr, -2.2, Math.sin(a) * rr], radius: 0.8, stage: 0, vacuum: false });
  }
  for (let i = 0; i < 4; i++) fin(k, Math.PI / 4 + (i * Math.PI) / 2, R, 20, 26, 2.4, 21.5, 25, 0.25, SS.steel, mulc(ALU, 0.9));
  // strap-on boosters (separate first: their own stage index -1 → role 'booster')
  for (let b = 0; b < 6; b++) {
    const a = (b / 6) * TAU + Math.PI / 6;
    const cx = Math.cos(a) * (R + 1.75), cz = Math.sin(a) * (R + 1.75);
    // (axis chosen so a positive angle tips the booster's nose away from the core)
    const kb = P.part(`booster${b}`, 'booster', 0, [cx, 2, cz], [Math.sin(a), 0, -Math.cos(a)]);
    kb.cylinder(cx, cz, 0.4, 22, 1.6, 1.6, 20, SS.paint, SPART.hull, WHITE, { bottom: true });
    kb.push(cx, 22, cz, 0);
    ogive(kb, 0, 1.6, 4.2, SS.paint, WHITE, 20);
    kb.pop();
    kb.cylinder(cx, cz, 14, 17.5, 1.604, 1.604, 20, SS.black, SPART.hull, BLACK, {});
    bell(kb, cx, cz, -1.6, 2.1, 0.75, 0.2, 16);
    engines.push({ pos: [cx, -1.6, cz], radius: 0.75, stage: -2 - b, vacuum: false });
    // attach struts to the core
    kb.beam([cx - Math.cos(a) * 1.6, 4, cz - Math.sin(a) * 1.6], [Math.cos(a) * R, 4, Math.sin(a) * R], 0.25, 0.25, SS.metal, SPART.hull, ALU, 0.9);
    kb.beam([cx - Math.cos(a) * 1.6, 20, cz - Math.sin(a) * 1.6], [Math.cos(a) * R, 20, Math.sin(a) * R], 0.25, 0.25, SS.metal, SPART.hull, ALU, 0.9);
  }
  const k2 = P.part('stage2', 'stage', 1);
  tank(k2, 28.3, 40, R, R, SS.steel, ALU, 40);
  k2.cylinder(0, 0, 28, 28.3, R * 0.94, R, 40, SS.metal, SPART.hull, mulc(ALU, 0.8), { bottom: true });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    bell(k2, Math.cos(a) * 1.6, Math.sin(a) * 1.6, 25.2, 2.9, 1.2, 0.26, 22);
    engines.push({ pos: [Math.cos(a) * 1.6, 25.2, Math.sin(a) * 1.6], radius: 1.2, stage: 1, vacuum: true });
  }
  // the fairing over the folded ark
  const fb = 40, fr = 5.4;
  k2.cylinder(0, 0, fb - 0.6, fb, R, fr, 40, SS.steel, SPART.hull, ALU, {});
  for (const side of [0, 1]) {
    const a0 = side * Math.PI, a1 = a0 + Math.PI;
    const kf = P.part(`fairing${side}`, 'fairing', 2, [Math.cos(a0 + Math.PI / 2) * fr, fb, Math.sin(a0 + Math.PI / 2) * fr], [Math.cos(a0), 0, Math.sin(a0)]);
    kf.cylinder(0, 0, fb, fb + 13, fr, fr, 24, SS.paint, SPART.hull, WHITE, { arc: [a0, a1] });
    let prev: [number, number] = [fr, fb + 13];
    for (let i = 1; i <= 8; i++) {
      const t = i / 8;
      const rr = Math.max(0.05, fr * Math.sqrt(Math.max(0, 1 - t * t)));
      const y = fb + 13 + t * 7.5;
      kf.cylinder(0, 0, prev[1], y, prev[0], rr, 24, SS.paint, SPART.hull, WHITE, { arc: [a0, a1] });
      prev = [rr, y];
    }
    kf.cylinder(0, 0, fb + 3, fb + 4.5, fr + 0.006, fr + 0.006, 24, SS.black, SPART.hull, BLACK, { arc: [a0, a1] });
  }
  void rng;
  return { height: fb + 20.5, radius: 32, engines, stageTops: [28, 40], fairingBase: fb, umbilicals: [{ y: 12.4, r: R }, { y: 22.4, r: R }, { y: 30.4, r: R }], baseRadius: R + 3.4 };
}

/**
 * The ark in space: engine block (aft, −Y), spherical tank cluster, a truss spine, the hub with a rotating habitat
 * ring on spokes ('ring' part, about +Y), forward shield. `folded` keeps the ring segments folded along the spine (it
 * opens after the fairing is gone).
 */
function ark(P: Parts, rng: Rng): Omit<ShipModel, 'shape' | 'era' | 'parts'> {
  const engines: EngineMount[] = [];
  const k = P.part('hull', 'static', -1);
  // engine block
  k.cylinder(0, 0, 0, 4.5, 3.4, 3.0, 28, SS.steel, SPART.hull, mulc(ALU, 0.8), { bottom: true });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    bell(k, Math.cos(a) * 1.9, Math.sin(a) * 1.9, -3.2, 3.4, 0.95, 0.24, 18);
    engines.push({ pos: [Math.cos(a) * 1.9, -3.2, Math.sin(a) * 1.9], radius: 0.95, stage: 0, vacuum: true });
  }
  // radiator wings (dark, edge-on to the sun)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    k.push(0, 0, 0, -a);
    k.box(3.0, 5, -0.06, 11, 13, 0.06, SS.black, SPART.hull, mulc(DARK, 1.6), {});
    k.beam([3.0, 9, 0], [11, 9, 0], 0.12, 0.14, SS.metal, SPART.hull, ALU, 0.9);
    k.pop();
  }
  // tank cluster
  for (let ring = 0; ring < 2; ring++) for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + ring * 0.52;
    const cx = Math.cos(a) * 2.9, cz = Math.sin(a) * 2.9, y = 6.2 + ring * 3.6;
    k.lathe(cx, cz, Array.from({ length: 9 }, (_, j) => { const t = (j / 8) * Math.PI; return [Math.max(0.02, Math.sin(t) * 1.7), y - Math.cos(t) * 1.7] as [number, number]; }), 18, SS.foil, SPART.hull, mixc(GOLD, ALU, ring * 0.6), 0.85, 1);
  }
  // spine truss to the hub
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    k.beam([Math.cos(a) * 1.3, 4.5, Math.sin(a) * 1.3], [Math.cos(a) * 1.3, 30, Math.sin(a) * 1.3], 0.32, 0.32, SS.metal, SPART.hull, mulc(ALU, 0.85), 0.9);
  }
  for (let y = 6; y < 30; y += 3) {
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * TAU, a1 = ((i + 1) / 4) * TAU;
      k.beam([Math.cos(a0) * 1.3, y, Math.sin(a0) * 1.3], [Math.cos(a1) * 1.3, y + 3, Math.sin(a1) * 1.3], 0.14, 0.14, SS.metal, SPART.hull, mulc(ALU, 0.75), 0.9);
    }
  }
  // cargo modules along the spine
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    k.push(0, 0, 0, -a);
    k.box(1.4, 15, -1.1, 3.4, 22, 1.1, SS.paint, SPART.hull, mulc(WHITE, 0.9 - 0.08 * (i % 2)), {});
    k.pop();
  }
  // hub (fixed) and forward shield
  k.cylinder(0, 0, 30, 36, 3.2, 3.2, 28, SS.paint, SPART.hull, WHITE, {});
  k.lathe(0, 0, Array.from({ length: 8 }, (_, j) => { const t = j / 7; return [Math.max(0.05, 6.5 * Math.cos(t * Math.PI / 2)), 36 + 2.6 * Math.sin(t * Math.PI / 2)] as [number, number]; }), 36, SS.tile, SPART.hull, mulc(DARK, 1.4), 0.9, 1);
  for (let i = 0; i < 8; i++) lamp(k, Math.cos((i / 8) * TAU) * 3.25, 33, Math.sin((i / 8) * TAU) * 3.25, 0.12);
  // the rotating ring on six spokes
  const kr = P.part('ring', 'ring', -1, [0, 33, 0], [0, 1, 0]);
  const RR = 22, ry = 33;
  const ringPts: V3[] = [];
  for (let i = 0; i <= 48; i++) { const a = (i / 48) * TAU; ringPts.push([Math.cos(a) * RR, ry, Math.sin(a) * RR]); }
  kr.tube(ringPts, new Array(49).fill(2.6), 14, SS.paint, SPART.hull, mulc(WHITE, 0.95), {});
  // windows on the ring's inner face (lit at night), solar strips on its outer face
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    windowQuad(kr, [ca * (RR - 2.62), ry, sa * (RR - 2.62)], [-ca, 0, -sa], [0, 1, 0], 1.6, 0.9);
    kr.box(ca * (RR + 2.55) - 0.05, ry - 0.9, sa * (RR + 2.55) - 0.05, ca * (RR + 2.75) + 0.05, ry + 0.9, sa * (RR + 2.75) + 0.05, SS.solar, SPART.hull, SOLARC, {});
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    kr.tube([[Math.cos(a) * 3.2, ry, Math.sin(a) * 3.2], [Math.cos(a) * (RR - 2.4), ry, Math.sin(a) * (RR - 2.4)]], [0.75, 0.75], 10, SS.paint, SPART.hull, mulc(WHITE, 0.85), {});
  }
  void rng;
  return { height: 38.6, radius: 30, engines, stageTops: [], fairingBase: -1, umbilicals: [], baseRadius: 3.4 };
}

/** the generation ship's descent vehicle: a squat ark lander on six legs */
function arkLander(P: Parts, rng: Rng): Omit<ShipModel, 'shape' | 'era' | 'parts'> {
  const engines: EngineMount[] = [];
  const k = P.part('hull', 'static', -1);
  k.lathe(0, 0, [[0.05, 1.6], [6.5, 1.8], [8.6, 3.0], [8.8, 5.2], [7.4, 8.4], [4.0, 10.6], [3.6, 11.4], [0.05, 11.6]], 40, SS.paint, SPART.hull, mixc(WHITE, OFFWHITE, 0.3), 0.85, 1);
  k.lathe(0, 0, [[8.6, 3.0], [8.9, 3.4], [8.9, 4.8], [8.8, 5.2]], 40, SS.tile, SPART.hull, BLACK, 0.8, 1);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    windowQuad(k, [Math.cos(a) * 7.95, 7.0, Math.sin(a) * 7.95], [Math.cos(a) * 0.86, 0.5, Math.sin(a) * 0.86], [-Math.cos(a) * 0.5, 0.86, -Math.sin(a) * 0.5], 0.9, 0.6);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    bell(k, Math.cos(a) * 3.2, Math.sin(a) * 3.2, 0.2, 1.6, 0.9, 0.24, 16);
    engines.push({ pos: [Math.cos(a) * 3.2, 0.2, Math.sin(a) * 3.2], radius: 0.9, stage: 0, vacuum: false });
  }
  for (let i = 0; i < 8; i++) lamp(k, Math.cos((i / 8) * TAU) * 8.85, 4.1, Math.sin((i / 8) * TAU) * 8.85, 0.12);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    const hinge: V3 = [ca * 7.6, 4.6, sa * 7.6];
    const kl = P.part(`leg${i}`, 'leg', -1, hinge, [-sa, 0, ca]);
    const foot: V3 = [ca * 11.2, -0.05, sa * 11.2];
    kl.tube([hinge, [ca * 10.2, 1.4, sa * 10.2], foot], [0.32, 0.3, 0.28], 10, SS.metal, SPART.hull, ALU, {});
    kl.beam([ca * 7.0, 2.2, sa * 7.0], [ca * 10.2, 1.4, sa * 10.2], 0.22, 0.22, SS.metal, SPART.hull, mulc(ALU, 0.8), 0.9);
    kl.cylinder(foot[0], foot[2], -0.2, 0.06, 1.1, 0.95, 14, SS.foil, SPART.hull, GOLD, { top: true });
  }
  void rng;
  return { height: 11.6, radius: 12, engines, stageTops: [], fairingBase: -1, umbilicals: [], baseRadius: 11 };
}

// ───────────────────────────── vessels of the sea ─────────────────────────────

/**
 * a carvel hull from stations: half-breadth b(t) and depth along t ∈ [0,1] (stern → bow), sheer rising fore and aft;
 * planked outside, tarred below the waterline, a deck at `deck`, bulwarks of height `bulw`.
 */
function hull(k: KitBuilder, len: number, beam: number, depth: number, deck: number, bulw: number, sheerK: number, rows: number, cols: number, plank: RGB, keelCol: RGB): void {
  const half = (t: number) => {
    // a full midbody, a fine entry at the bow, a transom-ish stern
    const bow = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.02)), 0.55);
    return (beam / 2) * bow * (t < 0.15 ? 0.8 + 0.2 * (t / 0.15) : 1);
  };
  const sheer = (t: number) => deck + bulw + sheerK * Math.pow(Math.abs(t - 0.45) * 2, 2.2);
  const grid: number[][] = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const z = -len / 2 + t * len;
    const w = half(t);
    const top = sheer(t);
    const bottom = -depth * (0.35 + 0.65 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.02)), 0.6));
    const row: number[] = [];
    for (let j = 0; j <= cols; j++) {
      // from the gunwale (j = 0) round the bilge to the keel (j = cols)
      const s = j / cols;
      const a = s * (Math.PI / 2);
      const x = w * Math.cos(a) * (1 - 0.15 * s * s);
      const y = top + (bottom - top) * Math.pow(Math.sin(a), 1.3);
      const nx = Math.cos(a), ny = -Math.sin(a) * 0.9;
      const col = y < 0.05 ? keelCol : plank;
      row.push(k.vert(x, y, z, nx, ny, 0, y < 0.05 ? SS.black : SS.planks, SPART.hull, col, 0.6 + 0.4 * (1 - s)));
    }
    grid.push(row);
  }
  // starboard side and its mirror
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const a = grid[i][j], b = grid[i][j + 1], c = grid[i + 1][j], d = grid[i + 1][j + 1];
    k.tri(a, c, d); k.tri(a, d, b);
  }
  const mirror: number[][] = [];
  for (let i = 0; i <= rows; i++) {
    const row: number[] = [];
    for (let j = 0; j <= cols; j++) {
      const id = grid[i][j];
      const x = k.pos[id * 3], y = k.pos[id * 3 + 1], z = k.pos[id * 3 + 2];
      const nx = k.nrm[id * 3], ny = k.nrm[id * 3 + 1];
      row.push(k.vert(-x, y, z, -nx, ny, 0, y < 0.05 ? SS.black : SS.planks, SPART.hull, y < 0.05 ? keelCol : plank, 0.6 + 0.4 * (1 - j / cols)));
    }
    mirror.push(row);
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const a = mirror[i][j], b = mirror[i][j + 1], c = mirror[i + 1][j], d = mirror[i + 1][j + 1];
    k.tri(a, d, c); k.tri(a, b, d);
  }
  // bulwark insides (planks, darker) and the deck
  for (let i = 0; i < rows; i++) {
    const t0 = i / rows, t1 = (i + 1) / rows;
    const z0 = -len / 2 + t0 * len, z1 = -len / 2 + t1 * len;
    const w0 = half(t0) * 0.97, w1 = half(t1) * 0.97;
    for (const sx of [1, -1]) {
      const a: V3 = [sx * w0, deck, z0], b: V3 = [sx * w1, deck, z1], c: V3 = [sx * w1, sheer(t1), z1], d: V3 = [sx * w0, sheer(t0), z0];
      if (sx > 0) k.quad(b, a, d, c, SS.planks, SPART.hull, mulc(plank, 0.75), 0.7); else k.quad(a, b, c, d, SS.planks, SPART.hull, mulc(plank, 0.75), 0.7);
    }
    k.quad([-w0, deck, z0], [w0, deck, z0], [w1, deck, z1], [-w1, deck, z1], SS.planks, SPART.hull, mulc(WOOD_PALE, 0.9), 0.85);
  }
  // transom at the stern
  const ws = half(0) * 0.97;
  k.quad([ws, sheer(0), -len / 2], [-ws, sheer(0), -len / 2], [-ws * 0.6, -depth * 0.3, -len / 2], [ws * 0.6, -depth * 0.3, -len / 2], SS.planks, SPART.hull, mulc(plank, 0.85), 0.8);
  // keel / stem post
  k.beam([0, -depth - 0.05, -len / 2 + 0.2], [0, -depth * 0.7, len / 2 + 0.1], 0.18, 0.2, SS.beam, SPART.hull, WOOD_DARK, 0.9);
  k.beam([0, -depth * 0.7, len / 2 + 0.1], [0, sheer(1) + 0.3, len / 2 + 0.25], 0.16, 0.16, SS.beam, SPART.hull, WOOD_DARK, 0.9);
}

/**
 * One sail as a cloth grid in the sail plane: top edge from tl to tr (the yard), bottom edge from bl to br, `n` the
 * direction it fills toward (the wind pushes it forward). aCloth (u, v, depth, seed) is carried in the uv attribute's
 * override and in the kit seed: the ship material reads uv (u ∈ [−1,1] across, v ∈ [0,1] down) and the aKit.z seed;
 * the billow depth rides in aKit.w (no AO on cloth).
 */
function sail(k: KitBuilder, tl: V3, tr: V3, bl: V3, br: V3, n: V3, depth: number, col: RGB, seed: number, nu = 8, nv = 8): void {
  const ids: number[][] = [];
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const row: number[] = [];
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      const top: V3 = [tl[0] + (tr[0] - tl[0]) * u, tl[1] + (tr[1] - tl[1]) * u, tl[2] + (tr[2] - tl[2]) * u];
      const bot: V3 = [bl[0] + (br[0] - bl[0]) * u, bl[1] + (br[1] - bl[1]) * u, bl[2] + (br[2] - bl[2]) * u];
      const p: V3 = [top[0] + (bot[0] - top[0]) * v, top[1] + (bot[1] - top[1]) * v, top[2] + (bot[2] - top[2]) * v];
      // the billow depth (m) rides in the AO slot; the shader displaces along the normal by depth × shape(u, v)
      row.push(k.vert(p[0], p[1], p[2], n[0], n[1], n[2], SS.sailcloth, SPART.sail, col, Math.min(1, depth / 4), seed, [u * 2 - 1, v]));
    }
    ids.push(row);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = ids[j][i], b = ids[j][i + 1], c = ids[j + 1][i], d = ids[j + 1][i + 1];
    // both faces (cloth is seen from either side)
    k.tri(a, c, d); k.tri(a, d, b);
    k.tri(a, d, c); k.tri(a, b, d);
  }
}

function mast(k: KitBuilder, x: number, z: number, y0: number, h: number, r: number, col: RGB): void {
  k.tube([[x, y0, z], [x, y0 + h, z]], [r, r * 0.55], 10, SS.bark, SPART.hull, col, { cap: true });
}

function yard(k: KitBuilder, z: number, y: number, half: number, r: number): void {
  k.tube([[-half, y, z], [0, y + 0.05, z], [half, y, z]], [r * 0.6, r, r * 0.6], 6, SS.bark, SPART.hull, WOOD_DARK, {});
}

function shroud(k: KitBuilder, a: V3, b: V3): void {
  k.beam(a, b, 0.035, 0.035, SS.rope, SPART.hull, ROPE, 0.9);
}

/** sailship by era: cog (≤ medieval), carrack / galleon (gunpowder), steam clipper (steam and later) */
function sailship(P: Parts, rng: Rng, era: number): Omit<ShipModel, 'shape' | 'era' | 'parts'> {
  const k = P.part('hull', 'static', -1);
  const ks = P.part('sails', 'sail', -1, [0, 0, 0], [0, 1, 0], true);
  const steam = era >= ERA.steam, galleon = era >= ERA.gunpowder && !steam;
  const len = steam ? 34 : galleon ? 28 : 16, beam = steam ? 7.5 : galleon ? 8 : 5.6;
  const depth = steam ? 3.4 : galleon ? 3.6 : 2.4, deck = steam ? 1.4 : galleon ? 1.6 : 1.1;
  const plank = steam ? rgb(0.06, 0.06, 0.065) : galleon ? mulc(WOOD, 1.05) : mulc(WOOD, 1.2);
  const keelCol = steam ? rgb(0.25, 0.06, 0.04) : TAR;
  hull(k, len, beam, depth, deck, 0.9, steam ? 0.6 : galleon ? 2.2 : 1.4, 14, 6, plank, keelCol);
  // castles: a sterncastle (and a forecastle on the cog / galleon)
  const sc = galleon ? 3.2 : steam ? 1.6 : 2.0;
  k.box(-beam * 0.42, deck + 0.9, -len / 2 + 0.3, beam * 0.42, deck + 0.9 + sc, -len / 2 + len * 0.22, SS.planks, SPART.hull, mulc(plank, 1.1), { skip: ['bottom'] });
  for (let i = 0; i < 4; i++) windowQuad(k, [-beam * 0.2 + i * beam * 0.13, deck + 1.4 + sc * 0.4, -len / 2 + 0.28], [0, 0, -1], [0, 1, 0], 0.35, 0.45);
  if (!steam) k.box(-beam * 0.36, deck + 0.9, len / 2 - len * 0.18, beam * 0.36, deck + 0.9 + sc * 0.65, len / 2 - 0.6, SS.planks, SPART.hull, mulc(plank, 1.1), { skip: ['bottom'] });
  // gunports on the galleon, a gilded rail
  if (galleon) for (const sx of [-1, 1]) for (let i = 0; i < 7; i++) {
    const z = -len * 0.3 + i * len * 0.085;
    k.box(sx * beam * 0.495 - 0.06, deck + 0.15, z - 0.28, sx * beam * 0.495 + 0.06, deck + 0.7, z + 0.28, SS.black, SPART.hull, BLACK, {});
  }
  // bowsprit
  k.tube([[0, deck + 1.2, len / 2 - 0.5], [0, deck + 3.6, len / 2 + (steam ? 6 : 4.5)]], [0.2, 0.1], 8, SS.bark, SPART.hull, WOOD_DARK, {});
  const masts: { z: number; h: number; yards: number }[] = steam
    ? [{ z: len * 0.28, h: 22, yards: 3 }, { z: 0, h: 24, yards: 3 }, { z: -len * 0.26, h: 20, yards: 2 }]
    : galleon ? [{ z: len * 0.26, h: 18, yards: 2 }, { z: -0.02 * len, h: 21, yards: 3 }, { z: -len * 0.28, h: 14, yards: 1 }]
      : [{ z: 0.05 * len, h: 13, yards: 1 }];
  const sailCol = steam ? rgb(0.72, 0.7, 0.64) : galleon ? CANVAS : mixc(CANVAS, rgb(0.55, 0.3, 0.2), (rng.float() < 0.5 ? 0.5 : 0));
  for (const m of masts) {
    mast(k, 0, m.z, deck - 0.5, m.h, 0.32, WOOD_DARK);
    // shrouds to the rails
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) shroud(k, [sx * beam * 0.48, deck + 0.9, m.z - 0.8 + i * 0.8], [sx * 0.2, deck + m.h * 0.82, m.z]);
    // yards from the bottom up: course, topsail, topgallant
    const heights: number[] = [];
    const base = deck + 3.2;
    const usable = m.h - 3.2 - 1.0;
    for (let y = 0; y <= m.yards; y++) heights.push(base + (usable * y) / m.yards);
    for (let y = 0; y < m.yards; y++) {
      const yb = heights[y], yt = heights[y + 1] - 0.3;
      const halfT = beam * (0.95 - y * 0.16) * (steam ? 1.1 : 1);
      const halfB = beam * (1.05 - y * 0.16) * (steam ? 1.1 : 1);
      yard(k, m.z + 0.35, yt, halfT, 0.16);
      if (y === 0) yard(k, m.z + 0.35, yb, halfB, 0.14);
      sail(ks, [-halfT, yt - 0.1, m.z + 0.45], [halfT, yt - 0.1, m.z + 0.45], [-halfB * 0.98, yb + 0.15, m.z + 0.45], [halfB * 0.98, yb + 0.15, m.z + 0.45], [0, 0, 1], 1.2 + 0.4 * (m.yards - y), sailCol, rng.float(), 8, 6);
      // sheets from the lower corners down to the rail
      if (y === 0) for (const sx of [-1, 1]) shroud(k, [sx * halfB * 0.98, yb + 0.15, m.z + 0.45], [sx * beam * 0.47, deck + 0.9, m.z - 2.2]);
    }
    // stays fore and aft
    shroud(k, [0, deck + m.h * 0.95, m.z], [0, deck + 0.9, m.z + (m === masts[0] ? len * 0.32 : 6)]);
  }
  // a jib from the foremast to the bowsprit (a triangle: the bottom edge collapses at the tack)
  const fz = masts[0].z;
  const bs: V3 = [0, deck + 3.4, len / 2 + (steam ? 5.5 : 4.0)];
  sail(ks, [0, deck + masts[0].h * 0.85, fz + 0.5], [0, deck + masts[0].h * 0.85 - 0.01, fz + 0.52], [0, deck + 2.2, fz + 1.4], bs, [1, 0, 0], 0.9, mulc(sailCol, 0.95), rng.float(), 6, 8);
  if (steam) {
    // the funnel amidships, black with a red band, and a deckhouse
    k.cylinder(0, -len * 0.12, deck, deck + 7.5, 0.9, 0.85, 18, SS.paint, SPART.hull, BLACK, {});
    k.cylinder(0, -len * 0.12, deck + 5.2, deck + 6.2, 0.86, 0.86, 18, SS.paint, SPART.hull, RED, {});
    k.box(-2.2, deck, -len * 0.05, 2.2, deck + 2.2, len * 0.08, SS.planks, SPART.hull, mulc(WOOD_PALE, 1.1), { skip: ['bottom'] });
    for (let i = 0; i < 4; i++) windowQuad(k, [2.21, deck + 1.3, -len * 0.04 + i * 1.1], [1, 0, 0], [0, 1, 0], 0.5, 0.5);
  }
  // a flag at the stern
  const kf = P.part('flag', 'sail', -1, [0, 0, 0], [0, 1, 0], true);
  k.tube([[0, deck + 0.9 + sc, -len / 2 + 0.6], [0, deck + 0.9 + sc + 3.2, -len / 2 + 0.6]], [0.05, 0.035], 6, SS.bark, SPART.hull, WOOD_DARK, {});
  sail(kf, [0, deck + sc + 4.0, -len / 2 + 0.6], [0, deck + sc + 4.0, -len / 2 - 1.5], [0, deck + sc + 2.8, -len / 2 + 0.6], [0, deck + sc + 2.8, -len / 2 - 1.5], [1, 0, 0], 0.25, RED, rng.float(), 6, 4);
  lamp(k, 0, deck + 0.9 + sc + 0.4, -len / 2 + 0.2, 0.08);
  return { height: len, radius: len * 0.6, engines: [], stageTops: [], fairingBase: -1, umbilicals: [], baseRadius: beam };
}

function raft(P: Parts, rng: Rng): Omit<ShipModel, 'shape' | 'era' | 'parts'> {
  const k = P.part('hull', 'static', -1);
  const ks = P.part('sails', 'sail', -1, [0, 0, 0], [0, 1, 0], true);
  const logs = 7, L = 5.2, r = 0.2;
  for (let i = 0; i < logs; i++) {
    const x = (i - (logs - 1) / 2) * r * 2.02;
    const z0 = -L / 2 + rng.float() * 0.3, z1 = L / 2 - rng.float() * 0.3;
    k.tube([[x, 0.04, z0], [x, 0.04 + rng.float() * 0.03, z1]], [r * (0.9 + rng.float() * 0.2), r * 0.85], 8, SS.bark, SPART.hull, mulc(WOOD, 0.75 + rng.float() * 0.45), { cap: true });
  }
  for (const z of [-L * 0.34, 0, L * 0.34]) k.beam([-logs * r, 0.24, z], [logs * r, 0.24, z], 0.1, 0.07, SS.bark, SPART.hull, WOOD_DARK, 0.9);
  // steering oar and a little mast with a square of hide
  k.beam([0.3, 0.3, -L / 2 + 0.3], [0.6, -0.3, -L / 2 - 1.4], 0.07, 0.07, SS.beam, SPART.hull, WOOD_DARK, 0.9);
  k.tube([[0, 0.2, 0.4], [0, 3.6, 0.4]], [0.07, 0.05], 6, SS.bark, SPART.hull, WOOD_DARK, {});
  k.tube([[-1.0, 3.4, 0.5], [1.0, 3.4, 0.5]], [0.04, 0.04], 5, SS.bark, SPART.hull, WOOD_DARK, {});
  sail(ks, [-0.95, 3.3, 0.55], [0.95, 3.3, 0.55], [-0.85, 1.2, 0.55], [0.85, 1.2, 0.55], [0, 0, 1], 0.5, rgb(0.36, 0.27, 0.16), rng.float(), 6, 6);
  // a bundle and a pot on deck
  k.box(-0.5, 0.25, -1.4, 0.2, 0.6, -0.9, SS.cloth, SPART.hull, rgb(0.3, 0.25, 0.18), {});
  return { height: L, radius: 4, engines: [], stageTops: [], fairingBase: -1, umbilicals: [], baseRadius: 1.6 };
}

function rowboat(P: Parts, rng: Rng): Omit<ShipModel, 'shape' | 'era' | 'parts'> {
  const k = P.part('hull', 'static', -1);
  const ks = P.part('sails', 'sail', -1, [0, 0, 0], [0, 1, 0], true);
  hull(k, 6.4, 2.0, 0.85, 0.15, 0.55, 0.45, 10, 5, mulc(WOOD, 1.25), TAR);
  k.box(-0.85, 0.35, -0.15, 0.85, 0.45, 0.15, SS.planks, SPART.hull, mulc(WOOD_PALE, 1.0), {});
  k.box(-0.85, 0.35, -1.8, 0.85, 0.45, -1.5, SS.planks, SPART.hull, mulc(WOOD_PALE, 1.0), {});
  for (const sx of [-1, 1]) k.beam([sx * 0.9, 0.82, -1.6], [sx * 0.95, 0.85, 1.5], 0.05, 0.06, SS.beam, SPART.hull, WOOD_DARK, 0.9);
  // a lugsail on a short mast
  k.tube([[0, 0.1, 1.0], [0, 4.8, 1.0]], [0.07, 0.05], 6, SS.bark, SPART.hull, WOOD_DARK, {});
  k.tube([[0, 4.5, 0.3], [0, 4.9, 2.2]], [0.04, 0.035], 5, SS.bark, SPART.hull, WOOD_DARK, {});
  sail(ks, [0.02, 4.45, 0.3], [0.02, 4.85, 2.2], [0.02, 1.0, -0.5], [0.02, 1.0, 1.9], [1, 0, 0], 0.55, mixc(CANVAS, rgb(0.5, 0.28, 0.16), rng.float() * 0.6), rng.float(), 6, 7);
  return { height: 6.4, radius: 4, engines: [], stageTops: [], fairingBase: -1, umbilicals: [], baseRadius: 1.2 };
}

// ───────────────────────────── airship ─────────────────────────────

/** a rigid airship: polygonal girder hull, doped fabric with sag between the girders, tail, gondola, engine cars */
function airship(P: Parts, rng: Rng): Omit<ShipModel, 'shape' | 'era' | 'parts'> {
  const k = P.part('hull', 'static', -1);
  const L = 86, Rm = 7.2, G = 16;
  const rows = 40;
  const prof = (t: number) => {
    // a streamlined body: blunt bow, long parallel midbody, tapering stern
    if (t < 0.18) return Math.sqrt(Math.max(0, 1 - Math.pow((0.18 - t) / 0.18, 2))) * 0.98 + 0.02;
    if (t < 0.62) return 1;
    return Math.max(0.03, Math.pow(Math.cos(((t - 0.62) / 0.38) * (Math.PI / 2)), 0.85));
  };
  const grid: number[][] = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const z = L / 2 - t * L;
    const R = Rm * prof(t);
    const row: number[] = [];
    for (let j = 0; j <= G * 2; j++) {
      const a = (j / (G * 2)) * TAU;
      // fabric sags inward between the girders (every other vertex is mid-panel)
      const mid = j % 2 === 1;
      const r = R * (mid ? 0.986 : 1);
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      // normal: radial with the profile slope
      const t2 = Math.min(1, t + 0.01), t1 = Math.max(0, t - 0.01);
      const dR = (Rm * prof(t2) - Rm * prof(t1)) / (((t2 - t1) * L) || 1);
      const nl = Math.hypot(1, dR);
      row.push(k.vert(x, y, z, Math.cos(a) / nl, Math.sin(a) / nl, dR / nl, SS.fabric, SPART.hull, FABRIC, mid ? 0.92 : 1, (j >> 1) / G, [a * Rm, (1 - t) * L]));
    }
    grid.push(row);
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < G * 2; j++) {
    const a = grid[i][j], b = grid[i][j + 1], c = grid[i + 1][j], d = grid[i + 1][j + 1];
    k.tri(a, b, d); k.tri(a, d, c);
  }
  // cruciform tail: fins with rudders / elevators (darker hinged surfaces)
  for (let f = 0; f < 4; f++) {
    const a = (f / 4) * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    const zr0 = -L / 2 + 16, zr1 = -L / 2 + 3;
    const r0 = Rm * prof(1 - (zr0 + L / 2) / L), r1 = Rm * prof(1 - (zr1 + L / 2) / L);
    const span = 6.2;
    const pt = (z: number, r: number): V3 => [ca * r, sa * r, z];
    const A = pt(zr0, r0), B = pt(zr1 - 1.5, r1 + span), C = pt(zr1 - 4.0, r1 + span), D = pt(zr1 - 1, r1);
    k.quad(A, D, C, B, SS.fabric, SPART.hull, mulc(FABRIC, 0.95), 1);
    k.quad(A, B, C, D, SS.fabric, SPART.hull, mulc(FABRIC, 0.95), 1);
    const E = pt(zr1 - 4.0, r1 + span), F = pt(zr1 - 6.2, r1 + span * 0.9), Gq = pt(zr1 - 5.6, r1 + 0.3), H = pt(zr1 - 1, r1);
    k.quad(H, Gq, F, E, SS.paint, SPART.hull, RED, 1);
    k.quad(H, E, F, Gq, SS.paint, SPART.hull, RED, 1);
  }
  // control gondola under the bow
  const gz = L / 2 - 20;
  k.box(-1.5, -Rm - 2.6, gz - 5, 1.5, -Rm + 0.2, gz + 4, SS.paint, SPART.hull, mulc(FABRIC, 0.8), { skip: ['top'] });
  for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) windowQuad(k, [sx * 1.51, -Rm - 1.3, gz - 3.8 + i * 1.3], [sx, 0, 0], [0, 1, 0], 0.9, 0.8);
  windowQuad(k, [0, -Rm - 1.3, gz + 4.01], [0, 0, 1], [0, 1, 0], 2.2, 0.8);
  // engine cars on struts, propellers (parts spinning about Z)
  const cars: [number, number, number][] = [[-5.6, -Rm + 1.2, -6], [5.6, -Rm + 1.2, -6], [-5.0, -Rm + 0.6, -22], [5.0, -Rm + 0.6, -22]];
  cars.forEach(([x, y, z], i) => {
    k.tube([[x, y, z + 2.8], [x, y, z], [x, y, z - 2.6]], [0.55, 0.85, 0.5], 12, SS.paint, SPART.hull, mulc(FABRIC, 0.7), { cap: true });
    k.beam([x * 0.6, y + 1.4, z], [x, y + 0.6, z], 0.12, 0.12, SS.metal, SPART.hull, ALU, 0.9);
    k.beam([x * 0.55, y + 1.6, z - 1.5], [x, y + 0.5, z - 1.5], 0.1, 0.1, SS.metal, SPART.hull, ALU, 0.9);
    const hub: V3 = [x, y, z - 2.75];
    const kp = P.part(`prop${i}`, 'prop', -1, hub, [0, 0, 1]);
    kp.cylinder(x, z - 2.75, y - 0.15, y + 0.15, 0.18, 0.18, 8, SS.metal, SPART.prop, BRASSC, {});
    for (let b = 0; b < 4; b++) {
      const a = (b / 4) * TAU + i;
      kp.beam(hub, [x + Math.cos(a) * 1.7, y + Math.sin(a) * 1.7, z - 2.75], 0.22, 0.04, SS.planks, SPART.prop, WOOD, 0.9);
    }
  });
  // mooring cone at the bow, a ring of navigation lamps
  k.lathe(0, L / 2 - 0.05, [[0.9, 0], [0.5, 0.6], [0.05, 0.9]], 10, SS.brass, SPART.hull, BRASSC, 1, 1);
  lamp(k, 0, -Rm - 2.7, gz, 0.12);
  lamp(k, Rm * 0.7, 0, -L / 2 + 10, 0.1);
  lamp(k, -Rm * 0.7, 0, -L / 2 + 10, 0.1);
  void rng;
  return { height: L, radius: L * 0.55, engines: [], stageTops: [], fairingBase: -1, umbilicals: [], baseRadius: Rm };
}

/** the gate's event horizon: a disc (part 'portal') filling the star gate's ring (radius 11 m, centre 15 m up) */
function portal(P: Parts): Omit<ShipModel, 'shape' | 'era' | 'parts'> {
  const k = P.part('portal', 'portal', -1, [0, GATE_CENTRE_Y, 0], [0, 0, 1]);
  const n = 48, rings = 6;
  const c = k.vert(0, GATE_CENTRE_Y, 0, 0, 0, 1, SS.horizon, SPART.portal, rgb(1, 1, 1), 1, 0, [0, 0]);
  let prev: number[] = [];
  for (let r = 1; r <= rings; r++) {
    const rr = (r / rings) * GATE_RADIUS;
    const row: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU;
      row.push(k.vert(Math.cos(a) * rr, GATE_CENTRE_Y + Math.sin(a) * rr, 0, 0, 0, 1, SS.horizon, SPART.portal, rgb(1, 1, 1), 1, 0, [r / rings, i / n]));
    }
    if (r === 1) for (let i = 0; i < n; i++) { k.tri(c, row[i], row[i + 1]); k.tri(c, row[i + 1], row[i]); }
    else for (let i = 0; i < n; i++) {
      const a = prev[i], b = prev[i + 1], cc = row[i], d = row[i + 1];
      k.tri(a, cc, d); k.tri(a, d, b); k.tri(a, d, cc); k.tri(a, b, d);
    }
    prev = row;
  }
  return { height: GATE_CENTRE_Y + GATE_RADIUS, radius: GATE_RADIUS + 2, engines: [], stageTops: [], fairingBase: -1, umbilicals: [], baseRadius: GATE_RADIUS };
}

/** the star gate's ring geometry, shared with the star-gate building (render/gen/buildinggen.ts) */
export const GATE_RADIUS = 10.6;
export const GATE_CENTRE_Y = 14.2;

// ───────────────────────────── eras ─────────────────────────────

/** era ranks (SettlementView.era) */
export const ERA: Record<string, number> = {
  stone: 0, fire: 1, clay: 2, bronze: 3, iron: 4, classical: 5, medieval: 6, gunpowder: 7, steam: 8, electric: 9, space: 10, future: 11,
};
export function eraRank(era: string | undefined): number {
  return era && era in ERA ? ERA[era] : 10;
}

// ───────────────────────────── entry ─────────────────────────────

const cache = new Map<string, ShipModel>();

/**
 * The model for a ship kind (ships.json ids, plus the sea vessels and the descent forms) built by a people of `era`.
 * `form` picks the shape for the phase: 'launch' (the stack on the pad and climbing), 'space' (the vessel in orbit and
 * between the worlds), 'lander' (coming down, standing on another world).
 */
export function shipModel(kind: string, era: string, form: 'launch' | 'space' | 'lander' = 'launch', seed = 1): ShipModel {
  const e = eraRank(era);
  const shape = shapeFor(kind, e, form);
  const key = `${shape}|${shape === 'sailship' ? (e >= ERA.steam ? 2 : e >= ERA.gunpowder ? 1 : 0) : shape === 'rocket' ? (e >= ERA.space ? 2 : e >= ERA.electric ? 1 : 0) : 0}|${seed % 4}`;
  let m = cache.get(key);
  if (m) return m;
  const P = new Parts();
  const rng = new Rng(7919 + seed * 31 + shape.length * 101);
  let b: Omit<ShipModel, 'shape' | 'era' | 'parts'>;
  switch (shape) {
    case 'raft': b = raft(P, rng); break;
    case 'boat': b = rowboat(P, rng); break;
    case 'sailship': b = sailship(P, rng, e); break;
    case 'airship': b = airship(P, rng); break;
    case 'rocket': b = e >= ERA.space ? spaceRocket(P, rng, false) : e >= ERA.electric ? electricRocket(P, rng) : gunpowderRocket(P, rng); break;
    case 'lander': b = spaceRocket(P, rng, true); break;
    case 'orbiter': { b = orbiterLauncher(P, rng); satellite(P, 23.4, false); break; }
    case 'satellite': { satellite(P, 0, true); b = { height: 3, radius: 6, engines: [], stageTops: [], fairingBase: -1, umbilicals: [], baseRadius: 1 }; break; }
    case 'generation-ship': b = arkLauncher(P, rng); break;
    case 'ark': b = ark(P, rng); break;
    case 'ark-lander': b = arkLander(P, rng); break;
    case 'gate': b = portal(P); break;
    default: b = spaceRocket(P, rng, false);
  }
  m = { shape, era, parts: P.build(), ...b };
  cache.set(key, m);
  return m;
}

/** which shape draws a kind in a form */
export function shapeFor(kind: string, era: number, form: 'launch' | 'space' | 'lander'): ShipShape {
  switch (kind) {
    case 'raft': return 'raft';
    case 'boat': case 'canoe': return 'boat';
    case 'sailship': case 'sail': case 'ship': return 'sailship';
    case 'airship': return 'airship';
    case 'orbiter': return form === 'launch' ? 'orbiter' : 'satellite';
    case 'generation-ship': return form === 'launch' ? 'generation-ship' : form === 'lander' ? 'ark-lander' : 'ark';
    case 'gate': return 'gate';
    case 'rocket': default: return form === 'lander' ? (era >= ERA.space || era < ERA.electric ? 'lander' : 'rocket') : 'rocket';
  }
}

/** the vessel geometry for the boats people ride (render/life/boats.ts asks for the sail boat's cloth) */
export function vesselSails(kind: 'raft' | 'boat' | 'sail'): BufferGeometry | null {
  const m = shipModel(kind === 'sail' ? 'boat' : kind, 'iron', 'launch', 3);
  const p = m.parts.find((q) => q.cloth);
  return p ? p.geo : null;
}
