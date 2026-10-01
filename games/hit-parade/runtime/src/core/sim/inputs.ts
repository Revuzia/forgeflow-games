// HIT PARADE — input words -> history ring -> buffered actions (CONTRACT §4.3.9, §4.4, §19.1-2).
//
// Input word (§4.4): bit0 UP, bit1 DOWN, bit2 LEFT, bit3 RIGHT (screen-relative, SOCD-cleaned by
// the input layer), bit4 L, bit5 M, bit6 H, bit7 S, bit8 ASSIST, bit9 THROW, bit10 PARRY,
// bit11 IMPACT, bit12 TAUNT, CHANGED(SIM3D) bit13 STEP_IN, bit14 STEP_OUT (CONTRACT §35.2). The sim converts LEFT/RIGHT
// to back/forward with `facing` (= the screen side from the camera basis, §35.3) and stores
// one history int per frame IN the state (motion.ts parses it). Parsing produces ONE action per
// frame by priority (EX > super > 360 > DP > QC > HC > charge > other specials > throw / parry /
// impact > assist route > normals > taunt > dash) and writes it into the action buffer
// (newest press wins); fighter.ts executes the buffer when the fighter may act.

import { ACT, BUF, F, FL, HIST, P, PROJ_CAP, ST, W, projBase } from './layout.ts';
import { H_FROZEN, dashDone, motionDone, motionSpan } from './motion.ts';
import type { MotionWindows } from './motion.ts';
import { K, MO, MOTION_PRIO, STK, UK } from './compile.ts';
import type { CFighter, CMove, CRoute, CSpecial, CTrigger } from './compile.ts';
import { ballReady } from './projectiles.ts';
import { canAfford, fb, isAirborne } from './state.ts';
import type { Match } from './state.ts';

export const IN = {
  UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, L: 16, M: 32, H: 64, S: 128, ASSIST: 256, THROW: 512, PARRY: 1024, IMPACT: 2048, TAUNT: 4096,
  STEP_IN: 8192, STEP_OUT: 16384, // CHANGED(SIM3D): circle away from / toward the camera (CONTRACT §35.2)
} as const;
/** CHANGED(SIM3D): the 15 used bits of the input word (bits 13 / 14 = STEP_IN / STEP_OUT). */
export const WORD_BITS = 0x7fff;
const BTN_MASK = 0x7ff0; // history: held buttons incl. the STEP bits (bits 4..14)

/** CHANGED(SIM3D): +1 = STEP_IN held, -1 = STEP_OUT held, 0 = neither or both (SOCD neutral). */
export function stepBits(raw: number): number {
  const a = (raw & IN.STEP_IN) !== 0;
  const b = (raw & IN.STEP_OUT) !== 0;
  return a === b ? 0 : a ? 1 : -1;
}
const AGE_CAP = 255;

/** Facing-relative numpad direction (1..9) of a raw word. */
export function dirOf(raw: number, facing: number): number {
  const up = (raw & IN.UP) !== 0;
  const dn = (raw & IN.DOWN) !== 0;
  const lf = (raw & IN.LEFT) !== 0;
  const rt = (raw & IN.RIGHT) !== 0;
  let v = 0;
  if (up && !dn) v = 1;
  else if (dn && !up) v = -1;
  let h = 0;
  if (rt && !lf) h = 1;
  else if (lf && !rt) h = -1;
  if (facing < 0) h = -h;
  return 5 + v * 3 + h;
}

/** Current facing-relative direction from the newest history entry. */
export function curDir(s: Int32Array, b: number): number {
  const e = s[b + F.hist + s[b + F.hHead]];
  return e === 0 ? 5 : e & 0xf;
}

function ageBtn(s: Int32Array, o: number, pressed: number, bit: number): void {
  if ((pressed & bit) !== 0) s[o] = 0;
  else if (s[o] < AGE_CAP) s[o]++;
}

