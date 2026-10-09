// GENESIS — war and peace (CONTRACT.md §8.6): polities (one or more settlements under one name), the relations between
// them, raids, battles, sieges, conquest and treaties.
//
//   relations   daily, each polity's opinion of each one it has met drifts toward what the world gives it to think:
//               trade warms (+), raids, theft and killings leave grievances (−), a different god (−), a distant
//               tongue (−), the same kin (+), touching borders (−), treaties (+), a shared enemy (+), a hawkish leader
//               (−), and RESOURCE MONOPOLIES: a people that needs iron (or copper, tin, salt, coal, horses) and sees a
//               neighbour holding all of it covets it — a casus belli.
//   war         a polity whose opinion of another sinks far enough, and that feels strong enough (or hungry enough),
//               declares war; its allies come in. Warring settlements send war bands (missions of real soldiers):
//               battles are strength = fighters × weapon tech × health × morale (a hash roll of fortune on each side),
//               with casualties by name; walls make a siege of it — walls HOLD unless breached (siege craft, cannon) or
//               the town starves; a beaten town with no fighters left is CONQUERED (its polity changes, cultures blend,
//               some flee). Peacetime raids by hungry, aggressive settlements steal stores.
//   peace       war-weariness (the dead, the hunger, the years) brings treaties: plain peace, or tribute from the
//               loser; friendship and trade bring trade pacts; friendship and a common enemy bring alliances.
// Everything is chronicled. Every roll is a stateless hash.

import type { PCtx } from './ctx.ts';
import type { Mission, Polity, Relation, Settlement } from './state.ts';
import { AgentFlag, BuildingFlag } from '../types.ts';
import { hash32, hashFloat } from '../core/rng.ts';
import { DEATH, INV, MEMK, NS, NT, SKILL, TRAIT } from './defs.ts';
import { foodDays, storeAdd, storeHas, storeTake } from './store.ts';
import { cohortTotal } from './cohorts.ts';
import { die } from './lifecycle.ts';
import { accident, libraryEffect } from './knowledge.ts';
import { tell, remember } from './story.ts';
import { agentName, agentRef, settlementRef, vars } from './util.ts';
import { distM } from './world.ts';
import { igniteCell } from '../fields/fire.ts';
import { ruin } from './buildings.ts';
import { newMission, routeBetween, volunteers, bestBoat, homeward } from './missions.ts';
import { langDistance, refugees } from './culture.ts';
import { factionShare } from './social.ts';
import { ERAS } from '../content.ts';
import { NEED_N } from './needs.ts';

// ───────────────────────────── polities ─────────────────────────────

/** the polity of a settlement (created on first use) */
export function polityOf(x: PCtx, st: Settlement): Polity | undefined {
  if (st.polity < 0) return undefined;
  let pl = x.ps.polity(st.polity);
  if (!pl) {
    pl = { id: st.polity, name: '', capital: st.id, founded: x.tick, overlord: -1, color: st.color };
    x.ps.polities.push(pl);
    x.ps.polities.sort((a, b) => a.id - b.id);
  }
  return pl;
}

/** the standing settlements of a polity (ascending id) */
export function settlementsOf(x: PCtx, polity: number): Settlement[] {
  return x.ps.settlements.filter((st) => st.polity === polity && st.fallen < 0 && !st.band);
}

const TITLES = ['the {people} of {name}', 'the {people} of {name}', 'the chiefdom of {name}', 'the chiefdom of {name}', 'the kingdom of {name}',
  'the kingdom of {name}', 'the realm of {name}', 'the realm of {name}', 'the republic of {name}', 'the nation of {name}', 'the union of {name}'];

/** "the kingdom of Aru", "the hive of Kix", "the plains folk of Bel" */
export function polityName(x: PCtx, pl: Polity | undefined): string {
  if (!pl) return 'no one';
  if (pl.name) return pl.name;
  const cap = x.ps.settlement(pl.capital);
  const root = cap ? cap.name.split(' ')[0] : 'the lost';
  const sp = cap ? x.c.species.list[cap.species] : undefined;
  if (sp?.hive) return `the hive of ${root}`;
  const era = cap ? cap.era : 0;
  const people = sp ? sp.plural.replace(/^the /, '') : 'people';
  return TITLES[Math.max(0, Math.min(TITLES.length - 1, era))].replace('{people}', people).replace('{name}', root);
}

/** the relation between two polities, if they have met */
export function relationOf(x: PCtx, a: number, b: number): Relation | undefined {
  return x.ps.relation(a, b);
}

/** the relation between two polities, created at first contact */
export function ensureRelation(x: PCtx, a: number, b: number): Relation | undefined {
  if (a === b || a < 0 || b < 0) return undefined;
  let r = x.ps.relation(a, b);
  if (!r) {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    r = { a: lo, b: hi, op: [0, 0], war: -1, aggressor: -1, cause: '', contact: x.tick, trade: 0, grievance: [0, 0], casualties: [0, 0], score: 0, treaties: [], truce: -1, last: -1 };
    x.ps.relations.push(r);
    x.ps.relations.sort((p, q) => p.a - q.a || p.b - q.b);
  }
  return r;
}

/** side index of polity p in relation r (0 = a, 1 = b) */
function side(r: Relation, p: number): 0 | 1 {
  return r.a === p ? 0 : 1;
}

/** polity `victim` holds a grievance against polity `offender` */
export function grieve(x: PCtx, victim: number, offender: number, amount: number): void {
  const r = ensureRelation(x, victim, offender);
  if (!r) return;
  const k = side(r, victim);
  r.grievance[k] = Math.min(3, Math.round((r.grievance[k] + amount) * 1000) / 1000);
  r.op[k] = Math.max(-1, r.op[k] - amount * 0.5);
}

/** is a settlement's polity at war with anyone */
export function atWar(x: PCtx, st: Settlement): boolean {
  for (const r of x.ps.relations) if (r.war >= 0 && (r.a === st.polity || r.b === st.polity)) return true;
  return false;
}

