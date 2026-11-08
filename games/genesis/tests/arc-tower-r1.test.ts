// GENESIS — ARC §2.4 round-1 fixes (stage A r1): the strike's regard is taken once (trust by the witness class, one
// harm noted per town); the first Decision card is offered to a rebuilt tower standing over a quarter of its goal and
// reopens after a refused warning; every tower roll is the world's own (seeded); a warning can land (ARC §2.4 note).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import { town, must } from './helpers/god.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { distM, isLand } from '../src/sim/people/world.ts';
import { cellPos3 } from '../src/sim/god/util.ts';
import { cruelty } from '../src/sim/god/regard.ts';
import { heedDie, rebuildDie } from '../src/sim/god/tower.ts';
import { GODS } from '../src/sim/people/defs.ts';
import type { Settlement } from '../src/sim/people/state.ts';
import type { TowerState } from '../src/sim/god/state.ts';

interface League { sim: Sim; host: Settlement; kin: Settlement }

let cached: Uint8Array | null = null;
let ids: [number, number] = [0, 0];

/** Aru and a kin town of the same people 2.5-4 km away, both bronze age (as arc-tower.test.ts) */
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

const towerOf = (sim: Sim): TowerState => sim.u.god.rel!.towers!.find((t) => t.status === 'rising') ?? sim.u.god.rel!.towers![0];
const choices = (sim: Sim): number => sim.drainEvents().filter((e) => (e as { t: string }).t === 'tower.choice').length;

function trustOf(L: League, sid: number): number {
  const ps = L.sim.u.planets[0].people;
  const m = ps.members.get(sid) ?? [];
  let t = 0;
  for (const s of m) t += ps.agents.love[s * GODS];
  return t / Math.max(1, m.length);
}

function callProphet(L: League): void {
  L.sim.u.god.rel!.prophets.length = 0;
  const p = L.sim.u.planets[0], A = p.people.agents, x = makeCtx(L.sim.u, p);
  const who = (p.people.members.get(L.host.id) ?? []).map((s) => A.id[s]).sort((a, b) => a - b)
    .find((id) => (L.sim.u.tick - A.birth[A.slotOf(id)]) / x.year > 20)!;
  must(L.sim, { k: 'prophet.call', agent: who } as never);
}

test('§2.4 strike unprovoked at the default wrath: trust falls by the witness class once (about 0.2 x mk x cruelty), one harm noted', () => {
  const L = league();
  must(L.sim, { k: 'tower.begin', settlement: L.host.id } as never);
  L.sim.step(makeCtx(L.sim.u, L.sim.u.planets[0]).day * 20);
  const key = `${L.sim.u.planets[0].id}:${L.host.id}`;
  const t0 = trustOf(L, L.host.id), kin0 = trustOf(L, L.kin.id);
  const load0 = L.sim.u.god.rel!.st[key]?.harmLoad ?? 0;
  must(L.sim, { k: 'tower.strike' } as never);
  const drop = t0 - trustOf(L, L.host.id), kinDrop = kin0 - trustOf(L, L.kin.id);
  const cap = 0.2 * 1.2 * cruelty(0.3) + 0.01; // mk <= harm magnitude 0.6 + 0.6 x 0.3 (gain <= 1)
  assert.ok(drop <= cap, `host trust drop ${drop.toFixed(3)} <= ${cap.toFixed(3)} (it was a further flat 0.2)`);
  assert.ok(kinDrop <= cap, `kin trust drop ${kinDrop.toFixed(3)} <= ${cap.toFixed(3)}`);
  const load1 = L.sim.u.god.rel!.st[key].harmLoad ?? 0;
  assert.ok(Math.abs(load1 - load0 - 1) < 0.02, `one act, one harm noted (harmLoad ${load0} -> ${load1})`);
});

test('§2.4 strike after a refused warning: provoked, trust falls by at most about 0.05 x mk', () => {
  const L = league();
  callProphet(L);
  must(L.sim, { k: 'tower.begin', settlement: L.host.id } as never);
  const tw = towerOf(L.sim);
  must(L.sim, { k: 'tower.warn' } as never);
  const x = makeCtx(L.sim.u, L.sim.u.planets[0]);
  L.sim.step(x.day * 6);
  tw.warned!.heeded = []; tw.warned!.refused = tw.league.slice();
  tw.status = 'rising'; tw.ended = -1;
  const t0 = trustOf(L, L.host.id), kin0 = trustOf(L, L.kin.id);
  must(L.sim, { k: 'tower.strike' } as never);
  const drop = t0 - trustOf(L, L.host.id), kinDrop = kin0 - trustOf(L, L.kin.id);
  assert.ok(drop <= 0.05 * 1.2 + 0.01, `host trust drop ${drop.toFixed(3)}`);
  assert.ok(kinDrop <= 0.05 * 1.2 + 0.01, `kin trust drop ${kinDrop.toFixed(3)}`);
});

