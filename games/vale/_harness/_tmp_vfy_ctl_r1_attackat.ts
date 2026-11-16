// adversarial verifier (controls r1, SIM lens): Shift + left-click attackAt on the REAL catalog and REAL maps (not the
// fixture catalog the lane's probe uses). Every fighter. DPS parity (no attack-speed or windup-cancel exploit), range
// parity, facing in every direction with zero displacement next to walls, statuses, fog/invisible/untargetable, walls,
// allies, stat invariance, and full-match determinism (same stream twice -> same state hash).
//   node _harness/_tmp_vfy_ctl_r1_attackat.ts
import type { CatalogT } from '../src/contracts/catalog.ts';
import type { Command, MatchSetup, SeatSetup, SimEvent } from '../src/contracts/sim.ts';
import { createWorld } from '../src/sim/core.ts';
import { createBots, pickLoadout } from '../src/sim/bots/index.ts';
import { createSim, worldOf } from '../src/sim/sim.ts';
import { spawnUnit } from '../src/sim/spawn.ts';
import { applyStatus } from '../src/sim/status.ts';
import { computeStats } from '../src/sim/stats.ts';
import { attackRange, inAttackRange } from '../src/sim/attack.ts';
import { ORDER_NONE, type Entity } from '../src/sim/entity.ts';
import type { World } from '../src/sim/world.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const catalog: CatalogT = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true })).catalog!;
let fails = 0, passes = 0;
const bad: string[] = [];
function check(name: string, ok: boolean, d?: unknown): void {
  if (ok) passes++; else { fails++; bad.push(`${name} ${d === undefined ? '' : JSON.stringify(d)}`); console.log(`  FAIL ${name} ${d === undefined ? '' : JSON.stringify(d)}`); }
}
const f2 = (n: number): string => n.toFixed(2);