/** the polities a polity is at war with */
export function enemiesOf(x: PCtx, polity: number): number[] {
  const out: number[] = [];
  for (const r of x.ps.relations) if (r.war >= 0 && (r.a === polity || r.b === polity)) out.push(r.a === polity ? r.b : r.a);
  return out;
}

// ───────────────────────────── strength ─────────────────────────────

/** the best weapon a settlement can arm its fighters with (quality: fists 0.6, stone spear 1 ... cannon 4) */
export function weaponTech(x: PCtx, st: Settlement): number {
  let q = 0.6;
  for (const it of x.c.itemsByTag.get('weapon') ?? []) {
    if (storeHas(st, it) < 1) continue;
    const def = x.c.items.list[it];
    if (def.tags.includes('siege')) continue;
    q = Math.max(q, def.quality ?? 1);
  }
  return q * libraryEffect(x, st, 'war');
}

/** morale: content, fed, led, believing, winning */
export function morale(x: PCtx, st: Settlement): number {
  const members = x.ps.members.get(st.id) ?? [];
  let mood = 0;
  for (const s of members) mood += x.A.mood[s];
  mood = members.length ? mood / members.length : 0.5;
  let m = 0.55 + 0.45 * mood;
  if (st.leader && x.A.slotOf(st.leader) >= 0) m += 0.1;
  if (st.age.kind === 'golden') m += 0.1;
  if (st.age.kind === 'dark') m -= 0.1;
  if (foodDays(x, st) < (members.length + cohortTotal(st)) * 0.5) m -= 0.25;
  m += Math.min(0.15, st.belief * 0.2);
  return Math.max(0.2, Math.min(1.4, m));
}

/** the fighting power of one agent with a weapon of quality q */
function power(x: PCtx, s: number, q: number): number {
  const A = x.A;
  const held = A.tool[s] >= 0 && x.c.items.list[A.tool[s]].tags.includes('weapon') ? x.c.items.list[A.tool[s]].quality ?? 1 : q * 0.85;
  const child = A.flags[s] & AgentFlag.child ? 0.25 : A.flags[s] & AgentFlag.elder ? 0.5 : 1;
  return Math.max(0.05, A.health[s]) * (0.6 + A.skills[s * NS + SKILL.fight]) * Math.max(q * 0.7, held) * child;
}

/** walls: palisades, walls and towers multiply the defence (walls hold) */
export function wallFactor(x: PCtx, st: Settlement): number {
  let f = 0;
  for (const b of x.ps.of(st.id)) {
    if (b.progress < 1 || b.flags & BuildingFlag.ruined || b.damage > 0.85) continue;
    const id = x.c.buildings.list[b.type].id;
    const k = (1 - b.damage) * (id === 'wall' ? 0.3 : id === 'palisade' ? 0.12 : id === 'tower' ? 0.18 : 0);
    f += k;
  }
  return 1 + Math.min(2.2, f);
}

/** attack strength of a war band (its members' slots) */
function bandStrength(x: PCtx, from: Settlement, slots: number[]): number {
  const q = weaponTech(x, from);
  let s = 0;
  for (const m of slots) s += power(x, m, q);
  return s * morale(x, from);
}

const _dp = [0, 0, 0];

/** the defenders at home: adults within the settlement's land right now (the cohort's able-bodied count apart) */
function defenders(x: PCtx, st: Settlement): number[] {
  const A = x.A;
  const out: number[] = [];
  const reach = Math.max(80, st.territory);
  for (const m of x.ps.members.get(st.id) ?? []) {
    if (A.flags[m] & AgentFlag.child || A.mission[m]) continue;
    A.posAt(m, x.tick, _dp);
    if (distM(x.p, _dp, st.pos) > reach) continue;
    out.push(m);
  }
  return out;
}

function defenceStrength(x: PCtx, st: Settlement, slots: number[], walls: boolean): number {
  const q = weaponTech(x, st);
  let s = 0;
  for (const m of slots) s += power(x, m, q);
  s += (st.cohort.n[1] * 0.6 + st.cohort.n[2] * 0.2) * q * 0.7;
  return s * morale(x, st) * 1.15 * (walls ? wallFactor(x, st) : 1);
}

/** the whole military weight of a polity (war declarations weigh it) */
export function polityStrength(x: PCtx, polity: number): number {
  let s = 0;
  for (const st of settlementsOf(x, polity)) s += defenceStrength(x, st, defenders(x, st), false);
  return s;
}

// ───────────────────────────── resources worth a war ─────────────────────────────

interface Res { id: string; items: string[]; ores: string[]; need: string[] }
const STRATEGIC: Res[] = [
  { id: 'iron', items: ['iron', 'iron-ore', 'steel', 'meteoric-iron'], ores: ['iron-ore'], need: ['iron-smelting', 'iron-tools', 'forge-building'] },
  { id: 'copper', items: ['copper', 'copper-ore', 'bronze'], ores: ['copper-ore'], need: ['copper-smelting', 'bronze'] },
  { id: 'tin', items: ['tin', 'tin-ore', 'bronze'], ores: ['tin-ore'], need: ['tin-smelting', 'bronze'] },
  { id: 'coal', items: ['coal', 'coke'], ores: ['coal'], need: ['coke-making', 'steam-engine'] },
  { id: 'salt', items: ['salt'], ores: ['salt'], need: ['salting'] },
];

/** does a settlement hold resource r (in its land or its stores) */
function holds(x: PCtx, st: Settlement, r: Res): boolean {
  for (const id of r.ores) {
    const it = x.c.items.idx(id);
    if (it >= 0 && st.res && (st.res.items[String(it)]?.length ?? 0) > 0) return true;
  }
  let q = 0;
  for (const id of r.items) { const it = x.c.items.idx(id); if (it >= 0) q += storeHas(st, it); }
  return q >= 3;
}

/** does it want it (it knows what it is for) */
function wants(x: PCtx, st: Settlement, r: Res): boolean {
  for (const id of r.need) { const k = x.rt.byId.get(id); if (k !== undefined && st.library.includes(k)) return true; }
  return false;
}

/** is this item one of the strategic resources (a monopoly worth guarding, and worth a war) */
export function strategicItem(x: PCtx, it: number): boolean {
  const id = x.c.items.list[it]?.id;
  return !!id && STRATEGIC.some((r) => r.items.includes(id) && r.id !== 'salt');
}

