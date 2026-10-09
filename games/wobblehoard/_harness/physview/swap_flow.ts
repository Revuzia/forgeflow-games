// PHYS, CUT2 task P5: the SHELL's cut flow (src/shell/cut.ts: startTrue, the neck, partTrue, the scripted parting) on bare SoftBodies, for the rows that need many planes and nested cuts
// (L1 = X13's swap flow, L9) without the game core. It reads the same constants the shell exports (NECK_S, PART_GAP, PART_S, LEVEL_NY, PLOP_MAX, restPlaneToWorld), so the two cannot drift
// apart silently; probe_flush.ts checks it against the Cutter on the 12 families. Plain node.
import type { CutPlan, CutPlane, PieceRegion, V3 } from '../../src/contracts.ts';
import { SoftBody } from '../../src/physics/softbody.ts';
import { speciesBaseGenome, familyOf } from '../../src/data/catalog.ts';
import { LEVEL_NY, NECK_S, NECK_DEFAULT_S, NECK_DEPTH, NECK_DEPTH_DEFAULT, PART_GAP, PART_GAP_DEFAULT, PART_S, PART_S_DEFAULT, PLOP_MAX, restPlaneToWorld } from '../../src/shell/cut.ts';

export const DT = 1 / 60;
type Quat = { x: number; y: number; z: number; w: number };
const smooth = (x: number): number => { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t); };
const rotate = (q: Quat, v: V3): V3 => {
  const tx = q.y * v.z - q.z * v.y + q.w * v.x, ty = q.z * v.x - q.x * v.z + q.w * v.y, tz = q.x * v.y - q.y * v.x + q.w * v.z;
  return { x: v.x + 2 * (q.y * tz - q.z * ty), y: v.y + 2 * (q.z * tx - q.x * tz), z: v.z + 2 * (q.x * ty - q.y * tx) };
};
export const mkPlan = (): CutPlan => ({ rest: { n: { x: 0, y: 0, z: 0 }, d: 0 }, fa: 0, offA: { x: 0, y: 0, z: 0 }, offB: { x: 0, y: 0, z: 0 }, velA: { x: 0, y: 0, z: 0 }, velB: { x: 0, y: 0, z: 0 }, aspectA: 0, aspectB: 0, sound: false, soundPending: false, built: false });
const lowestY = (b: SoftBody): number => { const P = b.positions; let m = Infinity; for (let i = 1; i < P.length; i += 3) if (P[i] < m) m = P[i]; return m; };

/** A squishy being cut: its pieces with the region each was built with, all stepped together with `collide`. */
export interface Scene { sp: string; genome: ReturnType<typeof speciesBaseGenome>; bodies: SoftBody[]; regions: Map<SoftBody, PieceRegion | undefined>; nextId: number; wholeR: number; t: number; parting: Parting | null }
interface Parting { a: SoftBody; b: SoftBody; ax: number; ay: number; az: number; bx: number; by: number; bz: number; s: V3; G: number; dur: number; t0: number; mode: 'slide' | 'float' }

export function newScene(sp: string, settleS = 1.5): Scene {
  const genome = speciesBaseGenome(sp as never, 1), b = new SoftBody(genome);
  const sc: Scene = { sp, genome, bodies: [b], regions: new Map([[b, undefined]]), nextId: 1, wholeR: b.restRadius, t: 0, parting: null };
  for (let i = 0; i < Math.round(settleS / DT); i++) frame(sc);
  return sc;
}
const tmpA: V3 = { x: 0, y: 0, z: 0 }, tmpB: V3 = { x: 0, y: 0, z: 0 };
/** one frame of the world: the parting script (if any), collide for every body, then every step (the order of bodies.step) */
export function frame(sc: Scene, each?: () => void): void {
  const p = sc.parting;
  if (p) {
    const g = p.G * smooth((sc.t - p.t0) / p.dur), h = 0.5 * g;
    if (p.mode === 'slide') { tmpA.x = p.ax + h * p.s.x; tmpA.y = p.a.center.y; tmpA.z = p.az + h * p.s.z; tmpB.x = p.bx - h * p.s.x; tmpB.y = p.b.center.y; tmpB.z = p.bz - h * p.s.z; }
    else { tmpA.x = p.ax + h * p.s.x; tmpA.y = p.ay + h * p.s.y; tmpA.z = p.az + h * p.s.z; tmpB.x = p.bx - h * p.s.x; tmpB.y = p.by - h * p.s.y; tmpB.z = p.bz - h * p.s.z; }
    p.a.moveTo(tmpA, 3); p.b.moveTo(tmpB, 3);
    if (sc.t - p.t0 >= p.dur) { p.a.moveTo(null); p.b.moveTo(null); sc.parting = null; }
  }
  for (const b of sc.bodies) b.collide(sc.bodies);
  for (const b of sc.bodies) b.step(DT);
  sc.t += DT;
  each?.();
}

