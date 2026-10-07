// probe (lane SIM): every op in EffectT, scaling resolution, anchors, and the events each emits.
import { Effect, type EffectT } from '../src/contracts/catalog.ts';
import type { SimEvent } from '../src/contracts/sim.ts';
import { buildCatalog, fighter, item, passive } from './fixtures/catalog_fixture.ts';
import { addUnit, check, fighterEnt, finish, makeWorld, near, ofType, section, stepN, stepSec } from './fixtures/sim_fixture.ts';
import { equipItem } from '../src/sim/abilities.ts';
import { makeCtx, resolveScaling, runEffects } from '../src/sim/effects.ts';
import type { Entity, SourceRef } from '../src/sim/entity.ts';
import { register, unregister } from '../src/sim/scripts/index.ts';
import { addCounter, applyMark, applyStatus, counterValue, hasStatus, markStacks, setForm } from '../src/sim/status.ts';
import type { World } from '../src/sim/world.ts';
import { issueMove } from '../src/sim/movement.ts';

const cat = buildCatalog({
  fighters: [
    fighter('fx_fighter_a', {
      base: { ad: 100, ap: 50, hp: 1000, attackSpeed: 1, moveSpeed: 3.5 },
      passive: passive('fx_formful', [], { forms: { fx_form_y: { name: 'Y', stats: { armor: 10 } } } }),
    }),
    fighter('fx_fighter_b', { base: { hp: 1000, moveSpeed: 3.5 } }),
  ],
  items: [item('fx_item_sword', { stats: { ad: 20 } })],
});
const E = (x: Record<string, unknown>): EffectT => Effect.parse(x);
const SRC: SourceRef = { kind: 'ability', id: 'fx_probe_ability' };

interface RunOpts { target?: Entity | null; px?: number; py?: number; rank?: number; present?: Record<string, unknown> }
function run(w: World, a: Entity, effs: Record<string, unknown>[], o: RunOpts = {}): SimEvent[] {
  const t = o.target ?? null;
  const ctx = makeCtx(a, SRC, o.rank ?? 1, t, o.px ?? (t ? t.x : a.x + 1), o.py ?? (t ? t.y : a.y), o.present as never, 'a1');
  const n = w.events.length;
  runEffects(w, effs.map(E), ctx);
  return w.events.slice(n);
}
function world(): { w: World; a: Entity; b: Entity } {
  const w = makeWorld(cat, [{ fighter: 'fx_fighter_a', team: 0, x: 10, y: 20 }, { fighter: 'fx_fighter_b', team: 1, x: 14, y: 20 }]);
  return { w, a: fighterEnt(w, 0), b: fighterEnt(w, 1) };
}
const dmgTo = (evs: SimEvent[], id: number) => ofType(evs, 'damage').filter((d) => d.dst === id);

section('scaling', () => {
  const { w, a, b } = world();
  equipItem(w, a, 0, 'fx_item_sword');
  stepN(w, 1);
  const ctx = makeCtx(a, SRC, 2, b, b.x, b.y, undefined, null);
  check('scalar', resolveScaling(42, ctx, b) === 42);
  check('ranked base by rank', resolveScaling({ base: [10, 20, 30] }, ctx, b) === 20);
  check('ranked arrays shorter than the rank repeat the last value', resolveScaling({ base: [10, 20] }, { ...ctx, rank: 5 }, b) === 20);
  check('ad / bonusAd / ap ratios use the caster', near(resolveScaling({ base: 0, ad: 0.5, bonusAd: 1, ap: 0.2 }, ctx, b), 0.5 * 120 + 20 + 10));
  check('maxHp / level ratios', near(resolveScaling({ base: 0, maxHp: 0.1, level: 3 }, ctx, b), 100 + 3));
  b.hp = 600;
  check('target* ratios use the target', near(resolveScaling({ base: 0, targetMaxHp: 0.1, targetMissingHp: 0.5, targetCurrentHp: 0.1 }, ctx, b), 100 + 200 + 60));
  addCounter(a, 'fx_c', 3);
  check('perCounter multiplies by stacks × per', near(resolveScaling({ base: 10, perCounter: { counter: 'fx_c', per: 2 } }, ctx, b), 60));
  applyMark(w, a, b, 'fx_m', 5, 2, 5);
  check('perMark multiplies by target stacks × per', near(resolveScaling({ base: 10, perMark: { mark: 'fx_m', per: 1 } }, ctx, b), 20));
});

