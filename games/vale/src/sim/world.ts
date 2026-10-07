// VALE sim — the World: entity store, spatial hash, clock, event buffer, rng, teams, and the
// fixed-order system pipeline (CONTRACT §5.1).
//
// The World implements WorldView directly; a facade can hand `world` out as `view` unchanged.
// Other lanes extend it by registering systems into named phases (`addSystem`) and hooks
// (`hooks.death`, `hooks.command`, …) rather than editing core files. Phase order is the contract:
//
//   commands → statuses → regen → casts → attacks → projectiles → zones → movement → ai → bots
//   → deaths → vision → modes
//
// Determinism: entities live in one array in creation (= id) order and every system iterates it
// front to back; ids are never reused; removal is deferred to the end of the tick.

import type { CatalogT, MapDefT, ModeDefT, QueueDefT, RulesParamsT } from '../contracts/catalog.ts';
import type {
  Command, EntityId, EntityKind, MatchResult, MatchSetup, ObjectiveTimerView, PlayerId, SimEvent, TeamId, WorldView,
  DamageTypeT,
} from '../contracts/sim.ts';
import { TICK_DT } from '../contracts/sim.ts';
import { indexCatalog, resolveRules, type CatalogIndex } from './catalog_index.ts';
import { Entity, NEUTRAL_TEAM, Player, TeamState } from './entity.ts';
import { NavGrid } from './nav.ts';
import { createStreams, type RngStreams } from './rng.ts';
import { Vision } from './vision.ts';

export type Phase = 'commands' | 'statuses' | 'regen' | 'casts' | 'attacks' | 'projectiles' | 'zones' | 'movement'
  | 'ai' | 'bots' | 'deaths' | 'vision' | 'modes';
export const PHASES: readonly Phase[] = ['commands', 'statuses', 'regen', 'casts', 'attacks', 'projectiles', 'zones',
  'movement', 'ai', 'bots', 'deaths', 'vision', 'modes'];
export type System = (w: World) => void;

export type DeathEvent = Extract<SimEvent, { e: 'death' }>;
export interface DamageInfo {
  dtype: DamageTypeT;
  crit: boolean;
  ability: string | undefined;
  isAttack: boolean;
  /** portion absorbed by shields */
  shielded: number;
  /** pre-mitigation amount (after crit) */
  raw: number;
}

export interface WorldHooks {
  /** after a unit died and its 'death' event was pushed: economy fills ev.gold, emits takedown/gold */
  death: ((w: World, victim: Entity, killer: Entity | null, assists: PlayerId[], ev: DeathEvent) => void)[];
  /** after damage landed (post-mitigation; `amount` includes the shielded part) */
  damage: ((w: World, src: Entity | null, dst: Entity, amount: number, info: DamageInfo) => void)[];
  /** a new unit entered the world (fighters on first spawn, units, summons) */
  spawn: ((w: World, e: Entity) => void)[];
  /** veto damage (structure protection, spawn shields). Any false ⇒ the hit is ignored. */
  canDamage: ((w: World, src: Entity | null, dst: Entity) => boolean)[];
  /** handlers for command types core does not own (buy, sell, undo, swapItems, recall, ping, surrenderVote, practice) */
  command: Partial<Record<Command['type'], (w: World, p: Player, cmd: Command) => void>>;
  /** idle target-acquisition score (lower = preferred; Infinity = never). null = core default. */
  acquireScore: ((w: World, e: Entity, cand: Entity, d2: number) => number) | null;
}

// ── spatial hash ────────────────────────────────────────────────────────────────────────────────
/**
 * Uniform grid of linked lists in typed arrays, rebuilt from scratch when positions changed
 * (O(n), no allocation once warmed up). Holds live units only (no projectiles/zones/corpses).
 */
export class SpatialHash {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  private head: Int32Array;
  private next: Int32Array;
  private ents: Entity[] = [];
  maxRadius = 0;

  constructor(sizeX: number, sizeY: number, cell = 4) {
    this.cell = cell;
    this.cols = Math.max(1, Math.ceil(sizeX / cell));
    this.rows = Math.max(1, Math.ceil(sizeY / cell));
    this.head = new Int32Array(this.cols * this.rows).fill(-1);
    this.next = new Int32Array(256);
  }