export interface CutResult { ok: boolean; why?: string; a?: SoftBody; b?: SoftBody; parent?: SoftBody; plan?: CutPlan; tilt?: number; lift?: number; liftedBy?: number; bornLow?: number[]; mode?: string; dv?: V3; v0?: V3; v1?: V3; depth?: number }
/** what a probe may look at the moment of the swap: the necked parent (still in the scene) and the two children placed in its pose, before the common lift */
export interface SwapView { parent: SoftBody; a: SoftBody; b: SoftBody; plan: CutPlan; dv: V3; v0: V3; v1: V3; depth: number }
/** The shell's flow for one cut of `parent` along the WORLD plane `plane`: plan, refuse, the neck with the pre-build, the swap (placed flush in the parent's pose with the lobes' velocities less what the neck
 *  added, one common lift), the scripted parting. `bv: 'v0'` gives both children the parent's own velocity (a what-if). Returns the two new bodies (already in the scene). */
export function cutOnce(sc: Scene, parent: SoftBody, plane: CutPlane, how: { mode?: 'at' | 'median'; bv?: 'shell' | 'v0'; calm?: boolean; depth?: number; onSwap?: (v: SwapView) => void; stopAtSwap?: boolean; perFrame?: () => void; drop?: boolean } = {}): CutResult {
  const fam = familyOf(sc.sp as never), plan = mkPlan();
  if (!parent.planCut!(plane, plan, how.mode ?? 'at') || !(plan.fa > 0) || !(plan.fa < 1)) return { ok: false, why: 'miss' };
  const pf = parent.frac!, fA = pf * plan.fa, fB = pf - fA;
  if (Math.min(fA, fB) < 0.125 - 1e-4) return { ok: false, why: 'small' };
  if (!plan.sound) return { ok: false, why: 'loose' };
  const base = sc.regions.get(parent), id = sc.nextId++;
  const meanV = (pl: CutPlan): V3 => ({ x: pl.fa * pl.velA.x + (1 - pl.fa) * pl.velB.x, y: pl.fa * pl.velA.y + (1 - pl.fa) * pl.velB.y, z: pl.fa * pl.velA.z + (1 - pl.fa) * pl.velB.z });
  const v0 = meanV(plan), cy0 = parent.center.y;
  const pw: CutPlane = { point: { ...plane.point }, normal: { ...plane.normal } };
  const neckS = NECK_S[fam] ?? NECK_DEFAULT_S, hold = 0.08, t0 = sc.t, depth = how.depth ?? NECK_DEPTH[fam] ?? NECK_DEPTH_DEFAULT;   // (the shell passes its family table: src/shell/cut.ts startTrue)
  let ready = false;
  for (let guard = 0; guard < 400; guard++) {
    const el = sc.t - t0;
    if (!ready) { const r = parent.prepareCut!(Infinity, el >= neckS + hold ? 6 : 4); if (r === true) ready = true; else if (r === 'thin' || r === 'loose') { parent.setNeck!(null, 0); return { ok: false, why: String(r) }; } }
    restPlaneToWorld(parent, plan.rest, pw);
    parent.setNeck!(pw, smooth(el / neckS), depth);
    if (el >= neckS + hold && ready) break;
    if (el >= neckS + hold + 0.15) break;
    frame(sc, how.perFrame);
  }
  const plan2 = mkPlan();
  let p2 = plan; if (parent.planCut!(pw, plan2, 'latched')) p2 = plan2;
  const q: Quat = { ...(parent.frame ?? { x: 0, y: 0, z: 0, w: 1 }) }, c = { x: parent.center.x, y: parent.center.y, z: parent.center.z }, po = parent.piece?.offset ?? { x: 0, y: 0, z: 0 };
  const tilt = (Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z)))) * 180) / Math.PI;
  const v1 = meanV(p2), dv = { x: v1.x - v0.x, y: v1.y - v0.y, z: v1.z - v0.z };
  parent.setNeck!(null, 0);
  const planes = (base ? base.planes.slice() : []).concat([{ id, n: { ...plan.rest.n }, d: plan.rest.d }]);
  const lits = base && base.cells[0] ? base.cells[0] : [];
  const ra: PieceRegion = { planes, cells: [[...lits, id]] }, rb: PieceRegion = { planes, cells: [[...lits, -id]] };
  let pa: SoftBody, pb: SoftBody;
  try {
    pa = new SoftBody(sc.genome, { piece: { frac: fA, region: ra } } as never);
    pb = new SoftBody(sc.genome, { piece: { frac: fB, region: rb } } as never);
  } catch (e) { return { ok: false, why: 'build: ' + (e as Error).message }; }
  const place = (b: SoftBody, o: V3, v: V3): { at: V3; vel: V3 } => {
    const w = b.piece?.offset, r = rotate(q, w ? { x: w.x - po.x, y: w.y - po.y, z: w.z - po.z } : o);
    const vv = how.bv === 'v0' ? v0 : { x: v.x - dv.x, y: v.y - dv.y, z: v.z - dv.z };
    return { at: { x: c.x + r.x, y: c.y + r.y, z: c.z + r.z }, vel: vv };
  };
  const parentLow = lowestY(parent);
  const pA = place(pa, p2.offA, p2.velA), pB = place(pb, p2.offB, p2.velB);
  pa.placeAt!(pA.at, pA.vel, q); pb.placeAt!(pB.at, pB.vel, q);
  if (how.onSwap) how.onSwap({ parent, a: pa, b: pb, plan: p2, dv, v0, v1, depth });
  if (how.stopAtSwap) { parent.setNeck!(null, 0); return { ok: true, a: pa, b: pb, parent, plan: p2, tilt, lift: c.y - cy0, dv, v0, v1, depth }; }
  const low = Math.min(lowestY(pa), lowestY(pb));
  let liftedBy = 0;
  if (low < 0) { liftedBy = -low + 1e-4; pA.at.y += liftedBy; pB.at.y += liftedBy; pa.placeAt!(pA.at, pA.vel, q); pb.placeAt!(pB.at, pB.vel, q); }
  // (a proposal for the shell, CUT2 P4: a parent that stood on the table but whose centre the neck raised gives children born in the air; one common DROP puts the lower child's lowest particle on the table)
  else if (how.drop && low > 2e-3 && parentLow < 0.005) { liftedBy = -(low - 1e-4); pA.at.y += liftedBy; pB.at.y += liftedBy; pa.placeAt!(pA.at, pA.vel, q); pb.placeAt!(pB.at, pB.vel, q); }
  const n = rotate(q, plan.rest.n);
  const G = (PART_GAP[fam] ?? PART_GAP_DEFAULT) * (sc.wholeR / 0.5) * (how.calm ? 0.6 : 1);
  let mode: 'slide' | 'plop' | 'none' = Math.abs(n.y) < LEVEL_NY ? 'slide' : 'plop';
  if (mode === 'plop') {
    const up = pA.at.y >= pB.at.y ? pA : pB, upBody = up === pA ? pa : pb;
    up.at.y += Math.min(G, PLOP_MAX); upBody.placeAt!(up.at, up.vel, q); mode = 'none';
  }
  // the scene: the parent leaves, the two children join (the shell's install)
  sc.bodies = sc.bodies.filter((b) => b !== parent).concat([pa, pb]);
  sc.regions.delete(parent); sc.regions.set(pa, ra); sc.regions.set(pb, rb);
  if (mode === 'slide') {
    const l = Math.hypot(n.x, n.z) || 1, s = { x: n.x / l, y: 0, z: n.z / l };
    sc.parting = { a: pa, b: pb, ax: pA.at.x, ay: pA.at.y, az: pA.at.z, bx: pB.at.x, by: pB.at.y, bz: pB.at.z, s, G, dur: PART_S[fam] ?? PART_S_DEFAULT, t0: sc.t, mode: 'slide' };
  } else sc.parting = null;
  return { ok: true, a: pa, b: pb, parent, plan: p2, tilt, lift: c.y - cy0, liftedBy, bornLow: [lowestY(pa), lowestY(pb)], mode: mode === 'slide' ? 'slide' : 'plop', dv, v0, v1, depth };
}

/** the world plane through the centre of `b` with a normal n (unit) shifted by off x restRadius along n */
export function planeThrough(b: SoftBody, n: V3, off: number): CutPlane {
  const l = Math.hypot(n.x, n.y, n.z) || 1, u = { x: n.x / l, y: n.y / l, z: n.z / l };
  return { point: { x: b.center.x + u.x * off * b.restRadius, y: b.center.y + u.y * off * b.restRadius, z: b.center.z + u.z * off * b.restRadius }, normal: u };
}
