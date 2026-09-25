// DYEFIELD — gate G8a (CONTRACT §10.2 / §12, CONTRACT_P6_11 §19): the bot navigation graph, headless in node.
//
//   node _harness/probe_nav.ts                  # the gate on Pier 18
//   node _harness/probe_nav.ts --map lockwell   # … on LOCKWELL WORKS (pier18 | lockwell | cinder)
//   node _harness/probe_nav.ts --verbose        # list failing edges
//
// Checks:
//   * the graph connects both spawns (A → B and B → A);
//   * Pier 18: paths from each spawn to both side decks, the buoy block top and every quadrant of the court;
//     LOCKWELL / CINDER (CHANGED(MAPSIM)): every named movement area of art/renders/map_<id>_routes.json
//     (the art lane's walking-reachability table) holds a node reachable from both spawns that leads back to
//     both. Nodes are classified with the art lane's own area rules (lockwell: the AREAS_A boxes parsed from
//     art/blender/lockwell_qa.py; cinder: area_of() of art/blender/cinder_routes.py, ported below, with the
//     surface name looked up in the GLB);
//   * no node lies inside geometry — tested independently of the builder with Rapier (grates included: a
//     runner collides with them): the capsule volume at the node overlaps nothing, there is floor right under
//     it, and it is not boxed in (8 knee rays hit within 2.5 m AND a lid within 3 m overhead); and (MAPSIM)
//     no node is inside an oob_ volume or on a spring pad;
//   * the strongly connected core around spawn A holds ≥ 97 % of the nodes;
//   * rotation symmetry (all three maps are rot180): nodes / edges without a rotated twin (fairness);
//   * EXECUTION: the real Runner (core/runner.ts, Rapier KCC, the same MOVE numbers, the map's features) is
//     driven along every drop, jump, wall-slick climb and spring edge (the wall dyed first), every walk edge
//     over a conveyor belt, and a sample of the other walk edges, the way a bot drives them; ≥ 97 % of each
//     kind must arrive;
//   * build time (ms), path query time, node / edge counts.
// Exit: 0 all pass · 1 a check failed · 2 setup failure.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRapier, PhysicsWorld } from '../runtime/src/core/physics.ts';
import { mapById, type MapDef } from '../runtime/src/core/data.ts';
import { conveyorAt, featuresOf, loadMapGeometry, oobAt, springAt, type MapGeometry } from '../runtime/src/core/mapgeo.ts';
import { parseGlb, type GlbDoc } from '../runtime/src/core/glb.ts';
import { buildAtlas } from '../runtime/src/core/paint/atlas.ts';
import { Painter } from '../runtime/src/core/paint/painter.ts';
import { Runner } from '../runtime/src/core/runner.ts';
import { buildNav, EDGE_CLIMB, EDGE_DROP, EDGE_JUMP, EDGE_SPRING, EDGE_WALK, type NavGraph } from '../runtime/src/core/bots/nav.ts';
import { MOVE, TICK } from '../runtime/src/core/config.ts';
import { emptyIntent } from '../runtime/src/core/types.ts';
import { mulberry32 } from '../runtime/src/core/rng.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(HERE, '..');
const argv = process.argv.slice(2);
const VERBOSE = argv.includes('--verbose');
const MAP_ID = (() => { const i = argv.indexOf('--map'); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : 'pier18'; })();
interface Check { name: string; pass: boolean; detail: string }
const checks: Check[] = [];
function check(name: string, pass: boolean, detail: string): void {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
}
const f2 = (v: number): string => v.toFixed(2);
const KIND = ['walk', 'drop', 'jump', 'climb', 'spring'];
const GR = { grates: true } as const;

function pathLen(nav: NavGraph, p: number[]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += Math.hypot(nav.x[p[i]] - nav.x[p[i - 1]], nav.y[p[i]] - nav.y[p[i - 1]], nav.z[p[i]] - nav.z[p[i - 1]]);
  return s;
}

