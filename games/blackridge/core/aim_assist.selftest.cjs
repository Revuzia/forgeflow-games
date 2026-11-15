#!/usr/bin/env node
/* core/aim_assist.selftest.cjs — lane PAD: stick math (dead zone, response
 * curves, look ramp, frame-rate independence) and the aim-assist model
 * (bubble weight, range falloff, slowdown, rotational tracking, ADS snap, LOS,
 * teammates, recoil non-interference). DOM-free.
 * Run:  node core/aim_assist.selftest.cjs     (exit 0 = all pass)
 */
"use strict";
const path = require("path");
const { pathToFileURL } = require("url");
const GAME_DIR = path.resolve(__dirname, "..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;

let passed = 0, failed = 0;
function ok(c, m) { if (c) { passed++; console.log("  PASS  " + m); } else { failed++; console.error("  FAIL  " + m); } }
function section(n) { console.log("\n== " + n + " =="); }
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const DEG = Math.PI / 180;

async function main() {
  const G = await import(u("core/input_gamepad.js"));
  const A = await import(u("core/aim_assist.js"));
  const W = await import(u("core/sim/world.js"));

  section("radial dead zone");
  ok(G.radialDeadzone(0.08, 0.0, 0.1).mag === 0, "drift 0.08 inside dz 0.10 -> 0");
  ok(G.radialDeadzone(0.06, 0.06, 0.1).mag === 0, "diagonal drift |0.085| -> 0");
  const full = G.radialDeadzone(1, 0, 0.1);
  ok(near(full.mag, 1) && near(full.x, 1), "full push -> mag 1");
  const just = G.radialDeadzone(0.11, 0, 0.1);
  ok(just.mag > 0 && just.mag < 0.02, "just past the dead zone is small (no jump) " + just.mag.toFixed(4));
  const dg = G.radialDeadzone(0.5, -0.5, 0.1);
  ok(near(dg.x, -dg.y), "direction preserved");
  ok(G.radialDeadzone(NaN, 0, 0.1).mag === 0, "NaN axis -> 0");

  section("response curves");
  for (const k of ["linear", "standard", "dynamic"]) {
    ok(near(G.responseCurve(0, k), 0) && near(G.responseCurve(1, k), 1), `${k}: f(0)=0, f(1)=1`);
    let mono = true, last = -1;
    for (let i = 0; i <= 100; i++) { const v = G.responseCurve(i / 100, k); if (v < last - 1e-9) mono = false; last = v; }
    ok(mono, `${k}: monotonic`);
  }
  ok(G.responseCurve(0.5, "standard") < G.responseCurve(0.5, "linear"), "standard finer than linear mid-stick");
  ok(G.responseCurve(0.2, "dynamic") < G.responseCurve(0.2, "standard"), "dynamic finest near centre");
  ok(G.responseCurve(0.95, "dynamic") > G.responseCurve(0.95, "standard"), "dynamic faster near the rim");

  section("look acceleration + frame-rate independence");
  ok(G.accelMultiplier(0.1, 1) === 1, "no ramp before the delay");
  ok(near(G.accelMultiplier(5, 1), 1 + G.ACCEL_MAX), "full ramp = 1 + ACCEL_MAX");
  ok(G.accelMultiplier(5, 0) === 1, "padAccel 0 disables the ramp");
  const turn = (fps) => { let y = 0; for (let i = 0; i < fps; i++) y += G.lookDelta(0.7, 0, 1 / fps, { dead: 0.1, curve: "standard" }).dYaw; return y; };
  ok(near(turn(30), turn(144), 1e-9), `1 s of 0.7 right stick: 30 fps ${turn(30).toFixed(6)} == 144 fps ${turn(144).toFixed(6)} rad`);
  const fr = G.lookDelta(1, 0, 1, { dead: 0.1, curve: "linear" });
  ok(near(-fr.dYaw, G.LOOK_YAW_RATE), "full push, sens 1 = LOOK_YAW_RATE rad/s");
  const up = G.lookDelta(0, -1, 0.1, { dead: 0.1, curve: "linear" }).dPitch;
  const upInv = G.lookDelta(0, -1, 0.1, { dead: 0.1, curve: "linear", invertY: true }).dPitch;
  ok(up > 0 && near(upInv, -up), "stick up = look up; invert Y flips it");
  ok(near(G.lookDelta(1, 0, 0.1, { dead: 0.1, curve: "linear", slow: 0.5 }).dYaw, -G.LOOK_YAW_RATE * 0.05), "slow multiplier scales the rate");
  ok(G.padLayout("054c-0ce6-Wireless Controller") === "ps" && G.padLayout("Xbox 360 Controller (XInput STANDARD GAMEPAD)") === "xbox" &&
    G.padLayout("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e)") === "xbox", "layout detection");

  section("assist weights");
  ok(A.angleWeight(0, 0.1) === 1 && A.angleWeight(0.1, 0.1) === 0 && A.angleWeight(0.2, 0.1) === 0, "weight 1 at centre, 0 at/after rim");
  ok(A.angleWeight(0.03, 0.1) === 1 && A.angleWeight(0.07, 0.1) < 1, "flat core (35%) then falloff");
  ok(A.rangeFactor(10, 32, 58) === 1 && A.rangeFactor(200, 32, 58) === 0, "range factor 1 near, 0 far");
  const r60 = A.rangeFactor(60, 32, 58);
  ok(r60 > 0 && r60 < 1, "range factor partial mid-range (60 m Warden: " + r60.toFixed(3) + ")");
  ok(A.slowdownFactor(1, null, false) === 1, "Off preset -> no slowdown");
  ok(near(A.slowdownFactor(1, A.PRESETS.standard, false), 0.55), "Standard full weight -> 0.55x look rate");
  ok(near(A.slowdownFactor(1, A.PRESETS.focused, false), 0.40), "Focused full weight -> 0.40x look rate");
  ok(A.slowdownFactor(1, A.PRESETS.standard, true) < A.slowdownFactor(1, A.PRESETS.standard, false), "ADS slows a touch more");
  ok(A.bubbleAngle(5, 1.1) <= A.BUBBLE_MAX && A.bubbleAngle(500, 1.1) === A.BUBBLE_MIN, "bubble clamped");

  section("assist model on a fake sim");
  const flat = (boxes) => W.makeWorld({ boxes: boxes || [], groundY: () => 0 });
  const mkSim = (bots, boxes) => ({
    world: flat(boxes),
    state: { player: { pos: [0, 0, 0], alive: true, team: 0, stance: "stand" }, bots },
  });
  const chestPitch = (d) => Math.atan2(1.20 - 1.62, d);
  const WARDEN = { damage: { falloffStart: 32, falloffEnd: 58 } };
  const view = (o) => Object.assign({ yaw: 0, pitch: chestPitch(20), ads: false, adsStart: false, moving: false, looking: true, strength: "standard", weapon: WARDEN }, o);

  const bot = { id: "b1", pos: [0, 0, -20], alive: true, team: 1, stance: "stand" };
  let aa = A.createAimAssist();
  let o = aa.update(1 / 60, view({ sim: mkSim([bot]) }));
  ok(o.target === "b1" && o.slow < 0.6, `on target at 20 m: slow ${o.slow.toFixed(3)}`);
  aa = A.createAimAssist();
  o = aa.update(1 / 60, view({ sim: mkSim([bot]), yaw: 20 * DEG }));
  ok(o.target === null && o.slow === 1, "20° off -> no assist");
  aa = A.createAimAssist();
  o = aa.update(1 / 60, view({ sim: mkSim([bot]), strength: "off" }));
  ok(o.slow === 1 && o.target === null, "strength Off -> nothing");
  aa = A.createAimAssist();
  o = aa.update(1 / 60, view({ sim: mkSim([Object.assign({}, bot, { team: 0 })]) }));
  ok(o.target === null && o.slow === 1, "teammate -> never assisted");
  aa = A.createAimAssist();
  o = aa.update(1 / 60, view({ sim: mkSim([Object.assign({}, bot, { alive: false })]) }));
  ok(o.target === null, "dead body -> never assisted");
  const wall = { min: [-3, 0, -11], max: [3, 4, -10], surface: "concrete" };
  aa = A.createAimAssist();
  o = aa.update(1 / 60, view({ sim: mkSim([bot], [wall]) }));
  ok(o.target === null && o.slow === 1, "wall between -> no assist");
  {
    // LOS cache must not survive a move behind cover (same assist, same 0.1 s window)
    const mover = Object.assign({}, bot, { pos: [0, 0, -20] });
    const simW = mkSim([mover], [{ min: [3, 0, -11], max: [7, 4, -10], surface: "concrete" }]);
    const a = A.createAimAssist();
    const r1 = { target: a.update(1 / 60, view({ sim: simW })).target }; // out object is reused
    mover.pos = [9, 0, -20];
    const r2 = a.update(1 / 60, view({ sim: simW, yaw: Math.atan2(-9, 20) }));
    ok(r1.target === "b1" && r2.target === null, "target steps behind a wall -> assist drops the same frame");
  }
  const lowWall ={ min: [-3, 0, -11], max: [3, 1.4, -10], surface: "concrete" };
  aa = A.createAimAssist();
  o = aa.update(1 / 60, view({ sim: mkSim([bot], [lowWall]) }));
  ok(o.target === "b1", "chest hidden, head visible over low cover -> assisted");
  const smokeSim = mkSim([bot]); smokeSim.state.smokes = [{ pos: [0, 1.5, -10], r: 3 }];
  aa = A.createAimAssist();
  o = aa.update(1 / 60, view({ sim: smokeSim }));
  ok(o.target === null, "smoke sphere between -> no assist");
  const far = { id: "b2", pos: [0, 0, -200], alive: true, team: 1 };
  aa = A.createAimAssist();
  o = aa.update(1 / 60, view({ sim: mkSim([far]), pitch: chestPitch(200) }));
  ok(o.target === null, "200 m -> beyond range falloff");

  section("rotational assist tracks a strafing target, frame-rate independent");
  function strafeRun(fps, opts) {
    const b = { id: "s", pos: [0, 0, -15], alive: true, team: 1, stance: "stand" };
    const sim = mkSim([b]);
    const a = A.createAimAssist();
    let yaw = 0, pitch = chestPitch(15), total = 0;
    const dt = 1 / fps, speed = 2.5; // m/s sideways, 0.6 s
    a.update(dt, view({ sim, yaw, pitch, moving: true })); // prime (lock-on frame)
    for (let i = 0; i < Math.round(fps * 0.6); i++) {
      b.pos[0] += speed * dt;
      const r = a.update(dt, view({ sim, yaw, pitch, moving: !!(opts && opts.moving), looking: !!(opts && opts.looking) }));
      yaw += r.dYaw; pitch += r.dPitch; total += r.dYaw;
    }
    const targetYaw = Math.atan2(-b.pos[0], 15);
    return { total, targetYaw, err: targetYaw - yaw };
  }
  const s60 = strafeRun(60, { moving: true }), s144 = strafeRun(144, { moving: true });
  ok(s60.total < 0 && Math.abs(s60.err) < Math.abs(s60.targetYaw), `follows: turned ${(s60.total / DEG).toFixed(2)}° of the target's ${(s60.targetYaw / DEG).toFixed(2)}° bearing change`);
  ok(Math.abs(s60.total - s144.total) < 0.03 * Math.abs(s60.total), `60 fps ${(s60.total / DEG).toFixed(3)}° ~= 144 fps ${(s144.total / DEG).toFixed(3)}°`);
  const idle = strafeRun(60, {});
  ok(idle.total === 0, "player neither moving nor looking -> no rotational assist");

  section("recoil is never fought");
  {
    const sim = mkSim([bot]);
    const a = A.createAimAssist();
    let yaw = 0, pitch = chestPitch(20), rot = 0;
    for (let i = 0; i < 30; i++) {
      pitch += 0.004; // recoil climbs the view; target static
      const r = a.update(1 / 60, view({ sim, yaw, pitch, moving: true }));
      rot += Math.abs(r.dPitch) + Math.abs(r.dYaw);
    }
    ok(rot === 0, "static target, view kicked by recoil -> zero assist rotation (bearing-based)");
  }

  section("ADS snap");
  {
    const sim = mkSim([bot]);
    const a = A.createAimAssist();
    const err = 3 * DEG;
    let yaw = err, total = 0;
    for (let i = 0; i < 20; i++) {
      const r = a.update(1 / 60, view({ sim, yaw, ads: true, adsStart: i === 0, looking: false }));
      yaw += r.dYaw; total += r.dYaw;
    }
    ok(near(-total, err * A.PRESETS.standard.snap, 1e-6), `snap pulls ${(-total / DEG).toFixed(3)}° of a 3° error (= 60%) over ${A.SNAP_TIME}s`);
    const b2 = A.createAimAssist();
    let t2 = 0;
    for (let i = 0; i < 20; i++) t2 += b2.update(1 / 60, view({ sim, yaw: 9 * DEG, ads: true, adsStart: i === 0, looking: false })).dYaw;
    ok(t2 === 0, "9° off (outside the 5° cone) -> no snap");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(failed ? "AIM ASSIST SELFTEST: FAIL" : "AIM ASSIST SELFTEST: PASS");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
