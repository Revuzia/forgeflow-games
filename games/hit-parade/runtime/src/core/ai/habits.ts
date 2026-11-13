// HIT PARADE - the CPU's memory of the opponent's HABITS (lane AI P2, CONTRACT §11 "no input reading ever", §23.10).
// THREE-free, DOM-free, clock-free, deterministic (no RNG here).
//
// Why: at the low levels' reaction delays (28-60 f, cpu.json L0-L5) almost no ground attack is reactable, so a CPU
// that only blocked on reaction would never block, and one that holds a flat guard chance blocks at random. A human at
// that level blocks by GUESSING from what the opponent has been doing: "he keeps pressing when I walk in", "he goes
// low a lot", "he throws me every time he gets close". This module keeps exactly those counts, built from what was
// ON SCREEN (the opponent's visible move starts, its jumps, what it did when it got close, what it did on my
// wake-up), and the planner turns them into guard / crouch / tech / throw-escape probabilities (plans.ts, brain.ts).
//
// Honesty by construction: every observation is committed only `delay` frames after it happened (the profile's
// reaction delay), so a habit can never carry information about the attack that is on screen right now - it is
// pattern knowledge about the NEXT one. Nothing here reads input words, history or buffers (sense.ts only).

/** What the opponent did when it started an offensive action near me (the mixup it chose). */
export const HK = { LOW: 0, OVERHEAD: 1, MID: 2, THROW: 3, JUMP: 4, PROJ: 5 } as const;
const NK = 6;

/** Decay per observation (each new close action weighs 1, older ones fade: ~10 actions of memory). */
const DECAY = 0.9;
/** Prior counts (what a CPU assumes before it has seen anything: mids most, some lows, few overheads / throws). */
const PRIOR = [0.6, 0.25, 1.0, 0.35, 0.3, 0.3];

interface Pending {
  at: number; // frame the observation becomes known
  // 0 action (k = HK), 1 in-range sample (v = 0/1), 2 wake sample, 3 after-block sample, 4 strike height,
  // CHANGED(AI3D): 5 neutral action near me (v = 1 a step / circle-walk, 0 an attack / dash / jump),
  // 6 its ground strike's 3D class (k = 0 straight, 1 linear, 2 homing),
  // CHANGED(wf6_fixer_core): 7 the outcome of MY plain throw that caught it (v = 1 teched, 0 landed)
  kind: number;
  k: number;
  v: number;
}

export class Habits {
  /** frames an observation waits before it is committed (the owner's reaction delay) */
  delay: number;
  /** decayed counts per HK kind of the opponent's close-range offense */
  readonly counts = new Float64Array(NK);
  /** decayed number of close actions seen (for confidence) */
  seen = 0;
  /**
   * EMA of "the opponent, free inside its attack range, started an attack within the next `win` frames" (samples
   * taken every `win` frames while it stays in range); 0.5 = unknown
   */
  attackRate = 0.5;
  /** EMA of "it attacked (meaty) within 20 f of my wake-up"; 0.5 unknown */
  wakeRate = 0.5;
  /** EMA of "it attacked again within 14 f after my blockstun ended" (frame traps / pressure); 0.5 unknown */
  pressureRate = 0.5;
  /** EMA share of its close ground strikes that are HIGH (every box above the crouch line: a duck / weave beats it) */
  highRate = 0.4;
  /**
   * CHANGED(AI3D) (§35.9): EMA share of its neutral actions near me that were a SIDESTEP / SIDEWALK start (vs an attack,
   * dash or jump start) - "he steps a lot": answer with homing moves (cpu.antiStep). 0.1 = the prior.
   */
  stepRate = 0.1;
  /** CHANGED(AI3D): EMA share of its ground strikes near me that were LINEAR (a read sidestep beats them) / HOMING */
  linearRate = 0.2;
  homingRate = 0.25;
  /**
   * CHANGED(wf6_fixer_core) V3: EMA of "MY plain throw caught it and it TECHED" (1) vs "my throw landed" (0) - the outcome of
   * my own techable throws on screen (whiffs and untechable command grabs are not samples). "He techs every throw" -> stop
   * feeding it throws (plans.ts close plan, brain.throwTrust). 0.3 = the prior.
   */
  techRate = 0.3;
  private q: Pending[] = [];
  private win: number;
  private sampleOpen = -1; // frame the current in-range sample started (-1 none)
  private sampleHit = false;
  private wakeOpen = -1;
  private wakeHit = false;
  private blkOpen = -1;
  private blkHit = false;

  constructor(delay: number, win = 16) {
    this.delay = Math.max(1, delay | 0);
    this.win = Math.max(4, win | 0);
    for (let k = 0; k < NK; k++) this.counts[k] = PRIOR[k];
  }

  // ------------------------------------------------------------------ observations (called by the brain)
  /** the opponent started an offensive action of kind `k` near me on frame `f` */
  action(f: number, k: number): void {
    this.q.push({ at: f + this.delay, kind: 0, k, v: 1 });
  }

  /** one of its close ground strikes: was it a HIGH one (whiffs over a ducking body)? */
  strikeHeight(f: number, high: boolean): void {
    this.q.push({ at: f + this.delay, kind: 4, k: 0, v: high ? 1 : 0 });
  }

