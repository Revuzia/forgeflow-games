// probe (lane SIM): structures — spawn from the map, protection chain via `requires`, tower target
// priority (minions first, call-for-help switch to the fighter hurting an ally in range), damage
// ramp on consecutive hits, structure events (final on the core), team-wide gold, destroyed
// counts, gate respawn re-protecting what it guards, sudden death lifting protection.
import { laneSetup, matchCatalog, run } from './fixtures/match_fixture.ts';
import { check, finish, near, ofType, section } from './fixtures/sim_fixture.ts';
import { createSim } from '../src/sim/sim.ts';
import { dealDamage } from '../src/sim/combat.ts';
import type { Entity } from '../src/sim/entity.ts';
import { ORDER_ATTACK } from '../src/sim/entity.ts';
import { spawnUnit } from '../src/sim/spawn.ts';
import { structuresOf } from '../src/sim/units/structures.ts';
import type { World } from '../src/sim/world.ts';

// no waves, no camps: structures alone
const cat = matchCatalog({ rules: { minionWaves: undefined, jungle: false, passiveGoldPerSec: 0 } });
const seats = [{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 1 }];
const mk = () => createSim(cat, laneSetup(seats), { pregameSeconds: 0 });
const byMap = (w: World, id: string): Entity => structuresOf(w).find((s) => s.def.id === id)!.ent;
const park = (e: Entity, x: number, y: number, w: World): void => { e.x = x; e.y = y; w.hashDirty = true; };

section('spawn + protection chain', () => {
  const sim = mk();
  const w = sim.world;
  check('six structures from the map', structuresOf(w).length === 6 && w.entities.filter((e) => e.kind === 'structure').length === 6);
  const tower = byMap(w, 'fx_t1_tower'), gate = byMap(w, 'fx_t1_gate'), core = byMap(w, 'fx_t1_core');
  check('outer tower is open', tower.targetable && !tower.invulnerable);
  check('gate + core are protected (untargetable, invulnerable)', !gate.targetable && gate.invulnerable && !core.targetable && core.invulnerable);
  const a = w.players[0].ent!;
  check('damage on a protected structure is ignored', dealDamage(w, a, gate, 500, 'true') === 0 && gate.hp === gate.maxHp);
  run(sim, 0.1);
  dealDamage(w, a, tower, 1e6, 'true');
  check('gate opens when the tower falls; core still protected', gate.targetable && !gate.invulnerable && !core.targetable);
});

section('falling: events, team gold, counts, final flag', () => {
  const sim = mk();
  const w = sim.world;
  const a = w.players[0].ent!, b = w.players[1].ent!;
  const g0 = w.players.map((p) => p.gold);
  const tower = byMap(w, 'fx_t1_tower');
  dealDamage(w, b, tower, 10, 'true'); // assist-free: structures don't track assists
  const evs: ReturnType<typeof w.step> = [];
  const n0 = w.events.length;
  dealDamage(w, a, tower, 1e6, 'true');
  for (const e of w.events.slice(n0)) evs.push(e);
  const st = ofType(evs, 'structure')[0];
  check("'structure' event: def, team, destroyedBy, not final", st && st.def === 'fx_lane_tower' && st.team === 1 && st.destroyedBy === 0 && !st.final, st);
  check('announce structure_destroyed', ofType(evs, 'announce').some((x) => x.key === 'structure_destroyed'));
  check('team 0 structuresDestroyed = 1', w.teams[0].structuresDestroyed === 1 && w.teams[1].structuresDestroyed === 0);
  check('killer: bounty.gold 150 + goldGlobal 50; teammate: goldGlobal 50; enemy: 0',
    near(w.players[0].gold - g0[0], 200) && near(w.players[1].gold - g0[1], 50) && near(w.players[2].gold - g0[2], 0),
    w.players.map((p, i) => p.gold - g0[i]));
  const gold = ofType(evs, 'gold');
  check("gold reasons are 'structure'", gold.length === 3 && gold.every((g) => g.reason === 'structure'), gold.map((g) => [g.player, g.amount, g.reason]));
  check('structureDamage tracked for the killer', w.players[0].structureDamage > 2000);
  const gate = byMap(w, 'fx_t1_gate'), core = byMap(w, 'fx_t1_core');
  dealDamage(w, a, gate, 1e6, 'true');
  check('core opens when the gate falls', core.targetable);
  const n1 = w.events.length;
  dealDamage(w, a, core, 1e6, 'true');
  const fin = ofType(w.events.slice(n1), 'structure')[0];
  check("the core's structure event is final", fin && fin.final && fin.def === 'fx_core', fin);
});

