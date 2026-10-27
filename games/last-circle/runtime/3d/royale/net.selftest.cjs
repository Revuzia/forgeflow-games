/**
 * Node self-test for royale/net.js - the squad VERSION GUARD (Wave 7, lane 7C, contract C-VER).
 * Run: node games/last-circle/runtime/3d/royale/net.selftest.cjs      (gate.py picks it up with the other *.selftest.cjs)
 * Exit 0 = every row passed, 1 = a failure.  net.js has no DOM / THREE use at import time, so this loads the REAL module and drives the
 * same pure handshake (SquadHandshake, judgeGv, normGv, the two host lines) the lobby code calls; the lobby, the sends and the on-screen
 * message are proven in a real browser by _harness/squadguard_live.py (two pages, a fake relay, real clicks).
 *
 * What it asserts:
 *   normGv: a missing / string / NaN / negative / fractional / huge value is version 1 | judgeGv: equal -> null, older/newer -> who must reload
 *   same version: hello both ways, the host's roster has every guest in sorted-id slots, the guest's judgeStart is null, the cap still
 *     leaves the 4th+ guest "over" | a guest ONE version behind and one ahead: the guest refuses the HOST's hello at once (refuseNow), the
 *     host never refuses, the host's roster leaves it out and says which version | a pre-guard peer (no gv, no host flag) is version 1:
 *     left out of a v3 host's roster; a v3 guest facing a pre-guard host refuses at START (a start without gv), and learns the slot the
 *     old host gave it so it can free it | a mixed room (v3 host, v3 / v2 / v3 guests) rosters exactly the v3 guests | every message
 *     survives the JSON round trip the relay applies | the version query rides every import edge of net.js (static, on the source).
 * Planted faults (negative controls): a roster that ignores the version, a guest that treats a missing gv as "same", a normGv that maps a
 * missing gv to the local version - each must make at least one row fail.
 *
 * Wave 7 completion round (lane D1, contract C-FALLBACK): a page whose towngen.js / citykit.js failed to import builds the Wave-6 Savanna layout
 * while it advertises MAP_GEN_VERSION, so it must leave the squad. Rows: normFallback reads both shapes maps.js uses ({ from, to, reason } and
 * { genVersion, wanted, reason }) | judgeFallback is the plain-language card text (names the map failure, says reload) | fallbackLine is what the
 * room reads | detectMapFallback finds the fallback from the event, map.fallback, a built genVersion that differs from the advertised one, or
 * W.mapFallback - and ignores a STALE W.mapFallback when the built map is healthy | SquadHandshake.onMapFail takes slot / name / host from the
 * roster, never from the message body (a peer cannot kick another peer's slot), and ignores a sender that is not in the match | the "mapfail"
 * message is in the CRITICAL list, the event is wired, onMatchStart and update act on it (static, on the source). Planted faults: a spoofable
 * onMapFail, a detector that ignores a differing genVersion, a detector that trusts a stale W.mapFallback, a normFallback that only reads one
 * shape, a source without the CRITICAL entry - each must fail at least one row. The leave itself (messages, bots, the card) needs the DOM and a
 * match: _harness/squadguard_live.py case "fallback".
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const NET_JS = path.join(__dirname, "net.js");
let passed = 0, failed = 0;
function ok(cond, msg, detail) {
  if (cond) { passed++; console.log("  PASS  " + msg); }
  else { failed++; console.error("  FAIL  " + msg + (detail !== undefined ? "   -> " + JSON.stringify(detail) : "")); }
}
const T0 = Date.now();
const rt = (o) => JSON.parse(JSON.stringify(o));      // what the relay does to every message

/** One suite of handshake rows against an implementation (the real module, or a planted-fault copy). Returns the failures it saw,
 *  counted into the globals only when `count` (the mutants must fail rows without failing the run). */