function setup(modeId: string, f0: string, f1: string, seed = 7): MatchSetup {
  const mode = catalog.modes.find((m) => m.id === modeId)!;
  const queue = catalog.queues.find((q) => q.mode === mode.id)!;
  const seats: SeatSetup[] = [f0, f1].map((fighter, i) => ({ player: i, team: i, name: `p${i}`, fighter,
    skin: catalog.skins.find((s) => s.fighter === fighter)?.id ?? '', loadout: pickLoadout(catalog, fighter, mode.rules.itemPool ?? '', undefined),
    controller: 'bot', colorIndex: i } as SeatSetup));
  return { matchId: 'vfy', seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}
interface R { w: World; h: Entity; foe: Entity; evs: SimEvent[] }
function mk(fid: string, hx: number, hy: number, map = 'rift'): R {
  const w = createWorld(catalog, setup(map, fid, 'burdam'));
  const h = w.players[0].ent!, foe = w.players[1].ent!;
  h.x = hx; h.y = hy; foe.x = hx; foe.y = hy + 40; h.autoAttack = false; foe.autoAttack = false;
  w.hashDirty = true; w.vision.update(w.entities, w.tick);
  return { w, h, foe, evs: [] };
}
function post(r: R, team: number, x: number, y: number): Entity { const u = spawnUnit(r.w, 'sparring_post', team, x, y); u.autoAttack = false; r.w.hashDirty = true; r.w.vision.update(r.w.entities, r.w.tick); return u; }
function steps(r: R, n: number, each?: (k: number) => void): void { for (let k = 0; k < n; k++) { each?.(k); for (const e of r.w.step()) r.evs.push(e); } }
const hits = (r: R, id: number): number => r.evs.filter((e) => e.e === 'damage' && e.dst === id && e.src === r.h.id).length;
const atks = (r: R): number => r.evs.filter((e) => e.e === 'attack' && e.src === r.h.id).length;
const cmd = (r: R, c: Command): void => r.w.command(0, c);

// an open walkable spot on the rift: search for a point with every 8 m ray clear
function openSpot(w: World): { x: number; y: number } {
  const [W, H] = w.mapDef.size;
  let best: { x: number; y: number } | null = null, bestR = 0;
  for (let y = 5; y < H - 5; y += 1) for (let x = 5; x < W - 5; x += 1) {
    let rr = 0;
    for (let rad = 0.5; rad <= 9; rad += 0.5) {
      let ok = true;
      for (let a = 0; a < 24 && ok; a++) { const tx = x + Math.cos(a * Math.PI / 12) * rad, ty = y + Math.sin(a * Math.PI / 12) * rad; if (!w.nav.walkable(tx, ty)) ok = false; }
      if (!ok) break; rr = rad;
    }
    if (rr > bestR) { bestR = rr; best = { x, y }; }
    if (rr >= 9) return { x, y };
  }
  if (best && bestR >= 6.5) { console.log(`  open radius ${bestR}`); return best; }
  throw new Error('no open spot');
}
const probeW = createWorld(catalog, setup('rift', 'lisvel', 'burdam'));
const O = openSpot(probeW);
console.log(`open spot ${f2(O.x)},${f2(O.y)}`);

const fighters = catalog.fighters.map((f) => f.id);
const ranged = catalog.fighters.filter((f) => f.attack.projectileSpeed).map((f) => f.id);

if (process.env.MICRO) {
  for (const fid of ['sukri','ilsheta','lisvel']) {
    const r = mk(fid, O.x, O.y); steps(r, 1); computeStats(r.w, r.h);
    const pp = post(r, 1, O.x + 50, O.y); const L = attackRange(r.h) + r.h.radius + pp.radius;
    for (const dd of [0, 0.1, 0.14, 0.16, 0.2]) { pp.x = O.x + L + dd; r.w.hashDirty = true; console.log(fid, 'L', L.toFixed(3), 'dd', dd, 'inRange', inAttackRange(r.h, pp), 'stats.range', r.h.stats.range, 'def', r.h.attackDef!.range, 'hr', r.h.radius, 'pr', pp.radius); }
    const r2 = mk(fid, O.x, O.y);
    steps(r2, 150, (k) => { if (k % 3 === 0) cmd(r2, { type: 'attackAt', x: O.x + Math.cos(k) * 5, y: O.y + Math.sin(k) * 5 }); });
    let last = -1; steps(r2, 600, (k) => { if (r2.w.entities.some((p) => p.kind === 'projectile' && !p.removed && p.proj?.attack)) last = k; });
    console.log(fid, 'last tick with an attack shot alive after the stream:', last, 'attacks', atks(r2), 'shots', r2.evs.filter((e) => e.e === 'projectile' && e.src === r2.h.id).length);
  }
  process.exit(0);
}
console.log('== DPS parity: held attackAt (every 3 ticks) vs a plain attack order, 10 s, all fighters');
for (const fid of fighters) {
  const runA = (mode: 'attack' | 'held' | 'alt' | 'mix'): number => {
    const r = mk(fid, O.x, O.y);
    const reach = r.h.attackDef!.range + r.h.radius;
    const p = post(r, 1, O.x + reach * 0.6, O.y);
    const q = post(r, 1, O.x - reach * 0.6, O.y + 0.2);
    if (mode === 'attack') cmd(r, { type: 'attack', target: p.id });
    steps(r, 300, (k) => {
      if (mode === 'held' && k % 3 === 0) cmd(r, { type: 'attackAt', x: p.x, y: p.y, target: p.id });
      if (mode === 'alt' && k % 3 === 0) { const t = (k / 3) % 2 ? q : p; cmd(r, { type: 'attackAt', x: t.x, y: t.y, target: t.id }); }
      if (mode === 'mix') { if (k % 2) cmd(r, { type: 'attackAt', x: p.x, y: p.y, target: p.id }); else cmd(r, { type: 'attack', target: p.id }); }
    });
    check(`${fid} ${mode}: hero never moved`, Math.hypot(r.h.x - O.x, r.h.y - O.y) < 1e-9 || mode === 'attack', [f2(r.h.x - O.x), f2(r.h.y - O.y)]);
    return hits(r, p.id) + hits(r, q.id);
  };
  const base = runA('attack'), held = runA('held'), alt = runA('alt'), mix = runA('mix');
  check(`${fid} held DPS == plain attack (±1)`, Math.abs(held - base) <= 1, { base, held });
  check(`${fid} alternating aims: no more hits than plain`, alt <= base + 1, { base, alt });
  check(`${fid} alternating aims: not starved (>= half)`, alt >= base / 2, { base, alt });
  check(`${fid} attack/attackAt interleave: no more hits than plain`, mix <= base + 1, { base, mix });
}

console.log('== range parity: aimed (no target) hits vs inAttackRange edge, every fighter');
for (const fid of fighters) {
  const edgeOf = (aimed: boolean): number => {
    let lastHit = 0;
    for (let d = 0.8; d < 9; d += 0.05) {
      const r = mk(fid, O.x, O.y);
      const p = post(r, 1, O.x + d, O.y);
      cmd(r, aimed ? { type: 'attackAt', x: O.x + 12, y: O.y } : { type: 'attackAt', x: p.x, y: p.y, target: p.id });
      steps(r, 75);
      if (hits(r, p.id) > 0) lastHit = d; else if (lastHit > 0) break;
    }
    return lastHit;
  };
  const r0 = mk(fid, O.x, O.y), p0 = post(r0, 1, O.x + 50, O.y);
  computeStats(r0.w, r0.h); const legal = attackRange(r0.h) + r0.h.radius + p0.radius;
  const tgt = edgeOf(false), aim = edgeOf(true);
  check(`${fid} targeted attackAt reaches exactly attack range`, Math.abs(tgt - legal) <= 0.06, { tgt: f2(tgt), legal: f2(legal) });
  check(`${fid} aimed shot/swing never out-reaches attack range by > 0.2 m`, aim <= legal + 0.2, { aim: f2(aim), legal: f2(legal) });
  check(`${fid} aimed reaches >= attack range - 0.25 m`, aim >= legal - 0.25, { aim: f2(aim), legal: f2(legal) });
}

console.log('== facing in 16 directions, zero displacement, no attack-move, beside walls');
for (const fid of ['lisvel', 'dunsom', 'burdam', 'nurrow']) {
  for (let a = 0; a < 16; a++) {
    const ang = -Math.PI + a * Math.PI / 8 + 0.01;
    const r = mk(fid, O.x, O.y);
    post(r, 1, O.x + Math.cos(ang + Math.PI) * 3, O.y + Math.sin(ang + Math.PI) * 3);   // an enemy BEHIND
    cmd(r, { type: 'attackAt', x: O.x + Math.cos(ang) * 4, y: O.y + Math.sin(ang) * 4 });
    steps(r, 2);
    const df = Math.abs(Math.atan2(Math.sin(r.h.facing - ang), Math.cos(r.h.facing - ang)));
    steps(r, 40);
    check(`${fid} faces aim ${a}`, df < 0.02, f2(df));
    check(`${fid} aim ${a}: enemy behind not hit`, r.evs.filter((e) => e.e === 'damage' && e.src === r.h.id).length === 0);
    check(`${fid} aim ${a}: did not move`, Math.hypot(r.h.x - O.x, r.h.y - O.y) < 1e-9);
    check(`${fid} aim ${a}: order ended`, r.h.order === ORDER_NONE, r.h.order);
  }
}

console.log('== statuses (real fighters)');
for (const fid of ['lisvel', 'burdam']) {
  const reach = (r: R): number => r.h.attackDef!.range + r.h.radius;
  const one = (st: string, dur: number, when: 'before' | 'windup'): { hits: number; atk: number; moved: number; order: number } => {
    const r = mk(fid, O.x, O.y);
    const p = post(r, 1, O.x + reach(r) * 0.5, O.y);
    if (when === 'before') applyStatus(r.w, r.foe, r.h, st as never, dur);
    cmd(r, { type: 'attackAt', x: p.x, y: p.y, target: p.id });
    let did = false;
    steps(r, 60, () => { if (when === 'windup' && !did && r.h.atkWindup >= 0) { applyStatus(r.w, r.foe, r.h, st as never, dur); did = true; } });
    return { hits: hits(r, p.id), atk: atks(r), moved: Math.hypot(r.h.x - O.x, r.h.y - O.y), order: r.h.order };
  };
  for (const st of ['silence', 'slow', 'root', 'grievous', 'armor_shred', 'haste']) { const o = one(st, 3, 'before'); check(`${fid} ${st}: still attacks once`, o.hits === 1 && o.atk === 1, o); check(`${fid} ${st}: no move`, o.moved < 1e-9, o); }
  for (const st of ['stun', 'sleep', 'disarm', 'airborne']) { const o = one(st, 3, 'before'); check(`${fid} ${st}: no attack`, o.atk === 0 && o.hits === 0, o); check(`${fid} ${st}: order lapsed`, o.order === ORDER_NONE, o); }
  for (const st of ['stun', 'disarm', 'sleep']) { const o = one(st, 1, 'windup'); check(`${fid} ${st} mid-windup: no hit`, o.hits === 0, o); }
  { // stun ends before the order lapses: does the owed attack go off? (owed attack lapses 0.5 s after cd would allow)
    const o = one('stun', 0.3, 'before'); check(`${fid} 0.3 s stun before: the owed attack still goes off`, o.hits === 1, o);
  }
}

console.log('== vision / invisible / untargetable / ally / wall');
for (const fid of ranged) {
  { // invisible enemy fighter on the aim line within reach: neither picked nor hit
    const r = mk(fid, O.x, O.y);
    r.foe.x = O.x + 3; r.foe.y = O.y; r.w.hashDirty = true;
    applyStatus(r.w, r.foe, r.foe, 'invisible', 5);
    r.w.vision.update(r.w.entities, r.w.tick);
    cmd(r, { type: 'attackAt', x: O.x + 3, y: O.y, target: r.foe.id });
    steps(r, 60);
    check(`${fid} invisible foe: not hit`, hits(r, r.foe.id) === 0, { vis: r.foe.visibleMask, h: hits(r, r.foe.id) });
  }
  { // untargetable enemy fighter: not hit
    const r = mk(fid, O.x, O.y);
    r.foe.x = O.x + 3; r.foe.y = O.y; r.w.hashDirty = true; r.w.vision.update(r.w.entities, r.w.tick);
    applyStatus(r.w, r.foe, r.foe, 'untargetable', 5);
    cmd(r, { type: 'attackAt', x: O.x + 3, y: O.y });
    steps(r, 60);
    check(`${fid} untargetable foe: not hit`, hits(r, r.foe.id) === 0);
  }
  { // ally post in front, enemy behind it on the line: ally untouched, enemy hit
    const r = mk(fid, O.x, O.y);
    const al = post(r, 0, O.x + 1.6, O.y), en = post(r, 1, O.x + 3.4, O.y);
    cmd(r, { type: 'attackAt', x: O.x + 10, y: O.y });
    steps(r, 60);
    check(`${fid} ally on the line untouched`, r.evs.filter((e) => e.e === 'damage' && e.dst === al.id).length === 0);
    check(`${fid} enemy behind the ally hit once`, hits(r, en.id) === 1, hits(r, en.id));
  }
  { // two enemies on the line: only the first is hit
    const r = mk(fid, O.x, O.y);
    const a = post(r, 1, O.x + 30, O.y + 30), b = post(r, 1, O.x + 31, O.y + 30);
    cmd(r, { type: 'attackAt', x: O.x, y: O.y + 10 });
    let pl = false;
    steps(r, 60, () => { if (!pl && r.w.entities.some((q) => q.kind === 'projectile' && q.ownerEid === r.h.id && !q.removed)) { a.x = O.x; a.y = O.y + 2.5; b.x = O.x; b.y = O.y + 3.9; r.w.hashDirty = true; pl = true; } a.visibleMask = b.visibleMask = 0xffff; });
    check(`${fid} first enemy only`, hits(r, a.id) === 1 && hits(r, b.id) === 0, [hits(r, a.id), hits(r, b.id)]);
  }
  { // projectile count: one shot per attack, all gone after flight
    const r = mk(fid, O.x, O.y);
    steps(r, 150, (k) => { if (k % 3 === 0) cmd(r, { type: 'attackAt', x: O.x + Math.cos(k) * 5, y: O.y + Math.sin(k) * 5 }); });
    steps(r, 60);
    const sh = r.evs.filter((e) => e.e === 'projectile' && e.src === r.h.id).length;
    check(`${fid} one projectile per attack`, sh === atks(r), { sh, atk: atks(r) });
    const left = r.w.entities.filter((p) => p.kind === 'projectile' && !p.removed);
    check(`${fid} no ATTACK shot left in flight`, !left.some((p) => p.proj?.attack), left.map((p) => ({ own: p.ownerEid === r.h.id, att: p.proj?.attack, d: p.def, rng: p.proj?.range })));
  }
}
{ // a wall between hero and enemy (search a spot): the aimed shot stops at the wall
  const w = probeW; const [W, H] = w.mapDef.size;
  let spot: { x: number; y: number; ex: number; ey: number } | null = null;
  outer: for (let y = 5; y < H - 5; y += 1.3) for (let x = 5; x < W - 5; x += 1.3) {
    if (!w.nav.walkable(x, y) || !w.nav.wallFree(x, y)) continue;
    for (let d = 3; d <= 4.6; d += 0.4) {
      const ex = x + d, ey = y;
      if (!w.nav.walkable(ex, ey)) continue;
      const p = { x: 0, y: 0 }; w.nav.raycast(x, y, ex, ey, p, true);
      if (Math.hypot(p.x - x, p.y - y) > 0.8 && Math.hypot(p.x - ex, p.y - ey) > 1.2) { spot = { x, y, ex, ey }; break outer; }
    }
  }
  if (!spot) console.log('  (no wall spot found)');
  else for (const fid of ranged) {
    const r = mk(fid, spot.x, spot.y);
    const en = post(r, 1, spot.ex + 30, spot.ey + 30);
    cmd(r, { type: 'attackAt', x: spot.ex + 5, y: spot.ey });
    let pl = false;
    steps(r, 60, () => { if (!pl && r.w.entities.some((q) => q.kind === 'projectile' && q.ownerEid === r.h.id && !q.removed)) { en.x = spot!.ex; en.y = spot!.ey; r.w.hashDirty = true; pl = true; } en.visibleMask = 0xffff; });
    check(`${fid} aimed shot stops at a wall`, hits(r, en.id) === 0, { spot, h: hits(r, en.id) });
  }
}

console.log('== stats: attackAt changes no stat (vs a plain-attack twin)');
for (const fid of ['lisvel', 'ilsheta', 'burdam', 'kemdo']) {
  const snap = (useAt: boolean): string => {
    const r = mk(fid, O.x, O.y);
    const p = post(r, 1, O.x + 2, O.y);
    if (!useAt) cmd(r, { type: 'attack', target: p.id });
    steps(r, 240, (k) => { if (useAt && k % 3 === 0) cmd(r, { type: 'attackAt', x: p.x, y: p.y }); });
    computeStats(r.w, r.h);
    return JSON.stringify(r.h.stats);
  };
  const a = snap(true), b = snap(false);
  check(`${fid} stats identical`, a === b, a === b ? '' : { a: a.slice(0, 200), b: b.slice(0, 200) });
}

console.log('== determinism: a full RIFT and BRIDGE match, seat 0 shooting in place, run twice');
function stateHash(w: World): string {
  let h = 2166136261 >>> 0;
  const mix = (s: string): void => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } };
  for (const e of w.entities) if (!e.removed) mix(`${e.id}|${e.kind}|${e.x}|${e.y}|${e.hp}|${e.facing}|${e.atkCd}|${e.order};`);
  return `${w.tick}:${h.toString(16)}`;
}
for (const map of ['rift', 'bridge']) {
  const run = (): string[] => {
    const mode = catalog.modes.find((m) => m.id === map)!;
    const queue = catalog.queues.find((q) => q.mode === mode.id)!;
    const all = catalog.fighters.map((f) => f.id).sort();
    const seats: SeatSetup[] = [];
    for (let i = 0; i < 10; i++) { const f = i === 0 ? 'lisvel' : all[(i * 5) % all.length]; seats.push({ player: i, team: i < 5 ? 0 : 1, name: `p${i}`, fighter: f, skin: catalog.skins.find((s) => s.fighter === f)?.id ?? '', loadout: pickLoadout(catalog, f, mode.rules.itemPool ?? '', undefined), controller: i === 0 ? 'human' : 'bot', botDifficulty: 'veteran', colorIndex: i } as SeatSetup); }
    const st: MatchSetup = { matchId: 'det', seed: 4242, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
    const sim = createSim(catalog, st, { bots: createBots(catalog, st), pregameSeconds: 0 });
    const out: string[] = [];
    for (let t = 0; t < 30 * 240; t++) {
      const w = worldOf(sim);
      const me = w.players[0].ent!;
      if (t % 3 === 0 && me.alive) sim.command(0, { type: 'attackAt', x: me.x + Math.cos(t / 40) * 6, y: me.y + Math.sin(t / 40) * 6 });
      if (t % 90 === 45) sim.command(0, { type: 'move', x: me.x + Math.cos(t) * 8, y: me.y + Math.sin(t) * 8 });
      sim.step();
      if (t % 600 === 599) out.push(stateHash(worldOf(sim)));
    }
    return out;
  };
  const a = run(), b = run();
  check(`${map} same stream twice -> same hashes`, JSON.stringify(a) === JSON.stringify(b), { a: a.slice(-2), b: b.slice(-2) });
  console.log(`  ${map} hashes ${a.slice(-1)}`);
}

console.log(`RESULT ${passes} pass, ${fails} fail`);
for (const b of bad.slice(0, 60)) console.log(' -', b);
process.exit(fails ? 1 : 0);
