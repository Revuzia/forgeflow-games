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
import { harness, lastOf } from './fixtures/session_fixture.ts';
import { BOTS_LINK } from '../src/session/bots_link.ts';

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

section('the lab (W4 gameplay g3): waves and structures toggles, teleport, dummy stats, damage meter', () => {
  const sim = createSim(cat, laneSetup(seats, { queue: 'fx_lane_practice' }), { pregameSeconds: 0 });
  const w = sim.world, p = w.players[0], e = p.ent!;
  const cmd = (c: Record<string, unknown>): SimEvent[] => { sim.command(0, { type: 'practice', ...c } as never); return sim.step(); };
  const wicks = (): number => w.entities.filter((u) => u.kind === 'minion' && u.alive && u.def !== 'fx_training_dummy').length;
  check('WorldView.practice: on, waves and structures on', !!sim.view.practice && sim.view.practice.waves && sim.view.practice.structures);
  run(sim, 14);
  const before = wicks();
  const tev = cmd({ action: 'toggleWaves' });
  check(`toggleWaves off: the roads clear (${before} -> ${wicks()} Wicks), no bounty paid`, before > 0 && wicks() === 0 && !ofType(tev, 'gold').some((g) => g.reason === 'cs') && !sim.view.practice!.waves);
  run(sim, 65);
  check('…and no wave spawns while off (65 s)', wicks() === 0);
  cmd({ action: 'toggleWaves' });
  run(sim, 31);
  check('toggleWaves on: waves resume on the schedule', wicks() > 0 && sim.view.practice!.waves);
  // structures: the enemy tower at (82, 20)
  const tower = w.entities.find((u) => u.kind === 'structure' && u.team === 1 && u.def === 'fx_lane_tower')!;
  cmd({ action: 'toggleWaves' });
  cmd({ action: 'toggleStructures' });
  cmd({ action: 'teleport', x: tower.x - 3, y: tower.y });
  check('teleport: onto a walkable point next to the enemy tower', Math.hypot(e.x - (tower.x - 3), e.y - tower.y) < 0.01, [e.x, e.y]);
  const hp0 = e.hp;
  run(sim, 4);
  check('toggleStructures off: the tower holds fire and takes no damage', e.hp >= hp0 && dealDamage(w, e, tower, 500, 'true') === 0 && !sim.view.practice!.structures);
  cmd({ action: 'toggleStructures' });
  run(sim, 4);
  check('toggleStructures on: it shoots again', e.hp < hp0 || !e.alive);
  const at = [e.x, e.y];
  cmd({ action: 'teleport', x: -50, y: -50 });
  check('teleport off the map is refused', e.x === at[0] && e.y === at[1]);
  // dummy stats and the meter
  cmd({ action: 'heal' });
  cmd({ action: 'teleport', x: 25, y: 35 });
  e.facing = 0; e.autoAttack = false;
  cmd({ action: 'dummyStats', hp: 3000, armor: 100, resist: 0 });
  cmd({ action: 'spawnDummy' });
  const d = dummies(sim)[0];
  check('dummyStats: a new dummy has 3000 hp, 100 armor, 0 resist; the view says so', d && d.maxHp === 3000 && d.hp === 3000 && d.stats.armor === 100 && d.stats.resist === 0 &&
    sim.view.practice!.dummy.hp === 3000 && sim.view.practice!.dummy.armor === 100, d && [d.maxHp, d.stats.armor, d.stats.resist]);
  cmd({ action: 'resetMeter' });
  const a1 = dealDamage(w, e, d, 200, 'phys');
  run(sim, 1);
  const a2 = dealDamage(w, e, d, 100, 'true');
  sim.step();
  const m = sim.view.practice!.meters.find((x) => x.player === 0)!;
  check(`100 armor halves a 200 phys hit (${a1.toFixed(1)}); the meter: dealt ${m.dealt.toFixed(1)}, last ${m.last.toFixed(1)}, burst ${m.burst.toFixed(1)} over ${m.burstTime.toFixed(2)} s, last 5 s ${m.recent5.toFixed(1)}`,
    Math.abs(a1 - 100) < 1e-6 && Math.abs(m.dealt - (a1 + a2)) < 1e-6 && Math.abs(m.last - a2) < 1e-6 && Math.abs(m.burst - (a1 + a2)) < 1e-6 && m.burstTime > 0.9 && Math.abs(m.recent5 - (a1 + a2)) < 1e-6, m);
  run(sim, 6);
  dealDamage(w, e, d, 50, 'true');
  sim.step();
  const m2 = sim.view.practice!.meters.find((x) => x.player === 0)!;
  check('a gap of 3 s+ starts a new burst; the 5 s window lets the old hits go', Math.abs(m2.burst - 50) < 1e-6 && Math.abs(m2.recent5 - 50) < 1e-6 && Math.abs(m2.dealt - (a1 + a2 + 50)) < 1e-6, m2);
  cmd({ action: 'resetMeter' });
  check('resetMeter zeroes it', sim.view.practice!.meters.find((x) => x.player === 0)!.dealt === 0);
  cmd({ action: 'dummyStats', armor: 0 });
  check('dummyStats applies to the dummies already standing', d.stats.armor === 0 && d.maxHp === 3000);
  cmd({ action: 'clearDummies' });
  check('clearDummies removes them', dummies(sim).length === 0);
  const s3 = createSim(cat, laneSetup(seats, { queue: 'fx_lane_practice', practice: { waves: false, structures: false } }), { pregameSeconds: 0 });
  run(s3, 20);
  check('setup.practice waves / structures false: no Wicks, structures off from the start', s3.view.practice!.waves === false && s3.view.practice!.structures === false &&
    s3.world.entities.filter((u) => u.kind === 'minion' && u.alive).length === 0);
  check('outside practice WorldView.practice is null', createSim(cat, laneSetup(seats), { pregameSeconds: 0 }).view.practice === null);
});

