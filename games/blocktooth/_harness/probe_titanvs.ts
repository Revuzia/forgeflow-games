// BLOCKTOOTH — B-TITAN probe: titans in a multi-titan (VS) world (lane B-TITAN, online VS).
//
//   node _harness/probe_titanvs.ts            # exit 0 = every check passed
//
// Unit level on purpose: each section builds a small VS world (createWorld mode 'vs'), puts titans where the case needs them,
// sets the phase by hand (w.vs.phase) and drives the ONE system under test (stepKit / stepTitan / stepRail / resolveTitanBodies /
// stepUltimate ...). Nothing here depends on another lane's phase machine, bot brain or tender code being finished. Expected
// damage numbers come from the PvP rule itself (vs_design §6.1 via src/vs/formula.ts pvpDamage) + the victim's armor, so the
// probe checks the KIT side: which hits land, how many, on whom, for which % — not B-VS's multipliers.
//
//   A  CARD RAIL         open / pick / ignore-on-open-tick / edge cleared / reroll / auto-pick / chest rare+ / overflow auto-file /
//                        per-seat isolation / determinism / the in-sim scorer == the harness bot's scorer over real drafts
//   B  growth            the VS XP curve, the draft cadence (22 over LV 1..35), re-levelling owes nothing, loseLevels, catch-up
//   C  body contact      push apart by height², STOMPED (6 %, cooldown 1.5 s), OPEN HOUSE = shove only, controls
//   D  kits vs a rival   MOLO bite / vacuum / dash, VOLT-KITE arc / wires / RECAST, HEARTHBACK stomp / vent / dash, BRIARWICK lash /
//                        pods / POP-UP PARK, UPROAR; OPEN HOUSE = shove only; behind / out of reach = no hit; hazards belong to
//                        the titan that laid them
//   E  solo guard        a solo titan never grows a VS-only kit key; rival helpers are inert; hazards carry no VS owner
//   F  smoke             a 4-seat VS world stepped through stepWorldN twice: identical hashes, rail traffic on every seat

import { createWorld, stepWorldN } from '../src/core/world.ts';
import { bindPlayer, setBindAsserts, unbindPlayer, withPlayer } from '../src/core/players.ts';
import { RANK_LEVELS, TITAN_RADIUS_PER_H, VS, titanHeightAt, xpToNext, xpToNextVs } from '../src/core/config.ts';
import type { PlayerSeat, TitanId, TitanInput, World } from '../src/core/types.ts';
import { stepKit } from '../src/titans/kits/index.ts';
import { gainGrowth, growToRank, loseLevels, paceMul, stepTitan } from '../src/titans/titansim.ts';
import { resolveTitanBodies } from '../src/titans/bodies.ts';
import { dashHitRivals, nearestRival, pvpLive, rivalSlots } from '../src/titans/rivals.ts';
import { stepRail, REROLL_MIN_LEFT_S } from '../src/upgrades/rail.ts';
import { autoPickCard, autoPickScore } from '../src/upgrades/autopick.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../src/upgrades/draft.ts';
import { applyUpgrade } from '../src/upgrades/engine.ts';
import { stat } from '../src/upgrades/stats.ts';
import { UPGRADES, UPGRADE_BY_ID } from '../src/data/upgrades.ts';
import { EVO_ROWS_OF_PART } from '../src/data/evolutions.ts';
import { resolveCircleVsCity } from '../src/city/citysim.ts';
import { stepTelegraphs } from '../src/combat/telegraphs.ts';
import { spawnHazard, stepHazards } from '../src/combat/hazards.ts';
import { rebuildEnemyGrid } from '../src/combat/spatial.ts';
import { stepUltimate, chargeUltimate } from '../src/meta/ultimate.ts';
import { pvpDamage } from '../src/vs/formula.ts';
import { VSX } from '../src/vs/tune.ts';
import { botScoreUpgrade } from './bot.ts';

let fails = 0, checks = 0;
function ok(cond: boolean, what: string, detail = ''): void {
  checks++;
  if (!cond) { fails++; console.log(`  FAIL  ${what}${detail ? ' — ' + detail : ''}`); }
}
function near(a: number, b: number, rel = 1e-6, abs = 1e-9): boolean { return Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b))); }
function section(s: string): void { console.log(`\n[${s}]`); }

setBindAsserts(true);

// ───────────────────────── helpers ─────────────────────────
const IDLE: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
function vsWorld(titans: TitanId[], seed = 1337, biome: 'grideast' | 'whitestacks' | 'lockwater' = 'grideast'): World {
  const players: PlayerSeat[] = titans.map((t) => ({ titan: t }));
  return createWorld({ mode: 'vs', players, biome, seed });
}
function phase(w: World, p: 'countdown' | 'open' | 'takeover' | 'final' | 'last' | 'over'): void { (w.vs as NonNullable<World['vs']>).phase = p; }

/** Size `slot` to `rank` (a settled body), full HP. */
function size(w: World, slot: number, rank: number): void {
  withPlayer(w, slot, () => growToRank(w, rank));
  const T = w.players[slot].titan;
  T.height = titanHeightAt(T.rank, T.level);
  T.radius = T.height * TITAN_RADIUS_PER_H;
  T.growT = 0;
  T.hp = T.maxHp;
}
function place(w: World, slot: number, x: number, z: number, heading = 0): void {
  const T = w.players[slot].titan;
  T.x = x; T.z = z; T.px = x; T.pz = z; T.heading = heading; T.pheading = heading;
}
/** a kit-level tick: advance the clock, step the listed seats' KITS (bound), then the world's telegraphs / hazards unbound */
function kitTick(w: World, slots: number[], inputs: (TitanInput | undefined)[] = []): void {
  w.events.length = 0;
  w.tick++; w.t += w.dt;
  rebuildEnemyGrid(w);
  for (const s of slots) {
    bindPlayer(w, s);
    const inp = inputs[s];
    if (inp) { w.players[s].input = inp; w.input = inp; }
    stepKit(w);
  }
  unbindPlayer(w);
  stepTelegraphs(w);
  stepHazards(w);
  bindPlayer(w, w.view);
}
function statOf(w: World, slot: number, k: Parameters<typeof stat>[1]): number { return withPlayer(w, slot, () => stat(w, k)); }
/** HP the victim should lose from a hit of `pct` (vs_design §6.1 + the victim's armor), phase takeover. `kind`: a kit hit goes
 *  through B-VS's TTK knob (VSX.pvpMul); an UPROAR hit skips both the knob and power(); a body STOMP skips the knob (src/vs/pvp.ts). */
function expectLoss(w: World, from: number, to: number, pct: number, kind: 'kit' | 'uproar' | 'stomp' = 'kit'): number {
  const A = w.players[from].titan, V = w.players[to].titan;
  const dmg = pvpDamage({ victimMaxHp: V.maxHp, kitPct: pct * (kind === 'kit' ? VSX.pvpMul : 1), attackerDamageStat: statOf(w, from, 'damage'), attackerRank: A.rank, victimRank: V.rank, phase: 'takeover', noPower: kind === 'uproar' });
  const armor = Math.max(-50, statOf(w, to, 'armor'));
  return dmg * (100 / (100 + armor));
}
function hp(w: World, s: number): number { return w.players[s].titan.hp; }
function rivalHits(w: World, from: number, to: number): number { return w.events.filter((e) => e.type === 'rivalHit' && e.from === from && e.to === to).length; }
function noContestHits(w: World, from: number, to: number): number { return w.events.filter((e) => e.type === 'rivalHit' && e.from === from && e.to === to && e.noContest).length; }

const X0 = 0, Z0 = 0;
/** an open spot of the city (a crosswalk where a radius-`r` circle meets no building): the body tests need ground to push on */
function openSpot(w: World, r: number): { x: number; z: number } {
  const out = { x: 0, z: 0, bumpTier: -1 };
  for (const c of [w.city.spawn, ...w.city.crosswalks]) {
    out.x = c.x; out.z = c.z; out.bumpTier = -1;
    if (!resolveCircleVsCity(w.city, c.x, c.z, r, 0, out)) return { x: c.x, z: c.z };
  }
  return { x: w.city.spawn.x, z: w.city.spawn.z };
}
/** two big titans facing each other: slot 0 at the origin looking +z, slot 1 `d` metres ahead */
function duel(a: TitanId, b: TitanId, rankA: number, rankB: number, d: number, ph: 'open' | 'takeover' = 'takeover'): World {
  const w = vsWorld([a, b, 'molo']);
  size(w, 0, rankA); size(w, 1, rankB); size(w, 2, 0);
  place(w, 0, X0, Z0, 0); place(w, 1, X0, Z0 + d, Math.PI); place(w, 2, X0 + 900, Z0 + 900, 0);
  phase(w, ph);
  return w;
}

