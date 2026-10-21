// GENESIS — LIVING integration (the sim integrator's pass over the five lanes, 2026-10-14): bugs that only showed when
// the lanes' work ran together in the acceptance sessions (_harness/scratch/living/integrate/god.ts), each with the test
// that fails without its fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { town, must } from './helpers/god.ts';
import { Sim } from '../src/sim/sim.ts';
import { MAX_WORK_COST, flowCost } from '../src/sim/people/resources.ts';
import { GODS, NT, TASK, TASK_NAMES, TRAIT } from '../src/sim/people/defs.ts';
import { sunElevation } from '../src/sim/people/world.ts';
import { VESPERS_HIGH, VESPERS_LOW } from '../src/sim/god/relationship.ts';
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

test('integration: evening worship draws the grown at the rate faith and loyalty ask, once an evening each, not only those who happen to decide at dusk', () => {
  // (2026-10-20: the acceptance sessions' quiet towns: once infants no longer prayed, the town's evening worship nearly
  // stopped — only the 4–6 of 23 adults who made a decision inside the 25 minutes of dusk could go, so a faithful town
  // (formula 0.56) sent 9–22 % of its grown to worship. The window is now the evening, and each goes once.)
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const A = p.people.agents;
  for (const s of p.people.members.get(st.id) ?? []) { A.faith[s * GODS] = 0.8; A.loyalty[s * GODS] = 0.4; }
  sim.step(1440);
  const evenings = new Map<number, { adults: Set<number>; went: Map<number, number> }>();
  const prev = new Map<number, number>();
  let formula = 0, fn = 0;
  for (let k = 0; k < 4 * 1440; k += 5) {
    sim.step(5);
    const el = sunElevation(sim.u, p, sim.u.tick, st.pos);
    const inWindow = el > VESPERS_LOW && el < VESPERS_HIGH && sunElevation(sim.u, p, sim.u.tick - 20, st.pos) > el;
    const day = Math.floor((sim.u.tick + 360) / 1440);
    for (const s of p.people.members.get(st.id) ?? []) {
      if (A.flags[s] & 1) continue;
      const id = A.id[s];
      if (inWindow) {
        let e = evenings.get(day);
        if (!e) { e = { adults: new Set(), went: new Map() }; evenings.set(day, e); }
        if (!e.adults.has(id)) {
          e.adults.add(id);
          const i = s * GODS;
          formula += Math.min(1, 0.5 * A.faith[i] + 0.3 * A.loyalty[i] + 0.15 * A.traits[s * NT + TRAIT.piety] * A.faith[i]);
          fn++;
        }
        if (A.task[s] === TASK.worship && prev.get(id) !== TASK.worship) e.went.set(id, (e.went.get(id) ?? 0) + 1);
      }
      prev.set(id, A.task[s]);
    }
  }
  const rates = [...evenings.values()].map((e) => e.went.size / Math.max(1, e.adults.size));
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const asked = formula / fn;
  assert.ok(evenings.size >= 4, `${evenings.size} evenings`);
  assert.ok(mean >= 0.5 * asked, `the grown at evening worship: ${rates.map((r) => r.toFixed(2)).join(', ')} (mean ${mean.toFixed(2)}) where the formula asks ${asked.toFixed(2)}`);
  for (const e of evenings.values()) for (const [id, n] of e.went) assert.equal(n, 1, `agent ${id} went to the evening worship ${n} times in one evening`);
});

test('integration: in a heatwave an infant cools off at home, not on a swim of its own beyond the village', () => {
  // (2026-10-20: the tests' town, day 19 of a quiet run and under a painted heatwave: its infants walked alone to water
  // 400–590 m out — ten hours each way at an infant's pace — slept out there and walked back to eat; their parents spent a
  // fifth of the day going after them)
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const A = p.people.agents;
  must(sim, { k: 'weather.paint', kind: 'heatwave', pos: st.pos, radius: 3000, duration: 2880, intensity: 2 });
  const pt = [0, 0, 0];
  let n = 0, maxD = 0;
  const tasks: Record<string, number> = {};
  for (let t = 0; t < 2880; t += 10) {
    sim.step(10);
    for (const s of p.people.members.get(st.id) ?? []) {
      if ((sim.u.tick - A.birth[s]) / p.st.orbit.period >= 2) continue;
      n++;
      A.posAt(s, sim.u.tick, pt);
      maxD = Math.max(maxD, distM(p, pt, st.pos));
      tasks[TASK_NAMES[A.task[s]]] = (tasks[TASK_NAMES[A.task[s]]] ?? 0) + 1;
    }
  }
  assert.ok(n > 100, `infant samples ${n}`);
  assert.ok(maxD <= st.territory + 30, `an infant went ${Math.round(maxD)} m from the centre (the village is ${Math.round(st.territory)} m): ${JSON.stringify(tasks)}`);
  assert.equal(tasks.camp ?? 0, 0, `infants camping out: ${JSON.stringify(tasks)}`);
});

