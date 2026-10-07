// probe (lane SIM): cast pipeline — validation, ranks/level-up rules, cooldown haste, costs by
// costKind (pool/hp/heat), move-into-range, windup + cancels, channels, recast windows, charges,
// battle spells and item actives through the same pipeline, and every passive trigger kind.
import { ability, buildCatalog, fighter, item, passive } from './fixtures/catalog_fixture.ts';
import { addUnit, check, fighterEnt, finish, makeWorld, near, ofType, section, stepN, stepSec } from './fixtures/sim_fixture.ts';
import type { SimEvent } from '../src/contracts/sim.ts';
import { equipItem, levelUpAbility, setLevel, tryCast } from '../src/sim/abilities.ts';
import { addShield, dealDamage, heal, killEntity } from '../src/sim/combat.ts';
import type { Entity } from '../src/sim/entity.ts';
import { issueAttack, issueMove } from '../src/sim/movement.ts';
import { respawnFighter } from '../src/sim/spawn.ts';
import { applyStatus, counterValue } from '../src/sim/status.ts';
import type { World } from '../src/sim/world.ts';

const ctr = (id: string, add = 1) => ({ op: 'counter', counter: id, add });
/** counter ids must be lower_snake_case (the fixture is schema-validated) */
const snake = (s: string): string => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const trig = (on: string, extra: Record<string, unknown> = {}, id = `t_${snake(on)}`) => ({ on, effects: [ctr(id)], ...extra });

const cat = buildCatalog({
  fighters: [
    fighter('fx_fighter_a', {
      a1: ability('fx_jab', [{ op: 'damage', amount: 100, type: 'true' }], { cooldown: [10, 8, 6], cost: [50, 60], castTime: 0.25, targeting: { kind: 'unit', range: 5 } }),
      a2: ability('fx_lob', [{ op: 'area', shape: { kind: 'circle', radius: 1 }, onHit: [{ op: 'damage', amount: 30, type: 'true' }] }], { cooldown: 2, castTime: 0.5, targeting: { kind: 'point', range: 8 } }),
      a3: ability('fx_charge', [ctr('fx_c3')], { cooldown: 0.5, charges: { max: 2, recharge: 4 } }),
      ult: ability('fx_first', [ctr('fx_u', 1)], { cooldown: 20, recast: { window: 3, ability: ability('fx_second', [ctr('fx_u', 10)], { cooldown: 0.5 }) } }),
    }),
    fighter('fx_fighter_b', {
      a1: ability('fx_chan', [ctr('fx_done')], { cooldown: 1, channel: { duration: 1, interval: 0.25, onTick: [ctr('fx_tick')] } }),
      a2: ability('fx_chan_hard', [ctr('fx_done2')], { cooldown: 1, channel: { duration: 1, interruptible: false } }),
      a3: ability('fx_chan_move', [ctr('fx_done3')], { cooldown: 1, channel: { duration: 1, canMove: true } }),
      ult: ability('fx_blood', [ctr('fx_paid')], { cooldown: 1, cost: 100, costKind: 'hp' }),
    }),
    fighter('fx_fighter_c', { resource: 'fx_heat', a1: ability('fx_hot', [], { cooldown: 0, cost: 60 }) }),
    fighter('fx_fighter_d', {
      base: { ad: 30, attackSpeed: 1, hp: 1000 },
      a1: ability('fx_zap', [{ op: 'damage', amount: 5, type: 'true' }], { cooldown: 0, targeting: { kind: 'unit', range: 10 } }),
      a2: ability('fx_ally_only', [], { cooldown: 0, targeting: { kind: 'unit', range: 10, filter: { allies: true, enemies: false } } }),
      passive: passive('fx_trig', [
        trig('attackHit'), trig('abilityHit'), trig('abilityCast'), trig('takedown'), trig('kill'), trig('damageTaken'), trig('damageDealt'),
        trig('interval', { interval: 1 }), trig('lowHp'), trig('spawn'), trig('death'), trig('moveDistance', { interval: 2 }, 't_move'),
        trig('shieldBroken'), trig('statusApplied'), trig('levelUp'),
        trig('damageDealt', { cooldown: 2 }, 't_cd'), trig('damageDealt', { perTargetCooldown: 5 }, 't_per'),
        trig('damageDealt', { filter: { fighters: false } }, 't_filter'), trig('damageDealt', { cond: { kind: 'targetHpBelow', pct: 0.5 } }, 't_cond'),
      ]),
    }),
  ],
  items: [
    item('fx_item_haste', { stats: { haste: 100 } }),
    item('fx_item_act', { active: ability('fx_act', [{ op: 'shield', amount: 50, duration: 2 }], { cooldown: 30 }) }),
    item('fx_item_pot', { tier: 'consumable', consumable: { charges: 2, maxStack: 2 }, active: ability('fx_pot', [{ op: 'heal', amount: 40 }], { cooldown: 0 }) }),
    item('fx_item_onhit', { passives: [passive('fx_onhit', [trig('attackHit', {}, 't_item')])] }),
  ],
  boons: [{ ...passive('fx_boon_tick', [trig('interval', { interval: 0.5 }, 't_boon')]), path: 'fx_path' }],
});

