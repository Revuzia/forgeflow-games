// GENESIS — omens: signs the god makes with its own powers, and the people's reading of them (LIVING.md §3.4.4).
//
// An act counts as an omen when people see it and it has not happened there in the last 10 days; natural ones (an
// eclipse or a comet nature sends, a rainbow after rain) are read too. Where trust ≥ fear they read it one way, where
// fear rules another; their faith, fear and trust move by the catalogue; a prophet reads it to the town within the day,
// and may foretell its meaning (then the god can make it true); a pious witness in a town without a prophet may rise as
// one (god/prophets.ts). `god.omen { settlement | pos, kind? }` picks the fitting omen for the world (no rainbow without
// sun, no aurora without a magnetic field) and makes it.
//
//   omen            made by                                   trusted reading            feared reading      faith  fear  trust
//   eclipse         the `eclipse` disaster, ≤ 1 day           the god hides its face     the god's anger     +0.20  +0.10   —
//   comet           a comet passing, a meteor shower          a messenger: change comes  a messenger of ruin +0.20  +0.05   —
//   flood           a flood without deaths                    cleansing                  punishment          +0.15  +0.10   —
//   rainbow         weather `rainbow` (after rain, sun low)   a promise                  a reprieve          +0.10   —    +0.10
//   lightning       the lightning sigil on one thing          a choice                   judgement           +0.15  +0.10   —
//   aurora          `aurora-storm` weather                    blessing                   a warning           +0.15   —    +0.05
//   red-rain        `blood-rain` weather (dust-laden rain)    a warning                  a curse             +0.10  +0.10   —
//   still-sun       the sun stands still ≥ 1 h                a great wonder             terror              +0.30  +0.15   —
//   sacred-animal   a herd of the revered species sent near   favour                     appeasement         +0.10   —    +0.10
//   spring          a spring rises near the town              a gift; a sacred place     a gift              +0.10   —    +0.10

import type { CommandRegistry, Args } from './commands.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Settlement } from '../people/state.ts';
import type { PCtx } from '../people/ctx.ts';
import type { Command, CommandResult } from '../types.ts';
import type { V3 } from './state.ts';
import type { ActInfo } from './prayers.ts';
import { AgentFlag } from '../types.ts';
import { hashFloat } from '../core/rng.ts';
import { makeCtx } from '../people/ctx.ts';
import { MEMK, NT, TRAIT } from '../people/defs.ts';
import { tell } from '../people/story.ts';
import { agentName, settlementRef, vars } from '../people/util.ts';
import { distM, sunElevation } from '../people/world.ts';
import { paintWeather } from '../fields/weather.ts';
import { igniteCell } from '../fields/fire.ts';
import { spawnHerd, animalDef } from '../life/herds.ts';
import { anchorSpin } from './params.ts';
import { fail, ok, cellPos3, nearestSettlement, norm, herePos, moveBy, bearingDir } from './util.ts';
import { meansNow, moveSettlement, relOf, relStat, srel } from './regard.ts';
import { spawnDisaster } from './disasters.ts';
import { foretell, heard, makeProphet, prophetOfSettlement } from './prophets.ts';
import { addSacredPlace, revere, sacredAnimalOf } from './sacred.ts';
import { godAct } from './belief.ts';
import { curiosityGain } from '../people/outlets.ts';

export const OMEN_KINDS = ['eclipse', 'comet', 'flood', 'rainbow', 'lightning', 'aurora', 'red-rain', 'still-sun', 'sacred-animal', 'spring'] as const;
export type OmenKind = (typeof OMEN_KINDS)[number];

interface OmenDef { trusted: string; feared: string; faith: number; fear: number; trust: number; sky: boolean; meaning: [string | null, string | null] }

