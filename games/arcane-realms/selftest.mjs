#!/usr/bin/env node
// Arcane Realms TCG — deterministic selftest gate.
//   node selftest.mjs            → structural + rules + every-card + AI + quick matches
//   node selftest.mjs --matches  → adds full 36-game AI-vs-AI round-robin with balance report
//   node selftest.mjs --assets   → also require every card artwork file to exist
import { CARDS, COLLECTIBLE, TOKENS, SET_STATS, cardById, REALMS } from './runtime/sim/cards.js?v=4';
import {
  createGame, legalActions, applyAction, cloneState, aiView,
  effAtk, hasKw, makeUnit, unitByIid, opponentOf, validTargets,
  MAX_BOARD, MAX_HAND, HERO_HP,
} from './runtime/sim/engine.js?v=4';
import { validateDeck, STARTER_DECKS, starterDeckErrors, DECK_SIZE } from './runtime/sim/decks.js?v=4';
import { chooseAction, runAiTurn, findLethal, evaluate, DIFFICULTIES } from './runtime/sim/ai.js?v=4';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
let pass = 0, fail = 0;
const failures = [];

function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; failures.push(label); console.error('  ✗ FAIL: ' + label); }
}
function section(name) { console.log('— ' + name); }

// ───────────────────── helpers ─────────────────────
const FILLER = Array(DECK_SIZE).fill('nt01');

function mkGame(opts = {}) {
  return createGame({
    seed: opts.seed ?? 42,
    decks: opts.decks ?? [FILLER.slice(), FILLER.slice()],
    first: opts.first ?? 0,
    names: ['A', 'B'],
    heroes: ['ember', 'grave'],
  });
}
function give(state, p, cardId) {
  const e = { iid: state.iid++, card: cardId };
  state.players[p].hand.push(e);
  return e;
}
function summon(state, p, cardId, opts = {}) {
  const u = makeUnit(state, cardId);
  u.sick = opts.sick ?? false;
  u.tapped = opts.tapped ?? false;
  if (opts.hp != null) u.hp = opts.hp;
  state.players[p].board.push(u);
  return u;
}
function mana(state, p, n) { state.players[p].mana = n; state.players[p].manaMax = Math.max(state.players[p].manaMax, Math.min(10, n)); }
function endTurn(state) { return applyAction(state, { type: 'end' }); }
function toCombat(state) { return applyAction(state, { type: 'combat' }); }

// ───────────────────── 1. set structure ─────────────────────
section('card set structure');
ok(SET_STATS.total >= 100, `≥100 unique collectible cards (${SET_STATS.total})`);
ok(SET_STATS.byRarity.legendary >= 7, `≥7 legendaries (${SET_STATS.byRarity.legendary})`);
ok(SET_STATS.byRarity.epic >= 10, `≥10 epics (${SET_STATS.byRarity.epic})`);
ok(Object.keys(REALMS).length === 6, '6 realms incl neutral');
for (const c of COLLECTIBLE) {
  if (!c.name || !c.text === undefined || c.cost == null || !c.rarity || !c.realm) { ok(false, `card ${c.id} missing fields`); }
  if (c.type === 'creature' && (c.atk == null || c.hp == null || c.hp < 1)) ok(false, `creature ${c.id} bad stats`);
  if (c.type === 'spell' && !c.fx) ok(false, `spell ${c.id} has no fx`);
  if (c.type === 'trap' && !c.trap) ok(false, `trap ${c.id} has no trigger`);
  if (!c.flavor) ok(false, `card ${c.id} missing flavor`);
}
ok(true, 'per-card field audit ran');
// unique names
{
  const names = new Set(COLLECTIBLE.map((c) => c.name));
  ok(names.size === COLLECTIBLE.length, 'all card names unique');
}
ok(starterDeckErrors().length === 0, 'all 6 starter decks are legal ' + JSON.stringify(starterDeckErrors()));

// deck validator negative cases
{
  const three = [...Array(3).fill('ef01'), ...FILLER.slice(3)];
  ok(!validateDeck(three).ok, 'validator rejects 3 copies');
  const twoLeg = [...Array(2).fill('ef19'), ...FILLER.slice(2)];
  ok(!validateDeck(twoLeg).ok, 'validator rejects 2 legendary copies');
  const threeRealms = ['ef01', 'tc01', 'wg01', ...FILLER.slice(3)];
  ok(!validateDeck(threeRealms).ok, 'validator rejects 3 realms');
  ok(!validateDeck(FILLER.slice(1)).ok, 'validator rejects 29 cards');
  ok(validateDeck(STARTER_DECKS[0].cards).ok, 'validator accepts starter deck');
}