function capture(w: World, fn: () => void): SimEvent[] { const n = w.events.length; fn(); return w.events.slice(n); }
function W(seats: { fighter: string; team: number; x: number; y: number; boons?: string[] }[]): World { return makeWorld(cat, seats); }
const A = (w: World): Entity => fighterEnt(w, 0);

section('validation + ranks', () => {
  const w = W([{ fighter: 'fx_fighter_a', team: 0, x: 10, y: 10 }, { fighter: 'fx_fighter_b', team: 1, x: 13, y: 10 }]);
  const a = A(w), b = fighterEnt(w, 1);
  check('rank 0 refused', tryCast(w, a, 0, undefined, undefined, b.id) === 'rank');
  check('one skill point at level 1', w.players[0].skillPoints === 1);
  check('level-up a1', levelUpAbility(w, a, 'a1') && a.slots[0]!.rank === 1 && w.players[0].skillPoints === 0);
  check('no skill points: refused', !levelUpAbility(w, a, 'a2'));
  setLevel(w, a, 2);
  check('basic rank cap ceil(level/2): a1 rank 2 needs level 3', !levelUpAbility(w, a, 'a1') && levelUpAbility(w, a, 'a2'));
  setLevel(w, a, 5);
  check('ult needs ultLevels[0] = 6; basics follow ceil(level/2)', !levelUpAbility(w, a, 'ult') && levelUpAbility(w, a, 'a1') && a.slots[0]!.rank === 2);
  setLevel(w, a, 6);
  check('ult at 6; levelUp events', levelUpAbility(w, a, 'ult'));
  // granted 1 + 1 + 3 + 1, spent a1 a2 a1 ult
  check('setLevel grants skill points per level', w.players[0].skillPoints === 2, w.players[0].skillPoints);
  stepN(w, 1);
  check('canLevel view flag', a.slots[1]!.canLevel && !a.slots[3]!.canLevel);
  check('missing slot', tryCast(w, a, 9) === 'no_slot');
  check('enemy-only unit ability on self refused', tryCast(w, a, 0, undefined, undefined, a.id) === 'target');
});

