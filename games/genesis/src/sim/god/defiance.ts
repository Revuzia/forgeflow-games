// GENESIS — ARC §3 OPEN DEFIANCE (stage B): a wronged, proud people turns on its god. The level (§3.1, daily in the
// hearts pass), their acts (§3.2: they curse the sky at dusk, throw stones and spears at the god's storm, burn its
// shrine, carve a god of their own), the classification of how the god answers (§3.3: wrath, mercy, a sign, or
// patience when it does nothing for ten days), the memory that answer leaves (§0.4: yearly decay, landmarks, daughters,
// the newborn bias read by regard.ts freshen), the debug and answer commands, the defiance query and the words.
//
// Futile but visible: nothing here touches a storm, a disaster or the god. The projectiles of `hurl` are render-only
// (MoverBlock.heart == HeartSign.hurl). The shrine burns through the people's fire path (no god act, no regard deltas).
//
// State (all of it ARC §6.1 fields, plus `since` keys): r.defiance, r.defied, r.answer, r.idol, r.memory, r.memEvents;
// since.dCurse (curse armed until), since.dHold/dHoldV (defiance.set), since.patT (a patience answer's act tick, for the
// year-on check), since.patFast (defiance decays twice as fast until), since.gStorm/gStormT (a god-0 storm's weather id
// over the town and until when), since.memY (last yearly memory decay), since.aWrath/aMercy/aSign/aPatience (answer
// counts, the inspector's words), since.idolMute (told). Deterministic: hashFloat with fresh salts 0xdef1..0xdef9 and
// the world seed; towns in ps.settlements order; no Map-iteration order reaches state.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Building, Settlement } from '../people/state.ts';
import type { PCtx } from '../people/ctx.ts';
import type { CommandRegistry } from './commands.ts';
import type { DefyKind, Memory, SettlementRel } from './state.ts';
import { AgentFlag } from '../types.ts';
import { hashFloat } from '../core/rng.ts';
import { makeCtx } from '../people/ctx.ts';
import { GODS, NT, TASK, TRAIT } from '../people/defs.ts';
import { interrupt } from '../people/people.ts';
import { startTask } from '../people/tasks.ts';
import { ruin, styleOf } from '../people/buildings.ts';
import { igniteCell } from '../fields/fire.ts';
import { tell } from '../people/story.ts';
import { agentName, settlementRef, vars } from '../people/util.ts';
import { distM, spotInCell } from '../people/world.ts';
import { fail, ok } from './util.ts';
import { meansNow, moveSettlement, peekRel, relOf, rise, srel } from './regard.ts';
import { ARC, emptyMemory, personHeart } from './arc.ts';
import { pushArc } from './tower.ts';

/** ARC §3 tunables (the *(ARC)* numbers of §3.1-§3.3 and §0.4) */
export const DEFY = {
  /** DEFY ids (TASK.defy tData) */
  id: { curse: 1, hurl: 2, burn: 3, idol: 4 } as Record<DefyKind, number>,
  /** defiance relaxes toward its target this fraction a day */
  rate: 0.03,
  /** harmLoad / this = load (capped 1) */
  loadDiv: 3,
  /** thresholds per kind */
  curse: 0.45, hurl: 0.45, burn: 0.70, idol: 0.60,
  /** cooldowns (days; burn and idol in years) */
  curseDays: 3, hurlDays: 1, burnYears: 2, idolYears: 3,
  /** crowd caps */
  curseN: 12, hurlN: 8,
  /** hurl: boldness of the throwers; a god-0 storm, disaster or bolt within this of the territory (m) */
  hurlBold: 0.6, stormReach: 1000,
  /** terror: at this fear (the town's mean, or a person's own) nobody goes out to defy (D1) */
  terror: 0.9,
  /** the answer window (days) */
  answerDays: 10,
  /** memory decay a year: no keeper (0.5^(1/25)), and a landmark keeper */
  memDecay: Math.pow(0.5, 1 / 25), memLandmark: 0.99,
  /** a landmark keeps the memory of the event while it stands within this of the town (m) */
  landmarkM: 3000,
  /** daughters inherit memory x, pride x, defiance x */
  inheritMem: 0.7, inheritPride: 0.8, inheritDefy: 0.5,
} as const;

const KINDS: DefyKind[] = ['curse', 'hurl', 'burn', 'idol'];
const SALT: Record<DefyKind, number> = { curse: 0xdef1, hurl: 0xdef2, burn: 0xdef3, idol: 0xdef4 };
const clamp = (v: number, lo = 0, hi = 1): number => (v < lo ? lo : v > hi ? hi : v);
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export type Answer = 'wrath' | 'mercy' | 'sign' | 'patience';

