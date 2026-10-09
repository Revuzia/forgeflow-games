// GENESIS — disasters (CONTRACT.md §11.3): live entities composed of EFFECTORS (disasters.json):
//
//   impact  a falling body strikes: crater (terrain brush), shock (people, buildings, herds by distance), a ring of fire,
//           dust into the sky (impact winter), ejecta craters, meteor iron on the ground (an accident trigger: iron
//           working), a wave when it lands in the sea
//   area    field modifiers over time inside the radius: temperature (the climate's energy state), drying, aquifer
//           drain, plants and crops withering, acid, radiation, deposits (ash, sand, snow), lava, a weather system kept
//           over it, harm and damage per step, growth (overgrowth), forgetting (the forgetting fog)
//   front   a moving region (tornado track, swarm, firestorm, a monster on the coast): wrecks, uproots, eats crops and
//           stores, lifts people into the air (they fall where the wind drops them)
//   spread  contagion over cells and people: wildfire frontier, plague seeded settlement to settlement, blight,
//           infestation of fields and granaries
//   quake   shaking: buildings fall by material (mudbrick before stone), landslides, rifts with lava in their floor,
//           sinkholes, a tsunami when the epicentre is at sea
//   water   flood / tsunami / storm surge / tides: volume impulses with momentum (hydrology does the rest)
//   global  planet parameters ramped in and out over the life (dust, light, gravity, magnetism, star activity,
//           temperature, toxicity, eccentricity) and restored exactly when it ends or is cancelled
//   spawn   entities: herds (locusts, vermin), a shower of small meteors, a falling moon (it is erased when it strikes),
//           a rogue world passing
//
// Every live disaster can be CANCELLED (end effectors never fire, globals restored, its weather lifted), SCALED (radius
// × √k, strength × k), MOVED (to a point, or given a velocity) and FROZEN (no ageing, no motion, no effects) — mid-flight.
// Consequences: deaths and ruins are tallied for the chronicle; settlements that lost most of their buildings send
// refugees; famines follow lost crops and stores through the peoples' own economy; witnesses near are afraid and far
// ones awed; the kind's triggers fire as accidents (meteor iron teaches iron working). Natural disasters happen on
// their own where the conditions hold (volcanic provinces erupt, rift zones quake, dry farmland sees drought).
//
// Cadence: every tick for live disasters (cheap when there are none); effectors on their own `every`; natural rolls
// once a planet-day. Randomness is stateless (hash of disaster id, tick, salt): the same log gives the same disasters.

import type { Universe } from '../world/universe.ts';
import { meanAnomaly } from '../world/orbits.ts';
import type { Planet } from '../world/planet.ts';
import type { DisasterDef, EffectorDef } from '../content.ts';
import type { DisasterView } from '../types.ts';
import type { DisasterState, V3 } from './state.ts';
import { brush } from '../fields/terrain.ts';
import { waterImpulse } from '../fields/hydrology.ts';
import { igniteArea, igniteCell, fuelAt } from '../fields/fire.ts';
import { paintWeather } from '../fields/weather.ts';
import { hashFloat, hash32 } from '../core/rng.ts';
import { makeCtx } from '../people/ctx.ts';
import { DEATH, NT } from '../people/defs.ts';
import { dropItem } from '../people/people.ts';
import { accident, silence } from '../people/knowledge.ts';
import { refugees } from '../people/culture.ts';
import { abandon } from '../people/settlement.ts';
import { seedDisease } from '../life/disease.ts';
import { blightAt } from '../life/plants.ts';
import { animalIdx, spawnHerd, habitatFit } from '../life/herds.ts';
import { introduceSpecies } from '../life/ecology.ts';
import { storeTake } from '../people/store.ts';
import { tell } from '../people/story.ts';
import { settlementRef, vars } from '../people/util.ts';
import { distM } from '../people/world.ts';
import { BuildingFlag } from '../types.ts';
import { godAct } from './belief.ts';
import { hurtPeople, hurtHerds, shielded, stripPlants, wreckBuildings } from './harm.ts';
import { launch } from './projectiles.ts';
import { bearingDir, cellPos3, clamp, frame, herePos, moveBy, nearestSettlement, norm, placeName, r3, tangent } from './util.ts';

// ───────────────────────────── spawning ─────────────────────────────

export interface SpawnOpts {
  pos?: ArrayLike<number> | null;
  radius?: number;
  intensity?: number;
  scale?: number;
  /** ticks (overrides the kind's life; -1 = until cancelled) */
  life?: number;
  god?: number;
  cause?: string;
  /** a front heads toward this point */
  toward?: ArrayLike<number> | null;
  /** a heading (rad, 0 north) for fronts */
  heading?: number;
  /** a body to fall (moon-fall: a moon planet id) */
  target?: number;
  /** do not write the start to the chronicle (natural minor ones) */
  quiet?: boolean;
}

const START = 'start';

/** effective radius / strength of a disaster (the player scales both) */
export function effR(d: DisasterState): number {
  return d.radius * Math.sqrt(Math.max(0.01, d.scale));
}
export function effI(d: DisasterState): number {
  return d.intensity * d.scale;
}

function defOf(u: Universe, d: DisasterState): DisasterDef {
  return u.content.disasters.find(d.kind) ?? u.content.disasters.list[0];
}

/** create a live disaster of `kind` on planet p; returns it, or a reason it cannot be */
export function spawnDisaster(u: Universe, p: Planet, kind: string, o: SpawnOpts = {}): DisasterState | string {
  const def = u.content.disasters.find(kind);
  if (!def) return `There is no disaster called '${kind}'.`;
  const id = u.ids.alloc('disaster');
  const pos = norm(o.pos ?? herePos(u, p));
  const salt = hash32(id, u.tick, 0xd15a);
  let life = o.life ?? (def.lifeYears ? Math.round(def.lifeYears * p.st.orbit.period) : Math.round(def.life[0] + (def.life[1] - def.life[0]) * hashFloat(salt, 1)));
  if (def.life[0] < 0 && o.life === undefined && !def.lifeYears) life = -1;
  const d: DisasterState = {
    id, kind: def.id, planet: p.id, pos, vel: [0, 0, 0], dir: [0, 0, 0],
    radius: o.radius ?? def.radius, intensity: o.intensity ?? def.intensity, scale: o.scale ?? 1,
    age: 0, life, frozen: false, god: o.god ?? 0, cause: o.cause ?? 'god', seed: salt, fired: [], st: {}, cells: [],
    params: { ...def.render }, target: o.target ?? -1, dead: 0, ruined: 0,
  };
  // fronts and storms walk: toward a point, on a heading, else with the wind (or a hashed heading on a still world)
  const speed = def.speed ?? 0;
  if (speed > 0) {
    let dir: V3;
    if (o.toward) dir = norm(tangent(pos, [o.toward[0] - pos[0], o.toward[1] - pos[1], o.toward[2] - pos[2]]));
    else if (o.heading !== undefined) dir = bearingDir(pos, o.heading);
    else {
      const c = p.cellAt(pos);
      const w: V3 = [p.f.windX[c], p.f.windY[c], p.f.windZ[c]];
      dir = Math.hypot(w[0], w[1], w[2]) > 0.5 ? norm(tangent(pos, w)) : bearingDir(pos, hashFloat(salt, 2) * Math.PI * 2);
    }
    const k = speed / p.st.radius;
    d.vel = [dir[0] * k, dir[1] * k, dir[2] * k];
  }
  // a falling body comes in at a slant from a hashed bearing
  if (def.render.alt !== undefined) {
    const b = bearingDir(pos, hashFloat(salt, 3) * Math.PI * 2);
    const down = 0.55 + 0.35 * hashFloat(salt, 4);
    d.dir = norm([b[0] * (1 - down) - pos[0] * down, b[1] * (1 - down) - pos[1] * down, b[2] * (1 - down) - pos[2] * down]);
    d.params.dirX = r3(d.dir[0]); d.params.dirY = r3(d.dir[1]); d.params.dirZ = r3(d.dir[2]);
    d.st.alt0 = def.render.alt;
  }
  u.god.disasters.push(d);
  u.god.disasters.sort((a, b) => a.id - b.id);
  u.god.stat('disasters');
  // what happens at once
  def.effectors.forEach((e, i) => { if (e.at === START) { d.fired.push(i); applyEffector(u, p, d, def, e, i); } });
  updateParams(u, p, d, def);
  u.emit({ t: 'disaster', planet: p.id, pos: [...pos], a: effR(d), b: effI(d), text: def.name, ref: { kind: 'disaster', id, planet: p.id }, data: { kind: def.id, id, god: d.god, cause: d.cause, life } });
  // the people far and wide see it coming (awe at a distance; fear is per hour of it, near)
  if (def.witness?.wonder) godAct(u, p, pos, effR(d) * 5, { wonder: def.witness.wonder * 0.5 }, Math.max(0, d.god));
  if (!o.quiet) {
    const by = d.god > 0 ? ` (sent by ${u.god.god(d.god)?.name ?? 'a rival god'})` : d.god === 0 && d.cause === 'god' ? '' : '';
    u.chronicleAdd(p, 'disaster', `${def.name} ${placeName(p, pos)}${by}.`, def.radius >= 800 || ['meteor', 'comet', 'supervolcano', 'moon-fall', 'eclipse', 'ice-age'].includes(def.id) ? 2 : 1, [{ kind: 'disaster', id, planet: p.id }]);
  }
  return d;
}

