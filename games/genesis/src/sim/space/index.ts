// GENESIS — the door to worlds-and-space (CONTRACT.md §12): its share of each tick, its commands (the god's push to
// the stars, recalling or smiting a ship, a flare of the star over every world), its laws in the parameter registry,
// its queries (ships, a ship, a people's view of the sky, the chain a settlement lacks) and the ShipViews of a
// snapshot.
//
// Cadences (ticks): ships in flight every tick (a comparison against the end of their phase; a day aboard once a game
// day); programs on the ground hourly, staggered by ship id (their job requests every 10 ticks, so the job planner's
// hourly rewrite never drops them for long); each world's peoples look at the sky and weigh their reasons daily,
// staggered by world. Finished ships are kept as history (the last 24).

import type { CommandRegistry } from '../god/commands.ts';
import type { Universe } from '../world/universe.ts';
import type { ShipView } from '../types.ts';
import type { Purpose, ShipState } from './state.ts';
import { stKey } from './state.ts';
import { makeCtx } from '../people/ctx.ts';
import { godHooks } from '../people/hooks.ts';
import { registerParam, fmt } from '../god/params.ts';
import { spawnDisaster } from '../god/disasters.ts';
import { resetClimateMemory } from '../fields/climate.ts';
import { programHour, ensureJobs, crewTask, spaceDaily, chooseKind, chooseTarget, chainGaps, missingKnowledge, startProgram, whyOf, abandonProgram, motives, sightLevel, describeWorld, standingPad, article, isSettlers, sealGaps, settlersOf } from './ships.ts';
import { breathable } from './habitat.ts';
import { flightTick, lose, strand, turnBack, comeDown } from './flight.ts';
import { shipView, DAY } from './transit.ts';
import { kindName } from './crew.ts';
import { fail, ok } from '../god/util.ts';

const PRE = new Set(['building', 'fuelling', 'boarding']);
const FLIGHT = new Set(['pad', 'ascent', 'orbit', 'transfer', 'descent', 'landed', 'lost', 'stranded']);
const HISTORY = 24;

/** the space share of tick t (after the worlds and the god layer have run) */
export function spaceTick(u: Universe, t: number): void {
  const sp = u.space;
  if (sp.ships.length) {
    let done = 0;
    for (const sh of sp.ships) {
      const def = u.content.ships.find(sh.kind);
      if (!def) continue;
      if (PRE.has(sh.phase)) {
        if ((t + sh.id * 7) % 60 === 0) programHour(u, sh, def);
        if ((t + sh.id) % 10 === 0 && (sh.phase === 'building' || sh.phase === 'fuelling')) {
          const p = u.planet(sh.from);
          const st = p?.people?.settlement(sh.owner);
          if (p && st) ensureJobs(makeCtx(u, p), st, sh, def);
        }
      } else if (FLIGHT.has(sh.phase)) flightTick(u, sh, def);
      if (sh.phase === 'done') done++;
    }
    if (done > HISTORY) {
      let drop = done - HISTORY;
      sp.ships = sp.ships.filter((sh) => !(sh.phase === 'done' && drop-- > 0));
    }
  }
  for (const p of u.planets) {
    if (!p.alive) continue;
    const day = Math.max(60, Math.round(p.st.dayHours * 60));
    if ((t + p.id * 29) % day === 500 % day) spaceDaily(u, p);
  }
}

/** the ships the renderer draws (everything not yet finished) */
export function shipViews(u: Universe): ShipView[] {
  const out: ShipView[] = [];
  for (const sh of u.space.ships) {
    if (sh.phase === 'done') continue;
    out.push(shipView(u, sh, u.content.ships.find(sh.kind)));
  }
  return out;
}

/**
 * A world is erased: ships on it or around it die with it; ships between the worlds bound for it drift stranded; ships
 * still on the ground elsewhere that were to go there are given up (what they had set aside back into the store); ships
 * still climbing from or circling their own world come back down (in flight.ts, when they would set out).
 */