/** a resource polity `a` needs, lacks, and sees polity `b` holding (its casus belli), or '' */
export function covets(x: PCtx, a: number, b: number): string {
  const as = settlementsOf(x, a), bs = settlementsOf(x, b);
  if (!as.length || !bs.length) return '';
  for (const r of STRATEGIC) {
    if (!as.some((st) => wants(x, st, r))) continue;
    if (as.some((st) => holds(x, st, r))) continue;
    if (bs.some((st) => holds(x, st, r))) return r.id;
  }
  return '';
}

// ───────────────────────────── daily politics ─────────────────────────────

/** once a day per planet: polities, independence, relations, war and peace, campaigns */
export function politicsDaily(x: PCtx): void {
  const ps = x.ps;
  // polities and capitals
  for (const st of ps.settlements) if (st.fallen < 0 && !st.band) polityOf(x, st);
  for (const pl of ps.polities) {
    const mine = settlementsOf(x, pl.id);
    // a polity with no settlement left keeps the name it was known by (it read 'the people of the lost')
    if (!mine.length) { if (pl.capital >= 0 && !pl.name) pl.name = polityName(x, pl); pl.capital = -1; continue; }
    if (!mine.some((st) => st.id === pl.capital)) {
      const cap = mine.reduce((a, b) => (popOf(x, b) > popOf(x, a) ? b : a));
      pl.capital = cap.id;
    }
    if (pl.overlord >= 0 && !settlementsOf(x, pl.overlord).length) pl.overlord = -1;
  }
  independence(x);
  // relations
  for (const r of ps.relations) {
    const as = settlementsOf(x, r.a), bs = settlementsOf(x, r.b);
    if (!as.length || !bs.length) {
      if (r.war >= 0) endWar(x, r, as.length ? r.a : r.b, 'conquest');
      continue;
    }
    for (const k of [0, 1] as const) {
      const me = k === 0 ? r.a : r.b, them = k === 0 ? r.b : r.a;
      const target = opinionTarget(x, r, me, them, k);
      r.op[k] = Math.round(Math.max(-1, Math.min(1, r.op[k] + (target - r.op[k]) * 0.12 + (hashFloat(r.a * 2 + k, r.b, x.tick, 0x0b1) - 0.5) * 0.02)) * 1000) / 1000;
      r.grievance[k] = Math.round(r.grievance[k] * 0.97 * 1000) / 1000;
    }
    r.trade = Math.round(r.trade * 0.97 * 1000) / 1000;
    if (r.war >= 0) considerPeace(x, r);
    else {
      considerWar(x, r, 0);
      if (r.war < 0) considerWar(x, r, 1);
      if (r.war < 0) treaties(x, r);
    }
  }
  // campaigns and raids
  for (const st of ps.settlements) {
    if (st.fallen >= 0 || st.band) continue;
    if (atWar(x, st)) campaign(x, st);
    else raidIfDesperate(x, st);
  }
}

function popOf(x: PCtx, st: Settlement): number {
  return (x.ps.members.get(st.id)?.length ?? 0) + cohortTotal(st);
}

/** what a polity should think of another, given everything */
function opinionTarget(x: PCtx, r: Relation, me: number, them: number, k: 0 | 1): number {
  const mine = settlementsOf(x, me), theirs = settlementsOf(x, them);
  const capA = x.ps.settlement(x.ps.polity(me)?.capital ?? -1) ?? mine[0];
  const capB = x.ps.settlement(x.ps.polity(them)?.capital ?? -1) ?? theirs[0];
  let t = 0;
  const sameKind = capA.species === capB.species;
  t += sameKind ? 0.1 : -0.15;
  if (sameKind) {
    const ld = langDistance(capA, capB);
    t -= ld * 0.25;
    if (ld < 0.5) t += 0.15; // kin who remember it
  }
  // faith: another god, or none against believers
  if (capA.god !== capB.god) {
    const pious = meanTrait(x, capA, TRAIT.piety);
    t -= (capA.god >= 0 && capB.god >= 0 ? 0.25 : 0.1) * (0.5 + pious);
  }
  t += Math.min(0.35, r.trade / 40);
  t -= r.grievance[k] * 0.6;
  if (r.war >= 0) t -= 0.3;
  const want = covets(x, me, them);
  if (want) t -= 0.45;
  // borders that touch
  let touch = false;
  for (const a of mine) for (const b of theirs) if (distM(x.p, a.pos, b.pos) < a.territory + b.territory + 30) touch = true;
  if (touch) t -= 0.15;
  if (r.treaties.includes('trade-pact')) t += 0.15;
  if (r.treaties.includes('alliance')) t += 0.3;
  if (r.treaties.includes(`tribute:${me}`)) t -= 0.12;
  if (r.treaties.includes(`tribute:${them}`)) t += 0.05;
  // a common enemy
  const theirEnemies = enemiesOf(x, them);
  if (enemiesOf(x, me).some((e) => theirEnemies.includes(e))) t += 0.2;
  // hawks and a warlike chief
  const hawks = factionShare(capA, 'hawks');
  const lead = x.A.slotOf(capA.leader);
  const aggr = lead >= 0 ? x.A.traits[lead * NT + TRAIT.aggression] : 0.3;
  t -= Math.max(0, aggr - 0.35) * 0.4 + hawks * 0.3;
  // the culture: fearful peoples trust no one
  t += capA.culture.alignment * 0.15;
  return Math.max(-1, Math.min(1, t));
}

function meanTrait(x: PCtx, st: Settlement, trait: number): number {
  const members = x.ps.members.get(st.id) ?? [];
  if (!members.length) return 0.5;
  let s = 0;
  for (const m of members) s += x.A.traits[m * NT + trait];
  return s / members.length;
}

