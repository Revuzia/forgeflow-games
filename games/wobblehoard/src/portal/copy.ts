// The words that belong to the portal bridge and the trophies (kind wording: nothing is ever lost, missed or timed). Plain strings, no DOM.
//
// PRIVACY_LINE is PINNED to what the bridge really sends (src/portal/bridge.ts `OutMsg`): the only thing that ever leaves the page is one trophy's slug,
// and only when the player is signed in to ForgeFlow Games inside the portal's frame; the question "who is signed in?" carries no data about the player.
// The probe (_harness/probe_portal.ts) reads every message the client can post and fails if it is anything else, so this sentence cannot drift from the code.
import type { AchTier } from '../core/achievements.ts';
import type { PortalState } from './bridge.ts';

/** The Credits line (UI.md 6, R19). Credits.ts (B4) shows it with textContent. */
export const PRIVACY_LINE = 'Your squishies live in this browser. Signed in to ForgeFlow Games, only your trophies are shared with the site.';

/** The account line of the Trophies screen (PUBLISH_CHECKLIST_SHORT section 4; set with textContent, never with the player's name: the bridge never reads it).
 *  Waiting and silent say what is always true: trophies are kept on this device. */
export function accountLine(state: PortalState): string {
  switch (state) {
    case 'guest': return 'Playing as a guest. Sign in on forgeflowgames.com to keep your trophies.';
    case 'signedIn': return 'Saved to your ForgeFlow account.';
    default: return 'Saved on this device.';
  }
}

/** "x of 355 XP (counts when signed in)" (UI.md 6). */
export function xpLine(earnedPoints: number, totalPoints: number): string {
  return `${earnedPoints} of ${totalPoints} XP (counts when signed in)`;
}

const TIER_WORD: Readonly<Record<AchTier, string>> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', diamond: 'Diamond' };
export const tierWord = (t: AchTier): string => TIER_WORD[t];

/** What the live region says for an unlock when no visual toast is registered (and what a toast's accessible name starts from). */
export function trophyLine(t: { name: string; tier: AchTier }): string {
  return `${TIER_WORD[t.tier]} trophy: ${t.name}.`;
}
