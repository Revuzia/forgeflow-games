// probe (lane SIM): match lifecycle + mode rules — pre-game countdown and its command gate,
// 'score' kill race (score end, time-limit win, draw), 'core' surrender votes (humans only,
// threshold, failure cooldown), MatchResult shape (players, goldGraph per minute, digest), the
// frozen view after the end, ping rate limit, setup validation.
import { laneSetup, matchCatalog, matchSetup, run, scoreSetup } from './fixtures/match_fixture.ts';
import { check, finish, near, ofType, section } from './fixtures/sim_fixture.ts';
import type { SimEvent } from '../src/contracts/sim.ts';
import { createSim, worldOf, type Sim } from '../src/sim/sim.ts';
import { dealDamage } from '../src/sim/combat.ts';
import { respawnFighter } from '../src/sim/spawn.ts';
import type { World } from '../src/sim/world.ts';

const cat = matchCatalog();
const quiet = { minionWaves: undefined, jungle: false, structures: false };
function capture(w: World, fn: () => void): SimEvent[] { const n = w.events.length; fn(); return w.events.slice(n); }
const kill = (w: World, k: number, v: number): void => { dealDamage(w, w.players[k].ent!, w.players[v].ent!, 1e7, 'true'); };

section('pre-game countdown + command gate', () => {
  const sim = createSim(cat, laneSetup([{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 1 }]), { pregameSeconds: 2 });
  const v = sim.view;
  check('starts in pregame at time −2', v.phase === 'pregame' && near(v.time, -2) && v.tick === 0);
  const e = worldOf(sim).players[0].ent!;
  const x0 = e.x;
  sim.command(0, { type: 'move', x: 60, y: 20 });
  sim.command(0, { type: 'levelUp', slot: 'a1' });
  run(sim, 0.5);
  check('pregame: move dropped, levelUp allowed', near(e.x, x0) && e.slots[0]!.rank === 1);
  const ev = run(sim, 1.6);
  check("goes live at time 0 with announce 'match_start'", v.phase === 'live' && ofType(ev, 'announce').some((a) => a.key === 'match_start' && near(a.t, 0, 0.04)));
  sim.command(0, { type: 'move', x: 60, y: 20 });
  run(sim, 1);
  check('live: moves work', e.x > x0 + 1);
  check('waves count from time 0 (none yet at 1 s)', ofType(ev, 'wave').length === 0);
});

section("'score': first team to killScore", () => {
  const seats = [{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 1 }];
  const sim = createSim(cat, scoreSetup(seats), { pregameSeconds: 0 });
  const w = sim.world;
  for (let i = 0; i < 3; i++) { kill(w, i % 2, 2); respawnFighter(w, w.players[2].ent!); }
  check('PlayerView.score = own kills', w.players[0].score === 2 && w.players[1].score === 1);
  const ev = run(sim, 0.1);
  const end = ofType(ev, 'end')[0];
  check('team 0 reaches 3 kills → wins (reason score)', end && end.result.reason === 'score' && end.result.winningTeam === 0, end?.result);
  check('placements 1 / 2 and won flags', end.result.players.map((p) => `${p.placement}${p.won ? 'w' : 'l'}`).join() === '1w,1w,2l');
});

section("'score': time limit (win and draw)", () => {
  const seats = [{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 1 }];
  const sim = createSim(cat, scoreSetup(seats), { pregameSeconds: 0 });
  const w = sim.world;
  for (const p of w.players) p.ent!.autoAttack = false;
  kill(w, 1, 0);
  run(sim, 91);
  check('at 90 s the team with more kills wins (reason time)', w.result?.reason === 'time' && w.result.winningTeam === 1 && near(w.result.duration, 90, 0.05), w.result);
  const d = createSim(cat, scoreSetup(seats), { pregameSeconds: 0 });
  for (const p of d.world.players) p.ent!.autoAttack = false;
  run(d, 91);
  const r = d.view.result!;
  check('tie at the top: draw — no winner, everyone placed 1, nobody won', r.winningTeam === -1 && r.players.every((p) => p.placement === 1 && !p.won), r);
});

section("'core' surrender votes", () => {
  const humanSeats = [
    { fighter: 'fx_brawler', team: 0, controller: 'human' as const }, { fighter: 'fx_brawler', team: 0, controller: 'human' as const },
    { fighter: 'fx_brawler', team: 0, controller: 'human' as const }, { fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 1 },
  ];
  const sim = createSim(matchCatalog({ rules: quiet }), laneSetup(humanSeats), { pregameSeconds: 0 });
  const w = sim.world;
  sim.command(0, { type: 'surrenderVote', yes: true });
  const ev0 = run(sim, 0.1);
  check('no vote before surrender.earliest (30 s)', !ofType(ev0, 'announce').some((a) => a.key === 'surrender_vote'));
  run(sim, 30);
  sim.command(3, { type: 'surrenderVote', yes: true });
  check('bot seats cannot vote when the team has humans', !ofType(sim.step(), 'announce').some((a) => a.key === 'surrender_vote'));
  sim.command(0, { type: 'surrenderVote', yes: true });
  const ev1 = sim.step();
  const sv = ofType(ev1, 'announce').find((a) => a.key === 'surrender_vote');
  check('vote opens: needed = ceil(0.7 × 3 humans) = 3', !!sv && sv.params?.yes === 1 && sv.params?.needed === 3, sv?.params);
  sim.command(1, { type: 'surrenderVote', yes: false });
  sim.command(2, { type: 'surrenderVote', yes: true });
  const ev2 = run(sim, 0.2);
  check('one no makes 3 yes impossible → fails', ofType(ev2, 'announce').some((a) => a.key === 'surrender_failed') && w.phase === 'live');
  sim.command(0, { type: 'surrenderVote', yes: true });
  check('cooldown after a failed vote', !ofType(run(sim, 0.1), 'announce').some((a) => a.key === 'surrender_vote'));
  run(sim, 60);
  for (const p of [0, 1, 2]) sim.command(p, { type: 'surrenderVote', yes: true });
  const ev3 = run(sim, 0.2);
  const end = ofType(ev3, 'end')[0];
  check('3 yes: surrender — the other team wins', end && end.result.reason === 'surrender' && end.result.winningTeam === 1 &&
    ofType(ev3, 'announce').some((a) => a.key === 'surrender_passed'), end?.result.reason);
});

