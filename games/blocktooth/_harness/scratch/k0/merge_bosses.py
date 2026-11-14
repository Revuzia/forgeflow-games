import sys
p = 'src/ai/bosses/index.ts'
s = open(p, encoding='utf-8').read()


def rep(old, new, cnt=1):
    global s
    n = s.count(old)
    if n != cnt:
        print('MISMATCH', n, repr(old[:90]))
        sys.exit(1)
    s = s.replace(old, new)


# ── header + imports ──
rep("""//   * "Never two unreadable telegraphs stacked on the same spot at once": bossTelegraph() delays
//     a new tell that would land on the same spot within 0.45 s of a pending one.
""", """//   * "Never two unreadable telegraphs stacked on the same spot at once": bossTelegraph() delays
//     a new tell that would land on the same spot within 0.45 s of a pending one.
//
// GATEKEEPERS (§3.0, §7.2, §7.3 — lane K0): the gatekeepers (STENCIL-1 / CORDON-2 / SWITCHBOARD-5) are
// bosses in this framework, in the same w.boss slot, told apart by BossState.role ('main' | 'gate') and
// slot (the Size the fight guards; 0 = an EXTENDED COVERAGE rematch). Gate-only rules live here:
// spawnGate (the §2.3 entry, GATES.introS, no bossSpawned / run.phase change), the settled-height bossH
// latch, gateWindup (slow-aware, pace-scaled max clamp), volleyPoints (walkable volley exits), laneClearLen,
// gateUnstick (DETOUR → RAMMING THROUGH → cut-off), gateCrushTier + city collision, gateAddIds, the
// per-second damage cap, stagger length / phase alert / fatigue by role, and defeat() handing the breach
// to meta/gates.ts flushGateBreach (gates.breachDue) so it runs at the END of the kill tick.
""")
rep("""import type { BossId, BossPart, BossState, DamageOpts, Shape, Telegraph, Tier, World } from '../../core/types.ts';
import { BOSS_DMG_MUL, BOSS_FATIGUE, BOSS_HP_SCALE, BOSS_KIND_MUL, BOSS_PHASE_DMG_MUL, RANKS, titanSpeed } from '../../core/config.ts';""",
"""import type { BossId, BossPart, BossState, DamageOpts, GateId, GateSlot, MainBossId, Shape, Telegraph, Tier, World } from '../../core/types.ts';
import { GATE_IDS } from '../../core/types.ts';
import {
  BOSS_DMG_MUL, BOSS_FATIGUE, BOSS_HP_SCALE, BOSS_KIND_MUL, BOSS_PHASE_DMG_MUL, CAMERA, GATES, RANKS, RANK_LEVELS, spawnView,
  titanHeightAt, titanSpeed,
} from '../../core/config.ts';""")
rep("""import * as parkade6 from './parkade6.ts';
import { endlessBossDmgMul } from '../../meta/endless.ts';
""", """import * as parkade6 from './parkade6.ts';
import * as stencil1 from './stencil1.ts';
import * as cordon2 from './cordon2.ts';
import * as switchboard5 from './switchboard5.ts';
import { endlessBossDmgMul } from '../../meta/endless.ts';
import { gateDmgMul, gateHpFor } from '../../meta/gates.ts';
""")
rep("""const MODS: Record<BossId, BossModule> = { caisson4, irongully, parkade6 };""",
    """const MODS: Record<BossId, BossModule> = { caisson4, irongully, parkade6, stencil1, cordon2, switchboard5 };""")

