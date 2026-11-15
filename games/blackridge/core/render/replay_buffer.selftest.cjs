#!/usr/bin/env node
/* core/render/replay_buffer.selftest.cjs — kill-cam recorder battery.
 * DOM-free: ring wrap, bracketing + interpolation, teleport snap, death
 * edge, clip copy independence, shot/event windows, memory + record cost.
 * Run: node core/render/replay_buffer.selftest.cjs → exit 0/1
 */
"use strict";
const path = require("path");
const { pathToFileURL } = require("url");
const GAME_DIR = path.resolve(__dirname, "..", "..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;

let passed = 0, failed = 0;
function ok(c, m) { if (c) { passed++; console.log("  PASS  " + m); } else { failed++; console.error("  FAIL  " + m); } }
const near = (a, b, e) => Math.abs(a - b) <= e;

(async () => {
  const RB = await import(u("core/render/replay_buffer.js"));
  const { createReplayBuffer, createInterner, F, S, E, EK } = RB;
  const I = createInterner();
  const rb = createReplayBuffer({});
  ok(rb.bytes < 300 * 1024, `one buffer is ${(rb.bytes / 1024).toFixed(0)} KB (< 300 KB; three buffers < 1 MB)`);

  // 10 s at 30 Hz of 10 actors walking +x at 3 m/s; actor 3 dies at t=8.0;
  // actor 4 teleports (respawn) at t=7.0.
  const walk = I.id("walk"), dead = I.id("death_a"), warden = I.id("warden");
  const rec = (rbuf, t) => {
    rbuf.beginSample(t);
    for (let s = 0; s < 10; s++) {
      let x = s + 3 * t;
      if (s === 4 && t >= 7.0) x = 100;
      const alive = !(s === 3 && t >= 8.0);
      const fl = (alive ? F.ALIVE : 0) | F.GROUNDED | (s % 2 ? F.HAS_AIM : 0);
      rbuf.writeActor(s, x, 0, s, 0.1 * s, 0, 3, 0, x + 10, 1.5, s, fl, warden, alive ? walk : dead);
    }
    rbuf.endSample();
  };
  const t0 = process.hrtime.bigint();
  let samples = 0;
  for (let k = 0; k <= 300; k++) { rec(rb, k / 30); samples++; }
  const usPer = Number(process.hrtime.bigint() - t0) / 1e3 / samples;
  ok(usPer < 100, `record cost ${usPer.toFixed(2)} µs per 10-actor sample (budget 100 µs)`);
  ok(rb.count === rb.N, `ring is full after wrap (count ${rb.count} = N ${rb.N})`);
  ok(near(rb.newestT(), 10, 1e-9), "newest sample is t=10");
  ok(near(rb.oldestT(), 10 - (rb.N - 1) / 30, 1e-6), `oldest sample is ${rb.oldestT().toFixed(3)} (6.6 s window)`);

  const loc = { i0: 0, i1: 0, k: 0 };
  const out = {};
  ok(rb.locate(5.0 + 1 / 60, loc), "locate inside the window");
  ok(near(loc.k, 0.5, 1e-6), `half-way bracket k=${loc.k.toFixed(3)}`);
  rb.readActor(2, loc, out);
  ok(near(out.x, 2 + 3 * (5 + 1 / 60), 1e-4), `interpolated x ${out.x.toFixed(4)}`);
  ok((out.flags & F.ALIVE) !== 0 && I.str(out.anim) === "walk" && I.str(out.weapon) === "warden", "discrete fields intact");

  // teleport: actor 4 jumps 4+21 -> 100 between 6.9667 and 7.0; mid-bracket must snap not lerp
  rb.locate(7.0 - 1 / 90, loc);
  rb.readActor(4, loc, out);
  ok(out.x < 30 || out.x === 100, `teleport snaps (x=${out.x.toFixed(2)}, never a smear across the map)`);

  // death edge: at 8.0 - eps the body is alive; at 8.0 + 1/60 it is dead
  rb.locate(8.0 - 0.005, loc); rb.readActor(3, loc, out);
  ok((out.flags & F.ALIVE) !== 0, "alive just before the kill sample");
  rb.locate(8.0 + 1 / 60, loc); rb.readActor(3, loc, out);
  ok((out.flags & F.ALIVE) === 0 && I.str(out.anim) === "death_a", "dead after the kill sample");

  // absent slot
  rb.locate(9, loc);
  ok(rb.readActor(12, loc, out) === false, "absent slot reads false");

  // clamps
  rb.locate(-5, loc); ok(loc.k === 0 && near(rb.sampleTime(loc.i0), rb.oldestT(), 1e-9), "before window clamps to oldest");
  rb.locate(50, loc); ok(near(rb.sampleTime(loc.i0), 10, 1e-9), "after window clamps to newest");

  // shots + events
  for (let k = 0; k < 1500; k++) {
    const t = k / 150;
    rb.pushShot(t, k % 10, [0, 1, 0], [1, 0, 0], k % 3 ? [5, 1, 0] : null, [0, 1, 0], I.id("concrete"), -1, warden, S.STRIDE ? 1 : 0, 0);
  }
  ok(rb.shotCount === rb.SHOTS, "shot ring wraps at capacity");
  let n = 0, lastT = -1, mono = true;
  rb.forShots(8.0, 9.0, (a, b) => { n++; if (a[b] < lastT) mono = false; lastT = a[b]; });
  ok(n === 150 && mono, `shot window (8,9] yields ${n} shots oldest-first`);
  rb.pushEvent(8.0, EK.DEATH, 2, 3, 27, 0, 3, 0, 1, warden);
  rb.pushEvent(8.5, EK.EXPLOSION, -1, -1, 27, 0, 3, 5.5, 0, 0);
  const o = rb.findEvent(EK.DEATH, -1, 3, 9);
  ok(o >= 0 && rb.events[o + E.A] === 2 && rb.events[o + E.HEAD] === 1, "findEvent finds the kill (attacker slot 2, headshot)");
  ok(rb.findEvent(EK.DEATH, -1, 3, 7.9) === -1, "findEvent respects tMax");
  let ex = 0; rb.forEvents(8.2, 8.6, (a, b) => { if (a[b + E.KIND] === EK.EXPLOSION) ex++; });
  ok(ex === 1, "explosion in event window");

  // clip copy is independent of later recording
  const clip = createReplayBuffer({});
  const c0 = process.hrtime.bigint();
  clip.copyFrom(rb);
  const copyMs = Number(process.hrtime.bigint() - c0) / 1e6;
  ok(copyMs < 5, `clip copy ${copyMs.toFixed(3)} ms`);
  for (let k = 301; k <= 500; k++) rec(rb, k / 30);
  clip.locate(5.0, loc); clip.readActor(2, loc, out);
  ok(near(out.x, 17, 1e-4) && near(clip.newestT(), 10, 1e-9), "frozen clip unchanged after 200 more live samples");
  rb.locate(5.0, loc);
  ok(near(rb.sampleTime(loc.i0), rb.oldestT(), 1e-9), "live ring has moved past t=5 (clamps)");

  // yaw wrap interpolation (+3.1 -> -3.1 goes the short way)
  const yb = createReplayBuffer({ slots: 2, seconds: 1 });
  yb.beginSample(0); yb.writeActor(0, 0, 0, 0, 3.1, 0, 0, 0, 0, 0, 0, F.ALIVE, 0, 0); yb.endSample();
  yb.beginSample(0.1); yb.writeActor(0, 0, 0, 0, -3.1, 0, 0, 0, 0, 0, 0, F.ALIVE, 0, 0); yb.endSample();
  yb.locate(0.05, loc); yb.readActor(0, loc, out);
  ok(Math.abs(Math.abs(out.yaw) - Math.PI) < 0.05, `yaw lerps through ±π (${out.yaw.toFixed(3)})`);

  let threw = false; try { yb.copyFrom(rb); } catch (e) { threw = true; }
  ok(threw, "copyFrom rejects a geometry mismatch");

  console.log("\n===== " + passed + " passed, " + failed + " failed =====");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