section('MatchResult + frozen end', () => {
  const seats = [{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_ranger', team: 1 }];
  const sim = createSim(matchCatalog({ rules: { ...quiet, structures: true } }), laneSetup(seats), { pregameSeconds: 0 });
  const w = sim.world;
  for (const p of w.players) p.ent!.autoAttack = false;
  run(sim, 130);
  dealDamage(w, w.players[0].ent!, w.players[1].ent!, 100, 'true');
  const cores = w.entities.filter((e) => e.kind === 'structure' && e.team === 1);
  for (const s of cores) dealDamage(w, w.players[0].ent!, s, 1e7, 'true'); // tower → gate → core, each opening the next
  const ev = sim.step();
  const end = ofType(ev, 'end');
  const r = w.result!;
  check("one 'end' event; view.result; phase ended", end.length === 1 && end[0].result === r && w.phase === 'ended');
  check('result header from the setup', r.matchId === 'fx_match' && r.queue === 'fx_lane_q' && r.mode === 'fx_lane_mode' && r.map === 'fx_lane_map' &&
    r.seed === 4242 && r.catalogVersion === '2026.10.0' && r.reason === 'core' && r.winningTeam === 0);
  check('duration = live seconds', near(r.duration, 130.03, 0.05), r.duration);
  check('goldGraph: 0:00, 1:00, 2:00 samples + the final one', r.goldGraph.length === 4 && r.goldGraph[0] === 0, r.goldGraph);
  const p0 = r.players[0];
  check('PlayerResult fields', p0.player === 0 && p0.team === 0 && p0.fighter === 'fx_brawler' && p0.skin === 'fx_brawler_skin' && p0.controller === 'bot' &&
    p0.damageToFighters === 100 && p0.structureDamage > 0 && p0.items.length === 6 && p0.level === w.players[0].ent!.level && p0.gold === Math.round(w.players[0].goldEarned) &&
    p0.won && p0.placement === 1 && !r.players[1].won && r.players[1].placement === 2, p0);
  check('digest: 8 hex chars', /^[0-9a-f]{8}$/.test(r.digest), r.digest);
  const t = w.tick;
  check('after the end: step() is a no-op returning []', sim.step().length === 0 && w.tick === t && sim.view.phase === 'ended');
  sim.command(0, { type: 'move', x: 1, y: 1 });
  check('commands after the end are ignored', sim.step().length === 0);
});

section('damageLog through the facade (death recap)', () => {
  const sim = createSim(cat, laneSetup([{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_ranger', team: 1 }]), { pregameSeconds: 0 });
  const w = sim.world;
  run(sim, 1);
  dealDamage(w, w.players[1].ent!, w.players[0].ent!, 40, 'true', { ability: 'fx_ranger_a2' });
  run(sim, 1);
  const log = sim.damageLog(0);
  check('recent damage taken, newest last, with source name/def/ability', log.length === 1 && log[0].srcName === 'P1' && log[0].srcDef === 'fx_ranger' &&
    log[0].ability === 'fx_ranger_a2' && near(log[0].amount, 40) && log[0].dtype === 'true', log);
  run(sim, 15);
  check('entries older than 15 s drop out', sim.damageLog(0).length === 0);
});

section('pings (rate limited) + setup validation', () => {
  const sim = createSim(cat, laneSetup([{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 1 }]), { pregameSeconds: 0 });
  for (let i = 0; i < 8; i++) sim.command(0, { type: 'ping', kind: 'danger', x: 50, y: 20 });
  const pings = ofType(sim.step(), 'ping');
  check('ping events carry player/kind/position; at most 5 per 4 s', pings.length === 5 && pings[0].player === 0 && pings[0].kind === 'danger' && pings[0].x === 50);
  let threw = '';
  try { createSim(cat, laneSetup([{ fighter: 'fx_brawler', team: 0, skin: 'fx_ranger_skin' }])); } catch (err) { threw = (err as Error).message; }
  check('a skin of another fighter is rejected', /skin/.test(threw), threw);
  threw = '';
  try { createSim(cat, matchSetup('fx_lane_mode', 'fx_fray_q', 'fx_lane_map', [{ fighter: 'fx_brawler', team: 0 }])); } catch (err) { threw = (err as Error).message; }
  check('a queue of another mode is rejected', /belongs to mode/.test(threw), threw);
  void capture;
});

finish('probe_sim_modes');
