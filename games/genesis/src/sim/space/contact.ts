// GENESIS — arrival on another world (CONTRACT.md §12): a colony founded with what the crew know and carry, or CONTACT
// with whoever lives there — trade (goods of two worlds change hands, both ways), plague (sicknesses cross both ways:
// what the visitors carry and what their people have long lived with, what rages among the natives), war, merger
// (the crew join the natives' town), worship (a people far behind may take the visitors for gods: love toward the
// visitors' own god, or toward a 'visitor' pseudo-god of the sky-folk), or silence (the natives hide). The outcome
// follows both cultures: the gap between their ages, the natives' aggression, openness and piety, a culture made cruel
// or fearful, how alien the visitors are (another body, another breath), whether they can breathe the same air, what
// they came for and how close to the natives' town they came down, the crew's own temper, how an earlier meeting went.
// An airship over its own world meets its own towns as its own, and a foreign town as neighbours meet (the polities'
// relation), never as a meeting of worlds. Settlers who cannot breathe and cannot fly home stay sealed in the ship.
// Faith travels too: the crew bring the natives' god home in their hearts. And the voyage home: goods, sickness and
// faith of another world unloaded into the home town.

import type { Universe } from '../world/universe.ts';
import type { ShipKindDef } from '../content.ts';
import type { PCtx } from '../people/ctx.ts';
import type { Settlement } from '../people/state.ts';
import type { GodRecord } from '../god/state.ts';
import type { ShipState, V3, WorldRelation } from './state.ts';
import { stKey } from './state.ts';
import { AgentFlag } from '../types.ts';
import { DEATH, GODS, NT, TRAIT } from '../people/defs.ts';
import { hashFloat } from '../core/rng.ts';
import { makeCtx } from '../people/ctx.ts';
import { cohortTotal } from '../people/cohorts.ts';
import { newSettlement, found, formHouseholds } from '../people/settlement.ts';
import { driftLanguage } from '../people/names.ts';
import { refreshLibrary, accident } from '../people/knowledge.ts';
import { storeAdd, storeHas, storeTake, foodDays } from '../people/store.ts';
import { seedDisease } from '../life/disease.ts';
import { die } from '../people/lifecycle.ts';
import { dropItem } from '../people/people.ts';
import { planBuilding } from '../people/buildings.ts';
import { distM, offsetPoint, isLand } from '../people/world.ts';
import { tell } from '../people/story.ts';
import { settlementRef, vars } from '../people/util.ts';
import { breathable, suitItems } from './habitat.ts';
import { setDown, unloadCargo, addCargo, kindName, goodsWords, infectRecord } from './crew.ts';
import { cellDir, landNear, isSettlers } from './ships.ts';
import { ensureRelation } from '../people/war.ts';
import { DAY } from './transit.ts';

const P0 = [0, 0, 0];

/** contact range: a ship that comes down within this of a town meets it (m) */
const CONTACT_M = 2500;

/** a ship has come down at sh.dest on sh.to */
export function arrive(u: Universe, sh: ShipState, def: ShipKindDef): void {
  const to = u.planet(sh.to);
  if (!to || !to.alive) { sh.phase = 'done'; return; }
  const x = makeCtx(u, to);
  sh.phase = 'landed';
  sh.t0 = u.tick;
  sh.t1 = -1;
  if (sh.destCell < 0) sh.destCell = to.cellAt(sh.dest);
  if (!sh.visits.includes(to.id)) sh.visits.push(to.id);
  u.emit({ t: 'arrival', planet: to.id, pos: [...sh.dest] as V3, ref: { kind: 'ship', id: sh.id, planet: to.id }, text: sh.name, a: sh.crew.length, data: { kind: sh.kind, from: sh.from, returning: sh.returning } });
  if (sh.returning && to.id === sh.home) { homecoming(u, x, sh); return; }
  const home = u.planet(sh.home);
  const homeName = home?.name ?? 'a lost world';
  const homeSt = home?.people?.settlement(sh.owner) ?? null;
  // the first people of one world to stand on another
  if (to.id !== sh.home && sh.crew.length) {
    const first = u.space.firsts.landing === undefined;
    if (first) u.space.firsts.landing = u.tick;
    const v = vars(x, homeSt, -1, { ship: kindName(x, sh), name: sh.name, count: sh.crew.length, planet: to.name, home: homeName, settlement: homeSt?.name ?? sh.ownerName });
    tell(u, to, first ? 'space.landing.first' : 'space.landing', v, null, [{ kind: 'ship', id: sh.id, planet: to.id }], first ? 3 : undefined);
  }
  sh.log.push(`Came down on ${to.name}.`);
  // who lives here
  let natives = sh.destSettlement >= 0 ? x.ps.settlement(sh.destSettlement) : undefined;
  if (!natives || natives.fallen >= 0 || distM(to, natives.pos, sh.dest) > CONTACT_M) natives = nearestTown(x, sh.dest, CONTACT_M);
  let outcome = '';
  if (natives && sh.crew.length && to.id === sh.home) {
    // over their own world (an airship): their own towns are no strangers, and a foreign town is met the way the
    // peoples of one world meet (their polities' relation), not as a meeting of worlds
    const own = sameFolk(x, sh, natives);
    if (!own) outcome = neighbourVisit(u, x, sh, natives);
    else if (!isSettlers(sh.purpose)) sh.log.push(`Over ${natives.name}, their own folk.`);
    if (own && isSettlers(sh.purpose)) natives = undefined;
  } else if (natives && sh.crew.length) {
    // a town their own people founded before (an earlier crossing): kin, they join it
    if (u.space.colonies.some((c) => c.planet === to.id && c.settlement === natives!.id && c.from === sh.home && c.parent === sh.owner)) {
      merge(u, x, sh, natives, homeName);
      outcome = 'reunion';
    } else outcome = contactWith(u, x, sh, def, natives, homeName);
  }
  sh.outcome = outcome || sh.outcome;
  if (!sh.crew.length) { sh.t1 = u.tick + 2 * DAY; return; }
  afterLanding(u, x, sh, def, natives ?? null, outcome, homeName);
}

/** is this town their own (their home town, or a town of its polity) */
function sameFolk(x: PCtx, sh: ShipState, st: Settlement): boolean {
  if (st.id === sh.owner) return true;
  const home = x.ps.settlement(sh.owner);
  return !!home && home.polity >= 0 && st.polity === home.polity;
}

/**
 * An airship of one people comes down by a town of another on the same world: their polities meet (or meet again) as
 * neighbours do — a relation between them, goods for goods if the visitors came to trade, a little more warmth.
 */
