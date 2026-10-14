// GENESIS — the people and their god, wired in (LIVING.md §3): the door of the RELATIONSHIP lane.
//
//   commands     prayer.answer, prophet.call / abandon / foretell, god.omen, place.sacred, settlement.sacred; and a
//                `wrath` (and `warning`) on every cast whose harm wrath scales (god/wrath.ts WRATHFUL)
//   acts         every god command is ONE act (god/regard.ts): what its witnesses make of it, its budget, its record;
//                after it, what it was — food, rain, healing, warmth, protection, rebuilding, harm, a sign — answers
//                prayers (god/prayers.ts), fulfils prophecies and confirms, discredits or defends prophets
//                (god/prophets.ts), is read as an omen (god/omens.ts), culls or spares a sacred animal (god/sacred.ts)
//   decisions    (people/hooks.ts godHooks.relation) prayer from faith and hardship, shelter from storms, evacuations,
//                evening worship at dusk, pilgrimages, a prophet's preaching; obedience of the Called by their loyalty
//                (god/disciples.ts); worship by faith, fear and the place (godHooks.worship); temples where faith holds
//   hour / day   prayers raised and lapsed, hardship, evacuations lifted, prophecies due, preaching, pilgrims, holy
//                places harmed, natural omens / persecution, carrying the faith, shrines, pilgrimage seasons, revolt
//                against the Called, migration away from a feared god, offerings and sacrifice, conversion to rivals
//   views        SettlementView.regard / prayers / prophet / sacred, MoverBlock.flags2 (prophet, sheltering, pilgrim,
//                called), Snapshot.regard / wrath; queries regard, prayers, prophets, sacred, omens, sigils

import type { CommandRegistry, Args, ParamSchema } from './commands.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Settlement } from '../people/state.ts';
import type { PCtx } from '../people/ctx.ts';
import type { TaskSpec } from '../people/tasks.ts';
import type { Command, CommandResult, PlanetSnap } from '../types.ts';
import type { ActInfo } from './prayers.ts';
import { AgentFlag, AgentFlag2 } from '../types.ts';
import { hashFloat } from '../core/rng.ts';
import { makeCtx } from '../people/ctx.ts';
import { DEATH, GODS, NT, ROLE, TASK, TRAIT } from '../people/defs.ts';
import { FAITH, NEED_N } from '../people/needs.ts';
import { godHooks } from '../people/hooks.ts';
import { die } from '../people/lifecycle.ts';
import { interrupt } from '../people/people.ts';
import { storeTake, foodDays } from '../people/store.ts';
import { cohortTotal } from '../people/cohorts.ts';
import { tell } from '../people/story.ts';
import { agentName, settlementRef, vars } from '../people/util.ts';
import { distM, spotInCell, sunElevation } from '../people/world.ts';
import { stormSeverity, planShelter, planEvacuate, OUTDOOR, stormBreaks } from '../people/shelter.ts';
import { strikeHooks } from '../fields/weather.ts';
import { actor, fail, ok } from './util.ts';
import { bindUniverse, beginAct, currentAct, endAct, freshen, meansNow, moveSettlement, noteDeath, regardOf, relOf, relStat, srel, type ActCtx } from './regard.ts';
import { castWarning, currentWrath, lethality, popWrath, pushWrath, reach, ruination, wrathLaw, wrathOf, WRATHFUL } from './wrath.ts';
import { answerPrayers, canonicalAnswer, hardshipOf, prayersHourly, prayersOf } from './prayers.ts';
import { exile, prophetOf, prophetOfSettlement, prophetTask, prophetsAct, prophetsDaily, prophetsHourly, prophetsQuery, registerProphetCommands } from './prophets.ts';
import { naturalOmens, omensOfCommand, omensQuery, omensTick, registerOmenCommands } from './omens.ts';
import { pilgrimageDaily, pilgrimTask, registerSacredCommands, sacredAnimalAct, sacredAnimalOf, sacredHourly, sacredQuery } from './sacred.ts';
import { evacuationOf, evacuationsHourly } from './precursors.ts';
import { SIGILS } from './miracles.ts';
import { animalDef } from '../life/herds.ts';

/** commands that are plumbing, not god acts (no act, no record) */
const PLUMBING = new Set(['focus', 'hand.move', 'hand.pose', 'freeform', 'set', 'meta.restraint', 'meta.save', 'meta.load', 'time.speed', 'time.step', 'time.rewind', 'time.edit-past', 'time.scale', 'god.seen']);

const installedOn: WeakSet<CommandRegistry> = new WeakSet();

