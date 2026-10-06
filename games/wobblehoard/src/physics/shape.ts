// Rest shapes. A rest shape is a PURE FUNCTION of (species, unit direction, size): `restPoint()`. Since physics round 2 every species,
// DOLLOP included, takes its shape from its catalog recipe (src/data/catalog.ts speciesDef(id).shape, evaluated by src/data/shapes.ts
// evalShape, THE single rest-shape evaluator), so the 50 species need no physics code of their own; an unknown species is a DOLLOP.
// On top of the recipe the physics adds two things a recipe does not say:
//   * a FLAT FOOT: the lowest FOOT_CUT of the standing height is flattened onto a plane (a smooth max, then snapped), so every species
//     rests on a patch of exactly coplanar particles and rest on the table is exact (no rocking on a single vertex);
//   * the FLOPPY weight of each particle (0 body .. 1 tip of a thin feature: the swirl-peak, a horn, an ear, a tail, a star point). The
//     solver softens the shape matching there (SoftParams.peakSoft), holds the feature's own shape with the Laplacian (bendFloor) and
//     puts thin-part struts through it (struts.ts), so a thin feature flops and recovers instead of folding. It comes from the recipe:
//     every bump or ridge contributes its own Gaussian widened by FLOPPY_WIDEN radians, weighted by how THIN it is (tall for its width,
//     and narrow: a horn or an ear is fully floppy; a broad swelling or a cube's rounded corner is not).
// A PARAMETRIC recipe (a `peak` and/or a `foot`, see src/data/shapes.ts; DOLLOP since the round-2 fix round) is evaluated with its own
// forward map, shapePoint, so its points are placed exactly where the recipe puts them (the pinched peak packs vertices into the tip),
// and it carries its own foot (the generic FOOT_CUT foot is not added). Its peak is floppy by definition: exp(-(theta / (PEAK_FLOPPY x
// width))^2) of the sphere direction, which for DOLLOP (width 0.40) is the 0.7 rad zone its solver was tuned with. So the physics DOLLOP
// is the hand-built one of 6dff62e point for point: same particles, floppy weights and struts.
import type { Genome } from '../core/genome.ts';
import { clamp, lerp } from '../core/rng.ts';
import type { IcoMesh } from './mesh.ts';
import { getSpecies } from '../data/catalog.ts';
import { DOLLOP_RECIPE, evalShape, forEachDirection, shapePoint } from '../data/shapes.ts';
import type { ShapeRecipe, ShapeFeature } from '../data/shapes.ts';

export interface RestShape {
  /** Rest positions relative to the mass-weighted rest centre (3 per vertex). */
  restLocal: Float64Array;
  /** Per-vertex weight of the floppy part (the swirl-peak): 0 = body, 1 = tip. The solver maps it to a stiffness multiplier. */
  floppy: Float64Array;
  /** Per-vertex thin feature the floppy weight belongs to (floppyFeature; -1 = none). Struts only join particles of the same feature. */
  feature: Int16Array;
  /** Per-vertex strut weight: the floppy weight, faded out in a VALLEY between two thin features (strutWeight). Struts are built on it. */
  strutW: Float64Array;
  /** Per-vertex mass from tributary rest area, normalised to mean 1. */
  mass: Float64Array;
  /** Nominal radius R0 (0.5 x lerp(0.8, 1.25, size)). */
  restRadius: number;
  /** Height of the rest centre of mass above the table when the foot rests on y = 0. */
  restCenterY: number;
  /** Index of the highest rest vertex (the swirl tip). */
  peakVertex: number;
  /** Enclosed volume of the rest mesh. */
  restVolume: number;
  /** Rest height (table to tip) and rest width (max x-z extent). */
  height: number;
}