function neighbourVisit(u: Universe, x: PCtx, sh: ShipState, nat: Settlement): string {
  const home = x.ps.settlement(sh.owner);
  const r = home ? ensureRelation(x, home.polity, nat.polity) : undefined;
  if (r && r.war >= 0) { sh.log.push(`Over ${nat.name}, with whom they are at war: they kept away.`); return 'avoided'; }
  if (sh.purpose === 'trade' || sh.purpose === 'god' || sh.purpose === 'curiosity') {
    const { valueOut, valueBack, given, back } = swapGoods(x, sh, nat);
    if (r) {
      r.trade = Math.round((r.trade + valueOut + valueBack) * 100) / 100;
      r.op = [clampOp(r.op[0] + 0.05), clampOp(r.op[1] + 0.05)];
    }
    nat.traded = Math.round(((nat.traded ?? 0) + valueBack) * 100) / 100;
    sh.log.push(`Traded ${goodsWords(x, given)} for ${goodsWords(x, back)} at ${nat.name}.`);
    u.emit({ t: 'trade', planet: x.p.id, pos: [...nat.pos] as V3, ref: settlementRef(x, nat), a: Math.round(valueOut), b: Math.round(valueBack), data: { worlds: false, ship: sh.id } });
    return 'trade';
  }
  sh.log.push(`Came down near ${nat.name}.`);
  return '';
}

/** what the crew do once down: settle, or (a visit with fuel for it) look around and go home */
function afterLanding(u: Universe, x: PCtx, sh: ShipState, def: ShipKindDef, natives: Settlement | null, outcome: string, homeName: string): void {
  const sp = u.content.species.list[sh.species];
  const air = breathable(sp, x.p.st.atmosphere);
  const suits = suitsAboard(u, sh);
  const settlers = isSettlers(sh.purpose);
  const sameWorld = sh.home === x.p.id;
  const canReturn = def.returns && (sameWorld || sh.fuelBack.length > 0);
  if (!settlers && canReturn) {
    // a visit: a day on the ground (samples of a world nobody there could trade), then home
    if (!natives && !sameWorld) samples(u, x, sh);
    sh.returning = true;
    sh.t1 = u.tick + DAY;
    sh.log.push(sameWorld ? 'A day there, then home.' : `A day on ${x.p.name}, then home.`);
    return;
  }
  if (!air && suits < sh.crew.length) {
    // they cannot live here and know it: back home if they can, else they stay sealed in their ship
    if (canReturn) { sh.returning = true; sh.t1 = u.tick + Math.round(DAY / 3); sh.log.push(`${x.p.name} would not let them breathe: back home.`); return; }
    outpost(u, x, sh, homeName);
    return;
  }
  // a friendly town of their own kind takes in visitors who cannot go home
  if (!settlers && natives && (outcome === 'trade' || outcome === 'worship') && natives.species === sh.species && !sameWorld) { merge(u, x, sh, natives, homeName); sh.t1 = u.tick + 2 * DAY; return; }
  foundColony(u, x, sh, def, natives, homeName);
  sh.t1 = u.tick + 2 * DAY;
}

/**
 * Visitors who cannot go home (their world is gone): they stay where they stand — taken in by natives of their own kind
 * who did not meet them with spears, else a town of their own, else (air that would kill them, no suits) sealed in the
 * ship.
 */
export function stayAbroad(u: Universe, x: PCtx, sh: ShipState, def: ShipKindDef, homeName: string): void {
  const natives = nearestTown(x, sh.dest, CONTACT_M) ?? null;
  const air = breathable(u.content.species.list[sh.species], x.p.st.atmosphere);
  if (!air && suitsAboard(u, sh) < sh.crew.length) { outpost(u, x, sh, homeName); return; }
  if (natives && natives.species === sh.species) {
    const r = u.space.relation(stKey(sh.home, sh.owner), stKey(x.p.id, natives.id));
    const theirOp = r ? (r.a === stKey(x.p.id, natives.id) ? r.op[0] : r.op[1]) : 0;
    if (theirOp >= 0 && (!r || r.war < 0)) { merge(u, x, sh, natives, homeName); return; }
  }
  foundColony(u, x, sh, def, natives, homeName);
}

/**
 * No way home and air that would kill them outside: the crew stay sealed in the ship where it came down, living on
 * what is aboard (a day at a time: flight.ts) until help comes or the food runs out.
 */
function outpost(u: Universe, x: PCtx, sh: ShipState, homeName: string): void {
  sh.outcome = sh.outcome && sh.outcome !== 'outpost' ? `${sh.outcome}+outpost` : 'outpost';
  sh.returning = false;
  sh.t1 = -1;
  sh.lastDay = 0;
  const v = vars(x, null, -1, { ship: kindName(x, sh), name: sh.name, count: sh.crew.length, planet: x.p.name, home: homeName, others: u.content.species.list[sh.species].plural.replace(/^the /, '') });
  tell(u, x.p, 'space.outpost', v, null, [{ kind: 'ship', id: sh.id, planet: x.p.id }], 2);
  sh.log.push(`No way home, and no air to breathe: ${sh.crew.length} stayed sealed in the ship on ${x.p.name}.`);
  u.emit({ t: 'ship.outpost', planet: x.p.id, pos: [...sh.dest] as V3, ref: { kind: 'ship', id: sh.id, planet: x.p.id }, text: sh.name, a: sh.crew.length });
}

function nearestTown(x: PCtx, pos: ArrayLike<number>, maxM: number): Settlement | undefined {
  let best: Settlement | undefined, bd = maxM;
  for (const st of x.ps.settlements) {
    // (a band on the move is a people to meet as much as a town)
    if (st.fallen >= 0 || (x.ps.members.get(st.id)?.length ?? 0) + cohortTotal(st) < 1) continue;
    const d = distM(x.p, st.pos, pos);
    if (d < bd || (d === bd && best && st.id < best.id)) { bd = d; best = st; }
  }
  return best;
}

function suitsAboard(u: Universe, sh: ShipState): number {
  const t = suitItems(u.content);
  let n = 0;
  for (const [it, q] of sh.cargo) if (t[it]) n += q;
  for (const m of sh.crew) if (m.gear >= 0 && t[m.gear]) n++;
  return Math.floor(n);
}

// ───────────────────────────── a colony across space ─────────────────────────────