test('integration: a crater that fills with water over a town moves the town\'s heart to dry ground; the town stays', () => {
  // (2026-10-20, the acceptance sessions, seed 4: the crater of a default-wrath meteor on Aru filled to a 5 m lake over
  // the cell that held 13 of its 15 buildings. The 'flood' discovery accident stamps `recent.flood`, the same key as the
  // abandonment timer, so the town lived 4.6 days in the lake; then it walked away — "Aru fell" — and its 31 people were
  // founded anew 400 m off as Taam in the Hills, their record with their god left behind)
  const sim = new Sim({ seed: 4, scenario: 'sandbox', overrides: { n: 64, vegetation: 1 } });
  must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
  const r = must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 30, era: 'bronze', settled: true });
  const p = sim.u.planets[0];
  const st = p.people.settlement(r.created!.find((e) => e.kind === 'settlement')!.id)!;
  sim.step(1440);
  const c0 = st.cell, name = st.name, n0 = p.people.members.get(st.id)?.length ?? 0;
  // (LIVING RELATIONSHIP, second pass, 2026-10-21: the default meteor bursts in the air now and digs no crater — the
  // god's stone strikes the ground from wrath 0.5 up, god/disasters.ts AIRBURST_W — so the bowl it dug, 84 m across
  // and 14 m deep at the heart, is dug here with the terrain brush; it fills from the town's spring as the crater did:
  // 3.8 m of water at the old heart, the heart moved on the second day, _harness/scratch/living/relationship/live2/bowl.ts)
  must(sim, { k: 'terrain.lower', pos: st.pos, radius: 84, strength: 14 });
  const told: string[] = [];
  for (let d = 0; d < 4; d++) {
    sim.step(1440);
    for (const e of sim.drainEvents()) if (e.t === 'chronicle' && typeof e.text === 'string') told.push(e.text);
  }
  assert.ok(p.f.water[c0] > 2, `the crater over the old heart holds water (${p.f.water[c0].toFixed(2)} m)`);
  assert.equal(st.fallen, -1, `the town fell: ${told.filter((t) => /fell|water/.test(t)).join(' | ')}`);
  assert.equal(st.name, name, 'the same town, by its name');
  assert.ok(st.cell !== c0 && p.f.water[st.cell] < 0.05, `its heart moved to dry ground (water ${p.f.water[st.cell].toFixed(2)} m)`);
  assert.ok((p.people.members.get(st.id)?.length ?? 0) >= n0 - 3, `its people live in it (${p.people.members.get(st.id)?.length} of ${n0})`);
  assert.ok(told.some((t) => /heart|dry ground/.test(t)), `the chronicle tells it: ${told.slice(-6).join(' | ')}`);
});

test('integration: a fished-out water is passed over — by a town\'s fishers and by a hungry band — and nobody fishes an empty pond', async () => {
  // (2026-10-20, the acceptance run, seed 1234 year 21: the town fished its pond to nothing and kept at it; when it fell
  // its band of 25, foraging the sea's way with nothing at hand, went to the nearest water — the same empty pond — and 20
  // of them fished it for four days while 19 starved, with a full lake and land food beyond)
  const { planFish } = await import('../src/sim/people/decide.ts');
  const { stockAt } = await import('../src/sim/people/fishing.ts');
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const x = makeCtx(sim.u, p);
  const A = p.people.agents;
  // a band of the same folk, set down beside the town (unsettled: it fishes the nearest water)
  const r = must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 12, era: 'stone', settled: false, pos: st.pos });
  const band = p.people.settlement(r.created!.find((e) => e.kind === 'settlement')!.id)!;
  assert.ok(band.band, 'a band');
  const x2 = makeCtx(sim.u, p);
  x2.rt.byId.get('fishing');
  // every water within 4 rings of anyone, and every water of the town, fished out
  const thinned = new Set<number>();
  const empty = (c: number) => { const s = stockAt(x2, c); s.S = 0; thinned.add(c); };
  for (const c of st.res?.fish ?? []) empty(c);
  for (const q of [...(p.people.members.get(band.id) ?? []), ...(p.people.members.get(st.id) ?? [])]) {
    for (const c of p.cellsNear([p.grid.pos[A.cell[q] * 3], p.grid.pos[A.cell[q] * 3 + 1], p.grid.pos[A.cell[q] * 3 + 2]], p.edgeM * 4.5)) if (p.f.water[c] > 0.3) empty(c);
  }
  assert.ok(thinned.size > 0, 'waters to fish out');
  // the band and the town may know fishing: let them all
  const k = x2.rt.byId.get('fishing')!;
  if (!band.library.includes(k)) band.library.push(k);
  if (!st.library.includes(k)) st.library.push(k);
  let asked = 0;
  for (const q of [...(p.people.members.get(band.id) ?? []), ...(p.people.members.get(st.id) ?? [])]) {
    if (A.flags[q] & 1) continue;
    const owner = p.people.settlement(A.settlement[q]) ?? undefined;
    const t = planFish(x2, q, owner);
    asked++;
    if (t) assert.ok(!thinned.has(t.target ?? -1), `agent ${A.id[q]} of ${owner?.band ? 'the band' : 'the town'} sent to fish a water fished out (cell ${t.target})`);
  }
  assert.ok(asked > 10);
  void x;
});

