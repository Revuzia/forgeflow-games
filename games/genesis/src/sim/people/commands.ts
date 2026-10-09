// GENESIS — the god's commands over peoples (CONTRACT.md §11.1, §11.2): spawn people and animals; move, kill, heal,
// teach, silence, make a disciple of, rename and age an agent; gift items to a settlement (which may refuse them);
// introduce an item, idea, artifact, animal or crop; withdraw something; teach an idea to an agent or a settlement
// (which may REFUSE: taboo, fear, low faith, conservatism, missing foundations); settle a band, rename or raze a
// settlement; possess an agent (the hook later phases drive). Every act is witnessed: love or fear by what it was.

import type { CommandRegistry, ParamSchema } from '../god/commands.ts';
import type { CommandResult, EntityRef, UnitVec } from '../types.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Settlement } from './state.ts';
import { AgentFlag, BuildingFlag } from '../types.ts';
import { ERAS } from '../content.ts';
import { makeCtx, type PCtx } from './ctx.ts';
import { DEATH, MEMK, NN } from './defs.ts';
import { spawnPeople, landingCell } from './spawn.ts';
import { spawnHerd, habitatFit } from '../life/herds.ts';
import { die } from './lifecycle.ts';
import { godTeach, silence, accident, refusalOf } from './knowledge.ts';
import { interrupt, witness, dropItem } from './people.ts';
import { storeAdd, storeTake, storeHas } from './store.ts';
import { agentName, vars, settlementRef, agentRef, kName } from './util.ts';
import { tell } from './story.ts';
import { found, siteScore, updateTerritory, fall } from './settlement.ts';
import { ruin } from './buildings.ts';
import { distM, spotInCell } from './world.ts';
import { focusPeople } from './cohorts.ts';
import { animalDef, animalIdx, reindexHerds } from '../life/herds.ts';
import { introduceSpecies, plural } from '../life/ecology.ts';
import { seedDisease } from '../life/disease.ts';
import { declareWar, makePeace, polityName, polityOf, relationOf, ensureRelation } from './war.ts';
import { splitOff } from './settlement.ts';
import { insertSorted } from './lifecycle.ts';

function ok(msg: string, created?: EntityRef[]): CommandResult {
  const r: CommandResult = { ok: true, msg };
  if (created) r.created = created;
  return r;
}
function fail(msg: string): CommandResult {
  return { ok: false, msg };
}

const pos = (required = false): ParamSchema => ({ type: 'pos', required, desc: 'where (unit vector or lat/lon)' });
const agentId: ParamSchema = { type: 'int', required: true, min: 1, desc: 'agent id' };

function agentSlot(x: PCtx, id: number): number {
  return x.A.slotOf(id);
}

/** a settlement named by id, by name, or the nearest one to a place */
function findSettlement(x: PCtx, a: Record<string, unknown>): Settlement | null {
  const ps = x.ps;
  if (typeof a.settlement === 'number') return ps.settlement(a.settlement) ?? null;
  if (typeof a.settlement === 'string') {
    const n = a.settlement.toLowerCase();
    return ps.settlements.find((st) => st.name.toLowerCase() === n) ?? ps.settlements.find((st) => st.name.toLowerCase().startsWith(n)) ?? null;
  }
  const p = a.pos as UnitVec | null | undefined;
  if (p) {
    let best: Settlement | null = null, bd = Infinity;
    for (const st of ps.settlements) {
      if (st.fallen >= 0) continue;
      const d = distM(x.p, st.pos, p);
      if (d < bd) { bd = d; best = st; }
    }
    if (best && bd < 1500) return best;
  }
  return null;
}

const speciesEnum = (u: Universe) => u.content.species.ids();
/** content animals and the species born on any world */
const animalIds = (u: Universe) => [...u.content.animals.ids(), ...u.planets.flatMap((pl) => pl.people.species.map((d) => d.def.id))];
const herdPosOf = (h: { from: number[]; to: number[]; t0: number; t1: number }, tick: number, out: number[]) => {
  let k = h.t1 > h.t0 ? (tick - h.t0) / (h.t1 - h.t0) : 1;
  k = k < 0 ? 0 : k > 1 ? 1 : k;
  const v = [0, 1, 2].map((i) => h.from[i] + (h.to[i] - h.from[i]) * k);
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  out[0] = v[0] / l; out[1] = v[1] / l; out[2] = v[2] / l;
};
const itemsEnum = (u: Universe) => u.content.items.ids();
const recipesEnum = (u: Universe) => u.content.recipes.ids();

