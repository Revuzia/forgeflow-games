// BLOCKTOOTH — titan balance probe (TITAN PASS §4.2 / §4.3; lane HARN). REPORT ONLY: it prints the per-titan
// band table and PASS / FAIL per band, and always exits 0 unless the sim cannot load (2) or a --compare finds a
// per-run difference (1). It is not a gate: GATE 2 stays probe_sim.ts (promoting this to a gate is an owner/spec call).
//
//   node _harness/probe_balance.ts                          # P-human, P-bot, Q-human (3 × 96 runs, ~30–40 min)
//   node _harness/probe_balance.ts --sets P-human --titans molo
//   node _harness/probe_balance.ts --sets P-human --json _harness/_reports/balance_P_human.json
//   node _harness/probe_balance.ts --sets P-human --titans molo --compare <pa_P_human.json>   # per-run identity check
//
// Sets (fresh profile = EMPTY_RUN_META, titans × GRID-EAST / WHITE STACKS / LOCKWATER):
//   P-human  player-like policy, seeds 1–8       P-bot  the GATE 2 harness bot, seeds 1–8
//   Q-human  player-like policy, seeds 9–16 (the confirmation block)
//
// The player-like policy is a port of titanpass/pa/pa.ts `humanInput` (power audit, 2026-09-28): the harness bot
// with human reaction (× 1.6) and attention lapses (25 %), ±25° steering wobble re-rolled every 0.5 s from a
// per-run LCG, walks at the densest crowd within 6 H (retreats below 35 % HP), holds ~auto reach from the nearest
// boss part and circles it, dashes ONLY to escape paint, presses the hook on cooldown whenever a foe is within 4 H or
// a boss is up. Its reach for BRIARWICK is the bot's (kitReach) when bot.ts exports botReach; otherwise pa.ts's
// 2.6 H formula (so the probe also runs unchanged on an older tree — that is how it was checked against pa.ts).
// The run loop (draft auto-pick, per-tick bookkeeping, GATE2_V3.probeMinutes + 20 s cap — 25 min + 20 s for the
// 20-minute run, PACING_20 §3.10; pa.ts's was 720 s + 20 s, kept on an older tree without the field) is pa.ts's, minus its damage-attribution
// hooks (__PA / paTag), which shipped code does not carry.
//
// Bands (TITAN_PASS §4.3; MOLO is the reference every relative band is measured against, per set):
//   B1 clears: P-human ≥ 19/24 each, MOLO + HEARTH ≥ 21/24, best − worst ≤ 4; Q-human each titan within 3 of MOLO;
//      P-bot ≥ 20/24.                         Noise rule (§4.2): a clears miss inside ±2 prints NOISE, not FAIL.
//   B2 LV 35 reached ≥ 23/24.   B3 deaths before the city boss ≤ 1/24 and 0 at Size I.
//   B4 city-boss kill rate per boss ≥ 6/8 (P sets); P-human + Q-human ≥ 11/16 (printed when both ran).
//   B5 city pooled median TTK: 60 s ≤ med ≤ MOLO × 1.2.   B6 per boss: ≤ MOLO × 1.25 and ≥ 0.65 × MOLO.
//   B7 gatekeepers G1/G2/G3: 20 s ≤ median ≤ MOLO × 1.3, every fight 15–90 s.
//   B8 HP lost / min as % of that Size's max HP (median over runs with > 5 s at the Size): Size I ≤ 45 % and ≥ 8 %;
//      Size IV (the city-boss Size) ≤ 55 %.
//   B9 BRIARWICK kit (player-like sets): pod-time beyond 12 H ≤ 10 %; lash foe hits per foe-targeted cast ≥ 1.5;
//      pods per POP-UP PARK press ≥ 6. ("own kit ≥ 40 % of damage" needs damage attribution the shipped sim does
//      not expose — printed as NOT MEASURED.)  The foe-targeted cast is classified by findTarget on the tick
//      before the step (the titan moves ≤ one tick inside the step: an approximation, stated).
//   B10 VOLT-KITE: ≥ 50 % of RECAST presses blow real wires (kit.wires > 0 on the press tick).
//   B11 P-human pooled clears 80–92 of 96; P-bot ≥ 1 death in 96.
//
// Harness code: THREE-free, DOM-free; reads the world, never writes gameplay state (the sim stays deterministic —
// --compare proves per-run identity with pa.ts on the same tree).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TitanInput, World } from '../src/core/types.ts';

type WorldMod = typeof import('../src/core/world.ts');
type DraftMod = typeof import('../src/upgrades/draft.ts');
type BotMod = typeof import('./bot.ts');
type TypesMod = typeof import('../src/core/types.ts');
type ConfigMod = typeof import('../src/core/config.ts');
type MathMod = typeof import('../src/core/math.ts');
type TitansMod = typeof import('../src/data/titans.ts');
type TargetMod = typeof import('../src/combat/targeting.ts');
type KitsMod = typeof import('../src/titans/kits/index.ts');

