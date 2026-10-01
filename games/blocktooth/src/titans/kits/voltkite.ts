// BLOCKTOOTH — VOLT-KITE kit: CHAIN ASSASSIN (CONTRACT §8). Lane titan-sim. THREE-free, deterministic.
//   Auto  FORK-ARC          — lightning to a target, then forks (enemies first, then boss/city), −15 %/jump.
//                             GROUNDING: every 2nd arc that strikes a foe/boss earths a short LIVE WIRE there
//                             (full wireDuration life, like a dash wire).
//   Pass  LIVE WIRE         — every dash lays a `wire` hazard (capsule) along its path. Cap 6.
//   Hook  RECAST: DETONATE  — every live wire explodes along its length and charges a STATIC SHIELD per wire blown;
//                             no wires → static burst. An 8 s cooldown (fb3, owner playtest): a deliberate big moment
//                             that pays out the wires laid since the last press, not a 1.5 s spam button.
// Kit state (titan.kit): wires (live wire count, view/HUD), arcHits (last arc's hits), arcN (arc counter).

import type { DamageOpts, Enemy, Hazard, Shape, World } from '../../core/types.ts';
import { dist, headingOf } from '../../core/math.ts';
import { damageArea, titanDamage } from '../../combat/damage.ts';
import { findTarget, hitTarget } from '../../combat/targeting.ts';
import type { Target } from '../../combat/targeting.ts';
import { nearestEnemy } from '../../combat/spatial.ts';
import { spawnHazard } from '../../combat/hazards.ts';
import { buildingsInRect, propsInRect } from '../../city/citysim.ts';
import {
  S, aimPoint, autoInterval, distToBuilding, emitAbility, emitAttack, faceToward, hookCooldown, idleAuto, knockFor,
  makeRoom, propRadius, rearmAuto, titanHazards,
} from './common.ts';

