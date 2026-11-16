// verifier (orch1 controls r2, SIM lens): fresh adversarial checks of the attackAt (Shift + left-click) command.
// Not a registered probe. Run: node _harness/_tmp_vfy_ctl_r2_attackat.ts
import { buildCatalog, fighter } from './fixtures/catalog_fixture.ts';
import { addUnit, check, fighterEnt, finish, makeWorld, section } from './fixtures/sim_fixture.ts';
import { applyStatus } from '../src/sim/status.ts';
import { ORDER_NONE, type Entity } from '../src/sim/entity.ts';
import type { Command, SimEvent } from '../src/contracts/sim.ts';
import type { World } from '../src/sim/world.ts';
import { hashString } from '../src/sim/rng.ts';

const cat = buildCatalog({
  fighters: [
    fighter('fx_sl', { base: { ad: 50, attackSpeed: 1.25, moveSpeed: 3.35 }, attack: { range: 5.5, windup: 0.25, projectileSpeed: 18 } }),
    fighter('fx_br', { base: { ad: 50, attackSpeed: 1, moveSpeed: 3.35 }, attack: { range: 1.6, windup: 0.3 }, resource: 'fx_fury' }),
    fighter('fx_foe', { base: { ad: 0, attackSpeed: 0.1, moveSpeed: 0 }, attack: { range: 1.5, windup: 0.3 } }),
  ],
});
interface R { w: World; h: Entity; foe: Entity; evs: SimEvent[] }
const mk = (who: string, hx = 20, hy = 20): R => {
  const w = makeWorld(cat, [{ fighter: who, team: 0, x: hx, y: hy }, { fighter: 'fx_foe', team: 1, x: 5, y: 55 }]);
  return { w, h: fighterEnt(w, 0), foe: fighterEnt(w, 1), evs: [] };
};
const st = (r: R, n: number, each?: (k: number) => void): void => { for (let k = 0; k < n; k++) { each?.(k); for (const e of r.w.step()) r.evs.push(e); } };
const cmd = (r: R, c: Command): void => r.w.command(0, c);
const atks = (r: R) => r.evs.filter((e): e is Extract<SimEvent, { e: 'attack' }> => e.e === 'attack' && e.src === r.h.id);
const hits = (r: R, id: number) => r.evs.filter((e) => e.e === 'damage' && e.dst === id && e.src === r.h.id).length;

section('X1 range edge, ranged ground shot vs targeted: identical reach on a sweep of distances', () => {
  let mism = 0; const bad: string[] = [];
  for (let d = 5.6; d <= 7.4; d += 0.02) {
    const r = mk('fx_sl');
    const m = addUnit(r.w, 'fx_dummy', 1, 20 + d, 20);
    const inR = Math.hypot(m.x - r.h.x, m.y - r.h.y) <= 5.5 + r.h.radius + m.radius;
    // aim past the dummy, sideways a bit so it is not "meant" by the click point (shot must still hit by line)
    cmd(r, { type: 'attackAt', x: 20 + 14, y: 20 });
    st(r, 60);
    const got = hits(r, m.id) > 0;
    if (got !== inR) { mism++; if (bad.length < 6) bad.push(`d ${d.toFixed(2)} inR ${inR} hit ${got}`); }
  }
  check('aimed shot hits iff in attack range', mism === 0, bad);
});

section('X2 held re-sends at every tick (new presses and held) never exceed attack speed', () => {
  for (const held of [true, false]) {
    const r = mk('fx_sl');
    addUnit(r.w, 'fx_dummy', 1, 24, 20);
    const T = 30 * 10;
    st(r, T, (k) => cmd(r, { type: 'attackAt', x: 24 + (k % 7) * 0.1, y: 20, ...(held && k > 0 ? { held: true } : {}) }));
    const n = atks(r).length, cap = Math.floor(10 * 1.25) + 1;
    check(`${held ? 'held' : 'new press'} every tick: ${n} attacks in 10 s <= ${cap}`, n <= cap && n >= cap - 2, n);
  }
  // alternate attackAt / move / stop each tick (animation-cancel spam)
  const r = mk('fx_sl');
  addUnit(r.w, 'fx_dummy', 1, 24, 20);
  st(r, 300, (k) => cmd(r, k % 3 === 0 ? { type: 'attackAt', x: 24, y: 20 } : k % 3 === 1 ? { type: 'move', x: 19, y: 20 } : { type: 'stop' }));
  check('cancel spam: no more attacks than attack speed allows', atks(r).length <= 13, atks(r).length);
});

