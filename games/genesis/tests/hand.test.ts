// GENESIS — the hand (CONTRACT.md §11.4): it grabs anything (a person, an animal, a tree, a boulder, an item, a small
// building), carries it (the snapshot draws it in the hand), lets go with a velocity — the thing flies a ballistic
// arc on the sphere under the planet's gravity, across ticks, and lands with consequences: a person hurt, a crater
// and wrecked walls where a boulder strikes, a gift in a store (or REFUSED and left to rot, when they fear the god or
// the thing is taboo), a building set down whole or smashed. It slaps and strokes. A flight survives save / load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { town, must } from './helpers/god.ts';
import { Sim } from '../src/sim/sim.ts';
import type { Settlement } from '../src/sim/people/state.ts';
import type { SimEvent, UnitVec } from '../src/sim/types.ts';
import { BuildingFlag } from '../src/sim/types.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { moveBy, bearingDir } from '../src/sim/god/util.ts';
import { distM } from '../src/sim/people/world.ts';

const pt = [0, 0, 0];

/** a grown townsperson out in the open */
function someone(sim: Sim, st: Settlement): number {
  const ps = sim.u.planets[0].people;
  const A = ps.agents;
  const m = (ps.members.get(st.id) ?? []).filter((s) => A.alive[s] && A.health[s] > 0.8);
  assert.ok(m.length > 0);
  return A.id[m[0]];
}

function landings(sim: Sim): SimEvent[] {
  return sim.drainEvents().filter((e) => e.t === 'landed');
}

/** a place `m` metres from the town centre on a bearing */
function near(sim: Sim, st: Settlement, m: number, bearing = 0.7): UnitVec {
  return moveBy(st.pos, bearingDir(st.pos, bearing), m, sim.u.planets[0].st.radius) as UnitVec;
}

test('the hand grabs a person, carries them where it goes, and the snapshot draws them in it', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const A = p.people.agents;
  const id = someone(sim, st);
  const fear0 = A.fear[A.slotOf(id) * 4];
  const r = must(sim, { k: 'hand.grab', target: { kind: 'agent', id } });
  assert.deepEqual(r.created?.[0], { kind: 'agent', id, planet: 0 });
  const snap = sim.snapshot();
  assert.equal(snap.hand?.held?.kind, 'agent');
  assert.equal(snap.hand?.held?.id, id);
  assert.equal(snap.hand?.pose, 'grab');
  // carried 150 m away, 20 m up: they go with the hand (and do not wander off while held)
  const to = near(sim, st, 150);
  must(sim, { k: 'hand.move', pos: to, alt: 20 });
  sim.step(5);
  const s = A.slotOf(id);
  A.posAt(s, sim.tick, pt);
  assert.ok(distM(p, pt, to) < 2, `they are in the hand (${distM(p, pt, to).toFixed(1)} m off)`);
  const blk = sim.snapshot({ full: true }).planets[0].agents!;
  const i = Array.from(blk.id).indexOf(id);
  assert.ok(i >= 0 && blk.alt[i] > 15, `drawn up in the air (alt ${blk.alt[i]})`);
  assert.ok(A.fear[s * 4] > fear0, 'and they are afraid');
  // set down gently: unhurt, on the ground where the hand put them
  const h0 = A.health[s];
  must(sim, { k: 'hand.place', pos: to });
  sim.step(2);
  assert.equal(sim.u.god.hand(0)!.held, null);
  assert.ok(A.health[A.slotOf(id)] >= h0 - 1e-9, 'set down unhurt');
  A.posAt(A.slotOf(id), sim.tick, pt);
  assert.ok(distM(p, pt, to) < 5, 'where the hand put them');
});

test('thrown, a person flies an arc and lands hurt', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const A = p.people.agents;
  const id = someone(sim, st);
  must(sim, { k: 'hand.grab', target: `agent:${id}` });
  must(sim, { k: 'hand.move', pos: st.pos, alt: 2 });
  const h0 = A.health[A.slotOf(id)];
  must(sim, { k: 'hand.throw', toward: near(sim, st, 40), speed: 12, angle: 30 });
  assert.equal(sim.u.god.projectiles.length, 1, 'in the air');
  sim.drainEvents();
  sim.step(2);
  const ev = landings(sim);
  assert.equal(ev.length, 1, 'it came down');
  const s = A.slotOf(id);
  assert.ok(s >= 0, 'alive');
  assert.ok(A.health[s] < h0 - 0.1, `hurt by the landing (${h0.toFixed(2)} -> ${A.health[s].toFixed(2)})`);
  // the arc: v = 12 m/s at 30° from 2 m up carries ~15 m (vacuum), not more
  A.posAt(s, sim.tick, pt);
  const d = distM(p, pt, st.pos);
  assert.ok(d > 6 && d < 20, `landed ${d.toFixed(1)} m out`);
});

