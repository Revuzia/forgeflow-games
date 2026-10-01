/**
 * royale/aimassist.js — touch aim assist for Last Circle (PLAN L10; DYEFIELD CONTRACT_MOBILE M3 port).
 *
 * A PURE function: no THREE, no DOM, no module state, nothing allocated per call except the result object. It is
 * called once per frame in TOUCH mode only (the C6 consumer in player.js, or touch.js's own fallback bridge); mouse
 * and keyboard play never calls it.
 *
 *   * Slowdown ("friction"): while the reticle is within SLOW_DEG (6 deg) of a visible foe in range, the look gain is
 *     multiplied by (1 - SLOW_GAIN x strength) = (1 - 0.45 x strength).
 *   * Magnetism ("rotational pull"): while FIRING and (moving OR looking), turn toward the best foe inside PULL_DEG
 *     (8 deg) at no more than PULL_YAW_DEG_S (22 deg/s) x strength in yaw and half that in pitch. One frame's step is
 *     clamped to the remaining error, so it never passes the target (no snap, no overshoot), and dt is capped at
 *     0.1 s so a long frame cannot turn into a jump.
 *   * Never through walls: a foe counts only when it is visible. Visibility comes from the foe's own `visible`
 *     boolean when the caller already knows it, otherwise from the `canSee(foe, index)` callback, which is called
 *     LAZILY (only for a foe already inside the 8 deg cone and inside `range`, so the caller's line-of-sight test runs
 *     for at most a handful of foes). With neither, a foe is treated as NOT visible.
 *   * Does nothing unless firing (PLAN L10 gate). DYEFIELD's M3 also applies the slowdown while not firing; that is
 *     available as `slowWhenIdle: true`, off by default here.
 *
 * Angles use Last Circle's convention (weapons.js aimDir): forward = (-sin yaw * cos pitch, sin pitch,
 * -cos yaw * cos pitch); + pitch looks up; the yaw that faces a point (dx, dz) away is atan2(-dx, -dz). A finger or
 * mouse moving RIGHT lowers yaw. `eye` is the point the reticle ray starts from (the camera), so the angular offsets
 * are the reticle's on-screen offsets.
 *
 * Industry reference: mobile shooters pair a slowdown with a light rotational pull on touch only; a hard
 * snap-to-target reads as the game aiming for you.
 */

/** the angle convention this function speaks (see above): yaw 0 faces -Z, forward = (-sin yaw, ., -cos yaw).
 *  A caller can check it instead of probing (a probe must fire: nothing happens unless firing). */
export const CONVENTION = "lc";
export const SLOW_DEG = 6;
export const SLOW_GAIN = 0.45;
export const PULL_DEG = 8;
export const PULL_YAW_DEG_S = 22;
export const MAX_DT = 0.1;

const DEG = Math.PI / 180;
const COS_SLOW = Math.cos(SLOW_DEG * DEG);
const COS_PULL = Math.cos(PULL_DEG * DEG);

/** wrap to (-pi, pi] */
function wrap(a) {
  const TAU = Math.PI * 2;
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

const fin = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * @param {{
 *   camYaw: number, camPitch: number,
 *   eye: {x:number, y:number, z:number},
 *   foes: ReadonlyArray<{x:number, y:number, z:number, visible?: boolean}>,   // chest points
 *   canSee?: (foe: object, index: number) => boolean,                          // used when foe.visible is not a boolean
 *   range: number,          // metres from eye
 *   firing: boolean,
 *   moving: boolean,        // the stick is deflected OR a look drag moved the camera this frame
 *   dt: number,             // seconds
 *   strength: number,       // 0..1 (0 = off)
 *   slowWhenIdle?: boolean, // DYEFIELD M3 behaviour: slowdown also while not firing (default false)
 * }} i
 * @returns {{ slow: number, dyaw: number, dpitch: number, target: number }}
 *   slow   look-gain multiplier this frame (1 = none)
 *   dyaw / dpitch  radians to ADD to the camera yaw / pitch this frame (the pull; 0 when not pulling)
 *   target index into `foes` of the foe being pulled toward, or -1
 */
export function aimAssist(i) {
  const out = { slow: 1, dyaw: 0, dpitch: 0, target: -1 };
  if (!i || typeof i !== "object") return out;
  const k = fin(i.strength) ? Math.min(1, Math.max(0, i.strength)) : 0;
  const firing = i.firing === true;
  if (!(k > 0) || !(fin(i.range) && i.range > 0) || !i.foes || !i.foes.length) return out;
  if (!firing && i.slowWhenIdle !== true) return out;                 // does nothing unless firing
  if (!fin(i.camYaw) || !fin(i.camPitch) || !i.eye || !fin(i.eye.x) || !fin(i.eye.y) || !fin(i.eye.z)) return out;
  const cp = Math.cos(i.camPitch);
  const fx = -Math.sin(i.camYaw) * cp, fy = Math.sin(i.camPitch), fz = -Math.cos(i.camYaw) * cp;
  const r2 = i.range * i.range;
  const canSee = typeof i.canSee === "function" ? i.canSee : null;
  let inSlow = false;
  let best = -1, bestCos = COS_PULL;
  for (let n = 0; n < i.foes.length; n++) {
    const f = i.foes[n];
    if (!f || !fin(f.x) || !fin(f.y) || !fin(f.z)) continue;
    const dx = f.x - i.eye.x, dy = f.y - i.eye.y, dz = f.z - i.eye.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (!(d2 > 1e-6) || d2 > r2) continue;                            // never beyond range
    const c = (dx * fx + dy * fy + dz * fz) / Math.sqrt(d2);
    if (c < COS_PULL) continue;                                       // outside both cones: no visibility test
    let vis;
    if (typeof f.visible === "boolean") vis = f.visible;
    else if (canSee) { try { vis = canSee(f, n) === true; } catch (e) { vis = false; } }
    else vis = false;                                                 // unknown = not visible (never through walls)
    if (!vis) continue;
    if (c >= COS_SLOW) inSlow = true;
    if (c >= bestCos) { bestCos = c; best = n; }
  }
  if (inSlow) out.slow = 1 - SLOW_GAIN * k;
  if (best >= 0 && firing && i.moving === true && fin(i.dt) && i.dt > 0) {
    const f = i.foes[best];
    const dx = f.x - i.eye.x, dy = f.y - i.eye.y, dz = f.z - i.eye.z;
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
    const eyaw = wrap(wantYaw - i.camYaw);
    const epitch = wantPitch - i.camPitch;
    const maxYaw = PULL_YAW_DEG_S * DEG * k * Math.min(i.dt, MAX_DT);
    const maxPitch = maxYaw * 0.5;
    out.dyaw = Math.max(-maxYaw, Math.min(maxYaw, eyaw));
    out.dpitch = Math.max(-maxPitch, Math.min(maxPitch, epitch));
    out.target = best;
  }
  return out;
}
