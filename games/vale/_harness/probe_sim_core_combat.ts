// probe (lane SIM): mitigation math, pen order, true damage, crits (determinism), shields, vamp,
// grievous, heal/shield power, deaths + assists + K/D/A, death-recap log, unit multipliers, vetoes.
import { ability, buildCatalog, fighter, item } from './fixtures/catalog_fixture.ts';
import { check, fighterEnt, finish, makeWorld, near, ofType, section, stepN, stepSec, addUnit } from './fixtures/sim_fixture.ts';
import type { SimEvent } from '../src/contracts/sim.ts';
import { equipItem, tryCast } from '../src/sim/abilities.ts';
import { addShield, damageLogFor, damageMultiplier, dealDamage, effectiveDefense, heal } from '../src/sim/combat.ts';
import { applyStatus } from '../src/sim/status.ts';
import { stateDigest } from '../src/sim/core.ts';
import type { World } from '../src/sim/world.ts';

const unitHit = (id: string, eff: Record<string, unknown>[]) => ability(id, eff, { cooldown: 0, targeting: { kind: 'unit', range: 30 } });
const cat = buildCatalog({
  fighters: [
    fighter('fx_fighter_a', {
      base: { ad: 100, attackSpeed: 1, hp: 2000 },
      a1: unitHit('fx_hit_phys', [{ op: 'damage', amount: 100, type: 'phys' }]),
      a2: unitHit('fx_hit_magic', [{ op: 'damage', amount: 100, type: 'magic' }]),
      a3: unitHit('fx_hit_true', [{ op: 'damage', amount: 100, type: 'true' }]),
      ult: unitHit('fx_hit_crit', [{ op: 'damage', amount: 100, type: 'true', canCrit: true }]),
    }),
    fighter('fx_fighter_b', { base: { hp: 100000, armor: 100, resist: 50 } }),
    fighter('fx_fighter_c'),
  ],
  items: [
    item('fx_item_pen', { stats: { armorPenPct: 0.3, armorPen: 10 } }),
    item('fx_item_crit', { stats: { crit: 0.5 } }),
    item('fx_item_vamp', { stats: { lifesteal: 0.2, omnivamp: 0.1 } }),
    item('fx_item_hsp', { stats: { healShieldPower: 0.2 } }),
    item('fx_item_magicpen', { stats: { magicPenPct: 0.5, magicPen: 5 } }),
  ],
});

function capture(w: World, fn: () => void): SimEvent[] {
  const n = w.events.length;
  fn();
  return w.events.slice(n);
}
function ranks(w: World, p: number): void { for (let i = 0; i < 4; i++) fighterEnt(w, p).slots[i]!.rank = 1; }

section('mitigation formula', () => {
  check('armor 100 halves damage', near(damageMultiplier(100), 0.5));
  check('armor 0 is neutral', near(damageMultiplier(0), 1));
  check('negative armor amplifies: 2 − 100/(100 − v)', near(damageMultiplier(-50), 2 - 100 / 150));
  check('pen order: % first, then flat', near(effectiveDefense(100, 0.3, 10), 60) && !near(effectiveDefense(100, 0.3, 10), (100 - 10) * 0.7));
  check('pen never takes positive armor below 0', effectiveDefense(10, 0, 50) === 0);
  check('pen does not apply to negative armor', effectiveDefense(-20, 0.5, 10) === -20);
});

section('damage types through the DSL', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_fighter_a', team: 0, x: 10, y: 10 }, { fighter: 'fx_fighter_b', team: 1, x: 12, y: 10 }]);
  ranks(w, 0);
  const a = fighterEnt(w, 0), b = fighterEnt(w, 1);
  let ev = capture(w, () => tryCast(w, a, 0, undefined, undefined, b.id));
  let d = ofType(ev, 'damage')[0];
  check('phys vs 100 armor: 100 → 50', d && near(d.amount, 50), d);
  check('damage event names the ability', d && d.ability === 'fx_hit_phys' && d.src === a.id && d.dst === b.id && d.dtype === 'phys');
  ev = capture(w, () => tryCast(w, a, 1, undefined, undefined, b.id));
  d = ofType(ev, 'damage')[0];
  check('magic vs 50 resist: 100 → 66.67', d && near(d.amount, 100 * 100 / 150, 1e-6), d);
  ev = capture(w, () => tryCast(w, a, 2, undefined, undefined, b.id));
  d = ofType(ev, 'damage')[0];
  check('true damage ignores armor/resist', d && near(d.amount, 100), d);
  equipItem(w, a, 0, 'fx_item_pen');
  stepN(w, 1);
  ev = capture(w, () => tryCast(w, a, 0, undefined, undefined, b.id));
  d = ofType(ev, 'damage')[0];
  check('armorPenPct 0.3 + armorPen 10 vs 100 armor → 60 effective', d && near(d.amount, 100 * 100 / 160, 1e-6), d);
  equipItem(w, a, 1, 'fx_item_magicpen');
  stepN(w, 1);
  ev = capture(w, () => tryCast(w, a, 1, undefined, undefined, b.id));
  d = ofType(ev, 'damage')[0];
  check('magicPenPct 0.5 + magicPen 5 vs 50 resist → 20 effective', d && near(d.amount, 100 * 100 / 120, 1e-6), d);
  check('hit event for unit-targeted ability', ofType(ev, 'hit').some((h) => h.dst === b.id && h.ability === 'fx_hit_magic'));
});