test('a throw is a ballistic arc on the sphere: aimed, with the range physics says, and long flights span ticks', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const g = p.st.gravity;
  // a boulder from a field outside the town, thrown at 50 m/s, 45° up, from 3 m above the ground
  must(sim, { k: 'hand.grab', kind: 'rock', mass: 200, pos: near(sim, st, 900, 3) });
  must(sim, { k: 'hand.move', pos: st.pos, alt: 3 });
  const bearing = 1.2;
  const aim = near(sim, st, 1000, bearing);
  const v = 50, ang = 45;
  must(sim, { k: 'hand.throw', toward: aim, speed: v, angle: ang });
  sim.drainEvents();
  sim.step(1);
  let ev = landings(sim);
  assert.equal(ev.length, 1, 'a seven-second flight lands within the minute');
  const at = ev[0].pos!;
  // flat ground, no air: v² sin 2θ / g (+ a little for the 3 m start); air drag shortens it, the world's curve
  // (a few-km planet) lengthens it a little
  const vac = (v * v * Math.sin((2 * ang * Math.PI) / 180)) / g;
  const d = distM(p, at, st.pos);
  assert.ok(d > vac * 0.8 && d < vac * 1.2, `range ${Math.round(d)} m against ${Math.round(vac)} m in vacuum`);
  assert.ok(distM(p, at, aim) < distM(p, at, near(sim, st, 1000, bearing + Math.PI)), 'it went the way it was thrown');

  // aimed, no speed given: the hand picks the speed that reaches the point
  const { sim: s2, st: t2 } = town();
  must(s2, { k: 'hand.grab', kind: 'rock', mass: 50, pos: near(s2, t2, 900, 3) });
  must(s2, { k: 'hand.move', pos: t2.pos, alt: 3 });
  const target = near(s2, t2, 300, 2.2);
  must(s2, { k: 'hand.throw', toward: target, angle: 45 });
  s2.drainEvents();
  s2.step(2);
  const e2 = landings(s2);
  assert.equal(e2.length, 1);
  assert.ok(distM(s2.u.planets[0], e2[0].pos!, target) < 45, `lands near the aim (${Math.round(distM(s2.u.planets[0], e2[0].pos!, target))} m off)`);

  // hurled nearly straight up at 200 m/s (this little test world's escape speed is ~240): a flight of minutes,
  // drawn in the air between ticks
  const { sim: s3, st: t3 } = town();
  must(s3, { k: 'hand.grab', kind: 'rock', mass: 80, pos: near(s3, t3, 900, 3) });
  must(s3, { k: 'hand.move', pos: t3.pos, alt: 3 });
  must(s3, { k: 'hand.throw', toward: near(s3, t3, 500, 0.4), speed: 200, angle: 85 });
  s3.drainEvents();
  s3.step(1);
  const fl = s3.snapshot().planets[0].projectiles ?? [];
  assert.equal(fl.length, 1, 'still in the air after a minute: drawn in flight');
  assert.equal(fl[0].kind, 'rock');
  assert.ok(fl[0].alt > 500, `high up (${fl[0].alt} m)`);
  ev = [];
  let n = 1;
  for (; n < 30 && !ev.length; n++) { s3.step(1); ev = landings(s3); }
  assert.equal(ev.length, 1, `it came down (after ${n} minutes)`);
  assert.ok(n >= 2, 'the flight spanned ticks');
});

test('a hurled boulder craters the ground and wrecks and hurts what it strikes', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const ps = p.people;
  must(sim, { k: 'hand.grab', kind: 'rock', mass: 40000, pos: near(sim, st, 1200, 3) });
  const hit = st.pos;
  must(sim, { k: 'hand.move', pos: hit, alt: 300 });
  const c = p.cellAt(hit);
  const ground0 = p.f.surface[c];
  const damage0 = ps.buildings.reduce((a, b) => a + b.damage, 0);
  const ruined0 = ps.buildings.filter((b) => b.flags & BuildingFlag.ruined).length;
  const fear0 = ps.agents.fear.reduce((a, v) => a + v, 0);
  // straight down, hard
  must(sim, { k: 'hand.release', vel: [-hit[0] * 80, -hit[1] * 80, -hit[2] * 80] });
  sim.drainEvents();
  sim.step(2);
  const ev = landings(sim);
  assert.equal(ev.length, 1);
  assert.ok((ev[0].a ?? 0) > 60, `it struck hard (${ev[0].a} m/s)`);
  assert.ok(p.f.surface[c] < ground0 - 0.05, `a crater (${ground0.toFixed(2)} -> ${p.f.surface[c].toFixed(2)})`);
  const damage1 = ps.buildings.reduce((a, b) => a + b.damage, 0);
  const ruined1 = ps.buildings.filter((b) => b.flags & BuildingFlag.ruined).length;
  assert.ok(damage1 > damage0 || ruined1 > ruined0, 'walls are broken');
  assert.ok(ps.agents.fear.reduce((a, v) => a + v, 0) > fear0, 'and the town is afraid');
});

