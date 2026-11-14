// DYEFIELD — gate G8b (CONTRACT §10.3 / §12): a full 180 s 8-bot match on Pier 18, headless in node.
//
//   node _harness/probe_bots.ts                  # the gate: seed 1, skill swell, twice + a second seed
//   node _harness/probe_bots.ts --seed 7         # another seed
//   node _harness/probe_bots.ts --skill storm    # breeze | swell | storm (CHANGED(BOTFIX): the original tier names;
//                                                # the old chill | fresh | fierce still parse as aliases)
//   node _harness/probe_bots.ts --once           # a single match (no determinism runs)
//   node _harness/probe_bots.ts --seconds 60     # shorter match (smoke; gates still printed, not a gate run)
//   node _harness/probe_bots.ts --trace 3        # per-second trace of bot 3
//   node _harness/probe_bots.ts --lineup mixed   # one of each kit per crew (MIST-RASP, SHEET-DRUM, NEEDLE-GLINT, POP-WELL)
//                                                # (added by lane KITSIM for G10; roster only, bots unchanged)
//   node _harness/probe_bots.ts --map cinder     # CHANGED(MAPSIM): any built map (pier18 | lockwell | cinder)
//   node _harness/probe_bots.ts --map lockwell --seeds 1,2,3
//                                                # CHANGED(MAPSIM): one match per listed seed; the play gates must pass
//                                                # on EVERY seed; determinism = the first seed replayed + distinct hashes
//                                                # CHANGED(BOTFIX): then per-kit washes / special ready + use summed
//                                                # over the seeds (with --lineup mixed: the balance target, info only)
//   node _harness/probe_bots.ts --mode ffa --map cinder --seeds 1,2,3
//                                                # CHANGED(CORE) (CONTRACT_FFA §F4): FREE-FOR-ALL — 8 crews, one bot each;
//                                                # gates: every crew ≥ 4 %, neutral < 60 %, ≥ 10 washes, no stuck bot, no
//                                                # jitter, deterministic, < 25 s wall (slicks / refills printed as info)
//                                                # review F3: FFA defaults to --lineup mixed (the shipping roster; pass
//                                                # --lineup default for all MIST-RASP) and gates a fight standoff (a bot
//                                                # in FIGHT, not moving, no shot for > FFA_MAX_STANDOFF_S)
//                                                # CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S6): FFA (both rules) also gates the
//                                                # spawn sites (_harness/spawn_audit.ts: runners washed ≥ 5× used ≥ 4 distinct
//                                                # sites, no respawn within 3 m of a runner or at one of its last 2 sites; the
//                                                # unseen-respawn rate is LOGGED here — S6 gates it ≥ 90 % in probe_match),
//                                                # no bot targeting a spawn-protected runner,
//                                                # and the protection invariants (never while dead, gone after dealing damage,
//                                                # never ended without an action) — FFA TURF has spawn protection now
//   node _harness/probe_bots.ts --rule washout --mode teams --map lockwell --seeds 1,2,3
//                                                # CHANGED(WASHOUT) (CONTRACT_WASHOUT §W3/§W8): the WASHOUT rule (mixed lineup
//                                                # by default, both modes; --seeds defaults to 1,2,3). Gates on every seed: no
//                                                # stuck bot, no fight standoff > 5 s, TEAMS both crews score ≥ 5 / FFA ≥ 6 of 8
//                                                # crews score ≥ 1 and ≥ 25 credited washes, no bot ever targets a spawn-
//                                                # protected runner, score events = credited washes, each 'score' right after
//                                                # its 'washed', spawn protection never on a dead runner / kept after dealing
//                                                # damage / ended without an action, < 25 s wall; then the seed replayed
//                                                # (same hash). --limit N overrides the score limit (0 = none; default: the
//                                                # map's data/maps.json washout block).
//   node _harness/probe_bots.ts --rule washout --tune [--seeds 1..8] [--maps pier18,lockwell,cinder]
//                                                # CHANGED(WASHOUT): the W1 limit tuning — bot-only WASHOUT matches with NO
//                                                # limit on every map, TEAMS and FFA: PER MAP the leader's score at the horn,
//                                                # its distribution, the share of matches whose leader reaches that map's
//                                                # configured limit (data/maps.json <map>.washout; target 35–65 %, gated per
//                                                # map and mode) and the limits inside the band; then all maps together
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
import { MatchWorld, MATCH_FFA, WASHOUT, washoutLimitFor } from '../runtime/src/core/match/world.ts';
import { defaultRoster, parseBotSkill, type BotSkill } from '../runtime/src/core/match/roster.ts';
import type { SimEvent } from '../runtime/src/core/match/events.ts';
import { buildNav, type NavGraph } from '../runtime/src/core/bots/nav.ts';
import { BotDirector } from '../runtime/src/core/bots/director.ts';
import { emptyIntent, parseMatchMode, parseMatchRule, type MatchMode, type MatchRule, type PlayerIntent } from '../runtime/src/core/types.ts';
import { crewDef } from '../runtime/src/core/data.ts';
import { TICK } from '../runtime/src/core/config.ts';
import { SpawnAudit, spawnGates, unseenText, type SpawnAuditSummary } from './spawn_audit.ts';

const argv = process.argv.slice(2);
const arg = (k: string, d: string): string => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const SEED = Number(arg('--seed', '1')) | 0;
const SKILL: BotSkill = parseBotSkill(arg('--skill', 'swell'));
const ONCE = argv.includes('--once');
const SECONDS = Number(arg('--seconds', '180'));
const TRACE = Number(arg('--trace', '-1'));
const QUIET = argv.includes('--quiet');
const MAP = arg('--map', 'pier18');
/** CHANGED(WASHOUT): --rule turf (default) | washout; --tune (the W1 limit tuning); --limit N (0 = no limit) */
const RULE: MatchRule = parseMatchRule(arg('--rule', 'turf'));
const WASH = RULE === 'washout';
const TUNE = argv.includes('--tune');
const LIMIT_ARG = argv.includes('--limit') ? Number(arg('--limit', '0')) : undefined;
const SEEDS_RAW = arg('--seeds', '').split(',').filter((x) => x.trim() !== '').map((x) => Number(x) | 0);
/** CHANGED(WASHOUT): WASHOUT always runs the multi-seed gates (default seeds 1,2,3; the tuning default is 1..8) */
const SEEDS = SEEDS_RAW.length ? SEEDS_RAW : WASH ? (TUNE ? [1, 2, 3, 4, 5, 6, 7, 8] : [1, 2, 3]) : [];
/** CHANGED(CORE): --mode teams (default) | ffa */
const MODE: MatchMode = parseMatchMode(arg('--mode', 'teams'));
const FFA = MODE === 'ffa';
/** --lineup default | mixed. review F3: FFA defaults to MIXED — the roster the game ships (main.ts matchRoster →
 *  mixedBotKits(kit): for the default MIST-RASP human exactly MIXED_BOT_KITS below); teams keeps 'default' (all MIST-RASP).
 *  CHANGED(WASHOUT): WASHOUT defaults to MIXED in both modes (CONTRACT_WASHOUT §W3: TEAMS mixed + FFA mixed) */