// ───────────────────────────── the live controls ─────────────────────────────

export function cancelDisaster(u: Universe, d: DisasterState, why = 'cancelled'): void {
  const p = u.planet(d.planet);
  if (p) cleanup(u, p, d);
  u.god.disasters = u.god.disasters.filter((x) => x !== d);
  u.emit({ t: 'disaster.end', planet: d.planet, pos: [...d.pos], text: why, ref: { kind: 'disaster', id: d.id, planet: d.planet }, data: { kind: d.kind, why } });
}

export function scaleDisaster(d: DisasterState, k: number): void {
  d.scale = clamp(d.scale * k, 0.05, 50);
}

export function moveDisaster(u: Universe, d: DisasterState, pos: ArrayLike<number> | null, vel: ArrayLike<number> | null, speed?: number): void {
  const p = u.planet(d.planet);
  if (pos) {
    const np = norm(pos);
    // a moving front keeps its speed, now heading from the new place on
    d.pos = np;
    for (const k of Object.keys(d.st)) if (k.startsWith('w')) { const w = p?.weather.find((x) => x.id === d.st[k]); if (w) w.pos = [...np]; }
  }
  if (vel && p) {
    const t = norm(tangent(d.pos, vel));
    const v = (speed ?? (Math.hypot(d.vel[0], d.vel[1], d.vel[2]) * p.st.radius || 5)) / p.st.radius;
    d.vel = [t[0] * v, t[1] * v, t[2] * v];
  } else if (speed !== undefined && p) {
    const cur = Math.hypot(d.vel[0], d.vel[1], d.vel[2]);
    const t = cur > 1e-12 ? [d.vel[0] / cur, d.vel[1] / cur, d.vel[2] / cur] : bearingDir(d.pos, 0);
    d.vel = [t[0] * speed / p.st.radius, t[1] * speed / p.st.radius, t[2] * speed / p.st.radius];
  }
}

export function freezeDisaster(d: DisasterState, on: boolean): void {
  d.frozen = on;
}

// ───────────────────────────── stepping ─────────────────────────────

/** every tick: age, move, act, end */
export function disastersStep(u: Universe): void {
  const list = u.god.disasters;
  if (!list.length) return;
  for (const d of list.slice()) {
    const p = u.planet(d.planet);
    if (!p || !p.alive) { u.god.disasters = u.god.disasters.filter((x) => x !== d); continue; }
    if (d.frozen) continue;
    const def = defOf(u, d);
    d.age++;
    const vl = Math.hypot(d.vel[0], d.vel[1], d.vel[2]);
    if (vl > 0) {
      d.pos = norm([d.pos[0] + d.vel[0], d.pos[1] + d.vel[1], d.pos[2] + d.vel[2]]);
      // keep the velocity tangent where we are now
      const t = tangent(d.pos, d.vel);
      const tl = Math.hypot(t[0], t[1], t[2]) || 1;
      d.vel = [(t[0] / tl) * vl, (t[1] / tl) * vl, (t[2] / tl) * vl];
    }
    def.effectors.forEach((e, i) => {
      if (e.at === START || e.at === 'end') return;
      if (typeof e.at === 'number') {
        if (!d.fired.includes(i) && d.life > 0 && d.age >= e.at * d.life) { d.fired.push(i); applyEffector(u, p, d, def, e, i); }
        return;
      }
      const every = Math.max(1, Math.round((e.every as number | undefined) ?? (e.type === 'global' ? 10 : e.type === 'front' ? 5 : 10)));
      // the first round comes at once (a plague does not wait a quarter-day to begin), then on its cadence
      if (d.age === 1 || (d.age + i) % every === 0) applyEffector(u, p, d, def, e, i);
    });
    updateParams(u, p, d, def);
    // sustained fear near it, hourly
    if (d.age % 60 === 0 && def.witness?.harm) godAct(u, p, d.pos, effR(d) * 1.6, { harm: def.witness.harm * 0.25 }, Math.max(0, d.god));
    if (d.life > 0 && d.age >= d.life) finish(u, p, d, def);
  }
}

function finish(u: Universe, p: Planet, d: DisasterState, def: DisasterDef): void {
  def.effectors.forEach((e, i) => { if (e.at === 'end' && !d.fired.includes(i)) { d.fired.push(i); applyEffector(u, p, d, def, e, i); } });
  cleanup(u, p, d);
  u.god.disasters = u.god.disasters.filter((x) => x !== d);
  consequences(u, p, d, def);
  u.emit({ t: 'disaster.end', planet: p.id, pos: [...d.pos], a: d.dead, b: d.ruined, text: 'ended', ref: { kind: 'disaster', id: d.id, planet: p.id }, data: { kind: d.kind, dead: d.dead, ruined: d.ruined } });
}

/** undo what must not outlive it: planet parameters, the weather it kept */
function cleanup(u: Universe, p: Planet, d: DisasterState): void {
  restoreGlobals(u, p, d);
  for (const k of Object.keys(d.st)) {
    if (!k.startsWith('w')) continue;
    const id = d.st[k];
    p.weather = p.weather.filter((w) => w.id !== id);
  }
}

/** after it ends: the toll in the chronicle, refugees from the ruined, the god's name on it */
function consequences(u: Universe, p: Planet, d: DisasterState, def: DisasterDef): void {
  if (d.dead > 0 || d.ruined > 0) {
    const st = nearestSettlement(p, d.pos, effR(d) * 3 + 800);
    const toll = [d.dead ? `${d.dead} dead` : '', d.ruined ? `${d.ruined} building${d.ruined === 1 ? '' : 's'} in ruins` : ''].filter((s) => s).join(', ');
    const text = `${def.name} ${st ? `struck ${st.name}` : placeName(p, d.pos)}: ${toll}.`;
    if (st) tell(u, p, 'disaster.toll', { text, settlement: st.name, disaster: def.name.toLowerCase(), count: d.dead, building: d.ruined }, st, [settlementRef(makeCtx(u, p), st)], d.dead >= 10 || d.ruined >= 5 ? 3 : 2);
    else u.chronicleAdd(p, 'disaster', text, d.dead >= 10 ? 3 : 2);
  }
  // the ruined send their homeless away; those who stay rebuild (the settlement's own builders do it)
  if (!p.people || !p.people.settlements.length) return;
  const x = makeCtx(u, p);
  for (const st of x.ps.settlements.slice()) {
    if (st.fallen >= 0 || st.band || distM(p, st.pos, d.pos) > effR(d) * 2.5 + st.territory) continue;
    // the place itself is gone — under water, under lava, a pit: the survivors leave to found anew elsewhere
    const c = st.cell;
    const drowned = p.f.water[c] > 0.4 || !!p.s.ocean[c];
    if (drowned || p.f.lava[c] > 0.05 || p.f.surface[c] < p.st.seaLevel - 0.2) {
      if ((x.ps.members.get(st.id)?.length ?? 0) > 0) { abandon(x, st, drowned ? 'flood' : 'disaster'); continue; }
    }
    const bs = x.ps.of(st.id).filter((b) => b.progress >= 1);
    if (bs.length < 3) continue;
    const ruined = bs.filter((b) => b.flags & BuildingFlag.ruined).length;
    if (ruined / bs.length >= 0.5) {
      const n = refugees(x, st, st.polity);
      if (n > 0) accident(x, st, 'refugees', st.cell);
    }
    if (ruined > 0) { st.recent.rebuild = x.tick; accident(x, st, 'rebuild', st.cell); }
  }
}