section('windup, cost, cooldown, range', () => {
  const w = W([{ fighter: 'fx_fighter_a', team: 0, x: 10, y: 10 }, { fighter: 'fx_fighter_b', team: 1, x: 13, y: 10 }]);
  const a = A(w), b = fighterEnt(w, 1);
  a.slots[0]!.rank = 1; a.slots[1]!.rank = 1; a.slots[2]!.rank = 1; a.slots[3]!.rank = 1;
  const res0 = a.res;
  let ev = capture(w, () => tryCast(w, a, 0, undefined, undefined, b.id));
  check('cast event at windup start', ofType(ev, 'cast').some((c) => c.ability === 'fx_jab' && c.target === b.id && near(c.castTime, 0.25)));
  check('nothing spent during the windup', near(a.res, res0) && a.slots[0]!.cooldown === 0 && a.cast !== null);
  stepN(w, 1);
  check('state cast + anim cast_a1', a.state === 'cast' && a.anim === 'cast_a1');
  check('busy while casting', tryCast(w, a, 2) === 'busy');
  ev = stepSec(w, 0.3);
  check('effects land after castTime', ofType(ev, 'damage').some((d) => d.dst === b.id && near(d.amount, 100)));
  check('cost paid + cooldown started at release', near(a.res, res0 - 50, 1) && near(a.slots[0]!.cooldown, 10 - (0.3 - 0.25), 0.07), [a.res, a.slots[0]!.cooldown]);
  check('cooldown refuses', tryCast(w, a, 0, undefined, undefined, b.id) === 'cooldown');
  a.slots[0]!.cooldown = 0;
  a.res = 10;
  check('cost refuses', tryCast(w, a, 0, undefined, undefined, b.id) === 'cost');
  a.res = 300;
  // haste
  equipItem(w, a, 0, 'fx_item_haste');
  stepN(w, 1);
  tryCast(w, a, 0, undefined, undefined, b.id);
  stepSec(w, 0.3);
  check('cooldown with haste 100: cd × 100/200', near(a.slots[0]!.cooldown, 5 - 0.05, 0.07), a.slots[0]!.cooldown);
  // out of range: walk then cast
  a.slots[0]!.cooldown = 0;
  b.x = 30; b.y = 10;
  w.vision.update(w.entities, w.tick);
  check('target outside vision: refused', tryCast(w, a, 0, undefined, undefined, b.id) === 'target');
  b.x = 19;
  w.vision.update(w.entities, w.tick);
  check('out of range: moving', tryCast(w, a, 0, undefined, undefined, b.id) === 'moving');
  ev = stepSec(w, 4);
  check('walks into range, then casts', ofType(ev, 'cast').some((c) => c.ability === 'fx_jab') && ofType(ev, 'damage').some((d) => d.dst === b.id) &&
    Math.hypot(a.x - b.x, a.y - b.y) <= 5 + b.radius + 0.2, [a.x, b.x]);
  // point targeting out of range
  a.x = 10; a.y = 10;
  check('point out of range: moving', tryCast(w, a, 1, 22, 10) === 'moving');
  ev = stepSec(w, 4);
  check('point cast after walking', ofType(ev, 'area').some((x) => near(x.x, 22) && near(x.y, 10)) && a.x >= 22 - 8 - 0.2);
  // stun cancels the windup: nothing spent
  a.slots[0]!.cooldown = 0; a.res = 300;
  a.x = 22; a.y = 10;
  tryCast(w, a, 0, undefined, undefined, b.id);
  stepN(w, 3);
  applyStatus(w, b, a, 'stun', 0.2);
  check('stun cancels windup; no cost, no cooldown', a.cast === null && near(a.res, 300, 1) && a.slots[0]!.cooldown === 0);
  stepSec(w, 0.3);
  tryCast(w, a, 0, undefined, undefined, b.id);
  stepN(w, 3);
  applyStatus(w, b, a, 'silence', 0.2);
  check('silence cancels an ability windup', a.cast === null);
  stepSec(w, 0.3);
  // a move order does not cancel a windup: the cast resolves, then the walk starts
  tryCast(w, a, 0, undefined, undefined, b.id);
  stepN(w, 2);
  const x0 = a.x;
  issueMove(w, a, 5, 10, false);
  stepN(w, 2);
  check('move order waits for the windup', a.cast !== null && near(a.x, x0));
  ev = stepSec(w, 0.5);
  check('…the cast resolves, then the walk starts', ofType(ev, 'damage').some((d) => d.dst === b.id) && a.x < x0 - 0.3);
});

