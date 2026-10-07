// probe (lane SIM): minion waves — schedule, composition (everyNth / from), upgrades, both teams
// walk the lane (team 1 reversed), they meet and fight, rejoin the lane ahead after being pulled
// off it, call-for-help priority, ignore monsters, push into structures but not protected ones.
import { laneSetup, matchCatalog, run, runUntil } from './fixtures/match_fixture.ts';
import { check, finish, near, ofType, section } from './fixtures/sim_fixture.ts';
import { createSim } from '../src/sim/sim.ts';
import { dealDamage } from '../src/sim/combat.ts';
import type { Entity } from '../src/sim/entity.ts';
import { ORDER_ATTACK } from '../src/sim/entity.ts';
import { minionState } from '../src/sim/units/minions.ts';
import { spawnUnit } from '../src/sim/spawn.ts';

const cat = matchCatalog();
const seats = [{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 1 }];
const mk = (seed = 1) => createSim(cat, laneSetup(seats, { seed }), { pregameSeconds: 0 });
const minions = (sim: ReturnType<typeof mk>, team?: number): Entity[] =>
  sim.world.entities.filter((e) => e.kind === 'minion' && e.alive && (team === undefined || e.team === team));

section('schedule + composition + levels', () => {
  const sim = mk();
  const ev = run(sim, 4.9);
  check('no wave before `first` (5 s)', ofType(ev, 'wave').length === 0 && minions(sim).length === 0);
  const ev1 = run(sim, 0.2);
  const w1 = ofType(ev1, 'wave');
  check('wave 1 at 5 s', w1.length === 1 && w1[0].n === 1 && near(w1[0].t, 5, 0.05), w1);
  check('wave 1: 2 melee + 2 ranged per team (no siege: everyNth 3)', minions(sim, 0).length === 4 && minions(sim, 1).length === 4,
    [minions(sim, 0).map((m) => m.def), minions(sim, 1).length]);
  const t0 = minions(sim, 0), t1 = minions(sim, 1);
  check('team 0 spawns at the lane start, team 1 at the lane end', t0.every((m) => m.x < 20) && t1.every((m) => m.x > 100),
    [t0.map((m) => m.x.toFixed(1)), t1.map((m) => m.x.toFixed(1))]);
  const s0 = minionState(t0[0])!, s1 = minionState(t1[0])!;
  check('team 1 walks the path reversed', s0.path[0][0] === 15 && s1.path[0][0] === 105 && s1.path[s1.path.length - 1][0] === 15);
  check('wave units are level 1 before the first upgrade', t0.every((m) => m.level === 1));
  const all: string[] = [];
  const evs = run(sim, 60.5); // through wave 4 (65 s)
  const waves = ofType(evs, 'wave');
  check('waves every 20 s', waves.map((x) => x.n).join() === '2,3,4' && near(waves[2].t, 65, 0.05), waves.map((x) => [x.n, x.t]));
  for (const m of sim.world.entities) if (m.kind === 'minion' && m.spawnTime > 44 && m.spawnTime < 46 && m.team === 0) all.push(m.def);
  check('wave 3 adds the everyNth: 3 siege minion', all.filter((d) => d === 'fx_siege_minion').length === 1 && all.length === 5, all);
  const w4 = sim.world.entities.filter((m) => m.kind === 'minion' && m.spawnTime > 64 && m.team === 0);
  check('upgradeEvery 60: wave 4 (65 s) is level 2 with growth applied', w4.length === 4 && w4.every((m) => m.level === 2) &&
    w4.filter((m) => m.def === 'fx_lane_minion').every((m) => near(m.maxHp, 320)), w4.map((m) => [m.def, m.level, m.maxHp]));
  run(sim, 60); // to 125: wave 7 has the `from: 120` siege
  const w7 = sim.world.entities.filter((m) => m.kind === 'minion' && m.spawnTime > 124 && m.team === 1);
  check('`from` 120: wave 7 (125 s) adds a siege minion', w7.filter((m) => m.def === 'fx_siege_minion').length === 1 && w7.length === 5, w7.map((m) => m.def));
});

