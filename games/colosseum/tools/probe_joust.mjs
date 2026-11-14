// Prove the joust HAPPENS: riders close, lances resolve sub-tick, scores move,
// a verdict arrives, and the same seed replays the same joust.
//
// run: node games/colosseum/tools/probe_joust.mjs

import { Joust, JOUST } from "../runtime/sim/joust.js";

const DT = 1 / 60;
let checks = 0, failed = 0;
const ok = (cond, label) => {
  checks++;
  if (!cond) { failed++; console.log(`  FAIL: ${label}`); }
};

function run(seed, { couch = true, aim = "mid", skill = 0.5, maxT = 120 } = {}) {
  const events = [];
  const j = new Joust({ seed, opponent: { skill }, hooks: { onEvent: (e) => events.push(e) } });
  let minGap = Infinity, crossings = 0, lastSign = null;
  for (let t = 0; t < maxT && !j.result; t += DT) {
    const P = j.riders.player, O = j.riders.opponent;
    // Player policy: hold couch inside the last ~0.4 s before the projected
    // meeting — computed from live state, the same way a player would read it.
    const gapBefore = Math.abs(O.x - P.x);
    const closing = P.speed + O.speed;
    const tToMeet = closing > 1 ? (gapBefore - JOUST.lanceReach) / closing : 99;
    j.update(DT, { aim, couch: couch && j.state === "charge" && tToMeet < 0.4 });
    // Sample AFTER update: the sub-tick impact advances riders inside it, so
    // the pre-update gap never shows the moment of contact.
    const gap = Math.abs(O.x - P.x);
    minGap = Math.min(minGap, gap);
    const sign = Math.sign(O.x - P.x);
    if (lastSign !== null && sign !== 0 && sign !== lastSign) crossings++;
    lastSign = sign;
  }
  return { j, events, minGap, crossings };
}

console.log("JOUST PROBE");

// --- 1. a pass actually happens --------------------------------------------
const a = run(7);
const passes = a.events.filter((e) => e.type === "joust_pass").length;
const impacts = a.events.filter((e) => ["joust_miss", "joust_shield", "joust_body"].includes(e.type)).length;
console.log(`  seed 7: ${passes} passes, ${impacts} lance resolutions, minGap ${a.minGap.toFixed(2)}m, crossings ${a.crossings}, result ${a.j.result ? a.j.result.by : "NONE"}`);
ok(passes >= 1, "at least one pass resolves");
ok(impacts >= 2, "both lances resolve per pass");
ok(a.minGap <= JOUST.lanceReach + 0.01, "riders actually close to lance reach");
// A first-pass unhorse legitimately ends the joust before any ride-past.
const endedPass1 = a.j.result && a.j.result.by === "unhorse" && a.j.result.pass === 1;
ok(a.crossings >= 1 || endedPass1, "riders ride PAST each other after impact (unless a pass-1 unhorse ends it)");
ok(!!a.j.result, "the joust produces a verdict");

// --- 2. every pass resolves both lances at the same instant -----------------
const perPass = new Map();
for (const e of a.events) {
  if (["joust_miss", "joust_shield", "joust_body"].includes(e.type)) {
    perPass.set(e.pass, (perPass.get(e.pass) || 0) + 1);
  }
}
ok([...perPass.values()].every((n) => n === 2 || a.j.result?.by === "unhorse"),
  "each completed pass resolves exactly two lances (mutual impact)");

// --- 3. determinism ---------------------------------------------------------
const b1 = run(42), b2 = run(42);
ok(JSON.stringify(b1.j.snapshot()) === JSON.stringify(b2.j.snapshot()),
  "same seed -> identical joust");
const b3 = run(43);
ok(JSON.stringify(b1.j.snapshot()) !== JSON.stringify(b3.j.snapshot()),
  "different seed -> different joust");

// --- 4. skill matters -------------------------------------------------------
let winsGreen = 0, winsElite = 0;
for (let s = 1; s <= 20; s++) {
  if (run(s * 11, { skill: 0.1 }).j.result.playerWon) winsGreen++;
  if (run(s * 11, { skill: 0.95 }).j.result.playerWon) winsElite++;
}
console.log(`  player vs green opponent: ${winsGreen}/20 · vs elite: ${winsElite}/20`);
ok(winsGreen > winsElite, "a green opponent loses more often than an elite one");
ok(winsGreen >= 10, "a timed-couch player beats a green opponent more often than not");

// --- 5. never couching hurts ------------------------------------------------
let winsNoCouch = 0;
for (let s = 1; s <= 20; s++) if (run(s * 13, { couch: false }).j.result.playerWon) winsNoCouch++;
let winsCouch = 0;
for (let s = 1; s <= 20; s++) if (run(s * 13, { couch: true }).j.result.playerWon) winsCouch++;
console.log(`  couched ${winsCouch}/20 vs never-couched ${winsNoCouch}/20`);
ok(winsCouch > winsNoCouch, "couching the lance wins more than never couching");

// --- 6. unhorse ends it immediately ----------------------------------------
let sawUnhorse = false;
for (let s = 1; s <= 40 && !sawUnhorse; s++) {
  const r = run(s * 3);
  const u = r.events.find((e) => e.type === "joust_unhorse");
  if (u) {
    sawUnhorse = true;
    ok(r.j.result.by === "unhorse", "an unhorse decides the joust on the spot");
    const after = r.events.slice(r.events.indexOf(u) + 1)
      .filter((e) => ["joust_miss", "joust_shield", "joust_body"].includes(e.type));
    ok(after.length === 0, "no lance resolves after the unhorse");
  }
}
ok(sawUnhorse, "unhorsings occur across 40 seeds");

console.log(`\n-- verdict --\n  ${checks} checks, ${failed} failed`);
console.log(`  JOUST PROBE: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
