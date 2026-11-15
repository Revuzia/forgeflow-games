// DYEFIELD — the 3:00 match loop (CONTRACT §10.1 / §12): countdown freeze, horns, result, end lock,
// determinism and wall time, on the real Pier 18 collision + paint atlas, Rapier in plain Node.
//
//   node _harness/probe_match.ts            # full 180 s match ×2 (same seed) + ×1 (other seed)
//   node _harness/probe_match.ts --verbose
//   node _harness/probe_match.ts --mode ffa [--map pier18|lockwell|cinder] [--seeds 1,2,3]
//                                            # CHANGED(CORE) (CONTRACT_FFA §F4): FREE-FOR-ALL — 8 crews; countdown freeze,
//                                            # horns, shares sum to 1, a winner (strict, tie = draw), determinism.
//                                            # CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S6): scripted FFA matches on seeds 1,2,3
//                                            # (+ seed 1 replayed): the spawn-site gates (_harness/spawn_audit.ts: every
//                                            # runner washed ≥ 5× used ≥ 4 distinct sites, no respawn within 3 m of a runner
//                                            # or at one of its last 2 sites, ≥ 90 % of respawns unseen — the rate logged);
//                                            # the pool (maps.json ffaSites) and the spread start (distinct, a farthest-point
//                                            # pick within 2× of the best spread possible, seeded); spawn protection in FFA in
//                                            # both rules (blocks damage and knockback, ends on fire); no permanent pads and
//                                            # no lock (no push-out, no pad refill); the TEAMS TURF hash of this map unchanged.
//                                            # The FFA performance gate is PROCESS CPU TIME per match < 40 s: in effect a 2×
//                                            # raise of the old 20 s budget, justified by the cinder workload (the runners
//                                            # live now: ~2× the alive runner-seconds). CPU time is about as load-sensitive
//                                            # as wall time on this shared box — it is not a load-proof measure (numbers at
//                                            # the check)
// Both modes also run padFloor: CHANGED(SPAWNS) — no FFA world locks any floor (the drop pads and their lock are gone), a
// stream at a spawn site dyes it, and an old lock on a reused painter is cleared.
// CHANGED(WASHOUT): the default (TURF) run also checks that TURF has no score events, all-zero scores, endedBy 'horn' and
// no spawn protection (a respawned runner takes damage at once).
//   node _harness/probe_match.ts --rule washout [--map pier18]
//                                            # CHANGED(WASHOUT) (CONTRACT_WASHOUT §W8): WASHOUT — the limit ends a TEAMS and
//                                            # an FFA match early (endedBy 'limit', through end(): horn, freeze, result); the
//                                            # horn tie-breaks built with dev hooks (TEAMS score → share → draw; FFA score →
//                                            # fewer washed → share → draw); sea credit inside the 5 s window and none after
//                                            # it; spawn protection blocks damage (and knockback) for 2 s and ends when the
//                                            # runner fires; scripted WASHOUT matches (score events = credited washes,
//                                            # determinism); TURF on the same map: no protection, no score events.
//                                            # Follow-ups (skeptic review 2026-09-30): the per-map limits (data/maps.json
//                                            # <map>.washout, weapons.json fallback); a wash clears protection (never shown
//                                            # on a dead runner); a press that does nothing keeps it (special not ready, dry
//                                            # tank, sub on cooldown) and a special that starts ends it; dealing damage from
//                                            # any source ends it (a CLOUDBURST thrown before the wash, a direct hit; blocked
//                                            # damage keeps it); every 'score' event comes right after its 'washed' event
//
// The runners are driven by a SCRIPTED driver (not the BOTS lane's AI): each walks a lane toward mid,
// sweeping fire over the floor ahead; it aims at a visible enemy within range (MatchWorld.canSee, 10 Hz);
// below 15 % tank it slicks back through its own dye toward its pad until the tank is ~full. The
// script is seeded, so the whole match must replay bit-for-bit.
// Exit: 0 all pass · 1 a check failed · 2 setup failure.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRapier, PhysicsWorld, type Rapier } from '../runtime/src/core/physics.ts';
import { loadMapGeometry, type MapGeometry } from '../runtime/src/core/mapgeo.ts';
import { buildAtlas } from '../runtime/src/core/paint/atlas.ts';
import { Painter } from '../runtime/src/core/paint/painter.ts';
import { mapById, playableMaps, type MapDef } from '../runtime/src/core/data.ts';
import { TICK, MATCH } from '../runtime/src/core/config.ts';
import { emptyIntent, parseMatchMode, parseMatchRule, type MatchMode, type MatchRule, type PlayerIntent } from '../runtime/src/core/types.ts';
import { mulberry32, hash32 } from '../runtime/src/core/rng.ts';
import { MatchWorld, MATCH_FFA, WASHOUT, washoutLimitFor, type MatchResult, type MatchStats } from '../runtime/src/core/match/world.ts';
import { KIND_CLOUD, PSTATE_HOVER } from '../runtime/src/core/combat/projectiles.ts';
import { defaultRoster } from '../runtime/src/core/match/roster.ts';
import type { SimEvent } from '../runtime/src/core/match/events.ts';
import { SpawnAudit, spawnGates, type SpawnAuditSummary } from './spawn_audit.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERBOSE = process.argv.includes('--verbose');
const argv = process.argv.slice(2);
const argOf = (k: string, d: string): string => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
/** CHANGED(CORE): --mode teams (default) | ffa */
const MODE: MatchMode = parseMatchMode(argOf('--mode', 'teams'));
const MAP_ID = argOf('--map', 'pier18');
/** CHANGED(WASHOUT): --rule turf (default) | washout (the WASHOUT suite, both modes) */
const RULE: MatchRule = parseMatchRule(argOf('--rule', 'turf'));
/** CHANGED(SPAWNS): FFA — the scripted-match seeds (CONTRACT_FFA_SPAWNS §S6: 1,2,3; the first is replayed) */
const FFA_SEEDS = argOf('--seeds', '1,2,3').split(',').map((x) => Number(x) | 0).filter((x, i, a) => a.indexOf(x) === i);
/** CHANGED(SPAWNS): the TEAMS TURF world hash of the default scripted run (seed 1234) per map, measured on the code before
 *  CONTRACT_FFA_SPAWNS (core2/before_t2 snapshot, 2026-09-30) — FFA work must leave every one of them unchanged */
const TEAMS_TURF_1234: Record<string, string> = { pier18: 'b2bbe68c-302ad464', lockwell: '85323a32-95b8f088', cinder: 'ac402fba-2b8de69e' };

interface Check { name: string; pass: boolean; detail: string }
const checks: Check[] = [];
function check(name: string, pass: boolean, detail: string): void {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
}
const f2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const pct = (v: number): string => `${(v * 100).toFixed(1)} %`;
function log(...a: unknown[]): void { if (VERBOSE) console.log('   ', ...a); }

interface RunOut {
  hash: string; wallS: number; tickMsP99: number; tickMsMax: number; ticks: number;
  /** CHANGED(SPAWNS) (skeptic fix 2026-09-30): process CPU time (user + system, process.cpuUsage) over the same span as
   *  wallS (countdown + live loop); aliveTicks = Σ over live ticks of the runners alive (the KCC workload) */
  cpuS: number; aliveTicks: number;
  horns: Array<{ kind: string; tick: number }>; phases: Array<{ phase: string; tick: number }>;
  freeze: { maxDrift: number; shots: number; flips: number; phaseOk: boolean };
  endLock: { moved: number; shots: number; hashSame: boolean; projectiles: number };
  result: MatchResult | null;
  coverageAtEnd: { sun: number; gulf: number; neutral: number };
  /** CHANGED(CORE): Painter.coverageByTeam() at the horn */
  sharesAtEnd: number[];
  /** CHANGED(CORE): FFA — crews in play, distinct roster crews. CHANGED(SPAWNS): every runner's start site
   *  (Runner.spawnSite at construction) and its max offset (m) from it at construction */
  crews: number; distinctCrews: number; startSites: number[]; startSiteOff: number;
  /** CHANGED(SPAWNS): FFA — the spawn audit of the match (null in teams) */
  spawn: SpawnAuditSummary | null;
  stats: MatchStats; washes: number; special: number[]; painted: number[]; refills: number; countdownTicks: number;
  /** CHANGED(WASHOUT): 'score' events seen (countdown + live + after the end), 'washed' events with a credited washer,
   *  scores() at the end, washed count per crew id */
  scoreEvents: number; creditedWashed: number; scores: number[]; washedBy: number[];
  /** CHANGED(WASHOUT) follow-up: 'score' events not right after their own 'washed' event, and WASHOUT credited 'washed'
   *  events not followed at once by their 'score' (0 = the order the contract promises) */
  scoreOrderBad: number;
}

/** CHANGED(WASHOUT) follow-up (CONTRACT_WASHOUT §W2): the number of order faults in one tick's drained events — a 'score'
 *  whose previous event is not the 'washed' of the same wash (by = its pid, the washer's crew = its crew), or (WASHOUT) a
 *  credited 'washed' whose next event is not its 'score' */
function scoreOrderFaults(ev: readonly SimEvent[], w: MatchWorld): number {
  let bad = 0;
  for (let k = 0; k < ev.length; k++) {
    const e = ev[k];
    if (e.t === 'score') {
      const p = ev[k - 1];
      if (!p || p.t !== 'washed' || p.by !== e.pid || w.runners[e.pid]?.team !== e.crew) bad++;
    } else if (w.rule === 'washout' && e.t === 'washed' && e.by !== null) {
      const nx = ev[k + 1];
      if (!nx || nx.t !== 'score' || nx.pid !== e.by) bad++;
    }
  }
  return bad;
}

/** CHANGED(CORE): FFA — the scripted runner's home and the waypoint bounds. CHANGED(SPAWNS): the home is the runner's
 *  current spawn site (re-homed at each of its respawns) */
interface ScriptHome { x: number; z: number; lo: [number, number]; hi: [number, number] }

/** Deterministic scripted driver for one runner. */
class Script {
  private readonly rnd: () => number;
  private readonly lane: number;
  private readonly s: number;               // −1 SUNCREW side (−Z), +1 GULF CREW side
  private wp = { x: 0, z: 0 };
  private refill = false;
  private lastX = 0; private lastZ = 0;
  private aim: { x: number; y: number; z: number } | null = null;
  private jumpT = 0;
  /** CHANGED(CORE): FFA — waypoints around the home (no halves), inside the map bounds. CHANGED(SPAWNS): the home is the
   *  current spawn site */
  private readonly home: ScriptHome | null;
  /** CHANGED(SPAWNS): FFA refill without a pad — the runner's position 1–2 s ago (its own dye trail: the stream sweeps
   *  the floor ahead of it), ticks spent refilling, and no refill before this tick after one that found no own dye */
  private crumbX = 0; private crumbZ = 0; private crumbAX = 0; private crumbAZ = 0;
  private refillT = 0; private noRefillUntil = 0;
  constructor(seed: number, i: number, team: number, home: ScriptHome | null = null) {
    this.rnd = mulberry32(hash32(seed, i, 0x5c417));
    this.s = team === 1 ? -1 : 1;
    const lanes = [-17, -6, 6, 17];
    this.lane = lanes[i % 4] * (this.s < 0 ? 1 : -1);
    this.home = home;
    if (home) { this.crumbX = this.crumbAX = home.x; this.crumbZ = this.crumbAZ = home.z; }
    this.pick();
  }
  /** CHANGED(SPAWNS): FFA — the runner respawned at a new site: waypoints around it from now on (a full tank: no refill) */
  rehome(x: number, z: number): void {
    if (!this.home) return;
    this.home.x = x; this.home.z = z;
    this.crumbX = this.crumbAX = x; this.crumbZ = this.crumbAZ = z;
    this.refill = false; this.refillT = 0;
    this.pick();
  }
  private pick(): void {
    if (this.home) {
      const h = this.home, a = this.rnd() * Math.PI * 2, d = 5 + this.rnd() * 14;
      this.wp = { x: Math.max(h.lo[0], Math.min(h.hi[0], h.x + Math.sin(a) * d)), z: Math.max(h.lo[1], Math.min(h.hi[1], h.z + Math.cos(a) * d)) };
      return;
    }
    const z = this.s * (-4 + this.rnd() * 22);                  // own half … a bit past mid
    const x = this.lane + (this.rnd() - 0.5) * 10;
    this.wp = { x: Math.max(-19, Math.min(19, x)), z };
  }
  think(w: MatchWorld, i: number, it: PlayerIntent, tick: number): void {
    const r = w.runners[i];
    Object.assign(it, emptyIntent());
    it.yaw = r.yaw;
    if (!r.alive) return;
    if (r.tank < 15 && tick >= this.noRefillUntil && !this.refill) { this.refill = true; this.refillT = 0; }   // noRefillUntil: FFA only (0 in teams)
    if (this.refill && r.tank > 95) { this.refill = false; this.pick(); }
    // 10 Hz perception: nearest visible enemy within 11 m
    if (tick % 6 === i % 6) {
      this.aim = null;
      let best = 11;
      for (const e of w.runners) {
        if (e.team === r.team || !e.alive) continue;
        const d = Math.hypot(e.x - r.x, e.z - r.z);
        if (d < best && w.canSee(r, e)) { best = d; this.aim = { x: e.x, y: e.y + 0.6, z: e.z }; }
      }
    }
    let tx: number, tz: number;
    if (this.refill && this.home) {
      // CHANGED(SPAWNS): FFA has no own pad — drink standing on own dye; off it, head back along the trail (1–2 s ago);
      // no slick after 6 s: give up for 5 s (the tank is near dry: sweep on, a respawn refills it)
      it.slick = true;
      if (w.painter.teamUnder(r.x, r.y, r.z) === r.team) { tx = r.x; tz = r.z; } else { tx = this.crumbAX; tz = this.crumbAZ; }
      if (++this.refillT > 360 && r.state !== 'slick') { this.refill = false; this.noRefillUntil = tick + 300; this.pick(); }
    } else if (this.refill) {
      const pad = w.padOf(r)!;                                  // teams: the team pad (CHANGED(SPAWNS): FFA has none)
      tx = pad.x; tz = pad.z;
      it.slick = true;
    } else {
      tx = this.wp.x; tz = this.wp.z;
      it.fire = true;
      if (this.aim) { it.hasAim = true; it.aimX = this.aim.x; it.aimY = this.aim.y; it.aimZ = this.aim.z; }
      else { it.pitch = -0.32; }
    }
    const dx = tx - r.x, dz = tz - r.z;
    const d = Math.hypot(dx, dz);
    if (!this.refill && d < 1.5) this.pick();
    if (d > 0.3) { it.yaw = Math.atan2(dx, dz); it.moveZ = 1; }
    if (!it.hasAim) it.pitch = this.refill ? 0 : -0.32;
    // stuck: < 0.6 m in 2 s → new waypoint + a hop
    if (tick % 120 === 0) {
      const moved = Math.hypot(r.x - this.lastX, r.z - this.lastZ);
      if (moved < 0.6 && d > 2) { this.pick(); this.jumpT = 10; }
      this.lastX = r.x; this.lastZ = r.z;
    }
    if (this.jumpT > 0) { it.jump = this.jumpT === 10; this.jumpT--; }
    // CHANGED(SPAWNS): FFA — the trail crumbs (the refill target), once a second while painting
    if (this.home && !this.refill && tick % 60 === i % 60) { this.crumbAX = this.crumbX; this.crumbAZ = this.crumbZ; this.crumbX = r.x; this.crumbZ = r.z; }
  }
}

