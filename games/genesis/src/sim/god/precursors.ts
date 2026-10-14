// GENESIS — warnings and evacuation (LIVING.md §3.7): a disaster the god sends gives the people a chance.
//
//   volcano      a warning phase — rumbling, smoke, small quakes — of ≥ 12 game hours at wrath ≤ 0.5 (2 h at wrath 1,
//                none when the cast says so: an apocalyptic one), then the eruption
//   meteor       a bright streak crosses the sky for an hour before it strikes (≥ 20 min; the fall itself at wrath 1);
//                the streak is an omen (god/omens.ts)
//   tsunami      the sea draws back from the shore ≥ 30 minutes before the wave
//   comet        hangs in the sky for days before it strikes (its own life): the same evacuation
// While it lasts the disaster's view carries `params.warning = 1` (render hook H5). Every settlement in reach gets an
// EVACUATE order: its members walk out to the danger radius + 100 m (high ground for water) and wait there (TASK
// evacuate, people/shelter.ts), with what food and water they can carry, until the danger has passed — then they come
// home. Nothing here strikes anyone: god/disasters.ts holds the effects back until the warning is over.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { DisasterDef } from '../content.ts';
import type { DisasterState } from './state.ts';
import { hashFloat } from '../core/rng.ts';
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
      // the fall itself (24 min) is the streak at wrath 1; at the default the sky shows it for an hour
      return Math.round(w <= 0.5 ? 36 : lerp(36, 0, (w - 0.5) / 0.5));
    case 'tsunami':
      return Math.round(w < 1 ? 40 : 30);
    default:
      return 0;
  }
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
const WARNED = new Set(['volcano', 'supervolcano', 'meteor', 'tsunami', 'comet']);

/** a warned disaster begins: the settlements in reach are told to get out (and the chronicle tells it) */
export function warningStart(u: Universe, p: Planet, d: DisasterState, def: DisasterDef): void {
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
    r.evacuate = { pos: [d.pos[0], d.pos[1], d.pos[2]], radius: Math.round(R + 100), until: u.tick + ticks, disaster: d.id };
    relStat(u, 'evacuations');
    const key = def.id === 'tsunami' ? 'warning.tsunami' : def.id === 'meteor' || def.id === 'comet' ? 'warning.meteor' : 'warning.volcano';
    tell(u, p, key, vars(x, st, -1, { disaster: def.name.toLowerCase() }), st, [settlementRef(x, st)], 1);
    tell(u, p, 'evacuate', vars(x, st, -1, { disaster: def.name.toLowerCase() }), st, [settlementRef(x, st)], 2);
    u.emit({ t: 'evacuate', planet: p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], ref: settlementRef(x, st), data: { settlement: st.id, disaster: d.id, radius: Math.round(R + 100), until: u.tick + ticks } });
    // they drop what they are doing and go (the decision hook gives them the evacuation: god/relationship.ts)
    for (const s of x.ps.members.get(st.id) ?? []) {
      if (x.A.flags[s] & AgentFlag.possessed || x.A.mission[s] || u.god.isHeld('agent', x.A.id[s])) continue;
      interrupt(x, s);
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
  }
}

/** the warning is over: the blow falls (god/disasters.ts fires the effects) */
export function warningEnd(u: Universe, p: Planet, d: DisasterState): void {
  delete d.params.drawback;
  u.emit({ t: 'warning.end', planet: p.id, pos: [...d.pos], ref: { kind: 'disaster', id: d.id, planet: p.id }, data: { kind: d.kind, id: d.id } });
}

/** the evacuation order in force for a settlement (null none) — read only; lapsed orders are cleared hourly */
export function evacuationOf(u: Universe, planet: number, sid: number): { pos: [number, number, number]; radius: number; until: number; disaster: number } | null {
  const e = u.god.rel?.st[`${planet}:${sid}`]?.evacuate;
  return e && e.until > u.tick ? e : null;
}

/** hourly: orders whose time is up are lifted (the people come home) */
export function evacuationsHourly(u: Universe, p: Planet): void {
  const R = u.god.rel;
  if (!R) return;
  for (const [k, r] of Object.entries(R.st)) {
    if (!r.evacuate || !k.startsWith(`${p.id}:`)) continue;
    const gone = !u.god.disasters.some((d) => d.id === r.evacuate!.disaster);
    if (r.evacuate.until <= u.tick || (gone && r.evacuate.until - u.tick > 120)) r.evacuate = null;
  }
}
