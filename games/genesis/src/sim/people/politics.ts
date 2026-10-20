// GENESIS — LIVING HISTORY (LIVING.md §5.1): politics from real grievances inside one people. A daughter town keeps a
// GRIEVANCE (0..1) against its capital, built from what really happens between them, and goes its own way when it runs
// high; hungry towns raid even their kin; neighbours whose fields and hunting grounds touch grow cold. war.ts calls
// `historyDaily` once a day per planet (before the relations between polities are weighed).
//
//   grievance + tribute paid (a tithe of food and goods to the capital each season of 3 days: +0.004)
//             + a famine (under a day of food a head, or a death of hunger) the capital did not relieve while it had food to
//               spare (judged after 2 days: +0.45 — the strongest of them)
//             + a leaders' feud, or a rival faction leading the daughter against the capital's (+0.12, once a leader)
//             + distance: more than a day's walk from the capital (+0.002 a day for each day of walking beyond half a day,
//               up to 0.004 at two and a half days)
//             + a tongue drifting apart: a generation (20 game years) with little contact adds a drift to the daughter's
//               speech (people/culture.ts langDistance), and every 0.18 of distance weighs a little each day
//             + raided by kin (+0.3), border friction over touching fields and hunting grounds (+0.001 a day)
//             + a daughter grown as large as its capital (0.9 of it and more: +0.0015 a day at 1.2 times its size, up to
//               0.0045 at twice it: the people of the larger town no longer bow to the smaller)
//             − kin visits (trade caravans and gifts: −0.0005 each), aid in hard times (−0.15), time (−0.2 % a day)
//   secession grievance > 0.6: a daily chance rising to 0.02 by 0.72, carried by the independence party's strength
//             (0.5 .. 1: the hawks and the seekers of the new) — a bitter one (most of it raids or unrelieved famine, or grievance
//             > 0.85 with a strong war party) is a revolt and war (war.ts secede / declareWar); otherwise a peaceful parting,
//             sealed by a pact to keep the roads open between them unless a feud was at its root
//   kin raids a town with less than a day of food raids a neighbour within two days' walk (a raid is a march of a day or
//             two) that has 5 days a head and whom it holds below 0.3 — inside one polity too (missions.ts raid; war.ts)
//   aid       the capital relieves a hungry daughter when it has food to spare, more readily under a generous leader
//             (`sendAid`: a gift mission of food; the kin fixture's control sends it in every famine)
//
// The same per-settlement record (`hist`, saved with the settlement; made on first use, copied from the parent for a
// daughter) carries the era clock and the era label of people/eras.ts. Every roll is a stateless hash.

import type { PCtx } from './ctx.ts';
import type { Mission, Settlement } from './state.ts';
import { hashFloat } from '../core/rng.ts';
import { BASE_WALK, NT, TRAIT } from './defs.ts';
import { foodDays, storeAdd, storeTake } from './store.ts';
import { cohortTotal } from './cohorts.ts';
import { tell } from './story.ts';
import { settlementRef, vars } from './util.ts';
import { distM } from './world.ts';
import { newMission, routeBetween, volunteers, bestBoat } from './missions.ts';
import { langDistance } from './culture.ts';
import { factionShare } from './social.ts';
import { driftLanguage } from './names.ts';
import { worldSalt } from './lifecycle.ts';
import { relationOf, secede, polityName, polityOf } from './war.ts';
import { syncEra } from './eras.ts';

/** a settlement's history: its grievance against its capital, its kin, its era clock (LIVING.md §5.1, §5.2) */
export interface HistState {
  /** grievance against its capital 0..1 (a capital, or a town of its own polity, holds none) */
  grievance: number;
  /** what the grievance is made of (each part decays with it): tribute, famine, feud, distance, tongue, raids, friction */
  why: Record<string, number>;
  /** a hard time in progress: the tick it began (-1 none), whether the capital had food to spare, the tick aid was sent;
   * the starvation deaths counted so far (a death of hunger is a hard time whatever the stores say) */
  famine: number;
  starved?: number;
  spare: boolean;
  aid: number;
  /** the hard time was judged (the grievance counted once) */
  judged: boolean;
  /** tick tribute was last paid to the capital */
  paid: number;
  /** the leaders a feud was last weighed for ("<ours>:<theirs>") */
  feud: string;
  /** contacts with the capital this generation (missions that arrived), and the tick the generation began */
  visits: number;
  genAt: number;
  /** opinion of kin towns of its polity (settlement id -> -1..1; absent = 0.5, kin) */
  kin: Record<string, number>;
  /** LIVING §5.2 (people/eras.ts): the tick each era index was first reached; recipe id -> the tick the settlement
   * learned it (-1 = time out of mind: known when the record was made) — by id, so appended content never shifts it */
  eraAt: Record<string, number>;
  since: Record<string, number>;
  /** the era label of its defining capabilities ("first farmers", "copper age" ...) */
  label: string;
}

