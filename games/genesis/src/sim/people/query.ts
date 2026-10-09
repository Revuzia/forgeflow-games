// GENESIS — inspector queries about peoples (CONTRACT.md §6.2 sim.query, §16 inspector): an agent's biography (name,
// age, family, role, task, needs, knowledge, skills, memories, faith, mood), a settlement's portrait (population, era,
// library, stores, buildings, households, stories, language, relations, culture), a species, the recipe graph, one
// piece of knowledge and who holds it, and lists for pickers. Plain JSON; nothing here changes the state.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Settlement } from './state.ts';
import { ERAS, NEEDS, SKILLS, TRAITS } from '../content.ts';
import { makeCtx, type PCtx } from './ctx.ts';
import { DEATH_NAMES, INV, MEM, MEMK, NN, NS, NT, ROLE_NAMES, TASK_VERBS } from './defs.ts';
import { agentName } from './util.ts';
import { personalName } from './names.ts';
import { cohortTotal } from './cohorts.ts';
import { foodDays } from './store.ts';
import { covets, enemiesOf, polityName, polityStrength, warSummary } from './war.ts';
import { pricesOf } from './economy.ts';
import { speciesCount } from '../life/herds.ts';
import { musicOf, styleVariant } from './culture.ts';
import { leaderTitle } from './social.ts';
import { animalDef, herdPos } from '../life/herds.ts';

export const PEOPLE_QUERIES = ['agent', 'agents', 'settlement', 'settlements', 'species', 'recipes', 'knowledge', 'buildings', 'building', 'herds', 'animals', 'items', 'materials',
  'polities', 'relations', 'missions', 'prices', 'ecology', 'diseases'];

export function peopleQuery(u: Universe, p: Planet, q: string, args: Record<string, unknown>): unknown {
  const x = makeCtx(u, p);
  switch (q) {
    case 'agent': return agentBio(x, Number(args.id));
    case 'agents': return agentList(x, args);
    case 'settlement': return settlementInfo(x, Number(args.id));
    case 'settlements': return x.ps.settlements.map((st) => ({ id: st.id, name: st.name, species: x.c.species.list[st.species].id, population: (x.ps.members.get(st.id)?.length ?? 0) + Math.round(cohortTotal(st)), era: ERAS[st.era], band: st.band, fallen: st.fallen >= 0, pos: st.pos }));
    case 'species': return speciesInfoQ(x, String(args.id ?? ''));
    case 'recipes': return recipesQ(x);
    case 'knowledge': return knowledgeQ(x, String(args.id ?? ''));
    case 'buildings': return x.ps.buildings.map((b) => buildingInfo(x, b.id));
    case 'building': return buildingInfo(x, Number(args.id));
    case 'herds':
    case 'animals': return x.ps.herds.map((h) => {
      const pos = [0, 0, 0];
      herdPos(h, u.tick, pos);
      const a = animalDef(x, h.species);
      return {
        id: h.id, species: a.id, name: a.name, kind: a.kind, count: Math.round(h.count * 10) / 10, owner: h.owner,
        state: ['grazing', 'moving', 'fleeing', 'resting', 'penned'][h.state] ?? 'grazing', hunger: Math.round(h.hunger * 100) / 100, pos,
        migrating: (h.goal ?? -1) >= 0, isolatedDays: h.iso ?? 0, sick: (h.sick ?? -1) >= 0 ? x.c.diseases.list[h.sick!]?.name ?? null : null,
        invasive: (h.inv ?? -1) > u.tick,
      };
    });
    case 'polities': return x.ps.polities.filter((pl) => pl.capital >= 0).map((pl) => ({
      id: pl.id, name: polityName(x, pl), capital: pl.capital, overlord: pl.overlord,
      settlements: x.ps.settlements.filter((st) => st.polity === pl.id && st.fallen < 0 && !st.band).map((st) => ({ id: st.id, name: st.name })),
      enemies: enemiesOf(x, pl.id), strength: Math.round(polityStrength(x, pl.id) * 10) / 10,
    }));
    case 'relations': return x.ps.relations.map((r) => ({
      a: r.a, b: r.b, names: [polityName(x, x.ps.polity(r.a)), polityName(x, x.ps.polity(r.b))], opinion: r.op, atWar: r.war >= 0,
      war: r.war >= 0 ? warSummary(x, r) : null, trade: Math.round(r.trade * 10) / 10, grievance: r.grievance, treaties: r.treaties,
      covets: [covets(x, r.a, r.b), covets(x, r.b, r.a)], contact: r.contact,
    }));
    case 'missions': return x.ps.missions.map((m) => ({
      id: m.id, kind: m.kind, from: m.from, to: m.to, fromName: x.ps.settlement(m.from)?.name, toName: x.ps.settlement(m.to)?.name,
      members: m.members, phase: ['muster', 'outbound', 'at the target', 'homeward', 'done'][m.phase], sea: m.sea,
      boat: m.boat >= 0 ? x.c.items.list[m.boat].name : null, goods: m.out.map(([i, q]) => ({ item: x.c.items.list[i].name, qty: q })), note: m.note,
    }));
    case 'prices': {
      const st = x.ps.settlement(Number(args.id));
      if (!st) return null;
      const pr = pricesOf(x, st);
      const out: Record<string, number> = {};
      pr.forEach((v, i) => { if ((st.store[i] ?? 0) > 0.05 || v > x.c.items.list[i].value * 1.5) out[x.c.items.list[i].id] = Math.round(v * 100) / 100; });
      return out;
    }
    case 'ecology': return ecologyQ(x);
    case 'diseases': return x.c.diseases.list.map((d, i) => ({
      id: d.id, name: d.name, transmission: d.transmission,
      settlements: x.ps.settlements.filter((st) => st.recent.epidemic === i + 1).map((st) => ({ id: st.id, name: st.name, dead: Math.round(st.recent.epidemicDead ?? 0) })),
      sick: (() => { let n = 0; for (let s = 0; s < x.A.hi; s++) if (x.A.alive[s] && x.A.disease[s] === i) n++; return n; })(),
    }));
    case 'items': return x.ps.items.map((g) => ({ id: g.id, item: x.c.items.list[g.item].id, name: x.c.items.list[g.item].name, qty: g.qty, pos: g.pos, artifact: g.artifact }));
    case 'materials': return x.c.materials.list;
    default: return null;
  }
}

