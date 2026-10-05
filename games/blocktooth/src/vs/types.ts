// BLOCKTOOTH VS ("ZONING DISPUTE") — state shapes that the sim core holds but the VS lane owns.
// THREE-FREE, type-only (no runtime). Created by lane B-CORE as the STARTING shape from
// _spec/online/vs_design.md §3-§13; lane B-VS OWNS this file from here on and may extend it freely:
// core (types.ts / world.ts) only imports these names as types, so growing them never touches core.
//
// Everything here is plain data (numbers / strings / arrays / records), part of the lockstep state hash
// scope: no functions, no Map/Set, no class instances (World cannot be cloned; see netcode.md §2.1).

import type { BossId, GateId, RunMeta, TitanId } from '../core/types.ts';

/** vs_design.md §3. 'countdown' = the 5 s before OPEN HOUSE (titans frozen); 'over' = the match is decided. */
export type VsPhase = 'countdown' | 'open' | 'takeover' | 'final' | 'last' | 'over';
export const VS_PHASES: readonly VsPhase[] = ['countdown', 'open', 'takeover', 'final', 'last', 'over'];

/** Bot difficulty (vs_design.md §10). */
export type BotLevel = 'rookie' | 'regular' | 'veteran';

/** One entry of a PUBLIC TENDER schedule (vs_design.md §4.2). The rig itself lives in World.boss. */
export interface TenderState {
  gate: GateId;            // which authored rig (stencil1 / cordon2 / switchboard5)
  boss: BossId;            // = gate (kept so the boss framework can be asked by id)
  /** 'pending' = not yet announced · 'marker' = the 15 s lead-in (marker + minimap ping) · 'live' = the rig is up ·
   *  'paid' = defeated and rewards split · 'withdrawn' = BID WITHDRAWN after 60 s unattended */
  state: 'pending' | 'marker' | 'live' | 'paid' | 'withdrawn';
  atS: number;             // scheduled match-clock second the rig ARRIVES (VS.tender.gates[i].atS); the marker goes up markerLeadS earlier
  x: number; z: number;    // crosswalk where it arrives (set when the marker goes up)
  spawnSlot: number;       // the last-place titan whose quadrant it was placed near (-1 until placed)
  markerT: number;         // world.t the marker went up (-1)
  spawnT: number;          // world.t the rig walked in (-1)
  /** damage dealt to the rig by each seat (the "bids"); index = slot */
  dmg: number[];
  /** damage dealt to the rig in the last retargetWindowS by each seat (rig target choice) */
  recent: number[];
  targetSlot: number;      // the titan the rig currently hunts (-1 none)
  retargetT: number;       // world.t of its last switch
  ignoredS: number;        // seconds with no titan within 2 x spawn ring
}

/** The shrinking CONDEMNATION ORDER ring (vs_design.md §5). */
export interface RingState {
  cx: number; cz: number;  // centre (picked deterministically from the seed at match start)
  r: number;               // current radius (m)
  fromR: number; toR: number; t0: number; t1: number;   // the running shrink step: r lerps fromR -> toR over t0..t1 (world.t)
  step: number;            // index into VS.ring.steps of the last step started (-1 none)
  r0: number;              // radius at 100 % (the city half-width the fractions apply to)
  mortarT: number;         // world.t of the last mortar volley
}

/** World-level VS state (World.vs; null in solo). Phase machine, crown, ring, tenders, result. */
export interface VsWorld {
  phase: VsPhase;
  phaseT: number;          // world.t the current phase began
  /** world.t at which OPEN HOUSE begins (= VS.countdownS); match clock = w.t - startT */
  startT: number;
  /** the FRONT PAGE crown holder slot (-1 none; live from the start of HOSTILE TAKEOVER) */
  crown: number;
  ring: RingState;
  tenders: TenderState[];
  /** slots in elimination order (first out ... last out); the winner is appended when decided (placement = reverse) */
  order: number[];
  winner: number;          // slot (-1 until decided)
  endT: number;            // world.t the match was decided (-1)
  /** free numeric scratch for the VS lane (kept numeric so it hashes) */
  data: Record<string, number>;
}

