// DYEFIELD — gate G8a (CONTRACT §10.2 / §12): the bot navigation graph on Pier 18, headless in node.
//
//   node _harness/probe_nav.ts            # the gate
//   node _harness/probe_nav.ts --verbose  # list failing edges
//
// Checks:
//   * the graph connects both spawns (A → B and B → A);
//   * paths from each spawn to both side decks, the buoy block top and every quadrant of the court;
//   * no node lies inside geometry — tested independently of the builder with Rapier: the capsule
//     volume at the node overlaps nothing, there is floor right under it, and it is not boxed in;
//   * the strongly connected core around spawn A holds ≥ 97 % of the nodes;
//   * rotation symmetry (Pier 18 is rot180): nodes / edges without a rotated twin (fairness);
//   * EXECUTION: the real Runner (core/runner.ts, Rapier KCC, the same MOVE numbers) is driven along
//     every drop, jump and wall-slick climb edge (the wall dyed first), and a sample of walk edges,
//     the way a bot drives them; ≥ 97 % must arrive;
//   * build time (ms), path query time, node / edge counts.
// Exit: 0 all pass · 1 a check failed · 2 setup failure.

import { loadRapier, PhysicsWorld } from '../runtime/src/core/physics.ts';
import { mapById, type MapDef } from '../runtime/src/core/data.ts';
import { loadMapGeometry, type MapGeometry } from '../runtime/src/core/mapgeo.ts';
import { buildAtlas } from '../runtime/src/core/paint/atlas.ts';
import { Painter } from '../runtime/src/core/paint/painter.ts';
import { Runner } from '../runtime/src/core/runner.ts';
import { buildNav, EDGE_CLIMB, EDGE_DROP, EDGE_JUMP, EDGE_WALK, type NavGraph } from '../runtime/src/core/bots/nav.ts';
import { MOVE, TICK } from '../runtime/src/core/config.ts';
import { emptyIntent } from '../runtime/src/core/types.ts';
import { mulberry32 } from '../runtime/src/core/rng.ts';

const VERBOSE = process.argv.includes('--verbose');
interface Check { name: string; pass: boolean; detail: string }
const checks: Check[] = [];
function check(name: string, pass: boolean, detail: string): void {
  checks.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
}
const f2 = (v: number): string => v.toFixed(2);
const KIND = ['walk', 'drop', 'jump', 'climb'];

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

