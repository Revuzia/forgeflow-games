// GENESIS — ARC §2.2-2.7: the Tower. Proud towns of one speech come together and build a tower to be seen from
// everywhere; the god answers it (confuse their tongues, strike it down, send a prophet to warn them, let it stand) or
// stays silent until it is finished.
//
//   towerDaily     once a day per planet (arcDaily, after the hearts): the yearly trigger (on year-day
//                  hash32(planet) % yearDays, plus every day while a town is armed by the `babel` scenario), the labour
//                  (builders, material, growth), the one-speech steps, the omens at 25/50/75 %, the Decision card's
//                  `tower.choice` at 25 % and 75 %, the prophet's warning, the organic end, the finish, the rebuild roll
//   towerTask      relDecide's hook: up to ~12 host members a work period walk to the tower and build (TASK.build on the
//                  `great-tower` building record), and a warning prophet preaches at its foot
//   commands       tower.confuse / strike (WRATHFUL) / warn / let, tower.begin (Debug)
//   views          PlanetSnap.towers (TowerView), query('towers')
//
// Deterministic: every roll is hashFloat on the planet / tower / settlement ids and the tick with the §7 salts
// 0x70e1..0x70e5; iteration is in `ps.settlements` / sorted id order.

import { noteWandering } from './story.ts';
import { wordFor } from './legends.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Building, Settlement } from '../people/state.ts';
import type { PCtx } from '../people/ctx.ts';
import type { TaskSpec } from '../people/tasks.ts';
import type { CommandRegistry } from './commands.ts';
import type { ArcEvent, Memory, SettlementRel, TowerState } from './state.ts';
import type { TowerView } from '../types.ts';
import { AgentFlag } from '../types.ts';
import { hash32, hashFloat } from '../core/rng.ts';
import { makeCtx } from '../people/ctx.ts';
import { DEATH, GODS } from '../people/defs.ts';
import { TASK } from '../people/defs.ts';
import { langDistance, styleVariant } from '../people/culture.ts';
import { placeRoot, driftLanguage } from '../people/names.ts';
import { styleOf } from '../people/buildings.ts';
import { materialItems } from '../people/buildings.ts';
import { storeHas, storeTake } from '../people/store.ts';
import { histOf } from '../people/politics.ts';
import { BUD_APART, searchSite, splitOff } from '../people/settlement.ts';

/** §2.4 confuse: the scattered found their towns at least this far from home */
const SCATTER_M = 4000;
/** the least site score a scattered band settles on (the budding path's bar, settlement.ts) */
const SCATTER_SITE = 3.4;
/** the strike's act radius (m): who sees the lightning fall */
const STRIKE_R = 1500;
import { die } from '../people/lifecycle.ts';
import { cohortTotal } from '../people/cohorts.ts';
import { tell } from '../people/story.ts';
import { agentName, settlementRef, vars } from '../people/util.ts';
import { distM, isLand, spotInCell, sunElevation } from '../people/world.ts';
import { stormSeverity } from '../people/shelter.ts';
import { cellPos3, fail, ok } from './util.ts';
import { relOf, srel, peekRel, meansNow, moveSettlement, currentAct, relKey, cruelty, relStat } from './regard.ts';
import { godAct } from './belief.ts';
import { lethality, currentWrath, WRATH_DEFAULT } from './wrath.ts';
import { hardshipOf } from './prayers.ts';
import { ARC } from './arc.ts';
import { prophetOf, prophetOfSettlement } from './prophets.ts';
import { addSacredPlace } from './sacred.ts';
import { emptyMemory, noteHarm } from './arc.ts';

/** ARC §2.2-2.4 tunables (*(ARC)* numbers) */
export const TOWER = {
  minYear: 10,
  gapYears: 20,
  leaderPride: 0.62,
  leaderPop: 50,
  leaguePride: 0.5,
  leagueRadius: 12000,
  leagueLang: 0.45,
  leagueMax: 6,
  harmYears: 2,
  /** the yearly roll (probe-tuned within 0.06-0.30, §8.2) */
  towerChance: 0.25,
  /** the roll's pride base: chance x clamp((pride - rollBase) / 0.3) */
  rollBase: 0.6,
  /** the least crew a league town sends (2 -> 4 in stint 5: unattended towns of ~50 sent 2 each, and a league of two
   *  needed 8 years for half its goal, T4) */
  crew: 4,
  tierM: 12,
  maxTiers: 10,
  rate: 0.12,
  visible: 12,
  /** a visible builder's shift at the tower (TaskSpec work; 120 -> 360 in stint 5: with 120 the site stood empty in
   *  ~45 % of local work hours, T4; 360 -> 600 in stint 6: the walk out from a host 1-1.5 km away took ~750 ticks,
   *  twice the shift, and babel seed 1 had a builder on site in 83 % of daylight hours; 600 -> 99 %) */
  shift: 600,
  /** one speech: every 2 years */
  speechYears: 2,
  hardDays: 10,
  warnDays: 5,
  rebuildYears: 10,
  rebuildChance: 0.15,
  keepEnded: 8,
};

const clamp = (v: number, lo = 0, hi = 1): number => (v < lo ? lo : v > hi ? hi : v);
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const MAT = { mudbrick: 'mudbrick', brick: 'brick', stone: 'stone' } as const;

// ───────────────────────────── lookups ─────────────────────────────

/** §2.4 let / silence: this town is in the league of a tower the god let stand, and still proud (pride >= 0.6) */
export function towerStands(u: Universe, planet: number, sid: number): boolean {
  const T = u.god.rel?.towers;
  if (!T?.length) return false;
  for (const tw of T) {
    if (tw.planet !== planet || tw.status !== 'finished' || (tw.answer !== 'let' && tw.answer !== 'none')) continue;
    if (tw.league.includes(sid) && (peekRel(u, planet, sid)?.pride ?? 0) >= 0.6) return true;
  }
  return false;
}

export function towersOf(u: Universe, planet: number): TowerState[] {
  return (u.god.rel?.towers ?? []).filter((t) => t.planet === planet);
}

/** the planet's rising tower, else its standing (finished) one, else the newest */
export function currentTower(u: Universe, planet: number, id?: number): TowerState | undefined {
  const all = towersOf(u, planet);
  if (typeof id === 'number') return all.find((t) => t.id === id);
  return all.find((t) => t.status === 'rising') ?? all.filter((t) => t.status === 'finished').pop();
}

/** a town builds a rising tower (it is in the league) */
export function risingLeague(u: Universe, planet: number, sid: number): TowerState | undefined {
  return (u.god.rel?.towers ?? []).find((t) => t.planet === planet && t.status === 'rising' && t.league.includes(sid));
}

function memOf(r: SettlementRel): Memory { return (r.memory ??= emptyMemory()); }

export function pushArc(u: Universe, e: Omit<ArcEvent, 'id'>): ArcEvent {
  const R = relOf(u);
  const ev: ArcEvent = { id: R.next++, ...e, towns: e.towns.slice().sort((a, b) => a - b) };
  (R.arcEvents ??= []).push(ev);
  for (const sid of ev.towns) {
    const r = srel(u, e.planet, sid);
    const m = (r.memEvents ??= []);
    if (!m.includes(ev.id)) { m.push(ev.id); m.sort((a, b) => a - b); }
  }
  return ev;
}

function towns(x: PCtx, ids: number[]): Settlement[] {
  const out: Settlement[] = [];
  for (const id of ids) { const st = x.ps.settlement(id); if (st && st.fallen < 0 && !st.band) out.push(st); }
  return out;
}

function grown(x: PCtx, st: Settlement): number[] {
  return (x.ps.members.get(st.id) ?? []).filter((s) => !(x.A.flags[s] & AgentFlag.child));
}

function popOf(x: PCtx, st: Settlement): number { return (x.ps.members.get(st.id) ?? []).length + cohortTotal(st); }

