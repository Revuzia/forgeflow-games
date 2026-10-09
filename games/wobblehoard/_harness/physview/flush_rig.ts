// PHYS, CUT2 task P5: the rig and the instruments of probe_flush.ts (the SHELL's cut-and-part flow through createApp on the real SoftBody; X13-style per-piece metrics).
import type { SoftBodyLike } from '../../src/contracts.ts';
import { createApp } from '../../src/app.ts';
import { createCollection } from '../../src/collection/index.ts';
import { speciesBaseGenome, familyOf } from '../../src/data/catalog.ts';
import { PIECE_CONTACT, SoftBody, closestOnTri } from '../../src/physics/softbody.ts';
import { wholeRefFor } from '../../src/render/wholeRef.ts';
import { PART_GAP, PART_GAP_DEFAULT } from '../../src/shell/cut.ts';
import { createMockWorld } from '../mocks.ts';

export const FAM12 = ['dollop', 'twangle', 'puddlo', 'crumbit', 'chunkle', 'wisplet', 'crimpo', 'boingle', 'dimpla', 'wrigglo', 'capnap', 'kneadle'];
export const DT = 1 / 60;
export type V = { x: number; y: number; z: number };
export const Ctor = SoftBody as unknown as new (g: unknown, o?: unknown) => SoftBodyLike;
export const f = (x: number, n = 3): number => +x.toFixed(n);
export interface Priv { nh: number; X: Float64Array; Q: Float64Array; H3: Int32Array; HE3: Int32Array; debug: { safetyResets: number }; tris: Uint32Array }
export const BP = (b: unknown): Priv => b as Priv;

