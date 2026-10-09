// GENESIS — the chronicle (CONTRACT.md §13), phase 1: entries are appended through Universe.chronicleAdd (dated with the
// planet's calendar, prefixed "Year N.") from god acts (air, the star, the sun standing still) and from the world's
// FIRSTS, checked hourly here: first rain, first snow, first sea, first plants (life), first forest (vegetation.ts),
// first fire (fire.ts). Firsts that already exist when a world is generated are marked at tick 0 so a living world does
// not announce its own oceans. Later phases add discoveries, foundings, wars, extinctions… through templates
// (events.json).

import type { ChronicleEntry } from './types.ts';
import type { Universe } from './world/universe.ts';
import type { Planet } from './world/planet.ts';
import type { PCtx } from './people/ctx.ts';
import type { Settlement } from './people/state.ts';
import { tell } from './people/story.ts';
import { agentName, settlementRef, vars } from './people/util.ts';
import { cohortTotal } from './people/cohorts.ts';
import { foodDays } from './people/store.ts';
import { NS, SKILL } from './people/defs.ts';
import { sunElevation } from './people/world.ts';

export const CHRONICLE_CADENCE = 60;
export const CHRONICLE_OFFSET = 45;

/**
 * Mark what a freshly generated world already has (no announcements for those). A world made with air is a living
 * world: the water its lakes and dry seas gather in its first hours is not "the first sea" (a desert world with almost
 * no ocean announced one on its first morning), nor is its first shower the first rain. Only a dead world gets those.
 */
export function markInitialFirsts(p: Planet): void {
  const f = p.f;
  if (p.st.atmosphere.pressure >= 0.02) p.firsts.air = 0;
  if (p.hydro.oceanCells > p.count * 0.01 || p.airy) p.firsts.sea = 0;
  let rain = false, snow = false, trees = 0;
  for (let c = 0; c < p.count; c++) {
    if (f.precip[c] > 0) { if (f.precipType[c] === 2) snow = true; else rain = true; }
    if (f.tree[c] > 0.5) trees++;
  }
  if (p.vegTotal > 1) p.firsts.life = 0;
  if (trees > 40) p.firsts.forest = 0;
  if (p.airy) p.firsts.rain = 0;
  void rain;
  if (p.airy && snow) p.firsts.snow = 0;
}

/** hourly: look for firsts */
export function chronicleCheck(u: Universe, p: Planet): void {
  const f = p.f, fs = p.firsts;
  if (fs.rain === undefined || fs.snow === undefined) {
    for (let c = 0; c < p.count; c += 3) {
      if (f.precip[c] <= 0) continue;
      const t = f.precipType[c];
      if (fs.rain === undefined && (t === 1 || t === 5 || t === 6) && !(p.s.ocean[c] && f.water[c] > 0.5)) {
        fs.rain = u.tick;
        u.chronicleAdd(p, 'nature', 'Rain fell for the first time, and ran down the stone.', 2);
      }
      if (fs.snow === undefined && t === 2) {
        fs.snow = u.tick;
        u.chronicleAdd(p, 'nature', 'The first snow fell.', 1);
      }
      if (fs.rain !== undefined && fs.snow !== undefined) break;
    }
  }
  if (fs.sea === undefined) {
    let wet = 0;
    for (let c = 0; c < p.count; c += 4) if (f.water[c] > 1) wet++;
    if (wet * 4 > p.count * 0.02) {
      fs.sea = u.tick;
      u.chronicleAdd(p, 'nature', 'Water gathered in the low places, and the first sea lay under the sky.', 3);
    }
  }
  if (fs.life === undefined && p.vegTotal > 1) {
    fs.life = u.tick;
    u.chronicleAdd(p, 'nature', 'Green came to the world: the first plants took root.', 3);
  }
  milestonesCheck(u, p, false);
}

// ───────────────────────────── milestones (the opening, CONTRACT §16.1) ─────────────────────────────

/** the opening's beats, in the order a dead rock usually meets them */
export const MILESTONES = ['air', 'first-rain', 'first-sea', 'first-green', 'first-people', 'first-fire', 'first-night', 'first-settlement', 'first-discovery'] as const;

const MILESTONE_WORDS: Record<string, string> = {
  air: 'The world has air.', 'first-rain': 'The first rain.', 'first-sea': 'The first sea.', 'first-green': 'The first green.',
  'first-people': 'Someone is there to see it.', 'first-fire': 'They have fire.', 'first-night': 'Their first night.',
  'first-settlement': 'They have settled.', 'first-discovery': 'They worked something out that nobody taught them.',
};

