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
  ok(/S\.mapFallback && !S\.fallbackDone\) \{ leaveForFallback\(/.test(sliceOf("export function update(W, dt)", "function pack(a)")), "update acts on a fallback noted by the event too (onMatchStart normally gets there first)");
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

  console.log("");
  console.log("net.selftest: " + passed + " passed, " + failed + " failed (" + ((Date.now() - T0) / 1000).toFixed(1) + " s)");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("net.selftest crashed:", e); process.exit(1); });
