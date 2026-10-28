// GENESIS — the people and their god: the relationship model (LIVING.md §3.1).
//
// Four values per person per god (GODS = 4, 0 = the player), each 0..1:
//   faith    conviction that the god is real and acts            (AgentStore.faith)
//   fear     dread of its power                                    (AgentStore.fear)
//   trust    expectation that it means them well                   (AgentStore.love — the UI says "trust")
//   loyalty  allegiance: whose word they follow, whose shrine they keep (AgentStore.loyalty)
// Settlement values are member means (rel.st[..].means, daily). Each settlement keeps a short RECORD of the god's acts on
// it (the last 12: kind, tick, dead, foretold, provoked), its open prayers (god/prayers.ts) and its prophet
// (god/prophets.ts).
//
// What an act does is decided per witness by what the act IS to them (§3.1 table):
//   help        faith +0.15 m k, trust +0.25 m k a (0.5 + p)
//   mercy       help within 3 days after the god harmed them: also fear −0.10 m k, trust ×1.5, loyalty +0.05 m
//   harm        foretold (a prophet warned, an omen within 2 days): faith +0.20, fear +0.30 · f (0.6 + 0.5 (1 − b))
//               provoked (a taboo broken, the Called or the prophet attacked): the same, trust −0.05
//               unprovoked (cruelty): faith +0.15, fear +0.35 ·, trust −0.20, loyalty −0.05 m
//   sign        a wonder that harmed no one: faith +0.25, fear +0.08 f, trust +0.05 where it is read as favour
//   an act that KILLED someone counts as harm, never as a wonder (a 9-death tornado used to raise love 0.08 → 0.85).
// No single act moves a settlement's mean trust or fear by more than 0.35 (the anti-saturation rule the creature and
// the disciple broke): every act — a command, a disaster's whole life, a thing thrown — carries a budget per settlement.
//
// Daily drift: faith −1 %/day after 3 days without a sign of the god (−0.3 % when seen), fear −4.5 %/day (−1 % when
// seen), trust −0.5 %/day, loyalty relaxes toward faith × clamp(trust + 0.5 fear) at 5 %/day. REGARD — how the people see
// the god, the value the Touch's look follows — is trust − fear over the people with faith > 0.2, population-weighted:
// −1 feared … +1 trusted (bands feared < −0.33 ≤ awed ≤ 0.33 < trusted).
//
// Natural disasters are read as the god's only by people whose faith in it is above 0.3.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Settlement } from '../people/state.ts';
import type { PCtx } from '../people/ctx.ts';
import type { ActRecord, RelState, SettlementRel } from './state.ts';
import type { TypedArray } from '../core/hash.ts';
import { emptyRel } from './state.ts';
import { AgentFlag } from '../types.ts';
import { GODS, MEMK, NT, TRAIT } from '../people/defs.ts';
import { speciesInfo } from '../people/ctx.ts';

// ───────────────────────────── the universe a planet belongs to ─────────────────────────────

/** witness() is handed a planet only: the god layer binds each planet to its universe (every command and tick) */
const uniOf = new WeakMap<Planet, Universe>();

export function bindUniverse(u: Universe): void {
  for (const p of u.planets) uniOf.set(p, u);
}

export function universeOf(p: Planet): Universe | undefined {
  return uniOf.get(p);
}

// ───────────────────────────── per-settlement state ─────────────────────────────

export function relKey(planet: number, sid: number): string {
  return `${planet}:${sid}`;
}

export function relOf(u: Universe): RelState {
  return (u.god.rel ??= emptyRel());
}

/** a settlement's relationship record (made on first use) */
export function srel(u: Universe, planet: number, sid: number): SettlementRel {
  const R = relOf(u);
  const k = relKey(planet, sid);
  let r = R.st[k];
  if (!r) {
    r = { acts: [], prayers: [], lapses: 0, means: [0, 0, 0, 0], omens: {}, evacuate: null, animal: '', since: {} };
    R.st[k] = r;
  }
  return r;
}

export function peekRel(u: Universe, planet: number, sid: number): SettlementRel | undefined {
  return u.god.rel?.st[relKey(planet, sid)];
}

export function relStat(u: Universe, k: string, add = 1): void {
  const s = relOf(u).stats;
  s[k] = Math.round(((s[k] ?? 0) + add) * 1000) / 1000;
}

