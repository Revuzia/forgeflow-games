// VALE render — turn smoothing (CW1 critic:input-feel). The sim turns a unit to its new heading in one tick (src/sim
// movement.ts / attack.ts set `facing` outright), and the actor used to lerp only between the last two ticks, so a
// 180° reversal drew in one 33 ms tick (~5,400°/s): the body flipped. The DRAWN heading now eases toward the
// interpolated sim heading: an ease-out at TURN.k per second with a floor of TURN.minRate, so a reversal reads as a
// quick turn of about 0.1 s and a small correction lands at once. Presentation only: the sim heading (casts, attack
// direction, projectiles) is untouched. `_harness/probe_camera.ts` reports the drawn turn rate.

export const TURN = {
  /** ease-out rate (1/s): the share of the remaining angle closed per second, exponentially */
  k: 30,
  /** the slowest turn (rad/s), so the last degrees land instead of creeping */
  minRate: 4 * Math.PI,
} as const;

/** shortest signed angle from a to b (rad, −π..π) */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** the drawn heading after `dt` seconds of turning from `cur` toward `target` */
export function turnToward(cur: number, target: number, dt: number): number {
  const d = angleDelta(cur, target);
  const ad = Math.abs(d);
  if (ad < 1e-4 || dt <= 0) return dt <= 0 ? cur : target;
  const step = Math.max(TURN.minRate * dt, ad * (1 - Math.exp(-TURN.k * dt)));
  return step >= ad ? target : cur + Math.sign(d) * step;
}
