// GENESIS — the rest of the god's floor of acts (CONTRACT.md §11.1): disasters on demand and their live controls
// (spawn any kind with params; cancel, scale, move, freeze), the firestorm, life and death over an area (kill, heal,
// bless, curse), inspiring a person, laws given to a settlement, introductions beyond the peoples' own channels
// (a substance, a law, a people), and restraint mode.

import type { CommandRegistry, ParamSchema, Args } from './commands.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Settlement } from '../people/state.ts';
import type { V3 } from './state.ts';
import type { CommandResult } from '../types.ts';
import { AgentFlag } from '../types.ts';
import { makeCtx } from '../people/ctx.ts';
import { DEATH, MEMK, NN, NS, NT, TRAIT } from '../people/defs.ts';
import { learn, planExperiment, godTeach, forceTeach, refusalWords } from '../people/knowledge.ts';
import { blightAt } from '../life/plants.ts';
import { seedDisease } from '../life/disease.ts';
import { herdPos } from '../life/herds.ts';
import { spawnPeople } from '../people/spawn.ts';
import { tell } from '../people/story.ts';
import { agentName, settlementRef, vars, kName } from '../people/util.ts';
import { distM } from '../people/world.ts';
import { insertSorted } from '../people/lifecycle.ts';
import { interrupt } from '../people/people.ts';
import { meet } from '../people/culture.ts';
import { spawnDisaster, cancelDisaster, scaleDisaster, moveDisaster, freezeDisaster, effR, planetTraits } from './disasters.ts';
import { die } from '../people/lifecycle.ts';
import { hurtPeople, hurtHerds, stripPlants } from './harm.ts';
import { godAct } from './belief.ts';
import { makeItem } from './inventions.ts';
import { actor, fail, herePos, nearestSettlement, norm, ok, placeName, r3 } from './util.ts';

const aPos: ParamSchema = { type: 'pos', desc: 'where (unit vector or lat/lon)' };
const radius = (d: number): ParamSchema => ({ type: 'number', min: 1, max: 20000, default: d, desc: 'metres' });

/** the disaster a control command means: an id, else the newest of a kind, else the nearest to pos, else the newest */
function pickDisaster(u: Universe, p: Planet, a: Args) {
  if (typeof a.id === 'number') return u.god.disaster(a.id);
  const live = u.god.disasters.filter((d) => d.planet === p.id);
  if (typeof a.kind === 'string') { const k = a.kind; const l = live.filter((d) => d.kind === k); return l[l.length - 1]; }
  if (a.pos) {
    let best = undefined as (typeof live)[number] | undefined, bd = Infinity;
    for (const d of live) { const dd = distM(p, d.pos, a.pos as V3); if (dd < bd) { bd = dd; best = d; } }
    if (best) return best;
  }
  return live[live.length - 1] ?? u.god.disasters[u.god.disasters.length - 1];
}

/** the settlement an act means: id, name, else the nearest to pos */
export function settlementArg(p: Planet, a: Args): Settlement | null {
  const ps = p.people;
  if (!ps) return null;
  if (typeof a.settlement === 'number') return ps.settlement(a.settlement) ?? null;
  if (typeof a.settlement === 'string') {
    const n = a.settlement.toLowerCase();
    return ps.settlements.find((s) => s.name.toLowerCase() === n) ?? ps.settlements.find((s) => s.name.toLowerCase().startsWith(n)) ?? null;
  }
  return a.pos ? nearestSettlement(p, a.pos as V3, 1500) : null;
}

/** laws a god can give a settlement (lexicon.json "laws" has the words; this has the effect) */
export const LAWS: Record<string, { name: string; apply: (u: Universe, p: Planet, st: Settlement) => string }> = {
  peace: { name: 'Thou shalt not kill', apply: (u, p, st) => traitShift(u, p, st, TRAIT.aggression, -0.25, 'gentler') },
  worship: { name: 'Keep the holy days', apply: (u, p, st) => traitShift(u, p, st, TRAIT.piety, 0.25, 'more devout') },
  learning: { name: 'Seek knowledge', apply: (u, p, st) => { st.culture.conservatism = r3(Math.max(0.02, st.culture.conservatism - 0.25)); return traitShift(u, p, st, TRAIT.curiosity, 0.2, 'more curious'); } },
  labour: { name: 'Work is prayer', apply: (u, p, st) => traitShift(u, p, st, TRAIT.diligence, 0.25, 'harder working') },
  hospitality: { name: 'Welcome the stranger', apply: (u, p, st) => { const x = makeCtx(u, p); for (const r of x.ps.relations) if (r.a === st.polity || r.b === st.polity) { const i = r.a === st.polity ? 0 : 1; r.op[i] = r3(Math.min(1, r.op[i] + 0.2)); } return 'warmer toward strangers'; } },
  tradition: { name: 'Honour the old ways', apply: (u, p, st) => { st.culture.conservatism = r3(Math.min(0.95, st.culture.conservatism + 0.3)); return 'wary of new things'; } },
  war: { name: 'Smite the unbeliever', apply: (u, p, st) => traitShift(u, p, st, TRAIT.aggression, 0.3, 'fiercer') },
  'no-fire': { name: 'Fire is forbidden', apply: (u, p, st) => taboo(u, p, st, ['fire-making', 'fire-keeping']) },
  'no-hunting': { name: 'Spare the beasts', apply: (u, p, st) => taboo(u, p, st, ['hunting']) },
  sharing: { name: 'Share the harvest', apply: (u, p, st) => traitShift(u, p, st, TRAIT.sociability, 0.25, 'readier to share') },
};

