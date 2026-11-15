#!/usr/bin/env node
/* core/hud/minimap.selftest.cjs — the minimap's pure logic (core/hud/minimap.js).
 *   transform   world -> map (rotating + north-up), handedness: right is right, ahead is up
 *   arrows      teammate facing angle on a rotating / north-up map
 *   clamp       rim + rect clamps for off-map objectives
 *   rules       trigger-shot filter, suppressed default (vesper), event + weapon flags,
 *               enemy-only dots, FFA has no mates, flag honesty (beacon only when revealed)
 *   pings       lifetime/fade, sweep pulse, same-shooter merge does NOT move the dot,
 *               pool recycling, clear, zero growth
 *   raster      plan from a synthetic collider set + every real arena (layers, OBB, bounds)
 *   settings    absent -> on / medium; off / sizes honoured
 * Run:  node core/hud/minimap.selftest.cjs     (exit 0 = all pass)
 */
"use strict";
const path = require("path");
const { pathToFileURL } = require("url");
const GAME_DIR = path.resolve(__dirname, "..", "..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;

let passed = 0, failed = 0;
function ok(c, m) { if (c) { passed++; console.log("  PASS  " + m); } else { failed++; console.error("  FAIL  " + m); } }
function section(n) { console.log("\n== " + n + " =="); }
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

(async () => {
  const MMm = await import(u("core/hud/minimap.js"));
  const { MM, KIND, worldToMap, arrowAngle, clampToRim, clampToRect, isTriggerShot, isSuppressedShot,
    relationOf, shotShowsDot, flagShownPos, pingAlpha, makePings, rasterPlan, readSettings } = MMm;

  section("transform (rotating map: facing is up)");
  const o = [0, 0];
  // yaw convention: forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)
  for (const yaw of [0, 0.7, Math.PI / 2, -2.1, Math.PI]) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    worldToMap(5, -3, yaw, 5 + rx * 10, -3 + rz * 10, 2, o);
    ok(near(o[0], 20) && near(o[1], 0), `yaw ${yaw.toFixed(2)}: opponent 10 m to the RIGHT draws right (${o[0].toFixed(2)},${o[1].toFixed(2)})`);
    worldToMap(5, -3, yaw, 5 + fx * 10, -3 + fz * 10, 2, o);
    ok(near(o[0], 0) && near(o[1], -20), `yaw ${yaw.toFixed(2)}: 10 m AHEAD draws up`);
    worldToMap(5, -3, yaw, 5 - rx * 4, -3 - rz * 4, 1, o);
    ok(near(o[0], -4) && near(o[1], 0), `yaw ${yaw.toFixed(2)}: 4 m LEFT draws left`);
  }
  worldToMap(0, 0, 0, 0, -10, 1, o);
  ok(near(o[0], 0) && near(o[1], -10), "north-up map: world -Z (N) is up");
  worldToMap(0, 0, 0, 10, 0, 1, o);
  ok(near(o[0], 10) && near(o[1], 0), "north-up map: world +X (E) is right");
  // consistency with hud.js relDegTo: positive relDeg = right
  {
    const yaw = 1.1, px = 0, pz = 0, ex = 7, ez = 3;
    const rel = Math.atan2(ex - px, -(ez - pz)) + yaw; // hud.js relDegTo (rad, before norm)
    worldToMap(px, pz, yaw, ex, ez, 1, o);
    ok(Math.sign(Math.sin(rel)) === Math.sign(o[0]), "side agrees with the compass (hud.js relDegTo)");
  }

  section("arrows");
  ok(near(arrowAngle(0.5, 0.5), 0), "teammate facing your way points up");
  // facing +X: forward (1,0) -> yaw = -pi/2; on a yaw-0 map it must point right (cw +pi/2)
  ok(near(arrowAngle(0, -Math.PI / 2), Math.PI / 2), "facing east on a north-up map points right");
  // the arrow angle rotates the 'up' vector (0,-1) to the body's forward on the map
  for (const [th, by] of [[0.3, 1.2], [-1, 2.5], [2, -0.4]]) {
    const a = arrowAngle(th, by);
    const sx = Math.sin(a), sy = -Math.cos(a); // canvas rotate(a) applied to (0,-1)
    worldToMap(0, 0, th, -Math.sin(by), -Math.cos(by), 1, o);
    ok(near(sx, o[0], 1e-9) && near(sy, o[1], 1e-9), `arrow agrees with the map transform (theta ${th}, yaw ${by})`);
  }

  section("clamp");
  o[0] = 30; o[1] = 40; ok(clampToRim(o, 10) && near(Math.hypot(o[0], o[1]), 10) && near(o[0] / o[1], 0.75), "rim clamp keeps the bearing");
  o[0] = 3; o[1] = 4; ok(!clampToRim(o, 10) && o[0] === 3, "inside the rim is untouched");
  o[0] = 50; o[1] = 10; ok(clampToRect(o, 20, 10) && near(o[0], 20) && near(o[1], 4), "rect clamp");

  section("visibility rules");
  const W = { warden: { name: "W" }, vesper: { name: "V" }, corvus: { name: "C", suppressed: true } };
  const shot = (o2) => Object.assign({ shooter: "b3", weaponId: "warden", origin: [1, 1, 1] }, o2);
  ok(isTriggerShot(shot()), "a trigger pull counts");
  ok(!isTriggerShot(shot({ impactOnly: true })), "impactOnly replay does not");
  ok(!isTriggerShot(shot({ pen: true })), "pen exit does not");
  ok(!isTriggerShot(shot({ pellet: 3 })), "extra pellets do not");
  ok(!isSuppressedShot(shot(), W), "warden is loud by default");
  ok(isSuppressedShot(shot({ weaponId: "vesper" }), W), "vesper is suppressed by default");
  ok(isSuppressedShot(shot({ weaponId: "corvus" }), W), "a weapon-table suppressed:true is honoured");
  ok(!isSuppressedShot(shot({ weaponId: "vesper", suppressed: false }), W), "event flag false wins (vesper with the can off)");
  ok(isSuppressedShot(shot({ suppressed: true }), W), "event flag true wins (suppressor attachment)");
  const teams = { P: 0, b1: 0, b2: 1, b3: 1 };
  const same = (a, b) => teams[a] === teams[b];
  ok(relationOf("P", same) === "self" && relationOf("b1", same) === "mate" && relationOf("b2", same) === "enemy", "relations");
  ok(relationOf("b1", () => false) === "enemy", "FFA (sameTeam always false): no mates");
  ok(shotShowsDot(shot({ shooter: "b2" }), "enemy", W), "enemy loud shot -> dot");
  ok(!shotShowsDot(shot({ shooter: "b2", weaponId: "vesper" }), "enemy", W), "enemy suppressed shot -> no dot");
  ok(!shotShowsDot(shot({ shooter: "b1" }), "mate", W), "teammate shot -> no dot");
  ok(!shotShowsDot(shot({ shooter: "P" }), "self", W), "own shot -> no dot");

  section("flag honesty");
  const home = [0, 0, 0];
  ok(flagShownPos({ state: "AT_STAND", pos: home, pubPos: home }, false) === home, "at stand: shown");
  const dp = [4, 0, 4];
  ok(flagShownPos({ state: "DROPPED", pos: dp, pubPos: dp }, false) === dp, "dropped: shown at the drop");
  const live = [9, 0, 9];
  ok(flagShownPos({ state: "CARRIED", pos: live, revealed: false }, false) === null, "enemy-carried, unrevealed: hidden");
  ok(flagShownPos({ state: "CARRIED", pos: live, revealed: true, beacon: null }, false) === null, "revealed but no beacon yet: hidden");
  const bp = [12, 0, 6];
  const fp = flagShownPos({ state: "CARRIED", pos: live, revealed: true, beacon: { pos: bp } }, false);
  ok(fp === bp && fp !== live, "enemy-carried, revealed: beacon only, never the live position");
  ok(flagShownPos({ state: "CARRIED", pos: live }, true) === live, "carried by your side: live");

  section("pings");
  ok(near(pingAlpha(KIND.FIRE, 10, 10), 1) && pingAlpha(KIND.FIRE, 10, 10 + MM.FIRE_TTL) === 0, "fire dot: full then gone at TTL");
  ok(pingAlpha(KIND.FIRE, 10, 11) > 0 && pingAlpha(KIND.FIRE, 10, 11) < pingAlpha(KIND.FIRE, 10, 10.5), "fire dot fades monotonically");
  ok(MM.FIRE_TTL >= 1.5 && MM.FIRE_TTL <= 2.5, "fire TTL ~2 s");
  ok(pingAlpha(KIND.SWEEP, 0, 2.39) === 0 && pingAlpha(KIND.SWEEP, 0, 0.1) > 0, "sweep contact lives until just before the next sweep (2.4 s)");
  {
    const vals = []; for (let k = 0; k < 20; k++) vals.push(pingAlpha(KIND.SWEEP, 0, k * 0.05));
    ok(Math.max(...vals) - Math.min(...vals) > 0.3, "sweep contact pulses");
  }
  ok(pingAlpha(KIND.DEATH_MATE, 0, 1) === 1 && pingAlpha(KIND.DEATH_MATE, 0, MM.DEATH_TTL) === 0, "death X lives ~3.5 s");
  ok(pingAlpha(KIND.FIRE, 10, 9) === 0, "a ping from the future is invisible");

  const pg = makePings(8);
  const before = pg.items.length;
  const a1 = pg.add(KIND.FIRE, "b2", 10, 0, 10, 0);
  // the shooter runs 0.8 m and keeps firing: the dot refreshes but does NOT move
  const a2 = pg.add(KIND.FIRE, "b2", 10.8, 0, 10, 0.5);
  ok(a1 === a2 && a1.x === 10 && a1.t0 === 0.5, "same shooter, near: refresh, position NOT tracked");
  const a3 = pg.add(KIND.FIRE, "b2", 20, 0, 10, 0.6);
  ok(a3 !== a1 && a3.x === 20 && a1.x === 10, "same shooter moved far: a NEW dot where the shot happened; old dot stays put");
  ok(pg.liveCount(0.6) === 2, "two live dots");
  ok(pg.liveCount(0.6 + MM.FIRE_TTL + 0.01) === 0, "all expire");
  for (let k = 0; k < 30; k++) pg.add(KIND.FIRE, "b" + k, k * 5, 0, 0, 5 + k * 0.01);
  ok(pg.items.length === before, "pool never grows (recycles the oldest)");
  ok(pg.liveCount(5.3) === 8, "pool full of live pings");
  const newest = pg.add(KIND.SWEEP, "bX", 1, 0, 1, 5.4);
  ok(newest.kind === KIND.SWEEP && pg.items.length === before, "a full pool recycles");
  pg.clear(); ok(pg.liveCount(5.4) === 0, "clear");

  section("raster plan (synthetic)");
  const col = {
    bounds: { min: [-10, -1, -20], max: [30, 10, 20] },
    walkRects: [{ min: [-10, -20], max: [30, 20], y: 0 }],
    boxes: [
      { min: [0, 0, 0], max: [4, 6, 4] },                     // building
      { min: [5, 0, 5], max: [6, 1, 7] },                     // cover
      { min: [7, 0, 7], max: [8, 0.2, 8] },                   // kerb (skipped)
      { min: [9, 3, 9], max: [12, 3.3, 12] },                 // deck
      { min: [0, 0, 0], max: [1, 1, 1], rayOnly: true },      // compound sub-box (skipped)
      { min: [-1, 0, -1], max: [1, 1.2, 1], obb: { cx: 0, cz: 0, c: Math.cos(0.5), s: Math.sin(0.5), hx: 0.8, hz: 0.4 } },
    ],
  };
  const pl = rasterPlan(col);
  ok(pl.minX === -10 && pl.minZ === -20 && pl.w === 40 && pl.h === 40, "bounds -> extent");
  ok(pl.shapes.length === 4, "kerb + rayOnly skipped (4 shapes)");
  ok(pl.shapes[pl.shapes.length - 1].layer === 3, "walls/buildings draw last (on top)");
  ok(pl.shapes.some((s) => s.layer === 1) && pl.shapes.some((s) => s.layer === 2), "deck + cover layers present");
  const obbS = pl.shapes.find((s) => s.pts[0] !== s.pts[6] && s.layer === 2 && Math.abs(s.pts[0]) < 1.2);
  ok(!!obbS && near(Math.hypot(obbS.pts[0] - obbS.pts[2], obbS.pts[1] - obbS.pts[3]), 1.6, 1e-9), "OBB keeps its true footprint (rotated, 1.6 m edge)");
  ok(pl.walk.length === 1, "walk rects carried");

  section("raster plan (real arenas)");
  const { buildCollidersFor } = await import(u("core/level/colliders.js"));
  const { listMaps } = await import(u("core/level/layout.js"));
  for (const id of listMaps()) {
    const c = buildCollidersFor(id, 1);
    const p2 = rasterPlan(c);
    const walls = p2.shapes.filter((s) => s.layer === 3).length;
    let inside = 0;
    for (const s of p2.shapes) {
      const cx = (s.pts[0] + s.pts[4]) / 2, cz = (s.pts[1] + s.pts[5]) / 2;
      if (cx >= p2.minX - 1 && cx <= p2.minX + p2.w + 1 && cz >= p2.minZ - 1 && cz <= p2.minZ + p2.h + 1) inside++;
    }
    ok(walls > 20 && p2.w > 50 && p2.h > 50, `${id}: ${p2.shapes.length} shapes (${walls} walls), ${p2.w}x${p2.h} m`);
    ok(inside / p2.shapes.length > 0.97, `${id}: shapes fall inside the raster bounds (${inside}/${p2.shapes.length})`);
    ok(Math.ceil(p2.w * MM.PPM) * Math.ceil(p2.h * MM.PPM) * 4 < 2.5e6, `${id}: raster under 2.5 MB`);
  }

  section("settings");
  const cs = {};
  ok(readSettings(undefined, cs).on === true && cs.size === "medium", "absent -> on / medium");
  ok(readSettings({ minimap: "off" }, cs).on === false, "'off' honoured");
  ok(readSettings({ minimap: false }, cs).on === false, "false honoured");
  ok(readSettings({ minimap: "on", minimapSize: "large" }, cs).size === "large", "size honoured");
  ok(readSettings({ minimapSize: "bogus" }, cs).size === "medium", "unknown size -> medium");
  ok(readSettings({}, cs) === cs, "settings read reuses the scratch object (no per-frame allocation)");

  console.log(`\nminimap selftest: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
