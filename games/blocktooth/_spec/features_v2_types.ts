// BLOCKTOOTH v2 — the EXACT additions to src/core/types.ts, src/core/config.ts, src/core/rng.ts,
// src/core/input.ts and src/core/save.ts that _spec/FEATURES_V2.md (§2) defines, PLUS the exact
// signatures of every new or changed module, view and UI entry point that game.ts calls (§2.6, §13).
//
// Revision 2 (2026-09-24) — resolves the independent review (FEATURES_V2.md "Review log").
//
// This file is a STANDALONE snippet: it is NOT in tsconfig "include" and nothing imports it. The
// orchestrator (lane L0, SKELETON) merges it AFTER the growth workflow has landed and passed its gates:
//   * every `…V2` union below REPLACES the union of the same base name in types.ts
//     (e.g. `export type BossId = 'caisson4' | 'irongully' | 'parkade6';`), the V2 suffix is dropped;
//   * every interface marked "ADD FIELDS" is merged field-by-field into the existing interface;
//   * every new interface / type / const is copied verbatim into the file named in its header;
//   * the `Mod*` / `*Api` interfaces are NOT copied: they are the exact export / method signatures of
//     the new or changed modules that L0 stubs (so game.ts can be pre-wired once) and the lanes fill.
//     Sim `Mod*` signatures are THREE-free; the view/UI `*Api` signatures (section "APP-SIDE") use
//     three / DOM types and are implemented in render/, titans/ and ui/ files only.
// Typecheck of this snippet (run from the game root):
//   npx tsc --ignoreConfig --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler \
//     --allowImportingTsExtensions --verbatimModuleSyntax --erasableSyntaxOnly --skipLibCheck --types node \
//     _spec/features_v2_types.ts          (re-run after revision 2: see FEATURES_V2.md Review log)
//
// Sim part: THREE-FREE. Erasable syntax only (no enum / namespace / parameter properties).

import type {
  AlertKey, BiomeDef, BiomeId, BossId, BossState, DamageKind, EnemyKind, PropKind, ProjectileKind, RankIndex, RunPhase,
  RunOptions, SimEvent, StatKey, Tier, TitanDef, TitanId, TriggerAction, UpgradeDef, UpgradeState, World,
} from '../src/core/types.ts';
import type { Input } from '../src/core/input.ts';
import type { CameraRig } from '../src/render/camera.ts';
import type { PerspectiveCamera, WebGLRenderer } from 'three';

// ═════════════════════════════════════════ types.ts — union extensions ═════════════════════════════════════════

/** types.ts BossId — PARKADE-6 is GRID-EAST's boss (FEATURES_V2 §10). */
export type BossIdV2 = BossId | 'parkade6';
export const BOSS_IDS_V2: readonly BossIdV2[] = ['caisson4', 'irongully', 'parkade6'];

/** types.ts StatKey — the UPROAR stats (§3). Defaults 1 / 1 (titans.ts DEFAULTS, stats.ts baseStatBlock),
 *  LIMITS ultCharge [0.2, 5], ultPower [0.1, Infinity]. */
export type StatKeyV2 = StatKey | 'ultCharge' | 'ultPower';

/** types.ts TriggerAction — 'ultCharge': add p.amount UPROAR points (stack-scaled, × ultCharge stat). */
export type TriggerActionV2 = TriggerAction | 'ultCharge';

/** types.ts ProjectileKind — PARKADE-6's lobbed car (hostile, lob, circle tell like 'plate'). */
export type ProjectileKindV2 = ProjectileKind | 'carLob';

/** types.ts RunPhase — after KEEP GOING (§9). spawnBoss leaves it alone while w.endless is set. */
export type RunPhaseV2 = RunPhase | 'endless';

/** types.ts AlertKey — new full-width banners (copy in FEATURES_V2 §2.5 / strings.ts ALERTS). */
export type AlertKeyV2 = AlertKey | 'overloadSite' | 'recordsAnnex' | 'endless' | 'rematch';

// ═════════════════════════════════════════ types.ts — new types ═════════════════════════════════════════

// ── #2 UPROAR (ultimate) ──
export type UltPhase = 'idle' | 'roar' | 'blast';
export interface UltState {
  charge: number;          // 0..ULT.max (100)
  ready: boolean;          // charge >= ULT.max (latched; 'ultCharged' emitted on the rising edge)
  phase: UltPhase;
  t: number;               // seconds in the current phase
  x: number; z: number;    // blast centre (latched at fire)
  r: number;               // blast radius R (m), latched at fire = ultRadius(w)
  pulse: number;           // index of the next scheduled pulse (data/ultimates.ts)
  lockT: number;           // > 0: charge frozen after a fire (ULT.lockoutS)
  /** > 0: the titan takes NO damage of any kind, dot included (ROAR; perk revive window). titansim.ts
   *  hurtTitan returns 0 while it is > 0 (L0 pre-wire). stepUltimate counts it down. */
  invulnT: number;
  fired: number;           // ultimates fired this run
  kills: number;           // kills credited to the ultimate in flight
  killsBest: number;       // best single-ultimate kill count this run (tally/goals)
  heal: number;            // BRIARWICK heal-over-time pool left (HP), 0 otherwise
  // ── kill-XP bank (§3.5 / perf): kills while phase !== 'idle' do not spawn their own scrap; they bank
  //    here and stepUltimate flushes ≤ ULT.bankPickupsPerTick merged pickups per tick ──
  bankXp: number; bankMass: number;
  /** true while meta/powerups.ts runs its DEMOLITION kill loop: those kills bank too (normal XP, no
   *  killXpMul, no xpCap) so a screen of kills never spawns hundreds of pickups in one tick */
  bankOpen: boolean;
  bankPts: number[];       // x,z pairs of the first kills banked this tick (≤ 2 × ULT.bankPickupsPerTick numbers)
  xpCap: number;           // XP this fire may still grant (latched at fire = ULT.xpCapLevelFrac × current level's XP need)
  xpTotal: number;         // XP granted through the bank this run (GATE 2 reporting)
}

