// BLOCKTOOTH - net/simport.ts (lane B-NET). The seam between the lockstep session and the sim.
//
// The session layer (lockstep.ts) never imports the sim: it drives a SimPort. This file holds the interface and the
// adapter for the CURRENT 1-titan World (createWorld / stepWorld as shipped). When B-CORE lands
// `createWorld({players})` + PlayerState, a `vsWorldPort` replaces `soloWorldPort` here and nothing in lockstep.ts
// changes (each seat's decoded input goes to its own PlayerState instead of the shared titan).
//
// 1-titan adapter rules (deterministic, identical on every peer):
//   * PILOT ROTATION: the one titan is driven by seat `pilotSeat(tick)` = floor((tick-1) / PILOT_TICKS) % 4, so every
//     seat's input stream (human, late-repeated, AFK-bot or bot) reaches the sim in turn and a wrong frame on ANY seat
//     changes the world hash.
//   * a seat whose botMask bit is set is driven by the injected bot brain (`bot(w)`), evaluated on every peer.
//   * drafts never freeze the sim online (CARD RAIL, ONLINE_PLAN B.1): a pending draft is resolved on the tick it
//     appears, with the pilot's card byte (1..N = card N of the offer) when that seat is human and the byte is valid,
//     else the bot's pick. Exactly probe_sim's roll -> pick path.
//
// Sim hooks this layer would like from B-CORE / B-DET are listed in _harness/scratch/partb/B-NET/NOTES.md.

import type { BiomeId, PlayerSeat, RunMeta, TitanId, TitanInput, World } from '../core/types.ts';
import { EMPTY_RUN_META } from '../core/types.ts';
import { createWorld, setViewSlot, stepWorld, stepWorldN } from '../core/world.ts';
import { VS } from '../core/config.ts';
import { TITANS } from '../data/titans.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../upgrades/draft.ts';
import { vsStandings } from '../vs/score.ts';
import { vsLeaveSeat, vsTakeOverSeat, canTakeOverSeat } from '../vs/seats.ts';
import type { BotLevel } from '../vs/types.ts';
import { vsFullFlat, type HashAtom } from './vshash.ts';
import { type Frame, type StartInfo, CARD, SEATS, INPUT_BYTES, TICK_HZ, decodeInput, cardOf } from './proto.ts';

/** What the lockstep session needs from a world. W is opaque to the session. */
export interface SimPort<W> {
  create(start: StartInfo): W;
  /** step exactly one tick with the canonical frame (frame.tick === tick(w) + 1) */
  step(w: W, f: Frame): void;
  tick(w: W): number;
  /** 32-bit hash over every gameplay-relevant field (desync detection) */
  hash(w: W): number;
  /** the match is over (the session stops producing frames after the tick on which this turned true) */
  ended(w: W): boolean;
  /** final standings, JSON-able; MUST be a pure function of the world + the canonical frame log */
  standings(w: W, lastFrame: Frame | null): Standings;
  /** test hook: perturb this world by one ulp (forced-desync scenario); never called in play */
  perturb?(w: W): void;
  /**
   * Catch-up budget for a world that has to replay many ticks (a replay join, a long stall): the session hands it to
   * LockstepPeer so a heavy world (4 titans) never freezes the page. Absent = the session's own defaults.
   */
  catchup?: { stepBudgetMs: number; maxStepsPerPump: number };
}

export interface SeatStanding {
  slot: number; kind: 'human' | 'bot'; place: number; score: number;
  /** VS only (the solo adapter leaves them out): what the end card, the stats bridge and the ratings read */
  titan?: string; won?: boolean; evictions?: number; assists?: number; koCount?: number; pvpDealt?: number; peakSize?: number;
  tonnage?: number; crownS?: number;
  /** a human who left (the seat is a bot now): the ratings put them 4th (vs_design.md 9) */
  left?: boolean;
  /** this seat was a bot that a human took over mid-match: stats yes, rating no (vs_design.md 9) */
  tookOver?: boolean;
}
export interface Standings {
  endTick: number;
  result: string;
  seats: SeatStanding[];
  /** world summary numbers every peer must agree on */
  summary: Record<string, number | string>;
  /** FNV over the canonical JSON of the fields above */
  hash: number;
}

