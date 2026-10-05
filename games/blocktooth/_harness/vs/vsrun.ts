// BLOCKTOOTH VS QA (lane B-QA) — the match / duel runners behind probe_vs.ts.
//
// Harness code, not sim code: performance.now() is used ONLY to time ticks; nothing here writes gameplay state except
// the explicit duel SETUP (growToRank / hp / position / clock jump, listed in runDuel) and the stand-in driver's
// draft picks (the same rollOffer / pickUpgrade path the draft screen uses).
//
// Two drivers feed the seats:
//   native  every seat is a bot seat (`bot: 'regular'`); the WORLD's own VS bot brain (src/vs/bot, written in
//           vsBeginTick) drives it and the harness passes `null` inputs. THIS is what the VP gate measures.
//   standin every seat is a human seat and the harness drives it with the solo bot (_harness/bot.ts), one separate bot
//           memory per seat (a Proxy of the World that aliases the cursor fields to that seat). It has no rival / ring
//           / tender logic, so it measures the PvE economy of 4 titans in one city only. Used while the VS bot brain is
//           not landed, and always reported as `standin` so nobody mistakes it for the gate.
//
// Everything the VP gate needs is READ from the contract (CORE_CONTRACT.md §5): events rivalHit / evicted / eliminated /
// tender* / crown / ringStep / vsPhase / vsEnd / railOffer / railPick, World.vs, PlayerState.vs.

import type { BiomeId, PlayerSeat, SimEvent, TitanId, TitanInput, World } from '../../src/core/types.ts';
import type { BotLevel } from '../../src/vs/types.ts';

type WorldMod = typeof import('../../src/core/world.ts');
type PlayersMod = typeof import('../../src/core/players.ts');
type TitanMod = typeof import('../../src/titans/titansim.ts');
type DraftMod = typeof import('../../src/upgrades/draft.ts');
type BotMod = typeof import('../bot.ts');
type CfgMod = typeof import('../../src/core/config.ts');
type VsStateMod = typeof import('../../src/vs/state.ts');

let M_world: WorldMod, M_players: PlayersMod, M_titan: TitanMod, M_draft: DraftMod, M_bot: BotMod, M_cfg: CfgMod, M_vs: VsStateMod;

/** Dynamic import so a lane module that is mid-edit reports "could not load the sim" (exit 2) instead of crashing. */
/** GATE sweeps: BT_VS_OVERRIDE='{"VS.ko.levelsLost":1,"VSX.pvpMul":2}' sets those config numbers in THIS process before any match
 *  (worker processes inherit the env). Info/tuning only: a run with overrides is labelled in the probe header. */