// ───────────────────── 2. game setup & turn flow ─────────────────────
section('game setup & turn flow');
{
  const s = mkGame();
  ok(s.players[0].hand.length === 4, 'first player: 3 opening + 1 turn draw = 4');
  ok(s.players[1].hand.length === 5, 'second player: 4 + Arcane Ember = 5');
  ok(s.players[1].hand.some((h) => h.card === 'tk_ember'), 'second player holds Arcane Ember');
  ok(s.players[0].mana === 1 && s.players[0].manaMax === 1, 'turn 1: 1 mana');
  ok(s.phase === 'main' && s.active === 0, 'starts in main phase');
  endTurn(s);
  ok(s.active === 1 && s.players[1].mana === 1, 'p1 turn 1: 1 mana');
  endTurn(s);
  ok(s.players[0].mana === 2 && s.players[0].manaMax === 2, 'turn 2: 2 mana');
  // mana caps at 10
  for (let i = 0; i < 30 && s.winner === null; i++) endTurn(s);
  if (s.winner === null) ok(s.players[s.active].manaMax === 10, 'mana caps at 10');
  else ok(true, 'game ended by fatigue before cap check (fine)');
}
{
  // illegal actions throw
  const s = mkGame();
  let threw = 0;
  try { applyAction(s, { type: 'attack', attacker: 999, target: { kind: 'hero', p: 1 } }); } catch { threw++; }
  try { applyAction(s, { type: 'play', iid: 99999 }); } catch { threw++; }
  const c = give(s, 0, 'ef10'); // fireball costs 4, we have 1 mana
  try { applyAction(s, { type: 'play', iid: c.iid, target: { kind: 'hero', p: 1 } }); } catch { threw++; }
  ok(threw === 3, 'illegal actions throw (bad attacker / bad hand iid / not enough mana)');
}
{
  // creatures only in main; attacks only in combat; combat is one-way
  const s = mkGame();
  mana(s, 0, 10);
  const c1 = give(s, 0, 'nt01');
  toCombat(s);
  let threw = false;
  try { applyAction(s, { type: 'play', iid: c1.iid }); } catch { threw = true; }
  ok(threw, 'cannot summon creatures in combat phase');
  threw = false;
  try { applyAction(s, { type: 'combat' }); } catch { threw = true; }
  ok(threw, 'cannot re-enter combat');
  // spells still castable in combat
  const sp = give(s, 0, 'ef03');
  const evs = applyAction(s, { type: 'play', iid: sp.iid, target: { kind: 'hero', p: 1 } });
  ok(s.players[1].hp === HERO_HP - 2, 'spells castable during combat');
}
{
  // fatigue: empty deck escalates
  const s = mkGame();
  s.players[0].deck = [];
  s.players[1].deck = [];
  const hp0 = s.players[0].hp;
  endTurn(s); endTurn(s); // p0 draws on its next turn-start → fatigue 1
  ok(s.players[0].fatigue === 1 && s.players[0].hp === hp0 - 1, 'fatigue 1 on first empty draw');
  endTurn(s); endTurn(s);
  ok(s.players[0].fatigue === 2 && s.players[0].hp === hp0 - 3, 'fatigue escalates 1,2,…');
}
{
  // hand cap burns draws
  const s = mkGame();
  while (s.players[0].hand.length < MAX_HAND) give(s, 0, 'nt01');
  const deckBefore = s.players[0].deck.length;
  endTurn(s); endTurn(s);
  ok(s.players[0].hand.length === MAX_HAND, 'hand capped at 10');
  ok(s.players[0].deck.length === deckBefore - 1, 'burned card left the deck');
  ok(s.players[0].grave.length >= 1, 'burned card went to grave');
}
{
  // board cap
  const s = mkGame();
  mana(s, 0, 10);
  for (let i = 0; i < MAX_BOARD; i++) summon(s, 0, 'nt01');
  const c = give(s, 0, 'nt03');
  const plays = legalActions(s).filter((a) => a.type === 'play' && a.iid === c.iid);
  ok(plays.length === 0, 'cannot play creature onto full board');
  // summon op fizzles gracefully
  const sp = give(s, 0, 'nt18');
  applyAction(s, { type: 'play', iid: sp.iid });
  ok(s.players[0].board.length === MAX_BOARD, 'summon fizzles on full board');
}

// ───────────────────── 3. combat & tap mechanics ─────────────────────
section('combat & tapping');
{
  const s = mkGame();
  const a = summon(s, 0, 'nt03'); // 2/3
  const d = summon(s, 1, 'nt01'); // 2/1
  toCombat(s);
  const evs = applyAction(s, { type: 'attack', attacker: a.iid, target: { kind: 'unit', iid: d.iid } });
  ok(a.tapped === true, 'attacker taps on attack');
  ok(evs.some((e) => e.t === 'tap'), 'tap event emitted');
  ok(!unitByIid(s, d.iid), 'defender died (2 dmg vs 1 hp)');
  ok(a.hp === 1, 'attacker took retaliation (3-2=1)');
  // tapped creature cannot attack again
  const acts = legalActions(s).filter((x) => x.type === 'attack' && x.attacker === a.iid);
  ok(acts.length === 0, 'tapped creature cannot attack again');
  // untap at start of own turn
  endTurn(s); endTurn(s);
  ok(a.tapped === false, 'creature untaps at start of own turn');
}
{
  // summoning sickness + swift
  const s = mkGame();
  mana(s, 0, 10);
  const slow = give(s, 0, 'nt01');
  const fast = give(s, 0, 'ef02'); // swift
  applyAction(s, { type: 'play', iid: slow.iid });
  applyAction(s, { type: 'play', iid: fast.iid });
  toCombat(s);
  const acts = legalActions(s).filter((a) => a.type === 'attack');
  const attackers = new Set(acts.map((a) => a.attacker));
  const slowUnit = s.players[0].board.find((u) => u.card === 'nt01');
  const fastUnit = s.players[0].board.find((u) => u.card === 'ef02');
  ok(!attackers.has(slowUnit.iid), 'summoning sickness blocks attack');
  ok(attackers.has(fastUnit.iid), 'Swift ignores summoning sickness');
}
{
  // hero attack + win detection
  const s = mkGame();
  const a = summon(s, 0, 'nt12'); // 6/5
  s.players[1].hp = 5;
  toCombat(s);
  applyAction(s, { type: 'attack', attacker: a.iid, target: { kind: 'hero', p: 1 } });
  ok(s.winner === 0, 'reducing enemy hero to 0 wins the game');
  ok(legalActions(s).length === 0, 'no legal actions after game over');
}

