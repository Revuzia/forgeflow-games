// DYEFIELD — the deterministic 4 v 4 match (CONTRACT §10.1 / §10.2 / §10.4 + CHANGED(KITSIM)). THREE-free, DOM-free.
//
// MatchWorld owns the runners, the projectile pool, the clock and the event queue. One step() is
// exactly one TICK (1/60 s). Order inside a live tick (fixed, so a seed replays bit-for-bit):
//   1. dead runners count down to respawn; living runners move (Runner.step: slick/slog/wall-slick,
//      tank refill, pad rules, hidden); a WELLSPRING leaper that landed slams right after its move
//   2. the sea washes runners below killY
//   3. per runner: kit (combat/kits.ts: stream / roll / charge / burst), sub (combat/subs.ts), special
//      start (combat/specials.ts), from the post-move positions
//   4. resting slots tick: jelly puddles (fuse → pop) and CLOUDBURST cells (rise → rain → end); then flying
//      projectiles fly, sweep, paint, drip, hit, burst and land (combat/projectiles.ts)
//   5. HP regen and special clocks, then the clock and horns
// Randomness: per runner one mulberry32 stream for spread rolls and one for its special (CLOUDBURST
// drops), both seeded from (match seed, runner id). The view drains events and never writes gameplay.
//
// CHANGED(MAPSIM) (CONTRACT_P6_11 §19): runners get the map's features (conveyors, springs, oob_ volumes:
// feet inside one → the sea, step 2); a map-level `mist` (maps.json `mist.hideRange`) hides every SLICK
// enemy (slick form: moving or not, floor or wall) beyond hideRange in canSee, on top of the phase-3 rule
// (hidden = slick and slow → unseen beyond SLICK.hiddenRange).
//
// CHANGED(CORE) (CONTRACT_FFA §F1/§F6): MatchOptions.mode 'ffa' = FREE-FOR-ALL. Every runner is its own crew (the
// roster's team byte 1..8). The A/B team pads are neutral scenery in FFA. The result carries shares / standings per crew
// and the winner by strict comparison (a tie for first = a draw, `tied`). Teams mode takes none of the FFA branches: its
// ticks and hashes are unchanged.
// CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S1–§S4, replaces F1's drop pads): FFA has NO owned pads — no own-pad slick /
// refill, no push-out, no painter lock (crewPads is kept only as an always-empty compatibility field for the view). The
// runners spawn at SITES of a per-map pool (maps.json ffaSites, 16–24 {pos, yaw°}; spawnSites here, yaw in radians):
//   * match start — the 8 runners take 8 sites picked for spread (a farthest-point pick over the pool from a seeded
//     random site, then a seeded assignment to the runners);
//   * respawn (after the usual 3 s) — candidates are the sites with no living runner within MATCH_FFA.siteClear m, minus
//     the runner's last MATCH_FFA.recent sites; a candidate is SAFE when no living foe within seeRange sees its chest point
//     (the canSee ray from the foe's eye to the chest of a tall runner standing there; the map's mist does NOT hide it —
//     canSee's mist hides only SLICK targets, and a respawned runner is tall), the nearest living foe is
//     ≥ safeFoe m away and the runner who washed this one (if alive) ≥ safeKiller m; fewer than fallbackN safe sites →
//     the fallbackN best by nearest-foe distance among the unseen candidates (all candidates only when none is unseen);
//     one uniform draw from that set.
// All draws come from ONE match stream (spawnRng, FFA only). Respawns resolve after every living runner moved (step 1),
// in runner-id order, so each choice sees this tick's positions and the runners respawned before it. The choice is
// Runner.spawnSite and a 'spawn' event {pid, site, x, y, z, yaw} (also one per runner at construction). FFA grants spawn
// protection in BOTH rules (WASHOUT §W1's rule, extended); the FFA hash mixes spawnSite (+ protectedT in TURF FFA).
//
// CHANGED(WASHOUT) (CONTRACT_WASHOUT §W1/§W2): MatchOptions.rule 'washout' (default 'turf') — a credited wash scores one
// point for the washer's crew (the 'score' event, pushed right after its 'washed' event; scores()). A sea wash is credited
// to the victim's lastHitBy when its lastHitT ≤ washout.seaCreditSeconds (no one otherwise; no self-penalty). Reaching the
// crew limit (per map: data/maps.json → <map>.washout.teamLimit / ffaLimit, falling back to data/weapons.json → washout;
// washoutLimitFor) ends the match at the end of that tick through end() (endedBy 'limit'); at the horn the higher score
// wins, ties broken TEAMS: turf share, FFA: fewer washed, then share (else a draw). A WASHOUT respawn grants spawn
// protection (Runner.protectedT: no damage, no wash, no knock) for washout.spawnProtectSeconds; it ends early on an action
// that actually happens (the kit fires / rolls / flicks / charges, a sub is thrown, a special starts — a press that does
// nothing keeps it), when the runner deals damage from any source (a CLOUDBURST or jelly thrown before its wash included),
// and a wash (the sea) clears it. TURF takes none of these branches (protectedT stays 0, no score events, the TURF hash
// mixes none of the new state): its ticks and hashes are unchanged. CHANGED(SPAWNS): spawn protection also runs in TURF
// FFA (every FFA respawn); TEAMS TURF still never sets it.
//
// CHANGED(CONTROLS) (CONTRACT_CONTROLS §C2): step 3's special press follows combat/specials.ts stepSpecialInput — it pops
// a slicked / surfacing / wall-slicking runner out and starts the special that tick, waits 0.35 s for a press that cannot
// start yet (mid-air, the meter about to fill), and pushes 'special' phase 'denied' for a press short of the meter. Same
// rules for every runner (bots included). A started special ends spawn protection as before; a denied press does not.
// stats.specialRuleEarly / specialRuleLate count the ticks where this decided differently from the pre-§C2 rule.
// CONTROLS leftover (2026-09-30): the SPECIAL key is tracked (Runner.specialHeld) on the ticks that skip stepSpecialInput —
// a dead runner in step 3 and every runner in the countdown — so a held key is never a new press after a respawn or at the
// live start, and a real press on the respawn tick is one (Runner.respawn no longer forces specialHeld).

import type { MapDef } from '../data.ts';
import { teamById, WEAPONS } from '../data.ts';
import type { MapGeometry } from '../mapgeo.ts';
import { featuresOf } from '../mapgeo.ts';
import type { CastHit, PhysicsWorld } from '../physics.ts';
import type { Painter } from '../paint/painter.ts';
import type { MatchMode, MatchRule, MoveState, PlayerIntent, Side, TeamId } from '../types.ts';
import { CREW_SLOTS, DEG, emptyIntent } from '../types.ts';
import { hash32, mulberry32 } from '../rng.ts';
import { COMBAT, HEALTH, HITBOX, KITS, MATCH, MOVE, SLICK, TANK, TICK } from '../config.ts';
import { Runner, type PadZone, type SpawnPoint } from '../runner.ts';
import type { RosterEntry } from './roster.ts';
import type { MatchPhase, SimEvent } from './events.ts';
import {
  KIND_CLOUD, KIND_JELLY, PSTATE_FLY, PSTATE_PUDDLE, ProjectilePool, paintImpact, stepProjectiles,
  type ProjectileHost, type ProjectileKind,
} from '../combat/projectiles.ts';
import {
  axisDistance, kitFire, projectileKind, resetKit, specialChargePoints, stepKit, streamFire, kitDef,
  type DamageCause, type KitFire, type KitHost,
} from '../combat/kits.ts';
import {
  burstKind, cloudKind, flickKind, jellyDef, jellyKind, specialDef,
  type BurstFire, type CloudDef, type JellyDef, type SpecialDef,
} from '../combat/defs.ts';
import { landJelly, stepSub, tickPuddle } from '../combat/subs.ts';
import { endSpecial, landCloud, slam, stepSpecialInput, tickCloud, type SpecialHost } from '../combat/specials.ts';

export interface MatchOptions {
  def: MapDef; geo: MapGeometry; physics: PhysicsWorld; painter: Painter; roster: RosterEntry[];
  seed: number; durationS?: number /*180*/; countdownS?: number /*3*/;
  /** CHANGED(CORE): 'teams' (default) or 'ffa' (every roster entry its own crew; CHANGED(SPAWNS): random safe spawn
   *  sites from maps.json ffaSites) */
  mode?: MatchMode;
  /** CHANGED(WASHOUT): 'turf' (default: the most floor wins) or 'washout' (the most credited washes wins) */
  rule?: MatchRule;
  /** CHANGED(WASHOUT), probes only: override the WASHOUT score limit (0 = no limit: the limit-tuning runs play to the
   *  horn). Default: washoutLimitFor(def, mode) — the map's data/maps.json washout block, else data/weapons.json →
   *  washout.teamLimit / ffaLimit. Ignored in TURF. */
  scoreLimit?: number;
}