const LINEUP = arg('--lineup', FFA || WASH ? 'mixed' : 'default');
/** CHANGED(WASHOUT): the W3 gates (CONTRACT_WASHOUT §W3) + the W1 tuning target */
const WO_TEAM_MIN_SCORE = 5, WO_FFA_MIN_SCORERS = 6, WO_FFA_MIN_WASHES = 25, WO_WALL_MS = 25000;
const WO_TUNE_LO = 0.35, WO_TUNE_HI = 0.65;
/** FFA gates (CONTRACT_FFA §F4) */
const FFA_MIN_CREW = 0.04, FFA_MAX_NEUTRAL = 0.60, FFA_MIN_WASHES = 10, FFA_WALL_MS = 25000;
/** review F3: the longest a bot may sit in FIGHT without moving or firing (s); the stuck gate skips holding bots and the
 *  idle watchdog engaged ones, so a fight neither side can open (across a drop, each just out of reach) went unseen */
const FFA_MAX_STANDOFF_S = 5;
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
  /** process CPU time (user + system, process.cpuUsage) over the same span as wallMs — info (skeptic fix 2026-09-30: the
   *  box runs near 100 % CPU from other sessions, so a wall-gate miss needs CPU-time or same-minute A/B evidence) */
  cpuMs: number;
  coverage: { sun: number; gulf: number; neutral: number };
  /** CHANGED(CORE): weighted share by crew id ([0] neutral) and the crews in play */
  shares: number[]; crews: number[]; crewNames: Record<number, string>;
  washes: number; seaWashes: number; slicks: number; refills: number; shots: number; dry: number; hits: number;
  stuck: StuckEvent[];
  perBot: Array<{ id: number; name: string; team: number; washes: number; washed: number; painted: number; shots: number; dries: number;
    slicks: number; refills: number; jumps: number; modes: Record<string, number>; climbs: number; dist: number;
    twitchBody: number; twitchAim: number; reversals: number; moving: number; snapBody: number; snapAim: number;
    /** review F3: longest stretch (s) in FIGHT without moving (> 1 m/s) or a shot */
    standoff: number }>;
  maxTurn: number;
  events: Record<string, number>;
  horns: string[];
  /** CHANGED(MAPSIM): map-feature use — spring launches, runner-seconds carried by a conveyor, runner-seconds above y 3 (upper floors) */
  launches: number; beltS: number; upperS: number;
  result: string;
  /** CHANGED(BOTFIX): body shakes attributed to the brain's mode + what drove the facing ('toggle' = the facing source
   *  flipped between aim and motion within 0.4 s, 'aim' = firing, 'move' = the stick); washes by the washer's kit
   *  (and cause); special meter ready / start counts per runner */
  shakeBy: Record<string, number>;
  kits: string[];
  washKit: Record<string, number>;
  washKitCause: Record<string, number>;
  ready: number[]; started: number[];
  /** glint reactions (CHANGED(BOTFIX)): bots that broke a charger's line after noticing its glint */
  dodges: number;
  /** CHANGED(SPAWNS): hops out of an off-nav bank pocket (director belowNav; information) */
  climbOuts: number;
  /** CHANGED(CONTROLS) (CONTRACT_CONTROLS §C2), information: MatchWorld.stats special-press outcomes — starts that popped a
   *  runner out of its slick / wall, starts from the buffer, 'denied' presses, and the runner-ticks where the §C2 rules
   *  decided differently from the pre-§C2 rule (early / late); early = late = 0 ⇒ §C2 left this match's hash unchanged */
  specialPress: { pops: number; buffered: number; denied: number; early: number; late: number };
  /** CHANGED(WASHOUT): the rule, the final score per crew id, the limit played to, how it ended, 'score' events seen,
   *  bot-ticks whose target was a spawn-protected runner, washes of a victim by its own pad (r + 3 m) / < 4 s after its
   *  respawn, and the match seconds played */
  rule: MatchRule; mode: MatchMode; scores: number[]; limit: number; endedBy: string; scoreEvents: number; protTargetTicks: number;
  padWashes: number; freshWashes: number; playedS: number;
  /** CHANGED(WASHOUT) follow-up: 'score' events not right after their own 'washed' (and credited washes not followed by
   *  their 'score'); runner-ticks dead yet protected; runner-ticks still protected after dealing damage that tick;
   *  protection that ended early in a tick with no action (shot / flick / glint / roll on / sub throw / special start)
   *  and no damage dealt */
  scoreOrderBad: number; protDead: number; protAfterHit: number; protEndNoAction: number;
  /** CHANGED(SPAWNS): FFA — the spawn audit (null in teams) */
  spawn: SpawnAuditSummary | null;
}

/** CHANGED(WASHOUT): per-run overrides (the tuning loops modes; default = the CLI's) */
interface RunOpt { mode: MatchMode; rule: MatchRule; limit?: number }

