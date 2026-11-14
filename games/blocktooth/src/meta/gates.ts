// BLOCKTOOTH — the size gates: 3 gatekeepers + the city boss at Size IV (GATEKEEPERS.md §2, §4, §7).
// SIM: THREE-free, DOM-free, deterministic (no clock; no RNG of its own — the only rolls are the ones
// spawnGate / spawnBoss / gateReenter already make from world.rng.boss).
//
// Lane K1a GATE LOOP. The loop, per Size s = gates.unlocked + 1 (RANK_LEVELS = [1, 7, 16, 27, 35]):
//   LOCK      titansim grow() reaches RANK_LEVELS[s] → checkGateLock → lockGate(w, s, false): the rank-up does
//             not happen; pending = s, dueT = max(t + summonDelayS, lastBreachT + chainGapS) (slot 4 also
//             ≥ gates.mainEarliestT, §4.1); `gateLocked`, alert gate1/2/3. The time caps (§2.7) lock the same
//             way at GATES.capS[s] with capped = true when the level never came.
//   ARRIVAL   at dueT with no fight alive: spawnGate (slot 1..3) or spawnBoss (slot 4, the city boss);
//             pending → active.
//   HOLD      while pending/active the Size is capped (grow() never ranks past gates.unlocked); the catch-up
//             is off during fights and the climax is governed (titansim paceMul, K0).
//   FIGHT     §2.4 bookkeeping every tick of a live gatekeeper (home or rematch): fightS, liveFightS (after
//             the intro), engaged / ignored seconds (proximity to band max + 0.5 H, or a hit on the rig or
//             its adds within 5 s), containment pressure 0–3 (home only; rises only while NOT engaged), the
//             cut-off re-entry (farther than 2.2 × spawnRing for 4 s). Fatigue reads these (bosses/index.ts).
//   KILL      defeat() → gates.breachDue → flushGateBreach (the end of the kill tick) → onGateDefeated:
//             breachTo (the real MASS BREACH, top-up on a capped kill), a chest, +UPROAR, CALL DROPPED,
//             then checkGateLock (a chained lock on the same tick).
//   FINALE    the city boss's kill → onMainDefeated: breachTo(4), finaleT = finaleS, hostiles cancelled and
//             stunned, titan invulnerable; alert `finale` 2.5 s in; endFinale (timer or skip) → finaleDone →
//             checkRunEnd v3 clears the run with endT = the kill.
// EXTENDED COVERAGE rematches (slot 0) are scheduled by meta/endless.ts; here they only get the fight
// bookkeeping (fatigue clock, cut-off), never pressure, never a breach.
//
// Tick order (core/world.ts): … stepTitan → stepDirector → stepGates → stepEndless → stepEnemies →
// stepBoss … → stepTally → flushGateBreach → peakRank → checkRunEnd.

import { hypot } from '../core/detmath.ts';
import type { BossState, GateId, GatesState, GateSlot, RankIndex, World } from '../core/types.ts';
import { GATE_IDS, GATE_OF_SLOT } from '../core/types.ts';
import { ENDLESS, GATES, GATE_HP_AT_RANK, GATE_HP_MUL, VS } from '../core/config.ts';
import { BIOMES } from '../data/biomes.ts';
// The boss toolkit and titansim are imported as NAMESPACES (members read at call time): probe_combat replaces
// both modules with recording stubs that export only the names combat uses, and this module sits in its import
// graph, so a named import of a gate-only export would fail to link there. The ultimate specifier is spelled
// '../meta/ultimate.ts' for the same reason (the stub hook matches that path).
import * as Bosses from '../ai/bosses/index.ts';
import * as Titan from '../titans/titansim.ts';
import { spawnPickup } from '../combat/pickups.ts';
import { addUproar } from '../meta/ultimate.ts';

/** The band max (× H, centre to centre) each gatekeeper hunts from (§2.4; §3.1–§3.3). */
export const GATE_BAND_MAX: Readonly<Record<GateId, number>> = { stencil1: 6.0, cordon2: 3.5, switchboard5: 4.5 };
/** CALL DROPPED: SWITCHBOARD-5's / CORDON-2's surviving adds are stunned this long on the kill (§2.5 step 4). */
const CALL_DROPPED_S = 3;
/** the finale's `alert finale` fires this long after the kill (§4.3: at finaleS − 7.5 s) */
const FINALE_ALERT_S = 2.5;

