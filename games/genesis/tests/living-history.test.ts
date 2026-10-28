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
import { accident, computeEra, refreshLibrary, inputsSeen } from '../src/sim/people/knowledge.ts';
import { histOf, kinOpinion, POLITICS, sendAid, popOf, walkDays } from '../src/sim/people/politics.ts';
import { politicsDaily, polityOf, plunder, conquer, resolveArrival, secede } from '../src/sim/people/war.ts';
import { spawnHerd } from '../src/sim/life/herds.ts';
import { BUD_POP, BUD_APART, BUD_HOME, splitOff } from '../src/sim/people/settlement.ts';
import { newMission, volunteers } from '../src/sim/people/missions.ts';
import { DWELL, PRACTICE, PRACTICE_USES, eraLabel, inventable, practised } from '../src/sim/people/eras.ts';
import { landOf } from '../src/sim/people/ledger.ts';
import { ERAS } from '../src/sim/content.ts';
import { NT, TRAIT } from '../src/sim/people/defs.ts';
import { BuildingFlag } from '../src/sim/types.ts';

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
    // (fix r2 #14: a daughter in its first POLITICS.youngYears is always relieved and never blames its mother — this
    // case is an established daughter, founded three years ago; the young one is the next test)
    d.founded = x.tick - 3 * x.year;
    feed(x, cap, 20);
    starve(x, d);
    const c0 = sim.u.chronicle.length;
    days(x, 3, () => starve(x, d));
    const h = histOf(x, d);
    assert.ok((h.why.famine ?? 0) >= POLITICS.famine * 0.95, JSON.stringify(h));
    assert.ok(h.grievance >= POLITICS.famine * 0.9, `grievance ${h.grievance}`);
    assert.ok(sim.u.chronicle.slice(c0).some((e) => /went hungry|No bread/.test(e.text)), 'chronicled');
    // (fix r2 #14) a young daughter (founded this year) in the same famine: the mother sends food unasked, no grievance
    const { sim: s1, cap: c1, d: d1 } = kinTowns();
    const x1 = ctx(s1);
    assert.ok(x1.tick - d1.founded < POLITICS.youngYears * x1.year, 'a young daughter');
    feed(x1, c1, 20);
    starve(x1, d1);
    days(x1, 3, () => starve(x1, d1));
    const h1 = histOf(x1, d1);
    assert.ok(h1.aid >= 0, `the mother sent food (${JSON.stringify(h1)})`);
    assert.equal(h1.why.famine ?? 0, 0, 'a young daughter does not blame its mother');
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
  // (a calm chief with no war party at the capital: it lets its daughter go — a hot one may not, see the test below)
  x3.A.traits[x3.A.slotOf(c3.leader) * NT + TRAIT.aggression] = 0;
  c3.factions = (c3.factions ?? []).filter((f) => f.kind !== 'hawks');
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

