// WOBBLEHOARD collection copy (_spec/COLLECTION.md 9.4 to 9.9; _spec/MERGE.md 3.1; _spec/TRADE.md 7.3 for the shared codes).
// Plain, short English; no blame, no jargon, no pressure, no timers, no loss language. The merge cost is never written as a word or a
// digit here: it is derived from MERGE_COST (MERGE.md section 8 row 7), and so are the daily merge cap and the lock hours.
import { MERGE_COST, MERGE_DAILY_CAP, MERGE_OUTPUT_LOCK_HOURS } from '../core/merge.ts';
import type { MergePreviewOk } from '../core/merge.ts';
import { TIER_NAMES, oddsPerSpecies } from '../core/rarity.ts';
import type { TierId } from '../core/rarity.ts';
import { getSpecies } from '../data/catalog.ts';
import { GHOST_CAP } from './constants.ts';
import type { HoardLoadStatus, HoardSaveState, MergeErrorCode, MeterView, Stack, TaskRow } from './types.ts';

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
/** A small count as a word ("two"), larger ones as digits. */
export const countWord = (n: number): string => (Number.isInteger(n) && n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/* ─────────────────────────── shared error codes (COLLECTION 9.9, TRADE 7.3) ─────────────────────────── */

export const COPY = {
  firstRun: 'One squishy so far. Squish to earn capsules.',
  practiceShelf: 'Practice shelf. These live on this device.',
  signInChip: 'Sign in to keep real squishies and trade.',
  signInToTrade: 'Sign in to trade.',
  noSpares: 'No spares yet',
  offline: 'Offline. Your Hoard is read-only until we reconnect.',
  busy: 'Busy for a moment. Trying again.',
  frozenCapsules: 'Capsules are paused for a short while.',
  frozenMerging: 'Merging is paused for a short while.',
  noCapsule: 'That one fizzled. Keep squishing.',
  tableFull: 'Table full: open one to keep going.',
  notSignedIn: 'Sign in again to keep going.',
  somethingWrong: 'Something went wrong. Reload and try again.',
  staleMirror: 'Showing your last saved Hoard',
  stillWorking: 'Still working. Your capsule is safe.',
  takingAMoment: 'Taking a moment. Your squishies are safe.',
  shelfFull: `Your practice shelf is full (${GHOST_CAP}). Merge some spares to make room.`,
  capsuleReady: 'A capsule is ready',
  resting: 'Squishies are resting, filling slowly',
  doneToday: "They'll be ready tomorrow",
  waiting: 'Waiting for connection',
  reconnected: 'Reconnected',
  dailyGift: 'Daily gift',
  takeThisOne: 'Take this one',
  comeBackTomorrow: 'Come back tomorrow',
  newToYou: 'New to you',
  weekDone: "That's all the tasks for this week",
  collectCapsule: 'Collect capsule',
  holdToMerge: 'Hold to merge',
  oddsChanged: 'The odds changed. Have another look.',
  mythicCannotMerge: "Mythic squishies can't merge",
  notYet: 'Not yet',
  rowComplete: 'Row complete',
  replayReveal: 'Replay reveal',
  practiceLabel: 'Practice',
} as const;

/* ─────────────────────────── storage (the typed status of store.ts) ─────────────────────────── */

/** What to tell the player about how the Practice shelf was loaded; null = nothing to say. */
export function loadStatusCopy(s: HoardLoadStatus): string | null {
  switch (s) {
    case 'recovered': return 'Your practice shelf could not be read. A copy was kept.';
    case 'repaired': return 'Some practice squishies could not be read. A copy was kept.';
    case 'newer': return 'This shelf was saved by a newer version of the game. Reload to pick it up; nothing here is saved until then.';
    case 'unavailable': return "This browser isn't keeping saves right now, so the practice shelf starts fresh next time.";
    default: return null;
  }
}

/** What to tell the player about saving; null = nothing to say. */
export function saveStateCopy(s: HoardSaveState): string | null {
  return s === 'failing' ? "Your practice shelf can't be saved on this device right now. Keep playing; it will keep trying." : null;
}

/* ─────────────────────────── capsules, restock, tasks ─────────────────────────── */

export function openErrorCopy(e: 'no_capsule' | 'shelf_full' | 'unavailable'): string {
  return e === 'no_capsule' ? COPY.noCapsule : e === 'shelf_full' ? COPY.shelfFull : COPY.signInChip;
}

export function restockErrorCopy(e: 'not_offered' | 'already_claimed' | 'shelf_full' | 'unavailable'): string {
  switch (e) {
    case 'not_offered': return "That one isn't in today's gift. Pick one of the three.";
    case 'already_claimed': return COPY.comeBackTomorrow;
    case 'shelf_full': return COPY.shelfFull;
    default: return COPY.signInChip;
  }
}

/** "You have 2" / "New to you" under a restock plinth. */
export const restockOwnedCopy = (copies: number): string => (copies > 0 ? `You have ${copies}` : COPY.newToYou);

export function taskErrorCopy(e: string, progress?: number, target?: number): string {
  switch (e) {
    case 'not_offered': return "That task isn't on today's list.";
    case 'not_done': return progress !== undefined && target !== undefined ? `Not quite yet: ${progress} of ${target}.` : 'Not quite yet.';
    case 'already_claimed': return 'Already collected today.';
    case 'weekly_limit': return COPY.weekDone;
    case 'queue_full': return 'Open a capsule first, then collect this one.';
    case 'unavailable': return COPY.signInChip;
    default: return COPY.somethingWrong;
  }
}

/** "3 of 5" under a task bar. */
export const taskProgressCopy = (t: Pick<TaskRow, 'progress' | 'target'>): string => `${t.progress} of ${t.target}`;

/* ─────────────────────────── the ring (9.7) ─────────────────────────── */

/** The one line under the ring, or null in the normal state. Priority: table full, done for today, resting, offline. */
export function meterCopy(m: MeterView): string | null {
  if (m.tableFull) return COPY.tableFull;
  if (m.doneToday) return COPY.doneToday;
  if (m.resting) return COPY.resting;
  if (m.offline) return COPY.waiting;
  return null;
}

/** "Open a capsule (3 waiting)": the DOM twin of the capsule on the table (9.4). */
export const openButtonCopy = (credits: number): string => `Open a capsule (${credits} waiting)`;

/* ─────────────────────────── merge (MERGE 3.1, 3.3) ─────────────────────────── */

/** The rule in one line, with the cost derived from MERGE_COST. */
export const mergeRuleCopy = (): string => `Merge ${countWord(MERGE_COST)} of the same squishy into one new one. It never comes out a lower tier.`;
/** Why the Merge button is missing or disabled for a stack. */
export function mergeButtonCopy(s: Pick<Stack, 'copies' | 'tierIdx' | 'mergeable'>, topTierIdx: number): string | null {
  if (s.tierIdx >= topTierIdx) return COPY.mythicCannotMerge;
  if (s.copies < MERGE_COST) return `Needs ${countWord(MERGE_COST)} of the same`;
  if (s.mergeable < 1) return COPY.noSpares;
  return null;
}

export function mergeErrorCopy(e: MergeErrorCode | 'odds_changed'): string {
  switch (e) {
    case 'odds_changed': return COPY.oddsChanged;
    case 'daily_cap': return `${MERGE_DAILY_CAP} merges today. They're resting until tomorrow.`;
    case 'locked': return `One of these is locked for now: new squishies rest for ${MERGE_OUTPUT_LOCK_HOURS} hours first.`;
    case 'favourite': return "One of these is hearted, so it's kept safe from merging.";
    case 'reserved': return "One of these is on a swap, so it can't merge right now.";
    case 'not_yours': return "One of these isn't on your shelf any more. Pick again.";
    case 'wrong_count': return `Pick ${countWord(MERGE_COST)} of the same squishy.`;
    case 'mixed_species': return 'They all need to be the same squishy.';
    case 'mythic_cannot_merge': return COPY.mythicCannotMerge;
    case 'not_enough_copies': return `You need ${countWord(MERGE_COST)} of the same squishy.`;
    case 'unavailable': return COPY.signInChip;
    default: return COPY.somethingWrong;
  }
}

/** The reason chip under a copy that cannot be picked (MERGE 3.1 step 2). */
export function unpickableChip(r: 'locked' | 'reserved' | 'favourite' | 'offered', lockedForMs = 0): string {
  if (r === 'locked') return `Locked ${Math.max(1, Math.ceil(lockedForMs / 3_600_000))} h`;
  return r === 'reserved' ? 'On a swap' : r === 'favourite' ? 'Hearted' : 'On your shelf';
}

const pct = (p: number): string => { const v = p * 100; return Number.isInteger(v) ? String(v) : v.toFixed(v < 1 ? 2 : 1); };

/** The odds panel lines of a preview, top to bottom (MERGE 3.1 step 3), plus the cap and lock lines. */
export function mergePreviewLines(p: MergePreviewOk, mergesToday: number): string[] {
  const up = TIER_NAMES[p.upTier], tier = TIER_NAMES[p.inputTier];
  const lines: string[] = [];
  if (p.basis === 'finished-row') lines.push(`Your ${tier} row is complete: this merge always moves up`);
  else if (p.basis === 'pity') lines.push(`Guaranteed: ${plural(p.pityCount, 'dud', 'duds')} in a row`);
  else {
    lines.push(`Chance to move up to ${up}: ${pct(p.tierUpChance)}%`);
    if (p.dudsUntilPity > 0) lines.push(`${cap(countWord(p.dudsUntilPity))} more without moving up and the next one is guaranteed`);
  }
  lines.push(`You still lack ${p.lackingInTier} in ${tier} and ${p.lackingInNextTier} in ${up}.`);
  lines.push(`The new squishy is locked for ${MERGE_OUTPUT_LOCK_HOURS} hours.`);
  lines.push(`Merges today: ${mergesToday} of ${MERGE_DAILY_CAP}.`);
  return lines;
}

/** The last-copy warning (MERGE 3.1). */
export const lastCopyCopy = (speciesName: string): string => `This uses your last ${speciesName}. Merge anyway?`;
/** "7 merges left today" on the Tidy-up sheet. */
export const tidyCapCopy = (left: number): string => `${plural(left, 'merge', 'merges')} left today`;
export const tidyNoteCopy = 'Odds are recalculated after each merge.';

/* ─────────────────────────── cabinet (9.2, 9.10) ─────────────────────────── */

/** "23 of 50". */
export const collectionCountCopy = (owned: number, total: number): string => `${owned} of ${total}`;
/** Spare badge on the plinth ("x3") and on the card ("2 spare"). */
export const stackBadgeCopy = (copies: number): string | null => (copies >= 2 ? `x${copies}` : null);
export const sparesCopy = (spares: number): string => `${spares} spare`;
/** "Appears in 0.60% of capsules". */
export function oddsCopy(tier: TierId): string { return `Appears in ${(oddsPerSpecies(tier) * 100).toFixed(2)}% of capsules`; }

/** The accessible name of a plinth: "Dollop, Common, 3 copies, 2 spare, new" (9.10). */
export function plinthLabel(s: Pick<Stack, 'species' | 'tier' | 'copies' | 'spares' | 'unseen'>): string {
  const name = getSpecies(s.species)?.name ?? s.species;
  const parts = [name, TIER_NAMES[s.tier]];
  if (s.copies === 0) parts.push(COPY.notYet);
  else { parts.push(plural(s.copies, 'copy', 'copies')); if (s.spares > 0) parts.push(sparesCopy(s.spares)); if (s.unseen > 0) parts.push('new'); }
  return parts.join(', ');
}

/** Where a copy came from, on its swatch (9.3). A ghost's swatch also carries COPY.practiceLabel. */
export function originCopy(o: 'starter' | 'drop' | 'task' | 'restock' | 'blend'): string {
  return o === 'drop' ? 'Capsule' : o === 'blend' ? 'Merge' : o === 'restock' ? 'Restock' : o === 'task' ? 'Task' : 'Starter';
}
