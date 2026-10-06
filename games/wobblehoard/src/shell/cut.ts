// CUT & RECONNECT, the shell's side (_spec/CUT.md sections 1, 2, 4; FUN.md 1): the piece manager and its state machine.
//
//   * The squishy in your hands may be in pieces. Piece 0 is the FACE piece and is always the PLAY body (bodies.ts: the same identity,
//     genome and item, so the HUD, the history and the Hoard never see a piece); every other piece is an eyeless CHUNK, an extra body in the
//     play body's world space (ExtraBody.piece, drawn with AddBodyOpts.chunk). Pieces are never stored anywhere: a reload is whole again.
//   * A cut: a swipe (two CSS-px points) becomes the plane through the camera that contains it (CUT.md 1), in the bodies' world space; the
//     piece the swipe passes over most is cut. Limits (CUT.md 2.4): 6 pieces at med / high, 4 at low; no piece under 1/8 of the whole
//     (measureCut decides the sizes before anything moves). A refusal wobbles the piece and says why; nothing else changes.
//   * The neck (CUT.md 3, 4.2): NECK_S by family, every step body.setNeck(plane, t) + stage.setCutSeam(view, plane, t), audio
//     cut({ phase: 'start' }) at its start; held NECK_HOLD_S at t = 1 (physics: a longer hold creases); then the body is REPLACED by two
//     pieces built with createBody(genome, { piece }) at their lobes' centres, the face side by the eyes' anchor; stage.partPieces(a, b);
//     audio cut({ phase: 'separate', frac: the smaller piece's share of the WHOLE }) (NOTES_FOR_SHELL_CUT: no audio.strand for the parting);
//     a haptic tick.
//   * Reconnect (CUT.md 1): a piece touched by a finger (a press or a pull) that touches another piece for JOIN_HOLD_S, or is let go while
//     they touch, flows into it over JOIN_S: setBridge, the receiver setFrac up, the giver setFrac down and moveTo the receiver; then the
//     giver is removed, rejoin({ frac: merged share }), a haptic thump. The receiver is the face piece when it is one of the two, else the
//     larger. A piece flowing into another is a ghost (BodyManager.setGhost: no contact push, which would shove the receiver off across the
//     table). Reconnect all: every chunk into the face piece over JOIN_ALL_S, rejoin({ frac: 1, all: true }). When the last chunk is gone
//     the face piece is replaced by a fresh WHOLE body (createBody(genome)): whole again means exactly the original (CUT.md 1). The whole
//     squishy lives at the middle of the table: a face piece that ended up away from it first glides home (moveTo, up to HOME_MAX_S), then
//     the swap happens there (a whole body built off the middle would keep that spot as its home: the physics' mat corral holds it there).
//   * Leaving reconnects (CUT.md 2.2): game.ts calls reconnectAll(false) (instant) before a switch, a card preview, a ceremony, after the tab
//     was hidden over 60 s; the Hoard asks for the animated one when the stage stays visible. Cutting and reconnecting feed nothing to the
//     meter (rule 3): no SoftEvent is made here; touches on pieces reach collection.feed like any other (game.ts drains every body).
//   * Feature-detected (CUT.md 5): the tool exists only when the play body offers measureCut / setNeck / setFrac (the physics' piece build
//     comes with them); without setFrac / moveTo the joins are instant.
import type { CutPlane, PieceOpts, QualityTier, SoftBodyLike, SquishAudio, StageLike, TierName, V3 } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import { pitchRatio } from '../core/genome.ts';
import { familyOf, getSpecies } from '../data/catalog.ts';
import type { CameraLike } from '../input/camera.ts';
import { cameraPosition, cameraRay, pxToNdc, raycastAt } from '../input/camera.ts';
import type { Haptics } from '../input/haptics.ts';
import type { BodyManager, ExtraBody } from './bodies.ts';

