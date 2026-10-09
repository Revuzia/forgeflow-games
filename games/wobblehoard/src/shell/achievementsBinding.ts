// The trophies' wiring (UI.md B6a): the game's REAL events -> core/achievements.ts, the earned set -> core/achStore.ts, the unlocks -> the portal bridge and the
// toast hook. Everything here is observation: nothing in the game changes behaviour, and a failure in any part is swallowed (a trophy must never break play).
//
//   boot.ts:   const ach = createAchievements({ storage, now: epochNow, subscribe });
//              game = createGame({ ..., collection: ach.observe(hoard) });      // BEFORE createGame: the game, the Hoard panel and the capsule table
//              const offAch = ach.attach(game, { announce });                    //   all use that one object, so every open / merge / task passes through it
//   Where each fact really comes from (the publication memo's trigger table, checked against src 2026-10-09):
//     squeeze / stretch / toss / medley   collection.feed(ev, tMs)     game.ts drainBody calls it for every SoftEvent (a Shift pull's second hand is skipped before it)
//     carried                             game.onStep: SoftMetrics.carried of the play body or a mat body (feedback.ts lifts and tosses on the same flag)
//     pieces / join                       game.onStep: Cutter.pieces and Cutter.busy. NOT the shell `cut` event: game.ts emits it only for a Cut-tool swipe
//                                         (never for Split in two) and nothing ever emits 'joined', so that event cannot carry first_cut or whole_again
//     open / merge / task / Tidy-up       collection.openCapsule / merge / tidy / completeTask results (collection/index.ts :263 :290 :277; Tidy runs its merges inside)
//     species                             collection.stacks() after every open / merge / restock / Tidy-up and when another tab changed the Hoard; once at attach
import type { Collection, MergeResult, OpenResult, TaskResult, TidyResult } from '../collection/types.ts';
import type { SoftMetrics } from '../contracts.ts';
import type { AchievementDef, AchSave, Evaluator } from '../core/achievements.ts';
import { ACHIEVEMENTS, ACH_BY_SLUG, createEvaluator } from '../core/achievements.ts';
import type { AchStore } from '../core/achStore.ts';
import { createAchStore } from '../core/achStore.ts';
import type { StorageSubscribe } from '../core/save.ts';
import type { StorageLike } from '../core/settings.ts';
import { browserEnv, createPortalBridge } from '../portal/bridge.ts';
import type { PortalBridge, PortalEnv } from '../portal/bridge.ts';
import { trophyLine } from '../portal/copy.ts';
import { showTrophyToast } from './trophyToast.ts';

/** What the binding reads of the Game (game.ts `Game` satisfies it; the probe passes a scripted one). */
export interface AchGameLike {
  readonly phase: string;
  readonly simTime: number;
  readonly body: { readonly metrics: Pick<SoftMetrics, 'carried'> };
  readonly bodies: { readonly extras: ReadonlyArray<{ readonly body: { readonly metrics: Pick<SoftMetrics, 'carried'> } }> };
  readonly cut: { readonly pieces: number; readonly busy: boolean };
  readonly ceremonies: { readonly active: boolean; readonly pending: boolean };
  readonly hoard: Pick<Collection, 'stacks' | 'onEvent'>;
  onStep(fn: (dt: number, simTime: number) => void): () => void;
}

export interface AchDeps {
  /** the trophies' own key lives here (core/achStore.ts); null = in memory */
  storage: StorageLike | null;
  /** epoch ms (stamps a trophy and `since`) */
  now(): number;
  /** the shell's window 'storage' subscription: another tab's trophies are folded in */
  subscribe?: StorageSubscribe;
  /** the portal env; default: the real window (standalone when there is no parent frame) */
  env?: PortalEnv;
  /** a trophy waits at most this long (sim seconds) after a capsule or merge result for its ceremony to begin, so the toast never spoils the reveal */
  ceremonyGraceS?: number;
}

export interface AchAttach {
  /** the live region (Announcer.say): used when no toast renderer is registered */
  announce(text: string): void;
}

