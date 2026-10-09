// GENESIS — CONTRACT.md §21.1 acceptance, sim only (Node): from the barren start the god breathes air onto the dead
// rock, pours seas, sows grass and forests, sets a people down and gives them fire, then leaves the world running
// fast. A settlement must invent something the player never placed, and the chronicle must say so.
//
// "Leave it at 100x" is the worker stepping the same deterministic ticks as fast as it can; here `sim.step` does that
// directly. The world is the real `barren` scenario (Cinder, 30 h days, a 9.6-day year) at grid n = 32 to keep the test
// to well under a minute; the browser shots (_harness/specs/integration.json) take the same path on the full n = 64.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import type { Command, SimEvent } from '../src/sim/types.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { siteScore } from '../src/sim/people/settlement.ts';

function must(sim: Sim, cmd: Command) {
  const r = sim.applyNow(cmd);
  assert.ok(r.ok, `${cmd.k}: ${r.msg}`);
  return r;
}

test('barren rock → air → water → plants → people → fire → left running: a settlement invents what nobody gave it', (t) => {
  const sim = new Sim({ seed: 20260, scenario: 'barren', overrides: { n: 32 } });
  const u = sim.u;
  const p = u.planets[0];
  const day = p.st.dayHours * 60;
  const meanT = () => {
    let s = 0, a = 0;
    for (let c = 0; c < p.count; c++) { s += p.f.temperature[c] * p.grid.area[c]; a += p.grid.area[c]; }
    return s / a;
  };
  const count = (f: (c: number) => boolean) => { let n = 0; for (let c = 0; c < p.count; c++) if (f(c)) n++; return n; };

  // the dead world: no air, no water, nothing growing, nobody
  assert.equal(p.st.atmosphere.pressure, 0, 'airless');
  assert.equal(count((c) => p.f.water[c] > 0.05), 0, 'dry');
  assert.equal(count((c) => p.f.grass[c] + p.f.shrub[c] + p.f.tree[c] > 0.05), 0, 'bare');
  assert.equal(p.people.settlements.length, 0, 'empty');
  const cold = meanT();

  // 1. air — then let the greenhouse warm the rock (rain on frozen ground would only lay snow: STATUS "barren")
  must(sim, { k: 'planet.add-air', amount: 1 });
  for (let d = 0; d < 14 && meanT() < 12; d++) sim.step(day);
  assert.ok(p.airy, 'there is air');
  assert.ok(meanT() > 10, `the air warmed the world: ${cold.toFixed(1)} → ${meanT().toFixed(1)} °C`);

  // 2. water — a world-wide storm fills the low places while the sea level is raised
  must(sim, { k: 'weather.global', kind: 'storm' });
  must(sim, { k: 'water.sea-level', value: -40 });
  sim.step(day);
  must(sim, { k: 'weather.global', kind: 'none' });
  sim.step(2 * day);
  const wet = count((c) => p.f.water[c] > 0.1);
  assert.ok(wet > p.count * 0.05, `seas and lakes: ${wet} wet cells of ${p.count}`);

  // 3. plants — grass over a hemisphere, berry scrub and two forests; they hold where water and warmth allow
  must(sim, { k: 'life.plant', species: 'meadow-grass', lat: 0, lon: 0, radius: 12000, density: 0.8 });
  must(sim, { k: 'life.plant', species: 'berry-bush', lat: 10, lon: -30, radius: 1800, density: 0.5 });
  must(sim, { k: 'life.forest', lat: 10, lon: -30, radius: 1400 });
  must(sim, { k: 'life.forest', lat: -20, lon: 20, radius: 1400 });
  sim.step(3 * day);
  const green = count((c) => p.f.grass[c] + p.f.shrub[c] + p.f.tree[c] > 0.3);
  assert.ok(green > p.count * 0.1, `green land: ${green} cells`);

  // 4. people — set down where the player would: the best place to live on the world (water, food, wood, mild)
  const x = makeCtx(u, p);
  let best = -1, bs = -Infinity;
  for (let c = 0; c < p.count; c++) { const v = siteScore(x, 0, c); if (v > bs) { bs = v; best = c; } }
  assert.ok(bs > 3, `somewhere worth living (site score ${bs.toFixed(2)})`);
  const pos = [p.grid.pos[best * 3], p.grid.pos[best * 3 + 1], p.grid.pos[best * 3 + 2]];
  const r = must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 30, pos } as Command);
  const sid = r.created!.find((e) => e.kind === 'settlement')!.id;
  const st = p.people.settlement(sid)!;
  assert.ok(st.band, 'a band, looking for a place to live');

  // 5. fire — the god's gift (refusable; a fresh band takes it)
  must(sim, { k: 'idea.teach', knowledge: 'fire-keeping', settlement: sid } as Command);
  must(sim, { k: 'idea.teach', knowledge: 'fire-making', settlement: sid } as Command);
  const given = new Set(st.library);
  sim.drainEvents();
  const c0 = u.chronicle.length;

  // 6. leave it running: three of Cinder's years
  const invented: SimEvent[] = [];
  let lit = false;
  for (let d = 0; d < 30; d++) {
    sim.step(day);
    for (const e of sim.drainEvents()) {
      const data = e.data as { settlement?: number; how?: string; knowledge?: string } | undefined;
      if (e.t === 'discovery' && data?.settlement === sid && data.how !== 'god') invented.push(e);
    }
    lit ||= st.nightLight > 0;
  }

  // 7. come back: they settled, live on, keep a fire, and know things nobody gave them — and the chronicle says so
  assert.ok(!st.band && st.founded >= 0 && st.fallen < 0, `a settlement stands: ${st.name}`);
  const alive = p.people.members.get(sid)?.length ?? 0;
  assert.ok(alive >= 15, `${alive} living`);
  assert.ok(lit, 'a hearth burned at night');
  const ownIdeas = st.library.filter((k) => !given.has(k)).map((k) => x.rt.list[k].id);
  assert.ok(ownIdeas.length >= 3, `they worked out ${ownIdeas.join(', ')}`);
  assert.ok(invented.length >= 3, `${invented.length} discoveries of their own`);
  const lines = u.chronicle.slice(c0).filter((e) => e.kind === 'discovery' && e.refs?.some((r) => r.kind === 'settlement' && r.id === sid));
  assert.ok(lines.length >= 3, `the chronicle tells of it (${lines.length} lines)`);
  for (const e of invented) {
    const k = String((e.data as { knowledge: string }).knowledge);
    assert.ok(!given.has(x.rt.byId.get(k)!), `${k} was not given`);
  }
  // the chronicle names something they invented, not something placed
  const names = invented.map((e) => String(e.text).toLowerCase());
  assert.ok(lines.some((e) => names.some((n) => e.text.toLowerCase().includes(n))), 'a chronicle line names an invention');
  for (const e of u.chronicle.slice(c0)) t.diagnostic(`[${e.kind}] Year ${e.year}, day ${e.day}: ${e.text}`);
});