function dihedralDeg(P: ArrayLike<number>, a3: number, b3: number, c3: number, d3: number): number {
  let ex = P[b3] - P[a3], ey = P[b3 + 1] - P[a3 + 1], ez = P[b3 + 2] - P[a3 + 2];
  const el = Math.hypot(ex, ey, ez) || 1; ex /= el; ey /= el; ez /= el;
  let cx = P[c3] - P[a3], cy = P[c3 + 1] - P[a3 + 1], cz = P[c3 + 2] - P[a3 + 2];
  const tc = cx * ex + cy * ey + cz * ez; cx -= tc * ex; cy -= tc * ey; cz -= tc * ez;
  let dx = P[d3] - P[a3], dy = P[d3 + 1] - P[a3 + 1], dz = P[d3 + 2] - P[a3 + 2];
  const td = dx * ex + dy * ey + dz * ez; dx -= td * ex; dy -= td * ey; dz -= td * ez;
  const lc = Math.hypot(cx, cy, cz), ld = Math.hypot(dx, dy, dz);
  if (lc < 1e-12 || ld < 1e-12) return 0;
  return 180 - (Math.acos(Math.max(-1, Math.min(1, (cx * dx + cy * dy + cz * dz) / (lc * ld)))) * 180) / Math.PI;
}
/** altitudes (distances of the two opposite vertices from the edge line) of a hinge: a sliver triangle (altitude under a quarter of the mean edge) flips its dihedral on a 1 mm move without any visible crease */
function altitudes(P: ArrayLike<number>, a3: number, b3: number, c3: number, d3: number): number {
  let ex = P[b3] - P[a3], ey = P[b3 + 1] - P[a3 + 1], ez = P[b3 + 2] - P[a3 + 2];
  const el = Math.hypot(ex, ey, ez) || 1; ex /= el; ey /= el; ez /= el;
  let cx = P[c3] - P[a3], cy = P[c3 + 1] - P[a3 + 1], cz = P[c3 + 2] - P[a3 + 2];
  const tc = cx * ex + cy * ey + cz * ez; cx -= tc * ex; cy -= tc * ey; cz -= tc * ez;
  let dx = P[d3] - P[a3], dy = P[d3 + 1] - P[a3 + 1], dz = P[d3 + 2] - P[a3 + 2];
  const td = dx * ex + dy * ey + dz * ez; dx -= td * ex; dy -= td * ey; dz -= td * ez;
  return Math.min(Math.hypot(cx, cy, cz), Math.hypot(dx, dy, dz));
}
const wellMask = new WeakMap<object, Uint8Array>();
/** worst fold of a piece over its OWN rest dihedral, degrees: [every hinge, the hinges whose two triangles are not slivers at rest (altitude >= a quarter of the mean edge)] */
export function foldExcess2(b: SoftBodyLike): [number, number] {
  const p = BP(b); let m = -1e9, mw = -1e9;
  let mask = wellMask.get(p);
  if (!mask) {
    mask = new Uint8Array(p.nh); const me = (b as unknown as { meanEdge: number }).meanEdge;
    for (let h = 0; h < p.nh; h++) mask[h] = altitudes(p.Q, p.HE3[h * 2], p.HE3[h * 2 + 1], p.H3[h * 2], p.H3[h * 2 + 1]) >= 0.25 * me ? 1 : 0;
    wellMask.set(p, mask);
  }
  for (let h = 0; h < p.nh; h++) {
    const d0 = dihedralDeg(p.Q, p.HE3[h * 2], p.HE3[h * 2 + 1], p.H3[h * 2], p.H3[h * 2 + 1]);
    const d1 = dihedralDeg(p.X, p.HE3[h * 2], p.HE3[h * 2 + 1], p.H3[h * 2], p.H3[h * 2 + 1]);
    if (d1 - d0 > m) m = d1 - d0;
    if (mask[h] && d1 - d0 > mw) mw = d1 - d0;
  }
  return [m, mw];
}
export const foldExcess = (b: SoftBodyLike): number => foldExcess2(b)[0];
/** ray parity along +x (a slightly tilted ray) */
function inside(P: ArrayLike<number>, tris: Uint32Array, x: number, y: number, z: number): boolean {
  const dx = 1, dy = 1e-4, dz = 2.3e-4;
  let c = 0;
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3, b = tris[t + 1] * 3, cc = tris[t + 2] * 3;
    const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[cc] - P[a], e2y = P[cc + 1] - P[a + 1], e2z = P[cc + 2] - P[a + 2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-14) continue;
    const id = 1 / det, tx = x - P[a], ty = y - P[a + 1], tz = z - P[a + 2], u = (tx * px + ty * py + tz * pz) * id;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (dx * qx + dy * qy + dz * qz) * id;
    if (v < 0 || u + v > 1) continue;
    if ((e2x * qx + e2y * qy + e2z * qz) * id > 0) c++;
  }
  return (c & 1) === 1;
}
/** deepest particle of a inside b, in rest radii of b: the distance from the particle to the nearest TRIANGLE of b's surface (the nearest vertex reads half an edge too much for a particle on a flat face) */
const cpScratch = new Float64Array(6);
export function depthInside(a: SoftBodyLike, b: SoftBodyLike): number {
  const P = a.positions, Q = b.positions, R = b.restRadius, c = b.center, tris = BP(b).tris;
  let r2 = 0;
  for (let i = 0; i < Q.length; i += 3) r2 = Math.max(r2, (Q[i] - c.x) ** 2 + (Q[i + 1] - c.y) ** 2 + (Q[i + 2] - c.z) ** 2);
  const Qd = Float64Array.from(Q);
  let worst = 0;
  for (let i = 0; i < P.length; i += 3) {
    if ((P[i] - c.x) ** 2 + (P[i + 1] - c.y) ** 2 + (P[i + 2] - c.z) ** 2 > r2) continue;
    if (!inside(Q, tris, P[i], P[i + 1], P[i + 2])) continue;
    let best = 1e9;
    for (let t = 0; t < tris.length; t += 3) {
      closestOnTri(P[i], P[i + 1], P[i + 2], Qd, tris[t] * 3, tris[t + 1] * 3, tris[t + 2] * 3, cpScratch);
      const d2 = (P[i] - cpScratch[0]) ** 2 + (P[i + 1] - cpScratch[1]) ** 2 + (P[i + 2] - cpScratch[2]) ** 2;
      if (d2 < best) best = d2;
    }
    worst = Math.max(worst, Math.sqrt(best) / R);
  }
  return worst;
}
const volOf = (b: SoftBodyLike): number => {
  const P = b.positions, I = b.indices; let v = 0;
  for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, c = I[t + 1] * 3, d = I[t + 2] * 3; v += P[a] * (P[c + 1] * P[d + 2] - P[c + 2] * P[d + 1]) - P[a + 1] * (P[c] * P[d + 2] - P[c + 2] * P[d]) + P[a + 2] * (P[c] * P[d + 1] - P[c + 1] * P[d]); }
  return v / 6;
};