/** side k of r may declare war on the other */
function considerWar(x: PCtx, r: Relation, k: 0 | 1): void {
  if (r.truce > x.tick) return;
  const me = k === 0 ? r.a : r.b, them = k === 0 ? r.b : r.a;
  const op = r.op[k];
  if (op > -0.4) return;
  const mine = polityStrength(x, me), theirs = polityStrength(x, them);
  const cap = x.ps.settlement(x.ps.polity(me)?.capital ?? -1);
  if (!cap) return;
  const hungry = foodDays(x, cap) < popOf(x, cap) * 1;
  if (mine < theirs * (hungry ? 0.5 : 0.75)) return;
  // the war party must carry the day
  const hawks = factionShare(cap, 'hawks');
  const lead = x.A.slotOf(cap.leader);
  const aggr = lead >= 0 ? x.A.traits[lead * NT + TRAIT.aggression] : 0.3;
  if (hawks < 0.2 && aggr < 0.5 && op > -0.65) return;
  const p = 0.18 * (-op - 0.4) * 3 * (0.6 + hawks + aggr);
  if (hashFloat(r.a * 2 + k, r.b, x.tick, 0x3a7) >= p) return;
  const want = covets(x, me, them);
  const cause = want ? want : hungry ? 'hunger' : r.grievance[k] > 0.4 ? 'raids' : cap.god !== (x.ps.settlement(x.ps.polity(them)?.capital ?? -1)?.god ?? cap.god) ? 'faith' : 'land';
  declareWar(x, me, them, cause);
}

const CAUSE_WORDS: Record<string, string> = {
  iron: 'the iron of the hills', copper: 'the green copper stones', tin: 'the tin', coal: 'the black stone that burns', salt: 'the salt',
  hunger: 'bread', raids: 'old raids and stolen grain', faith: 'their gods', land: 'land', god: 'the will of the god', revolt: 'freedom',
};

/** polity `a` declares war on polity `b` (allies join) */
export function declareWar(x: PCtx, a: number, b: number, cause: string): Relation | undefined {
  const r = ensureRelation(x, a, b);
  if (!r || r.war >= 0) return r;
  r.war = x.tick;
  r.aggressor = a;
  r.cause = cause;
  r.casualties = [0, 0];
  r.score = 0;
  r.treaties = r.treaties.filter((t) => t !== 'trade-pact' && t !== 'alliance');
  const pa = x.ps.polity(a), pb = x.ps.polity(b);
  const ca = x.ps.settlement(pa?.capital ?? -1), cb = x.ps.settlement(pb?.capital ?? -1);
  if (ca && cb) {
    tell(x.u, x.p, 'war', vars(x, ca, -1, { polity: polityName(x, pa), other: polityName(x, pb), cause: CAUSE_WORDS[cause] ?? cause }), ca, [settlementRef(x, ca), settlementRef(x, cb)], 3);
    remember(cb, x.tick, 'war', `${polityName(x, pa)} made war on us over ${CAUSE_WORDS[cause] ?? cause}.`, 2);
    x.u.emit({ t: 'war', planet: x.p.id, pos: [cb.pos[0], cb.pos[1], cb.pos[2]], ref: settlementRef(x, cb), data: { aggressor: a, defender: b, cause } });
    for (const st of settlementsOf(x, a)) accident(x, st, 'war', st.cell);
    for (const st of settlementsOf(x, b)) accident(x, st, 'war', st.cell);
  }
  if (x.ps.firsts.war === undefined) x.ps.firsts.war = x.tick;
  // allies of the defender come in
  for (const o of x.ps.relations) {
    if (o === r || !o.treaties.includes('alliance')) continue;
    const ally = o.a === b ? o.b : o.b === b ? o.a : -1;
    if (ally < 0 || ally === a) continue;
    const ra = ensureRelation(x, ally, a);
    if (ra && ra.war < 0) {
      ra.war = x.tick; ra.aggressor = ally; ra.cause = 'alliance'; ra.casualties = [0, 0]; ra.score = 0;
      const cap = x.ps.settlement(x.ps.polity(ally)?.capital ?? -1);
      if (cap) tell(x.u, x.p, 'war.ally', vars(x, cap, -1, { polity: polityName(x, x.ps.polity(ally)), other: polityName(x, pa), ally: polityName(x, pb) }), cap, [settlementRef(x, cap)], 2);
    }
  }
  return r;
}

/** war-weariness brings peace; the stronger may exact tribute */
function considerPeace(x: PCtx, r: Relation): void {
  const as = settlementsOf(x, r.a), bs = settlementsOf(x, r.b);
  const popA = as.reduce((s, st) => s + popOf(x, st), 0), popB = bs.reduce((s, st) => s + popOf(x, st), 0);
  const days = (x.tick - r.war) / x.day;
  const hungerA = as.some((st) => foodDays(x, st) < popOf(x, st) * 0.6) ? 0.3 : 0;
  const hungerB = bs.some((st) => foodDays(x, st) < popOf(x, st) * 0.6) ? 0.3 : 0;
  const weary = (r.casualties[0] / Math.max(1, popA) + r.casualties[1] / Math.max(1, popB)) * 3 + days / 24 + hungerA + hungerB;
  let dip = 1;
  for (const st of [...as, ...bs]) for (const [k, v] of x.rt.effects.get('diplomacy') ?? []) if (st.library.includes(k)) { dip = Math.max(dip, v); }
  const p = (0.03 + 0.15 * weary + (r.op[0] > -0.2 && r.op[1] > -0.2 ? 0.1 : 0)) * dip;
  if (days < 1 || hashFloat(r.a, r.b, x.tick, 0x9ea) >= p) return;
  // the side ahead on the field sets the terms
  const winner = r.score > 2 ? r.a : r.score < -2 ? r.b : -1;
  makePeace(x, r, winner >= 0 && Math.abs(r.score) > 3 ? winner : -1);
}

