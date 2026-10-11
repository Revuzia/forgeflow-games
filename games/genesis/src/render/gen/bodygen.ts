// GENESIS — procedural bodies for peoples and animals (CONTRACT.md §15.6 "Crowds", "Animals"): no capsules, no
// assets — every body is built from code per BODY PLAN, as rigid-with-blended-joints segments bound to a small set of
// bones, so the vertex shader (render/life/bodymat.ts) can pose thousands of them from (anim, phase) alone.
//
// Vertex layout:
//   position, normal  — rest pose, metres (bipeds 1.72 m tall, quadrupeds 1 m at the shoulder, birds / fish 1 m long)
//   aRig  (vec4)      — bone A, bone B, weight of A, part (skin, cloth, cloth2, hair, dark, wood, metal, item, leather,
//                       fur, shell, white, flame, coat, belly, horn, glow)
//   aSel  (vec4)      — required style bits (any), forbidden style bits, held tool id (0 = always), baked AO
// A vertex whose required bits are absent from the instance's style, whose forbidden bits are present, or whose tool
// is not the instance's tool, collapses: one mesh carries every hair style, clothing tier, dress, hat, beard and tool,
// and each person shows only theirs.
//
// Plans: biped (plains / coastal / cold folk: face with eyes, brows, nose, mouth and ears; hands with thumbs; feet;
// hair short / long, beard; clothing by tier: hide wrap and fur cape → woven tunic with sleeves → dyed tunic with trim,
// belt, trousers and boots → coat and hat; long dress), hexapod (the hive: carapace thorax, abdomen, head with compound
// eyes, mandibles and antennae, two arms and four legs), drifter (a floating bell with trailing tentacles), quadruped
// (deer, horse, cattle, bison, bear, wolf, boar, goat, sheep, hare, lizard — proportions, antlers / horns / tusks,
// mane, wool, hump, ears, tails), bird (wings in two segments, tail fan, beak), fish (and whale), insect (locust), ray.
// Each comes in three LODs: full detail, simplified, and a far silhouette (bipeds four: a ~160-triangle mid LOD from
// ~42 m and a ~100-triangle far one, both one mesh for every clothing tier, coloured by the instance's tier).

import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Uint32BufferAttribute } from 'three';
import { HELD, type AnimalForm } from '../life/catalog.ts';

export type V3 = [number, number, number];

export const PLAN = { biped: 0, hex: 1, jelly: 2, quad: 3, bird: 4, fish: 5, insect: 6, ray: 7 } as const;
export const BPART = {
  skin: 0, cloth: 1, cloth2: 2, hair: 3, dark: 4, wood: 5, metal: 6, item: 7, leather: 8, fur: 9, shell: 10, white: 11,
  flame: 12, coat: 13, belly: 14, horn: 15, glow: 16, straw: 17, clay: 18, stone: 19,
  // the far bipeds (one mesh for every clothing tier) colour these by the instance's tier in the shader: the main
  // garment (hide / tunic / coat), legwear (bare legs / trousers), sleeves, forearms (skin / coat), and a hair cap
  // that is skin on the bald; linen: shirt fronts, aprons, bonnets
  garment: 20, legwear: 21, sleeve: 22, forearm: 23, haircap: 24, linen: 25,
} as const;
/** instance style bits (render/life/crowds.ts sets them per person) */
export const STYLE = {
  hairShort: 1, hairLong: 2, tier0: 4, tier1: 8, tier2: 16, tier3: 32, dress: 64, hat: 128, beard: 256, child: 512, bald: 1024,
  // light linen pieces: an apron over a dress, a shirt front in an open coat
  apron: 2048, shirt: 4096,
} as const;

export interface Rig { plan: number; pivots: V3[]; parents: number[] }
export interface BodyMesh { geo: BufferGeometry; rig: Rig; height: number; verts: number }

interface VOpt { req?: number; forbid?: number; tool?: number; ao?: number }

class RigBuilder {
  /**
   * Style bits an instance of this mesh may carry / always carries: a part that needs none of the possible bits, or is
   * forbidden by an ever-present one, is never shown on this mesh and is not built at all (the crowds build one biped
   * per clothing tier, so a mesh does not carry every other tier's clothes collapsed)
   */
  possible = 0x7fffffff;
  always = 0;
  private skip(o: VOpt): boolean { return (!!o.req && (o.req & this.possible) === 0) || (!!o.forbid && (o.forbid & this.always) !== 0); }
  pos: number[] = [];
  nrm: number[] = [];
  rig: number[] = [];
  sel: number[] = [];
  idx: number[] = [];
  vert(p: V3, n: V3, b0: number, b1: number, w0: number, part: number, o: VOpt = {}): number {
    this.pos.push(p[0], p[1], p[2]);
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    this.nrm.push(n[0] / l, n[1] / l, n[2] / l);
    this.rig.push(b0, b1, w0, part);
    this.sel.push(o.req ?? 0, o.forbid ?? 0, o.tool ?? 0, o.ao ?? 1);
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number): void { this.idx.push(a, b, c); }

  /**
   * A parametric surface: f(u, v) → [position, normal] for u ∈ [0,1] around, v ∈ [0,1] along; nu × nv quads; closed
   * in u. `keep(p)` drops triangles whose centroid fails (hair caps, open necklines).
   */
  surface(nu: number, nv: number, f: (u: number, v: number) => [V3, V3], bone: (p: V3, v: number) => [number, number, number], part: number, o: VOpt = {}, keep?: (p: V3) => boolean, aoFn?: (p: V3, v: number) => number): void {
    if (this.skip(o)) return;
    const ids: number[][] = [];
    const P: V3[][] = [];
    for (let j = 0; j <= nv; j++) {
      const row: number[] = [], prow: V3[] = [];
      const v = j / nv;
      for (let i = 0; i <= nu; i++) {
        const u = (i % nu) / nu;
        const [p, n] = f(u, v);
        const [b0, b1, w] = bone(p, v);
        row.push(this.vert(p, n, b0, b1, w, part, { ...o, ao: (o.ao ?? 1) * (aoFn ? aoFn(p, v) : 1) }));
        prow.push(p);
      }
      ids.push(row); P.push(prow);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = ids[j][i], b = ids[j][i + 1], c = ids[j + 1][i], d = ids[j + 1][i + 1];
      if (keep) {
        const pa = P[j][i], pd = P[j + 1][i + 1];
        const cen: V3 = [(pa[0] + pd[0]) / 2, (pa[1] + pd[1]) / 2, (pa[2] + pd[2]) / 2];
        if (!keep(cen)) continue;
      }
      this.idx.push(a, b, d, a, d, c);
    }
  }

  /** ellipsoid at c with radii r (v from bottom to top) */
  ellipsoid(c: V3, r: V3, nu: number, nv: number, bone: (p: V3, v: number) => [number, number, number], part: number, o: VOpt = {}, keep?: (p: V3) => boolean, deform?: (p: V3) => V3): void {
    this.surface(nu, nv, (u, v) => {
      const th = u * Math.PI * 2, ph = -Math.PI / 2 + v * Math.PI;
      const cx = Math.cos(ph) * Math.sin(th), cy = Math.sin(ph), cz = Math.cos(ph) * Math.cos(th);
      let p: V3 = [c[0] + cx * r[0], c[1] + cy * r[1], c[2] + cz * r[2]];
      if (deform) p = deform(p);
      return [p, [cx / r[0], cy / r[1], cz / r[2]]];
    }, bone, part, o, keep);
  }

  /**
   * A tapered tube along a polyline with elliptical sections (rx, rz in the plane ⟂ the axis, "x" toward the
   * builder's side axis). Bone weights per ring come from `bone(t)`. Caps both ends (cap0 / cap1).
   */
  tube(pts: V3[], rad: [number, number][], sides: number, bone: (t: number) => [number, number, number], part: number, o: VOpt = {}, cap0 = true, cap1 = true, side: V3 = [1, 0, 0], axes?: V3[]): void {
    if (this.skip(o)) return;
    const n = pts.length;
    const rings: number[][] = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      const q = pts[Math.min(n - 1, i + 1)], r = pts[Math.max(0, i - 1)];
      let ax = q[0] - r[0], ay = q[1] - r[1], az = q[2] - r[2];
      if (axes) { ax = axes[i][0]; ay = axes[i][1]; az = axes[i][2]; }
      const al = Math.hypot(ax, ay, az) || 1;
      ax /= al; ay /= al; az /= al;
      // u = side ⟂ axis, w = axis × u
      let ux = side[0], uy = side[1], uz = side[2];
      const d = ux * ax + uy * ay + uz * az;
      ux -= ax * d; uy -= ay * d; uz -= az * d;
      let ul = Math.hypot(ux, uy, uz);
      if (ul < 1e-4) { ux = 0; uy = 0; uz = 1; const d2 = az; ux -= ax * d2; uy -= ay * d2; uz -= az * d2; ul = Math.hypot(ux, uy, uz) || 1; }
      ux /= ul; uy /= ul; uz /= ul;
      const wx = ay * uz - az * uy, wy = az * ux - ax * uz, wz = ax * uy - ay * ux;
      const t = i / (n - 1);
      const [b0, b1, w] = bone(t);
      const ring: number[] = [];
      for (let s = 0; s <= sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const [rx, rz] = rad[i];
        const nx = ux * ca / rx + wx * sa / rz, ny = uy * ca / rx + wy * sa / rz, nz = uz * ca / rx + wz * sa / rz;
        ring.push(this.vert([p[0] + (ux * ca * rx + wx * sa * rz), p[1] + (uy * ca * rx + wy * sa * rz), p[2] + (uz * ca * rx + wz * sa * rz)], [nx, ny, nz], b0, b1, w, part, o));
      }
      rings.push(ring);
    }
    for (let i = 0; i < n - 1; i++) for (let s = 0; s < sides; s++) {
      const a = rings[i][s], b = rings[i][s + 1], c = rings[i + 1][s], d = rings[i + 1][s + 1];
      this.idx.push(a, b, d, a, d, c);
    }
    const cap = (i: number, dir: number) => {
      const p = pts[i];
      const q = pts[i + (dir < 0 ? 1 : -1)];
      const nx = (p[0] - q[0]), ny = (p[1] - q[1]), nz = (p[2] - q[2]);
      const [b0, b1, w] = bone(i / (n - 1));
      const c = this.vert(p, [nx, ny, nz], b0, b1, w, part, o);
      for (let s = 0; s < sides; s++) {
        if (dir < 0) this.idx.push(c, rings[i][s + 1], rings[i][s]);
        else this.idx.push(c, rings[i][s], rings[i][s + 1]);
      }
    };
    if (cap0) cap(0, -1);
    if (cap1) cap(n - 1, 1);
  }

  /** a flat two-sided quad strip (wings, fins, cards): corners a b c d */
  card(a: V3, b: V3, c: V3, d: V3, bone: (p: V3) => [number, number, number], part: number, o: VOpt = {}): void {
    if (this.skip(o)) return;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const n: V3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const m: V3 = [-n[0], -n[1], -n[2]];
    const q = [a, b, c, d];
    const f = q.map((p) => { const [b0, b1, w] = bone(p); return this.vert(p, n, b0, b1, w, part, o); });
    const g = q.map((p) => { const [b0, b1, w] = bone(p); return this.vert(p, m, b0, b1, w, part, o); });
    this.idx.push(f[0], f[1], f[2], f[0], f[2], f[3]);
    this.idx.push(g[0], g[2], g[1], g[0], g[3], g[2]);
  }

  /** axis-aligned box rigid to one bone */
  box(c: V3, h: V3, bone: number, part: number, o: VOpt = {}): void {
    if (this.skip(o)) return;
    const [x0, y0, z0] = [c[0] - h[0], c[1] - h[1], c[2] - h[2]], [x1, y1, z1] = [c[0] + h[0], c[1] + h[1], c[2] + h[2]];
    const faces: [V3, V3, V3, V3, V3][] = [
      [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]],
      [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]],
      [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]],
      [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]],
      [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]],
      [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]],
    ];
    for (const [a, b, cc, d, n] of faces) {
      const i0 = this.vert(a, n, bone, bone, 1, part, o), i1 = this.vert(b, n, bone, bone, 1, part, o);
      const i2 = this.vert(cc, n, bone, bone, 1, part, o), i3 = this.vert(d, n, bone, bone, 1, part, o);
      this.idx.push(i0, i1, i2, i0, i2, i3);
    }
  }

  /** lathe about a vertical axis through (cx, cz): profile [r, y] bottom → top, rigid to one bone */
  lathe(cx: number, cz: number, prof: [number, number][], sides: number, bone: number, part: number, o: VOpt = {}): void {
    this.surface(sides, prof.length - 1, (u, v) => {
      const k = v * (prof.length - 1);
      const i = Math.min(prof.length - 2, Math.floor(k));
      const f = k - i;
      const r = prof[i][0] + (prof[i + 1][0] - prof[i][0]) * f, y = prof[i][1] + (prof[i + 1][1] - prof[i][1]) * f;
      const dr = prof[i + 1][0] - prof[i][0], dy = prof[i + 1][1] - prof[i][1];
      const a = u * Math.PI * 2;
      const ca = Math.sin(a), sa = Math.cos(a);
      return [[cx + ca * r, y, cz + sa * r], [ca * dy, -dr, sa * dy]];
    }, () => [bone, bone, 1], part, o);
  }

  build(rig: Rig, height: number): BodyMesh {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aRig', new Float32BufferAttribute(this.rig, 4));
    g.setAttribute('aSel', new Float32BufferAttribute(this.sel, 4));
    const n = this.pos.length / 3;
    g.setIndex(n > 65535 ? new Uint32BufferAttribute(this.idx, 1) : new Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return { geo: g, rig, height, verts: n };
  }
}

