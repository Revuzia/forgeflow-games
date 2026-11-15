// core/aim_assist.js — controller / touch aim assist (lane PAD, 2026-11).
//
// WHAT THIS IS: an INPUT FILTER on the local player's look, nothing more. It
// reads sim state (positions, alive, team, the world's raycast) strictly
// read-only and returns three numbers per frame — a look-rate multiplier and a
// small yaw/pitch nudge — which input.js folds into input.state.yaw/pitch
// BEFORE buildCmd() snapshots them. The sim never runs any of this, so replays
// and determinism are untouched: the cmd carries angles, exactly as a mouse
// would have produced them.
//
// NEVER ACTIVE FOR THE MOUSE. input.js only calls update() while the last-used
// device is a gamepad or a touch screen.
//
// THE MODEL (all angles radians, all rates frame-rate independent):
//
//   bubble      every hostile, alive, line-of-sight-visible operator gets an
//               angular bubble around its chest: atan(R / d) clamped to
//               [BUBBLE_MIN, BUBBLE_MAX]. A world-size radius means the bubble
//               shrinks with distance like the body does.
//   weight W    1 inside the inner 35% of the bubble, smooth to 0 at its rim,
//               times the RANGE FALLOFF (1 out to the weapon's falloffStart
//               (>= 15 m), linear to 0 at 1.6 x falloffEnd, hard 0 past 140 m).
//   slowdown    look rate x (1 - slow * W). Scales the player's OWN stick
//               input only — it can never move the reticle by itself.
//   rotational  while the player is moving or actively looking, the reticle
//               follows rot * W of the target's BEARING change (world angle
//               eye->target, frame to frame). Bearing is independent of the
//               view, so recoil (which rotates the view) is never "corrected":
//               assist and recoil add, they do not fight.
//   ADS snap    on the frame ADS begins, if a target sits inside the tight
//               snap cone, snap * rangeFalloff of the reticle error is
//               applied linearly over SNAP_TIME seconds. One-shot; cancelled
//               if the target is lost.
//
// No assist through walls (world.raycast to chest AND head, either clear =
// visible), none through smoke (sim.state.smokes / sim.smokes spheres, when a
// smoke system exists — today's sim has none, so this is a forward hook), never
// on a teammate (team equality — FFA gives each operator its own team).

export const PRESETS = {
  off:      null,
  standard: { slow: 0.45, rot: 0.50, snap: 0.60, snapConeDeg: 5.0, bubbleR: 1.10 },
  focused:  { slow: 0.60, rot: 0.70, snap: 0.85, snapConeDeg: 7.0, bubbleR: 1.35 },
};

export const BUBBLE_MIN = 2.0 * Math.PI / 180;
export const BUBBLE_MAX = 12.0 * Math.PI / 180;
export const ADS_SLOW_BOOST = 1.15;   // ADS slowdown is a touch stronger
export const SLOW_CAP = 0.8;          // never slower than 20% of the stick's rate
export const ROT_RATE_CAP = 1.6;      // rad/s — the most rotational assist can turn
export const SNAP_TIME = 0.10;        // s
export const LOS_CACHE_S = 0.1;       // s — re-raycast each target at most 10x/s
export const HARD_RANGE = 140;        // m

const TAU = Math.PI * 2;
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function smoothstep(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }

/** Angular bubble radius for a target `dist` metres away. */
export function bubbleAngle(dist, radius) {
  return clamp(Math.atan2(radius, Math.max(0.1, dist)), BUBBLE_MIN, BUBBLE_MAX);
}

/** 1 near the bubble's centre, smooth to 0 at its rim, 0 outside. */
export function angleWeight(theta, bubble) {
  if (!(bubble > 0) || theta >= bubble) return 0;
  return 1 - smoothstep(0.35 * bubble, bubble, theta);
}

/** Range falloff from the weapon's damage falloff (meters). */
export function rangeFactor(dist, falloffStart, falloffEnd) {
  const full = Math.max(15, falloffStart || 30);
  const zero = Math.min(HARD_RANGE, Math.max(full + 5, 1.6 * (falloffEnd || 60)));
  if (dist <= full) return 1;
  if (dist >= zero) return 0;
  return 1 - (dist - full) / (zero - full);
}

