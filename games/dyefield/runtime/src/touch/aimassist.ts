// DYEFIELD — touch aim assist (CONTRACT_MOBILE M3). A pure function: no THREE, no DOM, no allocation per call
// beyond the result object. The Game calls it once per rendered frame in TOUCH mode only (kbm never calls it).
//
//   * Slowdown: while the reticle is within SLOW_DEG (6°) of a visible foe in range, the look gain is multiplied by
//     (1 − 0.45 × strength) — the reticle "sticks" a little as it crosses a target.
//   * Magnetism: only while firing AND (moving OR looking): turn toward the nearest foe inside PULL_DEG (8°) at no more
//     than 22°/s × strength in yaw and half that in pitch. The step never passes the target (no snap, no overshoot).
//   * Never through walls (`visible` false = world.canSee said no) and never beyond `range`.
//
// Industry reference: mobile shooters pair a slowdown ("friction") with a light rotational pull on touch only; a
// hard snap-to-target reads as the game aiming for you.
//
// Angles follow the camera (view/camera.ts): yaw 0 looks toward +Z, forward = (sin yaw·cos pitch, sin pitch,
// cos yaw·cos pitch); + pitch looks up. `eye` is the point the reticle ray starts from (the camera position), so the
// angular offsets are the reticle's on-screen offsets.

export const SLOW_DEG = 6;
export const SLOW_GAIN = 0.45;
export const PULL_DEG = 8;
export const PULL_YAW_DEG_S = 22;

const DEG = Math.PI / 180;
const COS_SLOW = Math.cos(SLOW_DEG * DEG);
const COS_PULL = Math.cos(PULL_DEG * DEG);

export interface AimAssistFoe { x: number; y: number; z: number; visible: boolean }

export interface AimAssistInput {
  camYaw: number;
  camPitch: number;
  eye: { x: number; y: number; z: number };
  /** chest points; visible = world.canSee(human, foe) */
  foes: ReadonlyArray<AimAssistFoe>;
  /** metres from `eye` */
  range: number;
  firing: boolean;
  /** the stick is deflected OR a look drag moved the camera this frame ("moving OR looking" in M3) */
  moving: boolean;
  dt: number;
  /** 0..1 */
  strength: number;
}

export interface AimAssistResult {
  /** look-gain multiplier this frame (1 = no slowdown) */
  slow: number;
  /** radians to ADD to the camera yaw / pitch this frame (the pull) */
  dyaw: number;
  dpitch: number;
}

/** wrap to (−π, π] */
function wrap(a: number): number {
  const TAU = Math.PI * 2;
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

export function aimAssist(i: AimAssistInput): AimAssistResult {
  const out: AimAssistResult = { slow: 1, dyaw: 0, dpitch: 0 };
  const k = Number.isFinite(i.strength) ? Math.min(1, Math.max(0, i.strength)) : 0;
  if (!(k > 0) || !(i.range > 0) || !i.foes.length) return out;
  const cp = Math.cos(i.camPitch);
  const fx = Math.sin(i.camYaw) * cp, fy = Math.sin(i.camPitch), fz = Math.cos(i.camYaw) * cp;
  const r2 = i.range * i.range;
  let inSlow = false;
  let best = -1, bestCos = COS_PULL;
  for (let n = 0; n < i.foes.length; n++) {
    const f = i.foes[n];
    if (!f.visible) continue;
    const dx = f.x - i.eye.x, dy = f.y - i.eye.y, dz = f.z - i.eye.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (!(d2 > 1e-6) || d2 > r2) continue;
    const c = (dx * fx + dy * fy + dz * fz) / Math.sqrt(d2);
    if (c >= COS_SLOW) inSlow = true;
    if (c >= bestCos) { bestCos = c; best = n; }
  }
  if (inSlow) out.slow = 1 - SLOW_GAIN * k;
  if (best >= 0 && i.firing && i.moving && i.dt > 0) {
    const f = i.foes[best];
    const dx = f.x - i.eye.x, dy = f.y - i.eye.y, dz = f.z - i.eye.z;
    const wantYaw = Math.atan2(dx, dz);
    const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
    const eyaw = wrap(wantYaw - i.camYaw);
    const epitch = wantPitch - i.camPitch;
    const maxYaw = PULL_YAW_DEG_S * DEG * k * Math.min(i.dt, 0.1);
    const maxPitch = maxYaw * 0.5;
    out.dyaw = Math.max(-maxYaw, Math.min(maxYaw, eyaw));
    out.dpitch = Math.max(-maxPitch, Math.min(maxPitch, epitch));
  }
  return out;
}