// ───────────────────────────── commands and hooks ─────────────────────────────

export function registerRelationship(r: CommandRegistry): void {
  registerProphetCommands(r);
  registerOmenCommands(r);
  registerSacredCommands(r);
  r.register('prayer.answer', ({ u, p, cmd }, a) => {
    if (!p.people) return fail('There is nobody here praying.');
    const st = typeof a.settlement === 'number' ? p.people.settlement(a.settlement) : undefined;
    if (!st || st.fallen >= 0) return fail('Answer whom? Name a settlement ("answer the prayers of Aru").');
    const rel = srel(u, p.id, st.id);
    if (!rel.prayers.length) return fail(`${st.name} is not praying for anything now.`);
    const pr = typeof a.prayer === 'number' ? rel.prayers.find((q) => q.id === a.prayer) : rel.prayers.slice().sort((q, w) => w.urgency - q.urgency || q.id - w.id)[0];
    if (!pr) return fail(`${st.name} has no such prayer open.`);
    const res = r.dispatch(u, { ...canonicalAnswer(p, st, pr.kind), god: actor(cmd) });
    if (!res.ok) return fail(`The answer could not be given: ${res.msg}`);
    return { ok: true, msg: `You answer ${st.name}'s prayer for ${pr.kind}: ${res.msg}`, created: res.created };
  }, { desc: 'Answer a settlement\'s prayer (its most pressing, or the one named)', category: 'Signs', params: { settlement: { type: 'int', required: true, min: 0 }, prayer: { type: 'int', min: 1 } } });
  // wrath on the casts it scales: `wrath` 0..1 (size words), `warning` (ticks, a disaster's warning phase; 0 none)
  for (const k of WRATHFUL) {
    const h = r.handlerOf(k);
    const sc = r.schema(k);
    if (!h || !sc || 'wrath' in sc.params) continue;
    const params: Record<string, ParamSchema> = { ...sc.params, wrath: { type: 'number', min: 0, max: 1, desc: 'how hard it falls: 0 gentle .. 0.3 survivable (the law) .. 1 total' } };
    if (k === 'disaster.spawn') params.warning = { type: 'number', min: 0, max: 10000, desc: 'ticks of warning before it strikes (0 none)' };
    r.register(k, (ctx, a) => {
      pushWrath(wrathOf(ctx.u, a));
      castWarning.push(typeof a.warning === 'number' ? a.warning : undefined);
      try { return h(ctx, a); } finally { castWarning.pop(); popWrath(); }
    }, { ...sc, params });
  }
  if (installedOn.has(r)) return;
  installedOn.add(r);
  // every god command is one act
  const acts: (ActCtx | null)[] = [];
  r.before.push((u: Universe, cmd: Command) => {
    acts.push(PLUMBING.has(cmd.k) ? null : beginAct(u, { key: `c${u.tick}:${relOf(u).next++}`, god: actor(cmd), what: cmd.k }));
    return null;
  });
  r.after.push((u: Universe, cmd: Command, p: Planet, res: CommandResult, a: Args) => {
    const ctx = acts.pop() ?? null;
    if (!ctx) return;
    try { if (res.ok) afterAct(u, p, cmd, res, a, ctx); } finally { endAct(u, ctx); }
  });
  godHooks.relation = relDecide;
  godHooks.worship = worshipYield;
  godHooks.templeWanted = templeWanted;
  godHooks.harmScale = () => { const w = currentWrath(); return w === null ? null : { L: lethality(w), R: reach(w), B: ruination(w) }; };
  godHooks.noteDeath = noteDeath;
  if (!strikeHooks.includes(lightningFear)) strikeHooks.push(lightningFear);
}

/** what the act was, and what it does to prayers, prophecies, omens and sacred animals */
function afterAct(u: Universe, p: Planet, cmd: Command, res: CommandResult, a: Args, ctx: ActCtx): void {
  const list = actsOf(u, p, cmd, a, ctx);
  list.push(...omensOfCommand(u, p, cmd, res, a, ctx.killed));
  if (!list.length) return;
  answerPrayers(u, p, list);
  prophetsAct(u, p, list);
}

const RAINY = new Set(['rain', 'drizzle', 'storm', 'thunderstorm', 'monsoon', 'snow']);

