// DYEFIELD — specials: the meter's use, CLOUDBURST and WELLSPRING (CONTRACT §10.2 CHANGED(KITSIM),
// CONTRACT_P6_11 §18.1). THREE-free, DOM-free, deterministic. Numbers: data/weapons.json specials[];
// knobs: config.ts KITS. The meter itself fills in MatchWorld (paint + washes, per specialCharge).
//
//   start       intent.special + specialReady + canFire + no special running → meter 0, 'special' start.
//   CLOUDBURST  kind 4 thrown at KITS.cloudPitchDeg (speed solved) at the aim point, clamped to throwRange.
//               On landing (state HOVER) it rises in KITS.cloudRiseSeconds to hoverHeight over the floor
//               below, then rains `duration` s: dropsPerSecond drops at uniform points of the soakRadius
//               disk (the owner's own special mulberry32 stream), each a ray down → a normal 'splat' of
//               dropPaintRadius. Every KITS.cloudDamageTick s, enemies inside the disk, below the cell and
//               with a clear vertical line up to it take damagePerSecond × tick (cause 'special'). Then
//               'special' end. The pool timer counts whole ticks (rise + rain), so a cell drops exactly
//               dropsPerSecond × duration.
//   WELLSPRING  a vertical leap (vy0 = 4h/T, gravity 8h/T², T = KITS.leapSeconds; intents and damage ignored),
//               then the slam where it lands: 'ring', ring splats (ringWidth / 2 every KITS.ringSpacing on the
//               ringRadius circle, dropped onto the floor; points behind a wall are skipped), a coreRadius
//               floor splat, coreDamage to enemies within coreRadius (line of sight), a knockback impulse,
//               'special' end.

import type { PlayerIntent, TeamId } from '../types.ts';
import { DEG } from '../types.ts';
import { hash32 } from '../rng.ts';
import { COMBAT, KITS, TICK } from '../config.ts';
import type { CastHit } from '../physics.ts';
import type { Runner } from '../runner.ts';
import type { CloudDef, SpecialDef, WellDef } from './defs.ts';
import { KIND_CLOUD, PSTATE_HOVER } from './projectiles.ts';
import { axisDistance, type KitHost } from './kits.ts';

/** What specials need beyond KitHost (MatchWorld implements it). */
export interface SpecialHost extends KitHost {
  /** the owner's own special random stream (drop positions) */
  specialRng(pid: number): () => number;
}

/** Try to start runner `r`'s special this tick. Returns true when it started. */
export function stepSpecialInput(r: Runner, intent: PlayerIntent, sp: SpecialDef | null, variant: number, host: SpecialHost): boolean {
  if (!sp || !intent.special || !r.specialReady || r.special < 1 || r.specialActive !== '' || !r.canFire()) return false;
  r.special = 0;
  r.specialReady = false;
  r.specialActive = sp.id;
  r.specialT = 0;
  r.specials++;
  host.emit({ t: 'special', pid: r.id, id: sp.id, phase: 'start', x: r.x, y: r.y, z: r.z });
  if (sp.type === 'cloudburst') throwCloud(r, intent, sp, variant, host);
  else startWell(r, sp);
  return true;
}

/** End runner `r`'s running special (emits 'special' end at x, y, z). */
export function endSpecial(r: Runner, x: number, y: number, z: number, host: KitHost): void {
  if (r.specialActive === '') return;
  host.emit({ t: 'special', pid: r.id, id: r.specialActive, phase: 'end', x, y, z });
  r.specialActive = '';
  r.specialT = 0;
}

// ── CLOUDBURST ─────────────────────────────────────────────────────────────────────────────

