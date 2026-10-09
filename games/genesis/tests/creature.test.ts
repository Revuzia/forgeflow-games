// GENESIS — the creature (CONTRACT.md §11.5): templates (≥5) adopted side by side and drawn (body, morph, activity);
// it LEARNS — a stroke right after it does something makes it want to do that more, a slap less, and a creature
// trained that way behaves differently from an untrained twin of the same world; it learns a miracle by WATCHING the
// hand cast it (better each time) and then casts it itself; what it does makes it good or cruel, and its body morphs
// to match; its leash holds it to its village; the hand can lift it only while it trusts the hand; and a people with
// husbandry and a sacred beast raise a creature of their own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { town, must } from './helpers/god.ts';
import { Sim } from '../src/sim/sim.ts';
import type { CreatureState } from '../src/sim/god/state.ts';
import type { Settlement } from '../src/sim/people/state.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import { creaturePos, raiseCreatures } from '../src/sim/god/creature.ts';
import { moveBy, bearingDir } from '../src/sim/god/util.ts';
import { distM } from '../src/sim/people/world.ts';

/** a creature of `template` adopted at the edge of the town and leashed to it (tend) */
function adopt(sim: Sim, st: Settlement, template = 'ape'): CreatureState {
  const p = sim.u.planets[0];
  const at = moveBy(st.pos, bearingDir(st.pos, 0.5), 120, p.st.radius);
  const r = must(sim, { k: 'creature.adopt', template, pos: at });
  const c = sim.u.god.creature(r.created![0].id)!;
  must(sim, { k: 'creature.leash', id: c.id, settlement: st.id, mode: 'tend' });
  return c;
}

/** run `ticks`, calling `each` whenever the creature finishes an act (its `last` changes) */
function watchActs(sim: Sim, id: number, ticks: number, each: (c: CreatureState) => void): void {
  let seen = sim.u.god.creature(id)!.last.tick;
  for (let t = 0; t < ticks; t++) {
    sim.step(1);
    const c = sim.u.god.creature(id)!;
    if (c.last.tick !== seen) { seen = c.last.tick; each(c); }
  }
}

test('six kinds of creature; several at once, each drawn with its body, morph and activity', () => {
  const { sim, st } = town();
  const ids = sim.u.content.creatures.ids();
  for (const k of ['ape', 'ox', 'great-cat', 'tortoise', 'wolf']) assert.ok(ids.includes(k), `template ${k}`);
  assert.ok(ids.length >= 5);
  const made = ids.map((k) => adopt(sim, st, k));
  sim.step(30);
  const views = sim.snapshot().creatures;
  assert.equal(views.length, ids.length, 'all of them');
  const bodies = new Set(views.map((v) => v.body));
  assert.equal(bodies.size, ids.length, 'each its own body');
  for (const v of views) {
    assert.ok(v.height > 2 && v.morph.length === 4 && v.morph.every((m) => m >= 0 && m <= 1), `${v.name}: drawn`);
    assert.ok(v.activity.length > 0, `${v.name}: doing something`);
    assert.equal(v.leash, st.id, `${v.name}: leashed to the town`);
  }
  assert.equal(new Set(made.map((c) => c.name)).size >= 3, true, 'named');
});

test('a stroke after an act makes it want that more; a slap, less', () => {
  const { sim, st } = town();
  const c = adopt(sim, st);
  let rewarded = '', punished = '';
  watchActs(sim, c.id, 600, (cc) => {
    if (!rewarded) {
      const k = cc.last.kind, before = cc.desires[k];
      must(sim, { k: 'hand.stroke', target: { kind: 'creature', id: cc.id } });
      assert.ok(cc.desires[k] > before, `stroked after ${k}: ${before} -> ${cc.desires[k]}`);
      rewarded = k;
    } else if (!punished && cc.last.kind !== rewarded) {
      const k = cc.last.kind, before = cc.desires[k];
      must(sim, { k: 'hand.slap', target: { kind: 'creature', id: cc.id } });
      assert.ok(cc.desires[k] < before, `slapped after ${k}: ${before} -> ${cc.desires[k]}`);
      punished = k;
    }
  });
  assert.ok(rewarded && punished, `it did things to judge (${rewarded}, ${punished})`);
});

