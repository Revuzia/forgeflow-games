// BLOCKTOOTH — B-VS probe: the VS rules as pure modules (src/vs/*).
//
//   node _harness/probe_vsrules.ts            # exit 0 = every check passed
//   node _harness/probe_vsrules.ts --quick    # skip the long determinism / full-match sections
// (the 9-match VP pacing gate is B-QA's _harness/vs/probe_vs.ts; this file proves the RULES module by module)
//
// What it proves (vs_design.md §3-§11, _spec/online/CORE_CONTRACT.md §4.1):
//   A  the formula (§6.1): size edge table, power cap, phase gate, the numbers of a real hit
//   B  phases + clock (§3): COUNTDOWN freeze + immunity, boundaries tick-exact, one vsPhase event per change
//   C  PvP resolution: OPEN HOUSE = shove only, takeover = formula x armor, spawn protection, CC chain (1.0 s then CLEARED),
//      UPROAR charge (x1.5 on the crown), thorns / lifesteal at 50 %, the hit log, the queue drain's de-dup
//   D  KO -> EVICTED (respawn 5 s, -2 LV never a Size, KO XP, assists, crown bounty), PvE death, no credit under 15 %
//   E  FINAL NOTICE: elimination, places, last standing wins, same-tick tie-break, hard end tie-break, standings
//   F  the CONDEMNATION ring: deterministic centre, the step schedule, mortar shells outside, none inside
//   G  comeback + crown + seats: catch-up multiplier, crown holder rule, director multiplier, leave / takeover
//   H  the bot brain: RING / RIVAL (engage, flee, anti-dogpile, human-blind) / THREAT dodge shares / rail answers
//   I  determinism: two identical 4-bot worlds hash identically; the view slot never changes the sim; full bot match ends
// Every probe world sets cheats.noSpawns (no Civil Defense) so the rules are measured alone, and jumps world.t to the
// phase under test (the VS rules read only the match clock).

import { createWorld, stepWorldN } from '../src/core/world.ts';
import { setViewSlot } from '../src/core/world.ts';
import { setBindAsserts, withPlayer } from '../src/core/players.ts';
import { RANK_LEVELS, TITAN_RADIUS_PER_H, VS, cumXpAtFor, titanHeightAt, xpToNextFor } from '../src/core/config.ts';
import type { BiomeId, PlayerSeat, TitanId, TitanInput, World } from '../src/core/types.ts';
import { BIOME_IDS } from '../src/core/types.ts';
import { hurtTitan } from '../src/titans/titansim.ts';
import { knockTitan } from '../src/titans/titanfx.ts';
import { stat } from '../src/upgrades/stats.ts';
import { recomputeStats } from '../src/upgrades/stats.ts';
import { queuePvp } from '../src/combat/pvp.ts';
import { betterFirst, catchUpMul, koXp, levelGapMul, mortarFrac, pvpDamage, pvpPower, ringRadiusAt, sizeEdge, vsScoreOf } from '../src/vs/formula.ts';
import { TAKEOVER_RAMP_S, matchClock, phaseForClock, phaseMul } from '../src/vs/clock.ts';
import { drainQueuedPvp, pvpCc, pvpHit } from '../src/vs/pvp.ts';
import type { PvpHit } from '../src/vs/pvp.ts';
import { pickRingCentre, ringOf, ringOutside } from '../src/vs/ring.ts';
import { crownHolder, vsCatchUpMul, vsDirectorMul } from '../src/vs/comeback.ts';
import { vsStandings } from '../src/vs/score.ts';
import { vsLeaveSeat, vsTakeOverSeat } from '../src/vs/seats.ts';
import { koCredit, processKos } from '../src/vs/ko.ts';
import { botThink, hash01 } from '../src/vs/bot/brain.ts';
import { createBotMemory } from '../src/vs/state.ts';
import { VSX } from '../src/vs/tune.ts';
import { vsSpawnPoints } from '../src/vs/state.ts';
import { botCallsigns } from '../src/vs/bot/names.ts';
import { cameraTarget, cycleSpectate, spectateSlots } from '../src/vs/spectate.ts';
import { rematchBiome, rematchSeed } from '../src/vs/rematch.ts';

const QUICK = process.argv.includes('--quick');
let fails = 0, checks = 0;
function ok(cond: boolean, what: string, detail = ''): void {
  checks++;
  if (!cond) { fails++; console.log(`  FAIL  ${what}${detail ? ' — ' + detail : ''}`); }
}
function near(a: number, b: number, tol: number, what: string, detail = ''): void {
  ok(Math.abs(a - b) <= tol, what, `got ${a}, want ${b} ± ${tol}${detail ? ' (' + detail + ')' : ''}`);
}
function section(s: string): void { console.log(`\n[${s}]`); }

const NO_IN: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
const TITANS4: PlayerSeat[] = [{ titan: 'molo' }, { titan: 'voltkite' }, { titan: 'hearthback' }, { titan: 'briarwick' }];

function mk(seats: PlayerSeat[] = TITANS4, seed = 1337, biome: BiomeId = 'grideast'): World {
  const w = createWorld({ mode: 'vs', biome, seed, players: seats });
  w.cheats.noSpawns = true;
  return w;
}
/** Put the match clock at `c` seconds and step one tick (the hook runs the phase machine at that clock). */
function jump(w: World, c: number, ticks = 1): void {
  w.t = (w.vs as NonNullable<World['vs']>).startT + c - w.dt;
  for (let i = 0; i < ticks; i++) stepWorldN(w, []);
}
function step(w: World, n = 1): void { for (let i = 0; i < n && !w.run.result; i++) stepWorldN(w, []); }
function evs<T extends string>(w: World, type: T): any[] { return w.events.filter((e) => e.type === type); }
/** Park the seats far apart so nothing touches them, at the given positions. */
function place(w: World, pts: [number, number][]): void {
  for (let i = 0; i < pts.length; i++) { const T = w.players[i].titan; T.x = T.px = pts[i][0]; T.z = T.pz = pts[i][1]; }
}
function setLevel(w: World, slot: number, level: number): void {
  const T = w.players[slot].titan;
  T.level = level; T.xp = 0; T.xpToNext = xpToNextFor('vs', level);
  let r = 0; while (r < 4 && level >= RANK_LEVELS[r + 1]) r++;
  T.rank = r as 0; recomputeStats(withPlayerBind(w, slot));
  T.height = titanHeightAt(T.rank, T.level); T.radius = T.height * TITAN_RADIUS_PER_H;
  T.hp = T.maxHp;
}
/** A point `dist` metres from the ring centre inside the playable bounds (tries 8 directions; the roomiest wins). */
function farPoint(w: World, dist: number): { x: number; z: number } {
  const R = w.vs!.ring, b = w.city.bounds;
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]];
  let best = { x: R.cx, z: R.cz }, bestD = -1;
  for (const [dx, dz] of dirs) {
    const x = Math.min(b.maxX - 2, Math.max(b.minX + 2, R.cx + dx * dist)), z = Math.min(b.maxZ - 2, Math.max(b.minZ + 2, R.cz + dz * dist));
    const d = Math.sqrt((x - R.cx) * (x - R.cx) + (z - R.cz) * (z - R.cz));
    if (d > bestD) { bestD = d; best = { x, z }; }
  }
  return best;
}
function withPlayerBind(w: World, slot: number): World { w.pl = w.players[slot]; w.cur = slot; w.titan = w.players[slot].titan; w.upgrades = w.players[slot].upgrades; w.titanId = w.players[slot].titanId; return w; }
const HIT0: PvpHit = { kind: 'bite', tag: 'molo.auto', x: 0, z: 0, knock: 0, dot: false };

