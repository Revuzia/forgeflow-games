// PHYS, CUT2 task P4: the instruments of probe_neck.ts. The shell's neck on a bare SoftBody (physview/swap_flow.ts cutOnce with its family depth), measured AT THE SWAP:
//   * the momentum the neck added (|v1 - v0|, the shell's own quantity, CUT2 5.4 (b)), the turn and the lift of the parent's frame;
//   * the swap-continuity metric of 5.4 / X19: the Chamfer distance (in R0, both directions) between the necked parent's surface and the two TRUE halves placed in its pose,
//     in three readings (caps of the halves left out as SAMPLES only = "visible", left out as targets too, and everything);
//   * the swell: the highest particle of the squishy during the neck (and, with `full`, of the squishy and its pieces for 2.5 s after) over its settled height.
import type { V3 } from '../../src/contracts.ts';
import { SoftBody, closestOnTri } from '../../src/physics/softbody.ts';
import { familyOf } from '../../src/data/catalog.ts';
import { cutOnce, frame, newScene, planeThrough } from './swap_flow.ts';
import type { SwapView } from './swap_flow.ts';

interface Surf { P: Float64Array; tris: Uint32Array; cx: Float64Array; cy: Float64Array; cz: Float64Array; cr: Float64Array; nt: number }
/** a triangle soup of the given world positions (one or more bodies concatenated), `keep(t)` filters triangles */
function surf(parts: Array<{ pos: ArrayLike<number>; idx: ArrayLike<number>; skip?: Uint8Array }>): Surf {
  let nv = 0, nt = 0;
  for (const p of parts) { nv += p.pos.length / 3; nt += p.idx.length / 3; }
  const P = new Float64Array(nv * 3), tris = new Uint32Array(nt * 3), cx = new Float64Array(nt), cy = new Float64Array(nt), cz = new Float64Array(nt), cr = new Float64Array(nt);
  let vo = 0, to = 0;
  for (const p of parts) {
    const n = p.pos.length / 3;
    for (let i = 0; i < p.pos.length; i++) P[vo * 3 + i] = p.pos[i];
    for (let t = 0; t < p.idx.length / 3; t++) {
      if (p.skip && p.skip[t]) continue;
      const a = p.idx[t * 3] + vo, b = p.idx[t * 3 + 1] + vo, c = p.idx[t * 3 + 2] + vo;
      tris[to * 3] = a; tris[to * 3 + 1] = b; tris[to * 3 + 2] = c;
      const x = (P[a * 3] + P[b * 3] + P[c * 3]) / 3, y = (P[a * 3 + 1] + P[b * 3 + 1] + P[c * 3 + 1]) / 3, z = (P[a * 3 + 2] + P[b * 3 + 2] + P[c * 3 + 2]) / 3;
      cx[to] = x; cy[to] = y; cz[to] = z;
      cr[to] = Math.max(Math.hypot(P[a * 3] - x, P[a * 3 + 1] - y, P[a * 3 + 2] - z), Math.hypot(P[b * 3] - x, P[b * 3 + 1] - y, P[b * 3 + 2] - z), Math.hypot(P[c * 3] - x, P[c * 3 + 1] - y, P[c * 3 + 2] - z));
      to++;
    }
    vo += n;
  }
  return { P, tris: tris.subarray(0, to * 3), cx: cx.subarray(0, to), cy: cy.subarray(0, to), cz: cz.subarray(0, to), cr: cr.subarray(0, to), nt: to };
}
/** 4 sample points per kept triangle (the centroid and three points near the corners), as a flat xyz array */
function samples(s: Surf): Float64Array {
  const out = new Float64Array(s.nt * 12), W = [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6]];
  for (let t = 0; t < s.nt; t++) {
    const a = s.tris[t * 3] * 3, b = s.tris[t * 3 + 1] * 3, c = s.tris[t * 3 + 2] * 3;
    for (let k = 0; k < 4; k++) {
      const w = W[k];
      out[t * 12 + k * 3] = w[0] * s.P[a] + w[1] * s.P[b] + w[2] * s.P[c];
      out[t * 12 + k * 3 + 1] = w[0] * s.P[a + 1] + w[1] * s.P[b + 1] + w[2] * s.P[c + 1];
      out[t * 12 + k * 3 + 2] = w[0] * s.P[a + 2] + w[1] * s.P[b + 2] + w[2] * s.P[c + 2];
    }
  }
  return out;
}
const OUT = new Float64Array(6);
/** mean over the sample points of the distance to the nearest triangle of `T` (bounding-sphere culled brute force) */
function directed(S: Float64Array, T: Surf): number {
  let sum = 0;
  const n = S.length / 3;
  for (let i = 0; i < n; i++) {
    const x = S[i * 3], y = S[i * 3 + 1], z = S[i * 3 + 2];
    let best = Infinity;
    for (let t = 0; t < T.nt; t++) {
      const lb = Math.hypot(x - T.cx[t], y - T.cy[t], z - T.cz[t]) - T.cr[t];
      if (lb >= best) continue;
      closestOnTri(x, y, z, T.P, T.tris[t * 3] * 3, T.tris[t * 3 + 1] * 3, T.tris[t * 3 + 2] * 3, OUT);
      const d = Math.hypot(x - OUT[0], y - OUT[1], z - OUT[2]);
      if (d < best) best = d;
    }
    sum += best;
  }
  return sum / n;
}
/** the cap triangles of a piece (all three vertices on the cut plane n . x = d, in W): 1 = cap */
function capMask(b: SoftBody, n: V3, d: number): Uint8Array {
  const o = b.piece!.offset, R = b.restLocal, I = b.indices, m = new Uint8Array(I.length / 3);
  const on = (i: number): boolean => Math.abs(n.x * (R[i * 3] + o.x) + n.y * (R[i * 3 + 1] + o.y) + n.z * (R[i * 3 + 2] + o.z) - d) < 3e-6;
  for (let t = 0; t < m.length; t++) m[t] = on(I[t * 3]) && on(I[t * 3 + 1]) && on(I[t * 3 + 2]) ? 1 : 0;
  return m;
}
export interface Chamfer { vis: number; visBoth: number; all: number }
/** Chamfer distance in R0 between the necked parent and the two halves (placed in its pose): see the header for the three readings */
export function chamfer(v: SwapView): Chamfer {
  const R0 = v.parent.restRadius, n = v.plan.rest.n, d = v.plan.rest.d;
  const mA = capMask(v.a, n, d), mB = capMask(v.b, n, d);
  const par = surf([{ pos: v.parent.positions, idx: v.parent.indices }]);
  const all = surf([{ pos: v.a.positions, idx: v.a.indices }, { pos: v.b.positions, idx: v.b.indices }]);
  const skin = surf([{ pos: v.a.positions, idx: v.a.indices, skip: mA }, { pos: v.b.positions, idx: v.b.indices, skip: mB }]);
  const capOnly = surf([{ pos: v.a.positions, idx: v.a.indices, skip: mA.map((x) => 1 - x) as Uint8Array }, { pos: v.b.positions, idx: v.b.indices, skip: mB.map((x) => 1 - x) as Uint8Array }]);
  const sP = samples(par), sS = samples(skin), sC = capOnly.nt ? samples(capOnly) : new Float64Array(0);
  const pToAll = directed(sP, all), pToSkin = directed(sP, skin), sToPar = directed(sS, par), cToPar = sC.length ? directed(sC, par) : 0;
  const nS = sS.length / 3, nC = sC.length / 3, sAll = (sToPar * nS + cToPar * nC) / (nS + nC);
  return { vis: (pToAll + sToPar) / 2 / R0, visBoth: (pToSkin + sToPar) / 2 / R0, all: (pToAll + sAll) / 2 / R0 };
}