function knowsAny(x: PCtx, st: Settlement, ids: string[]): string | null {
  const ks = ids.map((id) => [id, x.c.recipes.idx(id)] as [string, number]).filter(([, k]) => k >= 0);
  // (best material first: the caller lists them best first)
  for (const [id, k] of ks) for (const s of x.ps.members.get(st.id) ?? []) if (x.A.knows(s, k)) return id;
  return null;
}

function atWar(x: PCtx, st: Settlement): boolean {
  return x.ps.relations.some((q) => q.war >= 0 && (q.a === st.polity || q.b === st.polity));
}

function names(sts: Settlement[]): string {
  const n = sts.map((s) => s.name);
  return n.length <= 1 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

function worldAgeYears(x: PCtx): number {
  let first = Infinity;
  for (const st of x.ps.settlements) if (st.founded >= 0 && st.founded < first) first = st.founded;
  return first === Infinity ? 0 : (x.tick - first) / x.year;
}

function goalOf(era: number): number {
  return era <= 2 ? 60 : era === 3 ? 80 : era <= 5 ? 100 : 120;
}

export function tiersOf(height: number): number {
  return Math.min(TOWER.maxTiers, Math.floor(height / TOWER.tierM) + 1);
}

// ───────────────────────────── the trigger (§2.2) ─────────────────────────────

/** the leader's own conditions (2) */
function leaderOk(x: PCtx, st: Settlement, r: SettlementRel | undefined): boolean {
  if (st.band || st.fallen >= 0 || !r) return false;
  const bias = 0.05 * Math.min(1, r.memory?.humbled ?? 0);
  if ((r.pride ?? 0) < TOWER.leaderPride + bias) return false;
  if (popOf(x, st) < TOWER.leaderPop || st.era < 2) return false;
  if (!knowsAny(x, st, ['masonry', 'bricks', 'mudbrick'])) return false;
  if (atWar(x, st)) return false;
  if (st.hist && st.hist.famine >= 0) return false;
  if (r.lastHarm !== undefined && r.lastHarm >= 0 && x.tick - r.lastHarm < TOWER.harmYears * x.year) return false;
  return true;
}

/** probe/debug: why each town is not a tower leader this year (first failing condition of §2.2 (2)/(3)); no state */
export function towerWhyNot(u: Universe, p: Planet): { id: number; pride: number; why: string; league: number }[] {
  if (!p.people) return [];
  const x = makeCtx(u, p);
  const out: { id: number; pride: number; why: string; league: number }[] = [];
  for (const st of x.ps.settlements) {
    if (st.band || st.fallen >= 0) continue;
    const r = peekRel(u, p.id, st.id);
    const pr = r?.pride ?? 0;
    let why = 'ok';
    if (!r) why = 'norel';
    else if (pr < TOWER.leaderPride + 0.05 * Math.min(1, r.memory?.humbled ?? 0)) why = 'pride';
    else if (popOf(x, st) < TOWER.leaderPop) why = `pop${popOf(x, st)}`;
    else if (st.era < 2) why = 'era';
    else if (!knowsAny(x, st, ['masonry', 'bricks', 'mudbrick'])) why = 'brick';
    else if (atWar(x, st)) why = 'war';
    else if (st.hist && st.hist.famine >= 0) why = 'famine';
    else if (r.lastHarm !== undefined && r.lastHarm >= 0 && x.tick - r.lastHarm < TOWER.harmYears * x.year) why = 'harm';
    const lg = leagueOf(x, st, true).length;
    if (why === 'ok' && lg < 2) why = `league(kin${leagueOf(x, st, false).length})`;
    out.push({ id: st.id, pride: r3(pr), why, league: lg });
  }
  return out;
}

/** probe: every live town's raw §2.2 (2)/(3) inputs, for offline tuning of the trigger (no state) */
export function towerCandidates(u: Universe, p: Planet): { id: number; pride: number; pop: number; era: number; brick: boolean; war: boolean; famine: boolean; harm: boolean; kin: number; age: number }[] {
  if (!p.people) return [];
  const x = makeCtx(u, p);
  const age = r3(worldAgeYears(x));
  const out: { id: number; pride: number; pop: number; era: number; brick: boolean; war: boolean; famine: boolean; harm: boolean; kin: number; age: number }[] = [];
  for (const st of x.ps.settlements) {
    if (st.band || st.fallen >= 0) continue;
    const r = peekRel(u, p.id, st.id);
    let kin = 1;
    for (const o of x.ps.settlements) {
      if (o === st || o.fallen >= 0 || o.band || o.species !== st.species) continue;
      if (distM(x.p, o.pos, st.pos) > TOWER.leagueRadius || langDistance(o, st) > TOWER.leagueLang) continue;
      if (popOf(x, o) < ARC.pridePop || (peekRel(u, p.id, o.id)?.pride ?? 0) >= TOWER.leaguePride) kin++;
    }
    out.push({ id: st.id, pride: r3(r?.pride ?? 0), pop: popOf(x, st), era: st.era, brick: !!knowsAny(x, st, ['masonry', 'bricks', 'mudbrick']),
      war: atWar(x, st), famine: !!(st.hist && st.hist.famine >= 0),
      harm: !!(r && r.lastHarm !== undefined && r.lastHarm >= 0 && x.tick - r.lastHarm < TOWER.harmYears * x.year), kin, age });
  }
  return out;
}

/** the builders' league (3): the leader and up to 5 kin towns of one speech within 12 km, nearest first */
function leagueOf(x: PCtx, host: Settlement, needPride: boolean): Settlement[] {
  const cand: [number, Settlement][] = [];
  for (const o of x.ps.settlements) {
    if (o === host || o.fallen >= 0 || o.band || o.species !== host.species) continue;
    const d = distM(x.p, o.pos, host.pos);
    if (d > TOWER.leagueRadius) continue;
    if (needPride) {
      if (langDistance(o, host) > TOWER.leagueLang) continue;
      // a village too small to have a pride of its own (ARC.pridePop, §2.1) follows a proud kin city of one speech
      // (contract change, stint 4: see _harness/arc-work/contract-changes.md)
      const follows = popOf(x, o) < ARC.pridePop && (peekRel(x.u, x.p.id, host.id)?.pride ?? 0) >= TOWER.leaderPride;
      if (!follows && (peekRel(x.u, x.p.id, o.id)?.pride ?? 0) < TOWER.leaguePride) continue;
    }
    cand.push([d, o]);
  }
  cand.sort((a, b) => a[0] - b[0] || a[1].id - b[1].id);
  return [host, ...cand.slice(0, TOWER.leagueMax - 1).map(([, o]) => o)];
}

/** the site (§2.3): the flattest dry land cell 300-1500 m from the host toward the league's centroid */
function siteOf(x: PCtx, host: Settlement, league: Settlement[]): number {
  const p = x.p, f = p.f, g = p.grid;
  let cx = 0, cy = 0, cz = 0;
  for (const s of league) { cx += s.pos[0]; cy += s.pos[1]; cz += s.pos[2]; }
  cx /= league.length; cy /= league.length; cz /= league.length;
  const dx = cx - host.pos[0], dy = cy - host.pos[1], dz = cz - host.pos[2];
  const dl = Math.hypot(dx, dy, dz);
  const far = distM(p, [cx, cy, cz], host.pos) > 200;
  const near: Building[] = [];
  for (const st of x.ps.settlements) if (st.fallen < 0 && distM(p, st.pos, host.pos) < 4000) near.push(...x.ps.of(st.id));
  let best = -1, bs = Infinity;
  for (let c = 0; c < p.count; c++) {
    const P = cellPos3(p, c);
    const d = distM(p, P, host.pos);
    if (d < 300 || d > 1500) continue;
    if (!isLand(p, c) || f.water[c] > 0.05 || p.s.ocean[c] || f.lava[c] > 0) continue;
    // (the spec's rules are preferences ranked in order — toward the league, slope < 0.08, then the flattest — so a
    // hilly coarse world still finds a site; a building within 60 m is the one hard rule besides dry land)
    let away = 0;
    if (far) {
      const ox = P[0] - host.pos[0], oy = P[1] - host.pos[1], oz = P[2] - host.pos[2];
      if ((ox * dx + oy * dy + oz * dz) / (Math.hypot(ox, oy, oz) * dl || 1) < 0.2) away = 10;
    }
    let sl = 0;
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) sl = Math.max(sl, Math.abs(f.surface[g.nbr[e]] - f.surface[c]) / p.edgeM);
    if (sl > 0.5) continue;
    if (near.some((b) => distM(p, b.pos, P) < 60)) continue;
    const v = away + (sl >= 0.08 ? 1 : 0) + sl;
    if (v < bs || (v === bs && c < best)) { bs = v; best = c; }
  }
  return best;
}

