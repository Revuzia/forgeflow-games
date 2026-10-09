// GENESIS — a meteor on a city (CONTRACT.md §11.3, §19, §21.4): the god calls a star down on a bronze-age town. It
// falls (a live disaster with an altitude the renderer draws), strikes: people die, buildings fall, the survivors are
// terrified, star iron lies in the crater, the chronicle counts the toll. Then the survivors REBUILD — with the
// knowledge that remains: what only the dead knew, and nobody wrote down, stays lost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { town, must, alive, standing, meanFear } from './helpers/god.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { recomputeWritten, refreshLibrary } from '../src/sim/people/knowledge.ts';
import { moveBy, bearingDir } from '../src/sim/god/util.ts';
import { distM } from '../src/sim/people/world.ts';

test('a meteor on a city kills, ruins, terrifies — and the survivors rebuild with the knowledge that remains', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const ps = p.people;
  const A = ps.agents;
  // the town stands on a rise (a coastal town on a coarse test world would drown in the crater's dent)
  must(sim, { k: 'terrain.raise', pos: st.pos, radius: 500, strength: 40 });
  sim.step(30);
  const impact = moveBy(st.pos, bearingDir(st.pos, 1.0), 50, p.st.radius);

  // the one person nearest the impact is the sole keeper of two unwritten ideas: bronze, and star lore (an idea the
  // god invents for the test: nobody can stumble on it again by experiment or accident)
  must(sim, { k: 'content.idea', name: 'star lore', effect: 'faith', mult: 1.2 });
  const x = makeCtx(sim.u, p);
  const lore = x.rt.byId.get('star-lore')!;
  const bronze = x.rt.byId.get('bronze')!;
  assert.ok(lore !== undefined && bronze !== undefined);
  const members = ps.members.get(st.id)!.slice();
  const pt = [0, 0, 0];
  let keeper = members[0], kd = Infinity;
  for (const s of members) { A.posAt(s, sim.tick, pt); const d = distM(p, pt, impact); if (d < kd) { kd = d; keeper = s; } }
  const keeperId = A.id[keeper];
  for (const s of members) { A.setKnows(s, bronze, s === keeper); A.setKnows(s, lore, s === keeper); }
  for (const b of ps.of(st.id)) b.books = b.books.filter((k) => k !== bronze && k !== lore);
  recomputeWritten(x, st);
  refreshLibrary(x, st);
  assert.ok(st.library.includes(bronze) && st.library.includes(lore), 'the town knows both before');
  // what nearly everyone knows (it will survive the dead)
  const common = st.library.find((k) => members.filter((s) => A.knows(s, k)).length >= members.length - 2)!;
  assert.ok(common !== undefined);

  const people0 = alive(sim);
  const standing0 = standing(sim, st.id);
  const fear0 = meanFear(sim, st);
  const c0 = sim.u.chronicle.length;
  const r = must(sim, { k: 'disaster.spawn', kind: 'meteor', pos: impact, radius: 40 });
  const id = r.created![0].id;
  // it falls first: a live disaster with an altitude and a direction for the renderer
  sim.step(5);
  const view = sim.snapshot().planets[0].disasters!.find((d) => d.id === id)!;
  assert.ok(view && view.kind === 'meteor', 'the meteor is in the snapshot');
  assert.ok(view.params.alt > 0 && view.params.alt < 24000, `it is falling (alt ${view.params.alt})`);
  assert.ok(Math.hypot(view.params.dirX, view.params.dirY, view.params.dirZ) > 0.9, 'it has a direction');
  sim.step(40);
  assert.equal(sim.u.god.disaster(id), undefined, 'it struck and is over');

  // it killed, ruined, terrified
  const dead = people0 - alive(sim);
  const standing1 = standing(sim, st.id);
  assert.ok(dead >= 3, `people died (${dead})`);
  assert.ok(alive(sim) >= 8, `there are survivors (${alive(sim)})`);
  assert.ok(standing1 <= standing0 - 4, `buildings fell (${standing0} -> ${standing1})`);
  assert.ok(meanFear(sim, st) > fear0 + 0.3, `the survivors are afraid of the god (${fear0.toFixed(2)} -> ${meanFear(sim, st).toFixed(2)})`);
  assert.equal(A.slotOf(keeperId), -1, 'the keeper of the two ideas died');
  assert.ok(!st.library.includes(bronze) && !st.library.includes(lore), 'and the town lost what only they knew');
  assert.ok(st.library.includes(common), 'what the survivors know remains');
  assert.ok(ps.items.some((g) => x.c.items.list[g.item]?.id === 'meteoric-iron'), 'star iron lies in the crater');
  const lines = sim.u.chronicle.slice(c0).map((e) => e.text);
  assert.ok(lines.some((t) => /Meteor struck Aru: \d+ dead/.test(t)), `the chronicle counts the toll: ${JSON.stringify(lines)}`);
  assert.ok(lines.some((t) => /bronze|star lore/i.test(t)), 'the chronicle names the loss');

  // twelve days on: they rebuilt (with what they still know); the lost ideas stay lost
  sim.step(12 * 1440);
  const standing2 = standing(sim, st.id);
  assert.ok(st.fallen < 0, 'the town still stands');
  assert.ok(standing2 >= standing1 + 3, `the survivors rebuilt (${standing1} -> ${standing2})`);
  assert.ok(!st.library.includes(lore), 'star lore is still lost: nobody alive knows it, nothing was written');
  for (let s = 0; s < A.hi; s++) if (A.alive[s]) assert.ok(!A.knows(s, lore), 'nobody knows star lore');
});