export function worldErased(u: Universe, planet: number): { stranded: number; destroyed: number; recalled: number } {
  let stranded = 0, destroyed = 0, recalled = 0;
  const name = u.planet(planet)?.name ?? 'its world';
  for (const sh of u.space.ships) {
    const def = u.content.ships.find(sh.kind);
    if (!def || sh.phase === 'done' || sh.phase === 'lost' || sh.phase === 'stranded') continue;
    const onIt = (PRE.has(sh.phase) || sh.phase === 'pad' || sh.phase === 'ascent' || sh.phase === 'orbit') ? sh.from === planet : (sh.phase === 'descent' || sh.phase === 'landed') && sh.to === planet;
    if (onIt) {
      if (PRE.has(sh.phase)) { dismissAll(u, sh); sh.phase = 'done'; sh.outcome = 'erased'; continue; }
      sh.dead += sh.crew.length;
      sh.crew = [];
      sh.phase = 'done';
      sh.outcome = 'erased';
      destroyed++;
      continue;
    }
    if (sh.to !== planet) continue;
    if (PRE.has(sh.phase) || sh.phase === 'pad') {
      // still on the ground at home: the program is given up
      const p = u.planet(sh.from);
      if (p && p.alive) { const x = makeCtx(u, p); abandonProgram(u, x, x.ps.settlement(sh.owner), sh, `${name} is gone`); }
      continue;
    }
    if (sh.phase === 'orbit') { comeDown(u, sh, def, `${name} was gone`); recalled++; continue; }
    if (sh.phase === 'transfer') { strand(u, sh, def, `${name} was unmade`); stranded++; }
  }
  return { stranded, destroyed, recalled };
}

/** let a program's people go (its world is gone under them: they die with it, the records only need clearing) */
function dismissAll(u: Universe, sh: ShipState): void {
  sh.crewIds = [];
  sh.ground = [];
  sh.stock = [];
  void u;
}

// ───────────────────────────── commands ─────────────────────────────

const PURPOSES: Purpose[] = ['colony', 'exodus', 'refuge', 'trade', 'curiosity', 'god', 'survey'];