/** Records this frame's raw input: history, press ages, charge counters. */
export function recordInput(m: Match, i: number, raw: number, frozen: boolean): void {
  const s = m.s;
  const b = fb(i);
  raw &= WORD_BITS;
  s[b + F.prevRaw] = s[b + F.raw];
  s[b + F.raw] = raw;
  const dir = dirOf(raw, s[b + F.facing]);
  const head = (s[b + F.hHead] + 1) % HIST;
  s[b + F.hHead] = head;
  s[b + F.hist + head] = dir | (raw & BTN_MASK) | (frozen ? H_FROZEN : 0);
  const pressed = raw & ~s[b + F.prevRaw];
  ageBtn(s, b + F.ageL, pressed, IN.L);
  ageBtn(s, b + F.ageM, pressed, IN.M);
  ageBtn(s, b + F.ageH, pressed, IN.H);
  ageBtn(s, b + F.ageS, pressed, IN.S);
  if (!frozen) {
    // charge: back = 1/4/7, down = 1/2/3. CHANGED(SIM) P2 (CONTRACT §28.2 charge): in blockstun, hitstun and dashes a
    // released direction neither loses the charge nor ages its keep window (the charge is kept through them)
    const back = dir === 1 || dir === 4 || dir === 7;
    const down = dir === 1 || dir === 2 || dir === 3;
    const st = s[b + F.st];
    const keep = st === ST.BLOCKSTUN || st === ST.HITSTUN || st === ST.DASH_F || st === ST.DASH_B;
    // a release shorter than the keep window does not lose the charge: re-holding resumes it (the 44 back dash)
    const keepF = m.cf[i].mw.chargeKeep;
    if (back) {
      if (s[b + F.chB] === 0 && s[b + F.chBS] > 0 && s[b + F.chBR] <= keepF) s[b + F.chB] = s[b + F.chBS];
      if (s[b + F.chB] < 1000) s[b + F.chB]++;
      s[b + F.chBR] = 0;
      s[b + F.chBS] = s[b + F.chB];
    } else if (!keep) {
      if (s[b + F.chB] > 0) s[b + F.chBS] = s[b + F.chB];
      s[b + F.chB] = 0;
      if (s[b + F.chBR] < AGE_CAP) s[b + F.chBR]++;
    }
    if (down) {
      if (s[b + F.chD] === 0 && s[b + F.chDS] > 0 && s[b + F.chDR] <= keepF) s[b + F.chD] = s[b + F.chDS];
      if (s[b + F.chD] < 1000) s[b + F.chD]++;
      s[b + F.chDR] = 0;
      s[b + F.chDS] = s[b + F.chD];
    } else if (!keep) {
      if (s[b + F.chD] > 0) s[b + F.chDS] = s[b + F.chD];
      s[b + F.chD] = 0;
      if (s[b + F.chDR] < AGE_CAP) s[b + F.chDR]++;
    }
  }
  if ((raw & IN.ASSIST) !== 0) s[b + F.flags] |= FL.ASSIST;
  else s[b + F.flags] &= ~FL.ASSIST;
}

/** Active projectiles owned by fighter `i` (CHANGED(SIM) P2: the ball (kind 1) and heckle objects never count). */
export function projCount(m: Match, i: number): number {
  const s = m.s;
  let n = 0;
  for (let k = 0; k < PROJ_CAP; k++) {
    const pb = projBase(k);
    if (s[pb + P.act] !== 0 && s[pb + P.owner] === i && s[pb + P.kind] === 0) n++;
  }
  return n;
}

/** CHANGED(SIM) P2: is fighter i in phase 2 of a `phases` unique? */
export function inPhase2(m: Match, i: number): boolean {
  return m.cf[i].uk === UK.PHASES && m.s[fb(i) + F.uniq] === 2;
}

/** CHANGED(SIM) P2: the fighter's routing tables for its current phase (CONTRACT §28.2 phases). */
export function routeOf(m: Match, i: number): CRoute {
  const cf = m.cf[i];
  return inPhase2(m, i) ? cf.route2 : cf.route1;
}

/** Projectile limit / ball availability / phase gate of move `mv` (shared by the parser and the executor). */
export function projOk(m: Match, i: number, mv: CMove): boolean {
  if (mv.phase2 && !inPhase2(m, i)) return false;
  if (mv.ballAct === 1 || mv.ballAct === 2) return ballReady(m, i, mv);
  if (mv.proj && projCount(m, i) >= mv.proj.limit) return false;
  return true;
}

function usable(m: Match, i: number, mv: CMove, air: boolean): boolean {
  if (air ? !mv.usableAir : mv.airOnly) return false;
  if (!canAfford(m, i, mv)) return false;
  return projOk(m, i, mv);
}