async function main(): Promise<number> {
  let def: MapDef, geo: MapGeometry, R: Awaited<ReturnType<typeof loadRapier>>;
  try {
    def = mapById('pier18');
    R = await loadRapier();
    geo = await loadMapGeometry(def);
  } catch (e) { console.log('SETUP FAILED:', (e as Error).stack ?? e); return 2; }
  const physics = new PhysicsWorld(R, geo);

  // ── build (twice: the second number is the warm build a browser pays on a later match) ──
  const nav = buildNav(geo, physics, def);
  const nav2 = buildNav(geo, new PhysicsWorld(R, geo), def);
  const s = nav.stats;
  const same = nav.nodes === nav2.nodes && nav.edgeTo.length === nav2.edgeTo.length
    && nav.x.every((v, i) => v === nav2.x[i]) && nav.edgeTo.every((v, i) => v === nav2.edgeTo[i]) && nav.edgeCost.every((v, i) => v === nav2.edgeCost[i]);
  console.log(`map pier18 · ${geo.collision.indices.length / 3} collision tris · bounds ${JSON.stringify(def.bounds)}`);
  console.log(`nav: ${nav.nodes} nodes · ${nav.edgeTo.length} edges (walk ${s.edgesByKind[0]}, drop ${s.edgesByKind[1]}, jump ${s.edgesByKind[2]}, climb ${s.edgesByKind[3]}) · ${nav.climbs.length} climb records · ${s.nudged} nodes nudged off walls`);
  console.log(`build: ${s.buildMs.toFixed(0)} ms cold (nodes ${s.nodeMs.toFixed(0)} ms), ${nav2.stats.buildMs.toFixed(0)} ms warm`);
  check('build is deterministic (two builds identical)', same, same ? 'identical nodes / edges / costs' : 'DIFFERENT');
  check('build time < 1500 ms', Math.min(s.buildMs, nav2.stats.buildMs) < 1500, `${s.buildMs.toFixed(0)} ms cold, ${nav2.stats.buildMs.toFixed(0)} ms warm`);

  // ── connectivity between spawns + key places ──
  const out: number[] = [];
  const sA = nav.nearest(geo.spawns.A.x, geo.spawns.A.y, geo.spawns.A.z);
  const sB = nav.nearest(geo.spawns.B.x, geo.spawns.B.y, geo.spawns.B.z);
  check('spawn nodes found', sA >= 0 && sB >= 0 && Math.hypot(nav.x[sA] - geo.spawns.A.x, nav.z[sA] - geo.spawns.A.z) < 1.5 && Math.hypot(nav.x[sB] - geo.spawns.B.x, nav.z[sB] - geo.spawns.B.z) < 1.5,
    `A → node ${sA} (${f2(nav.x[sA])}, ${f2(nav.y[sA])}, ${f2(nav.z[sA])}); B → node ${sB} (${f2(nav.x[sB])}, ${f2(nav.y[sB])}, ${f2(nav.z[sB])})`);
  const ab = nav.path(sA, sB, out); const abLen = pathLen(nav, out), abN = out.length;
  const ba = nav.path(sB, sA, out); const baLen = pathLen(nav, out), baN = out.length;
  check('spawn A ↔ spawn B connected', ab && ba, `A→B ${ab ? `${abN} nodes, ${abLen.toFixed(1)} m` : 'NO PATH'} · B→A ${ba ? `${baN} nodes, ${baLen.toFixed(1)} m` : 'NO PATH'}`);

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

  // ── strongly connected core around spawn A ──
  {
    const fwd = new Uint8Array(nav.nodes), rev = new Uint8Array(nav.nodes);
    const radj: number[][] = Array.from({ length: nav.nodes }, () => []);
    for (let u = 0; u < nav.nodes; u++) for (let e = nav.edgeStart[u]; e < nav.edgeStart[u + 1]; e++) radj[nav.edgeTo[e]].push(u);
    const q = [sA]; fwd[sA] = 1;
    for (let h = 0; h < q.length; h++) { const u = q[h]; for (let e = nav.edgeStart[u]; e < nav.edgeStart[u + 1]; e++) { const v = nav.edgeTo[e]; if (!fwd[v]) { fwd[v] = 1; q.push(v); } } }
    q.length = 0; q.push(sA); rev[sA] = 1;
    for (let h = 0; h < q.length; h++) { const u = q[h]; for (const v of radj[u]) if (!rev[v]) { rev[v] = 1; q.push(v); } }
    let core = 0; const outliers: string[] = [];
    for (let n = 0; n < nav.nodes; n++) { if (fwd[n] && rev[n]) core++; else if (outliers.length < 6) outliers.push(`(${f2(nav.x[n])},${f2(nav.y[n])},${f2(nav.z[n])})${fwd[n] ? ' one-way' : ' unreachable'}`); }
    check('strongly connected core ≥ 97 % of nodes', core / nav.nodes >= 0.97, `${core} / ${nav.nodes} (${(core / nav.nodes * 100).toFixed(1)} %)${outliers.length ? ' · outside e.g. ' + outliers.join(' ') : ''}`);
  }

  // ── no node inside geometry (independent Rapier tests) ──
  {
    let overlap = 0, noFloor = 0, boxed = 0;
    const bad: string[] = [];
    for (let n = 0; n < nav.nodes; n++) {
      const x = nav.x[n], y = nav.y[n], z = nav.z[n];
      // capsule volume above the step band (the KCC autosteps anything lower than MOVE.stepHeight):
      // spheres r 0.3 at 0.70 and 0.85 m (bottom 0.40 m) — any penetration = inside / intersecting geometry
      const o1 = physics.sphereCast(x, y + MOVE.stepHeight + 0.35, z, 0, 1, 0, 0.3, 1e-3);
      const o2 = physics.sphereCast(x, y + 0.85, z, 0, 1, 0, 0.3, 1e-3);
      const isOverlap = (o1 && o1.toi === 0) || (o2 && o2.toi === 0);
      // floor right under the node (the node's own y, ±8 cm)
      const g = physics.raycast(x, y + 0.3, z, 0, -1, 0, 0.5);
      const hasFloor = !!g && Math.abs(g.y - y) < 0.08;
      // boxed in: 8 horizontal rays at knee height all hit within 2.5 m
      let near = 0;
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (physics.raycast(x, y + 0.5, z, Math.sin(a), 0, Math.cos(a), 2.5)) near++; }
      const isBoxed = near === 8;
      if (isOverlap) overlap++;
      if (!hasFloor) noFloor++;
      if (isBoxed) boxed++;
      if ((isOverlap || !hasFloor || isBoxed) && bad.length < 8) bad.push(`(${f2(x)},${f2(y)},${f2(z)})${isOverlap ? ' overlap' : ''}${!hasFloor ? ' no-floor' : ''}${isBoxed ? ' boxed' : ''}`);
    }
    check('no node inside geometry', overlap === 0 && noFloor === 0 && boxed === 0,
      `capsule overlaps ${overlap} · no floor under ${noFloor} · boxed in ${boxed}${bad.length ? ' · e.g. ' + bad.join(' ') : ''}`);
  }

  // ── rotation symmetry (fairness on a rot180 map) ──
  {
    const key = (x: number, y: number, z: number): string => `${Math.round(x * 20)},${Math.round(y * 20)},${Math.round(z * 20)}`;
    const nodeSet = new Set<string>();
    for (let n = 0; n < nav.nodes; n++) nodeSet.add(key(nav.x[n], nav.y[n], nav.z[n]));
    let nodeMiss = 0;
    for (let n = 0; n < nav.nodes; n++) if (!nodeSet.has(key(-nav.x[n], nav.y[n], -nav.z[n]))) nodeMiss++;
    const edgeSet = new Set<string>();
    for (let a = 0; a < nav.nodes; a++) for (let e = nav.edgeStart[a]; e < nav.edgeStart[a + 1]; e++) {
      const b = nav.edgeTo[e];
      edgeSet.add(`${nav.edgeKind[e]}|${key(nav.x[a], nav.y[a], nav.z[a])}|${key(nav.x[b], nav.y[b], nav.z[b])}`);
    }
    const miss = [0, 0, 0, 0];
    for (let a = 0; a < nav.nodes; a++) for (let e = nav.edgeStart[a]; e < nav.edgeStart[a + 1]; e++) {
      const b = nav.edgeTo[e];
      if (!edgeSet.has(`${nav.edgeKind[e]}|${key(-nav.x[a], nav.y[a], -nav.z[a])}|${key(-nav.x[b], nav.y[b], -nav.z[b])}`)) miss[nav.edgeKind[e]]++;
    }
    const tot = miss.reduce((a, v) => a + v, 0);
    check('rot180 symmetry: ≤ 0.5 % of nodes / edges lack a rotated twin', nodeMiss <= nav.nodes * 0.005 && tot <= nav.edgeTo.length * 0.005,
      `nodes ${nodeMiss} / ${nav.nodes} · edges ${tot} / ${nav.edgeTo.length} (walk ${miss[0]}, drop ${miss[1]}, jump ${miss[2]}, climb ${miss[3]})`);
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
    const tn = performance.now();
    for (let i = 0; i < 2000; i++) nav.nearest(-28 + rnd() * 56, rnd() * 2.5, -42 + rnd() * 84);
    const nearestUs = (performance.now() - tn) / 2000 * 1000;
    check('path query time: mean < 3 ms, p95 < 6 ms', el / total < 3 && times[Math.floor(total * 0.95)] < 6,
      `${total} random A* queries: mean ${(el / total).toFixed(2)} ms, p95 ${times[Math.floor(total * 0.95)].toFixed(2)} ms, worst ${worst.toFixed(2)} ms, ${found} found · nearest() ${nearestUs.toFixed(1)} µs`);
  }

  // ── execution: drive the real Runner along the edges ──
  {
    const atlas = buildAtlas(geo.paint, geo.atlasSize, { wallWeight: def.scoring?.wallWeight ?? 0.35, floorMinNy: def.scoring?.floorMinNy ?? 0.45 });
    const painter = new Painter(atlas);
    const body = physics.createCharacter(MOVE.radius, MOVE.halfHeight);
    const p = new Runner({ id: 0, name: 'probe', team: 1, kit: 'mist-rasp', bot: true }, body, geo.spawns.A, { killY: def.killY ?? -1, physics, autoRespawn: true });
    const it = emptyIntent();
    const rnd = mulberry32(777);
    const res = [[0, 0], [0, 0], [0, 0], [0, 0]];
    const fails: string[] = [];
    const t0 = performance.now();
    for (let a = 0; a < nav.nodes; a++) for (let e = nav.edgeStart[a]; e < nav.edgeStart[a + 1]; e++) {
      const k = nav.edgeKind[e];
      if (k === EDGE_WALK && rnd() > 0.02) continue;                  // ~2 % of the walk edges
      const b = nav.edgeTo[e];
      const dx = nav.x[b] - nav.x[a], dz = nav.z[b] - nav.z[a];
      const L = Math.hypot(dx, dz) || 1; const ux = dx / L, uz = dz / L;
      // start 0.9 m behind a (a bot arrives at a moving), on the same floor; climbs start at a
      let sx = nav.x[a] - ux * 0.9, sz = nav.z[a] - uz * 0.9;
      let g = nav.ground(sx, sz, nav.y[a] - 0.3, nav.y[a] + 0.3);
      if (!(g === g) || k === EDGE_CLIMB || k === EDGE_WALK || !nav.walkable(sx, g, sz, nav.x[a], nav.y[a], nav.z[a])) { sx = nav.x[a]; sz = nav.z[a]; g = nav.y[a]; }
      painter.reset();
      const c = k === EDGE_CLIMB ? nav.climbs[nav.edgeClimb[e]] : null;
      if (c) for (let y = c.y0 + 0.3; y <= c.y1 + 0.2; y += 0.4) painter.splat(c.cx, y, c.cz, { radius: 0.9, team: 1, nx: c.nx, ny: 0, nz: c.nz, minFacing: 0.3, seed: 7 });
      p.respawn({ x: sx, y: g, z: sz, yaw: Math.atan2(ux, uz) });
      const r0 = p.respawns;
      let ok = false, jumped = false, topped = false;
      for (let t = 0; t < 180; t++) {
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
      res[k][ok ? 0 : 1]++;
      if (!ok && fails.length < 40) fails.push(`${KIND[k]} (${f2(nav.x[a])},${f2(nav.y[a])},${f2(nav.z[a])}) → (${f2(nav.x[b])},${f2(nav.y[b])},${f2(nav.z[b])}) ended (${f2(p.x)},${f2(p.y)},${f2(p.z)}) ${p.state}`);
    }
    const ms = performance.now() - t0;
    const line = [EDGE_WALK, EDGE_DROP, EDGE_JUMP, EDGE_CLIMB].map((k) => `${KIND[k]} ${res[k][0]}/${res[k][0] + res[k][1]}`).join(' · ');
    const okAll = res.reduce((a, v) => a + v[0], 0), all = res.reduce((a, v) => a + v[0] + v[1], 0);
    const rate = (k: number): number => res[k][0] / Math.max(1, res[k][0] + res[k][1]);
    check('the real Runner traverses the edges (≥ 97 % of each kind)', [0, 1, 2, 3].every((k) => rate(k) >= 0.97),
      `${line} · ${(okAll / all * 100).toFixed(1)} % of ${all} in ${(ms / 1000).toFixed(1)} s`);
    if (VERBOSE || fails.length) for (const f of fails.slice(0, VERBOSE ? 40 : 8)) console.log('      miss:', f);
  }

  console.log('-'.repeat(100));
  const failed = checks.filter((c) => !c.pass);
  console.log(failed.length ? `G8 nav: FAIL (${failed.length} of ${checks.length} checks)` : `G8 nav: PASS (${checks.length} checks)`);
  return failed.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.log('SETUP FAILED:', (e as Error).stack ?? e); process.exit(2); });