export function registerSpaceCommands(r: CommandRegistry): void {
  registerSpaceParams();
  godHooks.crew = crewTask;
  r.register('ship.launch', ({ u, p: p0, cmd }, a) => {
    let p = p0;
    // no world named: if nobody on this one knows a ship, the most advanced people anywhere that does (not on the
    // world it is told to go to)
    const knowsShip = (q: typeof p) => { const xq = makeCtx(u, q); return xq.ps.settlements.some((s) => s.fallen < 0 && !s.band && u.content.ships.list.some((d) => missingKnowledge(xq, s, d).length === 0)); };
    if (cmd.planet === undefined && a.settlement === undefined && !knowsShip(p)) {
      const toName = typeof a.to === 'string' ? a.to.toLowerCase() : null;
      const alt = u.planets.filter((q) => q.alive && q.id !== a.to && q.name.toLowerCase() !== toName && knowsShip(q))
        .sort((q, w) => Math.max(...w.people.settlements.map((s) => s.era)) - Math.max(...q.people.settlements.map((s) => s.era)) || q.id - w.id)[0];
      if (alt) p = alt;
    }
    const x = makeCtx(u, p);
    const sts = x.ps.settlements.filter((s) => s.fallen < 0 && !s.band);
    let st = typeof a.settlement === 'number' ? sts.find((s) => s.id === a.settlement)
      : typeof a.settlement === 'string' ? sts.find((s) => s.name.toLowerCase().startsWith(String(a.settlement).toLowerCase())) : undefined;
    if (a.settlement === undefined || a.settlement === null) {
      // the most advanced people of this world that knows a ship
      st = sts.slice().sort((q, w) => w.era - q.era || w.library.length - q.library.length || q.id - w.id).find((s) => u.content.ships.list.some((d) => missingKnowledge(x, s, d).length === 0)) ?? sts.slice().sort((q, w) => w.era - q.era || q.id - w.id)[0];
    }
    if (!st) return fail(`There is no town on ${p.name} to send.`);
    const purpose = (typeof a.purpose === 'string' ? a.purpose : 'god') as Purpose;
    let to = -1;
    if (typeof a.to === 'number') to = a.to;
    else if (typeof a.to === 'string') {
      const n = a.to.toLowerCase();
      to = u.planets.find((q) => q.alive && (q.name.toLowerCase() === n || q.name.toLowerCase().startsWith(n)))?.id ?? -2;
      if (to === -2) return fail(`There is no world called '${a.to}'.`);
    }
    if (to >= 0 && !u.planet(to)?.alive) return fail('That world is gone.');
    // the chain is the law: a people that does not know how cannot go, whoever asks
    const wantKind = typeof a.kind === 'string' ? a.kind : undefined;
    if (wantKind && !u.content.ships.has(wantKind)) return fail(`There is no kind of ship called '${wantKind}'. Known: ${u.content.ships.ids().join(', ')}.`);
    const kinds = wantKind ? [u.content.ships.get(wantKind)] : u.content.ships.list;
    const def = chooseKind(u, x, st, purpose, wantKind) ?? null;
    if (!def) {
      const gaps = kinds.map((d) => `${article(d.name.toLowerCase())}: ${chainGaps(x, st!, d, 'program').join('; ')}`).slice(0, 3);
      return fail(`${st.name} cannot build a ship: ${gaps.join(' — ')}. (Teach them, or give them what they lack.)`);
    }
    if (u.space.ships.some((sh) => sh.owner === st!.id && sh.home === p.id && PRE.has(sh.phase))) return fail(`${st.name} is already building a ship.`);
    const target = def.class === 'orbit' ? -1 : def.class === 'air' ? p.id : to >= 0 ? to : chooseTarget(u, x, st, purpose === 'god' ? 'curiosity' : purpose, def.class);
    if (def.class === 'interplanetary' || def.class === 'gate') {
      if (target < 0) return fail(`${st.name} has seen no other world to go to (they need astronomy, or tell them where: to = a world).`);
      if (target === p.id) return fail('A ship between the worlds must go to another world.');
    }
    const tgt = target >= 0 ? u.planet(target) : undefined;
    // a town of the world it goes to, to come down by (id or name)
    let near = -1;
    if (a.toward !== undefined && a.toward !== null && tgt) {
      const towns = tgt.people.settlements.filter((s) => s.fallen < 0);
      const t = typeof a.toward === 'number' ? towns.find((s) => s.id === a.toward) : towns.find((s) => s.name.toLowerCase().startsWith(String(a.toward).toLowerCase()));
      if (!t) return fail(`There is no town called '${String(a.toward)}' on ${tgt.name}.`);
      near = t.id;
    }
    // settlers do not go where the air would kill them unless they can live sealed (suits for all, water, a dome's makings)
    if (tgt && tgt.id !== p.id && isSettlers(purpose) && !breathable(u.content.species.list[st.species], tgt.st.atmosphere)) {
      const gaps = sealGaps(u, x, st, tgt, settlersOf(x, st, purpose));
      if (gaps.length) return fail(`${st.name} will not settle ${tgt.name}: its air would kill them, and ${gaps.join('; ')}. (Teach them pressure suits, give them suits — or send them to visit.)`);
    }
    const sh = startProgram(u, x, st, def, def.class === 'orbit' ? 'survey' : purpose, target, def.class === 'orbit' ? whyOf('survey') : whyOf('god'));
    if (near >= 0) sh.destSettlement = near;
    const gaps = chainGaps(x, st, def, 'launch');
    return ok(`${st.name} lays down the ${def.name.toLowerCase()} ${sh.name}${tgt && tgt.id !== p.id ? `, bound for ${tgt.name}` : ''}.${gaps.length ? ` Still to do: ${gaps.join('; ')}.` : ' Everything is ready: fuelling begins.'}`,
      [{ kind: 'ship', id: sh.id, planet: p.id }, { kind: 'settlement', id: st.id, planet: p.id }]);
  }, {
    desc: 'Send a people to the stars (they must know how)', category: 'Worlds',
    params: {
      settlement: { type: 'any', desc: 'the town that goes (id or name); default: the most advanced' },
      to: { type: 'any', desc: 'the world to go to (id or name); default: the one they would choose' },
      purpose: { type: 'enum', values: PURPOSES, default: 'god' },
      kind: { type: 'enum', values: (u) => u.content.ships.ids() },
      toward: { type: 'any', desc: 'a town on the world it goes to (id or name): it comes down by it' },
    },
  });
  r.register('ship.cancel', ({ u }, a) => {
    const sh = findShip(u, a.ship, (s) => PRE.has(s.phase) || s.phase === 'pad' || s.phase === 'transfer');
    if (!sh) return fail(a.ship === undefined ? 'No ship is being built or flying now.' : 'There is no such ship.');
    const def = u.content.ships.find(sh.kind);
    if (PRE.has(sh.phase) || sh.phase === 'pad') {
      const p = u.planet(sh.from)!;
      const x = makeCtx(u, p);
      abandonProgram(u, x, x.ps.settlement(sh.owner), sh, 'the god forbade it');
      return ok(`The ${kindName(x, sh)} ${sh.name} will not fly.`);
    }
    if (def && def.returns && turnBack(u, sh, def)) return ok(`${sh.name} turns back for home.`);
    return fail(`${sh.name} is ${sh.phase}: it cannot be called back now.`);
  }, { desc: 'Forbid a ship: stop its building, or turn it back', category: 'Worlds', params: { ship: { type: 'any', desc: 'ship id or name; default: the one ship flying (else the newest)' } } });
  r.register('ship.destroy', ({ u }, a) => {
    const sh = findShip(u, a.ship, (s) => FLIGHT.has(s.phase) && s.phase !== 'lost' && s.phase !== 'landed');
    if (!sh) return fail(a.ship === undefined ? 'No ship is in the sky now.' : 'There is no such ship.');
    const def = u.content.ships.find(sh.kind);
    if (!def || !FLIGHT.has(sh.phase) || sh.phase === 'lost' || sh.phase === 'landed') return fail(`${sh.name} is not in the sky.`);
    const n = sh.crew.length;
    lose(u, sh, def, sh.phase === 'stranded' ? 'transfer' : sh.phase);
    sh.cause = 'the hand of the god';
    return ok(`${sh.name} is struck from the sky${n ? `, and ${n} with it` : ''}.`);
  }, { desc: 'Strike a ship from the sky', category: 'Worlds', params: { ship: { type: 'any', desc: 'ship id or name; default: the one ship in the sky (else the newest)' } } });
  r.register('star.flare', ({ u, cmd }, a) => {
    const g = typeof cmd.god === 'number' ? cmd.god : 0;
    const strength = typeof a.strength === 'number' ? a.strength : 1;
    let n = 0;
    for (const q of u.planets) {
      if (!q.alive) continue;
      const d = spawnDisaster(u, q, 'solar-flare', { god: g, intensity: strength, quiet: true });
      if (typeof d !== 'string') n++;
    }
    u.star.activity = Math.min(1, Math.max(u.star.activity, 0.6 + 0.3 * Math.min(1, strength)));
    u.chronicleAdd(null, 'disaster', `The star flared, and every world under it burned with auroras.`, 3);
    return ok(`The star flares: storms of light over ${n} world${n === 1 ? '' : 's'}.`);
  }, { desc: 'Make the star flare over every world', category: 'Worlds', params: { strength: { type: 'number', min: 0.1, max: 5, default: 1 } } });
  // the star remade warms or chills every world: their climates forget the old sun
  const starSet = r.handlerOf('star.set');
  const starSchema = r.schema('star.set');
  if (starSet && starSchema) {
    r.register('star.set', (ctx, a) => {
      const res = starSet(ctx, a);
      if (res.ok && (a.kind || typeof a.luminosity === 'number')) for (const q of ctx.u.planets) if (q.alive) resetClimateMemory(q);
      return res;
    }, starSchema);
  }
}

