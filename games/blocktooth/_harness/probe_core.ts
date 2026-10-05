// BLOCKTOOTH — B-CORE probe: the multi-titan core contract (src/core/players.ts, world.ts createWorld / stepWorldN).
//
//   node _harness/probe_core.ts            # exit 0 = every check passed
//
// What it proves (see _spec/online/CORE_CONTRACT.md):
//   A  solo shape: 1 seat, cursor aliases players[0], every event is stamped p = 0, derived arrays are plain Arrays
//   B  createWorld({players, mode}) validation + the VS shape (seats, spawns apart, no locks, fresh meta, bot memory)
//   C  bindPlayer / unbindPlayer / withPlayer / emitAs: cursor aliasing, event stamping, restore
//   D  titan-scoped consumers read only their own player's events (stepTally)
//   E  a 4-seat VS world steps with distinct per-seat inputs: seats move independently, every event is stamped,
//      per-player tonnage never exceeds the world total, the cursor ends on the view slot every tick
//   F  determinism: two identical VS worlds hash identically tick for tick, AND the view slot (setViewSlot) never changes
//      the sim (cursor leaks would)
//   G  spawn layout over every biome x seeds: 4 distinct points, >= 2 road pitches apart, inside the bounds
// Solo behaviour itself is proven by GATE 2 (probe_sim.ts hashes), not here.

import { createWorld, setViewSlot, stepWorld, stepWorldN, NO_INPUT } from '../src/core/world.ts';
import { bindPlayer, createEventSink, emitAs, setBindAsserts, unbindPlayer, withPlayer } from '../src/core/players.ts';
import { stepTally } from '../src/meta/tally.ts';
import type { BiomeId, PlayerSeat, SimEvent, TitanId, TitanInput, World } from '../src/core/types.ts';
import { BIOME_IDS, TITAN_IDS } from '../src/core/types.ts';

let fails = 0, checks = 0;
function ok(cond: boolean, what: string, detail = ''): void {
  checks++;
  if (!cond) { fails++; console.log(`  FAIL  ${what}${detail ? ' — ' + detail : ''}`); }
}
function section(s: string): void { console.log(`\n[${s}]`); }

function threw(fn: () => unknown): string | null {
  try { fn(); return null; } catch (e) { return String((e as Error).message ?? e); }
}

// ───────────────────────── deterministic per-seat inputs ─────────────────────────
const DIRS: [number, number][] = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];
function seatInput(slot: number, tick: number): TitanInput {
  const d = DIRS[(Math.floor(tick / 90) + slot * 3) % 8];
  return { mx: d[0], mz: d[1], ability: tick % 120 === 7 + slot, abilityHeld: false, dash: tick % 200 === 11 + 3 * slot, ultimate: tick % 700 === 600 + slot };
}

// ───────────────────────── a wide world hash over every seat ─────────────────────────
function hashAll(w: World): number {
  let h = 0x811c9dc5;
  const f = new Float64Array(1), u = new Uint32Array(f.buffer);
  const num = (x: number): void => { f[0] = x; h ^= u[0]; h = Math.imul(h, 0x01000193); h ^= u[1]; h = Math.imul(h, 0x01000193); };
  num(w.tick); num(w.t); num(w.nextId);
  for (const p of w.players) {
    const T = p.titan;
    num(T.x); num(T.z); num(T.heading); num(T.hp); num(T.maxHp); num(T.level); num(T.xp); num(T.rank); num(T.height); num(T.kills);
    num(p.tally.kills); num(p.tally.floors); num(p.tally.collapses); num(p.run.tonnage); num(p.run.blocksLeveled);
    num(p.ult.charge ?? 0); num(p.upgrades.pendingDrafts);
    for (const k of Object.keys(p.upgrades.owned).sort()) num(p.upgrades.owned[k]);
  }
  let n = 0;
  for (const e of w.enemies) { if (!e.alive) continue; n++; num(e.id); num(e.x); num(e.z); num(e.hp); }
  num(n);
  for (const pk of w.pickups) { if (pk.alive) { num(pk.id); num(pk.x); num(pk.z); } }
  for (const b of w.city.buildings) { num(b.alive); num(b.floorHp); }
  num(w.run.tonnage); num(w.run.blocksLeveled); num(w.run.peakRank);
  return h >>> 0;
}

