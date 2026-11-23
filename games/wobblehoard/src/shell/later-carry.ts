// Round 14 (R14_CARRY, owner decision D-105: "make it easier to pick up and move squishies around"): the carry's lazy half. Rides in the life chunk (the life host,
// later-life.ts, imports it), so the first-play download only holds the gesture machine's CARRY rule (gestures.ts), the driver's lift line and the physics' lift.
//
//   overTop      the height of the things under a squishy's footprint (the level carry passes OVER a pad, a mound, a nest, a seat: its hand rises by it)
//   near         the forgiving grab: a press that misses every squishy by a small margin takes the nearest one (at least a 44 px target, the smallest piece as easy as a
//                whole): game.ts pickBody asks it (LifeHostLike.nearBody) and the gesture host's hit test is retried toward that squishy's middle (hitNear)
//   hands        a SECOND finger on another squishy carries that one at the same time (touch): the host owns that pointer (grabAt / dragAt / dropAt), slot 4 of its body
//   tip          "Drag to carry", once ever (stored under wobblehoard:v2:carryTip), the first time squishies can be carried
import type { SoftBodyLike, V3 } from '../contracts.ts';
import { cameraRay, cameraRight, projectToNdc, pxToNdc, raycastAt } from '../input/camera.ts';
import type { BodyHit } from '../input/gestures.ts';
import type { ExtraBody } from './bodies.ts';
import type { Game } from './game.ts';
import type { StorageLike } from '../core/settings.ts';

/** things taller than this (posts, frames, trunks, walls) are gone round, never over: the level carry passes over what a squishy can stand on */
export const OVER_MAX = 1.6;
/** a squishy carried over a thing clears its top by this (m) */
export const OVER_GAP = 0.06;
/** the forgiving grab: a press this many px outside a squishy's silhouette disc still takes it, and the disc is at least NEAR_MIN px in radius (a 44 px target) */
export const NEAR_PX = 12, NEAR_MIN = 22;
/** the slot a second finger's carry holds on ITS squishy (the gesture machine's fingers take the first free of the five on the ACTIVE squishy) */
export const HAND2_SLOT: 4 = 4;
export const CARRY_TIP_KEY = 'wobblehoard:v2:carryTip';
export const CARRY_TIP = 'Drag to carry';
/** the gesture pill's line where squishies are carried (ui/hint.ts setHintRoom): the carry first, the stretch from a hold */
export const HINT_ROOM = {
  touch: 'Drag to carry · tap to poke · hold, then drag out to stretch',
  pointer: 'Drag to carry · click to poke · hold, then drag out to stretch · Shift + drag pulls both sides',
  // (round 15, R15_FIX F11) the room camera's own line: zoom and moving the view (D-104), on the returning pill's every second turn (ui/hint.ts)
  view: { touch: 'Pinch to zoom · drag with two fingers to look around', pointer: 'Wheel to zoom · Shift + right-drag to look around · right-drag turns the view' },
} as const;
const PS = 36;   // (physics/softbody.ts PS: the packed prop stride; see PropSolve)

/** The packed props of the place (physics' PropSolve) and which thing each one is part of (-1: a wall). */
export interface PropsLike { readonly solve: { readonly count: number; readonly S: Float64Array }; readonly propThing: Int16Array }

/**
 * The top of the things under a disc (x, z, r) on the floor, m over the floor: 0 when it stands on open floor. Every shown prop (kind != 0) of a thing whose top
 * is at most OVER_MAX: a sphere by its cap over the point nearest the disc, a box and a capsule by their world bounding box's top inside the disc's reach. No allocation.
 */
