/**
 * Node self-test for sim/navalfree.js — asserts the defining mechanics.
 * Run: node games/tide-breakers/runtime/sim/navalfree.selftest.cjs
 * Exit 0 = all pass, exit 1 = a failure (CI / signature gate readable).
 *
 * .cjs so it's CommonJS even though the package is "type":"module".
 */
"use strict";
// The repo package is "type":"module", so a bare `.js` is loaded as ESM and its
// CommonJS `module.exports` is ignored — but the sim's universal IIFE still sets
// globalThis.FFG.sim.NavalFree as a side effect. Take whichever export channel
// actually populated (CJS require under a non-module package, or the global).
const _req = require("./navalfree.js");
const NavalFree = _req.NavalFree || (globalThis.FFG && globalThis.FFG.sim && globalThis.FFG.sim.NavalFree);
if (typeof NavalFree !== "function") { console.error("FAIL: could not load NavalFree from sim module"); process.exit(1); }

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  PASS  " + msg); }
  else { failed++; console.error("  FAIL  " + msg); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-6 : eps); }

// Build a deterministic, fully-controlled scenario (no default-fleet surprises).
function fresh() {
  return new NavalFree({
    width: 300, height: 300, seed: 7,
    actionsPerTurn: 2,
    firstSide: "player",
    ships: [
      // Player gun: range 100, wide arc (so arc never the blocker in these tests), dmg 30.
      { id: "P1", side: "player", x: 50, y: 150, heading: 0 /* facing +X */, hp: 100, speed: 40, turnRate: 180, gun: { range: 100, arc: 200 * Math.PI / 180, dmg: 30 }, radius: 6 },
      // Enemy target dead ahead at x=120 (range 70 — in range), hp 50.
      { id: "E1", side: "enemy", x: 120, y: 150, heading: Math.PI, hp: 50, speed: 30, turnRate: 120, gun: { range: 90, arc: 120 * Math.PI / 180, dmg: 25 }, radius: 6 },
      // A far enemy at x=260 (range 210 — out of range) so we can test range failure.
      { id: "E2", side: "enemy", x: 260, y: 150, heading: Math.PI, hp: 50, speed: 30, turnRate: 120, gun: { range: 90, arc: 120 * Math.PI / 180, dmg: 25 }, radius: 6 },
    ],
  });
}

console.log("navalfree self-test\n-------------------");

// ── 1. MOVE respects the movement budget ────────────────────────────────────
(function testMoveBudget() {
  const g = fresh();
  const before = { x: g.shipById("P1").x, y: g.shipById("P1").y };
  // Ask to move 1000 units to the right — far beyond the speed budget (40).
  const r = g.moveShip("P1", 1000, 0);
  ok(r.ok, "move returns ok");
  const moved = Math.hypot(g.shipById("P1").x - before.x, g.shipById("P1").y - before.y);
  ok(moved <= 40 + 1e-6, "move distance (" + moved.toFixed(2) + ") capped at speed budget 40");
  ok(approx(moved, 40, 0.5), "move used (nearly) the full budget toward the target");
  ok(r.actionsLeft === 1, "move consumed exactly 1 action (2 -> 1)");

  // A within-budget move travels exactly the requested distance.
  const g2 = fresh();
  const r2 = g2.moveShip("P1", 10, 0); // 10 < 40
  const moved2 = Math.hypot(g2.shipById("P1").x - 50, g2.shipById("P1").y - 150);
  ok(approx(moved2, 10, 1e-3), "within-budget move travels the requested 10u (got " + moved2.toFixed(3) + ")");
})();