# ── bossH: gate latch ──
rep("""export function bossH(w: World, b: BossState): number {
  const T = w.titan;
  if (!(b.data.H > 0) || b.data.Hrank !== T.rank) {
    b.data.H = Math.max(Number.isFinite(T.height) ? T.height : 0, RANKS[T.rank].height);
    b.data.Hrank = T.rank;
  }
  return b.data.H;
}""", """export function bossH(w: World, b: BossState): number {
  const T = w.titan;
  if (!(b.data.H > 0) || b.data.Hrank !== T.rank) {
    // GATEKEEPERS §3.0: a gatekeeper latches the SETTLED ceiling (never a mid-tween height)
    b.data.H = b.role === 'gate'
      ? gateSettledH(w)
      : Math.max(Number.isFinite(T.height) ? T.height : 0, RANKS[T.rank].height);
    b.data.Hrank = T.rank;
  }
  return b.data.H;
}

/** The titan's settled body height for its rank and level (m): max(height, titanHeightAt(rank, level)). */
export function gateSettledH(w: World): number {
  const T = w.titan;
  const h = titanHeightAt(T.rank, T.level);
  return Math.max(Number.isFinite(T.height) ? T.height : 0, Number.isFinite(h) ? h : RANKS[T.rank].height);
}""")

# ── bossHostile × gateDmgMul ──
rep("""  return base * BOSS_DMG_MUL * (BOSS_PHASE_DMG_MUL[ph] ?? 1) * RANKS[w.titan.rank].hpMul * endlessBossDmgMul(w);   // v2: rematch ramp (1 outside endless)""",
    """  return base * BOSS_DMG_MUL * (BOSS_PHASE_DMG_MUL[ph] ?? 1) * RANKS[w.titan.rank].hpMul * endlessBossDmgMul(w)   // v2: rematch ramp (1 outside endless)
    * gateDmgMul(w);   // GATEKEEPERS §2.4: containment pressure (1 for the city boss)""")

# ── baseBoss: role / slot ──
rep("""    parts, subtitle: bossSubtitle(id, null),
    data: { t: 0, speed: 0, walk: 0, meterIdle: 0, crushT: 0, kvx: 0, kvz: 0, last: -1, last2: -1, leash: 0, charge: 0, breath: 0, flash: 0 },
  };""", """    parts, subtitle: bossSubtitle(id, null),
    data: { t: 0, speed: 0, walk: 0, meterIdle: 0, crushT: 0, kvx: 0, kvz: 0, last: -1, last2: -1, leash: 0, charge: 0, breath: 0, flash: 0 },
    // GATEKEEPERS §7.3: every rig starts as a city boss of the Size V fight; spawnGate / spawnBoss set the rest
    role: 'main', slot: 4,
  };""")

# ── addMeter: stagger length by role ──
rep("""    b.meter = 0;
    b.staggerT = STAGGER_S;""", """    b.meter = 0;
    b.staggerT = b.role === 'gate' ? GATES.staggerS : STAGGER_S;   // GATEKEEPERS §3.0""")

# ── pushTitanOut: skipped during STRIPE RUN ──
rep("""  const T = w.titan;
  const p = b.parts[0];
  if (!p || !T.alive) return;
  if (keep > 0) {""", """  const T = w.titan;
  const p = b.parts[0];
  if (!p || !T.alive) return;
  if (b.data.raceT > 0) return;   // GATEKEEPERS §7.3: STENCIL-1's STRIPE RUN drives past / through the titan
  if (keep > 0) {""")

# ── crushUnder: crush tier for gates ──
rep("""function crushUnder(w: World, b: BossState): void {
  b.data.crushT -= w.dt;
  if (b.data.crushT > 0) return;
  b.data.crushT = CRUSH_EVERY;
  const c = w.city;""", """function crushUnder(w: World, b: BossState): void {
  b.data.crushT -= w.dt;
  if (b.data.crushT > 0) return;
  b.data.crushT = CRUSH_EVERY;
  const c = w.city;
  const tier = gateCrushTier(b);   // GATEKEEPERS §3.0: a gatekeeper only crushes up to its crush tier (city bosses 4)""")
rep("""      const bd = c.buildings[idBuf[k]];
      if (!bd || bd.collapsed) continue;
      const qx = clamp(p.x, bd.x - bd.w / 2, bd.x + bd.w / 2), qz = clamp(p.z, bd.z - bd.d / 2, bd.z + bd.d / 2);""",
    """      const bd = c.buildings[idBuf[k]];
      if (!bd || bd.collapsed || bd.tier > tier) continue;
      const qx = clamp(p.x, bd.x - bd.w / 2, bd.x + bd.w / 2), qz = clamp(p.z, bd.z - bd.d / 2, bd.z + bd.d / 2);""")