/** end a war by treaty (tributeTo: the polity the other pays tribute to, -1 for none) */
export function makePeace(x: PCtx, r: Relation, tributeTo: number): void {
  if (r.war < 0) return;
  const years = Math.max(0, Math.round(((x.tick - r.war) / x.year) * 10) / 10);
  r.war = -1;
  r.truce = x.tick + 2 * x.year;
  r.op[0] = Math.min(1, r.op[0] + 0.35);
  r.op[1] = Math.min(1, r.op[1] + 0.35);
  r.grievance = [r.grievance[0] * 0.5, r.grievance[1] * 0.5];
  const pa = x.ps.polity(r.a), pb = x.ps.polity(r.b);
  let terms = '';
  if (tributeTo >= 0) {
    const payer = tributeTo === r.a ? r.b : r.a;
    r.treaties = r.treaties.filter((t) => !t.startsWith('tribute:'));
    r.treaties.push(`tribute:${payer}`);
    const pp = x.ps.polity(payer);
    if (pp) pp.overlord = tributeTo;
    terms = `${polityName(x, pp)} pays tribute to ${polityName(x, x.ps.polity(tributeTo))}`;
  }
  // the soldiers come home
  for (const m of x.ps.missions) {
    if (m.kind !== 'war' && m.kind !== 'raid') continue;
    const f = x.ps.settlement(m.from), t = x.ps.settlement(m.to);
    if (!f || !t) continue;
    if ((f.polity === r.a && t.polity === r.b) || (f.polity === r.b && t.polity === r.a)) { homeward(x, m, 'peace'); if (t.besieged === m.id) t.besieged = -1; }
  }
  const ca = x.ps.settlement(pa?.capital ?? -1), cb = x.ps.settlement(pb?.capital ?? -1);
  if (ca && cb) {
    const v = vars(x, ca, -1, { polity: polityName(x, pa), other: polityName(x, pb), years: years >= 1 ? `${years} years` : `${Math.max(1, Math.round((years * x.year) / x.day))} days`, terms });
    tell(x.u, x.p, terms ? 'treaty.tribute' : 'treaty', v, ca, [settlementRef(x, ca), settlementRef(x, cb)], 2);
    remember(cb, x.tick, 'treaty', `We made peace with ${polityName(x, pa)}.`, 1);
    x.u.emit({ t: 'treaty', planet: x.p.id, pos: [ca.pos[0], ca.pos[1], ca.pos[2]], ref: settlementRef(x, ca), data: { a: r.a, b: r.b, kind: terms ? 'tribute' : 'peace' } });
  }
}

/** friendship and trade bring pacts; friendship and a shared enemy bring alliances */
function treaties(x: PCtx, r: Relation): void {
  const ca = x.ps.settlement(x.ps.polity(r.a)?.capital ?? -1), cb = x.ps.settlement(x.ps.polity(r.b)?.capital ?? -1);
  if (!ca || !cb) return;
  if (!r.treaties.includes('trade-pact') && r.trade > 12 && r.op[0] > 0.3 && r.op[1] > 0.3 && hashFloat(r.a, r.b, x.tick, 0x7ac) < 0.2) {
    r.treaties.push('trade-pact');
    tell(x.u, x.p, 'treaty.trade', vars(x, ca, -1, { polity: polityName(x, x.ps.polity(r.a)), other: polityName(x, x.ps.polity(r.b)) }), ca, [settlementRef(x, ca), settlementRef(x, cb)], 1);
  }
  if (!r.treaties.includes('alliance') && r.op[0] > 0.5 && r.op[1] > 0.5) {
    const ea = enemiesOf(x, r.a), eb = enemiesOf(x, r.b);
    const sharedFoe = ea.some((e) => eb.includes(e)) || x.ps.relations.some((o) => o !== r && ((o.a === r.a || o.b === r.a) && o.grievance[side(o, r.a)] > 0.5));
    if (sharedFoe && hashFloat(r.a, r.b, x.tick, 0xa11) < 0.25) {
      r.treaties.push('alliance');
      tell(x.u, x.p, 'treaty.alliance', vars(x, ca, -1, { polity: polityName(x, x.ps.polity(r.a)), other: polityName(x, x.ps.polity(r.b)) }), ca, [settlementRef(x, ca), settlementRef(x, cb)], 2);
    }
  }
}

/** daughter towns far from their capital, or speaking another tongue, go their own way */
function independence(x: PCtx): void {
  for (const st of x.ps.settlements) {
    if (st.fallen >= 0 || st.band || st.polity === st.id) continue;
    const pl = x.ps.polity(st.polity);
    const cap = pl ? x.ps.settlement(pl.capital) : undefined;
    if (!pl || !cap || cap.fallen >= 0 || cap.id === st.id) { if (pl && pl.capital !== st.id) secede(x, st, pl, ''); continue; }
    const far = distM(x.p, st.pos, cap.pos) > 1400;
    const tongue = langDistance(st, cap) > 0.45;
    const schism = st.recent.schism !== undefined;
    const conquered = st.recent.conquered !== undefined && x.tick - st.recent.conquered > 2 * x.year && st.culture.alignment < cap.culture.alignment - 0.2;
    const p = (far ? 0.01 : 0) + (tongue ? 0.01 : 0) + (schism ? 0.08 : 0) + (conquered ? 0.02 : 0);
    if (p > 0 && hashFloat(st.id, x.tick, 0x1d3) < p) secede(x, st, pl, conquered ? 'revolt' : '');
  }
}

/** st leaves its polity and founds its own */
export function secede(x: PCtx, st: Settlement, from: Polity, cause: string): void {
  const old = from.id;
  st.polity = st.id;
  const pl = polityOf(x, st)!;
  pl.capital = st.id;
  pl.founded = x.tick;
  delete st.recent.schism;
  const r = ensureRelation(x, old, st.id);
  if (r) {
    const k = side(r, st.id);
    r.op[k] = cause === 'revolt' ? -0.4 : 0.25;
    r.op[1 - k] = cause === 'revolt' ? -0.5 : 0.2;
    r.contact = x.tick;
  }
  const cap = x.ps.settlement(from.capital);
  tell(x.u, x.p, cause === 'revolt' ? 'revolt' : 'independence', vars(x, st, -1, { other: cap ? cap.name : 'its old masters', polity: polityName(x, pl) }), st, [settlementRef(x, st)], 2);
  if (cause === 'revolt') declareWar(x, st.id, old, 'revolt');
  x.ps.version++;
}

// ───────────────────────────── campaigns ─────────────────────────────

