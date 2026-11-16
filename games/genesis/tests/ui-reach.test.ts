// POWERS-GROWTH §6: the god's card, the cost line, the three states, the town line, the toast, the setting and the F1 text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { standingLine, nextLine, gaugeTitle, barTitle, reachCard, costLine, powerState, stateTitle, lockMark, townReachLines, townRoadWords, standingToast, settingCommand, SETTING_CHOICES, ReachFeed, type ReachView } from '../src/ui/reach.ts';
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
  const hud = readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8');
  assert.match(hud, /gn-reach-trust/);
  assert.match(hud, /gn-reach-fear/);
  assert.ok(!/trustShare\s*[-<>]\s*fearShare|fear\s*-\s*trust|trust\s*-\s*fear/.test(readFileSync(new URL('../src/ui/reach.ts', import.meta.url), 'utf8')));
});

test('the cost line: free, priced, wider, beyond; none in an unbound world', () => {
  assert.equal(costLine(P()), null);
  assert.equal(costLine(P({ free: true, price: 0, priceNow: 0 })), 'Free.');
  assert.equal(costLine(P({ price: 15, priceNow: 15 })), 'Costs 15 worship.');
  assert.equal(costLine(P({ price: 15, priceNow: 15, params: { radius: 100 } }), { radius: 200 }), 'Costs 30 worship at this size.');
  // a free spell is free at its own size, priced wider (half its old cost x size)
  const ign = P({ free: true, price: 0, priceNow: 0, cost: 10, params: { radius: 60 } });
  assert.equal(costLine(ign, { radius: 60 }), 'Free.');
  assert.equal(costLine(ign, { radius: 600 }), 'Costs 50 worship at this size.');
  assert.equal(costLine(P({ price: 100, priceNow: 300, beyond: true })), 'Beyond your standing: 300 worship.');
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

test('the toast on a rise and a fall; none for other events', () => {
  assert.equal(standingToast('reach.rose', { name: 'Known' })!.text, 'They call you the Known now.');
  assert.match(standingToast('reach.fell', { name: 'Whispered' })!.text, /^Fewer speak your name/);
  assert.equal(standingToast('reach.falling', { name: 'x' }), null);
});

test('the setting: two positions (Strict waits on the sim), the command, no banned words', () => {
  assert.deepEqual(SETTING_CHOICES.map((c) => c.value), ['unbound', 'bound']);
  assert.deepEqual(settingCommand('bound'), { k: 'meta.reach', bound: true });
  assert.deepEqual(settingCommand('unbound'), { k: 'meta.reach', bound: false });
  assert.ok(!/strict/i.test(JSON.stringify(SETTING_CHOICES)));
});

test('the F1 card says it, and no owner-banned word appears in any new text', () => {
  const row = livingRows(() => '').find(([k]) => k === 'standing and worship');
  assert.ok(row && /Trust and Fear/.test(row[1]));
  const src = readFileSync(new URL('../src/ui/reach.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  const strings = [...src.matchAll(/'([^'\n]{12,})'|`([^`\n]{12,})`/g)].map((m) => m[1] ?? m[2]).join('\n');
  assert.ok(!BANNED.test(strings), strings.match(BANNED)?.[0]);
  assert.ok(!BANNED.test(row![1]));
});
