// Body manager: owns the PLAY body (the squishy the player touches) and, for stage B, extra bodies on the mat.
//
// Seams
//   * swapTo(genome): build the new body FIRST, then commit body + genome + identity together and hand it to the stage. If construction
//     throws, nothing changed (audit finding 3: the old setGenome assigned the genome before building).
//   * adopt(body, genome, tier): a ceremony's CeremonyHandle.resultBody becomes the play body. The stage already owns its view (it is the
//     primary), so adopt does NOT call stage.setBody (render handover, STAGE_API_FOR_SHELL 9).
//   * Both run the same beforeSwap / afterSwap hooks (release fingers, end voices, clear the event ring; apply gravity, fire listeners).
//   * step(dt) steps the play body and every extra body the shell added (the stage steps only the bodies it created itself). No allocation.
import type { SoftBodyLike, StageLike, TierName, V3 } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import { getSpecies, tierOf } from '../data/catalog.ts';

/** Who the play body is: the genome and, when it is a collection item, its id and nickname. */
export interface PlayIdentity {
  genome: Genome;
  tier: TierName;
  /** collection item id, null for a preview (?genome=) or a ghost the shell built itself */
  itemId: string | null;
  /** an optional nickname from the fixed list (COLLECTION 9.3); null = none */
  nickname: string | null;
}

export interface ExtraBody { id: number; body: SoftBodyLike; genome: Genome; tier: TierName }

export interface BodyManager {
  readonly body: SoftBodyLike;
  readonly identity: PlayIdentity;
  readonly extras: readonly ExtraBody[];
  /** Build a body for this genome without committing anything (throws whatever createBody throws). */
  build(genome: Genome): SoftBodyLike;
  /** Atomic swap to a new genome (or to a body built with `build`). Returns false (and changes nothing) when construction failed. */
  swapTo(genome: Genome, opts?: { itemId?: string | null; nickname?: string | null; body?: SoftBodyLike }): boolean;
  /** Adopt a body the STAGE already shows as its primary (a ceremony result). Never calls stage.setBody. */
  adopt(body: SoftBodyLike, genome: Genome, opts?: { itemId?: string | null; nickname?: string | null; tier?: TierName }): void;
  /** Stage B seam: another shell-owned body on the mat (stage.addBody). Returns the stage id, or -1 when the stage cannot. */
  addExtra(body: SoftBodyLike, genome: Genome, opts?: { tier?: TierName; position?: V3 }): number;
  removeExtra(id: number): void;
  step(dt: number): void;
}

export interface BodyManagerDeps {
  createBody(genome: Genome): SoftBodyLike;
  stage: StageLike;
  initial: { body: SoftBodyLike; identity: PlayIdentity };
  beforeSwap(): void;
  afterSwap(identity: PlayIdentity, body: SoftBodyLike): void;
  report(e: unknown): void;
}

/** The catalog tier of a genome's species ('common' for an unknown species). */
export function tierOfGenome(g: Genome): TierName {
  try { return getSpecies(g.species) ? tierOf(g.species) : 'common'; } catch { return 'common'; }
}

/** Apply the tier look to the primary body (round-2 stage member, feature-detected). */
export function styleTier(stage: StageLike, tier: TierName): void {
  try {
    const id = stage.primaryBodyId?.();
    if (id !== null && id !== undefined) stage.setBodyTier?.(id, tier);
  } catch { /* an old stage: the genome look alone */ }
}

export function createBodyManager(d: BodyManagerDeps): BodyManager {
  let body = d.initial.body;
  let identity = d.initial.identity;
  const extras: ExtraBody[] = [];

  /** viaStage: hand the body to the stage first (setBody may throw: then the play body is unchanged and the error propagates). */
  const commit = (b: SoftBodyLike, id: PlayIdentity, viaStage: boolean): void => {
    try { d.beforeSwap(); } catch (e) { d.report(e); }
    if (viaStage) d.stage.setBody(b, id.genome);
    body = b;
    identity = id;
    if (viaStage) styleTier(d.stage, id.tier);
    try { d.afterSwap(identity, body); } catch (e) { d.report(e); }
  };

  return {
    get body() { return body; },
    get identity() { return identity; },
    get extras() { return extras; },
    build: (g) => d.createBody(g),
    swapTo(genome, opts = {}) {
      try {
        const b = opts.body ?? d.createBody(genome);
        commit(b, { genome, tier: tierOfGenome(genome), itemId: opts.itemId ?? null, nickname: opts.nickname ?? null }, true);
        return true;
      } catch (e) { d.report(e); return false; }
    },
    adopt(b, genome, opts = {}) {
      commit(b, { genome, tier: opts.tier ?? tierOfGenome(genome), itemId: opts.itemId ?? null, nickname: opts.nickname ?? null }, false);
    },
    addExtra(b, genome, opts = {}) {
      if (!d.stage.addBody) return -1;
      const tier = opts.tier ?? tierOfGenome(genome);
      const id = d.stage.addBody(b, genome, { tier, position: opts.position });
      if (id >= 0) extras.push({ id, body: b, genome, tier });
      return id;
    },
    removeExtra(id) {
      const i = extras.findIndex((x) => x.id === id);
      if (i < 0) return;
      extras.splice(i, 1);
      try { d.stage.removeBody?.(id); } catch (e) { d.report(e); }
    },
    step(dt) {
      body.step(dt);
      for (let i = 0; i < extras.length; i++) extras[i].body.step(dt);
    },
  };
}