/**
 * The genome fields the physics reads, made safe. A genome arrives from a share string, a save file or another lane, so physics
 * never trusts it: a unit field (firmness, bounce, stretch, size) that is finite is clamped to 0..1; one that is missing or NOT
 * finite (NaN, +/-Infinity) takes its documented default, GENOME_DEFAULTS (the middle of the range: a NaN must not silently turn
 * into the floppiest or the firmest toy). `seed` becomes a uint32 (non-finite -> 0); a `species` that is not a string becomes
 * 'dollop' (restPoint already maps an unknown species name to the dollop shape). A null genome gives all defaults.
 */
export interface PhysGenome { species: Genome['species']; seed: number; firmness: number; bounce: number; stretch: number; size: number }
export const GENOME_DEFAULTS: Readonly<PhysGenome> = { species: 'dollop', seed: 0, firmness: 0.5, bounce: 0.5, stretch: 0.5, size: 0.5 };
const unitOr = (v: unknown, def: number): number => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 1) : def);
export function physicsGenome(g: Partial<Genome> | null | undefined): PhysGenome {
  const d = GENOME_DEFAULTS;
  if (!g || typeof g !== 'object') return { ...d };
  return {
    species: typeof g.species === 'string' ? g.species : d.species,
    seed: typeof g.seed === 'number' && Number.isFinite(g.seed) ? g.seed >>> 0 : d.seed,
    firmness: unitOr(g.firmness, d.firmness), bounce: unitOr(g.bounce, d.bounce), stretch: unitOr(g.stretch, d.stretch), size: unitOr(g.size, d.size),
  };
}

/** Radius R0 for a genome: 0.5 x lerp(0.8, 1.25, size) (size sanitised by physicsGenome). */
export const restRadiusOf = (g: Partial<Genome> | null | undefined): number => 0.5 * lerp(0.8, 1.25, physicsGenome(g).size);

/** Flat foot: the lowest FOOT_CUT x standing height (rest radii) of every shape is flattened onto a plane (DOLLOP: 0.05 R0). */
const FOOT_CUT = 0.025;
/** Smooth-max blend width of the foot edge, rest radii (the old hand-built DOLLOP used 0.035). */
const FOOT_SOFT = 0.035;
/** The floppy zone of a thin feature is its own width plus this (radians; DOLLOP's peak: 0.35 -> the 0.7 rad zone it was tuned with). */
const FLOPPY_WIDEN = 0.35;
/** Thinness of a feature: smoothstep(THIN_LO, THIN_HI) of amplitude / width (tall for its width) x (1 - smoothstep(NARROW_LO, NARROW_HI) of
 *  the width) (narrow). tuned on the 50-species smoke: a width-only or ratio-only test made cushlet's four rounded corners floppy, which
 *  softened 97% of its particles (624 of 642) and built 1560 struts. */
const THIN_LO = 0.7, THIN_HI = 1.3, NARROW_LO = 0.4, NARROW_HI = 0.6;
/** Floppy zone of a parametric peak in units of its width (DOLLOP: 1.75 x 0.40 = the 0.7 rad FLOPPY_SIGMA of the hand-built DOLLOP). */
const PEAK_FLOPPY = 1.75;

/** Recipe of a species (an unknown or hostile id is DOLLOP). */
export function recipeOf(species: unknown): ShapeRecipe {
  const d = getSpecies(species);
  return d ? d.shape : DOLLOP_RECIPE;
}

interface ShapeInfo { bottom: number; floor: number }
const INFO = new Map<ShapeRecipe, ShapeInfo>();
/** Lowest point of a recipe (units of R0, relative to its centre) and its foot plane. Cached per recipe (computed once, ~4000 evaluations). */
function shapeInfo(r: ShapeRecipe): ShapeInfo {
  let info = INFO.get(r);
  if (!info) {
    let lo = Infinity, hi = -Infinity;
    forEachDirection(4096, (x, y, z) => { const v = y * evalShape(r, x, y, z); if (v < lo) lo = v; if (v > hi) hi = v; });
    info = { bottom: lo, floor: lo + FOOT_CUT * (hi - lo) };
    INFO.set(r, info);
  }
  return info;
}

