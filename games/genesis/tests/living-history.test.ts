// GENESIS — LIVING HISTORY (LIVING.md §5): politics from real grievances inside one people, eras that read right and
// their pace, the god's era and terraform acts. Each test sets up the one situation it is about (a capital and a kin
// daughter 1.2 km away on the omnipotence test world; a band; the barren world) and checks what the people do with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../src/sim/sim.ts';
import type { Command } from '../src/sim/types.ts';
import type { Settlement } from '../src/sim/people/state.ts';
import { town, must } from './helpers/god.ts';
import { makeCtx } from '../src/sim/people/ctx.ts';
import type { PCtx } from '../src/sim/people/ctx.ts';
import { distM } from '../src/sim/people/world.ts';
import { driftLanguage } from '../src/sim/people/names.ts';
import { landingCell } from '../src/sim/people/spawn.ts';
import { pathOptsFor } from '../src/sim/people/resources.ts';
import { findPath } from '../src/sim/grid/pathfind.ts';
import { accident, computeEra, refreshLibrary } from '../src/sim/people/knowledge.ts';
import { histOf, kinOpinion, POLITICS, sendAid, popOf, walkDays } from '../src/sim/people/politics.ts';
import { politicsDaily, polityOf, plunder } from '../src/sim/people/war.ts';
import { spawnHerd } from '../src/sim/life/herds.ts';
import { newMission, volunteers } from '../src/sim/people/missions.ts';
import { DWELL, PRACTICE, PRACTICE_USES, eraLabel, inventable, practised } from '../src/sim/people/eras.ts';
import { landOf } from '../src/sim/people/ledger.ts';
import { ERAS } from '../src/sim/content.ts';

const ctx = (sim: Sim): PCtx => makeCtx(sim.u, sim.u.planets[0]);
const k = (x: PCtx, id: string): number => x.rt.byId.get(id)!;

/** a bronze capital of ~30 (the god tests' town, on a world where the land between is walkable) and a daughter of 24 founded
 * from it, 1.1–1.7 km away: one polity */
function kinTowns(seed = 3): { sim: Sim; cap: Settlement; d: Settlement } {
  const { sim, st: cap } = town(seed);
  const p = sim.u.planets[0];
  const x = ctx(sim);
  // the best ground 1.1–1.6 km away that the daughter's landing site can be walked to from the capital
  const cands: [number, number][] = [];
  for (let c = 0; c < p.count; c++) {
    if (p.s.ocean[c] || p.f.water[c] > 0.05) continue;
    const pos = [p.grid.pos[c * 3], p.grid.pos[c * 3 + 1], p.grid.pos[c * 3 + 2]];
    const dd = distM(p, pos, cap.pos);
    if (dd < 1100 || dd > 1600) continue;
    cands.push([c, p.f.fertility[c] + p.f.tree[c] * 0.3]);
  }
  cands.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const opts = pathOptsFor(x, cap.species);
  opts.swim = 0;
  opts.maxExpand = 9000;
  const path: number[] = [];
  const sp = x.c.species.idx('plains-folk');
  let best = cands[0][0];
  for (const [c] of cands) {
    const l = landingCell(x, sp, c);
    const dd = distM(p, [p.grid.pos[l * 3], p.grid.pos[l * 3 + 1], p.grid.pos[l * 3 + 2]], cap.pos);
    if (dd >= 1100 && dd <= 1700 && findPath(p, cap.cell, l, opts, path)) { best = c; break; }
  }
  const r = must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 24, era: 'bronze', settled: true, pos: [p.grid.pos[best * 3], p.grid.pos[best * 3 + 1], p.grid.pos[best * 3 + 2]] });
  const d = p.people.settlement(r.created!.find((e) => e.kind === 'settlement')!.id)!;
  d.parent = cap.id;
  d.polity = cap.polity;
  d.langSeed = driftLanguage(cap.langSeed, d.id);
  d.langLine = [...(cap.langLine ?? [cap.langSeed]), d.langSeed];
  p.people.polities = p.people.polities.filter((q) => q.id !== d.id);
  p.people.relations = p.people.relations.filter((q) => q.a !== d.id && q.b !== d.id);
  for (const [a, b] of [[cap, d], [d, cap]]) if (!a.contacts.includes(b.id)) { a.contacts.push(b.id); a.contacts.sort((q, w) => q - w); }
  void x;
  return { sim, cap, d };
}