// ═══════════════════════════ A. CARD RAIL ═══════════════════════════
section('A. CARD RAIL');
function railTick(w: World, slot: number, input?: TitanInput | null): void {
  w.events.length = 0;
  w.tick++; w.t += w.dt;
  bindPlayer(w, slot);
  if (input) { w.players[slot].input = input; w.input = input; }
  stepRail(w);
  bindPlayer(w, w.view);
}
{
  const w = vsWorld(['molo', 'voltkite']);
  phase(w, 'open');
  const P = w.players[0], U = P.upgrades, R = P.rail;
  ok(!R.open && U.offer === null && !R.openingDone, 'rail starts closed, opening card not yet taken');

  // tick 1: the opening card owes one draft, and offers it. A pick sent on the opening tick is ignored (never seen).
  const early: TitanInput = { ...IDLE, railPick: 1 };
  railTick(w, 0, early);
  ok(R.openingDone && R.open && U.offer !== null && U.offer.length === 3, 'opening card: an offer of 3 is open after tick 1', JSON.stringify(U.offer));
  ok(U.pendingDrafts === 1, 'opening card: exactly one draft owed (not consumed by the early pick)', String(U.pendingDrafts));
  const ev1 = w.events.filter((e) => e.type === 'railOffer');
  ok(ev1.length === 1 && ev1[0].type === 'railOffer' && ev1[0].cards.join() === (U.offer as string[]).join() && ev1[0].chest === false && ev1[0].p === 0,
    'railOffer event: the 3 cards, chest false, p = seat 0');
  ok(near(R.expireT, w.t + VS.rail.autoPickS, 1e-9) && R.openedT === w.t && R.seq === 1, 'auto-pick clock = open time + 12 s; seq 1');
  ok(w.players[1].rail.open === false && w.players[1].upgrades.offer === null, 'seat 1 untouched by seat 0 (its own rail ticks separately)');

  // tick 2: pick card 2
  const offer = (U.offer as string[]).slice();
  const pick2: TitanInput = { ...IDLE, railPick: 2 };
  railTick(w, 0, pick2);
  ok((U.owned[offer[1]] ?? 0) === 1, 'pick 2 applies the 2nd card', `${offer[1]}: ${U.owned[offer[1]]}`);
  ok(U.pendingDrafts === 0 && U.offer === null && !R.open && R.expireT === Infinity, 'after the pick: no draft owed, rail closed');
  const pk = w.events.filter((e) => e.type === 'railPick');
  ok(pk.length === 1 && pk[0].type === 'railPick' && pk[0].id === offer[1] && pk[0].auto === false && pk[0].p === 0, 'railPick event {id, auto:false}, p = 0');
  ok(pick2.railPick === 2 && P.input.railPick === 0 && P.input !== pick2, 'the edge is consumed on a COPY: caller input untouched, latched input cleared');

  // a repeated "keep previous input" frame can never pick again
  U.pendingDrafts = 2;
  railTick(w, 0, null);                                   // opens the next offer
  ok(R.open && U.offer !== null, 'owed draft opens the next offer');
  railTick(w, 0, null);                                   // previous input repeated (railPick already cleared)
  ok(R.open && U.pendingDrafts === 2, 'a repeated frame does not pick');

  // reroll (needs a charge)
  U.rerolls = 2;
  const before = (U.offer as string[]).slice();
  railTick(w, 0, { ...IDLE, railReroll: true });
  const after = (U.offer as string[]).slice();
  ok(after.length === 3 && after.join() !== before.join(), 'reroll: a new offer', `${before} -> ${after}`);
  ok(U.rerolls === 1, 'reroll spends one charge', String(U.rerolls));
  ok(w.events.some((e) => e.type === 'railOffer' && e.cards.join() === after.join()), 'reroll re-sends railOffer with the new cards');
  ok(R.expireT >= w.t + REROLL_MIN_LEFT_S - 1e-9, 'reroll leaves at least REROLL_MIN_LEFT_S on the clock');
  U.rerolls = 0;
  railTick(w, 0, { ...IDLE, railReroll: true });
  ok((U.offer as string[]).join() === after.join(), 'reroll with no charge: nothing happens');

  // an out-of-range pick is ignored
  railTick(w, 0, { ...IDLE, railPick: 7 });
  ok(R.open && U.pendingDrafts === 2, 'pick 7 on a 3-card offer is ignored');

  // auto-pick at expiry = the scorer's card
  const guess = autoPickCard(w, U.offer as string[]);
  R.expireT = w.t + 5 * w.dt;
  let got: string | null = null, auto = false;
  for (let i = 0; i < 8 && got === null; i++) {
    const g = autoPickCard(w, U.offer as string[]);
    railTick(w, 0, null);
    const e = w.events.find((x) => x.type === 'railPick');
    if (e && e.type === 'railPick') { got = e.id; auto = e.auto; ok(g === got, 'auto-pick takes autoPickCard of the open offer', `${g} vs ${got}`); }
  }
  ok(got !== null && auto === true, 'auto-pick fires when w.t reaches expireT, flagged auto');
  void guess;
  ok(U.pendingDrafts === 1, 'auto-pick spent one draft', String(U.pendingDrafts));
  // the other owed draft opens on the next tick
  railTick(w, 0, null);
  ok(R.open, 'the next owed draft opens right after');

  // a chest (tender top bidder) opens as a rare+ offer
  const w2 = vsWorld(['hearthback']);
  phase(w2, 'open');
  railTick(w2, 0, null);                                   // the opening card
  railTick(w2, 0, { ...IDLE, railPick: 1 });
  w2.players[0].upgrades.chestDrafts = 1;
  railTick(w2, 0, null);
  const c = w2.players[0];
  ok(c.rail.open && c.rail.chest === true, 'chest draft opens a chest rail');
  ok((c.upgrades.offer as string[]).every((id) => UPGRADE_BY_ID[id]?.rarity !== 'common'), 'chest offer is rare+', String(c.upgrades.offer));
  railTick(w2, 0, { ...IDLE, railPick: 3 });
  ok(c.upgrades.chestDrafts === 0 && !c.rail.open, 'picking from a chest offer spends the chest draft');

  // overflow auto-file: slots full of maxed non-recipe cards -> an offer of only OVERFLOW rewards is filed at once
  const w3 = vsWorld(['molo']);
  phase(w3, 'open');
  const p3 = w3.players[0];
  p3.rail.openingDone = true;                              // skip the opening card for this case
  let filled = 0;
  withPlayer(w3, 0, () => {
    for (const u of UPGRADES) {
      if (filled >= 8) break;
      if (u.titan || u.evo || u.perk || u.locked || (u.minRank ?? 0) > 0 || u.maxStacks < 2 || EVO_ROWS_OF_PART[u.id]) continue;
      p3.upgrades.owned[u.id] = u.maxStacks; p3.upgrades.order.push(u.id); filled++;
    }
  });
  ok(filled === 8, 'built 8 maxed non-recipe cards', String(filled));
  p3.upgrades.pendingDrafts = 1;
  railTick(w3, 0, null);
  const pkOv = w3.events.find((e) => e.type === 'railPick');
  ok(pkOv !== undefined && pkOv.type === 'railPick' && pkOv.id.startsWith('ovf_') && pkOv.auto === true, 'overflow-only offer is auto-filed (no rail)', JSON.stringify(pkOv));
  ok(!p3.rail.open && p3.upgrades.pendingDrafts === 0, 'overflow auto-file leaves the rail closed and the draft spent');
}

// determinism of the rail: two identical worlds, same scripted inputs
{
  const mk = (): World => { const w = vsWorld(['molo', 'voltkite', 'hearthback', 'briarwick'], 99); phase(w, 'open'); return w; };
  const a = mk(), b = mk();
  const sig = (w: World): string => w.players.map((p) => `${p.rail.open ? 1 : 0}|${p.rail.seq}|${p.rail.expireT}|${(p.upgrades.offer ?? []).join(',')}|${Object.keys(p.upgrades.owned).sort().map((k) => k + p.upgrades.owned[k]).join(',')}|${p.upgrades.pendingDrafts}|${p.upgrades.rerolls}`).join(' / ');
  let same = true, offers = 0, picks = 0;
  for (let t = 0; t < 1500; t++) {
    for (const w of [a, b]) {
      for (let s = 0; s < 4; s++) {
        if (t % 40 === 3 + s) w.players[s].upgrades.pendingDrafts++;
        const inp: TitanInput = { ...IDLE, railPick: t % 70 === 10 + s ? 1 + ((t >> 3) % 3) : 0, railReroll: t % 130 === 50 + s };
        railTick(w, s, inp);
        for (const e of w.events) { if (w === a && e.type === 'railOffer') offers++; if (w === a && e.type === 'railPick') picks++; }
      }
    }
    if (sig(a) !== sig(b)) { same = false; ok(false, 'rail determinism', `diverged at tick ${t}`); break; }
  }
  ok(same, 'rail: two identical worlds stay identical over 1500 ticks x 4 seats');
  ok(offers > 40 && picks > 30, 'rail traffic happened (offers / picks)', `${offers} offers ${picks} picks`);
}