/** the catalogue: readings, deltas, seen by the whole world (sky) or near it, and what a prophet foretells of it */
export const OMENS: Record<OmenKind, OmenDef> = {
  eclipse: { trusted: 'the god hides its face: hardship comes', feared: 'the god is angry', faith: 0.2, fear: 0.1, trust: 0, sky: true, meaning: ['harm', 'harm'] },
  comet: { trusted: 'a messenger: change is coming', feared: 'a messenger of ruin', faith: 0.2, fear: 0.05, trust: 0, sky: true, meaning: ['sign', 'harm'] },
  flood: { trusted: 'the waters cleanse them', feared: 'the waters punish them', faith: 0.15, fear: 0.1, trust: 0, sky: false, meaning: [null, null] },
  rainbow: { trusted: 'a promise', feared: 'a reprieve', faith: 0.1, fear: 0, trust: 0.1, sky: false, meaning: ['sign', null] },
  lightning: { trusted: 'a choice: the one spared is chosen', feared: 'judgement', faith: 0.15, fear: 0.1, trust: 0, sky: false, meaning: [null, 'harm'] },
  aurora: { trusted: 'a blessing', feared: 'a warning', faith: 0.15, fear: 0, trust: 0.05, sky: true, meaning: ['sign', 'harm'] },
  'red-rain': { trusted: 'a warning', feared: 'a curse', faith: 0.1, fear: 0.1, trust: 0, sky: false, meaning: ['harm', 'harm'] },
  'still-sun': { trusted: 'a great wonder', feared: 'terror', faith: 0.3, fear: 0.15, trust: 0, sky: true, meaning: ['sign', 'harm'] },
  'sacred-animal': { trusted: 'the god\'s favour', feared: 'that the god must be appeased', faith: 0.1, fear: 0, trust: 0.1, sky: false, meaning: ['food', null] },
  spring: { trusted: 'a gift, and a holy place', feared: 'a gift', faith: 0.1, fear: 0, trust: 0.1, sky: false, meaning: [null, null] },
};

const NAMES: Record<OmenKind, string> = {
  eclipse: 'the sun darkened', comet: 'a comet in the sky', flood: 'the waters rise', rainbow: 'a rainbow', lightning: 'lightning strike close by',
  aurora: 'lights dancing in the sky', 'red-rain': 'red rain', 'still-sun': 'the sun stand still', 'sacred-animal': 'the sacred beasts come', spring: 'a spring rise from the ground',
};

/** an omen ten days quiet is an omen again */
const QUIET_DAYS = 10;
const _p = [0, 0, 0];

// ───────────────────────────── reading ─────────────────────────────

/**
 * An omen is seen: every settlement in sight (the whole world for a sky omen) that has not seen this omen in 10 days
 * reads it; its prophet reads it to the town and may foretell its meaning; a pious witness may rise as a prophet.
 * Returns the settlements that read it.
 */
