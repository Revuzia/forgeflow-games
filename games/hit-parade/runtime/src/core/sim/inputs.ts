// HIT PARADE — input words -> history ring -> buffered actions (CONTRACT §4.3.9, §4.4, §19.1-2).
//
// Input word (§4.4): bit0 UP, bit1 DOWN, bit2 LEFT, bit3 RIGHT (screen-relative, SOCD-cleaned by
// the input layer), bit4 L, bit5 M, bit6 H, bit7 S, bit8 ASSIST, bit9 THROW, bit10 PARRY,
// bit11 IMPACT, bit12 TAUNT. The sim converts LEFT/RIGHT to back/forward with `facing` and stores
// one history int per frame IN the state (motion.ts parses it). Parsing produces ONE action per
// frame by priority (EX > super > 360 > DP > QC > HC > charge > other specials > throw / parry /
// impact > assist route > normals > taunt > dash) and writes it into the action buffer
// (newest press wins); fighter.ts executes the buffer when the fighter may act.

import { ACT, BUF, F, FL, HIST, P, PROJ_CAP, ST, W, projBase } from './layout.ts';
import { H_FROZEN, dashDone, motionDone } from './motion.ts';
import { K, MO } from './compile.ts';
import type { CFighter, CMove } from './compile.ts';
import { canAfford, fb, isAirborne } from './state.ts';
import type { Match } from './state.ts';

export const IN = {
  UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, L: 16, M: 32, H: 64, S: 128, ASSIST: 256, THROW: 512, PARRY: 1024, IMPACT: 2048, TAUNT: 4096,
} as const;
const BTN_MASK = 0x1ff0;
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
  raw &= 0x1fff;
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
    // charge: back = 1/4/7, down = 1/2/3 (charge persists through stun and dashes)
    const back = dir === 1 || dir === 4 || dir === 7;
    const down = dir === 1 || dir === 2 || dir === 3;
    if (back) {
      if (s[b + F.chB] < 1000) s[b + F.chB]++;
      s[b + F.chBR] = 0;
      s[b + F.chBS] = s[b + F.chB];
    } else {
      if (s[b + F.chB] > 0) s[b + F.chBS] = s[b + F.chB];
      s[b + F.chB] = 0;
      if (s[b + F.chBR] < AGE_CAP) s[b + F.chBR]++;
    }
    if (down) {
      if (s[b + F.chD] < 1000) s[b + F.chD]++;
      s[b + F.chDR] = 0;
      s[b + F.chDS] = s[b + F.chD];
    } else {
      if (s[b + F.chD] > 0) s[b + F.chDS] = s[b + F.chD];
      s[b + F.chD] = 0;
      if (s[b + F.chDR] < AGE_CAP) s[b + F.chDR]++;
    }
  }
  if ((raw & IN.ASSIST) !== 0) s[b + F.flags] |= FL.ASSIST;
  else s[b + F.flags] &= ~FL.ASSIST;
}

/** Active projectiles owned by fighter `i`. */
export function projCount(m: Match, i: number): number {
  const s = m.s;
  let n = 0;
  for (let k = 0; k < PROJ_CAP; k++) {
    const pb = projBase(k);
    if (s[pb + P.act] !== 0 && s[pb + P.owner] === i) n++;
  }
  return n;
}