// ── #4 objectives + #8 power-ups (one map-state struct) ──
export type ObjectiveKind = 'overloadSite' | 'reliefDepot' | 'recordsAnnex';
/** what an objective is bound to: a tagged building (Size II+ OVERLOAD SITE, RECORDS ANNEX), a tagged
 *  static prop (Size I OVERLOAD SITE), or nothing (RELIEF DEPOT, a free-standing entity). */
export type ObjectiveTarget = 'building' | 'prop' | 'none';
export interface Objective {
  id: number;              // newId(w)
  kind: ObjectiveKind;
  alive: boolean;          // false once done or expired (compacted every 30 ticks)
  x: number; z: number;    // marker anchor (building centre / prop / crate centre)
  target: ObjectiveTarget;
  targetId: number;        // building id or prop id; -1 for 'none'
  r: number;               // reliefDepot contact radius (m) / building half-diagonal for markers
  h: number;               // marker height anchor (m): building height, prop height or crate height
  t: number;               // age (s)
  life: number;            // expires after this (s)
  rank: RankIndex;         // titan rank when placed (sizes the crate + beacon)
  done: boolean;           // completed (payout paid) vs expired
}
export type PowerUpKind = 'cleanup' | 'demolition' | 'redLight' | 'rushHour' | 'backPay';
export interface PowerUp {
  id: number;
  kind: PowerUpKind;
  alive: boolean;
  x: number; z: number;
  t: number;               // age (s)
  life: number;            // POWERUPS.lifeS
  h: number;               // titan height at spawn (sizes the token)
}
export interface MapState {
  objectives: Objective[];
  powerups: PowerUp[];
  nextOverloadT: number;   // world.t when the next OVERLOAD SITE may be placed
  nextReliefT: number;
  annexDue: number[];      // world.t values at which a RECORDS ANNEX is owed (pushed on rankUp)
  lastDropT: number;       // world.t of the last RANDOM power-up drop (gap rule)
  redLightT: number;       // > 0: RED LIGHT active (s left)
  rushHourT: number;       // > 0: RUSH HOUR active (s left)
  overloadsDone: number; reliefsDone: number; annexesDone: number;   // this run (tally mirrors them)
  // GATE 2 reporting (probe_sim prints them; never read by gameplay)
  overloadXp: number;      // XP granted by OVERLOAD SITE payouts this run
  demolitionKills: number; // kills made by DEMOLITION NOTICE this run
}

// ── #8 endless ──
export interface EndlessState {
  startT: number;          // world.t at KEEP GOING
  rematches: number;       // rematch bosses defeated
  nextBossT: number;       // world.t for the next rematch (Infinity while one is alive)
  bossIx: number;          // index into rematchOrder(biome)
  nextEliteT: number;
  killsAt: number;         // titan.kills at KEEP GOING (score counts kills since)
  tonsAt: number;          // run.tonnage at KEEP GOING
  score: number;           // endlessScore(w), refreshed every tick
}

// ── #5 / #8 run tally (sim-side counters the goals read; THREE-free, deterministic) ──
export interface RunTally {
  kills: number; crushed: number;
  killsBy: Record<EnemyKind, number>;
  props: number;
  propsBy: Partial<Record<PropKind, number>>;
  floors: number;
  collapses: number;
  collapsesByTier: [number, number, number, number, number];
  tier4Total: number;      // tier-4 buildings the city generated (set on the first stepTally; g_ws_cold_storage)
  ults: number; ultKillsBest: number;
  objectives: Record<ObjectiveKind, number>;
  powerups: Record<PowerUpKind, number>;
  evolutions: number; banishes: number; locks: number; rerolls: number;
  hpLowFrac: number;       // lowest hp/maxHp seen this run (1 at start)
  healed: number;          // HP healed this run (titanHeal events)
  bossesDefeated: number;
  bossDefeatedBy: Partial<Record<BossIdV2, number>>;
  staggersThisFight: number;
  /** best staggers in ONE fight per boss — the city's own boss fight only (a boss fielded while
   *  w.endless is set, i.e. a rematch, does not count) */
  staggersBestFightBy: Partial<Record<BossIdV2, number>>;
  fightIsRematch: boolean; // bookkeeping for the above
  endlessS: number;
  // kit-derived (event-derived, never read from kit-private state)
  vacuumBest: number;      // MOLO: pickups collected within HOOK_WINDOW_S of one 'ability' event
  wiresBest: number;       // VOLT-KITE: most wires in one 'wireDetonate' (pts.length / 4), EXCLUDING detonations
                           // before ultWireUntilT (ultimate-laid wires would make the goal trivial)
  ultWireUntilT: number;   // world.t until which VOLT-KITE's GRIDLOCK SURGE wires may still be live
  hookKillsBest: number;   // any titan: kills within HOOK_WINDOW_S of one 'ability' event
  fullVents: number;       // HEARTHBACK: 'vent' events with power (fill) >= 0.95
  bloomsBest: number;      // BRIARWICK: most titan-owned 'bloom' hazards alive at once WITHOUT data.wild (ult blooms excluded)
  // window bookkeeping (lane-internal but part of the struct so it survives compaction/probes)
  hookT: number;           // world.t of the last 'ability' event (-1 = none)
  hookPickups: number; hookKills: number;
}

// ── #5 meta / unlocks ──
export type PerkId = 'perk_petty_cash' | 'perk_red_tape' | 'perk_warm_mic' | 'perk_safety_inspection' | 'perk_stay_of_demolition' | 'perk_tip_line';
export const PERK_IDS: readonly PerkId[] = ['perk_petty_cash', 'perk_red_tape', 'perk_warm_mic', 'perk_safety_inspection', 'perk_stay_of_demolition', 'perk_tip_line'];

/** Fixed per run, passed in through RunOptions.meta (the app builds it from the profile). The sim only
 *  READS it: which locked cards/evolutions are in the pool, the perk, the cosmetic palette. */
export interface RunMeta {
  unlocked: string[];      // UpgradeDef ids with `locked: true` that this profile has unlocked (sorted)
  perk: PerkId | null;
  palette: number;         // 0 = canonical colours; 1..2 = data/palettes.ts TITAN_PALETTES[titan][i-1] (view-only)
  reviveUsed: boolean;     // perk_stay_of_demolition bookkeeping (sim writes it; starts false)
}
export const EMPTY_RUN_META: Readonly<RunMeta> = Object.freeze({ unlocked: [], perk: null, palette: 0, reviveUsed: false });

