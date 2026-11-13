import * as THREE from 'three';
import { MISSILE_LOCK } from '../core/config';

export type LockPhase = 'off' | 'seeking' | 'locking' | 'locked';

export interface LockCandidate {
  id: string;
  position: THREE.Vector3;
  alive: boolean;
}

/**
 * Classic heat-seek latch: hold aim on a rival until LOCKED (red UI + beeps),
 * then rockets may fire with homing. No latch → no heat-seek shot.
 */
export class MissileLock {
  phase: LockPhase = 'off';
  /** 0–1 progress toward latch. */
  progress = 0;
  targetId: string | null = null;
  /** World position of current lock subject (for HUD). */
  targetPos = new THREE.Vector3();
  private beepTimer = 0;
  private wasLocked = false;

  get locked() {
    return this.phase === 'locked' && !!this.targetId;
  }

  reset() {
    this.phase = 'off';
    this.progress = 0;
    this.targetId = null;
    this.beepTimer = 0;
    this.wasLocked = false;
  }

  /**
   * Call every frame while rocket (or similar) is selected.
   * @returns 'tick' | 'locked' | 'lost' | null for audio cues
   */
  update(
    dt: number,
    active: boolean,
    aimOrigin: THREE.Vector3,
    aimDir: THREE.Vector3,
    candidates: LockCandidate[],
    hasLos: (from: THREE.Vector3, to: THREE.Vector3) => boolean
  ): 'tick' | 'locked' | 'lost' | null {
    if (!active) {
      const had = this.progress > 0.05 || this.wasLocked;
      this.reset();
      return had ? 'lost' : null;
    }

    const best = this.pickTarget(aimOrigin, aimDir, candidates, hasLos);
    let cue: 'tick' | 'locked' | 'lost' | null = null;

    if (!best) {
      if (this.progress > 0 || this.phase === 'locked') {
        this.progress = Math.max(0, this.progress - dt / MISSILE_LOCK.decaySec);
        if (this.progress <= 0.001) {
          if (this.wasLocked || this.phase !== 'off') cue = 'lost';
          this.phase = 'off';
          this.targetId = null;
          this.wasLocked = false;
          this.progress = 0;
        } else {
          this.phase = 'locking';
        }
      } else {
        this.phase = 'seeking';
        this.targetId = null;
      }
      return cue;
    }

    // Switching target resets latch
    if (this.targetId && this.targetId !== best.id) {
      this.progress = 0;
      this.wasLocked = false;
      cue = 'lost';
    }

    this.targetId = best.id;
    this.targetPos.copy(best.position);

    if (this.progress >= 1) {
      this.phase = 'locked';
      this.progress = 1;
      if (!this.wasLocked) {
        this.wasLocked = true;
        cue = 'locked';
      } else {
        // Steady lock tone cadence
        this.beepTimer -= dt;
        if (this.beepTimer <= 0) {
          this.beepTimer = 0.22;
          cue = 'tick';
        }
      }
      return cue;
    }

    this.phase = 'locking';
    this.progress = Math.min(1, this.progress + dt / MISSILE_LOCK.acquireSec);

    // Beeps speed up as we approach full latch
    this.beepTimer -= dt;
    const interval = 0.55 - this.progress * 0.4;
    if (this.beepTimer <= 0) {
      this.beepTimer = Math.max(0.12, interval);
      cue = 'tick';
    }

    if (this.progress >= 1) {
      this.phase = 'locked';
      this.wasLocked = true;
      cue = 'locked';
    }

    return cue;
  }

  private pickTarget(
    origin: THREE.Vector3,
    dir: THREE.Vector3,
    candidates: LockCandidate[],
    hasLos: (from: THREE.Vector3, to: THREE.Vector3) => boolean
  ): LockCandidate | null {
    let best: LockCandidate | null = null;
    let bestScore = -Infinity;
    const to = new THREE.Vector3();

    for (const c of candidates) {
      if (!c.alive) continue;
      to.copy(c.position).sub(origin);
      const dist = to.length();
      if (dist < 8 || dist > MISSILE_LOCK.maxRange) continue;
      to.multiplyScalar(1 / dist);
      const dot = dir.dot(to);
      if (dot < MISSILE_LOCK.coneDot) continue;
      if (MISSILE_LOCK.requireLos && !hasLos(origin, c.position)) continue;
      const score = dot * 3 - dist * 0.01 + (c.id === this.targetId ? 0.4 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }
}
