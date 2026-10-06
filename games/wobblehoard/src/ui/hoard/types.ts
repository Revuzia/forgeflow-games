// The Hoard UI's port to the rest of the game (SHELL-2b). src/ui/hoard/** may import only the collection module, ui/dom.ts, ui/theme.ts
// and contracts.ts types (probe_collection_imports.ts I07), so everything else it needs (catalog words, tier gems, species icons, the live
// squishy, the ceremonies, the play mat, announcements) comes in through this one object, built by src/shell/hoardEnv.ts.
import type { TierName } from '../../contracts.ts';
import type { ClaimOk, Collection, HoardItem, MergeOk } from '../../collection/types.ts';

export interface SpeciesWords {
  name: string;
  /** the catalog's one friendly line */
  blurb: string;
  /** material family display name ("Jelly Gel") and its feel line */
  family: string;
  familyBlurb: string;
  /** feel lane name ("Jelly") and index in `lanes` */
  lane: string;
  laneIdx: number;
}

export interface HoardEnv {
  readonly collection: Collection;
  species(id: string): SpeciesWords | null;
  /** the six feel lanes in filter order */
  readonly lanes: readonly string[];
  /** the six tiers in order, with their display words */
  readonly tiers: readonly { id: TierName; label: string }[];
  /** the tier gem (shape + frame colour; decorative, the word is always written too) */
  gem(tier: TierName, cls?: string): SVGSVGElement;
  /** a species picture (decorative); silhouette = unowned */
  icon(species: string, opts?: { silhouette?: boolean; cls?: string }): SVGSVGElement;
  /** a small swatch for ONE copy: its own hue and lightness (copies of a species differ inside the species' bands) */
  swatch(item: HoardItem): HTMLElement;
  readonly mergeCost: number;
  readonly holdMs: number;
  readonly topTierIdx: number;

  /** show this copy as the live squishy (the card); false when the body could not be built */
  focus(item: HoardItem): boolean;
  /** put the player's own squishy back (closing the card) */
  restore(): void;
  /** this copy becomes the play body for good (it stays after the card closes) */
  playWith(item: HoardItem): boolean;
  /** the item the play body currently is, or null */
  playItemId(): string | null;
  /** the reveal of a restock pick (result first: the item is already stored) */
  revealClaim(r: ClaimOk): Promise<void>;
  /** replay the reveal of an unseen copy (COLLECTION 9.3) */
  replayReveal(item: HoardItem): Promise<void>;
  /** the merge ceremony for a result the collection already stored (MERGE 7) */
  playMerge(r: MergeOk): Promise<void>;
  /** a ceremony runs or waits */
  busy(): boolean;
  /** run fn now, or right after the ceremony that runs (or waits) has ended */
  whenIdle(fn: () => void): void;
  /** the DOM twin of the capsule on the table */
  openCapsule(): Promise<void>;

  readonly mat: {
    readonly count: number;
    readonly limit: number;
    has(itemId: string): boolean;
    /** null = it may come out, else the reason in plain words */
    refusal(item: HoardItem): string | null;
    bringOut(item: HoardItem): string | null;
    putBack(itemId: string): void;
    clear(): void;
    onChange(fn: () => void): () => void;
  };

  /** the Hoard is about to open: a cut squishy goes back together first (CUT.md 2.2), animated when the stage stays in view */
  beforeOpen?(): void;
  /** keep the stage's input away while a panel covers it */
  holdInput(on: boolean): void;
  /** the panel covers the whole stage (phone): pause the sim and the sound under it */
  cover(on: boolean): void;
  announce(text: string): void;
  toast(text: string): void;
  now(): number;
  calm(): boolean;
  /** where keyboard focus goes when the Hoard closes */
  returnFocus(): HTMLElement | null;
}
