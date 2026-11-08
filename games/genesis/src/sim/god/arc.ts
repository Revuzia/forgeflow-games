// GENESIS — ARC (ARC.md §0.4, §1, §2.1): the hearts of the people toward their god, their pride, and the memory of what
// the god did. Stage A: the per-person heart (§1.1), the settlement heart with its 3-day hysteresis and the proud flag
// (§1.2), dusk attendance (§1.2), pride and its parts (§2.1), the per-agent sign for the snapshot (§1.3), the hearts
// view and query (§6.2, §6.6), and the chronicle lines of §1.5 (throttled through `told`).
//
// Everything here is a pure function of the people's columns and the saved rel record, run once a day per town in
// `ps.settlements` order (relationshipDaily, after conversions). No Math.random, no Date, no Map-iteration order.
// Old saves: the first ARC daily of a town fills its state lazily (§7): `since.arc0`, memory zeros, `lastHarm` from the
// saved acts, `harmLoad` estimated, pride set to its target and the hearts taken that day with no hysteresis wait.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Settlement } from '../people/state.ts';
import type { PCtx } from '../people/ctx.ts';
import type { HeartKind, HeartSignId, MoverBlock, SettlementView } from '../types.ts';
import type { Memory, SettlementRel } from './state.ts';
import { AgentFlag, AgentFlag2, HeartSign } from '../types.ts';
import { hashFloat } from '../core/rng.ts';
import { makeCtx } from '../people/ctx.ts';
import { GODS, NT, TASK, TRAIT } from '../people/defs.ts';
import { cohortTotal } from '../people/cohorts.ts';
import { langDistance } from '../people/culture.ts';
import { tell } from '../people/story.ts';
import { settlementRef, vars } from '../people/util.ts';
import { distM } from '../people/world.ts';
import { peekRel, srel } from './regard.ts';
import type { CommandRegistry } from './commands.ts';
import { fail, ok } from './util.ts';
import scripture from '../../data/scripture.json' with { type: 'json' };

/** ARC tunables (every number of ARC.md marked *(ARC)*) */
export const ARC = {
  /** a settlement heart kind needs this share of grown members, else quiet (§1.2) */
  heartShare: 0.30,
  /** days a new kind must hold before it is taken (§1.2) */
  heartHoldDays: 3,
  /** dusk: `low` set when the ema falls below this from above duskHigh, cleared above duskHigh */
  duskLow: 0.25,
  duskHigh: 0.45,
  /** dusk flags relative to the town's own peak (contract-changes.md): armed once the peak reached duskArm; high and low
   * are these fractions of it (never above duskHigh / duskLow); the peak's half-life toward the ema in years */
  duskArm: 0.18,
  duskHiFrac: 0.85,
  duskLoFrac: 0.6,
  duskPeakYears: 2,
  /** the shrine stands empty also when the share kept home by their hearts (ema) reaches this and passes those who came */
  duskAway: 0.1,
  /** of those the evening draws, the share each heart lets go (relationship.ts vespers; the rest stay home) */
  duskKeep: { devoted: 1, quiet: 1, restless: 0.6, fearful: 0.3, defiant: 0 } as Record<HeartKind, number>,
  /** dusk ema divisor (days) */
  duskEma: 12,
  /** pride flag (§1.2) */
  proud: 0.6,
  /** daily pride relaxation toward its target (§2.1) */
  prideRate: 0.02,
  /** pride target is 0 under this population */
  pridePop: 40,
  /** pride kin radius (m) and tongue distance (§2.1 U) */
  kinRadius: 15000,
  kinLang: 0.45,
  /** years unpunished at which L saturates */
  prideYears: 15,
  /** a chronicle line id at most once per town per this many years (§1.5) */
  tellYears: 2,
  /** heart.cowed: defiant -> fearful within this many days of a god-0 harm */
  cowedDays: 10,
  /** per-person heart thresholds (§1.1) */
  defiantTown: 0.45,
  /** per-agent fear glance chance per hour (§1.3) */
  fearGlance: 0.15,
  /** debug pride.set / defiance.set hold (days) */
  holdDays: 30,
} as const;

