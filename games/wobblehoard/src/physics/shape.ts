// Rest shapes. A rest shape is a PURE FUNCTION of (species, unit direction, size): `restPoint()`.
// Future species slot in by adding a case to `restPoint()` (and a `soft` weight if they have a floppy part); nothing
// else in the solver knows what a DOLLOP is.
//
// DOLLOP = a whipped-cream dollop: a squat dome (radius R0, flattened to 0.8 in Y) with a flat-ish foot so it sits
// stably, a faint spiral piping ridge on the flanks, and a narrow raised, slightly leaning swirl-peak at +Y.
// The peak is the secondary-motion showpiece, so the shape-matching stiffness drops there (SoftParams.peakSoft):
// it lags behind the body when shoved and flops back with its own, slower wobble (the solver reads `floppy`).
import type { Genome } from '../core/genome.ts';
import { clamp, lerp, smoothstep } from '../core/rng.ts';
import type { IcoMesh } from './mesh.ts';

export interface RestShape {
  /** Rest positions relative to the mass-weighted rest centre (3 per vertex). */
  restLocal: Float64Array;
  /** Per-vertex weight of the floppy part (the swirl-peak): 0 = body, 1 = tip. The solver maps it to a stiffness multiplier. */
  floppy: Float64Array;
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

export const FLATTEN = 0.8;       // Y squash of the dome
const PEAK_SIGMA = 0.40;
const FLOPPY_SIGMA = 0.7;         // angular half-width of the softened zone around the peak, radians          // angular half-width of the swirl-peak, radians
const PEAK_LIFT = 0.46;           // peak height above the dome, in R0
const PEAK_PINCH = 0.50;          // how much the peak narrows toward the axis
const FOOT = 0.90;                // foot plane height as a fraction of the dome's bottom (flat base so it sits)

/**
 * Rest point for a unit direction. Writes xyz into out[o..o+2] and returns the floppy-part weight (0..1: 1 at the swirl tip).
 * No state, no randomness: the same (species, direction, R0) always gives the same point.
 */
export function restPoint(species: Genome['species'], dx: number, dy: number, dz: number, R0: number, out: Float64Array | number[], o: number): number {
  switch (species) {
    case 'dollop':
    default: {
      const theta = Math.acos(clamp(dy, -1, 1));            // angle from +Y
      const phi = Math.atan2(dz, dx);
      const w = Math.exp(-(theta / PEAK_SIGMA) * (theta / PEAK_SIGMA));   // peak weight 0..1
      // piped swirl ridge on the flanks (3 lobes winding with height)
      const ridge = 0.028 * Math.sin(3 * phi + 6.5 * theta) * smoothstep(0.3, 0.8, theta) * (1 - smoothstep(1.9, 2.5, theta));
      let x = dx * R0 * (1 + ridge);
      let y = dy * R0 * FLATTEN * (1 + ridge * 0.5);
      let z = dz * R0 * (1 + ridge);
      // the peak: lift and pinch toward the axis, with a little lean (a curl, so it is not a perfect cone)
      const pinch = 1 - PEAK_PINCH * w;
      x *= pinch; z *= pinch;
      y += R0 * PEAK_LIFT * w;
      x += R0 * 0.085 * w * w;
      z += R0 * 0.03 * w * w;
      // flat foot: smooth max with the foot plane so the body sits on a patch, not on a point
      const floor = -R0 * FLATTEN * FOOT, k = 0.035 * R0;
      y = 0.5 * (y + floor + Math.sqrt((y - floor) * (y - floor) + k * k));
      if (y - floor < 0.004 * R0) y = floor;          // the foot is an exactly flat disc, so rest on the table is exact
      out[o] = x; out[o + 1] = y; out[o + 2] = z;
      return Math.exp(-(theta / FLOPPY_SIGMA) * (theta / FLOPPY_SIGMA));   // the floppy zone is wider than the peak itself, so its BASE can bend
    }
  }
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
  const floppy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    floppy[i] = restPoint(pg.species, mesh.dirs[i * 3], mesh.dirs[i * 3 + 1], mesh.dirs[i * 3 + 2], R0, p, i * 3);
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
    restLocal: p, floppy, mass, restRadius: R0, restCenterY: -minY, peakVertex: peak,
    restVolume: meshVolume(p, tris), height: maxY - minY,
  };
}