export function overTop(P: PropsLike | null, x: number, z: number, r: number): number {
  if (!P) return 0;
  const S = P.solve.S, n = P.solve.count;
  let top = 0;
  for (let k = 0; k < n; k++) {
    const o = k * PS, kind = S[o];
    if (kind === 0 || P.propThing[k] < 0) continue;
    const dx = x - S[o + 4], dz = z - S[o + 6];
    if (dx * dx + dz * dz > (S[o + 28] + r) * (S[o + 28] + r)) continue;
    let t = -1;
    if (kind === 1) {
      const R = S[o + 16], d = Math.max(0, Math.sqrt(dx * dx + dz * dz) - 0.7 * r);
      if (d < R) t = S[o + 5] + Math.sqrt(R * R - d * d);
    } else {
      // the world box of the prop (its rotation rows): half height and half widths; a capsule as its segment's box grown by its radius
      const h0 = S[o + 16], h1 = S[o + 17], h2 = S[o + 18];
      let ex: number, ey: number, ez: number;
      if (kind === 2) {
        const ax = S[o + 3] | 0, rr = h0, hl = h1;   // (capsule: [16] r, [17] the segment's HALF length along local axis ax)
        ex = Math.abs(S[o + 7 + ax]) * hl + rr; ey = Math.abs(S[o + 10 + ax]) * hl + rr; ez = Math.abs(S[o + 13 + ax]) * hl + rr;
      } else {
        ex = Math.abs(S[o + 7]) * h0 + Math.abs(S[o + 8]) * h1 + Math.abs(S[o + 9]) * h2;
        ey = Math.abs(S[o + 10]) * h0 + Math.abs(S[o + 11]) * h1 + Math.abs(S[o + 12]) * h2;
        ez = Math.abs(S[o + 13]) * h0 + Math.abs(S[o + 14]) * h1 + Math.abs(S[o + 15]) * h2;
        // (a box turned about the vertical: its own footprint, not the world box's, so a long board crossed on the slant is not wider than it is)
        if (Math.abs(S[o + 11]) > 0.999) {
          const lx = S[o + 7] * dx + S[o + 13] * dz, lz = S[o + 9] * dx + S[o + 15] * dz;
          if (Math.abs(lx) < h0 + 0.7 * r && Math.abs(lz) < h2 + 0.7 * r) t = S[o + 5] + ey;
          if (t > top && t <= OVER_MAX) top = t;
          continue;
        }
      }
      if (Math.abs(dx) < ex + 0.7 * r && Math.abs(dz) < ez + 0.7 * r) t = S[o + 5] + ey;
    }
    if (t > top && t <= OVER_MAX) top = t;
  }
  return top;
}

/** One carry's plane: the body it belongs to, the hand's height over the floor at the pick-up (base), the raise over things now, where the body hangs from the hand. */
export interface CarryPlane { b: SoftBodyLike | null; base: number; raise: number; ux: number; uz: number }
export const carryPlane = (): CarryPlane => ({ b: null, base: 0, raise: 0, ux: 0, uz: 0 });

/** A squishy's silhouette disc in CSS px (its centre and rest radius projected), into out[0..2]; false when it is behind the camera. No allocation but the camera's. */
function discOf(game: Game, b: SoftBodyLike, off: V3, out: Float64Array): boolean {
  const cam = game.stage.camera;
  if (!cam) return false;
  const c = b.center, p = { x: c.x + off.x, y: c.y + off.y, z: c.z + off.z }, n = projectToNdc(cam, p);
  if (!n) return false;
  const rt = cameraRight(cam), R = b.restRadius, e = projectToNdc(cam, { x: p.x + rt.x * R, y: p.y + rt.y * R, z: p.z + rt.z * R });
  const vw = game.viewport.w, vh = game.viewport.h;
  out[0] = (n.x * 0.5 + 0.5) * vw; out[1] = (0.5 - n.y * 0.5) * vh; out[2] = e ? Math.abs((e.x - n.x) * 0.5 * vw) : 0;
  return true;
}
const disc = new Float64Array(3);
const ZERO: V3 = { x: 0, y: 0, z: 0 };

/** how far (px) a press at (x, y) is inside a squishy's forgiving disc (> 0 = it takes it), or -1 */
function nearScore(game: Game, b: SoftBodyLike, off: V3, x: number, y: number): number {
  if (!discOf(game, b, off, disc)) return -1;
  const R = Math.max(disc[2], NEAR_MIN) + NEAR_PX, d = Math.hypot(x - disc[0], y - disc[1]);
  return d < R ? R - d : -1;
}

/**
 * The forgiving grab for game.ts pickBody: a press that hit no squishy takes the one whose forgiving disc it lands deepest in: the ExtraBody, null for the play
 * squishy, undefined for none.
 */
export function nearBody(game: Game, x: number, y: number): ExtraBody | null | undefined {
  let best: ExtraBody | null | undefined, bs = 0;
  const s0 = nearScore(game, game.bodies.body, ZERO, x, y);
  if (s0 > bs) { bs = s0; best = null; }
  const xs = game.bodies.extras;
  for (let i = 0; i < xs.length; i++) { const s = nearScore(game, xs[i].body, xs[i].position, x, y); if (s > bs) { bs = s; best = xs[i]; } }
  return best;
}

/**
 * The forgiving hit test of the ACTIVE squishy (wraps the gesture host's): a miss inside its forgiving disc is tried again on the way to its middle (3/4, 1/2,
 * 1/4 of the way, then the middle), and the first hit stands.
 */