function settlementName(x: PCtx, id: number): string | null {
  const st = x.ps.settlement(id);
  return st ? st.name : null;
}

const MEM_TEXT: Record<number, (x: PCtx, a: number) => string> = {
  [MEMK.born]: (x, a) => `was born${settlementName(x, a) ? ` in ${settlementName(x, a)}` : ''}`,
  [MEMK.learned]: (x, a) => `learned ${x.rt.list[a]?.name.toLowerCase() ?? 'something'}`,
  [MEMK.taught]: (x, a) => `was taught ${x.rt.list[a]?.name.toLowerCase() ?? 'something'}`,
  [MEMK.discovered]: (x, a) => `discovered ${x.rt.list[a]?.name.toLowerCase() ?? 'something'}`,
  [MEMK.death]: (x, a) => `lost ${nameOfId(x, a)}`,
  [MEMK.birth]: (x, a) => `welcomed a child, ${nameOfId(x, a)}`,
  [MEMK.partner]: (x, a) => `took ${nameOfId(x, a)} as partner`,
  [MEMK.miracle]: (x, a) => `received a gift from the sky${x.rt.list[a] ? ` (${x.rt.list[a].name.toLowerCase()})` : ''}`,
  [MEMK.fear]: () => 'was terrified by the god',
  [MEMK.starved]: () => 'went hungry',
  [MEMK.froze]: () => 'nearly froze',
  [MEMK.injured]: (x, a) => `was wounded by ${a >= 0 ? animalDef(x, a).name.toLowerCase() : 'something'}`,
  [MEMK.refused]: (x, a) => `refused the god's teaching of ${x.rt.list[a]?.name.toLowerCase() ?? 'something'}`,
  [MEMK.gift]: () => 'received a gift',
  [MEMK.founded]: (x, a) => `helped found ${settlementName(x, a) ?? 'a settlement'}`,
  [MEMK.built]: () => 'raised a building',
  [MEMK.sick]: (x, a) => `fell sick with ${x.c.diseases.list[a]?.name.toLowerCase() ?? 'a fever'}`,
  [MEMK.healed]: () => 'recovered',
  [MEMK.burned]: () => 'escaped a fire',
  [MEMK.moved]: () => 'was moved by the hand of the god',
  [MEMK.silenced]: (x, a) => `forgot ${x.rt.list[a]?.name.toLowerCase() ?? 'something'}`,
  [MEMK.disciple]: () => 'became a disciple of the god',
  [MEMK.lightning]: () => 'was struck by lightning',
  [MEMK.hunted]: (x, a) => `hunted ${a >= 0 ? animalDef(x, a).name.toLowerCase() : 'game'}`,
  [MEMK.migrated]: () => 'set out with the band',
  [MEMK.mourned]: () => 'mourned',
  [MEMK.forgot]: (x, a) => `forgot ${x.rt.list[a]?.name.toLowerCase() ?? 'something'}`,
};

