// VALE — simulation boundary (CONTRACT §5). Types only: no three, no DOM, no zod at runtime.
//
// Simulation and presentation are separate. The presentation (render/, ui/, audio/) only ever sees
// the shapes in this file: a read-only WorldView, an event stream, and a command sink. It never
// imports src/sim/**. A dedicated server would run the same Sim and stream these shapes instead.

import type { SlotT, StatusKindT, DamageTypeT } from './catalog.ts';

export const TICK_HZ = 30;
export const TICK_DT = 1 / TICK_HZ;

export type EntityId = number;
export type PlayerId = number;      // 0..N-1 seat index in the match
export type TeamId = number;        // Rift/Bridge: 0 | 1. Fray: one team per player (team = seat)

// ── match setup (built by the session layer, consumed by the Sim) ──────────────────────────────
export interface LoadoutChoice { spells: string[]; boons: string[] }
export interface SeatSetup {
  player: PlayerId;
  team: TeamId;
  name: string;
  fighter: string;          // FighterDef id
  skin: string;             // SkinDef id — presentation only; the sim must produce identical results for any skin
  role?: string;            // RoleDef id (Rift role contract)
  loadout: LoadoutChoice;
  controller: 'human' | 'bot';
  botDifficulty?: 'novice' | 'adept' | 'veteran';
  /** stable readability color index (Fray player colors, scoreboard) */
  colorIndex: number;
}
export interface MatchSetup {
  matchId: string;
  seed: number;
  queue: string;            // QueueDef id
  mode: string;             // ModeDef id
  map: string;              // MapDef id
  seats: SeatSetup[];
  /** practice tool switches (only honoured when queue.kind === 'practice') */
  practice?: { infiniteGold?: boolean; noCooldowns?: boolean; dummies?: number; startLevel?: number };
  catalogVersion: string;
}

// ── commands (player intent; human input and bots produce the same commands) ────────────────────
export type Command =
  | { type: 'move'; x: number; y: number; attackMove?: boolean }
  | { type: 'attack'; target: EntityId }
  | { type: 'stop' }
  | { type: 'cast'; slot: SlotT; x?: number; y?: number; target?: EntityId }
  | { type: 'levelUp'; slot: 'a1' | 'a2' | 'a3' | 'ult' }
  | { type: 'buy'; item: string }
  | { type: 'sell'; slot: number }
  | { type: 'undo' }
  | { type: 'swapItems'; a: number; b: number }
  | { type: 'recall' }
  | { type: 'ping'; kind: PingKind; x: number; y: number; target?: EntityId }
  | { type: 'surrenderVote'; yes: boolean }
  // practice tool only
  | { type: 'practice'; action: 'gold' | 'level' | 'resetCooldowns' | 'toggleCooldowns' | 'spawnDummy' | 'heal' | 'resetMatch' };

export type PingKind = 'alert' | 'danger' | 'onMyWay' | 'missing' | 'assist' | 'push' | 'vision' | 'objective' | 'retreat';

// ── the world as the presentation sees it ───────────────────────────────────────────────────────
export type EntityKind = 'fighter' | 'minion' | 'monster' | 'structure' | 'summon' | 'ward' | 'pickup' | 'projectile' | 'zone';
export type ActionState = 'idle' | 'move' | 'attack' | 'cast' | 'channel' | 'dash' | 'stunned' | 'dead' | 'recall';

export interface StatusView { kind: StatusKindT; remaining: number; duration: number; power: number }
export interface BuffView { id: string; source: string; remaining: number; duration: number; stacks: number; icon?: string }
export interface AbilityView {
  slot: SlotT; id: string; rank: number; maxRank: number;
  cooldown: number; cooldownMax: number; cost: number;
  charges?: number; maxCharges?: number; recastWindow?: number;
  ready: boolean; canLevel: boolean;
}

