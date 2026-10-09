// GENESIS — a ship's flight (CONTRACT.md §12): the launch (the crew lifted out of their world), the phases on their
// ticks (ascent -> orbit -> transfer -> descent -> landed; an airship climbs, cruises and comes down over its own world;
// a gate folds space in minutes), the roll each phase makes against the flight's reliability, life aboard between the
// worlds (food runs short, sickness spreads in close quarters, children are born on the long ships), the loss of a
// ship and what its fall does where it falls, and the voyage home.

import type { Universe } from '../world/universe.ts';
import type { ShipKindDef } from '../content.ts';
import type { PCtx } from '../people/ctx.ts';
import type { Settlement } from '../people/state.ts';
import type { CrewMember, ShipState, V3 } from './state.ts';
import { stKey } from './state.ts';
import { makeCtx } from '../people/ctx.ts';
import { cohortTotal } from '../people/cohorts.ts';
import { AgentFlag } from '../types.ts';
import { DEATH, MEMK, NN, NS, ROLE, SKILL } from '../people/defs.ts';
import { FOOD, WATER } from '../people/needs.ts';
import { hashFloat } from '../core/rng.ts';
import { distM } from '../people/world.ts';
import { tell } from '../people/story.ts';
import { settlementRef, vars } from '../people/util.ts';
import { firstOrbit } from '../chronicle.ts';
import { harmArea } from '../people/people.ts';
import { igniteArea } from '../fields/fire.ts';
import { liftAgent, knowledgeLeft, kindName, takeCargo, infectRecord } from './crew.ts';
import { dismiss, landingSite, cellDir, abandonProgram, crewSize, familiesPresent } from './ships.ts';
import {
  DAY, ASCENT_TICKS, DESCENT_TICKS, AIR_CLIMB_TICKS, planOrbit, planTransfer, transferTicks, airTicks, phaseRisk, roll,
  failureWords, shipWhere, bodyToSystem, velocityOf,
} from './transit.ts';
import { arrive, endemic, stayAbroad } from './contact.ts';

const P0 = [0, 0, 0];

/** the flight's reliability from its makers' and its crew's skill (and the god's law) */
export function reliabilityOf(u: Universe, x: PCtx, st: Settlement, crew: number[], def: ShipKindDef): number {
  const A = x.A;
  let cs = 0;
  for (const s of crew) cs += Math.max(A.skills[s * NS + SKILL.sail], A.skills[s * NS + SKILL.lore]);
  // the makers: the town's best four hands at smithing and crafting
  const makers: number[] = [];
  for (const m of x.ps.members.get(st.id) ?? []) makers.push(Math.max(A.skills[m * NS + SKILL.smith], A.skills[m * NS + SKILL.craft]));
  makers.sort((a, b) => b - a);
  const mk = makers.slice(0, 4);
  const makerQ = mk.length ? mk.reduce((a, b) => a + b, 0) / mk.length : 0.3;
  const crewQ = crew.length ? cs / crew.length : makerQ;
  const q = 0.5 * crewQ + 0.5 * makerQ;
  const rel = def.reliability * (0.55 + 0.45 * q) * Math.max(0, u.god.law('space.reliability'));
  return Math.round(Math.max(0, Math.min(0.995, rel)) * 1000) / 1000;
}

