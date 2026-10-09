// GENESIS — culture and belief (CONTRACT.md §8.5, §8.8, §13): what a people makes of the world and of its god.
//
//   belief     every agent holds love and fear toward each god (0 = the player, 1.. rivals). WITNESSING an act adds
//              love (help: healing, food, rain in a drought, rescue), fear (harm: destruction, killing, disasters) or
//              both (wonder), by distance, the species' sensitivity and the agent's piety and nerve — the hook other
//              lanes call: witness(planet, pos, radius, kind, magnitude, god). Faith DECAYS with neglect (a god who
//              has not been seen for days fades; prayer and temples slow it). The god a settlement believes in is the
//              one its people love (or fear) most — or none at all. Worship at shrines and temples generates WORSHIP
//              for that god (the pool later phases spend; Snapshot.worship).
//   alignment  love against fear gives the culture its alignment (-1 cruel / fearful .. +1 benevolent): benevolent
//              cultures build warm, open, colourful (style variant 0-3), fearful ones walls, dark stone, spikes (4-7),
//              and offer sacrifices; it picks the music's mode, the era its instruments.
//   stories    settlements remember what happened, and some memories become TABOOS (fire burned the village: they
//              will not make fire, nor take it as a gift, for generations; the sea drowned their boats: no more boats)
//              or SACRED things (the deer that fed them through a famine is never hunted again; iron that fell from
//              the sky is never worked). Taboos are forgotten only generations later.
//   tongues    a settlement's language is a line of drifts from its root tongue (a split adds one): language distance
//              between two settlements is how far their lines have parted (different roots: strangers).
//   contact    when two settlements first meet (territories near, an explorer, a caravan) both remember it, their
//              polities form a relation, and the chronicle tells it — strangely when the others are another species.
//   readings   a settlement that saw the god act tells what it made of it ("They call it a blessing").

import type { PCtx } from './ctx.ts';
import type { Settlement } from './state.ts';
import type { Planet } from '../world/planet.ts';
import { AgentFlag } from '../types.ts';
import { hash32, hashFloat } from '../core/rng.ts';
import { GODS, MEMK, NT, TRAIT } from './defs.ts';
import { speciesInfo } from './ctx.ts';
import { tell, remember } from './story.ts';
import { settlementRef, vars } from './util.ts';
import { distM } from './world.ts';
import { accident } from './knowledge.ts';
import { ensureRelation, polityName, polityOf } from './war.ts';
import { foodDays, storeTake } from './store.ts';
import { cohortTotal } from './cohorts.ts';
import { interrupt } from './people.ts';
import { insertSorted } from './lifecycle.ts';
import { bestBoat, routeBetween } from './missions.ts';
import { animalDef } from '../life/herds.ts';

// ───────────────────────────── tongues ─────────────────────────────

/** 0 the same tongue .. 1 strangers (different roots) */
export function langDistance(a: Settlement, b: Settlement): number {
  const la = a.langLine?.length ? a.langLine : [a.langSeed];
  const lb = b.langLine?.length ? b.langLine : [b.langSeed];
  if (la[0] !== lb[0]) return 1;
  let k = 0;
  while (k < la.length && k < lb.length && la[k] === lb[k]) k++;
  return Math.min(1, ((la.length - k) + (lb.length - k)) * 0.18);
}

// ───────────────────────────── first contact ─────────────────────────────