/** World.gates at run start: every Size above I is closed (the one-line switch that turns the gates on). */
export function createGates(): GatesState {
  return {
    unlocked: 0,
    pending: 0,
    active: 0,
    capped: false,
    lockT: -1,
    dueT: Infinity,
    lastBreachT: -1,
    spawnT: [NaN, NaN, NaN, NaN, NaN],
    killT: [NaN, NaN, NaN, NaN, NaN],
    fightS: 0,
    pressure: 0,
    ignoredS: 0,
    engagedS: 0,
    farS: 0,
    dpsWin: 0,
    dpsWinT: -1,
    liveFightS: 0,
    lastAddHitT: -Infinity,
    breachDue: 0,
    mainEarliestT: GATES.mainEarliestS,
    rematchN: [0, 0, 0],
    rematchSeq: 0,
    finaleT: 0,
    finaleDone: false,
    mainKillT: -1,
    topUpLevels: 0,
    rematchGates: 0,
  };
}

// ─────────────────────────────── queries ───────────────────────────────
/** A gatekeeper or the city boss is alive (paceMul suspends the catch-up; the director reads it). */
export function fightAlive(w: World): boolean {
  return !!w.boss && w.boss.alive;
}

/** The live HOME gatekeeper (slot 1..3), or null (none, a rematch, or the city boss). */
function liveHomeGate(w: World): BossState | null {
  const b = w.boss;
  return b && b.alive && b.role === 'gate' && b.slot >= 1 && b.slot <= 3 ? b : null;
}

/** The GROW bar reads SIZE LOCKED while true: a Size gate is pending or its fight is alive (slots 1..4). */
export function sizeLocked(w: World): boolean {
  if (w.endless) return false;
  const G = w.gates;
  return G.pending > 0 || G.active > 0;
}

/**
 * × director budget. A live HOME gatekeeper: GATES.spawnMul[id] × (1 + budgetPer × pressure) (§6.3); 1
 * otherwise. A gate REMATCH (slot 0) and the city boss get BOSS_SPAWN_MUL through the director's own
 * bossRules (ai/director.ts budgetRate applies it for role 'main' or slot 0), so this returns 1 for them —
 * returning BOSS_SPAWN_MUL here as well would apply it twice.
 */
export function gateSpawnMul(w: World): number {
  const b = liveHomeGate(w);
  if (!b) return 1;
  if (w.mode === 'vs') {
    // ONLINE VS (BOSSHP): the rig is shared and a tender now lasts minutes, so only the seats WORKING it get the thinner budget (its own adds are
    // the artillery); a seat out of the rig's reach keeps full PvE food, or the fight would starve every titan that is not in it
    const R = (b.data.ringR > 0 ? b.data.ringR : 14) * VS.tender.nearRingMul;
    if (hypot(w.titan.x - b.x, w.titan.z - b.z) > R) return 1;
    return VS.tender.spawnMulNear;   // and the seats in the fight keep that fraction of the PvE food (its adds are XP + pressure, the fight must not stall growth)
  }
  const base = GATES.spawnMul[b.id as GateId] ?? 1;
  return base * (1 + GATES.pressure.budgetPer * w.gates.pressure);
}

/** × gatekeeper hostile damage: 1 + dmgPer × pressure for a home gatekeeper; 1 for a rematch / the city boss. */
export function gateDmgMul(w: World): number {
  const b = liveHomeGate(w);
  if (!b) return 1;
  return 1 + GATES.pressure.dmgPer * w.gates.pressure;
}

/**
 * Gatekeeper max HP: GATE_HP_AT_RANK[rank] × GATE_HP_MUL[id] × (1 + ENDLESS.rematchHpStep × rematch).
 * Rank 3 has no table value (no gatekeeper is fought at Size IV in play; only a dev cheat can field one):
 * it falls back to the Size V value × 20 / 45 (the Size IV / V damage-multiplier ratio of §3.0).
 */
export function gateHpFor(id: GateId, rank: RankIndex, rematch: number): number {
  const r = Math.max(0, Math.min(4, Math.floor(Number.isFinite(rank) ? rank : 0)));
  let hp = GATE_HP_AT_RANK[r];
  if (!(Number.isFinite(hp) && hp > 0)) hp = r === 3 ? (GATE_HP_AT_RANK[4] * 20) / 45 : GATE_HP_AT_RANK[0];
  const mul = GATE_HP_MUL[id];
  const n = Math.max(0, Math.floor(Number.isFinite(rematch) ? rematch : 0));
  return hp * (Number.isFinite(mul) && mul > 0 ? mul : 1) * (1 + ENDLESS.rematchHpStep * n);
}

