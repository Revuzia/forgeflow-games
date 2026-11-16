// PHYS, CUT3 leg 2: the rig of probe_many.ts. Cut trees of REAL pieces built by the physics' own cut API (planCut / prepareCut / the constructor) without simulating, laid out on the mat, and the
// instruments to measure them (independent mesh volume, step cost, awake counts). Plain node (type stripping).
import type { CutPlan, CutPlane, PieceRegion } from '../../src/contracts.ts';
import { SoftBody } from '../../src/physics/softbody.ts';
import { clearPieceCache } from '../../src/physics/piece.ts';
import { speciesBaseGenome } from '../../src/data/catalog.ts';
import { mulberry32 } from '../../src/core/rng.ts';

export const DT = 1 / 60;
export type Genome = ReturnType<typeof speciesBaseGenome>;
export interface Leaf { b: SoftBody; reg: PieceRegion | undefined; np: number }
export interface Tree {
  sp: string; genome: Genome; leaves: Leaf[]; nextId: number;
  /** the cuts tried and what became of them */
  log: { tried: number; ok: number; miss: number; loose: number; refused: Record<string, number>; ctor: number; deep: number; ms: number[] };
}
export const mkPlan = (): CutPlan => ({ rest: { n: { x: 0, y: 0, z: 0 }, d: 0 }, fa: 0, offA: { x: 0, y: 0, z: 0 }, offB: { x: 0, y: 0, z: 0 }, velA: { x: 0, y: 0, z: 0 }, velB: { x: 0, y: 0, z: 0 }, aspectA: 0, aspectB: 0, sound: false, soundPending: false, built: false });

/** Independent signed volume of a triangle mesh (positions xyz, indices). */
export function meshVol(P: ArrayLike<number>, I: ArrayLike<number>): number {
  let v = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return v / 6;
}
const V3CACHE = new Map<string, number>();
/** The volume of the whole squishy's detail-3 mesh (V3, the unit of every share), measured here from the mesh of a fresh body. */
export function wholeVolume(sp: string): number {
  let v = V3CACHE.get(sp);
  if (v === undefined) { const b = new SoftBody(speciesBaseGenome(sp as never, 1)); v = meshVol((b as unknown as { Q: Float64Array }).Q, b.indices); V3CACHE.set(sp, v); }
  return v;
}

export function newTree(sp: string): Tree {
  clearPieceCache();
  const genome = speciesBaseGenome(sp as never, 1);
  return { sp, genome, leaves: [{ b: new SoftBody(genome), reg: undefined, np: 0 }], nextId: 1, log: { tried: 0, ok: 0, miss: 0, loose: 0, refused: {}, ctor: 0, deep: 0, ms: [] } };
}

/** Cut leaf `li` with a world plane through its (at rest) pose; 'median' halves the volume along the plane's normal, 'at' cuts where the plane is. Returns 'ok' or why not. */
export function cutLeaf(t: Tree, li: number, plane: CutPlane, mode: 'at' | 'median'): string {
  const { b, reg, np } = t.leaves[li], g = t.genome, L = t.log, t0 = performance.now();
  L.tried++;
  const plan = mkPlan();
  if (!b.planCut!(plane, plan, mode) || !(plan.fa > 0) || !(plan.fa < 1)) { L.miss++; return 'miss'; }
  if (!plan.sound) { L.loose++; return 'loose-plan'; }
  let r: boolean | 'thin' | 'loose' = false;
  for (let k = 0; k < 400 && r === false; k++) r = b.prepareCut!(Infinity, 6);
  if (r !== true) { const key = String(r); L.refused[key] = (L.refused[key] ?? 0) + 1; return 'refused-' + key; }
  const pf = b.frac!, fA = pf * plan.fa, fB = pf - fA, id = t.nextId++;
  const planes = (reg ? reg.planes.slice() : []).concat([{ id, n: { ...plan.rest.n }, d: plan.rest.d }]);
  const lits = reg && reg.cells[0] ? reg.cells[0] : [];
  const ra: PieceRegion = { planes, cells: [[...lits, id]] }, rb: PieceRegion = { planes, cells: [[...lits, -id]] };
  let pa: SoftBody, pb: SoftBody;
  try {
    pa = new SoftBody(g, { piece: { frac: fA, region: ra } } as never);
    pb = new SoftBody(g, { piece: { frac: fB, region: rb } } as never);
  } catch (e) { L.ctor++; return 'ctor: ' + (e as Error).message.slice(0, 50); }
  L.ok++;
  L.ms.push(performance.now() - t0);
  t.leaves.splice(li, 1, { b: pa, reg: ra, np: np + 1 }, { b: pb, reg: rb, np: np + 1 });
  return 'ok';
}

