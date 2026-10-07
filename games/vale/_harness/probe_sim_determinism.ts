// probe (lane SIM): determinism through the facade — the same setup + the same command stream
// gives the same MatchResult.digest and the same event stream; a different seed gives a different
// digest; the order commands arrive in within a tick (between seats) does not matter.
import { fraySetup, laneSetup, matchCatalog } from './fixtures/match_fixture.ts';
import { fixtureBots } from './fixtures/fixture_bot.ts';
import { check, finish, section } from './fixtures/sim_fixture.ts';
import type { Command, MatchSetup } from '../src/contracts/sim.ts';
import { createSim } from '../src/sim/sim.ts';
import { matchDigest } from '../src/sim/modes/match.ts';
import { hashString } from '../src/sim/rng.ts';

const cat = matchCatalog();
const laneSeats = [
  { fighter: 'fx_juggernaut', team: 0 }, { fighter: 'fx_brawler', team: 0, controller: 'human' as const },
  { fighter: 'fx_brawler', team: 1 }, { fighter: 'fx_ranger', team: 1 },
];

/** a scripted "human" on seat 1: deterministic commands at fixed ticks */
function script(tick: number): Command[] {
  const out: Command[] = [];
  if (tick === 10) out.push({ type: 'buy', item: 'fx_sword' });
  if (tick % 90 === 0) out.push({ type: 'move', x: 30 + (tick % 7) * 9, y: 18 + (tick % 5), attackMove: true });
  if (tick % 150 === 45) out.push({ type: 'cast', slot: 'a1' });
  if (tick % 400 === 7) out.push({ type: 'levelUp', slot: 'a1' });
  return out;
}

function playLane(setup: MatchSetup, reverseSubmit = false): { digest: string; events: string; ticks: number } {
  const sim = createSim(cat, setup, { bots: fixtureBots((s) => (s.team === 0 ? 'push' : 'defend')) });
  let h = 0x811c9dc5;
  let n = 0;
  while (sim.view.phase !== 'ended' && n < 30 * 60 * 10) {
    const cmds = script(sim.view.tick).map((c) => ({ p: 1, c }));
    if (sim.view.tick % 60 === 3) cmds.push({ p: 0, c: { type: 'ping', kind: 'push', x: 50, y: 20 } });
    for (const { p, c } of reverseSubmit ? cmds.slice().reverse() : cmds) sim.command(p, c);
    for (const e of sim.step()) h = hashString(e.e === 'end' ? `end:${e.result.digest}` : JSON.stringify(e), h);
    n++;
  }
  return { digest: sim.view.result?.digest ?? matchDigest(sim.world, null), events: h.toString(16), ticks: n };
}

section('full lane match (bots + a scripted human seat)', () => {
  const a = playLane(laneSetup(laneSeats, { seed: 99 }));
  const b = playLane(laneSetup(laneSeats, { seed: 99 }));
  const c = playLane(laneSetup(laneSeats, { seed: 100 }));
  console.log(`  info: seed 99 → ${a.digest} in ${a.ticks} ticks; seed 100 → ${c.digest} in ${c.ticks} ticks`);
  check('same seed + same commands ⇒ same digest', a.digest === b.digest, [a.digest, b.digest]);
  check('…and the very same event stream', a.events === b.events && a.ticks === b.ticks, [a.events, b.events]);
  check('different seed ⇒ different digest', a.digest !== c.digest, [a.digest, c.digest]);
  const d = playLane(laneSetup(laneSeats, { seed: 99 }), true);
  check('command arrival order within a tick does not matter (queue is per seat)', d.digest === a.digest, [d.digest, a.digest]);
});

section('Fray: scripted brawl', () => {
  const play = (seed: number): string => {
    const sim = createSim(cat, fraySetup(6, { seed }), { pregameSeconds: 1 });
    for (let t = 0; t < 30 * 60 && sim.view.phase !== 'ended'; t++) {
      if (t % 45 === 0) for (let p = 0; p < 6; p++) sim.command(p, { type: 'move', x: 25 + ((p * 7 + t) % 9) - 4, y: 25 + ((p * 5 + t) % 7) - 3, attackMove: true });
      if (t % 100 === 50) for (let p = 0; p < 6; p++) sim.command(p, { type: 'cast', slot: 'a1' });
      if (t === 2) for (let p = 0; p < 6; p++) sim.command(p, { type: 'levelUp', slot: 'a1' });
      sim.step();
    }
    return sim.view.result?.digest ?? matchDigest(sim.world, null);
  };
  const a = play(5), b = play(5), c = play(6);
  check('same seed ⇒ same digest', a === b, [a, b]);
  check('different seed ⇒ different digest', a !== c, [a, c]);
});

finish('probe_sim_determinism');