const rigid = (b: number) => (): [number, number, number] => [b, b, 1];
/** a limb from its parent's joint: half-blended at the joint, its own bone by a quarter of the way */
const limbW = (b: number, parent: number) => (t: number): [number, number, number] => [b, parent, 0.5 + 0.5 * Math.min(1, t / 0.28)];
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ───────────────────────────── biped ─────────────────────────────

/** bones: 0 pelvis, 1 chest, 2 head, 3 upper arm L, 4 forearm L, 5 upper arm R, 6 forearm R, 7 thigh L, 8 shin L,
 *  9 thigh R, 10 shin R. +Z forward, +X the person's left. */
export const BIPED_RIG: Rig = {
  plan: PLAN.biped,
  pivots: [[0, 0.95, 0], [0, 1.02, 0], [0, 1.47, 0], [0.19, 1.39, 0], [0.215, 1.11, -0.005], [-0.19, 1.39, 0], [-0.215, 1.11, -0.005], [0.095, 0.93, 0], [0.1, 0.5, 0.005], [-0.095, 0.93, 0], [-0.1, 0.5, 0.005]],
  parents: [-1, 0, 1, 1, 3, 1, 5, 0, 7, 0, 9],
};

/** `tier` (0..3): build only that clothing tier's parts (with every hair style, dress, hat, beard and tool) */
export interface BipedOpts { furred: boolean; webbed: boolean; tier?: number }

const TIER_BITS = [STYLE.tier0, STYLE.tier1, STYLE.tier2, STYLE.tier3];

