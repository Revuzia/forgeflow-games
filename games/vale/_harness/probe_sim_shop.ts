// probe (lane SIM): the in-match shop — access rules (base / base_or_dead / anywhere / shops),
// pool filter, recipes consuming owned components (recursive price), 6 slots, uniqueGroup,
// consumable stacks + charges, sell ratio, undo (LIFO, cleared on leaving the shop or on combat),
// swapItems keeping charges/cooldowns, stats wired, buying during the pre-game countdown.
import { fraySetup, laneSetup, matchCatalog, run } from './fixtures/match_fixture.ts';
import { check, finish, near, ofType, section } from './fixtures/sim_fixture.ts';
import type { Command, SimEvent } from '../src/contracts/sim.ts';
import { createSim, type Sim } from '../src/sim/sim.ts';
import { dealDamage, killEntity } from '../src/sim/combat.ts';
import { SLOT_ITEM1 } from '../src/sim/entity.ts';
import { quoteBuy, undoDepth } from '../src/sim/shop.ts';
import { tryCast } from '../src/sim/abilities.ts';

const quiet = { minionWaves: undefined, jungle: false, structures: false, passiveGoldPerSec: 0, startGold: 10000 };
const seats = [{ fighter: 'fx_brawler', team: 0 }, { fighter: 'fx_brawler', team: 1 }];
const mk = (rules: Record<string, unknown> = {}, pregame = 0): Sim =>
  createSim(matchCatalog({ rules: { ...quiet, ...rules } }), laneSetup(seats), { pregameSeconds: pregame });
function cmd(sim: Sim, c: Command, p = 0): SimEvent[] { sim.command(p, c); return sim.step(); }
const buy = (sim: Sim, item: string, p = 0): SimEvent[] => cmd(sim, { type: 'buy', item }, p);
const denied = (ev: SimEvent[]): string | undefined => ofType(ev, 'announce').find((a) => a.key === 'shop_denied')?.params?.reason as string | undefined;

section('access rules', () => {
  const sim = mk();
  const w = sim.world, p = w.players[0], e = p.ent!;
  sim.step();
  check("'base': can shop at the base shop", p.canShop);
  e.x = 60; e.y = 20; w.hashDirty = true;
  const ev = buy(sim, 'fx_sword');
  check("'base': not mid-map — refused with shop_denied 'access'", !p.canShop && p.items[0] === null && denied(ev) === 'access');
  killEntity(w, e, null);
  sim.step();
  check("'base': not when dead mid-map", !p.canShop);
  const s2 = mk({ shopAccess: 'base_or_dead' });
  const p2 = s2.world.players[0];
  p2.ent!.x = 60; s2.world.hashDirty = true;
  s2.step();
  check("'base_or_dead': not alive mid-map", !p2.canShop);
  killEntity(s2.world, p2.ent!, null);
  s2.step();
  check("'base_or_dead': yes when dead", p2.canShop && buy(s2, 'fx_sword') && p2.items[0] === 'fx_sword');
  const s3 = mk({ shopAccess: 'anywhere' });
  s3.world.players[0].ent!.x = 60; s3.world.hashDirty = true;
  s3.step();
  check("'anywhere': mid-map", s3.world.players[0].canShop);
  const s4 = createSim(matchCatalog({ frayRules: { startGold: 5000 } }), fraySetup(3), { pregameSeconds: 0 });
  const p4 = s4.world.players[0], e4 = p4.ent!;
  s4.step();
  check("'shops': not away from a map shop", !p4.canShop);
  e4.x = 25; e4.y = 31; s4.world.hashDirty = true;
  s4.step();
  check("'shops': inside a MapDef.shops circle", p4.canShop && buy(s4, 'fx_sword') && p4.items[0] === 'fx_sword');
});

