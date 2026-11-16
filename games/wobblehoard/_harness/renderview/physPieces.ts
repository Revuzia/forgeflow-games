// RENDER harness: PHYS's PURE piece builder (src/physics/piece.ts) behind the stub body's RestProvider (src/render/stubBody.ts). src/render never imports src/physics;
// this file lives in the harness, so the render probes (browser and node) can cut a real species' real rest mesh with the real region code and then drive the pieces with
// the stub's fake dynamics. It is a READER of PHYS's files: nothing here edits them.
import type { Genome } from '../../src/core/genome.ts';
import type { PieceRegion, V3 } from '../../src/contracts.ts';
import { buildRest } from '../../src/physics/shape.ts';
import { buildPiece, CutJob } from '../../src/physics/piece.ts';
import type { PieceBuilt } from '../../src/physics/piece.ts';
import { icoOf } from '../../src/physics/region.ts';
import type { RestPiece, RestProvider, RestWhole } from '../../src/render/stubBody.ts';

export interface CutSide { region: PieceRegion; rest: RestPiece; frac: number }
export interface CutResult { a: CutSide; b: CutSide; d: number; fa: number }

export interface PhysPieces extends RestProvider {
  /** Cut the whole of `genome` by the plane n . x = d in W (side A: n . x >= d) with PHYS's CutJob (retry ladder included). `refused`: 'thin' | 'loose' | 'misses'. */
  cut(genome: Genome, n: V3, d: number, id?: number, parent?: CutSide): CutResult | { refused: string };
  /** The whole's W-frame rest mesh in f64 (what the planes are measured against) and its volume. */
  wholeMesh(genome: Genome): { pos: Float64Array; tris: Uint32Array; radius: number };
  /** Make a piece findable by its region object (used by the exact-clip reference below). */
  register(region: PieceRegion, rest: RestPiece): void;
  /**
   * REFERENCE, not PHYS's builder: the two pieces of the plane n . x = d cut EXACTLY out of the whole's own detail-3 triangles (triangles that cross the plane are split, the cut polygon
   * is closed by a fan). Their skin IS the whole's skin, so a picture of the two flush halves differs from the whole's only by what the RENDER does (tessellation, normals at the rim):
   * the floor under the RP4 bars, separated from PHYS's re-mesh error.
   */
  exactCut(genome: Genome, n: V3, d: number, id?: number): CutResult | { refused: string };
}

const toRest = (b: PieceBuilt): RestPiece => ({
  restLocal: Float32Array.from(b.rest.restLocal), indices: Uint32Array.from(b.mesh.tris), radius: b.rest.restRadius, frac: b.frac,
  offset: { x: b.offset.x, y: b.offset.y, z: b.offset.z }, rayOrigin: { x: b.rayOrigin.x, y: b.rayOrigin.y, z: b.rayOrigin.z }, cells: b.cells,
});