section('damage / heal / shield / status / buff', () => {
  const { w, a, b } = world();
  let ev = run(w, a, [{ op: 'damage', amount: { base: [30, 60] }, type: 'true' }], { target: b, rank: 2 });
  check('damage to hit (= unit target)', dmgTo(ev, b.id).length === 1 && near(dmgTo(ev, b.id)[0].amount, 60));
  ev = run(w, a, [{ op: 'damage', amount: 25, type: 'true', to: 'self' }], { target: b });
  check('damage to self', dmgTo(ev, a.id).length === 1);
  a.hp = 500;
  ev = run(w, a, [{ op: 'heal', amount: { base: 10, ap: 1 } }]);
  check('heal (default to self) + event', ofType(ev, 'heal').some((h) => h.dst === a.id && near(h.amount, 60)));
  ev = run(w, a, [{ op: 'shield', amount: 80, duration: [1, 2], to: 'target' }], { target: b, rank: 2 });
  check('shield to target + event, ranked duration', ofType(ev, 'shield').some((s) => s.dst === b.id && near(s.amount, 80)) && near(b.shields[0].remaining, 2));
  ev = run(w, a, [{ op: 'status', status: 'slow', duration: [1, 3], power: [0.2, 0.4] }], { target: b, rank: 2 });
  check('status with ranked duration/power + event', ofType(ev, 'status').some((s) => s.status === 'slow' && near(s.duration, 3)) && near(b.slowPow, 0.4));
  run(w, a, [{ op: 'buff', id: 'fx_buff', duration: 2, stats: { armor: 25 }, to: 'self' }]);
  stepN(w, 1);
  check('buff op applies stats', near(a.stats.armor, 25));
});

section('projectile', () => {
  const { w, a, b } = world();
  const m1 = addUnit(w, 'fx_dummy', 1, 13, 20), m2 = addUnit(w, 'fx_dummy', 1, 16, 20);
  b.x = 30; b.y = 55; // out of the way
  let ev = run(w, a, [{ op: 'projectile', speed: 30, range: 12, width: 0.6, pierce: 0, onHit: [{ op: 'damage', amount: 10, type: 'true' }],
    onEnd: [{ op: 'area', shape: { kind: 'circle', radius: 0.5 }, at: 'end', onHit: [] }], present: { vfx: 'fx_vfx' } }], { px: 20, py: 20 });
  check('projectile event (+ vfx) and entity', ofType(ev, 'projectile').length === 1 && ofType(ev, 'projectile')[0].vfx === 'fx_vfx' &&
    w.entities.some((e) => e.kind === 'projectile'));
  ev = stepSec(w, 0.5);
  check('pierce 0: stops at the first unit in path order', dmgTo(ev, m1.id).length === 1 && dmgTo(ev, m2.id).length === 0);
  check('hit event from the projectile', ofType(ev, 'hit').some((h) => h.dst === m1.id && h.ability === 'fx_probe_ability'));
  const area = ofType(ev, 'area')[0];
  check('onEnd runs at the end point (contact point near the first unit)', area && Math.abs(area.x - (13 - 0.4 - 0.3)) < 0.35, area);
  check('projectile removed', !w.entities.some((e) => e.kind === 'projectile'));
  run(w, a, [{ op: 'projectile', speed: 30, range: 12, width: 0.6, pierce: 1, onHit: [{ op: 'damage', amount: 10, type: 'true' }] }], { px: 20, py: 20 });
  ev = stepSec(w, 0.6);
  check('pierce 1: passes through one, hits both', dmgTo(ev, m1.id).length === 1 && dmgTo(ev, m2.id).length === 1);
  // range: units beyond range are not hit
  run(w, a, [{ op: 'projectile', speed: 30, range: 2, width: 0.6, pierce: 5, onHit: [{ op: 'damage', amount: 10, type: 'true' }] }], { px: 20, py: 20 });
  ev = stepSec(w, 0.5);
  check('range limits the flight', dmgTo(ev, m1.id).length === 0);
  // returns
  run(w, a, [{ op: 'projectile', speed: 30, range: 5, width: 0.6, pierce: 9, returns: true, onHit: [{ op: 'damage', amount: 10, type: 'true' }] }], { px: 20, py: 20 });
  ev = stepSec(w, 1);
  check('returns: hits on the way out and back, ends at the caster', dmgTo(ev, m1.id).length === 2 && !w.entities.some((e) => e.kind === 'projectile'));
  // homing
  b.x = 18; b.y = 24;
  w.vision.update(w.entities, w.tick);
  run(w, a, [{ op: 'projectile', speed: 15, range: 30, width: 0.4, toward: 'target', homing: true, pierce: 0, onHit: [{ op: 'damage', amount: 7, type: 'true' }] }], { target: b });
  issueMove(w, b, 18, 30, false);
  ev = stepSec(w, 1.5);
  check('homing: follows a moving target and hits only it', dmgTo(ev, b.id).length === 1 && dmgTo(ev, m1.id).length === 0 && dmgTo(ev, m2.id).length === 0);
  // spread + count
  ev = run(w, a, [{ op: 'projectile', speed: 20, range: 5, width: 0.3, count: 3, spreadDeg: 60, pierce: 0, onHit: [] }], { px: 10, py: 30 });
  const ps = ofType(ev, 'projectile').map((p) => w.entity(p.id)!.facing);
  check('count 3 spread 60°: three projectiles fanned evenly', ps.length === 3 && near(ps[2] - ps[1], ps[1] - ps[0], 1e-9) && near(ps[2] - ps[0], Math.PI / 3, 1e-9));
  stepSec(w, 1);
  // stopAtWalls: unit behind the wall is not hit
  const behind = addUnit(w, 'fx_dummy', 1, 34, 20);
  a.x = 25; a.y = 20;
  run(w, a, [{ op: 'projectile', speed: 30, range: 15, width: 0.4, stopAtWalls: true, pierce: 5, onHit: [{ op: 'damage', amount: 5, type: 'true' }],
    onEnd: [{ op: 'heal', amount: 1, to: 'self' }] }], { px: 40, py: 20 });
  ev = stepSec(w, 1);
  check('stopAtWalls: ends at the wall, nothing behind is hit', dmgTo(ev, behind.id).length === 0 && !w.entities.some((e) => e.kind === 'projectile'));
  run(w, a, [{ op: 'projectile', speed: 30, range: 15, width: 0.4, pierce: 5, onHit: [{ op: 'damage', amount: 5, type: 'true' }] }], { px: 40, py: 20 });
  ev = stepSec(w, 1);
  check('without stopAtWalls it flies over walls', dmgTo(ev, behind.id).length === 1);
  // toward point ends at the point
  a.x = 10; a.y = 10;
  run(w, a, [{ op: 'projectile', speed: 30, range: 15, width: 0.4, toward: 'point', pierce: 0, onHit: [],
    onEnd: [{ op: 'area', shape: { kind: 'circle', radius: 0.5 }, at: 'end', onHit: [] }] }], { px: 14, py: 10 });
  ev = stepSec(w, 0.5);
  const end = ofType(ev, 'area')[0];
  check("toward 'point' ends at the aimed point", end && near(end.x, 14, 0.05) && near(end.y, 10, 0.05), end);
});