export function bipedMesh(lod: number, o: BipedOpts): BodyMesh {
  if (lod >= 2) return bipedLow(lod, o.furred);
  const b = new RigBuilder();
  if (o.tier !== undefined) {
    const tb = TIER_BITS[Math.max(0, Math.min(3, o.tier))];
    b.always = tb;
    b.possible = tb | STYLE.hairShort | STYLE.hairLong | STYLE.dress | STYLE.hat | STYLE.beard | STYLE.child | STYLE.bald | STYLE.apron | STYLE.shirt;
  }
  const S = lod === 0 ? 1 : lod === 1 ? 0.42 : 0.3;
  const seg = (n: number) => Math.max(3, Math.round(n * S));
  const P = BIPED_RIG.pivots;
  // ── torso: pelvis → chest, an elliptical tube that swells at the chest and narrows at the waist
  const tPts: V3[] = [], tRad: [number, number][] = [];
  const torsoProf: [number, number, number, number][] = [[0.86, 0.15, 0.1, 0.0], [0.96, 0.165, 0.11, 0.0], [1.06, 0.15, 0.1, 0.005], [1.18, 0.16, 0.11, 0.01], [1.3, 0.19, 0.125, 0.01], [1.39, 0.205, 0.11, 0.0], [1.45, 0.12, 0.08, -0.005]];
  const torso = lod === 2 ? [torsoProf[0], torsoProf[3], torsoProf[5], torsoProf[6]] : lod === 1 ? [torsoProf[0], torsoProf[2], torsoProf[4], torsoProf[5], torsoProf[6]] : torsoProf;
  for (const [y, rx, rz, z] of torso) { tPts.push([0, y, z]); tRad.push([rx, rz]); }
  // pelvis region on bone 0, chest on bone 1, blended over the waist
  const torsoBone = (t: number): [number, number, number] => { const y = 0.86 + t * 0.59; const w = Math.min(1, Math.max(0, (y - 0.98) / 0.16)); return [1, 0, w]; };
  // (far LOD: no clothing shells, so the body itself wears the clothes — torso and upper arms in the cloth colour, legs
  // in the second — or every crowd seen from the god camera was a swarm of naked skin-coloured dots)
  const far = lod === 2;
  if (far) b.tube(tPts, tRad, seg(12), torsoBone, BPART.cloth, {}, true, true);
  else {
    // the skin of the belly and back is left out under a tunic, coat or dress (it poked through the clothes as the
    // body twisted); the chest above it stays, under the neckline
    const cut = torso.findIndex((q) => q[0] >= 1.17);
    // (the two pieces share their seam ring exactly — the whole torso's axis there, the same bone blend — or the
    // bare chest of a hide-clad man showed a dashed seam where they met)
    const tAx: V3[] = tPts.map((_, i) => { const q = tPts[Math.min(tPts.length - 1, i + 1)], r = tPts[Math.max(0, i - 1)]; return [q[0] - r[0], q[1] - r[1], q[2] - r[2]]; });
    const tB = (y: number): [number, number, number] => torsoBone((y - 0.86) / 0.59);
    const lowY = tPts.slice(0, cut + 1).map((p) => p[1]), upY = tPts.slice(cut).map((p) => p[1]);
    b.tube(tPts.slice(0, cut + 1), tRad.slice(0, cut + 1), seg(12), (t) => tB(lowY[Math.round(t * (lowY.length - 1))]), BPART.skin, { forbid: STYLE.tier1 | STYLE.tier2 | STYLE.tier3 | STYLE.dress }, true, false, [1, 0, 0], tAx.slice(0, cut + 1));
    b.tube(tPts.slice(cut), tRad.slice(cut), seg(12), (t) => tB(upY[Math.round(t * (upY.length - 1))]), BPART.skin, {}, false, true, [1, 0, 0], tAx.slice(cut));
  }
  // ── neck and head
  // (rounder neck and shoulders up close: at 8 sides they read faceted)
  b.tube([[0, 1.43, 0.0], [0, 1.53, 0.012]], [[0.05, 0.05], [0.046, 0.046]], seg(lod === 0 ? 14 : 8), (t) => [2, 1, 0.4 + 0.6 * t], BPART.skin, {}, false, false);
  const hc: V3 = [0, 1.625, 0.008];
  const headDeform = (p: V3): V3 => {
    const ly = p[1] - hc[1];
    // jaw narrows below the cheekbones, the chin comes forward, the back of the skull rounds out
    let x = p[0], z = p[2];
    if (ly < -0.02) { const k = Math.min(1, (-0.02 - ly) / 0.09); x *= 1 - 0.22 * k; if (z > hc[2]) z = hc[2] + (z - hc[2]) * (1 - 0.1 * k) + 0.008 * k; }
    if (z < hc[2]) z = hc[2] + (z - hc[2]) * 1.06;
    return [x, p[1], z];
  };
  b.ellipsoid(hc, [0.087, 0.113, 0.1], seg(16), seg(12), rigid(2), BPART.skin, {}, undefined, headDeform);
  if (lod <= 1) {
    // face: eyes (white + iris), brows, nose, mouth, ears
    for (const sx of [1, -1]) {
      if (lod === 0) {
        b.ellipsoid([sx * 0.034, 1.637, 0.088], [0.016, 0.011, 0.008], 8, 5, rigid(2), BPART.white);
        b.ellipsoid([sx * 0.034, 1.637, 0.095], [0.008, 0.008, 0.004], 6, 4, rigid(2), BPART.dark);
        b.box([sx * 0.036, 1.657, 0.092], [0.02, 0.004, 0.006], 2, BPART.hair, { forbid: STYLE.bald });
        // the ear: a thin shell set against the skull, its bowl darker inside
        b.ellipsoid([sx * 0.09, 1.627, -0.006], [0.009, 0.029, 0.019], 8, 6, rigid(2), BPART.skin, {}, undefined, (p) => [p[0], p[1], p[2] - (p[1] - 1.627) * 0.18]);
        b.ellipsoid([sx * 0.0955, 1.622, -0.003], [0.005, 0.015, 0.01], 6, 4, rigid(2), BPART.skin, { ao: 0.5 });
      } else {
        b.box([sx * 0.034, 1.638, 0.09], [0.014, 0.008, 0.006], 2, BPART.dark);
      }
    }
    if (lod === 0) {
      // nose: a little wedge
      const nb = b.vert([0, 1.625, 0.1], [0, 0.3, 1], 2, 2, 1, BPART.skin);
      const nt = b.vert([0, 1.6, 0.122], [0, -0.2, 1], 2, 2, 1, BPART.skin);
      const nl = b.vert([0.014, 1.594, 0.104], [0.7, -0.4, 0.6], 2, 2, 1, BPART.skin);
      const nr = b.vert([-0.014, 1.594, 0.104], [-0.7, -0.4, 0.6], 2, 2, 1, BPART.skin);
      b.tri(nb, nr, nt); b.tri(nb, nt, nl); b.tri(nl, nt, nr);
      // mouth
      b.box([0, 1.567, 0.094], [0.02, 0.0035, 0.006], 2, BPART.dark, { ao: 0.6 });
    }
  }
  // ── hair: a cap leaving the face open; long hair down the back; beard; hat
  if (lod <= 1) {
    const capKeep = (p: V3) => { const ly = p[1] - hc[1], lz = p[2] - hc[2]; return ly > 0.035 || (lz < -0.01 && ly > -0.07) || (Math.abs(p[0]) > 0.075 && ly > -0.02 && lz < 0.05); };
    b.ellipsoid([hc[0], hc[1] + 0.008, hc[2] - 0.004], [0.094, 0.12, 0.107], seg(14), seg(10), rigid(2), BPART.hair, { req: STYLE.hairShort | STYLE.hairLong }, capKeep);
    // long hair: clumped locks falling from the crown over the nape and down the back (a single slab read as a plank)
    const locks = lod === 0 ? 9 : 5;
    for (let i = 0; i < locks; i++) {
      const u = (i / (locks - 1)) * 2 - 1;
      const a = u * 1.15, ca = Math.cos(a), sa = Math.sin(a);
      const len = 0.24 + 0.1 * (1 - Math.abs(u)) + 0.035 * Math.sin(i * 2.3);
      const w = 0.026 + 0.008 * Math.cos(i * 1.7);
      const x0 = sa * 0.083, z0 = -ca * 0.088 + 0.004;
      const pts: V3[] = [[x0 * 0.85, 1.69, z0 * 0.8], [x0 * 1.08, 1.6, z0 * 1.08 - 0.01], [x0 * 1.2, 1.5, -0.1 - 0.03 * ca], [x0 * 1.35 + u * 0.01, 1.62 - len * 0.82, -0.115 - 0.025 * ca], [x0 * 1.4 + u * 0.02, 1.62 - len, -0.11 - 0.02 * ca]];
      b.tube(pts, [[w, w * 0.55], [w * 1.15, w * 0.6], [w * 1.1, w * 0.55], [w * 0.8, w * 0.45], [w * 0.25, w * 0.2]], seg(6), (t) => (t < 0.4 ? [2, 2, 1] : [1, 2, Math.min(1, (t - 0.4) * 3)]), BPART.hair, { req: STYLE.hairLong }, false, true, [ca, 0, sa]);
    }
    if (lod === 0) {
      b.ellipsoid([hc[0], hc[1] - 0.006, hc[2] + 0.004], [0.091, 0.117, 0.104], 12, 8, rigid(2), BPART.hair, { req: STYLE.beard }, (p) => p[1] - hc[1] < -0.035 && p[2] - hc[2] > 0.0);
    }
    // a flat cap / brimmed hat
    b.lathe(0, 0.005, [[0.12, 1.705], [0.122, 1.712], [0.095, 1.716], [0.092, 1.77], [0.07, 1.785], [0.001, 1.79]], seg(14), 2, BPART.cloth2, { req: STYLE.hat });
  }
  // ── arms: upper, forearm, hand with a thumb
  for (const [sx, up, fo] of [[1, 3, 4], [-1, 5, 6]] as [number, number, number][]) {
    const sh = P[up], el = P[fo];
    const wr: V3 = [sx * 0.228, 0.855, 0.012];
    // (the arm's skin is left out inside a coat's sleeves)
    const armSel = far ? {} : { forbid: STYLE.tier3 };
    // (one tube from the shoulder to the wrist, the elbow ring blended between the two bones: two overlapping tubes
    // showed a line round every elbow and knee as they bent)
    const armB: [number, number, number][] = [[up, 1, 0.5], [up, up, 1], [fo, up, 0.5], [fo, fo, 1], [fo, fo, 1]];
    b.tube([[sh[0] - sx * 0.02, sh[1] + 0.02, sh[2]], [sh[0], sh[1] - 0.06, 0], [el[0], el[1] + 0.01, el[2]], [lerp3(el, wr, 0.5)[0], lerp3(el, wr, 0.5)[1], 0.0], wr],
      [[0.055, 0.055], [0.05, 0.048], [0.04, 0.038], [0.034, 0.03], [0.026, 0.021]], seg(lod === 0 ? 14 : 8), (t) => armB[Math.round(t * 4)], far ? BPART.cloth : BPART.skin, armSel, true, true);
    // hand
    const hp: V3 = [sx * 0.233, 0.79, 0.022];
    if (lod <= 1) {
      b.ellipsoid(hp, [0.022, 0.052, 0.04], seg(8), seg(6), rigid(fo), BPART.skin);
      if (lod === 0) b.tube([[sx * 0.222, 0.82, 0.05], [sx * 0.215, 0.79, 0.07], [sx * 0.214, 0.77, 0.075]], [[0.011, 0.011], [0.01, 0.01], [0.008, 0.008]], 5, rigid(fo), BPART.skin);
      if (o.webbed && lod === 0) b.card([sx * 0.25, 1.05, -0.02], [sx * 0.25, 0.88, -0.02], [sx * 0.29, 0.92, -0.06], [sx * 0.285, 1.04, -0.05], rigid(fo), BPART.horn);
    } else {
      b.box(hp, [0.02, 0.045, 0.03], fo, BPART.skin);
    }
    // sleeves by tier: short (tunic), long (coat, dyed tunic in cold folk)
    if (lod <= 1) {
      b.tube([[sh[0] - sx * 0.02, sh[1] + 0.03, sh[2]], [sh[0], sh[1] - 0.06, 0], lerp3(sh, el, 0.62)], [[0.066, 0.066], [0.061, 0.059], [0.055, 0.053]], seg(8), limbW(up, 1), BPART.cloth, { req: STYLE.tier1 | STYLE.tier2 }, false, true);
      b.tube([[sh[0] - sx * 0.02, sh[1] + 0.035, sh[2]], [sh[0], sh[1] - 0.06, 0], [el[0], el[1] + 0.02, el[2]]], [[0.07, 0.07], [0.064, 0.062], [0.052, 0.05]], seg(8), limbW(up, 1), BPART.coat, { req: STYLE.tier3 }, false, false);
      b.tube([[el[0], el[1] + 0.035, el[2]], wr], [[0.052, 0.05], [0.036, 0.033]], seg(8), limbW(fo, up), BPART.coat, { req: STYLE.tier3 }, false, true);
    }
  }
  // ── legs: thigh, shin, foot
  for (const [sx, th, sh] of [[1, 7, 8], [-1, 9, 10]] as [number, number, number][]) {
    const hip = P[th], kn = P[sh];
    const an: V3 = [sx * 0.1, 0.085, -0.005];
    // bare legs only where they show: hides (tier 0) and the short tunic (tier 1) without a dress — inside trousers or
    // a long dress the skin was left out (knees and shins poked through the cloth in stride)
    const legSels: VOpt[] = far ? [{}] : [{ req: STYLE.tier0 }, { req: STYLE.tier1, forbid: STYLE.dress }];
    const legB: [number, number, number][] = [[th, 0, 0.5], [th, th, 1], [sh, th, 0.5], [sh, sh, 1], [sh, sh, 1]];
    for (const sel of legSels) {
      b.tube([[hip[0], hip[1] + 0.03, hip[2]], lerp3(hip, kn, 0.5), [kn[0], kn[1] + 0.015, kn[2]], [sx * 0.1, 0.3, -0.012], an], [[0.085, 0.085], [0.07, 0.068], [0.054, 0.052], [0.046, 0.044], [0.032, 0.031]], seg(8), (t) => legB[Math.round(t * 4)], far ? BPART.cloth2 : BPART.skin, sel, true, false);
    }
    // under a long dress only the ankles show above the feet
    if (!far) b.tube([[sx * 0.1, 0.2, -0.01], an], [[0.04, 0.039], [0.032, 0.031]], seg(8), rigid(sh), BPART.skin, { req: STYLE.dress, forbid: STYLE.tier2 | STYLE.tier3 }, false, false);
    // foot (bare skin; boots over it for the later tiers)
    const fc: V3 = [sx * 0.1, 0.038, 0.05];
    if (lod <= 1) {
      b.ellipsoid(fc, [0.042, 0.04, 0.115], seg(8), seg(5), rigid(sh), BPART.skin, { forbid: STYLE.tier2 | STYLE.tier3 });
      b.ellipsoid([fc[0], fc[1] + 0.006, fc[2]], [0.048, 0.048, 0.122], seg(8), seg(5), rigid(sh), BPART.leather, { req: STYLE.tier2 | STYLE.tier3 });
      // (the boot leg starts mid-shin: it is the shin's alone — weighted like a tube starting at the knee, its top
      // swung half with the thigh, stretched and lit pale whenever the knee bent)
      b.tube([[sx * 0.1, 0.32, -0.012], an], [[0.052, 0.05], [0.046, 0.045]], seg(8), rigid(sh), BPART.leather, { req: STYLE.tier2 | STYLE.tier3 }, false, false);
      if (o.webbed && lod === 0) b.card([sx * 0.11, 0.4, -0.05], [sx * 0.11, 0.2, -0.06], [sx * 0.14, 0.26, -0.11], [sx * 0.14, 0.38, -0.1], rigid(sh), BPART.horn);
    } else {
      b.box(fc, [0.04, 0.035, 0.1], sh, BPART.leather);
    }
    // trousers (dyed / tailored tiers)
    if (lod <= 1) {
      b.tube([[hip[0], hip[1] + 0.04, hip[2]], lerp3(hip, kn, 0.5), [kn[0], kn[1] + 0.02, kn[2]]], [[0.096, 0.096], [0.08, 0.078], [0.064, 0.062]], seg(8), limbW(th, 0), BPART.cloth2, { req: STYLE.tier2 | STYLE.tier3, forbid: STYLE.dress }, false, false);
      b.tube([[kn[0], kn[1] + 0.03, kn[2]], [sx * 0.1, 0.33, -0.012]], [[0.063, 0.062], [0.055, 0.053]], seg(8), limbW(sh, th), BPART.cloth2, { req: STYLE.tier2 | STYLE.tier3, forbid: STYLE.dress }, false, true);
    }
  }
  // ── clothing shells over the torso
  if (lod <= 1) {
    const shell = (k: number, y0: number, y1: number) => {
      const pts: V3[] = [], rad: [number, number][] = [];
      for (const [y, rx, rz, z] of torsoProf) if (y >= y0 - 1e-6 && y <= y1 + 1e-6) { pts.push([0, y, z]); rad.push([rx * k + 0.008, rz * k + 0.008]); }
      return { pts, rad };
    };
    // (the tunic and coat shells reach down over the pelvis: started at the waist they left a band of bare skin
    // between them and the skirt or trousers whenever the body twisted)
    // (closed at the neckline and the crotch: with the skin of the belly left out, an open shell let the ground show
    // through at the shoulders and between the legs)
    const top = shell(1.08, 0.86, 1.45);
    b.tube(top.pts, top.rad, seg(12), torsoBone, BPART.cloth, { req: STYLE.tier1 | STYLE.tier2 | STYLE.dress }, true, true);
    const coatTop = shell(1.13, 0.86, 1.45);
    b.tube(coatTop.pts, coatTop.rad, seg(12), torsoBone, BPART.coat, { req: STYLE.tier3 }, true, true);
    // skirts: the hem follows the thighs a little so the legs do not cut through when walking. v runs waist → hem;
    // the surface is built hem → waist (w = 1 − v) so its quads wind outward — built waist-down every skirt, kilt,
    // coat tail and dress was inside out (culled from outside: legs and the bare seat showed through, only the far
    // side's lining was drawn). The section is the torso's flat oval at the waist, rounder toward the hem, so the top
    // tucks under the tunic or the belt instead of standing off the belly and the back.
    const skirt = (y0: number, y1: number, r0: number, r1: number, part: number, req: number, forbid: number, follow: number, v0 = 0, v1 = 1, dr = 0, rows = lod === 0 ? 4 : 2) => {
      const vOf = (w: number) => v1 - (v1 - v0) * w;
      b.surface(seg(14), rows, (u, w) => {
        const v = vOf(w), a = u * Math.PI * 2;
        const y = y0 + (y1 - y0) * v, r = r0 + (r1 - r0) * Math.pow(v, 0.8) + dr;
        const x = Math.sin(a) * r, z = Math.cos(a) * r * (0.7 + 0.18 * v);
        return [[x, y, z], [Math.sin(a), 0.15, Math.cos(a)]];
      }, (p, w) => { const v = vOf(w); const th = p[0] >= 0 ? 7 : 9; return [0, th, 1 - follow * v * v * Math.min(1, Math.abs(p[0]) / 0.12)]; }, part, { req, forbid }, undefined, (_p, w) => 1 - 0.25 * vOf(w));
    };
    // (they start at the hips, under the belt of the dyed tiers; the tunic or coat shell runs on beneath them)
    skirt(0.915, 0.55, 0.184, 0.245, BPART.cloth, STYLE.tier1, STYLE.dress, 0.45);
    skirt(0.915, 0.66, 0.184, 0.225, BPART.cloth, STYLE.tier2, STYLE.dress, 0.35);
    skirt(0.915, 0.5, 0.188, 0.26, BPART.coat, STYLE.tier3, STYLE.dress, 0.5);
    skirt(0.915, 0.12, 0.184, 0.33, BPART.cloth, STYLE.dress, 0, 0.6);
    // hide wrap and a fur cape (the first clothes: no tunic under the wrap, so it starts at the waist)
    skirt(0.99, 0.66, 0.172, 0.215, BPART.fur, STYLE.tier0, STYLE.dress, 0.4);
    furCape(b, lod);
    // trim, belt, neckline for the dyed tiers
    // the belt sits low on the hips, where the body is the pelvis alone (at the waist the torso bends between pelvis
    // and chest, and a ring rigid to the pelvis floated free of it)
    // (elliptical, following the hips over the clothes: a round hoop stood off the belly and the back)
    // (it covers the skirts' top edge: their waist ring is 0.184 × 0.129 at 0.915 m, tucked 1.5 cm under it)
    b.tube([[0, 0.9, 0], [0, 0.935, 0], [0, 0.97, 0]], [[0.196, 0.137], [0.201, 0.14], [0.202, 0.141]], seg(12), rigid(0), BPART.leather, { req: STYLE.tier2 | STYLE.tier3 }, false, false);
    // the dyed hem: a band of the skirt itself, weighted like it (a ring rigid to the pelvis floated off the hem as soon
    // as the skirt followed a stride, and its round section stood off the oval skirt front and back)
    skirt(0.915, 0.66, 0.184, 0.225, BPART.cloth2, STYLE.tier2, STYLE.dress, 0.35, 0.82, 1, 0.005, 1);
    if (lod === 0) {
      b.lathe(0, 0.0, [[0.13, 1.4], [0.105, 1.445]], 12, 1, BPART.cloth2, { req: STYLE.tier2 | STYLE.tier3 });
      // a satchel strap and buttons on coats
      for (let i = 0; i < 4; i++) b.box([0, 1.08 + i * 0.075, 0.142], [0.008, 0.008, 0.005], 1, BPART.metal, { req: STYLE.tier3 });
    }
  }
  if (lod <= 1) linenPieces(b, lod === 0 ? 3 : 2);
  // (far silhouette: the clothes are the body's own surface colour, see `far` above)
  // cold folk: a shaggy fur coat over everything (their own fur)
  if (o.furred && lod <= 1) {
    const fur = (pts: V3[], rad: [number, number][], bone: (t: number) => [number, number, number]) => b.tube(pts, rad.map(([x, z]) => [x * 1.12 + 0.012, z * 1.12 + 0.012]), seg(10), bone, BPART.fur, {}, false, false);
    fur(tPts.slice(0, -1), tRad.slice(0, -1), torsoBone);
  }
  // ── held tools and carried things (bone 6 = right forearm / hand; carried loads on the chest, shoulder, head, back)
  if (lod <= 1) tools(b, lod);
  return b.build(BIPED_RIG, 1.75);
}

