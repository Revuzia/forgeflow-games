#!/usr/bin/env node
/* core/ai/ai.selftest.cjs [A5] — Node probe battery (BUILD_PLAN Part 2 §A5).
 * Folds in combat_spec §8.1 probe_fairness (30 seeds: zero pre-reaction
 * shots, latched rolls, token caps, zero muzzle-blocked pulls, blow-counted
 * bursts) + probe_engagement_ends (referee 40 s flank / 75 s push, no
 * episode >90 s, passivity punished), plus: nav bake gates (<150 ms,
 * ≤160×160, 44-spawn + 15-node reachability incl. the stair-connected
 * arcade-upper/tram-deck floors), perception unit formulas, night light
 * factor + muzzle-flash reveal, hearing-≤0.85 cap, grenade telegraph
 * (bark 1.2 s pre-release ±1 tick, ≤1 live, 20 s squad cooldown), flinch
 * σ injection, retreat/last-stand, ≤4 brains/tick + AI CPU ≤1.5 ms,
 * determinism, and a full child-process run of A1's sim.selftest.cjs
 * (cross-lane integration: the real AI now runs inside their battery).
 *
 * Run:  node core/ai/ai.selftest.cjs            → full battery
 *       node core/ai/ai.selftest.cjs --fast     → skips the sim.selftest child run
 * Exit 0 = all pass. Exit 1 = failures (each printed FAIL, verbatim).
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { spawnSync } = require("child_process");

const AI_DIR = __dirname;
const GAME_DIR = path.resolve(AI_DIR, "..", "..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;

let passed = 0, failed = 0, skipped = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  PASS  " + msg); }
  else { failed++; console.error("  FAIL  " + msg); }
}
function skip(msg) { skipped++; console.log("  SKIP  " + msg); }
function approx(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-6 : eps); }
function section(name) { console.log("\n== " + name + " =="); }
function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

const CMD0 = {
  moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jump: false, crouch: false,
  sprint: false, fire: false, ads: false, reload: false, switchTo: null,
  interact: false, grenade: false,
};
function cmd(over) { return Object.assign({}, CMD0, over); }
function mkBox(x0, x1, y0, y1, z0, z1, surface, matClass) {
  return {
    min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
    max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
    surface: surface || "concrete", matClass: matClass || "hard",
  };
}
function customColliders(boxes, playerPos, cover, boundsHalf) {
  const bh = boundsHalf || 40;
  return {
    boxes: boxes || [],
    groundY: () => 0,
    spawns: { player: playerPos.slice(), playerYaw: 0 },
    cover: cover || [],
    nodes: {},
    bounds: { min: [-bh, -2, -bh], max: [bh, 10, bh] },
  };
}

async function main() {
  const fast = process.argv.includes("--fast");

  const S = await import(u("core/sim/sim.js"));
  const NAV = await import(u("core/ai/nav.js"));
  const PER = await import(u("core/ai/perception.js"));
  const FSM = await import(u("core/ai/botfsm.js"));
  const COL = await import(u("core/level/colliders.js"));
  const WD = await import(u("core/weapons/weapon_data.js"));
  const content = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));
  const WEAPONS = WD.WEAPONS;
  const BANDS = FSM.BANDS;
  const colliders = COL.buildColliders(1);

  const ALLOWED_EVENTS = new Set([
    "mission:start", "mission:phase", "mission:end", "objective", "shot",
    "hurt", "death", "spawn", "reload", "switch", "ads", "step", "land",
    "botstate", "bark", "empty", "explosion", "grenade", "whiz", "zone",
  ]);

  // ================================================================ formulas
  section("perception formulas (combat_spec §5.1 exact)");
  {
    ok(approx(PER.detectRange(1, false), 80), "detectRange(light 1) = 80 m");
    ok(approx(PER.detectRange(0, false), 18), "detectRange(light 0) = 18 m floor");
    ok(approx(PER.detectRange(0.5, true), (18 + 31) * 1.2), "alert state ×1.2 (R17)");
    ok(approx(PER.lightFactor(0), 0.30) && approx(PER.lightFactor(1), 1.0), "lightFactor = 0.30 + 0.70·L");
    ok(PER.facingFactor(0, 50) === 1.0, "facing 1.0 inside the 110° cone");
    ok(PER.facingFactor(1.2, 10) === 0.35, "facing 0.35 in 110–160° periphery ≤12 m");
    ok(PER.facingFactor(1.2, 20) === 0, "periphery beyond 12 m = 0");
    ok(PER.facingFactor(2.5, 5) === 0, "behind = 0");
    // §5.9 arc solver: v0=16, g=−20
    const from = [0, 1.5, 0];
    const th = FSM.solveArcPitch(from, [9, 0, 0], 16);
    ok(th != null, "arc solvable at 9 m");
    if (th != null) {
      const t = 9 / (16 * Math.cos(th));
      const y = 1.5 + 16 * Math.sin(th) * t - 10 * t * t;
      ok(Math.abs(y - 0) <= 0.08, `arc lands at target height (y=${y.toFixed(3)})`);
    }
    ok(FSM.solveArcPitch(from, [20, 0, 0], 16) == null, "20 m flat is out of throwing range (v²/g = 12.8 m)");
  }

  // ================================================================ nav
  section("nav bake — grid ≤160×160, <150 ms, stairs connect all levels");
  let nav;
  {
    const nav1 = NAV.bakeNav(colliders);
    const nav2 = NAV.bakeNav(colliders);
    nav = nav1;
    ok(nav.stats.nx <= 160 && nav.stats.nz <= 160, `grid ${nav.stats.nx}×${nav.stats.nz} ≤ 160×160`);
    ok(nav.stats.bakeMs < 150, `bake ${nav.stats.bakeMs.toFixed(1)} ms < 150 ms budget`);
    ok(nav1._hash() === nav2._hash(), "bake deterministic (two bakes → identical fingerprint)");
    console.log(`  info  ${nav.stats.nodes} floor nodes, ${nav.stats.walkable} walkable, cell ${nav.stats.cell.toFixed(2)} m`);

    const nodes = colliders.nodes;
    let unreach = [];
    for (const k of Object.keys(nodes)) {
      if (!nav.reachable(nodes.dock_spawn, nodes[k])) unreach.push(k);
    }
    ok(unreach.length === 0, "all 15 R24 nodes reachable from dock_spawn (incl. arcade_upper y4.2 + platform_deck y4.5 via 0.3 m stair runs)" +
      (unreach.length ? " — UNREACHABLE: " + unreach.join(",") : ""));

    let badSpawns = [];
    for (const w of content.mission.spawns.waves) {
      for (const sp of w.bots) {
        if (!nav.onNav(sp.pos, 1.2) || !nav.reachable(nodes.dock_spawn, sp.pos)) badSpawns.push(sp.id);
      }
    }
    ok(badSpawns.length === 0, "all 44 wave spawns on walkable nav + reachable" +
      (badSpawns.length ? " — BAD: " + badSpawns.join(",") : ""));

    const p1 = nav.findPath(nodes.dock_spawn, nodes.exfil);
    ok(!!p1 && p1.length >= 2, `findPath dock_spawn → exfil (${p1 ? p1.length : 0} waypoints)`);
    const p2 = nav.findPath(nodes.plaza_center, nodes.arcade_upper);
    ok(!!p2 && Math.abs(p2[p2.length - 1][1] - 4.2) < 0.6, "findPath plaza_center → arcade_upper climbs to y≈4.2");
    const rp = nav.randomPoint(nodes.plaza_center, 8, () => 0.42);
    ok(Math.hypot(rp[0] - nodes.plaza_center[0], rp[2] - nodes.plaza_center[2]) <= 8.01, "randomPoint stays within r");
    // light bake sanity: customs floods ≫ dark boulevard gap; all in [0,1]
    const lCustoms = nav.lightAt(0, -50);       // inside poi_customs (base 0.65)
    const lFlood = nav.lightAt(-11, -37);       // L_FLOOD_W aim point
    const lDark = nav.lightAt(37, -16);         // boulevard between sodium pools
    ok(lCustoms > 0.5, `customs yard bright (light ${lCustoms.toFixed(2)})`);
    ok(lFlood > 0.6, `flood aim-point pool bright (light ${lFlood.toFixed(2)})`);
    ok(lDark < 0.35, `boulevard between pools dark (light ${lDark.toFixed(2)})`);
    ok(lCustoms <= 1 && lFlood <= 1 && lDark >= 0, "light values clamped to [0,1]");
  }

  // helper: scenario sim on the real map
  function plazaSim(seed, emitCb) {
    const sim = S.createSim({
      content, colliders, nav, weapons: WEAPONS, seed,
      emit: emitCb || (() => {}),
    });
    return sim;
  }
  function botById(sim, id) { return sim.state.bots.find((b) => b.id === id); }

  // ================================================================ gate
  section("phase gate + noTarget (protects A1's phase-'menu' probes)");
  {
    const events = [];
    const sim = plazaSim(11, (type, data) => events.push({ type, data }));
    sim.teleport("P", -5, 0, 0);
    const id = sim.spawnBotFromSpec({ archetype: "rifleman", band: "veteran", squad: "sq1", pos: [-5, 0, -8], yaw: 0, alerted: true });
    const b = botById(sim, id);
    for (let i = 0; i < 180; i++) sim.step(cmd({}));
    ok(b.cmd == null && b.pos[0] === -5 && b.pos[2] === -8, "phase 'menu' → AI fully dormant (no cmd, no movement)");
    ok(!events.some((e) => e.type === "shot"), "phase 'menu' → zero shots");

    sim.state.phase = "assault";
    sim.setNoTarget(true);
    sim.setGod(true);
    for (let i = 0; i < 300; i++) sim.step(cmd({}));
    ok(b.percept == null || b.percept.awareness < 0.05, "noTarget → zero awareness at 8 m");
    ok(!events.some((e) => e.type === "shot"), "noTarget → zero shots");
  }

  // ================================================================ perception
  section("night light factor + muzzle-flash reveal + hearing cap 0.85");
  {
    // 40 m duel down the boulevard center lane: dark player is invisible,
    // firing reveals (flash = light 1.0 for 1.2 s)
    const mkDuel = (fire) => {
      const sim = plazaSim(21);
      sim.setGod(true);
      sim.state.phase = "assault";
      sim.teleport("P", 37, 0, 24); // south boulevard, between pools
      const id = sim.spawnBotFromSpec({ archetype: "rifleman", band: "regular", squad: "sqD", pos: [37, 0, -16], yaw: Math.PI, alerted: false });
      for (let i = 0; i < 240; i++) {
        const c = cmd({ yaw: Math.PI, pitch: 1.2 });
        if (fire && i === 60) c.fire = true;
        sim.step(c);
      }
      return botById(sim, id);
    };
    const noFire = mkDuel(false), fired = mkDuel(true);
    const awN = noFire.percept ? noFire.percept.awareness : 0;
    const awF = fired.percept ? fired.percept.awareness : 0;
    ok(awF > awN + 0.2, `muzzle flash reveals at 40 m in the dark (aw ${awF.toFixed(2)} vs ${awN.toFixed(2)} unfired)`);

    // hearing-only: player sprints behind a LONG wall — audible (steps 14 m),
    // never visible. Awareness caps at 0.85; the bot investigates but can
    // never confirm/fire without sight (or being hit).
    const wallCC = customColliders([mkBox(-35, 35, 0, 3, 0, 0.4)], [0, 0, 6], [], 40);
    const wallNav = NAV.bakeNav(wallCC);
    const events = [];
    let simW = null;
    const sim = S.createSim({
      colliders: wallCC, nav: wallNav, weapons: WEAPONS, seed: 22,
      emit: (t2, d) => events.push({ type: t2, data: d }),
    });
    simW = sim; void simW;
    sim.setGod(true);
    sim.state.phase = "assault";
    const id = sim.spawnBotFromSpec({ archetype: "rifleman", band: "veteran", squad: "sqH", pos: [0, 0, -4], yaw: 0, alerted: false });
    const b = botById(sim, id);
    let awMax = 0, everCombat = false, everSuspicious = false;
    for (let i = 0; i < 420; i++) {
      // sprint east 1 s, west 1 s along z=6 (10–12 m from the bot, walled off)
      sim.step(cmd({ moveZ: 1, sprint: true, yaw: (Math.floor(i / 60) % 2 === 0) ? Math.PI / 2 : -Math.PI / 2 }));
      if (b.percept) awMax = Math.max(awMax, b.percept.awareness);
      if (b.state === "combat") everCombat = true;
      if (b.state === "suspicious") everSuspicious = true;
    }
    ok(awMax <= 0.851, `heard-only awareness caps at 0.85 (max ${awMax.toFixed(3)})`);
    ok(awMax >= 0.5, `sprint footsteps heard through the night (max aw ${awMax.toFixed(2)})`);
    ok(!everCombat, "hearing never confirms (no COMBAT without sight or being hit)");
    ok(everSuspicious, "bot investigates the noise (reached 'suspicious')");
    ok(!events.some((e) => e.type === "shot" && e.data.shooter !== "P"), "zero shots from a heard-only stimulus");
  }

  // ================================================================ grenade
  section("probe_grenade (bot side) — bark 1.2 s pre-release ±1 tick, ≤1 live, 20 s squad cooldown");
  {
    const wall = mkBox(-4, 4, 0, 1.6, 1.5, 1.9, "concrete", "hard");
    const cc = customColliders([wall], [8, 0, 6], [{ pos: [0, 0, -2.6], dir: [0, 0, 1], height: "low" }], 30);
    const cnav = NAV.bakeNav(cc);
    const events = [];
    const sim = S.createSim({
      colliders: cc, nav: cnav, weapons: WEAPONS, seed: 31,
      emit: (type, data) => events.push({ t: sim.state.time, type, data }),
    });
    sim.setGod(true);
    sim.state.phase = "assault";
    const yawToPlayer = Math.atan2(-(8 - 0), -(6 - (-3.2)));
    const id1 = sim.spawnBotFromSpec({ archetype: "rifleman", band: "regular", squad: "sqG", pos: [0, 0, -3.2], yaw: yawToPlayer, alerted: true });
    const id2 = sim.spawnBotFromSpec({ archetype: "rifleman", band: "regular", squad: "sqG", pos: [-6, 0, -3.2], yaw: yawToPlayer, alerted: true });
    void id1; void id2;
    const T = (s) => Math.round(s * 60);
    for (let i = 0; i < T(34); i++) {
      const c = cmd({ yaw: 0, pitch: 1.2 });
      if (i === T(1.0)) c.fire = true; // flash → confirm
      sim.step(c);
      if (i === T(2.5)) { sim.teleport("P", 0, 0, 6); }
      if (i > T(2.5)) c.crouch = true;
    }
    const barks = events.filter((e) => e.type === "bark" && e.data.kind === "grenade");
    const outs = events.filter((e) => e.type === "grenade" && e.data.phase === "out");
    const boom = events.filter((e) => e.type === "explosion");
    ok(outs.length >= 1, `bot threw a grenade (${outs.length} outs in 34 s)`);
    if (outs.length >= 1 && barks.length >= 1) {
      // the bark that telegraphs the FIRST out
      const out0 = outs[0];
      const pre = barks.filter((b2) => b2.t <= out0.t);
      const bark0 = pre[pre.length - 1];
      const dtTele = out0.t - bark0.t;
      ok(Math.abs(dtTele - 1.2) <= 0.034, `bark precedes release by 1.2 s ± 1 tick (measured ${dtTele.toFixed(3)} s)`);
    } else if (outs.length >= 1) {
      ok(false, "grenade out without a telegraph bark");
    }
    if (outs.length >= 2) {
      ok(outs[1].t - outs[0].t >= 20 - 0.05, `squad cooldown 20 s honored (gap ${(outs[1].t - outs[0].t).toFixed(1)} s)`);
    } else skip("only one grenade thrown in the window — cooldown gap trivially honored");
    // ≤1 live at any time: outs and detonations must strictly alternate
    let live = 0, everTwo = false;
    for (const e of events) {
      if (e.type === "grenade" && e.data.phase === "out") { live++; if (live > 1) everTwo = true; }
      if (e.type === "grenade" && e.data.phase === "detonate") live--;
    }
    ok(!everTwo, "≤1 live grenade mission-wide");
    ok(boom.length >= 1 && Math.abs(boom[0].t - outs[0].t - 3.8) <= 0.05,
      `3.8 s fuse from release (detonated ${(boom.length ? boom[0].t - outs[0].t : -1).toFixed(2)} s after out)`);
  }

  // ================================================================ flinch
  section("flinch §3.4 — being shot degrades bot aim (σ grows for 0.35 s, stacks ≤2)");
  {
    FSM.AI_PROBE.enabled = true;
    FSM.AI_PROBE.jitter.length = 0;
    const events = [];
    const sim = plazaSim(41, (type, data) => events.push({ t: sim.state.time, type, data }));
    sim.setGod(true);
    sim.state.phase = "assault";
    sim.teleport("P", 37, 0, 10); // boulevard center lane — guaranteed LOS
    const id = sim.spawnBotFromSpec({ archetype: "rifleman", band: "regular", squad: "sqF", pos: [37, 0, -4], yaw: Math.PI, alerted: true });
    const b = botById(sim, id);
    let hitAtT = -1;
    for (let i = 0; i < 1200; i++) {
      sim.step(cmd({ yaw: Math.PI, pitch: 1.2, fire: i === 30 }));
      const t = sim.state.time;
      if (hitAtT < 0 && b._brain && b._brain.burstLeft >= 2 && t - (b.weapon.lastShotT ?? -9) < 0.05) {
        sim.damage(id, 8); sim.damage(id, 8); // 2 flinch stacks
        hitAtT = t;
      }
      if (hitAtT > 0 && t > hitAtT + 1.0) break;
    }
    ok(hitAtT > 0, "bot engaged and was mid-burst when hit");
    const band = BANDS.regular;
    const during = FSM.AI_PROBE.jitter.filter((j) => j.sigma > band.jitter + 0.012);
    ok(during.length >= 1, `σ grew under flinch (${during.length} inflated samples; base ${band.jitter})`);
    FSM.AI_PROBE.enabled = false;
  }

  // ================================================================ retreat
  section("retreat §5.3 — hp<35 + squad ≥2 + rolled 0.6 latched; regen; last-stand");
  {
    let retreats = 0;
    const SEEDS = 12;
    let regenOk = true, returnOk = true, checked = 0;
    for (let seed = 100; seed < 100 + SEEDS; seed++) {
      const sim = plazaSim(seed);
      sim.setGod(true);
      sim.state.phase = "assault";
      sim.teleport("P", -5, 0, 0);
      const ids = [
        sim.spawnBotFromSpec({ archetype: "rifleman", band: "regular", squad: "sqR", pos: [-5, 0, -14], yaw: 0, alerted: true }),
        sim.spawnBotFromSpec({ archetype: "rifleman", band: "regular", squad: "sqR", pos: [0, 0, -12], yaw: 0, alerted: true }),
        sim.spawnBotFromSpec({ archetype: "rifleman", band: "regular", squad: "sqR", pos: [-10, 0, -12], yaw: 0, alerted: true }),
      ];
      for (let i = 0; i < 300; i++) sim.step(cmd({}));
      const b = botById(sim, ids[0]);
      sim.damage(ids[0], 100 - 30); // → 30 hp
      let sawRetreat = false, hpAtEnter = -1;
      for (let i = 0; i < 12 * 60; i++) {
        sim.step(cmd({}));
        if (b.state === "retreat" && !sawRetreat) { sawRetreat = true; hpAtEnter = b.hp; }
        if (sawRetreat && b.state === "combat") {
          checked++;
          if (b.hp < 69.9) returnOk = false;
          break;
        }
      }
      if (sawRetreat) {
        retreats++;
        if (b.hp <= hpAtEnter && b.state === "retreat") regenOk = false;
      }
    }
    ok(retreats >= 3 && retreats <= 11, `retreat rolled ~0.6 across ${SEEDS} seeds (${retreats} retreated — latched, not per-tick)`);
    ok(regenOk, "retreating bots regen (damage.js ×0.7 keyed on state 'retreat')");
    ok(checked === 0 || returnOk, `recovered bots return to COMBAT at ≥70 hp (${checked} observed)`);

    // last-stand: squad reduced to 1 → never retreats + 'lastman' bark
    // (boulevard center lane: all three have LOS; player fires once so the
    // squad is ENGAGED — referee active — before the squadmates die)
    const events = [];
    const sim = plazaSim(200, (type, data) => events.push({ type, data }));
    sim.setGod(true);
    sim.state.phase = "assault";
    sim.teleport("P", 37, 0, 10);
    const ids = [
      sim.spawnBotFromSpec({ archetype: "rifleman", band: "regular", squad: "sqL", pos: [37, 0, -4], yaw: Math.PI, alerted: true }),
      sim.spawnBotFromSpec({ archetype: "rifleman", band: "regular", squad: "sqL", pos: [34, 0, -8], yaw: Math.PI, alerted: true }),
      sim.spawnBotFromSpec({ archetype: "rifleman", band: "regular", squad: "sqL", pos: [40, 0, -8], yaw: Math.PI, alerted: true }),
    ];
    for (let i = 0; i < 300; i++) sim.step(cmd({ yaw: 0, pitch: 1.2, fire: i === 30 }));
    sim.damage(ids[1], 999); sim.damage(ids[2], 999);
    for (let i = 0; i < 60; i++) sim.step(cmd({}));
    sim.damage(ids[0], 100 - 30);
    const survivor = botById(sim, ids[0]);
    let retreated = false;
    for (let i = 0; i < 300; i++) { sim.step(cmd({})); if (survivor.state === "retreat") retreated = true; }
    ok(!retreated, "last man never retreats (aggression instead)");
    ok(events.some((e) => e.type === "bark" && e.data.kind === "lastman"), "'lastman' bark on squad reduced to 1");
    ok(events.some((e) => e.type === "bark" && e.data.kind === "down"), "'down' bark on squadmate death with LOS to the body");
  }

  // ================================================================ fairness
  section("probe_fairness — 30 seeds (combat_spec §8.1, verbatim invariants)");
  {
    const V = { preReaction: 0, latch: 0, bandRange: 0, tokenCap: 0, window: 0, muzzle: 0, burstMax: 0, burstLog: 0 };
    const jitterByBand = { recruit: [], regular: [], hardened: [], veteran: [] };
    const burstSizes = { rifleman: new Set(), cqb: new Set(), marksman: new Set() };
    let totalBotShots = 0, totalConfirms = 0;
    const ARCHS = [
      { a: "rifleman", band: "recruit", squad: "sqA", pos: [-2, 0, -14] },
      { a: "cqb", band: "regular", squad: "sqA", pos: [8, 0, -8] },
      { a: "rifleman", band: "hardened", squad: "sqA", pos: [-14, 0, -6] },
      { a: "marksman", band: "regular", squad: "sqB", pos: [12, 0, 4] },
      // veteran σ needs a close stationary shooter: the cqb (band 8–18 m)
      // holds its spot and fires clean samples; the roaming marksman cannot
      { a: "cqb", band: "veteran", squad: "sqB", pos: [-8, 0, -16] },
    ];
    FSM.AI_PROBE.enabled = true;

    for (let seed = 1; seed <= 30; seed++) {
      FSM.AI_PROBE.jitter.length = 0;
      const botShots = [];
      let simRef = null;
      const sim = S.createSim({
        content, colliders, nav, weapons: WEAPONS, seed,
        emit: (type, data) => {
          if (type === "shot" && data.shooter !== "P" && !data.impactOnly && !data.pen) {
            const t = simRef.state.time;
            botShots.push({ t, shooter: data.shooter, origin: data.origin, dir: data.dir });
            const b = simRef.state.bots.find((x) => x.id === data.shooter);
            const br = b && b._brain;
            if (!br || br.confirmT < 0 || t < br.confirmT + br.reactionS - 1e-6) V.preReaction++;
            // muzzle-block re-verify from the event's own origin+dir
            const hit = simRef.world.raycast(data.origin, data.dir, 1.2);
            if (hit && hit.box && (hit.box.matClass || "hard") === "hard") V.muzzle++;
          }
        },
      });
      simRef = sim;
      sim.setGod(true);
      sim.state.phase = "assault";
      sim.teleport("P", -5, 0, 0);
      const ids = ARCHS.map((sp) => sim.spawnBotFromSpec({
        archetype: sp.a, band: sp.band, squad: sp.squad,
        pos: sp.pos.slice(), yaw: 0, alerted: true,
      }));
      const bots = ids.map((id) => botById(sim, id));

      const latch = new Map(); // botId:confirmT → Set(reactionS)
      for (let i = 0; i < 2400; i++) {
        const c = cmd({ yaw: 0, pitch: 1.2 });
        if (i === 30) c.fire = true; // flash: reveal + confirm everyone
        sim.step(c);
        // token caps per squad, every tick
        const dbg = sim.squad._debug();
        for (const k of Object.keys(dbg.tokens)) {
          if (dbg.tokens[k].fire.length > 2) V.tokenCap++;
        }
        // latched reaction sampling
        for (const b of bots) {
          const br = b._brain;
          if (!br || br.confirmT < 0) continue;
          const key = b.id + ":" + br.confirmT.toFixed(4);
          let set = latch.get(key);
          if (!set) { set = new Set(); latch.set(key, set); }
          set.add(br.reactionS);
          const band = BANDS[b.band];
          if (br.reactionS < band.reactMin - 1e-9 || br.reactionS > band.reactMax + 1e-9) V.bandRange++;
        }
      }
      for (const set of latch.values()) if (set.size !== 1) V.latch++;
      totalConfirms += latch.size;

      // ≤3 distinct attackers in any 250 ms window (fire-time shots)
      for (let i = 0; i < botShots.length; i++) {
        const w = new Set();
        for (let j = i; j >= 0 && botShots[i].t - botShots[j].t <= 0.25; j--) w.add(botShots[j].shooter);
        if (w.size > 3) V.window++;
      }
      totalBotShots += botShots.length;

      // event-derived bursts never exceed the archetype max
      const byShooter = new Map();
      for (const s2 of botShots) {
        if (!byShooter.has(s2.shooter)) byShooter.set(s2.shooter, []);
        byShooter.get(s2.shooter).push(s2.t);
      }
      const MAXB = { rifleman: 5, cqb: 8, marksman: 1, heavy: 8 };
      for (const [sid, ts] of byShooter) {
        const b = botById(sim, sid);
        const max = MAXB[b.archetype] || 8;
        let run = 1;
        for (let i = 1; i < ts.length; i++) {
          if (ts[i] - ts[i - 1] <= 0.30) run++;
          else run = 1;
          if (run > max) { V.burstMax++; break; }
        }
      }
      // completed rolled bursts within the archetype range
      const RANGE = { rifleman: [3, 5], cqb: [5, 8], marksman: [1, 1], heavy: [5, 8] };
      for (const b of bots) {
        const r = RANGE[b.archetype];
        for (const n of (b._brain ? b._brain.burstLog : [])) {
          if (n < r[0] || n > r[1]) V.burstLog++;
          if (burstSizes[b.archetype]) burstSizes[b.archetype].add(n);
        }
      }
      // jitter samples at clean multipliers (σ === band σ exactly)
      for (const j of FSM.AI_PROBE.jitter) {
        const band = BANDS[j.band];
        if (band && Math.abs(j.sigma - band.jitter) < 1e-12) {
          jitterByBand[j.band].push(j.y, j.p);
        }
      }
    }
    FSM.AI_PROBE.enabled = false;

    ok(totalBotShots > 500, `scenario live: ${totalBotShots} bot rounds over 30 seeds`);
    ok(V.preReaction === 0, `zero shots before the rolled reaction elapsed (${V.preReaction})`);
    ok(V.latch === 0, `reaction rolls LATCHED — re-read variance 0 across ${totalConfirms} confirms (${V.latch} violations)`);
    ok(V.bandRange === 0, `every reaction roll inside its band's range (${V.bandRange} violations)`);
    ok(V.tokenCap === 0, `≤2 fire tokens per squad on every tick (${V.tokenCap} violations)`);
    ok(V.window === 0, `≤3 distinct attackers in any 250 ms window (${V.window} violations)`);
    ok(V.muzzle === 0, `zero muzzle-blocked trigger pulls — hard occluder ≤1.2 m re-verified per shot (${V.muzzle})`);
    ok(V.burstMax === 0, `no fired run exceeds the archetype burst max (${V.burstMax})`);
    ok(V.burstLog === 0, `every completed rolled burst within its archetype range (${V.burstLog})`);
    ok(burstSizes.rifleman.size >= 2, `burst length is rolled, not constant (rifleman sizes: ${[...burstSizes.rifleman].sort().join(",")})`);
    for (const bandName of Object.keys(jitterByBand)) {
      const arr = jitterByBand[bandName];
      const spec = BANDS[bandName].jitter;
      if (arr.length < 60) { skip(`σ check ${bandName}: only ${arr.length} clean samples`); continue; }
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / arr.length);
      ok(sd >= spec * 0.9 && sd <= spec * 1.1,
        `jitter σ within ±10% of ${bandName} spec (measured ${sd.toFixed(4)} vs ${spec}, n=${arr.length})`);
    }
  }

  // ================================================================ engagement
  section("probe_engagement_ends — 30 seeds: flank 40±2, push 75±2, episode ≤90 s");
  {
    // sealed pocket: the player is confirmed, then vanishes into an
    // unreachable box → a pure stalemate that exercises the referee clock
    const boxes = [
      mkBox(-1.9, -1.5, 0, 2.2, 4.1, 7.9), mkBox(1.5, 1.9, 0, 2.2, 4.1, 7.9),
      mkBox(-1.9, 1.9, 0, 2.2, 4.1, 4.5), mkBox(-1.9, 1.9, 0, 2.2, 7.5, 7.9),
    ];
    const cc = customColliders(boxes, [8, 0, 6], [], 40);
    const cnav = NAV.bakeNav(cc);
    let flankBad = [], pushBad = [], episodeBad = [], noLog = 0, pushClosed = 0;
    for (let seed = 300; seed < 330; seed++) {
      const events = [];
      let simRef = null;
      const sim = S.createSim({
        colliders: cc, nav: cnav, weapons: WEAPONS, seed,
        emit: (type, data) => events.push({ t: simRef ? simRef.state.time : 0, type, data }),
      });
      simRef = sim;
      sim.setGod(true); // pure referee-clock probe: pre-seal hits must not reset it
      sim.state.phase = "assault";
      const yaw0 = Math.atan2(-(8 - 0), -(6 - (-15)));
      sim.spawnBotFromSpec({ archetype: "rifleman", band: "hardened", squad: "sqE", pos: [0, 0, -15], yaw: yaw0, alerted: false });
      const T = (s) => Math.round(s * 60);
      let maxSpan = 0, spanStart = -1, prevDmg = 0;
      for (let i = 0; i < T(106); i++) {
        const c = cmd({ yaw: 0, pitch: 1.2 });
        if (i === T(1.0) || i === T(1.5)) c.fire = true;
        sim.step(c);
        if (i === T(2.5)) sim.teleport("P", 0, 0, 6);
        // engaged/damage-free span tracking
        const engaged = sim.state.bots.some((b) => b.alive && (b.state === "combat" || b.state === "flank" || b.state === "suppress"));
        const dmg = sim.state.counters.damageDealt + sim.state.counters.damageTaken;
        if (engaged && spanStart < 0) spanStart = sim.state.time;
        if (!engaged && spanStart >= 0) { maxSpan = Math.max(maxSpan, sim.state.time - spanStart); spanStart = -1; }
        if (dmg !== prevDmg && spanStart >= 0) { maxSpan = Math.max(maxSpan, sim.state.time - spanStart); spanStart = sim.state.time; prevDmg = dmg; }
      }
      if (spanStart >= 0) maxSpan = Math.max(maxSpan, sim.state.time - spanStart);
      const log = sim.squad._debug().refereeLog;
      const flank = log.find((e) => e.kind === "flank");
      const push = log.find((e) => e.kind === "push");
      const close = log.find((e) => e.kind === "episode_end");
      if (!flank || !push) noLog++;
      if (flank && (flank.elapsed < 38 || flank.elapsed > 42)) flankBad.push(seed + ":" + flank.elapsed.toFixed(1));
      if (push && (push.elapsed < 73 || push.elapsed > 77)) pushBad.push(seed + ":" + push.elapsed.toFixed(1));
      if (maxSpan > 90.6) episodeBad.push(seed + ":" + maxSpan.toFixed(1));
      if (close) pushClosed++;
    }
    ok(noLog === 0, `referee acted in every seed (${30 - noLog}/30 have flank+push entries)`);
    ok(flankBad.length === 0, "referee forces a flank at 40 s ± 2" + (flankBad.length ? " — OUT: " + flankBad.join(" ") : ""));
    ok(pushBad.length === 0, "referee pushes at 75 s ± 2" + (pushBad.length ? " — OUT: " + pushBad.join(" ") : ""));
    ok(episodeBad.length === 0, "no damage-free COMBAT episode exceeds 90 s" + (episodeBad.length ? " — OUT: " + episodeBad.join(" ") : ""));
    ok(pushClosed === 30, `episode closed by referee in all sealed-stalemate seeds (${pushClosed}/30 — every engagement ends)`);
  }

  // ---------------- passivity: reachable cover — bots dislodge the camper
  section("passivity — camper in reachable cover gets dislodged (10 seeds)");
  {
    const boxes = [
      mkBox(-3.4, -3, 0, 2.2, 3, 8), mkBox(3, 3.4, 0, 2.2, 3, 8),
      mkBox(-3.4, 3.4, 0, 2.2, 2.6, 3),
    ];
    const cc = customColliders(boxes, [8, 0, 6], [], 40);
    const cnav = NAV.bakeNav(cc);
    let damaged = 0, hunting = 0;
    for (let seed = 400; seed < 410; seed++) {
      const sim = S.createSim({ colliders: cc, nav: cnav, weapons: WEAPONS, seed, emit: () => {} });
      sim.state.phase = "assault";
      const yaw0 = Math.atan2(-8, -(6 + 15));
      sim.spawnBotFromSpec({ archetype: "rifleman", band: "hardened", squad: "sqP", pos: [0, 0, -15], yaw: yaw0, alerted: false });
      const T = (s) => Math.round(s * 60);
      let tookDamage = false;
      for (let i = 0; i < T(120); i++) {
        const c = cmd({ yaw: 0, pitch: 1.2, crouch: i > T(2.5) });
        if (i === T(1.0) || i === T(1.5)) c.fire = true;
        sim.step(c);
        if (i === T(2.5)) sim.teleport("P", 0, 0, 6);
        if (sim.state.counters.damageTaken > 0) { tookDamage = true; break; }
      }
      if (tookDamage) damaged++;
      else {
        const b = sim.state.bots[0];
        if (b.alive && b.state !== "patrol") hunting++;
      }
    }
    ok(damaged >= 5, `passive player punished: damaged in ${damaged}/10 seeds (bots push + search the pocket)`);
    ok(damaged + hunting === 10, `no seed ends with the AI giving up (${damaged} damaged + ${hunting} still hunting)`);
  }

  // ================================================================ budget
  section("≤4 brains think/tick + AI CPU ≤1.5 ms with 12 bots");
  {
    FSM.AI_PERF.calls = 0; FSM.AI_PERF.totalMs = 0; FSM.AI_PERF.avgMs = 0;
    const sim = plazaSim(77);
    sim.setGod(true);
    sim.state.phase = "assault";
    sim.teleport("P", -5, 0, 0);
    const squadsOf = ["s1", "s1", "s1", "s2", "s2", "s2", "s3", "s3", "s3", "s4", "s4", "s4"];
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      sim.spawnBotFromSpec({
        archetype: i % 4 === 3 ? "cqb" : "rifleman", band: "regular", squad: squadsOf[i],
        pos: [-5 + Math.cos(a) * (14 + (i % 3) * 5), 0, Math.sin(a) * (14 + (i % 3) * 5)],
        yaw: 0, alerted: true,
      });
    }
    let thinkViolations = 0;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 900; i++) {
      sim.step(cmd({ yaw: i * 0.01, pitch: 0 }));
      let thought = 0;
      for (const b of sim.state.bots) {
        if (b.alive && b._brain && b._brain.lastThinkT === sim.state.time) thought++;
      }
      if (thought > 4) thinkViolations++;
    }
    const msTick = Number(process.hrtime.bigint() - t0) / 1e6 / 900;
    ok(thinkViolations === 0, `≤4 brains think per tick, every tick (${thinkViolations} violations)`);
    ok(FSM.AI_PERF.avgMs <= 1.5, `AI share ${FSM.AI_PERF.avgMs.toFixed(3)} ms ≤ 1.5 ms (12 bots)`);
    ok(msTick <= 3.0, `full sim tick ${msTick.toFixed(3)} ms ≤ 3 ms (Part 5 budget)`);
    console.log(`  info  aiStep avg ${FSM.AI_PERF.avgMs.toFixed(3)} ms, sim tick ${msTick.toFixed(3)} ms`);
  }

  // ================================================================ determinism
  section("determinism — same seed twice → identical trace; different seed differs");
  {
    const runOnce = (seed) => {
      const counts = {};
      let simRef = null;
      const sim = S.createSim({
        content, colliders, nav, weapons: WEAPONS, seed,
        emit: (type) => { counts[type] = (counts[type] || 0) + 1; },
      });
      simRef = sim; void simRef;
      sim.setGod(true);
      sim.state.phase = "assault";
      sim.teleport("P", -5, 0, 0);
      sim.spawnBotFromSpec({ archetype: "rifleman", band: "regular", squad: "sqX", pos: [-2, 0, -14], yaw: 0, alerted: true });
      sim.spawnBotFromSpec({ archetype: "cqb", band: "hardened", squad: "sqX", pos: [8, 0, -8], yaw: 0, alerted: true });
      sim.spawnBotFromSpec({ archetype: "marksman", band: "veteran", squad: "sqY", pos: [12, 0, 4], yaw: 0, alerted: true });
      const trace = [];
      for (let i = 0; i < 1500; i++) {
        const c = cmd({ yaw: 0, pitch: 1.2 });
        if (i === 30) c.fire = true;
        sim.step(c);
        if (i % 120 === 0) {
          for (const b of sim.state.bots) {
            trace.push(b.id, b.state, b.pos[0].toFixed(4), b.pos[2].toFixed(4), b.hp);
          }
        }
      }
      return djb2(JSON.stringify({ trace, counts, snap: sim.snapshot().bots }));
    };
    const A = runOnce(555), B = runOnce(555), C = runOnce(556);
    ok(A === B, `same seed → identical AI trace + event counts (${A})`);
    ok(A !== C, "different seed → different trace (rolls live on the ai stream)");
  }

  // ================================================================ mission smoke
  section("mission smoke — real content, brains live inside the mission");
  {
    const seen = new Set();
    const sim = S.createSim({
      content, colliders, nav, weapons: WEAPONS, seed: 5,
      emit: (type) => seen.add(type),
    });
    sim.mission.start(sim);
    let crashed = null;
    try {
      for (let i = 0; i < 1200; i++) sim.step(cmd({ yaw: -Math.PI / 2 }));
    } catch (e) { crashed = e; }
    ok(!crashed, "1200 mission ticks with live AI, no exception" + (crashed ? " — " + crashed.message : ""));
    const dock = sim.state.bots.filter((b) => b.wave === "w_dock");
    ok(dock.length === 2 && dock.every((b) => b.cmd != null), "w_dock patrol bots think + write cmds");
    ok(dock.some((b) => Math.hypot(b.pos[0] - (-18), b.pos[2] - 48) > 1 || Math.hypot(b.pos[0] - 2, b.pos[2] - 46) > 1),
      "patrol routes walked (bots moved off their spawns)");
    const illegal = [...seen].filter((t) => !ALLOWED_EVENTS.has(t));
    ok(illegal.length === 0, "AI emits ONLY the R13-amended vocabulary (bark/botstate/…)"
      + (illegal.length ? " — ILLEGAL: " + illegal.join(",") : ""));
  }

  // ================================================================ integration
  section("cross-lane integration — A1's sim.selftest.cjs with the REAL AI inside");
  if (fast) {
    skip("--fast: sim.selftest child run skipped (run without --fast for the binding gate)");
  } else {
    const res = spawnSync(process.execPath, [path.join(GAME_DIR, "core/sim/sim.selftest.cjs")], {
      encoding: "utf8", timeout: 10 * 60 * 1000, cwd: GAME_DIR,
    });
    const out = (res.stdout || "") + (res.stderr || "");
    const tail = out.trim().split("\n").slice(-6).join("\n    ");
    ok(res.status === 0, "node core/sim/sim.selftest.cjs exits 0 with live AI\n    " + tail);
  }

  return finish();
}

function finish() {
  console.log(`\n${"=".repeat(64)}`);
  console.log(`ai.selftest: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) { console.error("RESULT: FAIL"); process.exit(1); }
  console.log("RESULT: OK");
  process.exit(0);
}

main().catch((e) => {
  console.error("UNCAUGHT: " + (e && e.stack || e));
  process.exit(1);
});
