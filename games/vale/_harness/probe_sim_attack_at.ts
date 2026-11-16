// probe (lane SIM): Shift + left-click "attack in place" (owner 2026-11-15: "allow me to hold shift and click left to
// SHOOT, even if its in any direction ... and not run into path finding issues"; ruling 39). The command
// { type: 'attackAt', x, y, target?, fighters? } never moves the fighter: it faces the click and attacks the enemy
// nearest the click point that is already in attack range (the client's pick first, if it is in range), and with
// none in range it still throws its basic attack toward the click: a ranged shot flies the aim line to max range and
// hits the first enemy it meets (else a plain miss), a melee swing hits an enemy in its arc (else a miss). Windup,
// cooldown, disarm / hard CC / fear / taunt, root (it still shoots), vision (an unseen enemy is neither picked nor
// hit), fighters-only, one attack per click, a held re-send keeps attacking at attack speed re-aimed, determinism.
import { buildCatalog, fighter } from './fixtures/catalog_fixture.ts';
import { addUnit, check, fighterEnt, finish, makeWorld, section } from './fixtures/sim_fixture.ts';
import { validCommand } from '../src/sim/world.ts';
import { applyStatus } from '../src/sim/status.ts';
import { ORDER_NONE, type Entity } from '../src/sim/entity.ts';
import type { Command, SimEvent } from '../src/contracts/sim.ts';
import type { World } from '../src/sim/world.ts';

const cat = buildCatalog({
  fighters: [
    fighter('fx_slinger', { base: { ad: 50, attackSpeed: 1, moveSpeed: 3.35 }, attack: { range: 5.6, windup: 0.2, projectileSpeed: 20 } }),
    fighter('fx_brawler', { base: { ad: 50, attackSpeed: 1, moveSpeed: 3.35 }, attack: { range: 1.5, windup: 0.25 } }),
    fighter('fx_foe', { base: { ad: 0, attackSpeed: 0.1, moveSpeed: 0 }, attack: { range: 1.5, windup: 0.3 } }),
  ],
});
const f2 = (n: number): string => n.toFixed(2);

interface Run { w: World; h: Entity; foe: Entity; evs: SimEvent[] }
function world(who: 'fx_slinger' | 'fx_brawler', hx = 12, hy = 30): Run {
  const w = makeWorld(cat, [{ fighter: who, team: 0, x: hx, y: hy }, { fighter: 'fx_foe', team: 1, x: 5, y: 55 }]);
  const h = fighterEnt(w, 0), foe = fighterEnt(w, 1);
  return { w, h, foe, evs: [] };
}
function steps(r: Run, n: number, each?: (k: number) => void): void {
  for (let k = 0; k < n; k++) { each?.(k); for (const ev of r.w.step()) r.evs.push(ev); }
}
const cmd = (r: Run, c: Command): void => r.w.command(0, c);
const attacks = (r: Run): Extract<SimEvent, { e: 'attack' }>[] => r.evs.filter((e): e is Extract<SimEvent, { e: 'attack' }> => e.e === 'attack' && e.src === r.h.id);
const dmgTo = (r: Run, id: number): number => r.evs.filter((e) => e.e === 'damage' && e.dst === id && e.src === r.h.id).length;
const shots = (r: Run): number => r.evs.filter((e) => e.e === 'projectile' && e.src === r.h.id).length;

section('the command shape: attackAt is a valid command; malformed ones are dropped', () => {
  check('{attackAt, x, y} is valid', validCommand({ type: 'attackAt', x: 1, y: 2 }));
  check('with a target and fighters-only it is valid', validCommand({ type: 'attackAt', x: 1, y: 2, target: 7, fighters: true }));
  check('NaN, a fractional target or a non-boolean flag are not', !validCommand({ type: 'attackAt', x: NaN, y: 2 }) && !validCommand({ type: 'attackAt', x: 1, y: 2, target: 1.5 })
    && !validCommand({ type: 'attackAt', x: 1, y: 2, fighters: 'yes' }));
});

