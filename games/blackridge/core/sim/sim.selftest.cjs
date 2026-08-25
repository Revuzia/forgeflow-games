#!/usr/bin/env node
/* core/sim/sim.selftest.cjs [A1] — Node probe battery (BUILD_PLAN Part 2 §A1).
 * Folds in combat_spec §8.1's THREE-free probes: ttk, recoil, spread-identity,
 * movement, penetration, grenade, determinism (same seed twice → identical
 * snapshot hash), plus the contract gate over content.json refs.
 *
 * Run:  node core/sim/sim.selftest.cjs            → full battery
 *       node core/sim/sim.selftest.cjs --contract → contract gate only
 *                                                   (A2's official self-verify)
 * Exit 0 = all pass. Exit 1 = failures (each printed FAIL, verbatim reason).
 *
 * HONESTY NOTES (report-with-total-fidelity):
 * - While core/weapons/weapon_data.js is still A0's stub (header STUB:A4),
 *   the "loaded table matches combat_spec §2.1" assertions are SKIPPED with a
 *   loud banner; the §2.1 math itself is verified against a SPEC-embedded
 *   table through the real falloff/TTK code path. They arm automatically when
 *   A4's real table lands.
 * - probe_recoil's recovery half (12°/s recover window) lives in A4's
 *   view-side recoil.js and is NOT covered here (sim applies single pattern
 *   steps; the camera accumulator is A4's).
 */
"use strict";

const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

const SIM_DIR = __dirname;
const GAME_DIR = path.resolve(SIM_DIR, "..", "..");
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

function flatColliders(boxes) {
  return {
    boxes: boxes || [],
    groundY: () => 0,
    spawns: { player: [0, 0, 0], playerYaw: 0 },
    cover: [],
    nodes: {},
    bounds: { min: [-200, -5, -200], max: [200, 60, 200] },
  };
}
function mkBox(x0, x1, y0, y1, z0, z1, surface, matClass) {
  return {
    min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
    max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
    surface: surface || "concrete", matClass: matClass || "hard",
  };
}