/** a ship by id or name; none named: the one ship that fits (`fits`), else the newest that does */
function findShip(u: Universe, ref: unknown, fits?: (sh: ShipState) => boolean): ShipState | undefined {
  if (typeof ref === 'number') return u.space.ship(ref);
  if (typeof ref === 'string' && ref.trim()) {
    const n = ref.trim().toLowerCase();
    if (/^\d+$/.test(n)) return u.space.ship(Number(n));
    return u.space.ships.find((sh) => sh.name.toLowerCase() === n) ?? u.space.ships.find((sh) => sh.name.toLowerCase().startsWith(n));
  }
  if (ref === undefined || ref === null || ref === '') {
    const live = u.space.ships.filter((sh) => sh.phase !== 'done' && (!fits || fits(sh)));
    return live.length ? live.reduce((a, b) => (b.id > a.id ? b : a)) : undefined;
  }
  return undefined;
}

let paramsInstalled = false;

function registerSpaceParams(): void {
  if (paramsInstalled) return;
  paramsInstalled = true;
  const law = (path: string, label: string, max: number, desc: string, aliases: string[]) => registerParam({
    path, label, unit: '×', kind: 'number', min: 0, max, desc, aliases,
    get: (u) => u.god.law(path),
    set: (u, _p, v) => { u.god.laws[path] = Number(v); return `${label}: ${fmt(Number(v))}×.`; },
  });
  law('space.reliability', 'Ship reliability', 2, 'How often ships fly true (0 = every flight fails, 1 = as their makers and crews earn).', ['ship reliability', 'rocket reliability']);
  law('space.drive', 'Urge to leave', 20, 'How readily peoples who know how start building ships.', ['space drive', 'wanderlust']);
  law('space.speed', 'Crossing speed', 50, 'How fast ships cross between the worlds.', ['ship speed', 'crossing speed']);
}