export function physPieces(): PhysPieces {
  const wholes = new WeakMap<Genome, { w: RestWhole; pos: Float64Array; tris: Uint32Array }>();
  const built = new WeakMap<PieceRegion, RestPiece>();   // the pieces a cut() made, found again by their region object
  const wholeOf = (g: Genome): { w: RestWhole; pos: Float64Array; tris: Uint32Array } => {
    let e = wholes.get(g);
    if (!e) {
      const ico = icoOf(3), r = buildRest(g, ico);
      e = { w: { restLocal: Float32Array.from(r.restLocal), indices: Uint32Array.from(ico.tris), radius: r.restRadius }, pos: r.restLocal, tris: ico.tris };
      wholes.set(g, e);
    }
    return e;
  };
  return {
    whole: (g) => wholeOf(g).w,
    wholeMesh: (g) => { const e = wholeOf(g); return { pos: e.pos, tris: e.tris, radius: e.w.radius }; },
    piece(g, region, detail, frac) {
      const hit = built.get(region);
      if (hit) return hit;
      const out = buildPiece(g, region, detail, frac);
      if ('fail' in out) return null;
      const r = toRest(out);
      built.set(region, r);
      return r;
    },
    register(region, rest) { built.set(region, rest); },
    exactCut(g, n, d, id = 1) {
      const e = wholeOf(g), pos = e.pos, tris = e.tris;
      const vol = (P: ArrayLike<number>, T: ArrayLike<number>): number => { let v = 0; for (let t = 0; t < T.length; t += 3) { const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3; v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) + P[a + 1] * (P[b + 2] * P[c] - P[b] * P[c + 2]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]); } return Math.abs(v / 6); };
      const V0 = vol(pos, tris);
      const side = (sg: number): CutSide | null => {
        const P: number[] = [], map = new Map<number, number>(), T: number[] = [], seg: [number, number][] = [];
        const tol = 1e-12;
        const sd = (i: number): number => sg * (n.x * pos[i * 3] + n.y * pos[i * 3 + 1] + n.z * pos[i * 3 + 2] - d);
        const vid = (i: number): number => { let k = map.get(i); if (k === undefined) { k = P.length / 3; map.set(i, k); P.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); } return k; };
        const crossings = new Map<string, number>();
        const cross = (a: number, b: number): number => {
          const key = a < b ? a + '_' + b : b + '_' + a;
          let k = crossings.get(key);
          if (k === undefined) {
            const sa = sd(a), sb = sd(b), t = sa / (sa - sb);
            k = P.length / 3; crossings.set(key, k);
            const x = pos[a * 3] + t * (pos[b * 3] - pos[a * 3]), y = pos[a * 3 + 1] + t * (pos[b * 3 + 1] - pos[a * 3 + 1]), z = pos[a * 3 + 2] + t * (pos[b * 3 + 2] - pos[a * 3 + 2]);
            const off = n.x * x + n.y * y + n.z * z - d;   // (snapped onto the plane exactly)
            P.push(x - off * n.x, y - off * n.y, z - off * n.z);
          }
          return k;
        };
        for (let t = 0; t < tris.length; t += 3) {
          const v = [tris[t], tris[t + 1], tris[t + 2]], s3 = v.map(sd);
          if (s3.every((x) => x <= tol)) continue;
          if (s3.every((x) => x >= -tol)) {
            T.push(vid(v[0]), vid(v[1]), vid(v[2]));
            const on = v.filter((_, q) => Math.abs(s3[q]) <= tol);
            if (on.length === 2) seg.push([vid(on[0]), vid(on[1])]);
            continue;
          }
          // a polygon (Sutherland-Hodgman) against the half-space s >= 0
          const poly: number[] = [], onSeg: number[] = [];
          for (let q = 0; q < 3; q++) {
            const a = v[q], b = v[(q + 1) % 3], sa = s3[q], sb = s3[(q + 1) % 3];
            if (sa >= -tol) { poly.push(vid(a)); if (Math.abs(sa) <= tol) onSeg.push(vid(a)); }
            if ((sa > tol && sb < -tol) || (sa < -tol && sb > tol)) { const k = cross(a, b); poly.push(k); onSeg.push(k); }
          }
          for (let q = 1; q + 1 < poly.length; q++) T.push(poly[0], poly[q], poly[q + 1]);
          if (onSeg.length === 2) seg.push([onSeg[0], onSeg[1]]);
        }
        if (T.length === 0 || seg.length < 3) return null;
        // close the cut: a fan around the centroid of the on-plane vertices, wound outward (the piece's outward cap normal is -sg n)
        const on = new Set<number>(); for (const [a, b] of seg) { on.add(a); on.add(b); }
        let cx = 0, cy = 0, cz = 0; for (const k of on) { cx += P[k * 3]; cy += P[k * 3 + 1]; cz += P[k * 3 + 2]; }
        cx /= on.size; cy /= on.size; cz /= on.size;
        const c0 = P.length / 3; P.push(cx, cy, cz);
        const on3 = { x: -sg * n.x, y: -sg * n.y, z: -sg * n.z };
        for (const [a, b] of seg) {
          const ux = P[a * 3] - cx, uy = P[a * 3 + 1] - cy, uz = P[a * 3 + 2] - cz, vx = P[b * 3] - cx, vy = P[b * 3 + 1] - cy, vz = P[b * 3 + 2] - cz;
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          if (nx * on3.x + ny * on3.y + nz * on3.z > 0) T.push(c0, a, b); else T.push(c0, b, a);
        }
        // the piece: rest-local = W - offset (the vertex mean), its volume share, its cell
        const m = P.length / 3; let ox = 0, oy = 0, oz = 0; for (let i = 0; i < m; i++) { ox += P[i * 3]; oy += P[i * 3 + 1]; oz += P[i * 3 + 2]; }
        ox /= m; oy /= m; oz /= m;
        const rl = new Float32Array(m * 3); for (let i = 0; i < m; i++) { rl[i * 3] = P[i * 3] - ox; rl[i * 3 + 1] = P[i * 3 + 1] - oy; rl[i * 3 + 2] = P[i * 3 + 2] - oz; }
        const frac = vol(P, T) / V0;
        const rest: RestPiece = { restLocal: rl, indices: Uint32Array.from(T), radius: e.w.radius * Math.cbrt(frac), frac, offset: { x: ox, y: oy, z: oz }, rayOrigin: { x: 0, y: 0, z: 0 }, cells: [[{ n: { x: -sg * n.x, y: -sg * n.y, z: -sg * n.z }, d: -sg * d, id }]] };
        const region: PieceRegion = { planes: [{ id, n: { x: n.x, y: n.y, z: n.z }, d }], cells: [[sg > 0 ? id : -id]] };
        built.set(region, rest);
        return { region, rest, frac };
      };
      const a = side(1), b = side(-1);
      if (!a || !b) return { refused: 'the plane misses the whole' };
      return { a, b, d, fa: a.frac };
    },
    cut(g, n, d, id = 1, parent) {
      const e = wholeOf(g);
      let par: { region: PieceRegion | undefined; frac: number; pos: ArrayLike<number>; tris: Uint32Array } = { region: undefined, frac: 1, pos: e.pos, tris: e.tris };
      if (parent) {   // a NESTED cut: the parent piece's rest mesh in W (restLocal + offset) and its region
        const r = parent.rest, pos = new Float64Array(r.restLocal.length);
        for (let i = 0; i < pos.length; i += 3) { pos[i] = r.restLocal[i] + r.offset.x; pos[i + 1] = r.restLocal[i + 1] + r.offset.y; pos[i + 2] = r.restLocal[i + 2] + r.offset.z; }
        par = { region: parent.region, frac: parent.frac, pos, tris: r.indices };
      }
      const job = new CutJob(g, par, { id, n, d });
      job.run(Infinity);
      if (job.status !== 'ok' || !job.a || !job.b) return { refused: job.status + (job.why ? ' (' + job.why + ')' : '') };
      const a: CutSide = { region: job.regionA, rest: toRest(job.a), frac: job.a.frac }, b: CutSide = { region: job.regionB, rest: toRest(job.b), frac: job.b.frac };
      built.set(a.region, a.rest); built.set(b.region, b.rest);
      return { a, b, d: job.d, fa: job.plan.fa };
    },
  };
}
