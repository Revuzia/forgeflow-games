// GENESIS — people leaving their world and arriving on another (CONTRACT.md §12: "crew carry knowledge, goods,
// diseases, beliefs"). An agent who boards a ship is LIFTED out of its world's agent store into a CrewMember record
// that keeps everything that makes them who they are — knowledge, skills, traits, needs, health, faith (love and fear
// per god), a sickness incubating or raging, immunities, kin, what they wear and hold, their memories, their name — and
// is SET DOWN as an agent again where the ship comes down (or back home). Ids are universe-wide, so a person keeps
// their id (and the chronicle's references to them) across worlds.
//
// Leaving is not dying: no death event, no mourning; but knowledge goes with them, so a settlement whose last knower of
// something flew away loses it (the chronicle says so).

import type { PCtx } from '../people/ctx.ts';
import type { Universe } from '../world/universe.ts';
import type { Settlement } from '../people/state.ts';
import type { CrewMember, ShipState } from './state.ts';
import { AgentFlag } from '../types.ts';
import { GODS, INV, MEM, NN, NS, NT, ROLE, TASK } from '../people/defs.ts';
import { agentName, settlementRef, vars, kName } from '../people/util.ts';
import { keptAlive, libHas, computeEra } from '../people/knowledge.ts';
import { leaveShelter } from '../people/tasks.ts';
import { schedule } from '../people/sched.ts';
import { storeAdd } from '../people/store.ts';
import { tell } from '../people/story.ts';
import { ageFlags, insertSorted } from '../people/lifecycle.ts';
import { hash32 } from '../core/rng.ts';

/** flags that belong to a moment, not a person (they do not travel) */
const TRANSIENT = AgentFlag.sleepingIndoors | AgentFlag.onFire | AgentFlag.trader | AgentFlag.soldier | AgentFlag.boat | AgentFlag.possessed | AgentFlag.disciple;

/** a CrewMember record of agent s (does not touch the world) */
export function crewRecord(x: PCtx, s: number): CrewMember {
  const A = x.A;
  const know: number[] = [];
  const kw = A.kw;
  for (let w = 0; w < kw; w++) {
    const bits = A.know[s * kw + w];
    if (!bits) continue;
    for (let b = 0; b < 32; b++) if (bits & (1 << b)) know.push(w * 32 + b);
  }
  const mem: [number, number, number][] = [];
  for (let k = 0; k < MEM; k++) {
    const i = (A.memHead[s] + k) % MEM;
    if (A.memKind[s * MEM + i]) mem.push([A.memKind[s * MEM + i], A.memTick[s * MEM + i], A.memA[s * MEM + i]]);
  }
  return {
    id: A.id[s], species: A.species[s], flags: A.flags[s] & ~TRANSIENT, caste: A.caste[s], birth: A.birth[s], name: A.name[s],
    custom: agentName(x, s),
    traits: Array.from(A.traits.subarray(s * NT, s * NT + NT)),
    skills: Array.from(A.skills.subarray(s * NS, s * NS + NS)),
    needs: Array.from(A.needs.subarray(s * NN, s * NN + NN)),
    health: A.health[s], know,
    disease: A.disease[s], infectT: A.infectT[s], sickEnd: A.sickEnd[s], immune: A.immune[s] >>> 0,
    love: Array.from(A.love.subarray(s * GODS, s * GODS + GODS)),
    fear: Array.from(A.fear.subarray(s * GODS, s * GODS + GODS)),
    mother: A.mother[s], father: A.father[s], partner: A.partner[s], gear: A.gear[s], tool: A.tool[s], role: A.role[s], mem,
  };
}

/**
 * Lift agent s out of its world aboard ship `sh`: what it carries joins the cargo, it leaves its household and its
 * shelter, and its settlement keeps only the knowledge someone else still holds. Returns the record.
 */