const SEATS4: PlayerSeat[] = [
  { titan: 'molo' }, { titan: 'voltkite', bot: 'regular' }, { titan: 'hearthback', bot: 'rookie' }, { titan: 'briarwick', bot: 'veteran' },
];

// ═══════════════════════════ A. solo shape ═══════════════════════════
section('A. solo shape');
{
  const w = createWorld({ titan: 'molo', biome: 'grideast', seed: 1337 });
  ok(w.mode === 'solo' && w.vs === null, 'solo: mode solo, vs null');
  ok(w.players.length === 1 && w.cur === 0 && w.view === 0 && w.pl === w.players[0], 'solo: 1 seat, cur 0, view 0');
  const p = w.players[0];
  ok(w.titan === p.titan && w.upgrades === p.upgrades && w.ult === p.ult && w.tally === p.tally && w.meta === p.meta && w.director === p.director && w.input === p.input && w.titanId === p.titanId,
    'solo: every cursor field aliases players[0]');
  ok(p.bot === null && p.rail.open === false && p.vs.eliminated === false, 'solo: human seat, rail idle, vs neutral');
  ok(w.gates.unlocked === 0, 'solo: gates start LOCKED (unlocked 0), unlike VS');
  const inp: TitanInput = { mx: 1, mz: 0, ability: false, abilityHeld: false, dash: false };
  let evSeen = 0, bad = 0;
  for (let i = 0; i < 1500; i++) {
    stepWorld(w, inp);
    ok(w.input === inp && w.cur === 0 && w.pl === p, 'solo: input latched through the cursor; cursor stays on seat 0', `tick ${w.tick}`);
    for (const e of w.events) { evSeen++; if (e.p !== 0) bad++; }
  }
  ok(evSeen > 0, 'solo: the run produced events', `${evSeen}`);
  ok(bad === 0, 'solo: every event is stamped p = 0', `${bad} of ${evSeen} not`);
  const sl = w.events.slice();
  ok(Array.isArray(sl) && sl.constructor === Array, 'events.slice() is a plain Array (species)');
  ok(Math.abs(p.run.tonnage - w.run.tonnage) < 1e-9, 'solo: player tonnage == world tonnage', `${p.run.tonnage} vs ${w.run.tonnage}`);
  ok(p.run.peakRank === w.run.peakRank && p.run.blocksLeveled === w.run.blocksLeveled, 'solo: player peakRank / blocks == world');
  ok(w.run.tonnage > 0, 'solo: the titan flattened something (tonnage > 0)', `${w.run.tonnage}`);
}

// ═══════════════════════════ B. createWorld validation + VS shape ═══════════════════════════
section('B. createWorld validation + VS shape');
{
  ok(threw(() => createWorld({ biome: 'grideast', seed: 1, mode: 'solo', players: [{ titan: 'molo' }, { titan: 'molo' }] })) !== null, 'solo with 2 seats throws');
  ok(threw(() => createWorld({ biome: 'grideast', seed: 1, mode: 'vs', players: [...SEATS4, { titan: 'molo' }] })) !== null, 'vs with 5 seats throws');
  ok(threw(() => createWorld({ biome: 'grideast', seed: 1, mode: 'vs', players: [{ titan: 'nope' as TitanId }] })) !== null, 'unknown titan throws');
  const w = createWorld({ biome: 'whitestacks', seed: 7, mode: 'vs', players: SEATS4, view: 2 });
  ok(w.mode === 'vs' && w.vs !== null && w.vs.phase === 'countdown', 'vs: mode vs, vs state present, phase countdown');
  ok(w.players.length === 4 && w.view === 2 && w.cur === 2 && w.pl === w.players[2] && w.titan === w.players[2].titan, 'vs: 4 seats, cursor bound to the view seat (2)');
  ok(w.gates.unlocked === 4, 'vs: no size locks (gates.unlocked 4)');
  ok(w.players.map((p) => p.titanId).join() === 'molo,voltkite,hearthback,briarwick', 'vs: seat titans');
  ok(w.players.map((p) => p.bot === null).join() === 'true,false,false,false', 'vs: bot memory only on bot seats');
  ok(w.players.every((p, i) => p.slot === i && p.titan.hp === p.titan.maxHp && p.titan.alive && p.titan.maxHp > 0), 'vs: slots, full HP, alive');
  ok(w.players.every((p) => p.meta.perk === null && p.meta.unlocked.length === 0), 'vs: fresh-profile pool (no perk, no unlocks)');
  ok(w.players.every((p) => p.upgrades !== w.players[0].upgrades || p === w.players[0]), 'vs: upgrade states are distinct objects');
  const set = new Set(w.players.map((p) => p.director));
  ok(set.size === 4, 'vs: per-player directors');
  const pal = createWorld({ biome: 'grideast', seed: 1, mode: 'vs', players: [{ titan: 'molo', meta: { unlocked: ['x'], perk: 'perk_petty_cash', palette: 2, reviveUsed: false } }] });
  ok(pal.players[0].meta.palette === 2 && pal.players[0].meta.perk === null && pal.players[0].meta.unlocked.length === 0, 'vs: palette kept, perk + unlocks stripped');
  const solo2 = createWorld({ biome: 'grideast', seed: 1, players: [{ titan: 'briarwick' }] });
  ok(solo2.mode === 'solo' && solo2.titanId === 'briarwick', 'solo via players[0]');
}