// (fix r2 #5) a war band still on the road when its war ended in a conquest fought a town of its own polity on arrival:
// 'Mashnam by the Lake fell to the chiefdom of Mashnam', a chief removed, refugees from a town that was never taken
test('a war ends with its conquest: the bands on the road go home, no town is conquered by its own polity, the winner keeps its chief (fix r2 #5)', () => {
  const { sim, cap, d } = kinTowns();
  const x = ctx(sim);
  secede(x, d, polityOf(x, cap)!, 'revolt');
  assert.notEqual(d.polity, cap.polity);
  const r = x.ps.relation(cap.polity, d.polity)!;
  assert.ok(r && r.war >= 0, 'the revolt is a war');
  // a band of the rebels marches on the capital, and one of the capital's on the rebels
  const out = newMission(x, 'war', d, cap, volunteers(x, d, 4, true))!;
  const back = newMission(x, 'war', cap, d, volunteers(x, cap, 4, true))!;
  assert.ok(out && back, 'two war bands set out');
  const chief = cap.leader;
  const t0 = sim.u.tick;
  // the rebel town falls (its only town: the war ends)
  conquer(x, cap, d, null);
  assert.equal(d.polity, cap.polity);
  assert.ok(r.war < 0, 'the war is over');
  assert.ok(out.phase >= 3 && back.phase >= 3, `both bands turn for home (phases ${out.phase}, ${back.phase})`);
  // a war band that arrives at a town of its own polity goes home without a fight; nobody conquers their own
  const late = newMission(x, 'war', d, cap, volunteers(x, d, 3, true))!;
  late.phase = 2;
  resolveArrival(x, late, d, cap);
  assert.equal(late.phase, 3, 'the late band goes home');
  conquer(x, d, cap, null);
  assert.equal(cap.leader, chief, 'the capital keeps its chief');
  assert.equal(cap.recent.conquered, undefined, 'the capital was never conquered');
  sim.step(2 * 1440);
  const lines = sim.u.chronicle.filter((c) => c.tick > t0).map((c) => c.text);
  assert.ok(!lines.some((l) => /stood firm against|won the day|lay dead/.test(l)), `no battle after the war: ${lines.filter((l) => /battle|warriors|stood/i.test(l)).join(' | ')}`);
  assert.ok(!lines.some((l) => new RegExp(`${cap.name} fell to`).test(l)), 'the capital did not fall to its own polity');
  assert.equal(cap.leader, chief);
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

// ───────────────────────────── §5.6 second pass: hard times, the restless everyday, the capital's answer ─────────────────────────────

test('a disaster on a daughter that the capital, with food to spare, left unrelieved is neglect; aid in it is not held against it', () => {
  const aidP = POLITICS.aidP;
  try {
    POLITICS.aidP = 0; // (the capital never thinks of it on its own here)
    const { sim, cap, d } = kinTowns();
    const x = ctx(sim);
    d.founded = x.tick - 3 * x.year; // (an established daughter: a young one is always relieved — fix r2 #14)
    feed(x, cap, 20);
    feed(x, d, 20);
    // a flood over the daughter (not the capital, 1.1–1.7 km away): a hard time though its granary is full
    must(sim, { k: 'disaster.spawn', kind: 'flood', pos: [...d.pos] } as Command);
    const c0 = sim.u.chronicle.length;
    days(x, 3);
    const h = histOf(x, d);
    assert.ok((h.why.neglect ?? 0) >= POLITICS.neglect * 0.95, JSON.stringify(h.why));
    assert.equal(h.why.famine ?? 0, 0, 'not a famine: its stores are full');
    assert.ok(sim.u.chronicle.slice(c0).some((e) => e.text.includes(d.name) && /buried its dead alone|granaries shut/.test(e.text)), 'chronicled');
    // the inspector sees the hard time and that no help came (query settlement → history.grievance.hard)
    const hv = (sim.query('settlement', { id: d.id }) as { history: { grievance: { hard?: { kind: string; relieved: boolean } } } }).history.grievance.hard;
    assert.deepEqual([hv?.kind, hv?.relieved], ['disaster', false], JSON.stringify(hv));
    // the same flood with the capital's help sent at once: nothing held against it
    const { sim: s2, cap: c2, d: d2 } = kinTowns();
    const x2 = ctx(s2);
    feed(x2, c2, 20);
    feed(x2, d2, 20);
    must(s2, { k: 'disaster.spawn', kind: 'flood', pos: [...d2.pos] } as Command);
    s2.drainEvents();
    days(x2, 3, (i) => { if (i === 0) assert.ok(sendAid(x2, c2, d2, 'disaster'), 'help sent'); });
    assert.equal(histOf(x2, d2).why.neglect ?? 0, 0, 'relieved: no grievance');
    const aid = s2.drainEvents().find((e) => e.t === 'aid');
    assert.equal((aid?.data as { why: string } | undefined)?.why, 'disaster', 'the aid event says why');
    assert.ok(s2.u.chronicle.some((e) => /After the disaster|stricken/.test(e.text)), 'the help is told as relief, not famine');
    // a day of calamity deaths (fire, drowning ...) in the town's books is a hard time with no disaster seen over it
    const { sim: s3, cap: c3, d: d3 } = kinTowns();
    const x3 = ctx(s3);
    d3.founded = x3.tick - 3 * x3.year;
    feed(x3, c3, 20);
    feed(x3, d3, 20);
    days(x3, 1);
    assert.equal(histOf(x3, d3).famine, -1, 'no hard time yet');
    const row = landOf(d3).ledger.length ? landOf(d3).ledger[landOf(d3).ledger.length - 1] : null;
    if (row) row.deaths.fire = (row.deaths.fire ?? 0) + 3;
    else landOf(d3).ledger.push({ year: Math.floor(x3.tick / x3.year), deaths: { fire: 3 } } as never);
    days(x3, 3);
    assert.ok((histOf(x3, d3).why.neglect ?? 0) > 0, `three burned in a day: ${JSON.stringify(histOf(x3, d3).why)}`);
    for (const why of ['neglect', 'refused']) assert.ok(sim.content.events.find(`secession.${why}`), `secession.${why}`);
  } finally { POLITICS.aidP = aidP; }
});

test('the everyday makes a town restless, no more: tribute and distance stop at the ambient cap; a wrong on top carries it past 0.6', () => {
  const aidP = POLITICS.aidP;
  try {
    POLITICS.aidP = 0;
    const { sim, cap, d } = kinTowns();
    const x = ctx(sim);
    feed(x, cap, 30);
    feed(x, d, 30);
    assert.ok(walkDays(x, d, cap) > 1, 'more than a day\'s walk: the distance weighs');
    const h = histOf(x, d);
    h.grievance = POLITICS.ambientCap - 0.01;
    h.why = { distance: 0.3, tribute: POLITICS.ambientCap - 0.31 };
    days(x, 40);
    assert.ok(h.grievance <= POLITICS.ambientCap + 1e-9, `restless, no more: ${h.grievance}`);
    assert.ok(h.grievance >= POLITICS.ambientCap - 0.03, `and kept there by the everyday: ${h.grievance}`);
    assert.ok(h.grievance < POLITICS.threshold);
    // a wrong done on top of it: a disaster left unrelieved
    must(sim, { k: 'disaster.spawn', kind: 'flood', pos: [...d.pos] } as Command);
    days(x, 3);
    assert.ok(h.grievance > POLITICS.threshold, `neglect on the restless: ${h.grievance}`);
  } finally { POLITICS.aidP = aidP; }
});

test('a capital with a hot-headed chief will not let a daughter part in peace: war to bring it back; a calm one lets it go with a pact', () => {
  const G = { refuse: POLITICS.refuse, refuseMax: POLITICS.refuseMax };
  try {
    const run = (aggr: number) => {
      const { sim, cap, d } = kinTowns();
      const x = ctx(sim);
      const s = x.A.slotOf(cap.leader);
      assert.ok(s >= 0, 'the capital has a chief');
      x.A.traits[s * NT + TRAIT.aggression] = aggr;
      cap.factions = (cap.factions ?? []).filter((f) => f.kind !== 'hawks');
      const h = histOf(x, d);
      const p0 = d.polity;
      sim.drainEvents();
      // the old grievance of tribute and distance, kept from fading (not bitter: no hunger, no raids, under 0.85)
      days(x, 400, () => { if (d.polity === p0) { h.grievance = 0.75; h.why = { tribute: 0.45, neglect: 0.3 }; } });
      assert.notEqual(d.polity, p0, 'it left');
      return { sim, x, cap, d, evs: sim.drainEvents() };
    };
    POLITICS.refuse = 1; POLITICS.refuseMax = 1;
    const hot = run(1);
    const r = hot.x.ps.relation(hot.cap.polity, hot.d.polity)!;
    assert.ok(r.war >= 0 || hot.evs.some((e) => e.t === 'war'), 'war');
    const war = hot.evs.find((e) => e.t === 'war')!;
    assert.equal((war.data as { aggressor: number }).aggressor, hot.cap.polity, 'the capital made the war');
    assert.equal((war.data as { cause: string }).cause, 'revolt');
    assert.ok(!r.treaties.includes('trade-pact'), 'no pact');
    assert.ok(hot.sim.u.chronicle.some((e) => /would not let|rebellion/.test(e.text)), 'told');
    POLITICS.refuse = G.refuse; POLITICS.refuseMax = G.refuseMax;
    const calm = run(0);
    const rc = calm.x.ps.relation(calm.cap.polity, calm.d.polity)!;
    assert.equal(rc.war, -1, 'a calm chief lets it go');
    assert.ok(rc.treaties.includes('trade-pact'), JSON.stringify(rc.treaties));
  } finally { POLITICS.refuse = G.refuse; POLITICS.refuseMax = G.refuseMax; }
});

test('a people that smelts copper and tin has seen both metals: bronze is within its thinking though none lies in the store', () => {
  const { sim, st } = town();
  const x = ctx(sim);
  const s = (x.ps.members.get(st.id) ?? [])[0];
  const it = (id: string) => x.c.items.idx(id);
  const bronze = x.rt.list[k(x, 'bronze')];
  // ores and wood in the store; no copper, no tin, no charcoal; nothing in anyone's hands that matters here
  for (const id of ['copper', 'tin', 'charcoal', 'bronze']) st.store[it(id)] = 0;
  st.store[it('copper-ore')] = 6; st.store[it('tin-ore')] = 6; st.store[it('wood')] = 10;
  if (st.res) for (const id of ['copper', 'tin', 'charcoal']) delete st.res.items[String(it(id))];
  const without = (ids: string[]) => { st.library = st.library.filter((q) => !ids.map((i) => k(x, i)).includes(q)); };
  assert.ok(st.library.includes(k(x, 'copper-smelting')) && st.library.includes(k(x, 'tin-smelting')) && st.library.includes(k(x, 'charcoal')));
  assert.equal(inputsSeen(x, s, st, bronze), true, 'copper from its ore and charcoal from wood, tin from its ore: two crafts deep');
  // a people that cannot smelt tin has never seen the metal
  const lib = st.library.slice();
  without(['tin-smelting']);
  assert.equal(inputsSeen(x, s, st, bronze), false, 'no tin-smelting: no tin');
  st.library = lib.slice();
  // three crafts deep is beyond its thinking: no charcoal-burning, no wood but the charcoal itself to come from it
  without(['charcoal']);
  assert.equal(inputsSeen(x, s, st, bronze), false, 'no charcoal-burning: the smelting\'s fuel is not theirs');
  st.library = lib.slice();
  // and the ores must be there to see: without copper ore anywhere, no copper
  st.store[it('copper-ore')] = 0;
  if (st.res) delete st.res.items[String(it('copper-ore'))];
  assert.equal(inputsSeen(x, s, st, bronze), false, 'no copper ore: no copper');
});

// (fix r1 #10/#17) a world left alone stayed one village for 50 years (acceptance §5.1): a village past BUD_POP buds
test('a village of fifty buds a daughter village a short walk away: young households, whole, in the same polity (fix r1 #10)', () => {
  // (the n = 64 world of the alone runs: on the small test world, radius 3 km, no site 0.7-2.5 km off can be walked to)
  const sim = new Sim({ seed: 20261008, scenario: 'sandbox', overrides: { n: 64, vegetation: 1 } });
  must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
  const r = must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 56, era: 'bronze', settled: true });
  const p = sim.u.planets[0];
  const ps = p.people;
  const st = ps.settlement(r.created!.find((e) => e.kind === 'settlement')!.id)!;
  const year = Math.round(p.st.orbit.period);
  // five years old (the gate), a time-lapse speed for the waiting
  st.founded = sim.u.tick - 6 * year;
  must(sim, { k: 'time.scale', tps: 3000 });
  const before = ps.members.get(st.id)!.length;
  assert.ok(before >= BUD_POP, `a village of ${before}`);
  let child: Settlement | undefined;
  for (let d = 0; d < 90 && !child; d++) {
    sim.step(1440);
    child = ps.settlements.find((o) => o.parent === st.id && o.fallen < 0);
  }
  assert.ok(child, 'a daughter village sets out within 90 days');
  const A = ps.agents;
  const kids = ps.members.get(child!.id)!;
  const adults = kids.filter((s) => !(A.flags[s] & 1)).length;
  const home = ps.members.get(st.id)!.length;
  assert.ok(adults >= 10, `at least ten adults leave (${adults})`);
  assert.ok(home >= 28, `at least 28 stay (${home})`);
  assert.equal(child!.polity, st.polity, 'the daughter is of the same polity');
  assert.ok(!kids.some((s) => A.id[s] === st.leader), 'the leader stays');
  // whole households: nobody of a leaving household stays behind
  for (const h of child!.households) for (const id of h.members) assert.equal(A.settlement[A.slotOf(id)], child!.id, `household ${h.id} moved whole`);
  for (const h of st.households) assert.ok(!child!.households.some((q) => q.id === h.id), `household ${h.id} is in one village only`);
  // where to: 0.7-2.5 km off, and they get there and build
  const to = child!.target ?? child!.pos;
  const dist = distM(p, to, st.pos);
  assert.ok(dist >= 650 && dist <= 2600, `a short walk away (${Math.round(dist)} m)`);
  const t0 = sim.u.tick;
  for (let d = 0; d < 12 && child!.band; d++) sim.step(1440);
  assert.equal(child!.band, false, 'the daughter village is founded');
  assert.ok(distM(p, child!.pos, st.pos) >= 600, 'a village of its own, not a quarter of the old one');
  const lines = sim.u.chronicle.filter((c) => c.tick >= t0 - 90 * 1440).map((c) => c.text);
  assert.ok(lines.some((l) => /daughter village|cleared new ground/.test(l)), `the chronicle tells it: ${lines.slice(-4).join(' | ')}`);
  // not again for eight years
  assert.ok(st.recent.budAt !== undefined, 'the village remembers its budding');
});

