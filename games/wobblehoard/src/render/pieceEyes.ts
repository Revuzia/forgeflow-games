// Eyes of a PIECE (CUT2 8.3, task R1 part 2): which of the whole's two eyes a piece draws, where each is anchored on the piece's skin, which cut faces clip it.
// Pure (no GPU object): Face turns the result into meshes and per-frame poses, the node checks call it directly.
//
//   membership  P = the bead centre at rest in W. s = max over the piece's planes of (n . P - d) (negative = inside, by the distance to the nearest face). rho = r x 1.24 x max(sx, sy): the
//               widest the bead gets. The remaining width is f = (rho - s) / (2 rho) clamped to [0, 1]; the eye is KEPT iff f >= 0.12. The two sides of one cut have s_A = -s_B, so
//               f_A + f_B = 1: the beads recombine to the whole bead (the 12 % sliver exists only while the pieces are apart).
//   clip        every plane with s_k > -rho crosses the bead: up to two, the nearest first. They clip the bead against the LIVE face (jelly.caps), flush.
//   pose        anchor h = the nearest point of the piece's SKIN (sim triangles that are not in a cap) to the rest surface point under the eye, as a sim triangle + barycentric weights, so the
//               bead rides the piece's skin like a whole's does; off = q - h (rest-local), applied each frame, zero when |off| < 0.01 R0 (so an eye whose piece skin agrees with the whole's is exactly today's pose). The four footprint samples are found the same way; a sample beyond a cut face is flagged and the pose uses the one-sided difference.
import type { PieceInfo } from '../contracts.ts';
import type { SurfaceHit } from './jelly.ts';
import type { PieceBuild } from './pieceBuild.ts';
import type { WholeRef } from './wholeRef.ts';

export const EYE_KEEP_F = 0.12;

export interface PieceEye {
  /** 0 = the -x side eye of the whole, 1 = the other. */
  readonly slot: 0 | 1;
  /** Remaining width of the bead on this piece, 0.12 .. 1 (1 = a whole bead). */
  readonly f: number;
  readonly hit: SurfaceHit;
  readonly foot: readonly SurfaceHit[];
  /** footOk[i]: sample i (east, west, north, south) lies on this piece (not beyond a cut face). */
  readonly footOk: readonly boolean[];
  /** Rest-local offset of the bead from its anchor (0, 0, 0 when none). Not used by a straddled eye: that one is calibrated (below). */
  readonly off: { x: number; y: number; z: number };
  readonly hasOff: boolean;
  /** |q - h|: how far the piece's skin lies from the whole's at the eye (the probes report it; the offset above applies only from 0.01 R0 and for an unclipped eye). */
  readonly offRaw: number;
  /** Where the whole's bead centre is, in this piece's rest frame, and the whole's rest frame of the bead: a straddled eye (one that a cut face clips) is anchored on the rim of the skin, where
   *  the one-sided footprint and the one-sided rim normals tilt and shift the bead by a few degrees and millimetres, so on its first frame its pose is CALIBRATED to exactly these (a constant
   *  correction in the bead's own frame is kept; the bead then follows the piece's skin from there). The two halves of a straddled eye therefore meet as the whole's bead, to the pixel. */
  readonly restCentre: { x: number; y: number; z: number };
  readonly frame: readonly [{ x: number; y: number; z: number }, { x: number; y: number; z: number }, { x: number; y: number; z: number }];
  /** Slots of the cut faces (indices into PieceBuild.planes = JellyView.caps) that clip the bead, nearest first, 0 .. 2. */
  readonly clip: readonly number[];
}

export interface PieceEyes {
  readonly ref: WholeRef;
  readonly eyes: readonly PieceEye[];
  /** Blink seed salt: a hash of the piece's first plane (id and outward normal, so the two sides of a cut differ). 0 for a body that is not cut. */
  readonly salt: number;
}

/** The salt of a piece's blink timer (CUT2 8.3): the two halves of one cut share a plane id but have opposite normals, so they do not blink in lockstep. */
export function pieceSalt(piece: PieceInfo): number {
  const p = piece.cells[0]?.[0];
  if (!p) return 0;
  let h = 0x9e3779b9 ^ Math.imul(p.id | 0, 0x85ebca6b);
  for (const v of [Math.round(p.n.x * 1e4), Math.round(p.n.y * 1e4), Math.round(p.n.z * 1e4)]) { h = Math.imul(h ^ (v | 0), 0xc2b2ae35); h ^= h >>> 15; }
  return h | 0;
}

/**
 * Closest point of the triangle (a, b, c) to p, as barycentric weights (u for a, v for b, w for c). Returns the squared distance. Ericson, Real-Time Collision Detection 5.1.5.
 */
function closestOnTri(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, out: number[]): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let u = 1, v = 0, w = 0;
  const done = (): number => {
    out[0] = u; out[1] = v; out[2] = w;
    const qx = u * ax + v * bx + w * cx - px, qy = u * ay + v * by + w * cy - py, qz = u * az + v * bz + w * cz - pz;
    return qx * qx + qy * qy + qz * qz;
  };
  if (d1 <= 0 && d2 <= 0) return done();
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { u = 0; v = 1; w = 0; return done(); }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const t = d1 / (d1 - d3); u = 1 - t; v = t; w = 0; return done(); }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { u = 0; v = 0; w = 1; return done(); }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const t = d2 / (d2 - d6); u = 1 - t; v = 0; w = t; return done(); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const t = (d4 - d3) / ((d4 - d3) + (d5 - d6)); u = 0; v = 1 - t; w = t; return done(); }
  const den = 1 / (va + vb + vc);
  v = vb * den; w = vc * den; u = 1 - v - w;
  return done();
}