/**
 * Light linen pieces over the clothes (the steam age's crowds read as black ants without them): a shirt front in an
 * open tailored coat (tier 3, STYLE.shirt) and an apron over a dress (STYLE.apron), on the chest / skirt surfaces.
 */
function linenPieces(b: RigBuilder, rows: number): void {
  // shirt front: a narrowing strip down the coat's chest (the coat shell's front, +4 mm), rigid with the chest
  const sy = [1.43, 1.39, 1.31, 1.2], sz = [0.104, 0.137, 0.164, 0.15], sw = [0.055, 0.062, 0.042, 0.012];
  const ids: number[][] = [];
  for (let j = 0; j < sy.length; j++) {
    const row: number[] = [];
    for (const u of [-1, 0, 1]) row.push(b.vert([u * sw[j], sy[j], sz[j] - Math.abs(u) * 0.012], [u * 0.25, 0.1, 1], 1, 1, 1, BPART.linen, { req: STYLE.shirt }));
    ids.push(row);
  }
  for (let j = 0; j < sy.length - 1; j++) for (let i = 0; i < 2; i++) { const a = ids[j][i], c = ids[j][i + 1], d = ids[j + 1][i], e = ids[j + 1][i + 1]; b.tri(a, d, e); b.tri(a, e, c); }
  // apron: over the dress's skirt from the waist to below the knee, across its front (+1 cm), following the thighs
  const y0 = 0.915, y1 = 0.12, r0 = 0.184, r1 = 0.33, vEnd = 0.68;
  const aIds: number[][] = [];
  for (let j = 0; j <= rows; j++) {
    const v = (j / rows) * vEnd, y = y0 + (y1 - y0) * v, r = r0 + (r1 - r0) * Math.pow(v, 0.8) + 0.012;
    const row: number[] = [];
    for (let i = 0; i <= 3; i++) {
      const a = -0.62 + (i / 3) * 1.24;
      const p: V3 = [Math.sin(a) * r, y, Math.cos(a) * r * (0.7 + 0.18 * v) + 0.006];
      const th = p[0] >= 0 ? 7 : 9;
      row.push(b.vert(p, [Math.sin(a), 0.15, Math.cos(a)], 0, th, 1 - 0.6 * v * v * Math.min(1, Math.abs(p[0]) / 0.12), BPART.linen, { req: STYLE.apron }));
    }
    aIds.push(row);
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < 3; i++) { const a = aIds[j][i], c = aIds[j][i + 1], d = aIds[j + 1][i], e = aIds[j + 1][i + 1]; b.tri(a, d, e); b.tri(a, e, c); }
}

/**
 * The crowd's mid (lod 2, ~160 triangles, 42–115 m) and far (lod 3, ~100, beyond) bipeds: one mesh for every
 * clothing tier, its garment, legwear, sleeves and hair coloured by the instance's style in the shader (BPART garment
 * …), with the silhouettes that read at a few dozen pixels — a head with its hair cap, a torso, a skirt or a coat's
 * tails (a long dress to the ankles), arms that swing on the same rig, legs, a hat; no hands, faces or tools.
 */
function bipedLow(lod: number, furred: boolean): BodyMesh {
  const b = new RigBuilder();
  const mid = lod === 2;
  // (the cold folk wear their own shaggy pelt over everything: a bulkier torso in fur)
  const fk = furred ? 1.12 : 1;
  // (four sides even at mid range: the mid LOD is ~160 triangles, the city view's crowd from 42 m)
  const ts = 4, ls = 3;
  const P = BIPED_RIG.pivots;
  // torso: hips → waist → chest → shoulders, the garment colour (hide, tunic or coat by tier)
  const prof: [number, number, number, number][] = mid
    ? [[0.86, 0.165, 0.11, 0.0], [1.12, 0.155, 0.1, 0.008], [1.32, 0.2, 0.125, 0.01], [1.46, 0.125, 0.085, -0.005]]
    : [[0.86, 0.165, 0.11, 0.0], [1.3, 0.2, 0.125, 0.01], [1.46, 0.125, 0.085, -0.005]];
  const ys = prof.map((q) => q[0]);
  const boneAtY = (y: number): [number, number, number] => [1, 0, Math.min(1, Math.max(0, (y - 0.98) / 0.16))];
  b.tube(prof.map(([y, , , z]) => [0, y, z] as V3), prof.map(([, rx, rz]) => [rx * fk, rz * fk] as [number, number]), ts,
    (t) => boneAtY(ys[Math.round(t * (ys.length - 1))]), furred ? BPART.fur : BPART.garment, {}, false, true);
  // head: the face (skin) and a cap of hair over the crown and the back of the skull (skin when bald)
  const hc: V3 = [0, 1.62, 0.008];
  const capKeep = (p: V3) => { const ly = p[1] - hc[1], lz = p[2] - hc[2]; return ly > 0.03 || (lz < -0.02 && ly > -0.07); };
  b.ellipsoid(hc, [0.09, 0.115, 0.1], mid ? 5 : 4, mid ? 3 : 2, rigid(2), BPART.skin, {}, (p) => !capKeep(p));
  b.ellipsoid(hc, [0.09, 0.115, 0.1], mid ? 5 : 4, mid ? 3 : 2, rigid(2), BPART.haircap, {}, capKeep);
  if (mid) {
    // long hair down the back, a hat or bonnet
    b.tube([[0, 1.66, -0.08], [0, 1.37, -0.105]], [[0.072, 0.04], [0.055, 0.028]], 3, (t) => (t < 0.4 ? [2, 2, 1] : [1, 2, 0.6]), BPART.hair, { req: STYLE.hairLong }, false, true, [1, 0, 0]);
    b.lathe(0, 0.005, [[0.125, 1.705], [0.001, 1.79]], 4, 2, BPART.cloth2, { req: STYLE.hat });
  }
  // skirts: a dress to the ankles, or the garment's skirt (hide wrap, tunic, coat tails) to the knee
  const skirt = (y0: number, y1: number, r0: number, r1: number, part: number, sel: VOpt, follow: number) => {
    b.surface(ts, 1, (u, w) => {
      const v = 1 - w, a = u * Math.PI * 2;
      const y = y0 + (y1 - y0) * v, r = r0 + (r1 - r0) * Math.pow(v, 0.8);
      return [[Math.sin(a) * r, y, Math.cos(a) * r * (0.7 + 0.18 * v)], [Math.sin(a), 0.15, Math.cos(a)]];
    }, (p, w) => { const v = 1 - w; const th = p[0] >= 0 ? 7 : 9; return [0, th, 1 - follow * v * v * Math.min(1, Math.abs(p[0]) / 0.12)]; }, part, sel);
  };
  skirt(0.93, 0.14, 0.18, 0.3, BPART.cloth, { req: STYLE.dress }, 0.6);
  skirt(0.93, 0.58, 0.18, 0.24, BPART.garment, { forbid: STYLE.dress }, 0.45);
  if (mid) linenPieces(b, 1);
  // arms: the sleeve (or bare arm) to the elbow, the forearm (skin, or a coat's sleeve) to the wrist; the elbow ring is
  // shared exactly (same place, same blend of the two bones) so the two pieces bend as one
  // (far, ~15 px tall: one tube each from shoulder to wrist and hip to ankle — the elbow and knee bends are below a
  // pixel there, and the city view's crowd is mostly this LOD)
  for (const [sx, up, fo] of [[1, 3, 4], [-1, 5, 6]] as [number, number, number][]) {
    const sh: V3 = [P[up][0] - sx * 0.015, P[up][1] + 0.015, 0], el: V3 = [P[fo][0], P[fo][1] + 0.02, P[fo][2]], wr: V3 = [sx * 0.23, 0.83, 0.015];
    if (!mid) { b.tube([sh, wr], [[0.058, 0.055], [0.034, 0.03]], ls, (t) => (t < 0.5 ? [up, 1, 0.55] : [fo, fo, 1]), BPART.sleeve, {}, false, true); continue; }
    b.tube([sh, el], [[0.058, 0.055], [0.044, 0.042]], ls, (t) => (t < 0.5 ? [up, 1, 0.55] : [fo, up, 0.5]), BPART.sleeve, {}, false, false);
    b.tube([el, wr], [[0.044, 0.042], [0.03, 0.027]], ls, (t) => (t < 0.5 ? [fo, up, 0.5] : [fo, fo, 1]), BPART.forearm, {}, false, true);
  }
  // legs: thigh and shin (bare, or trousers), a foot
  for (const [sx, th, sn] of [[1, 7, 8], [-1, 9, 10]] as [number, number, number][]) {
    const hip: V3 = [P[th][0], P[th][1] + 0.03, 0], kn: V3 = [P[sn][0], P[sn][1] + 0.02, P[sn][2]], an: V3 = [sx * 0.1, 0.07, -0.01];
    if (!mid) { b.tube([hip, an], [[0.088, 0.085], [0.04, 0.038]], ls, (t) => (t < 0.5 ? [th, 0, 0.55] : [sn, sn, 1]), BPART.legwear, {}, false, false); continue; }
    b.tube([hip, kn], [[0.088, 0.085], [0.058, 0.056]], ls, (t) => (t < 0.5 ? [th, 0, 0.55] : [sn, th, 0.5]), BPART.legwear, {}, false, false);
    b.tube([kn, an], [[0.058, 0.056], [0.038, 0.036]], ls, (t) => (t < 0.5 ? [sn, th, 0.5] : [sn, sn, 1]), BPART.legwear, {}, false, false);
  }
  return b.build(BIPED_RIG, 1.75);
}