/** the act's kinds: what it gives the people, or does to them */
function actsOf(u: Universe, p: Planet, cmd: Command, a: Args, ctx: ActCtx): ActInfo[] {
  const g = actor(cmd);
  const ps = p.people;
  const sid = typeof a.settlement === 'number' ? a.settlement : -1;
  const stPos = sid >= 0 ? ps?.settlement(sid)?.pos : undefined;
  const pos = (a.pos as [number, number, number] | null | undefined) ?? (stPos ? [stPos[0], stPos[1], stPos[2]] as [number, number, number] : null);
  const R = typeof a.radius === 'number' ? a.radius : 300;
  const out: ActInfo[] = [];
  const add = (kind: string, radius = R, at: [number, number, number] | null = pos, s = sid): void => { out.push({ kind, planet: p.id, pos: at, radius, god: g, settlement: s }); };
  switch (cmd.k) {
    case 'miracle.food': case 'miracle.fertility': add('food', R + 200); break;
    case 'miracle.water': case 'water.rain': add('rain', R + 300); break;
    case 'miracle.storm': add('rain', R); break;
    case 'weather.paint': if (RAINY.has(String(a.kind))) add('rain', R); else if (a.kind === 'clear') { add('warmth', R); add('protection', R); } break;
    case 'weather.global': if (RAINY.has(String(a.kind))) add('rain', Infinity, null); else if (a.kind === 'clear') add('warmth', Infinity, null); break;
    case 'miracle.heal': case 'life.cure': case 'life.heal': case 'agent.heal': add('healing', R + 200); break;
    case 'miracle.fire': add('warmth', R + 200); break;
    case 'miracle.calm': case 'weather.clear': add('warmth', R + 200); add('protection', R + 200); break;
    case 'miracle.shield': add('protection', typeof a.radius === 'number' ? a.radius : 220); break;
    case 'disaster.cancel': case 'disaster.move': case 'disaster.freeze': add('protection', 3000); add('healing', 3000); add('rain', 3000); add('warmth', 3000); break;
    case 'disaster.scale': if (Number(a.factor ?? 2) < 1) add('protection', 3000); break;
    case 'settlement.make-peace': add('protection', 0, null, sid); break;
    case 'miracle.wood': case 'settlement.build': add('rebuilding', R); break;
    case 'settlement.gift': {
      const items = a.items as Record<string, unknown> | undefined;
      for (const key of Object.keys(items ?? {})) {
        const it = u.content.items.find(key);
        if (!it) continue;
        if (it.tags.includes('food')) add('food', 0, null, sid);
        if (it.tags.includes('wood') || it.tags.includes('stone') || it.id === 'wood' || it.id === 'stone') add('rebuilding', 0, null, sid);
        if (it.tags.includes('fuel') || it.tags.includes('clothing')) add('warmth', 0, null, sid);
      }
      break;
    }
    case 'life.spawn-animal': case 'life.breed': {
      const x = ps ? makeCtx(u, p) : null;
      const spi = x && typeof a.species === 'string' ? x.c.animals.idx(a.species) : -1;
      const def = x && spi >= 0 ? animalDef(x, spi) : null;
      if (def && def.kind !== 'predator') add('food', 1500);
      if (x && spi >= 0 && pos) sacredAnimalAct(x, spi, pos, R, false);
      break;
    }
    case 'life.cull': {
      const x = ps ? makeCtx(u, p) : null;
      const spi = x && typeof a.species === 'string' ? x.c.animals.idx(a.species) : -1;
      if (x && spi >= 0 && pos) sacredAnimalAct(x, spi, pos, R, true);
      break;
    }
  }
  // harm: whatever its witnesses read as harm, or that killed (and a blow that falls on attackers protects the attacked)
  let harm = ctx.killed;
  for (const v of ctx.seen.values()) if (v.kind === 'harm') harm = true;
  if (harm) {
    add('harm', Math.max(R, 200));
    if (ps && pos) for (const m of ps.missions) {
      if ((m.kind !== 'war' && m.kind !== 'raid') || m.phase < 1 || m.phase > 2) continue;
      const hit = m.members.some((id) => { const s = ps.agents.slotOf(id); if (s < 0) return false; ps.agents.posAt(s, u.tick, _p); return distM(p, _p, pos) <= Math.max(R, 200); });
      if (hit) add('protection', 0, null, m.to);
    }
  }
  return out;
}

const _p = [0, 0, 0];

// ───────────────────────────── the people's decisions ─────────────────────────────

