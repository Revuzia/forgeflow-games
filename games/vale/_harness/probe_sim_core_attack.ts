// probe (lane SIM): basic attacks — timing (windup × period), AS cap, melee vs ranged projectile,
// crits, on-hit, attack orders/chasing, attack-move, idle auto-acquire + priority, vision gating.
import { buildCatalog, fighter, item, passive } from './fixtures/catalog_fixture.ts';
import { addUnit, check, fighterEnt, finish, makeWorld, near, ofType, section, stepN, stepSec } from './fixtures/sim_fixture.ts';
import { TICK_DT } from '../src/contracts/sim.ts';
import { equipItem } from '../src/sim/abilities.ts';
import { killEntity } from '../src/sim/combat.ts';
import { issueAttack, issueMove, issueStop } from '../src/sim/movement.ts';
import { counterValue } from '../src/sim/status.ts';

const cat = buildCatalog({
  fighters: [
    fighter('fx_fighter_a', {
      base: { ad: 50, attackSpeed: 1, moveSpeed: 3.5 }, attack: { range: 1.5, windup: 0.3 },
      passive: passive('fx_onhit', [{ on: 'attackHit', effects: [{ op: 'counter', counter: 'fx_hits', add: 1 }] }]),
    }),
    fighter('fx_fighter_b', { base: { ad: 40, attackSpeed: 0.8, moveSpeed: 3.5 }, attack: { range: 6, windup: 0.25, projectileSpeed: 15, present: { vfx: 'fx_bolt' } } }),
  ],
  items: [item('fx_item_as', { stats: { attackSpeed: 5 } }), item('fx_item_crit', { stats: { crit: 1 } })],
});

section('melee timing + AS cap + crit', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_fighter_a', team: 0, x: 10, y: 10 }, { fighter: 'fx_fighter_b', team: 1, x: 11.5, y: 10 }]);
  const a = fighterEnt(w, 0), b = fighterEnt(w, 1);
  b.autoAttack = false;
  issueAttack(w, a, b);
  const times: { e: string; t: number }[] = [];
  const amounts: number[] = [];
  for (let i = 0; i < 75; i++) for (const ev of w.step()) {
    if ((ev.e === 'attack' && ev.src === a.id) || (ev.e === 'damage' && ev.src === a.id)) times.push({ e: ev.e, t: ev.t });
    if (ev.e === 'damage' && ev.src === a.id) amounts.push(ev.amount);
  }
  const atk = times.filter((x) => x.e === 'attack').map((x) => x.t), dmg = times.filter((x) => x.e === 'damage').map((x) => x.t);
  check('melee: damage lands windup × period after the attack starts', atk.length >= 2 && near(dmg[0] - atk[0], 0.3, TICK_DT + 1e-9), { atk, dmg });
  check('period = 1 / attackSpeed', near(atk[1] - atk[0], 1, TICK_DT + 1e-9), atk);
  check('melee damage = ad; attackHit trigger per landed attack', amounts.length >= 2 && amounts.every((x) => near(x, 50)) && counterValue(a, 'fx_hits') === dmg.length);
  equipItem(w, a, 0, 'fx_item_as');
  stepN(w, 1);
  check('attack speed capped at 2.5', near(a.stats.attackSpeed, 2.5));
  equipItem(w, a, 1, 'fx_item_crit');
  const ev = stepSec(w, 1.2);
  const atks = ofType(ev, 'attack').filter((x) => x.src === a.id);
  const ds = ofType(ev, 'damage').filter((x) => x.src === a.id);
  check('crit flag on the attack event; crit damage = ad × 1.75', atks.length >= 2 && atks.every((x) => x.crit) && ds.every((d) => d.crit && near(d.amount, 50 * 1.75)), { atks: atks.length, ds });
  check('attack state + alternating clips', a.state === 'attack' && ['attack1', 'attack2', 'crit'].includes(a.anim));
  issueMove(w, a, 5, 10, false);
  stepN(w, 1);
  check('move order cancels the windup (orb-walk)', a.atkWindup < 0 && a.state === 'move');
});

