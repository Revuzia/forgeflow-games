// POWERS-GROWTH §6: the god's card, the cost line, the three states, the town line, the toast, the setting and the F1 text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { townLines, townBars, readyLine, priceArgs, settingOf, LEGACY_LABEL, FIRST_HINT, hintDismiss, type SimTown, standingLine, nextLine, gaugeTitle, barTitle, reachCard, costLine, powerState, stateTitle, lockMark, townReachLines, townRoadWords, standingToast, settingCommand, SETTING_CHOICES, ReachFeed, type ReachView } from '../src/ui/reach.ts';
import { PowerBook, type Power } from '../src/ui/powers.ts';
import { livingRows } from '../src/ui/controlstext.ts';

const R = (o: Partial<ReachView> = {}): ReachView => ({
  bound: true, tier: 1, standing: 'Whispered', best: 1, following: 14, believers: 23, trust: 23, fear: 21, both: 21, trustShare: 0.5, fearShare: 0.45, share: 0.4,
  pool: 46, cap: 89, gathered: { total: 9, trust: 6, fear: 3 }, measure: 12, given: 4, next: { tier: 2, standing: 'Known', f: 30, share: 0.5, shareF: 20, held: 0, hold: 30 }, falling: 0, ...o,
});
const P = (o: Partial<Power> = {}): Power => ({ id: 'storm', name: 'Storm', category: 'Sky', icon: '', ring: 1, gesture: null, sigil: null, command: 'weather.spawn', params: {}, schema: {}, target: 'region', synonyms: [], desc: '', ...o });
const BANNED = /\b(good|evil|kind|cruel|light|dark)\b/i;

test('the standing and the next step, in plain words', () => {
  assert.equal(standingLine(R()), 'They call you the Whispered.');
  assert.equal(nextLine(R()), 'Known when 30 follow (14 now).');
  assert.equal(nextLine(R({ next: { tier: 2, standing: 'Known', f: 30, share: 0.5, shareF: 20, held: 12, hold: 30 } })), 'Known when they have followed a season: 12 of 30 days.');
  assert.equal(nextLine(R({ falling: 9 })), 'Fewer speak your name. Nine days.');
  assert.equal(nextLine(R({ next: null })), '');
});

test('the gauge tooltip and the two bar tooltips', () => {
  assert.equal(gaugeTitle(R()), 'Worship 46 of 89. The people gave 9 yesterday, 6 in trust and 3 in fear.');
  assert.equal(gaugeTitle(R({ believers: 0 })), 'No one gives to you yet.');
  assert.match(barTitle(R(), 'trust'), /^23 trust you/);
  assert.match(barTitle(R(), 'fear'), /^21 fear you; 21 of them both/);
});

test('the card carries two independent bars, both can be full, nothing compares them', () => {
  const c = reachCard(R({ trustShare: 1, fearShare: 1 }))!;
  assert.equal(c.trust, 100);
  assert.equal(c.fear, 100);
  assert.equal(reachCard(R({ bound: false })), null);
  const all = JSON.stringify(c);
  assert.ok(!BANNED.test(all));
  const hud = readFileSync(new URL('../src/ui/living.ts', import.meta.url), 'utf8');
  assert.match(hud, /gn-reach-trust/);
  assert.match(hud, /gn-reach-fear/);
  assert.ok(!/trustShare\s*[-<>]\s*fearShare|fear\s*-\s*trust|trust\s*-\s*fear/.test(readFileSync(new URL('../src/ui/reach.ts', import.meta.url), 'utf8')));
});

test('the cost line says the sim\'s own number: free, priced, at size, beyond, free clay, free deed; none unbound', () => {
  assert.equal(costLine(P()), null);
  assert.equal(costLine(P({ free: true, price: 0, priceNow: 0 })), 'Free.');
  assert.equal(costLine(P({ price: 15, priceNow: 15 })), 'Costs 15 worship.');
  // the sized price is the sim's answer (reach.price), not a UI formula
  assert.equal(costLine(P({ price: 15, priceNow: 15 }), { priceNow: 30, basePrice: 15 }), 'Costs 30 worship at this size.');
  assert.equal(costLine(P({ price: 100, priceNow: 300, beyond: true })), 'Beyond your standing: 300 worship.');
  assert.equal(costLine(P({ price: 15, priceNow: 0, clay: true })), 'Free on empty ground.');
  assert.equal(costLine(P({ price: 15, priceNow: 15 }), { priceNow: 0, clay: true }), 'Free on empty ground.');
  assert.match(costLine(P({ price: 15, priceNow: 0, freeDeed: true }))!, /^Free: the first deed/);
  assert.deepEqual(priceArgs(P(), { radius: 90, power: 2 }, { planet: 0 }), { id: 'storm', radius: 90, power: 2, planet: 0 });
  assert.ok(!/sizedPrice/.test(readFileSync(new URL('../src/ui/reach.ts', import.meta.url), 'utf8')));
});

