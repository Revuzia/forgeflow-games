// HIT PARADE - core/net/toysim.ts (lane NET). A small deterministic 1v1 fighting sim that implements
// SimPort, for the net probes and the net lab page while (or wherever) core/sim/match.ts is absent.
// Not the game: it only has to be input-sensitive (so mispredictions matter), keep ALL state in one
// Int32Array, and use integer math + an in-state mulberry32 RNG - the same rules the real sim follows.
// `leaky: true` adds hidden JS state (a counter outside the array) so the SyncTest can prove it fails.
//
// Input word bits (CONTRACT §4.4): b0 UP, b1 DOWN, b2 LEFT, b3 RIGHT, b4 L, b5 M, b6 H, b7 S.

import type { SimPort } from './rollback.ts';
import { hashInts } from './sync.ts';

// world
const W_FRAME = 0, W_RNG = 1, W_TIMER = 2, W_ROUND = 3, W_HITSTOP = 4, W_WINS0 = 5, W_WINS1 = 6, W_SUB = 7;
// fighter block (stride 16) at 8 + 16*i
const FB = 8, FS = 16;
const X = 0, Y = 1, VX = 2, VY = 3, FACE = 4, ST = 5, SF = 6, MOVE = 7, HP = 8, STUN = 9, PREV = 10, COMBO = 11, METER = 12, HIT = 13, CHG = 14;
// projectile block (stride 6) at 40 + 6*i
const PB = 40, PS = 6;
const PA = 0, PX = 1, PVX = 2, PLIFE = 3;

export const TOY_STATE_INTS = 64;

const ST_IDLE = 0, ST_ATK = 1, ST_STUN = 2, ST_AIR = 3, ST_BLOCK = 4;
// moves: startup, active, recovery, damage, hitstun, blockstun, reach (U), hitstop
const MOVES = [
  [4, 3, 8, 300, 14, 10, 90000, 8],
  [6, 3, 14, 600, 18, 12, 110000, 10],
  [10, 4, 20, 1000, 24, 16, 130000, 12],
];
const WALK = 3500;          // U/frame
const JUMP_VY = 9000;
const GRAV = 600;
const WALL = 800000;
const HP_MAX = 10000;

function mulberry(s: Int32Array): number {
  // mulberry32 with its state word IN the array (rollback-safe)
  let a = (s[W_RNG] + 0x6d2b79f5) | 0;
  s[W_RNG] = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (t ^ (t >>> 14)) >>> 0;
}

export class ToySim implements SimPort {
  readonly stateInts = TOY_STATE_INTS;
  readonly s = new Int32Array(TOY_STATE_INTS);
  private leaky: boolean;
  private hidden = 0;

  constructor(seed = 1, opts: { leaky?: boolean } = {}) {
    this.leaky = !!opts.leaky;
    const s = this.s;
    s[W_RNG] = seed | 0;
    s[W_TIMER] = 99 * 60;
    this.resetRound();
  }

  frame(): number { return this.s[W_FRAME]; }

  private resetRound(): void {
    const s = this.s;
    for (let i = 0; i < 2; i++) {
      const b = FB + FS * i;
      s[b + X] = i === 0 ? -120000 : 120000;
      s[b + Y] = 0; s[b + VX] = 0; s[b + VY] = 0;
      s[b + FACE] = i === 0 ? 1 : -1;
      s[b + ST] = ST_IDLE; s[b + SF] = 0; s[b + MOVE] = -1;
      s[b + HP] = HP_MAX; s[b + STUN] = 0; s[b + COMBO] = 0; s[b + HIT] = 0; s[b + CHG] = 0;
    }
    for (let i = 0; i < 2; i++) s[PB + PS * i + PA] = 0;
    s[W_TIMER] = 99 * 60;
    s[W_HITSTOP] = 0;
  }

  step(in1: number, in2: number): void {
    const s = this.s;
    s[W_FRAME]++;
    if (this.leaky) this.hidden++;
    if (s[W_HITSTOP] > 0) { s[W_HITSTOP]--; return; }
    const ins = [in1 & 0xffff, in2 & 0xffff];
    for (let i = 0; i < 2; i++) this.fighter(i, ins[i]);
    for (let i = 0; i < 2; i++) this.projectile(i);
    // separation + walls
    const a = FB, b = FB + FS;
    const dx = s[b + X] - s[a + X];
    if (dx > -40000 && dx < 40000 && s[a + Y] === 0 && s[b + Y] === 0) {
      const push = (40000 - (dx < 0 ? -dx : dx)) >> 1;
      if (dx >= 0) { s[a + X] -= push; s[b + X] += push; } else { s[a + X] += push; s[b + X] -= push; }
    }
    // toy-only "magnet": keep the fighters engaged so random inputs still produce exchanges
    const gap = s[b + X] - s[a + X];
    if (gap > 150000 || gap < -150000) {
      const pull = gap > 0 ? 2500 : -2500;
      s[a + X] += pull; s[b + X] -= pull;
    }
    for (let i = 0; i < 2; i++) {
      const o = FB + FS * i;
      if (s[o + X] < -WALL) s[o + X] = -WALL;
      if (s[o + X] > WALL) s[o + X] = WALL;
    }
    // facing when free
    for (let i = 0; i < 2; i++) {
      const o = FB + FS * i, t = FB + FS * (1 - i);
      if (s[o + ST] === ST_IDLE) s[o + FACE] = s[t + X] >= s[o + X] ? 1 : -1;
    }
    // timer + round end
    if (s[W_TIMER] > 0) s[W_TIMER]--;
    const hp0 = s[FB + HP], hp1 = s[FB + FS + HP];
    if (hp0 <= 0 || hp1 <= 0 || s[W_TIMER] === 0) {
      if (hp0 > hp1) s[W_WINS0]++; else if (hp1 > hp0) s[W_WINS1]++;
      s[W_ROUND]++;
      this.resetRound();
    }
    s[W_SUB] = (s[W_SUB] + (in1 & 0xff) * 3 + (in2 & 0xff)) | 0;
  }

