// BLOCKTOOTH — the gate bot (GATEKEEPERS.md §5.5, §7.2 ModBotGate). Harness code, deterministic, pure:
// never reads RNG and never mutates gameplay state. Lane K1a.
//
// While a gatekeeper is alive, botGate returns a world point for the bot to steer to, or null (bot.ts then
// uses its generic boss branch: hold attack reach from the nearest part and strafe). The threat layer in
// bot.ts runs BEFORE this (a live hostile tell always wins), so every point here is only a "where to
// fight from" choice:
//   * any gatekeeper with an OPEN weak point (b.data.weakMask: STENCIL-1's drum in REFILL / TIPPED OVER,
//     CORDON-2's pack while OVERHEATED / STALLED, SWITCHBOARD-5's unfolded dishes) → a stand point just
//     outside that part on its far side from the rig's centre (walk BEHIND the cart / wall), within
//     attack reach; when the rig body is between the titan and that point, a flank waypoint on the
//     titan's side of the rig first (never straight through the body);
//   * CORDON-2 with the pack shut: from its front arc, circle toward the rear on the side of the shorter
//     arc; from behind, the pack's stand point (the pack is the nearest part behind the wall anyway);
//   * SWITCHBOARD-5 RELOCATING (dishes folded): chase its base at full speed (bot.ts's travel dash closes
//     a big gap);
//   * STENCIL-1 with the drum shut: null (the generic branch; the threat layer steps out of the lanes).
// The hook cannot press dash (bot.ts owns the input); the "dash to the rear" of §5.5 is approximated by
// the shorter-arc orbit plus bot.ts's own offensive / travel dash.

import type { BossPart, BossState, World } from '../src/core/types.ts';

/** attack reach in titan heights by titan (bot.ts REACH_H mirror; VOLT-KITE holds inside its wire radius) */
const REACH_H: Record<string, number> = { molo: 0.9, voltkite: 0.9, hearthback: 1.2, briarwick: 1.5 };

function reachOf(w: World): number {
  const T = w.titan;
  const h = REACH_H[T.id] ?? 1.0;
  return h * T.height * Math.max(0.5, T.stats.attackRange || 1);
}

/** the rig's H (the settled latch bossH writes), else the titan's height */
function rigH(w: World, b: BossState): number {
  const H = b.data.H;
  return Number.isFinite(H) && H > 0 ? H : w.titan.height;
}

/** nearest part (to the titan) whose bit is set in the mask; −1 when none */
function nearestMasked(w: World, b: BossState, mask: number): number {
  const T = w.titan;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < b.parts.length && i < 31; i++) {
    if (!((mask >>> i) & 1)) continue;
    const p = b.parts[i];
    const d = Math.hypot(p.x - T.x, p.z - T.z) - p.r;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function partNamed(b: BossState, name: string): number {
  for (let i = 0; i < b.parts.length; i++) if (b.parts[i].name === name) return i;
  return -1;
}

/**
 * Stand point outside part p, on the side away from the rig's centre, at part.r + clamp(0.5 reach, 0.25 H,
 * 0.8 H); a flank waypoint first when the titan is on the other side of the rig.
 */
function standBehind(w: World, b: BossState, p: BossPart, out: { x: number; z: number }): { x: number; z: number } {
  const T = w.titan;
  const H = rigH(w, b);
  let ux = p.x - b.x, uz = p.z - b.z;
  let m = Math.hypot(ux, uz);
  if (m < 1e-6) { ux = -Math.sin(b.heading); uz = -Math.cos(b.heading); m = 1; }
  ux /= m; uz /= m;
  const gap = Math.min(0.8 * H, Math.max(0.25 * H, 0.5 * reachOf(w)));
  const sx = p.x + ux * (p.r + gap), sz = p.z + uz * (p.r + gap);
  // titan relative to the rig centre, along the stand axis: behind the rig's far side → flank first
  const tx = T.x - b.x, tz = T.z - b.z;
  const along = tx * ux + tz * uz;
  const rStand = Math.hypot(sx - b.x, sz - b.z);
  if (along < 0.25 * rStand) {
    // perpendicular on the titan's side, at the stand radius (walk round, not through)
    const px = -uz, pz = ux;
    const side = tx * px + tz * pz >= 0 ? 1 : -1;
    const rr = Math.max(rStand, Math.hypot(tx, tz) * 0.9);
    out.x = b.x + (px * side * 0.85 + ux * 0.5) * rr;
    out.z = b.z + (pz * side * 0.85 + uz * 0.5) * rr;
    return out;
  }
  out.x = sx; out.z = sz;
  return out;
}

export function botGate(w: World, out: { x: number; z: number }): { x: number; z: number } | null {
  const b = w.boss, T = w.titan;
  if (!b || !b.alive || b.role !== 'gate' || !T.alive) return null;
  if (b.introT > 0) return null;
  if (b.data.raceT > 0) return null;                  // STRIPE RUN racing: the threat layer's business

  // SWITCHBOARD-5 relocating (dishes folded): chase the base
  if (b.id === 'switchboard5' && (b.data.folded ?? 0) > 0 && b.staggerT <= 0) {
    out.x = b.x; out.z = b.z;
    return out;
  }

  // any open weak point: fight from behind it
  const mask = (b.data.weakMask ?? 0) | 0;
  if (mask !== 0) {
    const i = nearestMasked(w, b, mask);
    if (i >= 0) return standBehind(w, b, b.parts[i], out);
  }

  // CORDON-2 with the pack shut: get round the wall
  if (b.id === 'cordon2') {
    const H = rigH(w, b);
    const fx = Math.sin(b.heading), fz = Math.cos(b.heading);
    const tx = T.x - b.x, tz = T.z - b.z;
    const d = Math.hypot(tx, tz) || 1;
    const cosA = (tx * fx + tz * fz) / d;
    const ang = Math.acos(Math.max(-1, Math.min(1, cosA)));          // 0 = dead ahead, π = behind
    if (ang > (110 * Math.PI) / 180) {
      const pk = partNamed(b, 'pack');
      if (pk >= 0) return standBehind(w, b, b.parts[pk], out);
      return null;
    }
    // orbit toward the rear on the shorter arc: a waypoint 60° further round the rig, on the step that
    // increases the angle to its facing (the titan's own side of the facing axis), just outside the wall
    const a0 = Math.atan2(tx, tz);
    const r = Math.max(1.95 * H, Math.min(d, 3.0 * H));
    const offFacing = (a: number) => Math.acos(Math.max(-1, Math.min(1, Math.sin(a) * fx + Math.cos(a) * fz)));
    const aPlus = a0 + Math.PI / 3, aMinus = a0 - Math.PI / 3;
    const aStep = offFacing(aPlus) >= offFacing(aMinus) ? aPlus : aMinus;
    out.x = b.x + Math.sin(aStep) * r;
    out.z = b.z + Math.cos(aStep) * r;
    return out;
  }

  return null;
}