test('the still-gathering line is the sim\'s cooldown text', () => {
  assert.equal(readyLine(P({ priceNow: 15, cooldownText: 'Ready in 12 minutes.' })), 'Still gathering strength. Ready in 12 minutes.');
  assert.equal(readyLine(P({ priceNow: 15, cooldownText: null })), null);
  assert.equal(readyLine(P({ priceNow: 15 }), { cooldownText: 'Ready in 2 hours.' }), 'Still gathering strength. Ready in 2 hours.');
});

test('the powers book keeps the new fields, clears them unbound, and marks the sim\'s free basics', () => {
  const b = new PowerBook();
  const id = b.list[0].id;
  b.applyReach([{ id, priceNow: 0, clay: true, size: 2, basePrice: 15, cooldownText: 'Ready in 2 hours.', readyIn: 120, freeDeed: true, strict: true }]);
  const p = b.list[0];
  assert.equal(p.clay, true); assert.equal(p.readyIn, 120); assert.equal(p.freeDeed, true);
  b.markFree([id]);
  assert.equal(p.free, true);
  b.applyReach([{ id }]);
  assert.equal(p.clay, undefined); assert.equal(p.cooldownText, undefined);
});

test('three wheel states, each with its plain tooltip', () => {
  assert.equal(powerState(P()), 'open');
  assert.equal(powerState(P({ priceNow: 15, affordable: true, locked: false })), 'open');
  const poor = P({ priceNow: 15, affordable: false, reason: 'Storm needs 15 worship; 9 is gathered. About a day more.' });
  assert.equal(powerState(poor), 'poor');
  assert.match(stateTitle(poor, R())!, /Storm needs 15 worship/);
  const locked = P({ locked: true, reason: 'Beyond your reach. Plenty opens when you are Worshipped: 70 follow, 14 now.' });
  assert.equal(powerState(locked), 'locked');
  assert.match(stateTitle(locked, R())!, /^Beyond your reach/);
  assert.equal(lockMark(locked), 'Worshipped');
  assert.equal(stateTitle(P(), R()), null);
});

test('PowerBook takes the sim fields, and clears them when the world is unbound', () => {
  const b = new PowerBook();
  const id = b.list[0].id;
  b.applyReach([{ id, priceNow: 15, locked: false, affordable: false, reason: 'x', price: 15, free: false, tier: 1 }]);
  assert.equal(b.priceOf(b.list[0]), 15);
  assert.equal(b.affordable(b.list[0]), false);
  assert.equal(b.reachShort(b.list[0]), 'x');
  b.applyReach([{ id, tier: 1, price: 15, free: false }]);
  assert.equal(b.priceOf(b.list[0]), null);
  assert.equal(b.lockedBy(b.list[0]), null);
  assert.equal(costLine(b.list[0]), null);
});

test('a newly opened power is fresh once', () => {
  const f = new ReachFeed();
  f.noteLocks([{ id: 'a', locked: true }, { id: 'b', locked: false }]);
  assert.equal(f.noteLocks([{ id: 'a', locked: false }, { id: 'b', locked: false }]), 1);
  assert.equal(f.takeFresh('a'), true);
  assert.equal(f.takeFresh('a'), false);
  assert.equal(f.takeFresh('b'), false);
});

