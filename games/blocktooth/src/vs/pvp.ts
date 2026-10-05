// BLOCKTOOTH VS — titan-vs-titan combat resolution (vs_design.md §6.1-6.4, §6.2 rules 5-8). Lane B-VS.
// THREE-free, deterministic, no clocks / no rng (a hit's outcome is a pure function of the world + the hit).
//
// Division of labour (agreed in _harness/scratch/partb/NOTES.md):
//   * the KITS (src/titans/rivals.ts, B-TITAN) decide WHAT hit WHOM and which kit % applies; they call pvpHit / pvpCc;
//   * the damage SYSTEM (src/combat/*, B-WORLD) reports every titan-side shape that overlaps a rival into the PvP
//     queue (src/combat/pvp.ts); vsAfterTitans drains it through drainQueuedPvp below, so a hit no kit claimed still
//     lands (as a kit-table % through the same pvpHit);
//   * THIS file decides HOW MUCH it hurts: the formula, the phase gate (OPEN HOUSE = shove only), spawn protection,
//     the size edge, power(), thorns / lifesteal at 50 %, UPROAR charge (x1.5 on the crown), the hit log that feeds KO
//     credit / assists, and the CC accounting (<= 1.0 s, then 3 s CLEARED).
//
// Binding: every function works whatever is bound (it names the victim / attacker explicitly and binds through
// withPlayer around hurtTitan / healTitan / addUproar / stat reads).

import { VS } from '../core/config.ts';
import type { DamageKind, TitanId, World } from '../core/types.ts';
import { emitAs, withPlayer } from '../core/players.ts';
import { hurtTitan, healTitan } from '../titans/titansim.ts';
import { knockTitan, slowTitan } from '../titans/titanfx.ts';
import { stat } from '../upgrades/stats.ts';
import { addUproar } from '../meta/ultimate.ts';
import { takePvp } from '../combat/pvp.ts';
import type { PvpHit as QueuedHit } from '../combat/pvp.ts';
import { pvpDamage, uproarChargeMul } from './formula.ts';
import { pvpOnIn } from './clock.ts';
import { VSX } from './tune.ts';

/** What a kit reports for one hit on a rival (see NOTES.md). `knock` is the TOTAL SHOVE DISTANCE IN METRES
 *  (what knockTitan takes). `dot` = a per-tick slice of a rate: `pct` is already x dt and grants no i-frames. */
export interface PvpHit {
  kind: DamageKind;
  /** 'molo.auto' | 'molo.dash' | 'volt.auto' | 'volt.wire' | 'volt.det' | 'hearth.auto' | 'hearth.vent' | 'hearth.dash' |
   *  'briar.auto' | 'briar.pod' | 'briar.ring' | 'briar.chain' | 'uproar' | 'stomp' | ... ('uproar' skips power()) */
  tag: string;
  x: number; z: number;
  knock: number;
  dot: boolean;
}

/** How long (s) a CC chain stays "one chain": a gap of idle time longer than this refills the 1.0 s CC budget. */
const CC_CHAIN_GAP_S = 0.6;
/** lifesteal heals at most this fraction of maxHp per tick (same cap damage.ts uses against enemies) */
const LIFESTEAL_CAP_PER_TICK = 0.02;

function inVs(w: World): boolean { return w.mode === 'vs' && w.vs !== null; }

/** Read a stat as seat `slot` (frenzy buffs included) without disturbing the binding. */
function statOf(w: World, slot: number, key: Parameters<typeof stat>[1]): number {
  return withPlayer(w, slot, () => stat(w, key));
}

/** Keep the last `creditWindowS` of hits on a victim (the log feeds KO credit and assists). */
function logHit(w: World, victim: number, from: number, frac: number): void {
  const V = w.players[victim].vs;
  V.hits.push({ from, t: w.t, pct: frac });
  const cut = w.t - VS.ko.creditWindowS;
  let k = 0;
  while (k < V.hits.length && V.hits[k].t < cut) k++;
  if (k > 0) V.hits.splice(0, k);
  if (V.hits.length > 64) V.hits.splice(0, V.hits.length - 64);   // bound the log (a wire ticking at 30 Hz)
}

/** Attacking a rival breaks the attacker's own spawn protection early (vs_design.md §6.3). */
function breakSpawnProtection(w: World, slot: number): void {
  const P = w.players[slot];
  if (P.vs.spawnProtT > 0) {
    P.vs.spawnProtT = 0;
    const u = P.ult;
    if (u.invulnT > 0 && u.invulnT <= 2 * w.dt + 1e-9) u.invulnT = 0;   // the immunity vsBeginTick was holding up
  }
}

/**
 * Titan `from` hits titan `to`. `pct` = the kit's fraction of the VICTIM's max HP BEFORE power / size edge / phase
 * (a number from VS.kitPct). Returns the HP actually lost (0 in OPEN HOUSE, under spawn protection, or when the victim's
 * i-frames / armor / shield took it all). Pushes `rivalHit` (p = from). Works whatever is bound.
 */
