// probe (lane SIM): seeded rng streams, 2D math + shape tests, catalog index + rules merge.
import { buildCatalog, ability, fighter, passive } from './fixtures/catalog_fixture.ts';
import { check, finish, near, section } from './fixtures/sim_fixture.ts';
import { Rng, createStreams, deriveSeed, stream } from '../src/sim/rng.ts';
import {
  angleDiff, inCircle, inCone, inRect, inRing, inShape, pointInPolygon, segmentCircleT, segmentsIntersect, shapeReach, wrapAngle, DEG,
} from '../src/sim/math.ts';
import { deepMerge, indexCatalog, resolveRules } from '../src/sim/catalog_index.ts';

section('rng', () => {
  const a = new Rng(42), b = new Rng(42), c = new Rng(43);
  const sa = Array.from({ length: 50 }, () => a.nextU32());
  const sb = Array.from({ length: 50 }, () => b.nextU32());
  const sc = Array.from({ length: 50 }, () => c.nextU32());
  check('rng: same seed ⇒ same sequence', sa.join() === sb.join());
  check('rng: different seed ⇒ different sequence', sa.join() !== sc.join());
  const r = new Rng(7);
  let min = 1, max = 0, sum = 0;
  for (let i = 0; i < 20000; i++) { const f = r.float(); if (f < min) min = f; if (f > max) max = f; sum += f; }
  check('rng: float in [0,1)', min >= 0 && max < 1);
  check('rng: float mean ≈ 0.5', Math.abs(sum / 20000 - 0.5) < 0.01, sum / 20000);
  const ints = new Set<number>();
  for (let i = 0; i < 2000; i++) { const v = r.int(2, 5); ints.add(v); }
  check('rng: int(lo, hi) is inclusive and bounded', [...ints].sort().join() === '2,3,4,5', [...ints]);
  let rg = true;
  for (let i = 0; i < 1000; i++) { const v = r.range(-3, 3); if (v < -3 || v >= 3) rg = false; }
  check('rng: range bounded', rg);
  check('rng: chance(0) false, chance(1) true', !r.chance(0) && r.chance(1));
  const picks = new Set<string>();
  for (let i = 0; i < 200; i++) picks.add(r.pick(['x', 'y', 'z']));
  check('rng: pick covers the array', picks.size === 3);
  const st = r.state(); const n1 = r.nextU32(); r.setState(st);
  check('rng: state round-trips', r.nextU32() === n1);
  const s1 = createStreams(99), s2 = createStreams(99);
  check('streams: deterministic per name', s1.combat.nextU32() === s2.combat.nextU32() && s1.ai.nextU32() === s2.ai.nextU32());
  const s3 = createStreams(99);
  check('streams: named streams differ', s3.combat.nextU32() !== s3.ai.nextU32() && deriveSeed(99, 'combat') !== deriveSeed(99, 'spawn'));
  // independence: drawing from ai does not shift combat
  const x = createStreams(5), y = createStreams(5);
  for (let i = 0; i < 100; i++) x.ai.nextU32();
  check('streams: independent (ai draws do not shift combat)', x.combat.nextU32() === y.combat.nextU32());
  check('stream(): extra named streams', stream(1, 'bots:0').nextU32() === stream(1, 'bots:0').nextU32());
});

