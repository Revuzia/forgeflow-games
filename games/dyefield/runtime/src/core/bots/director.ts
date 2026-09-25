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

import type { PlayerIntent, TeamId } from '../types.ts';
import type { MatchWorld } from '../match/world.ts';
import type { Runner } from '../runner.ts';
import type { BotSkill } from '../match/roster.ts';
import type { NavGraph } from './nav.ts';
import { EDGE_CLIMB, EDGE_JUMP, EDGE_WALK } from './nav.ts';
import { hash32, mulberry32 } from '../rng.ts';
import { COMBAT, MOVE, TANK, TICK } from '../config.ts';
import { streamFire, type StreamFire } from '../combat/kits.ts';

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

type Mode = 'wait' | 'dead' | 'paint' | 'fight' | 'cover' | 'chase' | 'refill';

interface Zone {
  cx: number; cy: number; cz: number;   // centroid
  ix: number; iz: number;               // 4 m cell
  node: number;                         // a nav node inside it
  area: number;                         // m² of floor
  samples: Int32Array;                  // atlas texel ids (floor)
  need: [number, number, number];       // per viewing team: un-owned share (enemy dye counts 1.5×), 0..1.5
  enemyShare: [number, number, number];
}

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
      const z: Zone = { cx, cy, cz, ix, iz, node, area, samples: Int32Array.from(samples), need: [1, 1, 1], enemyShare: [0, 0, 0] };
      const zi = this.zones.length;
      this.zones.push(z);
      const gk = iz * 1000 + ix;
      let g = this.zoneGrid.get(gk);
      if (!g) { g = []; this.zoneGrid.set(gk, g); }
      g.push(zi);
    }
  }

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

    if (b.mode !== 'refill' && r.tank < TANK.low + 0.5) this.enterRefill(b);
    if (b.mode === 'refill') {
      if (r.tank >= REFILL_TO) { b.mode = 'paint'; b.goalZone = -1; b.path.length = 0; }
      else if (tgt && reacted && tgtVisible && dT < 6.5 && r.tank >= 45) b.mode = 'fight';
    }
    if (b.mode !== 'refill') {
      if (tgt && reacted && (tgtVisible || b.lostT < 1.2)) {
        // losing a duel at low hp → slick away (rolled once per engagement)
        if (!b.retreatRolled) { b.retreatRolled = true; b.retreatWanted = b.rnd() < 0.6; }
        if (b.sk.retreatHp > 0 && b.retreatWanted && r.hp < b.sk.retreatHp && tgt.hp > r.hp + 10 && dT < b.sk.engage + 2) {
          this.enterRefill(b);
        } else if (dT <= b.sk.engage + 1.5 || !tgtVisible) {
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
    for (const e of w.runners) {
      if (e.team === r.team || !e.alive) continue;
      const d = Math.hypot(e.x - r.x, e.y - r.y, e.z - r.z);
      if (d > 34) continue;
      if (!w.canSee(r, e)) continue;
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
        // hop + side-step for 0.45 s
        const a = b.rnd() * TAU;
        b.nudgeX = Math.sin(a); b.nudgeZ = Math.cos(a);
        b.nudgeUntil = now + 27;
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
  }

  private selectGoal(b: Brain): void {
    const r = b.r, now = this.world.tick;
    const own = b.own;
    const eps = this.world.pads[own === 1 ? 'B' : 'A'];
    // allies' goals (crowding)
    const allyGoals: number[] = [];
    for (const o of this.brains) if (o && o !== b && o.own === own && o.goalZone >= 0 && o.r.alive) allyGoals.push(o.goalZone);
    const top: number[] = [], topS: number[] = [];
    const K = 6;
    for (let zi = 0; zi < this.zones.length; zi++) {
      if (zi === b.goalZone) continue;
      const z = this.zones[zi];
      const gain = z.area * z.need[own];
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
    b.paintRetargetAt = now + Math.round((0.3 + 0.3 * b.rnd()) / TICK);
    // one pass over the zone samples in range: dot products, not angles; a fixed top-3, no allocation
    const cx0 = Math.floor((r.x - PAINT_MAX + 200) / ZONE), cx1 = Math.floor((r.x + PAINT_MAX + 200) / ZONE);
    const cz0 = Math.floor((r.z - PAINT_MAX + 200) / ZONE), cz1 = Math.floor((r.z + PAINT_MAX + 200) / ZONE);
    const ml = Math.hypot(b.mvx, b.mvz);
    const moving = ml > 0.3;
    const adx = Math.sin(b.aimYaw), adz = Math.cos(b.aimYaw);
    const mdx = moving ? b.mvx / ml : adx, mdz = moving ? b.mvz / ml : adz;
    const minCos = Math.cos(1.0);                      // ahead / to the side of travel, never behind
    const min2 = PAINT_MIN * PAINT_MIN, max2 = PAINT_MAX * PAINT_MAX;
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
      if (d < PAINT_MIN || d > PAINT_MAX) continue;
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
    if (!nav.path(start, goal, b.path, b.edgeExtra)) { b.path.length = 0; return false; }
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
    b.pk = b.path.length > 1 ? 1 : 0;
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

    if (b.mode === 'fight' && engaged) {
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
    const canTravel = !engaged && b.climbPhase !== 2 && !(b.mode === 'refill' && b.holding) && !(climbing && b.climbPhase === 3);
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
    if (engaged) {
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
    } else if (b.slickTravel || b.mode === 'refill' || climbing && b.climbPhase === 3) {
      this.aimAlongMove(b);
      hardStop = true;
    } else if (b.climbPhase === 2) {
      wantFire = this.aimAtClimbWall(b);
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
    // teammates: droplets pass through them (no friendly fire, no ink lost), but a bot never OPENS fire
    // through a teammate, and stops only for one at point blank (a burst doesn't flicker around allies)
    if (wantFire && !b.fireOn && this.allyInLine(b, 12)) wantFire = false;
    if (b.fireOn && this.allyInLine(b, 2.5)) { wantFire = false; hardStop = true; }
    // hysteresis: a burst lasts ≥ 0.35 s and a painting pause ≥ 0.4 s, so the body (which faces the aim
    // while firing, the travel direction otherwise) never swings back and forth; a fight opens fire at once
    if (b.fireOn) {
      if (!wantFire && (hardStop || now - b.fireSince >= 21)) { b.fireOn = false; b.fireSince = now; }
    } else if (wantFire && now - b.fireSince >= (engaged ? 9 : 24)) { b.fireOn = true; b.fireSince = now; }
    wantFire = b.fireOn && !(r.tank < b.fire.tankPerShot + 0.5);
    let fire = wantFire && r.canFire();

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

    it.fire = fire;
    it.slick = slick;
    it.jump = jump;
    this.emitAim(b, it);
    // world move → camera-relative stick (forward = (sin yaw, cos yaw), right = (−cos yaw, sin yaw))
    const cy = it.yaw;
    const fx = Math.sin(cy), fz = Math.cos(cy);
    it.moveZ = b.mvx * fx + b.mvz * fz;
    it.moveX = b.mvx * -fz + b.mvz * fx;
    void nav;
  }

  /** path following; returns a world direction, a 0..1 speed, jump and climb flags */
  private follow(b: Brain): { x: number; z: number; s: number; jump: boolean; climb: boolean } {
    const r = b.r, nav = this.nav, now = this.world.tick;
    const out = { x: 0, z: 0, s: 0, jump: false, climb: false };
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
          else if (now - b.climbT > 180 || r.tank < b.fire.tankPerShot * 2) { this.failEdge(b, e); return out; }
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
        if (el > 1e-3) { out.x = ex / el; out.z = ez / el; }
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
    return err < 0.25 && r.tank >= b.fire.tankPerShot + 0.5;
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
