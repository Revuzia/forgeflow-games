// GENESIS — LIVING integration (the sim integrator's pass over the five lanes, 2026-10-14): bugs that only showed when
// the lanes' work ran together in the acceptance sessions (_harness/scratch/living/integrate/god.ts), each with the test
// that fails without its fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { town, must } from './helpers/god.ts';
import { Sim } from '../src/sim/sim.ts';
import { MAX_WORK_COST, flowCost } from '../src/sim/people/resources.ts';
import { TASK, TASK_NAMES } from '../src/sim/people/defs.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { distM } from '../src/sim/people/world.ts';
import { ROAD_CAMP_TICKS, paceSleep, walkTicks } from '../src/sim/perf/pace.ts';
import type { Settlement } from '../src/sim/people/state.ts';

/** a grown member of the town who is not its ruler */
function commoner(sim: Sim, st: Settlement): number {
  const ps = sim.u.planets[0].people;
  const A = ps.agents;
  const s = (ps.members.get(st.id) ?? []).find((q) => !(A.flags[q] & 1) && A.id[q] !== st.leader && (sim.u.tick - A.birth[q]) / sim.u.planets[0].st.orbit.period >= 18);
  assert.ok(s !== undefined, 'a grown commoner');
  return A.id[s];
}

test('integration: one snapshot carries every LIVING view the UI team builds against (LIVING §6.5), and no creature', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const who = commoner(sim, st);
  must(sim, { k: 'prophet.call', agent: who });
  must(sim, { k: 'settlement.sacred', settlement: st.id, animal: 'deer' });
  // hardship that moves them to pray: their larder emptied
  for (const it of [...Array(sim.u.content.items.list.length).keys()]) if ((sim.u.content.items.list[it].food ?? 0) > 0) st.store[it] = 0;
  sim.step(1440);
  const snap = sim.snapshot();
  assert.equal((snap as unknown as { creatures?: unknown }).creatures, undefined, 'no creature view');
  assert.ok(snap.lapseLevel === 0, 'lapseLevel');
  assert.equal(typeof snap.regard, 'number');
  assert.equal(typeof snap.wrath, 'number');
  const ps = snap.planets.find((q) => q.id === p.id)!;
  const sv = (ps.settlements ?? []).find((v) => v.id === st.id)!;
  assert.ok(sv, 'the town');
  for (const k of ['faith', 'fear', 'trust', 'loyalty'] as const) assert.ok(sv.regard![k] >= 0 && sv.regard![k] <= 1, `regard.${k}`);
  assert.ok(Array.isArray(sv.prayers) && sv.prayers.length > 0 && sv.prayers.some((q) => q.kind === 'food'), `prayers ${JSON.stringify(sv.prayers)}`);
  assert.equal(sv.prophet?.agent, who);
  assert.ok(sv.sacred && sv.sacred.animal === 'deer', `sacred ${JSON.stringify(sv.sacred)}`);
  assert.ok(sv.livelihood && typeof sv.livelihood.under15 === 'number', 'livelihood');
  assert.equal(typeof sv.eraLabel, 'string');
  // the movers: flags2 marks the prophet
  const ab = ps.agents!;
  assert.ok(ab.flags2 instanceof Uint8Array && ab.flags2.length >= ab.count, 'flags2');
  const i = Array.from(ab.id.subarray(0, ab.count)).indexOf(who);
  assert.ok(i >= 0 && (ab.flags2[i] & 1) === 1, 'the prophet bit');
  // the queries the panels read
  for (const q of ['pace', 'ledger', 'regard', 'prayers', 'prophets', 'sacred', 'omens', 'sigils', 'ores', 'materials', 'content', 'polities']) {
    const r = sim.query(q) as { error?: string } | null;
    assert.ok(r && !(r as { error?: string }).error, `query ${q}`);
  }
});