/** begin a tower (the yearly trigger, the scenario's armed check, or tower.begin) */
export function beginTower(x: PCtx, host: Settlement, league: Settlement[], rebuildOf?: TowerState): TowerState | null {
  const u = x.u, p = x.p;
  const cell = rebuildOf ? rebuildOf.cell : siteOf(x, host, league);
  if (cell < 0) return null;
  const mat = rebuildOf?.material ?? (knowsAny(x, host, ['masonry']) ? 'stone' : knowsAny(x, host, ['bricks']) ? 'brick' : 'mudbrick');
  const t = x.c.buildings.idx('great-tower');
  const mi = x.c.materials.idx(MAT[mat]);
  let building = rebuildOf?.building ?? -1;
  if (t >= 0 && mi >= 0 && !(rebuildOf && x.ps.building(building))) {
    const id = u.ids.alloc('building');
    const at = cellPos3(p, cell);
    const b: Building = {
      id, type: t, material: mi, style: styleOf(host), pos: [at[0], at[1], at[2]], cell, rot: Math.round(hashFloat(id, 0x70e6, 0, u.seed) * 6283) / 1000,
      scale: 1, progress: 0, delivered: 0, damage: 0, settlement: host.id, flags: 0, books: [], built: -1, fuel: 0, occupants: 0, household: -1,
    };
    x.ps.addBuilding(b);
    building = id;
  }
  const R = relOf(u);
  const pos = cellPos3(p, cell);
  const root = placeRoot(x.c, host.species, host.language, host.id);
  const goal = goalOf(host.era);
  const tw: TowerState = {
    id: R.next++, planet: p.id, host: host.id, league: league.map((s) => s.id).sort((a, b) => a - b),
    name: rebuildOf?.name ?? `the Tower of ${root}`, cell, pos: [pos[0], pos[1], pos[2]], building,
    material: mat, begun: x.tick, ended: -1,
    height: rebuildOf ? rebuildOf.height : 0, goal, tiers: rebuildOf ? rebuildOf.tiers : 1, builders: 0,
    status: 'rising', answer: 'none', answeredAt: -1, choiceAt: -1, choices: 0, omens: 0, converged: x.tick,
    ...(rebuildOf ? { rebuildOf: rebuildOf.id } : {}),
  };
  if (rebuildOf) tw.tiers = tiersOf(tw.height);
  (R.towers ??= []).push(tw);
  trimTowers(u, p.id);
  for (const s of league) { const r = srel(u, p.id, s.id); delete r.since.towerArm; delete r.since.tDrain; r.since.tLeague = x.tick + x.day; }
  u.emit({ t: rebuildOf ? 'tower.rebuilt' : 'tower.begun', planet: p.id, pos: tw.pos, ref: settlementRef(x, host),
    data: rebuildOf ? { tower: tw.id, of: rebuildOf.id } : { tower: tw.id, league: tw.league.slice() } });
  const others = league.filter((s) => s !== host);
  const g = grown(x, host);
  const speaker = g.length ? g[Math.floor(hashFloat(tw.id, 0x70e7, 0, u.seed) * g.length)] : -1;
  tell(u, p, rebuildOf ? 'tower.rebuilt' : 'tower.begun', vars(x, host, speaker, { host: host.name, league: names(league), count: String(league.length),
    other: others[0]?.name ?? host.name, agent: speaker >= 0 ? agentName(x, speaker) : host.name }), host, league.map((s) => settlementRef(x, s)), rebuildOf ? 2 : 3);
  pushArc(u, { planet: p.id, tick: x.tick, kind: 'tower', name: tw.name, towns: tw.league, god: 'none', dead: 0, ref: tw.id });
  return tw;
}

function trimTowers(u: Universe, planet: number): void {
  const R = relOf(u);
  const ended = (R.towers ?? []).filter((t) => t.planet === planet && t.ended >= 0 && t.status !== 'finished').sort((a, b) => a.ended - b.ended || a.id - b.id);
  while (ended.length > TOWER.keepEnded) { const t = ended.shift()!; R.towers!.splice(R.towers!.indexOf(t), 1); }
}

function yearlyCheck(x: PCtx, armed: boolean): void {
  const u = x.u, p = x.p;
  const all = towersOf(u, p.id);
  if (all.some((t) => t.status === 'rising')) return;
  if (!armed) {
    if (worldAgeYears(x) < TOWER.minYear) return;
    const lastEnd = Math.max(-Infinity, ...all.map((t) => (t.ended >= 0 ? t.ended : t.status === 'finished' ? t.answeredAt : -Infinity)));
    if (lastEnd > -Infinity && x.tick - lastEnd < TOWER.gapYears * x.year) return;
  }
  let host: Settlement | null = null;
  for (const st of x.ps.settlements) {
    const r = peekRel(u, p.id, st.id);
    if (armed && !r?.since.towerArm) continue;
    if (!leaderOk(x, st, r)) continue;
    if (!host || (r?.pride ?? 0) > (peekRel(u, p.id, host.id)?.pride ?? 0)) host = st;
  }
  if (!host) return;
  const league = leagueOf(x, host, true);
  if (league.length < 2) return;
  if (!armed) {
    const year = Math.floor(x.tick / x.year);
    const pr = peekRel(u, p.id, host.id)?.pride ?? 0;
    // (the world seed decorrelates worlds whose first planet shares its id: stint-5 change, contract-changes.md)
    if (hashFloat(p.id, year, 0x70e1, u.seed) >= TOWER.towerChance * clamp((pr - TOWER.rollBase) / 0.3)) return;
  }
  beginTower(x, host, league);
}

// ───────────────────────────── the day (§2.3, §2.4 warn, rebuild) ─────────────────────────────

export function towerDaily(u: Universe, p: Planet): void {
  const ps = p.people;
  if (!ps || !ps.settlements.length) return;
  const x = makeCtx(u, p);
  const yd = Math.max(1, Math.round(x.year / x.day));
  const dayIdx = Math.floor(x.tick / x.day);
  const armed = ps.settlements.some((st) => peekRel(u, p.id, st.id)?.since.towerArm);
  if (armed || dayIdx % yd === hash32(p.id) % Math.min(12, yd)) yearlyCheck(x, armed);
  for (const tw of towersOf(u, p.id)) {
    if (tw.status === 'rising') rising(x, tw);
    else if (tw.status === 'finished') standing(x, tw);
    else if (tw.status === 'struck' && dayIdx % yd === hash32(tw.id) % yd) rebuildRoll(x, tw);
    else if (tw.status === 'scattered' && tw.scatter && tw.scatter.lost === undefined && x.tick >= tw.scatter.until) scatterLost(x, tw);
  }
}

/**
 * §2.4 confuse, a year on (owner 2026-11-08: "confusing the tongues i would imagine would indirectly kill families"): the
 * act itself kills no one, but the scattered who froze or starved in their new towns that first year are counted on the
 * tower (`scatter.lost`, also relStat 'tower.scatterLost') and told once.
 */
