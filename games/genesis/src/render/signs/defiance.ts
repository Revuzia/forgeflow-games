// GENESIS — ARC §3.4 / §6.9: the hurl arcs. People in the hurl pose (MoverBlock.heart == HeartSign.hurl, drawn by
// crowds.ts as HEART_ANIM.hurl) throw pebbles or short spears at the sky: up 15-25 m on a ballistic arc from the hand
// and falling back short, about once per swing of the pose. Render-only (no sim state), at most 64 in flight per view,
// thrown into the FX debris pool (one instanced mesh already drawn: no new pass, no new program), near the camera only.

import { Vector3 } from 'three';
import { hashFloat } from '../../sim/core/rng.ts';

/** what a toss needs: the debris pool's `toss` and its gravity */
export interface TossPool {
  toss(p: Vector3, v: Vector3, sz: number, t: number, spin: number): void;
  readonly gU: { value: number };
}

export const HURL_MAX_IN_FLIGHT = 64;
/** the hurl pose's swing (bodymat.ts animFreq 42 = 0.45 Hz) */
export const HURL_PERIOD_S = 1 / 0.45;
/** throws are drawn only this near the camera (m): a pebble is a pixel beyond */
export const HURL_NEAR_M = 260;

/** the throw of person `id`'s n-th swing: apex height (m) and the horizontal drift (m/s, east / north in the tangent) */
export function hurlThrow(id: number, n: number, g: number): { up: number; e: number; nn: number; size: number; spear: boolean } {
  const apex = 15 + 10 * hashFloat(id, n, 0x4e51);
  const up = Math.sqrt(2 * Math.max(0.1, g) * apex);
  // falling back short: a little drift, 1-4 m/s, a stable aim per person with some scatter per throw
  const aim = hashFloat(id, 0x4e52) * Math.PI * 2 + (hashFloat(id, n, 0x4e53) - 0.5) * 0.8;
  const h = 1 + 3 * hashFloat(id, n, 0x4e54);
  const spear = hashFloat(id, 0x4e42) < 0.3;
  return { up, e: Math.cos(aim) * h, nn: Math.sin(aim) * h, size: spear ? 0.16 : 0.07 + 0.05 * hashFloat(id, n, 0x4e55), spear };
}

/** flight time (s) of a throw rising at `up` m/s that lands 1.5 m under the hand */
export function hurlFlight(up: number, g: number): number { return (up + Math.sqrt(up * up + 3 * g)) / g; }

const _p = new Vector3(), _v = new Vector3(), _u = new Vector3(), _e = new Vector3(), _n = new Vector3();

export class DefianceArcs {
  /** for probes: throws in flight and thrown in total */
  readonly stats = { inFlight: 0, thrown: 0 };
  /** landing FX times of throws in flight */
  private landing: number[] = [];
  /** the swing each person last threw on */
  private swing = new Map<number, number>();

  /**
   * one frame: `hurlers` is crowds.hurlers (id, body-frame feet x y z, height; stride 5), `cam` the camera (body m),
   * `t` the FX clock (s, with the sim: a paused world stops throwing)
   */
  update(hurlers: ArrayLike<number>, cam: Vector3, t: number, pool: TossPool): void {
    this.landing = this.landing.filter((x) => x > t);
    const g = pool.gU.value;
    const seen = new Set<number>();
    for (let k = 0; k + 4 < hurlers.length; k += 5) {
      const id = hurlers[k];
      seen.add(id);
      _p.set(hurlers[k + 1], hurlers[k + 2], hurlers[k + 3]);
      if (_p.distanceTo(cam) > HURL_NEAR_M) continue;
      // one throw per swing, at the release (the swing's phase is hashed per person, like the pose's)
      const ph = hashFloat(id, 0x4e56);
      const n = Math.floor(t / HURL_PERIOD_S + ph);
      const last = this.swing.get(id);
      if (last === undefined) { this.swing.set(id, n); continue; }
      if (n <= last) continue;
      this.swing.set(id, n);
      if (this.landing.length >= HURL_MAX_IN_FLIGHT) continue;
      const th = hurlThrow(id, n, g);
      const up = _u.copy(_p).normalize();
      _e.set(0, 1, 0).cross(up);
      if (_e.lengthSq() < 1e-6) _e.set(1, 0, 0).cross(up);
      _e.normalize();
      _n.crossVectors(up, _e);
      const h = hurlers[k + 4];
      _p.addScaledVector(up, h * 1.08);
      _v.copy(up).multiplyScalar(th.up).addScaledVector(_e, th.e).addScaledVector(_n, th.nn);
      // (the shader's clock is the FX clock modulo an hour: godfx.ts uFxTime)
      pool.toss(_p, _v, th.size, t % 3600, hashFloat(id, n, 0x4e57));
      this.landing.push(t + hurlFlight(th.up, g) + 1.6);
      this.stats.thrown++;
    }
    for (const id of this.swing.keys()) if (!seen.has(id)) this.swing.delete(id);
    this.stats.inFlight = this.landing.length;
  }
}
