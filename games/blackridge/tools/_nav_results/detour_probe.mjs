// Is a high path/line ratio map topology or bad pathing? For each pair, compare
// findPath length with the TRUE shortest walk over the nav graph (Dijkstra on
// pure hop length, no wall penalty, no string pull = an upper bound on the
// geodesic, tight to ~5%).
import path from "path"; import { pathToFileURL } from "url";
const G = process.cwd(); const u = (p) => pathToFileURL(path.resolve(G, p)).href;
const COL = await import(u("core/level/colliders.js")); const NAV = await import(u("core/ai/nav.js")); const RNG = await import(u("core/rng.js"));
const mapId = process.argv[2] || "saltmarket";
const c = COL.buildCollidersFor(mapId, 1); const nav = NAV.bakeNav(c, { cell: 0.75 });
const rng = RNG.mulberry32(1 * 7919 + mapId.length);
const b = c.bounds; const center = [(b.min[0] + b.max[0]) / 2, 0, (b.min[2] + b.max[2]) / 2]; const R = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
const pairs = []; let guard = 0;
while (pairs.length < 300 && guard++ < 12000) { const s = nav.randomPoint(center, R, rng), g = nav.randomPoint(center, R, rng); if (Math.hypot(s[0] - g[0], s[2] - g[2]) < 8) continue; if (!nav.reachable(s, g)) continue; pairs.push([s, g]); }
const Gr = nav._graph(); const N = Gr.nodeX.length;
const dist = new Float64Array(N);
function dijkstra(a, bb) {
  dist.fill(Infinity); dist[a] = 0; const heap = [[0, a]];
  while (heap.length) { heap.sort((x, y) => y[0] - x[0]); const [d, cur] = heap.pop(); if (cur === bb) return d; if (d > dist[cur]) continue;
    for (const nb of Gr.adj[cur]) { if (!Gr.walk[nb]) continue; const nd = d + Math.hypot(Gr.nodeX[nb] - Gr.nodeX[cur], Gr.nodeZ[nb] - Gr.nodeZ[cur]); if (nd < dist[nb]) { dist[nb] = nd; heap.push([nd, nb]); } } }
  return Infinity;
}
const L = (p) => { let d = 0; for (let i = 1; i < p.length; i++) d += Math.hypot(p[i][0] - p[i - 1][0], p[i][2] - p[i - 1][2]); return d; };
const rows = pairs.map(([s, g]) => { const p = nav.findPath(s, g); return { s, g, line: Math.hypot(g[0] - s[0], g[2] - s[2]), plen: L(p) }; });
rows.sort((x, y) => y.plen / y.line - x.plen / x.line);
let worse = 0;
for (const r of rows.slice(0, 15)) {
  const geo = dijkstra(Gr.nodeAt(r.s), Gr.nodeAt(r.g));
  // the graph walk zig-zags on the 8-neighbour grid: ~1.08x the true geodesic
  const ratio = r.plen / (geo / 1.08);
  if (ratio > 1.15) worse++;
  console.log(`path/line ${(r.plen / r.line).toFixed(2)}  findPath ${r.plen.toFixed(1)} m  graph-geodesic ${geo.toFixed(1)} m (~${(geo / 1.08).toFixed(1)} straightened)  findPath/geodesic ${ratio.toFixed(2)}  s=${r.s.map((v) => v.toFixed(1))} g=${r.g.map((v) => v.toFixed(1))}`);
}
console.log(`${mapId}: of the 15 worst path/line pairs, ${worse} have findPath > 1.15x the geodesic`);