section('tower targeting: minions first, call for help, ramp', () => {
  const sim = mk();
  const w = sim.world;
  const tower = byMap(w, 'fx_t1_tower');
  const a = w.players[0].ent!, ally = w.players[2].ent!;
  // a team 0 minion and the team 0 fighter in range
  const m = spawnUnit(w, 'fx_lane_minion', 0, 77, 20);
  m.autoAttack = false; m.attackDef = null;
  park(a, 79, 23, w);
  park(ally, 88, 20, w);
  run(sim, 0.2);
  check('prefers the minion over the fighter', tower.order === ORDER_ATTACK && tower.orderTarget === m.id, [tower.orderTarget, m.id, a.id]);
  dealDamage(w, a, ally, 5, 'true'); // the fighter hurts an allied (team 1) fighter standing near the tower
  run(sim, 0.1);
  check('switches to the fighter that hurt an ally in range', tower.orderTarget === a.id, [tower.orderTarget, a.id]);
  // ramp: consecutive tower hits on the same fighter grow 40 % per hit (capped at +120 %)
  m.alive = false; w.remove(m);
  a.hp = a.maxHp = 1e6;
  const ev = run(sim, 7);
  const hits = ofType(ev, 'damage').filter((d) => d.src === tower.id && d.dst === a.id).map((d) => d.amount);
  const r = hits.map((h) => h / hits[0]);
  check('≥ 5 consecutive tower hits on the fighter', hits.length >= 5, hits.length);
  check('ramp: ×1, ×1.4, ×1.8, ×2.2, ×2.2 (cap)', near(r[1], 1.4, 1e-6) && near(r[2], 1.8, 1e-6) && near(r[3], 2.2, 1e-6) && near(r[4], 2.2, 1e-6),
    r.map((x) => x.toFixed(3)));
  // leaving range resets the target; a different unit resets the ramp
  park(a, 30, 5, w);
  run(sim, 0.2);
  check('target out of range: the tower drops it', tower.orderTarget !== a.id || tower.order !== ORDER_ATTACK, [tower.order, tower.orderTarget]);
  run(sim, 3.2);
  park(a, 79, 23, w);
  const ev2 = run(sim, 2.6);
  const h2 = ofType(ev2, 'damage').filter((d) => d.src === tower.id && d.dst === a.id).map((d) => d.amount);
  check('coming back after > rampReset s starts the ramp over', h2.length > 0 && near(h2[0], hits[0], 1e-6), [h2[0], hits[0]]);
});

section('towers ignore protected/invisible things and shoot nothing without a target', () => {
  const sim = mk();
  const w = sim.world;
  const tower = byMap(w, 'fx_t1_tower');
  run(sim, 1);
  check('idle tower without enemies in range', tower.order !== ORDER_ATTACK && tower.atkTarget < 0);
  const core = byMap(w, 'fx_t1_core');
  check("a core with targetRules 'none' never attacks", core.attackDef === null || core.order !== ORDER_ATTACK);
});

section('gate respawn re-protects; sudden death lifts protection', () => {
  const sim = createSim(matchCatalog({ rules: { minionWaves: undefined, jungle: false, suddenDeathAt: 60 } }), laneSetup(seats), { pregameSeconds: 0 });
  const w = sim.world;
  const a = w.players[0].ent!;
  const tower = byMap(w, 'fx_t1_tower'), gate = byMap(w, 'fx_t1_gate'), core = byMap(w, 'fx_t1_core');
  dealDamage(w, a, tower, 1e6, 'true');
  dealDamage(w, a, gate, 1e6, 'true');
  check('core open after tower + gate', core.targetable);
  const ev = run(sim, 40.2);
  const gate2 = byMap(w, 'fx_t1_gate');
  check('gate respawns after 40 s as a new entity', gate2 !== gate && gate2.alive && gate2.hp === gate2.maxHp && !w.entity(gate.id),
    [gate2.id, gate.id, gate2.alive]);
  check('announce structure_respawned', ofType(ev, 'announce').some((x) => x.key === 'structure_respawned'));
  check('the respawned gate stays open (its tower is down) and re-protects the core', gate2.targetable && !core.targetable);
  const ev2 = run(sim, 20);
  check('sudden death at 60 s: event + flag', w.suddenDeath && ofType(ev2, 'suddenDeath').length === 1);
  check('sudden death: no structure is protected', structuresOf(w).every((s) => !s.ent.alive || s.ent.targetable));
});

finish('probe_sim_structures');