// ───────────────────────────── queries ─────────────────────────────

export const SPACE_QUERIES = ['ships', 'ship', 'space', 'chain', 'sky'];

export function spaceQuery(u: Universe, q: string, args: Record<string, unknown>): unknown {
  switch (q) {
    case 'ships': return u.space.ships.map((sh) => ({ ...summary(u, sh), view: sh.phase === 'done' ? null : shipView(u, sh, u.content.ships.find(sh.kind)) }));
    case 'ship': {
      const sh = findShip(u, args.id ?? args.ship);
      if (!sh) return null;
      return { ...summary(u, sh), crewList: sh.crew.map((m) => ({ id: m.id, name: m.custom, species: u.content.species.list[m.species]?.id, sick: m.disease >= 0 ? u.content.diseases.list[m.disease]?.name : null, health: m.health })), log: sh.log.slice(), view: sh.phase === 'done' ? null : shipView(u, sh, u.content.ships.find(sh.kind)) };
    }
    case 'space': return { firsts: u.space.firsts, relations: u.space.relations, colonies: u.space.colonies, orders: u.space.orders, observed: u.space.observed, motives: u.space.motives };
    case 'sky': case 'chain': {
      const p = u.planetFor(args.planet);
      if (!p) return null;
      const x = makeCtx(u, p);
      const st = typeof args.settlement === 'number' ? x.ps.settlement(args.settlement) : x.ps.settlements.find((s) => s.fallen < 0 && !s.band);
      if (!st) return null;
      if (q === 'chain') {
        return u.content.ships.list.map((d) => ({ kind: d.id, name: d.name, class: d.class, missing: missingKnowledge(x, st, d), pad: !!standingPad(x, st, d), gaps: chainGaps(x, st, d, 'launch') }));
      }
      const seen = u.space.observed[stKey(p.id, st.id)] ?? {};
      return { settlement: st.id, sight: sightLevel(u, x, st), motives: motives(u, x, st), worlds: Object.entries(seen).map(([id, lvl]) => { const w = u.planet(Number(id)); return { planet: Number(id), name: w?.name, level: lvl, desc: w ? describeWorld(u, w, lvl) : '' }; }) };
    }
    default: return null;
  }
}

function summary(u: Universe, sh: ShipState): Record<string, unknown> {
  const def = u.content.ships.find(sh.kind);
  return {
    id: sh.id, name: sh.name, kind: sh.kind, kindName: def?.name ?? sh.kind, class: def?.class ?? '', owner: sh.owner, ownerName: sh.ownerName, home: sh.home,
    species: u.content.species.list[sh.species]?.id, purpose: sh.purpose, why: sh.why, phase: sh.phase, from: sh.from, to: sh.to,
    toName: sh.to >= 0 ? u.planet(sh.to)?.name ?? null : null, crew: sh.crew.length || sh.crewIds.length, cargo: sh.cargo.map(([i, n]) => ({ item: u.content.items.list[i]?.id, qty: n })),
    food: sh.food, reliability: sh.reliability, work: sh.work, launched: sh.launchTick, arrives: sh.arriveTick, outcome: sh.outcome, cause: sh.cause,
    dead: sh.dead, born: sh.born, visits: sh.visits.slice(), returning: sh.returning, daysLeft: sh.t1 > u.tick ? Math.round(((sh.t1 - u.tick) / DAY) * 100) / 100 : 0,
  };
}
