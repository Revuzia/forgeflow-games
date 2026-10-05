// BLOCKTOOTH ONLINE VS — the PUBLIC TENDER engine (vs_design.md section 4.1-4.2; lane B-WORLD).
// THREE-free, deterministic: no clocks, no rng draws of its own (placement is a pure scan; the rig's own rolls come from
// the boss framework's w.rng.boss). Solo never touches this file.
//
// The three gatekeepers (STENCIL-1 / CORDON-2 / SWITCHBOARD-5) are SHARED REWARD EVENTS in VS: no size locks, no breach,
// no city boss. `w.vs.tenders[i]` (src/vs/types.ts TenderState, created by src/vs/state.ts from VS.tender.gates) carries the
// schedule and the live mirror; the rig itself is the ordinary boss framework in the w.boss slot (ai/bosses/index.ts
// spawnTender), hunting one titan at a time and recording every seat's damage.
//
//   stepTenders(w)   call once per tick from vsBeginTick (UNBOUND). For every tender, in order:
//     pending   marker goes up VS.tender.markerLeadS before `atS` (match clock = w.t - w.vs.startT): pick the LAST-PLACE
//               titan (lowest level, ties: fewer KOs, then lower slot; eliminated seats never), the crosswalk of ITS
//               quadrant nearest to it that is >= spawnRingMul x its spawn ring from EVERY live titan (a pure scan of
//               the road grid, ties by grid index) -> t.x / t.z / t.spawnSlot / t.markerT, event `tenderMarker` (p -1),
//               state 'marker'. The trailing titan gets first crack, and everyone can see it coming.
//     marker    at `atS` (and while no other boss is alive: one rig at a time) spawn the rig at the marker, opening on the
//               NEAREST live titan: max HP = the gate's solo HP at the Size it guards x (1 + hpPerExtraTitan x
//               (titans within nearRingMul x spawn ring - 1)); when the walk-in ends the head-count is taken again and
//               the HP re-scaled once (nobody can hurt it during the intro). Event `tenderSpawn`, state 'live'.
//     live      mirror the rig into t.dmg / t.recent / t.targetSlot / t.retargetT; ignoredS counts the seconds with no live
//               titan within nearRingMul x spawn ring of the rig, and at VS.tender.ignoredWithdrawS the rig LEAVES
//               (BID WITHDRAWN: `tenderPaid` with all-zero shares, top -1, state 'withdrawn', nothing paid);
//               when the rig dies -> payout.
//     payout    shares = damage / total damage. Per LIVE seat (bound): the XP lump x share (any titan that dealt >=
//               minShareDmgFrac of the damage gets at least minShareFrac of the lump) through gainGrowth (a fraction of
//               its CURRENT xp bar, no multipliers, may level / rank up), UPROAR x share, and the TOP bidder's wreck chest
//               as `upgrades.chestDrafts++` (the CARD RAIL opens it as a rare+ offer). The last hit gets nothing extra.
//               Counters: p.vs.tenderBids (dealt >= 5 %), p.vs.tenderTop, p.vs.data.tenderShare += share (the VS SCORE term).
//               Event `tenderPaid {gate, shares, top}` (p -1), state 'paid'. The rig's surviving adds stand still 3 s
//               (CALL DROPPED), as in solo.
//
// Everything is derived from `w.vs.tenders` + the boss `b.data` records, so a peer replaying the input log reaches the
// same state. The XP lump size is a [proposal] (LUMP_LEVELS, in levels of the recipient's current bar) for the VP probe.

import { hypot } from '../core/detmath.ts';
import type { BossState, GateId, World } from '../core/types.ts';
import { VS } from '../core/config.ts';
import { emitAs, withPlayer } from '../core/players.ts';
import type { TenderState } from '../vs/types.ts';
import { ringRadius } from '../ai/enemies.ts';
import { gateAddIds, gateHomeSlot, rigDamageBy, rigRecentBy, spawnTender } from '../ai/bosses/index.ts';
import { gateHpFor } from './gates.ts';
import { addUproar } from './ultimate.ts';
import { gainGrowth } from '../titans/titansim.ts';
import { nearestLiveSlot, seatLive } from '../combat/targets.ts';