test('trained to help (stroked for it, slapped for mischief), it helps more than its untrained twin', () => {
  const { sim, st } = town();
  const c = adopt(sim, st, 'ape');
  sim.step(5);
  const twin = Sim.load(sim.save());
  const MISCHIEF = ['play', 'throw', 'throw-people', 'terrify', 'explore', 'impress', 'attack', 'eat-people', 'follow'];
  // two days of training
  watchActs(sim, c.id, 2 * 1440, (cc) => {
    if (cc.last.kind === 'help') sim.applyNow({ k: 'creature.reward', id: cc.id });
    else if (MISCHIEF.includes(cc.last.kind)) sim.applyNow({ k: 'creature.punish', id: cc.id });
  });
  twin.step(2 * 1440);
  const a = sim.u.god.creature(c.id)!, b = twin.u.god.creature(c.id)!;
  assert.ok(a.desires.help > b.desires.help + 0.2, `it wants to help (${b.desires.help} -> ${a.desires.help})`);
  assert.ok(a.desires.play < b.desires.play, `and to play less (${b.desires.play} -> ${a.desires.play})`);
  // then two days on its own: what it does now
  const a0 = a.counts.help ?? 0, b0 = b.counts.help ?? 0;
  const m0 = MISCHIEF.reduce((s, k) => s + (a.counts[k] ?? 0), 0), n0 = MISCHIEF.reduce((s, k) => s + (b.counts[k] ?? 0), 0);
  sim.step(2 * 1440);
  twin.step(2 * 1440);
  const helpA = (a.counts.help ?? 0) - a0, helpB = (b.counts.help ?? 0) - b0;
  const misA = MISCHIEF.reduce((s, k) => s + (a.counts[k] ?? 0), 0) - m0, misB = MISCHIEF.reduce((s, k) => s + (b.counts[k] ?? 0), 0) - n0;
  assert.ok(helpA > helpB, `trained, it helps more (${helpA} against ${helpB})`);
  assert.ok(misA < misB, `and makes less mischief (${misA} against ${misB})`);
  assert.ok(a.alignment >= b.alignment && a.alignment > 0, `it is growing good (${b.alignment} -> ${a.alignment})`);
});

test('it learns a miracle by watching the hand cast it, and then calls it for its village', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const c = adopt(sim, st, 'ape');
  sim.step(2);
  assert.ok(!((c.miracles.heal ?? 0) > 0.05), 'it does not know healing');
  const cp = creaturePos(c, sim.tick);
  must(sim, { k: 'miracle.cast', kind: 'heal', pos: moveBy(cp, bearingDir(cp, 2), 80, p.st.radius) });
  const s1 = c.miracles.heal ?? 0;
  assert.ok(s1 > 0.05, `it watched, and learned (${s1})`);
  assert.ok(sim.u.chronicle.some((e) => e.text.includes(`${c.name} watched the god call heal`)), 'the chronicle says so');
  // each showing teaches it better; too far away, it sees nothing
  must(sim, { k: 'creature.teach-by-example', id: c.id, miracle: 'heal' });
  assert.ok(c.miracles.heal > s1, `better the second time (${s1} -> ${c.miracles.heal})`);
  const far = moveBy(cp, bearingDir(cp, 4), 2500, p.st.radius);
  must(sim, { k: 'miracle.cast', kind: 'forest', pos: far });
  assert.ok(!((c.miracles.forest ?? 0) > 0.05), 'a miracle far off is not seen');
  // the village falls sick: it calls the healing it learned
  const x = makeCtx(sim.u, p);
  const A = x.A;
  for (const m of x.ps.members.get(st.id) ?? []) A.health[m] = Math.min(A.health[m], 0.35);
  c.desires.cast = 0.9;
  for (let d = 0; d < 6 && !(c.counts['cast.heal'] ?? 0); d++) sim.step(240);
  assert.ok((c.counts['cast.heal'] ?? 0) >= 1, `it cast heal itself (${JSON.stringify(c.counts)})`);
});

