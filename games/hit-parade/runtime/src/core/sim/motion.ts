// HIT PARADE — motion-input parsing over the history ring stored IN the state (CONTRACT §4.3.9).
// History entry (one int per frame, see inputs.ts): bits 0-3 numpad direction (1..9, facing-relative),
// bits 4-14 held buttons (same bit positions as the §4.4 input word; CHANGED(SIM3D) bits 13 / 14 = STEP_IN / STEP_OUT),
// bit 15 = frozen frame (hitstop / world freeze; was bit 13 before SIM3D). Motion windows count NON-frozen frames only.

import { F, HIST } from './layout.ts';
import { MO } from './compile.ts';

export const H_DIR = 0xf;
export const H_FROZEN = 1 << 15; // CHANGED(SIM3D): bit 13 is STEP_IN now

// scratch (fully rewritten on every call; never carries state between frames)
const dirs = new Int32Array(HIST);

/**
 * Collects (oldest first) the directions of the history entries that fall inside a window of `win`
 * NON-frozen frames ending at the current frame. Frozen entries (hitstop / freeze) are included as
 * inputs but do not consume window length, so hitstop never ages a motion. Returns the count.
 */
function collect(s: Int32Array, b: number, win: number): number {
  const head = s[b + F.hHead];
  let n = 0;
  let live = 0;
  const tmp = collectTmp;
  for (let k = 0; k < HIST && live < win; k++) {
    const e = s[b + F.hist + ((head - k + HIST * 4) % HIST)];
    if (e === 0) break; // never written
    if ((e & H_FROZEN) === 0 || k === 0) live++;
    tmp[n++] = e & H_DIR;
  }
  for (let i = 0; i < n; i++) dirs[i] = tmp[n - 1 - i];
  return n;
}
const collectTmp = new Int32Array(HIST);

/** true when `pat` appears in order (as a subsequence) inside dirs[0..n). */
function subseq(n: number, pat: readonly number[]): boolean {
  let j = 0;
  for (let i = 0; i < n && j < pat.length; i++) if (dirs[i] === pat[j]) j++;
  return j === pat.length;
}

const P236 = [2, 3, 6];
const P214 = [2, 1, 4];
const P623 = [6, 2, 3];
const P323 = [3, 2, 3];
const P421 = [4, 2, 1];
const P_HCF = [4, 2, 6];
const P_HCB = [6, 2, 4];
const P236236 = [2, 3, 6, 2, 3, 6];
const P2626 = [2, 6, 2, 6];
const P214214 = [2, 1, 4, 2, 1, 4];
const P2424 = [2, 4, 2, 4];

export interface MotionWindows {
  qc: number;
  dp: number;
  hc: number;
  spd: number;
  double: number;
  chargeFrames: number;
  chargeKeep: number;
  tap22: number;
}

/** Does fighter block `b` currently satisfy motion `code` (MO.*)? `cur` = current direction. */
export function motionDone(s: Int32Array, b: number, code: number, w: MotionWindows): boolean {
  switch (code) {
    case MO.QCF:
      return subseq(collect(s, b, w.qc), P236);
    case MO.QCB:
      return subseq(collect(s, b, w.qc), P214);
    case MO.DP: {
      const n = collect(s, b, w.dp);
      return subseq(n, P623) || subseq(n, P323);
    }
    case MO.RDP:
      return subseq(collect(s, b, w.dp), P421);
    case MO.HCF:
      return subseq(collect(s, b, w.hc), P_HCF);
    case MO.HCB:
      return subseq(collect(s, b, w.hc), P_HCB);
    case MO.SPD: {
      const n = collect(s, b, w.spd);
      let m = 0;
      for (let i = 0; i < n; i++) {
        const d = dirs[i];
        if (d === 4) m |= 1;
        else if (d === 2) m |= 2;
        else if (d === 6) m |= 4;
        else if (d === 8) m |= 8;
      }
      const c = (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
      return c >= 3;
    }
    case MO.DQCF: {
      const n = collect(s, b, w.double);
      return subseq(n, P236236) || subseq(n, P2626);
    }
    case MO.DQCB: {
      const n = collect(s, b, w.double);
      return subseq(n, P214214) || subseq(n, P2424);
    }
    case MO.CHG_BF: {
      const cur = s[b + F.hist + s[b + F.hHead]] & H_DIR;
      if (cur !== 6 && cur !== 3 && cur !== 9) return false;
      return s[b + F.chBS] >= w.chargeFrames && s[b + F.chBR] <= w.chargeKeep;
    }
    case MO.CHG_DU: {
      const cur = s[b + F.hist + s[b + F.hHead]] & H_DIR;
      if (cur !== 7 && cur !== 8 && cur !== 9) return false;
      return s[b + F.chDS] >= w.chargeFrames && s[b + F.chDR] <= w.chargeKeep;
    }
    case MO.DD: {
      const n = collect(s, b, w.tap22);
      // 2, then a non-down frame, then 2 again
      let st = 0;
      for (let i = 0; i < n; i++) {
        const d = dirs[i];
        const down = d === 1 || d === 2 || d === 3;
        if (st === 0 && d === 2) st = 1;
        else if (st === 1 && !down) st = 2;
        else if (st === 2 && d === 2) return true;
      }
      return false;
    }
    default:
      return false;
  }
}

/**
 * Latest-ending match of `pat` in dirs[0..n) (reverse greedy: the newest occurrence of the last direction, then the newest
 * fitting occurrence of each earlier one). Writes the END / START ages into out[0] / out[1]; false when `pat` is absent.
 */
function lastMatch(n: number, pat: readonly number[], out: Int32Array): boolean {
  let j = pat.length - 1;
  let end = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (dirs[i] !== pat[j]) continue;
    if (end < 0) end = i;
    if (j === 0) {
      out[0] = n - 1 - end;
      out[1] = n - 1 - i;
      return true;
    }
    j--;
  }
  return false;
}
const spanAlt = new Int32Array(2); // scratch (fully rewritten on every call)