test('a gift dropped into a town goes to its store — unless they refuse it (fear, or a taboo)', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const x = makeCtx(sim.u, p);
  const bread = x.c.items.idx('bread');
  // accepted
  const before = st.store[bread] ?? 0;
  must(sim, { k: 'hand.grab', item: 'bread', qty: 20 });
  must(sim, { k: 'hand.move', pos: st.pos, alt: 3 });
  sim.drainEvents();
  must(sim, { k: 'hand.drop' });
  sim.step(1);
  let ev = sim.drainEvents();
  assert.ok(ev.some((e) => e.t === 'gift' && e.text === 'accepted'), 'accepted');
  assert.ok((st.store[bread] ?? 0) >= before + 19.9, `into the store (${before} -> ${st.store[bread]})`);

  // refused: they fear the god far more than they love it
  const { sim: s2, st: t2 } = town();
  const p2 = s2.u.planets[0];
  t2.fearGod = 1; t2.belief = 0;
  const b2 = t2.store[bread] ?? 0;
  const items0 = p2.people.items.length;
  must(s2, { k: 'hand.grab', item: 'bread', qty: 20 });
  must(s2, { k: 'hand.move', pos: t2.pos, alt: 3 });
  s2.drainEvents();
  must(s2, { k: 'hand.drop' });
  s2.step(1);
  ev = s2.drainEvents();
  const gift = ev.find((e) => e.t === 'gift');
  assert.ok(gift && /refused: fear/.test(gift.text ?? ''), `refused out of fear (${gift?.text})`);
  assert.equal(t2.store[bread] ?? 0, b2, 'not in the store');
  assert.ok(p2.people.items.length > items0 && p2.people.items.some((g) => g.item === bread), 'left lying outside');

  // refused: a taboo on what makes it
  const { sim: s3, st: t3 } = town();
  const p3 = s3.u.planets[0];
  const x3 = makeCtx(s3.u, p3);
  const beer = x3.c.items.idx('beer');
  const makers = x3.rt.producers[beer] ?? [];
  assert.ok(makers.length > 0, 'an idea makes beer');
  for (const k of makers) if (!t3.culture.taboos.includes(k)) t3.culture.taboos.push(k);
  const m0 = t3.store[beer] ?? 0;
  must(s3, { k: 'hand.grab', item: 'beer', qty: 10 });
  must(s3, { k: 'hand.move', pos: t3.pos, alt: 3 });
  s3.drainEvents();
  must(s3, { k: 'hand.drop' });
  s3.step(1);
  const g3 = s3.drainEvents().find((e) => e.t === 'gift');
  assert.ok(g3 && /refused: taboo/.test(g3.text ?? ''), `refused: taboo (${g3?.text})`);
  assert.equal(t3.store[beer] ?? 0, m0, 'not in the store');
});

test('a small building is lifted, set down whole elsewhere — or thrown, and smashed', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const ps = p.people;
  const small = ps.buildings.filter((b) => b.settlement === st.id && b.progress >= 1 && !(b.flags & BuildingFlag.ruined) && (sim.u.content.buildings.list[b.type]?.footprint ?? 99) <= 4.5);
  assert.ok(small.length >= 2, `small buildings (${small.length})`);
  const [b1, b2] = small;
  must(sim, { k: 'hand.grab', target: { kind: 'building', id: b1.id } });
  assert.equal(ps.building(b1.id), undefined, 'off its foundations');
  const to = near(sim, st, 90, 4);
  must(sim, { k: 'hand.place', pos: to });
  sim.step(1);
  const placed = ps.building(b1.id);
  assert.ok(placed, 'set down');
  assert.ok(!(placed!.flags & BuildingFlag.ruined), 'whole');
  assert.ok(distM(p, placed!.pos, to) < 5, 'where the hand put it');
  // the second one is thrown
  must(sim, { k: 'hand.grab', target: { kind: 'building', id: b2.id } });
  must(sim, { k: 'hand.move', pos: st.pos, alt: 40 });
  must(sim, { k: 'hand.throw', toward: near(sim, st, 120, 5), speed: 30, angle: 20 });
  sim.step(2);
  const thrown = ps.building(b2.id);
  assert.ok(thrown && (thrown.flags & BuildingFlag.ruined), 'smashed where it fell');
});

