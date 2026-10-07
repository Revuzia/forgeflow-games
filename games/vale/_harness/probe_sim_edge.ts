// probe (lane SIM): adversarial edge cases — the inputs and timings content, bots and players will
// eventually produce even though nobody designs for them. Each section pins a rule that a bug was
// once found breaking (or that is easy to break), so regressions show up here first:
//   degenerate numbers (zero durations/amounts, NaN commands), motion at walls and structures,
//   projectiles at the map edge, targets dying mid-cast, caster death vs repeats/recasts,
//   recursion guards, neutral camps, shop corner cases (full inventory, duplicate/cyclic recipes,
//   cooldown and charge state across sell/undo/swap, selling mid-cast), gold rounding,
//   same-tick endings (two cores, Fray double KO), bot controllers returning garbage.
import { Effect, type EffectT } from '../src/contracts/catalog.ts';
import type { Command, SimEvent } from '../src/contracts/sim.ts';
import { buildCatalog, fighter, item, passive, ability, unit } from './fixtures/catalog_fixture.ts';
import { addUnit, check, fighterEnt, finish, makeWorld, near, ofType, section, stepN, stepSec } from './fixtures/sim_fixture.ts';
import { FIGHTERS, fraySetup, ITEMS, laneSetup, matchCatalog, riftSetup, run, UNITS } from './fixtures/match_fixture.ts';
import { fixtureBots } from './fixtures/fixture_bot.ts';
import { matchDigest } from '../src/sim/modes/match.ts';
import { Rng } from '../src/sim/rng.ts';
import { equipItem, tryCast } from '../src/sim/abilities.ts';
import { dealDamage, killEntity } from '../src/sim/combat.ts';
import { stateDigest } from '../src/sim/core.ts';
import { makeCtx, runEffects } from '../src/sim/effects.ts';
import { SLOT_ITEM1, type Entity, type SourceRef } from '../src/sim/entity.ts';
import { issueMove } from '../src/sim/movement.ts';
import { quoteBuy } from '../src/sim/shop.ts';
import { createSim, type Sim } from '../src/sim/sim.ts';
import { respawnFighter, spawnUnit } from '../src/sim/spawn.ts';
import { counterValue } from '../src/sim/status.ts';
import type { World } from '../src/sim/world.ts';

const E = (x: Record<string, unknown>): EffectT => Effect.parse(x);
const SRC: SourceRef = { kind: 'ability', id: 'fx_edge_ability' };
function fx(w: World, a: Entity, effs: Record<string, unknown>[], o: { target?: Entity | null; px?: number; py?: number } = {}): SimEvent[] {
  const t = o.target ?? null;
  const ctx = makeCtx(a, SRC, 1, t, o.px ?? (t ? t.x : a.x + 1), o.py ?? (t ? t.y : a.y), undefined, 'a1');
  const n = w.events.length;
  runEffects(w, effs.map(E), ctx);
  return w.events.slice(n);
}
const ctr = (id: string): Record<string, unknown> => ({ op: 'counter', counter: id, add: 1 });

// ── core-level catalog ──────────────────────────────────────────────────────────────────────────
const coreCat = buildCatalog({
  fighters: [
    fighter('fx_fighter_a', {
      base: { hp: 1000, ad: 50, moveSpeed: 3.5, attackSpeed: 1 },
      // a1: unit-targeted nuke with a long windup, cost and cooldown (dead-target-mid-cast)
      a1: ability('fx_snipe', [{ op: 'damage', amount: 100, type: 'magic' }],
        { cooldown: 10, cost: 50, castTime: 0.5, targeting: { kind: 'unit', range: 20 } }),
      // a2: recast record (recast-after-death)
      a2: ability('fx_first', [ctr('fx_first_n')], { cooldown: 12, castTime: 0,
        recast: { window: 2, ability: ability('fx_second', [ctr('fx_second_n')], { cooldown: 0.2, castTime: 0 }) } }),
    }),
    fighter('fx_fighter_b', {
      base: { hp: 1000, ad: 50, moveSpeed: 3.5, attackSpeed: 1 },
      // thorns: every hit taken deals damage back (ping-pong against another thorns holder)
      passive: passive('fx_thorns', [{ on: 'damageTaken', effects: [{ op: 'damage', amount: 1, type: 'true', to: 'target' }] }]),
    }),
    fighter('fx_fighter_c', {
      base: { hp: 1000, ad: 50, moveSpeed: 3.5, attackSpeed: 1 },
      passive: passive('fx_thorns_c', [{ on: 'damageTaken', effects: [{ op: 'damage', amount: 1, type: 'true', to: 'target' }] }]),
    }),
  ],
  units: [
    unit('fx_minion', 'minion', { attack: { range: 1, windup: 0.3 } }),
    unit('fx_tower', 'structure', { base: { hp: 3000, ad: 100, attackSpeed: 0.8, moveSpeed: 0 }, collisionRadius: 1,
      attack: { range: 7, windup: 0.2, projectileSpeed: 20 } }),
    unit('fx_summon', 'summon', { attack: { range: 1, windup: 0.3 } }),
    unit('fx_ward', 'ward', { base: { hp: 3, moveSpeed: 0 }, sightRange: 8 }),
    unit('fx_dummy', 'minion', { base: { hp: 100000, ad: 0, moveSpeed: 0, attackSpeed: 0 } }),
    unit('fx_monster', 'monster', { attack: { range: 1, windup: 0.3 } }),
  ],
});
function coreWorld(): { w: World; a: Entity; b: Entity } {
  const w = makeWorld(coreCat, [{ fighter: 'fx_fighter_a', team: 0, x: 10, y: 20 }, { fighter: 'fx_fighter_b', team: 1, x: 14, y: 20 }]);
  return { w, a: fighterEnt(w, 0), b: fighterEnt(w, 1) };
}