// ───────────────────── 4. keywords ─────────────────────
section('keywords');
{
  // guard restricts targets
  const s = mkGame();
  const a = summon(s, 0, 'nt03');
  const g = summon(s, 1, 'nt08'); // 0/4 guard
  const v = summon(s, 1, 'nt01'); // vanilla
  toCombat(s);
  const acts = legalActions(s).filter((x) => x.type === 'attack' && x.attacker === a.iid);
  ok(acts.length === 1 && acts[0].target.iid === g.iid, 'Guard forces attacks onto it (no face, no vanilla)');
}
{
  // flying evasion; flying guard and tapped flyer are attackable
  const s = mkGame();
  const ground = summon(s, 0, 'nt03');
  const flyer = summon(s, 0, 'nt02');
  const eFly = summon(s, 1, 'nt02'); // enemy 1/1 flying
  toCombat(s);
  let acts = legalActions(s).filter((x) => x.type === 'attack' && x.attacker === ground.iid && x.target.kind === 'unit');
  ok(acts.length === 0, 'grounded cannot attack flyer');
  acts = legalActions(s).filter((x) => x.type === 'attack' && x.attacker === flyer.iid && x.target.kind === 'unit');
  ok(acts.length === 1, 'flyer can attack flyer');
  eFly.tapped = true;
  acts = legalActions(s).filter((x) => x.type === 'attack' && x.attacker === ground.iid && x.target.kind === 'unit');
  ok(acts.length === 1, 'tapped flyer loses evasion');
}
{
  // stealth: untargetable + unattackable until it attacks
  const s = mkGame();
  mana(s, 0, 10);
  const st = summon(s, 1, 'nt04'); // stealth mimic
  const bolt = give(s, 0, 'ef03');
  const tgts = validTargets(s, 0, { kind: 'any' });
  ok(!tgts.some((t) => t.kind === 'unit' && t.iid === st.iid), 'stealth unit not targetable by spells');
  const mine = summon(s, 0, 'nt03');
  toCombat(s);
  const acts = legalActions(s).filter((x) => x.type === 'attack' && x.attacker === mine.iid && x.target.kind === 'unit');
  ok(acts.length === 0, 'stealth unit not attackable');
  // stealth breaks on attack
  endTurn(s);
  toCombat(s);
  applyAction(s, { type: 'attack', attacker: st.iid, target: { kind: 'hero', p: 0 } });
  ok(st.stealth === false, 'stealth breaks after attacking');
}
{
  // ward negates first targeted spell
  const s = mkGame();
  mana(s, 0, 10);
  const w = summon(s, 1, 'tc11'); // ward 3/3
  const bolt1 = give(s, 0, 'ef03');
  applyAction(s, { type: 'play', iid: bolt1.iid, target: { kind: 'unit', iid: w.iid } });
  ok(w.hp === 3 && w.ward === false, 'ward absorbs first spell and breaks');
  const bolt2 = give(s, 0, 'ef03');
  mana(s, 0, 10);
  applyAction(s, { type: 'play', iid: bolt2.iid, target: { kind: 'unit', iid: w.iid } });
  ok(w.hp === 1, 'second spell lands after ward broke');
}
{
  // lifesteal on attack (both sides of the table)
  const s = mkGame();
  s.players[0].hp = 20;
  const ls = summon(s, 0, 'dw09'); // 3/4 lifesteal
  const e = summon(s, 1, 'nt08'); // 0/4 wall — no retaliation
  toCombat(s);
  applyAction(s, { type: 'attack', attacker: ls.iid, target: { kind: 'unit', iid: e.iid } });
  ok(s.players[0].hp === 23, 'lifesteal heals hero on attack (20+3)');
  s.players[1].hp = 20;
  endTurn(s);
  const ls2 = summon(s, 1, 'gm17', { sick: false }); // 4/4 lifesteal (enemy side)
  toCombat(s);
  applyAction(s, { type: 'attack', attacker: ls2.iid, target: { kind: 'unit', iid: ls.iid } });
  ok(s.players[1].hp === 24, 'lifesteal heals on attack (enemy side)');
}
{
  // venomous kills through any damage; cleave hits neighbors; piercing overflow
  const s = mkGame();
  const ven = summon(s, 0, 'gm02'); // 1/1 venomous
  const big = summon(s, 1, 'nt14'); // 7/7
  toCombat(s);
  applyAction(s, { type: 'attack', attacker: ven.iid, target: { kind: 'unit', iid: big.iid } });
  ok(!unitByIid(s, big.iid), 'venomous destroys 7/7 with 1 damage');
  ok(!unitByIid(s, ven.iid), 'venomous attacker died to retaliation');
}
{
  const s = mkGame();
  const cleaver = summon(s, 0, 'ef12'); // 4/3 cleave
  const l = summon(s, 1, 'nt01');
  const m = summon(s, 1, 'nt03');
  const r = summon(s, 1, 'nt01');
  toCombat(s);
  applyAction(s, { type: 'attack', attacker: cleaver.iid, target: { kind: 'unit', iid: m.iid } });
  ok(!unitByIid(s, l.iid) && !unitByIid(s, m.iid) && !unitByIid(s, r.iid), 'cleave killed target and both neighbors');
}
{
  const s = mkGame();
  const pierce = summon(s, 0, 'wg13'); // 6/5 piercing
  const chump = summon(s, 1, 'nt01'); // 2/1
  const hpBefore = s.players[1].hp;
  toCombat(s);
  applyAction(s, { type: 'attack', attacker: pierce.iid, target: { kind: 'unit', iid: chump.iid } });
  ok(s.players[1].hp === hpBefore - 5, 'piercing carries 5 excess to hero (6-1)');
}
{
  // frenzy + regenerate
  const s = mkGame();
  const f = summon(s, 0, 'ef05'); // 3/2 frenzy+2
  ok(effAtk(s, 0, f) === 3, 'frenzy inactive at full hp');
  f.hp = 1;
  ok(effAtk(s, 0, f) === 5, 'frenzy +2 while damaged');
  const r = summon(s, 0, 'wg01', { hp: 1 }); // regenerate 1, maxHp 2
  endTurn(s); endTurn(s);
  ok(r.hp === 2, 'regenerate healed at turn start');
}
{
  // freeze: tapped, skips one untap, then thaws
  const s = mkGame();
  mana(s, 0, 10);
  const e = summon(s, 1, 'nt03');
  const nip = give(s, 0, 'tc02');
  applyAction(s, { type: 'play', iid: nip.iid, target: { kind: 'unit', iid: e.iid } });
  ok(e.frozen === true && e.tapped === true, 'frozen unit is tapped');
  endTurn(s); // enemy turn starts → thaws but stays tapped
  ok(e.frozen === false && e.tapped === true, 'thaws at own turn start but stays tapped that turn');
  const acts = legalActions(s).filter((x) => x.type === 'attack' && x.attacker === e.iid);
  ok(acts.length === 0, 'frozen-thawed unit cannot attack this turn');
  endTurn(s); endTurn(s);
  ok(e.tapped === false, 'fully untapped the following turn');
}
{
  // aura: packleader gives other beasts +1 atk
  const s = mkGame();
  const boar = summon(s, 0, 'wg04'); // beast 3/2
  ok(effAtk(s, 0, boar) === 3, 'no aura yet');
  const leader = summon(s, 0, 'wg09');
  ok(effAtk(s, 0, boar) === 4, 'packleader aura +1 to other beast');
  ok(effAtk(s, 0, leader) === 3, 'aura does not buff itself');
  const golem = summon(s, 0, 'nt07');
  ok(effAtk(s, 0, golem) === 4, 'aura does not buff non-beasts');
  leader.silenced = true;
  ok(effAtk(s, 0, boar) === 3, 'silencing the aura source removes the aura');
}