function throwCloud(r: Runner, intent: PlayerIntent, c: CloudDef, variant: number, host: SpecialHost): void {
  const ph = host.physics;
  const ox = r.x, oy = r.y + COMBAT.muzzleHeight, oz = r.z;
  const cp0 = Math.cos(r.aimPitch);
  const adx = Math.sin(r.aimYaw) * cp0, ady = Math.sin(r.aimPitch), adz = Math.cos(r.aimYaw) * cp0;
  // target: the aim point, else where the aim ray meets the map, else throwRange along the aim
  let tx: number, ty: number, tz: number;
  if (intent.hasAim && Number.isFinite(intent.aimX) && Number.isFinite(intent.aimY) && Number.isFinite(intent.aimZ)) {
    tx = intent.aimX; ty = intent.aimY; tz = intent.aimZ;
  } else {
    const h = ph.raycast(ox, oy, oz, adx, ady, adz, c.throwRange);
    if (h) { tx = h.x; ty = h.y; tz = h.z; } else { tx = ox + adx * c.throwRange; ty = oy + ady * c.throwRange; tz = oz + adz * c.throwRange; }
  }
  let D = Math.hypot(tx - ox, tz - oz);
  let yaw = r.aimYaw;
  if (D > 0.3) yaw = Math.atan2(tx - ox, tz - oz);
  if (D > c.throwRange) {
    // clamp to throwRange along the same heading, onto the floor there
    const k = c.throwRange / D;
    tx = ox + (tx - ox) * k; tz = oz + (tz - oz) * k; D = c.throwRange;
    const g = ph.raycast(tx, Math.max(ty, oy) + 3, tz, 0, -1, 0, COMBAT.dripMaxDrop);
    ty = g ? g.y : r.y;
  }
  D = Math.max(1, D);
  const dy = ty - oy;
  const gr = KITS.cloudGravity;
  let pitch = KITS.cloudPitchDeg * DEG;
  let v = NaN;
  for (const p of [pitch, 60 * DEG]) {
    const cp = Math.cos(p);
    const den = 2 * cp * cp * (D * Math.tan(p) - dy);
    if (den > 1e-3) { v = Math.sqrt(gr * D * D / den); pitch = p; break; }
  }
  if (!Number.isFinite(v)) { pitch = 45 * DEG; v = Math.sqrt(gr * D); }
  v = Math.min(v, 40);
  const cp = Math.cos(pitch);
  host.pool.spawn(KIND_CLOUD, r.id, r.team, ox, oy, oz, Math.sin(yaw) * cp * v, Math.sin(pitch) * v, Math.cos(yaw) * cp * v,
    hash32(host.seedWord, r.id, 0xc10d + r.specials), 0, variant);
}

/** The cell in `slot` touched the map: it starts rising toward its hover point (state HOVER). */
export function landCloud(slot: number, hit: CastHit, c: CloudDef, host: KitHost): void {
  const P = host.pool;
  // off a wall: step out along its normal, then find the floor below
  const bx = hit.x + hit.nx * 0.2, bz = hit.z + hit.nz * 0.2, by = hit.y + Math.max(0, hit.ny) * 0.05;
  const g = host.physics.raycast(bx, by + 0.1, bz, 0, -1, 0, COMBAT.dripMaxDrop);
  const floorY = g ? g.y : hit.y;
  P.state[slot] = PSTATE_HOVER;
  P.x[slot] = bx; P.y[slot] = by; P.z[slot] = bz;
  P.vx[slot] = 0; P.vy[slot] = 0; P.vz[slot] = 0;
  P.ox[slot] = bx; P.oy[slot] = floorY + c.hoverHeight; P.oz[slot] = bz;
  P.timer[slot] = cloudRiseTicks() + cloudRainTicks(c);
  P.drip[slot] = 0;                                  // drops done
}

export function cloudRiseTicks(): number { return Math.max(1, Math.round(KITS.cloudRiseSeconds / TICK)); }
export function cloudRainTicks(c: CloudDef): number { return Math.max(1, Math.round(c.duration / TICK)); }

