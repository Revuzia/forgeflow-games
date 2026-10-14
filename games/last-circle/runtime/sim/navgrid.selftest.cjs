/**
 * Node self-test for sim/navgrid.js (Wave 6, lane 6D) - the baked layered navigation grid.
 * Run: node games/last-circle/runtime/sim/navgrid.selftest.cjs     (gate.py picks it up: it must stay under 20 s)
 * Exit 0 = all pass, exit 1 = a failure. Timings are INFORMATION lines (this box is shared and slow), never pass criteria,
 * except for a generous sanity ceiling that only a broken bake or search would hit.
 *
 * What it proves (everything on a SYNTHETIC town built in the exact collider shape maps.js mkCollider produces):
 *   1. the grid copies the mover: its constants equal sim/royale.js and the literals in player.js / bots.js, and its ramp rule is
 *      the sim's rampBlocks (checked on 20,000 random inputs);
 *   2. a 3-storey house + a street block: every room on every floor <-> street is reachable, and every returned route replays
 *      through the mover model leg by leg;
 *   3. a ramp edge is directional (a ramp is entered from its low edge or from above, never through its side), a drop edge only
 *      goes down, an island (sealed vault, a slab out of reach) is pruned;
 *   4. determinism: two bakes hash identically, tile content and routes do not depend on the order tiles were baked in, a collider
 *      killed after the world was made changes nothing;
 *   5. launch portals and deep water are obstacles.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const _m = require("./navgrid.js");
const NG = _m && _m.bakeTile ? _m : (globalThis.FFG && globalThis.FFG.sim && globalThis.FFG.sim.NavGrid);
if (!NG || typeof NG.bakeTile !== "function") { console.error("FAIL: could not load the NavGrid module"); process.exit(1); }
const _r = require("./royale.js");
const R = _r && _r.PLAYERK ? _r : (globalThis.FFG && globalThis.FFG.sim && globalThis.FFG.sim.Royale);
if (!R || !R.PLAYERK) { console.error("FAIL: could not load the Royale sim module"); process.exit(1); }

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  PASS  " + msg); }
  else { failed++; console.error("  FAIL  " + msg); }
}
function info(msg) { console.log("  INFO  " + msg); }
const T0 = Date.now();
const nowMs = () => Number(process.hrtime.bigint()) / 1e6;
function minOf(n, fn) { let best = Infinity; for (let i = 0; i < n; i++) { const t = nowMs(); fn(); const d = nowMs() - t; if (d < best) best = d; } return best; }

// ── 1. the mover is copied, not guessed ──────────────────────────────────────────────────────────────────────────────
{
  ok(NG.RADIUS === R.PLAYERK.radius && NG.HEIGHT === R.PLAYERK.height, "capsule = sim PLAYERK (r " + NG.RADIUS + ", h " + NG.HEIGHT + ")");
  ok(NG.GRAVITY === R.MOVE.gravity && Math.abs(NG.TICK - 1 / 60) < 1e-12, "gravity and the fixed tick = the sim's");
  ok(NG.RAMP_THICK === R.RAMP_THICK, "ramp slab thickness = sim RAMP_THICK");
  const root = path.join(__dirname, "..", "3d", "royale");
  let pj = null, bj = null;
  try { pj = fs.readFileSync(path.join(root, "player.js"), "utf8"); bj = fs.readFileSync(path.join(root, "bots.js"), "utf8"); } catch (e) { /* outside the repo: skip the source pins */ }
  if (pj) {
    const m1 = /const STEP_UP = ([0-9.]+);/.exec(pj);
    ok(m1 && +m1[1] === NG.STEP_UP, "STEP_UP = player.js literal (" + (m1 && m1[1]) + ")");
    const sup = /function supportIn\([^)]*\) \{[\s\S]*?\n\}/.exec(pj);
    const m2 = sup && /c\.minX - ([0-9.]+)/.exec(sup[0]);
    ok(m2 && +m2[1] === NG.SUP_MARGIN, "supportIn footprint margin = player.js literal (" + (m2 && m2[1]) + ")");
    ok(/K\.PLAYERK\.radius/.test(pj) && /function blockedIn\(/.test(pj) && /K\.rampBlocks\(c, x, z, yd, h, r, STEP_UP\)/.test(pj), "player.js blockedIn still calls the sim rampBlocks the way navgrid copies it");
  } else info("player.js not found next to this file: source pins skipped");
  if (bj) { const m3 = /const NAV_DROP_MAX = ([0-9.]+);/.exec(bj); ok(m3 && +m3[1] === NG.DROP_MAX, "DROP_MAX = bots.js NAV_DROP_MAX (" + (m3 && m3[1]) + ")"); }

  // the ramp rule: navgrid's transliteration equals the sim's, given the same constants, on random colliders and points
  let seed = 12345; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  let bad = 0, blockedN = 0, N = 20000;
  for (let t = 0; t < N; t++) {
    const dir = Math.floor(rnd() * 4), w = 1.2 + rnd() * 2, run = 2 + rnd() * 8, y0 = rnd() * 4, rise = 0.5 + rnd() * 5;
    const c = { kind: "ramp", minX: 0, maxX: dir < 2 ? run : w, minZ: 0, maxZ: dir < 2 ? w : run, minY: y0, maxY: y0 + rise, dir, prop: null, idx: -1, hp: 0, dead: false, _qs: 0 };
    const tile = NG.bakeTile([c], () => 0, { minX: -4, minZ: -4, maxX: 4, maxZ: 4 }, 2);
    const x = -1.5 + rnd() * (c.maxX + 3), z = -1.5 + rnd() * (c.maxZ + 3), yd = rnd() * 6, rad = 0.45 + rnd() * 0.3;
    const a = NG.rampBlocksT(tile, 0, x, z, yd, rad);
    const b = R.rampBlocks(c, x, z, yd, NG.HEIGHT_G, rad, NG.STEP_G);
    if (a !== b) bad++;
    if (a) blockedN++;
  }
  ok(bad === 0 && blockedN > 1000 && blockedN < N - 1000, "rampBlocks: navgrid = sim on " + N + " random cases (" + blockedN + " blocked, " + (N - blockedN) + " clear)");
}