/** Tuning (balance gate edits these; mutable so probes can sweep them at runtime). */
export const VOLT = {
  arcEveryS: 0.9,          // ÷ attackRate
  arcRangeH: 3.8,          // × H × attackRange (titanpass: 3.2 → 3.8, the kiter out-ranges breath cones)
  jumpRangeH: 1.6,         // × H × chainRange
  arcDmg: 12,
  arcFalloff: 0.85,        // per jump
  arcKnock: 0.25,
  maxJumps: 24,            // hard safety cap on arcForks + chains
  wireRH: 0.25,            // × H × area
  wireDps: 7,              // × wireDamage (fb3: 10 → 7 — with RECAST no longer spammed, wires live out their full life, so
                           // the passive hum is lighter and the press carries the payoff)
  wireCap: 6,
  wireMinLenH: 0.35,       // a blocked dash still lays a stub this long (along the dash direction)
  // RECAST: DETONATE (fb3, owner playtest 2026-09-30: "SPACE attack needs a longer cooldown as it allows me to melt away at
  // everything"). 1.5 s → 8 s, in line with MOLO GULLET VACUUM 9 s / BRIARWICK POP-UP PARK 8 s / HEARTHBACK SHELL VENT 6 s.
  // Spamming RECAST had also cut every wire short; at 8 s the wires live out their life, so the cooldown alone made VOLT
  // STRONGER at bosses (bot trace GRID-EAST/1: PARKADE-6 95 → 66 s;
  // P-human x24 with a bigger payoff: city TTK 114 → 86 s). The payoff below was retuned against that (fb3 sweep under STATIC SHIELD).
  detCdS: 8,
  detRH: 0.8,              // × H × area, along each wire
  detDmg: 50,              // × abilityPower (fb3: 40 → 50, one press is the big hit; 55 put boss TTK at 0.86 × MOLO)
  detPerSec: 8,            // + per remaining wire second (fb3: 6 → 8)
  detKnock: 1.0,
  burstRH: 1.2,            // × H × area (no wires out)
  burstDmg: 40,            // × abilityPower (fb3: 15 → 40 — an 8 s press with no wires out is still a real hit)
  burstKnock: 0.8,
  groundEvery: 2,          // GROUNDING: every Nth arc that strikes a foe/boss lays a short live wire (titanpass)
  groundLenH: 1.4,         // × H, from the struck point back toward the titan
  groundLife: 0.625,       // × wireDuration: a GROUNDING wire lives 2.5 s. fb3: 1.0 → 0.625 — 1.0 was raised so a 1.5 s
                           // RECAST spam always found 2-3 wires; with the 8 s cooldown wires are no longer cut short, and at
                           // 1.0 the extra uptime kept VOLT's boss TTK under MOLO's. 0.5 measured fine on balance but failed
                           // GATE 2 (lockwater/1337 banked +7 LV in a slow Size I gatekeeper fight: G2 @170 s, Size III
                           // @203 s); 0.6 / 0.625 pass. History: 0.75 once gave a GATE 2 full clear @474 s < 480.
  bossParts: 2,            // boss parts one arc may strike (was 1; titanpass)
  // STATIC SHIELD (VOLT lane 2026-09-30): a RECAST that blows real wires charges an absorb shield — the survivability
  // VOLT-KITE lacked (critic: the one titan that died to its city boss; weakest at 3 min). Own kit, no shared multiplier.
  // P-human sweep, seeds 1-24 x 3 biomes (72 runs each; clears /72, same tree): HEAD knobs 47 · no shield 48 ·
  // .02/.06/.15 62 (B3 fails one set) · .025/.075/.20 64, IRON GULLY 23/24 (MOLO 56, IG 18/22). Earlier tree: .03 69,
  // .04 67 — overshoot (Size I HP loss 10-14 %/min vs B8 floor 8). .025 keeps Size I at 15 %/min.
  // fb3 (8 s cooldown, one press every 8 s instead of ~5 per 8 s): P-human seeds 1-16 x 3 biomes (48 runs; MOLO same tree
  // 36/48 clears, city-boss median TTK 140 s). HEAD (1.5 s) 45/48, 114 s · 7.5 s + det 100+10 x24: 23/24, 86 s · det 40+6, wire 8,
  // shield .04/.12/.20: 33/48, 128 s but 9 deaths before the city boss · det 55+8, wire 7, .04/.12/.20: 41/48, 126 s ·
  // .035/.105/.20: 43/48, 124 s · .04/.12/.15 (ground .5): 36/48, 129 s, Size I 23 %/min, Size IV 46 %/min, 82 % real
  // RECASTs, but GATE 2 failed (see groundLife) · ground .625: 40/48, 121 s · + bossParts 1: 37/48, 134 s but a Size I
  // death · SHIPPED (ground .625, det 50+8): 40/48 (MOLO + 2.0 per 24), 126.05 s (0.90 x MOLO 139.7), Size I 23 %/min,
  // Size IV 31 %/min, 84 % of RECASTs blow real wires, 3 deaths before the city boss (MOLO 2), GATE 2 PASS.
  shieldPerWire: 0.04,     // × max HP × abilityPower per wire blown (fb3: .025 → .04, one press now carries the shield)
  shieldPressCap: 0.12,    // × max HP × abilityPower: most one RECAST can add (3 wires) (fb3: .075 → .12)
  shieldMax: 0.15,         // × max HP: RECAST never tops the pool past this (other shields may sit above it) (fb3: .2 → .15)
};

const hazBuf: Hazard[] = [];
const idBuf: number[] = [];
const hitEnemies: number[] = [];
const hitParts: number[] = [];
const hitBuildings: number[] = [];
const hitProps: number[] = [];
const pt = { x: 0, z: 0 };
const ARC_OPTS: DamageOpts = { src: 'titan', kind: 'arc' };
const DET_OPTS: DamageOpts = { src: 'titan', kind: 'wire' };
const BURST_OPTS: DamageOpts = { src: 'titan', kind: 'arc' };
const notHitEnemy = (e: Enemy) => hitEnemies.indexOf(e.id) < 0;

export function init(): Record<string, number> {
  return { wires: 0, arcHits: 0, arcN: 0 };
}

/** Auto-attack reach (m) right now — pickups.ts latches drops inside ~1.2 × this (kits/index kitReach). */
export function reach(w: World): number {
  return VOLT.arcRangeH * w.titan.height * Math.max(0.1, S(w, 'attackRange'));
}

export function step(w: World): void {
  const T = w.titan, K = T.kit;
  K.wires = titanHazards(w, 'wire', hazBuf).length;

  // ── hook: RECAST: DETONATE ──
  if (w.input.ability && T.abilityCd <= 0) detonate(w);

  // ── auto: FORK-ARC ──
  if (T.autoCd > 0) return;
  const range = VOLT.arcRangeH * T.height * Math.max(0.1, S(w, 'attackRange'));
  const first = findTarget(w, T.x, T.z, range, true);
  if (!first) { idleAuto(w); return; }
  forkArc(w, first, range);
  rearmAuto(w, autoInterval(w, VOLT.arcEveryS));
}