/** the whole game core on the real SoftBody with a recording fake stage; the stage knows the eyes of the whole (the formulas of face.ts) */
export function rig(species: string, o: { yawDeg?: number; bv?: 'shell' | 'v0'; frame0?: boolean } = {}) {
  const w = createMockWorld({ storage: null });
  const st = w.stage as unknown as Record<string, unknown>;
  let vid = 100;
  st.primaryBodyId = () => 1; st.setBodyTier = () => {}; st.setCalmEffects = () => {};
  st.addBody = () => ++vid; st.removeBody = () => {}; st.setBody = () => {}; st.setCutSeam = () => {}; st.setBridge = () => {}; st.partPieces = () => {};
  st.stats = () => ({ drawCalls: 0, triangles: 0, tier: 'high', frameMsEma: 0 });
  st.setPrimaryBody = () => {};
  const au = w.audio as unknown as Record<string, unknown>; au.cut = () => {}; au.rejoin = () => {};
  const g = speciesBaseGenome(species as never, 1);
  let appRef: ReturnType<typeof createApp> | null = null;
  st.eyeAnchors = () => {
    const b = appRef?.body as SoftBodyLike | undefined;
    if (!b || b.piece) return null;
    const ref = wholeRefFor({ vertexCount: (b.restLocal.length / 3) | 0, indices: b.indices, restLocal: b.restLocal }, b.restRadius, g);
    return { left: { ...ref.eyes[0].centre }, right: { ...ref.eyes[1].centre } };
  };
  w.deps.createBody = ((gg: unknown, op?: { at?: V; piece?: unknown }) => (op?.piece ? new Ctor(gg, { piece: op.piece }) : op?.at ? new Ctor(gg, { piece: { frac: 1, chunk: false, at: op.at } }) : new Ctor(gg))) as typeof w.deps.createBody;
  const now = (): number => 1_700_000_000_000 + w.clock.t;
  const app = createApp({ ...w.deps, collection: createCollection({ storage: null, profile: null, now, random: () => 0.4 }), epochNow: now, genome: g });
  appRef = app;
  app.resize(800, 600, 1); app.setPhase('play');
  if (o.yawDeg) {
    const cam = w.stage.camera, r = Math.hypot(cam.position.x, cam.position.z), a = (o.yawDeg * Math.PI) / 180;
    cam.position.set(r * Math.sin(a), cam.position.y, r * Math.cos(a)); cam.lookAt(0, 0.35, 0); cam.updateMatrixWorld(true);
  }
  if (o.bv === 'v0') {
    // what-if (not the shipped flow): both lobes are born with the parent's own velocity, i.e. the plan's two side velocities are replaced by their share-weighted mean, so the
    // shell's `vel_c - (v1 - v0)` becomes v0 for both: no relative velocity of the lobes at the swap (their pinch motion). Quantifies how much of a launch is the neck's.
    const wb = app.body as unknown as { planCut: (pl: unknown, out: { fa: number; velA: V; velB: V }, mode: string) => boolean };
    const orig = wb.planCut.bind(wb);
    wb.planCut = (pl, out, mode) => {
      const ok = orig(pl, out, mode);
      if (ok) { const a = out.fa, m = { x: a * out.velA.x + (1 - a) * out.velB.x, y: a * out.velA.y + (1 - a) * out.velB.y, z: a * out.velA.z + (1 - a) * out.velB.z }; out.velA = { ...m }; out.velB = { ...m }; }
      return ok;
    };
  }
  if (o.frame0) {
    // what-if: the children are born in the squishy's pose BEFORE the neck (identity here: the squishy stands at rest), not in the best-fit frame the pinch has turned it into
    Object.defineProperty(app.body, 'frame', { get: () => ({ x: 0, y: 0, z: 0, w: 1 }), configurable: true });
  }
  const go = (ms: number, each?: () => void): void => { let left = ms; while (left > 1e-9) { const d = Math.min(1000 / 60, left); w.clock.t += d; app.frame(w.clock.t); each?.(); left -= d; } };
  return { app, go, w, g };
}