section('dash', () => {
  const { w, a, b } = world();
  b.x = 40; b.y = 55;
  let ev = run(w, a, [{ op: 'dash', mode: 'toPoint', distance: 3, speed: 15, onArrive: [{ op: 'area', shape: { kind: 'circle', radius: 1 }, at: 'end', onHit: [] }] }], { px: 20, py: 20 });
  const d = ofType(ev, 'dash')[0];
  check('dash event: from/to/duration, capped at distance', d && near(d.toX, 13) && near(d.toY, 20) && near(d.duration, 0.2));
  stepN(w, 3);
  check('dashing state', a.state === 'dash' && a.dash !== null);
  ev = stepSec(w, 0.3);
  check('arrives; onArrive runs at the end point', near(a.x, 13) && a.dash === null && ofType(ev, 'area').some((x) => near(x.x, 13)));
  // toTarget stops at the edge
  b.x = 20; b.y = 20; w.vision.update(w.entities, w.tick);
  run(w, a, [{ op: 'dash', mode: 'toTarget', distance: 10, speed: 20 }], { target: b });
  stepSec(w, 1);
  check('toTarget stops at the target edge', near(a.x, 20 - 1, 0.05) && near(a.y, 20, 0.05), [a.x, a.y]);
  // away from the target
  run(w, a, [{ op: 'dash', mode: 'away', distance: 4, speed: 20 }], { target: b });
  stepSec(w, 1);
  check('away: moves directly away', near(a.x, 15, 0.05), a.x);
  // direction
  run(w, a, [{ op: 'dash', mode: 'direction', distance: 2, speed: 20 }], { px: 15, py: 30 });
  stepSec(w, 0.5);
  check('direction: along the aim', near(a.x, 15, 0.05) && near(a.y, 22, 0.05), [a.x, a.y]);
  // behindTarget
  a.x = 15; a.y = 20;
  run(w, a, [{ op: 'dash', mode: 'behindTarget', distance: 8, speed: 30 }], { target: b });
  stepSec(w, 1);
  check('behindTarget: ends on the far side', a.x > b.x + 0.5 && near(a.y, 20, 0.05), [a.x, a.y]);
  // stops at walls
  a.x = 25; a.y = 20;
  run(w, a, [{ op: 'dash', mode: 'toPoint', distance: 10, speed: 30 }], { px: 35, py: 20 });
  stepSec(w, 1);
  check('dash stops at walls', a.x < 28 && a.x > 26.5 && w.nav.walkable(a.x, a.y), a.x);
  // unstoppable
  a.x = 10; a.y = 30;
  run(w, a, [{ op: 'dash', mode: 'toPoint', distance: 6, speed: 10, unstoppable: true }], { px: 16, py: 30 });
  stepN(w, 2);
  check('unstoppable dash: has the status, ignores stun', hasStatus(a, 'unstoppable') && !applyStatus(w, b, a, 'stun', 1));
  stepSec(w, 1);
  check('unstoppable dash completes', near(a.x, 16, 0.05) && !hasStatus(a, 'unstoppable'));
  // a normal dash is stopped by a stun
  run(w, a, [{ op: 'dash', mode: 'toPoint', distance: 6, speed: 10 }], { px: 10, py: 30 });
  stepN(w, 3);
  applyStatus(w, b, a, 'stun', 0.5);
  stepSec(w, 1);
  check('stun cancels a normal dash midway', a.x > 11 && a.x < 15.5, a.x);
  // onPass + passWidth, each unit once; stopOnFirstHit
  const { w: w2, a: a2, b: b2 } = world();
  b2.x = 50; b2.y = 55;
  const u1 = addUnit(w2, 'fx_dummy', 1, 13, 20.8), u2 = addUnit(w2, 'fx_dummy', 1, 15, 19.3), u3 = addUnit(w2, 'fx_dummy', 1, 16, 23);
  run(w2, a2, [{ op: 'dash', mode: 'toPoint', distance: 8, speed: 12, passWidth: 1, onPass: [{ op: 'damage', amount: 3, type: 'true' }] }], { px: 18, py: 20 });
  ev = stepSec(w2, 1);
  check('onPass hits units within passWidth once each', dmgTo(ev, u1.id).length === 1 && dmgTo(ev, u2.id).length === 1 && dmgTo(ev, u3.id).length === 0);
  check('onPass emits hit events', ofType(ev, 'hit').filter((h) => h.dst === u1.id || h.dst === u2.id).length === 2);
  a2.x = 10; a2.y = 20;
  run(w2, a2, [{ op: 'dash', mode: 'toPoint', distance: 8, speed: 12, passWidth: 1, stopOnFirstHit: true, onPass: [{ op: 'damage', amount: 3, type: 'true' }],
    onArrive: [{ op: 'heal', amount: 1, to: 'self' }] }], { px: 18, py: 20 });
  ev = stepSec(w2, 1);
  check('stopOnFirstHit: stops at the first unit', dmgTo(ev, u1.id).length === 1 && dmgTo(ev, u2.id).length === 0 && a2.x < 13 && a2.dash === null, a2.x);
});