export function pvpHit(w: World, from: number, to: number, pct: number, hit: PvpHit): number {
  const vs = w.vs;
  if (w.mode !== 'vs' || !vs || vs.phase === 'over' || vs.phase === 'countdown') return 0;
  const ps = w.players;
  if (from === to || from < 0 || to < 0 || from >= ps.length || to >= ps.length) return 0;
  const A = ps[from], V = ps[to];
  if (A.vs.eliminated || V.vs.eliminated || !V.titan.alive) return 0;
  A.vs.data.direct = w.tick; A.vs.data['d' + to] = w.tick;   // the queue drain skips a pair a kit already resolved this tick

  const T = V.titan;
  // knockback direction: away from the impact point; fall back to away from the attacker's body
  let kx = T.x - hit.x, kz = T.z - hit.z;
  if (!(kx * kx + kz * kz > 1e-9)) { kx = T.x - A.titan.x; kz = T.z - A.titan.z; }
  const protectedV = V.vs.spawnProtT > 0;

  if (!pvpOnIn(vs.phase) || protectedV) {            // NO CONTEST: OPEN HOUSE shove (or a protected victim: nothing)
    if (!protectedV) {
      breakSpawnProtection(w, from);
      if (hit.knock > 0) knockTitan(w, to, kx, kz, hit.knock);
    }
    emitAs(w, from, { type: 'rivalHit', from, to, pct: 0, x: hit.x, z: hit.z, noContest: true });
    return 0;
  }

  breakSpawnProtection(w, from);
  const dmg = pvpDamage({
    victimMaxHp: T.maxHp, kitPct: pct * (hit.tag === 'uproar' || hit.tag === 'stomp' ? 1 : VSX.pvpMul),
    attackerDamageStat: statOf(w, from, 'damage'),
    attackerRank: A.titan.rank, victimRank: T.rank,
    phase: vs.phase, noPower: hit.tag === 'uproar',
  });
  if (hit.knock > 0) knockTitan(w, to, kx, kz, hit.knock);
  if (!(dmg > 0)) return 0;

  const lost = withPlayer(w, to, () => hurtTitan(w, dmg, hit.kind, hit.x, hit.z, hit.dot));
  if (!(lost > 0)) return 0;

  const frac = lost / T.maxHp;
  logHit(w, to, from, frac);
  A.vs.pvpDealt += frac * 100;
  V.vs.pvpTaken += frac * 100;

  // UPROAR charge for the attacker: 120 x the fraction of the rival's maxHp dealt (x1.5 against the FRONT PAGE crown)
  addPoints(w, from, VS.pvp.uproarChargePts * frac * uproarChargeMul(vs.crown === to));

  if (!hit.dot) {
    // thorns reflect at 50 %: the victim's thorns stat x HP lost, onto the attacker (a hit from `to` on `from`)
    const th = statOf(w, to, 'thorns');
    if (th > 0 && A.titan.alive) {
      const refl = th * lost * VS.pvp.thornsEff;
      const rl = withPlayer(w, from, () => hurtTitan(w, refl, 'thorns', T.x, T.z, true));
      if (rl > 0) { logHit(w, from, to, rl / A.titan.maxHp); V.vs.pvpDealt += (rl / A.titan.maxHp) * 100; A.vs.pvpTaken += (rl / A.titan.maxHp) * 100; }
    }
  }
  // lifesteal at 50 %, capped per tick
  const ls = statOf(w, from, 'lifesteal');
  if (ls > 0 && A.titan.alive && A.titan.hp < A.titan.maxHp) {
    const D = A.vs.data;
    if (D.lsTick !== w.tick) { D.lsTick = w.tick; D.lsHealed = 0; }
    const room = LIFESTEAL_CAP_PER_TICK * A.titan.maxHp - (D.lsHealed ?? 0);
    const amt = Math.min(room, ls * lost * VS.pvp.lifestealEff);
    if (amt > 0) { D.lsHealed = (D.lsHealed ?? 0) + amt; withPlayer(w, from, () => healTitan(w, amt)); }
  }
  emitAs(w, from, { type: 'rivalHit', from, to, pct: frac, x: hit.x, z: hit.z, noContest: false });
  return lost;
}

function addPoints(w: World, slot: number, pts: number): void {
  if (!(pts > 0)) return;
  withPlayer(w, slot, () => addUproar(w, pts));
}

/**
 * CC accounting (vs_design.md §6.2 rule 7). Returns the SECONDS granted (0 = the victim is CLEARED / OPEN HOUSE /
 * spawn-protected / out of its budget); the caller applies the effect for that long. Any chain of root / slow / drag /
 * stun on a rival lasts at most VS.ko.ccMaxS (1.0 s) in total; when the budget runs out the victim is CLEARED
 * (immune to rival CC) for the grant + VS.ko.clearedS (3 s). A gap of CC_CHAIN_GAP_S refills the budget.
 * `kind` is informational (a continuous pull passes seconds = dt each tick).
 */