export interface Achievements {
  /** wrap the collection BEFORE createGame; the wrapper forwards everything and only watches the results */
  observe(c: Collection): Collection;
  /** after createGame / bindUi. Returns the detach function. */
  attach(g: AchGameLike, ui: AchAttach): () => void;
  readonly evaluator: Evaluator;
  readonly store: AchStore;
  readonly bridge: PortalBridge;
  readonly save: AchSave;
  /** a trophy was earned (the Trophies screen redraws). Returns the unsubscribe function. */
  onUnlock(fn: (def: AchievementDef) => void): () => void;
  dispose(): void;
}

/** The observer a wrapped collection reports to. */
interface Watch {
  touch(ev: { kind: string; intensity: number; heldFor: number }, tMs: number): void;
  opened(r: Extract<OpenResult, { ok: true }>): void;
  merged(r: Extract<MergeResult, { ok: true }>): void;
  task(): void;
  itemsChanged(): void;
}

const guard = (f: () => void): void => { try { f(); } catch { /* observation never breaks the game */ } };

/** A collection that forwards every member to `c` and tells `w` what happened. A Proxy, so getters (mode, ledger) stay live and any member added later passes through. */
export function observeCollection(c: Collection, w: Watch): Collection {
  const hooks: Record<string, unknown> = {
    feed: (ev: Parameters<Collection['feed']>[0], t: number): void => { c.feed(ev, t); try { w.touch(ev, t); } catch { /* observation never breaks the frame loop (and this path allocates nothing) */ } },
    openCapsule: (): Promise<OpenResult> => c.openCapsule().then((r) => { if (r && r.ok) guard(() => w.opened(r)); return r; }),
    completeTask: (id: string): Promise<TaskResult> => c.completeTask(id).then((r) => { if (r && r.ok) guard(() => w.task()); return r; }),
    merge: (ids: readonly string[], digest: string): Promise<MergeResult> => c.merge(ids, digest).then((r) => { if (r && r.ok) guard(() => w.merged(r)); return r; }),
    tidy: (plan: readonly (readonly string[])[]): Promise<TidyResult> => c.tidy(plan).then((r) => {
      if (r && Array.isArray(r.results)) for (const x of r.results) if (x && x.ok) guard(() => w.merged(x));
      return r;
    }),
    claimRestock: (pick: Parameters<Collection['claimRestock']>[0]): ReturnType<Collection['claimRestock']> => c.claimRestock(pick).then((r) => { if (r && r.ok) guard(() => w.itemsChanged()); return r; }),
  };
  // (the cache is keyed by the member's FUNCTION, not its name: a member replaced on the Collection after it was first read (the dev hook's forceOffline swaps `meter`) must be seen,
  //  and a member that is not replaced keeps one identity; found by B4a's hoard-offline row, probe_portal T12)
  const bound = new WeakMap<object, unknown>();
  return new Proxy(c, {
    get(target, prop) {
      if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(hooks, prop)) return hooks[prop];
      const v = Reflect.get(target, prop, target);
      if (typeof v !== 'function') return v;
      let f = bound.get(v);
      if (!f) { f = (v as (...a: unknown[]) => unknown).bind(target); bound.set(v, f); }
      return f;
    },
  });
}