// ═══════════════════════════ A. the formula ═══════════════════════════
section('A. formula (vs_design.md §6.1)');
{
  near(sizeEdge(2, 2), 1, 1e-12, 'sizeEdge equal rank = 1');
  near(sizeEdge(4, 2), 1.24, 1e-12, 'sizeEdge Size V vs III = 1.24 (the design example)');
  near(sizeEdge(2, 4), 0.76, 1e-12, 'sizeEdge Size III vs V = 0.76');
  near(sizeEdge(4, 0), 1.36, 1e-12, 'sizeEdge capped at +36 % (V vs I would be 1.48)');
  near(sizeEdge(0, 4), 0.64, 1e-12, 'sizeEdge floored at -36 %');
  near(pvpPower(1), 1, 1e-12, 'power(1.0) = 1');
  near(pvpPower(2.56), 1.6, 1e-12, 'power(2.56) = 1.6 (the cap)');
  near(pvpPower(100), 1.6, 1e-12, 'power capped at 1.6');
  near(pvpPower(0), 0, 1e-12, 'power(0) = 0');
  near(pvpPower(NaN), 0, 1e-12, 'power(NaN) = 0 (no NaN damage)');
  ok(phaseMul('open') === 0 && phaseMul('countdown') === 0 && phaseMul('over') === 0, 'phaseMul 0 in OPEN HOUSE / countdown / over');
  ok(phaseMul('takeover') === 1 && phaseMul('final') === VS.pvp.finalMul && phaseMul('last') === 1, 'phaseMul 1 from HOSTILE TAKEOVER (FINAL NOTICE = VS.pvp.finalMul, the VP-tuned elimination ramp)');
  // FIXHIGH: FINAL NOTICE rival damage ramps from VS.pvp.finalMul (7:00) to VS.pvp.finalMulEnd (10:00); LAST CALL / takeover stay x 1
  {
    const P = VS.phase;
    near(phaseMul('final', P.takeoverEndS), VS.pvp.finalMul, 1e-12, 'final ramp: the start of FINAL NOTICE = finalMul');
    near(phaseMul('final', P.finalEndS), VS.pvp.finalMulEnd, 1e-12, 'final ramp: the end of FINAL NOTICE = finalMulEnd');
    near(phaseMul('final', (P.takeoverEndS + P.finalEndS) / 2), (VS.pvp.finalMul + VS.pvp.finalMulEnd) / 2, 1e-12, 'final ramp: linear in between');
    near(phaseMul('final', P.takeoverEndS - 50), VS.pvp.finalMul, 1e-12, 'final ramp: clamped before its start');
    ok(phaseMul('takeover', 300) === 1 && phaseMul('last', 620) === 1 && phaseMul('open', 100) === 0, 'the clock only ramps FINAL NOTICE (takeover / last x 1, open x 0)');
    ok(VS.pvp.finalMulEnd >= VS.pvp.finalMul && VS.pvp.finalMul > 0, 'the ramp rises (deadlier as the ring closes) and never reaches 0');
    // O-LOBBY (CRIT): HOSTILE TAKEOVER's rival damage ramps 0 -> 1 over its first TAKEOVER_RAMP_S seconds (the claws come out, not a switch)
    ok(TAKEOVER_RAMP_S === 10, 'the takeover ramp is 10 s');
    near(phaseMul('takeover', P.openEndS), 0, 1e-12, 'takeover ramp: 0 at 4:00');
    near(phaseMul('takeover', P.openEndS + TAKEOVER_RAMP_S / 2), 0.5, 1e-12, 'takeover ramp: linear (0.5 at +5 s)');
    near(phaseMul('takeover', P.openEndS + TAKEOVER_RAMP_S), 1, 1e-12, 'takeover ramp: 1 at +10 s');
    ok(phaseMul('takeover', P.openEndS + 90) === 1 && phaseMul('takeover') === 1 && phaseMul('takeover', 12) === 1, 'takeover ramp: 1 after the ramp, without a clock, and for a phase set before its boundary (probe worlds)');
  }
  // FIXHIGH: the level-gap governor
  {
    const G = VS.pvp.lvGap;
    near(levelGapMul(20, 20), 1, 1e-12, 'level gap: equal level = x 1 (the TTK gate is untouched)');
    near(levelGapMul(20 + G.free, 20), 1, 1e-12, 'level gap: inside the free band = x 1 (ahead)');
    near(levelGapMul(20 - G.free, 20), 1, 1e-12, 'level gap: inside the free band = x 1 (behind)');
    near(levelGapMul(20 + G.free + 4, 20), Math.max(G.floor, 1 - G.perLevel * 4), 1e-12, 'level gap: 4 levels past the band, ahead = 1 - perLevel x 4');
    near(levelGapMul(20 + 200, 20), G.floor, 1e-12, 'level gap: the attacker penalty floors at G.floor');
    near(levelGapMul(20, 20 + G.free + 4), Math.min(G.boostMax, 1 + G.boostPerLevel * 4), 1e-12, 'level gap: 4 levels past the band, behind = 1 + boostPerLevel x 4');
    near(levelGapMul(1, 1 + 200), G.boostMax, 1e-12, 'level gap: the underdog boost caps at G.boostMax');
    ok(levelGapMul(40, 15) < 1 && levelGapMul(15, 40) > 1 && levelGapMul(40, 15) >= G.floor && levelGapMul(15, 40) <= G.boostMax, 'a leader 25 levels up hits for less, the trailing titan hits it for more, inside the bounds');
    const bs = { victimMaxHp: 200, kitPct: 0.04, attackerDamageStat: 1, attackerRank: 2, victimRank: 2, phase: 'takeover' as const };
    near(pvpDamage({ ...bs, attackerLevel: 30, victimLevel: 10 }), 8 * levelGapMul(30, 10), 1e-9, 'pvpDamage multiplies the level-gap governor in');
    near(pvpDamage({ ...bs }), 8, 1e-9, 'pvpDamage without levels = no governor (back-compat)');
    near(pvpDamage({ ...bs, phase: 'final', clock: VS.phase.finalEndS, attackerLevel: 10, victimLevel: 10 }), 8 * VS.pvp.finalMulEnd, 1e-9, 'pvpDamage reads the FINAL NOTICE ramp from the clock');
  }
  const base = { victimMaxHp: 200, kitPct: 0.04, attackerDamageStat: 1, attackerRank: 2, victimRank: 2 } as const;
  near(pvpDamage({ ...base, phase: 'takeover' }), 8, 1e-9, '4 % of 200 HP at power 1, equal size = 8');
  near(pvpDamage({ ...base, phase: 'open' }), 0, 1e-12, 'OPEN HOUSE damage is 0');
  near(pvpDamage({ ...base, phase: 'takeover', attackerRank: 4 }), 8 * 1.24, 1e-9, 'size edge scales it (V vs III)');
  near(pvpDamage({ ...base, phase: 'takeover', attackerDamageStat: 4 }), 8 * 1.6, 1e-9, 'power scales it up to the cap');
  near(pvpDamage({ ...base, phase: 'takeover', noPower: true, attackerDamageStat: 4 }), 8, 1e-9, 'noPower (UPROAR) ignores the damage stat');
  // TTK design check: an equal-size 1v1 of MOLO bites (4 % / 0.75 s at power 1) lasts 25 / 0.75 ... report; 15 s target is for the mixed kit set
  const ttkMolo = 1 / VS.kitPct.molo.auto * 0.75;
  ok(ttkMolo > 10 && ttkMolo < 40, `MOLO auto-only TTK in a sane band (${ttkMolo.toFixed(1)} s; the ~15 s target is for autos + hooks + dashes)`);
  // KO XP
  near(koXp(100, 2, 2), 40, 1e-9, 'KO XP = 40 % of the XP lost');
  near(koXp(100, 2, 3), 40, 1e-9, 'bigger victim pays full');
  near(koXp(100, 3, 2), 40, 1e-9, '1 rank smaller pays full');
  near(koXp(100, 4, 2), 0, 1e-12, '2+ ranks smaller pays nothing (NO STORY HERE)');
  near(koXp(0, 2, 2), 0, 1e-12, 'no XP lost = no KO XP');
  // catch-up
  near(catchUpMul(10, 10), 1, 1e-12, 'catch-up: the leader gets x1');
  near(catchUpMul(12, 10), 1, 1e-12, 'catch-up: ahead of the leader is x1');
  near(catchUpMul(6, 10), Math.min(VS.catchUp.max, 1 + VS.catchUp.perLevel * 4), 1e-12, 'catch-up: 4 levels behind = 1 + VS.catchUp.perLevel x 4');
  near(catchUpMul(1, 30), VS.catchUp.max, 1e-12, 'catch-up capped at VS.catchUp.max');
  // score
  near(vsScoreOf({ tonnage: 12000, pvpDealtPct: 30, evictions: 2, assists: 1, tenderShares: 0.5, peakSize: 4 }), 12 + 60 + 300 + 50 + 150 + 400, 1e-9, 'VS SCORE line items');
  // tie-break order
  const order = [{ slot: 2, hpFrac: 0.5, score: 10 }, { slot: 0, hpFrac: 0.5, score: 10 }, { slot: 1, hpFrac: 0.9, score: 1 }, { slot: 3, hpFrac: 0.5, score: 99 }].sort(betterFirst).map((c) => c.slot);
  ok(order.join() === '1,3,0,2', 'tie-break: HP fraction, then score, then lower seat', order.join());
  // ring radius + mortar
  near(ringRadiusAt(0, 584), 584, 1e-9, 'ring: full before 7:00');
  near(ringRadiusAt(419.9, 584), 584, 1e-9, 'ring: full until 7:00');
  near(ringRadiusAt(430, 584), 584 + (584 * 0.75 - 584) * 0.5, 1e-6, 'ring: halfway through step 1');
  near(ringRadiusAt(440, 584), 584 * 0.75, 1e-9, 'ring: step 1 settled');
  near(ringRadiusAt(490, 584), 584 * 0.75 + (584 * 0.5 - 584 * 0.75) * 0.5, 1e-6, 'ring: halfway through step 2');
  near(ringRadiusAt(700, 584), 584 * 0.15, 1e-9, 'ring: final circle');
  near(mortarFrac(430), 0.04, 1e-12, 'mortar: 4 % at step 1');
  near(mortarFrac(500), 0.05, 1e-12, 'mortar: +1 % at step 2');
  near(mortarFrac(610), 0.07 + 0.02 * 2, 1e-12, 'mortar: step 4 (7 %) + 2 x 2 % LAST CALL after 10 s');
  ok(phaseForClock(-1) === 'countdown' && phaseForClock(0) === 'open' && phaseForClock(239.99) === 'open' && phaseForClock(240) === 'takeover'
    && phaseForClock(419.99) === 'takeover' && phaseForClock(420) === 'final' && phaseForClock(599.99) === 'final' && phaseForClock(600) === 'last', 'phaseForClock boundaries');
}