// ─────────────────────────────── lock ───────────────────────────────
/**
 * Lock Size `slot` (§2.1): the titan waits at Size slot − 1 until the fight is won. Idempotent: a second
 * call for the pending or live slot does nothing. Only the next Size (unlocked + 1) can lock, never in
 * EXTENDED COVERAGE.
 */
export function lockGate(w: World, slot: GateSlot, capped: boolean): void {
  const G = w.gates;
  if (w.mode === 'vs') return;   // ONLINE VS: no size locks (the gatekeepers are PUBLIC TENDERS, meta/tender.ts)
  if (w.endless || w.run.result) return;
  if (!(slot >= 1 && slot <= 4)) return;
  if (slot !== G.unlocked + 1) return;
  if (G.pending === slot || G.active === slot) return;
  if (G.pending !== 0 || G.active !== 0) return;
  G.pending = slot;
  G.capped = !!capped;
  G.lockT = w.t;
  let due = Math.max(w.t + GATES.summonDelayS, G.lastBreachT >= 0 ? G.lastBreachT + GATES.chainGapS : -Infinity);
  if (slot === 4) due = Math.max(due, G.mainEarliestT);
  G.dueT = due;
  w.events.push({ type: 'gateLocked', slot, capped: G.capped });
  if (slot <= 3) w.events.push({ type: 'alert', key: slot === 1 ? 'gate1' : slot === 2 ? 'gate2' : 'gate3' });
}

// ─────────────────────────────── the tick ───────────────────────────────
/** CALL DROPPED needs the adds of a gatekeeper that has just died (gateAddIds reads only a LIVE rig), so
 *  the live list is mirrored here every tick. Keyed by the BossState it belongs to (never outlives it). */
let addsOf: BossState | null = null;
const addsSnap: number[] = [];

/** Tick order: right after stepDirector. */
export function stepGates(w: World): void {
  const G = w.gates, T = w.titan;
  if (w.run.result || w.mode === 'vs') return;   // VS: stepWorldN never calls it; the guard keeps a stray caller harmless

  // ── the Size V finale (§4.3) ──
  if (G.finaleT > 0) {
    stepFinale(w);
    return;
  }
  if (!T.alive) return;

  // ── the live fight (a home gatekeeper, a rematch or the city boss) ──
  const b = w.boss;
  if (b && b.alive) {
    G.fightS += w.dt;
    if (b.role === 'gate') stepGateFight(w, b);
  }

  if (w.endless) return;

  // ── the time caps (§2.7): a liveness net, never a pacing tool ──
  if (G.pending === 0 && G.active === 0 && !fightAlive(w) && (G.lastBreachT < 0 || w.t >= G.lastBreachT + GATES.chainGapS)) {
    const s = G.unlocked + 1;
    if (s <= 3 && w.t >= GATES.capS[s]) lockGate(w, s as GateSlot, true);
    else if (s === 4 && G.unlocked === 3 && w.t >= GATES.capS[4]) lockGate(w, 4, true);
  }

  // ── dev-cheat bypass: a titan that reached Size V WITHOUT the city boss's kill (cheat.rank / cheat.level
  //    open every gate through growToRank, §7.3) never locks slot 4, so the director's legacy schedule
  //    (director.bossT = min(BOSS_AT_S, t(Size V) + 20), still kept by ai/director.ts) fields the city
  //    boss — never in normal play, where Size V only comes from that kill (§4.1). ──
  if (G.unlocked >= 4 && G.mainKillT < 0 && G.pending === 0 && !w.director.bossSpawned && !fightAlive(w)
      && w.t >= w.director.bossT && !w.cheats.noSpawns) {
    Bosses.spawnBoss(w, BIOMES[w.biomeId].boss);
    const nb = w.boss;
    if (nb && nb.alive && nb.role === 'main') { G.active = 4; G.spawnT[4] = w.t; resetFight(G); }
  }

  // ── arrival (§2.3 / §4.1): a pending lock spawns at dueT once no fight is alive ──
  if (G.pending > 0 && !fightAlive(w) && w.t >= G.dueT - 1e-9 && !w.cheats.noSpawns) {
    const s = G.pending;
    if (s >= 1 && s <= 3) {
      const id = GATE_OF_SLOT[s] as GateId;
      Bosses.spawnGate(w, id, 0);
    } else if (s === 4) {
      Bosses.spawnBoss(w, BIOMES[w.biomeId].boss);
    }
    const nb = w.boss;
    if (nb && nb.alive && nb.slot === s) {
      G.active = s;
      G.pending = 0;
      G.dueT = Infinity;
      G.spawnT[s] = w.t;
      resetFight(G);
    }
  }
}

