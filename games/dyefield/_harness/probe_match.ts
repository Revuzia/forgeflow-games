// DYEFIELD — the 3:00 match loop (CONTRACT §10.1 / §12): countdown freeze, horns, result, end lock,
// determinism and wall time, on the real Pier 18 collision + paint atlas, Rapier in plain Node.
//
//   node _harness/probe_match.ts            # full 180 s match ×2 (same seed) + ×1 (other seed)
//   node _harness/probe_match.ts --verbose
//   node _harness/probe_match.ts --mode ffa [--map pier18|lockwell|cinder]
//                                            # CHANGED(CORE) (CONTRACT_FFA §F4): FREE-FOR-ALL — 8 crews on their drop pads;
//                                            # countdown freeze, horns, shares sum to 1, a winner (strict, tie = draw),
//                                            # determinism, plus the drop-pad rules (own pad = own dye, others pushed out,
//                                            # respawn on the own pad after 3 s)
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
import { mapById, type MapDef } from '../runtime/src/core/data.ts';
import { TICK, MATCH } from '../runtime/src/core/config.ts';
import { emptyIntent, parseMatchMode, type MatchMode, type PlayerIntent } from '../runtime/src/core/types.ts';
import { mulberry32, hash32 } from '../runtime/src/core/rng.ts';
import { MatchWorld, type MatchResult, type MatchStats } from '../runtime/src/core/match/world.ts';
import { defaultRoster } from '../runtime/src/core/match/roster.ts';
import type { SimEvent } from '../runtime/src/core/match/events.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERBOSE = process.argv.includes('--verbose');
const argv = process.argv.slice(2);
const argOf = (k: string, d: string): string => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
/** CHANGED(CORE): --mode teams (default) | ffa */
const MODE: MatchMode = parseMatchMode(argOf('--mode', 'teams'));
const MAP_ID = argOf('--map', 'pier18');

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
  horns: Array<{ kind: string; tick: number }>; phases: Array<{ phase: string; tick: number }>;
  freeze: { maxDrift: number; shots: number; flips: number; phaseOk: boolean };
  endLock: { moved: number; shots: number; hashSame: boolean; projectiles: number };
  result: MatchResult | null;
  coverageAtEnd: { sun: number; gulf: number; neutral: number };
  /** CHANGED(CORE): Painter.coverageByTeam() at the horn */
  sharesAtEnd: number[];
  /** CHANGED(CORE): FFA — crews in play, distinct roster crews, every runner started on its own pad (max offset m) */
  crews: number; distinctCrews: number; padStartOff: number;
  stats: MatchStats; washes: number; special: number[]; painted: number[]; refills: number; countdownTicks: number;
}

/** CHANGED(CORE): FFA — the scripted runner's home (its drop pad) and the waypoint bounds */
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
  /** CHANGED(CORE): FFA — waypoints around the own drop pad (no halves), inside the map bounds */
  private readonly home: ScriptHome | null;
  constructor(seed: number, i: number, team: number, home: ScriptHome | null = null) {
    this.rnd = mulberry32(hash32(seed, i, 0x5c417));
    this.s = team === 1 ? -1 : 1;
    const lanes = [-17, -6, 6, 17];
    this.lane = lanes[i % 4] * (this.s < 0 ? 1 : -1);
    this.home = home;
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
    if (r.tank < 15) this.refill = true;
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
    if (this.refill) {
      const pad = w.padOf(r);                                   // CHANGED(CORE): teams pads[side]; FFA the drop pad
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
  }
}

