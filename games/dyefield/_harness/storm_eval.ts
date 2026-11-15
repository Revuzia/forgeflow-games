// DYEFIELD — STORM strength check (owner 2026-10-26 "make STORM tougher"): 4 STORM bots (crew 1) vs 4 SWELL bots (crew 2),
// both kits sets mirrored, TEAMS WASHOUT on all three maps × seeds; prints washes for / against and wins. Also the sides are
// swapped (SWELL crew 1 vs STORM crew 2) so map side never decides it. Not a gate: an A/B number for tuning.
//   node _harness/storm_eval.ts [--seeds 1,2,3] [--maps pier18,lockwell,cinder]
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
const arg = (k: string, d: string): string => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const SEEDS = arg('--seeds', '1,2,3').split(',').map(Number);
const MAPS = arg('--maps', 'pier18,lockwell,cinder').split(',');
const KITS = ['sheet-drum', 'needle-glint', 'pop-well', 'mist-rasp'];

let RAPIER: Awaited<ReturnType<typeof loadRapier>> | null = null;
const ARENAS = new Map<string, { def: MapDef; geo: MapGeometry; nav: NavGraph }>();
async function arena(map: string) {
  if (!RAPIER) RAPIER = await loadRapier();
  const hit = ARENAS.get(map); if (hit) return hit;
  const def = mapById(map); const geo = await loadMapGeometry(def);
  const a = { def, geo, nav: buildNav(geo, new PhysicsWorld(RAPIER, geo), def) };
  ARENAS.set(map, a); return a;
}

async function play(map: string, seed: number, stormCrew: 1 | 2): Promise<{ storm: number; swell: number; win: number }> {
  const A = await arena(map);
  const physics = new PhysicsWorld(RAPIER!, A.geo);
  const sc = A.def.scoring ?? { wallWeight: 0.35, floorMinNy: 0.45 };
  const painter = new Painter(buildAtlas(A.geo.paint, A.geo.atlasSize, { wallWeight: sc.wallWeight, floorMinNy: sc.floorMinNy }));
  // crew 1 = ids 0..3, crew 2 = ids 4..7; both crews get the same four kits
  const roster = defaultRoster({ humanKit: KITS[0], seed, skill: 'swell', botKits: [KITS[1], KITS[2], KITS[3], ...KITS] });
  for (const r of roster) { r.bot = true; r.skill = (r.team === stormCrew ? 'storm' : 'swell') as BotSkill; }
  const world = new MatchWorld({ def: A.def, geo: A.geo, physics, painter, roster, seed, rule: 'washout', scoreLimit: 0 });
  const director = new BotDirector(world, A.nav, seed, botSkills(roster));
  const intents: PlayerIntent[] = roster.map(() => emptyIntent());
  const ev: never[] = [];
  const limit = (world.durationS + world.countdownS + 10) / TICK;
  for (let i = 0; i < limit && world.phase !== 'ended'; i++) { director.think(intents); world.step(intents); if (i % 5 === 0) world.drainEvents(ev); }
  const washes = [0, 0, 0];
  for (const r of world.runners) washes[r.team] += r.washes;
  const storm = washes[stormCrew], swell = washes[3 - stormCrew];
  return { storm, swell, win: storm > swell ? 1 : storm < swell ? -1 : 0 };
}

let S = 0, W = 0, wins = 0, losses = 0, n = 0;
for (const map of MAPS) for (const seed of SEEDS) for (const side of [1, 2] as const) {
  const r = await play(map, seed, side);
  S += r.storm; W += r.swell; n++; if (r.win > 0) wins++; else if (r.win < 0) losses++;
  console.log(`${map.padEnd(9)} seed ${seed} STORM as crew ${side}: STORM washes ${String(r.storm).padStart(3)} · SWELL washes ${String(r.swell).padStart(3)}`);
}
console.log(`TOTAL ${n} matches: STORM ${S} washes vs SWELL ${W} (ratio ${(S / Math.max(1, W)).toFixed(2)}) · STORM wins ${wins}, losses ${losses}, draws ${n - wins - losses}`);
