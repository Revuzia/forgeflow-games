// GENESIS — warnings and evacuation (LIVING.md §3.7): a disaster the god sends gives the people a chance.
//
//   volcano      a warning phase — rumbling, smoke, small quakes — of ≥ 12 game hours at wrath ≤ 0.5 (2 h at wrath 1,
//                none when the cast says so: an apocalyptic one), then the eruption
//   meteor       a bright streak crosses the sky for an hour before it strikes (≥ 20 min; the fall itself at wrath 1);
//                the streak is an omen (god/omens.ts)
//   tsunami      the sea draws back from the shore ≥ 30 minutes before the wave
//   comet        hangs in the sky for days before it strikes (its own life): the same evacuation
//   flood        (ARC §10) a natural flood: 6-12 game hours of heavy rain over the catchment upstream and the river
//                rising and running brown at the banks (`params.rise` 0..1, `params.silt` 1) before the water comes;
//                a god-sent flood warns only when its cast carries a warning (none at wrath 1 or `warning: 0`)
// While it lasts the disaster's view carries `params.warning = 1` (render hook H5). Every settlement in reach gets an
// EVACUATE order: its members walk out to the danger radius + 100 m (high ground for water) and wait there (TASK
// evacuate, people/shelter.ts), with what food and water they can carry, until the danger has passed — then they come
// home. Nothing here strikes anyone: god/disasters.ts holds the effects back until the warning is over.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { DisasterDef } from '../content.ts';
import type { DisasterState } from './state.ts';
import { hashFloat } from '../core/rng.ts';
import { paintWeather } from '../fields/weather.ts';
import { activateCell } from '../fields/hydrology.ts';
import { offset } from './util.ts';
import { makeCtx } from '../people/ctx.ts';
import { interrupt } from '../people/people.ts';
import { AgentFlag } from '../types.ts';
import { tell } from '../people/story.ts';
import { settlementRef, vars } from '../people/util.ts';
import { distM } from '../people/world.ts';
import { reach } from './wrath.ts';
import { relStat, srel } from './regard.ts';

/** the warning phase of a god-sent disaster of `kind` at wrath w, in ticks (0 none); `override` from the cast */
export function warningTicks(u: Universe, kind: string, w: number, override?: number): number {
  void u;
  if (override !== undefined) return Math.max(0, Math.round(override));
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * Math.max(0, Math.min(1, t));
  switch (kind) {
    case 'volcano': case 'supervolcano':
      return Math.round(w <= 0.5 ? 720 + 120 * hashFloat(Math.round(w * 1000), 0x7a1c) : lerp(720, 120, (w - 0.5) / 0.5));
    case 'meteor':
      // the fall itself (24 min) is the streak at wrath 1; at the default the sky shows it for 36 minutes in all. (LIVING
      // second pass: an hour of it — 36 + 24 — let a warned town walk clear of the blast, and nobody died of a meteor at
      // the default wrath, against the §3.7 table's 10–35 %; with 12 + 24 and the blast's wounds to those caught on the
      // road 10–28 % die, mean 18 %, on the 8 acceptance worlds: _harness/scratch/living/relationship/live2/meteor.ts)
      return Math.round(w <= 0.5 ? 12 : lerp(12, 0, (w - 0.5) / 0.5));
    case 'tsunami':
      return Math.round(w < 1 ? 40 : 30);
    case 'flood':
      // ARC §10.2 (r1 #3/#7/#13): the river rises brown before the god's flood as before nature's — 6-12 hours at the
      // default wrath, shortening to none at wrath 1 (total destruction gives no warning, as today)
      return Math.round(w <= 0.5 ? 360 + 360 * hashFloat(Math.round(w * 1000), 0xf10e) : lerp(540, 0, (w - 0.5) / 0.5));
    default:
      return 0;
  }
}

/** ARC §10.1: a natural flood's warning phase, 6-12 game hours, hashed on the disaster id */
export function naturalFloodWarning(id: number): number {
  return 360 + Math.round(360 * hashFloat(id, 0xf10d));
}