function traitShift(u: Universe, p: Planet, st: Settlement, trait: number, d: number, words: string): string {
  const x = makeCtx(u, p);
  for (const m of x.ps.members.get(st.id) ?? []) x.A.traits[m * NT + trait] = r3(Math.max(0, Math.min(1, x.A.traits[m * NT + trait] + d)));
  return words;
}

function taboo(u: Universe, p: Planet, st: Settlement, ids: string[]): string {
  const x = makeCtx(u, p);
  for (const id of ids) {
    const k = x.rt.byId.get(id);
    if (k === undefined || st.culture.taboos.includes(k)) continue;
    st.culture.taboos.push(k);
    st.culture.tabooSince![String(k)] = u.tick;
  }
  return `forbidden: ${ids.join(', ')}`;
}

/** does a disaster kind keep acting over its life (so it may last forever), or strike once? */
function lasting(def: { effectors: { at?: unknown; every?: number; type: string }[] }): boolean {
  return def.effectors.some((e) => e.at !== 'start' && e.at !== 'end' && typeof e.at !== 'number');
}

/**
 * A random disaster: every kind may come, weighted toward what the place could suffer on its own (a natural kind whose
 * needs the world meets, near what it needs), drawn from the god's own stream (deterministic: the command is logged).
 */
export function randomDisaster(u: Universe, p: Planet, pos: V3): string {
  const defs = u.content.disasters.list;
  const tr = planetTraits(u, p);
  const w: number[] = defs.map((d) => {
    let v = 0.4;
    if (d.natural && d.natural.rate > 0) v += d.natural.needs.every((n) => tr[n]) ? 2 + Math.min(2, d.natural.rate * 2) : 0.2;
    if (['moon-fall', 'rogue-flyby', 'supervolcano', 'ice-age', 'eclipse', 'impact-winter'].includes(d.id)) v *= 0.25;
    return v;
  });
  void pos;
  let sum = 0;
  for (const v of w) sum += v;
  let r = u.god.rng.float() * sum;
  for (let i = 0; i < defs.length; i++) { r -= w[i]; if (r <= 0) return defs[i].id; }
  return defs[defs.length - 1].id;
}

/** every living person of a people (sp; -1 any) on the world, or in one settlement: struck down; their cohorts too */
function killPeopleOf(u: Universe, p: Planet, sp: number, st: Settlement | null): number {
  if (!p.people) return 0;
  const x = makeCtx(u, p);
  const A = x.A;
  let n = 0;
  for (let s = 0; s < A.hi; s++) {
    if (!A.alive[s]) continue;
    if (sp >= 0 && A.species[s] !== sp) continue;
    if (st && A.settlement[s] !== st.id) continue;
    if (u.god.isHeld('agent', A.id[s])) continue;
    die(x, s, DEATH.god);
    n++;
  }
  for (const o of x.ps.settlements) {
    if (st ? o.id !== st.id : sp >= 0 && o.species !== sp) continue;
    const co = o.cohort;
    const k = co.n[0] + co.n[1] + co.n[2];
    if (k > 0) { n += Math.round(k); co.n[0] = 0; co.n[1] = 0; co.n[2] = 0; }
  }
  return n;
}

/** take back a law the god gave (its effect is undone where it can be: a taboo lifted, a trait eased back) */
function repealLaw(u: Universe, p: Planet, st: Settlement, which: string, god: number): CommandResult {
  const key = `${p.id}:${st.id}`;
  const had = u.god.settlementLaws[key] ?? [];
  const list = which === 'all' ? had.slice() : had.includes(which) ? [which] : [];
  if (!list.length) return fail(which === 'all' ? `${st.name} keeps no law of yours.` : `${st.name} was never given the law '${LAWS[which]?.name ?? which}'.`);
  const x = makeCtx(u, p);
  for (const l of list) {
    const undo = l.startsWith('taboo:') ? (uu: Universe, pp: Planet, ss: Settlement) => untaboo(uu, pp, ss, [l.slice(6)]) : UNDO[l];
    if (undo) undo(u, p, st);
  }
  u.god.settlementLaws[key] = had.filter((l) => !list.includes(l));
  if (!u.god.settlementLaws[key].length) delete u.god.settlementLaws[key];
  const names = list.map((l) => (l.startsWith('taboo:') ? `the taboo on ${kName(x, x.rt.byId.get(l.slice(6)) ?? 0)}` : `"${LAWS[l]?.name ?? l}"`)).join(', ');
  tell(u, p, 'law.repealed', vars(x, st, -1, { text: `The god took back from ${st.name} the law${list.length === 1 ? '' : 's'} ${names}.` }), st, [settlementRef(x, st)], 1);
  godAct(u, p, st.pos, st.territory + 150, { wonder: 0.2 }, god);
  return ok(`${st.name} is released from ${names}.`);
}