// ── 2. Firing OUT OF RANGE fails (no damage) ─────────────────────────────────
(function testFireOutOfRange() {
  const g = fresh();
  const e2 = g.shipById("E2");
  const hpBefore = e2.hp;
  const r = g.fireAt("P1", "E2"); // E2 is 210u away, gun range 100
  ok(r.result === "invalid" && r.reason === "range", "out-of-range fire is invalid with reason 'range' (got " + r.result + "/" + r.reason + ")");
  ok(g.shipById("E2").hp === hpBefore, "out-of-range fire deals NO damage");

  // Also verify the canFireAt predicate agrees.
  const chk = g.canFireAt("P1", e2.x, e2.y);
  ok(!chk.ok && chk.reason === "range", "canFireAt reports range failure for the far target");
})();

// ── 3. Firing IN RANGE rolls a d20 to-hit, then dice damage ──────────────────
//     (D&D combat 2026-06: an in-range/in-arc/LOS shot can HIT for a banded dice
//      roll, or MISS on the to-hit roll. Damage accounting must be exact.)
(function testFireInRange() {
  const g = new NavalFree({
    width: 300, height: 300, seed: 7, actionsPerTurn: 2, firstSide: "player",
    ships: [
      { id: "P1", side: "player", x: 50, y: 150, heading: 0, hp: 100, speed: 40, turnRate: 180, gun: { range: 100, arc: 200 * Math.PI / 180, dmg: 30 }, radius: 6 },
      { id: "E1", side: "enemy", x: 110, y: 150, heading: Math.PI, hp: 1e9, speed: 30, turnRate: 120, gun: { range: 90, arc: 120 * Math.PI / 180, dmg: 25 }, radius: 6 },
    ],
  });
  ok(g.canFireAt("P1", 110, 150).ok, "canFireAt reports a clear shot on the near target");
  let hits = 0, misses = 0, dmgMin = 1e9, dmgMax = 0, sawCrit = false, badAccounting = false;
  for (let k = 0; k < 300; k++) {
    g._refreshActions("player");
    const before = g.shipById("E1").hp;
    const r = g.fireAt("P1", "E1");
    if (r.result === "miss") { misses++; if (g.shipById("E1").hp !== before) badAccounting = true; }
    else { hits++; dmgMin = Math.min(dmgMin, r.dmg); dmgMax = Math.max(dmgMax, r.dmg);
      if (r.crit) sawCrit = true;
      if (r.dmg <= 0 || g.shipById("E1").hp !== before - r.dmg) badAccounting = true; }
  }
  ok(hits > 0 && misses > 0, `in-range fire both HITS and MISSES over 300 shots (hits ${hits}, misses ${misses})`);
  ok(!badAccounting, "every hit drops hp by exactly the reported (positive) damage; misses deal none");
  ok(dmgMin >= 30 * (1 - 0.30) - 1, `min rolled damage near the band floor ~21 (got ${dmgMin})`);
  ok(dmgMax <= Math.round(30 * 1.30 * 1.5) + 1, `max rolled damage within the crit ceiling ~59 (got ${dmgMax})`);
  ok(sawCrit, "at least one natural-20 CRIT occurred over 300 shots");
})();

// ── 3b. Firing OUT OF ARC fails (target behind the bow) ──────────────────────
(function testFireOutOfArc() {
  // Narrow-arc shooter facing +X, target directly BEHIND it (-X) -> out of arc.
  const g = new NavalFree({
    width: 300, height: 300, seed: 3, actionsPerTurn: 2, firstSide: "player",
    ships: [
      { id: "P1", side: "player", x: 150, y: 150, heading: 0, hp: 100, speed: 30, turnRate: 30, gun: { range: 120, arc: 40 * Math.PI / 180, dmg: 30 }, radius: 6 },
      { id: "E1", side: "enemy", x: 90, y: 150, heading: 0, hp: 50, speed: 30, turnRate: 30, gun: { range: 90, arc: 90 * Math.PI / 180, dmg: 25 }, radius: 6 },
    ],
  });
  const chk = g.canFireAt("P1", 90, 150);
  ok(!chk.ok && chk.reason === "arc", "target behind the bow is out of firing arc (got " + chk.reason + ")");
})();

