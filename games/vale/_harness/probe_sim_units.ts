// probe (lane SIM): pickups (spawn, grant effects + gold, lowest id wins, respawn), summons (owner
// credit, follow, assist the owner's target, maxAlive, lifetime), wards (placed by an item active,
// static vision, invisible to enemies unless revealed, lifetime).
import { laneSetup, matchCatalog, run } from './fixtures/match_fixture.ts';
import { check, finish, near, ofType, section } from './fixtures/sim_fixture.ts';
import type { SimEvent } from '../src/contracts/sim.ts';
import { createSim, type Sim } from '../src/sim/sim.ts';
import { equipItem, tryCast } from '../src/sim/abilities.ts';
import { SLOT_ITEM1, ORDER_ATTACK } from '../src/sim/entity.ts';
import { issueAttack, issueMove } from '../src/sim/movement.ts';
import { spawnUnit } from '../src/sim/spawn.ts';
import { applyStatus } from '../src/sim/status.ts';
import type { World } from '../src/sim/world.ts';

const quiet = { minionWaves: undefined, jungle: false, structures: false, passiveGoldPerSec: 0 };
const cat = matchCatalog({ rules: quiet });
const seats = [{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 1 }];
const mk = (): Sim => createSim(cat, laneSetup(seats), { pregameSeconds: 0 });
const pickups = (w: World) => w.entities.filter((e) => e.kind === 'pickup' && e.alive);

section('pickups', () => {
  const sim = mk();
  const w = sim.world;
  run(sim, 4.9);
  check('no pickup before firstSpawn', pickups(w).length === 0);
  run(sim, 0.2);
  const orb = pickups(w)[0];
  check('pickup spawned at its spot (neutral, untargetable by attacks)', orb && near(orb.x, 60) && near(orb.y, 17) && orb.team === -1);
  const a = w.players[0].ent!, b = w.players[1].ent!;
  a.hp = 300; b.hp = 300;
  const g = w.players.map((p) => p.gold);
  a.x = 60.4; a.y = 17; b.x = 59.6; b.y = 17; w.hashDirty = true;
  const ev = run(sim, 0.1);
  const pk = ofType(ev, 'pickup');
  check('one taker: the lowest entity id when two touch it', pk.length === 1 && pk[0].player === 0 && pk[0].def === 'fx_heal_orb', pk);
  check('grant effects ran on the taker (heal 200)', near(a.hp, 500, 2) && near(b.hp, 300, 2), [a.hp, b.hp]);
  const gold = ofType(ev, 'gold').filter((x) => x.player === 0);
  check("gold op in grant (10) + behavior.gold (25), both reason 'pickup'", near(w.players[0].gold - g[0], 35) && gold.length === 2 &&
    gold.every((x) => x.reason === 'pickup'), gold.map((x) => [x.amount, x.reason]));
  check('pickup entity removed (no death event)', !w.entity(orb.id) && ofType(ev, 'death').length === 0);
  a.x = 30; b.x = 30; w.hashDirty = true;
  run(sim, 19.8);
  check('not back before respawn (20 s)', pickups(w).length === 0);
  run(sim, 0.3);
  check('respawns 20 s after it was taken', pickups(w).length === 1);
});

section('summons', () => {
  const sim = mk();
  const w = sim.world;
  const a = w.players[0].ent!, foe = w.players[2].ent!;
  a.x = 40; a.y = 20; foe.x = 90; foe.y = 20; w.hashDirty = true;
  equipItem(w, a, 0, 'fx_wolf_item');
  tryCast(w, a, SLOT_ITEM1);
  const wolf = w.entities.find((e) => e.kind === 'summon' && e.alive)!;
  check('summon owned by the caster (seat + entity), same team', wolf && wolf.owner === 0 && wolf.ownerEid === a.id && wolf.team === 0);
  issueMove(w, a, 50, 25, false);
  run(sim, 4);
  check('follows its owner', Math.hypot(wolf.x - a.x, wolf.y - a.y) < 4, [wolf.x, wolf.y, a.x, a.y]);
  const m = spawnUnit(w, 'fx_lane_minion', 1, a.x + 3, a.y);
  m.autoAttack = false; m.attackDef = null;
  issueAttack(w, a, m);
  run(sim, 0.6);
  check("attacks its owner's target", wolf.order === ORDER_ATTACK && wolf.orderTarget === m.id, [wolf.order, wolf.orderTarget]);
  a.attackDef = null; // let the wolf take the last hit
  const g0 = w.players[0].gold, cs0 = w.players[0].cs;
  run(sim, 20); // 300 hp at 20 dps
  check('a summon kill credits the owner (gold + cs)', !m.alive && near(w.players[0].gold - g0, 20) && w.players[0].cs === cs0 + 1, [m.alive, w.players[0].gold - g0]);
  tryCast(w, a, SLOT_ITEM1);
  const wolves = w.entities.filter((e) => e.kind === 'summon' && e.alive);
  check('maxAlive 1: the older summon dies', wolves.length === 1 && wolves[0] !== wolf && !wolf.alive);
  const ev: SimEvent[] = run(sim, 30.2);
  check('lifetime: expires after its duration (death, no killer)', !wolves[0].alive && ofType(ev, 'death').some((d) => d.dst === wolves[0].id && d.killer === -1));
});

section('wards', () => {
  const sim = mk();
  const w = sim.world;
  const a = w.players[0].ent!, mate = w.players[1].ent!, foe = w.players[2].ent!;
  a.x = 40; a.y = 20; mate.x = 6; mate.y = 20; foe.x = 70; foe.y = 33; w.hashDirty = true;
  run(sim, 0.2);
  check('enemy far from every team-0 unit is in fog', (foe.visibleMask & 1) === 0);
  equipItem(w, a, 0, 'fx_ward_item');
  check('item active places a ward at a point', tryCast(w, a, SLOT_ITEM1, 45, 25) === 'ok');
  const ward = w.entities.find((e) => e.kind === 'ward' && e.alive)!;
  check('ward: static, owned, team 0', ward && ward.static && ward.owner === 0 && ward.team === 0 && near(ward.x, 45) && near(ward.y, 25));
  issueMove(w, a, 6, 20, false);
  run(sim, 6);
  foe.x = 50; foe.y = 29; w.hashDirty = true; // ~6.4 m from the ward (vision cells are 2 m)
  run(sim, 0.2);
  check('the ward reveals an enemy in its sight range (9 m) with no fighter near', (foe.visibleMask & 1) !== 0 && Math.hypot(a.x - foe.x, a.y - foe.y) > 20);
  check('invisible ward: hidden from the enemy team', (ward.visibleMask & (1 << 2)) === 0 || (ward.visibleMask & 2) === 0);
  foe.x = 47; foe.y = 27; w.hashDirty = true;
  run(sim, 0.2);
  check('even when the enemy stands next to it', (ward.visibleMask & 2) === 0);
  applyStatus(w, foe, ward, 'reveal', 3);
  run(sim, 0.2);
  check('revealed: visible to the enemy', (ward.visibleMask & 2) !== 0);
  run(sim, 54);
  check('expires after its 60 s duration', !ward.alive);
});

finish('probe_sim_units');
