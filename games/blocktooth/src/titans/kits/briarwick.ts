// BLOCKTOOTH — BRIARWICK kit: AREA CONTROL (CONTRACT §8, TITAN PASS kit C). Lane titan-sim. THREE-free, deterministic.
// Plant, ripen, burst in chain reactions.
//   Auto  BURR LASH     — lane toward the target (hits everything in it) and plants a SEED POD at the target.
//   Pass  RIPENING      — pods ripen in 2 s; a ripe pod bursts when a foe / boss part touches it (or when it
//                         goes to seed at end of life). A burst tangles (stuns) foes, heals the titan a little,
//                         and sets off every RIPE pod near it (a chain: +10 % per link). Broken floors near the
//                         titan sprout pods (35 %; collapses always), so bursts that break floors re-seed the block.
//   Hook  POP-UP PARK   — horn stamp (ring burst) + a 4-seed volley at the nearest foes + EVERY pod within 12 H
//                         ripens and detonates as one outward cascade (+10 % per link, cap x2).
//   Dash  BRAMBLE BOUND — the shared bound; it drops 2 unripe pods along its path.
// Pods are titan-owned `bloom` hazards (the same kind the bloom upgrade cards and GREENBELT DECREE plant, so
// those cards plant pods). Kit state (titan.kit): pods, ripe, turrets (= pods, legacy HUD), chain (last cascade
// length, view), bloomT (hook anim), sowT (legacy view key = bloomT).
// Events: `bloomSpawn` per pod planted, `bloomBurst {x, z, r, link, ripe}` per pod burst, `rooted {id, x, z, t}`
// per foe a TANGLE stuns (bosses are never stunned), `explosion 'seed'` per burst and per horn stamp.
// Tuning (CONTRACT §8 G3): every BRIARWICK change stays in `BRIAR` below — never through BOSS_KIND_MUL.

import type { DamageOpts, Enemy, Hazard, World } from '../../core/types.ts';
import { headingOf } from '../../core/math.ts';
import { damageArea, titanDamage } from '../../combat/damage.ts';
import { findTarget } from '../../combat/targeting.ts';
import { enemiesInCircle, nearestEnemies } from '../../combat/spatial.ts';
import { spawnHazard } from '../../combat/hazards.ts';
import { buildingsInRect } from '../../city/citysim.ts';
import { healTitan } from '../titansim.ts';
import {
  S, aimPoint, autoInterval, closestOnBuilding, distToBuilding, emitAbility, emitAttack, faceToward, hookCooldown,
  idleAuto, knockFor, kv, rearmAuto, titanHazards,
} from './common.ts';

/** Tuning (mutable so probes can sweep them at runtime). Ranges/radii in titan heights H, times in s. */
export const BRIAR = {
  // ── auto: BURR LASH ──
  lashEveryS: 1.0,         // ÷ attackRate
  lashLenH: 3.2,           // × H × vineLength × attackRange (× size1LenMul at Size I)
  lashWH: 0.55,            // × H × area
  lashDmg: 14,
  lashKnock: 0.5,
  size1LenMul: 1.8,        // Size I only (foes stand 5-8 m off a 1.2 m titan)
  // ── pods ──
  podRH: 0.3,              // footprint (view / hazard shape) × H at plant time
  podLifeS: 9,
  ripenS: 2.0,             // ÷ turretRate
  triggerRH: 0.9,          // a RIPE pod bursts when a foe / boss part comes within this (× H)
  burstRH: 1.1,            // × H × area (× size1BurstRMul at Size I)
  size1BurstRMul: 1.3,
  burstDmg: 18,
  burstKnock: 0.8,
  greenMul: 0.6,           // an unripe pod forced to pop (cap overflow / end of life before ripe)
  tangleS: 0.6,            // stun on foes caught in a burst (elites × 0.3, heavies × 0.6)
  chainRH: 2.4,            // ripe pods within this of a burst chain (× H × area × chainRange)
  chainDelayS: 0.1,
  linkBonus: 0.1,          // + per chain link
  linkCap: 1.0,            // max bonus (×2)
  greenRipenOnChain: 0.5,  // unripe pods inside a chain radius gain this much ripeness (the spores ripen them)
  healFrac: 0.004,         // × maxHp × sporeHeal per pod burst
  healCapPerS: 0.015,      // × maxHp, per rolling 1 s window
  bloomNearH: 3,           // floor breaks within this many H sprout pods
  bloomFloorChance: 0.35,
  // ── hook: POP-UP PARK ──
  hookCdS: 8,
  hookRH: 12,              // every pod within this (× H) joins the cascade
  ringRH: 1.6,             // × H × area (× size1BurstRMul at Size I)
  ringDmg: 24,             // × abilityPower
  ringKnock: 1.2,
  ringTangleS: 1.0,
  volleyN: 4,              // + round(2 × (abilityPower − 1)), 3..10
  volleyRH: 6,             // × H (× size1LenMul at Size I)
  volleyFlightS: 0.3,
  cascadeStartS: 0.15,
  rippleS: 0.06,           // per pod, outward by distance from the titan
  hookBurstMul: 1.0,       // × abilityPower on hook-cascade bursts
  // ── dash: BRAMBLE BOUND seed trail ──
  dashPods: 2,
};