test('the hand takes trees and animals, and plants them again', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const ps = p.people;
  // a tree out of the nearest wood
  let c = -1;
  for (let i = 0; i < p.count; i++) if (p.f.tree[i] > 0.3 && !p.s.ocean[i] && (c < 0 || distM(p, p.grid.pos.subarray(i * 3, i * 3 + 3), st.pos) < distM(p, p.grid.pos.subarray(c * 3, c * 3 + 3), st.pos))) c = i;
  assert.ok(c >= 0, 'a wood');
  const at: UnitVec = [p.grid.pos[c * 3], p.grid.pos[c * 3 + 1], p.grid.pos[c * 3 + 2]];
  const t0 = p.f.tree[c];
  must(sim, { k: 'hand.grab', kind: 'tree', pos: at });
  assert.ok(p.f.tree[c] < t0, 'pulled up');
  // replanted by the town: it takes root
  const plantAt = near(sim, st, 200, 5.5);
  const pc = p.cellAt(plantAt);
  const pt0 = p.f.tree[pc];
  must(sim, { k: 'hand.place', pos: plantAt });
  sim.step(1);
  assert.ok(p.f.tree[pc] > pt0, 'it takes root where it is set down');
  // an animal out of a herd
  const hd = ps.herds.find((h) => h.count >= 2);
  if (hd) {
    const n0 = ps.herds.reduce((a, h) => a + h.count, 0);
    must(sim, { k: 'hand.grab', target: { kind: 'animal', id: hd.id } });
    assert.ok(ps.herds.reduce((a, h) => a + h.count, 0) < n0, 'one taken from the herd');
    const put = near(sim, st, 300, 1.5);
    sim.drainEvents();
    must(sim, { k: 'hand.place', pos: put });
    sim.step(1);
    const landed = landings(sim);
    assert.ok(['lands on its feet', 'swims ashore'].includes(landed[0]?.text ?? ''), `set down alive (${landed[0]?.text})`);
    assert.ok(ps.herds.some((h) => h.species === hd.species && h.count >= 1 && distM(p, p.grid.pos.subarray(h.cell * 3, h.cell * 3 + 3), put) < 1500), 'a herd where it was put');
  }
});

test('a slap hurts and frightens; a stroke comforts and heals', () => {
  const { sim, st } = town();
  const A = sim.u.planets[0].people.agents;
  const id = someone(sim, st);
  const s = A.slotOf(id);
  const h0 = A.health[s], f0 = A.fear[s * 4];
  must(sim, { k: 'hand.slap', target: { kind: 'agent', id } });
  assert.ok(A.health[s] < h0 - 0.2 && A.fear[s * 4] > f0 + 0.2, 'slapped');
  assert.equal(sim.snapshot().hand?.pose, 'slap');
  const h1 = A.health[s], f1 = A.fear[s * 4], l1 = A.love[s * 4];
  must(sim, { k: 'hand.stroke', target: { kind: 'agent', id } });
  assert.ok(A.health[s] > h1 && A.fear[s * 4] < f1 && A.love[s * 4] > l1, 'stroked');
});

test('a flight in progress is saved and loaded, and goes on identically', () => {
  const { sim, st } = town();
  must(sim, { k: 'hand.grab', kind: 'rock', mass: 500, pos: near(sim, st, 900, 3) });
  must(sim, { k: 'hand.move', pos: st.pos, alt: 3 });
  must(sim, { k: 'hand.throw', toward: near(sim, st, 4000, 0.3), speed: 200, angle: 80 });
  sim.step(1);
  assert.equal(sim.u.god.projectiles.length, 1);
  const copy = Sim.load(sim.save());
  assert.equal(copy.hash(), sim.hash());
  sim.step(20);
  copy.step(20);
  assert.equal(sim.u.god.projectiles.length, 0, 'landed');
  assert.equal(copy.hash(), sim.hash(), 'the same landing in both');
});

test('faster than the world can pull back: thrown off the world for good', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const A = p.people.agents;
  const id = someone(sim, st);
  must(sim, { k: 'hand.grab', target: { kind: 'agent', id } });
  must(sim, { k: 'hand.move', pos: st.pos, alt: 5 });
  // escape speed here is √(2gR) ≈ 240 m/s
  const esc = Math.sqrt(2 * p.st.gravity * p.st.radius);
  must(sim, { k: 'hand.throw', toward: near(sim, st, 100, 0.2), speed: esc * 1.5, angle: 88 });
  sim.drainEvents();
  let lost = false;
  for (let i = 0; i < 30 && !lost; i++) { sim.step(1); lost = sim.drainEvents().some((e) => e.t === 'lost'); }
  assert.ok(lost, 'gone into the sky');
  assert.equal(A.slotOf(id), -1, 'and never came down');
  assert.equal(sim.u.god.projectiles.length, 0);
  assert.ok(sim.u.chronicle.some((e) => /hurled into the sky/.test(e.text)), 'the chronicle remembers');
});
