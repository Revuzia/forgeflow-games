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

/** a cut or Split in two is done; Minis says minis */
export const cutDone = (n: number, style: CutStyle): string => (style === 'minis' ? `Cut into ${n} minis.` : `Cut into ${n} pieces.`);
/** a join is done: twins (N = pieces left), or the group swallowed others (K = pieces that came together) */
export const joinedTwins = (n: number): string => `Joined. Now ${n} pieces.`;
export const joinedGroup = (k: number): string => `Joined ${k} pieces into one.`;
export const undone = (n: number): string => `Cut undone. Now ${n} pieces.`;
export const whole = 'Whole again.';
/** nothing to join, nothing to undo */
export const inOnePiece = 'It is in one piece.';

/** a swipe that missed (a swipe under 24 px, a tap, says nothing); Split in two that found nothing */
export const swipeMiss = 'Swipe across the squishy to cut it.';
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