// ═════════════════════════════════════════ types.ts — ADD FIELDS to existing interfaces ═════════════════════════════════════════

/** ADD FIELDS → types.ts RngStreams: one new independent stream (objective placement, power-up drops,
 *  endless rematch skew). Streams are seeded by hashStr(name), so adding it shifts no existing stream. */
export interface RngStreamsAdd { meta: () => number; }

/** ADD FIELDS → types.ts TitanInput. OPTIONAL on purpose: 23 existing TitanInput literals (src, _harness,
 *  _harness/scratch) stay valid. Read it as `!!input.ultimate`. Edge, buffered like ability. */
export interface TitanInputAdd { ultimate?: boolean; }

/** ADD FIELDS → types.ts UpgradeDef. */
export interface UpgradeDefAdd {
  /** evolution recipe: READY when owned[base] === UPGRADE_BY_ID[base].maxStacks AND owned[with] >= 1
   *  AND owned[this] is 0 (see ModDraftAdd.evolutionsReady) */
  evo?: { base: string; with: string };
  /** needs a profile unlock (RunMeta.unlocked contains this id) before it can be offered */
  locked?: boolean;
  /** hidden perk card: never offered, never on the ability bar; granted by applyPerk */
  perk?: boolean;
}

/** ADD FIELDS → types.ts UpgradeState (createUpgradeState: banished [], banishLeft DRAFT_V2.banishes,
 *  lockLeft DRAFT_V2.locks, locked null). */
export interface UpgradeStateAdd {
  banished: string[];      // ids removed from this run's pool
  banishLeft: number;
  lockLeft: number;
  /** id held: it keeps its slot through rerolls of the CURRENT offer and arrives in slot 0 (0-based) of
   *  the NEXT offer; cleared when it is picked or delivered */
  locked: string | null;
}

/** ADD FIELDS → types.ts World (createWorld initialises every one). */
export interface WorldAdd {
  meta: RunMeta;           // sanitizeRunMeta(opts.meta)
  ult: UltState;           // createUltState()
  map: MapState;           // createMapState()
  tally: RunTally;         // createTally()
  endless: EndlessState | null;   // null until continueEndless()
}

/** ADD FIELDS → types.ts RunOptions. */
export interface RunOptionsAdd { meta?: RunMeta; }

/** PARKADE-6 keeps its own keys in BossState.data (no structural change):
 *  tillOpen — s left of the open-till window (> 0 = the TILL drawer is out, §10.2);
 *  tow — 1 while the tow chain holds; deckTilt — rampLaunch deck tilt 0..1 (view);
 *  part_till / part_booth / part_body / part_legs — titan damage dealt per part group (probe telemetry).
 *  bossview / markerview read b.data.tillOpen and the part named 'till'.
 *  parkade6.ts step() REWRITES the 'till' BossPart every tick (ox, oz, r, y0, y1, hpMul, strainMul):
 *  closed = stowed in the booth (0, 30, r 4, strainMul 0); open = drawer out in FRONT of the booth
 *  (0, 43, r 8, hpMul 2, strainMul 4), so planar nearestBossPart picks it for a titan facing the booth
 *  (FEATURES_V2 §10.2). bossview places the drawer mesh from the part's live values. */
export type BossDataKeysParkade = 'tillOpen' | 'tow' | 'deckTilt' | 'part_till' | 'part_booth' | 'part_body' | 'part_legs';

// ═════════════════════════════════════════ types.ts — SimEvent additions ═════════════════════════════════════════

/** APPEND to the SimEvent union in types.ts. */
export type SimEventAdd =
  | { type: 'ultCharged' }                                                             // rising edge of ult.ready
  | { type: 'ultFire'; titan: TitanId; x: number; z: number; r: number }               // roar starts (0.4–0.6 s windup)
  | { type: 'ultPulse'; titan: TitanId; x: number; z: number; r0: number; r1: number; n: number; kind: DamageKind } // each damage pulse
  | { type: 'ultEnd'; titan: TitanId; kills: number }
  | { type: 'objectiveSpawn'; id: number; kind: ObjectiveKind; x: number; z: number }
  | { type: 'objectiveDone'; id: number; kind: ObjectiveKind; x: number; z: number }
  | { type: 'objectiveExpire'; id: number; kind: ObjectiveKind }
  | { type: 'powerupSpawn'; id: number; kind: PowerUpKind; x: number; z: number }
  | { type: 'powerup'; id: number; kind: PowerUpKind; x: number; z: number }            // collected
  | { type: 'powerupEnd'; kind: 'redLight' | 'rushHour' }
  | { type: 'endlessBoss'; boss: BossIdV2; n: number }                                   // a rematch is fielded
  | { type: 'revive'; x: number; z: number };                                        // perk_stay_of_demolition revive
export type SimEventV2 = SimEvent | SimEventAdd;

// ═════════════════════════════════════════ config.ts — constants ═════════════════════════════════════════
// Starting points. The lane that owns the system tunes them with its probe; GATE 2 is the arbiter.

