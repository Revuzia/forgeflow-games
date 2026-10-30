() => {
  // probe_world.js - the in-page half of worldlive.py (lane F1, 2026-10-13). Promoted from the Wave-5 lanes' scratch probes:
  //   lane 5A  chestgap_all.py      -> chests()   every chest rests on the surface it is authored on
  //   lane 5A  ramptest2.py         -> ramps()    EVERY ramp walked up and down with the real mover; towers() every ranger tower foot -> deck
  //   lane L2  stairs_all.py        -> rampsFine() the FINE scan (2026-10-13): walk AND sprint, every start phase, a lifted descent is not clean
  //   lane 5C  live5c.js 'ramp'     -> sides()    walking into a ramp's side from outside is blocked (the plank is solid at body height)
  //   lane 5C  live5c.js 'fall'     -> fallsFine() 0.2 m-spaced drop heights onto thin slabs (>= 800 drops per map)
  //   lane 5C  live5c.js 'aim'      -> aim()      the REAL fire() path: where the shot lands vs where the crosshair ray meets a near wall
  // (5C's all-direction hide area is collisioncheck's ramps-hide: the same definition, not duplicated here.)
  // Drives the game's REAL stepActor (C.fastForward ticks) and the game's own segment tests. READ-ONLY on the map; the player (PRACTICE: the
  // only human, five range actors) is teleported and stepped. Installed once per page as window.__LCWORLD__.
  const C = window.__LC__, W = C.W, p = W.player;
  const S = (window.FFG && window.FFG.sim && window.FFG.sim.Royale) || W.SIM;
  const R = S.PLAYERK.radius, H = S.PLAYERK.height, SU = 0.55;
  const M = () => W.map;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const pct = (a, q) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const k = (s.length - 1) * q; const lo = Math.floor(k), hi = Math.min(lo + 1, s.length - 1); return r3(s[lo] + (s[hi] - s[lo]) * (k - lo)); };
  const rampList = () => M().colliders.filter((q) => q.kind === 'ramp' && !q.dead);
  const rampTop = (c, x, z) => {
    let f;
    if (c.dir === 0) f = (x - c.minX) / Math.max(0.01, c.maxX - c.minX); else if (c.dir === 1) f = (c.maxX - x) / Math.max(0.01, c.maxX - c.minX);
    else if (c.dir === 2) f = (z - c.minZ) / Math.max(0.01, c.maxZ - c.minZ); else f = (c.maxZ - z) / Math.max(0.01, c.maxZ - c.minZ);
    return c.minY + (c.maxY - c.minY) * Math.min(1, Math.max(0, f));
  };
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function setPlayer(x, y, z) {
    p.alive = true; p.hp = 100; p.shield = 100;
    p.pos.set(x, y, z); p.vel.set(0, 0, 0);
    if (p.obj) p.obj.position.copy(p.pos); if (p._pp) p._pp.copy(p.pos);
    p.onGround = false; p.gliding = false; p.swimming = false; p.mantleT = null; p.emoting = null; p.healing = null; p._portalBoost = false;
    const inp = p.input; inp.mx = 0; inp.mz = 0; inp.jump = false; inp.sprint = false; inp.ads = false; inp.crouch = false; inp.fire = false; inp.pitch = 0;
  }
  // the highest top <= yRef + SU under (x,z), optionally excluding one collider (player.js supportIn, independent re-implementation)
  function support(x, z, yRef, excl, below) {
    let s = M().heightAt(x, z);
    for (const c of M().queryColliders(x, z, 1.0, [])) {
      if (c === excl || c.dead) continue;
      if (x < c.minX - 0.3 || x > c.maxX + 0.3 || z < c.minZ - 0.3 || z > c.maxZ + 0.3) continue;
      const top = c.kind === 'ramp' ? rampTop(c, x, z) : c.maxY;
      if (below != null ? top <= below : top <= yRef + SU) { if (top > s) s = top; }
    }
    return s;
  }

  // ---------------------------------------------------------------- chests: base rests on the surface it is authored on
  function chests() {
    const m = M(), H0 = m.heightAt, rows = [];
    for (const ch of W.debugChests()) {
      const x = ch.pos.x, z = ch.pos.z, y = ch.pos.y;
      let f = H0(x, z), kind = 'terrain';
      for (const q of m.queryColliders(x, z, 0.05, [])) {
        if (x < q.minX || x > q.maxX || z < q.minZ || z > q.maxZ) continue;
        const top = q.kind === 'ramp' ? rampTop(q, x, z) : q.maxY;
        if (top <= y + 0.3 && top > f) { f = top; kind = q.kind + (q.prop ? ':' + q.prop : ''); }
      }
      rows.push({ id: ch.id, x: r3(x), y: r3(y), z: r3(z), gap: r3(y - f), support: kind });
    }
    const gaps = rows.map((r) => r.gap);
    const off = rows.filter((r) => Math.abs(r.gap) > 0.10);
    return { n: rows.length, gapP50: pct(gaps, 0.5), gapMin: pct(gaps, 0), gapMax: pct(gaps, 1), off: off.length, offExamples: off.slice(0, 6) };
  }

  // ---------------------------------------------------------------- ramps: every ramp up and down, the real controller
  function walkRamp(c, mode, runup) {
    const D = DIRS[c.dir], alongX = c.dir < 2;
    const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
    const lowA = alongX ? (c.dir === 0 ? c.minX : c.maxX) : (c.dir === 2 ? c.minZ : c.maxZ);       // low-edge coordinate along the run axis
    const topA = alongX ? (c.dir === 0 ? c.maxX : c.minX) : (c.dir === 2 ? c.maxZ : c.minZ);
    const run = Math.abs(topA - lowA);
    // the ground the ramp starts from: terrain or a slab within reach, 0.3 m before the low edge (the ramp itself excluded). A ramp whose foot
    // is sunk into a hillside ends on that higher ground: "reached the foot" means reaching IT, not the ramp's buried low edge.
    const footX = alongX ? lowA - D[0] * 0.3 : cx, footZ = alongX ? cz : lowA - D[1] * 0.3;
    const foot = support(footX, footZ, c.minY + 0.3, c);
    let sx, sz, yaw;
    if (mode === 'up') { sx = alongX ? lowA - D[0] * runup : cx; sz = alongX ? cz : lowA - D[1] * runup; yaw = Math.atan2(-D[0], -D[1]); }
    else { sx = alongX ? topA - D[0] * 0.5 : cx; sz = alongX ? cz : topA - D[1] * 0.5; yaw = Math.atan2(D[0], D[1]); }
    // start height: the highest support at the start point (the ground or a box top within reach), then let the mover settle
    let y0 = M().heightAt(sx, sz);
    for (const o of M().queryColliders(sx, sz, 0.3, [])) {
      if (o.kind === 'ramp') { if (mode === 'down') { const f = Math.min(1, Math.max(0, Math.abs(topA - (alongX ? sx : sz)) / Math.max(0.01, run))); y0 = Math.max(y0, c.maxY - (c.maxY - c.minY) * f); } continue; }
      if (sx >= o.minX && sx <= o.maxX && sz >= o.minZ && sz <= o.maxZ && o.maxY <= (mode === 'up' ? c.minY + 0.6 : c.maxY + 0.6) && o.maxY > y0) y0 = o.maxY;
    }
    setPlayer(sx, y0 + 0.1, sz);
    p.input.yaw = yaw; p.input.pitch = 0;
    C.fastForward(0.25, 1 / 60);
    p.input.mz = 1;
    let best = p.pos.y, bestLow = p.pos.y, still = 0, t = 0, last = [p.pos.x, p.pos.z];
    for (; t < 14; t += 0.1) {
      p.hp = 100; p.shield = 100;
      C.fastForward(0.1, 1 / 60);
      if (p.pos.y > best) best = p.pos.y;
      if (p.pos.y < bestLow) bestLow = p.pos.y;
      const moved = Math.hypot(p.pos.x - last[0], p.pos.z - last[1]); last = [p.pos.x, p.pos.z];
      still = moved < 0.02 ? still + 0.1 : 0;
      if (mode === 'up' && p.pos.y >= c.maxY - 0.35) break;
      if (mode === 'down' && p.pos.y <= c.minY + 0.5) break;
      if (still > 1.5) break;
    }
    p.input.mz = 0;
    // (a foot under the water ends at the surface: a swimmer floats ~0.6 m under it)
    const ok = mode === 'up' ? best >= c.maxY - 0.6 : bestLow <= Math.max(c.minY, foot, M().waterY - 0.6) + 0.7;
    return { ok, mode, runup, foot: r3(foot), dir: c.dir, minY: r3(c.minY), maxY: r3(c.maxY), run: r3(run), at: [r3(cx), r3(cz)], startY: r3(y0), best: r3(best), bestLow: r3(bestLow), endY: r3(p.pos.y), t: r3(t), stuck: still > 1.5 };
  }
  function ramps(opt) {
    const rs = rampList(), n = Math.min(rs.length, (opt && opt.max) || 1e9);
    const up = [], down = []; let skippedUp = 0; const skippedEx = [];
    for (let i = 0; i < n; i++) {
      let r = null;
      // a ramp whose foot is not standable ground (wading out of the sea, or its low edge more than 1.2 m above any ground within reach) is not
      // climbed from the ground: skipped and counted (collisioncheck's ramps-climb makes the same call)
      const c = rs[i], D = DIRS[c.dir], alongX = c.dir < 2, lowA = alongX ? (c.dir === 0 ? c.minX : c.maxX) : (c.dir === 2 ? c.minZ : c.maxZ);
      const g0 = support(alongX ? lowA - D[0] * 1.3 : (c.minX + c.maxX) / 2, alongX ? (c.minZ + c.maxZ) / 2 : lowA - D[1] * 1.3, c.minY + 0.3, c);
      if (g0 < M().waterY - 0.1 || c.minY - g0 > 1.2) { skippedUp++; if (skippedEx.length < 4) skippedEx.push({ at: [r3((c.minX + c.maxX) / 2), r3((c.minZ + c.maxZ) / 2)], minY: r3(c.minY), footGround: r3(g0), water: r3(M().waterY) }); }
      else {
        for (const ru of [1.3, 0.8, 0.45, 0.15]) { r = walkRamp(c, 'up', ru); if (r.ok) break; }      // a ramp the mover cannot climb from ANY run-up
        r.i = i; up.push(r);
      }
      r = null;
      for (const ru of [0.5, 0.9]) { r = walkRamp(rs[i], 'down', ru); if (r.ok) break; }
      r.i = i; down.push(r);
    }
    p.input.mz = 0;
    const fail = (a) => a.filter((r) => !r.ok);
    return { n, upN: up.length, skippedUp, skippedEx, upOk: up.filter((r) => r.ok).length, downOk: down.filter((r) => r.ok).length, upFailed: fail(up).slice(0, 8), downFailed: fail(down).slice(0, 8) };
  }

  // ---------------------------------------------------------------- ramps, fine scan (lane L2's stairs_all.py): the climb and the descent as a player does them
  // Differences from ramps() above, each one found by a defect the coarse scan passed (ashgrid seed 1234 / 31337, isla_viva seed 1234 / 31337 on the Wave-5 release):
  //   * walk AND sprint (a sprinting actor covers 1.6x the ground per tick and reaches the lip of a stair a different way);
  //   * 'up' passes when ANY of the run-ups (1.3, 0.8, 0.45, 0.15 m before the low edge) climbs: a run-up longer than the room starts outside its wall;
  //     'down' must pass from EVERY start phase (0.5, 0.9, 1.6 m from the top edge): a hop can begin anywhere in its arc, and a stair that only
  //     works from one phase drops the player or a bot on it;
  //   * a descent that was LIFTED (an auto-mantle onto the floor above, or the feet ended above the start height) is not a clean walk down,
  //     even if the actor got down later (the ashgrid stair at (221.75, 224) mantled the player onto the upper floor).
  function walkRampFine(c, mode, off, sprint) {
    const D = DIRS[c.dir], alongX = c.dir < 2;
    const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
    const lowA = alongX ? (c.dir === 0 ? c.minX : c.maxX) : (c.dir === 2 ? c.minZ : c.maxZ);
    const topA = alongX ? (c.dir === 0 ? c.maxX : c.minX) : (c.dir === 2 ? c.maxZ : c.minZ);
    const run = Math.abs(topA - lowA);
    const footX = alongX ? lowA - D[0] * 0.3 : cx, footZ = alongX ? cz : lowA - D[1] * 0.3;
    const foot = support(footX, footZ, c.minY + 0.3, c);
    let sx, sz, yaw;
    if (mode === 'up') { sx = alongX ? lowA - D[0] * off : cx; sz = alongX ? cz : lowA - D[1] * off; yaw = Math.atan2(-D[0], -D[1]); }
    else { sx = alongX ? topA - D[0] * off : cx; sz = alongX ? cz : topA - D[1] * off; yaw = Math.atan2(D[0], D[1]); }
    let y0 = M().heightAt(sx, sz);
    for (const o of M().queryColliders(sx, sz, 0.3, [])) {
      if (o.kind === 'ramp') { if (mode === 'down') { const f = Math.min(1, Math.max(0, Math.abs(topA - (alongX ? sx : sz)) / Math.max(0.01, run))); y0 = Math.max(y0, c.maxY - (c.maxY - c.minY) * f); } continue; }
      if (sx >= o.minX && sx <= o.maxX && sz >= o.minZ && sz <= o.maxZ && o.maxY <= (mode === 'up' ? c.minY + 0.6 : c.maxY + 0.6) && o.maxY > y0) y0 = o.maxY;
    }
    setPlayer(sx, y0 + 0.1, sz);
    p.input.yaw = yaw; p.input.pitch = 0;
    C.fastForward(0.25, 1 / 60);
    p.input.mz = 1; p.input.sprint = !!sprint;
    let best = p.pos.y, bestLow = p.pos.y, still = 0, t = 0, last = [p.pos.x, p.pos.z], mant = 0;
    for (; t < 14; t += 0.1) {
      p.hp = 100; p.shield = 100;
      C.fastForward(0.1, 1 / 60);
      if (p.mantleT != null) mant++;
      if (p.pos.y > best) best = p.pos.y;
      if (p.pos.y < bestLow) bestLow = p.pos.y;
      const moved = Math.hypot(p.pos.x - last[0], p.pos.z - last[1]); last = [p.pos.x, p.pos.z];
      still = moved < 0.02 ? still + 0.1 : 0;
      if (mode === 'up' && p.pos.y >= c.maxY - 0.35) break;
      if (mode === 'down' && p.pos.y <= c.minY + 0.5) break;
      if (still > 1.5) break;
    }
    p.input.mz = 0; p.input.sprint = false;
    const ok = mode === 'up' ? best >= c.maxY - 0.6 : bestLow <= Math.max(c.minY, foot, M().waterY - 0.6) + 0.7;
    const lifted = mode === 'down' && (mant > 0 || best > Math.max(y0, c.maxY) + 0.2);
    return { ok: ok && !lifted, lifted, mode, off, sprint: !!sprint, dir: c.dir, minY: r3(c.minY), maxY: r3(c.maxY), run: r3(run), at: [r3(cx), r3(cz)], startY: r3(y0), best: r3(best), bestLow: r3(bestLow), mant, stuck: still > 1.5 };
  }
  function rampsFine(opt) {
    const rs = rampList(), n = Math.min(rs.length, (opt && opt.max) || 1e9);
    const res = { n, walks: 0, skippedUp: 0, upWalks: 0, downWalks: 0, fails: [], failedRamps: 0 };
    const failedIdx = new Set();
    for (let i = 0; i < n; i++) {
      const c = rs[i], D = DIRS[c.dir], alongX = c.dir < 2, lowA = alongX ? (c.dir === 0 ? c.minX : c.maxX) : (c.dir === 2 ? c.minZ : c.maxZ);
      // a foot in the sea / on no standable ground (or its low edge more than 1.2 m above any ground within reach) is not climbed from the ground
      const g0 = support(alongX ? lowA - D[0] * 1.3 : (c.minX + c.maxX) / 2, alongX ? (c.minZ + c.maxZ) / 2 : lowA - D[1] * 1.3, c.minY + 0.3, c);
      const upOK = !(g0 < M().waterY - 0.1 || c.minY - g0 > 1.2);
      if (!upOK) res.skippedUp++;
      if (upOK) for (const sp of [false, true]) {
        let r = null;
        for (const off of [1.3, 0.8, 0.45, 0.15]) { r = walkRampFine(c, 'up', off, sp); res.walks++; res.upWalks++; if (r.ok) break; }
        if (!r.ok) { r.i = i; res.fails.push(r); failedIdx.add(i); }
      }
      for (const sp of [false, true]) for (const off of [0.5, 0.9, 1.6]) {
        const r = walkRampFine(c, 'down', off, sp); res.walks++; res.downWalks++;
        if (!r.ok) { r.i = i; res.fails.push(r); failedIdx.add(i); }
      }
    }
    p.input.mz = 0; p.input.sprint = false;
    res.failedRamps = failedIdx.size;
    res.failCount = res.fails.length;
    res.fails = res.fails.slice(0, 24);
    return res;
  }

  // ---------------------------------------------------------------- ranger towers: foot -> deck by waypoints (switchback when two ramps serve the deck)
  function gotoWaypoints(pts) {
    const out = [];
    const f0 = pts[0];
    setPlayer(f0[0], M().heightAt(f0[0], f0[1]) + 0.1, f0[1]);
    C.fastForward(0.25, 1 / 60);
    for (let k = 1; k < pts.length; k++) {
      const tx = pts[k][0], tz = pts[k][1]; let t = 0, still = 0, last = [p.pos.x, p.pos.z];
      for (; t < 20; t += 0.1) {
        p.hp = 100; p.shield = 100;
        const dx = tx - p.pos.x, dz = tz - p.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.35) break;
        p.input.yaw = Math.atan2(-dx, -dz); p.input.mz = 1; p.input.mx = 0;
        C.fastForward(0.1, 1 / 60);
        const moved = Math.hypot(p.pos.x - last[0], p.pos.z - last[1]); last = [p.pos.x, p.pos.z];
        still = moved < 0.02 ? still + 0.1 : 0;
        if (still > 1.2) break;
      }
      out.push({ wp: k, want: [r3(tx), r3(tz)], at: [r3(p.pos.x), r3(p.pos.z)], y: r3(p.pos.y), t: r3(t), stuck: still > 1.2 });
    }
    p.input.mz = 0;
    return out;
  }
  function towers() {
    const rs = rampList(), res = [];
    for (const c of M().colliders) {
      if (c.kind !== 'box' || c.prop || c.dead) continue;
      const w = c.maxX - c.minX, h = c.maxY - c.minY, d = c.maxZ - c.minZ;
      if (!(Math.abs(w - 4.8) < 0.01 && Math.abs(d - 4.8) < 0.01 && Math.abs(h - 0.3) < 0.01)) continue;      // a ranger-tower deck
      const x = (c.minX + c.maxX) / 2, z = (c.minZ + c.maxZ) / 2;
      const near = rs.filter((q) => (q.minX + q.maxX) / 2 > x - 3 && (q.minX + q.maxX) / 2 < x + 3 && q.minZ > z - 1 && q.minZ < z + 14);
      const lower = near.filter((q) => q.dir === 2), upper = near.filter((q) => q.dir === 3);
      let pts = null;
      if (lower.length && upper.length) {
        const lo = lower[0], up = upper[0], xl = (lo.minX + lo.maxX) / 2, xu = (up.minX + up.maxX) / 2;
        pts = [[xl, lo.minZ - 1.3], [xl, lo.maxZ - 0.5], [(xl + xu) / 2, up.maxZ + 0.8], [xu, up.maxZ - 0.5], [xu, up.minZ + 0.4], [x, z]];
      } else if (upper.length) {
        const up = upper[0], xu = (up.minX + up.maxX) / 2;
        pts = [[xu, up.maxZ + 1.3], [xu, up.maxZ - 0.5], [xu, up.minZ + 0.4], [x, z]];
      }
      if (!pts) { res.push({ at: [r3(x), r3(z)], top: r3(c.maxY), ok: false, why: 'no ramp serves the deck' }); continue; }
      const walk = gotoWaypoints(pts), last = walk[walk.length - 1];
      res.push({ at: [r3(x), r3(z)], top: r3(c.maxY), ramps: near.length, ok: !!last && last.y >= c.maxY - 0.4 && !last.stuck, endY: last && last.y, stuck: last && last.stuck, walk: walk.slice(-3) });
    }
    return { n: res.length, ok: res.filter((r) => r.ok).length, failed: res.filter((r) => !r.ok).slice(0, 6) };
  }

  // ---------------------------------------------------------------- ramp sides: from outside, across the run, into the plank
  function sides(opt) {
    const rs = rampList(), out = []; let blockedApproach = 0;
    for (const c of rs) {
      const run = c.dir < 2 ? c.maxX - c.minX : c.maxZ - c.minZ, across = c.dir < 2 ? c.maxZ - c.minZ : c.maxX - c.minX;
      const mx = (c.minX + c.maxX) / 2, mz = (c.minZ + c.maxZ) / 2;
      const hv = S.rampHalfV ? S.rampHalfV(c) : 0.15;
      // (Wave 8, lane K3) the side is walked at 50 % of the run (the original walk) AND at 30 % / 70 %: Wave 8's ramps are mostly housegen stairs inside walls
      // (no clear approach), so the mid-run walk alone measured 6 side walks on the stage-B tree (< SIDES_MIN 20: could-not-judge, and the ramp-sides-open
      // control was disarmed). Same eligibility, same judgement at every position; more of the same measurement, never a looser one.
      for (const fr of (opt && opt.fracs) || [0.5, 0.3, 0.7]) {
      const midU = run * fr, lineMid = c.minY + (c.maxY - c.minY) * fr;
      const gx = c.dir === 0 ? c.minX + midU : c.dir === 1 ? c.maxX - midU : mx, gz = c.dir === 2 ? c.minZ + midU : c.dir === 3 ? c.maxZ - midU : mz;
      const gUnder = support(gx, gz, lineMid - hv - 0.01, c, lineMid - hv - 0.01);
      const clearance = lineMid - hv - gUnder;
      // only where the plank is above a step and too low to stand under: there a capsule may not end up inside the footprint at ground level
      if (!(lineMid - gUnder > SU + 0.2 && clearance < H - 0.1 && across > 1.0)) continue;   // (next position along the run)
      const ax = c.dir < 2 ? 0 : 1, az = 1 - ax;
      for (const sg of [1, -1]) {
        const px = gx + ax * sg * (across / 2 + 2.6), pz = gz + az * sg * (across / 2 + 2.6);
        const py = support(px, pz, gUnder + 0.3);
        if (Math.abs(py - gUnder) > 0.6) continue;
        // a CLEAR approach: no other collider in the capsule's body band on the way from the start to the plank's edge (a ramp inside a
        // building is shielded by the building's walls: that walk measures the wall, not the ramp)
        let clear = true;
        for (let u = 0; u <= across / 2 + 2.6 - 0.2 && clear; u += 0.3) {
          const qx = px - ax * sg * u, qz = pz - az * sg * u;
          for (const o of M().queryColliders(qx, qz, R + 0.1, [])) {
            if (o === c || o.dead || o.kind === 'ramp') continue;
            if (o.maxY <= gUnder + SU || o.minY >= gUnder + H) continue;
            if (Math.hypot(qx - Math.max(o.minX, Math.min(qx, o.maxX)), qz - Math.max(o.minZ, Math.min(qz, o.maxZ))) < R + 0.05) { clear = false; break; }
          }
        }
        if (!clear) { blockedApproach++; continue; }
        setPlayer(px, py + 0.02, pz); C.fastForward(3 / 60);
        p.input.yaw = Math.atan2(-(-ax * sg), -(-az * sg)); p.input.mz = 1; p.input.mx = 0;
        let into = 0, inside = 0, minCross = 1e9; const trc = [];
        for (let i = 0; i < 120; i++) {
          C.fastForward(1 / 60); p.hp = 100;
          const e = [p.pos.x, p.pos.y, p.pos.z];
          if (opt && opt.trace && i % 15 === 0) trc.push([i, r3(e[0]), r3(e[1]), r3(e[2])]);
          const cross = Math.abs((e[0] - gx) * ax + (e[2] - gz) * az);
          const runPos = c.dir === 0 ? e[0] - c.minX : c.dir === 1 ? c.maxX - e[0] : c.dir === 2 ? e[2] - c.minZ : c.maxZ - e[2];
          minCross = Math.min(minCross, cross);
          if (!(cross < across / 2 - 0.05 && runPos > 0.1 && runPos < run - 0.1)) continue;
          inside++;
          const lineHere = c.minY + (c.maxY - c.minY) * Math.max(0, Math.min(1, runPos / run));
          if (lineHere + hv > e[1] + SU && lineHere - hv < e[1] + H - 0.05) into++;       // the plank is inside the capsule's body band: the capsule is IN the solid
        }
        p.input.mz = 0;
        out.push({ at: [r3(mx), r3(mz)], frac: fr, dir: c.dir, rise: r3(c.maxY - c.minY), side: sg, minCross: r3(minCross), insideTicks: inside, intoPlankTicks: into, start: [r3(px), r3(py), r3(pz)], gx: r3(gx), gz: r3(gz), across: r3(across), trace: trc });
      }
      }
    }
    return { tested: out.length, blockedApproach, insideAny: out.filter((q) => q.insideTicks > 0).length, intoSolid: out.filter((q) => q.intoPlankTicks > 0).length, examples: out.filter((q) => q.intoPlankTicks > 0).slice(0, 5), sample: out.slice(0, 3), rows: opt && opt.trace ? out : undefined };
  }

  // ---------------------------------------------------------------- falls, fine scan: every 0.2 m of drop height onto thin open slabs
  function fallsFine(opt) {
    const m = M(), cols = m.colliders.filter((c) => !c.dead);
    const cand = cols.filter((c) => c.kind === 'box' && !c.prop && c.maxY - c.minY <= 0.6 && c.maxX - c.minX >= 3.5 && c.maxZ - c.minZ >= 3.5);
    const open = (c) => {
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
      for (const o of m.queryColliders(cx, cz, 8, [])) { if (o === c || o.dead) continue; if (o.minX < cx + 0.6 && o.maxX > cx - 0.6 && o.minZ < cz + 0.6 && o.maxZ > cz - 0.6 && o.maxY > c.maxY - 0.01) return false; }
      return true;
    };
    const sel = cand.filter((c) => c.maxY - m.heightAt((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2) >= 2.5 && open(c));
    sel.sort((a, b) => (a.minX + a.minZ * 3) - (b.minX + b.minZ * 3));
    const want = (opt && opt.slabs) || 3, pick = [];
    for (let k = 0; k < Math.min(want, sel.length); k++) pick.push(sel[Math.floor(k * sel.length / Math.min(want, sel.length))]);
    const heights = []; for (let h = (opt && opt.from) || 5; h <= ((opt && opt.to) || 60) + 1e-9; h += (opt && opt.step) || 0.2) heights.push(+h.toFixed(3));
    let through = 0, total = 0, firstPass = null; const rows = [];
    for (const c of pick) {
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2, top = c.maxY; const passDrops = []; let n = 0;
      for (const dh of heights) {
        setPlayer(cx, top + dh, cz);
        for (let i = 0; i < 60 * 8; i++) { C.fastForward(1 / 60); p.hp = 100; if (p.onGround) break; }
        n++; total++;
        if (!(Math.abs(p.pos.y - top) <= 0.06)) { through++; passDrops.push(dh); if (firstPass === null || dh < firstPass) firstPass = dh; }
      }
      rows.push({ top: r3(top), thick: r3(c.maxY - c.minY), drops: n, through: passDrops.length, passDrops: passDrops.slice(0, 8) });
    }
    return { slabsAvailable: sel.length, slabsTested: pick.length, drops: total, through, firstPassDrop: firstPass, slabs: rows };
  }

  // ---------------------------------------------------------------- aim: the real fire() path vs the crosshair ray on a near thin wall
  function aim(opt) {
    const m = M(), cols = m.colliders.filter((c) => !c.dead);
    if (!window.__aimHook) {
      window.__aimHook = { tracers: [], impacts: [] };
      W.events.on('tracer', (q) => { window.__aimHook.tracers.push({ x: q.x, y: q.y, z: q.z, vx: q.vx, vy: q.vy, vz: q.vz }); });
      W.events.on('impact', (pt, surf) => { window.__aimHook.impacts.push({ x: pt.x, y: pt.y, z: pt.z, surf }); });
    }
    const shots = [];
    const walls = cols.filter((c) => c.kind === 'box' && !c.prop && Math.min(c.maxX - c.minX, c.maxZ - c.minZ) <= 0.6 && Math.max(c.maxX - c.minX, c.maxZ - c.minZ) >= 3 && c.maxY - c.minY >= 2.0 && c.minY - m.heightAt((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2) <= 0.6);
    const dirv = new (W.camera.position.constructor)();
    const need = (opt && opt.shots) || 12;
    let tried = 0;
    for (let wi = 0; wi < walls.length && shots.length < need && tried < 160; wi++) {
      const c = walls[(wi * 7) % walls.length]; tried++;
      const thinX = (c.maxX - c.minX) < (c.maxZ - c.minZ);
      const len = thinX ? c.maxZ - c.minZ : c.maxX - c.minX;
      for (const side of [1, -1]) {
        for (const dist of ((opt && opt.dists) || [1.0, 1.6, 2.4, 3.2])) {
          if (shots.length >= need) break;
          const off = ((wi % 5) - 2) * Math.min(1.0, (len - 3) / 6);
          const nx = thinX ? side : 0, nz = thinX ? 0 : side;
          const face = thinX ? (side > 0 ? c.maxX : c.minX) : (side > 0 ? c.maxZ : c.minZ);
          const px = thinX ? face + nx * dist : (c.minX + c.maxX) / 2 + off, pz = thinX ? (c.minZ + c.maxZ) / 2 + off : face + nz * dist;
          // open floor in front of the wall: level ground, no other collider within 0.8 m of the player
          const gy = support(px, pz, m.heightAt(px, pz) + 0.3);
          // (Wave 8, lane K3) "the same wall" = another WALL piece in the wall's plane (thin across it, >= 2 m tall). A furnished room puts deep boxes flush against
          // the wall (a stair's side box 2.26 m deep, a 0.25 m shelf 0.27 m tall): the in-plane test alone called them "the same wall", so a stance with the muzzle
          // inside a stair box passed the 0.8 m open-floor check (stage-B tree: the shot hit at the muzzle, 0.41 m from the reticle)
          const sameWall = (o) => (thinX ? (o.minX < c.maxX + 0.05 && o.maxX > c.minX - 0.05 && o.maxX - o.minX <= 0.6) : (o.minZ < c.maxZ + 0.05 && o.maxZ > c.minZ - 0.05 && o.maxZ - o.minZ <= 0.6)) && o.maxY - o.minY >= 2.0;
          const near = m.queryColliders(px, pz, 0.8, []).filter((o) => o !== c && !sameWall(o) && !o.dead && o.maxY > gy + 0.6 && o.minY < gy + 1.8);
          if (near.length || Math.abs(gy - support(thinX ? face : px, thinX ? pz : face, m.heightAt(px, pz) + 0.3)) > 0.5) continue;
          setPlayer(px, gy + 0.02, pz); p.onGround = true; C.fastForward(3 / 60);
          const yaw = Math.atan2(nx, nz) + (wi % 3 - 1) * 0.35;                // facing the wall, +-20 deg
          p.input.yaw = yaw; p.input.pitch = 0.04; p.yaw = yaw; p.pitch = 0.04; p.input.ads = !!(opt && opt.ads);
          for (let k = 0; k < 40; k++) C.fastForward(1 / 60);                  // let the camera settle (the pull-in snaps in at once, eases out)
          p.hp = 100;
          const wpn = p.weapon; if (!wpn) continue; wpn.magAmmo = Math.max(wpn.magAmmo || 0, 10); wpn.cd = 0;
          window.__aimHook.tracers.length = 0; window.__aimHook.impacts.length = 0;
          const cam = W.camera.position; W.camera.getWorldDirection(dirv);
          const camX = cam.x, camY = cam.y, camZ = cam.z, dX = dirv.x, dY = dirv.y, dZ = dirv.z;
          W._fireEdge = performance.now(); p.input.fire = true;
          for (let k = 0; k < 3; k++) C.fastForward(1 / 60);
          p.input.fire = false; W._fireEdge = 0; p.input.ads = false;
          const tr = window.__aimHook.tracers[0], im = window.__aimHook.impacts[0];
          // where the camera ray meets the wall's face plane (what the reticle sits on)
          const s = thinX ? (face - camX) / dX : (face - camZ) / dZ;
          let ex = camX + dX * s, ey = camY + dY * s, ez = camZ + dZ * s;
          let inWall = ey > c.minY && ey < c.maxY && (thinX ? (ez > c.minZ && ez < c.maxZ) : (ex > c.minX && ex < c.maxX));
          // (Wave 8, lane K3) a furnished room: a box between the camera and the wall face (a housegen wall shelf 0.25 m deep at 1.7-1.97 m, a stair's side box)
          // is what the crosshair ray meets FIRST - the reticle sits on it, so the shot is judged against THAT surface (exact segment test over the colliders on the
          // ray; a box that contains the camera is skipped - that is the camera-pull-in row's business). The bar is unchanged; only the expected point is the true one.
          let blocker = null;
          if (inWall) {
            const mxp = (camX + ex) / 2, mzp = (camZ + ez) / 2, rad = Math.hypot(ex - camX, ez - camZ) / 2 + 1.0;
            const cand = m.queryColliders(mxp, mzp, rad, []).filter((o) => o !== c && !o.dead && !(camX >= o.minX && camX <= o.maxX && camY >= o.minY && camY <= o.maxY && camZ >= o.minZ && camZ <= o.maxZ));
            const h = S.segmentColliders(camX, camY, camZ, ex, ey, ez, cand);
            if (h && h.t * s < s - 0.02) { ex = camX + dX * s * h.t; ey = camY + dY * s * h.t; ez = camZ + dZ * s * h.t; blocker = { via: 'camera', kind: h.c.kind, box: [r3(h.c.minX), r3(h.c.maxX), r3(h.c.minY), r3(h.c.maxY), r3(h.c.minZ), r3(h.c.maxZ)], before: r3(s * (1 - h.t)) }; }
            // ... and the shot itself leaves the MUZZLE (the tracer's origin), not the camera: a box on the muzzle -> reticle line but off the camera ray (the stage-B
            // verify's worst Isla shot: a wall shelf 1.7-1.97 m up, the reticle on the wall above / beside it) stops the bullet before the reticle point in every
            // third-person shooter (muzzle parallax). The expected impact is then where that line meets the box; a shot that misses BOTH is judged as before.
            if (tr) {
              const L = Math.hypot(ex - tr.x, ey - tr.y, ez - tr.z);
              if (L > 0.05) {
                const cand2 = m.queryColliders((tr.x + ex) / 2, (tr.z + ez) / 2, L / 2 + 1.0, []).filter((o) => o !== c && !o.dead && !(tr.x >= o.minX && tr.x <= o.maxX && tr.y >= o.minY && tr.y <= o.maxY && tr.z >= o.minZ && tr.z <= o.maxZ));
                const h2 = S.segmentColliders(tr.x, tr.y, tr.z, ex, ey, ez, cand2);
                if (h2 && h2.t * L < L - 0.02) { const t2 = h2.t; ex = tr.x + (ex - tr.x) * t2; ey = tr.y + (ey - tr.y) * t2; ez = tr.z + (ez - tr.z) * t2; blocker = { via: 'muzzle', kind: h2.c.kind, box: [r3(h2.c.minX), r3(h2.c.maxX), r3(h2.c.minY), r3(h2.c.maxY), r3(h2.c.minZ), r3(h2.c.maxZ)], before: r3(L * (1 - t2)) }; }
              }
            }
          }
          // the collider(s) the impact lies on (within 2 cm of its surface): names what the bullet really hit when the error is large
          const onBox = im ? m.queryColliders(im.x, im.z, 0.1, []).filter((o) => !o.dead && im.x >= o.minX - 0.02 && im.x <= o.maxX + 0.02 && im.y >= o.minY - 0.02 && im.y <= o.maxY + 0.02 && im.z >= o.minZ - 0.02 && im.z <= o.maxZ + 0.02)
            .slice(0, 3).map((o) => ({ kind: o.kind, wall: o === c, box: [r3(o.minX), r3(o.maxX), r3(o.minY), r3(o.maxY), r3(o.minZ), r3(o.maxZ)] })) : null;
          // the error: the impact's distance from the expected point. When the bullet stopped on ANOTHER collider (not this wall) - a shelf edge the muzzle line grazes,
          // a box between muzzle and reticle - the shot went where it was aimed iff the impact lies ON the muzzle -> reticle line: then the error is the impact's distance
          // from that line (a mis-aimed shot is off the line whatever it hits; the 0.15 m bar is unchanged)
          let err = im && inWall ? Math.hypot(im.x - ex, im.y - ey, im.z - ez) : null, errKind = 'point';
          if (err != null && tr && onBox && onBox.length && !onBox.some((q) => q.wall)) {
            const vx = ex - tr.x, vy = ey - tr.y, vz = ez - tr.z, vv = vx * vx + vy * vy + vz * vz;
            const u = vv > 1e-9 ? Math.max(0, Math.min(1, ((im.x - tr.x) * vx + (im.y - tr.y) * vy + (im.z - tr.z) * vz) / vv)) : 0;
            const dl = Math.hypot(im.x - (tr.x + vx * u), im.y - (tr.y + vy * u), im.z - (tr.z + vz * u));
            if (dl < err && u * Math.sqrt(vv) >= 0.3) { err = dl; errKind = 'line'; }     // never for a hit AT the muzzle (a muzzle inside a box is no aim)
          }
          shots.push({ dist, expected: [r3(ex), r3(ey), r3(ez)], impact: im ? [r3(im.x), r3(im.y), r3(im.z)] : null, surf: im && im.surf,
            err: err != null ? r3(err) : null, errKind, inWall, blocker, fired: !!tr,
            cam: [r3(camX), r3(camY), r3(camZ)], muzzle: tr ? [r3(tr.x), r3(tr.y), r3(tr.z)] : null, wallBox: [r3(c.minX), r3(c.maxX), r3(c.minY), r3(c.maxY), r3(c.minZ), r3(c.maxZ)], impactOn: onBox });
        }
      }
    }
    const errs = shots.filter((q) => q.err != null).map((q) => q.err);
    return { shots: shots.length, measured: errs.length, errMax: pct(errs, 1), errP50: pct(errs, 0.5), over015: errs.filter((e) => e > 0.15).length, onBlocker: shots.filter((q) => (q.blocker || q.errKind === 'line') && q.err != null).length, rows: shots.slice(0, 16) };
  }

  return { chests, ramps, rampsFine, towers, sides, fallsFine, aim };
}