// ───────────────────────────── §3.1 the level ─────────────────────────────

/** §3.1 + §0.4: defiance's target for a town from its harm load, pride, means, lapses and memory */
export function defianceTarget(r: SettlementRel, fear: number, trust: number): number {
  const load = Math.min(1, (r.harmLoad ?? 0) / DEFY.loadDiv);
  let t = 0.6 * load + 0.4 * (r.pride ?? 0) - 0.5 * trust - 0.8 * Math.max(0, fear - 0.6) + 0.08 * Math.min(r.lapses ?? 0, 3) / 3;
  const m = r.memory;
  if (m) {
    if (trust < 0.3) t += 0.08 * Math.min(1, m.wrath);
    t -= 0.04 * Math.min(1, m.patience);
    t -= 0.10 * Math.min(1, m.mercy);
  }
  return clamp(t);
}

/** §3.1: the daily step of defiance (heartsDaily, after pride), the answer window, the yearly memory decay, the idol, and
 *  the daily rolls of the acts that do not wait for an hour (curse is armed for the evening; burn and idol happen now) */
export function defianceDaily(x: PCtx, st: Settlement, r: SettlementRel, m: { fear: number; trust: number; faith: number }, first: boolean): void {
  const tick = x.tick;
  memoryYearly(x, st, r);
  let target = defianceTarget(r, m.fear, m.trust);
  const hold = r.since.dHold;
  if (hold !== undefined) {
    if (tick <= hold) target = Math.max(target, r.since.dHoldV ?? 0);
    else { delete r.since.dHold; delete r.since.dHoldV; }
  }
  const fast = r.since.patFast !== undefined && tick <= r.since.patFast;
  if (r.since.patFast !== undefined && !fast) delete r.since.patFast;
  const d0 = r.defiance ?? 0;
  const k = DEFY.rate * (fast && target < d0 ? 2 : 1);
  r.defiance = r3(first && d0 === 0 ? 0 : clamp(d0 + (target - d0) * k));
  // the answer window (§3.3): nothing from the god for ten days is patience
  if (r.answer && tick - r.answer.tick >= DEFY.answerDays * x.day) classify(x.u, x.p, st, r, 'patience');
  // a year after a patience answer with no harm since: trust +0.05, defiance decays twice as fast for a year
  if (r.since.patT !== undefined && tick - r.since.patT >= x.year) {
    const t0 = r.since.patT;
    delete r.since.patT;
    if (r.lastHarm === undefined || r.lastHarm < t0) {
      moveSettlement(x, st, { trust: 0.05 });
      r.since.patFast = tick + x.year;
      tellDefy(x, st, r, 'defy.patience', 2);
    }
  }
  idolDaily(x, st, r);
  if (st.band || st.fallen >= 0) return;
  const def = r.defiance;
  const day = Math.floor(tick / x.day);
  // curse: armed for this evening (the hourly pass gathers them at dusk)
  if (def >= DEFY.curse && cooled(x, r, 'curse') && roll(x, st, day, 'curse', def)) r.since.dCurse = tick + x.day;
  const escalated = KINDS.slice(0, 2).some((q) => r.defied?.[q] !== undefined && tick - r.defied[q]! <= 2 * x.year);
  if (!escalated) return;
  // burn: their own fire on the god's shrine
  if (def >= DEFY.burn && m.trust < 0.15 && m.fear < 0.6 && cooled(x, r, 'burn') && roll(x, st, day, 'burn', def)) {
    const b = shrineOf(x, st);
    if (b) burnShrine(x, st, r, b);
  }
  // idol: a god of their own (or a rival's, where one holds them)
  if (def >= DEFY.idol && m.faith < 0.35 && cooled(x, r, 'idol') && !(r.idol !== undefined && x.ps.building(r.idol)) && roll(x, st, day, 'idol', def)) raiseIdol(x, st, r);
}

function cooled(x: PCtx, r: SettlementRel, k: DefyKind): boolean {
  const t = r.defied?.[k];
  if (t === undefined) return true;
  const cd = k === 'curse' ? DEFY.curseDays * x.day : k === 'hurl' ? DEFY.hurlDays * x.day : k === 'burn' ? DEFY.burnYears * x.year : DEFY.idolYears * x.year;
  return x.tick - t >= cd;
}

/** §3.2: one roll per town per day per kind */
export function defyRoll(seed: number, sid: number, day: number, k: DefyKind): number { return hashFloat(sid, day, SALT[k], seed); }

function roll(x: PCtx, st: Settlement, day: number, k: DefyKind, def: number): boolean {
  const thr = DEFY[k];
  return defyRoll(x.u.seed, st.id, day, k) < 0.25 * (def - thr) / (1 - thr) + 0.1;
}

