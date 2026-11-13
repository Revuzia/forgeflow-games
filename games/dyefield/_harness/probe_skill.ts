// DYEFIELD — bot-tier gate (owner decision 6, STATS INTEGRATION stage): the BREEZE / SWELL / STORM picker must reach the bots.
//
//   node _harness/probe_skill.ts            # the gate: exit 0 pass · 1 a check failed · 2 setup failure
//   node _harness/probe_skill.ts --quick    # plumbing only (no bot matches)
//
// The live bug it guards: game.ts built `new BotDirector(world, nav, seed)` with no skill (it defaults to SWELL), so every
// match played SWELL bots whatever the menu / ?bots= / the online room said. The fix passes botSkills(roster) (a tier per
// runner id) at both call sites (the constructor and restart()). Sections:
//   1 plumbing — botSkills(roster) is indexed by runner id; a director built with it has brains on the roster's tiers
//                (BotDirector.tiers(): the tier each brain plays); the no-argument director is all SWELL (the old, buggy
//                game.ts call — kept as the proof that the default was SWELL); every brain's profile IS BOT_SKILLS[tier]
//   2 a uniform array = the scalar — a director built with ['swell' × 8] steps a match to the SAME world.hash() as the
//                scalar 'swell' one (the array path changes nothing but the tier lookup; probe / probe:washout pass the
//                skill explicitly, so their hashes cannot move)
//   3 STORM out-performs BREEZE — fixed-seed matches on all three maps with ONE crew on STORM and the other on BREEZE (both
//                sides tried, so a side bias cancels): TEAMS WASHOUT (credited washes per crew) and TEAMS TURF (turf share)
//
// The human slot (id 0) is a bot too (roster[0].bot = true), as in probe_bots.ts / probe_stats.ts.

import { loadRapier, PhysicsWorld } from '../runtime/src/core/physics.ts';
import { mapById, type MapDef } from '../runtime/src/core/data.ts';
import { loadMapGeometry, type MapGeometry } from '../runtime/src/core/mapgeo.ts';
import { buildAtlas } from '../runtime/src/core/paint/atlas.ts';
import { Painter } from '../runtime/src/core/paint/painter.ts';
import { MatchWorld } from '../runtime/src/core/match/world.ts';
import { botSkills, defaultRoster, type BotSkill, type RosterEntry } from '../runtime/src/core/match/roster.ts';
import { buildNav, type NavGraph } from '../runtime/src/core/bots/nav.ts';
import { BOT_SKILLS, BotDirector } from '../runtime/src/core/bots/director.ts';
import { emptyIntent, type MatchRule, type PlayerIntent } from '../runtime/src/core/types.ts';
import { TICK } from '../runtime/src/core/config.ts';

const argv = process.argv.slice(2);
const QUICK = argv.includes('--quick');
const MAPS = ['pier18', 'lockwell', 'cinder'];
const SEEDS = [1, 2];
const KITS = ['sheet-drum', 'needle-glint', 'pop-well', 'mist-rasp'];

interface Check { name: string; pass: boolean; detail: string }
const checks: Check[] = [];
function check(name: string, pass: boolean, detail: string): void {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
}

type Rapier = Awaited<ReturnType<typeof loadRapier>>;
interface Arena { def: MapDef; geo: MapGeometry; nav: NavGraph }
let RAPIER: Rapier | null = null;
const ARENAS = new Map<string, Arena>();
async function arena(map: string): Promise<Arena> {
  if (!RAPIER) RAPIER = await loadRapier();
  const hit = ARENAS.get(map);
  if (hit) return hit;
  const def = mapById(map);
  const geo = await loadMapGeometry(def);
  const nav = buildNav(geo, new PhysicsWorld(RAPIER, geo), def);
  const a = { def, geo, nav };
  ARENAS.set(map, a);
  return a;
}

interface Built { world: MatchWorld; roster: RosterEntry[]; A: Arena }
async function build(map: string, rule: MatchRule, seed: number, tiers: BotSkill[] | BotSkill, humanSlot = false): Promise<Built> {
  const A = await arena(map);
  const physics = new PhysicsWorld(RAPIER!, A.geo);
  const sc = A.def.scoring ?? { wallWeight: 0.35, floorMinNy: 0.45 };
  const painter = new Painter(buildAtlas(A.geo.paint, A.geo.atlasSize, { wallWeight: sc.wallWeight, floorMinNy: sc.floorMinNy }));
  const roster = defaultRoster({ humanKit: 'mist-rasp', seed, skill: Array.isArray(tiers) ? 'swell' : tiers, botKits: KITS });
  if (Array.isArray(tiers)) for (const r of roster) r.skill = tiers[r.id] ?? 'swell';
  if (!humanSlot) roster[0].bot = true;
  const world = new MatchWorld({ def: A.def, geo: A.geo, physics, painter, roster, seed, ...(rule === 'washout' ? { rule: 'washout' as const } : {}) });
  return { world, roster, A };
}