section('pool, basic buy, stats, buy event', () => {
  const sim = mk();
  const w = sim.world, p = w.players[0], e = p.ent!;
  sim.step();
  check('item outside rules.itemPool is refused', denied(buy(sim, 'fx_foreign')) === 'pool' && p.items.every((x) => x === null));
  const ad0 = e.stats.ad;
  const ev = buy(sim, 'fx_sword');
  check('buy: gold −400, slot 0, buy event', near(p.gold, 9600) && p.items[0] === 'fx_sword' && ofType(ev, 'buy').some((b) => b.item === 'fx_sword'));
  sim.step();
  check('item stats apply (+15 ad)', near(e.stats.ad - ad0, 15));
  check('pool-listed item (pools contains the rule pool) is sold', buy(sim, 'fx_gem') && p.items[1] === 'fx_gem');
  check('gold spent is not "earned"', p.goldEarned === 0);
});

section('recipes (recursive), slots, uniqueGroup', () => {
  const sim = mk();
  const w = sim.world, p = w.players[0];
  sim.step();
  buy(sim, 'fx_sword'); buy(sim, 'fx_gem'); buy(sim, 'fx_sword');
  const q = quoteBuy(w, p, 'fx_greatblade');
  check('quote: greatblade = 3000 − (400 + 400 + 350) = 1850 using 3 owned parts', q.ok && q.price === 1850 && q.consumes.join() === '0,1,2', q);
  const g = p.gold;
  buy(sim, 'fx_greatblade');
  check('recursive recipe consumes the swords + gem; lands in the first consumed slot', p.items.join() === 'fx_greatblade,,,,,' && near(g - p.gold, 1850), p.items);
  buy(sim, 'fx_sword'); buy(sim, 'fx_sword');
  const g2 = p.gold;
  buy(sim, 'fx_blade');
  check('blade with two owned swords costs 400', near(g2 - p.gold, 400) && p.items.filter((x) => x === 'fx_blade').length === 1 && !p.items.includes('fx_sword'));
  buy(sim, 'fx_boots_a');
  check("uniqueGroup: a second boots_a is refused ('unique')", denied(buy(sim, 'fx_boots_a')) === 'unique');
  const g3 = p.gold;
  buy(sim, 'fx_boots_b');
  check('boots_b consumes boots_a (same group allowed): costs 600', p.items.includes('fx_boots_b') && !p.items.includes('fx_boots_a') && near(g3 - p.gold, 600));
  while (p.items.includes(null)) buy(sim, 'fx_crit_cloak');
  check("6 slots: a 7th item is refused ('slots')", denied(buy(sim, 'fx_sword')) === 'slots' && p.items.every((x) => x !== null));
  cmd(sim, { type: 'sell', slot: 5 });
  p.gold = 10;
  check("not enough gold ('gold')", quoteBuy(w, p, 'fx_crit_cloak').reason === 'gold' && denied(buy(sim, 'fx_crit_cloak')) === 'gold');
});

section('consumables: stack, charges, use', () => {
  const sim = mk();
  const w = sim.world, p = w.players[0], e = p.ent!;
  sim.step();
  for (let i = 0; i < 5; i++) buy(sim, 'fx_potion');
  check('potions stack in one slot up to maxStack 5', p.items[0] === 'fx_potion' && p.itemCharges[0] === 5 && p.items[1] === null, [p.items, p.itemCharges]);
  buy(sim, 'fx_potion');
  check('the 6th starts a new stack', p.items[1] === 'fx_potion' && p.itemCharges[1] === 1);
  buy(sim, 'fx_flask');
  check('flask: 3 charges, maxStack 1', p.items[2] === 'fx_flask' && p.itemCharges[2] === 3);
  buy(sim, 'fx_flask');
  check('a second flask cannot stack (3 + 3 > 3)', p.items[3] === 'fx_flask');
  e.hp = 100;
  check('using a potion consumes a charge', tryCast(w, e, SLOT_ITEM1 + 1) === 'ok' && p.items[1] === null && near(e.hp, 200), [p.items[1], e.hp]);
  tryCast(w, e, SLOT_ITEM1);
  check('a stack loses one charge per use', p.itemCharges[0] === 4);
});