/** CHANGED(CORE): one crew's line of the final standings */
export interface CrewStanding {
  crew: TeamId; share: number;
  /** 1-based. TURF: crews with exactly equal shares share a rank. CHANGED(WASHOUT): crews equal on every key of the
   *  WASHOUT order share a rank */
  rank: number;
  /** FFA: the crew's runner; teams: the crew's first runner (lowest id) */
  pid: number;
  /** FFA: the runner's name; teams: the crew name (teams.json) */
  name: string;
  /** CHANGED(WASHOUT): washes credited to the crew's runners (both rules; WASHOUT sea credits included) */
  washes: number;
  /** CHANGED(WASHOUT): times the crew's runners were washed, every cause (both rules) */
  washed: number;
  /** CHANGED(WASHOUT): the crew's WASHOUT score (= washes there); 0 in TURF */
  score: number;
}

/** sun / gulf / neutral / winner as before (teams). CHANGED(CORE), additive: FFA sets sun = shares[1], gulf = shares[2],
 *  neutral = shares[0]; read shares / standings there. winner 0 = a draw; `tied` then lists the crews tied for first.
 *  CHANGED(WASHOUT): rule / scores / limit / endedBy. In WASHOUT the winner is the higher score; at the horn a tie is broken
 *  TEAMS: the higher turf share (equal → draw); FFA: fewer washed, then the higher share (equal → draw, `tied`). Standings
 *  there sort by score, then (FFA) fewer washed, then share, then crew id — TEAMS skips the washed step so its rank 1 is
 *  always its winner (the TEAMS horn rule is score → share). */
export interface MatchResult {
  sun: number; gulf: number; neutral: number; winner: TeamId;
  mode?: MatchMode;
  /** weighted share per crew id (length CREW_SLOTS, [0] = neutral), sums to 1 */
  shares?: number[];
  /** every crew in play, share descending (ties → lower crew id first); WASHOUT: the WASHOUT order above */
  standings?: CrewStanding[];
  /** winner 0 → the crews tied for first; otherwise [] */
  tied?: TeamId[];
  /** CHANGED(WASHOUT): the match rule */
  rule: MatchRule;
  /** CHANGED(WASHOUT): score per crew id (length CREW_SLOTS, [0] = 0); all 0 in TURF */
  scores: number[];
  /** CHANGED(WASHOUT): the score limit the match played to (0 in TURF, or no limit) */
  limit: number;
  /** CHANGED(WASHOUT): 'limit' = a crew reached the WASHOUT limit; 'horn' = the clock ran out (always in TURF) */
  endedBy: 'horn' | 'limit';
}

/** CHANGED(WASHOUT): the WASHOUT numbers (data/weapons.json → washout; fallbacks only for a missing / bad field) */
export interface WashoutConfig {
  /** TEAMS: the crew score that ends the match — the FALLBACK for a map without its own (washoutLimitFor) */
  teamLimit: number;
  /** FFA: the crew (= runner) score that ends the match — the FALLBACK for a map without its own (washoutLimitFor) */
  ffaLimit: number;
  /** s: a sea wash is credited to the last foe who damaged the victim within this window */
  seaCreditS: number;
  /** s of spawn protection after a respawn (ends early when the runner fires, subs or uses a special) */
  protectS: number;
}
export const WASHOUT: WashoutConfig = ((): WashoutConfig => {
  const w = ((WEAPONS as unknown as { washout?: Record<string, unknown> }).washout ?? {}) as Record<string, unknown>;
  const num = (k: string, d: number): number => { const v = w[k]; return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d; };
  return { teamLimit: num('teamLimit', 51), ffaLimit: num('ffaLimit', 20), seaCreditS: num('seaCreditSeconds', 5), protectS: num('spawnProtectSeconds', 2) };
})();

/** CHANGED(WASHOUT) (CONTRACT_WASHOUT §W1): the WASHOUT score limit of `mode` on map `def` — data/maps.json →
 *  <map>.washout.teamLimit / ffaLimit (a positive number, rounded), else the data/weapons.json → washout fallback. The
 *  match reads it at construction (MatchWorld.limit); the UI may call it to show a map's limit before a match. */
export function washoutLimitFor(def: MapDef, mode: MatchMode): number {
  const raw = mode === 'ffa' ? def.washout?.ffaLimit : def.washout?.teamLimit;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) return Math.round(raw);
  return mode === 'ffa' ? WASHOUT.ffaLimit : WASHOUT.teamLimit;
}

/** CHANGED(CORE): an FFA drop pad as the view draws one (view/mapview.ts addFfaPads): top-centre + radius, its crew, its
 *  runner, the yaw (rad). CHANGED(SPAWNS): FFA has no owned pads any more — only MatchWorld.crewPads (always empty, a
 *  compatibility field) still carries this type. */
export interface CrewPad extends PadZone { crew: TeamId; pid: number; yaw: number }

/** CHANGED(CORE) + CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S2): FFA numbers (config.ts is not CORE-owned) */
export const MATCH_FFA = {
  /** m: a spawn site's disc — the site rules' clear floor (_harness/gen_ffa_spawns.ts) and the view's drop-in marker
   *  radius (it was the drop-pad radius, CONTRACT_FFA §F1) */
  padRadius: 1.6,
  /** m: a site with a living runner this close (3-D, feet to site) is no respawn candidate */
  siteClear: 3.0,
  /** m: a SAFE site is at least this far (3-D) from the nearest living foe … */
  safeFoe: 12,
  /** m: … and at least this far from the runner who washed the respawning one, while that runner is alive */
  safeKiller: 15,
  /** m: a living foe farther than this from a site's chest point (eye to chest, 3-D) never sees it */
  seeRange: 30,
  /** a runner never respawns at one of its last `recent` sites (unless every other site is taken) */
  recent: 2,
  /** fewer safe sites than this → the `fallbackN` best candidates by the nearest-foe distance, unseen ones only while
   *  any candidate is unseen */
  fallbackN: 3,
} as const;

/** CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S1): a map's FFA spawn-site pool, yaw in radians — maps.json ffaSites (16–24,
 *  the first 8 = ffaSpawns); a map without a usable pool falls back to its 8 ffaSpawns, and a map without those to slots
 *  spread over the two team pads (never the case for a built map). */
export function ffaSitePool(def: MapDef, geo: MapGeometry, n: number): SpawnPoint[] {
  const ok = (a: Array<{ pos: number[]; yaw: number }> | undefined): a is Array<{ pos: number[]; yaw: number }> =>
    Array.isArray(a) && a.length >= n && a.every((s) => Array.isArray(s.pos) && s.pos.length >= 3 && s.pos.every(Number.isFinite) && Number.isFinite(s.yaw));
  const raw = ok(def.ffaSites) ? def.ffaSites : ok(def.ffaSpawns) ? def.ffaSpawns : null;
  if (raw) return raw.map((s) => ({ x: s.pos[0], y: s.pos[1], z: s.pos[2], yaw: s.yaw * DEG }));
  const pts: SpawnPoint[] = [];
  for (let i = 0; i < n; i++) {
    const sp = geo.spawns[i % 2 === 0 ? 'A' : 'B'];
    const lat = MATCH.spawnSlots[(i >> 1) % MATCH.spawnSlots.length] * 2.4;
    pts.push({ x: sp.x - Math.cos(sp.yaw) * lat, y: sp.y, z: sp.z + Math.sin(sp.yaw) * lat, yaw: sp.yaw });
  }
  return pts;
}

/** CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S2): the match-start site of each of `n` runners — a farthest-point pick (3-D
 *  distance) over the pool starting from a site drawn from `rnd`, then a seeded shuffle assigns the picks to the runners
 *  (more runners than sites: the picks repeat). Deterministic in `rnd`. */
export function ffaStartSites(pool: readonly SpawnPoint[], n: number, rnd: () => number): number[] {
  const m = pool.length;
  if (m === 0 || n <= 0) return [];
  const picked: number[] = [];
  const md = new Float64Array(m).fill(Infinity);
  let cur = Math.min(m - 1, Math.floor(rnd() * m));
  while (cur >= 0 && picked.length < Math.min(n, m)) {
    picked.push(cur);
    md[cur] = -1;
    const q = pool[cur];
    let best = -1, bd = -1;
    for (let i = 0; i < m; i++) {
      if (md[i] < 0) continue;
      const p = pool[i];
      const d = Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
      if (d < md[i]) md[i] = d;
      if (md[i] > bd) { bd = md[i]; best = i; }
    }
    cur = best;
  }
  for (let i = picked.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = picked[i]; picked[i] = picked[j]; picked[j] = t; }
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(picked[i % picked.length]);
  return out;
}