function step(world: MatchWorld, director: BotDirector, roster: RosterEntry[], seconds: number | null): void {
  const intents: PlayerIntent[] = roster.map(() => emptyIntent());
  const ev: never[] = [];
  const limit = seconds === null ? (world.durationS + world.countdownS + 10) / TICK : Math.round((world.countdownS + seconds) / TICK);
  for (let i = 0; i < limit && world.phase !== 'ended'; i++) {
    director.think(intents);
    world.step(intents);
    if (i % 5 === 0) world.drainEvents(ev as never[]);
  }
  world.drainEvents(ev as never[]);
}

const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

async function plumbing(): Promise<void> {
  const mixed: BotSkill[] = ['storm', 'storm', 'storm', 'storm', 'breeze', 'breeze', 'breeze', 'breeze'];
  // 1a: botSkills is indexed by runner id and carries each entry's tier
  const b = await build('pier18', 'turf', 1, mixed);
  const sk = botSkills(b.roster);
  check('1a botSkills(roster) is indexed by runner id and carries each tier', eq(sk, mixed), JSON.stringify(sk));
  // 1b: a director built with it plays the roster's tiers (id 0 is a bot here: every brain exists)
  const d = new BotDirector(b.world, b.A.nav, 1, sk);
  check('1b the director\'s brains play the roster\'s tiers (STORM crew 1, BREEZE crew 2)', eq(d.tiers(), mixed), JSON.stringify(d.tiers()));
  // 1c: every brain's profile object is BOT_SKILLS[tier]
  const profs = (d as unknown as { brains: Array<{ sk: unknown } | null> }).brains;
  const same = profs.every((br, i) => br !== null && br.sk === BOT_SKILLS[mixed[i]]);
  check('1c every brain\'s skill profile IS BOT_SKILLS[its tier] (reaction / aim / engage tables differ per tier)', same,
    `breeze react ${BOT_SKILLS.breeze.reactMin}-${BOT_SKILLS.breeze.reactMax} s · swell ${BOT_SKILLS.swell.reactMin}-${BOT_SKILLS.swell.reactMax} s · storm ${BOT_SKILLS.storm.reactMin}-${BOT_SKILLS.storm.reactMax} s`);
  check('1c the three tier profiles are distinct objects with ordered reaction times (breeze slower than swell slower than storm)',
    BOT_SKILLS.breeze !== BOT_SKILLS.swell && BOT_SKILLS.swell !== BOT_SKILLS.storm && BOT_SKILLS.breeze.reactMin > BOT_SKILLS.swell.reactMin && BOT_SKILLS.swell.reactMin > BOT_SKILLS.storm.reactMin,
    `reactMin ${BOT_SKILLS.breeze.reactMin} > ${BOT_SKILLS.swell.reactMin} > ${BOT_SKILLS.storm.reactMin}`);
  // 1d: the OLD game.ts call (no skill argument) was all SWELL — the bug, kept as the baseline
  const old = new BotDirector(b.world, b.A.nav, 1);
  check('1d a director built WITHOUT a skill (the old game.ts call) is all SWELL, whatever the roster says', eq(old.tiers(), Array(8).fill('swell')), JSON.stringify(old.tiers()));
  // 1e: the real offline roster path: one tier for every bot, the human (runner 0, bot false) has no brain
  for (const t of ['breeze', 'swell', 'storm'] as BotSkill[]) {
    const r = defaultRoster({ humanKit: 'mist-rasp', seed: 5, skill: t, botKits: KITS });
    const w = (await build('pier18', 'turf', 5, t, true)).world;
    const dd = new BotDirector(w, b.A.nav, 5, botSkills(r));
    const want = r.map((e) => (e.bot ? t : null));
    check(`1e offline roster @ ${t.toUpperCase()}: the human has no brain, the 7 bots play ${t.toUpperCase()}`, eq(dd.tiers(), want) && want[0] === null && want.slice(1).every((x) => x === t), JSON.stringify(dd.tiers()));
  }
  // 1f: the online room's tier: an all-bot roster built at the room's skill
  const room = defaultRoster({ humanKit: 'mist-rasp', seed: 3, skill: 'storm', botKits: KITS });
  for (const r of room) r.bot = true;
  const wo = (await build('lockwell', 'washout', 3, 'storm')).world;
  const dr = new BotDirector(wo, (await arena('lockwell')).nav, 3, botSkills(room));
  check('1f an online-style all-bot roster at STORM: all eight brains play STORM', eq(dr.tiers(), Array(8).fill('storm')), JSON.stringify(dr.tiers()));
}