type Scripture = { caption: Record<string, string>; line: Record<string, string>; person: Record<string, string>; share: string[];
  prideWhy: Record<string, string>; remember: Record<string, string> };
const S = scripture as unknown as Scripture;

const KINDS = ['devoted', 'fearful', 'restless', 'defiant'] as const;

export function emptyMemory(): Memory {
  return { wrath: 0, patience: 0, mercy: 0, sign: 0, humbled: 0, betrayed: 0, kept: 0, proud: 0 };
}

const clamp = (v: number, lo = 0, hi = 1): number => (v < lo ? lo : v > hi ? hi : v);
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/** §1.2: of those the evening worship draws, the share a heart lets go (the rest stay home: `vespers.away`) */
export function duskKeep(h: HeartKind): number { return ARC.duskKeep[h] ?? 1; }

/** §1.1: the heart of one grown member toward god 0 (the first rule that holds wins) */
export function personHeart(A: PCtx['A'], s: number, defiance: number, pride: number): HeartKind {
  const i = s * GODS;
  const fear = A.fear[i], love = A.love[i], faith = A.faith[i], loyalty = A.loyalty[i];
  const b = A.traits[s * NT + TRAIT.boldness];
  if (defiance >= ARC.defiantTown && b >= 0.5 && fear < 0.7 && love < 0.35) return 'defiant';
  if (fear >= 0.5 && fear > love + 0.1) return 'fearful';
  if (faith >= 0.5 && love >= fear && loyalty >= 0.35) return 'devoted';
  if (A.mood[s] < 0.45 || (faith < 0.35 && love < 0.3 && pride >= 0.5)) return 'restless';
  return 'quiet';
}

/** §2.1 the parts of pride, each 0..1 */
export interface PrideParts { P: number; T: number; U: number; L: number; F: number }

/** §2.1 + §0.4: pride's target from its parts, the town's fear and trust means, its memory and population */
export function prideTarget(w: PrideParts, fear: number, trust: number, mem: Memory | undefined, pop: number): number {
  if (pop < ARC.pridePop) return 0;
  let t = 0.22 * w.P + 0.18 * w.T + 0.18 * w.U + 0.22 * w.L + 0.20 * w.F - 0.6 * Math.max(0, fear - 0.3);
  if (mem) {
    if (trust >= 0.3) t -= 0.05 * Math.min(1, mem.wrath);
    t += 0.03 * Math.min(1, mem.patience);
    t -= 0.25 * Math.min(1, mem.humbled);
    t += 0.05 * Math.min(1, mem.proud);
  }
  return clamp(t);
}

/** §2.1 the parts for a town now */
export function prideParts(x: PCtx, st: Settlement, r: SettlementRel, faith: number): PrideParts {
  const hist = st.age?.hist ?? [];
  let q = 0;
  for (const h of hist) q += h[2] ?? 0;
  q = hist.length ? q / hist.length : 0;
  let k = 0;
  for (const o of x.ps.settlements) {
    if (o.fallen >= 0 || o.band || o.species !== st.species) continue;
    if (o !== st && (distM(x.p, o.pos, st.pos) > ARC.kinRadius || langDistance(st, o) > ARC.kinLang)) continue;
    k++;
  }
  const grievance = st.hist?.grievance ?? 0;
  const from = r.lastHarm !== undefined && r.lastHarm >= 0 ? r.lastHarm : r.since.arc0 ?? x.tick;
  const yrs = Math.max(0, (x.tick - from) / x.year);
  return {
    P: r3(clamp((q - 2) / 4)),
    T: r3(clamp((st.era - 1) / 3)),
    U: r3(clamp((k - 1) / 3) * (1 - grievance)),
    L: r3(clamp(yrs / ARC.prideYears)),
    F: r3(clamp(1 - faith)),
  };
}

/** ARC §2.1 note (stint r1-1, finding 5): "chosen", answered prayers as a boast, 0..1 (three answered recently = 1).
 *  Pride's F part is the larger of unbelief and this: a favoured town grows proud as an unbelieving one does. */