/** godHooks.relation: the god's part of a settled person's decision (decide.ts) */
function relDecide(x: PCtx, s: number, st: Settlement, U: Float64Array, C: Readonly<Record<string, number>>, night: boolean): TaskSpec | null {
  const u = x.u, A = x.A;
  const r = u.god.rel?.st[`${x.p.id}:${st.id}`];
  freshen(A, s, r?.means);
  const pressing = Math.max(U[C.drink], U[C.eat], U[C.warm], U[C.exhausted]);
  // an evacuation in force: out past the danger (that is the flight from it too), and wait there — and sleep there:
  // fleeing ash or going home to bed brought them back under the eruption (8 of 30 dead in a volcano's second day)
  const e = evacuationOf(u, x.p.id, st.id);
  if (e && (pressing < 3 || U[C.flee] > 0)) {
    const t = planEvacuate(x, s, st, e, U[C.sleep] >= 1.2 || U[C.exhausted] > 0);
    if (t) return t;
  }
  if (U[C.flee] > 0) return null;
  // a storm: outdoor work loses its pull, a roof gains it
  A.posAt(s, x.tick, _p);
  const sev = stormSeverity(x, _p, A.cell[s]);
  if (sev > 0.15) {
    for (const k of OUTDOOR) if (C[k] !== undefined) U[C[k]] *= 1 - sev;
    const us = sev * 2.4;
    let best = 0;
    for (let i = 0; i < U.length; i++) if (U[i] > best) best = U[i];
    if (us > best && !(night && U[C.sleep] >= best)) return planShelter(x, s, st, sev);
  }
  if (st.band) return null;
  // prayer: from faith, and from fear in hardship (LIVING §3.2)
  const i = s * GODS;
  const faith = A.faith[i], fear = A.fear[i];
  const piety = A.traits[s * NT + TRAIT.piety];
  const h = hardshipOf(u, x.p.id, st.id);
  const need = 1 - A.needs[s * NEED_N + FAITH];
  const day = night ? 0.25 : 1;
  // (the pull of hardship is sated by praying — a person who has just prayed has their faith need met — and never
  // outweighs a meal: at full strength the whole town prayed 34–48 % of the days after a meteor and did not rebuild)
  U[C.pray] = Math.min(PRAY_CAP, need * 0.3 * piety * (0.3 + faith) * day + PRAY_K * (faith * (0.15 + 0.6 * h) + fear * 0.3 * h) * (0.5 + 0.5 * need));
  // a prophet's own work: preaching by day, at home or in the town they carry the faith to
  if (u.god.rel?.prophets.length) {
    const t = prophetTask(x, s, st, night, pressing);
    if (t) return t;
  }
  // evening worship at dusk: attendance ≈ 0.5 faith + 0.3 loyalty
  if (pressing < 1 && A.task[s] !== TASK.worship && !(A.flags[s] & AgentFlag.child && hashFloat(A.id[s], 0xc1d) < 0.5)) {
    const el = sunElevation(u, x.p, x.tick, st.pos);
    if (el > -0.07 && el < 0.03 && sunElevation(u, x.p, x.tick - 20, st.pos) > el) {
      const attend = Math.min(1, 0.5 * faith + 0.3 * A.loyalty[i] + 0.15 * piety * faith);
      const dayIdx = Math.floor(x.tick / x.day);
      if (hashFloat(A.id[s], dayIdx, 0xe7e5) < attend) {
        const place = worshipPlace(x, st);
        return { kind: TASK.worship, goal: spotInCell(x.p, place.cell, A.id[s], 0xe7e6, [0, 0, 0]), goalCell: place.cell, work: 30 + Math.round(30 * hashFloat(A.id[s], dayIdx, 0xe7e7)), target: place.id };
      }
    }
  }
  // a pilgrimage season
  return pilgrimTask(x, s, st, night, pressing);
}

/**
 * A feast in the god's name (LIVING §3.2): a festival of LAND's calendar (people/gatherings.ts) under way in a town whose
 * trust in the god is 0.5 or more is kept for the god — faith and loyalty +0.03, worship from all who came, and the
 * chronicle says so.
 */
function godsFeast(x: PCtx, st: Settlement): void {
  const gs = st.land?.gatherings;
  if (!gs || !gs.length) return;
  const u = x.u;
  for (const g of gs) {
    if (g.kind === 'wedding' || g.kind === 'funeral' || g.from > x.tick || g.until <= x.tick) continue;
    const r = srel(u, x.p.id, st.id);
    if (r.since.feast === g.from) continue;
    if (meansNow(x, st).trust < 0.5) continue;
    r.since.feast = g.from;
    moveSettlement(x, st, { faith: 0.03, loyalty: 0.03 });
    const w = Math.round(0.5 * Math.max(1, g.came.length) * 100) / 100;
    st.worshipBy[0] = Math.round((st.worshipBy[0] + w) * 100) / 100;
    st.worship = st.worshipBy[0];
    x.ps.worship[0] = Math.round((x.ps.worship[0] + w) * 100) / 100;
    relStat(u, 'worship.feast', w);
    relStat(u, 'feasts');
    tell(u, x.p, 'festival.god', vars(x, st), st, [settlementRef(x, st)], 1);
  }
}

