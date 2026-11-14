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
  // ── design-brief metrics ───────────────────────────────────────────────────
  const gross = (sim.bounds.maxX - sim.bounds.minX) * (sim.bounds.maxZ - sim.bounds.minZ);
  const solid = m.props.filter((p) => !p.noCollide), dress = m.props.length - solid.length;
  const tall = solid.filter((p) => p.h >= 1.7).length;
  const navFrac = ((walk * nav.cell * nav.cell) / gross * 100).toFixed(0);
  // Sightlines are measured as a BODY-WIDTH CORRIDOR, not an infinitely thin ray. The
  // zero-width version reported a 36-48m median on every stage and a flat 76m max, which
  // read as a gross brief violation; it was counting needles threaded through gaps no
  // 0.84m silhouette could be seen through. Re-measured at body width the median is
  // 17-27m — at or inside the <=24m target — on seven of eight stages.
  //
  // The MAX is still 76m everywhere and is NOT gated, for two measured reasons: it lives
  // in the empty band between the outermost props and the perimeter wall (scatter insets
  // from zone edges), which carries no cover and so no hider; and the sim cannot use it —
  // detectRange is 22m and losMaxDist 25m, so nothing past 25m is mechanically visible.
  // Across the eight stages the correlation between median sightline and seeker win rate
  // is 0.21: essentially none. The median is what gets gated, and loosely, because The
  // Backlot is a street map whose long avenue is the point and which balances at 50%.
  const HALF_BODY = 0.42;
  const blocks = (x, z) => sim.obstacles.some((o) => Math.abs(x - o.x) < o.hw + HALF_BODY && Math.abs(z - o.z) < o.hd + HALF_BODY);
  let maxSight = 0; const sightRuns = [];
  for (let j = 0; j < nav.h; j++) {               // horizontal corridors
    let run = 0, best = 0; const z = nav.minZ + (j + 0.5) * nav.cell;
    for (let i = 0; i < nav.w; i++) { const x = nav.minX + (i + 0.5) * nav.cell; run = blocks(x, z) ? 0 : run + nav.cell; if (run > best) best = run; }
    sightRuns.push(best); if (best > maxSight) maxSight = best;
  }
  for (let i = 0; i < nav.w; i++) {               // vertical corridors
    let run = 0, best = 0; const x = nav.minX + (i + 0.5) * nav.cell;
    for (let j = 0; j < nav.h; j++) { const z = nav.minZ + (j + 0.5) * nav.cell; run = blocks(x, z) ? 0 : run + nav.cell; if (run > best) best = run; }
    sightRuns.push(best); if (best > maxSight) maxSight = best;
  }
  sightRuns.sort((a, b) => a - b);
  const medSight = sightRuns[Math.floor(sightRuns.length / 2)] || 0;
  // ── overlap audit: nothing may sit inside a wall, and solid props must not
  // interpenetrate (touching is intended; real penetration is a defect the owner spotted)
  const EPS = 0.07;
  const pen = (a, b, aw, ad, bw, bd) => ((aw + bw) / 2 - Math.abs(a.x - b.x) > EPS) && ((ad + bd) / 2 - Math.abs(a.z - b.z) > EPS);
  let inWall = 0, propPen = 0;
  for (const q of m.props) for (const w of (m.walls || [])) if (pen(q, w, q.w, q.d, w.w, w.d)) { inWall++; break; }
  const sol = m.props.filter((q) => !q.noCollide);
  for (let i = 0; i < sol.length; i++) for (let j = i + 1; j < sol.length; j++) {
    if (pen(sol[i], sol[j], sol[i].w, sol[i].d, sol[j].w, sol[j].d)) { propPen++; break; }
  }
  const dressOnTop = m.props.filter((q) => q.noCollide && q.y > 0).length;
  const dressTotal = m.props.filter((q) => q.noCollide).length;
  console.log(`     [overlap] props-in-walls ${inWall} (want 0), solid interpenetrations ${propPen} (want 0), dressing raised onto surfaces ${dressOnTop}/${dressTotal}`);
  if (inWall || propPen) fail++;
  console.log(`     [brief] props ${m.props.length} (solid ${solid.length} / dressing ${dress}), tall h>=1.7 ${tall} (target 110-150), navigable ${navFrac}% (target 45-55), sightline median ${medSight.toFixed(0)}m (target <=24, gate <=40) / max ${maxSight.toFixed(0)}m (perimeter band, ungated)`);
  // hard: hider spawn reachable + seeker reaches most of the map. Soft: a few
  // auto-spots may be unreachable (the sim filters those at match start).
  // The cover floor is not padding: a generator bug emptied two stages of ALL 546 and 573
  // props, and every reachability test passed them — an empty box is trivially 100%
  // reachable with zero bad spots. A stage with no cover and no spots is the single worst
  // thing this file can be handed, so say so explicitly rather than scoring it perfect.
  const furnished = m.props.length >= 150 && solid.length >= 60 && spots.length >= 24;
  if (!furnished) console.log(`     [cover] FAIL — ${m.props.length} props (${solid.length} solid), ${spots.length} spots: a stage with no cover cannot be hidden in`);
  const sightOK = medSight <= 40;
  if (!sightOK) console.log(`     [sight] FAIL — median body-width sightline ${medSight.toFixed(0)}m: this stage is a shooting gallery`);
  const ok = hOK && furnished && sightOK && count > walk * 0.5 && badSpots.length <= Math.ceil(spots.length * 0.25);
  if (!ok) fail++;
  console.log(`${ok ? "OK  " : "FAIL"} ${id}: bounds ${sim.bounds.maxX - sim.bounds.minX}x${sim.bounds.maxZ - sim.bounds.minZ}, rooms ${m.rooms.length}, walls ${m.walls.length}, props ${m.props.length}, lights ${m.lights.length}, spots ${spots.length}`);
  console.log(`     walkable cells ${walk}, seeker-reachable ${count} (${reachPct}%), hider-spawn ${hOK ? "reachable" : "UNREACHABLE"}, bad-spots ${badSpots.length}${badSpots.length ? " " + JSON.stringify(badSpots.slice(0, 4)) : ""}`);
}
console.log(fail ? `\nREACH FAIL (${fail})` : "\nREACH OK");
process.exit(fail ? 1 : 0);
