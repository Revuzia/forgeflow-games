// BLOCKTOOTH - net/vshash.ts (lane GATE, 2026-10-05). The VS part of the lockstep / cross-engine world hash.
//
// CORE's contract left this open ("src/net/simport.ts hashWorld hashes only the cursor"): in a VS world every seat's
// titan, build, CARD RAIL, VS record and bot memory, and the world-level VS state (phase, crown, ring, tenders, result),
// must reach the state hash, or a desync in seat 2 would go unseen while seat 0 agrees. This file FLATTENS that state into
// a list of numbers / strings (sorted keys, Infinity mapped to -1) that any hasher can consume, so simport.ts (lockstep)
// and _harness/net/xbrowser_entry.ts (cross-engine gate) hash exactly the same fields. Solo worlds never call it.
// Reads the world, never writes. THREE-free, no clocks, no randomness.

import type { World } from '../core/types.ts';

export type HashAtom = number | string;

function fin(x: number): number { return Number.isFinite(x) ? x : -1; }

/** Append the flattened per-seat + world VS state of a VS world to `out`. No-op for a solo world. */
export function vsStateFlat(w: World, out: HashAtom[]): void {
  if (w.mode !== 'vs' || !w.vs) return;
  out.push('vs', w.players.length);
  for (const p of w.players) {
    const T = p.titan;
    out.push(p.slot, p.titanId, T.alive ? 1 : 0,
      T.x, T.z, T.heading, T.vx, T.vz, T.hp, T.maxHp, T.mass, T.xp, T.xpToNext, T.level, T.rank, T.height, T.radius,
      T.kills, T.crushed, T.floorsEaten, T.buildingsLeveled, T.propsEaten, T.damageTaken, T.abilityCd, T.dashCharges);
    const owned = Object.keys(p.upgrades.owned).sort();
    for (const k of owned) out.push(k, p.upgrades.owned[k]);
    out.push(p.upgrades.pendingDrafts, p.upgrades.chestDrafts, p.upgrades.offer ? p.upgrades.offer.length : -1);
    if (p.upgrades.offer) for (const id of p.upgrades.offer) out.push(id);
    const R = p.rail;
    out.push(R.open ? 1 : 0, R.openedT, fin(R.expireT), R.chest ? 1 : 0, R.seq, R.sinceDraft, R.openingDone ? 1 : 0);
    const rd = Object.keys(R.data).sort();
    for (const k of rd) out.push(k, R.data[k]);
    const V = p.vs;
    out.push(V.eliminated ? 1 : 0, V.elimT, V.place, V.respawnT, V.spawnProtT, V.clearedT, V.koCount, V.evictions, V.assists,
      V.pvpDealt, V.pvpTaken, V.tenderBids, V.tenderTop, V.crownS, V.peakRank, V.score, V.lastKillerSlot);
    for (const t of V.rankT) out.push(t);
    for (const h of V.hits) out.push(h.from, h.t, h.pct);
    const vd = Object.keys(V.data).sort();
    for (const k of vd) out.push(k, V.data[k]);
    out.push(p.run.tonnage, p.run.blocksLeveled, p.run.peakRank);
    const B = p.bot;
    if (B) out.push(1, B.level, B.mode, B.targetSlot, B.modeT, B.engagedTick, B.fleeUntil, B.railSeq, B.tx, B.tz, B.hasTarget ? 1 : 0, B.planTick);
    else out.push(0);
  }
  const v = w.vs;
  out.push(v.phase, v.phaseT, v.startT, v.crown, v.winner, v.endT);
  const R = v.ring;
  out.push(R.cx, R.cz, R.r, R.fromR, R.toR, R.t0, R.t1, R.step, R.r0, R.mortarT);
  for (const t of v.tenders) {
    out.push(t.gate, t.state, t.x, t.z, t.spawnSlot, t.markerT, t.spawnT, t.targetSlot, t.retargetT, t.ignoredS);
    for (const d of t.dmg) out.push(d);
  }
  for (const s of v.order) out.push(s);
  const vd = Object.keys(v.data).sort();
  for (const k of vd) out.push(k, v.data[k]);
}