// ───────────────────── 5. traps ─────────────────────
section('traps');
{
  // flame ward: hero-attacked → 3 dmg to attacker (kills a 2/1 pre-combat)
  const s = mkGame();
  mana(s, 0, 10);
  const trap = give(s, 0, 'ef18');
  applyAction(s, { type: 'play', iid: trap.iid });
  ok(s.players[0].traps.length === 1, 'trap placed face-down');
  endTurn(s);
  const raider = summon(s, 1, 'nt01', { sick: false }); // 2/1
  const hpBefore = s.players[0].hp;
  toCombat(s);
  applyAction(s, { type: 'attack', attacker: raider.iid, target: { kind: 'hero', p: 0 } });
  ok(!unitByIid(s, raider.iid), 'flame ward killed the 2/1 attacker');
  ok(s.players[0].hp === hpBefore, 'attack fizzled — hero untouched');
  ok(s.players[0].traps.length === 0, 'trap consumed');
}
{
  // undertow: bounce attacker
  const s = mkGame();
  mana(s, 0, 10);
  const trap = give(s, 0, 'tc17');
  applyAction(s, { type: 'play', iid: trap.iid });
  endTurn(s);
  const big = summon(s, 1, 'nt14', { sick: false });
  const handBefore = s.players[1].hand.length;
  toCombat(s);
  applyAction(s, { type: 'attack', attacker: big.iid, target: { kind: 'hero', p: 0 } });
  ok(!unitByIid(s, big.iid), 'undertow removed attacker from board');
  ok(s.players[1].hand.length === handBefore + 1, 'attacker returned to hand');
}
{
  // counterspell sigil
  const s = mkGame();
  mana(s, 0, 10);
  const trap = give(s, 0, 'tc07');
  applyAction(s, { type: 'play', iid: trap.iid });
  endTurn(s);
  mana(s, 1, 10);
  const fb = give(s, 1, 'ef10');
  const hpBefore = s.players[0].hp;
  applyAction(s, { type: 'play', iid: fb.iid, target: { kind: 'hero', p: 0 } });
  ok(s.players[0].hp === hpBefore, 'counterspell negated fireball');
  ok(s.players[1].mana === 6, 'countered spell still cost mana');
  ok(s.players[0].traps.length === 0, 'sigil consumed');
}
{
  // grave betrayal: steal dying enemy creature
  const s = mkGame();
  mana(s, 0, 10);
  const trap = give(s, 0, 'gm15');
  applyAction(s, { type: 'play', iid: trap.iid });
  const victim = summon(s, 1, 'nt03'); // enemy 2/3
  const bolt = give(s, 0, 'nt17'); // 3 dmg
  applyAction(s, { type: 'play', iid: bolt.iid, target: { kind: 'unit', iid: victim.iid } });
  ok(s.players[0].board.some((u) => u.card === 'nt03'), 'grave betrayal resummoned the corpse on OUR side');
  ok(s.players[0].traps.length === 0, 'betrayal consumed');
}
{
  // retribution sigil: attacker that kills our creature dies
  const s = mkGame();
  mana(s, 0, 10);
  const trap = give(s, 0, 'dw18');
  applyAction(s, { type: 'play', iid: trap.iid });
  const mine = summon(s, 0, 'nt01'); // 2/1
  endTurn(s);
  const killer = summon(s, 1, 'nt07', { sick: false }); // 4/5
  toCombat(s);
  applyAction(s, { type: 'attack', attacker: killer.iid, target: { kind: 'unit', iid: mine.iid } });
  ok(!unitByIid(s, mine.iid), 'our creature died in combat');
  ok(!unitByIid(s, killer.iid), 'retribution destroyed the killer');
}
{
  // sanctuary ward summons defender; curse of weakness debuffs
  const s = mkGame();
  mana(s, 0, 10);
  const t1 = give(s, 0, 'dw14');
  const t2 = give(s, 0, 'gm16');
  applyAction(s, { type: 'play', iid: t1.iid });
  applyAction(s, { type: 'play', iid: t2.iid });
  endTurn(s);
  const att = summon(s, 1, 'nt07', { sick: false }); // 4/5
  toCombat(s);
  applyAction(s, { type: 'attack', attacker: att.iid, target: { kind: 'hero', p: 0 } });
  ok(s.players[0].board.some((u) => u.card === 'tk_defender'), 'sanctuary ward summoned defender');
  ok(att.atk === 2, 'curse of weakness applied -2 atk');
}

