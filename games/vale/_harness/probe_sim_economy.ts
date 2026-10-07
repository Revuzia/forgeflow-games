// probe (lane SIM): in-match economy — kill bounty, assist share, streaks + shutdown, first blood,
// multikills, executions, last-hit bounty + cs, xp sharing in range, levels from xp, passive gold,
// goldMult/xpMult from queue rules, team gold view, goldEarned excludes the start gold.
import { laneSetup, matchCatalog, run } from './fixtures/match_fixture.ts';
import { check, finish, near, ofType, section } from './fixtures/sim_fixture.ts';
import type { SimEvent } from '../src/contracts/sim.ts';
import { createSim, type Sim } from '../src/sim/sim.ts';
import { dealDamage } from '../src/sim/combat.ts';
import { respawnFighter, spawnUnit } from '../src/sim/spawn.ts';
import type { Entity } from '../src/sim/entity.ts';
import { killValue } from '../src/sim/economy.ts';
import type { World } from '../src/sim/world.ts';

const quiet = { minionWaves: undefined, jungle: false, structures: false, passiveGoldPerSec: 0 };
const cat = matchCatalog({ rules: quiet });
const seats = [
  { fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 0 },
  { fighter: 'fx_brawler', team: 1 }, { fighter: 'fx_brawler', team: 1 }, { fighter: 'fx_brawler', team: 1 },
];
const mk = (queue = 'fx_lane_q', c = cat): Sim => createSim(c, laneSetup(seats, { queue }), { pregameSeconds: 0 });
const F = (w: World, p: number): Entity => w.players[p].ent!;
function capture(w: World, fn: () => void): SimEvent[] { const n = w.events.length; fn(); return w.events.slice(n); }
function place(w: World): void {
  // everyone together mid-map (inside each other's xp range)
  w.players.forEach((p, i) => { const e = p.ent!; e.x = 60 + (i % 3); e.y = 18 + (i < 3 ? 0 : 3); e.autoAttack = false; });
  w.hashDirty = true;
}
function kill(w: World, killer: number, victim: number): SimEvent[] {
  return capture(w, () => dealDamage(w, F(w, killer), F(w, victim), 1e7, 'true'));
}
function revive(w: World, p: number): void { const e = F(w, p); respawnFighter(w, e, 60, 25); e.autoAttack = false; }

section('kill bounty, assists, first blood, takedown event', () => {
  const sim = mk();
  const w = sim.world;
  place(w);
  const g = w.players.map((p) => p.gold);
  check('start gold is not earned gold', w.players.every((p) => p.gold === 500 && p.goldEarned === 0));
  dealDamage(w, F(w, 1), F(w, 3), 10, 'true');   // assist
  dealDamage(w, F(w, 2), F(w, 3), 10, 'true');   // assist
  const ev = kill(w, 0, 3);
  const d = ofType(ev, 'death')[0], td = ofType(ev, 'takedown')[0];
  check('killer +300 (reason kill); death.gold = 300', near(w.players[0].gold - g[0], 300) && d.gold === 300, [w.players[0].gold - g[0], d.gold]);
  check('assisters split assistShare 0.5 × 300 = 150 → 75 each (reason assist)', near(w.players[1].gold - g[1], 75) && near(w.players[2].gold - g[2], 75) &&
    ofType(ev, 'gold').filter((x) => x.reason === 'assist').length === 2);
  check('takedown: killer, victim, assists, streak 1, first blood, multi 1', td && td.killer === 0 && td.victim === 3 && td.assists.join() === '1,2' &&
    td.streak === 1 && td.first && td.multi === 1 && td.shutdown === 0, td);
  check("announce 'first_blood'", ofType(ev, 'announce').some((a) => a.key === 'first_blood' && a.player === 0));
  check('goldEarned counts kill/assist gold', near(w.players[0].goldEarned, 300) && near(w.players[1].goldEarned, 75));
  revive(w, 3);
  const ev2 = kill(w, 4, 1);
  check('only the first takedown is first blood', !ofType(ev2, 'takedown')[0].first);
});

section('streaks, shutdown, multikill', () => {
  const sim = mk();
  const w = sim.world;
  place(w);
  const p0 = w.players[0];
  kill(w, 0, 3); revive(w, 3);
  const evm = kill(w, 0, 4); revive(w, 4);
  check('second takedown within 10 s: multi 2 + announce multikill', ofType(evm, 'takedown')[0].multi === 2 &&
    ofType(evm, 'announce').some((a) => a.key === 'multikill' && a.params?.n === 2));
  kill(w, 0, 5); revive(w, 5);
  check('streak 3; bounty view = 300 + min(300, 50 × 2) = 400 (shutdown cap 250 not reached)', p0.streak === 3 && p0.bounty === 400, [p0.streak, p0.bounty]);
  const g3 = w.players[3].gold;
  const ev = kill(w, 3, 0);
  const td = ofType(ev, 'takedown')[0];
  check('shutdown: killer gets 300 + 100; takedown.shutdown = 100; announce', near(w.players[3].gold - g3, 400) && td.shutdown === 100 &&
    ofType(ev, 'announce').some((a) => a.key === 'shutdown' && a.params?.gold === 100), [w.players[3].gold - g3, td.shutdown]);
  check("victim's streak resets", p0.streak === 0 && p0.bounty === 300);
  // long streak: the shutdown paid caps at shutdownMax 250 (streak bonus capped at streakMax 300)
  revive(w, 0);
  for (let i = 0; i < 8; i++) { kill(w, 0, 4); revive(w, 4); }
  check('streak 8: bonus min(300, 350) = 300, paid shutdown min(250, 300) → bounty 550', p0.bounty === 550 && killValue(w, p0) === 550, p0.bounty);
});

