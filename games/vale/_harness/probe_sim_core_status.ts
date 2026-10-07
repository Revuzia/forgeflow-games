// probe (lane SIM): statuses + tenacity + CC rules, slow/haste stacking, taunt/fear/sleep,
// unstoppable/invisible/untargetable, buffs (stacks/refresh/expiry/onExpire/statScaling/empower),
// marks, counters, forms.
import { ability, buildCatalog, fighter, item, passive } from './fixtures/catalog_fixture.ts';
import { check, fighterEnt, finish, makeWorld, near, ofType, section, stepN, stepSec } from './fixtures/sim_fixture.ts';
import type { SimEvent } from '../src/contracts/sim.ts';
import { equipItem, tryCast } from '../src/sim/abilities.ts';
import { dealDamage } from '../src/sim/combat.ts';
import { makeCtx } from '../src/sim/effects.ts';
import type { EffOf, Entity } from '../src/sim/entity.ts';
import { issueAttack, issueMove } from '../src/sim/movement.ts';
import {
  addCounter, applyBuff, applyMark, applyStatus, canAct, canAttack, canCast, canMove, counterValue, findBuff, hasStatus, markStacks, setForm,
} from '../src/sim/status.ts';
import type { World } from '../src/sim/world.ts';
import type { EffectT } from '../src/contracts/catalog.ts';

const cat = buildCatalog({
  fighters: [
    fighter('fx_fighter_a', {
      base: { ad: 50, ap: 100, attackSpeed: 1, moveSpeed: 3.5 },
      a1: ability('fx_poke', [{ op: 'damage', amount: 10, type: 'true' }], { cooldown: 0, targeting: { kind: 'unit', range: 20 } }),
      a2: ability('fx_slow_cast', [], { cooldown: 0, castTime: 1 }),
      passive: passive('fx_shift', [], {
        forms: {
          fx_form_x: { name: 'X', stats: { ad: 30 }, attackRange: 6, kit: { a1: ability('fx_form_poke', [], { cooldown: 3 }) } },
        },
      }),
    }),
    fighter('fx_fighter_b', { base: { moveSpeed: 3.5 } }),
  ],
  items: [item('fx_item_ten', { stats: { tenacity: 0.5 } })],
});

function world(): { w: World; a: Entity; b: Entity } {
  const w = makeWorld(cat, [{ fighter: 'fx_fighter_a', team: 0, x: 10, y: 10 }, { fighter: 'fx_fighter_b', team: 1, x: 12, y: 10 }]);
  const a = fighterEnt(w, 0), b = fighterEnt(w, 1);
  for (let i = 0; i < 4; i++) { a.slots[i]!.rank = 1; b.slots[i]!.rank = 1; }
  return { w, a, b };
}
function capture(w: World, fn: () => void): SimEvent[] { const n = w.events.length; fn(); return w.events.slice(n); }
function buffEff(o: Record<string, unknown>): EffOf<'buff'> { return { op: 'buff', to: 'self', ...o } as EffOf<'buff'>; }

section('hard CC + gates', () => {
  const { w, a, b } = world();
  const ev = capture(w, () => applyStatus(w, a, b, 'stun', 1));
  check('status event', ofType(ev, 'status').some((s) => s.dst === b.id && s.status === 'stun' && near(s.duration, 1)));
  check('stun: cannot act/move/attack/cast', !canAct(b) && !canMove(b) && !canAttack(b) && !canCast(b, 'spell'));
  issueMove(w, b, 20, 10, false);
  const x0 = b.x;
  stepN(w, 10);
  check('stun: does not move', near(b.x, x0) && b.state === 'stunned', { x: b.x, state: b.state });
  check('stun: cast refused', tryCast(w, b, 0, undefined, undefined, a.id) === 'cc');
  stepSec(w, 1);
  check('stun expires; movement resumes the order', !hasStatus(b, 'stun') && b.x > x0 + 0.5);
  // root
  applyStatus(w, a, b, 'root', 1);
  check('root: cannot move, can attack + cast', !canMove(b) && canAttack(b) && canCast(b, 'ability'));
  // silence
  applyStatus(w, a, b, 'silence', 1);
  check('silence: abilities refused, spells allowed', tryCast(w, b, 0, undefined, undefined, a.id) === 'silenced' && canCast(b, 'spell') &&
    tryCast(w, b, 5) === 'ok');
  // disarm
  applyStatus(w, b, a, 'disarm', 1);
  issueAttack(w, a, b);
  const e2 = stepN(w, 10);
  check('disarm: no attacks, can still move', ofType(e2, 'attack').filter((x) => x.src === a.id).length === 0 && canMove(a));
});

