// probe_interior_page.js - the in-page half of interiorcheck.py (Wave 8 stage A, lane H3). An expression (IIFE) evaluated AFTER probe_interior.js
// (and, for the fixture, probe_interior_fixture.js); installs window.__LCINT_PAGE__. READ-ONLY on the game's files: everything it changes lives
// in this throwaway page (a teleported player, a house added to the scene for the fixture / housegen sources, a wrapper round queryColliders that
// adds that house's colliders, planted faults applied to the in-memory house).
//
//   setup({ source: 'match' | 'fixture' | 'housegen', plant, seed })  -> builds the world adapter; for fixture / housegen stands the house(s) on a
//        flat dry spot of the running PRACTICE map (real terrain under them, the game's real lighting, camera, mover and bullets)
//   houses({ max, seed })   -> the normalized houses: map records when the map exposes them (stage B), else navcheck's room survey
//   judge(i)                -> probe_interior.js judgeStatic on house i (drawn triangles collected from the live scene under it)
//   reach(i)                -> the REAL mover: the human player stepped by C.fastForward (stepActor) street -> room -> street, street -> loot -> street
//   camwall(i)              -> Wave 4's camera pull-in inside house i (lens never inside / behind a wall box; W.noCamWall must violate)
//   views(i, opt)           -> the third-person view from each room entrance and room centre, rendered by the game: mean luminance, dark share,
//                              per-piece furniture pixels (each piece hidden in turn, same frame), calls / triangles; PNG data URLs for the shots
(() => {
  const C = window.__LC__, W = C.W, I = window.__LCINT__;
  const r2 = (v) => Math.round(v * 100) / 100;
  const P = {};
  let world = null, HOUSES = [], injected = [], extraCols = [];
  // drawn-mesh tag for a real map (names maps.js / citykit give), overridden by userData.lcPart (fixture / housegen)
  function classify(o, m) {
    for (let q = o; q; q = q.parent) {
      const p = q.userData && q.userData.lcPart;
      if (p) return p === "furniture" ? I.T_FURN : p === "glass" ? I.T_GLASS : p === "terrain" ? I.T_TERRAIN : p === "soft" || p === "decal" ? I.T_SOFT : I.T_STRUCT;
      if (q.userData && q.userData.lcFurniture) return I.T_FURN;
      const n = q.name || "";
      if (n === "terrain") return I.T_TERRAIN;
      if (n === "water" || n === "sky" || /^lcint-ignore/.test(n)) return I.T_OTHER;
      if (/clutter|grass|roads|paint|mark|decal|yard|curb|kerb|island:tops/i.test(n)) return I.T_SOFT;
      if (n === "furniture" || /^housegen:.*:furn|furniture/i.test(n)) return I.T_FURN;      // housegen's furniture group (stage B: keep the name or userData.lcPart)
    }
    if (m && m.transparent && (m.opacity == null || m.opacity < 0.6)) return I.T_GLASS;
    if (m && (m.colorWrite === false || m.depthWrite === false && m.transparent)) return I.T_OTHER;
    return I.T_STRUCT;
  }
  function baseWorld() {
    const M = W.map;
    return {
      heightAt: (x, z) => M.heightAt(x, z), waterY: M.waterY,
      query: (x, z, r) => M.queryColliders(x, z, r, []).slice(),
      segment: (ax, ay, az, bx, by, bz, cols) => W.SIM.segmentColliders(ax, ay, az, bx, by, bz, cols),
      rampBlocks: (c, x, z, y, h, r, su) => W.SIM.rampBlocks(c, x, z, y, h, r, su),
      tris: null,
    };
  }
  // a dry, level, empty spot near (x0, z0) for a footprint of w x d metres: terrain range <= 0.8 m, no collider within 4 m
  const taken = [];
  function flatSpot(x0, z0, w, d, opt_range) {
    if (opt_range == null) { for (const rg of [0.25, 0.35, 0.45]) { const s = flatSpot(x0, z0, w, d, rg); if (s) return s; } return null; }
    const M = W.map;
    for (let ring = 0; ring < 40; ring++) for (let k = 0; k < Math.max(1, ring * 8); k++) {
      const a = (k / Math.max(1, ring * 8)) * Math.PI * 2, x = x0 + Math.cos(a) * ring * 12, z = z0 + Math.sin(a) * ring * 12;
      if (Math.abs(x) > M.half - 40 || Math.abs(z) > M.half - 40) continue;
      let lo = 1e9, hi = -1e9;
      for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) { const h = M.heightAt(x - w / 2 - 2 + (w + 4) * i / 8, z - d / 2 - 2 + (d + 4) * j / 8); lo = Math.min(lo, h); hi = Math.max(hi, h); }
      if (hi - lo > opt_range || lo < M.waterY + 0.6) continue;
      if (M.queryColliders(x, z, Math.hypot(w, d) / 2 + 4, []).length) continue;
      if (taken.some((t) => Math.abs(t.x - x) < (t.w + w) / 2 + 6 && Math.abs(t.z - z) < (t.d + d) / 2 + 6)) continue;     // a house this page already stood here
      taken.push({ x, z, w, d });
      return { x, z, y: hi + 0.02, lo };
    }
    return null;
  }
  P.setup = async (opt) => {
    opt = opt || {};
    world = baseWorld();
    P.opt = opt;
    if (opt.source === "fixture" || opt.source === "housegen") {
      const THREE = await import("three");
      const p = W.player.pos;
      let built = [];
      if (opt.source === "fixture") {
        const s = flatSpot(p.x + 30, p.z + 30, 11, 13.5);
        if (!s) return { error: "no flat dry spot for the fixture" };
        built = [window.__LCINT_FIXTURE__(THREE, { x: s.x, y: s.y, z: s.z, plinthDown: s.y - s.lo + 0.3, plant: opt.plant })];
      } else {
        const A = window.__LCINT_HOUSEGEN_ADAPTER__;
        if (!A) return { error: "no housegen adapter (probe_interior_housegen.js) in the page" };
        const el = [...document.querySelectorAll("script[type=module]")].find((x) => /ffg_boot3d/.test(x.src));
        const V = el ? new URL(el.src).search : "";
        let mod;
        try { mod = await import(new URL("runtime/3d/royale/housegen.js", location.href.replace(/[^/]*$/, "")).href + V); } catch (e) { return { error: "housegen.js import failed: " + String(e).slice(0, 300) }; }
        built = await A.buildInPage(mod, THREE, W, flatSpot, opt);
        if (!Array.isArray(built)) return { error: built && built.error || "housegen adapter built nothing" };
      }
      const g = W.group("map");
      for (const b of built) { g.add(b.group); b.group.updateMatrixWorld(true); injected.push(b); extraCols.push(...b.colliders); }
      // the injected colliders join the map's spatial query (every caller of W.map.queryColliders: the mover, bullets, the camera pull-in)
      const M = W.map, orig = M.queryColliders, scratch = [];
      if (!M.__lcintWrapped) {
        M.__lcintWrapped = true;
        M.queryColliders = function (x, z, r, out) {
          const res = orig.call(M, x, z, r, out);
          let extra = null;
          for (const c of extraCols) if (!c.dead && c.maxX >= x - r && c.minX <= x + r && c.maxZ >= z - r && c.minZ <= z + r) (extra || (extra = [])).push(c);
          if (!extra) return res;
          const o = out || scratch;
          if (res !== o) { o.length = 0; for (let i = 0; i < res.length; i++) o.push(res[i]); }
          for (const c of extra) o.push(c);
          return o;
        };
        M.colliders.push(...extraCols);
      }
      if (opt.exposeRecords) { if (!built.every((b) => b.raw)) return { error: "--simulate-records needs the housegen source" }; W.map.houses = built.map((b) => b.raw); }
      return { injected: built.length, exposed: !!opt.exposeRecords, at: built.map((b) => [r2(b.record.x), r2(b.record.y), r2(b.record.z)]), cols: extraCols.length };
    }
    return { source: "match" };
  };
  P.houses = (opt) => {
    opt = opt || {};
    if (injected.length && !(P.opt && P.opt.exposeRecords)) {
      HOUSES = injected.map((b) => ({ id: b.record.id, source: "records", bbox: b.record.bbox, rooms: b.record.rooms, furniture: b.record.furniture || [], loot: b.record.loot || [], doors: b.record.doors || null, _b: b }));
      return { records: true, n: HOUSES.length, list: HOUSES.map((h) => ({ id: h.id, rooms: h.rooms.length })) };
    }
    // stage B: the map's own house records (housegen output), whichever name the wiring uses
    const recs = W.map.houses || W.map.interiors || (W.map.housegen && W.map.housegen.houses) || null;
    if (Array.isArray(recs) && recs.length && recs[0].rooms) {
      const A = window.__LCINT_HOUSEGEN_ADAPTER__;
      HOUSES = recs.map((r, i) => (A && A.normalizeRecord ? A.normalizeRecord(r, i, world) : { id: r.id || "h" + i, source: "records", bbox: r.bbox, rooms: r.rooms, furniture: r.furniture || [], loot: r.loot || [] }));
    } else {
      HOUSES = I.surveyHouses(world, W.map.colliders);
      // loot without records: the map's loot points inside a house's rooms
      for (const h of HOUSES) h.loot = (W.map.lootPoints || []).filter((l) => h.rooms.some((r) => l.x > r.minX && l.x < r.maxX && l.z > r.minZ && l.z < r.maxZ && l.y > r.y - 0.2 && l.y < r.y + 2.5)).map((l) => ({ x: l.x, y: l.y, z: l.z }));
    }
    // a seeded sample (deterministic), preferring a mix of storeys
    let s = (opt.seed || 7) >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const idx = HOUSES.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const multi = idx.filter((i) => new Set(HOUSES[i].rooms.map((r) => Math.round(r.y))).size > 1), single = idx.filter((i) => !multi.includes(i));
    const max = opt.max || 12, pick = [];
    while (pick.length < max && (multi.length || single.length)) { if (multi.length && (pick.length % 2 === 0 || !single.length)) pick.push(multi.shift()); else pick.push(single.shift()); }
    HOUSES = pick.map((i) => HOUSES[i]);
    return { records: Array.isArray(recs) && recs.length > 0, recordsField: recs ? (W.map.houses ? "houses" : W.map.interiors ? "interiors" : "housegen.houses") : null, surveyed: idx.length, n: HOUSES.length,
      list: HOUSES.map((h) => ({ id: h.id, rooms: h.rooms.length, floors: new Set(h.rooms.map((r) => Math.round(r.y))).size, bbox: [r2(h.bbox.minX), r2(h.bbox.maxX), r2(h.bbox.minZ), r2(h.bbox.maxZ)] })) };
  };
  // (lane I4, Wave 8 stage B) maps.js draws a house's INSIDE (room walls, floors, ceilings, stair steps, door leaves) and its furniture in ONE chunk mesh
  // ("houses:furniture@<chunk>", lcPart furniture): a triangle of such a mesh is furniture only when its centroid lies inside one of the house record's furniture
  // boxes (shrunk 1 cm: a wall face a wardrobe stands against is the wall), else it is structure
  const MIXED = (o) => { for (let q = o; q; q = q.parent) if (/^houses:furniture@/.test(q.name || "")) return true; return false; };
  const trisFor = (H) => {
    const F = (H.furniture || []).filter((f) => !f.deco).map((f) => [f.minX + 0.01, f.minY + 0.01, f.minZ + 0.01, f.maxX - 0.01, f.maxY - 0.01, f.maxZ - 0.01]);
    const mixed = new Map();
    const refine = (tag, o, x, y, z) => {
      if (tag !== I.T_FURN) return tag;
      let mx = mixed.get(o); if (mx === undefined) { mx = MIXED(o); mixed.set(o, mx); }
      if (!mx) return tag;
      for (const b of F) if (x > b[0] && x < b[3] && y > b[1] && y < b[4] && z > b[2] && z < b[5]) return I.T_FURN;
      return I.T_STRUCT;
    };
    return I.makeTris([W.group("map")], H.bbox, classify, { updateMatrices: false, refine });
  };
  P.judge = (i) => {
    const H = HOUSES[i];
    // (lane I4, Wave 8 stage B) a real map culls by distance (district meshes beyond ~1,100 m, house furniture beyond ~60 m): the drawn triangles are read with the
    // player standing IN the house and the game's own updaters run, i.e. what a player inside it is shown - not what the last judged house's camera left visible
    if (!injected.length && H.rooms && H.rooms.length) {
      const r0 = H.rooms.find((r) => r.floor === 0) || H.rooms[0];
      setPlayer((r0.minX + r0.maxX) / 2, r0.y + 0.05, (r0.minZ + r0.maxZ) / 2); C.fastForward(0.1, 1 / 60); const a = p(); a.hp = 1000; a.shield = 1000;
      C.stepFrames(40, 1 / 60, false);
    }
    world.tris = trisFor(H);
    const st = I.judgeStatic(world, H);
    P._last = { i, st };
    const o = Object.assign({}, st); delete o._ops; return o;
  };
  // the human as the mover: teleported, stepped by the game's own fixed tick (C.fastForward -> stepActor)
  const p = () => W.player;
  function setPlayer(x, y, z) {
    const a = p();
    a.alive = true; a.hp = 100; a.shield = 100;
    a.pos.set(x, y, z); a.vel.set(0, 0, 0);
    if (a.obj) a.obj.position.copy(a.pos); if (a._pp) a._pp.copy(a.pos);
    a.onGround = false; a.gliding = false; a.swimming = false; a.mantleT = null; a.emoting = null; a.healing = null; a._portalBoost = false;
    const inp = a.input; inp.mx = 0; inp.mz = 0; inp.jump = false; inp.sprint = false; inp.ads = false; inp.crouch = false; inp.fire = false; inp.pitch = 0;
  }
  P.reach = (i) => {
    const H = HOUSES[i];
    if (!P._last || P._last.i !== i) P.judge(i);
    world.tris = world.tris || trisFor(H);
    const mover = { a: p(), place: (x, y, z) => { setPlayer(x, y, z); C.fastForward(0.1, 1 / 60); }, step: (dt) => { const a = p(); a.hp = 100; a.shield = 100; C.fastForward(dt, dt); } };
    const r = I.judgeReach(world, H, P._last.st, mover);
    p().input.mz = 0;
    return r;
  };
  // ---- camera pull-in (Wave 4 player_camwall's sweep, inside this house) ----
  P.camwall = (i, opt) => {
    opt = opt || {};
    const H = HOUSES[i], a = p(), cam = W.camera, EPS = 0.03;
    const furn = new Set(H.furniture.map((f) => f.col).filter(Boolean));
    const b = H.bbox;
    const walls = W.map.queryColliders((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 12, []).filter((c) => c.kind === "box" && !c.dead && !furn.has(c) && !c.lcFurniture && !(c.prop != null && c.maxX - c.minX < 2.0));
    const inBox = (x, y, z, c, e) => x > c.minX + e && x < c.maxX - e && y > c.minY + e && y < c.maxY - e && z > c.minZ + e && z < c.maxZ - e;
    const step = (n) => C.stepFrames(n, 1 / 60, false);
    const eyeOf = () => ({ x: a.obj.position.x, y: a.obj.position.y + a._eyeY, z: a.obj.position.z });
    function sweep(noWall) {
      W.noCamWall = !!noWall;
      const out = { spots: 0, wedged: 0, frames: 0, pulled: 0, violations: 0, examples: [] };
      let s = 99; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      for (const r of H.rooms) {
        const pts = [];
        for (let k = 0; k < 40 && pts.length < (opt.perRoom || 3); k++) {
          const x = r.minX + 0.6 + rnd() * Math.max(0.1, r.maxX - r.minX - 1.2), z = r.minZ + 0.6 + rnd() * Math.max(0.1, r.maxZ - r.minZ - 1.2);
          if (I.capsuleBlocked(world, x, z, r.y)) continue;
          if ((r.holes || []).some((h) => x > h.minX - 0.5 && x < h.maxX + 0.5 && z > h.minZ - 0.5 && z < h.maxZ + 0.5)) continue;
          pts.push([x, z]);
        }
        for (const [x, z] of pts) {
          setPlayer(x, r.y + 0.05, z); C.fastForward(0.15, 1 / 60); a.hp = 1000; a.shield = 1000;
          if (Math.abs(a.pos.y - r.y) > 0.4 || Math.hypot(a.pos.x - x, a.pos.z - z) > 0.4) { out.wedged++; continue; }
          out.spots++;
          for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) for (const pit of [-0.35, 0, 0.5]) {
            a.input.yaw = yaw; a.input.pitch = pit; a.yaw = yaw; a.pitch = pit;
            for (let f = 0; f < 4; f++) {
              step(1); out.frames++;
              const e = eyeOf(), cp = cam.position, stt = W._camWall || {};
              if (stt.pulled) out.pulled++;
              for (const c of walls) {
                if (inBox(e.x, e.y, e.z, c, EPS)) continue;
                let bad = null;
                if (inBox(cp.x, cp.y, cp.z, c, EPS)) bad = "inside";
                else if (I.segBox(e.x, e.y, e.z, cp.x, cp.y, cp.z, { minX: c.minX + EPS, maxX: c.maxX - EPS, minY: c.minY + EPS, maxY: c.maxY - EPS, minZ: c.minZ + EPS, maxZ: c.maxZ - EPS }) >= 0) bad = "behind";
                if (bad) { out.violations++; if (out.examples.length < 4) out.examples.push({ room: r.id, bad, eye: [e.x, e.y, e.z].map(r2), cam: [cp.x, cp.y, cp.z].map(r2), box: [c.minX, c.maxX, c.minY, c.maxY, c.minZ, c.maxZ].map(r2) }); break; }
              }
            }
          }
        }
      }
      W.noCamWall = false;
      return out;
    }
    const on = sweep(false), off = sweep(true);
    step(2);
    return { walls: walls.length, on, off };
  };
  // ---- rendered views: light level, furniture pixels, cost ----
  P.views = (i, opt) => {
    opt = opt || {};
    const H = HOUSES[i], a = p(), k = W.kernel, R = k.renderer, gl = R.getContext();
    const st = P._last && P._last.i === i ? P._last.st : (P.judge(i), P._last.st);
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, buf = new Uint8Array(w * h * 4);
    const read = () => { gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf); return buf; };
    const lumaStats = (px) => {
      let s = 0, dark = 0, n = 0;
      for (let q = 0; q < px.length; q += 16) { const L = 0.2126 * px[q] + 0.7152 * px[q + 1] + 0.0722 * px[q + 2]; s += L; if (L < 16) dark++; n++; }
      return { mean: r2(s / n), dark: r2(dark / n) };
    };
    const shot = (opt.shots || 0) > 0;
    const out = { entrances: [], centres: [], shots: [] };
    const objOf = new Map(); for (const f of H.furniture) if (f.obj) objOf.set(f, f.obj);
    // per-piece hide / show: the adapter's (housegen: merged meshes, vertices collapsed in place) or the fixture's own objects
    const injectedFurn = !H._b ? [] : H._b.pieces ? H._b.pieces.filter((q) => q.drawn).map((q) => ({ f: H.furniture[q.i], hide: q.hide, show: q.show }))
      : H._b.record.furniture.map((f, j) => { const obj = H._b.group.children.filter((m) => m.userData.lcFurniture)[j]; return { f, hide: () => { obj.visible = false; }, show: () => { obj.visible = true; }, obj }; });
    const poseAndRender = (x, y, z, yaw, frames) => {
      setPlayer(x, y + 0.05, z); a.input.yaw = yaw; a.input.pitch = -0.05; a.yaw = yaw; a.pitch = -0.05;
      C.fastForward(0.1, 1 / 60); a.hp = 1000; a.shield = 1000;
      a.input.yaw = yaw; a.yaw = yaw;
      C.stepFrames(frames || 40, 1 / 60, false);
      C.stepFrames(1, 1 / 60, true);
      const L = lumaStats(read());
      const info = { calls: R.info.render.calls, tris: R.info.render.triangles };
      return { L, info, pos: [r2(a.pos.x), r2(a.pos.y), r2(a.pos.z)], cam: [r2(W.camera.position.x), r2(W.camera.position.y), r2(W.camera.position.z)] };
    };
    const data = () => R.domElement.toDataURL("image/png");
    // entrances (doors and stair tops) of every room: the player stands 0.9 m inside, faces into the room
    const ops = st._ops;
    let nShots = 0;
    for (const r of H.rooms) {
      const ents = [];
      for (const d of ops.doors.filter((q) => q.room === r.id)) ents.push({ what: "door " + d.side + "@" + d.along, x: d.nx ? d.face - d.nx * 0.9 : d.along, z: d.nx ? d.along : d.face - d.nz * 0.9, yaw: Math.atan2(d.nx, d.nz) });
      for (const sx of I.houseStairs(world, H)) {
        const c = sx.col; if (Math.abs(c.maxY - r.y) > 0.4) continue;
        const tx = c.dir === 0 ? c.maxX + 0.9 : c.dir === 1 ? c.minX - 0.9 : (c.minX + c.maxX) / 2, tz = c.dir === 2 ? c.maxZ + 0.9 : c.dir === 3 ? c.minZ - 0.9 : (c.minZ + c.maxZ) / 2;
        if (!(tx > r.minX - 0.3 && tx < r.maxX + 0.3 && tz > r.minZ - 0.3 && tz < r.maxZ + 0.3)) continue;
        const fx = (r.minX + r.maxX) / 2 - tx, fz = (r.minZ + r.maxZ) / 2 - tz;
        ents.push({ what: "stair top", x: tx, z: tz, yaw: Math.atan2(-fx, -fz) });
      }
      for (const e of ents) {
        const v = poseAndRender(e.x, r.y, e.z, e.yaw);
        const rec = { room: r.id, from: e.what, luma: v.L, calls: v.info.calls, tris: v.info.tris, pos: v.pos, cam: v.cam, furniturePx: null };
        // furniture pixels: each injected piece hidden in turn, the same frame re-rendered (renderer only, no post): pieces with >= 60 changed pixels are IN VIEW
        if (injectedFurn.length) {
          const base = read().slice(); R.render(k.scene, k.camera); const ref = read().slice();
          let inView = 0; const per = [];
          for (const { f, hide, show } of injectedFurn) {
            if (!f || f.deco || f.maxY - f.minY < 0.25 || f.maxY < r.y - 0.3 || f.minY > r.y + 2.6) continue;
            if (!I.ownPiece(f, r)) continue;                                   // (VERSION 2: only the room's OWN pieces count; a neighbour's seen through the doorway does not)
            hide(); R.render(k.scene, k.camera); const px = read(); show();
            let d = 0; for (let q = 0; q < px.length; q += 4) if (Math.abs(px[q] - ref[q]) + Math.abs(px[q + 1] - ref[q + 1]) + Math.abs(px[q + 2] - ref[q + 2]) > 24) d++;
            if (d >= 60) { inView++; per.push(f.kind + ":" + d); }
          }
          rec.furniturePx = { inView, per };
          void base;
        }
        if (shot && nShots < opt.shots) { C.stepFrames(1, 1 / 60, true); rec.shot = out.shots.length; out.shots.push({ name: H.id + "_" + r.id + "_" + e.what.replace(/[^a-z0-9]+/gi, "-"), url: data() }); nShots++; }
        out.entrances.push(rec);
      }
      // the room centre, 4 headings: the light level a player reads in the middle of the room
      const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2;
      let spot = null;
      for (let t = 0; t < 30 && !spot; t++) { const x = cx + (t ? Math.cos(t * 2.4) * t * 0.15 : 0), z = cz + (t ? Math.sin(t * 2.4) * t * 0.15 : 0); if (!I.capsuleBlocked(world, x, z, r.y) && !(r.holes || []).some((q) => x > q.minX - 0.4 && x < q.maxX + 0.4 && z > q.minZ - 0.4 && z < q.maxZ + 0.4)) spot = [x, z]; }
      if (spot) for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        const v = poseAndRender(spot[0], r.y, spot[1], yaw, 30);
        const rec = { room: r.id, yaw: r2(yaw), luma: v.L, calls: v.info.calls, tris: v.info.tris, pos: v.pos };
        if (shot && nShots < opt.shots && yaw === 0) { rec.shot = out.shots.length; out.shots.push({ name: H.id + "_" + r.id + "_centre", url: data() }); nShots++; }
        out.centres.push(rec);
      }
    }
    // grass indoors: from 0.4 m under the ceiling looking straight down at the room floor, the frame with the ground clutter (grass tufts) drawn vs hidden
    out.grass = [];
    {
      const clutter = []; W.group("map").traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && /clutter|grass/i.test(o.name || "")) clutter.push(o); });
      const Cam = W.camera.constructor;
      for (const r of H.rooms) {
        const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2, top = (r.ceil != null ? r.ceil : r.y + 2.8) - 0.4;
        const half = Math.max(r.maxX - r.minX, r.maxZ - r.minZ) / 2;
        const cam = new Cam(Math.min(120, 2 * Math.atan2(half, Math.max(0.3, top - r.y)) * 180 / Math.PI), w / h, 0.05, 30);
        cam.position.set(cx, top, cz); cam.up.set(0, 0, -1); cam.lookAt(cx, r.y, cz); cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
        setPlayer(cx + 500, r.y + 50, cz + 500);                           // the player out of the shot (the clutter ring follows the camera focus, not this camera)
        R.render(k.scene, cam); const ref = read().slice();
        const vis = clutter.map((o) => o.visible); clutter.forEach((o) => { o.visible = false; });
        R.render(k.scene, cam); const px = read(); clutter.forEach((o, n) => { o.visible = vis[n]; });
        let d = 0; for (let q = 0; q < px.length; q += 4) if (Math.abs(px[q] - ref[q]) + Math.abs(px[q + 1] - ref[q + 1]) + Math.abs(px[q + 2] - ref[q + 2]) > 24) d++;
        out.grass.push({ room: r.id, px: d, clutterMeshes: clutter.length });
      }
    }
    // an outdoor reference: 8 m out of the first exterior door, facing the house
    const d0 = ops.doorList.find((d) => d.exterior);
    if (d0) {
      const x = d0.nx ? d0.face + d0.nx * 8 : d0.along, z = d0.nx ? d0.along : d0.face + d0.nz * 8;
      const v = poseAndRender(x, W.map.heightAt(x, z), z, Math.atan2(d0.nx, d0.nz), 30);
      out.outdoor = { luma: v.L, calls: v.info.calls, tris: v.info.tris };
      if (shot) out.shots.push({ name: H.id + "_outside", url: data() });
    }
    if (H._b) { let calls = 0, tris = 0; H._b.group.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o.visible) { const g = o.geometry; calls += Array.isArray(o.material) ? (g.groups.length || 1) : 1; tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); } }); out.houseObject = { calls, tris: Math.round(tris) }; }
    return out;
  };
  window.__LCINT_PAGE__ = P;
  return 1;
})()
