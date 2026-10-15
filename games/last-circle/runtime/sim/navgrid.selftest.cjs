/**
 * Node self-test for sim/navgrid.js (Wave 6, lane 6D; Wave 7, lane 7B1) - the baked layered navigation grid.
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
 *   5. launch portals and deep water are obstacles;
 *   6. (Wave 7) the hairlines: 6 pinned segments from the 360,000-segment comparison against the real mover (the grid walked, the mover did not),
 *      the water jump, a NaN ground, the tile-bake cascade, the plain / implicit / stored edges all replay, bakeTown (budgeted steps = one shot),
 *      a fresh process hashes the same world, and, when the harness environment is there, bakeTown over the real Savanna.
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
  ok(NG.ACCEL_T === R.MOVE.accelT && NG.HOP_SPEED === R.MOVE.walk, "the from-rest replay uses the sim's acceleration (accelT " + NG.ACCEL_T + ", walk " + NG.HOP_SPEED + ")");
  ok(NG.VERSION === 2, "C-NAV version 2");
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
/** the world hash of a prewarmed town and the routes of four queries, folded into one string: a fresh process must print the same */
function townSignature() {
  const Wt = world();
  NG.prewarm(Wt, { minX: 0, maxX: 64, minZ: 0, maxZ: 64 }, 1e9);
  const qs = [[36.5, 0, 33, 22, 0, 22], [36.5, 0, 33, 29, 3.6, 24.5], [9, 0, 30, 36.5, 0, 25], [33.4, 3.6, 25, 36.5, 0, 25]];
  let h = 0x811c9dc5 | 0;
  for (const q of qs) { const str = JSON.stringify(NG.findPath(Wt, ...q)); for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } }
  return NG.worldHash(Wt) + ":" + (h >>> 0).toString(16);
}
if (process.argv.includes("--child")) { console.log(townSignature()); process.exit(0); }

/** the kept node nearest (x, z) within maxD whose height is within maxDy of y, over a list of tiles: { x, y, z } or null */
function nearestNode(tiles, x, z, y, maxD, maxDy) {
  let best = null, bd = maxD * maxD;
  for (const T of tiles) {
    if (x < T.minX - maxD || x > T.maxX + maxD || z < T.minZ - maxD || z > T.maxZ + maxD) continue;
    for (let i = 0; i < T.n; i++) {
      if (Math.abs(T.y[i] - y) > maxDy) continue;
      const d = (T.x[i] - x) * (T.x[i] - x) + (T.z[i] - z) * (T.z[i] - z);
      if (d < bd) { bd = d; best = { x: T.x[i], y: T.y[i], z: T.z[i] }; }
    }
  }
  return best;
}

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
  // the nearest kept node of the house to every point of a 2 m lattice, on each of the three floors = the room samples
  const rooms = [];
  const seen = new Set();
  for (const fy of [0, 3.6, 7.2]) for (let px = 21.5; px < 31; px += 2) for (let pz = 21.5; pz < 29.5; pz += 2) {
    const n = nearestNode(houseTiles, px, pz, fy, 0.6, 0.45);
    if (n && !seen.has(n.x + "," + n.y + "," + n.z)) { seen.add(n.x + "," + n.y + "," + n.z); rooms.push(n); }
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
  for (let px = 21.5; px < 26; px += 2) for (let pz = 21.5; pz < 29.5; pz += 2) { const n = nearestNode(NG.tiles(W1).filter((t) => t.kind === "fine"), px, pz, 7.2, 0.6, 0.45); if (n) rooms2.push(n); }
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
  const raw = NG.bakeTile(scene, flat, { minX: vt.minX, minZ: vt.minZ, maxX: vt.maxX, maxZ: vt.maxZ }, W1.cellIndoor, { noPrune: true });
  const inVault = (T) => { let c = 0; for (let i = 0; i < T.n; i++) if (T.x[i] > 40.6 && T.x[i] < 45.4 && T.z[i] > 20.6 && T.z[i] < 25.4 && T.y[i] < 1) c++; return c; };
  ok(inVault(raw) > 12 && inVault(vt) === 0, "the vault floor exists before pruning (" + inVault(raw) + " nodes) and is gone after (" + inVault(vt) + ")");
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
  const a = NG.tileFor(Wn, 20, 50, true), b = NG.tileFor(Wn, 35, 50, true);
  ok(a !== b && a.kind === "coarse" && b.kind === "coarse", "the seam test spans two coarse tiles");
  // a bake does not stitch (stitching can bake more tiles): before a link, neither tile has a link edge
  ok(!a.extTo && !b.extTo && Wn.slots.length <= 3, "tiles bake bare: " + Wn.slots.length + " tiles after asking for two points, no link edges yet");
  // stitch the area and cross-check: no external edge may run through the wall (x 33.15..33.45, z 44..60)
  NG.prewarm(Wn, { minX: 16, maxX: 48, minZ: 40, maxZ: 64 }, 1e9);
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
  const around = NG.findPath(Wn, 29, 0, 52, 35.5, 0, 52);
  ok(around && around.length >= 3 && around.some((w) => w.z < 44.5 || w.z > 60.5), "a route around the 16 m wall exists and detours (" + (around ? around.length : 0) + " waypoints)");
  ok(NG.walkSegment(Wn, 32, 0, 52, 35.5, 52) === null, "walking straight through it: blocked");
}

