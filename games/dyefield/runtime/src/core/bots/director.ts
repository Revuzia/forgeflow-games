// DYEFIELD — bot director + brains (CONTRACT §10.2 / §10.3 / §10.5). THREE-free, DOM-free, deterministic.
//
// BotDirector.think(intents) fills intents[i] for every bot runner, every tick, before world.step().
// Each brain has two layers:
//   * DECIDE (~10 Hz, staggered by id): perception (world.canSee), target choice with a reaction delay
//     rolled ONCE per stimulus and latched (doctrine §2), mode choice, goal choice, path planning,
//     string-pulling, stuck recovery, paint-target choice.
//   * CONTROL (every tick): path following (walk / drop / jump / wall-slick climb), a rate-limited
//     aim that eases toward its goal (no snapping, no jitter), smooth low-amplitude aim noise scaled by
//     skill, fire discipline (never into a teammate, never dry), slick travel through own dye.
//
// Modes:
//   PAINT   paint-hungry goal selection: the map is cut into 4 m zones of floor texels (atlas samples);
//           a zone's worth = its un-owned area (enemy dye counts 1.5×); a weighted random pick from the
//           bot's own mulberry32 stream among the best-scoring zones (travel time, crowding by allies'
//           goals, the enemy pad). Sweeps fire over non-own floor texels while moving.
//   FIGHT   a visible enemy in range: ballistic aim (straight flight, then gravity + drag, solved per
//           tick) with lead and jitter by skill; strafes (direction held 0.4–1.1 s, never off a ledge);
//           holds a 5–8.5 m band.
//   COVER   a visible enemy out of range: hold a node that breaks line of sight, peek out now and then.
//   CHASE   hit by an unseen attacker: go where the dye came from for ~2 s, then give up.
//   REFILL  tank < 20 % (or losing a duel): run to the nearest own dye / own pad, slick, drink to ~95 %.
// SLICK travel: whenever the bot is not firing and the floor under and ahead of it is own dye.
// Paths cost enemy dye 2.3× (slog), own dye 0.7× (slick), and avoid the enemy pad.
//
// Kits (CONTRACT_P6_11 §18.1 "Bots use their kit", lane BOTKITS; numbers in bots/tactics.ts): MIST-RASP keeps the
// phase-5 brain above unchanged. SHEET-DRUM rolls un-owned floor (fire held while moving), rolls through close
// foes to flatten them and flicks (a tap) at 3–7 m. NEEDLE-GLINT picks goals with long sightlines over un-owned
// floor, line-paints far floor while idle, charges on a visible enemy (full beyond 12 m) and backs off inside
// 6 m. POP-WELL holds 5–9 m, leads with the burst's flight time, aims low, and airbursts round the corner a
// target just ducked behind. Everyone throws JELLY CHARGE (tank ≥ 90) at clusters / behind cover / into enemy
// dye gaps, and uses the special when ≥ 2 enemies sit in its area or enemy turf waits to be reclaimed. Those
// sub / special opportunities are stimuli too: a reaction rolled once per opportunity (own mulberry32 stream,
// so a MIST-RASP bot's phase-5 rolls are untouched until it actually throws).

import type { PlayerIntent, TeamId } from '../types.ts';
import type { MatchWorld } from '../match/world.ts';
import type { Runner } from '../runner.ts';
import type { BotSkill } from '../match/roster.ts';
import type { NavGraph } from './nav.ts';
import { EDGE_CLIMB, EDGE_JUMP, EDGE_WALK } from './nav.ts';
import { hash32, mulberry32 } from '../rng.ts';
import { COMBAT, HITBOX, KITS, MOVE, TANK, TICK } from '../config.ts';
import { kitDef, kitFire, streamFire, type KitFire, type StreamFire } from '../combat/kits.ts';
import { jellyDef, specialDef, type JellyDef, type SpecialDef } from '../combat/defs.ts';
import {
  BURST_MAX, BURST_MIN, CLUSTER, FLICK_MAX, FLICK_MIN, FLICK_TAP_TICKS, LINE_MAX, LINE_MIN, LINE_TANK, RETREAT, ROLL_AMBUSH,
  ROLL_CLOSE, SUB_REACH, SUB_TANK, CHARGE_SETTLE, chargeCap, chargeNeed, kitTactic, lineNeed, type KitKind,
} from './tactics.ts';

// ───────────────────────────── skill ─────────────────────────────
interface SkillProfile {
  reactMin: number; reactMax: number;  // s, rolled once per stimulus
  jitter: number;                      // rad amplitude of the aim noise vs runners (0.018 × factor)
  turnRate: number;                    // rad/s max aim slew
  turnAccel: number;                   // rad/s² max aim acceleration (inertia: no instant reversals)
  aimEase: number;                     // 1/s exponential aim convergence
  lead: number;                        // 0..1 of the target's velocity × flight time
  engage: number;                      // m: open fire at an enemy within this range
  fireCone: number;                    // rad: aim error allowed before shooting at a runner
  coverBias: number;                   // chance (rolled per stimulus) to hold cover vs an out-of-range enemy
  retreatHp: number;                   // hp under which a bot losing a duel slicks away (0 = never)
  strafe: number;                      // 0..1 strafe intensity
}

const SKILLS: Record<BotSkill, SkillProfile> = {
  chill: { reactMin: 0.62, reactMax: 0.8, jitter: 0.018 * 2.4, turnRate: 4.5, turnAccel: 28, aimEase: 7, lead: 0.25, engage: 9.0, fireCone: 0.13, coverBias: 0.35, retreatHp: 0, strafe: 0.5 },
  fresh: { reactMin: 0.45, reactMax: 0.62, jitter: 0.018 * 1.6, turnRate: 6.5, turnAccel: 42, aimEase: 10, lead: 0.6, engage: 10.0, fireCone: 0.1, coverBias: 0.55, retreatHp: 30, strafe: 0.8 },
  fierce: { reactMin: 0.3, reactMax: 0.42, jitter: 0.018, turnRate: 9, turnAccel: 60, aimEase: 14, lead: 0.9, engage: 10.8, fireCone: 0.08, coverBias: 0.7, retreatHp: 38, strafe: 1.0 },
};

const THINK_EVERY = 6;          // ticks between decisions (10 Hz)
const ZONE = 4;                 // m, zone cell
const ZONE_SAMPLES = 48;        // atlas samples per zone
const REFILL_TO = 95;
const CHASE_S = 2.0;
const PAINT_MIN = 2.2, PAINT_MAX = 9.5, PAINT_BEST = 6.2;
// a paint burst lasts ≥ 0.35 s (a stripe, not a flicker)
const BURST_MIN_TICKS = 21;

type Mode = 'wait' | 'dead' | 'paint' | 'fight' | 'cover' | 'chase' | 'refill';

interface Zone {
  cx: number; cy: number; cz: number;   // centroid
  ix: number; iz: number;               // 4 m cell
  node: number;                         // a nav node inside it
  area: number;                         // m² of floor
  samples: Int32Array;                  // atlas texel ids (floor)
  need: [number, number, number];       // per viewing team: un-owned share (enemy dye counts 1.5×), 0..1.5
  enemyShare: [number, number, number];
  band: number;                         // level band (LEVEL_BAND m slices above the lowest zone)
}

// Levels (Lockwell's mezzanine + crane walk, Cinder's wreck deck): zones are banded by height; a band with
// ≥ LEVEL_MIN_AREA m² of floor is a level. Travel time dominates goal choice, so without a pull an upper
// floor reached by stairs / a belt stayed 96–100 % neutral all match (measured: 0.9 % of live time above
// y 3 on Lockwell). A level whose un-owned share beats the bot's own level by > LEVEL_ADV pulls its zones up
// by LEVEL_PULL × the advantage, shared among the allies already there or headed there.
const LEVEL_BAND = 3;
const LEVEL_MIN_AREA = 80;
const LEVEL_ADV = 0.15;
const LEVEL_PULL = 6;

const TAU = Math.PI * 2;
function wrap(a: number): number { a %= TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; }
function adelta(a: number, b: number): number { return wrap(b - a); }
function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
function smoothstep(t: number): number { return t * t * (3 - 2 * t); }

// ───────────────────────────── ballistics (combat/projectiles.ts flight model) ─────────────────────────────
interface Ballistic { v: number; t0: number; g: number; drag: number }
function ballisticOf(f: StreamFire): Ballistic {
  const straight = f.projectileSpeed * f.straightTime;
  return { v: f.projectileSpeed, t0: f.straightTime, g: f.gravity, drag: f.projectileSpeed / Math.max(0.5, f.maxRange - straight) };
}
/** height gained at horizontal distance D for pitch p (−Infinity if out of reach); flight time in out[0] */
function heightAt(b: Ballistic, p: number, D: number, out: number[]): number {
  const vh = b.v * Math.cos(p), vv = b.v * Math.sin(p);
  const s0 = vh * b.t0;
  if (D <= s0) { const t = D / Math.max(1e-6, vh); out[0] = t; return vv * t; }
  const q = 1 - (D - s0) * b.drag / Math.max(1e-6, vh);
  if (q <= 0.03) { out[0] = 9; return -Infinity; }
  const t2 = -Math.log(q) / b.drag;
  out[0] = b.t0 + t2;
  return vv * (b.t0 + t2) - 0.5 * b.g * t2 * t2;
}
/** pitch that puts the droplet through (D, H) relative to the muzzle; out[0] = flight time; out[1] = 1 if reachable */
function solvePitch(b: Ballistic, D: number, H: number, out: number[]): number {
  let lo = -1.3, hi = 0.62;
  const tmp = [0];
  if (heightAt(b, hi, D, tmp) < H) { out[0] = tmp[0]; out[1] = 0; return hi; }
  if (heightAt(b, lo, D, tmp) > H) { out[0] = tmp[0]; out[1] = 1; return lo; }
  for (let i = 0; i < 18; i++) {
    const m = 0.5 * (lo + hi);
    if (heightAt(b, m, D, tmp) < H) lo = m; else hi = m;
  }
  heightAt(b, hi, D, tmp);
  out[0] = tmp[0]; out[1] = 1;
  return hi;
}

// ───────────────────────────── one brain ─────────────────────────────
class Brain {
  readonly id: number;
  readonly r: Runner;
  readonly own: TeamId;
  readonly enemy: TeamId;
  readonly sk: SkillProfile;
  readonly rnd: () => number;
  readonly fire: StreamFire;
  readonly bal: Ballistic;
  readonly phase: number;          // think stagger

  mode: Mode = 'wait';
  holding = false;
  // perception
  target = -1;
  reactAt = 0;                     // tick when the current stimulus has been reacted to
  lostT = 0;
  lastSeenX = 0; lastSeenY = 0; lastSeenZ = 0;
  coverRolled = false; coverWanted = false; retreatRolled = false; retreatWanted = false;
  // hits
  seenHitT = 1e9;
  chaseUntil = 0; chaseId = -1; chaseX = 0; chaseY = 0; chaseZ = 0; hitReactAt = 0;
  // goals / paths
  goalZone = -1;
  goalNode = -1;
  goalSince = 0;
  wanders = 0;
  path: number[] = [];
  pathEdge: number[] = [];
  pk = 0;
  planAt = -1e9;
  jumpDone = false;
  jumpTries = 0;
  climbPhase = 0; climbT = 0; climbEdge = -1;
  blocked: number[] = [];          // edge ids
  blockedUntil: number[] = [];
  // refill
  refillX = 0; refillY = 0; refillZ = 0; refillNode = -1; refillHasSpot = false; refillStart = 0; refillTries = 0; refillOnPad = false;
  // cover
  coverNode = -1; peekNode = -1; coverUntil = 0; peekPhase = 0; peekT = 0; coverCd = 0;
  // fight movement
  strafeSign = 1; strafeT = 0;
  // aim
  aimYaw = 0; aimPitch = 0; desYaw = 0; desPitch = 0; aimDist = 8;
  aimVy = 0; aimVp = 0;               // aim angular velocity (rad/s)
  fireOn = false; fireSince = 0;      // fire hysteresis
  seenRespawns = 0;
  hasPaintTarget = false; ptx = 0; pty = 0; ptz = 0; paintRetargetAt = 0;
  ptId = -1; ptNext: number[] = [-1, -1];   // current target texel + the runners-up of the last scan
  jA = [0, 0]; jB = [0, 0]; jT = 0; jPeriod = 0.35;
  // movement (smoothed world direction)
  mvx = 0; mvz = 0;
  // slick travel hysteresis
  slickTravel = false; slickMin = 0; slickCd = 0; slickSince = 0;
  ownAhead = false; ownAheadTick = -1000;
  // stuck
  hx: number[] = [0, 0, 0, 0, 0]; hz: number[] = [0, 0, 0, 0, 0]; hy: number[] = [0, 0, 0, 0, 0]; hMove: number[] = [0, 0, 0, 0, 0]; hn = 0;
  stuckLevel = 0; nudgeUntil = 0; nudgeX = 0; nudgeZ = 0;
  idleT = 0; idleResets = 0;
  wantMoveAcc = 0;
  // ── kit (lane BOTKITS) ──
  readonly kf: KitFire;
  readonly kind: KitKind;
  readonly engage: number;          // m: fight within this (MIST: the skill's engage, as in phase 5)
  readonly ink: number;             // tank one useful shot needs (MIST: tankPerShot)
  readonly jelly: JellyDef | null;
  readonly spec: SpecialDef | null;
  readonly trnd: () => number;      // tactic stream (sub / special reactions)
  seen: number[] = [];              // enemies seen at the last decide
  // SHEET-DRUM
  tapLeft = 0; flickNextAt = 0; rollCharge = false; rollChargeUntil = 0;
  rollWant = false; rollCheckTick = -1000; rollOn = false; rollSince = 0; pressAt = -1000; tapPress = false;
  // NEEDLE-GLINT
  chHeld = false; chReadyT = 0; chRelAt = -1000; chOnT = 0;
  readonly settle: number;          // ticks a NEEDLE-GLINT holds the aim on a runner before releasing (by skill)
  lineOk = false; lx = 0; ly = 0; lz = 0; lineRetargetAt = 0;
  // POP-WELL corner airburst
  cornerOk = false; cornerYaw = 0; cornerPitch = 0; cornerDist = 8;
  // sub / special: 0 none, 1 sub, 2 special
  tacKind = 0; tacKey = -1; tacReactAt = 0; tacUntil = 0; tacCount = 0; tacX = 0; tacY = 0; tacZ = 0; tacGap = false;
  gapCd = 0; readySince = -1;
  // extra cost closure
  readonly edgeExtra: (e: number) => number;

  constructor(dir: BotDirector, r: Runner, skill: BotSkill, seed: number) {
    this.id = r.id;
    this.r = r;
    this.own = r.team;
    this.enemy = r.team === 1 ? 2 : 1;
    this.sk = SKILLS[skill] ?? SKILLS.fresh;
    this.rnd = mulberry32(hash32(seed, r.id, 0xb0751));
    this.fire = streamFire(r.kit);
    this.bal = ballisticOf(this.fire);
    this.kf = kitFire(r.kit);
    const kt = kitTactic(this.kf, SKILLS[skill] ? skill : 'fresh', this.sk.engage);
    this.kind = kt.kind; this.engage = kt.engage; this.ink = kt.ink;
    this.settle = Math.round(CHARGE_SETTLE[SKILLS[skill] ? skill : 'fresh'] / TICK);
    let subId = 'jelly-charge', spId = 'cloudburst';
    try { const row = kitDef(r.kit); subId = String(row.sub); spId = String(row.special); } catch { /* unknown kit → MIST-RASP's */ }
    this.jelly = jellyDef(subId);
    this.spec = specialDef(spId);
    this.trnd = mulberry32(hash32(seed, r.id, 0x7ac71c5));
    this.phase = (r.id * 5) % THINK_EVERY;
    this.aimYaw = r.yaw; this.desYaw = r.yaw;
    this.seenRespawns = r.respawns;
    const nav = dir.nav;
    this.edgeExtra = (e: number): number => {
      for (let i = 0; i < this.blocked.length; i++) if (this.blocked[i] === e) return Infinity;
      const v = nav.edgeTo[e];
      let extra = 0;
      const tid = dir.nodeTexel[v];
      let m = 1;
      if (tid >= 0) {
        const t = dir.atlasTeam[tid];
        if (t === this.enemy) m = 2.3; else if (t === this.own) m = 0.7;
      } else if (dir.nodePad[v] === this.own) m = 0.7;
      extra += nav.edgeCost[e] * (m - 1);
      if (dir.nodePad[v] === this.enemy) extra += 80;
      if (nav.edgeKind[e] === EDGE_CLIMB) {
        const own = dir.climbOwned(nav.edgeClimb[e], this.own);
        if (!own) {
          if (this.r.tank < 35) return Infinity;
          extra += 3;
        }
      }
      return extra;
    };
  }
}