// ───────────────────────────── render parameters ─────────────────────────────

function updateParams(u: Universe, p: Planet, d: DisasterState, def: DisasterDef): void {
  const prog = d.life > 0 ? clamp(d.age / d.life, 0, 1) : 0;
  const P = d.params;
  if (d.st.alt0 !== undefined) P.alt = Math.round(d.st.alt0 * (1 - prog) * (1 - prog * 0.0));
  if (def.render.plume !== undefined) P.plume = Math.round(def.render.plume * Math.sqrt(effI(d)) * (prog < 0.1 ? prog / 0.1 : prog > 0.8 ? (1 - prog) / 0.2 : 1));
  if (def.render.height !== undefined && def.id === 'tornado') P.height = Math.round(def.render.height * (0.85 + 0.15 * Math.sin(d.age * 0.3)) * Math.sqrt(effI(d)));
  if (def.render.magnitude !== undefined) P.magnitude = r3(def.render.magnitude + Math.log2(Math.max(0.1, effI(d))));
  if (def.render.coverage !== undefined) P.coverage = r3(def.render.coverage * envelope(d, 0.04));
  if (def.render.activity !== undefined) P.activity = r3(Math.min(1, u.star.activity));
  if (def.render.dist !== undefined) P.dist = Math.round(def.render.dist * (0.3 + 1.4 * Math.abs(prog - 0.5)));
  if (def.render.width !== undefined) P.width = Math.round(def.render.width * Math.sqrt(d.scale));
  P.radius = Math.round(effR(d));
  P.intensity = r3(effI(d));
  if (def.id === 'moon-fall' && d.target >= 0) spiralMoon(u, p, d, prog);
}

/**
 * A falling moon spirals in: its orbit shrinks toward a grazing one (faster at the end), its month shortens by
 * Kepler's law, and it keeps its place on its orbit (the mean anomaly is carried over), so it never jumps in the sky.
 */
function spiralMoon(u: Universe, p: Planet, d: DisasterState, prog: number): void {
  const moon = u.planet(d.target);
  if (!moon || !moon.alive || moon.st.orbit.parent !== p.id) return;
  const o = moon.st.orbit;
  if (d.st.a0 === undefined) { d.st.a0 = o.a; d.st.T0 = o.period; }
  const aEnd = p.st.radius * 1.2 + moon.st.radius;
  const a = d.st.a0 + (aEnd - d.st.a0) * prog * prog;
  const M = meanAnomaly(o, u.tick);
  o.a = Math.round(a * 1000) / 1000;
  o.period = Math.max(30, d.st.T0 * Math.pow(a / Math.max(1, d.st.a0), 1.5));
  o.phase0 = M - (2 * Math.PI * u.tick) / o.period;
  d.params.moonAlt = Math.round(a - p.st.radius);
}

/** 0..1 ramp in over the first `ramp` share of life, out over the last */
function envelope(d: DisasterState, ramp: number): number {
  if (d.life <= 0) return clamp(d.age / Math.max(1, ramp * 2880), 0, 1);
  const t = d.age / d.life;
  if (ramp <= 0) return 1;
  if (t < ramp) return t / ramp;
  if (t > 1 - ramp) return Math.max(0, (1 - t) / ramp);
  return 1;
}

// ───────────────────────────── effectors ─────────────────────────────

function applyEffector(u: Universe, p: Planet, d: DisasterState, def: DisasterDef, e: EffectorDef, i: number): void {
  const before = p.people ? p.people.agents.count : 0;
  switch (e.type) {
    case 'impact': impact(u, p, d, def, e); break;
    case 'area': area(u, p, d, e, i); break;
    case 'front': front(u, p, d, e, i); break;
    case 'spread': spread(u, p, d, e); break;
    case 'quake': quake(u, p, d, def, e); break;
    case 'water': water(u, p, d, e); break;
    case 'global': globalFx(u, p, d, e); break;
    case 'spawn': spawn(u, p, d, def, e); break;
  }
  if (p.people) d.dead += Math.max(0, before - p.people.agents.count);
}

const num = (e: EffectorDef, k: string, dflt = 0): number => (typeof e[k] === 'number' ? (e[k] as number) : dflt);

function ruinsCount(p: Planet): number {
  let n = 0;
  for (const b of p.people?.buildings ?? []) if (b.flags & BuildingFlag.ruined) n++;
  return n;
}

/** fire the kind's triggers (accidents) at settlements within reach */
function triggers(u: Universe, p: Planet, d: DisasterState, def: DisasterDef, reach: number, extra: string[] = []): void {
  const list = [...(def.triggers ?? []), ...extra];
  if (!list.length || !p.people?.settlements.length) return;
  const x = makeCtx(u, p);
  const c = p.cellAt(d.pos);
  for (const st of x.ps.settlements) {
    if (st.fallen >= 0 || distM(p, st.pos, d.pos) > reach + st.territory) continue;
    for (const t of list) accident(x, st, t, c);
  }
}

function impact(u: Universe, p: Planet, d: DisasterState, def: DisasterDef, e: EffectorDef): void {
  const R = effR(d), I = effI(d);
  const pos = d.pos;
  const r0 = ruinsCount(p);
  if (shielded(u, p, pos)) {
    u.emit({ t: 'impact', planet: p.id, pos: [...pos], a: R, b: 0, text: 'shield', data: { kind: d.kind, shielded: true } });
    godAct(u, p, pos, R * 6, { wonder: 0.8 }, Math.max(0, d.god));
    return;
  }
  const c = p.cellAt(pos);
  const sea = p.s.ocean[c] && p.f.water[c] > 3;
  const craterR = R * num(e, 'craterK', 1);
  if (num(e, 'crater') > 0) crater(u, p, pos, sea ? craterR * 0.6 : craterR, num(e, 'crater') * Math.sqrt(I));
  else u.emit({ t: 'impact', planet: p.id, pos: [...pos], a: R, b: I, data: { kind: d.kind } });
  if (sea && num(e, 'sea') > 0) waterImpulse(p, pos, R * 1.6, num(e, 'sea') * Math.sqrt(I), null, -1);
  const shockR = R * num(e, 'shockK', 2);
  if (num(e, 'shock') > 0) {
    hurtPeople(u, p, pos, shockR, num(e, 'shock') * I * 0.75, DEATH.disaster, { fear: 0.4 });
    wreckBuildings(u, p, pos, shockR, num(e, 'shock') * I * 0.9, d.kind);
  }
  if (num(e, 'kill') > 0) hurtHerds(u, p, pos, shockR, num(e, 'kill') * Math.min(1, I));
  stripPlants(p, pos, shockR * 0.8, { tree: 0.6 * Math.min(1, I), shrub: 0.7, grass: 0.5, crop: 0.8 }, 0.8);
  if (num(e, 'fire') > 0 && p.airy) igniteArea(u, p, pos, R * num(e, 'fireK', 1.5), clamp(num(e, 'fire'), 0.05, 1));
  if (num(e, 'dust') > 0 && p.airy) addDust(u, p, num(e, 'dust') * Math.sqrt(I));
  const ej = Math.round(num(e, 'ejecta') * Math.min(3, Math.sqrt(I)));
  for (let k = 0; k < ej; k++) {
    const b = hashFloat(d.seed, k, 0xe1ec) * Math.PI * 2;
    const dist = R * (1.6 + 2.6 * hashFloat(d.seed, k, 0xe1ed));
    const at = moveBy(pos, bearingDir(pos, b), dist, p.st.radius);
    crater(u, p, at, Math.max(2, R * 0.14), 0.6);
  }
  if (e.iron) starIron(u, p, pos, Math.max(2, Math.round(3 * Math.sqrt(I))));
  triggers(u, p, d, def, R * 8);
  d.ruined += Math.max(0, ruinsCount(p) - r0);
  // the end of a fall: the moon that fell is gone
  if (d.target >= 0) {
    const moon = u.planet(d.target);
    if (moon && moon.alive && moon.st.orbit.parent === p.id) {
      moon.alive = false;
      u.chronicleAdd(p, 'world', `${moon.name} fell out of the sky onto ${p.name}. There is one moon fewer.`, 3);
    }
  }
  godAct(u, p, pos, shockR * 1.5, { harm: def.witness?.harm ?? 0.8 }, Math.max(0, d.god));
  godAct(u, p, pos, shockR * 8, { wonder: def.witness?.wonder ?? 0.5 }, Math.max(0, d.god));
}