export interface MatchStats {
  shots: number; dry: number; splats: number; hits: number; washes: number; seaWashes: number;
  slicks: number; projectilesDropped: number; eventsDropped: number;
  // CHANGED(KITSIM): counted from the events of the same name
  flicks: number; beams: number; bursts: number; subs: number; pops: number; specials: number;
  /** CHANGED(SPAWNS): FFA respawn site choices, and those that took the fallback set (fewer than fallbackN safe sites,
   *  or no candidate at all); 0 in teams */
  spawns: number; spawnFallbacks: number;
  /** CHANGED(SPAWNS), info: FFA respawn choices with NO unseen candidate at all, and the candidates / unseen candidates /
   *  safe candidates summed over the choices (their means describe how much choice the pool gave) */
  spawnNoUnseen: number; spawnCands: number; spawnUnseenCands: number; spawnSafeCands: number;
  /** CHANGED(CONTROLS), info (CONTRACT_CONTROLS §C2): specials started by popping out (slick form / surfacing / wall / not
   *  tall), specials started by a released press still waiting in the buffer, and 'denied' presses */
  specialPops: number; specialBuffered: number; specialDenied: number;
  /** CHANGED(CONTROLS), info: live runner-ticks on which the §C2 rules started a special that the pre-§C2 rule (a held
   *  press + canFire()) would not have (early: popped out, or from the buffer), or did not start one it would have (late:
   *  a tall runner mid-air now waits for the landing). Both 0 in a match ⇒ §C2 changed nothing in it: its hashes are the
   *  pre-§C2 ones. */
  specialRuleEarly: number; specialRuleLate: number;
}

const STATE_INDEX: Record<MoveState, number> = { walk: 0, slog: 1, slick: 2, wallslick: 3, air: 4 };
const PHASE_INDEX: Record<MatchPhase, number> = { countdown: 0, live: 1, ended: 2 };

/** Team pads from maps.json spawnpad brushes (mirror rule rot180: (x, y, z) → (−x, y, −z)); spawns as fallback. */
export function padsOf(def: MapDef, geo: MapGeometry): Record<Side, PadZone> {
  const out: Partial<Record<Side, PadZone>> = {};
  for (const raw of (def.brushes ?? []) as Array<Record<string, unknown>>) {
    if (raw['kind'] !== 'spawnpad') continue;
    const c = raw['center'] as number[] | undefined;
    if (!c || c.length < 3) continue;
    const r = typeof raw['radius'] === 'number' ? (raw['radius'] as number) : MATCH.padRadiusFallback;
    const side: Side = raw['team'] === 'B' ? 'B' : 'A';
    out[side] = { x: c[0], y: c[1], z: c[2], r };
    if (raw['mirror']) out[side === 'A' ? 'B' : 'A'] = { x: -c[0], y: c[1], z: -c[2], r };
  }
  for (const s of ['A', 'B'] as Side[]) {
    if (!out[s]) { const sp = geo.spawns[s]; out[s] = { x: sp.x, y: sp.y, z: sp.z, r: MATCH.padRadiusFallback }; }
  }
  return out as Record<Side, PadZone>;
}

export class MatchWorld implements ProjectileHost, KitHost, SpecialHost {
  readonly runners: Runner[];
  readonly projectiles: ProjectilePool;
  readonly painter: Painter;
  readonly physics: PhysicsWorld;
  readonly def: MapDef;
  readonly seed: number;
  phase: MatchPhase = 'countdown';
  tick = 0;
  timeLeft: number;
  countdown: number;
  result: MatchResult | null = null;

  // ── §10.4 extras ──
  /** the two team pads (teams: A = SUNCREW, B = GULF CREW; FFA: neutral scenery) */
  readonly pads: Record<Side, PadZone>;
  /** CHANGED(CORE): 'teams' | 'ffa' */
  readonly mode: MatchMode;
  /** @deprecated COMPATIBILITY FIELD — CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S3): FFA has no owned drop pads, so this is
   *  ALWAYS EMPTY (both modes). It is kept only so the pre-SPAWNS view (main.ts addFfaPads, testsurface ffaPads) still
   *  compiles and draws no pads; the UI stage switches to spawnSites / Runner.spawnSite / the 'spawn' event and then
   *  deletes it. Nothing in core reads it. */
  readonly crewPads: readonly CrewPad[] = [];
  /** CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S1): FFA — the map's spawn-site pool (maps.json ffaSites, yaw in RADIANS);
   *  Runner.spawnSite and the 'spawn' event index it. [] in teams. */
  readonly spawnSites: readonly SpawnPoint[];
  /** CHANGED(CORE): the crews in play, ascending (teams [1, 2]; FFA the roster's crews) */
  readonly crews: TeamId[];
  /** CHANGED(WASHOUT): 'turf' | 'washout' */
  readonly rule: MatchRule;
  /** CHANGED(WASHOUT): the WASHOUT score limit (0: TURF, or no limit) */
  readonly limit: number;
  /** CHANGED(WASHOUT): how the match ended (null while it runs) */
  endedBy: 'horn' | 'limit' | null = null;
  readonly durationS: number;
  readonly countdownS: number;
  readonly stats: MatchStats = {
    shots: 0, dry: 0, splats: 0, hits: 0, washes: 0, seaWashes: 0, slicks: 0, projectilesDropped: 0, eventsDropped: 0,
    flicks: 0, beams: 0, bursts: 0, subs: 0, pops: 0, specials: 0, spawns: 0, spawnFallbacks: 0,
    spawnNoUnseen: 0, spawnCands: 0, spawnUnseenCands: 0, spawnSafeCands: 0,
    specialPops: 0, specialBuffered: 0, specialDenied: 0, specialRuleEarly: 0, specialRuleLate: 0,
  };
  /** CHANGED(MAPSIM): maps.json map-level mist.hideRange (m): SLICK enemies beyond it are unseen; Infinity = no mist */
  readonly mistRange: number;
  // ProjectileHost / KitHost
  readonly killY: number;
  /** projectile variants (index = pool.variant): 0 = MIST-RASP, then one per kit fire / sub / special in roster order */
  readonly kinds: ProjectileKind[];
  readonly seedWord: number;
  get pool(): ProjectilePool { return this.projectiles; }

  private readonly events: SimEvent[] = [];
  private readonly slots: SpawnPoint[];
  private readonly fire: KitFire[];
  private readonly fireVariant: number[];
  private readonly subDefs: Array<JellyDef | null>;
  private readonly subVariant: number[];
  private readonly specialDefs: Array<SpecialDef | null>;
  private readonly specialVariant: number[];
  private readonly variantBurst: Array<BurstFire | null> = [];
  private readonly variantJelly: Array<JellyDef | null> = [];
  private readonly variantCloud: Array<CloudDef | null> = [];
  private readonly variantKey = new Map<string, number>();
  private readonly specialRngs: Array<() => number>;
  private readonly rngs: Array<() => number>;
  private readonly charge: number[];
  private readonly specialId: string[];
  private readonly respawnTicks: Int32Array;
  private readonly durTicks: number;
  private countTicks: number;
  private liveTicks = 0;
  private readonly neutral: PlayerIntent = emptyIntent();
  private readonly respawnSeconds: number;
  private readonly specialPts: { perM2: number; perWash: number; keep: number };
  // ── CHANGED(WASHOUT) ──
  private readonly washout: boolean;
  /** live score per crew id (length CREW_SLOTS); scores() hands this out */
  private readonly scoreArr: number[] = new Array<number>(CREW_SLOTS).fill(0);
  /** whole ticks of spawn protection left per runner (0 always in TEAMS TURF) */
  private readonly protectTicks: Int32Array;
  /** a crew reached the limit this tick: end() runs at the end of the tick */
  private limitHit = false;
  // ── CHANGED(SPAWNS) ──
  /** a respawn grants spawn protection: WASHOUT (both modes) and FFA (both rules); never TEAMS TURF */
  private readonly protect: boolean;
  /** FFA: the spawn-choice stream (match start + every respawn draw from it, nothing else does); null in teams */
  private readonly spawnRng: (() => number) | null;
  /** FFA: per runner its last MATCH_FFA.recent sites, newest first (−1 = none) */
  private readonly siteHist: Int32Array;
  /** FFA: per runner the runner that washed it last (credited washer, else the last foe hit within the sea-credit
   *  window; −1 none) — the respawn choice keeps safeKiller m from it */
  private readonly killer: Int32Array;
  /** FFA: runners whose respawn timer ran out this tick (resolved after every living runner moved) */
  private readonly pendingSpawn: Int32Array;
  /** scratch for chooseSite */
  private readonly siteCand: number[] = [];
  private readonly siteSafe: number[] = [];
  private siteDmin: Float64Array = new Float64Array(0);
  private siteSeenBy: Uint8Array = new Uint8Array(0);

