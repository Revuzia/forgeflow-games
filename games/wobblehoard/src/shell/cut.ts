// CUT & RECONNECT, the shell's side (_spec/CUT2.md 3, 6, 7; _spec/CUT_MINIS.md; task S2 first half): the piece manager and its state machine.
//
//   * TWO CUT STYLES (Cutter.style, CUT_A.md SR1). CLEAN (the true cut, the default): every piece is the real part of the squishy on its side of the plane, with a flat
//     cut face; the physics plans the cut on the REST mesh (planCut), builds both pieces in time slices while the neck forms (prepareCut) and the swap only places them
//     (placeAt: flush, in the parent's pose). MINIS: every piece is a complete smaller copy of the squishy (the species scaled by cbrt of its share, its own face), built with
//     the legacy scaled-whole path ({ frac, chunk: false }, no region); the share of a cut is measureCut's, on the deformed mesh. A physics without planCut / prepareCut /
//     placeAt (an old one, or a test mock) cuts Minis-style whatever the style says (the Cut tool never disappears). The style is locked while the squishy is cut.
//   * Pieces are peers: no piece has a face "role". Piece 0 is the ANCHOR (the larger child of the last cut of the anchor; ties: side A): it is the PLAY body (bodies.ts: same
//     identity, genome and item, so the HUD, the history and the Hoard never see a piece); every other piece is an extra body in the play body's world space
//     (ExtraBody.piece). Pieces are never stored anywhere: a reload is whole again. MAX_PIECES_CLEAN is 2 in this build (milestone A); Minis keeps the old limits (6 at
//     med / high, 4 at low) and no piece under 1/8.
//   * The cut tree (cutRegion.ts) is the shell's truth for the clean style: each piece is one leaf (one convex cell); a join of twins takes the cut away again.
//   * A cut: a swipe (two CSS-px points) becomes the plane through the camera that contains it, in the bodies' world space; the piece the swipe passes over most is cut.
//     Split in two cuts along the squishy's OWN line between the eyes (first press) or the camera-relative median plane (later presses). Refusals (small, limit, thin,
//     loose) wobble the piece, say why and change nothing else.
//   * The neck (CUT.md 3, CUT2.md 6.3): NECK_S by family, every step body.setNeck(plane, t, depth) + stage.setCutSeam(view, plane, t, ends) (the plane is recomputed from the
//     LATCHED rest plane), audio cut({ phase: 'start' }) at its start, prepareCut(3) until the pieces are built; held NECK_HOLD_S at t = 1; then the body is REPLACED by two
//     pieces: placed flush by placeAt in the parent's pose with the parent's mean side velocities (less what the neck added), one common lift, partPieces, audio
//     cut({ phase: 'separate' }), a haptic tick, and the scripted parting (a growing gap, open loop; a near-level cut parts by a small plop instead).
//   * Reconnect (CUT.md 1): a piece a finger DRAGS into another (a pull whose hand moved DRAG_TOWARD_K of its radius toward the other) whose SKIN touches the other's
//     (TOUCH_GAP) for JOIN_HOLD_S, or is let go while they touch, flows into it over JOIN_S (setBridge). Twins of the clean style meet MATED (the giver stops at the place where
//     its cut face lies on the other's) and the pair glides home and is replaced by a FRESH whole body (createBody(genome)): whole again means exactly the original. Minis
//     joins flow into the receiver (the larger piece; setFrac up and down, a ghost) and become one bigger mini. Reconnect all joins every piece.
//   * Leaving reconnects (CUT.md 2.2): game.ts calls reconnectAll(false) (instant) before a switch, a card preview, a ceremony, after the tab was hidden over 60 s.
//     Cutting and reconnecting feed nothing to the meter (rule 3): no SoftEvent is made here.
//   * Feature-detected (CUT.md 5): the tool exists only when the play body offers measureCut / setNeck / setFrac.
import type { CutPlan, CutPlane, PieceOpts, QualityTier, Quat, SoftBodyLike, SquishAudio, StageLike, TierName, V3 } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import { pitchRatio } from '../core/genome.ts';
import { familyOf, getSpecies } from '../data/catalog.ts';
import type { CameraLike } from '../input/camera.ts';
import { cameraPosition, cameraRay, pxToNdc, raycastAt } from '../input/camera.ts';
import type { Haptics } from '../input/haptics.ts';
import type { BodyManager, ExtraBody } from './bodies.ts';
import * as T from './cutText.ts';
import type { CutStyle } from './cutText.ts';
import { createCutTree, cutPiece, group, joinGroup, planeById, regionOf, rollbackCut } from './cutRegion.ts';
import type { CutNode } from './cutRegion.ts';

export type { CutStyle } from './cutText.ts';

/** Pieces at once by quality tier for MINIS (CUT.md 2.4). The clean style has MAX_PIECES_CLEAN. */
export const MAX_PIECES: Readonly<Record<QualityTier, number>> = { low: 4, med: 6, high: 6 };
/** Pieces at once in the clean style: 2 in this build (milestone A, CUT_A.md); the true cut's full limit is the MAX_PIECES record above (CUT2.md 3.2). */
export const MAX_PIECES_CLEAN = 2;
/** No piece smaller than this share of the whole (CUT.md 2.4), within PIECE_TOL (the physics clamps at FRAC_MIN 0.124, so an exact half of a quarter is legal). */
export const PIECE_MIN = 1 / 8;
export const PIECE_TOL = 1e-4;
/** A cut whose smaller part has an aspect (sqrt of the covariance eigenvalue ratio) under this is refused as too thin (CUT2.md 6.2; the single-plane minimum measured is 0.172). */
export const ASPECT_MIN = 0.08;
/** The neck (pinch) by material family (CUT.md 3): firm ones resist, plastic ones cut slow and sharp, the rest about 0.25 s. */
export const NECK_S: Readonly<Record<string, number>> = { firmsilicone: 0.4, popdome: 0.4, putty: 0.34, mochidough: 0.34, slowrise: 0.3, marshmallow: 0.3, stickystretch: 0.3, slimegoo: 0.3 };
export const NECK_DEFAULT_S = 0.25;
/** How deep the pinch goes by family (CUT2.md 11; starting values, P4 fits them): the swap replaces a rounded, swollen, necked body by flat-faced halves, so a shallow pinch jumps less. */
export const NECK_DEPTH: Readonly<Record<string, number>> = { jellygel: 0.35, gummy: 0.35, waterfill: 0.35, stickystretch: 0.9, slimegoo: 0.9, putty: 0.2, mochidough: 0.45, slowrise: 0.2, marshmallow: 0.5, firmsilicone: 0.35, popdome: 0.35, beadsqueeze: 0.35 };
export const NECK_DEPTH_DEFAULT = 0.35;
/** Held at t = 1 before the swap (physics checkpoint 47: swap within about 0.1 s of t = 1; held a second, 12 of 100 bodies crease). */
export const NECK_HOLD_S = 0.08;
/** ... extended by at most this while the pieces are still being built (CUT2.md 6.3); after it the swap builds them itself. */
export const NECK_HOLD_EXTRA_S = 0.15;
/** The scripted parting (CUT2.md 6.5): the gap G in metres at a squishy of radius 0.5 and the time PART_S it takes, by family. */
export const PART_GAP: Readonly<Record<string, number>> = { stickystretch: 0.16, slimegoo: 0.16, putty: 0.10, mochidough: 0.10, slowrise: 0.10, marshmallow: 0.10 };
export const PART_GAP_DEFAULT = 0.06;
export const PART_S: Readonly<Record<string, number>> = { stickystretch: 0.45, slimegoo: 0.45, putty: 0.45, mochidough: 0.45 };
export const PART_S_DEFAULT = 0.30;
/** a cut plane flatter than this (|n.y| >= LEVEL_NY, a slope under 41 degrees) is a near-level cut: its pieces are stacked faces that do not slide; the upper one is dropped from a small height instead (PLOP_MAX).
 *  Measured on the real SoftBody (CUT-B leg 2, 12 families, horizontal swipes through, above and below the middle, both directions; the 16 degree slope of the default camera): the stack stays within 0.01 to 0.09 m in 4 s. Holding
 *  the pair's relative offset with moveTo for 1 to 2 s (a symmetric grip released with a taper) was tried and REVERTED: it only delays the slow slide of planes steeper than 35 degrees (wisplet 0.027 -> 0.115 m between 2 s and 3 s). Moving
 *  the threshold made steeper planes worse (0.85: capnap 0.39 m, boingle 0.27 m on a 38 degree plane). */
export const LEVEL_NY = 0.75;
/** the drop of the upper piece of a near-level cut: 0.05 m landed at 0.99 m/s (capnap rebounded to 1.29 m/s, above the X13 bar of 1.2) and sank 2 to 4 cm into the lower piece; 0.03 m lands at 0.77 m/s (capnap 1.16, boingle 0.71, dollop 0.72, twangle 0.72) and rests with the stack within 1 cm of flush */
export const PLOP_MAX = 0.03;
/** Two pieces held together this long (a finger on one of them) reconnect. */
export const JOIN_HOLD_S = 0.4;
/** A join (drag one piece into another) and Reconnect all (about 1.2 s, CUT.md 1). Each runs in two parts (flowOf): the giver is first held at a
 *  small SURFACE gap from the receiver for BRIDGE_HOLD_S while the glowing neck of stage.setBridge is on show between them, then it flows in. */