/**
 * A crater of radius r (m). The terrain brush cannot draw a bowl smaller than a cell, so a crater smaller than that is
 * drawn as its cell-averaged dent: the same bowl, shallower by the area ratio (a 40 m crater on a 160 m grid is a gentle
 * hollow, not a 30 m pit that leaves the town on cliffs). The blast its hooks do is the crater's own size.
 */
function crater(u: Universe, p: Planet, pos: ArrayLike<number>, r: number, depthMul: number): void {
  const reff = Math.max(r, p.edgeM * 0.6);
  const k = Math.min(1, (r / reff) * (r / reff));
  brush(u, p, 'crater', pos, r, clamp(depthMul * k, 0.05, 5));
}

/** meteor iron: star metal lies in the crater; the settlements near it may learn to work it */
export function starIron(u: Universe, p: Planet, pos: ArrayLike<number>, qty: number): void {
  if (!p.people) return;
  const x = makeCtx(u, p);
  const it = x.c.items.idx('meteoric-iron');
  const c = p.cellAt(pos);
  if (it >= 0) dropItem(x, it, qty, [pos[0], pos[1], pos[2]], c, true);
  for (const st of x.ps.settlements) {
    if (st.fallen >= 0 || distM(p, st.pos, pos) > 1500 + st.territory) continue;
    accident(x, st, 'meteor-iron', c);
    st.recent.starIron = x.tick;
  }
}

/** aerosols the god layer added, decaying back hourly (impact dust settles out over months) */
export function addDust(u: Universe, p: Planet, k: number): void {
  p.st.atmosphere.dust = r3(Math.min(10, p.st.atmosphere.dust + k));
  const key = `dust.${p.id}`;
  u.god.stats[key] = r3((u.god.stats[key] ?? 0) + k);
}

function area(u: Universe, p: Planet, d: DisasterState, e: EffectorDef, i: number): void {
  const R = effR(d), I = effI(d);
  const f = p.f;
  const cells = p.cellsNear(d.pos, R).slice();
  const r0 = ruinsCount(p);
  const sunlit = !!e.sunlit;
  const sun = sunlit ? u.sun(p, u.tick).dir : null;
  const poleward = !!e.poleward;
  const temp = num(e, 'temp'), moist = num(e, 'moisture', 1), aq = num(e, 'aquifer'), drain = num(e, 'drain');
  const toxic = num(e, 'toxic'), rad = num(e, 'radiation'), fert = num(e, 'fertility'), roads = num(e, 'roads');
  const veg = (e.veg ?? null) as Record<string, number> | null;
  const grow = (e.grow ?? null) as Record<string, number> | null;
  const dep = (e.deposit ?? null) as { material: 'ash' | 'sand' | 'snow'; m: number } | null;
  const strip = (e.strip ?? null) as Record<string, number> | null;
  const glass = num(e, 'glass');
  let removedWater = 0, deposits = false;
  for (const c of cells) {
    const cp = cellPos3(p, c);
    if (sun && cp[0] * sun[0] + cp[1] * sun[1] + cp[2] * sun[2] <= 0) continue;
    if (poleward && Math.abs(cp[1]) < 0.5 && f.temperature[c] > 2) continue;
    if (shielded(u, p, cp)) continue;
    const dd = Math.min(1, distM(p, cp, d.pos) / Math.max(1, R));
    const w = (1 - dd * dd) * Math.min(3, I);
    if (temp) p.s.tPot[c] += temp * w;
    if (moist !== 1) { f.moisture[c] *= Math.pow(moist, w); f.humidity[c] *= Math.pow(moist, w * 0.5); }
    if (aq) f.aquifer[c] = Math.max(0, f.aquifer[c] - aq * w);
    if (drain && !p.s.ocean[c] && f.water[c] > 0) { const v = f.water[c] * Math.min(1, drain * w); f.water[c] -= v; removedWater += v * p.cellArea[c]; }
    if (veg) {
      if (veg.crop) f.crop[c] *= 1 - Math.min(1, veg.crop * w);
      if (veg.grass) f.grass[c] *= 1 - Math.min(1, veg.grass * w);
      if (veg.shrub) f.shrub[c] *= 1 - Math.min(1, veg.shrub * w);
      if (veg.tree) f.tree[c] *= 1 - Math.min(1, veg.tree * w);
    }
    if (grow && f.water[c] < 0.3) {
      if (grow.tree) f.tree[c] = Math.min(1, f.tree[c] + grow.tree * w);
      if (grow.shrub) f.shrub[c] = Math.min(1, f.shrub[c] + grow.shrub * w);
      if (grow.grass) f.grass[c] = Math.min(1, f.grass[c] + grow.grass * w);
      if (f.treeSpecies[c] < 0) f.treeSpecies[c] = u.content.plantTable.byType[2][0] ?? -1;
    }
    if (toxic) f.pollution[c] = Math.min(1, f.pollution[c] + toxic * w);
    if (rad) f.radiation[c] = Math.max(f.radiation[c], Math.min(1, rad * w));
    if (fert) f.fertility[c] = clamp(f.fertility[c] + fert * w, 0, 1);
    if (roads) f.road[c] *= 1 - Math.min(1, roads * w);
    if (dep && dep.m > 0) { f[dep.material][c] += dep.m * w; p.updSurface(c); deposits = true; }
    if (strip && strip.soil && f.soil[c] > 0) { f.soil[c] = Math.max(0, f.soil[c] - strip.soil * w); p.updSurface(c); deposits = true; }
    if (glass && f.sand[c] > 0.2 && hashFloat(d.seed, c, d.age) < glass * w) {
      // lightning fuses the dune: sand becomes glassy rock, and shards of glass lie about
      const m = f.sand[c] * 0.5;
      f.sand[c] -= m; f.rock[c] += m; p.updSurface(c); deposits = true;
      if (p.people) dropItem(makeCtx(u, p), u.content.items.idx('glass'), 1, [cp[0], cp[1], cp[2]], c, true);
    }
  }
  if (removedWater) { p.hydro.sourced -= removedWater; p.bump('water'); }
  if (temp) p.bump('temperature');
  if (moist !== 1) p.bump('moisture');
  if (veg || grow) { for (const k of ['crop', 'grass', 'shrub', 'tree', 'treeSpecies'] as const) p.bump(k); p.vegDirty = true; }
  if (toxic) p.bump('pollution');
  if (rad) p.bump('radiation');
  if (fert) p.bump('fertility');
  if (roads) p.bump('road');
  if (deposits) { p.bump('surface'); p.bump('sand'); p.bump('ash'); p.bump('snow'); p.bump('soil'); p.bump('rock'); }
  if (num(e, 'lava') > 0) brush(u, p, 'paint-material', d.pos, Math.max(p.edgeM, R * num(e, 'lavaK', 0.3)), num(e, 'lava') * Math.sqrt(I), { material: 'lava' });
  if (num(e, 'fire') > 0 && p.airy) {
    // fires start where the fuel is dry: a few random cells per step
    const n = Math.max(1, Math.round(cells.length * 0.02));
    for (let k = 0; k < n; k++) {
      const c = cells[Math.floor(hashFloat(d.seed, d.age, k, 0xf1) * cells.length)];
      if (c !== undefined && hashFloat(d.seed, d.age, k, 0xf2) < num(e, 'fire') * Math.min(1, I) && fuelAt(p, c) > 0.05) igniteCell(u, p, c, 0.7, d.kind);
    }
  }
  if (num(e, 'lightning') > 0 && p.airy) {
    const n = Math.round(num(e, 'lightning') * Math.min(4, I));
    for (let k = 0; k < n; k++) {
      const c = cells[Math.floor(hashFloat(d.seed, d.age, k, 0x1b) * cells.length)];
      if (c === undefined) continue;
      const cp = cellPos3(p, c);
      u.emit({ t: 'lightning', planet: p.id, pos: cp, a: 1, data: { cell: c, disaster: d.id } });
      igniteCell(u, p, c, 0.8, 'lightning');
      hurtPeople(u, p, cp, p.edgeM * 0.5, 0.7, DEATH.disaster, { flat: true, chance: 0.4, salt: k });
    }
    triggers(u, p, d, defOf(u, d), R, ['lightning', 'lightning-dune']);
  }
  if (typeof e.weather === 'string' && p.airy) keepWeather(u, p, d, e.weather, i, R);
  if (num(e, 'harm') > 0) hurtPeople(u, p, d.pos, R, num(e, 'harm') * I, e.weather === 'heatwave' ? DEATH.heat : DEATH.disaster, { flat: true, chance: 0.5, salt: d.age, fear: 0.05 });
  if (num(e, 'damage') > 0) wreckBuildings(u, p, d.pos, R, num(e, 'damage') * I, d.kind, { flat: true });
  if (num(e, 'herds') > 0) hurtHerds(u, p, d.pos, R, num(e, 'herds') * I);
  if (num(e, 'forget') > 0) forgetting(u, p, d, R, num(e, 'forget') * I);
  d.ruined += Math.max(0, ruinsCount(p) - r0);
}