export interface EntityView {
  readonly id: EntityId;
  readonly kind: EntityKind;
  readonly def: string;               // FighterDef / UnitDef / ability id for projectiles & zones
  readonly team: TeamId;
  readonly owner: PlayerId | -1;      // seat that owns this entity (fighters, summons, projectiles)
  readonly x: number; readonly y: number;
  readonly facing: number;            // radians, 0 = +x, counter-clockwise toward +y
  readonly radius: number;
  readonly hp: number; readonly maxHp: number; readonly shield: number;
  readonly res: number; readonly maxRes: number;
  readonly level: number;
  readonly state: ActionState;
  /** seconds into the current action; with stateDuration drives animation sync */
  readonly stateTime: number; readonly stateDuration: number;
  /** clip role hint for the current action (cast_a1, attack2, …) */
  readonly anim: string;
  readonly statuses: readonly StatusView[];
  readonly buffs: readonly BuffView[];
  /** bit i set ⇒ visible to team i (fog of war + thickets + invisibility) */
  readonly visibleMask: number;
  readonly alive: boolean;
  readonly targetable: boolean;
  /** projectiles/zones/dashes: geometry for rendering */
  readonly shape?: { kind: 'circle' | 'ring' | 'cone' | 'rect'; radius?: number; inner?: number; angle?: number; length?: number; width?: number };
  readonly vx: number; readonly vy: number;
  readonly vfx?: string;
  readonly skin?: string;             // fighters only (echo of SeatSetup.skin)
  readonly height: number;            // airborne / dash arc height in metres (0 on ground)
}

export interface FighterStatsView {
  ad: number; ap: number; armor: number; resist: number; attackSpeed: number; moveSpeed: number;
  crit: number; haste: number; range: number; lifesteal: number; tenacity: number; armorPen: number; magicPen: number;
}

export interface PlayerView {
  readonly player: PlayerId;
  readonly team: TeamId;
  readonly name: string;
  readonly fighter: string;
  readonly skin: string;
  readonly role?: string;
  readonly controller: 'human' | 'bot';
  readonly colorIndex: number;
  readonly entity: EntityId;
  readonly gold: number;
  readonly xp: number; readonly xpToNext: number;
  readonly kills: number; readonly deaths: number; readonly assists: number;
  readonly cs: number;                       // minions + monsters
  readonly damageToFighters: number; readonly damageTaken: number; readonly healing: number;
  readonly goldEarned: number;
  readonly items: readonly (string | null)[];    // 6 slots
  readonly itemCooldowns: readonly number[];
  readonly abilities: readonly AbilityView[];    // a1 a2 a3 ult spell1 spell2
  readonly passive: string;
  readonly skillPoints: number;
  readonly respawnIn: number;                     // 0 when alive
  readonly lives?: number;                        // Fray
  readonly score?: number;                        // Fray kill score
  readonly placement?: number;                    // Fray: final placement once eliminated / at end
  readonly stats: FighterStatsView;
  readonly canShop: boolean;
  readonly recallProgress: number;                // 0..1
  readonly streak: number;
  readonly bounty: number;
}

export interface TeamView {
  readonly team: TeamId;
  readonly kills: number;
  readonly structuresDestroyed: number;
  readonly objectives: readonly string[];        // TeamBuff ids secured
  readonly buffs: readonly { id: string; remaining: number }[];
  readonly gold: number;
}

export interface ObjectiveTimerView { id: string; unit: string; at: [number, number]; alive: boolean; respawnIn: number }

export interface WorldView {
  readonly tick: number;
  readonly time: number;                // seconds since match start (0 at spawn, negative during pre-game countdown)
  readonly phase: 'pregame' | 'live' | 'ended';
  readonly mode: string; readonly queue: string; readonly map: string;
  readonly entities: readonly EntityView[];
  readonly players: readonly PlayerView[];
  readonly teams: readonly TeamView[];
  readonly objectives: readonly ObjectiveTimerView[];
  readonly suddenDeath: boolean;
  readonly result: MatchResult | null;
  entity(id: EntityId): EntityView | undefined;
  /** fog of war: vision grid for a team (1 byte per nav cell, 0 = unseen, 255 = seen). Cells are map.navCell * 4 metres. */
  visionGrid(team: TeamId): { width: number; height: number; cell: number; data: Uint8Array };
}