// ───────────────────────────── a person's four values ─────────────────────────────

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** over this last share of the way to 1, faith and trust grow ever more slowly (0.5: from the middle up; 0.3 still let
 * the prophet's town reach trust 0.913, 0.4 faith 0.976 — tests/living-integration.test.ts) */
export const RISE_TAPER = 0.5;
/**
 * LIVING integration (2026-10-20, §3.8 "no pinned meter"): faith or trust v raised by d — in full below 1 − RISE_TAPER,
 * tapering to nothing at 1 (a fall is taken in full). Each act stayed inside its budget, but a few good acts in a row
 * still pinned the meters: on the acceptance worlds a prophet whose three prophecies the god made true left trust at
 * 0.91–0.97 in half the towns (the lane's own fixture 0.88), and faith at 0.95–1.0 in every one.
 */
export function rise(v: number, d: number): number {
  if (d <= 0) return clamp01(v + d);
  return clamp01(v + d * Math.min(1, (1 - v) / RISE_TAPER));
}

/** (fix r2 #8/#19) trust's taper is steeper than faith's: over its upper half a gain shrinks with ((1 − v) / RISE_TAPER) to
 *  this power. Trust is the slow-built half of the bond (owner: "they build their relationship with the god"): seven
 *  prayers answered in eight days after a meteor took mean trust to 0.93 (review-owner/loop.ts 'answered', seeds 1/2),
 *  and a drought answered over six days to 0.95–0.97 (god50 sessions) */
export const TRUST_TAPER_EXP = 1.5;
export function riseTrust(v: number, d: number): number {
  if (d <= 0) return clamp01(v + d);
  return clamp01(v + d * Math.min(1, Math.pow(Math.max(0, 1 - v) / RISE_TAPER, TRUST_TAPER_EXP)));
}

/**
 * A person the relationship has not touched yet (born, spawned, come back from a cohort, a crew member landed): their
 * faith and loyalty are set from what they hold — faith = min(1, trust + fear), loyalty = 0.5 × trust (the 1.4 save
 * migration's rule) — and a child raised among the faithful takes up part of their settlement's faith.
 */
export function freshen(A: { faith: Float32Array; loyalty: Float32Array; love: Float32Array; fear: Float32Array }, s: number, means?: ArrayLike<number> | null): void {
  const i = s * GODS;
  if (A.faith[i] !== 0 || A.loyalty[i] !== 0) return;
  for (let g = 0; g < GODS; g++) {
    const love = A.love[i + g], fear = A.fear[i + g];
    if (love + fear <= 0) continue;
    A.faith[i + g] = Math.min(1, love + fear);
    A.loyalty[i + g] = 0.5 * love;
  }
  if (means && A.faith[i] < 0.6 * means[0]) A.faith[i] = 0.6 * means[0];
  if (means && A.loyalty[i] < 0.5 * means[3]) A.loyalty[i] = 0.5 * means[3];
  // (never exactly zero once touched: a person who believes nothing at all keeps a trace, so they are not "fresh" again)
  if (A.faith[i] === 0) A.faith[i] = 1e-4;
}

/** after a load: a save from before 1.5 has no faith or loyalty columns — fill them from love and fear (LIVING §3.1) */
export function relAfterLoad(u: Universe, blobs: Map<string, TypedArray>): void {
  bindUniverse(u);
  for (const p of u.planets) {
    if (blobs.has(`p${p.id}.a.faith`)) continue;
    const A = p.people?.agents;
    if (!A) continue;
    for (let s = 0; s < A.hi; s++) {
      if (!A.alive[s]) continue;
      for (let g = 0; g < GODS; g++) {
        const i = s * GODS + g;
        A.faith[i] = Math.min(1, A.love[i] + A.fear[i]);
        A.loyalty[i] = 0.5 * A.love[i];
      }
      if (A.faith[s * GODS] === 0) A.faith[s * GODS] = 1e-4;
    }
  }
}

// ───────────────────────────── the act in progress ─────────────────────────────

/** an act of a god: a command, one disaster over its whole life, a thing thrown — what witnesses make of it */
export interface ActCtx {
  /** budget store (a disaster keeps it in its own state, so a save mid-disaster goes on with the same budget) */
  store: Record<string, number>;
  key: string;
  god: number;
  /** a natural event: read as the god's only by people with faith > 0.3 */
  natural: boolean;
  /** it killed someone: every reading of it is harm */
  killed: boolean;
  /** members killed per settlement ("<planet>:<sid>") */
  dead: Record<string, number>;
  /** settlements whose members witnessed it, and what it was to them */
  seen: Map<string, { kind: string; foretold: boolean; provoked: boolean; planet: number; sid: number }>;
  /** the command kind (or 'disaster:<kind>', 'thrown') */
  what: string;
}

const stack: ActCtx[] = [];

export function currentAct(): ActCtx | null {
  return stack.length ? stack[stack.length - 1] : null;
}

/** open an act (the registry's before-hook for commands; disasters around their effects; landings) */
export function beginAct(u: Universe | null, o: { key: string; god: number; natural?: boolean; store?: Record<string, number>; what: string }): ActCtx {
  if (u) bindUniverse(u);
  const ctx: ActCtx = {
    store: o.store ?? {}, key: o.key, god: o.god, natural: !!o.natural, killed: (o.store?.killed ?? 0) > 0, dead: {}, seen: new Map(), what: o.what,
  };
  stack.push(ctx);
  return ctx;
}

/**
 * fix r1 #5: told when a god's act that is not a command (a disaster, a thrown thing: keys `d…`, `pr…`) first comes
 * to harm a settlement, so a prophecy of harm the god then makes true is fulfilled and prayers are answered as for a
 * command's act (god/relationship.ts sets it; commands go through its own afterAct). Deduplicated by the act's key in
 * the settlement's saved `acts`, so it needs no state of its own.
 */
export const actHooks: { harm: ((u: Universe, planet: number, sid: number, god: number) => void) | null } = { harm: null };

/** close the act: each settlement that saw it remembers it (merged into the record of the same act) */
export function endAct(u: Universe | null, ctx: ActCtx): void {
  const i = stack.lastIndexOf(ctx);
  if (i >= 0) stack.splice(i, 1);
  if (!u || !ctx.seen.size && !Object.keys(ctx.dead).length) return;
  if (ctx.killed) ctx.store.killed = 1;
  const keys = new Set<string>([...ctx.seen.keys(), ...Object.keys(ctx.dead)]);
  const delayed = !ctx.natural && ctx.key.charCodeAt(0) !== 99 /* c: a command, afterAct's */ && actHooks.harm !== null;
  let harmed: [number, number][] | null = null;
  for (const k of [...keys].sort()) {
    const seen = ctx.seen.get(k);
    const [pl, sid] = k.split(':').map(Number);
    const r = srel(u, pl, sid);
    const dead = ctx.dead[k] ?? 0;
    const kind = ctx.killed || dead > 0 ? 'harm' : seen?.kind ?? 'harm';
    if (delayed && kind === 'harm' && !r.acts.some((q) => q.key === ctx.key && q.kind === 'harm')) (harmed ??= []).push([pl, sid]);
    const last = r.acts.length ? r.acts[r.acts.length - 1] : null;
    if (last && last.key === ctx.key) {
      last.dead += dead;
      if (kind === 'harm') last.kind = 'harm';
      last.foretold ||= !!seen?.foretold;
      last.provoked ||= !!seen?.provoked;
      continue;
    }
    const rec: ActRecord = { kind, tick: u.tick, god: ctx.god, dead, foretold: !!seen?.foretold, provoked: !!seen?.provoked, key: ctx.key };
    r.acts.push(rec);
    if (r.acts.length > 12) r.acts.splice(0, r.acts.length - 12);
  }
  if (harmed) for (const [pl, sid] of harmed) actHooks.harm!(u, pl, sid, ctx.god);
}

/** a person was killed by the act in progress (god/harm.ts) */
export function noteDeath(p: Planet | number, sid: number): void {
  const ctx = currentAct();
  if (!ctx) return;
  ctx.killed = true;
  if (sid < 0) return;
  const k = relKey(typeof p === 'number' ? p : p.id, sid);
  ctx.dead[k] = (ctx.dead[k] ?? 0) + 1;
}

// ───────────────────────────── witnessing (people/culture.ts witness) ─────────────────────────────

/** is this harm foretold here: an open prophecy of harm (or a sign) for the settlement, or an omen within 2 days */
function foretoldAt(u: Universe, p: Planet, sid: number, tick: number, day: number): boolean {
  const R = u.god.rel;
  if (!R) return false;
  for (const ph of R.prophecies) if (ph.planet === p.id && ph.settlement === sid && ph.kind === 'harm' && ph.from <= tick && tick <= ph.until) return true;
  const r = R.st[relKey(p.id, sid)];
  if (!r) return false;
  for (const a of r.acts) if (a.kind.startsWith('omen') && tick - a.tick <= 2 * day && tick >= a.tick) return true;
  for (const t of Object.values(r.omens)) if (tick - t <= 2 * day && tick > t) return true;
  return false;
}

/** did they earn it: a taboo broken, the Called or the prophet attacked, within 3 days */
function provokedAt(u: Universe, p: Planet, sid: number, tick: number, day: number): boolean {
  const r = u.god.rel?.st[relKey(p.id, sid)];
  const t = r?.since.provoked;
  return t !== undefined && tick - t <= 3 * day && tick >= t;
}

/** did the god harm them within the last 3 days (mercy) */
function harmedLately(u: Universe, p: Planet, sid: number, tick: number, day: number, god: number): boolean {
  const r = u.god.rel?.st[relKey(p.id, sid)];
  if (!r) return false;
  for (const a of r.acts) if (a.god === god && a.kind === 'harm' && tick - a.tick <= 3 * day) return true;
  return false;
}

export type WitnessKind = 'help' | 'harm' | 'wonder';

/** what a witnessing is in the end: a wonder of an act that killed someone is harm */
export function effectiveKind(kind: WitnessKind): WitnessKind {
  return kind !== 'help' && currentAct()?.killed ? 'harm' : kind;
}

// scratch per call (witness runs one at a time)
let _idx = new Int32Array(256);
let _d = new Float32Array(256 * 5);
const _pt = [0, 0, 0];

function ensure(n: number): void {
  if (_idx.length >= n) return;
  let m = _idx.length;
  while (m < n) m *= 2;
  _idx = new Int32Array(m);
  _d = new Float32Array(m * 5);
}

/**
 * Every person within `radius` of `pos` witnesses an act of god `g` (help / harm / wonder of magnitude `mag` 0..2): their
 * faith, fear, trust and loyalty move by what the act is to them (the §3.1 table), within the act's budget per
 * settlement. Returns the number of witnesses; marks them as having seen the god.
 */
export function witnessAct(p: Planet, pos: ArrayLike<number>, radius: number, kind: WitnessKind, mag: number, g: number): number {
  const ps = p.people;
  const c = ps?.contentRef;
  if (!ps || !c) return 0;
  const A = ps.agents;
  if (A.count === 0) return 0;
  const u = universeOf(p) ?? null;
  const info = speciesInfo(c);
  const tick = ps.now;
  const day = Math.max(60, Math.round(p.st.dayHours * 60));
  const R = p.st.radius;
  const ctx = currentAct();
  // the act's own budget when one is open, else this witnessing alone is the act
  const store = ctx ? ctx.store : {};
  const killed = !!ctx?.killed;
  const natural = !!ctx?.natural;
  // what the act is to each settlement (decided once per call)
  const cls = new Map<number, { kind: string; foretold: boolean; provoked: boolean; mercy: boolean; favour: boolean }>();
  const classify = (sid: number) => {
    let o = cls.get(sid);
    if (o) return o;
    const eff = killed && kind !== 'help' ? 'harm' : kind;
    const r = u && sid >= 0 ? u.god.rel?.st[relKey(p.id, sid)] : undefined;
    const foretold = eff === 'harm' && !!u && sid >= 0 && foretoldAt(u, p, sid, tick, day);
    const provoked = eff === 'harm' && !foretold && !!u && sid >= 0 && provokedAt(u, p, sid, tick, day);
    const mercy = eff === 'help' && !!u && sid >= 0 && harmedLately(u, p, sid, tick, day, g);
    const favour = !r || r.means[2] >= r.means[1];
    o = { kind: eff === 'help' ? (mercy ? 'mercy' : 'help') : eff === 'harm' ? 'harm' : 'sign', foretold, provoked, mercy, favour };
    cls.set(sid, o);
    return o;
  };
  // pass 1: the deltas of everyone in reach; sums per settlement for the budget
  ensure(A.hi);
  let n = 0;
  const sumF = new Map<number, number>(), sumT = new Map<number, number>();
  for (let s = 0; s < A.hi; s++) {
    if (!A.alive[s]) continue;
    A.posAt(s, tick, _pt);
    const d0 = _pt[0] * pos[0] + _pt[1] * pos[1] + _pt[2] * pos[2];
    const d = Math.acos(d0 > 1 ? 1 : d0 < -1 ? -1 : d0) * R;
    if (d > radius) continue;
    const i = s * GODS + g;
    freshen(A, s);
    const sid = A.settlement[s];
    const k = 1 - d / Math.max(1, radius);
    const mk = mag * k;
    const sp = info[A.species[s]].def;
    const a = sp.god.awe, f = sp.god.fear;
    const pi = A.traits[s * NT + TRAIT.piety];
    const b = A.traits[s * NT + TRAIT.boldness];
    const o = classify(sid);
    let dF = 0, dFe = 0, dT = 0, dL = 0;
    // a natural event is the god's only to those who believe it acts
    if (!(natural && A.faith[i] <= 0.3)) {
      const fk = f * (0.6 + 0.5 * (1 - b));
      if (o.kind === 'help' || o.kind === 'mercy') {
        dF = 0.15 * mk;
        dT = 0.25 * mk * a * (0.5 + pi);
        if (o.mercy) { dFe = -0.1 * mk; dT *= 1.5; dL = 0.05 * mag; }
      } else if (o.kind === 'harm') {
        if (o.foretold) { dF = 0.2 * mk; dFe = 0.3 * mk * fk; }
        else if (o.provoked) { dF = 0.2 * mk; dFe = 0.3 * mk * fk; dT = -0.05 * mk; }
        else { dF = 0.15 * mk; dFe = 0.35 * mk * fk; dT = -0.2 * mk; dL = -0.05 * mag; }
      } else {
        dF = 0.25 * mk;
        dFe = 0.08 * mk * f;
        if (o.favour) dT = 0.05 * Math.min(1, mk);
      }
    }
    _idx[n] = s;
    _d[n * 5] = dF; _d[n * 5 + 1] = dFe; _d[n * 5 + 2] = dT; _d[n * 5 + 3] = dL; _d[n * 5 + 4] = o.kind === 'harm' ? -mk : mk;
    if (sid >= 0) { sumF.set(sid, (sumF.get(sid) ?? 0) + dFe); sumT.set(sid, (sumT.get(sid) ?? 0) + dT); }
    n++;
  }
  if (!n) return 0;
  // pass 2: no act moves a settlement's mean trust or fear by more than 0.35 (whatever it does over its whole life)
  const kF = new Map<number, number>(), kT = new Map<number, number>();
  for (const [sid, sf] of sumF) {
    const members = ps.members.get(sid)?.length ?? 1;
    const keyF = `bf${p.id}:${g}:${sid}`, keyT = `bt${p.id}:${g}:${sid}`;
    const mf = sf / Math.max(1, members), mt = (sumT.get(sid) ?? 0) / Math.max(1, members);
    const usedF = store[keyF] ?? 0, usedT = store[keyT] ?? 0;
    const rf = Math.abs(mf) > 1e-9 ? Math.max(0, Math.min(1, (0.35 - Math.abs(usedF)) / Math.abs(mf))) : 1;
    const rt = Math.abs(mt) > 1e-9 ? Math.max(0, Math.min(1, (0.35 - Math.abs(usedT)) / Math.abs(mt))) : 1;
    kF.set(sid, rf); kT.set(sid, rt);
    if (Math.abs(mf) > 1e-9) store[keyF] = Math.round((usedF + Math.abs(mf) * rf) * 1e5) / 1e5;
    if (Math.abs(mt) > 1e-9) store[keyT] = Math.round((usedT + Math.abs(mt) * rt) * 1e5) / 1e5;
  }
  for (let j = 0; j < n; j++) {
    const s = _idx[j];
    const sid = A.settlement[s];
    const i = s * GODS + g;
    const rf = sid >= 0 ? kF.get(sid) ?? 1 : Math.min(1, 0.35 / Math.max(0.35, Math.abs(_d[j * 5 + 1])));
    const rt = sid >= 0 ? kT.get(sid) ?? 1 : Math.min(1, 0.35 / Math.max(0.35, Math.abs(_d[j * 5 + 2])));
    A.faith[i] = rise(A.faith[i], _d[j * 5]);
    A.fear[i] = clamp01(A.fear[i] + _d[j * 5 + 1] * rf);
    A.love[i] = riseTrust(A.love[i], _d[j * 5 + 2] * rt);
    A.loyalty[i] = clamp01(A.loyalty[i] + _d[j * 5 + 3]);
    A.flags[s] |= AgentFlag.sees_god;
    // a strong sight is remembered: a miracle, or a fright
    const mk = _d[j * 5 + 4];
    if (Math.abs(mk) >= 0.15) A.remember(s, mk < 0 ? MEMK.fear : MEMK.miracle, tick, -1);
  }
  // the act's record: which settlements saw it and what it was to them
  if (ctx) {
    for (const [sid, o] of cls) {
      if (sid < 0) continue;
      const k = relKey(p.id, sid);
      const prev = ctx.seen.get(k);
      if (!prev || o.kind === 'harm') ctx.seen.set(k, { kind: o.kind, foretold: o.foretold, provoked: o.provoked, planet: p.id, sid });
    }
  }
  return n;
}

// ───────────────────────────── settlement-wide deltas (prayers, prophecies, omens read) ─────────────────────────────

/** move every member of a settlement (prayer answered / lapsed, a prophecy fulfilled / failed, an omen read) */
export function moveSettlement(x: PCtx, st: Settlement, d: { faith?: number; fear?: number; trust?: number; loyalty?: number }, g = 0): void {
  const A = x.A;
  const means = x.u.god.rel?.st[relKey(x.p.id, st.id)]?.means;
  for (const s of x.ps.members.get(st.id) ?? []) {
    freshen(A, s, means);
    const i = s * GODS + g;
    if (d.faith) A.faith[i] = rise(A.faith[i], d.faith);
    if (d.fear) A.fear[i] = clamp01(A.fear[i] + d.fear);
    if (d.trust) A.love[i] = riseTrust(A.love[i], d.trust);
    if (d.loyalty) A.loyalty[i] = clamp01(A.loyalty[i] + d.loyalty);
  }
}

// ───────────────────────────── daily drift, means, regard ─────────────────────────────

/**
 * Once a day per settlement (people/culture.ts cultureDaily): the drift of every member's four values, and the member
 * means kept on the settlement's record. `seen`: the god was seen there in the last 3 days.
 */
export function relDaily(x: PCtx, st: Settlement, seen: boolean): [number, number, number, number] {
  const A = x.A;
  const members = x.ps.members.get(st.id) ?? [];
  const dk = x.u.god.law('belief.decay');
  const r = srel(x.u, x.p.id, st.id);
  const fk = 1 - (seen ? 0.003 : 0.01) * dk;
  const ek = 1 - (seen ? 0.01 : 0.045) * dk;
  const tk = 1 - 0.005 * dk;
  const m = [0, 0, 0, 0];
  for (const s of members) {
    freshen(A, s, r.means);
    for (let g = 0; g < GODS; g++) {
      const i = s * GODS + g;
      if (A.faith[i] === 0 && A.love[i] === 0 && A.fear[i] === 0) continue;
      A.faith[i] = A.faith[i] * fk;
      A.fear[i] = A.fear[i] * ek;
      A.love[i] = A.love[i] * tk;
      const target = A.faith[i] * clamp01(A.love[i] + 0.5 * A.fear[i]);
      A.loyalty[i] = A.loyalty[i] + (target - A.loyalty[i]) * 0.05;
    }
    const i0 = s * GODS;
    m[0] += A.faith[i0]; m[1] += A.fear[i0]; m[2] += A.love[i0]; m[3] += A.loyalty[i0];
  }
  const n = Math.max(1, members.length);
  r.means = [r3(m[0] / n), r3(m[1] / n), r3(m[2] / n), r3(m[3] / n)];
  return r.means;
}

/** a settlement's four values toward god g, now (member means) */
export function meansNow(x: PCtx, st: Settlement, g = 0): { faith: number; fear: number; trust: number; loyalty: number; n: number } {
  const A = x.A;
  const members = x.ps.members.get(st.id) ?? [];
  let f = 0, e = 0, t = 0, l = 0;
  for (const s of members) { const i = s * GODS + g; f += A.faith[i]; e += A.fear[i]; t += A.love[i]; l += A.loyalty[i]; }
  const n = Math.max(1, members.length);
  return { faith: r3(f / n), fear: r3(e / n), trust: r3(t / n), loyalty: r3(l / n), n: members.length };
}

/**
 * Regard of god g across every world: trust − fear over the people whose faith in it is above 0.2, population-weighted,
 * −1 (feared) … +1 (trusted); 0 when nobody believes in it yet.
 */
export function regardOf(u: Universe, g = 0): number {
  let sum = 0, n = 0;
  for (const p of u.planets) {
    const A = p.people?.agents;
    if (!A || !A.count) continue;
    for (let s = 0; s < A.hi; s++) {
      if (!A.alive[s]) continue;
      const i = s * GODS + g;
      if (A.faith[i] <= 0.2) continue;
      sum += A.love[i] - A.fear[i];
      n++;
    }
  }
  return n ? r3(Math.max(-1, Math.min(1, sum / n))) : 0;
}

export function regardBand(v: number): 'feared' | 'awed' | 'trusted' {
  return v < -0.33 ? 'feared' : v > 0.33 ? 'trusted' : 'awed';
}

function r3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