/** a warring settlement sends a war band against the nearest enemy town it can reach */
function campaign(x: PCtx, st: Settlement): void {
  for (const m of x.ps.missions) if (m.from === st.id && (m.kind === 'war' || m.kind === 'raid') && m.phase < 3) return;
  const foes = enemiesOf(x, st.polity);
  let target: Settlement | null = null, bd = 2400;
  for (const o of x.ps.settlements) {
    if (o.fallen >= 0 || o.band || !foes.includes(o.polity)) continue;
    const d = distM(x.p, st.pos, o.pos);
    if (d < bd) { bd = d; target = o; }
  }
  if (!target) return;
  const home = defenders(x, st);
  const able = home.filter((s) => !(x.A.flags[s] & AgentFlag.elder) && x.A.health[s] > 0.55);
  if (able.length < 5) return;
  // weighed against the defenders in the field (walls make a siege of it); the side that started it marches unless
  // hopelessly outnumbered, the other only strikes back when clearly stronger
  const theirs = defenceStrength(x, target, defenders(x, target), false);
  const n = Math.max(3, Math.min(30, Math.round(able.length * 0.75)));
  const ours = bandStrength(x, st, able.slice(0, n));
  const r = relationOf(x, st.polity, target.polity);
  const aggressor = r && r.aggressor === st.polity;
  if (!aggressor && ours < theirs * 1.1) return;
  if (ours < theirs * 0.4) return;
  const route = routeBetween(x, st, target);
  if (!route.land && !(route.sea && bestBoat(x, st) >= 0)) return;
  const who = volunteers(x, st, n, true);
  const m = newMission(x, 'war', st, target, who);
  if (m) {
    const lead = who[0];
    tell(x.u, x.p, 'war.march', vars(x, st, lead, { other: target.name, count: m.members.length }), st, [agentRef(x, lead), settlementRef(x, target)], 1);
  }
}

/** a hungry, warlike settlement raids a fat neighbour's stores (no war declared) */
function raidIfDesperate(x: PCtx, st: Settlement): void {
  const P = popOf(x, st);
  if (P < 8 || foodDays(x, st) > P * 0.8) return;
  for (const m of x.ps.missions) if (m.from === st.id && m.phase < 3 && (m.kind === 'raid' || m.kind === 'war')) return;
  const hawks = factionShare(st, 'hawks');
  const lead = x.A.slotOf(st.leader);
  const aggr = lead >= 0 ? x.A.traits[lead * NT + TRAIT.aggression] : 0.3;
  if (hawks < 0.25 && aggr < 0.55) return;
  let target: Settlement | null = null, best = 3;
  for (const id of st.contacts) {
    const o = x.ps.settlement(id);
    if (!o || o.fallen >= 0 || o.band || o.polity === st.polity) continue;
    const r = relationOf(x, st.polity, o.polity);
    if (r && (r.truce > x.tick || r.op[side(r, st.polity)] > 0.25 || r.treaties.includes('alliance'))) continue;
    if (distM(x.p, st.pos, o.pos) > 1500) continue;
    const per = foodDays(x, o) / Math.max(1, popOf(x, o));
    if (per > best) { best = per; target = o; }
  }
  if (!target || hashFloat(st.id, x.tick, 0x4a1d) > 0.35 * (hawks + aggr)) return;
  const route = routeBetween(x, st, target);
  if (!route.land && !(route.sea && bestBoat(x, st) >= 0)) return;
  const who = volunteers(x, st, Math.min(6, Math.max(3, Math.floor(P / 8))), true);
  if (who.length < 3) return;
  newMission(x, 'raid', st, target, who);
}

// ───────────────────────────── battles and sieges ─────────────────────────────

/** the war band reached its target: a fight in the open, or a siege before the walls */
export function resolveArrival(x: PCtx, m: Mission, from: Settlement, to: Settlement): void {
  const walls = wallFactor(x, to);
  const att = bandStrength(x, from, slotsOf(x, m));
  const def = defenceStrength(x, to, defenders(x, to), true);
  m.strength = Math.round(att * 100) / 100;
  if (walls > 1.25 && att < def && m.kind === 'war') {
    // the walls hold them off: they camp and starve the town
    to.besieged = m.id;
    m.siege = 0;
    m.note = 'siege';
    tell(x.u, x.p, 'siege', vars(x, to, -1, { other: from.name, polity: polityName(x, polityOf(x, from)) }), to, [settlementRef(x, to), settlementRef(x, from)], 2);
    x.u.emit({ t: 'siege', planet: x.p.id, pos: [to.pos[0], to.pos[1], to.pos[2]], ref: settlementRef(x, to), data: { by: from.id } });
    accident(x, to, 'siege', to.cell);
    return;
  }
  battle(x, m, from, to, walls > 1.25 && att >= def ? walls : 1);
}

function slotsOf(x: PCtx, m: Mission): number[] {
  const out: number[] = [];
  for (const id of m.members) { const s = x.A.slotOf(id); if (s >= 0) out.push(s); }
  return out;
}