/** settlements a and b meet (idempotent): contacts, a relation between their polities, the chronicle */
export function meet(x: PCtx, a: Settlement | undefined, b: Settlement | undefined, bySea = false): void {
  if (!a || !b || a.id === b.id || a.fallen >= 0 || b.fallen >= 0) return;
  if (a.contacts.includes(b.id)) return;
  insertSorted(a.contacts, b.id);
  insertSorted(b.contacts, a.id);
  if (a.band || b.band) return;
  if (a.polity === b.polity) return;
  const fresh = !x.ps.relation(a.polity, b.polity);
  const r = ensureRelation(x, a.polity, b.polity);
  if (!r || !fresh) return;
  // first impressions: kin and neighbours of one kind are warmer than strangers
  const same = a.species === b.species;
  const ld = same ? langDistance(a, b) : 1;
  const start = same ? 0.2 - ld * 0.25 : -0.12;
  r.op = [start, start];
  accident(x, a, 'contact', a.cell);
  accident(x, b, 'contact', b.cell);
  const spB = x.c.species.list[b.species];
  const v = vars(x, a, -1, { other: b.name, others: spB.plural.replace(/^the /, ''), desc: describe(spB.body) });
  const key = `contact:${Math.min(a.species, b.species)}:${Math.max(a.species, b.species)}`;
  if (!same && x.ps.firsts[key] === undefined) {
    x.ps.firsts[key] = x.tick;
    tell(x.u, x.p, 'contact.alien', v, a, [settlementRef(x, a), settlementRef(x, b)], 3);
  } else tell(x.u, x.p, same && ld < 0.4 ? 'contact.kin' : bySea ? 'contact.sea' : 'contact', v, a, [settlementRef(x, a), settlementRef(x, b)], same ? 1 : 2);
  remember(b, x.tick, 'contact', `We met the people of ${a.name}.`, 1);
  x.u.emit({ t: 'contact', planet: x.p.id, pos: [b.pos[0], b.pos[1], b.pos[2]], ref: settlementRef(x, b), data: { a: a.id, b: b.id, alien: !same } });
}

function describe(body: string): string {
  switch (body) {
    case 'hexapod-hive': return 'many-legged people who share one mind';
    case 'flyer': return 'people who drift on the air';
    case 'aquatic': return 'people of the water';
    case 'quadruped': return 'people who walk on four legs';
    default: return 'strangers';
  }
}

/**
 * Daily per planet: settlements whose lands are within a day or two's walk meet; a seafaring settlement (boats in its
 * store, or a dock) hears of shores across the water — up to two such voyages of discovery a day.
 */
export function contactsDaily(x: PCtx): void {
  const sts = x.ps.settlements;
  let voyages = 2;
  for (let i = 0; i < sts.length; i++) {
    const a = sts[i];
    if (a.fallen >= 0 || a.band) continue;
    for (let j = i + 1; j < sts.length; j++) {
      const b = sts[j];
      if (b.fallen >= 0 || b.band || a.contacts.includes(b.id)) continue;
      const d = distM(x.p, a.pos, b.pos);
      if (d <= a.territory + b.territory + 1000) { meet(x, a, b); continue; }
      if (voyages <= 0 || d > 4500) continue;
      const sailor = seafaring(x, a) ? a : seafaring(x, b) ? b : null;
      const shore = sailor === a ? b : a;
      if (!sailor || !(shore.res && shore.res.fish.length)) continue;
      // a boat that goes out exploring finds that shore some day: the nearer, the sooner (a few days for a
      // neighbour across a bay, weeks for a coast at the edge of a boat's range)
      if (hashFloat(sailor.id, shore.id, x.tick, 0xc0a5) >= 0.3 * (1 - d / 4500)) continue;
      voyages--;
      const r = routeBetween(x, sailor, shore);
      if (r.sea || r.land) { sailor.boatUse = (sailor.boatUse ?? 0) + 1; meet(x, sailor, shore, true); }
    }
  }
}

/** a settlement that goes to sea: boats in its store or a standing dock */
function seafaring(x: PCtx, st: Settlement): boolean {
  if (bestBoat(x, st) >= 0) return true;
  return x.ps.of(st.id).some((b) => b.progress >= 1 && !(b.flags & 2) && x.c.buildings.list[b.type].function === 'dock');
}

// ───────────────────────────── refugees ─────────────────────────────

/**
 * Some of a conquered (or ruined) settlement will not stay: a share of its households walk to the nearest settlement
 * of their old polity (else of their own kind). Returns how many left.
 */