/** the forgetting fog: people inside lose an idea they learned (never what their kind is born knowing) */
function forgetting(u: Universe, p: Planet, d: DisasterState, R: number, chance: number): void {
  if (!p.people || !p.people.agents.count) return;
  const x = makeCtx(u, p);
  const A = x.A;
  const pt = [0, 0, 0];
  for (let s = 0; s < A.hi; s++) {
    if (!A.alive[s]) continue;
    A.posAt(s, u.tick, pt);
    if (distM(p, pt, d.pos) > R || shielded(u, p, pt)) continue;
    if (hashFloat(A.id[s], u.tick, 0xf06) >= chance) continue;
    const start = x.info[A.species[s]].start;
    const known: number[] = [];
    for (let k = 0; k < x.rt.n; k++) if (A.knows(s, k) && !start.includes(k)) known.push(k);
    if (!known.length) continue;
    const k = known[Math.floor(hashFloat(A.id[s], u.tick, 0xf07) * known.length)];
    silence(x, [s], k);
    void NT;
  }
}

/** a weather system that rides with the disaster (re-made if something cleared it) */
function keepWeather(u: Universe, p: Planet, d: DisasterState, kind: string, i: number, R: number): void {
  const key = `w${i}`;
  const id = d.st[key];
  const w = id !== undefined ? p.weather.find((x) => x.id === id) : undefined;
  if (w) { w.pos = [...d.pos]; w.radius = R; w.intensity = clamp(effI(d), 0.2, 3); return; }
  const nw = paintWeather(u, p, kind, d.pos, R, -1, clamp(effI(d), 0.2, 3), true);
  if (nw) d.st[key] = nw.id;
}

function front(u: Universe, p: Planet, d: DisasterState, e: EffectorDef, i: number): void {
  const R = effR(d) * num(e, 'width', 1), I = effI(d);
  const pos = d.pos;
  const r0 = ruinsCount(p);
  // the track meanders
  const wander = num(e, 'wander');
  const vl = Math.hypot(d.vel[0], d.vel[1], d.vel[2]);
  if (wander > 0 && vl > 0) {
    const ang = (hashFloat(d.seed, d.age, 0x3a) - 0.5) * 2 * wander;
    const { east, north } = frame(pos);
    const vx = (d.vel[0] * east[0] + d.vel[1] * east[1] + d.vel[2] * east[2]), vy = (d.vel[0] * north[0] + d.vel[1] * north[1] + d.vel[2] * north[2]);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const nx = vx * ca - vy * sa, ny = vx * sa + vy * ca;
    d.vel = [east[0] * nx + north[0] * ny, east[1] * nx + north[1] * ny, east[2] * nx + north[2] * ny];
  }
  // a sea monster keeps to the shallows: steer toward the nearest coast cell if it wandered off
  if (e.coastal) steerCoast(p, d);
  if (num(e, 'damage') > 0) wreckBuildings(u, p, pos, R, num(e, 'damage') * I, d.kind);
  if (num(e, 'harm') > 0) hurtPeople(u, p, pos, R, num(e, 'harm') * I, DEATH.disaster, { chance: 0.7, salt: d.age, fear: 0.3 });
  const strip: Record<string, number> = {};
  if (num(e, 'uproot')) strip.tree = num(e, 'uproot') * Math.min(1, I);
  if (num(e, 'crops')) strip.crop = num(e, 'crops') * Math.min(1, I);
  if (num(e, 'grass')) strip.grass = num(e, 'grass') * Math.min(1, I);
  if (Object.keys(strip).length) stripPlants(p, pos, R, strip, num(e, 'burn') ? 0.6 : 0);
  if (num(e, 'burn') > 0 && p.airy) igniteArea(u, p, pos, R * 0.6, num(e, 'burn'));
  if (num(e, 'herds') > 0) hurtHerds(u, p, pos, R, num(e, 'herds') * I);
  if (num(e, 'stores') > 0 && p.people) {
    // the swarm eats from the granaries of every settlement it passes over
    const x = makeCtx(u, p);
    for (const st of x.ps.settlements) {
      if (st.fallen >= 0 || distM(p, st.pos, pos) > R + st.territory) continue;
      for (const it of x.info[st.species].foods) if ((st.store[it] ?? 0) > 0) storeTake(st, it, st.store[it] * num(e, 'stores') * Math.min(1, I));
      st.recent.swarm = x.tick;
    }
  }
  if (num(e, 'lift') > 0) lift(u, p, d, R, num(e, 'lift') * Math.min(1.5, I));
  if (typeof e.weather === 'string' && p.airy) keepWeather(u, p, d, e.weather, i, R * 1.5);
  d.ruined += Math.max(0, ruinsCount(p) - r0);
}

/** a funnel / gravity slip throws people into the air: they become projectiles and fall where they fall */
function lift(u: Universe, p: Planet, d: DisasterState, R: number, chance: number): void {
  if (!p.people || !p.people.agents.count) return;
  const x = makeCtx(u, p);
  const A = x.A;
  const pt = [0, 0, 0];
  for (let s = 0; s < A.hi; s++) {
    if (!A.alive[s]) continue;
    A.posAt(s, u.tick, pt);
    if (distM(p, pt, d.pos) > R || shielded(u, p, pt) || u.god.isHeld('agent', A.id[s])) continue;
    if (hashFloat(A.id[s], u.tick, 0x11f7) >= chance * 0.3) continue;
    // up and away along the spin of the storm
    const out = norm(tangent(pt, [pt[0] - d.pos[0], pt[1] - d.pos[1], pt[2] - d.pos[2]]));
    const sp = 8 + 14 * hashFloat(A.id[s], u.tick, 0x11f8);
    const up = 10 + 16 * hashFloat(A.id[s], u.tick, 0x11f9) * (d.kind === 'gravity-slip' ? 2 : 1);
    launch(u, p, { kind: 'agent', id: A.id[s] }, [pt[0], pt[1], pt[2]], 1.5, [out[0] * sp + pt[0] * up, out[1] * sp + pt[1] * up, out[2] * sp + pt[2] * up], Math.max(0, d.god));
  }
}