section('degenerate durations and amounts', () => {
  const { w, a, b } = coreWorld();
  let ev = fx(w, a, [{ op: 'status', status: 'stun', duration: 0 }], { target: b });
  check('zero-duration status: ignored (no status, no event)', b.statuses.length === 0 && ofType(ev, 'status').length === 0);
  ev = fx(w, a, [{ op: 'status', status: 'slow', duration: -1 }], { target: b });
  check('negative-duration status: ignored', b.statuses.length === 0);
  fx(w, a, [{ op: 'buff', id: 'fx_b0', duration: 0, stats: { ad: 100 }, to: 'self' }]);
  check('zero-duration buff: ignored', a.buffs.length === 0);
  ev = fx(w, a, [{ op: 'shield', amount: 100, duration: 0, to: 'self' }]);
  check('zero-duration shield: ignored', a.shield === 0 && ofType(ev, 'shield').length === 0);
  const hp0 = b.hp;
  ev = fx(w, a, [{ op: 'damage', amount: 0, type: 'phys' }, { op: 'damage', amount: -50, type: 'true' }], { target: b });
  check('zero / negative damage: nothing happens (no event, no heal)', b.hp === hp0 && ofType(ev, 'damage').length === 0);
  a.hp = 500;
  fx(w, a, [{ op: 'heal', amount: -100, to: 'self' }]);
  check('negative heal: no-op', a.hp === 500);
  ev = fx(w, a, [{ op: 'zone', id: 'fx_z0', shape: { kind: 'circle', radius: 3 }, at: 'target', duration: 0, interval: 1,
    onTick: [ctr('fx_z0_tick')], onExpire: [ctr('fx_z0_end')] }], { target: b });
  stepN(w, 3);
  check('zero-duration zone: one tick, one expiry, gone', counterValue(a, 'fx_z0_tick') === 1 && counterValue(a, 'fx_z0_end') === 1 &&
    !w.entities.some((e) => e.kind === 'zone'), [counterValue(a, 'fx_z0_tick'), counterValue(a, 'fx_z0_end')]);
  fx(w, a, [{ op: 'repeat', count: 3, interval: 0, effects: [ctr('fx_rep0')] }]);
  check('repeat with interval 0: every iteration at once', counterValue(a, 'fx_rep0') === 3);
  fx(w, a, [{ op: 'projectile', speed: 20, range: 5, width: 0.5, toward: 'point', onHit: [], onEnd: [ctr('fx_p0_end')] }], { px: a.x, py: a.y });
  stepN(w, 2);
  check('projectile aimed at its own origin: ends at once (onEnd once), no NaN', counterValue(a, 'fx_p0_end') === 1 &&
    w.entities.every((e) => Number.isFinite(e.x) && Number.isFinite(e.y)));
});

section('dashes, knockbacks and blinks at walls and structures', () => {
  // FX_MAP wall slab x ∈ [28, 32], y ∈ [0, 45]
  const { w, a, b } = coreWorld();
  a.x = 24; a.y = 20; w.hashDirty = true;
  fx(w, a, [{ op: 'dash', mode: 'direction', distance: 10, speed: 20 }], { px: 40, py: 20 });
  stepSec(w, 1);
  check('dash into a wall stops before it, on a walkable spot', a.x < 28 && a.x > 26.5 && w.nav.walkable(a.x, a.y), [a.x, a.y]);
  b.x = 26; b.y = 30; w.hashDirty = true;
  a.x = 24; a.y = 30;
  fx(w, a, [{ op: 'displace', mode: 'knockback', distance: 8, duration: 0.4 }], { target: b });
  stepSec(w, 1);
  check('knockback into a wall stops before it', b.x < 28 && w.nav.walkable(b.x, b.y) && b.state !== 'dash', [b.x, b.y]);
  a.x = 26; a.y = 10; w.hashDirty = true;
  fx(w, a, [{ op: 'blink', distance: 4 }], { px: 30, py: 10 });
  check('blink into a wall lands on the nearest walkable cell', w.nav.walkable(a.x, a.y) && a.x < 28.5, [a.x, a.y]);

  // a unit hugging a structure can stand in a cell the structure blocks (it blocks radius + clearance
  // for PATHS, bodies only collide with its radius): motion out of that cell must still work
  const t = addUnit(w, 'fx_tower', 1, 45, 20);
  const reach = t.radius + a.radius + 0.01;
  let spot: [number, number] | null = null;
  for (let k = 0; k < 360 && !spot; k++) {
    const ang = (k * Math.PI) / 180;
    const x = t.x + Math.cos(ang) * reach, y = t.y + Math.sin(ang) * reach;
    if (!w.nav.walkable(x, y)) spot = [x, y];
  }
  check('setup: a touching position inside a structure-blocked cell exists', spot !== null);
  if (spot) {
    a.x = spot[0]; a.y = spot[1]; w.hashDirty = true;
    const ux = (a.x - t.x) / reach, uy = (a.y - t.y) / reach;
    const x0 = a.x, y0 = a.y;
    fx(w, a, [{ op: 'dash', mode: 'direction', distance: 4, speed: 20 }], { px: a.x + ux * 10, py: a.y + uy * 10 });
    stepSec(w, 0.5);
    check('dash away from a structure the caster is touching travels its distance', Math.hypot(a.x - x0, a.y - y0) > 3.5, [a.x, a.y]);
    b.x = spot[0]; b.y = spot[1]; w.hashDirty = true;
    const c = { x: t.x - ux * 3, y: t.y - uy * 3 };
    a.x = c.x; a.y = c.y; // on the far side: knock b away from the tower
    fx(w, a, [{ op: 'displace', mode: 'knockback', distance: 3, duration: 0.3 }], { target: b });
    const bx0 = b.x, by0 = b.y;
    stepSec(w, 0.5);
    check('knockback of a unit touching a structure moves it', Math.hypot(b.x - bx0, b.y - by0) > 2.5, [b.x, b.y]);
  }
});