/** the weight of hardship and faith in the prayer utility (calibrated: LIVING §3.8 prayer targets) */
export const PRAY_K = 3;
/** the most prayer can weigh (work is 0.55–0.9, a hungry body's meal more) */
export const PRAY_CAP = 0.65;

/** where evening worship is held: the temple, else the shrine, else a lit hearth, else the centre */
function worshipPlace(x: PCtx, st: Settlement): { id: number; cell: number } {
  let best = -1, bv = -1, cell = st.cell;
  for (const b of x.ps.of(st.id)) {
    if (b.progress < 1 || b.flags & 2) continue;
    const id = x.c.buildings.list[b.type].id;
    const v = id === 'temple' ? 3 : id === 'shrine' ? 2 : id === 'hearth' ? (b.fuel > 0 ? 1.5 : 1) : -1;
    if (v > bv) { bv = v; best = b.id; cell = b.cell; }
  }
  return { id: best, cell };
}

/** the place's weight for belief income: hearth 0.5, shrine 1, temple 2, the open ground 0.3 */
function placeFactor(x: PCtx, bid: number): number {
  const b = bid >= 0 ? x.ps.building(bid) : undefined;
  if (!b) return 0.3;
  const id = x.c.buildings.list[b.type].id;
  return id === 'temple' ? 2 : id === 'shrine' ? 1 : id === 'hearth' ? 0.5 : 0.3;
}

/** godHooks.worship: what a prayer, a worship or a sermon yields (LIVING §3.2) — and practice deepens faith a little */
function worshipYield(x: PCtx, s: number, st: Settlement, kind: number): number {
  const A = x.A;
  let g = 0, bv = -1;
  for (let k = 0; k < GODS; k++) { const v = A.faith[s * GODS + k] + 0.5 * A.fear[s * GODS + k]; if (v > bv) { bv = v; g = k; } }
  const i = s * GODS + g;
  const piety = A.traits[s * NT + TRAIT.piety];
  const place = kind === TASK.pray ? 0.5 : placeFactor(x, A.tTarget[s]);
  let amount = 2.5 * (A.faith[i] + 0.5 * A.fear[i]) * place * (0.5 + piety);
  let src = kind === TASK.preach ? 'preach' : kind === TASK.worship ? 'worship' : 'pray';
  if (kind === TASK.preach) {
    const ph = prophetOf(x.u, x.p.id, A.id[s]);
    if (ph) { amount *= 1 + ph.credibility; src = 'prophet'; }
  }
  // practice deepens faith (up to 0.6 by practice alone)
  if (kind !== TASK.preach && A.faith[i] < 0.6) A.faith[i] = Math.min(0.6, A.faith[i] + 0.004 * (0.5 + piety));
  amount = Math.round(amount * 100) / 100;
  relStat(x.u, `worship.${src}`, amount);
  return amount;
}

/** godHooks.templeWanted: faith > 0.4 and loyalty > 0.3 (else the shrine serves) */
function templeWanted(x: PCtx, st: Settlement): boolean {
  const m = meansNow(x, st);
  return m.faith > 0.4 && m.loyalty > 0.3;
}

/** a strike near people frightens those who believe it is the god's */
function lightningFear(u: Universe, p: Planet, cell: number): void {
  const ps = p.people;
  if (!ps || !ps.agents.count) return;
  const at = [p.grid.pos[cell * 3], p.grid.pos[cell * 3 + 1], p.grid.pos[cell * 3 + 2]];
  const A = ps.agents;
  const near: number[] = [];
  ps.agentsIn(cell, near);
  const g = p.grid;
  for (let e = g.nbrStart[cell]; e < g.nbrStart[cell + 1]; e++) ps.agentsIn(g.nbr[e], near);
  for (const s of near) {
    if (!A.alive[s] || A.faith[s * GODS] <= 0.3) continue;
    A.posAt(s, u.tick, _p);
    if (distM(p, _p, at) > 120) continue;
    A.fear[s * GODS] = Math.min(1, A.fear[s * GODS] + 0.02);
  }
}

// ───────────────────────────── the hour and the day ─────────────────────────────