section('X3 no stat change: a whiffed ground attack must not build an on-attack resource (fury/Tally)', () => {
  const r = mk('fx_br');
  r.h.res = 0;
  const x0 = r.h.x;
  st(r, 30 * 12, (k) => { if (k % 30 === 0) cmd(r, { type: 'attackAt', x: 30, y: 20 }); });   // a click a second at open ground
  const n = atks(r).length;
  check(`whiffs (${n} swings at nothing, no enemy near) leave the build resource empty`, r.h.res <= 1e-9, { res: r.h.res, swings: n });
  check('and the hero never moved', Math.abs(r.h.x - x0) < 1e-9);
  // baseline: stopping, the resource decays; a held whiff keeps it from decaying
  const r2 = mk('fx_br'); r2.h.res = 80;
  st(r2, 30 * 8, (k) => { if (k % 15 === 0) cmd(r2, { type: 'attackAt', x: 30, y: 20, ...(k > 0 ? { held: true } : {}) }); });
  check('a held whiff at the ground does not hold a full bar off its decay', r2.h.res < 80, r2.h.res);
});

section('X4 statuses: a stunned / disarmed hero does not turn to the click', () => {
  for (const s of ['stun', 'disarm'] as const) {
    const r = mk('fx_sl');
    r.foe.x = 30; r.foe.y = 40; r.w.hashDirty = true;
    st(r, 2);
    r.h.facing = 0;
    applyStatus(r.w, r.foe, r.h, s, 1.5);
    st(r, 1);
    const f0 = r.h.facing;
    cmd(r, { type: 'attackAt', x: 10, y: 20 });   // directly behind
    st(r, 2);
    check(`${s}: facing unchanged by the click (${f0.toFixed(2)} -> ${r.h.facing.toFixed(2)})`, Math.abs(r.h.facing - f0) < 1e-6);
  }
});

section('X5 a second press during an aimed windup: where does the shot go', () => {
  const r = mk('fx_sl');
  const a = addUnit(r.w, 'fx_dummy', 1, 24, 20), b = addUnit(r.w, 'fx_dummy', 1, 16, 20);
  cmd(r, { type: 'attackAt', x: 30, y: 26 });   // ground (a is 'meant' by aim line? angle ~ 23 deg: yes, targeted)
  st(r, 2);
  cmd(r, { type: 'attackAt', x: 10, y: 20 });   // new press straight behind, toward b
  st(r, 40);
  console.log('   hitsA', hits(r, a.id), 'hitsB', hits(r, b.id), 'attacks', atks(r).map((e) => e.dst));
  check('the windup toward A was not delivered after a press aimed straight away from it', hits(r, a.id) === 0, { a: hits(r, a.id), b: hits(r, b.id) });
});

section('X6 fog/stealth: aimed shot does not hit an unseen enemy on its line; invisibility broken by firing', () => {
  const r = mk('fx_sl');
  const m = addUnit(r.w, 'fx_dummy', 1, 23, 20);
  m.visibleMask = 0;   // force unseen this tick
  const keep = () => { m.visibleMask = 0; };
  cmd(r, { type: 'attackAt', x: 30, y: 20 });
  st(r, 40, keep);
  check('unseen enemy on the line is not hit', hits(r, m.id) === 0);
});

section('X7 allies and own structures: never hit; neutral monster on the line', () => {
  const r = mk('fx_sl');
  const ally = addUnit(r.w, 'fx_dummy', 0, 22, 20);
  const mon = addUnit(r.w, 'fx_monster', 2, 24, 20);
  cmd(r, { type: 'attackAt', x: 30, y: 20 });
  st(r, 40);
  check('ally on the line is not hit', hits(r, ally.id) === 0);
  console.log('   monster hit:', hits(r, mon.id), '(relation', r.w.relation(r.h, mon), ')');
});

section('X8 determinism: a long random attackAt/move stream twice gives the same events and position', () => {
  const run = (): string => {
    const r = mk('fx_sl');
    for (let i = 0; i < 6; i++) addUnit(r.w, 'fx_dummy', 1, 18 + i * 1.3, 23 + (i % 2));
    let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    let h = 0x811c9dc5;
    for (let t = 0; t < 1800; t++) {
      const q = rnd();
      if (q < 0.08) r.w.command(0, { type: 'attackAt', x: 10 + rnd() * 20, y: 10 + rnd() * 20, held: rnd() < 0.5 });
      else if (q < 0.1) r.w.command(0, { type: 'move', x: 10 + rnd() * 20, y: 10 + rnd() * 20 });
      else if (q < 0.11) r.w.command(0, { type: 'attackAt', x: 0, y: 0, end: true });
      for (const e of r.w.step()) h = hashString(JSON.stringify(e), h);
    }
    return `${h.toString(16)}|${r.h.x}|${r.h.y}|${r.h.order}`;
  };
  const a = run(), b = run();
  check('same stream twice: same hash', a === b, [a, b]);
});

section('X9 order lapses: an attackAt left while stunned for 3 s does not fire a surprise shot after', () => {
  const r = mk('fx_sl');
  addUnit(r.w, 'fx_dummy', 1, 24, 20);
  applyStatus(r.w, r.foe, r.h, 'stun', 3);
  cmd(r, { type: 'attackAt', x: 24, y: 20 });
  st(r, 30 * 4);
  check('no attack after the stun', atks(r).length === 0 && r.h.order === ORDER_NONE, { n: atks(r).length, o: r.h.order });
});

finish('_tmp_vfy_ctl_r2_attackat');