// ═══════════════════════════ B. phases + countdown ═══════════════════════════
section('B. phases + COUNTDOWN freeze');
{
  const w = mk();
  setBindAsserts(true);
  ok(w.vs !== null && w.vs.phase === 'countdown' && w.vs.startT === VS.countdownS, 'starts in COUNTDOWN, OPEN HOUSE at world 5 s');
  const seq: string[] = [];
  const x0 = w.players.map((p) => [p.titan.x, p.titan.z]);
  const push: TitanInput = { mx: 1, mz: 0, ability: true, abilityHeld: true, dash: true };
  let firstOpen = -1, hurtInCd = 0, actCd = 0;
  let ch0: number[] = [], chEnd: number[] = [];
  for (let i = 0; i < 160; i++) {
    stepWorldN(w, [push, push, push, push]);
    if (i === 0) ch0 = w.players.map((p) => p.titan.dashCharges);       // after the first tick (stats settle the pool)
    if (i === 148) chEnd = w.players.map((p) => p.titan.dashCharges);   // the last countdown tick
    for (const e of evs(w, 'vsPhase')) { seq.push(e.phase); if (e.phase === 'open') firstOpen = w.tick; }
    if (w.vs!.phase === 'countdown') actCd += evs(w, 'dash').length + evs(w, 'ability').length + evs(w, 'titanAttack').length;
    if (w.vs!.phase === 'countdown') {
      for (let k = 0; k < 4; k++) if (w.players[k].titan.x !== x0[k][0] || w.players[k].titan.z !== x0[k][1]) hurtInCd++;
    }
  }
  ok(seq.join() === 'countdown,open', 'one vsPhase event per change (countdown, open)', seq.join());
  ok(hurtInCd === 0, 'COUNTDOWN: every titan is frozen (position never changes)');
  ok(actCd === 0, 'COUNTDOWN: no dash / hook / attack happens even with every button held', String(actCd));
  ok(ch0.length === 4 && chEnd.every((c, k) => c >= ch0[k]), 'COUNTDOWN: dash charges are not spent', `${ch0.join()} -> ${chEnd.join()}`);
  ok(w.players[0].input === push, 'COUNTDOWN: the input object the caller passed is left alone (the keep-previous-input rule)');
  ok(firstOpen === 151, 'OPEN HOUSE begins on tick 151 (5 s x 30 Hz + 1)', String(firstOpen));
  for (let k = 0; k < 4; k++) ok(w.players[k].titan.x !== x0[k][0] || w.players[k].titan.z !== x0[k][1], `OPEN HOUSE: seat ${k} moves once the countdown ends`);
  // a shove during the countdown does not move anyone either (the freeze pins position + heading)
  const wk = mk();
  step(wk, 3);
  const px0 = wk.players[1].titan.x;
  knockTitan(wk, 1, 1, 0, 40);
  step(wk, 20);
  ok(wk.vs!.phase === 'countdown' && wk.players[1].titan.x === px0, 'COUNTDOWN: a shove cannot move a titan either');
  // immunity during the countdown
  const w2 = mk();
  step(w2, 1);
  withPlayer(w2, 1, () => hurtTitan(w2, 50, 'generic', 0, 0));
  ok(w2.players[1].titan.hp === w2.players[1].titan.maxHp, 'COUNTDOWN: immune to damage');
  step(w2, 2);
  withPlayer(w2, 1, () => hurtTitan(w2, 50, 'generic', 0, 0));
  ok(w2.players[1].titan.hp === w2.players[1].titan.maxHp, 'COUNTDOWN: still immune two ticks later (the hold is renewed each tick)');
  jump(w2, 10, 2);
  withPlayer(w2, 1, () => hurtTitan(w2, 20, 'generic', 0, 0));
  ok(w2.players[1].titan.hp < w2.players[1].titan.maxHp, 'OPEN HOUSE: PvE damage applies again');
  // phase timeline
  const w3 = mk();
  const tl: [number, string][] = [[0.5, 'open'], [239.9, 'open'], [240.1, 'takeover'], [419.9, 'takeover'], [420.1, 'final'], [599.9, 'final'], [600.1, 'last']];
  for (const [c, ph] of tl) { jump(w3, c); ok(w3.vs!.phase === ph, `clock ${c} -> ${ph}`, w3.vs!.phase); }
  ok(matchClock(w3) > 600, 'matchClock reads world.t - startT');
  setBindAsserts(false);
}

// ═══════════════════════════ C. PvP resolution ═══════════════════════════
section('C. pvpHit / pvpCc');
{
  // OPEN HOUSE: no damage, shove only, NO CONTEST event
  const w = mk([{ titan: 'molo' }, { titan: 'molo' }]);
  jump(w, 30);
  place(w, [[0, 0], [10, 0]]);
  const V = w.players[1].titan;
  const hp0 = V.hp;
  const lost = pvpHit(w, 0, 1, 0.04, { ...HIT0, x: 0, z: 0, knock: 5 });
  ok(lost === 0 && V.hp === hp0, 'OPEN HOUSE: no HP lost');
  const rh = evs(w, 'rivalHit');
  ok(rh.length === 1 && rh[0].noContest === true && rh[0].pct === 0 && rh[0].from === 0 && rh[0].to === 1 && rh[0].p === 0, 'OPEN HOUSE: a NO CONTEST rivalHit, tagged p = attacker', JSON.stringify(rh));
  ok((V.kit.sim_kbx ?? 0) > 0, 'OPEN HOUSE: the rival is shoved (knockTitan applied away from the impact point)');
  ok(w.players[1].vs.hits.length === 0, 'OPEN HOUSE: no hit log entry');

  // HOSTILE TAKEOVER: the formula x armor
  w.events.length = 0;
  jump(w, 250);
  place(w, [[0, 0], [10, 0]]);
  V.iframeT = 0; w.players[1].ult.invulnT = 0;
  const armor = stat(withPlayerBind(w, 1), 'armor');
  const dmgStat = stat(withPlayerBind(w, 0), 'damage');
  const want = V.maxHp * 0.04 * VSX.pvpMul * Math.min(1.6, Math.sqrt(dmgStat)) * sizeEdge(w.players[0].titan.rank, V.rank) * (100 / (100 + armor));
  const hpA = V.hp;
  const got = pvpHit(w, 0, 1, 0.04, { ...HIT0, x: 0, z: 0, knock: 0 });
  near(got, want, 1e-9, 'takeover: HP lost = maxHp x pct x power x edge x armor factor');
  near(hpA - V.hp, got, 1e-9, 'takeover: the returned value is the HP actually removed');
  const log = w.players[1].vs.hits;
  ok(log.length === 1 && log[0].from === 0 && Math.abs(log[0].pct - got / V.maxHp) < 1e-12, 'takeover: hit log entry {from, pct = fraction of maxHp}');
  near(w.players[0].vs.pvpDealt, (got / V.maxHp) * 100, 1e-9, 'takeover: PvP damage dealt accrues in % of the victim max HP');
  ok(evs(w, 'titanHurt').some((e) => e.p === 1), 'takeover: the victim gets its own titanHurt (p = victim)');
  ok(evs(w, 'rivalHit').some((e) => e.noContest === false && e.pct > 0 && e.p === 0), 'takeover: rivalHit with the real pct, p = attacker');
  // i-frames: a second hit inside the post-hit window does nothing
  const again = pvpHit(w, 0, 1, 0.04, { ...HIT0, x: 0, z: 0, knock: 0 });
  ok(again === 0, 'takeover: the victim i-frames (hurtTitan) still stop a hit inside the window');

  // spawn protection blocks and is broken by attacking
  const w2 = mk([{ titan: 'molo' }, { titan: 'molo' }]);
  jump(w2, 250);
  w2.players[1].vs.spawnProtT = 3;
  w2.players[1].titan.iframeT = 0;
  const hpP = w2.players[1].titan.hp;
  const lp = pvpHit(w2, 0, 1, 0.04, { ...HIT0, knock: 4 });
  ok(lp === 0 && w2.players[1].titan.hp === hpP && (w2.players[1].titan.kit.sim_kbx ?? 0) === 0, 'spawn protection: no damage, no shove');
  w2.players[0].vs.spawnProtT = 3;
  w2.players[0].ult.invulnT = 2 * w2.dt;
  w2.players[1].vs.spawnProtT = 0;
  pvpHit(w2, 0, 1, 0.04, { ...HIT0 });
  ok(w2.players[0].vs.spawnProtT === 0 && w2.players[0].ult.invulnT === 0, 'attacking a rival breaks the attacker\'s own spawn protection early');

  // CC accounting: 1.0 s per chain, then CLEARED for 3 s (+ the grant)
  const w3 = mk([{ titan: 'molo' }, { titan: 'molo' }]);
  jump(w3, 250);
  const g1 = pvpCc(w3, 0, 1, 'root', 0.7);
  const g2 = pvpCc(w3, 0, 1, 'root', 0.7);
  const g3 = pvpCc(w3, 0, 1, 'root', 0.7);
  near(g1, 0.7, 1e-9, 'CC: first 0.7 s granted in full');
  near(g2, 0.3, 1e-9, 'CC: the chain budget (1.0 s) leaves 0.3 s');
  near(g3, 0, 1e-12, 'CC: then nothing');
  ok(w3.players[1].vs.clearedT > 3, 'CC: CLEARED (> 3 s) after the budget runs out', String(w3.players[1].vs.clearedT));
  const dur = w3.players[1].vs.clearedT;
  step(w3, Math.ceil((dur + 0.2) / w3.dt));
  ok(w3.players[1].vs.clearedT === 0, 'CC: CLEARED expires');
  near(pvpCc(w3, 0, 1, 'slow', 5), 1.0, 1e-9, 'CC: a fresh chain gets 1.0 s again (a 5 s tangle is cut to 1.0 s)');
  // continuous pull: dt per tick until the budget is gone
  const w4 = mk([{ titan: 'molo' }, { titan: 'molo' }]);
  jump(w4, 250);
  let pulled = 0, n = 0;
  for (; n < 100; n++) { const g = pvpCc(w4, 0, 1, 'pull', w4.dt); if (g <= 0) break; pulled += g; }
  near(pulled, 1.0, 1e-6, 'CC: a continuous pull grants dt per tick for exactly 1.0 s in total', String(pulled));
  // an idle gap refills the budget
  const w5 = mk([{ titan: 'molo' }, { titan: 'molo' }]);
  jump(w5, 250);
  pvpCc(w5, 0, 1, 'root', 0.5);
  step(w5, 30);
  near(pvpCc(w5, 0, 1, 'root', 1), 1.0, 1e-9, 'CC: 1 s of idle time refills the chain budget');
  // OPEN HOUSE: no CC at all
  const w6 = mk([{ titan: 'molo' }, { titan: 'molo' }]);
  jump(w6, 30);
  near(pvpCc(w6, 0, 1, 'root', 1), 0, 1e-12, 'OPEN HOUSE: rival CC is off');

  // UPROAR charge: 120 x fraction, x1.5 against the crown
  const w7 = mk([{ titan: 'molo' }, { titan: 'molo' }]);
  jump(w7, 250);
  withPlayerBind(w7, 0);
  w7.players[0].ult.charge = 0; w7.players[0].ult.ready = false;
  w7.players[1].titan.iframeT = 0;
  const ultMul = Math.max(0, stat(withPlayerBind(w7, 0), 'ultCharge'));
  const l7 = pvpHit(w7, 0, 1, 0.04, { ...HIT0 });
  near(w7.players[0].ult.charge, Math.min(100, 120 * (l7 / w7.players[1].titan.maxHp) * ultMul), 1e-6, 'UPROAR charge = 120 x fraction of the rival maxHp dealt (x ultCharge stat)');
  w7.vs!.crown = 1;
  w7.players[0].ult.charge = 0; w7.players[1].titan.iframeT = 0;
  const l7b = pvpHit(w7, 0, 1, 0.04, { ...HIT0 });
  near(w7.players[0].ult.charge, Math.min(100, 120 * 1.5 * (l7b / w7.players[1].titan.maxHp) * ultMul), 1e-6, 'UPROAR charge x1.5 when the victim wears the FRONT PAGE crown');

  // thorns / lifesteal at 50 %
  const w8 = mk([{ titan: 'molo' }, { titan: 'molo' }]);
  jump(w8, 250);
  w8.players[1].upgrades.owned = {}; w8.players[1].titan.stats.thorns = 0.5; w8.players[0].titan.stats.lifesteal = 0.4;
  w8.players[0].titan.hp = w8.players[0].titan.maxHp * 0.5;
  const aHp = w8.players[0].titan.hp;
  w8.players[1].titan.iframeT = 0;
  const l8 = pvpHit(w8, 0, 1, 0.04, { ...HIT0 });
  const healed = w8.players[0].titan.hp - aHp + (w8.players[1].vs.pvpDealt / 100) * w8.players[0].titan.maxHp;   // heal minus thorns taken
  const thorns = 0.5 * l8 * VS.pvp.thornsEff;
  const heal = Math.min(0.02 * w8.players[0].titan.maxHp, 0.4 * l8 * VS.pvp.lifestealEff);
  near(w8.players[0].vs.pvpTaken / 100 * w8.players[0].titan.maxHp, thorns * (100 / (100 + stat(withPlayerBind(w8, 0), 'armor'))), 1e-6, 'thorns reflect at 50 % onto the attacker');
  near(healed, heal, 1e-6, 'lifesteal heals at 50 % of the HP lost (capped 2 % maxHp / tick)');
  ok(w8.players[0].vs.hits.some((h) => h.from === 1), 'thorns damage is logged as a hit from the victim');

  // the TTK knob (VSX.pvpMul) never scales UPROAR or the body stomp: they keep the spec numbers
  const wu = mk([{ titan: 'molo' }, { titan: 'molo' }]);
  jump(wu, 250);
  const Vu = wu.players[1].titan;
  const armU = stat(withPlayerBind(wu, 1), 'armor');
  const dsU = stat(withPlayerBind(wu, 0), 'damage');
  const eU = sizeEdge(wu.players[0].titan.rank, Vu.rank);
  Vu.iframeT = 0; wu.players[1].ult.invulnT = 0;
  const lu = pvpHit(wu, 0, 1, VS.pvp.uproarPctMaxHp, { ...HIT0, kind: 'generic', tag: 'uproar' });
  near(lu, Vu.maxHp * VS.pvp.uproarPctMaxHp * eU * (100 / (100 + armU)), 1e-9, 'UPROAR on a rival = 22 % maxHp x size edge (no power, no TTK knob)');
  Vu.hp = Vu.maxHp; Vu.iframeT = 0;
  const ls = pvpHit(wu, 0, 1, VS.contact.stompMaxHpFrac, { ...HIT0, kind: 'stomp', tag: 'stomp' });
  near(ls, Vu.maxHp * VS.contact.stompMaxHpFrac * Math.min(1.6, Math.sqrt(dsU)) * eU * (100 / (100 + armU)), 1e-9, 'a body stomp keeps its 6 % (power + edge, no TTK knob)');
  // the queue drain: a (from,to) pair a kit resolved this tick is skipped; an unclaimed hit resolves at the kit-table %
  const w9 = mk([{ titan: 'molo' }, { titan: 'molo' }]);
  jump(w9, 250);
  w9.players[1].titan.iframeT = 0;
  const qh = { from: 0, to: 1, kind: 'bite' as const, dmg: 10, crit: false, dot: false, x: 0, z: 0, knock: 0, slow: 0, upg: '', tick: w9.tick };
  queuePvp(w9, qh);
  const hp9 = w9.players[1].titan.hp;
  ok(drainQueuedPvp(w9) === 1 && w9.players[1].titan.hp < hp9, 'queue drain: an unclaimed queued bite lands (kit-table %)');
  w9.players[1].titan.iframeT = 0;
  const hp9b = w9.players[1].titan.hp;
  pvpHit(w9, 0, 1, 0.01, { ...HIT0 });
  const hp9c = w9.players[1].titan.hp;
  w9.players[1].titan.iframeT = 0;
  queuePvp(w9, { ...qh, tick: w9.tick });
  ok(drainQueuedPvp(w9) === 0 && w9.players[1].titan.hp === hp9c && hp9c < hp9b, 'queue drain: a pair a kit already resolved this tick is skipped (never counted twice)');
}