/** a battle: strength × fortune; the loser loses many, the winner some; raiders who win carry off the stores */
function battle(x: PCtx, m: Mission, from: Settlement, to: Settlement, walls: number): void {
  const A = x.A;
  const att = slotsOf(x, m);
  const defs = defenders(x, to);
  const sa = bandStrength(x, from, att) * (0.8 + 0.45 * hashFloat(m.id, x.tick, 0xba1));
  const sd = defenceStrength(x, to, defs, false) * walls * (0.8 + 0.45 * hashFloat(m.id, x.tick, 0xba2));
  const won = sa > sd;
  const r = ensureRelation(x, from.polity, to.polity);
  // the loser's share of the strength on the field (0 a rout .. 0.5 an even fight)
  const ratio = Math.min(sa, sd) / Math.max(1e-6, sa + sd);
  const loserShare = 0.12 + 0.26 * (1 - ratio);
  const winnerShare = 0.04 + 0.16 * ratio;
  const deadA = casualties(x, att, won ? winnerShare : loserShare, m.id, 0xca1);
  const deadD = casualties(x, defs, won ? loserShare : winnerShare, m.id, 0xca2);
  // the cohort's fighters bleed too
  const coLoss = (won ? loserShare : winnerShare) * 0.5;
  const coDead = Math.round(to.cohort.n[1] * coLoss * 100) / 100;
  to.cohort.n[1] = Math.max(0, to.cohort.n[1] - coDead);
  const total = deadA + deadD + Math.round(coDead);
  if (r) {
    const ka = side(r, from.polity), kd = side(r, to.polity);
    r.casualties[ka] += deadA;
    r.casualties[kd] += deadD + Math.round(coDead);
    r.score += (won ? 1 : -1) * (ka === 0 ? 1 : -1);
    r.last = x.tick;
    r.grievance[kd] = Math.min(3, r.grievance[kd] + 0.3 + deadD * 0.02);
    r.grievance[ka] = Math.min(3, r.grievance[ka] + deadA * 0.02);
  }
  for (const s of slotsOf(x, m)) { A.remember(s, MEMK.fought, x.tick, to.id); A.skills[s * NS + SKILL.fight] = Math.min(1, A.skills[s * NS + SKILL.fight] + 0.04); }
  accident(x, from, 'battle', from.cell);
  accident(x, to, 'battle', to.cell);
  const lead = slotsOf(x, m)[0];
  const v = vars(x, from, lead ?? -1, { other: to.name, count: total, dead: deadA, theirs: deadD + Math.round(coDead) });
  let note = '';
  if (won) {
    if (m.kind === 'raid') note = plunder(x, m, from, to);
    else {
      // a beaten town with no one left to fight is taken
      const left = defenceStrength(x, to, defenders(x, to), false);
      if (left < sa * 0.25 || defenders(x, to).length < 3) { conquer(x, from, to, m); note = 'conquest'; }
      else { note = plunder(x, m, from, to); if (hashFloat(m.id, 0xf13) < 0.4) burnSomething(x, to); }
    }
    tell(x.u, x.p, m.kind === 'raid' ? 'raid.won' : 'battle.won', v, from, [settlementRef(x, from), settlementRef(x, to)], m.kind === 'raid' ? 1 : 2);
  } else {
    tell(x.u, x.p, m.kind === 'raid' ? 'raid.lost' : 'battle.lost', v, to, [settlementRef(x, from), settlementRef(x, to)], m.kind === 'raid' ? 1 : 2);
  }
  if (m.kind === 'raid') {
    grieve(x, to.polity, from.polity, 0.35);
    // a raid is remembered (watch kept, walls raised) and is a lesson in itself: the 'raid' trigger of recipes
    to.recent.raided = x.tick;
    accident(x, to, 'raid', to.cell);
    accident(x, from, 'raid', from.cell);
  }
  x.u.emit({ t: 'battle', planet: x.p.id, pos: [to.pos[0], to.pos[1], to.pos[2]], a: total, ref: settlementRef(x, to), data: { attacker: from.id, defender: to.id, won, dead: total, kind: m.kind } });
  m.note = note || (won ? 'victory' : 'defeat');
  if (to.besieged === m.id) to.besieged = -1;
  homeward(x, m, m.note);
}

/** a share of the fighters fall (the weakest first, ties by id) */
function casualties(x: PCtx, slots: number[], share: number, salt: number, salt2: number): number {
  const A = x.A;
  const live = slots.filter((s) => A.alive[s]).sort((a, b) => A.health[a] - A.health[b] || A.id[a] - A.id[b]);
  const n = Math.min(live.length, Math.round(live.length * share + hashFloat(salt, x.tick, salt2) * 0.99 - 0.25));
  let dead = 0;
  for (let i = 0; i < live.length; i++) {
    const s = live[i];
    if (i < n) { die(x, s, DEATH.war); dead++; continue; }
    // the rest are bruised
    if (hashFloat(A.id[s], x.tick, salt2) < share) { A.health[s] = Math.max(0.15, A.health[s] - 0.25); A.remember(s, MEMK.wounded, x.tick, 0); }
  }
  return dead;
}

/** raiders take what they can carry: food first, then metal and finery */
function plunder(x: PCtx, m: Mission, from: Settlement, to: Settlement): string {
  const A = x.A;
  const slots = slotsOf(x, m);
  const order = [...x.info[from.species].foods, ...(x.c.itemsByTag.get('metal') ?? []), ...(x.c.itemsByTag.get('luxury') ?? []), ...(x.c.itemsByTag.get('weapon') ?? [])];
  const took: string[] = [];
  for (const s of slots) {
    let room = 10;
    for (const it of order) {
      if (room <= 0.5) break;
      const have = to.store[it] ?? 0;
      if (have < 0.5) continue;
      const w = Math.max(0.1, x.c.items.list[it].weight);
      const q = storeTake(to, it, Math.min(have * 0.5, room / w));
      if (q <= 0) continue;
      const left = A.give(s, it, q);
      if (left > 0) { storeAdd(x, to, it, left); break; }
      room -= q * w;
      const name = x.c.items.list[it].name.toLowerCase();
      if (!took.includes(name)) took.push(name);
    }
  }
  m.back = [];
  return took.length ? `carried off ${took.slice(0, 3).join(', ')}` : 'found the stores empty';
}

function burnSomething(x: PCtx, st: Settlement): void {
  const bs = x.ps.of(st.id).filter((b) => b.progress >= 1 && !(b.flags & BuildingFlag.ruined) && (x.c.materials.list[b.material]?.flammability ?? 0) > 0.3);
  if (!bs.length) return;
  const b = bs[hash32(st.id, x.tick, 0xf14) % bs.length];
  igniteCell(x.u, x.p, b.cell, 0.5, 'war');
}

/**
 * Hourly while a war band stands at its target: once a day of siege the walls are battered (cannon and siege craft
 * break them; without, they wear slowly), the town eats into its stores; it surrenders when starving, the band storms
 * a breach, or goes home after a week. Returns true when the band should go home.
 */
