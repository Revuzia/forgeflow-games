// BLOCKTOOTH ONLINE VS - the VS result reporting + achievements probe (lane O-REPORT). Node, no browser, no network.
//
//   node _harness/portal/probe_vsreport.ts            # unit + real-world payloads + the PortalClient bridge flow (about 1 min)
//   node _harness/portal/probe_vsreport.ts --full     # ALSO one natural 4-seat match played to its end (about 1-3 min more)
//
// Checks (each prints PASS / FAIL; exit 0 = all pass, 1 = a FAIL):
//   A  data/vsgoals.ts: the 8 goals + tiers (bronze 2 / silver 2 / gold 3 / diamond 1 = 190 XP), every rule of applyVsMatch (a goal
//      per row of the D3 table, the >= 2-humans rule of the grind goals), sanitize / merge, VsEventTally (crown KO order).
//   B  real finished VS worlds (createWorld + stepWorldN, seats 0 and 1 human, 2 and 3 bots; the match is ended on a chosen winner
//      with endMatch, or played out with --full): the payload buildVsReport makes passes the server's bt__validate_run mirror
//      (vs_rpc_mirror.cjs) for EVERY seat, and the figures are the seat's own (placement, titan, city, tonnage, kills).
//   C  the reporting rules against the server mirror (ONLINE_PLAN 'Confirming a VS winner'): 2 humans + 2 bots -> 2 bt_vs_results rows
//      + 1 bt_vs_matches row with winner_id set when the reports agree; a bot winner / a guest winner / a disagreeing report ->
//      no winner; 1 human + 3 bots -> personal stats only (no board win); a guest files nothing and does not block the others;
//      a repeat report is {already:true}; a 3rd human report on a 2-human match is match_full.
//   D  PortalClient on a fake portal frame: signed in -> exactly ONE forgeflow:vs_result per match (the payload equals
//      buildVsReport's), the ack is parsed (confirmed / reports / already / error), a second call for the same match files nothing,
//      guest -> NO write message and the goals still land in the local ledger and are posted at the sign-in catch-up, standalone ->
//      nothing, a report made before whoami answers is queued then sent, a parent that never acks -> noack.
//   E  VsIdentityBook: two peers swap account ids over a fake room, a guest announces nothing, a late joiner is answered once,
//      a wrong match id / a non-uuid is ignored, uidsBySlot maps peers to seats.
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorld, stepWorldN } from '../../src/core/world.ts';
import { endMatch } from '../../src/vs/ko.ts';
import { emptyProfile } from '../../src/meta/profile.ts';
import type { BiomeId, PlayerSeat, SimEvent, TitanId, World } from '../../src/core/types.ts';
import {
  VS_GOALS, VS_GOAL_BY_ID, VS_TIER_POINTS, VsEventTally, applyVsMatch, emptyVsLife, mergeVsLife, sanitizeVsLife,
  type VsMatchFacts,
} from '../../src/data/vsgoals.ts';
import { PortalClient, VsIdentityBook, buildVsReport, normalizeMatchId, resultsMajority, type VsMatchInput, type RoomLike } from '../../src/net/portal.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const RPC = require_(resolve(HERE, 'vs_rpc_mirror.cjs')) as {
  FakeBtDb: new () => FakeDb; validateRun(p: unknown): string | null;
};
interface FakeDb {
  addProfile(uid: string, name?: string): void;
  report(uid: string | null, p: unknown): Record<string, unknown>;
  bt_vs_matches: Record<string, { winner_id: string | null; reports: number; humans: number; bots: number }>;
  bt_vs_results: { match_id: string; user_id: string; placement: number; claimed_winner: string | null; titan: string }[];
  bt_runs: { user_id: string; run_nonce: string; mode: string }[];
  bt_player_stats: Record<string, { vs_matches: number; vs_wins: number; vs_solo_wins: number; vs_top2: number }>;
  bt_titan_stats: Record<string, { vs_wins: number }>;
  calls: { uid: string | null; p: Record<string, unknown>; result: Record<string, unknown> }[];
}

