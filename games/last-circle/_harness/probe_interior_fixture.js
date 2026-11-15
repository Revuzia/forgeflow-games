// probe_interior_fixture.js - interiorcheck's REFERENCE furnished house (Wave 8 stage A, lane H3). An expression (IIFE) that installs
// globalThis.__LCINT_FIXTURE__ = build(THREE, { x, y, z, plinthDown, plant }) -> { group, colliders, record }.
//
// What it is for: the gate's own selftest (every row must PASS on it, every planted fault must FAIL on it) and the contract it shows housegen:
// the record shape interiorcheck reads (rooms with floor / y / ceil / holes, furniture with its box, loot points), drawn meshes whose
// userData.lcPart says what they are (wall / floor / ceiling / stair / furniture / glass), and colliders in the game's own format
// ({ kind: 'box' | 'ramp', minX..maxZ, dir, dead: false }, ramps exact). Two storeys on a 10 x 12.5 m footprint (the 2.5 m grid):
// ground floor = a living room (front door 2.2 m wide in -z, a window in each side wall) and a kitchen behind an interior door, a straight
// stair (ramp collider + stepped visual) along the kitchen's +x wall up to a bedroom over the whole footprint. Every wall piece is drawn
// exactly where its collider is (so visual and collider cannot disagree), windows have glass panes (transparent, no collider: shootable).
(() => {
  function build(THREE, opt) {
    opt = opt || {};
    const ox = opt.x || 0, oz = opt.z || 0, oy = opt.y || 0, plant = opt.plant || null;
    const group = new THREE.Group(); group.name = "lcint-fixture";
    const colliders = [];
    const M = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.85 }, o || {}));
    const mWall = M("#d9cdb8"), mFloor = M("#8a6a48"), mCeil = M("#efe9df"), mRoof = M("#6b4a3a"), mStair = M("#7a5a3e");
    const mGlass = M("#9fd0e8", { transparent: true, opacity: 0.28, depthWrite: false });
    const mF = [M("#4a6fa5"), M("#a0522d"), M("#556b2f"), M("#8b8b83"), M("#c19a6b"), M("#704214")];
    const geo = new THREE.BoxGeometry(1, 1, 1);
    // a box in WORLD coordinates (centre-free: min/max), drawn and (optionally) collided
    function box(x0, x1, y0, y1, z0, z1, mat, part, collide, extra) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(ox + (x0 + x1) / 2, oy + (y0 + y1) / 2, oz + (z0 + z1) / 2); m.scale.set(x1 - x0, y1 - y0, z1 - z0);
      m.userData.lcPart = part; m.castShadow = part !== "glass"; m.receiveShadow = true;
      group.add(m);
      let c = null;
      if (collide) { c = Object.assign({ kind: "box", minX: ox + x0, maxX: ox + x1, minY: oy + y0, maxY: oy + y1, minZ: oz + z0, maxZ: oz + z1, dir: 0, prop: null, idx: 0, hp: 0, dead: false, _qs: 0, lcPart: part }, extra || {}); colliders.push(c); }
      return { m, c };
    }
    const T = 0.2, HX = 5, HZ = 6.25, F0 = 0.2, UP = 3.0, F1 = F0 + UP, CEIL0 = 3.0, CEIL1 = 6.0;
    const ix = HX - T / 2, iz = HZ - T / 2;          // inner faces 4.9 / 6.15
    // floor slab (a plinth down into the ground when the terrain is uneven) - the ground-floor FLOOR
    box(-HX - T / 2, HX + T / 2, -(opt.plinthDown || 0), F0, -HZ - T / 2, HZ + T / 2, mFloor, "floor", true);
    // a wall along x at z = zc from x0..x1 for the storey starting at fy (floor top), with openings [{a0, a1, y0, y1}] (along x, heights from the floor)
    function wallX(zc, x0, x1, fy, top, openings) {
      const pieces = [];
      let a = x0;
      const ops = (openings || []).slice().sort((p, q) => p.a0 - q.a0);
      for (const o of ops) {
        if (o.a0 > a) box(a, o.a0, fy, top, zc - T / 2, zc + T / 2, mWall, "wall", true);
        if (o.y0 > 0) box(o.a0, o.a1, fy, fy + o.y0, zc - T / 2, zc + T / 2, mWall, "wall", true);     // sill
        if (fy + o.y1 < top) box(o.a0, o.a1, fy + o.y1, top, zc - T / 2, zc + T / 2, mWall, "wall", true);  // header / lintel
        if (o.glass) box(o.a0, o.a1, fy + o.y0, fy + o.y1, zc - 0.01, zc + 0.01, mGlass, "glass", false);
        a = o.a1;
      }
      if (a < x1) box(a, x1, fy, top, zc - T / 2, zc + T / 2, mWall, "wall", true);
      return pieces;
    }
    function wallZ(xc, z0, z1, fy, top, openings) {
      let a = z0;
      const ops = (openings || []).slice().sort((p, q) => p.a0 - q.a0);
      for (const o of ops) {
        if (o.a0 > a) box(xc - T / 2, xc + T / 2, fy, top, a, o.a0, mWall, "wall", true);
        if (o.y0 > 0) box(xc - T / 2, xc + T / 2, fy, fy + o.y0, o.a0, o.a1, mWall, "wall", true);
        if (fy + o.y1 < top) box(xc - T / 2, xc + T / 2, fy + o.y1, top, o.a0, o.a1, mWall, "wall", true);
        if (o.glass) box(xc - 0.01, xc + 0.01, fy + o.y0, fy + o.y1, o.a0, o.a1, mGlass, "glass", false);
        a = o.a1;
      }
      if (a < z1) box(xc - T / 2, xc + T / 2, fy, top, a, z1, mWall, "wall", true);
    }
    const DOOR = { y0: 0, y1: 2.3 }, WIN = { y0: 1.2, y1: 2.3, glass: true };
    // ground storey walls (F0 .. CEIL0 = the underside of the upper slab)
    wallX(-HZ, -HX - T / 2, HX + T / 2, F0, CEIL0, [Object.assign({ a0: -1.1, a1: 1.1 }, DOOR), Object.assign({ a0: 2.4, a1: 3.6 }, WIN)]);          // front: door + window
    wallX(HZ, -HX - T / 2, HX + T / 2, F0, CEIL0, [Object.assign({ a0: -3.6, a1: -2.4 }, WIN)]);                                                // back: a window
    wallZ(-HX, -HZ + T / 2, HZ - T / 2, F0, CEIL0, [Object.assign({ a0: -3.6, a1: -2.4 }, WIN), Object.assign({ a0: 2.4, a1: 3.6 }, WIN)]);   // left: two windows
    wallZ(HX, -HZ + T / 2, HZ - T / 2, F0, CEIL0, [Object.assign({ a0: -3.6, a1: -2.4 }, WIN)]);                                               // right: one window (the stair runs along it behind)
    // the partition at z = 0 with a 2.2 m interior door
    wallX(0, -ix, ix, F0, CEIL0, [Object.assign({ a0: -3.4, a1: -1.2 }, DOOR)]);
    // the stair: ramp collider along the kitchen's +x wall, rising toward +z from z 1.0 to 5.05 (36.5 deg), x 2.9 .. 4.9; a stepped visual inside it
    const rx0 = ix - 2.0, rx1 = ix, rz0 = 1.0, run = 1.35 * UP, rz1 = rz0 + run;
    colliders.push({ kind: "ramp", minX: ox + rx0, maxX: ox + rx1, minY: oy + F0, maxY: oy + F1, minZ: oz + rz0, maxZ: oz + rz1, dir: 2, prop: null, idx: 0, hp: 0, dead: false, _qs: 0, lcPart: "stair" });
    const NS = 15;
    for (let s = 0; s < NS; s++) {
      const z0 = rz0 + (s / NS) * run, z1 = rz0 + ((s + 1) / NS) * run, top = F0 + ((s + 1) / NS) * UP;
      box(rx0, rx1, F0, top, z0, z1, mStair, "stair", false);
    }
    // the upper slab (ceiling of the ground floor, floor of the bedroom) with the stairwell hole over the ramp
    const hx0 = rx0 - 0.1, hx1 = rx1, hz0 = rz0 - 0.1, hz1 = rz1;
    const slab = (x0, x1, z0, z1) => { if (x1 - x0 > 0.01 && z1 - z0 > 0.01) { box(x0, x1, CEIL0, F1, z0, z1, mFloor, "floor", true); } };
    slab(-ix, hx0, -iz, iz); slab(hx0, ix, -iz, hz0); slab(hx0, ix, hz1, iz);
    // a painted ceiling under the slab (cosmetic, 1 cm, no collider): the ground floor's ceiling
    const ceil = (x0, x1, z0, z1) => { if (x1 - x0 > 0.01 && z1 - z0 > 0.01 && plant !== "no-ceiling") box(x0, x1, CEIL0 - 0.01, CEIL0, z0, z1, mCeil, "ceiling", false); };
    ceil(-ix, hx0, -iz, iz); ceil(hx0, ix, -iz, hz0); ceil(hx0, ix, hz1, iz);
    // a rail on the open side of the stairwell (1.0 m, so nobody walks into the hole from the bedroom)
    box(hx0 - 0.08, hx0, F1, F1 + 1.0, hz0 + 1.2, hz1, mStair, "wall", true);
    // upper storey walls (F1 .. CEIL1)
    wallX(-HZ, -HX - T / 2, HX + T / 2, F1, CEIL1, [Object.assign({ a0: -2.4, a1: -1.2 }, WIN), Object.assign({ a0: 1.2, a1: 2.4 }, WIN)]);
    wallX(HZ, -HX - T / 2, HX + T / 2, F1, CEIL1, [Object.assign({ a0: -0.6, a1: 0.6 }, WIN)]);
    wallZ(-HX, -HZ + T / 2, HZ - T / 2, F1, CEIL1, [Object.assign({ a0: -0.6, a1: 0.6 }, WIN)]);
    wallZ(HX, -HZ + T / 2, HZ - T / 2, F1, CEIL1, [Object.assign({ a0: -3.6, a1: -2.4 }, WIN)]);
    // the roof deck (its underside is the bedroom's ceiling) + a cosmetic ceiling
    box(-HX - 0.5, HX + 0.5, CEIL1, CEIL1 + 0.3, -HZ - 0.5, HZ + 0.5, mRoof, "roof", true);
    if (plant !== "no-ceiling") box(-ix, ix, CEIL1 - 0.01, CEIL1, -iz, iz, mCeil, "ceiling", false);
    else group.children.filter((m) => m.userData.lcPart === "roof").forEach((m) => { m.visible = false; });       // no-ceiling: the top storey is open to the sky (the roof is not drawn; its collider stays)
    // furniture (local frame), each a drawn box with its own collider (lcFurniture) unless noCollide
    const furniture = [];
    function piece(kind, x0, x1, y0, y1, z0, z1, mat, noCollide) {
      if (plant === "empty-room" && z0 > 0 && y0 < F1 - 0.5) return;          // empty-room: the kitchen (z > 0, ground floor) holds no furniture at all
      const b = box(x0, x1, y0, y1, z0, z1, mat, "furniture", !noCollide, { lcFurniture: true });
      b.m.userData.lcFurniture = kind;
      furniture.push({ kind, minX: ox + x0, maxX: ox + x1, minY: oy + y0, maxY: oy + y1, minZ: oz + z0, maxZ: oz + z1, col: b.c, obj: b.m });
    }
    // living room (z -6.15 .. -0.1), front door at x -1.1 .. 1.1 on z -6.25, interior door x -3.4 .. -1.2 on z 0
    piece("sofa", -4.85, -3.95, F0, F0 + 0.85, -4.6, -2.4, mF[0]);
    piece("coffee-table", -1.7, -0.9, F0, F0 + 0.45, -3.6, -2.6, mF[1]);  // (lane I4: was x -3.3 .. -2.5, z -4.1 .. -2.9 - with own pieces only, the third-person view from the
                                                                          //  front door showed 2 of the living room's pieces: tv-stand + armchair)
    piece("tv-stand", 2.3, 4.85, F0, F0 + 0.6, -1.0, -0.15, mF[3]);
    piece("armchair", 1.6, 2.6, F0, F0 + 0.9, -3.4, -2.4, mF[2]);        // (lane I4: was x 3.6 .. 4.6, z -4.6 .. -3.6 - outside the front door's view, so the living room passed
                                                                          //  furniture-view only on the kitchen's counter + fridge seen through the interior door)
    piece("bookshelf", -4.85, -4.45, F0, F0 + 2.0, -1.6, -0.2, mF[5]);
    // kitchen (z 0.1 .. 6.15): counter along -x, table + chairs, fridge; the stair occupies x 2.9 .. 4.9, z 1.0 .. 5.05
    piece("counter", -4.85, -4.25, F0, F0 + 0.92, 2.0, 5.2, mF[4]);
    piece("fridge", -4.85, -4.15, F0, F0 + 1.85, 5.35, 6.1, mF[3]);
    piece("table", -1.6, 0.4, F0, F0 + 0.76, 2.6, 3.8, mF[1]);
    piece("chair", -1.2, -0.7, F0, F0 + 0.95, 4.0, 4.5, mF[2]);
    piece("chair", -0.3, 0.2, F0, F0 + 0.95, 1.9, 2.4, mF[2]);
    // bedroom (whole footprint at F1)
    piece("bed", -4.85, -2.85, F1, F1 + 0.6, -5.0, -2.8, mF[0]);
    piece("wardrobe", -4.85, -4.25, F1, F1 + 2.1, 0.5, 2.3, mF[5]);
    piece("desk", 2.0, 3.6, F1, F1 + 0.76, -6.1, -5.4, mF[4]);
    piece("dresser", -1.0, 0.4, F1, F1 + 0.9, 5.6, 6.1, mF[1]);
    piece("rug", -1.5, 1.0, F1, F1 + 0.02, -2.0, 0.5, mF[2], true);
    if (plant === "furniture-in-door") piece("planted-crate", -0.7, 0.7, F0, F0 + 1.0, -6.0, -5.2, mF[3]);        // in front of the front door, inside
    // crate-steps (Wave 8 stage B, lane I4): the front door can be reached ONLY over furniture tops - a 0.7 m counter against the wall in front of the door
    // (1.8 m under the 2.5 m header: a body still fits on it) and a 0.4 m step outside it. The real mover can climb it (rises 0.4 / 0.3, then 0.5 down to the
    // 0.2 m threshold; its step is 0.55 m); a planner that stands on furniture tops plans through it, the VERSION-2 planner (floors only) must not -> reach FAILS
    if (plant === "crate-steps") {
      piece("planted-counter", -2.0, 2.0, -0.3, 0.7, -HZ - 1.1 - T / 2, -HZ - T / 2, mF[3]);
      piece("planted-step-out", -1.0, 1.0, -0.3, 0.4, -HZ - 1.7 - T / 2, -HZ - 1.1 - T / 2, mF[4]);
    }
    if (plant === "window-solid") colliders.push({ kind: "box", minX: ox + HX - T / 2, maxX: ox + HX + T / 2, minY: oy + F0 + 1.2, maxY: oy + F0 + 2.3, minZ: oz - 3.6, maxZ: oz - 2.4, dir: 0, prop: null, idx: 0, hp: 0, dead: false, _qs: 0, lcPart: "planted" });
    const rooms = [
      { id: "living", floor: 0, minX: ox - ix, maxX: ox + ix, minZ: oz - iz, maxZ: oz - 0.1, y: oy + F0, ceil: oy + CEIL0 - 0.01 },
      { id: "kitchen", floor: 0, minX: ox - ix, maxX: ox + ix, minZ: oz + 0.1, maxZ: oz + iz, y: oy + F0, ceil: oy + CEIL0 - 0.01 },
      { id: "bedroom", floor: 1, minX: ox - ix, maxX: ox + ix, minZ: oz - iz, maxZ: oz + iz, y: oy + F1, ceil: oy + CEIL1 - 0.01, holes: [{ minX: ox + hx0 - 0.08, maxX: ox + hx1, minZ: oz + hz0, maxZ: oz + hz1 }] },
    ];
    const loot = [{ x: ox - 1.5, y: oy + F0 + 0.5, z: oz - 1.5 }, { x: ox + 1.6, y: oy + F0 + 0.5, z: oz + 5.4 }, { x: ox + 0.5, y: oy + F1 + 0.5, z: oz - 3.5 }];
    group.updateMatrixWorld(true);
    const record = { id: "fixture", x: ox, z: oz, y: oy, rooms, furniture: furniture.map((f) => ({ kind: f.kind, minX: f.minX, maxX: f.maxX, minY: f.minY, maxY: f.maxY, minZ: f.minZ, maxZ: f.maxZ, col: f.col })), loot,
      bbox: { minX: ox - HX - 0.5, maxX: ox + HX + 0.5, minY: oy - (opt.plinthDown || 0), maxY: oy + CEIL1 + 0.3, minZ: oz - HZ - 0.5, maxZ: oz + HZ + 0.5 } };
    return { group, colliders, record };
  }
  globalThis.__LCINT_FIXTURE__ = build;
  return 1;
})()
