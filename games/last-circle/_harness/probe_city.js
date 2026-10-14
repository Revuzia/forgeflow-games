() => {
  // probe_city.js - the measuring half of citycheck.py (lane 6E, Wave 6). Promoted from the city research lane's scratch
  // (city_probe.py + analyze.py: dump the built world, cluster the colliders, distances to buildings; isla_towns.cjs: street
  // vs water over many seeds; landfrac.cjs: land share) and from the SKEPTIC's door-checked detector (review/indoor.py), which is the one
  // pinned here with two defects of it fixed (see "Why this one").
  //
  // ONE FILE, TWO HOSTS. It is a function expression returning an API object, like probe_collision.js:
  //   in the page   window.__LCCITY__ = (src)();  window.__LCCITY__.measureLive(opts)      (the real match, the real GLB paths)
  //   in Node       (0, eval)("(" + src + ")()").measure(M, ctx)                            (placement_census.mjs --mode city: the
  //                 UNMODIFIED maps.js imported through three_hooks.mjs; 200 seeds x 3 maps)
  // It reads only the BUILT map (M.colliders, M.heightAt, M.waterY, M.half, M.pois) and never writes it, so it keeps working
  // when maps.js is edited, and it needs neither a DOM nor THREE.
  //
  // THE PINNED "ENTERABLE BUILDING" DETECTOR (detect(); constants in PIN). A building is enterable when you can WALK IN:
  //   1. take every static collider (no prop, not dead); a ramp counts as a solid box here (its sides and underside block, C-RAMP)
  //   2. a ROOF is a thin slab (<= 1.5 m tall, >= 6 m2) whose underside is >= 2.0 m over the ground under its middle
  //   3. under a roof, every 0.5 m cell is INDOOR when: the floor (the highest collider top >= 1.9 m below the roof, else
  //      the ground) is not under the water (+0.3 m); the roof is 1.9-6.5 m over that floor; a body (0.4-1.7 m over the floor)
  //      fits (no collider there); and a wall (a collider at chest height, floor + 1.2 m) is hit in >= 3 of the 4 axis
  //      directions within 20 m (this rejects open canopies, pergolas, bus stops)
  //   4. indoor cells on one floor (|dy| < 1 m) that touch form ROOMS (>= 6 m2); rooms whose boxes come within 1.5 m form
  //      a BUILDING
  //   5. the building is ENTERABLE when some ground-floor cell (floor <= lowest floor + 1 m) has a DOORWAY: walking straight out along an axis
  //      in 0.1 m steps, no collider stands in the body band on the way, and at 0.5, 1.0 or 1.5 m the spot is NOT another indoor cell and its floor is
  //      within 0.55 m of this one (the controller's step). A building with rooms but no doorway is "sealed" (a closed shell, a sealed block).
  // Why this one. Three counts exist for the same HEAD worlds (bbd6aeae seed 7: ashgrid / isla_viva / deepwood):
  //   the lane's cluster detector (contact-clustered colliders, roofed area >= 6 m2, >= 2.8 m tall; asks for NO door)      39 / 37 / 35   (kept as the INFO column `legacyCluster`; this
  //                                                                                                                         port reproduces it exactly)
  //   the skeptic's indoor.py (python)                                                                                      33 / 38 / 33   two defects: round() is banker's, so cell keys at x.5 merged two by two and
  //                                                                                                                         every room under 6 m2 vanished; and wall rays / door probes stepped 0.5 m past 0.32-0.35 m
  //                                                                                                                         walls, so a wall was missed or a sealed room read open depending on the lattice phase
  //   this detector (rays every 0.2 m, a marched door path)                                                                 42 / 37 / 35
  // O3 says "enterable" = you can walk in, so a door-checked count is pinned; citycheck.py --selftest builds a village at 12 lattice phases and proves it.
  //
  // measure(M, ctx) returns one record per (map, seed): enterable buildings, land distance statistics, town-road wetness,
  // per-town enterable counts and the endgame cover counts. citycheck.py applies the thresholds.
  const r1 = (v) => Math.round(v * 10) / 10;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  // cell key: a cell centre is c.minX + 0.25 + k * 0.5, i.e. x * 2 sits on a half-integer; round HALF UP with a tiny bias so two cells 0.5 m apart
  // never share a key (Python's round() is banker's: the skeptic's indoor.py merged every second cell and dropped small buildings under 6 m2)
  const ik = (v) => Math.floor(v * 2 + 0.5 + 1e-6);
  const pctl = (sorted, q) => { if (!sorted.length) return null; const k = (sorted.length - 1) * q; const lo = Math.floor(k); const hi = Math.min(lo + 1, sorted.length - 1); return sorted[lo] + (sorted[hi] - sorted[lo]) * (k - lo); };

  const PIN = {
    version: 1,
    cell: 0.5,              // indoor cell pitch (m)
    roofMaxThick: 1.5,      // a roof slab is at most this tall ...
    roofMinArea: 6,         // ... and at least this big (m2)
    roofMinLift: 2.0,       // ... with its underside this far over the ground under its middle
    headMin: 1.9, headMax: 6.5,   // roof underside over the floor
    bodyLo: 0.4, bodyHi: 1.7,     // a body fits between floor + this and floor + that
    wallY: 1.2, wallDirs: 3, wallReach: 20, wallStep: 0.2,   // chest-height wall hit in >= 3 of 4 axis directions within 20 m (rays marched every 0.2 m: a 0.32 m wall is never skipped)
    roomMinArea: 6.0, joinGap: 1.5,
    doorSteps: [0.5, 1.0, 1.5], doorMarch: 0.1, stepMax: 0.55,
    waterMargin: 0.3, landMargin: 0.6,
    hash: 8,
  };

  // ---------------------------------------------------------------- the detector
  function staticBoxes(colliders, opt) {
    const out = [];
    for (const c of colliders) {
      if (c.prop || c.dead) continue;
      if (c.kind === "ramp" && opt && opt.rampsSolid === false) continue;     // pinned: a ramp's sides and underside block (C-RAMP), so it counts as a wall
      out.push(c);
    }
    return out;
  }

  /**
   * detect(colliders, gnd, waterY[, opt]) -> { buildings: [{x0,x1,z0,z1,x,z,area,rooms,floors,door}], rooms, indoorCells }
   * gnd(x, z) is the physics ground (M.heightAt in the game). Pure; no map object needed.
   */
  function detect(colliders, gnd, waterY, opt) {
    const P = PIN;
    const A = staticBoxes(colliders, opt);
    const wet = waterY > -100;
    const hash = new Map();
    const hkey = (bx, bz) => bx * 131071 + bz;
    for (let k = 0; k < A.length; k++) {
      const c = A[k];
      for (let bx = Math.floor(c.minX / P.hash); bx <= Math.floor(c.maxX / P.hash); bx++) for (let bz = Math.floor(c.minZ / P.hash); bz <= Math.floor(c.maxZ / P.hash); bz++) {
        const kk = hkey(bx, bz); let l = hash.get(kk); if (!l) hash.set(kk, l = []); l.push(k);
      }
    }
    const EMPTY = [];
    const at = (x, z) => hash.get(hkey(Math.floor(x / P.hash), Math.floor(z / P.hash))) || EMPTY;
    const solid = (x, y0, y1, z) => {
      const l = at(x, z);
      for (let i = 0; i < l.length; i++) { const c = A[l[i]]; if (c.minX <= x && x <= c.maxX && c.minZ <= z && z <= c.maxZ && c.minY < y1 && c.maxY > y0) return true; }
      return false;
    };
    // floor at (x, z) for a given ceiling: the highest collider top at least `clear` under it, else the ground
    const floorUnder = (x, z, ceilY, clear) => {
      let fy = gnd(x, z);
      const l = at(x, z);
      for (let i = 0; i < l.length; i++) { const c = A[l[i]]; if (c.minX <= x && x <= c.maxX && c.minZ <= z && z <= c.maxZ && c.maxY <= ceilY - clear && c.maxY > fy) fy = c.maxY; }
      return fy;
    };
    const roofs = [];
    for (let k = 0; k < A.length; k++) {
      const c = A[k];
      if (c.maxY - c.minY <= P.roofMaxThick && (c.maxX - c.minX) * (c.maxZ - c.minZ) >= P.roofMinArea && c.minY >= gnd((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2) + P.roofMinLift) roofs.push(k);
    }
    // 1. indoor cells
    const cx = [], cz = [], cf = [];
    const byKey = new Map();               // "kx,kz" -> [cell ids] (any floor)
    const seen = new Set();                // "kx,kz,floor" dedupe (two roofs over one spot)
    const S = P.cell;
    for (const k of roofs) {
      const c = A[k];
      for (let x = c.minX + S / 2; x < c.maxX; x += S) for (let z = c.minZ + S / 2; z < c.maxZ; z += S) {
        const fy = floorUnder(x, z, c.minY, P.headMin);
        if (wet && fy < waterY + P.waterMargin) continue;
        if (!(fy + P.headMin <= c.minY && c.minY <= fy + P.headMax)) continue;
        if (solid(x, fy + P.bodyLo, fy + P.bodyHi, z)) continue;
        let hits = 0; const yc = fy + P.wallY;
        for (let d = 0; d < 4; d++) {
          const dx = d === 0 ? 1 : d === 1 ? -1 : 0, dz = d === 2 ? 1 : d === 3 ? -1 : 0;
          for (let s = P.wallStep; s < P.wallReach; s += P.wallStep) if (solid(x + dx * s, yc - 0.05, yc + 0.05, z + dz * s)) { hits++; break; }
        }
        if (hits < P.wallDirs) continue;
        const kx = ik(x), kz = ik(z), rf = Math.round(fy);
        const sk = kx + "," + kz + "," + rf;
        if (seen.has(sk)) continue;
        seen.add(sk);
        const id = cx.length; cx.push(x); cz.push(z); cf.push(fy);
        const bk = kx + "," + kz; let l = byKey.get(bk); if (!l) byKey.set(bk, l = []); l.push(id);
      }
    }
    const n = cx.length;
    if (!n) return { buildings: [], rooms: 0, indoorCells: 0 };
    // 2. rooms
    const par = new Int32Array(n); for (let i = 0; i < n; i++) par[i] = i;
    const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    for (let i = 0; i < n; i++) {
      const kx = ik(cx[i]), kz = ik(cz[i]);
      for (let ddx = -1; ddx <= 1; ddx++) for (let ddz = -1; ddz <= 1; ddz++) {
        const l = byKey.get((kx + ddx) + "," + (kz + ddz)); if (!l) continue;
        for (const j of l) if (j !== i && Math.abs(cf[j] - cf[i]) < 1.0) { const a = find(i), b = find(j); if (a !== b) par[b] = a; }
      }
    }
    const roomCells = new Map();
    for (let i = 0; i < n; i++) { const r = find(i); let l = roomCells.get(r); if (!l) roomCells.set(r, l = []); l.push(i); }
    const rooms = [];
    for (const [, l] of roomCells) {
      if (l.length * S * S < P.roomMinArea) continue;
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const i of l) { if (cx[i] < x0) x0 = cx[i]; if (cx[i] > x1) x1 = cx[i]; if (cz[i] < z0) z0 = cz[i]; if (cz[i] > z1) z1 = cz[i]; }
      rooms.push({ cells: l, x0, x1, z0, z1 });
    }
    // 3. buildings = rooms whose boxes come within joinGap
    const rp = rooms.map((_, i) => i);
    const rfind = (a) => { while (rp[a] !== a) { rp[a] = rp[rp[a]]; a = rp[a]; } return a; };
    const G = P.joinGap;
    for (let a = 0; a < rooms.length; a++) for (let b = a + 1; b < rooms.length; b++) {
      const p = rooms[a], q = rooms[b];
      if (p.x0 - G <= q.x1 && q.x0 - G <= p.x1 && p.z0 - G <= q.z1 && q.z0 - G <= p.z1) { const x = rfind(a), y = rfind(b); if (x !== y) rp[y] = x; }
    }
    const groups = new Map();
    for (let a = 0; a < rooms.length; a++) { const r = rfind(a); let l = groups.get(r); if (!l) groups.set(r, l = []); l.push(a); }
    const cellAt = (nx, nz, fy) => {          // is there an indoor cell (same floor +- 1 m) at this spot
      const l = byKey.get(ik(nx) + "," + ik(nz));
      if (!l) return false;
      for (const j of l) if (Math.abs(cf[j] - fy) < 1) return true;
      return false;
    };
    const buildings = [];
    for (const [, ri] of groups) {
      const cells = []; for (const a of ri) for (const i of rooms[a].cells) cells.push(i);
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, lo = 1e9;
      for (const i of cells) { if (cx[i] < x0) x0 = cx[i]; if (cx[i] > x1) x1 = cx[i]; if (cz[i] < z0) z0 = cz[i]; if (cz[i] > z1) z1 = cz[i]; if (cf[i] < lo) lo = cf[i]; }
      let door = false;
      for (const i of cells) {
        if (cf[i] > lo + 1.0) continue;
        const fy = cf[i];
        for (let d = 0; d < 4 && !door; d++) {
          const dx = d === 0 ? 1 : d === 1 ? -1 : 0, dz = d === 2 ? 1 : d === 3 ? -1 : 0;
          // walk out along the axis in 0.1 m steps: ANY collider in the body band on the way is a wall (a 0.35 m wall cannot be hopped over)
          let blocked = false;
          for (let s = P.doorMarch; s <= P.doorSteps[P.doorSteps.length - 1] + 1e-9 && !blocked; s += P.doorMarch) {
            const nx = cx[i] + dx * s, nz = cz[i] + dz * s;
            const nfy0 = floorUnder(nx, nz, fy + P.stepMax + 1e-9, 0);          // the floor under this spot, as the body would stand on it
            if (solid(nx, Math.max(fy, nfy0) + P.bodyLo, Math.max(fy, nfy0) + P.bodyHi, nz)) { blocked = true; break; }
            // only the 0.5 / 1.0 / 1.5 m spots are candidates for "outside"
            const k5 = Math.round(s / 0.5);
            if (Math.abs(s - k5 * 0.5) > 1e-6 || k5 < 1) continue;
            if (cellAt(nx, nz, fy)) continue;                                     // still inside (another indoor cell)
            if (Math.abs(nfy0 - fy) > P.stepMax) { blocked = true; break; }       // a drop or a kerb the controller cannot take
            door = true; break;
          }
        }
        if (door) break;
      }
      const fl = [...new Set(cells.map((i) => Math.round(cf[i] / 2.4)))].length;
      buildings.push({ x0: r3(x0), x1: r3(x1), z0: r3(z0), z1: r3(z1), x: r3((x0 + x1) / 2), z: r3((z0 + z1) / 2), area: r1(cells.length * S * S), rooms: ri.length, floors: fl, door });
    }
    buildings.sort((a, b) => a.x - b.x || a.z - b.z);
    const res = { buildings, rooms: rooms.length, indoorCells: n };
    if (opt && opt.cells) res.cells = cx.map((x, i) => [r3(x), r3(cz[i]), r3(cf[i])]);       // debugging: every indoor cell
    return res;
  }

  // The lane's cluster detector, kept as an INFORMATION column (not a row): contact-cluster the static colliders, a cluster is
  // "enterable" when roofed area >= 6 m2 and it stands >= 2.8 m tall, no door asked for. Sky islands (floor > 12 m over the ground) excluded.
  function legacyCluster(colliders, gnd, waterY) {
    const A = staticBoxes(colliders, { rampsSolid: true });
    const n = A.length; if (!n) return 0;
    const par = new Int32Array(n); for (let i = 0; i < n; i++) par[i] = i;
    const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    const tol = 0.6, hash = new Map();
    const hk = (a, b) => a * 131071 + b;
    for (let i = 0; i < n; i++) { const c = A[i]; for (let bx = Math.floor((c.minX - tol) / 8); bx <= Math.floor((c.maxX + tol) / 8); bx++) for (let bz = Math.floor((c.minZ - tol) / 8); bz <= Math.floor((c.maxZ + tol) / 8); bz++) { const k = hk(bx, bz); let l = hash.get(k); if (!l) hash.set(k, l = []); l.push(i); } }
    for (const [, l] of hash) for (let a = 0; a < l.length; a++) for (let b = a + 1; b < l.length; b++) {
      const p = A[l[a]], q = A[l[b]];
      if (p.minX - tol <= q.maxX && q.minX - tol <= p.maxX && p.minZ - tol <= q.maxZ && q.minZ - tol <= p.maxZ && p.minY - tol <= q.maxY && q.minY - tol <= p.maxY) { const x = find(l[a]), y = find(l[b]); if (x !== y) par[y] = x; }
    }
    const comps = new Map();
    for (let i = 0; i < n; i++) { const r = find(i); let l = comps.get(r); if (!l) comps.set(r, l = []); l.push(A[i]); }
    let count = 0;
    for (const [, L] of comps) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const c of L) { if (c.minX < x0) x0 = c.minX; if (c.maxX > x1) x1 = c.maxX; if (c.minZ < z0) z0 = c.minZ; if (c.maxZ > z1) z1 = c.maxZ; if (c.minY < y0) y0 = c.minY; if (c.maxY > y1) y1 = c.maxY; }
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, gc = gnd(mx, mz);
      const g = Math.min(gc, gnd(x0, z0), gnd(x1, z1), gnd(x0, z1), gnd(x1, z0));
      const area = (x1 - x0) * (z1 - z0);
      if (y0 > gc + 12 || area < 12) continue;
      const height = y1 - Math.max(g, waterY > -100 ? waterY : g);
      if (height < 2.8) continue;
      let roofed = 0;
      for (let sx = x0 + 0.6; sx < x1 - 0.6; sx += 0.5) for (let sz = z0 + 0.6; sz < z1 - 0.6; sz += 0.5) {
        const gy = gnd(sx, sz); let fy = gy;
        for (const c of L) if (c.minX <= sx && sx <= c.maxX && c.minZ <= sz && sz <= c.maxZ && c.maxY <= gy + 1.2 && c.maxY > fy) fy = c.maxY;
        const py = fy + 1.0; let inside = false, roof = false;
        for (const c of L) if (c.minX - 0.35 <= sx && sx <= c.maxX + 0.35 && c.minZ - 0.35 <= sz && sz <= c.maxZ + 0.35) {
          if (c.minY <= py && py <= c.maxY) { inside = true; break; }
          if (fy + 1.9 < c.minY && c.minY < fy + 6.5) roof = true;
        }
        if (!inside && roof) roofed++;
      }
      if (roofed * 0.25 >= 6) count++;
    }
    return count;
  }

  // ---------------------------------------------------------------- the metrics
  /** distance statistics from every dry land cell (pitch g, centres) to the nearest rectangle */
  function landDistance(rects, gnd, waterY, half, g) {
    const N = Math.round((half * 2) / g);
    const dry = waterY < -100;
    const out = [];
    for (let j = 0; j < N; j++) {
      const z = -half + (j + 0.5) * g;
      for (let i = 0; i < N; i++) {
        const x = -half + (i + 0.5) * g;
        if (!dry && !(gnd(x, z) > waterY + PIN.landMargin)) continue;
        let best = 1e9;
        for (let k = 0; k < rects.length; k++) {
          const r = rects[k];
          const dx = x < r.x0 ? r.x0 - x : x > r.x1 ? x - r.x1 : 0, dz = z < r.z0 ? r.z0 - z : z > r.z1 ? z - r.z1 : 0;
          const d = dx * dx + dz * dz; if (d < best) best = d;
        }
        out.push(rects.length ? Math.sqrt(best) : 9999);
      }
    }
    const s = Float64Array.from(out).sort();
    const sh = (f) => (s.length ? r3(out.filter(f).length / s.length) : null);
    return { landCells: s.length, landKm2: r3(s.length * g * g / 1e6), within25: sh((d) => d <= 25), gt80: sh((d) => d > 80), gt150: sh((d) => d > 150),
      median: s.length ? r1(pctl(s, 0.5)) : null, p90: s.length ? r1(pctl(s, 0.9)) : null, mean: s.length ? r1(out.reduce((a, b) => a + b, 0) / s.length) : null };
  }

  function poiOf(pois, x, z) {
    let best = null, bd = 1e9;
    for (const p of pois) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r + 15 && d < bd) { bd = d; best = p.id; } }
    return best;
  }

  /** town road vertices (inside a POI circle + 10 m) whose ground is under the water */
  function roadWetness(M, roadMesh) {
    const wy = M.waterY, pois = M.pois || [];
    const res = { meshFound: !!roadMesh, verts: 0, townVerts: 0, wetTown: 0, wetAll: 0, wetByPoi: {}, townByPoi: {} };
    if (!roadMesh || !roadMesh.geometry || !roadMesh.geometry.attributes.position) return res;
    const p = roadMesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      res.verts++;
      const wet = wy > -100 && Math.min(y, M.heightAt(x, z)) < wy;
      if (wet) res.wetAll++;
      let hit = null, bd = 1e9;
      for (const q of pois) { const d = Math.hypot(x - q.x, z - q.z); if (d < q.r + 10 && d < bd) { bd = d; hit = q.id; } }
      if (hit) { res.townVerts++; res.townByPoi[hit] = (res.townByPoi[hit] || 0) + 1; if (wet) { res.wetTown++; res.wetByPoi[hit] = (res.wetByPoi[hit] || 0) + 1; } }
    }
    return res;
  }

  /** static cover pieces (>= 1.2 m tall, no prop, no ramp) whose middle lies inside a storm circle; thin 0.3 m roof decks apart */
  function endgame(M, SIM, seed, mode) {
    if (!SIM || typeof SIM.Storm !== "function") return null;
    const S = new SIM.Storm({ seed, mode: mode || "standard", half: M.half });
    const circles = S.circles;
    const idx = [circles.length - 3, circles.length - 2, circles.length - 1];
    const out = {};
    const cols = M.colliders.filter((c) => !c.prop && !c.dead && c.kind !== "ramp");
    for (const i of idx) {
      const c = circles[i]; let pieces = 0, roofs = 0;
      for (const k of cols) {
        const mx = (k.minX + k.maxX) / 2, mz = (k.minZ + k.maxZ) / 2;
        if (Math.hypot(mx - c.x, mz - c.z) > c.r) continue;
        if (k.maxY - k.minY >= 1.2) pieces++;
        if (Math.abs((k.maxY - k.minY) - 0.3) < 0.01 && (k.maxX - k.minX) * (k.maxZ - k.minZ) > 20) roofs++;
      }
      out["c" + i] = { x: r1(c.x), z: r1(c.z), r: r1(c.r), pieces, roofs };
    }
    out.final = "c" + (circles.length - 1);
    out.finalPieces = out[out.final].pieces;
    out.finalRoofs = out[out.final].roofs;
    return out;
  }

  /**
   * measure(M, ctx) - one (map, seed) record.
   *   ctx: { SIM, seed, mapId, roadMesh, mode = "standard", grid = 4, withBuildings = false, legacy = true }
   */
  function measure(M, ctx) {
    const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const gnd = M.heightAt, wy = M.waterY, half = M.half || 800;
    const det = detect(M.colliders, gnd, wy, ctx);
    const ent = det.buildings.filter((b) => b.door);
    const pois = (M.pois || []).map((p) => ({ id: p.id, name: p.name, x: r1(p.x), z: r1(p.z), r: p.r }));
    const perPoi = {}; for (const p of pois) perPoi[p.id] = 0;
    let wild = 0;
    for (const b of ent) { const id = poiOf(pois, b.x, b.z); if (id) perPoi[id]++; else wild++; }
    const rects = ent.map((b) => ({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 }));
    const rec = {
      map: ctx.mapId, seed: ctx.seed, half, waterY: wy,
      colliders: M.colliders.length, rooms: det.rooms, indoorBuildings: det.buildings.length, enterable: ent.length, sealed: det.buildings.length - ent.length,
      enterableWild: wild, floors: ent.reduce((a, b) => a + b.floors, 0),
      pois, perPoi,
      cover: landDistance(rects, gnd, wy, half, ctx.grid || 4),
      roads: roadWetness(M, ctx.roadMesh),
      endgame: endgame(M, ctx.SIM, ctx.seed, ctx.mode),
    };
    if (ctx.legacy !== false) rec.legacyCluster = legacyCluster(M.colliders, gnd, wy);
    if (ctx.withBuildings) rec.buildings = ent.map((b) => [b.x, b.z, b.x0, b.x1, b.z0, b.z1, b.floors]);
    rec.ms = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
    return rec;
  }

  /** the in-page entry: the built map of the match that is running */
  function measureLive(opt) {
    const W = window.__LC__.W, M = W.map;
    let roadMesh = null;
    try { const g = W._groups && W._groups.map; if (g) g.traverse((o) => { if (o.name === "roads") roadMesh = o; }); } catch (e) { /* none */ }
    return measure(M, Object.assign({ SIM: W.SIM || (window.FFG && window.FFG.sim && window.FFG.sim.Royale), seed: W.seed, mapId: W.mapId, roadMesh, withBuildings: true }, opt || {}));
  }

  return { PIN, detect, legacyCluster, landDistance, roadWetness, endgame, measure, measureLive };
}