/** XP lump of the whole tender, in levels of an xp bar (VS.tender.lump x VS.tender.lumpBasis; scaled by the damage share). */
/** CALL DROPPED: the rig's surviving adds stand still this long on its death (as meta/gates.ts). */
const CALL_DROPPED_S = 3;

/** The rig's add ids, mirrored every live tick (gateAddIds reads only a LIVE rig, and the payout needs them after death).
 *  Keyed by the BossState (never module-level singletons: several Worlds / peers may step in one process). */
const ADDS = new WeakMap<BossState, number[]>();

/** Match clock (s since OPEN HOUSE began). */
function clockOf(w: World): number { return w.t - (w.vs ? w.vs.startT : 0); }

/** Last place: the live-in-match seat with the lowest level, ties fewer KOs, then lower slot. -1 when none. */
export function lastPlaceSlot(w: World): number {
  let best = -1;
  for (let i = 0; i < w.players.length; i++) {
    const p = w.players[i];
    if (p.vs.eliminated) continue;
    if (best < 0) { best = i; continue; }
    const q = w.players[best];
    if (p.titan.level < q.titan.level || (p.titan.level === q.titan.level && p.vs.koCount < q.vs.koCount)) best = i;
  }
  return best;
}

/** Damage share of every seat in a tender (index = slot; all zeros before any damage). */
export function tenderShares(t: TenderState, n: number): number[] {
  let total = 0;
  for (let i = 0; i < n; i++) total += t.dmg[i] ?? 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(total > 0 ? (t.dmg[i] ?? 0) / total : 0);
  return out;
}

/** Quadrant (0..3) of a point against the city centre. */
function quadrantOf(w: World, x: number, z: number): number {
  const B = w.city.bounds;
  return (x >= (B.minX + B.maxX) / 2 ? 1 : 0) + (z >= (B.minZ + B.maxZ) / 2 ? 2 : 0);
}

/** The spawn ring (m) of seat `slot` (its director ring: ringRadius with that titan bound). */
function ringOfSeat(w: World, slot: number): number {
  return withPlayer(w, slot, () => ringRadius(w));
}

/**
 * The crosswalk (road intersection) for a tender placed for trailing seat `slot`: inside that titan's quadrant, at least
 * spawnRingMul x its ring from every live titan, the nearest such one to the trailing titan (ties: lower grid index);
 * with no admissible one in the quadrant, the admissible one farthest from every titan anywhere in the city.
 */
export function tenderPlacement(w: World, slot: number): { x: number; z: number } {
  const c = w.city, B = c.bounds, T0 = w.players[slot].titan;
  const R = ringOfSeat(w, slot);
  const minD = VS.tender.spawnRingMul * R;
  const quad = quadrantOf(w, T0.x, T0.z);
  let bx = T0.x, bz = T0.z, bd = Infinity;
  let fx = T0.x, fz = T0.z, fMin = -1;      // fallback: the point farthest from every live titan
  for (let j = 0; j <= c.blocksZ; j++) {
    for (let i = 0; i <= c.blocksX; i++) {
      const x = c.originX + i * c.pitch, z = c.originZ + j * c.pitch;
      if (x < B.minX || x > B.maxX || z < B.minZ || z > B.maxZ) continue;
      let nearest = Infinity;
      for (let s = 0; s < w.players.length; s++) {
        const p = w.players[s];
        if (!seatLive(p)) continue;
        const d = hypot(p.titan.x - x, p.titan.z - z);
        if (d < nearest) nearest = d;
      }
      if (nearest > fMin) { fMin = nearest; fx = x; fz = z; }
      if (quadrantOf(w, x, z) !== quad || nearest < minD) continue;
      const d = hypot(T0.x - x, T0.z - z);
      if (d < bd) { bd = d; bx = x; bz = z; }
    }
  }
  if (bd < Infinity) return { x: bx, z: bz };
  return { x: fx, z: fz };
}