section('ranged: a click on an enemy in range attacks it in place and the hero never moves', () => {
  const r = world('fx_slinger');
  const m = addUnit(r.w, 'fx_dummy', 1, 16, 30);
  const x0 = r.h.x, y0 = r.h.y;
  cmd(r, { type: 'attackAt', x: 16, y: 30, target: m.id });
  steps(r, 45);
  const a = attacks(r);
  check('exactly one attack, at the clicked enemy', a.length === 1 && a[0].dst === m.id, a.map((e) => e.dst));
  check('it lands (one hit)', dmgTo(r, m.id) === 1, dmgTo(r, m.id));
  check('the hero stood still', Math.hypot(r.h.x - x0, r.h.y - y0) < 1e-9, [f2(r.h.x), f2(r.h.y)]);
  check('the order is over after its one attack', r.h.order === ORDER_NONE, r.h.order);
});

section('ranged: the enemy nearest the click (in range) is attacked, not the one nearest the hero', () => {
  const r = world('fx_slinger');
  const near = addUnit(r.w, 'fx_dummy', 1, 14, 30);           // 2 m from the hero
  const meant = addUnit(r.w, 'fx_dummy', 1, 12, 35);          // 5 m north, in range
  cmd(r, { type: 'attackAt', x: 12.3, y: 35.4 });              // no client pick: the sim's click-point acquisition
  steps(r, 45);
  const a = attacks(r);
  check('it attacks the enemy by the click', a.length === 1 && a[0].dst === meant.id, { got: a.map((e) => e.dst), near: near.id, meant: meant.id });
  check('the hero faces the click', Math.abs(r.h.facing - Math.PI / 2) < 0.2, f2(r.h.facing));
});

section('ranged: an enemy out of range is never chased; the shot flies toward the click and misses', () => {
  const r = world('fx_slinger');
  const far = addUnit(r.w, 'fx_dummy', 1, 22, 30);            // 10 m east: out of range
  const x0 = r.h.x, y0 = r.h.y;
  cmd(r, { type: 'attackAt', x: 22, y: 30, target: far.id });
  let maxReach = 0;
  steps(r, 60, () => { for (const p of r.w.entities) if (p.kind === 'projectile' && p.ownerEid === r.h.id && !p.removed) maxReach = Math.max(maxReach, Math.hypot(p.x - x0, p.y - y0)); });
  const a = attacks(r);
  check('one attack toward the ground (no target)', a.length === 1 && a[0].dst === -1, a);
  check('one shot is thrown', shots(r) === 1, shots(r));
  check('the shot flies at most the attack reach (range + radius)', maxReach > 4 && maxReach <= 5.6 + r.h.radius + 0.7, f2(maxReach));
  check('the far enemy is not hit', dmgTo(r, far.id) === 0);
  check('the hero never moved toward it', Math.hypot(r.h.x - x0, r.h.y - y0) < 1e-9, [f2(r.h.x), f2(r.h.y)]);
  check('no projectile is left in flight', !r.w.entities.some((p) => p.kind === 'projectile' && !p.removed));
});

section('ranged: leading a target — an enemy that walks onto the aim line is hit by the shot', () => {
  const r = world('fx_slinger');
  const m = addUnit(r.w, 'fx_dummy', 1, 12, 45);              // far off the line
  cmd(r, { type: 'attackAt', x: 20, y: 30 });
  let moved = false;
  steps(r, 60, () => {
    const p = r.w.entities.find((q) => q.kind === 'projectile' && q.ownerEid === r.h.id && !q.removed);
    if (p && !moved) { m.x = 15.5; m.y = 30.1; r.w.hashDirty = true; moved = true; }
  });
  check('the shot was thrown at the ground', attacks(r).length === 1 && attacks(r)[0].dst === -1);
  check('it hit the enemy that stepped into its path', dmgTo(r, m.id) === 1, dmgTo(r, m.id));
});