function markHit(t: Target): void {
  switch (t.kind) {
    case 'enemy': hitEnemies.push(t.e.id); break;
    case 'boss': hitParts.push(t.part); break;
    case 'building': hitBuildings.push(t.id); break;
    case 'prop': hitProps.push(t.id); break;
  }
}

function forkArc(w: World, first: Target, range: number): void {
  const T = w.titan;
  hitEnemies.length = 0; hitParts.length = 0; hitBuildings.length = 0; hitProps.length = 0;
  const forks = Math.min(VOLT.maxJumps, Math.max(0, Math.round(S(w, 'arcForks') + S(w, 'chains'))));
  const jumpR = VOLT.jumpRangeH * T.height * Math.max(0.1, S(w, 'chainRange'));
  ARC_OPTS.knock = knockFor(w, VOLT.arcKnock);
  const pts: number[] = [T.x, T.z];
  let dmg = titanDamage(w, VOLT.arcDmg);
  let cur: Target | null = first;
  let px = T.x, pz = T.z;
  let hits = 0;
  aimPoint(w, first, T.x, T.z, pt);
  const dir = headingOf(pt.x - T.x, pt.z - T.z);
  for (let j = 0; j <= forks && cur; j++) {
    aimPoint(w, cur, px, pz, pt);
    const tx = pt.x, tz = pt.z;
    markHit(cur);
    hitTarget(w, cur, dmg, ARC_OPTS);
    pts.push(tx, tz);
    hits++;
    px = tx; pz = tz;
    dmg *= VOLT.arcFalloff;
    if (j === forks) break;
    cur = nextTarget(w, px, pz, jumpR);
  }
  T.kit.arcHits = hits;
  if (VOLT.groundEvery > 0 && (first.kind === 'enemy' || first.kind === 'boss') && ++T.kit.arcN % VOLT.groundEvery === 0) {
    // GROUNDING: the bolt earths through the first thing it struck: a short LIVE WIRE from that point back toward VOLT-KITE,
    // so RECAST has real wires to blow without dash-weaving (titanpass T9: 31 % -> ~79 % real detonations, player-like)
    aimPoint(w, first, T.x, T.z, pt);
    const dx = T.x - pt.x, dz = T.z - pt.z, d = Math.hypot(dx, dz) || 1;
    const L = Math.min(d, VOLT.groundLenH * T.height);
    layWire(w, pt.x, pt.z, pt.x + (dx / d) * L, pt.z + (dz / d) * L, Math.max(0.1, S(w, 'wireDuration')) * VOLT.groundLife);
  }
  w.events.push({ type: 'arc', pts, kind: 'fork' });
  emitAttack(w, 'forkArc', T.x, T.z, dir, range, hits);
  faceToward(w, dir);
}

/** Next fork target from (x,z): nearest unhit enemy, else boss part, else nearest unhit building/prop. */
function nextTarget(w: World, x: number, z: number, r: number): Target | null {
  const e = nearestEnemy(w, x, z, r, notHitEnemy);
  if (e) return { kind: 'enemy', e };

  // the boss takes at most `bossParts` forks: an arc never chains through all 7 overlapping part
  // colliders (which would take the full ×(1+.85+.72+.61) chain); 2 = one follow-up jump (titanpass)
  const B = w.boss;
  if (B && B.alive && B.introT <= 0 && hitParts.length < VOLT.bossParts) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < B.parts.length; i++) {
      if (hitParts.indexOf(i) >= 0) continue;
      const p = B.parts[i];
      const d = Math.max(0, dist(x, z, p.x, p.z) - p.r);
      if (d <= r && d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0) return { kind: 'boss', part: best };
  }

  let bestB = -1, bestBD = Infinity;
  buildingsInRect(w.city, x - r, z - r, x + r, z + r, idBuf);
  for (let i = 0; i < idBuf.length; i++) {
    const id = idBuf[i];
    const b = w.city.buildings[id];
    if (!b || b.collapsed || b.alive <= 0 || hitBuildings.indexOf(id) >= 0) continue;
    const d = distToBuilding(b, x, z);
    if (d <= r && d < bestBD) { bestBD = d; bestB = id; }
  }
  let bestP = -1, bestPD = Infinity;
  propsInRect(w.city, x - r, z - r, x + r, z + r, idBuf);
  for (let i = 0; i < idBuf.length; i++) {
    const id = idBuf[i];
    const p = w.city.props[id];
    if (!p || !p.alive || hitProps.indexOf(id) >= 0) continue;
    const d = Math.max(0, dist(x, z, p.x, p.z) - propRadius(p));
    if (d <= r && d < bestPD) { bestPD = d; bestP = id; }
  }
  if (bestB >= 0 && bestBD <= bestPD) return { kind: 'building', id: bestB };
  if (bestP >= 0) return { kind: 'prop', id: bestP };
  return null;
}