section('tenacity', () => {
  const { w, a, b } = world();
  equipItem(w, b, 0, 'fx_item_ten');
  stepN(w, 1);
  applyStatus(w, a, b, 'stun', 2);
  const st = b.statuses.find((s) => s.kind === 'stun')!;
  check('tenacity 0.5 halves a hostile stun', near(st.remaining, 1));
  applyStatus(w, a, b, 'airborne', 2);
  check('tenacity does not shorten airborne', near(b.statuses.find((s) => s.kind === 'airborne')!.remaining, 2));
  applyStatus(w, b, b, 'slow', 2, { power: 0.3 });
  check('tenacity only applies to hostile sources', near(b.statuses.find((s) => s.kind === 'slow')!.remaining, 2));
});

section('slow / haste stacking + decay', () => {
  const { w, a, b } = world();
  const ms0 = b.stats.moveSpeed;
  applyStatus(w, a, b, 'slow', 3, { power: 0.3 });
  applyStatus(w, b, b, 'slow', 3, { power: 0.5 });
  stepN(w, 1);
  check('two slows: only the strongest applies', near(b.slowPow, 0.5) && near(b.stats.moveSpeed, ms0 * 0.5, 1e-9), b.stats.moveSpeed);
  applyStatus(w, b, b, 'haste', 3, { power: 0.1 });
  applyStatus(w, a, b, 'haste', 3, { power: 0.2 });
  stepN(w, 1);
  check('hastes add: ms × (1 + 0.3) × (1 − 0.5)', near(b.stats.moveSpeed, ms0 * 1.3 * 0.5, 1e-9), b.stats.moveSpeed);
  const { w: w2, a: a2, b: b2 } = world();
  applyStatus(w2, a2, b2, 'slow', 2, { power: 0.6, decay: true });
  stepSec(w2, 1);
  check('decaying slow fades linearly (≈ half power at half time)', Math.abs(b2.slowPow - 0.3) < 0.03, b2.slowPow);
  stepSec(w2, 1.1);
  check('slow gone after its duration, speed restored', b2.slowPow === 0 && near(b2.stats.moveSpeed, ms0));
});

section('taunt / fear / sleep', () => {
  const { w, a, b } = world();
  b.x = 11.5; b.y = 10;
  issueMove(w, b, 20, 20, false);
  applyStatus(w, a, b, 'taunt', 1.5);
  const ev = stepSec(w, 1.4);
  check('taunt: victim attacks the taunter', ofType(ev, 'attack').some((x) => x.src === b.id && x.dst === a.id));
  check('taunt: no casting', tryCast(w, b, 0, undefined, undefined, a.id) === 'cc');
  const { w: w2, a: a2, b: b2 } = world();
  const d0 = Math.hypot(b2.x - a2.x, b2.y - a2.y);
  applyStatus(w2, a2, b2, 'fear', 1);
  stepSec(w2, 0.9);
  check('fear: walks away from the source', Math.hypot(b2.x - a2.x, b2.y - a2.y) > d0 + 1.5);
  check('fear: no attacks', !canAttack(b2));
  applyStatus(w2, a2, b2, 'sleep', 5);
  check('sleep: cannot act', !canAct(b2));
  dealDamage(w2, a2, b2, 1, 'true');
  check('sleep breaks on damage', !hasStatus(b2, 'sleep') && canAct(b2));
});