export interface PieceStat {
  frac: number;
  birth1f: number;       // centre speed over the swap frame (positions at the swap -> after the first step), m/s
  peak1f: number;        // largest per-frame centre speed over frames 2..60
  peak10: number;        // largest 0.1 s finite-difference centre speed from 0.1 s on (X13 settle: <= 1.2)
  peakUp10: number;      // largest upward 0.1 s speed (X13: <= 1.0)
  rise: number;          // centre y above the swap-frame centre y (X13: <= 0.06)
  v1s: number;           // largest 0.1 s speed from 1 s on (X13: <= 0.3)
  last: number;          // speed over the last 0.5 s (X13: <= 0.05)
  disp: number;          // centre travelled swap -> end
  hdisp: number;         // ... horizontally
  lowestMm: number;
  fold: number;          // worst fold over the piece's own rest dihedral, degrees, every hinge (X13: 75)
  foldW: number;         // ... over the hinges whose triangles are not slivers at rest (the cap rim has slivers that flip on a 1 mm move)
  vol: number;           // mesh volume / (frac x V0) at the end
}
export interface Scenario { tilt: number; lift: number; lo0: number[]; sp: string; scen: string; res: string; fracs: number[]; G: number; piece: PieceStat[]; sepEnd: number; dyEnd: number; sep0: number; dy0: number; pen: number; resets: number; swapAt: number; stacked: boolean }

export function runScenario(sp: string, scen: 'split' | 'between' | 'level', SECS = 4, bv: 'shell' | 'v0' = 'shell', ghost = false, frame0 = false): Scenario | null {
  const r = rig(sp, { yawDeg: scen === 'between' ? 22 : 0, bv, frame0 });
  r.go(1500);
  const V0 = volOf(r.app.body);
  r.app.cut.prewarm(); r.go(400);
  let res: string;
  if (scen === 'split') res = r.app.cut.splitInTwo();
  else {
    const s = r.app.host.bodyScreen()!;
    res = scen === 'between' ? r.app.cut.swipe(s.x + 0.2 * s.r, s.y - 1.6 * s.r, s.x + 0.2 * s.r + 1, s.y + 1.6 * s.r) : r.app.cut.swipe(s.x - 1.6 * s.r, s.y + 2, s.x + 1.6 * s.r, s.y - 2);
  }
  if (res !== 'cut') { console.log(`${sp} ${scen}: ${res}`); r.app.dispose(); return null; }
  let guard = 0;
  const par = r.app.body as SoftBodyLike, cy0 = par.center.y;
  let tilt = 0, cyS = cy0;
  while (r.app.cut.pieces < 2 && guard++ < 900) {
    r.go(1000 / 60);
    const q = par.frame; if (q && r.app.cut.pieces < 2) { tilt = (Math.acos(Math.max(-1, Math.min(1, 1 - 2 * (q.x * q.x + q.z * q.z)))) * 180) / Math.PI; cyS = par.center.y; }
  }
  if (r.app.cut.pieces < 2) { console.log(`${sp} ${scen}: no swap`); r.app.dispose(); return null; }
  const A = r.app.body, B = r.app.bodies.extras[0]?.body as SoftBodyLike;
  if (ghost) { r.app.bodies.setGhost(A, true); r.app.bodies.setGhost(B, true); }   // control: no contact between the two pieces at all
  const fam = familyOf(sp as never), G = (PART_GAP[fam] ?? PART_GAP_DEFAULT);
  const tr = trackPair(() => r.go(1000 / 60), [A, B], r.app.cut.fracs(), SECS, V0);
  const out: Scenario = { tilt, lift: cyS - cy0, lo0: tr.lo0, sp, scen, res, fracs: tr.fracs, G, piece: tr.piece, sepEnd: tr.sepEnd, dyEnd: tr.dyEnd, sep0: tr.sep0, dy0: tr.dy0, pen: tr.pen, resets: tr.resets, swapAt: 0,
    stacked: Math.abs(tr.dyEnd) > 0.6 * Math.min(A.restRadius, B.restRadius) && tr.sepEnd < 0.8 * Math.min(A.restRadius, B.restRadius) && scen !== 'level' };
  r.app.dispose();
  return out;
}