/**
 * The first people's fur cape: a pelt draped over the shoulders and the shoulder caps (an elliptical shell following
 * the chest and back, not a turned cone), with its thickness, a ragged hem of uneven length and a fringe of fur tufts.
 */
function furCape(b: RigBuilder, lod: number): void {
  const o: VOpt = { req: STYLE.tier0 };
  const nu = lod === 0 ? 16 : 9;
  // rows from the collar down: [y, half-width across (x), half-depth (z), z centre]
  const rows: [number, number, number, number][] = [[1.495, 0.075, 0.065, 0.0], [1.455, 0.16, 0.1, -0.005], [1.41, 0.262, 0.145, -0.008], [1.34, 0.282, 0.162, -0.006], [1.255, 0.285, 0.172, 0.0]];
  // (a ragged hem, always below the last row: shorter at the chest, longer down the back)
  const hemY = (a: number) => Math.min(1.235, 1.17 + 0.035 * Math.sin(a * 3 + 1.3) + 0.022 * Math.sin(a * 7 + 0.4) + 0.035 * Math.max(0, Math.cos(a)));
  const P = (j: number, a: number, inset: number): V3 => {
    const ca = Math.sin(a), sa = Math.cos(a);
    if (j < rows.length) {
      const [y, rx, rz, zc] = rows[j];
      return [ca * (rx - inset), y, zc + sa * (rz - inset)];
    }
    const [, rx, rz, zc] = rows[rows.length - 1];
    return [ca * (rx + 0.01 - inset), hemY(a), zc + sa * (rz + 0.008 - inset)];
  };
  const nv = rows.length + 1;
  const outer: number[][] = [], inner: number[][] = [];
  for (let j = 0; j < nv; j++) {
    const ro: number[] = [], ri: number[] = [];
    for (let i = 0; i <= nu; i++) {
      const a = (i / nu) * Math.PI * 2;
      const p = P(j, a, 0), q = P(j, a, 0.018);
      const n: V3 = [Math.sin(a), j < 2 ? 0.8 : 0.25, Math.cos(a)];
      ro.push(b.vert(p, n, 1, 1, 1, BPART.fur, o));
      ri.push(b.vert(q, [-n[0], -n[1], -n[2]], 1, 1, 1, BPART.fur, { ...o, ao: 0.55 }));
    }
    outer.push(ro); inner.push(ri);
  }
  for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu; i++) {
    const a = outer[j][i], c = outer[j][i + 1], d = outer[j + 1][i], e = outer[j + 1][i + 1];
    b.tri(a, d, e); b.tri(a, e, c);
    const a2 = inner[j][i], c2 = inner[j][i + 1], d2 = inner[j + 1][i], e2 = inner[j + 1][i + 1];
    b.tri(a2, e2, d2); b.tri(a2, c2, e2);
  }
  // the hem's edge (its thickness) and a fringe of fur tufts hanging from it
  const last = nv - 1;
  for (let i = 0; i < nu; i++) {
    const a0 = (i / nu) * Math.PI * 2, a1 = ((i + 1) / nu) * Math.PI * 2;
    const dn: V3 = [0, -1, 0];
    const a = b.vert(P(last, a0, 0), dn, 1, 1, 1, BPART.fur, o), c = b.vert(P(last, a1, 0), dn, 1, 1, 1, BPART.fur, o);
    const d = b.vert(P(last, a0, 0.018), dn, 1, 1, 1, BPART.fur, o), e = b.vert(P(last, a1, 0.018), dn, 1, 1, 1, BPART.fur, o);
    b.tri(a, d, e); b.tri(a, e, c);
  }
  if (lod === 0) for (let i = 0; i < nu * 2; i++) {
    const a = ((i + 0.5) / (nu * 2)) * Math.PI * 2;
    const p = P(last, a, 0.004), l = 0.035 + 0.03 * Math.abs(Math.sin(i * 2.7));
    const tx = Math.cos(a) * 0.022, tz = -Math.sin(a) * 0.022;
    b.card([p[0] - tx, p[1] + 0.005, p[2] - tz], [p[0] + tx, p[1] + 0.005, p[2] + tz], [p[0] + tx * 0.2 + Math.sin(a) * 0.012, p[1] - l, p[2] + tz * 0.2 + Math.cos(a) * 0.012], [p[0] - tx * 0.2 + Math.sin(a) * 0.012, p[1] - l, p[2] - tz * 0.2 + Math.cos(a) * 0.012], () => [1, 1, 1], BPART.fur, o);
  }
}

/** tools in the right hand (they hang along the forearm at rest: raised arms raise them) and carried loads */
function tools(b: RigBuilder, lod: number): void {
  const G: V3 = [-0.236, 0.785, 0.03];
  const sides = lod === 0 ? 6 : 4;
  const handle = (tool: number, len: number, up: boolean, r = 0.016) => {
    const a: V3 = up ? [G[0], G[1] - 0.6, G[2]] : [G[0], G[1] + 0.09, G[2]];
    const e: V3 = up ? [G[0], G[1] + len - 0.6, G[2]] : [G[0], G[1] - len + 0.09, G[2]];
    b.tube([a, e], [[r, r], [r * 0.9, r * 0.9]], sides, rigid(6), BPART.wood, { tool });
    return e;
  };
  // (the mid LOD keeps only what reads at 30-95 m: long hafts, loads, the torch's flame)
  const near = lod === 0;
  // axe: a handle down along the arm, the head at its end
  if (near) { const e = handle(HELD.axe, 0.62, false); b.box([e[0], e[1] + 0.07, e[2] + 0.05], [0.012, 0.06, 0.07], 6, BPART.metal, { tool: HELD.axe }); }
  // hoe: a long handle held near its middle, the blade turned forward just off the ground
  { const a: V3 = [G[0], G[1] + 0.5, G[2]], e: V3 = [G[0], G[1] - 0.6, G[2]]; b.tube([a, e], [[0.015, 0.015], [0.014, 0.014]], sides, rigid(6), BPART.wood, { tool: HELD.hoe }); b.box([e[0], e[1] + 0.02, e[2] + 0.1], [0.06, 0.012, 0.1], 6, BPART.metal, { tool: HELD.hoe }); }
  // spear and staff: upright
  { const e = handle(HELD.spear, 1.95, true, 0.014); b.tube([e, [e[0], e[1] + 0.22, e[2]]], [[0.025, 0.012], [0.001, 0.001]], sides, rigid(6), BPART.stone, { tool: HELD.spear }); }
  handle(HELD.staff, 1.75, true, 0.02);
  // hammer
  if (near) { const e = handle(HELD.hammer, 0.4, false); b.box([e[0], e[1] + 0.03, e[2]], [0.03, 0.035, 0.07], 6, BPART.metal, { tool: HELD.hammer }); }
  // torch with a flame
  { const e = handle(HELD.torch, 0.65, true, 0.02); b.lathe(e[0], e[2], [[0.04, e[1] - 0.02], [0.06, e[1] + 0.08], [0.02, e[1] + 0.22], [0.001, e[1] + 0.3]], 6, 6, BPART.flame, { tool: HELD.torch }); }
  // fishing rod: up and forward
  b.tube([[G[0], G[1] - 0.1, G[2] - 0.05], [G[0], G[1] + 0.6, G[2] + 0.5], [G[0], G[1] + 1.4, G[2] + 1.3]], [[0.014, 0.014], [0.009, 0.009], [0.004, 0.004]], 4, rigid(6), BPART.wood, { tool: HELD.rod });
  // sword
  if (near) { b.box([G[0], G[1] + 0.05, G[2]], [0.014, 0.05, 0.014], 6, BPART.leather, { tool: HELD.sword }); b.box([G[0], G[1] - 0.38, G[2]], [0.006, 0.38, 0.024], 6, BPART.metal, { tool: HELD.sword }); b.box([G[0], G[1] - 0.005, G[2]], [0.012, 0.012, 0.07], 6, BPART.metal, { tool: HELD.sword }); }
  // sickle: a short handle and a curved blade
  if (near) { const e = handle(HELD.sickle, 0.16, false, 0.018); b.tube([e, [e[0], e[1] - 0.12, e[2] + 0.1], [e[0], e[1] - 0.06, e[2] + 0.24], [e[0], e[1] + 0.06, e[2] + 0.25]], [[0.008, 0.004], [0.008, 0.004], [0.007, 0.003], [0.003, 0.002]], 4, rigid(6), BPART.metal, { tool: HELD.sickle }); }
  // pick
  if (near) { const e = handle(HELD.pick, 0.7, false); b.tube([[e[0], e[1], e[2] - 0.25], [e[0], e[1] + 0.04, e[2]], [e[0], e[1], e[2] + 0.25]], [[0.006, 0.006], [0.02, 0.02], [0.006, 0.006]], 5, rigid(6), BPART.metal, { tool: HELD.pick }); }
  // rifle / musket: upright at the side
  { b.box([G[0], G[1] + 0.25, G[2] + 0.01], [0.02, 0.42, 0.03], 6, BPART.wood, { tool: HELD.rifle }); b.box([G[0], G[1] + 0.82, G[2] + 0.01], [0.009, 0.25, 0.009], 6, BPART.metal, { tool: HELD.rifle }); }
  // a scroll / book in the hand
  if (near) b.box([G[0] + 0.01, G[1] - 0.02, G[2] + 0.05], [0.02, 0.08, 0.06], 6, BPART.cloth2, { tool: HELD.scroll });
  // loads: a basket held in front, logs on the right shoulder, a pot on the head, a bundle on the back, a stone
  b.lathe(0, 0.27, [[0.12, 0.92], [0.17, 0.96], [0.2, 1.08], [0.205, 1.12], [0.19, 1.13], [0.17, 1.02]], lod === 0 ? 10 : 6, 1, BPART.straw, { tool: HELD.basket });
  for (const [x, y] of [[-0.12, 1.5], [-0.2, 1.52], [-0.16, 1.58]] as [number, number][]) b.tube([[x, y, -0.55], [x, y, 0.6]], [[0.052, 0.052], [0.048, 0.048]], sides, rigid(1), BPART.wood, { tool: HELD.logs });
  b.lathe(0, 0.005, [[0.06, 1.745], [0.12, 1.79], [0.135, 1.86], [0.09, 1.935], [0.07, 1.97], [0.08, 1.99]], lod === 0 ? 10 : 6, 2, BPART.clay, { tool: HELD.pot });
  b.ellipsoid([0, 1.2, -0.22], [0.17, 0.2, 0.12], lod === 0 ? 8 : 5, lod === 0 ? 6 : 4, rigid(1), BPART.cloth2, { tool: HELD.bundle });
  if (near) b.ellipsoid([0, 1.13, 0.23], [0.13, 0.11, 0.1], 7, 5, rigid(1), BPART.stone, { tool: HELD.stone });
}

// ───────────────────────────── hive hexapod ─────────────────────────────

/** bones: 0 thorax, 1 abdomen, 2 head, 3/4 arm L, 5/6 arm R, 7 leg FL, 8 leg FR, 9 leg BL, 10 leg BR, 11 antennae */
export const HEX_RIG: Rig = {
  plan: PLAN.hex,
  pivots: [[0, 0.75, 0], [0, 0.66, -0.12], [0, 1.0, 0.06], [0.13, 0.93, 0.05], [0.2, 0.73, 0.1], [-0.13, 0.93, 0.05], [-0.2, 0.73, 0.1], [0.11, 0.62, 0.09], [-0.11, 0.62, 0.09], [0.11, 0.6, -0.06], [-0.11, 0.6, -0.06], [0, 1.1, 0.12]],
  parents: [-1, 0, 0, 0, 3, 0, 5, 0, 0, 0, 0, 2],
};