function scatterLost(x: PCtx, tw: TowerState): void {
  const sc = tw.scatter!;
  let lost = 0;
  sc.towns.forEach((id, i) => { const st = x.ps.settlement(id); if (st) lost += Math.max(0, st.stats.starved + st.stats.froze - (sc.d0[i] ?? 0)); });
  sc.lost = lost;
  if (!lost) return;
  relStat(x.u, 'tower.scatterLost', lost);
  const host = x.ps.settlement(tw.host);
  const at = x.ps.settlement(sc.towns[0]) ?? host;
  if (!at) return;
  x.u.emit({ t: 'tower.lost', planet: x.p.id, pos: tw.pos, data: { tower: tw.id, lost, towns: sc.towns.slice() } });
  tell(x.u, x.p, 'tower.lost', vars(x, at, -1, { host: host?.name ?? at.name, count: String(lost) }), at, sc.towns.map((id) => x.ps.settlement(id)).filter((s): s is Settlement => !!s).map((s) => settlementRef(x, s)), 2);
}

function rising(x: PCtx, tw: TowerState): void {
  const u = x.u, p = x.p;
  const host = x.ps.settlement(tw.host);
  const league = towns(x, tw.league);
  if (!host || host.fallen >= 0 || !league.includes(host) || league.length < 2) { abandon(x, tw, host); return; }
  tw.league = league.map((s) => s.id).sort((a, b) => a - b);
  // labour
  let B = 0;
  for (const s of league) B += Math.max(TOWER.crew, Math.round(0.06 * grown(x, s).length));
  tw.builders = B;
  // (the building path never finishes it: work is the content cap 1e7, and what the walkers add is put back)
  const bld = x.ps.building(tw.building);
  if (bld && bld.progress > 0) bld.progress = 0;
  const mi = x.c.materials.idx(MAT[tw.material]);
  let got = 0;
  if (mi >= 0) {
    const items = materialItems(x, mi);
    // §2.3: every builder-day takes one unit from the host store, and the league's tribute fills it: one pool, the
    // host's store first, then the league's, nearest first (a village with no clay of its own still has builders fed)
    let need = B;
    for (const s of [host, ...league.filter((q) => q !== host)]) {
      if (need <= 0) break;
      let n = need;
      for (const [it, q] of items) n = Math.min(n, Math.floor(storeHas(s, it) / q));
      if (n <= 0) continue;
      for (const [it, q] of items) storeTake(s, it, n * q);
      got += n; need -= n;
    }
  }
  // what the stores lack, builders who know mudbrick mould at the tower's foot from the ground they stand on (stint-5
  // change, §2.3: no unattended store ever held tower material, so every tower rose at half rate; contract-changes.md)
  if (got < B && knowsAny(x, host, ['mudbrick'])) got = B;
  const have = B > 0 ? 0.5 + 0.5 * Math.min(1, got / B) : 0.5;
  const before = tw.height;
  tw.height = r3(Math.min(tw.goal, tw.height + (TOWER.rate * B * have) / (1 + tw.height / tw.goal)));
  tw.tiers = tiersOf(tw.height);
  // the league's hearts while it rises
  for (const s of league) {
    const r = srel(u, p.id, s.id);
    r.since.tLeague = x.tick + x.day;
    for (const m of x.ps.members.get(s.id) ?? []) { const i = m * GODS; x.A.faith[i] = Math.max(0, x.A.faith[i] - 0.0015); }
    if ((r.since.tDrain ?? 0) < 1) r.since.tDrain = r3(Math.min(1, (r.since.tDrain ?? 0) + 0.0015));
    const h = histOf(x, s);
    h.grievance = Math.max(0, r3(h.grievance - 0.001));
    if (h.why.tongue) h.why.tongue = Math.max(0, r3(h.why.tongue - 0.001));
  }
  // one speech: every two years the league's tongues come together on the host's
  if (x.tick - tw.converged >= TOWER.speechYears * x.year) {
    tw.converged = x.tick;
    for (const s of league) if (s !== host && s.langLine[0] === host.langLine[0]) s.langLine = host.langLine.slice();
  }
  // milestones: tiers, omens, the Decision card
  for (const q of [0.25, 0.5, 0.75]) {
    if (before < q * tw.goal && tw.height >= q * tw.goal) {
      u.emit({ t: 'tower.tier', planet: p.id, pos: tw.pos, ref: settlementRef(x, host), data: { tower: tw.id, tiers: tw.tiers, height: tw.height } });
      const others = league.filter((s) => s !== host);
      tell(u, p, 'tower.tier', vars(x, host, -1, { host: host.name, other: others[Math.floor(hashFloat(tw.id, q * 100, 0x70e8, u.seed) * others.length)]?.name ?? host.name }), host, [settlementRef(x, host)], 1);
      omen(x, tw, host, league);
      if (q === 0.75 && tw.choices === 1 && openToAnswer(tw)) offerChoice(x, tw, 2);
    }
  }
  // the first Decision card: once the tower stands at a quarter of its goal and the god may answer (stint r1-1, finding
  // 1: not only on the exact crossing, so a rebuild from a tall stump, or a tower that passed 25 % while a prophet
  // was still preaching, is offered too)
  if (tw.choices === 0 && tw.height >= 0.25 * tw.goal && openToAnswer(tw)) offerChoice(x, tw, 1);
  // the prophet's warning comes to its sixth day
  if (tw.warned && tw.warned.tick >= 0 && x.tick - tw.warned.tick >= TOWER.warnDays * x.day && !tw.warned.heeded.length && !tw.warned.refused.length) heedRoll(x, tw, league);
  if (tw.status !== 'rising') return;
  // hardship in the host: ten hard days, then a 50 % roll gives it up
  const r = srel(u, p.id, host.id);
  // (stint r1-1, finding 7: a tower the god let stand runs to its goal, §2.4 / T9; hardship no longer gives it up)
  if (tw.answer !== 'let' && hardshipOf(u, p.id, host.id) >= 0.6) {
    r.since.tHard = (r.since.tHard ?? 0) + 1;
    if (r.since.tHard >= TOWER.hardDays) {
      r.since.tHard = 0;
      if (hashFloat(tw.id, x.tick, 0x70e2, u.seed) < 0.5) { abandon(x, tw, host, true); return; }
    }
  } else if (r.since.tHard) r.since.tHard = 0;
  if (tw.height >= tw.goal) finish(x, tw, host, league);
}

/** §2.4 the heed die of town `sid` for tower `tower` (seeded by the world: stint r1-1, finding 3) */
export function heedDie(u: { seed: number }, tower: number, sid: number): number { return hashFloat(tower, sid, 0x70e5, u.seed); }
/** §2.4 the yearly rebuild die of a struck tower (seeded by the world) */
export function rebuildDie(u: { seed: number }, tower: number, year: number): number { return hashFloat(tower, year, 0x70e4, u.seed); }

function offerChoice(x: PCtx, tw: TowerState, n: number): void {
  tw.choiceAt = x.tick; tw.choices = n;
  x.u.emit({ t: 'tower.choice', planet: x.p.id, pos: tw.pos, data: { tower: tw.id } });
}

function openToAnswer(tw: TowerState): boolean {
  return tw.answer === 'none' || (tw.answer === 'warn' && !!tw.warned?.refused.length);
}

const OMENS: Record<string, [string, string]> = {
  starlings: ['a sign to stop', 'a sign the god is watching'],
  halo: ['the god sees them', 'the god\'s eye is on them'],
  lightning: ['a warning', 'the god\'s anger is near'],
};

