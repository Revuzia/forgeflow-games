// In-page probe: (1) A* window degeneracy, measured with a VERBATIM copy of
// bots.js findPath/cellBlocked/obstacleAt (lines 651-743) run on real map data,
// vs a variant whose window is centred on the START; (2) live bb.path quality
// sampled during a real match; (3) loot census from populate()'s own seeded rng.
// Read-only: never writes game state (W.paused aside, which fastForward ignores).
async ([seed, mapId, liveSeconds, stepS]) => {
  const C = window.__LC__, W = C.W;
  await C.startMatch({ mapId, mode: "standard", seed });
  W.paused = true;
  const K = W.SIM;
  // ── verbatim copies (bots.js:651-659, 674-679, 680-743) ──
  function obstacleAt(W, x, z, y) {
    const cols = W.map.queryColliders(x, z, 0.6);
    for (const c of cols) {
      if (c.kind === "ramp") continue;
      if (x < c.minX - 0.3 || x > c.maxX + 0.3 || z < c.minZ - 0.3 || z > c.maxZ + 0.3) continue;
      if (c.minY < y + 2.0 && c.maxY > y + 0.55) return true;
    }
    return false;
  }
  const CELL = 1.5, GRID_R = 21;
  function cellBlocked(W, x, z) {
    const g = W.map.heightAt(x, z);
    if (g < W.map.waterY + 0.3) return true;
    return obstacleAt(W, x, z, g);
  }
  function findPathGen(W, sx, sz, tx, tz, centreOnStart, gridR) {
    const GR = gridR || GRID_R;
    const cx = centreOnStart ? sx : (sx + tx) / 2, cz = centreOnStart ? sz : (sz + tz) / 2;
    const R = centreOnStart ? GR : Math.min(GR, Math.ceil((Math.max(Math.abs(tx - sx), Math.abs(tz - sz)) / 2 + CELL * 4) / CELL));
    const N = R * 2 + 1;
    const idx = (ix, iz) => iz * N + ix;
    const toWx = (ix) => cx + (ix - R) * CELL, toWz = (iz) => cz + (iz - R) * CELL;
    const blocked = new Uint8Array(N * N);
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) blocked[idx(ix, iz)] = cellBlocked(W, toWx(ix), toWz(iz)) ? 1 : 0;
    const cl = (v) => Math.max(0, Math.min(N - 1, v));
    const S = { x: cl(Math.round((sx - cx) / CELL) + R), z: cl(Math.round((sz - cz) / CELL) + R) };
    const T = { x: cl(Math.round((tx - cx) / CELL) + R), z: cl(Math.round((tz - cz) / CELL) + R) };
    blocked[idx(S.x, S.z)] = 0;
    if (blocked[idx(T.x, T.z)]) {
      let done = false;
      for (let r = 1; r < 6 && !done; r++) for (let dz = -r; dz <= r && !done; dz++) for (let dx = -r; dx <= r && !done; dx++) {
        const nx = T.x + dx, nz = T.z + dz;
        if (nx >= 0 && nz >= 0 && nx < N && nz < N && !blocked[idx(nx, nz)]) { T.x = nx; T.z = nz; done = true; }
      }
      if (!done) return { path: null, why: "goalBlocked" };
    }
    const open = [[0, S.x, S.z]];
    const gS = new Float32Array(N * N).fill(Infinity);
    const from = new Int32Array(N * N).fill(-1);
    gS[idx(S.x, S.z)] = 0;
    let found = false, guard = 0;
    while (open.length && guard++ < 4000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const cur = open.splice(bi, 1)[0], x = cur[1], z = cur[2];
      if (x === T.x && z === T.z) { found = true; break; }
      const g0 = gS[idx(x, z)];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N || blocked[idx(nx, nz)]) continue;
        if (dx && dz && (blocked[idx(x + dx, z)] || blocked[idx(x, z + dz)])) continue;
        const ng = g0 + Math.hypot(dx, dz);
        if (ng < gS[idx(nx, nz)]) {
          gS[idx(nx, nz)] = ng;
          from[idx(nx, nz)] = idx(x, z);
          open.push([ng + Math.hypot(nx - T.x, nz - T.z), nx, nz]);
        }
      }
    }
    if (!found) return { path: null, why: guard >= 4000 ? "guard" : "noRoute" };
    const path = [];
    let cur = idx(T.x, T.z);
    while (cur >= 0 && cur !== idx(S.x, S.z)) { path.push({ x: toWx(cur % N), z: toWz(Math.floor(cur / N)) }); cur = from[cur]; }
    path.reverse();
    const pulled = [];
    let anchor = { x: sx, z: sz };
    for (let i = 0; i < path.length; i++) {
      const nxt = path[i + 1];
      if (!nxt) { pulled.push(path[i]); break; }
      const steps = Math.ceil(Math.hypot(nxt.x - anchor.x, nxt.z - anchor.z) / CELL);
      let clear = true;
      for (let s = 1; s <= steps; s++) {
        if (cellBlocked(W, anchor.x + (nxt.x - anchor.x) * s / steps, anchor.z + (nxt.z - anchor.z) * s / steps)) { clear = false; break; }
      }
      if (!clear) { pulled.push(path[i]); anchor = path[i]; }
    }
    return { path: pulled.length ? pulled : null, why: pulled.length ? "ok" : "empty", sClamped: Math.abs(sx - cx) > R * CELL || Math.abs(sz - cz) > R * CELL, tClamped: Math.abs(tx - cx) > R * CELL || Math.abs(tz - cz) > R * CELL };
  }
  const segBlocked = (ax, az, bx, bz) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.75));
    for (let i = 1; i < n; i++) if (cellBlocked(W, ax + (bx - ax) * i / n, az + (bz - az) * i / n)) return true;
    return false;
  };
  const judge = (res, sx, sz, tx, tz) => {
    if (!res.path) return { useful: false, reason: res.why, firstLegClear: false, endsNearGoal: false };
    const p = res.path;
    const firstLegClear = !segBlocked(sx, sz, p[0].x, p[0].z);
    let legsClear = firstLegClear;
    for (let i = 0; legsClear && i + 1 < p.length; i++) legsClear = !segBlocked(p[i].x, p[i].z, p[i + 1].x, p[i + 1].z);
    const last = p[p.length - 1];
    const endD = Math.hypot(last.x - tx, last.z - tz);
    // a path that stops short is still useful IF its first leg is clear and it made real progress
    const endsNearGoal = endD < 9;   // blocked-goal snap searches up to 5 cells = 7.5 m
    return { useful: legsClear && endsNearGoal, firstLegClear, legsClear, endsNearGoal, endD: +endD.toFixed(1), firstLegM: +Math.hypot(p[0].x - sx, p[0].z - sz).toFixed(1), sClamped: !!res.sClamped, tClamped: !!res.tClamped };
  };
  // ── (1) controlled A* experiment ──
  const rng = K.mulberry32(0xa57a4 ^ seed);
  const DISTS = [15, 30, 45, 60, 75, 90, 120, 180];
  const PAIRS = 30;
  const pois = W.map.pois;
  const exp = {};
  const tExp0 = performance.now();
  for (const D of DISTS) {
    const row = { D, n: 0, midUseful: 0, midFirstClear: 0, midEnds: 0, startUseful: 0, startEnds: 0, startFirstClear: 0, midMs: 0, startMs: 0, samples: [] };
    let tries = 0;
    while (row.n < PAIRS && tries++ < 4000) {
      const p = pois[Math.floor(rng() * pois.length)];
      const sx = p.x + (rng() - 0.5) * p.r * 1.6, sz = p.z + (rng() - 0.5) * p.r * 1.6;
      if (Math.abs(sx) > W.map.half - 10 || Math.abs(sz) > W.map.half - 10 || cellBlocked(W, sx, sz)) continue;
      const ang = rng() * Math.PI * 2;
      const tx = sx + Math.cos(ang) * D, tz = sz + Math.sin(ang) * D;
      if (Math.abs(tx) > W.map.half - 10 || Math.abs(tz) > W.map.half - 10 || cellBlocked(W, tx, tz)) continue;
      // only pairs where the straight line is blocked WITHIN the first 12 m — the
      // situation wallAhead() (3.2 m probe) actually hands to requestPath
      const ex = sx + Math.cos(ang) * Math.min(12, D), ez = sz + Math.sin(ang) * Math.min(12, D);
      if (!segBlocked(sx, sz, ex, ez)) continue;
      row.n++;
      let t0 = performance.now();
      const a = judge(findPathGen(W, sx, sz, tx, tz, false), sx, sz, tx, tz);
      row.midMs += performance.now() - t0;
      t0 = performance.now();
      // start-centred variant: goal clamped into the window = an intermediate
      // waypoint TOWARD the goal (what a fixed version would hand the bot)
      const b = findPathGen(W, sx, sz, tx, tz, true);
      row.startMs += performance.now() - t0;
      const bj = judge(b, sx, sz, tx, tz);
      // for the start-centred variant "useful" = legs clear and it ends at goal OR
      // at the window edge having made >= 20 m of progress toward the goal
      let bUseful = bj.legsClear && bj.endsNearGoal;
      if (!bUseful && bj.legsClear && b.path) {
        const last = b.path[b.path.length - 1];
        bUseful = Math.hypot(tx - sx, tz - sz) - Math.hypot(tx - last.x, tz - last.z) >= 20;
      }
      if (a.useful) row.midUseful++;
      if (a.firstLegClear) row.midFirstClear++;
      if (a.endsNearGoal) row.midEnds++;
      if (bUseful) row.startUseful++;
      if (bj.endsNearGoal) row.startEnds++;
      if (bj.firstLegClear) row.startFirstClear++;
      if (row.samples.length < 3) row.samples.push({ sx: +sx.toFixed(1), sz: +sz.toFixed(1), tx: +tx.toFixed(1), tz: +tz.toFixed(1), mid: a, start: bj });
    }
    row.midMs = +(row.midMs / Math.max(1, row.n)).toFixed(2);
    row.startMs = +(row.startMs / Math.max(1, row.n)).toFixed(2);
    exp[D] = row;
  }
  const expWall = +((performance.now() - tExp0) / 1000).toFixed(1);
  // ── (3) loot census (replays populate()'s rng: loot.js:163-178) ──
  const modeK = K.MODE.standard;
  const lr = K.mulberry32(W.seed ^ 0x100f);
  const census = { floorWeapons: {}, floorWeaponRarity: [0, 0, 0, 0, 0], ammo: {}, cons: {}, chests: 0, floorItems: 0, lootPoints: W.map.lootPoints.length, chestWeapons: {} };
  let ci = 0;
  for (const lp of W.map.lootPoints) {
    if (lp.kind === "chest") { census.chests++; continue; }
    if (lr() < 0.55 * Math.min(1.6, modeK.lootMult)) {
      const it = K.rollFloorItem(lr); census.floorItems++;
      if (it.kind === "weapon") { census.floorWeapons[it.id] = (census.floorWeapons[it.id] || 0) + 1; census.floorWeaponRarity[it.rarity]++; }
      else if (it.kind === "ammo") census.ammo[it.id] = (census.ammo[it.id] || 0) + 1;
      else census.cons[it.id] = (census.cons[it.id] || 0) + 1;
    }
  }
  // ── (2) live path sampling in a real match ──
  const brains = C.brains();
  let pathSamples = 0, pathFirstBlocked = 0, pathFar = 0, pathFarFirstBlocked = 0, wallGrindWithPath = 0, movingSamples = 0;
  const goalDs = [];
  for (let el = 0; el < liveSeconds; el += 0.5) {
    C.fastForward(0.5, stepS);
    for (const b of brains) {
      const a = b.actor;
      if (!a.alive || a.gliding) continue;
      const bb = b.bb;
      if (!["LOOT", "ROTATE", "PUSH", "WANDER", "HUNT", "FLEE", "SUPPLY"].includes(b.state)) continue;
      movingSamples++;
      if (!bb.path || !bb.path.length || !bb.pathGoal) continue;
      pathSamples++;
      const gD = Math.hypot(bb.pathGoal.x - a.pos.x, bb.pathGoal.z - a.pos.z);
      goalDs.push(Math.round(gD));
      const fb = segBlocked(a.pos.x, a.pos.z, bb.path[0].x, bb.path[0].z);
      if (fb) pathFirstBlocked++;
      if (gD > 63) { pathFar++; if (fb) pathFarFirstBlocked++; }
      const yaw = a.input.yaw;
      if (obstacleAt(W, a.pos.x - Math.sin(yaw) * 3.2, a.pos.z - Math.cos(yaw) * 3.2, a.pos.y)) wallGrindWithPath++;
    }
    if (W.match.over) break;
  }
  goalDs.sort((x, y) => x - y);
  const q = (f) => goalDs.length ? goalDs[Math.floor(f * (goalDs.length - 1))] : null;
  return { seed, map: W.mapId, expWall, exp, census,
    live: { simT: +W.t.toFixed(1), movingSamples, pathSamples, pathFirstBlocked, pathFar, pathFarFirstBlocked, wallGrindWithPath,
      goalD: { p10: q(0.1), p50: q(0.5), p90: q(0.9) } } };
}