function usable(m: Match, i: number, mv: CMove, air: boolean): boolean {
  if (air ? !mv.usableAir : mv.airOnly) return false;
  if (!canAfford(m, i, mv)) return false;
  if (mv.proj && projCount(m, i) >= mv.proj.limit) return false;
  return true;
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

/** Chain target matching a pressed normal (dir class + button + air). */
function chainTarget(cf: CFighter, cur: CMove | null, dir: number, btn: number, air: boolean): number {
  if (!cur) return -1;
  for (let k = 0; k < cur.chains.length; k++) {
    const t = cf.moves[cur.chains[k]];
    if (t.inBtn !== btn || t.inAir !== air) continue;
    const td = t.inDir;
    const ok = td === dir || (td === 5 && (dir === 4 || dir === 5 || dir === 6)) || (td === 2 && (dir === 1 || dir === 2 || dir === 3));
    if (ok) return t.idx;
  }
  return -1;
}

/**
 * Parses this frame's input of fighter `i` into the action buffer. Called every frame (also during
 * freezes and hitstop: the buffer does not age then).
 */
export function parseAction(m: Match, i: number): void {
  const s = m.s;
  const b = fb(i);
  const st = s[b + F.st];
  if (st === ST.INTRO || st === ST.KO || st === ST.WIN || st === ST.LOSE) return;
  const cf = m.cf[i];
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
  const win = kdCtx ? Math.max(baseWin, sys.buffer.wakeup) : st === ST.HITSTUN || st === ST.BLOCKSTUN ? Math.max(baseWin, sys.buffer.afterStun) : baseWin;
  const chord = sys.buffer.chordFrames - 1;
  const w = sys.motion;
  const curMv = s[b + F.mv] >= 0 ? cf.moves[s[b + F.mv]] : null;

  // ---------------------------------------------------------------- rekka triggers (CONTRACT 20.2)
  if (curMv && curMv.chains.length > 0 && (pressed & (IN.L | IN.M | IN.H | IN.S)) !== 0) {
    for (let k = 0; k < curMv.chains.length; k++) {
      const tm = cf.moves[curMv.chains[k]];
      const tr = tm.trigger;
      if (!tr) continue;
      let ok = false;
      if (scheme === 0 && (tr.simpleDir >= 0 || tr.simpleBtn !== 0)) {
        if (tr.simpleDir >= 0) ok = (pressed & IN.S) !== 0 && (tr.simpleDir === 5 || tr.simpleDir === dir || (tr.simpleDir === 2 && down));
        else ok = (pressed & ((tr.simpleBtn & 1 ? IN.L : 0) | (tr.simpleBtn & 2 ? IN.M : 0) | (tr.simpleBtn & 4 ? IN.H : 0))) !== 0;
      }
      if (!ok) {
        const bits = (tr.btnMask & 1 ? IN.L : 0) | (tr.btnMask & 2 ? IN.M : 0) | (tr.btnMask & 4 ? IN.H : 0) | (tr.btnMask & 8 ? IN.S : 0);
        ok = (pressed & bits) !== 0 && (tr.motion === 0 || motionDone(s, b, tr.motion, sys.motion));
      }
      if (ok && canAfford(m, i, tm)) {
        setBuf(m, i, ACT.MOVE, tm.idx, BUF.CHAIN, win);
        return;
      }
    }
  }

  // ---------------------------------------------------------------- SIMPLE one-button (S)
  if (scheme === 0 && (pressed & IN.S) !== 0 && air && cf.sAir >= 0 && usable(m, i, cf.moves[cf.sAir], true)) {
    setBuf(m, i, ACT.MOVE, cf.sAir, BUF.SIMPLE, win);
    return;
  }
  if (scheme === 0 && (pressed & IN.S) !== 0) {
    const hChord = (raw & IN.H) !== 0 && s[b + F.ageH] <= chord;
    if (hChord) {
      const sup = down ? cf.sup3 : cf.sup1;
      if (sup >= 0 && usable(m, i, cf.moves[sup], air)) {
        setBuf(m, i, ACT.MOVE, sup, BUF.SIMPLE, win);
        return;
      }
    }
    if ((raw & IN.ASSIST) !== 0) {
      const ex = dir === 6 || dir === 9 ? cf.e6 : dir === 4 || dir === 7 ? cf.e4 : down ? cf.e2 : cf.e5;
      if (ex >= 0 && usable(m, i, cf.moves[ex], air)) {
        setBuf(m, i, ACT.MOVE, ex, BUF.SIMPLE, win);
        return;
      }
    }
    const sp = dir === 6 || dir === 9 ? cf.s6 : dir === 4 || dir === 7 ? cf.s4 : down ? cf.s2 : cf.s5;
    const spF = sp >= 0 ? sp : cf.s5;
    if (spF >= 0 && usable(m, i, cf.moves[spF], air)) {
      setBuf(m, i, ACT.MOVE, spF, BUF.SIMPLE, win);
      return;
    }
  }
  // SIMPLE: H pressed right after S -> super (chord either order)
  if (scheme === 0 && (pressed & IN.H) !== 0 && (raw & IN.S) !== 0 && s[b + F.ageS] <= chord) {
    const sup = down ? cf.sup3 : cf.sup1;
    if (sup >= 0 && usable(m, i, cf.moves[sup], air)) {
      setBuf(m, i, ACT.MOVE, sup, BUF.SIMPLE, win);
      return;
    }
  }

  // ---------------------------------------------------------------- motion specials
  const trig = (pressed | released) & (IN.L | IN.M | IN.H | IN.S);
  const trigS = scheme === 1 ? trig & IN.S : 0;
  const trigLMH = trig & (IN.L | IN.M | IN.H);
  if (trigS !== 0 || trigLMH !== 0) {
    const neg = ((pressed & (IN.L | IN.M | IN.H | IN.S)) & trig) === 0 ? BUF.NEG : 0;
    let lastMotion = -1;
    let lastOk = false;
    // EX first (CLASSIC: motion + S)
    if (trigS !== 0) {
      for (let k = 0; k < cf.specials.length; k++) {
        const sp = cf.specials[k];
        const idx = sp.idx[3];
        if (idx < 0 || sp.motion === MO.DQCF || sp.motion === MO.DQCB) continue;
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
      for (let k = 0; k < cf.specials.length; k++) {
        const sp = cf.specials[k];
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

  // ---------------------------------------------------------------- assist route (SIMPLE: hold ASSIST + tap L)
  if (scheme === 0 && (raw & IN.ASSIST) !== 0 && (pressed & IN.L) !== 0 && cf.assist.length > 0 && !air) {
    setBuf(m, i, ACT.ROUTE, -1, 0, win);
    return;
  }

  // ---------------------------------------------------------------- normals
  const nb = (pressed & IN.H) !== 0 ? 2 : (pressed & IN.M) !== 0 ? 1 : (pressed & IN.L) !== 0 ? 0 : -1;
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

  // ---------------------------------------------------------------- taunt, dashes
  if ((pressed & IN.TAUNT) !== 0 && !air) {
    setBuf(m, i, ACT.TAUNT, -1, 0, win);
    return;
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