/** Live titans within `r` of (x, z). */
function titansNear(w: World, x: number, z: number, r: number): number {
  let n = 0;
  for (let i = 0; i < w.players.length; i++) {
    const p = w.players[i];
    if (seatLive(p) && hypot(p.titan.x - x, p.titan.z - z) <= r) n++;
  }
  return n;
}

/** The gate's solo HP at the Size it guards x the crowd scale for `near` titans. */
function tenderHp(id: GateId, near: number): number {
  const rank = Math.max(0, gateHomeSlot(id) - 1) as 0 | 1 | 2;
  return gateHpFor(id, rank, 0) * (1 + VS.tender.hpPerExtraTitan * Math.max(0, near - 1));
}

/** The rig of tender `t` (the live w.boss that carries its mark), or null. */
function rigOf(w: World, t: TenderState): BossState | null {
  const b = w.boss;
  return b && b.role === 'gate' && b.id === t.boss && b.data.tender === t.atS + 1 ? b : null;
}

/** Run every tender (see the header). Call once per tick, unbound, from vsBeginTick. */
export function stepTenders(w: World): void {
  const vs = w.vs;
  if (!vs || vs.phase === 'over' || vs.phase === 'countdown') return;
  const clock = clockOf(w);
  for (let k = 0; k < vs.tenders.length; k++) stepTender(w, vs.tenders[k], clock);
}

function stepTender(w: World, t: TenderState, clock: number): void {
  if (t.state === 'paid' || t.state === 'withdrawn') return;
  if (t.state === 'pending') {
    if (clock < t.atS - VS.tender.markerLeadS) return;
    const slot = lastPlaceSlot(w);
    if (slot < 0) return;
    const pt = tenderPlacement(w, slot);
    t.x = pt.x; t.z = pt.z; t.spawnSlot = slot; t.markerT = w.t;
    t.state = 'marker';
    w.events.push({ type: 'tenderMarker', gate: t.gate, x: t.x, z: t.z, leadS: Math.max(0, t.atS - clock) });
    return;
  }
  if (t.state === 'marker') {
    if (clock < t.atS - 1e-9) return;
    if (w.boss && w.boss.alive) return;              // one rig at a time: wait for the field to clear
    const open = nearestLiveSlot(w, t.x, t.z);
    if (open < 0) return;                            // everyone is down: hold the arrival
    const ring = ringOfSeat(w, t.spawnSlot >= 0 ? t.spawnSlot : open);
    const near = titansNear(w, t.x, t.z, VS.tender.nearRingMul * ring);
    let ok = false;
    withPlayer(w, open, () => { ok = spawnTender(w, t.gate, t.x, t.z, tenderHp(t.gate, Math.max(1, near))); });
    const b = w.boss;
    if (!ok || !b) return;
    b.data.tender = t.atS + 1;                       // the mark rigOf() matches
    b.data.ringR = ring;
    b.data.baseHp = tenderHp(t.gate, 1);
    b.data.introDone = 0;
    t.state = 'live'; t.spawnT = w.t; t.targetSlot = open; t.retargetT = w.t; t.ignoredS = 0;
    for (let i = 0; i < 4; i++) { t.dmg[i] = 0; t.recent[i] = 0; }
    ADDS.set(b, []);
    w.events.push({ type: 'tenderSpawn', gate: t.gate, x: t.x, z: t.z });
    return;
  }
  // live
  const b = rigOf(w, t);
  if (!b) { finish(w, t, null); return; }            // the boss slot was taken over / cleared: settle with what was dealt
  if (!b.alive) {
    if (b.hp <= 1e-6) payout(w, t, b); else finish(w, t, b);
    return;
  }
  // the walk-in just ended: take the head-count once and re-scale the HP (the rig was untouchable until now)
  if (b.introT <= 0 && !(b.data.introDone > 0)) {
    b.data.introDone = 1;
    const near = titansNear(w, b.x, b.z, VS.tender.nearRingMul * (b.data.ringR > 0 ? b.data.ringR : 14));
    const hp = tenderHp(t.gate, Math.max(1, near));
    b.maxHp = hp; b.hp = hp;
  }
  // mirror the rig (the bids, the recent window, its target) for the HUD / the payout
  const n = w.players.length;
  for (let i = 0; i < n; i++) { t.dmg[i] = rigDamageBy(b, i); t.recent[i] = rigRecentBy(b, i); }
  if (b.data.tslot !== undefined && b.data.tslot !== t.targetSlot) { t.targetSlot = b.data.tslot; t.retargetT = w.t; }
  // mirror the adds for CALL DROPPED
  const snap = ADDS.get(b) ?? [];
  snap.length = 0;
  const adds = gateAddIds(w);
  for (let i = 0; i < adds.length; i++) snap.push(adds[i]);
  ADDS.set(b, snap);
  // ignored: nobody within nearRingMul x the spawn ring of the rig
  const R = (b.data.ringR > 0 ? b.data.ringR : 14) * VS.tender.nearRingMul;
  if (titansNear(w, b.x, b.z, R) > 0) t.ignoredS = 0;
  else {
    t.ignoredS += w.dt;
    if (t.ignoredS >= VS.tender.ignoredWithdrawS - 1e-9) withdraw(w, t, b);
  }
}

