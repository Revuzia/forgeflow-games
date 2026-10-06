// BLOCKTOOTH — cross-engine determinism probe, bundle entry (ONLINE_PLAN gate H1, lane B-DET; port of
// _spec/online/netcode_lab/xengine_entry.ts). probe_xbrowser.py bundles this with rolldown (iife) and runs the SAME
// bot-driven runs in Node, Chromium, Firefox and WebKit; every engine must produce identical checkpoint hashes.
//
// Unlike the lab prototype there is no installDetMath(): the production sim imports src/core/detmath.ts directly
// (and _harness/detban.ts keeps it that way), so this measures exactly what ships.
//
// Harness code: reads the world, never writes gameplay state. Date.now() only times the run.

import type { BiomeId, RunMeta, TitanId, World } from '../../src/core/types.ts';
import { EMPTY_RUN_META } from '../../src/core/types.ts';
import { createWorld, stepWorld, stepWorldN } from '../../src/core/world.ts';
import { hasPendingDraft, rollOffer, pickUpgrade } from '../../src/upgrades/draft.ts';
import { UPGRADES } from '../../src/data/upgrades.ts';
import * as D from '../../src/core/detmath.ts';
import { botInput, botPickUpgrade } from '../bot.ts';
import { vsStateFlat } from '../../src/net/vshash.ts';
import type { HashAtom } from '../../src/net/vshash.ts';
import { vsWorldPort, vsStartInfo, hashWorld as portHash, VS_MATCH_TICKS } from '../../src/net/simport.ts';
import { NET_PROTO, SEATS, INPUT_BYTES, CARD, encodeInput, type Frame } from '../../src/net/proto.ts';

const F64 = new Float64Array(1), U32 = new Uint32Array(F64.buffer);
class Hasher {
  h = 0x811c9dc5 >>> 0;
  u(x: number): void { for (let s = 0; s < 32; s += 8) { this.h ^= (x >>> s) & 0xff; this.h = Math.imul(this.h, 0x01000193) >>> 0; } }
  n(x: number): void { F64[0] = x; this.u(U32[0]); this.u(U32[1]); }
  s(x: string): void { for (let i = 0; i < x.length; i++) { this.h ^= x.charCodeAt(i) & 0xff; this.h = Math.imul(this.h, 0x01000193) >>> 0; } }
  hex(): string { return (this.h >>> 0).toString(16).padStart(8, '0'); }
}

/** Wide state hash: titan, every live enemy / pickup / projectile, every prop, every building's floors + HP, the boss,
 *  owned upgrades and run counters (wider than probe_sim's GATE 2 hash, so a divergence shows at the first checkpoint). */
export function hashWorld(w: World): string {
  const hs = new Hasher();
  const T = w.titan;
  hs.n(w.tick); hs.n(w.t); hs.n(w.nextId);
  for (const v of [T.x, T.z, T.heading, T.vx, T.vz, T.hp, T.maxHp, T.mass, T.xp, T.level, T.rank, T.height, T.radius,
    T.kills, T.crushed, T.floorsEaten, T.propsEaten, T.damageTaken, T.abilityCd, T.dashCharges]) hs.n(v);
  let n = 0;
  for (const e of w.enemies) if (e.alive) { n++; hs.s(e.kind); hs.n(e.x); hs.n(e.z); hs.n(e.y); hs.n(e.hp); hs.n(e.heading); }
  hs.n(n); n = 0;
  for (const p of w.pickups) if (p.alive) { n++; hs.n(p.x); hs.n(p.z); }
  hs.n(n); n = 0;
  for (const p of w.projectiles) if (p.alive) { n++; hs.n(p.x); hs.n(p.z); hs.n(p.y); }
  hs.n(n);
  for (const p of w.city.props) { hs.n(p.x); hs.n(p.z); hs.n(p.heading); hs.n(p.alive ? 1 : 0); }
  for (const b of w.city.buildings) { hs.n(b.alive); hs.n(b.floorHp); }
  if (w.boss) { hs.s(w.boss.id); hs.n(w.boss.x); hs.n(w.boss.z); hs.n(w.boss.hp); hs.n(w.boss.phase); hs.n(w.boss.meter); }
  for (const k of Object.keys(w.upgrades.owned).sort()) { hs.s(k); hs.n(w.upgrades.owned[k]); }
  hs.n(w.run.tonnage); hs.n(w.run.blocksLeveled);
  if (w.mode === 'vs') {   // VS: every seat's titan / build / rail / VS record / bot memory + the phase, crown, ring, tenders
    const a: HashAtom[] = [];
    vsStateFlat(w, a);
    for (const x of a) { if (typeof x === 'string') hs.s(x); else hs.n(x); }
    for (const p of w.players) { hs.n(p.ult.charge ?? 0); hs.n(p.tally.kills ?? 0); }
  }
  return hs.hex();
}

/** Bit-level hashes of the detmath functions over 200k deterministic inputs (must match in every engine) and of the
 *  engine's native Math for the same inputs (information: shows which built-ins differ from Node in that engine). */
