// probe (lane SIM): 'last_standing_or_score' (Fray) — lives, kill score, FFA bounties, respawn
// while lives remain at the safest spawn, eliminations in reverse placement order, eliminated seats
// frozen out, last-standing / kill-score / time-limit ends with complete placements.
import { fraySetup, matchCatalog, run } from './fixtures/match_fixture.ts';
import { check, finish, near, ofType, section } from './fixtures/sim_fixture.ts';
import type { SimEvent } from '../src/contracts/sim.ts';
import { createSim, type Sim } from '../src/sim/sim.ts';
import { dealDamage } from '../src/sim/combat.ts';
import type { World } from '../src/sim/world.ts';

const cat = matchCatalog();
const mk = (n = 6, seed = 1): Sim => createSim(cat, fraySetup(n, { seed }), { pregameSeconds: 0 });
function capture(w: World, fn: () => void): SimEvent[] { const n = w.events.length; fn(); return w.events.slice(n); }
const kill = (w: World, k: number, v: number): SimEvent[] => capture(w, () => dealDamage(w, w.players[k].ent!, w.players[v].ent!, 1e7, 'true'));
function respawnAll(sim: Sim): void { run(sim, 3.2); }

section('setup: own teams, lives, scores, spawn ring', () => {
  const sim = mk();
  const w = sim.world;
  check('every seat is its own team', new Set(w.players.map((p) => p.team)).size === 6 && w.teams.length === 6);
  check('lives 2, score 0, no placement yet', w.players.every((p) => p.lives === 2 && p.score === 0 && p.placement === undefined));
  check('seats spawn on the map spawn ring (17 m from the centre)', w.players.every((p) => near(Math.hypot(p.ent!.x - 25, p.ent!.y - 25), 17, 0.6)));
});

section('kills: score, FFA bounty + assist, lives, respawn at the safest spawn', () => {
  const sim = mk();
  const w = sim.world;
  const g = w.players.map((p) => p.gold);
  dealDamage(w, w.players[2].ent!, w.players[1].ent!, 10, 'true'); // an assist from a third seat
  const ev = kill(w, 0, 1);
  check('killer score +1, victim loses a life', w.players[0].score === 1 && w.players[1].lives === 1);
  check('FFA kill gold + assist share', near(w.players[0].gold - g[0], 300) && near(w.players[2].gold - g[2], 150), [w.players[0].gold - g[0], w.players[2].gold - g[2]]);
  check('takedown carries the FFA assist', ofType(ev, 'takedown')[0]?.assists.join() === '2');
  for (const p of w.players) if (p.player !== 1) { p.ent!.x = 25 + (p.player % 2 ? 6 : -6); p.ent!.y = 10; }
  w.hashDirty = true;
  respawnAll(sim);
  const v = w.players[1].ent!;
  check('respawns while lives remain, at the spawn farthest from living enemies (north)', v.alive && v.y > 30, [v.x, v.y]);
});

section('eliminations: reverse placement, frozen out, last standing', () => {
  const sim = createSim(matchCatalog({ frayRules: { end: { kind: 'last_standing_or_score', lives: 2, killScore: 99, timeLimit: 240 } } }), fraySetup(6), { pregameSeconds: 0 });
  const w = sim.world;
  kill(w, 0, 5); respawnAll(sim);
  const ev = kill(w, 0, 5).concat(sim.step()); // placed at the end of the tick of the death ('modes' phase)
  const el = ofType(ev, 'eliminated')[0];
  check('second death eliminates: placement 6 (first out)', el && el.player === 5 && el.placement === 6 && w.players[5].placement === 6 && w.players[5].lives === 0, el);
  check("announce 'eliminated'", ofType(ev, 'announce').some((a) => a.key === 'eliminated' && a.player === 5));
  run(sim, 6);
  check('no respawn for an eliminated seat', !w.players[5].ent!.alive && w.players[5].respawnIn === 0);
  sim.command(5, { type: 'move', x: 10, y: 10 });
  sim.command(5, { type: 'ping', kind: 'alert', x: 10, y: 10 });
  const evp = sim.step();
  check('eliminated seats: commands dropped except pings', ofType(evp, 'ping').length === 1 && w.players[5].ent!.order === 0);
  for (const v of [4, 3, 2]) { kill(w, 1, v); respawnAll(sim); kill(w, 1, v); sim.step(); }
  check('placements 5, 4, 3 in elimination order', w.players[4].placement === 5 && w.players[3].placement === 4 && w.players[2].placement === 3,
    w.players.map((p) => p.placement));
  kill(w, 0, 1); respawnAll(sim);
  const evEnd = kill(w, 0, 1).concat(sim.step());
  const end = ofType(evEnd, 'end')[0];
  check('one seat left: end event, reason last_standing', end && end.result.reason === 'last_standing' && w.phase === 'ended' && w.result === end.result, end?.result.reason);
  const r = w.result!;
  check('placements 1..6 complete and distinct; winner placed 1st and won', r.players.map((p) => p.placement).sort().join() === '1,2,3,4,5,6' &&
    r.players[0].placement === 1 && r.players[0].won && r.players.filter((p) => p.won).length === 1 && r.winningTeam === -1,
    r.players.map((p) => [p.player, p.placement, p.won]));
  check('PlayerResult.score carries the kill score', r.players[0].score === w.players[0].score && (r.players[0].score ?? 0) >= 2);
  check('runner-up is the last eliminated', r.players[1].placement === 2);
});

section('kill score end', () => {
  const sim = mk(4);
  const w = sim.world;
  for (let i = 0; i < 4; i++) { kill(w, 2, 1 + (i % 2 ? 2 : 0)); respawnAll(sim); } // seats 1 then 3 run out of lives
  const r = w.result;
  check('first to killScore 4 ends it (reason score)', !!r && r.reason === 'score' && w.players[2].score === 4, r?.reason);
  const pl = Object.fromEntries(r!.players.map((p) => [p.player, p.placement]));
  check('the scorer 1st; seat 0 (still in) 2nd; eliminated seats keep their elimination places', pl[2] === 1 && pl[0] === 2 && pl[1] === 4 && pl[3] === 3, pl);
});

section('time limit end', () => {
  const sim = createSim(matchCatalog({ frayRules: { end: { kind: 'last_standing_or_score', lives: 2, killScore: 4, timeLimit: 20 } } }), fraySetup(3), { pregameSeconds: 0 });
  const w = sim.world;
  for (const p of w.players) p.ent!.autoAttack = false;
  kill(w, 1, 2);
  dealDamage(w, w.players[0].ent!, w.players[1].ent!, 5, 'true');
  const ev = run(sim, 21);
  const end = ofType(ev, 'end')[0];
  check('timeLimit 20 s: reason time', end && end.result.reason === 'time' && near(end.result.duration, 20, 0.05), end?.result);
  const pl = Object.fromEntries(end.result.players.map((p) => [p.player, p.placement]));
  check('ranked by score, then damage', pl[1] === 1 && pl[2] === 3 && pl[0] === 2, pl);
});

finish('probe_sim_fray');