// the in-sim scorer must equal the harness bot's scorer on real drafts (a drift in either side is caught here)
{
  let compared = 0, mism = 0;
  for (const titan of ['molo', 'voltkite', 'hearthback', 'briarwick'] as TitanId[]) {
    const w = vsWorld([titan], 7);
    const p = w.players[0];
    p.rail.openingDone = true;
    bindPlayer(w, 0);
    for (let d = 0; d < 36; d++) {
      const r = Math.min(4, Math.floor(d / 8));
      if (p.titan.rank < r) growToRank(w, r);
      p.upgrades.pendingDrafts++;
      const offer = rollOffer(w);
      for (const id of offer) {
        compared++;
        const a = autoPickScore(w, id), b = botScoreUpgrade(w, id);
        if (a !== b) { mism++; if (mism < 5) console.log(`    mismatch ${titan} d${d} ${id}: autopick ${a} bot ${b}`); }
      }
      pickUpgrade(w, autoPickCard(w, offer));
    }
  }
  ok(compared > 300, 'scorer parity: compared many scores', String(compared));
  ok(mism === 0, 'scorer parity: autopick.ts == _harness/bot.ts botScoreUpgrade on every offered card', `${mism} of ${compared}`);
}

// ═══════════════════════════ B. growth in VS ═══════════════════════════
section('B. growth in VS');
{
  const w = vsWorld(['molo', 'voltkite']);
  const T0 = w.players[0].titan;
  ok(T0.xpToNext === xpToNextVs(1) && xpToNextVs(1) === xpToNext(1), 'LV 1 bar: VS == solo at level 1', `${T0.xpToNext}`);
  // cadence: gainGrowth = exactly one level per call
  bindPlayer(w, 0);
  const U = w.upgrades;
  let owed: number[] = [];
  for (let L = 2; L <= 35; L++) {
    const before = U.pendingDrafts;
    gainGrowth(w, 1);
    if (w.titan.level !== L) { ok(false, `gainGrowth reaches level ${L}`, `at ${w.titan.level}`); break; }
    if (U.pendingDrafts > before) owed.push(L);
  }
  const want: number[] = [];
  for (let L = 2; L <= 35; L++) if (L <= VS.rail.everyLevelTo || (L - VS.rail.everyLevelTo) % VS.rail.thenEvery === 0) want.push(L);
  ok(owed.join() === want.join(), 'draft cadence: every level to LV 12, then every 2nd', `${owed.join(',')}`);
  ok(owed.length === 22 && w.titan.rank === 4, '22 drafts across LV 2..35 and the body reached Size V', `${owed.length} rank ${w.titan.rank}`);
  ok(w.titan.xpToNext === Math.round((8 + 6 * Math.pow(w.titan.level, 1.35)) * VS.pacing.xpStretch), 'VS XP bar uses the VS curve (no p20 stretch)');
  ok(xpToNextVs(20) < xpToNext(20), 'VS curve is cheaper than the solo p20 curve at LV 20', `${xpToNextVs(20)} vs ${xpToNext(20)}`);
  // KO: lose 2 levels, floor at the Size's first level, regrow owes no draft
  bindPlayer(w, 1);
  const T1 = w.players[1].titan;
  const U1 = w.players[1].upgrades;
  for (let L = 2; L <= 20; L++) gainGrowth(w, 1);
  T1.xp = 3;
  const lvBefore = T1.level, owedBefore = U1.pendingDrafts;
  const lost = loseLevels(w, 1, 2);
  ok(T1.level === lvBefore - 2 && T1.rank === 2 && lost > 0, 'loseLevels(2): -2 levels, same Size, XP lost > 0', `${lvBefore}->${T1.level} lost ${lost}`);
  ok(T1.xpToNext === xpToNextVs(T1.level) && T1.xp <= T1.xpToNext, 'loseLevels re-sizes the bar on the VS curve');
  gainGrowth(w, 1); gainGrowth(w, 1);
  ok(T1.level === lvBefore && U1.pendingDrafts === owedBefore, 'regrowing to an already-reached level owes NO new draft', `${U1.pendingDrafts} vs ${owedBefore}`);
  gainGrowth(w, 1);
  ok(U1.pendingDrafts === owedBefore + ((T1.level <= 12 || (T1.level - 12) % 2 === 0) ? 1 : 0), 'a NEW level after the regrow pays by the cadence');
  const floorLv = RANK_LEVELS[T1.rank];
  T1.level = floorLv + 1; T1.xp = 0; T1.xpToNext = xpToNextVs(T1.level);
  loseLevels(w, 1, 2);
  ok(T1.level === floorLv, 'loseLevels floors at the first level of the CURRENT Size', `${T1.level} vs ${floorLv}`);
  ok(loseLevels(w, 1, 2) === 0 && T1.level === floorLv, 'at the floor: nothing to lose');
  // catch-up (B-VS vsCatchUpMul through paceMul)
  const wc = vsWorld(['molo', 'voltkite', 'hearthback']);
  withPlayer(wc, 0, () => { for (let i = 0; i < 19; i++) gainGrowth(wc, 1); });          // LV 20
  withPlayer(wc, 1, () => { for (let i = 0; i < 9; i++) gainGrowth(wc, 1); });           // LV 10
  ok(near(withPlayer(wc, 0, () => paceMul(wc)), Math.max(VS.catchUp.aheadMin, 1 - VS.catchUp.aheadPerLevel * 10)), 'catch-up: the leader gets the lead governor max(aheadMin, 1 - aheadPerLevel x lead)', String(withPlayer(wc, 0, () => paceMul(wc))));
  ok(near(withPlayer(wc, 1, () => paceMul(wc)), Math.min(VS.catchUp.max, 1 + VS.catchUp.perLevel * 10)), 'catch-up: 10 levels behind = min(VS.catchUp.max, 1 + perLevel x 10)', String(withPlayer(wc, 1, () => paceMul(wc))));
  ok(near(withPlayer(wc, 2, () => paceMul(wc)), VS.catchUp.max), 'catch-up: LV 1 vs a LV 20 leader -> cap');
  wc.players[0].vs.eliminated = true;
  ok(near(withPlayer(wc, 1, () => paceMul(wc)), Math.max(VS.catchUp.aheadMin, 1 - VS.catchUp.aheadPerLevel * 9)), 'catch-up: an eliminated leader no longer counts (seat 1 leads, 9 over 2nd place)');
}