/** §2.3 omens at 25 / 50 / 75 %: a natural omen at the tower (god -1), read by trust or fear */
function omen(x: PCtx, tw: TowerState, host: Settlement, league: Settlement[]): void {
  if (tw.omens >= 3) return;
  tw.omens++;
  const u = x.u;
  // picked by fit (§2.3; stint 6 -- it used to be starlings / halo / lightning by turn): lightning on the scaffold only
  // in a storm, a halo only by day, the starlings always; the turn's own kind (starlings, halo, lightning) when it fits
  const fit: string[] = [];
  const cell = x.ps.building(tw.building)?.cell ?? tw.cell;
  if (stormSeverity(x, tw.pos, cell) > 0.15) fit.push('lightning');
  if (sunElevation(u, x.p, x.tick, tw.pos) > 0.1) fit.push('halo');
  fit.push('starlings');
  const turn = tw.omens === 2 ? 'halo' : tw.omens === 3 ? 'lightning' : 'starlings';
  const kind = fit.includes(turn) ? turn : fit[Math.floor(hashFloat(tw.id, tw.omens, 0x70f1, u.seed) * fit.length)];
  const reader = league[Math.floor(hashFloat(tw.id, tw.omens, 0x70e9, u.seed) * league.length)] ?? host;
  const m = srel(u, x.p.id, reader.id).means;
  const reading = OMENS[kind][m[2] >= m[1] ? 0 : 1];
  srel(u, x.p.id, reader.id).omens[`tower.${kind}`] = x.tick;
  // the league reads it as the omens.ts path reads a natural omen (god -1): a little faith, the feared reading a little
  // fear, the town has seen a sign, and the act is remembered (one chronicle line only: the tower's own, below)
  for (const s of league) {
    if (s.fallen >= 0) continue;
    const mm = meansNow(x, s);
    const trusted = mm.trust >= mm.fear;
    moveSettlement(x, s, { faith: 0.1, fear: trusted ? 0 : 0.05, trust: trusted ? 0.03 : 0 });
    s.recent.godSeen = x.tick;
    for (const a of x.ps.members.get(s.id) ?? []) x.A.flags[a] |= AgentFlag.sees_god;
    const r = srel(u, x.p.id, s.id);
    r.acts.push({ kind: `omen:tower.${kind}`, tick: x.tick, god: -1, dead: 0, foretold: false, provoked: false, key: `omen:tower.${kind}:${x.tick}` });
    if (r.acts.length > 12) r.acts.splice(0, r.acts.length - 12);
  }
  u.emit({ t: 'tower.omen', planet: x.p.id, pos: tw.pos, data: { tower: tw.id, kind, settlement: reader.id, reading } });
  tell(u, x.p, `tower.omen.${kind}`, vars(x, reader, -1, { host: host.name, reading }), reader, [settlementRef(x, reader)], 1);
}

function heedRoll(x: PCtx, tw: TowerState, league: Settlement[]): void {
  const u = x.u, p = x.p, w = tw.warned!;
  const ph = prophetOf(u, p.id, w.agent);
  const cred = ph?.credibility ?? 0.3;
  const name = prophetName(x, w.agent);
  for (const s of league) {
    const r = srel(u, p.id, s.id);
    const [faith, fear, trust] = r.means;
    // (stint r1-1, finding 4; ARC §2.4 note) a base 0.1, the faith the town had before the tower drained it, pride at
    // 0.15 not 0.6, and each warning this town refused before makes the next one likelier to land (+0.15 each): at 0.6
    // pride the roll sat at its 0.05 floor on every babel seed (pride 0.77, faith 0.12), so a warning never landed
    const faith0 = Math.min(1, faith + (r.since.tDrain ?? 0));
    // (owner 2026-11-08: "a warning prophet should be very rare" — proud builders almost never go home; a believed prophet,
    // a frightened town and a town that refused before move the odds a little, never past 1 in 5)
    const heed = clamp(0.02 + 0.08 * cred * faith0 - 0.05 * (r.pride ?? 0) + 0.06 * fear + 0.02 * trust + 0.03 * (r.since.tRefusals ?? 0), 0.01, 0.2);
    if (heedDie(u, tw.id, s.id) < heed) {
      w.heeded.push(s.id);
      r.pride = r3(clamp((r.pride ?? 0) - 0.25));
      memOf(r).patience += 1;
      for (const m of x.ps.members.get(s.id) ?? []) {
        const i = m * GODS;
        x.A.faith[i] = Math.min(1, x.A.faith[i] + 0.1); x.A.love[i] = Math.min(1, x.A.love[i] + 0.05); x.A.loyalty[i] = Math.min(1, x.A.loyalty[i] + 0.05);
      }
      u.emit({ t: 'tower.heeded', planet: p.id, pos: tw.pos, data: { tower: tw.id, settlement: s.id } });
      tell(u, p, 'tower.heeded', vars(x, s, -1, { prophet: name }), s, [settlementRef(x, s)], 2);
    } else {
      w.refused.push(s.id);
      r.since.tRefusals = (r.since.tRefusals ?? 0) + 1;
      r.defiance = r3(clamp((r.defiance ?? 0) + 0.1));
      if (ph && hashFloat(tw.id, s.id, 0x70e4 ^ 0x5, u.seed) < (r.pride ?? 0)) ph.silenced = Math.max(ph.silenced, x.tick + 3 * x.day);
      u.emit({ t: 'tower.refused', planet: p.id, pos: tw.pos, data: { tower: tw.id, settlement: s.id } });
      tell(u, p, 'tower.refused', vars(x, s, -1, { prophet: name, host: x.ps.settlement(tw.host)?.name ?? s.name }), s, [settlementRef(x, s)], 2);
    }
  }
  w.heeded.sort((a, b) => a - b); w.refused.sort((a, b) => a - b);
  if (ph) ph.credibility = r3(clamp(ph.credibility + (w.heeded.length ? 0.1 * w.heeded.length : -0.05)));
  tw.league = tw.league.filter((id) => !w.heeded.includes(id));
  const host = x.ps.settlement(tw.host);
  if (w.heeded.length) pushArc(u, { planet: p.id, tick: x.tick, kind: 'warn', name: `The Warning at ${host?.name ?? ''}`, towns: w.heeded, god: 'patience', dead: 0, ref: tw.id });
  // every town heeded, or so many that no league is left to build (the host went home, or one town stands alone): the
  // tower is left where the prophet spoke (stint r1-1: a broken league used to fall to the plain abandon path)
  if (!w.refused.length || (w.heeded.length && (w.heeded.includes(tw.host) || tw.league.length < 2))) {
    tw.status = 'abandoned'; tw.ended = x.tick;
    addSacredPlace(u, p, host ?? null, tw.pos, 'prophet', 'site');
    u.emit({ t: 'tower.abandoned', planet: p.id, pos: tw.pos, data: { tower: tw.id } });
  } else {
    w.disabledUntil = x.tick + x.year;
    if (tw.league.length < 2) abandon(x, tw, host);
    // §2.4/§2.5: refused, the card reopens (warn disabled for a year)
    else if (tw.status === 'rising') offerChoice(x, tw, Math.max(tw.choices, 1));
  }
}

function prophetName(x: PCtx, agent: number): string {
  const s = x.A.slotOf(agent);
  return s >= 0 ? agentName(x, s) : 'the prophet';
}

function abandon(x: PCtx, tw: TowerState, host: Settlement | undefined, hunger = false): void {
  tw.status = 'abandoned'; tw.ended = x.tick;
  x.u.emit({ t: 'tower.abandoned', planet: x.p.id, pos: tw.pos, data: { tower: tw.id } });
  if (hunger && host) tell(x.u, x.p, 'tower.abandoned', vars(x, host, -1, { host: host.name }), host, [settlementRef(x, host)], 2);
}

function finish(x: PCtx, tw: TowerState, host: Settlement, league: Settlement[]): void {
  const u = x.u, p = x.p;
  tw.status = 'finished'; tw.height = tw.goal; tw.tiers = tiersOf(tw.goal);
  const silent = tw.answer === 'none' || tw.answer === 'warn';
  if (silent) {
    tw.answer = 'none'; tw.answeredAt = x.tick;
    for (const s of league) {
      memOf(srel(u, p.id, s.id)).proud += 1;
      for (const m of x.ps.members.get(s.id) ?? []) { const i = m * GODS; x.A.faith[i] = Math.max(0, x.A.faith[i] - 0.05); }
    }
    const R = relOf(u);
    const ga = ((R.godActs ??= {})[String(p.id)] ??= {});
    ga.silence = (ga.silence ?? 0) + 1;
    pushArc(u, { planet: p.id, tick: x.tick, kind: 'silence', name: `The Age of ${tw.name.replace(/^the /, 'the ')}`, towns: tw.league, god: 'none', dead: 0, ref: tw.id });
  }
  u.emit({ t: 'tower.finished', planet: p.id, pos: tw.pos, data: { tower: tw.id, answer: tw.answer } });
  tell(u, p, silent ? 'tower.finished.silent' : 'tower.finished', vars(x, host, -1, { host: host.name }), host, league.map((s) => settlementRef(x, s)), 3);
}

