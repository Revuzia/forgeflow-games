// DYEFIELD — gate G8b (CONTRACT §10.3 / §12): a full 180 s 8-bot match on Pier 18, headless in node.
//
//   node _harness/probe_bots.ts                  # the gate: seed 1, skill fresh, twice + a second seed
//   node _harness/probe_bots.ts --seed 7         # another seed
//   node _harness/probe_bots.ts --skill fierce   # chill | fresh | fierce
//   node _harness/probe_bots.ts --once           # a single match (no determinism runs)
//   node _harness/probe_bots.ts --seconds 60     # shorter match (smoke; gates still printed, not a gate run)
//   node _harness/probe_bots.ts --trace 3        # per-second trace of bot 3
//   node _harness/probe_bots.ts --lineup mixed   # one of each kit per crew (MIST-RASP, SHEET-DRUM, NEEDLE-GLINT, POP-WELL)
//                                                # (added by lane KITSIM for G10; roster only, bots unchanged)
//   node _harness/probe_bots.ts --map cinder     # CHANGED(MAPSIM): any built map (pier18 | lockwell | cinder)
//   node _harness/probe_bots.ts --map lockwell --seeds 1,2,3
//                                                # CHANGED(MAPSIM): one match per listed seed; the play gates must pass
//                                                # on EVERY seed; determinism = the first seed replayed + distinct hashes
//
// The human slot (id 0) is a bot too. Every tick: director.think(intents) → world.step(intents) →
// world.drainEvents(). Gates (§10.3): both teams cover > 15 %, neutral < 55 %, ≥ 6 washes; no bot stuck
// (displacement < 1 m over any 6 s window while alive, live, and not deliberately holding); ≥ 20 slick
// entries and ≥ 4 refills from < 20 %; same seed → same world.hash(), another seed → another hash;
// the match simulates in < 20 s of wall time.
// Exit: 0 all pass · 1 a gate failed · 2 setup failure.

import { loadRapier, PhysicsWorld } from '../runtime/src/core/physics.ts';
import { mapById, type MapDef } from '../runtime/src/core/data.ts';
import { loadMapGeometry, type MapGeometry } from '../runtime/src/core/mapgeo.ts';
import { buildAtlas, type PaintAtlas } from '../runtime/src/core/paint/atlas.ts';
import { Painter } from '../runtime/src/core/paint/painter.ts';
import { MatchWorld } from '../runtime/src/core/match/world.ts';
import { defaultRoster, type BotSkill } from '../runtime/src/core/match/roster.ts';
import type { SimEvent } from '../runtime/src/core/match/events.ts';
import { buildNav, type NavGraph } from '../runtime/src/core/bots/nav.ts';
import { BotDirector } from '../runtime/src/core/bots/director.ts';
import { emptyIntent, type PlayerIntent } from '../runtime/src/core/types.ts';
import { TICK } from '../runtime/src/core/config.ts';

const argv = process.argv.slice(2);
const arg = (k: string, d: string): string => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const SEED = Number(arg('--seed', '1')) | 0;
const SKILL = arg('--skill', 'fresh') as BotSkill;
const ONCE = argv.includes('--once');
const SECONDS = Number(arg('--seconds', '180'));
const TRACE = Number(arg('--trace', '-1'));
const QUIET = argv.includes('--quiet');
const LINEUP = arg('--lineup', 'default');
const MAP = arg('--map', 'pier18');
const SEEDS = arg('--seeds', '').split(',').filter((x) => x.trim() !== '').map((x) => Number(x) | 0);
/** --lineup mixed: ids 0-3 SUNCREW and 4-7 GULF CREW each get mist-rasp, sheet-drum, needle-glint, pop-well */
const MIXED_BOT_KITS = ['sheet-drum', 'needle-glint', 'pop-well', 'mist-rasp'];

interface Check { name: string; pass: boolean; detail: string }
const checks: Check[] = [];
function check(name: string, pass: boolean, detail: string): void {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
}
const pct = (v: number): string => `${(v * 100).toFixed(1)} %`;
const f1 = (v: number): string => v.toFixed(1);