function steerCoast(p: Planet, d: DisasterState): void {
  const c = p.cellAt(d.pos);
  if (p.s.coast[c]) return;
  let best = -1, bd = Infinity;
  for (const o of p.cellsNear(d.pos, 600)) {
    if (!p.s.coast[o]) continue;
    const dd = distM(p, cellPos3(p, o), d.pos);
    if (dd < bd) { bd = dd; best = o; }
  }
  if (best < 0) return;
  const t = norm(tangent(d.pos, [p.grid.pos[best * 3] - d.pos[0], p.grid.pos[best * 3 + 1] - d.pos[1], p.grid.pos[best * 3 + 2] - d.pos[2]]));
  const vl = Math.hypot(d.vel[0], d.vel[1], d.vel[2]) || 4 / p.st.radius;
  d.vel = [t[0] * vl, t[1] * vl, t[2] * vl];
}

function spread(u: Universe, p: Planet, d: DisasterState, e: EffectorDef): void {
  const what = String(e.what ?? 'fire');
  const I = effI(d), R = effR(d);
  const rate = clamp(num(e, 'rate', 0.4) * Math.sqrt(I), 0, 1);
  const g = p.grid;
  if (what === 'plague') {
    if (!p.people) return;
    const x = makeCtx(u, p);
    const dis = x.c.diseases.idx(String(e.disease ?? 'plague'));
    if (dis < 0) return;
    // the sickness reaches farther each round
    d.st.reach = Math.min(p.st.radius * Math.PI, (d.st.reach ?? R) * (1 + rate * 0.5));
    for (const st of x.ps.settlements) {
      if (st.fallen >= 0 || distM(p, st.pos, d.pos) > d.st.reach + st.territory || shielded(u, p, st.pos)) continue;
      const n = seedDisease(x, st, dis, Math.max(1, Math.round(num(e, 'strength', 2) * I)), d.god > 0 ? 'a rival god' : d.cause === 'nature' ? null : 'the god');
      if (n > 0) accident(x, st, 'plague', st.cell);
    }
    return;
  }
  // cell contagion: a frontier list (ascending) that grows ring by ring
  if (!d.cells.length && !d.st.started) {
    d.st.started = 1;
    d.cells = p.cellsNear(d.pos, Math.max(p.edgeM, R * 0.25)).slice().sort((a, b) => a - b);
  }
  const next = new Set<number>();
  const strength = num(e, 'strength', 0.5);
  const maxR = R * 1.6;
  for (const c of d.cells) {
    const cp = cellPos3(p, c);
    if (shielded(u, p, cp)) continue;
    let alive = false;
    if (what === 'fire') {
      if (p.airy && fuelAt(p, c) > 0.04) { igniteCell(u, p, c, strength, d.kind); alive = true; }
    } else if (what === 'blight') {
      if (p.f.crop[c] > 0.05 || p.f.tree[c] > 0.1 || p.f.shrub[c] > 0.1) {
        if (p.people) blightAt(makeCtx(u, p), c, strength);
        p.f.crop[c] *= 0.85; p.f.tree[c] *= 0.97;
        alive = true;
      }
    } else if (what === 'infestation') {
      if (p.f.crop[c] > 0.02 || p.f.grass[c] > 0.1) { p.f.crop[c] *= 1 - strength * 4; p.f.grass[c] *= 1 - strength; alive = true; }
    }
    if (!alive) continue;
    for (let k = g.nbrStart[c]; k < g.nbrStart[c + 1]; k++) {
      const o = g.nbr[k];
      if (hashFloat(d.seed, o, d.age, 0x5b) < rate && distM(p, cellPos3(p, o), d.pos) <= maxR) next.add(o);
    }
  }
  if (what === 'infestation' && p.people) {
    const x = makeCtx(u, p);
    for (const st of x.ps.settlements) {
      if (st.fallen >= 0) continue;
      if (!d.cells.some((c) => distM(p, cellPos3(p, c), st.pos) < st.territory + 60)) continue;
      for (const it of x.info[st.species].foods) if ((st.store[it] ?? 0) > 0) storeTake(st, it, st.store[it] * strength);
    }
  }
  if (what !== 'fire') { p.bump('crop'); p.bump('tree'); p.bump('grass'); p.bump('blight'); p.vegDirty = true; }
  // the frontier: the newly reached cells (capped so a huge fire stays cheap; the fire system spreads it further)
  d.cells = [...next].sort((a, b) => a - b).slice(0, 600);
}

function quake(u: Universe, p: Planet, d: DisasterState, def: DisasterDef, e: EffectorDef): void {
  const R = effR(d), I = effI(d);
  const pos = d.pos;
  const r0 = ruinsCount(p);
  const mag = num(e, 'magnitude', 6) + Math.log2(Math.max(0.1, I)) * 0.7;
  const sev = clamp(Math.pow(2, mag - 6), 0.05, 6);
  u.emit({ t: 'quake', planet: p.id, pos: [...pos], a: r3(mag), b: R, data: { disaster: d.id, kind: d.kind } });
  if (num(e, 'damage') > 0) wreckBuildings(u, p, pos, R * 1.2, num(e, 'damage') * sev * 0.7, 'quake', { byStrength: 1.4 });
  if (num(e, 'harm') > 0) hurtPeople(u, p, pos, R, num(e, 'harm') * sev, DEATH.disaster, { chance: 0.55, salt: d.age, fear: 0.35 });
  // landslides: steep ground sheds rock and soil downhill
  const ls = num(e, 'landslide') * Math.min(3, sev);
  if (ls > 0) landslides(p, pos, R, ls);
  if (num(e, 'sink') > 0) {
    brush(u, p, 'lower', pos, R, num(e, 'sink') * Math.sqrt(I));
    wreckBuildings(u, p, pos, R, 2, 'sinkhole', { flat: true });
    hurtPeople(u, p, pos, R, 1.2, DEATH.disaster, { flat: true, chance: 0.7, salt: 0x51 });
  }
  if (num(e, 'rift') > 0) {
    const b = hashFloat(d.seed, 0x21f) * Math.PI;
    const len = R * 1.1;
    for (let k = -6; k <= 6; k++) {
      const at = moveBy(pos, bearingDir(pos, b), (len * k) / 6, p.st.radius);
      brush(u, p, 'lower', at, Math.max(p.edgeM * 0.7, R * 0.08), num(e, 'rift') * Math.sqrt(I));
      if (num(e, 'riftLava') > 0 && Math.abs(k) <= 3) brush(u, p, 'paint-material', at, Math.max(p.edgeM * 0.6, R * 0.05), num(e, 'riftLava'), { material: 'lava' });
      wreckBuildings(u, p, at, R * 0.12, 3, 'rift', { flat: true });
    }
    d.params.bearing = r3(b);
  }
  if (num(e, 'tsunami') > 0) {
    const sea = nearestOcean(p, pos, R * 1.5);
    if (sea >= 0) {
      const sp = cellPos3(p, sea);
      const toward = norm(tangent(sp, [pos[0] - sp[0], pos[1] - sp[1], pos[2] - sp[2]]));
      waterImpulse(p, sp, R * 0.6, num(e, 'tsunami') * Math.min(3, sev * 0.6), toward, -1);
    }
  }
  triggers(u, p, d, def, R * 2);
  d.ruined += Math.max(0, ruinsCount(p) - r0);
}

function landslides(p: Planet, pos: ArrayLike<number>, R: number, amount: number): void {
  const f = p.f, g = p.grid;
  const cells = p.cellsNear(pos, R).slice();
  let n = 0;
  for (const c of cells) {
    let low = -1, drop = 0;
    for (let k = g.nbrStart[c]; k < g.nbrStart[c + 1]; k++) {
      const o = g.nbr[k];
      const dh = f.surface[c] - f.surface[o];
      if (dh > drop) { drop = dh; low = o; }
    }
    if (low < 0 || drop < p.edgeM * 0.35) continue;
    const m = Math.min(amount, drop * 0.25);
    f.rock[c] -= m;
    f.soil[low] += m;
    p.s.tAct[c] = 1; p.s.tAct[low] = 1;
    p.updSurface(c); p.updSurface(low);
    n++;
  }
  if (n) { p.bump('surface'); p.bump('rock'); p.bump('soil'); }
}