section('unstoppable / invisible / untargetable / interrupts', () => {
  const { w, a, b } = world();
  applyStatus(w, a, b, 'stun', 3);
  applyStatus(w, b, b, 'unstoppable', 1);
  check('unstoppable cleanses stun', !hasStatus(b, 'stun') && canAct(b));
  check('unstoppable ignores new stun/root', !applyStatus(w, a, b, 'stun', 1) && !applyStatus(w, a, b, 'root', 1));
  check('unstoppable does not stop slows', applyStatus(w, a, b, 'slow', 1, { power: 0.2 }));
  applyStatus(w, b, b, 'untargetable', 1);
  check('untargetable: unit casts on it refused', !b.targetable && tryCast(w, a, 0, undefined, undefined, b.id) === 'target');
  const { w: w2, a: a2, b: b2 } = world();
  applyStatus(w2, b2, b2, 'invisible', 5);
  w2.vision.update(w2.entities, w2.tick);
  check('invisible: hidden from the enemy team', (b2.visibleMask & 1) === 0);
  b2.autoAttack = true;
  b2.x = 11; // in range of a
  const ev = stepSec(w2, 0.2);
  check('invisible breaks when attacking', ofType(ev, 'attack').some((x) => x.src === b2.id) && !hasStatus(b2, 'invisible'));
  // stun cancels a windup; nothing spent
  const { w: w3, a: a3, b: b3 } = world();
  check('windup starts', tryCast(w3, a3, 1) === 'ok' && a3.cast !== null);
  stepN(w3, 5);
  applyStatus(w3, b3, a3, 'stun', 0.5);
  check('stun cancels the windup and no cooldown starts', a3.cast === null && a3.slots[1]!.cooldown === 0);
});

section('buffs', () => {
  const { w, a, b } = world();
  const ctx = makeCtx(a, { kind: 'ability', id: 'fx_test' }, 1, a, a.x, a.y, undefined, null);
  const ad0 = a.stats.ad;
  applyBuff(w, a, buffEff({ id: 'fx_b1', duration: 2, stats: { ad: 50 } }), ctx);
  stepN(w, 1);
  check('buff stats apply', near(a.stats.ad, ad0 + 50));
  stepSec(w, 1.5);
  applyBuff(w, a, buffEff({ id: 'fx_b1', duration: 2, stats: { ad: 50 } }), ctx);
  const bf = findBuff(a, 'fx_b1')!;
  check('re-application refreshes (no new entry, stacks stay 1)', a.buffs.length === 1 && bf.stacks === 1 && near(bf.remaining, 2));
  for (let i = 0; i < 4; i++) applyBuff(w, a, buffEff({ id: 'fx_b2', duration: 3, stats: { ad: 10 }, maxStacks: 3 }), ctx);
  stepN(w, 1);
  check('maxStacks: stacks cap at 3, stats per stack', findBuff(a, 'fx_b2')!.stacks === 3 && near(a.stats.ad, ad0 + 50 + 30));
  stepSec(w, 3.1);
  check('buffs expire and stats revert', a.buffs.length === 0 && near(a.stats.ad, ad0));
  // onExpire + statScaling
  a.hp = 100;
  const onExpire: EffectT[] = [{ op: 'heal', amount: 77, to: 'self' }];
  applyBuff(w, a, buffEff({ id: 'fx_b3', duration: 1, onExpire, statScaling: { ad: { base: 5, ap: 0.5 } } }), ctx);
  stepN(w, 1);
  check('statScaling resolves from the caster (5 + 0.5 × 100 ap)', near(a.stats.ad, ad0 + 55));
  const ev = stepSec(w, 1);
  check('onExpire runs when the timer ends', ofType(ev, 'heal').some((h) => h.dst === a.id && near(h.amount, 77)));
  // buff on another unit via `to`
  applyBuff(w, b, buffEff({ id: 'fx_b4', duration: 1, stats: { armor: 40 } }), ctx);
  stepN(w, 1);
  check('buff on another unit', near(b.stats.armor, 40) && findBuff(b, 'fx_b4')!.source === 'fx_test');
});