/** what repealing a law undoes */
const UNDO: Record<string, (u: Universe, p: Planet, st: Settlement) => void> = {
  peace: (u, p, st) => { traitShift(u, p, st, TRAIT.aggression, 0.25, ''); },
  worship: (u, p, st) => { traitShift(u, p, st, TRAIT.piety, -0.25, ''); },
  learning: (u, p, st) => { st.culture.conservatism = r3(Math.min(0.95, st.culture.conservatism + 0.25)); traitShift(u, p, st, TRAIT.curiosity, -0.2, ''); },
  labour: (u, p, st) => { traitShift(u, p, st, TRAIT.diligence, -0.25, ''); },
  tradition: (_u, _p, st) => { st.culture.conservatism = r3(Math.max(0.02, st.culture.conservatism - 0.3)); },
  war: (u, p, st) => { traitShift(u, p, st, TRAIT.aggression, -0.3, ''); },
  'no-fire': (u, p, st) => { untaboo(u, p, st, ['fire-making', 'fire-keeping']); },
  'no-hunting': (u, p, st) => { untaboo(u, p, st, ['hunting']); },
  sharing: (u, p, st) => { traitShift(u, p, st, TRAIT.sociability, -0.25, ''); },
};

function untaboo(u: Universe, p: Planet, st: Settlement, ids: string[]): void {
  const x = makeCtx(u, p);
  for (const id of ids) {
    const k = x.rt.byId.get(id);
    if (k === undefined) continue;
    st.culture.taboos = st.culture.taboos.filter((t) => t !== k);
    if (st.culture.tabooSince) delete st.culture.tabooSince[String(k)];
  }
}