/** is a milestone's condition true on this world now */
function milestoneHolds(u: Universe, p: Planet, kind: string): boolean {
  const ps = p.people;
  const peopled = !!ps && (ps.agents.count > 0 || ps.settlements.some((st) => st.fallen < 0 && cohortTotal(st) >= 1));
  switch (kind) {
    case 'air': return p.airy;
    case 'first-rain': return p.firsts.rain !== undefined;
    case 'first-sea': return p.firsts.sea !== undefined;
    case 'first-green': return p.firsts.life !== undefined || p.vegTotal > 1;
    case 'first-people': return peopled;
    case 'first-fire': {
      if (!ps || !peopled) return false;
      // fire of their own: a lit hearth, kiln or forge
      for (const b of ps.buildings) if (b.fuel > 0 && b.progress >= 1 && (u.content.buildings.list[b.type]?.heat ?? 0) > 0) return true;
      return false;
    }
    case 'first-night': {
      if (!ps || !peopled) return false;
      const st = ps.settlements.find((s) => s.fallen < 0);
      if (!st) return false;
      return sunElevation(u, p, u.tick, st.pos) < -0.03;
    }
    case 'first-settlement': return !!ps && ps.settlements.some((st) => !st.band && st.fallen < 0);
    case 'first-discovery': return !!ps && ps.firsts.discovery !== undefined;
    default: return false;
  }
}

/**
 * Hourly: the opening's beats (air, first rain, sea, green, people, fire, night, settlement, discovery) as 'milestone'
 * events the opening UI listens for (data.kind). Each is told once per world; what a world already had when it was
 * made (or a scenario set down) is marked silently (`silent`), so a living world never announces its own seas.
 */
export function milestonesCheck(u: Universe, p: Planet, silent: boolean): void {
  for (const kind of MILESTONES) {
    const key = `m:${kind}`;
    if (p.firsts[key] !== undefined) continue;
    // a people set down with its world has lived through nights before (at noon its first night is not news)
    const held = milestoneHolds(u, p, kind) || (silent && kind === 'first-night' && milestoneHolds(u, p, 'first-people'));
    if (!held) continue;
    p.firsts[key] = u.tick;
    if (silent) continue;
    u.emit({ t: 'milestone', planet: p.id, text: MILESTONE_WORDS[kind], data: { kind } });
  }
}

/** chronicle entries after index `from` (snapshots send only new ones) */
export function chronicleSince(u: Universe, from: number): ChronicleEntry[] {
  return u.chronicle.slice(Math.max(0, from));
}

// ───────────────────────────── the peoples' chronicle (phase 2b) ─────────────────────────────
// Clans for the lines that name who did it ("the kiln-clan of Aru"), golden and dark ages detected from a settlement's
// rolling knowledge, population and prosperity, and the world left empty of people.


/** clan nouns by skill group (the household's mastery names it) */
const CLAN_NOUN: Record<number, string> = {
  [SKILL.gather]: 'basket', [SKILL.hunt]: 'spear', [SKILL.fish]: 'net', [SKILL.farm]: 'plough', [SKILL.herd]: 'herd',
  [SKILL.craft]: 'kiln', [SKILL.smith]: 'forge', [SKILL.build]: 'mason', [SKILL.cook]: 'hearth', [SKILL.heal]: 'herb',
  [SKILL.lore]: 'story', [SKILL.sail]: 'boat', [SKILL.fight]: 'shield',
};

/**
 * "the kiln-clan of Aru": the household of agent s named by the craft its grown members are best at; "the house of
 * Hesh" when no one there has mastered anything; the agent alone outside a settlement.
 */
export function clanOf(x: PCtx, s: number): string {
  const A = x.A;
  const st = x.ps.settlement(A.settlement[s]);
  if (!st) return agentName(x, s);
  const hh = st.households.find((h) => h.id === A.household[s]);
  const members = hh ? hh.members : [A.id[s]];
  const sum = new Float64Array(NS);
  let eldest = s;
  for (const id of members) {
    const m = A.slotOf(id);
    if (m < 0) continue;
    if (A.birth[m] < A.birth[eldest]) eldest = m;
    for (let k = 0; k < NS; k++) if (A.skills[m * NS + k] >= 0.55) sum[k] += A.skills[m * NS + k];
  }
  let best = -1, bv = 0;
  for (let k = 0; k < NS; k++) if (sum[k] > bv) { bv = sum[k]; best = k; }
  const place = st.name.split(' ')[0];
  if (best < 0) return `the house of ${agentName(x, eldest)}`;
  let noun = CLAN_NOUN[best] ?? 'hearth';
  // crafters are named for their fire: kiln, furnace, loom...
  if (best === SKILL.craft) {
    const has = (id: string) => { const k = x.rt.byId.get(id); return k !== undefined && members.some((mid) => { const m = A.slotOf(mid); return m >= 0 && A.knows(m, k); }); };
    noun = has('glassmaking') ? 'glass' : has('kiln-firing') ? 'kiln' : has('weaving') ? 'loom' : has('pottery') ? 'pot' : has('carpentry') ? 'adze' : 'flint';
  }
  return `the ${noun}-clan of ${place}`;
}