section('projectiles at the map edge', () => {
  const { w, a, b } = coreWorld();
  a.x = 1; a.y = 50; w.hashDirty = true;
  fx(w, a, [{ op: 'projectile', speed: 25, range: 15, width: 0.6, stopAtWalls: true, onHit: [], onEnd: [ctr('fx_edge_end')] }], { px: -10, py: 50 });
  stepSec(w, 1);
  const leftovers = w.entities.filter((e) => e.kind === 'projectile');
  check('stopAtWalls at the map border: ends inside the map, onEnd once', counterValue(a, 'fx_edge_end') === 1 && leftovers.length === 0);
  fx(w, a, [{ op: 'projectile', speed: 25, range: 15, width: 0.6, onHit: [ctr('fx_edge_hit')], onEnd: [ctr('fx_edge_end2')] }], { px: 1, py: 100 });
  stepSec(w, 1);
  check('flying off the map: ends at range, nothing hit, no leftovers', counterValue(a, 'fx_edge_end2') === 1 && counterValue(a, 'fx_edge_hit') === 0 &&
    !w.entities.some((e) => e.kind === 'projectile'));
  // a homing shot whose target is removed from the store mid-flight
  a.x = 10; a.y = 20; b.x = 30.5; b.y = 50; w.hashDirty = true;
  w.vision.update(w.entities, w.tick);
  const m = addUnit(w, 'fx_minion', 1, 20, 50);
  fx(w, a, [{ op: 'projectile', speed: 10, range: 40, width: 0.5, toward: 'target', homing: true, onHit: [ctr('fx_hm_hit')], onEnd: [ctr('fx_hm_end')] }], { target: m });
  stepN(w, 3);
  killEntity(w, m, null);
  stepSec(w, 5);
  check('homing target removed mid-flight: flies to its last spot, ends without a hit', counterValue(a, 'fx_hm_hit') === 0 &&
    counterValue(a, 'fx_hm_end') === 1 && !w.entities.some((e) => e.kind === 'projectile'));
});

section('target dies or vanishes during a unit-targeted windup', () => {
  const { w, a, b } = coreWorld();
  a.slots[0]!.rank = 1;
  const res0 = a.res;
  check('cast starts (0.5 s windup)', tryCast(w, a, 0, undefined, undefined, b.id) === 'ok' && a.cast !== null);
  stepN(w, 5);
  killEntity(w, b, null);
  const ev = stepSec(w, 1);
  check('target died mid-windup: the cast fizzles — nothing spent', a.cast === null && near(a.res, res0) && a.slots[0]!.cooldown === 0,
    [a.res, a.slots[0]!.cooldown]);
  check('…and no hit/damage on the corpse', ofType(ev, 'hit').length === 0 && ofType(ev, 'damage').length === 0);
  respawnFighter(w, b, 14, 20);
  w.vision.update(w.entities, w.tick);
  check('recast at a living target works', tryCast(w, a, 0, undefined, undefined, b.id) === 'ok');
  stepN(w, 5);
  b.statuses.push({ kind: 'untargetable', remaining: 5, duration: 5, power: 1, basePower: 1, src: b.id, srcTeam: b.team, decay: false });
  b.targetable = false;
  const ev2 = stepSec(w, 1);
  check('target turned untargetable mid-windup: fizzles, nothing spent', near(a.res, res0) && ofType(ev2, 'damage').length === 0 && a.slots[0]!.cooldown === 0);
});

section('caster death: repeats stop (even after a respawn); recast windows close while dead', () => {
  const { w, a, b } = coreWorld();
  fx(w, a, [{ op: 'repeat', count: 5, interval: 1, effects: [ctr('fx_rep')] }]);
  check('repeat: first iteration at once', counterValue(a, 'fx_rep') === 1);
  stepSec(w, 1.05);
  check('second iteration after 1 s', counterValue(a, 'fx_rep') === 2);
  killEntity(w, a, null);
  respawnFighter(w, a);
  stepSec(w, 4);
  check('caster died (and came back): the remaining iterations never run', counterValue(a, 'fx_rep') === 2, counterValue(a, 'fx_rep'));

  a.slots[1]!.rank = 1;
  check('recast window opened', tryCast(w, a, 1) === 'ok' && a.slots[1]!.id === 'fx_second');
  killEntity(w, a, null);
  stepSec(w, 2.5);
  check('window expired while dead: slot back to its first record, cooldown started', a.slots[1]!.id === 'fx_first' && a.slots[1]!.cooldown > 9);
  respawnFighter(w, a);
  check('after respawn: on cooldown, not re-castable', tryCast(w, a, 1) === 'cooldown');
  void b;
});

section('recursion guards', () => {
  const w = makeWorld(coreCat, [{ fighter: 'fx_fighter_b', team: 0, x: 10, y: 20 }, { fighter: 'fx_fighter_c', team: 1, x: 12, y: 20 }]);
  const b = fighterEnt(w, 0), c = fighterEnt(w, 1);
  const n = w.events.length;
  dealDamage(w, b, c, 10, 'true');
  const dmg = ofType(w.events.slice(n), 'damage');
  check('thorns vs thorns: the reflect ping-pong is bounded', dmg.length > 1 && dmg.length <= 6, dmg.length);
  // a projectile whose onHit fires itself again: bounded by the effect depth cap
  const self: Record<string, unknown> = { op: 'projectile', speed: 30, range: 3, width: 1, onHit: [] };
  let nested: Record<string, unknown> = { op: 'damage', amount: 1, type: 'true' };
  for (let i = 0; i < 20; i++) nested = { ...self, onHit: [nested, ctr('fx_proj_gen')] };
  fx(w, b, [nested], { px: c.x, py: c.y });
  stepSec(w, 3);
  check('self-replicating projectile chain terminates', !w.entities.some((e) => e.kind === 'projectile') && counterValue(b, 'fx_proj_gen') <= 13,
    counterValue(b, 'fx_proj_gen'));
});