test('the pulse is off under reduce motion', () => {
  const css = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8');
  assert.match(css, /body\.gn-reduce-motion \.gn-rad-pow\.gn-rad-new[^{]*\{[^}]*animation: none/);
});

test('the town lines', () => {
  assert.deepEqual(townReachLines({ pop: 30, believers: 22, trust: 20, fear: 5, gave: 12 }), ['22 of 30 believe, most in trust. They gave 12 yesterday.']);
  assert.deepEqual(townReachLines({ spent: true, unseen: true }), ['They have given all they will today.', 'You have not been seen here; they give less.']);
  assert.equal(townRoadWords({ trust: 0.5, fear: 0.5 }), 'They give to you in trust and in fear.');
  assert.equal(townRoadWords({ trust: 0.02, fear: 0.01 }), null);
});

test('the town line from the sim\'s per-town fields: words for trust and fear, every extra', () => {
  const T = (o: Partial<SimTown> = {}): SimTown => ({ planet: 0, settlement: 1, name: 'Ash', believers: 22, trust: 20, fear: 5, both: 3, measure: 12, given: 4, left: 8, gaveYesterday: { total: 12, trust: 9, fear: 3 }, attended: true, unseen: false, link: 1, linkParts: { trade: 0, pilgrims: 0, kin: 0 }, proud: false, defiant: false, brokenCovenant: false, givesHalf: false, freeDeed: false, ...o });
  assert.deepEqual(townLines(T(), 30), ['22 of 30 believe, most in trust. They gave 12 yesterday.']);
  assert.match(townLines(T({ trust: 3, fear: 19 }), 30)[0], /most in fear/);
  const all = townLines(T({ left: 0, linkParts: { trade: 0.5, pilgrims: 0, kin: 0 }, unseen: true, proud: true, brokenCovenant: true }), 30);
  assert.equal(all.length, 6);
  assert.ok(all.some((l) => /given all they will today/.test(l)) && all.some((l) => /Trade and pilgrims/.test(l)) && all.some((l) => /not been seen/.test(l)) && all.some((l) => /proud/.test(l)) && all.some((l) => /broken/.test(l)));
  assert.deepEqual(townLines(T({ defiant: true, proud: true }), 30).slice(1), ['They count for nothing while they defy you.']);
  assert.ok(!/\d/.test(townLines(T(), 30).join('').replace(/\d+ of \d+|gave \d+/g, '')), 'trust and fear are said in words');
  assert.deepEqual(townBars(T(), 40), { trust: 50, fear: 13 });
  assert.equal(townBars(T({ believers: 0 }), 40), null);
  assert.deepEqual(townLines(null, 30), []);
});

test('the toast on a rise and a fall; none for other events', () => {
  assert.equal(standingToast('reach.rose', { name: 'Known' })!.text, 'They call you the Known now.');
  assert.match(standingToast('reach.fell', { name: 'Whispered' })!.text, /^Fewer speak your name/);
  assert.equal(standingToast('reach.falling', { name: 'x' }), null);
});

test('the setting: three positions, the commands, the read-only legacy label, no banned words', () => {
  assert.deepEqual(SETTING_CHOICES.map((c) => c.value), ['unbound', 'bound', 'strict']);
  assert.deepEqual(settingCommand('bound'), { k: 'meta.reach', bound: true, strict: false });
  assert.deepEqual(settingCommand('unbound'), { k: 'meta.reach', bound: false });
  assert.deepEqual(settingCommand('strict'), { k: 'meta.reach', bound: true, strict: true });
  assert.equal(settingOf(R()), 'bound');
  assert.equal(settingOf(R({ strict: true })), 'strict');
  assert.equal(settingOf(R({ bound: false })), 'unbound');
  assert.equal(settingOf(null), 'unbound');
  assert.equal(LEGACY_LABEL.label, 'Restraint (old save)');
});

test('the god window and the town card carry the standing and the two bars when bound; the first-run hint', () => {
  const living = readFileSync(new URL('../src/ui/living.ts', import.meta.url), 'utf8');
  assert.match(living, /export function reachBlock/);
  assert.match(living, /reach\?\.\(\)/);
  const insp = readFileSync(new URL('../src/ui/inspector.ts', import.meta.url), 'utf8');
  assert.match(insp, /townLines\(/);
  assert.match(insp, /gn-reach-trust/);
  assert.match(FIRST_HINT, /^Small acts are always yours\. Greater works are paid in worship, and the people give as they believe\.$/);
  assert.ok(!BANNED.test(FIRST_HINT));
  hintDismiss();
  const css = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8');
  assert.match(css, /body\.gn-reduce-motion \.gn-reach-hint[^{]*\{[^}]*animation: none/);
});

test('the F1 card says it, and no owner-banned word appears in any new text', () => {
  const row = livingRows(() => '').find(([k]) => k === 'standing and worship');
  assert.ok(row && /Trust and Fear/.test(row[1]));
  const src = readFileSync(new URL('../src/ui/reach.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  const strings = [...src.matchAll(/'([^'\n]{12,})'|`([^`\n]{12,})`/g)].map((m) => m[1] ?? m[2]).join('\n');
  assert.ok(!BANNED.test(strings), strings.match(BANNED)?.[0]);
  assert.ok(!BANNED.test(row![1]));
});

// ── review 3 (2026-11-16) ──
import { Sim as Sim3 } from '../src/sim/sim.ts';
import { srel as srel3 } from '../src/sim/god/regard.ts';
import { world as world3, ctx as ctx3 } from './reach-helpers.ts';
import { cardCostText, townAbsentLine, reachPollArgs, FREE_DEED_TOWN } from '../src/ui/reach.ts';

test('review 3: the middle position leaves Strict (the command the Settings control sends)', () => {
  const sim = world3();
  const x = ctx3(sim);
  assert.ok(x.cast(settingCommand('strict')).ok);
  assert.equal((sim.query('reach') as ReachView).strict, true);
  assert.ok(x.cast(settingCommand('bound')).ok);
  const v = sim.query('reach') as ReachView;
  assert.equal(v.bound, true);
  assert.equal(v.strict, false);
  assert.equal(settingOf(v), 'bound');
});

test('review 3: the wheel, the palette and the card read the viewed world: free clay is shown free', () => {
  const sim = new Sim3({ seed: 5, scenario: 'twoworlds-late', overrides: { n: 20 }, bound: true });
  const clay = (sim.query('reach') as ReachView).worlds!.find((w) => w.clay);
  assert.ok(clay, 'the scenario has a world no one has lived on');
  // (a low standing, so a great power is out of reach where people live)
  sim.u.god.reach!.tier = 0; delete sim.u.god.reach!.floor;
  assert.deepEqual(reachPollArgs(clay.planet), { planet: clay.planet });
  assert.deepEqual(reachPollArgs(-1), {});
  const row = (args: Record<string, unknown>) => (sim.query('powers', args) as { id: string; priceNow: number; clay: boolean; locked: boolean }[]).find((p) => p.id === 'disaster-quake')!;
  assert.equal(row({}).locked, true);
  const here = row(reachPollArgs(clay.planet));
  assert.equal(here.locked, false); assert.equal(here.clay, true); assert.equal(here.priceNow, 0);
  // the card: the planet-less row says locked, the sim's answer for this world says clay: the answer wins
  const locked = P({ price: 80, priceNow: 80, locked: true, reason: 'Beyond your reach. Quake opens when you are Worshipped: 150 follow, 0 now.' });
  assert.match(cardCostText(locked)!, /^Beyond your reach/);
  const ans = sim.query('reach.price', { id: 'disaster-quake', planet: clay.planet }) as Record<string, unknown>;
  assert.equal(cardCostText(locked, ans), 'Free on empty ground.');
  // and the other way: an open row, an answer that says locked, with the sim's reason
  assert.equal(cardCostText(P({ price: 15, priceNow: 15 }), { priceNow: 15, locked: true, reason: 'Beyond your reach. X.' }), 'Beyond your reach. X.');
  assert.equal(cardCostText(P({ price: 15, priceNow: 15 }), { priceNow: 30, locked: false, basePrice: 15 }), 'Costs 30 worship at this size.');
});

test('review 3: the free first deed is shown: the aimed point reaches the sim, and the town card says it', () => {
  const sim = world3();
  const x = ctx3(sim);
  for (const i of x.grown) x.set(i, 0.9, 0.9, 0);
  x.seen(); x.day();
  (srel3(sim.u, x.p.id, x.st.id) as unknown as { answer: { tick: number } }).answer = { tick: sim.u.tick };
  const flood = P({ id: 'flood', price: 30, priceNow: 30, locked: true, reason: 'Beyond your reach.' });
  // the card's old question (world only) cannot find the town; the aimed point, or the selected town, does
  assert.equal((sim.query('reach.price', priceArgs(flood, {}, { planet: x.p.id })) as { freeDeed?: boolean }).freeDeed, undefined);
  const aimed = priceArgs(flood, {}, { planet: x.p.id, pos: x.at });
  assert.deepEqual(aimed.pos, x.at);
  for (const args of [aimed, priceArgs(flood, {}, { planet: x.p.id, settlement: x.st.id })]) {
    const ans = sim.query('reach.price', args) as Record<string, unknown>;
    assert.equal(ans.freeDeed, true);
    assert.equal(cardCostText(flood, ans), 'Free: the first deed in answer.');
  }
  const town = (sim.query('reach') as ReachView).towns!.find((t) => t.settlement === x.st.id)!;
  assert.equal(town.freeDeed, true);
  assert.ok(townLines(town, 30).includes(FREE_DEED_TOWN));
  assert.ok(!townLines({ ...town, freeDeed: false }, 30).includes(FREE_DEED_TOWN));
});

test('review 3: a town that gives nothing is not told it gives in trust', () => {
  const sim = world3();
  const x = ctx3(sim);
  // trusted, hardly believed: no believers, so the sim's list does not carry the town
  for (const i of x.grown) x.set(i, 0.05, 0.6, 0);
  x.seen(); x.day();
  assert.equal((sim.query('reach') as ReachView).towns!.some((t) => t.settlement === x.st.id), false);
  assert.equal(townAbsentLine(0.05), 'No one here gives to you yet.');
  assert.equal(townAbsentLine(), 'No one here gives to you yet.');
  assert.match(townAbsentLine(0.8), /^You have not been seen here/);
  for (const s of [townAbsentLine(0), townAbsentLine(0.8), FREE_DEED_TOWN]) assert.doesNotMatch(s, /\b(good|evil|kind|cruel|light|dark)\b/i);
});