function suite(M, label, count) {
  let bad = 0;
  const row = (cond, msg, detail) => { if (!cond) bad++; if (count) ok(cond, msg, detail); };
  const { SquadHandshake } = M;
  const mk = (id, gv, host, name) => new SquadHandshake({ id, name: name || id, gv, host });
  // a tiny relay: deliver `from`'s hello to the others, collect what each one decides
  const hello = (from, to) => to.onHello(from.id, rt(from.helloMsg()));

  // ── same version: everything as before ──────────────────────────────────────────────────────────────────────────────────────────────
  {
    const host = mk("a_h", 3, true, "Host"), g1 = mk("b_1", 3, false, "G1"), g2 = mk("c_2", 3, false, "G2");
    const hg1 = hello(g1, host), hg2 = hello(g2, host), gh1 = hello(host, g1), gh2 = hello(host, g2), g12 = hello(g2, g1);
    row(hg1.first && hg2.first && gh1.first && gh2.first && g12.first, "same version: every first sighting is reported (the hello reply is sent once)");
    row(!hg1.mismatch && !hg2.mismatch && !gh1.mismatch && !gh2.mismatch && !g12.mismatch, "same version: no mismatch anywhere");
    row(gh1.refuseNow === null && gh2.refuseNow === null, "same version: a guest does not refuse the host");
    const again = hello(g1, host);
    row(again.first === false, "a repeated hello is not a first sighting (no reply storm)");
    const names = { b_1: "G1", c_2: "G2" };
    const plan = host.planStart(names, 3);
    row(plan.roster.length === 3 && plan.left.length === 0 && plan.over.length === 0, "same version: both guests are rostered", plan);
    row(plan.roster[0].peerId === "a_h" && plan.roster[0].slot === 0 && plan.roster[1].peerId === "b_1" && plan.roster[1].slot === 1 &&
        plan.roster[2].peerId === "c_2" && plan.roster[2].slot === 2, "same version: host is slot 0, guests take slots 1.. in sorted peer-id order", plan.roster);
    const msg = rt(host.startMsg({ seed: 123456, mapId: "ashgrid", mode: "standard", roster: plan.roster }));
    row(msg.seed === 123456 && msg.mapId === "ashgrid" && msg.mode === "standard" && msg.roster.length === 3 && msg.gv === 3, "the start message keeps every old field and adds gv", msg);
    row(g1.judgeStart(msg) === null && g2.judgeStart(msg) === null, "same version: the guests start (judgeStart null)");
    // the cap: 5 guests at the same version -> 3 rostered, 2 'over' (the old truncation, unchanged)
    const h5 = mk("a_h", 3, true), nm = {};
    for (let i = 0; i < 5; i++) { const g = mk("g" + i, 3, false); h5.onHello(g.id, rt(g.helloMsg())); nm[g.id] = "G" + i; }
    const p5 = h5.planStart(nm, 3);
    row(p5.roster.length === 4 && p5.over.length === 2 && p5.left.length === 0 && p5.over[0].peerId === "g3", "the MAX_GUESTS cap still cuts the 4th+ guest ('over', not 'left')", p5);
  }
  // ── a guest one version BEHIND ─────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const host = mk("a_h", 3, true, "Host"), g = mk("b_1", 2, false, "Old");
    const gh = hello(host, g), hg = hello(g, host);
    row(gh.refuseNow && gh.refuseNow.mineOlder === true && gh.refuseNow.reload === true && gh.refuseNow.local === 2 && gh.refuseNow.remote === 3,
      "a v2 guest facing a v3 host refuses at its hello (page is older -> reload)", gh.refuseNow);
    row(gh.refuseNow && /reload the page/i.test(gh.refuseNow.detail) && /version 3/.test(gh.refuseNow.detail) && /version 2/.test(gh.refuseNow.detail),
      "the guest's message names both versions and says to reload", gh.refuseNow && gh.refuseNow.detail);
    row(hg.refuseNow === null && hg.mismatch && hg.mismatch.local === 3 && hg.mismatch.remote === 2, "the HOST never refuses; it sees the mismatch", hg);
    const plan = host.planStart({ b_1: "Old" }, 3);
    row(plan.roster.length === 1 && plan.left.length === 1 && plan.left[0].peerId === "b_1" && plan.left[0].gv === 2, "the host's roster leaves the v2 guest out and records its version", plan);
    // a start that reached it anyway (hello lost): it refuses at START too
    const j = g.judgeStart(rt(host.startMsg({ seed: 1, mapId: "ashgrid", mode: "standard", roster: plan.roster })));
    row(j && j.mineOlder && j.slot === null, "a start message that still reaches the v2 guest is refused (not in the roster: no slot to free)", j);
    row(M.refusalLine("Old", 2, 3).includes("Old") && /reload the page/i.test(M.refusalLine("Old", 2, 3)), "the host's line names the guest and says THEY reload");
  }
  // ── a guest one version AHEAD ───────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const host = mk("a_h", 3, true), g = mk("b_1", 4, false);
    const gh = hello(host, g);
    row(gh.refuseNow && gh.refuseNow.mineOlder === false && gh.refuseNow.reload === false && /ask the host/i.test(gh.refuseNow.detail),
      "a v4 guest facing a v3 host refuses and says to ask the host to reload (no reload button)", gh.refuseNow);
    row(/reload this page/i.test(M.refusalLine("New", 4, 3)), "the host's line tells the HOST to reload when the guest is newer");
  }
  // ── a pre-guard peer: no gv, no host flag ───────────────────────────────────────────────────────────────────────────────────────────
  {
    const host = mk("a_h", 3, true);
    const oldHello = rt({ name: "Stale" });                         // exactly what the live build 60b854d0 sends
    const r = host.onHello("b_1", oldHello);
    row(r.rec.gv === 1 && r.rec.host === false && r.mismatch && r.mismatch.remote === 1, "a hello without gv is version 1", r);
    const plan = host.planStart({ b_1: "Stale" }, 3);
    row(plan.roster.length === 1 && plan.left.length === 1 && plan.left[0].gv === 1, "a pre-guard guest is left out of a v3 host's roster", plan);
    row(host.gvOf("never_said_hello") === 1, "a peer that never said hello counts as version 1");
    // a v3 GUEST facing a pre-guard HOST: the host's hello has no host flag, so the refusal happens at START
    const g = mk("b_1", 3, false);
    const gh = g.onHello("a_h", rt({ name: "OldHost" }));
    row(gh.refuseNow === null && gh.mismatch, "a v3 guest cannot tell a pre-guard peer is the host from its hello (no refuse yet)", gh);
    const oldStart = rt({ seed: 99, mapId: "deepwood", mode: "standard", roster: [{ peerId: "a_h", slot: 0, name: "OldHost" }, { peerId: "b_1", slot: 1, name: "G" }] });
    const j = g.judgeStart(oldStart);
    row(j && j.mineOlder === false && j.remote === 1 && j.reload === false && j.slot === 1, "...but a start without gv is refused, and the slot the old host gave us is known so it can be freed (bye)", j);
    const j2 = g.judgeStart(rt({ seed: 99, mapId: "deepwood", mode: "standard", roster: [{ peerId: "a_h", slot: 0, name: "OldHost" }] }));
    row(j2 && j2.slot === null, "...and a start whose roster left us out has no slot to free", j2);
  }
  // ── mixed room ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const host = mk("a_h", 3, true), nm = {};
    for (const [id, gv] of [["b_1", 3], ["c_2", 2], ["d_3", 3]]) { host.onHello(id, rt(mk(id, gv, false).helloMsg())); nm[id] = id; }
    const plan = host.planStart(nm, 3);
    row(plan.roster.map((r) => r.peerId).join() === "a_h,b_1,d_3" && plan.roster.map((r) => r.slot).join() === "0,1,2" && plan.left.map((l) => l.peerId).join() === "c_2",
      "mixed room: the roster is the host + the two v3 guests in slots 0,1,2; the v2 guest is left out (it takes no slot)", plan);
  }
  // ── malformed input never throws or poisons the table ───────────────────────────────────────────────────────────────────────────────
  {
    const host = mk("a_h", 3, true);
    let threw = null;
    try {
      host.onHello("x", undefined); host.onHello("y", null); host.onHello("z", { gv: "3", host: "1" }); host.onHello("w", { gv: 3.5 }); host.onHello("v", { gv: -2, name: 7 });
      host.judgeStart(undefined); host.judgeStart({ roster: "nope" }); host.planStart({ x: undefined }, 3);
    } catch (e) { threw = String(e); }
    row(threw === null, "malformed hello / start bodies do not throw", threw);
    row(host.gvOf("z") === 1 && host.gvOf("w") === 1 && host.gvOf("v") === 1, "a string / fractional / negative gv is version 1");
  }
  // ── C-FALLBACK: the pure parts ──────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const { normFallback, judgeFallback, fallbackLine, detectMapFallback } = M;
    const nf1 = normFallback(rt({ from: 3, to: 2, reason: "import failed" })), nf2 = normFallback(rt({ map: "ashgrid", genVersion: 2, wanted: 3, reason: "x" }));
    row(nf1 && nf1.wanted === 3 && nf1.built === 2 && nf1.reason === "import failed", "normFallback reads the contract shape { from, to, reason }", nf1);
    row(nf2 && nf2.wanted === 3 && nf2.built === 2 && nf2.reason === "x", "normFallback reads the maps.js event / map.fallback shape { genVersion, wanted, reason }", nf2);
    const nf3 = normFallback(rt({ from: "3", to: NaN, reason: { a: 1 } }));
    row(nf3 && nf3.wanted === null && nf3.built === null && typeof nf3.reason === "string", "normFallback: a non-number version is null, a reason is always a string", nf3);
    row(normFallback(null) === null && normFallback(undefined) === null && normFallback("x") === null && normFallback(7) === null, "normFallback: not an object -> null");
    row(normFallback({ reason: "r".repeat(900) }).reason.length === 200, "normFallback: the reason is cut at 200 characters");

    const jf = judgeFallback(3, normFallback({ from: 3, to: 2, reason: "boom" }));
    row(/part of the map failed to load/i.test(jf.title) && /reload the page/i.test(jf.detail) && /different world/i.test(jf.detail) && /left the room/i.test(jf.detail) &&
        jf.reload === true && jf.wanted === 3 && jf.built === 2, "judgeFallback: the card says part of the map failed to load, that the player left the room, and to reload the page", jf);
    const jf0 = judgeFallback(undefined, null);
    row(jf0.wanted === 1 && jf0.built === null && jf0.reload === true, "judgeFallback: a missing record still gives a card (version 1, built unknown)", jf0);

    const fl = fallbackLine("Ann", false), flh = fallbackLine("Bob", true);
    row(/Ann/.test(fl) && /map failed to load/i.test(fl) && /reload the page/i.test(fl) && /bot has their place/i.test(fl), "fallbackLine: a guest line names the player, the map failure, the bot and the reload", fl);
    row(/Bob/.test(flh) && /the host/i.test(flh) && /map failed to load/i.test(flh) && /offline/i.test(flh), "fallbackLine: a host line says the host left and the match carries on offline", flh);
    row(fallbackLine("", false).startsWith("A player") && fallbackLine("x".repeat(80), false).indexOf("x".repeat(25)) === -1, "fallbackLine: a missing name is 'A player', a long one is cut at 24");

    const healthy = { map: { genVersion: 3 } };
    row(detectMapFallback(healthy, 3, null) === null, "detect: a healthy map (built = advertised, no fallback record) -> null");
    row(detectMapFallback({}, 3, null) === null && detectMapFallback(undefined, 3, null) === null && detectMapFallback(null, 3, null) === null, "detect: no W / no map -> null, never throws");
    const ev = detectMapFallback(healthy, 3, normFallback({ from: 3, to: 2, reason: "e" }));
    row(ev && ev.via === "event" && ev.wanted === 3 && ev.built === 2, "detect: the mapFallback event of this session's load wins", ev);
    const byMap = detectMapFallback({ map: { genVersion: 2, fallback: { reason: "r", genVersion: 2, wanted: 3 } } }, 3, null);
    row(byMap && byMap.via === "map.fallback" && byMap.built === 2 && byMap.wanted === 3, "detect: map.fallback is found", byMap);
    const byGv = detectMapFallback({ map: { genVersion: 2 } }, 3, null);
    row(byGv && byGv.via === "genVersion" && byGv.wanted === 3 && byGv.built === 2, "detect: a built genVersion that differs from the advertised one is a fallback even with no record", byGv);
    const noGv = detectMapFallback({ map: {} }, 3, null);
    row(noGv === null, "detect: a map with no genVersion field (an old maps.js) is not a fallback", noGv);
    const stale = detectMapFallback({ map: { genVersion: 3 }, mapFallback: { from: 3, to: 2, reason: "an EARLIER match" } }, 3, null);
    row(stale === null, "detect: a STALE W.mapFallback left by an earlier match is ignored when the built map is healthy", stale);
    const stub = detectMapFallback({ mapFallback: { from: 3, to: 2, reason: "stub" } }, 3, null);
    row(stub && stub.via === "W.mapFallback" && stub.built === 2, "detect: W.mapFallback is used when there is no built map to contradict it", stub);
    const contra = detectMapFallback({ map: { genVersion: 2 }, mapFallback: { from: 3, to: 2, reason: "c" } }, 3, null);
    row(contra && contra.built === 2 && contra.wanted === 3, "detect: W.mapFallback and a differing built genVersion agree", contra);

    // onMapFail: the roster decides, not the message
    const host = mk("a_h", 3, true, "Host");
    const roster = [{ peerId: "a_h", slot: 0, name: "Host" }, { peerId: "b_1", slot: 1, name: "G1" }, { peerId: "c_2", slot: 2, name: "G2" }];
    const body = rt({ name: "G1", gv: 3, wanted: 3, built: 2, reason: "import failed", host: 0, slot: 1 });
    const mf = host.onMapFail("b_1", body, roster);
    row(mf && mf.slot === 1 && mf.id === "s1" && mf.host === false && mf.name === "G1" && mf.wanted === 3 && mf.built === 2 && /G1/.test(mf.line) && /map failed to load/i.test(mf.line),
      "onMapFail: a guest's mapfail gives its slot (s1), its roster name, the versions and the line the room reads", mf);
    const mfh = host.onMapFail("a_h", rt({ name: "Host", wanted: 3, built: 2, host: 1, slot: 0 }), roster);
    row(mfh && mfh.slot === 0 && mfh.id === "s0" && mfh.host === true && /the host/i.test(mfh.line), "onMapFail: slot 0 is the host (guests treat it like a lost host)", mfh);
    const spoof = host.onMapFail("b_1", rt({ name: "Evil", wanted: 3, built: 2, host: 1, slot: 2 }), roster);
    row(spoof && spoof.slot === 1 && spoof.id === "s1" && spoof.host === false && spoof.name === "G1", "onMapFail: a body that claims slot 2 / host / another name cannot kick somebody else's slot (the roster wins)", spoof);
    row(host.onMapFail("z_9", body, roster) === null, "onMapFail: a sender that is not in the match's roster -> null (nothing to free)");
    row(host.onMapFail("b_1", body, undefined) === null && host.onMapFail("b_1", body, "nope") === null && host.onMapFail("b_1", body, []) === null, "onMapFail: no roster -> null");
    let threw = null;
    try { host.onMapFail("b_1", undefined, roster); host.onMapFail("b_1", null, roster); host.onMapFail("b_1", { wanted: "x", built: {}, reason: 5 }, roster); host.onMapFail("b_1", "s", roster); } catch (e) { threw = String(e); }
    row(threw === null, "onMapFail: a malformed body does not throw", threw);
  }
  return bad;
}