async function runMatch(R: Rapier, def: MapDef, geo: MapGeometry, seed: number): Promise<RunOut> {
  const sc = def.scoring ?? { wallWeight: 0.35, floorMinNy: 0.45 };
  const atlas = buildAtlas(geo.paint, geo.atlasSize, { wallWeight: sc.wallWeight, floorMinNy: sc.floorMinNy });
  const painter = new Painter(atlas);
  const physics = new PhysicsWorld(R, geo);
  const roster = defaultRoster({ humanKit: 'mist-rasp', humanName: 'Probe', seed, skill: 'swell', mode: MODE });
  const world = new MatchWorld({ def, geo, physics, painter, roster, seed, durationS: MATCH.durationS, countdownS: MATCH.countdownS, mode: MODE });
  const n = world.runners.length;
  const intents: PlayerIntent[] = world.runners.map(() => emptyIntent());
  const b = def.bounds ?? { min: [-28, -2, -42], max: [28, 12, 42] };
  const scripts = world.runners.map((r, i) => new Script(seed, i, r.team, MODE === 'ffa'
    ? { x: world.padOf(r).x, z: world.padOf(r).z, lo: [b.min[0] + 2, b.min[2] + 2], hi: [b.max[0] - 2, b.max[2] - 2] } : null));
  const padStartOff = MODE === 'ffa' ? world.runners.reduce((m, r) => Math.max(m, Math.hypot(r.x - world.padOf(r).x, r.z - world.padOf(r).z)), 0) : 0;
  const events: SimEvent[] = [];
  const horns: RunOut['horns'] = [];
  const phases: RunOut['phases'] = [];
  const times: number[] = [];
  const t0 = performance.now();

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
    for (const e of events) {
      if (e.t === 'shot') cdShots++;
      if (e.t === 'horn') horns.push({ kind: e.kind, tick: world.tick });
      if (e.t === 'phase') phases.push({ phase: e.phase, tick: world.tick });
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
    events.length = 0;
    world.drainEvents(events);
    for (const e of events) {
      if (e.t === 'horn') horns.push({ kind: e.kind, tick: world.tick });
      if (e.t === 'phase') phases.push({ phase: e.phase, tick: world.tick });
    }
    if (world.tick > 20000) break;
  }
  const wallS = (performance.now() - t0) / 1000;
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
    for (const e of events) if (e.t === 'shot' || e.t === 'splat' || e.t === 'hit') endShots++;
  }
  let moved = 0;
  for (let i = 0; i < n; i++) moved = Math.max(moved, Math.hypot(world.runners[i].x - endPos[i].x, world.runners[i].z - endPos[i].z));

  const sorted = times.slice().sort((a, b) => a - b);
  const out: RunOut = {
    hash: hashAtEnd, wallS, ticks: times.length,
    tickMsP99: sorted[Math.floor(sorted.length * 0.99)] ?? 0, tickMsMax: sorted[sorted.length - 1] ?? 0,
    horns, phases,
    freeze: { maxDrift, shots: cdShots, flips: cdFlips, phaseOk },
    endLock: { moved, shots: endShots, hashSame: painter.hash() === paintHashAtEnd, projectiles: world.projectiles.count },
    result: world.result, coverageAtEnd, sharesAtEnd, stats: { ...world.stats },
    crews: world.crews.length, distinctCrews: new Set(world.runners.map((r) => r.team)).size, padStartOff,
    washes: world.runners.reduce((s, r) => s + r.washes, 0),
    special: world.runners.map((r) => r.special), painted: world.runners.map((r) => r.painted),
    refills: world.runners.reduce((s, r) => s + r.refillsFromLow, 0), countdownTicks,
  };
  physics.dispose();
  return out;
}

async function main(): Promise<number> {
  const t0 = performance.now();
  const def = mapById(MAP_ID);
  let R: Rapier, geo: MapGeometry;
  try { R = await loadRapier(); geo = await loadMapGeometry(def); } catch (e) { console.log('SETUP FAILED:', (e as Error).stack ?? e); return 2; }
  const SEED = 1234;
  console.log(`map ${MAP_ID} · ${MODE === 'ffa' ? 'FREE-FOR-ALL · ' : ''}match ${MATCH.durationS} s + countdown ${MATCH.countdownS} s · 8 scripted runners · seed ${SEED} (×2) and ${SEED + 1}`);
  if (MODE === 'ffa') {
    const pr = await padRules(R, def, geo, SEED);
    check('FFA drop pads: 8 pads r 1.6, own pad = own dye (slick + refill), others pushed out, respawn on the own pad after 3 s',
      pr.pads === 8 && pr.distinct && pr.pushedOut && pr.slickOnOwn && pr.refilled && pr.respawnOnPad,
      `pads ${pr.pads} (distinct ${pr.distinct}, r ${pr.r}) · intruder ${pr.intruderD.toFixed(2)} m from the foe pad centre after 1 s (pushed out ${pr.pushedOut}) · own pad: state ${pr.state}, tank 10 → ${pr.tank.toFixed(0)} · respawn after ${pr.respawnS.toFixed(2)} s at ${pr.respawnD.toFixed(2)} m from the own pad`);
  }
  console.log('-'.repeat(100));
  const a = await runMatch(R, def, geo, SEED);
  log(`run A: ${a.wallS.toFixed(2)} s, hash ${a.hash}`);
  const b = await runMatch(R, def, geo, SEED);
  log(`run B: ${b.wallS.toFixed(2)} s, hash ${b.hash}`);
  const c = await runMatch(R, def, geo, SEED + 1);
  log(`run C: ${c.wallS.toFixed(2)} s, hash ${c.hash}`);

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
    check('FFA: 8 crews (one per runner), every runner starts on its own drop pad',
      a.crews === 8 && a.distinctCrews === 8 && a.padStartOff < 0.3, `crews in play ${a.crews}, distinct runner crews ${a.distinctCrews}, max start offset from the own pad ${a.padStartOff.toFixed(3)} m`);
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
    a.hash === b.hash && a.hash !== c.hash,
    `seed ${SEED}: ${a.hash} / ${b.hash}; seed ${SEED + 1}: ${c.hash}`);
  check('wall time: a full 3:00 match simulates in < 20 s (node, 8 runners)',
    a.wallS < 20 && b.wallS < 20 && c.wallS < 20,
    `${a.wallS.toFixed(2)} s / ${b.wallS.toFixed(2)} s / ${c.wallS.toFixed(2)} s for ${a.ticks} live ticks; sim tick p99 ${a.tickMsP99.toFixed(3)} ms, max ${a.tickMsMax.toFixed(2)} ms (budget ${(TICK * 1000).toFixed(1)} ms)`);

  console.log('-'.repeat(100));
  const failed = checks.filter((x) => !x.pass);
  const verdict = failed.length ? `FAIL (${failed.length})` : 'OK';
  console.log(`probe_match: ${checks.length - failed.length}/${checks.length} checks pass · ${((performance.now() - t0) / 1000).toFixed(2)} s`);
  console.log(`RESULT: ${verdict}`);
  try {
    const dir = resolve(HERE, '_reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, MODE === 'ffa' ? `probe_match_ffa_${MAP_ID}.json` : MAP_ID === 'pier18' ? 'probe_match.json' : `probe_match_${MAP_ID}.json`), JSON.stringify({
      checks, verdict, runs: [a, b, c].map((x) => ({ hash: x.hash, wallS: x.wallS, tickMsP99: x.tickMsP99, tickMsMax: x.tickMsMax, result: x.result, stats: x.stats, horns: x.horns })),
      at: new Date().toISOString(),
    }, null, 2) + '\n', 'utf8');
  } catch { /* best-effort */ }
  return failed.length ? 1 : 0;
}