function nameOfId(x: PCtx, id: number): string {
  const s = x.A.slotOf(id);
  if (s >= 0) return agentName(x, s);
  const custom = x.ps.names[String(id)];
  return custom ?? 'someone';
}

function agentBio(x: PCtx, id: number): unknown {
  const A = x.A;
  const s = A.slotOf(id);
  if (s < 0) return null;
  const st = x.ps.settlement(A.settlement[s]);
  const sp = x.c.species.list[A.species[s]];
  const age = (x.tick - A.birth[s]) / x.year;
  const knowledge: string[] = [];
  for (let k = 0; k < x.rt.n; k++) if (A.knows(s, k)) knowledge.push(x.rt.list[k].name);
  const needs: Record<string, number> = {};
  NEEDS.forEach((n, i) => { if ((x.info[A.species[s]].needW[i] ?? 0) > 0) needs[n] = round2(A.needs[s * NN + i]); });
  const skills: Record<string, number> = {};
  SKILLS.forEach((n, i) => { const v = A.skills[s * NS + i]; if (v >= 0.05) skills[n] = round2(v); });
  const traits: Record<string, number> = {};
  TRAITS.forEach((n, i) => { traits[n] = round2(A.traits[s * NT + i]); });
  const memories: { tick: number; text: string }[] = [];
  for (let k = 0; k < MEM; k++) {
    const i = (A.memHead[s] + k) % MEM;
    const kind = A.memKind[s * MEM + i];
    if (!kind) continue;
    const f = MEM_TEXT[kind];
    memories.push({ tick: A.memTick[s * MEM + i], text: f ? f(x, A.memA[s * MEM + i]) : 'remembers something' });
  }
  const children: string[] = [];
  for (const m of x.ps.members.get(A.settlement[s]) ?? []) if (A.mother[m] === id || A.father[m] === id) children.push(agentName(x, m));
  const inventory: { item: string; qty: number }[] = [];
  for (let k = 0; k < INV; k++) { const it = A.invItem[s * INV + k]; if (it >= 0) inventory.push({ item: x.c.items.list[it].name, qty: round2(A.invQty[s * INV + k]) }); }
  const pos = [0, 0, 0];
  A.posAt(s, x.tick, pos);
  const hive = sp.hive ? sp.hive.castes[A.caste[s]] : null;
  return {
    id, name: agentName(x, s), species: sp.id, speciesName: sp.name,
    settlement: st ? { id: st.id, name: st.name, band: st.band } : null,
    age: Math.round(age * 10) / 10, sex: A.flags[s] & 4 ? 'female' : 'male', caste: hive, role: ROLE_NAMES[A.role[s]] ?? 'none',
    doing: TASK_VERBS[A.task[s]] ?? 'resting',
    family: {
      mother: A.mother[s] ? nameOfId(x, A.mother[s]) : null, father: A.father[s] ? nameOfId(x, A.father[s]) : null,
      partner: A.partner[s] ? nameOfId(x, A.partner[s]) : null, children,
    },
    health: round2(A.health[s]), mood: round2(A.mood[s]), needs, skills, traits, knowledge,
    master: Object.entries(skills).filter(([, v]) => v >= 0.7).map(([k]) => k),
    memories,
    faith: { love: round2(A.love[s * 4]), fear: round2(A.fear[s * 4]) },
    sick: A.disease[s] >= 0 ? x.c.diseases.list[A.disease[s]]?.name ?? 'sick' : null,
    inventory, wearing: A.gear[s] >= 0 ? x.c.items.list[A.gear[s]].name : null, tool: A.tool[s] >= 0 ? x.c.items.list[A.tool[s]].name : null,
    flags: A.flags[s], pos, cell: A.cell[s],
  };
}