  private fighter(i: number, word: number): void {
    const s = this.s;
    const o = FB + FS * i;
    const t = FB + FS * (1 - i);
    const prev = s[o + PREV];
    s[o + PREV] = word;
    const pressed = word & ~prev;
    const face = s[o + FACE];
    const fwd = face > 0 ? (word & 8) !== 0 : (word & 4) !== 0;
    const back = face > 0 ? (word & 4) !== 0 : (word & 8) !== 0;
    if (back) s[o + CHG]++; else s[o + CHG] = 0;
    switch (s[o + ST]) {
      case ST_IDLE: {
        s[o + VX] = 0;
        let btn = -1;
        if (pressed & 16) btn = 0; else if (pressed & 32) btn = 1; else if (pressed & 64) btn = 2;
        if (btn >= 0) { s[o + ST] = ST_ATK; s[o + SF] = 0; s[o + MOVE] = btn; s[o + HIT] = 0; break; }
        if ((pressed & 128) && s[PB + PS * i + PA] === 0) {
          const p = PB + PS * i;
          s[p + PA] = 1; s[p + PX] = s[o + X] + face * 60000; s[p + PVX] = face * 9000; s[p + PLIFE] = 90;
          s[o + ST] = ST_ATK; s[o + SF] = 0; s[o + MOVE] = 0; s[o + HIT] = 1;
          break;
        }
        if (word & 1) { s[o + ST] = ST_AIR; s[o + VY] = JUMP_VY; s[o + VX] = fwd ? WALK * 2 : back ? -WALK * 2 : 0; s[o + VX] *= face; break; }
        if (fwd) s[o + VX] = WALK * face;
        else if (back) s[o + VX] = -((WALK * 3) >> 2) * face;
        s[o + X] += s[o + VX];
        break;
      }
      case ST_ATK: {
        const m = MOVES[s[o + MOVE]];
        const f = ++s[o + SF];
        if (f >= m[0] && f < m[0] + m[1] && s[o + HIT] === 0) {
          const dx = (s[t + X] - s[o + X]) * face;
          if (dx > 0 && dx <= m[6] && s[t + Y] < 50000) {
            s[o + HIT] = 1;
            const tBack = s[t + FACE] > 0 ? 4 : 8;
            const blocking = (s[t + PREV] & tBack) !== 0 && (s[t + ST] === ST_IDLE || s[t + ST] === ST_BLOCK);
            if (blocking) {
              s[t + ST] = ST_BLOCK; s[t + STUN] = m[5]; s[t + X] += face * 8000;
              s[W_HITSTOP] = m[7] >> 1;
            } else {
              const varDmg = mulberry(s) % 50;           // in-state RNG: rollback-safe
              const scale = 10 - (s[o + COMBO] < 5 ? s[o + COMBO] : 5);
              const extra = this.leaky ? (this.hidden & 7) * 10 : 0;
              s[t + HP] -= ((m[3] + varDmg) * scale / 10 | 0) + extra;
              s[t + ST] = ST_STUN; s[t + STUN] = m[4]; s[t + X] += face * 12000;
              s[o + COMBO]++; s[o + METER] += m[3] >> 3;
              s[W_HITSTOP] = m[7];
            }
          }
        }
        if (f >= m[0] + m[1] + m[2]) { s[o + ST] = ST_IDLE; s[o + SF] = 0; s[o + MOVE] = -1; }
        break;
      }
      case ST_STUN:
      case ST_BLOCK: {
        if (--s[o + STUN] <= 0) { s[o + ST] = ST_IDLE; s[t + COMBO] = 0; }
        break;
      }
      case ST_AIR: {
        s[o + X] += s[o + VX];
        s[o + Y] += s[o + VY];
        s[o + VY] -= GRAV;
        if (s[o + Y] <= 0) { s[o + Y] = 0; s[o + VY] = 0; s[o + ST] = ST_IDLE; }
        break;
      }
      default:
        s[o + ST] = ST_IDLE;
    }
  }

  private projectile(i: number): void {
    const s = this.s;
    const p = PB + PS * i;
    if (s[p + PA] === 0) return;
    s[p + PX] += s[p + PVX];
    if (--s[p + PLIFE] <= 0 || s[p + PX] > WALL || s[p + PX] < -WALL) { s[p + PA] = 0; return; }
    const t = FB + FS * (1 - i);
    const dx = s[t + X] - s[p + PX];
    if (dx > -40000 && dx < 40000 && s[t + Y] < 60000) {
      s[t + HP] -= 500 + (mulberry(s) % 100);
      s[t + ST] = ST_STUN; s[t + STUN] = 20;
      s[p + PA] = 0;
      s[W_HITSTOP] = 6;
    }
  }

  save(slot: Int32Array): void { slot.set(this.s); }
  load(slot: Int32Array): void { this.s.set(slot); }
  checksum(): number { return hashInts(this.s); }
}
