// probe (lane SIM): seat fighters — spawn ring, resource models (pool / build with gains + decay /
// heat with overheat lock / none), skill points + rank caps + levelUp commands, respawn timers
// (base + perLevel, max, late-game ramp, sudden death), recall (channel, done at the fountain,
// cancelled by damage / move / cast, refused without a base), fountain restoration.
import { fraySetup, laneSetup, matchCatalog, run } from './fixtures/match_fixture.ts';
import { check, finish, near, ofType, section } from './fixtures/sim_fixture.ts';
import type { Command, SimEvent } from '../src/contracts/sim.ts';
import { createSim, type Sim } from '../src/sim/sim.ts';
import { dealDamage, killEntity } from '../src/sim/combat.ts';
import { tryCast } from '../src/sim/abilities.ts';
import { spawnUnit } from '../src/sim/spawn.ts';
import { grantXp, respawnTime, setSeatLevel } from '../src/sim/units/fighters.ts';
import { issueAttack, issueStop } from '../src/sim/movement.ts';

const quiet = { minionWaves: undefined, jungle: false, structures: false, passiveGoldPerSec: 0 };
function mk(seats: { fighter: string; team: number }[], rules: Record<string, unknown> = {}): Sim {
  return createSim(matchCatalog({ rules: { ...quiet, ...rules } }), laneSetup(seats), { pregameSeconds: 0 });
}
function cmd(sim: Sim, c: Command, p = 0): SimEvent[] { sim.command(p, c); return sim.step(); }
const duo = [{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 1 }];

section('spawn ring + level 1 kit', () => {
  const sim = mk([{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 1 }]);
  const w = sim.world;
  const pos = w.players.slice(0, 3).map((p) => [p.ent!.x, p.ent!.y]);
  const apart = pos.every((a, i) => pos.every((b, j) => i === j || Math.hypot(a[0] - b[0], a[1] - b[1]) > 1));
  check('teammates start on a ring around the base spawn (not stacked)', apart && pos.every((a) => Math.hypot(a[0] - 5, a[1] - 20) < 2), pos);
  const p = w.players[0];
  check('level 1, one skill point, xpToNext from the table, full hp + mana', p.ent!.level === 1 && p.skillPoints === 1 && p.xpToNext === 100 &&
    p.ent!.hp === p.ent!.maxHp && p.ent!.res === p.ent!.maxRes && p.ent!.maxRes === 300);
});

section('ranks: skill points, caps, levelUp commands', () => {
  const sim = mk(duo);
  const w = sim.world, p = w.players[0], e = p.ent!;
  cmd(sim, { type: 'levelUp', slot: 'a1' });
  check('levelUp a1 at level 1', e.slots[0]!.rank === 1 && p.skillPoints === 0);
  setSeatLevel(w, p, 2);
  cmd(sim, { type: 'levelUp', slot: 'a1' });
  check('basic rank capped at ceil(level / 2): a1 stays 1 at level 2', e.slots[0]!.rank === 1 && p.skillPoints === 1);
  cmd(sim, { type: 'levelUp', slot: 'ult' });
  check('ult needs level ≥ ultLevels[0] (4)', e.slots[3]!.rank === 0);
  setSeatLevel(w, p, 4);
  cmd(sim, { type: 'levelUp', slot: 'ult' });
  cmd(sim, { type: 'levelUp', slot: 'a1' });
  check('at level 4: ult rank 1, a1 rank 2', e.slots[3]!.rank === 1 && e.slots[0]!.rank === 2, [e.slots[3]!.rank, e.slots[0]!.rank]);
  setSeatLevel(w, p, 12);
  for (let i = 0; i < 6; i++) cmd(sim, { type: 'levelUp', slot: 'a1' });
  check('basicMax 3 caps a1 even at level 12', e.slots[0]!.rank === 3);
  check('AbilityView.canLevel reflects caps', !e.slots[0]!.canLevel && e.slots[1]!.canLevel);
  grantXp(w, p, 1e6);
  check('max level: xp and xpToNext stay 0', e.level === 12 && p.xp === 0 && p.xpToNext === 0);
});

section('resource models', () => {
  const sim = mk([{ fighter: 'fx_fury_user', team: 0 }, { fighter: 'fx_heat_user', team: 1 }, { fighter: 'fx_none_user', team: 1 }, { fighter: 'fx_brawler', team: 0 }]);
  const w = sim.world;
  const fury = w.players[0].ent!, heat = w.players[1].ent!, none = w.players[2].ent!, pool = w.players[3].ent!;
  check('build starts empty (startFull false); heat starts at 0; none has no pool', fury.res === 0 && heat.res === 0 && none.maxRes === 0);
  // pool regen
  pool.res = 100; pool.x = 40; pool.y = 20; w.hashDirty = true; // out of the fountain
  run(sim, 1);
  check('pool regenerates (2/s)', near(pool.res, 102, 0.05), pool.res);
  // build: gain on attack + on hit taken, then decay after the delay
  fury.x = 50; fury.y = 20; heat.x = 51.5; heat.y = 20; w.hashDirty = true;
  heat.autoAttack = false; none.autoAttack = false; pool.autoAttack = false;
  issueAttack(w, fury, heat);
  run(sim, 1.2);
  check('build: +10 per landed attack', fury.res >= 10, fury.res);
  fury.autoAttack = false;
  issueStop(w, fury);
  const r0 = fury.res;
  dealDamage(w, heat, fury, 1, 'true');
  check('build: +5 when hit', near(fury.res, Math.min(100, r0 + 5)), [r0, fury.res]);
  const r1 = fury.res;
  run(sim, 1.8);
  check('build: no decay before decayDelay (2 s)', near(fury.res, r1, 1e-6));
  run(sim, 1);
  check('build: then decays 10/s', fury.res < r1 - 5, [r1, fury.res]);
  // heat: costs add heat; reaching max locks for overheatLock, then vents to 0
  heat.slots[0]!.rank = 1;
  tryCast(w, heat, 0); tryCast(w, heat, 0);
  check('heat: two casts → 80 heat', near(heat.res, 80));
  tryCast(w, heat, 0);
  check('heat: the third reaches max → overheated', heat.res === heat.maxRes && heat.overheat > 0);
  check('overheated: casting refused', tryCast(w, heat, 0) === 'cost');
  run(sim, 2.1);
  check('after overheatLock (2 s) it vents to 0 and casts again', heat.res === 0 && heat.overheat === 0 && tryCast(w, heat, 0) === 'ok');
  // none: costs are free
  none.slots[0]!.rank = 1;
  check("'none': a 40-cost ability casts with no resource", tryCast(w, none, 0) === 'ok' && none.res === 0);
});