// ───────────────────── 6. every card resolves ─────────────────────
section('every collectible card plays & resolves');
{
  let cardPass = 0;
  for (const card of COLLECTIBLE) {
    try {
      const s = mkGame();
      // rich sandbox: friendlies, enemies incl damaged/big/cheap, graves seeded
      const f1 = summon(s, 0, 'nt03', { hp: 1 }); // damaged friendly (heal target)
      const f2 = summon(s, 0, 'wg04');
      const e1 = summon(s, 1, 'nt01');            // cheap (cost 1)
      const e2 = summon(s, 1, 'nt12');            // big atk 6
      const e3 = summon(s, 1, 'nt07', { hp: 3 }); // damaged (3/5→3)
      s.players[0].grave.push('nt01', 'nt03', 'wg04', 'nt07');
      s.players[0].hp = 15; // room to heal
      s.players[0].manaMax = 8; // room to ramp
      mana(s, 0, 10);
      const h = give(s, 0, card.id);
      const acts = legalActions(s).filter((a) => a.type === 'play' && a.iid === h.iid);
      if (!acts.length) throw new Error('no legal play in sandbox');
      const opsPre = [...(card.fx || []), ...(card.rally || [])];
      const wantsHeal = opsPre.some((o) => o.op === 'heal');
      // prefer an action that exercises the target (heal cards aim at our damaged hero)
      const act =
        (wantsHeal && acts.find((a) => a.target && a.target.kind === 'hero' && a.target.p === 0)) ||
        acts.find((a) => a.target) || acts[0];
      const evs = applyAction(s, act);
      if (s.players[0].hand.some((x) => x.iid === h.iid)) throw new Error('card did not leave hand');
      if (card.type === 'creature' && !s.players[0].board.some((u) => u.card === card.id)) throw new Error('creature not on board');
      if (card.type === 'trap' && !s.players[0].traps.some((t) => t.card === card.id)) throw new Error('trap not armed');
      if (card.type === 'spell' && !s.players[0].grave.includes(card.id)) throw new Error('spell not in grave');
      if (!evs.length) throw new Error('no events emitted');
      // effect-specific spot checks
      const ops = [...(card.fx || []), ...(card.rally || [])];
      const opset = new Set(ops.map((o) => o.op));
      if (opset.has('draw') && !evs.some((e) => e.t === 'draw' || e.t === 'fatigue')) throw new Error('draw op emitted nothing');
      if (opset.has('summon') && !evs.some((e) => e.t === 'summon')) throw new Error('summon op emitted nothing');
      if ((opset.has('damage') || opset.has('aoe')) && !evs.some((e) => e.t === 'damage' || e.t === 'ward-break')) throw new Error('damage op emitted nothing');
      if (opset.has('heal') && !evs.some((e) => e.t === 'heal')) throw new Error('heal op emitted nothing');
      if (opset.has('freeze') || opset.has('freeze-all') || opset.has('freeze-random')) {
        if (!evs.some((e) => e.t === 'freeze')) throw new Error('freeze op emitted nothing');
      }
      if (opset.has('ramp') && !evs.some((e) => e.t === 'ramp')) throw new Error('ramp op emitted nothing');
      if (opset.has('destroy') && !evs.some((e) => e.t === 'destroy')) throw new Error('destroy op emitted nothing');
      if (opset.has('silence') && !evs.some((e) => e.t === 'silence')) throw new Error('silence op emitted nothing');
      if (opset.has('bounce') && !evs.some((e) => e.t === 'bounce' || e.t === 'ward-break')) throw new Error('bounce op emitted nothing');
      if (opset.has('resurrect') && !evs.some((e) => e.t === 'summon')) throw new Error('resurrect op emitted nothing');
      if (opset.has('add-random') && !evs.some((e) => e.t === 'add-card')) throw new Error('add-random op emitted nothing');
      cardPass++;
    } catch (err) {
      ok(false, `card ${card.id} (${card.name}): ${err.message}`);
    }
  }
  ok(cardPass === COLLECTIBLE.length, `every card resolved (${cardPass}/${COLLECTIBLE.length})`);
}