let wm: WorldMod, dm: DraftMod, bm: BotMod, tm: TypesMod, cm: ConfigMod, mm: MathMod, dt: TitansMod, tg: TargetMod, km: KitsMod;

// ─────────────────────────────── args ───────────────────────────────
const argv = process.argv.slice(2);
function arg(name: string, def: string | null = null): string | null {
  const i = argv.indexOf('--' + name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
}
const SET_DEFS: Record<string, { policy: 'human' | 'bot'; seeds: number[] }> = {
  'P-human': { policy: 'human', seeds: [1, 2, 3, 4, 5, 6, 7, 8] },
  'P-bot': { policy: 'bot', seeds: [1, 2, 3, 4, 5, 6, 7, 8] },
  'Q-human': { policy: 'human', seeds: [9, 10, 11, 12, 13, 14, 15, 16] },
};
const SETS = (arg('sets', 'P-human,P-bot,Q-human') as string).split(',').filter((s) => s in SET_DEFS);
const SEED_OVERRIDE = arg('seeds');
/** run cap in ticks: GATE2_V3.probeMinutes sim-minutes + 20 s (set after the config loads; pa.ts's 12 min + 20 s on an
 *  older tree that has no probeMinutes) */
let MAX_T = 720 * 30 + 600;
const POD_FAR_H = 12;                  // B9: pod-time beyond 12 H (the POP-UP PARK reach)
const GATES = ['stencil1', 'cordon2', 'switchboard5'];
const MAINS = ['caisson4', 'irongully', 'parkade6'];

// ─────────────────────────────── player-like policy (pa.ts humanInput) ───────────────────────────────
let hs = 1;
function hrand(): number { hs = (hs * 1664525 + 1013904223) >>> 0; return hs / 4294967296; }
interface HumanMem { noiseA: number; noiseT: number; holdUntil: number }
const HM = new WeakMap<World, HumanMem>();

function covered(w: World): boolean {
  const T = w.titan;
  for (const t of w.telegraphs) if (t.alive && t.owner !== 'titan' && !t.fired && mm.circleInShape(t.shape, T.x, T.z, T.radius)) return true;
  for (const h of w.hazards) if (h.alive && h.owner !== 'titan' && h.dps > 0 && mm.circleInShape(h.shape, T.x, T.z, T.radius)) return true;
  return false;
}

function humanReach(w: World): number {
  const T = w.titan, H = T.height, s = T.stats;
  switch (T.id) {
    case 'molo': return 0.9 * H * (s.attackRange || 1);
    case 'voltkite': return 3.2 * H * (s.attackRange || 1);
    case 'hearthback': return 2.5 * H * (s.attackRange || 1) * (T.rank === 0 ? 2.2 : 1);
    case 'briarwick': {
      const br = (bm as unknown as { botReach?: (w: World) => number }).botReach;
      if (br) return br(w);                                            // TITAN PASS: the kit's own lash reach
      return 2.6 * H * (s.attackRange || 1) * (s.vineLength || 1);     // pa.ts (pre-titan-pass bot)
    }
  }
  return 2 * H;
}

function humanInput(w: World): TitanInput {
  const out = bm.botInput(w);
  const T = w.titan;
  if (!T.alive || w.run.result) return out;
  let m = HM.get(w);
  if (!m) { m = { noiseA: 0, noiseT: 0, holdUntil: 0 }; HM.set(w, m); }
  const H = T.height;
  const threatened = covered(w);
  const hpFrac = T.hp / Math.max(1, T.maxHp);
  const b = w.boss;
  let dx = out.mx, dz = out.mz;
  if (!threatened) {
    const reach = humanReach(w);
    if (b && b.alive && b.introT <= 0) {
      // generic boss play: hold ~auto reach from the nearest part and circle slowly
      let best = Infinity, px = b.x, pz = b.z;
      for (const p of b.parts) { const d = Math.hypot(p.x - T.x, p.z - T.z) - p.r; if (d < best) { best = d; px = p.x; pz = p.z; } }
      const L = Math.hypot(px - T.x, pz - T.z) || 1; const tx = (px - T.x) / L, tz = (pz - T.z) / L;
      if (best > reach * 0.8) { dx = tx; dz = tz; }
      else if (best < reach * 0.35) { dx = -tx * 0.7 + tz * 0.7; dz = -tz * 0.7 - tx * 0.7; }
      else { dx = tz * 0.8 + tx * 0.2; dz = -tx * 0.8 + tz * 0.2; }
    } else {
      // walk toward the densest enemies nearby (fight what is chasing you); retreat when low
      let n = 0, cx = 0, cz = 0; const r = 6 * H;
      for (const e of w.enemies) { if (!e.alive) continue; const d = Math.hypot(e.x - T.x, e.z - T.z); if (d < r) { n++; cx += e.x; cz += e.z; } }
      if (n >= 3) {
        cx /= n; cz /= n; const L = Math.hypot(cx - T.x, cz - T.z);
        if (hpFrac < 0.35 && L > 1e-6) { dx = -(cx - T.x) / L * 0.7 + out.mx * 0.3; dz = -(cz - T.z) / L * 0.7 + out.mz * 0.3; }
        else if (L > reach * 0.5) { dx = (cx - T.x) / L * 0.7 + out.mx * 0.3; dz = (cz - T.z) / L * 0.7 + out.mz * 0.3; }
      }
    }
    // imprecise steering: ±25° wobble re-rolled every 0.5 s
    if (w.tick >= m.noiseT) { m.noiseA = (hrand() * 2 - 1) * (25 * Math.PI / 180); m.noiseT = w.tick + 15; }
    const c = Math.cos(m.noiseA), s = Math.sin(m.noiseA);
    const nx = dx * c - dz * s, nz = dx * s + dz * c;
    const L = Math.hypot(nx, nz) || 1; out.mx = nx / L; out.mz = nz / L;
    out.dash = false;                                   // dashes only to escape
  }
  // hook on cooldown whenever something is in the fight
  let near = false;
  for (const e of w.enemies) if (e.alive && Math.hypot(e.x - T.x, e.z - T.z) < 4 * H) { near = true; break; }
  if (b && b.alive && b.introT <= 0) near = true;
  out.ability = T.abilityCd <= 0 && near;
  if (out.ability) m.holdUntil = w.tick + 36;
  out.abilityHeld = out.ability || w.tick < m.holdUntil;
  return out;
}

// ─────────────────────────────── one run ───────────────────────────────
interface BossRec { id: string; role: string; spawnT: number; fightT: number | null; endT: number | null; killed: boolean; hpLeft: number; taken: number; rankAt: number }
interface Row {
  set: string; titan: string; biome: string; seed: number; policy: string; result: string; t: number; level: number; rank: number;
  hpFrac: number; kills: number; crushed: number; floors: number; xp: number;
  taken: Record<string, number>; takenByRank: number[]; heal: number; shieldAbsorbed: number;
  levelT: number[]; rankT: number[]; tInRank: number[]; hookCasts: number; dashes: number; bosses: BossRec[];
  owned: string[];
  // kit metrics
  detWithWires: number; detBurst: number;
  podN: number; podFar: number; lashFoeCasts: number; lashFoeHits: number; lashCasts: number; parkPresses: number; parkPods: number;
}

function add(o: Record<string, number>, k: string, v: number): void { o[k] = (o[k] ?? 0) + v; }

/** B9: foes the BURR LASH struck this tick = distinct enemyHit ids lying in the lash lane (the tick's first `vine`
 *  event, half-width lashWH × H × area / 2 + the foe's radius). `titanAttack.hits` also counts buildings and props,
 *  so it is not used. A pod burst on the same tick hitting a foe inside the lane is counted too (small overcount). */
const hitIds = new Set<number>();
function lashFoeHitsThisTick(w: World): number {
  const lashWH = briarLashWH();
  if (!(lashWH > 0)) return 0;
  const v = w.events.find((e) => e.type === 'vine');
  if (!v || v.type !== 'vine') return 0;
  const half = 0.5 * lashWH * w.titan.height * Math.max(0.1, w.titan.stats.area || 1);
  const dx = v.x1 - v.x0, dz = v.z1 - v.z0, L2 = dx * dx + dz * dz || 1;
  hitIds.clear();
  for (const e of w.events) {
    if (e.type !== 'enemyHit' || hitIds.has(e.id)) continue;
    const t = Math.max(0, Math.min(1, ((e.x - v.x0) * dx + (e.z - v.z0) * dz) / L2));
    const px = v.x0 + dx * t - e.x, pz = v.z0 + dz * t - e.z;
    const foe = w.enemies.find((f) => f.id === e.id);
    if (Math.hypot(px, pz) <= half + (foe ? foe.radius : 0) + 1e-6) hitIds.add(e.id);
  }
  return hitIds.size;
}
let BRIAR_LASH_WH = -1;
function briarLashWH(): number { return BRIAR_LASH_WH; }

function runOne(set: string, policy: 'human' | 'bot', titan: string, biome: string, seed: number): Row {
  // pa.ts: humanInput sets BOT_TUNE on its first call; a bot run keeps the gate-bot defaults
  if (policy === 'human') { bm.BOT_TUNE.reactionScale = 1.6; bm.BOT_TUNE.lapseP = 0.25; }
  else { bm.BOT_TUNE.reactionScale = 1; bm.BOT_TUNE.lapseP = 0.12; }
  bm.BOT_TUNE.threatDash = true;
  hs = seed * 7919 + 17;
  const meta = { ...tm.EMPTY_RUN_META, unlocked: [] };
  const w = wm.createWorld({ titan, biome, seed, meta } as Parameters<WorldMod['createWorld']>[0]);
  bm.resetBot(w);
  const T = w.titan;
  const taken: Record<string, number> = {};
  const takenByRank = [0, 0, 0, 0, 0], tInRank = [0, 0, 0, 0, 0];
  const levelT: number[] = [0], rankT: number[] = [0];
  const bosses: BossRec[] = [];
  let curBoss: BossRec | null = null;
  let hookCasts = 0, dashes = 0, heal = 0, detWithWires = 0, detBurst = 0;
  let podN = 0, podFar = 0, lashFoeCasts = 0, lashFoeHits = 0, lashCasts = 0, parkPresses = 0, parkPods = 0;
  let xpCum = 0, prevLv = T.level, prevXp = T.xp, prevXpTo = T.xpToNext, prevRank = T.rank, prevCd = T.abilityCd, prevHp = T.hp;
  let bossObj: World['boss'] = null;
  let prevSh = w.upgrades.shield ?? 0, shAbs = 0;
  const isBriar = titan === 'briarwick';
  for (let i = 0; i < MAX_T && !w.run.result; i++) {
    let g = 0;
    while (dm.hasPendingDraft(w) && g++ < 200) {
      const chest = w.upgrades.chestDrafts > 0;
      const offer: readonly string[] = w.upgrades.offer && w.upgrades.offer.length ? w.upgrades.offer : dm.rollOffer(w, chest);
      if (!offer || !offer.length) break;
      dm.pickUpgrade(w, bm.botPickUpgrade(w, offer));
    }
    const input = policy === 'bot' ? bm.botInput(w) : humanInput(w);
    const wiresBefore = T.id === 'voltkite' ? (T.kit.wires ?? 0) : 0;
    // B9: what the lash would target this tick (read-only query, before the step)
    let preKind = '';
    if (isBriar) { const t = tg.findTarget(w, T.x, T.z, km.kitReach(w), true); preKind = t ? t.kind : ''; }
    const rk = T.rank;
    wm.stepWorld(w, input);
    for (const ev of w.events) {
      if (ev.type === 'titanHurt') { add(taken, ev.src, ev.dmg); takenByRank[rk] += ev.dmg; }
      else if (ev.type === 'dash') dashes++;
      else if (ev.type === 'titanAttack' && isBriar && ev.attack === 'vineLash') {
        lashCasts++;
        if (preKind === 'enemy') { lashFoeCasts++; lashFoeHits += lashFoeHitsThisTick(w); }
      }
    }
    if (T.hp > prevHp) heal += T.hp - prevHp;
    { const sh = w.upgrades.shield ?? 0; if (sh < prevSh) shAbs += prevSh - sh; prevSh = sh; }
    prevHp = T.hp;
    tInRank[rk] += w.dt;
    if (T.abilityCd > prevCd + 1e-6) {
      hookCasts++;
      if (T.id === 'voltkite') { if (wiresBefore > 0) detWithWires++; else detBurst++; }
      if (isBriar) { parkPresses++; parkPods += T.kit.chain ?? 0; }
    }
    prevCd = T.abilityCd;
    // XP (pa.ts bookkeeping, kept for the per-run identity check)
    if (T.level === prevLv) xpCum += Math.max(0, T.xp - prevXp);
    else {
      let gsum = prevXpTo - prevXp;
      for (let l = prevLv + 1; l < T.level; l++) gsum += cm.xpToNext(l);
      gsum += T.xp; xpCum += gsum;
      for (let l = prevLv + 1; l <= T.level; l++) levelT[l - 1] = +w.t.toFixed(1);
    }
    prevLv = T.level; prevXp = T.xp; prevXpTo = T.xpToNext;
    if (T.rank !== prevRank) { for (let r = prevRank + 1; r <= T.rank; r++) rankT[r] = +w.t.toFixed(1); prevRank = T.rank; }
    // bosses / gatekeepers
    const b = w.boss;
    if (b && b !== bossObj) {
      bossObj = b;
      curBoss = { id: b.id, role: b.role ?? 'main', spawnT: +w.t.toFixed(1), fightT: null, endT: null, killed: false, hpLeft: 1, taken: 0, rankAt: T.rank };
      bosses.push(curBoss);
    }
    if (curBoss && bossObj) {
      if (curBoss.fightT === null && bossObj.introT <= 0) curBoss.fightT = +w.t.toFixed(1);
      if (curBoss.endT === null) {
        for (const ev of w.events) if (ev.type === 'titanHurt') curBoss.taken += ev.dmg;
        if (!bossObj.alive || bossObj.hp <= 0) { curBoss.endT = +w.t.toFixed(1); curBoss.killed = true; curBoss.hpLeft = 0; }
        else curBoss.hpLeft = +(bossObj.hp / bossObj.maxHp).toFixed(3);
      }
    }
    // pod samples (every 6 ticks, as pa.ts sampled its turrets)
    if (isBriar && i % 6 === 0) {
      const lim = POD_FAR_H * T.height;
      for (const h of w.hazards) {
        if (!h.alive || h.owner !== 'titan' || h.kind !== 'bloom' || h.shape.k !== 'circle') continue;
        podN++;
        if (Math.hypot(h.shape.x - T.x, h.shape.z - T.z) > lim) podFar++;
      }
    }
  }
  if (curBoss && curBoss.endT === null) curBoss.endT = +w.t.toFixed(1);
  return {
    set, titan, biome, seed, policy, result: w.run.result ?? 'timeout', t: +w.t.toFixed(1), level: T.level, rank: T.rank,
    hpFrac: +(T.hp / T.maxHp).toFixed(2), kills: T.kills, crushed: T.crushed, floors: T.floorsEaten, xp: Math.round(xpCum),
    taken, takenByRank, heal: Math.round(heal), shieldAbsorbed: Math.round(shAbs), levelT, rankT,
    tInRank: tInRank.map((x) => +x.toFixed(1)), hookCasts, dashes, bosses: bosses.map((x) => ({ ...x })),
    owned: Object.entries(w.upgrades.owned).filter(([, n]) => (n as number) > 0).map(([id, n]) => `${id}:${n}`),
    detWithWires, detBurst, podN, podFar, lashFoeCasts, lashFoeHits, lashCasts, parkPresses, parkPods,
  };
}

// ─────────────────────────────── table + bands ───────────────────────────────
function med(a: (number | null | undefined)[]): number | null {
  const b = a.filter((x): x is number => x !== null && x !== undefined && !Number.isNaN(x)).sort((x, y) => x - y);
  if (!b.length) return null;
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}
const r0 = (x: number | null | undefined): string => (x === null || x === undefined ? '-' : String(Math.round(x)));
const ttk = (b: BossRec): number => (b.endT as number) - (b.fightT ?? b.spawnT);

interface Summary {
  n: number; clears: number; lv35: number; deathsBySize: number[]; deathsPreBoss: number; takenPct: (number | null)[];
  gate: Record<string, { fights: number; kills: number; med: number | null; min: number | null; max: number | null }>;
  mains: Record<string, { fights: number; kills: number; med: number | null }>;
  pooled: number | null; cityKills: number; cityFights: number;
  podFarPct: number | null; lashHitsPerFoeCast: number | null; podsPerPress: number | null; recastWiresPct: number | null;
}

function summarise(R: Row[], titan: string): Summary {
  const baseHp = dt.TITANS[titan as keyof typeof dt.TITANS].base.maxHp;
  const clears = R.filter((r) => r.result === 'clear').length;
  const lv35 = R.filter((r) => r.levelT[34] !== undefined && r.levelT[34] !== null).length;
  const dbs = [0, 0, 0, 0, 0];
  let pre = 0;
  for (const r of R) if (r.result === 'dead') {
    dbs[r.rank]++;
    const main = r.bosses.find((b) => b.role === 'main');
    if (!main || r.t < main.spawnT) pre++;
  }
  const takenPct = [0, 1, 2, 3, 4].map((k) => med(R.map((r) => (r.tInRank[k] > 5
    ? (100 * r.takenByRank[k]) / (r.tInRank[k] / 60) / (baseHp * cm.RANKS[k].hpMul) : null))));
  const gate: Summary['gate'] = {};
  for (const id of GATES) {
    const L = R.flatMap((r) => r.bosses.filter((b) => b.id === id));
    const K = L.filter((b) => b.killed).map(ttk);
    gate[id] = { fights: L.length, kills: K.length, med: med(K), min: K.length ? Math.min(...K) : null, max: K.length ? Math.max(...K) : null };
  }
  const mains: Summary['mains'] = {};
  const allM: BossRec[] = [];
  for (const id of MAINS) {
    const L = R.flatMap((r) => r.bosses.filter((b) => b.id === id));
    const K = L.filter((b) => b.killed);
    allM.push(...L);
    mains[id] = { fights: L.length, kills: K.length, med: med(K.map(ttk)) };
  }
  const mk = allM.filter((b) => b.killed);
  const sum = (f: (r: Row) => number): number => R.reduce((a, r) => a + f(r), 0);
  const podN = sum((r) => r.podN), lfc = sum((r) => r.lashFoeCasts), pp = sum((r) => r.parkPresses);
  const dw = sum((r) => r.detWithWires), db = sum((r) => r.detBurst);
  return {
    n: R.length, clears, lv35, deathsBySize: dbs, deathsPreBoss: pre, takenPct, gate, mains,
    pooled: med(mk.map(ttk)), cityKills: mk.length, cityFights: allM.length,
    podFarPct: titan === 'briarwick' && podN ? (100 * sum((r) => r.podFar)) / podN : null,
    lashHitsPerFoeCast: titan === 'briarwick' && lfc ? sum((r) => r.lashFoeHits) / lfc : null,
    podsPerPress: titan === 'briarwick' && pp ? sum((r) => r.parkPods) / pp : null,
    recastWiresPct: titan === 'voltkite' && dw + db ? (100 * dw) / (dw + db) : null,
  };
}

const TITAN_ORDER = ['molo', 'hearthback', 'voltkite', 'briarwick'];
type Verdict = 'PASS' | 'FAIL' | 'NOISE' | 'n/a';
interface BandLine { titan: string; band: string; verdict: Verdict; detail: string }

function bandsFor(set: string, S: Record<string, Summary>, lines: BandLine[]): void {
  const human = SET_DEFS[set].policy === 'human';
  const M = S.molo;
  const put = (titan: string, band: string, ok: boolean | null, detail: string, noise = false): void => {
    lines.push({ titan, band, verdict: ok === null ? 'n/a' : ok ? 'PASS' : noise ? 'NOISE' : 'FAIL', detail });
  };
  const titans = TITAN_ORDER.filter((t) => S[t]);
  const scale = (s: Summary): number => 24 / Math.max(1, s.n);         // bands are written per 24 runs
  // B1
  if (set === 'P-human') {
    for (const t of titans) {
      const need = t === 'molo' || t === 'hearthback' ? 21 : 19;
      const c = S[t].clears * scale(S[t]);
      put(t, 'B1 clears', c >= need, `${S[t].clears}/${S[t].n} (need ≥ ${need}/24)`, c >= need - 2);
    }
    if (titans.length > 1) {
      const cs = titans.map((t) => S[t].clears * scale(S[t]));
      const spread = Math.max(...cs) - Math.min(...cs);
      put('all', 'B1 best − worst', spread <= 4, `${spread.toFixed(0)} (≤ 4)`, spread <= 6);
    }
  } else if (set === 'Q-human') {
    for (const t of titans) {
      if (t === 'molo' || !M) { put(t, 'B1 Q within 3 of MOLO', null, `${S[t].clears}/${S[t].n} (reference)`); continue; }
      const d = M.clears * scale(M) - S[t].clears * scale(S[t]);
      put(t, 'B1 Q within 3 of MOLO', d <= 3, `${S[t].clears}/${S[t].n} vs MOLO ${M.clears}/${M.n}`, d <= 5);
    }
  } else {
    for (const t of titans) {
      const c = S[t].clears * scale(S[t]);
      put(t, 'B1 clears (bot)', c >= 20, `${S[t].clears}/${S[t].n} (need ≥ 20/24)`, c >= 18);
    }
  }
  for (const t of titans) {
    const s = S[t];
    put(t, 'B2 LV 35', s.lv35 * scale(s) >= 23, `${s.lv35}/${s.n} (≥ 23/24)`);
    put(t, 'B3 deaths before city boss', s.deathsPreBoss * scale(s) <= 1 && s.deathsBySize[0] === 0,
      `${s.deathsPreBoss} pre-boss · ${s.deathsBySize[0]} at Size I (≤ 1/24, 0 at Size I)`);
    if (set !== 'Q-human') {
      for (const id of MAINS) {
        const m = s.mains[id];
        if (!m.fights) { put(t, `B4 ${id} kill rate`, null, 'no fights'); continue; }
        put(t, `B4 ${id} kill rate`, m.kills / m.fights >= 6 / 8, `${m.kills}/${m.fights} (≥ 6/8)`);
      }
    }
    if (M && M.pooled !== null && s.pooled !== null) {
      put(t, 'B5 city pooled median', s.pooled >= 60 && s.pooled <= M.pooled * 1.2, `${r0(s.pooled)} s (60 … ${r0(M.pooled * 1.2)})`);
    } else put(t, 'B5 city pooled median', null, `${r0(s.pooled)} s`);
    for (const id of MAINS) {
      const a = s.mains[id].med, ref = M ? M.mains[id].med : null;
      if (!s.mains[id].fights) { put(t, `B6 ${id} TTK`, null, 'no fights'); continue; }
      if (a === null || ref === null || t === 'molo') { put(t, `B6 ${id} TTK`, t === 'molo' || ref === null ? null : false, `${r0(a)} s (MOLO ${r0(ref)})`); continue; }
      put(t, `B6 ${id} TTK`, a <= ref * 1.25 && a >= ref * 0.65, `${r0(a)} s (${r0(ref * 0.65)} … ${r0(ref * 1.25)})`);
    }
    GATES.forEach((id, k) => {
      const g = s.gate[id], ref = M ? M.gate[id].med : null;
      if (g.med === null) { put(t, `B7 G${k + 1} ${id}`, false, `no kills (${g.kills}/${g.fights})`); return; }
      const hi = ref !== null ? ref * 1.3 : Infinity;
      const each = g.min !== null && g.max !== null && g.min >= 15 && g.max <= 90;
      put(t, `B7 G${k + 1} ${id}`, g.med >= 20 && g.med <= hi && each,
        `median ${r0(g.med)} s (20 … ${r0(hi)}) · fights ${r0(g.min)}–${r0(g.max)} s (15–90) · ${g.kills}/${g.fights}`);
    });
    const s1 = s.takenPct[0], s4 = s.takenPct[3];
    put(t, 'B8 Size I HP %/min', s1 !== null && s1 <= 45 && s1 >= 8, `${r0(s1)} % (8 … 45)`);
    put(t, 'B8 Size IV HP %/min', s4 === null ? null : s4 <= 55, `${r0(s4)} % (≤ 55)`);
    if (t === 'briarwick' && human) {
      put(t, 'B9 pod-time beyond 12 H', s.podFarPct === null ? false : s.podFarPct <= 10, `${s.podFarPct === null ? '-' : s.podFarPct.toFixed(1)} % (≤ 10)`);
      put(t, 'B9 lash foe hits / foe cast', s.lashHitsPerFoeCast === null ? false : s.lashHitsPerFoeCast >= 1.5, `${s.lashHitsPerFoeCast === null ? '-' : s.lashHitsPerFoeCast.toFixed(2)} (≥ 1.5)`);
      put(t, 'B9 pods per POP-UP PARK press', s.podsPerPress === null ? false : s.podsPerPress >= 6, `${s.podsPerPress === null ? '-' : s.podsPerPress.toFixed(2)} (≥ 6)`);
      put(t, 'B9 own kit share of damage', null, 'NOT MEASURED (no damage attribution in the shipped sim)');
    }
    if (t === 'voltkite' && human) {
      put(t, 'B10 RECAST blows wires', s.recastWiresPct === null ? false : s.recastWiresPct >= 50, `${s.recastWiresPct === null ? '-' : s.recastWiresPct.toFixed(0)} % (≥ 50)`);
    }
  }
}

function printTable(set: string, S: Record<string, Summary>): void {
  console.log(`\n##### ${set} — titan | clears | LV35 | deaths by Size I..V (pre-boss) | taken %maxHP/min S1..S5 | G1/G2/G3 TTK med (kills/fights) | city TTK per boss (kills/fights) | city pooled | city kill rate | kit`);
  for (const t of TITAN_ORDER) {
    const s = S[t]; if (!s) continue;
    const g = GATES.map((id) => `${r0(s.gate[id].med)} (${s.gate[id].kills}/${s.gate[id].fights})`).join(' / ');
    const m = MAINS.map((id) => `${id.replace(/\d+$/, '')} ${r0(s.mains[id].med)} (${s.mains[id].kills}/${s.mains[id].fights})`).join(' · ');
    let kit = '';
    if (t === 'briarwick') kit = `pods >12H ${s.podFarPct === null ? '-' : s.podFarPct.toFixed(1)}% · lash hits/foe cast ${s.lashHitsPerFoeCast === null ? '-' : s.lashHitsPerFoeCast.toFixed(2)} · pods/press ${s.podsPerPress === null ? '-' : s.podsPerPress.toFixed(2)}`;
    if (t === 'voltkite') kit = `RECAST with wires ${s.recastWiresPct === null ? '-' : s.recastWiresPct.toFixed(0)}%`;
    console.log(`${t} | ${s.clears}/${s.n} | ${s.lv35}/${s.n} | ${s.deathsBySize.join('/')} (${s.deathsPreBoss}) | ${s.takenPct.map((x) => r0(x) + '%').join('/')} | ${g} | ${m} | ${r0(s.pooled)} | ${s.cityKills}/${s.cityFights} | ${kit}`);
  }
}

// ─────────────────────────────── --compare (identity with pa.ts rows) ───────────────────────────────
const CMP_FIELDS = ['result', 't', 'level', 'rank', 'hpFrac', 'kills', 'crushed', 'floors', 'xp', 'taken', 'takenByRank', 'heal',
  'shieldAbsorbed', 'levelT', 'rankT', 'tInRank', 'hookCasts', 'dashes', 'owned', 'detWithWires', 'detBurst'];
const CMP_BOSS = ['id', 'role', 'spawnT', 'fightT', 'endT', 'killed', 'hpLeft', 'taken', 'rankAt'];
function canon(v: unknown): string { return JSON.stringify(v, (_k, x) => (typeof x === 'number' ? +x.toFixed(6) : x)); }
function compare(rows: Row[], file: string): number {
  const ref = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>[];
  let diffs = 0, matched = 0;
  for (const r of rows) {
    const o = ref.find((x) => x.titan === r.titan && x.biome === r.biome && x.seed === r.seed);
    if (!o) { console.log(`compare: ${r.titan}/${r.biome}/${r.seed} not in ${file}`); diffs++; continue; }
    const bad: string[] = [];
    for (const f of CMP_FIELDS) if (canon((r as unknown as Record<string, unknown>)[f]) !== canon(o[f])) bad.push(f);
    const ob = (o.bosses as Record<string, unknown>[]) ?? [];
    if (ob.length !== r.bosses.length) bad.push('bosses.length');
    else r.bosses.forEach((b, k) => { for (const f of CMP_BOSS) if (canon((b as unknown as Record<string, unknown>)[f]) !== canon(ob[k][f])) bad.push(`bosses[${k}].${f}`); });
    if (bad.length) { diffs++; console.log(`compare: DIFF ${r.titan}/${r.biome}/${r.seed}: ${bad.join(', ')}`); }
    else matched++;
  }
  console.log(`compare vs ${file}: ${matched} identical, ${diffs} different (fields ${CMP_FIELDS.length} + bosses × ${CMP_BOSS.length})`);
  return diffs;
}

// ─────────────────────────────── main ───────────────────────────────
async function main(): Promise<number> {
  try {
    wm = await import('../src/core/world.ts');
    dm = await import('../src/upgrades/draft.ts');
    bm = await import('./bot.ts');
    tm = await import('../src/core/types.ts');
    cm = await import('../src/core/config.ts');
    { const pm = (cm.GATE2_V3 as { probeMinutes?: number }).probeMinutes; if (typeof pm === 'number' && pm > 0) MAX_T = Math.round(pm * 60 * 30) + 600; }
    mm = await import('../src/core/math.ts');
    dt = await import('../src/data/titans.ts');
    tg = await import('../src/combat/targeting.ts');
    km = await import('../src/titans/kits/index.ts');
    const bk = await import('../src/titans/kits/briarwick.ts') as unknown as { BRIAR?: { lashWH?: number } };
    BRIAR_LASH_WH = bk.BRIAR && typeof bk.BRIAR.lashWH === 'number' ? bk.BRIAR.lashWH : -1;   // kit C only
  } catch (e) {
    console.log(`could not load the sim: ${(e as Error).message}`);
    return 2;
  }
  const titans = (arg('titans', 'all') as string) === 'all' ? [...tm.TITAN_IDS] : (arg('titans') as string).split(',');
  const biomes = (arg('biomes', 'all') as string) === 'all' ? [...tm.BIOME_IDS] : (arg('biomes') as string).split(',');
  const jsonOut = arg('json');
  const cmpFile = arg('compare');
  const quiet = argv.includes('--quiet');
  const all: Row[] = [];
  const bySet: Record<string, Record<string, Summary>> = {};
  const lines: BandLine[] = [];
  let cmpDiffs = 0;
  for (const set of SETS) {
    const def = SET_DEFS[set];
    const seeds = SEED_OVERRIDE ? SEED_OVERRIDE.split(',').map(Number) : def.seeds;
    const rows: Row[] = [];
    for (const titan of titans) for (const biome of biomes) for (const seed of seeds) {
      const r = runOne(set, def.policy, titan, biome, seed);
      rows.push(r);
      if (!quiet) {
        const main = r.bosses.find((x) => x.role !== 'gate');
        console.log(`${set} ${titan}/${biome}/${seed}: ${r.result} t=${r.t} LV${r.level} S${r.rank + 1} kills=${r.kills} hooks=${r.hookCasts} dashes=${r.dashes} main=${main ? `${main.id} fight@${main.fightT} end@${main.endT} left=${main.hpLeft}` : '-'}`);
      }
    }
    all.push(...rows);
    if (cmpFile) cmpDiffs += compare(rows, cmpFile);
    const S: Record<string, Summary> = {};
    for (const t of TITAN_ORDER) { const R = rows.filter((r) => r.titan === t); if (R.length) S[t] = summarise(R, t); }
    bySet[set] = S;
    printTable(set, S);
    bandsFor(set, S, lines);
    for (const l of lines.splice(0)) console.log(`  [${set}] ${l.titan.padEnd(10)} ${l.band.padEnd(32)} ${l.verdict.padEnd(5)} ${l.detail}`);
  }
  // cross-set bands
  const P = bySet['P-human'], Q = bySet['Q-human'], PB = bySet['P-bot'];
  if (P && Q) {
    for (const t of TITAN_ORDER) {
      if (!P[t] || !Q[t]) continue;
      for (const id of MAINS) {
        const k = P[t].mains[id].kills + Q[t].mains[id].kills, f = P[t].mains[id].fights + Q[t].mains[id].fights;
        console.log(`  [P+Q] ${t.padEnd(10)} ${('B4 ' + id + ' P+Q').padEnd(32)} ${(f ? (k / f >= 11 / 16 ? 'PASS' : 'FAIL') : 'n/a').padEnd(5)} ${k}/${f} (≥ 11/16)`);
      }
    }
  }
  if (P) {
    const c = Object.values(P).reduce((a, s) => a + s.clears, 0), n = Object.values(P).reduce((a, s) => a + s.n, 0);
    const ok = n === 96 ? c >= 80 && c <= 92 : null;
    console.log(`  [P-human] all        ${'B11 pooled clears'.padEnd(32)} ${(ok === null ? 'n/a' : ok ? 'PASS' : 'FAIL').padEnd(5)} ${c}/${n} (80–92 of 96)`);
  }
  if (PB) {
    const d = Object.values(PB).reduce((a, s) => a + s.deathsBySize.reduce((x, y) => x + y, 0), 0), n = Object.values(PB).reduce((a, s) => a + s.n, 0);
    console.log(`  [P-bot]   all        ${'B11 bot deaths'.padEnd(32)} ${(n === 96 ? (d >= 1 ? 'PASS' : 'FAIL') : 'n/a').padEnd(5)} ${d} in ${n} (≥ 1 in 96)`);
  }
  if (jsonOut) {
    mkdirSync(dirname(jsonOut), { recursive: true });
    writeFileSync(jsonOut, JSON.stringify(all));
    console.log(`rows: ${jsonOut}`);
  }
  console.log('probe_balance: REPORT ONLY (not a gate)' + (cmpFile ? ` · compare: ${cmpDiffs ? 'DIFFERENT' : 'IDENTICAL'}` : ''));
  return cmpFile && cmpDiffs ? 1 : 0;
}

process.exitCode = await main();
