// probe_ticks.js - the all-state tick metric of navcheck.py (lane 5D; promoted from the navigation lane's probe_stuck.js and the
// skeptic's skeptic_tick.js: the per-tick blocked metric with cause attribution, run lengths and the heal-direction count).
//
// One whole storm-on standard match through fastForward. On EVERY fixed tick, for every live landed grounded bot that WANTS to move
// (|input.mz| + |input.mx| > 0.1, not emoting, not mantling):
//   loc     = "out" | "in_ground" | "in_upper": indoor = a non-ramp collider 2-12 m above the feet covers (x,z) (agl > 1.5 m = upper);
//             recomputed every 30 ticks per bot. roofEdge = a roof/no-roof change within 1.6 m (the old probe called this "door")
//   blocked = horizontal displacement this tick < 0.01 m
//   cause   = "wall" (a non-ramp collider overlapping the walk band within 0.65 m) | "actor" (another live actor within 1 m) | "other"
//   runs    = contiguous blocked ticks per bot; a run of >= 30 ticks (0.5 s) is a VISIBLE grind (a player sees a bot run into a wall)
//   state   = the brain state of the tick (ENGAGE, HEAL, LOOT, ...): every counter is also kept per state@loc
// HEAL direction: for a healing bot with a known threat (bb.targetPos), is the per-tick displacement AWAY from the threat (dot > 0.3),
// TOWARD it (dot < -0.3) or sideways / still?
// READ-ONLY on game state (W.paused aside, which fastForward ignores). The tick hook is removed in finally.
// opt = { seconds }
async (opt) => {
  const C = window.__LC__, W = C.W;
  W.paused = true;
  const maxSeconds = (opt && opt.seconds) || 1000;
  const brains = C.brains();
  const byId = new Map(brains.map((b) => [b.actor.id, b]));
  const qc = (x, z, r) => { const out = []; W.map.queryColliders(x, z, r, out); return out; };
  const roofed = (x, y, z) => {
    for (const c of qc(x, z, 0.3)) {
      if (c.dead || c.kind === "ramp") continue;
      if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      if (c.minY > y + 2.0 && c.minY < y + 12) return true;
    }
    return false;
  };
  const locOf = (a) => {
    const x = a.pos.x, y = a.pos.y, z = a.pos.z;
    const r0 = roofed(x, y, z);
    if (!r0) return { loc: "out", edge: false };
    let edge = false;
    for (let k = 0; k < 8 && !edge; k++) { const ang = k * Math.PI / 4; if (!roofed(x + Math.cos(ang) * 1.6, y, z + Math.sin(ang) * 1.6)) edge = true; }
    return { loc: y - W.map.heightAt(x, z) > 1.5 ? "in_upper" : "in_ground", edge };
  };
  const wallNear = (a) => {
    const x = a.pos.x, z = a.pos.z, y = a.pos.y;
    for (const c of qc(x, z, 1.0)) {
      if (c.dead || c.kind === "ramp") continue;
      if (c.maxY <= y + 0.55 || c.minY >= y + 1.8) continue;
      const ex = x - Math.min(Math.max(x, c.minX), c.maxX), ez = z - Math.min(Math.max(z, c.minZ), c.maxZ);
      if (ex * ex + ez * ez < 0.65 * 0.65) return true;
    }
    return false;
  };
  const actorNear = (a) => {
    for (const o of W.actors) {
      if (o === a || !o.alive) continue;
      if (Math.abs(o.pos.y - a.pos.y) < 1.5 && Math.hypot(o.pos.x - a.pos.x, o.pos.z - a.pos.z) < 1.0) return true;
    }
    return false;
  };
  const inc = (o, k, n) => { o[k] = (o[k] || 0) + (n || 1); };
  const R = { intent: {}, blocked: {}, cause: {}, intentSL: {}, blockedSL: {}, blockedEdgeSL: {}, causeSL: {}, runHist: {}, runTicksGE30: {}, runTicksGE30SL: {}, runTicksGE90: {},
    jumpsSL: {}, heal: { ticks: 0, withThreat: 0, away: 0, toward: 0, still: 0, side: 0, ticksIn: 0, withThreatIn: 0, awayIn: 0, towardIn: 0 } };
  const loc = new Map(), prev = new Map(), run = new Map();
  let tickN = 0;
  const closeRun = (id) => {
    const r = run.get(id); if (!r) return;
    const L = r.n, k = r.loc;
    inc(R.runHist, k + ":" + (L < 6 ? "1-5" : L < 30 ? "6-29" : L < 90 ? "30-89" : "90+"));
    if (L >= 30) { inc(R.runTicksGE30, k, L); inc(R.runTicksGE30SL, r.st + "@" + k, L); }
    if (L >= 90) inc(R.runTicksGE90, k, L);
    run.delete(id);
  };
  window.__navGen = (window.__navGen || 0) + 1; const gen = window.__navGen;
  W.events.on("jump", (a) => { if (window.__navGen !== gen || !a || !a.isBot) return; const b = byId.get(a.id); inc(R.jumpsSL, (b ? b.state : "?") + "@" + ((loc.get(a.id) || { loc: "out" }).loc)); });
  const prevHook = W._tickHook;
  W._tickHook = (W2) => {
    if (prevHook) prevHook(W2);
    tickN++;
    for (const b of brains) {
      const a = b.actor, id = a.id;
      if (!a.alive || a.gliding) { prev.delete(id); closeRun(id); continue; }
      if (tickN % 30 === 0 || !loc.has(id)) loc.set(id, locOf(a));
      const p = prev.get(id);
      const want = Math.abs(a.input.mz || 0) + Math.abs(a.input.mx || 0) > 0.1 && !a.emoting && a.mantleT == null;
      if (p && want && a.onGround) {
        const L0 = loc.get(id), k = L0.loc, sl = b.state + "@" + k;
        const dx = a.pos.x - p.x, dz = a.pos.z - p.z, d = Math.hypot(dx, dz);
        inc(R.intent, k); inc(R.intentSL, sl);
        if (d < 0.01) {
          inc(R.blocked, k); inc(R.blockedSL, sl);
          if (L0.edge) inc(R.blockedEdgeSL, sl);
          const cause = wallNear(a) ? "wall" : actorNear(a) ? "actor" : "other";
          inc(R.cause, k + ":" + cause); inc(R.causeSL, sl + ":" + cause);
          const r = run.get(id); if (r) r.n++; else run.set(id, { n: 1, loc: k, st: b.state });
        } else closeRun(id);
        if (b.state === "HEAL" && a.healing) {
          R.heal.ticks++; if (k !== "out") R.heal.ticksIn++;
          const tp = b.bb.targetPos;
          if (tp) {
            R.heal.withThreat++; if (k !== "out") R.heal.withThreatIn++;
            if (d < 0.01) R.heal.still++;
            else {
              const ax = p.x - tp.x, az = p.z - tp.z;
              const dot = (dx * ax + dz * az) / (d * (Math.hypot(ax, az) || 1));
              if (dot > 0.3) { R.heal.away++; if (k !== "out") R.heal.awayIn++; }
              else if (dot < -0.3) { R.heal.toward++; if (k !== "out") R.heal.towardIn++; }
              else R.heal.side++;
            }
          }
        }
      } else closeRun(id);
      if (p) { p.x = a.pos.x; p.z = a.pos.z; } else prev.set(id, { x: a.pos.x, z: a.pos.z });
    }
  };
  const t0 = performance.now();
  try {
    for (let el = 0; el < maxSeconds; el += 1) {
      C.fastForward(1);
      if (W.match && W.match.over) break;
    }
  } finally { W._tickHook = prevHook; window.__navGen++; }
  for (const id of [...run.keys()]) closeRun(id);
  const pct = (a, b) => (b ? +(100 * a / b).toFixed(2) : null);
  const sum = (o, keys) => keys.reduce((s, k) => s + (o[k] || 0), 0);
  const IN = ["in_ground", "in_upper"];
  const sl = (o, st) => sum(o, IN.map((k) => st + "@" + k));
  R.summary = {
    map: W.mapId, seed: W.seed, ticks: tickN, simT: +W.t.toFixed(1), over: !!(W.match && W.match.over), wallS: +((performance.now() - t0) / 1000).toFixed(1),
    indoorBlockedPct: pct(sum(R.blocked, IN), sum(R.intent, IN)), outdoorBlockedPct: pct(R.blocked.out || 0, R.intent.out || 0),
    indoorShareOfIntentPct: pct(sum(R.intent, IN), sum(R.intent, IN.concat(["out"]))),
    indoorVisibleGrindPctOfIntent: pct(sum(R.runTicksGE30, IN), sum(R.intent, IN)), outdoorVisibleGrindPctOfIntent: pct(R.runTicksGE30.out || 0, R.intent.out || 0),
    engageIndoorIntent: sl(R.intentSL, "ENGAGE"), engageIndoorBlocked: sl(R.blockedSL, "ENGAGE"),
    healIndoorIntent: sl(R.intentSL, "HEAL"), healIndoorBlocked: sl(R.blockedSL, "HEAL"),
  };
  return R;
}