section('neutral camps: monsters are not hostile to each other', () => {
  const cat = matchCatalog({
    rules: { minionWaves: undefined, structures: false, passiveGoldPerSec: 0 },
    units: UNITS.map((u) => u.id === 'fx_beast' ? { ...u, abilities: [ability('fx_beast_stomp', [{ op: 'area', shape: { kind: 'circle', radius: 4 }, at: 'self',
      onHit: [{ op: 'damage', amount: 50, type: 'true' }] }], { cooldown: 1, ai: { use: ['damage'] } })] } : u),
  });
  const sim = createSim(cat, laneSetup([{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 1 }]), { pregameSeconds: 0 });
  const w = sim.world;
  run(sim, 10.2);
  const beasts = w.entities.filter((e) => e.def === 'fx_beast' && e.alive);
  check('setup: the two-beast camp is up', beasts.length === 2);
  const f = w.players[0].ent!;
  f.autoAttack = false;
  f.x = 61; f.y = 9; w.hashDirty = true;
  dealDamage(w, f, beasts[0], 1, 'true');
  const hp1 = beasts[1].hp;
  const ev = run(sim, 3);
  const stomps = ofType(ev, 'damage').filter((d) => d.ability === 'fx_beast_stomp');
  check('the camp fights back with its area ability', stomps.some((d) => d.dst === f.id));
  check('…which never hits its own campmates', !stomps.some((d) => beasts.some((x) => x.id === d.dst)) && beasts[1].hp >= hp1 - 1e-6,
    stomps.map((d) => d.dst));
});

section('malformed commands never corrupt the world', () => {
  const sim = createSim(matchCatalog({ rules: { minionWaves: undefined, jungle: false, structures: false } }),
    laneSetup([{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 1 }]), { pregameSeconds: 0 });
  const w = sim.world;
  const e = w.players[0].ent!;
  w.players[0].gold = 5000;
  sim.command(0, { type: 'buy', item: 'fx_sword' });
  sim.command(0, { type: 'buy', item: 'fx_potion' });
  run(sim, 0.1);
  const items0 = w.players[0].items.join();
  const bad: unknown[] = [
    { type: 'move', x: NaN, y: 10 }, { type: 'move', x: 10, y: Infinity }, { type: 'move' },
    { type: 'cast', slot: 'a3', x: NaN, y: NaN }, { type: 'cast', slot: 'spell1', x: Infinity, y: 0 },
    { type: 'sell', slot: NaN }, { type: 'sell', slot: 0.5 }, { type: 'swapItems', a: NaN, b: 0 }, { type: 'swapItems', a: 0, b: 7 },
    { type: 'swapItems', a: 0.5, b: 1 }, { type: 'attack', target: NaN }, { type: 'ping', kind: 'alert', x: NaN, y: 1 },
    { type: 'levelUp', slot: 'nope' }, { type: 'levelUp', slot: '__proto__' }, { type: 'cast', slot: 'constructor' }, { type: 'buy', item: '__proto__' },
    { type: 'ping', kind: '<img src=x>', x: 1, y: 1 }, { type: 'nonsense' }, null, 42, 'move',
  ];
  e.slots[2]!.rank = 1;
  for (const c of bad) sim.command(0, c as Command);
  let threw = '';
  let evs: SimEvent[] = [];
  try { evs = run(sim, 2); } catch (err) { threw = String(err); }
  check('no throw', threw === '', threw);
  check('a ping of an unknown kind is dropped', !evs.some((x) => x.e === 'ping'));
  check('positions stay finite', w.entities.every((x) => Number.isFinite(x.x) && Number.isFinite(x.y)), [e.x, e.y]);
  check('inventory untouched by bad slot indices', w.players[0].items.join() === items0 && Object.keys(w.players[0].items).length === 6,
    w.players[0].items);
  check('no stray non-index keys on the slot arrays', Object.keys(e.slots).length === 12);
  const nums = Object.values(w.players[0]).filter((v): v is number => typeof v === 'number');
  check('no NaN seat state; the digest is computable', nums.every((v) => !Number.isNaN(v)) && !/NaN/.test(stateDigest(w)));
});

section('a bot controller returning garbage is disabled, not fatal', () => {
  const setup = laneSetup([{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 1 }, { fighter: 'fx_brawler', team: 1 }]);
  let calls = 0;
  const sim = createSim(matchCatalog({ rules: { minionWaves: undefined, jungle: false, structures: false } }), setup, {
    pregameSeconds: 0,
    bots: (seat) => seat.player === 1
      ? { think: () => { calls++; return null as unknown as Command[]; } }
      : seat.player === 2 ? { think: () => [null as unknown as Command, { type: 'move', x: NaN, y: NaN } as Command] } : null,
  });
  let threw = '';
  try { run(sim, 1); } catch (err) { threw = String(err); }
  check('the match keeps running', threw === '' && sim.view.tick >= 29, threw);
  check('the bot returning a non-array is recorded as a fault and disabled', sim.faults.some((f) => f.startsWith('bot 1')) && calls === 1, sim.faults);
  check('null / NaN commands from a bot are dropped', Number.isFinite(sim.world.players[2].ent!.x));
});