/** #2 UPROAR. Points, not percent: max 100. */
export const ULT = {
  max: 100,
  /** passive trickle (points/s) while the run is live and not locked out */
  trickle: 0.6,
  /** points per destruction event, before × ultCharge stat × ULT_CITY_RANK_MUL[rank] (city sources only) */
  prop: 0.4,
  floor: 0.9,
  collapsePerTier: 2,      // × (tier + 1)
  /** only city events within this × titan height of the titan charge the meter (boss crush does not) */
  nearH: 4,
  /** points per enemy kill by kind (× ultCharge) */
  kill: { android: 0.45, squad: 0.45, drone: 0.6, buggy: 1.6, apc: 3, tank: 4, walker: 6, elite: 20 } as Readonly<Record<EnemyKind, number>>,
  /** rage: points = hurt × dmg / maxHp (taking 10 % of max HP → +3) */
  hurt: 30,
  /** points = bossHit × dmg / boss.maxHp (dealing 5 % of the boss → +7.5) */
  bossHit: 150,
  /** after a fire the meter is frozen for this long (s) */
  lockoutS: 6,
  /** blast radius R = max(rFloorH × H, rFrac × spawnRing(w)) — covers the AUTO-framed view (zoom 1) */
  rFrac: 0.95, rFloorH: 3,
  /** ROAR: invulT = roar length (no damage of any kind) + move × roarMove (ultMoveMul); hostile NON-boss
   *  projectiles and unfired enemy-owned telegraphs inside R are deleted when the roar ends */
  roarMove: 0.3,
  /** kills while phase !== 'idle' bank their XP × killXpMul (combat killEnemy → ultBankKill) */
  killXpMul: 0.5,
  /** one fire grants at most this × the XP the titan's CURRENT level needs; banked XP past it is dropped */
  xpCapLevelFrac: 0.5,
  /** the bank spawns at most this many merged scrap pickups per tick (perf: a Size V fire kills ~250) */
  bankPickupsPerTick: 6,
  /** boss: one fire removes exactly bossCapFrac × maxHp (split over the pulses that reach it) + bossMeter */
  bossCapFrac: 0.06, bossMeter: 0.3,
  /** app hit-stop on 'ultFire' blast start (view/app only) */
  hitStopScale: 0.3, hitStopS: 0.18,
} as const;
/** × city-source charge by titan rank (a Size V body breaks 20 floors a second). */
export const ULT_CITY_RANK_MUL: readonly number[] = [1, 0.7, 0.4, 0.22, 0.12];
/** probe_ult acceptance: median seconds between "ready" edges for the fire-on-ready bot, per rank band. */
export const ULT_GAP_BAND_S: readonly [number, number] = [30, 65];

/** #4 objectives (per-biome overrides in data/objectives.ts). */
export const OBJECTIVES = {
  overload: { firstAtS: 25, respawnS: 35, lifeS: 75, bandMin: 0.8, bandMax: 1.8, maxActive: 1, uproar: 35, xpFrac: 0.2 },
  relief: { firstAtS: 40, respawnS: 40, lifeS: 90, bandMin: 0.5, bandMax: 1.4, maxActiveLow: 1, maxActiveHigh: 2, hpBelow: 0.85, forceEveryS: 90, heals: 3, fullHpUproar: 8, sizeH: 0.35, sizeMinM: 1.5 },
  annex: { delayAfterBreachS: 20, lifeS: 120, bandMin: 1.0, bandMax: 2.2, fromRank: 1 as RankIndex },
  /** leaving an objective behind: expire once it is farther than this × spawnRing */
  strandMul: 2.8,
  /** candidates scored, the pick is rng.meta-weighted over the best N */
  topN: 12,
} as const;

/** #8 map power-ups. */
export const POWERUPS = {
  lifeS: 30, blinkS: 5, maxAlive: 3, minGapS: 18,
  /** collect distance = titan.radius + max(1, collectH × titan.height) */
  collectH: 0.6,
  dropByKill: { android: 0.002, squad: 0.002, drone: 0.004, buggy: 0.012, apc: 0.03, tank: 0.035, walker: 0.05, elite: 1 } as Readonly<Record<EnemyKind, number>>,
  dropByCollapse: 0.006,   // tier >= 2 collapses
  bossDropMul: 0.5,
  weights: { cleanup: 30, demolition: 18, redLight: 16, rushHour: 22, backPay: 14 } as Readonly<Record<PowerUpKind, number>>,
  redLightS: 6, redLightBossS: 4.5,
  rushHourS: 10, rushAttackRate: 0.5, rushMoveSpeed: 0.2, rushSmash: 1.0,
  demolitionEliteFrac: 0.25, demolitionBossFrac: 0.02, demolitionBossMeter: 0.1,
  /** DEMOLITION kills bank like UPROAR kills (merged pickups, ≤ bankPickupsPerTick per tick) — perf */
  demolitionBanks: true,
} as const;

/** #8 draft extras. */
export const DRAFT_V2 = {
  banishes: 2, locks: 2,
  /** a READY evolution joins a level-up offer (slot 2, 0-based) with this chance (one rng.loot draw, ONLY
   *  when at least one evolution is ready — otherwise the loot stream is untouched); chest offers always
   *  put the first ready evolution in slot 0 (slot 1 when a held card occupies slot 0) */
  evoDraftChance: 0.2,
  /** BANISH ignores presses for this long after the draft opens (on top of the screen's armMs) */
  banishArmS: 0.6,
  /** pad BANISH is a HOLD of pad Y this long (a fill ring on the card); a tap never banishes */
  banishHoldS: 0.5,
} as const;

/** #8 endless. */
export const ENDLESS = {
  budgetPerMin: 0.30, budgetMax: 6,
  hpPerMin: 0.35,
  dmgPerMin: 0.10, dmgMax: 3,
  eliteEveryS: 60,
  bossEveryS: 150,
  rematchHpStep: 0.5, rematchDmgStep: 0.1,
  score: { perSecond: 10, perKill: 2, perRematch: 5000, perTons: 1 / 500 },
} as const;

/** #5 perks (numbers the perk cards / applyPerk use). */
export const PERKS = {
  pettyCashRerolls: 1, redTapeBanish: 1, redTapeLock: 1, safetyArmor: 8,
  stayHpFrac: 0.25, stayInvulnS: 2, tipLineExtraOverload: 1, tipLineMarkerMul: 2,
} as const;

/** tally: the window after an 'ability' event that counts hook pickups / hook kills (s) */
export const HOOK_WINDOW_S = 1.4;

// ═════════════════════════════════════════ input.ts — ONE gameplay action ═════════════════════════════════════════
/** input.ts Action gains ONE action: 'ultimate' (mode 'game'). Keyboard KeyE; pad Y (3) and RT (7).
 *  Buffered INPUT_BUFFER_S and consumed once by titanInput() exactly like 'ability'. actionLabel:
 *  'E' / 'Y'. Nothing else is added to core/input.ts: every v2 MODAL-screen binding is read from
 *  ui/dom.ts UiPress.key strings inside the screen module (below), because modal screens never read
 *  core/input.ts Actions. ui/dom.ts itself is NOT edited (mapKey / PAD_MAP unchanged). */