export function registerPeopleCommands(r: CommandRegistry): void {
  r.register('life.spawn-people', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const sid = typeof a.settlement === 'number' ? a.settlement : null;
    let at: ArrayLike<number> | undefined = (a.pos as UnitVec | null) ?? undefined;
    if (sid !== null) { const st = x.ps.settlement(sid); if (!st) return fail(`There is no settlement #${sid}.`); at = st.pos; }
    const sp = x.c.species.get(a.species as string);
    const st = spawnPeople(u, p, { species: sp.id, count: a.count as number, pos: at, era: (a.era as string) ?? 'stone', settled: a.settled as boolean });
    if (!st) return fail(`${sp.name} could not be placed on ${p.name}.`);
    const people = sp.plural.replace(/^the /, '');
    tell(u, p, 'spawn', { people, count: a.count as number }, null, [settlementRef(x, st)]);
    const air = p.st.atmosphere;
    const doomed = sp.breathes === 'o2' && air.pressure * air.o2 < 0.05 ? ' They cannot breathe here.' : sp.breathes === 'methane' && air.pressure * air.methane < 0.02 ? ' There is no methane here for them to breathe.' : '';
    return ok(`${a.count} ${people} stand on ${p.name}${st.band ? ', looking for a place to live' : ` at ${st.name}`}.${doomed}`, [settlementRef(x, st)]);
  }, {
    desc: 'Set a people down on the world', category: 'Peoples',
    params: {
      species: { type: 'enum', values: speciesEnum, default: 'plains-folk' }, count: { type: 'int', min: 1, max: 2000, default: 20 },
      pos: pos(), settlement: { type: 'any' }, era: { type: 'enum', values: [...ERAS], default: 'stone' }, settled: { type: 'boolean', default: false },
    },
  });

  r.register('life.spawn-animal', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const sp = animalIdx(x, a.species as string);
    if (sp < 0) return fail(`No ${a.species} live on ${p.name}.`);
    const c = p.cellAt(a.pos!);
    const def = animalDef(x, sp);
    if (habitatFit(x, sp, c) <= 0) return fail(`${def.name} cannot live there.`);
    // a species new to this world is an invasive one: no enemies, fast breeding for a few years
    const fresh = x.ps.eco.seen[String(sp)] === undefined;
    const h = fresh && !def.domestic ? introduceSpecies(x, sp, c, a.count as number, 'by the hand of the god') : spawnHerd(x, sp, c, a.count as number);
    if (!h) return fail(`${def.name} cannot live there.`);
    return ok(`A herd of ${a.count} ${def.name.toLowerCase()} appears.`, [{ kind: 'animal', id: h.id, planet: p.id }]);
  }, { desc: 'Make animals', category: 'Life', params: { species: { type: 'enum', values: animalIds, required: true }, count: { type: 'int', min: 1, max: 100000, default: 8 }, pos: pos(true) } });

  r.register('life.cull', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const sp = a.species ? animalIdx(x, String(a.species)) : -1;
    // a species named without a radius: everywhere on the world; otherwise around the place (the focus by default)
    const everywhere = sp >= 0 && a.radius === undefined;
    const at = everywhere ? null : a.pos as UnitVec | null;
    const radius = (a.radius as number) ?? 400;
    const share = (a.share as number) ?? 1;
    let n = 0;
    for (const h of x.ps.herds) {
      if (sp >= 0 && h.species !== sp) continue;
      if (at) { const hp = [0, 0, 0]; herdPosOf(h, u.tick, hp); if (distM(p, hp, at) > radius) continue; }
      if (sp < 0 && !at) continue;
      const k = h.count * share;
      h.count = Math.max(0, Math.round((h.count - k) * 1000) / 1000);
      n += k;
    }
    x.ps.herds = x.ps.herds.filter((h) => h.count >= 0.5);
    reindexHerds(x);
    x.ps.version++;
    if (at) witness(p, at, radius + 100, 'harm', 0.3);
    return ok(n ? `${Math.round(n)} animals are struck down.` : 'No animals there.');
  }, { desc: 'Cull animals (a species everywhere, or everything around a place)', category: 'Life', params: { species: { type: 'enum', values: animalIds }, pos: pos(), radius: { type: 'number', min: 1, max: 20000, desc: 'metres around the place (default 400; none with a species = everywhere)' }, share: { type: 'number', min: 0, max: 1, default: 1 } } });

  r.register('life.extinct', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const sp = animalIdx(x, String(a.species));
    if (sp < 0) return fail(`No ${a.species} live on ${p.name}.`);
    let n = 0;
    for (const h of x.ps.herds) if (h.species === sp) { n += h.count; h.count = 0; }
    x.ps.herds = x.ps.herds.filter((h) => h.count >= 0.5);
    reindexHerds(x);
    x.ps.version++;
    return ok(n ? `The last ${plural(animalDef(x, sp).name)} of ${p.name} are gone.` : `There were no ${plural(animalDef(x, sp).name)} on ${p.name}.`);
  }, { desc: 'Wipe a species from the world', category: 'Life', params: { species: { type: 'enum', values: animalIds, required: true } } });

  r.register('life.breed', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const sp = a.species ? animalIdx(x, String(a.species)) : -1;
    const at = sp >= 0 && a.radius === undefined ? null : a.pos as UnitVec | null;
    let n = 0;
    for (const h of x.ps.herds) {
      if (sp >= 0 && h.species !== sp) continue;
      if (at) { const hp = [0, 0, 0]; herdPosOf(h, u.tick, hp); if (distM(p, hp, at) > ((a.radius as number) ?? 400)) continue; }
      const add = h.count * (((a.factor as number) ?? 1.5) - 1);
      h.count = Math.round((h.count + add) * 1000) / 1000;
      h.hunger = Math.min(h.hunger, 0.2);
      n += add;
    }
    return ok(n ? `${Math.round(n)} young are born.` : 'No animals there.');
  }, { desc: 'Make animals multiply', category: 'Life', params: { species: { type: 'enum', values: animalIds }, pos: pos(), radius: { type: 'number', min: 1, max: 20000, desc: 'metres around the place (default 400; none with a species = everywhere)' }, factor: { type: 'number', min: 1, max: 20, default: 1.5 } } });

  // ── agents ──
  r.register('agent.move', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const s = agentSlot(x, a.id as number);
    if (s < 0) return fail('That person is not alive.');
    const to = a.pos!;
    interrupt(x, s);
    x.A.place(s, to[0], to[1], to[2], u.tick);
    const c = p.cellAt(to);
    x.A.cell[s] = c;
    x.ps.buckets.move(s, c);
    x.A.remember(s, MEMK.moved, u.tick, 0);
    x.A.fear[s * 4] = Math.min(1, x.A.fear[s * 4] + 0.1);
    x.A.love[s * 4] = Math.min(1, x.A.love[s * 4] + 0.05);
    return ok(`${agentName(x, s)} is set down elsewhere.`);
  }, { desc: 'Move a person', category: 'Peoples', params: { id: agentId, pos: pos(true) } });

  r.register('agent.kill', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const s = agentSlot(x, a.id as number);
    if (s < 0) return fail('That person is not alive.');
    const st = x.ps.settlement(x.A.settlement[s]);
    const name = agentName(x, s);
    const at = [0, 0, 0];
    x.A.posAt(s, u.tick, at);
    if (st) tell(u, p, 'kill', vars(x, st, s), st, [agentRef(x, s)]);
    die(x, s, DEATH.god);
    witness(p, at, 250, 'harm', 0.35);
    return ok(`${name} is struck down.`);
  }, { desc: 'Kill a person', category: 'Peoples', params: { id: agentId } });

  r.register('agent.heal', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const s = agentSlot(x, a.id as number);
    if (s < 0) return fail('That person is not alive.');
    const A = x.A;
    A.health[s] = 1;
    A.disease[s] = -1;
    A.flags[s] &= ~(AgentFlag.sick | AgentFlag.onFire);
    for (let k = 0; k < NN; k++) A.needs[s * NN + k] = Math.max(A.needs[s * NN + k], 0.8);
    A.remember(s, MEMK.healed, u.tick, 0);
    const st = x.ps.settlement(A.settlement[s]);
    const at = [0, 0, 0];
    A.posAt(s, u.tick, at);
    witness(p, at, 200, 'help', 0.3);
    if (st) { tell(u, p, 'heal', vars(x, st, s), st, [agentRef(x, s)], 0); accident(x, st, 'miracle', A.cell[s]); }
    return ok(`${agentName(x, s)} is whole again.`);
  }, { desc: 'Heal a person', category: 'Peoples', params: { id: agentId } });

  r.register('agent.teach', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const s = agentSlot(x, a.id as number);
    if (s < 0) return fail('That person is not alive.');
    const k = x.rt.byId.get(a.knowledge as string)!;
    const res = godTeach(x, [s], k);
    if (res.taught) return ok(`${agentName(x, s)} now knows ${kName(x, k)}.`);
    if (res.already) return ok(`${agentName(x, s)} already knows ${kName(x, k)}.`);
    return fail(`${agentName(x, s)} refuses ${kName(x, k)} (${Object.keys(res.reasons)[0] ?? 'unwilling'}).`);
  }, { desc: 'Teach a person an idea', category: 'Ideas', params: { id: agentId, knowledge: { type: 'enum', values: recipesEnum, required: true } } });

  r.register('agent.silence', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const s = agentSlot(x, a.id as number);
    if (s < 0) return fail('That person is not alive.');
    if (a.knowledge) {
      const k = x.rt.byId.get(a.knowledge as string)!;
      const n = silence(x, [s], k);
      return n ? ok(`${agentName(x, s)} forgets ${kName(x, k)}.`) : ok(`${agentName(x, s)} did not know ${kName(x, k)}.`);
    }
    // no idea named: they fall silent (cannot teach or talk), and forget what they learned beyond their upbringing
    const A = x.A;
    const start = x.info[A.species[s]].start;
    const lost: number[] = [];
    for (let k = 0; k < x.rt.n; k++) if (A.knows(s, k) && !start.includes(k)) lost.push(k);
    for (const k of lost) silence(x, [s], k);
    A.needs[s * NN + 5] = 0.2;
    return ok(`${agentName(x, s)} falls silent and forgets ${lost.length} thing${lost.length === 1 ? '' : 's'}.`);
  }, { desc: 'Make a person forget (or fall silent)', category: 'Ideas', params: { id: agentId, knowledge: { type: 'enum', values: recipesEnum } } });

  r.register('agent.make-disciple', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const s = agentSlot(x, a.id as number);
    if (s < 0) return fail('That person is not alive.');
    const A = x.A;
    A.flags[s] |= AgentFlag.disciple | AgentFlag.sees_god;
    A.love[s * 4] = 1;
    A.remember(s, MEMK.disciple, u.tick, 0);
    const st = x.ps.settlement(A.settlement[s]);
    if (st) tell(u, p, 'disciple', vars(x, st, s), st, [agentRef(x, s)]);
    return ok(`${agentName(x, s)} becomes your disciple.`);
  }, { desc: 'Make a disciple', category: 'Peoples', params: { id: agentId } });

  r.register('agent.rename', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const s = agentSlot(x, a.id as number);
    if (s < 0) return fail('That person is not alive.');
    const before = agentName(x, s);
    const name = String(a.name).trim().slice(0, 40);
    if (!name) return fail('A name needs letters.');
    x.ps.names[String(a.id)] = name;
    return ok(`${before} is now called ${name}.`);
  }, { desc: 'Rename a person', category: 'Peoples', params: { id: agentId, name: { type: 'string', required: true } } });

  r.register('agent.age', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const s = agentSlot(x, a.id as number);
    if (s < 0) return fail('That person is not alive.');
    const years = a.years as number;
    x.A.birth[s] = Math.round(x.A.birth[s] - years * x.year);
    if (x.A.birth[s] > u.tick) x.A.birth[s] = u.tick;
    const age = (u.tick - x.A.birth[s]) / x.year;
    return ok(`${agentName(x, s)} is now ${age.toFixed(0)} years old.`);
  }, { desc: 'Age (or rejuvenate) a person', category: 'Peoples', params: { id: agentId, years: { type: 'number', min: -500, max: 500, default: 10 } } });

  r.register('agent.possess', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const s = agentSlot(x, a.id as number);
    if (s < 0) return fail('That person is not alive.');
    if (a.on) { x.A.flags[s] |= AgentFlag.possessed; interrupt(x, s); }
    else { x.A.flags[s] &= ~AgentFlag.possessed; interrupt(x, s); }
    return ok(a.on ? `You look out through the eyes of ${agentName(x, s)}.` : `${agentName(x, s)} is their own again.`);
  }, { desc: 'Possess a person', category: 'Peoples', params: { id: agentId, on: { type: 'boolean', default: true } } });

  // ── ideas ──
  r.register('idea.teach', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const k = x.rt.byId.get(a.knowledge as string)!;
    let slots: number[] = [];
    let label = '';
    // whom: `agent` (an id), `settlement` (an id or a name), else `target` (a person's id first, else a settlement's
    // id or name), else the settlement nearest `pos`
    const one = typeof a.agent === 'number' ? a.agent : a.settlement === undefined && typeof a.target === 'number' ? a.target : -1;
    if (typeof a.agent === 'number' && agentSlot(x, a.agent) < 0) return fail('That person is not alive.');
    if (one >= 0 && agentSlot(x, one) >= 0) {
      slots = [agentSlot(x, one)];
      label = agentName(x, slots[0]);
    } else {
      const which = a.settlement !== undefined ? a.settlement : typeof a.target === 'number' || typeof a.target === 'string' ? a.target : undefined;
      const st = findSettlement(x, { settlement: which, pos: a.pos });
      if (!st) return fail('Teach whom? Name a person, a settlement, or point at one.');
      slots = (x.ps.members.get(st.id) ?? []).filter((m) => !(x.A.flags[m] & AgentFlag.child));
      label = st.name;
    }
    if (!slots.length) return fail('There is nobody there to teach.');
    const res = godTeach(x, slots, k);
    const name = kName(x, k);
    if (!res.taught && !res.refused) return ok(`${label} already knows ${name}.`);
    if (!res.taught) {
      const why = Object.entries(res.reasons).sort((q, w) => w[1] - q[1])[0]?.[0] ?? 'unwilling';
      const words: Record<string, string> = { taboo: 'it is forbidden to them', fear: 'they are afraid of you', faith: 'they do not believe in you', conservative: 'the old ways are enough for them', grasp: 'they cannot grasp it yet' };
      return { ok: false, msg: `${label} refused ${name}: ${words[why] ?? why}.` };
    }
    return ok(`${res.taught} of ${label} now know${res.taught === 1 ? 's' : ''} ${name}${res.refused ? `; ${res.refused} refused` : ''}.`);
  }, {
    desc: 'Teach an idea (it may be refused)', category: 'Ideas',
    params: {
      knowledge: { type: 'enum', values: recipesEnum, required: true }, agent: { type: 'int', min: 1, desc: 'a person (id)' },
      settlement: { type: 'any', desc: 'a settlement (id or name)' }, target: { type: 'any' }, pos: pos(),
    },
  });

  // ── settlements ──
  r.register('settlement.gift', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const st = findSettlement(x, a);
    if (!st) return fail('Give to whom? Name a settlement or point at one.');
    const items = a.items as Record<string, unknown>;
    if (!items || typeof items !== 'object') return fail('settlement.gift needs items: { item: qty }.');
    const given: string[] = [];
    const refused: string[] = [];
    const members = x.ps.members.get(st.id) ?? [];
    const fearful = st.fearGod > st.belief + 0.3;
    for (const key of Object.keys(items).sort()) {
      const it = x.c.items.idx(key);
      if (it < 0) return fail(`There is no such thing as '${key}'.`);
      const q = Math.max(0, Math.min(1e6, Number(items[key]) || 0));
      if (q <= 0) continue;
      // a gift tied to a taboo, or from a feared god, is refused: left to rot outside the village
      const taboo = (x.rt.producers[it] ?? []).some((k) => st.culture.taboos.includes(k));
      if (taboo || fearful) {
        const at = [0, 0, 0];
        spotInCell(p, st.cell, it, 0x91f7, at);
        dropItem(x, it, q, [at[0], at[1], at[2]], p.cellAt(at), false);
        refused.push(x.c.items.list[it].name.toLowerCase());
        continue;
      }
      storeAdd(x, st, it, q);
      given.push(`${q} ${x.c.items.list[it].name.toLowerCase()}`);
    }
    st.gifts++;
    witness(p, st.pos, st.territory + 100, 'help', refused.length ? 0.05 : Math.min(0.7, 0.2 + given.length * 0.1));
    for (const m of members) x.A.remember(m, MEMK.gift, u.tick, 0);
    if (refused.length) tell(u, p, 'refusal.gift', vars(x, st, -1, { item: refused.join(', ') }), st, [settlementRef(x, st)]);
    else if (given.length) tell(u, p, 'gift.accepted', vars(x, st, -1, { item: given.join(', ') }), st, [settlementRef(x, st)], 1);
    if (!given.length) return { ok: false, msg: `${st.name} would not take it: ${refused.join(', ')} left to rot.` };
    return ok(`${st.name} receives ${given.join(', ')}${refused.length ? `; they refused ${refused.join(', ')}` : ''}.`);
  }, { desc: 'Give a settlement things', category: 'Peoples', params: { settlement: { type: 'any' }, pos: pos(), items: { type: 'any', required: true } } });

  r.register('settlement.introduce', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const st = findSettlement(x, a);
    const at = (a.pos as UnitVec | null) ?? (st ? st.pos : null);
    if (!at) return fail('Introduce it where? Name a settlement or point at a place.');
    const cell = p.cellAt(at);
    if (a.item || a.artifact) {
      const id = String(a.item ?? a.artifact);
      const it = x.c.items.idx(id);
      if (it < 0) return fail(`There is no such thing as '${id}'.`);
      const spot = spotInCell(p, cell, it, 0x1a7e, [0, 0, 0]);
      dropItem(x, it, (a.qty as number) ?? 3, [spot[0], spot[1], spot[2]], p.cellAt(spot), true);
      if (st) { tell(u, p, 'introduce', vars(x, st, -1, { item: x.c.items.list[it].name.toLowerCase() }), st, [settlementRef(x, st)], 1); witness(p, at, 200, 'wonder', 0.3); }
      return ok(`A strange ${x.c.items.list[it].name.toLowerCase()} lies ${st ? `near ${st.name}` : 'on the ground'}. Someone will be curious.`);
    }
    if (a.idea) {
      const k = x.rt.byId.get(String(a.idea));
      if (k === undefined) return fail(`There is no idea called '${a.idea}'.`);
      if (!st) return fail('An idea needs minds: name a settlement.');
      // an idea enters through the most curious few
      const members = (x.ps.members.get(st.id) ?? []).filter((m) => !(x.A.flags[m] & AgentFlag.child));
      members.sort((q, w) => x.A.traits[w * 6] - x.A.traits[q * 6] || x.A.id[q] - x.A.id[w]);
      const res = godTeach(x, members.slice(0, Math.max(1, Math.ceil(members.length / 8))), k);
      if (!res.taught) return { ok: false, msg: `${st.name} turned the idea of ${kName(x, k)} away (${Object.keys(res.reasons)[0] ?? 'unwilling'}).` };
      return ok(`The idea of ${kName(x, k)} takes root in ${res.taught} mind${res.taught === 1 ? '' : 's'} at ${st.name}.`);
    }
    if (a.animal) {
      const sp = animalIdx(x, String(a.animal));
      if (sp < 0) return fail(`There is no animal called '${a.animal}'.`);
      const def = animalDef(x, sp);
      if (habitatFit(x, sp, cell) <= 0) return fail(`${def.name} cannot live there.`);
      const h = spawnHerd(x, sp, cell, (a.qty as number) ?? def.herd[0] + 2, def.domestic && st ? st.id : -1);
      if (h.owner >= 0) h.state = 4;
      return ok(`${def.name} come to ${st ? st.name : 'the land'}.`, [{ kind: 'animal', id: h.id, planet: p.id }]);
    }
    if (a.disease) {
      const d = x.c.diseases.idx(String(a.disease));
      if (d < 0) return fail(`There is no disease called '${a.disease}'.`);
      if (!st) return fail('A sickness needs people: name a settlement.');
      const n = seedDisease(x, st, d, Math.max(1, Math.round((a.qty as number) ?? 2)), 'the god');
      if (!n) return { ok: false, msg: `Nobody in ${st.name} can catch ${x.c.diseases.list[d].name.toLowerCase()}.` };
      witness(p, st.pos, st.territory + 100, 'harm', 0.4);
      return ok(`${x.c.diseases.list[d].name} comes to ${st.name}.`);
    }
    if (a.crop) {
      const sp = x.c.plants.idx(String(a.crop));
      if (sp < 0 || x.c.plants.list[sp].type !== 'crop') return fail(`'${a.crop}' is not a crop.`);
      const f = p.f;
      let n = 0;
      for (const c of p.cellsNear(at, 90).slice()) {
        if (f.water[c] > 0.1 || x.ps.bByCell.get(c).length) continue;
        f.cropSpecies[c] = sp;
        f.crop[c] = Math.max(f.crop[c], 0.2);
        if (st && !st.fields.includes(c)) st.fields.push(c);
        n++;
      }
      if (st) { st.fields.sort((q, w) => q - w); if (st.crop < 0) st.crop = sp; }
      p.bump('crop'); p.bump('cropSpecies'); p.vegDirty = true;
      if (st) accident(x, st, 'spilled-seed', cell);
      return ok(`${x.c.plants.list[sp].name} grows ${st ? `by ${st.name}` : 'there'} (${n} fields).`);
    }
    return fail('Introduce what? Give item, idea, artifact, animal, crop or disease.');
  }, {
    desc: 'Introduce something new', category: 'Ideas',
    params: {
      settlement: { type: 'any' }, pos: pos(), item: { type: 'enum', values: itemsEnum }, artifact: { type: 'enum', values: itemsEnum },
      idea: { type: 'enum', values: recipesEnum }, animal: { type: 'enum', values: animalIds },
      crop: { type: 'enum', values: (u) => u.content.plants.ids() }, disease: { type: 'enum', values: (u) => u.content.diseases.ids() },
      qty: { type: 'number', min: 1, max: 1e6 },
    },
  });

  r.register('settlement.withdraw', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const st = findSettlement(x, a);
    if (!st) return fail('Withdraw from whom? Name a settlement or point at one.');
    if (a.idea) {
      const k = x.rt.byId.get(String(a.idea))!;
      const members = x.ps.members.get(st.id) ?? [];
      const n = silence(x, members.slice(), k);
      return ok(n ? `${st.name} forgets ${kName(x, k)}${st.library.includes(k) ? ' — but it is written in their books' : ''}.` : `${st.name} did not know ${kName(x, k)}.`);
    }
    if (a.item) {
      const it = x.c.items.idx(String(a.item));
      if (it < 0) return fail(`There is no such thing as '${a.item}'.`);
      const had = storeHas(st, it);
      storeTake(st, it, had);
      const keep: typeof x.ps.items = [];
      for (const g of x.ps.items) {
        if (g.item === it && distM(p, g.pos, st.pos) < st.territory + 100) x.ps.iByCell.remove(g.cell, g.id);
        else keep.push(g);
      }
      x.ps.items = keep;
      x.ps.version++;
      return ok(`${x.c.items.list[it].name} vanishes from ${st.name}${had ? ` (${had.toFixed(0)} taken)` : ''}.`);
    }
    return fail('Withdraw what? Give an item or an idea.');
  }, { desc: 'Take something back', category: 'Ideas', params: { settlement: { type: 'any' }, pos: pos(), item: { type: 'enum', values: itemsEnum }, idea: { type: 'enum', values: recipesEnum } } });

  r.register('settlement.rename', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const st = findSettlement(x, a);
    if (!st) return fail('Rename which settlement?');
    const before = st.name;
    st.name = String(a.name).trim().slice(0, 60) || st.name;
    x.ps.version++;
    return ok(`${before} is now called ${st.name}.`);
  }, { desc: 'Rename a settlement', category: 'Peoples', params: { settlement: { type: 'any' }, pos: pos(), name: { type: 'string', required: true } } });

  r.register('settlement.found', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const at = a.pos as UnitVec;
    const band = x.ps.settlements.filter((st) => st.band && st.fallen < 0).sort((q, w) => distM(p, q.pos, at) - distM(p, w.pos, at) || q.id - w.id)[0];
    if (!band) return fail('There is no wandering band to settle.');
    let cell = p.cellAt(at);
    if (siteScore(x, band.species, cell, band.id) < 0) cell = landingCell(x, band.species, cell, 3);
    found(x, band, cell, null);
    return ok(`The band settles: ${band.name}.`, [settlementRef(x, band)]);
  }, { desc: 'Settle the nearest band here', category: 'Peoples', params: { pos: pos(true) } });

  r.register('settlement.raze', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const st = findSettlement(x, a);
    if (!st) return fail('Raze which settlement?');
    let n = 0;
    for (const b of x.ps.buildings.slice()) if (b.settlement === st.id && !(b.flags & BuildingFlag.ruined)) { ruin(x, st, b, 'god'); n++; }
    witness(p, st.pos, st.territory + 200, 'harm', 0.8);
    updateTerritory(x, st);
    return ok(`${st.name} is thrown down (${n} buildings in ruins).`);
  }, { desc: 'Raze a settlement', category: 'Peoples', params: { settlement: { type: 'any' }, pos: pos() } });

  // ── war and peace, splits and mergers (CONTRACT §11.1) ──
  const other = (x: PCtx, a: Record<string, unknown>): Settlement | null => findSettlement(x, { settlement: a.other });

  r.register('settlement.start-war', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const st = findSettlement(x, a), o = other(x, a);
    if (!st || !o) return fail('War between whom? Name two settlements.');
    if (st.polity === o.polity) return fail(`${st.name} and ${o.name} are one people.`);
    const r0 = relationOf(x, st.polity, o.polity);
    if (r0 && r0.war >= 0) return fail(`${st.name} and ${o.name} are already at war.`);
    ensureRelation(x, st.polity, o.polity);
    insertSorted(st.contacts, o.id); insertSorted(o.contacts, st.id);
    declareWar(x, st.polity, o.polity, 'god');
    witness(p, st.pos, st.territory + 100, 'harm', 0.3);
    return ok(`${polityName(x, polityOf(x, st))} goes to war with ${polityName(x, polityOf(x, o))}.`);
  }, { desc: 'Set two peoples at war', category: 'Peoples', params: { settlement: { type: 'any', required: true }, other: { type: 'any', required: true } } });

  r.register('settlement.make-peace', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const st = findSettlement(x, a), o = other(x, a);
    if (!st || !o) return fail('Peace between whom? Name two settlements.');
    const r0 = relationOf(x, st.polity, o.polity);
    if (!r0 || r0.war < 0) return fail(`${st.name} and ${o.name} are not at war.`);
    makePeace(x, r0, -1);
    tell(u, p, 'treaty.god', vars(x, st, -1, { polity: polityName(x, polityOf(x, st)), other: polityName(x, polityOf(x, o)) }), st, [settlementRef(x, st), settlementRef(x, o)], 1);
    witness(p, st.pos, st.territory + 100, 'wonder', 0.4);
    return ok(`${st.name} and ${o.name} lay down their arms.`);
  }, { desc: 'Make two warring peoples make peace', category: 'Peoples', params: { settlement: { type: 'any', required: true }, other: { type: 'any', required: true } } });

  r.register('settlement.split', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const st = findSettlement(x, a);
    if (!st || st.band) return fail('Split which settlement?');
    const leaving = st.households.filter((h, i) => i % 2 === 1 && h.members.length > 0 && !h.members.includes(st.leader));
    const child = splitOff(x, st, leaving, 'god');
    if (!child) return fail(`${st.name} is too small to split.`);
    child.recent.schism = u.tick;
    return ok(`Half of ${st.name} sets out to found a place of its own.`, [settlementRef(x, child)]);
  }, { desc: 'Split a settlement in two', category: 'Peoples', params: { settlement: { type: 'any' }, pos: pos() } });

  r.register('settlement.merge', ({ u, p }, a) => {
    const x = makeCtx(u, p);
    const st = findSettlement(x, a), into = other(x, a);
    if (!st || !into || st.id === into.id) return fail('Merge which settlement into which?');
    if (st.species !== into.species) return fail('They are not of one kind.');
    const A = x.A;
    let n = 0;
    for (const s of (x.ps.members.get(st.id) ?? []).slice()) {
      x.ps.removeMember(st.id, s);
      A.settlement[s] = into.id;
      A.home[s] = -1;
      x.ps.addMember(into.id, s);
      interrupt(x, s);
      n++;
    }
    for (const h of st.households) into.households.push({ id: h.id, members: h.members.slice(), home: -1 });
    st.households = [];
    for (let i = 0; i < st.store.length; i++) if (st.store[i] > 0) { storeAdd(x, into, i, st.store[i]); st.store[i] = 0; }
    for (let k = 0; k < 3; k++) { into.cohort.n[k] += st.cohort.n[k]; st.cohort.n[k] = 0; }
    fall(x, st, 'merged');
    return ok(`${st.name} joins ${into.name} (${n} people).`);
  }, { desc: 'Merge one settlement into another', category: 'Peoples', params: { settlement: { type: 'any', required: true }, other: { type: 'any', required: true } } });

  void refusalOf;
}

/** 'focus' (camera dwelling): promote cohort members nearby, demote far ones (CONTRACT §8.7) */
export function focusHook(u: Universe, p: Planet, at: UnitVec): void {
  if (!p.people || !p.people.settlements.length) return;
  focusPeople(makeCtx(u, p), at);
}