// ═══════════════════════════ C. body contact ═══════════════════════════
section('C. body contact');
{
  // push apart, split by height²
  const w = vsWorld(['molo', 'voltkite', 'hearthback', 'briarwick']);
  size(w, 0, 3); size(w, 1, 1); size(w, 2, 0); size(w, 3, 0);
  place(w, 0, 100, 100, 0); place(w, 1, 100, 108, 0); place(w, 2, 800, 800); place(w, 3, 900, 900);
  phase(w, 'open');
  const a = w.players[0].titan, b = w.players[1].titan;
  const minD = a.radius + b.radius;
  const d0 = Math.hypot(b.x - a.x, b.z - a.z);
  ok(d0 < minD, 'setup: the two bodies overlap', `${d0} < ${minD}`);
  const ax = a.x, az = a.z, bx = b.x, bz = b.z;
  resolveTitanBodies(w);
  const d1 = Math.hypot(b.x - a.x, b.z - a.z);
  ok(d1 >= minD - 1e-3, 'push apart: no longer overlapping', `${d1} >= ${minD}`);
  const moveA = Math.hypot(a.x - ax, a.z - az), moveB = Math.hypot(b.x - bx, b.z - bz);
  const ha = a.height * a.height, hb = b.height * b.height;
  ok(moveA < moveB && near(moveA / (moveA + moveB), hb / (ha + hb), 1e-3, 1e-3), 'the push splits by height²: the bigger body moves less', `A ${moveA.toFixed(3)} B ${moveB.toFixed(3)} (want share ${(hb / (ha + hb)).toFixed(3)})`);
  ok(hp(w, 0) === w.players[0].titan.maxHp && hp(w, 1) === b.maxHp, 'OPEN HOUSE contact deals no HP');

  // exactly stacked: deterministic separation, no NaN
  const w2 = vsWorld(['molo', 'molo']);
  size(w2, 0, 1); size(w2, 1, 1);
  const sp2 = openSpot(w2, 12);
  place(w2, 0, sp2.x, sp2.z); place(w2, 1, sp2.x, sp2.z);
  resolveTitanBodies(w2);
  const t0 = w2.players[0].titan, t1 = w2.players[1].titan;
  ok(Number.isFinite(t0.x + t0.z + t1.x + t1.z) && Math.hypot(t1.x - t0.x, t1.z - t0.z) >= t0.radius + t1.radius - 1e-3, 'exactly stacked titans separate without NaN');
  // eliminated / dead seats are ignored
  const w3 = vsWorld(['molo', 'molo']);
  size(w3, 0, 1); size(w3, 1, 1);
  const sp3 = openSpot(w3, 12);
  place(w3, 0, sp3.x, sp3.z); place(w3, 1, sp3.x + 0.5, sp3.z);
  w3.players[1].titan.alive = false;
  resolveTitanBodies(w3);
  ok(w3.players[0].titan.x === sp3.x && w3.players[1].titan.x === sp3.x + 0.5, 'a KO\'d titan does not collide');
  w3.players[1].titan.alive = true; w3.players[1].vs.eliminated = true;
  resolveTitanBodies(w3);
  ok(w3.players[0].titan.x === sp3.x && w3.players[1].titan.x === sp3.x + 0.5, 'an eliminated titan does not collide');

  // STOMPED
  const mk = (rankBig: number, rankSmall: number, ph: 'open' | 'takeover'): World => {
    const x = vsWorld(['molo', 'voltkite']);
    size(x, 0, rankBig); size(x, 1, rankSmall);
    place(x, 0, 200, 200); place(x, 1, 200, 200 + (x.players[0].titan.radius + x.players[1].titan.radius) * 0.8);
    x.players[0].titan.speed = 20;                           // walking through it
    phase(x, ph);
    return x;
  };
  const s1 = mk(3, 1, 'takeover');                           // 14 m vs 5 m: 5 < 0.45 x 14 = 6.3 -> stompable
  const smallHp = s1.players[1].titan.maxHp;
  s1.events.length = 0;
  resolveTitanBodies(s1);
  const loss1 = smallHp - hp(s1, 1);
  const want1 = expectLoss(s1, 0, 1, VS.contact.stompMaxHpFrac, 'stomp');
  ok(near(loss1, want1, 1e-6), 'STOMPED: 6 % of max HP through the PvP rule', `${loss1} vs ${want1}`);
  ok(rivalHits(s1, 0, 1) === 1 && s1.events.some((e) => e.type === 'rivalHit' && e.p === 0), 'STOMPED reports one rivalHit, p = the big titan');
  // the shove must have been applied by pvpHit (kit.sim_kb*)
  const kb = Math.hypot(s1.players[1].titan.kit.sim_kbx ?? 0, s1.players[1].titan.kit.sim_kbz ?? 0);
  ok(kb > 0, 'STOMPED shoves the small titan (knockback velocity set)', String(kb));
  // pair cooldown
  const hp1 = hp(s1, 1);
  s1.players[1].titan.iframeT = 0;
  s1.tick++; s1.t += s1.dt;
  place(s1, 1, 200, 200 + (s1.players[0].titan.radius + s1.players[1].titan.radius) * 0.8);
  resolveTitanBodies(s1);
  ok(hp(s1, 1) === hp1, 'STOMPED: the same pair cannot stomp again inside 1.5 s');
  // keep them in contact 1.6 s more: exactly one more stomp, and not before the 1.5 s pair cooldown ran out
  const stompAt: number[] = [];
  const tStart = s1.t;
  for (let i = 0; i < 48; i++) {
    s1.tick++; s1.t += s1.dt; s1.events.length = 0;
    s1.players[1].titan.iframeT = 0;
    place(s1, 1, 200, 200 + (s1.players[0].titan.radius + s1.players[1].titan.radius) * 0.8);
    resolveTitanBodies(s1);
    if (rivalHits(s1, 0, 1) > 0) stompAt.push(s1.t - tStart);
  }
  ok(stompAt.length === 1 && stompAt[0] >= VS.contact.stompPairCdS - 3 * s1.dt, 'STOMPED: after the 1.5 s pair cooldown the pair can stomp again, once', JSON.stringify(stompAt));
  // OPEN HOUSE: shove only (NO CONTEST)
  const s2 = mk(3, 1, 'open');
  resolveTitanBodies(s2);
  ok(hp(s2, 1) === s2.players[1].titan.maxHp && noContestHits(s2, 0, 1) === 1, 'OPEN HOUSE stomp: no HP, one NO CONTEST hit');
  ok(Math.hypot(s2.players[1].titan.kit.sim_kbx ?? 0, s2.players[1].titan.kit.sim_kbz ?? 0) > 0, 'OPEN HOUSE stomp still shoves');
  // controls: a similar size titan, and a big one standing still, do not stomp
  const s3 = mk(3, 3, 'takeover');
  resolveTitanBodies(s3);
  ok(hp(s3, 1) === s3.players[1].titan.maxHp && rivalHits(s3, 0, 1) === 0, 'control: similar sizes never stomp');
  const s4 = mk(3, 1, 'takeover');
  s4.players[0].titan.speed = 0;
  resolveTitanBodies(s4);
  ok(hp(s4, 1) === s4.players[1].titan.maxHp, 'control: a big titan standing still does not stomp');
  // the small one cannot stomp the big one
  const s5 = mk(1, 3, 'takeover');
  s5.players[0].titan.speed = 20;
  resolveTitanBodies(s5);
  ok(hp(s5, 0) === s5.players[0].titan.maxHp, 'control: a small titan never stomps a bigger one');
}