export function hexMesh(lod: number): BodyMesh {
  const b = new RigBuilder();
  const S = lod === 0 ? 1 : lod === 1 ? 0.55 : 0.3;
  const seg = (n: number) => Math.max(3, Math.round(n * S));
  // thorax (carapace), abdomen, head
  b.ellipsoid([0, 0.8, 0.0], [0.15, 0.22, 0.13], seg(12), seg(10), rigid(0), BPART.shell);
  b.ellipsoid([0, 0.62, -0.36], [0.19, 0.17, 0.3], seg(12), seg(9), rigid(1), BPART.shell, {}, undefined, (p) => [p[0], p[1] + 0.06 * Math.max(0, -(p[2] + 0.36)) , p[2]]);
  b.tube([[0, 0.62, -0.1], [0, 0.64, -0.14]], [[0.08, 0.06], [0.1, 0.08]], seg(8), (t) => [1, 0, 0.5 + 0.5 * t], BPART.dark, {}, false, false);
  b.ellipsoid([0, 1.1, 0.08], [0.11, 0.1, 0.12], seg(12), seg(9), rigid(2), BPART.shell);
  if (lod <= 1) {
    for (const sx of [1, -1]) {
      b.ellipsoid([sx * 0.075, 1.12, 0.15], [0.04, 0.05, 0.04], seg(8), seg(6), rigid(2), BPART.dark);
      // mandibles
      b.tube([[sx * 0.04, 1.04, 0.17], [sx * 0.05, 1.0, 0.22], [sx * 0.015, 0.99, 0.25]], [[0.018, 0.014], [0.013, 0.01], [0.004, 0.004]], 5, rigid(2), BPART.horn);
      // antennae
      b.tube([[sx * 0.03, 1.18, 0.14], [sx * 0.08, 1.33, 0.22], [sx * 0.16, 1.42, 0.3]], [[0.008, 0.008], [0.006, 0.006], [0.004, 0.004]], 4, rigid(11), BPART.dark);
    }
  }
  // arms
  for (const [sx, up, fo] of [[1, 3, 4], [-1, 5, 6]] as [number, number, number][]) {
    const P = HEX_RIG.pivots;
    b.tube([P[up], P[fo]], [[0.035, 0.035], [0.028, 0.028]], seg(6), limbW(up, 0), BPART.shell);
    b.tube([P[fo], [sx * 0.21, 0.55, 0.2], [sx * 0.2, 0.5, 0.24]], [[0.026, 0.026], [0.02, 0.02], [0.006, 0.006]], seg(6), limbW(fo, up), BPART.shell);
  }
  // four walking legs: out and up, then down to the ground
  for (const [sx, bone, z] of [[1, 7, 0.09], [-1, 8, 0.09], [1, 9, -0.06], [-1, 10, -0.06]] as [number, number, number][]) {
    const fz = z > 0 ? 0.25 : -0.3;
    b.tube([[sx * 0.1, 0.62, z], [sx * 0.3, 0.74, z + fz * 0.5], [sx * 0.42, 0.0, z + fz]], [[0.032, 0.032], [0.026, 0.026], [0.012, 0.012]], seg(6), rigid(bone), BPART.shell);
  }
  return b.build(HEX_RIG, 1.3);
}

// ───────────────────────────── drifter (floating bell) ─────────────────────────────

export const JELLY_RIG: Rig = {
  plan: PLAN.jelly,
  pivots: [[0, 1.4, 0], ...Array.from({ length: 8 }, (_, k): V3 => { const a = (k / 8) * Math.PI * 2; return [Math.sin(a) * 0.4, 1.32, Math.cos(a) * 0.4]; })],
  parents: [-1, 0, 0, 0, 0, 0, 0, 0, 0],
};

export function jellyMesh(lod: number): BodyMesh {
  const b = new RigBuilder();
  const S = lod === 0 ? 1 : lod === 1 ? 0.55 : 0.3;
  const seg = (n: number) => Math.max(4, Math.round(n * S));
  b.lathe(0, 0, [[0.5, 1.3], [0.58, 1.5], [0.55, 1.75], [0.42, 1.98], [0.22, 2.12], [0.01, 2.17]], seg(18), 0, BPART.skin);
  b.lathe(0, 0, [[0.01, 1.42], [0.3, 1.45], [0.48, 1.33]], seg(18), 0, BPART.cloth);
  if (lod <= 1) b.ellipsoid([0, 1.72, 0], [0.18, 0.2, 0.18], seg(10), seg(8), rigid(0), BPART.glow);
  for (let k = 0; k < 8; k++) {
    const p = JELLY_RIG.pivots[k + 1];
    const pts: V3[] = [];
    for (let i = 0; i <= 4; i++) pts.push([p[0] * (1 - i * 0.08), p[1] - i * 0.32, p[2] * (1 - i * 0.08)]);
    b.tube(pts, pts.map((_, i) => [0.03 - i * 0.005, 0.03 - i * 0.005] as [number, number]), lod === 0 ? 5 : 3, rigid(k + 1), BPART.cloth, {}, false, true);
  }
  return b.build(JELLY_RIG, 2.2);
}

// ───────────────────────────── quadrupeds ─────────────────────────────

/** bones: 0 body, 1 neck, 2 head, 3 tail, 4/5 front-left upper/lower, 6/7 front-right, 8/9 back-left, 10/11 back-right */
interface QuadSpec {
  len: number; depth: number; width: number; legR: number; neckLen: number; neckAng: number; headLen: number; headR: number;
  tail: number; tailR: number; ears: number; earUp: number; horns: 'none' | 'antlers' | 'curl' | 'up' | 'short' | 'tusks'; mane: boolean; wool: boolean;
  hump: number; snout: number; legLen: number; sprawl: number; hairyTail: boolean;
  /** the back's dip behind the withers (× depth), how far the hip bones stand out, hooves (else paws) */
  dip: number; hips: number; hoof: boolean;
}

const QUADS: Record<string, QuadSpec> = {
  deer: { len: 1.15, depth: 0.42, width: 0.3, legR: 0.04, neckLen: 0.5, neckAng: 0.95, headLen: 0.3, headR: 0.09, tail: 0.12, tailR: 0.03, ears: 0.12, earUp: 0.6, horns: 'antlers', mane: false, wool: false, hump: 0, snout: 0.6, legLen: 1, sprawl: 0, hairyTail: false, dip: 0.03, hips: 0.03, hoof: true },
  horse: { len: 1.4, depth: 0.52, width: 0.38, legR: 0.055, neckLen: 0.7, neckAng: 0.8, headLen: 0.52, headR: 0.11, tail: 0.75, tailR: 0.05, ears: 0.1, earUp: 0.9, horns: 'none', mane: true, wool: false, hump: 0, snout: 0.7, legLen: 1, sprawl: 0, hairyTail: true, dip: 0.05, hips: 0.04, hoof: true },
  cattle: { len: 1.45, depth: 0.66, width: 0.5, legR: 0.065, neckLen: 0.32, neckAng: 0.3, headLen: 0.36, headR: 0.13, tail: 0.75, tailR: 0.025, ears: 0.1, earUp: 0.1, horns: 'short', mane: false, wool: false, hump: 0.06, snout: 0.15, legLen: 0.88, sprawl: 0, hairyTail: false, dip: 0.07, hips: 0.09, hoof: true },
  bison: { len: 1.5, depth: 0.78, width: 0.58, legR: 0.07, neckLen: 0.3, neckAng: -0.1, headLen: 0.42, headR: 0.17, tail: 0.4, tailR: 0.03, ears: 0.07, earUp: 0.1, horns: 'short', mane: true, wool: false, hump: 0.28, snout: 0.35, legLen: 0.75, sprawl: 0, hairyTail: false, dip: 0.03, hips: 0.05, hoof: true },
  bear: { len: 1.35, depth: 0.7, width: 0.58, legR: 0.1, neckLen: 0.25, neckAng: 0.2, headLen: 0.36, headR: 0.16, tail: 0.08, tailR: 0.05, ears: 0.06, earUp: 0.8, horns: 'none', mane: false, wool: false, hump: 0.1, snout: 0.5, legLen: 0.8, sprawl: 0, hairyTail: false, dip: 0.0, hips: 0.02, hoof: false },
  wolf: { len: 1.05, depth: 0.38, width: 0.26, legR: 0.04, neckLen: 0.32, neckAng: 0.55, headLen: 0.34, headR: 0.09, tail: 0.5, tailR: 0.06, ears: 0.1, earUp: 1, horns: 'none', mane: false, wool: false, hump: 0, snout: 0.8, legLen: 1, sprawl: 0, hairyTail: true, dip: 0.02, hips: 0.02, hoof: false },
  boar: { len: 1.15, depth: 0.62, width: 0.42, legR: 0.05, neckLen: 0.16, neckAng: 0.1, headLen: 0.45, headR: 0.14, tail: 0.18, tailR: 0.015, ears: 0.09, earUp: 0.6, horns: 'tusks', mane: true, wool: false, hump: 0.08, snout: 0.9, legLen: 0.62, sprawl: 0, hairyTail: false, dip: 0.02, hips: 0.03, hoof: true },
  goat: { len: 1.0, depth: 0.46, width: 0.3, legR: 0.042, neckLen: 0.4, neckAng: 0.9, headLen: 0.3, headR: 0.09, tail: 0.1, tailR: 0.025, ears: 0.1, earUp: 0.2, horns: 'curl', mane: false, wool: false, hump: 0, snout: 0.6, legLen: 0.95, sprawl: 0, hairyTail: false, dip: 0.04, hips: 0.05, hoof: true },
  sheep: { len: 1.05, depth: 0.6, width: 0.48, legR: 0.035, neckLen: 0.28, neckAng: 0.5, headLen: 0.28, headR: 0.08, tail: 0.12, tailR: 0.04, ears: 0.09, earUp: 0.0, horns: 'none', mane: false, wool: true, hump: 0, snout: 0.5, legLen: 0.78, sprawl: 0, hairyTail: false, dip: 0.02, hips: 0.03, hoof: true },
  hare: { len: 1.3, depth: 0.55, width: 0.4, legR: 0.05, neckLen: 0.15, neckAng: 0.7, headLen: 0.38, headR: 0.17, tail: 0.1, tailR: 0.09, ears: 0.55, earUp: 1.2, horns: 'none', mane: false, wool: false, hump: 0.1, snout: 0.4, legLen: 0.6, sprawl: 0, hairyTail: true, dip: 0.0, hips: 0.0, hoof: false },
  lizard: { len: 2.2, depth: 0.42, width: 0.5, legR: 0.07, neckLen: 0.25, neckAng: 0.1, headLen: 0.45, headR: 0.16, tail: 1.8, tailR: 0.13, ears: 0, earUp: 0, horns: 'none', mane: false, wool: false, hump: 0, snout: 0.6, legLen: 0.6, sprawl: 0.6, hairyTail: false, dip: 0.0, hips: 0.0, hoof: false },
};

export function quadSpecFor(form: AnimalForm): QuadSpec {
  switch (form) {
    case 'deer': case 'horse': case 'cattle': case 'bison': case 'bear': case 'wolf': case 'boar': case 'goat': case 'sheep': case 'hare': case 'lizard': return QUADS[form];
    default: return QUADS.deer;
  }
}

