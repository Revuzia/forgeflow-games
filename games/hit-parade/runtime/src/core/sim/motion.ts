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