/** the countdown is over: whoever is at the pad goes aboard; the ship leaves the ground (or does not) */
export function launch(u: Universe, sh: ShipState, def: ShipKindDef): void {
  const p = u.planet(sh.from)!;
  const x = makeCtx(u, p);
  const st = x.ps.settlement(sh.owner);
  if (!st) { abandonProgram(u, x, st, sh, 'its people are gone'); return; }
  const A = x.A;
  let present: number[] = [];
  for (const id of sh.crewIds) {
    const s = A.slotOf(id);
    if (s < 0 || A.mission[s] !== -sh.id) continue;
    A.posAt(s, u.tick, P0);
    if (distM(p, P0, sh.padPos) <= 90) present.push(s);
  }
  // settlers go as families: whoever's family is not all at the pad stays home with it
  present = familiesPresent(x, st, sh, present);
  // (an uncrewed orbiter needs nobody at the pad)
  const crewed = crewSize(x, st, sh, def) > 0 || sh.crewIds.length > 0;
  if (crewed && present.length < Math.max(1, def.crew[0])) {
    // nobody came: wait for them a little longer
    sh.phase = 'boarding';
    sh.t0 = u.tick;
    sh.t1 = -1;
    return;
  }
  sh.reliability = reliabilityOf(u, x, st, present, def);
  present.sort((a, b) => A.id[a] - A.id[b]);
  for (const s of present) sh.crew.push(liftAgent(x, s, sh));
  dismiss(x, sh, sh.crewIds);
  dismiss(x, sh, sh.ground);
  sh.crewIds = [];
  sh.ground = [];
  knowledgeLeft(x, st, sh.crew, sh);
  // the sicknesses their town lives with go with them, unseen (contact.ts)
  sh.carried = endemic(x, st);
  // the last of a world's people gone to the stars: a world abandoned (the first of the system is told as such)
  if (x.A.count === 0 && !x.ps.settlements.some((o) => o.fallen < 0 && cohortTotal(o) >= 1) && x.ps.firsts.peopled !== undefined && x.ps.firsts.abandoned === undefined) {
    x.ps.firsts.abandoned = u.tick;
    const firstWorld = u.space.firsts.abandoned === undefined;
    if (firstWorld) u.space.firsts.abandoned = u.tick;
    tell(u, p, firstWorld ? 'space.abandoned' : 'world.abandoned', { planet: p.name }, null, [{ kind: 'planet', id: p.id, planet: p.id }], 3);
    u.emit({ t: 'world.abandoned', planet: p.id, data: { byShip: sh.id } });
  }
  sh.launchTick = u.tick;
  sh.lastDay = 0;
  sh.log.push(`Launched with ${sh.crew.length} aboard.`);
  const target = sh.to >= 0 ? u.planet(sh.to) : undefined;
  const v = vars(x, st, -1, { ship: kindName(x, sh), name: sh.name, count: sh.crew.length, planet: target ? target.name : p.name, home: p.name });
  const first = u.space.firsts.launch === undefined && def.class !== 'air';
  if (def.class === 'air') {
    const site = landingSite(u, x, sh);
    sh.destCell = site.cell; sh.dest = cellDir(x, site.cell); sh.destSettlement = site.settlement;
    v.place = site.settlement >= 0 ? x.ps.settlement(site.settlement)?.name ?? 'a far shore' : 'a far shore';
    tell(u, p, 'space.launch.air', v, st, [settlementRef(x, st), { kind: 'ship', id: sh.id, planet: p.id }]);
  } else if (def.class === 'orbit') tell(u, p, 'space.launch.orbiter', v, st, [settlementRef(x, st), { kind: 'ship', id: sh.id, planet: p.id }]);
  else tell(u, p, first ? 'space.launch.first' : 'space.launch', v, st, [settlementRef(x, st), { kind: 'ship', id: sh.id, planet: p.id }], first ? 3 : undefined);
  if (first) u.space.firsts.launch = u.tick;
  u.emit({ t: 'launch', planet: p.id, pos: [...sh.padPos] as V3, ref: { kind: 'ship', id: sh.id, planet: p.id }, text: sh.name, a: sh.crew.length, data: { kind: sh.kind, to: sh.to, purpose: sh.purpose } });
  // the pad's own roll
  if (roll(u, sh, 'pad') < phaseRisk(u, sh, 'pad', def.class)) { lose(u, sh, def, 'pad'); return; }
  if (def.class === 'gate') { beginTransfer(u, sh, def); return; }
  sh.phase = 'ascent';
  sh.t0 = u.tick;
  sh.t1 = u.tick + (def.class === 'air' ? AIR_CLIMB_TICKS : ASCENT_TICKS);
  if (def.class !== 'air') planOrbit(u, sh, p, sh.t1);
}