  rebuild(list: readonly Entity[]): void {
    this.head.fill(-1);
    const ents = this.ents; ents.length = 0;
    let maxR = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive || e.removed || e.kind === 'projectile' || e.kind === 'zone') continue;
      const k = ents.length;
      ents.push(e);
      if (k >= this.next.length) { const nn = new Int32Array(this.next.length * 2); nn.set(this.next); this.next = nn; }
      const c = this.cellIndex(e.x, e.y);
      this.next[k] = this.head[c];
      this.head[c] = k;
      if (e.radius > maxR) maxR = e.radius;
    }
    this.maxRadius = maxR;
  }

  private cellIndex(x: number, y: number): number {
    let cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    if (cx < 0) cx = 0; else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0; else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  /** units whose circle touches the circle (x, y, r); clears and fills `out`, returns the count */
  query(x: number, y: number, r: number, out: Entity[]): number {
    out.length = 0;
    const reach = r + this.maxRadius;
    let x0 = Math.floor((x - reach) / this.cell), x1 = Math.floor((x + reach) / this.cell);
    let y0 = Math.floor((y - reach) / this.cell), y1 = Math.floor((y + reach) / this.cell);
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
    if (x1 >= this.cols) x1 = this.cols - 1; if (y1 >= this.rows) y1 = this.rows - 1;
    const ents = this.ents, next = this.next, head = this.head;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (let k = head[cy * this.cols + cx]; k !== -1; k = next[k]) {
          const e = ents[k];
          const rr = r + e.radius;
          const dx = e.x - x, dy = e.y - y;
          if (dx * dx + dy * dy <= rr * rr) out.push(e);
        }
      }
    }
    return out.length;
  }
}

// ── scheduler (delayed areas, repeats, deferred callbacks) ──────────────────────────────────────
interface Task { at: number; seq: number; fn: () => void }

// ── the world ───────────────────────────────────────────────────────────────────────────────────
export class World implements WorldView {
  // WorldView ------------------------------------------------------------------------------
  tick = 0;
  time = 0;
  phase: 'pregame' | 'live' | 'ended' = 'live';
  readonly mode: string;
  readonly queue: string;
  readonly map: string;
  entities: Entity[] = [];
  players: Player[] = [];
  teams: TeamState[] = [];
  objectives: ObjectiveTimerView[] = [];
  suddenDeath = false;
  result: MatchResult | null = null;

  // internal ---------------------------------------------------------------------------------
  readonly catalog: CatalogT;
  readonly idx: CatalogIndex;
  readonly setup: MatchSetup;
  readonly rules: RulesParamsT;
  readonly mapDef: MapDefT;
  readonly modeDef: ModeDefT;
  readonly queueDef: QueueDefT;
  readonly rng: RngStreams;
  readonly nav: NavGrid;
  readonly vision: Vision;
  readonly hash: SpatialHash;
  /** set whenever a unit moved/spawned/died since the last rebuild */
  hashDirty = true;
  events: SimEvent[] = [];
  readonly hooks: WorldHooks = { death: [], damage: [], spawn: [], canDamage: [], command: {}, acquireScore: null };
  /** time = tick·TICK_DT + timeOffset (modes set a negative offset for a pre-game countdown) */
  timeOffset = 0;
  /** practice: cooldowns are not started */
  noCooldowns = false;
  /** zones with `blocks` (movement checks these) */
  blockingZones: Entity[] = [];
  /** free slot for other lanes' world-level state (economy, modes, bots) */
  ext: Record<string, unknown> = {};

  private systems: System[][] = PHASES.map(() => []);
  private byId = new Map<EntityId, Entity>();
  private nextId = 1;
  private cmdQueue: { player: PlayerId; cmd: Command }[] = [];
  private tasks: Task[] = [];
  private taskSeq = 0;
  private needCompact = false;

  constructor(catalog: CatalogT, setup: MatchSetup, idx?: CatalogIndex) {
    this.catalog = catalog;
    this.idx = idx ?? indexCatalog(catalog);
    this.setup = setup;
    this.mode = setup.mode; this.queue = setup.queue; this.map = setup.map;
    const mode = this.idx.modes.get(setup.mode);
    const queue = this.idx.queues.get(setup.queue);
    const map = this.idx.maps.get(setup.map);
    if (!mode) throw new Error(`world: unknown mode '${setup.mode}'`);
    if (!queue) throw new Error(`world: unknown queue '${setup.queue}'`);
    if (!map) throw new Error(`world: unknown map '${setup.map}'`);
    this.modeDef = mode; this.queueDef = queue; this.mapDef = map;
    this.rules = resolveRules(this.idx, setup.mode, setup.queue);
    this.rng = createStreams(setup.seed);
    this.nav = NavGrid.fromMap(map);
    this.hash = new SpatialHash(map.size[0], map.size[1], 4);
    let teamCount = mode.teams;
    for (const s of setup.seats) if (s.team + 1 > teamCount) teamCount = s.team + 1;
    for (let t = 0; t < teamCount; t++) this.teams.push(new TeamState(t));
    this.vision = new Vision(map, teamCount);
    if (queue.kind === 'practice' && setup.practice?.noCooldowns) this.noCooldowns = true;
  }

  get teamCount(): number { return this.teams.length; }

  // ── WorldView ─────────────────────────────────────────────────────────────────────────────
  entity(id: EntityId): Entity | undefined { return this.byId.get(id); }
  visionGrid(team: TeamId): { width: number; height: number; cell: number; data: Uint8Array } { return this.vision.grid(team); }

