// GENESIS — ARC §8 determinism of the whole arc (Lane C verify): babel world, the scripted arc (a flood-offer, the
// no-flood covenant, the tower, the covenant broken by a cast sent with 'break', a defiant town and its storm, the tower
// confused at the first choice), saved at year 40 and loaded, run to year 80: the state hash equals a straight run to 80.
// Also: the epithet cache (story.ts) gives exactly what the uncached scan gives, tick after tick, through the run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { epithetOf, epithetUncached } from '../src/sim/god/story.ts';

interface Run { sim: Sim; log: string[]; stage: number; defTown: number; broke: number }

/** one scripted-arc driver; every action keys off the sim's own tick and state, so a loaded copy repeats it exactly */
function drive(r: Run, endTick: number, onStep?: (sim: Sim) => void): void {
  const sim = r.sim;
  const p = sim.u.planets[0], ps = p.people!;
  const day = Math.max(60, Math.round(p.st.dayHours * 60)), year = Math.max(day, Math.round(p.st.orbit.period));
  const host = () => ps.settlements.filter((s) => s.fallen < 0 && !s.band).sort((a, b) => (ps.members.get(b.id)?.length ?? 0) - (ps.members.get(a.id)?.length ?? 0) || a.id - b.id)[0];
  while (sim.u.tick < endTick) {
    sim.step(Math.min(day, endTick - sim.u.tick));
    onStep?.(sim);
    const yr = sim.u.tick / year;
    for (const e of sim.drainEvents() as { t: string }[]) {
      if (e.t === 'tower.choice' && r.stage === 3) { r.log.push(`y${yr.toFixed(1)} confuse ${sim.applyNow({ k: 'tower.confuse' } as never).ok}`); r.stage = 4; }
    }
    const R = sim.u.god.rel!;
    const h = host();
    if (r.stage === 0 && sim.u.tick >= 60) {
      if (r.stage === 0 && h) { r.log.push(`y${yr.toFixed(1)} offer ${sim.applyNow({ k: 'covenant.offer', settlement: h.id } as never).ok}`); r.stage = 1; }
    } else if (r.stage === 1 && sim.u.tick >= 4 * day) {
      r.log.push(`y${yr.toFixed(1)} make ${sim.applyNow({ k: 'covenant.make', vow: 'no-flood' } as never).ok}`); r.stage = 2;
    } else if (r.stage === 2 && (R.towers?.length ?? 0) > 0) r.stage = 3;
    else if (r.stage === 4 && yr >= 12) {
      const t = ps.settlements.find((s) => s.fallen < 0 && !s.band);
      if (t) {
        r.defTown = t.id;
        sim.applyNow({ k: 'defiance.set', settlement: t.id, value: 0.7 } as never);
        sim.applyNow({ k: 'pride.set', settlement: t.id, value: 0.7 } as never);
        r.log.push(`y${yr.toFixed(1)} defiance.set ${t.id}`);
      }
      r.stage = 5;
    } else if (r.stage === 5 && yr >= 14 && h) {
      // the storm on a defiant town (defiance), then the cast that breaks the covenant (the break)
      const t = ps.settlement(r.defTown) ?? h;
      sim.applyNow({ k: 'miracle.storm', pos: [...t.pos], radius: 350, wrath: 0.4 } as never);
      r.log.push(`y${yr.toFixed(1)} storm`); r.stage = 6;
    } else if (r.stage === 6 && yr >= 16 && h) {
      const res = sim.applyNow({ k: 'miracle.lightning', pos: [...h.pos], wrath: 0.7, covenant: 'break' } as never);
      r.broke = (R.covenants ?? []).some((c) => c.status === 'broken') ? 1 : 0;
      r.log.push(`y${yr.toFixed(1)} break ${res.ok} broken=${r.broke}`); r.stage = 7;
    } else if (r.stage === 7 && yr >= 20) {
      const t = ps.settlement(r.defTown);
      if (t && t.fallen < 0) sim.applyNow({ k: 'defiance.answer', settlement: t.id, how: 'mercy' } as never);
      r.stage = 8;
    }
  }
}

const fresh = (): Run => ({ sim: new Sim({ seed: 1, scenario: 'babel', overrides: { n: 20 } }), log: [], stage: 0, defTown: -1, broke: 0 });
const yearTicks = (sim: Sim): number => { const p = sim.u.planets[0]; const day = Math.max(60, Math.round(p.st.dayHours * 60)); return Math.max(day, Math.round(p.st.orbit.period)); };

test('arc scenario: save at year 40, load, run to year 80 equals a straight run to year 80', { timeout: 1_800_000 }, () => {
  const straight = fresh();
  const yr = yearTicks(straight.sim);
  const seen = { cached: 0 };
  const trace: string[] = [], trace2: string[] = [];
  const TR = !!process.env.ARC_TRACE; // ARC_TRACE=1: hash every day of the second half in both runs and name the first day that differs
  const watch = (sim: Sim): void => {
    if (TR && sim.u.tick > 40 * yr) trace.push(sim.hash());
    // the epithet cache agrees with the uncached scan on every sampled step (every day to year 3, then each year)
    const p = sim.u.planets[0];
    if (sim.u.tick < 3 * yr || sim.u.tick % yr < Math.max(60, Math.round(p.st.dayHours * 60))) {
      assert.equal(epithetOf(sim.u, p.id), epithetUncached(sim.u, p.id), `epithet at tick ${sim.u.tick}`);
      seen.cached++;
    }
  };
  // one straight run, saved on the way past year 40 (saving must not disturb the run) ...
  drive(straight, 40 * yr, watch);
  const hash40 = straight.sim.hash();
  const bytes = straight.sim.save();
  assert.equal(straight.sim.hash(), hash40, 'saving does not change the state');
  const b: Run = { ...straight, sim: Sim.load(bytes), log: [...straight.log] };
  assert.equal(b.sim.hash(), hash40, 'the load is the state that was saved');
  drive(straight, 80 * yr, watch);
  const hashStraight = straight.sim.hash();
  assert.ok(seen.cached > 50);
  // ... and the load of that save, run on to year 80
  drive(b, 80 * yr, TR ? (sim) => { trace2.push(sim.hash()); } : undefined);
  if (TR) { const i = trace.findIndex((h, k) => h !== trace2[k]); console.log('ARC_TRACE first differing day after year 40:', i, 'of', trace.length); }
  assert.equal(b.sim.hash(), hashStraight, 'the loaded run reaches the same hash at year 80');
  assert.deepEqual(b.log, straight.log, 'the same scripted acts at the same times');

  // what the arc did end to end (the scenario must really have run the arc, not idled)
  const R = straight.sim.u.god.rel!;
  const ages = (straight.sim.query('ages', { planet: 0 }) as { kind: string }[]).map((x) => x.kind);
  assert.ok((R.towers?.length ?? 0) >= 1, 'a tower was begun');
  assert.ok((R.covenants ?? []).length >= 1, 'a covenant was made');
  assert.ok(ages.length >= 3, `ages: ${ages.join(',')}`);
  console.log('ARC-SCENARIO', JSON.stringify({ log: straight.log, ages, covenants: (R.covenants ?? []).map((c) => c.status), towers: (R.towers ?? []).map((t) => t.status) }));
});