section('ranged attacks', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_fighter_b', team: 0, x: 10, y: 10 }, { fighter: 'fx_fighter_a', team: 1, x: 16, y: 10 }]);
  const b = fighterEnt(w, 0), a = fighterEnt(w, 1);
  a.autoAttack = false;
  issueAttack(w, b, a);
  const ev = stepSec(w, 1.0);
  const p = ofType(ev, 'projectile').find((x) => x.src === b.id);
  const atk = ofType(ev, 'attack').find((x) => x.src === b.id)!;
  const d = ofType(ev, 'damage').find((x) => x.src === b.id);
  check('ranged: a homing projectile leaves at the windup (with the attack vfx)', p !== undefined && p.ability === 'attack' && p.vfx === 'fx_bolt');
  const flight = (6 - 0.5 - 0.15) / 15;
  check('ranged: damage after windup + flight time', d !== undefined && near(d.t - atk.t, 0.25 + flight, 2 * TICK_DT), d && d.t - atk.t);
  // attacker dies while its shot is in the air: the shot still lands
  issueStop(w, b);
  stepSec(w, 1.5);
  issueAttack(w, b, a);
  let landed = false;
  for (let i = 0; i < 60 && !landed; i++) {
    const evs = w.step();
    if (evs.some((x) => x.e === 'projectile' && x.src === b.id)) {
      killEntity(w, b, a);
      const rest = stepSec(w, 1);
      landed = rest.some((x) => x.e === 'damage' && x.src === b.id);
      break;
    }
  }
  check('a ranged shot in flight lands after its attacker dies', landed);
});

section('attack orders, chasing, vision', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_fighter_a', team: 0, x: 10, y: 20 }, { fighter: 'fx_fighter_b', team: 1, x: 16, y: 20 }]);
  const a = fighterEnt(w, 0), b = fighterEnt(w, 1);
  b.autoAttack = false;
  issueAttack(w, a, b);
  const ev = stepSec(w, 2.5);
  check('attack order chases a target out of range', ofType(ev, 'attack').some((x) => x.src === a.id) && Math.hypot(a.x - b.x, a.y - b.y) < 3);
  // target walks into a thicket (team 0 has nobody inside): the order is dropped
  b.x = 12; b.y = 44; a.x = 10; a.y = 36;
  w.vision.update(w.entities, w.tick);
  check('target in an unoccupied thicket is hidden', (b.visibleMask & 1) === 0);
  issueAttack(w, a, b);
  stepSec(w, 0.5);
  check('cannot attack what it cannot see', a.order === 0 && a.atkTarget === -1);
});

section('attack-move + idle acquisition', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_fighter_a', team: 0, x: 5, y: 20 }, { fighter: 'fx_fighter_b', team: 1, x: 50, y: 55 }]);
  const a = fighterEnt(w, 0);
  const m = addUnit(w, 'fx_minion', 1, 12, 20);
  issueMove(w, a, 20, 20, true);
  let ev = stepSec(w, 2.5);
  check('attack-move: stops to attack an enemy that comes into range', ofType(ev, 'attack').some((x) => x.src === a.id && x.dst === m.id) && a.x < 12);
  killEntity(w, m, a);
  ev = stepSec(w, 3);
  check('attack-move: continues to the destination afterwards', near(a.x, 20, 0.1) && a.order === 0, a.x);
  // idle auto-acquire with priority: minion before structure even if the structure is nearer
  const w2 = makeWorld(cat, [{ fighter: 'fx_fighter_a', team: 0, x: 10, y: 10 }, { fighter: 'fx_fighter_b', team: 1, x: 50, y: 55 }]);
  const a2 = fighterEnt(w2, 0);
  const tower = addUnit(w2, 'fx_tower', 1, 11.6, 10);
  tower.autoAttack = false;
  const mm = addUnit(w2, 'fx_dummy', 1, 10, 11.9);
  a2.autoAttack = true;
  ev = stepSec(w2, 0.5);
  check('idle: auto-acquires in range, units before structures', ofType(ev, 'attack').some((x) => x.src === a2.id && x.dst === mm.id) &&
    !ofType(ev, 'attack').some((x) => x.src === a2.id && x.dst === tower.id));
  w2.hooks.acquireScore = (_w, _e, c, d2) => (c.kind === 'structure' ? 0 : 1e9 + d2);
  a2.atkTarget = -1;
  ev = stepSec(w2, 2);
  check('hooks.acquireScore overrides the priority', ofType(ev, 'attack').some((x) => x.src === a2.id && x.dst === tower.id));
  w2.hooks.acquireScore = null;
  // nothing in range: idle stays idle (no chasing)
  const w3 = makeWorld(cat, [{ fighter: 'fx_fighter_a', team: 0, x: 10, y: 10 }, { fighter: 'fx_fighter_b', team: 1, x: 14, y: 10 }]);
  const a3 = fighterEnt(w3, 0);
  a3.autoAttack = true;
  stepSec(w3, 1);
  check('idle auto-acquire does not chase out of range', near(a3.x, 10) && a3.state === 'idle');
  // towers (structures) shoot on their own
  const t3 = addUnit(w3, 'fx_tower', 0, 18, 10);
  t3.autoAttack = true;
  ev = stepSec(w3, 2);
  check('structures auto-acquire and fire projectiles', ofType(ev, 'attack').some((x) => x.src === t3.id) && ofType(ev, 'projectile').some((x) => x.src === t3.id));
});

finish('probe_sim_core_attack');
