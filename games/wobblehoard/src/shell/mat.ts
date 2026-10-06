// The play mat (stage B1, NEXT_STEPS B1): bring 2 to 5 squishies out of the Hoard at once.
//
//   * The play body stays where it is (drawn at the origin, its own corral); every squishy brought out is an EXTRA body (bodies.ts) with
//     its own physics origin and corral, DRAWN at a render offset (stage.addBody position). Body-to-body contact does not exist yet
//     (a later physics round), so the offsets keep them apart: the render lane's stage.matLayout(n) when it offers one (a row on a wide
//     frame, staggered rows on a portrait phone; the camera frames them all by itself), else a plain row. The layout is shifted so the
//     play body's slot is the origin.
//   * Fingers act on whichever body the press hits (game.ts picks the body; the gesture host then works in that body's space).
//   * How many: by quality tier (low 3, med 4, high 5, the play body included) and by the measured frame cost: when the stage's frame
//     time average is already over FRAME_BUSY_MS nothing more comes out ("The mat is busy enough right now").
//   * Put back: remove one, or clear() them all with one tap. A ceremony clears the mat first (it shows its own bodies).
import type { QualityTier, SoftBodyLike, StageLike, TierName, V3 } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import type { BodyManager, ExtraBody } from './bodies.ts';

/** Squishies on the mat at once, the play body included, by quality tier. */
export const MAT_LIMIT: Readonly<Record<QualityTier, number>> = { low: 3, med: 4, high: 5 };
/** Frame time average (ms) above which nothing more is brought out. */
export const FRAME_BUSY_MS = 30;

export interface MatItem { genome: Genome; itemId: string | null; tier?: TierName; name?: string }

export type MatRefusal = 'full' | 'busy' | 'already' | 'unsupported' | 'failed';

export interface Mat {
  /** bodies on the mat, the play body included (1 = nothing brought out) */
  readonly count: number;
  /** the most squishies allowed out at this quality tier, the play body included */
  readonly limit: number;
  /** item ids of the squishies brought out (not the play body), in mat order */
  readonly itemIds: readonly string[];
  has(itemId: string | null): boolean;
  /** null = it may come out; otherwise why not */
  refusal(item?: MatItem): MatRefusal | null;
  add(item: MatItem): MatRefusal | null;
  remove(itemId: string): boolean;
  /** put every extra back (one tap) */
  clear(): void;
  onChange(fn: () => void): () => void;
}

export interface MatDeps {
  bodies: BodyManager;
  stage: StageLike;
  createBody(g: Genome): SoftBodyLike;
  gravity(): boolean;
  quality(): QualityTier;
  frameMs(): number;
  /** fingers off every body before the mat changes (the active body may go away) */
  beforeChange(): void;
  report(e: unknown): void;
}

/** A plain row (in rest radii of the play body) when the stage has no matLayout. */
function fallbackLayout(n: number, r: number): V3[] {
  const out: V3[] = [];
  const step = 2.6 * r;
  for (let i = 0; i < n; i++) { const k = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2); out.push({ x: k * step, y: 0, z: -0.4 * r * (i ? 1 : 0) }); }
  return out;
}

export function createMat(d: MatDeps): Mat {
  let listeners: Array<() => void> = [];
  const notify = (): void => { for (const f of listeners) { try { f(); } catch (e) { d.report(e); } } };
  const limit = (): number => MAT_LIMIT[d.quality()] ?? 3;

  /** offsets for the extras so that the play body's slot is the origin */
  function offsets(n: number): V3[] {
    const ml = (d.stage as StageLike & { matLayout?: (n: number) => V3[] }).matLayout;
    let L: V3[] = [];
    try { if (typeof ml === 'function') L = ml.call(d.stage, n); } catch (e) { d.report(e); }
    if (!Array.isArray(L) || L.length < n) L = fallbackLayout(n, d.bodies.body.restRadius || 0.5);
    const o = L[0];
    return L.slice(1, n).map((p) => ({ x: p.x - o.x, y: p.y - o.y, z: p.z - o.z }));
  }
  const relayout = (): void => { d.bodies.placeExtras(offsets(d.bodies.extras.length + 1)); };

  const mat: Mat = {
    get count() { return d.bodies.extras.length + 1; },
    get limit() { return limit(); },
    get itemIds() { return d.bodies.extras.map((x) => x.itemId ?? ''); },
    has: (id) => id !== null && d.bodies.extras.some((x) => x.itemId === id),
    refusal(item) {
      if (!d.stage.addBody) return 'unsupported';
      if (item && item.itemId !== null && (mat.has(item.itemId))) return 'already';
      if (d.bodies.extras.length + 1 >= limit()) return 'full';
      if (d.bodies.extras.length > 0 && d.frameMs() > FRAME_BUSY_MS) return 'busy';
      return null;
    },
    add(item) {
      const why = mat.refusal(item);
      if (why) return why;
      let b: SoftBodyLike;
      try { b = d.createBody(item.genome); } catch (e) { d.report(e); return 'failed'; }
      try { b.gravity = d.gravity(); } catch { /* optional */ }
      d.beforeChange();
      const n = d.bodies.extras.length + 2;
      const pos = offsets(n);
      d.bodies.placeExtras(pos);
      const id = d.bodies.addExtra(b, item.genome, { tier: item.tier, position: pos[n - 2], itemId: item.itemId });
      if (id < 0) { relayout(); return 'failed'; }
      notify();
      return null;
    },
    remove(itemId) {
      const x: ExtraBody | undefined = d.bodies.extras.find((e) => e.itemId === itemId);
      if (!x) return false;
      d.beforeChange();
      d.bodies.removeExtra(x.id);
      relayout();
      notify();
      return true;
    },
    clear() {
      if (!d.bodies.extras.length) return;
      d.beforeChange();
      for (const x of d.bodies.extras.slice()) d.bodies.removeExtra(x.id);
      notify();
    },
    onChange(fn) { listeners = listeners.concat(fn); return () => { listeners = listeners.filter((f) => f !== fn); }; },
  };
  return mat;
}