export type ActionAdd = 'ultimate';

/** Modal-screen bindings, compared against UiPress.key (lower-case KeyboardEvent.key or 'pad:<n>').
 *  Checked BEFORE the screen's `switch (p.act)`. Pad 8 (Select) stays 'back' and pad 3 (Y) stays 'alt'
 *  = confirm on the title/select screens; neither is used for a v2 action there. */
export const UI_BIND = {
  /** draft: X / hold pad Y (DRAFT_V2.banishHoldS). pad Y maps to act 'alt', which the draft ignores. */
  banish: { key: 'x', pad: 'pad:3' },
  /** draft: C / pad LB (4). Unmapped in PAD_MAP → act null. The tabloid's own 'c' (CHANGE TITAN) is
   *  only read by the tabloid, so the two never meet. */
  lock: { key: 'c', pad: 'pad:4' },
  /** title + select: G / pad X (2). pad X maps to act 'reroll', which title and select ignore. */
  goals: { key: 'g', pad: 'pad:2' },
  /** clear tabloid: K; on pad the KEEP GOING button is reached with the d-pad and confirmed with A */
  keepGoing: { key: 'k', pad: null },
} as const;

// ═════════════════════════════════════════ save.ts — settings + profile ═════════════════════════════════════════
/** ADD FIELDS → save.ts Settings (DEFAULT_SETTINGS: reduceMotion false, cinematic 2; sanitizeSettings
 *  coerces: bool / {0,1,2} rounding like quality). */
export interface SettingsAdd {
  reduceMotion: boolean;   // cinematic → 'reduced' variant; no camera punch on UPROAR/breach
  cinematic: 0 | 1 | 2;    // 0 = legacy freeze-frame slate · 1 = short cinematic · 2 = full cinematic
}

/** save.ts: `loadProfile(): Profile` / `saveProfile(p: Profile): boolean` under key 'blocktooth.profile.v1',
 *  sanitised by meta/profile.ts `sanitizeProfile`. */
export interface Profile {
  v: 1;
  done: Record<string, number>;          // goal id → epoch ms of first completion
  best: Record<string, number>;          // goal id → best progress value seen (x in "x of y")
  life: {
    runs: number; clears: number; banishes: number; evolutions: number;
    clearedBy: Record<TitanId, BiomeId[]>;     // distinct biomes cleared per titan
    bossKills: Partial<Record<BossIdV2, number>>;
  };
  perk: PerkId | null;                   // last equipped perk (re-offered on the select screen)
  palette: Record<TitanId, number>;      // last chosen palette per titan
  cineSeen: Record<string, 1>;           // `${titan}.${biome}` → the FULL cinematic has played once
  newUnlocks: string[];                  // card ids not yet seen in a draft ("NEW" ribbon); game.ts removes the
                                         // ids of each offer it shows (markSeen) and saves at once
}

// ═════════════════════════════════════════ data shapes (new data files) ═════════════════════════════════════════

/** data/ultimates.ts ULTS: Record<TitanId, UltDef>. Radii are fractions of R (the blast radius). */
export interface UltPulse { t: number; r0: number; r1: number; dmg: number; kind: DamageKind; knock?: number; stun?: number }
export interface UltDef {
  id: string; name: string; burst: string; desc: string;
  roarS: number;           // windup (invulnerable) before the first pulse
  blastS: number;          // blast phase length after the roar
  pulses: UltPulse[];      // t = seconds after the roar ends
}

/** data/objectives.ts per-biome config. */
export interface ObjectiveBiomeCfg {
  overloadRespawnS: number; reliefRespawnS: number;
  overloadLabel: string;          // Size II+ building dressing: 'rooftop transformer' / 'pump house' / 'tide relay'
  overloadLabelS1: string;        // Size I prop dressing: 'utility truck' / 'generator container' / 'relay container'
  overloadPropsS1: PropKind[];    // static props eligible at Size I (tier 1 first, then tier 0)
  reliefLabel: string; annexLabel: string;
  reliefProps: PropKind[];
}

/** data/evolutions.ts */
export interface EvolutionRow { id: string; base: string; with: string }
/** data/evolutions.ts also exports EVO_OF_BASE: Readonly<Record<string, string>> (base id → evo id). */

/** data/goals.ts GOALS: GoalDef[] (40). */
export type GoalMetric =
  | 'runsFinished' | 'peakRank' | 'clears' | 'biomesCleared' | 'kills' | 'cleanClear' | 'ults' | 'banishesLife'
  | 'blocks' | 'endlessS' | 'bossesInRun' | 'evolutionsLife' | 'powerups' | 'objectives' | 'vacuumBest' | 'crushed'
  | 'titanClears' | 'titanBiomesCleared' | 'wiresBest' | 'hookKillsBest' | 'fullVents' | 'bloomsBest' | 'healed'
  | 'props' | 'overloadSites' | 'tier4CollapseFrac' | 'bossKillsLife' | 'staggersBestFight' | 'boats' | 'fastClearS';
export type UnlockRef =
  | { kind: 'card'; id: string }             // locked UpgradeDef (incl. evolutions)
  | { kind: 'perk'; id: PerkId }
  | { kind: 'palette'; titan: TitanId; index: 1 | 2 };
export interface GoalDef {
  id: string; name: string; desc: string;
  group: 'general' | 'titan' | 'city';
  titan?: TitanId; biome?: BiomeId; boss?: BossIdV2;
  metric: GoalMetric;
  target: number;
  scope: 'run' | 'life';
  /** 'fastClearS' only: lower is better (target = seconds) */
  lowerIsBetter?: boolean;
  unlocks: UnlockRef[];
}

/** data/palettes.ts TITAN_PALETTES: Record<TitanId, [TitanPalette, TitanPalette]>. */
export interface TitanPalette { id: string; name: string; primary: string; secondary: string; belly: string; accent: string; glow: string; eye: string; extra?: string }

/** data/perks.ts PERKS_DEF: Record<PerkId, PerkDef>. */
export interface PerkDef { id: PerkId; name: string; desc: string; card: string | null }