function nearestOcean(p: Planet, pos: ArrayLike<number>, maxM: number): number {
  const c0 = p.cellAt(pos);
  if (p.s.ocean[c0]) return c0;
  let best = -1, bd = Infinity;
  for (const c of p.cellsNear(pos, maxM)) {
    if (!p.s.ocean[c] || p.f.water[c] < 2) continue;
    const dd = distM(p, cellPos3(p, c), pos);
    if (dd < bd) { bd = dd; best = c; }
  }
  return best;
}

function water(u: Universe, p: Planet, d: DisasterState, e: EffectorDef): void {
  const R = effR(d), I = effI(d);
  const mode = String(e.mode ?? 'flood');
  const h = num(e, 'height', 3) * Math.sqrt(I);
  if (shielded(u, p, d.pos)) return;
  if (mode === 'flood') { waterImpulse(p, d.pos, R, h, null, -1); return; }
  if (mode === 'tsunami' || mode === 'surge') {
    // from the sea toward the land: start at the nearest deep water and run at the disaster's point
    const sea = nearestOcean(p, d.pos, R * (mode === 'surge' ? 2 : 5));
    if (sea < 0) { if (mode === 'tsunami') waterImpulse(p, d.pos, R, h * 0.5, null, -1); return; }
    const sp = cellPos3(p, sea);
    let toward: V3 = norm(tangent(sp, [d.pos[0] - sp[0], d.pos[1] - sp[1], d.pos[2] - sp[2]]));
    if (Math.hypot(toward[0], toward[1], toward[2]) < 0.5 || sea === p.cellAt(d.pos)) toward = landward(p, sea);
    waterImpulse(p, sp, mode === 'surge' ? R * 0.5 : R, h, toward, -1);
    return;
  }
  if (mode === 'tides') {
    // the pull of a passing body heaps the sea under it and runs it at the coasts
    const prog = d.life > 0 ? d.age / d.life : 0.5;
    const sea = nearestOcean(p, d.pos, p.st.radius);
    if (sea < 0) return;
    const sp = cellPos3(p, sea);
    waterImpulse(p, sp, R, h * (0.3 + prog), landward(p, sea), -1);
  }
}

/** a tangent direction at an ocean cell pointing to its nearest land */
function landward(p: Planet, c: number): V3 {
  const pos = cellPos3(p, c);
  let best = -1, bd = Infinity;
  for (const o of p.cellsNear(pos, 1500)) {
    if (p.s.ocean[o] || p.f.water[o] > 0.5) continue;
    const dd = distM(p, cellPos3(p, o), pos);
    if (dd < bd) { bd = dd; best = o; }
  }
  if (best < 0) return bearingDir(pos, 0);
  const o = cellPos3(p, best);
  return norm(tangent(pos, [o[0] - pos[0], o[1] - pos[1], o[2] - pos[2]]));
}

/** global parameters: the target delta now (by the envelope) minus what this disaster already applied */
function globalFx(u: Universe, p: Planet, d: DisasterState, e: EffectorDef): void {
  const env = envelope(d, num(e, 'ramp', 0.2)) * Math.min(2, effI(d));
  const st = p.st;
  if (d.st.g0 === undefined) { d.st.g0 = st.gravity; d.st.m0 = st.magnetism; }
  const apply = (key: string, target: number, get: () => number, set: (v: number) => void) => {
    const cur = d.st[key] ?? 0;
    const delta = r3(target) - cur;
    if (Math.abs(delta) < 1e-6) return;
    set(get() + delta);
    d.st[key] = r3(target);
  };
  if (num(e, 'dust') && p.airy) apply('aDust', num(e, 'dust') * env, () => st.atmosphere.dust, (v) => { st.atmosphere.dust = r3(Math.max(0, v)); });
  if (num(e, 'light')) apply('aLight', num(e, 'light') * Math.min(1, env), () => st.lightScale, (v) => { st.lightScale = r3(clamp(v, 0.02, 4)); });
  if (num(e, 'gravity')) apply('aGrav', d.st.g0 * num(e, 'gravity') * Math.min(1, env), () => st.gravity, (v) => { st.gravity = r3(Math.max(0, v)); });
  if (num(e, 'magnetism')) apply('aMag', Math.max(-d.st.m0, (d.st.m0 || 0.5) * num(e, 'magnetism') * Math.min(1, env)), () => st.magnetism, (v) => { st.magnetism = r3(Math.max(0, v)); });
  if (num(e, 'activity')) apply('aAct', num(e, 'activity') * Math.min(1, env), () => u.star.activity, (v) => { u.star.activity = r3(clamp(v, 0, 1)); });
  if (num(e, 'temp')) apply('aTemp', num(e, 'temp') * env, () => st.climateOffset, (v) => { st.climateOffset = r3(v); });
  if (num(e, 'toxicity')) apply('aTox', num(e, 'toxicity') * env, () => st.atmosphere.toxicity, (v) => { st.atmosphere.toxicity = r3(clamp(v, 0, 1)); });
  if (num(e, 'eccentricity')) apply('aEcc', num(e, 'eccentricity') * Math.min(1, env), () => st.orbit.e, (v) => { st.orbit.e = r3(clamp(v, 0, 0.9)); });
}

function restoreGlobals(u: Universe, p: Planet, d: DisasterState): void {
  const st = p.st;
  const take = (key: string, fn: (v: number) => void) => { const v = d.st[key]; if (v) fn(v); d.st[key] = 0; };
  take('aDust', (v) => { st.atmosphere.dust = r3(Math.max(0, st.atmosphere.dust - v)); });
  take('aLight', (v) => { st.lightScale = r3(clamp(st.lightScale - v, 0.02, 4)); });
  take('aGrav', (v) => { st.gravity = r3(Math.max(0, st.gravity - v)); });
  take('aMag', (v) => { st.magnetism = r3(Math.max(0, st.magnetism - v)); });
  take('aAct', (v) => { u.star.activity = r3(clamp(u.star.activity - v, 0, 1)); });
  take('aTemp', (v) => { st.climateOffset = r3(st.climateOffset - v); });
  take('aTox', (v) => { st.atmosphere.toxicity = r3(clamp(st.atmosphere.toxicity - v, 0, 1)); });
  take('aEcc', (v) => { st.orbit.e = r3(clamp(st.orbit.e - v, 0, 0.9)); });
}

function spawn(u: Universe, p: Planet, d: DisasterState, def: DisasterDef, e: EffectorDef): void {
  const what = String(e.what ?? 'herd');
  const I = effI(d), R = effR(d);
  if (what === 'herd' && p.people) {
    const x = makeCtx(u, p);
    const sp = animalIdx(x, String(e.animal ?? 'locust-swarm'));
    if (sp < 0) return;
    // put it where it can live, near the disaster's point
    let c = p.cellAt(d.pos);
    if (habitatFit(x, sp, c) <= 0) {
      for (const o of p.cellsNear(d.pos, R)) if (habitatFit(x, sp, o) > 0) { c = o; break; }
    }
    const n = Math.max(1, Math.round(num(e, 'count', 10) * I));
    const fresh = x.ps.eco.seen[String(sp)] === undefined;
    const h = fresh ? introduceSpecies(x, sp, c, n, 'in a plague') : spawnHerd(x, sp, c, n);
    if (h) d.st.herd = h.id;
    return;
  }
  if (what === 'meteors') {
    // one small stone per round somewhere under the shower
    const b = hashFloat(d.seed, d.age, 0x3e7) * Math.PI * 2;
    const rr = R * Math.sqrt(hashFloat(d.seed, d.age, 0x3e8));
    const at = moveBy(d.pos, bearingDir(d.pos, b), rr, p.st.radius);
    if (shielded(u, p, at)) return;
    const size = num(e, 'size', 25) * Math.sqrt(I);
    const r0 = ruinsCount(p);
    crater(u, p, at, size, 0.8);
    hurtPeople(u, p, at, size * 2, 0.6 * I, DEATH.disaster, { fear: 0.3 });
    wreckBuildings(u, p, at, size * 2, 0.8 * I, d.kind);
    if (p.airy) igniteArea(u, p, at, size * 1.2, 0.6);
    if (hashFloat(d.seed, d.age, 0x3e9) < 0.15) starIron(u, p, at, 1);
    d.ruined += Math.max(0, ruinsCount(p) - r0);
    return;
  }
  if (what === 'moon') {
    // the moon that falls: this world's own moon if it has one (it is gone when it strikes), else a captured stone
    const moon = u.planets.find((q) => q.alive && q.st.orbit.parent === p.id);
    if (moon && d.target < 0) d.target = moon.id;
    d.params.size = moon ? Math.round(moon.st.radius * 0.3) : d.params.size ?? 400;
    return;
  }
  if (what === 'rogue') {
    d.params.bearing = r3(hashFloat(d.seed, 0xb0) * Math.PI * 2);
    triggers(u, p, d, def, p.st.radius * 4);
  }
}