  constructor(o: MatchOptions) {
    this.def = o.def;
    this.physics = o.physics;
    this.painter = o.painter;
    this.seed = o.seed | 0;
    this.seedWord = hash32(this.seed, 0x5eed5a17);
    this.durationS = o.durationS ?? MATCH.durationS;
    this.countdownS = o.countdownS ?? MATCH.countdownS;
    this.durTicks = Math.max(1, Math.round(this.durationS / TICK));
    this.countTicks = Math.max(0, Math.round(this.countdownS / TICK));
    this.timeLeft = this.durTicks * TICK;
    this.countdown = this.countTicks * TICK;
    this.killY = o.def.killY ?? -1;
    const mist = (o.def as unknown as { mist?: { hideRange?: unknown } }).mist;
    this.mistRange = mist && typeof mist.hideRange === 'number' && mist.hideRange > 0 ? mist.hideRange : Infinity;
    this.respawnSeconds = WEAPONS.respawnSeconds;
    const sc = WEAPONS.specialCharge;
    this.specialPts = { perM2: sc['pointsPerSquareMetre'] ?? 1, perWash: sc['pointsPerWash'] ?? 20, keep: sc['keepOnWashed'] ?? 0.5 };
    this.pads = padsOf(o.def, o.geo);
    this.mode = o.mode === 'ffa' ? 'ffa' : 'teams';
    this.rule = o.rule === 'washout' ? 'washout' : 'turf';
    this.washout = this.rule === 'washout';
    {
      const lim = o.scoreLimit ?? washoutLimitFor(o.def, this.mode);   // per map (maps.json), else weapons.json
      this.limit = this.washout && Number.isFinite(lim) && lim > 0 ? Math.round(lim) : 0;
    }
    this.protectTicks = new Int32Array(o.roster.length);
    this.protect = this.washout || this.mode === 'ffa';               // CHANGED(SPAWNS)
    this.siteHist = new Int32Array(o.roster.length * MATCH_FFA.recent).fill(-1);
    this.killer = new Int32Array(o.roster.length).fill(-1);
    this.pendingSpawn = new Int32Array(o.roster.length);
    this.projectiles = new ProjectilePool(COMBAT.poolCapacity);

    // projectile variants: 0 = MIST-RASP (the fallback of every droplet), then per kit / sub / special
    this.kinds = [];
    this.variant('mist-rasp:stream', projectileKind(streamFire('mist-rasp')));

    const roster = o.roster;
    this.runners = [];
    this.slots = [];
    this.fire = [];
    this.fireVariant = [];
    this.subDefs = [];
    this.subVariant = [];
    this.specialDefs = [];
    this.specialVariant = [];
    this.specialRngs = [];
    this.rngs = [];
    this.charge = [];
    this.specialId = [];
    this.respawnTicks = new Int32Array(roster.length);
    const perTeam: Record<number, number> = { 0: 0, 1: 0, 2: 0 };
    const ffa = this.mode === 'ffa';
    let startSites: number[] = [];
    if (ffa) {
      // CHANGED(SPAWNS): the site pool and the match-start spread pick, from the FFA spawn stream (its first draws)
      this.spawnSites = ffaSitePool(o.def, o.geo, roster.length);
      this.spawnRng = mulberry32(hash32(this.seed, 0x5b175e5));
      startSites = ffaStartSites(this.spawnSites, roster.length, this.spawnRng);
      this.crews = [...new Set(roster.map((e) => e.team))].filter((t) => t !== 0).sort((a, b) => a - b);
    } else {
      this.spawnSites = [];
      this.spawnRng = null;
      this.crews = [1, 2];
    }
    this.siteDmin = new Float64Array(this.spawnSites.length);
    this.siteSeenBy = new Uint8Array(this.spawnSites.length);
    // CHANGED(CORE) (review F2) → CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S3): no FFA pad sits on the floor any more, so
    // nothing is locked in either mode. The call clears a lock an older session may have left on this painter (one
    // painter serves every session on an arena); on a painter that never had one it is a no-op (teams hashes unchanged).
    o.painter.lockDiscs([]);
    for (let i = 0; i < roster.length; i++) {
      const e = roster[i];
      if (e.id !== i) throw new Error(`MatchWorld: roster[${i}].id is ${e.id}; ids must equal their index (runners[i] ↔ intents[i])`);
      const side: Side = e.team === 2 ? 'B' : 'A';
      let slot: SpawnPoint;
      if (ffa) {
        slot = { ...this.spawnSites[startSites[i]] };
        this.siteHist[i * MATCH_FFA.recent] = startSites[i];
      } else {
        const sp = o.geo.spawns[side];
        const k = perTeam[e.team]++;
        const lat = MATCH.spawnSlots[k % MATCH.spawnSlots.length];
        slot = { x: sp.x - Math.cos(sp.yaw) * lat, y: sp.y, z: sp.z + Math.sin(sp.yaw) * lat, yaw: sp.yaw };
      }
      this.slots.push(slot);
      const f = kitFire(e.kit);
      this.fire.push(f);
      let fv = 0;
      if (f.type === 'stream') fv = this.variant(`${f.kit}:stream`, projectileKind(f));
      else if (f.type === 'roll') fv = this.variant(`${f.kit}:flick`, flickKind(f));
      else if (f.type === 'burst') { fv = this.variant(`${f.kit}:burst`, burstKind(f)); this.variantBurst[fv] = f; }
      this.fireVariant.push(fv);
      let subId = 'jelly-charge', sid = 'cloudburst';
      try { const row = kitDef(e.kit); subId = String(row.sub); sid = String(row.special); } catch { /* unknown kit → MIST-RASP's sub + special */ }
      const sub = jellyDef(subId);
      this.subDefs.push(sub);
      let sv = 0;
      if (sub) { sv = this.variant(`sub:${sub.id}`, jellyKind(sub)); this.variantJelly[sv] = sub; }
      this.subVariant.push(sv);
      const spec = specialDef(sid);
      this.specialDefs.push(spec);
      let pv = 0;
      if (spec && spec.type === 'cloudburst') { pv = this.variant(`special:${spec.id}`, cloudKind(spec)); this.variantCloud[pv] = spec; }
      this.specialVariant.push(pv);
      const body = o.physics.createCharacter(MOVE.radius, MOVE.halfHeight);
      const r = new Runner({ id: e.id, name: e.name, team: e.team, kit: e.kit, bot: e.bot }, body, slot, {
        killY: this.killY,
        physics: o.physics,
        // CHANGED(SPAWNS): FFA — no own pad (no pad slick / refill) and no pad anyone is pushed out of
        ownPad: ffa ? null : this.pads[side],
        enemyPad: ffa ? null : this.pads[side === 'A' ? 'B' : 'A'],
        mode: this.mode,
        autoRespawn: false,
        fireMoveMul: f.moveSpeedWhileFiring,
        fireSpeedCap: f.type === 'roll' ? f.rollSpeed : undefined,
        faceMotionWhileFiring: f.type === 'roll',
        features: featuresOf(o.geo),
      });
      if (ffa) r.spawnSite = startSites[i];                           // CHANGED(SPAWNS)
      this.runners.push(r);
      this.rngs.push(mulberry32(hash32(this.seed, e.id, 0xc0b4a7)));
      this.specialRngs.push(mulberry32(hash32(this.seed, e.id, 0x5bec1a1)));
      this.charge.push(specialChargePoints(e.kit));
      this.specialId.push(sid);
    }
    // CHANGED(SPAWNS): FFA — one 'spawn' event per runner for its match-start site (the view's drop-in marker, the HUD)
    if (ffa) for (const r of this.runners) this.pushSpawnEvent(r);

    if (this.countTicks === 0) {
      this.phase = 'live';
      this.pushEvent({ t: 'phase', phase: 'live' });
      this.pushEvent({ t: 'horn', kind: 'start' });
    } else {
      this.pushEvent({ t: 'phase', phase: 'countdown' });
    }
  }

  // ── the tick ──────────────────────────────────────────────────────────────────────────────