export interface PairTrack { piece: PieceStat[]; fracs: number[]; lo0: number[]; sepEnd: number; dyEnd: number; sep0: number; dy0: number; pen: number; resets: number }
/** Run `secs` of the world (`step` advances ONE frame) and measure the two new pieces `bs` from the frame they were placed in: X13's quantities, from the bodies' centres (positions), 0.1 s differences. */
export function trackPair(step: () => void, bs: SoftBodyLike[], fr: number[], secs: number, V0: number, penEvery = 20): PairTrack {
  const [A, B] = bs;
  const lo0 = bs.map((b) => { let m = 1e9; const P = b.positions; for (let i = 1; i < P.length; i += 3) m = Math.min(m, P[i]); return m; });
  const N = Math.round(secs / DT);
  const H: Array<V[]> = bs.map((b) => [{ x: b.center.x, y: b.center.y, z: b.center.z }]);
  const d3 = (a: V, c: V): number => Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z);
  const st: PieceStat[] = bs.map((b, k) => ({ frac: fr[k], birth1f: 0, peak1f: 0, peak10: 0, peakUp10: 0, rise: 0, v1s: 0, last: 0, disp: 0, hdisp: 0, lowestMm: 1e9, fold: -1e9, foldW: -1e9, vol: 0 }));
  const sep0 = Math.hypot(A.center.x - B.center.x, A.center.z - B.center.z), dy0 = A.center.y - B.center.y;
  let pen = 0;
  for (let i = 1; i <= N; i++) {
    step();
    for (let k = 0; k < 2; k++) {
      const b = bs[k], h = H[k], c = { x: b.center.x, y: b.center.y, z: b.center.z }; h.push(c);
      const v1 = d3(h[i - 1], c) / DT;
      if (i === 1) st[k].birth1f = v1; else if (i <= 60 && v1 > st[k].peak1f) st[k].peak1f = v1;
      if (i >= 6) { const a = h[i - 6], v = d3(a, c) / 0.1, up = (c.y - a.y) / 0.1; if (v > st[k].peak10) st[k].peak10 = v; if (up > st[k].peakUp10) st[k].peakUp10 = up; if (i >= 60 && v > st[k].v1s) st[k].v1s = v; }
      if (c.y - h[0].y > st[k].rise) st[k].rise = c.y - h[0].y;
      if (i % 6 === 0) { const [fx, fw] = foldExcess2(b); if (fx > st[k].fold) st[k].fold = fx; if (fw > st[k].foldW) st[k].foldW = fw; }
    }
    if (penEvery > 0 && (i % penEvery === 0 || i === N)) pen = Math.max(pen, depthInside(A, B), depthInside(B, A));
  }
  for (let k = 0; k < 2; k++) {
    const h = H[k], n = h.length, b = bs[k];
    st[k].last = d3(h[n - 31], h[n - 1]) / 0.5; st[k].disp = d3(h[0], h[n - 1]); st[k].hdisp = Math.hypot(h[n - 1].x - h[0].x, h[n - 1].z - h[0].z);
    let lo = 1e9; const P = b.positions; for (let i = 1; i < P.length; i += 3) lo = Math.min(lo, P[i]);
    st[k].lowestMm = lo * 1000; st[k].vol = V0 > 0 ? volOf(b) / (fr[k] * V0) : 1;
  }
  return { piece: st, fracs: fr.map((x) => f(x, 4)), lo0, sepEnd: Math.hypot(A.center.x - B.center.x, A.center.z - B.center.z), dyEnd: A.center.y - B.center.y, sep0, dy0, pen, resets: BP(A).debug.safetyResets + BP(B).debug.safetyResets };
}