export function createAchievements(deps: AchDeps): Achievements {
  const store = createAchStore(deps.storage, { now: deps.now, subscribe: deps.subscribe });
  const listeners: Array<(def: AchievementDef) => void> = [];
  const pendingToasts: Array<{ def: AchievementDef; retro: boolean; first: boolean }> = [];
  let holdUntil = -Infinity;   // sim time before which a toast waits (a capsule or merge result: its ceremony is about to play)
  let game: AchGameLike | null = null;
  let announce: ((t: string) => void) | null = null;
  const grace = deps.ceremonyGraceS ?? 4;

  const bridge = createPortalBridge({
    env: deps.env ?? browserEnv(),
    known: (slug) => ACH_BY_SLUG.has(slug),
    earned: () => Object.entries(store.save.earned).filter(([k]) => ACH_BY_SLUG.has(k)).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).map(([k]) => k),
  });

  const evaluator = createEvaluator({
    save: store.save,
    now: deps.now,
    onDirty: () => store.markDirty(),
    onUnlock(def, at, retro) {
      guard(() => store.flush());                 // a trophy is written at once
      guard(() => bridge.achievement(def.slug));  // posted only when signed in, paced, once
      pendingToasts.push({ def, retro, first: evaluator.earnedCount() === 1 });
      for (const f of listeners.slice()) guard(() => f(def));
      guard(drainToasts);
    },
  });

  function toastsMayShow(): boolean {
    const g = game;
    return !!g && g.phase === 'play' && !g.ceremonies.active && !g.ceremonies.pending && g.simTime >= holdUntil;
  }
  function drainToasts(): void {
    while (pendingToasts.length && toastsMayShow()) {
      const { def, retro, first } = pendingToasts.shift()!;
      const t = { slug: def.slug, name: def.name, description: def.description, tier: def.tier, points: def.points, hidden: def.hidden, signedIn: bridge.signedIn, retro, first };
      if (!showTrophyToast(t)) announce?.(trophyLine(t));
    }
  }

  const speciesOwned = (c: Pick<Collection, 'stacks'>): number => { let n = 0; for (const s of c.stacks()) if (s.copies > 0) n++; return n; };
  const hold = (): void => { if (game) holdUntil = game.simTime + grace; };

  const watch: Watch = {
    touch: (ev, t) => evaluator.touch(ev, t),
    opened(r) { hold(); evaluator.opened(r.tier_idx); sweepSpecies(false); },
    merged(r) { hold(); evaluator.merged(r.tier_idx, r.tier_up); sweepSpecies(false); },
    task: () => evaluator.taskDone(),
    itemsChanged: () => sweepSpecies(false),
  };
  let observed: Collection | null = null;
  function sweepSpecies(retro: boolean): void {
    const c = observed ?? game?.hoard;
    if (c) guard(() => evaluator.species(speciesOwned(c), retro));
  }

  return {
    observe(c) { observed = c; return observeCollection(c, watch); },
    attach(g, ui) {
      game = g;
      announce = ui.announce;
      bridge.start();
      const offStep = g.onStep(() => {
        let carried = g.body.metrics.carried === true;
        for (let i = 0; !carried && i < g.bodies.extras.length; i++) if (g.bodies.extras[i].body.metrics.carried === true) carried = true;
        evaluator.carried(carried);
        evaluator.pieces(g.cut.pieces, g.cut.busy);
        if (pendingToasts.length) drainToasts();
      });
      const offEvents = g.hoard.onEvent((e) => { if (e.type === 'external') { store.sync(); sweepSpecies(false); } });
      sweepSpecies(true);   // what the player already had when counting started
      const onHide = (): void => { guard(() => store.flush()); };
      const hasWin = typeof window !== 'undefined' && typeof window.addEventListener === 'function';
      if (hasWin) { window.addEventListener('pagehide', onHide); document.addEventListener('visibilitychange', onHide); }
      return () => {
        offStep(); offEvents();
        if (hasWin) { window.removeEventListener('pagehide', onHide); document.removeEventListener('visibilitychange', onHide); }
        game = null; announce = null;
        guard(() => store.flush());
      };
    },
    evaluator, store, bridge,
    get save() { return store.save; },
    onUnlock(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    dispose() { guard(() => bridge.dispose()); guard(() => store.dispose()); },
  };
}

/** Every row in display order (the Trophies screen, next leg): the row, when it was earned (epoch ms or null) and its progress where countable. */
export function trophyRows(a: Pick<Achievements, 'evaluator'>): Array<{ def: AchievementDef; at: number | null; progress: { value: number; target: number } | null }> {
  return ACHIEVEMENTS.map((def) => ({ def, at: a.evaluator.earnedAt(def.slug), progress: a.evaluator.progress(def.slug) }));
}