/** The fresher of two pattern alternatives (smaller end age; tie: the later start) into out. */
function lastMatch2(n: number, p1: readonly number[], p2: readonly number[], out: Int32Array): boolean {
  const a = lastMatch(n, p1, out);
  if (!lastMatch(n, p2, spanAlt)) return a;
  if (!a || spanAlt[0] < out[0] || (spanAlt[0] === out[0] && spanAlt[1] < out[1])) {
    out[0] = spanAlt[0];
    out[1] = spanAlt[1];
  }
  return true;
}

/**
 * CHANGED(fix_input) (CONTRACT §35.24): when motion `code` is done, writes the ages of its latest-ending match into
 * out[0] = END (the newest entry that completes it) and out[1] = START (that match's first entry) and returns true; false
 * when the motion is not done. Age = history entries back from the newest (0 = this frame; frozen entries count as entries,
 * so two motions read off the same ring compare directly). The rekka parser (inputs.ts) uses it to tell a fresh sibling
 * motion from a leftover one still inside the window (the 214 typed for CUE 3 LOW vs the 236 that fired CUE 2).
 * Charge motions complete on this frame (0, 0); a 360 ends on its newest cardinal and starts where its third distinct
 * cardinal is reached going back.
 */
export function motionSpan(s: Int32Array, b: number, code: number, w: MotionWindows, out: Int32Array): boolean {
  if (!motionDone(s, b, code, w)) return false;
  switch (code) {
    case MO.QCF:
      return lastMatch(collect(s, b, w.qc), P236, out);
    case MO.QCB:
      return lastMatch(collect(s, b, w.qc), P214, out);
    case MO.DP:
      return lastMatch2(collect(s, b, w.dp), P623, P323, out);
    case MO.RDP:
      return lastMatch(collect(s, b, w.dp), P421, out);
    case MO.HCF:
      return lastMatch(collect(s, b, w.hc), P_HCF, out);
    case MO.HCB:
      return lastMatch(collect(s, b, w.hc), P_HCB, out);
    case MO.DQCF:
      return lastMatch2(collect(s, b, w.double), P236236, P2626, out);
    case MO.DQCB:
      return lastMatch2(collect(s, b, w.double), P214214, P2424, out);
    case MO.SPD: {
      const n = collect(s, b, w.spd);
      let seen = 0;
      let cnt = 0;
      let end = -1;
      for (let i = n - 1; i >= 0; i--) {
        const d = dirs[i];
        const bit = d === 4 ? 1 : d === 2 ? 2 : d === 6 ? 4 : d === 8 ? 8 : 0;
        if (bit === 0) continue;
        if (end < 0) end = i;
        if ((seen & bit) !== 0) continue;
        seen |= bit;
        if (++cnt >= 3) {
          out[0] = n - 1 - end;
          out[1] = n - 1 - i;
          return true;
        }
      }
      return false;
    }
    case MO.DD: {
      // the forward 2, non-down, 2 machine run backward from the newest entry
      const n = collect(s, b, w.tap22);
      let st = 0;
      let end = -1;
      for (let i = n - 1; i >= 0; i--) {
        const d = dirs[i];
        const down = d === 1 || d === 2 || d === 3;
        if (st === 0 && d === 2) {
          end = i;
          st = 1;
        } else if (st === 1 && !down) st = 2;
        else if (st === 2 && d === 2) {
          out[0] = n - 1 - end;
          out[1] = n - 1 - i;
          return true;
        }
      }
      return false;
    }
    default:
      // charge [4]6 / [2]8: completed by this frame's direction
      out[0] = 0;
      out[1] = 0;
      return true;
  }
}

/**
 * 66 / 44 detection on the frame the direction is newly entered: tap run of `want` (<= tapMax
 * frames), neutral gap (<= gapMax frames, direction 5 only), current frame = `want` again.
 */
export function dashDone(s: Int32Array, b: number, want: number, tapMax: number, gapMax: number): boolean {
  const head = s[b + F.hHead];
  const h0 = b + F.hist;
  if ((s[h0 + head] & H_DIR) !== want) return false;
  let k = 1;
  // skip frozen frames between samples
  let gap = 0;
  while (k < HIST) {
    const e = s[h0 + ((head - k + HIST * 4) % HIST)];
    if (e === 0) return false;
    if ((e & H_FROZEN) !== 0) {
      k++;
      continue;
    }
    const d = e & H_DIR;
    if (d === want) break;
    if (d !== 5) return false;
    gap++;
    if (gap > gapMax) return false;
    k++;
  }
  if (gap === 0) return false; // held, not re-tapped
  let tap = 0;
  while (k < HIST) {
    const e = s[h0 + ((head - k + HIST * 4) % HIST)];
    if (e === 0) break;
    if ((e & H_FROZEN) !== 0) {
      k++;
      continue;
    }
    if ((e & H_DIR) !== want) break;
    tap++;
    if (tap > tapMax) return false;
    k++;
  }
  return tap >= 1;
}