// ─────────────────────────────── world hash ───────────────────────────────
// Widened from _harness/probe_sim.ts hashWorld (netcode.md 7.2: "keep the hash wide"): titan, enemies, pickups,
// projectiles, telegraphs, hazards, boss, owned upgrades, every moving prop, every building's floors + hp, run
// bookkeeping, UPROAR + gates counters. Raw float bits, so a 1-ulp difference changes the hash.

const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
export class Hasher {
  h = 0x811c9dc5 >>> 0;
  u32(x: number): void {
    let h = this.h;
    h = Math.imul(h ^ (x & 0xff), 0x01000193); h = Math.imul(h ^ ((x >>> 8) & 0xff), 0x01000193);
    h = Math.imul(h ^ ((x >>> 16) & 0xff), 0x01000193); h = Math.imul(h ^ ((x >>> 24) & 0xff), 0x01000193);
    this.h = h >>> 0;
  }
  num(x: number): void { F64[0] = x; this.u32(U32[0]); this.u32(U32[1]); }
  bool(b: boolean): void { this.u32(b ? 1 : 0); }
  str(s: string): void { for (let i = 0; i < s.length; i++) this.h = Math.imul(this.h ^ (s.charCodeAt(i) & 0xff), 0x01000193) >>> 0; }
}

export function hashWorld(w: World): number {
  if (w.mode === 'vs') return hashVsWorld(w);
  const hs = new Hasher();
  const T = w.titan;
  hs.num(w.tick); hs.num(w.t); hs.num(w.nextId);
  for (const v of [T.x, T.z, T.heading, T.hp, T.maxHp, T.mass, T.xp, T.level, T.rank, T.height,
    T.kills, T.crushed, T.floorsEaten, T.buildingsLeveled, T.propsEaten, T.damageTaken, T.abilityCd, T.dashCharges]) hs.num(v);
  hs.bool(T.alive);
  let n = 0;
  for (const e of w.enemies) { if (!e.alive) continue; n++; hs.num(e.id); hs.str(e.kind); hs.num(e.x); hs.num(e.z); hs.num(e.hp); }
  hs.num(n); n = 0;
  for (const p of w.pickups) { if (!p.alive) continue; n++; hs.num(p.id); hs.num(p.x); hs.num(p.z); }
  hs.num(n); n = 0;
  for (const p of w.projectiles) { if (!p.alive) continue; n++; hs.num(p.id); hs.num(p.x); hs.num(p.z); }
  hs.num(n); n = 0;
  for (const t of w.telegraphs) { if (!t.alive) continue; n++; hs.num(t.id); }
  hs.num(n); n = 0;
  for (const z of w.hazards) { if (!z.alive) continue; n++; hs.num(z.id); }
  hs.num(n);
  if (w.boss) { hs.str(w.boss.id); hs.num(w.boss.x); hs.num(w.boss.z); hs.num(w.boss.hp); hs.num(w.boss.phase); hs.num(w.boss.meter); }
  const owned = Object.keys(w.upgrades.owned).sort();
  for (const k of owned) { hs.str(k); hs.num(w.upgrades.owned[k]); }
  for (const b of w.city.buildings) { hs.num(b.alive); hs.num(b.floorHp); }
  for (const p of w.city.props) { hs.bool(p.alive); if (p.lane < 0) continue; hs.num(p.x); hs.num(p.z); }
  hs.num(w.run.tonnage); hs.num(w.run.blocksLeveled); hs.num(w.run.peakRank);
  hs.str(w.run.phase); hs.str(w.run.result ?? '-');
  return hs.h >>> 0;
}

/** VS world hash. NEVER reads the cursor (w.titan / w.upgrades ... point at the VIEW seat, which differs on every peer):
 *  the world-scoped bookkeeping, the city (every building's floors + hp, every prop), then vshash.ts vsFullFlat (every
 *  seat's whole state + the VS world + every live entity). Raw float bits, so a 1-ulp difference changes the hash. */
