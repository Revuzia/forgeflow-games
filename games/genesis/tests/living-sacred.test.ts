// GENESIS — LIVING §3.4.5-3.4.7 regression guards (fix r1 #23): the sacred mechanics that ran without a test — a
// pilgrimage season to a sacred place within a day's walk, a prophet's shrine, a prophet risen on their own after a sign
// (and confirmed by the next one), a martyr's grave that becomes a pilgrimage site, and the god's hand on a sacred
// species (culled: trust falls and fear rises; multiplied: trust rises).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Sim } from '../src/sim/sim.ts';
import { town, must } from './helpers/god.ts';
import { GODS, MEMK, NT, TRAIT } from '../src/sim/people/defs.ts';
import { AgentFlag } from '../src/sim/types.ts';
import { offsetPoint, distM, isLand } from '../src/sim/people/world.ts';
import { srel } from '../src/sim/god/regard.ts';
import type { Settlement } from '../src/sim/people/state.ts';

const rel = (sim: Sim) => sim.u.god.rel!;
const stat = (sim: Sim, k: string) => rel(sim).stats[k] ?? 0;

/** a settlement's mean fear and trust toward the player god */
function means(sim: Sim, sid: number): { fear: number; trust: number; faith: number } {
  const ps = sim.u.planets[0].people;
  const A = ps.agents;
  const m = ps.members.get(sid) ?? [];
  let e = 0, t = 0, f = 0;
  for (const s of m) { e += A.fear[s * GODS]; t += A.love[s * GODS]; f += A.faith[s * GODS]; }
  const n = Math.max(1, m.length);
  return { fear: e / n, trust: t / n, faith: f / n };
}

/** grown members of the town who do not rule it (ids) */
function commoners(sim: Sim, st: Settlement): number[] {
  const ps = sim.u.planets[0].people;
  const A = ps.agents;
  const yr = sim.u.planets[0].st.orbit.period;
  return (ps.members.get(st.id) ?? []).filter((q) => !(A.flags[q] & AgentFlag.child) && A.id[q] !== st.leader && (sim.u.tick - A.birth[q]) / yr >= 18).map((q) => A.id[q]);
}

/** a dry spot `m` metres from the town's heart */
function dryNear(sim: Sim, st: Settlement, m: number): number[] {
  const p = sim.u.planets[0];
  for (let k = 0; k < 12; k++) {
    const at = offsetPoint(st.pos, m, k * 0.52, p.st.radius, [0, 0, 0]);
    if (p.f.water[p.cellAt(at)] <= 0.1 && isLand(p, p.cellAt(at))) return [at[0], at[1], at[2]];
  }
  assert.fail('a dry spot near the town');
}

/** hold the ruler loyal (no persecution in these tests unless it asks for one) */
function loyalRuler(sim: Sim, st: Settlement, v = 0.9): void {
  const A = sim.u.planets[0].people.agents;
  const r = A.slotOf(st.leader);
  if (r >= 0) A.loyalty[r * GODS] = v;
}

test('sacred: after a hardship passes, 10-30 % of the adults walk to a sacred place within a day\'s walk and pray there', () => {
  const { sim, st } = town();
  const A = sim.u.planets[0].people.agents;
  must(sim, { k: 'place.sacred', pos: dryNear(sim, st, 700), kind: 'grove' });
  const pl = rel(sim).places[0];
  assert.ok(pl && pl.settlement === st.id, 'the town keeps the grove');
  // a hardship that has just passed (sacred.ts pilgrimageDaily: relief = it was ≥ 0.8, now < 0.3)
  const r = srel(sim.u, 0, st.id);
  r.since.wasHard = 1;
  r.since.hard = 0;
  const adults = commoners(sim, st).length + 1;
  sim.step(2 * 1440);
  const share = r.since.pilgrimShare ?? 0;
  assert.ok(share >= 0.1 && share <= 0.3, `a season's share is 10-30 %: ${share}`);
  const ps = sim.u.planets[0].people;
  const went = (ps.members.get(st.id) ?? []).filter((s) => { for (let m = 0; m < 8; m++) if (A.memKind[s * 8 + m] === MEMK.pilgrimage && A.memA[s * 8 + m] === pl.id) return true; return false; });
  assert.ok(stat(sim, 'pilgrims') >= 2 && went.length >= 2, `pilgrims prayed at the grove: stat ${stat(sim, 'pilgrims')}, remembered by ${went.length}`);
  assert.ok(went.length <= Math.ceil(0.35 * adults), `no more than the season's share went: ${went.length} of ${adults} adults`);
  assert.ok(went.every((s) => !(A.flags[s] & AgentFlag.child)), 'only adults go');
  // the control: the same town and grove with no hardship passed (and no feast day in these two days) sends nobody
  const ctl = town();
  must(ctl.sim, { k: 'place.sacred', pos: dryNear(ctl.sim, ctl.st, 700), kind: 'grove' });
  ctl.sim.step(2 * 1440);
  assert.equal(stat(ctl.sim, 'pilgrims'), 0, 'no season, no pilgrims');
});

