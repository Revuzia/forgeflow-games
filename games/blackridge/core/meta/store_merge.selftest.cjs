// core/meta/store_merge.selftest.cjs — two open tabs sharing one localStorage
// must not overwrite each other's progress (polish v149, gap 2).
//   node core/meta/store_merge.selftest.cjs
// Two progression / challenges / loadouts instances share ONE memory storage,
// play interleaved "matches", save in both orders, and every delta must land
// exactly once. THREE-free, DOM-free.
const path = require("path");
const { pathToFileURL } = require("url");

let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log("  PASS  " + msg); } else { fail++; console.log("  FAIL  " + msg); } }
function memStorage() {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}

async function main() {
  const root = path.resolve(__dirname, "..", "..");
  const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
  const SM = await imp("core/meta/store_merge.js");
  const P = await imp("core/meta/progression.js");
  const C = await imp("core/meta/challenges.js");
  const L = await imp("core/meta/loadouts.js");

  console.log("== merge3 rules ==");
  const rule = (p) => (p === "n" ? "sum" : p === "best" ? "max" : p === "set" ? "union" : p === "flag" ? "or" : null);
  const base = { n: 10, best: 3, set: ["a"], name: "x", flag: false, nest: { k: 1 } };
  const cur = { n: 15, best: 2, set: ["a", "b"], name: "x", flag: true, nest: { k: 1 } };
  const disk = { n: 12, best: 7, set: ["a", "c"], name: "y", flag: false, nest: { k: 2 }, extra: 1 };
  const m = SM.merge3(base, cur, disk, rule);
  ok(m.n === 17, "sum: disk 12 + (cur 15 − base 10) = 17 (" + m.n + ")");
  ok(m.best === 7, "max keeps the high-water mark");
  ok(JSON.stringify(m.set) === '["a","c","b"]', "union keeps both tabs' entries once");
  ok(m.name === "y" && m.nest.k === 2, "lww: unchanged-here values take disk's");
  ok(m.flag === true && m.extra === 1, "or-flag sticky; keys only on disk survive");
  ok(SM.merge3({ name: "x" }, { name: "z" }, { name: "y" }, null).name === "z", "lww: a value this tab changed wins");

  // ---- progression: two tabs ---------------------------------------------------
  console.log("== progression, two tabs ==");
  const KEY = P.SAVE_KEY + ".v" + P.SAVE_VERSION;
  const store = memStorage();
  function tab() {
    const h = {};
    const st = { time: 0, player: { weapon: { id: "warden" } }, match: null };
    const ctx = { sim: () => ({ state: st, match: null, mission: null }) };
    const prog = P.createProgression(ctx, { storage: store });
    prog.attach({ register: (k, fn) => { (h[k] = h[k] || []).push(fn); } });
    const fire = (k, d) => (h[k] || []).forEach((fn) => fn(d));
    return { prog, fire, st };
  }
  const A = tab(), B = tab();
  // A: one headshot kill with the vesper (150 XP, vesper +150); B: two kills with the warden (200, warden +200)
  A.fire("mission:start", { missionId: "op" });
  A.fire("shot", { shooter: "P", weaponId: "vesper" });
  A.fire("death", { attacker: "P", victim: 3, headshot: true });
  B.fire("mission:start", { missionId: "op" });
  B.fire("shot", { shooter: "P", weaponId: "warden" }); B.fire("death", { attacker: "P", victim: 4 });
  B.fire("shot", { shooter: "P", weaponId: "warden" }); B.fire("death", { attacker: "P", victim: 5 });
  const disk1 = JSON.parse(store.getItem(KEY));
  ok(disk1.xp === 350, "both tabs' XP on disk after both saved: 150 + 200 = 350 (" + disk1.xp + ")");
  ok(disk1.weapons.vesper.xp === 150 && disk1.weapons.warden.xp === 200, "per-weapon XP from both tabs kept");
  ok(disk1.life.kills === 3 && disk1.life.heads === 1, "lifetime kills 3 / heads 1 (" + disk1.life.kills + "/" + disk1.life.heads + ")");
  // A saves again with no new progress: nothing may be added twice
  A.prog.award("kill", 0, "noop");
  A.fire("death", { attacker: 9, victim: "P" });
  const disk2 = JSON.parse(store.getItem(KEY));
  ok(disk2.xp === 350 && disk2.life.kills === 3, "a later save from the other tab adds nothing twice (" + disk2.xp + ")");
  // B's in-memory view after it absorbs A's write on its next save
  B.fire("death", { attacker: 9, victim: "P" });
  ok(B.prog.xp() === 350 && A.prog.xp() === 350, "both tabs converge to 350 XP (A " + A.prog.xp() + ", B " + B.prog.xp() + ")");
  // bestStreak is a high-water mark, not a sum
  const life = JSON.parse(store.getItem(KEY)).life;
  ok(life.bestStreak === 2, "bestStreak = max of the tabs (2), not their sum (" + life.bestStreak + ")");
  // storage-event path: absorb without writing
  const C3 = tab();
  C3.fire("shot", { shooter: "P", weaponId: "pike" }); C3.fire("death", { attacker: "P", victim: 6 });
  ok(JSON.parse(store.getItem(KEY)).xp === 450, "third tab adds its 100 on top (450)");

  // ---- challenges: two tabs -------------------------------------------------------
  console.log("== challenges, two tabs ==");
  const cstore = memStorage();
  const CKEY = C.SAVE_KEY + ".v" + C.SAVE_VERSION;
  const day = C.dayNumber(Date.UTC(2026, 10, 13, 12));
  const fakeP = { award() {}, isUnlocked: () => true, onSessionEnd() {}, onEvent() {} };
  function ctab() {
    const h = {};
    const st = { time: 0, player: { pos: [0, 0, 0], stance: "stand", weapon: { id: "warden" } }, match: { modeId: "tdm" } };
    const ctx = { sim: () => ({ state: st, match: { sameTeam: () => false } }) };
    const ch = C.createChallenges(ctx, fakeP, { storage: cstore, now: () => C.dayStartMs(day) + 3600e3 });
    ch.attach({ register: (k, fn) => { (h[k] = h[k] || []).push(fn); } });
    return { ch, fire: (k, d) => (h[k] || []).forEach((fn) => fn(d)), st };
  }
  const X = ctab(), Y = ctab();
  const kill = (T, n) => { for (let i = 0; i < n; i++) { T.fire("shot", { shooter: "P", weaponId: "warden" }); T.fire("death", { attacker: "P", victim: 10 + i, pos: [5, 0, 0] }); } };
  X.fire("match:start", { mode: "tdm" }); Y.fire("match:start", { mode: "tdm" });
  kill(X, 3); kill(Y, 4);
  X.fire("mission:end", { result: "lost", match: { modeId: "tdm", actors: [] } });
  Y.fire("mission:end", { result: "lost", match: { modeId: "tdm", actors: [] } });
  if (X.ch.flush) X.ch.flush(); if (Y.ch.flush) Y.ch.flush();
  const cd = JSON.parse(cstore.getItem(CKEY) || "{}");
  ok(cd.career && cd.career.c && cd.career.c.kills === 7, "career kills from both tabs: 3 + 4 = 7 (" + (cd.career && cd.career.c.kills) + ")");
  ok(cd.day && cd.day.n === day && Array.isArray(cd.day.ids) && cd.day.ids.length > 0, "the shared daily set survives the merge");
  const mergeSlotRule = C.challengesMergeRule("day");
  const slotBase = { n: day, ids: ["a", "b"], prog: { a: { p: 1, done: false }, b: { p: 0, done: false } }, swapped: false, out: [] };
  const slotCur = { n: day, ids: ["a", "b"], prog: { a: { p: 3, done: false }, b: { p: 0, done: false } }, swapped: false, out: [] };
  const slotDisk = { n: day, ids: ["a", "b"], prog: { a: { p: 2, done: false }, b: { p: 1, done: true } }, swapped: false, out: [] };
  const sm = mergeSlotRule(slotBase, slotCur, slotDisk);
  ok(sm.prog.a.p === 4 && sm.prog.b.done === true, "daily progress: disk 2 + (3 − 1) = 4; done is sticky");
  const newer = mergeSlotRule(slotBase, Object.assign({}, slotCur, { n: day + 1 }), slotDisk);
  ok(newer.n === day + 1, "a tab on the newer day keeps its slot");

  // ---- loadouts: two tabs -------------------------------------------------------
  console.log("== class loadouts, two tabs ==");
  const lstore = memStorage();
  const LA = L.createLoadouts({ storage: lstore }), LB = L.createLoadouts({ storage: lstore });
  ok(LA.update(0, { name: "ALPHA" }), "tab A renames class 1");
  ok(LB.update(1, { name: "BRAVO" }), "tab B (stale) renames class 2");
  const lrec = JSON.parse(lstore.getItem(L.STORE_KEY));
  ok(lrec.classes[0].name === "ALPHA" && lrec.classes[1].name === "BRAVO", "both edits survive (" + lrec.classes[0].name + " / " + lrec.classes[1].name + ")");

  console.log(`store_merge selftest: ${pass} passed, ${fail} failed`);
  console.log(fail ? "RESULT: FAIL" : "RESULT: OK");
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); console.log("RESULT: FAIL"); process.exit(1); });