export function hitNear(host: { hitTest(x: number, y: number): BodyHit | null; bodyScreen(): { x: number; y: number; r: number } | null }, base: (x: number, y: number) => BodyHit | null, x: number, y: number): BodyHit | null {
  const c = host.bodyScreen();
  if (!c) return null;
  const R = Math.max(c.r, NEAR_MIN) + NEAR_PX;
  if (Math.hypot(x - c.x, y - c.y) >= R) return null;
  for (let k = 0.75; k >= -1e-9; k -= 0.25) { const h = base(c.x + (x - c.x) * k, c.y + (y - c.y) * k); if (h) return h; }
  return null;
}

/** what the second-finger carries need of the life host */
export interface HandsDeps {
  game: Game;
  /** carrying is on (a place; Home with two or more out) and the host is listening (no sheet, no ceremony) */
  live(): boolean;
  /** the squishies (wholes and pieces) out: their bodies and draw offsets, CAP rows */
  readonly cap: number;
  body(i: number): SoftBodyLike | null;
  off(i: number, out: V3): void;
  /** the carry's level plane for this body (later-life carryPoint), in its own space; null = none */
  point(x: number, y: number, through: V3, b: SoftBodyLike, off: V3, st: CarryPlane): V3 | null;
  report(e: unknown): void;
}
export interface Hands {
  /** a press: a SECOND finger (another pointer already holds a squishy) on a squishy nobody holds is this host's; true = taken */
  grab(id: number, x: number, y: number): boolean;
  drag(id: number, x: number, y: number): boolean;
  drop(id: number): boolean;
  holds(id: number): boolean;
  /** the body a second finger carries (the gesture host's plane must not take it), or null */
  carrying(b: SoftBodyLike): boolean;
  /** once a frame: a view that moved under a still finger asks the hand's target again */
  frame(): void;
  dropAll(): boolean;
}
const SLOP = 14;
/** a finger that has not moved more than STILL_PX for STILL_MS lets go of a still hand: set down, never thrown (src/input/gestures.ts has the same pair) */
const STILL_MS = 120, STILL_PX = 3;
/** (round 15, R15_FIX F3) ... and so does a finger slower than FLICK_V px per ms on the screen at the let go (gestures.ts has the same pair and the reason) */
const FLICK_V = 0.35, FLICK_TAU = 50;
const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createHands(d: HandsDeps): Hands {
  const N = 3;
  const on = new Uint8Array(N), pid = new Int32Array(N), who = new Int16Array(N), lifted = new Uint8Array(N), vtx = new Int32Array(N);
  const x0 = new Float32Array(N), y0 = new Float32Array(N), px = new Float32Array(N), py = new Float32Array(N);
  const mx = new Float32Array(N), my = new Float32Array(N), tm = new Float64Array(N);   // where and when the finger last moved (its still let go)
  const fv = new Float32Array(N), ft = new Float64Array(N), fx = new Float32Array(N), fy = new Float32Array(N);   // (round 15) the finger's own speed on the screen (px / ms, smoothed) and its last sample
  const thr: V3[] = [], st: CarryPlane[] = [], offs: V3[] = [];
  for (let j = 0; j < N; j++) { thr.push({ x: 0, y: 0, z: 0 }); st.push(carryPlane()); offs.push({ x: 0, y: 0, z: 0 }); }
  const bodyOf = (j: number): SoftBodyLike | null => (on[j] === 1 ? d.body(who[j]) : null);
  const slotOf = (id: number): number => { for (let j = 0; j < N; j++) if (on[j] === 1 && pid[j] === id) return j; return -1; };
  const held = (b: SoftBodyLike): boolean => { const m = b.metrics; return m.fingers > 0 || m.grabbed === true || m.carried === true; };
  function release(j: number): void {
    const b = bodyOf(j);
    on[j] = 0;
    if (b && lifted[j] === 1) { const t = nowMs(); try { b.grabRelease(HAND2_SLOT as 0 | 1, t - tm[j] >= STILL_MS || fv[j] * Math.exp(-(t - ft[j]) / FLICK_TAU) < FLICK_V); } catch (e) { d.report(e); } }
    lifted[j] = 0; st[j].b = null;
  }
  function aim(j: number): void {
    const b = bodyOf(j);
    if (!b) { on[j] = 0; return; }
    d.off(who[j], offs[j]);
    let t: V3 | null = null;
    try { t = d.point(px[j], py[j], thr[j], b, offs[j], st[j]); } catch (e) { d.report(e); }
    if (t) { try { b.grabMove(HAND2_SLOT, t); } catch (e) { d.report(e); } }
  }
  return {
    grab(id, x, y) {
      if (!d.live() || slotOf(id) >= 0) return false;
      let j = -1;
      for (let k = 0; k < N; k++) if (on[k] === 0) { j = k; break; }
      if (j < 0) return false;
      // another finger must hold a squishy already (else this press is the gesture machine's, as published)
      let any = false;
      for (let i = 0; i < d.cap && !any; i++) { const b = d.body(i); if (b && held(b)) any = true; }
      if (!any) return false;
      const cam = d.game.stage.camera;
      if (!cam) return false;
      try { cam.updateMatrixWorld(); } catch { /* a mock camera */ }
      const n = pxToNdc(x, y, d.game.viewport), r = cameraRay(cam, n.x, n.y);
      let bi = -1, bt = Infinity, hit: { point: V3; vertex: number } | null = null;
      const o: V3 = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < d.cap; i++) {
        const b = d.body(i);
        if (!b) continue;
        d.off(i, o);
        const h = raycastAt(b, r.origin, r.dir, o);
        if (h && h.t < bt) { bt = h.t; bi = i; hit = h; }
      }
      if (bi < 0) {
        // the forgiving grab: the nearest squishy within its margin, hit on the way to its middle
        let bs = 0;
        for (let i = 0; i < d.cap; i++) { const b = d.body(i); if (!b) continue; d.off(i, o); const s = nearScore(d.game, b, o, x, y); if (s > bs) { bs = s; bi = i; } }
        if (bi < 0) return false;
        const b = d.body(bi)!;
        d.off(bi, o);
        if (!discOf(d.game, b, o, disc)) return false;
        for (let k = 0.75; k >= -1e-9 && !hit; k -= 0.25) {
          const q = pxToNdc(disc[0] + (x - disc[0]) * k, disc[1] + (y - disc[1]) * k, d.game.viewport), rr = cameraRay(cam, q.x, q.y);
          hit = raycastAt(b, rr.origin, rr.dir, o);
        }
        if (!hit) return false;
      }
      const b = d.body(bi)!;
      if (held(b)) return false;   // (a squishy a finger is on already: the gesture machine's, as published: a second finger on it stretches it)
      on[j] = 1; pid[j] = id; who[j] = bi; lifted[j] = 0; vtx[j] = hit!.vertex;
      thr[j].x = hit!.point.x; thr[j].y = hit!.point.y; thr[j].z = hit!.point.z;
      x0[j] = x; y0[j] = y; px[j] = x; py[j] = y; st[j].b = null;
      mx[j] = x; my[j] = y; tm[j] = nowMs(); fv[j] = 0; fx[j] = x; fy[j] = y; ft[j] = tm[j];
      return true;
    },
    drag(id, x, y) {
      const j = slotOf(id);
      if (j < 0) return false;
      px[j] = x; py[j] = y;
      if (Math.hypot(x - mx[j], y - my[j]) > STILL_PX) { mx[j] = x; my[j] = y; tm[j] = nowMs(); }
      { const t = nowMs(), dt = t - ft[j]; if (dt > 0) { const k = Math.exp(-dt / FLICK_TAU); fv[j] = fv[j] * k + (Math.hypot(x - fx[j], y - fy[j]) / dt) * (1 - k); fx[j] = x; fy[j] = y; ft[j] = t; } }
      const b = bodyOf(j);
      if (!b) { on[j] = 0; return true; }
      if (lifted[j] === 0) {
        if (Math.hypot(x - x0[j], y - y0[j]) <= SLOP) return true;
        if (held(b)) { on[j] = 0; return true; }   // (another hand took it meanwhile)
        try { b.grab(HAND2_SLOT, vtx[j], thr[j]); lifted[j] = b.lift?.(HAND2_SLOT) === true ? 1 : 0; } catch (e) { d.report(e); }
        if (lifted[j] === 0) { try { b.grabRelease(HAND2_SLOT as 0 | 1); } catch { /* gone */ } on[j] = 0; return true; }
      }
      aim(j);
      return true;
    },
    drop(id) {
      const j = slotOf(id);
      if (j < 0) return false;
      release(j);
      return true;
    },
    holds: (id) => slotOf(id) >= 0,
    carrying(b) { for (let j = 0; j < N; j++) if (on[j] === 1 && lifted[j] === 1 && bodyOf(j) === b) return true; return false; },
    frame() { for (let j = 0; j < N; j++) if (on[j] === 1 && lifted[j] === 1) aim(j); },
    dropAll() { let any = false; for (let j = 0; j < N; j++) if (on[j] === 1) { any = true; release(j); } return any; },
  };
}

/** "Drag to carry", once ever: true when it should be shown now (and it is marked shown); a failing storage shows it once per session */
let tipDone = false;
export function carryTipDue(storage: StorageLike | null): boolean {
  if (tipDone) return false;
  tipDone = true;
  try { if (storage?.getItem(CARRY_TIP_KEY) === '1') return false; storage?.setItem(CARRY_TIP_KEY, '1'); } catch { /* storage refused: once this session */ }
  return true;
}