/** LIVE WIRE: called by titansim when a dash finishes (actual start/end points). */
export function onDash(w: World, x0: number, z0: number, x1: number, z1: number): void {
  const T = w.titan;
  const H = T.height;
  let ex = x1, ez = z1;
  const minLen = VOLT.wireMinLenH * H;
  if (Math.hypot(x1 - x0, z1 - z0) < minLen) { ex = x0 + T.dashDirX * minLen; ez = z0 + T.dashDirZ * minLen; }
  layWire(w, x0, z0, ex, ez, Math.max(0.1, S(w, 'wireDuration')));
}

/** One LIVE WIRE capsule (dash wires and GROUNDING wires share the cap, the dps and the look). */
function layWire(w: World, x0: number, z0: number, x1: number, z1: number, life: number): void {
  const T = w.titan;
  const H = T.height;
  const r = VOLT.wireRH * H * Math.max(0.1, S(w, 'area'));
  makeRoom(titanHazards(w, 'wire', hazBuf), VOLT.wireCap);
  spawnHazard(w, {
    owner: 'titan', kind: 'wire',
    shape: { k: 'capsule', x0, z0, x1, z1, r },
    life,
    dps: titanDamage(w, VOLT.wireDps) * Math.max(0, S(w, 'wireDamage')),
    data: { life0: life, h: H },
  });
  T.kit.wires = titanHazards(w, 'wire', hazBuf).length;
}

function detonate(w: World): void {
  const T = w.titan;
  const H = T.height;
  const area = Math.max(0.1, S(w, 'area'));
  const power = Math.max(0, S(w, 'abilityPower'));
  const wires = titanHazards(w, 'wire', hazBuf);
  T.abilityCd = hookCooldown(w, VOLT.detCdS);
  emitAbility(w, 'voltkite', power);
  if (wires.length > 0) {
    const pts: number[] = [];
    const r = VOLT.detRH * H * area;
    DET_OPTS.knock = knockFor(w, VOLT.detKnock);
    let hits = 0;
    for (let i = 0; i < wires.length; i++) {
      const h = wires[i];
      const s = h.shape;
      let x0: number, z0: number, x1: number, z1: number;
      if (s.k === 'capsule') { x0 = s.x0; z0 = s.z0; x1 = s.x1; z1 = s.z1; }
      else if (s.k === 'circle') { x0 = x1 = s.x; z0 = z1 = s.z; }
      else { h.alive = false; continue; }
      const remaining = Math.max(0, h.life - h.t);
      const dmg = titanDamage(w, VOLT.detDmg * power + VOLT.detPerSec * remaining);
      const shape: Shape = { k: 'capsule', x0, z0, x1, z1, r };
      hits += damageArea(w, shape, dmg, DET_OPTS);
      pts.push(x0, z0, x1, z1);
      h.alive = false;
    }
    w.events.push({ type: 'wireDetonate', pts });
    staticShield(w, pts.length / 4, power);
  } else {
    const r = VOLT.burstRH * H * area;
    BURST_OPTS.knock = knockFor(w, VOLT.burstKnock);
    const hits = damageArea(w, { k: 'circle', x: T.x, z: T.z, r }, titanDamage(w, VOLT.burstDmg * power), BURST_OPTS);
    w.events.push({ type: 'explosion', x: T.x, z: T.z, r, kind: 'arc' });
  }
  T.kit.wires = 0;
}

/** STATIC SHIELD: n wires blown -> absorb pool += min(pressCap, perWire * n) * power * maxHp, topped at shieldMax * maxHp. */
function staticShield(w: World, n: number, power: number): void {
  const T = w.titan, U = w.upgrades;
  if (!(n > 0) || !(T.maxHp > 0)) return;
  const add = Math.min(VOLT.shieldPressCap, VOLT.shieldPerWire * n) * power * T.maxHp;
  const cap = VOLT.shieldMax * T.maxHp;
  if (!(add > 0) || U.shield >= cap) return;
  U.shield = Math.min(U.shield + add, cap);
}