/** the crew found a settlement of their own at the landing site (with their knowledge, goods, faith and tongue) */
export function foundColony(u: Universe, x: PCtx, sh: ShipState, def: ShipKindDef, natives: Settlement | null, homeName: string): Settlement | null {
  if (!sh.crew.length) return null;
  let cell = sh.destCell >= 0 ? sh.destCell : x.p.cellAt(sh.dest);
  // not on top of a town
  if (natives && distM(x.p, natives.pos, cellDir(x, cell)) < Math.max(300, natives.territory + 80)) cell = landNear(x, natives.pos, Math.max(450, natives.territory + 250), sh.id);
  if (!isLand(x.p, cell) || x.p.f.water[cell] > 0.15) cell = landNear(x, cellDir(x, cell), 120, sh.id + 1);
  const st = newSettlement(x, sh.species, cell, true, null);
  const home = u.planet(sh.home);
  const homeSt = home?.people?.settlement(sh.owner);
  if (homeSt) {
    // their tongue drifts from home's; their culture and faith come with them
    st.langSeed = driftLanguage(homeSt.langSeed, st.id) >>> 0;
    st.language = st.langSeed;
    st.langLine = [...(homeSt.langLine ?? [homeSt.langSeed]), st.langSeed].slice(-12);
    st.culture = JSON.parse(JSON.stringify(homeSt.culture)) as Settlement['culture'];
    st.culture.stories = [];
    st.god = homeSt.god;
    st.faith = homeSt.faith.slice();
    st.color = homeSt.color;
  }
  // a quiet founding: the chronicle tells this one in its own words
  st.recent.spaceColony = u.tick;
  const n = sh.crew.length;
  const R = x.p.st.radius;
  const centre = cellDir(x, cell);
  for (const m of sh.crew) {
    const at = offsetPoint(centre, 4 + 20 * hashFloat(m.id, sh.id, 0xc01), hashFloat(m.id, 0xc02) * Math.PI * 2, R, [0, 0, 0]);
    setDown(x, st, m, at, 2);
  }
  sh.crew = [];
  const goods = unloadCargo(x, sh, st);
  const sp = u.content.species.list[sh.species];
  const air = breathable(sp, x.p.st.atmosphere);
  if (!air) dressInSuits(x, st);
  found(x, st, cell, null);
  let domed = false;
  if (!air) {
    const dome = x.c.buildings.idx('habitat-dome');
    const k = x.rt.byId.get('habitat-domes');
    if (dome >= 0 && k !== undefined && st.library.includes(k)) domed = !!planBuilding(x, st, dome);
  }
  u.space.colonies.push({ planet: x.p.id, settlement: st.id, from: sh.home, parent: sh.owner, ship: sh.id, tick: u.tick });
  const firstColony = u.space.firsts.colony === undefined && x.p.id !== sh.home;
  if (firstColony) u.space.firsts.colony = u.tick;
  const v = vars(x, st, -1, {
    count: n, parent: homeSt?.name ?? sh.ownerName, home: homeName, planet: x.p.name, ship: kindName(x, sh), name: sh.name,
    place: natives ? `near ${natives.name}` : `on ${x.p.name}`,
  });
  // the words follow what they wear: suits on everyone (and a dome begun), or a colony whose unsuited will not live
  const people = x.ps.members.get(st.id)?.length ?? 0;
  const suited = !air ? (x.ps.members.get(st.id) ?? []).filter((s) => x.A.gear[s] >= 0 && suitItems(x.c)[x.A.gear[s]]).length : n;
  const id = def.class === 'air' && x.p.id === sh.home ? 'space.colony.air' : air || suited < people ? 'space.colony' : domed ? 'space.colony.dome' : 'space.colony.suits';
  tell(u, x.p, id, v, st, [settlementRef(x, st), { kind: 'ship', id: sh.id, planet: x.p.id }], firstColony ? 3 : undefined);
  if (!air && suited < people) {
    const dome = x.ps.of(st.id).some((b) => b.progress >= 1 && x.c.buildings.list[b.type].provides.includes('habitat'));
    if (!dome) tell(u, x.p, 'space.suffocate', vars(x, st, -1, { planet: x.p.name, ship: kindName(x, sh), name: sh.name, count: people - suited }), st, [settlementRef(x, st)]);
  }
  sh.outcome = sh.outcome && sh.outcome !== 'reunion' ? `${sh.outcome}+colony` : 'colony';
  sh.log.push(`Founded ${st.name} with ${n} (${goodsWords(x, goods)}).`);
  u.emit({ t: 'colony', planet: x.p.id, pos: [...st.pos] as V3, ref: settlementRef(x, st), text: st.name, a: n, data: { from: sh.home, ship: sh.id } });
  return st;
}

/** everyone of a settlement who can, puts on a pressure suit from the store */
function dressInSuits(x: PCtx, st: Settlement): void {
  const t = suitItems(x.c);
  const A = x.A;
  let suit = -1;
  for (let i = 0; i < t.length; i++) if (t[i] && storeHas(st, i) >= 1) { suit = i; break; }
  if (suit < 0) return;
  for (const s of x.ps.members.get(st.id) ?? []) {
    if (A.gear[s] >= 0 && t[A.gear[s]]) continue;
    if (storeTake(st, suit, 1) < 1) break;
    if (A.gear[s] >= 0) storeAdd(x, st, A.gear[s], 1);
    A.gear[s] = suit;
  }
}

// ───────────────────────────── contact ─────────────────────────────

function meanTraitOf(x: PCtx, st: Settlement, t: number): number {
  const A = x.A;
  let s = 0, n = 0;
  for (const m of x.ps.members.get(st.id) ?? []) { if (A.flags[m] & AgentFlag.child) continue; s += A.traits[m * NT + t]; n++; }
  if (n) return s / n;
  const def = x.c.species.list[st.species];
  return def.traits[(['curiosity', 'boldness', 'sociability', 'piety', 'aggression', 'diligence'] as const)[t]] ?? 0.5;
}

function crewTrait(sh: ShipState, t: number): number {
  let s = 0, n = 0;
  for (const m of sh.crew) { if (m.flags & AgentFlag.child) continue; s += m.traits[t] ?? 0.5; n++; }
  return n ? s / n : 0.5;
}

/** the relation between two peoples of different worlds (made at first contact) */
function worldRelation(u: Universe, a: string, b: string, outcome: string): { r: WorldRelation; fresh: boolean } {
  const ex = u.space.relation(a, b);
  if (ex) return { r: ex, fresh: false };
  const r: WorldRelation = { a: a < b ? a : b, b: a < b ? b : a, op: [0, 0], contact: u.tick, trade: 0, war: -1, outcome };
  u.space.relations.push(r);
  u.space.relations.sort((p, q) => (p.a < q.a ? -1 : p.a > q.a ? 1 : p.b < q.b ? -1 : p.b > q.b ? 1 : 0));
  return { r, fresh: true };
}