export function readOmen(u: Universe, p: Planet, kind: OmenKind, pos: ArrayLike<number>, radius: number, god: number): number[] {
  const ps = p.people;
  if (!ps || !ps.settlements.length) return [];
  const x = makeCtx(u, p);
  const def = OMENS[kind];
  const R = relOf(u);
  const day = x.day;
  const read: number[] = [];
  let seen = 0;
  for (const st of ps.settlements) {
    if (st.fallen >= 0) continue;
    if (!def.sky && distM(p, st.pos, pos) > radius + st.territory + 1500) continue;
    const r = srel(u, p.id, st.id);
    const last = r.omens[kind];
    if (last !== undefined && u.tick - last < QUIET_DAYS * day) continue;
    r.omens[kind] = u.tick;
    const m = meansNow(x, st);
    const trusted = m.trust >= m.fear;
    moveSettlement(x, st, { faith: def.faith, fear: def.fear, trust: def.trust * (trusted ? 1 : 0.5) });
    const members = x.ps.members.get(st.id) ?? [];
    seen += members.length;
    // (LIVING §2.9: an omen is a new thing to wonder at — LAND's curiosity outlet, wired at integration 2026-10-20)
    for (const s of members) { x.A.remember(s, MEMK.omen, u.tick, OMEN_KINDS.indexOf(kind)); x.A.flags[s] |= AgentFlag.sees_god; curiosityGain(x, s, 0.15); }
    st.recent.godSeen = u.tick;
    r.acts.push({ kind: `omen:${kind}`, tick: u.tick, god, dead: 0, foretold: false, provoked: false, key: `omen:${kind}:${u.tick}` });
    if (r.acts.length > 12) r.acts.splice(0, r.acts.length - 12);
    read.push(st.id);
    relStat(u, `omen.${kind}`);
    // the prophet reads it to the town (and may foretell what it means)
    const ph = prophetOfSettlement(u, p.id, st.id);
    let reader = '';
    if (ph && heard(u, ph)) {
      const s = x.A.slotOf(ph.agent);
      if (s >= 0) {
        reader = agentName(x, s);
        ph.readAt = u.tick;
        moveSettlement(x, st, { faith: 0.05 * ph.credibility });
        const meaning = def.meaning[trusted ? 0 : 1];
        if (meaning && hashFloat(ph.agent, u.tick, OMEN_KINDS.indexOf(kind), 0x0e11) < 0.5 * ph.credibility) foretell(x, ph, meaning, 3, 'prophet');
      }
    }
    const reading = trusted ? def.trusted : def.feared;
    const text = reader ? `${reader} read ${NAMES[kind]} to ${st.name}: ${reading}.` : `In ${st.name} they saw ${NAMES[kind]}, and said it meant ${reading}.`;
    tell(u, p, 'omen', vars(x, st, -1, { text }), st, [settlementRef(x, st)], 1);
    u.emit({ t: 'omen', planet: p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], ref: settlementRef(x, st), text: kind, data: { kind, settlement: st.id, reading: trusted ? 'trusted' : 'feared', god } });
    // a pious witness in a town without a prophet may rise as one
    if (!ph) riseProphet(x, st, kind, pos, def.sky);
    // a spring the god raised by a town that trusts it is a holy place
    if (kind === 'spring' && trusted) addSacredPlace(u, p, st, pos, 'omen', 'spring');
  }
  R.omens.push({ kind, planet: p.id, pos: [pos[0], pos[1], pos[2]], tick: u.tick, god, settlements: read, seen });
  if (R.omens.length > 24) R.omens.splice(0, R.omens.length - 24);
  return read;
}

/** a pious person (piety ≥ 0.75) who saw a wonder close by (≤ 150 m; anywhere for a sky omen) declares it: p = 0.15 */
function riseProphet(x: PCtx, st: Settlement, kind: OmenKind, pos: ArrayLike<number>, sky: boolean): void {
  if (kind === 'flood') return;
  const A = x.A;
  const members = (x.ps.members.get(st.id) ?? []).slice().sort((a, b) => A.id[a] - A.id[b]);
  for (const s of members) {
    if (A.flags[s] & AgentFlag.child || A.traits[s * NT + TRAIT.piety] < 0.75) continue;
    if ((x.tick - A.birth[s]) / x.year < 16) continue;
    if (!sky) { A.posAt(s, x.tick, _p); if (distM(x.p, _p, pos) > 150) continue; }
    if (hashFloat(A.id[s], x.tick, 0x415e) >= 0.15) continue;
    const ph = makeProphet(x, s, 'risen', 0.15);
    if (typeof ph === 'string') return;
    tell(x.u, x.p, 'prophet.risen', vars(x, st, s, { omen: NAMES[kind] }), st, [settlementRef(x, st)], 2);
    return;
  }
}