section('ranged: the shot passes allies and stops at the first enemy', () => {
  const r = world('fx_slinger');
  const ally = addUnit(r.w, 'fx_dummy', 0, 14, 30);
  const e1 = addUnit(r.w, 'fx_dummy', 1, 15.5, 45), e2 = addUnit(r.w, 'fx_dummy', 1, 16.5, 45);
  cmd(r, { type: 'attackAt', x: 20, y: 30 });
  let placed = false;
  steps(r, 60, () => {
    if (!placed && r.w.entities.some((q) => q.kind === 'projectile' && q.ownerEid === r.h.id && !q.removed)) {
      e1.x = 15.6; e1.y = 30; e2.x = 16.8; e2.y = 30; r.w.hashDirty = true; placed = true;
    }
  });
  check('the ally is not hit', r.evs.filter((e) => e.e === 'damage' && e.dst === ally.id).length === 0);
  check('the first enemy is hit, the one behind it is not', dmgTo(r, e1.id) === 1 && dmgTo(r, e2.id) === 0, [dmgTo(r, e1.id), dmgTo(r, e2.id)]);
});

section('vision: an enemy the team cannot see is neither picked nor hit', () => {
  const r = world('fx_slinger');
  const m = addUnit(r.w, 'fx_dummy', 1, 15, 30);
  const hide = (): void => { m.visibleMask = 0; };
  hide();
  cmd(r, { type: 'attackAt', x: 15, y: 30, target: m.id });
  steps(r, 45, hide);
  const a = attacks(r);
  check('the attack is thrown at the ground, not at the unseen enemy', a.length === 1 && a[0].dst === -1, a);
  check('the unseen enemy takes no hit', dmgTo(r, m.id) === 0);
});

section('held: re-sent every 3 ticks with a moving aim, it attacks at attack speed and never moves', () => {
  const r = world('fx_slinger');
  const x0 = r.h.x, y0 = r.h.y;
  steps(r, 120, (k) => { if (k % 3 === 0) { const a = (k / 120) * Math.PI; cmd(r, { type: 'attackAt', x: 12 + Math.cos(a) * 4, y: 30 + Math.sin(a) * 4 }); } });
  const a = attacks(r);
  const t = a.map((e) => e.t);
  let minGap = Infinity;
  for (let i = 1; i < t.length; i++) minGap = Math.min(minGap, t[i] - t[i - 1]);
  check('4 s at 1 attack/s: 4 attacks (±1)', a.length >= 3 && a.length <= 5, a.length);
  check('never faster than the attack period', minGap >= 1 - 1 / 30 - 1e-6, f2(minGap));
  check('the hero never moved', Math.hypot(r.h.x - x0, r.h.y - y0) < 1e-9);
  check('each shot re-aims (the shots leave in different directions)', new Set(r.evs.filter((e) => e.e === 'projectile' && e.src === r.h.id).map((e) => {
    const p = r.w.entity((e as { id: number }).id); return p ? Math.round(p.facing * 4) : 0;
  })).size >= 2 || a.length >= 3);
});

section('one click is one attack: no second swing after it', () => {
  const r = world('fx_slinger');
  const m = addUnit(r.w, 'fx_dummy', 1, 15, 30);
  cmd(r, { type: 'attackAt', x: 15, y: 30 });
  steps(r, 120);
  check('one attack in 4 s (auto-attack off)', attacks(r).length === 1 && dmgTo(r, m.id) === 1, attacks(r).length);
});

section('cooldown: a click right after an attack waits for the cooldown, then attacks once', () => {
  const r = world('fx_slinger');
  const m = addUnit(r.w, 'fx_dummy', 1, 15, 30);
  cmd(r, { type: 'attackAt', x: 15, y: 30 });
  steps(r, 12);
  cmd(r, { type: 'attackAt', x: 15, y: 30 });
  steps(r, 60);
  const t = attacks(r).map((e) => e.t);
  check('two attacks, a full period apart', t.length === 2 && t[1] - t[0] >= 1 - 1 / 30 - 1e-6, t.map(f2));
  check('both hit', dmgTo(r, m.id) === 2);
});