section('blink', () => {
  const { w, a, b } = world();
  let ev = run(w, a, [{ op: 'blink', distance: 4 }], { px: 20, py: 20 });
  const bl = ofType(ev, 'blink')[0];
  check('blink: capped at distance + event', bl && near(bl.toX, 14) && near(a.x, 14) && near(bl.fromX, 10));
  b.x = 20; b.y = 20;
  run(w, a, [{ op: 'blink', distance: 8, to: 'behindTarget' }], { target: b });
  check('blink behindTarget', a.x > 20.5 && near(a.y, 20));
  a.x = 25; a.y = 20;
  ev = run(w, a, [{ op: 'blink', distance: 5 }], { px: 30, py: 20 });
  check('blink into a wall lands on the nearest walkable cell', w.nav.walkable(a.x, a.y) && Math.abs(a.x - 30) < 3, [a.x, a.y]);
});

section('area', () => {
  const { w, a, b } = world();
  b.x = 50; b.y = 55;
  const near1 = addUnit(w, 'fx_dummy', 1, 12, 20), far1 = addUnit(w, 'fx_dummy', 1, 15, 20), side = addUnit(w, 'fx_dummy', 1, 10, 23);
  const ally = addUnit(w, 'fx_dummy', 0, 11, 21);
  let ev = run(w, a, [{ op: 'area', shape: { kind: 'circle', radius: 3 }, at: 'self', onHit: [{ op: 'damage', amount: 1, type: 'true' }],
    onCenter: [{ op: 'heal', amount: 5, to: 'self' }], present: { telegraph: 'ally_only', vfx: 'fx_vfx' } }]);
  check('circle: enemies within radius only (filter default enemies)', dmgTo(ev, near1.id).length === 1 && dmgTo(ev, side.id).length === 1 &&
    dmgTo(ev, far1.id).length === 0 && dmgTo(ev, ally.id).length === 0);
  const ar = ofType(ev, 'area')[0];
  check('area event with shape + telegraph from present', ar && ar.shape?.kind === 'circle' && ar.telegraph === 'ally_only' && ar.vfx === 'fx_vfx');
  ev = run(w, a, [{ op: 'area', shape: { kind: 'ring', radius: 5.6, inner: 4 }, at: 'self', onHit: [{ op: 'damage', amount: 1, type: 'true' }] }]);
  check('ring: excludes the inner radius', dmgTo(ev, far1.id).length === 1 && dmgTo(ev, near1.id).length === 0);
  ev = run(w, a, [{ op: 'area', shape: { kind: 'cone', radius: 6, angleDeg: 40 }, at: 'self', onHit: [{ op: 'damage', amount: 1, type: 'true' }] }], { px: 20, py: 20 });
  check('cone: along aim only', dmgTo(ev, near1.id).length === 1 && dmgTo(ev, far1.id).length === 1 && dmgTo(ev, side.id).length === 0);
  ev = run(w, a, [{ op: 'area', shape: { kind: 'rect', length: 3, width: 1 }, at: 'self', onHit: [{ op: 'damage', amount: 1, type: 'true' }] }], { px: 20, py: 20 });
  check('rect: anchored at the caster along the aim', dmgTo(ev, near1.id).length === 1 && dmgTo(ev, far1.id).length === 0);
  ev = run(w, a, [{ op: 'area', shape: { kind: 'circle', radius: 8 }, at: 'self', maxTargets: 2, onHit: [{ op: 'damage', amount: 1, type: 'true' }] }]);
  check('maxTargets keeps the nearest', ofType(ev, 'damage').length === 2 && dmgTo(ev, far1.id).length === 0);
  ev = run(w, a, [{ op: 'area', shape: { kind: 'circle', radius: 3 }, at: 'self', filter: { allies: true, enemies: false }, onHit: [{ op: 'damage', amount: 1, type: 'true' }] }]);
  check('filter allies only', dmgTo(ev, ally.id).length === 1 && dmgTo(ev, near1.id).length === 0);
  ev = run(w, a, [{ op: 'area', shape: { kind: 'circle', radius: 1.5 }, at: 'point', delay: 0.5, onHit: [{ op: 'damage', amount: 1, type: 'true' }] }], { px: 15, py: 20 });
  check('delayed area: telegraphed now (everyone by default), no hit yet', ofType(ev, 'area')[0].telegraph === 'everyone' && near(ofType(ev, 'area')[0].delay, 0.5) &&
    ofType(ev, 'damage').length === 0);
  far1.x = 15; far1.y = 20;
  ev = stepSec(w, 0.6);
  check('delayed area resolves at the snapshotted point', dmgTo(ev, far1.id).length === 1);
});