section('empowered attacks', () => {
  const { w, a, b } = world();
  const ctx = makeCtx(a, { kind: 'ability', id: 'fx_emp' }, 1, a, a.x, a.y, undefined, null);
  b.x = 10 + 1.5 + 1 + 2; // out of melee range (1.5 + radii 1.0), inside range + bonus 3
  const r0 = a.stats.range;
  a.atkCd = 5;
  applyBuff(w, a, buffEff({ id: 'fx_emp', duration: 10, empowerAttacks: { count: 2, effects: [{ op: 'damage', amount: 40, type: 'true', to: 'hit' }], rangeBonus: 3, resetAttack: true } }), ctx);
  check('resetAttack resets the attack timer', a.atkCd === 0);
  issueAttack(w, a, b);
  applyStatus(w, b, a, 'root', 0.5); // rooted: only the range bonus can make this attack connect
  let ev = stepSec(w, 0.4);
  const dmg = ofType(ev, 'damage').filter((d) => d.dst === b.id);
  check('rangeBonus lets it attack from further away; empowered effect lands', ofType(ev, 'attack').length === 1 &&
    dmg.some((d) => near(d.amount, 40)) && dmg.some((d) => near(d.amount, a.stats.ad)) && near(a.x, 10), { dmg, r0, x: a.x });
  check('one charge consumed', findBuff(a, 'fx_emp')!.empowerLeft === 1);
  ev = stepSec(w, 1.1);
  check('second attack consumes the buff', findBuff(a, 'fx_emp') === null);
  ev = stepSec(w, 1.2);
  check('no more empowered damage after consumption', !ofType(ev, 'damage').some((d) => near(d.amount, 40)));
});

section('marks + counters', () => {
  const { w, a, b } = world();
  applyMark(w, a, b, 'fx_mark', 3, 1, 2);
  applyMark(w, a, b, 'fx_mark', 3, 1, 2);
  applyMark(w, a, b, 'fx_mark', 3, 1, 2);
  check('mark stacks cap at max', markStacks(b, 'fx_mark', a) === 2);
  check('marks are per applier', markStacks(b, 'fx_mark', b) === 0);
  stepSec(w, 3.1);
  check('mark expires', markStacks(b, 'fx_mark', a) === 0);
  addCounter(a, 'fx_count', 2, 5);
  addCounter(a, 'fx_count', 5);
  check('counter clamps to max', counterValue(a, 'fx_count') === 5);
  addCounter(a, 'fx_count', 1, undefined, undefined, true);
  check('counter reset then add', counterValue(a, 'fx_count') === 1);
  addCounter(a, 'fx_tmp', 3, undefined, 1);
  stepSec(w, 1.1);
  check('counter with duration resets to 0', counterValue(a, 'fx_tmp') === 0 && counterValue(a, 'fx_count') === 1);
});

section('forms', () => {
  const { w, a } = world();
  const ad0 = a.stats.ad, r0 = a.stats.range;
  a.slots[0]!.cooldown = 4;
  setForm(w, a, 'fx_form_x', 2);
  stepN(w, 1);
  check('form swaps the kit', a.slots[0]!.id === 'fx_form_poke' && a.slots[0]!.def.id === 'fx_form_poke');
  check('form stats + attackRange', near(a.stats.ad, ad0 + 30) && near(a.stats.range, 6) && r0 !== 6);
  check('form ability has its own cooldown (base one stashed)', a.slots[0]!.cooldown === 0);
  stepSec(w, 2);
  check('timed form reverts', a.form === null && a.slots[0]!.id === 'fx_poke' && near(a.stats.ad, ad0));
  check('stashed cooldown kept ticking', a.slots[0]!.cooldown > 1.8 && a.slots[0]!.cooldown < 2.0, a.slots[0]!.cooldown);
  setForm(w, a, 'fx_form_x');
  setForm(w, a, 'fx_form_x');
  check('applying the current form again toggles back', a.form === null);
  setForm(w, a, 'fx_no_such_form');
  check('unknown form ignored', a.form === null);
});

finish('probe_sim_core_status');