function hashVsWorld(w: World): number {
  const hs = new Hasher();
  hs.num(w.tick); hs.num(w.t); hs.num(w.nextId);
  for (const b of w.city.buildings) { hs.num(b.alive); hs.num(b.floorHp); hs.bool(b.collapsed); }
  for (const p of w.city.props) { hs.bool(p.alive); hs.num(p.hp); if (p.lane < 0) continue; hs.num(p.x); hs.num(p.z); hs.num(p.heading); hs.num(p.laneS); hs.num(p.speed); hs.num(p.scared); }
  hs.num(w.run.tonnage); hs.num(w.run.blocksLeveled); hs.num(w.run.peakRank);
  hs.str(w.run.phase); hs.str(w.run.result ?? '-');
  const a: HashAtom[] = [];
  vsFullFlat(w, a);
  // a string atom ends in a 0x1f byte, so the atoms 'ab','c' never hash like 'a','bc'
  for (let i = 0; i < a.length; i++) { const x = a[i]; if (typeof x === 'string') { hs.str(x); hs.u32(0x1f); } else hs.num(x); }
  return hs.h >>> 0;
}

export function hashJson(v: unknown): number {
  const hs = new Hasher();
  hs.str(JSON.stringify(v));
  return hs.h >>> 0;
}

// ─────────────────────────────── 1-titan adapter ───────────────────────────────

export const PILOT_TICKS = 300;              // 10 s per pilot turn
export function pilotSeat(tick: number): number { return Math.floor((Math.max(1, tick) - 1) / PILOT_TICKS) % SEATS; }

export interface SoloBot {
  input(w: World): TitanInput;
  pick(w: World, offer: readonly string[]): string;
}

export interface SoloPortOpts {
  bot: SoloBot;
  meta?: RunMeta;
}

export function soloWorldPort(o: SoloPortOpts): SimPort<World> {
  const meta = o.meta ?? EMPTY_RUN_META;
  return {
    create(start: StartInfo): World {
      const seat0 = start.seats[0];
      return createWorld({ titan: seat0.titan as TitanId, biome: start.biome as BiomeId, seed: start.seed,
        meta: { ...meta, unlocked: meta.unlocked.slice() } });
    },
    step(w: World, f: Frame): void {
      const pilot = pilotSeat(f.tick);
      const isBot = ((f.botMask >> pilot) & 1) === 1;
      const off = pilot * INPUT_BYTES;
      let guard = 0;
      while (hasPendingDraft(w) && ++guard <= 64) {
        const chest = w.upgrades.chestDrafts > 0;
        const offer = w.upgrades.offer && w.upgrades.offer.length > 0 ? w.upgrades.offer : rollOffer(w, chest);
        if (!offer || offer.length === 0) break;
        const card = isBot ? 0 : cardOf(f.inputs, off);
        const id = card >= 1 && card <= offer.length ? offer[card - 1] : o.bot.pick(w, offer);
        pickUpgrade(w, id);
      }
      const inp = isBot ? o.bot.input(w) : decodeInput(f.inputs, off);
      stepWorld(w, inp);
    },
    tick(w: World): number { return w.tick; },
    hash: hashWorld,
    ended(w: World): boolean { return w.run.result !== null; },
    standings(w: World, last: Frame | null): Standings {
      const T = w.titan;
      const summary: Record<string, number | string> = {
        result: w.run.result ?? 'time', t: w.t, level: T.level, rank: T.rank, kills: T.kills,
        floors: T.floorsEaten, tonnage: w.run.tonnage, hp: T.hp, worldHash: hashWorld(w),
      };
      // 1-titan world: every seat shares the titan, so the score is the shared tonnage; place by slot (a VS world
      // ranks per player). kind comes from the CANONICAL last frame's botMask, never from local roster state.
      const seats: SeatStanding[] = [];
      for (let s = 0; s < SEATS; s++) {
        const bot = last ? ((last.botMask >> s) & 1) === 1 : true;
        seats.push({ slot: s, kind: bot ? 'bot' : 'human', place: s + 1, score: w.run.tonnage });
      }
      const body = { endTick: w.tick, result: String(summary.result), seats, summary };
      return { ...body, hash: hashJson(body) };
    },
    perturb(w: World): void {
      // 1 ulp on titan.x (the sim may absorb it: collision / leash snaps overwrite positions, netcode.md 6.4 saw 3 of 4
      // runs absorb it) AND 1 ulp on run.tonnage, an accumulator the sim only adds to, so the forced desync persists
      F64[0] = w.titan.x; U32[0] ^= 1; w.titan.x = F64[0];
      F64[0] = w.run.tonnage + 1; U32[0] ^= 1; w.run.tonnage = F64[0] - 1;
    },
  };
}