function applyOverrides(cfg: any, tune: any): void {
  const raw = process.env.BT_VS_OVERRIDE;
  if (!raw) return;
  const roots: Record<string, any> = { VS: cfg.VS, VSX: tune.VSX };
  for (const [path, val] of Object.entries(JSON.parse(raw) as Record<string, unknown>)) {
    const parts = path.split('.');
    let o = roots[parts[0]];
    for (let i = 1; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = val;
  }
}

export async function loadSim(): Promise<string | null> {
  try {
    M_world = await import('../../src/core/world.ts');
    M_players = await import('../../src/core/players.ts');
    M_titan = await import('../../src/titans/titansim.ts');
    M_draft = await import('../../src/upgrades/draft.ts');
    M_bot = await import('../bot.ts');
    M_cfg = await import('../../src/core/config.ts');
    M_vs = await import('../../src/vs/state.ts');
    applyOverrides(M_cfg, await import('../../src/vs/tune.ts'));
    return null;
  } catch (e) {
    return (e as Error)?.stack ?? String(e);
  }
}

export type Driver = 'native' | 'standin';
export const TITANS4: readonly TitanId[] = ['molo', 'voltkite', 'hearthback', 'briarwick'];

// ─────────────────────────────── hashing ───────────────────────────────
const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
class Hasher {
  h = 0x811c9dc5 >>> 0;
  u32(x: number): void { for (let s = 0; s < 32; s += 8) { this.h ^= (x >>> s) & 0xff; this.h = Math.imul(this.h, 0x01000193) >>> 0; } }
  num(x: number): void {
    if (x !== x) { this.u32(0x7ff80000); this.u32(1); return; }                 // NaN is its own value
    F64[0] = x; this.u32(U32[0]); this.u32(U32[1]);
  }
  str(s: string): void { for (let i = 0; i < s.length; i++) { this.h ^= s.charCodeAt(i) & 0xff; this.h = Math.imul(this.h, 0x01000193) >>> 0; } this.u32(s.length); }
  hex(): string { return (this.h >>> 0).toString(16).padStart(8, '0'); }
}
/** Hash any plain data (numbers / strings / booleans / null / arrays / objects with SORTED keys; functions skipped). */
function hashPlain(h: Hasher, v: unknown, depth = 0): void {
  if (depth > 7) { h.u32(0xdead); return; }
  switch (typeof v) {
    case 'number': h.u32(1); h.num(v); return;
    case 'string': h.u32(2); h.str(v); return;
    case 'boolean': h.u32(v ? 3 : 4); return;
    case 'undefined': h.u32(5); return;
    case 'function': return;
    case 'object': {
      if (v === null) { h.u32(6); return; }
      if (Array.isArray(v)) { h.u32(7); h.u32(v.length); for (let i = 0; i < v.length; i++) hashPlain(h, v[i], depth + 1); return; }
      const o = v as Record<string, unknown>;
      const ks = Object.keys(o).sort();
      h.u32(8); h.u32(ks.length);
      for (const k of ks) { h.str(k); hashPlain(h, o[k], depth + 1); }
      return;
    }
    default: h.u32(9);
  }
}
const TITAN_NUMS = ['x', 'z', 'heading', 'hp', 'maxHp', 'mass', 'xp', 'level', 'rank', 'height', 'kills', 'crushed', 'floorsEaten',
  'buildingsLeveled', 'propsEaten', 'damageTaken', 'abilityCd', 'dashCharges'] as const;

/** A wide state hash over EVERY seat (titan, tally, run, upgrades, rail, vs, bot memory) + the shared city / entities / VS state. */
export function hashWide(w: World): string {
  const h = new Hasher();
  h.num(w.tick); h.num(w.t); h.num(w.nextId);
  hashPlain(h, w.run);
  for (const p of w.players) {
    const T = p.titan as unknown as Record<string, number>;
    for (const k of TITAN_NUMS) h.num(T[k] as number);
    h.u32(p.titan.alive ? 1 : 0);
    hashPlain(h, p.tally); hashPlain(h, p.run); hashPlain(h, p.rail); hashPlain(h, p.vs); hashPlain(h, p.bot);
    hashPlain(h, p.upgrades.owned); h.num(p.upgrades.pendingDrafts);
    hashPlain(h, p.upgrades.offer ?? null);
    hashPlain(h, p.input);
    const U = p.ult as unknown as Record<string, unknown>;
    h.num(typeof U.charge === 'number' ? U.charge : -1);
  }
  let n = 0;
  for (const e of w.enemies) { if (!e.alive) continue; n++; h.str(e.kind); h.num(e.id); h.num(e.x); h.num(e.z); h.num(e.hp); }
  h.num(n);
  n = 0;
  for (const p of w.pickups) if (p.alive) { n++; h.num(p.id); h.num(p.x); h.num(p.z); }
  h.num(n);
  n = 0;
  for (const p of w.projectiles) if (p.alive) { n++; h.num(p.x); h.num(p.z); }
  h.num(n);
  n = 0;
  for (const t of w.telegraphs) if (t.alive) n++;
  h.num(n);
  if (w.boss) { h.str(w.boss.id); h.num(w.boss.x); h.num(w.boss.z); h.num(w.boss.hp); h.num(w.boss.phase); h.num(w.boss.meter); }
  for (const b of w.city.buildings) { h.num(b.alive); h.num(b.floorHp); h.u32(b.collapsed ? 1 : 0); }
  hashPlain(h, w.vs);
  return h.hex();
}

// ─────────────────────────────── stand-in driver (solo bot, one memory per seat) ───────────────────────────────
const SEAT_VIEWS = new WeakMap<World, World[]>();
const CURSOR_KEYS = new Set(['titan', 'titanId', 'upgrades', 'ult', 'tally', 'meta', 'input', 'director', 'pl']);
/** A Proxy of `w` whose cursor fields (w.titan ...) read seat `slot`: bot.ts keeps its memory in a WeakMap keyed by the
 *  World object, so one distinct proxy per seat = one separate bot memory per seat. Reads only; writes pass through. */
function seatView(w: World, slot: number): World {
  let arr = SEAT_VIEWS.get(w);
  if (!arr) { arr = []; SEAT_VIEWS.set(w, arr); }
  let v = arr[slot];
  if (!v) {
    v = new Proxy(w, {
      get(t, k) {
        if (typeof k === 'string') {
          if (CURSOR_KEYS.has(k)) {
            const p = t.players[slot] as unknown as Record<string, unknown>;
            return k === 'pl' ? t.players[slot] : p[k];
          }
          if (k === 'cur') return slot;
        }
        return Reflect.get(t, k, t);
      },
      set(t, k, val) { return Reflect.set(t, k, val, t); },
    });
    arr[slot] = v;
  }
  return v;
}

/** The stand-in's CARD RAIL substitute: the draft screen's path (rollOffer -> botPickUpgrade -> pickUpgrade). */
function standinDrafts(w: World, slot: number): number {
  let picked = 0;
  M_players.withPlayer(w, slot, () => {
    let guard = 0;
    while (M_draft.hasPendingDraft(w) && guard++ < 40) {
      const before = w.upgrades.pendingDrafts + w.upgrades.chestDrafts;
      const offer = w.upgrades.offer && w.upgrades.offer.length > 0 ? w.upgrades.offer : M_draft.rollOffer(w);
      M_draft.pickUpgrade(w, M_bot.botPickUpgrade(w, offer));
      picked++;
      if (w.upgrades.pendingDrafts + w.upgrades.chestDrafts >= before) break;
    }
  });
  return picked;
}

// ─────────────────────────────── small helpers ───────────────────────────────
function floorsStanding(w: World, total: number): number {
  let s = 0;
  for (const b of w.city.buildings) s += b.collapsed ? 0 : b.alive;
  return total > 0 ? s / total : 1;
}
function finite(...xs: number[]): boolean { for (const x of xs) if (!Number.isFinite(x)) return false; return true; }
export function median(a: number[]): number {
  if (a.length === 0) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function fmtClock(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return '  -  ';
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r.toFixed(0).padStart(2, '0')}`;
}

// ─────────────────────────────── one 4-bot match ───────────────────────────────
export interface MatchCfg {
  seed: number; biome: BiomeId; lineup: TitanId[]; level: BotLevel; driver: Driver;
  maxS: number;                 // sim seconds of MATCH CLOCK to allow (the gate wants an end by 645)
  perturb: boolean;             // determinism negative control: nudge seat 1's XP by 0.25 at tick 600
  asserts: boolean;             // setBindAsserts(true)
  /** FIXHIGH: seat driven like a HUMAN seat (no bot brain: no rival / ring / tender logic) while the other seats keep their native bots.
   *  'solo' = the solo bot (_harness/bot.ts) steers it (a weak human stand-in); 'idle' = no input at all (worst case). Info only. */
  humanSeat?: number; humanDriver?: 'solo' | 'idle';
}
export interface Snap {
  t: number; phase: string; lv: number[]; rank: number[]; hpf: number[]; alive: boolean[]; elim: boolean[];
  xp: number[]; floorsPct: number; crown: number; kos: number[];
}
export interface SeatSummary {
  slot: number; titan: string; level: number; rank: number; place: number; score: number; evictions: number; koCount: number;
  assists: number; pvpDealt: number; tonnage: number; peakRank: number; eliminated: boolean; drafts: number;
}
export interface MatchResult {
  cfg: MatchCfg; error: string | null; ticks: number;
  result: string | null; endS: number | null; winner: number; placements: number[] | null; scores: number[] | null;
  snap240: Snap | null; snap420: Snap | null; series: Snap[]; checkpoints: string[]; hash: string;
  leader420: number; gap420: number; floors240: number | null; floors420: number | null; crown420: number;
  events: Record<string, number>; phaseAt: Record<string, number>;
  firstHitS: number | null; hits: number; noContest: number;
  evictions: { t: number; victim: number; killer: number; assists: number; levelsLost: number }[];
  eliminations: { t: number; victim: number; killer: number; place: number }[];
  ringSteps: { t: number; step: number; r: number }[];
  tenders: { gate: string; markerS: number | null; spawnS: number | null; paidS: number | null; top: number; shares: number[] }[];
  crownChanges: number; railOffers: number; railPicks: number; standinDrafts: number;
  travel60: number[]; badP: number; unstamped: number;
  seats: SeatSummary[]; integrity: string[];
  perf: { avgMs: number; p99Ms: number; maxMs: number };
}

export function runMatch(cfg: MatchCfg): MatchResult {
  const n = cfg.lineup.length;
  const seats: PlayerSeat[] = cfg.lineup.map((t, i) => ({ titan: t, bot: cfg.driver === 'native' && i !== cfg.humanSeat ? cfg.level : null }));
  M_players.setBindAsserts(cfg.asserts);
  const w = M_world.createWorld({ mode: 'vs', players: seats, biome: cfg.biome, seed: cfg.seed, view: 0 });
  const vs = w.vs!;
  const startT = vs.startT;
  let totalFloors = 0;
  for (const b of w.city.buildings) totalFloors += b.floors;
  const R: MatchResult = {
    cfg, error: null, ticks: 0, result: null, endS: null, winner: -1, placements: null, scores: null,
    snap240: null, snap420: null, series: [], checkpoints: [], hash: '',
    leader420: -1, gap420: -1, floors240: null, floors420: null, crown420: -1,
    events: {}, phaseAt: {}, firstHitS: null, hits: 0, noContest: 0, evictions: [], eliminations: [], ringSteps: [], tenders: [],
    crownChanges: 0, railOffers: 0, railPicks: 0, standinDrafts: 0, travel60: new Array(n).fill(0), badP: 0, unstamped: 0,
    seats: [], integrity: [], perf: { avgMs: 0, p99Ms: 0, maxMs: 0 },
  };
  const inputs: (TitanInput | null)[] = new Array(n).fill(null);
  const last = w.players.map((p) => ({ x: p.titan.x, z: p.titan.z }));
  const snap = (): Snap => ({
    t: w.t - startT, phase: vs.phase,
    lv: w.players.map((p) => p.titan.level), rank: w.players.map((p) => p.titan.rank),
    hpf: w.players.map((p) => (p.titan.maxHp > 0 ? p.titan.hp / p.titan.maxHp : 0)), alive: w.players.map((p) => p.titan.alive),
    elim: w.players.map((p) => p.vs.eliminated), xp: w.players.map((p) => p.titan.xp), floorsPct: floorsStanding(w, totalFloors) * 100,
    crown: vs.crown, kos: w.players.map((p) => p.vs.koCount),
  });
  const leaderOf = (s: Snap): number => {
    let b = 0;
    for (let i = 1; i < n; i++) if (s.lv[i] > s.lv[b] || (s.lv[i] === s.lv[b] && s.xp[i] > s.xp[b])) b = i;
    return b;
  };
  const tenderRec = (gate: string) => {
    let r = R.tenders.find((x) => x.gate === gate);
    if (!r) { r = { gate, markerS: null, spawnS: null, paidS: null, top: -1, shares: [] }; R.tenders.push(r); }
    return r;
  };
  const tickMs: number[] = [];
  let bucket = 0, bucketN = 0, sumMs = 0, maxMs = 0, ticks = 0;
  let nextSample = 0, nextCheck = 0;
  let lastCrown = vs.crown;
  let lastPhase = vs.phase;
  R.phaseAt[lastPhase] = 0;
  const limit = startT + cfg.maxS;
  try {
    while (!w.run.result && w.t < limit) {
      if (cfg.driver === 'standin') {
        for (let i = 0; i < n; i++) inputs[i] = w.players[i].titan.alive && !w.players[i].vs.eliminated ? M_bot.botInput(seatView(w, i)) : null;
      } else if (cfg.humanSeat !== undefined && cfg.humanDriver === 'solo') {
        const h = cfg.humanSeat;
        inputs[h] = w.players[h].titan.alive && !w.players[h].vs.eliminated ? M_bot.botInput(seatView(w, h)) : null;
      }
      const t0 = performance.now();
      M_world.stepWorldN(w, inputs);
      const dtm = performance.now() - t0;
      ticks++; sumMs += dtm; if (dtm > maxMs) maxMs = dtm; bucket = Math.max(bucket, dtm);
      if (++bucketN === 30) { tickMs.push(bucket); bucket = 0; bucketN = 0; }
      if (cfg.perturb && w.tick === 600) w.players[1 % n].titan.xp += 0.25;   // a lasting nudge (a 1e-6 position nudge is absorbed by the sim: re-converges within 60 s)
      const mt = w.t - startT;
      // events
      for (const e of w.events as readonly SimEvent[]) {
        R.events[e.type] = (R.events[e.type] ?? 0) + 1;
        if (e.p === undefined) R.unstamped++; else if (e.p < -1 || e.p >= n) R.badP++;
        switch (e.type) {
          case 'rivalHit':
            if (e.noContest) R.noContest++;
            else { R.hits++; if (R.firstHitS === null) R.firstHitS = mt; }
            break;
          case 'evicted': R.evictions.push({ t: mt, victim: e.victim, killer: e.killer, assists: e.assists.length, levelsLost: e.levelsLost }); break;
          case 'eliminated': R.eliminations.push({ t: mt, victim: e.victim, killer: e.killer, place: e.place }); break;
          case 'ringStep': R.ringSteps.push({ t: mt, step: e.step, r: e.r }); break;
          case 'tenderMarker': tenderRec(e.gate).markerS = mt; break;
          case 'tenderSpawn': tenderRec(e.gate).spawnS = mt; break;
          case 'tenderPaid': { const r = tenderRec(e.gate); r.paidS = mt; r.top = e.top; r.shares = e.shares.slice(); break; }
          case 'railOffer': R.railOffers++; break;
          case 'railPick': R.railPicks++; break;
          case 'vsEnd': R.winner = e.winner; R.placements = e.placements.slice(); R.scores = e.scores.slice(); break;
          default: break;
        }
      }
      if (vs.phase !== lastPhase) { lastPhase = vs.phase; if (R.phaseAt[lastPhase] === undefined) R.phaseAt[lastPhase] = mt; }
      if (vs.crown !== lastCrown) { lastCrown = vs.crown; R.crownChanges++; }
      if (mt <= 60) for (let i = 0; i < n; i++) { const T = w.players[i].titan; R.travel60[i] += Math.hypot(T.x - last[i].x, T.z - last[i].z); }
      for (let i = 0; i < n; i++) { last[i].x = w.players[i].titan.x; last[i].z = w.players[i].titan.z; }
      // the stand-in answers drafts like the draft screen would (the real CARD RAIL does it in native mode)
      if (cfg.driver === 'standin' && R.railOffers === 0) {
        for (let i = 0; i < n; i++) if (w.players[i].upgrades.pendingDrafts > 0 || w.players[i].upgrades.chestDrafts > 0) R.standinDrafts += standinDrafts(w, i);
      }
      if (mt >= nextSample) {
        const s = snap(); R.series.push(s); nextSample += 30;
        for (let i = 0; i < n; i++) {
          const T = w.players[i].titan;
          if (!finite(T.x, T.z, T.hp, T.xp, T.height, T.maxHp)) R.integrity.push(`non-finite titan state seat ${i} @ ${mt.toFixed(1)}s`);
        }
      }
      if (mt >= nextCheck) { R.checkpoints.push(hashWide(w)); nextCheck += 30; }
      if (R.snap240 === null && mt >= 240) { R.snap240 = snap(); R.floors240 = R.snap240.floorsPct; }
      if (R.snap420 === null && mt >= 420) {
        R.snap420 = snap(); R.floors420 = R.snap420.floorsPct;
        R.leader420 = leaderOf(R.snap420);
        R.gap420 = Math.max(...R.snap420.rank) - Math.min(...R.snap420.rank);
        R.crown420 = vs.crown;
      }
    }
  } catch (e) {
    R.error = ((e as Error)?.stack ?? String(e)).split('\n').slice(0, 6).join(' | ');
  }
  R.ticks = ticks;
  R.result = w.run.result;
  R.endS = w.run.result ? (w.run.endT >= 0 ? w.run.endT : w.t) - startT : null;
  R.hash = hashWide(w);
  R.checkpoints.push(R.hash);
  if (R.winner < 0 && vs.winner >= 0) R.winner = vs.winner;
  const sortedMs = tickMs.slice().sort((a, b) => a - b);
  R.perf = { avgMs: ticks > 0 ? sumMs / ticks : 0, p99Ms: sortedMs.length ? sortedMs[Math.floor(sortedMs.length * 0.99)] : 0, maxMs };
  // seat summaries + integrity (non-pacing assertions; never widened)
  let sumTon = 0;
  for (let i = 0; i < n; i++) {
    const p = w.players[i];
    sumTon += p.run.tonnage;
    let drafts = 0;
    for (const k of Object.keys(p.upgrades.owned)) drafts += p.upgrades.owned[k];
    R.seats.push({
      slot: i, titan: p.titanId, level: p.titan.level, rank: p.titan.rank, place: p.vs.place, score: p.vs.score, evictions: p.vs.evictions,
      koCount: p.vs.koCount, assists: p.vs.assists, pvpDealt: p.vs.pvpDealt, tonnage: p.run.tonnage, peakRank: p.vs.peakRank,
      eliminated: p.vs.eliminated, drafts,
    });
    if (!finite(p.titan.x, p.titan.z, p.titan.hp, p.titan.xp)) R.integrity.push(`non-finite titan state seat ${i} at the end`);
  }
  if (sumTon > w.run.tonnage + 1e-6) R.integrity.push(`sum of per-player tonnage ${sumTon.toFixed(1)} > world tonnage ${w.run.tonnage.toFixed(1)}`);
  if (R.badP > 0) R.integrity.push(`${R.badP} event(s) with p outside -1..${n - 1}`);
  if (R.unstamped > 0) R.integrity.push(`${R.unstamped} event(s) with no p stamp`);
  if (w.run.result === 'vs') {
    const places = w.players.map((p) => p.vs.place).slice().sort((a, b) => a - b);
    if (places.join() !== Array.from({ length: n }, (_, i) => i + 1).join()) R.integrity.push(`final places are not a permutation of 1..${n}: ${places.join(',')}`);
    if (R.winner < 0) R.integrity.push('match ended (result vs) but no winner was reported (no vsEnd.winner, vs.winner = -1)');
    else if (w.players[R.winner]?.vs.place !== 1) R.integrity.push(`winner seat ${R.winner} has place ${w.players[R.winner]?.vs.place}, not 1`);
    if (!R.placements) R.integrity.push('match ended but no vsEnd event was seen');
  }
  return R;
}

// ─────────────────────────────── one equal-size 1v1 duel (TTK) ───────────────────────────────
export interface DuelCfg {
  a: TitanId; b: TitanId; seed: number; biome: BiomeId; rank: number; geared: boolean; driver: Driver; capS: number;
}
export interface DuelResult {
  cfg: DuelCfg; error: string | null;
  engageS: number | null;        // jump -> first real rival hit
  ttkS: number | null;           // first real rival hit -> first EVICTED
  koSlot: number; hp50S: number | null; minDist: number; hits: number; noContest: number; timedOut: boolean;
  levelA: number; levelB: number; drafts: number; phase: string;
  minHpf: number;                // lowest HP fraction either titan reached (an unresolved duel: how close it came)
  endDist: number;               // distance between the titans when the duel stopped (bots that disengage drift apart)
}

/** drafts a titan would have taken at `level` under the VS cadence (every level to LV 12, then every 2nd) */
export function draftsAtLevel(level: number): number {
  const to = M_cfg.VS.rail.everyLevelTo, every = M_cfg.VS.rail.thenEvery;
  return Math.max(0, Math.min(level - 1, to - 1)) + Math.floor(Math.max(0, level - to) / every);
}

function duelPilot(w: World, slot: number): TitanInput {
  const me = w.players[slot].titan, ot = w.players[1 - slot].titan;
  const dx = ot.x - me.x, dz = ot.z - me.z;
  const d = Math.hypot(dx, dz) || 1;
  const reach = M_bot.botReach(seatView(w, slot));
  const want = reach * 0.7 + (me.radius + ot.radius) * 0.3;
  const go = d > want;
  return { mx: go ? dx / d : 0, mz: go ? dz / d : 0, ability: w.tick % 90 === slot * 45, abilityHeld: false, dash: false };
}

export function runDuel(cfg: DuelCfg): DuelResult {
  const R: DuelResult = {
    cfg, error: null, engageS: null, ttkS: null, koSlot: -1, hp50S: null, minDist: Infinity, hits: 0, noContest: 0, timedOut: false,
    levelA: 0, levelB: 0, drafts: 0, phase: '', minHpf: 1, endDist: 0,
  };
  try {
    M_players.setBindAsserts(false);
    const seats: PlayerSeat[] = [cfg.a, cfg.b].map((t) => ({ titan: t, bot: cfg.driver === 'native' ? 'regular' : null }));
    const w = M_world.createWorld({ mode: 'vs', players: seats, biome: cfg.biome, seed: cfg.seed, view: 0 });
    const vs = w.vs!;
    // SETUP (data only): equal size, optional cards, full HP, face to face, no Civil Defense, tenders withdrawn
    for (let i = 0; i < 2; i++) {
      M_players.withPlayer(w, i, () => {
        M_titan.growToRank(w, cfg.rank);
        if (cfg.geared) {
          const nCards = draftsAtLevel(w.titan.level);
          for (let k = 0; k < nCards; k++) {
            w.upgrades.pendingDrafts = Math.max(1, w.upgrades.pendingDrafts);
            if (!M_draft.hasPendingDraft(w)) break;
            const offer = M_draft.rollOffer(w, false);
            M_draft.pickUpgrade(w, M_bot.botPickUpgrade(w, offer));
            R.drafts++;
          }
          w.upgrades.pendingDrafts = 0; w.upgrades.offer = null;
        }
        w.titan.hp = w.titan.maxHp;
      });
    }
    const sp = M_vs.vsSpawnPoints(w.city, 1)[0];
    const A = w.players[0].titan, B = w.players[1].titan;
    const gap = 3 * Math.max(A.height, B.height);
    A.x = A.px = sp.x; A.z = A.pz = sp.z; A.heading = A.pheading = Math.atan2(1, 0);
    B.x = B.px = sp.x + gap; B.z = B.pz = sp.z; B.heading = B.pheading = Math.atan2(-1, 0);
    R.levelA = A.level; R.levelB = B.level;
    w.cheats.noSpawns = true;
    for (const t of vs.tenders) t.state = 'withdrawn';
    // jump to the start of HOSTILE TAKEOVER (rival damage on); the phase machine reads the clock
    const jumpS = M_cfg.VS.phase.openEndS + 1;
    w.t = vs.startT + jumpS;
    w.tick = Math.round(w.t / w.dt);
    const inputs: (TitanInput | null)[] = [null, null];
    const t0 = w.t;
    let hitT = -1;
    const limit = t0 + cfg.capS + 8;
    while (!w.run.result && w.t < limit) {
      if (cfg.driver === 'standin') { inputs[0] = duelPilot(w, 0); inputs[1] = duelPilot(w, 1); }
      M_world.stepWorldN(w, inputs);
      const d = Math.hypot(A.x - B.x, A.z - B.z);
      if (d < R.minDist) R.minDist = d;
      R.endDist = d;
      R.minHpf = Math.min(R.minHpf, A.hp / A.maxHp, B.hp / B.maxHp);
      let done = false;
      for (const e of w.events as readonly SimEvent[]) {
        if (e.type === 'rivalHit') {
          if (e.noContest) R.noContest++;
          else { R.hits++; if (hitT < 0) { hitT = w.t; R.engageS = hitT - t0; } }
        } else if (e.type === 'evicted' || e.type === 'eliminated') {
          if (R.koSlot < 0) { R.koSlot = e.victim; R.ttkS = hitT >= 0 ? w.t - hitT : null; done = true; }
        }
      }
      if (R.hp50S === null && hitT >= 0 && (A.hp < A.maxHp * 0.5 || B.hp < B.maxHp * 0.5)) R.hp50S = w.t - hitT;
      if (!A.alive || !B.alive) { if (R.koSlot < 0) { R.koSlot = A.alive ? 1 : 0; R.ttkS = hitT >= 0 ? w.t - hitT : null; } done = true; }
      if (done) break;
      if (hitT < 0 && w.t > t0 + cfg.capS) break;       // never engaged
      if (hitT >= 0 && w.t - hitT > cfg.capS) break;    // a fight that will not end
    }
    R.phase = vs.phase;
    R.timedOut = R.ttkS === null;
  } catch (e) {
    R.error = ((e as Error)?.stack ?? String(e)).split('\n').slice(0, 5).join(' | ');
  }
  return R;
}

// ─────────────────────────────── landed-lane probes (cheap, from one short run) ───────────────────────────────
export interface Readiness {
  phaseMachine: boolean; botBrain: boolean | null; rail: boolean; pvp: boolean; evictions: boolean; ring: boolean;
  eliminations: boolean; tenders: boolean; crown: boolean; matchEnds: boolean;
}