/** a standing tower (let / silence): the league's faith drifts while it stands and they stay proud */
function standing(x: PCtx, tw: TowerState): void {
  for (const s of towns(x, tw.league)) {
    const r = srel(x.u, x.p.id, s.id);
    if ((r.pride ?? 0) < 0.6) continue;
    const took = r.since.tLetF ?? 0;
    if (took >= 0.25) continue;
    r.since.tLetF = r3(took + 0.003);
    for (const m of x.ps.members.get(s.id) ?? []) { const i = m * GODS; x.A.faith[i] = Math.max(0, x.A.faith[i] * 0.997); }
  }
}

function rebuildRoll(x: PCtx, tw: TowerState): void {
  if (tw.ended < 0 || x.tick - tw.ended > TOWER.rebuildYears * x.year) return;
  if (towersOf(x.u, x.p.id).some((t) => t.status === 'rising' || t.rebuildOf === tw.id)) return;
  const host = x.ps.settlement(tw.host);
  if (!host || host.fallen >= 0) return;
  const r = peekRel(x.u, x.p.id, host.id);
  if (!r?.since.tRebuild || (r.pride ?? 0) < 0.6) return;
  if (rebuildDie(x.u, tw.id, Math.floor(x.tick / x.year)) >= TOWER.rebuildChance) return;
  const league = towns(x, tw.league);
  if (league.length < 2) return;
  beginTower(x, host, league, tw);
}

// ───────────────────────────── the god's answers (§2.4) ─────────────────────────────

export type Answer = 'confuse' | 'strike' | 'warn' | 'let';

export function canAnswer(u: Universe, tw: TowerState): { can: Answer[]; warnBlocked?: string } {
  const can: Answer[] = [];
  let warnBlocked: string | undefined;
  if (tw.status === 'rising') {
    if (tw.answer === 'none') can.push('confuse', 'strike', 'warn', 'let');
    else if (tw.answer === 'warn' && tw.warned?.refused.length) can.push('confuse', 'strike', 'warn', 'let');
    else if (tw.answer === 'let') can.push('confuse', 'strike');
    if (can.includes('warn')) {
      if (tw.warned && tw.warned.tick >= 0 && !tw.warned.refused.length) warnBlocked = 'A prophet is already speaking to the builders.';
      else if (tw.warned && u.tick < tw.warned.disabledUntil) warnBlocked = 'They laughed at your prophet. Give it a year.';
      else if (warnProphet(u, tw) < 0) warnBlocked = 'No prophet speaks for you among the builders. Call one first (\'make Hesh my prophet\').';
    }
  } else if (tw.status === 'finished') can.push('confuse', 'strike');
  if (tw.status === 'rising' && tw.warned && tw.warned.tick >= 0 && !tw.warned.heeded.length && !tw.warned.refused.length) warnBlocked = 'A prophet is already speaking to the builders.';
  return { can, ...(warnBlocked ? { warnBlocked } : {}) };
}

function warnProphet(u: Universe, tw: TowerState, agent?: number): number {
  if (typeof agent === 'number') { const ph = prophetOf(u, tw.planet, agent); return ph ? agent : -1; }
  for (const sid of tw.league) { const ph = prophetOfSettlement(u, tw.planet, sid); if (ph) return ph.agent; }
  return -1;
}

function answered(x: PCtx, tw: TowerState, a: Answer): void {
  tw.answer = a; tw.answeredAt = x.tick;
}

/** confuse their tongues: two drifts per league town, the scattering, no deaths */
export function confuse(x: PCtx, tw: TowerState): { scattered: number; founded: number } {
  const u = x.u, p = x.p;
  const league = towns(x, tw.league);
  const host = x.ps.settlement(tw.host) ?? league[0];
  let scattered = 0, founded = 0;
  const kids: number[] = [], d0: number[] = [];
  for (const st of league) {
    const line = st.langLine.length ? st.langLine : [st.langSeed];
    const d1 = driftLanguage(st.langSeed, st.id ^ hash32(x.tick, 0));
    const d2 = driftLanguage(d1, st.id ^ hash32(x.tick, 1));
    st.langSeed = d2; st.language = d2;
    st.langLine = [line[0], ...line.slice(1).concat(d1, d2).slice(-11)];
    st.recent.keepName = x.tick;
    const r = srel(u, p.id, st.id);
    r.pride = r3((r.pride ?? 0) * 0.4);
    memOf(r).humbled += 1;
    for (const m of x.ps.members.get(st.id) ?? []) {
      const i = m * GODS;
      x.A.faith[i] = Math.min(1, x.A.faith[i] + 0.15); x.A.fear[i] = Math.min(1, x.A.fear[i] + 0.1); x.A.love[i] = Math.max(0, x.A.love[i] - 0.05);
    }
  }
  // between the league: polities fall out, kin towns of one polity grieve the lost tongue
  for (let i = 0; i < league.length; i++) for (let j = i + 1; j < league.length; j++) {
    const a = league[i], b = league[j];
    if (a.polity !== b.polity) {
      const rel = x.ps.relation(Math.min(a.polity, b.polity), Math.max(a.polity, b.polity));
      if (rel) rel.op = [r3(Math.max(-1, rel.op[0] - 0.25)), r3(Math.max(-1, rel.op[1] - 0.25))];
    } else for (const s of [a, b]) {
      const h = histOf(x, s);
      h.why.tongue = r3((h.why.tongue ?? 0) + 0.25);
      h.grievance = r3(clamp(h.grievance + 0.15));
    }
  }
  // the scattering: 20-35 % of each town's households go out to found towns of their own
  const rings = Math.min(48, Math.ceil((1.6 * SCATTER_M) / Math.sqrt((4 * Math.PI * p.st.radius ** 2) / p.count)));
  for (const st of league) {
    const share = 0.2 + 0.15 * hashFloat(tw.id, st.id, 0x70e3, u.seed);
    const hs = st.households.filter((h) => h.members.length > 0).slice().sort((a, b) => a.id - b.id);
    const n = Math.max(1, Math.round(hs.length * share));
    const leaving = hs.slice().sort((a, b) => hashFloat(a.id, tw.id, 0x70e3, u.seed) - hashFloat(b.id, tw.id, 0x70e3, u.seed)).slice(0, n);
    for (const h of leaving) scattered += h.members.length;
    // (§2.4: the daughters go >= 4 km away where land allows, kept BUD_APART from every live town; else the budding
    // path's own site)
    const far = searchSite(x, st.species, st.cell, rings, st.id, (c) => {
      const P = cellPos3(p, c);
      if (distM(p, P, st.pos) < SCATTER_M) return true;
      for (const o of x.ps.settlements) if (o.fallen < 0 && distM(p, P, o.pos) < BUD_APART) return true;
      return false;
    });
    // (stint r1-1, finding 2: any site scoring above 0 was taken, and on babel the scattered households froze in their
    // first winter there; now the budding path's own bar, a site good the whole year round, else the budding search)
    const child = splitOff(x, st, leaving, 'scatter', far.cell >= 0 && far.score >= SCATTER_SITE ? far.cell : -1);
    if (child) { founded++; kids.push(child.id); d0.push(child.stats.starved + child.stats.froze); }
  }
  tw.status = 'scattered'; tw.ended = x.tick;
  tw.scatter = { towns: kids, d0, until: x.tick + x.year };
  noteWandering(u, p.id, scattered);
  answered(x, tw, 'confuse');
  u.emit({ t: 'tower.confused', planet: p.id, pos: tw.pos, data: { tower: tw.id, towns: tw.league.slice(), scattered, founded } });
  tell(u, p, 'tower.confused', vars(x, host, -1, { host: host.name, league: names(league) }), host, league.map((s) => settlementRef(x, s)), 3);
  for (let i = 0; i < league.length; i++) for (let j = i + 1; j < league.length; j++) {
    const a = league[i], b = league[j];
    const key = `tower.apart:${b.id}`;
    const r = srel(u, p.id, a.id);
    if ((r.told ??= {})[key] !== undefined) continue;
    r.told[key] = x.tick;
    // stage C3: each in its own word (wordFor); the stage A line where the words came out alike
    const wa = wordFor(x.c, a, 'tower'), wb = wordFor(x.c, b, 'tower');
    tell(u, p, wa !== wb ? 'tower.apart.words' : 'tower.apart', vars(x, a, -1, { a: a.name, b: b.name, wordA: wa, wordB: wb }), a, [settlementRef(x, a), settlementRef(x, b)], 2);
  }
  pushArc(u, { planet: p.id, tick: x.tick, kind: 'confuse', name: `The Scattering at ${host.name}`, towns: tw.league, god: 'sign', dead: 0, ref: tw.id });
  return { scattered, founded };
}