/** nav graph (one per map, reused across matches) → zone sightlines (BotDirector.buildZoneVis) */
const ZONE_VIS_CACHE = new WeakMap<NavGraph, Int32Array[]>();

// ───────────────────────────── the director ─────────────────────────────
export class BotDirector {
  readonly world: MatchWorld;
  readonly nav: NavGraph;
  readonly seed: number;
  /** nav node → atlas floor texel under it (−1: none, e.g. a spawn pad) */
  readonly nodeTexel: Int32Array;
  /** nav node → team whose pad it lies on (0 none) */
  readonly nodePad: Uint8Array;
  readonly atlasTeam: Uint8Array;
  /** nav node → 1 when it can reach spawn A and be reached from it (goals must be in this set) */
  readonly nodeMain: Uint8Array;
  private readonly brains: Array<Brain | null> = [];
  private readonly zones: Zone[] = [];
  private readonly zoneGrid = new Map<number, number[]>();   // (ix, iz) → zone indices
  private zoneStamp = -1;
  // node buckets (2 m) for radius queries
  private readonly nbOx: number; private readonly nbOz: number; private readonly nbW: number; private readonly nbH: number;
  private readonly nbStart: Int32Array; private readonly nbItems: Int32Array;
  private readonly tmp2 = [0, 0];
  private readonly topId = new Int32Array(3);
  private readonly topS = new Float64Array(3);
  /** the line between the two pads (mid court) and the half-width of the contested band */
  private readonly midZ: number;
  private readonly midBand: number;
  private readonly scratch: number[] = [];
  private readonly pullBuf: number[] = [];
  /** zone → zones seen from it (eye height → floor) LINE_MIN..LINE_MAX m away (built only when a charger plays) */
  private zoneVis: Int32Array[] = [];
  /** radius → zone → zones whose centroid lies within that radius on the same level (special reclaim areas) */
  private readonly zoneNearBy = new Map<number, Int32Array[]>();
  /** lowest zone floor (perch height reference) */
  private floorY0 = 0;
  /** level bands: floor m² per band, and per team the un-owned share of each band (updateZones) */
  private bandArea: number[] = [];
  private readonly bandOpen: [number[], number[], number[]] = [[], [], []];
  private bandY0 = 0;
  private readonly mv = { x: 0, z: 0, s: 0 };
  private readonly opp = { key: -1, kind: 0, x: 0, y: 0, z: 0, gap: false };

  constructor(world: MatchWorld, nav: NavGraph, seed: number, skill: BotSkill | readonly BotSkill[] = 'fresh') {
    this.world = world;
    this.nav = nav;
    this.seed = seed | 0;
    const P = world.painter;
    const A = P.atlas;
    this.atlasTeam = A.team;

    // nav node → texel under it, pad membership
    this.nodeTexel = new Int32Array(nav.nodes).fill(-1);
    this.nodePad = new Uint8Array(nav.nodes);
    const pads = world.pads;
    for (let n = 0; n < nav.nodes; n++) {
      const x = nav.x[n], y = nav.y[n], z = nav.z[n];
      const s = P.surfaceAt(x, y + 0.02, z, 0.6, 'floor');
      if (s && Math.abs(s.y - y) < 0.3) this.nodeTexel[n] = s.id;
      for (const side of ['A', 'B'] as const) {
        const p = pads[side];
        if ((x - p.x) ** 2 + (z - p.z) ** 2 <= (p.r + 0.6) ** 2 && Math.abs(y - p.y) < 0.6) this.nodePad[n] = side === 'A' ? 1 : 2;
      }
    }

    // node buckets
    let mnx = Infinity, mnz = Infinity, mxx = -Infinity, mxz = -Infinity;
    for (let n = 0; n < nav.nodes; n++) { mnx = Math.min(mnx, nav.x[n]); mxx = Math.max(mxx, nav.x[n]); mnz = Math.min(mnz, nav.z[n]); mxz = Math.max(mxz, nav.z[n]); }
    if (!nav.nodes) { mnx = mnz = 0; mxx = mxz = 1; }
    this.nbOx = Math.floor(mnx) - 2; this.nbOz = Math.floor(mnz) - 2;
    this.nbW = Math.ceil((mxx - this.nbOx) / 2) + 2; this.nbH = Math.ceil((mxz - this.nbOz) / 2) + 2;
    const cnt = new Int32Array(this.nbW * this.nbH + 1);
    const cellOf = (x: number, z: number): number => clamp(Math.floor((z - this.nbOz) / 2), 0, this.nbH - 1) * this.nbW + clamp(Math.floor((x - this.nbOx) / 2), 0, this.nbW - 1);
    for (let n = 0; n < nav.nodes; n++) cnt[cellOf(nav.x[n], nav.z[n]) + 1]++;
    for (let i = 1; i < cnt.length; i++) cnt[i] += cnt[i - 1];
    this.nbStart = cnt.slice();
    const fill = cnt.slice(0, this.nbW * this.nbH);
    this.nbItems = new Int32Array(nav.nodes);
    for (let n = 0; n < nav.nodes; n++) this.nbItems[fill[cellOf(nav.x[n], nav.z[n])]++] = n;

    // the strongly connected core around spawn A: forward and reverse reachability
    this.nodeMain = new Uint8Array(nav.nodes);
    const start = nav.nearest(pads.A.x, pads.A.y, pads.A.z);
    if (start >= 0) {
      const fwd = new Uint8Array(nav.nodes), rev = new Uint8Array(nav.nodes);
      const radj: number[][] = Array.from({ length: nav.nodes }, () => []);
      for (let u = 0; u < nav.nodes; u++) for (let e = nav.edgeStart[u]; e < nav.edgeStart[u + 1]; e++) radj[nav.edgeTo[e]].push(u);
      const q: number[] = [start]; fwd[start] = 1;
      for (let h = 0; h < q.length; h++) { const u = q[h]; for (let e = nav.edgeStart[u]; e < nav.edgeStart[u + 1]; e++) { const v = nav.edgeTo[e]; if (!fwd[v]) { fwd[v] = 1; q.push(v); } } }
      q.length = 0; q.push(start); rev[start] = 1;
      for (let h = 0; h < q.length; h++) { const u = q[h]; for (const v of radj[u]) if (!rev[v]) { rev[v] = 1; q.push(v); } }
      for (let n = 0; n < nav.nodes; n++) this.nodeMain[n] = fwd[n] & rev[n];
    } else this.nodeMain.fill(1);

    this.midZ = (pads.A.z + pads.B.z) / 2;
    this.midBand = Math.abs(pads.A.z - pads.B.z) * 0.27;
    this.buildZones();

    const skills: readonly BotSkill[] | null = Array.isArray(skill) ? skill as readonly BotSkill[] : null;
    for (const r of world.runners) {
      if (!r.bot) { this.brains.push(null); continue; }
      const sk: BotSkill = skills ? (skills[r.id] ?? 'fresh') : (skill as BotSkill);
      this.brains.push(new Brain(this, r, sk, this.seed));
    }
    this.floorY0 = this.zones.reduce((m, z) => Math.min(m, z.cy), Infinity);
    if (!Number.isFinite(this.floorY0)) this.floorY0 = 0;
    if (this.brains.some((b) => b !== null && b.kind === 'charge')) this.buildZoneVis();
  }

  /** sightlines between zones (NEEDLE-GLINT goals + line targets): eye at 1.0 m over Z → floor of Y. They depend on
   *  the map only (zones come from its atlas, rays from its collision), so they are built once per nav graph. */
  private buildZoneVis(): void {
    const hit = ZONE_VIS_CACHE.get(this.nav);
    if (hit && hit.length === this.zones.length) { this.zoneVis = hit; return; }
    const Z = this.zones, ph = this.world.physics;
    const out: number[] = [];
    this.zoneVis = Z.map((z, zi) => {
      out.length = 0;
      const ey = z.cy + 1.0;
      for (let yi = 0; yi < Z.length; yi++) {
        if (yi === zi) continue;
        const y = Z[yi];
        const dh = Math.hypot(y.cx - z.cx, y.cz - z.cz);
        if (dh < LINE_MIN || dh > LINE_MAX || y.cy > ey + 1.5 || y.cy < z.cy - 5) continue;
        const dy = y.cy + 0.15 - ey, d = Math.hypot(dh, dy);
        const h = ph.raycast(z.cx, ey, z.cz, y.cx - z.cx, dy, y.cz - z.cz, d);
        if (!h || h.toi >= d - 0.5) out.push(yi);
      }
      return Int32Array.from(out);
    });
    ZONE_VIS_CACHE.set(this.nav, this.zoneVis);
  }

  /** zones whose centroid is within `rad` m (horizontal) of zone zi's, on the same level (±1.5 m); cached per radius */
  private zonesNear(zi: number, rad: number): Int32Array {
    let t = this.zoneNearBy.get(rad);
    if (!t) {
      const Z = this.zones;
      t = Z.map((z) => {
        const l: number[] = [];
        for (let k = 0; k < Z.length; k++) {
          const o = Z[k];
          if (Math.abs(o.cy - z.cy) <= 1.5 && Math.hypot(o.cx - z.cx, o.cz - z.cz) <= rad) l.push(k);
        }
        return Int32Array.from(l);
      });
      this.zoneNearBy.set(rad, t);
    }
    return t[zi];
  }

  /** m² of enemy dye (for `own`) in the zones within `rad` of zone zi (a special's reclaim value) */
  private enemyAreaNear(zi: number, rad: number, own: TeamId): number {
    let a = 0;
    for (const k of this.zonesNear(zi, rad)) { const z = this.zones[k]; a += z.area * z.enemyShare[own]; }
    return a;
  }

  // ── public ──────────────────────────────────────────────────────────────────────────────────

  think(intents: PlayerIntent[]): void {
    const w = this.world;
    if (w.phase === 'live' && w.tick - this.zoneStamp >= 30) this.updateZones();
    for (let i = 0; i < this.brains.length; i++) {
      const b = this.brains[i];
      if (!b || !intents[i]) continue;
      if ((w.tick + b.phase) % THINK_EVERY === 0) this.decide(b);
      this.control(b, intents[i]);
    }
  }

  holding(i: number): boolean { return !!this.brains[i]?.holding; }

  info(i: number): { mode: string; goal: number; target: number; holding: boolean } {
    const b = this.brains[i];
    if (!b) return { mode: 'human', goal: -1, target: -1, holding: false };
    return { mode: b.mode, goal: b.goalNode, target: b.target, holding: b.holding };
  }

  /** is the wall of climb record c dyed `team` along the climb (3 heights)? */
  climbOwned(c: number, team: TeamId): boolean {
    const rec = this.nav.climbs[c];
    if (!rec) return false;
    const P = this.world.painter;
    for (let k = 0; k < 3; k++) {
      const y = rec.y0 + 0.3 + (rec.y1 - rec.y0 - 0.3) * (k / 2);
      const s = P.surfaceAt(rec.cx + rec.nx * 0.02, y, rec.cz + rec.nz * 0.02, 0.5, 'wall');
      if (!s || s.team !== team) return false;
    }
    return true;
  }

  // ── zones (paint-hungry goals) ─────────────────────────────────────────────────────────────

  private buildZones(): void {
    const A = this.world.painter.atlas;
    const nav = this.nav;
    const byKey = new Map<number, number[]>();
    const OX = -200, OZ = -200;
    for (let id = 0; id < A.count; id++) {
      if (!A.floor[id]) continue;
      const ix = Math.floor((A.px[id] - OX) / ZONE), iz = Math.floor((A.pz[id] - OZ) / ZONE);
      const lvl = Math.floor((A.py[id] + 0.5) / 1.0) + 4;
      const key = (lvl * 1000 + iz) * 1000 + ix;
      let l = byKey.get(key);
      if (!l) { l = []; byKey.set(key, l); }
      l.push(id);
    }
    const keys = [...byKey.keys()].sort((a, b) => a - b);
    for (const key of keys) {
      const ids = byKey.get(key)!;
      let area = 0, sx = 0, sy = 0, sz = 0;
      for (const id of ids) { const a = A.area[id]; area += a; sx += A.px[id] * a; sy += A.py[id] * a; sz += A.pz[id] * a; }
      if (area < 1.0) continue;
      const cx = sx / area, cy = sy / area, cz = sz / area;
      let node = nav.nearest(cx, cy, cz);
      if (node < 0 || Math.hypot(nav.x[node] - cx, nav.z[node] - cz) > 3.2 || Math.abs(nav.y[node] - cy) > 1.2) {
        // the centroid may sit on a ramp edge / off the zone: try the member texel nearest the centroid
        let best = -1, bd = Infinity;
        for (const id of ids) { const d = (A.px[id] - cx) ** 2 + (A.pz[id] - cz) ** 2; if (d < bd) { bd = d; best = id; } }
        node = best >= 0 ? nav.nearest(A.px[best], A.py[best], A.pz[best]) : -1;
        if (node < 0 || Math.hypot(nav.x[node] - A.px[best], nav.z[node] - A.pz[best]) > 2.5 || Math.abs(nav.y[node] - A.py[best]) > 1.0) continue;
      }
      if (!this.nodeMain[node]) continue;
      const stride = Math.max(1, Math.ceil(ids.length / ZONE_SAMPLES));
      const samples: number[] = [];
      for (let k = Math.floor(stride / 2); k < ids.length; k += stride) samples.push(ids[k]);
      const ix = Math.floor((cx - OX) / ZONE), iz = Math.floor((cz - OZ) / ZONE);
      const z: Zone = { cx, cy, cz, ix, iz, node, area, samples: Int32Array.from(samples), need: [1, 1, 1], enemyShare: [0, 0, 0], band: 0 };
      const zi = this.zones.length;
      this.zones.push(z);
      const gk = iz * 1000 + ix;
      let g = this.zoneGrid.get(gk);
      if (!g) { g = []; this.zoneGrid.set(gk, g); }
      g.push(zi);
    }
    // level bands
    let y0 = Infinity;
    for (const z of this.zones) y0 = Math.min(y0, z.cy);
    this.bandY0 = Number.isFinite(y0) ? y0 : 0;
    for (const z of this.zones) {
      z.band = this.bandOf(z.cy);
      while (this.bandArea.length <= z.band) this.bandArea.push(0);
      this.bandArea[z.band] += z.area;
    }
    for (const t of [1, 2]) this.bandOpen[t] = this.bandArea.map(() => 1);
  }

  private bandOf(y: number): number { return Math.max(0, Math.floor((y - this.bandY0 + 0.5) / LEVEL_BAND)); }

