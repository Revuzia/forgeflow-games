/**
 * Node self-test for royale/aimassist.js (PLAN L10; DYEFIELD CONTRACT_MOBILE M3 port). aimassist.js is a pure
 * function (no THREE, no DOM), so importing it in Node only defines it. This proves the POLICY: it never acts
 * through walls, never snaps, does nothing unless firing, never acts beyond range, and uses Last Circle's angle
 * convention (weapons.js aimDir). The touch layer and its use in a real match are proven in a browser (mobile.py).
 *
 * Run: node games/last-circle/runtime/3d/royale/aimassist.selftest.cjs
 * Exit 0 = all pass, exit 1 = a failure.
 */
"use strict";
const path = require("path");
const { pathToFileURL } = require("url");

let passed = 0, failed = 0;
function ok(cond, msg, detail) {
  if (cond) { passed++; console.log("  PASS  " + msg); }
  else { failed++; console.error("  FAIL  " + msg + (detail !== undefined ? "  " + JSON.stringify(detail) : "")); }
}
const DEG = Math.PI / 180;
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-9);

// Last Circle's forward vector (weapons.js aimDir): (-sin yaw cos pitch, sin pitch, -cos yaw cos pitch)
function fwd(yaw, pitch) { return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) }; }
/** a point `dist` m from eye at (yaw + offYaw, pitch + offPitch) */
function at(eye, yaw, pitch, dist, offYawDeg, offPitchDeg) {
  const f = fwd(yaw + (offYawDeg || 0) * DEG, pitch + (offPitchDeg || 0) * DEG);
  return { x: eye.x + f.x * dist, y: eye.y + f.y * dist, z: eye.z + f.z * dist };
}

