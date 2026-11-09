// GENESIS — ARC §4 the covenant (stage C1): a great destruction (one set of thresholds, §4.1), the offer that follows it,
// the vow the god binds itself with (§4.2), the bow scheduled at a real low sun (§4.3), the pre-check that refuses a
// cast that would break the vow and the post-check that breaks it after the fact (§4.4), keeping (memory `kept`,
// milestones) and breaking (memory `betrayed`, the people's answer a week later), the natural doubt, and the views.
// ARC §0.6 places this in arc.ts; it is its own module for size only (as defiance.ts is for §3).
//
// Deterministic: settlements and keys in sorted order, hashFloat with the §7 salts (0xc0e1 remembered bow, 0xc0e2 offer
// delay), the bow hour from the sun alone. No Math.random, no Date, no Map-iteration order.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Settlement } from '../people/state.ts';
import type { PCtx } from '../people/ctx.ts';
import type { PlanetSnap, SettlementView } from '../types.ts';
import type { Covenant, CovenantOffer, RelState, SettlementRel, Vow } from './state.ts';
import type { ActCtx } from './regard.ts';
import type { CommandRegistry } from './commands.ts';
import { AgentFlag, BuildingFlag } from '../types.ts';
import { hashFloat } from '../core/rng.ts';
import { makeCtx } from '../people/ctx.ts';
import { GODS, TASK } from '../people/defs.ts';
import { tell } from '../people/story.ts';
import { settlementRef, vars } from '../people/util.ts';
import { distM, sunElevation } from '../people/world.ts';
import { startTask } from '../people/tasks.ts';
import { interrupt } from '../people/people.ts';
import { GATHER_KIND } from '../people/gatherings.ts';
import { clanOf } from '../chronicle.ts';
import { paintWeather } from '../fields/weather.ts';
import { foretoldAt, meansNow, moveSettlement, peekRel, relOf, relStat, srel } from './regard.ts';
import { wrathOf } from './wrath.ts';
import { emptyMemory } from './arc.ts';
import { pushArc } from './tower.ts';
import { fail, ok } from './util.ts';

/** ARC §4 tunables */
export const COVENANT = {
  /** §4.1 great: dead on one planet; or a town's share and floor; or a town's ruined buildings share and floor */
  greatDead: 20, greatShare: 0.25, greatTownDead: 8, ruinShare: 0.4, ruinMin: 5,
  /** a natural great disaster opens an offer at most once per this many years per planet */
  naturalYears: 30,
  /** spare-the-many: never more than this many dead in one act */
  spareMax: 10,
  /** gentle: never above this wrath */
  gentleMax: 0.3,
  /** warn-first: covenant towns within this (m, plus the cast's radius) of the cast are its target */
  warnReach: 2500,
  /** the bow: sin of 5° and 40° */
  bowLo: Math.sin(5 * Math.PI / 180), bowHi: Math.sin(40 * Math.PI / 180),
  /** survivors within this (m) of the centre gather under the bow for an hour */
  gatherM: 300,
  /** the remembered bow after daylight rain: chance, and at most once per this many days per town */
  rememberChance: 0.3, rememberDays: 10,
  /** kept milestones (years) */
  milestones: [10, 25, 50, 100],
  /** memory.kept per kept year */
  keptMem: 0.1,
  /** days after a break before the people answer */
  answerDays: 7,
};

export const VOWS: readonly Vow[] = ['no-flood', 'spare-the-many', 'gentle', 'warn-first'];
/** the vow in words (UI, chronicle) */
export const VOW_WORDS: Record<Vow, string> = {
  'no-flood': 'Never again by water', 'spare-the-many': 'Never again so many', gentle: 'Always gentle', 'warn-first': 'Always warn first',
};
/** what the god promised, as the chronicle says it */
export const VOW_SAYS: Record<Vow, string> = {
  'no-flood': 'never again to destroy them by water', 'spare-the-many': 'never again to take so many', gentle: 'always to be gentle',
  'warn-first': 'never to strike unwarned',
};
const FLOOD_KINDS = new Set(['flood', 'tsunami', 'rogue-wave']);
const FIRE_KINDS = new Set(['wildfire', 'firestorm', 'meteor', 'meteor-shower', 'volcano', 'supervolcano']);
const FLOOD_CMDS = new Set(['water.flood', 'water.tsunami']);
const FIRE_CMDS = new Set(['fire.firestorm', 'miracle.fireball', 'miracle.meteor', 'miracle.lightning', 'tower.strike']);