/** Size-I multiplier (1 from Size II on). */
function s1(w: World, mul: number): number { return w.titan.rank === 0 ? mul : 1; }

const SRC_PASSIVE = 0, SRC_HOOK = 1, SRC_DASH = 2, SRC_UPG = 3;
const hazBuf: Hazard[] = [];
const podBuf: Hazard[] = [];
const enemyBuf: Enemy[] = [];
const idBuf: number[] = [];
const aim = { x: 0, z: 0 };
const pt = { x: 0, z: 0 };
const LASH_OPTS: DamageOpts = { src: 'titan', kind: 'vine' };
const BURST_OPTS: DamageOpts = { src: 'titan', kind: 'seed' };
const RING_OPTS: DamageOpts = { src: 'titan', kind: 'seed' };

/** Floor-break detection by footprint diff (catches breaks from every source and every point of the
 *  tick — contact, lash, bursts, triggers): building id → alive floors / last tick seen, per world. */
interface BreakCache { alive: Map<number, number>; seen: Map<number, number>; }
const caches = new WeakMap<World, BreakCache>();

export function init(): Record<string, number> {
  return { pods: 0, ripe: 0, turrets: 0, chain: 0, bloomT: 0, sowT: 0, healWin: 0, healT: 0 };
}

/** Auto-attack reach (m) right now — pickups.ts latches drops inside ~1.2 × this (kits/index kitReach). */
export function reach(w: World): number {
  return BRIAR.lashLenH * s1(w, BRIAR.size1LenMul) * w.titan.height
    * Math.max(0.1, S(w, 'vineLength')) * Math.max(0.1, S(w, 'attackRange'));
}

function podCap(w: World): number { return Math.max(1, Math.floor(S(w, 'turretCap'))); }
function ripenTime(w: World): number { return BRIAR.ripenS / Math.max(0.1, S(w, 'turretRate')); }

export function step(w: World): void {
  const T = w.titan, K = T.kit;
  K.bloomT = Math.max(0, kv(w, 'bloomT') - w.dt);
  K.sowT = K.bloomT;
  K.healT = kv(w, 'healT') - w.dt;
  if (K.healT <= 0) { K.healT = 1; K.healWin = 0; }

  detectBreaks(w);
  stepPods(w);

  if (w.input.ability && T.abilityCd <= 0) popUpPark(w);

  // ── auto: BURR LASH ──
  if (T.autoCd <= 0) lash(w);

  const pods = titanHazards(w, 'bloom', hazBuf);
  let ripe = 0;
  for (const h of pods) if ((h.data.ripe ?? 0) >= 1) ripe++;
  K.pods = pods.length; K.turrets = pods.length; K.ripe = ripe;
}

function lash(w: World): void {
  const T = w.titan;
  const H = T.height;
  const len = reach(w);
  const t = findTarget(w, T.x, T.z, len, true);
  if (!t) { idleAuto(w); return; }
  aimPoint(w, t, T.x, T.z, aim);
  const dir = headingOf(aim.x - T.x, aim.z - T.z);
  const width = BRIAR.lashWH * H * Math.max(0.1, S(w, 'area'));
  LASH_OPTS.knock = knockFor(w, BRIAR.lashKnock);
  const hits = damageArea(w, { k: 'lane', x: T.x, z: T.z, dir, len, w: width }, titanDamage(w, BRIAR.lashDmg), LASH_OPTS);
  const x1 = T.x + Math.sin(dir) * len, z1 = T.z + Math.cos(dir) * len;
  w.events.push({ type: 'vine', x0: T.x, z0: T.z, x1, z1 });
  // the burr: a pod where the lash struck (the target, clamped into the lane)
  const d = Math.min(len, Math.hypot(aim.x - T.x, aim.z - T.z));
  plantPod(w, T.x + Math.sin(dir) * d, T.z + Math.cos(dir) * d, SRC_PASSIVE, 0);
  emitAttack(w, 'vineLash', T.x, T.z, dir, len, hits);
  faceToward(w, dir);
  rearmAuto(w, autoInterval(w, BRIAR.lashEveryS));
}