/** Pieces at once by quality tier (CUT.md 2.4). */
export const MAX_PIECES: Readonly<Record<QualityTier, number>> = { low: 4, med: 6, high: 6 };
/** No piece smaller than this share of the whole (CUT.md 2.4; the physics clamps setFrac there too). */
export const PIECE_MIN = 1 / 8;
/** The neck (pinch) by material family (CUT.md 3): firm ones resist, plastic ones cut slow and sharp, the rest about 0.25 s. */
export const NECK_S: Readonly<Record<string, number>> = { firmsilicone: 0.4, popdome: 0.4, putty: 0.34, mochidough: 0.34, slowrise: 0.3, marshmallow: 0.3, stickystretch: 0.3, slimegoo: 0.3 };
export const NECK_DEFAULT_S = 0.25;
/** Held at t = 1 before the swap (the physics measured its neck at a 0.1 s hold; longer creases). */
export const NECK_HOLD_S = 0.1;
/** Two pieces held together this long (a finger on one of them) reconnect. */
export const JOIN_HOLD_S = 0.4;
export const JOIN_S = 0.5;
export const JOIN_ALL_S = 1.2;
/** After the last join, a face piece further than HOME_NEAR from the middle glides there first, for at most HOME_MAX_S. */
export const HOME_NEAR = 0.06;
export const HOME_MAX_S = 1.6;
/** A swipe shorter than this (CSS px) is not a cut. */
export const MIN_SWIPE_PX = 24;
/** Pieces touch when their centres are closer than this times the sum of their current radii. */
export const TOUCH_K = 1.08;

export type CutResult = 'cut' | 'short' | 'miss' | 'small' | 'limit' | 'busy' | 'unsupported';

export interface CutDeps {
  bodies: BodyManager;
  stage: StageLike;
  audio: SquishAudio;
  haptics: Haptics;
  createBody(g: Genome, opts?: { at?: V3; piece?: PieceOpts }): SoftBodyLike;
  quality(): QualityTier;
  calm(): boolean;
  gravity(): boolean;
  simTime(): number;
  viewport(): { w: number; h: number };
  /** the body the fingers act on now, and whether a finger or a pull is on it */
  activeBody(): SoftBodyLike;
  touching(): boolean;
  /** fingers off every body (a piece is about to be replaced or removed) */
  beforeChange(): void;
  /** put the squishies brought out of the Hoard back (a cut makes room for its pieces) */
  clearMat(): number;
  panOf(p: V3): number;
  say(text: string): void;
  report(e: unknown): void;
}

interface Piece { body: SoftBodyLike; chunk: boolean; frac: number; built: number }
type Anim =
  | { kind: 'neck'; p: Piece; plane: CutPlane; fa: number; faceA: boolean; t0: number; neckS: number; view: number | null }
  | { kind: 'join'; recv: Piece; giver: Piece; t0: number; dur: number }
  | { kind: 'all'; t0: number; dur: number }
  | { kind: 'home'; face: Piece; t0: number };

export interface Cutter {
  /** the physics offers the cut (measureCut, setNeck, setFrac on the play body) */
  readonly supported: boolean;
  /** pieces of the play squishy (1 = whole) */
  readonly pieces: number;
  /** each piece's share of the whole, the face piece first */
  fracs(): number[];
  /** a neck or a reconnect is playing */
  readonly busy: boolean;
  readonly maxPieces: number;
  /** a swipe over the canvas, CSS px from (x0, y0) to (x1, y1) */
  swipe(x0: number, y0: number, x1: number, y1: number): CutResult;
  /** the accessible cut: a vertical cut through the middle of the largest piece as the camera sees it (CUT.md 2.6) */
  splitInTwo(): CutResult;
  /** every piece back into the face piece: animated over JOIN_ALL_S, or at once (leaving). false = nothing to do */
  reconnectAll(animated: boolean): boolean;
  /** per sim step: the neck and join timelines, the touch-to-join detection */
  update(dt: number): void;
  isPiece(b: SoftBodyLike): boolean;
  dispose(): void;
}

const smooth = (x: number): number => { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t); };
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a: V3): V3 | null => { const l = Math.hypot(a.x, a.y, a.z); return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : null; };
const rotate = (q: { x: number; y: number; z: number; w: number }, v: V3): V3 => {
  // v + 2 q_xyz x (q_xyz x v + w v)
  const tx = q.y * v.z - q.z * v.y + q.w * v.x, ty = q.z * v.x - q.x * v.z + q.w * v.y, tz = q.x * v.y - q.y * v.x + q.w * v.z;
  return { x: v.x + 2 * (q.y * tz - q.z * ty), y: v.y + 2 * (q.z * tx - q.x * tz), z: v.z + 2 * (q.x * ty - q.y * tx) };
};