  private updateZones(): void {
    this.zoneStamp = this.world.tick;
    const T = this.atlasTeam;
    for (const z of this.zones) {
      let n1 = 0, n2 = 0;
      const s = z.samples;
      for (let k = 0; k < s.length; k++) { const t = T[s[k]]; if (t === 1) n1++; else if (t === 2) n2++; }
      const n = s.length || 1;
      const neutral = (n - n1 - n2) / n;
      z.need[1] = neutral + 1.5 * (n2 / n);
      z.need[2] = neutral + 1.5 * (n1 / n);
      z.enemyShare[1] = n2 / n;
      z.enemyShare[2] = n1 / n;
    }
    // per band: the un-owned share of its floor, per team
    const o1 = this.bandOpen[1], o2 = this.bandOpen[2];
    o1.fill(0); o2.fill(0);
    for (const z of this.zones) {
      const neutral = z.need[1] - 1.5 * z.enemyShare[1];
      o1[z.band] += z.area * (neutral + z.enemyShare[1]);
      o2[z.band] += z.area * (neutral + z.enemyShare[2]);
    }
    for (let k = 0; k < this.bandArea.length; k++) { const a = this.bandArea[k] || 1; o1[k] /= a; o2[k] /= a; }
  }

  private zoneAt(x: number, z: number, y: number): number {
    const ix = Math.floor((x + 200) / ZONE), iz = Math.floor((z + 200) / ZONE);
    const l = this.zoneGrid.get(iz * 1000 + ix);
    if (!l) return -1;
    let best = -1, bd = Infinity;
    for (const zi of l) { const d = Math.abs(this.zones[zi].cy - y); if (d < bd) { bd = d; best = zi; } }
    return best;
  }

  // ── DECIDE ──────────────────────────────────────────────────────────────────────────────────

  private decide(b: Brain): void {
    const w = this.world, r = b.r;
    const now = w.tick;
    if (!r.alive) {
      if (b.mode !== 'dead') this.resetBrain(b);
      b.mode = 'dead'; b.holding = false;
      return;
    }
    if (b.mode === 'dead') { b.mode = 'paint'; b.goalZone = -1; b.path.length = 0; }
    if (w.phase !== 'live') { b.mode = 'wait'; b.holding = true; return; }
    if (b.mode === 'wait') b.mode = 'paint';

    // expire blocked edges
    for (let i = b.blocked.length - 1; i >= 0; i--) if (b.blockedUntil[i] <= now) { b.blocked.splice(i, 1); b.blockedUntil.splice(i, 1); }

    this.perceive(b);
    this.trackStuck(b);

    // ── mode selection
    const tgt = b.target >= 0 ? w.runners[b.target] : null;
    const reacted = tgt !== null && now >= b.reactAt;
    const tgtVisible = tgt !== null && b.lostT === 0;
    const dT = tgt ? Math.hypot(tgt.x - r.x, tgt.z - r.z) : Infinity;

    // REFILL below TANK.low exactly (the header's "tank < 20 %"): a +0.5 margin sent painters home at 20.0–20.5,
    // one shot early, so their refill never counted as one from low (the runner's refillsFromLow, a §10.3 gate)
    if (b.mode !== 'refill' && r.tank < TANK.low) this.enterRefill(b);
    if (b.mode === 'refill') {
      if (r.tank >= REFILL_TO) { b.mode = 'paint'; b.goalZone = -1; b.path.length = 0; }
      else if (tgt && reacted && tgtVisible && dT < 6.5 && r.tank >= 45) b.mode = 'fight';
    }
    if (b.mode !== 'refill') {
      if (tgt && reacted && (tgtVisible || b.lostT < 1.2)) {
        // losing a duel at low hp → slick away (rolled once per engagement)
        if (!b.retreatRolled) { b.retreatRolled = true; b.retreatWanted = b.rnd() < 0.6; }
        if (b.sk.retreatHp > 0 && b.retreatWanted && r.hp < b.sk.retreatHp && tgt.hp > r.hp + 10 && dT < b.engage + 2) {
          this.enterRefill(b);
        } else if (dT <= b.engage + 1.5 || !tgtVisible) {
          b.mode = 'fight';
        } else {
          if (!b.coverRolled) { b.coverRolled = true; b.coverWanted = b.rnd() < b.sk.coverBias; }
          if (b.coverWanted && dT <= 24 && now >= b.coverCd && this.planCover(b, tgt)) b.mode = 'cover';
          else if (b.mode === 'cover' && now < b.coverUntil) { /* keep holding */ }
          else b.mode = 'paint';
        }
      } else if (b.mode === 'fight' || b.mode === 'cover') {
        b.mode = 'paint';
      }
      // hit by someone we can't see → react, then chase ~2 s
      if (b.mode !== 'fight') {
        if (r.lastHitT < 0.25 && r.lastAttacker >= 0 && b.seenHitT > 0.25) {
          const a = w.runners[r.lastAttacker];
          if (a && a.alive && a.team !== r.team && b.chaseId !== a.id) {
            b.chaseId = a.id;
            b.hitReactAt = now + Math.round(this.rollReact(b) / TICK);
            b.chaseUntil = b.hitReactAt + Math.round((CHASE_S + 0.3 * (b.rnd() - 0.5)) / TICK);
            b.chaseX = a.x; b.chaseY = a.y; b.chaseZ = a.z;
          }
        }
        b.seenHitT = r.lastHitT;
        if (b.chaseId >= 0 && now < b.chaseUntil) {
          if (now >= b.hitReactAt) {
            if (b.mode !== 'chase') { b.mode = 'chase'; b.path.length = 0; }
          }
        } else if (b.mode === 'chase') {
          b.mode = 'paint'; b.chaseId = -1; b.goalZone = -1; b.path.length = 0;
        } else if (b.chaseId >= 0 && now >= b.chaseUntil) b.chaseId = -1;
      }
    }
    if (b.mode === 'cover' && now >= b.coverUntil) { b.mode = 'paint'; b.coverCd = now + Math.round(6 / TICK); b.path.length = 0; }

    // ── per-mode planning
    b.holding = false;
    switch (b.mode) {
      case 'paint': this.planPaint(b); break;
      case 'fight': this.planFight(b, tgt!); break;
      case 'cover': this.planCoverStep(b, tgt!); break;
      case 'chase': this.planChase(b); break;
      case 'refill': this.planRefill(b); break;
      default: break;
    }
    if (b.climbPhase === 2) b.holding = true;
    this.stringPull(b);
    if (b.kind !== 'stream') this.planKit(b, tgt, reacted, tgtVisible, dT);
    this.scanTactics(b);

    // idle watchdog: not holding on purpose, not engaging, and not moving for 1.2 s → start over
    const engagedNow = b.mode === 'fight' && b.target >= 0 && b.lostT === 0;
    if (!b.holding && !engagedNow && Math.hypot(b.mvx, b.mvz) < 0.15 && r.grounded) {
      b.idleT += THINK_EVERY * TICK;
      if (b.idleT > 1.2) {
        b.idleT = 0;
        b.idleResets++;
        b.path.length = 0; b.pk = 0; b.goalZone = -1; b.goalNode = -1; b.climbPhase = 0;
        if (b.mode === 'refill') { b.refillHasSpot = false; b.refillTries++; }
        if (b.mode === 'cover') { b.coverUntil = now; b.coverCd = now + Math.round(6 / TICK); b.mode = 'paint'; }
        if (b.mode === 'chase') { b.chaseId = -1; b.mode = 'paint'; }
        if (b.mode === 'paint') this.planPaint(b);
        else if (b.mode === 'refill') this.planRefill(b);
      }
    } else b.idleT = 0;
  }

  private resetBrain(b: Brain): void {
    b.target = -1; b.lostT = 0; b.path.length = 0; b.pk = 0; b.goalZone = -1; b.goalNode = -1;
    b.climbPhase = 0; b.chaseId = -1; b.coverRolled = false; b.retreatRolled = false; b.stuckLevel = 0;
    b.hn = 0; b.hasPaintTarget = false; b.refillHasSpot = false;
  }

  private rollReact(b: Brain): number {
    return b.sk.reactMin + (b.sk.reactMax - b.sk.reactMin) * b.rnd();
  }

  /** visibility + target choice; a new target is a new stimulus: one reaction roll, latched */
  private perceive(b: Brain): void {
    const w = this.world, r = b.r;
    let best = -1, bestS = Infinity;
    let curVisible = false;
    b.seen.length = 0;
    for (const e of w.runners) {
      if (e.team === r.team || !e.alive) continue;
      const d = Math.hypot(e.x - r.x, e.y - r.y, e.z - r.z);
      if (d > 34) continue;
      if (!w.canSee(r, e)) continue;
      b.seen.push(e.id);
      if (e.id === b.target) curVisible = true;
      let s = d;
      if (e.id === r.lastAttacker && r.lastHitT < 3) s -= 5;
      if (e.hp < 50) s -= 2;
      if (e.id === b.target) s -= 3;           // stickiness
      if (s < bestS) { bestS = s; best = e.id; }
    }
    if (b.target >= 0) {
      const t = w.runners[b.target];
      if (!t.alive) { b.target = -1; b.lostT = 0; }
      else if (curVisible) { b.lostT = 0; b.lastSeenX = t.x; b.lastSeenY = t.y; b.lastSeenZ = t.z; }
      else { b.lostT += THINK_EVERY * TICK; if (b.lostT > 1.6) { b.target = -1; b.lostT = 0; } }
    }
    if (best >= 0 && best !== b.target && (b.target < 0 || b.lostT > 0 || bestS < -1)) {
      // new stimulus: roll the reaction ONCE and latch it
      b.target = best;
      b.lostT = 0;
      b.reactAt = w.tick + Math.round(this.rollReact(b) / TICK);
      b.coverRolled = false; b.retreatRolled = false;
      const t = w.runners[best];
      b.lastSeenX = t.x; b.lastSeenY = t.y; b.lastSeenZ = t.z;
    }
  }

  /** stuck = wanted to move for 2 s and moved < 0.5 m: jump + nudge, then re-plan, then a new goal */
  private trackStuck(b: Brain): void {
    const r = b.r;
    // one history sample every 3 decides (0.3 s); 5 samples ≈ 1.5 s
    b.wantMoveAcc++;
    if (b.wantMoveAcc < 3) return;
    b.wantMoveAcc = 0;
    const i = b.hn % 5;
    b.hx[i] = r.x; b.hz[i] = r.z; b.hy[i] = r.y; b.hMove[i] = (!b.holding && Math.hypot(b.mvx, b.mvz) > 0.3) ? 1 : 0;
    b.hn++;
    if (b.hn < 5) return;
    const o = (b.hn) % 5;           // oldest
    let allMove = true;
    for (let k = 0; k < 5; k++) if (!b.hMove[k]) { allMove = false; break; }
    const disp = Math.hypot(r.x - b.hx[o], r.z - b.hz[o], (r.y - b.hy[o]) * 0.5);
    if (allMove && disp < 0.5) {
      b.stuckLevel++;
      const now = this.world.tick;
      if (b.stuckLevel === 1 || b.stuckLevel === 3) {
        // hop + side-step for 0.45 s — never off a ledge (a random nudge dropped a bot off Lockwell's crane walk,
        // 9 m, onto the floor under its own path): the first of 4 rolled directions with floor ahead, else none
        let a = b.rnd() * TAU;
        let ok = false;
        for (let k = 0; k < 4 && !ok; k++, a += TAU / 4) ok = this.safeStep(r, Math.sin(a), Math.cos(a));
        if (ok) { a -= TAU / 4; b.nudgeX = Math.sin(a); b.nudgeZ = Math.cos(a); b.nudgeUntil = now + 27; }
      } else {
        // block the edge we're on, re-plan (a new goal on the 4th strike)
        if (b.pk > 0 && b.pk < b.pathEdge.length) { b.blocked.push(b.pathEdge[b.pk]); b.blockedUntil.push(now + Math.round(10 / TICK)); }
        b.path.length = 0;
        if (b.stuckLevel >= 4) { b.goalZone = -1; b.stuckLevel = 0; }
      }
      b.hn = 0;
    } else if (disp > 1.2) {
      b.stuckLevel = 0;
    }
  }

  // ── PAINT ──

  private planPaint(b: Brain): void {
    const r = b.r, nav = this.nav, now = this.world.tick;
    const z = b.goalZone >= 0 ? this.zones[b.goalZone] : null;
    let reselect = !z && !(b.goalNode >= 0 && b.pk < b.path.length);
    if (z) {
      const arrived = b.pk >= b.path.length;
      if (z.need[b.own] < 0.2) reselect = true;
      if (now - b.goalSince > Math.round(16 / TICK)) reselect = true;
      if (arrived && !reselect) {
        // wander inside the zone while it still needs dye, a couple of times
        if (b.wanders < 2 && z.need[b.own] > 0.35) {
          const n = this.randomNodeNear(b, z.cx, z.cy, z.cz, 3.5);
          if (n >= 0 && Math.hypot(nav.x[n] - r.x, nav.z[n] - r.z) > 1.2 && this.planTo(b, n)) b.wanders++;
          else reselect = true;
        } else reselect = true;
      }
    } else if (b.pk >= b.path.length) reselect = true;
    if (reselect) {
      this.selectGoal(b);
      if (b.goalNode >= 0 && !this.planTo(b, b.goalNode)) { b.goalZone = -1; b.goalNode = -1; }
    } else if (b.path.length === 0 && b.goalNode >= 0) {
      if (!this.planTo(b, b.goalNode)) { b.goalZone = -1; b.goalNode = -1; }
    }
    // paint target: re-pick every 0.3–0.6 s (the aim eases between them: sweeps)
    if (now >= b.paintRetargetAt || !b.hasPaintTarget) this.pickPaintTarget(b);
    else if (b.ptId >= 0 && this.atlasTeam[b.ptId] === b.own) this.nextPaintTarget(b);
    else if (this.paintOffTravel(b)) this.pickPaintTarget(b);
  }

  /** the path turned away from the paint target (> 1.1 rad): the body, which faces the aim while firing, would
   *  whip back to the travel direction when the burst ends — re-pick a target ahead instead (the aim eases over) */
  private paintOffTravel(b: Brain): boolean {
    if (b.kind !== 'stream' && b.kind !== 'burst') return false;
    const r = b.r, ml = Math.hypot(b.mvx, b.mvz);
    if (!b.hasPaintTarget || ml < 0.3) return false;
    const dx = b.ptx - r.x, dz = b.ptz - r.z, d = Math.hypot(dx, dz);
    if (d < 1e-3) return false;
    return (dx * b.mvx + dz * b.mvz) / (d * ml) < Math.cos(1.1);
  }

