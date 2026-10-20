/**
 * Node self-test for royale/citykit.js (Wave 6, lane 6C; contract C-KIT). Proves the PURE half of the kit - collider generation, rotation
 * rules, palette / theme tables, the embedded collider table - with no THREE, no DOM, no GLB and no fetch. The drawing half (instancing,
 * bounding spheres, the far proxy, disposal, the GLB-failure path) is proven in a real browser by _harness/citykit_probe.py.
 *
 * Run:  node games/last-circle/runtime/3d/royale/citykit.selftest.cjs
 *       node games/last-circle/runtime/3d/royale/citykit.selftest.cjs --emit-table     (after an intake re-run: prints the new COLLIDER_BOXES literal)
 * Exit 0 = all pass, exit 1 = a failure.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

let passed = 0, failed = 0;
function ok(cond, msg, detail) {
  if (cond) { passed++; console.log("  PASS  " + msg); }
  else { failed++; console.error("  FAIL  " + msg + (detail !== undefined ? "  " + JSON.stringify(detail) : "")); }
}
const T0 = Date.now();
const GAME = path.resolve(__dirname, "..", "..", "..");
const MANIFEST = path.join(GAME, "assets", "props", "city", "manifest.json");
const HALF_PI = Math.PI / 2;

// FNV-1a over the doubles' text: a stable fingerprint of a collider list (information, and the determinism comparison)
function fnv(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16).padStart(8, "0"); }
const dump = (cs) => cs.map((c) => [c.minX, c.maxX, c.minY, c.maxY, c.minZ, c.maxZ].join(",")).join(";");

// INDEPENDENT reference: rotate the 8 corners of a manifest box with an explicit integer 3x3 matrix (no sin/cos), take the AABB.
// (a different code path from the module's four-case table: matrix product of corners)
const ROT = [[1, 0, 0, 1], [0, 1, -1, 0], [-1, 0, 0, -1], [0, -1, 1, 0]];          // q -> [m00, m01, m10, m11]: x' = m00 x + m01 z ; z' = m10 x + m11 z
function refBox(b, q, k, x, y, z) {
  const [m00, m01, m10, m11] = ROT[q];
  let mnX = Infinity, mxX = -Infinity, mnZ = Infinity, mxZ = -Infinity;
  for (let i = 0; i < 4; i++) {
    const lx = (i & 1 ? b.max[0] : b.min[0]) * k, lz = (i & 2 ? b.max[2] : b.min[2]) * k;
    const X = m00 * lx + m01 * lz, Z = m10 * lx + m11 * lz;
    mnX = Math.min(mnX, X); mxX = Math.max(mxX, X); mnZ = Math.min(mnZ, Z); mxZ = Math.max(mxZ, Z);
  }
  return [x + mnX, x + mxX, y + b.min[1] * k, y + b.max[1] * k, z + mnZ, z + mxZ];
}

(async () => {
  const K = await import(pathToFileURL(path.join(__dirname, "citykit.js")).href);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  if (process.argv.includes("--emit-table")) { console.log(K.emitColliderTable(manifest)); return; }

  // ---------------------------------------------------------------- module surface
  ok(typeof K.createCityKit === "function" && typeof K.colliderFor === "function" && typeof K.footprintFor === "function", "citykit.js imports in Node with no THREE, no DOM and no resolve hook");
  ok(typeof globalThis.window === "undefined" && typeof globalThis.document === "undefined", "no browser globals were needed to import it");
  const ids = K.typeIds();
  ok(ids.length === 81, "81 types in the embedded table", ids.length);
  const mIds = Object.keys(manifest.types);
  ok(mIds.length === 81 && mIds.every((id) => ids.includes(id)) && ids.every((id) => mIds.includes(id)), "the embedded table and manifest.json name the same 81 types");
  const drift = K.tableDrift(manifest);
  ok(drift.length === 0, "the embedded collider table equals manifest.json EXACTLY (every box, every number)" + (drift.length ? " - run: node citykit.selftest.cjs --emit-table" : ""), drift.slice(0, 5));
  const modes = {};
  for (const id of mIds) modes[manifest.types[id].collider_mode] = (modes[manifest.types[id].collider_mode] || 0) + 1;
  ok(modes.footprint === 31 && modes.bbox === 34 && modes.bands === 8 && modes.elevation === 5 && modes.pole === 3, "collider modes (the intake re-run of Wave 7, art_b_city.py: two more footprint-baked types): footprint 31, bbox 34, bands 8, elevation 5, pole 3", modes);

  // ---------------------------------------------------------------- mkCollider contract (maps.js:228)
  const mk = K.mkCollider("box", 1, 2, 3, 4, 5, 6, -1, null, -1, 0);
  const KEYS = ["kind", "minX", "maxX", "minY", "maxY", "minZ", "maxZ", "dir", "prop", "idx", "hp", "dead", "_qs"];
  ok(Object.keys(mk).join() === KEYS.join() && K.COLLIDER_KEYS.join() === KEYS.join(), "mkCollider has maps.js's 13 fields in maps.js's order (one hidden class)", Object.keys(mk));
  ok(mk.kind === "box" && mk.dir === -1 && mk.prop === null && mk.idx === -1 && mk.hp === 0 && mk.dead === false && mk._qs === 0, "a kit collider is a non-destructible static box: dir -1, prop null, idx -1, hp 0, dead false, _qs 0");
  const src = fs.readFileSync(path.join(GAME, "runtime", "3d", "royale", "maps.js"), "utf8");
  const live = /function mkCollider\(kind, minX, maxX, minY, maxY, minZ, maxZ, dir, prop, idx, hp\) \{\s*return \{ kind, minX, maxX, minY, maxY, minZ, maxZ, dir, prop, idx, hp, dead: false, _qs: 0 \};/.test(src);
  ok(live, "maps.js still declares mkCollider with exactly this signature and object literal (the copy cannot silently drift)");

  // ---------------------------------------------------------------- rotation rules
  const R = K.resolveRotation;
  ok(R(0).q === 0 && R(1).q === 1 && R(3).q === 3 && R(4).q === 0 && R(-1).q === 3 && R(7).q === 3, "an INTEGER rot is a quarter-turn index (mod 4)");
  ok(R(1).ry === HALF_PI && R(2).ry === Math.PI && R(3).ry === 3 * HALF_PI, "a quarter turn is exactly q * PI/2 (the mesh and the collider cannot disagree)");
  ok(R(HALF_PI).q === 1 && R(Math.PI).q === 2 && R(-HALF_PI).q === 3 && R(2 * Math.PI).q === 0 && R(HALF_PI + 1e-9).exact, "radians within 1e-6 of a quarter turn snap to it", R(HALF_PI + 1e-9));
  ok(!R(0.5).exact && R(0.5).q === -1 && R(0.5).ry === 0.5 && !R(1.5).exact, "any other non-integer is free radians (inexact colliders)");
  ok(R(undefined, HALF_PI).q === 1 && R(3, 0).q === 0 && R(undefined, 0.3).q === -1, "`ry` (radians) overrides `rot`");
  ok(R(undefined).q === 0 && R(null).q === 0, "no rotation is quarter 0");
  ok(K.quarterFacing(0, 1) === 0 && K.quarterFacing(1, 0) === 1 && K.quarterFacing(0, -1) === 2 && K.quarterFacing(-1, 0) === 3 && K.quarterFacing(0.1, 5) === 0 && K.quarterFacing(5, -0.2) === 1, "quarterFacing(dx, dz): the authored front +Z faces the street");
  // the front direction is (sin ry, cos ry): the module and the mesh convention (setFromAxisAngle(Y, ry)) agree
  let frontOk = true;
  for (let q = 0; q < 4; q++) { const f = [Math.round(Math.sin(q * HALF_PI)), Math.round(Math.cos(q * HALF_PI))]; if (K.quarterFacing(f[0], f[1]) !== q) frontOk = false; }
  ok(frontOk, "quarterFacing inverts the front direction of every quarter turn");

  // ---------------------------------------------------------------- 81 types x 4 rotations: exact, independent, deterministic
  let boxesChecked = 0, exactFail = 0, countFail = 0, shapeFail = 0, detFail = 0, aliasFail = 0, firstBad = null;
  const all = [];
  const P = [[0, 0, 0], [12.5, 3.25, -40.125], [-300.75, 0.5, 211.5]], SC = [1, 1.5, 0.75];
  for (const id of mIds) {
    const m = manifest.types[id];
    for (let q = 0; q < 4; q++) for (let pi = 0; pi < P.length; pi++) {
      const [x, y, z] = P[pi], k = SC[pi];
      const cs = K.colliderFor(id, x, y, z, q, k === 1 ? undefined : k);
      if (cs.length !== m.colliders.length) { countFail++; firstBad = firstBad || ["count", id, q]; continue; }
      all.push(cs);
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i], r = refBox(m.colliders[i], q, k, x, y, z);
        boxesChecked++;
        if (c.minX !== r[0] || c.maxX !== r[1] || c.minY !== r[2] || c.maxY !== r[3] || c.minZ !== r[4] || c.maxZ !== r[5]) { exactFail++; firstBad = firstBad || ["exact", id, q, pi, i, [c.minX, c.maxX, c.minY, c.maxY, c.minZ, c.maxZ], r]; }
        if (Object.keys(c).join() !== KEYS.join() || c.kind !== "box" || c.prop !== null || c.hp !== 0 || c.dir !== -1 || c.idx !== -1 || c.dead !== false || c._qs !== 0 || !(c.minX < c.maxX && c.minY < c.maxY && c.minZ < c.maxZ)) shapeFail++;
      }
      const again = K.colliderFor(id, x, y, z, q, k === 1 ? undefined : k);
      if (dump(again) !== dump(cs)) detFail++;
      // aliases of the same quarter turn: q + 4, the radian form and `ry`
      const a1 = K.colliderFor(id, x, y, z, q + 4, k === 1 ? undefined : k), a2 = K.colliderFor(id, x, y, z, q * HALF_PI + (q ? 0 : 0.0), k === 1 ? undefined : k);
      if (q !== 0 && Number.isInteger(q * HALF_PI)) { /* q*PI/2 is a non-integer for q>0: radians path */ }
      if (dump(a1) !== dump(cs)) aliasFail++;
      if (q !== 0 && dump(a2) !== dump(cs)) aliasFail++;
    }
  }
  ok(countFail === 0, "every type x 4 rotations x 3 placements yields exactly the manifest's number of boxes", { countFail, firstBad });
  ok(exactFail === 0, "every one of " + boxesChecked + " world boxes EQUALS the independent corner-matrix reference bit for bit", { exactFail, firstBad });
  ok(shapeFail === 0, "every collider is a well-formed mkCollider box (13 fields in order, min < max on all three axes)", shapeFail);
  ok(detFail === 0, "two calls give identical colliders (deterministic, no hidden state)", detFail);
  ok(aliasFail === 0, "q + 4 and the radian spelling of a quarter turn give the same boxes as the index", aliasFail);
  const fp = fnv(all.map(dump).join("|"));
  console.log("  INFO  fingerprint of " + all.length + " collider lists (81 types x 4 turns x 3 placements): " + fp + ", " + boxesChecked + " boxes");

  // ---------------------------------------------------------------- matches the manifest bboxes
  let bboxFail = 0, bboxFirst = null, covFail = 0, covFirst = null;
  for (const id of mIds) {
    const m = manifest.types[id], cs = K.colliderFor(id, 0, 0, 0, 0);
    let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity, mnZ = Infinity, mxZ = -Infinity;
    for (const c of cs) { mnX = Math.min(mnX, c.minX); mxX = Math.max(mxX, c.maxX); mnY = Math.min(mnY, c.minY); mxY = Math.max(mxY, c.maxY); mnZ = Math.min(mnZ, c.minZ); mxZ = Math.max(mxZ, c.maxZ); }
    const lo = m.bbox_min_m, hi = m.bbox_max_m, tol = 0.3;                          // art_b_check.py: colliders inside the bbox +0.3 m
    if (mnX < lo[0] - tol || mnY < lo[1] - tol || mnZ < lo[2] - tol || mxX > hi[0] + tol || mxY > hi[1] + tol || mxZ > hi[2] + tol) { bboxFail++; bboxFirst = bboxFirst || [id, [mnX, mnY, mnZ, mxX, mxY, mxZ], lo, hi]; }
    // and they COVER the body: the union reaches at least half of the bbox height and 40 % of each footprint side (a collider that shrank to nothing is a bug)
    const bh = hi[1] - lo[1], bw = hi[0] - lo[0], bd = hi[2] - lo[2];
    if (m.collider_mode === "pole") continue;                                       // a pole collider is the shaft only (the lamp arm is overhead)
    if ((mxY - mnY) < 0.5 * bh - 1e-9 || (mxX - mnX) < 0.4 * bw - 1e-9 || (mxZ - mnZ) < 0.4 * bd - 1e-9) { covFail++; covFirst = covFirst || [id, mxY - mnY, bh, mxX - mnX, bw, mxZ - mnZ, bd]; }
  }
  ok(bboxFail === 0, "all 81 collider sets sit inside the manifest bbox_m (+0.3 m, the intake's own rule)", { bboxFail, bboxFirst });
  ok(covFail === 0, "all 78 non-pole collider sets cover the body (>= 50 % of the height, >= 40 % of each footprint side)", { covFail, covFirst });

  // ---------------------------------------------------------------- composition, scale and translation are exact
  let compFail = 0, scaleFail = 0, moveFail = 0, quartFail = 0;
  const union = (cs) => cs.reduce((a, c) => [Math.min(a[0], c.minX), Math.max(a[1], c.maxX), Math.min(a[2], c.minZ), Math.max(a[3], c.maxZ), Math.max(a[4], c.maxY)], [Infinity, -Infinity, Infinity, -Infinity, -Infinity]);
  for (const id of mIds) {
    const u0 = union(K.colliderFor(id, 0, 0, 0, 0)), u1 = union(K.colliderFor(id, 0, 0, 0, 1)), u2 = union(K.colliderFor(id, 0, 0, 0, 2)), u3 = union(K.colliderFor(id, 0, 0, 0, 3));
    // x' = z, z' = -x (quarter 1): X range = old Z range, Z range = -(old X range) ; two quarters = a half turn; four = identity
    if (u1[0] !== u0[2] || u1[1] !== u0[3] || u1[2] !== -u0[1] || u1[3] !== -u0[0]) compFail++;
    if (u2[0] !== -u0[1] || u2[1] !== -u0[0] || u2[2] !== -u0[3] || u2[3] !== -u0[2]) compFail++;
    if (u3[0] !== -u0[3] || u3[1] !== -u0[2] || u3[2] !== u0[0] || u3[3] !== u0[1]) compFail++;
    const w = K.colliderFor(id, 0, 0, 0, 0, 2), b = K.colliderFor(id, 0, 0, 0, 0, 1);       // power-of-two scale is exact in binary
    for (let i = 0; i < b.length; i++) if (w[i].maxX !== 2 * b[i].maxX || w[i].minZ !== 2 * b[i].minZ || w[i].maxY !== 2 * b[i].maxY) scaleFail++;
    const mv = K.colliderFor(id, 100, 7, -50, 0), z0 = K.colliderFor(id, 0, 0, 0, 0);
    for (let i = 0; i < mv.length; i++) if (mv[i].minX !== 100 + z0[i].minX || mv[i].maxZ !== -50 + z0[i].maxZ || mv[i].minY !== 7 + z0[i].minY) moveFail++;
    const fp0 = K.footprintFor(id, 5, 5, 0), fp1 = K.footprintFor(id, 5, 5, 1);
    if (fp0.w !== fp0.maxX - fp0.minX || Math.abs(fp1.w - fp0.d) > 1e-9 || Math.abs(fp1.d - fp0.w) > 1e-9 || fp0.height !== union(K.colliderFor(id, 5, 0, 5, 0))[4]) quartFail++;
  }
  ok(compFail === 0, "rotating by 1, 2, 3 quarter turns maps the union footprint exactly (X' = Z, Z' = -X ...)", compFail);
  ok(scaleFail === 0, "scale 2 doubles every box exactly; the base scale is the manifest's suggested scale", scaleFail);
  ok(moveFail === 0, "(x, y, z) translates every box exactly", moveFail);
  ok(quartFail === 0, "footprintFor swaps width and depth on a quarter turn and reports the collider height", quartFail);

  // ---------------------------------------------------------------- non-quarter yaw: a staircase of <= 1 m strips that COVERS the rotated box
  // (a fallback for one-off props: Wave-7 lots are quarter-turned). Two measures against the TRUE rotated rectangle of every manifest box:
  //   cover  : random points inside the true box lie inside some strip (no hole)
  //   excess : random points inside the strips lie within SLACK metres of the true rectangle (no phantom wall; the plan's Wave-4 defect was 8.4 m)
  const SLACK = 1.05;                                       // seg = 1 m; at 45 degrees the staircase corner is 0.71 m off, at a steep edge ~1 m
  let chainFail = 0, chainWorst = 0, chainN = 0, chainBoxes = 0, chainFirst = null, chainMax = 0, ptsIn = 0, ptsOut = 0, cornerN = 0, cornerFail = 0;
  let sr = 12345; const rng = () => { sr = (sr * 1664525 + 1013904223) >>> 0; return sr / 4294967296; };
  const distToRect = (X, Z, b, c, s, x0, z0) => {          // distance from (X, Z) to the rotated rectangle b at yaw ry about (x0, z0)
    const dx = X - x0, dz = Z - z0, lx = dx * c - dz * s, lz = dx * s + dz * c;          // inverse rotation
    const ex = Math.max(b.min[0] - lx, 0, lx - b.max[0]), ez = Math.max(b.min[2] - lz, 0, lz - b.max[2]);
    return Math.hypot(ex, ez);
  };
  for (const id of mIds) {
    const m = manifest.types[id];
    for (const ry of [0.3, 0.7853981633974483, 1.1, 2.9, -0.4]) {
      const cs = K.colliderFor(id, 10, 0, 20, ry);
      chainN++; chainBoxes += cs.length; chainMax = Math.max(chainMax, cs.length);
      const c = Math.cos(ry), s = Math.sin(ry);
      for (const b of m.colliders) {
        // the four true corners (the extremes of the rotated box) must lie in a strip with NO slack: millimetre rounding is outward, never inward
        for (let i = 0; i < 4; i++) {
          const lx = i & 1 ? b.max[0] : b.min[0], lz = i & 2 ? b.max[2] : b.min[2], ly = (b.min[1] + b.max[1]) / 2;
          const X = 10 + (lx * c + lz * s), Z = 20 + (-lx * s + lz * c);
          cornerN++;
          if (!cs.some((q) => X >= q.minX && X <= q.maxX && Z >= q.minZ && Z <= q.maxZ && ly >= q.minY && ly <= q.maxY)) { cornerFail++; chainFirst = chainFirst || ["corner", id, ry]; }
        }
        for (let t = 0; t < 10; t++) {
          const lx = b.min[0] + (b.max[0] - b.min[0]) * rng(), lz = b.min[2] + (b.max[2] - b.min[2]) * rng(), ly = b.min[1] + (b.max[1] - b.min[1]) * rng();
          const X = 10 + lx * c + lz * s, Z = 20 - lx * s + lz * c;
          ptsIn++;
          if (!cs.some((q) => X >= q.minX && X <= q.maxX && Z >= q.minZ && Z <= q.maxZ && ly >= q.minY && ly <= q.maxY)) { chainFail++; chainFirst = chainFirst || [id, ry]; }
        }
      }
      for (const q of cs) {
        for (let t = 0; t < 6; t++) {
          const X = q.minX + (q.maxX - q.minX) * rng(), Z = q.minZ + (q.maxZ - q.minZ) * rng();
          ptsOut++;
          const d = Math.min(...m.colliders.map((b) => distToRect(X, Z, b, c, s, 10, 20)));
          if (d > chainWorst) chainWorst = d;
        }
      }
    }
  }
  ok(chainFail === 0, "a non-quarter yaw's boxes cover every one of " + ptsIn + " sampled points of the true rotated boxes (" + chainN + " type x angle cases)", { chainFail, chainFirst });
  ok(cornerFail === 0, "all " + cornerN + " true corners of the rotated boxes lie inside a strip with zero slack (outward rounding)", { cornerFail, chainFirst });
  ok(chainWorst <= SLACK, "and reach at most " + SLACK + " m beyond the true box (" + ptsOut + " sampled points, worst " + chainWorst.toFixed(3) + " m; the Wave-4 defect was 8.4 m)", chainWorst);
  console.log("  INFO  non-quarter staircase: " + (chainBoxes / chainN).toFixed(1) + " boxes per instance on average, at most " + chainMax);
  ok(K.colliderFor("suburban/building-type-a", 0, 0, 0, 0.5).length > K.colliderFor("suburban/building-type-a", 0, 0, 0, 1).length, "a yawed house needs more boxes than a quarter-turned one; a quarter-turned one needs exactly the manifest's");
  ok(dump(K.colliderFor("commercial/building-e", 3, 0, 4, 0.5)) === dump(K.colliderFor("commercial/building-e", 3, 0, 4, 0.5)) && K.colliderFor("commercial/building-e", 3, 0, 4, 0.5).every((q) => q.kind === "box" && q.prop === null), "the staircase is deterministic and made of plain mkCollider boxes");

  // ---------------------------------------------------------------- rejects bad input loudly, normalises entries
  const throws = (f) => { try { f(); return false; } catch (e) { return true; } };
  ok(throws(() => K.colliderFor("nope/none", 0, 0, 0, 0)) && throws(() => K.colliderFor("cars/sedan", NaN, 0, 0, 0)) && throws(() => K.colliderFor("cars/sedan", 0, 0, 0, 0, -1)) && throws(() => K.localBoxes("x")), "colliderFor / localBoxes throw on an unknown type, a non-finite position or a bad scale");
  const NE = K.normaliseEntry;
  ok(NE({ type: "cars/sedan", x: 1, y: 2, z: 3, rot: 2, district: "d" }, 5).q === 2 && NE({ type: "cars/sedan", x: 1, y: 2, z: 3 }, 0).k === 1 && NE({ type: "cars/sedan", x: 1, y: 2, z: 3, scale: 1.2 }, 0).k === 1.2, "normaliseEntry: rot, scale default, district");
  ok(NE({ type: "cars/sedan", x: 0, y: 0, z: 0, tint: 0x336699 }, 0).tint === 0x336699 && NE({ type: "cars/sedan", x: 0, y: 0, z: 0, tint: "#ff8800" }, 0).tint === 0xff8800 && NE({ type: "cars/sedan", x: 0, y: 0, z: 0 }, 0).tint === null && NE({ type: "cars/sedan", x: 0, y: 0, z: 0, tint: "zz" }, 0).tint === null && NE({ type: "cars/sedan", x: 0, y: 0, z: 0, tint: -5 }, 0).tint === (-5 >>> 0 & 0xffffff), "normaliseEntry (Wave 7 polish): a car's tint (a number or #rrggbb) is kept, a missing or unparsable one is null");
  ok(NE(null, 0).bad && NE({ x: 1, y: 2, z: 3 }, 0).bad && NE({ type: "a", x: NaN, y: 0, z: 0 }, 0).bad && NE({ type: "a", x: 0, y: 0, z: 0, scale: 0 }, 0).bad, "normaliseEntry reports a missing type, a non-finite position and a zero scale");

  // ---------------------------------------------------------------- the colliders-only place() path (no THREE: this is a squad client with nothing but the table)
  const kit = K.createCityKit({});
  const list = [
    { type: "suburban/building-type-a", x: 0, y: 0, z: 0, rot: 0, district: "A" }, { type: "cars/sedan", x: 20, y: 0, z: 5, rot: 3, district: "A" },
    { type: "nope", x: 0, y: 0, z: 0 }, { type: "props/hydrant", x: 5, y: 1, z: 5, rot: 1, district: "B" }, { type: "commercial/building-m", x: -50, y: 0, z: 9, rot: 2, scale: 1.25, district: "B" },
  ];
  const res = await kit.place(list, { draw: false });
  const want = [].concat(K.colliderFor(list[0].type, 0, 0, 0, 0), K.colliderFor(list[1].type, 20, 0, 5, 3), K.colliderFor(list[3].type, 5, 1, 5, 1), K.colliderFor(list[4].type, -50, 0, 9, 2, 1.25));
  ok(dump(res.colliders) === dump(want), "place({draw:false}) returns the colliders of every valid entry, in list order, with no THREE", res.colliders.length);
  ok(res.meshes.length === 0 && res.skipped.length === 1 && res.skipped[0].i === 2 && res.skipped[0].reason === "unknown type", "an unknown type is skipped and reported, not thrown", res.skipped);
  ok(res.ranges.length === list.length * 2 && res.ranges[0] === 0 && res.ranges[1] === K.colliderFor(list[0].type, 0, 0, 0, 0).length && res.ranges[4] === 0 && res.ranges[5] === 0 && res.ranges[6] === res.ranges[2] + res.ranges[3], "ranges[] gives [start, count] per list index (count 0 for the skipped one)", Array.from(res.ranges));
  const tinted = await K.createCityKit({}).place(list.map((e) => Object.assign({}, e, { tint: 0x336699 })), { draw: false });
  ok(dump(tinted.colliders) === dump(res.colliders), "a paint (tint) never changes a collider: the same list with every entry tinted gives the identical colliders");
  const res2 = await K.createCityKit({}).place(list.slice().reverse().reverse(), { draw: false });
  ok(dump(res2.colliders) === dump(res.colliders), "a second kit instance gives the identical list (no module state)");
  const noThree = await K.createCityKit({}).place(list, {});
  ok(dump(noThree.colliders) === dump(res.colliders) && noThree.meshes.length === 0 && /no THREE/.test(noThree.error || ""), "asked to draw with no THREE it still returns every collider and says why it drew nothing", noThree.error);
  ok(kit.dispose().instancedMeshes === 0 && kit.disposed, "dispose() on a kit that drew nothing is a clean no-op");

  // ---------------------------------------------------------------- palettes and themes
  const RP = K.resolvePalette;
  ok(RP("suburban", "slate", "city").variant === "slate" && RP("suburban", "slate", "city").tint === 0xffffff, "an explicit variant is taken literally (no tint)");
  ok(RP("suburban", "resort", "city").variant === K.THEMES.resort.variant.suburban && RP("commercial", undefined, "ruin").variant === K.THEMES.ruin.variant.commercial && RP("commercial", undefined, "ruin").tint === K.THEMES.ruin.tint && RP("suburban", undefined, undefined).variant === K.THEMES.city.variant.suburban, "a theme name (per entry) or the district theme (default city) picks the recoloured colormap");
  ok(RP("car", "ruin", "ruin").variant === "base" && RP("car", "ruin", "ruin").tint === 0xffffff && RP("roads", undefined, "lodge").id === "roads:base:ffffff" && RP(null, "ruin").key === null, "cars, roads, graveyard and quaternius props keep their authored colours in every theme");
  ok(RP("suburban", undefined, "ruin").id !== RP("suburban", undefined, "city").id && RP("suburban", "base", "x").id === "suburban:base:ffffff", "different themes give different shared-texture ids; one id per (palette, variant, tint)");
  const themes = Object.keys(K.THEMES);
  ok(themes.join() === "city,resort,lodge,farm,ruin,mill", "the six O2 themes: city, resort, lodge, farm, ruin, mill", themes);
  let themeFail = [];
  for (const t of themes) {
    const th = K.THEMES[t];
    for (const key of ["suburban", "commercial"]) {
      const v = th.variant[key], pal = manifest.palettes[key];
      if (v !== "base" && !(pal.variants && pal.variants[v])) themeFail.push(t + ":" + key + ":" + v);
    }
    if (!(th.tint >= 0 && th.tint <= 0xffffff)) themeFail.push(t + ":tint");
    for (const role of Object.keys(K.THEME_TYPES[t] || {})) for (const id of K.THEME_TYPES[t][role]) { if (!manifest.types[id]) themeFail.push(t + ":" + id + " (not a type)"); }
  }
  ok(themeFail.length === 0, "every theme's variants exist in manifest.json's palettes and every suggested type exists", themeFail);
  ok(themes.every((t) => K.THEME_TYPES[t] && Object.keys(K.THEME_TYPES[t]).length >= 3), "every theme suggests types for at least three roles", themes.filter((t) => !K.THEME_TYPES[t]));
  // roles in THEME_TYPES agree with the manifest's own role field
  let roleFail = [];
  for (const t of themes) for (const role of Object.keys(K.THEME_TYPES[t])) for (const id of K.THEME_TYPES[t][role]) { const mr = manifest.types[id].role; if (mr !== role) roleFail.push(t + ":" + id + " is " + mr + ", not " + role); }
  ok(roleFail.length === 0, "the roles THEME_TYPES files each type under are the manifest's roles", roleFail.slice(0, 4));
  // the far proxy colours cover every building type that carries a palette, in all four variants
  const bld = mIds.filter((id) => manifest.types[id].kind === "building" && manifest.types[id].palette);
  const src2 = fs.readFileSync(path.join(__dirname, "citykit.js"), "utf8");
  const pcBlock = /const PROXY_COLORS = Object\.freeze\(\{([\s\S]*?)\n\}\);/.exec(src2);
  const pcRows = {};
  if (pcBlock) for (const m of pcBlock[1].matchAll(/"([^"]+)":\s*\[([^\]]+)\]/g)) pcRows[m[1]] = m[2].split(",").map((s) => parseInt(s.trim(), 16));
  ok(bld.length === 27 && bld.every((id) => pcRows[id] && pcRows[id].length === 8 && pcRows[id].every((v) => v >= 0 && v <= 0xffffff)), "PROXY_COLORS holds wall + roof for all 27 palette-textured buildings in all 4 variants", { buildings: bld.length, rows: Object.keys(pcRows).length });

  // Wave 7b: the theme colourways (manifest.themes, written by art_b_city.py) are in VARIANT_ORDER, have far-proxy colours, and THEMES / THEME_TYPES agree with the manifest's record
  {
    const vo = /const VARIANT_ORDER = \[([^\]]*)\]/.exec(src2), order = vo ? vo[1].split(",").map((s) => s.trim().replace(/"/g, "")) : [];
    const pxBlock = /const PROXY_COLORS_X = Object\.freeze\(\{([\s\S]*?)\n\}\);/.exec(src2), pxRows = {};
    if (pxBlock) for (const m of pxBlock[1].matchAll(/"([^"]+)":\s*\[([^\]]+)\]/g)) pxRows[m[1]] = m[2].split(",").map((s) => parseInt(s.trim(), 16));
    const mt = manifest.themes || {}, tv = [];
    for (const t of Object.keys(mt)) for (const key of Object.keys(mt[t].variants)) for (const v of mt[t].variants[key]) if (!tv.includes(v)) tv.push(v);
    const missing = [];
    for (const v of tv) { if (!order.includes(v)) missing.push("VARIANT_ORDER:" + v); for (const key of ["suburban", "commercial"]) if (!(manifest.palettes[key].variants || {})[v]) missing.push(key + ":" + v + " (no palette file)"); }
    ok(tv.length >= 12 && missing.length === 0 && order.slice(0, 4).join() === "base,slate,brick,sand" && order.slice(4).join() === tv.join(), "VARIANT_ORDER = the four shipped colormaps + every manifest theme colourway in manifest order, each with a palette file", missing.concat(order.slice(4).join() === tv.join() ? [] : ["order differs"]));
    ok(bld.every((id) => pxRows[id] && pxRows[id].length === 2 * tv.length && pxRows[id].every((v) => v >= 0 && v <= 0xffffff)), "PROXY_COLORS_X holds wall + roof for all 27 palette-textured buildings in every theme colourway", { rows: Object.keys(pxRows).length });
    const drift = [];
    for (const t of Object.keys(mt)) {
      const th = K.THEMES[t], types = K.THEME_TYPES[t];
      if (!th) { drift.push(t + ": no THEMES entry"); continue; }
      for (const key of ["suburban", "commercial"]) if (th.variant[key] !== mt[t].variants[key][0]) drift.push(t + ":" + key + " default is " + th.variant[key] + ", manifest says " + mt[t].variants[key][0]);
      if (JSON.stringify(types) !== JSON.stringify(mt[t].types)) drift.push(t + ": THEME_TYPES differs from manifest.themes." + t + ".types");
      if (th.tint !== parseInt(mt[t].tint, 16)) drift.push(t + ": tint");
    }
    ok(drift.length === 0, "THEMES / THEME_TYPES of every manifest theme equal manifest.json's themes block (the generator's record)", drift);
  }

  // the car-paint shader (Wave 7 polish): only the saturated body swatch is recoloured, one program for every car, installed on the "car" palette's material only
  {
    const src3 = fs.readFileSync(path.join(__dirname, "citykit.js"), "utf8");
    ok(/function installCarPaint\(m\)/.test(src3) && /if \(pal\.key === "car"\) installCarPaint\(m\)/.test(src3), "the car-paint shader is installed on the car palette's material and on no other");
    ok(/smoothstep\(0\.55, 0\.75,/.test(src3) && /vColor\.r \+ vColor\.g \+ vColor\.b < 2\.999/.test(src3) && /customProgramCacheKey/.test(src3), "the car paint recolours only saturated texels (glass, tyres, greys keep the texture), leaves an untinted (white) car untouched, and has a fixed program key");
    ok(/if \(T\.kind === "car"\) \{ _carCol\.setHex\(it\.tint == null \? 0xffffff : it\.tint\)/.test(src3), "every car instance carries an instance colour (white = untouched), so all cars of a kit share one program variant");
  }

  // the vertical stretch `sy` (Wave 7 completion): a skyline tower drawn taller than it was modelled - Y extents scale, X / Z stay exact, the default is the unstretched table
  {
    let bad = [], n = 0;
    for (const id of K.typeIds()) {
      for (const [q, sy] of [[0, 1.5], [1, 1.25], [3, 1.8]]) {
        const a = K.colliderFor(id, 3, 7, -2, q, 1), b = K.colliderFor(id, 3, 7, -2, q, 1, sy);
        n++;
        if (a.length !== b.length) { bad.push(id + " box count"); continue; }
        for (let i = 0; i < a.length; i++) {
          const A = a[i], B = b[i];
          if (A.minX !== B.minX || A.maxX !== B.maxX || A.minZ !== B.minZ || A.maxZ !== B.maxZ) { bad.push(id + " q" + q + " x/z moved"); break; }
          if (Math.abs((B.minY - 7) - (A.minY - 7) * sy) > 1e-9 || Math.abs((B.maxY - 7) - (A.maxY - 7) * sy) > 1e-9) { bad.push(id + " q" + q + " y not scaled"); break; }
        }
      }
    }
    ok(bad.length === 0, "colliderFor(..., sy) scales every box's Y extent about the ground and leaves X and Z exact (" + n + " type x turn x stretch combinations)", bad.slice(0, 3));
    const same = K.typeIds().every((id) => JSON.stringify(K.colliderFor(id, 1, 2, 3, 1, 1)) === JSON.stringify(K.colliderFor(id, 1, 2, 3, 1, 1, 1)) && JSON.stringify(K.colliderFor(id, 1, 2, 3, 1, 1)) === JSON.stringify(K.colliderFor(id, 1, 2, 3, 1, 1, null)));
    ok(same, "sy omitted, null and 1 give the very same colliders (every existing caller is unchanged)");
    const fp = K.footprintFor("skyscraper/building-skyscraper-b", 0, 0, 0, 1, 1.5), fp1 = K.footprintFor("skyscraper/building-skyscraper-b", 0, 0, 0, 1);
    ok(Math.abs(fp.height - fp1.height * 1.5) < 1e-9 && fp.w === fp1.w && fp.d === fp1.d, "footprintFor carries sy: 53.76 m x 1.5 = " + fp.height.toFixed(2) + " m tall, the same footprint", [fp, fp1]);
    ok(K.normaliseEntry({ type: "skyscraper/building-skyscraper-a", x: 0, y: 0, z: 0, sy: 1.4 }, 0).sy === 1.4 && K.normaliseEntry({ type: "skyscraper/building-skyscraper-a", x: 0, y: 0, z: 0 }, 0).sy === 1 && K.normaliseEntry({ type: "skyscraper/building-skyscraper-a", x: 0, y: 0, z: 0, sy: -2 }, 0).bad, "normaliseEntry: sy defaults to 1, a positive one is kept, a non-positive one is refused");
    let thrown = false; try { K.colliderFor("props/hydrant", 0, 0, 0, 0, 1, 0); } catch (e) { thrown = true; }
    ok(thrown, "colliderFor refuses a zero vertical stretch");
    const src4 = fs.readFileSync(path.join(__dirname, "citykit.js"), "utf8");
    ok(/scy = sc \* it\.sy/.test(src4) && /0, scy, 0, it\.y - c0\[1\]/.test(src4) && /T\[o \+ 1\] \* it\.k \* it\.sy/.test(src4), "the drawn instance matrix and the far proxy boxes stretch by sy exactly as the colliders do (one vertical scale in three places)");
  }

  // ---------------------------------------------------------------- budget
  const dt = (Date.now() - T0) / 1000;
  ok(dt < 20, "the selftest runs in under 20 s (gate.py's budget)", dt);
  console.log("\n" + passed + " passed, " + failed + " failed (" + dt.toFixed(1) + " s)");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("selftest crashed:", e && e.stack || e); process.exit(1); });