export function quadRig(q: QuadSpec): Rig {
  const L = q.len, sh = 1.0;
  const bodyY = sh - q.depth * 0.3;
  const front = L * 0.38, back = -L * 0.4;
  const hipY = bodyY - q.depth * 0.15;
  const legTop = hipY;
  const knee = legTop * 0.5;
  const neckBase: V3 = [0, bodyY + q.depth * 0.25 + q.hump * 0.4, front + 0.05];
  const nd: V3 = [0, Math.sin(q.neckAng), Math.cos(q.neckAng)];
  const head: V3 = [0, neckBase[1] + nd[1] * q.neckLen, neckBase[2] + nd[2] * q.neckLen];
  const sw = q.width * 0.38 + q.sprawl * 0.25;
  return {
    plan: PLAN.quad,
    pivots: [[0, bodyY, 0], neckBase, head, [0, bodyY + q.depth * 0.2, back - 0.05],
      [sw, legTop, front], [sw * (1 + q.sprawl), knee, front + 0.02], [-sw, legTop, front], [-sw * (1 + q.sprawl), knee, front + 0.02],
      [sw, legTop, back + 0.06], [sw * (1 + q.sprawl), knee, back], [-sw, legTop, back + 0.06], [-sw * (1 + q.sprawl), knee, back]],
    parents: [-1, 0, 1, 0, 0, 4, 0, 6, 0, 8, 0, 10],
  };
}

export function quadMesh(form: AnimalForm, lod: number): BodyMesh {
  const q = quadSpecFor(form);
  const rig = quadRig(q);
  const P = rig.pivots;
  const b = new RigBuilder();
  const S = lod === 0 ? 1 : lod === 1 ? 0.55 : 0.32;
  const seg = (n: number) => Math.max(3, Math.round(n * S));
  const L = q.len;
  const bodyY = P[0][1];
  // body: an elongated, deep-chested barrel along Z; the belly is its own colour (part belly below the flank)
  const bodyPts: V3[] = [], bodyRad: [number, number][] = [];
  // [t along the body (rump −0.5 … chest +0.5), width k, depth k, centre drop (× depth)]: a rounded rump, the hip mass,
  // a waist tucked up under the loins, a deep barrel chest and the shoulder mass (not a table top on posts)
  const prof: [number, number, number, number][] = [
    [-0.53, 0.42, 0.5, 0.02], [-0.45, 0.84, 0.86, 0.0], [-0.3, 0.98, 0.95, 0.0], [-0.1, 0.84, 0.82, -0.06],
    [0.12, 1.02, 1.08, 0.06], [0.32, 1.07, 1.08, 0.04], [0.46, 0.86, 0.9, 0.0], [0.54, 0.5, 0.62, -0.02],
  ];
  // (full detail: twice the rings, interpolated, so the back line, the hips and the barrel read as curves, not a box)
  let pr = lod === 2 ? [prof[0], prof[2], prof[3], prof[4], prof[6], prof[7]] : lod === 1 ? [prof[0], prof[1], prof[2], prof[3], prof[4], prof[5], prof[7]] : prof;
  if (lod === 0) {
    const fine: [number, number, number, number][] = [];
    for (let i = 0; i < pr.length; i++) {
      fine.push(pr[i]);
      if (i + 1 < pr.length) fine.push(pr[i].map((v, k) => (v + pr[i + 1][k]) / 2) as [number, number, number, number]);
    }
    pr = fine;
  }
  for (const [t, kx, ky, drop] of pr) {
    const hump = q.hump * Math.max(0, 1 - Math.abs(t - 0.32) / 0.3);
    bodyPts.push([0, bodyY + hump * 0.5 - drop * q.depth * 0.5, t * L]);
    bodyRad.push([q.width * 0.5 * kx, (q.depth * 0.5 + hump * 0.4) * ky]);
  }
  const bodyPart = q.wool ? BPART.fur : BPART.coat;
  const v0 = b.pos.length / 3;
  b.tube(bodyPts, bodyRad, seg(16), rigid(0), bodyPart, {}, true, true, [1, 0, 0]);
  {
    // the back dips behind the withers, the hip bones stand out at the top of the rump, and the belly is the coat's
    // own countershade blended in softly (the part code carries the blend: 13 + 0.4 w — a separate belly shell drew
    // a hard, sticker-like edge where it met the flank)
    const dip = q.dip * q.depth, hips = q.hips;
    const at = (z: number): [number, number] => {
      const t = z / L;
      let i = 0;
      while (i < pr.length - 2 && pr[i + 1][0] < t) i++;
      const u = Math.max(0, Math.min(1, (t - pr[i][0]) / Math.max(1e-6, pr[i + 1][0] - pr[i][0])));
      return [bodyPts[i][1] + (bodyPts[i + 1][1] - bodyPts[i][1]) * u, bodyRad[i][1] + (bodyRad[i + 1][1] - bodyRad[i][1]) * u];
    };
    for (let v = v0; v < b.pos.length / 3; v++) {
      const x = b.pos[v * 3], z = b.pos[v * 3 + 2];
      let y = b.pos[v * 3 + 1];
      const [cy, ry] = at(z);
      const t = z / L, up = Math.max(0, (y - cy) / Math.max(1e-3, ry));
      y -= dip * Math.exp(-Math.pow((t + 0.06) / 0.2, 2)) * up * up;
      const hb = Math.exp(-Math.pow((t + 0.36) / 0.08, 2)) * Math.exp(-Math.pow((up - 0.72) / 0.25, 2));
      b.pos[v * 3] = x * (1 + hips * hb);
      b.pos[v * 3 + 1] = y + hips * hb * ry * 0.35;
      if (!q.wool) {
        const below = (cy - y) / Math.max(1e-3, ry);
        const w = Math.min(1, Math.max(0, (below - 0.15) / 0.5));
        b.rig[v * 4 + 3] = BPART.coat + 0.4 * w * w * (3 - 2 * w);
      }
    }
  }
  // neck (thick at its base, into the shoulders) and head (a little larger than the old toy heads)
  const nb = P[1], hd = P[2];
  const hR = q.headR * 1.17;
  // (deep through the throat and broad where it meets the shoulders: a thin neck read as a stick)
  b.tube([[nb[0], nb[1] - q.depth * 0.22, nb[2] - 0.12], nb, lerp3(nb, hd, 0.55), hd], [[q.width * 0.44, q.depth * 0.56], [q.width * 0.34, q.depth * 0.42], [q.width * 0.27, q.depth * 0.3], [hR * 0.95, hR * 1.1]], seg(8), (t) => (t < 0.5 ? [1, 0, 0.5 + t] : [1, 1, 1]), bodyPart === BPART.fur ? BPART.coat : bodyPart, {}, false, false, [1, 0, 0]);
  const headDir: V3 = [0, -Math.sin(0.5 - q.neckAng * 0.3), Math.cos(0.5 - q.neckAng * 0.3)];
  const snoutEnd: V3 = [0, hd[1] + headDir[1] * q.headLen, hd[2] + headDir[2] * q.headLen];
  b.tube([[hd[0], hd[1] + hR * 0.1, hd[2] - hR * 0.4], hd, lerp3(hd, snoutEnd, 0.6), snoutEnd], [[hR * 0.9, hR], [hR, hR * 1.05], [hR * (0.5 + 0.3 * (1 - q.snout)), hR * 0.7], [hR * (0.35 + 0.2 * (1 - q.snout)), hR * 0.45]], seg(8), rigid(2), BPART.coat, {}, true, true, [1, 0, 0]);
  // (far — a few pixels — the head is the jaw and the taper alone: the nose, muzzle and hooves below were most of
  // the far LOD's triangles)
  if (lod <= 1) b.ellipsoid(snoutEnd, [hR * 0.32, hR * 0.3, hR * 0.2], seg(6), seg(4), rigid(2), BPART.dark);
  // the jaw: a broad cheek and jowl behind the mouth (a straight taper read as a cone), and a fuller muzzle
  b.ellipsoid([0, hd[1] - hR * 0.35, hd[2] + q.headLen * 0.12], [hR * 0.95, hR * 0.75, hR * 1.05], seg(8), seg(6), rigid(2), BPART.coat);
  if (lod <= 1) b.ellipsoid(lerp3(hd, snoutEnd, 0.86), [hR * (0.42 + 0.25 * (1 - q.snout)), hR * 0.5, hR * 0.42], seg(7), seg(5), rigid(2), BPART.coat);
  if (lod <= 1) {
    for (const sx of [1, -1]) {
      // (eyes from the nearest LOD only: at 45 m and beyond they are under a pixel)
      if (lod === 0) b.ellipsoid([sx * hR * 0.7, hd[1] + hR * 0.35, hd[2] + q.headLen * 0.12], [hR * 0.14, hR * 0.14, hR * 0.14], 6, 4, rigid(2), BPART.dark);
      if (q.ears > 0) b.card([sx * hR * 0.6, hd[1] + hR * 0.7, hd[2] - hR * 0.2], [sx * hR * 0.6, hd[1] + hR * 0.7, hd[2] + hR * 0.15], [sx * (hR * 0.6 + q.ears * Math.cos(q.earUp)), hd[1] + hR * 0.7 + q.ears * Math.sin(q.earUp), hd[2]], [sx * (hR * 0.6 + q.ears * Math.cos(q.earUp)), hd[1] + hR * 0.7 + q.ears * Math.sin(q.earUp), hd[2] - hR * 0.15], rigid(2), BPART.coat);
      // horns / antlers / tusks
      const base: V3 = [sx * hR * 0.45, hd[1] + hR * 0.8, hd[2] - hR * 0.05];
      if (q.horns === 'antlers') {
        const tip: V3 = [sx * 0.32, base[1] + 0.42, base[2] - 0.1];
        b.tube([base, [sx * 0.14, base[1] + 0.2, base[2]], tip], [[0.02, 0.02], [0.015, 0.015], [0.006, 0.006]], 4, rigid(2), BPART.horn, { req: 1 });
        b.tube([[sx * 0.14, base[1] + 0.2, base[2]], [sx * 0.2, base[1] + 0.34, base[2] + 0.14]], [[0.012, 0.012], [0.004, 0.004]], 4, rigid(2), BPART.horn, { req: 1 });
        b.tube([[sx * 0.24, base[1] + 0.32, base[2] - 0.05], [sx * 0.3, base[1] + 0.48, base[2] + 0.06]], [[0.01, 0.01], [0.004, 0.004]], 4, rigid(2), BPART.horn, { req: 1 });
      } else if (q.horns === 'curl') {
        b.tube([base, [sx * 0.1, base[1] + 0.12, base[2] - 0.12], [sx * 0.14, base[1] + 0.02, base[2] - 0.24], [sx * 0.12, base[1] - 0.08, base[2] - 0.18]], [[0.03, 0.03], [0.025, 0.025], [0.016, 0.016], [0.008, 0.008]], 5, rigid(2), BPART.horn);
      } else if (q.horns === 'short') {
        b.tube([base, [sx * hR * 1.1, base[1] + 0.03, base[2]], [sx * hR * 1.3, base[1] + 0.12, base[2] + 0.02]], [[0.03, 0.03], [0.02, 0.02], [0.005, 0.005]], 5, rigid(2), BPART.horn);
      } else if (q.horns === 'tusks') {
        const m: V3 = [sx * hR * 0.4, hd[1] - hR * 0.25, hd[2] + q.headLen * 0.75];
        b.tube([m, [m[0] + sx * 0.03, m[1] + 0.06, m[2] + 0.05]], [[0.012, 0.012], [0.003, 0.003]], 4, rigid(2), BPART.horn);
      }
    }
    if (q.mane) b.tube([[0, nb[1] + q.depth * 0.12, nb[2] - 0.1], [0, (nb[1] + hd[1]) / 2 + 0.08, (nb[2] + hd[2]) / 2], [0, hd[1] + hR * 0.6, hd[2] - hR * 0.4]], [[0.03, 0.06], [0.025, 0.07], [0.02, 0.04]], 5, (t) => [1, 0, 0.5 + 0.5 * t], BPART.hair);
  }
  // tail
  const tb = P[3];
  const tailEnd: V3 = [0, tb[1] - q.tail * 0.8, tb[2] - q.tail * 0.5];
  b.tube([tb, lerp3(tb, tailEnd, 0.5), tailEnd], [[q.tailR, q.tailR], [q.tailR * 0.8, q.tailR * 0.8], [q.hairyTail ? q.tailR * 1.4 : q.tailR * 0.3, q.hairyTail ? q.tailR * 1.4 : q.tailR * 0.3]], seg(6), rigid(3), q.hairyTail ? BPART.hair : BPART.coat, {}, false, true);
  // legs: upper from the body, lower to a hoof / paw
  for (const [up, lo, front] of [[4, 5, true], [6, 7, true], [8, 9, false], [10, 11, false]] as [number, number, boolean][]) {
    const a = P[up], k = P[lo];
    const foot: V3 = [k[0] * (1 + q.sprawl * 0.3), 0.03, k[2] + (front ? 0.02 : -0.02)];
    const thick = q.legR * (front ? 1 : 1.15);
    // the upper leg carries the muscle (shoulder / haunch) and angles back (front) or forward (hind) to the joint
    // (flattened against the flank: the muscle is deep front to back and thin side to side, not a post)
    b.tube([[a[0] * 0.85, a[1] + q.depth * 0.22, a[2] + (front ? 0.02 : -0.03) * L], a, k], [[thick * 1.5, thick * 3.1], [thick * 1.3, thick * 2.0], [thick, thick * 1.1]], seg(8), limbW(up, 0), q.wool ? BPART.dark : BPART.coat, {}, false, false);
    // below it a slender cannon: the hind leg bends back at the hock, the foreleg runs straight down from the knee
    const mid: V3 = front ? [k[0], k[1] * 0.42, k[2] + 0.01 * L] : [k[0], k[1] * 0.45, k[2] - 0.08 * L];
    if (q.hoof && lod <= 1) {
      // the cannon to the knobbly fetlock joint, the sloping pastern, and a hoof (not a post standing on a pebble)
      // (a hind cannon runs down and forward from the hock: its fetlock lower and part way to the hoof)
      const fy = Math.min(0.15, mid[1] * (front ? 0.72 : 0.5)), py = Math.min(0.065, fy * 0.55);
      const fet: V3 = [foot[0], fy, front ? foot[2] - 0.005 : mid[2] + (foot[2] - mid[2]) * 0.55], pas: V3 = [foot[0], py, foot[2] + (front ? 0.028 : 0.02)];
      b.tube([k, mid, fet, pas], [[thick * 0.95, thick], [thick * 0.66, thick * 0.74], [thick * 0.82, thick * 0.92], [thick * 0.6, thick * 0.66]], seg(6), limbW(lo, up), q.wool ? BPART.dark : BPART.coat, {}, false, false);
      b.tube([[pas[0], py + 0.012, pas[2] - 0.004], [pas[0], 0.0, pas[2] + 0.03]], [[thick * 0.72, thick * 0.74], [thick * 0.98, thick * 1.08]], seg(6), rigid(lo), BPART.horn, {}, false, true);
    } else if (lod >= 2) {
      b.tube([k, foot], [[thick * 0.95, thick], [thick * 0.7, thick * 0.75]], seg(6), limbW(lo, up), q.wool ? BPART.dark : BPART.coat, {}, false, false);
    } else {
      b.tube([k, mid, lerp3(mid, foot, 0.6), foot], [[thick * 0.95, thick], [thick * 0.72, thick * 0.78], [thick * 0.62, thick * 0.66], [thick * 0.8, thick * 0.85]], seg(6), limbW(lo, up), q.wool ? BPART.dark : BPART.coat, {}, false, true);
      if (lod <= 1) b.ellipsoid([foot[0], 0.03, foot[2] + 0.01], [thick * 1.0, 0.035, thick * 1.3], seg(6), 3, rigid(lo), BPART.horn);
    }
  }
  return b.build(rig, 1);
}