interface StuckEvent { id: number; name: string; t0: number; t1: number; x: number; y: number; z: number; mode: string }
interface RunResult {
  hash: string; wallMs: number; thinkMs: number; stepMs: number;
  coverage: { sun: number; gulf: number; neutral: number };
  washes: number; seaWashes: number; slicks: number; refills: number; shots: number; dry: number; hits: number;
  stuck: StuckEvent[];
  perBot: Array<{ id: number; name: string; team: number; washes: number; washed: number; painted: number; shots: number; dries: number;
    slicks: number; refills: number; jumps: number; modes: Record<string, number>; climbs: number; dist: number;
    twitchBody: number; twitchAim: number; reversals: number; moving: number; snapBody: number; snapAim: number }>;
  maxTurn: number;
  events: Record<string, number>;
  horns: string[];
  /** CHANGED(MAPSIM): map-feature use — spring launches, runner-seconds carried by a conveyor, runner-seconds above y 3 (upper floors) */
  launches: number; beltS: number; upperS: number;
  result: string;
}

async function runMatch(def: MapDef, geo: MapGeometry, R: Awaited<ReturnType<typeof loadRapier>>, nav: NavGraph,
  seed: number, skill: BotSkill, seconds: number, trace: number): Promise<RunResult> {
  const physics = new PhysicsWorld(R, geo);
  const sc = def.scoring ?? { wallWeight: 0.35, floorMinNy: 0.45 };
  const atlas: PaintAtlas = buildAtlas(geo.paint, geo.atlasSize, { wallWeight: sc.wallWeight, floorMinNy: sc.floorMinNy });
  const painter = new Painter(atlas);
  const roster = defaultRoster({ humanKit: 'mist-rasp', seed, skill, botKits: LINEUP === 'mixed' ? MIXED_BOT_KITS : undefined });
  roster[0].bot = true;                                   // §10.3: the human slot is a bot too
  const world = new MatchWorld({ def, geo, physics, painter, roster, seed, durationS: seconds });
  const director = new BotDirector(world, nav, seed, skill);
  const intents: PlayerIntent[] = roster.map(() => emptyIntent());
  const ev: SimEvent[] = [];
  const evCount: Record<string, number> = {};
  const horns: string[] = [];
  const N = world.runners.length;

  // stuck tracking: a sample every 0.5 s
  const SAMPLE = 30, WINDOW = 12;           // 12 × 0.5 s = 6 s
  const hist: Array<Array<{ x: number; y: number; z: number; ok: boolean; t: number; mode: string }>> = Array.from({ length: N }, () => []);
  const stuck: StuckEvent[] = [];
  const openStuck = new Array(N).fill(-1);
  const modeTicks: Array<Record<string, number>> = Array.from({ length: N }, () => ({}));
  const dist = new Array(N).fill(0);
  const climbs = new Array(N).fill(0);
  // motion quality. A "reversal" = the turn rate flips sign between consecutive ticks while both ticks turn
  // faster than 2 rad/s (a snap); a "shake" = two such reversals within 0.4 s (back and forth: jitter).
  // A heading reversal = the velocity heading flips > 120° within 0.25 s at > 1.5 m/s.
  const TW = 2.0 * TICK;
  const prevDy = new Array(N).fill(0), prevDa = new Array(N).fill(0), prevAim = new Array(N).fill(0);
  const lastRevBody = new Array(N).fill(-1e9), lastRevAim = new Array(N).fill(-1e9);
  const snapBody = new Array(N).fill(0), snapAim = new Array(N).fill(0);
  const twitchBody = new Array(N).fill(0), twitchAim = new Array(N).fill(0), liveTicks = new Array(N).fill(0), movingTicks = new Array(N).fill(0);
  const headHist: number[][] = Array.from({ length: N }, () => []);
  const reversals = new Array(N).fill(0);
  let maxTurn = 0;

  let thinkMs = 0, stepMs = 0, beltTicks = 0, upperTicks = 0;
  const t0 = performance.now();
  let guard = 0;
  while (world.phase !== 'ended' && guard++ < (seconds + 10) / TICK) {
    const a = performance.now();
    director.think(intents);
    const b = performance.now();
    world.step(intents);
    const c = performance.now();
    thinkMs += b - a; stepMs += c - b;
    ev.length = 0;
    world.drainEvents(ev);
    for (const e of ev) {
      evCount[e.t] = (evCount[e.t] ?? 0) + 1;
      if (e.t === 'horn') horns.push(`${e.kind}@${(world.durationS - world.timeLeft).toFixed(1)}s`);
      if (e.t === 'slick' && e.on && e.wall) climbs[e.pid]++;
    }
    for (let i = 0; i < N; i++) {
      const r = world.runners[i];
      if (world.phase === 'live' && r.alive && r.respawnT === 0) {
        if (r.onConveyor >= 0) beltTicks++;
        if (r.y > 3) upperTicks++;
        dist[i] += Math.hypot(r.x - r.px, r.z - r.pz);
        liveTicks[i]++;
        const spd = Math.hypot(r.x - r.px, r.z - r.pz) / TICK;
        if (spd > 1) movingTicks[i]++;
        let dy = r.yaw - r.pyaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        let da = r.aimYaw - prevAim[i]; da = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.abs(dy) > TW && Math.abs(prevDy[i]) > TW && Math.sign(dy) !== Math.sign(prevDy[i])) {
          snapBody[i]++;
          if (world.tick - lastRevBody[i] <= 24) twitchBody[i]++;
          lastRevBody[i] = world.tick;
        }
        if (Math.abs(da) > TW && Math.abs(prevDa[i]) > TW && Math.sign(da) !== Math.sign(prevDa[i])) {
          snapAim[i]++;
          if (world.tick - lastRevAim[i] <= 24) twitchAim[i]++;
          lastRevAim[i] = world.tick;
        }
        maxTurn = Math.max(maxTurn, Math.abs(dy) / TICK);
        prevDy[i] = dy; prevDa[i] = da;
        const hh = headHist[i];
        if (spd > 1.5) {
          hh.push(Math.atan2(r.x - r.px, r.z - r.pz));
          if (hh.length > 15) hh.shift();
          if (hh.length === 15) {
            let d = hh[14] - hh[0]; d = Math.atan2(Math.sin(d), Math.cos(d));
            if (Math.abs(d) > 2.1) { reversals[i]++; hh.length = 0; }
          }
        } else hh.length = 0;
      } else { prevDy[i] = 0; prevDa[i] = 0; headHist[i].length = 0; }
      prevAim[i] = r.aimYaw;
      const m = director.info(i).mode;
      modeTicks[i][m] = (modeTicks[i][m] ?? 0) + 1;
    }
    if (world.phase === 'live' && world.tick % SAMPLE === 0) {
      const tNow = world.durationS - world.timeLeft;
      for (let i = 0; i < N; i++) {
        const r = world.runners[i];
        const h = hist[i];
        h.push({ x: r.x, y: r.y, z: r.z, ok: r.alive && !director.holding(i), t: tNow, mode: director.info(i).mode });
        if (h.length > WINDOW + 1) h.shift();
        if (h.length === WINDOW + 1 && h.every((s) => s.ok)) {
          const s0 = h[0];
          let maxD = 0;
          for (const s of h) maxD = Math.max(maxD, Math.hypot(s.x - s0.x, s.y - s0.y, s.z - s0.z));
          if (maxD < 1.0) {
            const open = openStuck[i];
            if (open >= 0 && tNow - stuck[open].t1 < 0.6) stuck[open].t1 = tNow;          // same episode, extend it
            else {
              openStuck[i] = stuck.length;
              stuck.push({ id: i, name: r.name, t0: s0.t, t1: tNow, x: r.x, y: r.y, z: r.z, mode: h.map((s) => s.mode).join('>').slice(0, 60) });
            }
          }
        }
      }
    }
    if (trace >= 0 && world.tick % 60 === 0 && world.phase === 'live') {
      const r = world.runners[trace];
      const inf = director.info(trace);
      console.log(`  t=${(world.durationS - world.timeLeft).toFixed(0).padStart(3)} ${r.name.padEnd(7)} ${inf.mode.padEnd(6)} (${f1(r.x)},${f1(r.y)},${f1(r.z)}) ${r.state.padEnd(9)} tank ${r.tank.toFixed(0).padStart(3)} hp ${r.hp.toFixed(0).padStart(3)} tgt ${inf.target} hold ${inf.holding ? 1 : 0} shots ${r.shots}`);
    }
  }
  const wallMs = performance.now() - t0;
  const cov = world.result ? { sun: world.result.sun, gulf: world.result.gulf, neutral: world.result.neutral } : painter.coverage();
  const perBot = world.runners.map((r, i) => ({
    id: r.id, name: r.name, team: r.team, washes: r.washes, washed: r.washedCount, painted: r.painted, shots: r.shots, dries: r.dries,
    slicks: r.slicks, refills: r.refillsFromLow, jumps: r.jumps, modes: modeTicks[i], climbs: climbs[i], dist: dist[i],
    twitchBody: twitchBody[i] / Math.max(1e-9, liveTicks[i] * TICK / 60), twitchAim: twitchAim[i] / Math.max(1e-9, liveTicks[i] * TICK / 60),
    reversals: reversals[i] / Math.max(1e-9, liveTicks[i] * TICK / 60), moving: movingTicks[i] / Math.max(1, liveTicks[i]),
    snapBody: snapBody[i] / Math.max(1e-9, liveTicks[i] * TICK / 60), snapAim: snapAim[i] / Math.max(1e-9, liveTicks[i] * TICK / 60),
  }));
  let refills = 0; for (const r of world.runners) refills += r.refillsFromLow;
  return {
    hash: world.hash(), wallMs, thinkMs, stepMs, coverage: cov,
    washes: world.stats.washes, seaWashes: world.stats.seaWashes, slicks: world.stats.slicks, refills,
    shots: world.stats.shots, dry: world.stats.dry, hits: world.stats.hits,
    stuck, perBot, events: evCount, horns, maxTurn,
    launches: world.runners.reduce((a, r) => a + r.launches, 0), beltS: beltTicks * TICK, upperS: upperTicks * TICK,
    result: world.result ? `winner ${world.result.winner === 1 ? 'SUNCREW' : world.result.winner === 2 ? 'GULF CREW' : 'draw'}` : 'no result',
  };
}