/** fix a + §3.1: a god-0 harm on the town; w 1 unprovoked, 0.5 provoked or foretold; `first` once per act */
export function harmJolt(r: SettlementRel, first: boolean): void {
  if (!first) return;
  const [, fear, trust] = r.means;
  if (trust < 0.4) r.defiance = r3(clamp((r.defiance ?? 0) + 0.1 * (1 - fear)));
}

// ───────────────────────────── §3.2 the acts ─────────────────────────────

/** the hourly pass of a town (relationshipHourly): the evening's curse at dusk, the stones at a storm */
export function defianceHourly(x: PCtx, st: Settlement, dusk: boolean): void {
  if (st.band || st.fallen >= 0) return;
  const r = peekRel(x.u, x.p.id, st.id);
  if (!r || (r.defiance ?? 0) < Math.min(DEFY.curse, DEFY.hurl)) { if (r?.since.dCurse !== undefined && x.tick > r.since.dCurse) delete r.since.dCurse; return; }
  const def = r.defiance ?? 0;
  if (r.since.dCurse !== undefined) {
    if (x.tick > r.since.dCurse) delete r.since.dCurse;
    else if (dusk && def >= DEFY.curse) {
      delete r.since.dCurse;
      const crowd = gather(x, st, r, 'curse');
      if (crowd.length) act(x, st, r, 'curse', crowd);
    }
  }
  if (def >= DEFY.hurl && cooled(x, r, 'hurl') && r.means[1] < DEFY.terror - 1e-4 && stormNear(x, st, r)) {
    const day = Math.floor(x.tick / x.day);
    if (roll(x, st, day, 'hurl', def)) {
      const crowd = gather(x, st, r, 'hurl');
      if (crowd.length) act(x, st, r, 'hurl', crowd);
      else (r.defied ??= {}).hurl = x.tick; // (nobody bold enough today: the roll is spent)
    }
  }
}

/** a god-0 storm (tracked from weather.paint), a god-0 disaster, or a god-0 bolt within the hour, over or near the town */
export function stormNear(x: PCtx, st: Settlement, r: SettlementRel): boolean {
  const reach = st.territory + DEFY.stormReach;
  const id = r.since.gStorm;
  if (id !== undefined) {
    const w = x.p.weather.find((q) => q.id === id);
    if (!w || (r.since.gStormT !== undefined && x.tick > r.since.gStormT)) { delete r.since.gStorm; delete r.since.gStormT; }
    else if (distM(x.p, w.pos, st.pos) <= w.radius + reach) return true;
  }
  for (const d of x.u.god.disasters) if (d.planet === x.p.id && d.god === 0 && distM(x.p, d.pos, st.pos) <= d.radius + reach) return true;
  for (const a of r.acts) if (a.god === 0 && a.kind === 'harm' && !a.natural && x.tick - Math.max(a.tick, a.until ?? a.tick) <= 60) return true;
  return false;
}

/** relationship.ts stormSeen: a god-0 storm painted over towns (its weather id, for the hurl check) */
export function noteGodStorm(u: Universe, p: Planet, id: number, pos: ArrayLike<number>, radius: number, until: number): void {
  const ps = p.people;
  if (!ps) return;
  for (const st of ps.settlements) {
    if (st.fallen >= 0 || st.band) continue;
    if (distM(p, pos, st.pos) > radius + st.territory + DEFY.stormReach) continue;
    const r = srel(u, p.id, st.id);
    r.since.gStorm = id;
    r.since.gStormT = until;
  }
}

/** who goes out: curse, the defiant (else the bold and unloving); hurl, grown with boldness >= 0.6. Hash-ordered, capped. */
function gather(x: PCtx, st: Settlement, r: SettlementRel, k: 'curse' | 'hurl'): number[] {
  const A = x.A, def = r.defiance ?? 0, pride = r.pride ?? 0;
  const out: number[] = [];
  for (const s of x.ps.members.get(st.id) ?? []) {
    if (!A.alive[s] || A.flags[s] & AgentFlag.child || A.mission[s] || A.boat[s] >= 0 || A.flags[s] & AgentFlag.possessed) continue;
    const t = A.task[s];
    if (t === TASK.flee || t === TASK.evacuate || t === TASK.fight || t === TASK.sail || t === TASK.possessed || t === TASK.defy) continue;
    const i = s * GODS;
    if (A.fear[i] >= DEFY.terror - 1e-4) continue; // terror suppresses (D1; float32 columns)
    const b = A.traits[s * NT + TRAIT.boldness];
    if (k === 'hurl' ? b < DEFY.hurlBold || A.love[i] >= 0.35 : personHeart(A, s, def, pride) !== 'defiant') continue;
    out.push(s);
  }
  const salt = k === 'curse' ? 0xdef5 : 0xdef6;
  out.sort((a, b) => hashFloat(A.id[a], x.tick, salt, x.u.seed) - hashFloat(A.id[b], x.tick, salt, x.u.seed) || A.id[a] - A.id[b]);
  return out.slice(0, k === 'curse' ? DEFY.curseN : DEFY.hurlN);
}

