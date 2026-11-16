// DIAGNOSTIC: ASCII dump of RIFT nav round a box (# blocked, o structure disc, . open)
//   node _harness/_tmp_nav_dump.ts x0 x1 y0 y1 [map]
import { buildContent, defaultOptions } from '../tools/build_content.ts';
import { createSim } from '../src/sim/sim.ts';
import { pickLoadout } from '../src/sim/bots/index.ts';
const rc = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true })).catalog!;
const mid = process.argv[6] ?? 'rift';
const mode = rc.modes.find((m) => m.id === mid)!, q = rc.queues.find((x) => x.mode === mid)!;
const fs = rc.fighters.map((f) => f.id).sort();
const n = mode.teams * mode.perTeam;
const seats = Array.from({ length: n }, (_, i) => ({ player: i, team: Math.floor(i / mode.perTeam), name: 'p' + i, fighter: fs[i % fs.length], skin: rc.skins.find((s) => s.fighter === fs[i % fs.length])!.id, controller: 'human', loadout: pickLoadout(rc, fs[i % fs.length], mode.rules.itemPool ?? '', undefined as never), colorIndex: i }));
const sim = createSim(rc, { matchId: 'x', seed: 1, queue: q.id, mode: mid, map: mode.map, seats, catalogVersion: rc.version } as never, { pregameSeconds: 0 });
sim.step();
const w = sim.world;
const [x0, x1, y0, y1] = process.argv.slice(2, 6).map(Number);
for (let y = y1; y >= y0; y -= 0.5) { let s = ''; for (let x = x0; x <= x1; x += 0.5) s += w.nav.walkable(x, y) ? (w.nav.wallFree(x, y) ? '.' : 'o') : (w.nav.wallFree(x, y) ? 'o' : '#'); console.log(y.toFixed(1).padStart(5), s); }
for (const l of w.mapDef.lanes) console.log(l.id, l.path.map((p) => p.join(',')).join(' '));