export function chosenOf(r: SettlementRel, tick: number, year: number): number {
  const n = r.since.chosenN ?? 0;
  if (n <= 0) return 0;
  return clamp((n * Math.pow(0.5, (tick - (r.since.chosenT ?? tick)) / (3 * Math.max(1, year)))) / 3);
}

/** fix a (§2.1, §3): a god-0 harm on the town (regard.ts endAct) */
export function noteHarm(r: SettlementRel, tick: number, year: number): void {
  decayHarm(r, tick, year);
  r.lastHarm = tick;
  r.harmLoad = (r.harmLoad ?? 0) + 1;
}

/** harmLoad halves yearly: decayed lazily to `tick` (since.harmT holds the tick it was last decayed to) */
function decayHarm(r: SettlementRel, tick: number, year: number): void {
  const t0 = r.since.harmT ?? tick;
  if (r.harmLoad && tick > t0) r.harmLoad = r3(r.harmLoad * Math.pow(0.5, (tick - t0) / year));
  r.since.harmT = tick;
}

/** §7: the lazy fill of an old (or new) town's ARC state on its first daily */
function arcInit(x: PCtx, st: Settlement, r: SettlementRel): boolean {
  if (r.since.arc0 !== undefined) return false;
  // a town met within two days of its founding is new; anything older comes from a save made before the arc
  r.since.arc0 = st.founded >= 0 && x.tick - st.founded <= 2 * x.day ? st.founded : x.tick;
  r.memory ??= emptyMemory();
  if (r.lastHarm === undefined) {
    let load = 0, last = -1;
    for (const a of r.acts) if (a.god === 0 && a.kind === 'harm' && !a.natural) {
      last = Math.max(last, a.tick);
      load += Math.pow(0.5, Math.max(0, x.tick - a.tick) / x.year);
    }
    if (last >= 0) { r.lastHarm = last; r.harmLoad = r3(load); r.since.harmT = x.tick; }
  }
  r.defiance ??= 0;
  return true;
}

/** the members pass of §1.2 / §2.1: shares, means and dusk */
interface Pass { n: number; devoted: number; fearful: number; restless: number; defiant: number; faith: number; fear: number; trust: number; went: number; away: number }

function membersPass(x: PCtx, st: Settlement, r: SettlementRel, defiance: number, pride: number): Pass {
  const A = x.A;
  const o: Pass = { n: 0, devoted: 0, fearful: 0, restless: 0, defiant: 0, faith: 0, fear: 0, trust: 0, went: 0, away: 0 };
  const went = r.vespers && x.tick - r.vespers.t <= x.day ? new Set(r.vespers.went) : null;
  const away = r.vespers?.away?.length && x.tick - r.vespers.t <= x.day ? new Set(r.vespers.away) : null;
  for (const s of x.ps.members.get(st.id) ?? []) {
    const i = s * GODS;
    o.faith += A.faith[i]; o.fear += A.fear[i]; o.trust += A.love[i];
    if (A.flags[s] & AgentFlag.child) continue;
    o.n++;
    const h = personHeart(A, s, defiance, pride);
    if (h !== 'quiet') o[h]++;
    if (went && went.has(A.id[s])) o.went++;
    if (away && away.has(A.id[s])) o.away++;
  }
  const m = Math.max(1, (x.ps.members.get(st.id) ?? []).length);
  o.faith /= m; o.fear /= m; o.trust /= m;
  return o;
}

/** a §1.5 line, at most once per town per ARC.tellYears through `told` */
function tellOnce(x: PCtx, st: Settlement, r: SettlementRel, id: string, weight: number): void {
  const told = (r.told ??= {});
  const last = told[id];
  if (last !== undefined && x.tick - last < ARC.tellYears * x.year) return;
  told[id] = x.tick;
  tell(x.u, x.p, id, vars(x, st), st, [settlementRef(x, st)], weight);
}