/** empty a settlement's food stores (the hard time a test is about) */
function starve(x: PCtx, st: Settlement): void {
  for (const it of x.info[st.species].foods) st.store[it] = 0;
}
/** fill a settlement's stores with grain: `days` days a head */
function feed(x: PCtx, st: Settlement, days: number): void {
  const grain = x.c.items.idx('grain');
  st.store[grain] = (st.store[grain] ?? 0) + (days * Math.max(1, popOf(x, st))) / Math.max(0.05, x.info[st.species].edible[grain]);
}
/** run the day's politics (war.ts politicsDaily: polities, then history) `n` times, a day apart, without stepping the
 * world (only the day's clock moves) */
function days(x: PCtx, n: number, each?: (i: number) => void): void {
  for (let i = 0; i < n; i++) { x.tick += x.day; each?.(i); politicsDaily(x); }
}

// ───────────────────────────── §5.2 eras that read right ─────────────────────────────

test('era labels read what a town can do: never "bronze age" without smelting, never "stone age" with farms and pots', () => {
  const { sim, st } = town();
  const x = ctx(sim);
  const lib = (ids: string[]) => { st.library = ids.map((id) => k(x, id)).sort((a, b) => a - b); st.era = computeEra(x, st); return eraLabel(x, st); };
  assert.equal(lib(['foraging', 'stone-tools']), 'stone age');
  assert.equal(lib(['foraging', 'fire-keeping']), 'fire-keepers');
  assert.equal(lib(['foraging', 'fire-keeping', 'agriculture']), 'first farmers');
  assert.equal(lib(['foraging', 'fire-keeping', 'agriculture', 'pottery']), 'potters');
  assert.equal(lib(['fire-keeping', 'agriculture', 'pottery', 'charcoal', 'kiln-firing', 'copper-smelting']), 'copper age');
  assert.equal(lib(['fire-keeping', 'pottery', 'copper-smelting', 'tin-smelting', 'bronze']), 'bronze age');
  assert.equal(lib(['fire-keeping', 'pottery', 'copper-smelting', 'iron-smelting']), 'iron age');
  // a town whose era index says bronze but who lost its smelting reads by what it can do
  st.library = [...st.library.filter((q) => q !== k(x, 'copper-smelting') && q !== k(x, 'iron-smelting') && q !== k(x, 'bronze'))];
  st.era = 3;
  assert.notEqual(eraLabel(x, st), 'bronze age');
  // every label a census can meet is consistent: walk the eras with everything up to each
  for (let e = 0; e < ERAS.length; e++) {
    st.library = x.rt.list.filter((r) => r.era <= e && r.base > 0).map((r) => r.idx);
    st.era = computeEra(x, st);
    const label = eraLabel(x, st);
    const has = (id: string) => st.library.includes(k(x, id));
    if (/bronze/.test(label)) assert.ok(has('bronze') || has('copper-smelting'), `${ERAS[e]}: ${label}`);
    if (/stone/.test(label)) assert.ok(!(has('agriculture') && has('pottery')), `${ERAS[e]}: ${label}`);
  }
  // the settlement view carries it (hook H11)
  refreshLibrary(x, st);
  const view = sim.snapshot().planets[0].settlements!.find((v) => v.id === st.id)!;
  assert.equal(view.eraLabel, eraLabel(x, st));
});