/** PARITY WAVE P1, lane P1-D rows (the real module, or a planted-fault copy). Same counting rule as suite(). */
function suiteP1D(M, SIM, count) {
  let bad = 0;
  const row = (cond, msg, detail) => { if (!cond) bad++; if (count) ok(cond, msg, detail); };
  const mk = (id, gv, host, name) => new M.SquadHandshake({ id, name: name || id, gv, host });
  // ── LC-11 presence: the phantom.mjs scenario (verify/lc11) ─────────────────────────────────────────────────────────────────────────────
  {
    const host = mk("a_host", 3, true, "Host");
    const names = {};
    for (const [id, nm] of [["b_alice", "Alice"], ["c_bob", "Bob"]]) { host.onHello(id, { name: nm, gv: 3, host: 0 }, 1000); names[id] = nm; }
    host.onPresence(["a_host", "b_alice", "c_bob"]);
    const left = host.onPresence(["a_host", "b_alice"]);                      // Bob closes his tab before START
    row(left.length === 1 && left[0] === "c_bob", "presence: the peer that left is reported as gone", left);
    const plan = host.planStart(names, 3, 5000);
    row(plan.roster.length === 2 && plan.roster.every((r) => r.peerId !== "c_bob") && plan.gone.length === 1 && plan.gone[0].peerId === "c_bob",
      "LC-11 phantom: a peer that joined, said hello and left before START gets NO roster slot", plan);
    row(plan.roster[1].peerId === "b_alice" && plan.roster[1].slot === 1, "LC-11 phantom: the peer still here keeps slot 1", plan.roster);
    // no presence report at all (an old transport): every hello'd peer counts, exactly as before
    const h0 = mk("a_host", 3, true);
    h0.onHello("b_x", { name: "X", gv: 3 }, 0);
    row(h0.planStart({ b_x: "X" }, 3, 99999).roster.length === 2, "presence: with no presence report every peer counts (old behaviour)");
    // a hello that beats its sender's presence: kept inside the grace window, dropped after it
    const h1 = mk("a_host", 3, true);
    h1.onPresence(["a_host"]);
    h1.onHello("d_new", { name: "New", gv: 3 }, 10000);
    row(h1.planStart({ d_new: "New" }, 3, 10000 + M.PRESENCE_GRACE_MS - 100).roster.length === 2, "presence: a hello ahead of its presence keeps its slot inside the grace window");
    row(h1.planStart({ d_new: "New" }, 3, 10000 + M.PRESENCE_GRACE_MS + 100).roster.length === 1, "presence: ...and a hello whose sender never shows up in presence gets none after it");
    h1.onPresence(["a_host", "d_new"]);
    row(h1.planStart({ d_new: "New" }, 3, 99999).roster.length === 2, "presence: once in presence, the peer is rostered whenever START comes");
    // a peer that comes BACK (presence flap) is present again
    const h2 = mk("a_host", 3, true);
    h2.onHello("b_f", { name: "F", gv: 3 }, 0);
    h2.onPresence(["a_host", "b_f"]); h2.onPresence(["a_host"]); h2.onPresence(["a_host", "b_f"]);
    row(h2.isPresent("b_f", 99999) === true, "presence: a peer that drops out and comes back is present again");
    row(h2.isPresent("a_host", 0) === true, "presence: this page is always present to itself");
    // a guest on ANOTHER version that refused and left before START is still named as left out (the host reads why), never rostered
    const h3 = mk("a_host", 3, true);
    h3.onHello("b_old", { name: "Old", gv: 2 }, 0);
    h3.onPresence(["a_host", "b_old"]); h3.onPresence(["a_host"]);
    const p3 = h3.planStart({ b_old: "Old" }, 3, 99999);
    row(p3.roster.length === 1 && p3.left.length === 1 && p3.left[0].peerId === "b_old" && p3.gone.length === 0,
      "presence: a version-mismatched guest that already left is still LEFT OUT by name (squadguard's notice), not silently gone", p3);
  }
  // ── LC-11 sender binding (verify/lc11 forgeries) ────────────────────────────────────────────────────────────────────────────────────────
  {
    const roster = [{ peerId: "a_host", slot: 0 }, { peerId: "b_g1", slot: 1 }, { peerId: "c_g2", slot: 2 }];
    const bots = new Set(["s10", "s20", "s49"]);
    const actor = (id) => (bots.has(id) ? { isBot: true } : /^s[0-2]$/.test(id) ? { isBot: false } : null);
    const onHost = { roster, isHost: true, actor, K: SIM }, onGuest = { roster, isHost: false, actor, K: SIM };
    const may = (t, d, from, ctx) => M.senderMay(t, d, from, ctx) === null;
    // the audit's forgeries, from a guest console
    row(!may("hitYou", { target: "s0", dmg: 37, attacker: "s10", weapon: "ar" }, "b_g1", onHost), "LC-11: a guest's hitYou crediting a host bot is refused (audit: host HP 100 -> 63)");
    row(!may("died", { slot: "s20", killer: "s1", weapon: "ar" }, "b_g1", onHost), "LC-11: a guest's 'died' for a host bot is refused (audit: the bot fell over)");
    row(!may("takeover", { slot: "s10" }, "b_g1", onHost), "LC-11: a takeover arriving AT the host is refused (the host would stop simulating its bot)");
    row(!may("takeover", { slot: "s2" }, "b_g1", onGuest), "LC-11: a takeover from a guest is refused on another guest");
    row(!may("bye", { slot: "s2" }, "b_g1", onHost), "LC-11: a 'bye' for another guest's slot is refused");
    row(!may("state", { id: "s2", x: 0, y: 0, z: 0 }, "b_g1", onHost), "LC-11: a state packet for another slot is refused");
    row(!may("chat", { id: "s0", m: "hi" }, "b_g1", onHost), "LC-11: chat in another player's name is refused");
    row(!may("hitYou", { target: "s0", dmg: 10, attacker: "s1", weapon: "ar" }, "z_stranger", onHost), "LC-11: anything from a peer outside the match roster is refused");
    row(!may("hitYou", { target: "s0", dmg: 500, attacker: "s1", weapon: "ar" }, "b_g1", onHost), "LC-11: a hit bigger than the weapon's biggest single hit is refused");
    row(!may("hitYou", { target: "s0", dmg: 10, attacker: "s1", weapon: "nuke" }, "b_g1", onHost), "LC-11: a hit with a weapon the sim does not have is refused");
    row(!may("hitYou", { target: "s0", dmg: -5, attacker: "s1", weapon: "ar" }, "b_g1", onHost) && !may("hitYou", { target: "s0", dmg: NaN, attacker: "s1", weapon: "ar" }, "b_g1", onHost),
      "LC-11: negative / NaN damage is refused");
    // what the real game sends still passes
    const arMax = M.maxHitDamage(SIM, "ar"), snMax = M.maxHitDamage(SIM, "sniper");
    row(arMax >= 30 * 1.5 && arMax <= 120 && snMax >= 105 * 2.5, "maxHitDamage: AR and sniper caps cover a legendary point-blank headshot", { arMax, snMax });
    row(may("hitYou", { target: "s0", dmg: 31, attacker: "s1", weapon: "ar" }, "b_g1", onHost), "LC-11: a guest's own hit on the host passes");
    row(may("hitYou", { target: "s1", dmg: snMax - 1, attacker: "s10", weapon: "sniper" }, "a_host", onGuest), "LC-11: the host's bot hitting a guest passes (host speaks for its bots)");
    row(may("hitYou", { target: "s1", dmg: 40, attacker: "s0", weapon: "glauncher" }, "a_host", onGuest), "LC-11: the host's own launcher splash on a guest passes");
    row(may("died", { slot: "s1", killer: "s10", weapon: "ar" }, "b_g1", onHost), "LC-11: a guest announcing its OWN death passes");
    row(may("died", { slot: "s20", killer: "s1", weapon: "ar" }, "a_host", onGuest), "LC-11: the host announcing its bot's death passes");
    row(may("bye", { slot: "s1" }, "b_g1", onHost), "LC-11: a guest's own bye passes");
    row(may("takeover", { slot: "s2" }, "a_host", onGuest) && may("sync", { t: 1 }, "a_host", onGuest), "LC-11: takeover / sync from the host pass on a guest");
    row(may("state", { id: "s1" }, "b_g1", onHost) && may("state", { id: "s0", t: 3 }, "a_host", onGuest), "LC-11: own state packets pass (host's carries the clock)");
    row(may("fire", { id: "s10" }, "a_host", onGuest) && !may("fire", { id: "s10" }, "b_g1", onHost), "LC-11: gunfire FX for a bot only from the host");
    row(may("chest", { id: 5 }, "c_g2", onHost) && may("boom", { x: 1, y: 2, z: 3 }, "c_g2", onHost), "LC-11: world events (chest, blast) pass from any match member");
    // the receiver knows its own actor: the host may speak for any OTHER actor (a body it took over keeps fighting), never for this client's own
    const g1self = Object.assign({}, onGuest, { selfId: "s1" });
    row(may("died", { slot: "s2", killer: "s10", weapon: "ar" }, "a_host", g1self), "LC-11: the host announcing the death of a body it took over (another guest's slot) passes");
    row(!may("died", { slot: "s1", killer: "s10", weapon: "ar" }, "a_host", g1self), "LC-11: ...but a 'died' for THIS client's own actor is refused even from the host (own HP is this client's)");
    row(!may("died", { slot: "s2", killer: "s1", weapon: "ar" }, "b_g1", Object.assign({}, onHost, { selfId: "s0" })), "LC-11: a guest still cannot announce another guest's death");
    row(may("ping", { id: "s2", k: "go" }, "c_g2", onHost) && !may("ping", { id: "s1", k: "go" }, "c_g2", onHost), "LC-07: a ping must name the sender's own slot");
  }
  // ── LC-07 ping gate ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const L = new M.PingLimiter();
    const a = L.allow("s1", 0), b = L.allow("s1", 500), c = L.allow("s1", 999), d = L.allow("s1", 1000), e = L.allow("s2", 100);
    row(a && !b && !c && d && e, "LC-07: at most one ping per second per sender (0 ok, 500 no, 999 no, 1000 ok; another sender independent)", { a, b, c, d, e });
    let n = 0; const L2 = new M.PingLimiter();
    for (let t = 0; t < 10000; t += 16) if (L2.allow("spam", t)) n++;
    row(n === 10, "LC-07: a sender spamming every frame for 10 s gets exactly 10 pings through", n);
    row(M.pingTeamOk("sq", "sq") && !M.pingTeamOk("sq", null) && !M.pingTeamOk(null, null) && !M.pingTeamOk("sq", "s5") && !M.pingTeamOk("", ""),
      "LC-07: pings are shown to the sender's team only (same non-empty teamId)");
    const p = M.normPing({ k: "go", x: 12.345, y: 3.21, z: -40.06, src: "w" }, 850);
    row(p && p.k === "go" && p.x === 12.3 && p.z === -40.1 && p.src === "w", "LC-07: a ping body is rounded and keeps its kind", p);
    row(M.normPing({ k: "nuke", x: 0, y: 0, z: 0 }) === null && M.normPing({ k: "go", x: NaN, y: 0, z: 0 }) === null && M.normPing({ k: "go", x: 9000, y: 0, z: 0 }, 850) === null && M.normPing(null) === null,
      "LC-07: unknown kinds, NaN and off-map coordinates are dropped");
    const cl = M.normPing({ k: "clr", src: "m" });
    row(cl && cl.k === "clr" && cl.src === "m", "LC-07: a clear names which ping it clears (world / map pin)", cl);
  }
  // ── LC-07 ping outbox: world pings and map pins are limited separately; a pin over the rate is held (newest wins), never dropped ─────
  {
    const go = { k: "go", src: "w", x: 1, y: 0, z: 1 }, pA = { k: "pin", src: "m", x: -320, y: 0, z: -320 }, pB = { k: "pin", src: "m", x: 320, y: 0, z: 320 };
    const O1 = new M.PingOutbox();
    const w0 = O1.offer("me:w", go, 0, false), m0 = O1.offer("me:m", pA, 100, true);
    row(w0.now === go && m0.now === pA, "LC-07: a map pin right after a world ping goes out at once (separate 1/s per stream)", { w0, m0 });
    const O2 = new M.PingOutbox();
    const a = O2.offer("me:m", pA, 0, true), b = O2.offer("me:m", pB, 350, true);
    const early = O2.due(999), late = O2.due(1000), again = O2.due(1500);
    row(a.now === pA && b.now === null && b.wait === 650 && early.length === 0 && late.length === 1 && late[0][1] === pB && again.length === 0 && O2.pending === 0,
      "LC-07: a pin moved twice within 1 s: the second is held and sent the moment the limit frees (650 ms later), once", { a, b, early, late, again });
    const O3 = new M.PingOutbox();
    let sent = [];
    for (let t = 0; t <= 3000; t += 200) { const r = O3.offer("me:m", { k: "pin", src: "m", x: t / 10, y: 0, z: 0 }, t, true); if (r.now) sent.push(r.now.x); for (const [, bd] of O3.due(t + 1)) sent.push(bd.x); }
    for (let t = 3001; t <= 5000; t += 16) for (const [, bd] of O3.due(t)) sent.push(bd.x);
    row(sent[sent.length - 1] === 300 && sent.length <= 5 && O3.pending === 0, "LC-07: a pin dragged around for 3 s: at most 1/s on the wire and the LAST pin always arrives", sent);
    const O4 = new M.PingOutbox();
    O4.offer("me:m", pA, 0, true); O4.offer("me:m", pB, 300, true);
    const c = O4.offer("me:m", { k: "clr", src: "m" }, 400, true), d4 = O4.due(2000);
    row(c.now && c.now.k === "clr" && d4.length === 0, "LC-07: a clear goes out at once and cancels a held pin (the cleared pin never comes back)", { c, d4 });
    const O5 = new M.PingOutbox();
    O5.offer("me:w", go, 0, false);
    const w5 = O5.offer("me:w", go, 500, false);
    row(w5.now === null && w5.wait === null && O5.pending === 0 && O5.due(2000).length === 0, "LC-07: a world ping over the rate is dropped, not held (one world ping per second, as before)", w5);
    const O6 = new M.PingOutbox(850);
    const r1 = O6.offer("s1:m", pA, 0, true), r2 = O6.offer("s2:m", pB, 10, true), r3 = O6.offer("s1:w", go, 20, false);
    row(r1.now && r2.now && r3.now, "LC-07: the receive gate is per sender AND per stream", { r1, r2, r3 });
  }
  return bad;
}