// ── a synthetic town block ───────────────────────────────────────────────────────────────────────────────────────────
function mk(kind, minX, maxX, minY, maxY, minZ, maxZ, dir) { return { kind, minX, maxX, minY, maxY, minZ, maxZ, dir: dir == null ? -1 : dir, prop: null, idx: -1, hp: 0, dead: false, _qs: 0 }; }
function buildScene() {
  const cols = [];
  const box = (x0, x1, y0, y1, z0, z1) => cols.push(mk("box", x0, x1, y0, y1, z0, z1));
  const ramp = (x0, x1, y0, y1, z0, z1, dir) => cols.push(mk("ramp", x0, x1, y0, y1, z0, z1, dir));
  // a 3-storey house x 20..32, z 20..30: walls 0.4, storeys 3.6 m, slabs 0.3, a front door (1.4 m) on the south wall, a partition with a 1.4 m doorway
  const X0 = 20, X1 = 32, Z0 = 20, Z1 = 30, T = 0.4, FH = 3.6, SL = 0.3;
  for (let s = 0; s < 3; s++) {
    const y0 = s * FH, y1 = (s + 1) * FH - SL;
    box(X0 - T / 2, X0 + T / 2, y0, y1, Z0 - T / 2, Z1 + T / 2);
    if (s === 1) { box(X1 - T / 2, X1 + T / 2, y0, y1, Z0 - T / 2, 24.3); box(X1 - T / 2, X1 + T / 2, y0, y1, 25.7, Z1 + T / 2); box(X1 - T / 2, X1 + T / 2, y0 + 2.4, y1, 24.3, 25.7); }   // a door onto the balcony
    else box(X1 - T / 2, X1 + T / 2, y0, y1, Z0 - T / 2, Z1 + T / 2);
    box(X0 + T / 2, X1 - T / 2, y0, y1, Z0 - T / 2, Z0 + T / 2);
    if (s === 0) { box(X0 + T / 2, 28.3, y0, y1, Z1 - T / 2, Z1 + T / 2); box(29.7, X1 - T / 2, y0, y1, Z1 - T / 2, Z1 + T / 2); box(28.3, 29.7, 2.4, y1, Z1 - T / 2, Z1 + T / 2); }
    else box(X0 + T / 2, X1 - T / 2, y0, y1, Z1 - T / 2, Z1 + T / 2);
    box(26 - 0.15, 26 + 0.15, y0, y1, Z0 + T / 2, 24.3); box(26 - 0.15, 26 + 0.15, y0, y1, 25.7, Z1 - T / 2); box(26 - 0.15, 26 + 0.15, y0 + 2.4, y1, 24.3, 25.7);
  }
  ramp(22, 24.2, 0, FH, 21, 28.2, 2);                                  // stair 1: ground -> storey 2 (west room), rises toward +z
  const slab = (top, hx0, hx1, hz0, hz1) => {
    const y0 = top - SL;
    box(X0 + T / 2, hx0, y0, top, Z0 - T / 2, Z1 + T / 2); box(hx1, X1 - T / 2, y0, top, Z0 - T / 2, Z1 + T / 2);
    box(hx0, hx1, y0, top, Z0 - T / 2, hz0); box(hx0, hx1, y0, top, hz1, Z1 + T / 2);
  };
  slab(FH, 21.7, 24.5, 23.0, 28.4);
  ramp(28, 30.2, FH, 2 * FH, 21.6, 28.8, 3);                          // stair 2: storey 2 -> 3 (east room), rises toward -z
  slab(2 * FH, 27.7, 30.5, 22.0, 27.4);
  box(X0 - T / 2, X1 + T / 2, 3 * FH - SL, 3 * FH, Z0 - T / 2, Z1 + T / 2);   // roof
  box(X1 + T / 2, 34.5, FH - SL, FH, 23, 27);                          // a balcony, no rails, outside the storey-2 door
  box(40, 40.4, 0, 3, 20, 26); box(45.6, 46, 0, 3, 20, 26); box(40.4, 45.6, 0, 3, 20, 20.4); box(40.4, 45.6, 0, 3, 25.6, 26); box(40, 46, 3, 3.3, 20, 26);   // a sealed vault
  box(50, 54, 7.7, 8.0, 20, 24);                                       // a slab at 8 m that nothing leads to
  box(9.4, 10.6, 0, 1.0, 9.4, 10.6);                                   // a crate (a wall to the capsule)
  box(0, 64, 0, 0.3, 40, 40.3);                                        // a curb (stepped over)
  box(6, 6.3, 0, 3, 20, 26); box(11.7, 12, 0, 3, 20, 26);              // a shed with a door at each end
  box(6.3, 8.3, 0, 3, 20, 20.3); box(9.7, 11.7, 0, 3, 20, 20.3); box(8.3, 9.7, 2.4, 3, 20, 20.3);
  box(6.3, 8.3, 0, 3, 25.7, 26); box(9.7, 11.7, 0, 3, 25.7, 26); box(8.3, 9.7, 2.4, 3, 25.7, 26); box(5.8, 12.2, 3, 3.3, 19.8, 26.2);
  // a parking deck: a REACHABLE floor 7 m up with open edges (ramp x 44..46.2 rising toward -z from z 54 to z 38.2, deck z 30..38.2): its edges
  // are 7 m over the street, more than a bot may be sent off
  ramp(44, 46.2, 0, 7, 38.2, 54, 3); box(44, 52, 6.7, 7.0, 30, 38.2);
  // a landing beside a ramp's SIDE (x 52..56, top 1.5, level with the ramp at z 47.0): the ramp (x 56..58.2, z 44..52, rising +z to 4 m) is
  // 0.5 higher than the landing one node further up, a step that works at exact positions only
  ramp(56, 58.2, 0, 4, 44, 52, 2); box(52, 56, 1.2, 1.5, 46, 52);
  box(33.15, 33.45, 0, 3, 44, 60);                                     // a thin wall 1.2 m past the coarse tile border at x = 32
  return cols;
}
const flat = () => 0;
const cover = (tx, tz) => tx >= 0 && tx < 2 && tz >= 0 && tz < 2;
const scene = buildScene();
const world = () => NG.createWorld({ colliders: scene, heightFn: flat, cover });