async function runMatch(R: Rapier, def: MapDef, geo: MapGeometry, seed: number,
  opt: { mode?: MatchMode; rule?: MatchRule } = {}): Promise<RunOut> {
  const mode = opt.mode ?? MODE, rule = opt.rule ?? 'turf';   // CHANGED(WASHOUT): the WASHOUT suite plays scripted WASHOUT matches
  const sc = def.scoring ?? { wallWeight: 0.35, floorMinNy: 0.45 };
  const atlas = buildAtlas(geo.paint, geo.atlasSize, { wallWeight: sc.wallWeight, floorMinNy: sc.floorMinNy });
  const painter = new Painter(atlas);
  const physics = new PhysicsWorld(R, geo);
  const roster = defaultRoster({ humanKit: 'mist-rasp', humanName: 'Probe', seed, skill: 'swell', mode });
  const world = rule === 'washout'
    ? new MatchWorld({ def, geo, physics, painter, roster, seed, durationS: MATCH.durationS, countdownS: MATCH.countdownS, mode, rule })
    : new MatchWorld({ def, geo, physics, painter, roster, seed, durationS: MATCH.durationS, countdownS: MATCH.countdownS, mode });
  const n = world.runners.length;
  const intents: PlayerIntent[] = world.runners.map(() => emptyIntent());
  const b = def.bounds ?? { min: [-28, -2, -42], max: [28, 12, 42] };
  // CHANGED(SPAWNS): FFA — each script's home is its runner's start site (re-homed at every respawn, below)
  const homeOf = (r: MatchWorld['runners'][number]): ScriptHome | null => {
    const s = mode === 'ffa' ? world.spawnSiteOf(r) : null;
    return s ? { x: s.x, z: s.z, lo: [b.min[0] + 2, b.min[2] + 2], hi: [b.max[0] - 2, b.max[2] - 2] } : null;
  };
  const scripts = world.runners.map((r, i) => new Script(seed, i, r.team, homeOf(r)));
  const startSites = world.runners.map((r) => r.spawnSite);
  const startSiteOff = mode === 'ffa' ? world.runners.reduce((m, r) => { const s = world.spawnSiteOf(r); return Math.max(m, s ? Math.hypot(r.x - s.x, r.z - s.z) : Infinity); }, 0) : 0;
  const audit = mode === 'ffa' ? new SpawnAudit(world) : null;
  const onSpawns = (ev: readonly SimEvent[]): void => {
    if (!audit) return;
    audit.observe(ev);
    for (const e of ev) if (e.t === 'spawn' && world.runners[e.pid].respawns > 0) scripts[e.pid].rehome(e.x, e.z);
  };
  let scoreEvents = 0, creditedWashed = 0, scoreOrderBad = 0;
  const events: SimEvent[] = [];
  const horns: RunOut['horns'] = [];
  const phases: RunOut['phases'] = [];
  const times: number[] = [];
  const t0 = performance.now();
  const cpu0 = process.cpuUsage();
  let aliveTicks = 0;

  // countdown: everyone pushes forward, fires and jumps — nothing may move, fire or paint
  const start = world.runners.map((r) => ({ x: r.x, z: r.z }));
  let maxDrift = 0, cdShots = 0;
  const flips0 = painter.flips;
  let countdownTicks = 0;
  let phaseOk = world.phase === 'countdown';
  while (world.phase === 'countdown' && countdownTicks < 1000) {
    for (let i = 0; i < n; i++) {
      const it = intents[i];
      Object.assign(it, emptyIntent());
      it.moveZ = 1; it.fire = true; it.jump = (countdownTicks & 7) === 0; it.slick = (countdownTicks & 16) !== 0; it.yaw = world.runners[i].yaw;
    }
    world.step(intents);
    countdownTicks++;
    events.length = 0;
    world.drainEvents(events);
    onSpawns(events);                                           // CHANGED(SPAWNS): the match-start 'spawn' events
    for (const e of events) {
      if (e.t === 'shot') cdShots++;
      if (e.t === 'horn') horns.push({ kind: e.kind, tick: world.tick });
      if (e.t === 'phase') phases.push({ phase: e.phase, tick: world.tick });
      if (e.t === 'score') scoreEvents++;
    }
    if (world.phase === 'countdown') {
      for (let i = 0; i < n; i++) maxDrift = Math.max(maxDrift, Math.hypot(world.runners[i].x - start[i].x, world.runners[i].z - start[i].z));
    }
  }
  const cdFlips = painter.flips - flips0;
  phaseOk = phaseOk && world.phase === 'live';

  // live: scripted play until the end horn
  while (world.phase === 'live') {
    for (let i = 0; i < n; i++) scripts[i].think(world, i, intents[i], world.tick);
    const a = performance.now();
    world.step(intents);
    times.push(performance.now() - a);
    for (const r of world.runners) if (r.alive) aliveTicks++;
    events.length = 0;
    world.drainEvents(events);
    onSpawns(events);                                           // CHANGED(SPAWNS): the respawn 'spawn' events
    for (const e of events) {
      if (e.t === 'horn') horns.push({ kind: e.kind, tick: world.tick });
      if (e.t === 'phase') phases.push({ phase: e.phase, tick: world.tick });
      if (e.t === 'score') scoreEvents++;
      if (e.t === 'washed' && e.by !== null) creditedWashed++;
    }
    scoreOrderBad += scoreOrderFaults(events, world);           // CHANGED(WASHOUT) follow-up
    if (world.tick > 20000) break;
  }
  const wallS = (performance.now() - t0) / 1000;
  const cpu = process.cpuUsage(cpu0);
  const cpuS = (cpu.user + cpu.system) / 1e6;
  const coverageAtEnd = painter.coverage();
  const sharesAtEnd = Array.from(painter.coverageByTeam());
  const hashAtEnd = world.hash();
  const paintHashAtEnd = painter.hash();

  // after the end: inputs are ignored — no shots, no horizontal motion, no paint
  const endPos = world.runners.map((r) => ({ x: r.x, z: r.z }));
  let endShots = 0;
  for (let k = 0; k < 120; k++) {
    for (let i = 0; i < n; i++) { const it = intents[i]; Object.assign(it, emptyIntent()); it.moveZ = 1; it.fire = true; it.slick = k > 60; }
    world.step(intents);
    events.length = 0;
    world.drainEvents(events);
    for (const e of events) { if (e.t === 'shot' || e.t === 'splat' || e.t === 'hit') endShots++; if (e.t === 'score') scoreEvents++; }
  }
  let moved = 0;
  for (let i = 0; i < n; i++) moved = Math.max(moved, Math.hypot(world.runners[i].x - endPos[i].x, world.runners[i].z - endPos[i].z));

  const sorted = times.slice().sort((a, b) => a - b);
  const out: RunOut = {
    hash: hashAtEnd, wallS, ticks: times.length, cpuS, aliveTicks,
    tickMsP99: sorted[Math.floor(sorted.length * 0.99)] ?? 0, tickMsMax: sorted[sorted.length - 1] ?? 0,
    horns, phases,
    freeze: { maxDrift, shots: cdShots, flips: cdFlips, phaseOk },
    endLock: { moved, shots: endShots, hashSame: painter.hash() === paintHashAtEnd, projectiles: world.projectiles.count },
    result: world.result, coverageAtEnd, sharesAtEnd, stats: { ...world.stats },
    crews: world.crews.length, distinctCrews: new Set(world.runners.map((r) => r.team)).size, startSites, startSiteOff,
    spawn: audit ? audit.summary() : null,
    washes: world.runners.reduce((s, r) => s + r.washes, 0),
    special: world.runners.map((r) => r.special), painted: world.runners.map((r) => r.painted),
    refills: world.runners.reduce((s, r) => s + r.refillsFromLow, 0), countdownTicks,
    scoreEvents, creditedWashed, scores: world.scores().slice(), scoreOrderBad,
    washedBy: world.runners.reduce((acc, r) => { acc[r.team] += r.washedCount; return acc; }, new Array<number>(9).fill(0)),
  };
  physics.dispose();
  return out;
}