section('zone', () => {
  const { w, a, b } = world();
  b.x = 50; b.y = 55;
  const u = addUnit(w, 'fx_dummy', 1, 15, 20);
  let ev = run(w, a, [{ op: 'zone', id: 'fx_zone', shape: { kind: 'circle', radius: 2 }, at: 'point', duration: 2, interval: 0.5,
    onTick: [{ op: 'damage', amount: 1, type: 'true' }], onEnter: [{ op: 'damage', amount: 100, type: 'true' }],
    onExpire: [{ op: 'heal', amount: 9, to: 'self' }] }], { px: 15, py: 20 });
  const z = w.entities.find((e) => e.kind === 'zone')!;
  check('zone entity (def = zone id, shape)', z && z.def === 'fx_zone' && z.shape?.kind === 'circle');
  a.hp = 500;
  ev = ev.concat(stepSec(w, 2.2));
  const ticks = dmgTo(ev, u.id).filter((d) => near(d.amount, 1)).length;
  const enters = dmgTo(ev, u.id).filter((d) => near(d.amount, 100)).length;
  check('interval ticks: duration/interval = 4 ticks', ticks === 4, ticks);
  check('onEnter once while staying inside', enters === 1, enters);
  check('onExpire runs; zone removed', ofType(ev, 'heal').some((h) => near(h.amount, 9)) && !w.entities.some((e) => e.kind === 'zone'));
  // follow
  run(w, a, [{ op: 'zone', id: 'fx_aura', shape: { kind: 'circle', radius: 1 }, at: 'self', follow: true, duration: 3, interval: 1, onTick: [] }]);
  issueMove(w, a, 10, 30, false);
  stepSec(w, 1);
  const aura = w.entities.find((e) => e.def === 'fx_aura')!;
  check('follow keeps the zone on its anchor unit', near(aura.x, a.x) && near(aura.y, a.y));
  // re-entry fires onEnter again; delay
  const { w: w2, a: a2, b: b2 } = world();
  b2.x = 50; b2.y = 55;
  const mover = addUnit(w2, 'fx_minion', 1, 12, 25);
  let ev2 = run(w2, a2, [{ op: 'zone', id: 'fx_z2', shape: { kind: 'circle', radius: 1.5 }, at: 'point', delay: 0.5, duration: 6, interval: 5,
    onTick: [], onEnter: [{ op: 'damage', amount: 1, type: 'true' }] }], { px: 15, py: 25 });
  ev2 = ev2.concat(stepSec(w2, 0.4));
  check('delayed zone is inert during its delay', ofType(ev2, 'damage').length === 0);
  issueMove(w2, mover, 20, 25, false);
  ev2 = stepSec(w2, 3);
  issueMove(w2, mover, 12, 25, false);
  ev2 = ev2.concat(stepSec(w2, 3));
  check('onEnter fires on each entry', dmgTo(ev2, mover.id).length === 2, dmgTo(ev2, mover.id).length);
  // blocks enemies
  const { w: w3, a: a3, b: b3 } = world();
  run(w3, a3, [{ op: 'zone', id: 'fx_wall', shape: { kind: 'circle', radius: 1.5 }, at: 'point', duration: 5, interval: 5, onTick: [], blocks: 'enemies' }], { px: 18, py: 20 });
  issueMove(w3, b3, 22, 20, false);
  stepSec(w3, 3);
  check('blocks: enemies cannot enter', b3.x < 18 - 1.5, b3.x);
  issueMove(w3, a3, 22, 20, false);
  stepSec(w3, 5);
  check('blocks enemies only: allies pass', a3.x > 19.5, a3.x);
});