/** the act: the crowd goes out under the sky, the event, the window for the god's answer, the line */
function act(x: PCtx, st: Settlement, r: SettlementRel, k: DefyKind, crowd: number[]): void {
  const A = x.A;
  for (const s of crowd) {
    const h = hashFloat(A.id[s], x.tick, 0xdef7, x.u.seed);
    const work = k === 'hurl' ? 20 + Math.round(20 * h) : 30 + Math.round(30 * h);
    const goal = spotInCell(x.p, st.cell, A.id[s], 0xdef8, [0, 0, 0]);
    interrupt(x, s);
    startTask(x, s, { kind: TASK.defy, goal: [goal[0], goal[1], goal[2]], goalCell: st.cell, work, data: DEFY.id[k] });
  }
  opened(x, st, r, k, crowd.length, crowd[0] ?? -1);
}

/** every act: defied[k], the open answer window, the event, the chronicle line, the ArcEvent (first of a kind in 2 y) */
function opened(x: PCtx, st: Settlement, r: SettlementRel, k: DefyKind, count: number, agent: number, extra: Record<string, string> = {}, line = true): void {
  const u = x.u;
  (r.defied ??= {})[k] = x.tick;
  if (!r.answer) r.answer = { tick: x.tick, kind: k };
  u.emit({ t: 'defy', planet: x.p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], ref: settlementRef(x, st), data: { settlement: st.id, kind: k, count } });
  const told = (r.told ??= {});
  const fresh = told[`defy.${k}`] === undefined || x.tick - told[`defy.${k}`] >= 2 * x.year;
  if (line) {
    told[`defy.${k}`] = x.tick;
    const w = k === 'burn' ? 3 : k === 'curse' ? 1 : 2;
    tell(u, x.p, `defy.${k}`, vars(x, st, agent, { agent: agent >= 0 ? agentName(x, agent) : st.name, ...extra }), st, [settlementRef(x, st)], w);
  }
  if (fresh) pushArc(u, { planet: x.p.id, tick: x.tick, kind: 'defiance', name: `The Anger of ${st.name}`, towns: [st.id], god: 'none', dead: 0 });
}

/** the town's standing shrine or temple (the god's worship place) */
function shrineOf(x: PCtx, st: Settlement): Building | undefined {
  return x.ps.of(st.id).find((b) => b.progress >= 1 && !(b.flags & 2) && x.c.buildings.list[b.type].function === 'temple');
}

/** burn: the people's own fire at the shrine (its cell, weakly; the building is lost). Not a god act. */
function burnShrine(x: PCtx, st: Settlement, r: SettlementRel, b: Building): void {
  igniteCell(x.u, x.p, b.cell, 0.3, 'people');
  b.damage = 1;
  ruin(x, st, b, 'fire');
  opened(x, st, r, 'burn', 1, -1);
}

/** idol: a rival who holds them takes the faith; else they carve a post of their own (a building `idol`) */
function raiseIdol(x: PCtx, st: Settlement, r: SettlementRel): void {
  const u = x.u, A = x.A;
  const members = x.ps.members.get(st.id) ?? [];
  let rival = -1, best = 0.2 - 1e-9;
  for (let g = 1; g < GODS; g++) {
    const rec = u.god.god(g);
    if (!rec || rec.kind === 'player') continue;
    let f = 0;
    for (const s of members) f += A.faith[s * GODS + g];
    f /= Math.max(1, members.length);
    if (f > best) { best = f; rival = g; }
  }
  if (rival > 0) {
    for (const s of members) { const i = s * GODS + rival; A.faith[i] = rise(A.faith[i], 0.1); }
    opened(x, st, r, 'idol', 0, -1, { god: u.god.god(rival)?.name ?? 'another god' }, false);
    const told = (r.told ??= {});
    if (told['defy.rival'] === undefined || x.tick - told['defy.rival'] >= 2 * x.year) {
      told['defy.rival'] = x.tick;
      tell(u, x.p, 'defy.rival', vars(x, st, -1, { god: u.god.god(rival)?.name ?? 'another god' }), st, [settlementRef(x, st)], 1);
    }
    return;
  }
  const t = x.c.buildings.idx('idol');
  if (t < 0) return;
  const mats = ['stone', 'fieldstone', 'wood'].map((m) => x.c.materials.idx(m)).filter((i) => i >= 0);
  const mi = mats[Math.floor(hashFloat(st.id, x.tick, 0xdef9, u.seed) * mats.length)] ?? mats[0];
  if (mi === undefined) return;
  const id = u.ids.alloc('building');
  const at = spotInCell(x.p, st.cell, id, 0xdefa, [0, 0, 0]);
  const b: Building = {
    id, type: t, material: mi, style: styleOf(st), pos: [at[0], at[1], at[2]], cell: st.cell, rot: Math.round(hashFloat(id, 0xdefb, 0, u.seed) * 6283) / 1000,
    scale: 1, progress: 1, delivered: 0, damage: 0, settlement: st.id, flags: 0, books: [], built: x.tick, fuel: 0, occupants: 0, household: -1,
  };
  x.ps.addBuilding(b);
  r.idol = id;
  delete r.since.idolMute;
  opened(x, st, r, 'idol', 1, -1);
}