/** Frame cost of the contact: `bodies.step(1/60)` (collide for every body, then every step) for the two pieces of a Split in two vs for two whole bodies at the same distance, interleaved batches of 60 frames, best of `batches`. */
export function frameCost(sp: string, batches = 10): { pieces: number; wholes: number; ratio: number; all: number[][] } {
  const g = speciesBaseGenome(sp as never, 1);
  const r = rig(sp); r.go(1500); r.app.cut.prewarm(); r.go(400); r.app.cut.splitInTwo();
  let guard = 0; while (r.app.cut.pieces < 2 && guard++ < 900) r.go(1000 / 60);
  r.go(1500);
  const w2 = rig(sp); w2.go(1500);
  const extra = new Ctor(g, { piece: { frac: 1, chunk: false, at: { x: 0.95, y: 0, z: 0 } } });
  w2.app.bodies.addExtra(extra, g, { shared: true });
  w2.go(1500);
  // (CPU time of the process, not wall time: a busy shared machine inflates the wall clock of a batch by whatever else runs)
  const cpu = (): number => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
  const time = (a: typeof r): number => { const t0 = cpu(); for (let i = 0; i < 240; i++) a.app.bodies.step(1 / 60); return (cpu() - t0) / 240; };   // (240 frames: the CPU clock ticks in 15.6 ms on Windows)
  time(r); time(w2);
  let bp = Infinity, bw = Infinity; const sp2: number[] = [], sw: number[] = [];
  for (let k = 0; k < batches; k++) { const a = time(r), b = time(w2); sp2.push(a); sw.push(b); bp = Math.min(bp, a); bw = Math.min(bw, b); }
  r.app.dispose(); w2.app.dispose();
  return { pieces: bp, wholes: bw, ratio: bp / bw, all: [sp2, sw] };
}

/** The contact's own price: the same two settled pieces, `bodies.step` batches of 60 frames, interleaved with the contact of two whole bodies (PIECE_CONTACT.shipped) and the piece contact, best of `batches`. */
export function contactCost(sp: string, batches = 8): { shipped: number; piece: number; ratio: number } {
  const r = rig(sp); r.go(1500); r.app.cut.prewarm(); r.go(400); r.app.cut.splitInTwo();
  let guard = 0; while (r.app.cut.pieces < 2 && guard++ < 900) r.go(1000 / 60);
  r.go(2500);
  const cpu = (): number => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
  const time = (): number => { const t0 = cpu(); for (let i = 0; i < 240; i++) r.app.bodies.step(1 / 60); return (cpu() - t0) / 240; };
  const was = PIECE_CONTACT.shipped;
  PIECE_CONTACT.shipped = true; time(); PIECE_CONTACT.shipped = false; time();
  let bs = Infinity, bn = Infinity;
  for (let k = 0; k < batches; k++) { PIECE_CONTACT.shipped = true; bs = Math.min(bs, time()); PIECE_CONTACT.shipped = false; bn = Math.min(bn, time()); }
  PIECE_CONTACT.shipped = was; r.app.dispose();
  return { shipped: bs, piece: bn, ratio: bn / bs };
}