const DESC: Record<string, string> = {
  'hexapod-hive': 'many-legged people who share one mind', flyer: 'people who drift on the air', aquatic: 'people of the water',
  quadruped: 'people who walk on four legs', biped: 'people who walk on two legs as they do', serpent: 'people like great serpents', blob: 'people without bones',
};

/** the visitors meet the natives of `nat`: the outcome follows both cultures; sickness, goods and faith cross */
function contactWith(u: Universe, x: PCtx, sh: ShipState, def: ShipKindDef, nat: Settlement, homeName: string): string {
  const c = u.content;
  const vSp = c.species.list[sh.species], nSp = c.species.list[nat.species];
  const a = stKey(sh.home, sh.owner), b = stKey(x.p.id, nat.id);
  const pre = u.space.relation(a, b);
  const myOp = pre ? (pre.a === b ? pre.op[0] : pre.op[1]) : 0;
  // the natives as a people
  const aggr = meanTraitOf(x, nat, TRAIT.aggression), soc = meanTraitOf(x, nat, TRAIT.sociability);
  const piety = meanTraitOf(x, nat, TRAIT.piety), cur = meanTraitOf(x, nat, TRAIT.curiosity);
  const cons = nat.culture.conservatism, align = nat.culture.alignment;
  // a culture made cruel or fearful (the god's terror, its wars) meets strangers with spears
  const dread = Math.max(0, -align - 0.1);
  const gap = sh.era - nat.era;
  const same = sh.species === nat.species;
  const breathe = breathable(vSp, x.p.st.atmosphere) || suitsAboard(u, sh) >= sh.crew.length;
  const crewAggr = crewTrait(sh, TRAIT.aggression), crewSoc = crewTrait(sh, TRAIT.sociability);
  const nPop = (x.ps.members.get(nat.id)?.length ?? 0) + cohortTotal(nat);
  const settlers = isSettlers(sh.purpose);
  // settlers who come down within the natives' reach want their land
  const close = settlers && distM(x.p, nat.pos, sh.dest) < Math.max(600, nat.territory * 2 + 300);
  // how strange the visitors are to them: another body, another breath
  const alien = same ? 0 : Math.min(0.9, (vSp.body === nSp.body ? 0.2 : 0.45) + (vSp.breathes === nSp.breathes ? 0 : 0.45));
  const jit = (k: number) => (hashFloat(sh.id, nat.id, k, 0xc017) - 0.5) * 0.2;
  const score: Record<string, number> = {
    worship: gap >= 3 ? (0.35 + 0.3 * piety + 0.2 * (nSp.god.awe - 1)) * Math.min(1, (gap - 2) / 4) * (nat.era <= 3 ? 1.3 : 0.8) : 0,
    war: (0.05 + 0.55 * aggr + 0.9 * dread + 0.25 * crewAggr * (settlers ? 1.2 : 0.5) + (close ? (same ? 0.08 : 0.18) : 0) + 0.25 * alien * (aggr + dread)) * (gap >= 3 ? 0.5 : 1) - 0.5 * myOp,
    trade: (0.2 + 0.5 * soc + 0.15 * crewSoc + (nat.era >= 4 ? 0.1 : 0) + (sh.purpose === 'trade' ? 0.35 : 0)) * (gap >= 4 ? 0.7 : 1) * (1 - 0.3 * alien) * (1 - 0.6 * Math.min(1, dread)) + 0.4 * myOp,
    // kin come to stay: settlers of their own people, few beside a town of many, take up its life
    merger: breathe && same ? 0.35 + 0.3 * soc + (sh.crew.length < nPop * 0.3 ? 0.25 : -0.2) + (settlers ? 0.3 : -0.4) - 0.8 * dread : breathe ? 0.05 + 0.2 * soc - 0.3 : 0,
    // too strange to speak to (another body, another breath), or too set in their ways to try
    silence: 0.05 + 0.45 * cons + 0.7 * alien - 0.3 * cur,
  };
  let outcome = 'silence', bv = -Infinity;
  ['worship', 'trade', 'merger', 'war', 'silence'].forEach((k, i) => { const v = score[k] + jit(i); if (v > bv) { bv = v; outcome = k; } });
  const { r, fresh } = worldRelation(u, a, b, outcome);
  // the meeting itself
  const v = vars(x, nat, -1, { others: vSp.plural.replace(/^the /, ''), home: homeName, desc: DESC[vSp.body] ?? 'strangers', planet: x.p.name });
  if (fresh) {
    const first = u.space.firsts.contact === undefined;
    if (first) u.space.firsts.contact = u.tick;
    tell(u, x.p, first ? 'space.contact.first' : 'space.contact', v, nat, [settlementRef(x, nat), { kind: 'ship', id: sh.id, planet: x.p.id }], 3);
    accident(x, nat, 'contact', nat.cell);
  }
  sh.log.push(`Met ${nat.name} (${nSp.plural.replace(/^the /, '')}): ${outcome}.`);
  // sicknesses cross both ways (less when the natives hide; war is close work too)
  exchangeDisease(u, x, sh, nat, outcome === 'silence' ? 0.3 : outcome === 'war' ? 0.8 : 1, homeName);
  const mine = r.a === b ? 0 : 1;
  switch (outcome) {
    case 'trade': spaceTrade(u, x, sh, nat, r, homeName); r.op[mine] = clampOp(r.op[mine] + 0.2); r.op[1 - mine] = clampOp(r.op[1 - mine] + 0.2); break;
    case 'war': spaceWar(u, x, sh, def, nat, r, homeName); r.op[mine] = clampOp(r.op[mine] - 0.6); r.op[1 - mine] = clampOp(r.op[1 - mine] - 0.4); break;
    case 'merger': merge(u, x, sh, nat, homeName); r.op[mine] = clampOp(r.op[mine] + 0.4); r.op[1 - mine] = clampOp(r.op[1 - mine] + 0.4); break;
    case 'worship': offerings(u, x, sh, nat); r.op[mine] = clampOp(r.op[mine] + 0.5); break;
    default: tell(u, x.p, 'space.silence', v, nat, [settlementRef(x, nat)]); r.op[mine] = clampOp(r.op[mine] - 0.05);
  }
  exchangeFaith(u, x, sh, nat, outcome, homeName);
  u.emit({ t: 'contact', planet: x.p.id, pos: [...nat.pos] as V3, ref: settlementRef(x, nat), text: outcome, data: { worlds: true, outcome, ship: sh.id, from: sh.home, owner: sh.owner, a: nat.id } });
  return outcome;
}

