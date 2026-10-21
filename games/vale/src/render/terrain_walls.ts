// VALE render — terrain wall geometry (lane TERRAIN): cut-stone cliffs built course by course, and the
// gorge's walls (the fallen shaft's curved flank, raw rock below, the far walls).
//
// A wall is an OUTLINE (map x, y; closed or open) swept along a PROFILE: a polyline of (offset, height)
// points, offset measured along the outline's outward normal. Every profile segment becomes one strip
// of quads with its own attributes, so a strip can be a face course, a ledge, the lip's chamfer or a
// stretch of gorge rock, and the shader shades each by kind:
//
//   aWallA = (u: arc length along the outline in m, continuous round the wall · vl: 0..1 up the strip ·
//             course index · kind)
//   aWallB = (strip height in m · wall seed · height above the ground plane · the wall's full height)
//
// Normals are the outline's smoothed horizontal normal tilted by the profile slope (no facets at the
// 0.9 m resample), and each quad's winding is matched to its normal. A position-based chisel noise moves
// every vertex along the outline normal, identical for coincident vertices (no cracks).

import { BufferAttribute, BufferGeometry, Path, ShapeGeometry, Shape, ShapeUtils, Vector2 } from 'three';

export type V2 = readonly [number, number];

/** strip kinds (the shader branches on them) */
export const WK = {
  face: 0, step: 1, lipFace: 2, chamfer: 3, lipTop: 4, lipIn: 5, top: 6, flank: 7, rock: 8, band: 9,
} as const;

/** a profile point; `lk` (optional) counts the terraces' ledges above it (fractional on a ledge), so `extra`
 *  can widen or narrow each ledge along the wall */
export interface ProfilePt { off: number; y: number; lk?: number }
export interface Strip { from: ProfilePt; to: ProfilePt; kind: number; course: number }

function h2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vn(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy), b = h2(ix + 1, iy), c = h2(ix, iy + 1), d = h2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** a growing non-indexed mesh with the wall attributes */
export class WallMesh {
  pos: number[] = []; nor: number[] = []; a: number[] = []; b: number[] = [];

  private vert(p: readonly number[], n: readonly number[], a: readonly number[], b: readonly number[]): void {
    this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.a.push(a[0], a[1], a[2], a[3]); this.b.push(b[0], b[1], b[2], b[3]);
  }

