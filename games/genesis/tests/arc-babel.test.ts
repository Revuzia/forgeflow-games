// GENESIS — ARC §6.8 / §8.2 T3, T5: the `babel` scenario. Four towns of one people within 10 km sharing one tongue
// (langDistance 0), 70-110 people each, bronze age, mudbrick known, pride preset to 0.7 with since.arc0 20 years back
// and the tower arm set; a tower is begun within 30 game days, the first `tower.choice` opens within 2 years and the
// league still speaks one speech then. The multi-seed form is _harness/arc-work/probe-babel.sh (4 seeds).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { langDistance } from '../src/sim/people/culture.ts';
import { distM } from '../src/sim/people/world.ts';
import { peekRel } from '../src/sim/god/regard.ts';

test('§6.8 babel: four proud towns of one speech within 10 km, a tower begun within 30 days, the choice within 2 years (T3, T5)', () => {
  const sim = new Sim({ seed: 1, scenario: 'babel', overrides: { n: 20 } });
  const p = sim.u.planets[0];
  const x = makeCtx(sim.u, p);
  const towns = p.people.settlements.filter((s) => !s.band && s.fallen < 0);
  assert.equal(towns.length, 4, 'four towns');
  const knows = x.rt.byId.get('mudbrick')!;
  for (const s of towns) {
    const pop = p.people.members.get(s.id)?.length ?? 0;
    assert.ok(pop >= 70 && pop <= 110, `${s.name}: ${pop} people`);
    assert.equal(s.era, 3, `${s.name}: bronze`);
    assert.ok(s.library.includes(knows), `${s.name}: knows mudbrick`);
    const r = peekRel(sim.u, p.id, s.id)!;
    assert.ok(Math.abs((r.pride ?? 0) - 0.7) < 0.02, `${s.name}: pride ${r.pride}`);
    assert.ok((r.since.arc0 ?? 0) <= -19 * x.year, `${s.name}: arc0 20 years back`);
  }
  for (const a of towns) for (const b of towns) if (a.id < b.id) {
    assert.ok(distM(p, a.pos, b.pos) <= 10000, `${a.name}-${b.name} within 10 km`);
    assert.ok(langDistance(a, b) <= 0.18, `${a.name}-${b.name} one tongue`);
  }
  let begun = -1, choice = -1;
  while (sim.u.tick < 2 * x.year && choice < 0) {
    sim.step(Math.round(x.day / 4));
    for (const e of sim.drainEvents()) if ((e as unknown as { t: string }).t === 'tower.choice' && choice < 0) choice = sim.u.tick;
    if (begun < 0 && sim.u.god.rel?.towers?.length) begun = sim.u.tick;
  }
  assert.ok(begun >= 0 && begun <= 30 * x.day, `begun on day ${begun / x.day}`);
  assert.ok(choice >= 0 && choice <= 2 * x.year, `first choice in year ${choice / x.year}`);
  const tw = sim.u.god.rel!.towers![0];
  assert.equal(tw.status, 'rising');
  assert.ok(tw.league.length >= 2, 'a league');
  const lg = tw.league.map((id) => p.people.settlement(id)!).filter(Boolean);
  for (const a of lg) for (const b of lg) if (a.id < b.id) assert.ok(langDistance(a, b) <= 0.18, 'one speech in the league');
  // the arm is spent once begun (towerDaily never re-arms; the gap and the roll govern later towers)
  for (const s of towns) assert.equal(peekRel(sim.u, p.id, s.id)?.since.towerArm, undefined, `${s.name}: arm spent`);
});