section('channels', () => {
  const w = W([{ fighter: 'fx_fighter_b', team: 0, x: 10, y: 10 }, { fighter: 'fx_fighter_a', team: 1, x: 13, y: 10 }]);
  const b = A(w), a = fighterEnt(w, 1);
  for (let i = 0; i < 4; i++) b.slots[i]!.rank = 1;
  tryCast(w, b, 0);
  stepN(w, 1);
  check('channel state', b.state === 'channel' && b.anim === 'channel');
  stepSec(w, 1.1);
  check('onTick every interval (duration/interval = 4)', counterValue(b, 'fx_tick') === 4, counterValue(b, 'fx_tick'));
  check('effects run when the channel completes', counterValue(b, 'fx_done') === 1);
  stepSec(w, 1);
  tryCast(w, b, 0);
  stepSec(w, 0.4);
  applyStatus(w, a, b, 'stun', 0.1);
  stepSec(w, 1);
  check('interruptible channel: stun ends it, completion effects skipped', counterValue(b, 'fx_done') === 1 && counterValue(b, 'fx_tick') === 5, counterValue(b, 'fx_tick'));
  tryCast(w, b, 1);
  stepSec(w, 0.4);
  applyStatus(w, a, b, 'stun', 0.1);
  stepSec(w, 1);
  check('non-interruptible channel survives CC', counterValue(b, 'fx_done2') === 1);
  tryCast(w, b, 0);
  stepSec(w, 0.3);
  issueMove(w, b, 15, 15, false);
  stepSec(w, 1);
  check('a move order ends a channel', counterValue(b, 'fx_done') === 1);
  b.x = 10; b.y = 10;
  tryCast(w, b, 2);
  issueMove(w, b, 10, 14, false);
  stepSec(w, 1.1);
  check('canMove channel: walks and still completes', counterValue(b, 'fx_done3') === 1 && b.y > 12);
  const hp0 = b.hp;
  tryCast(w, b, 3);
  check('costKind hp spends hp', near(b.hp, hp0 - 100) && counterValue(b, 'fx_paid') === 1);
  b.hp = 50;
  b.slots[3]!.cooldown = 0;
  check('costKind hp cannot kill', tryCast(w, b, 3) === 'cost');
});

section('recast + charges', () => {
  const w = W([{ fighter: 'fx_fighter_a', team: 0, x: 10, y: 10 }, { fighter: 'fx_fighter_b', team: 1, x: 40, y: 50 }]);
  const a = A(w);
  for (let i = 0; i < 4; i++) a.slots[i]!.rank = 1;
  const u = a.slots[3]!;
  tryCast(w, a, 3);
  check('recast window opens: slot casts the recast record', u.id === 'fx_second' && near(u.recastWindow ?? 0, 3) && counterValue(a, 'fx_u') === 1);
  check('recast lockout (recast record cooldown)', tryCast(w, a, 3) === 'cooldown');
  stepSec(w, 0.6);
  check('recast usable after lockout', tryCast(w, a, 3) === 'ok' && counterValue(a, 'fx_u') === 11);
  check('slot returns; original cooldown starts after the recast', u.id === 'fx_first' && near(u.cooldown, 20, 1e-6) && u.recastWindow === undefined);
  u.cooldown = 0;
  tryCast(w, a, 3);
  stepSec(w, 3.1);
  check('window expiry: slot returns, cooldown starts', u.id === 'fx_first' && u.cooldown > 19 && counterValue(a, 'fx_u') === 12);
  const c = a.slots[2]!;
  check('charges start full', c.charges === 2 && c.maxCharges === 2);
  tryCast(w, a, 2);
  check('charge lockout between uses', tryCast(w, a, 2) === 'cooldown');
  stepSec(w, 0.6);
  check('second charge', tryCast(w, a, 2) === 'ok' && c.charges === 0);
  stepSec(w, 0.6);
  check('no charges: refused', tryCast(w, a, 2) === 'cooldown');
  stepSec(w, 3);
  check('recharge restores one charge', c.charges === 1, c.charges);
  stepSec(w, 4.1);
  check('…then the next', c.charges === 2 && counterValue(a, 'fx_c3') === 2);
});