  /**
   * one frame of the in-range attack-rate sampler: `inRange` = the opponent is free on the ground inside its attack
   * range of me; `started` = it started an attack on this frame
   */
  rangeFrame(f: number, inRange: boolean, started: boolean): void {
    if (this.sampleOpen >= 0) {
      if (started) this.sampleHit = true;
      if (f - this.sampleOpen >= this.win) {
        this.q.push({ at: f + this.delay, kind: 1, k: 0, v: this.sampleHit ? 1 : 0 });
        this.sampleOpen = -1;
      }
    }
    if (this.sampleOpen < 0 && inRange && !started) {
      this.sampleOpen = f;
      this.sampleHit = false;
    }
  }

  /** my wake-up started (`f`); `attacked` frames later calls close it */
  wakeFrame(f: number, iWoke: boolean, opAttack: boolean): void {
    if (iWoke) {
      this.wakeOpen = f;
      this.wakeHit = false;
    }
    if (this.wakeOpen >= 0) {
      if (opAttack) this.wakeHit = true;
      if (f - this.wakeOpen >= 20) {
        this.q.push({ at: f + this.delay, kind: 2, k: 0, v: this.wakeHit ? 1 : 0 });
        this.wakeOpen = -1;
      }
    }
  }

  /** my blockstun ended on `f` (`ended`), the opponent started an attack on this frame (`opAttack`) */
  blockFrame(f: number, ended: boolean, opAttack: boolean): void {
    if (ended) {
      this.blkOpen = f;
      this.blkHit = false;
    }
    if (this.blkOpen >= 0) {
      if (opAttack) this.blkHit = true;
      if (f - this.blkOpen >= 14) {
        this.q.push({ at: f + this.delay, kind: 3, k: 0, v: this.blkHit ? 1 : 0 });
        this.blkOpen = -1;
      }
    }
  }

  /** CHANGED(AI3D): a neutral action of the opponent near me: `step` = it started a SIDESTEP / SIDEWALK (else an attack...) */
  neutralAction(f: number, step: boolean): void {
    this.q.push({ at: f + this.delay, kind: 5, k: 0, v: step ? 1 : 0 });
  }

  /** CHANGED(AI3D): the 3D class of one of its ground strikes near me (0 straight, 1 linear, 2 homing) */
  strikeClass(f: number, k: number): void {
    this.q.push({ at: f + this.delay, kind: 6, k, v: 1 });
  }

  /** CHANGED(wf6_fixer_core) V3: one of MY plain throws caught it: `teched` = it broke the throw (else the throw landed) */
  throwOutcome(f: number, teched: boolean): void {
    this.q.push({ at: f + this.delay, kind: 7, k: 0, v: teched ? 1 : 0 });
  }

  /** commits every observation whose delay has passed (call once per frame, before reading) */
  tick(f: number): void {
    let n = 0;
    for (const p of this.q) {
      if (p.at > f) break;
      n++;
      if (p.kind === 0) {
        for (let k = 0; k < NK; k++) this.counts[k] *= DECAY;
        this.counts[p.k] += 1;
        this.seen = this.seen * DECAY + 1;
      } else if (p.kind === 1) this.attackRate += (p.v - this.attackRate) * 0.15;
      else if (p.kind === 2) this.wakeRate += (p.v - this.wakeRate) * 0.3;
      else if (p.kind === 3) this.pressureRate += (p.v - this.pressureRate) * 0.25;
      else if (p.kind === 4) this.highRate += (p.v - this.highRate) * 0.15;
      else if (p.kind === 5) this.stepRate += (p.v - this.stepRate) * 0.2; // CHANGED(AI3D)
      else if (p.kind === 7) this.techRate += (p.v - this.techRate) * 0.25; // CHANGED(wf6_fixer_core) V3
      else {
        this.linearRate += ((p.k === 1 ? 1 : 0) - this.linearRate) * 0.15;
        this.homingRate += ((p.k === 2 ? 1 : 0) - this.homingRate) * 0.15;
      }
    }
    if (n > 0) this.q.splice(0, n);
  }

  /** a new round: the pending samplers restart (the learned habits persist - a player remembers) */
  resetRound(): void {
    this.sampleOpen = -1;
    this.wakeOpen = -1;
    this.blkOpen = -1;
    this.q.length = 0;
  }

  // ------------------------------------------------------------------ reads
  private share(k: number, of: readonly number[]): number {
    let t = 0;
    for (const j of of) t += this.counts[j];
    return t > 0 ? this.counts[k] / t : 0;
  }
  /** share of lows among its close strikes (low / overhead / mid) */
  pLow(): number {
    return this.share(HK.LOW, [HK.LOW, HK.OVERHEAD, HK.MID]);
  }
  pOverhead(): number {
    return this.share(HK.OVERHEAD, [HK.LOW, HK.OVERHEAD, HK.MID]);
  }
  /** share of throws among its close offense (strikes + throws) */
  pThrow(): number {
    return this.share(HK.THROW, [HK.LOW, HK.OVERHEAD, HK.MID, HK.THROW]);
  }
  pJump(): number {
    return this.share(HK.JUMP, [HK.LOW, HK.OVERHEAD, HK.MID, HK.THROW, HK.JUMP]);
  }
  /** confidence 0..1 in the counts (how much close offense it has shown, decayed) */
  confidence(): number {
    return Math.min(1, this.seen / 6);
  }
}
