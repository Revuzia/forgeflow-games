// probe (lane SIM): the practice tool — setup switches (startLevel, noCooldowns, infiniteGold,
// dummies) and the practice command family (gold, level, resetCooldowns, toggleCooldowns,
// spawnDummy from the catalog's behavior.dummy unit, heal, resetMatch); ignored outside practice.
import { laneSetup, matchCatalog, run } from './fixtures/match_fixture.ts';
import { check, finish, near, ofType, section } from './fixtures/sim_fixture.ts';
import type { SimEvent } from '../src/contracts/sim.ts';
import { createSim, type Sim } from '../src/sim/sim.ts';
import { tryCast } from '../src/sim/abilities.ts';
import { dealDamage, killEntity } from '../src/sim/combat.ts';
import { dummyUnitId } from '../src/sim/modes/practice.ts';

const cat = matchCatalog();
const seats = [{ fighter: 'fx_brawler', team: 0, controller: 'human' as const }, { fighter: 'fx_brawler', team: 1 }];
type Action = 'gold' | 'level' | 'resetCooldowns' | 'toggleCooldowns' | 'spawnDummy' | 'heal' | 'resetMatch';
function act(sim: Sim, action: Action): SimEvent[] { sim.command(0, { type: 'practice', action }); return sim.step(); }
const dummies = (sim: Sim) => sim.world.entities.filter((e) => e.def === 'fx_training_dummy' && e.alive);

section('setup switches', () => {
  const sim = createSim(cat, laneSetup(seats, { queue: 'fx_lane_practice', practice: { startLevel: 3, noCooldowns: true, infiniteGold: true, dummies: 2 } }), { pregameSeconds: 0 });
  const w = sim.world, p = w.players[0], e = p.ent!;
  check('the catalog dummy is the first unit with behavior.dummy', dummyUnitId(w) === 'fx_training_dummy');
  check('startLevel 3 → level 3, 3 skill points', e.level === 3 && p.skillPoints === 3);
  check('setup.practice.dummies: 2 dummies on the enemy team, never attacking', dummies(sim).length === 2 && dummies(sim).every((d) => d.team === 1 && !d.autoAttack));
  sim.step();
  check('infiniteGold: gold kept at the floor', p.gold >= 50000);
  e.slots[0]!.rank = 1;
  tryCast(w, e, 0);
  check('noCooldowns: casting starts no cooldown', e.slots[0]!.cooldown === 0);
});

section('commands', () => {
  const sim = createSim(cat, laneSetup(seats, { queue: 'fx_lane_practice' }), { pregameSeconds: 0 });
  const w = sim.world, p = w.players[0], e = p.ent!;
  const g = p.gold;
  const ev = act(sim, 'gold');
  check('gold: +5000 (not earned) + practice announce', near(p.gold - g, 5000) && p.goldEarned === 0 && ofType(ev, 'announce').some((a) => a.key === 'practice'));
  act(sim, 'level');
  check('level: +1 level, +1 skill point', e.level === 2 && p.skillPoints === 2);
  e.slots[0]!.rank = 1;
  tryCast(w, e, 0);
  check('a normal cast starts its cooldown', e.slots[0]!.cooldown > 1);
  act(sim, 'resetCooldowns');
  check('resetCooldowns', e.slots[0]!.cooldown === 0 && e.slots.every((s) => !s || s.cooldown === 0));
  act(sim, 'toggleCooldowns');
  tryCast(w, e, 0);
  check('toggleCooldowns on: no cooldowns', w.noCooldowns && e.slots[0]!.cooldown === 0);
  act(sim, 'toggleCooldowns');
  run(sim, 0.2);
  tryCast(w, e, 0);
  check('toggleCooldowns off again', !w.noCooldowns && e.slots[0]!.cooldown > 1);
  e.facing = 0; e.x = 25; e.y = 35; e.autoAttack = false; w.hashDirty = true; // off the lane, out of tower range // open ground (the spot 4 m ahead of the spawn is inside the core)
  act(sim, 'spawnDummy');
  const d = dummies(sim)[0];
  check('spawnDummy: 4 m in front, enemy team', d && near(Math.hypot(d.x - e.x, d.y - e.y), 4, 0.6) && d.team === 1, d && [d.x, d.y, e.x, e.y]);
  dealDamage(w, e, d, 1000, 'true');
  run(sim, 3);
  check('the dummy stays hurt while being hit recently', d.hp < d.maxHp);
  run(sim, 1.2);
  check('…and recovers to full 4 s after the last hit', d.hp === d.maxHp);
  e.hp = 10; e.res = 0;
  act(sim, 'heal');
  check('heal: full hp + resource', e.hp === e.maxHp && e.res === e.maxRes);
  killEntity(w, e, null);
  act(sim, 'heal');
  check('heal on a dead fighter respawns it', e.alive && e.hp === e.maxHp);
  run(sim, 2);
  const tick = sim.view.tick;
  const ev2 = act(sim, 'resetMatch');
  check('resetMatch: a fresh world (tick 0) + practice_reset announce', sim.view.tick === 0 && tick > 60 && sim.world !== w &&
    ofType(ev2, 'announce').some((a) => a.key === 'practice_reset'));
  check('the reset world is the same setup, back at start', sim.world.players[0].ent!.level === 1 && sim.world.players[0].gold === 500);
});

section('ignored outside a practice queue', () => {
  const sim = createSim(cat, laneSetup(seats), { pregameSeconds: 0 });
  const p = sim.world.players[0];
  const g = p.gold;
  act(sim, 'gold'); act(sim, 'level'); act(sim, 'spawnDummy');
  check('no effect in a standard queue', p.gold === g && p.ent!.level === 1 && dummies(sim).length === 0);
  const s2 = createSim(cat, laneSetup(seats, { practice: { startLevel: 5, dummies: 3 } }), { pregameSeconds: 0 });
  check('setup.practice is ignored outside practice too', s2.world.players[0].ent!.level === 1 && dummies(s2).length === 0);
});

finish('probe_sim_practice');
