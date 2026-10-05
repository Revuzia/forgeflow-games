// SCRATCH ONLY (netcode lane). Three measurements in one run:
//  A) per-subsystem share of stepWorld (world.ts instrumented in the scratch copy -> globalThis.__prof)
//  B) spike census: ticks > 5 / 10 / 20 ms and when they happen
//  C) chaos / desync sensitivity: twin World B gets ONE 1-ulp perturbation of titan.x at tick K;
//     report ticks until hash differs, until titan pos differs > 1 cm, until an enemy count differs.
//  D) input-replay lockstep check: record the bot's inputs + draft picks on A, replay into a fresh World C
//     from inputs alone (no bot) -> final hash equal? (proves "inputs + picks" is the whole lockstep payload)
// node _harness/measure_net2.ts molo grideast 1337 9000
import type { World, TitanInput } from '../src/core/types.ts';
import { SIM_HZ } from '../src/core/config.ts';
const titan = (process.argv[2] ?? 'molo') as any, biome = (process.argv[3] ?? 'grideast') as any;
const seed = Number(process.argv[4] ?? 1337), K = Number(process.argv[5] ?? 9000);
const wm = await import('../src/core/world.ts');
const dm = await import('../src/upgrades/draft.ts');
const bm = await import('./bot.ts');
const tm = await import('../src/core/types.ts');
const mk = () => wm.createWorld({ titan, biome, seed, meta: { ...tm.EMPTY_RUN_META, unlocked: [] } as any });

const F64 = new Float64Array(1), U32 = new Uint32Array(F64.buffer);
function hashWorld(w: World): number {
  let h = 0x811c9dc5 >>> 0;
  const u = (x: number) => { for (let s = 0; s < 32; s += 8) { h ^= (x >>> s) & 0xff; h = Math.imul(h, 0x01000193) >>> 0; } };
  const n = (x: number) => { F64[0] = x; u(U32[0]); u(U32[1]); };
  const T = w.titan; n(w.tick); n(T.x); n(T.z); n(T.hp); n(T.xp); n(T.level);
  for (const e of w.enemies) if (e.alive) { n(e.x); n(e.z); n(e.hp); }
  for (const p of w.pickups) if (p.alive) { n(p.x); n(p.z); }
  if (w.boss) { n(w.boss.x); n(w.boss.z); n(w.boss.hp); }
  let fl = 0; for (const b of w.city.buildings) fl += b.alive; n(fl);
  return h >>> 0;
}

// ---- input codec: 4 bytes / player / tick (mx,mz int8 * 127; flags: ability, abilityHeld, dash, ultimate) ----
function enc(inp: TitanInput, out: Uint8Array, o: number): void {
  out[o] = (Math.round(inp.mx * 127) & 0xff); out[o + 1] = (Math.round(inp.mz * 127) & 0xff);
  out[o + 2] = (inp.ability ? 1 : 0) | (inp.abilityHeld ? 2 : 0) | (inp.dash ? 4 : 0) | (inp.ultimate ? 8 : 0);
  out[o + 3] = 0; // draft pick index (0 = none, 1..4 = card) lives here in an online build
}
function dec(b: Uint8Array, o: number): TitanInput {
  const s = (x: number) => (x > 127 ? x - 256 : x) / 127;
  return { mx: s(b[o]), mz: s(b[o + 1]), ability: !!(b[o + 2] & 1), abilityHeld: !!(b[o + 2] & 2), dash: !!(b[o + 2] & 4), ultimate: !!(b[o + 2] & 8) };
}