export const JOIN_S = 0.8;
export const JOIN_ALL_S = 1.2;
export const BRIDGE_HOLD_S = 0.3;
/** the held gap, as a share of the smaller piece's radius */
export const BRIDGE_GAP_K = 0.3;
/** the glowing neck is drawn while the skins are within this share of the smaller piece's radius (stage.setBridge is told 0 beyond it) */
export const BRIDGE_REACH_K = 1.5;
/** After the last join, a pair or piece further than HOME_NEAR from the middle glides there first, for at most HOME_MAX_S. */
export const HOME_NEAR = 0.06;
export const HOME_MAX_S = 1.6;
/** A swipe shorter than this (CSS px) is not a cut. */
export const MIN_SWIPE_PX = 24;
/** Two pieces TOUCH when the gap between their skins (along the line between their centres) is under this (m). */
export const TOUCH_GAP = 0.03;
/** ... and a contact that already runs is kept while the skins stay within this (m): soft bodies pressed together rebound and part by a few centimetres every few frames */
export const TOUCH_KEEP_GAP = 0.09;
/** ... and the finger must be DRAGGING the piece into the other (CUT.md 1): its pull must have moved the hand at least this share of the piece's radius toward the other piece. */
export const DRAG_TOWARD_K = 0.25;
/** Split in two, first press: the eye-midline plane is used when its smaller share is in this range, else the median plane along the same normal (CUT2.md 6.6). */
export const EYE_SHARE_MIN = 0.40;
export const EYE_SHARE_MAX = 0.60;
/** later presses: the vertical candidate with the best aspect, preferring the smaller turn unless the best beats it by more than this */
export const CANDIDATE_MARGIN = 0.03;

export type CutResult = 'cut' | 'short' | 'miss' | 'small' | 'limit' | 'thin' | 'loose' | 'busy' | 'unsupported';

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
  /** the drag of the finger that holds a grab on the active body (hand now less hand at the start, world space), written into `out`; false = no finger pulls */
  drag(out: V3): boolean;
  /** fingers off every body (a piece is about to be replaced or removed) */
  beforeChange(): void;
  /** put the squishies brought out of the Hoard back (a cut makes room for its pieces) */
  clearMat(): number;
  panOf(p: V3): number;
  say(text: string): void;
  report(e: unknown): void;
  /** node and test mode: the neck builds a fixed number of stages per step with no time budget, so the swap frame is the same on every machine (CUT2.md 6.3).
   *  Default: true when there is no `window` (plain node). */
  deterministic?: boolean;
  /** tests: the piece limit of the clean style (default MAX_PIECES_CLEAN, 2 in this build) */
  maxClean?: number;
}

/** One piece: its body, its leaf of the cut tree (the clean style; null in Minis), its share of the whole and the share it was built at */
interface Piece { body: SoftBodyLike; leaf: CutNode | null; frac: number; built: number }
/** how a giver flows into its receiver: along the unit line u from the base point (the receiver's centre, plus `m` when the pair meets mated) at distance D(t): d0 at the start, dh while the bridge is held, then 0 */
interface Flow { u: V3; d0: number; dh: number; ta: number; m: V3 | null }
interface NeckAnim {
  kind: 'neck'; p: Piece; plane: CutPlane; fa: number; t0: number; neckS: number; depth: number; view: number | null; button: boolean;
  /** the clean style: the plan, the tree node being cut and its kids, the plane id, the mean velocity of the body at the neck start, whether the pieces are built */
  plan: CutPlan | null; node: CutNode | null; kids: [CutNode, CutNode] | null; cutId: number; v0: V3; ready: boolean;
  /** the two pieces as bodies, constructed one per neck step once the physics has built them (their meshes are cached): the swap frame then only places them */
  pre: { a: SoftBodyLike | null; b: SoftBodyLike | null };
  from: V3 | null; to: V3 | null; first: boolean;
}
type Anim =
  | NeckAnim
  | { kind: 'join'; recv: Piece; giver: Piece; t0: number; dur: number; flow: Flow }
  | { kind: 'all'; t0: number; dur: number; recv: Piece; flows: Map<Piece, Flow> }
  | { kind: 'home'; face: Piece; others: Piece[]; t0: number };
/** the scripted parting of a fresh pair (CUT2.md 6.5) */
interface Parting { a: Piece; b: Piece; ax: number; az: number; bx: number; bz: number; ay: number; by: number; s: V3; G: number; dur: number; t0: number; mode: 'slide' | 'float' }

export interface Cutter {
  /** the physics offers the cut (measureCut, setNeck, setFrac on the play body) */
  readonly supported: boolean;
  /** pieces of the play squishy (1 = whole) */
  readonly pieces: number;
  /** each piece's share of the whole (the physics' own measure), the anchor first */
  fracs(): number[];
  /** a neck or a reconnect is playing */
  readonly busy: boolean;
  /** Split in two can still do something: the limit is not reached and some piece is big enough to halve (a piece under twice the minimum, 1/4 of the whole, cannot be cut at all) */
  readonly canSplit: boolean;
  readonly maxPieces: number;
  /** the cut style (CUT_A.md SR1, CUT_MINIS.md): 'clean' (default; every piece is the real part on its side of the plane) or 'minis' (every piece is a complete smaller copy).
   *  A session setting, not saved. */
  readonly style: CutStyle;
  /** the style can be changed now: the squishy is whole and nothing plays (the Cut options control is off otherwise) */
  readonly canChangeStyle: boolean;
  /** change the style: false, no change and the line "Reconnect first to change the cut style" while the squishy is cut or a cut / join plays */
  setStyle(style: CutStyle): boolean;
  /** Picking the Cut tool: get the first cut ready (plans the likely first Split in two and builds it over idle frames, CUT2.md 6.1). Never throws. */
  prewarm(): void;
  /** Undo cut (a twin join of the newest cut, 6): absent until the true cut offers it, so the Undo cut button stays out of the bar and the texts do not name it */
  readonly canUndo?: boolean;
  undoCut?(): boolean;
  /** a swipe over the canvas, CSS px from (x0, y0) to (x1, y1) */
  swipe(x0: number, y0: number, x1: number, y1: number): CutResult;
  /** the accessible cut (CUT2.md 6.6): the first press on a whole squishy cuts along its own line between the eyes, later presses halve the largest piece */
  splitInTwo(): CutResult;
  /** every piece back together: animated over JOIN_ALL_S, or at once (leaving). false = nothing to do */
  reconnectAll(animated: boolean): boolean;
  /** per sim step: the neck and join timelines, the parting, the touch-to-join detection */
  update(dt: number): void;
  isPiece(b: SoftBodyLike): boolean;
  /** the live pieces (tests and the dev hook): share, the cell's plane ids, whether it is the anchor, and the centre */
  regions(): Array<{ frac: number; cells: number[]; anchor: boolean; x: number; y: number; z: number }>;
  dispose(): void;
}

const smooth = (x: number): number => { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t); };
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a: V3): V3 | null => { const l = Math.hypot(a.x, a.y, a.z); return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : null; };
const copy3 = (a: V3): V3 => ({ x: a.x, y: a.y, z: a.z });
const rotate = (q: { x: number; y: number; z: number; w: number }, v: V3): V3 => {
  // v + 2 q_xyz x (q_xyz x v + w v)
  const tx = q.y * v.z - q.z * v.y + q.w * v.x, ty = q.z * v.x - q.x * v.z + q.w * v.y, tz = q.x * v.y - q.y * v.x + q.w * v.z;
  return { x: v.x + 2 * (q.y * tz - q.z * ty), y: v.y + 2 * (q.z * tx - q.x * tz), z: v.z + 2 * (q.x * ty - q.y * tx) };
};
const newPlan = (): CutPlan => ({
  rest: { n: { x: 0, y: 0, z: 0 }, d: 0 }, fa: 0, offA: { x: 0, y: 0, z: 0 }, offB: { x: 0, y: 0, z: 0 }, velA: { x: 0, y: 0, z: 0 }, velB: { x: 0, y: 0, z: 0 },
  aspectA: 0, aspectB: 0, sound: false, soundPending: false, built: false,
});
const lowestY = (b: SoftBodyLike): number => { const P = b.positions; let m = Infinity; for (let i = 1; i < P.length; i += 3) if (P[i] < m) m = P[i]; return m; };

/** How far the body's skin reaches from its centre along the unit direction u (world space). */
export function supportAlong(b: SoftBodyLike, u: V3): number {
  const P = b.positions, n = b.vertexCount, c = b.center;
  let m = -Infinity;
  for (let i = 0; i < n; i++) { const s = (P[i * 3] - c.x) * u.x + (P[i * 3 + 1] - c.y) * u.y + (P[i * 3 + 2] - c.z) * u.z; if (s > m) m = s; }
  return Number.isFinite(m) ? m : b.restRadius;
}

