// GENESIS — reach (_spec/POWERS-GROWTH.md v3): the god grows as belief grows, by two roads, and spends what the people
// gather. Everything here runs ONLY in a bound world (`'reach.bound' in god.laws`, GodState.bound); an unbound world
// (every old save, the sandbox setting) never enters this module's writers and keeps no reach state.
//
//   measure   once a game day (1 440 ticks): the grown, living people of towns the god has been SEEN in who believe
//             (faith >= 0.30) are believers. A believer who trusts (trust >= 0.50) is on the road of trust, one who fears
//             (fear >= 0.35, kept down to 0.04) on the road of fear; a person may be on both. Each believer counts 1,
//             plus 1 if on either road (both roads still 1: a mixed god is neither weaker nor stronger). F = the sum.
//   standing  Unknown, Whispered, Known, Worshipped, Most High. It rises one step when F (or the share S) has been at the
//             next line for that line's hold (a larger Following holds up to twice as fast), and falls one step after
//             `grace` days in a row under 0.7 x its own line.
//   worship   the existing pool (ps.worship[0]). Every writer pays through credit(): no more than the town's daily
//             measure, no more than the cap. NO income without believers (owner 2026-11-16, second ruling).
//   charge    every power that is not on the free list costs its `price` (powers.json) x size; a power one band up costs
//             3 x; further up is refused. Checked before the handler, taken only after it succeeds (god/powers.ts).
//
// Deterministic: whole-number counting in planet id / agent index / settlement id order, pool arithmetic in hundredths,
// no RNG, no clock but u.tick.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Command } from '../types.ts';
import type { PowerDef } from '../content.ts';
import type { ReachState } from './state.ts';
import { AgentFlag } from '../types.ts';
import { GODS, NT, TRAIT } from '../people/defs.ts';

export const REACH = {
  names: ['Unknown', 'Whispered', 'Known', 'Worshipped', 'Most High'],
  /** the believer line (the float32 tolerance defiance.ts uses) */
  believe: 0.30 - 1e-4,
  trustLine: 0.50, trustKeep: 0.50,
  fearLine: 0.35, fearKeep: 0.04,
  /** F a standing needs; or the share S with at least shareF following */
  f: [0, 3, 30, 150, 500],
  share: [0, 0, 0.5, 0.7, 0.85],
  shareF: [0, 0, 12, 60, 200],
  /** game days the line must have held (a Following up to twice the line holds up to twice as fast) */
  hold: [0, 1, 30, 150, 360],
  /** a day under the line takes this many held days back */
  slip: 2,
  fallAt: 0.7,
  grace: 12,
  capBase: [40, 80, 260, 640, 2600],
  capPerF: 3,
  /** a brand-new bound world starts with this much (the Unknown cap) */
  start: 40,
  /** the first time a standing is reached: one typical cast of its band */
  gift: [0, 10, 20, 100, 400],
  rite: 1,
  /** how much of a person's giving terror (fear 0.8 -> 1.0) takes away */
  terror: 0.2,
  unattended: 0.5,
  attendedDays: 3,
  beyond: 3,
  popMin: 12,
  popEase: 0.02 / 12,
  /** free basics that can be repeated carry a cooldown (ticks) in a bound world */
  freeCooldown: { rain: 60, lightning: 60, 'heal-person': 30, gift: 120, ignite: 60, extinguish: 30 } as Record<string, number>,
} as const;