function mathHashes(): { det: Record<string, string>; native: Record<string, string> } {
  let s = 12345 >>> 0;
  const r = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const N = 200000;
  const xs = new Float64Array(N), ys = new Float64Array(N);
  for (let i = 0; i < N; i++) { xs[i] = (r() - 0.5) * 2000; ys[i] = (r() - 0.5) * 2000; }
  const M = Math as unknown as Record<string, (...a: number[]) => number>;
  const pairs: Record<string, [(i: number) => number, (i: number) => number]> = {
    sin: [(i) => D.sin(xs[i] * 0.01), (i) => M.sin(xs[i] * 0.01)],
    cos: [(i) => D.cos(xs[i] * 0.01), (i) => M.cos(xs[i] * 0.01)],
    tan: [(i) => D.tan(xs[i] * 0.001), (i) => M.tan(xs[i] * 0.001)],
    atan2: [(i) => D.atan2(ys[i], xs[i]), (i) => M.atan2(ys[i], xs[i])],
    asin: [(i) => D.asin(ys[i] / 1000.0001), (i) => M.asin(ys[i] / 1000.0001)],
    exp: [(i) => D.exp(xs[i] * 0.005), (i) => M.exp(xs[i] * 0.005)],
    log: [(i) => D.log(Math.abs(xs[i]) + 1e-3), (i) => M.log(Math.abs(xs[i]) + 1e-3)],
    pow: [(i) => D.pow(Math.abs(xs[i]) * 0.01 + 0.5, 1.37), (i) => M.pow(Math.abs(xs[i]) * 0.01 + 0.5, 1.37)],
    hypot: [(i) => D.hypot(xs[i], ys[i]), (i) => M.hypot(xs[i], ys[i])],
    sinBig: [(i) => D.sin(xs[i] * 1000), (i) => M.sin(xs[i] * 1000)],
  };
  const det: Record<string, string> = {}, native: Record<string, string> = {};
  for (const k of Object.keys(pairs)) {
    const [fd, fn] = pairs[k];
    const a = new Hasher(), b = new Hasher();
    for (let i = 0; i < N; i++) { a.n(fd(i)); b.n(fn(i)); }
    det[k] = a.hex(); native[k] = b.hex();
  }
  return { det, native };
}

export interface ProbeRun {
  titan: string; biome: string; seed: number; meta: string; ticks: number; checkpointEvery: number;
  checkpoints: string[]; final: string; result: string | null; endT: number; level: number; ms: number;
}

export function runProbe(titan: string, biome: string, seed: number, ticks: number, metaKind = 'fresh', every = 300): ProbeRun {
  const t0 = Date.now();
  const meta: RunMeta = metaKind === 'full'
    ? { ...EMPTY_RUN_META, unlocked: UPGRADES.filter((u) => u.locked).map((u) => u.id).sort() }
    : { ...EMPTY_RUN_META, unlocked: [] };
  const w = createWorld({ titan: titan as TitanId, biome: biome as BiomeId, seed, meta });
  const cps: string[] = [];
  let i = 0;
  for (; i < ticks && !w.run.result; i++) {
    let g = 0;
    while (hasPendingDraft(w) && g++ < 200) {
      const offer = w.upgrades.offer && w.upgrades.offer.length ? w.upgrades.offer : rollOffer(w, w.upgrades.chestDrafts > 0);
      if (!offer || !offer.length) break;
      pickUpgrade(w, botPickUpgrade(w, offer));
    }
    stepWorld(w, botInput(w));
    if ((i + 1) % every === 0) cps.push(hashWorld(w));
  }
  return { titan, biome, seed, meta: metaKind, ticks: i, checkpointEvery: every, checkpoints: cps, final: hashWorld(w),
    result: w.run.result ?? null, endT: w.t, level: w.titan.level, ms: Date.now() - t0 };
}

/** A VS match: 4 native bot seats (the VS bot brain runs INSIDE stepWorldN), the whole 4-seat world hashed every `every` ticks.
 *  `titan` is the 4 titan ids joined by '+' (or one id for a mirror lineup). Ends at the match end or `ticks`. */
export function runProbeVs(lineup: string, biome: string, seed: number, ticks: number, every = 300): ProbeRun {
  const t0 = Date.now();
  const ids = lineup.split('+') as TitanId[];
  const four = ids.length === 4 ? ids : [ids[0], ids[0], ids[0], ids[0]];
  const w = createWorld({ mode: 'vs', biome: biome as BiomeId, seed, view: 0, players: four.map((t) => ({ titan: t, bot: 'regular' as const })) });
  const cps: string[] = [];
  const none: null[] = [null, null, null, null];
  let i = 0;
  for (; i < ticks && !w.run.result; i++) {
    stepWorldN(w, none);
    if ((i + 1) % every === 0) cps.push(hashWorld(w));
  }
  const lv = Math.max(...w.players.map((p) => p.titan.level));
  return { titan: 'vs:' + four.join('+'), biome, seed, meta: 'vs', ticks: i, checkpointEvery: every, checkpoints: cps, final: hashWorld(w),
    result: w.run.result ?? null, endT: w.t, level: lv, ms: Date.now() - t0 };
}

