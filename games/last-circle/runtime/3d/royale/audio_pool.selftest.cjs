/**
 * Node self-test for the PURE parts of royale/audio.js: the voice-pool admission
 * policy (voicePlan / voiceScore) and the once-per-engagement music duck
 * (fireDuckStep). Nothing here touches Web Audio — audio.js keeps every
 * browser call inside functions, so importing it in Node only defines them.
 * The browser behaviour (live sources, duck ramps, one report per shot) is
 * proven separately in a real browser; this file proves the POLICY only.
 *
 * Run: node games/last-circle/runtime/3d/royale/audio_pool.selftest.cjs
 * Exit 0 = all pass, exit 1 = a failure.
 */
"use strict";
const path = require("path");
const { pathToFileURL } = require("url");

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  PASS  " + msg); }
  else { failed++; console.error("  FAIL  " + msg); }
}

// deterministic stream for the soak test (no Math.random: a failure must replay)
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

(async () => {
  const A = await import(pathToFileURL(path.join(__dirname, "audio.js")).href);
  const { voicePlan, voiceScore, fireDuckStep, VOICE_CAP, VOICE_FRAME_BUDGET, VOICE_TIER: T } = A;
  ok(typeof voicePlan === "function" && typeof voiceScore === "function" && typeof fireDuckStep === "function",
    "audio.js exports voicePlan, voiceScore and fireDuckStep");
  ok(VOICE_CAP === 24 && VOICE_FRAME_BUDGET === 4, "cap 24, per-frame start budget 4");
  ok(T.own > T.gun && T.gun > T.step && T.step > T.impact, "tier order: own gun/hitmarker/kill > enemy gun > footsteps > impacts");

  const V = (tier, gain, start, end, frame, n) => ({ score: voiceScore(tier, gain), start, end, frame, n: n || 1 });
  const C = (tier, gain, frame, n) => ({ score: voiceScore(tier, gain), frame, n: n || 1 });

  // ── score: the tier dominates, gain only orders voices inside a tier ─────────
  ok(voiceScore(T.gun, 0.001) > voiceScore(T.step, 5), "a whisper-quiet enemy shot outranks the loudest footstep (gain clamped < 1)");
  ok(voiceScore(T.own, 0.5) > voiceScore(T.own, 0.16), "own gunshot (0.5) outranks the hitmarker blip (0.16) inside the top tier");
  ok(voiceScore(T.step, NaN) === T.step && voiceScore(T.step, -3) === T.step, "non-finite / negative gain scores as the bare tier");

  // ── admission under the limits ───────────────────────────────────────────────
  {
    const live = [V(T.step, 0.1, 0, 1, 1), V(T.gun, 0.3, 0, 1, 1)];
    const r = voicePlan(live, C(T.impact, 0.05, 2), 0.1, 24, 4);
    ok(Array.isArray(r) && r.length === 0, "below cap and budget: admitted with no victims");
  }

  // ── per-frame start budget ───────────────────────────────────────────────────
  {
    // four starts already in frame 7, plus an older, LOWER voice from frame 6
    const live = [
      V(T.impact, 0.01, 0.00, 1, 6),
      V(T.step, 0.10, 0.10, 1, 7), V(T.step, 0.12, 0.10, 1, 7),
      V(T.gun, 0.30, 0.10, 1, 7), V(T.gun, 0.35, 0.10, 1, 7),
    ];
    ok(voicePlan(live, C(T.step, 0.05, 7), 0.1, 24, 4) === null, "budget spent: a candidate below every in-frame voice is dropped");
    const r = voicePlan(live, C(T.own, 0.5, 7), 0.1, 24, 4);
    ok(r && r.length === 1 && r[0] === 1, "budget spent: own gunshot replaces the LOWEST voice of THIS frame (not the older frame-6 impact)");
    const r2 = voicePlan(live, C(T.step, 0.10, 7), 0.1, 24, 4);
    ok(r2 === null, "budget spent: an equal score never steals (strictly higher only)");
    const r3 = voicePlan(live, C(T.impact, 0.02, 8), 0.1, 24, 4);
    ok(Array.isArray(r3) && r3.length === 0, "next frame: the budget is fresh again");
  }

  // ── cap: steal lowest score, oldest on a tie ────────────────────────────────
  {
    const live = [];
    for (let i = 0; i < 24; i++) live.push(V(i < 2 ? T.impact : T.gun, i < 2 ? 0.05 : 0.3, i * 0.01, 5, 1));
    const r = voicePlan(live, C(T.gun, 0.4, 2), 0.5, 24, 4);
    ok(r && r.length === 1 && r[0] === 0, "cap full: steals the lowest score, and of two equal impacts the OLDER one");
    const lowOnly = voicePlan(live, C(T.impact, 0.01, 2), 0.5, 24, 4);
    ok(lowOnly === null, "cap full: an impact quieter than every live voice is dropped");
    // own shot vs a pool full of enemy guns: always gets in
    const guns = []; for (let i = 0; i < 24; i++) guns.push(V(T.gun, 0.9, i * 0.01, 5, 1));
    const own = voicePlan(guns, C(T.own, 0.5, 2), 0.5, 24, 4);
    ok(own && own.length === 1, "cap full of loud enemy guns: own gunshot still steals one");
    // ended voices are free space
    const ended = guns.map((v) => Object.assign({}, v, { end: 0.4 }));
    const e = voicePlan(ended, C(T.impact, 0.01, 2), 0.5, 24, 4);
    ok(Array.isArray(e) && e.length === 0, "voices whose end <= now do not count toward the cap or the budget");
  }

  // ── multi-source voices (a synth rifle report = noise + crack oscillator) ───
  {
    const live = []; for (let i = 0; i < 23; i++) live.push(V(T.step, 0.1, i * 0.01, 5, 1));
    live.push(V(T.own, 0.9, 0.5, 5, 1));          // 24 sources, one of them unbeatable
    const r = voicePlan(live, C(T.gun, 0.4, 2, 2), 0.6, 24, 4);
    ok(r && r.length === 2, "a 2-source voice at cap steals two sources");
    const tight = []; for (let i = 0; i < 23; i++) tight.push(V(T.own, 0.9, i * 0.01, 5, 1));
    tight.push(V(T.step, 0.1, 0.5, 5, 1));
    ok(voicePlan(tight, C(T.gun, 0.4, 2, 2), 0.6, 24, 4) === null,
      "all-or-nothing: if the 2nd victim outranks the candidate nothing is stolen");
    ok(voicePlan([], C(T.own, 0.5, 1, 25), 0, 24, 4) === null, "a voice bigger than the whole cap is refused");
  }

  // ── soak: 20 s of a 10-bot firefight at 60 fps (deterministic stream) ────────
  {
    const rnd = mulberry32(20260930);
    const live = []; let frame = 0, maxSrc = 0, maxStarts = 0, ownDropped = 0, ownOffered = 0, stolen = 0;
    for (let f = 0; f < 1200; f++) {
      frame++;
      const now = f / 60;
      for (let i = live.length - 1; i >= 0; i--) if (live[i].end <= now) live.splice(i, 1);
      let starts = 0;
      // per frame: ~2 enemy shots, ~1 impact, ~0.5 footsteps, an own shot every 5th frame (720 rpm)
      const offers = [];
      for (let k = 0; k < 2; k++) if (rnd() < 0.95) offers.push([T.gun, 0.05 + rnd() * 0.4, 0.25 + rnd() * 0.4]);
      if (rnd() < 0.9) offers.push([T.impact, 0.02 + rnd() * 0.08, 0.15]);
      if (rnd() < 0.5) offers.push([T.step, 0.03 + rnd() * 0.1, 0.3]);
      if (f % 5 === 0) offers.push([T.own, 0.5, 0.35]);
      if (f % 7 === 0) offers.push([T.own, 0.16, 0.07]);   // hitmarker
      // shuffle so the own shot is not always last
      for (let i = offers.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = offers[i]; offers[i] = offers[j]; offers[j] = t; }
      for (const [tier, gain, dur] of offers) {
        const cand = C(tier, gain, frame);
        const r = voicePlan(live, cand, now, 24, 4);
        if (tier === T.own && gain === 0.5) ownOffered++;
        if (!r) { if (tier === T.own && gain === 0.5) ownDropped++; continue; }
        r.sort((a, b) => b - a).forEach((vi) => { live.splice(vi, 1); stolen++; });
        live.push({ score: cand.score, start: now, end: now + dur, frame, n: 1 });
        starts++;
      }
      let src = 0; for (const v of live) src += v.n;
      if (src > maxSrc) maxSrc = src;
      // net starts this frame = voices of this frame still live (budget steals remove same-frame voices)
      const net = live.filter((v) => v.frame === frame).length;
      if (net > maxStarts) maxStarts = net;
    }
    ok(maxSrc <= 24, "soak: live sources never exceed the cap (peak " + maxSrc + ")");
    ok(maxStarts <= 4, "soak: never more than 4 net starts in one frame (peak " + maxStarts + ")");
    ok(ownOffered > 200 && ownDropped === 0, "soak: every own gunshot admitted (" + ownOffered + " offered, " + ownDropped + " dropped)");
    ok(stolen > 0, "soak: the pool actually had to steal (" + stolen + " steals) — the scenario exercises the limit");
  }

  // ── duck once per engagement ────────────────────────────────────────────────
  {
    const HOLD = 0.6;
    // one SMG mag at 600-720 rpm, a 2.0 s reload, then 0.7 s more fire: the 3.7 s burst of feel-juice G9
    const run = (rpm) => {
      const st = { on: false, last: -1 };
      let ramps = 0, releases = 0, t = 0;
      const shots = [];
      for (let i = 0; i < 30; i++) { shots.push(t); t += 60 / rpm; }
      const reloadEnd = t + 2.0; t = reloadEnd;
      while (t < 3.7) { shots.push(t); t += 60 / rpm; }
      let si = 0;
      for (let ft = 0; ft <= 5; ft += 1 / 60) {      // frames drive the release check
        while (si < shots.length && shots[si] <= ft) {
          if (fireDuckStep(st, shots[si], true, HOLD) === "engage") ramps++;
          si++;
        }
        if (fireDuckStep(st, ft, false, HOLD) === "release") releases++;
      }
      return { ramps, releases, on: st.on };
    };
    const r600 = run(600), r720 = run(720);
    ok(r600.ramps <= 2 && r720.ramps <= 2, "3.7 s SMG burst: <= 2 duck ramps (600 rpm " + r600.ramps + ", 720 rpm " + r720.ramps + "; was 30)");
    ok(r600.releases === r600.ramps && !r600.on, "every engagement is released once the trigger has been quiet for the hold");
    const st = { on: false, last: -1 };
    ok(fireDuckStep(st, 1.0, true, HOLD) === "engage" && fireDuckStep(st, 1.2, true, HOLD) === "hold",
      "a second shot inside the hold extends it without a new ramp");
    ok(fireDuckStep(st, 1.75, false, HOLD) === null && fireDuckStep(st, 1.81, false, HOLD) === "release",
      "release lands only after 0.6 s without a shot");
    ok(fireDuckStep(st, 1.9, false, HOLD) === null, "release is idempotent");
  }

  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("FAIL: selftest crashed:", e && e.stack || e); process.exit(1); });