/** §1.2 + §2.1: once a day per town that is neither a band nor fallen */
export function heartsDaily(x: PCtx, st: Settlement): void {
  if (st.fallen >= 0 || st.band) return;
  const u = x.u, r = srel(u, x.p.id, st.id);
  const first = arcInit(x, st, r);
  decayHarm(r, x.tick, x.year);
  const defiance = r.defiance ?? 0;
  const pass = membersPass(x, st, r, defiance, r.pride ?? 0);
  // pride (§2.1)
  const why = prideParts(x, st, r, pass.faith);
  const pop = (x.ps.members.get(st.id) ?? []).length + cohortTotal(st);
  let target = prideTarget(why, pass.fear, pass.trust, r.memory, pop);
  const holdUntil = r.since.prideHold;
  if (holdUntil !== undefined) {
    if (x.tick <= holdUntil) target = Math.max(target, r.since.prideHoldV ?? 0);
    else { delete r.since.prideHold; delete r.since.prideHoldV; }
  }
  r.prideWhy = why;
  r.pride = r3(first || r.pride === undefined ? target : clamp(r.pride + (target - r.pride) * ARC.prideRate));
  // a rising tower's builders (§2.3): +0.002 a day, never above target + 0.15 (tower.ts sets since.tLeague daily)
  if (r.since.tLeague !== undefined && r.since.tLeague >= x.tick && r.pride < target + 0.15) r.pride = r3(Math.min(clamp(r.pride + 0.002), target + 0.15));
  // hearts
  const n = Math.max(1, pass.n);
  const sh = { devoted: r3(pass.devoted / n), fearful: r3(pass.fearful / n), restless: r3(pass.restless / n), defiant: r3(pass.defiant / n) };
  let cand: HeartKind = 'quiet';
  let best = 0;
  for (const k of KINDS) if (sh[k] > best) { best = sh[k]; cand = k; }
  if (best < ARC.heartShare) cand = 'quiet';
  const proud = r.pride >= ARC.proud;
  const prev = r.hearts;
  if (!prev) {
    r.hearts = { ...sh, kind: cand, proud, since: x.tick };
  } else {
    const h = prev;
    h.devoted = sh.devoted; h.fearful = sh.fearful; h.restless = sh.restless; h.defiant = sh.defiant;
    if (cand === h.kind) delete h.pending;
    else if (!h.pending || h.pending.kind !== cand) h.pending = { kind: cand, from: x.tick };
    else if (x.tick - h.pending.from >= (ARC.heartHoldDays - 1) * x.day) {
      const from = h.kind;
      h.kind = cand; h.since = x.tick; delete h.pending;
      u.emit({ t: 'heart', planet: x.p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], ref: settlementRef(x, st), data: { settlement: st.id, from, to: cand } });
      heartLine(x, st, r, from, cand);
    }
    if (h.proud !== proud) {
      h.proud = proud;
      u.emit({ t: 'heart.proud', planet: x.p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], ref: settlementRef(x, st), data: { settlement: st.id, proud } });
      if (proud) tellOnce(x, st, r, 'heart.proud', 1);
    }
  }
  // dusk (§1.2): the share of grown members at the last evening's worship
  const today = r3(pass.went / n);
  const d = r.dusk ?? (r.dusk = { ema: today, today, low: false, yearAgo: today });
  if (r.since.duskY === undefined) r.since.duskY = x.tick;
  if (x.tick - r.since.duskY >= x.year) { d.yearAgo = d.ema; r.since.duskY = x.tick; }
  d.today = today;
  if (!first) d.ema = r3(d.ema + (today - d.ema) / ARC.duskEma);
  // the town's own peak (since.duskPk): vespers attendance tops out near 0.25-0.45 even in a faithful town, so the
  // flags are relative to it (contract-changes.md, §1.2): high = min(duskHigh, duskHiFrac x peak), low = min(duskLow,
  // duskLoFrac x peak), armed only once the peak reached duskArm. The peak falls back toward the ema with a half-life of
  // duskPeakYears, and not at all while the shrine stands empty (so the low flag is not cleared by a sinking peak).
  let pk = r.since.duskPk ?? d.ema;
  if (!d.low && pk > d.ema) pk -= (pk - d.ema) * (1 - Math.pow(0.5, x.day / (ARC.duskPeakYears * x.year)));
  pk = r3(Math.max(pk, d.ema));
  r.since.duskPk = pk;
  const hi = Math.min(ARC.duskHigh, ARC.duskHiFrac * pk), lo = Math.min(ARC.duskLow, ARC.duskLoFrac * pk);
  // those the evening drew whose heart kept them home (relationship.ts vespers `away`), as an ema like the dusk's own
  const aw = r3((r.since.duskAw ?? 0) + (r3(pass.away / n) - (r.since.duskAw ?? 0)) / ARC.duskEma);
  r.since.duskAw = aw;
  const shunned = aw >= ARC.duskAway && aw > d.ema;
  if (pk >= ARC.duskArm && d.ema >= hi && aw < d.ema * 0.5) {
    if (d.low) { d.low = false; tellOnce(x, st, r, 'heart.bowagain', 1); }
    r.since.duskHi = 1;
  } else if (!d.low && ((d.ema < lo && r.since.duskHi) || shunned)) {
    d.low = true; delete r.since.duskHi;
    tellOnce(x, st, r, 'heart.nobow', 1);
  }
}