test('integration: a sign foretold through a prophet is fulfilled by the Signs power (god.omen), as by an omen made with any other power', () => {
  // (the omen session of the acceptance run: the comet was read, the prophet's word "a sign within two days" was made true
  // by a rainbow sent with god.omen — and the prophecy failed, because god.omen never counted as the god's act of a sign)
  const { sim, st } = town();
  const who = commoner(sim, st);
  must(sim, { k: 'prophet.call', agent: who });
  const ph = sim.u.god.rel!.prophets.find((q) => q.agent === who)!;
  const c0 = ph.credibility;
  must(sim, { k: 'prophet.foretell', agent: who, what: 'sign', days: 2 });
  sim.step(120);
  must(sim, { k: 'god.omen', settlement: st.id, kind: 'comet' });
  assert.equal(ph.fulfilled, 1, 'the sign came as foretold');
  assert.equal(sim.u.god.rel!.stats['prophecies.fulfilled'], 1);
  assert.ok(ph.credibility > c0 + 0.1, `credibility ${c0} → ${ph.credibility}`);
  // a sign the people see far off (a lightning omen by another town) is no sign for this one
  const { sim: s2, st: t2 } = town();
  const w2 = commoner(s2, t2);
  must(s2, { k: 'prophet.call', agent: w2 });
  must(s2, { k: 'prophet.foretell', agent: w2, what: 'sign', days: 2 });
  const p2 = s2.u.planets[0];
  const far = [...Array(p2.grid.count).keys()].find((c) => !p2.s.ocean[c] && p2.f.water[c] < 0.1 && Math.acos(Math.min(1, p2.grid.pos[c * 3] * t2.pos[0] + p2.grid.pos[c * 3 + 1] * t2.pos[1] + p2.grid.pos[c * 3 + 2] * t2.pos[2])) * p2.st.radius > 6000);
  assert.ok(far !== undefined, 'a place far from the town');
  s2.applyNow({ k: 'god.omen', pos: [p2.grid.pos[far! * 3], p2.grid.pos[far! * 3 + 1], p2.grid.pos[far! * 3 + 2]], kind: 'lightning' });
  assert.equal(s2.u.god.rel!.prophets.find((q) => q.agent === w2)!.fulfilled, 0, 'a far sign does not fulfil it');
});

test('integration: infants neither pray nor wander off, even in a town at prayer in hardship (they sleep, rest, eat and keep by their people)', () => {
  // (the acceptance run's day slices: the under-twos of a town in hardship — no play or chores for them yet — spent 17 % of
  // the day praying, and once kept from it, 13 % wandering)
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const A = p.people.agents;
  // hardship that moves them to pray: a drought on the town
  must(sim, { k: 'disaster.spawn', kind: 'drought', pos: st.pos });
  sim.step(720);
  const age = (s: number) => (sim.u.tick - A.birth[s]) / p.st.orbit.period;
  const tasks: Record<string, number> = {};
  let infants = 0, older = 0, olderPray = 0;
  for (let k = 0; k < 144; k++) {
    sim.step(10);
    for (const s of p.people.members.get(st.id) ?? []) {
      const t = TASK_NAMES[A.task[s]];
      if (age(s) < 2) { infants++; tasks[t] = (tasks[t] ?? 0) + 1; } else if (!(A.flags[s] & 1)) { older++; if (t === 'pray' || t === 'worship') olderPray++; }
    }
  }
  assert.ok(infants > 0, 'the town has infants');
  assert.ok(olderPray / older > 0.01, `the grown pray and worship in hardship (${olderPray}/${older})`);
  assert.equal((tasks.pray ?? 0) + (tasks.worship ?? 0), 0, `infants praying: ${JSON.stringify(tasks)}`);
  assert.equal(tasks.wander ?? 0, 0, `infants wandering: ${JSON.stringify(tasks)}`);
});

test('integration: a material the god introduces to a town has its vein within the town\'s work reach, and the town mines it', () => {
  // (the acceptance sessions, n = 64 worlds: the vein was laid on the high ground 150–380 m out — beyond the walking reach
  // of work on 3 of 4 worlds (flow cost 450–520 against 280), and nobody mined it in 10 days)
  const sim = new Sim({ seed: 2, scenario: 'sandbox', overrides: { n: 64, vegetation: 1 } });
  must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
  const r = must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 30, era: 'bronze', settled: true });
  const p = sim.u.planets[0];
  const st = p.people.settlement(r.created!.find((e) => e.kind === 'settlement')!.id)!;
  sim.step(600);
  must(sim, { k: 'content.material', name: 'mithril', settlement: st.id });
  const oi = sim.u.content.ores.idx('mithril');
  let reach = Infinity;
  for (let c = 0; c < p.grid.count; c++) if (p.f.oreType[c] === oi + 1 && p.f.ore[c] > 0.05) reach = Math.min(reach, flowCost(st, c));
  assert.ok(reach <= MAX_WORK_COST, `the nearest vein cell costs ${reach} to reach (work reach ${MAX_WORK_COST})`);
  sim.step(2880);
  const ore = sim.u.content.items.idx('mithril-ore');
  assert.ok((st.store[ore] ?? 0) > 0, `mithril ore mined in two days: ${st.store[ore] ?? 0}`);
});