/** how far from a disaster's centre its harm can kill (metres), at the wrath it was sent with */
export function dangerRadius(def: DisasterDef, d: DisasterState): number {
  const R = d.radius * Math.sqrt(Math.max(0.01, d.scale));
  const k = reach(d.st.Wr ?? 1);
  let m = R;
  for (const e of def.effectors) {
    if (e.type === 'impact') {
      const shock = R * (typeof e.shockK === 'number' ? e.shockK : 2);
      const fire = R * (typeof e.fireK === 'number' ? e.fireK : 1.5);
      m = Math.max(m, shock * k, fire);
    } else if (e.type === 'water') m = Math.max(m, R * 1.5);
    else if (e.type === 'area' && typeof e.lavaK === 'number') m = Math.max(m, R * k);
  }
  return m;
}

/** the kinds whose coming the people can see, and flee */
// (ARC §10.2, r1: a flood is seen coming through its own warning phase — warningTicks gives it one below wrath 1 — so it
// stays out of this set: a flood cast with `warning: 0` at a gentle wrath must still come unseen, as the player chose)
const WARNED = new Set(['volcano', 'supervolcano', 'meteor', 'tsunami', 'comet']);

/** a warned disaster begins: the settlements in reach are told to get out (and the chronicle tells it) */
export function warningStart(u: Universe, p: Planet, d: DisasterState, def: DisasterDef): void {
  if (def.id === 'flood') floodRains(u, p, d, def);
  u.emit({ t: 'warning', planet: p.id, pos: [...d.pos], a: d.st.Wn ?? 0, ref: { kind: 'disaster', id: d.id, planet: p.id }, data: { kind: d.kind, id: d.id } });
  evacuate(u, p, d, def, (d.st.Wn ?? 0) + afterTicks(d));
}

/** a disaster with no warning of its own that the people can still see coming (a comet for days): the same orders */
export function seenComing(u: Universe, p: Planet, d: DisasterState, def: DisasterDef): void {
  // (at full wrath there is no warning and no order: total destruction, today's behaviour)
  if (!WARNED.has(def.id) || d.st.Wn || (d.st.Wr ?? 1) >= 1) return;
  evacuate(u, p, d, def, d.life > 0 ? d.life + 120 : 1440);
}

/**
 * how long after the blow the people stay away: until the disaster is spent (a volcano's whole eruption, lava and ash —
 * up to 3 days; they came home into the lava when the order lapsed after 2), at least a few hours, at most 6 days
 */
function afterTicks(d: DisasterState): number {
  const rest = d.life > 0 ? d.life - (d.st.Wn ?? 0) : 1440;
  return Math.max(120, Math.min(6 * 1440, rest + 120));
}

function evacuate(u: Universe, p: Planet, d: DisasterState, def: DisasterDef, ticks: number): void {
  const ps = p.people;
  if (!ps || !ps.settlements.length) return;
  const x = makeCtx(u, p);
  const R = dangerRadius(def, d);
  for (const st of ps.settlements) {
    if (st.fallen >= 0 || st.band) continue;
    const dist = distM(p, st.pos, d.pos);
    if (dist > R + st.territory + 100) continue;
    const r = srel(u, p.id, st.id);
    r.evacuate = { pos: [d.pos[0], d.pos[1], d.pos[2]], radius: Math.round(R + 100), until: u.tick + ticks, disaster: d.id, kind: def.id };
    relStat(u, 'evacuations');
    const key = def.id === 'tsunami' ? 'warning.tsunami' : def.id === 'meteor' || def.id === 'comet' ? 'warning.meteor' : def.id === 'flood' ? 'warning.flood' : 'warning.volcano';
    tell(u, p, key, vars(x, st, -1, { disaster: def.name.toLowerCase() }), st, [settlementRef(x, st)], 1);
    tell(u, p, 'evacuate', vars(x, st, -1, { disaster: def.name.toLowerCase() }), st, [settlementRef(x, st)], 2);
    u.emit({ t: 'evacuate', planet: p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], ref: settlementRef(x, st), data: { settlement: st.id, disaster: d.id, radius: Math.round(R + 100), until: u.tick + ticks } });
    // they drop what they are doing and go (the decision hook gives them the evacuation: god/relationship.ts)
    for (const s of x.ps.members.get(st.id) ?? []) {
      if (x.A.flags[s] & AgentFlag.possessed || x.A.mission[s] || u.god.isHeld('agent', x.A.id[s])) continue;
      interrupt(x, s);
    }
  }
  // ARC §10 (r2 #5): people on a mission (any town's caravan, a war band, a crew) standing in the danger or walking into
  // it are stopped too: their next decision gives them the order (decide.ts -> godHooks.missionEvacuate)
  const pt: [number, number, number] = [0, 0, 0], gl: [number, number, number] = [0, 0, 0];
  const lim = R + 100;
  for (const st of ps.settlements) {
    for (const s of x.ps.members.get(st.id) ?? []) {
      if (!x.A.mission[s] || x.A.flags[s] & AgentFlag.possessed || u.god.isHeld('agent', x.A.id[s])) continue;
      x.A.posAt(s, u.tick, pt);
      gl[0] = x.A.gx[s]; gl[1] = x.A.gy[s]; gl[2] = x.A.gz[s];
      const m = x.ps.mission(x.A.mission[s]);
      const bound = !!m && (evacuationOf(u, p.id, m.to)?.disaster === d.id || evacuationOf(u, p.id, m.from)?.disaster === d.id);
      if (bound || distM(p, pt, d.pos) <= lim || distM(p, gl, d.pos) <= lim) interrupt(x, s);
    }
  }
}