test('what it does makes it good or cruel, and its body shows it', () => {
  const { sim, st } = town();
  const good = adopt(sim, st, 'ox');
  const cruel = adopt(sim, st, 'great-cat');
  const g0 = sim.snapshot().creatures.find((v) => v.id === good.id)!;
  // one is taught to help and only help; the other loves to frighten, throw and eat people
  for (const k of Object.keys(good.desires)) good.desires[k] = k === 'help' ? 1 : k === 'eat' || k === 'sleep' ? good.desires[k] : 0.02;
  for (const k of Object.keys(cruel.desires)) cruel.desires[k] = ['terrify', 'throw-people', 'eat-people', 'attack'].includes(k) ? 1 : k === 'sleep' ? cruel.desires[k] : 0.02;
  must(sim, { k: 'creature.set-mode', id: cruel.id, mode: 'terrify' });
  sim.step(2 * 1440);
  const vg = sim.snapshot().creatures.find((v) => v.id === good.id)!;
  const vc = sim.snapshot().creatures.find((v) => v.id === cruel.id)!;
  assert.ok(good.alignment > 0.3, `the helper grew good (${good.alignment})`);
  assert.ok(cruel.alignment < -0.3, `the terror grew cruel (${cruel.alignment})`);
  assert.ok(vg.morph[3] > g0.morph[3] + 0.2 && vg.morph[2] === 0, `good: it glows (${vg.morph})`);
  assert.ok(vc.morph[2] > 0.3 && vc.morph[3] === 0, `cruel: it grows spikes (${vc.morph})`);
  assert.ok(vg.alignment === good.alignment && vc.alignment === cruel.alignment, 'the view carries the alignment');
});

test('the leash holds it near its village; let off the leash to explore, it roams farther', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const c = adopt(sim, st, 'wolf');
  must(sim, { k: 'creature.leash', id: c.id, settlement: st.id, mode: 'tend', length: 300 });
  let far = 0;
  for (let t = 0; t < 1440; t += 10) { sim.step(10); far = Math.max(far, distM(p, creaturePos(c, sim.tick), st.pos)); }
  assert.ok(far < 300 + 400, `leashed, it stays near (${Math.round(far)} m at most)`);
  must(sim, { k: 'creature.unleash', id: c.id });
  c.desires.explore = 1;
  let far2 = 0;
  for (let t = 0; t < 1440; t += 10) { sim.step(10); far2 = Math.max(far2, distM(p, creaturePos(c, sim.tick), st.pos)); }
  assert.ok(far2 > far, `free, it wanders farther (${Math.round(far2)} m)`);
});

test('the hand lifts it while it trusts the hand; slapped too often, it pulls away', () => {
  const { sim, st } = town();
  const c = adopt(sim, st, 'ape');
  must(sim, { k: 'hand.grab', target: { kind: 'creature', id: c.id } });
  assert.equal(sim.snapshot().hand?.held?.kind, 'creature');
  must(sim, { k: 'hand.place', pos: st.pos });
  sim.step(2);
  assert.equal(c.held, null);
  for (let i = 0; i < 8; i++) must(sim, { k: 'creature.punish', id: c.id });
  const r = sim.applyNow({ k: 'hand.grab', target: { kind: 'creature', id: c.id } });
  assert.equal(r.ok, false, 'it will not be lifted');
  assert.match(r.msg ?? '', /does not trust you/);
});

test('a people with husbandry and a sacred beast raise a creature of their own', () => {
  const { sim, st } = town();
  const p = sim.u.planets[0];
  const x = makeCtx(sim.u, p);
  const husb = x.rt.byId.get('animal-husbandry')!;
  assert.ok(husb !== undefined);
  if (!st.library.includes(husb)) st.library.push(husb);
  st.culture.sacred.push('animal:wolf');
  let raised: CreatureState | undefined;
  // the yearly-odds roll is daily in the sim; here it is rolled each minute until it comes up
  for (let t = 0; t < 400 && !raised; t++) {
    sim.step(1);
    raiseCreatures(sim.u, p);
    raised = sim.u.god.creatures.find((c) => c.settlement === st.id);
  }
  assert.ok(raised, 'they raised one');
  assert.equal(raised!.template, 'wolf', 'of their sacred beast');
  assert.equal(raised!.leash?.settlement, st.id, 'it tends their village');
  assert.ok(sim.u.chronicle.some((e) => e.text.includes(raised!.name)), 'the chronicle names it');
  // and only one per village
  for (let t = 0; t < 100; t++) { sim.step(1); raiseCreatures(sim.u, p); }
  assert.equal(sim.u.god.creatures.filter((c) => c.settlement === st.id && c.alive).length, 1);
});