section('heat resource', () => {
  const w = W([{ fighter: 'fx_fighter_c', team: 0, x: 10, y: 10 }, { fighter: 'fx_fighter_b', team: 1, x: 40, y: 50 }]);
  const c = A(w);
  c.slots[0]!.rank = 1;
  check('heat starts at 0', c.res === 0 && c.maxRes === 100);
  tryCast(w, c, 0);
  check('heat builds on spend', near(c.res, 60));
  tryCast(w, c, 0);
  check('reaching max overheats', c.overheat > 0 && tryCast(w, c, 0) === 'cost');
  stepSec(w, 2.1);
  check('lock ends: vented to 0, castable again', c.overheat === 0 && c.res === 0 && tryCast(w, c, 0) === 'ok');
  stepSec(w, 2);
  check('heat decays after decayDelay', c.res < 60 && c.res > 0, c.res);
});

section('battle spells + item actives', () => {
  const w = W([{ fighter: 'fx_fighter_a', team: 0, x: 10, y: 10 }, { fighter: 'fx_fighter_b', team: 1, x: 40, y: 50 }]);
  const a = A(w);
  check('spell slots from loadout', a.slots[4]!.id === 'fx_spell_blink' && a.slots[5]!.id === 'fx_spell_heal' && w.players[0].abilities.length === 6);
  equipItem(w, a, 0, 'fx_item_haste');
  stepN(w, 1);
  let ev = capture(w, () => tryCast(w, a, 4, 20, 10));
  check('spell cast through the pipeline (blink)', ofType(ev, 'cast').some((c) => c.slot === 'spell1') && ofType(ev, 'blink').length === 1);
  check('haste does not shorten battle spells', near(a.slots[4]!.cooldown, 100));
  applyStatus(w, a, a, 'silence', 1);
  setLevel(w, a, 2);
  a.hp = 500;
  ev = capture(w, () => tryCast(w, a, 5));
  check('silence does not block spells; spell rank = min(level, maxRank)', ofType(ev, 'heal').some((h) => near(h.amount, 60)), ofType(ev, 'heal'));
  equipItem(w, a, 1, 'fx_item_act');
  check('item active slot', a.slots[7]!.id === 'fx_act' && a.slots[7]!.kind === 'item');
  ev = capture(w, () => tryCast(w, a, 7));
  check('item active cast', ofType(ev, 'shield').length === 1 && ofType(ev, 'cast').some((c) => c.slot === 'item2'));
  stepN(w, 1);
  check('item cooldown mirrored into PlayerView.itemCooldowns', w.players[0].itemCooldowns[1] > 29);
  equipItem(w, a, 2, 'fx_item_pot');
  a.hp = 100;
  tryCast(w, a, 8);
  check('consumable: charge used', w.players[0].itemCharges[2] === 1 && w.players[0].items[2] === 'fx_item_pot');
  tryCast(w, a, 8);
  check('consumable: removed at 0 charges', w.players[0].items[2] === null && a.slots[8] === null);
  equipItem(w, a, 1, null);
  check('unequip removes the active', a.slots[7] === null);
});