// ═══════════════════════════ C. cursor + sink ═══════════════════════════
section('C. bindPlayer / unbindPlayer / withPlayer / emitAs');
{
  const w = createWorld({ biome: 'grideast', seed: 5, mode: 'vs', players: SEATS4 });
  for (let i = 0; i < 4; i++) {
    bindPlayer(w, i);
    const p = w.players[i];
    ok(w.cur === i && w.titan === p.titan && w.upgrades === p.upgrades && w.ult === p.ult && w.tally === p.tally && w.meta === p.meta && w.director === p.director && w.input === p.input && w.titanId === p.titanId && w.pl === p,
      `bindPlayer(${i}) aliases every cursor field`);
    w.events.push({ type: 'pulse', x: 0, z: 0, r: 1 });
    ok(w.events[w.events.length - 1].p === i, `event pushed while ${i} is bound is stamped p = ${i}`);
  }
  unbindPlayer(w);
  ok(w.cur === -1 && w.titan === w.players[0].titan, 'unbindPlayer: cur -1, cursor falls back to slot 0');
  w.events.push({ type: 'pulse', x: 0, z: 0, r: 1 });
  ok(w.events[w.events.length - 1].p === -1, 'event pushed unbound is p = -1');
  const r = withPlayer(w, 3, () => { w.events.push({ type: 'pulse', x: 1, z: 1, r: 1 }); return w.cur; });
  ok(r === 3 && w.events[w.events.length - 1].p === 3 && w.cur === -1, 'withPlayer binds, stamps, and restores the UNBOUND state');
  bindPlayer(w, 1);
  withPlayer(w, 2, () => 0);
  ok(w.cur === 1 && w.titan === w.players[1].titan, 'withPlayer restores a bound player');
  emitAs(w, 2, { type: 'pulse', x: 2, z: 2, r: 1 });
  ok(w.events[w.events.length - 1].p === 2 && w.cur === 1, 'emitAs stamps the named slot and leaves the binding alone');
  const pre: SimEvent = { type: 'pulse', x: 3, z: 3, r: 1, p: 0 };
  w.events.push(pre);
  ok(pre.p === 0, 'an explicit p wins over the bound slot');
  setBindAsserts(true);
  const e1 = threw(() => { unbindPlayer(w); void 0; });
  ok(e1 === null, 'unbind is legal with asserts on');
  setBindAsserts(false);
  const sink = createEventSink({ cur: 5 });
  sink.push({ type: 'pulse', x: 0, z: 0, r: 1 }, { type: 'pulse', x: 0, z: 0, r: 2 });
  ok(sink.length === 2 && sink[0].p === 5 && sink[1].p === 5, 'multi-arg push stamps every event');
  sink.length = 0;
  ok(sink.length === 0, 'length = 0 clears the sink');
}