async function main(): Promise<number> {
  const t0 = performance.now();
  const def = mapById(MAP_ID);
  let R: Rapier, geo: MapGeometry;
  try { R = await loadRapier(); geo = await loadMapGeometry(def); } catch (e) { console.log('SETUP FAILED:', (e as Error).stack ?? e); return 2; }
  if (RULE === 'washout') return washoutMain(R, def, geo, t0);   // CHANGED(WASHOUT): the WASHOUT suite
  const SEED = 1234;
  // CHANGED(SPAWNS): FFA plays the S6 seeds (default 1,2,3: A = the first, B = its replay, C = the second, then the rest);
  // teams keeps seed 1234 (×2) and 1235
  const ffaMode = MODE === 'ffa';
  const seedA = ffaMode ? FFA_SEEDS[0] : SEED, seedC = ffaMode ? (FFA_SEEDS[1] ?? SEED + 1) : SEED + 1;
  const seedsMore = ffaMode ? FFA_SEEDS.slice(2) : [];
  console.log(`map ${MAP_ID} · ${ffaMode ? 'FREE-FOR-ALL · ' : ''}match ${MATCH.durationS} s + countdown ${MATCH.countdownS} s · 8 scripted runners · seed ${seedA} (×2) and ${[seedC, ...seedsMore].join(', ')}`);
  if (ffaMode) {
    // CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S3/§S6): replaces the drop-pad rules
    const np = await ffaNoPads(R, def, geo);
    check('FFA: no permanent pads and no lock — crewPads empty, no pad on any runner (padOf null), an old painter lock cleared; a runner standing on a foe\'s spawn site is not pushed; holding SHIFT on its own site (neutral floor) neither slicks nor refills',
      np.ok, np.detail);
    const sp = await ffaStartSpread(R, def, geo);
    check('FFA site pool + spread start: spawnSites = maps.json ffaSites (16–24, the first 8 = ffaSpawns, yaw in radians); per seed the 8 start sites are distinct, their smallest gap ≥ ½ the best possible 8-site spread (the farthest-point bound), one \'spawn\' event per runner at construction; the seeds start differently',
      sp.ok, sp.detail);
    for (const rule of ['turf', 'washout'] as MatchRule[]) {
      const pr = await ffaProtection(R, def, geo, rule);
      check(`FFA ${rule.toUpperCase()} spawn protection (both rules): ${WASHOUT.protectS} s after a respawn at a new site — foe damage and knockback blocked; firing ends it at once, then a hit lands; none at the match start`,
        pr.ok, pr.detail);
    }
  }
  {
    // review F2 → CHANGED(SPAWNS) (both modes, so `npm run probe` keeps it): no FFA pad lock any more
    const pf = await padFloor(R, def, geo, SEED);
    check('no FFA pad lock (CHANGED(SPAWNS)): an FFA world clears an old lock and locks nothing; a foe stream at a spawn site dyes its floor (teamUnder = the shooter\'s crew); crew weights cover the whole atlas; a teams world on the same painter stays unlocked',
      pf.ok, pf.detail);
  }
  console.log('-'.repeat(100));
  const a = await runMatch(R, def, geo, seedA);
  log(`run A: ${a.wallS.toFixed(2)} s, hash ${a.hash}`);
  const b = await runMatch(R, def, geo, seedA);
  log(`run B: ${b.wallS.toFixed(2)} s, hash ${b.hash}`);
  const c = await runMatch(R, def, geo, seedC);
  log(`run C: ${c.wallS.toFixed(2)} s, hash ${c.hash}`);
  const more: RunOut[] = [];
  for (const sd of seedsMore) { more.push(await runMatch(R, def, geo, sd)); log(`run seed ${sd}: ${more[more.length - 1].wallS.toFixed(2)} s, hash ${more[more.length - 1].hash}`); }

  const cd = Math.round(MATCH.countdownS / TICK), dur = Math.round(MATCH.durationS / TICK);
  check('countdown: 3 s with inputs frozen (no movement, no shots, no paint), then live',
    a.countdownTicks === cd && a.freeze.maxDrift < 0.02 && a.freeze.shots === 0 && a.freeze.flips === 0 && a.freeze.phaseOk,
    `${a.countdownTicks} ticks (${f2(a.countdownTicks * TICK)} s) of countdown; max horizontal drift ${a.freeze.maxDrift.toFixed(4)} m while pushing, shots ${a.freeze.shots}, texels flipped ${a.freeze.flips}`);
  const wantHorns = [
    { kind: 'start', tick: cd }, { kind: 'minute', tick: cd + dur - Math.round(MATCH.minuteHornS / TICK) },
    { kind: 'final10', tick: cd + dur - Math.round(MATCH.finalHornS / TICK) }, { kind: 'end', tick: cd + dur },
  ];
  const hornsOk = a.horns.length === 4 && wantHorns.every((h, i) => a.horns[i].kind === h.kind && a.horns[i].tick === h.tick);
  check('horns: start → minute (60 s left) → final10 (10 s left) → end, on the exact ticks',
    hornsOk,
    `${a.horns.map((h) => `${h.kind}@${h.tick}`).join(' → ')} (want ${wantHorns.map((h) => `${h.kind}@${h.tick}`).join(' → ')})`);
  check('phase events: countdown → live → ended',
    a.phases.map((p) => p.phase).join(',') === 'countdown,live,ended' && a.phases[0].tick === 1 && a.phases[1].tick === cd && a.phases[2].tick === cd + dur,
    `${a.phases.map((p) => `${p.phase}@${p.tick}`).join(' → ')} (the constructor's countdown event is drained after tick 1)`);
  const r = a.result;
  if (MODE === 'ffa') {
    const sh = r?.shares ?? [];
    const sum = sh.reduce((x, v) => x + v, 0);
    const st = r?.standings ?? [];
    let best = -Infinity, tied: number[] = [];
    for (let k = 1; k < sh.length; k++) { if (!st.some((x) => x.crew === k)) continue; if (sh[k] > best) { best = sh[k]; tied = [k]; } else if (sh[k] === best) tied.push(k); }
    const winnerOk = !!r && (tied.length === 1 ? r.winner === tied[0] && (r.tied ?? []).length === 0 : r.winner === 0 && (r.tied ?? []).join() === tied.join());
    check('FFA: 8 crews (one per runner), every runner starts on its own start site (8 distinct sites of the pool)',
      a.crews === 8 && a.distinctCrews === 8 && a.startSiteOff < 0.3 && new Set(a.startSites).size === 8 && a.startSites.every((s) => s >= 0),
      `crews in play ${a.crews}, distinct runner crews ${a.distinctCrews}, start sites ${a.startSites.join(',')}, max start offset from the site ${a.startSiteOff.toFixed(3)} m`);
    // CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S6): the spawn-site gates over the scripted matches of every seed (A, C, …)
    const audited = [{ seed: seedA, x: a }, { seed: seedC, x: c }, ...seedsMore.map((sd, k) => ({ seed: sd, x: more[k] }))];
    for (const [name, pass, detail] of spawnGates(audited.map(({ seed, x }) => ({ label: `s${seed}`, s: x.spawn! })))) check(`FFA spawn sites: ${name}`, pass, detail);
    check('FFA result: shares by crew sum to 1, equal Painter.coverageByTeam() at the horn, standings of 8, strict winner (tie = draw)',
      !!r && Math.abs(sum - 1) < 1e-9 && sh.length === 9 && sh.every((v, k) => v === a.sharesAtEnd[k]) && st.length === 8 && winnerOk && st.every((x) => x.share > 0),
      r ? `${st.map((x) => `#${x.rank} ${x.name} (crew ${x.crew}) ${pct(x.share)}`).join(' · ')} · neutral ${pct(sh[0])} (sum ${sum.toFixed(12)}) → winner ${r.winner}${r.winner === 0 ? ` (draw: ${(r.tied ?? []).join(', ')})` : ''}` : 'no result');
  } else {
  const sum = r ? r.sun + r.gulf + r.neutral : NaN;
  const winnerOk = r ? r.winner === (r.sun > r.gulf ? 1 : r.gulf > r.sun ? 2 : 0) : false;
  check('result: weighted coverage, sums to 1, strict winner, equals Painter.coverage() at the horn',
    !!r && Math.abs(sum - 1) < 1e-9 && winnerOk && r.sun > 0 && r.gulf > 0 && r.sun === a.coverageAtEnd.sun && r.gulf === a.coverageAtEnd.gulf,
    r ? `SUNCREW ${pct(r.sun)} · GULF CREW ${pct(r.gulf)} · neutral ${pct(r.neutral)} (sum ${sum.toFixed(12)}) → winner ${r.winner}` : 'no result');
  }
  check('after the end: inputs ignored (no motion, no shots, no paint), pool empty',
    // < 1 cm: gravity can still settle a runner a few mm on an inclined belt (Lockwell measured 6 mm / 2 s); input- or
    // belt-driven motion would be decimetres (the pre-fix conveyor carry was 4.2 m / 2 s), so 1 cm still catches it
    a.endLock.moved < 0.01 && a.endLock.shots === 0 && a.endLock.hashSame && a.endLock.projectiles === 0,
    `max horizontal motion ${a.endLock.moved.toExponential(1)} m over 2 s of pushed inputs, shot/splat/hit events ${a.endLock.shots}, paint unchanged ${a.endLock.hashSame}, projectiles ${a.endLock.projectiles}`);
  const s = a.stats;
  check('the match is played: shots, splats, hits and washes happen; nothing dropped',
    s.shots > 1000 && s.splats > 3000 && s.hits > 5 && a.washes + s.seaWashes >= 1 && s.projectilesDropped === 0 && s.eventsDropped === 0,
    `shots ${s.shots}, dry ${s.dry}, splats ${s.splats}, hits ${s.hits}, washes ${s.washes} (sea ${s.seaWashes}), slick entries ${s.slicks}, refills from < 20 % ${a.refills}, dropped: projectiles ${s.projectilesDropped} events ${s.eventsDropped}`);
  check('special meters fill from painting (weapons.json specialCharge)',
    a.special.every((v) => v > 0) && a.painted.every((v) => v > 0),
    `meters ${a.special.map((v) => v.toFixed(2)).join(' ')} · painted m² ${a.painted.map((v) => v.toFixed(0)).join(' ')}`);
  check('determinism: same seed → identical world hash; another seed → a different one',
    a.hash === b.hash && a.hash !== c.hash && more.every((x) => x.hash !== a.hash && x.hash !== c.hash),
    `seed ${seedA}: ${a.hash} / ${b.hash}; seed ${seedC}: ${c.hash}${more.map((x, k) => `; seed ${seedsMore[k]}: ${x.hash}`).join('')}`);
  // CHANGED(SPAWNS) (skeptic fix 2026-09-30): FFA gates PROCESS CPU TIME per match (process.cpuUsage, user + system) against
  // 40 s; TEAMS keeps the 20 s wall gate. Stated plainly (CONTROLS lane review, 2026-09-30): CPU time is NOT a load-proof
  // measure — on this shared box it is about as load-sensitive as wall time (contention for cores, caches and clock
  // boost inflates the CPU seconds a process burns much as it inflates its wall seconds: in the numbers below the loaded
  // CPU s run close to the same-minute wall s). What the change really is: a 2× budget raise (20 s → 40 s), and the
  // justification is the cinder WORKLOAD, not the clock. Before CONTRACT_FFA_SPAWNS the scripted Cinder runners drowned
  // (~275 sea washes a match) and spent half the match dead; with the spawn sites they live, and each living runner is a
  // Rapier KCC step — cinder's alive runner-seconds doubled (601–721 → 1224–1235), so its cost doubled with them.
  // Measured 2026-09-30 on the loaded box (~90 % CPU from other sessions), HEAD (8fd2006e + a cpuUsage copy) and this
  // tree at the same minute, CPU s per match (alive runner-s):
  //   cinder   HEAD  9.31 /  6.59 /  9.91   (601 / 601 / 721)       tree 20.47 / 17.14 / 13.20 / 13.23  (1224–1235)
  //   lockwell HEAD 21.25 / 18.34 / 16.73   (1425 / 1425 / 1428)    tree 20.31 / 18.70 / 16.25 / 13.72  (1328–1332)
  //   pier18   HEAD 11.70 / 10.34 /  7.52   (1371 / 1371 / 1330)    tree  8.86 /  8.34 /  7.94 /  6.23  (1341–1386)
  // CPU per alive runner-second is the same on both (cinder HEAD 11.0–15.5 ms, tree 10.7–16.7 ms; lockwell 11.7–14.9 vs
  // 10.3–15.3; pier18 5.7–8.5 vs 4.5–6.6), so there is no per-runner regression. The same-minute wall times (cinder tree
  // 13.2–20.6 s; lockwell HEAD 18.1–20.3 s, i.e. HEAD fails the old gate there too) are in the same range as the CPU
  // seconds: both clocks carry the box's load, and switching clocks did not remove it — the 2× budget is what makes room.
  // Budget FFA_CPU_S = 40 s: 1.9× the heaviest match measured (HEAD lockwell 21.25 s, loaded, first match with JIT
  // warm-up), 3× the tree's lightest loaded full match (13.2 s) — room for the doubled cinder workload plus the load, still
  // well under the 3:00 the match simulates, and a 2× per-runner regression on the heaviest map (~40 s) trips it. A heavier
  // box load can still push a healthy match over it: confirm a timing FAIL with a rerun before calling it a regression.
  const FFA_CPU_S = 40;
  const runsT = [a, b, c, ...more];
  check(ffaMode
    ? `CPU time: a full 3:00 FFA match simulates in < ${FFA_CPU_S} s of process CPU (node, 8 runners; wall time is logged)`
    : 'wall time: a full 3:00 match simulates in < 20 s (node, 8 runners)',
    ffaMode ? runsT.every((x) => x.cpuS < FFA_CPU_S) : runsT.every((x) => x.wallS < 20),
    `${ffaMode ? 'wall ' : ''}${[a, b, c, ...more].map((x) => `${x.wallS.toFixed(2)} s`).join(' / ')} for ${a.ticks} live ticks; sim tick p99 ${a.tickMsP99.toFixed(3)} ms, max ${a.tickMsMax.toFixed(2)} ms (budget ${(TICK * 1000).toFixed(1)} ms) · process CPU ${[a, b, c, ...more].map((x) => `${x.cpuS.toFixed(2)} s`).join(' / ')} · alive runner-s ${[a, b, c, ...more].map((x) => (x.aliveTicks * TICK).toFixed(0)).join(' / ')}`);
  {
    // CHANGED(WASHOUT) (CONTRACT_WASHOUT §W8): TURF stays TURF — no score events, no scores, no limit, no protection
    const runs = [a, b, c, ...more];
    const rr = a.result;
    check('TURF: result rule turf · limit 0 · endedBy horn · scores all 0 · no score events (runs A, B, C)',
      !!rr && rr.rule === 'turf' && rr.limit === 0 && rr.endedBy === 'horn' && runs.every((x) => x.scoreEvents === 0 && x.scores.every((v) => v === 0) && !!x.result && x.result.scores.every((v) => v === 0)),
      rr ? `rule ${rr.rule}, limit ${rr.limit}, endedBy ${rr.endedBy}, score events ${runs.map((x) => x.scoreEvents).join('/')}, Σ scores ${runs.map((x) => x.scores.reduce((s, v) => s + v, 0)).join('/')} (washes credited ${runs.map((x) => x.creditedWashed).join('/')})` : 'no result');
    const tp = await turfNoProtection(R, def, geo, SEED, MODE);
    // CHANGED(SPAWNS): TEAMS TURF has no spawn protection; FFA TURF has it (CONTRACT_FFA_SPAWNS §S4)
    check(ffaMode
      ? 'TURF FFA: spawn protection after a respawn (CHANGED(SPAWNS): protectedT set, a foe hit 0.1 s later blocked, no knockback) · a sea wash 1 s after a foe hit is uncredited'
      : 'TURF: no spawn protection (a respawned runner: protectedT 0, a foe hit lands at once, knockback applies) · a sea wash 1 s after a foe hit is uncredited',
    tp.ok, tp.detail);
  }
  if (ffaMode) {
    // CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S6: "TEAMS hashes are unchanged"): this map's TEAMS TURF scripted run
    const want = TEAMS_TURF_1234[MAP_ID];
    const t = await runMatch(R, def, geo, SEED, { mode: 'teams', rule: 'turf' });
    check(`TEAMS TURF hash unchanged by the FFA spawn work: ${MAP_ID} teams seed ${SEED} = the value before CONTRACT_FFA_SPAWNS`,
      !!want && t.hash === want, `${t.hash} (want ${want ?? 'NO PINNED VALUE for this map'})`);
  }

  console.log('-'.repeat(100));
  const failed = checks.filter((x) => !x.pass);
  const verdict = failed.length ? `FAIL (${failed.length})` : 'OK';
  console.log(`probe_match: ${checks.length - failed.length}/${checks.length} checks pass · ${((performance.now() - t0) / 1000).toFixed(2)} s`);
  console.log(`RESULT: ${verdict}`);
  try {
    const dir = resolve(HERE, '_reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, MODE === 'ffa' ? `probe_match_ffa_${MAP_ID}.json` : MAP_ID === 'pier18' ? 'probe_match.json' : `probe_match_${MAP_ID}.json`), JSON.stringify({
      checks, verdict, runs: [a, b, c, ...more].map((x) => ({ hash: x.hash, wallS: x.wallS, tickMsP99: x.tickMsP99, tickMsMax: x.tickMsMax, result: x.result, stats: x.stats, horns: x.horns, spawn: x.spawn })),
      at: new Date().toISOString(),
    }, null, 2) + '\n', 'utf8');
  } catch { /* best-effort */ }
  return failed.length ? 1 : 0;
}

/** CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S3): FFA has no permanent pads and no lock. A painter carrying an old pad lock (a
 *  pre-SPAWNS session on the same arena) gets an FFA world: the lock is cleared and nothing is locked; crewPads (the view's
 *  compatibility field) is empty; no runner has a pad (padOf null, no own / enemy pad). Runner 1 dropped on a foe's
 *  spawn-site centre and standing 1 s is not pushed (no push-out); runner 0 with a 10 tank holding SHIFT on its own site
 *  (neutral floor: nobody fired) for 1 s never slicks and does not refill (no own-pad rule). */
async function ffaNoPads(R: Rapier, def: MapDef, geo: MapGeometry): Promise<{ ok: boolean; detail: string }> {
  const sc = def.scoring ?? { wallWeight: 0.35, floorMinNy: 0.45 };
  const painter = new Painter(buildAtlas(geo.paint, geo.atlasSize, { wallWeight: sc.wallWeight, floorMinNy: sc.floorMinNy }));
  painter.lockDiscs((def.ffaSpawns ?? []).map((s) => ({ x: s.pos[0], y: s.pos[1], z: s.pos[2], r: MATCH_FFA.padRadius })));
  const lockedBefore = painter.lockedCount;
  const physics = new PhysicsWorld(R, geo);
  const roster = defaultRoster({ humanKit: 'mist-rasp', seed: 77, skill: 'swell', mode: 'ffa' });
  const w = new MatchWorld({ def, geo, physics, painter, roster, seed: 77, countdownS: 0, mode: 'ffa' });
  const it: PlayerIntent[] = w.runners.map((r) => { const x = emptyIntent(); x.yaw = r.yaw; return x; });
  const lockedAfter = painter.lockedCount;
  const noPads = w.crewPads.length === 0 && w.runners.every((r) => r.ownPad === null && r.enemyPad === null && w.padOf(r) === null && !w.onOwnPad(r));
  // 1. runner 1 on runner 2's site centre, standing still for 1 s
  const r1 = w.runners[1], s2 = w.spawnSiteOf(w.runners[2])!;
  w.devTeleport(1, s2.x + 0.3, s2.y + 0.05, s2.z + 0.2);
  const x0 = r1.x, z0 = r1.z;
  for (let k = 0; k < 60; k++) w.step(it);
  const drift = Math.hypot(r1.x - x0, r1.z - z0);
  // 2. runner 0 on its own site, tank 10, SHIFT held for 1 s
  const r0 = w.runners[0], s0 = w.spawnSiteOf(r0)!;
  const atSite = Math.hypot(r0.x - s0.x, r0.z - s0.z);
  w.devSetTank(0, 10);
  it[0].slick = true;
  let slickTicks = 0;
  for (let k = 0; k < 60; k++) { w.step(it); if (r0.state === 'slick' || r0.slickForm) slickTicks++; }
  it[0].slick = false;
  const tank = r0.tank, under = painter.teamUnder(r0.x, r0.y, r0.z);
  physics.dispose();
  const ok = lockedBefore > 0 && lockedAfter === 0 && painter.lockedWeighted === 0 && noPads && drift < 0.05 && atSite < 0.3 && slickTicks === 0 && tank === 10 && under === 0;
  return {
    ok,
    detail: `old lock ${lockedBefore} texels → ${lockedAfter} after the FFA world · crewPads ${w.crewPads.length} · every runner padOf null / no own or enemy pad ${noPads} · `
      + `runner 1 on runner 2's site: moved ${drift.toFixed(3)} m in 1 s (no push-out) · runner 0 on its own site (${atSite.toFixed(2)} m off, floor ${under === null ? 'neutral' : `crew ${under}`}): SHIFT 1 s → slick ticks ${slickTicks}, tank 10 → ${tank.toFixed(1)}`,
  };
}

/** the largest `min pairwise 3-D distance` any k sites of `pts` can have (exact: binary search over the pair distances, a
 *  pruned search for k sites pairwise ≥ t) — the bound the farthest-point start is judged against (greedy FPS ≥ ½ of it) */
function bestSpread(pts: ReadonlyArray<{ x: number; y: number; z: number }>, k: number): number {
  const m = pts.length;
  const D: number[][] = pts.map((p) => pts.map((q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)));
  const ds = [...new Set(D.flatMap((row, i) => row.filter((_, j) => j > i)))].sort((a, b) => a - b);
  const feasible = (t: number): boolean => {
    const pick: number[] = [];
    const dfs = (start: number): boolean => {
      if (pick.length === k) return true;
      for (let i = start; i < m; i++) {
        if (m - i < k - pick.length) return false;
        if (pick.every((j) => D[i][j] >= t)) { pick.push(i); if (dfs(i + 1)) return true; pick.pop(); }
      }
      return false;
    };
    return dfs(0);
  };
  let lo = 0, hi = ds.length - 1, best = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (feasible(ds[mid])) { best = ds[mid]; lo = mid + 1; } else hi = mid - 1; }
  return best;
}

/** CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S1/§S2): the pool and the spread start, per FFA seed: spawnSites = maps.json
 *  ffaSites (16–24, first 8 = ffaSpawns, yaw degrees → radians); the 8 start sites distinct, every runner on its site
 *  with the site's yaw, their smallest pairwise gap ≥ ½ bestSpread (a farthest-point pick is within 2× of the optimum;
 *  a random 8 of the pool is not), one 'spawn' event per runner in the constructor's events; the seeds differ. */
async function ffaStartSpread(R: Rapier, def: MapDef, geo: MapGeometry): Promise<{ ok: boolean; detail: string }> {
  const sc = def.scoring ?? { wallWeight: 0.35, floorMinNy: 0.45 };
  const stored = def.ffaSites ?? [];
  const rows: string[] = [];
  const sets: string[] = [];
  let ok = stored.length >= 16 && stored.length <= 24
    && (def.ffaSpawns ?? []).every((s, i) => !!stored[i] && s.pos.every((v, k) => v === stored[i].pos[k]) && s.yaw === stored[i].yaw);
  let opt = NaN;
  for (const seed of FFA_SEEDS) {
    const painter = new Painter(buildAtlas(geo.paint, geo.atlasSize, { wallWeight: sc.wallWeight, floorMinNy: sc.floorMinNy }));
    const physics = new PhysicsWorld(R, geo);
    const roster = defaultRoster({ humanKit: 'mist-rasp', seed, skill: 'swell', mode: 'ffa' });
    const w = new MatchWorld({ def, geo, physics, painter, roster, seed, mode: 'ffa' });
    const ev: SimEvent[] = [];
    w.drainEvents(ev);
    const pool = w.spawnSites;
    const poolOk = pool.length === stored.length && pool.every((p, i) => p.x === stored[i].pos[0] && p.y === stored[i].pos[1] && p.z === stored[i].pos[2] && Math.abs(p.yaw - stored[i].yaw * Math.PI / 180) < 1e-12);
    if (Number.isNaN(opt)) opt = bestSpread(pool, 8);
    const start = w.runners.map((r) => r.spawnSite);
    const onSite = w.runners.every((r) => { const s = pool[r.spawnSite]; return !!s && Math.hypot(r.x - s.x, r.z - s.z) < 0.02 && r.yaw === s.yaw; });
    let gap = Infinity;
    for (let i = 0; i < start.length; i++) for (let j = i + 1; j < start.length; j++) {
      const p = pool[start[i]], q = pool[start[j]];
      gap = Math.min(gap, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z));
    }
    const spawnEv = ev.filter((e) => e.t === 'spawn');
    const evOk = spawnEv.length === 8 && spawnEv.every((e) => e.t === 'spawn' && e.site === w.runners[e.pid].spawnSite) && new Set(spawnEv.map((e) => (e.t === 'spawn' ? e.pid : -1))).size === 8;
    const distinct = new Set(start).size === 8 && start.every((s) => s >= 0);
    const good = poolOk && onSite && distinct && gap >= opt / 2 - 1e-9 && evOk;
    ok = ok && good;
    sets.push(start.join(','));
    rows.push(`s${seed}: sites ${start.join(',')} · smallest gap ${gap.toFixed(1)} m${good ? '' : ` ✗ (pool ${poolOk}, on site ${onSite}, distinct ${distinct}, events ${spawnEv.length} ok ${evOk})`}`);
    physics.dispose();
  }
  const seedsDiffer = new Set(sets).size > 1 || FFA_SEEDS.length < 2;
  ok = ok && seedsDiffer;
  return { ok, detail: `pool ${stored.length} sites (maps.json ffaSites) · best possible 8-site gap ${opt.toFixed(1)} m (½ = ${(opt / 2).toFixed(1)} m) · ${rows.join(' · ')} · seeds start differently ${seedsDiffer}` };
}

/** CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S4): FFA spawn protection in `rule` — none at the match start; runner 5 washed by
 *  runner 1 respawns at a site (its 'spawn' event right after the 'respawn') with protectS − 1 tick; 0.5 s in, a 60 foe
 *  hit is blocked (no hit event) and knockback is ignored; pressing fire ends it that tick; a 30 hit then lands. */