export function refugees(x: PCtx, st: Settlement, oldPolity: number): number {
  const A = x.A;
  let dest: Settlement | null = null, bd = Infinity;
  for (const o of x.ps.settlements) {
    if (o.id === st.id || o.fallen >= 0 || o.band || o.species !== st.species) continue;
    const d = distM(x.p, st.pos, o.pos) * (o.polity === oldPolity ? 0.5 : 1);
    if (d < bd) { bd = d; dest = o; }
  }
  if (!dest) return 0;
  const leaving = st.households.filter((h, i) => h.members.length > 0 && hash32(h.id, st.id, x.tick, 0x4ef) % 4 === 0 && i >= 0);
  let n = 0;
  for (const h of leaving) {
    for (const id of h.members) {
      const s = A.slotOf(id);
      if (s < 0 || A.mission[s]) continue;
      x.ps.removeMember(st.id, s);
      A.settlement[s] = dest.id;
      A.home[s] = -1;
      x.ps.addMember(dest.id, s);
      A.remember(s, MEMK.exiled, x.tick, st.id);
      interrupt(x, s);
      n++;
    }
    st.households = st.households.filter((o) => o !== h);
    dest.households.push({ id: h.id, members: h.members.slice(), home: -1 });
  }
  if (n >= 3) tell(x.u, x.p, 'diaspora.refugees', vars(x, st, -1, { other: dest.name, count: n }), dest, [settlementRef(x, st), settlementRef(x, dest)], 2);
  return n;
}

// ───────────────────────────── witnessing the god ─────────────────────────────

export type WitnessKind = 'help' | 'harm' | 'wonder';

/**
 * Hook API (CONTRACT §8.8): the people around `pos` (within `radius` metres) witness an act of god `god` (0 = the
 * player): help adds love, harm adds fear, wonder some of both — by distance, the species' bias and the agent's piety
 * and nerve. Settlements that saw it read it (chronicled at the next step). Returns the number of witnesses.
 */
/** how many acts were witnessed so far (the god layer tells whether a command already let people see it) */
export const witnessCounter = { n: 0 };

export function witness(p: Planet, pos: ArrayLike<number>, radius: number, kind: WitnessKind, magnitude: number, god = 0): number {
  witnessCounter.n++;
  const ps = p.people;
  const c = ps?.contentRef;
  if (!ps || !c || ps.agents.count === 0 && !ps.settlements.length) return 0;
  const info = speciesInfo(c);
  const A = ps.agents;
  const g = Math.max(0, Math.min(GODS - 1, god | 0));
  const tick = ps.now;
  const R = p.st.radius;
  const pt = [0, 0, 0];
  const mag = Math.max(0, Math.min(2, magnitude));
  let n = 0;
  for (let s = 0; s < A.hi; s++) {
    if (!A.alive[s]) continue;
    A.posAt(s, tick, pt);
    const d0 = pt[0] * pos[0] + pt[1] * pos[1] + pt[2] * pos[2];
    const d = Math.acos(d0 > 1 ? 1 : d0 < -1 ? -1 : d0) * R;
    if (d > radius) continue;
    const k = 1 - d / Math.max(1, radius);
    const sp = info[A.species[s]].def;
    const piety = A.traits[s * NT + TRAIT.piety];
    const bold = A.traits[s * NT + TRAIT.boldness];
    let love = 0, fear = 0;
    if (kind === 'help') love = mag * k * sp.god.awe * (0.5 + piety);
    else if (kind === 'harm') fear = mag * k * sp.god.fear * (0.6 + (1 - bold) * 0.5);
    else { love = 0.45 * mag * k * sp.god.awe * (0.4 + piety); fear = 0.3 * mag * k * sp.god.fear; }
    const i = s * GODS + g;
    A.love[i] = Math.min(1, A.love[i] + love);
    A.fear[i] = Math.min(1, A.fear[i] + fear);
    A.flags[s] |= AgentFlag.sees_god;
    if (mag * k >= 0.15) A.remember(s, kind === 'harm' ? MEMK.fear : MEMK.miracle, tick, -1);
    n++;
  }
  // the settlements that saw it remember, and will tell what they made of it
  for (const st of ps.settlements) {
    if (st.fallen >= 0) continue;
    const d0 = st.pos[0] * pos[0] + st.pos[1] * pos[1] + st.pos[2] * pos[2];
    const d = Math.acos(d0 > 1 ? 1 : d0 < -1 ? -1 : d0) * R;
    if (d > radius + st.territory) continue;
    st.recent.godSeen = tick;
    if (mag >= 0.3 && !ps.pending.some((r) => r.sid === st.id)) ps.pending.push({ sid: st.id, kind, mag, god: g });
  }
  return n;
}