/** strike it down: a harm act at the tower, wrath-scaled */
export function strike(x: PCtx, tw: TowerState, w: number): { dead: number; fell: number } {
  const u = x.u, p = x.p, A = x.A;
  const league = towns(x, tw.league);
  const host = x.ps.settlement(tw.host) ?? league[0];
  const foretold = !!(tw.warned && tw.warned.refused.length);
  const fell = Math.min(tw.tiers, Math.ceil(tw.tiers * (0.4 + 0.6 * w)));
  // the builders on site (within 120 m); foretold, they flee first and nobody dies
  const onSite: number[] = [];
  const P = [0, 0, 0];
  for (const st of league) for (const s of x.ps.members.get(st.id) ?? []) {
    A.posAt(s, x.tick, P);
    if (distM(p, P, tw.pos) <= 120) onSite.push(s);
  }
  onSite.sort((a, b) => A.id[a] - A.id[b]);
  const n = foretold ? 0 : Math.round(lethality(w) * onSite.length * 0.5);
  const doomed = onSite.slice().sort((a, b) => hashFloat(A.id[a], tw.id, 0x70e4, u.seed) - hashFloat(A.id[b], tw.id, 0x70e4, u.seed)).slice(0, n);
  let dead = 0;
  for (const s of doomed) if (A.alive[s]) { die(x, s, DEATH.god); dead++; }
  // a warning refused: they were told and would not hear, so the harm is earned (regard's provoked class: trust -0.05,
  // not the unprovoked -0.20; T8). Stint 6 -- it used to soften only the love.
  if (foretold) for (const st of league) srel(u, p.id, st.id).since.provoked = x.tick;
  // the regard path (regard.ts witness) moves trust and notes the harm for everyone the act reaches (stint r1-1, finding 0:
  // it used to take a second flat 0.2 off every league member and note the harm twice). Only the league beyond the
  // act's reach still hears of it: the same class the witness would give (provoked -0.05, unprovoked -0.2 x cruelty).
  const ctx = currentAct();
  godAct(u, p, tw.pos, STRIKE_R, { harm: 0.6 + 0.6 * w }, 0, 'lightning');
  const dTrust = foretold ? 0.05 : 0.2 * cruelty(w);
  const standingTiers = Math.max(0, tw.tiers - fell);
  tw.height = r3(Math.min(tw.height, standingTiers * TOWER.tierM));
  tw.status = 'struck'; tw.ended = x.tick;
  answered(x, tw, 'strike');
  for (const st of league) {
    const r = srel(u, p.id, st.id);
    if (!ctx?.seen.has(relKey(p.id, st.id))) noteHarm(r, x.tick, x.year);
    r.pride = r3((r.pride ?? 0) * 0.5);
    memOf(r).wrath += 1;
    for (const m of x.ps.members.get(st.id) ?? []) {
      A.posAt(m, x.tick, P);
      if (distM(p, P, tw.pos) <= STRIKE_R) continue;
      const i = m * GODS; A.love[i] = Math.max(0, A.love[i] - dTrust);
    }
    const [, fear, trust] = r.means;
    if (trust < 0.3 && fear < 0.5) { r.defiance = r3(clamp((r.defiance ?? 0) + 0.2)); r.since.tRebuild = x.tick; }
  }
  u.emit({ t: 'tower.struck', planet: p.id, pos: tw.pos, data: { tower: tw.id, dead, tiers: fell } });
  const swore = league.some((st) => (srel(u, p.id, st.id).means[2] ?? 1) < 0.3);
  tell(u, p, dead ? 'tower.struck.dead' : 'tower.struck', vars(x, host, -1, { host: host.name, dead: String(dead) }), host, league.map((s) => settlementRef(x, s)), 3);
  if (swore) tell(u, p, 'tower.swore', vars(x, host, -1, { host: host.name }), host, [settlementRef(x, host)], 2);
  pushArc(u, { planet: p.id, tick: x.tick, kind: 'strike', name: `The Fall of the Tower of ${host.name}`, towns: tw.league, god: 'wrath', dead, ref: tw.id });
  return { dead, fell };
}

/** send a prophet to warn them: five days of preaching at the site, then each town's heed roll */
export function warn(x: PCtx, tw: TowerState, agent: number): void {
  tw.warned = { agent, tick: x.tick, heeded: [], refused: [], disabledUntil: -1 };
  answered(x, tw, 'warn');
  const host = x.ps.settlement(tw.host);
  x.u.emit({ t: 'tower.warned', planet: x.p.id, pos: tw.pos, data: { tower: tw.id, agent } });
  if (host) tell(x.u, x.p, 'tower.warned', vars(x, host, -1, { prophet: prophetName(x, agent) }), host, [settlementRef(x, host)], 2);
}

/** let it stand: read as favour; grievance between the league halved (no polity merge) */
export function letStand(x: PCtx, tw: TowerState): void {
  const u = x.u, p = x.p;
  const league = towns(x, tw.league);
  for (const st of league) {
    const r = srel(u, p.id, st.id);
    memOf(r).proud += 1;
    for (const m of x.ps.members.get(st.id) ?? []) { const i = m * GODS; x.A.love[i] = Math.min(1, x.A.love[i] + 0.05); }
    const h = histOf(x, st);
    h.grievance = r3(h.grievance * 0.5);
    if (h.why.tongue) h.why.tongue = r3(h.why.tongue * 0.5);
  }
  answered(x, tw, 'let');
  const host = x.ps.settlement(tw.host);
  pushArc(u, { planet: p.id, tick: x.tick, kind: 'let', name: `The Age of the Tower of ${host?.name ?? ''}`, towns: tw.league, god: 'none', dead: 0, ref: tw.id });
}

// ───────────────────────────── the people's part (relDecide hook) ─────────────────────────────

/** visible builders and the warning prophet's preaching (relDecide, before prayer) */
export function towerTask(x: PCtx, s: number, st: Settlement, night: boolean, pressing: number): TaskSpec | null {
  const R = x.u.god.rel;
  if (!R?.towers?.length || night || pressing >= 1) return null;
  const A = x.A;
  for (const tw of R.towers) {
    if (tw.planet !== x.p.id || tw.status !== 'rising') continue;
    if (tw.warned && tw.warned.agent === A.id[s] && !tw.warned.heeded.length && !tw.warned.refused.length) {
      if (A.task[s] === TASK.preach) return null;
      const c = tw.cell;
      return { kind: TASK.preach, goal: spotInCell(x.p, c, A.id[s], 0x70ea, [0, 0, 0]), goalCell: c, work: 240, target: -1, data: st.id };
    }
    if (tw.host !== st.id || A.flags[s] & AgentFlag.child || A.task[s] === TASK.build) continue;
    const g = Math.max(1, grown(x, st).length);
    // relays drawn each quarter-day, so walkers, workers and the thirsty overlap (stint 6: one crew for the whole day
    // walked, worked and went home to drink in step, and the site stood empty in 40 % of work hours, T4)
    const period = Math.floor(x.tick / (x.day / 4));
    if (hashFloat(A.id[s], period, 0x70eb, x.u.seed) >= TOWER.visible / g) continue;
    const b = x.ps.building(tw.building);
    if (!b) continue;
    return { kind: TASK.build, goal: spotInCell(x.p, b.cell, A.id[s], 0x70ec, [0, 0, 0]), goalCell: b.cell, work: TOWER.shift, target: b.id, data2: 0 };
  }
  return null;
}