/** leave orbit (or the gate, or the mooring) for the target */
function beginTransfer(u: Universe, sh: ShipState, def: ShipKindDef): void {
  const from = u.planet(sh.from)!;
  const to = sh.to >= 0 ? u.planet(sh.to) : undefined;
  if (!to || !to.alive) {
    // still over its own world: it comes back down instead of setting out for nothing
    if (from.alive && from.id === sh.home && sh.crew.length) { comeDown(u, sh, def, to ? `${to.name} was gone` : 'there was nowhere to go'); return; }
    strand(u, sh, def, to ? `${to.name} was gone` : 'there was nowhere to go');
    return;
  }
  const xt = makeCtx(u, to);
  if (sh.destCell < 0 || def.class !== 'air') {
    // (on the way home it comes down by its own town)
    const site = landingSite(u, xt, sh.returning ? { ...sh, purpose: 'return' } : sh);
    sh.destCell = site.cell; sh.dest = cellDir(xt, site.cell); sh.destSettlement = site.settlement;
  }
  sh.phase = 'transfer';
  sh.t0 = u.tick;
  if (def.class === 'air') sh.t1 = u.tick + airTicks(u, def, from, sh.padPos, sh.dest);
  else if (def.class === 'gate') sh.t1 = u.tick + Math.max(10, Math.round(def.days[0] * DAY));
  else {
    const T = transferTicks(u, def, from, to, u.tick);
    planTransfer(u, sh, from, to, u.tick, T);
    sh.t1 = u.tick + T;
  }
  sh.arriveTick = sh.t1;
  if (sh.launchTick < 0) sh.launchTick = u.tick;
  u.emit({ t: 'ship.transfer', planet: from.id, ref: { kind: 'ship', id: sh.id }, text: sh.name, data: { from: from.id, to: to.id, arrive: sh.t1 } });
}

/** every tick: a ship in flight moves on to its next phase when the time comes (each phase rolls its risk) */
export function flightTick(u: Universe, sh: ShipState, def: ShipKindDef): void {
  const t = u.tick;
  const cls = def.class;
  switch (sh.phase) {
    case 'pad':
      if (t >= sh.t1) launch(u, sh, def);
      return;
    case 'ascent':
      if (t < sh.t1) return;
      if (roll(u, sh, 'ascent', sh.returning ? 1 : 0) < phaseRisk(u, sh, 'ascent', cls)) { lose(u, sh, def, 'ascent'); return; }
      if (cls === 'air') { beginTransfer(u, sh, def); return; }
      sh.phase = 'orbit';
      sh.t0 = t;
      sh.t1 = cls === 'orbit' ? -1 : t + Math.max(30, Math.round(def.orbitHours * 60));
      reachOrbit(u, sh);
      return;
    case 'orbit':
      if (sh.t1 < 0 || t < sh.t1) { if (sh.crew.length && (t - sh.launchTick) % DAY === DAY - 1) aboardDaily(u, sh, def); return; }
      if (roll(u, sh, 'orbit', sh.returning ? 1 : 0) < phaseRisk(u, sh, 'orbit', cls)) { lose(u, sh, def, 'orbit'); return; }
      beginTransfer(u, sh, def);
      return;
    case 'transfer': {
      const to = sh.to >= 0 ? u.planet(sh.to) : undefined;
      if (!to || !to.alive) { strand(u, sh, def, to ? `${to.name} was gone` : 'there was nowhere to go'); return; }
      // the world it is bound for moved (a new orbit, a moon spiralling in): the course is set again from here
      if (cls === 'interplanetary' && t < sh.t1 && (t + sh.id) % 10 === 0 && sh.bez.length === 4 && courseDrift(u, sh, to) > 1000) replanTransfer(u, sh, to);
      // a day aboard: food, sickness, births, the storms between the worlds
      const day = Math.floor((t - sh.launchTick) / DAY);
      if (day > sh.lastDay && t < sh.t1) {
        sh.lastDay = day;
        aboardDaily(u, sh, def);
        const days = Math.max(1, Math.round((sh.t1 - sh.launchTick) / DAY));
        if (cls !== 'gate' && roll(u, sh, 'transfer', day + (sh.returning ? 100 : 0)) < phaseRisk(u, sh, 'transfer', cls, days)) { lose(u, sh, def, 'transfer'); return; }
      }
      if (t < sh.t1) return;
      if (cls === 'gate') { sh.lastDay = 0; arrive(u, sh, def); return; }
      if (cls === 'air' && roll(u, sh, 'transfer', 999) < phaseRisk(u, sh, 'transfer', cls)) { lose(u, sh, def, 'transfer'); return; }
      sh.phase = 'descent';
      sh.t0 = t;
      sh.t1 = t + (cls === 'air' ? AIR_CLIMB_TICKS : DESCENT_TICKS);
      return;
    }
    case 'descent':
      if (t < sh.t1) return;
      if (roll(u, sh, 'descent', sh.returning ? 1 : 0) < phaseRisk(u, sh, 'descent', cls)) { lose(u, sh, def, 'descent'); return; }
      sh.lastDay = 0;
      arrive(u, sh, def);
      return;
    case 'landed':
      if (sh.t1 < 0) {
        // an outpost sealed in its ship: a day at a time on what is aboard
        if (sh.crew.length && (t - sh.t0) % DAY === DAY - 1) aboardDaily(u, sh, def);
        if (!sh.crew.length) { sh.phase = 'done'; sh.t0 = t; }
        return;
      }
      if (sh.t1 >= 0 && t >= sh.t1) {
        // (an airship's visit is on its own world: it flies home all the same)
        if (sh.returning) beginReturn(u, sh, def);
        else { sh.phase = 'done'; sh.t0 = t; sh.t1 = -1; }
      }
      return;
    case 'stranded':
      if ((t - sh.t0) % DAY === DAY - 1) aboardDaily(u, sh, def);
      if (!sh.crew.length && t - sh.t0 > 10 * DAY) { sh.phase = 'done'; sh.t1 = -1; }
      return;
    case 'lost':
      if (sh.t1 >= 0 && t >= sh.t1) { sh.phase = 'done'; sh.t1 = -1; }
      return;
  }
}