function setBuf(m: Match, i: number, act: number, mv: number, flags: number, win: number): void {
  const s = m.s;
  const b = fb(i);
  s[b + F.bufA] = act;
  s[b + F.bufM] = mv;
  s[b + F.bufF] = flags;
  s[b + F.bufAge] = 0;
  s[b + F.bufWin] = win;
}

/**
 * Chain target matching a pressed normal (dir class + button + air). CHANGED(fix_input) (CONTRACT §35.24): an EXACT direction
 * match wins over a 5X / 2X class match (a 5X part no longer shadows a 6X / 4X sibling, a 2X part a 3X / 1X one); with no
 * overlapping siblings (every kit today) the result is unchanged.
 */
function chainTarget(cf: CFighter, cur: CMove | null, dir: number, btn: number, air: boolean): number {
  if (!cur) return -1;
  let cls = -1;
  for (let k = 0; k < cur.chains.length; k++) {
    const t = cf.moves[cur.chains[k]];
    if (t.inBtn !== btn || t.inAir !== air) continue;
    const td = t.inDir;
    if (td === dir) return t.idx;
    if (cls < 0 && ((td === 5 && (dir === 4 || dir === 5 || dir === 6)) || (td === 2 && (dir === 1 || dir === 2 || dir === 3)))) cls = t.idx;
  }
  return cls;
}

// ------------------------------------------------------------------ CHANGED(fix_input): rekka / follow-up trigger ranking
/**
 * How specifically a press matches a chain trigger (CONTRACT §20.2 `trigger`, §35.24 a). The parser buffers the sibling with
 * the highest tier; ties keep the authored `cancel` order, except motion vs motion (motionWins).
 *   T_EXACT  SIMPLE S form, the exact direction ("2S" on 2)
 *   T_CLASS  SIMPLE S form, the same SIMPLE class - the 5S / 6S / 2S / 4S routing: 1 / 3 -> 2S, 9 -> 6S, 7 -> 4S, 8 -> 5S
 *   T_MOTION the classic form: its motion + one of its buttons (CLASSIC; in SIMPLE too, §1)
 *   T_ANY    SIMPLE "5S" on any other direction - the neutral fallback, only when no more specific sibling matches
 *   T_BTN    a button-only trigger (SIMPLE "LMH", a classic form without a motion)
 * Before: the FIRST sibling whose trigger matched won, and "5S" matched S with any direction, so Patch CUE 2 -> 2S was
 * CUE 3 OVERHEAD (sibling order cue3_oh "5S", cue3_lo "2S"), never CUE 3 LOW.
 */
const T_BTN = 1;
const T_ANY = 2;
const T_MOTION = 3;
const T_CLASS = 4;
const T_EXACT = 5;

/** The SIMPLE direction class of a numpad direction (the one-button routing: 6 / 9, 4 / 7, 1 / 2 / 3, 5 / 8). */
function simpleClass(dir: number): number {
  return dir === 6 || dir === 9 ? 6 : dir === 4 || dir === 7 ? 4 : dir === 1 || dir === 2 || dir === 3 ? 2 : 5;
}

/** Input bits of a trigger button mask (bit0 L, bit1 M, bit2 H, bit3 S). */
function trigBits(mask: number): number {
  return (mask & 1 ? IN.L : 0) | (mask & 2 ? IN.M : 0) | (mask & 4 ? IN.H : 0) | (mask & 8 ? IN.S : 0);
}

// scratch for the motion tier (fully rewritten on every parse; never carries state between frames)
const spanNew = new Int32Array(2);
const spanBest = new Int32Array(2);

/**
 * Tier of trigger `tr` for this frame's press (0 = no match). A T_MOTION result leaves the motion's span (motion.ts
 * motionSpan: end / start ages) in spanNew.
 */
function triggerTier(s: Int32Array, b: number, tr: CTrigger, scheme: number, pressed: number, dir: number, mw: MotionWindows): number {
  let tier = 0;
  if (scheme === 0) {
    if (tr.simpleDir >= 0) {
      if ((pressed & IN.S) !== 0) tier = tr.simpleDir === dir ? T_EXACT : tr.simpleDir === simpleClass(dir) ? T_CLASS : tr.simpleDir === 5 ? T_ANY : 0;
    } else if ((pressed & trigBits(tr.simpleBtn & 7)) !== 0) tier = T_BTN;
  }
  if (tier >= T_MOTION) return tier;
  if ((pressed & trigBits(tr.btnMask)) !== 0) {
    if (tr.motion === 0) return tier > T_BTN ? tier : T_BTN;
    if (motionSpan(s, b, tr.motion, mw, spanNew)) return T_MOTION;
  }
  return tier;
}