// ── 3c. Line-of-sight is blocked by an intervening hull ──────────────────────
(function testLosBlocked() {
  // Shooter at x=50, target at x=150, a BLOCKER hull sitting at x=100 on the line.
  const g = new NavalFree({
    width: 300, height: 300, seed: 9, actionsPerTurn: 2, firstSide: "player",
    ships: [
      { id: "P1", side: "player", x: 50, y: 150, heading: 0, hp: 100, speed: 30, turnRate: 180, gun: { range: 200, arc: 200 * Math.PI / 180, dmg: 30 }, radius: 6 },
      { id: "BLOCK", side: "enemy", x: 100, y: 150, heading: 0, hp: 50, speed: 30, turnRate: 30, gun: { range: 90, arc: 90 * Math.PI / 180, dmg: 25 }, radius: 8 },
      { id: "E1", side: "enemy", x: 150, y: 150, heading: 0, hp: 50, speed: 30, turnRate: 30, gun: { range: 90, arc: 90 * Math.PI / 180, dmg: 25 }, radius: 6 },
    ],
  });
  const chk = g.canFireAt("P1", 150, 150, "E1"); // ignore the target itself for LOS, BLOCK still blocks
  ok(!chk.ok && chk.reason === "los", "intervening hull blocks line of sight (got " + chk.reason + ")");
  // And firing at the near, unobstructed enemy is fine.
  const chk2 = g.canFireAt("P1", 100, 150, "BLOCK");
  ok(chk2.ok, "the nearer (unobstructed) enemy is targetable");
})();

// ── 4. A side WINS when the other is wiped ───────────────────────────────────
(function testWinOnWipe() {
  // Single weak enemy, player gun one-shots it -> player wins.
  const g = new NavalFree({
    width: 300, height: 300, seed: 11, actionsPerTurn: 2, firstSide: "player",
    ships: [
      { id: "P1", side: "player", x: 50, y: 150, heading: 0, hp: 100, speed: 30, turnRate: 180, gun: { range: 200, arc: 200 * Math.PI / 180, dmg: 999 }, radius: 6 },
      { id: "E1", side: "enemy", x: 120, y: 150, heading: Math.PI, hp: 40, speed: 30, turnRate: 30, gun: { range: 90, arc: 90 * Math.PI / 180, dmg: 25 }, radius: 6 },
    ],
  });
  ok(g.ended === false, "match not over before the killing blow");
  // With dice a single shot may miss; fire until the killing blow lands (point-blank
  // so the hit chance is high; the loop is capped so a broken roll can't hang).
  let r = null, tries = 0;
  while (!g.ended && tries++ < 60) { g._refreshActions("player"); r = g.fireAt("P1", "E1"); }
  ok(r && r.result === "sink", "the landing killing blow reports a SINK (got " + (r && r.result) + ")");
  ok(r && r.win === true, "killing blow flags win=true");
  ok(g.ended === true, "match is ended after the last enemy sinks");
  ok(g.winner === "player", "winner is the player");
  ok(g.alive("enemy") === 0, "enemy side has no ships left");
  // A fire after the game ended is rejected.
  const r2 = g.fireAt("P1", "E1");
  ok(r2.result === "invalid" && r2.reason === "ended", "firing after game-over is invalid (ended)");
})();