test('pace: the next era\'s ideas open only after the era clock\'s dwell, and an idea is built on only once practised', () => {
  const { sim, st } = town();
  const x = ctx(sim);
  const h = histOf(x, st);
  // a town that has just entered the fire era (it knows fire, nothing of clay)
  st.library = ['foraging', 'stone-tools', 'digging-sticks', 'fire-keeping', 'cordage'].map((id) => k(x, id)).sort((a, b) => a - b);
  st.era = computeEra(x, st);
  assert.equal(ERAS[st.era], 'fire');
  h.eraAt[String(st.era)] = x.tick;
  const ag = x.rt.list[k(x, 'agriculture')], pot = x.rt.list[k(x, 'pottery')];
  assert.equal(inventable(x, st, ag), false, 'farming is not theirs to find on the day they first keep fire');
  assert.equal(inventable(x, st, pot), false);
  // ... and it is once they have held the fire era DWELL years
  h.eraAt[String(st.era)] = x.tick - Math.ceil(DWELL[st.era] * x.year);
  assert.equal(inventable(x, st, ag), true, 'after the dwell');
  // the era after next stays shut until its own dwell is spent too
  assert.equal(inventable(x, st, x.rt.list[k(x, 'copper-smelting')]), false, 'no skipping an age');
  // practice: an idea learned today cannot be built on (sickles need agriculture) ...
  st.library = [...st.library, k(x, 'agriculture')].sort((a, b) => a - b);
  h.since.agriculture = x.tick;
  st.era = 2; h.eraAt['2'] = x.tick;
  const sickles = x.rt.list[k(x, 'sickles')];
  assert.equal(practised(x, st, k(x, 'agriculture')), false);
  assert.equal(inventable(x, st, sickles), false, 'sickles wait until farming is practised');
  // ... until it has been known PRACTICE years of its era, or worked PRACTICE_USES times
  h.since.agriculture = x.tick - Math.ceil(PRACTICE[2] * x.year);
  assert.equal(inventable(x, st, sickles), true, 'practised by the years');
  h.since.agriculture = x.tick;
  st.library = [...st.library, k(x, 'charcoal'), k(x, 'kiln-firing')].sort((a, b) => a - b);
  h.since.charcoal = x.tick;
  assert.equal(practised(x, st, k(x, 'charcoal')), false);
  const land = landOf(st);
  land.ledger.push({ ...(land.ledger[0] ?? {}), year: 0, crafts: { charcoal: PRACTICE_USES } } as unknown as (typeof land.ledger)[number]);
  assert.equal(practised(x, st, k(x, 'charcoal')), true, 'practised by use');
});

test('pace: an everyday accident waits for the era clock; a wonder (star iron from the sky) opens the next era at once', () => {
  const { sim, st } = town();
  const x = ctx(sim);
  const h = histOf(x, st);
  st.era = computeEra(x, st);
  assert.equal(ERAS[st.era], 'bronze');
  h.eraAt[String(st.era)] = x.tick;
  const iron = x.rt.list[k(x, 'iron-smelting')];
  assert.ok(st.library.includes(k(x, 'copper-smelting')));
  assert.equal(inventable(x, st, iron), false, 'not by trying, so soon after bronze');
  assert.equal(inventable(x, st, iron, 'iron'), false, 'nor by the iron ore lying about');
  assert.equal(inventable(x, st, iron, 'meteor-iron'), true, 'star iron opens it');
  // an age's institutions come after its crafts: writing waits half the bronze era's dwell after the era began
  st.library = st.library.filter((q) => q !== k(x, 'writing'));
  assert.equal(inventable(x, st, x.rt.list[k(x, 'writing')]), false, 'no writing on the bronze age\'s first day');
  h.eraAt[String(st.era)] = x.tick - Math.ceil(0.5 * DWELL[st.era] * x.year);
  assert.equal(inventable(x, st, x.rt.list[k(x, 'writing')]), true, 'writing, half an age on');
  h.eraAt[String(st.era)] = x.tick;
  // the accident itself: everyday ore teaches nothing beyond the clock, star iron may
  const before = st.library.includes(iron.idx);
  accident(x, st, 'iron', st.cell);
  assert.equal(st.library.includes(iron.idx), before, 'everyday ore: no iron smelting');
  let learned = false;
  for (let t = 0; t < 30 && !learned; t++) { x.tick += 1; accident(x, st, 'meteor-iron', st.cell); learned = st.library.includes(iron.idx); }
  assert.ok(learned, 'star iron taught someone to smelt iron');
});

test('settlement.advance lifts a town one era, everything up to it taught; settlement.teach { era } is the same act', () => {
  const { sim, st } = town();
  const x = ctx(sim);
  st.era = computeEra(x, st);
  const e0 = st.era;
  const c0 = sim.u.chronicle.length;
  const r = must(sim, { k: 'settlement.advance', settlement: st.id });
  assert.equal(st.era, e0 + 1, r.msg);
  assert.ok(st.library.includes(k(x, 'iron-smelting')), 'iron smelting is theirs');
  assert.equal(eraLabel(x, st), 'iron age');
  assert.equal(histOf(x, st).eraAt[String(st.era)], sim.tick, 'the new era\'s clock starts now');
  assert.ok(sim.u.chronicle.slice(c0).some((e) => /god lifted|would have found/i.test(e.text)), 'told once, as the god\'s act');
  const r2 = must(sim, { k: 'settlement.teach', settlement: st.id, era: 'next', force: true } as Command);
  assert.equal(st.era, e0 + 2, r2.msg);
  assert.equal(sim.applyNow({ k: 'settlement.teach', settlement: st.id } as Command).ok, false, 'teach what? (an idea or an era)');
});