/** a ship reaches orbit: the world's first orbit is told; an orbiter opens the whole sky to its people */
function reachOrbit(u: Universe, sh: ShipState): void {
  const p = u.planet(sh.from);
  if (!p) return;
  const x = makeCtx(u, p);
  const st = x.ps.settlement(sh.owner);
  if (st && sh.from === sh.home) firstOrbit(x, st);
  if (u.space.firsts.orbit === undefined) u.space.firsts.orbit = u.tick;
  sh.log.push(`In orbit around ${p.name}.`);
  u.emit({ t: 'ship.orbit', planet: p.id, ref: { kind: 'ship', id: sh.id, planet: p.id }, text: sh.name });
}

/** the voyage home from a visited world: up from where it stands, around, across, down by its own town */
export function beginReturn(u: Universe, sh: ShipState, def: ShipKindDef): void {
  const here = u.planet(sh.to);
  const home = u.planet(sh.home);
  if (!here || !home || !home.alive) {
    // home is gone: they stay where they stand (with kin who welcomed them, else a town of their own)
    sh.returning = false;
    if (here && here.alive && sh.crew.length) {
      stayAbroad(u, makeCtx(u, here), sh, def, home?.name ?? 'a lost world');
      sh.log.push(`${home?.name ?? 'Home'} was gone: they stayed on ${here.name}.`);
    }
    // (still aboard: an outpost sealed in its ship, which lives on day by day)
    if (!sh.crew.length) { sh.phase = 'done'; sh.t0 = u.tick; sh.t1 = -1; }
    return;
  }
  // the fuel kept for it burns now
  sh.fuelBack = [];
  sh.from = here.id;
  sh.to = home.id;
  sh.padPos = [sh.dest[0], sh.dest[1], sh.dest[2]];
  sh.padCell = sh.destCell;
  sh.padBuilding = -1;
  sh.destCell = -1;
  sh.destSettlement = sh.owner;
  sh.phase = 'ascent';
  sh.t0 = u.tick;
  sh.t1 = u.tick + (def.class === 'air' ? AIR_CLIMB_TICKS : ASCENT_TICKS);
  sh.lastDay = 0;
  if (def.class === 'gate') { beginTransfer(u, sh, def); return; }
  if (def.class !== 'air') planOrbit(u, sh, here, sh.t1);
  else {
    const xh = makeCtx(u, home);
    const site = landingSite(u, xh, { ...sh, purpose: 'return' });
    sh.destCell = site.cell; sh.dest = cellDir(xh, site.cell); sh.destSettlement = site.settlement;
  }
  sh.log.push(`Bound for home from ${here.name}.`);
  u.emit({ t: 'launch', planet: here.id, pos: [...sh.padPos] as V3, ref: { kind: 'ship', id: sh.id, planet: here.id }, text: sh.name, a: sh.crew.length, data: { kind: sh.kind, to: home.id, purpose: 'return' } });
}