async function ffaProtection(R: Rapier, def: MapDef, geo: MapGeometry, rule: MatchRule): Promise<{ ok: boolean; detail: string }> {
  const d = devWorld(R, def, geo, rule === 'washout' ? { mode: 'ffa', rule: 'washout', durationS: 90 } : { mode: 'ffa', durationS: 90 });
  const w = d.w, v = w.runners[5];
  const atStart = w.runners.every((r) => r.protectedT === 0);
  const site0 = v.spawnSite;
  w.devDamage(5, 1000, 1);
  d.step(1);
  let ev: SimEvent[] = [];
  let n = 0;
  while (!v.alive && n < 400) { ev = d.step(1); n++; }
  const iRes = ev.findIndex((e) => e.t === 'respawn' && e.pid === 5);
  const sp = ev[iRes + 1];
  const spawnOk = iRes >= 0 && !!sp && sp.t === 'spawn' && sp.pid === 5 && sp.site === v.spawnSite && v.spawnSite !== site0;
  const prot0 = v.protectedT;
  d.step(30);
  const hp0 = v.hp;
  w.devDamage(5, 60, 1);
  const evB = d.step(1);
  const blocked = v.hp === hp0 && !evB.some((e) => e.t === 'hit' && e.victim === 5);
  v.knock(6, 2, 0);
  const knockBlocked = v.vx === 0;
  const before = v.protectedT;
  d.it[5].fire = true;
  const evF = d.step(1);
  d.it[5].fire = false;
  const after = v.protectedT;
  const shot = evF.some((e) => e.t === 'shot' && e.pid === 5);
  const hpB = v.hp;
  w.devDamage(5, 30, 1);
  const landed = v.hp === hpB - 30;
  d.dispose();
  const ok = atStart && spawnOk && Math.abs(prot0 - (WASHOUT.protectS - TICK)) < 1e-6 && blocked && knockBlocked && before > 1 && shot && after === 0 && landed;
  return {
    ok,
    detail: `at start all 0: ${atStart} · runner 5 washed at site ${site0} → respawned after ${n} ticks at site ${v.spawnSite} ('spawn' right after 'respawn' ${spawnOk}) with protectedT ${prot0.toFixed(3)} · 0.5 s in: a 60 hit blocked ${blocked}, knockback blocked ${knockBlocked} · fire: ${f2(before)} s → ${after} (shot ${shot}) · a 30 hit then lands ${landed} (hp ${hpB.toFixed(0)} → ${v.hp.toFixed(0)})`,
  };
}

/** review F2 → CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S3): no FFA world locks the floor any more. A painter carrying the old
 *  8-pad lock gets an FFA world: the lock is cleared (0 texels, crew weights = the whole atlas); runner 0's stream held on
 *  an unoccupied spawn site's centre from 4.5 m for 2.5 s (+1 s to land) dyes floor texels in that site's disc and
 *  teamUnder(centre) reads its crew. Then the arena-reuse path: reset + a TEAMS world on the same painter — still unlocked. */
async function padFloor(R: Rapier, def: MapDef, geo: MapGeometry, seed: number): Promise<{ ok: boolean; detail: string }> {
  const sc = def.scoring ?? { wallWeight: 0.35, floorMinNy: 0.45 };
  const A = buildAtlas(geo.paint, geo.atlasSize, { wallWeight: sc.wallWeight, floorMinNy: sc.floorMinNy });
  const painter = new Painter(A);
  painter.lockDiscs((def.ffaSpawns ?? []).map((s) => ({ x: s.pos[0], y: s.pos[1], z: s.pos[2], r: MATCH_FFA.padRadius })));
  const oldLock = painter.lockedCount;
  const physics = new PhysicsWorld(R, geo);
  const roster = defaultRoster({ humanKit: 'mist-rasp', seed, skill: 'swell', mode: 'ffa' });
  const w = new MatchWorld({ def, geo, physics, painter, roster, seed, countdownS: 0, durationS: 60, mode: 'ffa' });
  const locked = painter.lockedCount;
  let sumW = 0;
  for (let t = 0; t < 9; t++) sumW += painter.weighted(t);
  const wholeAtlas = Math.abs(sumW - A.totalWeighted) <= 1e-9 * A.totalWeighted && painter.lockedWeighted === 0;
  const inDisc = (i: number, p: { x: number; y: number; z: number }): boolean =>
    A.floor[i] === 1 && (A.px[i] - p.x) ** 2 + (A.pz[i] - p.z) ** 2 <= MATCH_FFA.padRadius ** 2 && Math.abs(A.py[i] - p.y) < 0.3;
  // an unoccupied site with flat floor 4.5 m from its centre: runner 0 holds its stream on the centre
  const me = w.runners[0];
  const taken = new Set(w.runners.map((r) => r.spawnSite));
  let site = -1, fromD = NaN;
  for (let si = 0; si < w.spawnSites.length && site < 0; si++) {
    if (taken.has(si)) continue;
    const p = w.spawnSites[si];
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const sx = p.x + Math.sin(a) * 4.5, sz = p.z + Math.cos(a) * 4.5;
      const h = physics.raycast(sx, p.y + 1.5, sz, 0, -1, 0, 3);
      if (!h || Math.abs(h.y - p.y) > 0.3 || h.ny < 0.9) continue;
      w.devTeleport(0, sx, h.y, sz, Math.atan2(p.x - sx, p.z - sz));
      site = si; fromD = Math.hypot(sx - p.x, sz - p.z);
      break;
    }
  }
  const p = site >= 0 ? w.spawnSites[site] : w.spawnSites[0];
  const intents: PlayerIntent[] = w.runners.map(() => emptyIntent());
  const sink: SimEvent[] = [];
  const it = intents[0];
  for (let t = 0; t < Math.round(3.5 / TICK); t++) {
    const firing = t < Math.round(2.5 / TICK);
    it.fire = firing; it.hasAim = firing; it.aimX = p.x; it.aimY = p.y + 0.02; it.aimZ = p.z;
    it.yaw = Math.atan2(p.x - me.x, p.z - me.z);
    w.step(intents);
    sink.length = 0; w.drainEvents(sink);
  }
  let dyed = 0, inside = 0;
  for (let i = 0; i < A.count; i++) if (inDisc(i, p)) { inside++; if (A.team[i] === me.team) dyed++; }
  const under = painter.teamUnder(p.x, p.y, p.z);
  // the arena-reuse path: reset, the old world's capsules out, a TEAMS world
  for (const r of w.runners) { const b = r.body as unknown as { dispose?: (world: unknown) => void }; try { b.dispose?.(physics.world); } catch { /* gone */ } }
  painter.reset();
  new MatchWorld({ def, geo, physics, painter, roster: defaultRoster({ humanKit: 'mist-rasp', seed, skill: 'swell' }), seed, countdownS: 0, durationS: 60 });
  const teamsLocked = painter.lockedCount, teamsTotal = painter.weighted(0);
  physics.dispose();
  const ok = oldLock > 0 && locked === 0 && wholeAtlas && site >= 0 && w.stats.shots > 10 && dyed > 0 && under === me.team
    && teamsLocked === 0 && Math.abs(teamsTotal - A.totalWeighted) <= 1e-12 * A.totalWeighted;
  return {
    ok,
    detail: `old 8-pad lock ${oldLock} texels → ${locked} after the FFA world · Σ crew weights ${sumW.toFixed(3)} = atlas ${A.totalWeighted.toFixed(3)} (${wholeAtlas}) · `
      + `stream at free site ${site} from ${f2(fromD)} m: shots ${w.stats.shots}, splats ${w.stats.splats} · texels in the site disc dyed ${dyed} of ${inside}, teamUnder(centre) ${under} (shooter crew ${me.team}) · `
      + `then TEAMS on the same painter: locked ${teamsLocked}, neutral total ${teamsTotal.toFixed(3)}`,
  };
}

// ───────────────────────────── CHANGED(WASHOUT) (CONTRACT_WASHOUT §W8) ─────────────────────────────

/** a fresh world (countdown 0: live at once) for the rule checks; step(n) advances it with idle intents and returns the
 *  events drained over those ticks (plus any a dev hook pushed before) */
interface DevWorld { w: MatchWorld; it: PlayerIntent[]; step: (n?: number) => SimEvent[]; dispose: () => void; scoreEvents: number }
function devWorld(R: Rapier, def: MapDef, geo: MapGeometry, o: { mode: MatchMode; rule?: MatchRule; durationS?: number; seed?: number; scoreLimit?: number }): DevWorld {
  const sc = def.scoring ?? { wallWeight: 0.35, floorMinNy: 0.45 };
  const painter = new Painter(buildAtlas(geo.paint, geo.atlasSize, { wallWeight: sc.wallWeight, floorMinNy: sc.floorMinNy }));
  const physics = new PhysicsWorld(R, geo);
  const seed = o.seed ?? 77;
  const roster = defaultRoster({ humanKit: 'mist-rasp', seed, skill: 'swell', mode: o.mode });
  const w = o.rule === undefined
    ? new MatchWorld({ def, geo, physics, painter, roster, seed, countdownS: 0, durationS: o.durationS ?? 60, mode: o.mode })
    : new MatchWorld({ def, geo, physics, painter, roster, seed, countdownS: 0, durationS: o.durationS ?? 60, mode: o.mode, rule: o.rule, scoreLimit: o.scoreLimit });
  const it: PlayerIntent[] = w.runners.map((r) => { const x = emptyIntent(); x.yaw = r.yaw; return x; });
  const d: DevWorld = {
    w, it, scoreEvents: 0,
    step: (n = 1): SimEvent[] => {
      const out: SimEvent[] = [];
      w.drainEvents(out);
      for (let k = 0; k < n; k++) { w.step(it); w.drainEvents(out); }
      for (const e of out) if (e.t === 'score') d.scoreEvents++;
      return out;
    },
    dispose: () => physics.dispose(),
  };
  return d;
}

/** dye ≥ m2 weighted m² of floor for `team` (splats straight down onto open floor over a grid; locked FFA pad floor never
 *  takes dye); returns the m² gained */
function paintFloor(w: MatchWorld, team: number, m2: number): number {
  const P = w.painter, before = P.weighted(team);
  for (let gx = -15; gx <= 15 && P.weighted(team) - before < m2; gx += 3) {
    for (let gz = -15; gz <= 15 && P.weighted(team) - before < m2; gz += 3) {
      const h = w.physics.raycast(gx + 0.5, 14, gz + 0.5, 0, -1, 0, 30);
      if (!h || h.ny < 0.8) continue;
      P.splat(h.x, h.y + 0.02, h.z, { radius: 1.0, team, nx: h.nx, ny: h.ny, nz: h.nz });
    }
  }
  return P.weighted(team) - before;
}

/** step until the match ends (≤ limit ticks); the events of those ticks */
function toEnd(d: DevWorld, limit = 20000): SimEvent[] {
  const out: SimEvent[] = [];
  for (let k = 0; k < limit && d.w.phase !== 'ended'; k++) out.push(...d.step(1));
  return out;
}

/** step until runner pid is alive again (after a wash); the ticks it took */
function untilAlive(d: DevWorld, pid: number): number {
  let n = 0;
  while (!d.w.runners[pid].alive && n < 1000) { d.step(1); n++; }
  return n;
}

/** CHANGED(WASHOUT): TURF credits no sea wash and has no score (both modes); TEAMS TURF keeps no spawn protection.
 *  CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S4): FFA TURF HAS spawn protection — there the respawned runner is protected, the
 *  hit 0.1 s later is blocked and the knockback ignored */
async function turfNoProtection(R: Rapier, def: MapDef, geo: MapGeometry, seed: number, mode: MatchMode): Promise<{ ok: boolean; detail: string }> {
  const d = devWorld(R, def, geo, { mode, durationS: 30, seed });   // no rule option: the default must be TURF
  const w = d.w;
  const prot = mode === 'ffa';
  const a = w.runners[1], v = w.runners.find((r) => r.id !== 0 && r.team !== a.team)!;
  const v2 = w.runners.find((r) => r.id !== 0 && r.id !== v.id && r.team !== a.team)!;
  w.devDamage(v.id, 1000, a.id);
  d.step(1);
  untilAlive(d, v.id);
  const protAtRespawn = v.protectedT;
  d.step(6);
  const hp0 = v.hp;
  w.devDamage(v.id, 40, a.id);
  const ev = d.step(1);
  const hp1 = v.hp;
  const hitLanded = prot
    ? hp1 === hp0 && !ev.some((e) => e.t === 'hit' && e.victim === v.id)          // FFA: blocked (reported as "landed" = the expectation met)
    : hp1 === hp0 - 40 && ev.some((e) => e.t === 'hit' && e.victim === v.id);
  v.knock(6, 2, 0);
  const knocked = prot ? v.vx === 0 : v.vx === 6;
  // a sea wash 1 s after a foe hit: TURF credits nobody
  w.devDamage(v2.id, 10, a.id);
  d.step(60);
  w.devTeleport(v2.id, v2.x, w.killY - 3, v2.z);
  const sea = d.step(1).find((e) => e.t === 'washed' && e.victim === v2.id);
  const seaOk = !!sea && sea.t === 'washed' && sea.cause === 'sea' && sea.by === null;
  toEnd(d);
  const res = w.result;
  const scoreEv = d.scoreEvents;
  const protOk = prot ? Math.abs(protAtRespawn - (WASHOUT.protectS - TICK)) < 1e-6 : protAtRespawn === 0;
  const ok = protOk && hitLanded && knocked && seaOk && scoreEv === 0 && w.rule === 'turf' && w.limit === 0
    && !!res && res.rule === 'turf' && res.endedBy === 'horn' && res.scores.every((s) => s === 0);
  d.dispose();
  return {
    ok,
    detail: prot
      ? `${mode}: runner ${v.id} respawned with protectedT ${protAtRespawn.toFixed(3)} (CHANGED(SPAWNS)) · a 40 hit 0.1 s later blocked ${hitLanded} (hp ${hp0} → ${hp1.toFixed(0)}) · knockback blocked ${knocked} · `
      + `sea wash of ${v2.id} 1 s after runner ${a.id}'s hit: by ${sea && sea.t === 'washed' ? sea.by : '?'} (cause ${sea && sea.t === 'washed' ? sea.cause : '?'}) · score events ${scoreEv} · result ${res?.rule}/${res?.endedBy}, Σ scores ${res?.scores.reduce((s, x) => s + x, 0)}`
      : `${mode}: runner ${v.id} respawned with protectedT ${protAtRespawn} · a 40 hit 0.1 s later landed ${hitLanded} (hp ${hp0} → ${hp1.toFixed(0)}) · knockback applied ${knocked} · `
      + `sea wash of ${v2.id} 1 s after runner ${a.id}'s hit: by ${sea && sea.t === 'washed' ? sea.by : '?'} (cause ${sea && sea.t === 'washed' ? sea.cause : '?'}) · score events ${scoreEv} · result ${res?.rule}/${res?.endedBy}, Σ scores ${res?.scores.reduce((s, x) => s + x, 0)}`,
  };
}