/** replay a returned route through the mover model, leg by leg, each leg from the previous waypoint's own position */
function replayRoute(W, start, route) {
  let prev = start, drops = 0, ramps = 0;
  for (const w of route) {
    const T = NG.tileFor(W, prev.x, prev.z, true);
    const r = NG.hop(W, T, prev.x, prev.y, prev.z, w.x, w.z, NG.RADIUS);
    if (!r || Math.abs(r.y - w.y) > 0.35) return { ok: false, at: w };
    if (w.k === NG.EDGE_DROP) drops++;
    if (w.k === NG.EDGE_RAMP) ramps++;
    prev = w;
  }
  return { ok: true, drops, ramps };
}

// ── 2. every room <-> street, replayed ───────────────────────────────────────────────────────────────────────────────
const W1 = world();
const street = { x: 36.5, y: 0, z: 33 };
{
  ok(NG.tileFor(W1, 26, 25, true).kind === "fine" && W1.fine.length >= 5, "buildings found from the roof slabs: " + W1.fine.length + " fine tiles (house in chunks of at most 16 m, vault, 8 m slab, shed, parking deck)");
  for (const r of W1.fine) NG.tileFor(W1, (r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2, true);
  const houseTiles = NG.tiles(W1).filter((t) => t.kind === "fine" && t.maxX > 20 && t.minX < 32 && t.maxZ > 20 && t.minZ < 30);
  ok(houseTiles.length >= 2, "the 19 x 15 m house is baked as " + houseTiles.length + " stitched chunks");
  // every kept node of the house on a 2 m lattice = a room sample on every floor
  const rooms = [];
  for (const house of houseTiles) for (let i = 0; i < house.n; i++) {
    const x = house.x[i], z = house.z[i], y = house.y[i];
    if (x < 20.9 || x > 31.1 || z < 20.9 || z > 29.1 || y > 7.3) continue;
    if (x < house.minX + 0.2 || x >= house.maxX - 0.2) {}
    if (Math.abs(Math.round(x * 2) / 2 - x) > 0.3) continue;
    if ((Math.round(x * 2) % 4 !== 1) || (Math.round(z * 2) % 4 !== 1)) continue;
    rooms.push({ x, y, z });
  }
  const floors = new Set(rooms.map((r) => Math.round(r.y / 3.6)));
  ok(rooms.length >= 20 && floors.size === 3, "room samples: " + rooms.length + " points across " + floors.size + " floors");
  let inOk = 0, outOk = 0, replayOk = 0, lens = [];
  const qt = [];
  for (const r of rooms) {
    let t = nowMs();
    const pin = NG.findPath(W1, street.x, street.y, street.z, r.x, r.y, r.z);
    qt.push(nowMs() - t);
    t = nowMs();
    const pout = NG.findPath(W1, r.x, r.y, r.z, street.x, street.y, street.z);
    qt.push(nowMs() - t);
    const reach = (p, g) => p && p.length && Math.hypot(p[p.length - 1].x - g.x, p[p.length - 1].z - g.z) < 0.8 && Math.abs(p[p.length - 1].y - g.y) < 0.6;
    if (reach(pin, r)) { inOk++; const rr = replayRoute(W1, street, pin); if (rr.ok) replayOk++; lens.push(pin.length); }
    if (reach(pout, street)) { outOk++; const rr = replayRoute(W1, r, pout); if (rr.ok) replayOk++; }
  }
  ok(inOk === rooms.length, "street -> every room samples: " + inOk + " / " + rooms.length);
  ok(outOk === rooms.length, "every room -> street: " + outOk + " / " + rooms.length);
  ok(replayOk === inOk + outOk, "every route replays through the mover leg by leg: " + replayOk + " / " + (inOk + outOk));
  qt.sort((a, b) => a - b);
  info("warm route cost on this scene: median " + qt[qt.length >> 1].toFixed(2) + " ms, p90 " + qt[Math.floor(qt.length * 0.9)].toFixed(2) + " ms, max " + qt[qt.length - 1].toFixed(2) + " ms (" + qt.length + " queries; includes the first-use tile bakes)");
  ok(qt[Math.floor(qt.length * 0.9)] < 150, "route cost sanity: p90 under 150 ms even on a loaded box");
  // the third storey needs both stairs: ground -> storey 2 -> storey 3
  const top = rooms.filter((r) => r.y > 7);
  const p3 = top.length ? NG.findPath(W1, street.x, street.y, street.z, top[0].x, top[0].y, top[0].z) : null;
  const kinds = new Set((p3 || []).map((w) => w.k));
  ok(p3 !== null && kinds.has(NG.EDGE_RAMP) && p3[p3.length - 1].y > 7, "storey 3 route climbs ramps (kinds " + Array.from(kinds).join(",") + ")");
}

// ── 2b. a building cut into chunks: provisional seam nodes, islands settled across the seam, bakes independent of order ──────────
{
  const chunks = NG.tiles(W1).filter((t) => t.kind === "fine" && t.grp !== null);
  let prov = 0, isl = 0, islLow = 0;
  for (const T of chunks) for (let i = 0; i < T.n; i++) {
    if (T.flag[i] & NG.F_PROV) prov++;
    if (T.island && T.island[i] === 1) { isl++; if (T.y[i] < 9) islLow++; }
  }
  ok(chunks.length >= 4 && prov > 0, "split buildings keep seam-touching nodes provisionally: " + chunks.length + " chunks, " + prov + " F_PROV nodes");
  ok(isl > 0 && islLow === 0, "once settled, the only islands are the roof decks (" + isl + " nodes, " + islLow + " of them below 9 m)");
  let roof = null;
  for (const T of chunks) for (let i = 0; i < T.n && !roof; i++) if (T.y[i] > 10 && T.x[i] > 22 && T.x[i] < 30 && T.z[i] > 21 && T.z[i] < 29) roof = { x: T.x[i], y: T.y[i], z: T.z[i] };
  ok(roof !== null, "the house roof deck is baked (it touches the seam, so it was kept provisionally)");
  const exp0 = W1.stats.expanded;
  const pr = roof ? NG.findPath(W1, street.x, street.y, street.z, roof.x, roof.y, roof.z) : "no roof node to ask for";
  ok(pr === null && W1.lastFail === "no-goal" && W1.stats.expanded === exp0, "a roof nothing leads to is refused at once across the seam: " + W1.lastFail + ", " + (W1.stats.expanded - exp0) + " nodes expanded");

  // a COLD world asked for a top-storey room on the sibling's side first: the sibling is baked on demand, the group settled, the route found
  const rooms2 = [];
  for (const T of NG.tiles(W1)) if (T.kind === "fine") for (let i = 0; i < T.n; i++) {
    const x = T.x[i], z = T.z[i], y = T.y[i];
    if (x < 20.9 || x > 31.1 || z < 20.9 || z > 29.1 || y < 7 || y > 7.3 || x >= 26) continue;
    if ((Math.round(x * 2) % 4 !== 1) || (Math.round(z * 2) % 4 !== 1)) continue;
    rooms2.push({ x, y, z });
  }
  const Wc = world();
  const west = rooms2[0];
  const bakes0 = Wc.stats.bakes;
  const pw = west && NG.findPath(Wc, street.x, street.y, street.z, west.x, west.y, west.z);
  ok(rooms2.length > 0 && pw && pw.length > 0 && Wc.stats.resolved >= 1, "a cold world reaches a storey-3 room on the far chunk: route " + (pw ? pw.length : "none") + " waypoints, " + Wc.stats.resolved + " building(s) settled, " + (Wc.stats.bakes - bakes0) + " tiles baked on the way");
  // the chunks are pure bakes: the same chunk baked in a cold world hashes like the one in the warm world
  let same = 0, diff = 0;
  for (const T of NG.tiles(Wc)) { const U = NG.tiles(W1).find((q) => q.key === T.key); if (U) { if (U.hash === T.hash) same++; else diff++; } }
  ok(same > 0 && diff === 0, "a tile baked in a cold world hashes like the same tile in the warm one: " + same + " identical, " + diff + " different");
  // prewarm: a budget bakes a few tiles and says how many remain; calling again finishes; the result equals a one-shot prewarm
  const area = { minX: 0, maxX: 64, minZ: 0, maxZ: 64 };
  const Wp = world(), Wq = world();
  const one = NG.prewarm(Wp, area, 1e9);
  let calls = 0, done = false, totalBaked = 0;
  while (!done && calls < 400) { const r = NG.prewarm(Wq, area, 0); calls++; totalBaked += r.baked; done = r.remaining === 0; }
  ok(one.remaining === 0 && one.baked > 10 && done && calls > 5 && totalBaked === one.baked, "prewarm in slices: " + calls + " calls, " + totalBaked + " tiles; one shot " + one.baked + " tiles");
  ok(NG.worldHash(Wp) === NG.worldHash(Wq), "prewarm in slices and in one shot bake the same world (hash " + NG.worldHash(Wp) + ")");
  ok(Wp.groups.length > 0 && Wp.groups.every((g) => g.done) && Wq.groups.every((g) => g.done), "prewarm settles every fully baked building (" + Wp.groups.length + " split buildings)");
}

// ── 3. typed edges: directional ramp, downward drop, pruned islands ──────────────────────────────────────────────────
{
  let pairs = 0, reverseFound = 0, dropsUp = 0, drops = 0, rampOut = 0;
  const hasEdge = (T, a, b) => { for (let e = T.edgeStart[a]; e < T.edgeStart[a + 1]; e++) if (T.edgeTo[e] === b) return T.edgeKind[e]; return -1; };
  for (let t = 0; t < NG.tiles(W1).length; t++) {
    const T = NG.tiles(W1)[t];
    for (let a = 0; a < T.n; a++) for (let e = T.edgeStart[a]; e < T.edgeStart[a + 1]; e++) {
      const b = T.edgeTo[e], kd = T.edgeKind[e];
      if (kd === NG.EDGE_DROP) { drops++; if (!(T.y[b] < T.y[a] - 0.5)) dropsUp++; }
      if (kd === NG.EDGE_RAMP) rampOut++;
    }
  }
  ok(drops > 20 && dropsUp === 0, "drop edges only go down: " + drops + " drop edges, " + dropsUp + " that do not descend");
  let maxDrop = 0, sideClimbs = 0, nonRampToRamp = 0;
  for (const T of NG.tiles(W1)) for (let a = 0; a < T.n; a++) for (let e = T.edgeStart[a]; e < T.edgeStart[a + 1]; e++) {
    const b = T.edgeTo[e];
    if (T.edgeKind[e] === NG.EDGE_DROP && T.y[a] - T.y[b] > maxDrop) maxDrop = T.y[a] - T.y[b];
    if (!(T.flag[a] & NG.F_RAMP) && (T.flag[b] & NG.F_RAMP)) {
      // a floor stepping onto a ramp's RUN (not its foot or top end, the real entrances): only a level step
      const rp = scene.find((c) => c.kind === "ramp" && T.x[b] >= c.minX - 0.01 && T.x[b] <= c.maxX + 0.01 && T.z[b] >= c.minZ - 0.01 && T.z[b] <= c.maxZ + 0.01);
      if (rp && T.y[b] - rp.minY > 0.6 && rp.maxY - T.y[b] > 0.6) { nonRampToRamp++; if (T.y[b] - T.y[a] > 0.31) sideClimbs++; }
    }
  }
  const deckT = NG.tileFor(W1, 48, 34, true);
  let deckNodes = 0; for (let i = 0; i < deckT.n; i++) if (deckT.y[i] > 6.5 && deckT.y[i] < 7.2) deckNodes++;
  ok(deckNodes > 20, "the parking deck is a reachable floor (" + deckNodes + " nodes at 7 m)");
  ok(maxDrop > 2 && maxDrop <= NG.DROP_MAX + 0.01, "no drop edge is longer than " + NG.DROP_MAX + " m (longest " + maxDrop.toFixed(2) + " m; the deck's 7 m edges are not drops)");
  ok(nonRampToRamp >= 3 && sideClimbs === 0, "no floor steps onto a ramp's run higher than a level step (0.3 m): " + nonRampToRamp + " such edges, " + sideClimbs + " too high");
  ok(rampOut > 100, "ramp edges exist: " + rampOut);
  // a ramp node and a ground node beside its side: the walker may leave the ramp sideways (a drop) but never climb onto it from there
  for (const house of NG.tiles(W1)) for (let a = 0; a < house.n; a++) {
    if (!(house.flag[a] & NG.F_RAMP)) continue;
    for (let e = house.edgeStart[a]; e < house.edgeStart[a + 1]; e++) {
      const g = house.edgeTo[e];
      if (!(house.flag[g] & NG.F_TERR) || !(house.y[g] < house.y[a] - 0.9)) continue;
      pairs++;
      if (hasEdge(house, g, a) >= 0) reverseFound++;
    }
  }
  ok(pairs >= 2 && reverseFound === 0, "ramp side: " + pairs + " (ramp -> ground) drops from a ramp's side, " + reverseFound + " matching ground -> ramp climbs (must be 0: a ramp is entered from its low edge)");
  // the balcony: a drop gets you down in 3 waypoints, going up needs the whole house
  const down = NG.findPath(W1, 33.4, 3.6, 25, 36.5, 0, 25), up = NG.findPath(W1, 36.5, 0, 25, 33.4, 3.6, 25);
  ok(down && down.length <= 4 && down.some((w) => w.k === NG.EDGE_DROP), "balcony -> street is a short route with a drop (" + (down && down.length) + " waypoints)");
  ok(up && up.length > 10 && !up.some((w) => w.k === NG.EDGE_DROP && w.y > 3), "street -> balcony goes through the house, never up a 'drop' (" + (up && up.length) + " waypoints)");
  // islands
  const vault = NG.findPath(W1, 36.5, 0, 25, 43, 0, 23);
  ok(vault === null && W1.lastFail === "no-goal", "the sealed vault has no node (pruned): lastFail " + W1.lastFail);
  const plat = NG.findPath(W1, 36.5, 0, 25, 52, 8, 22);
  ok(plat === null && W1.lastFail === "no-goal", "the 8 m slab nothing leads to has no node (pruned): lastFail " + W1.lastFail);
  const vt = NG.tileFor(W1, 43, 23, true);
  const raw = NG.bakeTile(scene, flat, { minX: vt.minX, minZ: vt.minZ, maxX: vt.maxX, maxZ: vt.maxZ }, 0.5, { noPrune: true });
  const inVault = (T) => { let c = 0; for (let i = 0; i < T.n; i++) if (T.x[i] > 40.6 && T.x[i] < 45.4 && T.z[i] > 20.6 && T.z[i] < 25.4 && T.y[i] < 1) c++; return c; };
  ok(inVault(raw) > 20 && inVault(vt) === 0, "the vault floor exists before pruning (" + inVault(raw) + " nodes) and is gone after (" + inVault(vt) + ")");
  ok(vt.stats.pruned > 100, "islands pruned in that tile: " + vt.stats.pruned + " nodes (vault floor, its roof, the slab)");
  // the crate is a wall, the curb is stepped over
  const T0 = NG.tileFor(W1, 10, 10, true);
  ok(NG.walkSegment(W1, 6, 0, 10, 14, 10) === null, "walking through the 1 m crate: blocked");
  ok(NG.walkSegment(W1, 6, 0, 36, 6, 44) !== null, "stepping over the 0.3 m curb: walkable");
  ok(NG.walkSegment(W1, 36.5, 0, 25, 38, 25) !== null && NG.walkSegment(W1, 29, 0, 31.5, 29, 28) !== null, "street and the front door: walkable");
  ok(NG.walkSegment(W1, 33.4, 3.6, 25, 36.5, 25) === null, "walking off the balcony: not a walk (it is a fall)");
  ok(T0 && T0.kind === "coarse", "outdoor tiles are the coarse lattice (" + T0.cell.toFixed(2) + " m cells), buildings the fine one (" + NG.tileFor(W1, 26, 25, true).cell + " m); no building tile is longer than 16 m: " + NG.tiles(W1).filter((t) => t.kind === "fine").every((t) => t.maxX - t.minX <= 16.01 && t.maxZ - t.minZ <= 16.01));
}

// ── tile seams: a wall just past a tile border ────────────────────────────────────────────────────
{
  const Wn = world();
  const a = NG.tileFor(Wn, 20, 50, true), b = NG.tileFor(Wn, 40, 50, true);
  ok(a !== b && a.kind === "coarse" && b.kind === "coarse", "the seam test spans two coarse tiles");
  // stitch both and cross-check: no external edge may run through the wall (x 33.15..33.45, z 44..60)
  for (const [x, z] of [[31.5, 50], [35, 50], [36, 46]]) NG.snapNodes(Wn, x, 0, z, 1.5, 2.6);
  let ext = 0, through = 0;
  for (const T of NG.tiles(Wn)) {
    if (!T.extTo) continue;
    for (let n = 0; n < T.n; n++) for (let e = T.extStart[n]; e < T.extStart[n + 1]; e++) {
      ext++;
      const g = T.extTo[e], U = Wn.slots[Math.floor(g / NG.STRIDE)], m = g % NG.STRIDE;
      const x0 = T.x[n], x1 = U.x[m], z0 = T.z[n], z1 = U.z[m];
      if (Math.min(x0, x1) < 33.1 && Math.max(x0, x1) > 33.5 && Math.max(z0, z1) > 44 && Math.min(z0, z1) < 60) through++;
    }
  }
  ok(ext > 50 && through === 0, "stitched tile edges: " + ext + " across seams, " + through + " run through the wall 1.2 m past the border");
  const around = NG.findPath(Wn, 29, 0, 52, 38, 0, 52);
  ok(around && around.length >= 3 && around.some((w) => w.z < 44.5 || w.z > 60.5), "a route around the 16 m wall exists and detours (" + (around ? around.length : 0) + " waypoints)");
  ok(NG.walkSegment(Wn, 32, 0, 52, 36, 52) === null, "walking straight through it: blocked");
}

// ── 4. determinism ───────────────────────────────────────────────────────────────────────────────────────────────────
{
  const rect = { minX: 17.5, minZ: 17.5, maxX: 36.5, maxZ: 32.5 };
  const a = NG.bakeTile(scene, flat, rect, 0.5), b = NG.bakeTile(scene, flat, rect, 0.5);
  ok(a.hash === b.hash && a.n === b.n && a.edgeTo.length === b.edgeTo.length, "two bakes of one rect hash identically (" + a.hash + ", " + a.n + " nodes, " + a.edgeTo.length + " edges)");
  const c = NG.bakeTile(scene.slice().reverse(), flat, rect, 0.5);
  ok(c.n === a.n && c.edgeTo.length === a.edgeTo.length, "collider list order does not change the node/edge counts (" + c.n + " / " + c.edgeTo.length + ")");
  // two worlds, queries in opposite orders: same tiles by key, same hashes, same routes
  const qs = [[36.5, 0, 33, 22, 0, 22], [36.5, 0, 33, 29, 3.6, 24.5], [9, 0, 30, 36.5, 0, 25], [33.4, 3.6, 25, 36.5, 0, 25], [36.5, 0, 25, 9, 0, 23]];
  const wa = world(), wb = world();
  const ra = qs.map((q) => NG.findPath(wa, ...q));
  const rb = qs.slice().reverse().map((q) => NG.findPath(wb, ...q)).reverse();
  const same = ra.every((p, i) => JSON.stringify(p) === JSON.stringify(rb[i]));
  ok(same, "the same routes come back whatever order the queries (and so the tile bakes) happened in");
  const ha = {}; for (const t of NG.tiles(wa)) ha[t.key] = t.hash;
  let common = 0, differ = 0; for (const t of NG.tiles(wb)) if (ha[t.key] !== undefined) { common++; if (ha[t.key] !== t.hash) differ++; }
  ok(common >= 3 && differ === 0, "tiles baked in different orders are identical: " + common + " common tiles, " + differ + " differ");
  // a collider that dies after the world exists changes nothing (the set is a snapshot)
  const sc2 = buildScene(), w2 = NG.createWorld({ colliders: sc2, heightFn: flat, cover });
  const before = NG.findPath(w2, 36.5, 0, 33, 22, 0, 22);
  sc2[5].dead = true; sc2[6].dead = true; sc2[7].dead = true;
  const w3 = NG.createWorld({ colliders: sc2, heightFn: flat, cover });
  const after = NG.findPath(w2, 36.5, 0, 33, 22, 0, 22);
  ok(JSON.stringify(before) === JSON.stringify(after), "a collider killed after createWorld does not change its routes (snapshot)");
  ok(NG.tileFor(w3, 26, 25, true).hash !== NG.tileFor(w2, 26, 25, true).hash, "a world created after the kill sees it (dead colliders are left out at creation)");
}

// ── 4b. a flat leg over a floor that dips under the feet is not a walk ─────────────────────────────────────────────────
{
  // two 4 x 4 m decks 1 m over the flat terrain with a gap between them (low enough that the ground under the gap is not a big fall). The 0.3 m support margins close 0.6 m of it.
  // A 1.0 m gap is a stride; a 1.6 m gap is one a full-speed replay still crosses (it dips about 0.3 m, then catches the far lip) but a
  // walker that starts from rest falls into: legOk and evalEdge refuse such a leg, and walkSegment now does too.
  const dk = (x0, x1) => mk("box", x0, x1, 0.7, 1.0, 0, 4);
  const wn = NG.createWorld({ colliders: [dk(0, 4), dk(5.0, 9)], heightFn: flat, cover: () => true });
  const wd = NG.createWorld({ colliders: [dk(0, 4), dk(5.6, 9.6)], heightFn: flat, cover: () => true });
  const narrow = NG.walkSegment(wn, 3.5, 1.0, 2, 5.8, 2), wide = NG.walkSegment(wd, 3.5, 1.0, 2, 6.4, 2);
  const h = NG.hop(wd, NG.tileFor(wd, 3.5, 2, true), 3.5, 1.0, 2, 6.4, 2, NG.RADIUS);
  ok(narrow !== null && Math.abs(narrow.y - 1.0) < 0.05, "a 1.0 m gap between decks: walkable");
  ok(h !== null && Math.abs(h.y - 1.0) < 0.05 && h.yMin < 1.0 - 0.2, "a 1.6 m gap: the full-speed replay does land on the far deck, after dipping to " + (h && h.yMin.toFixed(2)));
  ok(wide === null, "a 1.6 m gap: still not a walk (the dip rule: flat deck leg, floor under the feet drops 0.2 m or more)");
}

// ── 5. portals and water are obstacles ───────────────────────────────────────────────────────────────────────────────
{
  const wp = NG.createWorld({ colliders: [], heightFn: flat, portals: [{ x: 20, y: 0, z: 20 }], cover: () => true });
  ok(NG.walkSegment(wp, 14, 0, 20, 26, 20) === null && NG.walkSegment(wp, 14, 0, 24, 26, 24) !== null, "a launch portal blocks the line through it, a line 4 m beside it is free");
  const near = NG.snapNodes(wp, 20, 0, 20, 1.5, 1.0);
  ok(near.length === 0, "no node stands inside a launch portal's 1.7 m disc");
  const basin = (x, z) => -Math.max(0, 6 - Math.hypot(x - 40, z - 40)) * 0.6;           // a lake 6 m wide: terrain to -3.6 m, the water at 0
  const ww = NG.createWorld({ colliders: [], heightFn: basin, waterY: 0, cover: () => true });
  ok(NG.walkSegment(ww, 30, 0, 40, 50, 40) === null, "walking across deep water: no (the mover swims there)");
  ok(NG.walkSegment(ww, 30, 0, 40, 33, 40) !== null, "walking on the shore: yes");
  const wt = NG.tileFor(ww, 40, 40, true);
  let deepNodes = 0; for (let i = 0; i < wt.n; i++) if (basin(wt.x[i], wt.z[i]) < -1.1) deepNodes++;
  ok(deepNodes === 0, "no node below the swim depth: " + deepNodes);
}

// ── information: the bake and the query on this box ─────────────────────────────────────────────────────────────────
{
  const rect = { minX: 17.5, minZ: 17.5, maxX: 36.5, maxZ: 32.5 };
  const hBake = minOf(5, () => NG.bakeTile(scene, flat, rect, 0.5));
  const cBake = minOf(5, () => NG.bakeTile(scene, flat, { minX: 0, minZ: 0, maxX: 32, maxZ: 32 }, 1.5));
  const t = NG.bakeTile(scene, flat, rect, 0.5);
  info("bake, min of 5: the 3-storey house tile (" + t.stats.cells + " cells, " + t.n + " nodes, " + t.edgeTo.length + " edges, " + (t.stats.bytes / 1024).toFixed(0) + " KB) " + hBake.toFixed(1) + " ms; an outdoor 32 m tile " + cBake.toFixed(1) + " ms (target <= 8 ms is information)");
  ok(hBake < 3000 && cBake < 1000, "bake sanity ceiling (3 s house tile, 1 s street tile)");
  const wq = world(); for (let i = 0; i < 3; i++) NG.findPath(wq, 36.5, 0, 33, 22, 0, 22);
  const qm = minOf(15, () => NG.findPath(wq, 36.5, 0, 33, 22, 0, 22));
  const qf = minOf(15, () => NG.findPath(wq, 36.5, 0, 33, 22, 7.2, 22));
  info("warm query, min of 15: street -> ground room " + (qm * 1000).toFixed(0) + " us, street -> storey 3 " + (qf * 1000).toFixed(0) + " us (today's planner: 3.7-16.9 ms)");
  ok(qm < 100 && qf < 100, "query sanity ceiling (100 ms)");
}

console.log("\n" + passed + " passed, " + failed + " failed  (" + ((Date.now() - T0) / 1000).toFixed(1) + " s)");
process.exit(failed ? 1 : 0);