test('world.terraform: a barren rock gets air, then seas, then grass and forest, over days; a living world is left alone', () => {
  const sim = new Sim({ seed: 20260, scenario: 'barren', overrides: { n: 32 } });
  const p = sim.u.planets[0];
  const count = (f: (c: number) => boolean) => { let n = 0; for (let c = 0; c < p.count; c++) if (f(c)) n++; return n; };
  assert.equal(p.st.atmosphere.pressure, 0);
  const r = must(sim, { k: 'world.terraform' });
  assert.ok(p.airy, `air at once (${r.msg})`);
  assert.equal(p.st.terraform?.stage, 1);
  must(sim, { k: 'time.scale', tps: 3000 } as Command);
  const day = p.st.dayHours * 60;
  for (let d = 0; d < 24 && (p.st.terraform?.stage ?? 0) < 4; d++) sim.step(day);
  assert.equal(p.st.terraform?.stage, 4, 'every stage ran');
  sim.step(day);
  const wet = count((c) => p.f.water[c] > 0.1 || !!p.s.ocean[c]);
  const green = count((c) => p.f.grass[c] + p.f.shrub[c] + p.f.tree[c] > 0.3);
  assert.ok(wet > p.count * 0.05, `seas and lakes: ${wet} wet cells of ${p.count}`);
  assert.ok(green > p.count * 0.1, `green land: ${green} cells`);
  assert.ok(sim.u.chronicle.some((e) => /air onto/.test(e.text)) && sim.u.chronicle.some((e) => /living world/.test(e.text)), 'chronicled');
  // a world that is alive already is not remade
  const { sim: s2 } = town();
  const q = s2.u.planets[0];
  const air = q.st.atmosphere.pressure, sea = q.st.seaLevel;
  const r2 = s2.applyNow({ k: 'world.terraform' });
  assert.equal(r2.ok, false);
  assert.match(String(r2.msg), /alive already/);
  assert.equal(q.st.terraform, undefined);
  assert.equal(q.st.atmosphere.pressure, air);
  assert.equal(q.st.seaLevel, sea);
});

// ───────────────────────────── §5.1 grievances, secession, kin raids ─────────────────────────────

test('a famine the capital did not relieve while it had food to spare becomes a grievance; aid in the famine is remembered', () => {
  const aidP = POLITICS.aidP;
  try {
    POLITICS.aidP = 0; // (the capital never thinks of it on its own here)
    const { sim, cap, d } = kinTowns();
    const x = ctx(sim);
    feed(x, cap, 20);
    starve(x, d);
    const c0 = sim.u.chronicle.length;
    days(x, 3, () => starve(x, d));
    const h = histOf(x, d);
    assert.ok((h.why.famine ?? 0) >= POLITICS.famine * 0.95, JSON.stringify(h));
    assert.ok(h.grievance >= POLITICS.famine * 0.9, `grievance ${h.grievance}`);
    assert.ok(sim.u.chronicle.slice(c0).some((e) => /went hungry|No bread/.test(e.text)), 'chronicled');
    // the same famine with the capital's food sent: no grievance for it
    const { sim: s2, cap: c2, d: d2 } = kinTowns();
    const x2 = ctx(s2);
    feed(x2, c2, 20);
    starve(x2, d2);
    days(x2, 3, (i) => { starve(x2, d2); if (i === 0) assert.ok(sendAid(x2, c2, d2, 'test'), 'aid sent'); });
    assert.equal(histOf(x2, d2).why.famine ?? 0, 0, 'relieved: no grievance');
    // and none when the capital had nothing to spare either
    const { sim: s3, cap: c3, d: d3 } = kinTowns();
    const x3 = ctx(s3);
    starve(x3, c3);
    starve(x3, d3);
    days(x3, 3, () => { starve(x3, d3); starve(x3, c3); });
    assert.equal(histOf(x3, d3).why.famine ?? 0, 0, 'nothing to give: no grievance');
  } finally { POLITICS.aidP = aidP; }
});