section('execution (no credited killer): assisters still paid', () => {
  const sim = mk();
  const w = sim.world;
  place(w);
  const tower = spawnUnit(w, 'fx_lane_tower', 1, 70, 18);
  const g1 = w.players[1].gold, g2 = w.players[2].gold;
  dealDamage(w, F(w, 1), F(w, 5), 10, 'true');
  const ev = capture(w, () => { dealDamage(w, F(w, 2), F(w, 5), 10, 'true'); dealDamage(w, tower, F(w, 0), 1e7, 'true'); });
  void ev;
  const ev2 = capture(w, () => dealDamage(w, tower, F(w, 5), 1e7, 'true')); // own-team tower: no credit
  const td = ofType(ev2, 'takedown')[0];
  check('takedown with killer −1', td && td.killer === -1 && td.assists.join() === '1,2', td);
  check('assisters split 150', near(w.players[1].gold - g1, 75) && near(w.players[2].gold - g2, 75), [w.players[1].gold - g1, w.players[2].gold - g2]);
});

section('last hits, cs, xp sharing, levels', () => {
  const sim = mk();
  const w = sim.world;
  place(w);
  const m = spawnUnit(w, 'fx_lane_minion', 1, 61, 19);
  const g0 = w.players[0].gold;
  const ev = capture(w, () => dealDamage(w, F(w, 0), m, 1e6, 'true'));
  check("last hit: +20 gold reason 'cs', cs + 1", near(w.players[0].gold - g0, 20) && w.players[0].cs === 1 && ofType(ev, 'gold')[0].reason === 'cs');
  check('xp 30 shared by the 3 team-0 fighters in range (10 each)', w.players.slice(0, 3).every((p) => near(p.xp, 10)) && w.players[3].xp === 0,
    w.players.map((p) => p.xp));
  // out of range teammates get nothing
  F(w, 1).x = 100; F(w, 2).x = 100; w.hashDirty = true;
  const m2 = spawnUnit(w, 'fx_lane_minion', 1, 61, 19);
  dealDamage(w, F(w, 0), m2, 1e6, 'true');
  check('only fighters within 16 m share: killer +30', near(w.players[0].xp, 40) && near(w.players[1].xp, 10), w.players.map((p) => p.xp));
  // tower last hit: no gold, no cs, xp still shared
  const tower = spawnUnit(w, 'fx_lane_tower', 0, 64, 15);
  const m3 = spawnUnit(w, 'fx_lane_minion', 1, 61, 19);
  const g1 = w.players[0].gold;
  dealDamage(w, tower, m3, 1e6, 'true');
  check('minion killed by a tower: no gold, no cs, xp still given', near(w.players[0].gold, g1) && w.players[0].cs === 2 && near(w.players[0].xp, 70), [w.players[0].gold - g1, w.players[0].cs, w.players[0].xp]);
  // level up: 100 xp at level 1
  const ev2 = capture(w, () => { for (let i = 0; i < 2; i++) dealDamage(w, F(w, 0), spawnUnit(w, 'fx_lane_minion', 1, 61, 19), 1e6, 'true'); });
  const lv = ofType(ev2, 'levelUp');
  check('level 2 at 100 xp: levelUp event, skill point, xp carries over', F(w, 0).level === 2 && lv.length === 1 && lv[0].player === 0 &&
    w.players[0].skillPoints === 2 && near(w.players[0].xp, 30) && w.players[0].xpToNext === 150, [F(w, 0).level, w.players[0].xp, w.players[0].xpToNext]);
  // fighter kill xp: 0.6 × xp step at the victim's level (level 1: 100)
  const xp3 = w.players[3].xp;
  F(w, 3).x = 60; F(w, 4).x = 100; F(w, 5).x = 100; w.hashDirty = true;
  kill(w, 3, 0);
  check('fighter kill xp: 0.6 × 150 (victim level 2) = 90', near(w.players[3].xp - xp3, 90), w.players[3].xp - xp3);
});

section('passive gold; goldMult/xpMult from queue rules; team gold view', () => {
  const sim = createSim(matchCatalog({ rules: { ...quiet, passiveGoldPerSec: 2, passiveGoldStart: 10 } }), laneSetup(seats), { pregameSeconds: 0 });
  const w = sim.world;
  const ev = run(sim, 9.9);
  check('no passive gold before passiveGoldStart', ofType(ev, 'gold').length === 0);
  const ev2 = run(sim, 5.2);
  const pg = ofType(ev2, 'gold').filter((g) => g.player === 0);
  check("passive gold: +2 per second, reason 'passive'", pg.length >= 5 && pg.every((g) => g.amount === 2 && g.reason === 'passive'), pg.length);
  check('team gold view = Σ goldEarned of the team', near(w.teams[0].gold, w.players.slice(0, 3).reduce((s, p) => s + p.goldEarned, 0)) && w.teams[0].gold > 0);
  const fast = mk('fx_lane_fast');
  const fw = fast.world;
  place(fw);
  const m = spawnUnit(fw, 'fx_lane_minion', 1, 61, 19);
  const g0 = fw.players[0].gold;
  dealDamage(fw, F(fw, 0), m, 1e6, 'true');
  check('queue override goldMult 2: last hit pays 40', near(fw.players[0].gold - g0, 40));
  check('queue override xpMult 2: 30 xp × 2 / 3 sharers = 20', near(fw.players[0].xp, 20), fw.players[0].xp);
  check('rules resolved as mode ⊕ queue', fw.rules.goldMult === 2 && fw.rules.startGold === 500);
});

finish('probe_sim_economy');