export const EMPTY_FRAME_INPUTS = (): Uint8Array => new Uint8Array(SEATS * INPUT_BYTES);

// ─────────────────────────────── VS adapter: 4 seats, one world ───────────────────────────────
// The SimPort of the REAL multi-titan VS world (CORE_CONTRACT.md). lockstep.ts needs nothing from it beyond this interface.
//
//   * create(start)  createWorld({mode:'vs', players}) from the START message: per seat the titan id and, for a bot seat, its
//                    difficulty (SeatInfo.botLevel 0 rookie / 1 regular / 2 veteran, default regular). The local seat the app
//                    renders is `viewSeat()` (the cursor only; the hash never reads it).
//   * step(w, f)     one canonical frame -> stepWorldN. Per seat: the 4-byte input word is decoded (mx, mz, flags) and the
//                    card byte becomes TitanInput.railPick / railReroll (CARD RAIL, an EDGE: ignored on a late frame, where
//                    the previous word is repeated, so a repeat can never pick twice). A seat whose botMask bit is set gets
//                    `null` and the in-sim VS bot brain (src/vs/bot, per-seat BotMemory) drives it. The seat roles follow
//                    the canonical botMask EVERY tick, so they are a pure function of the frame log (replay-safe):
//                      bit set, seat human   -> vsLeaveSeat: a bot takes the titan on this tick (AFK, left, desynced, or a
//                                               joiner still downloading), resuming the parked bot memory if there is one
//                      bit clear, seat bot   -> a human takes the seat: an AFK human coming back, or a bot-seat takeover
//                                               (vs_design.md 10: allowed until 3:00 by the net layer's JOIN_CUTOFF_TICK; the
//                                               port never refuses what the canonical frames say)
//   * hash(w)        hashWorld -> vshash.ts vsFullFlat: every seat, the VS world, every live entity, the city.
//   * ended(w)       run.result !== null (the VS lane sets 'vs' when the match is decided, at the latest at the hard end).
//   * standings      vsStandings(w): places, scores, per-seat counters; seat kind from the CANONICAL last frame.
//   * perturb        1 ulp on seat 2's titan.x and on its (accumulate-only) tonnage: the forced-desync test hook.

/** Difficulty by SeatInfo.botLevel. */
const BOT_LEVELS: readonly BotLevel[] = ['rookie', 'regular', 'veteran'];
export function botLevelOf(n: number | undefined): BotLevel { return n !== undefined && n >= 0 && n < BOT_LEVELS.length ? BOT_LEVELS[n | 0] : 'regular'; }

/** Match length in sim ticks: the 5 s COUNTDOWN + the VS hard end (10:45 on the match clock) = 19,500. A START's endTick must be
 *  at least this (the sim ends the match itself at the hard end; the session's cap is only a backstop). */
export const VS_MATCH_TICKS = Math.round((VS.countdownS + VS.phase.hardEndS) * TICK_HZ);

export interface VsPortOpts {
  /** the seat the local player drives (the cursor / view only; defaults to 0). Called on every create(), so a world the
   *  session rebuilds (stepped-down host) comes back looking at the right seat. */
  viewSeat?: () => number;
}