// ═══════════════════════════ D. KO / EVICTED / respawn ═══════════════════════════
section('D. KO -> EVICTED, respawn, credit, XP');
{
  // PvE death in OPEN HOUSE: an eviction with no killer
  const w = mk();
  jump(w, 60);
  setLevel(w, 1, 20);
  const T = w.players[1].titan;
  const lv0 = T.level;
  T.hp = 0; T.alive = false;
  step(w);
  const ev = evs(w, 'evicted');
  ok(ev.length === 1 && ev[0].victim === 1 && ev[0].killer === -1 && ev[0].p === 1, 'OPEN HOUSE PvE death: evicted, no killer', JSON.stringify(ev));
  ok(ev[0].levelsLost === VS.ko.levelsLost && T.level === lv0 - VS.ko.levelsLost, 'evicted: -VS.ko.levelsLost levels', `${lv0} -> ${T.level}`);
  ok(T.rank === 2, 'evicted: never loses a Size (LV 20 is Size III, LV 18 still Size III)');
  ok(w.players[1].vs.respawnT > w.t && Math.abs(w.players[1].vs.respawnT - w.t - VS.ko.respawnS) < 0.1, 'evicted: respawn timer 5 s');
  ok(!T.alive && w.players[1].vs.koCount === 1, 'evicted: body stays down during the timer');
  step(w, Math.round(VS.ko.respawnS / w.dt) + 2);
  ok(T.alive && T.hp === T.maxHp, 'respawn: back at full HP after 5 s');
  ok(w.players[1].vs.spawnProtT > 0 && w.players[1].vs.spawnProtT <= VS.ko.spawnProtS, 'respawn: 3 s spawn protection');
  ok(evs(w, 'respawn').length <= 1, 'respawn event (p = the seat)');
  ok(w.players[1].vs.eliminated === false, 'OPEN HOUSE / TAKEOVER KO never eliminates');

  // floor: at the first level of a Size the loss is 0 levels
  const wf = mk();
  jump(wf, 60);
  setLevel(wf, 0, 16);                                  // Size III starts at 16
  const lvF = wf.players[0].titan.level;
  wf.players[0].titan.hp = 0; wf.players[0].titan.alive = false;
  step(wf);
  ok(wf.players[0].titan.level === lvF && wf.players[0].titan.rank === 2, 'evicted at the first level of a Size: floored, the Size is kept');
  setLevel(wf, 3, 17);
  wf.players[3].titan.hp = 0; wf.players[3].titan.alive = false;
  step(wf);
  ok(wf.players[3].titan.level === 16, 'evicted at LV 17 (Size III from 16): floored at 16 (lost 1)');

  // KO credit: killer = most damage in the last 10 s (>= 15 % of maxHp), assists >= 15 %
  const w2 = mk();
  jump(w2, 250);
  setLevel(w2, 0, 20); setLevel(w2, 1, 20); setLevel(w2, 2, 20); setLevel(w2, 3, 20);
  const V = w2.players[3];
  const mh = V.titan.maxHp;
  V.vs.hits.push({ from: 0, t: w2.t - 2, pct: 0.30 }, { from: 1, t: w2.t - 3, pct: 0.20 }, { from: 2, t: w2.t - 4, pct: 0.05 }, { from: 2, t: w2.t - 30, pct: 0.9 });
  const c = koCredit(w2, 3);
  ok(c.killer === 0 && c.assists.join() === '1', 'koCredit: killer = top damage in the window; assist >= 15 %; old / small hits ignored', JSON.stringify(c));
  // PvE finishing blow after 10 % chip: no killer
  const w2b = mk();
  jump(w2b, 250);
  w2b.players[3].vs.hits.push({ from: 0, t: w2b.t - 1, pct: 0.10 });
  ok(koCredit(w2b, 3).killer === -1, 'koCredit: under 15 % of maxHp is a PvE death (no killer)');
  // tie: equal damage -> the lower slot
  const w2c = mk();
  jump(w2c, 250);
  w2c.players[3].vs.hits.push({ from: 2, t: w2c.t - 1, pct: 0.3 }, { from: 1, t: w2c.t - 1, pct: 0.3 });
  ok(koCredit(w2c, 3).killer === 1, 'koCredit: equal damage goes to the lower slot');

  // full eviction with credit: XP to killer (40 % of XP lost), assist 25 % of that, evictions / assists counted
  setLevel(w2, 0, 20); setLevel(w2, 1, 20);
  const k0 = w2.players[0].titan, a1 = w2.players[1].titan;
  const xpK0 = cumXpAtFor('vs', k0.level) + k0.xp, xpA0 = cumXpAtFor('vs', a1.level) + a1.xp;
  const lostExpect = (cumXpAtFor('vs', 20) + 0) - (cumXpAtFor('vs', 20 - VS.ko.levelsLost) + 0);
  V.titan.level = 20; V.titan.xp = 0; V.titan.xpToNext = xpToNextFor('vs', 20);
  V.titan.hp = 0; V.titan.alive = false;
  w2.vs!.crown = -1;
  step(w2);
  const kxp = koXp(lostExpect, k0.rank, 2);
  const gotK = cumXpAtFor('vs', k0.level) + k0.xp - xpK0, gotA = cumXpAtFor('vs', a1.level) + a1.xp - xpA0;
  near(gotK, kxp, 1e-3, 'KO XP: the killer banks 40 % of the XP the victim lost', `${gotK} vs ${kxp}`);
  near(gotA, kxp * 0.25, 1e-3, 'KO XP: the assist banks 25 % of it');
  ok(w2.players[0].vs.evictions === 1 && w2.players[1].vs.assists === 1 && V.vs.koCount === 1 && V.vs.lastKillerSlot === 0, 'counters: evictions / assists / koCount / lastKiller');
  const e2 = evs(w2, 'evicted')[0];
  ok(e2 && e2.killer === 0 && e2.assists.join() === '1' && e2.levelsLost === VS.ko.levelsLost, 'evicted event carries killer, assists, levels lost', JSON.stringify(e2));

  // crown bounty: evicting the FRONT PAGE holder pays 1 extra level of XP (HEADLINE STOLEN)
  const w3 = mk();
  jump(w3, 250);
  setLevel(w3, 0, 18); setLevel(w3, 1, 22);
  w3.vs!.crown = 1;
  w3.players[1].vs.hits.push({ from: 0, t: w3.t - 1, pct: 0.5 });
  const kk = w3.players[0].titan;
  const before = cumXpAtFor('vs', kk.level) + kk.xp;
  const lostC = (cumXpAtFor('vs', 22)) - (cumXpAtFor('vs', 22 - VS.crown.levelsLost));   // the crown holder loses VS.crown.levelsLost
  w3.players[1].titan.hp = 0; w3.players[1].titan.alive = false;
  step(w3);
  const gain = cumXpAtFor('vs', kk.level) + kk.xp - before;
  near(gain, koXp(lostC, kk.rank, 2) + xpToNextFor('vs', 18) * VS.crown.bountyLevels, 0.5, 'crown bounty: KO XP + VS.crown.bountyLevels bars of XP (HEADLINE STOLEN)', String(gain));
  ok(w3.players[1].titan.level === Math.max(RANK_LEVELS[w3.players[1].titan.rank], 22 - VS.crown.levelsLost), 'the crown holder loses VS.crown.levelsLost levels (never a Size)', String(w3.players[1].titan.level));

  // tiny victim: 2+ ranks smaller pays 0 KO XP
  const w4 = mk();
  jump(w4, 250);
  setLevel(w4, 0, 30); setLevel(w4, 1, 8);
  w4.players[1].vs.hits.push({ from: 0, t: w4.t - 1, pct: 0.5 });
  const k4 = w4.players[0].titan;
  const b4 = cumXpAtFor('vs', k4.level) + k4.xp;
  w4.players[1].titan.hp = 0; w4.players[1].titan.alive = false;
  step(w4);
  near(cumXpAtFor('vs', k4.level) + k4.xp - b4, 0, 1e-6, 'NO STORY HERE: bullying a 2+ ranks smaller titan banks no KO XP');
  ok(w4.players[0].vs.evictions === 1, '... but the eviction is still counted');

  // respawn picks the spawn point farthest from live rivals
  const w5 = mk();
  jump(w5, 250);
  const pts = vsSpawnPoints(w5.city, 4);
  for (const k of [0, 1, 3]) { const Tk = w5.players[k].titan; Tk.x = Tk.px = pts[k].x; Tk.z = Tk.pz = pts[k].z; }
  const T50 = w5.players[2].titan;
  T50.x = T50.px = pts[1].x + 5; T50.z = T50.pz = pts[1].z;
  T50.hp = 0; T50.alive = false;
  step(w5);
  w5.events.length = 0;
  let rp: any = null;
  for (let i = 0; i < 200 && !rp; i++) { stepWorldN(w5, []); rp = evs(w5, 'respawn')[0]; }
  ok(rp !== null && rp.slot === 2 && rp.p === 2, 'respawn event {slot, x, z} with p = the seat');
  ok(rp !== null && Math.abs(rp.x - pts[2].x) < 1e-9 && Math.abs(rp.z - pts[2].z) < 1e-9, 'respawn at the spawn point farthest from every live rival (the one nobody stands on)');
  ok(T50.alive && T50.hp === T50.maxHp, 'respawned seat is alive at full HP');

  // event tagging
  const wt = mk();
  jump(wt, 250);
  wt.players[2].titan.hp = 0; wt.players[2].titan.alive = false;
  step(wt);
  ok(evs(wt, 'evicted').every((e) => e.p === e.victim), 'evicted is tagged p = the victim');
  const wp = mk();
  jump(wp, 430);
  wp.players[1].titan.hp = 0; wp.players[1].titan.alive = false;
  step(wp);
  ok(evs(wp, 'eliminated').every((e) => e.p === e.victim), 'eliminated is tagged p = the victim');
  ok(wp.vs !== null, 'vs state present');
  const allMatch = mk();
  const seen: any[] = [];
  for (let i = 0; i < 200; i++) { stepWorldN(allMatch, []); for (const e of allMatch.events) if (e.type === 'vsPhase') seen.push(e); }
  ok(seen.length >= 2 && seen.every((e) => e.p === -1), 'vsPhase events are match-level (p = -1)');

  // Size reached bookkeeping
  const wsz = mk();
  jump(wsz, 100);
  setLevel(wsz, 0, 35);                                                // Size V
  step(wsz);
  ok(wsz.players[0].vs.peakRank === 4 && wsz.players[0].vs.rankT.every((t) => t >= 0), 'peak Size and the time each Size was reached are recorded');
  const stz = vsStandings(wsz);
  ok(stz.find((x) => x.slot === 0)!.peakSize === 5 && stz.find((x) => x.slot === 0)!.sizeVAtS >= 0, 'standings carry peak Size and the time to Size V');
  // call-signs
  const cs = botCallsigns(1337, 3);
  ok(cs.length === 3 && new Set(cs).size === 3 && cs.every((c) => /^UNIT \d+ — [A-Z ]+$/.test(c)), 'bot call-signs: 3 distinct "UNIT n - SIGN"', cs.join(' | '));
  ok(botCallsigns(1337, 3).join() === cs.join() && botCallsigns(7, 3).join() !== cs.join(), 'bot call-signs are a deterministic function of the seed');
}