rep("""      const pr = c.props[idBuf[k]];
      if (pr && pr.alive && dist(pr.x, pr.z, p.x, p.z) <= r) damageProp(w, pr.id, 1e6, crushOpts);""",
    """      const pr = c.props[idBuf[k]];
      if (pr && pr.alive && pr.tier <= tier && dist(pr.x, pr.z, p.x, p.z) <= r) damageProp(w, pr.id, 1e6, crushOpts);""")

# ── checkPhase: alert main only ──
rep("""    w.events.push({ type: 'bossPhase', phase: b.phase });
    w.events.push({ type: 'alert', key: b.phase === 2 ? 'bossPhase2' : 'bossPhase3' });""",
    """    w.events.push({ type: 'bossPhase', phase: b.phase });
    // GATEKEEPERS §3.0: no full-width phase banner for gatekeepers (the nameplate's pips animate instead)
    if (b.role === 'main') w.events.push({ type: 'alert', key: b.phase === 2 ? 'bossPhase2' : 'bossPhase3' });""")

# ── defeat: events by role + the breach at the end of the tick ──
rep("""  cancelBossTells(w, false);
  releaseLeash(w, b);
  w.events.push({ type: 'bossDefeated', x: b.x, z: b.z });
}""", """  cancelBossTells(w, false);
  releaseLeash(w, b);
  // GATEKEEPERS §2.5 / §4.3: the breach runs in meta/gates.ts flushGateBreach at the END of this tick
  // (a kill can land mid-attack: breaching here would recompute stats inside a kit's hit loop)
  if (b.role === 'gate') {
    const gate = b.id as GateId;
    w.events.push({ type: 'gateDefeated', gate, slot: b.slot, x: b.x, z: b.z, fightS: b.data.t ?? 0, rematch: b.slot === 0 });
    if (b.slot >= 1 && b.slot <= 3) w.gates.breachDue = b.slot;
  } else {
    w.events.push({ type: 'bossDefeated', x: b.x, z: b.z });
    if (!w.endless && b.slot === 4) w.gates.breachDue = 4;
  }
}""")

# ── spawnBoss narrowed + slot ──
rep("""export function spawnBoss(w: World, id: BossId): void {
  if (w.boss && w.boss.alive) return;
  const mod = MODS[id];
  if (!mod) return;
  const b = mod.create(w);""", """export function spawnBoss(w: World, id: MainBossId): void {
  if (w.boss && w.boss.alive) return;
  const mod = MODS[id];
  if (!mod) return;
  const b = mod.create(w);
  b.role = 'main';
  b.slot = w.endless ? 0 : 4;                // GATEKEEPERS §7.3: the Size V breach it guards (0 = a rematch)""")

# ── stepBoss: fatigue by role, gate city collision, add pruning ──
rep("""  applyShove(w, b);
  // structural fatigue (config BOSS_FATIGUE): the long fight wears the rig down
  if (T.alive && b.introT <= 0) {
    b.data.fightT = (b.data.fightT ?? 0) + dt;
    const over = b.data.fightT - BOSS_FATIGUE.startS;
    const rate = over > 0 ? Math.min(BOSS_FATIGUE.maxPerS, BOSS_FATIGUE.rampPerS * over) : 0;""", """  applyShove(w, b);
  // structural fatigue (config BOSS_FATIGUE): the long fight wears the rig down. GATEKEEPERS §2.4: a
  // gatekeeper runs on its own clock, max(engagedS, 0.5 × liveFightS), with GATES.fatigue
  if (T.alive && b.introT <= 0) {
    b.data.fightT = (b.data.fightT ?? 0) + dt;
    let rate: number;
    if (b.role === 'gate') {
      const clock = Math.max(w.gates.engagedS, 0.5 * w.gates.liveFightS);
      const F = GATES.fatigue, over = clock - F.startS;
      rate = over > 0 ? Math.min(F.maxPerS, F.rampPerS * over) : 0;
    } else {
      const over = b.data.fightT - BOSS_FATIGUE.startS;
      rate = over > 0 ? Math.min(BOSS_FATIGUE.maxPerS, BOSS_FATIGUE.rampPerS * over) : 0;
    }""")
