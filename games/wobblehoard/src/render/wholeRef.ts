// WholeRef (CUT2 8.3, task R1 part 2): where the two eyes sit on the WHOLE squishy, computed ONCE per squishy from the whole's rest mesh with the exact formulas Face has always used
// (`radius = restRadius (0.095 + 0.07 eyeSize)`, elevation `3 + 26 eyeHeight` degrees, azimuth `max(9 + 17 eyeSpacing degrees, azMin)`, the direction cast against the rest mesh, the
// four footprint samples). Face (a whole body) reads its anchors from here; a piece reads the same numbers through `pieceEyes.ts`, with the WHOLE's radius, so an eye never shrinks with
// the piece that holds it. `StageLike.eyeAnchors` is `centre` of the two eyes.
// Pure (no three.js object is kept): the node checks load it too.
import type { Genome } from '../core/genome.ts';
import { clamp } from '../core/rng.ts';
import { evalSurface, RestMapper, type RestMeshLike, type SurfaceHit } from './jelly.ts';
import { relaxNormals, simNormals } from './normals.ts';

export interface EyeStyleDef { sx: number; sy: number; sz: number; iris: number; glint: number; lid: number; droop: number }
export const EYE_STYLES: Record<Genome['eyeStyle'], EyeStyleDef> = {
  dot: { sx: 1, sy: 1, sz: 0.5, iris: 0.62, glint: 0.19, lid: 9, droop: 0 },
  oval: { sx: 0.78, sy: 1.34, sz: 0.5, iris: 0.66, glint: 0.18, lid: 9, droop: 0 },
  sleepy: { sx: 1.16, sy: 1.0, sz: 0.46, iris: 0.6, glint: 0.17, lid: 0.18, droop: 0.12 },
  wide: { sx: 1.28, sy: 1.28, sz: 0.52, iris: 0.76, glint: 0.2, lid: 9, droop: 0 },
};

interface P3 { x: number; y: number; z: number }
const hit0 = (): SurfaceHit => ({ tri: 0, u: 0, v: 0, w: 0 });
/** Vector length exactly as THREE.Vector3.length() computes it (Math.hypot can differ in the last bit): the whole's eye pose stays bit-for-bit what it was. */
const len3 = (x: number, y: number, z: number): number => Math.sqrt(x * x + y * y + z * z);

/** One eye on the whole, in the whole's rest-local frame W (its origin is the whole's rest centre of mass). */
export interface EyeRest {
  /** -1 = the eye on the -x side (screen left from the front), +1 the other. Slot 0 is -1, slot 1 is +1. */
  readonly side: -1 | 1;
  /** The cast against the rest mesh and the four footprint samples (east, west, north, south), as sim triangles + barycentric weights. */
  readonly hit: SurfaceHit;
  readonly foot: readonly SurfaceHit[];
  /** Rest-space footprint lengths (east-west, north-south) and the outward normal of the footprint plane. */
  readonly restLx: number; readonly restLy: number;
  readonly restN: P3;
  /** Unit tangents of the eye (east along the surface, north), and the distance of a footprint sample from the eye centre. */
  readonly east: P3; readonly north: P3; readonly dist: number;
  /** The rest surface point under the eye (the Phong point, as drawn). */
  readonly q: P3;
  /** The same material points on the FLAT rest triangles (the barycentric points of `hit` and of the four footprint samples): what a piece searches its own skin for (exact, so a piece
   *  whose skin is the whole's skin lands on exactly the whole's hit and the bead is bit-for-bit the same). */
  readonly qFlat: P3;
  readonly footFlat: readonly P3[];
  /** The rest centre of the bead (q lifted along the footprint normal, a sleepy eye dropped a little): `eyeAnchors`, and the point membership is decided on. */
  readonly centre: P3;
  /** The rest orthonormal frame of the bead (x along the surface, y = z cross x, z = the footprint normal), in W: what a straddled eye on a piece is calibrated to. */
  readonly frame: readonly [P3, P3, P3];
}

export interface WholeRef {
  readonly restLocal: Float32Array;
  /** restRadius of the whole. */
  readonly radius: number;
  /** The bead radius (radius x (0.095 + 0.07 eyeSize)) and the widest the bead gets, r x 1.24 x max(sx, sy) (CUT2 8.3's `rho`). */
  readonly r: number; readonly rho: number;
  readonly style: EyeStyleDef;
  readonly eyes: readonly [EyeRest, EyeRest];
}

