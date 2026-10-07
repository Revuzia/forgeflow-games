// probe (lane SIM): neutral camps — first spawn, passive until hit, whole-camp aggro, leash →
// reset (walk home invulnerable, full hp, statuses cleared), last-unit respawn timer, objective
// takedown → team buff (fighter stats, minionStats on minions, expiry), 'objective' + announce,
// objective gold, WorldView.objectives timers.
import { laneSetup, matchCatalog, run } from './fixtures/match_fixture.ts';
import { check, finish, near, ofType, section } from './fixtures/sim_fixture.ts';
import { createSim } from '../src/sim/sim.ts';
import { dealDamage } from '../src/sim/combat.ts';
import type { Entity } from '../src/sim/entity.ts';
import { ORDER_ATTACK } from '../src/sim/entity.ts';
import { applyStatus } from '../src/sim/status.ts';
import { monsterState } from '../src/sim/units/monsters.ts';
import type { World } from '../src/sim/world.ts';

const cat = matchCatalog({ rules: { passiveGoldPerSec: 0 } });
const seats = [{ fighter: 'fx_juggernaut', team: 0 }, { fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 1 }];
const mk = () => createSim(cat, laneSetup(seats), { pregameSeconds: 0 });
const monsters = (w: World, def?: string): Entity[] => w.entities.filter((e) => e.kind === 'monster' && e.alive && (!def || e.def === def));
const park = (e: Entity, x: number, y: number, w: World): void => { e.x = x; e.y = y; e.path.length = 0; e.pathGoalX = NaN; w.hashDirty = true; };

section('spawn timing + objective timer view', () => {
  const sim = mk();
  const w = sim.world;
  check('one objective timer (the objective camp only)', w.objectives.length === 1 && w.objectives[0].id === 'fx_camp_boss' && w.objectives[0].unit === 'fx_boss');
  run(sim, 5);
  check('timer counts down to first spawn (≈ 10 s left at 5 s)', !w.objectives[0].alive && near(w.objectives[0].respawnIn, 10, 0.1), w.objectives[0]);
  check('no monsters before firstSpawn', monsters(w).length === 0);
  run(sim, 5.1);
  const b = monsters(w, 'fx_beast');
  check('beast camp (2 units) at 10 s, neutral team, at their spots', b.length === 2 && b.every((m) => m.team === -1) && near(b[0].x, 60, 0.6), b.map((m) => [m.x, m.y, m.team]));
  run(sim, 5);
  check('boss at 15 s; timer alive', monsters(w, 'fx_boss').length === 1 && w.objectives[0].alive && w.objectives[0].respawnIn === 0);
});

section('passive until hit, camp aggro, leash reset', () => {
  const sim = mk();
  const w = sim.world;
  const f = w.players[1].ent!;
  f.autoAttack = false;
  run(sim, 10.2);
  park(f, 60, 9, w);
  const ev = run(sim, 2);
  check('monsters ignore a fighter walking by', !ofType(ev, 'damage').some((d) => d.dst === f.id));
  const [m1, m2] = monsters(w, 'fx_beast');
  dealDamage(w, f, m1, 50, 'true');
  run(sim, 0.2);
  check('the whole camp aggroes on the attacker', monsterState(m1)!.target === f.id && monsterState(m2)!.target === f.id &&
    m1.order === ORDER_ATTACK && m2.order === ORDER_ATTACK);
  const ev2 = run(sim, 2);
  check('they fight back', ofType(ev2, 'damage').some((d) => d.dst === f.id && (d.src === m1.id || d.src === m2.id)));
  park(f, 60, 12.5, w); // drag them ~5 m out
  run(sim, 2);
  applyStatus(w, f, m1, 'slow', 30);
  park(f, 60, 30, w); // 24 m from home: beyond leash 7
  run(sim, 0.1);
  check('leash: they reset (invulnerable, heading home)', monsterState(m1)!.resetting && m1.invulnerable, [monsterState(m1)!.resetting, m1.invulnerable]);
  check('no damage while resetting', dealDamage(w, f, m1, 50, 'true') === 0);
  run(sim, 6);
  check('back home at full hp, statuses cleared, vulnerable again', !monsterState(m1)!.resetting && m1.hp === m1.maxHp && m1.statuses.length === 0 &&
    !m1.invulnerable && Math.hypot(m1.x - monsterState(m1)!.homeX, m1.y - monsterState(m1)!.homeY) < 0.6, [m1.hp, m1.maxHp, m1.statuses.length]);
});

