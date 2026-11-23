// EVERY cut string the player reads or hears (CUT2.md 9.3, CUT_MINIS.md): the live-region lines, the toast, the Cut bar's hint. `src/ui` holds no copy
// of these: cutBinding.ts passes the bar its text. Rule: say pieces, halves, parts; never "chunk", "ball", "face piece", "role", "region" or "cell".
//
// One line mentions Undo cut (the tool line). The Undo button does not exist before the Cutter offers `undoCut`, so it takes `undo` and leaves the word out while there is no such
// button: the game never names a control the player cannot find.
// The count text is the plain number ("N pieces", never "of N": there is no limit to count against), the tray hint, the Settings keys line ("C cut") and the aria-labels are unchanged
// and live where they were.

import type { CutBarLabels } from '../ui/cutContract.ts';

/** The two cut styles (CUT_MINIS.md): Clean cut = every piece is the real part of the squishy on its side of the plane; Minis = every piece is a complete smaller copy. */
export type CutStyle = 'clean' | 'minis';

/** the label of a cut style (the control in the Cut options bar) */
export const styleLabel = (s: CutStyle): string => (s === 'minis' ? 'Minis' : 'Clean cut');
/** "Reconnect first to change the cut style" (CUT_A.md SR1) */
export const styleLocked = 'Reconnect first to change the cut style';

/** Every word the Cut options bar draws or says on its own, in the shape of src/ui/cutContract.ts (the UI lane's request; cutBinding.ts hands it to createCutBar as `labels`).
 *  long = when there is room, short = when there is little; the aria name is the long one. */
export const barLabels: CutBarLabels = {
  group: 'Cut tool',
  split: { long: 'Split in two', short: 'Split' },
  join: { long: 'Reconnect all', short: 'Reconnect' },
  undo: { long: 'Undo cut', short: 'Undo' },
  done: { long: 'Done', short: 'Done' },
  styleGroup: 'Cut style',
  style: { clean: { long: styleLabel('clean'), short: styleLabel('clean') }, minis: { long: styleLabel('minis'), short: styleLabel('minis') } },
  styleLocked,
  pieces: (n) => `${n} pieces`,
};

/** picking the Cut tool (live region) */
export const toolPicked = (undo: boolean): string => (undo
  ? 'Cut: swipe across a squishy to cut it. Split in two, Undo cut and Reconnect all are buttons.'
  : 'Cut: swipe across a squishy to cut it. Split in two and Reconnect all are buttons.');

/** the Cut bar's hint line: whole, 2+ pieces, the safety ceiling. There is no piece limit and no minimum size any more (CUT3.md 2, 2026-10-09): the only "too many" line is the kind one at
 *  the safety ceiling of 64 live pieces, and the Cut tool works again after a join. */
export const barWhole = 'Swipe across a squishy to cut it.';
// (2026-10-10, publish blockers: the hint used to promise "With the Hand, drag a piece onto another and hold to join them". Measured with a real mouse on two true halves: that drag joins them only when the press is on
//  the half's shoulder that FACES the other half (gestures.ts commits a press to a pull only when the first 14 px go OUTWARD from the grabbed body's centre); a press on the far side or on the middle, pulled toward the
//  other half, is a rub and joins nothing. A hint must not promise what most first tries do not do, so both lines now name the button that always works: Reconnect all.)
export const barCut = 'Swipe to cut again. Reconnect all puts the pieces back together.';
export const lotOfPieces = "That's a lot of pieces! Reconnect some to keep cutting.";
/** `canSplit` and `undo` are no longer read (nothing is "too small to cut"); the UI kit page still passes them */
export function barText(n: number, max: number, _canSplit?: boolean, _undo?: boolean): string {
  return n >= max ? lotOfPieces : n > 1 ? barCut : barWhole;
}

/** back to the Hand with two or more pieces (a toast and a polite line, once each time the squishy goes from whole to cut) */
export const handHint = 'Reconnect all, in the Cut tool, puts the pieces back together.';

/** a join is armed (once per arm): K = the group's size ("Joining 2 pieces." for twins) */
export const joining = (k: number): string => `Joining ${k} pieces.`;

/** a cut or Split in two is done; Minis says minis. D-103: `name` (only while SEVERAL squishies are cut) says whose pieces they are */
export const cutDone = (n: number, style: CutStyle, name?: string | null): string => (name
  ? (style === 'minis' ? `Cut ${name} into ${n} minis.` : `Cut ${name} into ${n} pieces.`)
  : style === 'minis' ? `Cut into ${n} minis.` : `Cut into ${n} pieces.`);
/** a join is done: twins (N = pieces left), or the group swallowed others (K = pieces that came together) */
export const joinedTwins = (n: number): string => `Joined. Now ${n} pieces.`;
export const joinedGroup = (k: number): string => `Joined ${k} pieces into one.`;
export const undone = (n: number): string => `Cut undone. Now ${n} pieces.`;
export const whole = 'Whole again.';
/** D-103: with several squishies cut, the line names the one that is whole again */
export const wholeOf = (name?: string | null): string => (name ? `${name} is whole again.` : whole);
/** nothing to join, nothing to undo */
export const inOnePiece = 'It is in one piece.';

/** a swipe that missed (a swipe under 24 px, a tap, says nothing); Split in two that found nothing */
export const swipeMiss = 'Swipe across the squishy to cut it.';
/** D-103 (owner 2026-11-23; it replaces D-99's "One squishy at a time: Reconnect all, then cut another."): with a party out the pieces of every cut squishy share ONE budget (later-cut.ts
 *  PARTY_PIECES). A stroke or Split in two that would pass it cuts what fits and SAYS AND SHOWS why (a toast: `isShown`), never a silent no-op. */
export const partyFull = (max: number): string => `That's ${max} pieces out, the most at once. Reconnect a squishy to cut more.`;
/** the Cut bar's hint at the party's budget */
export const barPartyFull = (max: number): string => `${max} pieces is the most at once. Reconnect one to cut more.`;
/** a cut notice the player must SEE as well as hear (round 13, VERDICT_R12 4c: a refusal that only went to the hidden live region was invisible) */
export const isShown = (t: string): boolean => /pieces out, the most at once\./.test(t);
/** D-103, the Cut bar with a party out: a chip per cut squishy (tap = that one goes back together) */
export const chipLabel = (name: string, n: number): string => `Reconnect ${name} (${n} pieces)`;
export const chipsGroup = 'Reconnect one squishy';
export const chipsLead = 'Reconnect one';
export const nothingToCut = 'Nothing to cut there.';

/** the refusals the physics makes (each with a tremble): `thin` (a sliver thinner than the mesh can hold, or a part it cannot build) and `loose` (a side of two separate parts: said ONLY by a physics
 *  that reports no `parts`, an older one; the real physics makes a piece of each part, CUT3.md 2.3, 2026-10-09: "Cut into 3 pieces." is cutDone). The "as many pieces as it can make" and "Too small to cut"
 *  lines are gone with the limits they described. */
export const thin = 'That would make a piece too thin. Try another angle.';
export const loose = 'That cut would split off two separate parts. Try another angle.';
/** the merged piece of a join could not be built (nothing changes) */
export const cantJoin = 'Those pieces would not join. Try Reconnect all.';

/** the first cut put the squishies from the Hoard back on the shelf */
export const matCleared = (n: number): string => (n === 1 ? 'The other squishy went back on the shelf.' : `The other ${n} went back on the shelf.`);