rep("""  if (!Number.isFinite(b.heading)) b.heading = b.pheading;
  refreshParts(b);
  if (T.alive) pushTitanOut(w, b, mod.keepOut ? mod.keepOut(w, b) : 0, mod.noseOut ? mod.noseOut(w, b) : null);""",
    """  if (!Number.isFinite(b.heading)) b.heading = b.pheading;
  refreshParts(b);
  if (b.role === 'gate') {
    gateCityCollide(w, b);                   // GATEKEEPERS §3.0: a 7 m cart must not drive through a 12 m shop
    if (w.tick % 30 === 0) pruneGateAdds(w, b);
  }
  if (T.alive) pushTitanOut(w, b, mod.keepOut ? mod.keepOut(w, b) : 0, mod.noseOut ? mod.noseOut(w, b) : null);""")

# ── damageBoss: per-second cap + lastHitT for gates ──
rep("""  let d = dmg * (BOSS_KIND_MUL[opts.kind] ?? 1) * p.hpMul * (b.staggerT > 0 ? 2 : 1);
  if (d > b.hp) d = b.hp;
  b.hp -= d;""", """  let d = dmg * (BOSS_KIND_MUL[opts.kind] ?? 1) * p.hpMul * (b.staggerT > 0 ? 2 : 1);
  if (b.role === 'gate') {
    // GATEKEEPERS §3.0: titan damage per TUMBLING 1 s window ≤ GATES.dpsCapFrac × maxHp (bossUltHit exempt)
    const G = w.gates;
    b.data.lastHitT = w.t;                   // engagement rule (b), §2.4
    if (!(w.t < G.dpsWinT + 1)) { G.dpsWinT = w.t; G.dpsWin = 0; }
    const room = Math.max(0, GATES.dpsCapFrac * b.maxHp - G.dpsWin);
    if (d > room) d = room;
    if (!(d > 0)) return;
  }
  if (d > b.hp) d = b.hp;
  if (b.role === 'gate') w.gates.dpsWin += d;
  b.hp -= d;""")