/** during the warning: small quakes and smoke (a volcano), the sea drawn back (a tsunami) — events for the client */
export function warningTick(u: Universe, p: Planet, d: DisasterState, def: DisasterDef): void {
  const left = (d.st.Wn ?? 0) - d.age;
  if (def.id === 'volcano' || def.id === 'supervolcano') {
    // a small quake an hour, smoke rising as the eruption nears
    if (d.age % 60 === 7) u.emit({ t: 'quake', planet: p.id, pos: [...d.pos], a: 2.5 + 1.5 * (1 - left / Math.max(1, d.st.Wn ?? 1)), data: { warning: 1, id: d.id } });
    d.params.plume = Math.round((def.render.plume ?? 1000) * 0.15 * (1 - left / Math.max(1, d.st.Wn ?? 1)));
  } else if (def.id === 'tsunami') {
    d.params.drawback = 1;
  } else if (def.id === 'flood') {
    // the river rises and runs brown as the rain upstream comes down (render hook H5: the banks, ARC §10.1)
    const k = 1 - left / Math.max(1, d.st.Wn ?? 1);
    d.params.rise = Math.round(Math.max(0, Math.min(1, k)) * 1000) / 1000;
    d.params.silt = 1;
    // the rain over the catchment grows heavier toward the flood (rain kind: no lightning, no harm)
    if (d.age % 60 === 0) { const w = p.weather.find((q) => q.id === d.st.wU); if (w) w.intensity = Math.min(1.6, 1.2 + 0.4 * k); }
    // and the water itself comes up in the channel: only cells already holding the river (> 0.3 m), FLOOD_RISE m in all
    // over the warning, so dry ground stays dry until the flood (nobody is harmed before it: ARC §10.3)
    if (d.age % 60 === 30) riverRise(p, d, FLOOD_RISE / Math.max(1, Math.floor((d.st.Wn ?? 60) / 60)));
  }
}

/** ARC §10.1: how far the river climbs its banks during a flood's warning (m, in all) */
export const FLOOD_RISE = 0.4;

function riverRise(p: Planet, d: DisasterState, dh: number): void {
  const R = d.radius * Math.sqrt(Math.max(0.01, d.scale));
  const f = p.f;
  let added = 0;
  for (const c of p.cellsNear(d.pos, R)) {
    if (p.s.ocean[c] || f.water[c] <= 0.3) continue;
    f.water[c] += dh;
    added += dh * p.cellArea[c];
    activateCell(p, c);
  }
  if (added > 0) { p.hydro.sourced += added; p.bump('water'); }
}

/**
 * ARC §10.1: heavy rain over the catchment upstream of a flood — the highest land within 3 radii of it, sampled on 12
 * bearings — and over the banks between, kept with the disaster (`st.wU`; god/disasters.ts cleanup lifts every `w*`)
 */