// ═════════════════════════════════════════ exact SIM module export signatures (§2.6) ═════════════════════════════════════════

/** src/meta/ultimate.ts (SIM, lane L1) */
export interface ModUltimate {
  createUltState(): UltState;
  stepUltimate(w: World): void;             // tick order: after the first rebuildEnemyGrid, BEFORE stepTitan
  chargeUltimate(w: World): void;           // tick order: after processTriggers + objectives/powerups (reads this tick's events)
  addUproar(w: World, points: number, raw?: boolean): void;   // raw = skip the ultCharge stat
  ultRadius(w: World): number;              // max(ULT.rFloorH·H, ULT.rFrac·spawnRing(w))
  /** combat/damage.ts killEnemy (L0 pre-wire): banks while ult.phase !== 'idle' (XP × killXpMul, capped by
   *  ult.xpCap) or while ult.bankOpen (DEMOLITION: XP unchanged). When it returns true killEnemy spawns NO
   *  scrap of its own (heal/chest drops unchanged). stepUltimate flushes the bank every tick (≤
   *  ULT.bankPickupsPerTick merged pickups; a bank filled after stepUltimate flushes next tick).
   *  Returns false (stub: always) → killEnemy drops scrap exactly as today. */
  ultBankKill(w: World, x: number, z: number, xp: number, mass: number): boolean;
  /** titansim.ts stepTitan (L0 pre-wire): max speed × this. ULT.roarMove while phase === 'roar', else 1. */
  ultMoveMul(w: World): number;
}
/** src/meta/objectives.ts (SIM, lane L4) */
export interface ModObjectives {
  createMapState(): MapState;
  /** tick order: AFTER processTriggers (so trigger-proc collapses / prop kills are seen). Completion is
   *  event-matched (buildingCollapse / propDestroyed id) AND state-swept: a bound building found collapsed
   *  (or prop found dead) with no credited event this tick expires the objective instead of sticking. */
  stepObjectives(w: World): void;
  spawnObjective(w: World, kind: ObjectiveKind): Objective | null;   // scheduler + dev cheat
}
/** src/meta/powerups.ts (SIM, lane L4) */
export interface ModPowerups {
  stepPowerups(w: World): void;             // tick order: right after stepObjectives (drops from ALL of this tick's kills/collapses, collect, timers)
  spawnPowerup(w: World, kind: PowerUpKind | null, x: number, z: number, forced: boolean): PowerUp | null;  // null kind = weighted roll
  redLightActive(w: World): boolean;
}
/** src/meta/tally.ts (SIM, lane L5) */
export interface ModTally { createTally(): RunTally; stepTally(w: World): void; }
/** src/meta/endless.ts (SIM, lane L5) */
export interface ModEndless {
  continueEndless(w: World): boolean;       // only when run.result === 'clear'; returns false otherwise
  stepEndless(w: World): void;              // tick order: after stepDirector; no-op unless w.endless; keeps run.phase 'endless'
  endlessBudgetMul(w: World): number;       // 1 outside endless
  endlessHpMul(w: World): number;
  endlessDmgMul(w: World): number;          // titansim hurtTitan (all hostile damage)
  /** bosses/index.ts bossHostile × this (L0 pre-wire): 1 + ENDLESS.rematchDmgStep × rematches while a
   *  rematch boss is alive in endless, else 1 */
  endlessBossDmgMul(w: World): number;
  endlessScore(w: World): number;
  rematchOrder(biome: BiomeId): BossIdV2[];
}
/** src/meta/perks.ts (SIM, lane L5) */
export interface ModPerks {
  sanitizeRunMeta(v: unknown): RunMeta;
  applyPerk(w: World): void;                // createWorld, after recomputeStats
  /** checkRunEnd: before declaring death. On a revive: hp = PERKS.stayHpFrac × maxHp, alive, and
   *  w.ult.invulnT = max(w.ult.invulnT, PERKS.stayInvulnS) (covers dot, unlike iframeT). */
  tryRevive(w: World): boolean;
}
/** src/meta/goals.ts (APP-PURE: DOM-free, storage-free, lane L5) */
export interface RunCtx { titan: TitanId; biome: BiomeId; result: 'clear' | 'dead' | null; endT: number }
export interface ModGoals {
  goalProgress(g: GoalDef, p: Profile, t: RunTally | null, ctx: RunCtx | null): number;
  evalGoals(p: Profile, t: RunTally, ctx: RunCtx): string[];                    // run-scope goals newly met (live)
  applyRunToProfile(p: Profile, w: World, result: 'clear' | 'dead'): { profile: Profile; newly: string[] };
  unlockedIds(p: Profile): string[];                                            // sorted card ids
  runMetaFor(p: Profile, titan: TitanId, perk: PerkId | null, palette: number): RunMeta;
  nextUnlock(p: Profile, titan: TitanId, biome: BiomeId | null): { goal: GoalDef; value: number } | null;
  unlockLabel(u: UnlockRef): string;
  /** removes `ids` from p.newUnlocks (returns a new Profile; the caller saves) */
  markSeen(p: Profile, ids: readonly string[]): Profile;
}
/** src/meta/profile.ts (APP-PURE, lane L5) */
export interface ModProfile { sanitizeProfile(v: unknown): Profile; emptyProfile(): Profile; }
/** src/upgrades/draft.ts ADDITIONS (SIM, lane L2). Slots are 0-based everywhere. */
export interface ModDraftAdd {
  /** new offer (slot refilled in place with one rng.loot roll that avoids the other offered ids), or null
   *  when not allowed: no open offer containing id, banishLeft 0, or the pool has no refill AND the offer
   *  would drop to 0 cards (an empty refill with ≥ 1 other card leaves the offer 1 shorter) */
  banishCard(w: World, id: string): string[] | null;
  lockCard(w: World, id: string): boolean;               // toggles; true when `id` is now held
  /** catalogue order; an evolution is ready only when owned[evo] is 0, owned[base] is maxed, owned[with] ≥ 1,
   *  and (if locked) it is in w.meta.unlocked and it is not banished */
  evolutionsReady(w: World): string[];
}
/** src/ai/bosses/index.ts ADDITION (lane L0 pre-applies — the real implementation, ~15 lines) */
export interface ModBossAdd {
  /** Ultimate / DEMOLITION NOTICE hit on the live boss. BODY-ONLY and exact: the boss loses
   *  min(frac × maxHp, hp) HP, credited to parts[0] (the body) for the bossHit event; BOSS_KIND_MUL,
   *  part hpMul, part strainMul and the stagger ×2 are all IGNORED. The meter gains exactly `meter`
   *  via addMeter (never derived from the damage). No-op during intro / when dead. Returns HP removed. */
  bossUltHit(w: World, frac: number, meter: number): number;
}
/** src/ai/bosses/parkade6.ts (SIM, lane L3) — the BossModule shape of bosses/index.ts. */
export interface ModParkade6 {
  create(w: World): BossState;
  step(w: World, b: BossState): void;
  onDamage(w: World, b: BossState, part: number, dmg: number): void;   // also accumulates b.data.part_*
  keepOut(w: World, b: BossState): number;
}