// ═══════════════════════════ D. kits vs a rival ═══════════════════════════
section('D. kits vs a rival');
{
  // helper aliases
  const VSK = VS.kitPct;

  // ---- MOLO CURB BITE ----
  {
    const w = duel('molo', 'voltkite', 2, 2, 8);
    w.players[1].titan.iframeT = 0;
    ok(pvpLive(w) && nearestRival(w, 100) === 1, 'takeover: nearestRival sees the rival in reach', String(nearestRival(w, 100)));
    ok(rivalSlots(withPlayerSlot(w, 0)).join() === '1,2', 'rivalSlots lists every other live seat, slot order');
    kitTick(w, [0]);
    ok(near(w.players[1].titan.maxHp - hp(w, 1), expectLoss(w, 0, 1, VSK.molo.auto), 1e-6), 'MOLO bite: 4 % of the rival\'s max HP', `${w.players[1].titan.maxHp - hp(w, 1)} vs ${expectLoss(w, 0, 1, VSK.molo.auto)}`);
    ok(rivalHits(w, 0, 1) === 1 && hp(w, 2) === w.players[2].titan.maxHp, 'MOLO bite: one rivalHit on the rival in the cone, none on the far seat');
  }
  {   // behind / out of reach: no hit
    const w = duel('molo', 'voltkite', 2, 2, 8);
    place(w, 1, X0, Z0 - 8, 0);                                // behind (cone is 50° each side)
    kitTick(w, [0]);
    ok(hp(w, 1) === w.players[1].titan.maxHp && rivalHits(w, 0, 1) === 0, 'MOLO bite: a rival behind is not hit');
    const far = duel('molo', 'voltkite', 2, 2, 400);
    kitTick(far, [0]);
    ok(hp(far, 1) === far.players[1].titan.maxHp && nearestRival(withPlayerSlot(far, 0), 20) === -1, 'MOLO bite: a rival out of reach is not hit / targeted');
  }
  {   // OPEN HOUSE: shove only
    const w = duel('molo', 'voltkite', 2, 2, 8, 'open');
    ok(nearestRival(withPlayerSlot(w, 0), 100) === -1, 'OPEN HOUSE: autos never aim at a rival (nearestRival -1)');
    // the bite still has a target? put the rival IN the cone anyway: the cone shape shoves
    w.players[0].titan.autoCd = 0;
    // an enemy-free city: MOLO bites only when plowing; force a swing with a building target not needed: call the kit via isPlowing
    w.players[0].titan.kit.sim_plowT = 1;
    kitTick(w, [0]);
    ok(hp(w, 1) === w.players[1].titan.maxHp, 'OPEN HOUSE: the bite deals no HP');
    ok(noContestHits(w, 0, 1) === 1, 'OPEN HOUSE: the bite cone over a rival reports one NO CONTEST hit');
    const kb = Math.hypot(w.players[1].titan.kit.sim_kbx ?? 0, w.players[1].titan.kit.sim_kbz ?? 0);
    ok(kb > 0 && (w.players[1].titan.kit.sim_kbz ?? 0) > 0, 'OPEN HOUSE: the rival is shoved AWAY from MOLO (+z)', String(kb));
  }
  // ---- MOLO GULLET VACUUM ----
  {
    const w = duel('molo', 'voltkite', 3, 1, 40);              // 14 m vs 5 m (< 0.7 x 14 = 9.8): dragged
    place(w, 1, X0, Z0 + 40, Math.PI);
    const R0 = Math.hypot(w.players[1].titan.x - w.players[0].titan.x, w.players[1].titan.z - w.players[0].titan.z);
    const hold: TitanInput = { ...IDLE, ability: true, abilityHeld: true };
    kitTick(w, [0], [hold]);
    let hist: number[] = [];
    let hpDuring = w.players[1].titan.maxHp;
    for (let i = 0; i < 40; i++) {
      const T1 = w.players[1].titan;
      hist.push(Math.hypot(T1.x - w.players[0].titan.x, T1.z - w.players[0].titan.z));
      if (i === 30) hpDuring = T1.hp;                           // still inside the 1.2 s inhale: the bite has not resumed yet
      kitTick(w, [0], [{ ...IDLE, abilityHeld: true }]);
    }
    const moved = R0 - hist[hist.length - 1];
    const dragPerTick = VS ? 1.5 * w.players[0].titan.height * w.dt : 0;       // MOLO.vacDragHPerS = 1.5
    ok(moved > 8, 'GULLET VACUUM drags a much smaller rival toward the jaws', `${moved.toFixed(1)} m`);
    ok(moved <= (VS.ko.ccMaxS / w.dt + 2) * dragPerTick + 1e-6, 'the drag is CC-capped at ~1.0 s of pull (then CLEARED)', `${moved.toFixed(1)} m vs cap ${((VS.ko.ccMaxS / w.dt + 2) * dragPerTick).toFixed(1)}`);
    ok(w.players[1].vs.clearedT > 0, 'after the capped pull the rival is CLEARED');
    ok(hpDuring === w.players[1].titan.maxHp, 'the vacuum itself deals no damage while it inhales (hookDrag 0)');
  }
  {
    const w = duel('molo', 'voltkite', 3, 3, 40);              // similar size: only slowed 30 %
    kitTick(w, [0], [{ ...IDLE, ability: true, abilityHeld: true }]);
    const T1 = w.players[1].titan;
    const z0 = T1.z;
    for (let i = 0; i < 12; i++) kitTick(w, [0], [{ ...IDLE, abilityHeld: true }]);
    ok(Math.abs(T1.z - z0) < 1e-9, 'similar-size rival is NOT dragged');
    ok(T1.slowT > 0 && near(T1.slowMul, 0.7, 1e-9), 'similar-size rival is slowed 30 %', `${T1.slowT} x${T1.slowMul}`);
  }
  // ---- MOLO / HEARTHBACK dash ----
  for (const [id, pct] of [['molo', VSK.molo.dash], ['hearthback', VSK.hearthback.dash]] as [TitanId, number][]) {
    const w = vsWorld([id, 'voltkite']);
    size(w, 0, 2); size(w, 1, 2);
    place(w, 0, 300, 300, 0); place(w, 1, 300, 300 + w.players[0].titan.radius + w.players[1].titan.radius - 0.5, Math.PI);
    phase(w, 'takeover');
    bindPlayer(w, 0);
    w.players[0].titan.dashT = 0.2;
    dashHitRivals(w);
    ok(near(w.players[1].titan.maxHp - hp(w, 1), expectLoss(w, 0, 1, pct), 1e-6), `${id} dash body-check: ${(pct * 100).toFixed(0)} % of the rival`, `${w.players[1].titan.maxHp - hp(w, 1)}`);
    const h1 = hp(w, 1);
    w.players[1].titan.iframeT = 0;
    dashHitRivals(w);
    ok(hp(w, 1) === h1, `${id} dash: one hit per rival per dash`);
  }
  for (const id of ['voltkite', 'briarwick'] as TitanId[]) {
    const w = vsWorld([id, 'molo']);
    size(w, 0, 2); size(w, 1, 2);
    place(w, 0, 300, 300, 0); place(w, 1, 300, 300 + w.players[0].titan.radius, Math.PI);
    phase(w, 'takeover');
    bindPlayer(w, 0);
    w.players[0].titan.dashT = 0.2;
    dashHitRivals(w);
    ok(hp(w, 1) === w.players[1].titan.maxHp, `${id}: the dash does no damage (zone control, not a tackle)`);
  }
  {   // the real stepTitan dash: MOLO at Size I runs into an adjacent rival
    const w = vsWorld(['molo', 'voltkite']);
    place(w, 0, 400, 400, 0); place(w, 1, 400, 402.4, Math.PI);
    phase(w, 'takeover');
    bindPlayer(w, 0);
    w.input = { ...IDLE, mz: 1, dash: true };
    w.players[0].input = w.input;
    w.events.length = 0;
    for (let i = 0; i < 12; i++) { w.tick++; w.t += w.dt; stepTitan(w); w.input = { ...IDLE, mz: 1 }; w.players[0].input = w.input; }
    ok(w.players[1].titan.hp < w.players[1].titan.maxHp, 'stepTitan dash: MOLO ran into the rival and the tackle landed');
    ok(w.events.filter((e) => e.type === 'rivalHit' && e.from === 0 && e.to === 1).length === 1, 'stepTitan dash: exactly one hit for the whole dash');
  }

  // ---- VOLT-KITE ----
  {
    const w = duel('voltkite', 'molo', 2, 2, 15);
    kitTick(w, [0]);
    ok(near(w.players[1].titan.maxHp - hp(w, 1), expectLoss(w, 0, 1, VSK.voltkite.auto), 1e-6), 'FORK-ARC: 2.5 % to a rival, first link', `${w.players[1].titan.maxHp - hp(w, 1)}`);
    ok(rivalHits(w, 0, 1) === 1 && w.events.some((e) => e.type === 'arc' && e.kind === 'fork'), 'FORK-ARC: one rivalHit and the arc event');
    const o = duel('voltkite', 'molo', 2, 2, 15, 'open');
    kitTick(o, [0]);
    ok(hp(o, 1) === o.players[1].titan.maxHp && rivalHits(o, 0, 1) === 0, 'OPEN HOUSE: the arc does not target a rival');
  }
  {   // wires shock a rival standing in them, 2 %/s, wires do not stack
    const w = duel('voltkite', 'molo', 2, 2, 15);
    bindPlayer(w, 0);
    const T0 = w.players[0].titan, T1 = w.players[1].titan;
    for (let k = 0; k < 3; k++) {
      spawnHazard(w, { owner: 'titan', kind: 'wire', shape: { k: 'capsule', x0: T1.x - 4, z0: T1.z, x1: T1.x + 4, z1: T1.z, r: 3 }, life: 30, dps: 0, data: { life0: 30, h: T0.height } });
    }
    unbindPlayer(w);
    w.players[0].titan.autoCd = 5;                           // no arcs: isolate the wire shock
    w.players[0].titan.abilityCd = 99;
    let ticks = 30;
    for (let i = 0; i < ticks; i++) kitTick(w, [0]);
    const loss = T1.maxHp - T1.hp;
    ok(near(loss, expectLoss(w, 0, 1, VSK.voltkite.wireTickPerS * ticks * w.dt), 1e-5), '3 overlapping wires shock a rival 2 %/s TOTAL (they do not stack)', `${loss} vs ${expectLoss(w, 0, 1, VSK.voltkite.wireTickPerS * ticks * w.dt)}`);
    const o = duel('voltkite', 'molo', 2, 2, 15, 'open');
    bindPlayer(o, 0);
    spawnHazard(o, { owner: 'titan', kind: 'wire', shape: { k: 'capsule', x0: -4, z0: 15, x1: 4, z1: 15, r: 3 }, life: 30, dps: 0, data: {} });
    unbindPlayer(o);
    o.players[0].titan.autoCd = 5; o.players[0].titan.abilityCd = 99;
    for (let i = 0; i < 30; i++) kitTick(o, [0]);
    ok(hp(o, 1) === o.players[1].titan.maxHp && rivalHits(o, 0, 1) === 0, 'OPEN HOUSE: wires do not shock (no events either)');
  }
  {   // RECAST: 8 % per wire touching, at most 3 counted; wires belong to the titan that laid them
    const run = (nWires: number, otherOwner = false): { loss: number; alive: number } => {
      const w = duel('voltkite', 'molo', 2, 2, 15);
      const T1 = w.players[1].titan;
      const lay = (slot: number): void => {
        bindPlayer(w, slot);
        spawnHazard(w, { owner: 'titan', kind: 'wire', shape: { k: 'capsule', x0: T1.x - 6, z0: T1.z, x1: T1.x + 6, z1: T1.z, r: 4 }, life: 30, dps: 0, data: { life0: 30, h: 14 } });
        unbindPlayer(w);
      };
      for (let i = 0; i < nWires; i++) lay(0);
      if (otherOwner) lay(1);
      w.players[0].titan.autoCd = 5;
      const press: TitanInput = { ...IDLE, ability: true };
      // cursor-time wireShock also fires: switch the shock off by pressing on the first tick (the press precedes the shock in step())
      kitTick(w, [0], [press]);
      const alive = w.hazards.filter((h) => h.alive && h.kind === 'wire' && (h.oslot ?? 0) === 0).length;
      return { loss: T1.maxHp - T1.hp, alive };
    };
    const one = run(1), two = run(2), five = run(5), mixed = run(1, true);
    const w = duel('voltkite', 'molo', 2, 2, 15);
    ok(near(one.loss, expectLoss(w, 0, 1, VSK.voltkite.detonatePerWire), 1e-6), 'RECAST: 1 wire touching = 8 %', `${one.loss}`);
    ok(near(two.loss, expectLoss(w, 0, 1, 2 * VSK.voltkite.detonatePerWire), 1e-6), 'RECAST: 2 wires = 16 %');
    ok(near(five.loss, expectLoss(w, 0, 1, VSK.voltkite.detonateMaxWires * VSK.voltkite.detonatePerWire), 1e-6), 'RECAST: 5 wires touching -> only 3 counted = 24 %', `${five.loss}`);
    ok(one.alive === 0 && five.alive === 0, 'RECAST consumes the wires it blew');
    ok(near(mixed.loss, one.loss, 1e-6), 'RECAST only blows the titan\'s OWN wires (a rival\'s wire in the same place is ignored)', `${mixed.loss} vs ${one.loss}`);
    // no wires: the static burst counts as one wire
    const b = duel('voltkite', 'molo', 2, 2, 8);
    b.players[0].titan.autoCd = 5;
    kitTick(b, [0], [{ ...IDLE, ability: true }]);
    ok(near(b.players[1].titan.maxHp - hp(b, 1), expectLoss(b, 0, 1, VSK.voltkite.detonatePerWire), 1e-6), 'RECAST with no wires: the static burst = 8 % to a rival in its circle', `${b.players[1].titan.maxHp - hp(b, 1)}`);
  }
  // wire hazards of two VOLT-KITEs never mix (cap, count)
  {
    const w = vsWorld(['voltkite', 'voltkite']);
    size(w, 0, 1); size(w, 1, 1);
    for (let s = 0; s < 2; s++) {
      bindPlayer(w, s);
      for (let k = 0; k < 4; k++) spawnHazard(w, { owner: 'titan', kind: 'wire', shape: { k: 'capsule', x0: 0, z0: 0, x1: 1, z1: 0, r: 1 }, life: 30, dps: 0, data: {} });
    }
    unbindPlayer(w);
    kitTick(w, [0, 1]);
    ok(w.players[0].titan.kit.wires === 4 && w.players[1].titan.kit.wires === 4, 'each VOLT-KITE counts only its own wires (4 + 4, not 8)', `${w.players[0].titan.kit.wires} / ${w.players[1].titan.kit.wires}`);
  }

  // ---- HEARTHBACK ----
  {
    const w = duel('hearthback', 'molo', 2, 2, 10);
    kitTick(w, [0]);
    const tg = w.telegraphs.filter((t) => t.alive && t.owner === 'titan');
    ok(tg.length === 1 && tg[0].shape.k === 'circle' && Math.abs(tg[0].shape.z - 10) < 1e-6 && Math.abs(tg[0].shape.x) < 1e-6, 'MAGMA STOMP is painted at the rival (a rival in reach is stomped first)');
    ok(tg[0].oslot === 0, 'the telegraph belongs to seat 0 (B-WORLD oslot)');
    let fired = false;
    for (let i = 0; i < 60 && !fired; i++) { kitTick(w, [0]); fired = w.events.some((e) => e.type === 'explosion' && e.kind === 'stomp'); }
    ok(fired, 'the stomp erupts after its windup');
    ok(near(w.players[1].titan.maxHp - hp(w, 1), expectLoss(w, 0, 1, VSK.hearthback.auto), 1e-6), 'MAGMA STOMP: 7 % to a rival still under it', `${w.players[1].titan.maxHp - hp(w, 1)}`);
    ok(rivalHits(w, 0, 1) === 1 && w.events.some((e) => e.type === 'rivalHit' && e.p === 0), 'MAGMA STOMP: one rivalHit, p = seat 0');
    // dodge: the rival walks out of the painted circle
    const d = duel('hearthback', 'molo', 2, 2, 10);
    kitTick(d, [0]);
    place(d, 1, 200, 200);
    for (let i = 0; i < 40; i++) kitTick(d, [0]);
    ok(hp(d, 1) === d.players[1].titan.maxHp, 'MAGMA STOMP is dodgeable: a rival that left the circle takes nothing');
    // lead: kit.sim_aimLead aims where the rival is going
    const l = duel('hearthback', 'molo', 2, 2, 10);
    l.players[1].titan.vx = 10; l.players[1].titan.vz = 0;
    l.players[0].titan.kit.sim_aimLead = 1;
    kitTick(l, [0]);
    const tl = l.telegraphs.find((t) => t.alive && t.owner === 'titan');
    const wind = Math.max(0.15, stat(l, 'stompDelay'));
    ok(tl !== undefined && tl.shape.k === 'circle' && near(tl.shape.x, 10 * wind, 1e-6), 'sim_aimLead = 1 leads a moving rival by its windup', tl && tl.shape.k === 'circle' ? String(tl.shape.x) : 'none');
    // OPEN HOUSE: no aim at the rival
    const o = duel('hearthback', 'molo', 2, 2, 10, 'open');
    kitTick(o, [0]);
    ok(!o.telegraphs.some((t) => t.alive && t.owner === 'titan' && t.shape.k === 'circle' && Math.abs((t.shape as { z: number }).z - 10) < 1e-6), 'OPEN HOUSE: the stomp is not aimed at a rival');
  }
  {   // SHELL VENT: 6 % + 0.5 % per stored point (rank-normalised), cap 25 %
    const w = duel('hearthback', 'molo', 2, 2, 10);
    const T0 = w.players[0].titan;
    const hpMul = 3.2;
    T0.kit.stored = 20 * hpMul;
    w.players[0].titan.autoCd = 9;
    kitTick(w, [0], [{ ...IDLE, ability: true }]);
    const pct = Math.min(VSK.hearthback.ventMax, VSK.hearthback.ventBase + VSK.hearthback.ventPerStored * 20);
    ok(near(w.players[1].titan.maxHp - hp(w, 1), expectLoss(w, 0, 1, pct), 1e-5), 'SHELL VENT vs a rival: 6 % + 0.5 % per stored point', `${w.players[1].titan.maxHp - hp(w, 1)} vs ${expectLoss(w, 0, 1, pct)} (pct ${pct})`);
    const c = duel('hearthback', 'molo', 2, 2, 10);
    c.players[0].titan.kit.stored = 1e9;
    c.players[0].titan.autoCd = 9;
    kitTick(c, [0], [{ ...IDLE, ability: true }]);
    ok(near(c.players[1].titan.maxHp - hp(c, 1), expectLoss(c, 0, 1, VSK.hearthback.ventMax), 1e-5), 'SHELL VENT is capped at 25 %', `${c.players[1].titan.maxHp - hp(c, 1)}`);
    const far = duel('hearthback', 'molo', 2, 2, 300);
    far.players[0].titan.kit.stored = 20 * hpMul;
    kitTick(far, [0], [{ ...IDLE, ability: true }]);
    ok(hp(far, 1) === far.players[1].titan.maxHp, 'SHELL VENT: a rival outside the ring is untouched');
  }
  {   // SHELL stores PvP damage (it goes through hurtTitan like any hit)
    const w = duel('molo', 'hearthback', 2, 2, 8);
    w.players[1].titan.iframeT = 0;
    kitTick(w, [0]);
    const st = w.players[1].titan.kit.stored ?? 0;
    const lost = w.players[1].titan.maxHp - hp(w, 1);
    ok(lost > 0 && near(st, lost * 0.6, 1e-6), 'HEARTHBACK SHELL banks 60 % of the PvP damage it takes', `${st} vs ${lost * 0.6}`);
  }

  // ---- BRIARWICK ----
  {
    const w = duel('briarwick', 'molo', 2, 2, 10);
    kitTick(w, [0]);
    ok(near(w.players[1].titan.maxHp - hp(w, 1), expectLoss(w, 0, 1, VSK.briarwick.auto), 1e-6), 'BURR LASH: 3 % to a rival in the lane', `${w.players[1].titan.maxHp - hp(w, 1)}`);
    ok(rivalHits(w, 0, 1) === 1, 'BURR LASH: one rivalHit');
    const o = duel('briarwick', 'molo', 2, 2, 10, 'open');
    kitTick(o, [0]);
    ok(hp(o, 1) === o.players[1].titan.maxHp, 'OPEN HOUSE: the lash is not aimed at a rival, no HP');
  }
  {   // a ripe pod touched by a rival bursts: 3 % + TANGLE
    const w = duel('briarwick', 'molo', 2, 2, 10);
    const T0 = w.players[0].titan, T1 = w.players[1].titan;
    T0.autoCd = 5;                                              // no lash this tick
    bindPlayer(w, 0);
    spawnHazard(w, { owner: 'titan', kind: 'bloom', shape: { k: 'circle', x: T1.x, z: T1.z - 3, r: 1 }, life: 20, dps: 0,
      data: { pod: 1, ripe: 1, fuse: -1, link: 0, src: 0, h: T0.height, vol: 0 } });
    unbindPlayer(w);
    kitTick(w, [0]);
    ok(near(T1.maxHp - T1.hp, expectLoss(w, 0, 1, VSK.briarwick.pod), 1e-6), 'a rival touching a ripe pod: 3 % of its max HP', `${T1.maxHp - T1.hp}`);
    ok(T1.slowT > 0 && T1.slowT <= VSK.briarwick.tangleS + 1e-9 && near(T1.slowMul, 1 - VSK.briarwick.tangleSlow, 1e-9), 'TANGLE: 40 % slow for <= 1 s', `${T1.slowT} x${T1.slowMul}`);
    ok(w.events.some((e) => e.type === 'bloomBurst'), 'the pod burst event fired');
    // an UNRIPE pod does not trigger on a rival
    const u = duel('briarwick', 'molo', 2, 2, 10);
    u.players[0].titan.autoCd = 5;
    bindPlayer(u, 0);
    spawnHazard(u, { owner: 'titan', kind: 'bloom', shape: { k: 'circle', x: 0, z: 7, r: 1 }, life: 20, dps: 0, data: { pod: 1, ripe: 0, fuse: -1, link: 0, src: 0, h: 14, vol: 0 } });
    unbindPlayer(u);
    kitTick(u, [0]);
    ok(hp(u, 1) === u.players[1].titan.maxHp, 'an unripe pod does not burst on a rival');
    // OPEN HOUSE: pods ignore rivals
    const o = duel('briarwick', 'molo', 2, 2, 10, 'open');
    o.players[0].titan.autoCd = 5;
    bindPlayer(o, 0);
    spawnHazard(o, { owner: 'titan', kind: 'bloom', shape: { k: 'circle', x: 0, z: 7, r: 1 }, life: 20, dps: 0, data: { pod: 1, ripe: 1, fuse: -1, link: 0, src: 0, h: 14, vol: 0 } });
    unbindPlayer(o);
    kitTick(o, [0]);
    ok(!o.events.some((e) => e.type === 'bloomBurst') && hp(o, 1) === o.players[1].titan.maxHp, 'OPEN HOUSE: a rival does not set a pod off');
    // pods of two BRIARWICKs: a pod belongs to the titan that planted it
    const t2 = vsWorld(['briarwick', 'briarwick']);
    size(t2, 0, 1); size(t2, 1, 1);
    place(t2, 0, 0, 0); place(t2, 1, 600, 600);
    for (let s = 0; s < 2; s++) { bindPlayer(t2, s); for (let k = 0; k < 3; k++) spawnHazard(t2, { owner: 'titan', kind: 'bloom', shape: { k: 'circle', x: s * 600 + k, z: s * 600, r: 1 }, life: 20, dps: 0, data: {} }); }
    unbindPlayer(t2);
    t2.players[0].titan.autoCd = 5; t2.players[1].titan.autoCd = 5;
    kitTick(t2, [0, 1]);
    ok(t2.players[0].titan.kit.pods === 3 && t2.players[1].titan.kit.pods === 3, 'each BRIARWICK counts only its own pods (3 + 3)', `${t2.players[0].titan.kit.pods} / ${t2.players[1].titan.kit.pods}`);
  }
  {   // POP-UP PARK: the ring 6 % + tangle; the pod cascade counts at most 4 pods per rival
    const w = duel('briarwick', 'molo', 2, 2, 8);
    const T1 = w.players[1].titan;
    w.players[0].titan.autoCd = 99;
    kitTick(w, [0], [{ ...IDLE, ability: true }]);
    const ring = T1.maxHp - T1.hp;
    ok(near(ring, expectLoss(w, 0, 1, VSK.briarwick.ringPop), 1e-6), 'POP-UP PARK ring: 6 % of a rival\'s max HP', `${ring}`);
    ok(T1.slowT > 0 && near(T1.slowMul, 0.6, 1e-9), 'POP-UP PARK ring tangles the rival');
    let lossMax = ring, pods = 0;
    for (let i = 0; i < 90; i++) {
      T1.iframeT = 0;
      kitTick(w, [0]);
      for (const e of w.events) if (e.type === 'rivalHit' && e.from === 0 && e.to === 1) pods++;
      lossMax = T1.maxHp - T1.hp;
    }
    const perPod = expectLoss(w, 0, 1, VSK.briarwick.pod);
    ok(pods <= VSK.briarwick.podChainMax, 'the cascade counts at most podChainMax pods per rival', `${pods} chain hits`);
    ok(lossMax <= ring + VSK.briarwick.podChainMax * perPod + 1e-6, 'cascade damage is bounded by ring + 4 pods', `${lossMax} <= ${ring + VSK.briarwick.podChainMax * perPod}`);
  }
  {   // a hook cascade with MORE than 4 pods all reaching one rival: exactly 4 count, each a full 3 % (no i-frame loss), the 5th..8th do not
    const w = duel('briarwick', 'molo', 2, 2, 20);
    const T0 = w.players[0].titan, T1 = w.players[1].titan;
    T0.autoCd = 99;
    bindPlayer(w, 0);
    for (let i = 0; i < 8; i++) {
      spawnHazard(w, { owner: 'titan', kind: 'bloom', shape: { k: 'circle', x: T1.x + (i % 3) - 1, z: T1.z + ((i / 3) | 0) - 1, r: 1 }, life: 20, dps: 0,
        data: { pod: 1, ripe: 1, fuse: 0.03 + 0.06 * i, link: i, src: 1, h: T0.height, vol: 0 } });
    }
    unbindPlayer(w);
    let hits = 0;
    for (let i = 0; i < 60; i++) { kitTick(w, [0]); hits += rivalHits(w, 0, 1); }
    const perPod = expectLoss(w, 0, 1, VSK.briarwick.pod);
    ok(hits === VSK.briarwick.podChainMax, '8 cascade pods reach one rival: exactly podChainMax (4) count', `${hits} hits`);
    ok(near(T1.maxHp - T1.hp, VSK.briarwick.podChainMax * perPod, 1e-6), 'the 4 counted pods each deal a full 3 % (the cascade ignores i-frames)', `${T1.maxHp - T1.hp} vs ${VSK.briarwick.podChainMax * perPod}`);
    // control: a fresh press starts a new cascade, the count starts over
    for (let i = 0; i < 4; i++) { bindPlayer(w, 0); spawnHazard(w, { owner: 'titan', kind: 'bloom', shape: { k: 'circle', x: T1.x, z: T1.z, r: 1 }, life: 20, dps: 0, data: { pod: 1, ripe: 1, fuse: 0.03 + 0.06 * i, link: i, src: 1, h: T0.height, vol: 0 } }); unbindPlayer(w); }
    T0.abilityCd = 0;
    let hits2 = 0;
    kitTick(w, [0], [{ ...IDLE, ability: true }]);     // POP-UP PARK: resets every rival's chain count (and rings it)
    for (let i = 0; i < 60; i++) { kitTick(w, [0]); hits2 += rivalHits(w, 0, 1); }
    ok(hits2 >= 1 && hits2 <= 1 + VSK.briarwick.podChainMax, 'a new POP-UP PARK starts a fresh cascade count', `${hits2} hits`);
  }

  // ---- UPROAR vs a rival ----
  for (const id of ['molo', 'voltkite', 'hearthback', 'briarwick'] as TitanId[]) {
    const w = duel(id, 'hearthback', 2, 2, 10);
    bindPlayer(w, 0);
    const u = w.ult;
    u.charge = 100; u.ready = true;
    const T1 = w.players[1].titan;
    let total = 0, hits = 0, kbSeen = 0;
    const fire: TitanInput = { ...IDLE, ultimate: true };
    for (let i = 0; i < 200; i++) {
      w.events.length = 0; w.tick++; w.t += w.dt;
      bindPlayer(w, 0);
      w.players[0].input = i === 0 ? fire : IDLE; w.input = w.players[0].input;
      const before = T1.hp;
      T1.iframeT = 0;                                       // expose any second hit
      stepUltimate(w);
      total += before - T1.hp;
      hits += rivalHits(w, 0, 1);
      kbSeen = Math.max(kbSeen, Math.hypot(T1.kit.sim_kbx ?? 0, T1.kit.sim_kbz ?? 0));
    }
    const wantU = expectLoss(w, 0, 1, VS.pvp.uproarPctMaxHp, 'uproar');
    ok(hits === 1, `${id} UPROAR: exactly one rivalHit per ultimate (not per pulse)`, `${hits}`);
    ok(near(total, wantU, 1e-6), `${id} UPROAR: 22 % of the rival's max HP x size edge, no power()`, `${total} vs ${wantU}`);
    ok(kbSeen > 0, `${id} UPROAR shoves the rival`);
    if (id === 'briarwick') ok((T1.kit.sim_rootT ?? 0) >= 0 && w.players[1].vs.clearedT >= 0, 'BRIARWICK UPROAR roots the rival (CC rules)');
  }
  {   // MOLO PULL drags a much smaller rival; no take-back in VS
    const w = duel('molo', 'voltkite', 3, 1, 30);
    bindPlayer(w, 0);
    w.ult.charge = 100; w.ult.ready = true;
    const T1 = w.players[1].titan;
    const d0 = Math.hypot(T1.x - w.players[0].titan.x, T1.z - w.players[0].titan.z);
    for (let i = 0; i < 90; i++) {
      w.events.length = 0; w.tick++; w.t += w.dt;
      bindPlayer(w, 0);
      w.players[0].input = i === 0 ? { ...IDLE, ultimate: true } : IDLE; w.input = w.players[0].input;
      T1.iframeT = 0;
      stepUltimate(w);
    }
    const d1 = Math.hypot(T1.x - w.players[0].titan.x, T1.z - w.players[0].titan.z);
    ok(d1 < d0 - 3, 'MOLO UPROAR PULL drags a much smaller rival toward MOLO', `${d0.toFixed(1)} -> ${d1.toFixed(1)}`);
    // a fire on a tick that ends with a draft owed is NOT taken back in VS
    const f = duel('molo', 'voltkite', 2, 2, 400);
    bindPlayer(f, 0);
    f.ult.charge = 100; f.ult.ready = true;
    f.upgrades.pendingDrafts = 1;
    f.events.length = 0; f.tick++; f.t += f.dt;
    f.players[0].input = { ...IDLE, ultimate: true }; f.input = f.players[0].input;
    stepUltimate(f);
    chargeUltimate(f);
    ok(f.ult.phase === 'roar' && f.ult.fired === 1, 'VS: an UPROAR fired on a draft-owed tick stands (no take-back: the rail never pauses)');
  }
}
function withPlayerSlot(w: World, slot: number): World { bindPlayer(w, slot); return w; }