/** Centre of the particles on each side of the plane (the lobes; positions are world space, shared with the plane). Minis place their pieces at these. */
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

/** The latched rest plane (in W) as a world plane of the body that holds it (CUT2.md 3.4): n_world = R n_W, point = center + R (n_W d_W - offset). Written into `out`. */
export function restPlaneToWorld(b: SoftBodyLike, rest: { n: V3; d: number }, out: CutPlane): void {
  const q = b.frame ?? { x: 0, y: 0, z: 0, w: 1 }, o = b.piece?.offset ?? { x: 0, y: 0, z: 0 }, c = b.center;
  const wp = rotate(q, { x: rest.n.x * rest.d - o.x, y: rest.n.y * rest.d - o.y, z: rest.n.z * rest.d - o.z }), wn = rotate(q, rest.n);
  out.point.x = c.x + wp.x; out.point.y = c.y + wp.y; out.point.z = c.z + wp.z;
  out.normal.x = wn.x; out.normal.y = wn.y; out.normal.z = wn.z;
}

export function createCutter(d: CutDeps): Cutter {
  let pieces: Piece[] = [];   // empty = whole (the play body alone); pieces[0] is the anchor = the play body
  let tree = createCutTree();
  let anim: Anim | null = null;
  let contact: { a: Piece; b: Piece; since: number } | null = null;
  let wobbleUntil = -1, wobbling: SoftBodyLike | null = null;
  let style: CutStyle = 'clean';
  /** the engine of the squishy as it is cut now ('true' = planCut / placeAt pieces, 'mini' = scaled copies), fixed at the first cut until it is whole again */
  let locked: 'true' | 'mini' | null = null;
  let parting: Parting | null = null;
  let warm: { body: SoftBodyLike; plan: CutPlan; frames: number; ctor: number } | null = null;
  let wholeR = 0.5;
  const whole0: Piece = { body: d.bodies.body, leaf: tree.root, frac: 1, built: 1 };
  const det = d.deterministic ?? (typeof window === 'undefined');
  const tmpPlane: CutPlane = { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } };
  const tmpA: V3 = { x: 0, y: 0, z: 0 }, tmpB: V3 = { x: 0, y: 0, z: 0 };

  const genome = (): Genome => d.bodies.identity.genome;
  const tier = (): TierName => d.bodies.identity.tier;
  const familyId = (): string => { try { const g = genome(); return getSpecies(g.species) ? familyOf(g.species) : 'jellygel'; } catch { return 'jellygel'; } };
  const pitch = (): number => { try { return pitchRatio(genome()); } catch { return 1; } };
  const supported = (): boolean => {
    const b = d.bodies.body;
    return typeof b.measureCut === 'function' && typeof b.setNeck === 'function' && typeof b.setFrac === 'function' && typeof d.stage.addBody === 'function';
  };
  const trueCutOffered = (b: SoftBodyLike): boolean => typeof b.planCut === 'function' && typeof b.prepareCut === 'function' && typeof b.placeAt === 'function';
  /** is the squishy (cut now, or about to be) on the true cut engine? */
  const isTrue = (): boolean => (locked !== null ? locked === 'true' : style === 'clean' && trueCutOffered(d.bodies.body));
  const maxN = (): number => (isTrue() ? d.maxClean ?? MAX_PIECES_CLEAN : MAX_PIECES[d.quality()] ?? 4);
  const list = (): Piece[] => {
    if (pieces.length) return pieces;
    whole0.body = d.bodies.body; whole0.leaf = tree.root; whole0.frac = 1; whole0.built = 1;
    try { wholeR = whole0.body.restRadius || wholeR; } catch { /* keep */ }
    return [whole0];
  };
  const fracOf = (p: Piece): number => { const f = p.body.frac; return typeof f === 'number' && Number.isFinite(f) ? f : p.frac; };
  const extraOf = (b: SoftBodyLike): ExtraBody | undefined => d.bodies.extras.find((x) => x.body === b && x.piece);
  const radius = (p: Piece): number => p.body.restRadius * Math.cbrt(Math.max(PIECE_MIN, fracOf(p)) / Math.max(PIECE_MIN, p.built));
  const dragVec: V3 = { x: 0, y: 0, z: 0 };
  /** the finger is dragging P toward the piece at the other end of `u` (the unit vector from that piece to P): its hand has moved DRAG_TOWARD_K of P's radius that way */
  const dragsInto = (P: Piece, u: V3): boolean => {
    try { if (!d.drag(dragVec)) return false; } catch (e) { d.report(e); return false; }
    return -(dragVec.x * u.x + dragVec.y * u.y + dragVec.z * u.z) >= DRAG_TOWARD_K * radius(P);
  };
  /** the signed SURFACE gap between two bodies along the line between their centres (negative = overlapping), and that line's unit vector from b to a */
  const gapBetween = (a: SoftBodyLike, b: SoftBodyLike): { u: V3; g: number } | null => {
    const ca = a.center, cb = b.center;
    const x = ca.x - cb.x, y = ca.y - cb.y, z = ca.z - cb.z, dd = Math.hypot(x, y, z);
    if (!(dd > 1e-6)) return null;
    const u: V3 = { x: x / dd, y: y / dd, z: z / dd };
    return { u, g: dd - supportAlong(b, u) - supportAlong(a, { x: -u.x, y: -u.y, z: -u.z }) };
  };
  /** best effort: the physics keeps a cache of the pieces it built (piece.ts); a whole squishy again has no use for it */
  const clearPieceCache = (): void => { void import('../physics/piece.ts').then((m) => m.clearPieceCache()).catch(() => { /* a build without it */ }); };

  function wobble(b: SoftBodyLike): void {
    try {
      if (typeof b.tremble === 'function') { b.tremble(0.35); wobbling = b; wobbleUntil = d.simTime() + 0.28; }
      else b.nudge({ x: 0, y: 0.5, z: 0 });
    } catch (e) { d.report(e); }
  }

  /* ───────────────────────────── the scripted parting (CUT2.md 6.5) ───────────────────────────── */

  function endParting(): void {
    const x = parting;
    parting = null;
    if (!x) return;
    try { x.a.body.moveTo?.(null); } catch { /* optional */ }
    try { x.b.body.moveTo?.(null); } catch { /* optional */ }
  }
  /** one step: the pair opens by G smoothstep(t / PART_S), half each way (open loop, sim time only, no allocation) */
  function stepParting(x: Parting, t: number): void {
    const g = x.G * smooth((t - x.t0) / x.dur), h = 0.5 * g;
    try {
      if (x.mode === 'slide') {
        tmpA.x = x.ax + h * x.s.x; tmpA.y = x.a.body.center.y; tmpA.z = x.az + h * x.s.z;
        tmpB.x = x.bx - h * x.s.x; tmpB.y = x.b.body.center.y; tmpB.z = x.bz - h * x.s.z;
      } else {
        tmpA.x = x.ax + h * x.s.x; tmpA.y = x.ay + h * x.s.y; tmpA.z = x.az + h * x.s.z;
        tmpB.x = x.bx - h * x.s.x; tmpB.y = x.by - h * x.s.y; tmpB.z = x.bz - h * x.s.z;
      }
      x.a.body.moveTo?.(tmpA, 3);
      x.b.body.moveTo?.(tmpB, 3);
    } catch (e) { d.report(e); }
    if (t - x.t0 >= x.dur) endParting();
  }

  /* ───────────────────────────── plan and refusals ───────────────────────────── */

  /** CUT2.md 3.2, the particle rule: a cut that would make the sixth piece while any of the six is, or would be built as, detail 3 (642 particles; a child is detail 3 from a share of 0.35) is refused */
  function particleRule(p: Piece, fA: number, fB: number): boolean {
    const ps = list();
    if (ps.length + 1 < 6) return false;
    if (fA >= 0.35 || fB >= 0.35) return true;
    return ps.some((q) => q !== p && q.body.vertexCount > 300);
  }
  /** the refusal lines of the `small` case: the button always cuts the middle, so "try nearer the middle" is advice it cannot follow */
  function refuseSmall(p: Piece, button: boolean): CutResult {
    wobble(p.body);
    d.say(button ? T.noneBigEnough(false) : fracOf(p) < 2 * PIECE_MIN + 1e-6 ? T.smallestPiece : T.tooSmallNearMiddle);
    return 'small';
  }
  function refuse(p: Piece, line: string, r: CutResult): CutResult { wobble(p.body); d.say(line); return r; }

  /** Split in two, first press (CUT2.md 6.6): the squishy's OWN line between the eyes. The normal is its rest +x axis in the world; the plane passes through the midpoint of the two eye
   *  centres when the stage knows them and that plane's smaller share is in [0.40, 0.60], else it is the median plane along the same normal. */
  function eyePlane(p: Piece): { plane: CutPlane; mode: 'at' | 'median' } {
    const b = p.body, q = b.frame ?? { x: 0, y: 0, z: 0, w: 1 };
    const n = rotate(q, { x: 1, y: 0, z: 0 });
    const median = { plane: { point: copy3(b.center), normal: n }, mode: 'median' as const };
    try {
      const v = d.bodies.viewIdOf(b);
      const ea = v !== null ? d.stage.eyeAnchors?.(v) ?? null : null;
      if (!ea) return median;
      const m = rotate(q, { x: 0.5 * (ea.left.x + ea.right.x), y: 0.5 * (ea.left.y + ea.right.y), z: 0.5 * (ea.left.z + ea.right.z) });
      const plane: CutPlane = { point: { x: b.center.x + m.x, y: b.center.y + m.y, z: b.center.z + m.z }, normal: n };
      const tmp = newPlan();
      if (b.planCut!(plane, tmp, 'at')) { const s = Math.min(tmp.fa, 1 - tmp.fa); if (s >= EYE_SHARE_MIN && s <= EYE_SHARE_MAX) return { plane, mode: 'at' }; }
    } catch (e) { d.report(e); }
    return median;
  }
  /** Split in two, later presses (CUT2.md 6.6): the camera-relative vertical plane, turned in steps of 45 degrees; the turn with the best aspect wins (the smaller turn unless the best beats it by more than 0.03) */
  function candidatePlane(p: Piece): CutPlane | null {
    const cam = d.stage.camera as unknown as CameraLike;
    try { cam.updateMatrixWorld?.(); } catch { /* a mock camera */ }
    const c = p.body.center, eye = cameraPosition(cam), view = unit(sub(c, eye));
    const w = cam.matrixWorld.elements;
    const up = unit({ x: w[4], y: w[5], z: w[6] }) ?? { x: 0, y: 1, z: 0 };
    const nv = view ? cross(view, up) : null;
    const h = nv ? unit({ x: nv.x, y: 0, z: nv.z }) : null;
    const n0 = h ?? { x: 1, y: 0, z: 0 };
    const scores: number[] = [];
    let best = -1;
    const cand: V3[] = [];
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 4, cs = Math.cos(a), sn = Math.sin(a);
      const nk: V3 = { x: n0.x * cs + n0.z * sn, y: 0, z: -n0.x * sn + n0.z * cs };
      cand.push(nk);
      const tmp = newPlan();
      let ok = false;
      try { ok = p.body.planCut!({ point: copy3(c), normal: nk }, tmp, 'median'); } catch (e) { d.report(e); }
      const s = ok ? Math.min(tmp.aspectA, tmp.aspectB) : -1;
      scores.push(s);
      if (s > best) best = s;
    }
    if (best < 0) return null;
    let pick = 0;
    for (let k = 0; k < 4; k++) if (scores[k] >= best - CANDIDATE_MARGIN) { pick = k; break; }
    return { point: copy3(c), normal: cand[pick] };
  }

  /* ───────────────────────────── start of a cut ───────────────────────────── */

  /** the swipe's two ends on the plane at the target's depth (the seam glow's ends) */
  function endsAtDepth(x0: number, y0: number, x1: number, y1: number, c: V3): { from: V3; to: V3 } | null {
    try {
      const cam = d.stage.camera as unknown as CameraLike, vp = d.viewport();
      const n0 = pxToNdc(x0, y0, vp), n1 = pxToNdc(x1, y1, vp), r0 = cameraRay(cam, n0.x, n0.y), r1 = cameraRay(cam, n1.x, n1.y);
      const at = (r: { origin: V3; dir: V3 }): V3 => { const t = Math.max(0, dot(sub(c, r.origin), r.dir)); return { x: r.origin.x + r.dir.x * t, y: r.origin.y + r.dir.y * t, z: r.origin.z + r.dir.z * t }; };
      return { from: at(r0), to: at(r1) };
    } catch { return null; }
  }
  /** Split in two: the plane's two ends across the piece's width */
  function endsAcross(p: Piece, plane: CutPlane): { from: V3; to: V3 } {
    const t = unit(cross(plane.normal, { x: 0, y: 1, z: 0 })) ?? { x: 1, y: 0, z: 0 }, r = 1.1 * p.body.restRadius, c = p.body.center;
    return { from: { x: c.x - t.x * r, y: c.y - t.y * r, z: c.z - t.z * r }, to: { x: c.x + t.x * r, y: c.y + t.y * r, z: c.z + t.z * r } };
  }

  function startCut(p: Piece, plane: CutPlane, how: { button: boolean; mode?: 'at' | 'median'; ends?: { from: V3; to: V3 } | null }): CutResult {
    endParting();
    return isTrue() ? startTrue(p, plane, how) : startMini(p, plane, how.button, how.ends ?? null);
  }

  function beginNeck(a: NeckAnim, small: number): void {
    anim = a;
    try { d.audio.cut?.({ phase: 'start', frac: small, neckS: a.neckS, family: familyId(), pan: d.panOf(a.p.body.center), calm: d.calm(), pitch: pitch() }); } catch (e) { d.report(e); }
  }

  /** the true cut (CUT2.md 6.2): plan, refuse, allocate the cut in the tree, start the neck */
  function startTrue(p: Piece, plane: CutPlane, how: { button: boolean; mode?: 'at' | 'median'; ends?: { from: V3; to: V3 } | null }): CutResult {
    const b = p.body, plan = newPlan();
    let ok = false;
    try { ok = !!b.planCut!(plane, plan, how.mode ?? 'at'); } catch (e) { d.report(e); }
    if (!ok || !(plan.fa > 0) || !(plan.fa < 1) || !p.leaf) return 'miss';
    const pf = fracOf(p), fA = pf * plan.fa, fB = pf - fA, small = Math.min(fA, fB);
    if (small < PIECE_MIN - PIECE_TOL) return refuseSmall(p, how.button);
    if (list().length + 1 > maxN() || particleRule(p, fA, fB)) return refuse(p, T.limit, 'limit');
    if (Math.min(plan.aspectA, plan.aspectB) < ASPECT_MIN) return refuse(p, T.thin, 'thin');
    if (!plan.sound) return refuse(p, T.loose, 'loose');
    const first = pieces.length === 0;
    const kids = cutPiece(tree, p.leaf, plan.rest.n, plan.rest.d);
    if (!kids) return 'miss';
    if (first) { pieces = [p]; locked = 'true'; }
    const fam = familyId();
    const pw: CutPlane = { point: copy3(plane.point), normal: copy3(plane.normal) };
    restPlaneToWorld(b, plan.rest, pw);
    const ends = how.ends ?? endsAcross(p, pw);
    beginNeck({
      kind: 'neck', p, plane: pw, fa: plan.fa, t0: d.simTime(), neckS: NECK_S[fam] ?? NECK_DEFAULT_S, depth: NECK_DEPTH[fam] ?? NECK_DEPTH_DEFAULT, view: d.bodies.viewIdOf(b), button: how.button,
      plan, node: p.leaf, kids, cutId: tree.nextPlane - 1, v0: meanVel(plan), ready: false, pre: { a: null, b: null }, from: ends.from, to: ends.to, first,
    }, small);
    return 'cut';
  }
  /** the body's mean velocity from the plan's two sides (the weights cancel in the neck's difference v1 - v0) */
  function meanVel(pl: CutPlan): V3 {
    const w = pl.fa;
    return { x: w * pl.velA.x + (1 - w) * pl.velB.x, y: w * pl.velA.y + (1 - w) * pl.velB.y, z: w * pl.velA.z + (1 - w) * pl.velB.z };
  }

  /** Minis (and a physics without the true cut): the share is measureCut's, on the deformed mesh; the pieces are scaled copies */
  function startMini(p: Piece, plane: CutPlane, button: boolean, ends: { from: V3; to: V3 } | null): CutResult {
    let fa: number | null = null;
    try { fa = p.body.measureCut!(plane); } catch (e) { d.report(e); fa = null; }
    if (fa === null || !(fa > 0) || !(fa < 1)) return 'miss';
    const small = Math.min(fa, 1 - fa) * fracOf(p);
    if (small < PIECE_MIN - PIECE_TOL) return refuseSmall(p, button);
    if (list().length + 1 > maxN()) return refuse(p, T.limit, 'limit');
    const first = pieces.length === 0;
    if (first) { pieces = [p]; locked = 'mini'; }
    const fam = familyId();
    beginNeck({
      kind: 'neck', p, plane, fa, t0: d.simTime(), neckS: NECK_S[fam] ?? NECK_DEFAULT_S, depth: 1, view: d.bodies.viewIdOf(p.body), button,
      plan: null, node: null, kids: null, cutId: 0, v0: { x: 0, y: 0, z: 0 }, ready: true, pre: { a: null, b: null }, from: ends?.from ?? null, to: ends?.to ?? null, first,
    }, small);
    return 'cut';
  }

  /* ───────────────────────────── the neck and the swap ───────────────────────────── */

  function releaseNeck(a: NeckAnim): void {
    try { a.p.body.setNeck?.(null, 0); } catch (e) { d.report(e); }
    try { if (a.view !== null) d.stage.setCutSeam?.(a.view, null, 0); } catch (e) { d.report(e); }
  }
  /** the cut never happened (the builder refused it during the neck, or a throw): the neck is released, the tree rolled back, the squishy stays as it was */
  function abandon(a: NeckAnim, line: string | null): void {
    releaseNeck(a);
    if (a.kids && a.node) rollbackCut(tree, a.node);
    if (a.first) { pieces = []; locked = null; }
    if (line !== null) { wobble(a.p.body); d.say(line); }
  }

  /** t = 1 held: replace the cut body by its two pieces */
  function part(a: NeckAnim): void {
    if (a.plan) partTrue(a); else partMini(a);
  }

  /** Construct one child of the cut as a body (its mesh is in the physics' cache once prepareCut said true). Idempotent per side; throws what createBody throws.
   *  The plane in the tree becomes the plane that was built (the retry ladder may have moved it by a few millimetres). */
  function buildKid(a: NeckAnim, side: 0 | 1): SoftBodyLike {
    const plan = a.plan!, kids = a.kids!, pf = fracOf(a.p);
    const rp = planeById(tree, a.cutId);
    if (rp) { rp.n.x = plan.rest.n.x; rp.n.y = plan.rest.n.y; rp.n.z = plan.rest.n.z; rp.d = plan.rest.d; }
    const reg = regionOf(tree, kids[side]);
    if (!reg) throw new Error('cut: no region for a kid');
    const fA = pf * plan.fa;
    return d.createBody(genome(), { piece: { frac: side === 0 ? fA : pf - fA, region: reg } });
  }

  function partTrue(a: NeckAnim): void {
    const p = a.p, B = p.body, plan = a.plan!, kids = a.kids!;
    let plan2 = plan;
    try { const pl2 = newPlan(); if (B.planCut!(a.plane, pl2, 'latched')) plan2 = pl2; } catch (e) { d.report(e); }
    const q: Quat = { ...(B.frame ?? { x: 0, y: 0, z: 0, w: 1 }) }, c = copy3(B.center), po = B.piece?.offset ?? { x: 0, y: 0, z: 0 };
    const v1 = meanVel(plan2), dv = sub(v1, a.v0);
    releaseNeck(a);
    let pa: SoftBodyLike, pb: SoftBodyLike;
    try {
      pa = a.pre.a ?? buildKid(a, 0);
      pb = a.pre.b ?? buildKid(a, 1);
    } catch (e) {
      // the physics could not build a piece: nothing was replaced, the squishy stays as it was
      d.report(e);
      abandon(a, T.thin);
      return;
    }
    for (const b of [pa, pb]) { try { b.gravity = d.gravity(); } catch { /* optional */ } }
    // exact placement (6.4 step 1): world = center + R(frame) . (child offset - parent offset), both offsets in W (the built bodies know them exactly; a body without PieceInfo, a mock, takes the plan's)
    const place = (b: SoftBodyLike, o: V3, v: V3): { at: V3; vel: V3 } => {
      const w = b.piece?.offset, r = rotate(q, w ? { x: w.x - po.x, y: w.y - po.y, z: w.z - po.z } : o);
      return { at: { x: c.x + r.x, y: c.y + r.y, z: c.z + r.z }, vel: { x: v.x - dv.x, y: v.y - dv.y, z: v.z - dv.z } };
    };
    const pA = place(pa, plan2.offA, plan2.velA), pB = place(pb, plan2.offB, plan2.velB);
    try { pa.placeAt?.(pA.at, pA.vel, q); pb.placeAt?.(pB.at, pB.vel, q); } catch (e) { d.report(e); }
    // one COMMON lift: if either piece is below the table, both rise by the same amount (never one alone: siblings overlapped)
    const low = Math.min(lowestY(pa), lowestY(pb));
    if (low < 0) {
      const lift = -low + 1e-4;
      pA.at.y += lift; pB.at.y += lift;
      try { pa.placeAt?.(pA.at, pA.vel, q); pb.placeAt?.(pB.at, pB.vel, q); } catch (e) { d.report(e); }
    }
    // the parting script (6.5): a steep plane slides sideways; a near-level plane drops the upper piece a few centimetres; floating pieces open along the normal
    const n = rotate(q, plan.rest.n), fam = familyId();
    const G = (PART_GAP[fam] ?? PART_GAP_DEFAULT) * (wholeR / 0.5) * (d.calm() ? 0.6 : 1);
    const gravityOn = d.gravity();
    let mode: Parting['mode'] | 'plop' | 'none' = gravityOn ? (Math.abs(n.y) < LEVEL_NY ? 'slide' : 'plop') : 'float';
    if (mode === 'plop') {
      const up = pA.at.y >= pB.at.y ? pA : pB, upBody = up === pA ? pa : pb;
      up.at.y += Math.min(G, PLOP_MAX);
      try { upBody.placeAt?.(up.at, up.vel, q); } catch (e) { d.report(e); }
      mode = 'none';
    }
    d.beforeChange();
    if (a.first) {
      const k = d.clearMat();
      if (k > 0) d.say(T.matCleared(k));
    }
    const fA = fracOf(p) * plan.fa, fB = fracOf(p) - fA;
    const frA = typeof pa.frac === 'number' ? pa.frac : fA, frB = typeof pb.frac === 'number' ? pb.frac : fB;
    const A: Piece = { body: pa, leaf: kids[0], frac: frA, built: frA };
    const Bp: Piece = { body: pb, leaf: kids[1], frac: frB, built: frB };
    install(p, A, Bp, B);
    afterSwap(A, Bp, Math.min(frA, frB));
    if (mode === 'slide' || mode === 'float') {
      const s = mode === 'slide' ? (unit({ x: n.x, y: 0, z: n.z }) ?? { x: 1, y: 0, z: 0 }) : n;
      parting = { a: A, b: Bp, ax: pA.at.x, ay: pA.at.y, az: pA.at.z, bx: pB.at.x, by: pB.at.y, bz: pB.at.z, s, G, dur: PART_S[fam] ?? PART_S_DEFAULT, t0: d.simTime(), mode };
      stepParting(parting, d.simTime());
    }
  }

  /** Minis: replace the cut body by two complete smaller copies, placed at their lobes' centres */
  function partMini(a: NeckAnim): void {
    const p = a.p, B = p.body, g = genome(), plane = a.plane;
    try { B.setNeck?.(null, 0); } catch (e) { d.report(e); }
    try { if (a.view !== null) d.stage.setCutSeam?.(a.view, null, 0); } catch (e) { d.report(e); }
    const fA = fracOf(p) * a.fa, fB = fracOf(p) * (1 - a.fa);
    const lc = lobeCentres(B, plane) ?? { a: B.center, b: B.center };
    const n = plane.normal;
    const push = 0.22;   // m/s apart: enough to read as parting; more spreads the pieces so far that a portrait phone frames them tiny
    let pa: SoftBodyLike, pb: SoftBodyLike;
    try {
      pa = d.createBody(g, { piece: { frac: fA, chunk: false, at: lc.a, vel: { x: n.x * push, y: 0, z: n.z * push } } });
      pb = d.createBody(g, { piece: { frac: fB, chunk: false, at: lc.b, vel: { x: -n.x * push, y: 0, z: -n.z * push } } });
    } catch (e) {
      // the physics could not build a piece: nothing was replaced, the squishy stays as it was
      d.report(e);
      if (a.first) { pieces = []; locked = null; }
      return;
    }
    for (const b of [pa, pb]) { try { b.gravity = d.gravity(); } catch { /* optional */ } }
    d.beforeChange();
    if (a.first) {
      const k = d.clearMat();
      if (k > 0) d.say(T.matCleared(k));
    }
    const A: Piece = { body: pa, leaf: null, frac: fA, built: fA };
    const Bp: Piece = { body: pb, leaf: null, frac: fB, built: fB };
    install(p, A, Bp, B);
    afterSwap(A, Bp, Math.min(fA, fB));
  }

  /** the bodies manager and the piece list take the two children in place of the parent. The anchor is the larger child (ties: side A). */
  function install(p: Piece, A: Piece, Bp: Piece, parentBody: SoftBodyLike): void {
    const g = genome(), id = d.bodies.identity;
    const isAnchor = parentBody === d.bodies.body;
    const x = { tier: tier(), shared: true, piece: true, itemId: null as string | null };
    if (isAnchor) {
      const larger = A.frac >= Bp.frac - 1e-9 ? A : Bp, other = larger === A ? Bp : A;   // (ties: side A)
      if (typeof d.stage.setPrimaryBody === 'function' && typeof d.bodies.promote === 'function') {
        d.bodies.addExtra(A.body, g, x); d.bodies.addExtra(Bp.body, g, x);
        if (!d.bodies.promote(larger.body)) d.bodies.swapTo(g, { body: larger.body, itemId: id.itemId, nickname: id.nickname, silent: true });
      } else {
        // an old stage cannot re-point its primary view: the larger child becomes the play body through swapTo (the extras are shown again), the other joins the mat
        d.bodies.swapTo(g, { body: larger.body, itemId: id.itemId, nickname: id.nickname, silent: true });
        d.bodies.addExtra(other.body, g, x);
      }
      pieces = [larger, other, ...pieces.filter((q) => q !== p)];
    } else {
      const xb = extraOf(parentBody);
      if (xb) d.bodies.removeExtra(xb.id);
      d.bodies.addExtra(A.body, g, x);
      d.bodies.addExtra(Bp.body, g, x);
      pieces = pieces.flatMap((q) => (q === p ? [A, Bp] : [q]));
    }
  }
  function afterSwap(A: Piece, Bp: Piece, small: number): void {
    try { const ia = d.bodies.viewIdOf(A.body), ib = d.bodies.viewIdOf(Bp.body); if (ia !== null && ib !== null) d.stage.partPieces?.(ia, ib); } catch (e) { d.report(e); }
    try { d.audio.cut?.({ phase: 'separate', frac: small, family: familyId(), pan: d.panOf(A.body.center), calm: d.calm(), pitch: pitch() }); } catch (e) { d.report(e); }
    try { d.haptics.poke(); } catch { /* optional */ }
    d.say(T.cutDone(pieces.length, style));
  }

  /* ───────────────────────────── joins ───────────────────────────── */

  /** the place where the giver meets the receiver MATED (the clean style): the giver's centre relative to the receiver's, when the two cut faces lie on each other (CUT2.md 3.1: the same axes, offsets in W) */
  function matedOffset(recv: Piece, giver: Piece): V3 | null {
    const ro = recv.body.piece?.offset, go = giver.body.piece?.offset;
    if (!ro || !go) return null;
    return rotate(recv.body.frame ?? { x: 0, y: 0, z: 0, w: 1 }, { x: go.x - ro.x, y: go.y - ro.y, z: go.z - ro.z });
  }
  const useMated = (recv: Piece, giver: Piece): boolean => locked === 'true' && !!recv.leaf && !!giver.leaf;

  /** the giver's path into the receiver, planned from where they stand NOW: along the line from the base point (the receiver's centre, or the mated place) to the giver; first to a held
   *  gap of BRIDGE_GAP_K of the smaller piece's radius, held for BRIDGE_HOLD_S, then in to the base point */
  function flowOf(recv: Piece, giver: Piece): Flow {
    const rc = recv.body.center, gc = giver.body.center;
    const m = useMated(recv, giver) ? matedOffset(recv, giver) : null;
    const bx = rc.x + (m ? m.x : 0), by = rc.y + (m ? m.y : 0), bz = rc.z + (m ? m.z : 0);
    let x = gc.x - bx, y = gc.y - by, z = gc.z - bz;
    let d0 = Math.hypot(x, y, z);
    if (d0 < 1e-6) { x = 1; y = 0; z = 0; d0 = 0; } else { x /= d0; y /= d0; z /= d0; }
    const u: V3 = { x, y, z };
    let dh = d0;
    try {
      const held = BRIDGE_GAP_K * Math.min(radius(recv), radius(giver));
      dh = m ? held : supportAlong(recv.body, u) + supportAlong(giver.body, { x: -x, y: -y, z: -z }) + held;
    } catch { /* a body without positions: no hold */ }
    return { u, d0, dh, ta: Math.max(0.12, Math.min(0.45, 0.12 + 0.5 * Math.abs(d0 - dh))), m };
  }
  /** where along its path the giver should be `el` seconds into a join of `dur` seconds: to the held gap (f.ta), held for BRIDGE_HOLD_S, then in */
  const flowD = (f: Flow, el: number, dur: number): number => {
    const ta = Math.min(f.ta, dur * 0.4), hold = Math.min(BRIDGE_HOLD_S, Math.max(0, dur - ta) * 0.5);
    if (el < ta) return f.d0 + (f.dh - f.d0) * smooth(el / Math.max(1e-6, ta));
    if (el < ta + hold) return f.dh;
    return f.dh * (1 - smooth((el - ta - hold) / Math.max(1e-6, dur - ta - hold)));
  };
  /** the bridge is drawn only while the two are within reach of each other (a long thin rod across other pieces reads as a beam, not a neck) */
  const bridgeK = (recv: Piece, giver: Piece, k: number): number => {
    try { const m = gapBetween(giver.body, recv.body); return m && m.g <= BRIDGE_REACH_K * Math.min(radius(recv), radius(giver)) ? k : 0; } catch { return k; }
  };
  /** steer the giver along its path (a kinematic spring; stiffness 3 follows it within ~0.1 s) */
  function follow(recv: Piece, giver: Piece, f: Flow, el: number, dur: number): void {
    const rc = recv.body.center, D = flowD(f, el, dur);
    const bx = rc.x + (f.m ? f.m.x : 0), by = rc.y + (f.m ? f.m.y : 0), bz = rc.z + (f.m ? f.m.z : 0);
    try { giver.body.moveTo?.({ x: bx + f.u.x * D, y: by + f.u.y * D, z: bz + f.u.z * D }, 3); } catch { /* optional */ }
  }
  const setBridge = (a: Piece, b: Piece, k: number): void => {
    const v = d.bodies.viewIdOf(a.body), w = d.bodies.viewIdOf(b.body);
    try { if (v !== null && w !== null) d.stage.setBridge?.(v, w, k); } catch (e) { d.report(e); }
  };

  /** the receiver of a join (CUT2.md 7.2): the larger piece (ties: the anchor, then the lower index) */
  function receiverOf(a: Piece, b: Piece): { recv: Piece; giver: Piece } {
    const fa = fracOf(a), fb = fracOf(b);
    const aFirst = pieces.indexOf(a) <= pieces.indexOf(b);
    const recv = fa > fb + 1e-9 ? a : fb > fa + 1e-9 ? b : aFirst ? a : b;
    return { recv, giver: recv === a ? b : a };
  }

  function startJoin(a: Piece, b: Piece): void {
    endParting();
    const { recv, giver } = receiverOf(a, b);
    contact = null;
    if (recv.leaf && giver.leaf && locked === 'true') {
      const grp = group(tree, recv.leaf, giver.leaf);
      if (!grp || !grp.twins) return;   // (joins of non-twins come with the full tree, later in CUT2)
    }
    if (typeof recv.body.setFrac !== 'function' && locked !== 'true') { joined(recv, giver, false); return; }
    const flow = flowOf(recv, giver);
    recv.frac = fracOf(recv); giver.frac = fracOf(giver);   // the shares as they are NOW: the bodies' own fracs move during the flow
    if (locked !== 'true') {
      // Minis: the receiver grows by the giver's share, the giver shrinks into it (both complete scaled copies)
      try { recv.body.setFrac!(Math.min(1, recv.frac + giver.frac), JOIN_S); giver.body.setFrac?.(PIECE_MIN, JOIN_S); } catch (e) { d.report(e); }
    }
    // it flows INTO the receiver (Minis) or meets it MATED, flush (clean): no contact push between them either way. Gate S5a (2026-10-08): in the clean style the giver was NOT a ghost,
    // so the shipped collide shoved the flush faces apart and the giver climbed 0.6 m onto / over the receiver on its way home. Every exit of a join (joined, swapWhole, abortAnim) clears the ghost.
    d.bodies.setGhost(giver.body, true);
    anim = { kind: 'join', recv, giver, t0: d.simTime(), dur: JOIN_S, flow };
  }

  /** a join ended (not Reconnect all): the giver is gone into the receiver (Minis), or the twins met mated and the squishy is whole again (clean) */
  function joined(recv: Piece, giver: Piece, all: boolean): void {
    setBridge(recv, giver, 0);
    try { giver.body.moveTo?.(null); } catch { /* optional */ }
    if (locked === 'true') {
      if (recv.leaf && giver.leaf) { const grp = group(tree, recv.leaf, giver.leaf); if (grp) joinGroup(tree, grp.node); }
      d.beforeChange();
      if (!all) {
        try { d.audio.rejoin?.({ frac: 1, pan: d.panOf(recv.body.center), calm: d.calm(), pitch: pitch() }); } catch (e) { d.report(e); }
        try { d.haptics.release(); } catch { /* optional */ }
      }
      whole(!all, true);
      return;
    }
    const x = extraOf(giver.body);
    d.beforeChange();
    if (x) d.bodies.removeExtra(x.id);
    d.bodies.setGhost(giver.body, false);
    recv.frac = Math.min(1, recv.frac + giver.frac);   // (the recorded shares of startJoin: the giver's body has shrunk to PIECE_MIN by now)
    pieces = pieces.filter((q) => q !== giver);
    if (pieces[0] !== recv) promoteTo(recv);   // the anchor was the giver: the receiver becomes the play body
    if (!all) {
      try { d.audio.rejoin?.({ frac: recv.frac, pan: d.panOf(recv.body.center), calm: d.calm(), pitch: pitch() }); } catch (e) { d.report(e); }
      try { d.haptics.release(); } catch { /* optional */ }
    }
    if (pieces.length <= 1) whole(!all, true);
    else if (!all) d.say(T.joinedTwins(pieces.length));
  }
  /** the receiver becomes the play body (the anchor flowed in as a giver and is gone); the identity is unchanged */
  function promoteTo(recv: Piece): void {
    const g = genome(), id = d.bodies.identity;
    const x = extraOf(recv.body);
    if (typeof d.stage.setPrimaryBody === 'function' && typeof d.bodies.promote === 'function' && x && d.bodies.promote(recv.body)) { /* promoted without rebuilding any view */ }
    else {
      if (x) d.bodies.removeExtra(x.id);
      d.bodies.swapTo(g, { body: recv.body, itemId: id.itemId, nickname: id.nickname, silent: true });
    }
    pieces = [recv, ...pieces.filter((q) => q !== recv)];
  }

  /** the last piece is gone: the anchor becomes the exact original squishy again, at the middle of the table (gliding there first with whatever travels with it, when `glide` and it is away from it) */
  function whole(say: boolean, glide: boolean): void {
    const face = pieces[0];
    contact = null;
    if (say) d.say(T.whole);
    if (!face) { pieces = []; locked = null; return; }
    const others = pieces.slice(1);
    if (!others.length && face.body === d.bodies.body && fracOf(face) >= 1 && face.built >= 1) { pieces = []; locked = null; tree = createCutTree(); return; }
    const c = face.body.center;
    if (glide && typeof face.body.moveTo === 'function' && Math.hypot(c.x, c.z) > HOME_NEAR) {
      face.frac = 1;
      try { face.body.moveTo({ x: 0, y: c.y, z: 0 }, 1.2); } catch (e) { d.report(e); swapWhole(face); return; }
      anim = { kind: 'home', face, others, t0: d.simTime() };
      return;
    }
    swapWhole(face);
  }

  /** everything else leaves the mat and a fresh WHOLE body (createBody(genome): the original constructor path and the original genome object) takes the play body's place at the middle */
  function swapWhole(face: Piece): void {
    const g = genome(), id = d.bodies.identity;
    for (const q of pieces) { if (q === face) continue; try { q.body.moveTo?.(null); } catch { /* optional */ } d.bodies.setGhost(q.body, false); }
    try { face.body.moveTo?.(null); } catch { /* optional */ }
    let b: SoftBodyLike;
    try { b = d.createBody(g); }
    catch (e) { d.report(e); return; }   // (the squishy stays as it is; the next leave tries again)
    d.beforeChange();
    for (const q of pieces) { if (q === face) continue; const x = extraOf(q.body); if (x) d.bodies.removeExtra(x.id); }
    pieces = [];
    locked = null;
    tree = createCutTree();
    parting = null;
    d.bodies.swapTo(g, { body: b, itemId: id.itemId, nickname: id.nickname, silent: true });
    clearPieceCache();
  }

  function finishAll(glide: boolean): void {
    const face = pieces[0];
    if (!face) { pieces = []; return; }
    for (const c of pieces.slice(1)) setBridge(face, c, 0);
    if (locked === 'true') { whole(false, glide); return; }
    const chunks = pieces.slice(1);
    for (const c of chunks) { try { c.body.moveTo?.(null); } catch { /* optional */ } }
    d.beforeChange();
    for (const c of chunks) { const x = extraOf(c.body); if (x) d.bodies.removeExtra(x.id); d.bodies.setGhost(c.body, false); }
    pieces = [face];
    face.frac = 1;
    whole(false, glide);
  }

  /** stop whatever plays, leaving the bodies in a state the instant reconnect can take over */
  function abortAnim(): void {
    const a = anim;
    anim = null;
    endParting();
    warm = null;
    if (!a) return;
    if (a.kind === 'neck') abandon(a, null);
    if (a.kind === 'join') { d.bodies.setGhost(a.giver.body, false); setBridge(a.recv, a.giver, 0); try { a.giver.body.moveTo?.(null); } catch { /* optional */ } }
    if (a.kind === 'all') for (const c of pieces.slice(1)) { d.bodies.setGhost(c.body, false); setBridge(pieces[0], c, 0); }
    if (a.kind === 'home') swapWhole(a.face);   // whole at once, at the middle
  }

  /* ───────────────────────────── prewarm ───────────────────────────── */

  function stepWarm(): void {
    const w = warm;
    if (!w) return;
    if (anim || pieces.length || w.body !== d.bodies.body || --w.frames < 0) { warm = null; return; }
    let r: boolean | 'thin' | 'loose' = true;
    try { r = w.body.prepareCut!(det ? Infinity : 3, det ? 4 : undefined); } catch (e) { d.report(e); warm = null; return; }
    if (r !== true) { if (r !== false) warm = null; return; }
    // the meshes are cached: build the two bodies once (one per frame) and drop them, so the first real cut does not pay the constructor's first run in its neck
    try {
      const pl = w.plan, base = w.body.frac ?? 1, fa = base * pl.fa, side = w.ctor;
      d.createBody(genome(), { piece: { frac: side === 0 ? fa : base - fa, region: { planes: [{ id: 1, n: { x: pl.rest.n.x, y: pl.rest.n.y, z: pl.rest.n.z }, d: pl.rest.d }], cells: [[side === 0 ? 1 : -1]] } } });
    } catch (e) { d.report(e); warm = null; return; }
    if (++w.ctor >= 2) warm = null;
  }

  /* ───────────────────────────── the Cutter ───────────────────────────── */

  /** the piece the swipe passes over most (samples along it), or null */
  function targetOf(x0: number, y0: number, x1: number, y1: number): Piece | null {
    const cam = d.stage.camera as unknown as CameraLike, vp = d.viewport();
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
    return target < 0 ? null : ps[target];
  }
  /** the legacy halving search for Minis (a plane through a lopsided copy's centre does not halve it): the parallel plane that halves the piece best, within 1.3 radii (measureCut on the deformed mesh) */
  function halving(p: Piece, plane: CutPlane): CutPlane {
    const share = (pl: CutPlane): number | null => {
      try { const fa = p.body.measureCut!(pl); return fa === null || !(fa > 0) || !(fa < 1) ? null : Math.min(fa, 1 - fa) * fracOf(p); } catch (e) { d.report(e); return null; }
    };
    const s0 = share(plane);
    if (s0 !== null && s0 >= PIECE_MIN - 1e-6) return plane;
    const n = plane.normal, R = 1.3 * radius(p);
    const at = (t: number): CutPlane => ({ point: { x: plane.point.x + n.x * t, y: plane.point.y + n.y * t, z: plane.point.z + n.z * t }, normal: n });
    const side = (t: number): number | null => {
      try { const fa = p.body.measureCut!(at(t)); return fa === null || !(fa > 0) || !(fa < 1) ? null : fa; } catch (e) { d.report(e); return null; }
    };
    let lo = -R, hi = R, best = plane, bestShare = s0 ?? 0;
    for (let i = 0; i < 18; i++) {
      const mid = 0.5 * (lo + hi), fa = side(mid);
      if (fa === null) { if (mid > 0) hi = mid; else lo = mid; continue; }
      const sh = Math.min(fa, 1 - fa) * fracOf(p);
      if (sh > bestShare) { bestShare = sh; best = at(mid); }
      if (bestShare >= PIECE_MIN - 1e-6 && Math.abs(fa - 0.5) < 0.01) break;
      if (fa > 0.5) lo = mid; else hi = mid;
    }
    return best;
  }

  const cutter: Cutter = {
    get supported() { return supported(); },
    get pieces() { return list().length; },
    fracs: () => list().map((p) => fracOf(p)),
    get busy() { return anim !== null; },
    get canSplit() { return list().length < maxN() && list().some((p) => fracOf(p) >= 2 * PIECE_MIN - 2 * PIECE_TOL); },
    get maxPieces() { return maxN(); },
    get style() { return style; },
    get canChangeStyle() { return pieces.length === 0 && anim === null; },
    setStyle(next) {
      if (next !== 'clean' && next !== 'minis') return false;
      if (next === style) return true;
      if (!cutter.canChangeStyle) { d.say(T.styleLocked); return false; }   // pieces made in one style cannot be mixed with the other (CUT_MINIS.md 2)
      style = next;
      warm = null;
      return true;
    },
    prewarm() {
      try {
        if (!supported() || anim || pieces.length || !isTrue()) return;
        const b = d.bodies.body, plan = newPlan();
        const ep = eyePlane(list()[0]);
        if (!b.planCut!(ep.plane, plan, ep.mode)) return;
        warm = { body: b, plan, frames: 16, ctor: 0 };
        try { d.stage.warmPieces?.(); } catch (e) { d.report(e); }
      } catch (e) { d.report(e); warm = null; }
    },
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
      const target = targetOf(x0, y0, x1, y1);
      if (!target) return 'miss';
      return startCut(target, plane, { button: false, mode: 'at', ends: endsAtDepth(x0, y0, x1, y1, target.body.center) });
    },
    splitInTwo() {
      if (!supported()) return 'unsupported';
      if (anim) return 'busy';
      const ps = list();
      let p = ps[0];
      for (const q of ps) if (fracOf(q) > fracOf(p) + 1e-9) p = q;
      // at the limit the limit line comes first (the Cut bar's hint does the same, cutText.barText): it is true whatever the sizes are (CUT2.md 12 X10: the sixth press says the limit line)
      if (ps.length >= maxN()) return refuse(p, T.limit, 'limit');
      if (fracOf(p) < 2 * PIECE_MIN - 2 * PIECE_TOL) { wobble(p.body); d.say(T.noneBigEnough(false)); return 'small'; }
      if (isTrue()) {
        if (ps.length === 1) { const ep = eyePlane(p); return startCut(p, ep.plane, { button: true, mode: ep.mode, ends: endsAcross(p, ep.plane) }); }
        const plane = candidatePlane(p);
        if (!plane) return 'miss';
        return startCut(p, plane, { button: true, mode: 'median', ends: endsAcross(p, plane) });
      }
      // Minis: the vertical plane through the camera and the piece's centre as the camera sees it, shifted to halve the piece
      const cam = d.stage.camera as unknown as CameraLike;
      try { cam.updateMatrixWorld?.(); } catch { /* a mock camera */ }
      const c = p.body.center, eye = cameraPosition(cam), view = unit(sub(c, eye));
      const w = cam.matrixWorld.elements;
      const up = unit({ x: w[4], y: w[5], z: w[6] }) ?? { x: 0, y: 1, z: 0 };
      const normal = view ? unit(cross(view, up)) : null;
      if (!normal) return 'miss';
      const plane = halving(p, { point: { x: c.x, y: c.y, z: c.z }, normal });
      return startCut(p, plane, { button: true, ends: endsAcross(p, plane) });
    },
    reconnectAll(animated) {
      if (!pieces.length && !anim) return false;
      abortAnim();
      if (pieces.length <= 1) { pieces = []; locked = null; tree = createCutTree(); return false; }
      contact = null;
      const face = pieces[0];
      const canAnimate = animated && typeof face.body.setFrac === 'function';
      if (!canAnimate) { finishAll(false); return true; }
      // the receiver is the largest piece (ties: the anchor); when that is not the anchor, the anchor flows in as a giver and the receiver becomes the play body at the end (promoteTo)
      let recv = face;
      for (const c of pieces) if (fracOf(c) > fracOf(recv) + 1e-9) recv = c;
      const flows = new Map<Piece, Flow>();
      for (const c of pieces) if (c !== recv) flows.set(c, flowOf(recv, c));   // planned from where everything stands now (before anything grows or shrinks)
      if (locked !== 'true') {
        try { recv.body.setFrac!(1, JOIN_ALL_S); } catch (e) { d.report(e); }
        for (const c of pieces) if (c !== recv) { try { c.body.setFrac?.(PIECE_MIN, JOIN_ALL_S); } catch (e) { d.report(e); } d.bodies.setGhost(c.body, true); }
      } else {
        // the clean style: the pieces meet the receiver mated and flush; as for a single join (startJoin) they take no part in contact on the way (gate S5a)
        for (const c of pieces) if (c !== recv) d.bodies.setGhost(c.body, true);
      }
      anim = { kind: 'all', t0: d.simTime(), dur: JOIN_ALL_S, recv, flows };
      return true;
    },
    update() {
      const t = d.simTime();
      if (wobbling && t >= wobbleUntil) { try { wobbling.tremble?.(0); } catch { /* optional */ } wobbling = null; }
      if (warm) stepWarm();
      if (parting) {
        const x = parting, act = d.touching() ? d.activeBody() : null;
        if (anim || (act !== null && (act === x.a.body || act === x.b.body)) || !pieces.includes(x.a) || !pieces.includes(x.b)) endParting();
        else stepParting(x, t);
      }
      const a = anim;
      if (a && a.kind === 'neck') {
        const k = smooth((t - a.t0) / a.neckS);
        if (a.plan && !a.ready) {
          let r: boolean | 'thin' | 'loose' = false;
          const over = t - a.t0 >= a.neckS + NECK_HOLD_S;
          try { r = a.p.body.prepareCut!(det ? Infinity : over ? 6 : 3, det ? (over ? 6 : 4) : undefined); } catch (e) { d.report(e); r = 'thin'; }
          if (r === true) a.ready = true;
          else if (r === 'thin' || r === 'loose') { anim = null; abandon(a, r === 'loose' ? T.loose : T.thin); return; }
        }
        if (a.plan && a.ready && !(a.pre.a && a.pre.b)) {
          // the meshes are cached: construct the pieces one per step (a constructor costs several ms), so the swap frame only places them
          try { if (!a.pre.a) a.pre.a = buildKid(a, 0); else a.pre.b = buildKid(a, 1); } catch (e) { d.report(e); anim = null; abandon(a, T.thin); return; }
        }
        if (a.plan) restPlaneToWorld(a.p.body, a.plan.rest, a.plane);
        try { a.p.body.setNeck!(a.plane, k, a.depth); } catch (e) { d.report(e); }
        try { if (a.view !== null) d.stage.setCutSeam?.(a.view, a.plane, k, a.from && a.to ? { from: a.from, to: a.to } : undefined); } catch (e) { d.report(e); }
        const tEnd = a.neckS + NECK_HOLD_S;
        if (t - a.t0 >= tEnd && (a.ready || !a.plan || t - a.t0 >= tEnd + NECK_HOLD_EXTRA_S)) { anim = null; part(a); }
        return;
      }
      if (a && a.kind === 'join') {
        const k = smooth((t - a.t0) / a.dur);
        setBridge(a.recv, a.giver, bridgeK(a.recv, a.giver, k));
        follow(a.recv, a.giver, a.flow, t - a.t0, a.dur);
        if (t - a.t0 >= a.dur) { anim = null; joined(a.recv, a.giver, false); }
        return;
      }
      if (a && a.kind === 'all') {
        const k = smooth((t - a.t0) / a.dur);
        const recv = a.recv;
        for (const c of pieces) {
          if (c === recv) continue;
          setBridge(recv, c, bridgeK(recv, c, k));
          const fl = a.flows.get(c);
          if (fl) follow(recv, c, fl, t - a.t0, a.dur);
        }
        if (t - a.t0 >= a.dur) {
          anim = null;
          for (const c of pieces) { if (c !== recv) setBridge(recv, c, 0); }
          if (recv !== pieces[0]) { for (const c of pieces) if (c !== recv) d.bodies.setGhost(c.body, false); promoteTo(recv); }
          finishAll(true);
          try { d.audio.rejoin?.({ frac: 1, all: true, pan: d.panOf(d.bodies.body.center), calm: d.calm(), pitch: pitch() }); } catch (e) { d.report(e); }
          try { d.haptics.release(); } catch { /* optional */ }
          d.say(T.whole);
        }
        return;
      }
      if (a && a.kind === 'home') {
        const c = a.face.body.center;
        // whatever travels with the anchor (the other half of a mated pair) keeps its place relative to it: the same step toward the middle
        for (const o of a.others) { try { const oc = o.body.center; o.body.moveTo?.({ x: oc.x - c.x, y: oc.y, z: oc.z - c.z }, 1.2); } catch { /* optional */ } }
        if (Math.hypot(c.x, c.z) <= HOME_NEAR * 0.5 || t - a.t0 >= HOME_MAX_S) { anim = null; swapWhole(a.face); }
        return;
      }
      // touch-to-join: a piece the finger DRAGS into another so that they touch for JOIN_HOLD_S, or is let go while they touch. The contact is only
      // STARTED by a drag toward the other piece (dragsInto); once it runs it is kept while the skins stay close (TOUCH_KEEP_GAP), whatever the finger does
      if (pieces.length < 2) { contact = null; return; }
      const touching = d.touching();
      const act = d.activeBody();
      const P = pieces.find((p) => p.body === act) ?? null;
      if (touching && P) {
        let Q: Piece | null = null, bestD = Infinity;
        for (const q of pieces) {
          if (q === P) continue;
          const m = gapBetween(P.body, q.body);
          const kept = !!contact && contact.a === P && contact.b === q;
          const lim = kept ? TOUCH_KEEP_GAP : TOUCH_GAP;
          if (m && m.g < lim && m.g < bestD && (kept || dragsInto(P, m.u))) { bestD = m.g; Q = q; }
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
        contact = null;
        const m = pieces.includes(c.a) && pieces.includes(c.b) ? gapBetween(c.a.body, c.b.body) : null;
        if (m && m.g < TOUCH_KEEP_GAP) startJoin(c.a, c.b);
      }
    },
    isPiece: (b) => pieces.some((p) => p.body === b),
    regions() {
      return list().map((p, i) => ({ frac: fracOf(p), cells: p.leaf ? p.leaf.lits.slice() : [], anchor: i === 0, x: p.body.center.x, y: p.body.center.y, z: p.body.center.z }));
    },
    dispose() { abortAnim(); pieces = []; locked = null; contact = null; },
  };
  return cutter;
}