// ── 5. Turn flow + action economy + AI takes a real turn ─────────────────────
(function testTurnFlowAndAI() {
  const g = fresh();
  // Player ship has 2 actions; enemy ships have 0 until their turn.
  ok(g.shipById("P1").actionsLeft === 2, "active side's ship starts with 2 actions");
  ok(g.shipById("E1").actionsLeft === 0, "inactive side's ship starts with 0 actions");
  // Player can't move an enemy ship.
  const bad = g.moveShip("E1", 10, 0);
  ok(!bad.ok && bad.reason === "not-your-turn", "cannot act with the opponent's ship on your turn");
  // Spend both actions then end turn.
  g.moveShip("P1", 5, 0); g.fireAt("P1", "E1");
  ok(g.sideExhausted("player"), "player side reports exhausted after spending all actions");
  g.endTurn();
  ok(g.turn === "enemy", "turn flips to enemy after endTurn");
  ok(g.shipById("E1").actionsLeft === 2, "enemy ships get refreshed actions on their turn");
  // AI takes its whole turn (moves/fires), then we end it.
  const acts = g.aiTakeTurn();
  ok(Array.isArray(acts) && acts.length > 0, "AI produced at least one action (" + acts.length + ")");
  ok(g.turn === "player", "after aiTakeTurn the turn is back to the player");
})();

// ── 6. To-hit scales with RANGE and target EVASION ───────────────────────────
(function testToHitScaling() {
  function hitRate(targetEvasion, distX, n) {
    const g = new NavalFree({
      width: 1000, height: 300, seed: 5, actionsPerTurn: 2, firstSide: "player",
      ships: [
        { id: "P1", side: "player", x: 50, y: 150, heading: 0, hp: 100, speed: 30, turnRate: 180, gun: { range: 300, arc: 200 * Math.PI / 180, dmg: 30 }, radius: 6 },
        { id: "E1", side: "enemy", x: 50 + distX, y: 150, heading: Math.PI, hp: 1e9, speed: 30, turnRate: 30, evasion: targetEvasion, gun: { range: 90, arc: 90 * Math.PI / 180, dmg: 25 }, radius: 6 },
      ],
    });
    let h = 0; for (let k = 0; k < 500; k++) { g._refreshActions("player"); if (g.fireAt("P1", "E1").result !== "miss") h++; }
    return h / 500;
  }
  const close = hitRate(0, 30, 500);    // point-blank, no evasion
  const far = hitRate(0, 270, 500);     // near max range (300), no evasion
  const evasive = hitRate(4, 30, 500);  // point-blank, max evasion
  ok(close > far + 0.10, `closer shots hit more than long-range (close ${(close*100)|0}% > far ${(far*100)|0}%)`);
  ok(close > evasive + 0.10, `evasive targets are harder to hit (vs ev0 ${(close*100)|0}% > vs ev4 ${(evasive*100)|0}%)`);
})();

// ── 7. ONLINE: applyFireResult reproduces a relayed shot without re-rolling ───
(function testApplyFireResult() {
  function scene(seed) {
    return new NavalFree({
      width: 300, height: 300, seed, actionsPerTurn: 2, firstSide: "player",
      ships: [
        { id: "P1", side: "player", x: 110, y: 150, heading: 0, hp: 100, speed: 30, turnRate: 180, gun: { range: 200, arc: 200 * Math.PI / 180, dmg: 30 }, radius: 6 },
        { id: "E1", side: "enemy", x: 130, y: 150, heading: Math.PI, hp: 1e9, speed: 30, turnRate: 30, gun: { range: 90, arc: 90 * Math.PI / 180, dmg: 25 }, radius: 6 },
      ],
    });
  }
  const A = scene(21), B = scene(999);   // DIFFERENT seeds on purpose
  let consistent = true, n = 0;
  for (let k = 0; k < 80; k++) {
    A._refreshActions("player"); B._refreshActions("player");
    const r = A.fireAt("P1", "E1"); n++;
    B.applyFireResult("P1", "E1", { result: r.result, dmg: r.dmg, crit: r.crit, d20: r.d20, toHit: r.toHit, sunk: r.sunk });
    if (A.shipById("E1").hp !== B.shipById("E1").hp || A.shipById("E1").sunk !== B.shipById("E1").sunk) { consistent = false; break; }
  }
  ok(consistent, `applyFireResult reproduces hp/sink exactly across ${n} relayed shots (online dice stay in sync despite different rng)`);
})();

// ── summary ──────────────────────────────────────────────────────────────────
console.log("-------------------");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