// ═══════════════════════════ E. FINAL NOTICE: elimination + placement ═══════════════════════════
section('E. elimination, placement, winner');
{
  const w = mk();
  jump(w, 430);
  ok(w.vs!.phase === 'final', 'in FINAL NOTICE');
  w.players[2].titan.hp = 0; w.players[2].titan.alive = false;
  step(w);
  ok(w.players[2].vs.eliminated && w.players[2].vs.place === 4, 'first KO of FINAL NOTICE: eliminated, 4th', `place ${w.players[2].vs.place}`);
  ok(evs(w, 'eliminated').length === 1 && evs(w, 'eliminated')[0].place === 4 && evs(w, 'eliminated')[0].victim === 2, 'eliminated event {victim, killer, place}');
  ok(w.players[2].vs.respawnT < 0, 'eliminated: no respawn timer');
  step(w, 200);
  ok(!w.players[2].titan.alive, 'eliminated: stays down');
  ok(w.players[2].vs.eliminated && w.vs!.order.join() === '2', 'elimination order recorded');
  // a skipped seat never steps again
  const px = w.players[2].titan.x;
  stepWorldN(w, [NO_IN, NO_IN, { mx: 1, mz: 0, ability: false, abilityHeld: false, dash: false }, NO_IN]);
  ok(w.players[2].titan.x === px, 'eliminated seat is skipped by every per-player step');
  w.players[0].titan.hp = 0; w.players[0].titan.alive = false;
  step(w);
  ok(w.players[0].vs.place === 3 && !w.run.result, '2nd KO: 3rd place, match continues', `place ${w.players[0].vs.place}`);
  w.players[3].titan.hp = 0; w.players[3].titan.alive = false;
  step(w);
  ok(w.run.result === 'vs' && w.run.phase === 'vsend' && w.vs!.phase === 'over', 'last standing: the match ends (run.result vs / phase vsend)');
  ok(w.vs!.winner === 1 && w.players[1].vs.place === 1 && w.players[3].vs.place === 2 && w.players[0].vs.place === 3 && w.players[2].vs.place === 4, 'placements: winner 1st, then reverse elimination order', w.players.map((p) => p.vs.place).join());
  const end = evs(w, 'vsEnd')[0];
  ok(end && end.winner === 1 && end.placements.join() === '3,1,4,2' && end.scores.length === 4, 'vsEnd {winner, placements by slot, scores by slot}', JSON.stringify(end));
  ok(!evs(w, 'runEnd').length, 'no runEnd event in VS (solo-only)');
  const st = vsStandings(w);
  ok(st.map((s) => s.slot).join() === '1,3,0,2' && st.every((s) => s.decided), 'standings: ordered by place, all decided');

  // same-tick eliminations: the survivor wins; if none survive the best of the group wins (HP, then score, then lower seat)
  const w2 = mk();
  jump(w2, 430);
  w2.players[0].vs.score = 100;
  for (const k of [0, 1, 2]) { w2.players[k].titan.hp = 0; w2.players[k].titan.alive = false; }
  step(w2);
  ok(w2.run.result === 'vs' && w2.vs!.winner === 3, 'three KOs in one tick: the fourth seat wins');
  ok(w2.players[3].vs.place === 1, 'winner place 1');
  const orderPlaces = [0, 1, 2].map((k) => w2.players[k].vs.place);
  ok(new Set(orderPlaces).size === 3 && orderPlaces.every((p) => p >= 2 && p <= 4), 'the three same-tick KOs get distinct places 2..4', orderPlaces.join());
  const w3 = mk();
  jump(w3, 430);
  for (const k of [0, 1, 2, 3]) { w3.players[k].titan.hp = 0; w3.players[k].titan.alive = false; }
  w3.players[2].vs.pvpDealt = 500;               // higher VS SCORE
  step(w3);
  ok(w3.run.result === 'vs' && w3.vs!.winner === 2, 'everyone KO\'d in one tick: the highest VS SCORE wins the tie-break', String(w3.vs!.winner));
  const pl3 = w3.players.map((p) => p.vs.place);
  ok(pl3[2] === 1 && new Set(pl3).size === 4, 'all four places distinct', pl3.join());
  const w3b = mk();
  jump(w3b, 430);
  for (const k of [0, 1, 2, 3]) { w3b.players[k].titan.hp = 0; w3b.players[k].titan.alive = false; }
  for (const k of [0, 1, 2, 3]) { w3b.players[k].vs.pvpDealt = 0; w3b.players[k].run.tonnage = 0; }
  step(w3b);
  // equal everything but tonnage / rank: score identical -> lower seat index wins
  ok(w3b.vs!.winner === 0, 'equal HP and score: the lower seat index wins', String(w3b.vs!.winner));

  // hard end: several alive at 10:45 -> HP fraction, then score, then seat
  const w4 = mk();
  jump(w4, 644);
  w4.players[1].titan.hp = w4.players[1].titan.maxHp * 0.4;
  w4.players[2].titan.hp = w4.players[2].titan.maxHp * 0.8;
  w4.players[3].titan.hp = w4.players[3].titan.maxHp * 0.8; w4.players[3].vs.pvpDealt = 900;
  w4.players[0].titan.hp = w4.players[0].titan.maxHp * 0.6;
  ok(!w4.run.result, 'not over before 10:45');
  jump(w4, 645.1);
  ok(w4.run.result === 'vs' && w4.vs!.winner === 3, 'hard end 10:45: highest HP fraction, ties by VS SCORE', String(w4.vs!.winner));
  ok(w4.players[2].vs.place === 2 && w4.players[0].vs.place === 3 && w4.players[1].vs.place === 4, 'hard end: the rest rank by the tie-break', w4.players.map((p) => p.vs.place).join());
  // live standings before the end
  const w5 = mk();
  jump(w5, 300);
  w5.players[1].titan.hp *= 0.2;
  const sl = vsStandings(w5);
  ok(sl.length === 4 && sl[sl.length - 1].slot === 1 && !sl[0].decided, 'live standings: the weakest seat is last, nothing decided');
  // the match never lasts past 10:45
  const w6 = mk([{ titan: 'molo' }]);
  jump(w6, 646);
  ok(w6.run.result === 'vs', 'a 1-seat VS world still ends at the hard end');
}