test('integration: a pond first fished when it was a puddle has the fish of the lake it became', async () => {
  // (the seed-1234 pond: its water body was taken once, at its first session — 1.1 m deep, capacity 13 fish — and kept;
  // a year later it stood 14 m deep and still held 13 at most)
  const { stockInfo } = await import('../src/sim/people/fishing.ts');
  const { landWorld } = await import('../src/sim/people/ledger.ts');
  const { sim } = town();
  const p = sim.u.planets[0];
  const x = makeCtx(sim.u, p);
  // a cell of a water of some size (a lake, a river, the sea: one whose fish are more than a puddle's 13)
  const W = landWorld(p.people);
  let c = -1;
  let real = { K: 0, S: 0, share: 0 };
  for (let o = 0; o < p.grid.count && c < 0; o++) {
    if (p.f.water[o] < 0.5) continue;
    const r = stockInfo(x, o);
    if (r.K > 60) { c = o; real = r; }
  }
  assert.ok(c >= 0, 'a water of some size');
  // what the first session saw: a puddle of one cell, fished to nothing
  for (const k of Object.keys(W.body)) delete W.body[k];
  for (const k of Object.keys(W.stocks)) delete W.stocks[k];
  W.body[String(c)] = c;
  W.stocks[String(c)] = { K: 13.3, S: 0.1, t: sim.u.tick, n: 1, gone: -1 };
  const now = stockInfo(x, c);
  assert.ok(now.K >= Math.min(real.K, 40), `capacity ${now.K} (the water holds ${real.K})`);
  assert.ok(now.share >= 0.5, `the lake's fish are there: share ${now.share}`);
});

test('integration: an omen feeds the curiosity of those who read it; a fulfilled prophecy raises the prophet\'s standing (LIVING §2.9 outlets, LAND × RELATIONSHIP)', async () => {
  // (LAND exported curiosityGain / statusGain for the omens and prophets of RELATIONSHIP, and neither lane called them:
  // in the 50-year acceptance worlds a fifth to a third of the grown sat at no curiosity at some year ends)
  const { NEED, NN } = await import('../src/sim/people/defs.ts');
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const A = p.people.agents;
  const ms = p.people.members.get(st.id) ?? [];
  // a prophet whose word the god keeps
  const who = commoner(sim, st);
  must(sim, { k: 'prophet.call', agent: who });
  const ps = A.slotOf(who);
  A.needs[ps * NN + NEED.status] = 0;
  must(sim, { k: 'prophet.foretell', agent: who, what: 'rain', days: 2 });
  sim.step(60);
  must(sim, { k: 'miracle.water', pos: st.pos });
  assert.equal(sim.u.god.rel!.prophets.find((q) => q.agent === who)!.fulfilled, 1, 'fulfilled');
  assert.ok(A.needs[ps * NN + NEED.status] >= 0.25, `the prophet's status ${A.needs[ps * NN + NEED.status]}`);
  // an omen read by the town
  for (const s of ms) A.needs[s * NN + NEED.curiosity] = 0;
  must(sim, { k: 'god.omen', settlement: st.id, kind: 'comet' });
  const curious = ms.filter((s) => A.needs[s * NN + NEED.curiosity] >= 0.1).length;
  assert.ok(curious >= ms.length * 0.9, `curiosity fed in ${curious} of ${ms.length}`);
});