/** node nearest (x, y, z) whose y is within ±0.3 of y */
function nodeAt(nav: NavGraph, x: number, y: number, z: number): number {
  let best = -1, bd = Infinity;
  for (let n = 0; n < nav.nodes; n++) {
    if (Math.abs(nav.y[n] - y) > 0.3) continue;
    const d = (nav.x[n] - x) ** 2 + (nav.z[n] - z) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

// ───────────────────────────── named areas (the art lane's rules) ─────────────────────────────

type Box = { name: string; x0: number; x1: number; z0: number; z1: number; y0: number; y1: number };

/** LOCKWELL: AREAS_A from art/blender/lockwell_qa.py (+ rot180 twins), first match wins (authored order) */
function lockwellAreas(): Box[] {
  const src = readFileSync(resolve(GAME, 'art/blender/lockwell_qa.py'), 'utf8');
  const block = src.slice(src.indexOf('AREAS_A = ['), src.indexOf(']\n', src.indexOf('AREAS_A = [')));
  const re = /\("(\w+)",\s*"(\w+)",\s*\(([-\d.]+),\s*([-\d.]+)\),\s*\(([-\d.]+),\s*([-\d.]+)\),\s*\(([-\d.]+),\s*([-\d.]+)\)\)/g;
  const A: Array<[string, string, number[]]> = [];
  for (let m = re.exec(block); m; m = re.exec(block)) A.push([m[1], m[2], m.slice(3, 9).map(Number)]);
  if (!A.length) throw new Error('lockwell_qa.py: AREAS_A not found / not parsed');
  const out: Array<Box & { order: number }> = [];
  A.forEach(([n, tw, v], i) => {
    out.push({ name: n, x0: v[0], x1: v[1], z0: v[2], z1: v[3], y0: v[4], y1: v[5], order: i });
    if (tw !== n) out.push({ name: tw, x0: -v[1], x1: -v[0], z0: -v[3], z1: -v[2], y0: v[4], y1: v[5], order: i });
  });
  return out.sort((a, b) => a.order - b.order);   // stable: the A half first within an order (as sorted() in the .py)
}

function lockwellAreaOf(boxes: Box[], x: number, y: number, z: number): string {
  for (const b of boxes) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && y >= b.y0 && y <= b.y1) return b.name;
  return 'other';
}

/** CINDER: area_of(x, y, z, name) of art/blender/cinder_routes.py, ported line for line */
const PERCH_NODES: Record<string, string> = {
  paint_crate: 'crate tops', solid_driftwood: 'driftwood logs', solid_lanterns: 'lantern posts',
  solid_palm_trunks: 'palm trunks', solid_bridge_posts: 'bridge posts', col_bridge_rails: 'bridge rails',
  solid_masts: 'masts', solid_coral: 'coral heads', solid_cliff: 'back-cliff columns', paint_wreck: 'bulwark rail / stems',
};
function cinderAreaOf(x: number, y: number, z: number, name: string): string {
  const ax = Math.abs(x), az = Math.abs(z);
  if (name.startsWith('paint_wreck') && !name.startsWith('paint_wreck_deck') && y < 2.5) return 'wreck tunnel (hull breach)';
  if (name in PERCH_NODES) return 'perch: ' + PERCH_NODES[name];
  if (name.startsWith('paint_basalt')) {
    if (ax <= 12.0 && az < 14.0 && y >= 1.4) return 'perch: MID rock outcrops';
    if (az >= 29.0 && y >= 1.3 && !(ax <= 10.6 && az >= 35.0)) return 'perch: beach rock outcrops';
    if (ax > 12.0 && az < 29.0 && y >= 3.6) return 'perch: isle rock pillars';
    if (ax > 12.0 && az < 29.0 && az >= 11.8 && y >= 1.35 && y < 2.2 && ax < 21.0) return 'perch: isle rock outcrops';
  }
  if (name.startsWith('paint_wreck_deck') && y >= 5.4) return 'perch: wheelhouse roof';
  if (name.startsWith('paint_sand') && az >= 45.4 && ax <= 15.0) return 'back strip behind the cliff';
  if (name.startsWith('paint_plank')) {
    if (ax > 22) return z < 0 ? 'bridge beach-A~WEST' : 'bridge beach-B~EAST';
    return x < 0 ? 'bridge WEST~MID' : 'bridge EAST~MID';
  }
  if (name.startsWith('spring_')) return 'spring pad ' + name;
  if (az >= 29.0 || (ax <= 12.0 && az >= 14.0)) {
    const side = z < 0 ? 'A' : 'B';
    if (y >= 1.05 && ax <= 10.6 && az >= 35.0) return `spawn shelf ${side}`;
    return `beach ${side}`;
  }
  if (az >= 20.9 && ax > 12.0) {
    if (z < 0) return x < 0 ? 'sandbar A~WEST (bar_w)' : 'shoal A~EAST (shoal_e)';
    return x > 0 ? 'sandbar B~EAST (bar_w_m)' : 'shoal B~WEST (shoal_e_m)';
  }
  if (ax > 12.0) {
    const isle = x < 0 ? 'WEST' : 'EAST';
    if (y >= 2.75) return `${isle} crown`;
    if (y >= 1.35) return `${isle} shelf`;
    return `${isle} sand`;
  }
  if (y >= 5.4) return 'wheelhouse roof';
  if (y >= 3.3) return 'wreck deck';
  return z < 0 ? 'MID apron S' : 'MID apron N';
}

/** name of the collider surface a node stands on: the up-facing triangle (of a colliding node) under it at its height */
function surfaceNamer(doc: GlbDoc): (x: number, y: number, z: number) => string {
  const COLL = ['paint_', 'solid_', 'col_', 'grate_', 'conveyor_', 'spring_'];
  const tris: Array<{ name: string; t: Float64Array }> = [];
  const cell = 1;
  const grid = new Map<number, number[]>();
  const key = (ix: number, iz: number): number => (ix + 1000) * 4000 + (iz + 1000);
  for (const p of doc.parts) {
    if (!COLL.some((c) => p.node.startsWith(c)) || p.node === 'solid_seabed') continue;
    const P = p.positions, I = p.indices;
    for (let k = 0; k + 2 < I.length; k += 3) {
      const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const gy = uz * vx - ux * vz;
      const l = Math.hypot(uy * vz - uz * vy, gy, ux * vy - uy * vx);
      if (l < 1e-9 || gy / l < 0.3) continue;
      const t = new Float64Array([P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]]);
      const id = tris.length;
      tris.push({ name: p.node, t });
      const x0 = Math.floor(Math.min(t[0], t[3], t[6]) / cell), x1 = Math.floor(Math.max(t[0], t[3], t[6]) / cell);
      const z0 = Math.floor(Math.min(t[2], t[5], t[8]) / cell), z1 = Math.floor(Math.max(t[2], t[5], t[8]) / cell);
      for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
        const kk = key(ix, iz); const l2 = grid.get(kk); if (l2) l2.push(id); else grid.set(kk, [id]);
      }
    }
  }
  return (x, y, z) => {
    const list = grid.get(key(Math.floor(x / cell), Math.floor(z / cell))) ?? [];
    let best = '', bd = 0.08;
    for (const id of list) {
      const t = tris[id].t;
      const x0 = t[0], z0 = t[2], x1 = t[3], z1 = t[5], x2 = t[6], z2 = t[8];
      const den = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
      if (Math.abs(den) < 1e-12) continue;
      const a = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / den;
      const b = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / den;
      if (a < -1e-4 || b < -1e-4 || a + b > 1 + 1e-4) continue;
      const h = a * t[1] + b * t[4] + (1 - a - b) * t[7];
      const d = Math.abs(h - y);
      if (d < bd) { bd = d; best = tris[id].name; }
    }
    return best;
  };
}