/** BID WITHDRAWN: the unattended rig leaves, nothing is paid. */
function withdraw(w: World, t: TenderState, b: BossState): void {
  b.alive = false;
  b.attack = null; b.attackT = 0; b.staggerT = 0;
  for (let i = 0; i < w.telegraphs.length; i++) { const g = w.telegraphs[i]; if (g.alive && g.owner === 'boss') g.alive = false; }
  for (let i = 0; i < w.projectiles.length; i++) { const p = w.projectiles[i]; if (p.alive && p.owner === 'boss') p.alive = false; }
  t.state = 'withdrawn';
  const n = w.players.length;
  const shares: number[] = [];
  for (let i = 0; i < n; i++) shares.push(0);
  emitAs(w, -1, { type: 'tenderPaid', gate: t.gate, shares, top: -1 });
  ADDS.delete(b);
}

/** The slot-clear case (no rig carries the mark any more): close the tender; pay only if damage was dealt and the rig died. */
function finish(w: World, t: TenderState, b: BossState | null): void {
  void b;
  t.state = 'withdrawn';
  const n = w.players.length;
  const shares: number[] = [];
  for (let i = 0; i < n; i++) shares.push(0);
  emitAs(w, -1, { type: 'tenderPaid', gate: t.gate, shares, top: -1 });
}

/**
 * XP shares of a payout (index = slot): the damage shares, except that a seat AT or ABOVE the top level of the other seats in the match
 * (the leader / a co-leader) banks at most VS.tender.leaderShareCap of the lump; the excess goes to the live seats below the leader,
 * weighted 1 + (leader level - their level). Without it the top bidder of tenders 1 and 2 is the leader by 5:30 and takes tender 3
 * (FIXHIGH: the 7:00 leader won 69-100 % of the matches). Pure + deterministic (slot order); the sum never exceeds the damage-share sum.
 */