function floodRains(u: Universe, p: Planet, d: DisasterState, def: DisasterDef): void {
  if (!p.airy || d.st.wU !== undefined) return;
  void def;
  const R = d.radius * Math.sqrt(Math.max(0.01, d.scale));
  const f = p.f;
  let best = d.pos as ArrayLike<number>, bh = f.surface[p.cellAt(d.pos)];
  for (let i = 0; i < 12; i++) {
    const q = offset(d.pos, R * 3, (i / 12) * Math.PI * 2 + hashFloat(d.id, 0xf10e) * 0.5, p.st.radius);
    const c = p.cellAt(q);
    if (p.s.ocean[c]) continue;
    if (f.surface[c] > bh) { bh = f.surface[c]; best = q; }
  }
  // centred halfway up the slope, wide enough to cover the hills and the town's banks both
  const mid = [(d.pos[0] + best[0]) / 2, (d.pos[1] + best[1]) / 2, (d.pos[2] + best[2]) / 2];
  const w = paintWeather(u, p, 'rain', mid, R * 2.5, -1, 1.2, true);
  if (w) d.st.wU = w.id;
}

/** the warning is over: the blow falls (god/disasters.ts fires the effects) */
export function warningEnd(u: Universe, p: Planet, d: DisasterState): void {
  delete d.params.drawback;
  delete d.params.rise;
  delete d.params.silt;
  u.emit({ t: 'warning.end', planet: p.id, pos: [...d.pos], ref: { kind: 'disaster', id: d.id, planet: p.id }, data: { kind: d.kind, id: d.id } });
}

/** the evacuation order in force for a settlement (null none) — read only; lapsed orders are cleared hourly */
export function evacuationOf(u: Universe, planet: number, sid: number): { pos: [number, number, number]; radius: number; until: number; disaster: number } | null {
  const e = u.god.rel?.st[`${planet}:${sid}`]?.evacuate;
  return e && e.until > u.tick ? e : null;
}

/**
 * ARC §10 (r2 #5): the order a person ON A MISSION (a caravan, gift bearers, a war band, a ship's crew) must heed, or
 * null. Missions bypass the settled decision (decide.ts), so without this a caravan slept and traded inside the flood's
 * radius through the whole warning, and caravans bound for the town walked into it while the river rose. An order counts
 * when the person stands inside its radius, when either end of the errand (the town it left, the town it is bound for)
 * is under an order, or when where they are walking lies inside one. They walk out (or wait beyond the radius), then the errand
 * goes on when the order is lifted.
 */
export function missionEvacuation(u: Universe, planet: number, pos: readonly number[], goal: readonly number[] | null, to: number, home: number): { pos: [number, number, number]; radius: number; until: number; disaster: number } | null {
  const R = u.god.rel;
  if (!R) return null;
  const p = u.planets.find((q) => q.id === planet);
  if (!p) return null;
  const bound = (to >= 0 ? evacuationOf(u, planet, to) : null) ?? (home >= 0 ? evacuationOf(u, planet, home) : null);
  let hit: ReturnType<typeof evacuationOf> = null;
  const pre = `${planet}:`;
  // (sorted keys: the same order wins on every run)
  for (const k of Object.keys(R.st).sort()) {
    if (!k.startsWith(pre)) continue;
    const e = R.st[k].evacuate;
    if (!e || e.until <= u.tick) continue;
    if (distM(p, pos as [number, number, number], e.pos) <= e.radius || (goal && distM(p, goal as [number, number, number], e.pos) <= e.radius)) {
      if (!hit || e.disaster < hit.disaster) hit = e;
    }
  }
  return hit ?? bound;
}

/** hourly: orders whose time is up are lifted (the people come home) */
export function evacuationsHourly(u: Universe, p: Planet): void {
  const R = u.god.rel;
  if (!R) return;
  for (const [k, r] of Object.entries(R.st)) {
    if (!r.evacuate || !k.startsWith(`${p.id}:`)) continue;
    const gone = !u.god.disasters.some((d) => d.id === r.evacuate!.disaster);
    if (r.evacuate.until <= u.tick || (gone && r.evacuate.until - u.tick > 120)) {
      // ARC §10.1: the all-clear when the water falls and they come home
      if (r.evacuate.kind === 'flood') {
        const st = p.people?.settlement(Number(k.slice(k.indexOf(':') + 1)));
        if (st && st.fallen < 0) { const x = makeCtx(u, p); tell(u, p, 'flood.home', vars(x, st, -1, {}), st, [settlementRef(x, st)], 1); }
      }
      r.evacuate = null;
    }
  }
}