/** CHANGED(CORE): FFA drop-pad rules on a fresh world (no countdown): an intruder is pushed out of a foe's pad, the own
 *  pad slicks + refills, a washed runner respawns on its own pad after respawnSeconds */
async function padRules(R: Rapier, def: MapDef, geo: MapGeometry, seed: number): Promise<{
  pads: number; distinct: boolean; r: number; intruderD: number; pushedOut: boolean; state: string; slickOnOwn: boolean; tank: number;
  refilled: boolean; respawnS: number; respawnD: number; respawnOnPad: boolean;
}> {
  const sc = def.scoring ?? { wallWeight: 0.35, floorMinNy: 0.45 };
  const painter = new Painter(buildAtlas(geo.paint, geo.atlasSize, { wallWeight: sc.wallWeight, floorMinNy: sc.floorMinNy }));
  const physics = new PhysicsWorld(R, geo);
  const roster = defaultRoster({ humanKit: 'mist-rasp', seed, skill: 'swell', mode: 'ffa' });
  const w = new MatchWorld({ def, geo, physics, painter, roster, seed, countdownS: 0, mode: 'ffa' });
  const it: PlayerIntent[] = w.runners.map(() => emptyIntent());
  const pads = w.crewPads;
  const distinct = new Set(pads.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`)).size === pads.length && new Set(pads.map((p) => p.crew)).size === pads.length;
  // 1. runner 1 dropped on runner 2's pad centre, standing still → shoved out within 1 s
  const foe = pads[2];
  w.devTeleport(1, foe.x + 0.3, foe.y + 0.05, foe.z + 0.2);
  for (let k = 0; k < 60; k++) w.step(it);
  const r1 = w.runners[1];
  const intruderD = Math.hypot(r1.x - foe.x, r1.z - foe.z);
  // 2. runner 0 on its own (still neutral) pad with a near-empty tank, holding SHIFT → slick form + refill
  w.devSetTank(0, 10);
  it[0].slick = true; it[0].yaw = w.runners[0].yaw;
  let slickSeen = false;
  for (let k = 0; k < 60; k++) { w.step(it); if (w.runners[0].state === 'slick') slickSeen = true; }
  it[0].slick = false;
  const r0 = w.runners[0];
  const state = r0.state, tank = r0.tank;
  // 3. runner 3 washed (by nobody) → back on its own pad after respawnSeconds
  const r3 = w.runners[3];
  w.devTeleport(3, pads[3].x + 5, pads[3].y + 0.05, pads[3].z);
  for (let k = 0; k < 3; k++) w.step(it);
  w.devDamage(3, 1000);
  let ticks = 0;
  while (!r3.alive && ticks < 600) { w.step(it); ticks++; }
  const respawnD = Math.hypot(r3.x - pads[3].x, r3.z - pads[3].z);
  physics.dispose();
  return {
    pads: pads.length, distinct, r: pads[0]?.r ?? 0, intruderD, pushedOut: intruderD >= foe.r - 0.05, state, slickOnOwn: slickSeen,
    tank, refilled: tank > 30, respawnS: ticks * TICK, respawnD, respawnOnPad: r3.alive && respawnD < 0.3 && Math.abs(ticks * TICK - 3) < 0.05,
  };
}

main().then((code) => process.exit(code), (e) => {
  console.log('SETUP FAILED:', (e as Error)?.stack ?? e);
  console.log('RESULT: FAIL');
  process.exit(2);
});