/** The nearest point to (px, py, pz) on the piece's skin triangles, as a sim triangle + barycentric weights (written to `hit`); returns the distance. */
function nearestSkin(rest: ArrayLike<number>, idx: ArrayLike<number>, skin: Uint32Array, px: number, py: number, pz: number, hit: SurfaceHit, tmp: number[]): number {
  let best = Infinity, bt = skin.length ? skin[0] : 0, bu = 1 / 3, bv = 1 / 3, bw = 1 / 3;
  for (let q = 0; q < skin.length; q++) {
    const t = skin[q], a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const d = closestOnTri(px, py, pz, rest[a], rest[a + 1], rest[a + 2], rest[b], rest[b + 1], rest[b + 2], rest[c], rest[c + 1], rest[c + 2], tmp);
    if (d < best) { best = d; bt = t; bu = tmp[0]; bv = tmp[1]; bw = tmp[2]; }
  }
  hit.tri = bt; hit.u = bu; hit.v = bv; hit.w = bw;
  return Math.sqrt(best);
}

/**
 * The eyes a piece draws. `rest`/`idx` are the piece's own rest mesh (rest-local = W - piece.offset), `pb` its PieceBuild (the skin triangle list and the plane order). Allocates (it runs once per
 * piece view and again when a merge publishes a new PieceInfo).
 */
export function buildPieceEyes(rest: ArrayLike<number>, idx: ArrayLike<number>, piece: PieceInfo, pb: PieceBuild, ref: WholeRef): PieceEyes {
  const planes = pb.planes, K = planes.length, off0 = piece.offset;
  const tmp = [0, 0, 0];
  const R0 = ref.radius, rho = ref.rho;
  const eyes: PieceEye[] = [];
  for (let e = 0; e < 2; e++) {
    const er = ref.eyes[e], c = er.centre;
    // membership: s_k of every plane, the largest is the nearest face (negative = inside)
    let s = -Infinity;
    const sk: number[] = [];
    for (let k = 0; k < K; k++) { const p = planes[k], v = p.n.x * c.x + p.n.y * c.y + p.n.z * c.z - p.d; sk.push(v); if (v > s) s = v; }
    const f = K === 0 ? 1 : Math.min(1, Math.max(0, (rho - s) / (2 * rho)));
    if (f < EYE_KEEP_F) continue;
    const order: number[] = [];
    for (let k = 0; k < K; k++) if (sk[k] > -rho) order.push(k);
    order.sort((a, b) => sk[b] - sk[a]);
    const clip = order.slice(0, 2);
    // anchor: the nearest skin point of the piece to the material point under the eye (the whole's flat barycentric point: where a piece whose skin IS the whole's lands exactly on the whole's hit)
    const qx = er.qFlat.x - off0.x, qy = er.qFlat.y - off0.y, qz = er.qFlat.z - off0.z;
    const hit: SurfaceHit = { tri: 0, u: 0, v: 0, w: 0 };
    nearestSkin(rest, idx, pb.skinTris, qx, qy, qz, hit, tmp);
    const a = idx[hit.tri * 3] * 3, b = idx[hit.tri * 3 + 1] * 3, cc = idx[hit.tri * 3 + 2] * 3;
    const hx = hit.u * rest[a] + hit.v * rest[b] + hit.w * rest[cc], hy = hit.u * rest[a + 1] + hit.v * rest[b + 1] + hit.w * rest[cc + 1], hz = hit.u * rest[a + 2] + hit.v * rest[b + 2] + hit.w * rest[cc + 2];
    let ox = qx - hx, oy = qy - hy, oz = qz - hz;
    const offRaw = Math.sqrt(ox * ox + oy * oy + oz * oz);
    const hasOff = clip.length === 0 && offRaw >= 0.01 * R0;   // (a straddled eye is calibrated instead)
    if (!hasOff) { ox = 0; oy = 0; oz = 0; }
    // footprint samples: the whole's four sample points, each looked up on the piece's skin; one beyond a cut face (by more than a tenth of the sample distance) is flagged
    const foot: SurfaceHit[] = [], footOk: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const gx = er.footFlat[i].x, gy = er.footFlat[i].y, gz = er.footFlat[i].z;
      let ok = true;
      for (let k = 0; k < K; k++) { const p = planes[k]; if (p.n.x * gx + p.n.y * gy + p.n.z * gz - p.d > 0.1 * er.dist) { ok = false; break; } }
      const h: SurfaceHit = { tri: 0, u: 0, v: 0, w: 0 };
      nearestSkin(rest, idx, pb.skinTris, gx - off0.x, gy - off0.y, gz - off0.z, h, tmp);
      foot.push(h); footOk.push(ok);
    }
    eyes.push({ slot: e as 0 | 1, f, hit, foot, footOk, off: { x: ox, y: oy, z: oz }, hasOff, offRaw, clip, restCentre: { x: c.x - off0.x, y: c.y - off0.y, z: c.z - off0.z }, frame: er.frame });
  }
  return { ref, eyes, salt: pieceSalt(piece) };
}