const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
/** numbers in words up to twelve, digits above (§0.3 rule 8) */
export function numWords(n: number): string { return n >= 0 && n <= 12 ? NUM[Math.round(n)] : String(Math.round(n)); }
/** "Aru", "Aru and Tesh", "Aru, Tesh and Vorn" */
export function joinNames(names: string[]): string {
  return names.length <= 1 ? names[0] ?? '' : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** what kind of destruction an act was, from its command or disaster kind */
export function destructionKind(what: string): 'flood' | 'fire' | 'ruin' {
  const d = what.startsWith('disaster:') ? what.slice(9) : '';
  if (FLOOD_KINDS.has(d) || FLOOD_CMDS.has(what)) return 'flood';
  if (FIRE_KINDS.has(d) || FIRE_CMDS.has(what)) return 'fire';
  return 'ruin';
}

function yearTicks(p: Planet): number {
  const day = Math.max(60, Math.round(p.st.dayHours * 60));
  return Math.max(day, Math.round(p.st.orbit.period));
}
function dayTicksOf(p: Planet): number { return Math.max(60, Math.round(p.st.dayHours * 60)); }
function godActs(u: Universe, planet: number): Record<string, number> {
  return ((relOf(u).godActs ??= {})[String(planet)] ??= {});
}
function namesOf(p: Planet, ids: number[]): string[] {
  return ids.map((id) => p.people?.settlement(id)?.name).filter((n): n is string => !!n);
}
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** the kept covenant of a planet (one at a time) */
export function keptOn(u: Universe, planet: number): Covenant | undefined {
  return (u.god.rel?.covenants ?? []).find((c) => c.planet === planet && c.status === 'kept');
}
/** the covenant a town is under: its kept one, else its latest broken one */
export function covenantOf(u: Universe, planet: number, sid: number): Covenant | undefined {
  const l = (u.god.rel?.covenants ?? []).filter((c) => c.planet === planet && c.settlements.includes(sid));
  return l.find((c) => c.status === 'kept') ?? l[l.length - 1];
}
/** a kept covenant holds over this town (§4.2: lapse penalties × 0.5, fear migration needs 5 days) */
export function underKept(u: Universe, planet: number, sid: number): boolean {
  return !!keptOn(u, planet)?.settlements.includes(sid);
}
/** prayer-lapse scale (§4.2 kept covenant × 0.5; §0.4 memory kept × 1 / (1 + 0.5 w)) */
export function lapseScale(u: Universe, planet: number, sid: number): number {
  const w = peekRel(u, planet, sid)?.memory?.kept ?? 0;
  return (underKept(u, planet, sid) ? 0.5 : 1) / (1 + 0.5 * w);
}

// ───────────────────────────── §4.1 a great destruction ─────────────────────────────

/**
 * regard.ts endAct's hook (actHooks.closed): the act's dead and ruined buildings are summed over its whole life in its
 * store (a disaster keeps the same store across its steps and saves); the first time it crosses a threshold it is
 * great; spare-the-many is checked against its running toll; a natural flood that kills in a no-flood town is doubt.
 */
export function actClosed(u: Universe, ctx: ActCtx): void {
  const S = ctx.store;
  const keys = [...new Set([...Object.keys(ctx.dead), ...Object.keys(ctx.ruined)])].sort();
  const planets = new Set<number>();
  for (const k of keys) {
    if (ctx.dead[k]) S[`D${k}`] = (S[`D${k}`] ?? 0) + ctx.dead[k];
    if (ctx.ruined[k]) S[`R${k}`] = (S[`R${k}`] ?? 0) + ctx.ruined[k];
    planets.add(Number(k.split(':')[0]));
  }
  for (const pl of [...planets].sort((a, b) => a - b)) {
    const p = u.planets.find((q) => q.id === pl);
    if (!p?.people) continue;
    const ps = p.people;
    const towns: { sid: number; dead: number; ruined: number }[] = [];
    let total = 0;
    for (const k of Object.keys(S).sort()) {
      const m = /^([DR])(\d+):(\d+)$/.exec(k);
      if (!m || Number(m[2]) !== pl) continue;
      const sid = Number(m[3]);
      let t = towns.find((q) => q.sid === sid);
      if (!t) towns.push(t = { sid, dead: 0, ruined: 0 });
      if (m[1] === 'D') { t.dead += S[k]; total += S[k]; } else t.ruined += S[k];
    }
    const god = ctx.god === 0 && !ctx.natural;
    // the open offer of this act follows its toll
    for (const o of u.god.rel?.offers ?? []) if (o.planet === pl && o.act === ctx.key) o.dead = total;
    if (!S[`G${pl}`]) {
      let great = total >= COVENANT.greatDead;
      for (const t of towns) {
        if (great) break;
        if (t.dead >= COVENANT.greatTownDead && t.dead >= COVENANT.greatShare * ((ps.members.get(t.sid)?.length ?? 0) + t.dead)) great = true;
        else if (t.ruined >= COVENANT.ruinMin) {
          let standing = 0;
          for (const b of ps.buildings) if (b.settlement === t.sid && !(b.flags & BuildingFlag.ruined)) standing++;
          if (t.ruined >= COVENANT.ruinShare * (standing + t.ruined)) great = true;
        }
      }
      if (great) { S[`G${pl}`] = 1; greatDestruction(u, p, ctx, towns, total); }
    }
    // §4.4 post-check: spare-the-many breaks at its eleventh death in one act
    if (god && total > COVENANT.spareMax && !S[`S${pl}`]) {
      const cov = keptOn(u, pl);
      if (cov?.vow === 'spare-the-many') { S[`S${pl}`] = 1; breakCovenant(u, p, cov, ctx.key, total, destructionKind(ctx.what)); }
    }
    // §4.2 natural doubt: a natural flood that kills in a no-flood town is no break, but they ask why
    if (ctx.natural && destructionKind(ctx.what) === 'flood') {
      const cov = keptOn(u, pl);
      if (cov?.vow === 'no-flood') for (const k of keys) {
        const sid = Number(k.split(':')[1]);
        if (Number(k.split(':')[0]) !== pl || !ctx.dead[k] || !cov.settlements.includes(sid) || S[`N${k}`]) continue;
        S[`N${k}`] = 1;
        const st = ps.settlement(sid);
        if (!st || st.fallen >= 0) continue;
        const x = makeCtx(u, p);
        moveSettlement(x, st, { trust: -0.05 });
        tell(u, p, 'covenant.doubt', vars(x, st), st, [settlementRef(x, st)], 1);
      }
    }
  }
}

/** the household with the most living members in a town (ties: the lowest id); its clan name */
function survivingHousehold(x: PCtx, st: Settlement): { id: number; name: string; count: number } | undefined {
  let best: { id: number; slot: number; count: number } | null = null;
  for (const h of st.households.slice().sort((a, b) => a.id - b.id)) {
    let n = 0, slot = -1;
    for (const id of h.members) { const s = x.A.slotOf(id); if (s >= 0 && x.A.alive[s]) { n++; if (slot < 0) slot = s; } }
    if (n && (!best || n > best.count)) best = { id: h.id, slot, count: n };
  }
  return best ? { id: best.id, name: clanOf(x, best.slot), count: best.count } : undefined;
}

function greatDestruction(u: Universe, p: Planet, ctx: ActCtx, towns: { sid: number; dead: number; ruined: number }[], total: number): void {
  const x = makeCtx(u, p);
  const ps = x.ps;
  const worst = towns.slice().sort((a, b) => b.dead - a.dead || b.ruined - a.ruined || a.sid - b.sid)[0];
  const wst = worst ? ps.settlement(worst.sid) : undefined;
  if (!wst) return;
  const kind = destructionKind(ctx.what);
  relStat(u, 'covenant.great');
  const survivors = towns.map((t) => t.sid).filter((sid) => { const s = ps.settlement(sid); return !!s && s.fallen < 0 && !s.band; }).sort((a, b) => a - b);
  openGreat(u, p, x, { act: ctx.key, kind, place: wst, survivors, dead: total, natural: ctx.natural });
}

/** a great destruction: the ArcEvent (ages open from it) and, where the god may answer, the offer */
function openGreat(u: Universe, p: Planet, x: PCtx, o: { act: string; kind: 'flood' | 'fire' | 'ruin'; place: Settlement; survivors: number[]; dead: number; natural: boolean }): CovenantOffer | null {
  const R = relOf(u);
  const word = o.kind === 'flood' ? 'Flood' : o.kind === 'fire' ? 'Burning' : 'Ruin';
  const name = `the ${word} of ${o.place.name}`;
  const year = yearTicks(p);
  // a natural great disaster opens an offer at most once per 30 years per planet
  const natLate = o.natural && (R.arcEvents ?? []).some((e) => e.planet === p.id && e.kind === 'great' && e.god === 'none' && x.tick - e.tick < COVENANT.naturalYears * year);
  pushArc(u, { planet: p.id, tick: x.tick, kind: 'great', name: `The ${word} of ${o.place.name}`, towns: o.survivors.length ? o.survivors : [o.place.id],
    god: o.natural ? 'none' : 'wrath', dead: o.dead, ref: o.place.id });
  if (natLate || keptOn(u, p.id) || !o.survivors.length) return null;
  const worstAlive = o.survivors.includes(o.place.id) ? o.place : x.ps.settlement(o.survivors[0])!;
  const household = survivingHousehold(x, worstAlive);
  const id = R.next++;
  const opens = x.tick + Math.round((1 + 2 * hashFloat(id, x.tick, 0xc0e2, u.seed)) * x.day);
  const offer: CovenantOffer = { id, planet: p.id, act: o.act, kind: o.kind, name, settlements: o.survivors, dead: o.dead,
    opens, until: x.tick + year, natural: o.natural };
  if (household) offer.household = household;
  R.offers = (R.offers ?? []).filter((q) => q.planet !== p.id);
  R.offers.push(offer);
  return offer;
}

// ───────────────────────────── §4.3 the bow ─────────────────────────────

/** the first hourly pass within the next game day when the sun stands 5°-40° over the towns' centroid */
export function scheduleBow(u: Universe, p: Planet, towns: number[]): number {
  const ps = p.people;
  const c = [0, 0, 0];
  for (const id of towns) { const st = ps?.settlement(id); if (st) { c[0] += st.pos[0]; c[1] += st.pos[1]; c[2] += st.pos[2]; } }
  const l = Math.hypot(c[0], c[1], c[2]) || 1;
  c[0] /= l; c[1] /= l; c[2] /= l;
  // relationshipHourly runs where (t + 17 id) % 60 === 23 (god/index.ts)
  const phase = ((23 - 17 * p.id) % 60 + 60) % 60;
  let t = u.tick + ((phase - u.tick % 60) + 60) % 60;
  if (t <= u.tick) t += 60;
  const day = dayTicksOf(p);
  for (let h = 0; t + 60 * h <= u.tick + day + 60; h++) {
    const el = sunElevation(u, p, t + 60 * h, c);
    if (el >= COVENANT.bowLo && el <= COVENANT.bowHi) return t + 60 * h;
  }
  // a world whose sun never stands so (a polar town in its long night): the first daylight hour, else the next hour
  for (let h = 0; t + 60 * h <= u.tick + day + 60; h++) if (sunElevation(u, p, t + 60 * h, c) > 0.02) return t + 60 * h;
  return t;
}

function bow(u: Universe, p: Planet, cov: Covenant): void {
  const x = makeCtx(u, p);
  const live = cov.settlements.map((id) => x.ps.settlement(id)).filter((s): s is Settlement => !!s && s.fallen < 0);
  for (const st of live) {
    paintWeather(u, p, 'rainbow', st.pos, 900, 90, 1, false);
    gatherUnder(x, st);
  }
  cov.signAt = -1;
  const towns = joinNames(live.map((s) => s.name));
  const first = live[0];
  if (first) {
    const refs = live.map((s) => settlementRef(x, s));
    tell(u, p, 'covenant.made', vars(x, first, -1, { towns, vowWords: VOW_SAYS[cov.vow] }), first, refs, 3);
    const hhSt = cov.household ? live.find((s) => s.households.some((h) => h.id === cov.household!.id)) ?? first : null;
    if (cov.household && hhSt) tell(u, p, 'covenant.made.household', vars(x, hhSt, -1, { household: cap(cov.household.name) }), hhSt, [settlementRef(x, hhSt)], 2);
  }
  pushArc(u, { planet: p.id, tick: x.tick, kind: 'covenant', name: `The Promise after ${cap(cov.after)}`, towns: cov.settlements, god: 'promise', dead: 0, ref: cov.id });
  u.emit({ t: 'covenant.bow', planet: p.id, pos: first ? [first.pos[0], first.pos[1], first.pos[2]] : undefined, data: { covenant: cov.id } });
}

/** §4.3 the gathering: the survivors outdoors within 300 m of the centre come out and look up, then kneel, for an hour */
function gatherUnder(x: PCtx, st: Settlement): void {
  const A = x.A;
  const at = [0, 0, 0];
  for (const s of x.ps.members.get(st.id) ?? []) {
    if (!A.alive[s] || A.inside[s] >= 0 || A.mission[s] || A.boat[s] >= 0 || A.flags[s] & AgentFlag.possessed) continue;
    const t = A.task[s];
    if (t === TASK.flee || t === TASK.evacuate || t === TASK.fight || t === TASK.sail || t === TASK.possessed) continue;
    A.posAt(s, x.tick, at);
    if (distM(x.p, at, st.pos) > COVENANT.gatherM) continue;
    interrupt(x, s);
    startTask(x, s, { kind: TASK.gather, goal: [at[0], at[1], at[2]], goalCell: x.p.cellAt(at), work: 60, data: GATHER_KIND.covenant, target: x.tick });
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ───────────────────────────── §4.4 keeping and breaking ─────────────────────────────

/** what a harmful cast would break, or null (§4.4 pre-check; `k` the command kind, `a` its coerced args) */
export function covenantPrecheck(u: Universe, p: Planet, k: string, a: Record<string, unknown>): { cov: Covenant; msg: string } | null {
  const cov = keptOn(u, p.id);
  if (!cov) return null;
  let breaks = false;
  if (cov.vow === 'no-flood') {
    breaks = FLOOD_CMDS.has(k) || (k === 'disaster.spawn' && FLOOD_KINDS.has(String(a.kind)));
  } else if (cov.vow === 'gentle') {
    breaks = wrathOf(u, a) > COVENANT.gentleMax + 1e-6;
  } else if (cov.vow === 'warn-first') {
    if (!(typeof a.warning === 'number' && a.warning > 0)) {
      const at = targetOf(u, p, a);
      const reach = COVENANT.warnReach + (typeof a.radius === 'number' ? a.radius : 0);
      const day = dayTicksOf(p);
      if (at) for (const sid of cov.settlements) {
        const st = p.people?.settlement(sid);
        if (!st || st.fallen >= 0 || distM(p, st.pos, at) > reach) continue;
        if (!foretoldAt(u, p, sid, u.tick, day)) { breaks = true; break; }
      }
    }
  }
  // spare-the-many: no toll estimate exists for a cast; it is checked after the act (actClosed)
  if (!breaks) return null;
  const names = joinNames(namesOf(p, cov.settlements));
  const msg = `You promised the people of ${names} ${VOW_SAYS[cov.vow].replace(' them', '')}. To break your promise, say so: '…, and break my covenant'.`;
  return { cov, msg };
}

function targetOf(u: Universe, p: Planet, a: Record<string, unknown>): ArrayLike<number> | null {
  for (const key of ['pos', 'at', 'center', 'target']) {
    const v = a[key];
    if (Array.isArray(v) && v.length === 3) return v as number[];
  }
  if (typeof a.settlement === 'number') { const st = p.people?.settlement(a.settlement); if (st) return st.pos; }
  const tw = (u.god.rel?.towers ?? []).find((t) => t.planet === p.id && (typeof a.tower === 'number' ? t.id === a.tower : t.status === 'rising' || t.status === 'finished'));
  if (tw) return tw.pos;
  return u.focus && u.focus.planet === p.id ? u.focus.pos : null;
}

/** the pre-check's refusal result (§4.4) and its event */
export function covenantRefusal(u: Universe, p: Planet, k: string, pre: { cov: Covenant; msg: string }): { ok: false; msg: string; refusal: { kind: 'covenant'; covenant: number; vow: Vow } } {
  relStat(u, 'covenant.refused');
  u.emit({ t: 'covenant.refused', planet: p.id, data: { covenant: pre.cov.id, cmd: k } });
  return { ok: false, msg: pre.msg, refusal: { kind: 'covenant', covenant: pre.cov.id, vow: pre.cov.vow } };
}

/** §4.4 broken: in the covenant towns trust −0.30, faith −0.05, fear +0.20, loyalty −0.15, defiance +0.15, betrayed + 1 */
export function breakCovenant(u: Universe, p: Planet, cov: Covenant, act: string, dead = 0, means: 'flood' | 'fire' | 'ruin' = 'ruin'): void {
  if (cov.status !== 'kept') return;
  const x = makeCtx(u, p);
  cov.status = 'broken';
  cov.broken = x.tick;
  cov.breakAct = act;
  cov.signAt = -1;
  const ga = godActs(u, p.id);
  ga.broken = (ga.broken ?? 0) + 1;
  relStat(u, 'covenant.broken');
  const live = cov.settlements.map((id) => x.ps.settlement(id)).filter((s): s is Settlement => !!s && s.fallen < 0);
  for (const st of live) {
    const r = srel(u, p.id, st.id);
    const m = meansNow(x, st);
    r.since.cvTr = m.trust >= m.fear ? 1 : 0;
    r.since.cvAns = x.tick + COVENANT.answerDays * x.day;
    moveSettlement(x, st, { trust: -0.3, faith: -0.05, fear: 0.2, loyalty: -0.15 });
    r.defiance = r3(clamp01((r.defiance ?? 0) + 0.15));
    const mem = (r.memory ??= emptyMemory());
    mem.betrayed = r3(mem.betrayed + 1);
  }
  const first = live[0];
  pushArc(u, { planet: p.id, tick: x.tick, kind: 'broken', name: `The Broken Promise to ${first?.name ?? cov.after}`, towns: cov.settlements, god: 'broken', dead, ref: cov.id });
  u.emit({ t: 'covenant.broken', planet: p.id, pos: first ? [first.pos[0], first.pos[1], first.pos[2]] : undefined, data: { covenant: cov.id, act } });
  if (first) {
    const refs = live.map((s) => settlementRef(x, s));
    if (dead > 0) tell(u, p, 'covenant.broken', vars(x, first, -1, { towns: joinNames(live.map((s) => s.name)), dead: cap(numWords(dead)), means: means === 'flood' ? 'water' : means === 'fire' ? 'fire' : 'the god\'s hand' }), first, refs, 3);
    else tell(u, p, 'covenant.broken.quiet', vars(x, first, -1, { vowWords: VOW_SAYS[cov.vow] }), first, refs, 3);
  }
}

/** the WRATHFUL wrapper's post-run step: a harmful cast sent with covenant 'break' that the pre-check would refuse */
export function breakByCast(u: Universe, p: Planet, pre: { cov: Covenant }, k: string, act: string): void {
  breakCovenant(u, p, pre.cov, act, 0, k === 'disaster.spawn' ? 'ruin' : destructionKind(k));
}

// ───────────────────────────── hourly and daily ─────────────────────────────

/** relationshipHourly (before naturalOmens): offers shown and lapsed, the scheduled bow, the remembered bow */
export function covenantHourly(u: Universe, p: Planet): void {
  const R = u.god.rel;
  if (!R) return;
  const ps = p.people;
  if (R.offers?.length) for (const o of R.offers.slice()) {
    if (o.planet !== p.id) continue;
    if (!o.shown && u.tick >= o.opens) {
      o.shown = true;
      offered(u, p, o);
    }
    if (u.tick > o.until) closeOffer(u, p, o);
  }
  if (!ps || !R.covenants?.length) return;
  for (const cov of R.covenants) {
    if (cov.planet !== p.id) continue;
    if (cov.status === 'kept' && cov.signAt >= 0) {
      if (u.tick >= cov.signAt) bow(u, p, cov);
      else if (!cov.shower && cov.signAt - u.tick <= 60) {
        // a light passing shower just before the bow (§4.3)
        cov.shower = true;
        for (const id of cov.settlements) { const st = ps.settlement(id); if (st && st.fallen < 0) paintWeather(u, p, 'drizzle', st.pos, 900, cov.signAt - u.tick + 10, 0.5, false); }
      }
      continue;
    }
    if (cov.signAt >= 0 || !p.airy) continue;
    for (const id of cov.settlements) {
      const st = ps.settlement(id);
      if (st && st.fallen < 0) rememberedBow(u, p, cov, st);
    }
  }
}

/** after daylight rain over a covenant town with the sun at 5°-40°: 30 % a natural bow, read as the promise remembered */
function rememberedBow(u: Universe, p: Planet, cov: Covenant, st: Settlement): void {
  const r = srel(u, p.id, st.id);
  const c = st.cell;
  if (p.f.precip[c] > 0.5 && p.f.precipType[c] === 1) return;
  if (r.since.rain === undefined || u.tick - r.since.rain > 90) return;
  const day = dayTicksOf(p);
  if (r.since.cvBow !== undefined && u.tick - r.since.cvBow < COVENANT.rememberDays * day) return;
  const el = sunElevation(u, p, u.tick, st.pos);
  if (el < COVENANT.bowLo || el > COVENANT.bowHi) return;
  if (hashFloat(st.id, u.tick, 0xc0e1, u.seed) >= COVENANT.rememberChance) return;
  delete r.since.rain;
  r.since.cvBow = u.tick;
  paintWeather(u, p, 'rainbow', st.pos, 900, 75, 1, false);
  const x = makeCtx(u, p);
  const kept = cov.status === 'kept';
  if (kept) moveSettlement(x, st, { faith: 0.02, trust: 0.01 });
  else moveSettlement(x, st, { fear: 0.01 });
  relStat(u, 'covenant.remembered');
  // the line at most once a generation per town
  if (r.since.cvTold === undefined || u.tick - r.since.cvTold >= 25 * yearTicks(p)) {
    r.since.cvTold = u.tick;
    tell(u, p, kept ? 'covenant.remembered' : 'covenant.remembered.broken', vars(x, st), st, [settlementRef(x, st)], 1);
  }
}

function offered(u: Universe, p: Planet, o: CovenantOffer): void {
  const x = makeCtx(u, p);
  const st = x.ps.settlement(o.settlements[0]);
  u.emit({ t: 'covenant.offered', planet: p.id, pos: st ? [st.pos[0], st.pos[1], st.pos[2]] : undefined, data: { offer: o.id } });
  if (!st) return;
  tell(u, p, o.natural ? 'covenant.offered.natural' : 'covenant.offered', vars(x, st, -1, { event: o.name }), st, [settlementRef(x, st)], 2);
  if (o.household) {
    const hs = x.ps.settlement(o.settlements.find((id) => x.ps.settlement(id)?.households.some((h) => h.id === o.household!.id)) ?? st.id) ?? st;
    tell(u, p, 'covenant.household', vars(x, hs, -1, { household: o.household.name, event: o.name, count: numWords(o.household.count) }), hs, [settlementRef(x, hs)], 2);
  }
}

/** an offer declined (or a year gone by): the sky said nothing */
function closeOffer(u: Universe, p: Planet, o: CovenantOffer): void {
  const R = relOf(u);
  R.offers = (R.offers ?? []).filter((q) => q !== o);
  const x = makeCtx(u, p);
  const st = x.ps?.settlement(o.settlements[0]);
  const ga = godActs(u, p.id);
  ga.silence = (ga.silence ?? 0) + 1;
  pushArc(u, { planet: p.id, tick: u.tick, kind: 'answer', name: `The Silence after ${cap(o.name)}`, towns: o.settlements, god: 'none', dead: 0 });
  if (st && st.fallen < 0) tell(u, p, 'covenant.declined', vars(x, st), st, [settlementRef(x, st)], 2);
}

/** relationshipDaily: kept years (memory, milestones), the people's answer a week after a break, the trust scars */
export function covenantDaily(u: Universe, p: Planet): void {
  const R = u.god.rel;
  const ps = p.people;
  if (!R || !ps) return;
  const x = makeCtx(u, p);
  const year = x.year;
  for (const cov of R.covenants ?? []) {
    if (cov.planet !== p.id || cov.status !== 'kept' || cov.signAt >= 0) continue;
    const years = Math.floor((x.tick - cov.made) / year);
    for (const id of cov.settlements) {
      const st = ps.settlement(id);
      if (!st || st.fallen >= 0) continue;
      const r = srel(u, p.id, id);
      const done = r.since[`cv${cov.id}`] ?? 0;
      if (years > done) {
        const mem = (r.memory ??= emptyMemory());
        mem.kept = r3(mem.kept + COVENANT.keptMem * (years - done));
        r.since[`cv${cov.id}`] = years;
      }
    }
    const m = COVENANT.milestones.filter((y) => y <= years).pop() ?? 0;
    if (m > cov.told) {
      cov.told = m;
      const live = cov.settlements.map((id) => ps.settlement(id)).filter((s): s is Settlement => !!s && s.fallen < 0);
      u.emit({ t: 'covenant.kept', planet: p.id, data: { covenant: cov.id, years: m } });
      pushArc(u, { planet: p.id, tick: x.tick, kind: 'kept', name: `The Promise Kept ${numWords(m)} Years`, towns: cov.settlements, god: 'promise', dead: 0, ref: cov.id });
      if (live[0]) tell(u, p, 'covenant.kept', vars(x, live[0], -1, { years: cap(numWords(m)), settlement: joinNames(live.map((s) => s.name)) }), live[0], live.map((s) => settlementRef(x, s)), 2);
    }
  }
  for (const st of ps.settlements) {
    if (st.fallen >= 0 || st.band) continue;
    const r = peekRel(u, p.id, st.id);
    if (!r) continue;
    if (r.since.cvAns !== undefined && x.tick >= r.since.cvAns) {
      tell(u, p, r.since.cvTr ? 'covenant.answer.trusted' : 'covenant.answer.feared', vars(x, st), st, [settlementRef(x, st)], 2);
      delete r.since.cvAns; delete r.since.cvTr;
    }
    scars(x, st, r);
  }
}

/** §0.4 betrayed: trust ceiling max(0.5, 0.9 − 0.2 w); kept: trust floor min(0.3, 0.1 w) */
function scars(x: PCtx, st: Settlement, r: SettlementRel): void {
  const b = r.memory?.betrayed ?? 0, k = r.memory?.kept ?? 0;
  if (b < 0.01 && k < 0.01) return;
  const hi = b >= 0.01 ? Math.max(0.5, 0.9 - 0.2 * b) : 1, lo = Math.min(0.3, 0.1 * k);
  const A = x.A;
  for (const s of x.ps.members.get(st.id) ?? []) {
    const i = s * GODS;
    const v = A.love[i];
    if (v > hi) A.love[i] = hi;
    else if (v < lo) A.love[i] = lo;
  }
}

/** §0.4 betrayed: trust gains × 1 / (1 + w) */
export function trustGainScale(r: SettlementRel | undefined): number {
  return 1 / (1 + (r?.memory?.betrayed ?? 0));
}

// ───────────────────────────── views and query ─────────────────────────────

export function covenantSnap(u: Universe, p: Planet, snap: PlanetSnap): void {
  const R = u.god.rel;
  if (!R) return;
  const year = yearTicks(p);
  const l = (R.covenants ?? []).filter((c) => c.planet === p.id);
  const c = l.find((q) => q.status === 'kept') ?? l[l.length - 1];
  snap.covenant = c ? { id: c.id, vow: c.vow, status: c.status, years: yearsKept(c, u.tick, year), towns: c.settlements.slice() } : null;
  const o = (R.offers ?? []).find((q) => q.planet === p.id && u.tick >= q.opens);
  snap.covenantOffer = o ? { id: o.id, name: o.name, dead: o.dead, towns: o.settlements.slice(), ...(o.household ? { household: o.household.name } : {}), until: o.until } : null;
}

export function covenantTownView(u: Universe, p: Planet, sid: number): SettlementView['covenant'] | undefined {
  const c = covenantOf(u, p.id, sid);
  return c ? { id: c.id, vow: c.vow, status: c.status, year: p.calendar(c.made).year } : undefined;
}

function yearsKept(c: Covenant, tick: number, year: number): number {
  return Math.max(0, Math.floor(((c.status === 'kept' ? tick : c.broken) - c.made) / year));
}

/** query('covenants', { planet? }) */
export function covenantsQuery(u: Universe, args: Record<string, unknown>): { covenants: unknown[]; offers: unknown[] } {
  const R = u.god.rel;
  const pick = (pl: number) => typeof args.planet !== 'number' || args.planet === pl;
  const covenants: unknown[] = [], offers: unknown[] = [];
  for (const c of R?.covenants ?? []) {
    if (!pick(c.planet)) continue;
    const p = u.planets.find((q) => q.id === c.planet);
    if (!p) continue;
    covenants.push({ ...c, townNames: namesOf(p, c.settlements), yearsKept: yearsKept(c, u.tick, yearTicks(p)), vowWords: VOW_WORDS[c.vow], says: VOW_SAYS[c.vow] });
  }
  for (const o of R?.offers ?? []) {
    if (!pick(o.planet)) continue;
    const p = u.planets.find((q) => q.id === o.planet);
    if (p) offers.push({ ...o, townNames: namesOf(p, o.settlements) });
  }
  return { covenants, offers };
}

/** "what did I promise": the promises in words */
export function promiseWords(u: Universe, planet: number): string {
  const l = (u.god.rel?.covenants ?? []).filter((c) => c.planet === planet);
  const p = u.planets.find((q) => q.id === planet);
  if (!l.length || !p) return 'You have made no promise to these people.';
  return l.map((c) => {
    const names = joinNames(namesOf(p, c.settlements));
    const y = yearsKept(c, u.tick, yearTicks(p));
    return c.status === 'kept' ? `You promised ${names} ${VOW_SAYS[c.vow]}. You have kept it ${numWords(y)} year${y === 1 ? '' : 's'}.`
      : `You promised ${names} ${VOW_SAYS[c.vow]}, and broke it in year ${p.calendar(c.broken).year}.`;
  }).join(' ');
}

// ───────────────────────────── commands ─────────────────────────────

export function registerCovenantCommands(r: CommandRegistry): void {
  r.register('covenant.make', ({ u, p }, a) => {
    const R = relOf(u);
    const o = (R.offers ?? []).find((q) => q.planet === p.id && (typeof a.offer !== 'number' || q.id === a.offer));
    if (!o || !p.people) return fail('There is no one to make a covenant with: a covenant follows a great destruction.');
    const vow = a.vow as Vow | undefined;
    if (!vow || !VOWS.includes(vow)) return fail('Promise what? Never again by water, never again so many, always gentle, or always warn first.');
    const held = keptOn(u, p.id);
    if (held) return fail(`You already keep a promise to ${joinNames(namesOf(p, held.settlements))}.`);
    const x = makeCtx(u, p);
    const ga = godActs(u, p.id);
    const halved = (ga.broken ?? 0) > 0;
    const k = halved ? 0.5 : 1;
    const live = o.settlements.map((id) => x.ps.settlement(id)).filter((s): s is Settlement => !!s && s.fallen < 0);
    if (!live.length) { closeOffer(u, p, o); return fail('There is no one left to make a covenant with.'); }
    for (const st of live) moveSettlement(x, st, { trust: 0.15 * k, fear: -0.1 * k, faith: 0.1 * k, loyalty: 0.05 * k });
    const cov: Covenant = { id: R.next++, planet: p.id, made: x.tick, vow, after: o.name, settlements: live.map((s) => s.id).sort((q, w) => q - w),
      status: 'kept', broken: -1, signAt: scheduleBow(u, p, live.map((s) => s.id)), told: 0, halved };
    if (o.household) cov.household = { id: o.household.id, name: o.household.name };
    (R.covenants ??= []).push(cov);
    R.offers = (R.offers ?? []).filter((q) => q !== o);
    ga.covenant = (ga.covenant ?? 0) + 1;
    relStat(u, 'covenant.made');
    u.emit({ t: 'covenant.made', planet: p.id, pos: [live[0].pos[0], live[0].pos[1], live[0].pos[2]], data: { covenant: cov.id, vow } });
    return ok(`You promise the people of ${joinNames(live.map((s) => s.name))} ${VOW_SAYS[vow].replace(' them', '')}. Watch the sky after the rain.`);
  }, { desc: 'Make a covenant with the survivors of a great destruction: a vow the god binds itself with', category: 'Signs',
    params: { vow: { type: 'enum', values: [...VOWS] }, offer: { type: 'int', min: 1 } } });
  r.register('covenant.decline', ({ u, p }, a) => {
    const o = (relOf(u).offers ?? []).find((q) => q.planet === p.id && (typeof a.offer !== 'number' || q.id === a.offer));
    if (!o) return fail('No one is waiting on a promise.');
    closeOffer(u, p, o);
    return ok('You say nothing. The survivors wait, and then go back to their fields.');
  }, { desc: 'Say nothing to the survivors (close the covenant offer)', category: 'Signs', params: { offer: { type: 'int', min: 1 } } });
  r.register('covenant.offer', ({ u, p }, a) => {
    const st = typeof a.settlement === 'number' ? p.people?.settlement(a.settlement) : undefined;
    if (!st || st.fallen >= 0 || st.band) return fail('Open an offer for which town?');
    const held = keptOn(u, p.id);
    if (held) return fail('A covenant is already kept on this world.');
    const x = makeCtx(u, p);
    const o = openGreat(u, p, x, { act: `debug${u.tick}`, kind: 'flood', place: st, survivors: [st.id], dead: 0, natural: false });
    if (!o) return fail('No offer could be opened.');
    o.opens = u.tick;
    return ok(`An offer is open: ${o.name}.`);
  }, { desc: 'Open a covenant offer as if a great flood had struck a town (no deaths; tests and shots)', category: 'Debug',
    params: { settlement: { type: 'int', required: true, min: 0 } } });
}

export type { RelState };