function critPattern(seed: number): string {
  const w = makeWorld(cat, [{ fighter: 'fx_fighter_a', team: 0, x: 10, y: 10 }, { fighter: 'fx_fighter_b', team: 1, x: 12, y: 10 }], { seed });
  ranks(w, 0);
  const a = fighterEnt(w, 0), b = fighterEnt(w, 1);
  equipItem(w, a, 0, 'fx_item_crit');
  stepN(w, 1);
  let out = '';
  for (let i = 0; i < 200; i++) {
    const ev = capture(w, () => tryCast(w, a, 3, undefined, undefined, b.id));
    const d = ofType(ev, 'damage')[0];
    out += d.crit ? '1' : '0';
    if (d.crit && !near(d.amount, 175)) return 'BAD_CRIT_AMOUNT';
    if (!d.crit && !near(d.amount, 100)) return 'BAD_AMOUNT';
  }
  return out;
}
section('crits', () => {
  const p1 = critPattern(1), p2 = critPattern(1), p3 = critPattern(2);
  check('crit: default critDamage 1.75 and exact base on non-crit', p1 !== 'BAD_CRIT_AMOUNT' && p1 !== 'BAD_AMOUNT', p1);
  const rate = [...p1].filter((c) => c === '1').length / p1.length;
  check('crit: rate ≈ 50% for crit 0.5', rate > 0.38 && rate < 0.62, rate);
  check('crit: same seed ⇒ identical crit sequence', p1 === p2);
  check('crit: different seed ⇒ different sequence', p1 !== p3);
});

section('shields, vamp, grievous, heal/shield power', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_fighter_a', team: 0, x: 10, y: 10 }, { fighter: 'fx_fighter_c', team: 1, x: 12, y: 10 }]);
  const a = fighterEnt(w, 0), c = fighterEnt(w, 1);
  addShield(w, a, c, 100, 5);
  check('shield: entity.shield reflects it', near(c.shield, 100));
  const hp0 = c.hp;
  let ev = capture(w, () => dealDamage(w, a, c, 150, 'true'));
  const d = ofType(ev, 'damage')[0];
  check('shield absorbs first: 150 → shielded 100, hp −50', near(d.shielded, 100) && near(c.hp, hp0 - 50) && near(c.shield, 0), { d, hp: c.hp });
  addShield(w, a, c, 50, 1);
  stepSec(w, 1.1);
  check('shield expires after its duration', near(c.shield, 0) && c.shields.length === 0);
  // vamp
  equipItem(w, a, 0, 'fx_item_vamp');
  stepN(w, 1);
  a.hp = 500;
  ev = capture(w, () => dealDamage(w, a, c, 100, 'true', { isAttack: true }));
  check('lifesteal + omnivamp on basic attacks (30%)', near(a.hp, 530), a.hp);
  a.hp = 500;
  dealDamage(w, a, c, 100, 'true', {});
  check('only omnivamp on non-attack damage (10%)', near(a.hp, 510), a.hp);
  // grievous + power
  c.hp = 100;
  applyStatus(w, a, c, 'grievous', 5, { power: 0.4 });
  const healed = heal(w, a, c, 100);
  check('grievous 0.4 cuts healing to 60%', near(healed, 60), healed);
  equipItem(w, a, 1, 'fx_item_hsp');
  stepN(w, 1);
  a.hp = 100;
  check('healShieldPower 0.2: heal 100 → 120', near(heal(w, a, a, 100), 120));
  check('healShieldPower 0.2: shield 100 → 120', near(addShield(w, a, a, 100, 3), 120));
  check('heal clamps to missing hp', near(heal(w, a, a, 1e9), a.maxHp - 220));
  ev = capture(w, () => heal(w, a, a, 10));
  check('no heal event at full hp', ofType(ev, 'heal').length === 0);
});