const A = mk(), B = mk();
const maxT = 26 * 60 * SIM_HZ;
const log: { inp: Uint8Array; picks: string[] }[] = [];
const spikes: { tick: number; ms: number }[] = [];
let firstHashDiff = -1, firstPosDiff = -1, firstCountDiff = -1, quantDiverge = -1;
let i = 0;
// quantized replay world Q: same picks, inputs passed through the 4-byte codec (what the wire would carry)
const Q = mk();
for (; i < maxT && !A.run.result; i++) {
  const picks: string[] = [];
  let g = 0;
  while (dm.hasPendingDraft(A) && g++ < 200) {
    const offer = A.upgrades.offer && A.upgrades.offer.length ? A.upgrades.offer : dm.rollOffer(A, A.upgrades.chestDrafts > 0);
    if (!offer || !offer.length) break;
    const p = bm.botPickUpgrade(A, offer); picks.push(p); dm.pickUpgrade(A, p);
  }
  const inp = bm.botInput(A);
  const buf = new Uint8Array(4); enc(inp, buf, 0);
  log.push({ inp: buf, picks });
  // B mirrors A's exact inputs + picks (twin), with one perturbation
  for (const p of picks) { if (dm.hasPendingDraft(B)) { const off = B.upgrades.offer && B.upgrades.offer.length ? B.upgrades.offer : dm.rollOffer(B, B.upgrades.chestDrafts > 0); if (off.includes(p)) dm.pickUpgrade(B, p); else dm.pickUpgrade(B, off[0]); } }
  if (i === K) { F64[0] = B.titan.x; U32[0] ^= 1; B.titan.x = F64[0]; }
  const t0 = performance.now();
  wm.stepWorld(A, inp);
  const ms = performance.now() - t0;
  if (ms > 5) spikes.push({ tick: i, ms: +ms.toFixed(1) });
  if (!B.run.result) wm.stepWorld(B, inp);
  if (i >= K && firstHashDiff < 0 && hashWorld(A) !== hashWorld(B)) firstHashDiff = i - K;
  if (i >= K && firstPosDiff < 0 && Math.hypot(A.titan.x - B.titan.x, A.titan.z - B.titan.z) > 0.01) firstPosDiff = i - K;
  if (i >= K && firstCountDiff < 0) { let a = 0, b = 0; for (const e of A.enemies) if (e.alive) a++; for (const e of B.enemies) if (e.alive) b++; if (a !== b) firstCountDiff = i - K; }
  // Q: picks then codec-decoded input
  for (const p of picks) { if (dm.hasPendingDraft(Q)) { const off = Q.upgrades.offer && Q.upgrades.offer.length ? Q.upgrades.offer : dm.rollOffer(Q, Q.upgrades.chestDrafts > 0); dm.pickUpgrade(Q, off.includes(p) ? p : off[0]); } }
  if (!Q.run.result) wm.stepWorld(Q, dec(buf, 0));
  if (quantDiverge < 0 && hashWorld(Q) !== hashWorld(A)) quantDiverge = i;
}
const prof = (globalThis as any).__prof as Record<string, number>;
const tot = Object.values(prof).reduce((a, b) => a + b, 0);
const share = Object.fromEntries(Object.entries(prof).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +(100 * v / tot).toFixed(1)]));

// D) replay from the recorded log only (exact inputs, not quantized) -> same final hash?
const C = mk();
for (let j = 0; j < log.length && !C.run.result; j++) {
  for (const p of log[j].picks) { if (dm.hasPendingDraft(C)) { const off = C.upgrades.offer && C.upgrades.offer.length ? C.upgrades.offer : dm.rollOffer(C, C.upgrades.chestDrafts > 0); dm.pickUpgrade(C, off.includes(p) ? p : off[0]); } }
  wm.stepWorld(C, dec(log[j].inp, 0));
}
let pickTicks = 0, pickTotal = 0; for (const l of log) if (l.picks.length) { pickTicks++; pickTotal += l.picks.length; }
console.log(JSON.stringify({
  titan, biome, seed, ticks: i, totalStepMs: +tot.toFixed(0), sharePct: share,
  spikesOver5ms: spikes.length, spikesOver10ms: spikes.filter(s => s.ms > 10).length, spikesOver20ms: spikes.filter(s => s.ms > 20).length, worstSpikes: spikes.sort((a, b) => b.ms - a.ms).slice(0, 6),
  chaos: { perturbAtTick: K, ticksToHashDiff: firstHashDiff, ticksToTitanPosDiff1cm: firstPosDiff, ticksToEnemyCountDiff: firstCountDiff },
  quantizedInputsVsFloatInputs_firstHashDivergenceTick: quantDiverge,
  replayFromQuantizedLog_matchesQ: hashWorld(C) === hashWorld(Q), replayTicks: C.tick, Qticks: Q.tick,
  draftPickTicks: pickTicks, draftPicks: pickTotal,
}));