test('sacred: a credible prophet founds a shrine at a sacred place; one below 0.5 does not', () => {
  const run = (cred: number) => {
    const { sim, st } = town();
    // a grove hallowed 1.5 km out, far from any shrine the town has (a shrine within 1 km of the place: none is built)
    must(sim, { k: 'place.sacred', pos: dryNear(sim, st, 1500), kind: 'grove' });
    const who = commoners(sim, st)[0];
    must(sim, { k: 'prophet.call', agent: who });
    const ph = rel(sim).prophets.find((q) => q.agent === who)!;
    ph.credibility = cred;
    for (let d = 0; d < 2; d++) { loyalRuler(sim, st); sim.step(1440); }
    const ps = sim.u.planets[0].people;
    const shrines = ps.buildings.filter((b) => sim.u.content.buildings.list[b.type].id === 'shrine');
    return { sim, st, ph, shrines };
  };
  const hi = run(0.55);
  assert.ok(hi.ph.shrine > 0, `the prophet founded a shrine (ph.shrine ${hi.ph.shrine})`);
  assert.ok(hi.shrines.length >= 1 && stat(hi.sim, 'shrines') >= 1, 'a shrine stands');
  const mine = hi.shrines.find((b) => b.id === hi.ph.shrine);
  assert.ok(mine, 'the prophet\'s shrine is a building of the town');
  const place = rel(hi.sim).places.find((q) => distM(hi.sim.u.planets[0], q.pos, mine!.pos) < 1000);
  assert.ok(place, 'the shrine stands at a sacred place');
  assert.ok(hi.sim.u.chronicle.some((e) => e.refs?.some((r) => r.kind === 'agent' && r.id === hi.ph.agent) && /shrine/i.test(e.text)), 'the chronicle tells of the shrine');
  const lo = run(0.45);
  assert.ok(lo.ph.shrine < 0 && stat(lo.sim, 'shrines') === 0, `below 0.5 no shrine (ph.shrine ${lo.ph.shrine})`);
});

test('prophets: a pious person who sees a sign may rise as a prophet; the god\'s next sign over them confirms them', () => {
  const { sim, st } = town();
  const ps = sim.u.planets[0].people;
  const A = ps.agents;
  // a pious town (sacred.ts riseProphet: piety ≥ 0.75, p = 0.15 a person for a sky omen)
  for (const s of ps.members.get(st.id) ?? []) A.traits[s * NT + TRAIT.piety] = 0.85;
  must(sim, { k: 'god.omen', settlement: st.id, kind: 'comet' });
  const ph = rel(sim).prophets.find((q) => q.how === 'risen');
  assert.ok(ph, 'a prophet rose after the comet');
  assert.equal(stat(sim, 'prophets.risen'), 1);
  assert.ok(!ph!.confirmed && ph!.credibility <= 0.2, `unconfirmed, little believed: ${ph!.credibility}`);
  assert.ok(sim.u.chronicle.some((e) => e.kind !== 'command' && /prophet/i.test(e.text)), 'the chronicle tells of the risen prophet');
  // the god's next sign, over them, within 2 days
  sim.step(120);
  const s = A.slotOf(ph!.agent);
  const at = [0, 0, 0];
  A.posAt(s, sim.u.tick, at);
  must(sim, { k: 'god.omen', settlement: st.id, kind: 'rainbow', pos: at });
  assert.ok(ph!.confirmed && ph!.credibility >= 0.3, `confirmed: credibility ${ph!.credibility}`);
});