/** A random unit vector. */
export function rndUnit(rnd: () => number): { x: number; y: number; z: number } {
  const z = rnd() * 2 - 1, ph = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
  return { x: r * Math.cos(ph), y: z, z: r * Math.sin(ph) };
}
export function planeAt(b: SoftBody, n: { x: number; y: number; z: number }, off: number): CutPlane {
  return { point: { x: b.center.x + n.x * off * b.restRadius, y: b.center.y + n.y * off * b.restRadius, z: b.center.z + n.z * off * b.restRadius }, normal: n };
}

export interface BuildOpts { crumbP?: number; maxNp?: number; maxTries?: number }
/** Grow a tree to `pieces` leaves by "Split in two" on the largest leaf (median plane, random normal) and, with probability crumbP, a swipe near the edge of a random leaf (a tip or a crumb). */
export function buildTree(sp: string, pieces: number, seed: number, o: BuildOpts = {}): Tree {
  const t = newTree(sp), rnd = mulberry32(seed * 7919 + sp.length * 31 + 17), crumbP = o.crumbP ?? 0.35, maxNp = o.maxNp ?? 6, maxTries = o.maxTries ?? pieces * 6 + 20;
  for (let tries = 0; t.leaves.length < pieces && tries < maxTries; tries++) {
    const eligible = t.leaves.map((l, i) => ({ l, i })).filter((x) => x.l.np <= maxNp);
    if (!eligible.length) { t.log.deep++; break; }
    if (rnd() < crumbP) {
      const e = eligible[Math.floor(rnd() * eligible.length)], n = rndUnit(rnd);
      const off = (rnd() < 0.5 ? -1 : 1) * (0.5 + 0.45 * rnd());
      cutLeaf(t, e.i, planeAt(e.l.b, n, off), 'at');
    } else {
      let best = eligible[0];
      for (const e of eligible) if (e.l.b.frac! > best.l.b.frac!) best = e;
      cutLeaf(t, best.i, planeAt(best.l.b, rndUnit(rnd), 0), 'median');
    }
  }
  return t;
}

/** Put every leaf on the mat on a grid (rest pose, lowest particle on the table, `drop` m above it), `spacing` x the widest leaf apart. Returns the bodies. */
export function layout(t: Tree, spacing = 2.4, drop = 0): SoftBody[] {
  const bodies = t.leaves.map((l) => l.b);
  let maxR = 0;
  for (const b of bodies) { let r = 0; const Q = b.restLocal; for (let i = 0; i < Q.length; i += 3) r = Math.max(r, Math.hypot(Q[i], Q[i + 1], Q[i + 2])); maxR = Math.max(maxR, r); }
  const cols = Math.ceil(Math.sqrt(bodies.length)), step = spacing * maxR;
  bodies.forEach((b, i) => {
    const Q = b.restLocal; let lo = Infinity; for (let k = 1; k < Q.length; k += 3) lo = Math.min(lo, Q[k]);
    const cx = (i % cols - (cols - 1) / 2) * step, cz = (Math.floor(i / cols) - (cols - 1) / 2) * step;
    b.placeAt!({ x: cx, y: -lo + 1e-3 + drop, z: cz }, { x: 0, y: 0, z: 0 });
  });
  return bodies;
}

/** Step the world one frame the way the shell does: the contact pass (`collide` of everything on everything, or the planner), then every step. */
export function stepAll(bodies: readonly SoftBody[], dt = DT, planner?: { run(b: readonly SoftBody[]): void }): void {
  if (planner) planner.run(bodies);
  else for (const b of bodies) b.collide(bodies);
  for (const b of bodies) b.step(dt);
}

/** Wall-clock ms of `frames` frames of `fn`, as the best (smallest) mean over `batches` batches (the machine is shared and loud). */
export function bestMs(fn: () => void, frames: number, batches = 5): number {
  let best = Infinity;
  for (let k = 0; k < batches; k++) {
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) fn();
    best = Math.min(best, (performance.now() - t0) / frames);
  }
  return best;
}
/** The height of the rest centre that stands the body on the table (its lowest rest particle at y = 0). */
export function restY(b: SoftBody): number { const Q = b.restLocal; let lo = Infinity; for (let k = 1; k < Q.length; k += 3) lo = Math.min(lo, Q[k]); return -lo + 1e-3; }
export const f = (x: number, n = 3): number => +x.toFixed(n);
