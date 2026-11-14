// HIT PARADE — sim events (CONTRACT §4.5, §17 rule 6, §18.1, §19.8).
// A 64-entry ring written during `step`. The ring MEMORY lives on the Match (outside the state
// array); only the write cursor W.evSeq lives in the state, so a rollback rewinds the cursor and the
// re-simulated frames re-emit. Consumers dedupe by (frame, type, a, b).

import type { SimEvent } from '../types.ts';

export type { SimEvent };

export const EV = {
  ROUND_INTRO: 1,
  FIGHT: 2,
  HIT: 3,
  BLOCK: 4,
  PARRY: 5,
  PERFECT_PARRY: 6,
  THROW: 7,
  THROW_TECH: 8,
  WHIFF: 9,
  COUNTER: 10,
  PUNISH: 11,
  KNOCKDOWN: 12,
  WAKEUP: 13,
  WALL_SPLAT: 14,
  GROUND_BOUNCE: 15,
  CRUMPLE: 16,
  PROJ_SPAWN: 17,
  PROJ_HIT: 18,
  PROJ_CLASH: 19,
  IMPACT_START: 20,
  IMPACT_ARMOR: 21,
  IMPACT_CLASH: 22,
  SHOVE: 23,
  SUPER_FREEZE: 24,
  SUPER_HIT: 25,
  CINEMATIC_START: 26,
  CINEMATIC_END: 27,
  STAGE_FRIGHT_ON: 28,
  STAGE_FRIGHT_OFF: 29,
  KO: 30,
  TIMEOVER: 31,
  ROUND_END: 32,
  MATCH_END: 33,
  METER_BAR: 34,
  TAUNT: 35,
  CAMERA_CUE: 36,
  SFX_CUE: 37,
  GOON_SPAWN: 38,
  GOON_DOWN: 39,
  HECKLE_THROW: 40,
  SCORE: 41,
} as const;

/**
 * CHANGED(SIM) P2 (CONTRACT §28.3): event types added with the uniques. Kept OUT of `EV` on purpose: consumers switch
 * exhaustively over `keyof typeof EV` (audio/router.ts), so growing EV would break their build; they opt in via EVX.
 */
export const EVX = {
  CATCH: 42,
  TELEPORT: 43,
  PHASE: 44,
  BALL: 45,
  INSTALL: 46,
} as const;

/**
 * CHANGED(fix_core) (CONTRACT §35.20): 3D-ring event types. A third opt-in group on purpose: audio/router.ts types its
 * tables over `keyof typeof EV` and `keyof typeof EVX` (and probe_audio checks both are covered), so a new type there would
 * break other lanes' builds; consumers opt in by importing EV3D.
 * BACK_HIT (D7): emitted right after the HIT of a back hit (the attacker stood in the grounded defender's rear arc,
 *   > system.json backHit.arcDeg off its facing; for a projectile: it travelled into the defender's back) - same payload as
 *   HIT: a = attacker, b = victim, c = strength class (§17 rule 6), d = hit height (cm). The hit already carries the
 *   bonus (damage x backHit.damagePct %, +backHit.hitstunF hitstun) and the victim faces the attacker from that frame.
 */
export const EV3D = {
  BACK_HIT: 47,
} as const;

/** CHANGED(SIM) P2: SCORE `d` reason codes (CONTRACT §28.4). */
export const SCORE_WHY = {
  HIT: 1, KO: 2, COMBO: 3, CROWD: 4, PARRY: 5, PERFECT: 6, HECKLE_PARRY: 7, HECKLE_PERFECT: 8, HECKLE_HIT: 9,
} as const;

/** CHANGED(SIM) P2: BALL `b` codes. */
export const BALL_EV = { KICK: 0, REBOUND: 1, REST: 2, PICKUP: 3, KNOCKED: 4, RESPAWN: 5, HOVER: 6, LOOSE: 7 } as const;

/** Name of an event type (debug / harness). */
export const EV_NAMES: Record<number, string> = {};
for (const k of Object.keys(EV) as (keyof typeof EV)[]) EV_NAMES[EV[k]] = k;
for (const k of Object.keys(EVX) as (keyof typeof EVX)[]) EV_NAMES[EVX[k]] = k;
for (const k of Object.keys(EV3D) as (keyof typeof EV3D)[]) EV_NAMES[EV3D[k]] = k; // CHANGED(fix_core)

/** CAMERA_CUE `b` values. */
export const CUE = { SUPER_FREEZE: 1, PERFECT_PARRY: 2, KO: 3, CINEMATIC: 4, WALL_SPLAT: 5, PHASE: 6 } as const;

/** Strength classes carried in `c` of HIT/BLOCK/... (§17 rule 6). */
export const SC = { L: 0, M: 1, H: 2, SPECIAL: 3, SUPER: 4, IMPACT: 5, PROJECTILE: 6, THROW: 7 } as const;

export const EVENT_CAP = 64;
const STRIDE = 7; // seq, frame, type, a, b, c, d

export class EventRing {
  readonly data: Int32Array = new Int32Array(EVENT_CAP * STRIDE);
  private readonly s: Int32Array;
  private readonly cur: number;

  /** `s` = the match state, `cursorOffset` = W.evSeq. */
  constructor(s: Int32Array, cursorOffset: number) {
    this.s = s;
    this.cur = cursorOffset;
    this.data.fill(-1);
  }

  push(frame: number, type: number, a: number, b: number, c: number, d: number): void {
    const seq = this.s[this.cur];
    const o = (seq & (EVENT_CAP - 1)) * STRIDE;
    const dt = this.data;
    dt[o] = seq;
    dt[o + 1] = frame;
    dt[o + 2] = type;
    dt[o + 3] = a;
    dt[o + 4] = b;
    dt[o + 5] = c;
    dt[o + 6] = d;
    this.s[this.cur] = (seq + 1) | 0;
  }

  /** Total events emitted on the current timeline (== W.evSeq). */
  get count(): number {
    return this.s[this.cur];
  }

  /** The most recent `n` events (oldest first). */
  last(n: number = EVENT_CAP): SimEvent[] {
    const out: SimEvent[] = [];
    const cur = this.s[this.cur];
    const from = Math.max(0, cur - Math.min(n, EVENT_CAP));
    for (let seq = from; seq < cur; seq++) {
      const o = (seq & (EVENT_CAP - 1)) * STRIDE;
      if (this.data[o] !== seq) continue;
      out.push(read(this.data, o));
    }
    return out;
  }
}

function read(d: Int32Array, o: number): SimEvent {
  return { frame: d[o + 1], type: d[o + 2], a: d[o + 3], b: d[o + 4], c: d[o + 5], d: d[o + 6] };
}

/**
 * §18.1: append every event still in the ring with `ev.frame >= frame`, oldest first; returns how
 * many were appended. Entries written by an abandoned (rolled-back) timeline beyond the restored
 * cursor are skipped.
 */
export function eventsSince(ring: EventRing, frame: number, out: SimEvent[]): number {
  const cur = ring.count;
  const from = Math.max(0, cur - EVENT_CAP);
  const d = ring.data;
  let n = 0;
  for (let seq = from; seq < cur; seq++) {
    const o = (seq & (EVENT_CAP - 1)) * STRIDE;
    if (d[o] !== seq || d[o + 1] < frame) continue;
    out.push(read(d, o));
    n++;
  }
  return n;
}