/** the settlements read the acts they witnessed (called by the people step, which can write the chronicle) */
export function flushReadings(x: PCtx): void {
  const l = x.ps.pending;
  if (!l.length) return;
  x.ps.pending = [];
  for (const r of l) {
    const st = x.ps.settlement(r.sid);
    if (!st || st.fallen >= 0) continue;
    if (st.recent.readAt !== undefined && x.tick - st.recent.readAt < x.day) continue;
    st.recent.readAt = x.tick;
    const fearful = st.culture.alignment < -0.2;
    const id = r.kind === 'help' ? (fearful ? 'reading.suspicion' : 'reading.blessing')
      : r.kind === 'harm' ? (fearful ? 'reading.terror' : st.belief > st.fearGod ? 'reading.anger' : 'reading.punishment')
        : 'reading.wonder';
    tell(x.u, x.p, id, vars(x, st), st, [settlementRef(x, st)], r.mag >= 0.8 ? 2 : 1);
    if (r.kind === 'help' && r.mag >= 0.6 && !st.culture.sacred.includes(`god:${r.god}`)) st.culture.sacred.push(`god:${r.god}`);
  }
}

// ───────────────────────────── faith, alignment, taboos (daily) ─────────────────────────────

/** worship flows to the god an agent believes in (none: nothing) */
export function addWorship(x: PCtx, st: Settlement, s: number, amount: number): void {
  const A = x.A;
  let g = -1, bv = 0.05;
  for (let k = 0; k < GODS; k++) { const v = A.love[s * GODS + k] + A.fear[s * GODS + k] * 0.5; if (v > bv) { bv = v; g = k; } }
  if (g < 0) return;
  st.worshipBy[g] = Math.round((st.worshipBy[g] + amount) * 100) / 100;
  if (g === 0) st.worship = st.worshipBy[0];
  x.ps.worship[g] = Math.round((x.ps.worship[g] + amount) * 100) / 100;
}

/** once a day per settlement */
export function cultureDaily(x: PCtx, st: Settlement): void {
  if (st.fallen >= 0) return;
  const A = x.A;
  const members = x.ps.members.get(st.id) ?? [];
  const n = members.length;
  // faith decays with neglect
  const seen = st.recent.godSeen !== undefined && x.tick - st.recent.godSeen < 3 * x.day;
  const love = [0, 0, 0, 0], fear = [0, 0, 0, 0];
  let none = 0;
  for (const s of members) {
    const piety = A.traits[s * NT + TRAIT.piety];
    // the god layer's law 'belief.decay' scales how fast neglected faith fades (god/params)
    const dk = x.u.god.law('belief.decay');
    const lk = 1 - (seen ? 0.004 : 0.025) * (1.2 - piety) * dk;
    const fk = 1 - (seen ? 0.01 : 0.045) * dk;
    let any = 0;
    for (let g = 0; g < GODS; g++) {
      const i = s * GODS + g;
      A.love[i] = Math.round(A.love[i] * lk * 10000) / 10000;
      A.fear[i] = Math.round(A.fear[i] * fk * 10000) / 10000;
      love[g] += A.love[i];
      fear[g] += A.fear[i];
      any = Math.max(any, A.love[i] + A.fear[i]);
    }
    if (any < 0.05) none++;
    if (!seen) A.flags[s] &= ~AgentFlag.sees_god;
  }
  const div = Math.max(1, n);
  st.faith = love.map((v) => Math.round((v / div) * 1000) / 1000);
  st.belief = st.faith[0];
  st.fearGod = Math.round((fear[0] / div) * 1000) / 1000;
  let god = -1, gv = 0.06;
  for (let g = 0; g < GODS; g++) { const v = (love[g] + fear[g] * 0.5) / div; if (v > gv) { gv = v; god = g; } }
  st.god = god;
  st.recent.disbelief = n ? Math.round((none / n) * 1000) / 1000 : 0;
  // alignment from love against fear
  const sp = x.c.species.list[st.species];
  const target = Math.max(-1, Math.min(1, (st.belief * sp.god.awe - st.fearGod * sp.god.fear) * 2));
  st.culture.alignment = Math.round((st.culture.alignment + (target - st.culture.alignment) * 0.15) * 1000) / 1000;
  // conservatism: old settlements harden, discoveries open them
  const age = (x.tick - Math.max(0, st.founded)) / x.year;
  st.culture.conservatism = Math.round(Math.max(0.05, Math.min(0.9, st.culture.conservatism + 0.002 * Math.min(age, 20) / 20 - st.stats.discoveries * 0.0005)) * 1000) / 1000;
  tabooFromStories(x, st);
  sacredFromStories(x, st);
  fadeTaboos(x, st);
  if (st.culture.alignment < -0.4) sacrifice(x, st);
}

