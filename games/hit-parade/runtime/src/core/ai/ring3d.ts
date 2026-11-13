// HIT PARADE - the CPU in the 3D ring (lane AI3D, CONTRACT §35.9 / §35.15 / §35.17). THREE-free, DOM-free, clock-free.
//
// Two helpers the brain / planner use for the ring rules:
//   * StepOracle - "would a sidestep started NOW take me off this attack?" The answer depends on the move's tracking
//     (track.until / rate, homing, linear), its lateral depth, both bodies, the distance and the ring (STEPTUNE
//     §35.15.7: the defender's body decides as much as the tuning), so it is not estimated: it is PLAYED in a private
//     sandbox Match (the kit.ts pattern) from the visible situation. Honesty: the sandbox gets the opponent's
//     input-derived fields ZEROED (sense.ts HIDDEN_FIELDS: input history, buffer, press ages, charge, its unique ints)
//     and the opponent feeds no input - its started move simply runs as authored, which any player who knows the
//     move's frame data can foresee. The CPU only asks once its reaction window opened (brain.ready) and never writes
//     the real state (probe_personas H2 / H3 / H6 prove both).
//   * circle geometry - where a held STEP (sidewalk, §35.2) takes me around the opponent (the sim's arcMove, step curve
//     + sidewalk speed, ring clamp), and how far the ring wall behind me / behind the opponent is then: circle off my
//     wall, circle the opponent onto its wall. The STEP_IN / STEP_OUT bit for a circling sense follows the camera
//     normal exactly as core/sim/fighter.ts startSidestep picks it.
// Integer math through fx3d / ring.ts, like the sim.

import type { Match } from '../sim/state.ts';
import { createMatch, load, save, step } from '../sim/match.ts';
import { F, P, PH, PROJ_CAP, ST, fighterBase, projBase } from '../sim/layout.ts';
import { divRound, isqrt, normQ } from '../sim/fx3d.ts';
import { ringClamp, ringRay } from '../sim/ring.ts';
import { HIDDEN_FIELDS } from './sense.ts';
import type { Seen } from './sense.ts';
import { B } from './pad.ts';

/** my states that mean the opponent's attack touched me (hit, block, throw) */
function touchedSt(st: number): boolean {
  return st === ST.HITSTUN || st === ST.BLOCKSTUN || st === ST.JUGGLE || st === ST.KNOCKDOWN || st === ST.THROWN
    || st === ST.CRUMPLE || st === ST.WALL_SPLAT || st === ST.DIZZY;
}

export class StepOracle {
  private sb: Match | null = null;
  private of: Match | null = null;
  private snap: Int32Array | null = null;
  /** sandbox runs so far (cost report) */
  runs = 0;

  /** creates the sandbox for `m` now (Cpu.prepare / bind: ~0.3 ms, so the first decision of a bout pays nothing) */
  warm(m: Match): void {
    this.sandbox(m);
  }

  private sandbox(m: Match): Match {
    if (this.sb && this.of === m) return this.sb;
    this.sb = createMatch(m.cfg, m.data);
    this.of = m;
    this.snap = new Int32Array(m.s.length);
    return this.sb;
  }

  /**
   * Plays the visible situation forward: I (`i`) feed `word(k)` on sandbox frame k (k = 0 = the frame the real match
   * plays next), the opponent feeds nothing. `inst` = the opponent move instance to watch (-1: any contact / projectile).
   * Returns the frame (0-based from now) on which the opponent touched me (hit / block / throw / HP lost), or -1 if it
   * did not within `frames` (the threat is over: its move ended and none of its projectiles is left).
   */
  touched(m: Match, i: number, word: (k: number) => number, frames: number, inst: number): number {
    const sb = this.sandbox(m);
    const snap = this.snap!;
    save(m, snap);
    load(sb, snap);
    const s = sb.s;
    const mb = fighterBase(i);
    const ob = fighterBase(1 - i);
    for (const f of HIDDEN_FIELDS) s[ob + f] = 0;
    this.runs++;
    const hp0 = s[mb + F.hp];
    for (let k = 0; k < frames; k++) {
      const w = word(k);
      if (i === 0) step(sb, w, 0);
      else step(sb, 0, w);
      if (s[2] !== PH.FIGHT) return s[mb + F.hp] < hp0 ? k : -1;
      if (touchedSt(s[mb + F.st]) || s[mb + F.hp] < hp0) return k;
      if (inst >= 0 && s[ob + F.mvInst] === inst && s[ob + F.contact] !== 0) return k;
      // over: the watched move is gone and the opponent has no projectile left
      const moveGone = inst < 0 || s[ob + F.mvInst] !== inst || s[ob + F.st] !== ST.ATTACK;
      if (moveGone && k > 2) {
        let live = false;
        for (let q = 0; q < PROJ_CAP; q++) {
          const pb = projBase(q);
          if (s[pb + P.act] !== 0 && s[pb + P.owner] === 1 - i) {
            live = true;
            break;
          }
        }
        if (!live) return -1;
      }
    }
    return -1;
  }
}

// ------------------------------------------------------------------ circle geometry
const T2 = [0, 0];
const C2 = [0, 0];