  step(intents: readonly PlayerIntent[]): void {
    const dt = TICK;
    this.tick++;
    const R = this.runners;

    if (this.phase === 'countdown') {
      // inputs frozen: look around, nothing else. CHANGED(CONTROLS leftover): the SPECIAL key is still tracked (no
      // stepSpecialInput runs here), so a key held through the countdown is no press on the first live tick
      for (let i = 0; i < R.length; i++) {
        R[i].specialHeld = !!(intents[i] ?? this.neutral).special;
        R[i].step(dt, this.frozen(R[i], intents[i]), this.painter, this.events);
      }
      if (this.countTicks > 0) this.countTicks--;
      this.countdown = this.countTicks * TICK;
      if (this.countTicks === 0) {
        this.phase = 'live';
        this.pushEvent({ t: 'phase', phase: 'live' });
        this.pushEvent({ t: 'horn', kind: 'start' });
      }
      this.capEvents();
      return;
    }

    if (this.phase === 'ended') {
      for (let i = 0; i < R.length; i++) R[i].step(dt, this.frozen(R[i], null), this.painter, null);
      return;
    }

    // 1. respawn timers + movement. CHANGED(SPAWNS): an FFA respawn waits until every living runner has moved (its site
    //    choice then sees this tick's positions), resolved in runner-id order; teams respawns inline as before
    const deferSpawn = this.spawnRng !== null;
    let nPending = 0;
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      if (!r.alive) {
        r.px = r.x; r.py = r.y; r.pz = r.z; r.pyaw = r.yaw;
        const left = --this.respawnTicks[i];
        r.respawnT = Math.max(0, left) * TICK;
        if (left <= 0) { if (deferSpawn) this.pendingSpawn[nPending++] = i; else this.respawnRunner(r); }
        continue;
      }
      const s0 = r.slicks;
      r.step(dt, intents[i] ?? this.neutral, this.painter, this.events);
      this.stats.slicks += r.slicks - s0;
      if (r.slamPending || (r.leaping && r.leapT > KITS.leapMaxSeconds)) this.doSlam(r);
    }
    for (let k = 0; k < nPending; k++) this.respawnRunner(R[this.pendingSpawn[k]]);
    // 2. the sea
    for (let i = 0; i < R.length; i++) if (R[i].alive && R[i].inSea) this.wash(R[i], null, 'sea');
    // 3. kits, subs, specials
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      // CHANGED(CONTROLS leftover): a dead runner skips stepSpecialInput, so its SPECIAL key is tracked here (held through
      // the wash → no press at the respawn; released while dead, pressed on the respawn tick → a press)
      if (!r.alive) { r.firing = false; r.specialHeld = !!(intents[i] ?? this.neutral).special; continue; }
      const it = intents[i] ?? this.neutral;
      const shots0 = r.shots, subs0 = r.subs;
      stepKit(r, it, dt, this.fire[i], this.fireVariant[i], this.rngs[i], this);
      stepSub(r, it, dt, this.subDefs[i], this.subVariant[i], this);
      // CHANGED(CONTROLS) (CONTRACT_CONTROLS §C2): the special always answers (combat/specials.ts). Info only: what the
      // pre-§C2 rule would have done this tick, and whether this start had to pop the runner out of its slick / wall
      const preC2 = this.specialDefs[i] !== null && !!it.special && r.specialReady && r.special >= 1 && r.specialActive === '' && r.canFire();
      const popped = r.slickForm || r.surfacing > 0 || r.state === 'wallslick' || !r.isTall;
      const started = stepSpecialInput(r, it, this.specialDefs[i], this.specialVariant[i], this);
      if (started) { if (popped) this.stats.specialPops++; if (!it.special) this.stats.specialBuffered++; }
      if (started !== preC2) { if (started) this.stats.specialRuleEarly++; else this.stats.specialRuleLate++; }
      // CHANGED(WASHOUT): spawn protection ends on an action that actually happened this tick — the kit fired (a stream /
      // burst cycle, a drum roll or flick windup, a NEEDLE-GLINT charge: r.firing; any shot left: r.shots), a sub was
      // thrown, a special started. A press that does nothing (dry tank, sub on cooldown, no special ready, can't fire)
      // keeps it. Never set in TEAMS TURF (protectTicks stays 0), so TEAMS TURF reads nothing new here.
      if (this.protectTicks[i] > 0 && (r.firing || r.shots !== shots0 || r.subs !== subs0 || started)) this.unprotect(i);
    }
    // 4. projectiles: resting slots (jelly puddles, CLOUDBURST cells), then flying ones — a slot that lands
    //    this tick starts its fuse / rise on the next tick (fuse and rain last exactly their whole ticks)
    this.stepResting();
    stepProjectiles(this.projectiles, dt, this);
    this.stats.projectilesDropped = this.projectiles.dropped;
    // 5. regen + special clocks
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      if (r.specialActive !== '') r.specialT += dt;
      if (!r.alive) continue;
      if (this.protectTicks[i] > 0) r.protectedT = --this.protectTicks[i] * TICK;   // CHANGED(WASHOUT)
      r.lastHitT += dt;
      if (r.lastHitT >= HEALTH.regenDelay && r.hp < WEAPONS.hp) r.hp = Math.min(WEAPONS.hp, r.hp + HEALTH.regenPerSecond * dt);
    }
    // CHANGED(WASHOUT): a crew reached the score limit this tick → the match ends now, through the horn path
    if (this.limitHit) { this.end('limit'); this.capEvents(); return; }
    // clock + horns
    this.liveTicks++;
    const left = this.durTicks - this.liveTicks;
    this.timeLeft = Math.max(0, left) * TICK;
    const minute = Math.round(MATCH.minuteHornS / TICK), final10 = Math.round(MATCH.finalHornS / TICK);
    if (this.durTicks > minute && left === minute) this.pushEvent({ t: 'horn', kind: 'minute' });
    if (this.durTicks > final10 && left === final10) this.pushEvent({ t: 'horn', kind: 'final10' });
    if (left <= 0) this.end();
    this.capEvents();
  }

  drainEvents(out: SimEvent[]): number {
    const ev = this.events;
    const n = ev.length;
    for (let i = 0; i < n; i++) out.push(ev[i]);
    ev.length = 0;
    return n;
  }

  /** the runner stands on its own pad (teams); CHANGED(SPAWNS): always false in FFA (no owned pads) */
  onOwnPad(r: Runner): boolean {
    return r.onPad(this.padOf(r));
  }

  /** CHANGED(CORE): the runner's own pad — teams: its team pad. CHANGED(SPAWNS): FFA → null (no owned pads; the runner's
   *  latest spawn site is spawnSites[r.spawnSite]) */
  padOf(r: Runner): PadZone | null {
    return this.mode === 'ffa' ? null : this.pads[r.side];
  }

  /** CHANGED(SPAWNS): FFA — the site of the runner's latest spawn (match start or respawn), yaw in radians; null in teams */
  spawnSiteOf(r: Runner): SpawnPoint | null {
    return this.mode === 'ffa' && r.spawnSite >= 0 && r.spawnSite < this.spawnSites.length ? this.spawnSites[r.spawnSite] : null;
  }

  canSee(viewer: Runner, target: Runner): boolean {
    if (!target.alive || !viewer.alive) return false;
    if (viewer === target || viewer.team === target.team) return true;
    const ey = viewer.y + (viewer.slickForm ? COMBAT.slickEyeHeight : COMBAT.eyeHeight);
    const ty = target.y + target.hitHeight() * 0.5;
    const dx = target.x - viewer.x, dy = ty - ey, dz = target.z - viewer.z;
    const d = Math.hypot(dx, dy, dz);
    if (target.hidden && d > SLICK.hiddenRange) return false;
    if (target.slickForm && d > this.mistRange) return false;          // CHANGED(MAPSIM): map mist
    if (d < 1e-3) return true;
    const hit = this.physics.raycast(viewer.x, ey, viewer.z, dx, dy, dz, d);
    return !hit || hit.toi >= d - 0.25;
  }

  hash(): string {
    let h = 0x811c9dc5;
    const mix = (v: number): void => {
      const q = Math.round(v * 1000) | 0;
      h ^= q & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (q >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (q >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
      h ^= (q >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
    };
    mix(this.tick); mix(PHASE_INDEX[this.phase]); mix(this.timeLeft);
    for (const r of this.runners) {
      mix(r.x); mix(r.y); mix(r.z); mix(r.vx); mix(r.vy); mix(r.vz); mix(r.yaw);
      mix(r.tank); mix(r.hp); mix(r.alive ? 1 : 0); mix(STATE_INDEX[r.state]); mix(r.special);
      mix(r.washes); mix(r.washedCount); mix(r.painted); mix(r.shots); mix(r.slickForm ? 1 : 0);
    }
    const p = this.projectiles;
    mix(p.count);
    for (let i = 0; i < p.count; i++) { mix(p.x[i]); mix(p.y[i]); mix(p.z[i]); mix(p.owner[i]); }
    if (this.washout) {
      // CHANGED(WASHOUT): WASHOUT only — the TURF hash mixes exactly what it did before
      for (const k of this.crews) mix(this.scoreArr[k]);
      for (const r of this.runners) { mix(r.protectedT); mix(r.lastHitBy); }
    }
    if (this.spawnRng !== null) {
      // CHANGED(SPAWNS): FFA only (both rules) — the spawn site of every runner, and TURF FFA's spawn protection (WASHOUT
      // mixed it above); the TEAMS hashes (TURF and WASHOUT) mix exactly what they did before
      for (const r of this.runners) { mix(r.spawnSite); if (!this.washout) mix(r.protectedT); }
    }
    return `${this.painter.hash()}-${(h >>> 0).toString(16).padStart(8, '0')}`;
  }

  /** CHANGED(WASHOUT) (CONTRACT_WASHOUT §W2): live score per crew id (length CREW_SLOTS, [0] = 0; all 0 in TURF). The
   *  world's own array, handed out without a copy so the HUD can read it every frame — callers must not write it. */
  scores(): number[] { return this.scoreArr; }

  /** The runner's own slot on its team pad. CHANGED(SPAWNS): FFA — the site of its latest spawn. */
  spawnFor(r: Runner): SpawnPoint { return { ...this.slots[r.id] }; }

  // ── ProjectileHost ────────────────────────────────────────────────────────────────────────

  paint(owner: number, team: TeamId, x: number, y: number, z: number, r: number,
    nx: number, ny: number, nz: number, minFacing: number, seed: number): number {
    const P = this.painter;
    const before = P.weighted(team);
    const flips = P.splat(x, y, z, { radius: r, team, nx, ny, nz, minFacing, seed });
    this.credit(owner, P.weighted(team) - before);
    this.stats.splats++;
    this.pushEvent({ t: 'splat', x, y, z, r, team, nx, ny, nz, flips });
    return flips;
  }

  hit(victim: Runner, owner: number, dmg: number, x: number, y: number, z: number): void {
    this.damage(victim, owner, dmg, x, y, z, 'dye', true);
  }

  /** A MODE_BURST slot explodes: direct damage, line-of-sight splash with linear falloff, paint. */
  burst(slot: number, x: number, y: number, z: number, victim: Runner | null,
    nx: number, ny: number, nz: number, air: boolean): void {
    const P = this.projectiles;
    const bf = this.variantBurst[P.variant[slot]];
    if (!bf) return;
    const owner = P.owner[slot], team = P.team[slot] as TeamId;
    this.emit({ t: 'burst', pid: owner, x, y, z, r: bf.splashRadius, air });
    if (victim) this.damage(victim, owner, bf.directDamage, x, y, z, 'dye');
    const onMap = !air && !victim;
    const lx = onMap ? x + nx * 0.08 : x, ly = onMap ? y + ny * 0.08 : y, lz = onMap ? z + nz * 0.08 : z;
    const R = this.runners;
    for (let i = 0; i < R.length; i++) {
      const v = R[i];
      if (!v.alive || v.team === team || v === victim) continue;
      const d = axisDistance(v, x, y, z);
      if (d > bf.splashRadius) continue;
      const cy = v.y + v.hitHeight() * 0.5;
      if (!this.lineClear(lx, ly, lz, v.x, cy, v.z)) continue;
      const dmg = bf.splashDamage * (1 - (1 - KITS.splashEdgeFactor) * (d / bf.splashRadius));
      this.damage(v, owner, dmg, v.x, cy, v.z, 'dye');
    }
    const seed = P.seed[slot];
    if (onMap) {
      paintImpact(this, owner, team, x, y, z, nx, ny, nz, bf.impactRadius, seed, P.vx[slot], P.vz[slot]);
    } else {
      const g = this.physics.raycast(x, y, z, 0, -1, 0, COMBAT.dripMaxDrop);
      if (g) this.paint(owner, team, g.x, g.y, g.z, air ? bf.airburstRadius : bf.impactRadius, g.nx, g.ny, g.nz, -0.1, seed);
    }
  }

  /** A MODE_LANDER slot touched the map: a jelly becomes a puddle, a CLOUDBURST cell starts to rise. */
  land(slot: number, hit: CastHit): boolean {
    const P = this.projectiles;
    const k = P.kind[slot], v = P.variant[slot];
    if (k === KIND_JELLY) {
      const j = this.variantJelly[v];
      if (!j) return false;
      landJelly(slot, hit, j, this);
      return true;
    }
    if (k === KIND_CLOUD) {
      const c = this.variantCloud[v];
      if (c) { landCloud(slot, hit, c, this); return true; }
      this.lost(slot);
    }
    return false;
  }

  /** A lander expired / fell into the sea: a lost CLOUDBURST cell ends its special. */
  lost(slot: number): void {
    const P = this.projectiles;
    if (P.kind[slot] !== KIND_CLOUD) return;
    const r = this.runners[P.owner[slot]];
    if (r) endSpecial(r, P.x[slot], P.y[slot], P.z[slot], this);
  }

  // ── KitHost ───────────────────────────────────────────────────────────────────────────────

  emit(e: SimEvent): void {
    switch (e.t) {
      case 'shot': this.stats.shots++; break;
      case 'dry': this.stats.dry++; break;
      case 'flick': this.stats.flicks++; break;
      case 'beam': this.stats.beams++; break;
      case 'burst': this.stats.bursts++; break;
      case 'sub': if (e.phase === 'throw') this.stats.subs++; else if (e.phase === 'pop') this.stats.pops++; break;
      case 'special': if (e.phase === 'start') this.stats.specials++; else if (e.phase === 'denied') this.stats.specialDenied++; break;
      default: break;
    }
    this.pushEvent(e);
  }

  paintStrip(owner: number, team: TeamId, ax: number, ay: number, az: number, bx: number, by: number, bz: number,
    r: number, seed: number): number {
    const P = this.painter;
    const before = P.weighted(team);
    const flips = P.capsule(ax, ay, az, bx, by, bz, {
      radius: r, team, nx: 0, ny: 1, nz: 0, minFacing: KITS.rollMinFacing, edgeNoise: KITS.rollEdgeNoise, seed,
    });
    this.credit(owner, P.weighted(team) - before);
    return flips;
  }

  damage(victim: Runner, owner: number, dmg: number, x: number, y: number, z: number, cause: DamageCause, puddle: boolean = true): void {
    if (!victim.alive || this.phase !== 'live' || victim.leaping) return;   // WELLSPRING leapers can't be interrupted
    if (victim.protectedT > 0) return;                               // CHANGED(WASHOUT): spawn protection (0 in TURF)
    const a = owner >= 0 && owner < this.runners.length ? this.runners[owner] : null;
    if (a && a.team === victim.team) return;                         // no friendly fire
    // CHANGED(WASHOUT): a spawn-protected runner that deals damage — from any source: its kit, a jelly, a CLOUDBURST thrown
    // before its wash that outlived it, a slam — loses its protection (0 always in TURF: no-op there)
    if (a && this.protectTicks[a.id] > 0) this.unprotect(a.id);
    victim.hp = Math.max(0, victim.hp - dmg);
    victim.lastHitT = 0;
    victim.lastAttacker = owner;
    victim.lastHitBy = a ? owner : -1;                                // CHANGED(WASHOUT): the sea-credit candidate
    this.stats.hits++;
    this.pushEvent({ t: 'hit', victim: victim.id, by: owner, dmg, x, y, z });
    if (a && puddle) {
      this.paint(owner, a.team, victim.x, victim.y + 0.05, victim.z, HITBOX.hitPuddleRadius, 0, 1, 0, 0.3,
        hash32(this.seedWord, victim.id, this.tick));
    }
    if (victim.hp <= 0) this.wash(victim, a ? owner : null, cause);
  }

  lineClear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) return true;
    const h = this.physics.raycast(ax, ay, az, dx, dy, dz, d);
    return !h || h.toi >= d - 0.05;
  }

  // ── SpecialHost ───────────────────────────────────────────────────────────────────────────

  specialRng(pid: number): () => number {
    return this.specialRngs[pid] ?? this.specialRngs[0];
  }

  // ── dev / probe hooks (FRONT exposes them behind ?dev=1) ─────────────────────────────────

  devSetTimeLeft(s: number): void {
    const left = Math.max(0, Math.min(this.durTicks, Math.round(s / TICK)));
    this.liveTicks = this.durTicks - left;
    this.timeLeft = left * TICK;
  }

  devDamage(pid: number, n: number, by: number = -1): void {
    const v = this.runners[pid];
    if (!v || !v.alive) return;
    if (by >= 0 && by < this.runners.length && this.runners[by].team !== v.team) {
      this.hit(v, by, n, v.x, v.y + 0.6, v.z);
      return;
    }
    if (v.protectedT > 0) return;                                    // CHANGED(WASHOUT): protected (0 in TURF)
    v.hp = Math.max(0, v.hp - n);
    v.lastHitT = 0;
    v.lastHitBy = -1;                                                // CHANGED(WASHOUT): no foe behind this hit
    if (v.hp <= 0) this.wash(v, null, 'dye');
  }

  /** CHANGED(WASHOUT), dev / probe: set a crew's WASHOUT score (no event, no limit check — to construct ties / near-limit
   *  states). No-op in TURF. */
  devSetScore(crew: TeamId, n: number): void {
    if (!this.washout || crew <= 0 || crew >= CREW_SLOTS) return;
    this.scoreArr[crew] = Math.max(0, Math.floor(n));
  }

  devSetTank(pid: number, v: number): void {
    const r = this.runners[pid];
    if (!r) return;
    r.tank = Math.max(0, Math.min(TANK.max, v));
    if (r.tank > TANK.lowRearm) r.lowArmed = true;
  }

  devTeleport(pid: number, x: number, y: number, z: number, yaw?: number): void {
    this.runners[pid]?.teleport(x, y, z, yaw);
  }

  // ── internals ─────────────────────────────────────────────────────────────────────────────

  private frozen(r: Runner, src: PlayerIntent | null | undefined): PlayerIntent {
    const n = this.neutral;
    n.moveX = 0; n.moveZ = 0; n.jump = false; n.fire = false; n.slick = false; n.sub = false; n.special = false;
    if (src) {
      n.yaw = src.yaw; n.pitch = src.pitch; n.hasAim = src.hasAim; n.aimX = src.aimX; n.aimY = src.aimY; n.aimZ = src.aimZ;
    } else {
      n.yaw = r.aimYaw; n.pitch = r.aimPitch; n.hasAim = false;
    }
    return n;
  }

  private wash(v: Runner, by: number | null, cause: 'dye' | 'sea' | 'sub' | 'special'): void {
    if (!v.alive) return;
    if (this.washout && cause === 'sea' && by === null) {
      // CHANGED(WASHOUT): the sea credits the last foe who damaged the victim within seaCreditS (nobody otherwise)
      const lb = v.lastHitBy;
      if (lb >= 0 && lb < this.runners.length && this.runners[lb].team !== v.team && v.lastHitT <= WASHOUT.seaCreditS + 1e-6) by = lb;
    }
    if (this.spawnRng !== null) {
      // CHANGED(SPAWNS): FFA — who washed this runner, for its respawn choice (safeKiller): the credited washer, else (a
      // TURF sea wash) the last foe that hit it inside the sea-credit window; nobody otherwise
      const lb = v.lastHitBy;
      this.killer[v.id] = by !== null ? by
        : lb >= 0 && lb < this.runners.length && this.runners[lb].team !== v.team && v.lastHitT <= WASHOUT.seaCreditS + 1e-6 ? lb : -1;
    }
    v.alive = false;
    v.hp = 0;
    v.firing = false;
    v.hidden = false;
    v.washedCount++;
    const i = v.id;
    // CHANGED(WASHOUT): a wash ends spawn protection (only the sea can wash a protected runner): a dead runner is never
    // shown PROTECTED, and its next respawn grants a fresh window (0 always in TURF: no-op there)
    if (this.protectTicks[i] > 0) this.unprotect(i);
    this.respawnTicks[i] = Math.max(1, Math.round(this.respawnSeconds / TICK));
    v.respawnT = this.respawnTicks[i] * TICK;
    v.special *= this.specialPts.keep;
    if (v.special < 1) v.specialReady = false;
    resetKit(v, this);
    this.stats.washes++;
    if (cause === 'sea') this.stats.seaWashes++;
    this.pushEvent({ t: 'washed', victim: v.id, by, cause });
    if (by !== null && by >= 0 && by < this.runners.length) {
      const a = this.runners[by];
      if (this.washout) {
        // CHANGED(WASHOUT): one point for the washer's crew — its 'score' event right after this 'washed' event (before the
        // wash burst's 'splat' / a 'special' ready); the limit ends the match at the end of this tick
        const s = ++this.scoreArr[a.team];
        this.pushEvent({ t: 'score', crew: a.team, score: s, pid: by });
        if (this.limit > 0 && s >= this.limit) this.limitHit = true;
      }
      a.washes++;
      this.addSpecial(a, this.specialPts.perWash);
      if (cause !== 'sea') {
        this.paint(by, a.team, v.x, v.y + 0.05, v.z, HITBOX.washBurstRadius, 0, 1, 0, 0.3, hash32(this.seedWord, v.id, 0xb057 + this.tick));
      }
    }
  }

  /** CHANGED(WASHOUT): end runner `pid`'s spawn protection now (an action, damage dealt, a wash); never called in TEAMS TURF */
  private unprotect(pid: number): void {
    this.protectTicks[pid] = 0;
    this.runners[pid].protectedT = 0;
  }

  private respawnRunner(r: Runner): void {
    let site = -1;
    if (this.spawnRng !== null && this.spawnSites.length > 0) {
      // CHANGED(SPAWNS): FFA — a random safe site (chooseSite); spawnFor() now answers it
      site = this.chooseSite(r);
      this.slots[r.id] = { ...this.spawnSites[site] };
      for (let k = MATCH_FFA.recent - 1; k > 0; k--) this.siteHist[r.id * MATCH_FFA.recent + k] = this.siteHist[r.id * MATCH_FFA.recent + k - 1];
      this.siteHist[r.id * MATCH_FFA.recent] = site;
      r.spawnSite = site;
      this.stats.spawns++;
    }
    r.respawn(this.slots[r.id]);
    this.respawnTicks[r.id] = 0;
    if (this.protect) {
      // CHANGED(WASHOUT): spawn protection for protectS (whole ticks, counted down in step 5 from this tick on).
      // CHANGED(SPAWNS): WASHOUT (both modes) and FFA (both rules)
      this.protectTicks[r.id] = Math.max(1, Math.round(WASHOUT.protectS / TICK));
      r.protectedT = this.protectTicks[r.id] * TICK;
    }
    this.pushEvent({ t: 'respawn', pid: r.id });
    if (site >= 0) this.pushSpawnEvent(r);
  }

  /** CHANGED(SPAWNS): the 'spawn' event of runner r at its current site (its position and facing right after the spawn) */
  private pushSpawnEvent(r: Runner): void {
    this.pushEvent({ t: 'spawn', pid: r.id, site: r.spawnSite, x: r.x, y: r.y, z: r.z, yaw: r.yaw });
  }

  /** CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S2): the respawn site of FFA runner r (dead, its timer just ran out). Candidates:
   *  no living runner within siteClear m, not one of r's last `recent` sites (if that leaves none, recent sites are
   *  allowed; if every site has a runner within siteClear m, the site farthest from any runner — never the case with 8
   *  runners on a 16–24 pool). Safe: unseen (siteSeen) && nearest living foe ≥ safeFoe && the killer (alive) ≥ safeKiller.
   *  Fewer than fallbackN safe → the fallbackN best by nearest-foe distance (descending, then lower index) among the UNSEEN
   *  candidates, or among all of them when none is unseen ("seen ones last", strictly). One uniform draw from spawnRng
   *  picks the site (every call draws exactly once). */
  private chooseSite(r: Runner): number {
    const S = this.spawnSites, R = this.runners, F = MATCH_FFA, m = S.length;
    const rnd = this.spawnRng!;
    const h0 = r.id * F.recent;
    const kid = this.killer[r.id];
    const killer = kid >= 0 && kid < R.length && kid !== r.id && R[kid].alive ? R[kid] : null;
    const cand = this.siteCand;
    cand.length = 0;
    for (let pass = 0; pass < 2 && cand.length === 0; pass++) {
      for (let i = 0; i < m; i++) {
        if (pass === 0) {
          let recent = false;
          for (let k = 0; k < F.recent; k++) if (this.siteHist[h0 + k] === i) recent = true;
          if (recent) continue;
        }
        if (this.nearestRunner(S[i], r, false) < F.siteClear) continue;
        cand.push(i);
      }
    }
    if (cand.length === 0) {
      let best = 0, bd = -1;
      for (let i = 0; i < m; i++) { const d = this.nearestRunner(S[i], r, false); if (d > bd) { bd = d; best = i; } }
      this.stats.spawnFallbacks++;
      rnd();                                                         // one draw per choice, always
      return best;
    }
    const safe = this.siteSafe;
    safe.length = 0;
    let unseenN = 0;
    for (const i of cand) {
      const p = S[i];
      const dmin = this.nearestRunner(p, r, true);
      const seen = this.siteSeen(p, r);
      const nk = killer ? Math.hypot(killer.x - p.x, killer.y - p.y, killer.z - p.z) : Infinity;
      this.siteDmin[i] = dmin;
      this.siteSeenBy[i] = seen ? 1 : 0;
      if (!seen) unseenN++;
      if (!seen && dmin >= F.safeFoe && nk >= F.safeKiller) safe.push(i);
    }
    this.stats.spawnCands += cand.length; this.stats.spawnUnseenCands += unseenN; this.stats.spawnSafeCands += safe.length;
    if (unseenN === 0) this.stats.spawnNoUnseen++;
    let set: number[] = safe;
    if (safe.length < F.fallbackN) {
      // the S2 fallback — "the fallbackN best by dmin, with seen ones last" — in its strict form: while any candidate is
      // unseen, the set holds only unseen ones (up to fallbackN, by nearest-foe distance); a seen site is drawn only when
      // no candidate is unseen (measured on pier18: a set topped up with seen sites put 43–50 % of respawns in view)
      const from = unseenN > 0 ? cand.filter((i) => this.siteSeenBy[i] === 0) : cand;
      set = from.sort((a, b) => (this.siteDmin[b] - this.siteDmin[a]) || (a - b)).slice(0, F.fallbackN);
      this.stats.spawnFallbacks++;
    }
    return set[Math.min(set.length - 1, Math.floor(rnd() * set.length))];
  }

  /** CHANGED(SPAWNS): the 3-D distance from site p to the nearest living runner other than `me` (foesOnly: other crews) */
  private nearestRunner(p: SpawnPoint, me: Runner, foesOnly: boolean): number {
    let best = Infinity;
    for (const o of this.runners) {
      if (o === me || !o.alive || (foesOnly && o.team === me.team)) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y, o.z - p.z);
      if (d < best) best = d;
    }
    return best;
  }

  /** CHANGED(SPAWNS): does a living foe of `me` see the chest point of a runner standing at site p? The canSee ray (from
   *  the foe's eye — its slick eye height in slick form — to the chest, blocked by map collision short of it), for foes
   *  within seeRange of it. The chest is where canSee aims at the respawned runner: its feet sit MOVE.skin over the site
   *  (Runner.respawn), + half the TALL hit height. No mist rule (skeptic fix 2026-09-30): canSee's mist hides only SLICK
   *  targets, and a freshly respawned runner is tall, so a foe inside the mist range but beyond hideRange does see it. */
  private siteSeen(p: SpawnPoint, me: Runner): boolean {
    const ty = p.y + MOVE.skin + HITBOX.height * 0.5;
    for (const o of this.runners) {
      if (o === me || !o.alive || o.team === me.team) continue;
      const ey = o.y + (o.slickForm ? COMBAT.slickEyeHeight : COMBAT.eyeHeight);
      const dx = p.x - o.x, dy = ty - ey, dz = p.z - o.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > MATCH_FFA.seeRange) continue;
      if (d < 1e-3) return true;
      const hit = this.physics.raycast(o.x, ey, o.z, dx, dy, dz, d);
      if (!hit || hit.toi >= d - 0.25) return true;
    }
    return false;
  }

  /** register a projectile variant once per key; returns its index */
  private variant(key: string, k: ProjectileKind): number {
    const hit = this.variantKey.get(key);
    if (hit !== undefined) return hit;
    const i = this.kinds.length;
    if (i > 255) throw new Error('MatchWorld: more than 256 projectile variants');
    this.kinds.push(k);
    this.variantBurst[i] = null; this.variantJelly[i] = null; this.variantCloud[i] = null;
    this.variantKey.set(key, i);
    return i;
  }

  /** credit newly dyed weighted m² to `owner` (painted + special meter) */
  private credit(owner: number, gained: number): void {
    if (owner >= 0 && owner < this.runners.length && gained > 0) {
      const o = this.runners[owner];
      o.painted += gained;
      this.addSpecial(o, gained * this.specialPts.perM2);
    }
  }

  /** tick the resting slots: jelly puddles (fuse → pop) and CLOUDBURST cells (rise → rain → end) */
  private stepResting(): void {
    const P = this.projectiles;
    let i = 0;
    while (i < P.count) {
      const st = P.state[i];
      if (st === PSTATE_FLY) { i++; continue; }
      P.px[i] = P.x[i]; P.py[i] = P.y[i]; P.pz[i] = P.z[i];
      const v = P.variant[i];
      let done: boolean;
      if (st === PSTATE_PUDDLE) {
        const j = this.variantJelly[v];
        done = j ? tickPuddle(i, j, this) : true;
      } else {
        const c = this.variantCloud[v];
        done = c ? tickCloud(i, c, this) : true;
        if (!c) this.lost(i);
      }
      if (done) P.remove(i); else i++;
    }
  }

  /** the WELLSPRING slam of a leaper that landed (or gave up) */
  private doSlam(r: Runner): void {
    const sp = this.specialDefs[r.id];
    if (sp && sp.type === 'wellspring') { slam(r, sp, this); return; }
    r.leaping = false; r.slamPending = false;
    endSpecial(r, r.x, r.y, r.z, this);
  }

  private addSpecial(r: Runner, points: number): void {
    if (!(points > 0)) return;
    if (r.specialActive !== '') return;                               // no charge while the special runs
    const c = this.charge[r.id] || 190;
    r.special = Math.min(1, r.special + points / c);
    if (r.special >= 1 && !r.specialReady) {
      r.specialReady = true;
      this.pushEvent({ t: 'special', pid: r.id, id: this.specialId[r.id], phase: 'ready', x: r.x, y: r.y, z: r.z });
    }
  }

  private end(by: 'horn' | 'limit' = 'horn'): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.timeLeft = 0;
    this.endedBy = by;                                                // CHANGED(WASHOUT)
    for (let i = 0; i < this.protectTicks.length; i++) {
      if (this.protectTicks[i] > 0) { this.protectTicks[i] = 0; this.runners[i].protectedT = 0; }   // WASHOUT: none after the horn
    }
    this.result = this.computeResult();
    this.projectiles.clear();
    // the horn freezes the court: no firing, no coasting (gravity still lands anyone airborne); running
    // specials end, kits reset, a leaper falls with normal gravity and never slams
    for (const r of this.runners) {
      if (r.specialActive !== '') endSpecial(r, r.x, r.y, r.z, this);
      resetKit(r, this);
      r.leaping = false; r.slamPending = false;
      r.firing = false; r.vx = 0; r.vz = 0;
      r.courtFrozen = true;   // no conveyor carry / spring launch after the horn (was: belts kept carrying runners)
    }
    this.pushEvent({ t: 'horn', kind: 'end' });
    this.pushEvent({ t: 'phase', phase: 'ended' });
  }

  /** CHANGED(CORE): the result at the horn — teams exactly as before (+ shares / standings / tied), FFA per crew */
  private computeResult(): MatchResult {
    const c = this.painter.coverage();
    const shares: number[] = [];
    let winner: TeamId;
    let tied: TeamId[] = [];
    if (this.mode === 'ffa') {
      const by = this.painter.coverageByTeam();
      for (let k = 0; k < by.length; k++) shares.push(by[k]);
      let best = -Infinity;
      for (const k of this.crews) {
        const v = shares[k];
        if (v > best) { best = v; tied = [k]; } else if (v === best) tied.push(k);
      }
      winner = tied.length === 1 ? tied[0] : 0;
      if (tied.length === 1) tied = [];
    } else {
      for (let k = 0; k < 9; k++) shares.push(0);
      shares[0] = c.neutral; shares[1] = c.sun; shares[2] = c.gulf;
      winner = c.sun > c.gulf ? 1 : c.gulf > c.sun ? 2 : 0;
      if (winner === 0) tied = [1, 2];
    }
    const ffa = this.mode === 'ffa';
    // CHANGED(WASHOUT): per-crew washes (credited) / washed (every cause) in both rules; scores (0 in TURF)
    const washesBy = new Array<number>(CREW_SLOTS).fill(0), washedBy = new Array<number>(CREW_SLOTS).fill(0);
    for (const r of this.runners) {
      if (r.team < 0 || r.team >= CREW_SLOTS) continue;
      washesBy[r.team] += r.washes; washedBy[r.team] += r.washedCount;
    }
    const scores = this.scoreArr.slice();
    const standings: CrewStanding[] = this.crews.map((k) => {
      const owner = this.runners.find((r) => r.team === k);
      const name = ffa ? (owner?.name ?? `CREW ${k}`) : teamById(k).name;
      return { crew: k, share: shares[k], rank: 1, pid: owner ? owner.id : -1, name, washes: washesBy[k], washed: washedBy[k], score: scores[k] };
    });
    if (this.washout) {
      // WASHOUT: score, then (FFA) fewer washed, then share; crews equal on all of them are tied (winner 0 = a draw)
      const key = (a: CrewStanding, b: CrewStanding): number => (b.score - a.score) || (ffa ? a.washed - b.washed : 0) || (b.share - a.share);
      standings.sort((a, b) => key(a, b) || (a.crew - b.crew));
      for (const s of standings) s.rank = 1 + standings.filter((o) => key(o, s) < 0).length;
      const top = standings.filter((s) => s.rank === 1).map((s) => s.crew).sort((a, b) => a - b);
      winner = top.length === 1 ? top[0] : 0;
      tied = top.length === 1 ? [] : top;
    } else {
      standings.sort((a, b) => (b.share - a.share) || (a.crew - b.crew));
      for (const s of standings) s.rank = 1 + standings.filter((o) => o.share > s.share).length;
    }
    return {
      sun: ffa ? shares[1] : c.sun, gulf: ffa ? shares[2] : c.gulf, neutral: ffa ? shares[0] : c.neutral,
      winner, mode: this.mode, shares, standings, tied,
      rule: this.rule, scores, limit: this.limit, endedBy: this.endedBy ?? 'horn',
    };
  }

  private pushEvent(e: SimEvent): void {
    this.events.push(e);
  }

  private capEvents(): void {
    const over = this.events.length - MATCH.eventCap;
    if (over > 0) { this.events.splice(0, over); this.stats.eventsDropped += over; }
  }
}