test('integration: a prophet whose three prophecies the god makes true wins the town without pinning its trust (LIVING §3.8 "no pinned meter")', () => {
  // (the acceptance sessions, the n = 64 bronze town of seed 2: three prophecies foretold through a called prophet and
  // made true by rain, plenty and mending — trust ended at 0.97 and faith at 1.0; each act kept inside its budget, the
  // run of them pinned the meters. Faith and trust now rise ever more slowly over their upper half (god/regard.ts rise,
  // RISE_TAPER 0.5; with 0.3 trust ended at 0.913, with 0.4 faith at 0.976)
  const sim = new Sim({ seed: 2, scenario: 'sandbox', overrides: { n: 64, vegetation: 1 } });
  must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
  const r = must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 30, era: 'bronze', settled: true });
  const p = sim.u.planets[0];
  const st = p.people.settlement(r.created!.find((e) => e.kind === 'settlement')!.id)!;
  sim.step(1440);
  const A = p.people.agents;
  const mean = (arr: Float32Array) => { const ms = p.people.members.get(st.id) ?? []; return ms.reduce((a, s) => a + arr[s * GODS], 0) / Math.max(1, ms.length); };
  const loy0 = mean(A.loyalty);
  const who = commoner(sim, st);
  must(sim, { k: 'prophet.call', agent: who });
  const acts: [string, Record<string, unknown>][] = [['rain', { k: 'miracle.water', pos: st.pos }], ['food', { k: 'miracle.food', pos: st.pos }], ['healing', { k: 'miracle.heal', pos: st.pos }]];
  for (let day = 0; day < 6; day++) {
    const ph = sim.u.god.rel!.prophets.find((q) => q.agent === who);
    if (day % 2 === 0 && ph) {
      // a silenced prophet is warded first (the god defends its prophet), then speaks
      if (ph.silenced > sim.u.tick) { const pt = [0, 0, 0]; A.posAt(A.slotOf(who), sim.u.tick, pt); sim.applyNow({ k: 'miracle.shield', pos: pt, radius: 60 }); }
      sim.applyNow({ k: 'prophet.foretell', agent: who, what: acts[day / 2][0] as 'rain', days: 2 });
    }
    if (day % 2 === 1) must(sim, acts[(day - 1) / 2][1] as never);
    sim.step(1440);
  }
  const ph = sim.u.god.rel!.prophets.find((q) => q.agent === who)!;
  assert.ok(ph.fulfilled >= 3 && ph.credibility >= 0.7, `credibility ${ph.credibility} after ${ph.fulfilled} fulfilled`);
  const trust = mean(A.love), faith = mean(A.faith), loy = mean(A.loyalty);
  assert.ok(loy >= loy0 + 0.2, `loyalty ${loy0.toFixed(3)} → ${loy.toFixed(3)}`);
  assert.ok(trust <= 0.9, `mean trust ${trust.toFixed(3)}: pinned`);
  assert.ok(faith <= 0.97, `mean faith ${faith.toFixed(3)}: pinned`);
});

test('integration: a town with a temple still builds houses when its people outgrow its beds (only homes have beds)', async () => {
  // (the acceptance run, seed 2 years 25–34: 9 dwellings, 45 beds for 51–61 people, and no house begun in ten years — the
  // planner counted the temple's 20 places, the school's and the mill's as beds; homes are only buildings that shelter)
  const { planConstruction } = await import('../src/sim/people/settlement.ts');
  const { ruin } = await import('../src/sim/people/buildings.ts');
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const x = makeCtx(sim.u, p);
  must(sim, { k: 'settlement.build', settlement: st.id, type: 'temple' });
  const pop = p.people.members.get(st.id)?.length ?? 0;
  const C = sim.u.content.buildings.list;
  // the town's sites given up, and its homes down to fewer beds than people (but with the temple's places, more)
  for (const id of st.sites.slice()) { const b = p.people.building(id); if (b) ruin(x, st, b, 'test'); }
  st.sites.length = 0;
  let kept = 0;
  for (const b of p.people.of(st.id).filter((q) => q.progress >= 1 && !(q.flags & 2)).sort((a, b2) => a.id - b2.id)) {
    const def = C[b.type];
    if (!def.provides.includes('shelter') || def.capacity <= 0) continue;
    if (kept < Math.max(10, pop - 20) && kept + def.capacity < pop) kept += def.capacity; else ruin(x, st, b, 'test');
  }
  assert.ok(kept < pop && kept + 20 >= pop, `beds ${kept} for ${pop} people (with the temple's 20: ${kept + 20})`);
  planConstruction(x, st);
  const homes = st.sites.map((id) => p.people.building(id)!).filter((b) => C[b.type].provides.includes('shelter') && C[b.type].capacity > 0);
  assert.ok(homes.length >= 1, `a house begun: sites ${st.sites.map((id) => C[p.people.building(id)!.type].id).join(', ') || 'none'}`);
});