/** Look-rate multiplier for a weight W in [0,1]. */
export function slowdownFactor(W, preset, ads) {
  if (!preset) return 1;
  const s = Math.min(SLOW_CAP, preset.slow * (ads ? ADS_SLOW_BOOST : 1));
  return 1 - s * clamp(W, 0, 1);
}

/** Bearing (world yaw/pitch) from an eye to a point — same convention as
 *  ballistics.js dirFromAngles: yaw 0 looks down -Z. */
export function bearing(eye, pt) {
  const dx = pt[0] - eye[0], dy = pt[1] - eye[1], dz = pt[2] - eye[2];
  const h = Math.hypot(dx, dz);
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, h || 1e-9), dist: Math.hypot(h, dy) };
}

function eyeOf(body) {
  return [body.pos[0], body.pos[1] + (body.stance === "crouch" ? 1.10 : 1.62), body.pos[2]];
}
function chestOf(body) {
  return [body.pos[0], body.pos[1] + (body.stance === "crouch" ? 0.80 : 1.20), body.pos[2]];
}

function segHitsSphere(a, b, c, r) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const L2 = abx * abx + aby * aby + abz * abz || 1e-9;
  const t = clamp((acx * abx + acy * aby + acz * abz) / L2, 0, 1);
  const px = a[0] + abx * t - c[0], py = a[1] + aby * t - c[1], pz = a[2] + abz * t - c[2];
  return px * px + py * py + pz * pz < r * r;
}

/** Clear line from `eye` to `pt`? world.raycast null = clear; smoke spheres block. */
export function lineClear(world, eye, pt, smokes) {
  const dx = pt[0] - eye[0], dy = pt[1] - eye[1], dz = pt[2] - eye[2];
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-3) return true;
  if (smokes) {
    for (let i = 0; i < smokes.length; i++) {
      const s = smokes[i];
      const c = s && (s.pos || s.p);
      const r = s && (s.r || s.radius);
      if (c && r > 0 && segHitsSphere(eye, pt, c, r)) return false;
    }
  }
  if (!world || typeof world.raycast !== "function") return true;
  const hit = world.raycast(eye, [dx / d, dy / d, dz / d], Math.max(0, d - 0.35));
  return !hit;
}

/**
 * Stateful assist (one per local player). update() is called once per
 * rendered frame with the CURRENT view; it returns
 *   { slow, dYaw, dPitch, target, weight }
 * slow  = multiplier for the player's own look input this frame
 * dYaw/dPitch = assist rotation to add this frame (rotational + snap)
 */