export function pvpCc(w: World, from: number, to: number, kind: 'slow' | 'root' | 'pull', seconds: number): number {
  void kind;
  const vs = w.vs;
  if (w.mode !== 'vs' || !vs || !pvpOnIn(vs.phase)) return 0;
  const ps = w.players;
  if (from === to || to < 0 || to >= ps.length || from < 0 || from >= ps.length) return 0;
  const V = ps[to];
  if (V.vs.eliminated || !V.titan.alive || V.vs.spawnProtT > 0 || V.vs.clearedT > 0) return 0;
  if (!(seconds > 0) || !Number.isFinite(seconds)) return 0;
  const D = V.vs.data;
  const left = D.ccLeft === undefined ? VS.ko.ccMaxS : D.ccLeft;
  const g = Math.min(seconds, left);
  if (!(g > 1e-9)) return 0;
  breakSpawnProtection(w, from);
  D.ccLeft = left - g;
  D.ccGapT = CC_CHAIN_GAP_S;
  if (D.ccLeft <= 1e-9) { D.ccLeft = 0; V.vs.clearedT = g + VS.ko.clearedS; }
  return g;
}

/** Per-tick upkeep of the CC chain state of one seat (called by vsBeginTick): idle chains refill, CLEARED expiry refills. */
export function tickCcState(w: World, slot: number): void {
  const V = w.players[slot].vs;
  const D = V.data;
  if (V.clearedT > 0) {
    V.clearedT -= w.dt;
    if (V.clearedT <= 1e-9) { V.clearedT = 0; delete D.ccLeft; delete D.ccGapT; }
    return;
  }
  if (D.ccGapT !== undefined) {
    D.ccGapT -= w.dt;
    if (D.ccGapT <= 1e-9) { delete D.ccLeft; delete D.ccGapT; }
  }
}

// ───────────────────────── the queue drain (B-WORLD's generic titan-side hit reports) ─────────────────────────

/** Fraction-of-maxHp for a queued generic hit, by the ATTACKER's titan and the hit's damage kind. 0 = shove only. */
export function queuedPct(titan: TitanId, kind: DamageKind, dot: boolean, fromUpgrade: boolean): number {
  const K = VS.kitPct;
  let p = 0;
  switch (titan) {
    case 'molo': p = kind === 'bite' ? K.molo.auto : 0; break;
    case 'voltkite':
      if (kind === 'arc' || kind === 'spark') p = K.voltkite.auto;
      else if (kind === 'wire') p = dot ? K.voltkite.wireTickPerS * 0.2 : 0;     // hazard ticks at 5 Hz
      break;
    case 'hearthback':
      if (kind === 'magma') p = dot ? 0 : K.hearthback.auto;
      else if (kind === 'vent') p = K.hearthback.ventBase;
      break;
    case 'briarwick':
      if (kind === 'vine') p = K.briarwick.auto;
      else if (kind === 'seed') p = K.briarwick.pod;
      break;
  }
  if (p === 0 && !dot && kind !== 'smash' && kind !== 'stomp' && kind !== 'rubble' && kind !== 'thorns') {
    p = 0.01;                                   // an uncatalogued titan-side attack chips for 1 % (shoves always apply)
  }
  return fromUpgrade ? p * 0.5 : p;             // upgrade procs hit at 50 % in VS
}

/**
 * Resolve the hits the damage system queued (src/combat/pvp.ts takePvp). A pair a kit already resolved through pvpHit in
 * the same tick (or the one before) is skipped, so a kit that calls pvpHit AND also reaches damageArea never counts twice.
 * Returns the number of hits resolved.
 */
export function drainQueuedPvp(w: World): number {
  if (w.mode !== 'vs') return 0;
  const q: QueuedHit[] = takePvp(w);
  let n = 0;
  for (let i = 0; i < q.length; i++) {
    const h = q[i];
    if (h.from < 0 || h.from >= w.players.length || h.to < 0 || h.to >= w.players.length || h.from === h.to) continue;
    const A = w.players[h.from];
    const d = A.vs.data['d' + h.to];
    if (d !== undefined && h.tick - d <= 1) continue;
    n++;
    if (h.slow > 0) {
      const g = pvpCc(w, h.from, h.to, 'slow', 0.25);
      if (g > 0) slowTitan(w, h.to, 1 - h.slow, g);
    }
    if (!(h.dmg > 0) && h.slow > 0) continue;
    const pct = queuedPct(A.titanId, h.kind, h.dot, h.upg !== '');
    const knockM = h.knock > 0 ? Math.min(h.knock / 8, 1.5 * A.titan.height) : 0;
    pvpHit(w, h.from, h.to, pct, { kind: h.kind, tag: 'queued.' + h.kind, x: h.x, z: h.z, knock: knockM, dot: h.dot });
  }
  return n;
}

/** Is PvP damage live right now (HOSTILE TAKEOVER onward)? */
export function pvpLive(w: World): boolean { return inVs(w) && pvpOnIn((w.vs as NonNullable<World['vs']>).phase); }
