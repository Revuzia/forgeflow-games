// GENESIS — birth, growing up, ageing and death (CONTRACT.md §8): new agents (spawned by the god, born into a
// household, promoted from a cohort), children inheriting some of their parents' knowledge by upbringing, the old-age
// hazard, and death with everything it touches: belongings to the store, kin who mourn, a household gap, a leader to
// replace, and knowledge that may die with them.

import type { PCtx } from './ctx.ts';
import type { Settlement } from './state.ts';
import { AgentFlag } from '../types.ts';
import { hash32, hashFloat } from '../core/rng.ts';
import { DEATH, DEATH_NAMES, INV, MEMK, NS, NT, ROLE, TASK, TRAIT } from './defs.ts';
import { TRAITS } from '../content.ts';
import { initNeeds, BELONG } from './needs.ts';
import { checkLoss, learn, upbringing } from './knowledge.ts';
import { spotInCell } from './world.ts';
import { tell } from './story.ts';
import { agentRef, emitAt, settlementRef, vars } from './util.ts';
import { storeAdd } from './store.ts';
import { schedule } from './sched.ts';
import { onTheRoad, release } from './missions.ts';
import { dropItem } from './people.ts';
import { leaveShelter } from './tasks.ts';

const _pt = [0, 0, 0];

/** approx. standard normal from a hash (sum of four uniforms) */
export function hgauss(a: number, b: number, c: number): number {
  return (hashFloat(a, b, c, 1) + hashFloat(a, b, c, 2) + hashFloat(a, b, c, 3) + hashFloat(a, b, c, 4) - 2) * 1.732;
}

/**
 * `salt` folded with this world's seed (the planet's, itself drawn from the world seed), for dice that would otherwise
 * be keyed by ids and ticks alone. Ids count 1, 2, 3… per kind in every world, so such dice came out the same on every
 * seed: the first band of any world had the same ages and the same people died of old age at the same ticks. Keyed by
 * this, each seed is an independent draw and the same seed replays exactly (the seed is saved with the planet).
 */
export function worldSalt(x: PCtx, salt: number): number {
  return hash32(x.p.seed, salt);
}

export interface SpawnOpts {
  ageYears: number;
  female?: boolean;
  caste?: number;
  /** unit vector where they stand (else the settlement centre) */
  pos?: ArrayLike<number>;
  mother?: number;
  father?: number;
  knowledge?: number[];
  /** 0..1 starting skill level of adults */
  skill?: number;
  /** delay before the first decision (ticks) */
  delay?: number;
}

/** create an agent in settlement st; returns its slot */
export function spawnAgent(x: PCtx, st: Settlement, o: SpawnOpts): number {
  const A = x.A;
  const id = x.u.ids.alloc('agent');
  const s = A.alloc(id);
  x.ps.buckets.ensure(A.cap);
  const sp = x.info[st.species];
  const def = sp.def;
  A.species[s] = st.species;
  A.settlement[s] = st.id;
  A.household[s] = -1;
  A.home[s] = -1;
  A.birth[s] = Math.round(x.tick - o.ageYears * x.year);
  A.name[s] = hash32(id, x.p.seed, 0x4a3e) >>> 0;
  A.mother[s] = o.mother ?? 0;
  A.father[s] = o.father ?? 0;
  A.partner[s] = 0;
  // sex / caste
  let female = o.female ?? hashFloat(id, 0x5e8) < 0.5;
  if (def.hive) {
    let caste = o.caste ?? -1;
    if (caste < 0) {
      const shares = def.hive.shares;
      let roll = hashFloat(id, 0xca57);
      caste = shares.length - 1;
      for (let k = 0; k < shares.length; k++) { roll -= shares[k]; if (roll <= 0) { caste = k; break; } }
    }
    A.caste[s] = caste;
    female = def.hive.castes[caste] === def.hive.queen || def.hive.castes[caste] === 'worker';
  }
  A.flags[s] = female ? AgentFlag.female : 0;
  // traits around the species means
  TRAITS.forEach((t, i) => {
    const v = (def.traits[t] ?? 0.5) + 0.16 * hgauss(id, i, 0x7a17);
    A.traits[s * NT + i] = Math.max(0, Math.min(1, v));
  });
  // skills: adults have practised what their people do
  const sk = o.skill ?? 0.25;
  for (let k = 0; k < NS; k++) A.skills[s * NS + k] = o.ageYears < def.maturity ? 0.02 : Math.max(0, Math.min(0.95, sk * (0.6 + 0.8 * hashFloat(id, k, 0x5c11))));
  initNeeds(x, s, 0.8);
  // belief: a newborn people does not know the god yet
  A.love[s * 4] = 0.08 * def.god.awe;
  A.fear[s * 4] = 0.04 * def.god.fear;
  A.health[s] = 1;
  // place
  const cell = o.pos ? x.p.cellAt(o.pos) : st.cell;
  const at = o.pos ? [o.pos[0], o.pos[1], o.pos[2]] : spotInCell(x.p, cell, id, 1, _pt);
  A.place(s, at[0], at[1], at[2], x.tick);
  A.cell[s] = cell;
  A.task[s] = TASK.idle;
  A.phase[s] = 1;
  A.role[s] = o.ageYears < def.maturity ? ROLE.child : ROLE.none;
  ageFlags(x, s);
  // knowledge
  for (const k of x.info[st.species].start) A.setKnows(s, k, true);
  for (const k of o.knowledge ?? []) learn(x, s, k, 'spawn');
  A.remember(s, MEMK.born, x.tick, st.id);
  x.ps.buckets.move(s, cell);
  x.ps.addMember(st.id, s);
  schedule(x, s, x.tick + (o.delay ?? 1 + (hash32(id, 0xde1a) % 20)));
  return s;
}