export function createAimAssist() {
  let t = 0;
  let cur = null;          // { id, yaw, pitch } last bearing of the tracked target
  let snap = null;         // { yaw, pitch, left, id } remaining snap
  const losCache = new Map(); // id -> { t, ok }
  const out = { slow: 1, dYaw: 0, dPitch: 0, target: null, weight: 0, theta: 0, dist: 0 };

  function visible(world, smokes, eye, b) {
    const id = b.id != null ? b.id : b;
    const c = losCache.get(id);
    // reuse only while young AND neither end has moved more than 0.25 m
    // (a respawn / teleport / sprint behind a wall re-tests immediately)
    if (c && t - c.t < LOS_CACHE_S &&
        Math.abs(c.bx - b.pos[0]) + Math.abs(c.by - b.pos[1]) + Math.abs(c.bz - b.pos[2]) < 0.25 &&
        Math.abs(c.ex - eye[0]) + Math.abs(c.ey - eye[1]) + Math.abs(c.ez - eye[2]) < 0.25) return c.ok;
    const ok = lineClear(world, eye, chestOf(b), smokes) || lineClear(world, eye, eyeOf(b), smokes);
    losCache.set(id, { t, ok, bx: b.pos[0], by: b.pos[1], bz: b.pos[2], ex: eye[0], ey: eye[1], ez: eye[2] });
    return ok;
  }

  function reset() { cur = null; snap = null; losCache.clear(); }

  /**
   * v: { sim, yaw, pitch, ads, adsStart, moving, looking, strength, weapon }
   *   strength: "off" | "standard" | "focused"
   *   weapon:   weapon_data entry (for damage falloff) or null
   */
  function update(dt, v) {
    t += dt;
    out.slow = 1; out.dYaw = 0; out.dPitch = 0; out.target = null; out.weight = 0; out.theta = 0; out.dist = 0;
    const preset = PRESETS[v.strength] || null;
    const sim = v.sim;
    const S = sim && sim.state;
    const P = S && S.player;
    if (!preset || !P || !P.alive || !S.bots) { reset(); return out; }
    const world = sim.world;
    const smokes = (S.smokes && S.smokes.length ? S.smokes : null) || (sim.smokes && sim.smokes.length ? sim.smokes : null);
    const eye = eyeOf(P);
    const dmg = v.weapon && v.weapon.damage;
    const fs = dmg ? dmg.falloffStart : 30, fe = dmg ? dmg.falloffEnd : 60;

    // ---- pick the target: lowest theta/bubble among valid bodies; the current
    // target is kept while it stays within 1.2x its bubble (no flicker between two).
    let best = null, bestScore = Infinity;
    for (let i = 0; i < S.bots.length; i++) {
      const b = S.bots[i];
      if (!b || !b.alive || !b.pos) continue;
      if (P.team != null && b.team != null && b.team === P.team) continue; // never a teammate
      const brg = bearing(eye, chestOf(b));
      if (brg.dist > HARD_RANGE) continue;
      const rf = rangeFactor(brg.dist, fs, fe);
      if (rf <= 0) continue;
      const ey = wrapAngle(brg.yaw - v.yaw), ep = brg.pitch - v.pitch;
      const theta = Math.hypot(ey * Math.cos(v.pitch), ep);
      const bub = bubbleAngle(brg.dist, preset.bubbleR);
      const cone = Math.max(bub, preset.snapConeDeg * Math.PI / 180);
      const isCur = cur && cur.id === b.id;
      const lim = isCur ? cone * 1.2 : cone;
      if (theta > lim) continue;
      if (!visible(world, smokes, eye, b)) continue;
      const score = theta / bub - (isCur ? 0.15 : 0);
      if (score < bestScore) { bestScore = score; best = { b, brg, rf, theta, bub, ey, ep }; }
    }

    // ---- ADS snap: armed on the ADS edge, inside the tight cone only
    if (v.adsStart && best) {
      const coneA = preset.snapConeDeg * Math.PI / 180;
      if (best.theta <= coneA) {
        const k = preset.snap * best.rf;
        snap = { yaw: best.ey * k, pitch: best.ep * k, left: SNAP_TIME, id: best.b.id };
      }
    }
    if (snap) {
      if (!v.ads || !best || best.b.id !== snap.id) snap = null;
      else {
        const step = Math.min(dt, snap.left);
        const f = step / SNAP_TIME;
        out.dYaw += snap.yaw * f; out.dPitch += snap.pitch * f;
        snap.left -= step;
        if (snap.left <= 1e-6) snap = null;
      }
    }

    if (!best) { cur = null; return out; }

    const W = angleWeight(best.theta, best.bub) * best.rf;
    out.weight = W; out.target = best.b.id; out.theta = best.theta; out.dist = best.brg.dist;
    out.slow = slowdownFactor(W, preset, v.ads);

    // ---- rotational: follow the target's bearing CHANGE (not the reticle error)
    if (cur && cur.id === best.b.id && W > 0 && (v.moving || v.looking) && dt > 0) {
      const dyb = wrapAngle(best.brg.yaw - cur.yaw), dpb = best.brg.pitch - cur.pitch;
      if (Math.abs(dyb) < 0.1 && Math.abs(dpb) < 0.1) {        // respawn / teleport guard
        const k = preset.rot * W;
        const cap = ROT_RATE_CAP * dt;
        out.dYaw += clamp(dyb * k, -cap, cap);
        out.dPitch += clamp(dpb * k * 0.5, -cap, cap);           // vertical follows at half strength
      }
    }
    cur = { id: best.b.id, yaw: best.brg.yaw, pitch: best.brg.pitch };
    return out;
  }

  return { update, reset, get last() { return out; } };
}
