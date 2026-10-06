// Which squishy the player is playing with, and the ones they played with lately (SHELL-2b "switch anytime").
//
//   * `current` survives reloads: boot builds the play body from it (when the collection still has that item); a merged-away or missing
//     item falls back to the stored starter.
//   * `recent` (newest first, at most RECENT_MAX) feeds the HUD quick switcher.
// Stored under its own key (the slice-1 profile in core/save.ts is the collection lane's file; when the profile grows a play-instance
// slot this moves there). Ids only, validated on load; nothing here is ever sent anywhere.
import type { StorageLike } from '../core/settings.ts';

export const PLAY_KEY = 'wobblehoard:v2:play';
export const RECENT_MAX = 8;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface PlayHistory {
  readonly current: string | null;
  /** newest first, the current one included */
  recent(): string[];
  /** this item is the play body now (a deliberate switch, a reveal or a merge result: not a card preview) */
  note(itemId: string | null): void;
  /** forget ids the collection no longer has */
  prune(has: (id: string) => boolean): void;
}

export function createPlayHistory(storage: StorageLike | null): PlayHistory {
  let current: string | null = null;
  let recent: string[] = [];
  try {
    const raw = storage?.getItem(PLAY_KEY);
    if (raw) {
      const o = JSON.parse(raw) as { play?: unknown; recent?: unknown };
      if (typeof o.play === 'string' && ID.test(o.play)) current = o.play;
      if (Array.isArray(o.recent)) recent = o.recent.filter((x): x is string => typeof x === 'string' && ID.test(x)).slice(0, RECENT_MAX);
    }
  } catch { /* unreadable: start empty */ }
  const save = (): void => { try { storage?.setItem(PLAY_KEY, JSON.stringify({ v: 1, play: current, recent })); } catch { /* full or blocked: in memory only */ } };
  return {
    get current() { return current; },
    recent: () => recent.slice(),
    note(id) {
      if (!id || !ID.test(id)) return;
      if (current === id && recent[0] === id) return;
      current = id;
      recent = [id, ...recent.filter((x) => x !== id)].slice(0, RECENT_MAX);
      save();
    },
    prune(has) {
      const r = recent.filter(has);
      const c = current && has(current) ? current : null;
      if (r.length === recent.length && c === current) return;
      recent = r; current = c;
      save();
    },
  };
}