// ───────────────────────────── natural disasters ─────────────────────────────

interface PlanetTraits { [k: string]: boolean }

/** what a world is like today (cheap aggregate of its fields) */
export function planetTraits(u: Universe, p: Planet): PlanetTraits {
  const f = p.f;
  let land = 0, ocean = 0, volc = 0, steep = 0, precip = 0, temp = 0, tree = 0, grass = 0, crop = 0, sand = 0, n = 0;
  const volcB = u.content.biomes.idx('volcanic');
  const g = p.grid;
  for (let c = 0; c < p.count; c += 3) {
    n++;
    if (p.s.ocean[c]) { ocean++; continue; }
    land++;
    if (f.biome[c] === volcB || f.lava[c] > 0.01) volc++;
    let drop = 0;
    for (let k = g.nbrStart[c]; k < g.nbrStart[c + 1]; k++) drop = Math.max(drop, Math.abs(f.surface[c] - f.surface[g.nbr[k]]));
    if (drop > p.edgeM * 0.4) steep++;
    precip += p.s.precipMean[c];
    temp += f.temperature[c];
    tree += f.tree[c];
    grass += f.grass[c];
    if (f.crop[c] > 0.15) crop++;
    if (f.sand[c] > 1) sand++;
  }
  const L = Math.max(1, land);
  const ps = p.people;
  return {
    air: p.airy,
    volcanic: p.vents.length > 0 || volc / L > 0.01,
    rift: p.vents.length > 0 || volc / L > 0.01 || steep / L > 0.08,
    mountain: steep / L > 0.04,
    coast: ocean > 0 && land > 0,
    sea: ocean / Math.max(1, n) > 0.1,
    dry: precip / L < 0.08,
    wet: precip / L > 0.12,
    hot: temp / L > 22,
    cold: temp / L < 2,
    forest: tree / L > 0.12,
    grass: grass / L > 0.15,
    crops: crop > 0,
    people: !!ps && ps.agents.count > 0,
    settled: !!ps && ps.settlements.some((s) => s.fallen < 0 && !s.band),
    herds: !!ps && ps.herds.length > 0,
    sand: sand / L > 0.05,
    moon: u.planets.some((q) => q.alive && q.st.orbit.parent === p.id),
    magnetism: p.st.magnetism > 0,
    storms: p.weather.length > 0,
    pole: true,
  };
}

/** once a planet-day: disasters that come on their own where the conditions hold */
export function naturalDisasters(u: Universe, p: Planet): void {
  const k = u.god.lawAt('disasters.natural', p.id);
  if (k <= 0 || !p.alive) return;
  const live = u.god.disasters.filter((d) => d.planet === p.id && d.cause === 'nature').length;
  if (live >= 3) return;
  const yearDays = Math.max(1, p.st.orbit.period / Math.max(60, p.st.dayHours * 60));
  let tr: PlanetTraits | null = null;
  const defs = u.content.disasters.list;
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    if (!def.natural || def.natural.rate <= 0) continue;
    const pDay = (def.natural.rate / yearDays) * k;
    if (hashFloat(u.seed, u.tick, i * 31 + p.id, 0xa7a1) >= pDay) continue;
    tr ??= planetTraits(u, p);
    if (!def.natural.needs.every((n) => tr![n])) continue;
    const at = naturalSite(u, p, def);
    if (!at) continue;
    const d = spawnDisaster(u, p, def.id, { pos: at, god: -1, cause: 'nature', quiet: def.radius < 300 && def.id !== 'volcano' });
    if (typeof d !== 'string') u.god.stat('natural');
    return; // one a day per world at most
  }
}

/** where a natural disaster of this kind strikes: sampled cells scored by the kind's needs */
function naturalSite(u: Universe, p: Planet, def: DisasterDef): V3 | null {
  const f = p.f;
  const volcB = u.content.biomes.idx('volcanic');
  let best = -1, bs = -Infinity;
  for (let k = 0; k < 96; k++) {
    const c = Math.floor(hashFloat(u.seed, u.tick, k, 0x517e + p.id) * p.count);
    let s = hashFloat(c, u.tick, 0x52) * 0.2;
    const land = !p.s.ocean[c];
    for (const n of def.natural?.needs ?? []) {
      switch (n) {
        case 'volcanic': s += (f.biome[c] === volcB ? 2 : 0) + (p.vents.some((v) => v.cell === c) ? 3 : 0) + (f.lava[c] > 0 ? 1 : 0); break;
        case 'rift': s += land ? Math.min(2, Math.abs(f.surface[c] - p.st.seaLevel) / 150) : 0; break;
        case 'forest': s += f.tree[c] * 2; break;
        case 'dry': s += land ? Math.max(0, 0.5 - f.moisture[c]) * 2 : -5; break;
        case 'wet': s += f.moisture[c] + (f.water[c] > 0.2 && !p.s.ocean[c] ? 1 : 0); break;
        case 'crops': s += f.crop[c] * 3; break;
        case 'grass': s += f.grass[c]; break;
        case 'settled': case 'people': s += f.territory[c] >= 0 ? 1.5 : 0; break;
        case 'sea': s += p.s.coast[c] ? 2 : 0; break;
        case 'sand': s += Math.min(2, f.sand[c] / 2); break;
        case 'hot': s += f.temperature[c] / 30; break;
        default: break;
      }
    }
    if (!land && def.natural?.needs.includes('sea') !== true && def.id !== 'tsunami') s -= 3;
    if (s > bs) { bs = s; best = c; }
  }
  if (best < 0) return null;
  // volcanoes erupt from their vents
  if (def.natural?.needs.includes('volcanic') && p.vents.length) {
    const v = p.vents[Math.floor(hashFloat(u.seed, u.tick, 0x7e) * p.vents.length)];
    return cellPos3(p, v.cell);
  }
  return cellPos3(p, best);
}

// ───────────────────────────── views ─────────────────────────────

export function disasterViews(u: Universe, p: Planet): DisasterView[] {
  const out: DisasterView[] = [];
  for (const d of u.god.disasters) {
    if (d.planet !== p.id) continue;
    out.push({
      id: d.id, kind: d.kind, planet: d.planet, pos: [d.pos[0], d.pos[1], d.pos[2]], radius: Math.round(effR(d)), intensity: r3(effI(d)),
      progress: d.life > 0 ? r3(clamp(d.age / d.life, 0, 1)) : -1, frozen: d.frozen, params: { ...d.params },
    });
  }
  return out;
}

/** hourly upkeep: impact dust settles, radiation fades */
export function disastersHourly(u: Universe, p: Planet): void {
  const key = `dust.${p.id}`;
  const added = u.god.stats[key] ?? 0;
  if (added > 0.001) {
    const k = Math.max(0.0005, added * 0.006);
    u.god.stats[key] = r3(Math.max(0, added - k));
    p.st.atmosphere.dust = r3(Math.max(0, p.st.atmosphere.dust - k));
  }
  const rk = `rad.${p.id}`;
  let any = false;
  const r = p.f.radiation;
  if (u.god.stats[rk] === undefined || u.god.stats[rk] > 0 || u.god.disasters.some((d) => d.planet === p.id)) {
    for (let c = 0; c < p.count; c++) if (r[c] > 0) { r[c] = r[c] < 0.002 ? 0 : r[c] * 0.97; any = true; }
    u.god.stats[rk] = any ? 1 : 0;
    if (any) p.bump('radiation');
  }
}
