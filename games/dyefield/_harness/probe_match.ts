// DYEFIELD — the 3:00 match loop (CONTRACT §10.1 / §12): countdown freeze, horns, result, end lock,
// determinism and wall time, on the real Pier 18 collision + paint atlas, Rapier in plain Node.
//
//   node _harness/probe_match.ts            # full 180 s match ×2 (same seed) + ×1 (other seed)
//   node _harness/probe_match.ts --verbose
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
import { emptyIntent, type PlayerIntent } from '../runtime/src/core/types.ts';
import { mulberry32, hash32 } from '../runtime/src/core/rng.ts';
import { MatchWorld, type MatchStats } from '../runtime/src/core/match/world.ts';
import { defaultRoster } from '../runtime/src/core/match/roster.ts';
import type { SimEvent } from '../runtime/src/core/match/events.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERBOSE = process.argv.includes('--verbose');

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
  result: { sun: number; gulf: number; neutral: number; winner: number } | null;
  coverageAtEnd: { sun: number; gulf: number; neutral: number };
  stats: MatchStats; washes: number; special: number[]; painted: number[]; refills: number; countdownTicks: number;
}

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
  constructor(seed: number, i: number, team: number) {
    this.rnd = mulberry32(hash32(seed, i, 0x5c417));
    this.s = team === 1 ? -1 : 1;
    const lanes = [-17, -6, 6, 17];
    this.lane = lanes[i % 4] * (this.s < 0 ? 1 : -1);
    this.pick();
  }
  private pick(): void {
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
      const pad = w.pads[r.side];
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
  const roster = defaultRoster({ humanKit: 'mist-rasp', humanName: 'Probe', seed, skill: 'fresh' });
  const world = new MatchWorld({ def, geo, physics, painter, roster, seed, durationS: MATCH.durationS, countdownS: MATCH.countdownS });
  const n = world.runners.length;
  const intents: PlayerIntent[] = world.runners.map(() => emptyIntent());
  const scripts = world.runners.map((r, i) => new Script(seed, i, r.team));
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
    result: world.result, coverageAtEnd, stats: { ...world.stats },
    washes: world.runners.reduce((s, r) => s + r.washes, 0),
    special: world.runners.map((r) => r.special), painted: world.runners.map((r) => r.painted),
    refills: world.runners.reduce((s, r) => s + r.refillsFromLow, 0), countdownTicks,
  };
  physics.dispose();
  return out;
}

async function main(): Promise<number> {
  const t0 = performance.now();
  const def = mapById('pier18');
  let R: Rapier, geo: MapGeometry;
  try { R = await loadRapier(); geo = await loadMapGeometry(def); } catch (e) { console.log('SETUP FAILED:', (e as Error).stack ?? e); return 2; }
  const SEED = 1234;
  console.log(`map pier18 · match ${MATCH.durationS} s + countdown ${MATCH.countdownS} s · 8 scripted runners · seed ${SEED} (×2) and ${SEED + 1}`);
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
  const sum = r ? r.sun + r.gulf + r.neutral : NaN;
  const winnerOk = r ? r.winner === (r.sun > r.gulf ? 1 : r.gulf > r.sun ? 2 : 0) : false;
  check('result: weighted coverage, sums to 1, strict winner, equals Painter.coverage() at the horn',
    !!r && Math.abs(sum - 1) < 1e-9 && winnerOk && r.sun > 0 && r.gulf > 0 && r.sun === a.coverageAtEnd.sun && r.gulf === a.coverageAtEnd.gulf,
    r ? `SUNCREW ${pct(r.sun)} · GULF CREW ${pct(r.gulf)} · neutral ${pct(r.neutral)} (sum ${sum.toFixed(12)}) → winner ${r.winner}` : 'no result');
  check('after the end: inputs ignored (no motion, no shots, no paint), pool empty',
    a.endLock.moved < 1e-6 && a.endLock.shots === 0 && a.endLock.hashSame && a.endLock.projectiles === 0,
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
    writeFileSync(resolve(dir, 'probe_match.json'), JSON.stringify({
      checks, verdict, runs: [a, b, c].map((x) => ({ hash: x.hash, wallS: x.wallS, tickMsP99: x.tickMsP99, tickMsMax: x.tickMsMax, result: x.result, stats: x.stats, horns: x.horns })),
      at: new Date().toISOString(),
    }, null, 2) + '\n', 'utf8');
  } catch { /* best-effort */ }
  return failed.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => {
  console.log('SETUP FAILED:', (e as Error)?.stack ?? e);
  console.log('RESULT: FAIL');
  process.exit(2);
});