async function uniformEqualsScalar(): Promise<void> {
  const secs = 25;
  const hashOf = async (arr: boolean): Promise<string> => {
    const b = await build('pier18', 'turf', 11, 'swell');
    const d = new BotDirector(b.world, b.A.nav, 11, arr ? Array<BotSkill>(8).fill('swell') : 'swell');
    step(b.world, d, b.roster, secs);
    return b.world.hash();
  };
  const [h1, h2, h3] = [await hashOf(false), await hashOf(true), await hashOf(false)];
  check(`2 a uniform ['swell' × 8] director steps ${secs} s of live play to the SAME world.hash() as the scalar 'swell' one (and the scalar is repeatable)`,
    h1 === h2 && h1 === h3, `scalar ${h1} · array ${h2} · scalar again ${h3}`);
}

interface Row { map: string; rule: MatchRule; seed: number; stormCrew: 1 | 2; stormWashes: number; breezeWashes: number; stormShare: number; breezeShare: number; stormScore: number; breezeScore: number; wallS: number }

async function outperform(): Promise<void> {
  const rows: Row[] = [];
  for (const rule of ['washout', 'turf'] as MatchRule[]) for (const map of MAPS) for (const seed of SEEDS) for (const stormCrew of [1, 2] as const) {
    const tiers: BotSkill[] = Array.from({ length: 8 }, (_, i) => ((i < 4 ? 1 : 2) === stormCrew ? 'storm' : 'breeze'));
    const b = await build(map, rule, seed, tiers);
    const d = new BotDirector(b.world, b.A.nav, seed, botSkills(b.roster));
    const t0 = performance.now();
    step(b.world, d, b.roster, null);
    const w = b.world;
    const sum = (crew: number, f: (r: MatchWorld['runners'][number]) => number): number => w.runners.filter((r) => r.team === crew).reduce((a, r) => a + f(r), 0);
    const sc = w.scores();
    const res = w.result;
    const share = (crew: number): number => (res ? (crew === 1 ? res.sun : res.gulf) : 0);
    const bc = stormCrew === 1 ? 2 : 1;
    const row: Row = {
      map, rule, seed, stormCrew, stormWashes: sum(stormCrew, (r) => r.washes), breezeWashes: sum(bc, (r) => r.washes),
      stormShare: share(stormCrew), breezeShare: share(bc), stormScore: sc[stormCrew] ?? 0, breezeScore: sc[bc] ?? 0, wallS: (performance.now() - t0) / 1000,
    };
    rows.push(row);
    console.log(`  ${rule.padEnd(7)} ${map.padEnd(8)} seed ${seed} STORM=crew${stormCrew}: washes STORM ${row.stormWashes} / BREEZE ${row.breezeWashes} · share ${(row.stormShare * 100).toFixed(1)} / ${(row.breezeShare * 100).toFixed(1)} % · scores ${row.stormScore} / ${row.breezeScore} · ${row.wallS.toFixed(1)} s`);
  }
  for (const rule of ['washout', 'turf'] as MatchRule[]) {
    const R = rows.filter((r) => r.rule === rule);
    const sw = R.reduce((a, r) => a + r.stormWashes, 0), bw = R.reduce((a, r) => a + r.breezeWashes, 0);
    const ss = R.reduce((a, r) => a + r.stormShare, 0) / R.length, bs = R.reduce((a, r) => a + r.breezeShare, 0) / R.length;
    const winsW = R.filter((r) => r.stormWashes > r.breezeWashes).length;
    const winsS = R.filter((r) => r.stormShare > r.breezeShare).length;
    const winsScore = R.filter((r) => r.stormScore > r.breezeScore).length;
    if (rule === 'washout') {
      check(`3a TEAMS WASHOUT: STORM crews credit more washes than BREEZE crews over ${R.length} fixed-seed matches (both sides, 3 maps)`, sw > bw * 1.3 && winsW >= Math.ceil(R.length * 0.75),
        `washes STORM ${sw} vs BREEZE ${bw} (x${(sw / Math.max(1, bw)).toFixed(2)}) · STORM out-washed BREEZE in ${winsW}/${R.length} matches · scoreboard won ${winsScore}/${R.length}`);
    } else {
      check(`3b TEAMS TURF: STORM crews hold more turf than BREEZE crews over ${R.length} fixed-seed matches (both sides, 3 maps)`, ss > bs + 0.05 && winsS >= Math.ceil(R.length * 0.75),
        `mean turf share STORM ${(ss * 100).toFixed(1)} % vs BREEZE ${(bs * 100).toFixed(1)} % · STORM ahead in ${winsS}/${R.length} matches · washes STORM ${sw} vs BREEZE ${bw}`);
    }
  }
}

async function main(): Promise<number> {
  await plumbing();
  await uniformEqualsScalar();
  if (!QUICK) await outperform();
  const bad = checks.filter((c) => !c.pass);
  console.log('-'.repeat(100));
  console.log(`probe_skill: ${checks.length - bad.length}/${checks.length} checks pass`);
  console.log(bad.length ? `RESULT: FAIL (${bad.length})` : 'RESULT: OK');
  return bad.length ? 1 : 0;
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
