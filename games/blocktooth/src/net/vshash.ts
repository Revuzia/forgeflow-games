// BLOCKTOOTH - net/vshash.ts (lane GATE 2026-10-05, widened by lane O-PORT). The VS part of the lockstep / cross-engine world hash.
//
// CORE's contract left this open ("src/net/simport.ts hashWorld hashes only the cursor"): in a VS world every seat's
// titan, build, CARD RAIL, VS record and bot memory, and the world-level VS state (phase, crown, ring, tenders, result),
// must reach the state hash, or a desync in seat 2 would go unseen while seat 0 agrees. This file FLATTENS that state into
// a list of numbers / strings (sorted keys, Infinity kept as its float bits) that any hasher can consume, so simport.ts
// (lockstep) and _harness/net/xbrowser_entry.ts (cross-engine gate) hash exactly the same fields. Solo worlds never call it.
// Reads the world, never writes. THREE-free, no clocks, no randomness.
//
// Two layers:
//   vsStateFlat(w, out)  the explicit per-seat + VS-world list (the original GATE field list, kept so older logs still read)
//   vsFullFlat(w, out)   vsStateFlat + a GENERIC deep flatten of every plain-data container the sim owns: each seat's
//                        titan (incl. stats + kit), upgrades, ult, tally, director, meta, rail, bot memory, sleeper and VS
//                        record, the whole of World.vs, every live enemy / pickup / projectile / telegraph / hazard, the
//                        boss, the map (objectives, power-ups), the gate counters. The generic walk sorts object keys, so a
//                        field added to a container later is hashed without touching this file.
// The cursor (w.titan / w.upgrades ...) is NEVER read here: it points at the VIEW seat, which differs per peer.

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

const MAX_DEPTH = 8;

/** Deep, order-independent flatten of plain data: numbers and strings as they are, booleans 0/1, null / undefined as markers,
 *  arrays in index order, objects / Maps with SORTED keys, Sets sorted, functions skipped. Depth-capped (cycles end). */
export function flatAny(v: unknown, out: HashAtom[], depth = 0): void {
  switch (typeof v) {
    case 'number': out.push(v); return;
    case 'string': out.push(v); return;
    case 'boolean': out.push(v ? 1 : 0); return;
    case 'undefined': out.push('~u'); return;
    case 'function': case 'symbol': return;
    case 'bigint': out.push(Number(v)); return;
    default: break;
  }
  if (v === null) { out.push('~n'); return; }
  if (depth >= MAX_DEPTH) { out.push('~d'); return; }
  if (Array.isArray(v)) {
    out.push('[', v.length);
    for (let i = 0; i < v.length; i++) flatAny(v[i], out, depth + 1);
    return;
  }
  if (v instanceof Map) {
    const es = [...v.entries()].map((e): [string, unknown] => [String(e[0]), e[1]]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    out.push('M', v.size);
    for (const e of es) { out.push(e[0]); flatAny(e[1], out, depth + 1); }
    return;
  }
  if (v instanceof Set) {
    out.push('S', v.size);
    for (const k of [...v.values()].map(String).sort()) out.push(k);
    return;
  }
  const o = v as Record<string, unknown>;
  const ks = Object.keys(o).sort();
  out.push('{', ks.length);
  for (let i = 0; i < ks.length; i++) {
    const x = o[ks[i]];
    if (typeof x === 'function') continue;
    out.push(ks[i]);
    flatAny(x, out, depth + 1);
  }
}

/** Entity pools: live entries only, in array order (the sim's own deterministic order), preceded by the live count. */
function flatPool(arr: readonly { alive: boolean }[], out: HashAtom[]): void {
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i].alive) n++;
  out.push('P', n);
  for (let i = 0; i < arr.length; i++) if (arr[i].alive) flatAny(arr[i], out, 1);
}

/** The whole VS lockstep state: vsStateFlat plus the generic deep walk (see the header). Never reads the cursor. */
export function vsFullFlat(w: World, out: HashAtom[]): void {
  if (w.mode !== 'vs' || !w.vs) return;
  vsStateFlat(w, out);
  out.push('full');
  for (const p of w.players) {
    flatAny(p.titan, out); flatAny(p.upgrades, out); flatAny(p.ult, out); flatAny(p.tally, out);
    flatAny(p.director, out); flatAny(p.meta, out); flatAny(p.rail, out); flatAny(p.run, out);
    flatAny(p.bot, out); flatAny(p.vs, out);
  }
  flatAny(w.vs, out);
  flatPool(w.enemies, out); flatPool(w.pickups, out); flatPool(w.projectiles, out); flatPool(w.telegraphs, out); flatPool(w.hazards, out);
  flatAny(w.boss, out);
  flatAny(w.map, out);
  flatAny(w.gates, out);
  flatAny(w.run, out);
  out.push(w.tick, w.t, w.nextId);
}
