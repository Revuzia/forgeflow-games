// Ceremony controller: plays the capsule reveal and the merge ceremony on the stage (round 2), fires the audio and haptics on the beats
// (SOUND.md "Time map the shell should follow", DESIGN 6.3 / 6.4 / 6.7), gates the player's skip, and adopts the result body.
// RESULT FIRST (COLLECTION 10, MERGE 7): callers pass an item the collection already decided; nothing here can change it.
//
// Capsule beats -> sound and haptics (render handover STAGE_API_FOR_SHELL 5; times for a normal Common, x0.65 in calm):
//   grab 0      capsuleBeat grab            crack 0.35   capsuleBeat crack (tier-agnostic: never spoils the tier)
//   preroll     (Rare+ at 0.65) reveal({ tier, isNew, mythicVariant, calm }): its first 0.3-1.0 s is the swell; Mythic ducks itself
//   burst       capsuleBeat burst { tier } + the DESIGN 6.7 tier haptic
//   reveal      Common / Uncommon: reveal({ tier, isNew, calm }); the name plate and the NEW / x2 chip; the live-region announcement
// Merge beats: press -> mergeStart({ tier, calm }) + the rumble; burst -> mh.burst({ tier, tierUp, mythicVariant }) + tier haptic;
//   reveal -> plate (+ TIER UP). If 'reveal' arrives without 'burst' (a skip before it) the hum is stopped and the short motif plays.
// Skip: a tap or key during a ceremony is consumed; from 350 ms on it calls handle.skip() (DESIGN 6.1; the stage itself accepts skip() at
// 0 s, so this gate is the only one). Settings.skipAnimations skips at once. Calm: stage.setCalmEffects(calm) right before the start and
// `calm` on every ceremony sound (the sounds scale their own times).
// Spacing (flash safety, DESIGN 6.6): a capsule reveal or merge never STARTS within BURST_SPACING_MS of the previous ceremony's 'burst'
// beat (skip-then-open and back-to-back quick pops would otherwise put 4+ luminance changes in one second). Requests are queued in
// order and start when the second has passed (game time: the gesture clock, frozen while paused); nothing is dropped, and a request
// that arrives while a ceremony runs waits for it instead of being lost.
// The end: await handle.done, then adopt handle.resultBody as the play body (no setBody); without a round-2 stage: a plain reveal card.
import type { CapsuleHandle, CeremonyBeat, CeremonyHandle, SoftBodyLike, SquishAudio, StageLike, TierName } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import { SPECIES_BY_TIER, getSpecies } from '../data/catalog.ts';
import type { Haptics } from '../input/haptics.ts';
import { TIER_HAPTICS, mergeRumble } from '../input/haptics.ts';
import type { BodyManager } from './bodies.ts';
import type { ItemView, MergeParentView } from './collectionPort.ts';

export const SKIP_GATE_MS = 350;
/** DESIGN 6.6 flash safety: the next ceremony starts at least this long after the previous one's 'burst' beat */
export const BURST_SPACING_MS = 1000;
/** SOUND.md default merge chargeS by result tier (= the render's burst times) */
const CHARGE_S: Readonly<Record<TierName, number>> = { common: 1.3, uncommon: 1.5, rare: 1.8, epic: 2.1, legendary: 2.4, mythic: 2.8 };

export interface RevealInfo {
  kind: 'capsule' | 'merge';
  item: ItemView;
  speciesName: string;
  tierUp: boolean;
  /** the player skipped (or Skip animations) */
  skipped: boolean;
}

export interface CeremonyUi {
  /** a ceremony starts: input is locked except skip */
  start(kind: 'capsule' | 'merge'): void;
  /** the reveal beat (or the end, if it never came): name plate, NEW / x2 / TIER UP, announcement */
  reveal(info: RevealInfo): void;
  /** it is over and the result is the play body */
  end(info: RevealInfo): void;
}

export interface BeatRecord { kind: 'capsule' | 'merge'; beat: CeremonyBeat; t: number }

export interface Ceremonies {
  readonly active: boolean;
  /** a ceremony request waits (for the running one, or for the 1 s burst spacing) */
  readonly pending: boolean;
  readonly kind: 'capsule' | 'merge' | null;
  /** ms since the current ceremony started (0 when none) */
  elapsedMs(): number;
  /** the planned duration of the current ceremony, s */
  readonly duration: number;
  playReveal(item: ItemView, opts?: { capsule?: CapsuleHandle | null }): Promise<void>;
  playMerge(parents: MergeParentView[], result: ItemView & { tierUp: boolean }): Promise<void>;
  /** A tap or key while a ceremony runs. Returns true when it was consumed (always while active); skips from 350 ms on. */
  tapSkip(): boolean;
  /** stop sounds (dispose / context loss give-up); queued requests are dropped (their promises resolve) */
  abort(): void;
  /** every sim step: start a queued request once the spacing allows */
  update(): void;
  /** the last beats with their gesture-clock times (ms), oldest first (dev readout and checks) */
  recentBeats(): BeatRecord[];
}