/** while it stands: its prayers lapse (told once); it is thrown down when the town's heart turns devoted */
function idolDaily(x: PCtx, st: Settlement, r: SettlementRel): void {
  if (r.idol === undefined) return;
  const b = x.ps.building(r.idol);
  if (!b || b.flags & 2 || st.fallen >= 0) { delete r.idol; delete r.since.idolMute; return; }
  if (r.hearts?.kind === 'devoted') {
    b.damage = 1;
    ruin(x, st, b, 'razed');
    delete r.idol; delete r.since.idolMute;
    tellDefy(x, st, r, 'defy.idoldown', 2);
    return;
  }
  if (r.lapses >= 3 && r.since.idolMute === undefined) {
    r.since.idolMute = x.tick;
    tellDefy(x, st, r, 'defy.idolmute', 1);
  }
}

/** an idol stands in the town (regard.ts: loyalty aims × 0.8; relationship.ts conversions: the bar −0.05) */
export function idolStands(u: Universe, planet: number, sid: number): boolean {
  return peekRel(u, planet, sid)?.idol !== undefined;
}

function tellDefy(x: PCtx, st: Settlement, r: SettlementRel, id: string, w: number, extra: Record<string, string> = {}): void {
  (r.told ??= {})[id] = x.tick;
  tell(x.u, x.p, id, vars(x, st, -1, extra), st, [settlementRef(x, st)], w);
}

// ───────────────────────────── §3.3 the god's answer ─────────────────────────────

/** what a help act gave, in the mercy line's own noun */
function helpNoun(what: string): string {
  if (/rain|water|storm/.test(what)) return 'rain';
  if (/heal|cure/.test(what)) return 'healing';
  if (/food|gift|fertility|spawn|breed/.test(what)) return 'bread';
  if (/calm|clear|shield|cancel|freeze|move|scale|peace/.test(what)) return 'calm';
  return 'gifts';
}

/**
 * regard.ts endAct: a god-0 act (not natural) that a town saw, with its reading there. The first within the ten days of
 * an open defiant act answers it: harm is wrath, help is mercy, a wonder with no harm is a sign. An act already under way
 * before the defiant act (a storm that was there when they went out) is no answer.
 */
export function answerFromAct(u: Universe, planet: number, sid: number, reading: string, began: number, what: string): void {
  const r = peekRel(u, planet, sid);
  if (!r?.answer || began < r.answer.tick) return;
  const p = u.planets.find((q) => q.id === planet);
  const st = p?.people?.settlement(sid);
  if (!p || !st || st.fallen >= 0) return;
  const how: Answer = reading === 'harm' ? 'wrath' : reading === 'help' || reading === 'mercy' ? 'mercy' : 'sign';
  classify(u, p, st, r, how, what);
}

/** §3.3 "a prophet's word there": the god speaks through its prophet to a town with an open defiant act: a sign */
export function answerByWord(u: Universe, planet: number, sid: number, prophet: string): void {
  const r = peekRel(u, planet, sid);
  const p = u.planets.find((q) => q.id === planet);
  const st = p?.people?.settlement(sid);
  if (!r?.answer || !p || !st || st.fallen >= 0) return;
  classify(u, p, st, r, 'sign', `prophet:${prophet}`);
}