export function warDone(x: PCtx, m: Mission, from: Settlement, to: Settlement): boolean {
  if (m.phase !== 2) return false;
  if (m.note && m.note !== 'siege') return true;
  if (to.besieged !== m.id) return true;
  if ((x.tick - m.tPhase) % x.day !== 0 || x.tick === m.tPhase) return false;
  m.siege++;
  // batter the walls
  const engines = storeHas(from, x.c.items.idx('cannon')) >= 1 || from.library.includes(x.rt.byId.get('siegecraft') ?? -1);
  for (const b of x.ps.of(to.id)) {
    const fn = x.c.buildings.list[b.type].function;
    if (fn !== 'wall' && fn !== 'tower') continue;
    if (b.flags & BuildingFlag.ruined) continue;
    b.damage = Math.min(1, Math.round((b.damage + (engines ? 0.3 : 0.06) * (0.6 + 0.8 * hashFloat(b.id, x.tick, 0x5e9))) * 1000) / 1000);
    if (b.damage >= 1) ruin(x, to, b, 'siege');
    x.ps.version++;
  }
  const P = popOf(x, to);
  const starving = foodDays(x, to) < P * 0.3;
  const att = bandStrength(x, from, slotsOf(x, m));
  const def = defenceStrength(x, to, defenders(x, to), true);
  if (starving && m.siege >= 2) {
    tell(x.u, x.p, 'siege.surrender', vars(x, to, -1, { other: from.name, days: m.siege }), to, [settlementRef(x, to), settlementRef(x, from)], 2);
    conquer(x, from, to, m);
    m.note = 'conquest';
    to.besieged = -1;
    return true;
  }
  if (att > def) {
    // a breach: storm it
    to.besieged = -1;
    m.note = '';
    battle(x, m, from, to, 1);
    return true;
  }
  // the defenders sally out when they are clearly the stronger
  if (def > att * 1.6) { to.besieged = -1; m.note = ''; battle(x, m, from, to, 1); return true; }
  if (m.siege >= 7 || slotsOf(x, m).every((s) => x.A.needs[s * NEED_N] < 0.15)) {
    to.besieged = -1;
    tell(x.u, x.p, 'siege.held', vars(x, to, -1, { other: from.name, days: m.siege }), to, [settlementRef(x, to), settlementRef(x, from)], 2);
    const r = relationOf(x, from.polity, to.polity);
    if (r) r.score += side(r, to.polity) === 0 ? 1 : -1;
    m.note = 'the walls held';
    return true;
  }
  return false;
}

// ───────────────────────────── conquest ─────────────────────────────

/** `to` falls to `from`'s polity: its polity changes, its culture takes on the conqueror's, some flee */
export function conquer(x: PCtx, from: Settlement, to: Settlement, m: Mission | null): void {
  const old = to.polity;
  const oldPl = x.ps.polity(old);
  const conqueror = polityOf(x, from);
  if (!conqueror) return;
  const oldName = polityName(x, oldPl);
  to.polity = conqueror.id;
  to.recent.conquered = x.tick;
  // cultures blend: the conquered take something of the conquerors' ways
  const cc = x.ps.settlement(conqueror.capital) ?? from;
  to.culture.alignment = Math.round((to.culture.alignment * 0.7 + cc.culture.alignment * 0.3) * 1000) / 1000;
  for (const k of cc.culture.taboos) if (!to.culture.taboos.includes(k)) to.culture.taboos.push(k);
  for (const s of cc.culture.sacred) if (!to.culture.sacred.includes(s) && to.culture.sacred.length < 12) to.culture.sacred.push(s);
  if (hashFloat(to.id, x.tick, 0xb1e) < 0.5) to.culture.mode = cc.culture.mode;
  to.culture.conservatism = Math.min(0.9, to.culture.conservatism + 0.1);
  // the old chief loses office
  const lead = x.A.slotOf(to.leader);
  if (lead >= 0) { x.A.flags[lead] &= ~AgentFlag.leader; x.A.remember(lead, MEMK.conquered, x.tick, from.id); }
  to.leader = 0;
  for (const s of x.ps.members.get(to.id) ?? []) x.A.remember(s, MEMK.conquered, x.tick, from.id);
  // some will not live under them: refugees go to their own people
  const fled = refugees(x, to, old);
  tell(x.u, x.p, 'conquest', vars(x, to, -1, { other: from.name, polity: polityName(x, conqueror), old: oldName }), to, [settlementRef(x, to), settlementRef(x, from)], 3);
  remember(to, x.tick, 'conquest', `${from.name} took us by force.`, 3);
  accident(x, to, 'conquest', to.cell);
  x.u.emit({ t: 'conquest', planet: x.p.id, pos: [to.pos[0], to.pos[1], to.pos[2]], ref: settlementRef(x, to), data: { by: conqueror.id, from: old, fled } });
  // the old polity: a new capital, or the end of it
  if (oldPl && oldPl.capital === to.id) {
    const rest = settlementsOf(x, old);
    if (rest.length) oldPl.capital = rest.reduce((a, b) => (popOf(x, b) > popOf(x, a) ? b : a)).id;
    else {
      if (!oldPl.name) oldPl.name = oldName;
      oldPl.capital = -1;
      const r = relationOf(x, old, conqueror.id);
      if (r && r.war >= 0) endWar(x, r, conqueror.id, 'conquest');
    }
  }
  if (m) m.note = 'conquest';
  x.ps.version++;
}

/** a war ends because one side is gone */
function endWar(x: PCtx, r: Relation, winner: number, why: string): void {
  if (r.war < 0) return;
  r.war = -1;
  r.truce = x.tick + x.year;
  const pl = x.ps.polity(winner);
  const cap = x.ps.settlement(pl?.capital ?? -1);
  const loser = x.ps.polity(winner === r.a ? r.b : r.a);
  if (cap) tell(x.u, x.p, 'war.end', vars(x, cap, -1, { polity: polityName(x, pl), other: polityName(x, loser), cause: why }), cap, [settlementRef(x, cap)], 2);
}

/** what one side has lost (inspector) */
export function warSummary(x: PCtx, r: Relation): { aggressor: string; cause: string; days: number; casualties: [number, number]; score: number } {
  return { aggressor: polityName(x, x.ps.polity(r.aggressor)), cause: r.cause, days: r.war >= 0 ? Math.round((x.tick - r.war) / x.day) : 0, casualties: [r.casualties[0], r.casualties[1]], score: r.score };
}

export { ERAS, INV, agentName };