async function main(): Promise<number> {
  let def: MapDef, geo: MapGeometry, R: Awaited<ReturnType<typeof loadRapier>>;
  try {
    def = mapById(MAP_ID);
    R = await loadRapier();
    geo = await loadMapGeometry(def);
  } catch (e) { console.log('SETUP FAILED:', (e as Error).stack ?? e); return 2; }
  const physics = new PhysicsWorld(R, geo);
  const F = featuresOf(geo);

  // ── build (twice: the second number is the warm build a browser pays on a later match) ──
  const nav = buildNav(geo, physics, def);
  const nav2 = buildNav(geo, new PhysicsWorld(R, geo), def);
  const s = nav.stats;
  const same = nav.nodes === nav2.nodes && nav.edgeTo.length === nav2.edgeTo.length
    && nav.x.every((v, i) => v === nav2.x[i]) && nav.edgeTo.every((v, i) => v === nav2.edgeTo[i]) && nav.edgeCost.every((v, i) => v === nav2.edgeCost[i]);
  // a fingerprint of the whole graph (nodes, CSR, costs, kinds) — unchanged fingerprint = unchanged bots
  let fp = 0x811c9dc5;
  const mixF = (v: number): void => { fp ^= Math.round(v * 1000) | 0; fp = Math.imul(fp, 0x01000193); };
  for (let i = 0; i < nav.nodes; i++) { mixF(nav.x[i]); mixF(nav.y[i]); mixF(nav.z[i]); mixF(nav.edgeStart[i]); }
  for (let e = 0; e < nav.edgeTo.length; e++) { mixF(nav.edgeTo[e]); mixF(nav.edgeCost[e]); mixF(nav.edgeKind[e]); }
  console.log(`map ${MAP_ID} · ${geo.collision.indices.length / 3} collision tris + ${F.grates.indices.length / 3} grate tris · ${F.conveyors.length} conveyors · ${F.springs.length} springs · ${F.oob.length} oob volumes · bounds ${JSON.stringify(def.bounds)}`);
  console.log(`nav: ${nav.nodes} nodes · ${nav.edgeTo.length} edges (walk ${s.edgesByKind[0]}, drop ${s.edgesByKind[1]}, jump ${s.edgesByKind[2]}, climb ${s.edgesByKind[3]}, spring ${s.edgesByKind[4]}) · ${nav.climbs.length} climb records · ${s.nudged} nodes nudged off walls · graph fingerprint ${(fp >>> 0).toString(16).padStart(8, '0')}`);
  console.log(`build: ${s.buildMs.toFixed(0)} ms cold (nodes ${s.nodeMs.toFixed(0)} ms), ${nav2.stats.buildMs.toFixed(0)} ms warm`);
  check('build is deterministic (two builds identical)', same, same ? 'identical nodes / edges / costs' : 'DIFFERENT');
  const buildCap = MAP_ID === 'pier18' ? 1500 : 4000;
  check(`build time < ${buildCap} ms`, Math.min(s.buildMs, nav2.stats.buildMs) < buildCap, `${s.buildMs.toFixed(0)} ms cold, ${nav2.stats.buildMs.toFixed(0)} ms warm`);

  // ── connectivity between spawns + key places ──
  const out: number[] = [];
  const sA = nav.nearest(geo.spawns.A.x, geo.spawns.A.y, geo.spawns.A.z);
  const sB = nav.nearest(geo.spawns.B.x, geo.spawns.B.y, geo.spawns.B.z);
  check('spawn nodes found', sA >= 0 && sB >= 0 && Math.hypot(nav.x[sA] - geo.spawns.A.x, nav.z[sA] - geo.spawns.A.z) < 1.5 && Math.hypot(nav.x[sB] - geo.spawns.B.x, nav.z[sB] - geo.spawns.B.z) < 1.5,
    `A → node ${sA} (${f2(nav.x[sA])}, ${f2(nav.y[sA])}, ${f2(nav.z[sA])}); B → node ${sB} (${f2(nav.x[sB])}, ${f2(nav.y[sB])}, ${f2(nav.z[sB])})`);
  const ab = nav.path(sA, sB, out); const abLen = pathLen(nav, out), abN = out.length;
  const ba = nav.path(sB, sA, out); const baLen = pathLen(nav, out), baN = out.length;
  check('spawn A ↔ spawn B connected', ab && ba, `A→B ${ab ? `${abN} nodes, ${abLen.toFixed(1)} m` : 'NO PATH'} · B→A ${ba ? `${baN} nodes, ${baLen.toFixed(1)} m` : 'NO PATH'}`);

  // reachability sets (forward from / backward to each spawn)
  const radj: number[][] = Array.from({ length: nav.nodes }, () => []);
  for (let u = 0; u < nav.nodes; u++) for (let e = nav.edgeStart[u]; e < nav.edgeStart[u + 1]; e++) radj[nav.edgeTo[e]].push(u);
  const bfs = (src: number, back: boolean): Uint8Array => {
    const seen = new Uint8Array(nav.nodes); const q = [src]; seen[src] = 1;
    for (let h = 0; h < q.length; h++) {
      const u = q[h];
      if (back) { for (const v of radj[u]) if (!seen[v]) { seen[v] = 1; q.push(v); } }
      else for (let e = nav.edgeStart[u]; e < nav.edgeStart[u + 1]; e++) { const v = nav.edgeTo[e]; if (!seen[v]) { seen[v] = 1; q.push(v); } }
    }
    return seen;
  };
  const fA = bfs(sA, false), fB = bfs(sB, false), bA = bfs(sA, true), bB = bfs(sB, true);

  if (MAP_ID === 'pier18') {
    const places: Array<[string, number, number, number]> = [
      ['west side deck', -24, 2.0, 0], ['east side deck', 24, 2.0, 0], ['buoy block top', 0, 1.4, 0],
      ['court SW quadrant (x<0, z<0)', -10, 0, -16], ['court SE quadrant (x>0, z<0)', 10, 0, -16],
      ['court NW quadrant (x<0, z>0)', -10, 0, 16], ['court NE quadrant (x>0, z>0)', 10, 0, 16],
    ];
    for (const [name, x, y, z] of places) {
      const n = nodeAt(nav, x, y, z);
      if (n < 0) { check(`paths to ${name}`, false, 'no node there'); continue; }
      const pa = nav.path(sA, n, out); const la = pathLen(nav, out);
      const pb = nav.path(sB, n, out); const lb = pathLen(nav, out);
      const back = nav.path(n, sA, out) && nav.path(n, sB, out);
      check(`paths to ${name}`, pa && pb && back,
        `node ${n} (${f2(nav.x[n])}, ${f2(nav.y[n])}, ${f2(nav.z[n])}) · from A ${pa ? la.toFixed(1) + ' m' : 'NO PATH'} · from B ${pb ? lb.toFixed(1) + ' m' : 'NO PATH'} · back to both spawns ${back ? 'yes' : 'NO'}`);
    }
  } else {
    // every named movement area of the art lane's routes table
    let required: string[] = [];
    let areaOf: (n: number) => string;
    const routes = JSON.parse(readFileSync(resolve(GAME, `art/renders/map_${MAP_ID}_routes.json`), 'utf8'));
    if (MAP_ID === 'lockwell') {
      const boxes = lockwellAreas();
      required = Object.keys(routes.areas ?? {});
      areaOf = (n) => lockwellAreaOf(boxes, nav.x[n], nav.y[n], nav.z[n]);
    } else if (MAP_ID === 'cinder') {
      const doc = parseGlb(new Uint8Array(readFileSync(resolve(GAME, `art/gltf/map_${MAP_ID}.glb`))));
      const namer = surfaceNamer(doc);
      required = (routes.routes?.route_table ?? []).filter((r: { kind: string; walk_from_A: unknown }) => r.kind === 'area' && r.walk_from_A).map((r: { area: string }) => r.area);
      areaOf = (n) => cinderAreaOf(nav.x[n], nav.y[n], nav.z[n], namer(nav.x[n], nav.y[n], nav.z[n]));
    } else {
      areaOf = () => 'other';
    }
    const byArea = new Map<string, { nodes: number; ok: number; ex: number }>();
    for (let n = 0; n < nav.nodes; n++) {
      const a = areaOf(n);
      let r = byArea.get(a); if (!r) { r = { nodes: 0, ok: 0, ex: n }; byArea.set(a, r); }
      r.nodes++;
      if (fA[n] && fB[n] && bA[n] && bB[n]) { if (!r.ok) r.ex = n; r.ok++; }
    }
    const missing: string[] = [], unreached: string[] = [];
    for (const a of required) {
      const r = byArea.get(a);
      if (!r) missing.push(a);
      else if (!r.ok) unreached.push(`${a} (${r.nodes} nodes, e.g. (${f2(nav.x[r.ex])},${f2(nav.y[r.ex])},${f2(nav.z[r.ex])}))`);
    }
    const good = required.length - missing.length - unreached.length;
    check(`every named area of map_${MAP_ID}_routes.json reachable from both spawns and back (${required.length} areas)`,
      required.length > 0 && missing.length === 0 && unreached.length === 0,
      `${good} / ${required.length} areas OK${missing.length ? ' · NO NODE in: ' + missing.join(', ') : ''}${unreached.length ? ' · not reached both ways: ' + unreached.join('; ') : ''}`);
    if (VERBOSE) for (const [a, r] of [...byArea.entries()].sort()) console.log(`      area ${a.padEnd(34)} nodes ${String(r.nodes).padStart(5)} · both-ways ${r.ok}`);
    // paths A → area and B → area, with lengths, for the report (a few representative ones)
    for (const a of required.slice(0, VERBOSE ? required.length : 0)) {
      const r = byArea.get(a); if (!r || !r.ok) continue;
      const pa = nav.path(sA, r.ex, out); const la = pathLen(nav, out);
      const pb = nav.path(sB, r.ex, out); const lb = pathLen(nav, out);
      console.log(`      path to ${a}: from A ${pa ? la.toFixed(1) : '-'} m · from B ${pb ? lb.toFixed(1) : '-'} m`);
    }
  }

  // ── strongly connected core around spawn A ──
  {
    let core = 0; const outliers: string[] = [];
    for (let n = 0; n < nav.nodes; n++) { if (fA[n] && bA[n]) core++; else if (outliers.length < 6) outliers.push(`(${f2(nav.x[n])},${f2(nav.y[n])},${f2(nav.z[n])})${fA[n] ? ' one-way' : ' unreachable'}`); }
    check('strongly connected core ≥ 97 % of nodes', core / nav.nodes >= 0.97, `${core} / ${nav.nodes} (${(core / nav.nodes * 100).toFixed(1)} %)${outliers.length ? ' · outside e.g. ' + outliers.join(' ') : ''}`);
  }

  // ── no node inside geometry (independent Rapier tests; grates count: runners collide with them) ──
  {
    let overlap = 0, noFloor = 0, boxed = 0, inOob = 0, onSpring = 0;
    const bad: string[] = [];
    for (let n = 0; n < nav.nodes; n++) {
      const x = nav.x[n], y = nav.y[n], z = nav.z[n];
      // capsule volume above the step band (the KCC autosteps anything lower than MOVE.stepHeight):
      // spheres r 0.3 at 0.70 and 0.85 m (bottom 0.40 m) — any penetration = inside / intersecting geometry
      const o1 = physics.sphereCast(x, y + MOVE.stepHeight + 0.35, z, 0, 1, 0, 0.3, 1e-3, GR);
      const o2 = physics.sphereCast(x, y + 0.85, z, 0, 1, 0, 0.3, 1e-3, GR);
      const isOverlap = (o1 && o1.toi === 0) || (o2 && o2.toi === 0);
      // floor right under the node (the node's own y, ±8 cm)
      const g = physics.raycast(x, y + 0.3, z, 0, -1, 0, 0.5, GR);
      const hasFloor = !!g && Math.abs(g.y - y) < 0.08;
      // boxed in: 8 horizontal rays at knee height all hit within 2.5 m, and something closes it overhead
      // within 3 m (MAPSIM: a node in an open-air rock gully — Cinder's back strip — is not inside anything)
      let near = 0;
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (physics.raycast(x, y + 0.5, z, Math.sin(a), 0, Math.cos(a), 2.5, GR)) near++; }
      const isBoxed = near === 8 && !!physics.raycast(x, y + 0.5, z, 0, 1, 0, 3, GR);
      const isOob = oobAt(F, x, y, z) >= 0;
      const isSpring = springAt(F, x, y, z, 1.0, 1.0) >= 0;
      if (isOverlap) overlap++;
      if (!hasFloor) noFloor++;
      if (isBoxed) boxed++;
      if (isOob) inOob++;
      if (isSpring) onSpring++;
      if ((isOverlap || !hasFloor || isBoxed || isOob || isSpring) && bad.length < 8) bad.push(`(${f2(x)},${f2(y)},${f2(z)})${isOverlap ? ' overlap' : ''}${!hasFloor ? ' no-floor' : ''}${isBoxed ? ' boxed' : ''}${isOob ? ' oob' : ''}${isSpring ? ' spring-pad' : ''}`);
    }
    check('no node inside geometry', overlap === 0 && noFloor === 0 && boxed === 0 && inOob === 0 && onSpring === 0,
      `capsule overlaps ${overlap} · no floor under ${noFloor} · boxed in ${boxed} · inside oob_ ${inOob} · on a spring pad ${onSpring}${bad.length ? ' · e.g. ' + bad.join(' ') : ''}`);
  }

  // ── rotation symmetry (fairness on a rot180 map) ──
  {
    const key = (x: number, y: number, z: number): string => `${Math.round(x * 20)},${Math.round(y * 20)},${Math.round(z * 20)}`;
    const nodeSet = new Set<string>();
    for (let n = 0; n < nav.nodes; n++) nodeSet.add(key(nav.x[n], nav.y[n], nav.z[n]));
    let nodeMiss = 0;
    const nodeEx: string[] = [];
    for (let n = 0; n < nav.nodes; n++) if (!nodeSet.has(key(-nav.x[n], nav.y[n], -nav.z[n]))) { nodeMiss++; if (nodeEx.length < 4) nodeEx.push(`(${f2(nav.x[n])},${f2(nav.y[n])},${f2(nav.z[n])})`); }
    const edgeSet = new Set<string>();
    for (let a = 0; a < nav.nodes; a++) for (let e = nav.edgeStart[a]; e < nav.edgeStart[a + 1]; e++) {
      const b = nav.edgeTo[e];
      edgeSet.add(`${nav.edgeKind[e]}|${key(nav.x[a], nav.y[a], nav.z[a])}|${key(nav.x[b], nav.y[b], nav.z[b])}`);
    }
    const miss = [0, 0, 0, 0, 0];
    for (let a = 0; a < nav.nodes; a++) for (let e = nav.edgeStart[a]; e < nav.edgeStart[a + 1]; e++) {
      const b = nav.edgeTo[e];
      if (!edgeSet.has(`${nav.edgeKind[e]}|${key(-nav.x[a], nav.y[a], -nav.z[a])}|${key(-nav.x[b], nav.y[b], -nav.z[b])}`)) miss[nav.edgeKind[e]]++;
    }
    const tot = miss.reduce((a, v) => a + v, 0);
    check('rot180 symmetry: ≤ 0.5 % of nodes / edges lack a rotated twin', nodeMiss <= nav.nodes * 0.005 && tot <= nav.edgeTo.length * 0.005,
      `nodes ${nodeMiss} / ${nav.nodes} · edges ${tot} / ${nav.edgeTo.length} (walk ${miss[0]}, drop ${miss[1]}, jump ${miss[2]}, climb ${miss[3]}, spring ${miss[4]})${nodeEx.length ? ' · e.g. ' + nodeEx.join(' ') : ''}`);
  }

  // ── path query timing ──
  {
    const rnd = mulberry32(12345);
    const t0 = performance.now();
    let found = 0, total = 0, worst = 0;
    const times: number[] = [];
    for (let i = 0; i < 300; i++) {
      const a = Math.floor(rnd() * nav.nodes), b = Math.floor(rnd() * nav.nodes);
      const t = performance.now();
      if (nav.path(a, b, out)) found++;
      const dt = performance.now() - t;
      times.push(dt); worst = Math.max(worst, dt); total++;
    }
    const el = performance.now() - t0;
    times.sort((p, q) => p - q);
    const bb = def.bounds ?? { min: [-28, 0, -42], max: [28, 2.5, 42] };
    const tn = performance.now();
    for (let i = 0; i < 2000; i++) nav.nearest(bb.min[0] + rnd() * (bb.max[0] - bb.min[0]), rnd() * 2.5, bb.min[2] + rnd() * (bb.max[2] - bb.min[2]));
    const nearestUs = (performance.now() - tn) / 2000 * 1000;
    check('path query time: mean < 3 ms, p95 < 6 ms', el / total < 3 && times[Math.floor(total * 0.95)] < 6,
      `${total} random A* queries: mean ${(el / total).toFixed(2)} ms, p95 ${times[Math.floor(total * 0.95)].toFixed(2)} ms, worst ${worst.toFixed(2)} ms, ${found} found · nearest() ${nearestUs.toFixed(1)} µs`);
  }

  // ── execution: drive the real Runner along the edges ──
  {
    const atlas = buildAtlas(geo.paint, geo.atlasSize, { wallWeight: def.scoring?.wallWeight ?? 0.35, floorMinNy: def.scoring?.floorMinNy ?? 0.45 });
    const painter = new Painter(atlas);
    const body = physics.createCharacter(MOVE.radius, MOVE.halfHeight);
    const p = new Runner({ id: 0, name: 'probe', team: 1, kit: 'mist-rasp', bot: true }, body, geo.spawns.A,
      { killY: def.killY ?? -1, physics, autoRespawn: true, features: F });
    const it = emptyIntent();
    const rnd = mulberry32(777);
    // per kind: [ok, fail]; index 5 = walk edges over a conveyor belt (also counted under walk)
    const res = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];
    const fails: string[] = [];
    const t0 = performance.now();
    const onBelt = (a: number, b: number): boolean => F.conveyors.length > 0 && (
      conveyorAt(F, nav.x[a], nav.y[a], nav.z[a], 0.3) >= 0 || conveyorAt(F, nav.x[b], nav.y[b], nav.z[b], 0.3) >= 0
      || conveyorAt(F, (nav.x[a] + nav.x[b]) / 2, (nav.y[a] + nav.y[b]) / 2, (nav.z[a] + nav.z[b]) / 2, 0.3) >= 0);
    let launches = 0;
    for (let a = 0; a < nav.nodes; a++) for (let e = nav.edgeStart[a]; e < nav.edgeStart[a + 1]; e++) {
      const k = nav.edgeKind[e];
      const b = nav.edgeTo[e];
      const belt = k === EDGE_WALK && onBelt(a, b);
      if (k === EDGE_WALK && rnd() > 0.02 && !belt) continue;         // ~2 % of the walk edges, every belt edge
      const dx = nav.x[b] - nav.x[a], dz = nav.z[b] - nav.z[a];
      const L = Math.hypot(dx, dz) || 1; const ux = dx / L, uz = dz / L;
      // start 0.9 m behind a (a bot arrives at a moving), on the same floor; climbs / walks / springs start at a
      let sx = nav.x[a] - ux * 0.9, sz = nav.z[a] - uz * 0.9;
      let g = nav.ground(sx, sz, nav.y[a] - 0.3, nav.y[a] + 0.3);
      if (!(g === g) || k === EDGE_CLIMB || k === EDGE_WALK || k === EDGE_SPRING || !nav.walkable(sx, g, sz, nav.x[a], nav.y[a], nav.z[a])) { sx = nav.x[a]; sz = nav.z[a]; g = nav.y[a]; }
      painter.reset();
      const c = k === EDGE_CLIMB ? nav.climbs[nav.edgeClimb[e]] : null;
      if (c) for (let y = c.y0 + 0.3; y <= c.y1 + 0.2; y += 0.4) painter.splat(c.cx, y, c.cz, { radius: 0.9, team: 1, nx: c.nx, ny: 0, nz: c.nz, minFacing: 0.3, seed: 7 });
      p.respawn({ x: sx, y: g, z: sz, yaw: Math.atan2(ux, uz) });
      const r0 = p.respawns, l0 = p.launches;
      let ok = false, jumped = false, topped = false;
      const maxT = k === EDGE_SPRING ? 360 : 180;
      for (let t = 0; t < maxT; t++) {
        const tx = nav.x[b] - p.x, tz = nav.z[b] - p.z;
        const d = Math.hypot(tx, tz);
        if (d < 0.5 && Math.abs(p.y - nav.y[b]) < 0.5 && p.grounded) { ok = true; break; }
        it.moveX = 0; it.fire = false;
        if (c && p.y >= c.y1 - 0.05) topped = true;
        if (c && !topped) { it.yaw = Math.atan2(-c.nx, -c.nz); it.moveZ = 1; it.slick = true; }
        else { it.yaw = Math.atan2(tx, tz); it.moveZ = k === EDGE_JUMP ? Math.max(0.25, Math.min(1, d / 1.6)) : 1; it.slick = false; }
        const along = (p.x - nav.x[a]) * ux + (p.z - nav.z[a]) * uz;
        it.jump = k === EDGE_JUMP && !jumped && p.grounded && (Math.hypot(p.x - nav.x[a], p.z - nav.z[a]) < 0.35 || along > -0.1);
        if (it.jump) jumped = true;
        p.step(TICK, it, painter, null);
        if (p.respawns > r0) break;
      }
      if (k === EDGE_SPRING && p.launches > l0) launches++;
      res[k][ok ? 0 : 1]++;
      if (belt) res[5][ok ? 0 : 1]++;
      if (!ok && fails.length < 40) fails.push(`${belt ? 'walk(belt)' : KIND[k]} (${f2(nav.x[a])},${f2(nav.y[a])},${f2(nav.z[a])}) → (${f2(nav.x[b])},${f2(nav.y[b])},${f2(nav.z[b])}) ended (${f2(p.x)},${f2(p.y)},${f2(p.z)}) ${p.state}${p.respawns > r0 ? ' WASHED' : ''}`);
    }
    const ms = performance.now() - t0;
    const label = ['walk', 'drop', 'jump', 'climb', 'spring', 'conveyor-walk'];
    const line = [0, 1, 2, 3, 4, 5].filter((k) => k < 4 || res[k][0] + res[k][1] > 0).map((k) => `${label[k]} ${res[k][0]}/${res[k][0] + res[k][1]}`).join(' · ');
    const okAll = res.slice(0, 5).reduce((a, v) => a + v[0], 0), all = res.slice(0, 5).reduce((a, v) => a + v[0] + v[1], 0);
    const rate = (k: number): number => res[k][0] / Math.max(1, res[k][0] + res[k][1]);
    const needSpring = F.springs.length > 0, needBelt = F.conveyors.length > 0;
    const kindsOk = [0, 1, 2, 3, 4, 5].every((k) => rate(k) >= 0.97 || res[k][0] + res[k][1] === 0);
    const presentOk = (!needSpring || res[4][0] + res[4][1] > 0) && (!needBelt || res[5][0] + res[5][1] > 0);
    check('the real Runner traverses the edges (≥ 97 % of each kind, springs and conveyor belts included)', kindsOk && presentOk,
      `${line} · ${(okAll / all * 100).toFixed(1)} % of ${all} in ${(ms / 1000).toFixed(1)} s${needSpring ? ` · spring launches ${launches}/${res[4][0] + res[4][1]}` : ''}${!presentOk ? ' · MISSING spring / conveyor edges' : ''}`);
    if (VERBOSE || fails.length) for (const f of fails.slice(0, VERBOSE ? 40 : 8)) console.log('      miss:', f);
  }

  console.log('-'.repeat(100));
  const failed = checks.filter((c) => !c.pass);
  console.log(failed.length ? `G8 nav (${MAP_ID}): FAIL (${failed.length} of ${checks.length} checks)` : `G8 nav (${MAP_ID}): PASS (${checks.length} checks)`);
  return failed.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.log('SETUP FAILED:', (e as Error).stack ?? e); process.exit(2); });
