// THE UNLOCK TOAST HOOK (UI.md 6 "Toasts": top-centre, a tier chip, the name, "+N XP" only signed in, 3.2 s for a trophy, queued, never over a ceremony).
//
// The toast system is B4's (ui/toast.ts). Until it exists this file is the NAMED seam the trophies call, so nothing in B6 changes when B4 lands:
//   B4: register the renderer once at boot, `setTrophyToastSink((t) => toast.trophy(t))`, or replace the body of showTrophyToast. The sink speaks the unlock
//   itself ("the announcer speaks once"); with no sink, showTrophyToast answers false and the binding says `trophyLine(t)` in the live region instead.
// `signedIn` is true only when the portal bridge reports a signed-in account: show "+{points} XP" then and only then (the XP counts when signed in).
import type { AchTier } from '../core/achievements.ts';

export interface TrophyToast {
  slug: string;
  name: string;
  description: string;
  tier: AchTier;
  /** the row's XP; shown as "+N XP" only when signedIn */
  points: number;
  hidden: boolean;
  signedIn: boolean;
  /** found by looking at what the player already had when counting started: a calmer moment than a fresh find */
  retro: boolean;
  /** the very first trophy this device has ever earned: its toast says where trophies live (once, never again) */
  first: boolean;
}

/** The toast's second line (UI.md 6: "+N XP" only when signed in). Otherwise: the first trophy ever says where they live; a hidden one shows its condition now that it is found; the rest need nothing. */
export function trophyToastSub(t: Pick<TrophyToast, 'points' | 'signedIn' | 'first' | 'hidden' | 'description'>): string | undefined {
  if (t.signedIn && t.points > 0) return `+${t.points} XP`;
  if (t.first) return FIRST_TROPHY_LINE;
  if (t.hidden) return t.description;
  return undefined;
}
export const FIRST_TROPHY_LINE = 'Find your trophies in the Menu.';

export type TrophyToastSink = (t: TrophyToast) => void;
let sink: TrophyToastSink | null = null;

/** B4 registers the real toast renderer here (null removes it). */
export function setTrophyToastSink(fn: TrophyToastSink | null): void { sink = fn; }

/** Show one unlock toast. Returns true when a toast renderer took it (and so announces it); false = no renderer yet, the caller announces. Never throws. */
export function showTrophyToast(t: TrophyToast): boolean {
  if (!sink) return false;
  try { sink(t); return true; } catch { return false; }
}