/** One tick of the cell in `slot` (rise, then rain). Returns true when it is done (the special ended; remove it). */
export function tickCloud(slot: number, c: CloudDef, host: SpecialHost): boolean {
  const P = host.pool;
  const rise = cloudRiseTicks(), rain = cloudRainTicks(c);
  const owner = P.owner[slot], team = P.team[slot] as TeamId;
  P.timer[slot] -= 1;
  const done = (rise + rain) - P.timer[slot];         // ticks since landing, 1-based
  const hx = P.ox[slot], hy = P.oy[slot], hz = P.oz[slot];
  if (done <= rise) {
    const left = rise - done + 1;                     // move 1/left of the remaining way: arrives exactly at `rise`
    P.x[slot] += (hx - P.x[slot]) / left; P.y[slot] += (hy - P.y[slot]) / left; P.z[slot] += (hz - P.z[slot]) / left;
    return false;
  }
  P.x[slot] = hx; P.y[slot] = hy; P.z[slot] = hz;
  const n = done - rise;                              // rain ticks elapsed (1..rain)
  const due = Math.floor(n * TICK * c.dropsPerSecond + 1e-6);
  const rng = host.specialRng(owner);
  const ph = host.physics;
  while (P.drip[slot] < due) {
    P.drip[slot] += 1;
    const a = rng() * Math.PI * 2;
    const rr = c.soakRadius * Math.sqrt(rng());
    const px = hx + rr * Math.cos(a), pz = hz + rr * Math.sin(a);
    const g = ph.raycast(px, hy, pz, 0, -1, 0, COMBAT.dripMaxDrop);
    if (g) host.paint(owner, team, g.x, g.y, g.z, c.dropPaintRadius, g.nx, g.ny, g.nz, -0.1, hash32(P.seed[slot], P.drip[slot]));
  }
  // rain damage in ticks of KITS.cloudDamageTick
  const every = Math.max(1, Math.round(KITS.cloudDamageTick / TICK));
  if (n % every === 0) {
    const dmg = c.damagePerSecond * every * TICK;
    const R = host.runners;
    for (let i = 0; i < R.length; i++) {
      const v = R[i];
      if (!v.alive || v.team === team) continue;
      if (Math.hypot(v.x - hx, v.z - hz) > c.soakRadius) continue;
      const top = v.y + v.hitHeight();
      if (top >= hy) continue;
      if (ph.raycast(v.x, top, v.z, 0, 1, 0, hy - top)) continue;   // sheltered
      host.damage(v, owner, dmg, v.x, top, v.z, 'special', false);
    }
  }
  if (P.timer[slot] > 0) return false;
  const r = host.runners[owner];
  if (r) endSpecial(r, hx, hy, hz, host);
  return true;
}

// ── WELLSPRING ─────────────────────────────────────────────────────────────────────────────

function startWell(r: Runner, w: WellDef): void {
  const T = Math.max(0.1, KITS.leapSeconds);
  r.startLeap(4 * w.leapHeight / T, 8 * w.leapHeight / (T * T));
}

/** The slam where the leaper `r` landed (or gave up at KITS.leapMaxSeconds). */
export function slam(r: Runner, w: WellDef, host: KitHost): void {
  r.leaping = false;
  r.slamPending = false;
  const ph = host.physics;
  const cx = r.x, cy = r.y, cz = r.z;
  host.emit({ t: 'ring', pid: r.id, x: cx, y: cy, z: cz, r: w.ringRadius });
  const base = hash32(host.seedWord, r.id, 0x5a1a + r.specials);
  // the ring: splats around the circle, dropped onto the floor; a wall between the centre and a point blocks it
  const hw = w.ringWidth * 0.5;
  const n = Math.max(8, Math.ceil(2 * Math.PI * w.ringRadius / KITS.ringSpacing));
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const sx = Math.sin(a), sz = Math.cos(a);
    const block = ph.raycast(cx, cy + 0.5, cz, sx, 0, sz, w.ringRadius);
    if (block && block.toi < w.ringRadius - hw) continue;
    const px = cx + sx * w.ringRadius, pz = cz + sz * w.ringRadius;
    const g = ph.raycast(px, cy + 1.5, pz, 0, -1, 0, 3.5);
    if (!g) continue;
    host.paint(r.id, r.team, g.x, g.y, g.z, hw, g.nx, g.ny, g.nz, 0.35, hash32(base, k));
  }
  // the core
  const g0 = ph.raycast(cx, cy + 0.5, cz, 0, -1, 0, 2);
  if (g0) host.paint(r.id, r.team, g0.x, g0.y, g0.z, w.coreRadius, 0, 1, 0, 0.35, hash32(base, 0xc0e));
  else host.paint(r.id, r.team, cx, cy, cz, w.coreRadius, 0, 1, 0, 0.35, hash32(base, 0xc0e));
  // core damage + knockback
  const R = host.runners;
  for (let i = 0; i < R.length; i++) {
    const v = R[i];
    if (!v.alive || v.team === r.team || v.leaping) continue;
    if (axisDistance(v, cx, cy + 0.05, cz) > w.coreRadius) continue;
    if (!host.lineClear(cx, cy + 0.5, cz, v.x, v.y + v.hitHeight() * 0.5, v.z)) continue;
    host.damage(v, r.id, w.coreDamage, v.x, v.y + v.hitHeight() * 0.5, v.z, 'special');
    if (!v.alive) continue;
    let kx = v.x - cx, kz = v.z - cz;
    const kl = Math.hypot(kx, kz);
    if (kl > 1e-4) { kx /= kl; kz /= kl; } else { kx = Math.sin(r.yaw); kz = Math.cos(r.yaw); }
    v.knock(kx * w.knockback, w.knockback * KITS.knockbackUp, kz * w.knockback);
  }
  endSpecial(r, cx, cy, cz, host);
}