const FULL = process.argv.includes('--full');
let fails = 0, passes = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) passes++; else fails++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}`);
  if (!ok && detail !== undefined) console.log('         ' + JSON.stringify(detail).slice(0, 700));
}
const section = (s: string): void => console.log('\n' + s);

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const U3 = '33333333-3333-4333-8333-333333333333';

// ───────────────────────────── A: vsgoals ─────────────────────────────
section('A  data/vsgoals.ts');
{
  const tiers: Record<string, number> = {};
  let xp = 0;
  for (const g of VS_GOALS) { tiers[g.tier] = (tiers[g.tier] ?? 0) + 1; xp += VS_TIER_POINTS[g.tier]; }
  check('8 goals, unique ids, g_vs_ prefix, name + desc present', VS_GOALS.length === 8 && new Set(VS_GOALS.map((g) => g.id)).size === 8 && VS_GOALS.every((g) => /^g_vs_[a-z_]+$/.test(g.id) && g.name && g.desc && g.id.length <= 64 && g.name.length <= 80 && g.desc.length <= 240));
  check('tiers bronze 2 / silver 2 / gold 3 / diamond 1 = 190 XP', tiers.bronze === 2 && tiers.silver === 2 && tiers.gold === 3 && tiers.diamond === 1 && xp === 190, { tiers, xp });
  const base: VsMatchFacts = { titan: 'molo', finished: true, won: false, humans: 1, koCount: 2, evictions: 0, crownKos: 0 };
  const eq = (a: string[], b: string[]): boolean => a.slice().sort().join() === b.slice().sort().join();
  const run = (f: Partial<VsMatchFacts>, life = emptyVsLife()): string[] => applyVsMatch(life, { ...base, ...f }, 1000).newly;
  check('a finished loss earns SYNDICATED only', eq(run({}), ['g_vs_syndicated']), run({}));
  check('not finished earns nothing', run({ finished: false }).length === 0);
  check('a KO earns CROSSOVER EPISODE', run({ evictions: 1 }).includes('g_vs_crossover_episode'));
  check('a crown KO earns HOSTILE TAKEOVER', run({ crownKos: 1 }).includes('g_vs_hostile_takeover'));
  check('a win earns CERTIFIED HEADLINE (practice included), not ZONED when knocked out', eq(run({ won: true }), ['g_vs_syndicated', 'g_vs_certified_headline']), run({ won: true }));
  check('a win with koCount 0 earns ZONED RESIDENTIAL', run({ won: true, koCount: 0 }).includes('g_vs_zoned_residential'));
  check('NETWORK EXCLUSIVE needs a win with 4 humans (3 humans is not enough)', run({ won: true, humans: 4 }).includes('g_vs_network_exclusive') && !run({ won: true, humans: 3 }).includes('g_vs_network_exclusive'));
  check('a practice win (1 human) does NOT count toward the grind counters', applyVsMatch(emptyVsLife(), { ...base, won: true }, 1).life.wins === 0);
  check('a 2-human win counts: wins 1, winsBy[titan] 1', (() => { const r = applyVsMatch(emptyVsLife(), { ...base, won: true, humans: 2 }, 1).life; return r.wins === 1 && r.winsBy.molo === 1; })());
  // ENSEMBLE CAST: one 2-human win per titan
  let life = emptyVsLife();
  const got: string[] = [];
  const titans: TitanId[] = ['molo', 'voltkite', 'hearthback', 'briarwick'];
  for (let k = 0; k < 4; k++) { const r = applyVsMatch(life, { ...base, titan: titans[k], won: true, humans: 2 }, 2000 + k); life = r.life; got.push(...r.newly); }
  check('ENSEMBLE CAST is earned once over four 2-human wins with four different titans', got.filter((g) => g === 'g_vs_ensemble_cast').length === 1, got);
  check('ENSEMBLE CAST was earned exactly at the 4th win', (() => { let l = emptyVsLife(); const at: number[] = []; for (let k = 0; k < 4; k++) { const r = applyVsMatch(l, { ...base, titan: titans[k], won: true, humans: 2 }, 5 + k); l = r.life; if (r.newly.includes('g_vs_ensemble_cast')) at.push(k); } return at.length === 1 && at[0] === 3; })());
  // RATINGS WAR: the 10th 2-human win; 9 practice wins add nothing
  let l2 = emptyVsLife(); let at10 = -1;
  for (let k = 0; k < 12; k++) { const r = applyVsMatch(l2, { ...base, won: true, humans: 2 }, 9 + k); l2 = r.life; if (r.newly.includes('g_vs_ratings_war')) at10 = k; }
  check('RATINGS WAR lands at the 10th counted win', at10 === 9 && l2.wins === 12, { at10, wins: l2.wins });
  let l3 = emptyVsLife();
  for (let k = 0; k < 12; k++) l3 = applyVsMatch(l3, { ...base, won: true, humans: 1 }, 20 + k).life;
  check('12 practice wins never earn RATINGS WAR / ENSEMBLE CAST', !l3.done.g_vs_ratings_war && !l3.done.g_vs_ensemble_cast && l3.wins === 0);
  check('a goal already earned is not earned twice', applyVsMatch(l2, { ...base, won: true, humans: 2 }, 99).newly.length === 0);
  // sanitize / merge
  check('sanitizeVsLife drops garbage, unknown goals, negative / NaN counters', (() => {
    const s = sanitizeVsLife({ matches: -3, wins: 'x', winsBy: { molo: 5, ghost: 9 }, done: { g_vs_syndicated: 5, g_nope: 7, g_vs_ratings_war: 'z' } });
    return s.matches === 0 && s.wins === 0 && s.winsBy.molo === 5 && !('ghost' in s.winsBy) && s.done.g_vs_syndicated === 5 && !s.done.g_nope && !s.done.g_vs_ratings_war;
  })());
  check('sanitizeVsLife(null / array / string) = empty', [null, [], 'x', 7].every((v) => sanitizeVsLife(v).wins === 0 && Object.keys(sanitizeVsLife(v).done).length === 0));
  check('mergeVsLife: counters max, goals union with the earliest stamp', (() => {
    const a = sanitizeVsLife({ wins: 3, matches: 5, winsBy: { molo: 3 }, done: { g_vs_syndicated: 100 } });
    const b = sanitizeVsLife({ wins: 7, matches: 2, winsBy: { voltkite: 4 }, done: { g_vs_syndicated: 50, g_vs_certified_headline: 60 } });
    const m = mergeVsLife(a, b);
    return m.wins === 7 && m.matches === 5 && m.winsBy.molo === 3 && m.winsBy.voltkite === 4 && m.done.g_vs_syndicated === 50 && m.done.g_vs_certified_headline === 60;
  })());
  // the event tally: crown KO needs the crown event BEFORE the KO
  const tally = new VsEventTally(1);
  const ev = (e: unknown): SimEvent => e as SimEvent;
  tally.feed(ev({ type: 'crown', holder: 2 }));
  tally.feed(ev({ type: 'evicted', victim: 2, killer: 1, assists: [], levelsLost: 3, x: 0, z: 0 }));     // crown KO by me
  tally.feed(ev({ type: 'crown', holder: 0 }));
  tally.feed(ev({ type: 'evicted', victim: 3, killer: 1, assists: [], levelsLost: 2, x: 0, z: 0 }));     // not the crown
  tally.feed(ev({ type: 'evicted', victim: 0, killer: 2, assists: [], levelsLost: 2, x: 0, z: 0 }));     // someone else's KO
  tally.feed(ev({ type: 'evicted', victim: 1, killer: 0, assists: [], levelsLost: 2, x: 0, z: 0 }));     // I was KO'd
  tally.feed(ev({ type: 'eliminated', victim: 0, killer: 1, place: 3 }));                                  // crown holder 0 eliminated by me
  check('VsEventTally: crownKos 2, kos 3, distinct rivals {2,3,0}, deaths 1', tally.crownKos === 2 && tally.kos === 3 && tally.rivalsKo.size === 3 && tally.deaths === 1, { c: tally.crownKos, k: tally.kos, r: [...tally.rivalsKo], d: tally.deaths });
}

// ───────────────────────────── B: real finished worlds ─────────────────────────────
section('B  real finished VS worlds -> payloads (server bounds mirror)');
interface Played { w: World; tally: VsEventTally; ticks: number }
function play(seed: number, biome: BiomeId, lineup: TitanId[], humanSlots: number[], seconds: number, winner: number | null): Played {
  const seats: PlayerSeat[] = lineup.map((t, i) => ({ titan: t, bot: humanSlots.includes(i) ? null : 'regular' }));
  const w = createWorld({ mode: 'vs', players: seats, biome, seed, view: humanSlots[0] ?? 0 });
  const tally = new VsEventTally(humanSlots[0] ?? 0);
  const inputs = new Array(seats.length).fill(null);
  let ticks = 0;
  const limit = w.vs!.startT + seconds;
  while (!w.run.result && w.t < limit) {
    stepWorldN(w, inputs);
    ticks++;
    for (const e of w.events as readonly SimEvent[]) tally.feed(e);
  }
  if (!w.run.result && winner !== null) {
    const n0 = w.events.length;
    endMatch(w, winner);
    for (let i = n0; i < w.events.length; i++) tally.feed(w.events[i]);
  }
  return { w, tally, ticks };
}
function inputFor(p: Played, slot: number, humans: number, uids: (string | null)[], matchId = 'practice:b1:aaaa'): VsMatchInput {
  return { w: p.w, slot, matchId, humans, uidBySlot: uids, tally: slot === 0 ? p.tally : null };
}
const L4: TitanId[] = ['molo', 'voltkite', 'hearthback', 'briarwick'];
const worlds: Played[] = [];
{
  const t0 = Date.now();
  worlds.push(play(1337, 'grideast', L4, [0, 1], 75, 0));          // human seat 0 wins
  worlds.push(play(7, 'whitestacks', L4, [0, 1], 75, 1));          // human seat 1 wins
  worlds.push(play(99, 'lockwater', ['briarwick', 'hearthback', 'voltkite', 'molo'], [0, 1], 60, 3));   // a BOT wins
  console.log(`  (3 short worlds played + ended in ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  for (let k = 0; k < worlds.length; k++) {
    const p = worlds[k];
    const w = p.w;
    check(`world ${k}: decided (result vs, phase over, winner ${w.vs!.winner}, places 1..4)`, w.run.result === 'vs' && w.vs!.phase === 'over' && w.vs!.winner >= 0 && w.players.map((q) => q.vs.place).sort().join() === '1,2,3,4');
    let allOk = true, detail: unknown = null;
    for (let s = 0; s < 4; s++) {
      const human = s < 2;
      const uids = [U1, U2, null, null];
      const inp = inputFor(p, s, 2, uids, `practice:w${k}:aaaa`);
      const pay = buildVsReport(inp, human ? uids[s] : null, 'abc123');
      if (!human) { if (pay !== null) { allOk = false; detail = { slot: s, note: 'a BOT seat must not be reportable' }; } continue; }
      const reason = pay ? RPC.validateRun({ ...pay, mode: 'vs', result: pay.placement === 1 ? 'vs_win' : 'vs_place', run_nonce: pay.run_nonce, clear_s: null, endless_s: 0, endless_score: 0, rematches: 0 }) : 'no payload';
      const P = w.players[s];
      const mine = pay !== null && pay.placement === P.vs.place && pay.titan === P.titanId && pay.biome === w.biomeId && pay.tonnage === Math.round(P.run.tonnage)
        && pay.kills === P.titan.kills && pay.humans === 2 && pay.bots === 2 && pay.match_id === normalizeMatchId(`practice:w${k}:aaaa`);
      if (reason !== null || !mine) { allOk = false; detail = { slot: s, reason, pay }; }
    }
    check(`world ${k}: both human seats' payloads pass the server bounds and carry the seat's own figures; the bot seats are not reportable`, allOk, detail);
  }
  const first = buildVsReport(inputFor(worlds[0], 0, 2, [U1, U2, null, null]), U1, null)!;
  console.log('  sample payload (world 0, seat 0): ' + JSON.stringify(first));
  check('winner payload: placement 1 and claimed_winner = the winner\'s own account id', first.placement === 1 && first.claimed_winner === U1);
  const second = buildVsReport(inputFor(worlds[0], 1, 2, [U1, U2, null, null]), U2, null)!;
  check('loser payload names the winner by the id it heard (U1), not itself', second.placement > 1 && second.claimed_winner === U1);
  const loserDeaf = buildVsReport(inputFor(worlds[0], 1, 2, [U1 as string | null, null, null, null].map((x, i) => (i === 0 ? null : x))), U2, null)!;
  check('loser who never heard the winner\'s id claims null', loserDeaf.claimed_winner === null);
  const botWon = buildVsReport(inputFor(worlds[2], 0, 2, [U1, U2, null, null]), U1, null)!;
  check('a bot winner: both humans claim null', botWon.claimed_winner === null && buildVsReport(inputFor(worlds[2], 1, 2, [U1, U2, null, null]), U2, null)!.claimed_winner === null);
  const noUidWinner = buildVsReport(inputFor(worlds[1], 0, 2, [null, null, null, null]), U1, null)!;
  check('a human winner whose id is unknown (a guest) is claimed as null', noUidWinner.claimed_winner === null);
  const skipped = buildVsReport({ ...inputFor(worlds[0], 0, 2, [U1, U2, null, null]), skip: true }, U1, null);
  check('skip (my seat left / desynced) -> no payload', skipped === null);
  {
    // the server's level / tonnage bounds are solo-fit: a strong VS seat is CAPPED (not rejected); peak_level keeps the real level
    const hi = worlds[0].w.players[0];
    const save = { lv: hi.titan.level, tons: hi.run.tonnage, kills: hi.titan.kills };
    hi.titan.level = 120; hi.run.tonnage = 9e9; hi.titan.kills = 10 ** 8;
    const pay = buildVsReport(inputFor(worlds[0], 0, 2, [U1, U2, null, null]), U1, null)!;
    const reason = RPC.validateRun({ ...pay, result: 'vs_win', clear_s: null, endless_s: 0, endless_score: 0, rematches: 0 });
    hi.titan.level = save.lv; hi.run.tonnage = save.tons; hi.titan.kills = save.kills;
    check('a level / tonnage / kills above the server bound are capped to it (passes the mirror); peak_level keeps the real level', reason === null && pay.level === Math.min(250, 40 + Math.floor(pay.duration_s / 30)) && pay.peak_level === 120 && pay.tonnage === 12_000_000 + 20_000 * pay.duration_s, { reason, pay });
  }
  const w0 = worlds[0].w;
  w0.players[1].vs.data.left = 1;
  const leaver = buildVsReport(inputFor(worlds[0], 1, 2, [U1, U2, null, null]), U2, null);
  const toLeaverWinnerCase = (() => { const x = worlds[1]; x.w.players[1].vs.data.left = 1; const r = buildVsReport(inputFor(x, 0, 2, [U1, U2, null, null]), U1, null); x.w.players[1].vs.data.left = 0; return r; })();
  w0.players[1].vs.data.left = 0;
  check('a seat flagged left reports nothing', leaver === null);
  {
    const x = worlds[0];
    x.w.players[1].vs.data.tookOver = 1;
    const took = buildVsReport(inputFor(x, 1, 2, [U1, U2, null, null]), U2, null);
    const tookFacts = applyVsMatch(emptyVsLife(), { titan: 'voltkite', finished: true, won: false, humans: 2, koCount: 0, evictions: 0, crownKos: 0 }, 1).newly;
    x.w.players[1].vs.data.tookOver = 0;
    check('a human who TOOK OVER a bot seat files nothing (not one of the START humans the server counts); the goals still count locally', took === null && tookFacts.includes('g_vs_syndicated'));
  }
  check('a winner who LEFT is named as null by the others (its seat is a bot now)', toLeaverWinnerCase !== null && toLeaverWinnerCase.claimed_winner === null);
}
if (FULL) {
  const t0 = Date.now();
  const p = play(1337, 'grideast', L4, [], 700, null);              // 4 native bots: realistic figures (an idle human never grows)
  const w = p.w;
  for (const s of [0, 1]) w.players[s].bot = null;                  // ...then read seats 0 and 1 AS human seats (the payload reads the finished world only)
  console.log(`  --full: natural 4-seat match: result ${w.run.result}, winner ${w.vs!.winner}, ended ${((w.run.endT - w.vs!.startT) / 60).toFixed(1)} min, ${p.ticks} ticks, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  check('--full: the natural match was decided', w.run.result === 'vs' && w.vs!.winner >= 0);
  if (w.run.result === 'vs') {
    for (const s of [0, 1]) {
      const pay = buildVsReport(inputFor(p, s, 2, [U1, U2, null, null]), s === 0 ? U1 : U2, 'abc');
      const reason = pay ? RPC.validateRun({ ...pay, result: pay.placement === 1 ? 'vs_win' : 'vs_place', clear_s: null, endless_s: 0, endless_score: 0, rematches: 0 }) : 'no payload';
      check(`--full: seat ${s} payload passes the server bounds at natural magnitudes (dur ${pay?.duration_s}s, lv ${pay?.level}, tons ${pay?.tonnage}, kills ${pay?.kills})`, reason === null, { reason, pay });
    }
  }
}

// ───────────────────────────── C: the rules against the server mirror ─────────────────────────────
section('C  reporting rules against the server mirror (bt_report_vs)');
{
  const P0 = worlds[0];                         // human seat 0 (U1) won; seat 1 (U2) lost
  const uids = [U1, U2, null, null];
  const rep = (db: FakeDb, p: Played, slot: number, humans: number, uid: string | null, ids = uids, mid = 'practice:c:aaaa'): Record<string, unknown> => {
    const pay = buildVsReport(inputFor(p, slot, humans, ids, mid), uid, null);
    return db.report(uid, pay);
  };
  {
    const db = new RPC.FakeBtDb(); db.addProfile(U1); db.addProfile(U2);
    const r1 = rep(db, P0, 0, 2, U1), r2 = rep(db, P0, 1, 2, U2);
    const mid = normalizeMatchId('practice:c:aaaa');
    check('2 humans + 2 bots, reports agree -> 2 bt_vs_results rows + 1 bt_vs_matches row, winner_id = the winner', r1.ok === true && r2.ok === true && db.bt_vs_results.length === 2 && Object.keys(db.bt_vs_matches).length === 1 && db.bt_vs_matches[mid].winner_id === U1, { r1, r2, m: db.bt_vs_matches });
    check('the first report alone does not confirm; the second does', r1.winner_confirmed === false && r2.winner_confirmed === true, { r1, r2 });
    check('vs_wins credited to the winner only, once; both get vs_matches 1; 2 bt_runs rows (mode vs)', db.bt_player_stats[U1].vs_wins === 1 && (db.bt_player_stats[U2].vs_wins ?? 0) === 0 && db.bt_player_stats[U1].vs_matches === 1 && db.bt_player_stats[U2].vs_matches === 1 && db.bt_runs.length === 2 && db.bt_runs.every((r) => r.mode === 'vs'));
    check('a repeat of the same report is {already:true} and changes nothing', (() => { const r = rep(db, P0, 0, 2, U1); return r.ok === true && r.already === true && db.bt_vs_results.length === 2 && db.bt_player_stats[U1].vs_wins === 1; })());
    check('a 3rd human report on a 2-human match is match_full', (() => { db.addProfile(U3); const pay = buildVsReport(inputFor(worlds[0], 0, 2, uids, 'practice:c:aaaa'), U3, null)!; const r = db.report(U3, { ...pay, claimed_winner: null, placement: 3 }); return r.ok === false && r.reason === 'match_full'; })());
  }
  {
    // loser reports first (the order must not matter)
    const db = new RPC.FakeBtDb(); db.addProfile(U1); db.addProfile(U2);
    rep(db, P0, 1, 2, U2); const r = rep(db, P0, 0, 2, U1);
    check('report order does not matter (loser first, winner second -> confirmed)', r.winner_confirmed === true && db.bt_vs_matches[normalizeMatchId('practice:c:aaaa')].winner_id === U1);
  }
  {
    const db = new RPC.FakeBtDb(); db.addProfile(U1); db.addProfile(U2);
    rep(db, worlds[2], 0, 2, U1, uids, 'practice:c:bot1'); rep(db, worlds[2], 1, 2, U2, uids, 'practice:c:bot1');
    const m = db.bt_vs_matches[normalizeMatchId('practice:c:bot1')];
    check('a BOT winner: both rows filed, no winner_id, no vs_wins', db.bt_vs_results.length === 2 && m.winner_id === null && !db.bt_player_stats[U1].vs_wins && !db.bt_player_stats[U2].vs_wins);
  }
  {
    // 1 human + 3 bots: personal stats only
    const db = new RPC.FakeBtDb(); db.addProfile(U1);
    const solo = play(5, 'grideast', L4, [0], 40, 0);
    const r = rep(db, solo, 0, 1, U1, [U1, null, null, null], 'practice:c:solo');
    const st = db.bt_player_stats[U1];
    check('1 human + 3 bots, human wins: filed, NO board win (winner_confirmed false), vs_solo_wins 1, vs_wins 0', r.ok === true && r.winner_confirmed === false && db.bt_vs_matches[normalizeMatchId('practice:c:solo')].winner_id === null && st.vs_solo_wins === 1 && !st.vs_wins && st.vs_matches === 1, { r, st });
  }
  {
    // a guest: files nothing; the signed-in human's report still lands and is not blocked
    const db = new RPC.FakeBtDb(); db.addProfile(U1);
    const guestPay = buildVsReport(inputFor(P0, 1, 2, [U1, null, null, null], 'practice:c:guest'), null, null)!;   // the guest's would-be payload (never sent: guests file nothing)
    check('the guest\'s seat has a payload only as data; the client never sends it (portal.guest -> D)', guestPay.claimed_winner === U1);
    const r = rep(db, P0, 0, 2, U1, [U1, null, null, null], 'practice:c:guest');
    check('a guest in the match: the signed-in winner\'s report is accepted (1 row), unconfirmed (needs 2 humans), nothing is blocked', r.ok === true && db.bt_vs_results.length === 1 && r.winner_confirmed === false && db.bt_vs_matches[normalizeMatchId('practice:c:guest')].humans === 2);
  }
  {
    // disagreement: two humans name different winners -> no winner; a later correct report cannot confirm
    const db = new RPC.FakeBtDb(); db.addProfile(U1); db.addProfile(U2);
    const mid = 'practice:c:dis';
    const a = buildVsReport(inputFor(P0, 0, 2, uids, mid), U1, null)!;                  // U1 won, claims U1
    const b = buildVsReport(inputFor(P0, 1, 2, uids, mid), U2, null)!;                  // U2 lost
    db.report(U1, a);
    const rb = db.report(U2, { ...b, claimed_winner: null });                            // U2 says a bot won: disagreement
    check('a disagreeing report (null vs the winner\'s own claim) -> NO winner_id', rb.ok === true && rb.winner_confirmed === false && db.bt_vs_matches[normalizeMatchId(mid)].winner_id === null, rb);
    const db2 = new RPC.FakeBtDb(); db2.addProfile(U1); db2.addProfile(U2); db2.addProfile(U3);
    const c = db2.report(U2, { ...b, claimed_winner: U2 });                              // U2 claims ITSELF while placed 2nd
    check('claiming yourself while not placed 1st is rejected (claim_mismatch)', c.ok === false && c.reason === 'claim_mismatch', c);
    const d = db2.report(U2, { ...b, claimed_winner: U3, placement: 2 });                // names a third account that never reported
    db2.report(U1, a);
    check('a named winner who reported place 1 but with a different claim cannot be handed the win by a liar', (() => { const m = db2.bt_vs_matches[normalizeMatchId(mid)]; return m.winner_id === null && d.ok === true; })());
    const e = db2.report(U1, { ...a, match_id: normalizeMatchId('practice:c:dis2'), claimed_winner: U2 });
    check('the winner claiming someone else is rejected (claim_mismatch)', e.ok === false && e.reason === 'claim_mismatch', e);
  }
  {
    const db = new RPC.FakeBtDb(); db.addProfile(U1);
    const base = buildVsReport(inputFor(P0, 0, 2, uids, 'practice:c:bad'), U1, null)!;
    const tryP = (patch: Record<string, unknown>): Record<string, unknown> => db.report(U1, { ...base, ...patch, match_id: normalizeMatchId('practice:c:bad' + JSON.stringify(patch).length) });
    check('impossible figures are rejected (tonnage, level, placement, seats)', tryP({ tonnage: 1e12 }).ok === false && tryP({ level: 900 }).ok === false && tryP({ placement: 0 }).ok === false && tryP({ humans: 3, bots: 3 }).ok === false && tryP({ titan: 'godzilla' }).ok === false);
    check('anonymous (no account) -> not_signed_in, nothing written', db.report(null, base).error === 'not_signed_in' && db.bt_vs_results.length === 0);
  }
}

// ───────────────────────────── D: PortalClient on a fake portal frame ─────────────────────────────
section('D  PortalClient on a fake portal frame');
interface Frame { sent: Record<string, unknown>[]; deliver(m: Record<string, unknown>): void; mode: string }
function installWindow(mode: 'signed' | 'guest' | 'silent' | 'noack' | 'standalone', db: FakeDb | null, uid: string, delayWhoamiMs = 0): Frame {
  const g = globalThis as Record<string, unknown>;
  const listeners: ((ev: { source: unknown; data: unknown }) => void)[] = [];
  const frame: Frame = { sent: [], mode, deliver: () => { /* below */ } };
  const parent: Record<string, unknown> = {};
  const win: Record<string, unknown> = {
    parent: mode === 'standalone' ? null : parent,
    addEventListener: (t: string, fn: (ev: { source: unknown; data: unknown }) => void) => { if (t === 'message') listeners.push(fn); },
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (h: number) => clearTimeout(h),
  };
  win.parent = mode === 'standalone' ? win : parent;
  frame.deliver = (m): void => { for (const l of listeners) l({ source: parent, data: m }); };
  const identity = (rid?: unknown): Record<string, unknown> => ({ type: 'forgeflow:identity', ...(rid !== undefined ? { _reqId: rid } : {}), signedIn: mode === 'signed' || mode === 'noack', id: mode === 'guest' ? null : uid, username: 'tester', avatar_url: null, level: 3 });
  parent.postMessage = (m: Record<string, unknown>): void => {
    frame.sent.push(m);
    if (mode === 'silent') return;
    queueMicrotask(() => {
      switch (m.type) {
        case 'forgeflow:whoami': setTimeout(() => frame.deliver(identity(m._reqId)), delayWhoamiMs); break;
        case 'forgeflow:load': frame.deliver({ type: 'forgeflow:save_loaded', _reqId: m._reqId, data: null }); break;
        case 'forgeflow:vs_result': {
          if (mode === 'noack') return;
          if (mode === 'guest' || !db) { frame.deliver({ type: 'forgeflow:vs_result_ack', _reqId: m._reqId, ok: false, error: 'not_signed_in', data: { error: 'not_signed_in' } }); return; }
          const r = db.report(uid, m.payload);
          if (r.ok === false) frame.deliver({ type: 'forgeflow:vs_result_ack', _reqId: m._reqId, ok: false, error: String(r.error), data: r });
          else frame.deliver({ type: 'forgeflow:vs_result_ack', _reqId: m._reqId, ok: true, data: r });
          break;
        }
        default: break;
      }
    });
  };
  g.window = win;
  g.location = { search: '?v=abc123-n0nce' };
  const store = new Map<string, string>();
  g.localStorage = { getItem: (k: string) => (store.has(k) ? store.get(k)! : null), setItem: (k: string, v: string) => { store.set(k, String(v)); }, removeItem: (k: string) => { store.delete(k); } };
  return frame;
}
function mkClient(): PortalClient {
  return new PortalClient({ cloudProfile: false, getProfile: () => emptyProfile(), getBests: () => ({}), adopt: () => { /* none */ } });
}
const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));
const outcomeInput = (slot: number, humans: number, ids: (string | null)[], mid: string, ww = worlds[0]): VsMatchInput => inputFor(ww, slot, humans, ids, mid);
{
  const db = new RPC.FakeBtDb(); db.addProfile(U1);
  const fr = installWindow('signed', db, U1);
  const pc = mkClient();
  pc.start();
  await tick();
  check('signed in: whoami answered, state signedIn', pc.state === 'signedIn' && pc.identity.id === U1);
  const out = pc.vsMatchEnded(outcomeInput(0, 2, [U1, U2, null, null], 'blocktooth:room1:0001'));
  check('vsMatchEnded returns an outcome with goals (SYNDICATED, CERTIFIED HEADLINE, CROSSOVER...)', !!out && out.goals.includes('g_vs_syndicated') && out.goals.includes('g_vs_certified_headline'), out?.goals);
  const f = out ? await out.filing : null;
  const sends = fr.sent.filter((m) => m.type === 'forgeflow:vs_result');
  check('exactly ONE forgeflow:vs_result, its payload = buildVsReport', sends.length === 1 && JSON.stringify(sends[0].payload) === JSON.stringify(buildVsReport(outcomeInput(0, 2, [U1, U2, null, null], 'blocktooth:room1:0001'), U1, 'abc123')), sends.length);
  check('the ack is parsed: filed, 1 report so far, not yet confirmed (needs a 2nd human)', !!f && f.kind === 'ack' && !f.error && f.confirmed === false && f.reports === 1, f);
  const ach = fr.sent.filter((m) => m.type === 'forgeflow:achievement').map((m) => String(m.achievementSlug)).sort();
  check('every earned VS goal posted once as forgeflow:achievement {achievementSlug}', ach.length === out!.goals.length && ach.every((s) => VS_GOAL_BY_ID[s]) && new Set(ach).size === ach.length && out!.goals.every((g) => ach.includes(g)), ach);
  const again = pc.vsMatchEnded(outcomeInput(0, 2, [U1, U2, null, null], 'blocktooth:room1:0001'));
  await tick();
  check('the same match again files nothing (null) and sends no 2nd message', again === null && fr.sent.filter((m) => m.type === 'forgeflow:vs_result').length === 1);
  const out2 = pc.vsMatchEnded(outcomeInput(0, 2, [U1, U2, null, null], 'blocktooth:room1:0002'));
  await out2!.filing;
  check('a different match id files a second report; goals already earned are not re-posted', fr.sent.filter((m) => m.type === 'forgeflow:vs_result').length === 2 && out2!.goals.length === 0 && fr.sent.filter((m) => m.type === 'forgeflow:achievement').length === ach.length);
  const rejected = pc.vsMatchEnded({ ...outcomeInput(0, 2, [U1, U2, null, null], 'blocktooth:room1:0003'), w: (() => { const x = play(3, 'grideast', L4, [0, 1], 30, 0); (x.w as { biomeId: string }).biomeId = 'badcity'; return x.w; })() });
  const rf = rejected ? await rejected.filing : null;
  check('a rejected report surfaces the server reason (bad_biome)', !!rf && rf.kind === 'ack' && !!rf.error && /bad_biome/.test(rf.error), rf);
  check('stats.vsResults = 3 and the vs ledger persisted', pc.stats.vsResults === 3 && JSON.parse((globalThis as unknown as { localStorage: { getItem(k: string): string | null } }).localStorage.getItem('blocktooth.vslife.v1') ?? 'null').matches === 3);
}
{
  const fr = installWindow('guest', null, U1);
  const pc = mkClient();
  pc.start();
  await tick();
  const out = pc.vsMatchEnded(outcomeInput(0, 2, [null, null, null, null], 'blocktooth:guest:0001'));
  const f = out ? await out.filing : 'x';
  await tick();
  const writes = fr.sent.filter((m) => /^forgeflow:(vs_result|achievement|save|run_result|game_over|score)/.test(String(m.type)));
  check('guest: ZERO write messages (no vs_result, no achievement, no save)', writes.length === 0 && f === null, writes.map((m) => m.type));
  check('guest: the goals still land in the local ledger', !!out && out.goals.includes('g_vs_syndicated') && !!pc.vsLedger.done.g_vs_syndicated && pc.vsLedger.matches === 1);
  // the sign-in push: the backfill posts every goal earned as a guest, once
  fr.deliver({ type: 'forgeflow:identity', signedIn: true, id: U1, username: 'tester', avatar_url: null, level: 3 });
  await tick();
  const ach = fr.sent.filter((m) => m.type === 'forgeflow:achievement').map((m) => String(m.achievementSlug));
  check('sign-in after the match: the guest-earned VS goals are posted once (catch-up)', ach.length === Object.keys(pc.vsLedger.done).length && ach.includes('g_vs_syndicated') && new Set(ach).size === ach.length, ach);
}
{
  installWindow('standalone', null, U1);
  const pc = mkClient();
  pc.start();
  const out = pc.vsMatchEnded(outcomeInput(0, 1, [U1, null, null, null], 'blocktooth:alone:0001'));
  check('standalone (no parent): goals saved locally, no filing', !!out && out.goals.length > 0 && (await out.filing) === null && pc.state === 'standalone');
}
{
  const db = new RPC.FakeBtDb(); db.addProfile(U1);
  const fr2 = installWindow('signed', db, U1, 120);
  const pc = mkClient();
  pc.start();
  const out = pc.vsMatchEnded(outcomeInput(0, 2, [U1, U2, null, null], 'blocktooth:early:0001'));      // before whoami is answered
  check('a report made before whoami answers is queued (no message yet)', fr2.sent.filter((m) => m.type === 'forgeflow:vs_result').length === 0);
  const f = out ? await out.filing : null;
  check('...and sent once the identity arrives (the winner now names itself); the ack lands', fr2.sent.filter((m) => m.type === 'forgeflow:vs_result').length === 1 && !!f && f.kind === 'ack' && !f.error, f);
  const sentQ = fr2.sent.find((m) => m.type === 'forgeflow:vs_result');
  check('the queued payload carries the signed-in account id as claimed_winner', !!sentQ && (sentQ.payload as Record<string, unknown>).claimed_winner === U1);
}
{
  const fr = installWindow('silent', null, U1);
  const pc = mkClient();
  pc.start();
  const out = pc.vsMatchEnded(outcomeInput(0, 1, [U1, null, null, null], 'blocktooth:silent:0001'));
  check('silent parent (older portal): nothing but whoami probes is ever sent for the match', !!out && fr.sent.every((m) => m.type === 'forgeflow:whoami' || m.type === undefined));
}

// ───────────────────────────── E: VsIdentityBook ─────────────────────────────
section('E  VsIdentityBook (account ids between the peers)');
{
  // two peers on one fake room bus
  type Cb = (m: { from: string; t: string; d: Record<string, unknown> }) => void;
  const bus: { id: string; cb: Cb | null }[] = [];
  const mkRoom = (id: string, sent: { t: string; d: Record<string, unknown> }[]): RoomLike => {
    const me = { id, cb: null as Cb | null };
    bus.push(me);
    return {
      id,
      send: (t, d) => { sent.push({ t, d: d ?? {} }); for (const o of bus) if (o !== me && o.cb) { const cb = o.cb; queueMicrotask(() => cb({ from: id, t, d: d ?? {} })); } return true; },
      onMsg: (cb) => { me.cb = cb; return () => { me.cb = null; }; },
    };
  };
  const stub = (uid: string | null): PortalClient => ({ identity: { id: uid, signedIn: uid !== null }, signedIn: uid !== null }) as unknown as PortalClient;
  const sentA: { t: string; d: Record<string, unknown> }[] = [], sentB: typeof sentA = [], sentG: typeof sentA = [];
  const A = new VsIdentityBook(stub(U1)), B = new VsIdentityBook(stub(U2)), G = new VsIdentityBook(stub(null));
  A.attach(mkRoom('peerA', sentA), 'blocktooth:room1:0001');
  B.attach(mkRoom('peerB', sentB), 'blocktooth:room1:0001');
  await tick();
  check('A and B hear each other: uidOf(peerB) = U2, uidOf(peerA) = U1, own peer = own id', A.uidOf('peerB') === U2 && B.uidOf('peerA') === U1 && A.uidOf('peerA') === U1);
  check('uid message shape {t:"uid", d:{m, u}} and a few messages only (<= 3 each)', sentA[0]?.t === 'uid' && sentA[0].d.u === U1 && sentA[0].d.m === 'blocktooth:room1:0001' && sentA.length <= 3 && sentB.length <= 3, { a: sentA.length, b: sentB.length });
  G.attach(mkRoom('peerG', sentG), 'blocktooth:room1:0001');
  await tick();
  check('a guest announces nothing and the signed-in peers learn nothing about it', sentG.length === 0 && A.uidOf('peerG') === null && B.uidOf('peerG') === null);
  // a late SIGNED-IN joiner: it announces, A and B answer once each, so it learns both ids
  const sentC: typeof sentA = [];
  const C = new VsIdentityBook(stub(U3));
  C.attach(mkRoom('peerC', sentC), 'blocktooth:room1:0001');
  await tick();
  check('a late signed-in joiner C learns A and B (they answered once) and they learn C', C.uidOf('peerA') === U1 && C.uidOf('peerB') === U2 && A.uidOf('peerC') === U3 && B.uidOf('peerC') === U3, { a: C.uidOf('peerA'), b: C.uidOf('peerB') });
  check('the answers are bounded (<= 4 uid messages per peer in the whole exchange)', sentA.length <= 4 && sentB.length <= 4 && sentC.length <= 4, { a: sentA.length, b: sentB.length, c: sentC.length });
  // wrong match id / junk ignored
  const bus2 = bus.find((b) => b.id === 'peerA');
  bus2?.cb?.({ from: 'peerX', t: 'uid', d: { m: 'blocktooth:OTHER:0009', u: U3 } });
  bus2?.cb?.({ from: 'peerY', t: 'uid', d: { m: 'blocktooth:room1:0001', u: 'not-a-uuid' } });
  bus2?.cb?.({ from: 'peerZ', t: 'result', d: { m: 'blocktooth:room1:0001', u: U3 } });
  await tick();
  check('another match id / a non-uuid / another message type are ignored', A.uidOf('peerX') === null && A.uidOf('peerY') === null && A.uidOf('peerZ') === null);
  check('uidsBySlot maps the roster to seats (bots and unknown = null)', JSON.stringify(A.uidsBySlot([{ slot: 0, peer: 'peerA' }, { slot: 1, peer: 'peerB' }, { slot: 2, peer: null }, { slot: 3, peer: 'peerG' }])) === JSON.stringify([U1, U2, null, null]));
  A.detach();
  check('detach stops listening', A.announce() === false);
}

section('F  resultsMajority (a ghost / diverged peer must not file)');
check('no other result seen -> file', resultsMajority(5, []));
check('everybody agrees -> file', resultsMajority(5, [5, 5]));
check('my hash vs two others shared hash -> the minority (me) does NOT file', !resultsMajority(5, [9, 9]));
check('the majority files when one stray hash exists (H6 ghost case: p0 and p1 agree, p2 stray)', resultsMajority(9, [9, 5]));
check('1 v 1: nobody can tell -> nobody files', !resultsMajority(5, [9]));
check('3 peers, 2 agree with me, 1 stray -> file', resultsMajority(9, [9, 9, 5]));

console.log(`\nprobe_vsreport: ${passes} passed, ${fails} failed${FULL ? ' (--full)' : ''}`);
process.exit(fails > 0 ? 1 : 0);