// (fix r3 #17) a budding band that lost the ground chosen for it re-searched around where it stood — beside its mother —
// and founded there (seed 1: a daughter 101 m from her mother, their buildings 9 m apart; before this fix the probe
// fix3/budnear.ts founded this one 168 m off): the bud's own rule holds wherever the band ends up, and a bud that finds
// no free ground goes home
test('a budding band that loses its ground never founds within 600 m of a town, and one that finds none goes home (fix r3 #17)', () => {
  const sim = new Sim({ seed: 20261008, scenario: 'sandbox', overrides: { n: 64, vegetation: 1 } });
  must(sim, { k: 'set', path: 'disasters.natural', value: 0 });
  const r = must(sim, { k: 'life.spawn-people', species: 'plains-folk', count: 56, era: 'bronze', settled: true });
  const p = sim.u.planets[0];
  const ps = p.people;
  const st = ps.settlement(r.created!.find((e) => e.kind === 'settlement')!.id)!;
  sim.step(1440);
  const leave = () => st.households.filter((h) => h.members.length && !h.members.includes(st.leader)).slice(0, 4);
  // (a) the target is lost at once: the band re-searches from its mother's door
  const a = splitOff(makeCtx(sim.u, p), st, leave(), 'bud', st.cell)!;
  a.recent.bud = sim.u.tick;
  a.target = null;
  for (let d = 0; d < 20 && a.band && a.fallen < 0; d++) sim.step(1440);
  if (a.fallen < 0) {
    assert.equal(a.band, false, 'the daughter is founded (or went home)');
    for (const o of ps.settlements) if (o.fallen < 0 && !o.band && o.id !== a.id) {
      assert.ok(distM(p, o.pos, a.pos) >= BUD_APART, `${a.name} stands ${Math.round(distM(p, o.pos, a.pos))} m from ${o.name}`);
    }
  }
  // (b) a bud out past BUD_HOME days with its ground lost goes home to its mother, and the chronicle says so
  const n0 = ps.members.get(st.id)!.length;
  const b = splitOff(makeCtx(sim.u, p), st, leave(), 'bud', st.cell)!;
  const went = ps.members.get(b.id)!.length;
  b.recent.bud = sim.u.tick - (BUD_HOME + 1) * makeCtx(sim.u, p).day;
  b.target = null;
  const c0 = sim.u.chronicle.length;
  for (let i = 0; i < 40 && b.fallen < 0; i++) sim.step(120);
  assert.ok(b.fallen >= 0, 'the band went home');
  assert.ok(ps.members.get(st.id)!.length >= n0 - 2, `its people are back in ${st.name} (${ps.members.get(st.id)!.length} of ${n0}; ${went} left)`);
  const told = sim.u.chronicle.slice(c0).map((e) => e.text);
  assert.ok(told.some((t) => /found no free ground and came home/.test(t)), told.join(' | '));
});

// (fix r2 #7) a disaster that ruins half a town sends some households to their kin: the chronicle tells of the ruin,
// never of "conquerors" who were not there (the refugees line was the conquest's own)
test('history: households that leave a town a disaster ruined are told as leaving their ruined homes, not as fleeing conquerors', () => {
  const { sim, cap } = kinTowns();
  const p = sim.u.planets[0];
  for (const b of p.people.of(cap.id)) if (b.progress >= 1) b.flags |= BuildingFlag.ruined;
  const c0 = sim.u.chronicle.length;
  const id = must(sim, { k: 'disaster.spawn', kind: 'quake', pos: cap.pos, duration: 20 }).created![0].id;
  for (let i = 0; i < 40 && sim.u.god.disaster(id); i++) sim.step(10);
  assert.ok(!sim.u.god.disaster(id), 'the quake is over');
  const told = sim.u.chronicle.slice(c0).map((e) => e.text);
  assert.ok(!told.some((t) => /conquerors/.test(t)), told.join(' | '));
  assert.ok(told.some((t) => /left their ruined homes for their kin at/.test(t)), told.join(' | '));
});