// ─────────────────────────────── pods ───────────────────────────────
/** Plant a pod. At the cap the OLDEST unfused pod bursts early (overgrowth) instead of being deleted. */
function plantPod(w: World, x: number, z: number, src: number, ripe: number, bypassCap = false): Hazard {
  const T = w.titan;
  if (!bypassCap) {
    const pods = titanHazards(w, 'bloom', podBuf);
    let live = 0;
    for (const h of pods) if ((h.data.fuse ?? -1) < 0 && !h.data.vol) live++;
    let excess = live - (podCap(w) - 1);
    for (let i = 0; i < pods.length && excess > 0; i++) {
      const h = pods[i];
      if ((h.data.fuse ?? -1) >= 0 || h.data.vol) continue;
      burst(w, h, 0, h.data.src ?? SRC_PASSIVE);
      excess--;
    }
  }
  const h = spawnHazard(w, {
    owner: 'titan', kind: 'bloom',
    shape: { k: 'circle', x, z, r: Math.max(0.3, BRIAR.podRH * T.height) },
    life: BRIAR.podLifeS,
    dps: 0,
    data: { pod: 1, ripe, fuse: -1, link: 0, src, h: T.height, vol: bypassCap ? 1 : 0 },
  });
  w.events.push({ type: 'bloomSpawn', id: h.id, x, z });
  return h;
}

function adopt(h: Hazard): void {
  // blooms planted by upgrade cards / GREENBELT DECREE become pods
  const d = h.data;
  d.pod = 1; d.ripe = 0; d.fuse = -1; d.link = 0; d.src = SRC_UPG; d.vol = 0;
}

let w0x = 0, w0z = 0;
function podXZ(h: Hazard): { x: number; z: number } {
  const s = h.shape;
  if (s.k === 'circle') { pt.x = s.x; pt.z = s.z; } else { pt.x = w0x; pt.z = w0z; }
  return pt;
}

function stepPods(w: World): void {
  const T = w.titan;
  const dt = w.dt;
  const H = T.height;
  w0x = T.x; w0z = T.z;
  const rip = ripenTime(w);
  const pods = titanHazards(w, 'bloom', podBuf).slice();
  for (let i = 0; i < pods.length; i++) {
    const h = pods[i];
    if (!h.alive) continue;
    const d = h.data;
    if (d.pod !== 1) adopt(h);
    if (d.ripe < 1) d.ripe = Math.min(1, d.ripe + dt / rip);
    if (d.fuse >= 0) {
      d.fuse -= dt;
      if (d.fuse <= 0) burst(w, h, d.link, d.src);
      continue;
    }
    // expires in stepHazards this tick → go to seed now
    if (h.t + dt >= h.life - 1e-6) { burst(w, h, 0, d.src); continue; }
    if (d.ripe >= 1 && foeNear(w, podXZ(h), BRIAR.triggerRH * H)) burst(w, h, 0, d.src);
  }
}

function foeNear(w: World, p: { x: number; z: number }, r: number): boolean {
  const px = p.x, pz = p.z;
  enemiesInCircle(w, px, pz, r, enemyBuf);
  for (let i = 0; i < enemyBuf.length; i++) if (enemyBuf[i].alive && enemyBuf[i].hp > 0) return true;
  const B = w.boss;
  if (B && B.alive && B.introT <= 0) {
    for (const part of B.parts) if (Math.hypot(part.x - px, part.z - pz) - part.r <= r) return true;
  }
  return false;
}