export function vsWorldPort(o: VsPortOpts = {}): SimPort<World> {
  return {
    create(start: StartInfo): World {
      const players: PlayerSeat[] = [];
      for (let s = 0; s < SEATS; s++) {
        const si = start.seats[s];
        const id = si && (si.titan as TitanId) in TITANS ? (si.titan as TitanId) : 'molo';
        players.push({ titan: id, bot: !si || si.kind === 'bot' ? botLevelOf(si?.botLevel) : null });
      }
      const w = createWorld({ mode: 'vs', players, biome: start.biome as BiomeId, seed: start.seed, view: 0 });
      const v = o.viewSeat ? o.viewSeat() : 0;
      if (v > 0 && v < SEATS) setViewSlot(w, v);
      return w;
    },
    step(w: World, f: Frame): void {
      const ins: (TitanInput | null)[] = [null, null, null, null];
      const n = w.players.length;
      for (let s = 0; s < n; s++) {
        const P = w.players[s];
        const bit = (f.botMask >> s) & 1;
        if (bit === 1 && P.bot === null) {
          vsLeaveSeat(w, s, botLevelOf(undefined));
        } else if (bit === 0 && P.bot !== null) {
          if (P.vs.data.left === 1) { delete P.vs.data.left; P.vs.sleeper = P.bot; P.bot = null; }   // an AFK human is back
          else if (!(canTakeOverSeat(w, s) && vsTakeOverSeat(w, s))) { P.vs.sleeper = P.bot; P.bot = null; P.vs.data.tookOver = 1; }
        }
        if (P.bot !== null) continue;                                  // bot seat: the brain writes its input in vsBeginTick
        const off = s * INPUT_BYTES;
        const dec = decodeInput(f.inputs, off);
        const card = ((f.lateMask >> s) & 1) === 1 ? 0 : cardOf(f.inputs, off);   // an edge: a repeated (late) word never picks
        if (card === CARD.REROLL) dec.railReroll = true;
        else if (card >= 1 && card <= 3) dec.railPick = card;
        ins[s] = dec;
      }
      stepWorldN(w, ins);
    },
    tick(w: World): number { return w.tick; },
    hash: hashWorld,
    ended(w: World): boolean { return w.run.result !== null; },
    standings(w: World, last: Frame | null): Standings {
      const st = vsStandings(w);
      const seats: SeatStanding[] = [];
      for (let s = 0; s < w.players.length; s++) {
        const x = st.find((e) => e.slot === s);
        const P = w.players[s];
        const bot = last ? ((last.botMask >> s) & 1) === 1 : P.bot !== null;
        seats.push({
          slot: s, kind: bot ? 'bot' : 'human', place: x ? x.place : s + 1, score: x ? x.score : 0,
          titan: P.titanId, won: x ? x.won : false, evictions: P.vs.evictions, assists: P.vs.assists, koCount: P.vs.koCount,
          pvpDealt: P.vs.pvpDealt, peakSize: x ? x.peakSize : 1, tonnage: P.run.tonnage, crownS: P.vs.crownS,
          left: P.vs.data.left === 1, tookOver: P.vs.data.tookOver === 1,
        });
      }
      const vs = w.vs;
      const summary: Record<string, number | string> = {
        result: w.run.result ?? 'time', phase: vs ? vs.phase : '-', winner: vs ? vs.winner : -1,
        clockS: vs ? w.t - vs.startT : w.t, decided: w.run.result === null ? 0 : 1,
        tonnage: w.run.tonnage, blocks: w.run.blocksLeveled, worldHash: hashWorld(w),
      };
      const body = { endTick: w.tick, result: String(summary.result), seats, summary };
      return { ...body, hash: hashJson(body) };
    },
    perturb(w: World): void {
      const P = w.players[Math.min(2, w.players.length - 1)];
      F64[0] = P.titan.x; U32[0] ^= 1; P.titan.x = F64[0];
      F64[0] = P.run.tonnage + 1; U32[0] ^= 1; P.run.tonnage = F64[0] - 1;
    },
    catchup: { stepBudgetMs: 25, maxStepsPerPump: 600 },
  };
}

/** Build a START for the VS world (host side; the app's makeStart wraps it). endTick = the whole match + a 2 s backstop. */
export function vsStartInfo(o: {
  proto: number; build: string; matchId: string; seed: number; biome: string; lead?: number;
  seats: { kind: 'human' | 'bot'; peer: string | null; name: string; titan: string; botLevel?: number }[];
}): StartInfo {
  return {
    proto: o.proto, build: o.build, matchId: o.matchId, seed: o.seed, biome: o.biome, mode: 'vs',
    seats: o.seats.map((s, slot) => ({ slot, kind: s.kind, peer: s.peer, name: s.name, titan: s.titan, botLevel: s.botLevel })),
    endTick: VS_MATCH_TICKS + 2 * TICK_HZ, lead: o.lead ?? 4,
  };
}