/** the omens in a god act (god/relationship.ts calls this for each command the god's registry ran) */
export function omensOfCommand(u: Universe, p: Planet, cmd: Command, res: CommandResult, a: Args, killed: boolean): ActInfo[] {
  if (!res.ok) return [];
  const g = typeof cmd.god === 'number' ? cmd.god : 0;
  const pos = (a.pos as V3 | null | undefined) ?? null;
  const out: ActInfo[] = [];
  const sign = (kind: OmenKind, at: ArrayLike<number> | null, radius: number) => {
    const where = at ?? herePos(u, p);
    readOmen(u, p, kind, where, radius, g);
    out.push({ kind: 'sign', planet: p.id, pos: [where[0], where[1], where[2]], radius: OMENS[kind].sky ? Infinity : radius, god: g, settlement: -1 });
  };
  switch (cmd.k) {
    case 'disaster.spawn': {
      const k = String(a.kind);
      if (k === 'eclipse') sign('eclipse', pos, 1e9);
      else if (k === 'comet' || k === 'meteor-shower') sign('comet', pos, 1e9);
      else if (k === 'flood' && !killed) sign('flood', pos, Number(a.radius ?? 380));
      break;
    }
    case 'water.flood': if (!killed) sign('flood', pos, Number(a.radius ?? 400)); break;
    case 'weather.paint': {
      const k = String(a.kind);
      if (k === 'rainbow') sign('rainbow', pos, Number(a.radius ?? 700));
      else if (k === 'aurora-storm') sign('aurora', pos, 1e9);
      else if (k === 'blood-rain') sign('red-rain', pos, Number(a.radius ?? 700));
      break;
    }
    case 'weather.global': {
      const k = String(a.kind);
      if (k === 'aurora-storm') sign('aurora', pos, 1e9);
      else if (k === 'blood-rain') sign('red-rain', pos ?? herePos(u, p), 1e9);
      break;
    }
    case 'miracle.lightning': if (!killed) sign('lightning', pos, 200); break;
    case 'time.freeze-sun': if (a.on !== false) sign('still-sun', pos, 1e9); break;
    case 'water.spring': {
      const st = pos ? nearestSettlement(p, pos, 1500) : null;
      if (st) sign('spring', pos, 400);
      break;
    }
    case 'life.spawn-animal': {
      const st = pos ? nearestSettlement(p, pos, 1500) : null;
      if (st && sacredAnimalOf(st) && sacredAnimalOf(st) === String(a.species)) sign('sacred-animal', pos, 600);
      break;
    }
    case 'god.omen': {
      // the Signs power reads its omen itself (makeOmen → readOmen): here it becomes the god's act of a sign, so a
      // prophecy of a sign is fulfilled by it and a risen prophet near it is confirmed (integration, 2026-10-14: before,
      // only omens made through other powers counted)
      const R = u.god.rel;
      const o = R?.omens[R.omens.length - 1];
      if (o && o.tick === u.tick && o.planet === p.id && o.god === g) {
        const k = o.kind as OmenKind;
        out.push({ kind: 'sign', planet: p.id, pos: [o.pos[0], o.pos[1], o.pos[2]], radius: OMENS[k]?.sky ? Infinity : OMEN_REACH[k] ?? 600, god: g, settlement: -1 });
      }
      break;
    }
  }
  return out;
}

/** how far the people see an omen the Signs power makes on the ground (makeOmen's reading radius), in m */
const OMEN_REACH: Partial<Record<OmenKind, number>> = { flood: 300, rainbow: 900, 'red-rain': 700, lightning: 200, 'sacred-animal': 600, spring: 400 };

/** hourly: omens nature makes — an eclipse or a comet nature sent, a rainbow after the rain with the sun low */
export function naturalOmens(u: Universe, p: Planet): void {
  for (const d of u.god.disasters) {
    if (d.planet !== p.id || d.cause !== 'nature' || d.st.Om) continue;
    if (d.kind === 'eclipse') { d.st.Om = 1; readOmen(u, p, 'eclipse', d.pos, 1e9, 0); }
    else if (d.kind === 'comet' || d.kind === 'meteor-shower') { d.st.Om = 1; readOmen(u, p, 'comet', d.pos, 1e9, 0); }
  }
  if (!p.airy || !p.people?.settlements.length) return;
  const rb = u.content.weather.idx('rainbow');
  if (rb < 0) return;
  for (const st of p.people.settlements) {
    if (st.fallen >= 0) continue;
    // rain just passed over and the sun is low behind them
    const c = st.cell;
    const r = srel(u, p.id, st.id);
    const wet = p.f.precip[c] > 0.5 && p.f.precipType[c] === 1;
    if (wet) { r.since.rain = u.tick; continue; }
    const after = r.since.rain !== undefined && u.tick - r.since.rain <= 90;
    if (!after) continue;
    const el = sunElevation(u, p, u.tick, st.pos);
    if (el < 0.02 || el > 0.4) continue;
    if (hashFloat(st.id, u.tick, 0x7a1b) >= 0.25) continue;
    delete r.since.rain;
    paintWeather(u, p, 'rainbow', st.pos, 900, 75, 1, false);
    readOmen(u, p, 'rainbow', st.pos, 900, 0);
  }
}