// ═══════════════════════════ D. consumers read only their own events ═══════════════════════════
section('D. titan-scoped consumers read only their own player\'s events');
{
  const w = createWorld({ biome: 'grideast', seed: 9, mode: 'vs', players: SEATS4 });
  w.events.length = 0;
  bindPlayer(w, 1);
  w.events.push({ type: 'enemyKilled', id: 1, kind: 'android', x: 0, z: 0, crushed: false });   // p = 1
  bindPlayer(w, 0);
  const k0 = w.players[0].tally.kills, k1 = w.players[1].tally.kills;
  stepTally(w);
  ok(w.players[0].tally.kills === k0, 'seat 0 tally ignores seat 1\'s kill');
  bindPlayer(w, 1);
  stepTally(w);
  ok(w.players[1].tally.kills === k1 + 1, 'seat 1 tally counts its own kill');
  bindPlayer(w, 2);
  stepTally(w);
  ok(w.players[2].tally.kills === 0, 'seat 2 tally still 0');
}

// ═══════════════════════════ E. a 4-seat VS world steps ═══════════════════════════
section('E. 4-seat VS stepping');
{
  const w = createWorld({ biome: 'grideast', seed: 1337, mode: 'vs', players: SEATS4 });
  const last = w.players.map((p) => ({ x: p.titan.x, z: p.titan.z }));
  const travel = [0, 0, 0, 0];   // path length (the inputs walk a loop, so net displacement says nothing)
  const evCount = [0, 0, 0, 0, 0];   // index 0..3 = slot, 4 = unbound (-1)
  let unstamped = 0, badP = 0, cursorOff = 0;
  const inputs: TitanInput[] = [NO_INPUT, NO_INPUT, NO_INPUT, NO_INPUT];
  const killsSeen = [0, 0, 0, 0];
  const TICKS = 3600;
  for (let t = 0; t < TICKS; t++) {
    for (let i = 0; i < 4; i++) inputs[i] = seatInput(i, w.tick);
    stepWorldN(w, inputs);
    if (w.cur !== w.view) cursorOff++;
    for (let i = 0; i < 4; i++) { const T = w.players[i].titan; travel[i] += Math.hypot(T.x - last[i].x, T.z - last[i].z); last[i].x = T.x; last[i].z = T.z; }
    for (const e of w.events) {
      if (e.p === undefined) { unstamped++; continue; }
      if (e.p === -1) evCount[4]++;
      else if (e.p >= 0 && e.p < 4) { evCount[e.p]++; if (e.type === 'enemyKilled') killsSeen[e.p]++; }
      else badP++;
    }
  }
  ok(w.tick === TICKS, '4-seat world advanced', `tick ${w.tick}`);
  ok(unstamped === 0 && badP === 0, 'every event stamped with a legal p', `unstamped ${unstamped} bad ${badP}`);
  ok(cursorOff === 0, 'the cursor ended every tick on the view seat');
  for (let i = 0; i < 4; i++) {
    const T = w.players[i].titan;
    ok(travel[i] > 50, `seat ${i} walked on its own input`, `${travel[i].toFixed(1)} m of path`);
    ok(evCount[i] > 0, `seat ${i} produced events`, `${evCount[i]}`);
    ok(w.players[i].tally.kills === killsSeen[i], `seat ${i} tally.kills == its stamped enemyKilled events`, `${w.players[i].tally.kills} vs ${killsSeen[i]}`);
  }
  const posKeys = new Set(w.players.map((p) => `${p.titan.x.toFixed(1)},${p.titan.z.toFixed(1)}`));
  ok(posKeys.size === 4, 'four different titan positions after the run');
  let sumT = 0;
  for (const p of w.players) { ok(p.run.tonnage >= 0, 'player tonnage >= 0'); sumT += p.run.tonnage; }
  ok(sumT <= w.run.tonnage + 1e-6, 'sum of player tonnage <= world tonnage', `${sumT.toFixed(1)} vs ${w.run.tonnage.toFixed(1)}`);
  ok(sumT > 0, 'players were credited tonnage', `${sumT.toFixed(1)}`);
  // late guest: a null input repeats the previous one
  const w2 = createWorld({ biome: 'grideast', seed: 3, mode: 'vs', players: SEATS4 });
  const mv: TitanInput = { mx: 1, mz: 0, ability: false, abilityHeld: false, dash: false };
  stepWorldN(w2, [mv, mv, mv, mv]);
  stepWorldN(w2, [null, undefined, mv]);
  ok(w2.players[0].input === mv && w2.players[1].input === mv, 'a null / missing input keeps the seat\'s previous input');
  console.log(`  events by slot: ${evCount.slice(0, 4).join('/')} unbound ${evCount[4]}; tonnage by slot: ${w.players.map((p) => p.run.tonnage.toFixed(0)).join('/')} of ${w.run.tonnage.toFixed(0)}`);
}

