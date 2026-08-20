// core/weapons/recoil.js [A4] — view-side pattern kick accumulator.
// Architecture §3.11 (frozen): createRecoil(input) → { kick(weaponId),
// update(dt) }. Recoil is REAL: kick() calls input.addLook — the aim/camera
// climbs and the player fights it. The sim applies only each shot's single
// pattern step to that bullet's direction (ballistics.js fireShot); the
// ACCUMULATED climb lives here, entering the sim through the next cmd's
// yaw/pitch. combat_spec §2.3 verbatim:
//   - per-shot kick = pattern[burstIndex] ([dYaw,dPitch] radians,
//     weapon_data transposition), tail loops per weapon.recoil.loop;
//   - ADS kick = table ×1.0; hip = ×0.85 (recoil.hipMult — hip pays in
//     spread, not kick);
//   - recovery: starting recoverDelayS after the last shot, recenter the
//     accumulated kick at recoverPerS (12°/s; Corvus 14°/s from 60 ms) until
//     100% of the UNCOMPENSATED remainder is returned;
//   - player mouse-pulldown reduces the accumulator FIRST — subtract the
//     player's downward pitch delta from it, never over-return (last-circle
//     accumulator pattern, the "fully-self-recentering recoil" anti-pattern
//     from the benchmark audit is exactly what this avoids).
//
// Camera kicks are UNJITTERED table steps: the ±jitter fraction rides the
// BULLET (sim `weapons` rng stream) so headless probes stay deterministic;
// the camera pattern is the learnable, deterministic part (§2.3 intent).
//
// DEDUP GUARD: A0's boot wiring currently calls kick() for EVERY player
// `shot` event — including `impactOnly:true` resolution replays and
// `pen:'entry'|'exit'` events (A1's swept-projectile convention). Those must
// NOT kick (a Warden hit past ~12 m would double-kick). Until A0 gates the
// wiring on `!d.impactOnly && !d.pen` (requested via needsElsewhere), kick()
// counts sim `shotsFired` deltas through the __FPS__ global: shotsFired
// increments only at real fire time (per player pellet), so a delta of 0
// identifies a replay; a delta of n>1 (dropped frame batching two fire
// events into one drain) applies n pattern steps so the climb never loses a
// step. When the sim is unreachable (early boot, tests) it falls back to
// 1 kick per call.

import { WEAPONS, FIRST_SHOT } from "./weapon_data.js";

export function createRecoil(input) {
  let accYaw = 0;              // uncompensated remainder, radians
  let accPitch = 0;
  let burstIdx = 0;            // shots into the current continuous burst
  let lastKickT = -Infinity;   // seconds (performance.now-based)
  let lastWeapon = null;       // WEAPONS entry recovery params come from
  let expectedPitch = null;    // for pulldown detection between updates
  let lastShotsFired = null;   // sim counter watermark for the dedup guard

  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

  function simCounters() {
    try {
      const F = typeof window !== "undefined" && (window.__FPS__ || window.__FFG3D__);
      if (F && F.sim && F.sim.state && F.sim.state.counters) return F.sim.state.counters;
    } catch (e) { /* view-side best effort */ }
    return null;
  }

  function patternStep(w, idx) {
    const pat = (w.recoil && w.recoil.pattern && w.recoil.pattern.length)
      ? w.recoil.pattern : [[0, 0]];
    let i = idx;
    if (i >= pat.length) {
      // tail loop — same rule as ballistics.js (loop over the final rows)
      const loop = w.recoil.loop || { start: Math.max(0, pat.length - 4), len: Math.min(4, pat.length) };
      i = loop.start + ((i - pat.length) % loop.len);
    }
    return pat[i];
  }

  function applyKick(w) {
    const t = now();
    if (t - lastKickT >= FIRST_SHOT.gapS) burstIdx = 0; // new burst (§2.8 boundary, matches sim)
    const step = patternStep(w, burstIdx);
    const scale = ((w.recoil && w.recoil.scale) || 1) *
      (input.state && input.state.ads ? 1.0 : (w.recoil && w.recoil.hipMult) || 0.85);
    const dYaw = step[0] * scale;
    const dPitch = step[1] * scale;
    accYaw += dYaw;
    accPitch += dPitch;
    input.addLook(dYaw, dPitch);
    if (expectedPitch != null) expectedPitch += dPitch; // our own write, not the player's
    burstIdx++;
    lastKickT = t;
    lastWeapon = w;
  }

  return {
    kick(weaponId) {
      const w = WEAPONS[weaponId];
      if (!w) return;
      const c = simCounters();
      if (c) {
        if (lastShotsFired == null) lastShotsFired = Math.max(0, c.shotsFired - 1);
        const n = c.shotsFired - lastShotsFired;
        lastShotsFired = c.shotsFired;
        if (n <= 0) return;              // impactOnly / pen replay — no new round left the gun
        const steps = Math.min(n, 8);    // batched fire events under a hitch: apply each step
        for (let i = 0; i < steps; i++) applyKick(w);
      } else {
        applyKick(w);
      }
    },

    update(dt) {
      if (!(dt > 0)) return;
      const st = input.state;
      // ---- player pulldown compensation (before any recovery) -------------
      if (expectedPitch == null) expectedPitch = st.pitch;
      const external = st.pitch - expectedPitch; // mouse (and clamping) since last update
      if (external < 0 && accPitch > 0) {
        accPitch = Math.max(0, accPitch + external); // pulled-down amount is already compensated
      }
      // ---- recovery (§2.3): recoverPerS after recoverDelayS ---------------
      const w = lastWeapon;
      if (w && (accPitch > 1e-6 || Math.abs(accYaw) > 1e-6)) {
        const delay = (w.recoil && w.recoil.recoverDelayS) ?? 0.08;
        if (now() - lastKickT >= delay) {
          const rate = (w.recoil && w.recoil.recoverPerS) || (12 * Math.PI / 180); // rad/s
          const mag = Math.hypot(accYaw, accPitch);
          const r = Math.min(mag, rate * dt);
          if (mag > 1e-9) {
            const k = r / mag;
            const dy = -accYaw * k;
            const dp = -accPitch * k;
            accYaw += dy;
            accPitch += dp;
            input.addLook(dy, dp); // return the uncompensated remainder — never more
          }
        }
      }
      // reset the burst index bookkeeping when a burst has clearly ended
      if (now() - lastKickT >= FIRST_SHOT.gapS) burstIdx = 0;
      expectedPitch = st.pitch;
    },

    // ---- private extras (probes may read; not part of the frozen surface) --
    get _acc() { return { yaw: accYaw, pitch: accPitch }; },
    get _burstIdx() { return burstIdx; },
  };
}