// ───────────────────────────── god.omen ─────────────────────────────

/** the fitting omen for a place now (none fits: null) */
function fitting(u: Universe, p: Planet, st: Settlement | null, at: ArrayLike<number>, warning = false): OmenKind | null {
  const r = st ? srel(u, p.id, st.id) : null;
  const fresh = (k: OmenKind) => !r || r.omens[k] === undefined || u.tick - r.omens[k] >= QUIET_DAYS * Math.max(60, Math.round(p.st.dayHours * 60));
  const el = sunElevation(u, p, u.tick, at);
  const order: OmenKind[] = [];
  // (fix r3 #8) a warning is never the rainbow: the people read a rainbow as a promise
  if (p.airy && el > 0.02 && !warning) order.push('rainbow');
  if (p.st.magnetism > 0.1 && p.airy && el < 0) order.push('aurora');
  order.push('lightning', 'comet');
  if (el > 0.05) order.push('eclipse');
  if (p.airy) order.push('red-rain');
  for (const k of order) if (fresh(k)) return k;
  return order[0] ?? null;
}

/**
 * fix r1 #15: where the flood omen's water rises — the lowest dry-land cell in a ring just outside the town's heart
 * (water runs downhill, so the heart stays dry wherever the town is not itself the low point; settlement.ts's
 * `recent.omenFlood` covers that case). Ties go to the lower cell index; with no town named, the god's own point.
 */
function omenFloodAt(p: Planet, st: Settlement | null, at: V3, R: number): V3 {
  if (!st) return at;
  const inner = Math.max(st.territory * 0.6, R * 1.2), outer = st.territory + R;
  let best = -1, bh = Infinity;
  for (const c of p.cellsNear(st.pos, outer)) {
    if (p.s.ocean[c] || distM(p, cellPos3(p, c), st.pos) < inner) continue;
    const h = p.f.surface[c];
    if (h < bh || (h === bh && c < best)) { bh = h; best = c; }
  }
  return best < 0 ? at : cellPos3(p, best);
}

