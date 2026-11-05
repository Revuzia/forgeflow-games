// GENESIS — postrel SIMFIX r2 (LIVING §13): prayers pause after they lapse, a town that finds the god deaf stops asking,
// and a prophet whose words mostly came true keeps being heard.
// Before: on year-50 saves towns raised 270 prayers in 2 years and 266 lapsed (a town with lasting sickness re-prayed for
// healing every 2 days), the chronicle said 'nothing came' 33 times and 'the god is deaf' 11 times, the deaf line was
// followed the same day by 'In X they pray to the god for healing', and every prophet ended at 0 credibility ('nobody
// listens') — three of the god's words came true, then the prophet's own readings of open prayers failed (-0.25 each) and
// every third lapse took 0.1 more.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Sim } from '../src/sim/sim.ts';
import type { Settlement } from '../src/sim/people/state.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { GODS } from '../src/sim/people/defs.ts';
import { town, must } from './helpers/god.ts';
import { relOf, srel } from '../src/sim/god/regard.ts';
import { foretell } from '../src/sim/god/prophets.ts';
import { DEAF_PAUSE_DAYS, LAPSE_PAUSE_DAYS } from '../src/sim/god/prayers.ts';

function starve(sim: Sim, st: Settlement): void {
  const x = makeCtx(sim.u, sim.u.planets[0]);
  for (const it of x.info[st.species].foods) st.store[it] = 0;
}
const dayT = (sim: Sim) => Math.round(sim.u.planets[0].st.dayHours * 60);
/** hour by hour with the store held empty: the town keeps wanting food */
function hungry(sim: Sim, st: Settlement, hours: number, each?: () => void): void {
  for (let h = 0; h < hours; h++) { starve(sim, st); sim.step(60); each?.(); }
}
const lapseLines = (sim: Sim, st: Settlement) => sim.u.chronicle.filter((e) => e.text.includes(st.name) && /nothing came/.test(e.text)).length;

test('prayers: a lapsed prayer is not asked again for a season, and the chronicle says so once', () => {
  const { sim, st } = town();
  hungry(sim, st, 2);
  const r = srel(sim.u, 0, st.id);
  const pr = r.prayers.find((q) => q.kind === 'food');
  assert.ok(pr, `a prayer for food: ${JSON.stringify(r.prayers)}`);
  pr.until = sim.u.tick + 30;
  // a second kind lapses in the same season: counted, not told again
  r.prayers.push({ id: 9500, kind: 'rebuilding', since: sim.u.tick, until: sim.u.tick + 40, urgency: 0.5, god: 0 });
  const lines0 = lapseLines(sim, st);
  let again = -1;
  const t0 = sim.u.tick;
  hungry(sim, st, Math.round((LAPSE_PAUSE_DAYS * dayT(sim)) / 60) + 30, () => {
    if (again < 0 && sim.u.tick - t0 > 60 && r.prayers.some((q) => q.kind === 'food')) again = sim.u.tick - t0;
  });
  assert.ok(r.lapses >= 2, `both lapsed (${r.lapses})`);
  assert.equal(lapseLines(sim, st) - lines0, 1, 'one "nothing came" line for the season');
  const season = LAPSE_PAUSE_DAYS * dayT(sim);
  assert.ok(again < 0 || again >= season - 60, `the hungry town asked for food again ${(again / dayT(sim)).toFixed(2)} days after the lapse (a season is ${LAPSE_PAUSE_DAYS})`);
  assert.ok(again >= 0, 'after the season the hungry town asks again');
});

test('prayers: a town that finds the god deaf stops asking for two seasons', () => {
  const { sim, st } = town();
  const r = srel(sim.u, 0, st.id);
  r.lapses = 2;
  r.prayers.push({ id: 9600, kind: 'rebuilding', since: sim.u.tick, until: sim.u.tick + 30, urgency: 0.5, god: 0 });
  // (within the first hours the hungry town may still ask for food before the third lapse falls due)
  hungry(sim, st, 2);
  assert.equal(r.lapses, 3, 'the third lapse');
  const raised0 = relOf(sim.u).stats['prayers.raised'] ?? 0;
  hungry(sim, st, 3 * 24);
  assert.ok(sim.u.chronicle.some((e) => e.text.includes(st.name) && /deaf/.test(e.text)), 'they say the god is deaf');
  assert.equal((relOf(sim.u).stats['prayers.raised'] ?? 0) - raised0, 0, `no prayer raised in the days after (the store is empty; pause ${DEAF_PAUSE_DAYS} days)`);
});

/** a called prophet in the town, a little settled in */
function prophetTown() {
  const { sim, st } = town();
  const ps = sim.u.planets[0].people, A = ps.agents;
  const s = (ps.members.get(st.id) ?? []).find((q) => !(A.flags[q] & 1) && A.id[q] !== st.leader && (sim.u.tick - A.birth[q]) / sim.u.planets[0].st.orbit.period >= 18)!;
  const who = A.id[s];
  must(sim, { k: 'prophet.call', agent: who });
  const ph = relOf(sim.u).prophets.find((q) => q.agent === who)!;
  return { sim, st, who, ph };
}

test('prophets: three of four of the god\'s words come true leaves the prophet credible (0.5 or more), with the town\'s prayers lapsing between', () => {
  for (const missAt of [0, 3]) {
    const { sim, st, who, ph } = prophetTown();
    const r = srel(sim.u, 0, st.id);
    const A = sim.u.planets[0].people.agents;
    for (let k = 0; k < 4; k++) {
      // a ruler loyal to the god (no persecution: this is about the words alone)
      const ruler = A.slotOf(st.leader);
      if (ruler >= 0) A.loyalty[ruler * GODS] = 0.9;
      must(sim, { k: 'prophet.foretell', agent: who, what: 'rain', days: 1 });
      if (k !== missAt) must(sim, { k: 'miracle.water', pos: st.pos });
      // the town's prayers go unanswered between the words, and every third is the god found deaf
      r.lapses = 2;
      r.prayers.push({ id: 9700 + k, kind: 'warmth', since: sim.u.tick, until: sim.u.tick + 30, urgency: 0.5, god: 0 });
      sim.step(dayT(sim) + 120);
    }
    assert.equal(ph.fulfilled, 3, `three came true (miss at ${missAt})`);
    assert.ok(ph.credibility >= 0.5, `miss at word ${missAt + 1}: credibility ${ph.credibility} after 3 of 4 (>= 0.5)`);
    // (a new prophet whose first word fails is not listened to for a while: 0.30 -> 0.09; the three that follow win them back)
    if (missAt === 3) assert.ok(!sim.u.chronicle.some((e) => /nobody listens/.test(e.text)), 'still listened to');
  }
});

test('prophets: their own reading of a prayer is put to the god and risks a third of a failed word', () => {
  const { sim, st, ph } = prophetTown();
  ph.credibility = 0.6;
  const x = makeCtx(sim.u, sim.u.planets[0]);
  foretell(x, ph, 'healing', 1, 'prophet');
  assert.ok(sim.u.chronicle.some((e) => e.text.includes(st.name) && /Will the god make (it true|it so)\?/.test(e.text)), 'put to the god as a question');
  sim.step(dayT(sim) + 120);
  assert.equal(ph.failed, 1, 'it failed');
  assert.ok(ph.credibility >= 0.6 - 0.06, `a third of a failed word (0.6 -> ${ph.credibility})`);
  assert.ok(ph.credibility < 0.6, 'but it costs something');
});