/**
 * Turn back between the worlds (the god forbids the crossing): a fresh curve from where it is now to above its own
 * town, as long as it has flown so far (at least half a day).
 */
export function turnBack(u: Universe, sh: ShipState, def: ShipKindDef): boolean {
  if (sh.phase !== 'transfer' || def.class === 'air' || def.class === 'gate') return false;
  const home = u.planet(sh.home);
  if (!home || !home.alive) return false;
  const w = shipWhere(u, sh, u.tick, def.class);
  const flown = Math.max(DAY / 2, u.tick - sh.t0);
  sh.returning = true;
  sh.from = sh.to >= 0 ? sh.to : sh.from;
  sh.to = home.id;
  const xh = makeCtx(u, home);
  const site = landingSite(u, xh, { ...sh, purpose: 'return' });
  sh.destCell = site.cell; sh.dest = cellDir(xh, site.cell); sh.destSettlement = site.settlement;
  const t1 = u.tick + flown;
  const p3 = bodyToSystem(u, home, t1, sh.dest, home.st.radius + sh.altitude);
  const v1 = velocityOf(u, home, t1);
  const k = flown / 3;
  sh.bez = [[w.sys[0], w.sys[1], w.sys[2]], [w.sys[0], w.sys[1], w.sys[2]], [p3[0] - v1[0] * k, p3[1] - v1[1] * k, p3[2] - v1[2] * k], [p3[0], p3[1], p3[2]]];
  sh.t0 = u.tick;
  sh.t1 = t1;
  sh.launchTick = u.tick;
  sh.arriveTick = t1;
  sh.lastDay = 0;
  sh.log.push('Turned back for home.');
  return true;
}

/** the ship is lost in `phase`: all aboard die; a fall near the ground burns where it falls */
export function lose(u: Universe, sh: ShipState, def: ShipKindDef, phase: string): void {
  const w = shipWhere(u, sh, u.tick, def.class);
  sh.lostIn = phase;
  sh.lostAt = { planet: w.planet, pos: [w.pos[0], w.pos[1], w.pos[2]], alt: w.alt, sys: [w.sys[0], w.sys[1], w.sys[2]] };
  sh.cause = failureWords(u, sh, phase, def.class);
  const dead = sh.crew.length;
  sh.dead += dead;
  sh.crew = [];
  sh.cargo = [];
  sh.fuelBack = [];
  sh.phase = 'lost';
  sh.t0 = u.tick;
  sh.t1 = u.tick + 3 * DAY;
  sh.outcome = 'lost';
  sh.log.push(`Lost (${phase}: ${sh.cause}).`);
  const home = u.planet(sh.home);
  const where = phase === 'descent' ? u.planet(sh.to) : u.planet(sh.from);
  // a fall near the ground: fire and harm where it comes down, the pad wrecked
  if (where && where.alive && (phase === 'pad' || phase === 'ascent' || phase === 'descent' || def.class === 'air')) {
    const at = phase === 'descent' ? sh.dest : phase === 'pad' ? sh.padPos : (w.planet === where.id ? w.pos : sh.padPos);
    const r = phase === 'pad' ? 60 : 40;
    if (where.airy) igniteArea(u, where, at, r, 0.7);
    harmArea(u, where, at, r * 1.5, 0.6, DEATH.fire);
    if (phase === 'pad' && sh.padBuilding >= 0) {
      const b = where.people.building(sh.padBuilding);
      if (b) b.damage = Math.min(1, b.damage + 0.5);
    }
  }
  const tellOn = where && where.alive ? where : home && home.alive ? home : u.planets.find((q) => q.alive);
  if (tellOn) {
    const x = makeCtx(u, tellOn);
    const st = home ? home.people?.settlement(sh.owner) : undefined;
    const v = vars(x, st ?? null, -1, {
      ship: kindName(x, sh), name: sh.name, count: dead, cause: sh.cause, home: home?.name ?? 'home', planet: u.planet(sh.to)?.name ?? '',
      settlement: st?.name ?? sh.ownerName,
    });
    const id = def.class === 'air' ? 'space.lost.air' : `space.lost.${phase}`;
    tell(u, tellOn, id, v, tellOn === home ? st ?? null : null, [{ kind: 'ship', id: sh.id, planet: tellOn.id }]);
  }
  u.emit({ t: 'ship.lost', planet: w.planet, pos: w.planet >= 0 ? [...w.pos] as V3 : undefined, ref: { kind: 'ship', id: sh.id }, text: sh.name, a: dead, data: { phase, cause: sh.cause, sys: [...w.sys] } });
}