/** Where the eyes sit (CUT.md 1 "the eyes' anchor point"): the front of the body, a little above its middle, carried by its rotation. */
export function faceAnchor(b: SoftBodyLike): V3 {
  const f = b.frame ?? { x: 0, y: 0, z: 0, w: 1 };
  const local = rotate(f, { x: 0, y: 0.08 * b.restRadius, z: 0.9 * b.restRadius });
  return { x: b.center.x + local.x, y: b.center.y + local.y, z: b.center.z + local.z };
}

/** Centre of the particles on each side of the plane (the lobes; positions are world space, shared with the plane). */
export function lobeCentres(b: SoftBodyLike, plane: CutPlane): { a: V3; b: V3 } | null {
  const P = b.positions, n = b.vertexCount;
  let ax = 0, ay = 0, az = 0, na = 0, bx = 0, by = 0, bz = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if ((x - plane.point.x) * plane.normal.x + (y - plane.point.y) * plane.normal.y + (z - plane.point.z) * plane.normal.z >= 0) { ax += x; ay += y; az += z; na++; }
    else { bx += x; by += y; bz += z; nb++; }
  }
  if (!na || !nb) return null;
  return { a: { x: ax / na, y: ay / na, z: az / na }, b: { x: bx / nb, y: by / nb, z: bz / nb } };
}