// ═════════════════════════════════════════ APP-SIDE signatures (views + UI that game.ts calls) ═════════════════════════════════════════
// L0 creates each as an inert stub with exactly these members, pre-wires game.ts against them, and no
// lane edits game.ts afterwards. "Stub" lines say what L0's stub does (= today's behaviour).

// ── HUD / markers / toasts (L8) ──
export type GlyphId =
  | 'heart' | 'plate' | 'drip' | 'thorn' | 'fang' | 'brick' | 'halo' | 'bandage'
  | 'boot' | 'dash' | 'hourglass'
  | 'arrowUp' | 'star' | 'dice' | 'cycle' | 'magnet' | 'reach'
  | 'claw' | 'tempo' | 'reticle' | 'burst' | 'bullseye' | 'exclaim' | 'fist' | 'links' | 'chunk' | 'wreck'
  | 'foot' | 'ripple' | 'bolt'
  | 'hook' | 'megaphone'
  | 'jaw' | 'vortex' | 'fork' | 'wire' | 'dome' | 'lava' | 'turret' | 'spore' | 'vine'
  | 'flame' | 'meteor' | 'snow'
  | 'plus' | 'lock' | 'banish' | 'evo' | 'overload' | 'annex' | 'trafficLight' | 'notice' | 'rush' | 'coin'
  | 'ribbon' | 'swatch' | 'key' | 'till';
export type MarkerKind = 'overloadSite' | 'reliefDepot' | 'recordsAnnex' | 'powerup' | 'till';
export interface MarkerItem { kind: MarkerKind; sub: string; x: number; y: number; onScreen: boolean; angle: number; dist: number }
/** CSS px; `angle` = edge-arrow direction when off-screen; `dist` in blocks (m ÷ CITY pitch). ≤ 12 items. */
export interface MarkerFrame { items: MarkerItem[] }
export interface ToastSpec { kicker: string; title: string; sub: string; glyph: GlyphId }
export interface AbilityBarApi { show(on: boolean): void; update(w: World, dt: number): void; onEvents(w: World, ev: readonly SimEvent[]): void }
export interface TrackerApi { show(on: boolean): void; update(w: World, dt: number): void; onEvents(w: World, ev: readonly SimEvent[]): void }
export interface MarkersApi { show(on: boolean): void; update(f: MarkerFrame): void }
export interface ToastsApi { push(t: ToastSpec): void; clear(): void }
/** render/markerview.ts (L6): a ViewModule that also projects marker anchors. Stub: frame() → {items: []}. */
export interface MarkerViewApi { frame(): MarkerFrame }

// ── cinematic (L10) ──
export type CineVariant = 'full' | 'short' | 'reduced';
export type CineShotId = 'signal' | 'street' | 'closeup' | 'crane' | 'handoff';
/** t = seconds into this shot, k = t / dur (0..1) */
export interface CineShot { id: CineShotId; t: number; dur: number; k: number }
/** a camera pose: position, look target, vertical fov (deg), roll (deg) */
export interface CamPose { x: number; y: number; z: number; tx: number; ty: number; tz: number; fov: number; roll: number }
/** world position of the titan's head joint + the head's unit forward vector + the titan height (m).
 *  THREE-free on purpose (the cinematic planner is pure maths over it and w.city). */
export interface FaceAnchor { x: number; y: number; z: number; fx: number; fy: number; fz: number; h: number }
/** blend channels 0..1 that TitanAnimator layers over idle (AnimState.cine) */
export interface CineChannels { look: number; blink: number; snarl: number }
export interface CinePlan {
  variant: CineVariant;
  total: number;                                    // s, start of 'signal' to the end of 'handoff'
  shots: { id: CineShotId; start: number; dur: number }[];
  street: CamPose | null;                           // S1; null in 'short' and 'reduced'
  close: CamPose;                                   // S2 (low-angle hero shot, §11.2)
  game: CamPose;                                    // gameplay pose read back after rig.reset(w) + one rig.update
  beats: { look: number; blink: number; snarl: number; lowerThird: number; hudIn: number };   // s from start
  near: number; far: number;                        // clip planes CineCam sets for S1/S2 (restored at hand-back)
}
/** data/cine.ts CINE: Record<BiomeId, CineBiome> */
export interface CineBiome {
  streetDistH: number; streetCamH: number;          // S1 distance / camera height in titan heights
  yawTriesDeg: number[];                            // heading offsets tried in order (camera safety, §11.2)
  foreground: 'parkedCar' | 'snowbank' | 'hull';    // S1 foreground element (never a street sign)
  grade: { tint: string; alpha: number };           // CSS grade layer
  lens: 'clean' | 'frost' | 'rain';
  bob: { rollDeg: number; hz: number; yH: number } | null;
  breath: boolean;                                  // breath puffs at the snarl (WHITE STACKS)
  sub: string;                                      // lower-third sub-line
}
export interface CineInfo { place: string; sub: string; titanName: string; reduceFlash: boolean; reduceMotion: boolean }
/** render/cinecam.ts (L10). constructor(camera: PerspectiveCamera). Stub: plan() → null (legacy slate). */
export interface CineCamApi {
  readonly active: boolean;
  plan(w: World, rig: CameraRig, face: FaceAnchor, variant: CineVariant): CinePlan | null;   // null → legacy slate
  start(plan: CinePlan): void;                      // takes the camera; sets near/far from the plan
  update(dt: number): boolean;                      // drives pose/fov/roll; false once handed back (camera at plan.game, clip restored)
  skip(): void;                                     // 0.25 s crossfade to plan.game, then hand-back
  stop(): void;                                     // immediate: restore fov/near/far/roll; inactive (abort path)
  readonly shot: CineShot | null;
  channels(): CineChannels | null;
}
export type CineCamCtor = new (camera: PerspectiveCamera) => CineCamApi;
/** ui/cine.ts (L10). constructor(root: HTMLElement, input: Input). */
export interface CineOverlayApi {
  /** mounts the overlay and listens for "any key" (UiKeys, armMs 350). Resolves 'skipped' on a key,
   *  'done' when the app calls setShot(null) after CineCam hands back, 'aborted' on clear(). */
  play(plan: CinePlan, info: CineInfo): Promise<'done' | 'skipped' | 'aborted'>;
  setShot(s: CineShot | null): void;                // per frame from game.ts; null = camera handed back
  skip(): void;                                     // same as a real key (test surface app.dismiss)
  clear(): void;                                    // abort: DOM removed, promise resolves 'aborted'
}
export type CineOverlayCtor = new (root: HTMLElement, input: Input) => CineOverlayApi;
/** titans/titanview.ts additions (L0 stubs, L10 fills). Stub: faceAnchor → false, setCine no-op. */
export interface TitanViewAdd {
  faceAnchor(out: FaceAnchor): boolean;
  setCine(ch: CineChannels | null): void;
}
/** titans/models.ts BuildOpts ADD FIELD (L10): colors?: TitanPalette. titans/portraits.ts ADD export (L0
 *  stub = the canonical portrait for any palette; L10 renders the palette): */
