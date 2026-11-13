// probe_interior_housegen.js - interiorcheck's adapter from lane H1's housegen.js (runtime/3d/royale/housegen.js, Wave 8 stage A) to the
// normalized house the judge reads (probe_interior.js header). An expression (IIFE): installs globalThis.__LCINT_HOUSEGEN_ADAPTER__.
//
// housegen API read here (its header, 2026-10-19): generate(parcel) -> house (pure data, world metres), buildHouse(THREE, house, opts) ->
// { group (walls + furniture groups, merged per material), colliders (collidersOf order: structure boxes c=1, ramps, furniture collider
// groups), kitList, boxRanges, instanced }. The adapter tags the walls group lcPart 'wall' and the furniture group lcPart 'furniture', reads
// rooms (cells -> lattice points; a room's own cells only, so an L room never borrows a neighbour's floor), ceilings (house.floors[f].ceil),
// stair holes (house.stairs[].hole on the floor it lands on), furniture (its colliders, by collidersOf order), loot points and chests.
// Planted faults are applied to the house DATA / built meshes in memory (never a file):
//   furniture-in-door  a 1.4 x 0.8 x 1.0 m crate (drawn + collider) 0.7 m inside the front door
//   window-solid       a collider box (not drawn) filling the first ground-floor window
//   no-ceiling         the top storey's roof boxes not drawn (their colliders stay)
//   empty-room         (Wave 8 stage B, lane I4) one ground-floor room behind an interior door holds NO furniture (its pieces dropped from the data, their
//                      boxes not drawn): only a neighbour room's pieces can be seen from its door -> furniture-view (own pieces) FAILS
(() => {
  const COS = [1, 0, -1, 0], SIN = [0, 1, 0, -1];
  // the parcels judged per seed: every storey count, all three themes, rect / L / auto plans, small to large footprints, all four turns
  function parcels(seed, n) {
    const out = [];
    let s = (seed * 2654435761) >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const themes = ["city", "resort", "lodge"], plans = ["auto", "rect", "L"];
    for (let k = 0; k < n; k++) {
      const w = 2.5 * (3 + Math.floor(rnd() * 6)), d = 2.5 * (3 + Math.floor(rnd() * 6));
      out.push({ id: "s" + seed + "h" + k, cx: 0, cz: 0, y: 0, w, d, turn: k % 4, theme: themes[k % 3], storeys: 1 + (k % 3), seed: (seed * 7919 + k * 104729) >>> 0, plan: plans[Math.floor(k / 3) % 3] });
    }
    return out;
  }
  function plantData(H, plant) {
    if (plant === "furniture-in-door") {
      const d = H.doors.find((q) => q.kind === "front") || H.doors.find((q) => q.rooms && q.rooms[1] == null);
      if (!d) return "no exterior door to plant in";
      const ix = d.x - d.nx * 0.7, iz = d.z - d.nz * 0.7, hw = d.axis === "x" ? 0.7 : 0.4, hd = d.axis === "x" ? 0.4 : 0.7;
      const min = [ix - hw, d.y, iz - hd], max = [ix + hw, d.y + 1.0, iz + hd];
      const pal = H.boxes.find((b) => b.p === "furn") || H.boxes[0];
      H.boxes.push({ p: "furn", min, max, f: pal.f.slice(), c: 1, fl: d.floor });
      H.furniture.push({ id: "planted", type: "planted-crate", src: "box", room: d.rooms[0], floor: d.floor, min, max, cols: [{ min, max }], parts: [H.boxes.length - 1], planted: true });
    }
    if (plant === "empty-room") {
      // the first ground-floor room reached through an interior door (a door joining two rooms) that holds furniture; else any furnished room
      const solid = (p) => !p.deco;
      const furnished = (rid) => H.furniture.some((p) => p.room === rid && solid(p));
      const inner = H.doors.filter((q) => q.rooms && q.rooms[0] != null && q.rooms[1] != null && q.floor === 0);
      let target = null;
      for (const d of inner) for (const rid of d.rooms) if (target == null && furnished(rid)) target = rid;
      if (target == null) { const r = H.rooms.find((q) => furnished(q.id)); target = r ? r.id : null; }
      if (target == null) return "no furnished room to empty";
      const drop = H.furniture.filter((p) => p.room === target);
      for (const p of drop) for (const bi of p.parts || []) { const b = H.boxes[bi]; if (b) { b.h = 63; b.c = 0; } }      // every face hidden, no collider
      H.furniture = H.furniture.filter((p) => p.room !== target);
      H._planted = { emptied: target, pieces: drop.length };
    }
    return null;
  }
  // which collider object belongs to which furniture piece (collidersOf order)
  function furnitureCols(H, cols) {
    let k = H.boxes.filter((b) => b.c).length + H.ramps.length;
    const map = [];
    for (const p of H.furniture) {
      if (p.deco) { map.push([]); continue; }
      const n = p.src === "kit" ? 1 : p.cols.length;
      map.push(cols.slice(k, k + n)); k += n;
    }
    return map;
  }
  function normalize(H, cols) {
    const c = COS[H.turn], sn = SIN[H.turn], Wd = H.W, Dd = H.D, U = H.U;
    const cellOf = (x, z) => { const u = (x - H.cx) * c - (z - H.cz) * sn, v = (x - H.cx) * sn + (z - H.cz) * c; return [Math.floor((u + Wd / 2) / U), Math.floor((v + Dd / 2) / U)]; };
    const fc = furnitureCols(H, cols);
    const rooms = H.rooms.map((r) => {
      const own = new Set(r.cells.map((q) => q[0] + "," + q[1]));
      const holes = H.stairs.filter((s) => s.to === r.floor).map((s) => ({ minX: s.hole[0], minZ: s.hole[1], maxX: s.hole[2], maxZ: s.hole[3] }));
      const pts = [];
      for (let x = r.x0 + 0.35; x <= r.x1 - 0.35 + 1e-6; x += 0.5) for (let z = r.z0 + 0.35; z <= r.z1 - 0.35 + 1e-6; z += 0.5) {
        const [i, j] = cellOf(x, z);
        if (!own.has(i + "," + j)) continue;
        if (holes.some((h) => x > h.minX - 0.1 && x < h.maxX + 0.1 && z > h.minZ - 0.1 && z < h.maxZ + 0.1)) continue;
        pts.push([x, z]);
      }
      const inside = (x, z) => { const [i, j] = cellOf(x, z); return own.has(i + "," + j); };
      return { id: r.id, kind: r.kind, floor: r.floor, minX: r.x0, maxX: r.x1, minZ: r.z0, maxZ: r.z1, y: r.y, ceil: H.floors[r.floor].ceil, holes, pts, inside, cells: r.cells.length };
    });
    const furniture = H.furniture.map((p, i) => ({ kind: p.type + (p.planted ? "" : ""), minX: p.min[0], maxX: p.max[0], minY: p.min[1], maxY: p.max[1], minZ: p.min[2], maxZ: p.max[2], col: fc[i][0] || null, cols: fc[i], src: p.src, deco: !!p.deco, room: p.room }));
    const loot = H.loot.map((l) => ({ x: l.x, y: l.y, z: l.z, on: l.on })).concat(H.chests.map((q) => ({ x: q.x, y: q.y + 0.3, z: q.z, on: "chest" })));
    const bb = { minX: H.aabb.min[0], minY: H.aabb.min[1], minZ: H.aabb.min[2], maxX: H.aabb.max[0], maxY: H.aabb.max[1], maxZ: H.aabb.max[2] };
    const doors = H.doors.map((d) => ({ id: d.id, x: d.x, z: d.z, y: d.y, width: d.width, axis: d.axis, rooms: d.rooms.filter(Boolean), kind: d.kind }));
    return { id: H.id, x: H.cx, z: H.cz, y: H.y0, rooms, furniture, loot, doors, bbox: bb };
  }
  function tag(built) {
    built.walls.userData.lcPart = "wall";
    built.furniture.userData.lcPart = "furniture";
  }
  // per-piece hide / show on the merged furniture meshes (an authored piece = its parts' 24 vertices each; a kit piece = its instance)
  function pieces(H, built) {
    const out = [];
    const kitIdx = new Map();
    H.furniture.forEach((p, i) => {
      if (p.src === "kit") {
        const k = kitIdx.get(p.kit.type) || 0; kitIdx.set(p.kit.type, k + 1);
        const ims = built.instanced.filter((im) => im.name === "housegen:" + H.id + ":" + p.kit.type);
        const saved = [];
        out.push({ i, hide: () => { for (const im of ims) { const a = im.instanceMatrix.array; saved.push(a.slice(k * 16, k * 16 + 16)); for (let q = 0; q < 16; q++) a[k * 16 + q] = 0; im.instanceMatrix.needsUpdate = true; } },
          show: () => { ims.forEach((im, n) => { const a = im.instanceMatrix.array; a.set(saved[n], k * 16); im.instanceMatrix.needsUpdate = true; }); saved.length = 0; }, drawn: ims.length > 0 });
      } else {
        // an authored piece: collapse the vertices of its part boxes in the merged furniture meshes (matched by coordinates: a box's faces can sit in two materials)
        const boxes = (p.parts || []).map((bi) => H.boxes[bi]).filter(Boolean);
        const saved = [];
        out.push({ i, hide: () => {
          for (const m of built.furniture.children) {
            if (!m.isMesh || m.isInstancedMesh) continue;
            const pa = m.geometry.attributes.position, A = pa.array; let hit = false;
            for (let v = 0; v < pa.count; v++) {
              const x = A[v * 3], y = A[v * 3 + 1], z = A[v * 3 + 2];
              if (boxes.some((bx) => x >= bx.min[0] - 1e-4 && x <= bx.max[0] + 1e-4 && y >= bx.min[1] - 1e-4 && y <= bx.max[1] + 1e-4 && z >= bx.min[2] - 1e-4 && z <= bx.max[2] + 1e-4)) {
                saved.push([m, v, x, y, z]); A[v * 3] = boxes[0].min[0]; A[v * 3 + 1] = boxes[0].min[1]; A[v * 3 + 2] = boxes[0].min[2]; hit = true;
              }
            }
            if (hit) pa.needsUpdate = true;
          }
        }, show: () => { for (const [m, v, x, y, z] of saved) { const A = m.geometry.attributes.position.array; A[v * 3] = x; A[v * 3 + 1] = y; A[v * 3 + 2] = z; m.geometry.attributes.position.needsUpdate = true; } saved.length = 0; }, drawn: boxes.length > 0 });
      }
    });
    return out;
  }
  function plantBuilt(H, built, plant) {
    if (plant === "window-solid") {
      const w = H.windows.find((q) => q.floor === 0) || H.windows[0];
      if (!w) return "no window to fill";
      const T = 0.24, hw = w.width / 2;
      const c = w.axis === "x" ? { minX: w.x - hw, maxX: w.x + hw, minZ: w.z - T / 2, maxZ: w.z + T / 2 } : { minX: w.x - T / 2, maxX: w.x + T / 2, minZ: w.z - hw, maxZ: w.z + hw };
      built.colliders.push(Object.assign({ kind: "box", minY: w.sill, maxY: w.head, dir: -1, prop: null, idx: -1, hp: 0, dead: false, _qs: 0, lcPart: "planted" }, c));   // (housegen's sill / head are absolute heights)
    }
    if (plant === "no-ceiling") {
      // the roof boxes (and the top storey's ceiling faces) are not drawn: degenerate their vertices in the merged walls meshes
      let n = 0;
      H.boxes.forEach((b, bi) => {
        if (b.p !== "roof") return;
        const rg = built.boxRanges[bi]; if (!rg) return;
        const m = built.walls.children.find((q) => q.isMesh && q.name === "housegen:" + H.id + ":" + rg[1]); if (!m) return;
        // a box spans up to 2 materials: collapse every face of this box wherever it went (24 vertices from its first range, then the rest by matching coordinates)
        for (const mm of built.walls.children) {
          if (!mm.isMesh) continue;
          const pa = mm.geometry.attributes.position, A = pa.array;
          for (let v = 0; v < pa.count; v++) {
            const x = A[v * 3], y = A[v * 3 + 1], z = A[v * 3 + 2];
            if (x >= b.min[0] - 1e-4 && x <= b.max[0] + 1e-4 && y >= b.min[1] - 1e-4 && y <= b.max[1] + 1e-4 && z >= b.min[2] - 1e-4 && z <= b.max[2] + 1e-4) { A[v * 3] = b.min[0]; A[v * 3 + 1] = b.min[1]; A[v * 3 + 2] = b.min[2]; n++; }
          }
          pa.needsUpdate = true; mm.geometry.computeBoundingBox(); mm.geometry.computeBoundingSphere();
        }
      });
      if (!n) return "no roof box drawn";
    }
    return null;
  }
  const A = {
    parcels,
    // Node: [{ group, colliders, record, meta }]
    build(mod, THREE, seed, opt) {
      opt = opt || {};
      const out = [];
      for (const P of parcels(seed, Math.min(opt.max || 12, 60))) {
        const H = mod.generate(P);
        const e1 = plantData(H, opt.plant); if (e1) return { error: "plant " + opt.plant + ": " + e1 };
        const built = mod.buildHouse(THREE, H, {});
        tag(built);
        const e2 = plantBuilt(H, built, opt.plant); if (e2) return { error: "plant " + opt.plant + ": " + e2 };
        built.group.updateMatrixWorld(true);
        out.push({ group: built.group, colliders: built.colliders, record: normalize(H, built.colliders),
          meta: { parcel: P, storeys: H.storeys, plan: H.plan, theme: H.theme, use: H.use, rooms: H.rooms.length, doors: H.doors.length, windows: H.windows.length, furniture: H.furniture.length, kit: H.furniture.filter((p) => p.src === "kit").length, tris: H.tris, notes: H.notes } });
      }
      return out;
    },
    // the page: the houses stood on level spots of the running map; kit furniture drawn from the city kit GLBs through the game's own loader
    async buildInPage(mod, THREE, W, flatSpot, opt) {
      opt = opt || {};
      const base = location.href.replace(/[^/]*$/, "");
      let man = null;
      try { man = await (await fetch(base + "assets/props/city/manifest.json")).json(); } catch (e) { man = null; }
      const tmpl = new Map();
      const out = [];
      const p0 = W.player.pos;
      let ox = p0.x + 30, oz = p0.z + 30;
      const list = parcels(opt.seed || 7, opt.count || 4);
      // a fixed mix for the page: a 1-, 2- and 3-storey house and an L plan
      const pick = [list.find((q) => q.storeys === 1), list.find((q) => q.storeys === 2), list.find((q) => q.storeys === 3), list.find((q) => q.plan === "L")].filter(Boolean).slice(0, opt.count || 4);
      for (const P0 of pick) {
        const spot = flatSpot(ox, oz, P0.w + 2, P0.d + 2);
        if (!spot) return { error: "no level dry spot for " + P0.id };
        const P = Object.assign({}, P0, { cx: spot.x, cz: spot.z, y: spot.y });
        const H = mod.generate(P);
        const e1 = plantData(H, opt.plant); if (e1) return { error: "plant " + opt.plant + ": " + e1 };
        // kit templates for this house's kit types
        for (const p of H.furniture) {
          if (p.src !== "kit" || tmpl.has(p.kit.type) || !man) continue;
          const T = man.types["furniture/" + p.kit.type] || man.types[p.kit.type];
          if (!T) { tmpl.set(p.kit.type, null); continue; }
          try {
            const root = await W.kernel.loadGLTF(base + "assets/props/city/" + T.file);
            root.updateMatrixWorld(true);
            const S = new THREE.Matrix4().makeScale(T.suggested_scale, T.suggested_scale, T.suggested_scale);
            const parts = [];
            root.traverse((o) => { if (o.isMesh) parts.push({ geometry: o.geometry, material: o.material, local: S.clone().multiply(o.matrixWorld) }); });
            tmpl.set(p.kit.type, parts);
          } catch (e) { tmpl.set(p.kit.type, null); }
        }
        const kt = new Map(); for (const [k, v] of tmpl) if (v) kt.set(k, v);
        const built = mod.buildHouse(THREE, H, { kitTemplates: kt });
        tag(built);
        const e2 = plantBuilt(H, built, opt.plant); if (e2) return { error: "plant " + opt.plant + ": " + e2 };
        built.group.updateMatrixWorld(true);
        const rec = normalize(H, built.colliders);
        out.push({ group: built.group, colliders: built.colliders, record: rec, raw: H, pieces: pieces(H, built), meta: { id: H.id, storeys: H.storeys, plan: H.plan, theme: H.theme, kitTypes: [...kt.keys()], kitMissing: [...tmpl.entries()].filter((e) => !e[1]).map((e) => e[0]) } });
        // the pad: housegen stands on y; the terrain under the footprint is lower by up to the spot's range (a 0.15 m base reaches under the pad)
        ox += Math.max(P0.w, P0.d) + 14;
        // only one plant per run: the first house carries it
        if (opt.plant) opt = Object.assign({}, opt, { plant: null });
      }
      return out;
    },
    // a map's house record (stage B: housegen's house data on W.map.houses): the furniture colliders are found among the map's colliders by their boxes
    normalizeRecord(r, i, world) {
      if (!(r && r.rooms && r.rooms[0] && r.rooms[0].x0 != null)) return { id: r.id || "h" + i, source: "records", bbox: r.bbox, rooms: r.rooms, furniture: r.furniture || [], loot: r.loot || [] };
      const out = Object.assign({ source: "records" }, normalize(r, []));
      if (world) out.furniture.forEach((f, k) => {
        const p = r.furniture[k], boxes = p.src === "kit" ? [{ min: p.min, max: p.max }] : (p.cols || []);
        const L = world.query((f.minX + f.maxX) / 2, (f.minZ + f.maxZ) / 2, Math.hypot(f.maxX - f.minX, f.maxZ - f.minZ) / 2 + 0.5);
        const same = (c, b) => Math.abs(c.minX - b.min[0]) < 1e-3 && Math.abs(c.maxX - b.max[0]) < 1e-3 && Math.abs(c.minY - b.min[1]) < 1e-3 && Math.abs(c.maxY - b.max[1]) < 1e-3 && Math.abs(c.minZ - b.min[2]) < 1e-3 && Math.abs(c.maxZ - b.max[2]) < 1e-3;
        f.cols = boxes.map((b) => L.find((c) => c.kind === "box" && same(c, b))).filter(Boolean); f.col = f.cols[0] || null;
      });
      return out;
    },
  };
  globalThis.__LCINT_HOUSEGEN_ADAPTER__ = A;
  return 1;
})()