function clampOp(v: number): number {
  return Math.round(Math.max(-1, Math.min(1, v)) * 1000) / 1000;
}

/**
 * Sicknesses cross: what the crew carry (incubating or sick) and the ills their people long lived with (those among
 * them who are immune carry them unseen) to the natives; what rages among the natives, and their own old ills, to the
 * crew (who may carry them home). `k` scales how close the meeting was.
 */
export function exchangeDisease(u: Universe, x: PCtx, sh: ShipState, nat: Settlement, k: number, homeName: string): number {
  const c = u.content;
  const nSpId = c.species.list[nat.species].id;
  const src = `the visitors from ${homeName}`;
  let crossed = 0;
  // what rages among the natives now, read before the visitors add anything (each disease's infectious share)
  const members = x.ps.members.get(nat.id) ?? [];
  const raging = new Map<number, number>();
  for (const s of members) {
    const d = x.A.disease[s];
    if (d >= 0 && x.tick >= x.A.infectT[s]) raging.set(d, (raging.get(d) ?? 0) + 1);
  }
  const cohortSick = nat.cohort.sick;
  const total = Math.max(1, members.length + nat.cohort.n[0] + nat.cohort.n[1] + nat.cohort.n[2]);
  if (cohortSick && cohortSick.i > 0) raging.set(cohortSick.d, (raging.get(cohortSick.d) ?? 0) + cohortSick.i * (nat.cohort.n[0] + nat.cohort.n[1] + nat.cohort.n[2]));
  // the ills they live with, carried unseen (crowd sicknesses of a town their size, those many of them have had)
  const theirs = endemic(x, nat);
  const nImmune = (d: number) => d < 32 && members.some((s) => x.A.immune[s] & (1 << d));
  // natives -> crew: their sickness of the moment, and the old ills they carry unseen (strangers to them catch them
  // more easily: a crew that never met a sickness has nobody immune among it)
  const caught = new Map<number, number>();
  for (const m of sh.crew) {
    let got = -1;
    for (const [d, n] of [...raging].sort((p, q) => p[0] - q[0])) {
      const dd = c.diseases.list[d];
      if (!dd) continue;
      const share = n / total;
      if (hashFloat(m.id, nat.id, d, 0xd160) < Math.min(0.8, share * dd.contagion * 12 * k + 0.05) && infectRecord(u, m, d)) { got = d; break; }
    }
    if (got < 0) for (const d of theirs) {
      const dd = c.diseases.list[d];
      if (!dd || raging.has(d)) continue;
      // an ill their own town lives with too is no stranger to them
      const homeToo = sh.carried.includes(d);
      const virgin = !homeToo && !sh.crew.some((o) => d < 32 && o.immune & (1 << d));
      if (hashFloat(m.id, nat.id, d, 0xd161) < Math.min(0.6, dd.contagion * 1.6 * k * (homeToo ? 0.3 : virgin ? 1.5 : 1)) && infectRecord(u, m, d)) { got = d; break; }
    }
    if (got >= 0) { crossed++; caught.set(got, (caught.get(got) ?? 0) + 1); }
  }
  for (const [d, n] of [...caught].sort((p, q) => p[0] - q[0])) {
    const name = c.diseases.list[d].name.toLowerCase();
    sh.log.push(`${n} of the crew caught ${name} at ${nat.name}.`);
    tell(u, x.p, 'space.caught', vars(x, nat, -1, { ship: kindName(x, sh), name: sh.name, count: n, disease: name, home: homeName }), null, [settlementRef(x, nat), { kind: 'ship', id: sh.id, planet: x.p.id }]);
  }
  // crew -> natives: what they carry (incubating or sick), and what their own people long live with (sh.carried, set
  // at launch; and the sicknesses many of the crew have had)
  const active = new Map<number, number>();
  const immuneCount = new Map<number, number>();
  for (const m of sh.crew) {
    if (m.disease >= 0 && !raging.has(m.disease) && !caught.has(m.disease)) active.set(m.disease, (active.get(m.disease) ?? 0) + 1);
    for (let d = 0; d < Math.min(32, c.diseases.size); d++) if (m.immune & (1 << d)) immuneCount.set(d, (immuneCount.get(d) ?? 0) + 1);
  }
  const carried = new Set<number>([...active.keys(), ...sh.carried.filter((d) => !raging.has(d))]);
  for (const [d, n] of immuneCount) if (n >= Math.max(1, sh.crew.length * 0.3) && !raging.has(d)) carried.add(d);
  for (const d of [...carried].sort((p, q) => p - q)) {
    const dd = c.diseases.list[d];
    if (!dd || (dd.species && !dd.species.includes(nSpId))) continue;
    // a sickness the natives have never met spreads on virgin ground
    const virgin = !nImmune(d) && !theirs.includes(d);
    const p = Math.min(0.95, dd.contagion * (active.has(d) ? 5 : 2.5) * k * (virgin ? 1.6 : active.has(d) ? 1 : 0.5));
    if (hashFloat(sh.id, nat.id, d, 0xd15e) < p && seedDisease(x, nat, d, active.has(d) ? 2 : 1, src) > 0) {
      crossed++;
      sh.log.push(`They brought ${dd.name.toLowerCase()} to ${nat.name}.`);
    }
  }
  return crossed;
}

/**
 * The sicknesses a people lives with (disease indices): those many of them have had and are immune to, the crowd
 * sicknesses a town of its size always harbours somewhere (passed hand to hand, in food or in the air), and those its
 * own ground breeds. Its travellers carry them unseen.
 */
export function endemic(x: PCtx, st: Settlement): number[] {
  const c = x.c;
  const members = x.ps.members.get(st.id) ?? [];
  const pop = members.length + cohortTotal(st);
  const biome = c.biomes.list[x.p.f.biome[st.cell]]?.id ?? '';
  const spId = c.species.list[st.species].id;
  const out: number[] = [];
  for (let d = 0; d < c.diseases.size; d++) {
    const dd = c.diseases.list[d];
    if (dd.species && !dd.species.includes(spId)) continue;
    let imm = 0;
    if (d < 32) for (const m of members) if (x.A.immune[m] & (1 << d)) imm++;
    const crowd = (dd.transmission === 'contact' || dd.transmission === 'air' || dd.transmission === 'food') && pop >= dd.crowd;
    if (imm >= Math.max(1, members.length * 0.15) || crowd || dd.origin.includes(biome)) out.push(d);
  }
  return out;
}