/** Burst one pod: circle damage, tangle, heal, and set off the ripe pods around it (chain). */
function burst(w: World, h: Hazard, link: number, src: number): void {
  if (!h.alive) return;
  h.alive = false;
  const T = w.titan;
  const H = T.height;
  const d = h.data;
  const p = podXZ(h);
  const x = p.x, z = p.z;
  const area = Math.max(0.1, S(w, 'area'));
  const r = BRIAR.burstRH * s1(w, BRIAR.size1BurstRMul) * H * area;
  const ripeness = Math.max(0, Math.min(1, d.ripe ?? 0));
  const ripe = ripeness >= 1;
  let mul = (ripe ? 1 : BRIAR.greenMul) * (1 + Math.min(BRIAR.linkCap, BRIAR.linkBonus * link));
  if (src === SRC_HOOK) mul *= BRIAR.hookBurstMul * Math.max(0.25, S(w, 'abilityPower'));
  BURST_OPTS.knock = knockFor(w, BRIAR.burstKnock);
  damageArea(w, { k: 'circle', x, z, r }, titanDamage(w, BRIAR.burstDmg) * mul, BURST_OPTS);
  tangle(w, x, z, r, BRIAR.tangleS);
  w.events.push({ type: 'explosion', x, z, r, kind: 'seed' });
  w.events.push({ type: 'bloomBurst', x, z, r, link, ripe: ripeness });
  // spores drift back to the titan
  const heal = T.maxHp * BRIAR.healFrac * Math.max(0, S(w, 'sporeHeal'));
  const room = T.maxHp * BRIAR.healCapPerS - kv(w, 'healWin');
  if (heal > 0 && room > 0) { const a = Math.min(room, heal); T.kit.healWin = kv(w, 'healWin') + a; healTitan(w, a); }
  // chain: ripe neighbours go off next; unripe neighbours ripen
  const cr = BRIAR.chainRH * H * area * Math.max(0.1, S(w, 'chainRange'));
  const pods = titanHazards(w, 'bloom', hazBuf);
  for (let i = 0; i < pods.length; i++) {
    const o = pods[i];
    if (o === h || !o.alive || o.shape.k !== 'circle') continue;
    const od = o.data;
    if (od.pod !== 1) adopt(o);
    if (od.fuse >= 0) continue;
    if (Math.hypot(o.shape.x - x, o.shape.z - z) > cr) continue;
    if (od.ripe >= 1) { od.fuse = BRIAR.chainDelayS; od.link = link + 1; od.src = src === SRC_HOOK ? SRC_HOOK : od.src; }
    else od.ripe = Math.min(1, od.ripe + BRIAR.greenRipenOnChain);
  }
}

/** TANGLE: stun the foes in a circle (elites × 0.3, heavies × 0.6; the boss is never an Enemy, so never stunned).
 *  Every foe whose stun this lengthens gets a `rooted` event (the view draws root coils for `t` s). */
function tangle(w: World, x: number, z: number, r: number, s: number): void {
  enemiesInCircle(w, x, z, r, enemyBuf);
  for (let i = 0; i < enemyBuf.length; i++) {
    const e = enemyBuf[i];
    if (!e.alive) continue;
    const k = e.elite || e.kind === 'elite' ? 0.3 : e.radius >= 2.4 ? 0.6 : 1;
    const t = s * k;
    if (t > e.stun) w.events.push({ type: 'rooted', id: e.id, x: e.x, z: e.z, t });
    e.stun = Math.max(e.stun, t);
  }
  enemyBuf.length = 0;
}

// ─────────────────────────────── floor breaks sprout pods ───────────────────────────────
function detectBreaks(w: World): void {
  const T = w.titan;
  let c = caches.get(w);
  if (!c) { c = { alive: new Map(), seen: new Map() }; caches.set(w, c); }
  if (c.alive.size > 4096) { c.alive.clear(); c.seen.clear(); }
  const near = BRIAR.bloomNearH * T.height;
  buildingsInRect(w.city, T.x - near, T.z - near, T.x + near, T.z + near, idBuf);
  for (let i = 0; i < idBuf.length; i++) {
    const id = idBuf[i];
    const b = w.city.buildings[id];
    if (!b) continue;
    const prev = c.alive.get(id);
    const seenTick = c.seen.get(id);
    c.alive.set(id, b.alive);
    c.seen.set(id, w.tick);
    if (prev === undefined || seenTick !== w.tick - 1 || b.alive >= prev) continue;
    if (distToBuilding(b, T.x, T.z) > near) continue;
    if (b.collapsed || b.alive <= 0) { plantPod(w, b.x, b.z, SRC_PASSIVE, 0); continue; }
    const broken = prev - b.alive;
    for (let k = 0; k < broken; k++) {
      if (w.rng.combat() < BRIAR.bloomFloorChance) {
        closestOnBuilding(b, T.x, T.z, pt);
        plantPod(w, pt.x, pt.z, SRC_PASSIVE, 0);
        break;
      }
    }
  }
}

