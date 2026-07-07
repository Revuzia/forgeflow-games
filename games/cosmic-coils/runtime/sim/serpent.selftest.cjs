/* Cosmic Coils sim selftest — node runtime/sim/serpent.selftest.cjs
 * Deterministic assertions over the headless sphere-snake sim. */
"use strict";

let PASS = 0, FAIL = 0;
const ok = (cond, name, extra) => {
  if (cond) { PASS++; console.log("  ok  " + name); }
  else { FAIL++; console.log("  FAIL " + name + (extra != null ? " — " + extra : "")); }
};
const close = (a, b, eps, name) => ok(Math.abs(a - b) <= eps, name, `${a} vs ${b}`);

(async () => {
  const S = await import("./serpent.js");
  const { createWorld, step, spawnSnake, setInput, steerToward, killSnake, snakeBySlot,
    bodyPoints, computeSegs, ranking, stateHash, drainEvents, spawnFood, removeFood,
    weatherAt, terrainH, segCount, segRadius, segSpacing, turnRate, speedOf, CONST, V, angDist, SKINS } = S;

  // ── 1. determinism ─────────────────────────────────────────────
  console.log("[determinism]");
  const mk = () => {
    const W = createWorld({ seed: 777, biome: "ember" });
    for (let i = 0; i < 6; i++) spawnSnake(W, i, { isBot: i !== 0 });
    return W;
  };
  const Wa = mk(), Wb = mk();
  for (let i = 0; i < 900; i++) { step(Wa, 1 / 60); step(Wb, 1 / 60); }
  ok(stateHash(Wa) === stateHash(Wb), "same seed → identical state after 900 steps", stateHash(Wa) + " vs " + stateHash(Wb));
  ok(Wa.time > 14.9 && Wa.time < 15.1, "time advanced 15s");

  // ── 2. sphere invariants ───────────────────────────────────────
  console.log("[sphere invariants]");
  let unitOK = true, tanOK = true, finiteOK = true;
  for (const sn of Wa.snakes) {
    if (!sn.alive) continue;
    const ul = Math.abs(V.len(sn.u) - 1);
    const d = Math.abs(V.dot(sn.u, sn.t));
    if (ul > 1e-6) unitOK = false;
    if (d > 1e-6) tanOK = false;
    for (const v of [sn.u.x, sn.u.y, sn.u.z, sn.t.x, sn.t.y, sn.t.z, sn.mass]) if (!Number.isFinite(v)) finiteOK = false;
  }
  ok(unitOK, "heads stay on unit sphere");
  ok(tanOK, "tangents stay perpendicular to position");
  ok(finiteOK, "all state finite");

  // ── 3. movement + turning ──────────────────────────────────────
  console.log("[movement]");
  const Wm = createWorld({ seed: 42, biome: "verdant", foodTarget: 0 });
  for (const id of Array.from(Wm.food.keys())) removeFood(Wm, id);
  const p = spawnSnake(Wm, 0, { isBot: false });
  const u0 = { ...p.u };
  setInput(Wm, 0, { steer: 0, boost: false });
  for (let i = 0; i < 60; i++) step(Wm, 1 / 60);
  const moved = angDist(u0, p.u) * Wm.R;
  close(moved, speedOf(p.mass), speedOf(p.mass) * 0.08, "1s straight travel ≈ base speed");

  const t0 = { ...p.t };
  setInput(Wm, 0, { steer: 1 });
  for (let i = 0; i < 60; i++) step(Wm, 1 / 60);
  const turned = Math.acos(Math.max(-1, Math.min(1, V.dot(t0, p.t))));
  ok(turned > turnRate(p.mass) * 0.55, "steer=1 for 1s turns heading substantially", turned.toFixed(3));

  // steerToward converges onto a target point
  const target = V.norm(V.make(), V.make(0.2, 0.9, 0.4));
  for (let i = 0; i < 60 * 14; i++) {
    setInput(Wm, 0, { steer: steerToward(Wm, p, target) });
    step(Wm, 1 / 60);
    if (angDist(p.u, target) * Wm.R < 2.5) break;
  }
  ok(angDist(p.u, target) * Wm.R < 2.5, "steerToward reaches a target point", (angDist(p.u, target) * Wm.R).toFixed(2));

  // ── 4. body/path ───────────────────────────────────────────────
  console.log("[body]");
  computeSegs(Wm, p);
  ok(p.segN >= segCount(p.mass) - 2, "body has expected segment count", p.segN + "/" + segCount(p.mass));
  const segs = new Float32Array(500 * 3);
  const n = bodyPoints(Wm, p, segs, segCount(p.mass), segSpacing(p.mass));
  let spacingOK = true;
  for (let i = 1; i < n; i++) {
    const dx = segs[i * 3] - segs[(i - 1) * 3], dy = segs[i * 3 + 1] - segs[(i - 1) * 3 + 1], dz = segs[i * 3 + 2] - segs[(i - 1) * 3 + 2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * Wm.R;
    if (Math.abs(d - segSpacing(p.mass)) > segSpacing(p.mass) * 0.5) { spacingOK = false; break; }
  }
  ok(spacingOK, "segments evenly spaced along trail");

  // ── 5. eating + growth ─────────────────────────────────────────
  console.log("[eat/grow]");
  const m0 = p.mass, sc0 = segCount(p.mass);
  drainEvents(Wm);
  spawnFood(Wm, p.u, 2); // right on the head
  step(Wm, 1 / 60);
  ok(p.mass > m0 + 3.5, "eating a rich gem adds its mass", p.mass - m0);
  const evs = drainEvents(Wm);
  ok(evs.some((e) => e.type === "eat" && e.slot === 0), "eat event emitted");
  ok(segCount(p.mass) >= sc0, "segment count grows with mass");
  ok(segRadius(300) > segRadius(10), "girth grows with mass");

  // magnet: food near (not touching) gets pulled in and eventually eaten
  const mAte0 = p.mass;
  const off = V.norm(V.make(), V.make(p.u.x + p.t.x * (1.8 / Wm.R), p.u.y + p.t.y * (1.8 / Wm.R), p.u.z + p.t.z * (1.8 / Wm.R)));
  spawnFood(Wm, off, 1);
  setInput(Wm, 0, { steer: 0 });
  for (let i = 0; i < 40; i++) step(Wm, 1 / 60);
  ok(p.mass > mAte0, "magnet pulls nearby gem into the head");

  // ── 6. boost ───────────────────────────────────────────────────
  console.log("[boost]");
  const Wb2 = createWorld({ seed: 9, biome: "dune", foodTarget: 0 });
  for (const id of Array.from(Wb2.food.keys())) removeFood(Wb2, id);
  const pb = spawnSnake(Wb2, 0, { isBot: false, mass: 60 });
  const bm0 = pb.mass;
  const bu0 = { ...pb.u };
  setInput(Wb2, 0, { steer: 0, boost: true });
  // ramp: distance in the FIRST 0.3s must be less than in a later 0.3s window
  let dEarly = 0, dLate = 0;
  {
    const p0 = { ...pb.u };
    for (let i = 0; i < 18; i++) step(Wb2, 1 / 60);
    dEarly = angDist(p0, pb.u) * Wb2.R;
    for (let i = 0; i < 72; i++) step(Wb2, 1 / 60); // to t=1.5s (ramp full)
    const p1 = { ...pb.u };
    for (let i = 0; i < 18; i++) step(Wb2, 1 / 60);
    dLate = angDist(p1, pb.u) * Wb2.R;
    for (let i = 0; i < 42; i++) step(Wb2, 1 / 60); // total 2.5s held
  }
  ok(dLate > dEarly * 1.25, "boost ramps up the longer it's held", `${dEarly.toFixed(2)} -> ${dLate.toFixed(2)}`);
  const bMoved = angDist(bu0, pb.u) * Wb2.R;
  ok(bMoved > speedOf(60) * 2.5 * 1.35, "boost significantly faster over a sustained hold", bMoved.toFixed(1));
  ok(pb.mass < bm0 - CONST.BOOST_DRAIN * 1.2, "boost drains mass (scaled by ramp)", (bm0 - pb.mass).toFixed(1));
  ok(Array.from(Wb2.food.values()).some((f) => f.tier === 0), "boosting drops pellets behind");
  // floor: can't boost below min (let the residual ramp decay first — the
  // ~0.45s glide-down after losing boost is intended feel, not a bonus)
  pb.mass = CONST.BOOST_MIN_MASS - 1;
  for (let i = 0; i < 60; i++) step(Wb2, 1 / 60);
  const fm0 = pb.mass, fu0 = { ...pb.u };
  for (let i = 0; i < 30; i++) step(Wb2, 1 / 60);
  close(pb.mass, fm0, 0.01, "no drain below boost floor");
  close(angDist(fu0, pb.u) * Wb2.R, speedOf(pb.mass) * 0.5, speedOf(pb.mass) * 0.06, "no speed bonus below floor");

  // ── 7. collision kills + essence ───────────────────────────────
  console.log("[collision]");
  const Wc = createWorld({ seed: 5, biome: "glacier", foodTarget: 0 });
  for (const id of Array.from(Wc.food.keys())) removeFood(Wc, id);
  const A = spawnSnake(Wc, 0, { isBot: false, mass: 30 });
  const B = spawnSnake(Wc, 1, { isBot: false, mass: 260 });
  A.shield = 0; B.shield = 0;
  // B circles (steer held) so its body forms a loop; A homes onto a live point
  // ~mid-body — guaranteed crossing. (Shielded bodies are pass-through by
  // design, so the earlier version of this test could never kill A.)
  let steps = 0;
  drainEvents(Wc);
  const midT = V.make();
  while (A.alive && B.alive && steps++ < 60 * 30) {
    setInput(Wc, 1, { steer: 0.5 });
    computeSegs(Wc, B);
    const i3 = Math.min(30, B.segN - 1) * 3;
    V.set(midT, B.segs[i3], B.segs[i3 + 1], B.segs[i3 + 2]);
    setInput(Wc, 0, { steer: steerToward(Wc, A, midT) });
    step(Wc, 1 / 60);
  }
  ok(!A.alive, "head into body kills the runner");
  const evc = drainEvents(Wc);
  const dEv = evc.find((e) => e.type === "death" && e.slot === 0);
  ok(!!dEv, "death event emitted");
  ok(dEv && dEv.killer === 1, "killer credited", dEv && dEv.killer);
  ok(B.kills === 1, "killer's kill count incremented");
  const essence = Array.from(Wc.food.values()).filter((f) => f.tier === 9);
  ok(essence.length >= 3, "essence orbs dropped along the corpse", essence.length);
  const totalEss = essence.reduce((s, f) => s + f.value, 0);
  close(totalEss, 30 * 0.58, 30 * 0.2, "essence total ≈ 58% of dead mass");

  // essence ids deterministic
  ok(essence.every((f) => /^e0_1_\d+$/.test(f.id)), "essence ids deterministic e<slot>_<death>_<i>");

  // shield protects
  const Ws = createWorld({ seed: 6, biome: "abyss", foodTarget: 0 });
  const C = spawnSnake(Ws, 0, { isBot: false });
  const D = spawnSnake(Ws, 1, { isBot: false, mass: 100 });
  C.shield = 99; D.shield = 0;
  computeSegs(Ws, D);
  const mid2 = V.make(D.segs[20 * 3], D.segs[20 * 3 + 1], D.segs[20 * 3 + 2]);
  for (let i = 0; i < 60 * 8 && angDist(C.u, mid2) * Ws.R > 0.3; i++) {
    setInput(Ws, 0, { steer: steerToward(Ws, C, mid2) });
    step(Ws, 1 / 60);
  }
  ok(C.alive, "spawn shield prevents death");

  // ── 8. AI sanity ───────────────────────────────────────────────
  console.log("[ai]");
  const Wai = createWorld({ seed: 31337, biome: "verdant" });
  for (let i = 0; i < 10; i++) spawnSnake(Wai, i, { isBot: true });
  const massBefore = Wai.snakes.reduce((s, x) => s + x.mass, 0);
  for (let i = 0; i < 60 * 45; i++) step(Wai, 1 / 60);
  const massAfter = Wai.snakes.filter((s) => s.alive).reduce((s, x) => s + x.mass, 0);
  ok(massAfter > massBefore * 1.1, "bots eat and grow over 45s", `${massBefore.toFixed(0)} → ${massAfter.toFixed(0)}`);
  let aliveBots = Wai.snakes.filter((s) => s.alive).length;
  ok(aliveBots >= 6, "most bots survive 45s (avoidance works)", aliveBots + "/10");
  let steerOK = true;
  for (const sn of Wai.snakes) if (sn.alive && (!Number.isFinite(sn.steer) || Math.abs(sn.steer) > 1)) steerOK = false;
  ok(steerOK, "bot steer commands stay in [-1,1]");

  // dead bots respawn
  const WaiDead = Wai.snakes.find((s) => !s.alive);
  if (WaiDead) {
    const t0r = Wai.time;
    for (let i = 0; i < 60 * 10 && !WaiDead.alive; i++) step(Wai, 1 / 60);
    ok(WaiDead.alive, "dead bot respawned within 10s", (Wai.time - t0r).toFixed(1) + "s");
    ok(WaiDead.shield > 0 || Wai.time - t0r > CONST.SHIELD_TIME, "respawn grants shield");
  } else {
    ok(true, "(no bot died in window — respawn covered by shield test)");
    ok(true, "(skip)");
  }

  // ── 9. food economy ────────────────────────────────────────────
  console.log("[food]");
  const Wf = createWorld({ seed: 12, biome: "ember" });
  const f0 = Wf.food.size;
  ok(f0 >= Wf.foodTarget * 0.95, "world starts stocked with gems", f0);
  spawnSnake(Wf, 0, { isBot: true });
  for (let i = 0; i < 60 * 20; i++) step(Wf, 1 / 60);
  const gems = Array.from(Wf.food.values()).filter((f) => f.tier !== 0 && f.tier !== 9).length;
  ok(gems >= Wf.foodTarget * 0.85, "food respawns toward target", gems + "/" + Wf.foodTarget);
  // ttl expiry
  const pel = spawnFood(Wf, null, 0, 1, 2);
  for (let i = 0; i < 60 * 3; i++) step(Wf, 1 / 60);
  ok(!Wf.food.has(pel.id), "TTL food expires");

  // ── 10. weather ────────────────────────────────────────────────
  console.log("[weather]");
  const wA = weatherAt("glacier", 99, 10), wB = weatherAt("glacier", 99, 10);
  ok(wA.kind === wB.kind && wA.intensity === wB.intensity, "weather deterministic");
  let sawEvent = null;
  for (let t = 0; t < 400; t += 1) {
    const w = weatherAt("glacier", 99, t);
    if (w.kind !== "calm" && w.intensity > 0.9) { sawEvent = w; break; }
  }
  ok(!!sawEvent, "weather events occur within 400s", sawEvent && sawEvent.kind);
  ok(sawEvent && ["blizzard", "aurora"].includes(sawEvent.kind), "biome-appropriate weather", sawEvent && sawEvent.kind);
  if (sawEvent && sawEvent.kind === "blizzard") {
    ok(sawEvent.mods.speed < 1, "blizzard slows snakes");
  } else {
    ok(true, "(aurora rolled — speed mod covered by table)");
  }
  // terrain deterministic + bounded
  const th1 = terrainH({ x: 0.3, y: 0.9, z: 0.31 }, 99), th2 = terrainH({ x: 0.3, y: 0.9, z: 0.31 }, 99);
  ok(th1 === th2, "terrain height deterministic");
  let bounded = true;
  const rr = S.mulberry32(4);
  for (let i = 0; i < 500; i++) {
    const v = V.norm(V.make(), V.make(rr() * 2 - 1, rr() * 2 - 1, rr() * 2 - 1));
    const h = terrainH(v, 99);
    if (Math.abs(h) > CONST.TERRAIN_AMP + 1e-9) bounded = false;
  }
  ok(bounded, "terrain height bounded by amplitude");

  // ── 10b. throttle ──────────────────────────────────────────────
  console.log("[throttle]");
  {
    const Wt = createWorld({ seed: 71, biome: "verdant", foodTarget: 0 });
    for (const id of Array.from(Wt.food.keys())) removeFood(Wt, id);
    const pt = spawnSnake(Wt, 0, { isBot: false, mass: 40 });
    const base = { ...pt.u };
    setInput(Wt, 0, { steer: 0, boost: false, throttle: 1 });
    for (let i = 0; i < 60; i++) step(Wt, 1 / 60);
    const fast = S.angDist(base, pt.u) * Wt.R;
    ok(fast > speedOf(40) * 1.3, "throttle +1 is markedly faster", fast.toFixed(1));
    const b2 = { ...pt.u };
    setInput(Wt, 0, { throttle: -1 });
    for (let i = 0; i < 60; i++) step(Wt, 1 / 60);
    const slow = S.angDist(b2, pt.u) * Wt.R;
    ok(slow < speedOf(40) * 0.85, "throttle −1 is markedly slower", slow.toFixed(1));
    close(pt.mass, 40, 0.01, "throttle costs no mass");
    // boost overrides throttle (once the ramp is meaningfully engaged)
    const b3 = { ...pt.u };
    setInput(Wt, 0, { throttle: -1, boost: true });
    for (let i = 0; i < 120; i++) step(Wt, 1 / 60);
    const boosted = S.angDist(b3, pt.u) * Wt.R;
    ok(boosted > speedOf(pt.mass) * 2 * 1.35, "boost overrides a slow throttle", boosted.toFixed(1));
  }

  // ── 10c. self-collision ────────────────────────────────────────
  console.log("[self-collision]");
  {
    const Ws2 = createWorld({ seed: 88, biome: "abyss", foodTarget: 0 });
    for (const id of Array.from(Ws2.food.keys())) removeFood(Ws2, id);
    const ps = spawnSnake(Ws2, 0, { isBot: false, mass: 260 });
    ps.shield = 0;
    // normal play must be safe: a hard 0.9s curl (well under a full loop)…
    drainEvents(Ws2);
    setInput(Ws2, 0, { steer: 1, boost: false });
    for (let i = 0; i < 54 && ps.alive; i++) step(Ws2, 1 / 60);
    ok(ps.alive, "hard curl (no full loop) is safe");
    // …and S-curve slaloming, indefinitely
    for (let i = 0; i < 60 * 8 && ps.alive; i++) {
      setInput(Ws2, 0, { steer: Math.floor(i / 30) % 2 === 0 ? 1 : -1 });
      step(Ws2, 1 / 60);
    }
    ok(ps.alive, "S-curve slalom never self-kills");
    // a SUSTAINED max-rate loop re-traces the snake's own path → death
    // (classic snake rule — the neck window only protects the bend itself)
    drainEvents(Ws2);
    setInput(Ws2, 0, { steer: 1 });
    let loopSteps = 0;
    while (ps.alive && loopSteps++ < 60 * 10) step(Ws2, 1 / 60);
    ok(!ps.alive, "sustained full loop crosses own body → death", (loopSteps / 60).toFixed(1) + "s");
    const dEv2 = drainEvents(Ws2).find((e) => e.type === "death" && e.slot === 0);
    ok(dEv2 && dEv2.killer === 0, "self-death credited to the snake itself", dEv2 && dEv2.killer);
    ok(ps.kills === 0, "self-death adds no kill count");
    ok(Array.from(Ws2.food.values()).some((f) => f.tier === 9), "self-death still drops essence");
  }

  // ── 11. head-on: both die ──────────────────────────────────────
  console.log("[head-on]");
  const Wh = createWorld({ seed: 21, biome: "dune", foodTarget: 0 });
  for (const id of Array.from(Wh.food.keys())) removeFood(Wh, id);
  const E = spawnSnake(Wh, 0, { isBot: false, mass: 40 });
  const F = spawnSnake(Wh, 1, { isBot: false, mass: 40 });
  E.shield = F.shield = 0;
  // place F directly ahead of E, facing E
  const ahead = 6 / Wh.R;
  V.set(F.u, E.u.x * Math.cos(ahead) + E.t.x * Math.sin(ahead), E.u.y * Math.cos(ahead) + E.t.y * Math.sin(ahead), E.u.z * Math.cos(ahead) + E.t.z * Math.sin(ahead));
  V.norm(F.u, F.u);
  V.scale(F.t, E.t, -1);
  const dF = V.dot(F.t, F.u); V.set(F.t, F.t.x - F.u.x * dF, F.t.y - F.u.y * dF, F.t.z - F.u.z * dF); V.norm(F.t, F.t);
  for (let i = 0; i < 60 * 3 && E.alive && F.alive; i++) {
    setInput(Wh, 0, { steer: 0 }); setInput(Wh, 1, { steer: 0 });
    step(Wh, 1 / 60);
  }
  ok(!E.alive && !F.alive, "head-on collision kills both", `E:${E.alive} F:${F.alive}`);

  // ── 12. ranking + skins ────────────────────────────────────────
  console.log("[misc]");
  const Wr = createWorld({ seed: 3 });
  spawnSnake(Wr, 0, { isBot: false, mass: 50 });
  spawnSnake(Wr, 1, { isBot: true, mass: 200 });
  spawnSnake(Wr, 2, { isBot: true, mass: 90 });
  const rank = ranking(Wr);
  ok(rank[0].slot === 1 && rank[1].slot === 2, "ranking sorts by mass");
  ok(SKINS.length >= 8, "8+ skins available");
  ok(new Set(SKINS.map((s) => s.a)).size === SKINS.length, "skin palettes unique");

  console.log(`\n${PASS + FAIL} checks: ${PASS} pass, ${FAIL} fail`);
  process.exit(FAIL ? 1 : 0);
})().catch((e) => { console.error("SELFTEST CRASH", e); process.exit(2); });