export interface CeremonyDeps {
  stage: StageLike;
  audio: SquishAudio;
  haptics: Haptics;
  bodies: BodyManager;
  createBody(g: Genome): SoftBodyLike;
  /** ms clock (the gesture clock: frozen while paused, advanced by DebugHook.step) */
  now(): number;
  calm(): boolean;
  skipAnimations(): boolean;
  fastOpen(): boolean;
  /** release every finger / voice before the stage takes over */
  beforeStart(): void;
  markSeen(ids: string[]): void;
  ui: CeremonyUi;
  report(e: unknown): void;
}

export const speciesName = (g: Genome): string => getSpecies(g.species)?.name ?? 'Squishy';
const mythicVariant = (g: Genome): number => { const i = SPECIES_BY_TIER[5].findIndex((s) => s.id === g.species); return i < 0 ? 0 : i % 3; };

export function createCeremonies(d: CeremonyDeps): Ceremonies {
  let active: 'capsule' | 'merge' | null = null;
  let handle: CeremonyHandle | null = null;
  let startedAt = 0;
  let merge: { stop(): void; burst(p: { tier: TierName; tierUp?: boolean; mythicVariant?: number; durationS?: number }): void } | null = null;
  let lastBurstAt = -Infinity;
  const queue: Array<{ start(): void; drop(): void }> = [];
  const beats: BeatRecord[] = [];

  const safe = (fn: () => void): void => { try { fn(); } catch (e) { d.report(e); } };
  const noteBeat = (kind: 'capsule' | 'merge', beat: CeremonyBeat): void => {
    const t = d.now();
    if (beat === 'burst') lastBurstAt = t;
    beats.push({ kind, beat, t });
    if (beats.length > 24) beats.shift();
  };
  const canStart = (): boolean => active === null && d.now() - lastBurstAt >= BURST_SPACING_MS;
  function pump(): void {
    while (queue.length && canStart()) queue.shift()!.start();   // start() runs begin() synchronously: active is set, the loop ends
  }
  /** queue a ceremony; it starts at once when nothing runs and the last burst is >= 1 s old */
  function enqueue(run: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve) => {
      queue.push({ start: () => { run().then(resolve, (e) => { d.report(e); resolve(); }); }, drop: resolve });
      pump();
    });
  }

  /** the shared tail: wait for the stage, adopt the result, tell the UI */
  async function finish(h: CeremonyHandle | null, info: RevealInfo, revealShown: () => boolean): Promise<void> {
    if (h) await h.done;
    const { item } = info;
    if (h && h.resultBody) d.bodies.adopt(h.resultBody, item.genome, { itemId: item.itemId, nickname: item.nickname, tier: item.tier });
    else d.bodies.swapTo(item.genome, { itemId: item.itemId, nickname: item.nickname });   // no round-2 stage, or a disposed one
    if (!revealShown()) safe(() => d.ui.reveal(info));
    safe(() => d.markSeen([item.itemId]));
    handle = null; merge = null; active = null;
    safe(() => d.ui.end(info));
    pump();
  }

  function begin(kind: 'capsule' | 'merge'): boolean {
    if (active) return false;
    active = kind;
    startedAt = d.now();
    safe(() => d.beforeStart());
    safe(() => d.stage.setCalmEffects?.(d.calm()));
    safe(() => d.ui.start(kind));
    return true;
  }

  return {
    get active() { return active !== null; },
    get pending() { return queue.length > 0; },
    get kind() { return active; },
    get duration() { return handle?.duration ?? 0; },
    elapsedMs: () => (active ? d.now() - startedAt : 0),

    playReveal: (item, opts = {}) => enqueue(() => runReveal(item, opts)),
    playMerge: (parents, result) => enqueue(() => runMerge(parents, result)),

    tapSkip() {
      if (!active) return false;
      if (handle && handle.active && d.now() - startedAt >= SKIP_GATE_MS) safe(() => handle!.skip());
      return true;
    },

    abort() {
      safe(() => merge?.stop());
      merge = null;
      safe(() => d.haptics.cancel());
      if (handle && handle.active) safe(() => handle!.skip());
      for (const q of queue.splice(0)) q.drop();
    },

    update() { if (queue.length) pump(); },
    recentBeats: () => beats.slice(),
  };

  async function runReveal(item: ItemView, opts: { capsule?: CapsuleHandle | null }): Promise<void> {
    if (!begin('capsule')) return;
    const calm = d.calm();
    const info: RevealInfo = { kind: 'capsule', item, speciesName: speciesName(item.genome), tierUp: false, skipped: false };
    let shown = false, burst = false, preroll = false;
    // DESIGN 6.1: a repeat Common is always the 0.8 s quick pop ("repeat Commons never hold the player"); Fast open adds repeat Uncommons.
    // The collection's own eligibility (OpenOk.quick: a repeat Common or Uncommon) gates it when it is given.
    const repeatLow = item.quickEligible ?? (!item.isNew && (item.tier === 'common' || item.tier === 'uncommon'));
    const quick = repeatLow && (item.tier === 'common' || d.fastOpen());
    const rare = item.tier !== 'common' && item.tier !== 'uncommon';
    const mv = mythicVariant(item.genome);
    const onBeat = (beat: CeremonyBeat, at: { t: number }): void => {
      const a = d.audio;
      noteBeat('capsule', beat);
      switch (beat) {
        case 'grab': safe(() => a.capsuleBeat?.({ beat: 'grab', progress: 1, calm })); break;
        case 'crack': safe(() => a.capsuleBeat?.({ beat: 'crack', calm })); break;
        case 'preroll': preroll = true; safe(() => a.reveal?.({ tier: item.tier, isNew: item.isNew, mythicVariant: mv, calm })); break;
        case 'burst':
          burst = true;
          safe(() => a.capsuleBeat?.({ beat: 'burst', tier: item.tier, calm }));
          safe(() => d.haptics.pattern?.(TIER_HAPTICS[item.tier]));
          break;
        case 'reveal': {
          info.skipped = !burst;
          if (!rare || !preroll) {
            // Common / Uncommon motif lands here; after a skip that came before the pre-roll a Rare+ motif plays here too (short)
            const left = handle ? Math.max(0.3, handle.duration - at.t) / (calm ? 0.65 : 1) : undefined;
            safe(() => a.reveal?.({ tier: item.tier, isNew: item.isNew, mythicVariant: mv, calm, durationS: quick || !burst ? left : undefined }));
          }
          if (!burst) safe(() => d.haptics.pattern?.(TIER_HAPTICS[item.tier]));
          shown = true;
          safe(() => d.ui.reveal(info));
          break;
        }
        default: break;
      }
    };
    let h: CeremonyHandle | null = null;
    if (d.stage.playCapsuleReveal) {
      try {
        h = d.stage.playCapsuleReveal({ result: { genome: item.genome, tier: item.tier, isNew: item.isNew }, createBody: d.createBody, capsule: opts.capsule ?? undefined, quick, keepCurrent: false }, { onBeat });
      } catch (e) { d.report(e); h = null; }
    }
    handle = h;
    if (!h) {
      // no round-2 stage: the plain reveal card, the tier motif and haptic (the result is never hidden)
      safe(() => d.audio.reveal?.({ tier: item.tier, isNew: item.isNew, mythicVariant: mv, calm }));
      safe(() => d.haptics.pattern?.(TIER_HAPTICS[item.tier]));
    } else if (d.skipAnimations()) safe(() => h!.skip());
    await finish(h, info, () => shown);
  }

  async function runMerge(parents: MergeParentView[], result: ItemView & { tierUp: boolean }): Promise<void> {
    if (!begin('merge')) return;
    const calm = d.calm();
    const info: RevealInfo = { kind: 'merge', item: result, speciesName: speciesName(result.genome), tierUp: result.tierUp, skipped: false };
    let shown = false, burst = false;
    const mv = mythicVariant(result.genome);
    const onBeat = (beat: CeremonyBeat): void => {
      const a = d.audio;
      noteBeat('merge', beat);
      switch (beat) {
        case 'press':
          safe(() => { merge = a.mergeStart?.({ tier: result.tier, calm }) ?? null; });
          safe(() => d.haptics.pattern?.(mergeRumble(CHARGE_S[result.tier] * (calm ? 0.65 : 1))));
          break;
        case 'burst':
          burst = true;
          safe(() => merge?.burst({ tier: result.tier, tierUp: result.tierUp, mythicVariant: mv }));
          safe(() => d.haptics.pattern?.(TIER_HAPTICS[result.tier]));
          break;
        case 'reveal':
          if (!burst) {
            // skipped before T3: stop the hum (render handover 7) and still let the tier be heard and felt
            info.skipped = true;
            safe(() => merge?.stop());
            safe(() => d.haptics.cancel());
            safe(() => a.reveal?.({ tier: result.tier, tierUp: result.tierUp, isNew: result.isNew, mythicVariant: mv, calm, durationS: 1.2 }));
            safe(() => d.haptics.pattern?.(TIER_HAPTICS[result.tier]));
          }
          shown = true;
          safe(() => d.ui.reveal(info));
          break;
        default: break;
      }
    };
    let h: CeremonyHandle | null = null;
    if (d.stage.playMergeCeremony) {
      try {
        h = d.stage.playMergeCeremony({ parents: parents.map((p) => ({ genome: p.genome, tier: p.tier })), result: { genome: result.genome, tier: result.tier, tierUp: result.tierUp, isNew: result.isNew }, createBody: d.createBody }, { onBeat });
      } catch (e) { d.report(e); h = null; }
    }
    handle = h;
    if (!h) {
      safe(() => d.audio.reveal?.({ tier: result.tier, tierUp: result.tierUp, isNew: result.isNew, mythicVariant: mv, calm }));
      safe(() => d.haptics.pattern?.(TIER_HAPTICS[result.tier]));
    } else if (d.skipAnimations()) safe(() => h!.skip());
    await finish(h, info, () => shown);
  }
}