function heartLine(x: PCtx, st: Settlement, r: SettlementRel, from: HeartKind, to: HeartKind): void {
  if (to === 'fearful') {
    const cowed = from === 'defiant' && r.lastHarm !== undefined && r.lastHarm >= 0 && x.tick - r.lastHarm <= ARC.cowedDays * x.day;
    tellOnce(x, st, r, cowed ? 'heart.cowed' : 'heart.fearful', cowed ? 2 : 1);
  } else if (to === 'restless') tellOnce(x, st, r, 'heart.restless', 1);
  else if (to === 'defiant') tellOnce(x, st, r, 'heart.defiant', 2);
  else if (to === 'devoted' && from !== 'quiet') tellOnce(x, st, r, 'heart.devoted', 1);
}

/** relationshipDaily's ARC step for a planet (every standing town in `ps.settlements` order) */
export function arcDaily(u: Universe, p: Planet): void {
  const ps = p.people;
  if (!ps || !ps.settlements.length) return;
  const x = makeCtx(u, p);
  for (const st of ps.settlements) heartsDaily(x, st);
}

/** debug `pride.set`: set pride and hold its target at least there for ARC.holdDays */
export function setPride(x: PCtx, st: Settlement, value: number): void {
  const r = srel(x.u, x.p.id, st.id);
  arcInit(x, st, r);
  r.pride = r3(clamp(value));
  r.since.prideHold = x.tick + ARC.holdDays * x.day;
  r.since.prideHoldV = r.pride;
  if (r.hearts) r.hearts.proud = r.pride >= ARC.proud;
}

// ───────────────────────────── words ─────────────────────────────

/** a share in words (never a number in sacred text) */
export function shareWords(v: number): string {
  const w = S.share;
  return v < 0.15 ? w[0] : v < 0.3 ? w[1] : v < 0.42 ? w[2] : v < 0.6 ? w[3] : v < 0.85 ? w[4] : w[5];
}

export function caption(kind: HeartKind): string { return S.caption[kind] ?? ''; }

function lineOf(kind: HeartKind, name: string): string {
  return (S.line[kind] ?? '').replace('{settlement}', name);
}

/** §6.5 "what do they feel": the hearts of one town (or every town of the planet) in the voice, from the views:
 * "In Aru most watch the sky (about half); some raise their fists." */