// ───────────────────────────── birds, fish, insects, rays ─────────────────────────────

/** bones: 0 body, 1 head, 2/3 wing L inner/outer, 4/5 wing R inner/outer, 6 tail */
export const BIRD_RIG: Rig = {
  plan: PLAN.bird,
  pivots: [[0, 0.5, 0], [0, 0.56, 0.3], [0.08, 0.55, 0.02], [0.45, 0.55, 0.0], [-0.08, 0.55, 0.02], [-0.45, 0.55, 0.0], [0, 0.52, -0.3]],
  parents: [-1, 0, 0, 2, 0, 4, 0],
};

export function birdMesh(lod: number, gull: boolean): BodyMesh {
  const b = new RigBuilder();
  const seg = (n: number) => Math.max(3, Math.round(n * (lod === 0 ? 1 : lod === 1 ? 0.5 : 0.35)));
  // (beyond the nearest LOD — a few pixels against the sky — a bird is its body, head, wings and tail: no belly shell or
  // legs, and far off no beak)
  const far = lod >= 2;
  b.ellipsoid([0, 0.5, 0], [0.11, 0.1, 0.3], seg(10), seg(7), rigid(0), BPART.coat);
  if (lod === 0) b.ellipsoid([0, 0.47, 0.02], [0.095, 0.085, 0.24], seg(10), seg(6), rigid(0), BPART.belly, {}, (p) => p[1] < 0.47);
  b.ellipsoid([0, 0.57, 0.3], [0.07, 0.07, 0.08], seg(8), seg(6), rigid(1), BPART.coat);
  if (!far) b.tube([[0, 0.565, 0.36], [0, 0.555, gull ? 0.48 : 0.43]], [[0.022, 0.018], [0.002, 0.002]], 4, rigid(1), BPART.horn);
  if (lod === 0) for (const sx of [1, -1]) b.ellipsoid([sx * 0.045, 0.585, 0.33], [0.012, 0.012, 0.012], 4, 3, rigid(1), BPART.dark);
  for (const [sx, inn, out] of [[1, 2, 3], [-1, 4, 5]] as [number, number, number][]) {
    b.card([sx * 0.05, 0.55, 0.1], [sx * 0.45, 0.55, 0.06], [sx * 0.45, 0.55, -0.12], [sx * 0.05, 0.55, -0.1], rigid(inn), BPART.coat);
    b.card([sx * 0.45, 0.55, 0.06], [sx * (gull ? 0.95 : 0.8), 0.55, -0.02], [sx * (gull ? 0.92 : 0.76), 0.55, -0.12], [sx * 0.45, 0.55, -0.12], rigid(out), gull ? BPART.dark : BPART.coat);
  }
  b.card([0.0, 0.52, -0.25], [0.1, 0.52, -0.52], [-0.1, 0.52, -0.52], [-0.0, 0.52, -0.25], rigid(6), BPART.coat);
  if (lod === 0) for (const sx of [1, -1]) b.tube([[sx * 0.04, 0.42, 0.02], [sx * 0.045, 0.22, 0.04], [sx * 0.045, 0.02, 0.06]], [[0.012, 0.012], [0.008, 0.008], [0.006, 0.006]], 3, rigid(0), BPART.horn);
  return b.build(BIRD_RIG, 1);
}

/** bones: 0 head, 1 mid body, 2 tail stock, 3 tail fin */
export const FISH_RIG: Rig = { plan: PLAN.fish, pivots: [[0, 0, 0.15], [0, 0, 0.0], [0, 0, -0.25], [0, 0, -0.42]], parents: [-1, 0, 1, 2] };

export function fishMesh(lod: number, whale: boolean): BodyMesh {
  const b = new RigBuilder();
  const seg = (n: number) => Math.max(3, Math.round(n * (lod === 0 ? 1 : 0.5)));
  const prof: [number, number][] = [[0.5, 0.0], [0.42, 0.07], [0.25, 0.11], [0.0, 0.12], [-0.25, 0.08], [-0.42, 0.03]];
  const pts: V3[] = prof.map(([z]) => [0, 0, z]);
  const rad: [number, number][] = prof.map(([, r]) => [r * (whale ? 1.1 : 0.7), r]);
  const boneAt = (t: number): [number, number, number] => { const z = 0.5 - t * 0.92; return z > 0.1 ? [0, 1, 1] : z > -0.15 ? [1, 0, 1 - (0.1 - z) / 0.25 * 0.5] : z > -0.38 ? [2, 1, 0.6 + 0.4 * ((-0.15 - z) / 0.23)] : [2, 2, 1]; };
  b.tube(pts, rad, seg(10), boneAt, BPART.coat, {}, true, true, [1, 0, 0]);
  b.tube(pts.map((p) => [p[0], p[1] - 0.02, p[2]] as V3), rad.map(([x, y]) => [x * 0.96, y * 0.9] as [number, number]), seg(10), boneAt, BPART.belly, {}, false, false, [1, 0, 0]);
  if (whale) b.card([0.0, 0, -0.4], [0.32, 0, -0.62], [-0.32, 0, -0.62], [0, 0, -0.4], rigid(3), BPART.coat);
  else {
    b.card([0, 0.02, -0.4], [0, 0.16, -0.62], [0, -0.16, -0.62], [0, -0.02, -0.4], rigid(3), BPART.coat);
    b.card([0, 0.1, 0.05], [0, 0.2, -0.05], [0, 0.18, -0.2], [0, 0.08, -0.2], rigid(1), BPART.coat);
  }
  if (lod === 0) for (const sx of [1, -1]) b.ellipsoid([sx * (whale ? 0.1 : 0.06), 0.02, 0.38], [0.015, 0.015, 0.015], 4, 3, rigid(0), BPART.dark);
  return b.build({ ...FISH_RIG }, 0.3);
}

/** bones: 0 body, 1 wings */
export const INSECT_RIG: Rig = { plan: PLAN.insect, pivots: [[0, 0, 0], [0, 0.04, 0.0]], parents: [-1, 0] };
export function insectMesh(): BodyMesh {
  const b = new RigBuilder();
  b.tube([[0, 0, 0.5], [0, 0.02, 0.2], [0, 0.0, -0.5]], [[0.06, 0.07], [0.09, 0.1], [0.04, 0.05]], 5, rigid(0), BPART.coat, {}, true, true);
  for (const sx of [1, -1]) {
    b.card([sx * 0.05, 0.08, 0.15], [sx * 0.6, 0.1, -0.05], [sx * 0.55, 0.1, -0.35], [sx * 0.05, 0.08, -0.25], rigid(1), BPART.belly);
    b.tube([[sx * 0.05, 0, 0], [sx * 0.2, 0.2, -0.2], [sx * 0.22, -0.15, -0.35]], [[0.015, 0.015], [0.012, 0.012], [0.006, 0.006]], 3, rigid(0), BPART.coat);
  }
  return b.build(INSECT_RIG, 0.1);
}

/** bones: 0 body, 1 wing L, 2 wing R, 3 tail */
export const RAY_RIG: Rig = { plan: PLAN.ray, pivots: [[0, 0, 0], [0.2, 0, 0], [-0.2, 0, 0], [0, 0, -0.35]], parents: [-1, 0, 0, 0] };
export function rayMesh(): BodyMesh {
  const b = new RigBuilder();
  b.ellipsoid([0, 0, 0], [0.22, 0.07, 0.4], 10, 6, rigid(0), BPART.coat);
  for (const sx of [1, -1]) {
    b.card([sx * 0.18, 0, 0.3], [sx * 1.0, 0, -0.05], [sx * 0.95, 0, -0.2], [sx * 0.18, 0, -0.32], (p) => [sx > 0 ? 1 : 2, 0, Math.min(1, Math.abs(p[0]) / 0.4)], BPART.belly);
  }
  b.tube([[0, 0, -0.35], [0, 0.02, -0.9], [0, 0.05, -1.4]], [[0.04, 0.03], [0.02, 0.015], [0.005, 0.005]], 4, rigid(3), BPART.coat);
  return b.build(RAY_RIG, 0.2);
}
