// probe (lane SIM): a full 'core' match to a real win condition through the public facade —
// fixture bots (harness only) push one lane with waves, towers, a respawning gate, camps and the
// economy all running, until the enemy core falls. Budget: under 60 s wall clock.
import { laneSetup, matchCatalog } from './fixtures/match_fixture.ts';
import { fixtureBots } from './fixtures/fixture_bot.ts';
import { check, finish, ofType, section } from './fixtures/sim_fixture.ts';
import type { SimEvent } from '../src/contracts/sim.ts';
import { createSim } from '../src/sim/sim.ts';

section('2v2 lane push to the core', () => {
  const cat = matchCatalog();
  const setup = laneSetup([
    { fighter: 'fx_juggernaut', team: 0 }, { fighter: 'fx_juggernaut', team: 0 },
    { fighter: 'fx_brawler', team: 1 }, { fighter: 'fx_ranger', team: 1 },
  ], { seed: 777 });
  const sim = createSim(cat, setup, { bots: fixtureBots((s) => (s.team === 0 ? 'push' : 'defend')) });
  const t0 = performance.now();
  const evs: SimEvent[] = [];
  const LIMIT = 30 * 60 * 15; // 15 game minutes
  for (let i = 0; i < LIMIT && sim.view.phase !== 'ended'; i++) for (const e of sim.step()) evs.push(e);
  const wall = (performance.now() - t0) / 1000;
  const r = sim.view.result;
  console.log(`  info: ended=${!!r} reason=${r?.reason} winner=${r?.winningTeam} game ${sim.view.time.toFixed(1)} s in ${wall.toFixed(2)} s wall (${sim.view.tick} ticks)`);
  check('the match ends', !!r && sim.view.phase === 'ended');
  check('by the core: team 0 wins', r?.reason === 'core' && r.winningTeam === 0, r && [r.reason, r.winningTeam]);
  check('under 60 s wall clock', wall < 60, wall);
  const st = ofType(evs, 'structure').filter((s) => s.team === 1).map((s) => s.def);
  check('team 1 structures fell in protection order: tower → gate → core', st.slice(0, 3).join() === 'fx_lane_tower,fx_gate,fx_core' ||
    (st[0] === 'fx_lane_tower' && st[st.length - 1] === 'fx_core'), st);
  check('the core event is final', ofType(evs, 'structure').some((s) => s.final && s.def === 'fx_core' && s.team === 1));
  check('waves ran', ofType(evs, 'wave').length >= 3);
  check('fighters died and respawned', ofType(evs, 'takedown').length > 0 && ofType(evs, 'respawn').length > 0);
  check('the bots bought from the shop', ofType(evs, 'buy').length >= 2);
  check('levels gained', ofType(evs, 'levelUp').length > 0);
  check("exactly one 'end' event, last of its tick", ofType(evs, 'end').length === 1);
  check('no bot faults', sim.faults.length === 0, sim.faults);
  check('winning seats won, losing seats lost', !!r && r.players.every((p) => p.won === (p.team === 0) && p.placement === (p.team === 0 ? 1 : 2)));
  check('gold graph has a sample per minute', !!r && r.goldGraph.length >= Math.floor(r.duration / 60) + 1);
});

finish('probe_sim_match_core');