export type RenderPortraitFn = (renderer: WebGLRenderer, id: TitanId, size: number, palette: TitanPalette | null) => Promise<string>;

// ── PARKADE-6 rig (L7). bossview.ts: L0 EXPORTS its existing `BossRig` interface (and LegRig/FlashGroup)
//    unchanged; ai/foemodels_parkade.ts `buildParkadeRig(glowMul: number): BossRig`. The L0 stub returns a
//    placeholder BossRig (slab + 6 box legs from the existing mkMesh helpers, id 'parkade6', no posing).
//    ParkadeRig is an ALIAS: `export type ParkadeRig = BossRig` (declared in foemodels_parkade.ts). ──

// ── screens (L9). Constructors unchanged: (root: HTMLElement, input: Input). ──
/** ui/menus.ts TitleScreen.run(): resolves 'goals' on G / pad X or a click on the GOALS & RECORDS chip. */
export interface TitleScreenApi { run(): Promise<'play' | 'goals'> }
export type SelectRow = 'cards' | 'palette' | 'perk';
/** where the select screen resumes after GOALS & RECORDS closes (same step, choice and focused row) */
export interface SelectResume { step: 1 | 2; titan: TitanId; biome: BiomeId; perk: PerkId | null; palette: number; row: SelectRow }
export interface SelectRunOpts {
  portraits: Record<TitanId, string>;               // canonical portraits (palette 0), as today
  /** app-provided (game.ts, cached per titan × palette): the select screen calls it when the palette row changes */
  portraitFor(titan: TitanId, palette: number): Promise<string>;
  profile: Profile;
  bests: Record<string, number>;                    // core/save.ts loadBest()
  initial?: Partial<SelectResume>;
}
export type SelectResultV2 =
  | { kind: 'start'; titan: TitanId; biome: BiomeId; perk: PerkId | null; palette: number }
  | { kind: 'goals'; resume: SelectResume }
  | null;                                           // back to the title
/** ui/select.ts SelectScreen.run — replaces run(portraits, initial). */
export interface SelectScreenApi { run(opts: SelectRunOpts): Promise<SelectResultV2> }
export interface DraftCtx {
  rerollsLeft: number; banishLeft: number; lockLeft: number;
  locked: string | null;                            // w.upgrades.locked (HELD badge on that card if offered)
  newIds: readonly string[];                        // profile.newUnlocks ∩ offer → "NEW" ribbon
}
export type DraftResultV2 = { pick: string } | { reroll: true } | { banish: string } | { lock: string };
/** ui/draft.ts DraftScreen.open — replaces open(w, offer, rerollsLeft). */
export interface DraftScreenApi { open(w: World, offer: string[], ctx: DraftCtx): Promise<DraftResultV2> }
export interface TabloidExtra {
  newGoals: { goal: string; unlock: string }[];     // "NEW ON THE RECORD" sidebar (names, already resolved)
  canContinue: boolean;                             // clear variant only: show KEEP GOING
}
export type TabloidChoiceV2 = 'retry' | 'select' | 'title' | 'endless';
/** ui/broadcast.ts Broadcast.tabloid — replaces tabloid(w, photo). The EXTENDED COVERAGE variant is chosen
 *  by `w.endless !== null`. */
export interface BroadcastAdd { tabloid(w: World, photo: string, extra: TabloidExtra): Promise<TabloidChoiceV2> }
/** ui/menus.ts PauseMenu.open — replaces open(). LOADOUT reads ctx.w.upgrades (+ icons.ts), ctx.w.meta.perk,
 *  banishLeft / lockLeft. null → no LOADOUT tab (defensive). */
export interface PauseCtx { w: World }
export interface PauseMenuApi { open(ctx: PauseCtx | null): Promise<'resume' | 'retry' | 'quit'> }
/** ui/goals.ts */
export interface GoalsScreenApi { open(p: Profile, bests: Record<string, number>): Promise<void> }
/** ui/goals.ts NextUnlockPanel: constructor(host: HTMLElement) */
export interface NextUnlockPanelApi { set(p: Profile, titan: TitanId, biome: BiomeId | null): void }

// keep the imports "used" for readers of this snippet (type-only, erased)
export type _Refs = [Tier, UpgradeDef, UpgradeState, RunOptions, AlertKey, BossState, RunPhase, BiomeDef, TitanDef];