function report(label: string, res: RunResult): void {
  console.log(`\n── ${label}: ${res.result} · SUNCREW ${pct(res.coverage.sun)} · GULF CREW ${pct(res.coverage.gulf)} · neutral ${pct(res.coverage.neutral)}`);
  console.log(`   washes ${res.washes} (sea ${res.seaWashes}) · hits ${res.hits} · shots ${res.shots} · dry ${res.dry} · slick entries ${res.slicks} · refills from <20 % ${res.refills}`);
  console.log(`   wall ${(res.wallMs / 1000).toFixed(2)} s (bots ${(res.thinkMs / 1000).toFixed(2)} s, sim ${(res.stepMs / 1000).toFixed(2)} s) · hash ${res.hash}`);
  console.log(`   horns: ${res.horns.join(' ')}`);
  const avg = (f: (b: RunResult['perBot'][number]) => number): number => res.perBot.reduce((a, b) => a + f(b), 0) / res.perBot.length;
  const worst = (f: (b: RunResult['perBot'][number]) => number): number => res.perBot.reduce((a, b) => Math.max(a, f(b)), 0);
  console.log(`   motion: shakes/min body ${avg((b) => b.twitchBody).toFixed(2)} (worst ${worst((b) => b.twitchBody).toFixed(2)}) · aim ${avg((b) => b.twitchAim).toFixed(2)} · single snaps/min body ${avg((b) => b.snapBody).toFixed(1)} · aim ${avg((b) => b.snapAim).toFixed(1)} · heading reversals/min ${avg((b) => b.reversals).toFixed(1)} · moving ${(avg((b) => b.moving) * 100).toFixed(0)} % of live time · max body turn ${res.maxTurn.toFixed(1)} rad/s`);
  console.log(`   stuck events: ${res.stuck.length}`);
  console.log(`   map features: spring launches ${res.launches} · on a conveyor ${res.beltS.toFixed(1)} runner-s · above y 3 ${res.upperS.toFixed(1)} runner-s`);
  if (QUIET) return;
  console.log('   id name     team  painted m²  washes washed  shots dries slicks refills jumps climbs dist m  moving   shake/min body aim  rev/min   mode share');
  for (const b of res.perBot) {
    const tot = Object.values(b.modes).reduce((a, v) => a + v, 0) || 1;
    const ms = Object.entries(b.modes).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v / tot * 100)}%`).join(' ');
    console.log(`   ${String(b.id).padStart(2)} ${b.name.padEnd(8)} ${b.team === 1 ? 'SUN ' : 'GULF'} ${b.painted.toFixed(0).padStart(10)}  ${String(b.washes).padStart(6)} ${String(b.washed).padStart(6)} ${String(b.shots).padStart(6)} ${String(b.dries).padStart(5)} ${String(b.slicks).padStart(6)} ${String(b.refills).padStart(7)} ${String(b.jumps).padStart(5)} ${String(b.climbs).padStart(6)} ${b.dist.toFixed(0).padStart(6)} ${(b.moving * 100).toFixed(0).padStart(6)}% ${b.twitchBody.toFixed(1).padStart(10)} ${b.twitchAim.toFixed(1).padStart(4)} ${b.reversals.toFixed(1).padStart(7)}   ${ms}`);
  }
  if (res.stuck.length) {
    console.log(`   stuck events (${res.stuck.length}):`);
    for (const s of res.stuck.slice(0, 30)) console.log(`     ${s.name} (id ${s.id}) ${s.t0.toFixed(1)}–${s.t1.toFixed(1)} s at (${f1(s.x)}, ${f1(s.y)}, ${f1(s.z)}) modes ${s.mode}`);
  } else console.log('   stuck events: none');
}

async function main(): Promise<number> {
  let def: MapDef, geo: MapGeometry, R: Awaited<ReturnType<typeof loadRapier>>, nav: NavGraph;
  try {
    def = mapById(MAP);
    R = await loadRapier();
    geo = await loadMapGeometry(def);
    const navPhysics = new PhysicsWorld(R, geo);
    nav = buildNav(geo, navPhysics, def);
    console.log(`map ${MAP} · nav ${nav.nodes} nodes / ${nav.edgeTo.length} edges (built in ${nav.stats.buildMs.toFixed(0)} ms) · skill ${SKILL} · ${SEEDS.length ? `seeds ${SEEDS.join(',')}` : `seed ${SEED}`} · ${SECONDS} s`);
    if (LINEUP === 'mixed') console.log(`lineup mixed: ${defaultRoster({ humanKit: 'mist-rasp', seed: SEED, skill: SKILL, botKits: MIXED_BOT_KITS }).map((e) => `${e.id}:${e.kit}`).join(' ')}`);
  } catch (e) {
    console.log('SETUP FAILED:', (e as Error).stack ?? e);
    return 2;
  }

  if (SEEDS.length) return multiSeed(def, geo, R, nav);

  const a = await runMatch(def, geo, R, nav, SEED, SKILL, SECONDS, TRACE);
  report(`run A (seed ${SEED})`, a);
  let b: RunResult | null = null, c: RunResult | null = null;
  if (!ONCE) {
    b = await runMatch(def, geo, R, nav, SEED, SKILL, SECONDS, -1);
    report(`run B (seed ${SEED}, repeat)`, b);
    c = await runMatch(def, geo, R, nav, SEED + 1, SKILL, SECONDS, -1);
    report(`run C (seed ${SEED + 1})`, c);
  }

  console.log('\n' + '-'.repeat(100));
  const gateRun = SECONDS === 180;
  if (!gateRun) console.log(`NOTE: ${SECONDS} s match — the gates below are printed for information; G8 needs the full 180 s.`);
  check('both teams cover > 15 %', a.coverage.sun > 0.15 && a.coverage.gulf > 0.15, `SUNCREW ${pct(a.coverage.sun)}, GULF CREW ${pct(a.coverage.gulf)}`);
  check('neutral share < 55 %', a.coverage.neutral < 0.55, `neutral ${pct(a.coverage.neutral)}`);
  check('≥ 6 washes in total', a.washes >= 6, `${a.washes} washes (${a.seaWashes} by the sea)`);
  check('no bot stuck (< 1 m over any 6 s window while alive and not holding)', a.stuck.length === 0,
    a.stuck.length ? a.stuck.slice(0, 4).map((s) => `${s.name} ${s.t0.toFixed(0)}-${s.t1.toFixed(0)} s @ (${f1(s.x)},${f1(s.y)},${f1(s.z)})`).join('; ') : '0 stuck windows');
  check('≥ 20 slick entries in total', a.slicks >= 20, `${a.slicks}`);
  {
    // Shakes are rare events: a bot is alive ~2.5 min, so at a true rate of 0.4/min it expects ~1 and the
    // max over 8 bots is routinely 3–4 (1.2–1.6/min) by chance alone. Gate the MEAN, cap the worst loosely.
    const n = a.perBot.length;
    const mb = a.perBot.reduce((x, b) => x + b.twitchBody, 0) / n, ma = a.perBot.reduce((x, b) => x + b.twitchAim, 0) / n;
    const tb = a.perBot.reduce((x, b) => Math.max(x, b.twitchBody), 0), ta = a.perBot.reduce((x, b) => Math.max(x, b.twitchAim), 0);
    const mv = a.perBot.reduce((x, b) => Math.min(x, b.moving), 1);
    check('bots look like players: no jitter (mean ≤ 0.75 back-and-forth shakes/min body & aim, worst bot ≤ 2.5), moving ≥ 60 % of live time',
      mb <= 0.75 && ma <= 0.75 && tb <= 2.5 && ta <= 2.5 && mv >= 0.6,
      `shakes/min body mean ${mb.toFixed(2)} (worst ${tb.toFixed(2)}), aim mean ${ma.toFixed(2)} (worst ${ta.toFixed(2)}), least moving ${(mv * 100).toFixed(0)} %`);
  }
  check('≥ 4 refills from < 20 %', a.refills >= 4, `${a.refills}`);
  if (b && c) {
    check('same seed → identical hash', a.hash === b.hash, `${a.hash} vs ${b.hash}`);
    check('different seed → different hash', a.hash !== c.hash, `${a.hash} vs ${c.hash}`);
    const worst = Math.max(a.wallMs, b.wallMs, c.wallMs);
    check('match simulates in < 20 s wall time', worst < 20000, `A ${(a.wallMs / 1000).toFixed(2)} s, B ${(b.wallMs / 1000).toFixed(2)} s, C ${(c.wallMs / 1000).toFixed(2)} s`);
    // seed C must pass the play gates too (not only the gate seed)
    check('seed+1 also: coverage > 15 % each, neutral < 55 %, ≥ 6 washes, no stuck',
      c.coverage.sun > 0.15 && c.coverage.gulf > 0.15 && c.coverage.neutral < 0.55 && c.washes >= 6 && c.stuck.length === 0,
      `SUN ${pct(c.coverage.sun)} GULF ${pct(c.coverage.gulf)} neutral ${pct(c.coverage.neutral)} washes ${c.washes} stuck ${c.stuck.length}`);
  } else {
    check('match simulates in < 20 s wall time', a.wallMs < 20000, `${(a.wallMs / 1000).toFixed(2)} s`);
  }
  const failed = checks.filter((x) => !x.pass);
  console.log('-'.repeat(100));
  console.log(failed.length ? `G8 bots: FAIL (${failed.length} of ${checks.length} checks)` : `G8 bots: PASS (${checks.length} checks)`);
  return failed.length ? 1 : 0;
}

/** the §10.3 play gates of one run: [name, pass, detail] */
function playGates(r: RunResult): Array<[string, boolean, string]> {
  const n = r.perBot.length;
  const mb = r.perBot.reduce((x, b) => x + b.twitchBody, 0) / n, ma = r.perBot.reduce((x, b) => x + b.twitchAim, 0) / n;
  const tb = r.perBot.reduce((x, b) => Math.max(x, b.twitchBody), 0), ta = r.perBot.reduce((x, b) => Math.max(x, b.twitchAim), 0);
  const mv = r.perBot.reduce((x, b) => Math.min(x, b.moving), 1);
  return [
    ['cover > 15 % each', r.coverage.sun > 0.15 && r.coverage.gulf > 0.15, `SUN ${pct(r.coverage.sun)} GULF ${pct(r.coverage.gulf)}`],
    ['neutral < 55 %', r.coverage.neutral < 0.55, `neutral ${pct(r.coverage.neutral)}`],
    ['≥ 6 washes', r.washes >= 6, `${r.washes} (sea ${r.seaWashes})`],
    ['no stuck', r.stuck.length === 0, r.stuck.length ? r.stuck.slice(0, 3).map((s) => `${s.name} ${s.t0.toFixed(0)}-${s.t1.toFixed(0)} s @ (${f1(s.x)},${f1(s.y)},${f1(s.z)}) ${s.mode.slice(0, 24)}`).join('; ') : '0'],
    ['≥ 20 slicks', r.slicks >= 20, `${r.slicks}`],
    ['≥ 4 refills < 20 %', r.refills >= 4, `${r.refills}`],
    ['no jitter / moving ≥ 60 %', mb <= 0.75 && ma <= 0.75 && tb <= 2.5 && ta <= 2.5 && mv >= 0.6,
      `shakes body ${mb.toFixed(2)} (worst ${tb.toFixed(2)}) aim ${ma.toFixed(2)} (worst ${ta.toFixed(2)}) · least moving ${(mv * 100).toFixed(0)} %`],
    ['< 20 s wall', r.wallMs < 20000, `${(r.wallMs / 1000).toFixed(2)} s`],
  ];
}

/** CHANGED(MAPSIM): --seeds a,b,c — one match per seed; every seed must pass the play gates */
async function multiSeed(def: MapDef, geo: MapGeometry, R: Awaited<ReturnType<typeof loadRapier>>, nav: NavGraph): Promise<number> {
  const runs: Array<{ seed: number; r: RunResult }> = [];
  for (const sd of SEEDS) {
    const r = await runMatch(def, geo, R, nav, sd, SKILL, SECONDS, sd === SEEDS[0] ? TRACE : -1);
    report(`seed ${sd}`, r);
    runs.push({ seed: sd, r });
  }
  const again = await runMatch(def, geo, R, nav, SEEDS[0], SKILL, SECONDS, -1);
  console.log(`\n── seed ${SEEDS[0]} replayed: hash ${again.hash}`);
  console.log('\n' + '-'.repeat(100));
  if (SECONDS !== 180) console.log(`NOTE: ${SECONDS} s matches — the gates below are printed for information; G8 needs the full 180 s.`);
  const names = playGates(runs[0].r).map((g) => g[0]);
  for (let k = 0; k < names.length; k++) {
    const per = runs.map(({ seed, r }) => ({ seed, g: playGates(r)[k] }));
    const bad = per.filter((p) => !p.g[1]);
    check(`${names[k]} on every seed (${SEEDS.length})`, bad.length === 0,
      per.map((p) => `s${p.seed}: ${p.g[2]}${p.g[1] ? '' : ' ✗'}`).join(' · '));
  }
  check('same seed → identical hash', again.hash === runs[0].r.hash, `${runs[0].r.hash} vs ${again.hash}`);
  const distinct = new Set(runs.map((x) => x.r.hash)).size;
  check('different seeds → different hashes', distinct === runs.length, `${distinct} distinct of ${runs.length}`);
  const failed = checks.filter((x) => !x.pass);
  console.log('-'.repeat(100));
  console.log(failed.length ? `G8 bots (${MAP}, seeds ${SEEDS.join(',')}): FAIL (${failed.length} of ${checks.length} checks)` : `G8 bots (${MAP}, seeds ${SEEDS.join(',')}): PASS (${checks.length} checks)`);
  return failed.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.log('SETUP FAILED:', (e as Error).stack ?? e); process.exit(2); });