section('the lab, session half (g3): a sparring fighter and another mode', () => {
  const h = harness({ autopilot: false });
  h.session.queue({ queue: 'fx_s_practice', practice: { sparring: { fighter: 'fx_ranger', difficulty: 'veteran' }, mode: 'fx_s_bridge', waves: false }, preset: { fighter: 'fx_brawler' } });
  h.clock.advanceUntil(() => h.session.phase === 'loading', 15_000);
  const setup = lastOf(h, 'loading')?.setup;
  const sp = setup?.seats.find((s) => s.player !== 0);
  check('practice.sparring: a veteran bot on the other team with the chosen fighter', !!setup && setup.seats.length === 2 && !!sp && sp.team !== setup.seats[0].team &&
    sp.controller === 'bot' && sp.fighter === 'fx_ranger' && sp.botDifficulty === 'veteran', setup?.seats);
  check('practice.mode: the other core mode on its own map; the sim gets waves:false only (mode/sparring stay in the session)', setup?.mode === 'fx_s_bridge' && setup?.map === 'fx_lane_map' &&
    JSON.stringify(setup?.practice) === JSON.stringify({ waves: false }), [setup?.mode, setup?.map, setup?.practice]);
  // INTEG2 (client handoff): the setup must also BUILD — world.ts resolveRules refuses the practice queue (mode
  // fx_s_rift) on fx_s_bridge unless the session runs it on a catalog whose practice queue belongs to that mode
  const errs = h.events.filter((e) => e.type === 'error').map((e) => (e as { message: string }).message);
  const m = h.session.currentMatch();
  check('practice.mode: the World builds (a host, still loading, no error) on the other mode', h.session.phase === 'loading' && !!m && errs.length === 0,
    { phase: h.session.phase, host: !!m, errs });
  check('the raw catalog alone refuses that setup (why the session derives one)', (() => {
    try { createSim(h.catalog, setup!, { pregameSeconds: 0 }); return false; } catch (err) { return /belongs to mode/.test(String(err)); }
  })());
  if (m) {
    h.session.matchReady();
    for (let i = 0; i < 40 && m.view.time < 3; i++) { m.pump(0.25); }
    const sparring = m.view.entities.find((e) => e.kind === 'fighter' && e.team !== m.view.entities.find((x) => x.owner === 0 && x.kind === 'fighter')?.team);
    check('…and runs: mode, queue, map, time past 3 s, the sparring fighter on the field', h.session.phase === 'match' && m.view.mode === 'fx_s_bridge' &&
      m.view.queue === 'fx_s_practice' && m.view.map === 'fx_lane_map' && m.view.time >= 3 && !!sparring,
      { phase: h.session.phase, mode: m.view.mode, queue: m.view.queue, map: m.view.map, time: m.view.time, sparring: !!sparring });
  }
  // a throw while the match is built (the bots factory, as BOTS_LINK did on BRIDGE practice) ends in 'idle' + an
  // error, never a stuck 'loading'; the next queue is accepted
  const link = BOTS_LINK as { bots: typeof BOTS_LINK.bots };
  const realBots = link.bots;
  link.bots = () => { throw new Error('probe: the bots factory refused'); };
  const h3 = harness({ autopilot: false, bots: undefined });
  try {
    h3.session.queue({ queue: 'fx_s_practice', practice: { mode: 'fx_s_bridge' }, preset: { fighter: 'fx_brawler' } });
    h3.clock.advanceUntil(() => !!lastOf(h3, 'error') || h3.session.phase === 'loading' || h3.session.phase === 'match', 15_000);
  } finally { link.bots = realBots; }
  const e3 = lastOf(h3, 'error');
  check('a throw while building the match: back to idle with "match: could not start", no host',
    h3.session.phase === 'idle' && !!e3 && /match: could not start \(probe: the bots factory refused\)/.test(e3.message) && h3.session.currentMatch() === null,
    { phase: h3.session.phase, err: e3?.message });
  h3.session.queue({ queue: 'fx_s_practice', practice: { mode: 'fx_s_bridge' }, preset: { fighter: 'fx_brawler' } });
  h3.clock.advanceUntil(() => h3.session.phase === 'loading', 15_000);
  check('…and the next practice queue loads (the real bots factory on fx_s_bridge)', h3.session.phase === 'loading' && !!h3.session.currentMatch() &&
    h3.session.currentMatch()!.view.mode === 'fx_s_bridge', { phase: h3.session.phase });
  const h2 = harness({ autopilot: false });
  h2.session.queue({ queue: 'fx_s_practice', practice: { mode: 'fx_s_fray' }, preset: { fighter: 'fx_brawler' } });
  h2.clock.advanceUntil(() => h2.session.phase === 'loading', 15_000);
  check('a mode that is not a two-team core mode is ignored (FRAY would end on a lone seat)', lastOf(h2, 'loading')?.setup.mode === 'fx_s_rift');
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