/** child / elder flags from age */
export function ageFlags(x: PCtx, s: number): void {
  const A = x.A;
  const def = x.info[A.species[s]].def;
  const age = (x.tick - A.birth[s]) / x.year;
  let f = A.flags[s] & ~(AgentFlag.child | AgentFlag.elder);
  if (age < def.maturity) f |= AgentFlag.child;
  else if (age >= def.elder) f |= AgentFlag.elder;
  A.flags[s] = f;
  if (age >= def.maturity && A.role[s] === ROLE.child) A.role[s] = ROLE.none;
}

/** yearly chance of dying of old age at this age (Gompertz-like past 70 % of the lifespan) */
export function ageHazard(x: PCtx, s: number): number {
  const A = x.A;
  const def = x.info[A.species[s]].def;
  let span = def.lifespan;
  if (def.hive && def.hive.castes[A.caste[s]] === def.hive.queen) span *= def.hive.queenLifespan ?? 3;
  const age = (x.tick - A.birth[s]) / x.year;
  const r = age / span;
  if (r < 0.7) return 0.002;
  return Math.min(1, 0.02 * Math.exp((r - 0.7) * 9));
}

/** a child is born to mother (slot) [and father (slot or -1)] in st */
export function birth(x: PCtx, st: Settlement, mother: number, father: number): number {
  const A = x.A;
  const at = [0, 0, 0];
  A.posAt(mother, x.tick, at);
  const def = x.info[st.species].def;
  let caste: number | undefined;
  if (def.hive) {
    // the queen lays workers, soldiers, drones; a new queen only when the hive has none (handled by the settlement)
    const shares = def.hive.shares;
    let roll = hashFloat(A.id[mother], x.tick, 0xe66);
    caste = shares.length - 1;
    const total = shares.reduce((a, b) => a + b, 0) - (shares[def.hive.castes.indexOf(def.hive.queen)] ?? 0);
    for (let k = 0; k < shares.length; k++) {
      if (def.hive.castes[k] === def.hive.queen) continue;
      roll -= shares[k] / Math.max(1e-6, total);
      if (roll <= 0) { caste = k; break; }
    }
  }
  const child = spawnAgent(x, st, { ageYears: 0, pos: at, mother: A.id[mother], father: father >= 0 ? A.id[father] : 0, caste, skill: 0, delay: 5 });
  A.household[child] = A.household[mother];
  A.home[child] = A.home[mother];
  const hh = st.households.find((h) => h.id === A.household[mother]);
  if (hh) insertSorted(hh.members, A.id[child]);
  upbringing(x, child, [mother, father]);
  A.remember(mother, MEMK.birth, x.tick, A.id[child]);
  if (father >= 0) A.remember(father, MEMK.birth, x.tick, A.id[child]);
  st.stats.births++;
  if (st.stats.births === 1 && !st.band) tell(x.u, x.p, 'birth.first', vars(x, st, child), st, [agentRef(x, child)]);
  emitAt(x, child, { t: 'birth', ref: agentRef(x, child), data: { settlement: st.id, species: x.c.species.list[st.species].id } });
  return child;
}

export function insertSorted(l: number[], v: number): void {
  let i = l.length;
  while (i > 0 && l[i - 1] > v) i--;
  if (l[i - 1] !== v) l.splice(i, 0, v);
}