function agentList(x: PCtx, args: Record<string, unknown>): unknown {
  const A = x.A;
  const out: { id: number; name: string; species: string; settlement: number; role: string }[] = [];
  const sid = typeof args.settlement === 'number' ? args.settlement : null;
  const limit = typeof args.limit === 'number' ? args.limit : 500;
  for (let s = 0; s < A.hi && out.length < limit; s++) {
    if (!A.alive[s]) continue;
    if (sid !== null && A.settlement[s] !== sid) continue;
    out.push({ id: A.id[s], name: agentName(x, s), species: x.c.species.list[A.species[s]].id, settlement: A.settlement[s], role: ROLE_NAMES[A.role[s]] });
  }
  return out;
}

function settlementInfo(x: PCtx, id: number): unknown {
  const st = x.ps.settlement(id);
  if (!st) return null;
  const A = x.A;
  const members = x.ps.members.get(st.id) ?? [];
  const sp = x.c.species.list[st.species];
  const stores: Record<string, number> = {};
  st.store.forEach((q, i) => { if (q >= 0.05) stores[x.c.items.list[i].name] = round2(q); });
  const roles: Record<string, number> = {};
  for (const m of members) { const r = ROLE_NAMES[A.role[m]]; roles[r] = (roles[r] ?? 0) + 1; }
  const cal = x.p.calendar(st.founded >= 0 ? st.founded : x.tick);
  return {
    id: st.id, name: st.name, species: sp.id, speciesName: sp.name, band: st.band, fallen: st.fallen >= 0,
    founded: st.founded >= 0 ? { tick: st.founded, year: cal.year, day: cal.day } : null, feature: st.feature,
    population: members.length + Math.round(cohortTotal(st)), agents: members.length, cohort: { children: st.cohort.n[0], adults: st.cohort.n[1], elders: st.cohort.n[2] },
    era: ERAS[st.era], foodDays: round2(foodDays(x, st)),
    library: st.library.map((k) => x.rt.list[k].name), written: st.written.map((k) => x.rt.list[k].name),
    secrets: st.secrets.map((k) => x.rt.list[k].name), stores,
    buildings: x.ps.buildings.filter((b) => b.settlement === st.id).map((b) => ({ id: b.id, type: x.c.buildings.list[b.type].name, material: x.c.materials.list[b.material]?.name, progress: round2(b.progress), damage: round2(b.damage), books: b.books.length, lit: b.fuel > 0 })),
    households: st.households.map((h) => ({ id: h.id, home: h.home, members: h.members.map((m) => nameOfId(x, m)) })),
    stories: st.culture.stories.map((t) => t.text),
    language: { id: st.language, sample: [0, 1, 2, 3].map((k) => personalName(x.c, st.species, st.langSeed, st.id * 31 + k)) },
    relations: x.ps.relations.filter((r) => r.a === st.polity || r.b === st.polity).map((r) => {
      const other = r.a === st.polity ? r.b : r.a;
      const k = r.a === st.polity ? 0 : 1;
      return { polity: other, name: polityName(x, x.ps.polity(other)), opinion: r.op[k], theirs: r.op[1 - k], atWar: r.war >= 0, treaties: r.treaties, trade: Math.round(r.trade * 10) / 10 };
    }),
    polity: { id: st.polity, name: polityName(x, x.ps.polity(st.polity)), overlord: x.ps.polity(st.polity)?.overlord ?? -1 },
    leader: (() => { const s = A.slotOf(st.leader); return s >= 0 ? { id: st.leader, name: agentName(x, s), title: leaderTitle(st), since: st.leaderSince } : null; })(),
    factions: st.factions.map((f) => ({ kind: f.kind, share: f.share, voice: f.voice ? nameOfId(x, f.voice) : null })),
    contacts: st.contacts.map((id) => ({ id, name: x.ps.settlement(id)?.name ?? '?' })),
    culture: {
      alignment: st.culture.alignment, conservatism: st.culture.conservatism, taboos: st.culture.taboos.map((k) => x.rt.list[k]?.name ?? '?'), sacred: st.culture.sacred,
      style: styleVariant(st), music: musicOf(st, false), mode: st.culture.mode,
    },
    belief: st.belief, fear: st.fearGod, worship: st.worship, worshipBy: st.worshipBy, god: st.god, faith: st.faith, disbelief: st.recent.disbelief ?? 0,
    age: st.age.kind, traded: Math.round((st.traded ?? 0) * 10) / 10, boatUse: st.boatUse, besieged: st.besieged >= 0,
    epidemic: st.recent.epidemic ? x.c.diseases.list[st.recent.epidemic - 1]?.name ?? null : null,
    roles, fields: st.fields.length, crop: st.crop >= 0 ? x.c.plants.list[st.crop].name : null,
    jobs: st.jobs.map((j) => x.rt.list[j.k].name), wants: st.wants.map((i) => x.c.items.list[i].name),
    stats: st.stats, territory: st.territory, parent: st.parent, pos: st.pos,
  };
}