// ═══════════════════════════ F. the ring ═══════════════════════════
section('F. CONDEMNATION ring');
{
  const w = mk();
  const R = w.vs!.ring;
  const c1 = pickRingCentre(w.city, R.r0 * 0.15), c2 = pickRingCentre(w.city, R.r0 * 0.15);
  ok(c1.cx === c2.cx && c1.cz === c2.cz, 'ring centre is deterministic');
  const b = w.city.bounds;
  ok(c1.cx >= b.minX && c1.cx <= b.maxX && c1.cz >= b.minZ && c1.cz <= b.maxZ, 'ring centre inside the bounds');
  ok(R.r0 > 100, `city half-width r0 = ${R.r0.toFixed(0)} m`);
  step(w);
  ok(ringOf(w).cx === c1.cx && ringOf(w).cz === c1.cz, 'the first tick pins the centre into World.vs.ring');
  // every biome x seed: centre exists, final ring fits
  let cnt = 0;
  for (const biome of BIOME_IDS) for (const seed of [1337, 7, 99]) {
    const wc = createWorld({ mode: 'vs', biome, seed, players: [{ titan: 'molo' }, { titan: 'voltkite' }] });
    const fr = wc.vs!.ring.r0 * 0.15, bb = wc.city.bounds;
    const c = pickRingCentre(wc.city, fr);
    ok(c.cx - fr >= bb.minX - 1e-6 && c.cx + fr <= bb.maxX + 1e-6 && c.cz - fr >= bb.minZ - 1e-6 && c.cz + fr <= bb.maxZ + 1e-6, `${biome}/${seed}: the final ring fits inside the bounds`);
    cnt++;
  }
  ok(cnt === BIOME_IDS.length * 3, 'ring centre computed for every biome x seed');
  // the schedule on the live world
  const ws = mk();
  jump(ws, 419);
  ok(ringOf(ws).step === -1 && ringOf(ws).r === R.r0, 'before 7:00 the ring is the full city');
  jump(ws, 420.1);
  ok(evs(ws, 'ringStep').length === 1 && evs(ws, 'ringStep')[0].step === 0, 'step 1 starts at 7:00 with one ringStep event');
  jump(ws, 430);
  const rr = ringOf(ws);
  ok(rr.shrinking && rr.r < rr.r0 && rr.r > rr.r0 * 0.75, 'mid-step the ring is between the two radii', `${rr.r.toFixed(1)}`);
  jump(ws, 441);
  near(ringOf(ws).r, ringOf(ws).r0 * 0.75, 1e-6, 'step 1 settles at 75 %');
  jump(ws, 601); jump(ws, 625);
  near(ringOf(ws).r, ringOf(ws).r0 * 0.15, 1e-6, 'LAST CALL ring = 15 %');
  // mortar: a titan outside the ring is shelled; one inside is not
  const wm = mk([{ titan: 'molo' }, { titan: 'molo' }]);
  step(wm);
  jump(wm, 601); jump(wm, 625);
  const rg = ringOf(wm);
  const T0 = wm.players[0].titan, T1 = wm.players[1].titan;
  const far = farPoint(wm, rg.r0 * 0.9);
  ok(Math.hypot(far.x - rg.cx, far.z - rg.cz) > rg.r + 40, `test point is outside the final ring (${Math.hypot(far.x - rg.cx, far.z - rg.cz).toFixed(0)} m vs r ${rg.r.toFixed(0)})`);
  const hold = (): void => {
    T1.x = T1.px = far.x; T1.z = T1.pz = far.z; T0.x = T0.px = rg.cx; T0.z = T0.pz = rg.cz;
    T0.hp = T0.maxHp; T0.iframeT = 0;
  };
  hold(); T1.hp = T1.maxHp; T1.iframeT = 0;
  const startHp = T1.hp;
  const seen: number[] = [];
  let landed = 0;
  for (let i = 0; i < 30 * 12; i++) {
    stepWorldN(wm, []);
    for (const t of wm.telegraphs) if (t.alive && t.tag === 'condemn' && !seen.includes(t.id)) seen.push(t.id);
    landed += evs(wm, 'explosion').filter((e) => e.kind === 'mortar').length;
    hold();
    if (wm.run.result) break;
  }
  ok(seen.length >= 4, `a titan outside the ring is aimed at repeatedly (${seen.length} shells in 12 s)`);
  ok(landed >= 3, `shells land (${landed} explosions)`);
  ok(T1.hp < startHp || !T1.alive, 'mortar shells hurt the titan outside the ring');
  ok(T0.hp === T0.maxHp, 'a titan inside the ring is never shelled');
  ok(ringOutside(wm, far.x, far.z) && !ringOutside(wm, rg.cx, rg.cz), 'ringOutside agrees');
  // before FINAL NOTICE the ring never shoots
  const wq = mk([{ titan: 'molo' }, { titan: 'molo' }]);
  step(wq);
  jump(wq, 300);
  const fq = farPoint(wq, wq.vs!.ring.r0 * 0.9);
  wq.players[1].titan.x = fq.x; wq.players[1].titan.z = fq.z;
  let early = 0;
  for (let i = 0; i < 30 * 8; i++) { stepWorldN(wq, []); early += wq.telegraphs.filter((t) => t.tag === 'condemn').length; wq.players[1].titan.x = fq.x; wq.players[1].titan.z = fq.z; }
  ok(early === 0, 'no mortar before 7:00');
}

// ═══════════════════════════ G. comeback / crown / seats ═══════════════════════════
section('G. comeback, crown, seats');
{
  const w = mk();
  jump(w, 100);
  setLevel(w, 0, 10); setLevel(w, 1, 14); setLevel(w, 2, 6); setLevel(w, 3, 14);
  near(vsCatchUpMul(w, 1), 1, 1e-12, 'catch-up: a leader gets x1');
  near(vsCatchUpMul(w, 0), Math.min(VS.catchUp.max, 1 + VS.catchUp.perLevel * 4), 1e-12, 'catch-up: 4 behind = 1 + perLevel x 4');
  near(vsCatchUpMul(w, 2), Math.min(VS.catchUp.max, 1 + VS.catchUp.perLevel * 8), 1e-12, 'catch-up: 8 behind = min(max, 1 + perLevel x 8)');
  ok(w.vs!.crown === -1 && crownHolder(w) === -1, 'no crown before HOSTILE TAKEOVER');
  jump(w, 241);
  ok(evs(w, 'crown').length === 1, 'the crown event fires when HOSTILE TAKEOVER begins', String(evs(w, 'crown').length));
  ok(w.vs!.crown === 1 || w.vs!.crown === 3, 'crown: highest level wins');
  w.players[3].titan.xp = w.players[3].titan.xpToNext * 0.9;
  w.players[1].titan.xp = 0;
  step(w);
  ok(w.vs!.crown === 3, 'crown: equal level goes to more XP');
  w.players[1].titan.xp = w.players[1].titan.xpToNext * 0.95;      // only 5 % of a bar ahead of the holder: hysteresis keeps the crown
  step(w);
  ok(w.vs!.crown === 3, 'crown hysteresis: an equal-level lead under 10 % of the bar does not flip the crown', String(w.vs!.crown));
  const crownEv = evs(w, 'crown').length;
  w.players[3].titan.xp = w.players[3].titan.xpToNext * 0.3;
  step(w);
  ok(w.vs!.crown === 1 && evs(w, 'crown').length === crownEv + 1, 'crown passes over once the lead is real (one event on change)', String(w.vs!.crown));
  setLevel(w, 1, 14); w.players[1].titan.xp = w.players[3].titan.xp = 0;
  step(w);
  ok(w.vs!.crown === 1, 'crown: total tie goes to the lower slot');
  near(vsDirectorMul(w, 0), 0.6, 1e-12, 'director: 0.6 per titan');
  near(vsDirectorMul(w, 1), 0.6 * 1.3, 1e-12, 'director: x1.3 on the crown holder');
  const sumCrown = (): number => w.players.reduce((a, p) => a + p.vs.crownS, 0);
  const crownS = sumCrown();
  step(w, 30);
  near(sumCrown() - crownS, 1, 0.05, 'crown time accrues (30 ticks = 1 s on whoever holds it)');
  // eliminated seats leave the crown race
  w.players[1].vs.eliminated = true;
  step(w);
  ok(w.vs!.crown !== 1, 'an eliminated seat cannot hold the crown');
  // seats
  const ws = mk([{ titan: 'molo' }, { titan: 'molo', bot: 'regular' }, { titan: 'molo', bot: 'rookie' }]);
  jump(ws, 100);
  ok(ws.players[1].bot !== null && ws.players[0].bot === null, 'seat kinds');
  vsLeaveSeat(ws, 0, 'veteran');
  ok(ws.players[0].bot !== null && ws.players[0].bot.level === 'veteran' && ws.players[0].vs.data.left === 1, 'a human leaves: a bot takes the seat, flagged left');
  ok(vsTakeOverSeat(ws, 1) === true && ws.players[1].bot === null && ws.players[1].vs.sleeper !== null, 'takeover until 3:00: the seat becomes human, the bot memory is parked');
  vsLeaveSeat(ws, 1, 'regular');
  ok(ws.players[1].bot !== null && ws.players[1].vs.sleeper === null, 'a later leave resumes the parked brain');
  jump(ws, 190);
  ok(vsTakeOverSeat(ws, 2) === false && ws.players[2].bot !== null, 'no takeover after 3:00');
  const wo = mk([{ titan: 'molo' }, { titan: 'molo', bot: 'regular' }]);
  jump(wo, 250);
  ok(vsTakeOverSeat(wo, 1) === false, 'no takeover once PvP is live');
}