/**
 * Goods change hands: most of what the visitors brought goes into the natives' store; the natives give of their
 * surplus (not their food) to a like value. One strange thing of another world lies by their store to wonder at.
 */
function spaceTrade(u: Universe, x: PCtx, sh: ShipState, nat: Settlement, r: WorldRelation, homeName: string): void {
  const c = u.content;
  const { valueOut, valueBack, given, back } = swapGoods(x, sh, nat);
  // a strange thing of another world, to wonder at (a people may work out how it was made)
  const strange = given.filter(([it]) => !(x.rt.producers[it] ?? []).some((k) => nat.library.includes(k)))
    .sort((p, q) => c.items.list[q[0]].value - c.items.list[p[0]].value || p[0] - q[0])[0];
  if (strange) {
    const at = offsetPoint(nat.pos, 6, hashFloat(sh.id, 0x57a) * Math.PI * 2, x.p.st.radius, P0);
    dropItem(x, strange[0], 1, [at[0], at[1], at[2]], x.p.cellAt(at), true);
  }
  r.trade = Math.round((r.trade + valueOut + valueBack) * 100) / 100;
  nat.traded = Math.round(((nat.traded ?? 0) + valueBack) * 100) / 100;
  tell(u, x.p, 'space.trade', vars(x, nat, -1, { home: homeName, others: c.species.list[sh.species].plural.replace(/^the /, ''), goods: goodsWords(x, given), back: goodsWords(x, back) }), nat, [settlementRef(x, nat), { kind: 'ship', id: sh.id, planet: x.p.id }]);
  u.emit({ t: 'trade', planet: x.p.id, pos: [...nat.pos] as V3, ref: settlementRef(x, nat), a: Math.round(valueOut), b: Math.round(valueBack), data: { worlds: true, ship: sh.id, given: given.map(([i, q]) => [c.items.list[i].id, q]), back: back.map(([i, q]) => [c.items.list[i].id, q]) } });
  sh.log.push(`Traded ${goodsWords(x, given)} for ${goodsWords(x, back)} at ${nat.name}.`);
}

/**
 * Goods for goods: most of what the visitors brought goes into the natives' store; the natives give of their surplus
 * (not their food) to a like value.
 */
function swapGoods(x: PCtx, sh: ShipState, nat: Settlement): { valueOut: number; valueBack: number; given: [number, number][]; back: [number, number][] } {
  const c = x.c;
  const suit = suitItems(c);
  const given: [number, number][] = [];
  let valueOut = 0;
  for (const [it, q] of sh.cargo.slice()) {
    const def = c.items.list[it];
    if (!def || def.tags.includes('food') || suit[it] || sh.fuelBack.some((f) => f[0] === it)) continue;
    const n = Math.floor(q * 0.6 * 1000) / 1000;
    if (n <= 0) continue;
    for (const cc of sh.cargo) if (cc[0] === it) cc[1] = Math.round((cc[1] - n) * 1000) / 1000;
    storeAdd(x, nat, it, n);
    given.push([it, n]);
    valueOut += n * def.value;
  }
  sh.cargo = sh.cargo.filter((cc) => cc[1] > 1e-6);
  // their surplus, most valuable first (a town keeps food for a week and what it builds with)
  const pop = Math.max(1, (x.ps.members.get(nat.id)?.length ?? 0) + cohortTotal(nat));
  const cands: [number, number][] = [];
  for (let i = 0; i < nat.store.length; i++) {
    const q = nat.store[i];
    const d = c.items.list[i];
    if (!d || q < 2 || d.tags.includes('vehicle') || d.tags.includes('propellant')) continue;
    if (d.tags.includes('food') && foodDays(x, nat) < pop * 7) continue;
    cands.push([i, q * Math.max(0.2, d.value)]);
  }
  cands.sort((p, q) => q[1] - p[1] || p[0] - q[0]);
  const back: [number, number][] = [];
  let valueBack = 0;
  const want = Math.max(valueOut * 0.9, 6);
  for (const [i] of cands.slice(0, 5)) {
    if (valueBack >= want) break;
    const d = c.items.list[i];
    const n = Math.min(Math.floor(nat.store[i] * 0.3 * 1000) / 1000, Math.max(1, (want - valueBack) / Math.max(0.2, d.value)));
    if (n <= 0) continue;
    const got = storeTake(nat, i, n);
    if (got <= 0) continue;
    addCargo(sh, i, got);
    back.push([i, got]);
    valueBack += got * d.value;
  }
  return { valueOut, valueBack, given, back };
}

/** offerings to the visitors taken for gods: the natives lay goods before them */
function offerings(u: Universe, x: PCtx, sh: ShipState, nat: Settlement): void {
  const c = u.content;
  const best: [number, number][] = [];
  for (let i = 0; i < nat.store.length; i++) if (nat.store[i] >= 1 && c.items.list[i] && !c.items.list[i].tags.includes('vehicle')) best.push([i, nat.store[i] * c.items.list[i].value]);
  best.sort((p, q) => q[1] - p[1] || p[0] - q[0]);
  for (const [i] of best.slice(0, 3)) { const got = storeTake(nat, i, Math.max(1, Math.floor(nat.store[i] * 0.15))); if (got > 0) addCargo(sh, i, got); }
}

/** the crew join the natives' town: people, knowledge, goods and faith of another world in one place */
function merge(u: Universe, x: PCtx, sh: ShipState, nat: Settlement, homeName: string): void {
  const n = sh.crew.length;
  const R = x.p.st.radius;
  for (const m of sh.crew) {
    const at = offsetPoint(nat.pos, 6 + 25 * hashFloat(m.id, nat.id, 0x3e9), hashFloat(m.id, 0x3ea) * Math.PI * 2, R, [0, 0, 0]);
    setDown(x, nat, m, at, 3);
  }
  sh.crew = [];
  unloadCargo(x, sh, nat);
  formHouseholds(x, nat);
  refreshLibrary(x, nat);
  const sp = u.content.species.list[sh.species];
  if (!breathable(sp, x.p.st.atmosphere)) dressInSuits(x, nat);
  tell(u, x.p, 'space.merger', vars(x, nat, -1, { ship: kindName(x, sh), name: sh.name, count: n, home: homeName, others: sp.plural.replace(/^the /, '') }), nat, [settlementRef(x, nat), { kind: 'ship', id: sh.id, planet: x.p.id }]);
  sh.outcome = sh.outcome || 'merger';
  sh.log.push(`${n} joined ${nat.name}.`);
}