export function relationshipTick(u: Universe): void {
  omensTick(u);
  // a storm breaks off outdoor work (people/shelter.ts stormBreaks), every quarter hour
  if (u.tick % 15 === 0) for (const p of u.planets) {
    if (!p.alive || !p.people || !p.people.settlements.length || (!p.weather.length && !p.st.globalWeather)) continue;
    const x = makeCtx(u, p);
    for (const st of p.people.settlements) {
      if (st.fallen >= 0) continue;
      const n = stormBreaks(x, st, interrupt);
      if (!n) continue;
      relStat(u, 'shelter.breaks', n);
      // the town runs for cover: one event per storm (two hours quiet), for the client's crowd and sound
      const r = srel(u, p.id, st.id);
      if (r.since.shelter === undefined || u.tick - r.since.shelter > 120) u.emit({ t: 'shelter', planet: p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], ref: settlementRef(x, st), data: { settlement: st.id, people: n } });
      r.since.shelter = u.tick;
    }
  }
}

export function relationshipHourly(u: Universe, p: Planet): void {
  bindUniverse(u);
  evacuationsHourly(u, p);
  const ps = p.people;
  if (ps && ps.settlements.length) {
    const x = makeCtx(u, p);
    for (const st of ps.settlements) {
      if (st.fallen >= 0) continue;
      const night = sunElevation(u, p, u.tick, st.pos) < -0.03;
      prayersHourly(x, st, night);
      godsFeast(x, st);
    }
  }
  prophetsHourly(u, p);
  sacredHourly(u, p);
  naturalOmens(u, p);
}

export function relationshipDaily(u: Universe, p: Planet): void {
  bindUniverse(u);
  prophetsDaily(u, p);
  const ps = p.people;
  if (!ps || !ps.settlements.length) return;
  const x = makeCtx(u, p);
  for (const st of ps.settlements.slice()) {
    if (st.fallen >= 0 || st.band) continue;
    pilgrimageDaily(u, p, st);
    revolt(x, st);
    fearMigration(x, st);
    offerings(x, st);
    conversions(x, st);
  }
}

/** fear > trust + 0.4 and loyalty < 0.3: the Called and the prophet are cast out (killed where fear > 0.85) */
function revolt(x: PCtx, st: Settlement): void {
  const u = x.u;
  const m = meansNow(x, st);
  if (!(m.fear > m.trust + 0.4 && m.loyalty < 0.3)) return;
  const called = u.god.disciples.filter((d) => d.planet === x.p.id && d.god === 0).map((d) => x.A.slotOf(d.agent)).filter((s) => s >= 0 && x.A.settlement[s] === st.id);
  const ph = prophetOfSettlement(u, x.p.id, st.id);
  const ps = ph ? x.A.slotOf(ph.agent) : -1;
  const victims = [...called, ...(ps >= 0 && !called.includes(ps) ? [ps] : [])];
  if (!victims.length) return;
  const kill = m.fear > 0.85;
  const to = x.ps.settlements.filter((o) => o.id !== st.id && o.fallen < 0 && !o.band && o.species === st.species).sort((a, b) => distM(x.p, a.pos, st.pos) - distM(x.p, b.pos, st.pos) || a.id - b.id)[0];
  for (const s of victims) {
    const id = x.A.id[s];
    u.god.disciples = u.god.disciples.filter((d) => !(d.agent === id && d.planet === x.p.id));
    x.A.flags[s] &= ~AgentFlag.disciple;
    if (kill) die(x, s, DEATH.punished);
    else if (to) exile(x, s, st, to);
  }
  if (ph) {
    // the prophet killed is gone; cast out, they go on speaking where they found refuge
    if (kill || !to) relOf(u).prophets = relOf(u).prophets.filter((q) => q !== ph);
    else ph.settlement = to.id;
  }
  relStat(u, kill ? 'revolt.killed' : 'revolt.exile');
  tell(u, x.p, kill ? 'revolt.killed' : 'revolt.exile', vars(x, st), st, [settlementRef(x, st)], kill ? 3 : 2);
}