// ───────────────────── 7. signature card behaviors ─────────────────────
section('signature cards');
{
  // Phoenix rebirth
  const s = mkGame();
  const p = summon(s, 0, 'ef15');
  p.hp = 1;
  const e = summon(s, 1, 'nt12', { sick: false }); // 6 atk
  endTurn(s);
  toCombat(s);
  // flying phoenix — enemy needs flying? nt12 is grounded and phoenix flies… untapped flyer evades.
  // kill it with a spell instead:
  mana(s, 1, 10);
  const bolt = give(s, 1, 'ef03');
  applyAction(s, { type: 'play', iid: bolt.iid, target: { kind: 'unit', iid: p.iid } });
  ok(s.players[0].board.some((u) => u.card === 'tk_phoenix'), 'phoenix reborn as 2/2 token');
}
{
  // Morthul: rally destroy + deathless return
  const s = mkGame();
  mana(s, 0, 10);
  const victim = summon(s, 1, 'nt14');
  const m = give(s, 0, 'gm18');
  applyAction(s, { type: 'play', iid: m.iid, target: { kind: 'unit', iid: victim.iid } });
  ok(!unitByIid(s, victim.iid), 'Morthul rally destroyed the 7/7');
  const morthul = s.players[0].board.find((u) => u.card === 'gm18');
  morthul.hp = 0;
  applyAction(s, { type: 'combat' }); // triggers reap via next action? force reap through an action
  // reap happens inside actions — combat phase change doesn't reap; use a spell
  mana(s, 0, 10);
  const nudge = give(s, 0, 'nt16');
  applyAction(s, { type: 'play', iid: nudge.iid });
  ok(s.players[0].board.some((u) => u.card === 'tk_morthul'), 'Morthul returned as Deathless One');
}
{
  // Chronarch Vex: creatures attack twice
  const s = mkGame();
  mana(s, 0, 10);
  const a = summon(s, 0, 'nt09'); // 5/6
  const vex = give(s, 0, 'nt21');
  applyAction(s, { type: 'play', iid: vex.iid });
  toCombat(s);
  applyAction(s, { type: 'attack', attacker: a.iid, target: { kind: 'hero', p: 1 } });
  ok(a.tapped === false && a.extraAttacks === 0, 'first attack untapped via time surge');
  applyAction(s, { type: 'attack', attacker: a.iid, target: { kind: 'hero', p: 1 } });
  ok(a.tapped === true, 'second attack taps for good');
  ok(s.players[1].hp === HERO_HP - 10, 'both attacks landed (30-10)');
}
{
  // Soul Harvest heals target's hp
  const s = mkGame();
  mana(s, 0, 10);
  s.players[0].hp = 10;
  const big = summon(s, 1, 'nt14'); // 7/7
  const sh = give(s, 0, 'gm13');
  applyAction(s, { type: 'play', iid: sh.iid, target: { kind: 'unit', iid: big.iid } });
  ok(!unitByIid(s, big.iid), 'soul harvest destroyed target');
  ok(s.players[0].hp === 17, 'healed exactly target hp (10+7)');
}
{
  // Dark Pact: sac + draw 2
  const s = mkGame();
  mana(s, 0, 10);
  const sac = summon(s, 0, 'nt01');
  const dp = give(s, 0, 'gm03');
  const handBefore = s.players[0].hand.length;
  applyAction(s, { type: 'play', iid: dp.iid, target: { kind: 'unit', iid: sac.iid } });
  ok(!unitByIid(s, sac.iid), 'dark pact sacrificed own creature');
  ok(s.players[0].hand.length === handBefore - 1 + 2, 'drew 2');
}
{
  // Silence removes guard (ooze rally)
  const s = mkGame();
  mana(s, 0, 10);
  const g = summon(s, 1, 'nt08'); // guard
  const ooze = give(s, 0, 'nt05');
  applyAction(s, { type: 'play', iid: ooze.iid, target: { kind: 'unit', iid: g.iid } });
  ok(g.silenced === true, 'ooze silenced the guard');
  const mine = summon(s, 0, 'nt03');
  toCombat(s);
  const acts = legalActions(s).filter((x) => x.type === 'attack' && x.attacker === mine.iid);
  ok(acts.some((a) => a.target.kind === 'hero'), 'silenced guard no longer protects the hero');
}
{
  // Ritual of the Damned respects cost filter
  const s = mkGame();
  mana(s, 0, 10);
  s.players[0].grave.push('nt14', 'nt01', 'nt03', 'wg04'); // 7-cost + three ≤4
  const r = give(s, 0, 'gm19');
  applyAction(s, { type: 'play', iid: r.iid });
  ok(!s.players[0].board.some((u) => u.card === 'nt14'), 'resurrect filtered out cost-7 corpse');
  ok(s.players[0].board.filter((u) => ['nt01', 'nt03', 'wg04'].includes(u.card)).length === 3, 'resurrected 3 cheap corpses');
}
{
  // Predator's Pounce two-target fight
  const s = mkGame();
  mana(s, 0, 10);
  const mine = summon(s, 0, 'nt09'); // 5/6
  const theirs = summon(s, 1, 'nt03'); // 2/3
  const pp = give(s, 0, 'wg19');
  applyAction(s, { type: 'play', iid: pp.iid, target: { kind: 'unit', iid: mine.iid }, target2: { kind: 'unit', iid: theirs.iid } });
  ok(!unitByIid(s, theirs.iid), 'pounce killed the enemy');
  ok(mine.hp === 4, 'our creature took fight damage back');
}