test('integration: a site under water is given up; a site nothing has reached yet takes a material the store can pay for now', async () => {
  // (the default meteor on seed 1's town, the god sessions: its crater filled, the heart of the town moved, and for a week
  // nothing rose — one site stood 7 m under the new lake, the other was a house begun in mudbrick that no one was making
  // while the store held 30 bricks, 20 stone blocks and 27 timber: 'obtainable', the recipe being known)
  const { planBuilding, reviseSite } = await import('../src/sim/people/buildings.ts');
  const { storeAdd } = await import('../src/sim/people/store.ts');
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const x = makeCtx(sim.u, p);
  const C = sim.u.content;
  const house = C.buildings.idx('house');
  const mud = C.materials.idx('mudbrick'), timber = C.materials.idx('timber');
  assert.ok(house >= 0 && mud >= 0 && timber >= 0);
  // the store: no mudbrick, timber enough for a house; and they know how to make mudbrick (so it stays 'obtainable')
  st.store[C.items.idx('mudbrick')] = 0;
  storeAdd(x, st, C.items.idx('timber'), 40);
  for (const id of ['clay-digging', 'mudbrick', 'carpentry']) { const k = x.rt.byId.get(id)!; if (!st.library.includes(k)) st.library.push(k); }
  const b = planBuilding(x, st, house, false, mud)!;
  assert.ok(b && C.materials.list[b.material].id === 'mudbrick');
  assert.ok(reviseSite(x, st, b), 'the site stands');
  assert.notEqual(C.materials.list[b.material].id, 'mudbrick', 'begun again in what the store holds');
  assert.ok(st.sites.includes(b.id));
  // a site under water
  const w = planBuilding(x, st, house, false, mud)!;
  p.f.water[w.cell] = 3;
  assert.equal(reviseSite(x, st, w), false, 'given up');
  assert.ok(!st.sites.includes(w.id) && !p.people.building(w.id), 'gone from the sites');
});

test('integration: a fire season strikes a cell as often on a small world as on a large one (the rate is per cell, not per world)', async () => {
  // (HEAT_STRIKES_PER_HOUR was drawn per world: a cell of an n = 12 world was struck 28 times as often as one of the
  // n = 64 world it was set on — found when a wetter cure let the strikes through and a living start's people learned
  // fire within its first hours, tests/scenarios.test.ts 'barren: the milestones ...')
  const { HEAT_CELLS } = await import('../src/sim/fields/weather.ts');
  const perCellHour = (n: number): { rate: number; strikes: number } => {
    const sim = new Sim({ seed: 11, scenario: 'sandbox', overrides: { n, vegetation: 1 } });
    must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
    const p = sim.u.planets[0], f = p.f;
    const savanna = sim.u.content.biomes.idx('savanna');
    const land: number[] = [];
    for (let c = 0; c < p.count; c++) if (!p.s.ocean[c]) land.push(c);
    let strikes = 0;
    const hours = 48;
    for (let k = 0; k < hours * 6; k++) {
      // every land cell cured savanna in its dry season (the hourly climate pass would move them)
      for (const c of land) { f.water[c] = 0; f.snow[c] = 0; f.precip[c] = 0; f.moisture[c] = 0.08; f.wetness[c] = 0; f.temperature[c] = 28; f.grass[c] = 0.9; f.shrub[c] = 0.3; f.tree[c] = 0.1; f.biome[c] = savanna; f.fire[c] = 0; }
      sim.step(10);
      for (const e of sim.drainEvents()) if (e.t === 'lightning' && (e.data as { dry?: number } | undefined)?.dry === 2) strikes++;
    }
    return { rate: strikes / land.length / hours, strikes };
  };
  const small = perCellHour(16), large = perCellHour(32);
  assert.ok(HEAT_CELLS > 0 && small.strikes > 20 && large.strikes > 20, `strikes ${small.strikes} / ${large.strikes}`);
  const ratio = small.rate / large.rate;
  assert.ok(ratio > 0.6 && ratio < 1.6, `a cell of the n = 16 world is struck ${ratio.toFixed(2)} times as often as one of the n = 32 world`);
});
