// orch1 controls r3 VERIFIER: an independent property/fuzz probe for the Shift + left-click attackAt command (ruling 39/41).
//   node _harness/_tmp_vfy_ctl_r3_attackat.ts [--n 400]
// Random worlds (enemies, allies, an invisible enemy, enemies near and past reach), random command streams (new presses,
// held re-sends, end, stray targets: ally / self / unseen / unknown id / far enemy, moves, stops) and random statuses
// (stun, disarm, root, silence, slow, sleep), checked every tick against invariants of the rule, then the same stream twice.
import { buildCatalog, fighter } from './fixtures/catalog_fixture.ts';
import { addUnit, check, fighterEnt, finish, makeWorld, section } from './fixtures/sim_fixture.ts';
import { applyStatus } from '../src/sim/status.ts';
import { computeStats } from '../src/sim/stats.ts';
import { CC_HARD, CC_FEAR, CC_TAUNT, ORDER_ATTACK_AT, type Entity } from '../src/sim/entity.ts';
import { inAttackRange } from '../src/sim/attack.ts';
import type { Command, SimEvent } from '../src/contracts/sim.ts';
import type { World } from '../src/sim/world.ts';

const argv = process.argv.slice(2);
const N = Number(argv[argv.indexOf('--n') + 1] ?? 400) || 400;
const cat = buildCatalog({
  fighters: [
    fighter('vx_slinger', { base: { ad: 50, attackSpeed: 1.25, moveSpeed: 3.4 }, attack: { range: 5.6, windup: 0.2, projectileSpeed: 18 } }),
    fighter('vx_quick', { base: { ad: 50, attackSpeed: 2.5, moveSpeed: 3.4 }, attack: { range: 4.0, windup: 0.15, projectileSpeed: 30 } }),
    fighter('vx_brawler', { base: { ad: 50, attackSpeed: 1, moveSpeed: 3.4 }, attack: { range: 1.6, windup: 0.25 } }),
    fighter('vx_foe', { base: { ad: 0, attackSpeed: 0.1, moveSpeed: 0 }, attack: { range: 1.5, windup: 0.3 } }),
  ],
});
function mulberry(a: number): () => number { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

interface Viol { k: string; d: unknown }
interface Res { evs: string; state: string; viol: Viol[]; attacks: number; hits: number; aimed: number }
const WHO = ['vx_slinger', 'vx_quick', 'vx_brawler'] as const;

function scenario(seed: number): Res {
  const rnd = mulberry(seed);
  const who = WHO[seed % 3];
  const hx = 12 + rnd() * 8, hy = 18 + rnd() * 16;
  const w: World = makeWorld(cat, [{ fighter: who, team: 0, x: hx, y: hy }, { fighter: 'vx_foe', team: 1, x: 50, y: 55 }], { seed: 1000 + seed });
  const h = fighterEnt(w, 0), foe = fighterEnt(w, 1);
  computeStats(w, h);
  const statsKey = (e: Entity): string => JSON.stringify(e.stats);
  const stats0 = statsKey(h);
  const range = h.stats.range, period = 1 / h.stats.attackSpeed, melee = who === 'vx_brawler';
  const enemies: Entity[] = [], allies: Entity[] = [];
  const place = (): [number, number] => { for (;;) { const a = rnd() * Math.PI * 2, d = 1.4 + rnd() * (range + 3); const x = h.x + Math.cos(a) * d, y = h.y + Math.sin(a) * d;
    if (x > 1 && x < 27 && y > 1 && y < 59 && [...enemies, ...allies].every((o) => Math.hypot(o.x - x, o.y - y) > 1.2)) return [x, y]; } };
  const ne = 1 + Math.floor(rnd() * 5), na = Math.floor(rnd() * 3);
  for (let i = 0; i < ne; i++) { const [x, y] = place(); enemies.push(addUnit(w, 'fx_dummy', 1, x, y)); }
  for (let i = 0; i < na; i++) { const [x, y] = place(); allies.push(addUnit(w, 'fx_dummy', 0, x, y)); }
  let hidden: Entity | null = null;
  if (rnd() < 0.5) { const [x, y] = place(); hidden = addUnit(w, 'fx_dummy', 1, x, y); applyStatus(w, null, hidden, 'invisible', 999); w.vision.update(w.entities, w.tick); }
  const viol: Viol[] = [];
  const evs: SimEvent[] = [];
  let lastAtkT = -1e9, presses = 0, pressSinceAtk = 0, attacks = 0, hits = 0, aimed = 0;
  let lastAim: [number, number] | null = null;
  let held = false, heldTarget: number | undefined;
  const hist: [number, number][] = [];
  const T = 150;
  for (let k = 0; k < T; k++) {
    // statuses on the hero, first 2 s only (so stats settle before the end check)
    if (k < 60 && rnd() < 0.02) { const kinds = ['stun', 'disarm', 'root', 'silence', 'slow', 'sleep'] as const; const kd = kinds[Math.floor(rnd() * kinds.length)];
      applyStatus(w, foe, h, kd, 0.2 + rnd() * 0.8, kd === 'slow' ? { amount: 0.3 } as never : {}); }
    // commands
    const r = rnd();
    let c: Command | null = null;
    if (held && k % 3 === 0) c = { type: 'attackAt', x: lastAim![0] + (rnd() - 0.5), y: lastAim![1] + (rnd() - 0.5), held: true, ...(heldTarget !== undefined ? { target: heldTarget } : {}) };
    if (r < 0.06) {
      const pick = rnd();
      let tx: number, ty: number, target: number | undefined;
      const all = [...enemies, ...allies];
      if (pick < 0.35 && all.length) { const u = all[Math.floor(rnd() * all.length)]; tx = u.x + (rnd() - 0.5) * 0.6; ty = u.y + (rnd() - 0.5) * 0.6; target = rnd() < 0.6 ? u.id : undefined; }
      else if (pick < 0.45 && hidden) { tx = hidden.x; ty = hidden.y; target = hidden.id; }
      else if (pick < 0.5) { tx = h.x + 3; ty = h.y; target = [h.id, 99999, foe.id][Math.floor(rnd() * 3)]; }
      else { const a = rnd() * Math.PI * 2, d = 0.5 + rnd() * 12; tx = h.x + Math.cos(a) * d; ty = h.y + Math.sin(a) * d; }
      c = { type: 'attackAt', x: tx, y: ty, ...(target !== undefined ? { target } : {}) };
      presses++; pressSinceAtk++; lastAim = [tx, ty]; held = rnd() < 0.4; heldTarget = target;
    } else if (r < 0.075 && held) { c = { type: 'attackAt', x: lastAim![0], y: lastAim![1], end: true }; held = false; }
    else if (r < 0.085) { c = { type: 'move', x: 6 + rnd() * 18, y: 6 + rnd() * 40 }; held = false; }
    else if (r < 0.09) { c = { type: 'stop' }; held = false; }
    if (c) w.command(0, c);
    if (process.env.DIAG && Number(process.env.DIAG) === seed) console.log(`  k${k} cmd ${JSON.stringify(c)} h(${h.x.toFixed(3)},${h.y.toFixed(3)}) ord${h.order} wd${h.atkWindup.toFixed(2)} aimed${h.atkAimed} cc${h.ccMask} near ${w.entities.filter((o) => o !== h && o.alive && o.kind !== 'projectile' && Math.hypot(o.x - h.x, o.y - h.y) < 2.5).map((o) => `${o.id}t${o.team}@${Math.hypot(o.x - h.x, o.y - h.y).toFixed(2)}`).join(' ')}`);
    const x0 = h.x, y0 = h.y, ordBefore = h.order;
    hist.push([h.x, h.y]); if (hist.length > 20) hist.shift();
    const touching = w.entities.some((o) => o !== h && o.alive && o.kind !== 'projectile' && Math.hypot(o.x - h.x, o.y - h.y) < h.radius + o.radius + 0.05);
    const out = w.step();
    for (const ev of out) evs.push(ev);
    // I1: never walks under an attackAt order (no other movers in these worlds; dummies are static)
    if (ordBefore === ORDER_ATTACK_AT && h.order === ORDER_ATTACK_AT && (c === null || c.type === 'attackAt') && (h.ccMask & (CC_FEAR | CC_TAUNT)) === 0 && !touching && Math.hypot(h.x - x0, h.y - y0) > 1e-9)
      viol.push({ k: 'walked under attackAt', d: { seed, k, d: Math.hypot(h.x - x0, h.y - y0) } });
    for (const ev of out) {
      if (ev.e === 'attack' && ev.src === h.id) {
        attacks++;
        if (ev.dst === -1) aimed++;
        // I4 cooldown
        if (ev.t - lastAtkT < period - 1 / 30 - 1e-6) viol.push({ k: 'faster than attack speed', d: { seed, who, gap: ev.t - lastAtkT, period } });
        lastAtkT = ev.t;
        // I5 no attack under hard CC / disarm
        if ((h.ccMask & CC_HARD) !== 0) viol.push({ k: 'attacked under hard CC', d: { seed, k } });
        if (h.statuses?.some?.((s: { kind: string }) => s.kind === 'disarm')) viol.push({ k: 'attacked while disarmed', d: { seed, k } });
        // I6 one press is one attack (held re-sends owe one each, so only check when not held)
        if (pressSinceAtk === 0 && !held) viol.push({ k: 'attack with no press owed', d: { seed, k, ord: h.order } });
        pressSinceAtk = 0;
        // targeted: must be an in-range visible enemy
        if (ev.dst >= 0) {
          const t = w.entity(ev.dst);
          if (!t || t.team !== 1) viol.push({ k: 'attacked a non-enemy', d: { seed, dst: ev.dst } });
          else if (!inAttackRange(h, t)) viol.push({ k: 'targeted out of range', d: { seed, dst: ev.dst, d: Math.hypot(t.x - h.x, t.y - h.y) } });
          if (hidden && ev.dst === hidden.id) viol.push({ k: 'attacked the unseen enemy', d: { seed } });
        } else if (lastAim) {
          // I7 facing toward the aim
          const want = Math.atan2(h.atkAimY - h.y, h.atkAimX - h.x);
          let df = Math.abs(want - h.facing); df = Math.min(df, Math.PI * 2 - df);
          if (Math.hypot(h.atkAimX - h.x, h.atkAimY - h.y) > 0.05 && df > 5e-3) viol.push({ k: 'aimed attack not facing its aim', d: { seed, df } });
        }
      }
      if (ev.e === 'damage' && ev.src === h.id) {
        hits++;
        const t = w.entity(ev.dst);
        if (!t || t.team !== 1) viol.push({ k: 'damaged a non-enemy', d: { seed, dst: ev.dst } });
        else if (hidden && t.id === hidden.id) viol.push({ k: 'damaged the unseen enemy', d: { seed } });
        else if (hist.every(([px, py]) => Math.hypot(t.x - px, t.y - py) > h.stats.range + h.radius + t.radius + 1e-6)) viol.push({ k: 'hit beyond attack reach', d: { seed, k, who, gap: Math.hypot(t.x - h.x, t.y - h.y) - h.radius - t.radius - range } });
        else if (melee) {
          // a melee hit must be within the swing arc of the facing
          const a = Math.atan2(t.y - h.y, t.x - h.x); let df = Math.abs(a - h.facing); df = Math.min(df, Math.PI * 2 - df);
          if (df > (50 * Math.PI) / 180 + 1e-6) viol.push({ k: 'melee hit outside its 50 deg arc', d: { seed, deg: (df * 180) / Math.PI } });
        }
      }
    }
  }
  // settle statuses then compare stats (no stat change from attackAt)
  for (let k = 0; k < 60; k++) for (const ev of w.step()) evs.push(ev);
  computeStats(w, h);
  if (statsKey(h) !== stats0) viol.push({ k: 'stats changed', d: { seed, before: stats0.slice(0, 200), after: statsKey(h).slice(0, 200) } });
  if (w.entities.some((p) => p.kind === 'projectile' && !p.removed)) viol.push({ k: 'projectile left in flight', d: { seed } });
  const state = w.entities.map((e) => `${e.id}:${e.x.toFixed(9)},${e.y.toFixed(9)},${e.hp},${e.facing.toFixed(9)},${e.order},${e.atkCd.toFixed(9)}`).join('|');
  void presses;
  return { evs: JSON.stringify(evs), state, viol, attacks, hits, aimed };
}

section('fuzz: random worlds and command streams hold every attack-in-place invariant', () => {
  const byK = new Map<string, Viol[]>();
  let att = 0, hit = 0, aim = 0;
  for (let s = 1; s <= N; s++) { const r = scenario(s); att += r.attacks; hit += r.hits; aim += r.aimed; for (const v of r.viol) { const l = byK.get(v.k) ?? []; l.push(v); byK.set(v.k, l); } }
  console.log(`  ${N} scenarios: ${att} attacks (${aim} at the ground), ${hit} hits`);
  const kinds = ['walked under attackAt', 'faster than attack speed', 'attacked under hard CC', 'attacked while disarmed', 'attack with no press owed', 'attacked a non-enemy',
    'targeted out of range', 'attacked the unseen enemy', 'aimed attack not facing its aim', 'damaged a non-enemy', 'damaged the unseen enemy', 'hit beyond attack reach',
    'melee hit outside its 50 deg arc', 'stats changed', 'projectile left in flight'];
  for (const k of kinds) { const l = byK.get(k) ?? []; check(`fuzz: 0 x ${k}`, l.length === 0, { n: l.length, first: l.slice(0, 3) }); }
  for (const [k, l] of byK) if (!kinds.includes(k)) check(`fuzz: 0 x ${k}`, false, { n: l.length, first: l.slice(0, 3) });
  check('fuzz exercised attacks, ground shots and hits', att > N && aim > 20 && hit > 50, { att, aim, hit });
});

section('determinism: every fuzz stream run twice gives the same events and end state', () => {
  let bad = 0; const first: number[] = [];
  for (let s = 1; s <= Math.min(N, 120); s++) { const a = scenario(s), b = scenario(s); if (a.evs !== b.evs || a.state !== b.state) { bad++; if (first.length < 5) first.push(s); } }
  check('identical twice', bad === 0, { bad, first });
});

section('range sweep: a ground shot thrown with no target lands only where a targeted attack could', () => {
  let wrong = 0, inHits = 0; const det: unknown[] = [];
  for (const who of ['vx_slinger', 'vx_quick'] as const) for (let i = 0; i <= 80; i++) {
    const w = makeWorld(cat, [{ fighter: who, team: 0, x: 10, y: 20 }, { fighter: 'vx_foe', team: 1, x: 50, y: 55 }]);
    const h = fighterEnt(w, 0); computeStats(w, h);
    const d = h.stats.range + h.radius + 0.5 - 0.4 + i * 0.01;     // centre distance; target radius 0.5 (dummy)
    const u = addUnit(w, 'fx_dummy', 1, 10, 45);                    // off the line at the click
    w.command(0, { type: 'attackAt', x: 25, y: 20 });
    let moved = false, dmg = 0;
    for (let k = 0; k < 60; k++) { if (!moved && w.entities.some((p) => p.kind === 'projectile' && !p.removed)) { u.x = 10 + d; u.y = 20; w.hashDirty = true; moved = true; }
      for (const ev of w.step()) if (ev.e === 'damage' && ev.dst === u.id) dmg++; }
    const can = inAttackRange(h, u);
    if (dmg > 0 && !can) { wrong++; det.push({ who, d: d.toFixed(2), reach: (h.stats.range + h.radius + u.radius).toFixed(2) }); }
    if (dmg > 0 && can) inHits++;
  }
  check('no ground shot lands past targeted reach', wrong === 0, det.slice(0, 4));
  check('ground shots do land inside reach (sweep sanity)', inHits > 20, inHits);
});

section('wall: a ground shot thrown into a wall stops at it and does not hit an enemy behind the wall', () => {
  const w = makeWorld(cat, [{ fighter: 'vx_slinger', team: 0, x: 25.5, y: 20 }, { fighter: 'vx_foe', team: 1, x: 50, y: 55 }]);
  const h = fighterEnt(w, 0);
  const u = addUnit(w, 'fx_dummy', 1, 32.6, 30);   // beyond the wall (x 28-32), off the line first
  u.visibleMask = 0xffff;
  w.command(0, { type: 'attackAt', x: 40, y: 20 });
  let dmg = 0, moved = false;
  for (let k = 0; k < 60; k++) { if (!moved && w.entities.some((p) => p.kind === 'projectile' && !p.removed)) { u.x = 32.6; u.y = 20; u.visibleMask = 0xffff; w.hashDirty = true; moved = true; }
    for (const ev of w.step()) if (ev.e === 'damage' && ev.dst === u.id) dmg++; }
  check('no hit through the wall', dmg === 0, dmg);
  void h;
});

section('press then end in the same tick before any attack: still owes its one attack; end with no order changes nothing', () => {
  const w = makeWorld(cat, [{ fighter: 'vx_slinger', team: 0, x: 12, y: 30 }, { fighter: 'vx_foe', team: 1, x: 50, y: 55 }]);
  const h = fighterEnt(w, 0); const u = addUnit(w, 'fx_dummy', 1, 15, 30);
  w.command(0, { type: 'attackAt', x: 15, y: 30, target: u.id }); w.command(0, { type: 'attackAt', x: 15, y: 30, end: true });
  let n = 0; for (let k = 0; k < 90; k++) for (const ev of w.step()) if (ev.e === 'attack' && ev.src === h.id) n++;
  check('exactly one attack', n === 1, n);
  const w2 = makeWorld(cat, [{ fighter: 'vx_slinger', team: 0, x: 12, y: 30 }, { fighter: 'vx_foe', team: 1, x: 50, y: 55 }]);
  const h2 = fighterEnt(w2, 0);
  w2.command(0, { type: 'move', x: 20, y: 30 }); for (let k = 0; k < 3; k++) w2.step();
  const o = h2.order; w2.command(0, { type: 'attackAt', x: 0, y: 0, end: true }); for (let k = 0; k < 45; k++) w2.step();
  check('an end while moving does not cancel the move', h2.order === o || Math.hypot(h2.x - 20, h2.y - 30) < 0.6, { o, now: h2.order, at: [h2.x, h2.y] });
});

section('spamming fresh presses every tick at different points never beats attack speed', () => {
  for (const who of WHO) {
    const w = makeWorld(cat, [{ fighter: who, team: 0, x: 12, y: 30 }, { fighter: 'vx_foe', team: 1, x: 50, y: 55 }]);
    const h = fighterEnt(w, 0); computeStats(w, h); const p = 1 / h.stats.attackSpeed;
    const ts: number[] = [];
    for (let k = 0; k < 240; k++) { const a = k * 0.7; w.command(0, { type: 'attackAt', x: 12 + Math.cos(a) * 3, y: 30 + Math.sin(a) * 3 });
      if (k % 2) w.command(0, { type: 'attackAt', x: 12, y: 33, end: true });
      for (const ev of w.step()) if (ev.e === 'attack' && ev.src === h.id) ts.push(ev.t); }
    let g = Infinity; for (let i = 1; i < ts.length; i++) g = Math.min(g, ts[i] - ts[i - 1]);
    check(`${who}: ${ts.length} attacks in 8 s, min gap ${g.toFixed(3)} >= period ${p.toFixed(3)}`, g >= p - 1 / 30 - 1e-6 && ts.length <= Math.ceil(8 / p) + 1, { n: ts.length, g });
  }
});

finish('_tmp_vfy_ctl_r3_attackat');