/** PARITY WAVES P2+P3, lane net rows: C-MODE, LC-49 (order + rejoin), C-DBNO, LC-14 relays (the real module, or a planted-fault copy). */
function suiteP23(M, SIM, count) {
  let bad = 0;
  const row = (cond, msg, detail) => { if (!cond) bad++; if (count) ok(cond, msg, detail); };
  // ── C-MODE ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const R = (w, n, p) => M.resolveTeamMode(w, n, p || "standard", SIM);
    row(R(null, 1) === "solo" && R(null, 2) === "duo" && R(null, 3) === "trio" && R(null, 4) === "squad", "C-MODE: AUTO plays the smallest mode that holds the room (1 solo, 2 duo, 3 trio, 4 squad)",
      [R(null, 1), R(null, 2), R(null, 3), R(null, 4)]);
    row(R("duo", 3) === "trio" && R("duo", 4) === "squad" && R("trio", 4) === "squad", "C-MODE: a pick too small for the room becomes the smallest that holds everyone (every human is one team)",
      [R("duo", 3), R("duo", 4), R("trio", 4)]);
    row(R("squad", 2) === "squad" && R("trio", 1) === "trio" && R("duo", 2) === "duo", "C-MODE: a pick that holds the room is played as picked (the rest of the team = bot teammates)", [R("squad", 2), R("trio", 1)]);
    row(R("squad", 3, "practice") === "solo" && R("nuke", 2) === "duo" && R(7, 1) === "solo", "C-MODE: practice is solo; an unknown pick is AUTO", [R("squad", 3, "practice"), R("nuke", 2), R(7, 1)]);
    row(M.resolveTeamMode(null, 2, "standard", { TEAM_SIZE: { solo: 1, duo: 3, trio: 3, squad: 4 } }) === "duo", "C-MODE: K.TEAM_SIZE from the sim wins over the contract table");
    row(M.humanTeamId(3, "solo", SIM) === "s3" && M.humanTeamId(2, "duo", SIM) === "t0" && M.humanTeamId(0, "squad", SIM) === "t0" && M.humanTeamId(1, "bogus", SIM) === "s1",
      "C-MODE: a human's teamId is its own id in solo, 't0' (the humans' team) in duo / trio / squad");
    const D = M.teamPartitionDiff;
    row(D([["s0", "sq", "t0"], ["s1", "sq", "t0"]]).length === 0 && D([["s0", null, "s0"]]).length === 0 && D([["s0", null, "s0"], ["s1", null, "s1"]]).length === 0,
      "C-MODE cross-check: the boot's own team name ('sq') or a solo null team agrees with the start's grouping");
    row(D([["s0", null, "t0"], ["s1", null, "t0"]]).length === 1 && D([["s0", "a", "s0"], ["s1", "a", "s1"]]).length === 1,
      "C-MODE cross-check: humans split where the start teams them (or teamed where it splits them) are reported", [D([["s0", null, "t0"], ["s1", null, "t0"]])]);
    const ro = [{ peerId: "a", slot: 0, name: "H" }, { peerId: "b", slot: 1, name: "G" }];
    const rt2 = M.rosterWithTeams(ro, "trio", SIM);
    row(rt2.length === 2 && rt2[0].teamId === "t0" && rt2[1].teamId === "t0" && rt2[1].peerId === "b" && rt2[1].name === "G" && ro[0].teamId === undefined,
      "C-MODE: the start roster carries each human's teamId, keeps every old field and does not touch the input", rt2);
    const hs = new M.SquadHandshake({ id: "a", name: "H", gv: 6, host: true });
    const msg = rt(hs.startMsg({ seed: 7, mapId: "ashgrid", mode: "quick", teamMode: "trio", roster: rt2 }));
    row(msg.mode === "quick" && msg.teamMode === "trio" && msg.gv === 6 && msg.roster[1].teamId === "t0", "C-MODE: the start keeps `mode` = the pace and adds teamMode + roster teamIds (JSON round trip)", msg);
  }
  // ── LC-49: order ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const G = new M.SeqGate();
    const seq = [1, 2, 3, 5, 4, 5, 6, 4, 9, 7, 8, 9, 10];
    const got = seq.map((q) => G.accept("p", q));
    row(got.join() === "new,new,new,new,old,dup,new,dup,new,old,old,dup,new", "LC-49: SeqGate says new / old (late, never seen) / dup (seen) for an out-of-order stream with copies", got);
    row(G.accept("p", undefined) === "new" && G.accept("p", "7") === "new" && G.accept("p", -1) === "new", "LC-49: a packet with no sequence number (an older peer) is always applied, as before");
    row(G.accept("other", 3) === "new" && G.accept("other", 2) === "old", "LC-49: each sender has its own counter");
    const G2 = new M.SeqGate(64);
    G2.accept("p", 200);
    row(G2.accept("p", 100) === "dup" && G2.accept("p", 150) === "old", "LC-49: a packet more than 64 behind is too old to tell: dropped whole");
    G2.reset("p");
    row(G2.accept("p", 1) === "new", "LC-49: reset() forgets a sender (a rejoined slot's old peer)");
    // the behaviour the gate exists for: a remote body fed an adversarial stream never moves backwards, and every packet's events apply once
    let rng = 12345; const rnd = () => ((rng = (rng * 1103515245 + 12345) >>> 0) / 4294967296);
    const pk = []; for (let q = 1; q <= 400; q++) pk.push({ q, x: q * 0.5, ev: "e" + q });
    const wire = [];
    for (const p of pk) { wire.push(p); if (rnd() < 0.3) wire.push(p); }                      // 30 % duplicated (RTC + relay)
    for (let i = 0; i < wire.length; i++) { const j = Math.min(wire.length - 1, i + Math.floor(rnd() * 6)); const t = wire[i]; wire[i] = wire[j]; wire[j] = t; }   // jitter
    const G3 = new M.SeqGate(); let x = -1, back = 0; const evs = new Map();
    for (const p of wire) {
      const o = G3.accept("s1", p.q);
      if (o === "dup") continue;
      evs.set(p.ev, (evs.get(p.ev) || 0) + 1);
      if (o === "new") { if (p.x < x) back++; x = p.x; }
    }
    const once = [...evs.values()].every((n) => n === 1);
    row(back === 0 && x === 200 && evs.size === 400 && once, "LC-49: 400 packets, 30 % duplicated, reordered up to 5 deep: the body never moves backwards, ends on the newest, and every packet's events apply exactly once",
      { back, x, events: evs.size, once, late: G3.n.old, dups: G3.n.dup });
  }
  // ── LC-49: rejoin ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const s1 = M.newRejoinSecret(), s2 = M.newRejoinSecret();
    row(/^[0-9a-f]{32}$/.test(s1) && s1 !== s2, "LC-49: a rejoin secret is 128 random bits", [s1, s2]);
    row(M.rejoinHash(s1) === M.rejoinHash(s1) && M.rejoinHash(s1) !== M.rejoinHash(s2) && M.rejoinHash(s1).length >= 8 && M.rejoinHash(s1) !== s1, "LC-49: the commitment is a stable hash that is not the secret");
    row(M.normRejoinReq({ slot: 2, key: s1 }).length === 1 && M.normRejoinReq([{ slot: 1, key: s1 }, { slot: 0, key: s1 }, { slot: 2, key: "x" }, null, { slot: 3.5, key: s1 }]).length === 1 &&
        M.normRejoinReq(null).length === 0 && M.normRejoinReq("s").length === 0 && M.normRejoinReq(Array(9).fill({ slot: 1, key: s1 })).length === 3,
      "LC-49: a rejoin request is up to 3 { guest slot, key } pairs; slot 0, a short key or garbage is dropped");
    const roster = [{ peerId: "h", slot: 0, name: "Host" }, { peerId: "g_old", slot: 1, name: "Gus" }, { peerId: "k", slot: 2, name: "Kat" }];
    const keys = new Map([[1, M.rejoinHash(s1)], [2, M.rejoinHash(s2)]]);
    const ctx = (o) => Object.assign({ roster, keys, goneAt: { s1: 1000 }, nowMs: 21000, live: true, gvOk: true }, o || {});
    const J = (req, from, o) => M.judgeRejoin(req, from || "g_new", ctx(o));
    row(J({ slot: 1, key: s1 }).ok === true && J({ slot: 1, key: s1 }).slot === 1, "LC-49 rejoin: the reloaded page with the right secret gets slot 1 back 20 s after it left");
    row(!J({ slot: 1, key: s2 }).ok && J({ slot: 1, key: s2 }).why === "wrong rejoin key", "LC-49 rejoin: another player's secret cannot take slot 1 (a squad-mate's console cannot steal a slot)");
    row(!J({ slot: 2, key: s2 }).ok && J({ slot: 2, key: s2 }).retry === true, "LC-49 rejoin: a slot whose player has NOT left is refused (retry: its leave may still be on the way)");
    row(!J({ slot: 1, key: s1 }, null, { nowMs: 1000 + M.REJOIN_MS + 1 }).ok && J({ slot: 1, key: s1 }, null, { nowMs: 1000 + M.REJOIN_MS - 1 }).ok, "LC-49 rejoin: the window is REJOIN_MS (60 s) from the leave");
    row(!J({ slot: 1, key: s1 }, null, { live: false }).ok && !J({ slot: 1, key: s1 }, null, { gvOk: false }).ok && !J({ slot: 0, key: s1 }).ok && !J({ slot: 7, key: s1 }).ok && !J({ slot: 1, key: s1 }, "g_old").ok,
      "LC-49 rejoin: refused with no match running, on another game version, for the host's slot, a slot not in the match, or the peer that already has it");
    row(M.REJOIN_MS === 60000, "LC-49: the rejoin window is 60 s (plan: rejoin within 60 s on ?room=)");
    const now = 1e6;
    const own = { room: "ABCD", slot: 1, key: s1, at: now - 5000 };
    const list = [{ room: "ABCD", slot: 2, key: s2, at: now - 20000 }, { room: "ABCD", slot: 3, key: s2, at: now - 1000 }, { room: "ZZZZ", slot: 2, key: s2, at: now - 9000 },
      { room: "ABCD", slot: 1, key: s1, at: now - 6000 }, { room: "ABCD", slot: 2, key: s2, at: now - M.REJOIN_MS - 20000 }];
    const c = M.rejoinCandidates("ABCD", own, list, now);
    row(c.length === 2 && c[0].slot === 1 && c[1].slot === 2 && c[1].at === now - 20000, "LC-49: the candidates are this tab's record first, then a closed tab's stale record; a live tab (< 3 s), another room and an expired record are not", c);
    row(M.rejoinCandidates("ABCD", null, null, now).length === 0 && M.rejoinCandidates("ABCD", { room: "ABCD", slot: 1, key: s1, at: now - M.REJOIN_MS - 16000 }, [], now).length === 0,
      "LC-49: no record / an expired record -> no rejoin ask");
  }
  // ── C-DBNO ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    row(M.F_DOWNED === 256 && (255 | M.F_DOWNED) === 511 && String(255).length === String(511).length, "C-DBNO: downed is bit 256 of the stance byte (max 255 -> 511, still 3 digits: a normal packet is byte-identical)");
    row(M.normRevive({ k: "done", id: "s1", by: "s0" }) && M.normRevive({ k: "down", id: "s1" }) && !M.normRevive({ k: "done", id: "s1" }) && !M.normRevive({ k: "heal", id: "s1", by: "s0" }) && !M.normRevive(null) && !M.normRevive({ k: "start", id: 5, by: "s0" }),
      "C-DBNO: a revive body is { k: down|start|cancel|done, id, by } (by optional only for a knock)");
    row(!M.reviveDoneOk(null, "s0", 9000, 5000) && !M.reviveDoneOk({ by: "s2", at: 0 }, "s0", 9000, 5000) && !M.reviveDoneOk({ by: "s0", at: 0 }, "s0", 4000, 5000) && M.reviveDoneOk({ by: "s0", at: 0 }, "s0", 4300, 5000),
      "C-DBNO: the owner accepts a done only from the reviver whose start it saw, a full channel (5 s, 750 ms jitter) earlier");
    const roster = [{ peerId: "a_host", slot: 0 }, { peerId: "b_g1", slot: 1 }];
    const actor = (id) => (id === "s10" ? { isBot: true } : /^s[01]$/.test(id) ? { isBot: false } : null);
    const onHost = { roster, isHost: true, actor, K: SIM }, onGuest = { roster, isHost: false, actor, K: SIM };
    const may = (t, d, from, c2) => M.senderMay(t, d, from, c2) === null;
    row(may("revive", { k: "down", id: "s1", by: "s10" }, "b_g1", onHost) && !may("revive", { k: "down", id: "s10", by: "s1" }, "b_g1", onHost) && may("revive", { k: "down", id: "s10" }, "a_host", onGuest),
      "C-DBNO: a knock is announced by the downed actor's owner only (a guest cannot knock a host bot from its console)");
    row(may("revive", { k: "done", id: "s0", by: "s1" }, "b_g1", onHost) && !may("revive", { k: "done", id: "s0", by: "s10" }, "b_g1", onHost) && may("revive", { k: "start", id: "s1", by: "s10" }, "a_host", onGuest),
      "C-DBNO: start / done come from the reviver's own client (the host for its bot teammates)");
  }
  // ── LC-14 relays + LC-49 rejoin binding ───────────────────────────────────────────────────────────────────────────────────────────
  {
    const s = M.normSmoke({ x: 10.123, y: 2, z: -4, r: 6, t0: 100, t1: 118 }, 850);
    row(s && s.x === 10.12 && s.r === 6 && s.t1 === 118, "LC-14: a smoke cloud travels as { x, y, z, r, t0, t1 }", s);
    row(!M.normSmoke({ x: 0, y: 0, z: 0, r: 60, t0: 0, t1: 10 }) && !M.normSmoke({ x: 0, y: 0, z: 0, r: 5, t0: 10, t1: 5 }) && !M.normSmoke({ x: 0, y: 0, z: 0, r: 5, t0: 0, t1: 600 }) &&
        !M.normSmoke({ x: 9000, y: 0, z: 0, r: 5, t0: 0, t1: 10 }, 850) && !M.normSmoke({ x: NaN, y: 0, z: 0, r: 5, t0: 0, t1: 10 }) && !M.normSmoke(null),
      "LC-14: a smoke that is huge, ends before it starts, lasts over 60 s, is off the map or not a number is dropped");
    // D5: run it back keeps the room's PICK (squad stays squad, AUTO stays AUTO even though the boot passes the mode AUTO resolved to)
    row(M.rematchTeamWant({ teamWant: "squad" }, "duo") === "squad" && M.rematchTeamWant({ teamWant: "auto" }, "duo") === null && M.rematchTeamWant({}, "trio") === "trio" &&
        M.rematchTeamWant(null, "squad") === "squad" && M.rematchTeamWant({ teamWant: "auto" }, "solo") === null && M.rematchTeamWant({}, "solo") === null,
      "D5: run it back keeps the room's team pick (SQUADS stays SQUADS, AUTO stays AUTO; only a start without teamWant takes the caller's mode)");
    row(M.SMOKE_MAX_PER_SENDER === 6 && M.SMOKE_MAX_PER_THROWER === 6, "LC-14: at most 6 relayed smokes alive per thrower");
    // D1: the live radius AND the full radius travel (weapons.js grows r from t0 + rMax on every client)
    const sg = M.normSmoke(rt({ x: 1, y: 2, z: 3, r: 2.1, rMax: 6, t0: 50, t1: 70 }), 850), sOld = M.normSmoke({ x: 1, y: 2, z: 3, r: 6, t0: 50, t1: 70 }, 850);
    row(sg && sg.r === 2.1 && sg.rMax === 6 && sOld && sOld.rMax === 6 && !M.normSmoke({ x: 1, y: 2, z: 3, r: 7, rMax: 6, t0: 50, t1: 70 }) && !M.normSmoke({ x: 1, y: 2, z: 3, r: 1, rMax: 40, t0: 50, t1: 70 }),
      "D1: a relayed smoke carries its live r and its full rMax (r <= rMax <= 15; a sender without rMax reads as rMax = r)", { sg, sOld });
    // D12: the cap counts per THROWER: the host relays every bot's smokes, each bot has its own 6
    const L0 = [];
    for (let i = 0; i < 8; i++) { row(M.smokeRelayRoom(L0, "s" + (10 + i), 60) === null, "D12: host bot s" + (10 + i) + "'s first smoke is relayed (the cap is not per sending peer)"); L0.push({ _net: "a_host", by: "s" + (10 + i), t1: 80 }); }
    const L1 = [];
    for (let i = 0; i < 6; i++) L1.push({ _net: "b_g1", by: "s1", t1: 80 });
    row(M.smokeRelayRoom(L1, "s1", 60) !== null && M.smokeRelayRoom(L1, "s1", 81) === null && M.smokeRelayRoom(L1, "s2", 60) === null,
      "D12: a 7th live smoke by the same thrower is refused; ended clouds do not count; another thrower is not capped by it");
    const L2 = [];
    for (let i = 0; i < M.SMOKE_MAX_RELAYED; i++) L2.push({ _net: "a_host", by: "s" + (10 + (i % 40)), t1: 80 });
    row(M.smokeRelayRoom(L2, "s49", 60) !== null && M.SMOKE_MAX_RELAYED >= 24, "D12: every thrower together is still bounded (SMOKE_MAX_RELAYED)");
    // late-join loot sync: a fake loot.js (a chest bursts its "cb:<id>:<i>" items when it opens; a take of a missing item is a no-op) - the
    // host's sync must leave no item the host already saw taken
    {
      const mkLoot = (landed) => {
        const items = new Set(["w1"]), chests = new Map([["c7", { id: "c7", opened: false }], ["sd2", { id: "sd2", supply: true, n: 2, opened: false }]]);
        const pending = new Set();
        const L = { items, opened: [],
          open(id) { const c = chests.get(id); if (!c || c.opened) return; if (c.supply && !landed.has(id)) { pending.add(id); return; } c.opened = true; L.opened.push(c);
            const pre = M.chestItemPrefix(c); for (let i = 0; i < 3; i++) items.add(pre + i); },
          take(id) { items.delete(id); },
          land(id) { landed.add(id); if (pending.has(id)) { pending.delete(id); L.open(id); } } };
        return L;
      };
      const sync = { opened: ["c7", "sd2"], taken: ["w1", "cb:c7:0", "cb:c7:2", "sd:2:1"] };
      const L1 = mkLoot(new Set(["sd2"]));
      const def1 = M.applyLootSync(rt(sync), L1.open, L1.take);
      row([...L1.items].sort().join() === "cb:c7:1,sd:2:0,sd:2:2", "late join: the opened list is applied before the taken list - no item taken from a chest comes back as a ghost", [...L1.items]);
      row(def1.join() === "cb:c7:0,cb:c7:2,sd:2:1" && M.isChestItem("sd:2:1") && !M.isChestItem("w1") && !M.isChestItem(null), "late join: the chest items of the sync are handed back to be kept until their chest opens here", def1);
      // a supply crate that has not landed on the joiner yet: the kept take goes when it opens (net.js chestOpened listener)
      const L2 = mkLoot(new Set());
      const def2 = M.applyLootSync(rt(sync), L2.open, L2.take);
      L2.land("sd2");
      const c2 = L2.opened.find((c) => c.supply), pre2 = M.chestItemPrefix(c2);
      for (const id of def2) if (id.startsWith(pre2)) L2.take(id);
      row(pre2 === "sd:2:" && M.chestItemPrefix({ id: "c7" }) === "cb:c7:" && !M.chestItemPrefix(null) && ![...L2.items].includes("sd:2:1") && [...L2.items].includes("sd:2:0"),
        "late join: a crate that lands on the joiner after the sync still loses the items taken from it", [...L2.items]);
      row(!M.applyLootSync(null, L2.open, L2.take).length && M.LOOT_DEFER_MAX >= 64, "late join: a sync without loot is a no-op; the kept takes are bounded");
    }
    const roster = [{ peerId: "a_host", slot: 0 }, { peerId: "b_g1", slot: 1 }, { peerId: "c_g2", slot: 2 }];
    const actor = (id) => (id === "s10" ? { isBot: true } : /^s[0-2]$/.test(id) ? { isBot: false } : null);
    const onHost = { roster, isHost: true, actor, K: SIM }, onGuest = { roster, isHost: false, actor, K: SIM };
    const may = (t, d, from, c2) => M.senderMay(t, d, from, c2) === null;
    row(may("smoke", { by: "s1" }, "b_g1", onHost) && !may("smoke", { by: "s2" }, "b_g1", onHost) && may("smoke", { by: "s10" }, "a_host", onGuest) && !may("smoke", { by: "s10" }, "b_g1", onHost),
      "LC-14: a smoke belongs to its thrower's client (a guest cannot drop smokes in another player's name)");
    row(may("nade", { id: "s2" }, "c_g2", onHost) && !may("nade", { id: "s1" }, "c_g2", onHost), "LC-14: a throw is relayed only for the sender's own actor (or the host's bots)");
    row(may("rejoin", { k: "ready", slot: 1 }, "b_g1", onHost) && !may("rejoin", { k: "ready", slot: 2 }, "b_g1", onHost) && may("rejoin", { k: "back", slot: 1 }, "a_host", onGuest) &&
        !may("rejoin", { k: "ok", slot: 2, peer: "b_g1" }, "b_g1", onGuest) && !may("rejoin", { k: "ok", slot: 2 }, "a_host", onHost),
      "LC-49: 'ready' only from the slot's own peer; ok / back only from the host (a guest cannot move another player's slot)");
    // LC-49 RECONNECT: a body the silent-guest watchdog gave to a bot goes back to ITS peer when that peer speaks again inside 60 s
    const rc = (o) => M.judgeReclaim(Object.assign({ takenAt: 1000, nowMs: 21000, senderSlot: 1, id: "s1", alive: true, isBot: true, rejoinedBy: null, from: "b_g1" }, o));
    row(rc({}) === "ok" && rc({ nowMs: 1000 + 60000 }) === "ok", "LC-49 reconnect: the stalled guest's next state packet inside 60 s of the take-over gets its body back");
    row(rc({ nowMs: 1000 + 60001 }) === "expired", "LC-49 reconnect: past the 60 s window the bot keeps the body");
    row(rc({ senderSlot: 2 }) === "no" && rc({ senderSlot: 0 }) === "no" && rc({ senderSlot: null }) === "no", "LC-49 reconnect: only the slot's own peer reclaims it (never another guest, never the host)");
    row(rc({ alive: false }) === "no" && rc({ isBot: false }) === "no" && rc({ takenAt: null }) === "no", "LC-49 reconnect: a dead body, a body nobody took over, or one not taken for silence is never reclaimed");
    row(rc({ rejoinedBy: "z_new" }) === "no" && rc({ rejoinedBy: "b_g1" }) === "ok", "LC-49 reconnect: a slot already handed to a reloaded page stays with that page");
  }
  return bad;
}