/** the WASHOUT result order (the contract): score, then FFA fewer washed, then share — the expected winner / tied set */
function expectWinner(mode: MatchMode, crews: number[], scores: number[], washed: number[], shares: number[]): { winner: number; tied: number[] } {
  const key = (a: number, b: number): number => (scores[b] - scores[a]) || (mode === 'ffa' ? washed[a] - washed[b] : 0) || (shares[b] - shares[a]);
  const best = crews.slice().sort((a, b) => key(a, b) || a - b)[0];
  const top = crews.filter((c) => key(c, best) === 0).sort((a, b) => a - b);
  return top.length === 1 ? { winner: top[0], tied: [] } : { winner: 0, tied: top };
}

async function washoutMain(R: Rapier, def: MapDef, geo: MapGeometry, t0: number): Promise<number> {
  const SEED = 1234;
  console.log(`map ${MAP_ID} · WASHOUT rule suite · limits TEAMS ${washoutLimitFor(def, 'teams')} / FFA ${washoutLimitFor(def, 'ffa')} (data/maps.json ${MAP_ID}.washout; data/weapons.json fallback ${WASHOUT.teamLimit} / ${WASHOUT.ffaLimit}) · sea credit ${WASHOUT.seaCreditS} s · spawn protection ${WASHOUT.protectS} s`);
  console.log('-'.repeat(100));
  // 0. the rule option
  {
    const parsed = ['washout', 'WASHOUT', ' Wash-Out ', 'kills', 'deathmatch', 'turf', 'paint', '', 'bogus', null].map((x) => parseMatchRule(x as string | null));
    const want = ['washout', 'washout', 'washout', 'washout', 'washout', 'turf', 'turf', 'turf', 'turf', 'turf'];
    const d = devWorld(R, def, geo, { mode: 'teams' });          // no rule option
    const dflt = d.w;
    const wd = devWorld(R, def, geo, { mode: 'teams', rule: 'washout' });
    const sc = wd.w.scores();
    check('rule option: parseMatchRule; MatchOptions.rule defaults to turf; MatchWorld.rule / limit; scores() is one live array of CREW_SLOTS',
      parsed.every((p, i) => p === want[i]) && dflt.rule === 'turf' && dflt.limit === 0 && wd.w.rule === 'washout' && wd.w.limit === washoutLimitFor(def, 'teams')
        && sc === wd.w.scores() && sc.length === 9 && sc.every((v) => v === 0),
      `parsed ${parsed.join(',')} · default rule ${dflt.rule} (limit ${dflt.limit}) · washout world rule ${wd.w.rule} limit ${wd.w.limit} · scores() same array ${sc === wd.w.scores()}, length ${sc.length}`);
    d.dispose(); wd.dispose();
  }
  // 0b. CHANGED(WASHOUT) follow-up: per-map limits — data/maps.json <map>.washout {teamLimit, ffaLimit} on every built map,
  //     the data/weapons.json washout block as the fallback (no block, or a bad value), MatchWorld.limit per map + mode,
  //     scoreLimit still overriding (0 = no limit)
  {
    const rows = playableMaps().map((m) => {
      const t = washoutLimitFor(m, 'teams'), f = washoutLimitFor(m, 'ffa'), raw = m.washout;
      const own = !!raw && Number.isInteger(raw.teamLimit) && Number.isInteger(raw.ffaLimit) && raw.teamLimit === t && raw.ffaLimit === f && t >= 1 && f >= 1;
      return { id: m.id, t, f, own };
    });
    const bare = { ...def, washout: undefined } as MapDef, bad = { ...def, washout: { teamLimit: 0, ffaLimit: Number.NaN } } as MapDef;
    const fb = [washoutLimitFor(bare, 'teams'), washoutLimitFor(bare, 'ffa'), washoutLimitFor(bad, 'teams'), washoutLimitFor(bad, 'ffa')];
    const fbOk = fb[0] === WASHOUT.teamLimit && fb[1] === WASHOUT.ffaLimit && fb[2] === WASHOUT.teamLimit && fb[3] === WASHOUT.ffaLimit;
    const dt = devWorld(R, def, geo, { mode: 'teams', rule: 'washout' }), df = devWorld(R, def, geo, { mode: 'ffa', rule: 'washout' });
    const d0 = devWorld(R, def, geo, { mode: 'teams', rule: 'washout', scoreLimit: 0 }), d9 = devWorld(R, def, geo, { mode: 'ffa', rule: 'washout', scoreLimit: 9 });
    const worldOk = dt.w.limit === washoutLimitFor(def, 'teams') && df.w.limit === washoutLimitFor(def, 'ffa') && d0.w.limit === 0 && d9.w.limit === 9;
    check('WASHOUT per-map limits: every built map has its own data/maps.json washout {teamLimit, ffaLimit}; no block or a bad value → the data/weapons.json washout fallback; MatchWorld.limit follows map + mode; scoreLimit overrides',
      rows.length >= 3 && rows.every((x) => x.own) && fbOk && worldOk,
      `${rows.map((x) => `${x.id} TEAMS ${x.t} / FFA ${x.f}${x.own ? '' : ' (NOT its own block)'}`).join(' · ')} · fallback (no block / bad) ${fb.join(' / ')} (weapons.json ${WASHOUT.teamLimit} / ${WASHOUT.ffaLimit}) · `
        + `${MAP_ID} worlds: TEAMS limit ${dt.w.limit}, FFA ${df.w.limit}, scoreLimit 0 → ${d0.w.limit}, scoreLimit 9 → ${d9.w.limit}`);
    dt.dispose(); df.dispose(); d0.dispose(); d9.dispose();
  }
  // 1. the limit ends the match early — TEAMS and FFA
  for (const mode of ['teams', 'ffa'] as MatchMode[]) {
    const d = devWorld(R, def, geo, { mode, rule: 'washout', durationS: 60 });
    const w = d.w, L = w.limit;
    const a = w.runners[1];
    const foes = w.runners.filter((r) => r.id !== 0 && r.team !== a.team);
    w.devSetScore(a.team, L - 2);
    w.devDamage(foes[0].id, 1000, a.id);
    const ev1 = d.step(1);
    const stillLive = w.phase === 'live' && w.scores()[a.team] === L - 1;
    const leftBefore = w.timeLeft;
    w.devDamage(foes[1].id, 1000, a.id);
    const ev2 = d.step(1);
    const endTick = w.tick;
    const res = w.result;
    const sEv = ev2.find((e) => e.t === 'score');
    const horn = ev2.some((e) => e.t === 'horn' && e.kind === 'end'), ph = ev2.some((e) => e.t === 'phase' && e.phase === 'ended');
    const frozen = w.runners.every((r) => r.courtFrozen) && w.projectiles.count === 0;
    const after = d.step(30);
    const top = res?.standings?.[0];
    check(`WASHOUT ${mode === 'ffa' ? 'FFA' : 'TEAMS'}: reaching the limit (${L}) ends the match at once through end() — horn, freeze, result (endedBy 'limit')`,
      stillLive && ev1.some((e) => e.t === 'score') && !!sEv && sEv.t === 'score' && sEv.crew === a.team && sEv.score === L && sEv.pid === a.id
        && w.phase === 'ended' && horn && ph && frozen && w.timeLeft === 0 && !!res && res.endedBy === 'limit' && res.rule === 'washout' && res.limit === L
        && res.winner === a.team && (res.tied ?? []).length === 0 && res.scores[a.team] === L && !!top && top.crew === a.team && top.score === L && top.rank === 1
        && top.washes >= 2 && w.endedBy === 'limit' && after.every((e) => e.t !== 'score' && e.t !== 'hit' && e.t !== 'washed') && w.tick === endTick + 30,
      `score ${L - 2} → wash → ${L - 1} (still live ${stillLive}, ${f2(leftBefore)} s left) → wash → score event {crew ${sEv && sEv.t === 'score' ? sEv.crew : '?'}, score ${sEv && sEv.t === 'score' ? sEv.score : '?'}, pid ${sEv && sEv.t === 'score' ? sEv.pid : '?'}} · phase ${w.phase} on tick ${endTick}, horn end ${horn}, phase event ${ph}, court frozen + pool empty ${frozen}, timeLeft ${w.timeLeft} · result endedBy ${res?.endedBy}, winner ${res?.winner}, scores[${a.team}] ${res?.scores[a.team]}, limit ${res?.limit} · standings #1 crew ${top?.crew} score ${top?.score} W ${top?.washes} D ${top?.washed}`);
    d.dispose();
  }
  // 2. the horn tie-breaks, built with dev hooks (a 1 s match nobody plays in: scores / washed / shares set directly)
  {
    const cases: Array<{ name: string; mode: MatchMode; set: (d: DevWorld) => void; want: (w: MatchWorld) => { winner: number; tied: number[] } }> = [
      { name: 'TEAMS equal scores → the higher turf share wins', mode: 'teams', set: (d) => { d.w.devSetScore(1, 7); d.w.devSetScore(2, 7); paintFloor(d.w, 2, 12); }, want: () => ({ winner: 2, tied: [] }) },
      { name: 'TEAMS the higher score wins over a higher share', mode: 'teams', set: (d) => { d.w.devSetScore(1, 8); d.w.devSetScore(2, 7); paintFloor(d.w, 2, 12); }, want: () => ({ winner: 1, tied: [] }) },
      { name: 'TEAMS equal scores + exactly equal share → a draw', mode: 'teams', set: (d) => { d.w.devSetScore(1, 7); d.w.devSetScore(2, 7); }, want: () => ({ winner: 0, tied: [1, 2] }) },
      {
        name: 'FFA equal top scores → fewer washed wins (over a higher share)', mode: 'ffa',
        set: (d) => { const [x, y, z] = [d.w.runners[2], d.w.runners[5], d.w.runners[6]]; d.w.devSetScore(x.team, 5); d.w.devSetScore(y.team, 5); d.w.devSetScore(z.team, 3); x.washedCount = 1; y.washedCount = 3; paintFloor(d.w, y.team, 12); },
        want: (w) => ({ winner: w.runners[2].team, tied: [] }),
      },
      {
        name: 'FFA equal top scores + equal washed → the higher share wins', mode: 'ffa',
        set: (d) => { const [x, y] = [d.w.runners[2], d.w.runners[5]]; d.w.devSetScore(x.team, 5); d.w.devSetScore(y.team, 5); x.washedCount = 2; y.washedCount = 2; paintFloor(d.w, y.team, 12); },
        want: (w) => ({ winner: w.runners[5].team, tied: [] }),
      },
      {
        name: 'FFA equal top scores, washed and share → a draw, tied lists the crews', mode: 'ffa',
        set: (d) => { const [x, y, z] = [d.w.runners[2], d.w.runners[5], d.w.runners[7]]; d.w.devSetScore(x.team, 5); d.w.devSetScore(y.team, 5); d.w.devSetScore(z.team, 4); x.washedCount = 2; y.washedCount = 2; },
        want: (w) => ({ winner: 0, tied: [w.runners[2].team, w.runners[5].team].sort((p, q) => p - q) }),
      },
    ];
    for (const c of cases) {
      const d = devWorld(R, def, geo, { mode: c.mode, rule: 'washout', durationS: 1 });
      c.set(d);
      const ev = toEnd(d);
      const res = d.w.result;
      const want = c.want(d.w);
      const st = res?.standings ?? [];
      const sh = res?.shares ?? [];
      const washed = new Array<number>(9).fill(0);
      for (const s of st) washed[s.crew] = s.washed;
      const exp = res ? expectWinner(c.mode, d.w.crews, res.scores, washed, sh) : { winner: -1, tied: [] };
      const rank1 = st.filter((s) => s.rank === 1).map((s) => s.crew).sort((p, q) => p - q);
      const ok = !!res && res.endedBy === 'horn' && res.winner === want.winner && (res.tied ?? []).join() === want.tied.join()
        && exp.winner === want.winner && rank1.join() === (want.winner ? [want.winner] : want.tied).join() && !!st[0] && (want.winner ? st[0].crew === want.winner : true)
        && ev.some((e) => e.t === 'horn' && e.kind === 'end') && !ev.some((e) => e.t === 'score');
      check(`WASHOUT horn tie-break: ${c.name}`, ok,
        res ? `endedBy ${res.endedBy} · winner ${res.winner}${res.winner === 0 ? ` (tied ${(res.tied ?? []).join(', ')})` : ''} (want ${want.winner}${want.winner === 0 ? ` tied ${want.tied.join(', ')}` : ''}) · top: ${st.slice(0, 3).map((s) => `#${s.rank} crew ${s.crew} score ${s.score} D ${s.washed} share ${pct(s.share)}`).join(' · ')}` : 'no result');
      d.dispose();
    }
  }
  // 3. the sea credit: the last foe who damaged the victim within seaCreditS (inclusive), nobody after it or without a hit
  {
    const d = devWorld(R, def, geo, { mode: 'teams', rule: 'washout', durationS: 90 });
    const w = d.w, win = Math.round(WASHOUT.seaCreditS / TICK);
    const trial = (victim: number, by: number, ticks: number): { by: number | null; cause: string; score: SimEvent | undefined; hp: number } => {
      const v = w.runners[victim];
      if (by >= 0) w.devDamage(victim, 10, by);
      const hp = v.hp;
      d.step(ticks);
      w.devTeleport(victim, v.x, w.killY - 3, v.z);
      const ev = d.step(1);
      const ws = ev.find((e) => e.t === 'washed' && e.victim === victim);
      return { by: ws && ws.t === 'washed' ? ws.by : -99, cause: ws && ws.t === 'washed' ? ws.cause : '?', score: ev.find((e) => e.t === 'score'), hp };
    };
    const s0 = w.scores()[1];
    const inW = trial(5, 1, win);           // the hit exactly seaCreditS before the fall: credited
    const s1 = w.scores()[1];
    const outW = trial(6, 2, win + 1);      // one tick later: nobody
    const s2 = w.scores()[1];
    const none = trial(7, -1, 30);          // no hit at all: nobody
    const s3 = w.scores()[1];
    const credited = inW.by === 1 && inW.cause === 'sea' && !!inW.score && inW.score.t === 'score' && inW.score.crew === 1 && inW.score.pid === 1 && s1 === s0 + 1 && inW.hp === 90;
    const uncredited = outW.by === null && outW.cause === 'sea' && !outW.score && s2 === s1 && none.by === null && !none.score && s3 === s2;
    check(`WASHOUT sea credit: a fall ${WASHOUT.seaCreditS} s after a foe's hit is credited to that foe (+1, score event); ${f2((win + 1) * TICK)} s after, or with no hit, nobody scores`,
      credited && uncredited,
      `fall ${win} ticks after runner 1's hit on 5: by ${inW.by} (${inW.cause}), score event ${inW.score ? `crew ${inW.score.t === 'score' ? inW.score.crew : '?'}` : 'none'}, SUN ${s0} → ${s1} · fall ${win + 1} ticks after runner 2's hit on 6: by ${outW.by}, score event ${outW.score ? 'yes' : 'none'} · fall with no hit (7): by ${none.by}, score event ${none.score ? 'yes' : 'none'} · SUN ${s3}`);
    d.dispose();
  }
  // 4. spawn protection: WASHOUT only, protectS after a respawn — no damage, no knockback — ended by fire / sub
  {
    const d = devWorld(R, def, geo, { mode: 'teams', rule: 'washout', durationS: 90 });
    const w = d.w;
    const atStart = w.runners.every((r) => r.protectedT === 0);
    const v = w.runners[5];
    w.devDamage(5, 1000, 1);
    d.step(1);
    untilAlive(d, 5);
    const prot0 = v.protectedT;
    let protTicks = 1;                                      // the respawn tick itself
    d.step(30);
    protTicks += 30;
    const hp0 = v.hp;
    w.devDamage(5, 60, 1);
    const evBlocked = d.step(1); protTicks++;
    const blocked = v.hp === hp0 && !evBlocked.some((e) => e.t === 'hit' && e.victim === 5) && v.lastHitBy === -1;
    v.knock(6, 2, 0);
    const knockBlocked = v.vx === 0;
    w.devDamage(5, 1000);                                   // a dev wash with nobody behind it is blocked too
    const devBlocked = v.alive && v.hp === hp0;
    while (v.protectedT > 0 && protTicks < 400) { d.step(1); protTicks++; }
    const hpB = v.hp;
    w.devDamage(5, 60, 1);
    const evAfter = d.step(1);
    const hpA = v.hp;
    const landed = hpA === hpB - 60;
    const hitAfter = evAfter.some((e) => e.t === 'hit' && e.victim === 5) && v.lastHitBy === 1;
    // fire ends it at once (runner 6), and so does a sub (runner 7)
    const ends: string[] = [];
    let endOk = true;
    for (const [pid, key] of [[6, 'fire'], [7, 'sub']] as Array<[number, 'fire' | 'sub']>) {
      const r = w.runners[pid];
      w.devDamage(pid, 1000, 2);
      d.step(1);
      untilAlive(d, pid);
      d.step(30);
      const before = r.protectedT;
      d.it[pid][key] = true;
      d.step(1);
      d.it[pid][key] = false;
      const after = r.protectedT;
      const hpB = r.hp;
      w.devDamage(pid, 30, 2);
      const took = r.hp < hpB;
      ends.push(`${key}: ${f2(before)} s left → ${f2(after)} after pressing ${key}, a 30 hit then lands ${took}`);
      endOk = endOk && before > 1 && after === 0 && took;
    }
    const protS = protTicks * TICK;
    check(`WASHOUT spawn protection: ${WASHOUT.protectS} s after a respawn — foe damage, dev damage and knockback blocked — then hits land; firing or a sub ends it at once; none at the match start`,
      atStart && Math.abs(prot0 - (WASHOUT.protectS - TICK)) < 1e-6 && Math.abs(protS - WASHOUT.protectS) < 1e-6 && blocked && knockBlocked && devBlocked && hitAfter && landed && endOk,
      `at start all 0: ${atStart} · runner 5 after its respawn tick: protectedT ${prot0.toFixed(3)} · protected for ${protTicks} ticks (${f2(protS)} s) · 0.5 s in: a 60 hit blocked ${blocked}, knockback blocked ${knockBlocked}, dev wash blocked ${devBlocked} · after: the 60 hit lands ${hitAfter && landed} (hp ${hpB} → ${hpA.toFixed(1)}) · ${ends.join(' · ')}`);
    d.dispose();
  }
  // 4b. CHANGED(WASHOUT) follow-up (skeptic A2): a wash clears spawn protection — a protected runner washed by the sea is
  //     never dead AND protected, stays at 0 while dead, and its next respawn grants a fresh window
  {
    const d = devWorld(R, def, geo, { mode: 'teams', rule: 'washout', durationS: 90 });
    const w = d.w, pid = 6, r = w.runners[pid];
    w.devDamage(pid, 1000);
    d.step(1);
    untilAlive(d, pid);
    d.step(20);
    const before = r.protectedT;
    w.devTeleport(pid, r.x, w.killY - 3, r.z);
    const ev = d.step(1);
    const ws = ev.find((e) => e.t === 'washed' && e.victim === pid);
    const deadProt = r.protectedT, dead = !r.alive;
    let maxDead = 0, n = 0;
    while (!r.alive && n < 400) { d.step(1); n++; if (!r.alive) maxDead = Math.max(maxDead, r.protectedT); }
    const fresh = r.protectedT;
    check('WASHOUT spawn protection: a wash clears it — a protected runner washed by the sea is not protected while dead; the next respawn grants a fresh window',
      before > 1 && !!ws && ws.t === 'washed' && ws.cause === 'sea' && ws.by === null && dead && deadProt === 0 && maxDead === 0 && r.alive && Math.abs(fresh - (WASHOUT.protectS - TICK)) < 1e-6,
      `runner ${pid} protected ${f2(before)} s → sea wash (cause ${ws && ws.t === 'washed' ? ws.cause : '?'}, by ${ws && ws.t === 'washed' ? ws.by : '?'}) → protectedT ${deadProt} while dead (max ${maxDead} over ${n} dead ticks) → respawned with ${fresh.toFixed(3)} s`);
    d.dispose();
  }
  // 4c. CHANGED(WASHOUT) follow-up (skeptic B2): protection ends only on an action that actually happens — a SPECIAL press
  //     with no special ready, fire + sub on a dry tank and a sub on cooldown keep it; a special that starts ends it
  {
    const d = devWorld(R, def, geo, { mode: 'teams', rule: 'washout', durationS: 90 });
    const w = d.w, pid = 5, r = w.runners[pid];
    w.devDamage(pid, 1000);
    d.step(1);
    untilAlive(d, pid);
    d.step(30);
    const press =(keys: Array<'fire' | 'sub' | 'special'>): { before: number; after: number; ev: SimEvent[] } => {
      const before = r.protectedT;
      for (const k of keys) d.it[pid][k] = true;
      const ev = d.step(1);
      for (const k of keys) d.it[pid][k] = false;
      return { before, after: r.protectedT, ev };
    };
    const kept = (x: { before: number; after: number }): boolean => x.after > 0 && Math.abs(x.before - x.after - TICK) < 1e-6;
    r.special = 0; r.specialReady = false;
    const noSpecial = press(['special']);
    // CHANGED(CONTROLS) (CONTRACT_CONTROLS §C2): that press is now answered with a 'special' phase 'denied' event — it
    // still starts nothing and keeps the protection
    const okA = kept(noSpecial) && !noSpecial.ev.some((e) => e.t === 'special' && e.pid === pid && e.phase !== 'denied')
      && noSpecial.ev.some((e) => e.t === 'special' && e.pid === pid && e.phase === 'denied');
    w.devSetTank(pid, 0);
    const dry = press(['fire', 'sub']);
    const okB = kept(dry) && dry.ev.some((e) => e.t === 'dry' && e.pid === pid) && !dry.ev.some((e) => (e.t === 'shot' || e.t === 'sub') && e.pid === pid);
    w.devSetTank(pid, 100);
    r.subCooldown = 0.4;
    const cool = press(['sub']);
    const okC = kept(cool) && !cool.ev.some((e) => e.t === 'sub' && e.pid === pid);
    r.special = 1; r.specialReady = true;
    const spec = press(['special']);
    const okD = spec.before > 0 && spec.after === 0 && spec.ev.some((e) => e.t === 'special' && e.phase === 'start' && e.pid === pid);
    check('WASHOUT spawn protection ends only on an action that happens: SPECIAL with no special ready (answered \'denied\'), fire + sub on a dry tank, a sub on cooldown keep it; a special that starts ends it',
      okA && okB && okC && okD,
      `special, none ready: ${f2(noSpecial.before)} → ${f2(noSpecial.after)} s, answered 'denied' ${noSpecial.ev.some((e) => e.t === 'special' && e.pid === pid && e.phase === 'denied')} (kept ${okA}) · fire + sub, tank 0: ${f2(dry.before)} → ${f2(dry.after)} s, dry click ${dry.ev.some((e) => e.t === 'dry')} (kept ${okB}) · sub on cooldown: ${f2(cool.before)} → ${f2(cool.after)} s (kept ${okC}) · special ready: ${f2(spec.before)} → ${f2(spec.after)} s, started ${spec.ev.some((e) => e.t === 'special' && e.phase === 'start')} (ended ${okD})`);
    d.dispose();
  }
  // 4d. CHANGED(WASHOUT) follow-up (skeptic H): a protected runner that deals damage from any source loses its protection —
  //     a CLOUDBURST thrown before its wash that still rains after its respawn; a direct damage() call (a jelly / burst /
  //     beam goes through it); damage blocked by a protected victim is not dealt and keeps the attacker's protection
  {
    const d = devWorld(R, def, geo, { mode: 'teams', rule: 'washout', durationS: 90 });
    const w = d.w, P = w.projectiles;
    const A = w.runners[1];
    const V = w.runners.find((r) => r.id !== 0 && r.team !== A.team)!;
    const cloudSlot = (): number => { for (let i = 0; i < P.count; i++) if (P.kind[i] === KIND_CLOUD && P.owner[i] === A.id && P.state[i] === PSTATE_HOVER) return i; return -1; };
    // A throws its CLOUDBURST 8 m ahead at the floor
    const fx = A.x + Math.sin(A.yaw) * 8, fz = A.z + Math.cos(A.yaw) * 8;
    const g = w.physics.raycast(fx, A.y + 6, fz, 0, -1, 0, 20);
    A.special = 1; A.specialReady = true;
    const ia = d.it[A.id];
    ia.special = true; ia.hasAim = !!g; ia.aimX = g ? g.x : fx; ia.aimY = g ? g.y : A.y; ia.aimZ = g ? g.z : fz;
    const evS = d.step(1);
    ia.special = false; ia.hasAim = false;
    const thrown = evS.some((e) => e.t === 'special' && e.phase === 'start' && e.pid === A.id);
    let slot = -1, flight = 0;
    while (slot < 0 && flight < 180) { d.step(1); flight++; slot = cloudSlot(); }
    // A is washed (nobody behind it) and respawns protected while its cell still rains
    w.devDamage(A.id, 1000);
    d.step(1);
    untilAlive(d, A.id);
    const protAtRespawn = A.protectedT;
    slot = cloudSlot();
    let hitK = -1, protBefore = -1, hpV0 = V.hp, cellY = NaN;
    if (slot >= 0) {
      const hx = P.ox[slot], hy = P.oy[slot], hz = P.oz[slot];
      cellY = hy;
      const gv = w.physics.raycast(hx, hy - 0.2, hz, 0, -1, 0, 20);
      w.devTeleport(V.id, hx, gv ? gv.y + 0.02 : hy - 2.8, hz);
      hpV0 = V.hp;
      for (let k = 0; k < 40 && hitK < 0; k++) {
        protBefore = A.protectedT;
        const ev = d.step(1);
        if (ev.some((e) => e.t === 'hit' && e.by === A.id && e.victim === V.id)) hitK = k;
      }
    }
    const protAfter = A.protectedT;
    const cloudOk = thrown && slot >= 0 && protAtRespawn > 1.9 && hitK >= 0 && protBefore > 1.5 && protAfter === 0 && V.hp < hpV0 && A.alive;
    // direct damage(): B (A's mate) and F2 respawn protected; B → F2 is blocked (F2 protected): B keeps it; B → F1 lands: B loses it
    const B = w.runners.find((r) => r.id !== 0 && r.id !== A.id && r.team === A.team)!;
    const foes = w.runners.filter((r) => r.id !== 0 && r.id !== V.id && r.team !== A.team);
    const F1 = foes[0], F2 = foes[1];
    w.devDamage(B.id, 1000); w.devDamage(F2.id, 1000);
    d.step(1);
    untilAlive(d, B.id); untilAlive(d, F2.id);
    d.step(5);
    const bProt0 = B.protectedT, f2hp = F2.hp;
    w.damage(F2, B.id, 5, F2.x, F2.y + 0.6, F2.z, 'sub', false);
    const bProtBlocked = B.protectedT;
    const blockedKeeps = F2.hp === f2hp && bProtBlocked === bProt0 && bProt0 > 0 && F2.protectedT > 0;
    const f1hp = F1.hp;
    w.damage(F1, B.id, 5, F1.x, F1.y + 0.6, F1.z, 'sub', false);
    const directEnds = F1.hp === f1hp - 5 && B.protectedT === 0;
    check('WASHOUT spawn protection ends when the runner deals damage from any source: a CLOUDBURST thrown before its wash hits after its respawn; a direct damage(); damage blocked by a protected victim keeps it',
      cloudOk && blockedKeeps && directEnds,
      `CLOUDBURST thrown ${thrown}, cell hovering after ${flight} ticks (slot ${slot}, y ${f2(cellY)}) · runner ${A.id} washed, respawned with ${f2(protAtRespawn)} s · its cell hit runner ${V.id} ${hitK >= 0 ? `${hitK + 1} ticks later` : 'never'} (hp ${hpV0.toFixed(0)} → ${V.hp.toFixed(1)}): protection ${f2(protBefore)} → ${protAfter} s · `
        + `runner ${B.id} protected ${f2(bProt0)} s: damage() on protected ${F2.id} blocked (hp ${f2hp} → ${F2.hp}), protection ${f2(bProt0)} → ${f2(bProtBlocked)} s · damage() on ${F1.id} lands (hp ${f1hp.toFixed(0)} → ${F1.hp.toFixed(0)}) → ${B.protectedT} s`);
    d.dispose();
  }
  // 4e. CHANGED(WASHOUT) follow-up (skeptic: 'score' never adjacent to its 'washed'): the 'score' event comes right after its
  //     'washed' event — a dye wash (hit puddle before, wash burst splat after) and a sea credit
  {
    const d = devWorld(R, def, geo, { mode: 'teams', rule: 'washout', durationS: 90 });
    const w = d.w;
    const a = w.runners[1], v = w.runners.find((r) => r.id !== 0 && r.team !== a.team)!, v2 = w.runners.find((r) => r.id !== 0 && r.id !== v.id && r.team !== a.team)!;
    a.special = 0.95; a.specialReady = false;                 // the wash's meter points make it 'ready' inside the same wash
    w.devDamage(v.id, 1000, a.id);
    const ev1 = d.step(1);
    w.devDamage(v2.id, 10, a.id);
    d.step(30);
    w.devTeleport(v2.id, v2.x, w.killY - 3, v2.z);
    const ev2 = d.step(1);
    const kinds = (ev: SimEvent[]): string => { const k = ev.findIndex((e) => e.t === 'washed'); return k < 0 ? 'no wash' : ev.slice(Math.max(0, k - 1), k + 4).map((e) => e.t + (e.t === 'special' ? `:${e.phase}` : '')).join(' → '); };
    const bad = scoreOrderFaults(ev1, w) + scoreOrderFaults(ev2, w);
    const n1 = ev1.filter((e) => e.t === 'score').length, n2 = ev2.filter((e) => e.t === 'score').length;
    const i1 = ev1.findIndex((e) => e.t === 'washed'), i2 = ev2.findIndex((e) => e.t === 'washed');
    const after1 = ev1.slice(i1 + 2).some((e) => e.t === 'splat') && ev1.slice(i1 + 2).some((e) => e.t === 'special' && e.phase === 'ready');
    check("WASHOUT event order: each 'score' comes right after its own 'washed' (a dye wash with its puddle, meter-ready and burst events around it; a sea credit)",
      bad === 0 && n1 === 1 && n2 === 1 && i1 >= 0 && i2 >= 0 && after1,
      `dye wash: ${kinds(ev1)} · sea credit: ${kinds(ev2)} · order faults ${bad}`);
    d.dispose();
  }
  // 5. TURF on the same map: no protection, no score events (both modes)
  for (const mode of ['teams', 'ffa'] as MatchMode[]) {
    const tp = await turfNoProtection(R, def, geo, SEED, mode);
    // CHANGED(SPAWNS): FFA TURF has spawn protection (CONTRACT_FFA_SPAWNS §S4); TEAMS TURF has none
    check(`TURF (${mode}): ${mode === 'ffa' ? 'spawn protection after a respawn (CHANGED(SPAWNS))' : 'no spawn protection'}, no sea credit, no score events, scores all 0, endedBy horn`, tp.ok, tp.detail);
  }
  // 6. scripted WASHOUT matches (the probe's scripted driver): credited washes = score events = Σ scores, result order,
  //    determinism; and the TURF pier18 hash still the pre-WASHOUT one
  console.log('-'.repeat(100));
  const a = await runMatch(R, def, geo, SEED, { mode: 'teams', rule: 'washout' });
  const b = await runMatch(R, def, geo, SEED, { mode: 'teams', rule: 'washout' });
  const c = await runMatch(R, def, geo, SEED + 1, { mode: 'teams', rule: 'washout' });
  const f = await runMatch(R, def, geo, SEED, { mode: 'ffa', rule: 'washout' });
  for (const [label, x, mode] of [['TEAMS seed 1234', a, 'teams'], ['TEAMS seed 1235', c, 'teams'], ['FFA seed 1234', f, 'ffa']] as Array<[string, RunOut, MatchMode]>) {
    const res = x.result;
    const sum = x.scores.reduce((s, v) => s + v, 0);
    const lim = washoutLimitFor(def, mode);                  // CHANGED(WASHOUT) follow-up: the map's own limit
    const crews = (res?.standings ?? []).map((s) => s.crew);
    const exp = res ? expectWinner(mode, crews, res.scores, x.washedBy, res.shares ?? []) : { winner: -1, tied: [] };
    const maxS = Math.max(...crews.map((k) => x.scores[k]));
    const endOk = res ? (maxS >= lim ? res.endedBy === 'limit' : res.endedBy === 'horn') : false;
    const st = res?.standings ?? [];
    const orderOk = st.every((s, i) => i === 0 || s.score < st[i - 1].score || (s.score === st[i - 1].score && (mode === 'ffa' ? s.washed > st[i - 1].washed || (s.washed === st[i - 1].washed && s.share <= st[i - 1].share) : s.share <= st[i - 1].share)));
    check(`WASHOUT scripted match (${label}): score events = credited washes = Σ scores, each right after its 'washed'; winner / tied / standings follow the WASHOUT order; endedBy fits the limit`,
      !!res && res.rule === 'washout' && x.scoreEvents === sum && x.creditedWashed === sum && sum > 0 && res.scores.join() === x.scores.join() && x.scoreOrderBad === 0
        && res.winner === exp.winner && (res.tied ?? []).join() === exp.tied.join() && orderOk && endOk && res.limit === lim,
      res ? `${res.endedBy === 'limit' ? `LIMIT ${lim} reached` : `horn (limit ${lim})`} · scores ${crews.map((k) => `${k}:${x.scores[k]}`).join(' ')} · score events ${x.scoreEvents}, credited washes ${x.creditedWashed} (all washes ${x.stats.washes}, sea ${x.stats.seaWashes}), event-order faults ${x.scoreOrderBad} · winner ${res.winner}${res.winner === 0 ? ` (tied ${(res.tied ?? []).join(',')})` : ''} · #1 ${st[0]?.name} ${st[0]?.score} (D ${st[0]?.washed}, ${pct(st[0]?.share ?? 0)}) · wall ${x.wallS.toFixed(1)} s` : 'no result');
  }
  check('WASHOUT determinism: same seed → identical world hash; another seed → a different one',
    a.hash === b.hash && a.hash !== c.hash, `seed ${SEED}: ${a.hash} / ${b.hash}; seed ${SEED + 1}: ${c.hash}`);
  if (MAP_ID === 'pier18') {
    // the pre-WASHOUT TURF value of the default run (probe_match.ts, pier18, teams, seed 1234): TURF must not move
    const TURF_PIER18_1234 = 'b2bbe68c-302ad464';
    const t = await runMatch(R, def, geo, SEED, { mode: 'teams', rule: 'turf' });
    check('TURF hash unchanged by WASHOUT: pier18 teams seed 1234 = the pre-WASHOUT hash', t.hash === TURF_PIER18_1234 && t.scoreEvents === 0,
      `${t.hash} (want ${TURF_PIER18_1234}) · score events ${t.scoreEvents}`);
  }
  check('wall time: each scripted WASHOUT match simulates in < 20 s', [a, b, c, f].every((x) => x.wallS < 20),
    `${[a, b, c, f].map((x) => `${x.wallS.toFixed(2)} s`).join(' / ')} · process CPU ${[a, b, c, f].map((x) => `${x.cpuS.toFixed(2)} s`).join(' / ')} (info)`);
  console.log('-'.repeat(100));
  const failed = checks.filter((x) => !x.pass);
  const verdict = failed.length ? `FAIL (${failed.length})` : 'OK';
  console.log(`probe_match --rule washout: ${checks.length - failed.length}/${checks.length} checks pass · ${((performance.now() - t0) / 1000).toFixed(2)} s`);
  console.log(`RESULT: ${verdict}`);
  try {
    const dir = resolve(HERE, '_reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `probe_match_washout_${MAP_ID}.json`), JSON.stringify({
      checks, verdict, runs: [a, b, c, f].map((x) => ({ hash: x.hash, wallS: x.wallS, result: x.result, stats: x.stats, horns: x.horns })), at: new Date().toISOString(),
    }, null, 2) + '\n', 'utf8');
  } catch { /* best-effort */ }
  return failed.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => {
  console.log('SETUP FAILED:', (e as Error)?.stack ?? e);
  console.log('RESULT: FAIL');
  process.exit(2);
});