async function runMatch(def: MapDef, geo: MapGeometry, R: Awaited<ReturnType<typeof loadRapier>>, nav: NavGraph,
  seed: number, skill: BotSkill, seconds: number, trace: number, opt: RunOpt = { mode: MODE, rule: RULE, limit: LIMIT_ARG }): Promise<RunResult> {
  const physics = new PhysicsWorld(R, geo);
  const sc = def.scoring ?? { wallWeight: 0.35, floorMinNy: 0.45 };
  const atlas: PaintAtlas = buildAtlas(geo.paint, geo.atlasSize, { wallWeight: sc.wallWeight, floorMinNy: sc.floorMinNy });
  const painter = new Painter(atlas);
  const ffa = opt.mode === 'ffa';
  const roster = defaultRoster({ humanKit: 'mist-rasp', seed, skill, botKits: LINEUP === 'mixed' ? MIXED_BOT_KITS : undefined, mode: opt.mode });
  roster[0].bot = true;                                   // §10.3: the human slot is a bot too
  const world = opt.rule === 'washout'
    ? new MatchWorld({ def, geo, physics, painter, roster, seed, durationS: seconds, mode: opt.mode, rule: 'washout', scoreLimit: opt.limit })
    : new MatchWorld({ def, geo, physics, painter, roster, seed, durationS: seconds, mode: opt.mode });
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
  const shakeBy: Record<string, number> = {};
  const srcPrev = new Array(N).fill(0), srcFlip = new Array(N).fill(-1e9);
  const washKit: Record<string, number> = {}, washKitCause: Record<string, number> = {};
  const ready = new Array(N).fill(0), started = new Array(N).fill(0);
  const standRun = new Array(N).fill(0), standMax = new Array(N).fill(0), standShots = new Array(N).fill(-1);
  // CHANGED(WASHOUT): score events, targets under spawn protection, washes by the victim's own pad / fresh from a respawn
  let scoreEvents = 0, protTargetTicks = 0, padWashes = 0, freshWashes = 0, liveSteps = 0;
  const respAt = new Array(N).fill(-1e9);
  // CHANGED(WASHOUT) follow-up (skeptic review): event-order faults ('score' not right after its 'washed'), and the spawn-
  // protection invariants — never on a dead runner, gone once the runner dealt damage, never ended early without an action
  const woRule = opt.rule === 'washout';
  // CHANGED(SPAWNS): spawn protection runs in FFA TURF too — its invariants are tracked in every rule with protection
  const protRule = woRule || ffa;
  const audit = ffa ? new SpawnAudit(world) : null;
  let scoreOrderBad = 0, protDead = 0, protAfterHit = 0, protEndNoAction = 0;
  const protPrev = new Array(N).fill(0);
  const acted = new Array<boolean>(N).fill(false), dealt = new Array<boolean>(N).fill(false);

  let thinkMs = 0, stepMs = 0, beltTicks = 0, upperTicks = 0;
  const t0 = performance.now();
  const cpu0 = process.cpuUsage();
  let guard = 0;
  while (world.phase !== 'ended' && guard++ < (seconds + 10) / TICK) {
    const a = performance.now();
    director.think(intents);
    const b = performance.now();
    if (world.phase === 'live') liveSteps++;
    if (protRule) for (let i = 0; i < N; i++) protPrev[i] = world.runners[i].protectedT;
    world.step(intents);
    const c = performance.now();
    thinkMs += b - a; stepMs += c - b;
    ev.length = 0;
    world.drainEvents(ev);
    audit?.observe(ev);                                     // CHANGED(SPAWNS): FFA spawn sites
    if (protRule) {
      // CHANGED(WASHOUT) follow-up: the order (WASHOUT) and protection invariants of this tick (read-only). CHANGED(SPAWNS):
      // the protection invariants in FFA TURF too
      acted.fill(false); dealt.fill(false);
      for (let k = 0; k < ev.length; k++) {
        const e = ev[k];
        if (woRule && e.t === 'score') { const p = ev[k - 1]; if (!p || p.t !== 'washed' || p.by !== e.pid || world.runners[e.pid].team !== e.crew) scoreOrderBad++; }
        else if (woRule && e.t === 'washed' && e.by !== null) { const nx = ev[k + 1]; if (!nx || nx.t !== 'score' || nx.pid !== e.by) scoreOrderBad++; }
        if (e.t === 'hit' && e.by >= 0 && e.by < N) dealt[e.by] = true;
        if ((e.t === 'shot' || e.t === 'flick' || e.t === 'glint') || (e.t === 'roll' && e.on) || (e.t === 'sub' && e.phase === 'throw') || (e.t === 'special' && e.phase === 'start')) acted[e.pid] = true;
      }
      for (let i = 0; i < N; i++) {
        const r = world.runners[i];
        if (!r.alive && r.protectedT > 0) protDead++;
        if (dealt[i] && r.protectedT > 0) protAfterHit++;
        // ended early (not the natural last tick, not the horn, not a wash) with no action and no damage dealt this tick
        if (world.phase === 'live' && r.alive && protPrev[i] > TICK + 1e-9 && r.protectedT === 0 && !acted[i] && !dealt[i]) protEndNoAction++;
      }
    }
    for (const e of ev) {
      evCount[e.t] = (evCount[e.t] ?? 0) + 1;
      if (e.t === 'score') scoreEvents++;
      if (e.t === 'respawn') respAt[e.pid] = world.tick;
      if (e.t === 'washed') {
        // the victim's own pad (teams) — CHANGED(SPAWNS): FFA, the site it last spawned at (r = the marker's 1.6 m)
        const v = world.runners[e.victim], tp = world.padOf(v), s = world.spawnSiteOf(v);
        const p = tp ?? (s ? { x: s.x, y: s.y, z: s.z, r: MATCH_FFA.padRadius } : null);
        if (p && Math.abs(v.y - p.y) < 2 && Math.hypot(v.x - p.x, v.z - p.z) < p.r + 3) padWashes++;
        if (world.tick - respAt[e.victim] < Math.round(4 / TICK)) freshWashes++;
      }
      if (e.t === 'horn') horns.push(`${e.kind}@${(opt.rule === 'washout' ? liveSteps * TICK : world.durationS - world.timeLeft).toFixed(1)}s`);   // WASHOUT: a limit ending zeroes timeLeft
      if (e.t === 'slick' && e.on && e.wall) climbs[e.pid]++;
      if (e.t === 'washed' && e.by !== null && e.by >= 0 && e.by < N) {
        const k = world.runners[e.by].kit;
        washKit[k] = (washKit[k] ?? 0) + 1;
        washKitCause[`${k}:${e.cause}`] = (washKitCause[`${k}:${e.cause}`] ?? 0) + 1;
      }
      if (e.t === 'special' && e.phase === 'ready') ready[e.pid]++;
      if (e.t === 'special' && e.phase === 'start') started[e.pid]++;
    }
    for (let i = 0; i < N; i++) {
      const r = world.runners[i];
      if (world.phase === 'live' && r.alive && r.respawnT === 0) {
        { const tg = director.info(i).target; if (tg >= 0 && world.runners[tg].protectedT > 0) protTargetTicks++; }   // CHANGED(WASHOUT)
        if (r.onConveyor >= 0) beltTicks++;
        if (r.y > 3) upperTicks++;
        dist[i] += Math.hypot(r.x - r.px, r.z - r.pz);
        liveTicks[i]++;
        const spd = Math.hypot(r.x - r.px, r.z - r.pz) / TICK;
        if (spd > 1) movingTicks[i]++;
        // review F3: a fight standoff — in FIGHT, not moving, no shot since the stretch began
        if (director.info(i).mode === 'fight' && spd <= 1 && r.shots === standShots[i]) { if (++standRun[i] > standMax[i]) standMax[i] = standRun[i]; }
        else { standRun[i] = 0; standShots[i] = r.shots; }
        let dy = r.yaw - r.pyaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        let da = r.aimYaw - prevAim[i]; da = Math.atan2(Math.sin(da), Math.cos(da));
        const src = r.firing || r.flicking ? 1 : 0;
        if (src !== srcPrev[i]) { srcPrev[i] = src; srcFlip[i] = world.tick; }
        if (Math.abs(dy) > TW && Math.abs(prevDy[i]) > TW && Math.sign(dy) !== Math.sign(prevDy[i])) {
          snapBody[i]++;
          if (world.tick - lastRevBody[i] <= 24) {
            twitchBody[i]++;
            const why = world.tick - srcFlip[i] <= 24 ? 'toggle' : src ? 'aim' : 'move';
            const key = `${director.info(i).mode}/${why}/${r.kit}`;
            shakeBy[key] = (shakeBy[key] ?? 0) + 1;
          }
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
      } else { prevDy[i] = 0; prevDa[i] = 0; headHist[i].length = 0; standRun[i] = 0; standShots[i] = -1; }
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
  const cpuU = process.cpuUsage(cpu0);
  const cpuMs = (cpuU.user + cpuU.system) / 1000;
  const cov = world.result ? { sun: world.result.sun, gulf: world.result.gulf, neutral: world.result.neutral } : painter.coverage();
  const perBot = world.runners.map((r, i) => ({
    id: r.id, name: r.name, team: r.team, washes: r.washes, washed: r.washedCount, painted: r.painted, shots: r.shots, dries: r.dries,
    slicks: r.slicks, refills: r.refillsFromLow, jumps: r.jumps, modes: modeTicks[i], climbs: climbs[i], dist: dist[i],
    twitchBody: twitchBody[i] / Math.max(1e-9, liveTicks[i] * TICK / 60), twitchAim: twitchAim[i] / Math.max(1e-9, liveTicks[i] * TICK / 60),
    reversals: reversals[i] / Math.max(1e-9, liveTicks[i] * TICK / 60), moving: movingTicks[i] / Math.max(1, liveTicks[i]),
    snapBody: snapBody[i] / Math.max(1e-9, liveTicks[i] * TICK / 60), snapAim: snapAim[i] / Math.max(1e-9, liveTicks[i] * TICK / 60),
    standoff: standMax[i] * TICK,
  }));
  let refills = 0; for (const r of world.runners) refills += r.refillsFromLow;
  const shares = world.result?.shares ?? Array.from(painter.coverageByTeam());
  const crewNames: Record<number, string> = {};
  for (const r of world.runners) crewNames[r.team] = ffa ? `${r.name}/${crewDef('ffa', r.team).key}` : crewDef('teams', r.team).name;
  let resText = world.result ? `winner ${world.result.winner === 1 ? 'SUNCREW' : world.result.winner === 2 ? 'GULF CREW' : 'draw'}` : 'no result';
  if (ffa && world.result) resText = world.result.winner ? `winner ${crewNames[world.result.winner]}` : `draw (${(world.result.tied ?? []).map((t) => crewNames[t]).join(', ')})`;
  const scores = world.scores().slice();
  if (opt.rule === 'washout' && world.result) {
    resText += ` · WASHOUT ${world.result.endedBy === 'limit' ? `LIMIT ${world.limit} reached` : `horn (limit ${world.limit || 'none'})`} at ${(liveSteps * TICK).toFixed(1)} s · scores ${world.crews.map((c) => `${ffa ? crewNames[c].split('/')[0] : crewNames[c]} ${scores[c]}`).join(' · ')}`;
  }
  return {
    rule: opt.rule, mode: opt.mode, scores, limit: world.limit, endedBy: world.result?.endedBy ?? 'none', scoreEvents, protTargetTicks,
    padWashes, freshWashes, playedS: liveSteps * TICK, scoreOrderBad, protDead, protAfterHit, protEndNoAction,
    spawn: audit ? audit.summary() : null,
    hash: world.hash(), wallMs, cpuMs, thinkMs, stepMs, coverage: cov, shares, crews: world.crews.slice(), crewNames,
    washes: world.stats.washes, seaWashes: world.stats.seaWashes, slicks: world.stats.slicks, refills,
    shots: world.stats.shots, dry: world.stats.dry, hits: world.stats.hits,
    stuck, perBot, events: evCount, horns, maxTurn,
    launches: world.runners.reduce((a, r) => a + r.launches, 0), beltS: beltTicks * TICK, upperS: upperTicks * TICK,
    shakeBy, kits: world.runners.map((r) => r.kit), washKit, washKitCause, ready, started, dodges: director.stats?.dodges ?? 0,
    climbOuts: director.stats?.climbOuts ?? 0,
    specialPress: { pops: world.stats.specialPops, buffered: world.stats.specialBuffered, denied: world.stats.specialDenied,
      early: world.stats.specialRuleEarly, late: world.stats.specialRuleLate },
    result: resText,
  };
}

/** CHANGED(CORE): the per-crew coverage line of an FFA run (share desc) */
function ffaCov(res: RunResult): string {
  return res.crews.slice().sort((a, b) => res.shares[b] - res.shares[a] || a - b).map((c) => `${res.crewNames[c]} ${pct(res.shares[c])}`).join(' · ');
}

function report(label: string, res: RunResult): void {
  const ffa = res.mode === 'ffa';
  if (ffa) console.log(`\n── ${label}: ${res.result} · ${ffaCov(res)} · neutral ${pct(res.shares[0])}`);
  else console.log(`\n── ${label}: ${res.result} · SUNCREW ${pct(res.coverage.sun)} · GULF CREW ${pct(res.coverage.gulf)} · neutral ${pct(res.coverage.neutral)}`);
  console.log(`   washes ${res.washes} (sea ${res.seaWashes}) · hits ${res.hits} · shots ${res.shots} · dry ${res.dry} · slick entries ${res.slicks} · refills from <20 % ${res.refills}`);
  if (res.rule === 'washout') {
    const credited = res.scores.reduce((a, v) => a + v, 0);
    console.log(`   WASHOUT: credited washes ${credited} (score events ${res.scoreEvents}) of ${res.washes} · by the victim's own pad ${res.padWashes} · within 4 s of the victim's respawn ${res.freshWashes} · bot-ticks aimed at a protected runner ${res.protTargetTicks} · score-order faults ${res.scoreOrderBad} · protection faults ${res.protDead}/${res.protAfterHit}/${res.protEndNoAction}`);
  }
  if (res.spawn) {
    // CHANGED(SPAWNS): the FFA spawn audit (spawn_audit.ts)
    const s = res.spawn;
    console.log(`   FFA spawns: ${s.respawns} respawns · unseen ${s.unseen} (${(s.unseenRate * 100).toFixed(1)} %) · nearest runner min ${Number.isFinite(s.minRunnerDist) ? s.minRunnerDist.toFixed(2) : '-'} m · < 3 m ${s.within3} · last-2 repeats ${s.repeats} · fallback choices ${s.fallbacks} · distinct sites per runner ${s.distinct.join('/')} (washed ${s.washed.join('/')}) · bot-ticks aimed at a protected runner ${res.protTargetTicks} · protection faults ${res.protDead}/${res.protAfterHit}/${res.protEndNoAction} · washes at the victim's site ${res.padWashes} · within 4 s of its respawn ${res.freshWashes}`);
  }
  console.log(`   wall ${(res.wallMs / 1000).toFixed(2)} s (bots ${(res.thinkMs / 1000).toFixed(2)} s, sim ${(res.stepMs / 1000).toFixed(2)} s; process CPU ${(res.cpuMs / 1000).toFixed(2)} s) · hash ${res.hash}`);
  console.log(`   horns: ${res.horns.join(' ')}`);
  const avg = (f: (b: RunResult['perBot'][number]) => number): number => res.perBot.reduce((a, b) => a + f(b), 0) / res.perBot.length;
  const worst = (f: (b: RunResult['perBot'][number]) => number): number => res.perBot.reduce((a, b) => Math.max(a, f(b)), 0);
  console.log(`   motion: shakes/min body ${avg((b) => b.twitchBody).toFixed(2)} (worst ${worst((b) => b.twitchBody).toFixed(2)}) · aim ${avg((b) => b.twitchAim).toFixed(2)} · single snaps/min body ${avg((b) => b.snapBody).toFixed(1)} · aim ${avg((b) => b.snapAim).toFixed(1)} · heading reversals/min ${avg((b) => b.reversals).toFixed(1)} · moving ${(avg((b) => b.moving) * 100).toFixed(0)} % of live time · max body turn ${res.maxTurn.toFixed(1)} rad/s`);
  console.log(`   stuck events: ${res.stuck.length} · off-nav climb-out hops ${res.climbOuts}`);
  console.log(`   map features: spring launches ${res.launches} · on a conveyor ${res.beltS.toFixed(1)} runner-s · above y 3 ${res.upperS.toFixed(1)} runner-s`);
  const sb = Object.entries(res.shakeBy).sort((a, c) => c[1] - a[1]);
  console.log(`   body shakes by mode/cause/kit: ${sb.length ? sb.map(([k, v]) => `${k} ${v}`).join(' · ') : 'none'}`);
  console.log(`   ${kitLine(res)}`);
  const sp = res.specialPress;
  console.log(`   special presses (CONTRACT_CONTROLS §C2, info): popped out ${sp.pops} · from the buffer ${sp.buffered} · denied ${sp.denied} · vs the pre-§C2 rule: early starts ${sp.early}, late runner-ticks ${sp.late}${sp.early + sp.late === 0 ? ' (none: this hash is the pre-§C2 one)' : ''}`);
  if (QUIET) return;
  console.log('   id name     team  painted m²  washes washed  shots dries slicks refills jumps climbs dist m  moving   shake/min body aim  rev/min   mode share');
  for (const b of res.perBot) {
    const tot = Object.values(b.modes).reduce((a, v) => a + v, 0) || 1;
    const ms = Object.entries(b.modes).sort((a, c) => c[1] - a[1]).map(([k, v]) => `${k} ${Math.round(v / tot * 100)}%`).join(' ');
    console.log(`   ${String(b.id).padStart(2)} ${b.name.padEnd(8)} ${ffa ? crewDef('ffa', b.team).key.slice(0, 4).padEnd(4) : b.team === 1 ? 'SUN ' : 'GULF'} ${b.painted.toFixed(0).padStart(10)}  ${String(b.washes).padStart(6)} ${String(b.washed).padStart(6)} ${String(b.shots).padStart(6)} ${String(b.dries).padStart(5)} ${String(b.slicks).padStart(6)} ${String(b.refills).padStart(7)} ${String(b.jumps).padStart(5)} ${String(b.climbs).padStart(6)} ${b.dist.toFixed(0).padStart(6)} ${(b.moving * 100).toFixed(0).padStart(6)}% ${b.twitchBody.toFixed(1).padStart(10)} ${b.twitchAim.toFixed(1).padStart(4)} ${b.reversals.toFixed(1).padStart(7)}   ${ms}`);
  }
  if (res.stuck.length) {
    console.log(`   stuck events (${res.stuck.length}):`);
    for (const s of res.stuck.slice(0, 30)) console.log(`     ${s.name} (id ${s.id}) ${s.t0.toFixed(1)}–${s.t1.toFixed(1)} s at (${f1(s.x)}, ${f1(s.y)}, ${f1(s.z)}) modes ${s.mode}`);
  } else console.log('   stuck events: none');
}

/** washes by the washer's kit (share of all washes credited to a runner) + special ready / start per bot */
function kitLine(res: RunResult): string {
  const tot = Object.values(res.washKit).reduce((a, v) => a + v, 0) || 1;
  const kits = [...new Set(res.kits)];
  return 'kits: ' + kits.map((k) => {
    const ids = res.kits.map((x, i) => (x === k ? i : -1)).filter((i) => i >= 0);
    const rd = ids.reduce((a, i) => a + res.ready[i], 0), st = ids.reduce((a, i) => a + res.started[i], 0);
    const causes = ['dye', 'sub', 'special'].map((c) => res.washKitCause[`${k}:${c}`] ?? 0);
    return `${k} washes ${res.washKit[k] ?? 0} (${pct((res.washKit[k] ?? 0) / tot)}; dye ${causes[0]} sub ${causes[1]} special ${causes[2]}) special ready ${rd} used ${st} (${ids.length} bots)`;
  }).join(' · ') + ` · glint dodges ${res.dodges}`;
}

async function main(): Promise<number> {
  if (WASH && TUNE) return tuneMain();                    // CHANGED(WASHOUT): the W1 limit tuning (every map, both modes)
  let def: MapDef, geo: MapGeometry, R: Awaited<ReturnType<typeof loadRapier>>, nav: NavGraph;
  try {
    def = mapById(MAP);
    R = await loadRapier();
    geo = await loadMapGeometry(def);
    const navPhysics = new PhysicsWorld(R, geo);
    nav = buildNav(geo, navPhysics, def);
    console.log(`${WASH ? `WASHOUT (limit ${LIMIT_ARG !== undefined ? LIMIT_ARG || 'none' : `${washoutLimitFor(def, MODE)}, data/maps.json ${MAP}.washout`}) · ` : ''}${FFA ? 'FREE-FOR-ALL · ' : ''}map ${MAP} · nav ${nav.nodes} nodes / ${nav.edgeTo.length} edges (built in ${nav.stats.buildMs.toFixed(0)} ms) · skill ${SKILL} · ${SEEDS.length ? `seeds ${SEEDS.join(',')}` : `seed ${SEED}`} · ${SECONDS} s`);
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
  if (FFA) return ffaMain(a, b, c);
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
    check('match simulates in < 20 s wall time', worst < 20000, `A ${(a.wallMs / 1000).toFixed(2)} s, B ${(b.wallMs / 1000).toFixed(2)} s, C ${(c.wallMs / 1000).toFixed(2)} s (process CPU ${(a.cpuMs / 1000).toFixed(2)} s / ${(b.cpuMs / 1000).toFixed(2)} s / ${(c.cpuMs / 1000).toFixed(2)} s)`);
    // seed C must pass the play gates too (not only the gate seed)
    check('seed+1 also: coverage > 15 % each, neutral < 55 %, ≥ 6 washes, no stuck',
      c.coverage.sun > 0.15 && c.coverage.gulf > 0.15 && c.coverage.neutral < 0.55 && c.washes >= 6 && c.stuck.length === 0,
      `SUN ${pct(c.coverage.sun)} GULF ${pct(c.coverage.gulf)} neutral ${pct(c.coverage.neutral)} washes ${c.washes} stuck ${c.stuck.length}`);
  } else {
    check('match simulates in < 20 s wall time', a.wallMs < 20000, `${(a.wallMs / 1000).toFixed(2)} s (process CPU ${(a.cpuMs / 1000).toFixed(2)} s)`);
  }
  const failed = checks.filter((x) => !x.pass);
  console.log('-'.repeat(100));
  console.log(failed.length ? `G8 bots: FAIL (${failed.length} of ${checks.length} checks)` : `G8 bots: PASS (${checks.length} checks)`);
  return failed.length ? 1 : 0;
}

/** CHANGED(CORE): the FFA play gates of one run (CONTRACT_FFA §F4): [name, pass, detail] */
function ffaGates(r: RunResult): Array<[string, boolean, string]> {
  const n = r.perBot.length;
  const mb = r.perBot.reduce((x, b) => x + b.twitchBody, 0) / n, ma = r.perBot.reduce((x, b) => x + b.twitchAim, 0) / n;
  const tb = r.perBot.reduce((x, b) => Math.max(x, b.twitchBody), 0), ta = r.perBot.reduce((x, b) => Math.max(x, b.twitchAim), 0);
  const mv = r.perBot.reduce((x, b) => Math.min(x, b.moving), 1);
  const low = r.crews.filter((c) => !(r.shares[c] >= FFA_MIN_CREW));
  const minC = r.crews.reduce((m, c) => Math.min(m, r.shares[c]), 1);
  const so = r.perBot.reduce((m, b) => (b.standoff > m.s ? { s: b.standoff, name: b.name } : m), { s: 0, name: '' });
  return [
    [`every crew ≥ ${FFA_MIN_CREW * 100} %`, r.crews.length === 8 && low.length === 0,
      `${r.crews.length} crews, lowest ${pct(minC)}${low.length ? ` (under: ${low.map((c) => `${r.crewNames[c]} ${pct(r.shares[c])}`).join(', ')})` : ''}`],
    [`neutral < ${FFA_MAX_NEUTRAL * 100} %`, r.shares[0] < FFA_MAX_NEUTRAL, `neutral ${pct(r.shares[0])}`],
    [`≥ ${FFA_MIN_WASHES} washes`, r.washes >= FFA_MIN_WASHES, `${r.washes} (sea ${r.seaWashes})`],
    ['no stuck', r.stuck.length === 0, r.stuck.length ? r.stuck.slice(0, 3).map((s) => `${s.name} ${s.t0.toFixed(0)}-${s.t1.toFixed(0)} s @ (${f1(s.x)},${f1(s.y)},${f1(s.z)}) ${s.mode.slice(0, 24)}`).join('; ') : '0'],
    ['no jitter / moving ≥ 60 %', mb <= 0.75 && ma <= 0.75 && tb <= 2.5 && ta <= 2.5 && mv >= 0.6,
      `shakes body ${mb.toFixed(2)} (worst ${tb.toFixed(2)}) aim ${ma.toFixed(2)} (worst ${ta.toFixed(2)}) · least moving ${(mv * 100).toFixed(0)} %`],
    [`no fight standoff > ${FFA_MAX_STANDOFF_S} s`, so.s <= FFA_MAX_STANDOFF_S, `longest ${so.s.toFixed(1)} s${so.name ? ` (${so.name})` : ''}`],
    // CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S4 / §S6): FFA TURF has spawn protection; the bots leave protected runners
    // alone; the spawn sites
    ...ffaSpawnGates(r),
    [`< ${FFA_WALL_MS / 1000} s wall`, r.wallMs < FFA_WALL_MS, `${(r.wallMs / 1000).toFixed(2)} s (process CPU ${(r.cpuMs / 1000).toFixed(2)} s)`],
  ];
}

/** CHANGED(SPAWNS): the FFA spawn gates of one run (both rules): no bot targets a protected runner, the protection
 *  invariants, the S6 spawn-site gates */
function ffaSpawnGates(r: RunResult): Array<[string, boolean, string]> {
  return [
    ['no bot targets a spawn-protected runner', r.protTargetTicks === 0, `${r.protTargetTicks} bot-ticks`],
    ['spawn protection: never while dead, gone after dealing damage, never ended without an action',
      r.protDead === 0 && r.protAfterHit === 0 && r.protEndNoAction === 0, `dead+protected ${r.protDead} · protected after a hit dealt ${r.protAfterHit} · ended with no action ${r.protEndNoAction} (runner-ticks)`],
    ...(r.spawn ? spawnGates([{ label: '', s: r.spawn }], false).map(([n, p, d]): [string, boolean, string] => [`spawn sites: ${n}`, p, d]) : []),
  ];
}

/** CHANGED(CORE): FFA gates for the default A / B (repeat) / C (seed + 1) runs */
function ffaMain(a: RunResult, b: RunResult | null, c: RunResult | null): number {
  for (const [name, pass, detail] of ffaGates(a)) check(`FFA ${name}`, pass, detail);
  console.log(`INFO  slick entries ${a.slicks} · refills from < 20 % ${a.refills} (teams gates ≥ 20 / ≥ 4; not FFA gates)`);
  if (b && c) {
    check('same seed → identical hash', a.hash === b.hash, `${a.hash} vs ${b.hash}`);
    check('different seed → different hash', a.hash !== c.hash, `${a.hash} vs ${c.hash}`);
    const bad = ffaGates(c).filter((g) => !g[1]);
    check('seed+1 also passes the FFA play gates', bad.length === 0, bad.length ? bad.map((g) => `${g[0]}: ${g[2]}`).join(' · ') : ffaGates(c).map((g) => g[2]).slice(0, 3).join(' · '));
    check(`B and C < ${FFA_WALL_MS / 1000} s wall`, b.wallMs < FFA_WALL_MS && c.wallMs < FFA_WALL_MS, `B ${(b.wallMs / 1000).toFixed(2)} s, C ${(c.wallMs / 1000).toFixed(2)} s (process CPU ${(b.cpuMs / 1000).toFixed(2)} s / ${(c.cpuMs / 1000).toFixed(2)} s)`);
  }
  const failed = checks.filter((x) => !x.pass);
  console.log('-'.repeat(100));
  console.log(failed.length ? `FFA bots (${MAP}): FAIL (${failed.length} of ${checks.length} checks)` : `FFA bots (${MAP}): PASS (${checks.length} checks)`);
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
    ['< 20 s wall', r.wallMs < 20000, `${(r.wallMs / 1000).toFixed(2)} s (process CPU ${(r.cpuMs / 1000).toFixed(2)} s)`],
  ];
}

/** CHANGED(BOTFIX): per-kit washes (share of all washes credited to a runner) and special ready / use, summed over the
 *  seeds, plus the per-match averages. With --lineup mixed it prints the balance target (information, not a gate):
 *  no kit > 40 % of washes, every kit ≥ 10 %, every kit's special used ≥ 1× per match on average. */
function kitAggregate(rs: RunResult[]): void {
  const kits = [...new Set(rs.flatMap((r) => r.kits))];
  const wk: Record<string, number> = {}, rd: Record<string, number> = {}, st: Record<string, number> = {}, nb: Record<string, number> = {};
  let tot = 0;
  for (const r of rs) {
    for (const k of kits) {
      wk[k] = (wk[k] ?? 0) + (r.washKit[k] ?? 0);
      tot += r.washKit[k] ?? 0;
      r.kits.forEach((x, i) => { if (x === k) { rd[k] = (rd[k] ?? 0) + r.ready[i]; st[k] = (st[k] ?? 0) + r.started[i]; } });
    }
  }
  for (const k of kits) nb[k] = rs[0].kits.filter((x) => x === k).length;
  const n = rs.length, share = (k: string): number => (wk[k] ?? 0) / (tot || 1);
  console.log(`\n── kits over ${n} seed(s) (${tot} washes credited to a runner; dodges ${rs.reduce((a, r) => a + r.dodges, 0)}):`);
  for (const k of kits) {
    console.log(`   ${k.padEnd(13)} washes ${String(wk[k] ?? 0).padStart(4)} (${pct(share(k)).padStart(7)}) · special ready ${rd[k] ?? 0} (${((rd[k] ?? 0) / n).toFixed(2)}/match) · used ${st[k] ?? 0} (${((st[k] ?? 0) / n).toFixed(2)}/match, ${((st[k] ?? 0) / n / Math.max(1, nb[k])).toFixed(2)} per bot) · ${nb[k]} bot(s)`);
  }
  if (LINEUP === 'mixed') {
    const over = kits.filter((k) => share(k) > 0.4), under = kits.filter((k) => share(k) < 0.1), idle = kits.filter((k) => (st[k] ?? 0) / n < 1);
    const ok = !over.length && !under.length && !idle.length;
    console.log(`   balance target (info, not a gate): ${ok ? 'MET' : 'MISSED'} — > 40 %: ${over.join(', ') || 'none'} · < 10 %: ${under.join(', ') || 'none'} · special used < 1/match: ${idle.join(', ') || 'none'}`);
  }
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
  kitAggregate(runs.map((x) => x.r));
  console.log('\n' + '-'.repeat(100));
  if (SECONDS !== 180) console.log(`NOTE: ${SECONDS} s matches — the gates below are printed for information; G8 needs the full 180 s.`);
  const gates = WASH ? washoutGates : FFA ? ffaGates : playGates;   // CHANGED(CORE): the FFA gate set in FFA mode; CHANGED(WASHOUT)
  // CHANGED(SPAWNS): the unseen-respawn rate — CONTRACT_FFA_SPAWNS §S6 gates it in probe_match (scripted runners); logged here
  if (FFA) console.log(`INFO  FFA respawns unseen by every foe (gated ≥ 90 % in probe_match --mode ffa; logged here): ${runs.map(({ seed, r }) => `s${seed} ${r.spawn ? unseenText(r.spawn) : '-'}`).join(' · ')}`);
  if (FFA || WASH) console.log(`INFO  slick entries ${runs.map(({ seed, r }) => `s${seed} ${r.slicks}`).join(' · ')} · refills from < 20 % ${runs.map(({ seed, r }) => `s${seed} ${r.refills}`).join(' · ')}`);
  if (WASH) {
    console.log(`INFO  WASHOUT endings ${runs.map(({ seed, r }) => `s${seed} ${r.endedBy} at ${r.playedS.toFixed(0)} s`).join(' · ')} · washes by the victim's own pad ${runs.map(({ seed, r }) => `s${seed} ${r.padWashes}/${r.washes}`).join(' · ')} · within 4 s of its respawn ${runs.map(({ seed, r }) => `s${seed} ${r.freshWashes}/${r.washes}`).join(' · ')}`);
    const n = runs.length, mv = (f: (b: RunResult['perBot'][number]) => number): string => (runs.reduce((a, { r }) => a + r.perBot.reduce((x, b) => x + f(b), 0) / r.perBot.length, 0) / n).toFixed(2);
    console.log(`INFO  motion (not a WASHOUT gate): shakes/min body ${mv((b) => b.twitchBody)} · aim ${mv((b) => b.twitchAim)} · moving ${(Number(mv((b) => b.moving)) * 100).toFixed(0)} % of live time`);
  }
  const names = gates(runs[0].r).map((g) => g[0]);
  for (let k = 0; k < names.length; k++) {
    const per = runs.map(({ seed, r }) => ({ seed, g: gates(r)[k] }));
    const bad = per.filter((p) => !p.g[1]);
    check(`${names[k]} on every seed (${SEEDS.length})`, bad.length === 0,
      per.map((p) => `s${p.seed}: ${p.g[2]}${p.g[1] ? '' : ' ✗'}`).join(' · '));
  }
  check('same seed → identical hash', again.hash === runs[0].r.hash, `${runs[0].r.hash} vs ${again.hash}`);
  const distinct = new Set(runs.map((x) => x.r.hash)).size;
  check('different seeds → different hashes', distinct === runs.length, `${distinct} distinct of ${runs.length}`);
  const failed = checks.filter((x) => !x.pass);
  console.log('-'.repeat(100));
  const tag = `${WASH ? `WASHOUT ${FFA ? 'FFA' : 'TEAMS'} ` : FFA ? 'FFA ' : 'G8 '}bots`;
  console.log(failed.length ? `${tag} (${MAP}, seeds ${SEEDS.join(',')}): FAIL (${failed.length} of ${checks.length} checks)` : `${tag} (${MAP}, seeds ${SEEDS.join(',')}): PASS (${checks.length} checks)`);
  return failed.length ? 1 : 0;
}

/** CHANGED(WASHOUT): the W3 play gates of one WASHOUT run (CONTRACT_WASHOUT §W3): [name, pass, detail] */
function washoutGates(r: RunResult): Array<[string, boolean, string]> {
  const so = r.perBot.reduce((m, b) => (b.standoff > m.s ? { s: b.standoff, name: b.name } : m), { s: 0, name: '' });
  const credited = r.crews.reduce((a, c) => a + r.scores[c], 0);
  const out: Array<[string, boolean, string]> = [
    ['no stuck', r.stuck.length === 0, r.stuck.length ? r.stuck.slice(0, 3).map((s) => `${s.name} ${s.t0.toFixed(0)}-${s.t1.toFixed(0)} s @ (${f1(s.x)},${f1(s.y)},${f1(s.z)}) ${s.mode.slice(0, 24)}`).join('; ') : '0'],
    [`no fight standoff > ${FFA_MAX_STANDOFF_S} s`, so.s <= FFA_MAX_STANDOFF_S, `longest ${so.s.toFixed(1)} s${so.name ? ` (${so.name})` : ''}`],
  ];
  if (r.mode === 'ffa') {
    const scorers = r.crews.filter((c) => r.scores[c] >= 1);
    out.push([`≥ ${WO_FFA_MIN_SCORERS} of 8 crews score ≥ 1`, r.crews.length === 8 && scorers.length >= WO_FFA_MIN_SCORERS,
      `${scorers.length} of ${r.crews.length} score (${r.crews.map((c) => r.scores[c]).sort((a, b) => b - a).join('/')})`]);
    out.push([`≥ ${WO_FFA_MIN_WASHES} credited washes`, credited >= WO_FFA_MIN_WASHES, `${credited} credited of ${r.washes} (sea ${r.seaWashes})`]);
  } else {
    out.push([`both teams score ≥ ${WO_TEAM_MIN_SCORE}`, r.scores[1] >= WO_TEAM_MIN_SCORE && r.scores[2] >= WO_TEAM_MIN_SCORE, `SUN ${r.scores[1]} GULF ${r.scores[2]}`]);
  }
  out.push(['no bot targets a spawn-protected runner', r.protTargetTicks === 0, `${r.protTargetTicks} bot-ticks`]);
  out.push(['score events = credited washes (Σ scores)', r.scoreEvents === credited && credited > 0, `${r.scoreEvents} events, Σ ${credited}`]);
  // CHANGED(WASHOUT) follow-up (skeptic review 2026-09-30): the event order and the spawn-protection invariants
  out.push(["each 'score' right after its 'washed'", r.scoreOrderBad === 0, `${r.scoreOrderBad} order faults`]);
  out.push(['spawn protection: never while dead, gone after dealing damage, never ended without an action',
    r.protDead === 0 && r.protAfterHit === 0 && r.protEndNoAction === 0, `dead+protected ${r.protDead} · protected after a hit dealt ${r.protAfterHit} · ended with no action ${r.protEndNoAction} (runner-ticks)`]);
  // CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S6): WASHOUT FFA — the spawn-site gates too
  if (r.spawn) for (const g of spawnGates([{ label: '', s: r.spawn }], false)) out.push([`spawn sites: ${g[0]}`, g[1], g[2]]);
  out.push([`< ${WO_WALL_MS / 1000} s wall`, r.wallMs < WO_WALL_MS, `${(r.wallMs / 1000).toFixed(2)} s (process CPU ${(r.cpuMs / 1000).toFixed(2)} s)`]);
  return out;
}

/** CHANGED(WASHOUT) (CONTRACT_WASHOUT §W1): bot-only WASHOUT matches with no limit, every map (--maps), TEAMS and FFA
 *  (--modes), seeds --seeds (default 1..8): the leader's score at the horn → its distribution and the share of matches whose
 *  leader reaches the configured limit (it would have ended the match there: the sim does not read the limit before it is
 *  reached, so a limited match is this match cut at that point). CHANGED(WASHOUT) follow-up: the limits are PER MAP
 *  (data/maps.json <map>.washout, washoutLimitFor) — the distribution, the band and the gate are per map and mode (35–65 %
 *  of that map's matches reach its limit); all maps together are printed for information. */
async function tuneMain(): Promise<number> {
  const maps = arg('--maps', 'pier18,lockwell,cinder').split(',').map((x) => x.trim()).filter(Boolean);
  const modes = arg('--modes', 'teams,ffa').split(',').map((x) => parseMatchMode(x.trim())).filter((x, i, a) => a.indexOf(x) === i);
  const R = await loadRapier();
  const lead: Record<string, Record<MatchMode, number[]>> = {};
  const limitOf: Record<string, Record<MatchMode, number>> = {};
  const t0 = performance.now();
  console.log(`WASHOUT limit tuning (per map) · maps ${maps.join(',')} · seeds ${SEEDS.join(',')} · ${modes.map((m) => m.toUpperCase()).join(' + ')} · lineup ${LINEUP} · skill ${SKILL} · ${SECONDS} s · no limit`);
  for (const m of maps) {
    const def = mapById(m);
    const geo = await loadMapGeometry(def);
    const nav = buildNav(geo, new PhysicsWorld(R, geo), def);
    lead[m] = { teams: [], ffa: [] };
    limitOf[m] = { teams: washoutLimitFor(def, 'teams'), ffa: washoutLimitFor(def, 'ffa') };
    for (const mode of modes) {
      for (const sd of SEEDS) {
        const r = await runMatch(def, geo, R, nav, sd, SKILL, SECONDS, -1, { mode, rule: 'washout', limit: 0 });
        const sc = r.crews.map((c) => r.scores[c]);
        const top = Math.max(...sc);
        lead[m][mode].push(top);
        console.log(`  ${m.padEnd(8)} ${mode.padEnd(5)} seed ${sd}: leader ${String(top).padStart(3)} · scores ${sc.join('/')} · washes ${r.washes} (credited ${sc.reduce((a, v) => a + v, 0)}) · stuck ${r.stuck.length} · wall ${(r.wallMs / 1000).toFixed(1)} s · faults order ${r.scoreOrderBad} protection ${r.protDead}/${r.protAfterHit}/${r.protEndNoAction}`);
      }
    }
  }
  /** one distribution: its summary lines, the in-band limits, the reach of limit L and the pick — the in-band limit whose
   *  reach is closest to 50 %, a tie going to the one nearest the median leader score (then the lower) */
  const describe = (vals: number[], indent: string, perMap = true): { reach: (L: number) => number; band: number[]; pick: number | null } => {
    const v = vals.slice().sort((a, b) => a - b);
    const q = (p: number): number => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
    const reach = (L: number): number => v.filter((x) => x >= L).length / (v.length || 1);
    const hist = new Map<number, number>();
    for (const x of v) hist.set(x, (hist.get(x) ?? 0) + 1);
    const band: number[] = [];
    for (let L = v[0] ?? 0; L <= (v[v.length - 1] ?? 0) + 1; L++) { const f = reach(L); if (f >= WO_TUNE_LO && f <= WO_TUNE_HI) band.push(L); }
    const med = q(0.5);
    const pick = band.length
      ? band.slice().sort((a, b) => (Math.abs(reach(a) - 0.5) - Math.abs(reach(b) - 0.5)) || (Math.abs(a - med) - Math.abs(b - med)) || (a - b))[0]
      : null;
    console.log(`${indent}leader at the horn over ${v.length} matches: min ${v[0]} · p25 ${q(0.25)} · median ${med} · p75 ${q(0.75)} · max ${v[v.length - 1]} · mean ${(v.reduce((a, x) => a + x, 0) / (v.length || 1)).toFixed(1)}`);
    console.log(`${indent}histogram ${[...hist.entries()].map(([k, n]) => `${k}:${n}`).join(' ')}`);
    console.log(`${indent}limits inside ${WO_TUNE_LO * 100}–${WO_TUNE_HI * 100} %: ${band.map((L) => `${L} (${pct(reach(L))})`).join(' · ') || 'none'}${perMap ? ` · pick ${pick ?? 'none'} (reach closest to 50 %, tie → nearest the median)` : ' (information only: the limits are per map)'}`);
    return { reach, band, pick };
  };
  console.log('-'.repeat(100));
  for (const m of maps) {
    for (const mode of modes) {
      const v = lead[m][mode], lim = limitOf[m][mode];
      console.log(`${m} ${mode === 'ffa' ? 'FFA' : 'TEAMS'} (limit ${lim}, data/maps.json ${m}.washout):`);
      const { reach, pick } = describe(v, '      ');
      if (pick !== null && pick !== lim) console.log(`      NOTE  the tuner picks ${pick} for ${m} ${mode === 'ffa' ? 'ffaLimit' : 'teamLimit'}; data/maps.json has ${lim}`);
      check(`${m} ${mode === 'ffa' ? 'FFA' : 'TEAMS'} limit ${lim} (data/maps.json ${m}.washout): the leader reaches it in ${WO_TUNE_LO * 100}–${WO_TUNE_HI * 100} % of this map's matches`,
        reach(lim) >= WO_TUNE_LO && reach(lim) <= WO_TUNE_HI, `${pct(reach(lim))} (${v.filter((x) => x >= lim).length} of ${v.length})`);
    }
  }
  if (maps.length > 1) {
    console.log('-'.repeat(100));
    for (const mode of modes) {
      // information: every map together, each match judged against its own map's limit
      const all = maps.flatMap((m) => lead[m][mode]);
      const hit = maps.reduce((a, m) => a + lead[m][mode].filter((x) => x >= limitOf[m][mode]).length, 0);
      console.log(`INFO  ${mode === 'ffa' ? 'FFA' : 'TEAMS'} all maps: the leader reaches its map's limit in ${pct(hit / (all.length || 1))} (${hit} of ${all.length}; ${maps.map((m) => `${m} ${limitOf[m][mode]}: ${lead[m][mode].filter((x) => x >= limitOf[m][mode]).length}/${lead[m][mode].length}`).join(' · ')})`);
      describe(all, '      ', false);
    }
  }
  const failed = checks.filter((x) => !x.pass);
  console.log('-'.repeat(100));
  console.log(`WASHOUT tuning: ${failed.length ? `FAIL (${failed.length} of ${checks.length} checks)` : `PASS (${checks.length} checks)`} · ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  return failed.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.log('SETUP FAILED:', (e as Error).stack ?? e); process.exit(2); });