section('passive triggers', () => {
  const w = W([
    { fighter: 'fx_fighter_d', team: 0, x: 10, y: 10, boons: ['fx_boon_tick'] },
    { fighter: 'fx_fighter_b', team: 1, x: 11.5, y: 10 }, { fighter: 'fx_fighter_b', team: 1, x: 12, y: 13 },
  ]);
  const d = A(w), e1 = fighterEnt(w, 1), e2 = fighterEnt(w, 2);
  d.slots[0]!.rank = 1; d.slots[1]!.rank = 1;
  const C = (id: string): number => counterValue(d, id);
  check('spawn fired at creation', C('t_spawn') === 1);
  stepSec(w, 1.05);
  check('interval (1 s) + boon interval (0.5 s)', C('t_interval') === 1 && C('t_boon') === 2, [C('t_interval'), C('t_boon')]);
  equipItem(w, d, 0, 'fx_item_onhit');
  issueAttack(w, d, e1);
  stepSec(w, 0.5);
  check('attackHit (kit + item passive)', C('t_attack_hit') === 1 && C('t_item') === 1);
  check('damageDealt', C('t_damage_dealt') >= 1);
  issueMove(w, d, 10, 10, false);
  stepSec(w, 0.2);
  tryCast(w, d, 0, undefined, undefined, e1.id);
  check('abilityCast + abilityHit', C('t_ability_cast') === 1 && C('t_ability_hit') === 1);
  check('ally-only targeting refuses an enemy', tryCast(w, d, 1, undefined, undefined, e1.id) === 'target');
  const cd0 = C('t_cd');
  tryCast(w, d, 0, undefined, undefined, e1.id);
  tryCast(w, d, 0, undefined, undefined, e2.id);
  check('trigger cooldown', C('t_cd') === cd0, [cd0, C('t_cd')]);
  check('perTargetCooldown: once per target', C('t_per') === 2, C('t_per'));
  check('filter (non-fighters only) never fired on fighters', C('t_filter') === 0);
  const m = addUnit(w, 'fx_dummy', 1, 12, 9);
  tryCast(w, d, 0, undefined, undefined, m.id);
  check('filter fires on a matching subject', C('t_filter') === 1);
  e1.hp = 100;
  tryCast(w, d, 0, undefined, undefined, e1.id);
  check('cond (targetHpBelow 0.5)', C('t_cond') >= 1);
  dealDamage(w, e1, d, 10, 'true');
  check('damageTaken', C('t_damage_taken') === 1);
  addShield(w, e1, d, 20, 5);
  dealDamage(w, e1, d, 30, 'true');
  check('shieldBroken', C('t_shield_broken') === 1);
  dealDamage(w, e1, d, d.hp - d.maxHp * 0.2, 'true');
  check('lowHp fires once on the dip', C('t_low_hp') === 1);
  dealDamage(w, e1, d, 10, 'true');
  check('lowHp does not refire while low', C('t_low_hp') === 1);
  heal(w, d, d, 1e6);
  stepN(w, 1);
  dealDamage(w, e1, d, d.hp - d.maxHp * 0.2, 'true');
  check('lowHp re-arms after recovering', C('t_low_hp') === 2);
  applyStatus(w, d, e1, 'slow', 1);
  check('statusApplied (on the applier)', C('t_status_applied') === 1);
  setLevel(w, d, 3);
  check('levelUp per level gained', C('t_level_up') === 2);
  const mv0 = C('t_move');
  issueMove(w, d, 10, 20, false);
  stepSec(w, 2);
  check('moveDistance every 2 m', C('t_move') - mv0 >= 3, C('t_move') - mv0);
  dealDamage(w, d, e1, 1e6, 'true');
  check('kill + takedown on a fighter kill', C('t_kill') === 1 && C('t_takedown') === 1);
  dealDamage(w, d, m, 1e6, 'true');
  check('kill on a minion, no takedown', C('t_kill') === 2 && C('t_takedown') === 1);
  killEntity(w, d, e2);
  check('death trigger fires on the dead owner', C('t_death') === 1 && !d.alive);
  respawnFighter(w, d, 5, 5);
  check('spawn fires on respawn', C('t_spawn') === 2 && d.alive && near(d.hp, d.maxHp));
});

finish('probe_sim_core_casting');