(async () => {
  const A = await import(pathToFileURL(path.join(__dirname, "aimassist.js")).href);
  const { aimAssist, SLOW_DEG, SLOW_GAIN, PULL_DEG, PULL_YAW_DEG_S, MAX_DT, CONVENTION } = A;
  ok(typeof aimAssist === "function", "aimassist.js exports aimAssist");
  ok(CONVENTION === "lc", "exports CONVENTION = 'lc' (yaw 0 faces -Z), so a caller need not probe", CONVENTION);
  ok(SLOW_DEG === 6 && SLOW_GAIN === 0.45 && PULL_DEG === 8 && PULL_YAW_DEG_S === 22 && MAX_DT === 0.1,
    "M3 numbers: slowdown 0.45 within 6 deg, pull inside 8 deg at <= 22 deg/s, dt capped at 0.1 s");

  const eye = { x: 10, y: 2, z: -5 };
  const base = (over) => Object.assign({ camYaw: 0.4, camPitch: 0.05, eye, foes: [], range: 100, firing: true, moving: true, dt: 1 / 60, strength: 1 }, over || {});
  const vis = (p) => Object.assign({ visible: true }, p);

  // ── convention: yaw 0 looks down -Z; a foe to the RIGHT pulls yaw DOWN (a finger moving right lowers yaw) ──
  {
    const e0 = { x: 0, y: 0, z: 0 };
    const centred = aimAssist({ camYaw: 0, camPitch: 0, eye: e0, foes: [vis({ x: 0, y: 0, z: -20 })], range: 100, firing: true, moving: true, dt: 1 / 60, strength: 1 });
    ok(centred.slow < 1 && near(centred.dyaw, 0, 1e-12), "yaw 0 faces -Z: a foe dead ahead at (0,0,-20) is inside the slowdown cone, zero pull", centred);
    const right = aimAssist({ camYaw: 0, camPitch: 0, eye: e0, foes: [vis({ x: 20 * Math.tan(3 * DEG), y: 0, z: -20 })], range: 100, firing: true, moving: true, dt: 1 / 60, strength: 1 });
    ok(right.dyaw < 0, "a foe 3 deg to the RIGHT (+x) pulls yaw negative (the way a rightward drag turns)", right);
    const up = aimAssist({ camYaw: 0, camPitch: 0, eye: e0, foes: [vis({ x: 0, y: 20 * Math.tan(3 * DEG), z: -20 })], range: 100, firing: true, moving: true, dt: 1 / 60, strength: 1 });
    ok(up.dpitch > 0, "a foe ABOVE the reticle pulls pitch positive (+ pitch looks up)", up);
  }

  // ── does nothing unless firing ──
  {
    const foes = [vis(at(eye, 0.4, 0.05, 30, 2, 0))];
    const idle = aimAssist(base({ foes, firing: false }));
    ok(idle.slow === 1 && idle.dyaw === 0 && idle.dpitch === 0 && idle.target === -1, "not firing: no slowdown and no pull, even with a visible foe 2 deg off", idle);
    const notBool = aimAssist(base({ foes, firing: 1 }));
    ok(notBool.slow === 1 && notBool.dyaw === 0, "firing must be the boolean true (a truthy number does nothing)", notBool);
    const idleOpt = aimAssist(base({ foes, firing: false, slowWhenIdle: true }));
    ok(near(idleOpt.slow, 1 - SLOW_GAIN) && idleOpt.dyaw === 0 && idleOpt.dpitch === 0, "slowWhenIdle (DYEFIELD M3 option): slowdown only, never a pull without firing", idleOpt);
    const firing = aimAssist(base({ foes }));
    ok(near(firing.slow, 0.55) && firing.dyaw !== 0, "firing + moving: slowdown 1 - 0.45 and a pull", firing);
    const still = aimAssist(base({ foes, moving: false }));
    ok(near(still.slow, 0.55) && still.dyaw === 0 && still.dpitch === 0, "firing but neither moving nor looking: slowdown only, no pull", still);
  }

  // ── strength scales both; 0 / NaN = off ──
  {
    const foes = [vis(at(eye, 0.4, 0.05, 30, 3, 0))];
    const half = aimAssist(base({ foes, strength: 0.5 }));
    const full = aimAssist(base({ foes, strength: 1 }));
    ok(near(half.slow, 1 - 0.45 * 0.5) && near(Math.abs(half.dyaw), Math.abs(full.dyaw) / 2, 1e-12), "strength 0.5: slowdown 0.775 and half the pull rate", { half, full });
    for (const s of [0, -1, NaN, undefined, "1"]) {
      const r = aimAssist(base({ foes, strength: s }));
      ok(r.slow === 1 && r.dyaw === 0 && r.dpitch === 0, "strength " + (typeof s === "string" ? JSON.stringify(s) + " (a string)" : String(s)) + " = off", r);
    }
    const big = aimAssist(base({ foes, strength: 7 }));
    ok(near(big.slow, 0.55), "strength is clamped to 1", big);
  }

  // ── never through walls ──
  {
    const foe = at(eye, 0.4, 0.05, 25, 1, 0);
    const wall = aimAssist(base({ foes: [Object.assign({ visible: false }, foe)] }));
    ok(wall.slow === 1 && wall.dyaw === 0 && wall.dpitch === 0 && wall.target === -1, "visible:false (behind a wall): nothing, even centred and firing", wall);
    let calls = 0;
    const cb = aimAssist(base({ foes: [foe], canSee: () => { calls++; return false; } }));
    ok(cb.slow === 1 && cb.dyaw === 0 && calls === 1, "canSee() false: nothing (the callback ran once for the in-cone foe)", { cb, calls });
    const unknown = aimAssist(base({ foes: [foe] }));
    ok(unknown.slow === 1 && unknown.dyaw === 0, "no visible flag and no canSee: treated as NOT visible", unknown);
    const thrower = aimAssist(base({ foes: [foe], canSee: () => { throw new Error("los"); } }));
    ok(thrower.slow === 1 && thrower.dyaw === 0, "a throwing canSee counts as not visible", thrower);
    const truthy = aimAssist(base({ foes: [foe], canSee: () => 1 }));
    ok(truthy.slow === 1, "canSee must return the boolean true", truthy);
    // a hidden foe in the cone never blocks a visible one, and is never the target
    const both = aimAssist(base({ foes: [Object.assign({ visible: false }, at(eye, 0.4, 0.05, 20, 0.5, 0)), vis(at(eye, 0.4, 0.05, 40, 4, 0))] }));
    ok(both.target === 1 && both.slow === 1 - SLOW_GAIN, "the hidden foe is skipped; the visible one 4 deg off is the target", both);
    // canSee is LAZY: only foes inside the 8 deg cone and inside range are tested
    const seen = [];
    aimAssist(base({
      foes: [at(eye, 0.4, 0.05, 30, 2, 0), at(eye, 0.4, 0.05, 30, 20, 0), at(eye, 0.4, 0.05, 300, 1, 0), at(eye, 0.4, 0.05, 30, 7.5, 0)],
      canSee: (f, n) => { seen.push(n); return true; },
    }));
    ok(seen.join(",") === "0,3", "canSee is called only for in-cone, in-range foes (0 at 2 deg, 3 at 7.5 deg; not 20 deg, not 300 m)", seen);
  }

  // ── range ──
  {
    const far = aimAssist(base({ foes: [vis(at(eye, 0.4, 0.05, 101, 1, 0))], range: 100 }));
    ok(far.slow === 1 && far.dyaw === 0, "a foe at 101 m with range 100: nothing", far);
    const inside = aimAssist(base({ foes: [vis(at(eye, 0.4, 0.05, 99, 1, 0))], range: 100 }));
    ok(inside.slow < 1, "a foe at 99 m with range 100: slowdown", inside);
    const r0 = aimAssist(base({ foes: [vis(at(eye, 0.4, 0.05, 10, 1, 0))], range: 0 }));
    ok(r0.slow === 1 && r0.dyaw === 0, "range 0: off", r0);
    const zero = aimAssist(base({ foes: [vis({ x: eye.x, y: eye.y, z: eye.z })] }));
    ok(zero.slow === 1 && zero.dyaw === 0, "a foe AT the eye (zero distance) is ignored", zero);
  }

  // ── cones ──
  {
    const at5 = aimAssist(base({ foes: [vis(at(eye, 0.4, 0.05, 30, 5.9, 0))] }));
    ok(near(at5.slow, 0.55) && at5.dyaw !== 0, "5.9 deg: inside the slowdown cone and pulled", at5);
    const at7 = aimAssist(base({ foes: [vis(at(eye, 0.4, 0.05, 30, 7, 0))] }));
    ok(at7.slow === 1 && at7.dyaw !== 0, "7 deg: outside the 6 deg slowdown, inside the 8 deg pull", at7);
    const at9 = aimAssist(base({ foes: [vis(at(eye, 0.4, 0.05, 30, 9, 0))] }));
    ok(at9.slow === 1 && at9.dyaw === 0 && at9.target === -1, "9 deg: nothing", at9);
    const nearest = aimAssist(base({ foes: [vis(at(eye, 0.4, 0.05, 30, 5, 0)), vis(at(eye, 0.4, 0.05, 60, -1.5, 0)), vis(at(eye, 0.4, 0.05, 20, 3, 1))] }));
    ok(nearest.target === 1 && nearest.dyaw < 0, "several foes: the one nearest the reticle in ANGLE (1.5 deg to the right, at yaw - 1.5 deg) is the target, pulled right", nearest);
  }

  // ── never snaps ──
  {
    const cap = PULL_YAW_DEG_S * DEG / 60;
    const r = aimAssist(base({ foes: [vis(at(eye, 0.4, 0.05, 30, 7.5, 0))] }));
    ok(Math.abs(r.dyaw) <= cap + 1e-12 && near(Math.abs(r.dyaw), cap, 1e-12), "7.5 deg off at 60 Hz: the yaw step is exactly the 22 deg/s cap (" + (cap / DEG).toFixed(3) + " deg)", r);
    ok(Math.abs(r.dpitch) <= cap / 2 + 1e-12, "pitch step <= half the yaw cap", r);
    const longFrame = aimAssist(base({ foes: [vis(at(eye, 0.4, 0.05, 30, 7.5, 0))], dt: 2 }));
    ok(near(Math.abs(longFrame.dyaw), PULL_YAW_DEG_S * DEG * MAX_DT, 1e-12), "a 2 s frame turns at most 22 deg/s x 0.1 s = 2.2 deg", longFrame);
    const tiny = aimAssist(base({ foes: [vis(at(eye, 0.4, 0.05, 30, 0.05, 0))] }));
    const want = Math.atan2(-(at(eye, 0.4, 0.05, 30, 0.05, 0).x - eye.x), -(at(eye, 0.4, 0.05, 30, 0.05, 0).z - eye.z)) - 0.4;
    ok(near(tiny.dyaw, want, 1e-9) && Math.abs(tiny.dyaw) < cap, "0.05 deg off: the step is the remaining error exactly (no overshoot)", { tiny, want });
    const neg = aimAssist(base({ foes: [vis(at(eye, 0.4, 0.05, 30, 7.5, 0))], dt: -1 }));
    ok(neg.dyaw === 0 && neg.dpitch === 0 && near(neg.slow, 1), "negative dt: no pull", neg);
    // closed loop: 600 frames converge monotonically, never cross the target, never exceed the cap
    const target = at(eye, 0.4, 0.05, 30, 7.9, -1.2);
    const wantYaw = Math.atan2(-(target.x - eye.x), -(target.z - eye.z));
    const wantPitch = Math.atan2(target.y - eye.y, Math.hypot(target.x - eye.x, target.z - eye.z));
    let yaw = 0.4, pitch = 0.05, maxStep = 0, crossed = false, monotone = true, prevErr = Math.abs(wantYaw - yaw);
    const sign0 = Math.sign(wantYaw - yaw);
    for (let f = 0; f < 600; f++) {
      const o = aimAssist(base({ camYaw: yaw, camPitch: pitch, foes: [vis(target)] }));
      maxStep = Math.max(maxStep, Math.abs(o.dyaw));
      yaw += o.dyaw; pitch += o.dpitch;
      const e = wantYaw - yaw;
      if (Math.sign(e) === -sign0 && Math.abs(e) > 1e-12) crossed = true;
      if (Math.abs(e) > prevErr + 1e-12) monotone = false;
      prevErr = Math.abs(e);
    }
    ok(!crossed && monotone, "closed loop (600 frames): the yaw error shrinks monotonically and never crosses zero", { err: prevErr });
    ok(maxStep <= cap + 1e-12, "closed loop: no frame turned more than the cap", { maxStepDeg: maxStep / DEG });
    ok(Math.abs(wantYaw - yaw) < 1e-6 && Math.abs(wantPitch - pitch) < 1e-6, "closed loop: it settles ON the target (yaw and pitch)", { dy: wantYaw - yaw, dp: wantPitch - pitch });
    const framesNeeded = Math.ceil((7.9 * DEG) / cap);
    ok(framesNeeded >= 21, "a 7.9 deg correction takes >= 21 frames at 60 Hz (~0.36 s): a pull, not a snap", framesNeeded);
  }

  // ── the yaw seam ──
  {
    const e0 = { x: 0, y: 0, z: 0 };
    const yaw = Math.PI - 0.01;                       // just short of +pi; the foe sits 3 deg further round (past -pi)
    const f = at(e0, yaw, 0, 30, 3, 0);
    const r = aimAssist({ camYaw: yaw, camPitch: 0, eye: e0, foes: [vis(f)], range: 100, firing: true, moving: true, dt: 1 / 60, strength: 1 });
    ok(r.dyaw > 0 && r.dyaw <= PULL_YAW_DEG_S * DEG / 60 + 1e-12, "across the +/-pi seam the pull takes the short way (small, positive)", r);
  }

  // ── bad input is safe ──
  {
    const cases = [undefined, null, {}, base({ foes: null }), base({ eye: null }), base({ camYaw: NaN }),
      base({ foes: [null, { x: NaN, y: 0, z: 0, visible: true }, { visible: true }] })];
    let allQuiet = true;
    for (const c of cases) { const r = aimAssist(c); if (!(r && r.slow === 1 && r.dyaw === 0 && r.dpitch === 0)) allQuiet = false; }
    ok(allQuiet, "undefined / null / missing / NaN inputs return the neutral result without throwing");
    const shape = aimAssist(base({ foes: [vis(at(eye, 0.4, 0.05, 30, 2, 0))] }));
    ok(["slow", "dyaw", "dpitch", "target"].every((k) => typeof shape[k] === "number"), "result shape {slow, dyaw, dpitch, target}");
  }

  console.log("\naimassist selftest: " + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("aimassist selftest crashed:", e); process.exit(1); });