export function isBound(u: Universe): boolean {
  return u.god.bound;
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function emptyReach(): ReachState {
  return { tier: 0, best: 0, up: 0, down: 0, popMax: REACH.popMin, f: 0, believers: 0, trust: 0, fear: 0, both: 0, inc: 0, incT: 0, incF: 0, day: 0, seen: {}, towns: {}, roads: {}, peopled: {} };
}

function pool(u: Universe): number {
  let w = 0;
  for (const pl of u.planets) w += pl.people?.worship[0] ?? 0;
  return r2(w);
}

export function capOf(u: Universe): number {
  const R = u.god.reach;
  return R ? REACH.capBase[R.tier] + REACH.capPerF * R.f : Infinity;
}

/**
 * Bind or unbind (the setting; `meta.reach`). A first bind creates the state; `fresh` (a brand-new world) also gives
 * the starting pool. Every later bind clamps the pool to the cap. Unbinding keeps the state (best, roads) for good.
 */
export function setBound(u: Universe, on: boolean, fresh = false): void {
  const g = u.god;
  if (!on) {
    if (g.bound) { delete g.laws['reach.bound']; u.emit({ t: 'reach.unbound', data: {} }); }
    return;
  }
  if (g.bound) return;
  g.laws['reach.bound'] = 1;
  const first = !g.reach;
  const R = (g.reach ??= emptyReach());
  count(u, R);
  if (fresh) {
    const ps = u.planets[0]?.people;
    if (ps) ps.worship[0] = r2((ps.worship[0] ?? 0) + REACH.start);
  } else if (!first) {
    // a later bind: nothing hoarded in the sandbox comes back in (spec §7.6)
    let over = r2(pool(u) - capOf(u));
    for (const pl of u.planets) {
      const w = pl.people?.worship;
      if (!w || over <= 0) continue;
      const take = Math.min(w[0] ?? 0, over);
      w[0] = r2(w[0] - take); over = r2(over - take);
    }
  }
  measures(u, R);
}

/** a god-0 act (not a natural event) was witnessed in this town: its believers count from now on (regard.ts witnessAct) */
export function reachSeen(u: Universe, planet: number, sid: number): void {
  const R = u.god.reach;
  if (!R || !u.god.bound) return;
  R.seen[`${planet}:${sid}`] = u.tick;
}

interface TownTally { believers: number; rite: number; fearRite: number; door: number }

/** the count (spec §2): roads with their keep lines, F, believers, the two shares; fills `tally` per town when given */
function count(u: Universe, R: ReachState, tally?: Map<string, TownTally>): number {
  let F = 0, bel = 0, nT = 0, nF = 0, nB = 0, grown = 0;
  const roads: ReachState['roads'] = {};
  for (const p of u.planets) {
    const ps = p.people;
    if (!ps || !p.alive) continue;
    const A = ps.agents;
    if (A.count > 0) R.peopled[p.id] = 1;
    const old = R.roads[p.id] ?? {};
    const now: Record<string, number> = {};
    for (let s = 0; s < A.hi; s++) {
      if (!A.alive[s] || (A.flags[s] & AgentFlag.child)) continue;
      grown++;
      const sid = A.settlement[s];
      if (sid < 0 || R.seen[`${p.id}:${sid}`] === undefined) continue;
      const i = s * GODS;
      const faith = A.faith[i], love = A.love[i], fear = A.fear[i];
      if (faith < REACH.believe) continue;
      const was = old[A.id[s]] ?? 0;
      let road = 0;
      if (love >= ((was & 1) ? REACH.trustKeep : REACH.trustLine) - 1e-4) road |= 1;
      if (fear >= ((was & 2) ? REACH.fearKeep : REACH.fearLine) - 1e-4) road |= 2;
      if (road) now[A.id[s]] = road;
      bel++;
      if (road & 1) nT++;
      if (road & 2) nF++;
      if (road === 3) nB++;
      F += road ? 2 : 1;
      if (tally) {
        const key = `${p.id}:${sid}`;
        let t = tally.get(key);
        if (!t) tally.set(key, (t = { believers: 0, rite: 0, fearRite: 0, door: 0 }));
        // what this person's rites are worth in a day: the same on either road, no more on both; terror gives less
        // (down to half at fear 1.0, never nothing: the road of fear always earns)
        const calm = fear <= 0.8 ? 1 : 1 - REACH.terror * (fear - 0.8) / 0.2;
        const v = faith * (road ? 1.5 : 1) * (0.5 + A.traits[s * NT + TRAIT.piety]) * calm;
        t.believers++; t.rite += v;
        // the part a person on the road of fear leaves at the door (fear keeps them from the evening worship)
        if (road & 2) t.door += v;
        // by which road it is given (the two bars of the day's giving): a person on both gives half by each
        t.fearRite += road === 2 ? v : road === 3 ? v / 2 : 0;
      }
    }
    if (Object.keys(now).length) roads[p.id] = now;
  }
  R.roads = roads;
  R.popMax = r2(Math.max(REACH.popMin, grown, R.popMax - R.popMax * REACH.popEase));
  R.f = F; R.believers = bel; R.trust = nT; R.fear = nF; R.both = nB;
  return F;
}

/** the town's worship place: temple 1 + min(1, believers / 20), shrine 1, hearth 0.5, else 0.3 */
function place(u: Universe, p: Planet, sid: number, believers: number): number {
  let best = 0.3;
  const list = u.content.buildings.list;
  for (const b of p.people.of(sid)) {
    if (b.progress < 1 || (b.flags & 2)) continue;
    const id = list[b.type].id;
    const v = id === 'temple' ? 1 + Math.min(1, believers / 20) : id === 'shrine' ? 1 : id === 'hearth' ? 0.5 : 0.3;
    if (v > best) best = v;
  }
  return best;
}

/** each town's measure for the coming day (spec §3.6): the most it can give whatever happens in it */
function measures(u: Universe, R: ReachState): void {
  const tally = new Map<string, TownTally>();
  count(u, R, tally);
  const towns: ReachState['towns'] = {};
  const day = 1440;
  for (const key of [...tally.keys()].sort()) {
    const t = tally.get(key)!;
    const [pid, sid] = key.split(':').map(Number);
    const p = u.planets.find((q) => q.id === pid);
    if (!p) continue;
    const attended = u.tick - (R.seen[key] ?? -1e9) <= REACH.attendedDays * day ? 1 : REACH.unattended;
    const m = r2(REACH.rite * attended * place(u, p, sid, t.believers) * t.rite);
    if (m <= 0) continue;
    towns[key] = { m, g: 0, ff: t.rite > 0 ? Math.round((t.fearRite / t.rite) * 100) / 100 : 0, fd: t.rite > 0 ? Math.round((t.door / t.rite) * 100) / 100 : 0 };
  }
  R.towns = towns;
}

/**
 * The only writer of god 0's pool in a bound world: pays what is left of the town's measure today and what fits under
 * the cap; the rest is not paid. Returns what was paid.
 */
export function credit(u: Universe, p: Planet, sid: number, amount: number): number {
  const R = u.god.reach;
  const ps = p.people;
  if (!R || !ps || amount <= 0) return 0;
  const t = R.towns[`${p.id}:${sid}`];
  if (!t) return 0;
  const paid = r2(Math.min(amount, t.m - t.g, Math.max(0, capOf(u) - pool(u))));
  if (paid <= 0) return 0;
  t.g = r2(t.g + paid);
  const st = ps.settlement(sid);
  if (st) { st.worshipBy[0] = r2(st.worshipBy[0] + paid); st.worship = st.worshipBy[0]; }
  ps.worship[0] = r2((ps.worship[0] ?? 0) + paid);
  return paid;
}

/** once a game day, for the god as a whole: the door offerings, the count, rise and fall, the new measures */
export function reachDaily(u: Universe): void {
  const R = u.god.reach;
  if (!R || !u.god.bound) return;
  // the offering left at the door (spec §3.6): those who fear and do not trust kept from the evening; their part of the
  // measure, as far as the day left it unfilled, is given now
  let inc = 0, incF = 0;
  for (const key of Object.keys(R.towns).sort()) {
    const t = R.towns[key];
    const [pid, sid] = key.split(':').map(Number);
    const p = u.planets.find((q) => q.id === pid);
    if (p && t.fd > 0) credit(u, p, sid, r2(t.m * t.fd));
    inc += t.g; incF += t.g * t.ff;
  }
  R.inc = r2(inc); R.incF = r2(incF); R.incT = r2(R.inc - R.incF);
  R.day++;
  for (const k of Object.keys(R.seen)) {
    const [pid, sid] = k.split(':').map(Number);
    const st = u.planets.find((q) => q.id === pid)?.people?.settlement(sid);
    if (!st || st.fallen >= 0) delete R.seen[k];
  }
  measures(u, R);
  standing(u, R);
}

/** does F (or the share) meet tier t's line x k */
function meets(R: ReachState, t: number, k: number): boolean {
  if (R.f >= REACH.f[t] * k) return true;
  const S = R.f / (2 * R.popMax);
  return REACH.share[t] > 0 && S >= REACH.share[t] * k && R.f >= REACH.shareF[t] * k;
}

function standing(u: Universe, R: ReachState): void {
  const from = R.tier;
  if (from < 4 && meets(R, from + 1, 1)) {
    R.up = r2(R.up + Math.max(1, Math.min(2, R.f / REACH.f[from + 1])));
    if (R.up >= REACH.hold[from + 1]) {
      R.tier = from + 1; R.up = 0; R.down = 0;
      if (R.tier > R.best) {
        R.best = R.tier;
        const ps = u.planets.find((p) => p.alive && p.people && (R.peopled[p.id] ?? 0))?.people ?? u.planets[0]?.people;
        const gift = Math.min(REACH.gift[R.tier], Math.max(0, r2(capOf(u) - pool(u))));
        if (ps && gift > 0) ps.worship[0] = r2((ps.worship[0] ?? 0) + gift);
      }
      u.emit({ t: 'reach.rose', data: { from, to: R.tier, f: R.f, name: REACH.names[R.tier] } });
      return;
    }
  } else R.up = Math.max(0, r2(R.up - REACH.slip));
  if (from > 0 && !meets(R, from, REACH.fallAt)) {
    R.down++;
    if (R.down === 1) u.emit({ t: 'reach.falling', data: { days: REACH.grace, tier: from } });
    if (R.down >= REACH.grace) {
      R.tier = from - 1; R.down = 0; R.up = 0;
      u.emit({ t: 'reach.fell', data: { from, to: R.tier, f: R.f, name: REACH.names[R.tier] } });
    }
  } else R.down = 0;
}

// ───────────────────────────── the gate and the charge ─────────────────────────────

export interface Charge { price: number; cooldown: number; key: string; power: string; beyond: boolean }

/** is this world free clay: no person has ever lived on it (a tier 4 act is free only while no world is peopled) */
function freeClay(u: Universe, R: ReachState, p: Planet | undefined, tier: number): boolean {
  if (p && p.people && p.people.agents.count > 0) R.peopled[p.id] = 1;
  if (tier >= 4 || !p) {
    for (const q of u.planets) { if (q.people && q.people.agents.count > 0) R.peopled[q.id] = 1; if (R.peopled[q.id]) return false; }
    return true;
  }
  return !R.peopled[p.id];
}

/** price x size: a wider radius or a stronger cast than the power's default costs in proportion */
export function priceOf(u: Universe, pw: PowerDef, cmd?: Command | Record<string, unknown>): number {
  let k = 1;
  const c = cmd as Record<string, unknown> | undefined;
  const def = (pw.params?.radius as number | undefined) ?? (pw.schema?.radius?.default as number | undefined);
  if (c && typeof c.radius === 'number' && typeof def === 'number' && def > 0) k *= Math.max(1, c.radius / def);
  if (c && typeof c.power === 'number') k *= Math.max(1, c.power);
  if (c && typeof c.scale === 'number' && pw.command === 'disaster.spawn') k *= Math.max(1, c.scale);
  const scale = u.god.laws['restraint.costScale'] ?? 1;
  // a free basic spell is free at its own size only: cast wider or stronger it costs like the basics (half its old cost x size)
  if (pw.free) return k > 1 && pw.id in REACH.freeCooldown ? r2(Math.max(1, Math.round((pw.cost ?? 0) / 2)) * k * scale) : 0;
  return r2((pw.price ?? 0) * k * scale);
}

function waitText(R: ReachState, need: number): string {
  if (R.believers <= 0) return 'No one gives to you yet. Be seen: rain, a small gift and a stroke of lightning are always yours.';
  if (R.inc <= 0) return 'The people have not given yet today.';
  const d = Math.ceil(need / R.inc);
  return d <= 1 ? 'About a day more.' : `About ${d} days more.`;
}

/** why a power is out of reach at the stored standing (null: in reach, perhaps at 3 x) */
function lockedWhy(R: ReachState, pw: PowerDef): string | null {
  const t = pw.tier ?? 0;
  if (pw.free || t <= R.tier || (t === R.tier + 1 && t < 4)) return null;
  return `Beyond your reach. ${pw.name} opens when you are ${REACH.names[t]}: ${REACH.f[t]} follow, ${R.f} now.`;
}

/**
 * The gate (registry `before`, god 0, bound world): a refusal sentence, a pending charge, or null (free). Changes
 * nothing but the peopled marks; reads the STORED standing and pool, so replay and a mid-day load refuse the same.
 */
export function chargeCheck(u: Universe, cmd: Command, pw: PowerDef | undefined, p: Planet | undefined): string | Charge | null {
  const R = u.god.reach;
  if (!R || !pw) return null;
  const tier = pw.tier ?? 0;
  const key = `0:${pw.id}`;
  const ready = u.god.cooldowns[key] ?? -1;
  const clay = freeClay(u, R, p, tier);
  if (pw.free) {
    const cd = clay ? 0 : REACH.freeCooldown[pw.id] ?? 0;
    if (cd > 0 && ready > u.tick) return `${pw.name} is still gathering strength (${Math.ceil(ready - u.tick)} minutes more).`;
    const big = clay ? 0 : priceOf(u, pw, cmd);
    if (big > 0 && pool(u) + 1e-9 < big) return `${pw.name} at this size needs ${big} worship; ${pool(u)} is gathered. ${waitText(R, big - pool(u))}`;
    return cd > 0 || big > 0 ? { price: big, cooldown: cd, key, power: pw.id, beyond: false } : null;
  }
  if (clay) return null;
  const why = lockedWhy(R, pw);
  if (why) return why;
  const beyond = tier === R.tier + 1;
  if (ready > u.tick) {
    const h = Math.ceil((ready - u.tick) / 60);
    return `${pw.name} is still gathering strength (${h} hour${h === 1 ? '' : 's'} more).`;
  }
  const price = r2(priceOf(u, pw, cmd) * (beyond ? REACH.beyond : 1));
  const have = pool(u);
  if (have + 1e-9 < price) {
    return `${pw.name} needs ${price} worship${beyond ? ' (three times its price: it is beyond your standing)' : ''}; ${have} is gathered. ${waitText(R, price - have)}`;
  }
  return { price, cooldown: (pw.cooldown ?? 0) * (beyond ? 2 : 1), key, power: pw.id, beyond };
}

/** the charge (registry `after`, only when the handler succeeded): a failed or refused cast never reaches here */
export function chargeCommit(u: Universe, ch: Charge, p: Planet | undefined): void {
  let left = ch.price;
  const order = p ? [p, ...u.planets.filter((q) => q !== p)] : u.planets;
  for (const pl of order) {
    const w = pl.people?.worship;
    if (!w || left <= 0) continue;
    const take = Math.min(w[0] ?? 0, left);
    w[0] = r2((w[0] ?? 0) - take); left = r2(left - take);
  }
  if (ch.cooldown > 0) u.god.cooldowns[ch.key] = u.tick + ch.cooldown;
  if (ch.price > 0) u.emit({ t: 'worship.spent', planet: p?.id, data: { power: ch.power, amount: ch.price, beyond: ch.beyond } });
}

// ───────────────────────────── what the UI reads ─────────────────────────────

export interface ReachView {
  bound: boolean; tier: number; standing: string; best: number;
  /** F, and the people behind it */
  following: number; believers: number; trust: number; fear: number; both: number;
  /** the two bars, 0..1: the part of the grown people (at their most) who believe and trust / believe and fear */
  trustShare: number; fearShare: number; share: number;
  pool: number; cap: number;
  /** what the people gave yesterday, by road */
  gathered: { total: number; trust: number; fear: number };
  /** the most all towns together can give today, and what they have given so far */
  measure: number; given: number;
  next: { tier: number; standing: string; f: number; share: number; shareF: number; held: number; hold: number } | null;
  /** days left before the standing falls (0: not falling) */
  falling: number;
}

export function reachView(u: Universe): ReachView {
  const R = u.god.reach;
  if (!u.god.bound || !R) {
    return { bound: false, tier: 4, standing: '', best: R?.best ?? 0, following: 0, believers: 0, trust: 0, fear: 0, both: 0, trustShare: 0, fearShare: 0, share: 0,
      pool: pool(u), cap: -1, gathered: { total: 0, trust: 0, fear: 0 }, measure: 0, given: 0, next: null, falling: 0 };
  }
  const n = R.tier + 1;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return {
    bound: true, tier: R.tier, standing: REACH.names[R.tier], best: R.best,
    following: R.f, believers: R.believers, trust: R.trust, fear: R.fear, both: R.both,
    trustShare: r3(Math.min(1, R.trust / R.popMax)), fearShare: r3(Math.min(1, R.fear / R.popMax)), share: r3(R.f / (2 * R.popMax)),
    pool: pool(u), cap: capOf(u),
    gathered: { total: R.inc, trust: R.incT, fear: R.incF },
    measure: r2(Object.values(R.towns).reduce((a, t) => a + t.m, 0)), given: r2(Object.values(R.towns).reduce((a, t) => a + t.g, 0)),
    next: n <= 4 ? { tier: n, standing: REACH.names[n], f: REACH.f[n], share: REACH.share[n], shareF: REACH.shareF[n], held: R.up, hold: REACH.hold[n] } : null,
    falling: R.down > 0 ? REACH.grace - R.down : 0,
  };
}

/** per power, for the palette and the wheel: its price now, whether it is locked, affordable, and the plain reason */
export function reachPowerView(u: Universe, pw: PowerDef): Record<string, unknown> {
  const R = u.god.reach;
  if (!u.god.bound || !R) return {};
  const locked = lockedWhy(R, pw);
  const beyond = !pw.free && (pw.tier ?? 0) === R.tier + 1 && !locked;
  const priceNow = r2(priceOf(u, pw) * (beyond ? REACH.beyond : 1));
  const have = pool(u);
  const ready = u.god.cooldowns[`0:${pw.id}`] ?? -1;
  const affordable = !locked && have + 1e-9 >= priceNow;
  const reason = locked ?? (affordable ? null : `${pw.name} needs ${priceNow} worship; ${have} is gathered. ${waitText(R, priceNow - have)}`);
  return { priceNow, locked: !!locked, beyond, affordable, reason, ...(ready > u.tick ? { readyAt: ready } : {}) };
}