section('lanes: walk, meet mid, fight', () => {
  const sim = mk(3);
  const ev = run(sim, 25);
  const dmg = ofType(ev, 'damage').filter((d) => {
    const a = sim.world.entity(d.src), b = sim.world.entity(d.dst);
    return a && b && a.kind === 'minion' && b.kind === 'minion';
  });
  check('minions of both teams damage each other', dmg.length > 10, dmg.length);
  const xs = dmg.map((d) => sim.world.entity(d.dst)!.x);
  const mid = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  check('they meet near mid-lane (x ≈ 60)', mid > 45 && mid < 75, mid.toFixed(1));
  check('minions die in the fight (death events)', ofType(ev, 'death').some((d) => d.kind === 'minion'));
  check('minions stay near the lane (|y − 20| < 7)', minions(sim).every((m) => Math.abs(m.y - 20) < 7), minions(sim).map((m) => m.y.toFixed(1)));
});

section('rejoin the lane ahead after being pulled off', () => {
  const sim = mk(5);
  run(sim, 5.2);
  const m = minions(sim, 0)[0];
  const st = minionState(m)!;
  const wp0 = st.wp;
  m.x = 45; m.y = 30; sim.world.hashDirty = true; // pulled to the north, past the first waypoint's segment
  run(sim, 0.5);
  check('its waypoint never goes backwards after the pull', st.wp >= wp0 && st.path[st.wp][0] >= 45, [wp0, st.wp]);
  run(sim, 6);
  check('it walks back to the lane, heading east', Math.abs(m.y - 20) < 5 && m.x > 45, [m.x.toFixed(1), m.y.toFixed(1)]);
});

section('priority: call for help, monsters ignored, structures', () => {
  const sim = mk(7);
  const w = sim.world;
  run(sim, 5.2);
  const ally = w.players[0].ent!, enemy = w.players[1].ent!;
  const m = minions(sim, 0)[0];
  // freeze the scene: everyone else far away
  for (const o of minions(sim)) if (o !== m) { o.x = 30; o.y = 3 + (o.id % 5); }
  m.x = 50; m.y = 20; ally.x = 52; ally.y = 21; enemy.x = 54; enemy.y = 22;
  const bait = spawnUnit(w, 'fx_lane_minion', 1, 51, 18); // an enemy minion right next to it
  w.hashDirty = true;
  run(sim, 0.4);
  check('without a call for help it fights the nearer enemy minion', m.order === ORDER_ATTACK && m.orderTarget === bait.id, [m.order, m.orderTarget, bait.id]);
  dealDamage(w, enemy, ally, 10, 'true');
  run(sim, 0.3);
  check('an enemy fighter hurting an allied fighter pulls the minion (fighterAttacker)', m.orderTarget === enemy.id, [m.orderTarget, enemy.id]);
  // monsters: not in the default priority list
  const beast = spawnUnit(w, 'fx_beast', -1, 50, 23);
  beast.autoAttack = false;
  bait.x = 5; bait.y = 5; enemy.x = 100; enemy.y = 3; w.hashDirty = true;
  run(sim, 2.5);
  check('minions never pick monsters', m.orderTarget !== beast.id && beast.hp === beast.maxHp, [m.orderTarget, beast.hp]);
});

section('push into structures; protected ones are walked past', () => {
  const sim = mk(9);
  const w = sim.world;
  const tower = w.entities.find((e) => e.kind === 'structure' && e.team === 1 && e.def === 'fx_lane_tower')!;
  const gate = w.entities.find((e) => e.kind === 'structure' && e.team === 1 && e.def === 'fx_gate')!;
  check('gate is protected (untargetable) while the tower stands', !gate.targetable && gate.invulnerable);
  // only team 0 waves: remove team 1 minions as they spawn
  const ev = runUntil(sim, () => {
    for (const o of minions(sim, 1)) { o.alive = false; w.remove(o); }
    return tower.hp < tower.maxHp;
  }, 90);
  check('team 0 minions walk down the lane and hit the enemy tower', tower.hp < tower.maxHp, tower.hp);
  check('towers shoot the minions', ofType(ev, 'damage').some((d) => d.src === tower.id), 0);
  check('nobody damaged the protected gate', !ofType(ev, 'damage').some((d) => d.dst === gate.id));
});

finish('probe_sim_waves');