const cache = new WeakMap<Float32Array, { key: string; ref: WholeRef }[]>();
const eyeKey = (g: Genome): string => `${g.eyeStyle}|${g.eyeSize}|${g.eyeSpacing}|${g.eyeHeight}`;

/**
 * The eyes of the whole whose rest mesh is (restLocal, indices, vertexCount) and rest radius `radius`. Cached by the identity of `restLocal` plus the four eye genes (two squishies of one
 * species and size share the arrays and may still have different eyes). `mapper`: a RestMapper over the same mesh that the caller already has (Face's), else one is built.
 */
export function wholeRefFor(mesh: RestMeshLike, radius: number, genome: Genome, mapper?: RestMapper): WholeRef {
  const key = eyeKey(genome);
  let list = cache.get(mesh.restLocal);
  if (!list) { list = []; cache.set(mesh.restLocal, list); }
  for (const e of list) if (e.key === key) return e.ref;
  const ref = computeWholeRef(mesh, radius, genome, mapper ?? new RestMapper(mesh));
  list.push({ key, ref });
  if (list.length > 6) list.shift();
  return ref;
}

function computeWholeRef(mesh: RestMeshLike, radius: number, genome: Genome, mapper: RestMapper): WholeRef {
  const st = EYE_STYLES[genome.eyeStyle] ?? EYE_STYLES.dot;
  const R = mesh.restLocal, idx = mesh.indices, nv = mesh.vertexCount;
  const r0 = radius * (0.095 + 0.07 * genome.eyeSize);
  const el = (3 + 26 * genome.eyeHeight) * Math.PI / 180;
  // spacing 0..1 -> 9..26 degrees off the centre line, but never so close that big eyes touch
  const azMin = Math.asin(clamp((r0 * Math.max(st.sx, 1) * 1.3) / (radius * Math.cos(el)), 0, 0.9));
  const az = Math.max((9 + 17 * genome.eyeSpacing) * Math.PI / 180, azMin);
  // the rest normals as the renderer smooths them each frame (area weighted, two relax passes): the surface point and normal the eye is drawn on at rest
  const N = new Float32Array(nv * 3), acc = new Float32Array(nv * 3);
  simNormals(R, idx, N); relaxNormals(N, idx, acc, 0.7); relaxNormals(N, idx, acc, 0.5);
  const eyes: EyeRest[] = [];
  const sp = new Float32Array(3), sn = new Float32Array(3), fp = new Float32Array(12), fn = new Float32Array(12);
  for (const side of [-1, 1] as const) {
    const dx = Math.sin(az * side) * Math.cos(el), dy = Math.sin(el), dz = Math.cos(az * side) * Math.cos(el);
    const hit = hit0();
    mapper.locate(dx, dy, dz, hit);
    // footprint: four rest-space tangent offsets (about one eye radius) around the eye direction (Face.anchorFootprint, unchanged)
    let ex = dz, ey = 0, ez = -dx; { const l = len3(ex, ey, ez) || 1; ex /= l; ey /= l; ez /= l; }
    let nx = dy * ez - dz * ey, ny = dz * ex - dx * ez, nz = dx * ey - dy * ex; { const l = len3(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; }
    const dist = r0 * Math.max(st.sx, 0.9) * 0.9;
    const delta = dist / radius, cs = Math.cos(delta), sin = Math.sin(delta);
    const tans: [number, number, number, number][] = [[ex, ey, ez, 1], [ex, ey, ez, -1], [nx, ny, nz, 1], [nx, ny, nz, -1]];
    const foot: SurfaceHit[] = [], rp: P3[] = [];
    for (const [tx, ty, tz, sg] of tans) {
      const h = hit0();
      mapper.locate(dx * cs + tx * sin * sg, dy * cs + ty * sin * sg, dz * cs + tz * sin * sg, h);
      foot.push(h);
      const a = idx[h.tri * 3] * 3, b = idx[h.tri * 3 + 1] * 3, c = idx[h.tri * 3 + 2] * 3;
      rp.push({ x: h.u * R[a] + h.v * R[b] + h.w * R[c], y: h.u * R[a + 1] + h.v * R[b + 1] + h.w * R[c + 1], z: h.u * R[a + 2] + h.v * R[b + 2] + h.w * R[c + 2] });
    }
    const txx = rp[0].x - rp[1].x, txy = rp[0].y - rp[1].y, txz = rp[0].z - rp[1].z;
    const tyx = rp[2].x - rp[3].x, tyy = rp[2].y - rp[3].y, tyz = rp[2].z - rp[3].z;
    const restLx = Math.max(1e-4, len3(txx, txy, txz)), restLy = Math.max(1e-4, len3(tyx, tyy, tyz));
    let rnx = txy * tyz - txz * tyy, rny = txz * tyx - txx * tyz, rnz = txx * tyy - txy * tyx;
    { const l = len3(rnx, rny, rnz) || 1; rnx /= l; rny /= l; rnz /= l; }
    if (rnx * dx + rny * dy + rnz * dz < 0) { rnx = -rnx; rny = -rny; rnz = -rnz; }
    // the rest pose of the bead, by the formulas of Face.update at squeeze 0 (no tempering: at rest the footprint normal is the rest normal)
    evalSurface(R, N, idx[hit.tri * 3] * 3, idx[hit.tri * 3 + 1] * 3, idx[hit.tri * 3 + 2] * 3, hit.u, hit.v, hit.w, 0.7, sp, 0, sn, 0);
    for (let f = 0; f < 4; f++) { const hf = foot[f]; evalSurface(R, N, idx[hf.tri * 3] * 3, idx[hf.tri * 3 + 1] * 3, idx[hf.tri * 3 + 2] * 3, hf.u, hf.v, hf.w, 0.7, fp, f * 3, fn, f * 3); }
    let vxx = fp[0] - fp[3], vxy = fp[1] - fp[4], vxz = fp[2] - fp[5];
    const vyx = fp[6] - fp[9], vyy = fp[7] - fp[10], vyz = fp[8] - fp[11];
    let zx = vxy * vyz - vxz * vyy, zy = vxz * vyx - vxx * vyz, zz = vxx * vyy - vxy * vyx;
    { const l = len3(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l; }
    if (zx * sn[0] + zy * sn[1] + zz * sn[2] < 0) { zx = -zx; zy = -zy; zz = -zz; }
    const dp = vxx * zx + vxy * zy + vxz * zz; vxx -= zx * dp; vxy -= zy * dp; vxz -= zz * dp;
    { const l = len3(vxx, vxy, vxz); if (l < 1e-4) { vxx = 1; vxy = 0; vxz = 0; } else { vxx /= l; vxy /= l; vxz /= l; } }
    const wyx = zy * vxz - zz * vxy, wyy = zz * vxx - zx * vxz, wyz = zx * vxy - zy * vxx;   // vY = vZ x vX
    const lift = r0 * st.sz * 0.12;
    const cxp = sp[0] + zx * lift - (st.droop ? wyx * r0 * st.droop : 0), cyp = sp[1] + zy * lift - (st.droop ? wyy * r0 * st.droop : 0), czp = sp[2] + zz * lift - (st.droop ? wyz * r0 * st.droop : 0);
    const ha = idx[hit.tri * 3] * 3, hb = idx[hit.tri * 3 + 1] * 3, hc = idx[hit.tri * 3 + 2] * 3;
    const qFlat = { x: hit.u * R[ha] + hit.v * R[hb] + hit.w * R[hc], y: hit.u * R[ha + 1] + hit.v * R[hb + 1] + hit.w * R[hc + 1], z: hit.u * R[ha + 2] + hit.v * R[hb + 2] + hit.w * R[hc + 2] };
    eyes.push({
      side, hit, foot, restLx, restLy, restN: { x: rnx, y: rny, z: rnz }, east: { x: ex, y: ey, z: ez }, north: { x: nx, y: ny, z: nz }, dist,
      q: { x: sp[0], y: sp[1], z: sp[2] }, qFlat, footFlat: rp, centre: { x: cxp, y: cyp, z: czp },
      frame: [{ x: vxx, y: vxy, z: vxz }, { x: wyx, y: wyy, z: wyz }, { x: zx, y: zy, z: zz }],
    });
  }
  return { restLocal: R, radius, r: r0, rho: r0 * 1.24 * Math.max(st.sx, st.sy), style: st, eyes: [eyes[0], eyes[1]] };
}