/**
 * Motion tier tie-break: does the new trigger's motion (span in spanNew, priority prioN) beat the best so far (spanBest,
 * prioB)? A motion that ENDED BEFORE the other one STARTED is a leftover (the 236 that fired CUE 2 is still inside the
 * window when 214 is typed for CUE 3 LOW, and hitstop frames never age it): the fresh one wins. Overlapping motions (6236 =
 * 623 and 236) fall back to the special routing's MOTION_PRIO (the longer motion first, so 6236 stays the DP), then to the
 * authored order.
 */
function motionWins(prioN: number, prioB: number): boolean {
  if (spanBest[0] > spanNew[1]) return true; // the best's motion ended before the new one started
  if (spanNew[0] > spanBest[1]) return false; // the new motion is the leftover
  return prioN < prioB;
}

/** CHANGED(fix_input): does special row `sp` route to move `idx` (any button / EX)? */
function rowHas(sp: CSpecial, idx: number): boolean {
  return sp.idx[0] === idx || sp.idx[1] === idx || sp.idx[2] === idx || sp.idx[3] === idx;
}

/**
 * Parses this frame's input of fighter `i` into the action buffer. Called every frame (also during
 * freezes and hitstop: the buffer does not age then).
 */
export function parseAction(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  const st = s[b + F.st];
  if (st === ST.INTRO || st === ST.KO || st === ST.WIN || st === ST.LOSE || st === ST.ABSENT) return;
  // CHANGED(SIM3D) (CONTRACT §35.2): a sidestep buffers presses only from step frame step.bufferF on (the parse runs
  // before this frame's update: the step frame being played now is stF + 2). CHANGED(fix_core) D9 (CONTRACT §35.20):
  // bufferF 9 -> 2, i.e. every press made during the step buffers (it was silently dropped on step frames 2-8)
  if (st === ST.SIDESTEP && s[b + F.stF] + 2 < m.sys.stepBufferF) return;
  const cf = m.cf[i];
  const R = routeOf(m, i); // CHANGED(SIM) P2: phase-2 routing for a `phases` fighter
  const sys = m.sys.raw;
  const scheme = m.cfg.p[i].scheme;
  const raw = s[b + F.raw];
  const prev = s[b + F.prevRaw];
  const pressed = raw & ~prev;
  const released = prev & ~raw;
  const dir = curDir(s, b);
  const air = isAirborne(s, b) || st === ST.AIR;
  const down = dir === 1 || dir === 2 || dir === 3;
  const kdCtx = st === ST.KNOCKDOWN || st === ST.THROWN;
  const baseWin = scheme === 0 ? sys.buffer.simple : sys.buffer.classic;
  let win = kdCtx ? Math.max(baseWin, sys.buffer.wakeup) : st === ST.HITSTUN || st === ST.BLOCKSTUN ? Math.max(baseWin, sys.buffer.afterStun) : baseWin;
  // CHANGED(fix_core) D9 (CONTRACT §35.20): a press made on sidestep frame k (2 .. stepAttackF - 1) is HELD until the step's
  // action frame stepAttackF (11), where it comes out (step-attacks / follow-ups), and keeps the normal window after it; a
  // later press overwrites it (setBuf: the newest press wins). The STEP tap and the dash keep their own short windows.
  if (st === ST.SIDESTEP) win = Math.max(win, m.sys.stepAttackF - (s[b + F.stF] + 2) + baseWin);
  const chord = sys.buffer.chordFrames - 1;
  const w = cf.mw; // CHANGED(SIM) P2: per-fighter charge numbers (unique.chargeF / keepF)
  const curMv = s[b + F.mv] >= 0 ? cf.moves[s[b + F.mv]] : null;

  // ---------------------------------------------------------------- SIMPLE S+H over follow-ups (CHANGED(fix_input))
  // CONTRACT §35.24 item 2b (orchestrator decision): in SIMPLE the S+H super chord completed on THIS frame (S with H pressed
  // this frame or one frame before, or H with S pressed one frame before - the chord window of the S+H routing below) is the
  // SUPER, not a follow-up press, while the running move has follow-ups and its cancel list allows a super and the super is
  // usable. Before: the follow-up triggers read first, so S+H in Patch's CUE 1 / CUE 2 gave CUE 2 / CUE 3 and the authored
  // "super" cancels could never be used in SIMPLE. A move without a super cancel, or an unaffordable super, keeps the S press
  // as the follow-up (unchanged); CLASSIC is unchanged (a fast 236, 236 rekka already contains 236236).
  if (scheme === 0 && curMv !== null && curMv.cSuper && curMv.chains.length > 0) {
    const chordS = (pressed & IN.S) !== 0 && (raw & IN.H) !== 0 && s[b + F.ageH] <= chord;
    const chordH = (pressed & IN.H) !== 0 && (raw & IN.S) !== 0 && s[b + F.ageS] <= chord;
    if (chordS || chordH) {
      const sup = down ? R.sup3 : R.sup1;
      if (sup >= 0 && usable(m, i, cf.moves[sup], air)) {
        setBuf(m, i, ACT.MOVE, sup, BUF.SIMPLE, win);
        return;
      }
    }
  }

  // ---------------------------------------------------------------- rekka triggers (CONTRACT 20.2)
  // CHANGED(fix_input) (CONTRACT §35.24 a): every sibling trigger is ranked (triggerTier) and the MOST SPECIFIC affordable one
  // is buffered - an exact SIMPLE direction beats its class, a motion beats the neutral "5S" fallback, a fresh motion beats a
  // leftover one (motionWins) - instead of the first sibling that matched.
  if (curMv && curMv.chains.length > 0 && (pressed & (IN.L | IN.M | IN.H | IN.S)) !== 0) {
    let best = -1;
    let bestTier = 0;
    let bestPrio = 0;
    for (let k = 0; k < curMv.chains.length; k++) {
      const tm = cf.moves[curMv.chains[k]];
      const tr = tm.trigger;
      if (!tr) continue;
      const tier = triggerTier(s, b, tr, scheme, pressed, dir, sys.motion);
      if (tier === 0 || tier < bestTier || !canAfford(m, i, tm)) continue;
      const prio = tier === T_MOTION ? MOTION_PRIO[tr.motion] ?? 9 : 0;
      if (best >= 0 && tier === bestTier && (tier !== T_MOTION || !motionWins(prio, bestPrio))) continue;
      best = tm.idx;
      bestTier = tier;
      bestPrio = prio;
      if (tier === T_MOTION) {
        spanBest[0] = spanNew[0];
        spanBest[1] = spanNew[1];
      }
    }
    if (best >= 0) {
      setBuf(m, i, ACT.MOVE, best, BUF.CHAIN, win);
      return;
    }
  }

  // ---------------------------------------------------------------- SIMPLE one-button (S)
  if (scheme === 0 && (pressed & IN.S) !== 0 && air && R.sAir >= 0 && usable(m, i, cf.moves[R.sAir], true)) {
    setBuf(m, i, ACT.MOVE, R.sAir, BUF.SIMPLE, win);
    return;
  }
  if (scheme === 0 && (pressed & IN.S) !== 0) {
    const hChord = (raw & IN.H) !== 0 && s[b + F.ageH] <= chord;
    if (hChord) {
      const sup = down ? R.sup3 : R.sup1;
      if (sup >= 0 && usable(m, i, cf.moves[sup], air)) {
        setBuf(m, i, ACT.MOVE, sup, BUF.SIMPLE, win);
        return;
      }
    }
    if ((raw & IN.ASSIST) !== 0) {
      const ex = dir === 6 || dir === 9 ? R.e6 : dir === 4 || dir === 7 ? R.e4 : down ? R.e2 : R.e5;
      if (ex >= 0 && usable(m, i, cf.moves[ex], air)) {
        setBuf(m, i, ACT.MOVE, ex, BUF.SIMPLE, win);
        return;
      }
    }
    const sp = dir === 6 || dir === 9 ? R.s6 : dir === 4 || dir === 7 ? R.s4 : down ? R.s2 : R.s5;
    const spF = sp >= 0 ? sp : R.s5;
    if (spF >= 0 && usable(m, i, cf.moves[spF], air)) {
      setBuf(m, i, ACT.MOVE, spF, BUF.SIMPLE, win);
      return;
    }
  }
  // SIMPLE: H pressed right after S -> super (chord either order)
  if (scheme === 0 && (pressed & IN.H) !== 0 && (raw & IN.S) !== 0 && s[b + F.ageS] <= chord) {
    const sup = down ? R.sup3 : R.sup1;
    if (sup >= 0 && usable(m, i, cf.moves[sup], air)) {
      setBuf(m, i, ACT.MOVE, sup, BUF.SIMPLE, win);
      return;
    }
  }

  // ---------------------------------------------------------------- motion specials
  const trig = (pressed | released) & (IN.L | IN.M | IN.H | IN.S);
  const trigS = scheme === 1 ? trig & IN.S : 0;
  const trigLMH = trig & (IN.L | IN.M | IN.H);
  const neg = ((pressed & (IN.L | IN.M | IN.H | IN.S)) & trig) === 0 ? BUF.NEG : 0;
  // CHANGED(fix_input) (CONTRACT §35.24 b): a negative-edge (release-only) read
  //  - never overwrites a live follow-up the player PRESSED (a rekka / target-combo chain, a stance follow-up). Before: the
  //    release of the chain's button re-read the still-fresh motion (hitstop never ages it) as the PARENT special and
  //    replaced the buffered chain - Patch 236M typed in CUE 1's hitstop gave no CUE 2 (after the hitstop it did);
  //  - never re-reads the special row of the move already running (runRow). Before: a special with a "special" cancel
  //    restarted itself on the button's release - bruno BRACE / gazza DIVE / boneyard BUTCHER'S BLOCK / zambini EX VANISH
  //    (2 more NERVE bars) - and a release in CUE 1 buffered CUE 1 again.
  // A release still fires a special from neutral / a cancel window exactly as before (the §4.3.9 negative edge).
  const keepFollow = neg !== 0 && s[b + F.bufA] === ACT.MOVE && s[b + F.bufAge] <= s[b + F.bufWin] && (s[b + F.bufF] & (BUF.CHAIN | BUF.STANCE)) !== 0;
  const runRow = neg !== 0 ? s[b + F.mv] : -1;
  if ((trigS !== 0 || trigLMH !== 0) && !keepFollow) {
    let lastMotion = -1;
    let lastOk = false;
    // EX first (CLASSIC: motion + S)
    if (trigS !== 0) {
      for (let k = 0; k < R.specials.length; k++) {
        const sp = R.specials[k];
        const idx = sp.idx[3];
        if (idx < 0 || sp.motion === MO.DQCF || sp.motion === MO.DQCB) continue;
        if (runRow >= 0 && rowHas(sp, runRow)) continue;
        if (sp.motion !== lastMotion) {
          lastMotion = sp.motion;
          lastOk = motionDone(s, b, sp.motion, w);
        }
        if (lastOk && usable(m, i, cf.moves[idx], air)) {
          setBuf(m, i, ACT.MOVE, idx, neg, win);
          return;
        }
      }
    }
    if (trigLMH !== 0) {
      lastMotion = -1;
      for (let k = 0; k < R.specials.length; k++) {
        const sp = R.specials[k];
        if (runRow >= 0 && rowHas(sp, runRow)) continue;
        if (sp.motion !== lastMotion) {
          lastMotion = sp.motion;
          lastOk = motionDone(s, b, sp.motion, w);
        }
        if (!lastOk) continue;
        for (let bt = 2; bt >= 0; bt--) {
          const bit = bt === 0 ? IN.L : bt === 1 ? IN.M : IN.H;
          if ((trigLMH & bit) === 0 || (sp.btnMask & (1 << bt)) === 0) continue;
          const idx = sp.idx[bt];
          if (idx < 0) continue;
          if (usable(m, i, cf.moves[idx], air)) {
            setBuf(m, i, ACT.MOVE, idx, neg, win);
            return;
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- throw / parry / impact
  const lmChord =
    ((pressed & IN.L) !== 0 && (raw & IN.M) !== 0 && s[b + F.ageM] <= chord) ||
    ((pressed & IN.M) !== 0 && (raw & IN.L) !== 0 && s[b + F.ageL] <= chord);
  if (!air && ((pressed & IN.THROW) !== 0 || lmChord)) {
    const back = dir === 4 || dir === 1 || dir === 7;
    setBuf(m, i, ACT.MOVE, back ? cf.throwB : cf.throwF, 0, win);
    return;
  }
  const mhChord =
    ((pressed & IN.M) !== 0 && (raw & IN.H) !== 0 && s[b + F.ageH] <= chord) ||
    ((pressed & IN.H) !== 0 && (raw & IN.M) !== 0 && s[b + F.ageM] <= chord);
  if (!air && ((pressed & IN.PARRY) !== 0 || mhChord)) {
    setBuf(m, i, ACT.PARRY, -1, 0, win);
    return;
  }
  if (!air && (pressed & IN.IMPACT) !== 0) {
    setBuf(m, i, ACT.MOVE, cf.impact, 0, win);
    return;
  }

  // ---------------------------------------------------------------- stance follow-ups (CHANGED(SIM) P2, §28.2 stance)
  // In STANCE (or during a stance enter move, so the press buffers into the stance) L / M / H fire the follow-ups.
  if (cf.uk === UK.STANCE && (pressed & (IN.L | IN.M | IN.H)) !== 0 && (st === ST.STANCE || (curMv !== null && curMv.stanceKind === STK.ENTER))) {
    const fb2 = (pressed & IN.H) !== 0 ? 2 : (pressed & IN.M) !== 0 ? 1 : 0;
    const fu = cf.u.stFollow[fb2];
    if (fu >= 0 && canAfford(m, i, cf.moves[fu])) {
      setBuf(m, i, ACT.MOVE, fu, BUF.STANCE, win);
      return;
    }
  }

  // ---------------------------------------------------------------- assist route (SIMPLE: hold ASSIST + tap L)
  if (scheme === 0 && (raw & IN.ASSIST) !== 0 && (pressed & IN.L) !== 0 && cf.assist.length > 0 && !air) {
    setBuf(m, i, ACT.ROUTE, -1, 0, win);
    return;
  }

  // ---------------------------------------------------------------- normals
  const nb = (pressed & IN.H) !== 0 ? 2 : (pressed & IN.M) !== 0 ? 1 : (pressed & IN.L) !== 0 ? 0 : -1;
  // CHANGED(SIM3D) (FIGHTERS3D §35.12.5): step-attacks win over the plain normals while stepping
  const sAtk = nb >= 0 && (st === ST.SIDESTEP || st === ST.SIDEWALK) ? cf.stepAtk[nb as number] : -1;
  if (sAtk >= 0 && canAfford(m, i, cf.moves[sAtk])) {
    setBuf(m, i, ACT.MOVE, sAtk, BUF.STEPATK, win);
    return;
  }
  if (nb >= 0) {
    const ch = chainTarget(cf, curMv, dir, nb, air);
    if (ch >= 0) {
      setBuf(m, i, ACT.MOVE, ch, BUF.CHAIN, win);
      return;
    }
    const idx = (air ? cf.aTable : cf.gTable)[dir * 3 + nb];
    if (idx >= 0) {
      setBuf(m, i, ACT.MOVE, idx, 0, win);
      return;
    }
  }

  // ---------------------------------------------------------------- taunt, steps, dashes
  if ((pressed & IN.TAUNT) !== 0 && !air) {
    setBuf(m, i, ACT.TAUNT, -1, 0, win);
    return;
  }
  // CHANGED(SIM3D) (CONTRACT §35.2): a STEP tap buffers the sidestep (the dash window); a held STEP circles in fighter.ts
  if (!air && (pressed & (IN.STEP_IN | IN.STEP_OUT)) !== 0) {
    const sb = stepBits(raw);
    if (sb !== 0) {
      setBuf(m, i, ACT.STEP, sb > 0 ? 1 : 0, 0, Math.max(sys.buffer.dash, 2));
      return;
    }
  }
  if (!air && (dir === 6 || dir === 4)) {
    const e1 = s[b + F.hist + ((s[b + F.hHead] - 1 + HIST) % HIST)];
    if ((e1 & 0xf) !== dir && dashDone(s, b, dir, sys.movement.dashTapMax, sys.movement.dashGapMax)) {
      setBuf(m, i, dir === 6 ? ACT.DASH_F : ACT.DASH_B, -1, 0, sys.buffer.dash);
    }
  }
}

/** Air-normal / special kinds allowed to cancel prejump frames. */
export function prejumpCancelable(mv: CMove): boolean {
  return mv.isSpecialCat || mv.isSuper || mv.kind === K.cmdgrab;
}

void W;