section('kill: cs gold, respawn after the LAST unit', () => {
  const sim = mk();
  const w = sim.world;
  const f = w.players[1].ent!;
  run(sim, 10.2);
  const [m1, m2] = monsters(w, 'fx_beast');
  const g0 = w.players[1].gold, cs0 = w.players[1].cs;
  const n0 = w.events.length;
  dealDamage(w, f, m1, 1e6, 'true');
  const gold = ofType(w.events.slice(n0), 'gold');
  check("beast kill: 60 gold reason 'cs', cs + 1", near(w.players[1].gold - g0, 60) && gold[0]?.reason === 'cs' && w.players[1].cs === cs0 + 1, gold);
  run(sim, 5);
  check('camp not respawning while one unit lives', monsters(w, 'fx_beast').length === 1);
  dealDamage(w, f, m2, 1e6, 'true');
  run(sim, 29.5);
  check('no respawn before 30 s', monsters(w, 'fx_beast').length === 0);
  run(sim, 1);
  check('camp back 30 s after its last unit died', monsters(w, 'fx_beast').length === 2);
});

section('objective: team buff, minion empowerment, gold, events, expiry', () => {
  const sim = mk();
  const w = sim.world;
  const f = w.players[1].ent!, mate = w.players[0].ent!;
  run(sim, 15.2);
  const boss = monsters(w, 'fx_boss')[0];
  const adAt = (lvl: number): number => 60 + 4 * (lvl - 1); // fx_brawler base ad + growth
  const minion = w.entities.find((e) => e.kind === 'minion' && e.alive && e.team === 0 && e.def === 'fx_lane_minion')!;
  const mAd0 = minion.stats.ad, mHp0 = minion.maxHp;
  const g = w.players.map((p) => p.gold);
  const n0 = w.events.length;
  dealDamage(w, f, boss, 1e6, 'true');
  const ev = w.events.slice(n0);
  const ob = ofType(ev, 'objective')[0];
  check("'objective' event: unit, team, buff", ob && ob.unit === 'fx_boss' && ob.team === 0 && ob.buff === 'fx_boss_buff', ob);
  check('announce objective_taken', ofType(ev, 'announce').some((a) => a.key === 'objective_taken' && a.team === 0));
  check('TeamView.objectives + buffs', w.teams[0].objectives.includes('fx_boss_buff') && w.teams[0].buffs.some((b) => b.id === 'fx_boss_buff' && near(b.remaining, 90)));
  check("killer 100 + goldGlobal 100, teammate 100, enemy 0 (reason 'objective')",
    near(w.players[1].gold - g[1], 200) && near(w.players[0].gold - g[0], 100) && near(w.players[2].gold - g[2], 0) &&
    ofType(ev, 'gold').every((x) => x.reason === 'objective'), w.players.map((p, i) => p.gold - g[i]));
  run(sim, 0.1);
  check('team fighters gain the buff stats (+15 ad)', near(f.stats.ad, adAt(f.level) + 15) && mate.stats.ad > 0, [f.stats.ad, f.level]);
  check('team minions gain minionStats (+10 ad, +100 hp)', near(minion.stats.ad - mAd0, 10) && near(minion.maxHp - mHp0, 100), [minion.stats.ad - mAd0, minion.maxHp - mHp0]);
  const enemyMinion = w.entities.find((e) => e.kind === 'minion' && e.alive && e.team === 1 && e.def === 'fx_lane_minion')!;
  check('enemy minions are not empowered', near(enemyMinion.stats.ad, 14 + 2 * (enemyMinion.level - 1)), enemyMinion.stats.ad);
  check('objective timer: dead, respawn in ≈ 60 s', !w.objectives[0].alive && near(w.objectives[0].respawnIn, 59.9, 0.2), w.objectives[0]);
  run(sim, 90);
  check('buff expires after 90 s: stats back', w.teams[0].buffs.length === 0 && near(f.stats.ad, adAt(f.level), 1e-6), [w.teams[0].buffs.length, f.stats.ad, f.level]);
});

finish('probe_sim_camps');