section('a move cancels the windup; a second attackAt during the windup re-aims without restarting it', () => {
  const r = world('fx_slinger');
  addUnit(r.w, 'fx_dummy', 1, 15, 30);
  cmd(r, { type: 'attackAt', x: 15, y: 30 });
  steps(r, 2);
  cmd(r, { type: 'move', x: 5, y: 30 });
  steps(r, 20);
  check('the move cancelled it: no hit, the hero walks', shots(r) === 0 && r.h.x < 12, [shots(r), f2(r.h.x)]);
});

section('statuses: disarm and stun stop it; root does not; fear and taunt override the aim', () => {
  {
    const r = world('fx_slinger');
    const m = addUnit(r.w, 'fx_dummy', 1, 15, 30);
    applyStatus(r.w, r.foe, r.h, 'disarm', 0.6);
    cmd(r, { type: 'attackAt', x: 15, y: 30 });
    steps(r, 12);
    check('disarmed: no attack starts', attacks(r).length === 0);
    steps(r, 60);
    check('disarmed long past the click: the order has lapsed (no surprise shot later)', attacks(r).length === 0 && r.h.order === ORDER_NONE, { n: attacks(r).length, order: r.h.order, hit: dmgTo(r, m.id) });
  }
  {
    const r = world('fx_slinger');
    const m = addUnit(r.w, 'fx_dummy', 1, 15, 30);
    applyStatus(r.w, r.foe, r.h, 'root', 2);
    cmd(r, { type: 'attackAt', x: 15, y: 30 });
    steps(r, 30);
    check('rooted: it still shoots', dmgTo(r, m.id) === 1, dmgTo(r, m.id));
  }
  {
    const r = world('fx_slinger');
    addUnit(r.w, 'fx_dummy', 1, 15, 30);
    applyStatus(r.w, r.foe, r.h, 'stun', 1);
    cmd(r, { type: 'attackAt', x: 15, y: 30 });
    steps(r, 20);
    check('stunned: no attack', attacks(r).length === 0);
  }
  {
    const r = world('fx_slinger');
    r.foe.x = 10; r.foe.y = 30; r.w.hashDirty = true; r.w.vision.update(r.w.entities, r.w.tick);
    applyStatus(r.w, r.foe, r.h, 'taunt', 1);
    cmd(r, { type: 'attackAt', x: 18, y: 30 });
    steps(r, 20);
    const a = attacks(r);
    check('taunted: it attacks the taunter, not toward the click', a.length >= 1 && a[0].dst === r.foe.id, a.map((e) => e.dst));
  }
});

section('melee: a swing at an enemy in reach hits; a swing at empty ground misses; an enemy behind is not hit', () => {
  {
    const r = world('fx_brawler');
    const m = addUnit(r.w, 'fx_dummy', 1, 13.6, 30);
    cmd(r, { type: 'attackAt', x: 14, y: 30 });
    steps(r, 30);
    check('in reach: one swing, it hits', attacks(r).length === 1 && dmgTo(r, m.id) === 1);
  }
  {
    const r = world('fx_brawler');
    const behind = addUnit(r.w, 'fx_dummy', 1, 10.6, 30);
    const x0 = r.h.x;
    cmd(r, { type: 'attackAt', x: 16, y: 30 });
    steps(r, 30);
    const a = attacks(r);
    check('an empty swing toward the click (no target)', a.length === 1 && a[0].dst === -1, a);
    check('the enemy behind is not hit', dmgTo(r, behind.id) === 0);
    check('it faces the click and stays put', Math.abs(r.h.facing) < 0.2 && Math.abs(r.h.x - x0) < 1e-9, [f2(r.h.facing), f2(r.h.x)]);
  }
  {
    const r = world('fx_brawler');
    const m = addUnit(r.w, 'fx_dummy', 1, 12, 36);
    cmd(r, { type: 'attackAt', x: 16, y: 30 });
    let moved = false;
    steps(r, 30, () => { if (!moved && r.h.atkWindup >= 0) { m.x = 13.7; m.y = 30.3; r.w.hashDirty = true; moved = true; } });
    check('an enemy that steps into the swing\'s arc during the windup is hit', dmgTo(r, m.id) === 1, dmgTo(r, m.id));
  }
});