// ═══════════════════════════ H. the bot brain ═══════════════════════════
section('H. bot brain');
{
  // determinism of the dodge hash: same inputs same answer; ~ the configured share over many ids
  let hits = 0;
  for (let id = 1; id <= 4000; id++) if (hash01(id, 1337, 2) < VS.bots.regular.dodge) hits++;
  near(hits / 4000, VS.bots.regular.dodge, 0.03, 'dodge hash: ~70 % of telegraphs are noticed at REGULAR');
  ok(hash01(77, 1337, 2) === hash01(77, 1337, 2), 'dodge hash is deterministic');
  let h40 = 0, h90 = 0;
  for (let id = 1; id <= 4000; id++) { if (hash01(id, 7, 1) < VS.bots.rookie.dodge) h40++; if (hash01(id, 7, 1) < VS.bots.veteran.dodge) h90++; }
  near(h40 / 4000, 0.4, 0.03, 'dodge hash: ~40 % at ROOKIE');
  near(h90 / 4000, 0.9, 0.03, 'dodge hash: ~90 % at VETERAN');

  // RING layer: a bot outside the next ring step in FINAL NOTICE heads for the centre
  const w = mk([{ titan: 'molo', bot: 'regular' }, { titan: 'molo' }]);
  step(w);
  jump(w, 470);
  const rg = ringOf(w);
  const T = w.players[0].titan;
  const outP = farPoint(w, rg.r0 * 0.85);                           // beyond the 75 % step that is shrinking in
  T.x = T.px = outP.x; T.z = T.pz = outP.z;
  w.players[1].titan.x = rg.cx; w.players[1].titan.z = rg.cz;
  const inp = withPlayer(w, 0, () => botThink(w));
  const dx = rg.cx - T.x, dz = rg.cz - T.z, d = Math.sqrt(dx * dx + dz * dz);
  ok(inp.mx * dx / d + inp.mz * dz / d > 0.7, 'RING: outside the next ring step the bot walks toward the ring centre', `${inp.mx.toFixed(2)},${inp.mz.toFixed(2)}`);
  ok(w.players[0].bot!.mode === 'ring', 'RING: mode is ring', w.players[0].bot!.mode);
  // inside the safe radius the ring layer lets go
  T.x = T.px = rg.cx + 0.05 * rg.r0; T.z = T.pz = rg.cz;
  withPlayer(w, 0, () => botThink(w));
  ok(w.players[0].bot!.mode !== 'ring', 'RING: inside the safe radius it is food / rival again', w.players[0].bot!.mode);
  // before the pre-position window the ring layer is silent
  const wp = mk([{ titan: 'molo', bot: 'regular' }, { titan: 'molo' }]);
  step(wp);
  jump(wp, 300);
  const fp = farPoint(wp, wp.vs!.ring.r0 * 0.95);
  wp.players[0].titan.x = fp.x; wp.players[0].titan.z = fp.z;
  withPlayer(wp, 0, () => botThink(wp));
  ok(wp.players[0].bot!.mode !== 'ring', 'RING: silent until 30 s before the first step');
  jump(wp, 395);
  wp.players[0].titan.x = fp.x; wp.players[0].titan.z = fp.z;
  withPlayer(wp, 0, () => botThink(wp));
  ok(wp.players[0].bot!.mode === 'ring', 'RING: pre-positions toward the first step 30 s ahead', wp.players[0].bot!.mode);

  // RIVAL layer
  const wr = mk([{ titan: 'molo', bot: 'regular' }, { titan: 'molo' }, { titan: 'molo' }, { titan: 'molo' }]);
  jump(wr, 250);
  for (let k = 0; k < 4; k++) setLevel(wr, k, 20);
  place(wr, [[0, 0], [60, 0], [0, 90], [-120, 0]]);
  withPlayer(wr, 0, () => botThink(wr));
  ok(wr.players[0].bot!.targetSlot === 1, 'RIVAL: engages the nearest equal rival (REGULAR needs edge >= 0)', String(wr.players[0].bot!.targetSlot));
  ok(wr.players[0].bot!.mode === 'rival', 'RIVAL: mode rival');
  // anti-dogpile: two others already attacking slot 1 -> the bot looks elsewhere, unless slot 1 wears the crown
  wr.players[1].vs.hits.push({ from: 2, t: wr.t - 0.5, pct: 0.1 }, { from: 3, t: wr.t - 0.5, pct: 0.1 });
  wr.vs!.crown = -1;
  withPlayer(wr, 0, () => botThink(wr));
  ok(wr.players[0].bot!.targetSlot !== 1, 'ANTI-DOGPILE: never the 3rd attacker on one target', String(wr.players[0].bot!.targetSlot));
  wr.vs!.crown = 1;
  withPlayer(wr, 0, () => botThink(wr));
  ok(wr.players[0].bot!.targetSlot === 1, '... unless the target wears the FRONT PAGE crown', String(wr.players[0].bot!.targetSlot));
  wr.vs!.crown = -1; wr.players[1].vs.hits.length = 0;
  // flee under fleeHp
  wr.players[0].titan.hp = wr.players[0].titan.maxHp * 0.2;
  withPlayer(wr, 0, () => botThink(wr));
  ok(wr.players[0].bot!.mode !== 'flee', 'FLEE: a person takes a moment to give up a fight (REGULAR waits botFleeDelayTicks first)', wr.players[0].bot!.mode);
  wr.tick += VSX.botFleeDelayTicks.regular + 1;
  const fl = withPlayer(wr, 0, () => botThink(wr));
  ok(wr.players[0].bot!.mode === 'flee', 'FLEE: after the delay, under the flee HP and outgunned, the bot runs', wr.players[0].bot!.mode);
  const nx = wr.players[1].titan.x - wr.players[0].titan.x;
  ok(fl.mx * nx <= 0.2, 'FLEE: it moves away from the nearest rival', `${fl.mx.toFixed(2)}`);
  ok(wr.players[0].bot!.targetSlot === -1, 'FLEE: no target while fleeing');
  // two bots that are both hurt: nobody runs (a duel must be able to end)
  const wd = mk([{ titan: 'molo', bot: 'regular' }, { titan: 'molo' }]);
  jump(wd, 250);
  setLevel(wd, 0, 20); setLevel(wd, 1, 20);
  place(wd, [[0, 0], [40, 0]]);
  wd.players[0].titan.hp = wd.players[0].titan.maxHp * 0.2; wd.players[1].titan.hp = wd.players[1].titan.maxHp * 0.18;
  wd.tick += 1000;                                           // (the probe jumps the clock, not the tick counter)
  wd.players[0].bot!.targetSlot = 1; wd.players[0].bot!.data.loseTick = wd.tick - 500;
  withPlayer(wd, 0, () => botThink(wd));
  ok(wd.players[0].bot!.mode !== 'flee', 'a rival as hurt as I am is a fight to finish, not to flee', wd.players[0].bot!.mode);
  // pursue radius: a rival much farther than VSX.botPursueH body heights is not hunted (the map is food); a near one is
  const wpu = mk([{ titan: 'molo', bot: 'regular' }, { titan: 'molo' }]);
  jump(wpu, 250);
  setLevel(wpu, 0, 20); setLevel(wpu, 1, 20);
  const Hh = wpu.players[0].titan.height;
  place(wpu, [[0, 0], [VSX.botPursueH * Hh * 1.5, 0]]);
  withPlayer(wpu, 0, () => botThink(wpu));
  ok(wpu.players[0].bot!.targetSlot === -1, 'RIVAL: a rival beyond the pursue radius is not hunted', String(wpu.players[0].bot!.targetSlot));
  place(wpu, [[0, 0], [VSX.botPursueH * Hh * 0.5, 0]]);
  withPlayer(wpu, 0, () => botThink(wpu));
  ok(wpu.players[0].bot!.targetSlot === 1, 'RIVAL: a rival inside the pursue radius is', String(wpu.players[0].bot!.targetSlot));
  wpu.players[0].bot!.targetSlot = -1;
  place(wpu, [[0, 0], [VSX.botPursueH * Hh * 2.0, 0]]);
  wpu.vs!.crown = 1;
  withPlayer(wpu, 0, () => botThink(wpu));
  ok(wpu.players[0].bot!.targetSlot === 1, 'RIVAL: the crown holder is hunted from 3x as far', String(wpu.players[0].bot!.targetSlot));
  // engage thresholds differ by difficulty: a rookie will not take an equal-size fight
  const wk = mk([{ titan: 'molo', bot: 'rookie' }, { titan: 'molo' }]);
  jump(wk, 250);
  setLevel(wk, 0, 20); setLevel(wk, 1, 20);
  place(wk, [[0, 0], [40, 0]]);
  withPlayer(wk, 0, () => botThink(wk));
  ok(wk.players[0].bot!.targetSlot === -1, 'ROOKIE: engages only with an edge of +1 rank (equal size = no fight)');
  setLevel(wk, 0, 30);
  withPlayer(wk, 0, () => botThink(wk));
  ok(wk.players[0].bot!.targetSlot === 1, 'ROOKIE: engages a smaller rival', String(wk.players[0].bot!.targetSlot));
  // human-blind: swapping which seat is the human never changes who the bots pick
  const pick = (humanSlot: number): number[] => {
    const seats: PlayerSeat[] = [0, 1, 2, 3].map((i) => (i === humanSlot ? { titan: 'molo' as TitanId } : { titan: 'molo' as TitanId, bot: 'regular' as const }));
    const wb = mk(seats);
    jump(wb, 250);
    for (let k = 0; k < 4; k++) setLevel(wb, k, 20);
    place(wb, [[0, 0], [80, 0], [-80, 5], [0, 85]]);
    const out: number[] = [];
    for (let k = 0; k < 4; k++) {
      if (k === humanSlot) { out.push(-2); continue; }
      wb.players[k].bot!.targetSlot = -1;
      withPlayer(wb, k, () => botThink(wb));
      out.push(wb.players[k].bot!.targetSlot);
    }
    return out;
  };
  const pA = pick(3), pB = pick(2);
  // seat 0's pick must be identical whichever of seats 2 / 3 is the human
  ok(pA[0] === pB[0], 'bots never prefer humans: seat 0 picks the same rival whether seat 3 or seat 2 is the human', `${pA[0]} vs ${pB[0]}`);

  // THREAT: a perceived telegraph on the bot makes it step out; a fresh one (< reactTicks) is ignored
  const wt = mk([{ titan: 'molo', bot: 'veteran' }, { titan: 'molo' }]);
  jump(wt, 60);
  const Tt = wt.players[0].titan;
  Tt.x = Tt.px = 0; Tt.z = Tt.pz = 0;
  const shape = { k: 'circle' as const, x: 0, z: 0, r: 40 };
  // find a telegraph id the veteran dodges (hash < 0.9) for this seed / slot
  let id = 5000;
  while (!(hash01(id, wt.seed, 0) < VS.bots.veteran.dodge)) id++;
  const tg = { id, alive: true, owner: 'enemy' as const, style: 'circle' as const, shape, windup: 1.5, t: 0, active: 0, dmg: 10, kind: 'mortar' as const, fired: false, hitTitan: false, onFire: null, chain: null, tag: '' };
  wt.telegraphs.push(tg);
  withPlayer(wt, 0, () => botThink(wt));
  ok(wt.players[0].bot!.mode !== 'threat', 'THREAT: a telegraph younger than the reaction delay is not noticed yet');
  tg.t = 0.5;
  withPlayer(wt, 0, () => botThink(wt));
  ok(wt.players[0].bot!.mode === 'threat', 'THREAT: after the reaction delay the bot steps out of the paint');
  // an undodged id is ignored forever
  let id2 = 9000;
  while (!(hash01(id2, wt.seed, 0) >= VS.bots.veteran.dodge)) id2++;
  wt.telegraphs.length = 0;
  wt.telegraphs.push({ ...tg, id: id2, t: 1.0 });
  wt.players[0].bot!.mode = 'food';
  withPlayer(wt, 0, () => botThink(wt));
  ok(wt.players[0].bot!.mode !== 'threat', 'THREAT: a telegraph outside the dodge share is never reacted to');

  // rail: an open offer is answered once, after the difficulty delay
  const wc = mk([{ titan: 'molo', bot: 'regular' }, { titan: 'molo' }]);
  jump(wc, 30);
  const P = wc.players[0];
  P.upgrades.offer = ['sturdy_frame', 'fast_chew', 'thick_hide'];
  P.rail.open = true; P.rail.openedT = wc.t; P.rail.seq = 3;
  let i1 = withPlayer(wc, 0, () => botThink(wc));
  ok(!i1.railPick, 'rail: the bot waits out its reading delay before answering');
  wc.t += 3;
  i1 = withPlayer(wc, 0, () => botThink(wc));
  ok(i1.railPick !== undefined && i1.railPick >= 1 && i1.railPick <= 3, 'rail: answers with railPick 1..3', String(i1.railPick));
  const i2 = withPlayer(wc, 0, () => botThink(wc));
  ok(!i2.railPick, 'rail: one edge per offer (never re-answers the same offer)');
  void createBotMemory;
}