section('sell + undo', () => {
  const sim = mk();
  const w = sim.world, p = w.players[0], e = p.ent!;
  sim.step();
  buy(sim, 'fx_sword');
  for (let i = 0; i < 3; i++) buy(sim, 'fx_potion');
  const g0 = p.gold, earned = p.goldEarned;
  const ev = cmd(sim, { type: 'sell', slot: 0 });
  check('sell: floor(400 × 0.7) = 280 back, sell + gold(reason sell) events', near(p.gold - g0, 280) && p.items[0] === null &&
    ofType(ev, 'sell').length === 1 && ofType(ev, 'gold').some((x) => x.reason === 'sell' && x.amount === 280));
  check('refunds are not earned gold', p.goldEarned === earned);
  const g1 = p.gold;
  cmd(sim, { type: 'sell', slot: 1 });
  check('selling a stack of 3 potions: floor(50 × 0.7 × 3) = 105', near(p.gold - g1, 105));
  check('undo stack depth 6 (4 buys + 2 sells)', undoDepth(w, 0) === 6);
  cmd(sim, { type: 'undo' });
  check('undo the stack sale: potions back, refund taken back', p.items[1] === 'fx_potion' && p.itemCharges[1] === 3 && near(p.gold, g1));
  cmd(sim, { type: 'undo' });
  check('undo the sword sale', p.items[0] === 'fx_sword' && near(p.gold, g0));
  const gb = p.gold;
  cmd(sim, { type: 'undo' }); cmd(sim, { type: 'undo' });
  check('undo buys: full price back, items gone (LIFO)', near(p.gold, gb + 100) && p.itemCharges[1] === 1);
  buy(sim, 'fx_sword');
  e.x = 60; w.hashDirty = true; sim.step();
  e.x = 4; w.hashDirty = true; sim.step();
  check('leaving the shop clears the undo stack', undoDepth(w, 0) === 0);
  buy(sim, 'fx_sword');
  const foe = w.players[1].ent!;
  dealDamage(w, foe, e, 5, 'true');
  check('combat with an enemy fighter clears it too', undoDepth(w, 0) === 0);
});

section('item passives come and go with the item', () => {
  const sim = mk();
  const w = sim.world, p = w.players[0], e = p.ent!;
  sim.step();
  const hp0 = e.maxHp;
  buy(sim, 'fx_charm');
  sim.step();
  check('item stats (+50 hp)', near(e.maxHp - hp0, 50));
  const foe = w.players[1].ent!;
  e.x = 40; e.y = 20; foe.x = 41.5; foe.y = 20; foe.autoAttack = false; w.hashDirty = true;
  sim.command(0, { type: 'attack', target: foe.id });
  const ev = run(sim, 1.5);
  const extra = ofType(ev, 'damage').filter((d) => d.src === e.id && d.dst === foe.id && d.ability === 'fx_charm_p');
  check('its attackHit passive adds 25 true damage per hit', extra.length >= 1 && extra.every((d) => near(d.amount, 25)), extra.length);
  e.x = 4; e.y = 20; w.hashDirty = true; sim.command(0, { type: 'stop' }); sim.step();
  cmd(sim, { type: 'sell', slot: 0 });
  check('selling removes its passive', !e.passives.some((x) => x.id === 'fx_charm_p') && near(e.maxHp, hp0));
});

section('swapItems keeps charges and cooldowns; pre-game shopping', () => {
  const sim = mk();
  const w = sim.world, p = w.players[0], e = p.ent!;
  sim.step();
  buy(sim, 'fx_flask'); buy(sim, 'fx_ward_item');
  tryCast(w, e, SLOT_ITEM1 + 1, e.x + 2, e.y);
  const cd = e.slots[SLOT_ITEM1 + 1]!.cooldown;
  cmd(sim, { type: 'swapItems', a: 0, b: 1 });
  check('swap: items, charges and the active cooldown move together', p.items[0] === 'fx_ward_item' && p.items[1] === 'fx_flask' &&
    p.itemCharges[1] === 3 && near(e.slots[SLOT_ITEM1]!.cooldown, cd - 1 / 30, 1e-6), [p.items, p.itemCharges, e.slots[SLOT_ITEM1]?.cooldown, cd]);
  const pre = mk({}, 3);
  const pp = pre.world.players[0];
  check('pre-game: phase pregame, negative time', pre.view.phase === 'pregame' && pre.view.time < 0);
  buy(pre, 'fx_sword');
  check('pre-game: buying works', pp.items[0] === 'fx_sword');
  run(pre, 3.1);
  check('then the match goes live', pre.view.phase === 'live');
});

finish('probe_sim_shop');