section('math', () => {
  check('wrapAngle', near(wrapAngle(3 * Math.PI), Math.PI) && near(wrapAngle(-3 * Math.PI), Math.PI) && near(wrapAngle(0.5), 0.5));
  check('angleDiff shortest', near(angleDiff(170 * DEG, -170 * DEG), 20 * DEG));
  check('segmentCircleT: hit', near(segmentCircleT(0, 0, 10, 0, 5, 0, 1), 0.4));
  check('segmentCircleT: miss', segmentCircleT(0, 0, 10, 0, 5, 3, 1) === -1);
  check('segmentCircleT: start inside', segmentCircleT(5, 0, 10, 0, 5, 0, 1) === 0);
  check('segmentsIntersect', segmentsIntersect(0, 0, 2, 2, 0, 2, 2, 0) && !segmentsIntersect(0, 0, 1, 0, 0, 1, 1, 1));
  check('inCircle with unit radius', inCircle(3.4, 0, 0.5, 0, 0, 3) && !inCircle(3.6, 0, 0.5, 0, 0, 3));
  check('inRing', inRing(3, 0, 0, 0, 0, 4, 2) && !inRing(1, 0, 0, 0, 0, 4, 2) && inRing(1.6, 0, 0.5, 0, 0, 4, 2));
  // cone pointing +x, 90° total
  check('inCone inside', inCone(3, 1, 0, 0, 0, 1, 0, 5, 45 * DEG));
  check('inCone outside angle', !inCone(1, 3, 0, 0, 0, 1, 0, 5, 45 * DEG));
  check('inCone behind', !inCone(-2, 0, 0, 0, 0, 1, 0, 5, 45 * DEG));
  check('inCone 360', inCone(-2, 0, 0, 0, 0, 1, 0, 5, Math.PI));
  // rect anchored at origin, extending along +y
  check('inRect inside', inRect(0.5, 4, 0, 0, 0, 0, 1, 6, 2));
  check('inRect beyond length', !inRect(0, 6.5, 0, 0, 0, 0, 1, 6, 2));
  check('inRect behind anchor', !inRect(0, -1, 0, 0, 0, 0, 1, 6, 2));
  check('inRect side + radius', !inRect(1.3, 3, 0, 0, 0, 0, 1, 6, 2) && inRect(1.3, 3, 0.5, 0, 0, 0, 1, 6, 2));
  check('inShape dispatch', inShape({ kind: 'cone', radius: 5, angleDeg: 90 }, 3, 1, 0, 0, 0, 1, 0) &&
    inShape({ kind: 'rect', length: 6, width: 2 }, 3, 0, 0, 0, 0, 1, 0) && !inShape({ kind: 'ring', radius: 4, inner: 2 }, 0.5, 0, 0, 0, 0, 1, 0));
  check('shapeReach', shapeReach({ kind: 'rect', length: 6, width: 2 }) > 6 && shapeReach({ kind: 'circle', radius: 3 }) === 3);
  const concave: [number, number][] = [[0, 0], [10, 0], [10, 10], [5, 4], [0, 10]];
  check('pointInPolygon concave', pointInPolygon(2, 2, concave) && !pointInPolygon(5, 8, concave) && !pointInPolygon(11, 1, concave));
});

section('catalog index + rules', () => {
  const rc = ability('fx_rc_two', [], { cooldown: 0.5 });
  const cat = buildCatalog({
    fighters: [
      fighter('fx_fighter_a', {
        a1: ability('fx_rc_one', [], { recast: { window: 3, ability: rc } }),
        passive: passive('fx_formed', [], { forms: { fx_form_x: { name: 'X', kit: { a2: ability('fx_form_a2', []) } } } }),
      }),
      fighter('fx_fighter_b'),
    ],
    // QueueDef.rules is a shallow partial: nested objects are complete, optional nested keys survive the deep merge
    rules: { respawn: { base: 6, perLevel: 2, max: 50, lateGameRampAt: 1500 } },
    queueRules: { startGold: 999, respawn: { base: 1, perLevel: 3, max: 40 }, abilityRanks: { basicMax: 5, ultLevels: [3] } },
  });
  const idx = indexCatalog(cat);
  check('index: fighters/units/items/spells/boons', idx.fighters.has('fx_fighter_a') && idx.units.has('fx_tower') &&
    idx.items.has('fx_item_sword') && idx.spells.has('fx_spell_blink') && idx.boons.has('fx_boon_a'));
  check('index: modes/queues/maps/resources/teamBuffs', idx.modes.has('fx_mode') && idx.queues.has('fx_queue') && idx.maps.has('fx_map') &&
    idx.resources.has('fx_heat') && idx.teamBuffs.has('fx_teambuff'));
  check('index: abilities include recast + form kits + spells', idx.abilities.has('fx_rc_two') && idx.abilities.has('fx_form_a2') && idx.abilities.has('fx_spell_heal'));
  check('index: passives include boons', idx.passives.has('fx_boon_a') && idx.passives.has('fx_formed'));
  const r = resolveRules(idx, 'fx_mode', 'fx_queue');
  check('rules: queue scalar overrides', r.startGold === 999);
  check('rules: nested objects deep-merge (optional mode keys survive)', r.respawn.base === 1 && r.respawn.perLevel === 3 && r.respawn.max === 40 && r.respawn.lateGameRampAt === 1500, r.respawn);
  check('rules: arrays replace', r.abilityRanks.ultLevels.join() === '3' && r.abilityRanks.basicMax === 5);
  check('rules: untouched keys come from the mode', r.maxLevel === 18 && r.end.kind === 'core');
  check('rules: mode record not mutated', cat.modes[0].rules.startGold === 500);
  const m = deepMerge({ a: { b: 1, c: [1, 2] }, d: 1 }, { a: { c: [9] }, e: 2 });
  check('deepMerge', JSON.stringify(m) === JSON.stringify({ a: { b: 1, c: [9] }, d: 1, e: 2 }));
  let threw = false;
  try { resolveRules(idx, 'fx_mode', 'nope'); } catch { threw = true; }
  check('rules: unknown queue throws', threw);
});

finish('probe_sim_core_rng_math');