/** Fight bookkeeping reset at a spawn (the counters of the previous fight stay readable until then). */
function resetFight(G: GatesState): void {
  G.pressure = 0;
  G.ignoredS = 0;
  G.engagedS = 0;
  G.farS = 0;
  G.liveFightS = 0;
  G.lastAddHitT = -Infinity;
}

/** §2.4 for one tick of a live gatekeeper: engagement, pressure (home only), the cut-off. */
function stepGateFight(w: World, b: BossState): void {
  const G = w.gates, T = w.titan, dt = w.dt;
  const home = b.slot >= 1 && b.slot <= 3;
  // a rematch fielded by EXTENDED COVERAGE (or a cheat) starts its own clocks
  if (b.data.gateFightInit !== 1) {
    b.data.gateFightInit = 1;
    if (!home) resetFight(G);
    b.data.pIgn = 0; b.data.pEng = 0;
  }
  // mirror the adds (CALL DROPPED on the kill)
  const adds = Bosses.gateAddIds(w);
  addsOf = b; addsSnap.length = 0;
  for (let i = 0; i < adds.length; i++) addsSnap.push(adds[i]);

  if (b.introT > 0) return;               // invulnerable walk-in: no clocks yet
  G.liveFightS += dt;

  const H = Bosses.bossH(w, b);
  const dist = hypot(T.x - b.x, T.z - b.z);
  // the module publishes its band (b.data.bandMaxH, lane K1b); the §2.4 table is the fallback
  const bandMax = Number.isFinite(b.data.bandMaxH) && b.data.bandMaxH > 0 ? b.data.bandMaxH : (GATE_BAND_MAX[b.id as GateId] ?? 4);
  const lastHit = Number.isFinite(b.data.lastHitT) ? b.data.lastHitT : -Infinity;
  const engaged = dist <= (bandMax + GATES.engageMarginH) * H
    || w.t - lastHit <= GATES.engageHitS
    || w.t - G.lastAddHitT <= GATES.engageHitS;
  if (engaged) G.engagedS += dt; else G.ignoredS += dt;

  // containment pressure (home gatekeepers only; a rematch is not being avoided)
  if (home) {
    const P = GATES.pressure;
    if (engaged) {
      b.data.pEng = (b.data.pEng ?? 0) + dt;
      if (G.pressure > 0 && b.data.pEng >= P.decayS - 1e-9) {
        G.pressure = (G.pressure - 1) as 0 | 1 | 2 | 3;
        b.data.pEng = 0; b.data.pIgn = 0;
      }
    } else {
      b.data.pIgn = (b.data.pIgn ?? 0) + dt;
      if (G.pressure < 3 && b.data.pIgn >= P.everyS - 1e-9) {
        G.pressure = (G.pressure + 1) as 0 | 1 | 2 | 3;
        b.data.pEng = 0; b.data.pIgn = 0;
        const lv = G.pressure as 1 | 2 | 3;
        w.events.push({ type: 'gateEscalate', level: lv });
        if (lv === 1 || lv === 3) w.events.push({ type: 'alert', key: 'gateEscalate' });
      }
    }
  }

  // CUTTING YOU OFF: farther than repositionRingMul × spawnRing for repositionS → re-enter ahead
  if (dist > GATES.repositionRingMul * Bosses.gateRing(w)) {
    G.farS += dt;
    if (G.farS >= GATES.repositionS - 1e-9) {
      G.farS = 0;
      Bosses.gateReenter(w, b);
    }
  } else G.farS = 0;
}

// ─────────────────────────────── the kill ───────────────────────────────
/** End of stepWorld, before checkRunEnd: runs onGateDefeated / onMainDefeated for gates.breachDue on
 *  the kill tick (§2.5). A kill from a dev cheat between ticks is flushed by the cheat (or the next tick). */
export function flushGateBreach(w: World): void {
  const G = w.gates;
  const slot = G.breachDue;
  if (slot === 0) return;
  G.breachDue = 0;
  const b = w.boss;
  if (!b) return;
  if (slot >= 1 && slot <= 3) onGateDefeated(w, b);
  else if (slot === 4) onMainDefeated(w, b);
}

