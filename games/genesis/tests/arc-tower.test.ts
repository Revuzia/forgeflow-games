// GENESIS — ARC §2.2-2.4 (the Tower): a league begins a tower (tower.begin), it rises by its builders, and the god's
// four answers: confuse their tongues (two drifts, the scattering, no deaths), strike it down (survivable at the
// default wrath, the remains stand, tiers kept for the rubble), warn (needs a prophet), let it stand; the clean
// refusals with no tower; the view and query; saving keeps it; the same world gives the same tower (ARC §6.1-§6.6, §8.2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { town, must } from './helpers/god.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { langDistance } from '../src/sim/people/culture.ts';
import { distM, isLand } from '../src/sim/people/world.ts';
import { cellPos3 } from '../src/sim/god/util.ts';
import type { Settlement } from '../src/sim/people/state.ts';
import type { TowerState } from '../src/sim/god/state.ts';

interface League { sim: Sim; host: Settlement; kin: Settlement }

let cached: Uint8Array | null = null;
let ids: [number, number] = [0, 0];

/** Aru and a kin town of the same people 2-4 km away, both bronze age */
function league(): League {
  if (!cached) {
    const { sim, st } = town();
    const p = sim.u.planets[0];
    let best = -1;
    for (let c = 0; c < p.count; c++) {
      const d = distM(p, cellPos3(p, c), st.pos);
      if (d < 2500 || d > 4000 || !isLand(p, c) || p.f.water[c] > 0.05) continue;
      best = c; break;
    }
    assert.ok(best >= 0, 'a site for the kin town');
    const P = cellPos3(p, best);
    const l = Math.hypot(P[0], P[1], P[2]);
    const r = must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 30, era: 'bronze', settled: true, pos: [P[0] / l, P[1] / l, P[2] / l] } as never);
    const kid = r.created!.find((e) => e.kind === 'settlement')!.id;
    sim.step(60);
    cached = sim.save();
    ids = [st.id, kid];
  }
  const sim = Sim.load(cached);
  const ps = sim.u.planets[0].people;
  return { sim, host: ps.settlement(ids[0])!, kin: ps.settlement(ids[1])! };
}

function towerOf(sim: Sim): TowerState { return sim.u.god.rel!.towers!.find((t) => t.status === 'rising') ?? sim.u.god.rel!.towers![0]; }

function begin(L: League): TowerState {
  must(L.sim, { k: 'tower.begin', settlement: L.host.id } as never);
  return towerOf(L.sim);
}

test('§2.4 every tower command fails cleanly with no tower (T10)', () => {
  const { sim } = town();
  for (const k of ['tower.confuse', 'tower.strike', 'tower.warn', 'tower.let']) {
    const r = sim.applyNow({ k } as never);
    assert.equal(r.ok, false, k);
    assert.match(r.msg ?? "", /Nobody is building a tower on this world\./, k);
  }
});

test('§2.2-2.3 tower.begin: the league, the site, the great-tower record; it rises day by day; view and query', () => {
  const L = league();
  const tw = begin(L);
  const p = L.sim.u.planets[0];
  const x = makeCtx(L.sim.u, p);
  assert.equal(tw.status, 'rising');
  assert.deepEqual(tw.league, [L.host.id, L.kin.id].sort((a, b) => a - b));
  assert.match(tw.name, /^the Tower of /);
  const b = p.people.building(tw.building)!;
  assert.ok(b, 'the building record');
  assert.equal(x.c.buildings.list[b.type].id, 'great-tower');
  const d = distM(p, tw.pos, L.host.pos);
  assert.ok(d >= 300 && d <= 1500, `site ${d} m from the host`);
  assert.equal(tw.goal, 80, 'bronze: 80 m');
  const h0 = tw.height;
  L.sim.step(x.day * 4);
  const t2 = towerOf(L.sim);
  assert.ok(t2.height > h0, `it rises (${h0} -> ${t2.height})`);
  assert.ok(t2.builders >= 4, `builders ${t2.builders}`);
  const q = L.sim.query('towers') as { id: number; hostName: string; canAnswer: string[]; leagueNames: string[] }[];
  assert.equal(q.length, 1);
  assert.equal(q[0].hostName, L.host.name);
  assert.deepEqual(q[0].canAnswer.slice().sort(), ['confuse', 'let', 'strike', 'warn']);
  // (a prophet may have risen on their own in this world: without one the warning is blocked with its reason)
  L.sim.u.god.rel!.prophets.length = 0;
  const snap = L.sim.snapshot() as unknown as { planets: { towers?: { id: number; status: string; warnBlocked?: string }[] }[] };
  const views = snap.planets.flatMap((pl) => pl.towers ?? []);
  assert.equal(views.length, 1);
  assert.match(views[0].warnBlocked ?? '', /No prophet speaks for you/);
  const w = L.sim.applyNow({ k: 'tower.warn' } as never);
  assert.equal(w.ok, false);
  assert.match(w.msg ?? "", /No prophet speaks for you among the builders/);
});

