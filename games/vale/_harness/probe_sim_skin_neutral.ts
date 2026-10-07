// probe (lane SIM; CONTRACT §0 "Cosmetics never change stats"): the same seed and commands with
// different skins give identical digests; skins are only echoed into views and results.
import { laneSetup, matchCatalog, riftSetup } from './fixtures/match_fixture.ts';
import { fixtureBots } from './fixtures/fixture_bot.ts';
import { check, finish, section } from './fixtures/sim_fixture.ts';
import type { MatchResult, MatchSetup } from '../src/contracts/sim.ts';
import { createSim } from '../src/sim/sim.ts';
import { matchDigest } from '../src/sim/modes/match.ts';

const cat = matchCatalog();
function play(setup: MatchSetup, maxSec: number): { digest: string; result: MatchResult | null; skins: string[] } {
  const sim = createSim(cat, setup, { bots: fixtureBots((s) => (s.team === 0 ? 'push' : 'defend')) });
  for (let t = 0; t < maxSec * 30 && sim.view.phase !== 'ended'; t++) sim.step();
  return { digest: sim.view.result?.digest ?? matchDigest(sim.world, null), result: sim.view.result, skins: sim.view.players.map((p) => p.skin) };
}

section('lane match to the end', () => {
  const seats = (alt: boolean) => [
    { fighter: 'fx_juggernaut', team: 0, skin: alt ? 'fx_juggernaut_alt' : undefined }, { fighter: 'fx_juggernaut', team: 0 },
    { fighter: 'fx_brawler', team: 1, skin: alt ? 'fx_brawler_alt' : undefined }, { fighter: 'fx_ranger', team: 1, skin: alt ? 'fx_ranger_alt' : undefined },
  ];
  const a = play(laneSetup(seats(false), { seed: 31 }), 600);
  const b = play(laneSetup(seats(true), { seed: 31 }), 600);
  check('both matches end', !!a.result && !!b.result);
  check('different skins ⇒ identical digest', a.digest === b.digest, [a.digest, b.digest]);
  check('skins are echoed into PlayerView and PlayerResult', b.skins[0] === 'fx_juggernaut_alt' && a.skins[0] === 'fx_juggernaut_skin' &&
    b.result!.players[2].skin === 'fx_brawler_alt' && a.result!.players[2].skin === 'fx_brawler_skin');
  const fighterEnt = (setupAlt: boolean) => {
    const sim = createSim(cat, laneSetup(seats(setupAlt)));
    return sim.view.entities.find((e) => e.kind === 'fighter')!;
  };
  check('EntityView.skin echoes the seat skin', fighterEnt(true).skin === 'fx_juggernaut_alt' && fighterEnt(false).skin === 'fx_juggernaut_skin');
});

section('5v5 three-lane, 3 game minutes', () => {
  const a = play(riftSetup({ seed: 8, skins: 'base' }), 180);
  const b = play(riftSetup({ seed: 8, skins: 'alt' }), 180);
  check('different skins ⇒ identical digest (10 seats, waves, camps, structures)', a.digest === b.digest, [a.digest, b.digest]);
});

finish('probe_sim_skin_neutral');