const sstep = (a: number, b: number, x: number): number => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const featW = (f: ShapeFeature, dx: number, dy: number, dz: number, widen: number): number => {
  const d = f.dir, w = f.width + widen, dot = dx * d[0] + dy * d[1] + dz * d[2];
  if (f.kind === 'ridge' && f.n && f.len) {
    const n = f.n, across = dx * n[0] + dy * n[1] + dz * n[2], len = f.len + widen;
    return Math.exp(-(across * across) / (w * w) - (2 - 2 * dot) / (len * len));
  }
  return Math.exp(-(2 - 2 * dot) / (w * w));
};
/** Which thin feature the last floppyOf() call's weight came from (2 x feature index, + 1 for a mirror copy; -1 = none). */
export let floppyFeature = -1;
/** The largest floppy contribution of any OTHER thin feature (or mirror copy) at the last floppyOf() direction (0 for a lone feature). */
export let floppySecond = 0;
/** Floppy weight 0..1 of a direction: the thin bumps and ridges of the recipe (see the header). Sets floppyFeature. */
export function floppyOf(r: ShapeRecipe, dx: number, dy: number, dz: number): number {
  let fl = 0, f2 = 0;
  floppyFeature = -1;
  const pk = r.peak;
  if (pk !== undefined) {
    const a = pk.dir, c = clamp(dx * a[0] + dy * a[1] + dz * a[2], -1, 1), q = Math.acos(c) / (PEAK_FLOPPY * pk.width);
    fl = Math.exp(-q * q); floppyFeature = 2 * r.features.length;
  }
  const take = (w: number, id: number): void => {
    if (w > fl) { f2 = fl; fl = w; floppyFeature = id; } else if (w > f2) f2 = w;
  };
  r.features.forEach((f, k) => {
    if (f.kind === 'dent') return;
    const t = sstep(THIN_LO, THIN_HI, f.amp / f.width) * (1 - sstep(NARROW_LO, NARROW_HI, f.width));
    if (t <= 0) return;
    take(t * featW(f, dx, dy, dz, FLOPPY_WIDEN), 2 * k);
    if (f.mirrorX) take(t * featW(f, -dx, dy, dz, FLOPPY_WIDEN), 2 * k + 1);
  });
  floppySecond = f2;
  return fl;
}

/**
 * VALLEYS BETWEEN THIN FEATURES (physics round-2 fix round). Struts are the interior of ONE thin feature (struts.ts). Where two thin
 * features' floppy zones overlap (marigel's eight petals 45 degrees apart: the valley between two petals has floppy 0.74 from BOTH), the
 * particle is not inside either feature: it is the body between them, which must flatten when a finger presses across the valley. A strut
 * from a valley particle runs through the base of one petal and holds the valley floor out at its rest distance from the petal's far wall,
 * so the pressed valley folds over that stiff point (marigel's side press: 160.7 degrees, 26 frames over 120, at the valley particle
 * 1.96 tip radii from the finger; with no struts from particles of floppy < 0.85 the same press peaks at 89 degrees).
 * So a particle's strut weight is its floppy weight faded by how strongly a SECOND feature claims it: x (1 - smoothstep(VALLEY_LO,
 * VALLEY_HI, second / first)). A lone feature (DOLLOP's peak, a horn, the core of each petal, where the neighbour's weight is < 0.5 of its
 * own) keeps its full weight, so DOLLOP's struts are exactly the ones it was tuned with; the exact saddle between two equal features gets 0.
 */
const VALLEY_LO = 0.5, VALLEY_HI = 0.9;
export function strutWeight(fl: number, second: number): number {
  return fl > 0 ? fl * (1 - sstep(VALLEY_LO, VALLEY_HI, second / fl)) : 0;
}

/**
 * Rest point for a unit direction. Writes xyz into out[o..o+2] and returns the floppy-part weight (0..1: 1 at the tip of a thin feature).
 * No state, no randomness: the same (species, direction, R0) always gives the same point. Position = u * evalShape(recipe, u) * R0, with
 * the flat foot applied (a recipe with its own foot: shapePoint(recipe, u) * R0).
 */