// ═══════════════════════════ H2. death, spectating, rematch (vs_design.md §11) ═══════════════════════════
section('H2. camera / spectate / rematch rules');
{
  const w = mk();
  jump(w, 250);
  // evicted with a credited killer: the camera holds on the killer for the respawn, with the countdown
  w.players[1].vs.hits.push({ from: 3, t: w.t - 1, pct: 0.5 });
  w.players[1].titan.hp = 0; w.players[1].titan.alive = false;
  step(w);
  const ct = cameraTarget(w, 1);
  ok(ct.following === 'killer' && ct.slot === 3 && ct.backInS > 4 && ct.backInS <= 5, 'evicted: the camera holds on the killer, BACK IN ~5', JSON.stringify(ct));
  ok(cameraTarget(w, 0).following === 'self' && cameraTarget(w, 0).slot === 0, 'a living seat watches itself');
  ok(spectateSlots(w).join() === '0,2,3', 'spectate list = living titans (a seat waiting to respawn is not watchable)', spectateSlots(w).join());
  ok(cycleSpectate(w, 0, 1) === 2 && cycleSpectate(w, 3, 1) === 0 && cycleSpectate(w, 0, -1) === 3 && cycleSpectate(w, 2, -1) === 0, 'Q / E cycle the living titans, skipping the dead and wrapping');
  // PvE eviction (no killer): the camera stays on the body
  const w2 = mk();
  jump(w2, 250);
  w2.players[2].titan.hp = 0; w2.players[2].titan.alive = false;
  step(w2);
  ok(cameraTarget(w2, 2).following === 'self', 'evicted with no killer: the camera stays on the body');
  // eliminated: 2.5 s on the killer, then spectate
  const w3 = mk();
  jump(w3, 430);
  w3.players[0].vs.hits.push({ from: 2, t: w3.t - 1, pct: 0.6 });
  w3.players[0].titan.hp = 0; w3.players[0].titan.alive = false;
  step(w3);
  const c1 = cameraTarget(w3, 0);
  ok(w3.players[0].vs.eliminated && c1.following === 'killer' && c1.slot === 2, 'eliminated: follows the killer first', JSON.stringify(c1));
  step(w3, Math.ceil(VS.ko.followKillerS / w3.dt) + 2);
  const c2 = cameraTarget(w3, 0);
  ok(c2.following === 'spectate' && c2.slot !== 0 && !w3.players[c2.slot].vs.eliminated, 'eliminated: after 2.5 s it spectates a living titan', JSON.stringify(c2));
  // rematch
  ok(rematchBiome('grideast') === 'whitestacks' && rematchBiome('whitestacks') === 'lockwater' && rematchBiome('lockwater') === 'grideast', 'rematch biome rotates GRID-EAST -> WHITE STACKS -> LOCKWATER');
  ok(rematchSeed(1337) !== 1337 && rematchSeed(1337) === rematchSeed(1337) && rematchSeed(1337, 2) !== rematchSeed(1337, 1), 'rematch seed is new, deterministic, and differs per rematch');
}

// ═══════════════════════════ I. determinism + a full match ═══════════════════════════
if (!QUICK) {
  section('I. determinism + full bot match');
  const seats4 = (lv: ('rookie' | 'regular' | 'veteran')[]): PlayerSeat[] => ['molo', 'voltkite', 'hearthback', 'briarwick'].map((t, i) => ({ titan: t as TitanId, bot: lv[i] }));
  const hash = (w: World): number => {
    let h = 0x811c9dc5;
    const f = new Float64Array(1), u = new Uint32Array(f.buffer);
    const num = (x: number): void => { f[0] = x; h ^= u[0]; h = Math.imul(h, 0x01000193); h ^= u[1]; h = Math.imul(h, 0x01000193); };
    num(w.tick);
    for (const p of w.players) { const T = p.titan; num(T.x); num(T.z); num(T.hp); num(T.level); num(T.xp); num(T.height); num(p.vs.score); num(p.vs.koCount); num(p.vs.pvpDealt); num(p.vs.respawnT); num(p.vs.place); }
    num(w.vs!.crown); num(w.vs!.ring.r); num(w.vs!.winner);
    for (const b of w.city.buildings) { num(b.alive); }
    return h >>> 0;
  };
  const A = createWorld({ mode: 'vs', biome: 'grideast', seed: 99, players: seats4(['regular', 'veteran', 'rookie', 'regular']) });
  const B = createWorld({ mode: 'vs', biome: 'grideast', seed: 99, players: seats4(['regular', 'veteran', 'rookie', 'regular']), view: 2 });
  setBindAsserts(true);
  let mismatch = -1;
  for (let i = 0; i < 30 * 150; i++) {
    stepWorldN(A, []); stepWorldN(B, []);
    if (i === 900) setViewSlot(B, 3);
    if (i % 150 === 0 && hash(A) !== hash(B)) { mismatch = i; break; }
  }
  setBindAsserts(false);
  ok(mismatch < 0 && hash(A) === hash(B), '4-bot VS worlds are tick-for-tick identical, and the view slot never changes the sim', `first mismatch ${mismatch}`);

  // a whole match ends by 10:45 and every rule produces consistent bookkeeping
  const F = createWorld({ mode: 'vs', biome: 'whitestacks', seed: 7, players: seats4(['regular', 'regular', 'regular', 'regular']) });
  let guard = 0;
  while (!F.run.result && guard++ < 30 * 700) stepWorldN(F, []);
  ok(F.run.result === 'vs', 'a full 4-bot match ends by itself', `tick ${F.tick}`);
  ok(matchClock(F) <= VS.phase.hardEndS + 0.1, 'never past 10:45', matchClock(F).toFixed(2));
  const places = F.players.map((p) => p.vs.place).sort();
  ok(places.join() === '1,2,3,4', 'places are exactly 1..4', places.join());
  ok(F.players[F.vs!.winner].vs.place === 1, 'the winner holds place 1');
  const ee = F.events.filter((e) => e.type === 'vsEnd');
  ok(ee.length === 1, 'exactly one vsEnd on the deciding tick', String(ee.length));
  console.log(`  (full match: ${matchClock(F).toFixed(1)} s, winner ${F.vs!.winner}, places ${F.players.map((p) => p.vs.place).join(',')}, levels ${F.players.map((p) => p.titan.level).join(',')})`);
}

console.log(`\nprobe_vsrules: ${checks - fails}/${checks} checks passed${fails ? `, ${fails} FAILED` : ''}`);
process.exit(fails ? 1 : 0);
void processKos; void BIOME_IDS;