section('displace', () => {
  const { w, a, b } = world();
  let ev = run(w, a, [{ op: 'displace', mode: 'knockback', distance: 3, duration: 0.3 }], { target: b });
  check('knockback: dash event for the victim + airborne', ofType(ev, 'dash').some((d) => d.src === b.id) && hasStatus(b, 'airborne'));
  stepN(w, 3);
  check('airborne arc height while displaced', b.height > 0.3);
  stepSec(w, 0.5);
  check('knockback distance away from the caster', near(b.x, 17, 0.05) && b.height === 0, b.x);
  run(w, a, [{ op: 'displace', mode: 'pull', distance: 10, duration: 0.3 }], { target: b });
  stepSec(w, 0.5);
  check('pull: to the caster edge', near(b.x, 11, 0.05), b.x);
  run(w, a, [{ op: 'displace', mode: 'toward_point', distance: 2, duration: 0.3 }], { target: b, px: 11, py: 30 });
  stepSec(w, 0.5);
  check('toward_point: up to distance toward the point', near(b.x, 11, 0.05) && near(b.y, 22, 0.05), [b.x, b.y]);
  const y0 = b.y;
  run(w, a, [{ op: 'displace', mode: 'airborne_in_place', distance: 0, duration: 0.6 }], { target: b });
  stepN(w, 2);
  check('airborne_in_place: no movement, cannot act', near(b.y, y0) && hasStatus(b, 'airborne'));
  stepSec(w, 1);
  b.x = 26; b.y = 20; a.x = 23; a.y = 20;
  run(w, a, [{ op: 'displace', mode: 'knockback', distance: 6, duration: 0.3 }], { target: b });
  stepSec(w, 0.5);
  check('knockback stops at walls', b.x < 28 && w.nav.walkable(b.x, b.y), b.x);
  applyStatus(w, b, b, 'unstoppable', 2);
  const bx = b.x;
  run(w, a, [{ op: 'displace', mode: 'knockback', distance: 3, duration: 0.3 }], { target: b });
  stepSec(w, 0.5);
  check('unstoppable ignores displacement', near(b.x, bx));
});