export function liftAgent(x: PCtx, s: number, sh: ShipState): CrewMember {
  const A = x.A;
  const rec = crewRecord(x, s);
  const st = x.ps.settlement(A.settlement[s]);
  // what they carry goes aboard
  for (let k = 0; k < INV; k++) {
    const it = A.invItem[s * INV + k];
    if (it < 0) continue;
    addCargo(sh, it, A.invQty[s * INV + k]);
    A.invItem[s * INV + k] = -1;
    A.invQty[s * INV + k] = 0;
  }
  if (st) {
    const hh = st.households.find((h) => h.id === A.household[s]);
    if (hh) { const i = hh.members.indexOf(rec.id); if (i >= 0) hh.members.splice(i, 1); }
    if (st.leader === rec.id) st.leader = 0;
  }
  if (A.inside[s] >= 0) leaveShelter(x, s);
  A.mission[s] = 0;
  x.ps.buckets.move(s, -1);
  x.ps.wheel.cancel(rec.id);
  if (st) x.ps.removeMember(st.id, s);
  A.release(s);
  return rec;
}

/** after the crew left: the knowledge only they held is gone from the settlement (told once per idea) */
export function knowledgeLeft(x: PCtx, st: Settlement, crew: CrewMember[], sh: ShipState): number {
  const ks = new Set<number>();
  for (const m of crew) for (const k of m.know) ks.add(k);
  let lost = 0;
  for (const k of [...ks].sort((a, b) => a - b)) {
    if (!libHas(st, k) || keptAlive(x, st, k, -1)) continue;
    const i = st.library.indexOf(k);
    if (i >= 0) st.library.splice(i, 1);
    const si = st.secrets.indexOf(k);
    if (si >= 0) st.secrets.splice(si, 1);
    st.stats.lost++;
    lost++;
    // a people's innate ways go unremarked; at most three lines (a whole people leaving takes everything)
    if (lost <= 3 && !x.info[st.species].start.includes(k)) {
      tell(x.u, x.p, 'space.knowledge-left', vars(x, st, -1, { knowledge: kName(x, k), ship: kindName(x, sh), name: sh.name }), st, [settlementRef(x, st)]);
    }
  }
  if (lost) st.era = computeEra(x, st);
  return lost;
}

/**
 * Set a crew member down as an agent of settlement st at `pos` (a unit vector on x.p). Knowledge recipes that this
 * world's content does not have are skipped; a name keeps its old sound (the custom-name table).
 */
export function setDown(x: PCtx, st: Settlement, m: CrewMember, pos: ArrayLike<number>, delay = 1): number {
  const A = x.A;
  const s = A.alloc(m.id);
  x.ps.buckets.ensure(A.cap);
  A.species[s] = m.species;
  A.settlement[s] = st.id;
  A.household[s] = -1;
  A.home[s] = -1;
  A.flags[s] = m.flags & ~TRANSIENT;
  A.caste[s] = m.caste;
  A.birth[s] = m.birth;
  A.name[s] = m.name >>> 0;
  if (m.custom) x.ps.names[String(m.id)] = m.custom;
  for (let k = 0; k < NT; k++) A.traits[s * NT + k] = m.traits[k] ?? 0.5;
  for (let k = 0; k < NS; k++) A.skills[s * NS + k] = m.skills[k] ?? 0.2;
  for (let k = 0; k < NN; k++) A.needs[s * NN + k] = m.needs[k] ?? 0.8;
  A.needT[s] = x.tick;
  A.health[s] = Math.max(0.05, m.health);
  for (let g = 0; g < GODS; g++) { A.love[s * GODS + g] = m.love[g] ?? 0; A.fear[s * GODS + g] = m.fear[g] ?? 0; }
  A.disease[s] = m.disease < x.c.diseases.size ? m.disease : -1;
  A.infectT[s] = m.infectT;
  A.sickEnd[s] = m.sickEnd;
  A.immune[s] = m.immune >>> 0;
  if (A.disease[s] >= 0) A.flags[s] |= AgentFlag.sick;
  A.mother[s] = m.mother;
  A.father[s] = m.father;
  A.partner[s] = m.partner;
  A.gear[s] = m.gear < x.c.items.size ? m.gear : -1;
  A.tool[s] = m.tool < x.c.items.size ? m.tool : -1;
  A.role[s] = m.role === ROLE.child ? ROLE.child : ROLE.none;
  for (const k of m.know) if (k < x.rt.n) A.setKnows(s, k, true);
  for (const [kind, tick, a] of m.mem) A.remember(s, kind, tick, a);
  const cell = x.p.cellAt(pos);
  A.place(s, pos[0], pos[1], pos[2], x.tick);
  A.cell[s] = cell;
  A.task[s] = TASK.idle;
  A.phase[s] = 1;
  ageFlags(x, s);
  x.ps.buckets.move(s, cell);
  x.ps.addMember(st.id, s);
  // the knowledge they bring is the settlement's now
  for (const k of m.know) if (k < x.rt.n && !st.library.includes(k)) insertSorted(st.library, k);
  schedule(x, s, x.tick + delay + (hash32(m.id, 0x5e7d) % 15));
  return s;
}