/** the STEP bit that circles me around the opponent in sense `sd` (+1 = the sim's stepDir +1: offset rotated ccw) */
export function stepBitFor(s: Seen, sd: number): number {
  const ox = s.me.wx - s.op.wx;
  const oz = s.me.wz - s.op.wz;
  let side = -oz * s.camNX + ox * s.camNZ; // tangent of stepDir +1 = (-oz, ox) against camN (fighter.ts startSidestep)
  if (side === 0) side = 1;
  const plusIsIn = side < 0;
  return (sd > 0) === plusIsIn ? B.STEP_IN : B.STEP_OUT;
}

export interface CircleTrace {
  /** my root -> wall behind me (along op -> me) after k frames of circling, k = 0..frames */
  myBack: number[];
  /** the opponent's root -> wall behind it (along me -> op) */
  opBack: number[];
}

/**
 * Where circling in sense `sd` for `frames` frames takes me (the sim's arcMove: tangent step renormalised to the start
 * radius, the step curve for the first stepFrames frames then the sidewalk speed; my body clamped inside the ring),
 * with the opponent standing still. Returns the wall distances per frame.
 */
export function traceCircle(m: Match, s: Seen, sd: number, frames: number): CircleTrace {
  const px = s.op.wx;
  const pz = s.op.wz;
  let x = s.me.wx;
  let z = s.me.wz;
  const cf = s.me.cf;
  const rad = (cf.pushFS + cf.pushBS) >> 1;
  const sys = m.sys;
  // CHANGED(fix_balance) (CONTRACT §35.20 item 1 request): the sim steps each fighter by its OWN arc (CFighter.stepCurve,
  // 0.85-1.72 m from the measured body); the system curve is only the 0.85 m default (fixture kits without `step`)
  const curve = cf.stepCurve && cf.stepCurve.length > sys.stepFrames ? cf.stepCurve : sys.stepCurve;
  const r0 = isqrt((x - px) * (x - px) + (z - pz) * (z - pz));
  const myBack: number[] = [];
  const opBack: number[] = [];
  const meas = (): void => {
    const l = normQ(x - px, z - pz, T2);
    if (l === 0) {
      myBack.push(0);
      opBack.push(0);
      return;
    }
    myBack.push(ringRay(m.ring, x, z, T2[0], T2[1]));
    opBack.push(ringRay(m.ring, px, pz, -T2[0], -T2[1]));
  };
  meas();
  for (let k = 1; k <= frames; k++) {
    const amount = k <= sys.stepFrames ? curve[k] - curve[k - 1] : sys.sidewalk;
    const ox = x - px;
    const oz = z - pz;
    const r = Math.max(1000, isqrt(ox * ox + oz * oz));
    const nx = ox + divRound(-oz * sd * amount, r);
    const nz = oz + divRound(ox * sd * amount, r);
    const l = Math.max(1, isqrt(nx * nx + nz * nz));
    x = px + divRound(nx * Math.max(r0, 1000), l);
    z = pz + divRound(nz * Math.max(r0, 1000), l);
    ringClamp(m.ring, x, z, rad, C2);
    x = C2[0];
    z = C2[1];
    meas();
  }
  return { myBack, opBack };
}

export interface CirclePlan {
  bit: number;
  sd: number;
  frames: number;
  /** the wall distance reached (U): mine for 'escape', the opponent's for 'corner' */
  reach: number;
}

/**
 * A circle-walk for `goal`: 'escape' = get the wall behind me to >= `want` (U) soonest (else the sense that gains most,
 * if it gains >= 0.5 m); 'corner' = bring the wall behind the opponent to <= `want` soonest. null = no worthwhile
 * circle within `maxF` frames.
 */
export function planCircle(m: Match, s: Seen, goal: 'escape' | 'corner', want: number, maxF: number): CirclePlan | null {
  let full: CirclePlan | null = null;
  let part: CirclePlan | null = null;
  for (const sd of [1, -1]) {
    const tr = traceCircle(m, s, sd, maxF);
    const arr = goal === 'escape' ? tr.myBack : tr.opBack;
    let k = -1;
    for (let f = 1; f <= maxF; f++) {
      if (goal === 'escape' ? arr[f] >= want : arr[f] <= want) {
        k = f;
        break;
      }
    }
    if (k > 0) {
      if (!full || k < full.frames) full = { bit: stepBitFor(s, sd), sd, frames: k, reach: arr[k] };
    } else if (goal === 'escape') {
      // no full escape: the sense that gains most, if it gains >= 0.5 m
      let fb = 1;
      for (let f = 2; f <= maxF; f++) if (arr[f] > arr[fb]) fb = f;
      if (arr[fb] - arr[0] >= 50000 && (!part || arr[fb] > part.reach)) part = { bit: stepBitFor(s, sd), sd, frames: fb, reach: arr[fb] };
    }
  }
  return full ?? part;
}

/**
 * The step sense a sidestep should take for safety: the one whose 15-frame arc leaves more room behind me (a step
 * toward the wall gets clamped and keeps my back on it). Returns [bit to try first, the other bit].
 */
export function stepOrder(m: Match, s: Seen): [number, number] {
  const f = m.sys.stepFrames;
  const a = traceCircle(m, s, 1, f).myBack[f];
  const b = traceCircle(m, s, -1, f).myBack[f];
  const first = a >= b ? 1 : -1;
  return [stepBitFor(s, first), stepBitFor(s, -first)];
}