test('§2.4 confuse: two drifts per town, root kept, distance >= 0.72, scattered, nobody dies, one apart line per pair (T6)', () => {
  const L = league();
  begin(L);
  const line0 = [L.host.langLine[0], L.kin.langLine[0]];
  const seeds = [L.host.langSeed, L.kin.langSeed];
  const alive0 = L.sim.u.planets[0].people.agents.count;
  must(L.sim, { k: 'tower.confuse' } as never);
  const tw = towerOf(L.sim);
  assert.equal(tw.status, 'scattered');
  assert.equal(tw.answer, 'confuse');
  assert.ok(langDistance(L.host, L.kin) >= 0.72, `distance ${langDistance(L.host, L.kin)}`);
  assert.deepEqual([L.host.langLine[0], L.kin.langLine[0]], line0, 'langLine[0] untouched');
  assert.notEqual(L.host.langSeed, seeds[0]); assert.notEqual(L.kin.langSeed, seeds[1]);
  assert.ok(L.sim.u.planets[0].people.agents.count >= alive0, 'no deaths');
  const again = L.sim.applyNow({ k: 'tower.confuse' } as never);
  assert.equal(again.ok, false, 'a scattered tower cannot be answered again');
});

test('§2.4 strike at the default wrath: survivable, the remains stand, tiers kept for the rubble (T7)', () => {
  const L = league();
  begin(L);
  const x = makeCtx(L.sim.u, L.sim.u.planets[0]);
  L.sim.step(x.day * 20);
  const before = towerOf(L.sim);
  const tiers = before.tiers, height = before.height;
  const r = must(L.sim, { k: 'tower.strike' } as never);
  const tw = L.sim.u.god.rel!.towers!.find((t) => t.id === before.id)!;
  assert.equal(tw.status, 'struck');
  assert.equal(tw.tiers, tiers, 'tiers keep the count before the fall');
  assert.ok(tw.height < height || height < 12, `height ${height} -> ${tw.height}`);
  const dead = Number((/(\d+) die/.exec(r.msg ?? "") ?? [0, 0])[1]);
  assert.ok(dead <= 10, `dead ${dead}`);
  const ev = L.sim.u.god.rel!.arcEvents!.filter((e) => e.kind === 'strike');
  assert.equal(ev.length, 1);
});

test('§2.4 let it stand: favour, and strike / confuse still open; saving keeps the tower; the same world, the same tower', () => {
  const L = league();
  begin(L);
  must(L.sim, { k: 'tower.let' } as never);
  let tw = towerOf(L.sim);
  assert.equal(tw.answer, 'let');
  const q = L.sim.query('towers') as { canAnswer: string[] }[];
  assert.deepEqual(q[0].canAnswer.slice().sort(), ['confuse', 'strike']);
  assert.equal(L.sim.applyNow({ k: 'tower.let' } as never).ok, false);
  const day = makeCtx(L.sim.u, L.sim.u.planets[0]).day;
  L.sim.step(day * 3);
  const back = Sim.load(L.sim.save());
  tw = towerOf(L.sim);
  const tb = towerOf(back);
  assert.deepEqual(tb, tw, 'saved and loaded');
  back.step(day * 3); L.sim.step(day * 3);
  assert.equal(back.hash(), L.sim.hash(), 'deterministic after load');
});

test('§2.4 warn: the prophet speaks five days, each town rolls to heed; the same world gives the same outcome (T8)', () => {
  const run = () => {
    const L = league();
    L.sim.u.god.rel!.prophets.length = 0;
    const A = L.sim.u.planets[0].people.agents;
    const who = (L.sim.u.planets[0].people.members.get(L.host.id) ?? []).map((s) => A.id[s]).sort((a, b) => a - b)
      .find((id) => { const s = A.slotOf(id); return (L.sim.u.tick - A.birth[s]) / makeCtx(L.sim.u, L.sim.u.planets[0]).year > 20; })!;
    must(L.sim, { k: 'prophet.call', agent: who } as never);
    begin(L);
    must(L.sim, { k: 'tower.warn' } as never);
    let tw = towerOf(L.sim);
    assert.equal(tw.answer, 'warn');
    assert.equal(tw.warned!.agent, who);
    const q = L.sim.query('towers') as { warnBlocked?: string }[];
    assert.match(q[0].warnBlocked ?? '', /already speaking/);
    L.sim.step(makeCtx(L.sim.u, L.sim.u.planets[0]).day * 6);
    tw = L.sim.u.god.rel!.towers!.find((t) => t.id === tw.id)!;
    const w = tw.warned!;
    assert.equal(w.heeded.length + w.refused.length, 2, `every league town answered (${JSON.stringify(w)})`);
    if (!w.refused.length) assert.equal(tw.status, 'abandoned', 'all heeded: the tower is left');
    if (!w.refused.length) assert.ok(L.sim.u.god.rel!.places.some((pl) => distM(L.sim.u.planets[0], pl.pos, tw.pos) < 300), 'a sacred place at the site');
    return JSON.stringify(w);
  };
  assert.equal(run(), run(), 'the heed roll reproduces');
});