// ── 4. determinism ───────────────────────────────────────────────────────────────────────────────────────────────────
{
  const rect = { minX: 17.5, minZ: 17.5, maxX: 36.5, maxZ: 32.5 };
  const a = NG.bakeTile(scene, flat, rect, 0.75), b = NG.bakeTile(scene, flat, rect, 0.75);
  ok(a.hash === b.hash && a.n === b.n && a.edgeTo.length === b.edgeTo.length, "two bakes of one rect hash identically (" + a.hash + ", " + a.n + " nodes, " + a.edgeTo.length + " edges)");
  const c = NG.bakeTile(scene.slice().reverse(), flat, rect, 0.75);
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
  {
    // a 1.3 m gap: the full-speed replay crosses it with a 0.17 m dip (under the 0.2 m dip rule), the walker that starts from a standstill falls into it: only the from-rest replay refuses
    const w13 = NG.createWorld({ colliders: [dk(0, 4), dk(5.3, 9.3)], heightFn: flat, cover: () => true });
    const h13 = NG.hop(w13, NG.tileFor(w13, 3.5, 2, true), 3.5, 1.0, 2, 5.9, 2, NG.RADIUS);
    ok(h13 !== null && h13.yMin > 1.0 - 0.2 && NG.walkSegment(w13, 3.5, 1.0, 2, 5.9, 2) === null, "a 1.3 m gap: the full-speed replay crosses it (dip " + (h13 && (1.0 - h13.yMin).toFixed(2)) + " m, under the dip rule), the walk from a standstill does not -> not a walk");
  }
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

// ── 6. Wave 7: the hairlines the real mover found ────────────────────────────────────────────────────────────────────
// Six segments from a 360,000-segment comparison of walkSegment against the REAL mover (player.js stepActor, 6 seeds x 3 maps, 20,000 random segments
// each) that the Wave-6 grid called walkable and the mover did not, plus one the grid walked on the wrong floor. The colliders are the real ones
// around each segment (full precision) over flat ground. Every one is a mover hairline: the nominal full-speed replay still walks it (that is what
// went wrong), the answer now has to hold from a standstill and when the walker stops 6 cm early.
const PINNED = {
  ledge_stair_side_isla404: { a: [-77.25,6.945272922515869,317.75], b: [-82.62274077372848,309.4886622649762], ground: 3.0519, cols: [
    [0,-86.75652840905768,-80.65652840905769,3.051886558532715,7.051886558532715,319.9112031791731,320.3112031791731,-1],
    [0,-78.85652840905767,-72.75652840905768,3.051886558532715,7.051886558532715,319.9112031791731,320.3112031791731,-1],
    [0,-80.65652840905769,-78.85652840905767,6.051886558532715,7.051886558532715,319.9112031791731,320.3112031791731,-1],
    [0,-86.75652840905768,-72.75652840905768,3.051886558532715,7.051886558532715,305.9112031791731,306.3112031791731,-1],
    [0,-86.95652840905768,-86.55652840905768,3.051886558532715,7.051886558532715,306.1112031791731,320.1112031791731,-1],
    [1,-77.35652840905767,-75.15652840905769,3.051886558532715,7.051886558532715,308.21120317917314,318.0112031791731,2],
    [0,-86.75652840905768,-77.85652840905767,7.051886558532715,7.3518865585327156,306.1112031791731,320.1112031791731,-1],
    [0,-74.65652840905769,-72.75652840905768,7.051886558532715,7.3518865585327156,306.1112031791731,320.1112031791731,-1],
    [0,-77.85652840905767,-74.65652840905769,7.051886558532715,7.3518865585327156,306.1112031791731,312.1312031791731,-1],
    [0,-77.85652840905767,-74.65652840905769,7.051886558532715,7.3518865585327156,318.5012031791731,320.1112031791731,-1],
    [0,-86.75652840905768,-72.75652840905768,7.051886558532715,8.451886558532715,319.9112031791731,320.3112031791731,-1],
    [0,-86.75652840905768,-72.75652840905768,9.551886558532715,11.051886558532715,319.9112031791731,320.3112031791731,-1],
    [0,-86.75652840905768,-72.75652840905768,7.051886558532715,8.451886558532715,305.9112031791731,306.3112031791731,-1],
    [0,-86.75652840905768,-72.75652840905768,9.551886558532715,11.051886558532715,305.9112031791731,306.3112031791731,-1],
    [0,-86.95652840905768,-86.55652840905768,7.051886558532715,8.451886558532715,306.1112031791731,320.1112031791731,-1],
    [0,-86.95652840905768,-86.55652840905768,9.551886558532715,11.051886558532715,306.1112031791731,320.1112031791731,-1],
    [0,-86.75652840905768,-72.75652840905768,11.051886558532715,11.351886558532716,306.1112031791731,320.1112031791731,-1],
    [0,-86.75652840905768,-72.75652840905768,11.201886558532713,12.301886558532715,319.7362031791731,320.08620317917314,-1],
    [0,-86.75652840905768,-72.75652840905768,11.201886558532713,12.301886558532715,306.1362031791731,306.4862031791731,-1],
  ] },
  stair_top_rail_ashgrid8675: { a: [13.25,15.594969749450684,58.25], b: [11.552186406320663,52.629945369078406], ground: 3.6277, cols: [
    [0,7.69351803181402,12.4551667038881,3.6299591064453125,7.6299591064453125,60.145755640645746,60.54575564064575,-1],
    [0,5.893518031814021,7.693518031814022,6.6299591064453125,7.6299591064453125,60.145755640645746,60.54575564064575,-1],
    [0,1.1318693597399418,12.4551667038881,3.6299591064453125,7.6299591064453125,48.82245829649759,49.22245829649759,-1],
    [0,12.2551667038881,12.6551667038881,3.6299591064453125,7.6299591064453125,49.02245829649759,60.34575564064575,-1],
    [1,8.52434236785106,10.72434236785106,3.6299591064453125,7.6299591064453125,50.72095289811981,58.647261039023526,2],
    [0,1.1318693597399423,8.02434236785106,7.6299591064453125,7.929959106445313,49.02245829649759,60.34575564064575,-1],
    [0,11.224342367851062,12.4551667038881,7.6299591064453125,7.929959106445313,49.02245829649759,60.34575564064575,-1],
    [0,8.02434236785106,11.22434236785106,7.6299591064453125,7.929959106445313,49.02245829649759,53.698230401062446,-1],
    [0,8.02434236785106,11.22434236785106,7.6299591064453125,7.929959106445313,59.04357644606871,60.34575564064575,-1],
    [0,1.1318693597399418,12.4551667038881,7.629959106445312,9.029959106445311,60.145755640645746,60.54575564064575,-1],
    [0,1.1318693597399418,12.4551667038881,10.129959106445312,11.629959106445312,60.145755640645746,60.54575564064575,-1],
    [0,1.1318693597399418,12.4551667038881,7.629959106445312,9.029959106445311,48.82245829649759,49.22245829649759,-1],
    [0,1.1318693597399418,12.4551667038881,10.129959106445312,11.629959106445312,48.82245829649759,49.22245829649759,-1],
    [0,12.2551667038881,12.6551667038881,7.629959106445312,9.029959106445311,49.02245829649759,60.34575564064575,-1],
    [0,12.2551667038881,12.6551667038881,10.129959106445312,11.629959106445312,49.02245829649759,60.34575564064575,-1],
    [0,5.562693695776982,12.4551667038881,11.629959106445312,11.929959106445313,49.02245829649759,60.34575564064575,-1],
    [0,1.1318693597399418,12.4551667038881,11.629959106445312,13.029959106445311,60.145755640645746,60.54575564064575,-1],
    [0,1.1318693597399418,12.4551667038881,14.129959106445312,15.629959106445312,60.145755640645746,60.54575564064575,-1],
    [0,1.1318693597399418,12.4551667038881,11.629959106445312,13.029959106445311,48.82245829649759,49.22245829649759,-1],
    [0,1.1318693597399418,12.4551667038881,14.129959106445312,15.629959106445312,48.82245829649759,49.22245829649759,-1],
    [0,12.2551667038881,12.6551667038881,11.629959106445312,13.029959106445311,49.02245829649759,60.34575564064575,-1],
    [0,12.2551667038881,12.6551667038881,14.129959106445312,15.629959106445312,49.02245829649759,60.34575564064575,-1],
    [0,1.1318693597399418,12.4551667038881,15.629959106445312,15.929959106445313,49.02245829649759,60.34575564064575,-1],
    [0,1.1318693597399418,12.4551667038881,15.779959106445311,16.879959106445312,59.97075564064575,60.32075564064574,-1],
    [0,1.1318693597399418,12.4551667038881,15.779959106445311,16.879959106445312,49.047458296497595,49.39745829649759,-1],
    [1,12.505166703888102,14.705166703888102,3.6567526164568696,16.079959106445312,46.04675564064575,58.74575564064575,2],
  ] },
  ramp_margin_entry_deepwood303: { a: [-569.25,30.00344467163086,653.25], b: [-570.6379114823058,651.4053135722557], ground: 23.7322, cols: [
    [1,-569.5727870296687,-567.9727870296688,24.353445053100586,30.003445053100585,646.2159748464823,652.2969482978098,2],
    [0,-571.5727870296687,-567.7727870296687,29.703445053100587,30.003445053100585,652.2159748464823,655.3159748464822,-1],
    [0,-571.5727870296687,-571.2727870296687,23.444816903438397,29.703445053100584,654.9659748464823,655.2659748464822,-1],
    [0,-568.0727870296687,-567.7727870296687,23.564371180031408,29.703445053100587,654.9659748464823,655.2659748464822,-1],
    [1,-571.3727870296686,-569.7727870296687,30.003445053100585,35.65344505310058,645.4580102447125,653.7159748464823,3],
  ] },
  end_on_ramp_margin_ashgrid101: { a: [-10.25,7.675053119659424,-56.75], b: [-11.789345480227045,-57.14302285889058], ground: 3.1421, cols: [
    [0,-13.289728021142345,-8.324318469488333,3.1421072483062744,7.142107248306274,-54.09629615855117,-53.696296158551164,-1],
    [0,-6.524318469488333,-1.558908917834322,3.1421072483062744,7.142107248306274,-54.09629615855117,-53.696296158551164,-1],
    [0,-8.324318469488333,-6.524318469488333,6.142107248306274,7.142107248306274,-54.09629615855117,-53.696296158551164,-1],
    [0,-13.489728021142344,-13.089728021142346,3.1421072483062744,7.142107248306274,-65.62711526185919,-53.896296158551166,-1],
    [0,-13.289728021142345,-6.091613693661329,7.142107248306274,7.442107248306275,-65.62711526185919,-53.896296158551166,-1],
    [0,-13.289728021142345,-1.558908917834322,7.142107248306274,8.542107248306275,-54.09629615855117,-53.696296158551164,-1],
    [0,-13.289728021142345,-1.558908917834322,9.642107248306274,11.142107248306274,-54.09629615855117,-53.696296158551164,-1],
    [0,-13.489728021142344,-13.089728021142346,7.142107248306274,8.542107248306275,-65.62711526185919,-53.896296158551166,-1],
    [0,-13.489728021142344,-13.089728021142346,9.642107248306274,11.142107248306274,-65.62711526185919,-53.896296158551166,-1],
    [1,-11.457023245315339,-9.25702324531534,7.142107248306274,11.142107248306274,-63.867492396362984,-55.65591902404737,3],
    [0,-13.289728021142345,-11.95702324531534,11.142107248306274,11.442107248306275,-65.62711526185919,-53.896296158551166,-1],
    [0,-8.75702324531534,-1.5589089178343216,11.142107248306274,11.442107248306275,-65.62711526185919,-53.896296158551166,-1],
    [0,-11.957023245315339,-8.75702324531534,11.142107248306274,11.442107248306275,-58.80846069252186,-53.896296158551166,-1],
    [0,-13.289728021142345,-1.558908917834322,11.142107248306274,12.542107248306273,-54.09629615855117,-53.696296158551164,-1],
    [0,-13.289728021142345,-1.558908917834322,13.642107248306274,15.142107248306274,-54.09629615855117,-53.696296158551164,-1],
    [0,-13.489728021142344,-13.089728021142346,11.142107248306274,12.542107248306273,-65.62711526185919,-53.896296158551166,-1],
    [0,-13.489728021142344,-13.089728021142346,13.642107248306274,15.142107248306274,-65.62711526185919,-53.896296158551166,-1],
    [0,-13.289728021142345,-6.091613693661329,15.142107248306274,15.442107248306275,-65.62711526185919,-53.896296158551166,-1],
    [0,-13.289728021142345,-1.558908917834322,15.142107248306274,16.542107248306273,-54.09629615855117,-53.696296158551164,-1],
    [0,-13.289728021142345,-1.558908917834322,17.642107248306274,19.142107248306274,-54.09629615855117,-53.696296158551164,-1],
    [0,-13.489728021142344,-13.089728021142346,15.142107248306274,16.542107248306273,-65.62711526185919,-53.896296158551166,-1],
    [0,-13.489728021142344,-13.089728021142346,17.642107248306274,19.142107248306274,-65.62711526185919,-53.896296158551166,-1],
    [0,-13.289728021142345,-1.558908917834322,19.142107248306274,19.44210724830627,-65.62711526185919,-53.896296158551166,-1],
    [0,-13.289728021142345,-1.558908917834322,19.292107248306273,20.392107248306274,-54.271296158551166,-53.92129615855117,-1],
  ] },
  end_on_ramp_margin_deepwood555: { a: [346.75,17.797290802001953,-36.9375], b: [346.8137227060488,-36.393286759246344], ground: 11.8843, cols: [
    [1,346,347.6,12.998333463668821,18.650864272117616,-42.1,-36.019264281493896,2],
    [0,344,347.79999999999995,18.35086427211762,18.650864272117616,-36.1,-33.00000000000001,-1],
    [0,344,344.29999999999995,11.112681753158558,18.350864272117615,-33.35,-33.050000000000004,-1],
    [0,347.5,347.79999999999995,11.263919652938835,18.350864272117615,-33.35,-33.050000000000004,-1],
    [1,344.2,345.8,18.650864272117616,24.303395080566407,-42.85764762467482,-34.6,3],
  ] },
  step_0538_ashgrid9004: { a: [382.75,16.211610794067383,80.25], b: [384.4801675232963,79.70225585550457], ground: 7.0874, cols: [
    [0,354,386,15.01161003112793,16.21161003112793,75.5,84.5,-1],
    [0,384,416,15.546612262725832,16.746612262725833,75.5,84.5,-1],
  ] },
};

const mkc = (k) => ({ kind: k[0] ? "ramp" : "box", minX: k[1], maxX: k[2], minY: k[3], maxY: k[4], minZ: k[5], maxZ: k[6], dir: k[7], prop: null, idx: -1, hp: 0, dead: false, _qs: 0 });
{
  const wsOf = (c) => {
    const W = NG.createWorld({ colliders: c.cols.map(mkc), heightFn: () => c.ground, cover: () => true });
    const T = NG.tileFor(W, c.a[0], c.a[2], true);
    return { nominal: NG.hop(W, T, c.a[0], c.a[1], c.a[2], c.b[0], c.b[1], NG.RADIUS), ws: NG.walkSegment(W, c.a[0], c.a[1], c.a[2], c.b[0], c.b[1]) };
  };
  let nominalWalks = 0;
  for (const id of ["ledge_stair_side_isla404", "stair_top_rail_ashgrid8675", "ramp_margin_entry_deepwood303"]) {
    const r = wsOf(PINNED[id]);
    if (r.nominal !== null) nominalWalks++;
    ok(r.ws === null, id + ": a walker falling past a stair side / lifting onto a ramp margin is not a walk (the full-speed replay alone " + (r.nominal ? "walks it to y " + r.nominal.y.toFixed(2) : "is stopped too") + ")");
  }
  for (const id of ["end_on_ramp_margin_ashgrid101", "end_on_ramp_margin_deepwood555"]) {
    const r = wsOf(PINNED[id]);
    if (r.nominal !== null) nominalWalks++;
    ok(r.nominal !== null && r.ws === null, id + ": it ends within 6 cm of a floor change (the walker may stop on either floor) -> not a walk");
  }
  ok(nominalWalks >= 4, "the plain full-speed replay still walks " + nominalWalks + " of these 5 (the Wave-6 answer; the new rules are what refuse them)");
  {
    // the same two ends, 25 cm beyond the hairline: a walk again (the new rules refuse the hairline, not the neighbourhood)
    const c = PINNED.end_on_ramp_margin_ashgrid101, W = NG.createWorld({ colliders: c.cols.map(mkc), heightFn: () => c.ground, cover: () => true });
    const far = NG.walkSegment(W, c.a[0], c.a[1], c.a[2], c.b[0] - 0.25, c.b[1]);
    ok(far !== null && far.y < c.a[1] - 0.1, "end_on_ramp_margin_ashgrid101: 25 cm further on it is the deck (y " + (far && far.y.toFixed(2)) + ") and a walk");
  }
  {
    // a step of 0.538 m between two flush slabs: the mover climbs it (its reach is 0.55 less the 6 mm its gravity sinks), the Wave-6 grid neither climbed nor was stopped
    const r = wsOf(PINNED.step_0538_ashgrid9004), c = PINNED.step_0538_ashgrid9004;
    ok(r.ws !== null && r.ws.y > c.a[1] + 0.5, "a 0.538 m step between flush slabs is climbed (ends on y " + (r.ws && r.ws.y.toFixed(3)) + ", the upper slab), not walked through");
    // and a 0.56 m step is a wall in both
    const W = NG.createWorld({ colliders: [mk("box", 0, 10, 0.8, 1.0, 0, 6), mk("box", 8, 20, 0.8, 1.56, 0, 6)], heightFn: () => 0, cover: () => true });
    ok(NG.walkSegment(W, 6, 1.0, 3, 11, 3) === null, "a 0.56 m step is a wall");
  }
  {
    // a steep slope onto a deck 0.5 m above the feet's line: a falling walker is caught by the deck's margin only at the very tick it enters it (6 mm decide it).
    // The same walk down a gentle slope is fine. (Deepwood's mill: 11 of the 15 disagreements left after the rules above.)
    const mill = (slope, deckTop) => {
      const hf = (x, z) => Math.max(-1.2, 0.948 - slope * (58.125 - z));
      const W = NG.createWorld({ colliders: [mk("box", 12.75, 19.25, deckTop - 0.24, deckTop, 51.25, 56.75)], heightFn: hf, waterY: 0, cover: () => true });
      return NG.walkSegment(W, 15.375, 0.948, 58.125, 16.286, 54.822);
    };
    ok(mill(0.5, 0.62) !== null && mill(0.9, 0.62) === null, "down a 0.5 slope onto a deck 0.62 m high: a walk; down a 0.9 slope the feet are in the air and a deck 0.5 above them is caught by a tick or lost by one: not a walk");
    ok(mill(0.5, 0.86) !== null && mill(0.6, 0.86) === null && mill(0.8, 0.86) === null, "a deck 0.86 m high: a walk down a 0.5 slope, not down a 0.6 / 0.8 one (ground that drops faster than the feet follow is simulated tick by tick, not glued to)");
    // the corner notch of a stairwell hole: two support margins leave a gap at the diagonal; a walker may stop in it 4.5 cm before the end
    const hole = NG.createWorld({ colliders: [mk("box", -43.65, -42.5, 43.57, 43.87, -35.5, -24.5), mk("box", -46.85, -43.65, 43.57, 43.87, -35.5, -31.01)], heightFn: () => 39.567, cover: () => true });
    ok(NG.walkSegment(hole, -43.594, 43.867, -30.375, -43.992, -30.736) === null && NG.walkSegment(hole, -43.594, 43.867, -30.375, -43.8, -30.55) !== null, "the notch at a stairwell corner: a walk that can stop in it is refused, one that ends on the deck is not");
  }
}

// ── 6b. the swim line, the ground that is not there, the cascade ────────────────────────────────────────────────────────────
{
  // shallow water (terrain -0.6, water 0) with a 0.7 m trench of -2.6 that lies between two of the 1.5 m open cells' checked points
  const trench = (x) => (x > 12.5 && x < 13.2 ? -2.6 : -0.6);
  const ww = NG.createWorld({ colliders: [], heightFn: (x, z) => trench(x), waterY: 0, cover: () => true });
  ok(NG.walkSegment(ww, 8, -0.6, 5, 17, 5) === null, "a trench under the swim line inside one open cell stops the walk (the mover swims there)");
  ok(NG.walkSegment(ww, 2, -0.6, 5, 11, 5) !== null, "the same shallows without the trench are a walk");
  // the swim line has a 2 cm skin: a trough 1 cm under it (-1.09 against the mover's -1.1) is refused, one 5 cm over it is not
  const dip = (depth) => NG.createWorld({ colliders: [], heightFn: (x, z) => (x > 6 && x < 7.2 ? depth : -0.6), waterY: 0, cover: () => true });
  ok(NG.walkSegment(dip(-1.09), 3, -0.6, 5, 10, 5) === null && NG.walkSegment(dip(-1.03), 3, -0.6, 5, 10, 5) !== null, "a trough at -1.09 is swimming for the grid (skin 2 cm), one at -1.03 is wading");
  // terrain that is NaN over a patch (maps.js TerrainField gave NaN on 3 of 90 map seeds): no node there, no walk through it, and no runaway search
  const hole = (x, z) => (x > 9 && x < 13 && z > 0 && z < 12 ? NaN : 0);
  const wn = NG.createWorld({ colliders: [], heightFn: hole, cover: () => true });
  ok(NG.walkSegment(wn, 5, 0, 5, 18, 5) === null, "a walk across a patch with no ground height is refused");
  const pn = NG.findPath(wn, 5, 0, 5, 20, 0, 5);
  let finite = true; for (const T of NG.tiles(wn)) for (let i = 0; i < T.n; i++) if (!(isFinite(T.x[i]) && isFinite(T.y[i]) && isFinite(T.z[i]))) finite = false;
  ok(pn !== null && wn.stats.expanded < 3000 && finite, "a route round the patch exists (" + (pn ? pn.length : 0) + " waypoints, " + wn.stats.expanded + " nodes expanded), every node is finite");
  // a bake does not cascade: one route across a tile corner on open ground bakes a handful of tiles, not the plane (cover = everything)
  const wc = NG.createWorld({ colliders: [mk("box", 40, 41, 0, 2, 40, 41)], heightFn: flat });
  const pc = NG.findPath(wc, 28, 0, 28, 36, 0, 36);
  ok(pc !== null && wc.slots.length <= 16, "a 12 m route over a tile corner bakes " + wc.slots.length + " tiles (it used to bake the whole covered plane)");
  const far = NG.findPath(wc, 28, 0, 28, 28, 0, 2400, { maxExpand: 3000 });
  ok(wc.slots.length < 400, "a 2.4 km route with a small budget stops at its budget (" + wc.lastFail + ", " + wc.slots.length + " tiles)");
}

// ── 6c. the edges: stored, plain and implicit all replay; the search table; budgets ───────────────────────────────────────────
{
  let nEdges = { csr: 0, plain: 0, open: 0, link: 0 }, bad = 0, asym = 0, checked = 0;
  const tiles = NG.tiles(W1).filter((t) => t.n > 0);
  NG.prewarm(W1, { minX: 0, maxX: 64, minZ: 0, maxZ: 64 }, 1e9);
  let stride = 0;
  for (const T of NG.tiles(W1)) for (let a = 0; a < T.n; a += 3) {
    for (const e of NG.edgesOf(W1, T, a)) {
      nEdges[e.via]++;
      if (!isFinite(e.cost) || e.cost <= 0 || e.cost > 40) bad++;
      { const Ud = W1.slots[e.to >> 17], md = e.to & 0x1ffff, dd = Math.hypot(Ud.x[md] - T.x[a], Ud.y[md] - T.y[a], Ud.z[md] - T.z[a]);
        if (e.via !== "link" && (e.cost < dd * 0.98 || e.cost > dd * 6.5)) bad++; }              // a cost is the distance times at most 1.4 (slope) x 1.8 (wet) x 2.5 (robustness)
      if ((++stride % 7) !== 0 || e.via === "link") continue;           // replay every 7th stored / plain / open edge
      const U = W1.slots[e.to >> 17], m = e.to & 0x1ffff;
      checked++;
      const r = NG.hop(W1, T, T.x[a], T.y[a], T.z[a], U.x[m], U.z[m], NG.RADIUS);
      if (!r || Math.abs(r.y - U.y[m]) > 0.35) bad++;
      if (e.via === "open" && !NG.edgesOf(W1, U, m).some((q) => q.to === T.base + a && q.via === "open")) asym++;
    }
  }
  ok(nEdges.csr > 30 && nEdges.plain > 1000 && nEdges.open > 300 && nEdges.link > 30, "edges by source: " + JSON.stringify(nEdges) + " (stored CSR, plain masks, implicit open ground, tile links)");
  ok(bad === 0, "every checked edge replays through the mover and lands on its floor (" + checked + " replayed), every cost is finite and positive");
  ok(asym === 0, "implicit open-ground edges are symmetric");
  const ws = NG.worldStats(W1);
  ok(ws.edges > 100 && ws.plainEdges > 3000 && ws.openEdges > 1000, "worldStats counts the three kinds apart (stored " + ws.edges + ", plain " + ws.plainEdges + ", open " + ws.openEdges + ", links " + ws.ext + ")");
  ok(ws.arenaBytes > 0 && ws.arenaBytes < 700 * 1024, "the search table is one fixed " + (ws.arenaBytes / 1024).toFixed(0) + " KB, not scratch in every tile");
  const q1 = NG.findPath(W1, 36.5, 0, 33, 22, 0, 22), q2 = NG.findPath(W1, 36.5, 0, 33, 22, 0, 22);
  ok(JSON.stringify(q1) === JSON.stringify(q2), "the same query twice gives the same route (the table is cleared between queries)");
  { // a weighted search is a cheaper search that is never much longer
    let c1 = 0, c13 = 0, e1 = 0, e13 = 0, n = 0;
    for (const q of [[36.5, 0, 33, 22, 0, 22], [36.5, 0, 33, 29, 3.6, 24.5], [9, 0, 30, 36.5, 0, 25], [36.5, 0, 25, 9, 0, 23], [36.5, 0, 33, 28, 7.2, 24]]) {
      const p1 = NG.findPath(W1, ...q), p13 = NG.findPath(W1, ...q, { hw: 1.3 });
      if (p1 && p13) { c1 += p1.cost; c13 += p13.cost; e1 += p1.expanded; e13 += p13.expanded; n++; }
    }
    ok(n >= 4 && c13 <= c1 * 1.3 + 1e-6 && c13 >= c1 - 1e-6 && e13 <= e1, "opts.hw 1.3: " + n + " routes, cost " + c13.toFixed(1) + " vs the optimal " + c1.toFixed(1) + " (never under it, within 30 %), " + e13 + " nodes expanded against " + e1);
  }
  const lim = NG.findPath(W1, 36.5, 0, 33, 22, 7.2, 22, { maxExpand: 20 });
  ok(lim === null && W1.lastFail === "limit", "a tiny budget ends as 'limit': " + W1.lastFail);
}

// ── 6d. bakeTown: a budgeted bake in slices equals one shot; only the rects bake ─────────────────────────────────────────────
{
  const rects = [{ minX: 15, maxX: 40, minZ: 15, maxZ: 35 }];
  const one = NG.bakeTown(scene, flat, rects, {});
  const sliced = NG.bakeTown(scene, flat, rects, { maxMs: 0 });
  let calls = 1; while (!sliced.done && calls < 200) { sliced.step(0); calls++; }
  ok(one.done && sliced.done && calls > 3, "bakeTown in slices finishes (" + calls + " steps; one shot done " + one.done + ")");
  ok(NG.worldHash(one.world) === NG.worldHash(sliced.world), "bakeTown in slices and in one shot bake the same world (hash " + NG.worldHash(one.world) + ")");
  const coarse = NG.tiles(one.world).filter((t) => t.kind === "coarse");
  ok(coarse.length === 4 && one.world.slots.length <= 30, "only the coarse tiles that touch the rect (+ 6 m of street) bake: " + coarse.length + " coarse tiles, " + one.world.slots.length + " in all (the world is 2 x 2 coarse tiles wide here, so ask a map-sized world below)");
  const wide = NG.bakeTown(scene, flat, [{ minX: 15, maxX: 40, minZ: 15, maxZ: 35 }], { margin: 2 });
  const wideAll = NG.createWorld({ colliders: scene, heightFn: flat });
  ok(NG.tileFor(wide.world, 600, 600, true) === null && NG.tileFor(wideAll, 600, 600, true) !== null, "outside the town rects nothing bakes (a hop that leaves them is simply blocked); an uncovered world bakes anywhere");
  const pr = NG.findPath(one.world, 36.5, 0, 33, 26, 7.2, 25);
  ok(pr !== null && pr.length > 0 && pr[pr.length - 1].y > 6, "a route into the top floor works inside a baked town (" + (pr ? pr.length : 0) + " waypoints)");
  // layouts in towngen's shape, discs and arrays are all rects
  const lay = { poi: { x: 27, z: 25, r: 20 }, blocks: [{ x0: 17, z0: 17, x1: 37, z1: 33 }], parcels: [{ building: { aabb: [20, 20, 32, 30] } }] };
  const rl = NG.rectOfLayout(lay, 0);
  ok(rl.minX === 17 && rl.maxX === 37 && rl.minZ === 17 && rl.maxZ === 33, "rectOfLayout: the blocks and the buildings of a towngen layout");
  const t3 = NG.bakeTown(scene, flat, [lay, { x: 27, z: 25, r: 12 }, [15, 15, 40, 35]], {});
  ok(t3.done && t3.world.slots.length >= 4, "bakeTown takes layouts, discs and arrays (" + t3.world.slots.length + " tiles)");
  // a second town added to the same world
  const t4 = NG.bakeTown(scene, flat, [{ minX: 3, maxX: 14, minZ: 17, maxZ: 28 }], { world: one.world });
  ok(t4.world === one.world && t4.done && one.world.slots.length > 6, "a second town joins the same world (" + one.world.slots.length + " tiles)");
}

// ── 6f. Wave 7 (lane 7B2): a LAZY world - a query never bakes; the caller schedules the tiles it asked for ────────────────────────
{
  const tLazy0 = nowMs();
  const lazyW = () => NG.createWorld({ colliders: scene, heightFn: flat, cover, lazy: true });
  const area = { minX: 0, maxX: 64, minZ: 0, maxZ: 64 };
  const bakeAll = (W, order) => {
    for (let pass = 0; pass < 20; pass++) {
      let jobs = NG.collectJobs(W, area);
      if (!jobs.length) break;
      if (order === "rev") jobs = jobs.reverse();
      for (const j of jobs) NG.runJob(W, j);
    }
  };
  const L = lazyW();
  ok(L.noBake === true && NG.tileFor(L, 26, 25, true) === null && L.slots.length === 0, "a lazy world: a tile that is not baked reads as missing and nothing is baked (" + L.slots.length + " tiles)");
  ok(L.wanted.length >= 1 && L.wanted.every((j) => j.kind === 1) && new Set(L.wanted.map((j) => j.key)).size === L.wanted.length, "... and the building tiles it was asked for are listed once each (wanted: " + L.wanted.map((j) => j.kind + ":" + j.key).join(",") + ")");
  for (const j of NG.collectJobs(L, area)) if (j.kind === 0) NG.runJob(L, j);
  const outdoor = L.slots.length;
  ok(outdoor === 4 && L.slots.every((t) => t.kind === "coarse"), "the outdoor tiles bake as jobs (" + outdoor + " coarse tiles, no building yet)");
  const goal = { x: 22, y: 0, z: 22 };
  const pMiss = NG.findPath(L, street.x, street.y, street.z, goal.x, goal.y, goal.z);
  ok(pMiss === null && L.slots.length === outdoor && L.lastFail === "no-goal", "a route into an unbaked house is null (" + L.lastFail + ") and the query baked nothing");
  const need = NG.takeWanted(L);
  ok(need.length >= 1 && need.every((j) => j.kind === 1) && L.wanted.length === 0, "takeWanted hands over the tiles the query needed (" + need.length + " building chunks, the whole house) and empties the list");
  // the sequence a scheduler runs: ask, take, bake the jobs, ask again
  for (let round = 0; round < 6; round++) {
    const p = NG.findPath(L, street.x, street.y, street.z, goal.x, goal.y, goal.z);
    if (p) break;
    for (const j of NG.takeWanted(L)) NG.runJob(L, j);
  }
  const pOk = NG.findPath(L, street.x, street.y, street.z, goal.x, goal.y, goal.z);
  ok(pOk !== null && pOk.length > 0 && Math.hypot(pOk[pOk.length - 1].x - goal.x, pOk[pOk.length - 1].z - goal.z) < 0.8, "after the jobs ran the route exists (" + (pOk ? pOk.length : 0) + " waypoints)");
  ok(pOk !== null && replayRoute(L, street, pOk).ok, "... and every leg of it replays through the mover");
  ok(L.wanted.every((j) => j.kind === 1 && j.rect.tile === null), "what a found route's query asked for on the side (a neighbour beside its start or goal) is unbaked building tiles only (" + L.wanted.length + ")");
  const top = { x: 29, y: 7.2, z: 25 };
  for (let round = 0; round < 8; round++) { if (NG.findPath(L, street.x, street.y, street.z, top.x, top.y, top.z)) break; for (const j of NG.takeWanted(L)) NG.runJob(L, j); }
  const pTop = NG.findPath(L, street.x, street.y, street.z, top.x, top.y, top.z);
  ok(pTop !== null && pTop[pTop.length - 1].y > 6 && replayRoute(L, street, pTop).ok, "the top storey route works in a lazy world too (" + (pTop ? pTop.length : 0) + " waypoints, replayed)");
  // once everything is baked, in ANY order, the lazy world is the eager one
  const E1 = NG.createWorld({ colliders: scene, heightFn: flat, cover });
  NG.prewarm(E1, area, 1e9);
  bakeAll(L, "fwd");
  const L2 = lazyW(); bakeAll(L2, "rev");
  const hE = NG.worldHash(E1), hL = NG.worldHash(L), hL2 = NG.worldHash(L2);
  ok(hE === hL && hE === hL2, "fully baked, a lazy world (forward and reverse job order) hashes like the eager one (" + hE + ")");
  const qs = [[36.5, 0, 33, 22, 0, 22], [36.5, 0, 33, 29, 3.6, 24.5], [9, 0, 30, 36.5, 0, 25], [33.4, 3.6, 25, 36.5, 0, 25], [36.5, 0, 33, 29, 7.2, 25]];
  const same = qs.every((q) => JSON.stringify(NG.findPath(E1, ...q)) === JSON.stringify(NG.findPath(L, ...q)) && JSON.stringify(NG.findPath(E1, ...q)) === JSON.stringify(NG.findPath(L2, ...q)));
  ok(same, "... and returns the very same routes (" + qs.length + " queries, byte for byte)");
  ok(L.slots.length === E1.slots.length, "no tile baked by a query anywhere in the lazy run (" + L.slots.length + " tiles, the eager world has " + E1.slots.length + ")");
  // an INCREMENTAL job (beginJob / stepJob): a tile baked and stitched a slice at a time is the tile baked in one go
  const I1 = lazyW();
  for (const j of NG.collectJobs(I1, area)) if (j.kind === 0) NG.runJob(I1, j);
  let multi = 0, maxSlices = 0, invisible = true, w0 = NG.work(), jobsRun = 0;
  for (let pass = 0; pass < 20; pass++) {
    const js = NG.collectJobs(I1, area);
    if (!js.length) break;
    for (const j of js) {
      const job = NG.beginJob(I1, j);
      let n = 0;
      for (;;) {
        if (n === 1 && !job.done && j.kind === 1 && NG.tileFor(I1, (j.rect.minX + j.rect.maxX) / 2, (j.rect.minZ + j.rect.maxZ) / 2, false) !== null) invisible = false;
        if (NG.stepJob(I1, job)) break;
        n++;
      }
      if (n > 0) multi++;
      if (job.slices > maxSlices) maxSlices = job.slices;
      jobsRun++;
    }
  }
  ok(NG.worldHash(I1) === hE, "baking every building a slice at a time (" + jobsRun + " jobs, the longest in " + maxSlices + " slices, " + (NG.work() - w0) + " replayed steps) builds the eager world (hash " + NG.worldHash(I1) + ")");
  ok(multi >= 2 && maxSlices >= 3, "the slicing is real: " + multi + " jobs took more than one slice, the longest " + maxSlices);
  ok(invisible, "a tile that is part-way through its bake is not in the world yet (a query still reads it as missing)");
  const I2 = lazyW();
  for (const j of NG.collectJobs(I2, area)) if (j.kind === 0) NG.runJob(I2, j);
  const pq = [36.5, 0, 33, 29, 7.2, 25];
  let qNull = 0, qn = 0;
  for (let pass = 0; pass < 20; pass++) {
    const js = NG.collectJobs(I2, area);
    if (!js.length) break;
    for (const j of js) {
      const job = NG.beginJob(I2, j);
      while (!NG.stepJob(I2, job)) { if ((++qn % 12) === 0 && NG.findPath(I2, ...pq) === null) qNull++; }            // queries in between the slices change nothing about the result
    }
  }
  ok(NG.worldHash(I2) === hE && JSON.stringify(NG.findPath(I2, ...pq)) === JSON.stringify(NG.findPath(E1, ...pq)), "queries asked between the slices change nothing: same world hash, same route (" + qNull + " of them came back empty while a tile was missing)");
  // the eager default is untouched: a world without `lazy` still bakes on demand
  const E2 = NG.createWorld({ colliders: scene, heightFn: flat, cover });
  ok(E2.noBake === false && NG.tileFor(E2, 26, 25, true) !== null, "a world without the lazy flag still bakes on demand (default behaviour unchanged)");
  info("the lazy / incremental section took " + (nowMs() - tLazy0).toFixed(0) + " ms");
}

// ── 6e. a fresh process builds the same world ─────────────────────────────────────────────────────────────────────────────
{
  const child = require("child_process");
  const mine = townSignature();
  let theirs = "(no output)";
  try { theirs = child.execFileSync(process.execPath, [__filename, "--child"], { encoding: "utf8", timeout: 60000 }).trim().split("\n").pop(); } catch (e) { theirs = "child failed: " + (e && e.message); }
  ok(mine === theirs, "a fresh process gives the identical world hash and routes (" + mine.slice(0, 60) + ")");
}

// ── 6g. Wave 7, round 2 (lane D4): the one-pass forms of the bake equal the two-call reference; a stair that ends short of its landing still leads to it ──────────
{
  // (a) supBlock (support + blocked in one pass), clearTier (the four clearance questions in one pass) and the short list floorFragile asks are the SAME ANSWERS as
  // supportT + blockedT (and four blockedT): random points, feet heights, radii and ramp-flag states over the house scene's tile, strict ramps on and off.
  if (typeof NG.supBlock === "function" && typeof NG.clearTier === "function") {
    const T = NG.bakeTile(scene, flat, { minX: 17.5, minZ: 17.5, maxX: 36.5, maxZ: 32.5 }, 0.75);
    let sd = 987654321;
    const rnd = () => { sd = (sd + 0x6D2B79F5) >>> 0; let t = sd; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    let bad = 0, nb = 0, blockedN = 0, rampWon = 0, marginN = 0, tierBad = 0; const tiers = [0, 0, 0, 0, 0];
    for (let i = 0; i < 60000; i++) {
      const x = 17.5 + rnd() * 19, z = 17.5 + rnd() * 15, ix = Math.min(T.nx - 1, ((x - T.minX) * T.inv) | 0), iz = Math.min(T.nz - 1, ((z - T.minZ) * T.inv) | 0), ci = iz * T.nx + ix;
      const a = T.nearStart[ci], b = T.nearStart[ci + 1];
      if (a === b) continue;
      const yq = rnd() * 11 - 0.2, rad = NG.RADIUS + (rnd() < 0.5 ? 0.005 : 0.1 * Math.floor(rnd() * 4)), st = rnd() < 0.5 ? 0 : 1, strict = rnd() < 0.3;
      NG.resetMover(st, 0, strict);
      const supR = NG.supportT(T, T.nearItems, a, b, x, z, yq, 0), sR = NG.supRampState();
      const blkR = NG.blockedT(T, T.nearItems, a, b, x, z, supR > yq ? supR : yq, rad);
      NG.resetMover(st, 0, strict);
      const o = NG.supBlock(T, T.nearItems, a, b, x, z, yq, 0, rad);
      nb++; if (blkR) blockedN++; if (sR.ramp === 1) rampWon++; if (sR.margin === 1) marginN++;
      if (o.sup !== supR || o.blocked !== blkR || o.ramp !== sR.ramp || o.margin !== sR.margin) bad++;
      NG.resetMover(0, 0, false);
      const yd = yq, r0 = NG.RADIUS + 0.005;
      const ref = NG.blockedT(T, T.nearItems, a, b, x, z, yd, r0) ? -1 : NG.blockedT(T, T.nearItems, a, b, x, z, yd, NG.RADIUS + 0.1) ? 0 : NG.blockedT(T, T.nearItems, a, b, x, z, yd, NG.RADIUS + 0.2) ? 1 : NG.blockedT(T, T.nearItems, a, b, x, z, yd, NG.RADIUS + 0.3) ? 2 : 3;
      const got = NG.clearTier(T, T.nearItems, a, b, x, z, yd, r0);
      tiers[got + 1]++; if (got !== ref) tierBad++;
    }
    NG.resetMover(0, 0, false);
    ok(bad === 0 && nb > 5000 && blockedN > 500 && blockedN < nb - 500 && rampWon > 100, "supBlock = supportT + blockedT on " + nb + " random cases (" + blockedN + " blocked, " + rampWon + " held up by a ramp, " + marginN + " by a ramp's margin; " + bad + " differ)");
    ok(tierBad === 0 && tiers.slice(0, 4).every((c) => c > 100), "clearTier = the four blockedT questions on the same cases (tiers -1 / 0 / 1 / 2 / 3: " + tiers.join(" / ") + "; " + tierBad + " differ)");
  } else info("supBlock / clearTier are not exported by this navgrid.js: equivalence checks skipped");

  // (b) a stair whose top ends 0.61 m before its landing (a tower's stairwell: the landing slab starts past the ramp). The 0.75 m lattice put no node in the gap row (a
  // node needs a sample inside a footprint), so no edge joined the stair's last row to the landing's first, and the whole storey above the stair was pruned as an island.
  {
    const cols = [mk("ramp", 0, 2.2, 0, 3.0, 0, 6.0, 2), mk("box", -0.5, 4.5, 2.7, 3.0, 6.61, 13)];
    const t = NG.bakeTile(cols, flat, { minX: -3, minZ: -0.07, maxX: 6, maxZ: 14.93 }, 0.75);
    let slabNodes = 0, rampEnd = 0, bridges = 0;
    for (let n = 0; n < t.n; n++) {
      const f = t.flag[n];
      if (t.y[n] > 2.8 && (f & 4) === 0 && (f & 8) === 0) slabNodes++;
      if ((f & 4) !== 0 && (f & 64) !== 0 && t.y[n] > 2.3) {
        rampEnd++;
        for (let e = t.edgeStart[n]; e < t.edgeStart[n + 1]; e++) { const m = t.edgeTo[e]; if ((t.flag[m] & 4) === 0 && t.y[m] > 2.8 && (t.flag[m] & 8) === 0) bridges++; }
      }
    }
    ok(slabNodes > 20 && bridges >= 2, "a stair that ends 0.61 m short of its landing reaches it: " + slabNodes + " landing nodes survive the island prune, " + bridges + " edges leave the stair's top end onto them (" + rampEnd + " top-end nodes)");
  }
}

// ── 7. the real Savanna (needs the harness environment: skipped, not failed, when it is not there) ──────────────────────
async function realMap() {
  const pathMod = require("path"), urlMod = require("url");
  const root = pathMod.join(__dirname, "..", "..");
  const envFile = pathMod.join(root, "_harness", "world_env.mjs");
  if (!fs.existsSync(envFile)) { info("real-map section skipped: " + envFile + " not found"); return; }
  let M = null, E = null;
  try {
    const warn = console.warn; console.warn = () => {};
    try {
      const mod = await import(urlMod.pathToFileURL(envFile).href);
      E = await mod.makeEnv({ root });
      const { buildMap } = await E.importMaps();
      M = await buildMap(E.makeW(7), "ashgrid");
    } finally { console.warn = warn; }
  } catch (e) { info("real-map section skipped: the Savanna did not build here (" + (e && e.message ? String(e.message).split("\n")[0] : e) + ")"); return; }
  await towngenDirect(M, root);
  if (!M.city || !M.city.layout) { info("real-map section (maps.js layout): skipped, this maps.js has no city layout yet (genVersion " + M.genVersion + ")"); return; }
  const L = M.city.layout;
  const picks = [L.towns[0], L.towns[Math.min(5, L.towns.length - 1)]].concat(L.compounds.slice(0, 3));
  const t0 = nowMs();
  const town = NG.bakeTown(M.colliders, M.heightAt, picks, { waterY: M.waterY, portals: M.portals });
  const bakeMs = nowMs() - t0;
  const ws = NG.worldStats(town.world);
  ok(town.done && town.world.slots.length > 20, "bakeTown over the real Savanna (" + M.colliders.length + " colliders, genVersion " + M.genVersion + "): " + picks.length + " areas, " + town.world.slots.length + " tiles in " + bakeMs.toFixed(0) + " ms");
  // memory per town: the tiles whose centre lies in the town's rect
  // The bar is 2 MB for a 3 x 3 block town (Wave 7 stage A: downtown 1.04-1.38 MB). Stage A.2 grew the core to 4 x 4 blocks, so the same bar is held PER NINE BLOCKS
  // (MB = 2 x max(1, blocks / 9)): memory scales with the number of buildings, and the row still fails on a grid that bloats per building. THRESHOLD NOTE in the lane report.
  let worst = 0, worstId = "", worstLim = 2;
  for (const t of picks) {
    const r = NG.rectOfLayout(t, 6);
    let b = 0; for (const T of NG.tiles(town.world)) { const cx = (T.minX + T.maxX) / 2, cz = (T.minZ + T.maxZ) / 2; if (cx >= r.minX && cx <= r.maxX && cz >= r.minZ && cz <= r.maxZ) b += T.stats.bytes; }
    const lim = 2 * Math.max(1, (t.blocks ? t.blocks.length : 0) / 9);
    if (b / 1048576 / lim > worst / 1048576 / worstLim) { worst = b; worstId = t.id; worstLim = lim; }
  }
  ok(worst <= worstLim * 1048576, "memory per town: the largest of the baked ones relative to its limit (" + worstId + ") holds " + (worst / 1048576).toFixed(2) + " MB of tile arrays (limit " + worstLim.toFixed(2) + " MB = 2 MB per nine blocks)");
  // streets -> front doors
  let found = 0, tot = 0, qs = [];
  for (const t of picks) {
    const node = t.roads && t.roads.nodes && t.roads.nodes[0];
    if (!node || !t.doors) continue;
    let nd = 0;
    for (const d of t.doors) {
      if (d.kind !== "front" || d.floor !== 0 || nd >= 12) continue;
      nd++; tot++;
      const q = nowMs();
      const p = NG.findPath(town.world, node.x, M.heightAt(node.x, node.z), node.z, d.out[0], M.heightAt(d.out[0], d.out[1]), d.out[1]);
      qs.push(nowMs() - q);
      if (p && p.length) found++;
    }
  }
  qs.sort((a, b) => a - b);
  if (tot > 0) {
    ok(found >= tot * 0.9, "street -> front door in the baked towns: " + found + " of " + tot + " routes (median " + qs[qs.length >> 1].toFixed(2) + " ms, max " + qs[qs.length - 1].toFixed(1) + " ms)");
  } else info("real-map section: this layout lists no ground-floor front doors to route to");
  const tm = [];
  for (const T of NG.tiles(town.world)) if (T.kind === "fine") tm.push(T.stats.ms);
  tm.sort((a, b) => a - b);
  if (tm.length) info("building tiles of the real Savanna as baked here (" + tm.length + "): median " + tm[tm.length >> 1].toFixed(1) + " ms, p90 " + tm[Math.floor(tm.length * 0.9)].toFixed(1) + " ms, max " + tm[tm.length - 1].toFixed(1) + " ms");
}

/** bakeTown over a layout that THIS test makes with towngen.js, with citykit.colliderFor for the kit shells and simple walled huts with a door for the enterable parcels,
 *  over the real ground of the map (no use of maps.js's own city wiring): the way stage B composes bakeTile over the layout's town rects. */
async function towngenDirect(M, root) {
  const pathMod = require("path"), urlMod = require("url");
  const dir = pathMod.join(root, "runtime", "3d", "royale");
  let TG, CK;
  try {
    TG = await import(urlMod.pathToFileURL(pathMod.join(dir, "towngen.js")).href);
    CK = await import(urlMod.pathToFileURL(pathMod.join(dir, "citykit.js")).href);
  } catch (e) { info("towngen + citykit section skipped: " + (e && e.message)); return; }
  if (typeof TG.layoutMap !== "function" || typeof CK.colliderFor !== "function") { info("towngen + citykit section skipped: the modules lack layoutMap / colliderFor"); return; }
  const lay = TG.layoutMap(7, "ashgrid", M.pois, M.heightAt, M.waterY, {});
  const towns = lay.towns.slice(0, 3);
  const cols = [];
  const mkb = (x0, x1, y0, y1, z0, z1) => cols.push(mk("box", x0, x1, y0, y1, z0, z1));
  let shells = 0, huts = 0, kitFail = 0;
  const huts_ = [];
  for (const t of towns) for (const p of t.parcels) {
    const b = p.building;
    if (!b) continue;
    if (b.gen === "shell" && b.kit) {
      try { for (const c of CK.colliderFor(b.kit, b.cx, b.ground ? b.ground.med : M.heightAt(b.cx, b.cz), b.cz, b.turn)) cols.push(c); shells++; } catch (e) { kitFail++; }
    } else if (b.enterable) {
      // a hut on the footprint: walls 0.3 m, 2.8 m high, a 2.26 m door in the middle of the wall that faces the street, a roof slab; the floor is the ground
      const [x0, z0, x1, z1] = b.aabb, y = b.ground ? b.ground.med : M.heightAt(b.cx, b.cz), T = 0.3, H = 2.8, fx = b.facing ? b.facing[0] : 0, fz = b.facing ? b.facing[1] : 1;
      const wallX = (zc, doorHere) => { if (!doorHere) { mkb(x0, x1, y, y + H, zc - T / 2, zc + T / 2); return; } const c = (x0 + x1) / 2; mkb(x0, c - 1.13, y, y + H, zc - T / 2, zc + T / 2); mkb(c + 1.13, x1, y, y + H, zc - T / 2, zc + T / 2); mkb(c - 1.13, c + 1.13, y + 2.4, y + H, zc - T / 2, zc + T / 2); };
      const wallZ = (xc, doorHere) => { if (!doorHere) { mkb(xc - T / 2, xc + T / 2, y, y + H, z0, z1); return; } const c = (z0 + z1) / 2; mkb(xc - T / 2, xc + T / 2, y, y + H, z0, c - 1.13); mkb(xc - T / 2, xc + T / 2, y, y + H, c + 1.13, z1); mkb(xc - T / 2, xc + T / 2, y + 2.4, y + H, c - 1.13, c + 1.13); };
      const doorSide = Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? "x1" : "x0") : (fz > 0 ? "z1" : "z0");
      wallX(z0 + T / 2, doorSide === "z0"); wallX(z1 - T / 2, doorSide === "z1"); wallZ(x0 + T / 2, doorSide === "x0"); wallZ(x1 - T / 2, doorSide === "x1");
      mkb(x0, x1, y + H, y + H + 0.3, z0, z1);
      huts++; huts_.push({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, y, door: doorSide, x0, x1, z0, z1, town: t });
    }
  }
  const t0 = nowMs();
  const town = NG.bakeTown(cols, M.heightAt, towns, { waterY: M.waterY, portals: M.portals });
  const ms = nowMs() - t0;
  const ws = NG.worldStats(town.world);
  ok(town.done && shells + huts > 10 && town.world.slots.length > 10, "bakeTown over towngen's layout of " + towns.length + " towns (" + shells + " kit shells via citykit.colliderFor" + (kitFail ? ", " + kitFail + " unknown kit types" : "") + ", " + huts + " enterable huts): " + town.world.slots.length + " tiles in " + ms.toFixed(0) + " ms, " + (ws.bytes / 1048576).toFixed(2) + " MB");
  // a street point on the facing side to the hut's centre
  let found = 0, tot = 0;
  for (const h of huts_.slice(0, 24)) {
    const out = h.door === "x1" ? [h.x1 + 2.5, h.cz] : h.door === "x0" ? [h.x0 - 2.5, h.cz] : h.door === "z1" ? [h.cx, h.z1 + 2.5] : [h.cx, h.z0 - 2.5];
    tot++;
    const p = NG.findPath(town.world, out[0], M.heightAt(out[0], out[1]), out[1], h.cx, h.y, h.cz);
    if (p && p.length && Math.hypot(p[p.length - 1].x - h.cx, p[p.length - 1].z - h.cz) < 1.6) found++;
  }
  if (tot > 0) ok(found >= tot * 0.9, "from the doorstep to the middle of the hut: " + found + " of " + tot + " routes (the door of a hut on towngen's parcel is walkable)");
  else info("towngen + citykit section: this layout has no enterable parcels");
}

// ── information: the bake and the query on this box ─────────────────────────────────────────────────────────────────
{
  const rect = { minX: 17.5, minZ: 17.5, maxX: 36.5, maxZ: 32.5 };
  const hBake = minOf(5, () => NG.bakeTile(scene, flat, rect, 0.75));
  const cBake = minOf(5, () => NG.bakeTile(scene, flat, { minX: 0, minZ: 0, maxX: 32, maxZ: 32 }, 1.5));
  const t = NG.bakeTile(scene, flat, rect, 0.75);
  info("bake, min of 5: the 3-storey house tile (" + t.stats.cells + " cells, " + t.n + " nodes, " + t.edgeTo.length + " edges, " + (t.stats.bytes / 1024).toFixed(0) + " KB) " + hBake.toFixed(1) + " ms; an outdoor 32 m tile " + cBake.toFixed(1) + " ms (target <= 8 ms is information)");
  ok(hBake < 3000 && cBake < 1000, "bake sanity ceiling (3 s house tile, 1 s street tile)");
  const wq = world(); for (let i = 0; i < 3; i++) NG.findPath(wq, 36.5, 0, 33, 22, 0, 22);
  const qm = minOf(15, () => NG.findPath(wq, 36.5, 0, 33, 22, 0, 22));
  const qf = minOf(15, () => NG.findPath(wq, 36.5, 0, 33, 22, 7.2, 22));
  info("warm query, min of 15: street -> ground room " + (qm * 1000).toFixed(0) + " us, street -> storey 3 " + (qf * 1000).toFixed(0) + " us (today's planner: 3.7-16.9 ms)");
  ok(qm < 100 && qf < 100, "query sanity ceiling (100 ms)");
}

realMap().catch((e) => { failed++; console.error("  FAIL  the real-map section threw: " + (e && e.stack || e)); }).then(() => {
  console.log("\n" + passed + " passed, " + failed + " failed  (" + ((Date.now() - T0) / 1000).toFixed(1) + " s)");
  process.exit(failed ? 1 : 0);
});
