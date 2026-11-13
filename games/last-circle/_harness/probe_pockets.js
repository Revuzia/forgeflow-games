// pocket_probe.js - the deterministic heal-pocket probe (lane L1-heal-pocket, Last Circle Wave 5 leftovers round).
//
// QUESTION: does a healing bot that is tucked against a stair (a RAMP collider) get OUT? The heal retreat (bots.js actHeal ->
// pickRetreat -> headingBlocked) must never pick a heading that runs into a ramp's side or underside (player.js blockedIn refuses
// it via the sim's rampBlocks), and a bot that does get pinned must free itself fast.
//
// For EVERY live ramp collider of the map (W.map.colliders, kind "ramp", not dead) it builds these placements, all with a REAL bot
// (the game's own brain + mover, one throwaway match, every other actor alive=false, the player parked):
//   side(T)   a bot 0.3 m OUTSIDE one of the ramp's two sides (both sides), at the position along the run where the slab top above its
//             feet is T = 0.8 m and 1.4 m (the isla_viva seed 7 case stands at 0.97 m), floor = the support at the ramp's low-edge height;
//             the placement must be a real pocket: the sim's rampBlocks(c, x, z, feet, 1.8, 0.45, 0.55) is TRUE there;
//   under(H)  a bot UNDER the slab on the ramp's centre line where the slab's UNDERSIDE is H = 1.8 m and 2.4 m above its feet
//             (the floor is the terrain or a box top below the slab).
// A placement is skipped when the capsule is not free there (a non-ramp collider overlaps it) or the mover would not hold it at the
// intended floor; skipped placements are COUNTED, not hidden.
// The bot is put in state HEAL with think() parked, healing a medkit (a.healing, 8 s channel), hp 30, and a THREAT is put so the
// retreat heading points INTO the ramp: bb.targetPos = the bot's position minus 15 m along the "into the ramp" direction
//   (side: across the side toward the footprint; under: down the slab, toward its low edge, where the headroom shrinks).
// It steps 120 ticks (2 s) and PASSES when the bot ends >= 2 m (horizontally) from where it started ("it got out").
// Each failing trial is then run through an ESCAPE ORACLE: the same bot, brain parked, healing speed, walked by the REAL mover in each of
// 16 directions for 120 ticks; if no direction gets 2 m, the placement is walled-in (not escapable), reported apart and not counted
// against the bot. The bar (read by pocket_probe.py): pass >= 98 % of the escapable placements.
//
// opt = { ticks: 120, minDisp: 2, healSides: [1, -1], targets: [0.8, 1.4], heads: [1.8, 2.4], only: <ramp index list or null>, trace: false }
// READ-ONLY on the map; W.paused is set (fastForward ignores it). Mutates the throwaway match's actors (page-local).
async (opt) => {
  opt = opt || {};
  const C = window.__LC__, W = C.W, K = window.FFG.sim.Royale;
  const R = K.PLAYERK.radius, H = K.PLAYERK.height, STEP = 0.55;
  // A build without C-RAMP (the Wave-4 sim has no rampBlocks: ramp sides and undersides are walk-through) has no pocket to be stuck in.
  // The sim's own functions are used when present; otherwise the placements are still built from a local copy of the same formulas
  // (identical to sim/royale.js rampHalfV / rampBlocks) so the run is information, and the result says noCRamp: true.
  const noCRamp = typeof K.rampBlocks !== "function";
  const rampHalfV = noCRamp ? (c) => { const along = (c.dir === 0 || c.dir === 1) ? c.maxX - c.minX : c.maxZ - c.minZ; const k = (c.maxY - c.minY) / Math.max(0.01, along); return 0.3 * 0.5 * Math.sqrt(1 + k * k); } : K.rampHalfV;
  const rampBlocks = noCRamp ? (c, x, z, yd, h, r, stepUp) => {
    const nx = x < c.minX ? c.minX : x > c.maxX ? c.maxX : x, nz = z < c.minZ ? c.minZ : z > c.maxZ ? c.maxZ : z;
    const ex = x - nx, ez = z - nz;
    if (ex * ex + ez * ez >= r * r) return false;
    let along, uc, ev;
    if (c.dir === 0) { along = c.maxX - c.minX; uc = x - c.minX; ev = ez; } else if (c.dir === 1) { along = c.maxX - c.minX; uc = c.maxX - x; ev = ez; }
    else if (c.dir === 2) { along = c.maxZ - c.minZ; uc = z - c.minZ; ev = ex; } else { along = c.maxZ - c.minZ; uc = c.maxZ - z; ev = ex; }
    const al = along > 0.01 ? along : 0.01, k = (c.maxY - c.minY) / al;
    const uN = uc < 0 ? 0 : uc > al ? al : uc;
    if (c.minY + k * uN <= yd + stepUp) return false;
    let reach = r * r - ev * ev; reach = reach > 0 ? Math.sqrt(reach) : 0;
    let uLow = uc - reach; if (uLow < 0) uLow = 0; else if (uLow > al) uLow = al;
    return c.minY + k * uLow - rampHalfV(c) < yd + h;
  } : K.rampBlocks;
  const TICKS = opt.ticks || 120, MIN_DISP = opt.minDisp || 2.0;
  const SIDES = opt.healSides || [1, -1], TARGETS = opt.targets || [0.8, 1.4], HEADS = opt.heads || [1.8, 2.4];
  W.paused = true;
  const brains = C.brains();
  const T = brains.find((b) => b.actor.alive && b.actor.isBot);
  if (!T) return { error: "no live bot" };
  const a = T.actor, bb = T.bb;
  for (const o of W.actors) if (o !== a && o !== W.player) o.alive = false;
  const P = W.player;
  const qc = (x, z, r) => { const out = []; W.map.queryColliders(x, z, r, out); return out; };
  const rampTop = (c, x, z) => K.rampTopAt(c, x, z);
  const supportAt = (x, z, y) => {
    let s = W.map.heightAt(x, z);
    for (const c of qc(x, z, 0.6)) {
      if (c.dead) continue;
      if (x < c.minX - 0.3 || x > c.maxX + 0.3 || z < c.minZ - 0.3 || z > c.maxZ + 0.3) continue;
      const top = c.kind === "ramp" ? rampTop(c, x, z) : c.maxY;
      if (top <= y + STEP && top > s) s = top;
    }
    return s;
  };
  // a non-ramp collider overlapping the standing capsule (the part of player.js blockedIn that is not C-RAMP)
  const capsuleFree = (x, z, y) => {
    for (const c of qc(x, z, 1.0)) {
      if (c.dead || c.kind === "ramp") continue;
      if (c.maxY <= y + STEP || c.minY >= y + H) continue;
      const ex = x - Math.min(Math.max(x, c.minX), c.maxX), ez = z - Math.min(Math.max(z, c.minZ), c.maxZ);
      if (ex * ex + ez * ez < R * R) return false;
    }
    return true;
  };
  const lowDir = (c) => (c.dir === 0 ? [-1, 0] : c.dir === 1 ? [1, 0] : c.dir === 2 ? [0, -1] : [0, 1]);   // toward the low edge (the slab gets lower)
  const runLen = (c) => ((c.dir === 0 || c.dir === 1) ? c.maxX - c.minX : c.maxZ - c.minZ);
  // the centre line point at run coordinate u (from the low edge) and the lateral offset toward `lat` (-1 min side, 0 centre, +1 max side)
  const lineAt = (c, u, off) => {
    const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
    if (c.dir === 0) return { x: c.minX + u, z: off < 0 ? c.minZ - 0.3 : off > 0 ? c.maxZ + 0.3 : cz };
    if (c.dir === 1) return { x: c.maxX - u, z: off < 0 ? c.minZ - 0.3 : off > 0 ? c.maxZ + 0.3 : cz };
    if (c.dir === 2) return { z: c.minZ + u, x: off < 0 ? c.minX - 0.3 : off > 0 ? c.maxX + 0.3 : cx };
    return { z: c.maxZ - u, x: off < 0 ? c.minX - 0.3 : off > 0 ? c.maxX + 0.3 : cx };
  };
  const inward = (c, off) => {   // unit vector from the side toward the footprint
    if (c.dir === 0 || c.dir === 1) return [0, off < 0 ? 1 : -1];
    return [off < 0 ? 1 : -1, 0];
  };

  // ---------- placements ----------
  const ramps = [];
  W.map.colliders.forEach((c, i) => { if (c.kind === "ramp" && !c.dead) ramps.push({ c, i }); });
  const places = [], skipped = { notPocket: 0, noFloor: 0, notFree: 0, notHeld: 0, noSpot: 0 };
  for (const { c, i } of ramps) {
    if (opt.only && !opt.only.includes(i)) continue;
    const L = runLen(c);
    // --- sides
    for (const off of [-1, 1]) {
      for (const tgt of TARGETS) {
        let best = null;
        for (let u = 0; u <= L + 1e-9; u += 0.05) {
          const p = lineAt(c, u, off);
          const f = supportAt(p.x, p.z, c.minY + 0.1);
          const top = rampTop(c, p.x, p.z), Tn = top - f;
          const err = Math.abs(Tn - tgt);
          if (err <= 0.12 && (!best || err < best.err)) best = { u, p, f, err, Tn };
        }
        if (!best) { skipped.noSpot++; continue; }
        const { p, f } = best;
        if (!capsuleFree(p.x, p.z, f)) { skipped.notFree++; continue; }
        if (Math.abs(supportAt(p.x, p.z, f + 0.01) - f) > 0.03) { skipped.noFloor++; continue; }
        if (!rampBlocks(c, p.x, p.z, f, H, R, STEP)) { skipped.notPocket++; continue; }
        const inw = inward(c, off);
        places.push({ ramp: i, kind: "side", tgt, off, x: p.x, y: f, z: p.z, ux: inw[0], uz: inw[1], Tn: +best.Tn.toFixed(2), dir: c.dir });
      }
    }
    // --- under the slab
    for (const hd of HEADS) {
      let best = null;
      for (let u = 0; u <= L + 1e-9; u += 0.05) {
        const p = lineAt(c, u, 0);
        const bottom = rampTop(c, p.x, p.z) - rampHalfV(c);
        const floors = [W.map.heightAt(p.x, p.z)];
        for (const o of qc(p.x, p.z, 0.6)) {
          if (o.dead || o.kind === "ramp") continue;
          if (p.x < o.minX || p.x > o.maxX || p.z < o.minZ || p.z > o.maxZ) continue;
          if (o.maxY < bottom - 1.0) floors.push(o.maxY);
        }
        for (const f of floors) {
          const err = Math.abs(bottom - f - hd);
          if (err <= 0.1 && (!best || err < best.err)) best = { u, p, f, err };
        }
      }
      if (!best) { skipped.noSpot++; continue; }
      const { p, f } = best;
      if (!capsuleFree(p.x, p.z, f)) { skipped.notFree++; continue; }
      if (Math.abs(supportAt(p.x, p.z, f + 0.01) - f) > 0.03) { skipped.noFloor++; continue; }
      const ld = lowDir(c);
      places.push({ ramp: i, kind: "under", tgt: hd, off: 0, x: p.x, y: f, z: p.z, ux: ld[0], uz: ld[1], Tn: hd, dir: c.dir });
    }
  }

  // ---------- one trial ----------
  const keep = () => { a.hp = Math.max(a.hp, 30); a.shield = 0; a.lastDamageT = -999; a.lastAttacker = null; if (P && P.alive) { P.hp = 100; P.shield = 100; } };
  if (P) {   // park the player far away on open ground (same trick as probe_rooms.js)
    const e = W.map.half - 40;
    for (const [x, z] of [[e, e], [-e, e], [e, -e], [-e, -e]]) {
      const y = W.map.heightAt(x, z);
      if (y > W.map.waterY + 1) { P.pos.set(x, y, z); P.vel.set(0, 0, 0); P.gliding = false; P.onGround = true; break; }
    }
  }
  const slotMed = () => { a.inventory.slots[1] = { kind: "consumable", id: "medkit", count: 3 }; };
  const simT0 = W.t;   // every trial restarts at this sim time: 2500 trials x 2 s would run the storm into its final collapse (~860 s), which kills the test bot
  const resetBot = (x, y, z, yaw) => {
    W.t = simT0;
    a.pos.set(x, y, z); a.vel.set(0, 0, 0); a.onGround = true; a.gliding = false; a.swimming = false; a.emoting = null; a.mantleT = null;
    a.healing = null; a.crouching = false; a.yaw = yaw; a.input.yaw = yaw; a.input.mx = 0; a.input.mz = 0; a.input.jump = false; a.input.sprint = false;
    a.hp = 30; a.shield = 0; a.lastDamageT = -999; a.lastAttacker = null;
    slotMed();
    bb.path = null; bb.pathGoal = null; bb.progGoal = null; bb.progBest = null; bb.progT = 0; bb.stuckT = 0; bb.anchor = null; bb.anchorT = W.t;
    bb.wallSide = 0; bb.detourDir = 0; bb.nextPathT = 0; bb.nextJumpT = 0; bb.lootId = null; bb.chestId = null; bb.chestT = 0;
    bb.target = null; bb.supply = null; bb.heard = null; bb.coverReflexUntil = 0; bb.threatFor = null; bb.moveTo = null; bb.breaks = 0;
    if (bb.wallCols) bb.wallCols.length = 0;
    bb.wallT = -99; bb.wallX = 1e9; bb.wallZ = 1e9;
    bb.hdX = 0; bb.hdZ = 0; bb.hdT = -99; bb.hdBadX = 0; bb.hdBadZ = 0; bb.hdBadUntil = 0; bb.unstickT = -99;
    bb.slideX = 0; bb.slideZ = 0; bb.slideUntil = -99; bb.slideFlips = 0;
    bb.pinX = x; bb.pinZ = z; bb.pinT = W.t; bb.pinIntent = 0; bb.pinN = 0; bb.healBlockedUntil = 0;
    bb.closeInUntil = 0; bb.coverState = undefined; bb.coverPt = null;
  };
  const trial = (pl, healSide) => {
    const yaw = Math.atan2(pl.ux, pl.uz);
    resetBot(pl.x, pl.y, pl.z, yaw);
    bb.healSide = healSide;
    const thr = { x: pl.x - pl.ux * 15, y: pl.y, z: pl.z - pl.uz * 15 };
    bb.targetPos = thr;
    T.state = "HEAL"; T.nextThink = 1e12;
    if (!W.useConsumable(a, "medkit")) return { err: "no heal" };
    const tr = { px: a.pos.x, pz: a.pos.z, blocked: 0, run: 0, maxRun: 0, hold: 0, tickN: 0, trace: opt.trace ? [] : null, states: {} };
    const prevHook = W._tickHook;
    W._tickHook = (W2) => {
      if (prevHook) prevHook(W2);
      keep();
      bb.targetPos = thr; thr.x = pl.x - pl.ux * 15; thr.z = pl.z - pl.uz * 15; thr.y = pl.y;
      tr.tickN++;
      const want = Math.abs(a.input.mz || 0) + Math.abs(a.input.mx || 0) > 0.1;
      const d = Math.hypot(a.pos.x - tr.px, a.pos.z - tr.pz);
      if (!want) tr.hold++;
      if (want && d < 0.01) { tr.blocked++; tr.run++; if (tr.run > tr.maxRun) tr.maxRun = tr.run; } else tr.run = 0;
      tr.px = a.pos.x; tr.pz = a.pos.z;
      tr.states[T.state] = (tr.states[T.state] || 0) + 1;
      if (tr.trace && tr.tickN % 6 === 0) tr.trace.push([tr.tickN, +a.pos.x.toFixed(2), +a.pos.y.toFixed(2), +a.pos.z.toFixed(2), T.state, +(a.input.mx || 0).toFixed(2), +(a.input.mz || 0).toFixed(2), +bb.hdX.toFixed(2), +bb.hdZ.toFixed(2), bb.breaks, bb.pinN]);
    };
    try { C.fastForward(TICKS / 60); } finally { W._tickHook = prevHook; }
    const disp = Math.hypot(a.pos.x - pl.x, a.pos.z - pl.z);
    return { wt: +W.t.toFixed(0), over: !!(W.match && W.match.over), alive: !!a.alive, phase: W.phase, disp: +disp.toFixed(2), dy: +(a.pos.y - pl.y).toFixed(2), blocked: tr.blocked, maxRun: tr.maxRun, hold: tr.hold, state: T.state, breaks: bb.breaks, ticks: tr.tickN, states: tr.states, trace: tr.trace };
  };
  // the escape oracle: park the brain, walk the REAL mover in 16 directions at healing speed
  const oracle = (pl) => {
    const saved = brains.slice();
    brains.length = 0;
    let best = 0, bestAng = null;
    try {
      for (let k = 0; k < 16; k++) {
        const ang = k * Math.PI / 8;
        resetBot(pl.x, pl.y, pl.z, ang);
        a.healing = { id: "medkit", tLeft: 100 };
        const prevHook = W._tickHook;
        W._tickHook = (W2) => { if (prevHook) prevHook(W2); keep(); a.input.yaw = ang; a.input.mz = 1; a.input.mx = 0; a.input.sprint = false; };
        try { C.fastForward(TICKS / 60); } finally { W._tickHook = prevHook; }
        const d = Math.hypot(a.pos.x - pl.x, a.pos.z - pl.z);
        if (d > best) { best = d; bestAng = ang; }
        if (best >= MIN_DISP) break;
      }
    } finally { for (const b of saved) brains.push(b); a.input.mz = 0; a.input.mx = 0; }
    return { best: +best.toFixed(2), ang: bestAng };
  };

  // ---------- run ----------
  const t0 = performance.now();
  const rows = [], byKind = {};
  let invalid = 0;
  for (const hs of SIDES) {
    for (const pl of places) {
      const r = trial(pl, hs);
      if (!a.alive) { invalid++; rows.push({ ramp: pl.ramp, kind: pl.kind, hs, invalid: true, alive: false }); continue; }
      const row = { ramp: pl.ramp, kind: pl.kind, tgt: pl.tgt, off: pl.off, hs, x: +pl.x.toFixed(2), y: +pl.y.toFixed(2), z: +pl.z.toFixed(2), Tn: pl.Tn, dir: pl.dir };
      Object.assign(row, r);
      row.ok = !r.err && r.disp >= MIN_DISP;
      if (!row.ok) { const o = oracle(pl); row.oracle = o; row.escapable = o.best >= MIN_DISP; }
      rows.push(row);
      const k = pl.kind + ":" + pl.tgt + ":hs" + hs;
      const e = byKind[k] || (byKind[k] = { n: 0, ok: 0, notEscapable: 0, blockedTicks: 0, maxRun: 0, runGE30: 0 });
      e.n++; if (row.ok) e.ok++; else if (!row.escapable) e.notEscapable++;
      e.blockedTicks += r.blocked || 0; if ((r.maxRun || 0) > e.maxRun) e.maxRun = r.maxRun || 0; if ((r.maxRun || 0) >= 30) e.runGE30++;
    }
  }
  a.healing = null;
  const live = rows.filter((r) => !r.invalid);
  const n = live.length, ok = live.filter((r) => r.ok).length, notEsc = live.filter((r) => !r.ok && !r.escapable).length;
  const fails = live.filter((r) => !r.ok && r.escapable);
  return {
    map: W.mapId, seed: W.seed, noCRamp, invalid, ramps: ramps.length, placements: places.length, skipped, trials: n, ok, notEscapable: notEsc,
    fails: fails.length, passPct: n - notEsc ? +(100 * ok / (n - notEsc)).toFixed(2) : null,
    longRuns: live.filter((r) => r.maxRun >= 30).length, byKind, failRows: fails.slice(0, 40), notEscRows: live.filter((r) => !r.ok && !r.escapable).slice(0, 12),
    wallS: +((performance.now() - t0) / 1000).toFixed(1), rows: opt.rows ? rows : undefined,
  };
}