/** taboos sworn after what happened to them */
function tabooFromStories(x: PCtx, st: Settlement): void {
  const A = x.A;
  const members = x.ps.members.get(st.id) ?? [];
  const piety = members.length ? members.reduce((a, m) => a + A.traits[m * NT + TRAIT.piety], 0) / members.length : 0.5;
  const sp = x.c.species.list[st.species];
  const people = sp.plural.replace(/^the /, '');
  // a village that burned remembers it: no fire, not even as a gift, for generations
  if ((st.recent.burnedCount ?? 0) >= 3) {
    tell(x.u, x.p, 'burned', vars(x, st, -1, { count: st.recent.burnedCount }), st, [settlementRef(x, st)]);
    for (const id of ['fire-making', 'fire-keeping']) {
      const k = x.rt.byId.get(id);
      if (k === undefined || st.culture.taboos.includes(k) || hashFloat(st.id, k, x.tick, 0xf1e) >= piety) continue;
      st.culture.taboos.push(k);
      st.culture.tabooSince![String(k)] = x.tick;
      if (id === 'fire-making') {
        remember(st, x.tick, 'taboo', `The ${people} of ${st.name} swore never to make fire again.`, 2);
        tell(x.u, x.p, 'taboo.fire', vars(x, st), st, [settlementRef(x, st)], 2);
      }
    }
    st.recent.burnedCount = 0;
  }
  // the sea took their boats
  if ((st.recent.drowned ?? 0) >= 3) {
    const k = x.rt.byId.get('raft-making');
    if (k !== undefined && !st.culture.taboos.includes(k) && hashFloat(st.id, k, x.tick, 0xf1f) < piety + 0.2) {
      st.culture.taboos.push(k);
      st.culture.tabooSince![String(k)] = x.tick;
      tell(x.u, x.p, 'taboo.sea', vars(x, st), st, [settlementRef(x, st)], 2);
    }
    st.recent.drowned = 0;
  }
}

/** sacred things: the animal that saved them from famine, iron from the sky */
function sacredFromStories(x: PCtx, st: Settlement): void {
  const saved = st.recent.savedBy;
  if (saved !== undefined && st.recent.famineAt !== undefined) {
    const P = (x.ps.members.get(st.id)?.length ?? 0) + cohortTotal(st);
    if (foodDays(x, st) > P * 2.5) {
      const a = animalDef(x, saved);
      const tag = `animal:${a?.id ?? saved}`;
      if (a && !st.culture.sacred.includes(tag) && hashFloat(st.id, saved, x.tick, 0x5ac) < 0.6) {
        st.culture.sacred.push(tag);
        tell(x.u, x.p, 'sacred.animal', vars(x, st, -1, { animal: a.name.toLowerCase() }), st, [settlementRef(x, st)], 2);
      }
      delete st.recent.savedBy;
      delete st.recent.famineAt;
    }
  }
  if (st.recent.starIron !== undefined && !st.culture.sacred.includes('item:meteoric-iron')) {
    const members = x.ps.members.get(st.id) ?? [];
    const piety = members.length ? members.reduce((a, m) => a + x.A.traits[m * NT + TRAIT.piety], 0) / members.length : 0.5;
    if (hashFloat(st.id, x.tick, 0x5ad) < piety) {
      st.culture.sacred.push('item:meteoric-iron');
      tell(x.u, x.p, 'sacred.star-iron', vars(x, st), st, [settlementRef(x, st)], 1);
    }
    delete st.recent.starIron;
  }
}