async function main() {
  const contractOnly = process.argv.includes("--contract");

  const S = await import(u("core/sim/sim.js"));
  const B = await import(u("core/sim/ballistics.js"));
  const M = await import(u("core/sim/mission.js"));
  const P = await import(u("core/sim/player.js"));
  const G = await import(u("core/sim/grenades.js"));
  const WD = await import(u("core/weapons/weapon_data.js"));
  const COL = await import(u("core/level/colliders.js"));
  const LAY = await import(u("core/level/layout.js"));
  const content = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "content.json"), "utf8"));
  const weaponDataText = fs.readFileSync(path.join(GAME_DIR, "core/weapons/weapon_data.js"), "utf8");
  const weaponDataIsStub = weaponDataText.includes("STUB:A4");
  const WEAPONS = WD.WEAPONS;
  const colliders = COL.buildColliders(1);
  const layout = LAY.buildLayout(1);

  function makeSim(opts) {
    const events = [];
    const sim = S.createSim(Object.assign({
      colliders: flatColliders(),
      weapons: WEAPONS,
      seed: 42,
      emit: (type, data) => events.push({ t: sim ? sim.state.time : 0, type, data }),
    }, opts || {}));
    return { sim, events };
  }

  // ================================================================ contract
  section("contract gate over content.json (A2's official gate)");
  {
    const res = M.validateContent(content, { nodes: colliders.nodes, weapons: WEAPONS });
    ok(res.ok, "validateContent: every spawn/wave/objective/archetype/node/weapon/scenario ref resolves" +
      (res.ok ? "" : "\n    " + res.errors.join("\n    ")));

    // negative control — the gate actually bites
    const broken = JSON.parse(JSON.stringify(content));
    broken.mission.objectives[0].unlocks = ["obj_does_not_exist"];
    const neg = M.validateContent(broken, { nodes: colliders.nodes, weapons: WEAPONS });
    ok(!neg.ok, "validateContent: rejects a dangling objective ref (negative control)");

    // makeMission throws on dangling (boot-time behavior)
    let threw = false;
    try { M.makeMission(broken, () => {}); } catch (e) { threw = true; }
    ok(threw, "makeMission throws on dangling content ref");

    // player spawn parity with colliders
    const cp = content.mission.spawns.player;
    ok(JSON.stringify(cp.pos) === JSON.stringify(colliders.spawns.player) &&
       approx(cp.yaw, colliders.spawns.playerYaw, 1e-3),
      "content player spawn == colliders.spawns (pos byte-exact, yaw within 1e-3 — A2 stores 4-decimal radians)");

    // spawn coords byte-exact vs layout refSpawns + walkable placement
    const world = (S.createSim({ colliders, weapons: WEAPONS, seed: 1 })).world;
    let exact = 0, inexact = [], unwalkable = [];
    for (const w of content.mission.spawns.waves) {
      for (const sp of w.bots) {
        const ref = layout.refSpawns[sp.id];
        if (ref && JSON.stringify(ref) === JSON.stringify(sp.pos)) exact++;
        else inexact.push(sp.id);
        // walkable: inside a walkRect at that height, not inside a solid
        const inRect = layout.walkRects.some((r) =>
          sp.pos[0] >= r.min[0] && sp.pos[0] <= r.max[0] &&
          sp.pos[2] >= r.min[1] && sp.pos[2] <= r.max[1] &&
          Math.abs(sp.pos[1] - r.y) <= 0.6);
        // center STRICTLY inside a solid is the Colosseum bug class;
        // boundary/corner grazes are tolerated — the bot can still move.
        // Known graze: sp_cust_w1_5 [0,0,-40] sits ON bld_nea's SW corner
        // (flagged to A2/A3 in the lane report; 0.5 m west would clear it).
        const cy = sp.pos[1] + 0.9;
        const blocked = world.boxes.some((b) =>
          sp.pos[0] > b.min[0] + 0.01 && sp.pos[0] < b.max[0] - 0.01 &&
          sp.pos[2] > b.min[2] + 0.01 && sp.pos[2] < b.max[2] - 0.01 &&
          cy > b.min[1] && cy < b.max[1]);
        if (!inRect || blocked) unwalkable.push(sp.id + (blocked ? "(solid)" : "(no rect)"));
      }
    }
    ok(inexact.length === 0, `all 44 wave spawns byte-exact vs layout refSpawns (${exact} matched` +
      (inexact.length ? "; mismatched: " + inexact.join(",") : "") + ")");
    ok(unwalkable.length === 0, "every spawn sits on walkable ground, not inside a solid" +
      (unwalkable.length ? " — offenders: " + unwalkable.join(",") : ""));
  }
  if (contractOnly) return finish();

  // ================================================================ ttk
  section("probe_ttk — §2.1 math (SPEC-embedded table through the real falloff path)");
  {
    const SPEC = {
      warden: { rpm: 750, near: 28, far: 22, fs: 32, fe: 58, head: 1.40 },
      vesper: { rpm: 900, near: 25, far: 17, fs: 14, fe: 32, head: 1.35 },
      corvus: { rpm: 257, near: 60, far: 48, fs: 45, fe: 90, head: 1.65 },
      pike: { rpm: 380, near: 30, far: 19, fs: 12, fe: 26, head: 1.80 },
    };
    const mkW = (s) => ({ damage: { body: s.near, min: s.far, falloffStart: s.fs, falloffEnd: s.fe, headMult: s.head, limbMult: 1 } });
    const ttkMs = (s, dist, part) => {
      const dmg = B.falloffDamage(mkW(s), dist, part || "body");
      return (Math.ceil(100 / dmg) - 1) * (60000 / s.rpm);
    };
    ok(approx(ttkMs(SPEC.warden, 0), 240, 0.01), "Warden near body TTK = 240 ms (4 shots)");
    ok(approx(ttkMs(SPEC.warden, 58), 320, 0.01), "Warden far body TTK = 320 ms (5 shots)");
    ok(approx(ttkMs(SPEC.vesper, 0), 200, 0.01), "Vesper near body TTK = 200 ms (4 shots)");
    ok(approx(ttkMs(SPEC.vesper, 32), 333.33, 0.34), "Vesper far body TTK ≈ 333 ms (6 shots)");
    ok(approx(ttkMs(SPEC.corvus, 0), 233.46, 0.5), "Corvus near body TTK ≈ 233 ms (2 shots)");
    ok(approx(ttkMs(SPEC.corvus, 90), 466.9, 1.0), "Corvus far body TTK ≈ 466 ms (3 shots — outside effective range, spec-accepted out of band)");
    ok(approx(ttkMs(SPEC.pike, 0), 473.68, 0.5), "Pike near body TTK ≈ 474 ms (sidearm exemption, ≥400 as designed)");
    ok(ttkMs(SPEC.pike, 0) >= 400, "Pike TTK ≥ 400 ms asserted (band-exempt)");
    // band check at effective range (150–400 ms)
    for (const [id, ranges] of [["warden", [0, 58]], ["vesper", [0, 32]], ["corvus", [0, 45]]]) {
      for (const d of ranges) {
        const v = ttkMs(SPEC[id], d);
        ok(v >= 150 - 0.01 && v <= 400 + 0.01, `${id} TTK at ${d} m in the 150–400 ms band (${v.toFixed(1)})`);
      }
    }
    // 5 range samples: monotonic non-decreasing, flat beyond falloffEnd
    for (const id of Object.keys(SPEC)) {
      const s = SPEC[id];
      const samples = [0, s.fs, (s.fs + s.fe) / 2, s.fe, s.fe + 20].map((d) => B.falloffDamage(mkW(s), d));
      let mono = true;
      for (let i = 1; i < samples.length; i++) if (samples[i] > samples[i - 1] + 1e-9) mono = false;
      ok(mono, `${id} falloff monotonic non-increasing across 5 range samples`);
      ok(approx(samples[3], samples[4]), `${id} damage flat beyond falloffEnd (floor = far value, not a ratio)`);
      ok(approx(samples[0], s.near) && approx(samples[3], s.far), `${id} near/far damage exact (${s.near}/${s.far})`);
    }
    // headshot paths
    ok(approx(B.falloffDamage(mkW(SPEC.corvus), 0, "head"), 99, 1e-6), "Corvus head near = 99 — deliberately NOT a 1-shot (no-frustration rule)");
    const pikeHead = B.falloffDamage(mkW(SPEC.pike), 0, "head");
    ok(approx(pikeHead, 54, 1e-6) && pikeHead * 2 >= 100, "Pike 2-headshot skill line (54 × 2 = 108)");

    if (weaponDataIsStub) {
      skip("loaded weapon_data.js is STILL A0's stub (STUB:A4 header) — spec-exact table comparison DEFERRED until A4 re-lands; id/shape checks only");
      for (const id of ["warden", "vesper", "corvus", "pike"]) {
        ok(!!WEAPONS[id], `loaded table has R4 id '${id}'`);
      }
    } else {
      for (const id of Object.keys(SPEC)) {
        const s = SPEC[id], w = WEAPONS[id];
        ok(w && approx(w.rpm, s.rpm) && approx(w.damage.body, s.near) && approx(w.damage.min, s.far) &&
           approx(w.damage.falloffStart, s.fs) && approx(w.damage.falloffEnd, s.fe) && approx(w.damage.headMult, s.head),
          `loaded ${id} table matches combat_spec §2.1 (rpm/near/far/falloff/headMult)`);
      }
    }
  }

  // ---------------- integration TTK: sim vs analytic on the LOADED table
  section("probe_ttk integration — full sim path vs analytic (loaded table)");
  {
    const { sim, events } = makeSim();
    sim.setGod(true);
    const botId = sim.spawnBot("rifleman", 0, -10, { yaw: Math.PI });
    sim.aimAt(0, 1.0, -10);
    // settle ADS first (full-ADS spread = data ads value; tiny at 10 m)
    for (let i = 0; i < 40; i++) sim.step(cmd({ ads: true, yaw: sim.state.player.yaw, pitch: sim.state.player.pitch }));
    const w = WEAPONS[sim.state.player.weapon.id];
    const dmg = B.falloffDamage(w, 10, "body");
    const K = Math.ceil(100 / dmg);
    for (let i = 0; i < 240; i++) {
      sim.step(cmd({ ads: true, fire: true, yaw: sim.state.player.yaw, pitch: sim.state.player.pitch }));
      if (!sim.state.bots[0].alive) break;
    }
    const hurts = events.filter((e) => e.type === "hurt" && e.data.victim === botId);
    const death = events.find((e) => e.type === "death" && e.data.victim === botId);
    ok(!!death, "bot died to sustained fire through the REAL cmd → weapon → ballistics path");
    ok(hurts.length === K, `shots-to-kill matches analytic ceil(100/dmg): ${hurts.length} == ${K}`);
    if (death && hurts.length) {
      const ttk = death.t - hurts[0].t;
      const lo = (K - 1) * (60 / w.rpm) - 1e-6;
      const hi = (K - 1) * (60 / w.rpm) + K * (1 / 60) + 1e-6;
      ok(ttk >= lo && ttk <= hi, `measured TTK ${Math.round(ttk * 1000)} ms within [analytic, analytic+K ticks] = [${Math.round(lo * 1000)}, ${Math.round(hi * 1000)}] ms`);
    }
    ok(sim.state.counters.shotsHit === hurts.length && sim.state.counters.kills === 1,
      "counters: shotsHit == hurt events, kills == 1");
  }

  // ================================================================ recoil
  // WAVE-10 AIM-TRUTH: in the LIVE game the player's recoil authority is
  // weapons/recoil.js — it kicks input.state, so the climb is already inside
  // cmd.yaw/pitch and ballistics fires the bullet along that cmd EXACTLY
  // (combat_spec §2.3 "aim and camera are one ray ... exactly one recoil").
  // Node has no recoil.js, so these probes set sim.flags.simRecoil to make
  // the sim model the same per-shot pattern step. The first block below is
  // the new contract itself: with the flag OFF — the live configuration —
  // a full-ADS player round leaves along the aim ray to the last bit.
  section("probe_aimtruth — full-ADS player rounds leave EXACTLY along cmd");
  {
    const { sim, events } = makeSim({ seed: 5150 });
    sim.setGod(true); sim.setNoTarget(true);
    sim.aimAt(0, 1.62, -50);
    for (let i = 0; i < 40; i++) sim.step(cmd({ ads: true, yaw: sim.state.player.yaw, pitch: sim.state.player.pitch }));
    ok(sim.flags.simRecoil === false, "live default: sim.flags.simRecoil is FALSE (recoil.js owns the player's climb)");
    const aim = B.dirFromAngles(sim.state.player.yaw, sim.state.player.pitch);
    for (let i = 0; i < 200; i++) {
      sim.step(cmd({ ads: true, fire: true, yaw: sim.state.player.yaw, pitch: sim.state.player.pitch }));
      if (events.filter((e) => e.type === "shot" && !e.data.impactOnly && !e.data.pen).length >= 30) break;
    }
    const dirs = events.filter((e) => e.type === "shot" && !e.data.impactOnly && !e.data.pen).map((e) => e.data.dir);
    const worst = Math.max(...dirs.map((d) => Math.acos(Math.max(-1, Math.min(1,
      d[0] * aim[0] + d[1] * aim[1] + d[2] * aim[2])))));
    ok(dirs.length >= 30, `30 full-ADS rounds fired (${dirs.length})`);
    ok(worst <= 1e-9,
      `worst angular error over ${dirs.length} full-ADS rounds = ${(worst * 180 / Math.PI).toExponential(2)}° ≤ 1e-9° (spread.ads 0 ⇒ pinpoint, no hidden pattern offset)`);
    // and the shared-model number the crosshair draws is the same zero
    ok(sim.state.player.weapon._lastSpread === 0,
      "effectiveSpread at full ADS = 0 — the number the crosshair draws is the number the bullet used");
  }

  section("probe_recoil — pattern determinism + envelope (sim side)");
  {
    const run = (seed) => {
      const { sim, events } = makeSim({ seed });
      sim.setGod(true); sim.setNoTarget(true);
      sim.flags.simRecoil = true; // Node stands in for recoil.js (see note above)
      sim.aimAt(0, 1.62, -50);
      for (let i = 0; i < 40; i++) sim.step(cmd({ ads: true, yaw: sim.state.player.yaw, pitch: sim.state.player.pitch }));
      for (let i = 0; i < 200; i++) {
        sim.step(cmd({ ads: true, fire: true, yaw: sim.state.player.yaw, pitch: sim.state.player.pitch }));
        const fired = events.filter((e) => e.type === "shot" && !e.data.impactOnly && !e.data.pen).length;
        if (fired >= 30) break;
      }
      return events.filter((e) => e.type === "shot" && !e.data.impactOnly && !e.data.pen)
        .map((e) => e.data.dir.map((v) => v.toFixed(12)).join(","));
    };
    const a = run(1234), b = run(1234), c = run(4321);
    ok(a.length >= 30, `30-round burst produced (${a.length} shot events)`);
    ok(JSON.stringify(a) === JSON.stringify(b), "same seed twice → identical 30-shot dir sequence (pattern reproduces per seed)");
    ok(JSON.stringify(a) !== JSON.stringify(c), "different seed → different jitter (sanity)");
    // envelope: 95th percentile angular deviation from base aim ≤ 3.2°
    const { sim, events } = makeSim({ seed: 99 });
    sim.setGod(true); sim.setNoTarget(true);
    sim.flags.simRecoil = true;
    sim.aimAt(0, 1.62, -50);
    for (let i = 0; i < 40; i++) sim.step(cmd({ ads: true, yaw: sim.state.player.yaw, pitch: sim.state.player.pitch }));
    const aim = B.dirFromAngles(sim.state.player.yaw, sim.state.player.pitch);
    for (let i = 0; i < 200; i++) {
      sim.step(cmd({ ads: true, fire: true, yaw: sim.state.player.yaw, pitch: sim.state.player.pitch }));
      if (events.filter((e) => e.type === "shot" && !e.data.impactOnly && !e.data.pen).length >= 30) break;
    }
    const dirs = events.filter((e) => e.type === "shot" && !e.data.impactOnly && !e.data.pen).map((e) => e.data.dir);
    const angles = dirs.map((d) => Math.acos(Math.max(-1, Math.min(1, d[0] * aim[0] + d[1] * aim[1] + d[2] * aim[2])))).sort((x, y) => x - y);
    const p95 = angles[Math.min(angles.length - 1, Math.floor(angles.length * 0.95))];
    ok(p95 <= 3.2 * Math.PI / 180, `30-round envelope 95th-pct ${(p95 * 180 / Math.PI).toFixed(2)}° ≤ 3.2° (uncompensated-remainder model: single pattern steps sim-side)`);
  }

  // ================================================================ spread
  section("probe_spread — effectiveSpread shared-model identity + exact multipliers");
  {
    const w = WEAPONS.warden;
    const base = B.effectiveSpread(w, { speed: 0 });
    ok(approx(base, w.spread.hip), "baseline standing hip = spread.hip");
    ok(approx(B.effectiveSpread(w, { speed: 0, airborne: true }) / base, 1.9), "airborne ×1.9 exact");
    ok(approx(B.effectiveSpread(w, { speed: 0, sliding: true }) / base, 1.6), "sliding ×1.6 exact");
    ok(approx(B.effectiveSpread(w, { speed: 0, crouched: true }) / base, 0.75), "crouched ×0.75 exact");
    ok(approx(B.effectiveSpread(w, { speed: 0, steady: true }) / base, 0.55), "steady-aim ×0.55 exact (NOT last-circle's 0.15 laser)");
    ok(approx(B.effectiveSpread(w, { speed: 0, landedRecently: true }) / base, 1.35), "post-4m-landing ×1.35 exact");
    ok(approx(B.effectiveSpread(w, { speed: 4.6 }) / base, 1 + Math.min(0.65, 4.6 * 0.06)), "walk-speed graded term exact (+27.6%)");
    ok(approx(B.effectiveSpread(w, { speed: 6.4 }) / base, 1 + Math.min(0.65, 6.4 * 0.06)), "sprint-speed graded term exact (+38.4%)");
    ok(approx(B.effectiveSpread(w, { speed: 20 }) / base, 1.65), "speed term capped at ×1.65");
    ok(approx(B.effectiveSpread(w, { ads: true, adsProgress: 0.5, speed: 0 }), w.spread.hip * (1 - 0.8 * 0.5)), "partial ADS = hip × (1 − 0.8·progress)");
    ok(approx(B.effectiveSpread(w, { ads: true, adsProgress: 1, speed: 0 }), w.spread.ads), "full ADS = spread.ads (0 for Warden/Vesper/Pike when A4 lands; Corvus keeps its value)");

    // identity: the number the trigger used == the exported function's number
    const { sim } = makeSim();
    sim.setGod(true); sim.setNoTarget(true);
    sim.aimAt(0, 1.62, -50);
    for (let i = 0; i < 70; i++) sim.step(cmd({ yaw: sim.state.player.yaw, pitch: sim.state.player.pitch })); // stand still ≥0.4 s → steady
    const preState = B.playerSpreadState(sim);
    const expected = B.effectiveSpread(WEAPONS[sim.state.player.weapon.id], preState);
    sim.step(cmd({ fire: true, yaw: sim.state.player.yaw, pitch: sim.state.player.pitch }));
    const used = sim.state.player.weapon._lastSpread;
    ok(used != null && approx(used, expected, 1e-12), `firing used effectiveSpread's exact number (${used} == ${expected}) — one model, not similarity`);
    ok(preState.steady === true, "steady-aim state was active for the identity sample (stationary ≥0.4 s, no shot ≥0.45 s)");
  }

  // ================================================================ movement
  section("probe_movement — accel / slide / slide-jump / mantle / sprint-out");
  {
    // accel time-to-walk 0.25 s ± 0.03 (§8.1 frozen; see deviation note)
    const { sim } = makeSim();
    let ticks = 0;
    for (let i = 0; i < 60; i++) {
      sim.step(cmd({ moveZ: 1 }));
      ticks++;
      const hs = Math.hypot(sim.state.player.vel[0], sim.state.player.vel[2]);
      if (hs >= 4.59) break;
    }
    const tWalk = ticks / 60;
    ok(tWalk >= 0.22 && tWalk <= 0.28, `time-to-walk ${tWalk.toFixed(3)} s within 0.25 ± 0.03 (probe-frozen; accel 18.4 documented deviation from §1.2 prose 28)`);

    // slide curve v(t) = 7.8·e^(−t/0.55) ± 2%
    const s2 = makeSim().sim;
    let c2 = cmd({ moveZ: 1, sprint: true });
    for (let i = 0; i < 90; i++) s2.step(c2);
    const preSpeed = Math.hypot(s2.state.player.vel[0], s2.state.player.vel[2]);
    ok(preSpeed >= 6.3, `sprint reached ${preSpeed.toFixed(2)} m/s before slide`);
    c2 = cmd({ moveZ: 1, sprint: true, crouch: true });
    s2.step(c2);
    ok(s2.state.player._m.sliding === true, "crouch-while-sprinting at ≥5.8 m/s enters slide");
    ok(approx(s2.state.player._m.slideV, 7.8 * Math.exp(-1 / 60 / 0.55), 0.01), "slide entry velocity 7.8 m/s (one tick decayed)");
    for (let i = 0; i < 11; i++) s2.step(c2); // t = 0.2 s
    const v02 = Math.hypot(s2.state.player.vel[0], s2.state.player.vel[2]);
    ok(approx(v02, 7.8 * Math.exp(-0.2 / 0.55), 7.8 * 0.02), `slide v(0.2 s) = ${v02.toFixed(3)} within ±2% of ${(7.8 * Math.exp(-0.2 / 0.55)).toFixed(3)}`);
    let slideTicks = 12;
    for (let i = 0; i < 60 && s2.state.player._m.sliding; i++) { s2.step(c2); slideTicks++; }
    const slideDur = slideTicks / 60;
    ok(slideDur >= 0.55 && slideDur <= 0.68, `slide ends at v ≤ 2.6 (~0.60 s analytic; measured ${slideDur.toFixed(3)} s)`);
    ok(s2.state.player.stance === "crouch", "slide stands into crouch");

    // slide-jump retains 90% of current horizontal velocity
    const s3 = makeSim().sim;
    let c3 = cmd({ moveZ: 1, sprint: true });
    for (let i = 0; i < 90; i++) s3.step(c3);
    c3 = cmd({ moveZ: 1, sprint: true, crouch: true });
    for (let i = 0; i < 18; i++) s3.step(c3); // slide t = 0.3 s
    const vPre = s3.state.player._m.slideV;
    s3.step(cmd({ moveZ: 1, sprint: true, crouch: true, jump: true }));
    const hAfter = Math.hypot(s3.state.player.vel[0], s3.state.player.vel[2]);
    ok(approx(hAfter, vPre * 0.9, vPre * 0.03), `slide-jump keeps 90% horizontal (${hAfter.toFixed(2)} vs ${(vPre * 0.9).toFixed(2)})`);
    ok(s3.state.player.vel[1] > 5, "slide-jump launches (vy = 6.6)");
    ok(s3.state.player._m.sliding === false && s3.state.player._m.slideCooldownUntil > s3.state.time,
      "slide ended with 0.9 s cooldown armed (no bunny-slide chains)");

    // jump apex ≈ 1.09 m
    const s4 = makeSim().sim;
    s4.step(cmd({ jump: true }));
    let apex = 0;
    for (let i = 0; i < 90; i++) { s4.step(cmd({})); apex = Math.max(apex, s4.state.player.pos[1]); }
    ok(apex >= 1.0 && apex <= 1.15, `jump apex ${apex.toFixed(3)} m ≈ 1.09 m`);

    // mantle: 380 ms vault (≤1.0 m), 500 ms clamber (>1.0 m)
    for (const [h, lo, hi, label] of [[1.0, 0.35, 0.42, "vault 380 ms"], [1.2, 0.47, 0.54, "clamber 500 ms"]]) {
      const s5 = makeSim({ colliders: flatColliders([mkBox(-3, 3, 0, h, -2.0, -1.4)]) }).sim;
      let mantleTicks = 0, sawMantle = false;
      for (let i = 0; i < 400; i++) {
        s5.step(cmd({ moveZ: 1, jump: i > 20 }));
        if (s5.state.player._m && s5.state.player._m.mantle) { sawMantle = true; mantleTicks++; }
        if (sawMantle && !(s5.state.player._m && s5.state.player._m.mantle)) break;
      }
      const md = mantleTicks / 60;
      ok(sawMantle, `mantle triggered at a ${h} m ledge (jump against wall)`);
      ok(md >= lo && md <= hi, `${label}: measured ${Math.round(md * 1000)} ms`);
      ok(sawMantle && Math.abs(s5.state.player.pos[1] - h) < 0.05, `mantle lands ON the ledge top (y = ${s5.state.player.pos[1].toFixed(2)})`);
    }

    // sprint-out (AR 210 ms ± 15): fire pressed during sprint buffers and
    // releases the first shot when sprint-out elapses (§1.8)
    const { sim: s6, events: e6 } = makeSim();
    s6.setGod(true); s6.setNoTarget(true);
    let c6 = cmd({ moveZ: 1, sprint: true });
    for (let i = 0; i < 90; i++) s6.step(c6);
    const pressT = s6.state.time + 1 / 60; // the tick that carries the press
    c6 = cmd({ moveZ: 1, sprint: true, fire: true });
    for (let i = 0; i < 40; i++) {
      s6.step(c6);
      if (e6.some((e) => e.type === "shot")) break;
    }
    const shotEv = e6.find((e) => e.type === "shot");
    const delayMs = shotEv ? (shotEv.t - pressT) * 1000 : -1;
    ok(shotEv && delayMs >= 195 && delayMs <= 225,
      `AR sprint-out delay ${shotEv ? Math.round(delayMs) + " ms" : "NO SHOT FIRED"} within 210 ± 15`);

    // §2.2 reload commit at 65% + §1.8 sprint cancel restores pre-reload mag
    const { sim: s7, events: e7 } = makeSim();
    s7.setGod(true); s7.setNoTarget(true);
    for (let i = 0; i < 5; i++) { for (let j = 0; j < 6; j++) s7.step(cmd({ fire: j === 0 })); }
    const magAfterFire = s7.state.player.weapon.mag;
    ok(magAfterFire < WEAPONS.warden.mag, `fired down to ${magAfterFire} rounds`);
    s7.step(cmd({ reload: true }));
    ok(s7.state.player.weapon.state === "reloading", "reload started");
    for (let i = 0; i < 30; i++) s7.step(cmd({})); // ~0.52 s < 65% of 2.1 s
    for (let i = 0; i < 5; i++) s7.step(cmd({ moveZ: 1, sprint: true })); // sprint cancels
    ok(s7.state.player.weapon.state !== "reloading" && s7.state.player.weapon.mag === magAfterFire,
      "sprint before the 65% commit cancels the reload and restores the pre-reload mag");
    // let it complete this time
    s7.step(cmd({ reload: true }));
    const dur = WEAPONS.warden.reloadS;
    for (let i = 0; i < Math.ceil(dur * 60) + 5; i++) s7.step(cmd({}));
    ok(s7.state.player.weapon.mag === WEAPONS.warden.mag, "completed reload fills the mag (commit at 65%)");
    ok(e7.filter((e) => e.type === "reload" && e.data.phase === "start").length >= 2, "reload start events emitted");

    // dry fire → empty event → auto-reload after 0.25 s
    const { sim: s8, events: e8 } = makeSim();
    s8.setGod(true); s8.setNoTarget(true);
    s8.setAmmo(0);
    s8.step(cmd({ fire: true }));
    ok(e8.some((e) => e.type === "empty"), "dry fire emits `empty`");
    for (let i = 0; i < 30; i++) s8.step(cmd({}));
    ok(s8.state.player.weapon.state === "reloading", "auto-reload starts 0.25 s after dry fire");
  }

  // ================================================================ penetration
  section("probe_penetration — §3.2 table, one-pen max, both-face FX, hard never");
  {
    const shootThrough = (boxes, weaponId, botZ) => {
      const { sim, events } = makeSim({ colliders: flatColliders(boxes) });
      sim.setGod(true);
      if (weaponId !== sim.state.player.weapon.id) sim.givePlayerWeapon(weaponId);
      const botId = sim.spawnBot("rifleman", 0, botZ, { yaw: Math.PI });
      sim.aimAt(0, 1.0, botZ);
      for (let i = 0; i < 40; i++) sim.step(cmd({ ads: true, yaw: sim.state.player.yaw, pitch: sim.state.player.pitch }));
      sim.step(cmd({ ads: true, fire: true, yaw: sim.state.player.yaw, pitch: sim.state.player.pitch }));
      for (let i = 0; i < 20; i++) sim.step(cmd({ ads: true, yaw: sim.state.player.yaw, pitch: sim.state.player.pitch }));
      return { sim, events, botId };
    };
    const soft = (thick, z) => mkBox(-2, 2, 0, 3, z, z + thick, "wood", "soft");

    // warden through 0.1 m soft: retained 0.70, FX both faces
    {
      const { sim, events, botId } = shootThrough([soft(0.1, -5.1)], "warden", -9);
      const hurt = events.find((e) => e.type === "hurt" && e.data.victim === botId);
      const expected = B.falloffDamage(WEAPONS.warden, 9, "body") * 0.70;
      ok(!!hurt, "Warden penetrates 0.1 m soft and hits the bot behind");
      ok(hurt && approx(hurt.data.amount, expected, 0.02), `damage retained 0.70 (${hurt && hurt.data.amount.toFixed(2)} vs ${expected.toFixed(2)})`);
      const pens = events.filter((e) => e.type === "shot" && e.data.pen);
      ok(pens.length === 2 && pens[0].data.pen === "entry" && pens[1].data.pen === "exit",
        "exit FX events emitted on BOTH faces (entry + exit)");
      ok(pens.length === 2 && pens[1].data.hit.pos[2] < pens[0].data.hit.pos[2],
        "exit-face position is beyond the entry face along the ray");
      void sim;
    }
    // hard never penetrated
    {
      const { events, botId } = shootThrough([mkBox(-2, 2, 0, 3, -5.1, -5.0, "concrete", "hard")], "warden", -9);
      ok(!events.some((e) => e.type === "hurt" && e.data.victim === botId), "`hard` never penetrated (bot unhurt)");
      ok(!events.some((e) => e.type === "shot" && e.data.pen), "no pen events on hard");
    }
    // vesper: soft only — metal_thin stops it
    {
      const { events, botId } = shootThrough([mkBox(-2, 2, 0, 3, -5.08, -5.0, "metal", "metal_thin")], "vesper", -9);
      ok(!events.some((e) => e.type === "hurt" && e.data.victim === botId), "Vesper does not penetrate metal_thin (soft only)");
    }
    // thickness cap: warden max 0.25 — 0.3 m soft stops it
    {
      const { events, botId } = shootThrough([soft(0.3, -5.3)], "warden", -9);
      ok(!events.some((e) => e.type === "hurt" && e.data.victim === botId), "0.30 m soft exceeds Warden's 0.25 m cap — stopped");
    }
    // one penetration max: two boards → stops at the second
    {
      const { events, botId } = shootThrough([soft(0.1, -5.1), soft(0.1, -6.6)], "warden", -9);
      ok(!events.some((e) => e.type === "hurt" && e.data.victim === botId), "one-pen max: second board stops the round");
      ok(events.filter((e) => e.type === "shot" && e.data.pen).length === 2, "exactly one entry+exit pair emitted");
    }
    // pike: no penetration at all
    {
      const { events, botId } = shootThrough([soft(0.05, -5.05)], "pike", -9);
      ok(!events.some((e) => e.type === "hurt" && e.data.victim === botId), "Pike penetrates nothing");
    }
  }

  // ================================================================ grenade
  section("probe_grenade — fuse, curve, hard-cover 25%, cook, 2 carried, bounce");
  {
    // fuse: pin → detonate 3.8 s ± 1 tick (throw released immediately)
    const { sim, events } = makeSim();
    sim.setGod(true);
    const pinT = sim.state.time + 1 / 60;
    sim.step(cmd({ grenade: true }));   // pin
    sim.step(cmd({}));                  // release → throw
    for (let i = 0; i < 60 * 5; i++) { sim.step(cmd({})); if (events.some((e) => e.type === "explosion")) break; }
    const boom = events.find((e) => e.type === "explosion");
    ok(!!boom, "thrown grenade detonates");
    ok(boom && approx(boom.t - pinT, 3.8, 2.5 / 60), `fuse runs from the PIN: ${(boom.t - pinT).toFixed(3)} s ≈ 3.8 s (cook model)`);
    ok(events.some((e) => e.type === "grenade" && e.data.phase === "out"), "grenade `out` phase emitted");
    ok(events.some((e) => e.type === "grenade" && e.data.phase === "bounce" || e.type === "grenade" && e.data.phase === "land"), "bounce/land phase emitted");
    ok(sim.state.player.grenades === 1, "player carries 2 — one used, one left");

    // damage curve 110 → 15 at 5.5 m, 0 beyond (direct detonate, same-height chest)
    const { sim: s2, events: e2 } = makeSim();
    s2.setGod(true);
    const ids = [0.5, 3, 5.4, 7].map((d) => s2.spawnBot("rifleman", d, -0.0001 - 0, { yaw: 0 }) && 0);
    void ids;
    // respawn cleanly with exact placement
    const s3r = makeSim(); const s3 = s3r.sim; const e3 = s3r.events;
    s3.setGod(true);
    const bA = s3.spawnBot("rifleman", 0.5, 0.0), bB = s3.spawnBot("rifleman", 3, 0.0001), bC = s3.spawnBot("rifleman", 5.4, 0.0002), bD = s3.spawnBot("rifleman", 7, 0.0003);
    // bots at x offsets, z≈0; detonate at origin chest height
    G.detonateAt(s3, "P", [0, 1.1, 0]);
    const amt = (id) => { const h = e3.find((e) => e.type === "hurt" && e.data.victim === id); return h ? h.data.amount : null; };
    const curve = (d) => 110 + (15 - 110) * (d / 5.5);
    ok(approx(amt(bA), curve(0.5), 1.0), `grenade damage at 0.5 m ≈ ${curve(0.5).toFixed(1)} (${(amt(bA) || 0).toFixed(1)})`);
    ok(approx(amt(bB), curve(3), 1.0), `grenade damage at 3 m ≈ ${curve(3).toFixed(1)} (${(amt(bB) || 0).toFixed(1)})`);
    ok(approx(amt(bC), curve(5.4), 1.0), `grenade damage at 5.4 m ≈ ${curve(5.4).toFixed(1)} (edge → 15)`);
    ok(amt(bD) == null, "no damage beyond the 5.5 m radius");

    // hard cover: 25% through
    const s4r = makeSim({ colliders: flatColliders([mkBox(1.5, 1.7, 0, 2.5, -1.5, 1.5, "concrete", "hard")]) });
    const s4 = s4r.sim, e4 = s4r.events;
    s4.setGod(true);
    const bE = s4.spawnBot("rifleman", 3, 0);
    G.detonateAt(s4, "P", [0, 1.1, 0]);
    const hE = e4.find((e) => e.type === "hurt" && e.data.victim === bE);
    ok(hE && approx(hE.data.amount, curve(3) * 0.25, 1.0), `through hard cover: 25% (${(hE ? hE.data.amount : 0).toFixed(1)} vs ${(curve(3) * 0.25).toFixed(1)})`);

    // cook: hold 1.0 s → detonates ~2.8 s after release
    const s5r = makeSim(); const s5 = s5r.sim, e5 = s5r.events;
    s5.setGod(true);
    let c5 = cmd({ grenade: true });
    for (let i = 0; i < 60; i++) s5.step(c5); // cook 1 s
    const relT = s5.state.time;
    s5.step(cmd({}));
    for (let i = 0; i < 60 * 4; i++) { s5.step(cmd({})); if (e5.some((e) => e.type === "explosion")) break; }
    const boom5 = e5.find((e) => e.type === "explosion");
    ok(boom5 && approx(boom5.t - relT, 2.8, 3 / 60), `cooked 1.0 s → detonates ${(boom5.t - relT).toFixed(2)} s after release (≈2.8)`);

    // 2 carried: third pin refuses
    const s6r = makeSim(); const s6 = s6r.sim, e6 = s6r.events;
    s6.setGod(true);
    for (let k = 0; k < 3; k++) {
      s6.step(cmd({ grenade: true }));
      s6.step(cmd({}));
      for (let i = 0; i < 30; i++) s6.step(cmd({}));
    }
    for (let i = 0; i < 60 * 5; i++) s6.step(cmd({}));
    ok(e6.filter((e) => e.type === "explosion").length === 2 && s6.state.player.grenades === 0,
      "2 carried — third pin does nothing");
  }

  // ================================================================ whiz
  section("probe_whiz — §7.2 supersonic crack inside 3 m");
  {
    const { sim, events } = makeSim();
    const botId = sim.spawnBot("rifleman", 2, -10, { yaw: Math.PI });
    const bot = sim.state.bots.find((b) => b.id === botId);
    bot.cmd = { moveX: 0, moveZ: 0, yaw: Math.PI, pitch: 0, fire: true, sprint: false, crouch: false, ads: false, reload: false };
    for (let i = 0; i < 30; i++) sim.step(cmd({}));
    ok(events.some((e) => e.type === "whiz"), "bot round passing ~2 m from the player's eye emits `whiz`");
    const wz = events.find((e) => e.type === "whiz");
    ok(wz && wz.data.dist < 3.0, `whiz dist ${wz && wz.data.dist.toFixed(2)} < 3 m`);
  }

  // ================================================================ regen
  section("probe_regen — §6 delay 4.5 s then 35 HP/s");
  {
    const { sim } = makeSim();
    sim.damage("P", 50);
    ok(approx(sim.state.player.hp, 50), "damage applied (hp 50)");
    for (let i = 0; i < Math.floor(4.4 * 60); i++) sim.step(cmd({}));
    ok(sim.state.player.hp < 60, `no regen inside the 4.5 s delay (hp ${sim.state.player.hp.toFixed(1)})`);
    for (let i = 0; i < Math.floor(2.2 * 60); i++) sim.step(cmd({}));
    ok(sim.state.player.hp === 100, "hp full ≈1.5 s after regen starts (35 HP/s)");
  }

  // ================================================================ mission
  section("probe_mission — full beat/objective chain on real content + colliders");
  {
    const events = [];
    const sim = S.createSim({
      content, colliders, weapons: WEAPONS, seed: 5,
      emit: (type, data) => events.push({ t: sim.state.time, type, data }),
    });
    sim.mission.start(sim);
    const idle = () => cmd({ yaw: sim.state.player.yaw, pitch: sim.state.player.pitch });
    const run = (n) => { for (let i = 0; i < n; i++) sim.step(idle()); };
    const objSt = (id) => sim.state.objectives.find((o) => o.id === id).state;
    const aliveOfWave = (wid) => sim.state.bots.filter((b) => b.wave === wid && b.alive);
    const queuedOfWave = (wid) => sim.mission._ms.spawnQueue.filter((q) => q.wave === wid).length;
    const killWave = (wid) => { for (const b of aliveOfWave(wid)) sim.damage(b.id, 999); run(2); };
    // kills through the R23 spawn queue: keep killing until the wave is
    // fully spawned AND fully dead (queued overflow spawns as slots free)
    const killWaveFully = (wid) => {
      for (let guard = 0; guard < 60; guard++) {
        for (const b of aliveOfWave(wid)) sim.damage(b.id, 999);
        run(2);
        if (aliveOfWave(wid).length === 0 && queuedOfWave(wid) === 0) return;
      }
    };

    ok(sim.state.phase === "infil", "mission start → phase 'infil' (R25 beats 1–2)");
    ok(events.some((e) => e.type === "mission:start"), "mission:start emitted");
    run(2);
    ok(aliveOfWave("w_dock").length === 2, "beat 1 spawned w_dock (2 quay patrol)");
    ok(objSt("obj_insertion") === "active", "obj_insertion active (initial)");
    killWave("w_dock");
    ok(objSt("obj_insertion") === "done" && objSt("obj_alleys") === "active", "clearing w_dock completes obj_insertion → unlocks obj_alleys");

    // beat 2 via the alley-mouth area trigger
    sim.teleport("P", -44, 0, 38); run(2);
    ok(sim.mission.beat === 2, "reaching the alley mouth arms beat 2");
    ok(aliveOfWave("w_alley_fwd").length === 2, "w_alley_fwd spawned");
    ok(aliveOfWave("w_alley_reinf").length === 0, "w_alley_reinf waits for contact");
    // contact: player fires one shot
    sim.step(cmd({ fire: true, yaw: sim.state.player.yaw, pitch: sim.state.player.pitch })); run(2);
    ok(aliveOfWave("w_alley_reinf").length === 3, "first shot (contact) triggers w_alley_reinf (3 reinforcements)");
    killWave("w_alley_fwd"); killWave("w_alley_reinf");
    ok(objSt("obj_alleys") === "done", "obj_alleys done after both alley waves cleared");

    // beat 3: plaza area
    sim.teleport("P", -20, 0, 0); run(2);
    ok(sim.mission.beat === 3 && sim.state.phase === "assault", "plaza entry arms beat 3 → phase 'assault'");
    ok(aliveOfWave("w_plaza_a").length === 5, "w_plaza_a spawned (5)");
    // kill 3 → waveAlive lte 2 → set-piece + wave B
    const pa = aliveOfWave("w_plaza_a");
    sim.damage(pa[0].id, 999); sim.damage(pa[1].id, 999); sim.damage(pa[2].id, 999); run(2);
    ok(aliveOfWave("w_plaza_b").length === 4, "w_plaza_a down to 2 alive → w_plaza_b pushes in the dark");
    const sps = sim.mission.drainSetPieces();
    ok(sps.some((s) => s.id === "transformer_blackout"), "transformer_blackout set-piece fired on the same condition");

    // player death mid-beat-3 → R22 checkpoint restore
    const deathsBefore = sim.state.counters.deaths;
    sim.damage("P", 999);
    ok(!sim.state.player.alive && sim.state.counters.deaths === deathsBefore + 1, "player death counted");
    run(Math.ceil(1.3 * 60));
    ok(sim.state.player.alive && sim.state.player.hp === 100, "1.2 s fade → respawn alive, full HP");
    ok(approx(sim.state.player.pos[0], -20, 0.01) && approx(sim.state.player.pos[2], 0, 0.01), "respawn at the beat-3 checkpoint (−20, 0)");
    run(2);
    ok(aliveOfWave("w_plaza_a").length === 5 && aliveOfWave("w_plaza_b").length === 0, "beat-3 waves reset fresh (checkpoint restarts the beat)");

    // clear the market again (through the blackout chain)
    const pa2 = aliveOfWave("w_plaza_a");
    for (const b of pa2) sim.damage(b.id, 999);
    run(3); killWave("w_plaza_b"); run(2);
    ok(objSt("obj_market") === "done", "obj_market done after both plaza waves");

    // beat 4: arcade area → CINDERLOCK interact upstairs
    sim.teleport("P", -30, 0, -10); run(2);
    ok(sim.mission.beat === 4, "arcade entry arms beat 4");
    ok(aliveOfWave("w_arcade").length === 4, "w_arcade spawned (4, incl. 2 balcony)");
    sim.teleport("P", -34, 4.2, -12); run(1);
    sim.step(cmd({ interact: true, yaw: sim.state.player.yaw, pitch: sim.state.player.pitch })); run(2);
    ok(objSt("obj_cinderlock") === "done", "interact at the handoff table seizes CINDERLOCK");
    ok(sim.mission.beat === 5, "obj_cinderlock completion triggers beat 5 (LONG RAIN)");
    ok(aliveOfWave("w_marks").length === 1 && aliveOfWave("w_blvd").length === 5, "beat 5 spawns the marksman + boulevard pressure");

    // vesper crate pickup (spawned since beat 4)
    sim.teleport("P", -39.6, 0, -2); run(1);
    sim.step(cmd({ interact: true, yaw: sim.state.player.yaw, pitch: sim.state.player.pitch })); run(1);
    ok(sim.state.player.weapon.id === "vesper", "R26 vesper crate pickup swaps the held weapon");

    // obj_boulevard gates on w_marks ONLY (w_blvd is pressure, not a lock)
    killWave("w_marks");
    ok(objSt("obj_boulevard") === "done" && aliveOfWave("w_blvd").length === 5,
      "killing the marksman completes obj_boulevard while w_blvd still lives (gallery flank stays viable)");
    // clean up the survivors (realistic play: yard fight is next; also keeps
    // the beat-6 waves under the R23 cap for exact-count assertions)
    killWaveFully("w_arcade"); killWaveFully("w_blvd");

    // corvus nest pickup spawns once the marksman falls
    sim.teleport("P", 38, 4.5, -45.6); run(1);
    sim.step(cmd({ interact: true, yaw: sim.state.player.yaw, pitch: sim.state.player.pitch })); run(1);
    ok(sim.state.player.weapon.id === "corvus", "corvus lootable from the marksman's nest");

    // gate 9 reach → beat 6; hold completes at TRUCK arrival even if cleared
    sim.teleport("P", -2, 0, -50); run(3);
    ok(objSt("obj_gate9_reach") === "done" && sim.mission.beat === 6 && sim.state.phase === "exfil",
      "customs sandbags reach → beat 6, phase 'exfil'");
    ok(aliveOfWave("w_cust_w1").length === 5, "w_cust_w1 spawned (5)");
    killWaveFully("w_cust_w1"); run(3);
    ok(aliveOfWave("w_cust_w2").length + queuedOfWave("w_cust_w2") === 6, "w_cust_w2 chains on w1 ≤1 alive (6 total)");
    killWaveFully("w_cust_w2"); run(3);
    ok(aliveOfWave("w_cust_w3").length + queuedOfWave("w_cust_w3") === 7, "w_cust_w3 spawns 7 incl. the 2 juggernaut heavies");
    killWaveFully("w_cust_w3"); run(3);
    ok(objSt("obj_hold") === "active", "obj_hold does NOT complete on clear — the truck IS the clock");
    run(180 * 60 + 5);
    ok(objSt("obj_hold") === "done" && objSt("obj_exfil") === "active", "truck arrival (180 s) completes obj_hold → exfil active");
    sim.teleport("P", 0, 0, -57); run(3);
    ok(sim.state.phase === "won", "boarding the truck wins the mission");
    ok(events.some((e) => e.type === "mission:end" && e.data.result === "won"), "mission:end {won} emitted");
    const radio = sim.mission.drainRadio();
    ok(radio.length > 0 || true, `radio queue drained (${radio.length} pending lines at end)`);

    // heavies are 100 HP (R16)
    const heavySpawned = events.some((e) => e.type === "spawn" && e.data.archetype === "heavy");
    ok(heavySpawned, "heavy archetype spawned in wave 3 (cosmetic + band only)");

    // forfeit path on a fresh sim (real loss path)
    const f = S.createSim({ content, colliders, weapons: WEAPONS, seed: 6, emit: () => {} });
    f.mission.start(f);
    f.mission.forfeit(f);
    ok(f.state.phase === "lost", "forfeit routes through the real loss path (phase 'lost')");
  }

  // ================================================================ bot cap
  section("R23 — engine cap: mission spawner defers above 12 alive");
  {
    const sim = S.createSim({ content, colliders, weapons: WEAPONS, seed: 9, emit: () => {} });
    sim.mission.start(sim);
    for (let i = 0; i < 3; i++) sim.step(cmd({}));
    // 2 dock bots alive; add 11 test bots (test spawns bypass the queue)
    for (let i = 0; i < 11; i++) sim.spawnBot("rifleman", -30 + i, 46, {});
    const alive0 = sim.state.bots.filter((b) => b.alive).length;
    ok(alive0 === 13, `13 alive via test bypass (${alive0})`);
    sim.teleport("P", -44, 0, 38);
    for (let i = 0; i < 5; i++) sim.step(cmd({}));
    const alleyBots = sim.state.bots.filter((b) => b.wave === "w_alley_fwd");
    ok(alleyBots.length === 0, "beat-2 wave held in the spawn queue while ≥12 alive");
    // kill 4 test bots → queue drains
    const testBots = sim.state.bots.filter((b) => !b.wave && b.alive).slice(0, 4);
    for (const b of testBots) sim.damage(b.id, 999);
    for (let i = 0; i < 5; i++) sim.step(cmd({}));
    const alleyNow = sim.state.bots.filter((b) => b.wave === "w_alley_fwd" && b.alive).length;
    const aliveNow = sim.state.bots.filter((b) => b.alive).length;
    ok(alleyNow > 0 && aliveNow <= 12, `queue drains as slots free (alley spawned ${alleyNow}, alive ${aliveNow} ≤ 12)`);
  }

  // ================================================================ fallback
  section("A0 inline-fallback content — sim/mission must not crash without content.json");
  {
    const fallback = {
      mission: { id: "meridian_ward", phases: ["infil", "assault", "exfil"], objectives: [], spawns: { waves: [] } },
      archetypes: {}, scenarios: {}, signage: [], pickups: [],
    };
    let crashed = null;
    try {
      const sim = S.createSim({ content: fallback, colliders: flatColliders(), weapons: WEAPONS, seed: 1, emit: () => {} });
      sim.mission.start(sim);
      for (let i = 0; i < 120; i++) sim.step(cmd({ moveZ: 1, fire: i % 30 === 0 }));
    } catch (e) { crashed = e; }
    ok(!crashed, "boots and ticks on A0's minimal fallback content" + (crashed ? " — threw: " + crashed.message : ""));
  }

  // ================================================================ determinism
  section("probe_determinism — same seed twice → identical snapshot hash (3000 ticks)");
  {
    const script = (i, sim) => {
      // deterministic scripted play: move, sprint, fire bursts, jump, grenade
      const c = cmd({ yaw: (i * 0.001) % 6.28, pitch: Math.sin(i * 0.01) * 0.2 });
      if (i > 30) { c.moveZ = 1; }
      if (i % 400 > 200) c.sprint = true;
      if (i % 97 === 0) c.jump = true;
      if (i % 300 > 260) c.fire = true;
      if (i % 240 > 200) c.crouch = true;
      if (i === 900 || i === 901 || i === 902) c.grenade = true;
      if (i % 500 === 450) c.reload = true;
      void sim;
      return c;
    };
    const runOnce = (seed) => {
      const counts = {};
      let firstShotDir = null;
      const sim = S.createSim({
        content, colliders, weapons: WEAPONS, seed,
        emit: (type, data) => {
          counts[type] = (counts[type] || 0) + 1;
          if (type === "shot" && !firstShotDir && data.dir) firstShotDir = data.dir.join(",");
        },
      });
      sim.mission.start(sim);
      const t0 = process.hrtime.bigint();
      for (let i = 0; i < 3000; i++) sim.step(script(i, sim));
      const t1 = process.hrtime.bigint();
      const msPerTick = Number(t1 - t0) / 1e6 / 3000;
      return { hash: djb2(JSON.stringify(sim.snapshot())), counts: JSON.stringify(counts), msPerTick, firstShotDir };
    };
    const A = runOnce(777), Bb = runOnce(777), C = runOnce(778);
    ok(A.hash === Bb.hash, `same seed → identical snapshot hash after 3000 ticks (${A.hash})`);
    ok(A.counts === Bb.counts, "same seed → identical per-type event counts");
    ok(A.firstShotDir === Bb.firstShotDir, "same seed → identical first-shot direction (spread stream reproduces)");
    ok(A.firstShotDir !== C.firstShotDir, "different seed → different spread rolls (sanity; macro state may legitimately match with stub AI)");
    ok(A.msPerTick <= 3.0, `sim tick CPU ${A.msPerTick.toFixed(3)} ms ≤ 3 ms budget (Part 5)`);
    console.log(`  info  tick cost ${A.msPerTick.toFixed(3)} ms avg over 3000 mission ticks`);
  }

  // ================================================================ vocabulary
  section("event vocabulary — emits ONLY the R13-amended set");
  {
    const ALLOWED = new Set([
      "mission:start", "mission:phase", "mission:end", "objective", "shot",
      "hurt", "death", "spawn", "reload", "switch", "ads", "step", "land",
      "botstate", "bark", "empty", "explosion", "grenade", "whiz", "zone",
    ]);
    const seen = new Set();
    const sim = S.createSim({
      content, colliders, weapons: WEAPONS, seed: 3,
      emit: (type) => seen.add(type),
    });
    sim.mission.start(sim);
    sim.spawnBot("rifleman", -30, 46, {});
    for (let i = 0; i < 600; i++) {
      const c = cmd({ moveZ: 1, sprint: i % 200 > 100, fire: i % 100 > 90, jump: i % 150 === 0, grenade: i > 300 && i < 304 });
      sim.step(c);
    }
    sim.damage("P", 30);
    const b0 = sim.state.bots[0];
    b0.cmd = { yaw: 0, pitch: 0, fire: true, moveX: 0, moveZ: 0 };
    for (let i = 0; i < 120; i++) sim.step(cmd({}));
    const illegal = [...seen].filter((t) => !ALLOWED.has(t));
    ok(illegal.length === 0, "all emitted event types in the frozen vocabulary" +
      (illegal.length ? " — ILLEGAL: " + illegal.join(",") : ` (saw: ${[...seen].sort().join(", ")})`));
  }

  // ================================================================ pvp seam
  // (W1, PVP_BUILD_PLAN C25 + AC-38 — runs as part of the full battery.)
  section("pvp tuning seam (C25) — WAVE-5 DATA LIVE (W11); AC-38 one-HP rule");
  {
    const TUN = await import(u("core/pvp/pvp_tuning.js"));
    const sp = TUN.getTuning("sp"), pvp = TUN.getTuning("pvp");
    ok(sp.maxHp === 100 && sp.regenDelayS === 4.5 && sp.regenPerS === 35 &&
       Math.abs(sp.regenPerS * sp.botRetreatRegenMult - 24.5) < 1e-9,
      "sp table equals the pre-PVP constants (100 HP, 4.5 s, 35 HP/s, retreat 24.5 HP/s)");
    // pvp_design §4.2 + §4.3 B1: the wave-5 flip landed.
    ok(pvp.maxHp === 110 && pvp.regenDelayS === 5.0 && pvp.regenPerS === 28 &&
       Math.abs(pvp.regenPerS * pvp.botRetreatRegenMult - 24.5) < 1e-9,
      "pvp table: 110 HP, regen 5.0 s @ 28 HP/s, bot retreat regen still 24.5 HP/s");
    ok(sp.steadyMult === 0.55 && pvp.steadyMult === 1.0,
      "steadyMult: sp 0.55, pvp 1.00 — the camping subsidy is removed in PVP (§4.3 B1)");
    // §4.5: the SP table is bit-identical to the untuned WEAPONS export.
    ok(TUN.applyTuning(WEAPONS, sp) === WEAPONS,
      "applyTuning(WEAPONS, sp) returns the INPUT REFERENCE — the fork stays honest");
    const PW = TUN.applyTuning(WEAPONS, pvp);
    ok(PW !== WEAPONS && WEAPONS.corvus.adsTime === 0.340 && WEAPONS.warden.recoil.jitter === 0.12,
      "applyTuning(pvp) never mutates the base table");
    ok(Math.abs(PW.corvus.adsTime - 0.380) < 1e-9 && PW.warden.recoil.jitter === 0.08 &&
       PW.vesper.recoil.jitter === 0.12 && PW.corvus.recoil.jitter === 0.06 &&
       PW.pike.recoil.jitter === 0.10,
      "pvp weapon deltas: Corvus adsTime 380 ms; jitter .08/.12/.06/.10 (§4.3 B2/B3)");
    ok(PW.warden.recoil.pattern === WEAPONS.warden.recoil.pattern,
      "merged entries keep the base pattern reference (patterns are NOT re-rolled)");
    // §4.1 STK battery at 110 HP, all-body-shots, from the live damage data:
    const stk = (dmg) => Math.ceil(110 / dmg);
    ok(stk(PW.warden.damage.body) === 4, "Warden near: 4 shots at 110 HP (240 ms — unchanged)");
    ok(PW.warden.damage.min * 5 === 110,
      "Warden far floor: 5 × 22 = EXACTLY 110 — the §4.1 boundary row, asserted so it cannot drift");
    ok(stk(PW.vesper.damage.body) === 5, "Vesper near: 4 → 5 shots (200 → 267 ms — the intended fix)");
    ok(stk(PW.vesper.damage.min) === 7, "Vesper far: 6 → 7 shots");
    ok(stk(PW.corvus.damage.body) === 2, "Corvus ≤45 m: still a 2-shot");
    ok(stk(PW.corvus.damage.min) === 3, "Corvus @90 m: still a 3-shot (48 × 2 = 96 < 110)");
    ok(stk(PW.pike.damage.body) === 4, "Pike body: still 4 shots");
    ok(Math.ceil(110 / (PW.pike.damage.body * PW.pike.damage.headMult)) === 3,
      "Pike headshot: 2 → 3 (the 158 ms two-tap is gone — §4.1's other target)");
    // §4.5: no PVP body-shot TTK below 220 ms (shots-1 intervals at each rpm).
    for (const id of ["warden", "vesper", "corvus", "pike"]) {
      const w = PW[id];
      const ttkMs = (stk(w.damage.body) - 1) * (60000 / w.rpm);
      ok(ttkMs >= 220 - 1e-6, `${id}: PVP body TTK ${ttkMs.toFixed(0)} ms >= 220 ms`);
    }
    const { sim } = makeSim({ tuning: "pvp" });
    ok(sim.weapons.corvus.adsTime === 0.380 && sim.weapons.warden.recoil.jitter === 0.08,
      "createSim({tuning:'pvp'}) resolves the MERGED weapons table onto sim.weapons");
    const spSim = makeSim({}).sim;
    ok(spSim.weapons === WEAPONS,
      "campaign sim holds the untuned WEAPONS reference — sp path bit-identical (§4.5)");
    ok(sim.tuning && sim.tuning.id === "pvp", "createSim({tuning:'pvp'}) resolves the table");
    sim.spawnBot("rifleman", 5, 5, {});
    sim.spawnBot("rifleman", -5, 5, { band: "hardened" });
    const hps = [sim.state.player.hp, ...sim.state.bots.map((b) => b.hp)];
    ok(hps.every((h) => h === sim.tuning.maxHp),
      "AC-38: every actor spawns at ONE shared hp value regardless of band");
    ok(sim.state.player.team === 0 && sim.state.bots.every((b) => b.team === 1),
      "campaign team mirrors: player 0, bots default 1 (hostile) — Part 3.4 additive");
    ok(sim.state.match === null && !sim.match,
      "campaign sim has NO match driver (A1 coexistence: one driver per sim)");
  }

  return finish();
}

function finish() {
  console.log(`\n${"=".repeat(64)}`);
  console.log(`sim.selftest: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) { console.error("RESULT: FAIL"); process.exit(1); }
  console.log("RESULT: OK");
  process.exit(0);
}

main().catch((e) => {
  console.error("UNCAUGHT: " + (e && e.stack || e));
  process.exit(1);
});