// ─────────────────────────────── VS LOCKSTEP (lane O-PORT, gate H1 / H6 sim part) ───────────────────────────────
// The 4-seat VS match driven the way the online session drives it: CANONICAL FRAMES (lateMask, botMask, 4 x 4-byte words incl. the
// CARD RAIL byte) through src/net/simport.ts vsWorldPort.step, hashed with the port's own all-player hash and standings. The frame log
// is a pure function of (seed, tick) - it never reads the world - so every engine steps the same bytes:
//   seats 0, 1  humans all match: wander words + a card pick / reroll byte about every 40 ticks (many land on an open offer)
//   seat 2      a human who goes AFK at tick 3000 (botMask bit set, the bot takes the titan) and is back at 4500
//   seat 3      a bot seat; a human takes it over at tick 3900 (botMask clear: the bot memory is parked) and hands it back at 12000
//   lateMask    sparse late frames: the previous word is repeated, card byte stripped (as lockstep.ts produce() does)
function h32(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return h >>> 0;
}

export function vsnetFrame(seed: number, tick: number, last: Uint8Array): Frame {
  const inputs = new Uint8Array(SEATS * INPUT_BYTES);
  let botMask = 0, lateMask = 0;
  if (tick < 3900 || tick >= 12000) botMask |= 8;
  if (tick >= 3000 && tick < 4500) botMask |= 4;
  const buf = new Uint8Array(4);
  for (let s = 0; s < SEATS; s++) {
    if ((botMask >> s) & 1) { last.fill(0, s * 4, s * 4 + 4); continue; }
    const late = tick > 90 && h32(seed * 31 + s, tick) % 53 === 0;
    if (late) {
      lateMask |= 1 << s;
      inputs.set(last.subarray(s * 4, s * 4 + 3), s * 4);          // previous word, card byte stripped
      continue;
    }
    const seg = Math.floor(tick / 50);
    const ang = (h32(seed + s * 7919, seg) % 3600) / 3600 * Math.PI * 2;
    const h2 = h32(seed + s + 31, tick);
    const move = h2 % 11 !== 0;
    let card = 0;
    if (tick % 40 === (s * 13) % 40 && h2 % 3 !== 0) card = h2 % 17 === 0 ? CARD.REROLL : 1 + (h2 >>> 4) % 3;
    encodeInput({ mx: move ? Math.cos(ang) : 0, mz: move ? Math.sin(ang) : 0, ability: h2 % 97 === 0, abilityHeld: false,
      dash: h2 % 211 === 0, ultimate: h2 % 1009 === 0 }, buf, 0, card);
    inputs.set(buf, s * 4);
    last.set(buf, s * 4);
    last[s * 4 + 3] = 0;
  }
  return { tick, lateMask, botMask, inputs };
}

export function runProbeVsNet(lineup: string, biome: string, seed: number, ticks: number, every = 300): ProbeRun {
  const t0 = Date.now();
  const ids = lineup.split('+');
  const four = ids.length === 4 ? ids : [ids[0], ids[0], ids[0], ids[0]];
  const start = vsStartInfo({ proto: NET_PROTO, build: 'xb', matchId: 'xb', seed, biome,
    seats: four.map((t, s) => ({ kind: s === 0 || s === 1 || s === 2 ? 'human' as const : 'bot' as const, peer: s < 3 ? 'p' + s : null, name: 'S' + s, titan: t })) });
  const sim = vsWorldPort({ viewSeat: () => seed % 4 });     // a different VIEW seat per run: the hash must not care
  const w = sim.create(start);
  const last = new Uint8Array(SEATS * INPUT_BYTES);
  const cps: string[] = [];
  let f: Frame | null = null;
  let i = 0;
  for (; i < ticks && !sim.ended(w); i++) {
    f = vsnetFrame(seed, i + 1, last);
    sim.step(w, f);
    if ((i + 1) % every === 0) cps.push((sim.hash(w) >>> 0).toString(16).padStart(8, '0'));
  }
  const st = sim.standings(w, f);
  const lv = Math.max(...w.players.map((p) => p.titan.level));
  const final = (portHash(w) >>> 0).toString(16).padStart(8, '0') + ':' + (st.hash >>> 0).toString(16).padStart(8, '0');
  return { titan: 'vsnet:' + four.join('+'), biome, seed, meta: 'vsnet', ticks: i, checkpointEvery: every, checkpoints: cps, final,
    result: w.run.result ?? null, endT: w.t, level: lv, ms: Date.now() - t0 };
}

(globalThis as Record<string, unknown>).btProbe = { runProbe, runProbeVs, runProbeVsNet, VS_MATCH_TICKS, mathHashes };