// ───────────────────── 8. AI ─────────────────────
section('AI');
{
  // lethal solver: direct
  const s = mkGame();
  summon(s, 0, 'nt09'); // 5 atk
  summon(s, 0, 'nt03'); // 2 atk
  s.players[1].hp = 6;
  const lethal = findLethal(aiView(s, 0), 0);
  ok(!!lethal, 'finds direct lethal (5+2 ≥ 6)');
  // execute via chooseAction until turn ends or win
  let guard = 0;
  while (s.winner === null && s.active === 0 && guard++ < 20) {
    applyAction(s, chooseAction(s, 0, 'knight'));
  }
  ok(s.winner === 0, 'AI executes the kill line');
}
{
  // lethal through guard
  const s = mkGame();
  summon(s, 0, 'nt09'); // 5/6
  summon(s, 0, 'nt12'); // 6/5
  const g = summon(s, 1, 'nt08'); // 0/4 guard
  s.players[1].hp = 5;
  let guard = 0;
  while (s.winner === null && s.active === 0 && guard++ < 20) {
    applyAction(s, chooseAction(s, 0, 'archmage'));
  }
  ok(s.winner === 0, 'AI kills through a guard when lethal exists');
}
{
  // AI never sees enemy hand: aiView strips it
  const s = mkGame();
  give(s, 1, 'ef19');
  const v = aiView(s, 0);
  ok(!v.players[1].hand.some((h) => h.card === 'ef19'), 'aiView hides enemy hand');
  ok(v.players[1].hand.length === s.players[1].hand.length, 'aiView preserves enemy hand count');
}
{
  // AI plays a sensible curve turn 1 (plays a 1-drop rather than passing)
  const s = createGame({ seed: 7, decks: [STARTER_DECKS[0].cards.slice(), STARTER_DECKS[2].cards.slice()], first: 0 });
  const evs = runAiTurn(s, 0, 'knight');
  ok(evs.length >= 1 && evs[evs.length - 1].act.type === 'end', 'AI turn runs to completion');
}

// ───────────────────── 9. AI-vs-AI matches ─────────────────────
section(args.has('--matches') ? 'full round-robin (36 games)' : 'quick matches (6 games)');
{
  const results = [];
  const wins = {}; const games = {};
  const pairs = [];
  if (args.has('--matches')) {
    for (let i = 0; i < STARTER_DECKS.length; i++)
      for (let j = 0; j < STARTER_DECKS.length; j++)
        if (i !== j) pairs.push([i, j]);
    // 30 pairings + 6 mirrors
    for (let i = 0; i < STARTER_DECKS.length; i++) pairs.push([i, i]);
  } else {
    pairs.push([0, 1], [2, 3], [4, 5], [1, 4], [3, 0], [5, 2]);
  }
  let matchFails = 0;
  for (const [i, j] of pairs) {
    const dA = STARTER_DECKS[i], dB = STARTER_DECKS[j];
    const seed = 1000 + i * 10 + j;
    try {
      const s = createGame({ seed, decks: [dA.cards.slice(), dB.cards.slice()], first: seed % 2, heroes: [dA.hero, dB.hero] });
      let guard = 0;
      while (s.winner === null && guard++ < 200) {
        runAiTurn(s, s.active, 'knight');
      }
      if (s.winner === null) throw new Error('game did not end in 200 turns');
      results.push({ a: dA.id, b: dB.id, winner: s.winner, turns: s.turn });
      games[dA.id] = (games[dA.id] || 0) + 1; games[dB.id] = (games[dB.id] || 0) + 1;
      if (s.winner === 0) wins[dA.id] = (wins[dA.id] || 0) + 1;
      else if (s.winner === 1) wins[dB.id] = (wins[dB.id] || 0) + 1;
    } catch (err) {
      matchFails++;
      ok(false, `match ${dA.id} vs ${dB.id}: ${err.message}`);
    }
  }
  ok(matchFails === 0, `all ${pairs.length} AI-vs-AI matches completed cleanly`);
  const turns = results.map((r) => r.turns).sort((a, b) => a - b);
  const median = turns[Math.floor(turns.length / 2)] || 0;
  console.log(`  median game length: ${median} turns (${turns[0]}–${turns[turns.length - 1]})`);
  ok(median >= 8 && median <= 40, `median game length sane (${median})`);
  if (args.has('--matches')) {
    console.log('  deck winrates:');
    for (const d of STARTER_DECKS) {
      const w = wins[d.id] || 0, g = games[d.id] || 1;
      const rate = w / g;
      console.log(`    ${d.name.padEnd(20)} ${(rate * 100).toFixed(0)}%  (${w}/${g})`);
      ok(rate >= 0.15 && rate <= 0.85, `${d.id} winrate within band (${(rate * 100).toFixed(0)}%)`);
    }
    const firstWins = results.filter((r) => r.winner === 0).length; // seed%2 alternates who is first… report only
    console.log(`  side-0 wins: ${firstWins}/${results.length}`);
  }
}

