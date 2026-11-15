// core/meta/challenges.selftest.cjs — catalogue, calendar selection determinism,
// every predicate type, progress / complete / claim-once, swap, day + week resets,
// clock changes, career tiers, save / migrate / corrupt-recover. THREE-free, DOM-free.
//   node core/meta/challenges.selftest.cjs
const path = require("path");
const { pathToFileURL } = require("url");

let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log("  PASS  " + msg); } else { fail++; console.log("  FAIL  " + msg); } }

function memStorage(seed) {
  const m = new Map(Object.entries(seed || {}));
  return {
    m, quota: Infinity,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) { if (String(v).length > this.quota) { const e = new Error("QuotaExceededError"); throw e; } m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

async function main() {
  const root = path.resolve(__dirname, "..", "..");
  const C = await import(pathToFileURL(path.join(root, "core", "meta", "challenges.js")).href);
  const PR = await import(pathToFileURL(path.join(root, "core", "meta", "progression.js")).href);
  const KEY = C.SAVE_KEY + ".v" + C.SAVE_VERSION;
  const ALL = C.DAILY.concat(C.WEEKLY);
  const byId = {}; for (const x of ALL) byId[x.id] = x;

  console.log("== catalogue ==");
  ok(C.DAILY.length >= 30, "daily templates: " + C.DAILY.length + " (>= 30)");
  ok(C.WEEKLY.length >= 12, "weekly templates: " + C.WEEKLY.length + " (>= 12)");
  ok(C.CAREER_TIERS >= 40, "career tiers: " + C.CAREER_TIERS + " over " + C.CAREER.length + " tracks (>= 40)");
  const ids = ALL.map((x) => x.id).concat(C.CAREER.map((x) => x.id));
  ok(new Set(ids).size === ids.length, "every id is unique");
  const FACTS = ["kill", "medal", "lifeStreak", "matchEnd", "assist", "callin", "flag", "zone", "objective", "opEnd"];
  ok(ALL.every((x) => FACTS.indexOf(x.fact) >= 0 && x.target >= 1 && x.xp > 0), "every template uses a known fact with target >= 1 and XP > 0");
  ok(C.DAILY.every((x) => x.xp >= 1000 && x.xp <= 2500), "daily XP within 1,000-2,500");
  ok(C.WEEKLY.every((x) => x.xp >= 5000 && x.xp <= 9000), "weekly XP within 5,000-9,000");
  ok(C.CAREER.every((tr) => tr.tiers.every((t, i) => i === 0 || (t.n > tr.tiers[i - 1].n && t.xp > tr.tiers[i - 1].xp))), "career tiers strictly increase in target and reward");
  const reqs = ALL.filter((x) => x.req).map((x) => x.req);
  ok(reqs.every((k) => PR.unlockInfo(k)), "every gate names a real unlock key (" + new Set(reqs).size + " keys)");
  const text = ALL.map((x) => x.name + " " + x.desc).concat(C.CAREER.map((x) => x.name + " " + x.desc)).join(" | ");
  ok(!/\b(bots?|ai|npcs?|difficulty|enemy ai|computer)\b/i.test(text), "no player-facing text mentions bots / AI / NPCs / difficulty");

  console.log("== calendar + selection determinism ==");
  const base = new Date(2026, 10, 13, 9, 30).getTime(); // Fri 13 Nov 2026, local
  const d0 = C.dayNumber(base);
  ok(C.dayNumber(new Date(2026, 10, 13, 0, 0, 0).getTime()) === d0 && C.dayNumber(new Date(2026, 10, 13, 23, 59, 59).getTime()) === d0, "00:00 and 23:59 local are the same day");
  ok(C.dayNumber(new Date(2026, 10, 14, 0, 0, 0).getTime()) === d0 + 1, "local midnight starts the next day");
  let dst = true;
  for (let i = 0; i < 400; i++) { const a = new Date(2026, 0, 1 + i, 12).getTime(), b = new Date(2026, 0, 2 + i, 12).getTime(); if (C.dayNumber(b) - C.dayNumber(a) !== 1) dst = false; }
  ok(dst, "consecutive local dates are exactly 1 apart all year (DST-proof)");
  ok(C.dayStartMs(d0) === new Date(2026, 10, 13).getTime() && C.dayStartMs(d0 + 1) === new Date(2026, 10, 14).getTime(), "dayStartMs = local midnight");
  const mon = C.dayNumber(new Date(2026, 10, 16, 12).getTime()), sun = C.dayNumber(new Date(2026, 10, 15, 12).getTime());
  ok(C.weekOfDay(mon) === C.weekOfDay(sun) + 1 && C.weekOfDay(sun) === C.weekOfDay(d0), "weeks start on Monday (Sun 15 -> Mon 16 Nov rolls the week)");
  ok(C.weekStartDay(C.weekOfDay(d0)) === C.dayNumber(new Date(2026, 10, 9, 12).getTime()), "week of 13 Nov starts Mon 9 Nov");
  const all = () => true;
  const s1 = C.pickSet(C.DAILY, C.periodOrder(C.DAILY, C.daySeed(d0)), 3, all);
  const s2 = C.pickSet(C.DAILY, C.periodOrder(C.DAILY, C.daySeed(d0)), 3, all);
  ok(JSON.stringify(s1) === JSON.stringify(s2) && s1.length === 3, "same day -> same 3 dailies (" + s1.join(", ") + ")");
  let distinct = 0, groupsOk = true;
  const seen = new Set();
  for (let d = d0; d < d0 + 60; d++) {
    const s = C.pickSet(C.DAILY, C.periodOrder(C.DAILY, C.daySeed(d)), 3, all);
    if (new Set(s.map((id) => byId[id].group)).size !== 3) groupsOk = false;
    const k = s.slice().sort().join(","); if (!seen.has(k)) { seen.add(k); distinct++; }
  }
  ok(groupsOk, "every daily set spans 3 different groups (60 days)");
  ok(distinct >= 55, "sets vary day to day (" + distinct + " distinct of 60)");
  const gated = C.pickSet(C.DAILY, C.periodOrder(C.DAILY, C.daySeed(d0)), 3, (t) => !t.req || t.req === "weapon:warden" || t.req === "weapon:pike" || t.req === "equip:frag" || t.req === "equip:flash");
  ok(gated.every((id) => !byId[id].req || ["weapon:warden", "weapon:pike", "equip:frag", "equip:flash"].indexOf(byId[id].req) >= 0), "locked weapons / gear are never picked");

  console.log("== predicates ==");
  const M = C.matchFact;
  ok(M({}, { k: "kill" }), "empty where matches");
  ok(M({ weapon: "corvus" }, { weapon: "corvus" }) && !M({ weapon: "corvus" }, { weapon: "warden" }), "weapon equality");
  ok(M({ id: ["airstrike", "orbital"] }, { id: "orbital" }) && !M({ id: ["airstrike"] }, { id: "mortar" }), "array membership");
  ok(M({ headshot: true }, { headshot: true }) && !M({ headshot: true }, { headshot: false }) && !M({ headshot: true }, {}), "boolean (headshot)");
  ok(M({ minDist: 40 }, { dist: 40.5 }) && !M({ minDist: 40 }, { dist: 39 }) && !M({ minDist: 40 }, { dist: null }), "minDist (longshot), unknown distance never counts");
  ok(M({ maxDist: 6 }, { dist: 5 }) && !M({ maxDist: 6 }, { dist: 7 }) && !M({ maxDist: 6 }, { dist: null }), "maxDist (close range)");
  ok(M({ stance: "slide" }, { stance: "slide" }) && !M({ stance: "slide" }, { stance: "crouch" }), "stance");
  ok(M({ impaired: "flashed" }, { impaired: { flashed: true } }) && !M({ impaired: "flashed" }, { impaired: { stunned: true } }), "impaired: flashed");
  ok(M({ impaired: "any" }, { impaired: { stunned: true } }) && !M({ impaired: "any" }, { impaired: {} }), "impaired: any");
  ok(M({ medalAny: ["DOUBLE KILL", "MULTI KILL"] }, { text: "MULTI KILL X7" }) && !M({ medalAny: ["DOUBLE KILL"] }, { text: "LONGSHOT" }), "medal prefix list");
  ok(M({ completed: true, minKills: 8, maxDeaths: 3 }, { completed: true, kills: 9, deaths: 3 }) && !M({ completed: true, minKills: 8, maxDeaths: 3 }, { completed: true, kills: 9, deaths: 4 }) && !M({ minKills: 8 }, { kills: 7 }), "match-end kills / deaths bounds");
  ok(M({ won: true, mode: "dom" }, { won: true, mode: "dom" }) && !M({ won: true, mode: "dom" }, { won: true, mode: "tdm" }), "win in mode");

  // ---- an instance with a controllable clock, sim and progression stub ----------
  let now = base;
  const awards = [];
  const stubP = (unlocked) => {
    const endFns = new Set(), evFns = new Set();
    return {
      award(cat, n, label) { awards.push({ cat, n, label }); return n; },
      isUnlocked: (k) => (unlocked ? unlocked(k) : true),
      onSessionEnd(fn) { endFns.add(fn); }, onEvent(fn) { evFns.add(fn); },
      lifetime: { kills: 0, heads: 0, matches: 0, wins: 0, bestStreak: 0 },
      state: { weapons: {} },
      _end(d) { for (const fn of endFns) fn(d, d.result); }, _ev(e) { for (const fn of evFns) fn(e); },
    };
  };
  let simT = 10;
  const player = { pos: [0, 0, 0], stance: "stand", grounded: true, _m: { sliding: false } };
  let simMatch = { sameTeam: (a, b) => b === 99 };
  const ctx = { sim: () => ({ state: { time: simT, player, match: simMatch ? { modeId: "tdm" } : null }, match: simMatch }) };
  function rig(storage, P, clock) {
    const handlers = {};
    const bridge = { register: (k, fn) => { (handlers[k] = handlers[k] || []).push(fn); } };
    const ch = C.createChallenges(ctx, P, { storage, now: clock || (() => now) });
    ch.attach(bridge);
    const fire = (k, d) => (handlers[k] || []).forEach((fn) => fn(d));
    return { ch, fire };
  }
  // find a day whose set holds the wanted daily ids (deterministic search)
  function dayWith(want) {
    for (let d = d0; d < d0 + 4000; d++) {
      const s = C.pickSet(C.DAILY, C.periodOrder(C.DAILY, C.daySeed(d)), 3, all);
      if (want.every((w) => s.indexOf(w) >= 0)) return d;
    }
    return null;
  }
  const atDay = (d, h) => C.dayStartMs(d) + (h == null ? 12 : h) * 3600000;

  console.log("== bridge events -> progress ==");
  const P1 = stubP();
  const st1 = memStorage();
  const want1 = ["d_long"];
  const dd = dayWith(want1);
  now = atDay(dd);
  const r1 = rig(st1, P1);
  ok(r1.ch.daily().map((x) => x.id).indexOf("d_long") >= 0, "test day " + C.dayKey(dd) + " carries Long Watch");
  r1.fire("match:start", { mode: "tdm" });
  const kill = (victim, pos, extra) => { simT += 0.5; r1.fire("death", Object.assign({ attacker: "P", victim, pos, headshot: false }, extra || {})); };
  r1.fire("shot", { shooter: "P", weaponId: "corvus" });
  kill(3, [41, 0, 0]);
  const longP = () => r1.ch.daily().find((x) => x.id === "d_long").p;
  ok(longP() === 1, "a kill 41 m away advances Long Watch");
  simT += 2; kill(4, [10, 0, 0]);
  ok(longP() === 1, "a 10 m kill does not");
  kill(99, [50, 0, 0]);
  ok(longP() === 1, "a teammate never counts");
  r1.fire("shot", { shooter: "P", weaponId: "corvus" }); kill(5, [45, 0, 0]);
  r1.fire("shot", { shooter: "P", weaponId: "corvus" }); kill(6, [60, 0, 0]);
  const done1 = r1.ch.daily().find((x) => x.id === "d_long");
  ok(done1.done && done1.p === 3, "third longshot completes it");
  const pays = () => awards.filter((a) => a.label === "Daily: Long Watch").length;
  ok(pays() === 1 && awards.find((a) => a.label === "Daily: Long Watch").n === 1500 && awards.find((a) => a.label === "Daily: Long Watch").cat === "challenge", "paid 1,500 XP once, category 'challenge'");
  simT += 2; kill(7, [70, 0, 0]); kill(8, [70, 0, 0]);
  ok(pays() === 1 && longP() === 3, "more longshots never pay again");
  // the career counters followed
  const car = () => { const o = {}; for (const c of r1.ch.career()) o[c.id] = c; return o; };
  ok(car().c_long.value === 5 && car().c_kills.value === 6, "career: 5 longshots, 6 eliminations");
  ok(car().c_corvus.value === 3, "career: weapon kills only when a shot was fired within 1 s (corvus 3)");

  // stance / impaired / via derivation from the raw events + live player state
  const LK = () => r1.ch._lastKill;
  const C2 = car();
  player.stance = "crouch"; kill(10, [3, 0, 0]); player.stance = "stand";
  ok(LK().stance === "crouch" && LK().via === null, "crouched kill -> stance crouch (no recent shot -> no weapon)");
  player._m.sliding = true; kill(11, [3, 0, 0]); player._m.sliding = false;
  ok(LK().stance === "slide", "sliding kill -> stance slide");
  player.grounded = false; kill(12, [3, 0, 0]); player.grounded = true;
  ok(LK().stance === "air", "airborne kill -> stance air");
  r1.fire("equip", { phase: "flashed", kind: "flash", who: 13, by: "P", amt: 1, dur: 2 });
  kill(13, [3, 0, 0]);
  ok(LK().impaired.flashed && !LK().impaired.stunned, "kill on a blinded operator -> impaired.flashed");
  r1.fire("equip", { phase: "stunned", kind: "stun", who: 14, by: "P", amt: 1, dur: 2 });
  simT += 5; // the concussion wore off
  kill(14, [3, 0, 0]);
  ok(!LK().impaired.stunned, "an expired concussion does not count");
  ok(car().c_impaired.value === C2.c_impaired.value + 1, "career Blindside +1");
  simT += 1;
  r1.fire("explosion", { source: "claymore", who: "P", pos: [0, 0, 0] });
  r1.fire("death", { attacker: "P", victim: 15, pos: [2, 0, 0] });
  ok(LK().via === "claymore" && car().c_trip.value === 1, "same-tick claymore blast by P -> tripmine kill");
  simT += 1;
  r1.fire("grenade", { phase: "detonate", who: "P" }); r1.fire("explosion", { source: "grenade" });
  r1.fire("death", { attacker: "P", victim: 16, pos: [2, 0, 0] });
  ok(LK().via === "frag", "same-tick grenade detonation by P -> frag kill");
  simT += 1;
  r1.fire("grenade", { phase: "detonate", who: "P" }); r1.fire("explosion", { source: "streak" });
  const lifeBefore = car().c_streak.value;
  r1.fire("death", { attacker: "P", victim: 17, pos: [2, 0, 0] });
  ok(LK().via === "streak" && car().c_trip.value === 1, "a call-in blast is neither tripmine nor frag");
  simT += 1;
  r1.fire("grenade", { phase: "detonate", who: 22 }); r1.fire("explosion", { source: "grenade" });
  r1.fire("death", { attacker: "P", victim: 18, pos: [2, 0, 0] });
  ok(LK().via !== "frag", "someone else's grenade is not your frag kill");
  void lifeBefore;
  r1.fire("death", { attacker: 7, victim: "P" });
  r1.fire("shot", { shooter: "P", weaponId: "warden" });
  kill(30, [5, 0, 0]);
  ok(r1.ch.session && r1.ch.session.items.length > 0, "session ledger records progress");

  console.log("== every daily predicate type end to end ==");
  // drive one fresh instance per template through _fact with a matching fact, at a day that carries it
  const sample = {
    kill: (w) => Object.assign({ k: "kill", weapon: w.weapon || "warden", via: w.via || "gun", headshot: !!w.headshot,
      dist: w.minDist ? w.minDist + 1 : w.maxDist ? w.maxDist - 1 : 20, stance: w.stance || "stand",
      impaired: w.impaired ? { flashed: w.impaired !== "stunned", stunned: w.impaired === "stunned" } : {}, mode: "tdm" }),
    medal: (w) => ({ k: "medal", text: w.medalAny[0] }),
    lifeStreak: (w, t) => ({ k: "lifeStreak", value: t }),
    matchEnd: (w) => ({ k: "matchEnd", mode: w.mode || "tdm", won: w.won !== false, completed: true, kills: w.minKills || 0, deaths: 0 }),
    assist: () => ({ k: "assist" }), callin: (w) => ({ k: "callin", id: w.id ? w.id[0] : "recon" }),
    flag: (w) => ({ k: "flag", state: w.state }), zone: (w) => ({ k: "zone", state: w.state }),
    objective: () => ({ k: "objective" }), opEnd: () => ({ k: "opEnd", won: true }),
  };
  let e2e = 0, e2eFail = [];
  for (const tpl of C.DAILY) {
    const d = dayWith([tpl.id]);
    if (d == null) { e2eFail.push(tpl.id + "(no day)"); continue; }
    const aw = [];
    const ch = C.createChallenges(ctx, { award(c, n, l) { aw.push(n); }, isUnlocked: () => true, onSessionEnd() {}, onEvent() {} }, { storage: memStorage(), now: () => atDay(d) });
    const reps = tpl.mode === "best" ? 1 : tpl.target;
    for (let i = 0; i < reps; i++) ch._fact(sample[tpl.fact](tpl.where, tpl.target));
    const v = ch.daily().find((x) => x.id === tpl.id);
    // a non-matching fact must not have advanced it
    if (v && v.done && aw.indexOf(tpl.xp) >= 0) e2e++; else e2eFail.push(tpl.id);
  }
  ok(e2e === C.DAILY.length, "all " + C.DAILY.length + " daily templates complete from matching facts" + (e2eFail.length ? " FAILED: " + e2eFail.join(",") : ""));
  let we2e = 0; const wFail = [];
  for (const tpl of C.WEEKLY) {
    let wk = null;
    for (let w = C.weekOfDay(d0); w < C.weekOfDay(d0) + 2000; w++) {
      if (C.pickSet(C.WEEKLY, C.periodOrder(C.WEEKLY, C.weekSeed(w)), 3, all).indexOf(tpl.id) >= 0) { wk = w; break; }
    }
    if (wk == null) { wFail.push(tpl.id + "(no week)"); continue; }
    const aw = [];
    const ch = C.createChallenges(ctx, { award(c, n) { aw.push(n); }, isUnlocked: () => true, onSessionEnd() {}, onEvent() {} }, { storage: memStorage(), now: () => atDay(C.weekStartDay(wk) + 2) });
    const reps = tpl.mode === "best" ? 1 : tpl.target;
    for (let i = 0; i < reps; i++) ch._fact(sample[tpl.fact](tpl.where, tpl.target));
    const v = ch.weekly().find((x) => x.id === tpl.id);
    if (v && v.done && aw.indexOf(tpl.xp) >= 0 && aw.filter((n) => n === tpl.xp).length >= 1) we2e++; else wFail.push(tpl.id);
  }
  ok(we2e === C.WEEKLY.length, "all " + C.WEEKLY.length + " weekly templates complete from matching facts" + (wFail.length ? " FAILED: " + wFail.join(",") : ""));
  let neg = 0;
  for (const tpl of C.DAILY) {
    const f = sample[tpl.fact](tpl.where, tpl.target);
    // break the fact: wrong kind
    if (!C.matchFact(tpl.where, f)) continue; neg++;
  }
  ok(neg === C.DAILY.length, "every sample fact satisfies its own predicate (" + neg + ")");
  const wrongKill = { k: "kill", weapon: "pike", via: "gun", headshot: false, dist: 20, stance: "stand", impaired: {} };
  ok(!C.matchFact(byId.d_corvus.where, wrongKill) && !C.matchFact(byId.d_slide.where, wrongKill) && !C.matchFact(byId.d_trip.where, wrongKill) && !C.matchFact(byId.d_flash.where, wrongKill), "a plain pike kill fails corvus / slide / tripmine / blinded predicates");

  console.log("== match end through the progression hook ==");
  const P4 = PR.createProgression(ctx, { storage: memStorage() });
  const dW = dayWith(["d_wins"]) ;
  const st4 = memStorage();
  const hs4 = {}; const br4 = { register: (k, fn) => { (hs4[k] = hs4[k] || []).push(fn); } };
  const ch4 = C.createChallenges(ctx, P4, { storage: st4, now: () => atDay(dW) });
  P4.attach(br4); ch4.attach(br4);
  const f4 = (k, d) => (hs4[k] || []).forEach((fn) => fn(d));
  ok(ch4.status.hookedEnd, "challenges use progression.onSessionEnd");
  for (let m = 0; m < 2; m++) {
    f4("match:start", { mode: "tdm" });
    f4("mission:end", { result: "won", match: { modeId: "tdm", result: "win", winnerTeam: 0, actors: [] } });
  }
  const winsV = ch4.daily().find((x) => x.id === "d_wins");
  ok(winsV.done, "two wins complete Field Win");
  const rep = P4.lastReport;
  const chc = rep.cats.find((c) => c.cat === "challenge");
  ok(chc && chc.xp >= 1500, "its XP is in that match's after-action ledger (" + (chc && chc.xp) + ")");
  ok(ch4.lastSession && ch4.lastSession.items.some((i) => i.key === "d_wins" && i.done && i.xp === 1500), "session summary lists the completion for the after-action section");
  f4("match:start", { mode: "tdm" });
  f4("mission:end", { result: "won", match: { modeId: "tdm", result: "win", winnerTeam: 0, actors: [] } });
  ok(!(P4.lastReport.cats.find((c) => c.cat === "challenge") || { xp: 0 }).xp || !ch4.lastSession.items.some((i) => i.key === "d_wins"), "a third win pays Field Win nothing more");
  // reload: no double pay, progress kept
  const xpBefore = P4.xp();
  const ch4b = C.createChallenges(ctx, P4, { storage: st4, now: () => atDay(dW) });
  ok(ch4b.daily().find((x) => x.id === "d_wins").done && P4.xp() === xpBefore, "reload keeps it done and pays nothing");
  ok(ch4b.career().find((c) => c.id === "c_wins").value === 3, "career wins = 3");

  console.log("== swap (reroll) ==");
  const st5 = memStorage();
  now = atDay(d0, 9);
  const r5 = rig(st5, stubP());
  const before5 = r5.ch.daily().map((x) => x.id);
  ok(r5.ch.canReroll(1) && !r5.ch.rerollUsed, "one free swap available");
  const nid = r5.ch.reroll(1);
  const after5 = r5.ch.daily().map((x) => x.id);
  ok(nid && after5[1] === nid && before5.indexOf(nid) < 0 && after5[0] === before5[0] && after5[2] === before5[2], "swap replaces only that slot (" + before5[1] + " -> " + nid + ")");
  ok(new Set(after5.map((id) => byId[id].group)).size === 3, "the swapped-in challenge keeps groups distinct");
  ok(!r5.ch.canReroll(0) && r5.ch.reroll(0) === null, "second swap the same day is refused");
  const r5b = rig(st5, stubP());
  ok(JSON.stringify(r5b.ch.daily().map((x) => x.id)) === JSON.stringify(after5) && r5b.ch.rerollUsed, "swap survives reload");
  const st5c = memStorage(); const r5c = rig(st5c, stubP());
  ok(r5c.ch.reroll(1) === nid, "the swap result is deterministic for the day");
  // can't swap a completed one
  const st5d = memStorage(); const r5d = rig(st5d, stubP());
  const tgt0 = r5d.ch.daily()[0];
  const tpl0 = byId[tgt0.id];
  for (let i = 0; i < (tpl0.mode === "best" ? 1 : tpl0.target); i++) r5d.ch._fact(sample[tpl0.fact](tpl0.where, tpl0.target));
  ok(r5d.ch.daily()[0].done && !r5d.ch.canReroll(0), "a completed daily cannot be swapped");
  now = atDay(d0 + 1, 9);
  ok(r5.ch.canReroll(0) && !r5.ch.rerollUsed, "the swap comes back the next day");

  console.log("== resets: day, week, skipped days, clock changes ==");
  const st6 = memStorage();
  const wk0 = C.weekOfDay(d0);
  const monNext = C.weekStartDay(wk0 + 1);
  now = C.dayStartMs(monNext - 3) + 23 * 3600000 + 59 * 60000; // Fri 23:59
  const r6 = rig(st6, stubP());
  const dA = r6.ch.daily().map((x) => x.id), wA = r6.ch.weekly().map((x) => x.id);
  const wT = byId[wA[0]];
  r6.ch._fact(sample[wT.fact](wT.where, wT.target));
  const dT = byId[dA[0]];
  r6.ch._fact(sample[dT.fact](dT.where, dT.target));
  const rs = r6.ch.resets();
  ok(rs.daily === 60000, "daily countdown at 23:59 = 60 s (" + rs.daily + ")");
  ok(rs.weekly === 2 * 86400000 + 60000, "weekly countdown on Friday 23:59 = 2 d 0 h 1 m");
  now += 120000; // 00:01 Saturday
  const dB = r6.ch.daily().map((x) => x.id);
  ok(JSON.stringify(dA) !== JSON.stringify(dB) && r6.ch.daily().every((x) => x.p === 0), "midnight rolls the dailies, progress starts at 0");
  ok(r6.ch.weekly()[0].p >= 1 && JSON.stringify(r6.ch.weekly().map((x) => x.id)) === JSON.stringify(wA), "weekly progress survives the day change");
  now = C.dayStartMs(monNext) + 60000; // Monday 00:01
  ok(JSON.stringify(r6.ch.weekly().map((x) => x.id)) !== JSON.stringify(wA) && r6.ch.weekly().every((x) => x.p === 0), "Monday 00:00 rolls the weeklies");
  const expectMon = C.pickSet(C.DAILY, C.periodOrder(C.DAILY, C.daySeed(monNext)), 3, all);
  ok(JSON.stringify(r6.ch.daily().map((x) => x.id)) === JSON.stringify(expectMon), "a fresh day's set equals the pure date function");
  // skipped days
  now = C.dayStartMs(monNext + 9) + 3600000;
  const exp9 = C.pickSet(C.DAILY, C.periodOrder(C.DAILY, C.daySeed(monNext + 9)), 3, all);
  ok(JSON.stringify(r6.ch.daily().map((x) => x.id)) === JSON.stringify(exp9), "after 9 skipped days the set is that day's set (no backlog)");
  // clock back by one day: the current set stays (no replaying yesterday)
  const cur9 = JSON.stringify(r6.ch.daily());
  now = C.dayStartMs(monNext + 8) + 3600000;
  ok(JSON.stringify(r6.ch.daily()) === cur9, "clock wound back 1 day keeps the current set and its progress");
  ok(r6.ch.resets().daily > 86400000, "and its reset countdown runs to the end of the later day");
  now = C.dayStartMs(monNext + 2) + 3600000;
  const exp2 = C.pickSet(C.DAILY, C.periodOrder(C.DAILY, C.daySeed(monNext + 2)), 3, all);
  ok(JSON.stringify(r6.ch.daily().map((x) => x.id)) === JSON.stringify(exp2), "clock wound back 7 days = a clock correction: that date's set");
  // mid-session rollover: keep counting into the set the match began with
  const st7 = memStorage();
  now = C.dayStartMs(d0) + 23.9 * 3600000;
  const r7 = rig(st7, stubP());
  r7.fire("match:start", { mode: "tdm" });
  const set7 = r7.ch.daily().map((x) => x.id);
  now = C.dayStartMs(d0 + 1) + 600000;
  const tpl7 = byId[set7[0]];
  r7.ch._fact(sample[tpl7.fact](tpl7.where, tpl7.target));
  ok(JSON.stringify(r7.ch.state.day.ids) === JSON.stringify(set7) && r7.ch.state.day.prog[set7[0]].p >= 1, "a match that runs past midnight keeps counting into the set it began with");
  r7.ch._end({ result: "lost", match: { modeId: "tdm", result: "loss", actors: [] } });
  ok(JSON.stringify(r7.ch.daily().map((x) => x.id)) !== JSON.stringify(set7), "and the next day's set appears once it ends");

  console.log("== career tiers ==");
  const aw8 = [];
  const ch8 = C.createChallenges(ctx, { award(c, n, l) { aw8.push(l); }, isUnlocked: () => true, onSessionEnd() {}, onEvent() {} }, { storage: memStorage(), now: () => now });
  for (let i = 0; i < 49; i++) ch8._fact({ k: "kill", via: null, dist: 10, impaired: {} });
  ok(!aw8.some((l) => /Eliminations I$/.test(l)), "49 kills: tier I not yet");
  ch8._fact({ k: "kill", via: null, dist: 10, impaired: {} });
  ok(aw8.filter((l) => l === "Career: Eliminations I").length === 1, "50th kill pays Eliminations I once");
  ch8._fact({ k: "lifeStreak", value: 12 });
  ok(aw8.indexOf("Career: Untouchable I") >= 0 && aw8.indexOf("Career: Untouchable II") >= 0 && aw8.indexOf("Career: Untouchable III") < 0, "a 12 streak pays Untouchable I and II in one go, not III");
  ch8._fact({ k: "lifeStreak", value: 3 });
  ok(ch8.career().find((c) => c.id === "c_streak").value === 12, "best-type metric never goes down");
  ok(ch8.careerSummary().done === 3 && ch8.careerSummary().total === C.CAREER_TIERS, "summary 3 / " + C.CAREER_TIERS);
  // seeding from an existing profile: tiers marked, no XP
  const aw9 = [];
  const P9 = { award(c, n, l) { aw9.push(l); }, isUnlocked: () => true, onSessionEnd() {}, onEvent() {},
    lifetime: { kills: 260, heads: 30, matches: 12, wins: 6, bestStreak: 7 }, state: { weapons: { warden: { kills: 120 } } } };
  const ch9 = C.createChallenges(ctx, P9, { storage: memStorage(), now: () => now });
  const c9 = {}; for (const c of ch9.career()) c9[c.id] = c;
  ok(c9.c_kills.value === 260 && c9.c_kills.tier === 2 && c9.c_warden.tier === 1 && c9.c_streak.tier === 1, "first load seeds career from the progression profile");
  ok(aw9.length === 0, "seeded tiers pay no retroactive XP");
  ch9._fact({ k: "kill", via: null, dist: 10, impaired: {} });
  ok(aw9.length === 0, "and the next kill does not re-pay them");

  console.log("== save / migrate / corrupt / future / quota ==");
  const sA = memStorage({ [KEY]: "{oops" });
  const cA = C.createChallenges(ctx, stubP(), { storage: sA, now: () => now });
  ok(cA.status.load === "corrupt" && sA.m.get(KEY + ".corrupt") === "{oops" && JSON.parse(sA.m.get(KEY)).v === 1, "corrupt JSON -> fresh record, bad bytes kept aside");
  ok(cA.daily().length === 3 && cA.weekly().length === 3, "and a full set is live");
  const sB = memStorage({ [KEY]: JSON.stringify({ v: 1, maxDay: "x", day: { n: d0, ids: ["d_sweep", "nope", 5], prog: { d_sweep: { p: 1e9 } } }, career: { c: { kills: -5, "bad key!": 3 }, tier: { c_kills: 99, zz: 1 } } }) });
  now = atDay(d0);
  const cB = C.createChallenges(ctx, stubP(), { storage: sB, now: () => now });
  const sv = cB.state;
  ok(sv.day.ids.join() === "d_sweep" && sv.day.prog.d_sweep.p === byId.d_sweep.target && sv.day.prog.d_sweep.done, "garbage ids dropped, absurd progress clamped (and treated as already claimed)");
  ok(sv.career.c.kills === 0 && !("bad key!" in sv.career.c) && sv.career.tier.c_kills === 5 && !("zz" in sv.career.tier), "career counters / tiers sanitised");
  const sC = memStorage({ [C.SAVE_KEY]: JSON.stringify({ career: { kills: 300 }, paid: { c_kills: 2 } }) });
  const cC = C.createChallenges(ctx, stubP(), { storage: sC, now: () => now });
  ok(cC.status.load === "migrated" && cC.career().find((c) => c.id === "c_kills").value === 300 && cC.career().find((c) => c.id === "c_kills").tier === 2, "v0 record migrates (career kept)");
  ok(sC.m.has(KEY) && !sC.m.has(C.SAVE_KEY), "migrated record moves to the versioned key");
  const fut = JSON.stringify({ v: 9, maxDay: d0 });
  const sD = memStorage({ [KEY]: fut });
  const cD = C.createChallenges(ctx, stubP(), { storage: sD, now: () => now });
  cD._fact({ k: "assist" });
  ok(cD.status.readOnly && sD.m.get(KEY) === fut, "a newer build's record is never overwritten");
  const sE = memStorage(); sE.quota = 10;
  let threw = false; let cE;
  try { cE = C.createChallenges(ctx, stubP(), { storage: sE, now: () => now }); cE._fact({ k: "assist" }); } catch (e) { threw = true; }
  ok(!threw && cE.status.saveFailed && cE.daily().length === 3, "quota exceeded: no throw, session-only");
  const sF = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("SecurityError"); }, removeItem() {} };
  let tF = false;
  try { const cF = C.createChallenges(ctx, stubP(), { storage: sF, now: () => now }); cF._fact({ k: "assist" }); cF.reroll(0); } catch (e) { tF = true; }
  ok(!tF, "storage that throws on every call never breaks the game");
  let tG = false;
  try { const cG = C.createChallenges(ctx, null, { storage: null, now: () => now }); cG._fact({ k: "kill", dist: 5, impaired: {} }); cG._end({ result: "won" }); } catch (e) { tG = true; }
  ok(!tG, "no progression and no storage: still runs");

  console.log(`challenges.selftest: ${pass} passed, ${fail} failed`);
  console.log(fail ? "RESULT: FAIL" : "RESULT: OK");
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log("RESULT: FAIL"); process.exit(1); });