/** a taboo outlives those who swore it: forgotten only after two generations (~50 years), then slowly */
function fadeTaboos(x: PCtx, st: Settlement): void {
  const since = st.culture.tabooSince ?? (st.culture.tabooSince = {});
  const keep: number[] = [];
  for (const k of st.culture.taboos) {
    if (x.info[st.species].taboos.includes(k)) { keep.push(k); continue; }
    const t0 = since[String(k)] ?? -Infinity;
    const years = (x.tick - t0) / x.year;
    if (years < 50 || hashFloat(st.id, k, x.tick, 0x7ab) > 0.01) { keep.push(k); continue; }
    delete since[String(k)];
    tell(x.u, x.p, 'taboo.forgotten', vars(x, st, -1, { knowledge: x.rt.list[k]?.name.toLowerCase() ?? 'it' }), st, [settlementRef(x, st)], 1);
  }
  st.culture.taboos = keep;
}

/** fearful cultures make offerings: the best of the harvest burned, a beast from the pens */
function sacrifice(x: PCtx, st: Settlement): void {
  const temple = x.ps.of(st.id).some((b) => b.progress >= 1 && !(b.flags & 2) && x.c.buildings.list[b.type].function === 'temple');
  if (!temple || hashFloat(st.id, x.tick, 0x5ac1) > 0.3) return;
  const herd = x.ps.herds.find((h) => h.owner === st.id && h.count >= 3);
  let what = '';
  if (herd) { herd.count -= 1; what = animalDef(x, herd.species).name.toLowerCase(); }
  else {
    const food = x.info[st.species].foods.find((i) => (st.store[i] ?? 0) > 4);
    if (food === undefined) return;
    storeTake(st, food, st.store[food] * 0.05);
    what = x.c.items.list[food].name.toLowerCase();
  }
  for (const s of x.ps.members.get(st.id) ?? []) x.A.fear[s * GODS] = Math.min(1, x.A.fear[s * GODS] + 0.01);
  st.worshipBy[0] = Math.round((st.worshipBy[0] + 5) * 100) / 100;
  x.ps.worship[0] = Math.round((x.ps.worship[0] + 5) * 100) / 100;
  if (x.ps.firsts[`sacrifice:${st.id}`] === undefined) {
    x.ps.firsts[`sacrifice:${st.id}`] = x.tick;
    tell(x.u, x.p, 'sacrifice', vars(x, st, -1, { item: what }), st, [settlementRef(x, st)], 1);
  }
}

/** is an animal species sacred to this settlement (never hunted) */
export function sacredAnimal(x: PCtx, st: Settlement | undefined, sp: number): boolean {
  if (!st || !st.culture.sacred.length) return false;
  const a = animalDef(x, sp);
  return !!a && st.culture.sacred.includes(`animal:${a.id}`);
}

// ───────────────────────────── style and music ─────────────────────────────

/** culture style variant 0..7: the language picks 0-3, a fearful culture builds dark and walled (4-7) */
export function styleVariant(st: Settlement): number {
  return ((st.langSeed >>> 5) & 3) + (st.culture.alignment < -0.25 ? 4 : 0);
}

/** the music of a culture: mode by alignment (and its own), tempo by era and mood, instruments by era */
export function musicOf(st: Settlement, atWar: boolean): { mode: number; tempo: number; instruments: number } {
  const a = st.culture.alignment;
  const mode = a > 0.35 ? (st.culture.mode % 2 === 0 ? 3 : 0) : a < -0.35 ? (st.culture.mode % 2 === 0 ? 2 : 6) : [1, 4, 5][st.culture.mode % 3];
  const tempo = Math.round(66 + st.era * 6 + (st.age.kind === 'golden' ? 10 : st.age.kind === 'dark' ? -8 : 0) + (atWar ? 16 : 0));
  const instruments = st.era <= 2 ? 0 : st.era <= 6 ? 1 : st.era <= 8 ? 2 : 3;
  return { mode, tempo, instruments };
}

export { polityName, polityOf };