export function createCutter(d: CutDeps): Cutter {
  let pieces: Piece[] = [];   // empty = whole (the play body alone)
  let anim: Anim | null = null;
  let contact: { a: Piece; b: Piece; since: number } | null = null;
  let wobbleUntil = -1, wobbling: SoftBodyLike | null = null;
  const genome = (): Genome => d.bodies.identity.genome;
  const tier = (): TierName => d.bodies.identity.tier;
  const family = (): string => { try { const g = genome(); return getSpecies(g.species) ? familyOf(g.species) : 'jellygel'; } catch { return 'jellygel'; } };
  const pitch = (): number => { try { return pitchRatio(genome()); } catch { return 1; } };
  const supported = (): boolean => {
    const b = d.bodies.body;
    return typeof b.measureCut === 'function' && typeof b.setNeck === 'function' && typeof b.setFrac === 'function' && typeof d.stage.addBody === 'function';
  };
  const max = (): number => MAX_PIECES[d.quality()] ?? 4;
  const list = (): Piece[] => (pieces.length ? pieces : [{ body: d.bodies.body, chunk: false, frac: 1, built: 1 }]);
  const extraOf = (b: SoftBodyLike): ExtraBody | undefined => d.bodies.extras.find((x) => x.body === b && x.piece);
  const radius = (p: Piece): number => p.body.restRadius * Math.cbrt(Math.max(PIECE_MIN, (p.body.frac ?? p.frac)) / Math.max(PIECE_MIN, p.built));

  function wobble(b: SoftBodyLike): void {
    try {
      if (typeof b.tremble === 'function') { b.tremble(0.35); wobbling = b; wobbleUntil = d.simTime() + 0.28; }
      else b.nudge({ x: 0, y: 0.5, z: 0 });
    } catch (e) { d.report(e); }
  }

  function startCut(p: Piece, plane: CutPlane): CutResult {
    let fa: number | null = null;
    try { fa = p.body.measureCut!(plane); } catch (e) { d.report(e); fa = null; }
    if (fa === null || !(fa > 0) || !(fa < 1)) return 'miss';
    const small = Math.min(fa, 1 - fa) * p.frac;
    if (small < PIECE_MIN - 1e-6) { wobble(p.body); d.say(p.frac < 2 * PIECE_MIN + 1e-6 ? "That piece is as small as it gets." : 'Too small to cut there. Try nearer the middle.'); return 'small'; }
    if (list().length + 1 > max()) { wobble(p.body); d.say("That's as many pieces as it can make."); return 'limit'; }
    if (!pieces.length) {
      const n = d.clearMat();
      if (n > 0) d.say(n === 1 ? 'The other squishy went back on the shelf.' : `The other ${n} went back on the shelf.`);
      pieces = [p];   // the whole squishy is piece 0 from now on (p is list()'s record of the play body)
    }
    const neckS = NECK_S[family()] ?? NECK_DEFAULT_S;
    // the face side is judged NOW, on the body as it stands: at t = 1 the necked peanut's best-fit rotation can turn the eyes' anchor
    // onto the other lobe (measured in the browser: the face went to the wrong side)
    let faceA = false;
    if (!p.chunk) {
      const sd = dot(sub(faceAnchor(p.body), plane.point), plane.normal);
      faceA = Math.abs(sd) < 0.03 * p.body.restRadius ? fa >= 0.5 : sd >= 0;
    }
    anim = { kind: 'neck', p, plane, fa, faceA, t0: d.simTime(), neckS, view: d.bodies.viewIdOf(p.body) };
    try { d.audio.cut?.({ phase: 'start', frac: small, neckS, family: family(), pan: d.panOf(p.body.center), calm: d.calm(), pitch: pitch() }); } catch (e) { d.report(e); }
    return 'cut';
  }

  /** t = 1 held: replace the cut body by its two pieces */
  function part(a: Extract<Anim, { kind: 'neck' }>): void {
    const p = a.p, B = p.body, g = genome(), plane = a.plane;
    try { B.setNeck?.(null, 0); } catch (e) { d.report(e); }
    try { if (a.view !== null) d.stage.setCutSeam?.(a.view, null, 0); } catch (e) { d.report(e); }
    const fA = p.frac * a.fa, fB = p.frac * (1 - a.fa);
    const lc = lobeCentres(B, plane) ?? { a: B.center, b: B.center };
    const n = plane.normal;
    // the face goes with the side that held the eyes' anchor when the cut began (the larger side when the cut ran through it)
    const faceA = a.faceA;
    const push = 0.35;
    let pa: SoftBodyLike, pb: SoftBodyLike;
    try {
      pa = d.createBody(g, { piece: { frac: fA, chunk: !(faceA && !p.chunk), cutNormal: { x: -n.x, y: -n.y, z: -n.z }, at: lc.a, vel: { x: n.x * push, y: 0, z: n.z * push } } });
      pb = d.createBody(g, { piece: { frac: fB, chunk: !(!faceA && !p.chunk), cutNormal: { x: n.x, y: n.y, z: n.z }, at: lc.b, vel: { x: -n.x * push, y: 0, z: -n.z * push } } });
    } catch (e) {
      // the physics could not build a piece: nothing was replaced, the squishy stays as it was
      d.report(e);
      if (pieces.length === 1) pieces = [];
      return;
    }
    for (const b of [pa, pb]) { try { b.gravity = d.gravity(); } catch { /* optional */ } }
    d.beforeChange();
    const A: Piece = { body: pa, chunk: !(faceA && !p.chunk), frac: fA, built: fA };
    const Bp: Piece = { body: pb, chunk: !(!faceA && !p.chunk), frac: fB, built: fB };
    const id = d.bodies.identity;
    if (!p.chunk) {
      // the face piece becomes the play body (same identity: the HUD, history and Hoard see the same squishy), the other side a chunk
      const face = faceA ? A : Bp, chunk = faceA ? Bp : A;
      d.bodies.swapTo(g, { body: face.body, itemId: id.itemId, nickname: id.nickname, silent: true });
      d.bodies.addExtra(chunk.body, g, { tier: tier(), shared: true, piece: true, itemId: null });
      pieces = [face, chunk, ...pieces.filter((x) => x !== p)];
    } else {
      const x = extraOf(B);
      if (x) d.bodies.removeExtra(x.id);
      d.bodies.addExtra(pa, g, { tier: tier(), shared: true, piece: true, itemId: null });
      d.bodies.addExtra(pb, g, { tier: tier(), shared: true, piece: true, itemId: null });
      pieces = pieces.flatMap((q) => (q === p ? [A, Bp] : [q]));
    }
    try { const ia = d.bodies.viewIdOf(pa), ib = d.bodies.viewIdOf(pb); if (ia !== null && ib !== null) d.stage.partPieces?.(ia, ib); } catch (e) { d.report(e); }
    try { d.audio.cut?.({ phase: 'separate', frac: Math.min(fA, fB), family: family(), pan: d.panOf(B.center), calm: d.calm(), pitch: pitch() }); } catch (e) { d.report(e); }
    try { d.haptics.poke(); } catch { /* optional */ }
    d.say(`Cut into ${pieces.length} pieces.`);
  }

  /** the giver is gone into the receiver */
  function joined(recv: Piece, giver: Piece, all: boolean): void {
    const v = d.bodies.viewIdOf(recv.body), w = d.bodies.viewIdOf(giver.body);
    try { if (v !== null && w !== null) d.stage.setBridge?.(v, w, 0); } catch (e) { d.report(e); }
    try { giver.body.moveTo?.(null); } catch { /* optional */ }
    const x = extraOf(giver.body);
    d.beforeChange();
    if (x) d.bodies.removeExtra(x.id);
    recv.frac = Math.min(1, recv.frac + giver.frac);
    pieces = pieces.filter((q) => q !== giver);
    if (!all) {
      try { d.audio.rejoin?.({ frac: recv.frac, pan: d.panOf(recv.body.center), calm: d.calm(), pitch: pitch() }); } catch (e) { d.report(e); }
      try { d.haptics.release(); } catch { /* optional */ }
    }
    if (pieces.length <= 1) whole(!all, true);
    else if (!all) d.say(`Joined. ${pieces.length} pieces.`);
  }

  /** the last chunk is gone: the face piece becomes the exact original squishy again, at the middle of the table (gliding there first when
   *  `glide` and it is away from it; otherwise the swap puts it there at once) */
  function whole(say: boolean, glide: boolean): void {
    const face = pieces[0];
    contact = null;
    if (say) d.say('Whole again.');
    if (!face || (face.body === d.bodies.body && face.frac >= 1 && face.built >= 1)) { pieces = []; return; }
    const c = face.body.center;
    if (glide && typeof face.body.moveTo === 'function' && Math.hypot(c.x, c.z) > HOME_NEAR) {
      pieces = [face];
      face.frac = 1;
      try { face.body.moveTo({ x: 0, y: c.y, z: 0 }, 1.2); } catch (e) { d.report(e); swapWhole(face); return; }
      anim = { kind: 'home', face, t0: d.simTime() };
      return;
    }
    swapWhole(face);
  }

  function swapWhole(face: Piece): void {
    const g = genome(), id = d.bodies.identity;
    pieces = [];
    try { face.body.moveTo?.(null); } catch { /* optional */ }
    let b: SoftBodyLike;
    try { b = d.createBody(g); }
    catch (e) { d.report(e); try { face.body.setFrac?.(1, 0); } catch { /* optional */ } return; }
    d.beforeChange();
    d.bodies.swapTo(g, { body: b, itemId: id.itemId, nickname: id.nickname, silent: true });
  }

  function startJoin(a: Piece, b: Piece): void {
    const aFace = a === pieces[0], bFace = b === pieces[0];
    const recv = aFace ? a : bFace ? b : a.frac >= b.frac ? a : b;
    const giver = recv === a ? b : a;
    contact = null;
    if (typeof recv.body.setFrac !== 'function') { joined(recv, giver, false); return; }
    try { recv.body.setFrac(Math.min(1, recv.frac + giver.frac), JOIN_S); giver.body.setFrac?.(PIECE_MIN, JOIN_S); } catch (e) { d.report(e); }
    d.bodies.setGhost(giver.body, true);   // it flows INTO the receiver: no contact push between them (it would shove the receiver away)
    anim = { kind: 'join', recv, giver, t0: d.simTime(), dur: JOIN_S };
  }

  function finishAll(glide: boolean): void {
    const face = pieces[0];
    const chunks = pieces.slice(1);
    for (const c of chunks) {
      const v = d.bodies.viewIdOf(face.body), w = d.bodies.viewIdOf(c.body);
      try { if (v !== null && w !== null) d.stage.setBridge?.(v, w, 0); } catch (e) { d.report(e); }
      try { c.body.moveTo?.(null); } catch { /* optional */ }
    }
    d.beforeChange();
    for (const c of chunks) { const x = extraOf(c.body); if (x) d.bodies.removeExtra(x.id); }
    pieces = [face];
    face.frac = 1;
    whole(false, glide);
  }

  /** stop whatever plays, leaving the bodies in a state the instant reconnect can take over */
  function abortAnim(): void {
    const a = anim;
    anim = null;
    if (!a) return;
    if (a.kind === 'neck') {
      try { a.p.body.setNeck?.(null, 0); } catch (e) { d.report(e); }
      try { if (a.view !== null) d.stage.setCutSeam?.(a.view, null, 0); } catch (e) { d.report(e); }
      if (pieces.length === 1) pieces = [];   // the first cut never happened
    }
    if (a.kind === 'join') d.bodies.setGhost(a.giver.body, false);
    if (a.kind === 'all') for (const c of pieces.slice(1)) d.bodies.setGhost(c.body, false);
    if (a.kind === 'home') swapWhole(a.face);   // whole at once, at the middle
  }

  const cutter: Cutter = {
    get supported() { return supported(); },
    get pieces() { return list().length; },
    fracs: () => list().map((p) => p.frac),
    get busy() { return anim !== null; },
    get maxPieces() { return max(); },
    swipe(x0, y0, x1, y1) {
      if (!supported()) return 'unsupported';
      if (anim) return 'busy';
      if (!(Math.hypot(x1 - x0, y1 - y0) >= MIN_SWIPE_PX)) return 'short';
      const cam = d.stage.camera as unknown as CameraLike;
      if (!cam) return 'miss';
      try { cam.updateMatrixWorld?.(); } catch { /* a mock camera */ }
      const vp = d.viewport();
      const n0 = pxToNdc(x0, y0, vp), n1 = pxToNdc(x1, y1, vp);
      const r0 = cameraRay(cam, n0.x, n0.y), r1 = cameraRay(cam, n1.x, n1.y);
      const normal = unit(cross(r0.dir, r1.dir));
      if (!normal) return 'miss';
      const plane: CutPlane = { point: cameraPosition(cam), normal };
      // the piece the swipe passes over most (samples along it)
      const ps = list();
      const hits = ps.map(() => 0);
      const K = 13;
      for (let k = 0; k < K; k++) {
        const f = k / (K - 1), n = pxToNdc(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, vp), r = cameraRay(cam, n.x, n.y);
        let best = -1, bestT = Infinity;
        ps.forEach((p, i) => { try { const h = raycastAt(p.body, r.origin, r.dir, { x: 0, y: 0, z: 0 }); if (h && h.t < bestT) { bestT = h.t; best = i; } } catch { /* a mock */ } });
        if (best >= 0) hits[best]++;
      }
      let target = -1;
      hits.forEach((h, i) => { if (h > 0 && (target < 0 || h > hits[target])) target = i; });
      if (target < 0) return 'miss';
      return startCut(ps[target], plane);
    },
    splitInTwo() {
      if (!supported()) return 'unsupported';
      if (anim) return 'busy';
      const ps = list();
      let p = ps[0];
      for (const q of ps) if (q.frac > p.frac + 1e-9) p = q;
      const cam = d.stage.camera as unknown as CameraLike;
      try { cam.updateMatrixWorld?.(); } catch { /* a mock camera */ }
      const c = p.body.center;
      // the vertical plane through the camera and the piece's centre as the camera sees it: the camera's up direction and the view ray
      const eye = cameraPosition(cam);
      const view = unit(sub(c, eye));
      const w = cam.matrixWorld.elements;
      const up = unit({ x: w[4], y: w[5], z: w[6] }) ?? { x: 0, y: 1, z: 0 };
      const normal = view ? unit(cross(view, up)) : null;
      if (!normal) return 'miss';
      return startCut(p, { point: { x: c.x, y: c.y, z: c.z }, normal });
    },
    reconnectAll(animated) {
      if (!pieces.length && !anim) return false;
      abortAnim();
      if (pieces.length <= 1) { pieces = []; return false; }
      contact = null;
      const face = pieces[0];
      const canAnimate = animated && typeof face.body.setFrac === 'function';
      if (!canAnimate) { finishAll(false); return true; }
      try { face.body.setFrac!(1, JOIN_ALL_S); } catch (e) { d.report(e); }
      for (const c of pieces.slice(1)) { try { c.body.setFrac?.(PIECE_MIN, JOIN_ALL_S); } catch (e) { d.report(e); } d.bodies.setGhost(c.body, true); }
      anim = { kind: 'all', t0: d.simTime(), dur: JOIN_ALL_S };
      return true;
    },
    update() {
      const t = d.simTime();
      if (wobbling && t >= wobbleUntil) { try { wobbling.tremble?.(0); } catch { /* optional */ } wobbling = null; }
      const a = anim;
      if (a && a.kind === 'neck') {
        const k = smooth((t - a.t0) / a.neckS);
        try { a.p.body.setNeck!(a.plane, k); } catch (e) { d.report(e); }
        try { if (a.view !== null) d.stage.setCutSeam?.(a.view, a.plane, k); } catch (e) { d.report(e); }
        if (t - a.t0 >= a.neckS + NECK_HOLD_S) { anim = null; part(a); }
        return;
      }
      if (a && a.kind === 'join') {
        const k = smooth((t - a.t0) / a.dur);
        const v = d.bodies.viewIdOf(a.recv.body), w = d.bodies.viewIdOf(a.giver.body);
        try { if (v !== null && w !== null) d.stage.setBridge?.(v, w, k); } catch (e) { d.report(e); }
        try { a.giver.body.moveTo?.(a.recv.body.center, 1.4); } catch { /* optional */ }
        if (t - a.t0 >= a.dur) { anim = null; joined(a.recv, a.giver, false); }
        return;
      }
      if (a && a.kind === 'all') {
        const k = smooth((t - a.t0) / a.dur);
        const face = pieces[0];
        for (const c of pieces.slice(1)) {
          const v = d.bodies.viewIdOf(face.body), w = d.bodies.viewIdOf(c.body);
          try { if (v !== null && w !== null) d.stage.setBridge?.(v, w, k); } catch (e) { d.report(e); }
          try { c.body.moveTo?.(face.body.center, 1.6); } catch { /* optional */ }
        }
        if (t - a.t0 >= a.dur) {
          anim = null;
          finishAll(true);
          try { d.audio.rejoin?.({ frac: 1, all: true, pan: d.panOf(d.bodies.body.center), calm: d.calm(), pitch: pitch() }); } catch (e) { d.report(e); }
          try { d.haptics.release(); } catch { /* optional */ }
          d.say('Whole again.');
        }
        return;
      }
      if (a && a.kind === 'home') {
        const c = a.face.body.center;
        if (Math.hypot(c.x, c.z) <= HOME_NEAR * 0.5 || t - a.t0 >= HOME_MAX_S) { anim = null; swapWhole(a.face); }
        return;
      }
      // touch-to-join: a piece under a finger that touches another piece for JOIN_HOLD_S, or is let go while touching
      if (pieces.length < 2) { contact = null; return; }
      const touching = d.touching();
      const act = d.activeBody();
      const P = pieces.find((p) => p.body === act) ?? null;
      if (touching && P) {
        let Q: Piece | null = null, bestD = Infinity;
        for (const q of pieces) {
          if (q === P) continue;
          const dd = Math.hypot(P.body.center.x - q.body.center.x, P.body.center.y - q.body.center.y, P.body.center.z - q.body.center.z);
          if (dd < TOUCH_K * (radius(P) + radius(q)) && dd < bestD) { bestD = dd; Q = q; }
        }
        if (Q) {
          if (!contact || contact.a !== P || contact.b !== Q) contact = { a: P, b: Q, since: t };
          else if (t - contact.since >= JOIN_HOLD_S) { d.beforeChange(); startJoin(P, Q); }
        } else contact = null;
        return;
      }
      // let go while touching
      if (!touching && contact) {
        const c = contact;
        const dd = Math.hypot(c.a.body.center.x - c.b.body.center.x, c.a.body.center.y - c.b.body.center.y, c.a.body.center.z - c.b.body.center.z);
        contact = null;
        if (pieces.includes(c.a) && pieces.includes(c.b) && dd < TOUCH_K * (radius(c.a) + radius(c.b))) startJoin(c.a, c.b);
      }
    },
    isPiece: (b) => pieces.some((p) => p.body === b),
    dispose() { abortAnim(); pieces = []; contact = null; },
  };
  return cutter;
}