section('fighters-only: the enemy fighter in range is picked over a minion nearer the click', () => {
  const r = world('fx_slinger');
  const m = addUnit(r.w, 'fx_dummy', 1, 15, 30);
  r.foe.x = 15.5; r.foe.y = 32; r.w.hashDirty = true; r.w.vision.update(r.w.entities, r.w.tick);
  cmd(r, { type: 'attackAt', x: 15, y: 30, fighters: true });
  steps(r, 40);
  const a = attacks(r);
  check('the fighter is attacked', a.length === 1 && a[0].dst === r.foe.id, { got: a.map((e) => e.dst), minion: m.id, fighter: r.foe.id });
});

section('fighters-only (orch1 live r2, ruling 43): a ground shot or swing under Z passes Wicks; it lands only on a fighter', () => {
  {
    const r = world('fx_slinger');
    const m = addUnit(r.w, 'fx_dummy', 1, 12, 45);
    cmd(r, { type: 'attackAt', x: 20, y: 30, fighters: true });
    let placed = false;
    steps(r, 60, () => {
      if (!placed && r.w.entities.some((q) => q.kind === 'projectile' && q.ownerEid === r.h.id && !q.removed)) {
        m.x = 15.6; m.y = 30; r.foe.x = 16.9; r.foe.y = 30; r.w.hashDirty = true; r.w.vision.update(r.w.entities, r.w.tick); placed = true;
      }
    });
    check('the shot was thrown at the ground', attacks(r).length === 1 && attacks(r)[0].dst === -1, attacks(r).map((e) => e.dst));
    check('the Wick on the line is passed, the fighter behind it is hit', dmgTo(r, m.id) === 0 && dmgTo(r, r.foe.id) === 1, [dmgTo(r, m.id), dmgTo(r, r.foe.id)]);
  }
  {
    const r = world('fx_slinger');
    const m = addUnit(r.w, 'fx_dummy', 1, 12, 45);
    cmd(r, { type: 'attackAt', x: 20, y: 30 });
    let placed = false;
    steps(r, 60, () => {
      if (!placed && r.w.entities.some((q) => q.kind === 'projectile' && q.ownerEid === r.h.id && !q.removed)) { m.x = 15.6; m.y = 30; r.w.hashDirty = true; placed = true; }
    });
    check('without Z the same shot still hits the Wick it meets', dmgTo(r, m.id) === 1, dmgTo(r, m.id));
  }
  {
    const r = world('fx_brawler');
    const m = addUnit(r.w, 'fx_dummy', 1, 12, 45);
    cmd(r, { type: 'attackAt', x: 16, y: 30, fighters: true });
    let moved = false;
    steps(r, 30, () => { if (!moved && r.h.atkWindup >= 0) { m.x = 13.7; m.y = 30.3; r.w.hashDirty = true; moved = true; } });
    check('a melee swing under Z misses a Wick in its arc', dmgTo(r, m.id) === 0, dmgTo(r, m.id));
  }
});

section('reach (orch1 r2): a ground shot never lands on an enemy a targeted attack could not reach', () => {
  for (const over of [0.02, 0.1, 0.14, 0.3]) {
    const r = world('fx_slinger');
    const m = addUnit(r.w, 'fx_dummy', 1, 5, 5);
    const edge = 5.6 + r.h.radius + m.radius;                  // inAttackRange's bound, centre to centre
    m.x = r.h.x + edge + over; m.y = r.h.y; r.w.hashDirty = true;
    cmd(r, { type: 'attackAt', x: m.x, y: m.y, target: m.id });
    steps(r, 60);
    check(`a post ${over} m past attack range is not hit by the aimed shot`, dmgTo(r, m.id) === 0 && attacks(r).length === 1 && attacks(r)[0].dst === -1, { hits: dmgTo(r, m.id), a: attacks(r).map((e) => e.dst) });
  }
  {
    const r = world('fx_slinger');
    const m = addUnit(r.w, 'fx_dummy', 1, 5, 5);
    m.x = r.h.x + 5.6 + r.h.radius + m.radius - 0.02; m.y = r.h.y; r.w.hashDirty = true;
    cmd(r, { type: 'attackAt', x: m.x, y: m.y, target: m.id });
    steps(r, 60);
    check('a post just inside attack range is attacked and hit', dmgTo(r, m.id) === 1, dmgTo(r, m.id));
  }
});

