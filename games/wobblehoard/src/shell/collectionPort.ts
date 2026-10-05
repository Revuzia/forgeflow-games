// The shell's port to the collection (src/collection, COLLECTION.md 3.4). The shell's own modules (capsules.ts, ceremonies.ts, game.ts)
// code against THIS small interface only; adaptCollection maps the collection module onto it. SHELL-2b's Hoard and merge pad use the
// full `Collection` (game.hoard) for stacks, previews and hearts, and hand a merge result to game.playMerge.
//
// What the shell needs, and nothing more:
//   meter()        the HUD ring (COLLECTION 9.7): fill 0..1, credits (unopened capsules), and the four states
//   onChange(fn)   any of the above changed (the shell re-reads meter(); it never polls)
//   onEvent(fn)    transitions: a capsule is ready (the meter-full cue), table full / resting / done for today (announced once),
//                  the save started or stopped failing, another tab changed the Hoard
//   feed(ev, tMs)  every SoftEvent the frame loop drains (any ms clock: the collection anchors it to the epoch)
//   openCapsule()  RESULT FIRST (COLLECTION 10): the item is decided and stored before any animation starts
//   merge(...)     MERGE 7: the result (and the consumed parents) before the ceremony
//   markSeen(ids)  the unseen dot clears after a reveal
//   flush / sync   lifecycle: write on pagehide, fold in another tab's change on focus
//   loadNotice()   what to tell the player about how the shelf was loaded (copy.ts), or null
import type { SoftEvent, TierName } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import { TIERS } from '../core/rarity.ts';
import { COPY, loadStatusCopy, saveStateCopy } from '../collection/copy.ts';
import type { Collection, CollectionEvent, HoardItem, MergeOk, OpenOk } from '../collection/index.ts';

export interface MeterReading {
  /** 0..1 toward the next capsule */
  fill: number;
  /** capsules earned and not opened yet (play + task) */
  credits: number;
  /** daily rate 25%: "Squishies are resting, filling slowly" */
  resting: boolean;
  /** the 12-a-day hard stop: "They'll be ready tomorrow" */
  doneToday: boolean;
  /** 5 unopened play capsules: "Table full: open one to keep going" */
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
  /** copies of this species after this item arrived (for the "x2 spare" chip) */
  copies: number;
  nickname: string | null;
  /** the collection's own "may quick-pop" (a repeat Common or Uncommon); undefined = the shell decides from isNew and tier */
  quickEligible?: boolean;
}

export type CapsuleOutcome = ({ ok: true } & ItemView) | { ok: false; error: string; message: string };

export interface MergeParentView { genome: Genome; tier: TierName }
export type MergeOutcome = ({ ok: true; tierUp: boolean; parents: MergeParentView[] } & ItemView) | { ok: false; error: string; message: string };

export type PortEvent =
  | { type: 'capsule'; credits: number }
  | { type: 'notice'; text: string }       // table full / resting / done for today / a save problem: a polite announcement
  | { type: 'external' };                  // another tab changed the Hoard

export interface ShellCollection {
  meter(): MeterReading;
  onChange(fn: () => void): () => void;
  onEvent(fn: (e: PortEvent) => void): () => void;
  feed(ev: SoftEvent, tMs: number): void;
  openCapsule(): Promise<CapsuleOutcome>;
  merge(ids: string[], digest: string): Promise<MergeOutcome>;
  markSeen(ids: string[]): void;
  flush(): void;
  sync(): void;
  /** the boot-time storage notice (a recovered or newer shelf, no storage), or null */
  loadNotice(): string | null;
  dispose(): void;
}

const tierName = (i: number): TierName => (TIERS[i] ?? 'common') as TierName;

const itemView = (r: { item_id: string; tier_idx: number; is_new: boolean; copies: number; item: HoardItem }, quick?: boolean): ItemView =>
  ({ itemId: r.item_id, genome: r.item.genome, tier: tierName(r.tier_idx), isNew: r.is_new, copies: r.copies, nickname: null, quickEligible: quick });

/** Map the collection module onto the shell port. Never throws; a malformed or failed call becomes a refusal with player copy. */
export function adaptCollection(c: Collection): ShellCollection {
  return {
    meter() {
      const m = c.meter();
      return { fill: m.fill, credits: m.credits, resting: m.resting, doneToday: m.doneToday, tableFull: m.tableFull, offline: m.offline };
    },
    onChange: (fn) => c.onChange(fn),
    onEvent(fn) {
      return c.onEvent((e: CollectionEvent) => {
        switch (e.type) {
          case 'capsule': fn({ type: 'capsule', credits: e.credits }); break;
          case 'table-full': fn({ type: 'notice', text: COPY.tableFull }); break;
          case 'resting': fn({ type: 'notice', text: COPY.resting }); break;
          case 'done-today': fn({ type: 'notice', text: COPY.doneToday }); break;
          case 'storage': { const t = saveStateCopy(e.report.save); if (t) fn({ type: 'notice', text: t }); break; }
          case 'external': fn({ type: 'external' }); break;
        }
      });
    },
    feed: (ev, t) => c.feed(ev, t),
    async openCapsule() {
      try {
        const r = await c.openCapsule();
        if (!r.ok) return { ok: false, error: r.error, message: r.message ?? COPY.noCapsule };
        const ok = r as OpenOk;
        return { ok: true, ...itemView(ok, ok.quick) };
      } catch { return { ok: false, error: 'exception', message: COPY.somethingWrong }; }
    },
    async merge(ids, digest) {
      try {
        const r = await c.merge(ids, digest);
        if (!r.ok) return { ok: false, error: r.error, message: r.message ?? COPY.somethingWrong };
        const ok = r as MergeOk;
        // the consumed copies are already gone from items(): the result carries them (MergeOk.parents)
        return { ok: true, ...itemView(ok), tierUp: ok.tier_up, parents: ok.parents.map((p) => ({ genome: p.genome, tier: p.tier as TierName })) };
      } catch { return { ok: false, error: 'exception', message: COPY.somethingWrong }; }
    },
    markSeen(ids) { void c.markSeen(ids).catch(() => { /* a failed mark only leaves the dot */ }); },
    flush: () => c.flush(),
    sync: () => c.sync(),
    loadNotice: () => loadStatusCopy(c.storage().load),
    dispose: () => c.dispose(),
  };
}