  // ── entity store ──────────────────────────────────────────────────────────────────────────
  /** create and register an entity (ids increase monotonically; never reused) */
  create(kind: EntityKind, def: string, team: TeamId): Entity {
    const e = new Entity(this.nextId++, kind, def, team);
    e.spawnTime = this.time;
    this.entities.push(e);
    this.byId.set(e.id, e);
    this.hashDirty = true;
    return e;
  }
  /** remove at the end of this tick (views keep seeing it until then) */
  remove(e: Entity): void {
    if (e.removed) return;
    e.removed = true;
    e.alive = false;
    this.needCompact = true;
    this.hashDirty = true;
  }
  /** live (alive, not removed) entity by id */
  live(id: EntityId): Entity | null {
    if (id < 0) return null;
    const e = this.byId.get(id);
    return e && e.alive && !e.removed ? e : null;
  }

  private compact(): void {
    const t = this.time;
    let w = 0;
    const list = this.entities;
    for (let r = 0; r < list.length; r++) {
      const e = list[r];
      if (!e.removed && e.removeAt >= 0 && t >= e.removeAt) { e.removed = true; e.alive = false; }
      if (e.removed) { this.byId.delete(e.id); continue; }
      list[w++] = e;
    }
    list.length = w;
    this.needCompact = false;
  }

  // ── events / commands ─────────────────────────────────────────────────────────────────────
  emit(ev: SimEvent): void { this.events.push(ev); }
  /** queue a command for a seat; applied in the next tick's 'commands' phase */
  command(player: PlayerId, cmd: Command): void { this.cmdQueue.push({ player, cmd }); }
  /** drain queued commands (the core 'commands' system calls this) */
  takeCommands(): { player: PlayerId; cmd: Command }[] {
    const q = this.cmdQueue;
    this.cmdQueue = [];
    // stable by seat so arrival order between seats cannot change the outcome
    q.sort((a, b) => a.player - b.player);
    return q;
  }

  // ── systems ───────────────────────────────────────────────────────────────────────────────
  addSystem(phase: Phase, fn: System): void { this.systems[PHASES.indexOf(phase)].push(fn); }

  /** advance one tick (CONTRACT §5.1); returns the events produced during it */
  step(): SimEvent[] {
    this.tick++;
    this.time = this.tick * TICK_DT + this.timeOffset;
    this.events = [];
    for (let p = 0; p < this.systems.length; p++) {
      const list = this.systems[p];
      for (let i = 0; i < list.length; i++) list[i](this);
    }
    // removeAt timers are checked every tick, explicit removals compact immediately
    let due = this.needCompact;
    if (!due) for (let i = 0; i < this.entities.length; i++) { const e = this.entities[i]; if (e.removeAt >= 0 && this.time >= e.removeAt) { due = true; break; } }
    if (due) this.compact();
    return this.events;
  }

  // ── scheduler ─────────────────────────────────────────────────────────────────────────────
  /** run fn after `delay` seconds (rounded up to whole ticks; ≥ 1 tick). Deterministic FIFO per tick. */
  schedule(delay: number, fn: () => void): void {
    const at = this.tick + Math.max(1, Math.ceil(delay / TICK_DT - 1e-6));
    const task: Task = { at, seq: this.taskSeq++, fn };
    // binary insert keeping (at, seq) order
    let lo = 0, hi = this.tasks.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.tasks[mid].at <= at) lo = mid + 1; else hi = mid; }
    this.tasks.splice(lo, 0, task);
  }
  /** run every task due at or before this tick (called from the 'zones' phase) */
  runDueTasks(): void {
    let n = 0;
    while (n < this.tasks.length && this.tasks[n].at <= this.tick) n++;
    if (n === 0) return;
    const due = this.tasks.splice(0, n);
    for (const t of due) t.fn();
  }
  get pendingTasks(): number { return this.tasks.length; }

  // ── spatial queries ───────────────────────────────────────────────────────────────────────
  ensureHash(): void { if (this.hashDirty) { this.hash.rebuild(this.entities); this.hashDirty = false; } }
  /** live units touching the circle (x, y, r); clears and fills `out` */
  query(x: number, y: number, r: number, out: Entity[]): number {
    this.ensureHash();
    return this.hash.query(x, y, r, out);
  }

  // ── helpers ───────────────────────────────────────────────────────────────────────────────
  /** relation of b as seen from a: 0 self, 1 ally, 2 enemy (neutral units are enemies of everyone) */
  relation(a: Entity, b: Entity): 0 | 1 | 2 {
    if (a === b) return 0;
    if (a.team === NEUTRAL_TEAM || b.team === NEUTRAL_TEAM) return a.team === b.team && a.team !== NEUTRAL_TEAM ? 1 : 2;
    return a.team === b.team ? 1 : 2;
  }
  /** the fighter credited for an entity's actions (itself, or the fighter that owns a summon) */
  creditFighter(e: Entity | null): Entity | null {
    let cur = e;
    for (let guard = 0; cur && guard < 4; guard++) {
      if (cur.kind === 'fighter') return cur;
      if (cur.owner >= 0) { const p = this.players[cur.owner]; if (p && p.ent) return p.ent; }
      cur = cur.ownerEid >= 0 ? this.byId.get(cur.ownerEid) ?? null : null;
    }
    return null;
  }
  playerById(id: PlayerId): Player | undefined { return this.players[id]; }
}
