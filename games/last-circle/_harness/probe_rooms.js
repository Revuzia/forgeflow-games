// probe_rooms.js - the in-page room/door survey and walk of navcheck.py (lane 5D; promoted from the navigation research lane's
// probe_rooms.js, same logic; the shared helper library is pasted ahead of this body by navcheck.py).
//
// B (static, planner): find every ROOM on the map (connected 1 m lattice of standable, roofed floor points under thin roof/slab
//    colliders), then ask the GAME's own planner (bots.js debugNav().findPath / findExit):
//      room -> out : findExit from the room point (non-null = a way out was found)
//      out -> room : findPath from up to 4 open-ground starts ~25 m away to the room point (complete + right floor)
//    by level: ground (agl <= 1.5 m), upper (1.5 .. 7.5 m), top (> 7.5 m: the 4th storey of a tower, where NAV_L 3 runs out of layers).
//    Also counts low-ceiling POCKETS (< 1.85 m headroom) and surveys door lintels (headroom, clear width).
// C (opt.walk): the REAL bot controller + physics. Every other actor is set alive=false (page-local, a throwaway match), one bot is
//    teleported to the start, given moveTo = the goal (with y for upper floors) in state LOOT with think() parked, and fastForwarded
//    until it arrives (2.0 m horizontal, 1.3 m vertical) or the budget runs out. Trials: street -> room and room -> street for each
//    sampled room (all upper rooms up to opt.maxUpper first, then up to opt.maxGround ground rooms); long trips 120-180 m street -> street.
// opt = { walk, maxUpper, maxGround, budgetS, longTrips, seedSalt, traceN }.   READ-ONLY on the map; W.paused is set (fastForward ignores it).
// @@NAVLIB-BEGIN (shared helper library: navcheck.py pastes this block ahead of probe_rooms.js and probe_ticks.js)
const __NAV_H = (W) => {
  const cols = W.map.colliders;
  const colIdx = new Map(); cols.forEach((c, i) => colIdx.set(c, i));
  const qc = (x, z, r) => { const out = []; W.map.queryColliders(x, z, r, out); return out; };
  const STEP_UP = 0.55, R = 0.45, H = 1.8;
  const rampTop = (c, x, z) => {
    let f;
    if (c.dir === 0) f = (x - c.minX) / Math.max(0.01, c.maxX - c.minX);
    else if (c.dir === 1) f = (c.maxX - x) / Math.max(0.01, c.maxX - c.minX);
    else if (c.dir === 2) f = (z - c.minZ) / Math.max(0.01, c.maxZ - c.minZ);
    else f = (c.maxZ - z) / Math.max(0.01, c.maxZ - c.minZ);
    return c.minY + (c.maxY - c.minY) * Math.min(1, Math.max(0, f));
  };
  const topAt = (c, x, z) => (c.kind === "ramp" ? rampTop(c, x, z) : c.maxY);
  // player.js supportIn: highest walkable top <= y + STEP_UP (terrain always counts)
  const supportAt = (x, z, y, L) => {
    L = L || qc(x, z, 0.6);
    let s = W.map.heightAt(x, z), col = null;
    for (const c of L) {
      if (c.dead) continue;
      if (x < c.minX - 0.3 || x > c.maxX + 0.3 || z < c.minZ - 0.3 || z > c.maxZ + 0.3) continue;
      const top = topAt(c, x, z);
      if (top <= y + STEP_UP && top > s) { s = top; col = c; }
    }
    return { s, col };
  };
  // bots.js navRoofed: anything solid 2-12 m above the feet, footprint without margin
  const roofAt = (x, z, y, L) => {
    L = L || qc(x, z, 0.6);
    let best = null;
    for (const c of L) {
      if (c.dead || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      if (c.minY > y + 2.0 && c.minY < y + 12) { if (!best || c.minY < best.minY) best = c; }
    }
    return best;
  };
  // player.js blockedIn (static form): a standing capsule (r 0.45, h 1.8) at feet y overlaps a non-ramp collider
  const capsuleBlocked = (x, z, y, L) => {
    L = L || qc(x, z, 1.0);
    for (const c of L) {
      if (c.dead || c.kind === "ramp") continue;
      if (c.maxY <= y + STEP_UP || c.minY >= y + H) continue;
      const ex = x - Math.min(Math.max(x, c.minX), c.maxX), ez = z - Math.min(Math.max(z, c.minZ), c.maxZ);
      if (ex * ex + ez * ez < R * R) return c;
    }
    return null;
  };
  // horizontal distance to the nearest non-ramp collider that blocks the walk band at feet y
  const wallDist = (x, z, y, L) => {
    L = L || qc(x, z, 2.0);
    let d = 99;
    for (const c of L) {
      if (c.dead || c.kind === "ramp") continue;
      if (c.maxY <= y + STEP_UP || c.minY >= y + H) continue;
      const ex = x - Math.min(Math.max(x, c.minX), c.maxX), ez = z - Math.min(Math.max(z, c.minZ), c.maxZ);
      d = Math.min(d, Math.sqrt(ex * ex + ez * ez));
    }
    return d;
  };
  // building groups: union-find over roof-like colliders (thin, >= 2 m2) whose footprints overlap (+0.5 m)
  const roofish = [];
  for (const c of cols) {
    if (c.kind === "ramp") continue;
    const w = c.maxX - c.minX, d = c.maxZ - c.minZ;
    if (c.maxY - c.minY <= 1.6 && w * d >= 2 && w >= 1.0 && d >= 1.0) roofish.push(c);
  }
  const par = new Map(); roofish.forEach((c) => par.set(c, c));
  const find = (c) => { while (par.get(c) !== c) { par.set(c, par.get(par.get(c))); c = par.get(c); } return c; };
  // bucket by 8 m cells to keep this near-linear
  const B = new Map(), BK = 8;
  roofish.forEach((c) => {
    for (let bx = Math.floor((c.minX - 0.5) / BK); bx <= Math.floor((c.maxX + 0.5) / BK); bx++)
      for (let bz = Math.floor((c.minZ - 0.5) / BK); bz <= Math.floor((c.maxZ + 0.5) / BK); bz++) {
        const k = bx * 100003 + bz; if (!B.has(k)) B.set(k, []); B.get(k).push(c);
      }
  });
  for (const l of B.values()) for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
    const a = l[i], b = l[j];
    if (a.maxX + 0.5 < b.minX || b.maxX + 0.5 < a.minX || a.maxZ + 0.5 < b.minZ || b.maxZ + 0.5 < a.minZ) continue;
    const ra = find(a), rb = find(b); if (ra !== rb) par.set(ra, rb);
  }
  const bldOf = (c) => (c && par.has(c) ? colIdx.get(find(c)) : -1);
  const poiOf = (x, z) => {
    let best = null, bd = 1e9;
    for (const p of W.map.pois) { const d = Math.hypot(p.x - x, p.z - z) - p.r; if (d < bd) { bd = d; best = p; } }
    return best ? (bd <= 0 ? best.id : best.id + "+" + Math.round(bd) + "m") : null;
  };
  // where an actor stands: open / indoor_ground / upper_floor / ramp / roof_or_deck / low_structure / water (+door boundary flag)
  const classify = (x, y, z, swimming) => {
    const L = qc(x, z, 2.2);
    const terr = W.map.heightAt(x, z);
    const roof = roofAt(x, z, y, L);
    let sup = null;
    if (y - terr > 0.12) {
      for (const c of L) {
        if (c.dead) continue;
        if (x < c.minX - 0.3 || x > c.maxX + 0.3 || z < c.minZ - 0.3 || z > c.maxZ + 0.3) continue;
        if (Math.abs(topAt(c, x, z) - y) < 0.15) { sup = c; break; }
      }
    }
    let mixed = false;
    for (let k = 0; k < 8 && !mixed; k++) {
      const ang = k * Math.PI / 4, px = x + Math.cos(ang) * 1.6, pz = z + Math.sin(ang) * 1.6;
      if (!!roofAt(px, pz, y, L) !== !!roof) mixed = true;
    }
    const agl = y - terr;
    let kind;
    if (swimming) kind = "water";
    else if (roof) kind = agl > 1.5 ? "upper_floor" : "indoor_ground";
    else if (sup) kind = sup.kind === "ramp" ? "ramp" : agl > 2.0 ? "roof_or_deck" : "low_structure";
    else kind = "open";
    return { kind, door: mixed, onRamp: !!(sup && sup.kind === "ramp"), bld: roof ? bldOf(roof) : (sup ? bldOf(sup) : -1),
      agl: +agl.toFixed(2), wallD: +wallDist(x, z, y, L).toFixed(2), ceil: roof ? +(roof.minY - y).toFixed(2) : null };
  };
  return { cols, colIdx, qc, supportAt, roofAt, capsuleBlocked, wallDist, classify, bldOf, poiOf, topAt, roofish };
};
// @@NAVLIB-END
async (opt) => {
  const walk = !!opt.walk, maxUpper = opt.maxUpper == null ? 24 : opt.maxUpper, maxGround = opt.maxGround == null ? 24 : opt.maxGround, budgetS = opt.budgetS || 30, longTrips = opt.longTrips || 0, seedSalt = opt.seedSalt || 0, traceN = opt.traceN || 0;
  const C = window.__LC__, W = C.W;
  W.paused = true;
  const NH = __NAV_H(W);
  const K = W.SIM;
  let nav = null;
  {
    const el = [...document.querySelectorAll("script[type=module]")].find((x) => /ffg_boot3d/.test(x.src));
    const V = el ? new URL(el.src).search : "";
    const base = new URL("runtime/3d/royale/", location.href.replace(/[^/]*$/, "")).href;
    const m = await import(base + "bots.js" + V);
    nav = m.debugNav();
  }
  const t0 = performance.now();
  // ---------- B: rooms ----------
  const pts = new Map();     // key -> {x,z,s,terr}
  // (Wave 8, lane I2 request) a furnished house's FURNITURE colliders (housegen order: structure boxes + ramps, then furniture - house.cols = [first, structures, all])
  // are no room floor: a table / counter / rack top under the ceiling is furniture, like a crate top (sc.prop). A map without houses: the set is empty (unchanged).
  const furn = new Set();
  for (const H of W.map.houses || []) { if (!H.cols) continue; for (let i = H.cols[0] + H.cols[1]; i < H.cols[0] + H.cols[2]; i++) furn.add(W.map.colliders[i]); }
  // ... and a point on a house storey inside one of its rooms but > 0.5 m outside that room's WALK rects (housegen's walkable floor: the room minus its
  // furniture footprint) is a pocket behind the furniture - no room either (a crate-top rule for the floor the furniture fences off).
  const offWalk = (x, s, z) => {
    for (const H of W.map.houses || []) {
      const mn = H.aabb && H.aabb.min, mx = H.aabb && H.aabb.max;
      if (!mn || x < mn[0] || x > mx[0] || z < mn[2] || z > mx[2]) continue;
      for (const r of H.rooms) {
        const F = H.floors[r.floor]; if (!F || Math.abs(s - F.y) > 0.3) continue;
        if (!r.rects.some((q) => x >= q[0] && x <= q[2] && z >= q[1] && z <= q[3])) continue;
        let d = 1e9; for (const q of r.walk || []) d = Math.min(d, Math.hypot(Math.max(q[0] - x, 0, x - q[2]), Math.max(q[1] - z, 0, z - q[3])));
        return d > 0.5;
      }
    }
    return false;
  };
  let pockets = 0; const pocketEx = [];
  for (const R of NH.roofish) {
    for (let x = Math.ceil(R.minX + 0.4); x <= R.maxX - 0.4; x += 1) for (let z = Math.ceil(R.minZ + 0.4); z <= R.maxZ - 0.4; z += 1) {
      const L = NH.qc(x, z, 1.2);
      const terr = W.map.heightAt(x, z);
      // floor under this ceiling: highest top <= R.minY - 1.0 (terrain counts)
      let s = terr, sc = null;
      for (const c of L) {
        if (c.dead || c === R) continue;
        if (x < c.minX - 0.3 || x > c.maxX + 0.3 || z < c.minZ - 0.3 || z > c.maxZ + 0.3) continue;
        const top = NH.topAt(c, x, z);
        if (top <= R.minY - 1.0 && top > s) { s = top; sc = c; }
      }
      if (sc && (sc.prop || furn.has(sc))) continue;          // standing on a barrel / car / crate top / a house's furniture is not a room floor
      if (R.minY - s > 12 || R.minY - s < 0.3) continue;
      if (furn.size && offWalk(x, s, z)) continue;
      // R must be the LOWEST ceiling over this floor point
      let lower = false;
      for (const c of L) { if (c === R || c.dead) continue; if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue; if (c.minY > s + 0.3 && c.minY < R.minY - 1e-3) { lower = true; break; } }
      if (lower) continue;
      if (s <= terr + 1e-6 && terr < W.map.waterY + 0.3) continue;   // water
      const head = R.minY - s;
      if (NH.capsuleBlocked(x, z, s, L)) continue;   // inside a wall
      if (head < 1.85) { pockets++; if (pocketEx.length < 12) pocketEx.push({ x, z, s: +s.toFixed(2), head: +head.toFixed(2), bld: NH.bldOf(R) }); continue; }
      const key = x + "," + z + "," + Math.round(s * 2);
      if (!pts.has(key)) pts.set(key, { x, z, s, terr, bld: NH.bldOf(R), key });
    }
  }
  // cluster: 4-neighbour lattice, |ds| <= 0.6
  const byXZ = new Map();
  for (const p of pts.values()) { const k = p.x + "," + p.z; if (!byXZ.has(k)) byXZ.set(k, []); byXZ.get(k).push(p); }
  const parent = new Map(); for (const p of pts.values()) parent.set(p, p);
  const find = (p) => { while (parent.get(p) !== p) { parent.set(p, parent.get(parent.get(p))); p = parent.get(p); } return p; };
  for (const p of pts.values()) for (const [dx, dz] of [[1, 0], [0, 1]]) {
    const l = byXZ.get((p.x + dx) + "," + (p.z + dz)); if (!l) continue;
    for (const q of l) if (Math.abs(q.s - p.s) <= 0.6) { const a = find(p), b = find(q); if (a !== b) parent.set(a, b); }
  }
  const groups = new Map();
  for (const p of pts.values()) { const r = find(p); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); }
  const rooms = [];
  for (const g of groups.values()) {
    if (g.length < 3) continue;
    let cx = 0, cz = 0; for (const p of g) { cx += p.x; cz += p.z; } cx /= g.length; cz /= g.length;
    let rep = g[0], bd = 1e9; for (const p of g) { const d = Math.hypot(p.x - cx, p.z - cz); if (d < bd) { bd = d; rep = p; } }
    rooms.push({ x: rep.x, z: rep.z, s: rep.s, agl: +(rep.s - rep.terr).toFixed(2), n: g.length, bld: rep.bld, poi: NH.poiOf(rep.x, rep.z) });
  }
  rooms.sort((a, b) => a.x - b.x || a.z - b.z);
  // outdoor start points around a room: open ground, not roofed, no wall within 0.8 m, dry
  const openPt = (x, z) => {
    if (Math.abs(x) > W.map.half - 15 || Math.abs(z) > W.map.half - 15) return null;
    const terr = W.map.heightAt(x, z);
    if (terr < W.map.waterY + 0.4) return null;
    const sp = NH.supportAt(x, z, terr + 0.2);
    if (sp.s > terr + 0.05) return null;            // on a structure
    if (NH.roofAt(x, z, terr)) return null;
    if (NH.wallDist(x, z, terr) < 0.8) return null;
    return { x, z, y: terr };
  };
  const startsFor = (r, D) => {
    const out = [];
    for (let k = 0; k < 8 && out.length < 4; k++) {
      const ang = k * Math.PI / 2 + (k >= 4 ? Math.PI / 4 : 0);
      const p = openPt(r.x + Math.cos(ang) * D, r.z + Math.sin(ang) * D);
      if (p) out.push(p);
    }
    return out;
  };
  const pathOk = (p, gx, gz, gy) => {
    if (!p || !p.length || p.partial) return false;
    const L = p[p.length - 1];
    return Math.hypot(L.x - gx, L.z - gz) < 1.6 && (gy == null || L.y == null || Math.abs(L.y - gy) < 1.8);
  };
  const plan = { rooms: rooms.length, exitOk: 0, exitNull: 0, inTried: 0, inOk: 0, roomsAllIn: 0, roomsNoIn: 0, byLevel: {} };
  const fails = [];
  for (const r of rooms) {
    const lvl = r.agl > 7.5 ? "top" : r.agl > 1.5 ? "upper" : "ground";
    const bl = plan.byLevel[lvl] || (plan.byLevel[lvl] = { rooms: 0, exitOk: 0, inTried: 0, inOk: 0 });
    bl.rooms++;
    let ex = null; try { ex = nav.findExit(W, r.x, r.s, r.z, 4); } catch (e) { ex = null; }
    r.exit = !!(ex && ex.length);
    if (r.exit) { plan.exitOk++; bl.exitOk++; } else plan.exitNull++;
    const st = startsFor(r, 25);
    r.starts = st;
    let ok = 0;
    for (const s of st) {
      let p = null; try { p = nav.findPath(W, s.x, s.y, s.z, r.x, r.z, r.s); } catch (e) { p = null; }
      if (pathOk(p, r.x, r.z, r.s)) ok++;
    }
    r.inOk = ok; r.inTried = st.length;
    plan.inTried += st.length; plan.inOk += ok; bl.inTried += st.length; bl.inOk += ok;
    if (st.length && ok === st.length) plan.roomsAllIn++;
    if (st.length && ok === 0) plan.roomsNoIn++;
    if ((!r.exit || (st.length && ok < st.length)) && fails.length < 40) fails.push({ x: r.x, z: r.z, s: +r.s.toFixed(2), agl: r.agl, n: r.n, poi: r.poi, bld: r.bld, exit: r.exit, inOk: ok, inTried: st.length });
  }
  // ---------- door survey: lintel-like colliders (a header over a gap between wall pieces) ----------
  // A lintel = non-ramp box 0.6-1.3 m tall, one horizontal side 1.2-3.2 m, the other <= 0.5 m, with its bottom 1.9-3.6 m
  // above the terrain at its centre. Headroom = lintel bottom minus the highest floor under the opening (terrain or a
  // support top) sampled at the door centre and 0.6 m to either side through the wall; < 1.85 m = a standing capsule
  // (h 1.8) cannot pass. Clear width = the gap between the two wall pieces either side (capsule needs > 0.9 m).
  const doors = { n: 0, headroomLow: 0, widthLow: 0, ex: [], widths: {}, headHist: {} };
  for (const c of NH.cols) {
    if (c.dead || c.kind === "ramp") continue;
    const hgt = c.maxY - c.minY, w = c.maxX - c.minX, d = c.maxZ - c.minZ;
    if (hgt < 0.6 || hgt > 1.3) continue;
    const alongX = w >= 1.2 && w <= 3.2 && d <= 0.5, alongZ = d >= 1.2 && d <= 3.2 && w <= 0.5;
    if (!alongX && !alongZ) continue;
    const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
    const tc = W.map.heightAt(cx, cz);
    if (c.minY - tc < 1.9 || c.minY - tc > 3.6) continue;
    // floor under the opening: terrain or a real floor (slab / deck / ramp at least 1 m on both sides) - NOT a window sill
    let floorMax = -1e9;
    for (const off of [-0.6, 0, 0.6]) {
      const px = alongX ? cx : cx + off, pz = alongX ? cz + off : cz;
      let fs = W.map.heightAt(px, pz);
      for (const o of NH.qc(px, pz, 0.8)) {
        if (o === c || o.dead) continue;
        if (o.kind !== "ramp" && (o.maxX - o.minX < 1.0 || o.maxZ - o.minZ < 1.0)) continue;
        if (px < o.minX - 0.3 || px > o.maxX + 0.3 || pz < o.minZ - 0.3 || pz > o.maxZ + 0.3) continue;
        const top = NH.topAt(o, px, pz);
        if (top <= c.minY - 0.45 && top > fs) fs = top;
      }
      floorMax = Math.max(floorMax, fs);
    }
    // waist band at the floor under the opening must be free across the opening centre (a door, not a window)
    const L = NH.qc(cx, cz, 2.5);
    let waistBlocked = false;
    for (const o of L) {
      if (o === c || o.dead || o.kind === "ramp") continue;
      if (cx < o.minX - 0.05 || cx > o.maxX + 0.05 || cz < o.minZ - 0.05 || cz > o.maxZ + 0.05) continue;
      if (o.maxY > floorMax + 0.6 && o.minY < floorMax + 1.2) { waistBlocked = true; break; }
    }
    if (waistBlocked) continue;
    // clear width: walk outward from the centre along the lintel axis until a wall blocks the waist band
    let wl = 0, wr = 0;
    for (const sgn of [-1, 1]) {
      let s = 0;
      for (; s < 2.5; s += 0.05) {
        const px = alongX ? cx + sgn * s : cx, pz = alongX ? cz : cz + sgn * s;
        let hit = false;
        for (const o of L) {
          if (o === c || o.dead || o.kind === "ramp") continue;
          if (px < o.minX || px > o.maxX || pz < o.minZ || pz > o.maxZ) continue;
          if (o.maxY > floorMax + 0.6 && o.minY < floorMax + 1.6) { hit = true; break; }
        }
        if (hit) break;
      }
      if (sgn < 0) wl = s; else wr = s;
    }
    const width = +(wl + wr).toFixed(2);
    const head = +(c.minY - floorMax).toFixed(2);
    doors.n++;
    const wk = width.toFixed(1); doors.widths[wk] = (doors.widths[wk] || 0) + 1;
    const hk = (Math.floor(head * 4) / 4).toFixed(2); doors.headHist[hk] = (doors.headHist[hk] || 0) + 1;
    const lowH = head < 1.85, lowW = width < 0.95;
    if (lowH) doors.headroomLow++;
    if (lowW) doors.widthLow++;
    if ((lowH || lowW) && doors.ex.length < 25) doors.ex.push({ x: +cx.toFixed(1), z: +cz.toFixed(1), head, width, slope: +(floorMax - tc).toFixed(2), poi: NH.poiOf(cx, cz) });
  }
  const out = { map: W.mapId, seed: W.seed, mode: W.mode, nColliders: NH.cols.length, nRoofish: NH.roofish.length, pockets, pocketEx, plan, planFails: fails,
    roomsByLevel: { ground: rooms.filter((r) => r.agl <= 1.5).length, upper: rooms.filter((r) => r.agl > 1.5 && r.agl <= 7.5).length, top: rooms.filter((r) => r.agl > 7.5).length },
    doors, planMs: +(performance.now() - t0).toFixed(0) };
  if (!walk) return out;
  // ---------- C: walk tests ----------
  const brains = C.brains();
  const T = brains.find((b) => b.actor.alive);
  if (!T) { out.walkError = "no live bot"; return out; }
  for (const a of W.actors) if (a !== T.actor && a !== W.player) a.alive = false;
  const P = W.player;
  const keepAlive = () => {
    if (P && P.alive) { P.hp = 100; P.shield = 100; }
    T.actor.hp = 100; T.actor.shield = 100; T.actor.lastDamageT = -999; T.actor.lastAttacker = null;
  };
  // park the player far away on open ground
  if (P) { const corner = openPt(W.map.half - 40, W.map.half - 40) || openPt(-(W.map.half - 40), W.map.half - 40) || openPt(W.map.half - 40, -(W.map.half - 40));
    if (corner) { P.pos.set(corner.x, corner.y, corner.z); P.vel.set(0, 0, 0); P.gliding = false; P.onGround = true; } }
  const reset = (from, to) => {
    const a = T.actor, bb = T.bb;
    a.pos.set(from.x, from.y, from.z); a.vel.set(0, 0, 0); a.onGround = true; a.gliding = false; a.swimming = false;
    a.healing = false; a.emoting = null; a.mantleT = null;
    bb.path = null; bb.pathGoal = null; bb.progGoal = null; bb.progBest = null; bb.progT = 0; bb.stuckT = 0; bb.anchor = null;
    bb.wallSide = 0; bb.detourDir = 0; bb.nextPathT = 0; bb.nextJumpT = 0; bb.lootId = null; bb.chestId = null; bb.chestT = 0;
    bb.target = null; bb.badLoot = {}; bb.supply = null; bb.heard = null; bb.coverReflexUntil = 0; bb.threatFor = null;
    bb.breaks = 0;
    T.state = "LOOT"; T.nextThink = 1e12;
    bb.moveTo = { x: to.x, z: to.z, y: to.y };
    keepAlive();
  };
  const traces = [];
  const trial = (from, to, budget, tag, trace) => {
    reset(from, to);
    const a = T.actor, bb = T.bb;
    let reached = null, minD = 1e9, pathReq = 0, lastPath = null;
    const tr = trace ? [] : null;
    const prevHook = W._tickHook;
    W._tickHook = () => {
      keepAlive();
      if (bb.path !== lastPath) { if (bb.path) pathReq++; lastPath = bb.path; }
      const d = Math.hypot(a.pos.x - to.x, a.pos.z - to.z);
      if (d < minD) minD = d;
      if (reached == null && d < 2.0 && Math.abs(a.pos.y - to.y) < 1.3) reached = W.t;
      // the bot must keep heading for THIS goal: actLoot clears moveTo on arrival and then re-picks LOOT (lootId set).
      // The bot's OWN recoveries (breakOut / the hard-stuck findExit) also rewrite moveTo to an exit point - those are
      // left alone (lootId null), and the goal is restored only once the bot has cleared that detour.
      if (reached == null && (!bb.moveTo || bb.lootId)) { bb.moveTo = { x: to.x, z: to.z, y: to.y }; bb.lootId = null; bb.lootType = null; }
      T.state = "LOOT"; T.nextThink = 1e12;
    };
    const tStart = W.t;
    try {
      for (let el = 0; el < budget && reached == null; el += 0.5) {
        C.fastForward(0.5);
        if (tr) { const c2 = NH.classify(a.pos.x, a.pos.y, a.pos.z, !!a.swimming); const p0 = bb.path && bb.path[0];
          tr.push([+(W.t - tStart).toFixed(1), +a.pos.x.toFixed(1), +a.pos.y.toFixed(1), +a.pos.z.toFixed(1), c2.kind, c2.wallD,
            bb.path ? bb.path.length + (bb.path.partial ? "p" : "") : 0, p0 ? [+p0.x.toFixed(1), p0.y != null ? +p0.y.toFixed(1) : null, +p0.z.toFixed(1)] : null,
            bb.moveTo ? [+bb.moveTo.x.toFixed(1), bb.moveTo.y != null ? +bb.moveTo.y.toFixed(1) : null, +bb.moveTo.z.toFixed(1)] : null,
            +(bb.stuckT || 0).toFixed(2), bb.wallSide || 0, a.input.mz, bb.breaks || 0]); }
        if (W.match && W.match.over) break;
      }
    } finally { W._tickHook = prevHook; }
    const cl = NH.classify(a.pos.x, a.pos.y, a.pos.z, !!a.swimming);
    if (tr) traces.push({ tag, from, to, trace: tr });
    return { tag, ok: reached != null, t: reached != null ? +(reached - tStart).toFixed(1) : null, minD: +minD.toFixed(1),
      end: { x: +a.pos.x.toFixed(1), y: +a.pos.y.toFixed(1), z: +a.pos.z.toFixed(1), where: cl.kind + (cl.door ? "/door" : "") },
      breaks: bb.breaks || 0, pathReq, over: !!(W.match && W.match.over) };
  };
  // sample rooms deterministically: every k-th room, all upper rooms first
  const rng = K.mulberry32(0x5eed ^ (seedSalt || 0) ^ W.seed);
  const withStart = rooms.filter((r) => r.starts && r.starts.length);
  const upper = withStart.filter((r) => r.agl > 1.5), ground = withStart.filter((r) => r.agl <= 1.5);
  const pick = (l, n) => { const c = l.slice(); const o = []; while (c.length && o.length < n) o.push(c.splice(Math.floor(rng() * c.length), 1)[0]); return o; };
  const sel = pick(upper, maxUpper).concat(pick(ground, maxGround));
  const walkRes = [];
  const wt0 = performance.now();
  for (const r of sel) {
    const s = r.starts[0];
    const room = { x: r.x, z: r.z, y: r.s };
    const doTrace = (traceN || 0) > 0 && r.agl > 1.5 && traces.length < (traceN || 0) * 2;
    const inn = trial(s, room, budgetS, "in", doTrace);
    const outT = trial(room, s, budgetS, "out", doTrace);
    walkRes.push({ room: { x: r.x, z: r.z, s: +r.s.toFixed(2), agl: r.agl, n: r.n, poi: r.poi, bld: r.bld, planIn: r.inOk + "/" + r.inTried, planExit: r.exit },
      in: inn, out: outT });
    if (W.match && W.match.over) break;
  }
  // long trips: street -> street, 120-180 m, starting next to buildings (the town case)
  const longRes = [];
  for (let i = 0; i < (longTrips || 0); i++) {
    const r = withStart[Math.floor(rng() * withStart.length)]; if (!r) break;
    const s = r.starts[Math.floor(rng() * r.starts.length)];
    let g = null;
    for (let k = 0; k < 20 && !g; k++) { const D = 120 + rng() * 60, ang = rng() * Math.PI * 2; g = openPt(s.x + Math.cos(ang) * D, s.z + Math.sin(ang) * D); }
    if (!g) continue;
    const res = trial(s, g, Math.max(budgetS, 75), "long");
    res.D = +Math.hypot(g.x - s.x, g.z - s.z).toFixed(0);
    longRes.push(res);
    if (W.match && W.match.over) break;
  }
  const agg = (k) => { const L = walkRes.map((w) => w[k]); return { n: L.length, ok: L.filter((x) => x.ok).length, tMed: (() => { const t = L.filter((x) => x.ok).map((x) => x.t).sort((a, b) => a - b); return t.length ? t[Math.floor(t.length / 2)] : null; })() }; };
  const aggLvl = (k, up) => { const L = walkRes.filter((w) => (w.room.agl > 1.5) === up).map((w) => w[k]); return { n: L.length, ok: L.filter((x) => x.ok).length }; };
  const aggTop = (k) => { const L = walkRes.filter((w) => w.room.agl > 7.5).map((w) => w[k]); return { n: L.length, ok: L.filter((x) => x.ok).length }; };
  out.walk = { testBot: T.actor.id, budgetS, inbound: agg("in"), outbound: agg("out"), upperIn: aggLvl("in", true), upperOut: aggLvl("out", true), topIn: aggTop("in"), topOut: aggTop("out"),
    groundIn: aggLvl("in", false), groundOut: aggLvl("out", false),
    long: { n: longRes.length, ok: longRes.filter((x) => x.ok).length, res: longRes },
    fails: walkRes.filter((w) => !w.in.ok || !w.out.ok).slice(0, 30), all: walkRes.map((w) => [w.room.agl, w.room.poi, w.in.ok ? w.in.t : "X", w.out.ok ? w.out.t : "X"]),
    wallS: +((performance.now() - wt0) / 1000).toFixed(1), traces };
  return out;
}