section('summon', () => {
  const { w, a } = world();
  run(w, a, [{ op: 'summon', unit: 'fx_summon', count: 2, duration: 1, at: 'self' }]);
  const s = w.entities.filter((e) => e.def === 'fx_summon' && e.alive);
  check('summon: count, team, owner', s.length === 2 && s.every((x) => x.team === a.team && x.ownerEid === a.id && x.owner === a.owner && x.kind === 'summon'));
  const ev = stepSec(w, 1.1);
  check('summon lifetime: dies when it runs out (no killer)', w.entities.filter((e) => e.def === 'fx_summon' && e.alive).length === 0 &&
    ofType(ev, 'death').filter((d) => d.killer === -1).length === 2);
  for (let i = 0; i < 3; i++) run(w, a, [{ op: 'summon', unit: 'fx_summon', count: 1, duration: 10, at: 'self', maxAlive: 2 }]);
  const alive = w.entities.filter((e) => e.def === 'fx_summon' && e.alive);
  check('maxAlive kills the oldest', alive.length === 2 && alive[0].id > s[1].id + 1, alive.map((x) => x.id));
});

section('resource / cooldown / mark / consumeMark / counter', () => {
  const { w, a, b } = world();
  a.res = 100;
  run(w, a, [{ op: 'resource', amount: 50 }]);
  check('resource adds', near(a.res, 150));
  run(w, a, [{ op: 'resource', amount: 1e6 }]);
  check('resource clamps to max', near(a.res, a.maxRes));
  for (let i = 0; i < 4; i++) a.slots[i]!.cooldown = 10;
  run(w, a, [{ op: 'cooldown', slot: 'a2', seconds: 4 }]);
  check('cooldown: slot by seconds', near(a.slots[1]!.cooldown, 6) && near(a.slots[0]!.cooldown, 10));
  run(w, a, [{ op: 'cooldown', slot: 'all_abilities', percent: 0.5 }]);
  check('cooldown: all abilities by percent of remaining', near(a.slots[0]!.cooldown, 5) && near(a.slots[1]!.cooldown, 3) && near(a.slots[3]!.cooldown, 5));
  run(w, a, [{ op: 'mark', mark: 'fx_mk', duration: 4, stacks: 2, max: 3 }], { target: b });
  run(w, a, [{ op: 'mark', mark: 'fx_mk', duration: 4, stacks: 2, max: 3 }], { target: b });
  check('mark op stacks to max', markStacks(b, 'fx_mk', a) === 3);
  const ev = run(w, a, [{ op: 'consumeMark', mark: 'fx_mk', perStack: [{ op: 'damage', amount: 4, type: 'true' }] }], { target: b });
  check('consumeMark: perStack runs per stack and removes the mark', dmgTo(ev, b.id).length === 3 && markStacks(b, 'fx_mk', a) === 0);
  run(w, a, [{ op: 'counter', counter: 'fx_ct', add: 2, max: 3 }, { op: 'counter', counter: 'fx_ct', add: 2 }]);
  check('counter op', counterValue(a, 'fx_ct') === 3);
  run(w, a, [{ op: 'counter', counter: 'fx_ct', add: 1, reset: true, duration: 0.5 }]);
  stepSec(w, 0.6);
  check('counter op reset + duration', counterValue(a, 'fx_ct') === 0);
});