section('a target that dies and respawns is a new target', () => {
  // homing basic-attack projectile (range ∞): its target dies mid-flight and is back at once
  const w = makeWorld(coreCat, [{ fighter: 'fx_fighter_a', team: 0, x: 10, y: 50 }, { fighter: 'fx_fighter_b', team: 1, x: 18, y: 50 }]);
  const a = fighterEnt(w, 0), b = fighterEnt(w, 1);
  a.attackDef = { range: 10, windup: 0.1, damageType: 'phys', projectileSpeed: 4 };
  a.statsDirty = true;
  a.autoAttack = true;
  w.vision.update(w.entities, w.tick);
  stepN(w, 6);
  check('setup: an attack projectile is in flight', w.entities.some((e) => e.kind === 'projectile'));
  a.autoAttack = false; a.atkTarget = -1;
  killEntity(w, b, null);
  respawnFighter(w, b, 12, 50);   // right next to the shooter
  const hp0 = b.hp;
  stepSec(w, 4);
  check('the in-flight shot does not follow the respawned target', b.hp === hp0 && !w.entities.some((e) => e.kind === 'projectile'), [b.hp, hp0]);

  // a shot in flight at a target that turns untargetable is lost
  b.x = 18; b.y = 50; w.hashDirty = true; w.vision.update(w.entities, w.tick);
  a.autoAttack = true;
  stepN(w, 6);
  check('setup: another attack projectile in flight', w.entities.some((e) => e.kind === 'projectile'));
  a.autoAttack = false; a.atkTarget = -1;
  b.statuses.push({ kind: 'untargetable', remaining: 3, duration: 3, power: 1, basePower: 1, src: b.id, srcTeam: b.team, decay: false });
  b.targetable = false;
  const hp1 = b.hp;
  stepSec(w, 4);
  check('…its target turned untargetable mid-flight: no hit', b.hp === hp1, [b.hp, hp1]);
  b.statuses.length = 0; b.targetable = true;

  // a zone following a unit stays where that unit died
  fx(w, b, [{ op: 'zone', id: 'fx_aura', shape: { kind: 'circle', radius: 1 }, at: 'self', follow: true, duration: 10, interval: 5, onTick: [] }]);
  const z = w.entities.find((e) => e.kind === 'zone')!;
  stepN(w, 2);
  const zx = z.x, zy = z.y;
  killEntity(w, b, null);
  respawnFighter(w, b, 40, 10);
  stepN(w, 3);
  check('following zone does not jump to the respawned unit', near(z.x, zx) && near(z.y, zy), [z.x, z.y]);

  // a unit-targeted windup whose target died and came back during it
  b.x = 14; b.y = 50; w.hashDirty = true; w.vision.update(w.entities, w.tick);
  a.slots[0]!.rank = 1;
  const res0 = a.res;
  check('cast at b starts', tryCast(w, a, 0, undefined, undefined, b.id) === 'ok');
  stepN(w, 3);
  killEntity(w, b, null);
  respawnFighter(w, b, 14, 50);
  const ev = stepSec(w, 1);
  check('…b died and respawned mid-windup: the cast fizzles', near(a.res, res0) && ofType(ev, 'damage').length === 0);
});

section('rules.end.coreStructure may name a map placement', () => {
  const sim = createSim(matchCatalog({ rules: { minionWaves: undefined, jungle: false, end: { kind: 'core', coreStructure: 'fx_t1_core' } } }),
    laneSetup([{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 1 }]), { pregameSeconds: 0 });
  const w = sim.world;
  sim.step();
  const core1 = w.entities.find((e) => e.def === 'fx_core' && e.team === 1)!;
  const n = w.events.length;
  killEntity(w, core1, w.players[0].ent);
  const st = ofType(w.events.slice(n), 'structure')[0];
  check("the placement's structure event is final", !!st && st.final);
  const end = ofType(sim.step(), 'end')[0];
  check('…and team 1 loses by core', !!end && end.result.reason === 'core' && end.result.winningTeam === 0, end?.result.reason);
});

section('loadouts are validated by the sim', () => {
  const cat = buildCatalog({
    fighters: [fighter('fx_fighter_a'), fighter('fx_fighter_b')],
    spells: [
      ability('fx_spell_blink', [{ op: 'blink', distance: 4 }], { cooldown: 100, targeting: { kind: 'point', range: 0 } }),
      ability('fx_spell_heal', [{ op: 'heal', amount: 50, to: 'self' }], { cooldown: 120 }),
      { ...ability('fx_spell_foreign', [], { cooldown: 10 }), pools: ['fx_other_pool'] },
    ],
    boons: [{ ...passive('fx_boon_a', [], { stats: { ad: 10 } }), path: 'fx_path' }, { ...passive('fx_boon_b', [], { stats: { ad: 5 } }), path: 'fx_path' }],
  });
  const w = makeWorld(cat, [
    { fighter: 'fx_fighter_a', team: 0, spells: ['fx_spell_foreign', 'fx_spell_heal'], boons: ['fx_boon_a', 'fx_boon_a', 'fx_boon_a'] },
    { fighter: 'fx_fighter_b', team: 1, spells: ['fx_spell_heal', 'fx_spell_heal'], boons: ['fx_boon_b', 'fx_nope'] },
  ]);
  const a = fighterEnt(w, 0), b = fighterEnt(w, 1);
  check('a spell outside the rules pool leaves its slot empty; the other keeps its slot', a.slots[4] === null && a.slots[5]?.id === 'fx_spell_heal');
  check('a duplicated boon counts once (boonSlots 1)', near(a.stats.ad, 70) && a.passives.filter((p) => p.key.startsWith('boon:')).length === 1, a.stats.ad);
  check('a duplicated spell fills one slot', b.slots[4]?.id === 'fx_spell_heal' && b.slots[5] === null);
  check('unknown ids are ignored', b.passives.filter((p) => p.key.startsWith('boon:')).length === 1 && near(b.stats.ad, 65));
});

section('setup inputs from outside the sim are sanitized', () => {
  const s1 = createSim(matchCatalog({ rules: { minionWaves: undefined, jungle: false, structures: false } }),
    laneSetup([{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 1 }]), { pregameSeconds: NaN });
  check('pregameSeconds NaN: default countdown, finite clock', Number.isFinite(s1.view.time) && s1.view.phase === 'pregame');
  const s2 = createSim(matchCatalog({ rules: { minionWaves: undefined, jungle: false, structures: false } }),
    laneSetup([{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 1 }],
      { queue: 'fx_lane_practice', practice: { startLevel: NaN, dummies: 1e9 } }), { pregameSeconds: 0 });
  const w2 = s2.world;
  check('practice startLevel NaN: start level used', w2.players[0].ent!.level === 1 && Number.isFinite(w2.players[0].ent!.maxHp));
  check('practice dummies capped', w2.entities.filter((e) => e.def === 'fx_training_dummy').length <= 20);
  const fresh = spawnUnit(w2, 'fx_lane_minion', 0, 30, 20);
  check('a new unit is visible to its own team before the next vision rebuild', (fresh.visibleMask & 1) === 1);
});