/** a fight between the crew and the natives: the stronger side holds the field; the dead on both sides */
function spaceWar(u: Universe, x: PCtx, sh: ShipState, def: ShipKindDef, nat: Settlement, r: WorldRelation, homeName: string): void {
  const A = x.A;
  const fw = x.rt.byId.get('firearms');
  const weapon = (era: number, guns: boolean) => (1 + 0.25 * era) * (guns ? 1.5 : 1);
  const crewAdults = sh.crew.filter((m) => !(m.flags & AgentFlag.child));
  const crewGuns = fw !== undefined && crewAdults.some((m) => m.know.includes(fw));
  let health = 0;
  for (const m of crewAdults) health += m.health;
  const vs = crewAdults.length * weapon(sh.era, crewGuns) * (crewAdults.length ? health / crewAdults.length : 0) * (1 + 0.3 * crewTrait(sh, TRAIT.aggression));
  const fighters = (x.ps.members.get(nat.id) ?? []).filter((s) => !(A.flags[s] & AgentFlag.child));
  const natGuns = fw !== undefined && nat.library.includes(fw);
  const walls = x.ps.of(nat.id).some((b) => b.progress >= 1 && x.c.buildings.list[b.type].function === 'wall');
  const ns = (fighters.length + nat.cohort.n[1] * 0.5) * weapon(nat.era, natGuns) * 0.9 * (walls ? 1.3 : 1);
  const win = hashFloat(sh.id, nat.id, 0x3a2) < vs / Math.max(1e-6, vs + ns);
  // the natives' dead (by a stateless draw over their fighters)
  const natLoss = Math.round(fighters.length * (win ? 0.25 + 0.2 * hashFloat(sh.id, 0x3a3) : 0.05 + 0.1 * hashFloat(sh.id, 0x3a4)));
  const order = fighters.slice().sort((p, q) => hashFloat(A.id[p], sh.id, 0x3a5) - hashFloat(A.id[q], sh.id, 0x3a5) || A.id[p] - A.id[q]);
  let dead = 0;
  for (const s of order.slice(0, natLoss)) { if (A.alive[s]) { die(x, s, DEATH.war); dead++; } }
  // the crew's dead
  const crewLoss = Math.round(crewAdults.length * (win ? 0.1 + 0.2 * hashFloat(sh.id, 0x3a6) : 0.6 + 0.3 * hashFloat(sh.id, 0x3a7)));
  const fallen = new Set(crewAdults.slice().sort((p, q) => hashFloat(p.id, sh.id, 0x3a8) - hashFloat(q.id, sh.id, 0x3a8) || p.id - q.id).slice(0, crewLoss).map((m) => m.id));
  sh.crew = sh.crew.filter((m) => !fallen.has(m.id));
  sh.dead += fallen.size;
  dead += fallen.size;
  nat.recent.raided = x.tick;
  accident(x, nat, 'war', nat.cell);
  r.war = x.tick;
  const winner = win ? `the visitors from ${homeName}` : nat.name;
  tell(u, x.p, 'space.war', vars(x, nat, -1, { home: homeName, count: dead, other: winner }), nat, [settlementRef(x, nat), { kind: 'ship', id: sh.id, planet: x.p.id }]);
  u.emit({ t: 'war', planet: x.p.id, pos: [...nat.pos] as V3, ref: settlementRef(x, nat), a: dead, data: { worlds: true, ship: sh.id, visitorsWon: win } });
  sh.log.push(`Fought ${nat.name}: ${dead} dead, ${win ? 'the field held' : 'driven off'}.`);
  // beaten visitors who cannot fly home are taken in as captives
  if (!win && sh.crew.length && !(def.returns && sh.fuelBack.length)) merge(u, x, sh, nat, homeName);
}

/** a 'visitor' pseudo-god for a people that took the sky-folk for gods (a free god slot; -1 none) */
export function visitorGod(u: Universe, sh: ShipState, homeName: string): number {
  const ex = u.god.gods.find((g) => g.kind === 'visitor' && g.alive && g.home.planet === sh.home && g.home.settlement === sh.owner);
  if (ex) return ex.id;
  const used = new Set(u.god.gods.filter((g) => g.alive).map((g) => g.id));
  let id = -1;
  for (let k = 1; k < GODS; k++) if (!used.has(k)) { id = k; break; }
  if (id < 0) return -1;
  const rec: GodRecord = {
    id, name: `the Sky-Folk of ${homeName}`, kind: 'visitor', alignment: 0.1, temperament: 'distant', home: { planet: sh.home, settlement: sh.owner },
    nextAct: Number.MAX_SAFE_INTEGER, acts: 0, help: 0, harm: 0, wonder: 1, color: 0xcfe3ff, alive: true,
  };
  u.god.gods = u.god.gods.filter((g) => g.id !== id);
  u.god.gods.push(rec);
  u.god.gods.sort((p, q) => p.id - q.id);
  return id;
}

/** the god the visitors bring: their town's, else the one their hearts hold most (-1 none) */
function visitorsGodOf(u: Universe, sh: ShipState): number {
  const homeSt = u.planet(sh.home)?.people?.settlement(sh.owner);
  if (homeSt && homeSt.god >= 0) return homeSt.god;
  const love = new Array<number>(GODS).fill(0);
  for (const m of sh.crew) for (let g = 0; g < GODS; g++) love[g] += m.love[g] ?? 0;
  let best = -1, bv = 0.15 * Math.max(1, sh.crew.length);
  for (let g = 0; g < GODS; g++) if (love[g] > bv) { bv = love[g]; best = g; }
  return best;
}

/**
 * Faith crosses: worshippers take the visitors' god (or the sky-folk themselves) to heart; friendly natives hear of the
 * visitors' god; the crew take the natives' god home with them.
 */