section('if + every condition', () => {
  const { w, a, b } = world();
  const ok = (cond: Record<string, unknown>, opts: RunOpts = { target: b }): boolean => {
    const ev = run(w, a, [{ op: 'if', cond, then: [{ op: 'counter', counter: 'fx_yes', add: 1 }], else: [{ op: 'counter', counter: 'fx_no', add: 1 }] }], opts);
    void ev;
    const y = counterValue(a, 'fx_yes');
    addCounter(a, 'fx_yes', 0, undefined, undefined, true); addCounter(a, 'fx_no', 0, undefined, undefined, true);
    return y === 1;
  };
  b.hp = 200;
  check('targetHpBelow', ok({ kind: 'targetHpBelow', pct: 0.3 }) && !ok({ kind: 'targetHpBelow', pct: 0.1 }));
  a.hp = 900;
  check('selfHpBelow', ok({ kind: 'selfHpBelow', pct: 0.95 }) && !ok({ kind: 'selfHpBelow', pct: 0.5 }));
  applyMark(w, a, b, 'fx_q', 5, 2, 5);
  check('targetHasMark (min)', ok({ kind: 'targetHasMark', mark: 'fx_q' }) && ok({ kind: 'targetHasMark', mark: 'fx_q', min: 2 }) && !ok({ kind: 'targetHasMark', mark: 'fx_q', min: 3 }));
  applyStatus(w, a, b, 'slow', 3);
  check('targetHasStatus', ok({ kind: 'targetHasStatus', status: 'slow' }) && !ok({ kind: 'targetHasStatus', status: 'stun' }));
  addCounter(a, 'fx_k', 4);
  check('counterAtLeast', ok({ kind: 'counterAtLeast', counter: 'fx_k', n: 4 }) && !ok({ kind: 'counterAtLeast', counter: 'fx_k', n: 5 }));
  check('targetIs (filter)', ok({ kind: 'targetIs', filter: { fighters: true } }) && !ok({ kind: 'targetIs', filter: { fighters: false } }) &&
    !ok({ kind: 'targetIs', filter: { enemies: false, allies: true } }));
  setForm(w, a, 'fx_form_y');
  check('inForm', ok({ kind: 'inForm', form: 'fx_form_y' }) && !ok({ kind: 'inForm', form: 'fx_other' }));
  check('chance 1 / 0', ok({ kind: 'chance', p: 1 }) && !ok({ kind: 'chance', p: 0 }));
  check('not / all / any', ok({ kind: 'not', cond: { kind: 'chance', p: 0 } }) &&
    ok({ kind: 'all', conds: [{ kind: 'chance', p: 1 }, { kind: 'inForm', form: 'fx_form_y' }] }) &&
    !ok({ kind: 'all', conds: [{ kind: 'chance', p: 1 }, { kind: 'chance', p: 0 }] }) &&
    ok({ kind: 'any', conds: [{ kind: 'chance', p: 0 }, { kind: 'chance', p: 1 }] }));
  const ev = run(w, a, [{ op: 'if', cond: { kind: 'chance', p: 0 }, then: [{ op: 'heal', amount: 1, to: 'self' }] }]);
  check('if without else is a no-op when false', ev.length === 0);
});

section('repeat / form / reveal / gold / script', () => {
  const { w, a, b } = world();
  let ev = run(w, a, [{ op: 'repeat', count: 3, interval: 0.5, effects: [{ op: 'damage', amount: 2, type: 'true' }] }], { target: b });
  check('repeat: first iteration immediately', dmgTo(ev, b.id).length === 1);
  const times: number[] = [];
  for (let i = 0; i < 40; i++) for (const e of w.step()) if (e.e === 'damage' && e.dst === b.id) times.push(e.t);
  check('repeat: the rest every interval', times.length === 2 && near(times[1] - times[0], 0.5, 1e-6), times);
  ev = run(w, a, [{ op: 'repeat', count: 4, interval: 0, effects: [{ op: 'damage', amount: 2, type: 'true' }] }], { target: b });
  check('repeat interval 0: all at once', dmgTo(ev, b.id).length === 4);
  run(w, a, [{ op: 'form', form: 'fx_form_y', duration: 1 }]);
  stepN(w, 1);
  check('form op (timed)', a.form === 'fx_form_y' && near(a.stats.armor, 10));
  stepSec(w, 1);
  check('form op reverts after duration', a.form === null);
  b.x = 50; b.y = 50;
  w.vision.update(w.entities, w.tick);
  check('enemy far away is hidden', (b.visibleMask & 1) === 0);
  ev = run(w, a, [{ op: 'reveal', duration: 2 }], { target: b });
  check('reveal: visible to the caster team at once', (b.visibleMask & 1) !== 0 && ofType(ev, 'status').some((s) => s.status === 'reveal'));
  stepSec(w, 0.5);
  check('reveal holds through vision rebuilds', (b.visibleMask & 1) !== 0);
  stepSec(w, 2);
  check('reveal expires', (b.visibleMask & 1) === 0);
  const g0 = w.players[0].gold;
  ev = run(w, a, [{ op: 'gold', amount: 75 }]);
  check('gold op credits the player + event', w.players[0].gold === g0 + 75 && ofType(ev, 'gold').some((g) => g.player === 0 && g.amount === 75));
  let seen: unknown = null;
  register('fx_probe_script', (_w, ctx, params) => { seen = { caster: ctx.caster.id, p: params.k }; });
  run(w, a, [{ op: 'script', id: 'fx_probe_script', params: { k: 3 } }]);
  check('script: registered behaviour runs with ctx + params', JSON.stringify(seen) === JSON.stringify({ caster: a.id, p: 3 }));
  ev = run(w, a, [{ op: 'script', id: 'fx_missing_script' }]);
  check('script: unknown id is a no-op at runtime', ev.length === 0);
  let dup = false;
  try { register('fx_probe_script', () => {}); } catch { dup = true; }
  check('script: duplicate registration throws', dup);
  unregister('fx_probe_script');
});

finish('probe_sim_core_effects');