test('integration: every lane\'s god act replays deterministically — rewound to a keyframe and lived again, the world hashes alike', () => {
  // prophets, prophecy, wrath, an invented material and crop, a drought with its prayer answered, an omen, painted weather,
  // sacred animal and place, a meteor with its warning: rewound to before them (the keyframe, then the logged commands
  // replayed) or between them, and the later acts made again at their ticks, the world is the same world
  const { sim, st } = town();
  const who = commoner(sim, st);
  const t0 = sim.u.tick;
  const plan: [number, Record<string, unknown>[]][] = [
    [t0 + 30, [{ k: 'prophet.call', agent: who }, { k: 'prophet.foretell', agent: who, what: 'sign', days: 2 }, { k: 'set', path: 'god.wrath', value: 0.5 }]],
    [t0 + 60, [{ k: 'content.material', name: 'mithril', settlement: st.id }, { k: 'content.plant', name: 'sunroot', type: 'crop' }, { k: 'settlement.introduce', settlement: st.id, crop: 'sunroot' }]],
    [t0 + 120, [{ k: 'disaster.spawn', kind: 'drought', pos: st.pos }, { k: 'god.omen', settlement: st.id, kind: 'comet' }, { k: 'weather.paint', kind: 'thunderstorm', pos: st.pos, radius: 600, duration: 240, intensity: 2 }]],
    [t0 + 900, [{ k: 'prayer.answer', settlement: st.id }, { k: 'settlement.sacred', settlement: st.id, animal: 'deer' }, { k: 'place.sacred', pos: st.pos, kind: 'site' }]],
    [t0 + 3000, [{ k: 'disaster.spawn', kind: 'meteor', pos: st.pos }]],
  ];
  const T = t0 + 3400;
  const live = (s: Sim, from: number) => {
    for (const [t, cmds] of plan) {
      if (t < from) continue;
      s.step(t - s.u.tick);
      for (const c of cmds) { const r = s.applyNow(c as never); assert.ok(r.ok, `${c.k}: ${r.msg}`); }
    }
    s.step(T - s.u.tick);
  };
  live(sim, 0);
  const H = sim.hash();
  const bytes = sim.save();
  for (const back of [T - 300, t0 + 500, t0 + 10]) {
    const c = Sim.load(bytes);
    assert.ok(c.rewind(back), `rewind to ${back}`);
    live(c, back);
    assert.equal(c.hash(), H, `rewound to ${back} and lived again`);
  }
});

test('integration: at night a villager inside their own village walks home to bed, however long the way; only beyond it do they camp', () => {
  // (the acceptance run, year 50: a town of a hundred spans more than the 45 minutes' walk of the road-camp rule, and 36 of
  // its 49 adults slept out in the square after the evening worship and the festival, every night)
  const sim = new Sim({ seed: 1, scenario: 'sandbox', overrides: { n: 64, vegetation: 1 } });
  must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
  const r = must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 30, era: 'bronze', settled: true });
  const p = sim.u.planets[0];
  const st = p.people.settlement(r.created!.find((e) => e.kind === 'settlement')!.id)!;
  sim.step(60);
  const x = makeCtx(sim.u, p);
  const A = p.people.agents;
  const s = (p.people.members.get(st.id) ?? []).find((q) => !(A.flags[q] & 1) && A.home[q] >= 0 && p.people.building(A.home[q]))!;
  assert.ok(s !== undefined, 'a grown villager with a home');
  const bed = p.people.building(A.home[s])!;
  // the place in the village farthest from their bed, and a place well beyond the village
  const G = p.grid.pos;
  let inside = -1, far = -1, bd = -1;
  for (const c of p.cellsNear(st.pos, st.territory + 400)) {
    if (p.s.ocean[c] || p.f.water[c] > 0.3) continue;
    const q = [G[c * 3], G[c * 3 + 1], G[c * 3 + 2]];
    const dc = distM(p, q, st.pos), db = distM(p, q, bed.pos);
    if (dc <= st.territory && db > bd) { bd = db; inside = c; }
    if (dc > st.territory + 250 && far < 0) far = c;
  }
  assert.ok(inside >= 0 && far >= 0);
  const put = (c: number) => A.place(s, G[c * 3], G[c * 3 + 1], G[c * 3 + 2], sim.u.tick);
  put(inside);
  assert.ok(walkTicks(x, s, [G[inside * 3], G[inside * 3 + 1], G[inside * 3 + 2]], bed.pos) > ROAD_CAMP_TICKS, `the way home is long (${Math.round(bd)} m)`);
  assert.equal(paceSleep(x, s, st, true, 480), null, 'inside the village: home to bed');
  put(far);
  assert.equal(paceSleep(x, s, st, true, 480)?.kind, TASK.camp, 'far beyond it: a camp where night fell');
});