/** §3.3: the answer read; its effect now, memory, godActs, ArcEvent, event, line; the window closes */
export function classify(u: Universe, p: Planet, st: Settlement, r: SettlementRel, how: Answer, what = ''): void {
  if (!r.answer) return;
  const x = makeCtx(u, p);
  const at = r.answer.tick;
  r.answer = null;
  const mem = (r.memory ??= emptyMemory());
  mem[how] = r3(mem[how] + 1);
  const ga = ((relOf(u).godActs ??= {})[String(p.id)] ??= {});
  ga[how] = (ga[how] ?? 0) + 1;
  const cnt = `a${how[0].toUpperCase()}${how.slice(1)}`;
  r.since[cnt] = (r.since[cnt] ?? 0) + 1;
  const m = meansNow(x, st);
  const d = r.defiance ?? 0;
  if (how === 'wrath') {
    // the harm counts as it is (regard's own class); only the martyrs' anger is added here
    if (m.trust < 0.2 && (r.pride ?? 0) > 0.5) r.defiance = r3(clamp(d + 0.1));
  } else if (how === 'mercy') {
    r.defiance = r3(clamp(d - 0.2));
  } else if (how === 'sign') {
    moveSettlement(x, st, { faith: 0.1, fear: 0.05 });
    r.defiance = r3(clamp(d - 0.1));
  } else {
    moveSettlement(x, st, { trust: 0.02 });
    r.defiance = r3(clamp(d - 0.05));
    r.since.patT = at;
  }
  // the Book's register: every answer but a silence, and a silence at most once a year per town
  const quiet = how === 'patience' && r.since.patArc !== undefined && x.tick - r.since.patArc < x.year;
  if (!quiet) {
    if (how === 'patience') r.since.patArc = x.tick;
    pushArc(u, { planet: p.id, tick: x.tick, kind: 'answer', name: `The Answer to ${st.name}`, towns: [st.id], god: how, dead: 0 });
  }
  u.emit({ t: 'defy.answered', planet: p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], ref: settlementRef(x, st), data: { settlement: st.id, how } });
  // a sign given through the god's prophet ("prophet:<name>") is told as the prophet's word
  const word = how === 'sign' && what.startsWith('prophet:');
  const id = how === 'patience' ? 'defy.silence' : word ? 'defy.word' : `defy.${how}`;
  const extra: Record<string, string> = how === 'mercy' ? { what: helpNoun(what) } : word ? { agent: what.slice(8) } : how === 'sign' ? { omen: 'A sign' } : {};
  tellDefy(x, st, r, id, how === 'patience' || how === 'sign' ? 1 : 2, extra);
}

// ───────────────────────────── §0.4 memory ─────────────────────────────

/** the memory key an ArcEvent raised (for its landmark) */
function keyOf(kind: string, god: string): keyof Memory | null {
  if (kind === 'strike') return 'wrath';
  if (kind === 'confuse') return 'humbled';
  if (kind === 'warn') return 'patience';
  if (kind === 'answer' && (god === 'wrath' || god === 'mercy' || god === 'sign' || god === 'patience')) return god;
  return null;
}

/** the tallies kept by a landmark standing within 3 km: a struck, scattered or abandoned tower of an event they remember */
export function landmarkKeys(u: Universe, p: Planet, st: Settlement, r: SettlementRel): Set<string> {
  const out = new Set<string>();
  const evs = r.memEvents;
  if (!evs?.length) return out;
  const R = u.god.rel;
  const ruins = (R?.towers ?? []).filter((t) => t.planet === p.id && (t.status === 'struck' || t.status === 'scattered' || t.status === 'abandoned')
    && distM(p, t.pos, st.pos) <= DEFY.landmarkM);
  if (!ruins.length) return out;
  const ids = new Set(ruins.map((t) => t.id));
  for (const e of R?.arcEvents ?? []) {
    if (e.planet !== p.id || e.ref === undefined || !ids.has(e.ref) || !evs.includes(e.id)) continue;
    const k = keyOf(e.kind, e.god);
    if (k) out.add(k);
  }
  return out;
}

/** §0.4: memory decays yearly (applied once a year per town, never recomputed) */
function memoryYearly(x: PCtx, st: Settlement, r: SettlementRel): void {
  const m = r.memory;
  if (!m) return;
  const y0 = r.since.memY;
  if (y0 === undefined) { r.since.memY = x.tick; return; }
  if (x.tick - y0 < x.year) return;
  r.since.memY = y0 + x.year;
  const kept = landmarkKeys(x.u, x.p, st, r);
  for (const k of ['wrath', 'patience', 'mercy', 'sign', 'humbled', 'betrayed', 'kept', 'proud'] as const) {
    if (!m[k]) continue;
    const v = m[k] * (kept.has(k) ? DEFY.memLandmark : DEFY.memDecay);
    m[k] = v < 1e-4 ? 0 : Math.round(v * 1e4) / 1e4;
  }
}