  private selectGoal(b: Brain): void {
    const r = b.r, now = this.world.tick;
    const own = b.own;
    const eps = this.world.pads[own === 1 ? 'B' : 'A'];
    // allies' goals (crowding)
    const allyGoals: number[] = [];
    for (const o of this.brains) if (o && o !== b && o.own === own && o.goalZone >= 0 && o.r.alive) allyGoals.push(o.goalZone);
    // level pull (see LEVEL_*): per band, a multiplier for zones on another level that is barer than ours
    const BA = this.bandArea, open = this.bandOpen[own];
    const myBand = Math.min(this.bandOf(r.y), BA.length - 1);
    const pull = this.pullBuf; pull.length = 0;
    for (let k = 0; k < BA.length; k++) {
      let m = 1;
      const adv = open[k] - open[myBand];
      if (k !== myBand && BA[k] >= LEVEL_MIN_AREA && adv > LEVEL_ADV) {
        // allies on / headed for that level share the pull
        let there = 0;
        for (const o of this.brains) {
          if (!o || o === b || o.own !== own || !o.r.alive) continue;
          if (this.bandOf(o.r.y) === k || (o.goalZone >= 0 && this.zones[o.goalZone].band === k)) there++;
        }
        m = 1 + LEVEL_PULL * adv / (1 + 1.5 * there);
      }
      pull.push(m);
    }
    const top: number[] = [], topS: number[] = [];
    const K = 6;
    for (let zi = 0; zi < this.zones.length; zi++) {
      if (zi === b.goalZone) continue;
      const z = this.zones[zi];
      let gain = z.area * z.need[own];
      if (b.kind === 'charge') gain = this.sightGain(zi, own, gain);
      if (gain < 2.5) continue;
      if ((z.cx - eps.x) ** 2 + (z.cz - eps.z) ** 2 < (eps.r + 4) ** 2) continue;
      const d = Math.hypot(z.cx - r.x, z.cz - r.z) + Math.abs(z.cy - r.y) * 2;
      const t = d / MOVE.walk;
      let crowd = 0;
      for (const g of allyGoals) { const o = this.zones[g]; if (Math.hypot(o.cx - z.cx, o.cz - z.cz) < 8) crowd++; }
      // travel time dominates: measured over 8 seeds, a softer distance penalty plus a mid-court bonus
      // turned matches into brawls (washes 79–96, neutral 51–59 %) — thorough nearby painting wins turf
      let s = gain / (5 + t * 2.2);
      s /= 1 + crowd * 1.2;
      // a little love for contested enemy dye (flipping it swings the score twice)
      s *= 1 + 0.5 * z.enemyShare[own];
      // the enemy base is a trap
      if ((z.cx - eps.x) ** 2 + (z.cz - eps.z) ** 2 < 16 * 16) s *= 0.6;
      s *= pull[z.band];
      if (!(s > 0)) continue;
      // insert into top-K (deterministic order: score desc, index asc)
      let pos = top.length;
      while (pos > 0 && (topS[pos - 1] < s)) pos--;
      if (pos < K) {
        top.splice(pos, 0, zi); topS.splice(pos, 0, s);
        if (top.length > K) { top.pop(); topS.pop(); }
      }
    }
    b.wanders = 0;
    b.goalSince = now;
    if (!top.length) { b.goalZone = -1; b.goalNode = this.randomNodeNear(b, r.x, r.y, r.z, 8); return; }
    let sum = 0;
    for (const s of topS) sum += s * s;
    let pick = b.rnd() * sum;
    let chosen = top[top.length - 1];
    for (let i = 0; i < top.length; i++) { pick -= topS[i] * topS[i]; if (pick <= 0) { chosen = top[i]; break; } }
    b.goalZone = chosen;
    b.goalNode = this.zones[chosen].node;
  }