function exchangeFaith(u: Universe, x: PCtx, sh: ShipState, nat: Settlement, outcome: string, homeName: string): void {
  const A = x.A;
  const members = x.ps.members.get(nat.id) ?? [];
  const gv = visitorsGodOf(u, sh);
  const gn = nat.god;
  if (outcome === 'worship') {
    let g = gv;
    if (g < 0) g = visitorGod(u, sh, homeName);
    if (g < 0) g = 0;
    for (const s of members) {
      const piety = A.traits[s * NT + TRAIT.piety];
      A.love[s * GODS + g] = Math.min(1, A.love[s * GODS + g] + 0.35 + 0.4 * piety);
      A.fear[s * GODS + g] = Math.min(1, A.fear[s * GODS + g] + 0.1);
    }
    if (!nat.culture.sacred.includes(`god:${g}`)) nat.culture.sacred.push(`god:${g}`);
    nat.faith[g] = Math.min(1, (nat.faith[g] ?? 0) + 0.5);
    nat.god = g;
    const name = g === 0 ? 'the god who sent them' : u.god.god(g)?.name ?? 'the visitors';
    tell(u, x.p, 'space.worship', vars(x, nat, -1, { home: homeName, god: name }), nat, [settlementRef(x, nat), { kind: 'ship', id: sh.id, planet: x.p.id }]);
    u.emit({ t: 'worship', planet: x.p.id, pos: [...nat.pos] as V3, ref: settlementRef(x, nat), a: g, data: { worlds: true, ship: sh.id, god: g } });
  } else if (gv >= 0 && outcome !== 'war' && outcome !== 'silence') {
    let moved = 0;
    for (const s of members) {
      const add = 0.06 * (0.5 + A.traits[s * NT + TRAIT.sociability]);
      A.love[s * GODS + gv] = Math.min(1, A.love[s * GODS + gv] + add);
      moved += add;
    }
    nat.faith[gv] = Math.min(1, (nat.faith[gv] ?? 0) + 0.05);
    if (moved > 0.5) {
      const name = gv === 0 ? 'you' : u.god.god(gv)?.name ?? 'their god';
      tell(u, x.p, 'space.faith', vars(x, nat, -1, { home: homeName, god: name }), nat, [settlementRef(x, nat)]);
    }
  }
  if (outcome === 'war') for (const s of members) if (gv >= 0) A.fear[s * GODS + gv] = Math.min(1, A.fear[s * GODS + gv] + 0.2);
  // the crew carry the natives' god home in their hearts
  if (gn >= 0 && outcome !== 'war') for (const m of sh.crew) m.love[gn] = Math.min(1, Math.round(((m.love[gn] ?? 0) + 0.12) * 1000) / 1000);
}

/** on a world with nobody to trade with, the visitors carry home what lies about: stone, sand, ice, the haze */
function samples(u: Universe, x: PCtx, sh: ShipState): void {
  const c = u.content;
  const f = x.p.f;
  const cell = sh.destCell >= 0 ? sh.destCell : x.p.cellAt(sh.dest);
  const add = (id: string, q: number) => { const i = c.items.idx(id); if (i >= 0) addCargo(sh, i, q); };
  add('stone', 3);
  if (f.sand[cell] > 0.2) add('sand', 3);
  if (f.snow[cell] + f.ice[cell] > 0.1) add('ice-block', 2);
  if (x.p.st.atmosphere.methane * x.p.st.atmosphere.pressure >= 0.02) add('tholin', 2);
  if (f.oreType[cell] > 0) {
    const ore = c.ores.list[f.oreType[cell] - 1];
    if (ore) { if (c.items.has(`${ore.id}-ore`)) add(`${ore.id}-ore`, 2); else if (c.items.has(ore.id)) add(ore.id, 2); }
  }
  sh.log.push(`Gathered samples of ${x.p.name}.`);
}

/** home again: the crew walk into their town with the goods, sicknesses and faith of another world */
function homecoming(u: Universe, x: PCtx, sh: ShipState): void {
  const visited = sh.visits.filter((id) => id !== sh.home).map((id) => u.planet(id)?.name ?? 'another world');
  const where = visited[visited.length - 1] ?? 'the sky';
  let st = x.ps.settlement(sh.owner);
  if (!st || st.fallen >= 0) st = nearestTown(x, sh.dest, 6000);
  sh.returning = false;
  sh.t1 = u.tick + 2 * DAY;
  if (!st) {
    // home is gone: they settle where they came down
    const def = u.content.ships.find(sh.kind)!;
    foundColony(u, x, sh, def, null, x.p.name);
    return;
  }
  const n = sh.crew.length;
  const R = x.p.st.radius;
  const carried = new Set<number>();
  // what they had abroad and came through, carried unseen: a sickness home never knew
  const known = new Set(endemic(x, st));
  const latent = new Map<number, number>();
  for (const m of sh.crew) {
    if (m.disease >= 0) carried.add(m.disease);
    for (let d = 0; d < Math.min(32, u.content.diseases.size); d++) if (m.immune & (1 << d) && !known.has(d)) latent.set(d, (latent.get(d) ?? 0) + 1);
    const at = offsetPoint(sh.dest, 3 + 10 * hashFloat(m.id, 0x40e), hashFloat(m.id, 0x40f) * Math.PI * 2, R, [0, 0, 0]);
    setDown(x, st, m, at, 2);
  }
  sh.crew = [];
  const goods = unloadCargo(x, sh, st);
  formHouseholds(x, st);
  refreshLibrary(x, st);
  // the ship itself is theirs again: a hull that came home flies again (the next run needs only its fuel)
  const def = u.content.ships.find(sh.kind);
  const hull = def?.hull ? x.c.items.idx(def.hull) : -1;
  if (hull >= 0 && def!.returns && st.species === sh.species) { storeAdd(x, st, hull, 1); sh.log.push('The ship stands ready to fly again.'); }
  // a sickness of another world, home with them
  const from = `the crew back from ${where}`;
  for (const d of [...carried].sort((p, q) => p - q)) if (seedDisease(x, st, d, 1, from) > 0) sh.log.push(`They brought ${u.content.diseases.list[d].name.toLowerCase()} home.`);
  for (const [d, k] of [...latent].sort((p, q) => p[0] - q[0])) {
    const dd = u.content.diseases.list[d];
    if (carried.has(d) || !dd || hashFloat(sh.id, d, st.id, 0x1a7e) >= Math.min(0.8, dd.contagion * 2.5 * Math.min(2, k))) continue;
    if (seedDisease(x, st, d, 1, from) > 0) sh.log.push(`They brought ${dd.name.toLowerCase()} home, unseen.`);
  }
  tell(u, x.p, 'space.return', vars(x, st, -1, { ship: kindName(x, sh), name: sh.name, count: n, planet: where, goods: goodsWords(x, goods) }), st, [settlementRef(x, st), { kind: 'ship', id: sh.id, planet: x.p.id }]);
  sh.outcome = sh.outcome ? `${sh.outcome}+home` : 'home';
  sh.log.push(`Home at ${st.name} with ${goodsWords(x, goods)}.`);
  u.emit({ t: 'ship.home', planet: x.p.id, pos: [...st.pos] as V3, ref: settlementRef(x, st), text: sh.name, a: n, data: { ship: sh.id, goods: goods.map(([i, q]) => [u.content.items.list[i]?.id, q]) } });
}