/** §0.4: a new town founded from another inherits memory × 0.7, pride × 0.8, defiance × 0.5 (arc.ts arcInit) */
export function inherit(u: Universe, planet: number, st: Settlement, r: SettlementRel): void {
  if (st.parent < 0) return;
  const pr = peekRel(u, planet, st.parent);
  if (!pr) return;
  if (pr.memory) {
    const m = (r.memory ??= emptyMemory());
    for (const k of ['wrath', 'patience', 'mercy', 'sign', 'humbled', 'betrayed', 'kept', 'proud'] as const) m[k] = Math.max(m[k], r3(pr.memory[k] * DEFY.inheritMem));
  }
  if (pr.defiance) r.defiance = r3(Math.max(r.defiance ?? 0, pr.defiance * DEFY.inheritDefy));
  if (pr.pride) r.since.inPride = r3(pr.pride * DEFY.inheritPride);
}

/** §0.4: households that move carry memory × 0.5 into the receiving town, merged by max */
export function carryMemory(u: Universe, planet: number, from: number, to: number): void {
  const src = peekRel(u, planet, from)?.memory;
  if (!src) return;
  const m = (srel(u, planet, to).memory ??= emptyMemory());
  for (const k of ['wrath', 'patience', 'mercy', 'sign', 'humbled', 'betrayed', 'kept', 'proud'] as const) m[k] = Math.max(m[k], r3(src[k] * 0.5));
}

/** §0.4 the newborn hook (regard.ts freshen): fear +0.05 w(wrath), trust +0.05 w(mercy), each capped 0.2 */
export function arcNewbornBias(r: SettlementRel | undefined): { fear: number; trust: number } | undefined {
  const m = r?.memory;
  if (!m || (!m.wrath && !m.mercy)) return undefined;
  return { fear: Math.min(0.2, 0.05 * m.wrath), trust: Math.min(0.2, 0.05 * m.mercy) };
}

// ───────────────────────────── views, words, query ─────────────────────────────

/** §6.2 SettlementView.defiant: the latest act, at most 2 days old */
export function defiantView(r: SettlementRel | undefined, tick: number, day: number): { kind: DefyKind; tick: number } | undefined {
  if (!r?.defied) return undefined;
  let best: DefyKind | null = null, t = -1;
  for (const k of KINDS) { const v = r.defied[k]; if (v !== undefined && v > t) { t = v; best = k; } }
  return best && tick - t <= 2 * day ? { kind: best, tick: t } : undefined;
}

const NUM = ['', 'once', 'twice', 'three times', 'four times', 'five times', 'six times', 'seven times', 'eight times', 'nine times', 'ten times', 'eleven times', 'twelve times'];
const ANSWER_WORDS: Record<Answer, string> = { wrath: 'struck', mercy: 'shown mercy', sign: 'shown a sign', patience: 'borne with' };

/** §3.4 "What the god answered": "struck twice, shown mercy once" ('' before any answer) */
export function answeredWords(r: SettlementRel | undefined): string {
  if (!r) return '';
  const rows = (['wrath', 'mercy', 'sign', 'patience'] as Answer[]).map((k) => [k, r.since[`a${k[0].toUpperCase()}${k.slice(1)}`] ?? 0] as const).filter(([, n]) => n > 0);
  rows.sort((a, b) => b[1] - a[1]);
  return rows.map(([k, n]) => `${ANSWER_WORDS[k]} ${n <= 12 ? NUM[n] : `${n} times`}`).join(', ');
}