export function registerActCommands(r: CommandRegistry): void {
  // ── disasters ──
  r.register('disaster.spawn', ({ u, p, cmd }, a) => {
    const pos = norm(a.pos ?? herePos(u, p));
    // 'random': drawn from the god's stream, weighted toward what this place could suffer on its own
    const kind = a.kind === 'random' ? randomDisaster(u, p, pos) : String(a.kind);
    const def0 = u.content.disasters.find(kind);
    // forever (-1): only a disaster that keeps acting can last forever; a one-blow strike (a meteor) falls once
    let life = a.duration as number | undefined;
    let once = '';
    if (life !== undefined && life < 0 && def0 && !lasting(def0)) { life = undefined; once = ` (a ${def0.name.toLowerCase()} strikes once: for an endless one, ask for ${def0.id === 'meteor' ? 'a meteor shower' : 'a lasting kind'} forever)`; }
    const d = spawnDisaster(u, p, kind, {
      pos, radius: a.radius as number | undefined, intensity: a.intensity as number | undefined,
      scale: a.scale as number | undefined, life, god: actor(cmd), cause: 'god',
      toward: (a.toward as V3 | null) ?? null, heading: typeof a.heading === 'number' ? (a.heading * Math.PI) / 180 : undefined,
    });
    if (typeof d === 'string') return fail(d);
    const def = u.content.disasters.get(d.kind);
    const span = d.life > 0 ? ` (${d.life >= 1440 ? `${r3(d.life / 1440)} days` : `${Math.round(d.life)} minutes`})` : d.life < 0 ? ' (until you stop it)' : '';
    return ok(`${a.kind === 'random' ? 'Fate chooses: ' : ''}${def.name} ${placeName(p, d.pos)}${span}${once}.`, [{ kind: 'disaster', id: d.id, planet: p.id }]);
  }, {
    desc: 'Call down any disaster (or a random one)', category: 'Disasters',
    params: {
      kind: { type: 'enum', values: (u) => [...u.content.disasters.ids(), 'random'], required: true }, pos: aPos, radius: { type: 'number', min: 5, max: 50000 },
      intensity: { type: 'number', min: 0.05, max: 20 }, scale: { type: 'number', min: 0.05, max: 50 }, duration: { type: 'number', min: -1, max: 1e7, desc: 'ticks (-1 = until cancelled)' },
      toward: { type: 'pos', desc: 'a front heads here' }, heading: { type: 'number', min: -360, max: 360, desc: 'degrees from north' },
    },
  });
  r.register('disaster.cancel', ({ u, p }, a) => {
    if (a.all === true) {
      const n = u.god.disasters.filter((d) => d.planet === p.id).length;
      for (const d of u.god.disasters.filter((q) => q.planet === p.id)) cancelDisaster(u, d, 'cancelled');
      return ok(n ? `${n} disaster${n === 1 ? '' : 's'} on ${p.name} cease.` : `Nothing is raging on ${p.name}.`);
    }
    const d = pickDisaster(u, p, a);
    if (!d) return fail('There is no live disaster to stop.');
    const name = u.content.disasters.find(d.kind)?.name ?? d.kind;
    cancelDisaster(u, d, 'cancelled');
    return ok(`The ${name.toLowerCase()} ${placeName(p, d.pos)} is stopped.`);
  }, { desc: 'Stop a disaster', category: 'Disasters', params: { id: { type: 'int', min: 1 }, kind: { type: 'enum', values: (u) => u.content.disasters.ids() }, pos: aPos, all: { type: 'boolean', default: false } } });
  r.register('disaster.scale', ({ u, p }, a) => {
    const d = pickDisaster(u, p, a);
    if (!d) return fail('There is no live disaster to scale.');
    const before = effR(d);
    scaleDisaster(d, a.factor as number);
    return ok(`The ${(u.content.disasters.find(d.kind)?.name ?? d.kind).toLowerCase()} ${(a.factor as number) >= 1 ? 'grows' : 'shrinks'} (radius ${Math.round(before)} → ${Math.round(effR(d))} m, strength ×${r3(d.scale)}).`);
  }, { desc: 'Make a disaster bigger or smaller', category: 'Disasters', params: { id: { type: 'int', min: 1 }, kind: { type: 'enum', values: (u) => u.content.disasters.ids() }, pos: aPos, factor: { type: 'number', min: 0.05, max: 20, default: 2 } } });
  r.register('disaster.move', ({ u, p }, a) => {
    const d = pickDisaster(u, p, { ...a, pos: undefined });
    if (!d) return fail('There is no live disaster to move.');
    const to = a.to as V3 | null;
    const toward = a.toward as V3 | null;
    moveDisaster(u, d, to, toward ? [toward[0] - d.pos[0], toward[1] - d.pos[1], toward[2] - d.pos[2]] : (Array.isArray(a.vel) ? a.vel as V3 : null), a.speed as number | undefined);
    return ok(`The ${(u.content.disasters.find(d.kind)?.name ?? d.kind).toLowerCase()} ${to ? `is moved ${placeName(p, d.pos)}` : 'turns'}.`);
  }, {
    desc: 'Move a disaster (to a place, or set it heading)', category: 'Disasters',
    params: { id: { type: 'int', min: 1 }, kind: { type: 'enum', values: (u) => u.content.disasters.ids() }, to: { type: 'pos', desc: 'put it here' }, toward: { type: 'pos', desc: 'head this way' }, vel: { type: 'vec3' }, speed: { type: 'number', min: 0, max: 5000, desc: 'm per tick' } },
  });
  r.register('disaster.freeze', ({ u, p }, a) => {
    const d = pickDisaster(u, p, a);
    if (!d) return fail('There is no live disaster to freeze.');
    freezeDisaster(d, a.on !== false);
    const name = (u.content.disasters.find(d.kind)?.name ?? d.kind).toLowerCase();
    return ok(d.frozen ? `The ${name} hangs frozen in place.` : `The ${name} moves again.`);
  }, { desc: 'Freeze a disaster mid-flight (or let it go on)', category: 'Disasters', params: { id: { type: 'int', min: 1 }, kind: { type: 'enum', values: (u) => u.content.disasters.ids() }, pos: aPos, on: { type: 'boolean', default: true } } });
  r.register('fire.firestorm', ({ u, p, cmd }, a) => {
    if (!p.airy) return fail(`Nothing burns without air on ${p.name}.`);
    const d = spawnDisaster(u, p, 'firestorm', { pos: norm(a.pos ?? herePos(u, p)), radius: a.radius as number | undefined, intensity: a.intensity as number | undefined, god: actor(cmd) });
    if (typeof d === 'string') return fail(d);
    return ok(`A firestorm rises ${placeName(p, d.pos)}.`, [{ kind: 'disaster', id: d.id, planet: p.id }]);
  }, { desc: 'Raise a firestorm', category: 'Fire', params: { pos: aPos, radius: { type: 'number', min: 20, max: 5000 }, intensity: { type: 'number', min: 0.1, max: 5 } } });

  // ── life and death over an area ──
  r.register('life.kill', ({ u, p, cmd }, a) => {
    const g = actor(cmd);
    const who = String(a.what ?? 'all');
    // a settlement named: death over all of it (its people wherever they are, and its land)
    const st = a.settlement !== undefined ? settlementArg(p, { settlement: a.settlement, pos: null }) : null;
    if (a.settlement !== undefined && !st) return fail(`There is no settlement called '${a.settlement}'.`);
    const pos = st ? norm(st.pos) : norm(a.pos ?? herePos(u, p));
    const R = st ? Math.max(a.radius as number, st.territory + 60) : (a.radius as number);
    // a people named (species): only they die, everywhere on the world (or in the settlement named)
    if (typeof a.species === 'string') {
      const x = makeCtx(u, p);
      const sp = x.c.species.idx(a.species);
      if (sp < 0) return fail(`There is no people called '${a.species}'.`);
      const n = killPeopleOf(u, p, sp, st);
      if (st) godAct(u, p, st.pos, st.territory + 400, { harm: 1 }, g);
      else godAct(u, p, null, 0, { harm: 1 }, g);
      return ok(n ? `Death takes ${n} of the ${x.c.species.list[sp].plural.replace(/^the /, '')}${st ? ` of ${st.name}` : ` of ${p.name}`}.` : `There are no ${x.c.species.list[sp].plural.replace(/^the /, '')} ${st ? `in ${st.name}` : `on ${p.name}`}.`);
    }
    let dead = 0, beasts = 0;
    if (who === 'all' || who === 'people') dead = hurtPeople(u, p, pos, R, 50, DEATH.god, { flat: true, fear: 1 }).dead;
    if (st && (who === 'all' || who === 'people')) dead += killPeopleOf(u, p, -1, st);
    if (who === 'all' || who === 'animals') beasts = hurtHerds(u, p, pos, R, 1);
    if (who === 'plants' || who === 'all') stripPlants(p, pos, R, { crop: 1, tree: 1, shrub: 1, grass: 1 });
    godAct(u, p, pos, R * 4, { harm: 1 }, g);
    if (who === 'plants') return ok(`Every green thing withers ${placeName(p, pos)}.`);
    return ok(`Death passes ${st ? `over ${st.name}` : placeName(p, pos)}: ${dead} people, ${beasts} animals.`);
  }, {
    desc: 'Kill everything in an area (or a settlement, or every one of a people)', category: 'Life',
    params: {
      pos: aPos, radius: radius(60), what: { type: 'enum', values: ['all', 'people', 'animals', 'plants'], default: 'all' },
      settlement: { type: 'any', desc: 'a settlement (id or name): all of it' }, species: { type: 'enum', values: (u) => u.content.species.ids(), desc: 'only this people' },
    },
  });
  r.register('life.heal', ({ u, p, cmd }, a) => {
    const st = a.settlement !== undefined ? settlementArg(p, { settlement: a.settlement, pos: null }) : null;
    if (a.settlement !== undefined && !st) return fail(`There is no settlement called '${a.settlement}'.`);
    const all = a.everywhere === true;
    const pos = st ? norm(st.pos) : norm(a.pos ?? herePos(u, p));
    const R = all ? Infinity : st ? Math.max(a.radius as number, st.territory + 100) : (a.radius as number);
    let n = 0;
    if (p.people) {
      const x = makeCtx(u, p);
      const A = x.A;
      const pt = [0, 0, 0];
      for (let s = 0; s < A.hi; s++) {
        if (!A.alive[s]) continue;
        A.posAt(s, u.tick, pt);
        if (!all && !(st && A.settlement[s] === st.id) && distM(p, pt, pos) > R) continue;
        A.health[s] = 1; A.disease[s] = -1; A.flags[s] &= ~(AgentFlag.sick | AgentFlag.onFire);
        A.remember(s, MEMK.healed, u.tick, 0);
        n++;
      }
      for (const h of x.ps.herds) { herdPos(h, u.tick, pt); if (all || distM(p, pt, pos) <= R) { h.sick = -1; h.hunger = Math.min(h.hunger, 0.2); } }
      if (all) p.f.blight.fill(0);
      else for (const c of p.cellsNear(pos, R)) p.f.blight[c] = 0;
      p.bump('blight');
    }
    godAct(u, p, pos, all ? 4000 : R + 200, { help: 0.6 }, actor(cmd), 'heal');
    return ok(`${n} ${n === 1 ? 'person is' : 'people are'} healed ${all ? `all over ${p.name}` : st ? `in ${st.name}` : placeName(p, pos)}, and the beasts and fields with them.`);
  }, { desc: 'Heal everything in an area (or a settlement, or the whole world)', category: 'Life', params: { pos: aPos, radius: radius(200), settlement: { type: 'any' }, everywhere: { type: 'boolean', default: false } } });
  r.register('life.bless', ({ u, p, cmd }, a) => {
    const pos = norm(a.pos ?? herePos(u, p));
    const R = a.radius as number;
    const g = actor(cmd);
    for (const c of p.cellsNear(pos, R)) {
      p.f.fertility[c] = Math.min(1, p.f.fertility[c] + 0.25);
      if (p.f.crop[c] > 0) p.f.crop[c] = Math.min(1, p.f.crop[c] + 0.2);
    }
    p.bump('fertility'); p.bump('crop'); p.vegDirty = true;
    let n = 0;
    if (p.people) {
      const x = makeCtx(u, p);
      const A = x.A;
      const pt = [0, 0, 0];
      for (let s = 0; s < A.hi; s++) {
        if (!A.alive[s]) continue;
        A.posAt(s, u.tick, pt);
        if (distM(p, pt, pos) > R) continue;
        A.health[s] = Math.min(1, A.health[s] + 0.3); A.mood[s] = Math.min(1, A.mood[s] + 0.4);
        for (let k = 0; k < NN; k++) A.needs[s * NN + k] = Math.max(A.needs[s * NN + k], 0.7);
        n++;
      }
    }
    godAct(u, p, pos, R + 200, { help: 0.7 }, g);
    return ok(`A blessing falls ${placeName(p, pos)}: ${n} people rejoice, the fields swell.`);
  }, { desc: 'Bless a place (health, harvests, joy)', category: 'Life', params: { pos: aPos, radius: radius(300), settlement: { type: 'any' } } });
  r.register('life.curse', ({ u, p, cmd }, a) => {
    const st = settlementArg(p, a);
    const pos = norm(a.pos ?? (st ? st.pos : herePos(u, p)));
    const R = a.radius as number;
    const g = actor(cmd);
    if (p.people) {
      const x = makeCtx(u, p);
      for (const c of p.cellsNear(pos, R)) if (p.f.crop[c] > 0 || p.f.tree[c] > 0.2) blightAt(x, c, 0.3);
      const s2 = st ?? nearestSettlement(p, pos, R + 300);
      if (s2) {
        const d = x.c.diseases.idx(String(a.disease ?? 'wasting-cough'));
        if (d >= 0) seedDisease(x, s2, d, 2, 'the god');
        for (const m of x.ps.members.get(s2.id) ?? []) { x.A.mood[m] = Math.max(0, x.A.mood[m] - 0.4); x.A.remember(m, MEMK.fear, u.tick, 0); }
      }
    }
    stripPlants(p, pos, R, { crop: 0.4 });
    godAct(u, p, pos, R + 200, { harm: 0.7 }, g);
    return ok(`A curse settles ${placeName(p, pos)}: blight in the fields, sickness in the houses.`);
  }, { desc: 'Curse a place (blight, sickness, gloom)', category: 'Life', params: { pos: aPos, radius: radius(300), settlement: { type: 'any' }, disease: { type: 'enum', values: (u) => u.content.diseases.ids() } } });

  // ── a person ──
  r.register('agent.inspire', ({ u, p, cmd }, a) => {
    const x = makeCtx(u, p);
    const s = x.A.slotOf(a.id as number);
    if (s < 0) return fail('That person is not alive.');
    const A = x.A;
    A.mood[s] = 1;
    A.traits[s * NT + TRAIT.curiosity] = r3(Math.min(1, A.traits[s * NT + TRAIT.curiosity] + 0.3));
    A.traits[s * NT + TRAIT.diligence] = r3(Math.min(1, A.traits[s * NT + TRAIT.diligence] + 0.2));
    for (let k = 0; k < NS; k++) A.skills[s * NS + k] = r3(Math.min(1, A.skills[s * NS + k] + 0.1));
    A.love[s * 4 + actor(cmd)] = Math.min(1, A.love[s * 4 + actor(cmd)] + 0.2);
    A.remember(s, MEMK.miracle, u.tick, 0);
    const st = x.ps.settlement(A.settlement[s]);
    // a flash of insight: whatever their curiosity was reaching for, they see it now
    let found = '';
    if (st) {
      const ctxs = st.res?.contexts ?? [];
      const plan = planExperiment(x, s, st, (k) => ctxs.includes(k));
      if (plan && learn(x, s, plan.k, 'experiment')) found = kName(x, plan.k);
    }
    const pt = [0, 0, 0];
    A.posAt(s, u.tick, pt);
    godAct(u, p, pt, 120, { wonder: 0.3, help: 0.2 }, actor(cmd));
    interrupt(x, s);
    return ok(`${agentName(x, s)} is inspired${found ? ` — and suddenly understands ${found}` : ''}.`);
  }, { desc: 'Inspire a person (insight, zeal, skill)', category: 'Peoples', params: { id: { type: 'int', required: true, min: 1 } } });

  // ── laws and new things for a settlement ──
  r.register('settlement.law', ({ u, p, cmd }, a) => {
    const st = settlementArg(p, a);
    if (!st) return fail(a.on === false ? 'Repeal the law where? Name a settlement or point at one.' : 'Give the law to whom? Name a settlement or point at one.');
    // a taboo on any one idea ("forbid bronze in Aru"): they will not take it up, and hold it in dread
    if (a.law === 'taboo') {
      if (typeof a.knowledge !== 'string') return fail('Forbid what? Name an idea ("forbid bronze in Aru").');
      const x = makeCtx(u, p);
      const k = x.rt.byId.get(a.knowledge);
      if (k === undefined) return fail(`There is no idea called '${a.knowledge}'.`);
      const key = `${p.id}:${st.id}`;
      const tag = `taboo:${a.knowledge}`;
      if (a.on === false) {
        untaboo(u, p, st, [a.knowledge]);
        if (u.god.settlementLaws[key]) u.god.settlementLaws[key] = u.god.settlementLaws[key].filter((l) => l !== tag);
        godAct(u, p, st.pos, st.territory + 150, { wonder: 0.2 }, actor(cmd));
        return ok(`${st.name} may take up ${kName(x, k)} again.`);
      }
      taboo(u, p, st, [a.knowledge]);
      const l = (u.god.settlementLaws[key] ??= []);
      if (!l.includes(tag)) l.push(tag);
      tell(u, p, 'law.given', vars(x, st, -1, { text: `The god forbade ${st.name} ${kName(x, k)}.` }), st, [settlementRef(x, st)], 2);
      godAct(u, p, st.pos, st.territory + 150, { wonder: 0.4 }, actor(cmd));
      return ok(`${st.name} is forbidden ${kName(x, k)}: they will not take it up, and those who know it will keep it hidden.`);
    }
    if (a.on === false) return repealLaw(u, p, st, String(a.law), actor(cmd));
    const law = LAWS[String(a.law)];
    if (!law) return fail(`There is no law called '${a.law}'. Laws: ${Object.keys(LAWS).join(', ')}.`);
    const effect = law.apply(u, p, st);
    const key = `${p.id}:${st.id}`;
    const l = (u.god.settlementLaws[key] ??= []);
    if (!l.includes(String(a.law))) l.push(String(a.law));
    const x = makeCtx(u, p);
    tell(u, p, 'law.given', vars(x, st, -1, { text: `The god gave ${st.name} a law: "${law.name}". They are ${effect}.` }), st, [settlementRef(x, st)], 2);
    godAct(u, p, st.pos, st.territory + 150, { wonder: 0.4 }, actor(cmd));
    return ok(`${st.name} receives the law "${law.name}": ${effect}.`);
  }, {
    desc: 'Give a settlement a law (or repeal one: on false; law "all" repeals every law the god gave)', category: 'Laws',
    params: {
      settlement: { type: 'any' }, pos: aPos, law: { type: 'enum', values: [...Object.keys(LAWS), 'taboo', 'all'], required: true }, on: { type: 'boolean', default: true },
      knowledge: { type: 'enum', values: (u) => u.content.recipes.ids(), desc: "law 'taboo': the idea forbidden" },
    },
  });

  // settlement.introduce gains three channels: a law, a people, and a substance never seen (made into content)
  const base = r.handlerOf('settlement.introduce');
  const schema = r.schema('settlement.introduce');
  if (base && schema) {
    r.register('settlement.introduce', (ctx, a) => {
      const { u, p, cmd } = ctx;
      if (a.law !== undefined) return r.dispatch(u, { k: 'settlement.law', law: a.law, settlement: a.settlement, pos: a.pos, planet: p.id, god: cmd.god });
      if (a.people !== undefined) {
        const st = settlementArg(p, a);
        const at = (a.pos as V3 | null) ?? (st ? st.pos : herePos(u, p));
        const sp = String(a.people);
        if (!u.content.species.has(sp)) return fail(`There is no people called '${sp}'.`);
        const band = spawnPeople(u, p, { species: sp, count: Math.max(2, Math.round(Number(a.qty ?? 8))), pos: at, era: 'stone', settled: false });
        if (!band) return fail(`${u.content.species.get(sp).name} cannot be placed there.`);
        const x = makeCtx(u, p);
        if (st && st.species === band.species && st.id !== band.id) {
          // they join: newcomers taken in (their knowledge with them)
          for (const m of (x.ps.members.get(band.id) ?? []).slice()) {
            x.ps.removeMember(band.id, m);
            x.A.settlement[m] = st.id;
            x.A.home[m] = -1;
            x.ps.addMember(st.id, m);
            interrupt(x, m);
          }
          for (const h of band.households) st.households.push({ id: h.id, members: h.members.slice(), home: -1 });
          band.households = [];
          band.fallen = u.tick;
          return ok(`${Math.round(Number(a.qty ?? 8))} strangers of their own kind come to live at ${st.name}.`);
        }
        if (st) meet(x, st, band);
        return ok(`A band of ${u.content.species.get(sp).plural.replace(/^the /, '')} arrives near ${st ? st.name : 'that place'}.`, [settlementRef(x, band)]);
      }
      if (typeof a.substance === 'string' && a.substance.trim()) {
        // a substance: an item (made into content if the world never had it) laid near them as a thing to wonder at
        const word = a.substance.trim().toLowerCase();
        const tags = Array.isArray(a.tags) ? (a.tags as unknown[]).map(String) : ['material'];
        // a thing the world never had becomes content: the item, and the craft of making it (inventions.ts)
        let id = makeItem(u, word, tags).item;
        id = u.content.items.has(id) ? id : 'stone';
        return base(ctx, { ...a, item: id, substance: undefined });
      }
      if (typeof a.knowledge === 'string' && !a.idea) return base(ctx, { ...a, idea: a.knowledge });
      return base(ctx, a);
    }, {
      ...schema,
      params: {
        ...schema.params, law: { type: 'enum', values: Object.keys(LAWS) }, people: { type: 'enum', values: (u: Universe) => u.content.species.ids() },
        substance: { type: 'string', desc: 'anything: unknown words become new content' }, tags: { type: 'any' }, knowledge: { type: 'enum', values: (u: Universe) => u.content.recipes.ids() },
      },
    });
  }

  // a settlement asked to learn: the teach channel by name (idea.teach covers it; this keeps godTeach reachable by words)
  r.register('settlement.teach', ({ u, p, cmd }, a) => {
    const st = settlementArg(p, a);
    if (!st) return fail('Teach whom? Name a settlement or point at one.');
    const x = makeCtx(u, p);
    const k = x.rt.byId.get(String(a.knowledge));
    if (k === undefined) return fail(`There is no idea called '${a.knowledge}'.`);
    const slots = (x.ps.members.get(st.id) ?? []).filter((m) => !(x.A.flags[m] & AgentFlag.child));
    godAct(u, p, st.pos, st.territory + 150, { wonder: 0.2 }, actor(cmd));
    if (a.force === true) {
      const f = forceTeach(x, slots, k);
      if (!f.taught && f.already) return ok(`${st.name} knows ${kName(x, k)} already.`);
      return ok(`${f.taught} of ${st.name} are made to understand ${kName(x, k)}${f.groundwork ? ` (with ${f.groundwork} lesson${f.groundwork === 1 ? '' : 's'} of groundwork)` : ''}${f.compelled ? `; ${f.compelled} against their will, and they fear you more for it` : ''}.`);
    }
    const res = godTeach(x, slots, k);
    const why = Object.entries(res.reasons).sort((q, w) => w[1] - q[1] || (q[0] < w[0] ? -1 : 1))[0]?.[0] ?? 'unwilling';
    if (!res.taught && res.refused) return { ok: false, msg: `${st.name} refused ${kName(x, k)}: ${refusalWords(x, `the people of ${st.name}`, slots[0] ?? -1, k, why, true)}. (To insist: "make ${st.name} learn ${kName(x, k)}".)` };
    if (!res.taught && res.already) return ok(`${st.name} knows ${kName(x, k)} already.`);
    return ok(`${res.taught} of ${st.name} learn ${kName(x, k)}${res.refused ? `; ${res.refused} refused (${refusalWords(x, 'they', -1, k, why, true)})` : ''}.`);
  }, {
    desc: 'Teach a settlement an idea (force: insist, with the groundwork, willing or not)', category: 'Ideas',
    params: { settlement: { type: 'any' }, pos: aPos, knowledge: { type: 'enum', values: (u) => u.content.recipes.ids(), required: true }, force: { type: 'boolean', default: false } },
  });

  // ── saving and loading are the host's (worker / UI): the sim answers with a control it honours ──
  r.register('meta.save', (_c, a) => ({ ok: true, msg: a.quick === true ? 'Quicksave: the world is kept as it is now.' : 'The world is kept as it is now (saving).', control: { save: 1, ...(a.quick === true ? { quick: 1 } : {}) } }),
    { desc: 'Save the world (the host keeps it)', category: 'Time', params: { quick: { type: 'boolean', default: false } } });
  r.register('meta.load', (_c, a) => ({ ok: true, msg: a.quick === true ? 'Quickload: back to the last quicksave.' : 'Back to the last save (loading).', control: { load: 1, ...(a.quick === true ? { quick: 1 } : {}) } }),
    { desc: 'Load the last save (the host restores it)', category: 'Time', params: { quick: { type: 'boolean', default: false } } });

  // ── restraint ──
  r.register('meta.restraint', ({ u }, a) => {
    u.settings.restraint = a.on !== false;
    return ok(u.settings.restraint ? 'Restraint: your powers now cost worship and need time to gather.' : 'Omnipotence restored: every power, anywhere, now.');
  }, { desc: 'Restraint mode (worship costs and cooldowns)', category: 'Laws', params: { on: { type: 'boolean', default: true } } });
}

export { insertSorted };