/** prosperity of a settlement: food in store, goods of value, roofs — per head */
function prosperity(x: PCtx, st: Settlement, pop: number): number {
  let value = 0;
  for (let i = 0; i < st.store.length; i++) if (st.store[i] > 0) value += st.store[i] * x.c.items.list[i].value;
  let beds = 0;
  for (const b of x.ps.of(st.id)) if (b.progress >= 1 && !(b.flags & 2)) beds += x.c.buildings.list[b.type].capacity;
  return Math.min(10, foodDays(x, st) / pop) + Math.min(5, value / pop / 2) + Math.min(3, (beds / pop) * 2);
}

/** daily per settlement: golden and dark ages from a year of knowledge, population and prosperity */
export function agesDaily(x: PCtx, st: Settlement): void {
  if (st.band || st.fallen >= 0) return;
  const pop = Math.max(1, (x.ps.members.get(st.id)?.length ?? 0) + cohortTotal(st));
  const h = st.age.hist;
  h.push([st.library.length, Math.round(pop * 10) / 10, Math.round(prosperity(x, st, pop) * 100) / 100]);
  const span = Math.max(4, Math.round(x.year / x.day));
  while (h.length > span + 1) h.shift();
  if (h.length < span + 1) return;
  const [k0, p0] = h[0];
  const [k1, p1] = h[h.length - 1];
  let q = 0;
  for (const e of h) q += e[2];
  q /= h.length;
  const lost = st.stats.lost - (st.recent.lostSeen ?? st.stats.lost);
  st.recent.lostSeen = st.stats.lost;
  const golden = k1 - k0 >= Math.max(3, k0 * 0.12) && p1 >= p0 && q >= 4;
  // (knowledge judged by its trend over the window: one elder's death taking two ideas on one day declared a dark age
  // that ended the next — sixteen of them in thirty years)
  void lost;
  const darkCause = p1 < p0 * 0.7 ? 'its people dwindled' : k1 < k0 - Math.max(2, k0 * 0.1) ? 'what it knew was forgotten' : q < 1.2 && st.stats.starved > 0 ? 'hunger stalked it' : '';
  const age = st.age;
  if (age.kind === 'golden') {
    if (darkCause || k1 - k0 < 1 || p1 < p0 * 0.92 || q < 3) {
      age.kind = '';
      age.since = x.tick;
      tell(x.u, x.p, 'age.golden.end', vars(x, st), st, [settlementRef(x, st)], 2);
    }
  } else if (age.kind === 'dark') {
    // a dark age lasts at least half a year
    if (!darkCause && p1 >= p0 && q > 2 && x.tick - age.since > (span * x.day) / 2) {
      age.kind = '';
      age.since = x.tick;
      tell(x.u, x.p, 'age.dark.end', vars(x, st), st, [settlementRef(x, st)], 2);
    }
  } else if (darkCause && x.tick - age.since > span * x.day) {
    age.kind = 'dark';
    age.since = x.tick;
    tell(x.u, x.p, 'age.dark', vars(x, st, -1, { cause: darkCause }), st, [settlementRef(x, st)], 3);
    x.u.emit({ t: 'age', planet: x.p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], text: 'dark', ref: settlementRef(x, st) });
  } else if (golden && x.tick - age.since > span * x.day) {
    age.kind = 'golden';
    age.since = x.tick;
    tell(x.u, x.p, 'age.golden', vars(x, st), st, [settlementRef(x, st)], 3);
    x.u.emit({ t: 'age', planet: x.p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], text: 'golden', ref: settlementRef(x, st) });
  }
}

/** after a fall: a world whose people are all gone is told once */
export function checkWorldEmpty(x: PCtx): void {
  if (x.ps.firsts.peopled === undefined || x.ps.firsts.abandoned !== undefined) return;
  if (x.A.count > 0) return;
  if (x.ps.settlements.some((st) => st.fallen < 0 && cohortTotal(st) >= 1)) return;
  x.ps.firsts.abandoned = x.tick;
  tell(x.u, x.p, 'world.abandoned', { planet: x.p.name }, null, undefined, 3);
  x.u.emit({ t: 'world.abandoned', planet: x.p.id });
}

/**
 * A settlement put something into orbit (an orbital rocket made at its launchpad, or a launch): the first of a world is
 * told once, with the settlement's name. Idempotent per planet; the launch system calls it too.
 */
export function firstOrbit(x: PCtx, st: Settlement): void {
  if (x.ps.firsts.orbit !== undefined) return;
  x.ps.firsts.orbit = x.tick;
  tell(x.u, x.p, 'orbit.first', vars(x, st), st, [settlementRef(x, st)], 3);
  x.u.emit({ t: 'orbit.first', planet: x.p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], ref: settlementRef(x, st) });
}