/** "Two days ago they threw stones at your storm." for the hearts answer */
const ACT_WORDS: Record<DefyKind, string> = { curse: 'they cursed the sky', hurl: 'they threw stones at your storm', burn: 'they burned your shrine', idol: 'they carved a god of their own' };
export function lateActWords(r: SettlementRel | undefined, tick: number, day: number): string {
  if (!r?.defied) return '';
  let best: DefyKind | null = null, t = -1;
  for (const k of KINDS) { const v = r.defied[k]; if (v !== undefined && v > t) { t = v; best = k; } }
  if (!best) return '';
  const days = Math.floor((tick - t) / day);
  if (days > 12) return '';
  const when = days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${['', '', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'][days]} days ago`;
  return `${when} ${ACT_WORDS[best]}.`;
}

/** §6.6 query('defiance', { settlement }) */
export function defianceQuery(u: Universe, args: Record<string, unknown>): unknown {
  const out: unknown[] = [];
  for (const p of u.planets) {
    const ps = p.people;
    if (!ps) continue;
    for (const st of ps.settlements) {
      if (st.fallen >= 0 || st.band) continue;
      if (typeof args.settlement === 'number' && args.settlement !== st.id) continue;
      const r = peekRel(u, p.id, st.id);
      if (!r) continue;
      const acts = KINDS.filter((k) => r.defied?.[k] !== undefined).map((k) => ({ kind: k, tick: r.defied![k]! })).sort((a, b) => a.tick - b.tick);
      const answers = (u.god.rel?.arcEvents ?? []).filter((e) => e.planet === p.id && e.kind === 'answer' && e.towns.includes(st.id)).map((e) => ({ how: e.god, tick: e.tick }));
      out.push({ planet: p.id, settlement: st.id, name: st.name, level: r.defiance ?? 0, load: r3(Math.min(1, (r.harmLoad ?? 0) / DEFY.loadDiv)),
        acts, answers, open: r.answer ?? null, idol: r.idol ?? null, answered: answeredWords(r) });
    }
  }
  return typeof args.settlement === 'number' ? out[0] ?? null : out;
}

// ───────────────────────────── commands ─────────────────────────────

/** ARC §6.4: defiance.set (Debug), defiance.answer (Signs; wrath is WRATHFUL) */
export function registerDefianceCommands(reg: CommandRegistry): void {
  reg.register('defiance.set', ({ u, p }, a) => {
    if (!p.people) return fail('There are no people here.');
    const st = typeof a.settlement === 'number' ? p.people.settlement(a.settlement) : undefined;
    if (!st || st.fallen >= 0 || st.band) return fail('Set the defiance of which town?');
    const r = srel(u, p.id, st.id);
    const x = makeCtx(u, p);
    r.defiance = r3(clamp(Number(a.value)));
    r.since.dHold = x.tick + ARC.holdDays * x.day;
    r.since.dHoldV = r.defiance;
    return ok(`The defiance of ${st.name} is set to ${r.defiance} for thirty days.`);
  }, { desc: 'Set a town\'s defiance and hold it there for 30 days (tests and shots)', category: 'Debug',
    params: { settlement: { type: 'int', required: true, min: 0 }, value: { type: 'number', required: true, min: 0, max: 1 } } });

  reg.register('defiance.answer', ({ u, p, cmd }, a) => {
    if (!p.people) return fail('There are no people here.');
    const st = typeof a.settlement === 'number' ? p.people.settlement(a.settlement) : undefined;
    if (!st || st.fallen >= 0) return fail('Answer which town?');
    const how = String(a.how) as Answer;
    const g = typeof cmd.god === 'number' ? cmd.god : 0;
    const x = makeCtx(u, p);
    const r = srel(u, p.id, st.id);
    if (how === 'patience') {
      r.since.patience = x.tick;
      return ok(`You let ${st.name} rage, and do nothing.`);
    }
    let sub: Record<string, unknown>;
    if (how === 'wrath') {
      // lightning beside (not on) the crowd, the idol or the burned shrine: 150 m from it, on a bearing of its own
      const idol = r.idol !== undefined ? x.ps.building(r.idol) : undefined;
      const c = idol ? idol.pos : st.pos;
      const ang = hashFloat(st.id, x.tick, 0xdefc, u.seed) * Math.PI * 2;
      const R = p.st.radius;
      let ex = -c[1], ey = c[0], ez = 0;
      let l = Math.hypot(ex, ey, ez);
      if (l < 1e-6) { ex = 1; ey = 0; ez = 0; l = 1; }
      ex /= l; ey /= l; ez /= l;
      const fx = c[1] * ez - c[2] * ey, fy = c[2] * ex - c[0] * ez, fz = c[0] * ey - c[1] * ex;
      const k = 150 / R;
      const q = [c[0] + k * (Math.cos(ang) * ex + Math.sin(ang) * fx), c[1] + k * (Math.cos(ang) * ey + Math.sin(ang) * fy), c[2] + k * (Math.cos(ang) * ez + Math.sin(ang) * fz)];
      const n = Math.hypot(q[0], q[1], q[2]);
      sub = { k: 'miracle.lightning', pos: [q[0] / n, q[1] / n, q[2] / n] };
      if (typeof a.wrath === 'number') sub.wrath = a.wrath;
      if (a.covenant !== undefined) sub.covenant = a.covenant;
    } else if (how === 'mercy') sub = { k: 'settlement.gift', settlement: st.id, items: { bread: 40 } };
    else if (how === 'sign') sub = { k: 'god.omen', settlement: st.id };
    else return fail('Answer how? With wrath, mercy, a sign, or patience.');
    const res = reg.dispatch(u, { ...sub, god: g, planet: p.id } as never);
    if (!res.ok) return fail(`The answer could not be given: ${res.msg}`);
    return { ok: true, msg: res.msg, created: res.created };
  }, { desc: 'Answer a defiant town: wrath (lightning beside them), mercy (bread), a sign, or patience (do nothing)', category: 'Signs',
    params: { settlement: { type: 'int', required: true, min: 0 }, how: { type: 'enum', values: ['wrath', 'mercy', 'sign', 'patience'], required: true },
      covenant: { type: 'enum', values: ['keep', 'break'] } } });
}