// ───────────────────── 10. campaign & progression ─────────────────────
section('campaign & progression');
{
  const { CHAPTERS, ACHIEVEMENTS, CARDBACK_INFO, allBattles } = await import('./runtime/campaign/campaign_data.js?v=4');
  const prog = await import('./runtime/campaign/progression.js?v=4');
  const { EXPANSION_IDS } = await import('./runtime/sim/cards.js?v=4');

  const battles = allBattles();
  ok(CHAPTERS.length === 5, '5 chapters');
  ok(battles.length === 20, '20 battles');
  let dataOk = true;
  for (const ch of CHAPTERS) {
    if (ch.deck.length !== 30) { dataOk = false; ok(false, `${ch.id} enemy deck must be 30 (${ch.deck.length})`); }
    for (const id of ch.deck) cardById(id);
    if (!ch.commander?.portrait || !ch.commander?.hero) { dataOk = false; ok(false, `${ch.id} commander incomplete`); }
  }
  for (const b of battles) {
    if (!b.dialogue?.length) { dataOk = false; ok(false, `${b.id} has no dialogue`); }
    if (!b.winLine) { dataOk = false; ok(false, `${b.id} has no win line`); }
    for (const id of b.rewards.cards || []) cardById(id);
    if (b.rewards.cardback && !CARDBACK_INFO[b.rewards.cardback]) { dataOk = false; ok(false, `${b.id} bad cardback`); }
  }
  ok(dataOk, 'campaign data audit (decks, dialogue, rewards all valid)');

  // every expansion card must be obtainable; packs cover only a small tail
  const cov = prog.unlockCoverage();
  const covered = new Set([...cov.granted, ...cov.packOnly]);
  ok([...EXPANSION_IDS].every((id) => covered.has(id)), 'every expansion card is obtainable');
  ok(cov.granted.every((id) => EXPANSION_IDS.has(id)), 'guaranteed rewards only grant expansion cards');
  ok(cov.packOnly.length <= 8, `pack-only tail is small (${cov.packOnly.length})`);

  // simulate a full run: base owned → all battles → achievements → packs
  const fakeStore = { data: { record: { wins: 60, losses: 0 } }, save() { /* noop */ } };
  prog.initProgress(fakeStore);
  const baseOwned = Object.keys(fakeStore.data.owned).length;
  ok(baseOwned === COLLECTIBLE.length - EXPANSION_IDS.size, `base set owned at start (${baseOwned})`);
  for (const b of battles) prog.grantBattleRewards(fakeStore, b);
  ok(Object.keys(fakeStore.data.battlesWon).length === 20, 'all battles recorded');
  ok(fakeStore.data.gold > 500, `campaign gold flows (${fakeStore.data.gold})`);
  const unlocked = prog.checkAchievements(fakeStore);
  ok(unlocked.length >= 6, `achievements fire on a full clear (${unlocked.length})`);
  // buy packs until the collection completes (gold faucet for the test)
  fakeStore.data.gold = 100000;
  let guard = 0;
  while (guard++ < 50) {
    const r = prog.buyPack(fakeStore);
    if (!r.ok) break;
  }
  ok(Object.keys(fakeStore.data.owned).length === COLLECTIBLE.length,
    `full clear + achievements + packs = 100% collection (${Object.keys(fakeStore.data.owned).length}/${COLLECTIBLE.length})`);
  ok(Object.keys(fakeStore.data.cardbacks).length >= 7, `card backs earned (${Object.keys(fakeStore.data.cardbacks).length})`);

  // battle mods apply
  const s2 = createGame({ seed: 3, decks: [STARTER_DECKS[0].cards.slice(), CHAPTERS[4].deck.slice()], first: 0 });
  prog.applyBattleMods(s2, CHAPTERS[4].battles[3], 1, makeUnit);
  ok(s2.players[1].hp === 40, 'boss hp mod applied');
  ok(s2.players[1].board.length === 1, 'boss ambush board applied');

  // a campaign boss battle actually completes vs the AI
  let guard2 = 0;
  while (s2.winner === null && guard2++ < 200) runAiTurn(s2, s2.active, 'knight');
  ok(s2.winner !== null, 'campaign boss battle runs to completion');

  // starter decks remain fully owned (never lock the base experience)
  const freshStore = { data: {}, save() { /* noop */ } };
  prog.initProgress(freshStore);
  const allStarterOwned = STARTER_DECKS.every((d) => d.cards.every((id) => freshStore.data.owned[id]));
  ok(allStarterOwned, 'all starter deck cards owned from the start');
}

// ───────────────────── 11. assets (optional gate) ─────────────────────
if (args.has('--assets')) {
  section('asset coverage');
  let missing = 0;
  for (const c of [...COLLECTIBLE, ...Object.values(TOKENS)]) {
    const p = join(HERE, 'assets', 'art', `${c.id}.jpg`);
    if (!existsSync(p)) { missing++; if (missing <= 10) console.error('  missing art: ' + c.id); }
  }
  ok(missing === 0, `all card art present (${missing} missing)`);
  const { CARDBACK_INFO } = await import('./runtime/campaign/campaign_data.js?v=4');
  const uiFiles = ['board.jpg', 'menu_bg.jpg', 'cardback.jpg', 'worldmap.jpg',
    ...Object.values(CARDBACK_INFO).map((c) => c.file),
    'cm_thornqueen.jpg', 'cm_lichlord.jpg', 'cm_flamekhan.jpg', 'cm_tidecaller.jpg', 'cm_lightwarden.jpg'];
  for (const f of new Set(uiFiles)) {
    ok(existsSync(join(HERE, 'assets', 'ui', f)), `ui asset ${f}`);
  }
  // 3D minis: every MINI_MAP entry must point at a real GLB for a real legendary
  const sceneSrc = readFileSync(join(HERE, 'runtime', 'view', 'scene.js'), 'utf8');
  const miniFiles = [...sceneSrc.matchAll(/(\w+):\s*\{\s*file:\s*'(mini_\w+\.glb)'/g)];
  ok(miniFiles.length >= 9, `MINI_MAP has ${miniFiles.length} entries (>=9)`);
  for (const [, cid, file] of miniFiles) {
    const def = cardById(cid);
    ok(def?.rarity === 'legendary', `mini ${cid} is a legendary card`);
    ok(existsSync(join(HERE, 'assets', 'minis', file)), `mini glb ${file}`);
  }
}

// ───────────────────── summary ─────────────────────
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
if (failures.length) {
  console.log('failures:');
  for (const f of failures) console.log('  - ' + f);
}
process.exit(fail === 0 ? 0 : 1);
