#!/usr/bin/env node
/* core/hud/callouts.selftest.cjs — team-chat callouts + nameplate rules (pure parts).
 *   queue      global gap 2.5 s (urgent 1.25 s), priority order, per-speaker
 *              cooldown by chattiness, same-kind cooldown, stale drop, cap
 *   phrasing   every template fills, no unfilled tokens, no forbidden words,
 *              variety (no immediate repeats)
 *   geometry   compass bearings (north = −Z, east = +X), landmark names
 *   plates     teammate alpha vs distance/aim, enemy crosshair test
 * Run: node core/hud/callouts.selftest.cjs   (exit 0 = all pass)
 */
"use strict";
const path = require("path");
const { pathToFileURL } = require("url");
const GAME_DIR = path.resolve(__dirname, "..", "..");
const u = (p) => pathToFileURL(path.resolve(GAME_DIR, p)).href;
let passed = 0, failed = 0;
function ok(c, m) { if (c) { passed++; console.log("  PASS  " + m); } else { failed++; console.error("  FAIL  " + m); } }
function section(n) { console.log("\n== " + n + " =="); }

(async () => {
  const C = await import(u("core/hud/callouts.js"));
  const NP = await import(u("core/hud/nameplates.js"));

  section("queue: rate limits + priority");
  {
    const q = C.makeQueue();
    q.offer({ kind: "reload", speaker: "A", t: 0, chat: 1 });
    q.offer({ kind: "contact", speaker: "B", t: 0, chat: 1 });
    q.offer({ kind: "kill", speaker: "C", t: 0, chat: 1 });
    const first = q.pull(0);
    ok(first && first.kind === "contact", "highest priority first (contact over kill/reload)");
    ok(q.pull(1.0) === null && q.pull(2.4) === null, "nothing inside the 2.5 s gap");
    const second = q.pull(2.5);
    ok(second && second.kind === "kill", "next line at 2.5 s, next priority (kill)");
    ok(q.pull(5.0) === null, "reload went stale (TTL 2.5 s) — never said late");
    ok(q.stats.droppedStale === 1, "stale drop counted");
  }
  {
    const q = C.makeQueue();
    q.offer({ kind: "contact", speaker: "A", t: 0, chat: 0.5 });
    q.pull(0);
    q.offer({ kind: "grenwarn", speaker: "B", t: 1.3 });
    ok(q.pull(1.3) && true, "urgent grenade warning may cut the gap to 1.25 s");
    q.offer({ kind: "kill", speaker: "C", t: 2.0 });
    ok(q.pull(2.0) === null && q.pull(3.8) !== null, "after an urgent line the 2.5 s gap applies again");
  }
  {
    const q = C.makeQueue();
    // chatty speaker: cooldown 6 + 6*(1-0.9) = 6.6 s; quiet: 6 + 6*0.8 = 10.8 s
    q.offer({ kind: "contact", speaker: "LOUD", t: 0, chat: 0.9 }); q.pull(0);
    ok(!q.offer({ kind: "kill", speaker: "LOUD", t: 5, chat: 0.9 }), "per-speaker cooldown (chatty, 5 s) blocks");
    ok(q.offer({ kind: "kill", speaker: "LOUD", t: 6.7, chat: 0.9 }), "chatty speaker free again after 6.6 s");
    const q2 = C.makeQueue();
    q2.offer({ kind: "contact", speaker: "QUIET", t: 0, chat: 0.2 }); q2.pull(0);
    ok(!q2.offer({ kind: "kill", speaker: "QUIET", t: 9, chat: 0.2 }), "quiet speaker still cooling at 9 s");
    ok(q2.offer({ kind: "kill", speaker: "QUIET", t: 10.9, chat: 0.2 }), "quiet speaker free after 10.8 s");
  }
  {
    const q = C.makeQueue();
    q.offer({ kind: "contact", speaker: "A", t: 0 }); q.pull(0);
    ok(!q.offer({ kind: "contact", speaker: "B", t: 3 }), "same kind team-wide blocked for 6 s (no echo of 'contact')");
    ok(q.offer({ kind: "contact", speaker: "B", t: 6.1 }), "same kind allowed after 6 s");
    const q4 = C.makeQueue();
    q4.offer({ kind: "smoke", speaker: "K", t: 0, chat: 1 }); q4.pull(0);
    ok(!q4.offer({ kind: "smoke", speaker: "K", t: 12, chat: 1 }), "one operator does not repeat the same call inside 18 s");
    ok(q4.offer({ kind: "smoke", speaker: "K", t: 18.1, chat: 1 }), "…and may after 18 s");
  }
  {
    const q = C.makeQueue();
    for (let i = 0; i < 12; i++) q.offer({ kind: i % 2 ? "reload" : "kill", speaker: "S" + i, t: 0 });
    ok(q.length <= C.CALLOUT.MAX_Q, `queue capped at ${C.CALLOUT.MAX_Q}`);
    // burst of 60 s of spam from 4 speakers: ≤ 1 line / 2.5 s
    const q3 = C.makeQueue();
    const shownT = [];
    const kinds = Object.keys(C.KIND_PRI);
    for (let f = 0; f < 60 * 60; f++) {
      const t = f / 60;
      if (f % 7 === 0) q3.offer({ kind: kinds[f % kinds.length], speaker: "S" + (f % 4), t, chat: 1 });
      const it = q3.pull(t);
      if (it) shownT.push({ t, pri: it.pri });
    }
    let minGap = Infinity;
    for (let i = 1; i < shownT.length; i++) {
      const g = shownT[i].t - shownT[i - 1].t;
      if (shownT[i].pri < 5) minGap = Math.min(minGap, g);
    }
    ok(minGap >= 2.5 - 1e-9, `spam test: ${shownT.length} lines in 60 s, min non-urgent gap ${minGap.toFixed(2)} s`);
    ok(shownT.length <= 60 / 1.25 + 1, "spam test: hard ceiling holds");
  }

  section("phrasing");
  const styles = ["terse", "pro", "casual", "hype"];
  let all = 0, bad = [];
  const vars = { dir: "north-east", where: " by the gallery", count: 2, side: "right", zone: "B", name: "KESTREL", streak: "Mortar Strike" };
  for (const kind of Object.keys(C.PHRASES)) {
    ok(C.KIND_PRI[kind] != null, `kind '${kind}' has a priority`);
    for (const s of styles) {
      const list = C.PHRASES[kind][s];
      ok(Array.isArray(list) && list.length >= 2, `${kind}/${s}: ≥2 variants`);
      for (let i = 0; i < list.length; i++) {
        const mem = {};
        // force each index via a fixed rng
        const txt = C.phrase(kind, s, vars, () => i / list.length + 1e-6, mem);
        all++;
        if (!txt || /[{}]/.test(txt) || !C.isClean(txt) || txt.length > 60) bad.push(`${kind}/${s}/${i}: ${txt}`);
      }
    }
  }
  ok(bad.length === 0, `${all} templates fill cleanly, ≤60 chars, no forbidden words` + (bad.length ? " — " + bad.join(" | ") : ""));
  ok(!C.isClean("the bot is reloading") && !C.isClean("AI flanking") && !C.isClean("difficulty up") && C.isClean("Contact north."), "forbidden-word guard");
  {
    const mem = {};
    let rs = 1;
    const rng = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
    let prev = null, repeats = 0;
    for (let i = 0; i < 40; i++) {
      const s = C.phrase("contact", "pro", vars, rng, mem);
      if (s === prev) repeats++;
      prev = s;
    }
    ok(repeats === 0, "no immediate repeat of a phrasing variant");
  }
  ok(C.phrase("contact", "pro", { dir: "west", count: 1 }, () => 0, {}) === "Contact west, one.", "empty {where} collapses cleanly");

  section("geometry");
  ok(C.bearingWord(0, -10) === "north" && C.bearingWord(10, 0) === "east" && C.bearingWord(0, 10) === "south" && C.bearingWord(-10, 0) === "west", "N = −Z, E = +X");
  ok(C.bearingWord(7, -7) === "north-east" && C.bearingWord(-7, 7) === "south-west", "diagonals");
  ok(Math.abs(C.bearingDeg(10, 0) - 90) < 1e-9 && Math.abs(C.bearingDeg(0, -1) - 0) < 1e-9, "bearing degrees");
  ok(C.landmarkName("gallery_north") === "north gallery" && C.landmarkName("plaza_center") === "plaza" &&
    C.landmarkName("cs1_mid") === null && C.landmarkName("yard_ne") === "north-east yard" && C.landmarkName("weigh_house") === "weigh house" && C.landmarkName("arcade_upper") === "upper arcade", "landmark names");
  const marks = C.buildLandmarks({ gallery_mid: [20, 0, -4], cs1_mid: [-26, 0, -23], plaza_center: [-5, 0, 0] });
  ok(marks.length === 2 && C.whereOf(marks, 22, -2) === " by the gallery" && C.whereOf(marks, 100, 100) === "", "nearest landmark within 14 m");

  section("nameplates");
  ok(NP.plateAlpha(10, 0) === 1 && NP.plateAlpha(70, 0) === 0, "full near, gone past 60 m");
  ok(NP.plateAlpha(41, 0) > 0.4 && NP.plateAlpha(41, 0) < 0.6, "fades with distance");
  ok(Math.abs(NP.plateAlpha(10, 40) - NP.NP.AIM_DIM_ALPHA) < 1e-9 && NP.plateAlpha(10, 20) < 1, "dims when you aim elsewhere");
  ok(NP.onCrosshair(10, 1.0) && !NP.onCrosshair(10, 5) && !NP.onCrosshair(40, 0.1), "enemy name only under the crosshair, ≤ 32 m");

  console.log(`\ncallouts selftest: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