// ═══════════════════════════ E. solo guard ═══════════════════════════
section('E. solo guard');
{
  const w = createWorld({ titan: 'briarwick', biome: 'grideast', seed: 1337 });
  ok(nearestRival(w, 1e9) === -1 && !pvpLive(w) && rivalSlots(w).length === 0, 'solo: rival helpers are inert');
  let bad: string[] = [];
  const inp: TitanInput = { mx: 0.7, mz: 0.7, ability: false, abilityHeld: false, dash: false };
  for (let i = 0; i < 2400; i++) {
    const press = i % 90 === 40;
    const dash = i % 150 === 20;
    const wi: TitanInput = { ...inp, ability: press, dash };
    // solo goes through stepWorldN
    stepWorldN(w, [wi]);
    if (i % 300 === 0) { /* sample */ }
  }
  for (const k of Object.keys(w.titan.kit)) if (/^sim_(kb|root|dashHit|stompCd|aimLead|chainHit)/.test(k)) bad.push(k);
  ok(bad.length === 0, 'solo: no VS-only kit key ever appears on the titan', bad.join());
  ok(w.hazards.every((h) => h.oslot === undefined), 'solo: hazards carry no VS owner (oslot undefined)');
  ok(w.titan.level > 1 && w.upgrades.pendingDrafts >= 0, 'solo: the titan grew normally (every level owes a draft)');
  ok(Object.keys(w.players[0].rail.data).length === 0 && w.players[0].rail.seq === 0 && !w.players[0].rail.openingDone, 'solo: the rail was never touched');
}