(async () => {
  // ── static: the version query rides every import edge ─────────────────────────────────────────────────────────────────────────────
  const src = fs.readFileSync(NET_JS, "utf8");
  ok(/const V = new URL\(import\.meta\.url\)\.search;/.test(src), "net.js derives the boot module's ?v= query from import.meta.url");
  // every `import("./x.js" ...)` call with its whole argument list (balanced parentheses), so `+ V` and `+ (new URL(..).search || "")` both read
  const edges = (text) => {
    const out = [];
    for (const m of text.matchAll(/import\(\s*"(\.\/[^"]+)"/g)) {
      const argStart = m.index + m[0].length;                         // just after the quoted specifier
      let depth = 1, i = text.indexOf("(", m.index) + 1;
      for (; i < text.length && depth > 0; i++) { if (text[i] === "(") depth++; else if (text[i] === ")") depth--; }
      out.push({ spec: m[1], q: text.slice(argStart, i - 1).trim() });
    }
    return out;
  };
  const carries = (list) => list.length >= 2 && list.every((e) => /(^|[^A-Za-z0-9_])V($|[^A-Za-z0-9_])|\.search/.test(e.q));
  const imports = edges(src);
  ok(carries(imports), "every dynamic import of a sibling module carries the version query (maps.js, bots.js)", imports);
  ok(!carries(edges(src.replace('import("./maps.js" + V)', 'import("./maps.js")'))), "planted fault caught: a bare import(\"./maps.js\") edge fails that row");
  ok(imports.some((i) => i.spec === "./maps.js"), "the local MAP_GEN_VERSION is read by a dynamic import of maps.js (the already-loaded instance, no new file)");
  ok(!/from\s+"\.\/maps\.js/.test(src) && !/import\s+"\.\/maps\.js/.test(src), "no static import of maps.js (a bare edge would be a second, stale module instance)");
  ok(/refuse: 1/.test(src), "the refuse message is in the CRITICAL list (the outbound budget never sheds it)");
  // C-FALLBACK, static: the wiring that only a browser can run is at least present, and removing a piece of it is caught
  ok(/mapfail: 1/.test(src), "the mapfail message is in the CRITICAL list (the outbound budget never sheds it)");
  ok(!/mapfail: 1/.test(src.replace(", mapfail: 1", "")), "planted fault caught: a source without the mapfail CRITICAL entry fails that row");
  ok(/W\.events\.on\("mapFallback"/.test(src), "init listens for the mapFallback event (maps.js emits it while the map is built)");
  const sliceOf = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a + 1); return a >= 0 && b > a ? src.slice(a, b) : ""; };
  const onStartSrc = sliceOf("export function onMatchStart(W)", "export function update(W, dt)");
  ok(/detectMapFallback\(W, S\.gv, S\.mapFallback\)[\s\S]*leaveForFallback\(W, fb\)/.test(onStartSrc), "onMatchStart judges the built map and leaves the squad on a fallback (before it sends any sync)");
  ok(onStartSrc.indexOf("leaveForFallback") > 0 && onStartSrc.indexOf("leaveForFallback") < onStartSrc.indexOf('send("sync"'), "...and does so BEFORE the host's sync goes out");
  ok(/S\.mapFallback && !S\.fallbackDone\) \{ leaveForFallback\(/.test(sliceOf("export function update(W, dt)", "function pack(a")), "update acts on a fallback noted by the event too (onMatchStart normally gets there first)");
  const leaveSrc = sliceOf("function leaveForFallback(W, fb)", "function beginOnlineMatch(W, cfg)");
  const leaveOk = (t) => /out\("mapfail"/.test(t) && /out\("bye"/.test(t) && /convertRemotesToBots\(W\)/.test(t) && /W\.net = null/.test(t) && /showFallbackCard\(W, j\)/.test(t) && /squadMapFallback/.test(t);
  ok(leaveOk(leaveSrc), "the leaving client sends mapfail + the old-style bye, converts its remote bodies to bots, clears W.net and shows the card");
  ok(!leaveOk(leaveSrc.replace("W.net = null", "")), "planted fault caught: a leave that keeps W.net fails that row");
  ok(!leaveOk(leaveSrc.replace("showFallbackCard(W, j);", "")), "planted fault caught: a leave with no card on screen fails that row");

  const M = await import(pathToFileURL(NET_JS).href);
  for (const k of ["normGv", "judgeGv", "SquadHandshake", "refusalLine", "leftOutLine"]) ok(typeof M[k] === "function", "net.js exports " + k);
  for (const k of ["init", "update", "leave", "hostLost", "onMatchStart"]) ok(typeof M[k] === "function", "net.js still exports " + k + " (the orchestrator's contract)");

  // ── normGv / judgeGv ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const { normGv, judgeGv } = M;
  ok(normGv(3) === 3 && normGv(1) === 1 && normGv(2) === 2 && normGv(9999) === 9999, "normGv keeps a positive integer");
  ok([undefined, null, "3", "", NaN, Infinity, 0, -1, 3.5, 10000, {}, []].every((v) => normGv(v) === 1), "normGv: missing / string / NaN / zero / negative / fractional / huge is version 1");
  ok(judgeGv(3, 3) === null && judgeGv(undefined, undefined) === null && judgeGv(1, undefined) === null, "judgeGv: equal (also 1 vs missing) -> null");
  ok(judgeGv(3, undefined) && judgeGv(3, undefined).remote === 1 && judgeGv(3, undefined).mineOlder === false, "judgeGv: v3 vs a peer with no gv -> the peer is the older one");
  const j = judgeGv(2, 3);
  ok(j.mineOlder && j.reload && j.title === "Your game is out of date", "judgeGv(2,3): this page is older -> reload", j);

  // ── the handshake on the real module ──────────────────────────────────────────────────────────────────────────────────────────────
  const realBad = suite(M, "real", true);
  ok(realBad === 0, "the real module passes every handshake row");

  // ── planted faults: the rows must bite ────────────────────────────────────────────────────────────────────────────────────────────
  class IgnoresVersion extends M.SquadHandshake {      // roster ignores the version
    planStart(names, maxGuests) {
      const roster = [{ peerId: this.id, slot: 0, name: this.name }];
      for (const pid of Object.keys(names).sort().slice(0, maxGuests)) roster.push({ peerId: pid, slot: roster.length, name: names[pid] });
      return { roster, left: [], over: [] };
    }
  }
  class MissingIsSame extends M.SquadHandshake {       // a start without gv is trusted
    judgeStart(d) { return d && d.gv === undefined ? null : super.judgeStart(d); }
  }
  class MissingIsLocal extends M.SquadHandshake {      // a hello without gv is taken for the local version
    onHello(from, d) { return super.onHello(from, Object.assign({}, d, d && d.gv === undefined ? { gv: this.gv } : {})); }
  }
  class SpoofableMapFail extends M.SquadHandshake {    // C-FALLBACK: slot / host / name taken from the message body, not the roster
    onMapFail(from, d, roster) {
      const r = super.onMapFail(from, d, roster);
      if (!r || !d) return r;
      const slot = Number.isInteger(d.slot) ? d.slot : r.slot;
      return Object.assign({}, r, { slot, id: "s" + slot, host: d.host === 1 || r.host, name: d.name || r.name });
    }
  }
  const real = M.detectMapFallback, realNorm = M.normFallback;
  const withGv = (W, gv) => (W && W.map ? Object.assign({}, W, { map: Object.assign({}, W.map, { genVersion: gv }) }) : W);
  const mutants = [
    ["a roster that ignores the version", { SquadHandshake: IgnoresVersion }],
    ["a guest that trusts a start with no gv", { SquadHandshake: MissingIsSame }],
    ["a hello without gv taken for the local version", { SquadHandshake: MissingIsLocal }],
    ["an onMapFail that trusts the message body (a peer can kick another slot)", { SquadHandshake: SpoofableMapFail }],
    ["a detector that ignores a built genVersion that differs from the advertised one", { detectMapFallback: (W, adv, seen) => real(withGv(W, normGv(adv)), adv, seen) }],
    ["a detector that trusts a stale W.mapFallback over a healthy map", { detectMapFallback: (W, adv, seen) => real(W, adv, seen) || (W && W.mapFallback ? Object.assign({ via: "W.mapFallback" }, realNorm(W.mapFallback)) : null) }],
    ["a normFallback that only reads the event shape", { normFallback: (x) => (x && typeof x === "object" ? realNorm({ genVersion: x.genVersion, wanted: x.wanted, reason: x.reason }) : null) }],
  ];
  for (const [name, over] of mutants) {
    const bad = suite(Object.assign({}, M, over), name, false);
    ok(bad >= 1, "planted fault caught: " + name + " fails " + bad + " row(s)", bad);
  }

  // ═══ PARITY WAVE P1, lane P1-D (LC-11 netcode safety, LC-07 ping, LC-09 sprint/foley relays, LC-14 remote blasts, LC-18 rematch) ══════════
  console.log("\n-- P1-D: presence, sender binding, ping gate, relays, rematch --");
  const SIM = require(path.join(__dirname, "..", "..", "sim", "royale.js"));
  const rows2 = suiteP1D(M, SIM, true);
  ok(rows2 === 0, "the real module passes every P1-D row");
  // planted faults for the P1-D rows
  class NoPresence extends M.SquadHandshake { isPresent() { return true; } }               // the live bug: departed peers keep their slot
  const p1dMutants = [
    ["a roster that ignores presence (the phantom-slot bug)", { SquadHandshake: NoPresence }],
    ["a sender check that trusts the body's attacker", { senderMay: (t, d, from, ctx) => (t === "hitYou" ? null : M.senderMay(t, d, from, ctx)) }],
    ["a sender check that lets a guest kill another slot", { senderMay: (t, d, from, ctx) => (t === "died" ? null : M.senderMay(t, d, from, ctx)) }],
    ["a sender check that takes a takeover from anyone", { senderMay: (t, d, from, ctx) => (t === "takeover" ? null : M.senderMay(t, d, from, ctx)) }],
    ["a damage cap that is not there", { maxHitDamage: () => null, senderMay: (t, d, from, ctx) => M.senderMay(t, d, from, Object.assign({}, ctx, { K: null })) }],
    ["a ping limiter that always allows", { PingLimiter: class { allow() { return true; } } }],
    ["a team filter that ignores teams", { pingTeamOk: () => true }],
    ["a ping parser that keeps any kind", { normPing: (d) => (d && typeof d === "object" ? Object.assign({ k: d.k }, d) : null) }],
    ["one ping limit shared by world pings and map pins (the wrong-pin bug)", { PingOutbox: class extends M.PingOutbox { offer(st, b, n, c) { return super.offer(st.split(":")[0], b, n, c); } due(n) { return super.due(n); } } }],
    ["a pin over the rate that is dropped instead of held (the wrong-pin bug)", { PingOutbox: class extends M.PingOutbox { offer(st, b, n) { return super.offer(st, b, n, false); } } }],
    ["a held pin that never goes out", { PingOutbox: class extends M.PingOutbox { due() { return []; } } }],
  ];
  for (const [name, over] of p1dMutants) {
    const bad = suiteP1D(Object.assign({}, M, over), SIM, false);
    ok(bad >= 1, "planted fault caught (P1-D): " + name + " fails " + bad + " row(s)", bad);
  }
  // static rows on the source: the wiring the pure parts cannot show
  {
    const src = fs.readFileSync(NET_JS, "utf8");
    ok(!/onMsg\(W, \{ from: "watchdog"/.test(src), "LC-11: the silent-guest watchdog no longer routes through a forged-looking 'bye' (bye is sender-bound now)");
    ok(/NEVER-SEEN watchdog/.test(src) && /S\.everSeen/.test(src) && /hostTakeOver\(W, id\)/.test(src), "LC-11: the host watchdog also covers guests that never sent a state packet");
    ok(/senderMay\(t, d, from, \{ roster: S\.cfg && S\.cfg\.roster/.test(src), "LC-11: onMsg runs senderMay against the match roster before any in-match handler");
    ok(/S\.hs\.onPresence\(ids\)/.test(src) && /planStart\(S\.peers, MAX_GUESTS, performance\.now\(\)\)/.test(src), "LC-11: presence feeds the handshake and START plans with it");
    ok(/pingTeamOk\(W\.player\.teamId, a\.teamId\)/.test(src) && /new PingOutbox\(PING_MIN_MS - 150\)/.test(src) && /box\.offer\("me:" \+ body\.src, body, performance\.now\(\), body\.src === "m"\)/.test(src) &&
      /if \(sendBudgetLeft\(\) > 2\) send\("ping", msg\); else qsend\("ping", msg\);/.test(src),
      "LC-07: the ping is team-filtered, rate-limited on both ends, and on the wire at once while the budget allows (else it rides the state packet)");
    ok(/box\.offer\(d\.id \+ ":" \+ p\.src, p, performance\.now\(\), p\.src === "m"\)/.test(src) && /if \(S\.pingOut && S\.pingOut\.pending\) flushPingOut\(W, S\.pingOut\)/.test(src) &&
      /if \(S\.pingIn && S\.pingIn\.pending\) flushPingIn\(W, S\.pingIn\)/.test(src) && /S\.pingOut !== box/.test(src),
      "LC-07: held pins are flushed by a timer AND update(), on both ends, and never into the next match (the box pins the session)");
    {
      const hud = fs.readFileSync(path.join(__dirname, "hud.js"), "utf8");
      ok(!/q\.kind !== "pin" && W\.t - q\.born > PING_LIFE_S/.test(hud) && /if \(W\.t - q\.born > PING_LIFE_S\) continue;/.test(hud), "LC-07: map pins time out at 30 s like every ping (hud.js stepPings)");
      ok(/R\.bigmap\.remove\(\); R\.bigmap = null;[^\n]*? regrabCursor\(W\); return;/.test(hud) && /if \(ok\) W\._suppressNextShot = false;/.test(hud),
        "closing the big map re-acquires pointer lock (and a successful re-lock does not eat the next shot)");
    }
    ok(/\(a\.sprinting \? 128 : 0\)/.test(src) && /a\.sprinting = !!\(f & 128\)/.test(src), "LC-09: the sprint bit rides the state packet and is applied to remote actors");
    ok(/qsend\("heal"/.test(src) && /qsend\("rld"/.test(src) && /W\.events\.emit\("healStart", a, d\.c/.test(src) && /W\.events\.emit\("reloadStart", a, \{ id: d\.w \}\)/.test(src), "LC-09: heal / reload foley is relayed and replayed as the local events");
    ok(/qsend\("boom"/.test(src) && /\{ net: true \}\)/.test(src) && /meta && meta\.net/.test(src), "LC-14: remote blasts are relayed once and the replay is never relayed again");
    ok(typeof M.rematch === "function" && /S\.rematchN = \(S\.rematchN \| 0\) \+ 1/.test(src) && /rematch: S\.rematchN/.test(src), "LC-18: net.rematch() exists and the host's start carries a rematch counter");
  }

  // ═══ PARITY WAVES P2+P3, lane net (C-MODE, C-DBNO, LC-49 order + rejoin, LC-14 smoke / frag relay) ═══════════════════════════════════
  console.log("\n-- P23 net: team modes, knock/revive, sequence numbers, rejoin, smoke/frag relay --");
  const rows3 = suiteP23(M, SIM, true);
  ok(rows3 === 0, "the real module passes every P23 row");
  const p23Mutants = [
    ["a gate that applies every packet (the live bug: late packets pull bodies back)", { SeqGate: class { constructor() { this.n = { new: 0, old: 0, dup: 0 }; } accept() { return "new"; } reset() {} } }],
    ["a gate that drops late packets whole (their chat / pickups are lost)", { SeqGate: class extends M.SeqGate { accept(k, q) { const r = super.accept(k, q); return r === "old" ? "dup" : r; } } }],
    ["a gate that applies duplicates (chat shown twice)", { SeqGate: class extends M.SeqGate { accept(k, q) { const r = super.accept(k, q); return r === "dup" ? "old" : r; } } }],
    ["a rejoin judge with no key check", { judgeRejoin: (req, from, c) => M.judgeRejoin(req, from, Object.assign({}, c, { keys: new Map([[req && req.slot, M.rejoinHash(req && req.key)]]) })) }],
    ["a rejoin judge that hands out a live player's slot", { judgeRejoin: (req, from, c) => M.judgeRejoin(req, from, Object.assign({}, c, { goneAt: { ["s" + (req && req.slot)]: c.nowMs } })) }],
    ["a rejoin judge with no time window", { judgeRejoin: (req, from, c) => M.judgeRejoin(req, from, Object.assign({}, c, { nowMs: Math.min(c.nowMs, ((c.goneAt || {})["s" + (req && req.slot)] || 0) + 1) })) }],
    ["a revive owner that takes any done", { reviveDoneOk: () => true }],
    ["a sender check that trusts the reviver named in the body", { senderMay: (t, d, from, c) => (t === "revive" ? null : M.senderMay(t, d, from, c)) }],
    ["a rejoin 'ok' accepted from anyone", { senderMay: (t, d, from, c) => (t === "rejoin" ? null : M.senderMay(t, d, from, c)) }],
    ["a team cross-check that compares names, not grouping", { teamPartitionDiff: (rows) => rows.filter((r) => r[1] !== r[2]).map((r) => [r[0]]) }],
    ["a team-mode rule that ignores the head count", { resolveTeamMode: (w, n, p, K) => M.normTeamMode(w) || "solo" }],
    ["a reconnect judge with no time window", { judgeReclaim: (c) => M.judgeReclaim(Object.assign({}, c, { nowMs: c.takenAt })) }],
    ["a reconnect judge that lets any peer reclaim a body", { judgeReclaim: (c) => M.judgeReclaim(Object.assign({}, c, { senderSlot: parseInt(String(c.id).slice(1), 10) })) }],
    ["a smoke parser with no radius / life cap", { normSmoke: (d) => (d && typeof d === "object" && [d.x, d.y, d.z].every(Number.isFinite) ? d : null) }],
    ["a smoke cap counted per sending peer (D12: the host's bots share one cap)", { smokeRelayRoom: (list, by, t) => { const L = (list || []).filter((x) => x && x._net && !(x.t1 < t)); const peer = L.length ? L[L.length - 1]._net : null; return L.filter((x) => x._net === peer).length >= 6 ? "flood" : null; } }],
    ["a smoke parser that drops rMax (a relayed cloud stuck at its send-time radius)", { normSmoke: (d, h) => { const s = M.normSmoke(d, h); if (s) s.rMax = s.r; return s; } }],
    ["a run-it-back that takes the last RESOLVED mode as the pick (the old rule)", { rematchTeamWant: (cfg, asked) => M.normTeamMode(asked) || (cfg && cfg.teamWant !== "auto" ? M.normTeamMode(cfg.teamWant) : null) }],
    ["a late-join sync that applies the taken list first (the ghost-item bug)", { applyLootSync: (loot, open, take) => { const out = []; for (const id of (loot && loot.taken) || []) { take(id); if (M.isChestItem(id)) out.push(id); } for (const id of (loot && loot.opened) || []) open(id); return out; } }],
    ["a late-join sync that forgets the chest items for a crate that lands later", { applyLootSync: (loot, open, take) => { M.applyLootSync(loot, open, take); return []; } }],
  ];
  for (const [name, over] of p23Mutants) {
    const bad = suiteP23(Object.assign({}, M, over), SIM, false);
    ok(bad >= 1, "planted fault caught (P23): " + name + " fails " + bad + " row(s)", bad);
  }
  // static rows on the source: the wiring the pure parts cannot show (the browser proof: F:/lc_p23/net/p23_net_live.py)
  {
    const src = fs.readFileSync(NET_JS, "utf8");
    const sl = (from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a + 1); return a >= 0 && b > a ? src.slice(a, b) : ""; };
    const stateSrc = sl('if (t === "state") {', 'if (t === "bots" && !S.net.isHost())');
    const iGate = stateSrc.indexOf("accept(from, d.q)"), iDup = stateSrc.indexOf('if (order === "dup") return;'), iOld = stateSrc.indexOf('if (order === "old") {');
    const oldBlk = stateSrc.slice(iOld, stateSrc.indexOf("return;", iOld));
    ok(iGate > 0 && iDup > iGate && iOld > iDup && iOld < stateSrc.indexOf("applyRemoteState") && !/applyRemoteState|slewClock/.test(oldBlk) && /d\.evs/.test(oldBlk),
      "LC-49: onMsg orders every state packet before it touches a body: duplicates dropped, a late packet applies only its events (no positions, no clock)");
    ok(/S\.txSeq = \(S\.txSeq \| 0\) \+ 1;\s*\r?\n\s*const st = pack\(W\.player, \{ q: S\.txSeq, t: \+W\.t\.toFixed\(2\) \}\);/.test(src) && /if \(stamp\) \{ st\.q = stamp\.q; st\.t = stamp\.t; \}/.test(src),
      "LC-49: pack() stamps every sender's state packet with q (its counter) and t (its match clock = the host's: the server-time stamp)");
    const packSrc = sl("function pack(a, stamp) {", "return st;");
    ok(/\(a\.downed \? F_DOWNED : 0\)/.test(packSrc) && /hp: Math\.round\(a\.downed \? Math\.max\(0, a\.downedHp \|\| 0\) : a\.hp\)/.test(packSrc) && !/dh/.test(packSrc) &&
      /const dn = !!\(f & F_DOWNED\);/.test(src) && /if \(dn\) \{ a\.downedHp = typeof d\.hp === "number" && Number\.isFinite\(d\.hp\) \? Math\.max\(0, d\.hp\) : a\.downedHp; a\.hp = 0; \}/.test(src),
      "C-DBNO: the downed bit rides the stance byte and, while it is set, the hp field carries the bleed pool (no extra key: per-tick bytes unchanged); remotes get downedHp = hp, hp = 0");
    ok(/revive: 1, smoke: 1, rejoin: 1, room: 1/.test(src) && !/qsend\("revive"/.test(src) && /send\("revive", \{ k: "done"/.test(src) && /send\("smoke"/.test(src),
      "P23: revive / smoke / rejoin / room are CRITICAL and sent at once (never batched, never shed)");
    ok(/function myHello\(\) \{ return Object\.assign\(S\.hs\.helloMsg\(\), S\.rk \? \{ rk: S\.rk \} : \{\}\); \}/.test(src) && /hello\.rj = cands\.map/.test(src) && /if \(hr\.first\) send\("hello", myHello\(\)\);/.test(src),
      "LC-49: every hello carries the tab's rejoin commitment; a reloaded page's hello asks with its secret");
    ok(/teamMode = resolveTeamMode\(teamWant, plan\.roster\.length, pace, W\.SIM\)/.test(src) && /rosterWithTeams\(plan\.roster, teamMode, W\.SIM\)/.test(src) && /if \(teamMode\) opts\.teamMode = teamMode;/.test(src),
      "C-MODE: START (and run-it-back) carry the team mode and the roster teamIds, and the guests hand them to startMatch");
    const lob = sl("function openLobby(W, sel) {", "// host + 3 guests.");
    ok(lob.indexOf("box.appendChild(startB);") > 0 && lob.indexOf("box.appendChild(modeRow);") > lob.indexOf("box.appendChild(startB);") && lob.indexOf("box.appendChild(rosterEl);") < lob.indexOf("box.appendChild(noteEl);"),
      "C-MODE: the team-mode row sits after START, so the lobby keeps the child order squadguard_live.py reads (title, status, buttons, roster, notices, START)");
    ok(/S\.rxGate = null; S\.reviveIn = null;/.test(src) && /if \(!a\.brain\) import\("\.\/bots\.js" \+ V\)/.test(src), "P23: run-it-back resets the order gate / revive / rejoin books; a re-taken body reuses its brain (never two brains on one body)");
    ok(/if \(a && S\.net\.isHost\(\) && !a\.netRemote && a !== W\.player\) reclaimSilentBody\(W, a, from, d\);\s*if \(a && a\.netRemote\) \{ applyRemoteState/.test(src) &&
      /if \(hostTakeOver\(W, id\)\) \(S\.silentTake = S\.silentTake \|\| \{\}\)\[id\] = now;/.test(src) && /if \(!gone\) \(S\.silentTake = S\.silentTake \|\| \{\}\)\[id\] = now;/.test(src) &&
      /if \(S\.silentTake\) delete S\.silentTake\[r\.id\];/.test(src) && /if \(S\.silentTake\) delete S\.silentTake\[d\.slot\];/.test(src),
      "LC-49 reconnect: only the silence watchdogs mark a body reclaimable (a bye or a map fallback never does) and a fresh state packet reclaims it before it is applied");
    ok(/if \(d\.to && d\.to !== S\.net\.id\) return;/.test(sl('if (t === "sync" && !S.net.isHost())', "function applyRemoteState")), "LC-49: a sync addressed to a rejoining page is ignored by everyone else (no clock snap)");
    ok(/let teamWant = normTeamMode\(sel && \(sel\.teamMode \|\| sel\.team\)\) \|\| normTeamMode\(W\.settings && W\.settings\.teamMode\);/.test(src) &&
      /const want = rematchTeamWant\(S\.cfg, opts\.teamMode\);\s*\r?\n\s*const teamMode = resolveTeamMode\(want === "solo" \? null : want/.test(src) && /mode: pace, teamMode, teamWant: teamWant \|\| "auto", roster/.test(src),
      "D5: the room starts from the menu's team pick (W.settings.teamMode), START carries teamMode + teamWant, run it back re-resolves the room's pick");
    ok(/const full = smokeRelayRoom\(W\.smokes, d\.by, W\.t\);\s*if \(full\) \{ reject\(t, from, full\); return; \}/.test(src) && !/x\._net === from/.test(src),
      "D12: the smoke relay's cap is applied per thrower (d.by) on receive, never per sending peer");
    const syncSrc = sl('if (t === "sync" && !S.net.isHost())', "function applyRemoteState");
    ok(/deferTakes\(applyLootSync\(d\.loot, W\.netOpenChest, W\.netTakeItem\)\)/.test(syncSrc) && !/W\.netTakeItem\(id\)/.test(syncSrc) &&
      /if \(t === "take"\) \{ W\.netTakeItem\(d\.id\); if \(isChestItem\(d\.id\)\) deferTakes\(\[d\.id\]\);/.test(src) &&
      /const pre = chestItemPrefix\(c\);[\s\S]{0,120}for \(const id of \[\.\.\.S\.lootDefer\]\) if \(id\.startsWith\(pre\)\) \{ S\.lootDefer\.delete\(id\); W\.netTakeItem\(id\); \}/.test(src) && /S\.lootDefer = null;/.test(src),
      "late join: the sync goes through applyLootSync (opened first) and a chest that opens here later drops the items taken from it");
  }

  console.log("");
  console.log("net.selftest: " + passed + " passed, " + failed + " failed (" + ((Date.now() - T0) / 1000).toFixed(1) + " s)");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("net.selftest crashed:", e); process.exit(1); });