/** the tunable weights (a probe may change them in its own process; the game never does) */
export const POLITICS = {
  /** daily fade of a grievance (a grievance is remembered for a generation and more: half-life ~29 game years) */
  decay: 0.002,
  tributeDays: 3, tributeShare: 0.1, tribute: 0.004,
  /** a hard time: under this many days of food a head; the capital has food to spare above this */
  leanDays: 1, spareDays: 4, judgeDays: 2, famine: 0.45, aid: 0.15, aidP: 0.2,
  feud: 0.12,
  /** a day's walk (game minutes of walking × BASE_WALK) and the grievance a day for each day beyond it */
  dayWalkMin: 600, distance: 0.002,
  /** a daughter grown as large as its capital (from 0.9 of it) no longer bows to it: a day, at 1.2 times its size */
  outgrown: 0.0015,
  generationYears: 20, rareVisits: 4, drift: 0.05, tongue: 0.0015,
  kinRaid: 0.3, raider: 0.15, friction: 0.001, frictionOp: 0.01,
  /** how far a hungry town's raiders go (days of walking: a raid is a march of a day or two) */
  raidDays: 2,
  /** a trade caravan or a gift between them (they come often: a little each) */
  visit: 0.0005,
  threshold: 0.6, maxP: 0.02, revolt: 0.85,
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** grievances move by small daily steps: kept to a millionth */
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** the history record of a settlement (made on first use; a daughter starts from her mother's era clock) */
export function histOf(x: PCtx, st: Settlement): HistState {
  let h = st.hist;
  if (h) return h;
  const parent = st.parent >= 0 ? x.ps.settlement(st.parent) : undefined;
  const ph = parent?.hist;
  h = {
    grievance: 0, why: {}, famine: -1, spare: false, aid: -1, judged: false, paid: x.tick, feud: '', visits: 0, genAt: x.tick, kin: {},
    eraAt: ph ? { ...ph.eraAt } : { [String(st.era)]: x.tick }, since: ph ? { ...ph.since } : {}, label: '',
  };
  for (const k of st.library) { const id = x.rt.list[k]?.id; if (id && h.since[id] === undefined) h.since[id] = -1; }
  if (h.eraAt[String(st.era)] === undefined) h.eraAt[String(st.era)] = x.tick;
  st.hist = h;
  return h;
}

export function popOf(x: PCtx, st: Settlement): number {
  return (x.ps.members.get(st.id)?.length ?? 0) + cohortTotal(st);
}

/** days of walking between two places (a day's walk = POLITICS.dayWalkMin minutes; paths wind: × 1.3) */
export function walkDays(x: PCtx, a: Settlement, b: Settlement): number {
  return (distM(x.p, a.pos, b.pos) * 1.3) / (BASE_WALK * POLITICS.dayWalkMin);
}

/** the capital of a settlement's polity, if it is another standing town */
export function capitalOf(x: PCtx, st: Settlement): Settlement | undefined {
  const pl = x.ps.polity(st.polity);
  const cap = pl ? x.ps.settlement(pl.capital) : undefined;
  return cap && cap.id !== st.id && cap.fallen < 0 && !cap.band ? cap : undefined;
}

/** st's opinion of kin town o (one polity): 0.5 unless friction or raids soured it */
export function kinOpinion(x: PCtx, st: Settlement, o: Settlement): number {
  const h = histOf(x, st);
  let v = h.kin[String(o.id)] ?? 0.5;
  // a daughter's grievance colours what it thinks of its capital
  if (capitalOf(x, st)?.id === o.id) v -= h.grievance * 0.8;
  return Math.max(-1, Math.min(1, v));
}

function addG(h: HistState, why: string, v: number): void {
  h.grievance = r6(Math.max(0, Math.min(1, h.grievance + v)));
  if (v > 0) h.why[why] = r6((h.why[why] ?? 0) + v);
}

function leaderTrait(x: PCtx, st: Settlement, t: number, dflt = 0.4): number {
  const s = x.A.slotOf(st.leader);
  return s >= 0 ? x.A.traits[s * NT + t] : dflt;
}

/** the party that leads a settlement (its largest faction, '' when none has a real share) */
function leadingFaction(st: Settlement): string {
  let best = '', bs = 0.3;
  for (const f of st.factions ?? []) if (f.share > bs) { bs = f.share; best = f.kind; }
  return best;
}
const RIVAL: Record<string, string> = { hawks: 'doves', doves: 'hawks', devout: 'doubters', doubters: 'devout', elders: 'seekers', seekers: 'elders' };

// ───────────────────────────── daily ─────────────────────────────

/** once a day per planet (war.ts politicsDaily): era clocks and labels, grievances, secessions, kin raids, friction */
export function historyDaily(x: PCtx): void {
  const sts = x.ps.settlements;
  for (const st of sts) {
    if (st.fallen >= 0 || st.band) continue;
    const h = histOf(x, st);
    syncEra(x, st, h);
    const cap = capitalOf(x, st);
    if (!cap) { decayAll(h); continue; }
    grievanceDaily(x, st, cap, h);
  }
  for (const st of sts) {
    if (st.fallen >= 0 || st.band || !st.hist) continue;
    const cap = capitalOf(x, st);
    if (cap) secessionCheck(x, st, cap, st.hist);
  }
  for (const st of sts) if (st.fallen < 0 && !st.band) { friction(x, st); kinRaid(x, st); }
}

function decayAll(h: HistState): void {
  const f = 1 - POLITICS.decay;
  if (h.grievance > 0) h.grievance = r6(h.grievance * f);
  for (const k of Object.keys(h.why)) { const v = r6(h.why[k] * f); if (v < 1e-5) delete h.why[k]; else h.why[k] = v; }
  for (const k of Object.keys(h.kin)) h.kin[k] = r3(h.kin[k] + (0.5 - h.kin[k]) * 0.01);
}

function grievanceDaily(x: PCtx, d: Settlement, cap: Settlement, h: HistState): void {
  const G = POLITICS;
  decayAll(h);
  const P = Math.max(1, popOf(x, d)), Pc = Math.max(1, popOf(x, cap));
  // tribute: a tithe each season, carried to the capital (or taken by its men when no bearers can go)
  if (x.tick - h.paid >= G.tributeDays * x.day) {
    h.paid = x.tick;
    if (payTithe(x, d, cap, P)) addG(h, 'tribute', G.tribute);
  }
  // hard times: did the capital, with food to spare, relieve them?
  const hungerDeaths = d.stats.starved - (h.starved ?? d.stats.starved);
  h.starved = d.stats.starved;
  const lean = foodDays(x, d) < P * G.leanDays || hungerDeaths > 0;
  const spare = foodDays(x, cap) - Pc * G.spareDays >= P * 2;
  // (aid sent the day before the hard time was noticed counts for it: relieved = aid since a day before it began)
  if (lean) {
    if (h.famine < 0) { h.famine = x.tick; h.spare = false; h.judged = false; }
    if (spare) h.spare = true;
    // the capital's own choice: a generous leader sends food sooner
    if (spare && h.aid < h.famine - x.day && !h.judged) {
      const gen = Math.max(0.1, 0.5 + leaderTrait(x, cap, TRAIT.sociability) - 0.6 * leaderTrait(x, cap, TRAIT.aggression));
      if (hashFloat(cap.id, d.id, x.tick, worldSalt(x, 0xa1d)) < G.aidP * gen) sendAid(x, cap, d, 'famine');
    }
    if (!h.judged && x.tick - h.famine >= G.judgeDays * x.day) {
      h.judged = true;
      if (h.spare && h.aid < h.famine - x.day) {
        addG(h, 'famine', G.famine);
        tell(x.u, x.p, 'grievance.famine', vars(x, d, -1, { other: cap.name }), d, [settlementRef(x, d), settlementRef(x, cap)], 1);
      }
    }
  } else if (h.famine >= 0 && foodDays(x, d) >= P * G.leanDays * 1.5 && x.tick - h.famine >= G.judgeDays * x.day) h.famine = -1;
  // a daughter grown as large as its mother
  if (P >= Pc * 0.9) addG(h, 'outgrown', G.outgrown * Math.min(3, (P / Pc - 0.8) / 0.4));
  // the leaders: a feud between them, or a rival party leading the daughter (weighed once for each pair of leaders)
  const pair = `${d.leader}:${cap.leader}`;
  if (d.leader && cap.leader && pair !== h.feud) {
    h.feud = pair;
    const ours = leadingFaction(d), theirs = leadingFaction(cap);
    const rival = ours !== '' && RIVAL[ours] === theirs;
    const hot = Math.max(leaderTrait(x, d, TRAIT.aggression), leaderTrait(x, cap, TRAIT.aggression));
    if (rival || hashFloat(d.id, cap.id, x.tick, worldSalt(x, 0xfe0d)) < Math.max(0, hot - 0.45) * 1.6) {
      addG(h, 'feud', G.feud);
      tell(x.u, x.p, 'grievance.feud', vars(x, d, -1, { other: cap.name }), d, [settlementRef(x, d), settlementRef(x, cap)], 1);
    }
  }
  // distance: the farther the capital, the less it is their own
  const days = walkDays(x, d, cap);
  if (days > 1) addG(h, 'distance', G.distance * Math.min(2, days - 0.5));
  // a tongue drifting apart: a generation with little contact
  if (x.tick - h.genAt >= G.generationYears * x.year) {
    if (h.visits < G.rareVisits) {
      d.langSeed = driftLanguage(d.langSeed, d.id + Math.floor(x.tick / x.year)) >>> 0;
      d.language = d.langSeed;
      d.langLine = [...(d.langLine ?? []), d.langSeed].slice(-12);
      addG(h, 'tongue', G.drift);
      tell(x.u, x.p, 'grievance.tongue', vars(x, d, -1, { other: cap.name }), d, [settlementRef(x, d)], 1);
    }
    h.genAt = x.tick;
    h.visits = 0;
  }
  const ld = langDistance(d, cap);
  if (ld > 0.3) addG(h, 'tongue', G.tongue * Math.min(3, (ld - 0.18) / 0.18));
}

/** a daughter's tithe to its capital: a tenth of its food above two days a head, of its metal and finery */
function payTithe(x: PCtx, d: Settlement, cap: Settlement, P: number): boolean {
  const G = POLITICS;
  const goods: [number, number][] = [];
  const reserve = P * 2;
  const food = foodDays(x, d);
  const sp = x.info[d.species];
  if (food > reserve) {
    for (const it of sp.foods) {
      if (x.info[cap.species].edible[it] <= 0) continue;
      const q = Math.floor((d.store[it] ?? 0) * G.tributeShare * 100) / 100;
      if (q >= 1) goods.push([it, q]);
      if (goods.length >= 2) break;
    }
  }
  for (const it of [...(x.c.itemsByTag.get('metal') ?? []), ...(x.c.itemsByTag.get('luxury') ?? [])]) {
    const q = Math.floor((d.store[it] ?? 0) * G.tributeShare * 100) / 100;
    if (q >= 1 && goods.length < 4) goods.push([it, q]);
  }
  if (!goods.length) return false;
  for (const m of x.ps.missions) if (m.from === d.id && m.kind === 'tribute' && m.phase < 3) return true;
  const route = routeBetween(x, d, cap);
  const who = volunteers(x, d, 2, false);
  if ((route.land || (route.sea && bestBoat(x, d) >= 0)) && who.length && newMission(x, 'tribute', d, cap, who, goods)) return true;
  // no bearers or no way: the capital's men come and take it
  for (const [it, q] of goods) { const got = storeTake(d, it, q); storeAdd(x, cap, it, got); }
  return true;
}

/**
 * Food sent from `from` to a kin town in hard times: a gift mission of up to three days a head of the receiver, from what
 * the sender has beyond four days a head of its own (a direct hand-over when no bearers can go). True if anything left.
 */
export function sendAid(x: PCtx, from: Settlement, to: Settlement, why: string): boolean {
  if (from.fallen >= 0 || to.fallen >= 0 || from.id === to.id) return false;
  for (const m of x.ps.missions) if (m.from === from.id && m.to === to.id && m.kind === 'gift' && m.phase < 3) return false;
  const P = Math.max(1, popOf(x, to)), Pf = Math.max(1, popOf(x, from));
  const spare = foodDays(x, from) - Pf * POLITICS.spareDays;
  if (spare <= 1) return false;
  const want = Math.min(spare * 0.6, P * 3);
  const goods: [number, number][] = [];
  let days = 0;
  for (const it of x.info[from.species].foods) {
    if (days >= want) break;
    const ed = x.info[to.species].edible[it];
    const per = x.info[from.species].edible[it];
    if (ed <= 0 || per <= 0 || (from.store[it] ?? 0) < 1) continue;
    const q = Math.min(from.store[it] * 0.5, (want - days) / per);
    if (q < 0.5) continue;
    goods.push([it, Math.round(q * 100) / 100]);
    days += q * per;
  }
  if (!goods.length) return false;
  const h = histOf(x, to);
  h.aid = x.tick;
  const route = routeBetween(x, from, to);
  const who = volunteers(x, from, Math.min(4, Math.max(1, Math.ceil(days / 20))), false);
  const m = (route.land || (route.sea && bestBoat(x, from) >= 0)) && who.length ? newMission(x, 'gift', from, to, who, goods) : null;
  if (!m) for (const [it, q] of goods) { const got = storeTake(from, it, q); storeAdd(x, to, it, got); }
  if (!m && capitalOf(x, to)?.id === from.id) relieve(h);
  tell(x.u, x.p, 'gift.kin', vars(x, from, -1, { other: to.name, item: x.c.items.list[goods[0][0]].name.toLowerCase() }), from, [settlementRef(x, from), settlementRef(x, to)], 1);
  x.u.emit({ t: 'aid', planet: x.p.id, pos: [to.pos[0], to.pos[1], to.pos[2]], a: Math.round(days * 10) / 10, ref: settlementRef(x, to), data: { from: from.id, to: to.id, why } });
  return true;
}

function relieve(h: HistState): void {
  h.grievance = r6(Math.max(0, h.grievance - POLITICS.aid));
}

/** a mission between two towns ended at its target (missions.ts): kin visits, aid and tribute weigh on a grievance */
export function missionArrived(x: PCtx, m: Mission, from: Settlement, to: Settlement): void {
  if (from.polity !== to.polity) return;
  for (const [a, b] of [[from, to], [to, from]] as const) {
    if (capitalOf(x, a)?.id !== b.id) continue;
    const h = histOf(x, a);
    h.visits++;
    if (m.kind === 'gift' && a === to) { relieve(h); continue; }
    // (tribute carried is a visit — the tongue stays shared — but no kindness)
    if (m.kind === 'tribute') continue;
    h.grievance = r6(Math.max(0, h.grievance - POLITICS.visit));
  }
}

// ───────────────────────────── secession ─────────────────────────────

function secessionCheck(x: PCtx, d: Settlement, cap: Settlement, h: HistState): void {
  const G = POLITICS;
  if (h.grievance <= G.threshold) return;
  const strength = Math.max(0.5, Math.min(1, 0.5 + factionShare(d, 'hawks') + 0.5 * factionShare(d, 'seekers') + (h.grievance - G.threshold)));
  const p = G.maxP * Math.min(1, (h.grievance - G.threshold) / 0.15 + 0.2) * strength;
  if (hashFloat(d.id, x.tick, worldSalt(x, 0x5ece)) >= p) return;
  const pl = x.ps.polity(d.polity);
  if (!pl) return;
  const top = Object.entries(h.why).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? 'distance';
  // a parting in anger (a revolt, and war: war.ts) when the grievance is of neglect or blood, or runs very high with a war
  // party to carry it; otherwise a peaceful one
  const bitter = top === 'raids' || top === 'famine' || (h.grievance > G.revolt && (factionShare(d, 'hawks') > 0.25 || leaderTrait(x, d, TRAIT.aggression) > 0.6));
  const from = pl.id;
  secede(x, d, pl, bitter ? 'revolt' : '');
  tell(x.u, x.p, `secession.${top}`, vars(x, d, -1, { other: cap.name, polity: polityName(x, polityOf(x, d)) }), d, [settlementRef(x, d), settlementRef(x, cap)], 2);
  x.u.emit({ t: 'secession', planet: x.p.id, pos: [d.pos[0], d.pos[1], d.pos[2]], ref: settlementRef(x, d), data: { settlement: d.id, from, capital: cap.id, cause: top, grievance: h.grievance, revolt: bitter } });
  // a free town holds no grievance against its old capital: it is a quarrel between peoples now (war.ts relations)
  const r = relationOf(x, from, d.polity);
  if (r) {
    const k = r.a === d.polity ? 0 : 1;
    r.grievance[k] = Math.min(3, r.grievance[k] + h.grievance * 0.5);
    // kin who part in peace (not over a feud) seal it: the roads stay open between them (a pact, war.ts treaties)
    if (!bitter && top !== 'feud' && !r.treaties.includes('trade-pact')) {
      r.treaties.push('trade-pact');
      tell(x.u, x.p, 'treaty.parting', vars(x, d, -1, { other: cap.name }), d, [settlementRef(x, d), settlementRef(x, cap)], 1);
      x.u.emit({ t: 'treaty', planet: x.p.id, pos: [d.pos[0], d.pos[1], d.pos[2]], ref: settlementRef(x, d), data: { a: r.a, b: r.b, kind: 'parting' } });
    }
  }
  h.grievance = 0;
  h.why = {};
  h.famine = -1;
}

// ───────────────────────────── friction and kin raids ─────────────────────────────

/** kin towns whose land touches: fields and hunting grounds in each other's way sour them a little each day */
function friction(x: PCtx, st: Settlement): void {
  const G = POLITICS;
  for (const id of st.contacts) {
    if (id <= st.id) continue;
    const o = x.ps.settlement(id);
    if (!o || o.fallen >= 0 || o.band || o.polity !== st.polity) continue;
    const d = distM(x.p, st.pos, o.pos);
    const touch = d < st.territory + o.territory + 60 || st.fields.some((c) => x.p.f.territory[c] === o.id) || o.fields.some((c) => x.p.f.territory[c] === st.id);
    if (!touch) continue;
    for (const [a, b] of [[st, o], [o, st]] as const) {
      const h = histOf(x, a);
      h.kin[String(b.id)] = r3(Math.max(-1, (h.kin[String(b.id)] ?? 0.5) - G.frictionOp));
      if (capitalOf(x, a)?.id === b.id) addG(h, 'friction', G.friction);
    }
  }
}

/** a town with less than a day of food raids a fat neighbour within a day's walk that it holds below 0.3 — kin too */
function kinRaid(x: PCtx, st: Settlement): void {
  const P = popOf(x, st);
  if (P < 8 || foodDays(x, st) >= P * 1) return;
  for (const m of x.ps.missions) if (m.from === st.id && m.phase < 3 && (m.kind === 'raid' || m.kind === 'war')) return;
  let target: Settlement | null = null, best = 5;
  for (const id of st.contacts) {
    const o = x.ps.settlement(id);
    if (!o || o.fallen >= 0 || o.band) continue;
    if (walkDays(x, st, o) > POLITICS.raidDays) continue;
    let op: number;
    if (o.polity === st.polity) op = kinOpinion(x, st, o);
    else {
      const r = relationOf(x, st.polity, o.polity);
      if (r && (r.truce > x.tick || r.treaties.includes('alliance'))) continue;
      op = r ? r.op[r.a === st.polity ? 0 : 1] : 0.2;
    }
    if (op >= 0.3) continue;
    const per = foodDays(x, o) / Math.max(1, popOf(x, o));
    if (per >= best) { best = per; target = o; }
  }
  if (!target) return;
  const bold = 0.3 + factionShare(st, 'hawks') + leaderTrait(x, st, TRAIT.aggression) * 0.6;
  if (hashFloat(st.id, x.tick, worldSalt(x, 0x4a1e)) > 0.35 * bold) return;
  const route = routeBetween(x, st, target);
  if (!route.land && !(route.sea && bestBoat(x, st) >= 0)) return;
  const who = volunteers(x, st, Math.min(6, Math.max(3, Math.floor(P / 8))), true);
  if (who.length < 3) return;
  newMission(x, 'raid', st, target, who);
}

/** a raid fought between two towns of one people (war.ts battle): the raided remember it, the raiders are shamed */
export function kinRaided(x: PCtx, from: Settlement, to: Settlement): void {
  const G = POLITICS;
  const hv = histOf(x, to), hr = histOf(x, from);
  hv.kin[String(from.id)] = r3(Math.max(-1, (hv.kin[String(from.id)] ?? 0.5) - 0.4));
  hr.kin[String(to.id)] = r3(Math.max(-1, (hr.kin[String(to.id)] ?? 0.5) - 0.2));
  if (capitalOf(x, to)) addG(hv, 'raids', G.kinRaid);
  if (capitalOf(x, from)) addG(hr, 'raids', G.raider);
}

// ───────────────────────────── views ─────────────────────────────

/** for the inspector and the `polities` query: a settlement's grievance and its parts */
export function grievanceView(x: PCtx, st: Settlement): { grievance: number; capital: number; why: Record<string, number> } | null {
  const cap = capitalOf(x, st);
  if (!cap || !st.hist) return cap ? { grievance: 0, capital: cap.id, why: {} } : null;
  return { grievance: st.hist.grievance, capital: cap.id, why: { ...st.hist.why } };
}