  /** quad p0 p1 (bottom: start, end) p2 p3 (top: end, start); winding matched to the mean normal */
  quad(P: number[][], N: number[][], A: number[][], B: number[][]): void {
    const [p0, p1, p2] = P;
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const mx = N[0][0] + N[1][0] + N[2][0] + N[3][0], my = N[0][1] + N[1][1] + N[2][1] + N[3][1], mz = N[0][2] + N[1][2] + N[2][2] + N[3][2];
    const order = cx * mx + cy * my + cz * mz >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const k of order) this.vert(P[k], N[k], A[k], B[k]);
  }

  /** flat top polygon (kind top), from a ShapeGeometry in the x/−y plane; optional holes */
  cap(outline: readonly V2[], y: number, aRow: readonly number[], bRow: readonly number[], holes: readonly (readonly V2[])[] = []): void {
    let pts = outline.map(([x, z]) => new Vector2(x, -z));
    if (ShapeUtils.isClockWise(pts)) pts = pts.reverse();
    const shape = new Shape(pts);
    for (const hl of holes) {
      let hp = hl.map(([x, z]) => new Vector2(x, -z));
      if (!ShapeUtils.isClockWise(hp)) hp = hp.reverse();
      shape.holes.push(new Path(hp));
    }
    const g = new ShapeGeometry(shape, 1);
    const p = g.getAttribute('position') as BufferAttribute;
    const idx = g.index;
    const n = idx ? idx.count : p.count;
    for (let t = 0; t < n; t += 3) {
      const tri = [0, 1, 2].map((k) => (idx ? idx.getX(t + k) : t + k));
      // shape (x, −z) → world (x, y, z); keep the triangle facing up
      const P = tri.map((i) => [p.getX(i), y, -p.getY(i)]);
      const ux = P[1][0] - P[0][0], uz = P[1][2] - P[0][2], vx = P[2][0] - P[0][0], vz = P[2][2] - P[0][2];
      const up = uz * vx - ux * vz;
      const ord = up >= 0 ? [0, 1, 2] : [0, 2, 1];
      for (const k of ord) this.vert(P[k], [0, 1, 0], [P[k][0], P[k][2], aRow[2], aRow[3]], bRow);
    }
    g.dispose();
  }

  /** a planar polygon given in its own 2D frame (to3 lifts a point into the world), facing `n` */
  planar(pts: readonly V2[], to3: (p: V2) => number[], n: readonly number[], aOf: (p: V2) => number[], bOf: (p: V2) => number[]): void {
    const tris = ShapeUtils.triangulateShape(pts.map(([a, b]) => new Vector2(a, b)), []);
    for (const t of tris) {
      const P = t.map((k) => to3(pts[k]));
      const ux = P[1][0] - P[0][0], uy = P[1][1] - P[0][1], uz = P[1][2] - P[0][2];
      const vx = P[2][0] - P[0][0], vy = P[2][1] - P[0][1], vz = P[2][2] - P[0][2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      const ord = cx * n[0] + cy * n[1] + cz * n[2] >= 0 ? [0, 1, 2] : [0, 2, 1];
      for (const k of ord) this.vert(P[k], n, aOf(pts[t[k]]), bOf(pts[t[k]]));
    }
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('aWallA', new BufferAttribute(new Float32Array(this.a), 4));
    g.setAttribute('aWallB', new BufferAttribute(new Float32Array(this.b), 4));
    g.computeBoundingSphere();
    return g;
  }

  get triangles(): number { return this.pos.length / 9; }
}

export interface SweepOpts {
  closed: boolean;
  /** outline orientation: true when the outline's interior lies to the LEFT of travel in map (x, y) (i.e. signed area > 0) */
  ccw: boolean;
  seed: number;
  /** chisel amplitude (m) along the normal; 0 for straight cut faces */
  chisel: number;
  /** vertices on the map border stay put (border walls must meet the map edge exactly) */
  pinned?: (x: number, y: number) => boolean;
  /** per-vertex extra offset (m) along the normal, e.g. a bulge that varies along the wall */
  extra?: (x: number, y: number, h: number, u: number, lk: number) => number;
  /** per-vertex extra height (m), e.g. terraces that dip and rise along the wall (the strata stay level in the
   *  profile's own height, aWallB.z, so they follow the terraces) */
  yExtra?: (x: number, y: number, h: number, u: number) => number;
  /** fade the chisel in over the top `taper` m below height 0 (a face that must meet the ground plane exactly) */
  taper?: number;
  /** open outlines: tilt the normals toward the outline's ends over this many metres (a rounded shoulder) */
  roundEnds?: number;
}