// ═══════════════════════════ F. determinism + view independence ═══════════════════════════
section('F. determinism + the view slot never changes the sim');
{
  const a = createWorld({ biome: 'lockwater', seed: 21, mode: 'vs', players: SEATS4, view: 0 });
  const b = createWorld({ biome: 'lockwater', seed: 21, mode: 'vs', players: SEATS4, view: 0 });
  const c = createWorld({ biome: 'lockwater', seed: 21, mode: 'vs', players: SEATS4, view: 3 });
  const ia: TitanInput[] = [NO_INPUT, NO_INPUT, NO_INPUT, NO_INPUT];
  let firstDiffAB = -1, firstDiffAC = -1;
  const N = 2400;
  for (let t = 0; t < N; t++) {
    for (let i = 0; i < 4; i++) ia[i] = seatInput(i, a.tick);
    stepWorldN(a, ia); stepWorldN(b, ia); stepWorldN(c, ia);
    if (t % 10 === 0) {
      if (firstDiffAB < 0 && hashAll(a) !== hashAll(b)) firstDiffAB = a.tick;
      if (firstDiffAC < 0 && hashAll(a) !== hashAll(c)) firstDiffAC = a.tick;
    }
    if (t === 1200) setViewSlot(c, 1);          // flipping the view mid-run must not matter either
  }
  ok(firstDiffAB < 0, 'two identical VS worlds hash identically', firstDiffAB >= 0 ? `diverged at tick ${firstDiffAB}` : '');
  ok(firstDiffAC < 0, 'view slot 3 / switching to 1 mid-run changes nothing in the sim', firstDiffAC >= 0 ? `diverged at tick ${firstDiffAC}` : '');
  ok(hashAll(a) === hashAll(b) && hashAll(a) === hashAll(c), 'final hashes equal', `${hashAll(a).toString(16)} ${hashAll(b).toString(16)} ${hashAll(c).toString(16)}`);
  console.log(`  final hash ${hashAll(a).toString(16)} after ${N} ticks, 4 seats`);
}

// ═══════════════════════════ G. spawn layout ═══════════════════════════
section('G. VS spawn layout');
{
  let worst = Infinity;
  for (const biome of BIOME_IDS as readonly BiomeId[]) {
    for (const seed of [1337, 7, 99, 21]) {
      const w = createWorld({ biome, seed, mode: 'vs', players: TITAN_IDS.map((t) => ({ titan: t })) });
      const b = w.city.bounds;
      const pts = w.players.map((p) => p.titan);
      let minD = Infinity;
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) minD = Math.min(minD, Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z));
        ok(pts[i].x >= b.minX && pts[i].x <= b.maxX && pts[i].z >= b.minZ && pts[i].z <= b.maxZ, `${biome}/${seed}: seat ${i} inside the bounds`);
      }
      ok(minD >= 2 * w.city.pitch - 1e-6, `${biome}/${seed}: seats >= 2 pitches apart`, `${minD.toFixed(1)} m`);
      worst = Math.min(worst, minD);
      ok(pts[0].x === w.city.spawn.x && pts[0].z === w.city.spawn.z, `${biome}/${seed}: seat 0 keeps the solo spawn`);
    }
  }
  console.log(`  closest pair over 12 worlds: ${worst.toFixed(1)} m`);
}

console.log(`\nprobe_core: ${checks - fails}/${checks} checks passed${fails ? ' — ' + fails + ' FAILED' : ''}`);
process.exit(fails ? 1 : 0);