/** put goods aboard (merged per item) */
export function addCargo(sh: ShipState, item: number, qty: number): void {
  if (qty <= 0 || item < 0) return;
  const q = Math.round(qty * 1000) / 1000;
  for (const c of sh.cargo) if (c[0] === item) { c[1] = Math.round((c[1] + q) * 1000) / 1000; return; }
  sh.cargo.push([item, q]);
  sh.cargo.sort((a, b) => a[0] - b[0]);
}

/** take goods off the ship (up to qty) */
export function takeCargo(sh: ShipState, item: number, qty: number): number {
  for (const c of sh.cargo) {
    if (c[0] !== item) continue;
    const got = Math.min(c[1], qty);
    c[1] = Math.round((c[1] - got) * 1000) / 1000;
    if (c[1] <= 1e-6) sh.cargo = sh.cargo.filter((q) => q !== c);
    return got;
  }
  return 0;
}

/** unload every good into a settlement's store */
export function unloadCargo(x: PCtx, sh: ShipState, st: Settlement): [number, number][] {
  const out = sh.cargo.map((c) => [c[0], c[1]] as [number, number]);
  for (const [it, q] of sh.cargo) if (it < x.c.items.size) storeAdd(x, st, it, q);
  sh.cargo = [];
  return out;
}

/** a ship kind's name for the chronicle ("rocket", "generation ship") */
export function kindName(x: { c: PCtx['c'] }, sh: ShipState): string {
  const k = x.c.ships.find(sh.kind);
  return (k ? k.name : sh.kind).toLowerCase();
}

/** "a few tools and grain" — the goods in words (most valuable first) */
export function goodsWords(x: PCtx, goods: [number, number][], max = 3): string {
  const l = goods.filter(([it, q]) => it >= 0 && it < x.c.items.size && q >= 0.5)
    .sort((a, b) => b[1] * x.c.items.list[b[0]].value - a[1] * x.c.items.list[a[0]].value || a[0] - b[0]);
  if (!l.length) return 'nothing much';
  const names = l.slice(0, max).map(([it]) => x.c.items.list[it].name.toLowerCase());
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** a crew member catches disease d aboard or among strangers (exposed: infectious after the incubation) */
export function infectRecord(u: Universe, m: CrewMember, d: number): boolean {
  const dd = u.content.diseases.list[d];
  if (!dd || m.disease >= 0 || (d < 32 && m.immune & (1 << d))) return false;
  if (dd.species && !dd.species.includes(u.content.species.list[m.species]?.id ?? '')) return false;
  m.disease = d;
  m.infectT = u.tick + Math.max(1, Math.round((dd.incubation ?? 1) * 1440));
  m.sickEnd = m.infectT + Math.round(dd.duration * 1440);
  m.flags |= AgentFlag.sick;
  return true;
}