export function restPoint(species: Genome['species'], dx: number, dy: number, dz: number, R0: number, out: Float64Array | number[], o: number): number {
  const rec = recipeOf(species);
  if (rec.foot !== undefined) {
    // parametric recipe with its own foot (DOLLOP): the recipe's map, as is
    shapePoint(rec, dx, dy, dz, out, o);
    out[o] *= R0; out[o + 1] *= R0; out[o + 2] *= R0;
    return floppyOf(rec, dx, dy, dz);
  }
  const info = shapeInfo(rec);
  const r = evalShape(rec, dx, dy, dz) * R0;
  const x = dx * r, z = dz * r;
  let y = dy * r;
  // flat foot: smooth max with the foot plane, then snapped, so the body sits on a patch of exactly coplanar particles
  const floor = info.floor * R0, k = FOOT_SOFT * R0;
  y = 0.5 * (y + floor + Math.sqrt((y - floor) * (y - floor) + k * k));
  if (y - floor < 0.004 * R0) y = floor;
  out[o] = x; out[o + 1] = y; out[o + 2] = z;
  return floppyOf(rec, dx, dy, dz);
}

/** Signed enclosed volume of a closed triangle mesh (positive for outward winding). */
export function meshVolume(pos: ArrayLike<number>, tris: Uint32Array): number {
  let v = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, c = tris[t + 2] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const bx = pos[b], by = pos[b + 1], bz = pos[b + 2];
    const cx = pos[c], cy = pos[c + 1], cz = pos[c + 2];
    v += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

export function buildRest(genome: Genome, mesh: IcoMesh): RestShape {
  const n = mesh.vertexCount;
  const pg = physicsGenome(genome);
  const R0 = restRadiusOf(pg);
  const p = new Float64Array(n * 3);
  const floppy = new Float64Array(n), feature = new Int16Array(n), strutW = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    floppy[i] = restPoint(pg.species, mesh.dirs[i * 3], mesh.dirs[i * 3 + 1], mesh.dirs[i * 3 + 2], R0, p, i * 3);
    feature[i] = floppyFeature;
    strutW[i] = strutWeight(floppy[i], floppySecond);
  }
  // tributary-area masses (a third of each incident triangle), mean 1
  const mass = new Float64Array(n);
  const tris = mesh.tris;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 3;
    mass[a] += area; mass[b] += area; mass[c] += area;
  }
  let msum = 0;
  for (let i = 0; i < n; i++) msum += mass[i];
  for (let i = 0; i < n; i++) mass[i] = (mass[i] * n) / msum;
  // centre on the mass-weighted centroid
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += mass[i] * p[i * 3]; cy += mass[i] * p[i * 3 + 1]; cz += mass[i] * p[i * 3 + 2]; }
  cx /= n; cy /= n; cz /= n;
  let minY = Infinity, maxY = -Infinity, peak = 0;
  for (let i = 0; i < n; i++) {
    p[i * 3] -= cx; p[i * 3 + 1] -= cy; p[i * 3 + 2] -= cz;
    if (p[i * 3 + 1] < minY) minY = p[i * 3 + 1];
    if (p[i * 3 + 1] > maxY) { maxY = p[i * 3 + 1]; peak = i; }
  }
  return {
    restLocal: p, floppy, feature, strutW, mass, restRadius: R0, restCenterY: -minY, peakVertex: peak,
    restVolume: meshVolume(p, tris), height: maxY - minY,
  };
}

/**
 * CUT (_spec/CUT.md 4.3): the rest shape of a CHUNK, an eyeless piece of a cut squishy: a rounded blob (a slightly squat ellipsoid, 1.1 x 0.85 x
 * 1.1, with the flat foot every shape stands on) of radius `R0` (the piece's own nominal radius: the whole's x cbrt(frac)). No thin features:
 * every floppy and strut weight is 0. The FLAT CUT FACE is not part of the rest shape (a chunk rounds over with time, CUT.md 1): flatPoints()
 * gives the same mesh with the face cut flat, which the solver uses as a goal that eases to this rest shape.
 */