test('§2.4 a rebuilt tower that already stands over a quarter of its goal is offered the Decision card', () => {
  const L = league();
  must(L.sim, { k: 'tower.begin', settlement: L.host.id } as never);
  const tw = towerOf(L.sim);
  L.sim.drainEvents();
  // as a rebuild from a 30 % stump: the height starts past the 25 % mark, so it never crosses it
  tw.height = 0.3 * tw.goal; tw.choices = 0;
  L.sim.step(makeCtx(L.sim.u, L.sim.u.planets[0]).day * 2);
  assert.equal(choices(L.sim), 1, 'one tower.choice');
  assert.equal(tw.choices, 1);
  const v = L.sim.query('towers') as { canAnswer: string[] }[];
  assert.ok(v[0].canAnswer.includes('strike'));
});

test('§2.4 a warning sent at 10 % and refused after the tower passed 25 %: the card reopens (warn disabled)', () => {
  const L = league();
  callProphet(L);
  must(L.sim, { k: 'tower.begin', settlement: L.host.id } as never);
  const tw = towerOf(L.sim);
  tw.height = 0.1 * tw.goal;
  must(L.sim, { k: 'tower.warn' } as never);
  // past the quarter while the prophet preaches; proud and faithless, so both towns refuse at the floor
  tw.height = 0.3 * tw.goal;
  const R = L.sim.u.god.rel!, pid = L.sim.u.planets[0].id;
  L.sim.step(makeCtx(L.sim.u, L.sim.u.planets[0]).day);
  assert.equal(tw.choices, 0, 'no card while the prophet speaks');
  for (const sid of tw.league) { R.st[`${pid}:${sid}`].pride = 1; R.st[`${pid}:${sid}`].since.tDrain = 0; }
  for (const ph of R.prophets) ph.credibility = 0;
  L.sim.drainEvents();
  L.sim.step(makeCtx(L.sim.u, L.sim.u.planets[0]).day * 6);
  const w = tw.warned!;
  if (!w.refused.length) return; // (a 5 % die landed: nothing to reopen)
  assert.equal(tw.status, 'rising');
  assert.ok(tw.choices >= 1, 'the card reopened');
  assert.ok(choices(L.sim) >= 1, 'tower.choice emitted on the refusal');
  const q = L.sim.query('towers') as { canAnswer: string[]; warnBlocked?: string; choiceOpen?: boolean }[];
  assert.match(q[0].warnBlocked ?? '', /Give it a year/);
});

test('§2.4 tower rolls are the world\'s own: two seeds give different heed and rebuild dice for the same ids', () => {
  const a = { seed: 1 }, b = { seed: 2 };
  const ha = [1, 2, 3, 4].map((s) => heedDie(a, 1, s)), hb = [1, 2, 3, 4].map((s) => heedDie(b, 1, s));
  assert.notDeepEqual(ha, hb);
  const ra = Array.from({ length: 8 }, (_, y) => rebuildDie(a, 1, y)), rb = Array.from({ length: 8 }, (_, y) => rebuildDie(b, 1, y));
  assert.notDeepEqual(ra, rb);
  // over many worlds, tower 1's heed die for town 1 is not pinned above the 0.9 cap (it was 0.920 on every world)
  let low = 0;
  for (let s = 1; s <= 64; s++) if (heedDie({ seed: s }, 1, 1) < 0.5) low++;
  assert.ok(low >= 16 && low <= 48, `town 1 rolls under 0.5 on ${low}/64 worlds`);
});

test('§2.4 confuse kills no one by the act; the scattered who freeze or starve that year are counted and told once (T6, owner 2026-11-08)', () => {
  const L = league();
  must(L.sim, { k: 'tower.begin', settlement: L.host.id } as never);
  L.sim.step(makeCtx(L.sim.u, L.sim.u.planets[0]).day * 20);
  const alive0 = L.sim.u.planets[0].people.agents.count;
  must(L.sim, { k: 'tower.confuse' } as never);
  assert.ok(L.sim.u.planets[0].people.agents.count >= alive0, 'the act itself kills no one');
  const tw = towerOf(L.sim);
  assert.ok(tw.scatter && tw.scatter.towns.length >= 1 && tw.scatter.lost === undefined, 'the daughter towns are kept for the count');
  const ps = L.sim.u.planets[0].people;
  const kid = ps.settlement(tw.scatter!.towns[0])!;
  // two of the scattered froze in their first winter (as the cold would)
  kid.stats.froze += 2;
  tw.scatter!.until = L.sim.u.tick;
  L.sim.drainEvents();
  L.sim.step(makeCtx(L.sim.u, L.sim.u.planets[0]).day + 60);
  const ev = L.sim.drainEvents().filter((e) => (e as { t: string }).t === 'tower.lost') as unknown as { data: { lost: number } }[];
  assert.ok((tw.scatter!.lost ?? 0) >= 2, `lost ${tw.scatter!.lost}`);
  assert.equal(ev.length, 1, 'told once');
  assert.equal(ev[0].data.lost, tw.scatter!.lost);
  L.sim.step(makeCtx(L.sim.u, L.sim.u.planets[0]).day * 2);
  assert.equal(L.sim.drainEvents().filter((e) => (e as { t: string }).t === 'tower.lost').length, 0, 'never again');
});