# ── the gate toolkit (appended) ──
s = s.rstrip('\n') + """

// ═══════════════════════════════ GATEKEEPERS toolkit (§3.0, §7.2 ModBossesAddV3 — lane K0) ═══════════════════════════════
const PUSH_GATE = { x: 0, z: 0, bumpTier: -1 };
const gateBuf: number[] = [];
const CAM_K = 2 * Math.tan((CAMERA.fovDeg * Math.PI) / 360);

/** The spawn ring radius (m) — the same formula as ai/enemies.ts ringRadius (max(14, spawnView d × k)),
 *  inlined so the boss toolkit does not import the enemy module. ≈ the edge of the default-zoom view. */
export function gateRing(w: World): number {
  const r = spawnView(w).d * CAM_K;
  return Number.isFinite(r) ? Math.max(14, r) : 14;
}

/** A gatekeeper's home slot (1..3) by id. */
export function gateHomeSlot(id: GateId): 1 | 2 | 3 {
  const i = GATE_IDS.indexOf(id);
  return (i >= 0 ? i + 1 : 1) as 1 | 2 | 3;
}

/** A gatekeeper's authored height (m): the ceiling of the Size it holds, titanHeightAt(slot − 1, RANK_LEVELS[slot])
 *  = 3.125 / 10.77 / 25.6 m. The view scales the rig by b.data.H / this. */
export function gateHomeH(id: GateId): number {
  const s = gateHomeSlot(id);
  return titanHeightAt((s - 1) as 0 | 1 | 2, RANK_LEVELS[s]);
}

/** gatekeeper crush tier: GATES.crushTier by id at home, 4 for a rematch (slot 0) and during RAMMING THROUGH;
 *  the city bosses crush everything (4). Never indexed by b.slot. */
export function gateCrushTier(b: BossState): 0 | 1 | 2 | 3 | 4 {
  if (b.role !== 'gate') return 4;
  if (b.slot === 0 || b.data.ramT > 0) return 4;
  return GATES.crushTier[b.id as GateId] ?? 4;
}

/**
 * fairWindup for gatekeepers (§3.0): escape `escapeH` titan heights; the walk divides by the SLOWED walk
 * (titanWalk × clamp(slowMul, 0.1, 1) while slowT > 0, as titansim moves the body), and the `max` clamp
 * opens by max(1, vHome / vNow) — vHome = titanSpeed(Hhome) / Hhome of the gatekeeper's home Size, vNow
 * = that slowed walk / H. The `min` clamp is never scaled. Already phase-scaled (ESCAPE_K): spawn the tell
 * with bossTelegraph(w, spec, false).
 */
export function gateWindup(w: World, b: BossState, escapeH: number, min: number, max: number): number {
  const T = w.titan;
  const H = bossH(w, b);
  const slow = T.slowT > 0 ? clamp(Number.isFinite(T.slowMul) ? T.slowMul : 1, 0.1, 1) : 1;
  const v = Math.max(1e-3, titanWalk(w) * slow);
  const k = ESCAPE_K[b.phase] ?? 1;
  const e = Math.max(0, Number.isFinite(escapeH) ? escapeH : 0) * H;
  const raw = REACT_S + ACCEL_LOSS_S + (e / v) * k;
  const Hh = b.role === 'gate' ? gateHomeH(b.id as GateId) : H;
  const vHome = Hh > 0 ? titanSpeed(Hh) / Hh : 1;
  const vNow = H > 0 ? v / H : vHome;
  const maxEff = max * Math.max(1, vNow > 0 ? vHome / vNow : 1);
  return clamp(raw, min, Math.max(min, maxEff));
}

/**
 * Volley tell centres with a walkable exit (§3.0). out[0..1] = the lead point; every secondary sits BEYOND
 * the lead along the volley axis (rig → lead), inside ±60° of it, ≥ 2 (r + R) + 0.1 H from the lead and
 * from each other (rings at 1× and 2× that spacing: 3 then 5 slots). When the lead is closer to the rig
 * than keepOut + (r + R) + 0.2 H the axis turns 90° (tangential, away from the titan's motion; rng.boss
 * when it stands still). Points outside the city bounds are dropped. Returns the number of points written
 * (x, z pairs; ≤ count and ≤ out.length / 2).
 */
const VOLLEY_SLOTS: readonly (readonly [number, number])[] = [
  [1, 0], [1, -60], [1, 60], [2, -30], [2, 30], [2, 0], [2, -60], [2, 60],
];
export function volleyPoints(w: World, b: BossState, leadX: number, leadZ: number, count: number, r: number, out: Float32Array): number {
  const n = Math.max(0, Math.min(Math.floor(count), out.length >> 1, VOLLEY_SLOTS.length + 1));
  if (n === 0) return 0;
  const T = w.titan, Bd = w.city.bounds;
  const H = bossH(w, b), R = T.radius > 0 ? T.radius : 0.42 * H;
  out[0] = leadX; out[1] = leadZ;
  let ax = leadX - b.x, az = leadZ - b.z;
  const dl = Math.hypot(ax, az);
  if (dl > 1e-6) { ax /= dl; az /= dl; } else { ax = Math.sin(b.heading); az = Math.cos(b.heading); }
  const mod = MODS[b.id];
  const keep = mod && mod.keepOut ? mod.keepOut(w, b) : (b.parts[0] ? b.parts[0].r : 0);
  if (dl < keep + (r + R) + 0.2 * H) {
    // tangential axis, toward the side the titan is not moving
    const n1x = az, n1z = -ax;
    const vx = Number.isFinite(T.vx) ? T.vx : 0, vz = Number.isFinite(T.vz) ? T.vz : 0;
    const still = Math.hypot(vx, vz) < 0.1 * titanWalk(w);
    const sgn = still ? (w.rng.boss() < 0.5 ? 1 : -1) : (n1x * vx + n1z * vz > 0 ? -1 : 1);
    ax = n1x * sgn; az = n1z * sgn;
  }
  const sp = (2 * (r + R) + 0.1 * H) * 1.001;
  let k = 1;
  for (let i = 0; i < VOLLEY_SLOTS.length && k < n; i++) {
    const [ring, deg] = VOLLEY_SLOTS[i];
    const a = (deg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const dx = ax * ca - az * sa, dz = ax * sa + az * ca;
    const x = leadX + dx * sp * ring, z = leadZ + dz * sp * ring;
    if (x < Bd.minX || x > Bd.maxX || z < Bd.minZ || z > Bd.maxZ) continue;
    out[2 * k] = x; out[2 * k + 1] = z;
    k++;
  }
  return k;
}

/**
 * Free length (m) along (dirX, dirZ) from (x, z) before a building ABOVE the live rig's crush tier, for a
 * body of radius r: ray-marched at 0.5 H steps with buildingsInRect; `len` when nothing blocks.
 */
export function laneClearLen(w: World, x: number, z: number, dirX: number, dirZ: number, len: number, r: number): number {
  const b = w.boss;
  const H = b ? bossH(w, b) : Math.max(1, w.titan.height);
  const tier = b ? gateCrushTier(b) : 4;
  const L = Math.max(0, Number.isFinite(len) ? len : 0);
  if (tier >= 4 || L <= 0) return L;
  const m = Math.hypot(dirX, dirZ);
  if (!(m > 1e-9)) return 0;
  const fx = dirX / m, fz = dirZ / m, rr = Math.max(0, r);
  const step = Math.max(0.5, 0.5 * H);
  const c = w.city;
  for (let s = step; s < L + step; s += step) {
    const d = Math.min(s, L);
    const px = x + fx * d, pz = z + fz * d;
    buildingsInRect(c, px - rr, pz - rr, px + rr, pz + rr, gateBuf);
    for (let i = 0; i < gateBuf.length; i++) {
      const bd = c.buildings[gateBuf[i]];
      if (!bd || bd.collapsed || bd.tier <= tier) continue;
      const qx = clamp(px, bd.x - bd.w / 2, bd.x + bd.w / 2), qz = clamp(pz, bd.z - bd.d / 2, bd.z + bd.d / 2);
      if (Math.hypot(px - qx, pz - qz) <= rr) { gateBuf.length = 0; return Math.max(0, d - step); }
    }
    gateBuf.length = 0;
    if (d >= L) break;
  }
  return L;
}

/** The §2.3 entry / §2.4 cut-off point: entryRingMul × the spawn ring on the titan's heading side (±30°,
 *  rng.boss; the opposite side when that is out of bounds), facing the titan. */
export function gateEntry(w: World, out: { x: number; z: number; heading: number }): void {
  const T = w.titan, Bd = w.city.bounds;
  const d = GATES.entryRingMul * gateRing(w);
  let a = T.heading + (w.rng.boss() - 0.5) * (Math.PI / 3);
  let x = T.x + Math.sin(a) * d, z = T.z + Math.cos(a) * d;
  if (x < Bd.minX || x > Bd.maxX || z < Bd.minZ || z > Bd.maxZ) {
    a += Math.PI;
    x = T.x + Math.sin(a) * d; z = T.z + Math.cos(a) * d;
  }
  out.x = clamp(x, Bd.minX, Bd.maxX);
  out.z = clamp(z, Bd.minZ, Bd.maxZ);
  out.heading = Math.atan2(T.x - out.x, T.z - out.z);
}

/** CUTTING YOU OFF (§2.4): the live gatekeeper re-enters off-screen ahead of the titan (no intro, no
 *  invulnerability); pushes `gateReposition`. Lane K1a's stepGates calls it for the far rule; gateUnstick
 *  for a third stuck failure while the rig is off-screen. */
const ENTRY = { x: 0, z: 0, heading: 0 };
export function gateReenter(w: World, b: BossState): void {
  gateEntry(w, ENTRY);
  b.x = b.px = ENTRY.x; b.z = b.pz = ENTRY.z;
  b.heading = b.pheading = ENTRY.heading;
  b.data.detourT = 0; b.data.ramT = 0; b.data.stuckN = 0; b.data.stuckT = 0;
  b.data.stuckD = Math.hypot(w.titan.x - b.x, w.titan.z - b.z);
  refreshParts(b);
  w.events.push({ type: 'gateReposition', x: b.x, z: b.z });
}

/**
 * The stuck rule (§3.0), called by every gatekeeper's move step while it HUNTS (the titan past its band
 * max). Every GATES.stuck.checkS the centre distance must have dropped by progressH × H, else: 1st failure
 * DETOUR (b.data.detourT = detourS along b.data.detourX / detourZ, the best of 8 headings: a clear 2 H lane
 * of ≥ 1.5 H first, then the largest cosine toward the titan), 2nd RAMMING THROUGH (b.data.ramT = ramS: crush
 * tier 4, no city collision, drive straight at the titan; `gateRam`), 3rd a cut-off re-entry if the rig is
 * off-screen, else another ram. Progress resets the count. The module steers by detourT / ramT.
 */
export function gateUnstick(w: World, b: BossState): void {
  const T = w.titan, d = b.data, dt = w.dt, S = GATES.stuck;
  const H = bossH(w, b);
  const dist = Math.hypot(T.x - b.x, T.z - b.z);
  if (d.ramT > 0) d.ramT = Math.max(0, d.ramT - dt);
  if (d.detourT > 0) d.detourT = Math.max(0, d.detourT - dt);
  // a fresh hunt (first call, or the rig was inside its band for a while): new checkpoint
  if (!(d.stuckLastT !== undefined && w.t - d.stuckLastT <= 2.5 * dt)) { d.stuckT = 0; d.stuckD = dist; d.stuckN = 0; }
  d.stuckLastT = w.t;
  d.stuckT = (d.stuckT ?? 0) + dt;
  if (d.stuckT < S.checkS) return;
  d.stuckT = 0;
  const progressed = (d.stuckD ?? dist) - dist >= S.progressH * H;
  d.stuckD = dist;
  if (progressed) { d.stuckN = 0; return; }
  d.stuckN = (d.stuckN ?? 0) + 1;
  if (d.stuckN === 1) {
    const r = b.parts[0] ? b.parts[0].r : 0.5 * H;
    const tx = T.x - b.x, tz = T.z - b.z, tm = Math.hypot(tx, tz) || 1;
    let bestS = -Infinity, bx = tx / tm, bz = tz / tm;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4, hx = Math.sin(a), hz = Math.cos(a);
      const clear = laneClearLen(w, b.x, b.z, hx, hz, 2 * H, r) >= 1.5 * H ? 1 : 0;
      const sc = clear * 10 + (hx * tx + hz * tz) / tm;
      if (sc > bestS) { bestS = sc; bx = hx; bz = hz; }
    }
    d.detourX = bx; d.detourZ = bz; d.detourT = S.detourS;
  } else if (d.stuckN === 2 || dist <= gateRing(w)) {
    d.detourT = 0; d.ramT = S.ramS;
    w.events.push({ type: 'gateRam', x: b.x, z: b.z });
  } else {
    gateReenter(w, b);
  }
}

/** The live gatekeeper's adds (SWITCHBOARD-5 crews, CORDON-2 squads): ids registered by the module at
 *  spawn (registerGateAdd), pruned of dead ones every second. Read-only view; [] when none. */
const GATE_ADDS = new WeakMap<BossState, number[]>();
const NO_ADDS: readonly number[] = [];
export function gateAddIds(w: World): readonly number[] {
  const b = w.boss;
  if (!b || !b.alive || b.role !== 'gate') return NO_ADDS;
  return GATE_ADDS.get(b) ?? NO_ADDS;
}
/** A gatekeeper module registers an enemy it summoned as one of its adds. */
export function registerGateAdd(b: BossState, id: number): void {
  let a = GATE_ADDS.get(b);
  if (!a) { a = []; GATE_ADDS.set(b, a); }
  if (!a.includes(id)) a.push(id);
}
function pruneGateAdds(w: World, b: BossState): void {
  const a = GATE_ADDS.get(b);
  if (!a || a.length === 0) return;
  let j = 0;
  for (let i = 0; i < a.length; i++) {
    const id = a[i];
    let alive = false;
    for (let k = 0; k < w.enemies.length; k++) { const e = w.enemies[k]; if (e.id === id) { alive = e.alive; break; } }
    if (alive) a[j++] = id;
  }
  a.length = j;
}

/** Gatekeeper city collision (§3.0): parts[0] is pushed out of buildings above the crush tier with
 *  resolveCircleVsCity, like the titan; skipped while RAMMING THROUGH (crush tier 4). */
function gateCityCollide(w: World, b: BossState): void {
  const tier = gateCrushTier(b);
  const p = b.parts[0];
  if (tier >= 4 || !p) return;
  if (resolveCircleVsCity(w.city, p.x, p.z, p.r, tier as Tier, PUSH_GATE)) {
    if (Number.isFinite(PUSH_GATE.x) && Number.isFinite(PUSH_GATE.z)) {
      b.x += PUSH_GATE.x - p.x; b.z += PUSH_GATE.z - p.z;
      const Bd = w.city.bounds;
      b.x = clamp(b.x, Bd.minX, Bd.maxX); b.z = clamp(b.z, Bd.minZ, Bd.maxZ);
      refreshParts(b);
    }
  }
}

/**
 * Field a gatekeeper (meta/gates.ts stepGates at the lock's dueT, EXTENDED COVERAGE rematches, the dev
 * cheat). role 'gate'; slot = its home slot (0 while w.endless: a rematch guards nothing); HP gateHpFor(id,
 * titan rank, rematch); GATES.introS walk-in from the §2.3 entry; the perk DEFERRED MAINTENANCE starts the
 * meter at 0.25. No director.bossSpawned, no run.phase change; pushes `gateSpawn`. No-op while a boss is alive.
 */
const GATE_ENTRY = { x: 0, z: 0, heading: 0 };
export function spawnGate(w: World, id: GateId, rematch: number): void {
  if (w.boss && w.boss.alive) return;
  const mod = MODS[id];
  if (!mod) return;
  const slot: GateSlot = w.endless ? 0 : gateHomeSlot(id);
  const b = mod.create(w);
  b.role = 'gate';
  b.slot = slot;
  const n = Math.max(0, Math.floor(Number.isFinite(rematch) ? rematch : 0));
  const hp = gateHpFor(id, w.titan.rank, n);
  b.hp = hp; b.maxHp = hp;
  b.phase = 1; b.staggerT = 0; b.attack = null; b.attackT = 0;
  b.meter = w.meta.perk === 'perk_deferred_maintenance' ? 0.25 : 0;
  b.introT = GATES.introS;
  b.subtitle = bossSubtitle(id, null);
  gateEntry(w, GATE_ENTRY);
  b.x = b.px = GATE_ENTRY.x; b.z = b.pz = GATE_ENTRY.z;
  b.heading = b.pheading = GATE_ENTRY.heading;
  b.data.H = 0;
  bossH(w, b);                               // settled-height latch (role is set)
  refreshParts(b);
  w.boss = b;
  const G = w.gates;
  G.dpsWin = 0; G.dpsWinT = -1;
  w.events.push({ type: 'gateSpawn', gate: id, slot, rematch: slot === 0 });
}
"""
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('ok bosses/index.ts')