/**
 * Called home before it set out (the world it was bound for is gone while it still circles its own): it comes down by
 * its own town from where it is, and its crew walk home.
 */
export function comeDown(u: Universe, sh: ShipState, def: ShipKindDef, why: string): void {
  const home = u.planet(sh.from);
  if (!home || !home.alive) return;
  const w = shipWhere(u, sh, u.tick, def.class);
  const xh = makeCtx(u, home);
  sh.descFrom = w.planet === home.id ? [w.pos[0], w.pos[1], w.pos[2]] : null;
  sh.returning = true;
  sh.to = home.id;
  sh.fuelBack = [];
  const site = landingSite(u, xh, { ...sh, purpose: 'return' });
  sh.destCell = site.cell; sh.dest = cellDir(xh, site.cell); sh.destSettlement = site.settlement;
  sh.phase = 'descent';
  sh.t0 = u.tick;
  sh.t1 = u.tick + DESCENT_TICKS;
  sh.log.push(`Called back down to ${home.name}: ${why}.`);
  u.emit({ t: 'ship.recalled', planet: home.id, ref: { kind: 'ship', id: sh.id, planet: home.id }, text: sh.name, data: { why } });
}

/** how far (m) the place a ship's curve ends has drifted from where its target will now be at the arrival tick */
function courseDrift(u: Universe, sh: ShipState, to: { st: { radius: number } } & Parameters<typeof bodyToSystem>[1]): number {
  const p3 = bodyToSystem(u, to, sh.t1, sh.dest, to.st.radius + sh.altitude, [0, 0, 0]);
  const e = sh.bez[3];
  return Math.hypot(p3[0] - e[0], p3[1] - e[1], p3[2] - e[2]);
}

/**
 * Set the course again from where the ship is now (its target's orbit changed): a fresh curve from its present place
 * and velocity to the target's new predicted place at the same arrival tick — no jump, no kink.
 */
function replanTransfer(u: Universe, sh: ShipState, to: Parameters<typeof bodyToSystem>[1]): void {
  const t = u.tick;
  const T = Math.max(1, sh.t1 - t);
  const f = Math.max(0, Math.min(1, (t - sh.t0) / Math.max(1, sh.t1 - sh.t0)));
  const P = sh.bez;
  // where it is and how fast it goes (the curve's derivative, per tick)
  const g = 1 - f, span = Math.max(1, sh.t1 - sh.t0);
  const p0: V3 = [0, 0, 0], v0: V3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    p0[k] = g * g * g * P[0][k] + 3 * g * g * f * P[1][k] + 3 * g * f * f * P[2][k] + f * f * f * P[3][k];
    v0[k] = (3 * g * g * (P[1][k] - P[0][k]) + 6 * g * f * (P[2][k] - P[1][k]) + 3 * f * f * (P[3][k] - P[2][k])) / span;
  }
  const p3 = bodyToSystem(u, to, sh.t1, sh.dest, to.st.radius + sh.altitude, [0, 0, 0]);
  const v1 = velocityOf(u, to, sh.t1);
  const k = T / 3;
  sh.bez = [p0, [p0[0] + v0[0] * k, p0[1] + v0[1] * k, p0[2] + v0[2] * k], [p3[0] - v1[0] * k, p3[1] - v1[1] * k, p3[2] - v1[2] * k], [p3[0], p3[1], p3[2]]];
  sh.t0 = t;
}