export function buildChunkRest(mesh: IcoMesh, R0: number): RestShape {
  const n = mesh.vertexCount, p = new Float64Array(n * 3);
  // the blob's own lowest point and foot plane (same flat-foot rule as restPoint)
  const ry = 0.85, floor = -ry + FOOT_CUT * 2 * ry, k = FOOT_SOFT;
  for (let i = 0; i < n; i++) {
    const dx = mesh.dirs[i * 3], dy = mesh.dirs[i * 3 + 1], dz = mesh.dirs[i * 3 + 2];
    const r = 1 / Math.sqrt((dx / 1.1) ** 2 + (dy / ry) ** 2 + (dz / 1.1) ** 2);
    let y = dy * r;
    y = 0.5 * (y + floor + Math.sqrt((y - floor) * (y - floor) + k * k));
    if (y - floor < 0.004) y = floor;
    p[i * 3] = dx * r * R0; p[i * 3 + 1] = y * R0; p[i * 3 + 2] = dz * r * R0;
  }
  const mass = new Float64Array(n), tris = mesh.tris;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], c = tris[t + 2];
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 3;
    mass[a] += area; mass[b] += area; mass[c] += area;
  }
  let msum = 0;
  for (let i = 0; i < n; i++) msum += mass[i];
  for (let i = 0; i < n; i++) mass[i] = (mass[i] * n) / msum;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += mass[i] * p[i * 3]; cy += mass[i] * p[i * 3 + 1]; cz += mass[i] * p[i * 3 + 2]; }
  cx /= n; cy /= n; cz /= n;
  let minY = Infinity, maxY = -Infinity, peak = 0;
  for (let i = 0; i < n; i++) {
    p[i * 3] -= cx; p[i * 3 + 1] -= cy; p[i * 3 + 2] -= cz;
    if (p[i * 3 + 1] < minY) minY = p[i * 3 + 1];
    if (p[i * 3 + 1] > maxY) { maxY = p[i * 3 + 1]; peak = i; }
  }
  return {
    restLocal: p, floppy: new Float64Array(n), feature: new Int16Array(n).fill(-1), strutW: new Float64Array(n), mass, restRadius: R0,
    restCenterY: -minY, peakVertex: peak, restVolume: meshVolume(p, tris), height: maxY - minY,
  };
}

/**
 * The FLAT CUT FACE of a chunk (CUT.md 1): `rest` (rest-local, centred) with every point beyond the plane at `depth` x R0 along the unit
 * normal (nx, ny, nz) pulled onto that plane (a smooth max of width `soft` R0, like the foot), then scaled about the centre to the rest
 * volume (so the goal that eases from it to the rest shape never asks for another volume). Writes into `out`.
 */
export function flatPoints(rest: Float64Array, tris: Uint32Array, R0: number, nx: number, ny: number, nz: number, out: Float64Array): void {
  const n = rest.length / 3, depth = 0.55 * R0, soft = 0.06 * R0;
  for (let i = 0; i < n; i++) {
    const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2], s = x * nx + y * ny + z * nz;
    // smooth min(s, depth): points past the face plane come down onto it
    const sm = 0.5 * (s + depth - Math.sqrt((s - depth) * (s - depth) + soft * soft));
    const d = sm - s;
    out[i * 3] = x + nx * d; out[i * 3 + 1] = y + ny * d; out[i * 3 + 2] = z + nz * d;
  }
  const v0 = meshVolume(rest, tris), v1 = meshVolume(out, tris);
  const k = v1 > 1e-12 ? Math.cbrt(v0 / v1) : 1;
  for (let i = 0; i < out.length; i++) out[i] *= k;
}