function speciesInfoQ(x: PCtx, id: string): unknown {
  const i = x.c.species.idx(id);
  if (i < 0) return x.c.species.list.map((s, k) => ({ id: s.id, name: s.name, population: popOf(x, k) }));
  const def = x.c.species.list[i];
  return {
    ...def, population: popOf(x, i),
    settlements: x.ps.settlements.filter((st) => st.species === i && st.fallen < 0).map((st) => ({ id: st.id, name: st.name })),
    deathCauses: DEATH_NAMES,
  };
}

function popOf(x: PCtx, sp: number): number {
  let n = 0;
  for (let s = 0; s < x.A.hi; s++) if (x.A.alive[s] && x.A.species[s] === sp) n++;
  for (const st of x.ps.settlements) if (st.species === sp && st.fallen < 0) n += Math.round(cohortTotal(st));
  return n;
}

function recipesQ(x: PCtx): unknown {
  return x.rt.list.map((r) => {
    const def = x.c.recipes.list[r.idx];
    let known = 0;
    for (const st of x.ps.settlements) if (st.fallen < 0 && st.library.includes(r.idx)) known++;
    return {
      id: r.id, name: r.name, kind: r.kind, era: ERAS[r.era], inputs: def.inputs, tools: def.tools, place: def.place,
      knowledge: def.knowledge, outputs: def.outputs, time: def.time, skill: def.skill, discover: def.discover, teach: def.teach,
      settlementsKnowing: known,
    };
  });
}

function knowledgeQ(x: PCtx, id: string): unknown {
  const k = x.rt.byId.get(id);
  if (k === undefined) return null;
  const A = x.A;
  let knowers = 0;
  for (let s = 0; s < A.hi; s++) if (A.alive[s] && A.knows(s, k)) knowers++;
  const settlements = x.ps.settlements.filter((st: Settlement) => st.library.includes(k)).map((st) => ({ id: st.id, name: st.name, written: st.written.includes(k), secret: st.secrets.includes(k) }));
  return { id, name: x.rt.list[k].name, era: ERAS[x.rt.list[k].era], knowers, settlements, recipe: x.c.recipes.list[k] };
}

function buildingInfo(x: PCtx, id: number): unknown {
  const b = x.ps.building(id);
  if (!b) return null;
  const def = x.c.buildings.list[b.type];
  return {
    id: b.id, type: def.id, name: def.name, function: def.function, material: x.c.materials.list[b.material]?.id, progress: b.progress,
    damage: b.damage, settlement: b.settlement, settlementName: settlementName(x, b.settlement), books: b.books.map((k) => x.rt.list[k]?.name),
    lit: b.fuel > 0, occupants: b.occupants, pos: b.pos, flags: b.flags,
  };
}

function ecologyQ(x: PCtx): unknown {
  const n = speciesCount(x);
  const out: unknown[] = [];
  for (let i = 0; i < n; i++) {
    const key = String(i);
    const seen = x.ps.eco.seen[key];
    let count = 0, herds = 0;
    for (const h of x.ps.herds) if (h.species === i) { count += h.count; herds++; }
    if (seen === undefined && !herds) continue;
    const a = animalDef(x, i);
    const derived = i >= x.c.animals.size ? x.ps.species[i - x.c.animals.size] : null;
    out.push({
      id: a.id, name: a.name, kind: a.kind, herds, count: Math.round(count * 10) / 10, peak: x.ps.eco.peak[key] ?? 0,
      extinct: x.ps.eco.extinct[key] !== undefined, since: seen ?? null,
      bornHere: derived ? { tick: derived.born, from: animalDef(x, derived.parent).name } : null,
    });
  }
  return { immigration: x.ps.eco.immigration, species: out, blightCells: x.ps.blight.length };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