export interface NeckStat {
  sp: string; fam: string; plane: string; depth: number; ok: boolean; why?: string;
  dv: number; v1: number; tilt: number; lift: number; liftMax: number; top: number; fa: number; disp: number; ch?: Chamfer;
  swell?: number;   // with `full`: the highest particle of the squishy and its pieces over 2.5 s after the swap, over its settled height
}
const topY = (b: SoftBody): number => { const P = b.positions; let m = -Infinity; for (let i = 1; i < P.length; i += 3) if (P[i] > m) m = P[i]; return m; };
/** One cut of a settled whole `sp` by the plane n . x = off R (through the centre), the neck to the swap at `depth`: the swap-time numbers. */
export function neckSwap(sp: string, plane: string, n: V3, off: number, depth: number | undefined, o: { chamfer?: boolean; full?: boolean; mode?: 'at' | 'median' } = {}): NeckStat {
  const sc = newScene(sp), parent = sc.bodies[0], fam = familyOf(sp as never) as string;
  const rest = topY(parent);
  let topMax = rest, liftMax = 0;
  const cy0 = parent.center.y, cx0 = parent.center.x, cz0 = parent.center.z;
  let disp = 0;
  let ch: Chamfer | undefined;
  const pl = planeThrough(parent, n, off);
  const res = cutOnce(sc, parent, pl, {
    depth, mode: o.mode ?? 'at', stopAtSwap: !o.full,
    perFrame: () => { topMax = Math.max(topMax, topY(parent)); liftMax = Math.max(liftMax, parent.center.y - cy0); disp = Math.hypot(parent.center.x - cx0, parent.center.z - cz0); },
    onSwap: (v) => { if (o.chamfer) ch = chamfer(v); },
  });
  const st: NeckStat = { sp, fam, plane, depth: depth ?? NaN, ok: res.ok, why: res.why, dv: 0, v1: 0, tilt: 0, lift: 0, liftMax, top: topMax / rest, fa: res.plan?.fa ?? NaN, disp, ch };
  if (!res.ok) return st;
  st.dv = Math.hypot(res.dv!.x, res.dv!.y, res.dv!.z); st.v1 = Math.hypot(res.v1!.x, res.v1!.y, res.v1!.z); st.tilt = res.tilt!; st.lift = res.lift!; st.depth = res.depth!;
  if (o.full) {
    let peak = topMax;
    for (let i = 0; i < 150; i++) { frame(sc); for (const b of sc.bodies) peak = Math.max(peak, topY(b)); }
    st.swell = peak / rest;
  }
  return st;
}