export function heartWords(u: Universe, planet: number, sid?: number): string {
  const p = u.planets.find((q) => q.id === planet);
  const ps = p?.people;
  if (!ps) return 'There are no people here.';
  const verb: Record<string, string> = { devoted: 'bow at dusk', fearful: 'watch the sky', restless: 'murmur against you', defiant: 'raise their fists' };
  // towns that feel alike are named together ("In Aru, Tesh and Vorn most murmur against you.")
  const groups = new Map<string, string[]>();
  for (const st of ps.settlements) {
    if (st.fallen >= 0 || st.band || (sid !== undefined && st.id !== sid)) continue;
    const h = peekRel(u, planet, st.id)?.hearts;
    if (!h) continue;
    const shares = (['devoted', 'fearful', 'restless', 'defiant'] as const).map((k) => [k, h[k]] as const).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const [k0, v0] = shares[0];
    let line = h.kind === 'quiet' || v0 < 0.15 ? 'they go about their days' : `${shareWords(v0)} ${verb[k0]}`;
    const more = shares.slice(1).filter(([, v]) => v >= 0.15).map(([k, v]) => `${shareWords(v)} ${verb[k]}`);
    if (more.length) line += `; ${more.join(', ')}`;
    const r = peekRel(u, planet, st.id);
    if (r && (r.pride ?? 0) >= 0.6) line += '. They are proud';
    const g = groups.get(line) ?? [];
    g.push(st.name);
    groups.set(line, g);
  }
  const and = (n: string[]) => (n.length > 4 ? `${n.slice(0, 4).join(', ')} and ${n.length - 4} more towns` : n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n[0]);
  const out = [...groups.entries()].slice(0, 4).map(([line, names]) => `In ${and(names)} ${line}.`);
  return out.length ? out.join(' ') : sid !== undefined ? 'Nobody lives there now.' : 'Nobody here has a heart to read yet.';
}

/** the inspector's one-line caption of a person (§1.4) */
export function personLine(kind: HeartKind, name: string): string {
  return (S.person[kind] ?? '').replace('{name}', name);
}

/** pride's reasons in words, strongest first (parts ≥ 0.4) */
export function prideWords(w: PrideParts | undefined): string {
  if (!w) return '';
  return (Object.keys(w) as (keyof PrideParts)[]).filter((k) => w[k] >= 0.4).sort((a, b) => w[b] - w[a] || (a < b ? -1 : 1))
    .map((k) => S.prideWhy[k]).join(', ');
}

/** up to three memory phrases with weight ≥ 0.3, heaviest first (§1.4) */
export function rememberWords(mem: Memory | undefined): string[] {
  if (!mem) return [];
  const keys = ['wrath', 'patience', 'mercy', 'sign', 'humbled', 'betrayed', 'kept', 'proud'] as const;
  return keys.filter((k) => mem[k] >= 0.3).sort((a, b) => mem[b] - mem[a] || (a < b ? -1 : 1)).slice(0, 3).map((k) => S.remember[k]);
}

// ───────────────────────────── views and queries ─────────────────────────────

/** §6.2 SettlementView.heart (absent before the town's first ARC daily) */
export function heartView(r: SettlementRel | undefined, st: Settlement): SettlementView['heart'] | undefined {
  const h = r?.hearts;
  if (!r || !h) return undefined;
  const d = r.dusk;
  return {
    kind: h.kind, proud: h.proud, devoted: h.devoted, fearful: h.fearful, restless: h.restless, defiant: h.defiant,
    pride: r.pride ?? 0, defiance: r.defiance ?? 0, dusk: d?.ema ?? 0, duskYearAgo: d?.yearAgo ?? 0,
    caption: caption(h.kind), line: lineOf(h.kind, st.name), remember: rememberWords(r.memory), answered: '',
  };
}

/** per-town facts the per-agent sign reads (§1.3), built once per snapshot */
interface TownSign { kind: HeartKind; defiance: number; pride: number; touched: boolean; helped: boolean; wrathNow: boolean }

function townSign(r: SettlementRel | undefined, tick: number): TownSign {
  const t: TownSign = { kind: r?.hearts?.kind ?? 'quiet', defiance: r?.defiance ?? 0, pride: r?.pride ?? 0, touched: false, helped: false, wrathNow: false };
  if (!r) return t;
  for (const a of r.acts) {
    if (a.god !== 0) continue;
    const end = Math.max(a.tick, a.until ?? a.tick);
    if (tick - end <= 120) t.touched = true;
    if (a.kind === 'harm' && tick - end <= 60) t.wrathNow = true;
    if ((a.kind === 'help' || a.kind === 'mercy' || a.kind === 'answered') && tick - end <= 360) t.helped = true;
  }
  for (const k in r.omens) if (tick - r.omens[k] <= 120) t.touched = true;
  return t;
}

