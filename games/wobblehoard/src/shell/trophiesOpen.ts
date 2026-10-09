// The FIRST-PLAY side of the Trophies and Records screen (UI.md 6, B6b): a Menu row, a title chip or a dev hook calls `open()`; the screen itself is the `later-trophies` chunk
// (ui/later-trophies.ts + trophies.css, a dynamic import, so it is not in the first download), loaded on the first press. If the chunk cannot load (offline after a fresh deploy,
// a blocked request) the player is told once, kindly, and nothing else changes. Two quick presses open ONE screen.
import type { Collection } from '../collection/types.ts';
import { ACHIEVEMENTS } from '../core/achievements.ts';
import type { TierFilter } from '../ui/trophiesData.ts';
import type { TrophiesScreen, TrophiesSource, TrophiesTab } from '../ui/later-trophies.ts';

export const TROPHIES_LOAD_FAIL = 'Trophies couldn’t open. Try again in a moment.';

export interface TrophiesLauncherDeps {
  /** the UI root (the screen's layer is appended here) */
  root: HTMLElement;
  trophies: TrophiesSource;
  hoard: Pick<Collection, 'stacks'>;
  say(text: string): void;
  /** the chunk could not load */
  fail(text: string): void;
  /** the screen closed (why: 'escape' | 'button' | 'scrim' | 'code') */
  onClose?(why: string): void;
}
export interface TrophiesLauncher {
  /** open the screen (loads the chunk the first time); resolves to it, or null when it could not */
  open(from?: HTMLElement | null, o?: { tab?: TrophiesTab; filter?: TierFilter }): Promise<TrophiesScreen | null>;
  readonly screen: TrophiesScreen | null;
  /** "3 / 20" for the Menu row, read each time the Menu opens */
  detail(): string;
  /** fetch the chunk now (the Menu opening is a good moment: its Trophies row is one press away), so the press opens at once; never throws */
  preload(): void;
}

export function createTrophiesLauncher(d: TrophiesLauncherDeps): TrophiesLauncher {
  let screen: TrophiesScreen | null = null;
  let loading: Promise<TrophiesScreen | null> | null = null;
  return {
    get screen() { return screen?.open ? screen : null; },
    detail: () => `${d.trophies.evaluator.earnedCount()} / ${ACHIEVEMENTS.length}`,
    preload() { void import('../ui/later-trophies.ts').catch(() => { /* the press tries again and says so */ }); },
    open(from, o = {}) {
      if (screen?.open) return Promise.resolve(screen);
      if (loading) return loading;
      loading = import('../ui/later-trophies.ts').then((m) => {
        screen = m.openTrophies({ root: d.root, trophies: d.trophies, hoard: d.hoard, say: d.say, from, tab: o.tab, filter: o.filter, onClose: (why) => { d.onClose?.(why); } });
        return screen;
      }).catch((e: unknown) => {
        console.error(e);
        d.fail(TROPHIES_LOAD_FAIL);
        return null;
      }).finally(() => { loading = null; });
      return loading;
    },
  };
}
