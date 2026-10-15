() => {
  // probe_collision.js - the in-page half of collisioncheck.py (lane 5D; promoted from the collision research lane's
  // analyse.js + live.js, with every maps.js line-number hook and source-patch instrumentation REMOVED: everything below reads
  // the built map (colliders, instanced matrices, the GLB triangles) and drives the game's own movement and shot code, so it
  // keeps working when maps.js is edited).
  //
  // Returns an object of async functions; collisioncheck.py installs it once per page (window.__LCCOL__) and calls them.
  //   props(opt)   per prop kind, analytic: how far the body capsule clips into / stands off the DRAWN mesh at the collider
  //   live(opt)    real stepActor sprints into props, phantom walks, game segment test vs the drawn triangles
  //   doors(opt)   real walks through house doors (door = a lintel collider over a clear gap, found from the colliders)
  //   walls(opt)   real sprints into thin walls from both sides at 4 angles
  //   ramps(opt)   climb and descend every sampled ramp, foot lip of every ramp, standing-and-shielded cells under ramps
  //   falls(opt)   drops of 5-60 m onto 0.3 m slabs through the real mover
  // READ-ONLY on the map; the player (PRACTICE: the only actor) is teleported and stepped with C.fastForward.
  const C = window.__LC__, W = C.W;
  const S = (window.FFG && window.FFG.sim && window.FFG.sim.Royale) || W.SIM;
  const R = S.PLAYERK.radius, CAPH = S.PLAYERK.height;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const pct = (a, q) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const k = (s.length - 1) * q; const lo = Math.floor(k), hi = Math.min(lo + 1, s.length - 1); return r3(s[lo] + (s[hi] - s[lo]) * (k - lo)); };
  const share = (a, f) => (a.length ? r3(a.filter(f).length / a.length) : null);
  const STATE = { hulls: {}, samples: {}, groups: {}, subsByKind: {} };
  const M = () => W.map;

  // ---------------------------------------------------------------- geometry helpers
  function hull(P) {
    if (P.length < 3) return P.slice();
    P = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = []; for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    const up = []; for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    up.pop(); lo.pop(); return lo.concat(up);
  }
  // signed distance from (px,pz) to a convex polygon: negative inside
  function sdPoly(px, pz, H) {
    if (H.length < 3) { let m = 1e9; for (const q of H) m = Math.min(m, Math.hypot(px - q[0], pz - q[1])); return m; }
    let inside = true, md = 1e9;
    for (let i = 0; i < H.length; i++) {
      const a = H[i], b = H[(i + 1) % H.length];
      const ex = b[0] - a[0], ez = b[1] - a[1], L2 = ex * ex + ez * ez || 1e-12;
      let t = ((px - a[0]) * ex + (pz - a[1]) * ez) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(px - (a[0] + ex * t), pz - (a[1] + ez * t)); if (d < md) md = d;
      if (ex * (pz - a[1]) - ez * (px - a[0]) < 0) inside = false;
    }
    return inside ? -md : md;
  }
  // convex polygons A, B (x,z) overlap or come within `m` metres of each other (separating-axis test over both edge sets)
  function polysTouch(A, B, m) {
    if (A.length < 3 || B.length < 3) return true;
    for (const P of [A, B]) for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      let nx = b[1] - a[1], nz = a[0] - b[0]; const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
      let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
      for (const q of A) { const d = q[0] * nx + q[1] * nz; if (d < a0) a0 = d; if (d > a1) a1 = d; }
      for (const q of B) { const d = q[0] * nx + q[1] * nz; if (d < b0) b0 = d; if (d > b1) b1 = d; }
      if (a1 + m < b0 || b1 + m < a0) return false;
    }
    return true;
  }
  // The DRAWN BODIES of a prop: one convex hull per drawn sub-mesh (a rock cluster is four separate rocks; the gaps between them are
  // not rock), sub-meshes whose hulls touch or overlap merged into one body (a car's wheels, a barrel's bands).
  // entries: [{ pts: band points [x,z][], top: the sub-mesh's highest vertex above the base, sub: its index }]. Returns the merged bodies as
  // [{ H: hull, top: highest vertex above the base over the members, subs: [member sub-mesh indices] }].
  // `separate`: every sub-mesh is its own body (a kind whose sub-meshes are SEPARATE objects: the four rocks of a cluster. Merging two rocks that
  // touch would let their convex hull fill the empty notch between them, and the plan builds one box per rock).
  function mergeBodies(entries, separate) {
    const hs = entries.filter((e) => e.pts.length >= 3).map((e) => ({ ...e, H: hull(e.pts) })).filter((o) => o.H.length >= 3);
    const par = hs.map((_, i) => i); const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
    if (!separate) for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) if (polysTouch(hs[i].H, hs[j].H, 0.05)) par[find(i)] = find(j);
    const groups = {};
    hs.forEach((o, i) => { const g = (groups[find(i)] = groups[find(i)] || { pts: [], subs: [], top: -1e9 }); g.pts.push(...o.pts); g.subs.push(o.sub); if (o.top > g.top) g.top = o.top; });
    return Object.values(groups).map((g) => ({ H: hull(g.pts), top: g.top, subs: g.subs }));
  }
  // The mover steps over anything up to STEP_UP (player.js STEP_UP = 0.55 m): a drawn body whose highest vertex is under it (the pebbles
  // beside a rock) is not an obstacle and has no collider, so it is not part of "the drawn body" colliders are judged against. If EVERY body
  // of an instance is that low, they all stay (a collider standing over nothing but pebbles is a phantom wall: Wave 4 had 6 m of it).
  const STEP_UP = 0.55;
  const SEPARATE_PARTS = new Set(["rocks"]);
  // horizontal ray (origin (ax, ay, az), direction (ux, 0, uz), length len) vs an axis-aligned box with a y range
  function rayBox(ax, ay, az, ux, uz, len, b) {
    if (ay < b.minY || ay > b.maxY) return false;
    let t0 = 0, t1 = len;
    for (const [o, d, lo, hi] of [[ax, ux, b.minX, b.maxX], [az, uz, b.minZ, b.maxZ]]) {
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return false; continue; }
      let a = (lo - o) / d, c = (hi - o) / d; if (a > c) { const t = a; a = c; c = t; }
      if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 > t1) return false;
    }
    return true;
  }
  // the tightest axis-aligned box of each body: what the best C-COLL collider (axis-aligned boxes only) could do for this mesh
  const idealBoxes = (bodies) => bodies.map((Hb) => { let a = 1e9, b = -1e9, c = 1e9, d = -1e9; for (const q of Hb) { if (q[0] < a) a = q[0]; if (q[0] > b) b = q[0]; if (q[1] < c) c = q[1]; if (q[1] > d) d = q[1]; } return { minX: a, maxX: b, minZ: c, maxZ: d }; });
  // signed distance from (px,pz) to the nearest drawn body (negative inside one)
  const sdBodies = (px, pz, bodies) => { let m = 1e9; for (const H of bodies) { const d = sdPoly(px, pz, H); if (d < m) m = d; } return m; };
  // ... but a body is only an obstacle to a capsule whose feet are more than STEP_UP under its top. This is the mover's own rule (player.js blockedIn:
  // `c.maxY <= yd + STEP_UP` is ignored, supportIn lifts the feet onto it): a body whose highest vertex is under the step height above the ground the
  // capsule stands on is a step, never an obstacle, and that covers a capsule standing ON a body (top - feet <= 0.10 m, the old test) and a pebble
  // beside a rock whose box the capsule is held off (Wave 7, lane 7H: a 0.11 m pebble under the feet of a sprint that the rock's box stopped read
  // "0.5 m inside the drawn body" when the pebbleOnly fallback below had kept it as the instance's only body). 1e9 when every body is a step.
  const bodyIsStep = (hh, b, y) => hh.tops[b] - y < STEP_UP;
  const sdBodiesAt = (px, pz, y, hh) => { let m = 1e9; for (let b = 0; b < hh.bodies.length; b++) { if (bodyIsStep(hh, b, y)) continue; const d = sdPoly(px, pz, hh.bodies[b]); if (d < m) m = d; } return m; };
  const dRect = (c, x, z) => Math.hypot(Math.max(c.minX - x, 0, x - c.maxX), Math.max(c.minZ - z, 0, z - c.maxZ));
  // (sprints, rocks; L4-gates 2026-10-13) The drawn body of a rock is a CONVEX HULL of its vertices in the player's body band, and a rock is not convex: the hull
  // fills the empty angle between the lobes and the flare of its foot. A capsule standing on a low shoulder of a rock, or walking through an open angle of its
  // hull, read "0.4-0.8 m inside the body" with no drawn solid under it (vertical rays through the capsule centre: every one of the 11 sprints that stayed red on
  // the Wave-5 leftovers tree was either standing on the drawn surface or over an open gap; none ended inside). So a point the hull flags counts only when the
  // DRAWN triangles confirm that the body overlaps drawn solid:
  //   (a) the capsule's centre column: the topmost drawn surface under the centre is more than 0.10 m above the feet (the centre is INSIDE a solid that rises over
  //       the feet: sinking into a rock, or lifted late. A legitimate step-up has the feet on the surface by the time the centre is over it: the mover's support
  //       footprint (0.3 m) catches the edge before the centre arrives), or
  //   (b) a ring of 12 points at R - 0.10 m: a drawn surface more than STEP_UP (0.55 m) above the feet (a wall the mover will not step onto, overlapped by more
  //       than 10 cm at the disc's edge; a lower surface there is a step the mover climbs, which overlaps the disc edge by up to 0.15 m on the way).
  // In both, solid that starts above the head (bottom hit > feet + body height - 0.05) is not in the way. A build whose triangles cannot be read keeps the hull verdict.
  // (sprints, rocks; Wave 7 lane 7H, 2026-10-14) Two more rules of the same kind, found by replaying the five stage-B failures (ashgrid seeds 7 (x2), 1, 1234,
  // 31337 on the working copy, seed 31337 on 60b854d0: every one the same instance type, none a rock that was not stopped by its box):
  //   (c) a body is judged at a trace point only if its top is at least STEP_UP above the FEET there (bodyIsStep). The pebbleOnly fallback in props() keeps
  //       every sub-mesh of an instance whose rock proper reads under the step height (0.531-0.547 m over the MEAN terrain under its outline, while the
  //       box, measured at the terrain under the box centre, is a wall): the 0.11-0.15 m pebble then became "the drawn body", the capsule held off the box
  //       face stood on the pebble's centre, and rule (a) read the pebble's 0.102-0.130 m rise over the feet as a solid in the way. The mover walks over
  //       such a pebble (no collider by design: maps.js builds no box under 0.3 m), the old 'feet >= top - 0.10' skip was the special case of (c) that
  //       only covered standing on it. The rock proper stays judged (it is 0.55-0.72 m over the feet on its low side, the box stops the capsule there).
  //   (d) the drawn triangles that confirm a flagged body are that body's own (bodySubs), not the union of every kept sub-mesh.
  const CONFIRM_KINDS = new Set(["rocks"]);
  const CONFIRM_RING = Array.from({ length: 12 }, (_, k) => [Math.cos(k * Math.PI / 6), Math.sin(k * Math.PI / 6)]);
  let _confirmRay = null, _confirmTHREE = null;
  // The drawn triangles of ONE body (hh.bodySubs[b]: the sub-meshes that make it up). A flagged body is confirmed by its OWN triangles: the triangles of
  // another body of the instance (a pebble, the low rock beside the proper one) say nothing about whether the capsule is inside THIS one.
  function drawnMeshes(kind, i, hh, b) {
    hh._drawn = hh._drawn || {};
    if (hh._drawn[b]) return hh._drawn[b];
    hh._drawn[b] = ((hh.bodySubs || [])[b] || []).map((si) => (STATE.subsByKind[kind] || [])[si]).filter((o) => o && i < o.count).map((o) => {
      const m4 = new _confirmTHREE.Matrix4(); o.getMatrixAt(i, m4);
      const mm = new _confirmTHREE.Mesh(o.geometry, new _confirmTHREE.MeshBasicMaterial({ side: _confirmTHREE.DoubleSide }));
      mm.matrixAutoUpdate = false; mm.matrixWorld.multiplyMatrices(o.matrixWorld, m4); mm.matrix.copy(mm.matrixWorld);
      return mm;
    });
    return hh._drawn[b];
  }
  const rayDown = (meshes, px, pz, y) => {
    _confirmRay.set(new _confirmTHREE.Vector3(px, y + CAPH + 4, pz), new _confirmTHREE.Vector3(0, -1, 0)); _confirmRay.near = 0; _confirmRay.far = CAPH + 30;
    return _confirmRay.intersectObjects(meshes, false).map((h) => h.point.y);
  };
  function drawnOverlap(kind, i, hh, b, x, y, z) {
    const meshes = drawnMeshes(kind, i, hh, b);
    if (!meshes.length) return true;
    const inTheWay = (hits, rise) => hits.length > 0 && hits[0] > y + rise && (hits.length < 2 || hits[hits.length - 1] < y + CAPH - 0.05);
    if (inTheWay(rayDown(meshes, x, z, y), 0.10)) return true;
    for (const [cx, cz] of CONFIRM_RING) if (inTheWay(rayDown(meshes, x + cx * (R - 0.10), z + cz * (R - 0.10), y), STEP_UP)) return true;
    return false;
  }
  // points on the boundary of (AABB (+) disc r): the capsule-centre positions that just touch the collider
  function rrPts(c, r, k) {
    const o = [], { minX, maxX, minZ, maxZ } = c;
    for (let i = 0; i <= k; i++) {
      const t = i / k;
      o.push([minX + (maxX - minX) * t, minZ - r], [minX + (maxX - minX) * t, maxZ + r], [minX - r, minZ + (maxZ - minZ) * t], [maxX + r, minZ + (maxZ - minZ) * t]);
    }
    for (const [cx, cz, a0, a1] of [[minX, minZ, Math.PI, 1.5 * Math.PI], [maxX, minZ, 1.5 * Math.PI, 2 * Math.PI], [maxX, maxZ, 0, 0.5 * Math.PI], [minX, maxZ, 0.5 * Math.PI, Math.PI]])
      for (let i = 1; i < k; i++) { const a = a0 + (a1 - a0) * i / k; o.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
    return o;
  }
  // body-surface gap between a prop's collider SET (one or several AABBs) and the drawn hull H: boundary of the union of the
  // inflated boxes, signed distance to the hull minus the capsule radius. clip = deepest overlap, gapMax = widest standoff.
  function contactSet(cs, bodies) {
    let mn = 1e9, mx = -1e9, sum = 0, n = 0, worst = null, widest = null;
    for (const c of cs) for (const p of rrPts(c, R, 12)) {
      let interior = false;
      for (const o of cs) { if (o !== c && dRect(o, p[0], p[1]) < R - 1e-6) { interior = true; break; } }
      if (interior) continue;
      const g = sdBodies(p[0], p[1], bodies) - R; sum += g; n++;
      if (g < mn) { mn = g; worst = p; } if (g > mx) { mx = g; widest = p; }
    }
    return n ? { clip: Math.max(0, -mn), gapMax: mx, gapMean: sum / n, worst, widest } : { clip: 0, gapMax: 0, gapMean: 0, worst: null, widest: null };
  }
  const setBox = (cs) => { let a = 1e9, b = -1e9, c = 1e9, d = -1e9, y0 = 1e9, y1 = -1e9; for (const o of cs) { a = Math.min(a, o.minX); b = Math.max(b, o.maxX); c = Math.min(c, o.minZ); d = Math.max(d, o.maxZ); y0 = Math.min(y0, o.minY); y1 = Math.max(y1, o.maxY); } return { minX: a, maxX: b, minZ: c, maxZ: d, minY: y0, maxY: y1, cx: (a + b) / 2, cz: (c + d) / 2 }; };
  const centroid = (H) => { let x = 0, z = 0; for (const q of H) { x += q[0]; z += q[1]; } return [x / H.length, z / H.length]; };
  // SOFT foliage (needles, leaves) is walk-through and shoot-through in every shipped battle royale: only the trunk, the rock, the car,
  // the barrel count as solid. A sub-mesh whose material is named like foliage is left out of the "drawn body" the colliders are judged
  // against (a pine's skirt of needles reaches the ground and is 5 m wide: no trunk collider can, or should, match it). A kind whose
  // sub-meshes are ALL soft keeps them all.
  const SOFT = /green|leaf|leaves|foliage|frond|needle/i;
  const solidSubs = (subs) => { const s = subs.filter((o) => !(o.material && SOFT.test(o.material.name || ""))); return s.length ? s : subs; };

  // ---------------------------------------------------------------- player driving
  const p = () => W.player;
  function place(x, z, y) {
    const P = p(), m = M();
    P.alive = true; P.hp = 100; P.shield = 100;
    P.pos.set(x, y != null ? y : Math.max(m.heightAt(x, z), m.waterY - 5) + 0.02, z); P.vel.set(0, 0, 0);
    P.onGround = y == null; P.gliding = false; P.swimming = false; P.mantleT = null; P.emoting = null; P.healing = null; P._portalBoost = false;
    const inp = P.input; inp.mx = 0; inp.mz = 0; inp.jump = false; inp.sprint = false; inp.ads = false; inp.crouch = false; inp.fire = false; inp.pitch = 0;
    C.fastForward(4 / 60);
  }
  function walk(ux, uz, ticks, sprint) {
    const P = p(), inp = P.input; inp.yaw = Math.atan2(-ux, -uz); inp.mz = 1; inp.mx = 0; inp.sprint = !!sprint;
    const tr = [];
    for (let i = 0; i < ticks; i++) { C.fastForward(1 / 60); tr.push([P.pos.x, P.pos.y, P.pos.z, P.mantleT != null]); P.hp = 100; }
    inp.mz = 0; inp.sprint = false; return tr;
  }
  const qc = (x, z, r) => { const out = []; M().queryColliders(x, z, r, out); return out; };
  // nothing solid within `rad` of (x,z) at the feet height (a start point that is not inside a wall)
  const freeAt = (x, z, y, rad) => {
    for (const o of qc(x, z, rad + 2)) {
      if (o.dead || o.kind === "ramp") continue;
      if (o.maxY <= y + 0.55 || o.minY >= y + CAPH) continue;
      if (dRect(o, x, z) < rad) return false;
    }
    return true;
  };
  // no other collider within `rad` metres (box-to-box, in x,z) of the prop's collider set
  const isolatedSet = (cs, rad) => {
    const b = setBox(cs), ext = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
    for (const o of qc(b.cx, b.cz, ext + rad + 2)) {
      if (o.dead || cs.includes(o) || o.kind === "ramp") continue;
      const gx = Math.max(b.minX - o.maxX, o.minX - b.maxX, 0), gz = Math.max(b.minZ - o.maxZ, o.minZ - b.maxZ, 0);
      if (Math.hypot(gx, gz) < rad) return false;
    }
    return M().heightAt(b.cx, b.cz) > M().waterY + 0.8;
  };

  // ---------------------------------------------------------------- props: analytic collider vs drawn mesh
  async function props(opt) {
    const THREE = await import("three");
    const m = M();
    const g = W.group("map");
    // The map-wide prop meshes never cast (maps.js: "NOTHING map-wide casts any more"); the small near-caster proxies rebuilt around the camera focus do. The old filter dropped a
    // proxy only when it did not also receive shadow; the Savanna tree proxies (Wave-7 completion round, D2) receive too, so a plain castShadow test is the one that keeps them out.
    const insts = []; g.traverse((o) => { if (o.isInstancedMesh && !o.castShadow) insts.push(o); });
    const byKind = {};
    for (const c of m.colliders) if (c.prop && !c.dead) ((byKind[c.prop] = byKind[c.prop] || {})[c.idx] = byKind[c.prop][c.idx] || []).push(c);
    const m4 = new THREE.Matrix4(), mw = new THREE.Matrix4(), v = new THREE.Vector3();
    const out = { kinds: {}, notes: [] };
    STATE.hulls = {}; STATE.samples = {}; STATE.groups = byKind; STATE.insts = insts; STATE.subsByKind = {};
    for (const kind of Object.keys(byKind)) {
      let root; try { root = await W.kernel.loadGLTF(W.assetBase + "assets/props/" + kind + ".glb"); } catch (e) { out.notes.push("no GLB for collider prop kind " + kind); continue; }
      root.updateMatrixWorld(true);
      const glbMeshes = []; root.traverse((o) => { if (o.isMesh) glbMeshes.push(o); });
      const geos = new Set(glbMeshes.map((o) => o.geometry));
      let allSubs = insts.filter((o) => geos.has(o.geometry));
      // maps.js may draw a kind from geometry that is not the GLB's own (Wave-7 completion round, Savanna only: meshes of ONE material baked into one geometry to save draw calls, the
      // acacia's trunk replaced by a coarse copy on the map-wide mesh). The harness judges the colliders against the DRAWN parts of the GLB, not against the draw calls: when some GLB
      // mesh has no instanced mesh of its own, every GLB mesh becomes a virtual sub-mesh - its own full-detail geometry under the kind's instance transform. The transform comes from
      // the first map-wide instanced mesh of the kind's materials (maps.js bakes a GLB mesh's local matrix into the instance matrix when it draws the mesh alone, and into the
      // vertices when it merges, so that mesh's own local matrix is divided out first).
      if (!allSubs.length || !glbMeshes.every((o) => allSubs.some((q) => q.geometry === o.geometry))) {
        const mats = new Set(glbMeshes.map((o) => o.material));
        // the map-wide mesh that carries THIS kind's instance matrices: one of the kind's materials AND as many instances as the kind has (a material can be shared with another kind: the
        // Savanna trees, birches and pines all use "Green"); among those, the first drawn
        const nInst = Math.max(...Object.keys(byKind[kind]).map(Number)) + 1;
        const cands = insts.filter((o) => mats.has(o.material) && o.count >= nInst);
        cands.sort((a, b) => (a.count - nInst) - (b.count - nInst));
        const t = cands[0];
        if (t) {
          // the GLB mesh whose local matrix maps.js folded into the instance matrix: the one whose geometry the mesh draws, or (a coarse LOD copy of it) the only GLB mesh of that material
          const sameMat = glbMeshes.filter((o) => o.material === t.material);
          const own = glbMeshes.find((o) => o.geometry === t.geometry) || (sameMat.length === 1 ? sameMat[0] : null);
          const l0inv = own ? own.matrixWorld.clone().invert() : new THREE.Matrix4();
          // D2's tree LOD (Savanna): the trees within 110 m of the camera focus are hidden on the coarse map-wide twin (a 1e-4 scale matrix) while a small near-caster proxy draws them in
          // full. Their TRUE matrices are the proxy's, in ascending instance order; reading the hidden ones as they are would put the drawn body at the origin (gap 200 m, clip 0).
          const hidden = []; { const e = new THREE.Matrix4(); for (let q = 0; q < t.count; q++) { t.getMatrixAt(q, e); if (Math.abs(e.elements[0]) < 1e-3 && Math.abs(e.elements[5]) < 1e-3) hidden.push(q); } }
          let rank = null, proxy = null;
          if (hidden.length) {
            const proxies = []; g.traverse((o) => { if (o.isInstancedMesh && o.castShadow && o.material === t.material && o.count === hidden.length) proxies.push(o); });
            if (proxies.length === 1) { proxy = proxies[0]; rank = new Map(hidden.map((q, k) => [q, k])); }
            out.notes.push(kind + ": " + hidden.length + " instances are hidden on the map-wide mesh by the near-field LOD swap; " + (proxy ? "their true matrices are read from the near-caster proxy" : "NO unique near-caster proxy found (" + proxies.length + "): they are judged at the hidden (collapsed) matrix"));
          }
          const trueAt = (i, outM) => { t.getMatrixAt(i, outM); if (rank && rank.has(i)) proxy.getMatrixAt(rank.get(i), outM); return outM; };
          allSubs = glbMeshes.map((o) => ({ virtual: true, geometry: o.geometry, material: o.material, count: t.count, matrixWorld: t.matrixWorld, getMatrixAt: (i, out) => { trueAt(i, out); out.multiply(l0inv); out.multiply(o.matrixWorld); return out; } }));
          out.notes.push(kind + ": drawn from a merged / simplified map-wide mesh: judged against the GLB's own " + allSubs.length + " parts under the instance transform");
        }
      }
      if (!allSubs.length) { out.notes.push("no instanced mesh for prop kind " + kind); continue; }
      const subs = solidSubs(allSubs);
      if (subs.length !== allSubs.length) out.notes.push(kind + ": soft foliage sub-meshes left out of the drawn body: " + allSubs.filter((o) => !subs.includes(o)).map((o) => o.material.name).join(","));
      const recs = []; STATE.hulls[kind] = {};
      for (const idx of Object.keys(byKind[kind])) {
        const i = +idx, cs = byKind[kind][idx], base = Math.min(...cs.map((c) => c.minY));
        const perSub = []; let top = -1e9; let sc = 0; let tilt = 0;
        for (let si = 0; si < subs.length; si++) {
          const o = subs[si]; if (i >= o.count) continue;
          o.getMatrixAt(i, m4); mw.multiplyMatrices(o.matrixWorld, m4);
          if (si === 0) { const e = mw.elements; sc = Math.hypot(e[0], e[1], e[2]); tilt = Math.acos(Math.max(-1, Math.min(1, e[5] / (Math.hypot(e[4], e[5], e[6]) || 1)))) * 180 / Math.PI; }
          const pa = o.geometry.attributes.position, sp = []; let subTop = -1e9;
          for (let k = 0; k < pa.count; k++) {
            v.fromBufferAttribute(pa, k).applyMatrix4(mw);
            if (v.y > top) top = v.y;
            if (v.y > subTop) subTop = v.y;
            if (v.y >= base + 0.15 && v.y <= base + 1.8) sp.push([v.x, v.z]);
          }
          perSub.push({ pts: sp, top: subTop, sub: si });
        }
        // merge touching sub-meshes into bodies, then drop the pebbles (bodies the mover steps over) unless nothing else is left. "Steps over" is
        // relative to the ground the body stands on (a small rock on the uphill side of a cluster on a slope is low to a walker): its highest
        // vertex above the mean terrain height under its outline
        const groups = mergeBodies(perSub, SEPARATE_PARTS.has(kind));
        for (const gr of groups) { let sg = 0; for (const q of gr.H) sg += m.heightAt(q[0], q[1]); gr.h = gr.top - sg / gr.H.length; }
        const tall = groups.filter((gr) => gr.h >= STEP_UP);
        // the same rule on the collider side: a collider whose top is under the step height above the ground it stands on is a step the mover
        // climbs onto, not a wall (maps.js builds boxes for rock parts from 0.3 m up; the shot test sees them all, so `csAll` still goes to the
        // bullet rays)
        const csTall = cs.filter((c) => c.maxY - m.heightAt((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2) >= STEP_UP);
        // nothing here that a walker can't step over, drawn or collided: not an obstacle at all, nothing to judge
        if (!tall.length && !csTall.length) { recs.push({ i, stepOnly: true }); continue; }
        // a collider that stands over nothing but pebbles is a phantom wall: the pebbles stay as the (low) drawn body it is judged against
        const pebbleOnly = groups.length > 0 && tall.length === 0;
        const kept = pebbleOnly ? groups : tall;
        const bodies = kept.map((gr) => gr.H);
        const H = hull(bodies.flat());
        if (H.length < 3) { recs.push({ i, noBand: true }); continue; }
        const keepSubs = kept.flatMap((gr) => gr.subs);
        const csUse = csTall.length ? csTall : cs;
        const ct = contactSet(csUse, bodies);
        // what the best axis-aligned boxes (one tight AABB per drawn body) would score on the same mesh: a box cannot hug a round or a leaning
        // body, so the standoff the C-COLL contract cannot avoid is subtracted from the gap (gapExcess = how much worse than the best box)
        const ctI = contactSet(idealBoxes(bodies), bodies);

        const b = setBox(csUse);
        recs.push({ i, x: r3(b.cx), z: r3(b.cz), base: r3(base), s: r3(sc), tilt: r3(tilt), bodies: bodies.length, pebbles: groups.length - kept.length, stepColliders: cs.length - csUse.length, pebbleOnly, clip: r3(ct.clip), gapMax: r3(ct.gapMax), gapMean: r3(ct.gapMean), gapIdeal: r3(ctI.gapMax), gapExcess: r3(Math.max(0, ct.gapMax - ctI.gapMax)), visTop: r3(top - base), colTop: r3(b.maxY - base), n: cs.length, worst: ct.worst && ct.worst.map(r3), widest: ct.widest && ct.widest.map(r3) });
        STATE.hulls[kind][i] = { H, bodies, tops: kept.map((gr) => gr.top), base, cs: csUse, csAll: cs, keepSubs, bodySubs: kept.map((gr) => gr.subs) };
      }
      STATE.subsByKind[kind] = subs;
      const ok = recs.filter((r) => !r.noBand && !r.stepOnly);
      STATE.samples[kind] = ok;
      const clips = ok.map((r) => r.clip), gaps = ok.map((r) => r.gapMax);
      out.kinds[kind] = {
        n: Object.keys(byKind[kind]).length, measured: ok.length, noBand: recs.filter((r) => r.noBand).length, stepOnly: recs.filter((r) => r.stepOnly).length, collidersPerInstance: r3(Object.values(byKind[kind]).reduce((s, a) => s + a.length, 0) / Math.max(1, Object.keys(byKind[kind]).length)), bodiesPerInstance: r3(ok.reduce((s, r) => s + r.bodies, 0) / Math.max(1, ok.length)),
        clip: { p50: pct(clips, 0.5), p95: pct(clips, 0.95), max: pct(clips, 1), over10: share(clips, (x) => x > 0.10), over25: share(clips, (x) => x > 0.25), over30: share(clips, (x) => x > 0.30) },
        gapMax: { p50: pct(gaps, 0.5), p95: pct(gaps, 0.95), max: pct(gaps, 1), over30: share(gaps, (x) => x > 0.30) },
        gapIdeal: { p50: pct(ok.map((r) => r.gapIdeal), 0.5), p95: pct(ok.map((r) => r.gapIdeal), 0.95), max: pct(ok.map((r) => r.gapIdeal), 1) },
        gapExcess: { p50: pct(ok.map((r) => r.gapExcess), 0.5), p95: pct(ok.map((r) => r.gapExcess), 0.95), max: pct(ok.map((r) => r.gapExcess), 1), over15: share(ok, (r) => r.gapExcess > 0.15) },
        pebblesDropped: ok.reduce((s, r) => s + r.pebbles, 0), stepCollidersSkipped: ok.reduce((s, r) => s + r.stepColliders, 0), pebbleOnly: ok.filter((r) => r.pebbleOnly).length,
        visTopP50: pct(ok.map((r) => r.visTop), 0.5), colTopP50: pct(ok.map((r) => r.colTop), 0.5),
        worstClip: ok.slice().sort((a, b) => b.clip - a.clip).slice(0, 2),
        // lean: how far the drawn instance's up axis is off vertical (a container laid on a slope leans up to 8 deg while its collider stays level).
        // clip is split into the level and the leaned (>= 1.5 deg) instances so a leaned minority cannot hide in an all-instance p95
        lean: (() => {
          const lv = ok.filter((r) => (r.tilt || 0) < 1.5), ln = ok.filter((r) => (r.tilt || 0) >= 1.5);
          const part = (a) => ({ n: a.length, p95: pct(a.map((r) => r.clip), 0.95), max: pct(a.map((r) => r.clip), 1), over25: share(a.map((r) => r.clip), (x) => x > 0.25), maxTilt: a.length ? pct(a.map((r) => r.tilt || 0), 1) : null,
            worst: a.slice().sort((x, y) => y.clip - x.clip).slice(0, 2).map((r) => ({ i: r.i, x: r.x, z: r.z, tilt: r.tilt, clip: r.clip })) });
          return { level: part(lv), leaned: part(ln) };
        })(),
      };
    }
    return out;
  }

  // ---------------------------------------------------------------- live: sprints, phantom walks, bullets vs drawn mesh
  async function live(opt) {
    const THREE = await import("three");
    const m = M(), PERK = (opt && opt.perKind) || 8;
    const out = { walk: {}, phantom: {}, bullets: {} };
    _confirmTHREE = THREE; _confirmRay = new THREE.Raycaster();
    const kinds = Object.keys(STATE.hulls);
    const picked = {};
    for (const kind of kinds) {
      const ids = Object.keys(STATE.hulls[kind]).map(Number);
      const cand = ids.filter((i) => isolatedSet(STATE.hulls[kind][i].csAll, 5));
      const recs = (STATE.samples[kind] || []).filter((r) => cand.includes(r.i)).sort((a, b) => a.clip - b.clip);
      const pick = []; const N = Math.min(PERK, recs.length);
      for (let k = 0; k < N; k++) pick.push(recs[Math.round((recs.length - 1) * (N === 1 ? 1 : k / (N - 1)))].i);
      picked[kind] = [...new Set(pick)];
      // ---- 1. sprint into the prop from 8 angles at 4.5 m (real stepActor); deepest overlap with the drawn base hull
      const res = [];
      let hullOnly = 0;          // trace points the hull flagged (> 10 cm inside) that the drawn triangles did not confirm (rocks only)
      let startsBackedOff = 0;   // run-ups whose 4.5 m start stood in a wall box and were started further back (information)
      for (const i of picked[kind]) {
        const hh = STATE.hulls[kind][i]; const [cx, cz] = centroid(hh.H);
        for (let a = 0; a < 8; a++) {
          const ang = a * Math.PI / 4 + 0.13, ux = Math.cos(ang), uz = Math.sin(ang);
          // The run-up starts 4.5 m before the centroid of the drawn bodies. A wide cluster has parts whose boxes cover that spot (exhaustive sweep, 2026-10-14:
          // deepwood seeds 1 and 2026, 4 of 8,600+ sprints started INSIDE the wall box of a neighbouring part and read "1 m inside"): a start in a wall says
          // nothing about the fit, so the start backs off in 0.5 m steps until the capsule stands in the open (walls() and doors() guard their starts with
          // freeAt the same way) and the sprint is lengthened by the same distance. Runs are never dropped: the count stays 8 per instance.
          let back = 0;
          for (; back < 8; back += 0.5) { const sx = cx - ux * (4.5 + back), sz = cz - uz * (4.5 + back); if (freeAt(sx, sz, m.heightAt(sx, sz), R)) break; }
          if (back > 0) startsBackedOff++;
          place(cx - ux * (4.5 + back), cz - uz * (4.5 + back));
          const tr = walk(ux, uz, 75 + Math.ceil(back / 0.12), true);
          let mn = 9, at = null;
          for (const q of tr) {
            if (q[3] || q[1] > hh.base + 1.6 || q[1] + CAPH < hh.base + 0.15) continue;
            // the deepest body that counts here: not a step (bodyIsStep), and for rocks one whose OWN drawn triangles confirm the hull's verdict
            let sd = 9, unconfirmed = false;
            for (let b = 0; b < hh.bodies.length; b++) {
              if (bodyIsStep(hh, b, q[1])) continue;
              const d = sdPoly(q[0], q[2], hh.bodies[b]) - R;
              if (d < -0.10 && CONFIRM_KINDS.has(kind) && !drawnOverlap(kind, i, hh, b, q[0], q[1], q[2])) { unconfirmed = true; continue; }
              if (d < sd) sd = d;
            }
            if (unconfirmed) hullOnly++;
            if (sd < mn) { mn = sd; at = q; }
          }
          const last = tr[tr.length - 1];
          res.push({ i, ang: r3(ang), minGap: r3(mn), endGap: r3(sdBodiesAt(last[0], last[2], last[1], hh) - R), onTop: sdBodiesAt(last[0], last[2], last[1], hh) > 1e8, at: at && at.map(r3) });
        }
      }
      // ---- 2. phantom walk: walk (no sprint) at the COLLIDER set's centre from 5 m; where does the body stop vs the drawn hull?
      const ph = [];
      for (const i of picked[kind].slice(0, 3)) {
        const hh = STATE.hulls[kind][i], b = setBox(hh.cs);
        if (!isolatedSet(hh.csAll, 4)) continue;
        for (let a = 0; a < 4; a++) {
          const ang = a * Math.PI / 2 + 0.31, ux = Math.cos(ang), uz = Math.sin(ang);
          place(b.cx - ux * 5, b.cz - uz * 5);
          const tr = walk(ux, uz, 60, false);
          const last = tr[tr.length - 1];
          ph.push({ i, stopFromColliderCentre: r3(Math.hypot(last[0] - b.cx, last[2] - b.cz)), bodyGapToVisual: r3(sdBodies(last[0], last[2], hh.bodies) - R), at: last.map(r3) });
        }
      }
      out.phantom[kind] = { runs: ph.length, over30: ph.filter((q) => q.bodyGapToVisual > 0.3).length, gapP50: pct(ph.map((q) => q.bodyGapToVisual), 0.5), gapMax: pct(ph.map((q) => q.bodyGapToVisual), 1), sample: ph.slice(0, 2) };
      const gaps = res.map((r) => r.minGap);
      out.walk[kind] = { hullOnlyPoints: hullOnly, startsBackedOff, instances: picked[kind].length, runs: res.length, inside10: res.filter((r) => r.minGap < -0.10).length, endInside10: res.filter((r) => r.endGap < -0.10).length,
        deepest: r3(-Math.min(...gaps)), minGapP50: pct(gaps, 0.5), widestStop: r3(Math.max(...gaps)), worst: res.slice().sort((a, b) => a.minGap - b.minGap).slice(0, 2) };
    }
    // ---- 3. bullets: the game's swept shot test (segmentColliders on the prop's own colliders) vs the drawn triangles
    const ray = new THREE.Raycaster();
    const heights = [0.5, 1.2, 1.7, 2.5, 4.0, 5.5];
    for (const kind of kinds) {
      const tally = {}; for (const h of heights) tally[h] = { both: 0, visualOnly: 0, colliderOnly: 0, none: 0 };
      const ideal = { both: 0, visualOnly: 0, colliderOnly: 0 };       // the same rays against the tightest axis-aligned box of each drawn body (body heights only)
      const root = await W.kernel.loadGLTF(W.assetBase + "assets/props/" + kind + ".glb");
      const geos = new Set(); root.traverse((o) => { if (o.isMesh) geos.add(o.geometry); });
      for (const i of picked[kind] || []) {
        // obstacles on both sides: the colliders that stand for a body the walker cannot step over (hh.cs), the way the drawn side leaves out the pebbles.
        // (maps.js also builds boxes for rock parts of 0.3-0.55 m; those are steps for the mover and the shot test sees them - a known, minor
        // disagreement at knee height that this comparison does not judge)
        const hh = STATE.hulls[kind][i], cs = hh.cs, b = setBox(hh.cs);
        // the drawn side of the comparison = the sub-meshes of the kept bodies (props() drops the pebbles the mover steps over)
        const tmp = (hh.keepSubs || []).map((si) => (STATE.subsByKind[kind] || [])[si]).filter((o) => o && i < o.count).map((o) => {
          const m4 = new THREE.Matrix4(); o.getMatrixAt(i, m4);
          const mm = new THREE.Mesh(o.geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
          mm.matrixAutoUpdate = false; mm.matrixWorld.multiplyMatrices(o.matrixWorld, m4); mm.matrix.copy(mm.matrixWorld);
          return mm;
        });
        const ibox = idealBoxes(hh.bodies).map((bx, bi) => ({ ...bx, minY: hh.base, maxY: hh.tops[bi] }));
        const ctrs = [centroid(hh.H), [b.cx, b.cz]];
        const far = Math.hypot(ctrs[0][0] - ctrs[1][0], ctrs[0][1] - ctrs[1][1]) > 4;
        for (const [cx, cz] of (far ? ctrs : ctrs.slice(0, 1))) for (let a = 0; a < 4; a++) {
          const ang = a * Math.PI / 4 + 0.07, ux = Math.cos(ang), uz = Math.sin(ang), px = -uz, pz = ux;
          for (let k = -16; k <= 16; k++) {
            const off = k * 0.2;
            for (const h of heights) {
              const y = hh.base + h;
              const ax = cx - ux * 7 + px * off, az = cz - uz * 7 + pz * off, bx = cx + ux * 7 + px * off, bz = cz + uz * 7 + pz * off;
              ray.set(new THREE.Vector3(ax, y, az), new THREE.Vector3(ux, 0, uz)); ray.near = 0; ray.far = 14;
              const vis = ray.intersectObjects(tmp, false).length > 0;
              const col = !!S.segmentColliders(ax, y, az, bx, y, bz, cs);
              const t = tally[h]; if (vis && col) t.both++; else if (vis) t.visualOnly++; else if (col) t.colliderOnly++; else t.none++;
              if (h <= 1.7) { const ci = ibox.some((bx) => rayBox(ax, y, az, ux, uz, 14, bx)); if (vis && ci) ideal.both++; else if (vis) ideal.visualOnly++; else if (ci) ideal.colliderOnly++; }
            }
          }
        }
        for (const mm of tmp) mm.material.dispose();
      }
      // agreement at body height (0.5 / 1.2 / 1.7 m): of the rays that hit EITHER the drawn mesh or the collider, the share that hit both
      let both = 0, vo = 0, co = 0;
      for (const h of [0.5, 1.2, 1.7]) { both += tally[h].both; vo += tally[h].visualOnly; co += tally[h].colliderOnly; }
      out.bullets[kind] = { tally, bodyAgreement: both + vo + co ? r3(both / (both + vo + co)) : null, bodyBoth: both, bodyVisualOnly: vo, bodyColliderOnly: co,
        // shots that pass through a drawn solid (the mesh is hit, the collider is not): the part of the disagreement a box can always avoid
        bodyThroughShare: both + vo ? r3(vo / (both + vo)) : null,
        // what the tightest axis-aligned boxes would score on the same rays: the ceiling for a collider that must stay an axis-aligned box
        idealAgreement: ideal.both + ideal.visualOnly + ideal.colliderOnly ? r3(ideal.both / (ideal.both + ideal.visualOnly + ideal.colliderOnly)) : null };
    }
    return out;
  }

  // ---------------------------------------------------------------- doors: lintel colliders over a clear gap
  function doorSurvey() {
    const m = M(), doors = [];
    for (const c of m.colliders) {
      if (c.dead || c.kind === "ramp" || c.prop) continue;
      const hgt = c.maxY - c.minY, w = c.maxX - c.minX, d = c.maxZ - c.minZ;
      if (hgt < 0.6 || hgt > 1.3) continue;
      const alongX = w >= 1.2 && w <= 3.2 && d <= 0.5, alongZ = d >= 1.2 && d <= 3.2 && w <= 0.5;
      if (!alongX && !alongZ) continue;
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2, tc = m.heightAt(cx, cz);
      if (c.minY - tc < 1.9 || c.minY - tc > 3.6) continue;
      let floorMax = -1e9;
      for (const off of [-0.6, 0, 0.6]) {
        const px = alongX ? cx : cx + off, pz = alongX ? cz + off : cz;
        let fs = m.heightAt(px, pz);
        for (const o of qc(px, pz, 0.8)) {
          if (o === c || o.dead) continue;
          if (o.kind !== "ramp" && (o.maxX - o.minX < 1.0 || o.maxZ - o.minZ < 1.0)) continue;
          if (px < o.minX - 0.3 || px > o.maxX + 0.3 || pz < o.minZ - 0.3 || pz > o.maxZ + 0.3) continue;
          const top = o.kind === "ramp" ? o.maxY : o.maxY;
          if (top <= c.minY - 0.45 && top > fs) fs = top;
        }
        floorMax = Math.max(floorMax, fs);
      }
      // the waist band at the floor must be free across the opening centre (a door, not a window)
      let waist = false;
      for (const o of qc(cx, cz, 2.5)) {
        if (o === c || o.dead || o.kind === "ramp") continue;
        if (cx < o.minX - 0.05 || cx > o.maxX + 0.05 || cz < o.minZ - 0.05 || cz > o.maxZ + 0.05) continue;
        if (o.maxY > floorMax + 0.6 && o.minY < floorMax + 1.2) { waist = true; break; }
      }
      if (waist) continue;
      doors.push({ c, cx, cz, alongX, floor: floorMax, head: c.minY - floorMax });
    }
    return doors;
  }
  const roofedAt = (x, z, y) => { for (const o of qc(x, z, 0.4)) { if (o.dead || o.kind === "ramp") continue; if (x < o.minX || x > o.maxX || z < o.minZ || z > o.maxZ) continue; if (o.minY > y + 2.0 && o.minY < y + 12) return true; } return false; };
  async function doors(opt) {
    const m = M(), all = doorSurvey();
    // ground-level doors only (the floor at the door within 0.6 m of the terrain), outside = the unroofed side
    const usable = [];
    for (const dr of all) {
      if (dr.floor - m.heightAt(dr.cx, dr.cz) > 0.6) continue;
      const n0 = dr.alongX ? [0, 1] : [1, 0];
      const a = [dr.cx + n0[0] * 3, dr.cz + n0[1] * 3], b = [dr.cx - n0[0] * 3, dr.cz - n0[1] * 3];
      const ra = roofedAt(a[0], a[1], dr.floor), rb = roofedAt(b[0], b[1], dr.floor);
      if (ra === rb) continue;
      const out = ra ? -1 : 1;                           // sign of the outward normal along n0
      const nx = n0[0] * out, nz = n0[1] * out;
      if (Math.abs(m.heightAt(dr.cx + nx * 3, dr.cz + nz * 3) - dr.floor) > 0.6) continue;
      if (m.heightAt(dr.cx + nx * 3, dr.cz + nz * 3) < m.waterY + 0.5) continue;
      usable.push({ ...dr, nx, nz });
    }
    usable.sort((a, b) => a.cx - b.cx || a.cz - b.cz);
    const want = (opt && opt.max) || 14, pick = [];
    for (let k = 0; k < Math.min(want, usable.length); k++) pick.push(usable[Math.floor((usable.length - 1) * (want === 1 ? 0 : k / (Math.min(want, usable.length) - 1 || 1)))]);
    const res = [];
    for (const L of [...new Set(pick)]) {
      for (const deg of [0, 20, 35, 50]) {
        const a = deg * Math.PI / 180, ox = L.nx * Math.cos(a) - L.nz * Math.sin(a), oz = L.nx * Math.sin(a) + L.nz * Math.cos(a);
        const sx = L.cx + ox * 3.5, sz = L.cz + oz * 3.5;
        if (!freeAt(sx, sz, m.heightAt(sx, sz), R)) continue;
        place(sx, sz);
        const dx = L.cx - L.nx * 2 - sx, dz = L.cz - L.nz * 2 - sz, dl = Math.hypot(dx, dz);
        const tr = walk(dx / dl, dz / dl, 90, false);
        let stuck = 0; for (let k = 1; k < tr.length; k++) if (Math.hypot(tr[k][0] - tr[k - 1][0], tr[k][2] - tr[k - 1][2]) < 0.02) stuck++;
        const last = tr[tr.length - 1];
        const inside = -((last[0] - L.cx) * L.nx + (last[2] - L.cz) * L.nz);
        res.push({ x: r3(L.cx), z: r3(L.cz), deg, inside: r3(inside), gotIn: inside > 0.8, stuckTicks: stuck, head: r3(L.head) });
      }
    }
    return { surveyed: all.length, usable: usable.length, doorsTested: new Set(res.map((r) => r.x + "," + r.z)).size, runs: res.length, gotIn: res.filter((r) => r.gotIn).length,
      stuckP50: pct(res.map((r) => r.stuckTicks), 0.5), stuckMax: pct(res.map((r) => r.stuckTicks), 1), failed: res.filter((r) => !r.gotIn).slice(0, 10) };
  }

  // ---------------------------------------------------------------- thin walls
  async function walls(opt) {
    const m = M();
    const cand = [];
    for (const c of m.colliders) {
      if (c.dead || c.kind === "ramp" || c.prop) continue;
      const w = c.maxX - c.minX, d = c.maxZ - c.minZ, t = Math.min(w, d), L = Math.max(w, d), h = c.maxY - c.minY;
      if (t > 0.45 || L < 2.5 || h < 2.4 || h > 12) continue;
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
      if (c.minY - m.heightAt(cx, cz) > 0.9 || m.heightAt(cx, cz) < m.waterY + 0.5) continue;      // ground-level walls only
      cand.push({ c, cx, cz, t, L, thinX: w < d });
    }
    cand.sort((a, b) => a.cx - b.cx || a.cz - b.cz);
    const want = (opt && opt.max) || 16, pick = [];
    for (let k = 0; k < Math.min(want, cand.length); k++) pick.push(cand[Math.floor((cand.length - 1) * (want === 1 ? 0 : k / (Math.min(want, cand.length) - 1 || 1)))]);
    const res = [];
    for (const Wl of [...new Set(pick)]) {
      const nx = Wl.thinX ? 1 : 0, nz = Wl.thinX ? 0 : 1, tx = -nz, tz = nx;
      for (const side of [1, -1]) for (const deg of [90, 60, 30, 10]) {
        const a = deg * Math.PI / 180;
        const ux = -side * nx * Math.sin(a) + tx * Math.cos(a), uz = -side * nz * Math.sin(a) + tz * Math.cos(a);
        // start 1.6 m off the face (perpendicular offset), 1 m back along the run so the sprint reaches the wall at the middle
        const sx = Wl.cx + side * nx * 1.6 - ux * 1.0, sz = Wl.cz + side * nz * 1.6 - uz * 1.0;
        const gy = m.heightAt(sx, sz);
        if (Math.abs(gy - Wl.c.minY) > 0.9 || !freeAt(sx, sz, gy, R)) continue;
        place(sx, sz);
        const tr = walk(ux, uz, 40, true);
        let crossed = false, maxPen = -1e9;
        for (const q of tr) {
          const lat = Math.abs((q[0] - Wl.cx) * tx + (q[2] - Wl.cz) * tz);
          if (lat > Wl.L / 2 - R) continue;
          const sd = ((q[0] - Wl.cx) * nx + (q[2] - Wl.cz) * nz) * side;
          if (sd < 0) crossed = true; maxPen = Math.max(maxPen, (Wl.t / 2 + R) - sd);
        }
        res.push({ deg, crossed, maxPen: r3(maxPen), x: r3(Wl.cx), z: r3(Wl.cz) });
      }
    }
    return { candidates: cand.length, walls: new Set(res.map((r) => r.x + "," + r.z)).size, runs: res.length, crossed: res.filter((w) => w.crossed).length, maxCapsuleIntoWallFace: pct(res.map((w) => w.maxPen), 1), crossedAt: res.filter((w) => w.crossed).slice(0, 6) };
  }

  // ---------------------------------------------------------------- ramps
  const rampTop = (c, x, z) => {
    let f;
    if (c.dir === 0) f = (x - c.minX) / Math.max(0.01, c.maxX - c.minX); else if (c.dir === 1) f = (c.maxX - x) / Math.max(0.01, c.maxX - c.minX);
    else if (c.dir === 2) f = (z - c.minZ) / Math.max(0.01, c.maxZ - c.minZ); else f = (c.maxZ - z) / Math.max(0.01, c.maxZ - c.minZ);
    return c.minY + (c.maxY - c.minY) * Math.min(1, Math.max(0, f));
  };
  async function ramps(opt) {
    const m = M();
    const cols = m.colliders;
    const rs = cols.map((c, i) => ({ c, i })).filter((o) => o.c.kind === "ramp" && !o.c.dead);
    const out = { n: rs.length };
    // ---- foot lip: how far the low edge sits above whatever it starts from (terrain or a floor slab within 0.6 m of it)
    const lips = [];
    for (const { c } of rs) {
      const pts = [];
      for (let t = 0; t <= 4; t++) {
        const u = t / 4;
        if (c.dir === 0) pts.push([c.minX - 0.3, c.minZ + (c.maxZ - c.minZ) * u]); else if (c.dir === 1) pts.push([c.maxX + 0.3, c.minZ + (c.maxZ - c.minZ) * u]);
        else if (c.dir === 2) pts.push([c.minX + (c.maxX - c.minX) * u, c.minZ - 0.3]); else pts.push([c.minX + (c.maxX - c.minX) * u, c.maxZ + 0.3]);
      }
      const sup = (x, z) => { let f = m.heightAt(x, z), box = false; for (const o of qc(x, z, 0.05)) { if (o === c || o.dead || o.kind !== "box" || x < o.minX || x > o.maxX || z < o.minZ || z > o.maxZ) continue; if (o.maxY <= c.minY + 0.6 && o.maxY > f) { f = o.maxY; box = true; } } return [f, box]; };
      const ss = pts.map((q) => sup(q[0], q[1]));
      if (ss.every((s2) => !s2[1] && s2[0] < m.waterY)) continue;            // a ramp wading out of the sea
      lips.push({ lip: r3(Math.max(...ss.map((s2) => c.minY - s2[0]))), x: r3((c.minX + c.maxX) / 2), z: r3((c.minZ + c.maxZ) / 2), rise: r3(c.maxY - c.minY), onBox: ss[2][1] });
    }
    out.lip = { n: lips.length, max: pct(lips.map((l) => l.lip), 1), p90: pct(lips.map((l) => l.lip), 0.9), over10: lips.filter((l) => l.lip > 0.1).length, over055: lips.filter((l) => l.lip > 0.55).length, worst: lips.slice().sort((a, b) => b.lip - a.lip).slice(0, 4) };
    // ---- climb and descend a spread sample with the real mover
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const sample = rs.filter((_, k) => k % Math.max(1, Math.floor(rs.length / ((opt && opt.max) || 14))) === 0).slice(0, (opt && opt.max) || 14);
    const climb = [], desc = [];
    for (const { c } of sample) {
      const [ux, uz] = dirs[c.dir];
      const along = (c.dir === 0 || c.dir === 1) ? c.maxX - c.minX : c.maxZ - c.minZ;
      const mx = (c.minX + c.maxX) / 2, mz = (c.minZ + c.maxZ) / 2;
      const sx = c.dir === 0 ? c.minX - 1.2 : c.dir === 1 ? c.maxX + 1.2 : mx, sz = c.dir === 2 ? c.minZ - 1.2 : c.dir === 3 ? c.maxZ + 1.2 : mz;
      // the start must be standable ground at the ramp foot (a ramp that starts on a slab is climbed from that slab)
      let f0 = m.heightAt(sx, sz); for (const o of qc(sx, sz, 0.05)) { if (o === c || o.dead || o.kind !== "box" || sx < o.minX || sx > o.maxX || sz < o.minZ || sz > o.maxZ) continue; if (o.maxY <= c.minY + 0.6 && o.maxY > f0) f0 = o.maxY; }
      if (f0 < m.waterY - 0.1 || c.minY - f0 > 1.2) { climb.push({ skipped: "foot not standable", x: r3(mx), z: r3(mz) }); continue; }
      place(sx, sz, f0 + 0.02);
      const tr = walk(ux, uz, Math.ceil((along / 5 + 1.6) * 60), false);
      const maxY = Math.max(...tr.map((q) => q[1]));
      climb.push({ x: r3(mx), z: r3(mz), rise: r3(c.maxY - c.minY), slopeDeg: r3(Math.atan2(c.maxY - c.minY, along) * 180 / Math.PI), reachedTop: maxY >= c.maxY - 0.35, maxY: r3(maxY - c.minY), startDy: r3(f0 - c.minY) });
      // descend: start on the slab surface near the top end, walk back down
      const tx = c.dir === 0 ? c.maxX - 0.6 : c.dir === 1 ? c.minX + 0.6 : mx, tz = c.dir === 2 ? c.maxZ - 0.6 : c.dir === 3 ? c.minZ + 0.6 : mz;
      const ty = rampTop(c, tx, tz);
      place(tx, tz, ty + 0.05);
      const tr2 = walk(-ux, -uz, Math.ceil((along / 5 + 1.6) * 60), false);
      const last = tr2[tr2.length - 1];
      const downTo = Math.min(...tr2.map((q) => q[1]));
      // "the foot" = the ground the ramp starts from (terrain, or a slab within 0.6 m): a ramp whose foot is sunk into a hill
      // ends on that higher ground
      desc.push({ x: r3(mx), z: r3(mz), rise: r3(c.maxY - c.minY), startY: r3(ty), endY: r3(last[1]), footGround: r3(f0), reachedFoot: downTo <= Math.max(c.minY, f0) + 0.6, movedAlong: r3((last[0] - tx) * -ux + (last[2] - tz) * -uz) });
    }
    const cl = climb.filter((x) => !x.skipped);
    out.climb = { sampled: sample.length, runs: cl.length, skipped: climb.length - cl.length, reachedTop: cl.filter((x) => x.reachedTop).length, failed: cl.filter((x) => !x.reachedTop).slice(0, 8) };
    out.descend = { runs: desc.length, reachedFoot: desc.filter((x) => x.reachedFoot).length, failed: desc.filter((x) => !x.reachedFoot).slice(0, 8) };
    // ---- the hide area under tall ramps: cells under the slab where a capsule can STAND (real mover) and a chest-high shot is
    //      stopped by the ramp itself. C-RAMP (movement blocked under a ramp, or shots testing only the slab band) makes it 0.
    const CELL = 0.5;
    let hideCells = 0, anyCells = 0, standCells = 0, cells = 0; const hideEx = [];
    const dirs8 = []; for (let k = 0; k < 8; k++) dirs8.push([Math.cos(k * Math.PI / 4 + 0.1), Math.sin(k * Math.PI / 4 + 0.1)]);
    for (const { c } of rs) {
      const h = c.maxY - c.minY; if (h < 2.1) continue;
      const along = (c.dir === 0 || c.dir === 1) ? c.maxX - c.minX : c.maxZ - c.minZ;
      for (let x = c.minX + CELL / 2; x < c.maxX; x += CELL) for (let z = c.minZ + CELL / 2; z < c.maxZ; z += CELL) {
        const top = rampTop(c, x, z);
        let floor = m.heightAt(x, z);
        for (const o of qc(x, z, 0.05)) { if (o === c || o.dead || o.kind !== "box" || x < o.minX || x > o.maxX || z < o.minZ || z > o.maxZ) continue; if (o.maxY <= top - 0.3 - 1.0 && o.maxY > floor) floor = o.maxY; }
        if ((top - 0.3) - floor < CAPH + 0.05) continue;                      // no standing room under the slab here
        cells++;
        place(x, z, floor + 0.02);
        const P = p();
        const moved = Math.hypot(P.pos.x - x, P.pos.z - z), rose = P.pos.y - (floor + 0.02);
        if (moved > 0.25 || rose > 0.3) continue;                             // pushed out / lifted onto the slab: not a place to stand
        standCells++;
        // A hide cell is bullet-proof: a chest-high shot from EVERY direction is stopped by this ramp (a cell that is shielded from one side
        // only - the slab dips to chest height further down the run - is exposed from the other seven). The Wave-5 gate counted a cell as
        // shielded when ANY ONE of four axis shots was stopped by the slab: that is a definition error, not a hide area.
        // (the ramp alone is the candidate: a wall of the building that happens to stand there is not what makes the ramp a hiding place)
        const yy = floor + 1.2;
        let stopped = 0;
        for (const [dx, dz] of dirs8) { if (S.segmentColliders(x + dx * 10, yy, z + dz * 10, x, yy, z, [c])) stopped++; }
        if (stopped > 0) anyCells++;
        if (stopped === dirs8.length) { hideCells++; if (hideEx.length < 4) hideEx.push([r3(x), r3(z), r3(floor)]); }
      }
    }
    out.hide = { tallRamps: rs.filter(({ c }) => c.maxY - c.minY >= 2.1).length, cellsUnderSlab: cells, standable: standCells, shielded: hideCells, hideM2: r3(hideCells * CELL * CELL), shieldedFromSomeSide: anyCells, anySideM2: r3(anyCells * CELL * CELL), example: hideEx };
    return out;
  }

  // ---------------------------------------------------------------- falls onto 0.3 m slabs
  async function falls(opt) {
    const m = M(), P = p();
    const slabs = [];
    for (const c of m.colliders) {
      if (c.dead || c.kind !== "box" || c.prop) continue;
      const th = c.maxY - c.minY, w = c.maxX - c.minX, d = c.maxZ - c.minZ;
      if (th < 0.25 || th > 0.45 || w < 3.0 || d < 3.0 || w * d < 16) continue;
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
      // free sky above the middle: nothing else over it within 70 m
      let over = false; for (const o of qc(cx, cz, 2)) { if (o === c || o.dead) continue; if (cx >= o.minX - 0.6 && cx <= o.maxX + 0.6 && cz >= o.minZ - 0.6 && cz <= o.maxZ + 0.6 && o.minY > c.maxY - 0.01) { over = true; break; } }
      if (over) continue;
      // the standing spot must not be a wall/rail neighbour: no other collider within the capsule at the slab top
      if (!freeAt(cx, cz, c.maxY, R + 0.2)) continue;
      slabs.push({ c, cx, cz, th });
    }
    slabs.sort((a, b) => a.cx - b.cx || a.cz - b.cz);
    const want = (opt && opt.slabs) || 6, pick = [];
    for (let k = 0; k < Math.min(want, slabs.length); k++) pick.push(slabs[Math.floor((slabs.length - 1) * (want === 1 ? 0 : k / (Math.min(want, slabs.length) - 1 || 1)))]);
    // The mover lands a falling actor only if some tick ends with the feet within STEP_UP (0.55 m) above the slab top, so whether a
    // drop passes through depends on the sub-tick PHASE of the fall as well as its height: every height is dropped from 8 start
    // heights 0.07 m apart (one landing window), and a drop counts as passed-through if ANY phase went through.
    const drops = (opt && opt.drops) || [5, 12, 20, 26, 28, 31, 36, 45, 60];
    const phases = (opt && opt.phases) || 8;
    const res = [];
    for (const sl of [...new Set(pick)]) for (const dh of drops) for (let ph = 0; ph < phases; ph++) {
      const top = sl.c.maxY;
      place(sl.cx, sl.cz, top + dh + ph * 0.07);
      P.onGround = false; P.vel.set(0, 0, 0); P.alive = true;
      let landed = false, t = 0;
      for (; t < 60 * 14; t++) {
        C.fastForward(1 / 60); P.hp = 100; P.shield = 100; P.alive = true;
        if (P.onGround) { landed = true; break; }
        if (P.pos.y < top - 6) break;
      }
      res.push({ x: r3(sl.cx), z: r3(sl.cz), thick: r3(sl.th), drop: dh, phase: ph, landed, finalDy: r3(P.pos.y - top), passed: P.pos.y < top - 0.5, ticks: t });
    }
    return { slabs: slabs.length, tested: new Set(res.map((r) => r.x + "," + r.z)).size, runs: res.length, passed: res.filter((r) => r.passed).length, byDrop: drops.map((d) => ({ drop: d, runs: res.filter((r) => r.drop === d).length, passed: res.filter((r) => r.drop === d && r.passed).length })), failed: res.filter((r) => r.passed).slice(0, 8) };
  }

  // ---------------------------------------------------------------- the exhaustive sprint sweep (Wave-7 completion round, lane D5: rocksweep.py)
  // live() samples 8 instances per kind. This visits EVERY isolated instance of `kind` (default rocks) from 8 angles with the real mover (stepActor through
  // C.fastForward), judged exactly like live()'s sprint (the same bodyIsStep rule, the same own-triangle confirmation, the same backed-off start). A real
  // mover defect that bites 1 sprint in 3,000 (the 6 mm support window of player.js: blockedIn probes the destination floor from the feet BEFORE gravity,
  // the post-move support test from the feet AFTER it) is invisible in a sample of 64 and shows here as a count.
  async function sprintsAll(opt) {
    const THREE = await import("three");
    _confirmTHREE = THREE; _confirmRay = new THREE.Raycaster();
    const m = M();
    const kind = (opt && opt.kind) || "rocks";
    const ids = Object.keys(STATE.hulls[kind] || {}).map(Number).filter((i) => isolatedSet(STATE.hulls[kind][i].csAll, 5));
    const out = { kind, instances: ids.length, runs: 0, inside10: 0, hullOnly: 0, deepest: 0, fail: [], backed: 0 };
    for (const i of ids) {
      const hh = STATE.hulls[kind][i]; const [cx, cz] = centroid(hh.H);
      for (let a = 0; a < 8; a++) {
        const ang = a * Math.PI / 4 + 0.13, ux = Math.cos(ang), uz = Math.sin(ang);
        let back = 0;
        for (; back < 8; back += 0.5) { const sx = cx - ux * (4.5 + back), sz = cz - uz * (4.5 + back); if (freeAt(sx, sz, m.heightAt(sx, sz), R)) break; }
        if (back > 0) out.backed++;
        place(cx - ux * (4.5 + back), cz - uz * (4.5 + back));
        const tr = walk(ux, uz, 75 + Math.ceil(back / 0.12), true);
        let mn = 9, at = null;
        for (const q of tr) {
          if (q[3] || q[1] > hh.base + 1.6 || q[1] + CAPH < hh.base + 0.15) continue;
          let sd = 9, unconfirmed = false;
          for (let b = 0; b < hh.bodies.length; b++) {
            if (bodyIsStep(hh, b, q[1])) continue;
            const d = sdPoly(q[0], q[2], hh.bodies[b]) - R;
            if (d < -0.10 && CONFIRM_KINDS.has(kind) && !drawnOverlap(kind, i, hh, b, q[0], q[1], q[2])) { unconfirmed = true; continue; }
            if (d < sd) sd = d;
          }
          if (unconfirmed) out.hullOnly++;
          if (sd < mn) { mn = sd; at = q; }
        }
        out.runs++;
        if (mn < -0.10) { out.inside10++; out.fail.push({ i, ang: r3(ang), minGap: r3(mn), at: at && at.map(r3), back }); }
        if (-mn > out.deepest) out.deepest = r3(-mn);
      }
    }
    return out;
  }

  return { props, live, doors, walls, ramps, falls, sprintsAll, _state: STATE };
}