/** agent s dies of `cause` (DEATH.*) */
export function die(x: PCtx, s: number, cause: number): void {
  const A = x.A;
  if (!A.alive[s]) return;
  const id = A.id[s];
  const st = x.ps.settlement(A.settlement[s]);
  const name = vars(x, st, s);
  const pos = [0, 0, 0];
  A.posAt(s, x.tick, pos);
  // far from home (a caravan, a war band) what they carried lies where they fell
  const abroad = A.mission[s] ? onTheRoad(x, s) : false;
  if (A.mission[s]) release(x, s, st);
  const keep = !!st && !st.band && !abroad;
  // belongings go to the store (or lie where they fell)
  for (let k = 0; k < INV; k++) {
    const it = A.invItem[s * INV + k];
    if (it < 0) continue;
    const q = A.invQty[s * INV + k];
    if (keep) storeAdd(x, st!, it, q);
    else if (abroad && q >= 0.5) dropItem(x, it, Math.round(q * 100) / 100, [pos[0], pos[1], pos[2]], A.cell[s], false);
    A.invItem[s * INV + k] = -1;
    A.invQty[s * INV + k] = 0;
  }
  if (A.gear[s] >= 0 && keep) storeAdd(x, st!, A.gear[s], 1);
  if (A.tool[s] >= 0 && keep) storeAdd(x, st!, A.tool[s], 1);
  // kin mourn
  const kin = new Set<number>();
  if (A.partner[s]) kin.add(A.partner[s]);
  if (A.mother[s]) kin.add(A.mother[s]);
  if (A.father[s]) kin.add(A.father[s]);
  if (st) {
    const hh = st.households.find((h) => h.id === A.household[s]);
    if (hh) {
      for (const m of hh.members) if (m !== id) kin.add(m);
      const i = hh.members.indexOf(id);
      if (i >= 0) hh.members.splice(i, 1);
    }
  }
  for (const kid of [...kin].sort((a, b) => a - b)) {
    const k = A.slotOf(kid);
    if (k < 0) continue;
    A.remember(k, MEMK.death, x.tick, id);
    A.needs[k * 12 + BELONG] = Math.max(0, A.needs[k * 12 + BELONG] - 0.35);
    if (A.partner[k] === id) A.partner[k] = 0;
  }
  // leave the world (and the shelter they lay in: its count leaked and kept an empty hut 'full' for years)
  if (A.inside[s] >= 0) leaveShelter(x, s);
  x.ps.buckets.move(s, -1);
  x.ps.wheel.cancel(id);
  if (st) x.ps.removeMember(st.id, s);
  const knew: number[] = [];
  const kw = A.kw;
  for (let w = 0; w < kw; w++) {
    const bits = A.know[s * kw + w];
    if (!bits) continue;
    for (let b = 0; b < 32; b++) if (bits & (1 << b)) knew.push(w * 32 + b);
  }
  // the knowledge test must still see this agent's slot as gone: mark dead before checking
  A.release(s);
  if (st) {
    st.stats.deaths++;
    if (cause === DEATH.starvation) st.stats.starved++;
    if (cause === DEATH.cold) st.stats.froze++;
    // the cold or heat that kills them is a reason to move (settlement.ts abandonCheck)
    if (cause === DEATH.cold || cause === DEATH.heat) { st.recent.thermalDead = (st.recent.thermalDead ?? 0) + 1; st.recent.thermalAt = x.tick; }
    if (cause === DEATH.heat) st.recent.heatDead = (st.recent.heatDead ?? 0) + 1;
    if (cause === DEATH.disease && st.recent.epidemic !== undefined) st.recent.epidemicDead = (st.recent.epidemicDead ?? 0) + 1;
    if (st.leader === id) st.leader = 0;
    for (const k of knew) checkLoss(x, st, k, s, 'death');
    // a notable death is remembered
    const role = A.role[s];
    if (role === ROLE.leader || role === ROLE.priest || A.flags[s] & AgentFlag.disciple) {
      tell(x.u, x.p, 'death.notable', { ...name, cause: DEATH_NAMES[cause] ?? 'unknown causes' }, st, [{ kind: 'agent', id, planet: x.p.id }, settlementRef(x, st)], 1);
    }
    st.recent.death = x.tick;
  }
  x.u.emit({ t: 'death', planet: x.p.id, pos: [pos[0], pos[1], pos[2]], a: cause, text: DEATH_NAMES[cause], ref: { kind: 'agent', id, planet: x.p.id }, data: { settlement: st?.id ?? -1, cause: DEATH_NAMES[cause], name: name.agent } });
}

/** skill growth from practice: fast at first, slow near mastery */
export function practise(x: PCtx, s: number, skill: number, amount: number): void {
  const A = x.A;
  const i = s * NS + skill;
  const dil = A.traits[s * NT + TRAIT.diligence];
  A.skills[i] = Math.min(1, A.skills[i] + amount * (1 - A.skills[i]) * (0.6 + dil));
  if (A.skills[i] >= 0.7) A.flags[s] |= AgentFlag.master;
}