test('prophets: a credible prophet killed by a cruel ruler leaves a martyr\'s grave that becomes a pilgrimage site', () => {
  const { sim, st } = town();
  const ps = sim.u.planets[0].people;
  const A = ps.agents;
  const who = commoners(sim, st)[0];
  must(sim, { k: 'prophet.call', agent: who });
  const ph = rel(sim).prophets.find((q) => q.agent === who)!;
  // the third persecution (prophets.ts persecute: stage 3, ruler aggression > 0.7, the town's fear > 0.7) kills
  ph.persecution = 2;
  const before = means(sim, st.id).faith;
  let dead = -1;
  for (let h = 0; h < 20 * 24 && dead < 0; h++) {
    ph.credibility = Math.max(ph.credibility, 0.7);
    const r = A.slotOf(st.leader);
    if (r >= 0) { A.traits[r * NT + TRAIT.aggression] = 1; A.loyalty[r * GODS] = 0.05; }
    for (const s of ps.members.get(st.id) ?? []) A.fear[s * GODS] = Math.max(A.fear[s * GODS], 0.85);
    sim.step(60);
    const s = A.slotOf(who);
    if (s < 0 || !A.alive[s]) dead = h;
  }
  assert.ok(dead >= 0, 'the ruler killed the prophet within 20 days');
  const grave = rel(sim).places.find((q) => q.by === 'martyr');
  assert.ok(grave && grave.kind === 'site', 'a martyr\'s grave is a sacred place');
  assert.equal(grave!.settlement, st.id, 'the town keeps it');
  assert.ok(sim.u.chronicle.some((e) => /martyr|killed the prophet/i.test(e.text)), 'the chronicle tells of the martyr');
  assert.ok(means(sim, st.id).faith > before, `the town that knew them believes more: ${before.toFixed(3)} → ${means(sim, st.id).faith.toFixed(3)}`);
});

test('sacred animals: the god culling a town\'s sacred species costs trust and raises fear; multiplying it raises trust', () => {
  const run = (sacred: boolean, k: 'life.cull' | 'life.spawn-animal') => {
    const { sim, st } = town();
    if (sacred) must(sim, { k: 'settlement.sacred', settlement: st.id, animal: 'deer' });
    const at = dryNear(sim, st, 700);
    // a town that trusts its god somewhat and fears it a little (room for trust to fall and fear to rise)
    const ps = sim.u.planets[0].people;
    for (const s of ps.members.get(st.id) ?? []) { ps.agents.love[s * GODS] = 0.5; ps.agents.fear[s * GODS] = 0.2; }
    const m0 = means(sim, st.id);
    const res = sim.applyNow(k === 'life.cull' ? { k, species: 'deer', pos: at, radius: 800 } : { k, species: 'deer', pos: at, count: 6 });
    assert.ok(res.ok, res.msg);
    const m1 = means(sim, st.id);
    return { sim, dTrust: m1.trust - m0.trust, dFear: m1.fear - m0.fear };
  };
  const cull = run(true, 'life.cull'), cullCtl = run(false, 'life.cull');
  assert.equal(stat(cull.sim, 'sacred.culled'), 1, 'the cull touched the sacred species');
  assert.equal(stat(cullCtl.sim, 'sacred.culled'), 0);
  assert.ok(cull.dTrust < cullCtl.dTrust - 0.1, `trust falls more when the deer are sacred: ${cull.dTrust.toFixed(3)} vs ${cullCtl.dTrust.toFixed(3)}`);
  assert.ok(cull.dFear > cullCtl.dFear + 0.1, `fear rises more: ${cull.dFear.toFixed(3)} vs ${cullCtl.dFear.toFixed(3)}`);
  const spare = run(true, 'life.spawn-animal'), spareCtl = run(false, 'life.spawn-animal');
  assert.equal(stat(spare.sim, 'sacred.spared'), 1, 'more of the sacred deer');
  assert.ok(spare.dTrust > spareCtl.dTrust + 0.05, `trust rises: ${spare.dTrust.toFixed(3)} vs ${spareCtl.dTrust.toFixed(3)}`);
});