/** A recent hit on a seat, kept for KO credit / assists (vs_design.md §6.2 rule 8). */
export interface VsHitLog { from: number; t: number; pct: number }

/** Per-seat VS bookkeeping (PlayerState.vs). Solo worlds still carry a neutral copy (never read). */
export interface PlayerVs {
  /** out of the match for good (FINAL NOTICE KO, or a leaver whose seat the bot also lost) */
  eliminated: boolean;
  elimT: number;           // world.t eliminated (-1)
  place: number;           // 1..4 once decided (0 = still in)
  /** EVICTED respawn: world.t the titan comes back (-1 = alive / not KO'd) */
  respawnT: number;
  spawnProtT: number;      // > 0: spawn protection seconds left
  clearedT: number;        // > 0: CLEARED (CC immunity) seconds left
  koCount: number;         // times this seat was evicted
  evictions: number;       // KOs this seat scored
  assists: number;
  pvpDealt: number;        // sum of (% of the victim's max HP) dealt to rivals
  pvpTaken: number;
  tenderBids: number;      // tenders this seat dealt >= 5 % to
  tenderTop: number;       // tenders this seat was top bidder on
  crownS: number;          // seconds holding the crown
  peakRank: number;        // highest Size rank reached
  rankT: number[];         // world.t each Size II..V was reached (index 0 = Size II; -1 until)
  score: number;           // VS SCORE (vs_design.md §9), refreshed by the VS lane
  hits: VsHitLog[];        // recent hits received (trimmed to the credit window)
  lastKillerSlot: number;  // who evicted/eliminated this seat last (-1)
  /** the bot brain memory parked here while a human holds the seat (takeover), so a later leave resumes it (null none) */
  sleeper: BotMemory | null;
  /** numeric scratch (all keys documented in src/vs/seatdata.ts): shove velocity, stomp pair timers, mortar timer, tender
   *  share, left-flag, ... kept numeric so it hashes */
  data: Record<string, number>;
}

/** A telegraph the bot is steering around / ignoring (kept numeric: ids only). */
export interface BotAvoidSpot { x: number; z: number; until: number }

/**
 * Per-bot-seat memory (PlayerState.bot; null for a human seat). Port of _harness/bot.ts BotMemory (one per WORLD there,
 * one per SEAT here) plus the VS layers' state. Plain data only (hashable, replay-safe).
 */
export interface BotMemory {
  level: BotLevel;
  mode: string;            // current brain layer: 'food' | 'threat' | 'ring' | 'rival' | 'tender' | 'flee' | 'stuck' | ...
  targetSlot: number;      // rival / tender target (-1 none)
  modeT: number;           // world.t the mode began
  /** misc numeric memory (rail pick sequence, engaged-since, ...) */
  data: Record<string, number>;
  // ── bot.ts BotMemory, per seat ──
  inited: boolean;
  hasTarget: boolean;
  tx: number; tz: number;
  planTick: number;
  lastX: number; lastZ: number; checkTick: number; wasMoving: boolean;
  detourUntil: number; detourX: number; detourZ: number; detourSign: number;
  avoid: BotAvoidSpot[];
  holdAbilityUntil: number;
  strafeSign: number; strafeFlipTick: number;
  // ── VS layers ──
  /** engaged with targetSlot since this tick (-1 not engaged) */
  engagedTick: number;
  /** fleeing a fight until this tick (hysteresis; -1 none) */
  fleeUntil: number;
  /** CARD RAIL: the rail offer sequence number already answered (so a pick is one edge per offer) */
  railSeq: number;
}

/** What a seat is told at match start (createWorld input), per slot. */
export interface PlayerSeat {
  titan: TitanId;
  /** run meta (palette only is honoured in VS; unlocks/perk are stripped) */
  meta?: RunMeta;
  /** null / undefined = a human seat (inputs come from stepWorldN); a level = the VS bot brain drives it */
  bot?: BotLevel | null;
}