/** make an omen (the god.omen command and the free text "send a sign to Aru") */
function makeOmen(u: Universe, p: Planet, kind: OmenKind, st: Settlement | null, at: V3, god: number): CommandResult {
  const x = p.people ? makeCtx(u, p) : null;
  const where = st ? st.name : 'there';
  switch (kind) {
    case 'eclipse': {
      const d = spawnDisaster(u, p, 'eclipse', { pos: at, life: 120, god, cause: 'god', quiet: true });
      if (typeof d === 'string') return fail(d);
      readOmen(u, p, 'eclipse', at, 1e9, god);
      return ok(`The sun darkens over ${where}.`, [{ kind: 'disaster', id: d.id, planet: p.id }]);
    }
    case 'comet': {
      // a comet that passes (it does not strike: `Ps`)
      const d = spawnDisaster(u, p, 'comet', { pos: moveBy(at, bearingDir(at, 1.1), 40000, p.st.radius), life: 1440, god, cause: 'god', quiet: true, warning: 0 });
      if (typeof d === 'string') return fail(d);
      d.st.Ps = 1;
      readOmen(u, p, 'comet', at, 1e9, god);
      return ok(`A comet hangs in the sky over ${where}, and passes.`, [{ kind: 'disaster', id: d.id, planet: p.id }]);
    }
    case 'flood': {
      if (!x) return fail('There is nobody here to see it.');
      // (fix r1 #15: "a flood without deaths" — a sign, not the disaster. It used to be a 200 m flood on the heart that
      // drowned the town's centre for half a day, so every town sent it fell. Now the water rises in the low ground in a
      // ring outside the heart, smaller and shorter; the disaster is marked `Om` (no harm, no wreck, no crop loss, no
      // drowned-town consequence: disasters.ts) and the towns it touches are stamped `recent.omenFlood` for a day, so
      // abandonCheck does not count it as their place failing them: settlement.ts)
      const R = 120;
      const d = spawnDisaster(u, p, 'flood', { pos: omenFloodAt(p, st, at, R), radius: R, intensity: 0.25, life: 240, god, cause: 'god', quiet: true });
      if (typeof d === 'string') return fail(d);
      d.st.Om = 1;
      for (const s of x.ps.settlements) if (s.fallen < 0 && distM(p, s.pos, d.pos) <= s.territory + R * 3) s.recent.omenFlood = u.tick;
      readOmen(u, p, 'flood', at, 300, god);
      return ok(`The waters rise around ${where}, and fall again.`, [{ kind: 'disaster', id: d.id, planet: p.id }]);
    }
    case 'rainbow': {
      if (!p.airy) return fail(`${p.name} has no air for a rainbow.`);
      if (sunElevation(u, p, u.tick, at) <= 0) return fail(`It is night over ${where}: a rainbow needs the sun. Try an aurora, or lightning.`);
      paintWeather(u, p, 'rainbow', at, 900, 90, 1, false);
      readOmen(u, p, 'rainbow', at, 900, god);
      return ok(`A rainbow stands over ${where}.`);
    }
    case 'aurora': {
      if (!p.airy || p.st.magnetism <= 0.1) return fail(`${p.name} has no magnetic field to light an aurora.`);
      paintWeather(u, p, 'aurora-storm', at, 2000, 360, 1, false);
      readOmen(u, p, 'aurora', at, 1e9, god);
      return ok(`Lights dance in the sky over ${where}.`);
    }
    case 'red-rain': {
      if (!p.airy) return fail(`${p.name} has no air for rain.`);
      paintWeather(u, p, 'blood-rain', at, 700, 240, 1, false);
      readOmen(u, p, 'red-rain', at, 700, god);
      return ok(`Red rain falls on ${where}.`);
    }
    case 'lightning': {
      // one tall tree near the town, away from every person (a sign, not a smiting)
      const c = strikeTarget(u, p, at);
      const pos = cellPos3(p, c);
      u.emit({ t: 'lightning', planet: p.id, pos, a: 1.2, data: { cell: c, god, omen: 1 } });
      if (p.airy) igniteCell(u, p, c, 0.5, 'lightning');
      readOmen(u, p, 'lightning', pos, 200, god);
      if (st && x) addSacredPlace(u, p, st, pos, 'omen', p.f.tree[c] >= 0.4 ? 'grove' : 'site');
      return ok(`Lightning strikes a single tree by ${where}.`);
    }
    case 'still-sun': {
      anchorSpin(u, p);
      p.st.sunFrozen = true;
      relOf(u).stats[`sun@${p.id}`] = u.tick + 60;
      readOmen(u, p, 'still-sun', at, 1e9, god);
      return ok(`The sun stands still over ${where} for an hour.`);
    }
    case 'sacred-animal': {
      if (!x || !st) return fail('Send the sacred animal to whom? Name a town.');
      let sp = -1;
      const tag = sacredAnimalOf(st);
      if (tag) sp = x.c.animals.idx(tag);
      if (sp < 0) {
        // the wild herd nearest the town is the one they will revere
        let bd = 3000;
        for (const h of x.ps.herds) {
          if (h.owner >= 0) continue;
          const a = animalDef(x, h.species);
          if (!a || a.kind === 'fish' || a.swarm) continue;
          const d = distM(p, h.from, st.pos);
          if (d < bd) { bd = d; sp = h.species; }
        }
        if (sp < 0) return fail(`There are no beasts near ${st.name} to send.`);
        const a = animalDef(x, sp);
        if (a) revere(x, st, a.id, 'omen');
      }
      const c = p.cellAt(moveBy(st.pos, bearingDir(st.pos, 0.7), st.territory + 120, p.st.radius));
      spawnHerd(x, sp, c, 6);
      readOmen(u, p, 'sacred-animal', cellPos3(p, c), 600, god);
      return ok(`The sacred ${(animalDef(x, sp)?.name ?? 'beasts').toLowerCase()} come to ${st.name}.`);
    }
    case 'spring': {
      const c0 = p.cellAt(st ? moveBy(st.pos, bearingDir(st.pos, 2.2), st.territory + 60, p.st.radius) : at);
      const id = u.ids.alloc('spring');
      p.springs.push({ id, cell: c0, rate: 40, life: -1 });
      readOmen(u, p, 'spring', cellPos3(p, c0), 400, god);
      return ok(`A spring rises from the ground by ${where}.`);
    }
  }
}