/** the world the ship was bound for is gone: it drifts on, its people living on what they carry */
export function strand(u: Universe, sh: ShipState, def: ShipKindDef, why: string): void {
  if (sh.phase === 'stranded' || sh.phase === 'lost' || sh.phase === 'done') return;
  const w = shipWhere(u, sh, u.tick, def.class);
  sh.lostAt = { planet: -1, pos: [w.sys[0], w.sys[1], w.sys[2]], alt: 0, sys: [w.sys[0], w.sys[1], w.sys[2]] };
  // it drifts on in a straight line at the speed it had (bez = [where, velocity per tick])
  const w1 = shipWhere(u, sh, u.tick + 1, def.class);
  const moving = sh.phase === 'transfer' && sh.bez.length >= 4;
  sh.bez = [[w.sys[0], w.sys[1], w.sys[2]], moving ? [w1.sys[0] - w.sys[0], w1.sys[1] - w.sys[1], w1.sys[2] - w.sys[2]] : [0, 0, 0]];
  sh.phase = 'stranded';
  sh.t0 = u.tick;
  sh.t1 = -1;
  sh.cause = why;
  sh.outcome = 'stranded';
  sh.log.push(`Stranded: ${why}.`);
  const tellOn = u.planet(sh.home)?.alive ? u.planet(sh.home)! : u.planets.find((q) => q.alive);
  if (tellOn) {
    const x = makeCtx(u, tellOn);
    tell(u, tellOn, 'space.stranded', vars(x, null, -1, { ship: kindName(x, sh), name: sh.name, count: sh.crew.length, planet: u.planet(sh.to)?.name ?? 'its world' }), null, [{ kind: 'ship', id: sh.id }]);
  }
  u.emit({ t: 'ship.stranded', ref: { kind: 'ship', id: sh.id }, text: sh.name, a: sh.crew.length });
}

// ───────────────────────────── life aboard ─────────────────────────────