  private pickPaintTarget(b: Brain): void {
    const r = b.r, A = this.world.painter.atlas, T = this.atlasTeam;
    const PX = A.px, PY = A.py, PZ = A.pz;
    const now = this.world.tick;
    // SHEET-DRUM paints by rolling (control reads the floor ahead); NEEDLE-GLINT line-paints far floor (pickLineTarget)
    if (b.kind === 'roll') { b.hasPaintTarget = b.rollWant; b.paintRetargetAt = now + 20; return; }
    if (b.kind === 'charge') { b.hasPaintTarget = b.lineOk; b.paintRetargetAt = now + 30; return; }
    const PMAX = b.kind === 'burst' ? BURST_MAX - 0.5 : PAINT_MAX;
    b.paintRetargetAt = now + Math.round((0.3 + 0.3 * b.rnd()) / TICK);
    // one pass over the zone samples in range: dot products, not angles; a fixed top-3, no allocation
    const cx0 = Math.floor((r.x - PMAX + 200) / ZONE), cx1 = Math.floor((r.x + PMAX + 200) / ZONE);
    const cz0 = Math.floor((r.z - PMAX + 200) / ZONE), cz1 = Math.floor((r.z + PMAX + 200) / ZONE);
    const ml = Math.hypot(b.mvx, b.mvz);
    const moving = ml > 0.3;
    const adx = Math.sin(b.aimYaw), adz = Math.cos(b.aimYaw);
    const mdx = moving ? b.mvx / ml : adx, mdz = moving ? b.mvz / ml : adz;
    const minCos = Math.cos(1.0);                      // ahead / to the side of travel, never behind
    const min2 = PAINT_MIN * PAINT_MIN, max2 = PMAX * PMAX;
    const top = this.topId, topS = this.topS;
    top[0] = top[1] = top[2] = -1; topS[0] = topS[1] = topS[2] = -Infinity;
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const l = this.zoneGrid.get(cz * 1000 + cx);
      if (!l) continue;
      for (const zi of l) {
        const zn = this.zones[zi];
        if (Math.abs(zn.cy - r.y) > 3) continue;
        const smp = zn.samples;
        for (let k = 0; k < smp.length; k++) {
          const id = smp[k];
          const t = T[id];
          if (t === b.own) continue;
          const dx = PX[id] - r.x, dz = PZ[id] - r.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < min2 || d2 > max2) continue;
          if (Math.abs(PY[id] - r.y) > 2.2) continue;
          const d = Math.sqrt(d2);
          const cm = (dx * mdx + dz * mdz) / d;
          if (moving && cm < minCos) continue;
          const ca = (dx * adx + dz * adz) / d;
          let sc = ca * 1.3 + cm * 0.4 - Math.abs(d - PAINT_BEST) * 0.22 + b.rnd() * 0.6;
          if (t === b.enemy) sc += 0.7;
          if (sc <= topS[2]) continue;
          // insert (ties: lower texel id first)
          let p = 2;
          while (p > 0 && (sc > topS[p - 1] || (sc === topS[p - 1] && id < top[p - 1]))) { topS[p] = topS[p - 1]; top[p] = top[p - 1]; p--; }
          topS[p] = sc; top[p] = id;
        }
      }
    }
    b.hasPaintTarget = false;
    // the best three get a line-of-fire check
    const my = r.y + COMBAT.muzzleHeight;
    for (let k = 0; k < 3; k++) {
      const id = top[k];
      if (id < 0) break;
      const tx = PX[id], ty = PY[id], tz = PZ[id];
      const dd = Math.hypot(tx - r.x, ty + 0.05 - my, tz - r.z);
      const hit = this.world.physics.raycast(r.x, my, r.z, tx - r.x, ty + 0.05 - my, tz - r.z, dd);
      if (hit && hit.toi < dd - 0.35) continue;
      b.hasPaintTarget = true; b.ptx = tx; b.pty = ty; b.ptz = tz; b.ptId = id;
      b.ptNext[0] = k + 1 < 3 ? top[k + 1] : -1; b.ptNext[1] = k + 2 < 3 ? top[k + 2] : -1;
      return;
    }
    b.ptId = -1;
  }

  /** the current paint target got dyed: step to a runner-up from the last scan (no rescan), else rescan */
  private nextPaintTarget(b: Brain): void {
    const A = this.world.painter.atlas, T = this.atlasTeam, r = b.r;
    for (let k = 0; k < 2; k++) {
      const id = b.ptNext[k];
      if (id < 0 || T[id] === b.own) continue;
      const d = Math.hypot(A.px[id] - r.x, A.pz[id] - r.z);
      if (d < PAINT_MIN || d > (b.kind === 'burst' ? BURST_MAX - 0.5 : PAINT_MAX)) continue;
      b.ptNext[k] = -1;
      b.ptId = id; b.ptx = A.px[id]; b.pty = A.py[id]; b.ptz = A.pz[id]; b.hasPaintTarget = true;
      return;
    }
    this.pickPaintTarget(b);
  }

  private atlasTeamAt(x: number, y: number, z: number): number {
    const s = this.world.painter.surfaceAt(x, y, z, 0.2, 'floor');
    return s ? s.team : -1;
  }

  // ── FIGHT ──

  private planFight(b: Brain, t: Runner): void {
    const r = b.r, now = this.world.tick;
    b.path.length = 0; b.pk = 0; b.climbPhase = 0;
    if (b.lostT > 0) {
      // lost sight: go to where they were
      const n = this.nav.nearest(b.lastSeenX, b.lastSeenY, b.lastSeenZ);
      if (n >= 0) this.planTo(b, n);
      return;
    }
    if (now >= b.strafeT) {
      b.strafeT = now + Math.round((0.4 + 0.7 * b.rnd()) / TICK);
      if (b.rnd() < 0.55) b.strafeSign = -b.strafeSign;
    }
    // paint targets still refresh (used when out of the fire cone)
    if (now >= b.paintRetargetAt) this.pickPaintTarget(b);
    void t;
  }

  // ── COVER ──

  /** find a node near the bot that breaks line of sight to t, plus a peek node next to it */
  private planCover(b: Brain, t: Runner): boolean {
    const r = b.r, nav = this.nav, now = this.world.tick;
    if (b.mode === 'cover' && now < b.coverUntil) return true;
    const ph = this.world.physics;
    const ty = t.y + 0.7;
    const list = this.nodesNear(r.x, r.z, 5.5);
    let best = -1, bestS = Infinity;
    let checks = 0;
    for (const n of list) {
      if (Math.abs(nav.y[n] - r.y) > 1.3) continue;
      const d = Math.hypot(nav.x[n] - r.x, nav.z[n] - r.z);
      const dt = Math.hypot(nav.x[n] - t.x, nav.z[n] - t.z);
      const s = d + Math.max(0, 14 - dt) * 0.5;
      if (s >= bestS) continue;
      if (++checks > 28) break;
      const ey = nav.y[n] + 1.0;
      const hit = ph.raycast(nav.x[n], ey, nav.z[n], t.x - nav.x[n], ty - ey, t.z - nav.z[n], Math.hypot(t.x - nav.x[n], ty - ey, t.z - nav.z[n]));
      if (!hit) continue;
      // the blocker must be close to the node (real cover, not the far side of the map)
      if (hit.toi > 3.5) continue;
      best = n; bestS = s;
    }
    if (best < 0) return false;
    // peek node: a walk neighbour (1–2 hops) with line of sight
    let peek = -1;
    for (let e = nav.edgeStart[best]; e < nav.edgeStart[best + 1] && peek < 0; e++) {
      if (nav.edgeKind[e] !== EDGE_WALK) continue;
      const n = nav.edgeTo[e];
      for (let e2 = nav.edgeStart[n]; e2 < nav.edgeStart[n + 1] && peek < 0; e2++) {
        if (nav.edgeKind[e2] !== EDGE_WALK) continue;
        const m = nav.edgeTo[e2];
        const ey = nav.y[m] + 1.0;
        const h = ph.raycast(nav.x[m], ey, nav.z[m], t.x - nav.x[m], ty - ey, t.z - nav.z[m], Math.hypot(t.x - nav.x[m], ty - ey, t.z - nav.z[m]));
        if (!h) peek = m;
      }
    }
    b.coverNode = best; b.peekNode = peek;
    b.coverUntil = now + Math.round((1.8 + 1.6 * b.rnd()) / TICK);
    b.peekPhase = 0; b.peekT = now + Math.round((0.7 + 0.5 * b.rnd()) / TICK);
    this.planTo(b, best);
    return true;
  }

  private planCoverStep(b: Brain, t: Runner): void {
    const r = b.r, now = this.world.tick, nav = this.nav;
    void t;
    const at = (n: number): boolean => n >= 0 && Math.hypot(nav.x[n] - r.x, nav.z[n] - r.z) < 0.7;
    if (b.peekPhase === 0) {
      if (at(b.coverNode)) {
        b.holding = true;
        if (now >= b.peekT && b.peekNode >= 0) { b.peekPhase = 1; b.peekT = now + Math.round((0.5 + 0.3 * b.rnd()) / TICK); this.planTo(b, b.peekNode); }
      } else if (b.pk >= b.path.length) this.planTo(b, b.coverNode);
    } else {
      if (now >= b.peekT) { b.peekPhase = 0; b.peekT = now + Math.round((0.8 + 0.6 * b.rnd()) / TICK); this.planTo(b, b.coverNode); }
      else if (at(b.peekNode)) b.holding = true;
    }
    if (now >= b.paintRetargetAt) this.pickPaintTarget(b);
  }

  // ── CHASE ──

  private planChase(b: Brain): void {
    const w = this.world;
    const a = b.chaseId >= 0 ? w.runners[b.chaseId] : null;
    if (a && a.alive) { b.chaseX = a.x; b.chaseY = a.y; b.chaseZ = a.z; }
    const n = this.nav.nearest(b.chaseX, b.chaseY, b.chaseZ);
    if (n >= 0 && (b.goalNode !== n || b.path.length === 0)) { b.goalNode = n; this.planTo(b, n); }
    if (w.tick >= b.paintRetargetAt) this.pickPaintTarget(b);
  }

  // ── REFILL ──

  private enterRefill(b: Brain): void {
    b.mode = 'refill';
    b.refillHasSpot = false;
    b.refillTries = 0;
    b.path.length = 0;
    b.climbPhase = 0;
  }

  private planRefill(b: Brain): void {
    const r = b.r, w = this.world, now = w.tick;
    if (!b.refillHasSpot) this.findRefillSpot(b);
    if (!b.refillHasSpot) return;
    const d = Math.hypot(r.x - b.refillX, r.z - b.refillZ);
    const pathDone = b.pk >= b.path.length;
    const there = (d < (b.refillOnPad ? 1.6 : 0.9) && Math.abs(r.y - b.refillY) < 0.8) || (pathDone && d < 2.0);
    if (r.slickForm && r.state === 'slick') {
      // drinking (anywhere on own dye counts)
      b.holding = true;
      b.refillStart = now;
    } else if (there) {
      b.holding = true;
      // standing on it but not slicking after 0.4 s: the dye is gone — look again (the pad after 3 tries)
      if (now - b.refillStart > 24) { b.refillHasSpot = false; b.refillTries++; b.path.length = 0; }
    } else {
      b.refillStart = now;
      if (b.path.length === 0 || pathDone) {
        if (b.refillNode < 0 || !this.planTo(b, b.refillNode)) { b.refillHasSpot = false; b.refillTries++; }
      }
    }
  }

  private findRefillSpot(b: Brain): void {
    const r = b.r, nav = this.nav, P = this.world.painter;
    // candidate spots are NAV NODES whose floor reads as own dye to the runner's own test (teamUnder),
    // with own dye around them too — never a texel on a rim or a crate lid the bot can't stand on
    const tgt = b.target >= 0 && b.lostT === 0 ? this.world.runners[b.target] : null;
    let best = -1, bestD = Infinity;
    const list = this.nodesNear(r.x, r.z, 18).slice();
    for (const n of list) {
      if (!this.nodeMain[n] || this.nodePad[n] === b.enemy) continue;
      const x = nav.x[n], y = nav.y[n], z = nav.z[n];
      let d = Math.hypot(x - r.x, z - r.z) + Math.abs(y - r.y) * 3;
      if (d >= bestD) continue;
      if (tgt) {
        const dt = Math.hypot(x - tgt.x, z - tgt.z);
        if (dt < 7) d += (7 - dt) * 3;
      }
      d += b.refillTries * 4 * this.hashNoise(n);
      if (d >= bestD) continue;
      if (P.teamUnder(x, y + 0.02, z) !== b.own) continue;
      // a patch, not a speck: two of the four points 0.6 m around are own dye as well
      let around = 0;
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2;
        if (P.teamUnder(x + Math.sin(a) * 0.6, y + 0.02, z + Math.cos(a) * 0.6) === b.own) around++;
      }
      if (around < 2) continue;
      best = n; bestD = d;
    }
    const pad = this.world.pads[r.side];
    const padD = Math.hypot(pad.x - r.x, pad.z - r.z) + Math.abs(pad.y - r.y) * 3;
    if (best >= 0 && bestD < padD && b.refillTries < 3) {
      b.refillX = nav.x[best]; b.refillY = nav.y[best]; b.refillZ = nav.z[best]; b.refillNode = best;
      b.refillHasSpot = true; b.refillOnPad = false; b.refillStart = this.world.tick;
      if (!this.planTo(b, best)) { b.refillHasSpot = false; b.refillTries++; }
      return;
    }
    // the pad always works (own pad = own dye)
    const n = nav.nearest(pad.x, pad.y, pad.z);
    b.refillX = pad.x; b.refillY = pad.y; b.refillZ = pad.z; b.refillNode = n;
    b.refillHasSpot = n >= 0; b.refillOnPad = true; b.refillStart = this.world.tick;
    if (n >= 0) this.planTo(b, n);
  }

  private hashNoise(id: number): number { return (hash32(id, this.seed, 0x7e11) >>> 8) / 16777216; }

  // ── paths ──

  private planTo(b: Brain, goal: number): boolean {
    const r = b.r, nav = this.nav;
    b.goalNode = goal;
    b.planAt = this.world.tick;
    b.pk = 0; b.jumpDone = false; b.jumpTries = 0; b.climbPhase = 0;
    let start = nav.nearest(r.x, r.y, r.z);
    if (start < 0 || goal < 0) { b.path.length = 0; return false; }
    let stranded = false;
    if (!nav.path(start, goal, b.path, b.edgeExtra)) {
      // stranded off the core (a fight hop landed the bot on a rock / crate top whose nodes have no way back):
      // walk (or drop) to the nearest core node at or below the feet first — without this a Cinder bot stood on
      // a boulder by its pad for 38 s re-picking goals it could never path to
      if (this.nodeMain[start]) { b.path.length = 0; return false; }
      const m = this.nearestMain(r.x, r.y, r.z);
      if (m < 0 || !nav.path(m, goal, b.path, b.edgeExtra)) { b.path.length = 0; return false; }
      start = m; stranded = true;
    }
    // edge ids along the path (cheapest allowed edge between consecutive nodes)
    b.pathEdge.length = b.path.length;
    b.pathEdge[0] = -1;
    for (let i = 1; i < b.path.length; i++) {
      const u = b.path[i - 1], v = b.path[i];
      let be = -1, bc = Infinity;
      for (let e = nav.edgeStart[u]; e < nav.edgeStart[u + 1]; e++) {
        if (nav.edgeTo[e] !== v) continue;
        const x = b.edgeExtra(e);
        if (!(x < Infinity)) continue;
        const c = nav.edgeCost[e] + x;
        if (c < bc) { bc = c; be = e; }
      }
      b.pathEdge[i] = be;
    }
    // start from the first node ahead of us (skip the start node if we are already past it)
    b.pk = b.path.length > 1 && !stranded ? 1 : 0;
    if (b.path.length > 1 && nav.edgeKind[b.pathEdge[1]] !== EDGE_WALK) {
      // a special edge leaves the start node: go to the start node first
      const s = b.path[0];
      if (Math.hypot(nav.x[s] - r.x, nav.z[s] - r.z) > 0.5) b.pk = 0;
    }
    return true;
  }

  /** skip ahead along walk edges when the straight line is walkable (smooth, direct movement) */
  private stringPull(b: Brain): void {
    const r = b.r, nav = this.nav;
    if (!r.grounded || b.pk >= b.path.length - 1 || b.climbPhase) return;
    if (b.pk > 0 && nav.edgeKind[b.pathEdge[b.pk]] !== EDGE_WALK) return;
    // 5 Hz, two candidates (5 and 2 nodes ahead): each test is two sweeps + footing samples
    if (((this.world.tick / THINK_EVERY) | 0) % 2 !== (b.id & 1)) return;
    const last = Math.min(b.path.length - 1, b.pk + 5);
    for (let j = last; j > b.pk; j = j === last && last > b.pk + 2 ? b.pk + 2 : b.pk) {
      let ok = true;
      for (let k = b.pk + 1; k <= j; k++) if (nav.edgeKind[b.pathEdge[k]] !== EDGE_WALK) { ok = false; break; }
      if (!ok) continue;
      const n = b.path[j];
      if (nav.walkable(r.x, r.y, r.z, nav.x[n], nav.y[n], nav.z[n])) { b.pk = j; return; }
    }
  }

  /** the nearest strongly connected (nodeMain) node within 6 m whose floor is at or below the feet (+0.4 m), or −1 */
  private nearestMain(x: number, y: number, z: number): number {
    const nav = this.nav;
    let best = -1, bd = Infinity;
    for (const n of this.nodesNear(x, z, 6)) {
      if (!this.nodeMain[n] || nav.y[n] > y + 0.4) continue;
      const d = Math.hypot(nav.x[n] - x, nav.z[n] - z) + (y - nav.y[n]) * 0.5;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  private nodesNear(x: number, z: number, rad: number): number[] {
    const out = this.scratch; out.length = 0;
    const nav = this.nav;
    const x0 = clamp(Math.floor((x - rad - this.nbOx) / 2), 0, this.nbW - 1), x1 = clamp(Math.floor((x + rad - this.nbOx) / 2), 0, this.nbW - 1);
    const z0 = clamp(Math.floor((z - rad - this.nbOz) / 2), 0, this.nbH - 1), z1 = clamp(Math.floor((z + rad - this.nbOz) / 2), 0, this.nbH - 1);
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      const c = cz * this.nbW + cx;
      for (let k = this.nbStart[c]; k < this.nbStart[c + 1]; k++) {
        const n = this.nbItems[k];
        if ((nav.x[n] - x) ** 2 + (nav.z[n] - z) ** 2 <= rad * rad) out.push(n);
      }
    }
    return out;
  }

  private randomNodeNear(b: Brain, x: number, y: number, z: number, rad: number): number {
    const l = this.nodesNear(x, z, rad);
    const nav = this.nav;
    const ok: number[] = [];
    for (const n of l) if (Math.abs(nav.y[n] - y) < 0.8 && this.nodePad[n] === 0 && this.nodeMain[n]) ok.push(n);
    if (!ok.length) return -1;
    return ok[Math.floor(b.rnd() * ok.length)];
  }

  // ── CONTROL (every tick) ─────────────────────────────────────────────────────────────────────

  private control(b: Brain, it: PlayerIntent): void {
    const w = this.world, r = b.r, nav = this.nav;
    const dt = TICK;
    const now = w.tick;
    it.jump = false; it.fire = false; it.slick = false; it.sub = false; it.special = false;
    it.moveX = 0; it.moveZ = 0;
    if (!r.alive) {
      it.hasAim = false; it.yaw = r.yaw; it.pitch = 0;
      b.aimYaw = r.yaw; b.aimPitch = 0; b.mvx = 0; b.mvz = 0; b.aimVy = 0; b.aimVp = 0;
      return;
    }
    if (r.respawns !== b.seenRespawns) {
      // back on the pad: pick the aim up from the runner's spawn facing (no snap back to the old aim)
      b.seenRespawns = r.respawns;
      b.aimYaw = r.aimYaw; b.desYaw = r.aimYaw; b.aimPitch = 0; b.desPitch = 0; b.aimVy = 0; b.aimVp = 0; b.fireOn = false;
    }
    if (w.phase !== 'live') {
      // countdown: look down the court
      this.aimToward(b, r.x + Math.sin(r.yaw) * 10, r.y + 0.5, r.z + Math.cos(r.yaw) * 10, false);
      this.emitAim(b, it);
      return;
    }

    // ── movement wish (world space, 0..1) ──
    let wx = 0, wz = 0, speed = 0;
    let jump = false;
    let climbing = false;
    const tgt = b.target >= 0 ? w.runners[b.target] : null;
    const engaged = b.mode === 'fight' && tgt !== null && tgt.alive && b.lostT === 0 && now >= b.reactAt;

    if (b.mode === 'fight' && engaged && b.kind !== 'stream') {
      const m = this.kitFightMove(b, tgt!);
      wx = m.x; wz = m.z; speed = m.s;
    } else if (b.mode === 'fight' && engaged) {
      const dx = tgt!.x - r.x, dz = tgt!.z - r.z;
      const d = Math.hypot(dx, dz) || 1;
      const ux = dx / d, uz = dz / d;
      const px = -uz * b.strafeSign, pz = ux * b.strafeSign;
      let adv = 0;
      if (d > 8.5) adv = 1; else if (d < 4.5) adv = -1; else adv = (d - 6.5) * 0.15;
      wx = ux * adv + px * b.sk.strafe;
      wz = uz * adv + pz * b.sk.strafe;
      const l = Math.hypot(wx, wz);
      if (l > 1e-6) { wx /= l; wz /= l; speed = Math.min(1, l); }
      // never strafe off a ledge / into the sea / into a wall
      if (speed > 0 && !this.safeStep(r, wx, wz)) {
        b.strafeSign = -b.strafeSign;
        wx = ux * adv - px * b.sk.strafe; wz = uz * adv - pz * b.sk.strafe;
        const l2 = Math.hypot(wx, wz);
        if (l2 > 1e-6) { wx /= l2; wz /= l2; }
        if (!this.safeStep(r, wx, wz)) {
          // hold ground (or back along the path we have)
          wx = 0; wz = 0; speed = 0;
          b.holding = true;
        }
      }
    } else if (b.mode === 'refill' && b.holding) {
      speed = 0;
    } else if (b.mode === 'cover' && b.holding) {
      speed = 0;
    } else {
      const f = this.follow(b);
      wx = f.x; wz = f.z; speed = f.s; jump = f.jump; climbing = f.climb;
    }
    // unstuck nudge
    if (now < b.nudgeUntil) {
      wx = b.nudgeX; wz = b.nudgeZ; speed = 1;
      if (now === b.nudgeUntil - 26 && r.grounded) jump = true;
    }
    // separation from allies (bodies don't collide; don't overlap either)
    if (speed > 0 || b.mode === 'fight') {
      for (const o of w.runners) {
        if (o === r || !o.alive || o.team !== r.team) continue;
        const ddx = r.x - o.x, ddz = r.z - o.z;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 < 1.1 * 1.1 && d2 > 1e-6 && Math.abs(o.y - r.y) < 1) {
          const d = Math.sqrt(d2);
          const k = (1.1 - d) / 1.1 * 0.8;
          wx += ddx / d * k; wz += ddz / d * k;
          speed = Math.max(speed, 0.4);
        }
      }
      const l = Math.hypot(wx, wz);
      if (l > 1e-6) { wx /= l; wz /= l; }
    }
    // smooth the direction (no twitch); magnitude applied after
    const k = 1 - Math.exp(-12 * dt);
    b.mvx += (wx * speed - b.mvx) * k;
    b.mvz += (wz * speed - b.mvz) * k;
    if (climbing) { b.mvx = wx * speed; b.mvz = wz * speed; }

    // SHEET-DRUM: is there un-owned floor ahead of the drum? (three points 1.2 m ahead; every 3 ticks)
    if (b.kind === 'roll' && (now - b.rollCheckTick >= 3 || now < b.rollCheckTick)) {
      b.rollCheckTick = now;
      const l = Math.hypot(b.mvx, b.mvz);
      let want = false;
      if (r.grounded && l > 0.3 && b.mode !== 'refill') {
        const fx = b.mvx / l, fz = b.mvz / l;
        let n = 0;
        for (let s = -1; s <= 1; s++) {
          const t = this.teamUnder(r.x + fx * 1.2 - fz * s * 0.7, r.y, r.z + fz * 1.2 + fx * s * 0.7);
          if (t !== null && t !== b.own) n++;
        }
        want = n >= 1;
      }
      b.rollWant = want;
      b.hasPaintTarget = want;
    }

    // ── slick travel through own dye (hysteresis: ≥ 0.5 s on, ≥ 0.5 s off; never while engaging a runner) ──
    const moving = Math.hypot(b.mvx, b.mvz) > 0.3;
    let travelOwn = false;
    if (r.grounded && moving && !jump) {
      // own dye under and ahead, and no wall ahead: holding slick while pushing into an own-dyed wall
      // attaches the runner (wall-slick), and climbs happen only on purpose, on a climb edge.
      // Re-read every 3 ticks (two atlas lookups + a sweep per bot per tick add up).
      if (now - b.ownAheadTick >= 3 || now < b.ownAheadTick) {
        b.ownAheadTick = now;
        let own = w.onOwnPad(r) || this.teamUnder(r.x, r.y, r.z) === b.own;
        if (own) {
          const l = Math.hypot(b.mvx, b.mvz) || 1;
          const ax = r.x + b.mvx / l * 1.1, az = r.z + b.mvz / l * 1.1;
          own = this.teamUnder(ax, r.y, az) === b.own || this.onPadXZ(ax, r.y, az, r.side);
        }
        b.ownAhead = own && !this.wallAhead(r, b.mvx, b.mvz);
      }
      travelOwn = b.ownAhead;
    }
    const canTravel = !engaged && b.climbPhase !== 2 && !(b.mode === 'refill' && b.holding) && !(climbing && b.climbPhase === 3)
      && !(b.kind === 'charge' && b.chHeld) && !(b.kind === 'roll' && b.fireOn) && b.tacKind === 0;
    if (b.slickTravel) {
      const lostForm = !r.slickForm && now - b.slickSince > 20;
      const wallAhead = r.grounded && Math.hypot(b.mvx, b.mvz) > 0.3 && this.wallAhead(r, b.mvx, b.mvz);
      if (!canTravel || lostForm || wallAhead || (now >= b.slickMin && !travelOwn && r.grounded)) { b.slickTravel = false; b.slickCd = now + 30; }
    } else if (canTravel && travelOwn && now >= b.slickCd) {
      const g = b.goalNode;
      const goalD = g >= 0 ? Math.hypot(nav.x[g] - r.x, nav.z[g] - r.z) : 0;
      // swim when there's nothing to paint on the way or the trip is long; with dye to lay, paint the path.
      // Measured over 8 seeds: swimming whenever the goal was > 18 m away spent 18 % of live time swimming
      // at a 95 % tank; a "top up below 55 %" rule stopped every bot from ever running low
      if (!b.hasPaintTarget || goalD > 30 || b.mode === 'refill' || b.mode === 'chase') {
        b.slickTravel = true; b.slickMin = now + 30; b.slickSince = now;
      }
    }

    // ── aim + fire (wantFire = the brain wants a shot; fire = it can shoot this tick) ──
    let wantFire = false;
    let hardStop = false;                 // stop at once (no hysteresis): nothing to shoot, out of ink, slicking
    let direct = -1;                      // SHEET-DRUM / NEEDLE-GLINT drive the trigger themselves: 1 down, 0 up
    const selfTrigger = b.kind === 'roll' || b.kind === 'charge';
    const tacAim = b.tacKind !== 0 && this.tacAim(b);
    if (tacAim) {
      // aiming a jelly / CLOUDBURST throw: the trigger rests
      hardStop = true;
      if (selfTrigger) direct = 0;
    } else if (engaged && b.kind === 'stream') {
      const aimed = this.aimAtRunner(b, tgt!);
      const d = Math.hypot(tgt!.x - r.x, tgt!.z - r.z);
      const err = Math.hypot(adelta(b.aimYaw, b.desYaw), b.aimPitch - b.desPitch);
      const cone = Math.max(b.sk.fireCone, Math.atan2(0.55, Math.max(1, d)));
      const inkOk = r.tank >= b.fire.tankPerShot + 0.5;
      // start inside the cone, keep going inside 2.5× the cone (a burst, not a flicker)
      wantFire = aimed && inkOk && d <= b.sk.engage + (b.fireOn ? 0.8 : 0) && err < (b.fireOn ? cone * 2.5 : cone);
      if (!aimed || !inkOk || d > b.sk.engage + 1.5) hardStop = true;
      // keep the gun up while tracking (don't dive into slick between bursts)
      if (!wantFire && d <= b.sk.engage + 1) b.slickTravel = false;
    } else if (engaged) {
      const d = Math.hypot(tgt!.x - r.x, tgt!.z - r.z);
      if (b.kind === 'burst') {
        wantFire = this.burstAim(b, tgt!, d);
        if (r.tank < b.ink + 0.5 || d > b.engage + 1.5) hardStop = true;
      } else if (b.kind === 'roll') direct = this.rollFight(b, tgt!, d) ? 1 : 0;
      else direct = this.chargeFight(b, tgt!, d) ? 1 : 0;
    } else if (b.slickTravel || b.mode === 'refill' || climbing && b.climbPhase === 3) {
      this.aimAlongMove(b);
      hardStop = true;
      if (selfTrigger) {
        direct = b.tapLeft > 0 ? 1 : 0;
        if (b.tapLeft > 0) b.tapLeft--;
      }
    } else if (b.climbPhase === 2) {
      wantFire = this.aimAtClimbWall(b);
      if (b.kind === 'charge') direct = (wantFire || b.chHeld) && this.chargeHold(b, 0.15, 0.1, 0.3) ? 1 : 0;
    } else if (b.kind === 'burst' && b.mode === 'fight' && b.cornerOk) {
      // airburst round the corner the target just ducked behind
      b.desYaw = b.cornerYaw; b.desPitch = b.cornerPitch; b.aimDist = b.cornerDist;
      const err = Math.abs(adelta(b.aimYaw, b.desYaw)) + Math.abs(b.aimPitch - b.desPitch);
      wantFire = err < 0.06 && r.tank >= b.ink + 0.5;
    } else if (b.kind === 'roll') {
      this.aimAlongMove(b);
      direct = this.rollPaint(b) ? 1 : 0;
    } else if (b.kind === 'charge') {
      direct = this.linePaint(b) ? 1 : 0;
    } else if (b.hasPaintTarget && r.tank >= TANK.low && (b.mode === 'paint' || b.mode === 'chase' || b.mode === 'cover' || b.mode === 'fight')) {
      this.aimToward(b, b.ptx, b.pty, b.ptz, false);
      // paint sweeps while the aim travels between targets (a stripe, the way a player paints)
      const err = Math.abs(adelta(b.aimYaw, b.desYaw)) + Math.abs(b.aimPitch - b.desPitch);
      // a new burst starts only where the body already faces (no whip-around to paint behind)
      wantFire = err < 1.0 && (b.fireOn || Math.abs(adelta(r.yaw, b.aimYaw)) < 0.9);
    } else {
      this.aimAlongMove(b);
      hardStop = true;
    }
    this.slewAim(b, dt, engaged);
    let fire: boolean;
    if (direct >= 0) {
      wantFire = direct === 1;
      if (b.kind === 'roll') {
        // a release within KITS.tapSeconds of the press flicks: a roll stroke (not a tap) is held ≥ 14 ticks
        if (!wantFire && b.fireOn && !b.tapPress && r.rolling && now - b.pressAt < 14) wantFire = true;
        if (wantFire && !b.fireOn) { b.pressAt = now; b.tapPress = b.tapLeft > 0; }
      }
      fire = wantFire && r.canFire();
      b.fireOn = fire;
      if (b.kind === 'charge') {
        if (b.chHeld && !fire) b.chRelAt = now;
        b.chHeld = fire;
        if (!fire) b.chReadyT = 0;
      }
    } else {
      if (b.kind === 'charge') { b.chHeld = false; b.chReadyT = 0; }
      // teammates: droplets pass through them (no friendly fire, no ink lost), but a bot never OPENS fire
      // through a teammate, and stops only for one at point blank (a burst doesn't flicker around allies)
      if (wantFire && !b.fireOn && this.allyInLine(b, 12)) wantFire = false;
      if (b.fireOn && this.allyInLine(b, 2.5)) { wantFire = false; hardStop = true; }
      // hysteresis: a burst lasts ≥ 0.35 s and a painting pause ≥ 0.4 s, so the body (which faces the aim
      // while firing, the travel direction otherwise) never swings back and forth; a fight opens fire at once
      if (b.fireOn) {
        if (!wantFire && (hardStop || now - b.fireSince >= BURST_MIN_TICKS)) { b.fireOn = false; b.fireSince = now; }
      } else if (wantFire && now - b.fireSince >= (engaged ? 9 : 24)) { b.fireOn = true; b.fireSince = now; }
      wantFire = b.fireOn && !(r.tank < b.ink + 0.5);
      fire = wantFire && r.canFire();
    }

    // ── slick: refill in place, the wall climb, or travel ──
    let slick = false;
    if (b.mode === 'refill' && b.holding) slick = true;
    else if (climbing && b.climbPhase === 3) slick = true;
    else if (b.slickTravel) slick = true;
    // an unintended wall-slick (grazing an own-dyed crate) is let go at once: climbs are deliberate only
    if (r.state === 'wallslick' && !(climbing && b.climbPhase === 3)) { slick = false; b.slickTravel = false; b.slickCd = now + 30; }
    // a slicker that wants to shoot surfaces first (the runner blocks fire for 0.12 s)
    if (wantFire && slick && !(b.mode === 'refill' && b.holding)) slick = false;
    if (wantFire && r.slickForm && !slick) fire = false;
    // a pending sub / special surfaces too (throws need the tall form)
    if (b.tacKind !== 0) { slick = false; b.slickTravel = false; }

    it.fire = fire;
    it.slick = slick;
    it.jump = jump;
    this.emitAim(b, it);
    if (b.tacKind !== 0) this.tacTrigger(b, it);
    // world move → camera-relative stick (forward = (sin yaw, cos yaw), right = (−cos yaw, sin yaw))
    const cy = it.yaw;
    const fx = Math.sin(cy), fz = Math.cos(cy);
    it.moveZ = b.mvx * fx + b.mvz * fz;
    it.moveX = b.mvx * -fz + b.mvz * fx;
    // NEEDLE-GLINT between two charges in a fight: the body faces the aim only while charging, so a one-tick
    // gap with the stick pushed would swing it toward the strafe and back (a shake): let the stick rest
    if (b.kind === 'charge' && engaged && !fire && now - b.chRelAt <= 2) { it.moveX = 0; it.moveZ = 0; }
    // a stick deflection under 0.2 is a bot settling (arrival, a strafe reversing through zero, a stall): the runner
    // faces any stick > 0.05, so its wandering direction flicked the body back and forth (half the Lockwell shakes).
    // Rest the stick instead; the runner keeps its facing. Climbs steer on purpose.
    if (!climbing && Math.hypot(b.mvx, b.mvz) < 0.2) { it.moveX = 0; it.moveZ = 0; }
    void nav;
  }

  /** path following; returns a world direction, a 0..1 speed, jump and climb flags */
  private follow(b: Brain): { x: number; z: number; s: number; jump: boolean; climb: boolean } {
    const r = b.r, nav = this.nav, now = this.world.tick;
    const out = { x: 0, z: 0, s: 0, jump: false, climb: false };
    // fell off the path (a nudge, a missed jump): both ends of the current edge are > 1.2 m ABOVE the grounded
    // runner — steering at a node overhead spun the body in place for seconds. Drop the path; decide re-plans.
    // (A path BELOW the runner is fine: walking off the ledge gets there.)
    if (r.grounded && b.pk > 0 && b.pk < b.path.length) {
      const n0 = b.path[b.pk - 1], n1 = b.path[b.pk];
      if (nav.y[n0] - r.y > 1.2 && nav.y[n1] - r.y > 1.2) { b.path.length = 0; b.pk = 0; return out; }
    }
    for (let guard = 0; guard < 3; guard++) {
      if (b.pk >= b.path.length) return out;
      const n = b.path[b.pk];
      const e = b.pk > 0 ? b.pathEdge[b.pk] : -1;
      const kind = e >= 0 ? nav.edgeKind[e] : EDGE_WALK;
      const tx = nav.x[n], ty = nav.y[n], tz = nav.z[n];
      const dx = tx - r.x, dz = tz - r.z;
      const d = Math.hypot(dx, dz);
      const last = b.pk === b.path.length - 1;

      if (kind === EDGE_CLIMB && b.climbPhase === 0) { b.climbPhase = 1; b.climbT = now; b.climbEdge = e; }
      if (kind === EDGE_CLIMB) {
        const c = nav.climbs[nav.edgeClimb[e]];
        const from = b.path[b.pk - 1];
        if (b.climbPhase === 1) {
          // stand at the base node, facing the wall
          const fx = nav.x[from] - r.x, fz = nav.z[from] - r.z;
          const fd = Math.hypot(fx, fz);
          if (fd < 0.35 || now - b.climbT > 150) { b.climbPhase = this.climbOwned(nav.edgeClimb[e], b.own) ? 3 : 2; b.climbT = now; }
          else { out.x = fx / fd; out.z = fz / fd; out.s = Math.min(1, fd / 0.8 + 0.2); return out; }
        }
        if (b.climbPhase === 2) {
          // paint the wall (aim handled in control); give up after 3 s or when out of ink
          if (this.climbOwned(nav.edgeClimb[e], b.own)) { b.climbPhase = 3; b.climbT = now; }
          else if (now - b.climbT > 180 || r.tank < b.ink * 2) { this.failEdge(b, e); return out; }
          else return out;
        }
        if (b.climbPhase === 3) {
          out.climb = true;
          if (r.y >= c.y1 - 0.15 && r.grounded) { b.climbPhase = 0; b.pk++; continue; }
          if (r.y >= c.y1 - 0.15 || (r.state === 'air' && r.y > c.y1 - 0.5)) {
            // popped over the lip: walk onto the top node
            out.x = dx / (d || 1); out.z = dz / (d || 1); out.s = 1; return out;
          }
          if (now - b.climbT > 200) { this.failEdge(b, e); return out; }
          out.x = -c.nx; out.z = -c.nz; out.s = 1;
          return out;
        }
      }

      // reached?
      const dyOk = Math.abs(r.y - ty) < (kind === EDGE_WALK ? 0.9 : 0.6);
      if (d < (last ? 0.45 : 0.6) && dyOk && (kind === EDGE_WALK || r.grounded)) {
        b.pk++; b.jumpDone = false; b.jumpTries = 0; b.climbPhase = 0;
        continue;
      }
      // passed it (overshoot along the segment) on a walk edge
      if (kind === EDGE_WALK && b.pk > 0 && b.pk < b.path.length - 1 && dyOk) {
        const p = b.path[b.pk - 1];
        const sx = tx - nav.x[p], sz = tz - nav.z[p];
        const sl = Math.hypot(sx, sz) || 1;
        const along = ((r.x - nav.x[p]) * sx + (r.z - nav.z[p]) * sz) / sl;
        if (along > sl + 0.1 && d < 1.2) { b.pk++; continue; }
      }
      out.x = dx / (d || 1); out.z = dz / (d || 1);
      out.s = last ? clamp(d / 1.0, 0.25, 1) : 1;
      if (kind === EDGE_WALK && !last) {
        // pure pursuit: steer at the point 1.6 m ahead along the path polyline (walk edges only), so the
        // 45° kinks of the 1 m grid become one smooth curve instead of a zig-zag of body turns
        let rem = 1.6 - d, px = tx, pz = tz, lx = tx, lz = tz;
        for (let j = b.pk + 1; j < b.path.length && rem > 0; j++) {
          if (nav.edgeKind[b.pathEdge[j]] !== EDGE_WALK) break;
          const n2 = b.path[j];
          const sx = nav.x[n2] - px, sz = nav.z[n2] - pz;
          const sl = Math.hypot(sx, sz);
          if (sl >= rem) { lx = px + sx / sl * rem; lz = pz + sz / sl * rem; rem = 0; break; }
          rem -= sl; px = nav.x[n2]; pz = nav.z[n2]; lx = px; lz = pz;
        }
        const ex = lx - r.x, ez = lz - r.z, el = Math.hypot(ex, ez);
        // a path that doubles back round a corner can put the look-ahead point on the runner itself: its direction
        // is then noise (the body spun in place on Lockwell's mezzanine) — steer at the node instead
        if (el > 0.5) { out.x = ex / el; out.z = ez / el; }
      }
      if (kind === EDGE_JUMP) {
        const from = b.path[b.pk - 1];
        const fx = nav.x[from], fz = nav.z[from];
        const sx = tx - fx, sz = tz - fz;
        const sl = Math.hypot(sx, sz) || 1;
        const along = ((r.x - fx) * sx + (r.z - fz) * sz) / sl;
        out.s = clamp(d / 1.6, 0.25, 1);
        if (!b.jumpDone && r.grounded && (Math.hypot(r.x - fx, r.z - fz) < 0.35 || along > -0.1)) {
          out.jump = true; b.jumpDone = true; b.jumpTries++;
        } else if (b.jumpDone && r.grounded && r.airTime === 0 && Math.abs(r.y - nav.y[from]) < 0.3 && d > 0.8) {
          // landed back where we started: retry once, then give up on this edge
          if (b.jumpTries >= 2) { this.failEdge(b, e); return { x: 0, z: 0, s: 0, jump: false, climb: false }; }
          b.jumpDone = false;
        }
      }
      return out;
    }
    return out;
  }

  private failEdge(b: Brain, e: number): void {
    if (e >= 0) { b.blocked.push(e); b.blockedUntil.push(this.world.tick + Math.round(12 / TICK)); }
    b.path.length = 0; b.pk = 0; b.climbPhase = 0;
    if (b.goalNode >= 0 && b.mode !== 'fight') this.planTo(b, b.goalNode);
  }

  /** a step of 1.1 m in direction (x, z) keeps footing within ±0.45 m and hits no wall */
  private safeStep(r: Runner, x: number, z: number): boolean {
    const nav = this.nav;
    const ax = r.x + x * 1.1, az = r.z + z * 1.1;
    const g = nav.ground(ax, az, r.y - 0.45, r.y + 0.45);
    if (!(g === g)) return false;
    const hit = this.world.physics.raycast(r.x, r.y + 0.6, r.z, x, 0, z, 1.0);
    return !hit;
  }

  /** a steep surface within reach along (x, z): the same sphere probe the runner uses to grab a wall (+ margin) */
  private wallAhead(r: Runner, x: number, z: number): boolean {
    const l = Math.hypot(x, z);
    if (l < 1e-6) return false;
    const h = this.world.physics.sphereCast(r.x, r.y + MOVE.radius + MOVE.slickHalfHeight, r.z, x / l, 0, z / l, 0.3, 0.6);
    return !!h && Math.abs(h.ny) < 0.5;
  }

  private teamUnder(x: number, y: number, z: number): TeamId | null {
    return this.world.painter.teamUnder(x, y, z);
  }

  private onPadXZ(x: number, y: number, z: number, side: 'A' | 'B'): boolean {
    const p = this.world.pads[side];
    return (x - p.x) ** 2 + (z - p.z) ** 2 <= p.r * p.r && Math.abs(y - p.y) < 0.6;
  }

  // ── kits (lane BOTKITS; numbers in bots/tactics.ts) ─────────────────────────────────────────

  /** per-decide kit planning: the SHEET-DRUM roll-through latch, the POP-WELL corner shot */
  private planKit(b: Brain, tgt: Runner | null, reacted: boolean, visible: boolean, dT: number): void {
    const r = b.r, now = this.world.tick;
    if (b.kind === 'roll') {
      if (b.mode === 'fight' && tgt && reacted && visible && r.tank > 5) {
        // close → roll through; a little farther when it looks away, is weak, or is slicking (can't shoot back)
        const away = Math.abs(adelta(tgt.aimYaw, Math.atan2(r.x - tgt.x, r.z - tgt.z))) > 1.1;
        if (dT < ROLL_CLOSE || (dT < ROLL_AMBUSH && (away || tgt.hp <= 45 || tgt.slickForm))) {
          b.rollCharge = true; b.rollChargeUntil = now + 36;
        } else if (b.rollCharge && (now >= b.rollChargeUntil || dT > ROLL_AMBUSH + 1)) b.rollCharge = false;
      } else b.rollCharge = false;
    } else if (b.kind === 'burst') this.planCorner(b);
  }

  /** fight movement of a SHEET-DRUM / NEEDLE-GLINT / POP-WELL (world wish in this.mv) */
  private kitFightMove(b: Brain, t: Runner): { x: number; z: number; s: number } {
    const r = b.r, o = this.mv;
    o.x = 0; o.z = 0; o.s = 0;
    const dx = t.x - r.x, dz = t.z - r.z;
    const d = Math.hypot(dx, dz) || 1;
    const ux = dx / d, uz = dz / d;
    if (b.kind === 'roll' && b.rollCharge) {
      // straight through them: steer at where they will be in 0.25 s (the drum sits ahead of the feet)
      const lx = t.x + t.vx * 0.25 - r.x, lz = t.z + t.vz * 0.25 - r.z;
      const l = Math.hypot(lx, lz) || 1;
      if (this.safeStep(r, lx / l, lz / l)) { o.x = lx / l; o.z = lz / l; o.s = 1; } else b.holding = true;
      return o;
    }
    let adv: number, st = b.sk.strafe;
    if (b.kind === 'roll') {
      adv = d > FLICK_MAX ? 1 : d < FLICK_MIN ? -0.5 : 0.3;    // creep in between flicks
      st *= 0.6;
    } else if (b.kind === 'charge') {
      if (d < RETREAT) { adv = -1; st *= 0.4; }                  // too close: back off
      else if (d > b.engage - 1.5) adv = 0.7;
      else { adv = 0; st = 1; }                                  // hold the line, side-stepping (0.35× while charging)
    } else {
      adv = d > BURST_MAX - 0.3 ? 1 : d < BURST_MIN ? -1 : (d - 7) * 0.2;
    }
    const px = -uz * b.strafeSign, pz = ux * b.strafeSign;
    let wx = ux * adv + px * st, wz = uz * adv + pz * st;
    let l = Math.hypot(wx, wz);
    if (l < 1e-6) return o;
    o.s = Math.min(1, l);
    wx /= l; wz /= l;
    if (!this.safeStep(r, wx, wz)) {
      b.strafeSign = -b.strafeSign;
      wx = ux * adv - px * st; wz = uz * adv - pz * st;
      l = Math.hypot(wx, wz);
      if (l > 1e-6) { wx /= l; wz /= l; }
      if (l < 1e-6 || !this.safeStep(r, wx, wz)) { o.s = 0; b.holding = true; return o; }
    }
    o.x = wx; o.z = wz;
    return o;
  }

  /** aim straight at a point (hitscan beam, straight bursts, throws); aimDist = the 3-D distance */
  private aimStraight(b: Brain, x: number, y: number, z: number): void {
    const r = b.r, my = r.y + COMBAT.muzzleHeight;
    const D = Math.hypot(x - r.x, z - r.z);
    if (D > 1e-3) b.desYaw = Math.atan2(x - r.x, z - r.z);
    b.desPitch = Math.atan2(y - my, Math.max(0.3, D));
    b.aimDist = Math.max(2, Math.hypot(D, y - my));
  }

  // SHEET-DRUM

  /** painting: drum down while moving over un-owned floor (≥ 0.4 s strokes, ≥ 0.2 s up), up over own dye */
  private rollPaint(b: Brain): boolean {
    const r = b.r, now = this.world.tick;
    if (b.tapLeft > 0) { b.tapLeft--; return true; }
    const stick = Math.hypot(b.mvx, b.mvz);
    if (!r.grounded || stick < 0.35 || r.tank <= 1) { b.rollOn = false; b.rollSince = now; return false; }
    if (b.rollOn) {
      if (!b.rollWant && now - b.rollSince >= 24) { b.rollOn = false; b.rollSince = now; }
    } else if (b.rollWant && stick > 0.5 && now - b.rollSince >= 12) { b.rollOn = true; b.rollSince = now; }
    return b.rollOn;
  }

  /** fighting: roll through a close foe, else flick (a tap) at the lead point */
  private rollFight(b: Brain, t: Runner, d: number): boolean {
    const r = b.r;
    if (b.kf.type !== 'roll') return false;
    const f = b.kf;
    if (b.rollCharge) {
      b.tapLeft = 0;
      this.aimStraight(b, t.x, t.y + 0.5, t.z);
      return r.tank > 1;                               // held while moving = rolling (a stop flicks: fine up close)
    }
    const lead = b.sk.lead * Math.min(0.7, d / KITS.flickSpeed * 1.15);
    const lx = t.x + t.vx * lead, lz = t.z + t.vz * lead;
    const D = Math.hypot(lx - r.x, lz - r.z);
    const my = r.y + COMBAT.muzzleHeight;
    if (D > 1e-3) b.desYaw = Math.atan2(lx - r.x, lz - r.z);
    b.desPitch = clamp(Math.atan2(t.y + 0.6 - my, Math.max(1, D)), 0, 0.5);   // level fan; raised for a foe above
    b.aimDist = Math.max(2, D);
    const cone = Math.max(b.sk.fireCone, Math.atan2(0.7, Math.max(1, d)));
    return this.flickTap(b, d >= FLICK_MIN - 0.4 && d <= FLICK_MAX + 0.3, cone, f.windup + f.cooldown, f.flickTankCost);
  }

  /** a flick = press + release within KITS.tapSeconds; the next one after windup + cooldown */
  private flickTap(b: Brain, want: boolean, cone: number, period: number, cost: number): boolean {
    const r = b.r, now = this.world.tick;
    if (b.tapLeft > 0) { b.tapLeft--; return true; }
    if (b.fireOn) return false;                        // the trigger must come up first (a fresh press)
    if (!want || r.flicking || now < b.flickNextAt || r.tank < cost + 0.5) return false;
    const err = Math.hypot(adelta(b.aimYaw, b.desYaw), b.aimPitch - b.desPitch);
    if (err > cone) return false;
    b.tapLeft = FLICK_TAP_TICKS - 1;
    b.flickNextAt = now + Math.round(period / TICK) + 2;
    return true;
  }

  // NEEDLE-GLINT

  /** fighting: charge on the target, release when the charge washes it (full beyond 12 m) and the aim is on */
  private chargeFight(b: Brain, t: Runner, d: number): boolean {
    const r = b.r;
    if (b.kf.type !== 'charge') return false;
    const f = b.kf;
    const my = r.y + COMBAT.muzzleHeight, ty = t.y + t.hitHeight() * 0.55;
    this.aimStraight(b, t.x, ty, t.z);
    const d3 = Math.hypot(t.x - r.x, ty - my, t.z - r.z);
    const tol = Math.max(0.01, Math.atan2(HITBOX.radius * 0.75, d3));
    if (d < RETREAT) return b.chHeld && this.chargeHold(b, 0.15, tol, 0, b.settle);   // backing off: only a charge already up goes out
    const cap = chargeCap(r.tank, f.tankMin, f.tankFull);
    if (cap < 0.15 && !b.chHeld) return false;
    const need = Math.min(Math.max(0.15, cap), chargeNeed(d3, t.hp, f.minRange, f.maxRange, f.damageMin, f.damageFull));
    return this.chargeHold(b, need, tol, 0.5, b.settle);
  }

  /** the charge trigger: start once roughly on target, release at `need` with the aim within `tol` */
  private chargeHold(b: Brain, need: number, tol: number, startErr: number, settle: number = 1): boolean {
    const r = b.r;
    const err = Math.hypot(adelta(b.aimYaw, b.desYaw), b.aimPitch - b.desPitch);
    if (!b.chHeld) { b.chOnT = 0; return err < startErr; }
    if (r.charge <= 1e-6) return false;               // the kit didn't take the press (dry / surfacing): let go
    b.chOnT = err < tol ? b.chOnT + 1 : 0;            // ticks the aim has stayed on (lining the shot up)
    if (r.charge >= need - 0.005) {
      b.chReadyT++;
      if (b.chOnT >= settle || b.chReadyT > 40) return false;   // release (or stop waiting for a perfect aim)
    } else b.chReadyT = 0;
    return true;
  }

  /** idle: charge and release a beam at far un-owned floor (the beam's floor projection is painted) */
  private linePaint(b: Brain): boolean {
    const r = b.r, now = this.world.tick;
    if (b.kf.type !== 'charge') return false;
    const f = b.kf;
    if (!b.chHeld && (!b.lineOk || now >= b.lineRetargetAt)) this.pickLineTarget(b);
    // below LINE_TANK the tank is kept for fights: travel (slicking through own dye refills on the move)
    if (!b.chHeld && r.tank < LINE_TANK) b.hasPaintTarget = false;
    if (!b.lineOk || (!b.chHeld && r.tank < LINE_TANK) || (b.mode !== 'paint' && b.mode !== 'chase' && b.mode !== 'cover' && b.mode !== 'fight')) {
      this.aimAlongMove(b);
      return false;
    }
    this.aimStraight(b, b.lx, b.ly + 0.05, b.lz);
    // a new charge only after a 0.4 s pause and where the body already faces (it turns to the aim while charging)
    if (!b.chHeld && (now - b.chRelAt < 24 || Math.abs(adelta(r.yaw, b.aimYaw)) > 0.9)) return false;
    const my = r.y + COMBAT.muzzleHeight;
    const D = Math.hypot(b.lx - r.x, b.ly - my, b.lz - r.z);
    const need = Math.max(0.15, Math.min(chargeCap(r.tank, f.tankMin, f.tankFull), lineNeed(D, f.minRange, f.maxRange)));
    const hold = this.chargeHold(b, need, 0.04, 0.6);
    if (b.chHeld && !hold) b.lineOk = false;           // released: the next line
    return hold;
  }

  /** a far floor point with un-owned dye in a zone seen from the bot's zone (the best of 3 with a clear line) */
  private pickLineTarget(b: Brain): void {
    const r = b.r, now = this.world.tick, A = this.world.painter.atlas, T = this.atlasTeam;
    b.lineRetargetAt = now + Math.round((1.2 + 0.6 * b.trnd()) / TICK);
    b.lineOk = false;
    const zi = this.zoneAt(r.x, r.z, r.y);
    if (zi < 0 || !this.zoneVis.length) return;
    const vis = this.zoneVis[zi];
    const adx = Math.sin(b.aimYaw), adz = Math.cos(b.aimYaw);
    const top = this.topId, topS = this.topS;
    top[0] = top[1] = top[2] = -1; topS[0] = topS[1] = topS[2] = -Infinity;
    for (let k = 0; k < vis.length; k++) {
      const yi = vis[k], y = this.zones[yi];
      const need = y.need[b.own];
      if (need < 0.3) continue;
      const dx = y.cx - r.x, dz = y.cz - r.z;
      const d = Math.hypot(dx, dz);
      if (d < LINE_MIN || d > LINE_MAX) continue;
      const ca = (dx * adx + dz * adz) / d;
      const sc = y.area * need * (1.4 + ca) * (d < 10 ? 0.8 : 1);
      if (sc <= topS[2]) continue;
      let p = 2;
      while (p > 0 && sc > topS[p - 1]) { topS[p] = topS[p - 1]; top[p] = top[p - 1]; p--; }
      topS[p] = sc; top[p] = yi;
    }
    const my = r.y + COMBAT.muzzleHeight;
    for (let k = 0; k < 3; k++) {
      const yi = top[k];
      if (yi < 0) break;
      const smp = this.zones[yi].samples;
      if (!smp.length) continue;
      const k0 = Math.floor(b.trnd() * smp.length);
      let id = -1;
      for (let j = 0; j < smp.length; j++) { const c = smp[(k0 + j) % smp.length]; if (T[c] !== b.own) { id = c; break; } }
      if (id < 0) continue;
      const tx = A.px[id], ty = A.py[id], tz = A.pz[id];
      const dd = Math.hypot(tx - r.x, ty + 0.05 - my, tz - r.z);
      const hit = this.world.physics.raycast(r.x, my, r.z, tx - r.x, ty + 0.05 - my, tz - r.z, dd);
      if (hit && hit.toi < dd - 0.4) continue;
      b.lx = tx; b.ly = ty; b.lz = tz; b.lineOk = true;
      b.hasPaintTarget = true;
      return;
    }
  }

  /** NEEDLE-GLINT goal value: its own need plus what it overlooks (need-weighted m² in sight), higher = better */
  private sightGain(zi: number, own: TeamId, gain: number): number {
    const vis = this.zoneVis[zi];
    let pot = 0;
    if (vis) for (let k = 0; k < vis.length; k++) { const y = this.zones[vis[k]]; pot += y.area * y.need[own]; }
    const z = this.zones[zi];
    return (gain + 0.3 * pot) * (1 + 0.2 * clamp(z.cy - this.floorY0, 0, 3));
  }

  // POP-WELL

  /** aim a burst at the target's lower body, led by the flight time; true = inside the fire cone */
  private burstAim(b: Brain, t: Runner, d: number): boolean {
    const r = b.r;
    if (b.kf.type !== 'burst') return false;
    const f = b.kf;
    const lead = b.sk.lead * Math.min(0.8, d / f.projectileSpeed);
    const tx = t.x + t.vx * lead, tz = t.z + t.vz * lead;
    this.aimStraight(b, tx, t.y + (t.slickForm ? 0.2 : 0.35), tz);     // low: a miss still bursts at the feet
    const err = Math.hypot(adelta(b.aimYaw, b.desYaw), b.aimPitch - b.desPitch);
    const cone = Math.max(b.sk.fireCone, Math.atan2(0.8, Math.max(1, d)));
    return r.tank >= b.ink + 0.5 && d <= b.engage + (b.fireOn ? 0.8 : 0) && err < (b.fireOn ? cone * 2.5 : cone);
  }

  /** the target just ducked out of sight: find a burst line whose blast point (map hit or airburst at maxRange)
   *  lands within splash of where it was, with a clear line from the blast to it */
  private planCorner(b: Brain): void {
    b.cornerOk = false;
    if (b.kf.type !== 'burst') return;
    const f = b.kf, r = b.r;
    if (b.mode !== 'fight' || b.target < 0 || b.lostT <= 0 || b.lostT > 1.2 || r.tank < b.ink + 0.5) return;
    const ph = this.world.physics;
    const my = r.y + COMBAT.muzzleHeight;
    const lx = b.lastSeenX, ly = b.lastSeenY + 0.6, lz = b.lastSeenZ;
    const D = Math.hypot(lx - r.x, lz - r.z);
    if (D < 2.5 || D > f.maxRange + f.splashRadius) return;
    const base = Math.atan2(lx - r.x, lz - r.z);
    const pitch = Math.atan2(ly - my, D);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    let best = Infinity;
    for (let k = 0; k <= 12; k++) {
      const off = (k & 1 ? 1 : -1) * Math.ceil(k / 2) * 0.06;
      const yaw = base + off;
      const dx = Math.sin(yaw) * cp, dz = Math.cos(yaw) * cp;
      const h = ph.raycast(r.x, my, r.z, dx, sp, dz, f.maxRange);
      const t = h ? Math.max(0, h.toi - 0.08) : f.maxRange;
      const bx = r.x + dx * t, by = my + sp * t, bz = r.z + dz * t;
      const dd = Math.hypot(bx - lx, by - ly, bz - lz);
      if (dd > f.splashRadius * 0.9) continue;
      if (!this.world.lineClear(bx, by, bz, lx, ly, lz)) continue;
      const s = dd + Math.abs(off) * 3;
      if (s < best) { best = s; b.cornerYaw = yaw; b.cornerPitch = pitch; b.cornerDist = Math.max(2, t); b.cornerOk = true; }
    }
  }

  // ── JELLY CHARGE + specials (every kit) ──

  /** find a sub / special opportunity; a new one is a new stimulus: one reaction roll, latched */
  private scanTactics(b: Brain): void {
    const r = b.r, now = this.world.tick;
    if (r.specialReady) { if (b.readySince < 0) b.readySince = now; } else b.readySince = -1;
    if (b.tacKind !== 0) return;
    if (b.mode === 'refill' || b.mode === 'dead' || b.mode === 'wait' || r.leaping || r.specialActive !== ''
      || b.climbPhase !== 0 || r.state === 'wallslick') { b.tacKey = -1; return; }
    const o = this.opp;
    o.key = -1; o.kind = 0; o.gap = false;
    if (b.spec && r.specialReady && r.special >= 1) {
      const loose = b.readySince >= 0 && now - b.readySince > Math.round(20 / TICK);
      if (b.spec.type === 'cloudburst') this.cloudOpp(b, b.spec.throwRange, b.spec.soakRadius, loose);
      else this.wellOpp(b, b.spec.coreRadius, b.spec.ringRadius, loose);
      if (o.key >= 0) o.kind = 2;
    }
    if (o.key < 0 && b.jelly && r.tank >= Math.max(SUB_TANK, b.jelly.tankCost) && r.subCooldown <= 1e-9) {
      this.jellyOpp(b, b.jelly);
      if (o.key >= 0) o.kind = 1;
    }
    if (o.key < 0) { b.tacKey = -1; return; }
    if (o.key !== b.tacKey) {
      b.tacKey = o.key;
      b.tacReactAt = now + Math.round((b.sk.reactMin + (b.sk.reactMax - b.sk.reactMin) * b.trnd()) / TICK);
    }
    if (now < b.tacReactAt) return;
    b.tacKind = o.kind; b.tacX = o.x; b.tacY = o.y; b.tacZ = o.z; b.tacGap = o.gap;
    b.tacCount = o.kind === 1 ? r.subs : r.specials;
    b.tacUntil = now + Math.round(1.0 / TICK);
    b.tacKey = -1;
  }

  /** ≥ CLUSTER of the enemies b sees within `rad` (horizontal, same level) of one of them within [dMin, dMax] */
  private clusterOpp(b: Brain, dMin: number, dMax: number, rad: number, keyBase: number): boolean {
    const r = b.r, R = this.world.runners, o = this.opp;
    for (const i of b.seen) {
      const e = R[i];
      const dh = Math.hypot(e.x - r.x, e.z - r.z);
      if (dh > dMax || dh < dMin || Math.abs(e.y - r.y) > 3) continue;
      let n = 0, sx = 0, sz = 0, mask = 0;
      for (const j of b.seen) {
        const q = R[j];
        if (Math.abs(q.y - e.y) < 1.5 && Math.hypot(q.x - e.x, q.z - e.z) <= rad) { n++; sx += q.x; sz += q.z; mask |= 1 << (j & 15); }
      }
      if (n >= CLUSTER) { o.key = keyBase | mask; o.x = sx / n; o.y = e.y; o.z = sz / n; return true; }
    }
    return false;
  }

  private jellyOpp(b: Brain, s: JellyDef): void {
    const r = b.r, o = this.opp, now = this.world.tick;
    // 1. an enemy cluster in reach
    if (this.clusterOpp(b, 3, SUB_REACH, s.blastRadius * 0.9, 0x10000)) return;
    // 2. behind the cover the fight target just left sight at
    if (b.mode === 'fight' && b.target >= 0 && b.lostT > 0 && b.lostT <= 1.3) {
      const dh = Math.hypot(b.lastSeenX - r.x, b.lastSeenZ - r.z);
      const my = r.y + COMBAT.muzzleHeight;
      if (dh >= 3 && dh <= SUB_REACH && Math.abs(b.lastSeenY - r.y) < 2.5
        && !this.world.lineClear(r.x, my, r.z, b.lastSeenX, b.lastSeenY + 0.6, b.lastSeenZ)) {
        o.key = 0x20000 | b.target; o.x = b.lastSeenX; o.y = b.lastSeenY; o.z = b.lastSeenZ;
        return;
      }
    }
    // 3. an enemy dye gap in reach (painting, nobody in sight, a full tank)
    if (b.mode !== 'paint' || b.seen.length > 0 || r.tank < 95 || now < b.gapCd) return;
    const zi = this.bestZoneNear(b, 4, SUB_REACH, 1.5, 0, 0.5, 7);
    if (zi < 0) return;
    const z = this.zones[zi];
    o.key = 0x40000 | zi; o.x = z.cx; o.y = z.cy; o.z = z.cz; o.gap = true;
  }

  private cloudOpp(b: Brain, throwRange: number, soak: number, loose: boolean): void {
    const o = this.opp;
    if (this.clusterOpp(b, 3, throwRange - 1, soak * 0.85, 0x100000)) return;
    // contested turf: the zone in range with the most enemy dye under its soak disk
    const zi = this.bestZoneNear(b, 6, throwRange - 1, 4, soak, 0, loose ? 16 : 30);
    if (zi < 0) return;
    const z = this.zones[zi];
    o.key = 0x200000 | zi; o.x = z.cx; o.y = z.cy; o.z = z.cz;
  }

  private wellOpp(b: Brain, core: number, ring: number, loose: boolean): void {
    const r = b.r, R = this.world.runners, o = this.opp;
    if (!r.grounded) return;
    let n = 0, mask = 0;
    for (const i of b.seen) {
      const e = R[i];
      if (Math.abs(e.y - r.y) < 1.5 && Math.hypot(e.x - r.x, e.z - r.z) <= core + 0.5) { n++; mask |= 1 << (i & 15); }
    }
    if (n >= CLUSTER) { o.key = 0x400000 | mask; o.x = r.x; o.y = r.y; o.z = r.z; return; }
    const zi = this.zoneAt(r.x, r.z, r.y);
    if (zi < 0 || this.enemyAreaNear(zi, ring, b.own) < (loose ? 18 : 34)) return;
    o.key = 0x800000 | zi; o.x = r.x; o.y = r.y; o.z = r.z;
  }

  /** the zone within [dMin, dMax] m (|dy| ≤ dyMax) with the most enemy dye — its own (rad 0) or within `rad` of it —
   *  at least `minArea` m² (and an enemy share ≥ minShare of its own floor), with a clear throw line; −1 if none */
  private bestZoneNear(b: Brain, dMin: number, dMax: number, dyMax: number, rad: number, minShare: number, minArea: number): number {
    const r = b.r, own = b.own;
    const cx0 = Math.floor((r.x - dMax + 200) / ZONE), cx1 = Math.floor((r.x + dMax + 200) / ZONE);
    const cz0 = Math.floor((r.z - dMax + 200) / ZONE), cz1 = Math.floor((r.z + dMax + 200) / ZONE);
    const top = this.topId, topS = this.topS;
    top[0] = top[1] = top[2] = -1; topS[0] = topS[1] = topS[2] = -Infinity;
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const l = this.zoneGrid.get(cz * 1000 + cx);
      if (!l) continue;
      for (const zi of l) {
        const z = this.zones[zi];
        if (Math.abs(z.cy - r.y) > dyMax || z.enemyShare[own] < minShare) continue;
        const dh = Math.hypot(z.cx - r.x, z.cz - r.z);
        if (dh < dMin || dh > dMax) continue;
        const a = rad > 0 ? this.enemyAreaNear(zi, rad, own) : z.area * z.enemyShare[own];
        if (a < minArea || a <= topS[2]) continue;
        let p = 2;
        while (p > 0 && (a > topS[p - 1] || (a === topS[p - 1] && zi < top[p - 1]))) { topS[p] = topS[p - 1]; top[p] = top[p - 1]; p--; }
        topS[p] = a; top[p] = zi;
      }
    }
    for (let k = 0; k < 3; k++) {
      const zi = top[k];
      if (zi < 0) break;
      const z = this.zones[zi];
      if (this.world.lineClear(r.x, r.y + 1.8, r.z, z.cx, z.cy + 1.6, z.cz)) return zi;
    }
    return -1;
  }

  /** a pending throw aims at its point (jelly, CLOUDBURST); WELLSPRING needs no aim. Clears itself when done. */
  private tacAim(b: Brain): boolean {
    const r = b.r, now = this.world.tick;
    const done = b.tacKind === 1 ? r.subs !== b.tacCount : r.specials !== b.tacCount;
    if (done || now > b.tacUntil || !r.alive) {
      if (done && b.tacKind === 1 && b.tacGap) b.gapCd = now + Math.round(15 / TICK);
      b.tacKind = 0;
      return false;
    }
    if (b.tacKind === 2 && b.spec && b.spec.type === 'wellspring') return false;
    this.aimStraight(b, b.tacX, b.tacY + 0.1, b.tacZ);
    return true;
  }

  /** press sub / special once the aim is on the point (the aim point carries the skill's jitter) */
  private tacTrigger(b: Brain, it: PlayerIntent): void {
    if (b.tacKind === 2 && b.spec && b.spec.type === 'wellspring') { it.special = true; return; }
    const err = Math.hypot(adelta(b.aimYaw, b.desYaw), b.aimPitch - b.desPitch);
    if (err > 0.07) return;
    if (b.tacKind === 1) it.sub = true; else it.special = true;
  }

  // ── aim ──

  /** set desYaw/desPitch to hit `t` (chest), with lead; returns false if the solver can't reach it */
  private aimAtRunner(b: Brain, t: Runner): boolean {
    const r = b.r;
    const my = r.y + COMBAT.muzzleHeight;
    let tx = t.x, tz = t.z;
    const ty = t.y + t.hitHeight() * 0.55;
    // first pass: flight time for the lead
    const o = this.tmp2;
    let D = Math.hypot(tx - r.x, tz - r.z);
    solvePitch(b.bal, D, ty - my, o);
    const lead = b.sk.lead * Math.min(0.8, o[0]);
    tx += t.vx * lead; tz += t.vz * lead;
    D = Math.hypot(tx - r.x, tz - r.z);
    const p = solvePitch(b.bal, D, ty - my, o);
    b.desYaw = Math.atan2(tx - r.x, tz - r.z);
    b.desPitch = p;
    b.aimDist = Math.max(2, D);
    return o[1] === 1;
  }

  private aimToward(b: Brain, x: number, y: number, z: number, _enemy: boolean): void {
    const r = b.r;
    const my = r.y + COMBAT.muzzleHeight;
    const D = Math.hypot(x - r.x, z - r.z);
    const o = this.tmp2;
    b.desYaw = D > 1e-3 ? Math.atan2(x - r.x, z - r.z) : b.desYaw;
    b.desPitch = D > 0.5 ? solvePitch(b.bal, D, y - my, o) : -0.6;
    b.aimDist = Math.max(2, D);
  }

  private aimAlongMove(b: Brain): void {
    const l = Math.hypot(b.mvx, b.mvz);
    if (l > 0.2) b.desYaw = Math.atan2(b.mvx, b.mvz);
    b.desPitch = -0.12;
    b.aimDist = 8;
  }

  private aimAtClimbWall(b: Brain): boolean {
    const nav = this.nav, r = b.r;
    const e = b.climbEdge;
    if (e < 0) return false;
    const c = nav.climbs[nav.edgeClimb[e]];
    const P = this.world.painter;
    // lowest height on the climb line that isn't own dye yet
    let yy = c.y0 + 0.35;
    for (let k = 0; k < 4; k++) {
      const y = c.y0 + 0.3 + (c.y1 - c.y0 - 0.3) * (k / 3);
      const s = P.surfaceAt(c.cx + c.nx * 0.02, y, c.cz + c.nz * 0.02, 0.5, 'wall');
      if (!s || s.team !== b.own) { yy = y; break; }
      yy = y;
    }
    const my = r.y + COMBAT.muzzleHeight;
    const D = Math.hypot(c.cx - r.x, c.cz - r.z);
    b.desYaw = Math.atan2(c.cx - r.x, c.cz - r.z);
    b.desPitch = Math.atan2(yy - my, Math.max(0.3, D));
    b.aimDist = Math.max(1, D);
    const err = Math.abs(adelta(b.aimYaw, b.desYaw)) + Math.abs(b.aimPitch - b.desPitch);
    return err < 0.25 && r.tank >= b.ink + 0.5;
  }

  /** ease + rate-limit the aim toward des*, plus smooth skill noise (never a twitch) */
  private slewAim(b: Brain, dt: number, engaged: boolean): void {
    // second order: the wanted angular speed eases with the error (capped at turnRate); the actual speed
    // follows it with a bounded acceleration, so a reversal passes smoothly through zero (no snap)
    const acc = b.sk.turnAccel * dt;
    const wy = clamp(adelta(b.aimYaw, b.desYaw) * b.sk.aimEase, -b.sk.turnRate, b.sk.turnRate);
    const wp = clamp((b.desPitch - b.aimPitch) * b.sk.aimEase, -b.sk.turnRate, b.sk.turnRate);
    b.aimVy += clamp(wy - b.aimVy, -acc, acc);
    b.aimVp += clamp(wp - b.aimVp, -acc, acc);
    b.aimYaw = wrap(b.aimYaw + b.aimVy * dt);
    b.aimPitch = clamp(b.aimPitch + b.aimVp * dt, -1.3, 1.0);
    // noise: two smooth channels re-rolled every ~0.35 s
    b.jT += dt;
    if (b.jT >= b.jPeriod) {
      b.jT -= b.jPeriod;
      b.jA[0] = b.jB[0]; b.jA[1] = b.jB[1];
      b.jB[0] = b.rnd() * 2 - 1; b.jB[1] = b.rnd() * 2 - 1;
      b.jPeriod = 0.28 + 0.14 * b.rnd();
    }
    void engaged;
  }

  private emitAim(b: Brain, it: PlayerIntent): void {
    const r = b.r;
    const s = smoothstep(clamp(b.jT / b.jPeriod, 0, 1));
    const amp = b.target >= 0 && b.mode === 'fight' ? b.sk.jitter : b.sk.jitter * 0.6;
    const yaw = wrap(b.aimYaw + (b.jA[0] + (b.jB[0] - b.jA[0]) * s) * amp);
    const pitch = b.aimPitch + (b.jA[1] + (b.jB[1] - b.jA[1]) * s) * amp * 0.7;
    it.yaw = yaw;
    it.pitch = pitch;
    const my = r.y + COMBAT.muzzleHeight;
    const D = Math.max(COMBAT.minAimDist + 1, b.aimDist);
    const cp = Math.cos(pitch);
    it.hasAim = true;
    it.aimX = r.x + Math.sin(yaw) * cp * D;
    it.aimY = my + Math.sin(pitch) * D;
    it.aimZ = r.z + Math.cos(yaw) * cp * D;
  }

  /** would the current shot line pass through a teammate before the aim point (within `reach` m)? */
  private allyInLine(b: Brain, reach: number): boolean {
    const r = b.r;
    const ox = r.x, oy = r.y + COMBAT.muzzleHeight, oz = r.z;
    const cp = Math.cos(b.aimPitch);
    const dx = Math.sin(b.aimYaw) * cp, dy = Math.sin(b.aimPitch), dz = Math.cos(b.aimYaw) * cp;
    const L = Math.min(b.aimDist, reach);
    for (const o of this.world.runners) {
      if (o === r || !o.alive || o.team !== r.team) continue;
      const qx = o.x - ox, qy = o.y + 0.6 - oy, qz = o.z - oz;
      const t = qx * dx + qy * dy + qz * dz;
      if (t < 0.3 || t > L) continue;
      const px = qx - dx * t, py = qy - dy * t, pz = qz - dz * t;
      if (px * px + py * py * 0.5 + pz * pz < 0.65 * 0.65) return true;
    }
    return false;
  }
}

export { SKILLS as BOT_SKILLS, type SkillProfile as BotSkillProfile };