section('respawn timers', () => {
  const sim = mk(duo);
  const w = sim.world, p = w.players[1], e = p.ent!;
  e.x = 60; w.hashDirty = true;
  killEntity(w, e, w.players[0].ent!);
  check('level 1: base 4 s', near(p.respawnIn, 4), p.respawnIn);
  const ev = run(sim, 3.9);
  check('still dead before the timer; respawnIn counts down', !e.alive && p.respawnIn > 0 && p.respawnIn < 0.2, p.respawnIn);
  const ev2 = run(sim, 0.2).concat(ev);
  const r = ofType(ev2, 'respawn')[0];
  check('respawn event; back at the base spawn with full hp + mana', e.alive && r && r.player === 1 && r.entity === e.id &&
    Math.hypot(e.x - 115, e.y - 20) < 2.5 && e.hp === e.maxHp && e.res === e.maxRes, [e.x, e.y]);
  setSeatLevel(w, p, 6);
  check('base + perLevel × (level − 1): level 6 → 9 s', near(respawnTime(w, e), 9));
  const s2 = mk(duo, { respawn: { base: 4, perLevel: 3, max: 20, lateGameRampAt: 30, lateGameMult: 1.5 } });
  const p2 = s2.world.players[1];
  setSeatLevel(s2.world, p2, 12);
  check('capped at max (20)', near(respawnTime(s2.world, p2.ent!), 20));
  run(s2, 30.1);
  check('after lateGameRampAt: × lateGameMult (30)', near(respawnTime(s2.world, p2.ent!), 30));
  s2.world.suddenDeath = true;
  check('sudden death: × 1.5 more (45)', near(respawnTime(s2.world, p2.ent!), 45));
});

section('recall', () => {
  const sim = mk(duo);
  const w = sim.world, p = w.players[0], e = p.ent!;
  e.x = 60; e.y = 20; e.hp = 100; w.hashDirty = true;
  const ev = cmd(sim, { type: 'recall' });
  check('recall start event, state + anim recall', ofType(ev, 'recall').some((r) => r.state === 'start') && e.state === 'recall' && e.anim === 'recall');
  run(sim, 2);
  check('progress ≈ 0.5 at 2 of 4 s', near(p.recallProgress, 0.5, 0.03), p.recallProgress);
  const ev2 = run(sim, 2.1);
  check('done: event, on the fountain, state cleared', ofType(ev2, 'recall').some((r) => r.state === 'done') && Math.hypot(e.x - 3, e.y - 20) < 0.6 &&
    e.state !== 'recall' && p.recallProgress === 0, [e.x, e.y, e.state]);
  // cancels
  e.x = 60; w.hashDirty = true;
  cmd(sim, { type: 'recall' });
  run(sim, 1);
  const ev3: SimEvent[] = [];
  const n0 = w.events.length;
  dealDamage(w, w.players[1].ent!, e, 1, 'true');
  for (const x of w.events.slice(n0)) ev3.push(x);
  check('damage cancels it (cancel event)', ofType(ev3, 'recall').some((r) => r.state === 'cancel') && p.recallProgress === 0);
  cmd(sim, { type: 'recall' });
  run(sim, 0.5);
  const ev4 = cmd(sim, { type: 'move', x: 70, y: 20 }).concat(sim.step());
  check('a move order cancels it', ofType(ev4, 'recall').some((r) => r.state === 'cancel'));
  run(sim, 0.5);
  cmd(sim, { type: 'recall' });
  e.slots[0]!.rank = 1;
  const ev5 = cmd(sim, { type: 'cast', slot: 'a1' }).concat(sim.step());
  check('a cast cancels it', ofType(ev5, 'recall').some((r) => r.state === 'cancel'));
  check('auto-attack restored after a cancelled recall', e.autoAttack);
  const ff = createSim(matchCatalog(), fraySetup(3), { pregameSeconds: 0 });
  const ev6 = cmd(ff, { type: 'recall' });
  check('no recall without a base (FFA map) or with rules.recall false', ofType(ev6, 'recall').length === 0);
});

section('fountain', () => {
  const sim = mk(duo);
  const w = sim.world, e = w.players[0].ent!;
  e.x = 3; e.y = 20; e.hp = 100; e.res = 0; w.hashDirty = true;
  run(sim, 1);
  check('fountain: +15 % max hp per second', near(e.hp, 100 + e.maxHp * 0.15 + 1, 3), [e.hp, e.maxHp]);
  check('fountain: refills a pool resource too', e.res > e.maxRes * 0.14);
  const foe = w.players[1].ent!;
  foe.x = 3; foe.y = 22; foe.hp = 100; w.hashDirty = true;
  run(sim, 1);
  check("an enemy in my fountain is not healed", foe.hp < 110, foe.hp);
  void spawnUnit;
});

finish('probe_sim_fighters');