test('tribute: a daughter pays a tithe to its capital each season and remembers it; distance weighs a little each day', () => {
  const { sim, cap, d } = kinTowns();
  const x = ctx(sim);
  feed(x, d, 30);
  const grain = x.c.items.idx('grain');
  const before = (d.store[grain] ?? 0) + x.ps.missions.filter((m) => m.kind === 'tribute').length;
  days(x, POLITICS.tributeDays + 1);
  const h = histOf(x, d);
  assert.ok((h.why.tribute ?? 0) > 0, JSON.stringify(h.why));
  const paid = x.ps.missions.some((m) => m.kind === 'tribute' && m.from === d.id && m.to === cap.id) || (d.store[grain] ?? 0) < before;
  assert.ok(paid, 'the tithe left for the capital');
  assert.ok(walkDays(x, d, cap) > 1, `more than a day's walk (${walkDays(x, d, cap).toFixed(2)})`);
  assert.ok((h.why.distance ?? 0) > 0, 'and the distance tells');
  // a capital holds no grievance against itself
  assert.equal(histOf(x, cap).grievance, 0);
  // the settlement view and the polities query carry it (hooks)
  const view = sim.snapshot().planets[0].settlements!.find((v) => v.id === d.id)!;
  assert.equal(view.grievance, h.grievance);
  const pol = (sim.query('polities', {}) as { id: number; settlements: { id: number; grievance?: number; why?: Record<string, number> }[] }[]).find((q) => q.id === cap.polity)!;
  assert.equal(pol.settlements.find((q) => q.id === d.id)?.grievance, h.grievance);
});

test('a daughter whose grievance runs high breaks away: a new polity, a secession event and a chronicle line naming why', () => {
  const { sim, cap, d } = kinTowns();
  const x = ctx(sim);
  const h = histOf(x, d);
  const polity0 = d.polity;
  sim.drainEvents();
  let n = 0;
  // the old grievances, kept from fading (a town that went hungry three times while the granaries of the capital were full)
  days(x, 400, () => { if (d.polity === polity0) { h.grievance = 0.9; h.why = { famine: 0.6, tribute: 0.2 }; n++; } });
  assert.notEqual(d.polity, polity0, `seceded (after ${n} days at 0.9)`);
  assert.equal(d.polity, d.id);
  assert.notEqual(cap.polity, d.polity);
  assert.ok(n < 300, `within ${n} days at grievance 0.9 (p up to ${POLITICS.maxP} a day)`);
  const evs = sim.drainEvents();
  const ev = evs.find((e) => e.t === 'secession');
  assert.ok(ev, 'a secession event');
  assert.equal((ev!.data as { cause: string }).cause, 'famine');
  assert.ok(sim.u.chronicle.some((e) => e.text.includes(d.name) && /hungry years|starve/i.test(e.text)), 'the chronicle says why');
  // every part a grievance can be made of has its telling
  for (const why of ['tribute', 'famine', 'feud', 'distance', 'tongue', 'raids', 'friction', 'outgrown']) assert.ok(sim.content.events.find(`secession.${why}`), `secession.${why}`);
  // free, it holds no grievance against its old capital: the quarrel is between peoples now
  assert.equal(histOf(x, d).grievance, 0);
  const rel = x.ps.relation(cap.polity, d.polity);
  assert.ok(rel, 'the two peoples have a relation');
  // a famine at the root: a revolt, and war
  assert.ok((ev!.data as { revolt: boolean }).revolt, 'a revolt');
  assert.ok(evs.some((e) => e.t === 'war' && (e.data as { cause: string }).cause === 'revolt'), 'the hungry years end in war');
  // a parting over tribute, in peace: a pact of open roads (a treaty)
  const { sim: s3, cap: c3, d: d3 } = kinTowns();
  const x3 = ctx(s3);
  const h3 = histOf(x3, d3);
  const p3 = d3.polity;
  days(x3, 400, () => { if (d3.polity === p3) { h3.grievance = 0.8; h3.why = { tribute: 0.5, distance: 0.3 }; } });
  assert.notEqual(d3.polity, p3, 'it left');
  const r3 = x3.ps.relation(c3.polity, d3.polity)!;
  assert.equal(r3.war, -1, 'in peace');
  assert.ok(r3.treaties.includes('trade-pact'), JSON.stringify(r3.treaties));
  assert.ok(s3.u.chronicle.some((e) => /parted in peace|pact of open roads/.test(e.text)), 'the parting is told');
  // a contented daughter (grievance under 0.6) never goes
  const { sim: s2, d: d2 } = kinTowns();
  const x2 = ctx(s2);
  const p2 = d2.polity;
  days(x2, 300, () => { histOf(x2, d2).grievance = 0.5; });
  assert.equal(d2.polity, p2, 'still one people at 0.5');
});

