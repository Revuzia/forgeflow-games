// Reachability + sanity check for campus maps. Usage: node reachcheck.mjs [mapId...]
import { MAPS, toSimMap } from "./runtime/maps.js";
import { buildNavGrid, cellOf } from "./runtime/sim/nav.js";

const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function nearestWalkable(nav, x, z) {
  let [ci, cj] = cellOf(nav, x, z);
  const wk = (i, j) => i >= 0 && j >= 0 && i < nav.w && j < nav.h && nav.grid[j * nav.w + i] === 1;
  if (wk(ci, cj)) return [ci, cj];
  for (let r = 1; r < Math.max(nav.w, nav.h); r++)
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      if (wk(ci + di, cj + dj)) return [ci + di, cj + dj];
    }
  return [ci, cj];
}
function flood(nav, sx, sz) {
  const reached = new Uint8Array(nav.w * nav.h);
  const [si, sj] = nearestWalkable(nav, sx, sz);
  const wk = (i, j) => i >= 0 && j >= 0 && i < nav.w && j < nav.h && nav.grid[j * nav.w + i] === 1;
  const q = [[si, sj]]; reached[sj * nav.w + si] = 1;
  let head = 0;
  while (head < q.length) {
    const [ci, cj] = q[head++];
    for (const [di, dj] of NB) {
      const ni = ci + di, nj = cj + dj;
      if (!wk(ni, nj) || reached[nj * nav.w + ni]) continue;
      if (di && dj && (!wk(ci + di, cj) || !wk(ci, cj + dj))) continue;
      reached[nj * nav.w + ni] = 1; q.push([ni, nj]);
    }
  }
  return { reached, count: q.length };
}

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MAPS);
let fail = 0;
for (const id of ids) {
  const m = MAPS[id]; if (!m) { console.log(`? ${id} not found`); continue; }
  const sim = toSimMap(m);
  const nav = buildNavGrid(sim.bounds, sim.obstacles, 1.0, 0.55);
  const walk = nav.grid.reduce((a, b) => a + b, 0);
  const { reached, count } = flood(nav, sim.spawn.seeker.x, sim.spawn.seeker.z);
  const cellReached = (x, z) => { const [i, j] = cellOf(nav, x, z); return reached[j * nav.w + i] === 1 || (() => { const [ni, nj] = nearestWalkable(nav, x, z); return reached[nj * nav.w + ni] === 1; })(); };
  const hOK = cellReached(sim.spawn.hider.x, sim.spawn.hider.z);
  const spots = m.spots || [];
  const badSpots = spots.filter((s) => !cellReached(s.x, s.z));
  const reachPct = ((count / walk) * 100).toFixed(0);
  // hard: hider spawn reachable + seeker reaches most of the map. Soft: a few
  // auto-spots may be unreachable (the sim filters those at match start).
  const ok = hOK && count > walk * 0.5 && badSpots.length <= Math.ceil(spots.length * 0.25);
  if (!ok) fail++;
  console.log(`${ok ? "OK  " : "FAIL"} ${id}: bounds ${sim.bounds.maxX - sim.bounds.minX}x${sim.bounds.maxZ - sim.bounds.minZ}, rooms ${m.rooms.length}, walls ${m.walls.length}, props ${m.props.length}, lights ${m.lights.length}, spots ${spots.length}`);
  console.log(`     walkable cells ${walk}, seeker-reachable ${count} (${reachPct}%), hider-spawn ${hOK ? "reachable" : "UNREACHABLE"}, bad-spots ${badSpots.length}${badSpots.length ? " " + JSON.stringify(badSpots.slice(0, 4)) : ""}`);
}
console.log(fail ? `\nREACH FAIL (${fail})` : "\nREACH OK");
process.exit(fail ? 1 : 0);