/** §1.3: MoverBlock.heart for a snapshot's agents (relSnapPlanet) */
export function heartSigns(u: Universe, p: Planet, b: MoverBlock): void {
  const ps = p.people;
  if (!ps || !b.count) return;
  const x = makeCtx(u, p);
  const A = x.A, tick = u.tick, hour = Math.floor(tick / 60);
  const out = b.heart ?? (b.heart = new Uint8Array(b.count));
  const towns = new Map<number, TownSign>();
  for (let k = 0; k < b.count; k++) {
    const s = A.slotOf(b.id[k]);
    if (s < 0) { out[k] = HeartSign.none; continue; }
    const task = A.task[s];
    let v: HeartSignId = HeartSign.none;
    if (task === TASK.pray || task === TASK.worship || task === TASK.pilgrimage) v = HeartSign.pray;
    else if (!(A.flags[s] & AgentFlag.child)) {
      const sid = b.group[k];
      let t = towns.get(sid);
      if (!t) { t = townSign(peekRel(u, p.id, sid), tick); towns.set(sid, t); }
      const h = personHeart(A, s, t.defiance, t.pride);
      const festive = !!((b.flags2?.[k] ?? 0) & AgentFlag2.festive);
      if (h === 'defiant' && t.wrathNow) v = HeartSign.fist;
      else if (h === 'fearful' && (task === TASK.shelter || task === TASK.evacuate || t.touched
        || (t.kind === 'fearful' && !(A.flags[s] & AgentFlag.sleepingIndoors) && hashFloat(b.id[k], hour, 0x4ea1) < ARC.fearGlance))) v = HeartSign.fear;
      else if (festive || (h === 'devoted' && t.helped)) v = HeartSign.celebrate;
    } else if ((b.flags2?.[k] ?? 0) & AgentFlag2.festive) v = HeartSign.celebrate;
    out[k] = v;
  }
}

/** §6.6 query('hearts', { settlement? }) */
export function heartsQuery(u: Universe, args: Record<string, unknown>): unknown[] {
  const out: unknown[] = [];
  for (const p of u.planets) {
    const ps = p.people;
    if (!ps) continue;
    for (const st of ps.settlements) {
      if (st.fallen >= 0 || st.band) continue;
      if (typeof args.settlement === 'number' && args.settlement !== st.id) continue;
      const r = peekRel(u, p.id, st.id);
      const v = heartView(r, st);
      if (!r || !v) continue;
      out.push({ planet: p.id, settlement: st.id, name: st.name, kind: v.kind, proud: v.proud, devoted: v.devoted, fearful: v.fearful,
        restless: v.restless, defiant: v.defiant, pride: v.pride, prideWhy: r.prideWhy ?? null, prideWords: prideWords(r.prideWhy),
        defiance: v.defiance, defied: r.defied ?? {}, memory: r.memory ?? emptyMemory(), dusk: r.dusk ?? null, caption: v.caption,
        line: v.line, remember: v.remember });
    }
  }
  return out;
}

/** the agent detail query's `heart` (people/query.ts) */
export function agentHeart(u: Universe, p: Planet, s: number): HeartKind {
  const x = makeCtx(u, p);
  const sid = x.A.settlement[s];
  const r = sid >= 0 ? peekRel(u, p.id, sid) : undefined;
  return personHeart(x.A, s, r?.defiance ?? 0, r?.pride ?? 0);
}


// ───────────────────────────── commands ─────────────────────────────

/** ARC §6.4 debug commands of stage A's moods (the tower's register in tower.ts) */
export function registerArcCommands(r: CommandRegistry): void {
  r.register('pride.set', ({ u, p }, a) => {
    if (!p.people) return fail('There are no people here.');
    const st = typeof a.settlement === 'number' ? p.people.settlement(a.settlement) : undefined;
    if (!st || st.fallen >= 0 || st.band) return fail('Set the pride of which town?');
    const x = makeCtx(u, p);
    setPride(x, st, Number(a.value));
    return ok(`The pride of ${st.name} is set to ${srel(u, p.id, st.id).pride} for thirty days.`);
  }, { desc: 'Set a town\'s pride and hold it there for 30 days (tests and shots)', category: 'Debug',
    params: { settlement: { type: 'int', required: true, min: 0 }, value: { type: 'number', required: true, min: 0, max: 1 } } });
}