section('release (orch1 r2): letting go of a held button that already fired owes no further attack', () => {
  {
    const r = world('fx_slinger');
    addUnit(r.w, 'fx_dummy', 1, 15, 30);
    // held: re-sent every 3 ticks for 1.2 s (one attack at t0, the next owed at ~1 s), released at 1.2 s
    steps(r, 36, (k) => { if (k % 3 === 0) cmd(r, { type: 'attackAt', x: 15, y: 30, ...(k ? { held: true } : {}) }); });
    const n0 = attacks(r).length;
    cmd(r, { type: 'attackAt', x: 15, y: 30, end: true });
    steps(r, 90);
    const after = attacks(r).length - n0;
    check('{attackAt, end} is a valid command', validCommand({ type: 'attackAt', x: 1, y: 2, end: true }) && !validCommand({ type: 'attackAt', x: 1, y: 2, end: 1 }));
    check('the hold attacked', n0 >= 1, n0);
    check('no attack starts after the release (auto-attack off)', after === 0, { after, order: r.h.order });
    check('the order is over', r.h.order === ORDER_NONE, r.h.order);
  }
  {
    // a quick windup (0.05 s) ends the order between two re-sends: the press still counts as fired
    const r = world('fx_slinger');
    r.h.attackDef = { ...r.h.attackDef!, windup: 0.05 };
    addUnit(r.w, 'fx_dummy', 1, 15, 30);
    steps(r, 40, (k) => { if (k % 5 === 0) cmd(r, { type: 'attackAt', x: 15, y: 30, ...(k ? { held: true } : {}) }); });
    const n0 = attacks(r).length;
    cmd(r, { type: 'attackAt', x: 15, y: 30, end: true });
    steps(r, 90);
    check('quick windup, re-sends 5 ticks apart: no attack after the release', n0 >= 1 && attacks(r).length === n0, { n0, n: attacks(r).length });
  }
  {
    const r = world('fx_slinger');
    const m = addUnit(r.w, 'fx_dummy', 1, 15, 30);
    cmd(r, { type: 'attackAt', x: 15, y: 30 });
    steps(r, 12);                                              // the first attack is out; cooldown ~0.6 s left
    cmd(r, { type: 'attackAt', x: 15, y: 30 });                // a new press during the cooldown, held …
    steps(r, 3);
    cmd(r, { type: 'attackAt', x: 15, y: 30, held: true });
    steps(r, 1);
    cmd(r, { type: 'attackAt', x: 15, y: 30, end: true });     // … and let go before the cooldown is over
    steps(r, 60);
    check('a press let go before its attack could start still gets its one attack', attacks(r).length === 2 && dmgTo(r, m.id) === 2, attacks(r).length);
  }
});

section('determinism: the same command stream gives the same events twice', () => {
  const run = (): string => {
    const r = world('fx_slinger');
    addUnit(r.w, 'fx_dummy', 1, 15, 31); addUnit(r.w, 'fx_dummy', 1, 13, 34);
    steps(r, 150, (k) => { if (k % 4 === 0) cmd(r, { type: 'attackAt', x: 12 + 4 * Math.cos(k / 20), y: 30 + 4 * Math.sin(k / 20) }); });
    return JSON.stringify(r.evs.filter((e) => e.e === 'attack' || e.e === 'damage' || e.e === 'projectile')) + `${r.h.x},${r.h.y}`;
  };
  check('identical', run() === run());
});

finish('probe_sim_attack_at');