// ─────────────────────────────── hook: POP-UP PARK ───────────────────────────────
const order: { h: Hazard; d: number }[] = [];
function popUpPark(w: World): void {
  const T = w.titan, K = T.kit;
  const H = T.height;
  const power = Math.max(0, S(w, 'abilityPower'));
  const area = Math.max(0.1, S(w, 'area'));
  T.abilityCd = hookCooldown(w, BRIAR.hookCdS);
  // 1) horn stamp
  const rr = BRIAR.ringRH * s1(w, BRIAR.size1BurstRMul) * H * area;
  RING_OPTS.knock = knockFor(w, BRIAR.ringKnock);
  damageArea(w, { k: 'circle', x: T.x, z: T.z, r: rr }, titanDamage(w, BRIAR.ringDmg * power), RING_OPTS);
  tangle(w, T.x, T.z, rr, BRIAR.ringTangleS);
  w.events.push({ type: 'explosion', x: T.x, z: T.z, r: rr, kind: 'seed' });
  // 2) seed volley at the nearest foes (then the nearest boss part, then a fan ahead)
  const n = Math.max(3, Math.min(10, BRIAR.volleyN + Math.round(2 * (power - 1))));
  const vr = BRIAR.volleyRH * s1(w, BRIAR.size1LenMul) * H;
  nearestEnemies(w, T.x, T.z, vr, n, enemyBuf);
  let planted = 0;
  for (let i = 0; i < enemyBuf.length && planted < n; i++) {
    const e = enemyBuf[i];
    if (!e.alive) continue;
    plantPod(w, e.x, e.z, SRC_HOOK, 1, true); planted++;
  }
  enemyBuf.length = 0;
  const B = w.boss;
  if (planted < n && B && B.alive && B.introT <= 0) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < B.parts.length; i++) {
      const p = B.parts[i];
      const dd = Math.hypot(p.x - T.x, p.z - T.z) - p.r;
      if (dd <= vr && dd < bd) { bd = dd; best = i; }
    }
    if (best >= 0) {
      const p = B.parts[best];
      while (planted < n) { plantPod(w, p.x, p.z, SRC_HOOK, 1, true); planted++; }
    }
  }
  for (let i = 0; planted < n; i++, planted++) {
    const a = T.heading + (i - (n - planted - 1) / 2) * 0.5;
    plantPod(w, T.x + Math.sin(a) * 2.5 * H, T.z + Math.cos(a) * 2.5 * H, SRC_HOOK, 1, true);
  }
  // 3) every pod within reach ripens and detonates, outward
  const hr = BRIAR.hookRH * H;
  const pods = titanHazards(w, 'bloom', hazBuf);
  order.length = 0;
  for (const h of pods) {
    if (h.shape.k !== 'circle') continue;
    const dd = Math.hypot(h.shape.x - T.x, h.shape.z - T.z);
    if (dd <= hr) order.push({ h, d: dd });
  }
  order.sort((a, b) => a.d - b.d || a.h.id - b.h.id);
  for (let i = 0; i < order.length; i++) {
    const d = order[i].h.data;
    if (d.pod !== 1) adopt(order[i].h);
    d.ripe = 1;
    d.src = SRC_HOOK;
    d.link = i;
    d.fuse = (d.vol ? BRIAR.volleyFlightS : BRIAR.cascadeStartS) + BRIAR.rippleS * i;
  }
  K.chain = order.length;
  K.bloomT = 0.6 + BRIAR.rippleS * order.length;
  emitAbility(w, 'briarwick', power);
}

// ─────────────────────────────── dash: BRAMBLE BOUND seed trail ───────────────────────────────
export function onDash(w: World, x0: number, z0: number, x1: number, z1: number): void {
  const n = BRIAR.dashPods;
  for (let i = 1; i <= n; i++) {
    const f = i / (n + 1);
    plantPod(w, x0 + (x1 - x0) * f, z0 + (z1 - z0) * f, SRC_DASH, 0);
  }
}