section('balance knobs come from data (rules.tuning, FighterDef.sightRange)', () => {
  const cat = matchCatalog({
    rules: { minionWaves: undefined, jungle: false, structures: false, passiveGoldPerSec: 0,
      tuning: { fountainHealPerSec: 0.5, assistWindow: 2, xpShareRange: 4, killXpFraction: 1 } },
    fighters: [{ ...FIGHTERS[0], sightRange: 20 }, FIGHTERS[1]],
  });
  const sim = createSim(cat, laneSetup([{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_ranger', team: 1 }]), { pregameSeconds: 0 });
  const w = sim.world;
  const [a, mate, foe] = w.players.map((p) => p.ent!);
  check('FighterDef.sightRange is the fighter sight; omitted = 12', a.sight === 20 && foe.sight === 12);
  a.hp = 100; a.x = 3; a.y = 20; w.hashDirty = true;
  run(sim, 1);
  check('tuning.fountainHealPerSec: 50 %/s', a.hp > 100 + a.maxHp * 0.45, [a.hp, a.maxHp]);
  for (const e of [a, mate, foe]) e.autoAttack = false;
  a.x = 60; a.y = 20; mate.x = 70; mate.y = 20; foe.x = 61; foe.y = 20; w.hashDirty = true;
  dealDamage(w, mate, foe, 10, 'true');
  run(sim, 2.5);
  const xp0 = w.players[1].xp;
  const n = w.events.length;
  dealDamage(w, a, foe, 1e7, 'true');
  const td = ofType(w.events.slice(n), 'takedown')[0];
  check('tuning.assistWindow 2 s: a hit 2.5 s ago is no assist', !!td && td.assists.length === 0, td?.assists);
  check('tuning.xpShareRange 4 m: the mate 10 m away shares no XP', w.players[1].xp === xp0);
  check('tuning.killXpFraction 1: the killer gets the full level-1 step (exactly one level; 0.6 would not level)', a.level === 2 && near(w.players[0].xp, 0),
    [a.level, w.players[0].xp]);
});

// ── shop / item corner cases ────────────────────────────────────────────────────────────────────
const itemsX = [
  ...ITEMS,
  item('fx_stasis', { tier: 'core', cost: 500, active: ability('fx_stasis_use', [ctr('fx_stasis_n')], { cooldown: 60, maxRank: 1, castTime: 0 }) }),
  item('fx_charges', { tier: 'core', cost: 500, active: ability('fx_charges_use', [ctr('fx_charges_n')],
    { cooldown: 0.5, maxRank: 1, castTime: 0, charges: { max: 2, recharge: 40 } }) }),
  item('fx_slow_potion', { tier: 'consumable', cost: 50, consumable: { charges: 1, maxStack: 5 },
    active: ability('fx_slow_drink', [{ op: 'heal', amount: 100, to: 'self' }], { cooldown: 0, maxRank: 1, castTime: 1 }) }),
  item('fx_loop', { tier: 'core', cost: 900, components: ['fx_loop'] }),
];
const shopCat = matchCatalog({ items: itemsX, rules: { minionWaves: undefined, jungle: false, structures: false, passiveGoldPerSec: 0, startGold: 20000,
  fountainHeals: false } });
const shopSim = (): Sim => createSim(shopCat, laneSetup([{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 1 }]), { pregameSeconds: 0 });
function cmd(sim: Sim, c: Command, p = 0): SimEvent[] { sim.command(p, c); return sim.step(); }
const denied = (ev: SimEvent[]): string | undefined => ofType(ev, 'announce').find((a) => a.key === 'shop_denied')?.params?.reason as string | undefined;

section('shop: full inventory, duplicate and cyclic recipes', () => {
  const sim = shopSim();
  const w = sim.world, p = w.players[0];
  for (let i = 0; i < 6; i++) cmd(sim, { type: 'buy', item: 'fx_sword' });
  check('six swords fill the inventory', p.items.every((x) => x === 'fx_sword'));
  check("a plain item with a full inventory: denied 'slots'", denied(cmd(sim, { type: 'buy', item: 'fx_gem' })) === 'slots');
  const g = p.gold;
  cmd(sim, { type: 'buy', item: 'fx_blade' });
  check('a recipe with duplicate components consumes two owned copies (price 1200 − 2 × 400)', p.items.filter((x) => x === 'fx_sword').length === 4 &&
    p.items.includes('fx_blade') && near(g - p.gold, 400), [p.items, g - p.gold]);
  const q = quoteBuy(w, p, 'fx_loop');
  check('a self-referencing recipe terminates (price = full cost)', q.price === 900);
  sim.command(0, { type: 'sell', slot: 5 });
  sim.step();
  cmd(sim, { type: 'buy', item: 'fx_potion' });
  for (let i = 0; i < 4; i++) cmd(sim, { type: 'buy', item: 'fx_sword' }); // full again (one slot is potions)
  const potSlot = p.items.indexOf('fx_potion');
  cmd(sim, { type: 'buy', item: 'fx_potion' });
  check('consumables still stack with a full inventory', potSlot >= 0 && p.itemCharges[potSlot] === 2, p.itemCharges);
});

section('shop: item cooldowns and charges survive sell/undo and swaps', () => {
  const sim = shopSim();
  const w = sim.world, p = w.players[0], e = p.ent!;
  cmd(sim, { type: 'buy', item: 'fx_stasis' });
  cmd(sim, { type: 'buy', item: 'fx_charges' });
  sim.step();
  cmd(sim, { type: 'cast', slot: 'item1' });
  check('item active used: 60 s cooldown', counterValue(e, 'fx_stasis_n') === 1 && e.slots[SLOT_ITEM1]!.cooldown > 59);
  run(sim, 1);
  cmd(sim, { type: 'sell', slot: 0 });
  cmd(sim, { type: 'undo' });
  check('sell + undo restores the item…', p.items[0] === 'fx_stasis');
  check('…with its cooldown still running (no free reset)', e.slots[SLOT_ITEM1]!.cooldown > 57, e.slots[SLOT_ITEM1]!.cooldown);
  cmd(sim, { type: 'cast', slot: 'item2' });
  run(sim, 0.6);
  cmd(sim, { type: 'cast', slot: 'item2' });
  check('both charges used', counterValue(e, 'fx_charges_n') === 2 && e.slots[SLOT_ITEM1 + 1]!.charges === 0);
  cmd(sim, { type: 'swapItems', a: 0, b: 1 });
  const moved = e.slots[SLOT_ITEM1]!;
  check('swap: the charge item moved to slot 1 with 0 charges (no refill)', p.items[0] === 'fx_charges' && moved.charges === 0 && moved.slot === 'item1',
    [moved.charges, moved.slot]);
  check('swap: the other item keeps its cooldown', e.slots[SLOT_ITEM1 + 1]!.cooldown > 56 && e.slots[SLOT_ITEM1 + 1]!.slot === 'item2');
  check('casting the swapped slot uses the right item', cmd(sim, { type: 'cast', slot: 'item1' }) && counterValue(e, 'fx_charges_n') === 2);
});

section('shop: selling an item mid-cast', () => {
  const sim = shopSim();
  const w = sim.world, p = w.players[0], e = p.ent!;
  cmd(sim, { type: 'buy', item: 'fx_slow_potion' });
  e.hp = 500;
  cmd(sim, { type: 'cast', slot: 'item1' });
  check('drinking (1 s windup)', e.cast !== null);
  sim.command(0, { type: 'sell', slot: 0 });
  sim.command(0, { type: 'buy', item: 'fx_potion' });
  sim.step();
  run(sim, 1.5);
  check('the sold item’s cast is cancelled (no heal; regen only)', e.hp < 510, e.hp);
  check('the item bought into the same slot keeps its charge', p.items[0] === 'fx_potion' && p.itemCharges[0] === 1, [p.items[0], p.itemCharges[0]]);
});

section('summons and ground casts aimed past the map edge stay on the map', () => {
  const { w, a } = coreWorld();
  a.x = 2; a.y = 30; w.hashDirty = true;
  fx(w, a, [{ op: 'summon', unit: 'fx_summon', count: 1, duration: 5, at: 'point' }], { px: -100, py: 30 });
  const s = w.entities.find((e) => e.kind === 'summon');
  check('a summon aimed 100 m off the map lands on it', !!s && s.x >= 0 && s.x <= 60 && w.nav.walkable(s.x, s.y), s && [s.x, s.y]);
  const sim = createSim(shopCat, laneSetup([{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 1 }]), { pregameSeconds: 0 });
  const p = sim.world.players[0], e = p.ent!;
  sim.command(0, { type: 'buy', item: 'fx_ward_item' });
  sim.step();
  e.x = 3; e.y = 20; sim.world.hashDirty = true;
  sim.command(0, { type: 'cast', slot: 'item1', x: -40, y: 20 });
  run(sim, 1);
  const ward = sim.world.entities.find((x) => x.kind === 'ward');
  check('a ward placed past the map edge goes down at the edge (not an endless walk)', !!ward && ward.x >= 0 && ward.x < 1, ward && [ward.x, ward.y]);
});

section('gold ops are rounded after goldMult', () => {
  const sim = createSim(matchCatalog({ rules: { minionWaves: undefined, jungle: false, structures: false, passiveGoldPerSec: 0, goldMult: 1.5 } }),
    laneSetup([{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 1 }]), { pregameSeconds: 0 });
  const w = sim.world, e = w.players[0].ent!;
  const g0 = w.players[0].gold;
  const ctx = makeCtx(e, SRC, 1, null, e.x, e.y, undefined, null);
  const n = w.events.length;
  runEffects(w, [E({ op: 'gold', amount: 5 })], ctx);
  const gev = ofType(w.events.slice(n), 'gold');
  check('5 × 1.5 = 7.5 → 8 whole gold', w.players[0].gold - g0 === 8 && gev.length === 1 && gev[0].amount === 8, [w.players[0].gold - g0, gev]);
});

// ── same-tick endings ───────────────────────────────────────────────────────────────────────────
section('two cores fall on the same tick: a draw', () => {
  const sim = createSim(matchCatalog({ rules: { minionWaves: undefined, jungle: false } }),
    laneSetup([{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 1 }]), { pregameSeconds: 0 });
  const w = sim.world;
  sim.step();
  const cores = w.entities.filter((x) => x.def === 'fx_core');
  for (const c of cores) killEntity(w, c, null);
  const ev = sim.step();
  const end = ofType(ev, 'end')[0];
  check('match ends, reason core, no winner', !!end && end.result.reason === 'core' && end.result.winningTeam === -1, end?.result.reason);
  check('everyone placed 1, nobody won', !!end && end.result.players.every((p) => p.placement === 1 && !p.won));
});

section('Fray: simultaneous eliminations are ranked, not decided by processing order', () => {
  const sim = createSim(matchCatalog({ frayRules: { end: { kind: 'last_standing_or_score', lives: 1, killScore: 99, timeLimit: 240 } } }),
    fraySetup(3), { pregameSeconds: 0 });
  const w = sim.world;
  for (const p of w.players) p.ent!.autoAttack = false;
  dealDamage(w, w.players[1].ent!, w.players[2].ent!, 1e7, 'true');
  sim.step();
  check('first elimination: placement 3', w.players[2].placement === 3);
  // seats 0 and 1 go down on the same tick; seat 1 has the kill, so it ranks higher even though
  // its death is processed first (processing order used to decide: the later death won)
  killEntity(w, w.players[1].ent!, null);
  killEntity(w, w.players[0].ent!, null);
  const ev = sim.step();
  const end = ofType(ev, 'end')[0];
  check('double KO of the last two ends the match', !!end && end.result.reason === 'last_standing');
  const pl = Object.fromEntries((end?.result.players ?? []).map((p) => [p.player, p.placement]));
  check('distinct placements; the better score takes 1st', pl[1] === 1 && pl[0] === 2 && pl[2] === 3, pl);
  check('eliminated events carry the final placements', ofType(ev, 'eliminated').map((x) => `${x.player}:${x.placement}`).sort().join() === '0:2,1:1',
    ofType(ev, 'eliminated'));
  check('exactly one winner', end?.result.players.filter((p) => p.won).length === 1);
});

section('Fray: lives default to 1; no respawn at 0 lives', () => {
  const sim = createSim(matchCatalog({ frayRules: { end: { kind: 'last_standing_or_score', killScore: 99, timeLimit: 240 } } }), fraySetup(4), { pregameSeconds: 0 });
  const w = sim.world;
  check('lives default 1', w.players.every((p) => p.lives === 1));
  killEntity(w, w.players[3].ent!, null);
  run(sim, 20);
  check('eliminated on the first death, never respawns', !w.players[3].ent!.alive && w.players[3].placement === 4 && w.players[3].respawnIn === 0);
});

// ── fuzz: a full match under random (partly malformed) input ───────────────────────────────────
section('fuzz: 10-seat match, random commands, invariants every tick, deterministic', () => {
  const cat = matchCatalog({ items: itemsX });
  const itemIds = cat.items.map((i) => i.id).concat(['fx_no_such_item']);
  const slots = ['a1', 'a2', 'a3', 'ult', 'spell1', 'spell2', 'item1', 'item2', 'item3', 'item4', 'item5', 'item6', 'passive'] as const;
  const runOnce = (seed: number): { digest: string; violations: string[]; ticks: number } => {
    const setup = riftSetup({ seed });
    const sim = createSim(cat, setup, {
      pregameSeconds: 1,
      bots: fixtureBots((s) => (s.player % 2 ? 'push' : 'defend'), { buy: 'fx_sword' }),
    });
    const w = sim.world;
    const rng = new Rng(seed ^ 0x5eed);
    const violations: string[] = [];
    const S = w.mapDef.size;
    for (let t = 0; t < 30 * 90 && w.phase !== 'ended'; t++) {
      // seats 0..4 are "players" mashing random input (the fixture bots drive 5..9 via opts.bots)
      for (let p = 0; p < 5; p++) {
        if (!rng.chance(0.3)) continue;
        const x = rng.chance(0.03) ? NaN : rng.range(-5, S[0] + 5), y = rng.range(-5, S[1] + 5);
        const ents = w.entities;
        const target = ents.length ? ents[rng.int(0, ents.length - 1)].id : 1;
        const pick: Command[] = [
          { type: 'move', x, y, attackMove: rng.chance(0.5) }, { type: 'attack', target }, { type: 'stop' },
          { type: 'cast', slot: slots[rng.int(0, slots.length - 1)], x, y, target: rng.chance(0.5) ? target : undefined },
          { type: 'levelUp', slot: (['a1', 'a2', 'a3', 'ult'] as const)[rng.int(0, 3)] },
          { type: 'buy', item: itemIds[rng.int(0, itemIds.length - 1)] }, { type: 'sell', slot: rng.int(-1, 6) }, { type: 'undo' },
          { type: 'swapItems', a: rng.int(0, 5), b: rng.int(0, 5) }, { type: 'recall' },
          { type: 'ping', kind: 'alert', x: rng.range(0, S[0]), y: rng.range(0, S[1]) }, { type: 'surrenderVote', yes: rng.chance(0.5) },
          { type: 'practice', action: 'gold' },
        ];
        sim.command(p, pick[rng.int(0, pick.length - 1)]);
      }
      sim.step();
      if (violations.length < 5) {
        for (const e of w.entities) {
          if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.hp)) { violations.push(`tick ${w.tick}: ${e.kind} ${e.id} non-finite`); break; }
          if (e.kind !== 'projectile' && e.kind !== 'zone' && (e.x < -0.01 || e.y < -0.01 || e.x > S[0] + 0.01 || e.y > S[1] + 0.01)) { violations.push(`tick ${w.tick}: ${e.kind} ${e.id} off the map (${e.x}, ${e.y})`); break; }
          if (e.hp < 0 || e.hp > e.maxHp + 1e-6 || e.shield < -1e-9 || e.res < -1e-9 || e.res > e.maxRes + 1e-6) { violations.push(`tick ${w.tick}: ${e.kind} ${e.id} pools out of range`); break; }
        }
        for (const p of w.players) {
          if (!(p.gold >= 0) || p.items.length !== 6 || Object.keys(p.items).length !== 6) violations.push(`tick ${w.tick}: seat ${p.player} gold/items broken`);
          if (p.items.some((it) => it !== null && !w.idx.items.has(it))) violations.push(`tick ${w.tick}: seat ${p.player} holds an unknown item`);
        }
      }
    }
    return { digest: matchDigest(w), violations, ticks: w.tick };
  };
  const r1 = runOnce(99), r2 = runOnce(99);
  check('fuzzed match: invariants hold every tick (finite, on the map, pools in range, inventory sane)', r1.violations.length === 0, r1.violations);
  check('fuzzed match: same seed + same input ⇒ same digest', r1.digest === r2.digest && r1.ticks === r2.ticks, [r1.digest, r2.digest]);
});

finish('probe_sim_edge');