export function xpSharesOf(w: World, shares: readonly number[]): number[] {
  const n = w.players.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(shares[i] ?? 0);
  const cap = VS.tender.leaderShareCap;
  if (!(cap < 1)) return out;
  let excess = 0, leadL = 0;
  for (let i = 0; i < n; i++) {
    const p = w.players[i];
    if (p.vs.eliminated || out[i] <= cap) continue;
    let top = 0;
    for (let j = 0; j < n; j++) if (j !== i && !w.players[j].vs.eliminated && w.players[j].titan.level > top) top = w.players[j].titan.level;
    if (p.titan.level < top) continue;                       // a trailing / mid-pack top bidder keeps what it earned
    excess += out[i] - cap;
    out[i] = cap;
    if (p.titan.level > leadL) leadL = p.titan.level;
  }
  if (!(excess > 0)) return out;
  let wsum = 0;
  const wt: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = w.players[i];
    const ok = !p.vs.eliminated && seatLive(p) && p.titan.level < leadL;
    const x = ok ? 1 + (leadL - p.titan.level) : 0;
    wt.push(x); wsum += x;
  }
  if (!(wsum > 0)) return out;
  for (let i = 0; i < n; i++) out[i] += excess * wt[i] / wsum;
  return out;
}

/** The rig is dead: split the rewards by damage share (see the header). */
function payout(w: World, t: TenderState, b: BossState): void {
  const n = w.players.length;
  for (let i = 0; i < n; i++) { t.dmg[i] = rigDamageBy(b, i); t.recent[i] = rigRecentBy(b, i); }
  const shares = tenderShares(t, n);
  let top = -1, topD = 0;
  for (let i = 0; i < n; i++) if ((t.dmg[i] ?? 0) > topD) { topD = t.dmg[i]; top = i; }
  const lump = VS.tender.lump[t.gate] ?? 2;
  // lumpBasis 'trailing': the lump is measured on the LOWEST live seat's xp bar, so every seat gets the same XP x its share
  // (a bar of the recipient's own level pays the leader more XP than the seat that needs it)
  let basisXp = 0;
  if (VS.tender.lumpBasis === 'trailing') {
    for (let i = 0; i < n; i++) {
      const q = w.players[i];
      if (q.vs.eliminated || !q.titan.alive) continue;
      if (basisXp === 0 || q.titan.xpToNext < basisXp) basisXp = q.titan.xpToNext;
    }
  }
  const xpShares = xpSharesOf(w, shares);
  for (let i = 0; i < n; i++) {
    const p = w.players[i];
    const sh = shares[i];
    if (sh >= VS.tender.minShareDmgFrac) p.vs.tenderBids++;
    if (i === top) p.vs.tenderTop++;
    p.vs.data.tenderShare = (p.vs.data.tenderShare ?? 0) + sh;
    if (p.vs.eliminated) continue;                   // an eliminated seat is out of the match: nothing to pay
    const live = seatLive(p);                        // a KO'd (respawning) titan cannot grow now, but its wreck chest still waits for it
    withPlayer(w, i, () => {
      if (live && xpShares[i] > 0) {
        const eff = sh >= VS.tender.minShareDmgFrac ? Math.max(xpShares[i], VS.tender.minShareFrac) : xpShares[i];
        gainGrowth(w, basisXp > 0 && w.titan.xpToNext > 0 ? lump * eff * basisXp / w.titan.xpToNext : lump * eff);
      }
      if (live && sh > 0) addUproar(w, VS.tender.rewardUproar * sh);
      if (i === top) {
        w.upgrades.chestDrafts++;                    // the wreck's chest: the CARD RAIL rolls it as a rare+ offer
        w.events.push({ type: 'chest', x: b.x, z: b.z });
      }
    });
  }
  // CALL DROPPED: the surviving adds stand still
  const snap = ADDS.get(b);
  if (snap) {
    for (let i = 0; i < snap.length; i++) {
      const id = snap[i];
      for (let k = 0; k < w.enemies.length; k++) {
        const e = w.enemies[k];
        if (e.id === id) { if (e.alive) e.stun = Math.max(e.stun, CALL_DROPPED_S); break; }
      }
    }
  }
  ADDS.delete(b);
  t.state = 'paid';
  emitAs(w, -1, { type: 'tenderPaid', gate: t.gate, shares, top });
}