/** relDecide's damping of prayer (×0.7) and dusk (×0.8) in a rising league */
export function leagueDamp(u: Universe, planet: number, sid: number, tick: number): boolean {
  const r = u.god.rel?.st[`${planet}:${sid}`];
  return !!r?.since.tLeague && r.since.tLeague >= tick;
}

// ───────────────────────────── views and queries ─────────────────────────────

export function towerView(u: Universe, p: Planet, tw: TowerState): TowerView {
  const host = p.people?.settlement(tw.host);
  const { can, warnBlocked } = canAnswer(u, tw);
  return {
    id: tw.id, pos: [tw.pos[0], tw.pos[1], tw.pos[2]], cell: tw.cell, name: tw.name, host: tw.host, league: tw.league.slice(),
    height: tw.height, goal: tw.goal, tiers: tw.tiers, material: tw.material, style: host ? styleVariant(host) : 0,
    status: tw.status, builders: tw.builders, begun: tw.begun, ended: tw.ended, answer: tw.answer,
    choiceOpen: tw.status === 'rising' && tw.choices > 0 && openToAnswer(tw), canAnswer: can, ...(warnBlocked ? { warnBlocked } : {}),
  };
}

export function towerViews(u: Universe, p: Planet): TowerView[] | undefined {
  const all = towersOf(u, p.id);
  return all.length ? all.map((t) => towerView(u, p, t)) : undefined;
}

export function towersQuery(u: Universe, args: Record<string, unknown>): unknown[] {
  const out: unknown[] = [];
  for (const p of u.planets) {
    if (typeof args.planet === 'number' && args.planet !== p.id) continue;
    for (const tw of towersOf(u, p.id)) {
      const ps = p.people;
      const nm = (id: number) => ps?.settlement(id)?.name ?? '';
      out.push({ ...towerView(u, p, tw), hostName: nm(tw.host), leagueNames: tw.league.map(nm),
        years: Math.round(((tw.ended >= 0 ? tw.ended : u.tick) - tw.begun) / (u.god.rel ? makeCtx(u, p).year : 1) * 10) / 10,
        prides: tw.league.map((id) => peekRel(u, p.id, id)?.pride ?? 0), warned: tw.warned ?? null, omens: tw.omens, choices: tw.choices });
    }
  }
  return out;
}

/** "what are they building" (freeform): one sentence from the query */
export function towerWords(u: Universe, planet: number): string {
  const p = u.planets.find((q) => q.id === planet);
  const tw = currentTower(u, planet);
  if (!p?.people || !tw) return 'Nobody is building a tower on this world.';
  const league = tw.league.map((id) => p.people!.settlement(id)).filter((s): s is Settlement => !!s);
  const host = p.people.settlement(tw.host);
  if (tw.status !== 'rising') return `${tw.name.replace(/^the/, 'The')} stands at ${host?.name ?? 'its place'}, ${Math.round(tw.height)} m high.`;
  return `The towns of ${names(league)} are building a tower at ${host?.name ?? ''}, ${Math.round(tw.height)} m of ${tw.goal}. They say they want a name that lasts.`;
}

// ───────────────────────────── commands (§6.4) ─────────────────────────────

const NO_TOWER = 'Nobody is building a tower on this world.';

export function registerTowerCommands(r: CommandRegistry): void {
  const pick = (u: Universe, p: Planet, a: Record<string, unknown>) => currentTower(u, p.id, typeof a.tower === 'number' ? a.tower : undefined);
  const check = (u: Universe, tw: TowerState | undefined, k: Answer): string | null => {
    if (!tw || (tw.status !== 'rising' && tw.status !== 'finished')) return NO_TOWER;
    const { can, warnBlocked } = canAnswer(u, tw);
    if (!can.includes(k)) return tw.status === 'finished' ? 'The tower is finished; you may only confuse them or strike it now.' : 'You have already answered this tower.';
    if (k === 'warn' && warnBlocked) return warnBlocked;
    return null;
  };
  const tw = { tower: { type: 'int' as const, min: 0, desc: 'the tower (default: the rising or standing one)' } };
  r.register('tower.confuse', ({ u, p }, a) => {
    const t = pick(u, p, a);
    const e = check(u, t, 'confuse');
    if (e || !p.people) return fail(e ?? NO_TOWER);
    const x = makeCtx(u, p);
    const res = confuse(x, t!);
    return ok(`You confuse the tongues of the builders of ${t!.name}. ${res.scattered} people go out from their towns.`);
  }, { desc: 'Confuse the tongues of the tower\'s builders: they scatter and speak apart', category: 'Signs', params: { ...tw } });
  r.register('tower.strike', ({ u, p }, a) => {
    const t = pick(u, p, a);
    const e = check(u, t, 'strike');
    if (e || !p.people) return fail(e ?? NO_TOWER);
    const x = makeCtx(u, p);
    const w = currentWrath() ?? (typeof a.wrath === 'number' ? a.wrath : WRATH_DEFAULT);
    const res = strike(x, t!, w);
    return ok(`You strike down ${t!.name}: ${res.fell} of its tiers fall${res.dead ? `, and ${res.dead} die beneath them` : ''}.`);
  }, { desc: 'Strike the tower down (wrath-scaled)', category: 'Signs', params: { ...tw, covenant: { type: 'string', desc: 'keep | break (stage C)' } } });
  r.register('tower.warn', ({ u, p }, a) => {
    const t = pick(u, p, a);
    const e = check(u, t, 'warn');
    if (e || !p.people) return fail(e ?? NO_TOWER);
    const ag = warnProphet(u, t!, typeof a.agent === 'number' ? a.agent : undefined);
    if (ag < 0) return fail('No prophet speaks for you among the builders. Call one first (\'make Hesh my prophet\').');
    const x = makeCtx(u, p);
    warn(x, t!, ag);
    return ok(`${prophetName(x, ag)} goes to the foot of ${t!.name} to tell the builders to go home.`);
  }, { desc: 'Send your prophet to warn the tower\'s builders', category: 'Signs', params: { ...tw, agent: { type: 'int', min: 0, desc: 'the prophet' } } });
  r.register('tower.let', ({ u, p }, a) => {
    const t = pick(u, p, a);
    const e = check(u, t, 'let');
    if (e || !p.people) return fail(e ?? NO_TOWER);
    letStand(makeCtx(u, p), t!);
    return ok(`You let ${t!.name} stand. The builders take it as your favour.`);
  }, { desc: 'Let the tower stand', category: 'Signs', params: { ...tw } });
  r.register('tower.begin', ({ u, p }, a) => {
    if (!p.people) return fail('There are no people here.');
    const st = typeof a.settlement === 'number' ? p.people.settlement(a.settlement) : undefined;
    if (!st || st.fallen >= 0 || st.band) return fail('Begin a tower at which town?');
    if (towersOf(u, p.id).some((t) => t.status === 'rising')) return fail('A tower is already rising on this world.');
    const x = makeCtx(u, p);
    const t = beginTower(x, st, leagueOf(x, st, false));
    if (!t) return fail(`There is no flat dry ground near ${st.name} for a tower.`);
    return ok(`The towns begin ${t.name} (tower ${t.id}).`);
  }, { desc: 'Begin a tower at a town now (tests and shots)', category: 'Debug', params: { settlement: { type: 'int', required: true, min: 0 } } });
}