/** fear > 0.7 and trust < 0.2 for 3 days: 10–30 % of the households leave, away from the last harm */
function fearMigration(x: PCtx, st: Settlement): void {
  const u = x.u;
  const r = srel(u, x.p.id, st.id);
  const m = meansNow(x, st);
  if (!(m.fear > 0.7 && m.trust < 0.2)) { delete r.since.dread; return; }
  r.since.dread ??= u.tick;
  if (u.tick - r.since.dread < 3 * x.day) return;
  delete r.since.dread;
  const harm = r.acts.slice().reverse().find((q) => q.kind === 'harm');
  void harm;
  // away: the settlement of their kind farthest within 6 km (the god's harm fell here)
  let dest: Settlement | null = null, bd = -1;
  for (const o of x.ps.settlements) {
    if (o.id === st.id || o.fallen >= 0 || o.band || o.species !== st.species) continue;
    const d = distM(x.p, st.pos, o.pos);
    if (d > 6000 || d <= bd) continue;
    bd = d; dest = o;
  }
  if (!dest) return;
  const share = 0.1 + 0.2 * hashFloat(st.id, u.tick, 0xf1ee);
  const hh = st.households.filter((h) => h.members.length && hashFloat(h.id, u.tick, 0xf1ef) < share);
  let n = 0;
  for (const h of hh) for (const id of h.members.slice()) {
    const s = x.A.slotOf(id);
    if (s < 0 || x.A.mission[s]) continue;
    exile(x, s, st, dest);
    n++;
  }
  if (!n) return;
  relStat(u, 'migration.fear', n);
  tell(u, x.p, 'migration.fear', vars(x, st, -1, { count: n, other: dest.name }), st, [settlementRef(x, st), settlementRef(x, dest)], 2);
}

/** a share 0.05 × loyalty of the day's surplus goes to the shrine (worship); fearful towns burn offerings and, past fear 0.8, a beast */
function offerings(x: PCtx, st: Settlement): void {
  const u = x.u;
  const m = meansNow(x, st);
  const P = Math.max(1, (x.ps.members.get(st.id)?.length ?? 0) + cohortTotal(st));
  const surplus = foodDays(x, st) / P - 3;
  const shrine = x.ps.of(st.id).some((b) => b.progress >= 1 && !(b.flags & 2) && x.c.buildings.list[b.type].function === 'temple');
  if (!shrine || surplus <= 0 || m.loyalty <= 0.02) return;
  const share = 0.05 * m.loyalty;
  const food = x.info[st.species].foods.find((it) => (st.store[it] ?? 0) > 2);
  if (food === undefined) return;
  const took = storeTake(st, food, Math.min(st.store[food] * share, surplus * P * share));
  if (took <= 0) return;
  const w = Math.round(took * 0.5 * 100) / 100;
  st.worshipBy[0] = Math.round((st.worshipBy[0] + w) * 100) / 100;
  st.worship = st.worshipBy[0];
  x.ps.worship[0] = Math.round((x.ps.worship[0] + w) * 100) / 100;
  relStat(u, 'worship.offering', w);
  const r = srel(u, x.p.id, st.id);
  if (r.since.offered === undefined) tell(u, x.p, 'offering', vars(x, st), st, [settlementRef(x, st)], 1);
  r.since.offered = u.tick;
}

/** a person turns to a rival god when its faith × loyalty beats the player's by 0.2 (a few days of it: loyalty shifts) */
function conversions(x: PCtx, st: Settlement): void {
  const u = x.u;
  if (!u.god.gods.some((g) => g.kind === 'rival' && g.alive)) return;
  const A = x.A;
  for (const s of x.ps.members.get(st.id) ?? []) {
    const i = s * GODS;
    const mine = A.faith[i] * A.loyalty[i];
    for (let g = 1; g < GODS; g++) {
      if (A.faith[i + g] * A.loyalty[i + g] - mine <= 0.2) continue;
      A.loyalty[i] *= 0.85;
      A.loyalty[i + g] = Math.min(1, A.loyalty[i + g] + 0.05);
    }
  }
}

// ───────────────────────────── views ─────────────────────────────