// ── events (one batch per tick; the presentation turns them into VFX, SFX, UI) ───────────────────
export type SimEvent =
  | { e: 'damage'; t: number; src: EntityId; dst: EntityId; amount: number; dtype: DamageTypeT; crit: boolean; ability?: string; shielded: number }
  | { e: 'heal'; t: number; src: EntityId; dst: EntityId; amount: number }
  | { e: 'shield'; t: number; dst: EntityId; amount: number }
  | { e: 'attack'; t: number; src: EntityId; dst: EntityId; windup: number; crit: boolean }
  | { e: 'cast'; t: number; src: EntityId; slot: SlotT; ability: string; x: number; y: number; target?: EntityId; castTime: number }
  | { e: 'projectile'; t: number; id: EntityId; src: EntityId; ability: string; vfx?: string }
  | { e: 'hit'; t: number; src: EntityId; dst: EntityId; ability?: string; vfx?: string; sfx?: string }
  | { e: 'area'; t: number; src: EntityId; ability: string; x: number; y: number; shape: EntityView['shape']; delay: number; vfx?: string; sfx?: string; telegraph: 'none' | 'ally_only' | 'everyone' }
  | { e: 'status'; t: number; dst: EntityId; status: StatusKindT; duration: number }
  | { e: 'dash'; t: number; src: EntityId; fromX: number; fromY: number; toX: number; toY: number; duration: number; vfx?: string }
  | { e: 'blink'; t: number; src: EntityId; fromX: number; fromY: number; toX: number; toY: number }
  | { e: 'death'; t: number; dst: EntityId; killer: EntityId | -1; assists: PlayerId[]; gold: number; kind: EntityKind }
  | { e: 'takedown'; t: number; killer: PlayerId | -1; victim: PlayerId; assists: PlayerId[]; streak: number; shutdown: number; first: boolean; multi: number }
  | { e: 'respawn'; t: number; player: PlayerId; entity: EntityId }
  | { e: 'levelUp'; t: number; player: PlayerId; level: number }
  | { e: 'gold'; t: number; player: PlayerId; amount: number; x: number; y: number; reason: 'cs' | 'kill' | 'assist' | 'structure' | 'objective' | 'passive' | 'pickup' | 'sell' }
  | { e: 'buy'; t: number; player: PlayerId; item: string } | { e: 'sell'; t: number; player: PlayerId; item: string }
  | { e: 'structure'; t: number; id: EntityId; def: string; team: TeamId; destroyedBy: TeamId; final: boolean }
  | { e: 'objective'; t: number; unit: string; team: TeamId; buff?: string }
  | { e: 'wave'; t: number; n: number }
  | { e: 'recall'; t: number; player: PlayerId; state: 'start' | 'cancel' | 'done' }
  | { e: 'ping'; t: number; player: PlayerId; kind: PingKind; x: number; y: number; target?: EntityId }
  | { e: 'pickup'; t: number; player: PlayerId; def: string; x: number; y: number }
  | { e: 'announce'; t: number; key: string; team?: TeamId; player?: PlayerId; params?: Record<string, string | number> }
  | { e: 'eliminated'; t: number; player: PlayerId; placement: number }
  | { e: 'suddenDeath'; t: number }
  | { e: 'end'; t: number; result: MatchResult };

// ── result (feeds post-game, grants, rating) ────────────────────────────────────────────────────
export interface PlayerResult {
  player: PlayerId; team: TeamId; name: string; fighter: string; skin: string; role?: string; controller: 'human' | 'bot';
  kills: number; deaths: number; assists: number; cs: number; gold: number; level: number;
  damageToFighters: number; damageTaken: number; healing: number; structureDamage: number;
  items: (string | null)[];
  /** 1 = best. Team modes: 1 for the winning team, 2 for the losing team. Fray: final FFA placement. */
  placement: number;
  won: boolean;
  score?: number;
}
export interface MatchResult {
  matchId: string; queue: string; mode: string; map: string; seed: number; catalogVersion: string;
  duration: number;               // seconds of live play
  winningTeam: TeamId | -1;       // -1: none (FFA uses placements)
  reason: 'core' | 'surrender' | 'last_standing' | 'score' | 'time' | 'abandon';
  players: PlayerResult[];
  /** per-minute team gold lead samples for the post-game graph (team 0 minus team 1; FFA: leader minus second) */
  goldGraph: number[];
  /** deterministic digest of the final state (determinism probe) */
  digest: string;
}

// ── the Sim facade (implemented in src/sim/sim.ts) ─────────────────────────────────────────────
export interface SimApi {
  readonly view: WorldView;
  /** queue a command for a seat; applied at the start of the next tick */
  command(player: PlayerId, cmd: Command): void;
  /** advance exactly one tick; returns the events produced during it */
  step(): SimEvent[];
  /** recent damage taken by a player's fighter (death recap): last 15 s, newest last */
  damageLog(player: PlayerId): readonly { t: number; src: EntityId; srcName: string; srcDef: string; ability?: string; amount: number; dtype: DamageTypeT }[];
}