/** A home gatekeeper's kill (§2.5), on the kill tick. */
export function onGateDefeated(w: World, b: BossState): void {
  const G = w.gates;
  const s = b.slot;
  if (!(s >= 1 && s <= 3)) return;       // a rematch guards nothing (meta/endless.ts rewards it)
  if (!(G.unlocked < s)) return;         // already breached (idempotent)
  // 5. (first, so the breach's own checkGateLock sees the new state) the fight is over
  G.active = 0; G.pending = 0; G.breachDue = 0; G.capped = false; G.dueT = Infinity;
  G.killT[s] = w.t;
  G.lastBreachT = w.t;
  G.pressure = 0; G.farS = 0;
  // 1. the MASS BREACH on this tick (tops the level up on a capped kill; drafts owed)
  Titan.breachTo(w, s as RankIndex);
  // 2. a chest at the wreck · 3. UPROAR points
  spawnPickup(w, 'chest', b.x, b.z, 0, 0);
  addUproar(w, GATES.reward.uproar);
  // 4. CALL DROPPED: every add it summoned that is still alive stands still for 3 s
  if (addsOf === b) {
    for (let i = 0; i < addsSnap.length; i++) {
      const id = addsSnap[i];
      for (let k = 0; k < w.enemies.length; k++) {
        const e = w.enemies[k];
        if (e.id === id) { if (e.alive) e.stun = Math.max(e.stun, CALL_DROPPED_S); break; }
      }
    }
  }
  addsOf = null; addsSnap.length = 0;
  // 5. a chained lock on this tick when the level is already there
  Titan.checkGateLock(w);
}

/** The city boss's kill (§4.3): the last MASS BREACH (Size V) and the VICTORY FINALE, on the kill tick. */
export function onMainDefeated(w: World, _b: BossState): void {
  const G = w.gates;
  if (w.endless || G.mainKillT >= 0) return;
  G.mainKillT = w.t;
  G.killT[4] = w.t;
  G.active = 0; G.pending = 0; G.breachDue = 0; G.capped = false; G.dueT = Infinity;
  G.lastBreachT = w.t;
  Titan.breachTo(w, 4);
  G.finaleT = GATES.finaleS;
  w.events.push({ type: 'finale', on: true });
  finaleHold(w, true);
}

/** Hostiles stand down for the finale: hostile telegraphs / projectiles cancelled, every live enemy stunned,
 *  the titan invulnerable. `start` = the kill tick (the full stun and invulnerability are granted there). */
function finaleHold(w: World, start: boolean): void {
  const G = w.gates;
  for (let i = 0; i < w.telegraphs.length; i++) { const t = w.telegraphs[i]; if (t.alive && t.owner !== 'titan') t.alive = false; }
  for (let i = 0; i < w.projectiles.length; i++) { const p = w.projectiles[i]; if (p.alive && p.owner !== 'titan') p.alive = false; }
  const stun = start ? GATES.finaleS + 1 : G.finaleT + 1;
  for (let i = 0; i < w.enemies.length; i++) { const e = w.enemies[i]; if (e.alive && e.stun < stun) e.stun = stun; }
  const inv = (start ? GATES.finaleS : G.finaleT) + 0.5;
  if (!(w.ult.invulnT >= inv)) w.ult.invulnT = inv;
}

function stepFinale(w: World): void {
  const G = w.gates;
  const before = GATES.finaleS - G.finaleT;
  G.finaleT = G.finaleT - w.dt <= 1e-6 ? 0 : G.finaleT - w.dt;
  const after = GATES.finaleS - G.finaleT;
  if (before < FINALE_ALERT_S - 1e-9 && after >= FINALE_ALERT_S - 1e-9) w.events.push({ type: 'alert', key: 'finale' });
  if (G.finaleT <= 0) { finishFinale(w); return; }
  finaleHold(w, false);
}

function finishFinale(w: World): void {
  const G = w.gates;
  G.finaleT = 0;
  if (G.finaleDone) return;
  G.finaleDone = true;
  w.events.push({ type: 'finale', on: false });
}

/** App skip (Enter / A after GATES.finaleSkipS) and the finale timer. No-op unless the finale is running. */
export function endFinale(w: World): void {
  const G = w.gates;
  if (!(G.finaleT > 0) || G.finaleDone) return;
  finishFinale(w);
}

/** GATE_IDS index of a gatekeeper id (−1 for a city boss). */
export function gateIndex(id: string): number {
  return (GATE_IDS as readonly string[]).indexOf(id);
}
