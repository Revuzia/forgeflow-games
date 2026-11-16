// temp (controls r2): the RIFT low-road lane end next to team 1's base, where Wick blobs jam (minion_flow frozen class)
import { buildContent, defaultOptions } from '../tools/build_content.ts';
import { createSim, worldOf } from '../src/sim/sim.ts';
import { pickLoadout } from '../src/sim/bots/index.ts';
const rc = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true })).catalog!;
const mode = rc.modes.find((m) => m.id === 'rift')!, q = rc.queues.find((x) => x.mode === 'rift')!;
const fs = rc.fighters.map((f) => f.id).sort();
const seats = Array.from({ length: 10 }, (_, i) => { const fighter = fs[(i * 3) % fs.length]; return { player: i, team: Math.floor(i / 5), name: `p${i}`, fighter, skin: rc.skins.find((s) => s.fighter === fighter)!.id, controller: 'human', loadout: pickLoadout(rc, fighter, mode.rules.itemPool ?? '', undefined as never), colorIndex: i }; });
const sim = createSim(rc, { matchId: 'j', seed: 5, queue: q.id, mode: 'rift', map: mode.map, seats, catalogVersion: rc.version, practice: { waves: false } } as never, { pregameSeconds: 0 });
sim.step();
const w = worldOf(sim), n = w.nav;
const [x0, x1, y0, y1] = process.argv.slice(2).map(Number);
for (const e of w.entities) if (e.kind === 'structure' && e.x > x0 - 4 && e.x < x1 + 4 && e.y > y0 - 4 && e.y < y1 + 4) console.log(e.def, e.team, e.x, e.y, e.radius, e.navBlockR);
const lane = w.mapDef.lanes.find((l) => l.id === 'road_low')!;
console.log('lane end pts', JSON.stringify(lane.path.slice(-4)), JSON.stringify(lane.path.slice(0, 4)));
for (let y = y1; y >= y0; y -= 0.5) { let row = ''; for (let x = x0; x <= x1; x += 0.5) row += n.walkable(x, y) ? '.' : '#'; console.log(y.toFixed(1).padStart(5), row); }
