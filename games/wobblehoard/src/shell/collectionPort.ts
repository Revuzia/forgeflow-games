// The shell's port to the collection (COLLECTION.md 3.4 `Collection`, built in src/collection/** by the collection lane).
// The shell codes against THIS small interface only; `adaptCollection` maps the collection module onto it, and the in-shell practice
// fallback (practiceFallback.ts) implements it until src/collection/index.ts lands.
//
// What the shell needs, and nothing more:
//   meter()        the HUD ring (COLLECTION 9.7): fill 0..1, credits (unopened capsules), and the four states
//   onChange(fn)   any of the above changed (the shell re-reads meter(); it never polls)
//   feed(ev, tMs)  every SoftEvent the frame loop drains, with an EPOCH ms time (meter.ts reads epoch times)
//   openCapsule()  RESULT FIRST (COLLECTION 10): the item is decided and stored before any animation starts
//   merge(...)     optional; SHELL-2b's merge pad calls it, then hands the result to the ceremony controller
//   markSeen(ids)  optional; the unseen dot clears after a reveal
import type { SoftEvent, TierName } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import { decodeGenome } from '../core/genome.ts';
import { TIERS } from '../core/rarity.ts';
import { tierOfGenome } from './bodies.ts';

export interface MeterReading {
  /** 0..1 toward the next capsule */
  fill: number;
  /** capsules earned and not opened yet (the table queue, at most 5: COLLECTION C-5) */
  credits: number;
  /** daily rate 25%: "Squishies are resting, filling slowly" */
  resting: boolean;
  /** the 12-a-day hard stop: "They'll be ready tomorrow" */
  doneToday: boolean;
  /** 5 unopened: "Table full: open one to keep going" */
  tableFull: boolean;
  /** signed in but no connection: "Waiting for connection" */
  offline: boolean;
}

export interface ItemView {
  itemId: string;
  genome: Genome;
  tier: TierName;
  /** first copy of this species in the active ledger */
  isNew: boolean;
  /** copies of this species after this item arrived (for the "x2" spare chip) */
  copies: number;
  nickname: string | null;
}

export type CapsuleOutcome = ({ ok: true } & ItemView) | { ok: false; error: string; message: string };

export interface MergeParentView { genome: Genome; tier: TierName }
export type MergeOutcome = ({ ok: true; tierUp: boolean; parents: MergeParentView[] } & ItemView) | { ok: false; error: string; message: string };

export interface ShellCollection {
  /** 'collection' = src/collection (practice or real ledger); 'fallback' = the in-shell stopgap */
  readonly source: 'collection' | 'fallback';
  meter(): MeterReading;
  onChange(fn: () => void): () => void;
  feed(ev: SoftEvent, tMs: number): void;
  openCapsule(): Promise<CapsuleOutcome>;
  merge?(ids: string[], digest: string): Promise<MergeOutcome>;
  markSeen?(ids: string[]): void;
  dispose?(): void;
  /** DEV ONLY (the harness accelerates the meter with it); absent from a real ledger */
  devGrant?(credits: number): void;
  /** DEV ONLY: run the real meter path with accelerated pokes until the ring reaches `fill` (or a capsule is earned) */
  devFill?(fill: number): void;
}

/* ───────────────────────── the collection module, as COLLECTION.md 3.4 / 10 sketches it (subject to change: adapt here only) ───────────────────────── */

/** Server-shaped replies (COLLECTION 10, MERGE 7): snake_case, genome as a g1. code, tier as an index. */
interface OpenResultLike { ok: boolean; error?: string; message?: string; item_id?: string; itemId?: string; genome_code?: string; genomeCode?: string; genome?: Genome; tier_idx?: number; tierIdx?: number; tier?: string; is_new?: boolean; isNew?: boolean; copies?: number; nickname?: string | null; tier_up?: boolean; tierUp?: boolean }
export interface CollectionLike {
  meter(): Partial<MeterReading> & { fill: number };
  onChange(fn: () => void): () => void;
  feed(ev: SoftEvent, tMs: number): void;
  openCapsule(): Promise<OpenResultLike>;
  merge?(ids: string[], digest: string): Promise<OpenResultLike>;
  markSeen?(ids: string[]): unknown;
  items?(ledger?: 'real' | 'practice'): Array<{ id: string; genome: Genome }>;
  dispose?(): void;
}

const tierName = (r: OpenResultLike): TierName => {
  if (typeof r.tier === 'string' && (TIERS as readonly string[]).includes(r.tier)) return r.tier as TierName;
  const i = typeof r.tier_idx === 'number' ? r.tier_idx : typeof r.tierIdx === 'number' ? r.tierIdx : 0;
  return (TIERS[i] ?? 'common') as TierName;
};

function toItem(r: OpenResultLike): ItemView | null {
  const code = r.genome_code ?? r.genomeCode;
  const genome = r.genome ?? (typeof code === 'string' ? decodeGenome(code) : null);
  const itemId = r.item_id ?? r.itemId;
  if (!genome || typeof itemId !== 'string') return null;
  const isNew = !!(r.is_new ?? r.isNew);
  return { itemId, genome, tier: tierName(r), isNew, copies: typeof r.copies === 'number' ? r.copies : isNew ? 1 : 2, nickname: r.nickname ?? null };
}

const refusal = (r: OpenResultLike | null, fallback: string): { ok: false; error: string; message: string } =>
  ({ ok: false, error: r?.error ?? 'bad_reply', message: r?.message ?? fallback });

/** Map the collection module (COLLECTION 3.4) onto the shell port. Never throws; a malformed reply becomes a refusal. */
export function adaptCollection(c: CollectionLike): ShellCollection {
  return {
    source: 'collection',
    meter() {
      const m = c.meter();
      return { fill: m.fill, credits: m.credits ?? 0, resting: !!m.resting, doneToday: !!m.doneToday, tableFull: !!m.tableFull, offline: !!m.offline };
    },
    onChange: (fn) => c.onChange(fn),
    feed: (ev, t) => c.feed(ev, t),
    async openCapsule() {
      let r: OpenResultLike | null = null;
      try { r = await c.openCapsule(); } catch { return refusal(null, 'Something went wrong. Reload and try again.'); }
      if (!r || !r.ok) return refusal(r, 'That one fizzled. Keep squishing.');
      const item = toItem(r);
      return item ? { ok: true, ...item } : refusal(r, 'Something went wrong. Reload and try again.');
    },
    merge: c.merge ? async (ids, digest) => {
      let r: OpenResultLike | null = null;
      try { r = await c.merge!(ids, digest); } catch { return refusal(null, 'Something went wrong. Reload and try again.'); }
      if (!r || !r.ok) return refusal(r, 'That merge did not go through.');
      const item = toItem(r);
      if (!item) return refusal(r, 'Something went wrong. Reload and try again.');
      const all = c.items?.() ?? [];
      const parents = ids.map((id) => all.find((x) => x.id === id)).filter((x): x is { id: string; genome: Genome } => !!x)
        .map((x) => ({ genome: x.genome, tier: tierOfGenome(x.genome) }));
      return { ok: true, ...item, tierUp: !!(r.tier_up ?? r.tierUp), parents };
    } : undefined,
    markSeen: c.markSeen ? (ids) => { void c.markSeen!(ids); } : undefined,
    dispose: c.dispose ? () => c.dispose!() : undefined,
  };
}