/** the relationship's parts of a planet's snapshot: settlement cards and the agents' flags2 bits */
export function relSnapPlanet(u: Universe, p: Planet, snap: PlanetSnap): void {
  const ps = p.people;
  if (!ps) return;
  const x = makeCtx(u, p);
  const R = u.god.rel;
  if (snap.settlements) for (const v of snap.settlements) {
    const st = ps.settlement(v.id);
    if (!st) continue;
    const m = meansNow(x, st);
    v.regard = { faith: m.faith, fear: m.fear, trust: m.trust, loyalty: m.loyalty };
    const r = R?.st[`${p.id}:${st.id}`];
    if (r?.prayers.length) v.prayers = r.prayers.map((q) => ({ id: q.id, kind: q.kind, since: q.since, until: q.until, urgency: q.urgency }));
    const ph = prophetOfSettlement(u, p.id, st.id);
    if (ph) { const s = x.A.slotOf(ph.agent); v.prophet = { agent: ph.agent, name: s >= 0 ? agentName(x, s) : '', credibility: ph.credibility }; }
    const places = (R?.places ?? []).filter((q) => q.planet === p.id && q.settlement === st.id).length;
    const animal = sacredAnimalOf(st);
    if (places || animal) v.sacred = { places, ...(animal ? { animal } : {}) };
  }
  const b = snap.agents;
  if (!b || !b.count) return;
  const f2 = b.flags2 ?? (b.flags2 = new Uint8Array(b.count));
  const prophets = new Set((R?.prophets ?? []).filter((q) => q.planet === p.id).map((q) => q.agent));
  const A = x.A;
  for (let k = 0; k < b.count; k++) {
    const s = A.slotOf(b.id[k]);
    if (s < 0) continue;
    let f = f2[k];
    if (prophets.has(b.id[k])) f |= AgentFlag2.prophet;
    if (A.task[s] === TASK.shelter || A.task[s] === TASK.evacuate) f |= AgentFlag2.sheltering;
    if (A.task[s] === TASK.pilgrimage) f |= AgentFlag2.pilgrim;
    if (A.flags[s] & AgentFlag.disciple) f |= AgentFlag2.called;
    f2[k] = f;
  }
}

export function relSnapGlobal(u: Universe): { regard: number; wrath: number } {
  return { regard: regardOf(u, 0), wrath: wrathLaw(u) };
}

export const REL_QUERIES = ['regard', 'prayers', 'prophets', 'sacred', 'omens', 'sigils'];

/** the stroke descriptions of the sigils, for the UI team's recogniser templates (hook H8) */
export const SIGIL_STROKES: Record<string, string> = {
  drop: 'a hook falling from the top that closes into a small loop at the bottom',
  anvil: 'up, a flat top drawn right, down and back left under it (the open outline of an anvil cloud)',
  fork: 'down, back up half way, down again to the right (a forked bolt)',
  ripple: 'a small closed loop, then a long level tail to the right',
  sprout: 'up a stem, a leaf loop to the left, back to the stem, a leaf loop to the right',
  knot: 'a figure-eight drawn once',
  basket: 'a U, then a handle looping over its top',
  seed: 'an almond outline, then a short stroke out of its tip',
  log: 'a long level stroke ending in a small loop (end grain)',
  eye: 'an almond outline with a small loop inside',
  flame: 'up the left side, curl over the tip, down the right, a small inward flick',
  trail: 'a loop with a long tail trailing down-left',
  arch: 'up, a round arch over, down, a short foot out at each end',
  fall: 'a long diagonal down-right ending in a small burst loop',
};

export function relQuery(u: Universe, q: string, args: Record<string, unknown>): unknown {
  switch (q) {
    case 'regard': {
      const out: Record<string, unknown>[] = [];
      for (const p of u.planets) for (const st of p.people?.settlements ?? []) {
        if (st.fallen >= 0) continue;
        if (typeof args.settlement === 'number' && args.settlement !== st.id) continue;
        const x = makeCtx(u, p);
        const r = u.god.rel?.st[`${p.id}:${st.id}`];
        out.push({ planet: p.id, settlement: st.id, name: st.name, ...meansNow(x, st), hardship: r?.since.hard ?? 0, acts: r?.acts ?? [], lapses: r?.lapses ?? 0, evacuate: r?.evacuate ?? null });
      }
      const v = regardOf(u, 0);
      return { regard: v, band: v < -0.33 ? 'feared' : v > 0.33 ? 'trusted' : 'awed', wrath: wrathLaw(u), settlements: out, stats: { ...(u.god.rel?.stats ?? {}) } };
    }
    case 'prayers': return u.planets.flatMap((p) => prayersOf(u, p).map((e) => ({ planet: p.id, ...e })));
    case 'prophets': return prophetsQuery(u);
    case 'sacred': return sacredQuery(u);
    case 'omens': return omensQuery(u);
    case 'sigils': {
      const bySigil: Record<string, { power: string; name: string; command: string; stroke: string }[]> = {};
      for (const pw of u.content.powers.list) if (pw.sigil) (bySigil[pw.sigil] ??= []).push({ power: pw.id, name: pw.name, command: pw.command, stroke: SIGIL_STROKES[pw.sigil] ?? '' });
      return { sigils: bySigil, miracles: SIGILS, strokes: SIGIL_STROKES };
    }
    default: return null;
  }
}

export { currentAct, currentWrath, ROLE, interrupt };