/** a day between the worlds: everyone eats from the stores; sickness spreads aboard; on the long ships, children */
export function aboardDaily(u: Universe, sh: ShipState, def: ShipKindDef): void {
  const n = sh.crew.length;
  if (!n) return;
  const c = u.content;
  const day = Math.floor((u.tick - Math.max(0, sh.launchTick)) / DAY);
  // food
  sh.food = Math.round((sh.food - n) * 100) / 100;
  const hungry = sh.food < 0;
  if (hungry) sh.food = 0;
  let starved = 0, sick = 0;
  let sickName = '';
  const keep: CrewMember[] = [];
  // sickness: the infectious share aboard
  let inf = 0;
  for (const m of sh.crew) if (m.disease >= 0 && u.tick >= m.infectT) inf++;
  const medicine = c.items.idx('medicine');
  for (const m of sh.crew) {
    if (hungry) {
      m.needs[FOOD] = 0;
      m.health = Math.round((m.health - 0.16) * 1000) / 1000;
      if (m.health <= 0) { starved++; continue; }
    } else {
      m.needs[FOOD] = Math.max(m.needs[FOOD], 0.75);
      m.needs[WATER] = Math.max(m.needs[WATER], 0.75);
      m.health = Math.min(1, m.health + 0.05);
    }
    // catching it in close quarters
    if (m.disease < 0 && inf > 0) {
      for (const d of diseasesAboard(sh, u.tick)) {
        const dd = c.diseases.list[d];
        if (!dd || (d < 32 && m.immune & (1 << d))) continue;
        if (dd.species && !dd.species.includes(c.species.list[m.species]?.id ?? '')) continue;
        if (hashFloat(m.id, d, day, 0xab0a) < Math.min(0.9, dd.contagion * 3 * (inf / n))) { infectRecord(u, m, d); break; }
      }
    }
    // the course of an illness aboard
    if (m.disease >= 0 && u.tick >= m.sickEnd) {
      const d = m.disease;
      const dd = c.diseases.list[d];
      let relief = 1;
      if (medicine >= 0 && takeCargo(sh, medicine, 1) >= 1) relief = 0.4;
      const fatal = hashFloat(m.id, d, 0x9a7e) < Math.min(0.9, (dd?.mortality ?? 0) * 2.5) * relief;
      if (fatal) { sick++; sickName = dd?.name ?? 'a sickness'; continue; }
      if (dd && hashFloat(m.id, d, day, 0x1a3) < dd.immunity && d < 32) m.immune = (m.immune | (1 << d)) >>> 0;
      m.disease = -1;
      m.flags &= ~AgentFlag.sick;
    }
    keep.push(m);
  }
  // children born on the long ships (couples aboard; a few a year)
  if (def.crew[1] >= 40) {
    for (const mom of keep.slice()) {
      if (!(mom.flags & AgentFlag.female) || mom.flags & (AgentFlag.child | AgentFlag.elder) || !mom.partner) continue;
      const dad = keep.find((q) => q.id === mom.partner);
      if (!dad) continue;
      const sp = c.species.list[mom.species];
      if (!sp || sp.hive) continue;
      if (hashFloat(mom.id, day, 0xb1b) >= Math.min(0.5, sp.fertility / Math.max(4, 12))) continue;
      keep.push(childOf(u, sh, mom, dad, day));
      sh.born++;
    }
  }
  const died = starved + sick;
  sh.dead += died;
  sh.crew = keep;
  if (!died) return;
  const home = u.planet(sh.home);
  const tellOn = home && home.alive ? home : u.planets.find((q) => q.alive);
  if (!tellOn) return;
  const x = makeCtx(u, tellOn);
  // (an outpost sealed in its ship on a world's ground is told as such, not as a death between the worlds)
  const ground = sh.phase === 'landed' ? u.planet(sh.to)?.name ?? '' : '';
  if (starved) tell(u, tellOn, ground ? 'space.outpost.starved' : 'space.starved', vars(x, null, -1, { ship: kindName(x, sh), name: sh.name, count: starved, planet: ground }), null, [{ kind: 'ship', id: sh.id }]);
  if (sick) tell(u, tellOn, ground ? 'space.outpost.sick' : 'space.sick', vars(x, null, -1, { ship: kindName(x, sh), name: sh.name, count: sick, disease: sickName.toLowerCase(), planet: ground }), null, [{ kind: 'ship', id: sh.id }]);
  sh.log.push(`${died} died aboard on day ${day}.`);
}

function diseasesAboard(sh: ShipState, tick: number): number[] {
  const out: number[] = [];
  for (const m of sh.crew) if (m.disease >= 0 && tick >= m.infectT && !out.includes(m.disease)) out.push(m.disease);
  return out.sort((a, b) => a - b);
}

/** a child born aboard: the everyday knowledge of its parents, their faith */
function childOf(u: Universe, sh: ShipState, mom: CrewMember, dad: CrewMember, day: number): CrewMember {
  const id = u.ids.alloc('agent');
  const rt = u.content.recipes.list;
  const know = mom.know.filter((k) => dad.know.includes(k) && rt[k] && (rt[k].teach ?? 0.3) <= 0.15);
  const female = hashFloat(id, 0x5e8) < 0.5;
  const traits = mom.traits.map((t, i) => Math.round(((t + (dad.traits[i] ?? t)) / 2) * 1000) / 1000);
  return {
    id, species: mom.species, flags: AgentFlag.child | (female ? AgentFlag.female : 0), caste: 0, birth: u.tick, name: id >>> 0, custom: '',
    traits, skills: mom.skills.map(() => 0.02), needs: new Array(NN).fill(0.85), health: 1, know,
    disease: -1, infectT: 0, sickEnd: 0, immune: mom.immune & dad.immune, love: mom.love.slice(), fear: mom.fear.slice(),
    mother: mom.id, father: dad.id, partner: 0, gear: -1, tool: -1, role: ROLE.child, mem: [[MEMK.born, u.tick, sh.id]],
  };
  void day;
}

/** the ships of a settlement still on the ground at home (programs) */
export function programsOf(u: Universe, planet: number, settlement: number): ShipState[] {
  return u.space.ships.filter((sh) => sh.home === planet && sh.owner === settlement && (sh.phase === 'building' || sh.phase === 'fuelling' || sh.phase === 'boarding' || sh.phase === 'pad'));
}

export { stKey };