test('kin raids: a starving town raids a fat kin town within two days\' walk that it holds low — inside one polity', () => {
  const { sim, cap, d } = kinTowns();
  const x = ctx(sim);
  assert.equal(cap.polity, d.polity);
  assert.ok(walkDays(x, d, cap) <= POLITICS.raidDays, `within reach (${walkDays(x, d, cap).toFixed(2)} days)`);
  feed(x, cap, 30);
  const h = histOf(x, d);
  let raided = false;
  days(x, 60, () => { starve(x, d); h.kin[String(cap.id)] = 0; raided ||= x.ps.missions.some((m) => m.kind === 'raid' && m.from === d.id && m.to === cap.id); });
  assert.ok(kinOpinion(x, d, cap) < 0.3);
  assert.ok(raided, 'a raiding party set out for the capital');
  // a town held dear is not raided, however hungry
  const { sim: s2, cap: c2, d: d2 } = kinTowns();
  const x2 = ctx(s2);
  feed(x2, c2, 30);
  let r2 = false;
  days(x2, 60, () => { starve(x2, d2); histOf(x2, d2).kin[String(c2.id)] = 0.9; histOf(x2, d2).grievance = 0; r2 ||= x2.ps.missions.some((m) => m.kind === 'raid' && m.from === d2.id); });
  assert.equal(r2, false, 'no raid on a town they love');
});

test('raiders drive off livestock: a share of the raided town\'s largest herd goes home with them', () => {
  const { sim, cap, d } = kinTowns();
  const x = ctx(sim);
  const sheep = x.c.animals.idx('sheep');
  const herd = spawnHerd(x, sheep, cap.cell, 12, cap.id);
  const who = volunteers(x, d, 4, true);
  const m = newMission(x, 'raid', d, cap, who)!;
  assert.ok(m, 'a raiding party');
  const note = plunder(x, m, d, cap);
  assert.ok(herd.count < 12, `the herd shrank (${herd.count})`);
  const taken = x.ps.herds.find((h) => h.owner === d.id && h.species === sheep);
  assert.ok(taken && taken.count >= 1, 'the raiders own some of it now');
  assert.match(note, /head of sheep/);
});

test('a polity\'s capital is the town that founded it, whichever of its towns is asked about first', () => {
  const { sim, cap, d } = kinTowns();
  const x = ctx(sim);
  x.ps.polities = x.ps.polities.filter((q) => q.id !== cap.polity);
  // the daughter is stepped (and its polity looked up) before its mother
  assert.equal(polityOf(x, d)!.capital, cap.id);
  days(x, 2);
  assert.ok((histOf(x, d).why.tribute ?? 0) + (histOf(x, d).why.distance ?? 0) > 0, 'the daughter, not the mother, holds the grievance');
  assert.equal(histOf(x, cap).grievance, 0);
});

test('history is saved: a daughter\'s grievance and era clock survive save and load, and the world\'s hash with them', () => {
  const { sim, d } = kinTowns();
  const x = ctx(sim);
  days(x, 4);
  histOf(x, d).grievance = 0.42;
  sim.step(1440);
  const bytes = sim.save();
  const b = Sim.load(bytes);
  assert.equal(b.hash(), sim.hash());
  const d2 = b.u.planets[0].people.settlement(d.id)!;
  assert.ok(d2.hist, 'the record came back');
  assert.equal(d2.hist!.grievance, d.hist!.grievance);
  assert.deepEqual(d2.hist!.eraAt, d.hist!.eraAt);
  sim.step(1440); b.step(1440);
  assert.equal(b.hash(), sim.hash(), 'and runs on the same');
});