/** the strike of a lightning omen: the tallest tree within 400 m of `at` with nobody within 60 m (else the bare ground) */
function strikeTarget(u: Universe, p: Planet, at: ArrayLike<number>): number {
  const A = p.people?.agents;
  let best = p.cellAt(at), bv = -Infinity;
  for (const c of p.cellsNear(at, 400)) {
    if (p.f.water[c] > 0.1) continue;
    const q = cellPos3(p, c);
    let near = false;
    if (A) for (let s = 0; s < A.hi && !near; s++) { if (!A.alive[s]) continue; A.posAt(s, u.tick, _p); if (distM(p, _p, q) < 60) near = true; }
    if (near) continue;
    const v = p.f.tree[c] - distM(p, q, at) / 4000;
    if (v > bv || (v === bv && c < best)) { bv = v; best = c; }
  }
  return best;
}

/** per tick: a sun the god stopped for an omen moves again after its hour */
export function omensTick(u: Universe): void {
  const s = u.god.rel?.stats;
  if (!s) return;
  for (const p of u.planets) {
    const k = `sun@${p.id}`;
    const t = s[k];
    if (t === undefined || t > u.tick) continue;
    delete s[k];
    anchorSpin(u, p);
    p.st.sunFrozen = false;
  }
}

export function registerOmenCommands(r: CommandRegistry): void {
  r.register('god.omen', ({ u, p, cmd }, a) => {
    const g = typeof cmd.god === 'number' ? cmd.god : 0;
    const st = typeof a.settlement === 'number' ? p.people?.settlement(a.settlement) ?? null : a.pos ? nearestSettlement(p, a.pos, 2500) : null;
    if (typeof a.settlement === 'number' && (!st || st.fallen >= 0)) return fail('There is no such settlement.');
    // a sign sent to a named settlement stands over it: `a.pos` falls back to the camera focus when the command names no
    // place (god/commands.ts resolvePos), so it wins only when the command gave one itself (integration 2026-10-28:
    // before, a sign sent to a town far from the focus landed at the focus and could not fulfil its prophet's word)
    const placed = Array.isArray(cmd.pos) || (typeof cmd.lat === 'number' && typeof cmd.lon === 'number') || typeof cmd.cell === 'number';
    const at: V3 = st && typeof a.settlement === 'number' && !placed ? [st.pos[0], st.pos[1], st.pos[2]] : a.pos ? norm(a.pos) : st ? [st.pos[0], st.pos[1], st.pos[2]] : herePos(u, p);
    const kind = (typeof a.kind === 'string' ? a.kind : fitting(u, p, st, at, a.warning === true)) as OmenKind | null;
    if (!kind) return fail('No sign fits this world now.');
    // the same sign again within ten days is weather to the town it was sent to: no wonder either (integration
    // 2026-10-28: once the sign stood over the named town, the wonder witnessed there moved faith on every repeat)
    const last = st ? srel(u, p.id, st.id).omens[kind] : undefined;
    const stale = last !== undefined && u.tick - last < QUIET_DAYS * Math.max(60, Math.round(p.st.dayHours * 60));
    const res = makeOmen(u, p, kind, st, at, g);
    if (res.ok && !stale) godAct(u, p, at, 600, { wonder: 0.25 }, g);
    return res;
  }, {
    desc: 'Send a sign: an eclipse, a comet, a rainbow, lightning on one tree, an aurora, red rain, the sun standing still, the sacred animal, a spring', category: 'Signs',
    params: { settlement: { type: 'int', min: 0 }, pos: { type: 'pos' }, kind: { type: 'enum', values: [...OMEN_KINDS] }, warning: { type: 'boolean' } },
  });
}

/** query 'omens': the omens of the last days, and the catalogue */
export function omensQuery(u: Universe): Record<string, unknown> {
  return { recent: (u.god.rel?.omens ?? []).map((o) => ({ ...o })), catalogue: OMENS, kinds: OMEN_KINDS };
}