/** sweep an outline along a list of strips */
export function sweep(out: WallMesh, outline: readonly V2[], strips: readonly Strip[], o: SweepOpts, wallH: number): void {
  const n = outline.length;
  if (n < 2) return;
  const segs = o.closed ? n : n - 1;
  // outward normals per segment, then per vertex (averaged)
  const sn: [number, number][] = [];
  for (let i = 0; i < segs; i++) {
    const a = outline[i], b = outline[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    sn.push(o.ccw ? [dy / l, -dx / l] : [-dy / l, dx / l]);
  }
  const vnrm: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const s0 = o.closed ? sn[(i - 1 + segs) % segs] : sn[Math.max(0, i - 1)];
    const s1 = o.closed ? sn[i % segs] : sn[Math.min(segs - 1, i)];
    let x = s0[0] + s1[0], y = s0[1] + s1[1];
    const l = Math.hypot(x, y);
    if (l < 1e-4) { x = s1[0]; y = s1[1]; } else { x /= l; y /= l; }
    vnrm.push([x, y]);
  }
  const U: number[] = [0];
  for (let i = 1; i <= segs; i++) {
    const a = outline[i - 1], b = outline[i % n];
    U.push(U[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const place = (i: number, pp: ProfilePt): number[] => {
    const v = outline[i % n];
    const nr = vnrm[i % n];
    let off = pp.off;
    const pinned = o.pinned?.(v[0], v[1]) ?? false;
    if (!pinned) {
      if (o.chisel > 0) {
        const k = o.chisel * (o.taper ? Math.min(1, Math.max(0, -pp.y / o.taper)) : 1);
        off += (vn(v[0] * 0.9 + pp.y * 1.3 + o.seed, v[1] * 0.9) - 0.5) * k + (vn(v[0] * 2.7 - pp.y * 2.1, v[1] * 2.7 + o.seed) - 0.5) * k * 0.45;
      }
      if (o.extra) off += o.extra(v[0], v[1], pp.y, U[i], pp.lk ?? 0);
    } else if (pp.off > 0) {
      off = 0;
    }
    const dy = !pinned && o.yExtra ? o.yExtra(v[0], v[1], pp.y, U[i]) : 0;
    return [v[0] + nr[0] * off, pp.y + dy, v[1] + nr[1] * off];
  };
  for (const st of strips) {
    const dOff = st.to.off - st.from.off, dY = st.to.y - st.from.y;
    const len = Math.hypot(dOff, dY) || 1;
    // profile-plane normal: (along outward, up)
    const pn = [dY / len, -dOff / len];
    const sh = Math.abs(dY) > 1e-4 ? Math.abs(dY) : len;
    for (let i = 0; i < segs; i++) {
      const j = i + 1;
      const P = [place(i, st.from), place(j, st.from), place(j, st.to), place(i, st.to)];
      const nrm = (k: number): number[] => {
        const v = vnrm[k % n];
        let x = v[0] * pn[0], z = v[1] * pn[0];
        const y = pn[1];
        if (o.roundEnds && !o.closed) {
          // tangent along the outline (start → end); the shoulder leans the normal out over each end
          const a = outline[0], b = outline[n - 1];
          const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          const tx = (b[0] - a[0]) / tl, tz = (b[1] - a[1]) / tl;
          const s0 = Math.max(0, 1 - U[k] / o.roundEnds), s1 = Math.max(0, 1 - (U[segs] - U[k]) / o.roundEnds);
          const s = (s1 - s0) * 1.1;
          x += tx * s; z += tz * s;
        }
        const l = Math.hypot(x, y, z) || 1;
        return [x / l, y / l, z / l];
      };
      const N = [nrm(i), nrm(j), nrm(j), nrm(i)];
      const A = [[U[i], 0, st.course, st.kind], [U[j], 0, st.course, st.kind], [U[j], 1, st.course, st.kind], [U[i], 1, st.course, st.kind]];
      const B = [[sh, o.seed, st.from.y, wallH], [sh, o.seed, st.from.y, wallH], [sh, o.seed, st.to.y, wallH], [sh, o.seed, st.to.y, wallH]];
      out.quad(P, N, A, B);
    }
  }
}

/** a cut-stone cliff profile: battered courses (the base course stands proud), a protruding cap course
 *  with a chamfered outer edge (the painted edge light), a carved lip band on top and the inner bevel */
export function cliffProfile(h: number, seed: number, small: boolean): { strips: Strip[]; topY: number; topOff: number } {
  const strips: Strip[] = [];
  const capH = small ? 0.22 : 0.3;
  const body = Math.max(0.3, h - capH);
  // course heights: 0.45-0.75 m (small walls: 2-3 courses)
  const hs: number[] = [];
  let acc = 0;
  let k = 0;
  while (acc < body - 0.05) {
    let c = (small ? 0.4 : 0.55) + h2(seed * 1.7, k * 3.1) * (small ? 0.18 : 0.35);
    if (body - acc - c < 0.3) c = body - acc;
    hs.push(c); acc += c; k++;
  }
  let y = -0.12;
  let prevOff = 0;
  hs.forEach((c, i) => {
    // batter: each course a little further in; per-course jitter so the steps read as cut stone
    const off = (hs.length - 1 - i) * (small ? 0.025 : 0.035) + (h2(seed + i * 7.3, 2.9) - 0.5) * 0.04;
    const y0 = i === 0 ? y : y;
    if (i > 0 && Math.abs(off - prevOff) > 1e-4) strips.push({ from: { off: prevOff, y: y0 }, to: { off, y: y0 }, kind: WK.step, course: i });
    strips.push({ from: { off, y: y0 }, to: { off, y: y0 + c + (i === 0 ? 0.12 : 0) }, kind: WK.face, course: i });
    y = y0 + c + (i === 0 ? 0.12 : 0);
    prevOff = off;
  });
  const capOff = small ? 0.05 : 0.08;
  const ch = small ? 0.035 : 0.045;
  const lipW = small ? 0.22 : 0.3;
  strips.push({ from: { off: prevOff, y }, to: { off: capOff, y }, kind: WK.step, course: hs.length });
  strips.push({ from: { off: capOff, y }, to: { off: capOff, y: h - ch }, kind: WK.lipFace, course: hs.length });
  strips.push({ from: { off: capOff, y: h - ch }, to: { off: capOff - ch, y: h }, kind: WK.chamfer, course: hs.length });
  strips.push({ from: { off: capOff - ch, y: h }, to: { off: -lipW, y: h }, kind: WK.lipTop, course: hs.length });
  strips.push({ from: { off: -lipW, y: h }, to: { off: -lipW - 0.1, y: h - 0.07 }, kind: WK.lipIn, course: hs.length });
  return { strips, topY: h - 0.07, topOff: 0 };
}

/** the shaft's curved flank under a deck edge (into the gorge = negative offset), then raw rock in
 *  strata down to the mist; `bulge` scales the flank (the carved hour-bands stand proud of it) */
export function flankProfile(depth: number, seed: number, bulge = 1): Strip[] {
  const pts: { off: number; y: number; kind: number }[] = [];
  // needle stone: a quarter-round falling away under the deck edge (circle r ≈ 4.5 m, tangent at the top)
  const R = 4.6 * bulge;
  pts.push({ off: 0.12, y: 0.0, kind: WK.flank });                  // tucked under the deck edge: no gaps
  for (let k = 0; k <= 8; k++) {
    const a = (k / 8) * Math.PI * 0.62;
    pts.push({ off: -Math.sin(a) * R * 0.42, y: -(1 - Math.cos(a)) * R * 0.9 - 0.02 - (k === 0 ? 0 : 0), kind: WK.flank });
  }
  const last = pts[pts.length - 1];
  // the cylinder turns back under: then raw rock strata, alternating overhangs and benches
  let y = last.y - 0.8;
  let off = last.off + 0.9;
  pts.push({ off, y, kind: WK.rock });
  let i = 0;
  while (y > -depth) {
    const bed = 1.6 + h2(seed + i, 4.1) * 2.6;
    const step = (h2(seed * 3.1 + i, 1.3) - 0.45) * 1.6;
    pts.push({ off, y: y - bed * 0.85, kind: WK.rock });
    off += step;
    y -= bed;
    pts.push({ off, y, kind: WK.rock });
    i++;
  }
  const strips: Strip[] = [];
  for (let k = 1; k < pts.length; k++) {
    // order top → down: profile normals then face into the gorge (−normal side)
    strips.push({ from: pts[k - 1], to: pts[k], kind: pts[k].kind, course: k });
  }
  return strips;
}

/** a gorge's far wall (Needlespan's map-border chasm edges), seen from across the drop: a rounded, sunlit lip
 *  rolling over from the plateau, then the rock falls in TERRACES — battered faces of 2.6-5.4 m, each ending on
 *  a ledge that steps 0.5-1.7 m out toward the gorge (offset is along the outline's outward normal, away from
 *  the gorge; the profile runs top → down). Up-facing ledges and battered faces catch the sun and the sky, so
 *  from the 52° camera the wall reads as stacked lit bands with mist pooling on the benches, narrowing into
 *  the depth like a canyon: depth, not a flat wall. Now and then a bed is undercut (a dark overhang). */
export function farWallProfile(depth: number, seed: number): Strip[] {
  const pts: ProfilePt[] = [];
  // the lip: tucked just under the plateau ground 0.55 m back, rounding over to the first face (the ground
  // covers its flat start, so the plateau meets the rounded edge without a seam)
  for (let k = 0; k <= 4; k++) {
    const a = (k / 4) * (Math.PI / 2);
    pts.push({ off: 0.55 * (1 - Math.sin(a)), y: -0.55 * (1 - Math.cos(a)) - 0.03 });
  }
  let y = pts[pts.length - 1].y, off = pts[pts.length - 1].off;
  let i = 0;
  while (y > -depth) {
    const bed = 2.6 + h2(seed + i * 1.7, 3.3) * 2.8;
    const under = i > 0 && h2(seed * 1.9 + i, 8.2) < 0.2;
    const batter = under ? -0.55 : 0.18 + h2(seed + i, 5.5) * 0.4;   // > 0: the face leans back (lit)
    pts.push({ off: off - batter * 0.45 - (under ? 0 : 0.12), y: y - bed * 0.4, lk: i });
    pts.push({ off: off - batter * 0.85, y: y - bed * 0.85, lk: i });
    off -= batter; y -= bed;
    pts.push({ off, y, lk: i });
    // the ledge: a bench stepping out toward the gorge, its edge rounded down into the next face
    // the canyon narrows ~1 m per bed, never more than 8 m in (the deck's flank stands across the gorge)
    const ledge = off < -8 ? 0 : (under ? 1.0 : 0.4) + h2(seed * 2.7 + i, 1.1) * 0.9;
    pts.push({ off: off - ledge * 0.7, y: y - 0.04, lk: i + 0.7 });
    off -= ledge;
    pts.push({ off, y: y - 0.22, lk: i + 1 });
    y -= 0.22;
    i++;
  }
  const strips: Strip[] = [];
  for (let k = 1; k < pts.length; k++) strips.push({ from: pts[k - 1], to: pts[k], kind: WK.rock, course: k });
  return strips;
}

/** a carved hour-band: the section of a ring of the shaft where it crosses a deck edge (off > 0 into the deck,
 *  `D` = how far the notch reaches into it). A low inner face toward the walkable deck, a rounded shoulder, a
 *  crown rising to `bH` at the edge, then it rolls over and runs down the flank (flankProfile's quarter-round)
 *  standing ~0.4 m proud of it, and tucks back under. `section` closes the outline through the shaft's body
 *  (the ring's cut end, for planar end caps). */
export function bandRing(D: number, bH: number): { strips: Strip[]; section: V2[] } {
  const pts: ProfilePt[] = [
    { off: D, y: -0.15 }, { off: D, y: 0.32 * bH },
    { off: D - 0.12, y: 0.42 * bH }, { off: D - 0.3, y: 0.47 * bH },
    { off: D * 0.62, y: 0.64 * bH }, { off: D * 0.32, y: 0.84 * bH }, { off: 0.35, y: 0.96 * bH }, { off: 0.05, y: bH },
  ];
  const rc = Math.min(0.9, bH * 0.9);
  for (let k = 1; k <= 6; k++) {
    const a = (k / 6) * (Math.PI / 2);
    pts.push({ off: 0.05 - rc * Math.sin(a), y: bH - rc + rc * Math.cos(a) });
  }
  const R = 4.6, T = 0.4;
  for (let k = 1; k <= 8; k++) {
    const a = (k / 8) * Math.PI * 0.62;
    const y = -(1 - Math.cos(a)) * R * 0.9;
    if (y > pts[pts.length - 1].y - 0.05) continue;
    pts.push({ off: -Math.sin(a) * R * 0.42 - T, y });
  }
  const last = pts[pts.length - 1];
  pts.push({ off: last.off + T + 0.9, y: last.y - 0.6 });
  const strips: Strip[] = [];
  for (let k = 1; k < pts.length; k++) strips.push({ from: pts[k - 1], to: pts[k], kind: WK.band, course: k });
  return { strips, section: pts.map((p): V2 => [p.off, p.y]) };
}