// GATE (2026-10-05): the dance legs are 8 s, not 4 s: with 4 s legs seat 0 walked a 16 m square in a spot with no food and never levelled (its seat had 1 offer); the assertions are unchanged.
// ═══════════════════════════ F. smoke: a full 4-seat VS world ═══════════════════════════
section('F. smoke (stepWorldN, 4 seats)');
{
  const hashOf = (w: World): number => {
    let h = 0x811c9dc5;
    const f = new Float64Array(1), u = new Uint32Array(f.buffer);
    const num = (x: number): void => { f[0] = x; h ^= u[0]; h = Math.imul(h, 0x01000193); h ^= u[1]; h = Math.imul(h, 0x01000193); };
    num(w.tick); num(w.t);
    for (const p of w.players) {
      const T = p.titan;
      num(T.x); num(T.z); num(T.hp); num(T.level); num(T.xp); num(T.rank);
      num(p.rail.seq); num(p.rail.expireT === Infinity ? -1 : p.rail.expireT); num(p.upgrades.pendingDrafts);
      for (const k of Object.keys(p.upgrades.owned).sort()) { num(p.upgrades.owned[k]); }
    }
    return h >>> 0;
  };
  const run = (): { hash: number; offers: number[]; picks: number[]; nan: boolean; ticks: number } => {
    const w = createWorld({ mode: 'vs', biome: 'grideast', seed: 1337, players: [{ titan: 'molo' }, { titan: 'voltkite' }, { titan: 'hearthback' }, { titan: 'briarwick' }] });
    const offers = [0, 0, 0, 0], picks = [0, 0, 0, 0];
    let nan = false;
    const DIR = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    for (let t = 0; t < 2400; t++) {
      const inputs: TitanInput[] = [];
      for (let s = 0; s < 4; s++) {
        const d = DIR[(Math.floor(t / 240) + s) % 4];
        inputs.push({ mx: d[0], mz: d[1], ability: t % 100 === 30 + s, abilityHeld: false, dash: t % 170 === 11 + s,
          railPick: t % 90 === 50 + s ? 1 + ((t + s) % 3) : 0, railReroll: t % 400 === 200 + s });
      }
      stepWorldN(w, inputs);
      for (const e of w.events) {
        if (e.type === 'railOffer' && e.p !== undefined && e.p >= 0) offers[e.p]++;
        if (e.type === 'railPick' && e.p !== undefined && e.p >= 0) picks[e.p]++;
      }
      for (const p of w.players) if (!Number.isFinite(p.titan.x + p.titan.z + p.titan.hp)) nan = true;
      if (w.run.result) break;
    }
    return { hash: hashOf(w), offers, picks, nan, ticks: w.tick };
  };
  const a = run(), b = run();
  ok(a.hash === b.hash && a.ticks === b.ticks, 'smoke: two identical 4-seat VS runs hash identically', `${a.hash} vs ${b.hash} (ticks ${a.ticks}/${b.ticks})`);
  ok(!a.nan, 'smoke: no NaN in any titan');
  ok(a.offers.every((n) => n >= 2), 'smoke: every seat was offered cards on the rail (opening card + level-ups)', a.offers.join());
  ok(a.picks.every((n) => n >= 1), 'smoke: every seat took at least one card', a.picks.join());
  console.log(`  smoke: ${a.ticks} ticks, offers ${a.offers.join('/')} picks ${a.picks.join('/')}`);
}

console.log(`\nprobe_titanvs: ${checks - fails} of ${checks} checks passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
