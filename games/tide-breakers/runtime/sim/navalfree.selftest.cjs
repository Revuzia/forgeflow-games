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

// ── 3. Firing IN RANGE (and in arc + LOS) damages the target ─────────────────
(function testFireInRange() {
  const g = fresh();
  const e1 = g.shipById("E1");
  const hpBefore = e1.hp; // 50
  const chk = g.canFireAt("P1", e1.x, e1.y);
  ok(chk.ok, "canFireAt reports a clear shot on the near target");
  const r = g.fireAt("P1", "E1");
  ok(r.result === "hit" || r.result === "sink", "in-range fire HITS (got " + r.result + ")");
  ok(r.dmg > 0, "in-range fire reports positive damage (" + r.dmg + ")");
  ok(g.shipById("E1").hp === hpBefore - r.dmg, "target hp dropped by exactly the reported damage");
  ok(g.shipById("E1").hp < hpBefore, "target hp decreased");
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
  const r = g.fireAt("P1", "E1");
  ok(r.result === "sink", "killing blow reports a SINK (got " + r.result + ")");
  ok(r.win === true, "killing blow flags win=true");
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

// ── summary ──────────────────────────────────────────────────────────────────
console.log("-------------------");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