section('deaths, assists, K/D/A, recap', () => {
  const w = makeWorld(cat, [
    { fighter: 'fx_fighter_a', team: 0, x: 10, y: 10 }, { fighter: 'fx_fighter_c', team: 1, x: 12, y: 10 },
    { fighter: 'fx_fighter_c', team: 0, x: 10, y: 12 }, { fighter: 'fx_fighter_c', team: 0, x: 10, y: 14 },
  ]);
  const a = fighterEnt(w, 0), v = fighterEnt(w, 1), helper = fighterEnt(w, 2), late = fighterEnt(w, 3);
  dealDamage(w, late, v, 10, 'true');        // t≈0: outside both the 10 s assist window and the 15 s recap
  stepSec(w, 4);
  dealDamage(w, a, v, 5, 'true');            // t≈4: still inside the 15 s recap at the kill
  stepSec(w, 7.5);
  dealDamage(w, helper, v, 10, 'true');      // assist
  stepSec(w, 4);
  const ev = capture(w, () => dealDamage(w, a, v, 1e6, 'true'));
  const death = ofType(ev, 'death')[0];
  check('death event: killer and kind', death && death.killer === a.id && death.kind === 'fighter' && death.dst === v.id, death);
  check('assists: inside the 10 s window only', death && death.assists.join() === '2', death?.assists);
  check('victim is dead, hp 0, untargetable', !v.alive && v.hp === 0 && !v.targetable);
  check('K/D/A counters + team kills', w.players[0].kills === 1 && w.players[1].deaths === 1 && w.players[2].assists === 1 &&
    w.players[3].assists === 0 && w.teams[0].kills === 1);
  check('damageToFighters/damageTaken tracked', w.players[0].damageToFighters > 1e5 && w.players[1].damageTaken > 1e5);
  const log = damageLogFor(w, 1);
  check('death recap: last 15 s only, newest last', log.length === 3 && log[0].src === a.id && log[log.length - 1].amount > 1e5 &&
    log.every((x) => x.t >= w.time - 15), log.map((x) => [x.t.toFixed(2), x.src, x.amount]));
  check('death recap: names the source', log[log.length - 1].srcName === 'P0' && log[log.length - 1].srcDef === 'fx_fighter_a');
  stepN(w, 1);
  check('dead fighter state = dead', v.state === 'dead' && v.anim === 'death');
  check('dead units take no damage', dealDamage(w, a, v, 100, 'true') === 0);
});

section('unit multipliers, vetoes, corpses', () => {
  const cat2 = buildCatalog({
    fighters: [
      fighter('fx_fighter_a', { a1: unitHit('fx_mult', [{ op: 'damage', amount: 100, type: 'true', minionMult: 0.5, structureMult: 2 }]),
        a2: ability('fx_mult_area', [{ op: 'area', shape: { kind: 'circle', radius: 10 }, at: 'self', filter: { structures: true }, onHit: [{ op: 'damage', amount: 100, type: 'true', minionMult: 0.5, structureMult: 2 }] }], { cooldown: 0 }) }),
      fighter('fx_fighter_b'),
    ],
  });
  const w = makeWorld(cat2, [{ fighter: 'fx_fighter_a', team: 0, x: 10, y: 10 }, { fighter: 'fx_fighter_b', team: 1, x: 40, y: 50 }]);
  ranks(w, 0);
  const a = fighterEnt(w, 0);
  const m = addUnit(w, 'fx_minion', 1, 12, 10);
  const t = addUnit(w, 'fx_tower', 1, 10, 13);
  let ev = capture(w, () => tryCast(w, a, 0, undefined, undefined, m.id));
  check('minionMult 0.5', near(ofType(ev, 'damage')[0]?.amount ?? 0, 50));
  ev = capture(w, () => tryCast(w, a, 1));
  const tdmg = ofType(ev, 'damage').find((x) => x.dst === t.id);
  check('structureMult 2 (area with structures:true)', tdmg !== undefined && near(tdmg.amount, 200), tdmg);
  t.invulnerable = true;
  check('invulnerable structure takes nothing', dealDamage(w, a, t, 100, 'true') === 0);
  w.hooks.canDamage.push((_w, _s, dst) => dst.id !== m.id);
  check('hooks.canDamage veto', dealDamage(w, a, m, 100, 'true') === 0);
  w.hooks.canDamage.length = 0;
  dealDamage(w, a, m, 1e6, 'true');
  check('minion death: removal scheduled (corpse)', !m.alive && m.removeAt > w.time);
  stepSec(w, 2);
  check('corpse removed from the store after CORPSE_TIME', w.entity(m.id) === undefined && !w.entities.includes(m));
});

section('determinism of a short fight', () => {
  const run = (): string => {
    const w = makeWorld(cat, [{ fighter: 'fx_fighter_a', team: 0, x: 10, y: 10 }, { fighter: 'fx_fighter_c', team: 1, x: 12, y: 10 }], { seed: 77 });
    const a = fighterEnt(w, 0), c = fighterEnt(w, 1);
    equipItem(w, a, 0, 'fx_item_crit');
    a.autoAttack = true; c.autoAttack = true;
    stepSec(w, 8);
    return stateDigest(w);
  };
  check('same seed + same commands ⇒ same digest', run() === run());
});

finish('probe_sim_core_combat');
