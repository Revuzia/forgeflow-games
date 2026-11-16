// temp (controls r2): the walls-sweep cases the stuck snap tier changed, and the verifier's ervet repro: gain of the
// straight walk, the snap with and without the tier, the planned route length
import { buildContent, defaultOptions } from '../tools/build_content.ts';
import { createSim, worldOf } from '../src/sim/sim.ts';
import { pickLoadout } from '../src/sim/bots/index.ts';
const rc = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true })).catalog!;
function nav(modeId: string) {
  const mode = rc.modes.find((m) => m.id === modeId)!, q = rc.queues.find((x) => x.mode === modeId)!;
  const fs = rc.fighters.map((f) => f.id).sort();
  const seats = Array.from({ length: mode.teams * mode.perTeam }, (_, i) => { const fighter = fs[(i * 3) % fs.length]; return { player: i, team: Math.floor(i / mode.perTeam), name: `p${i}`, fighter, skin: rc.skins.find((s) => s.fighter === fighter)!.id, controller: 'human', loadout: pickLoadout(rc, fighter, mode.rules.itemPool ?? '', undefined as never), colorIndex: i }; });
  const sim = createSim(rc, { matchId: 'j', seed: 5, queue: q.id, mode: modeId, map: mode.map, seats, catalogVersion: rc.version, practice: { waves: false } } as never, { pregameSeconds: 0 });
  sim.step();
  return worldOf(sim).nav;
}
const cases: [string, number, number, number, number, number][] = [
  ['rift', 0.6, 64.01, 50.92, 56.82, 44.87],
  ['bridge', 0.55, 86.92, 90.91, 90.42, 90.99], ['bridge', 0.5, 26.5, 50.92, 27.58, 42.75], ['bridge', 0.62, 124.89, 18.8, 130.38, 13.14],
  ['bridge', 0.55, 80.15, 16.45, 77.24, 15.77], ['bridge', 0.55, 119.29, 16.36, 126.78, 15.37], ['bridge', 0.55, 126.38, 21.63, 124.22, 14.61], ['bridge', 0.55, 124.65, 19.93, 124.56, 14.55],
  ['bridge', 0.5, 125.7, 18.63, 125.19, 14.95],
];
const navs: Record<string, ReturnType<typeof nav>> = {};
for (const [m, r, hx, hy, gx, gy] of cases) {
  const n = (navs[m] ??= nav(m));
  const t = { x: 0, y: 0 }; n.raycast(hx, hy, gx, gy, t);
  const d0 = Math.hypot(hx - gx, hy - gy), dB = Math.hypot(t.x - gx, t.y - gy);
  const o = { x: 0, y: 0 }; n.snapGoal(hx, hy, gx, gy, o, r);
  const path: number[] = []; n.findPath(hx, hy, o.x, o.y, path, r);
  let L = 0, px = hx, py = hy, away = 0; for (let i = 0; i + 1 < path.length; i += 2) { L += Math.hypot(path[i] - px, path[i + 1] - py); px = path[i]; py = path[i + 1]; away = Math.max(away, Math.hypot(px - gx, py - gy) - d0); }
  console.log(m, [hx, hy], '->', [gx, gy], 'd0', d0.toFixed(2), 'gain', (d0 - dB).toFixed(2), 'snap', [o.x.toFixed(2), o.y.toFixed(2)], 'D', Math.hypot(o.x - hx, o.y - hy).toFixed(2), 'route', L.toFixed(2), 'ratio', (L / Math.max(0.01, Math.hypot(o.x - hx, o.y - hy))).toFixed(2), 'awayVtx', away.toFixed(2), 'endToClick', Math.hypot(o.x - gx, o.y - gy).toFixed(2));
}
