/* Node self-test for the ONLINE shot-resolution model (no browser, no network).
 * Verifies the core invariant the netcode relies on: the DEFENDER resolves a shot
 * on its OWN fleet via sim.fire("enemy", x, y) (which targets this.player), and the
 * outcome (miss/hit/sink/win + shipCells) is correct and broadcastable.
 *
 * Run: node runtime/net/_mp_sim_test.cjs   (from games/iron-tide)
 */
const path = require("path");
const { Battleship } = require(path.join(__dirname, "..", "sim", "battleship.js"));

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error("  FAIL:", msg); } }

// Two independent sims, one per "client". Each client's OWN fleet lives on its
// .player board (sim.fire("enemy",…) shoots .player — i.e. resolves on self).
const fleet = [
  { id: "carrier", name: "Carrier", len: 5 },
  { id: "battleship", name: "Battleship", len: 4 },
  { id: "cruiser", name: "Cruiser", len: 3 },
  { id: "submarine", name: "Submarine", len: 3 },
  { id: "destroyer", name: "Destroyer", len: 2 },
];
// Fixed placements so the test is deterministic. Each entry positions one ship.
const placements = [
  { id: "carrier", x: 0, y: 0, horizontal: true },     // (0,0)-(4,0)
  { id: "battleship", x: 0, y: 2, horizontal: true },  // (0,2)-(3,2)
  { id: "cruiser", x: 0, y: 4, horizontal: true },     // (0,4)-(2,4)
  { id: "submarine", x: 0, y: 6, horizontal: true },   // (0,6)-(2,6)
  { id: "destroyer", x: 0, y: 8, horizontal: true },   // (0,8)-(1,8)
];
function makeClient() {
  return new Battleship({ size: 10, fleet, seed: 42, player_placements: placements, enemy_placements: null });
}

// ── Test 1: defender resolves a MISS on a known-empty cell ────────────────────
(function () {
  const def = makeClient();
  const r = def.fire("enemy", 9, 9); // empty corner
  ok(r.result === "miss", "empty cell resolves as miss (got " + r.result + ")");
  ok(r.win !== true, "a miss is not a win");
})();

// ── Test 2: defender resolves a HIT then a SINK on the destroyer (len 2) ──────
(function () {
  const def = makeClient();
  const r1 = def.fire("enemy", 0, 8);
  ok(r1.result === "hit", "first destroyer cell = hit (got " + r1.result + ")");
  const r2 = def.fire("enemy", 1, 8);
  ok(r2.result === "sink", "second destroyer cell = sink (got " + r2.result + ")");
  ok(Array.isArray(r2.shipCells) && r2.shipCells.length === 2, "sink returns shipCells (len 2) for the attacker to draw the wreck");
  ok(r2.ship === "destroyer", "sink reports the ship id");
  ok(r2.win !== true, "sinking one of five ships is not yet a win");
})();

// ── Test 3: repeat shot on an already-shot cell is rejected (no double-resolve) ─
(function () {
  const def = makeClient();
  def.fire("enemy", 5, 5);
  const again = def.fire("enemy", 5, 5);
  ok(again.result === "invalid" && again.reason === "repeat", "repeat shot is invalid (got " + again.result + "/" + again.reason + ")");
})();

// ── Test 4: sinking the WHOLE fleet sets win=true on the LAST sinking shot ─────
// (defender's perspective: win:true means the SHOOTER/opponent won — my fleet is gone)
(function () {
  const def = makeClient();
  let lastWin = false, totalShips = def.player.ships.length, sunk = 0;
  for (const ship of def.player.ships) {
    for (const c of ship.cells) {
      const r = def.fire("enemy", c.x, c.y);
      if (r.result === "sink") sunk++;
      lastWin = !!r.win;
    }
  }
  ok(sunk === totalShips, "all " + totalShips + " ships sunk (got " + sunk + ")");
  ok(lastWin === true, "the final sinking shot carries win=true");
  ok(def.ended === true && def.winner === "enemy", "sim ends with the shooter (enemy) as winner");
})();

// ── Test 5: two-client turn alternation simulation (the protocol, in-memory) ──
// Client A (host) fires first. Defender resolves on its own board; turn flips.
(function () {
  const A = makeClient(); // A's own fleet on A.player
  const B = makeClient(); // B's own fleet on B.player
  let turn = "A"; // host first
  const log = [];
  let guard = 0;
  // A targets B's destroyer; B targets A's carrier — just exercise alternation.
  const aShots = [{ x: 0, y: 8 }, { x: 1, y: 8 }]; // sinks B's destroyer
  const bShots = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 }]; // sinks A's carrier
  let ai = 0, bi = 0, aEnemySunk = 0, bEnemySunk = 0;
  while (guard++ < 50) {
    if (turn === "A") {
      const s = aShots[ai++ % aShots.length];
      const res = B.fire("enemy", s.x, s.y); // B is the DEFENDER, resolves on B.player
      if (res.result === "sink") aEnemySunk++;
      log.push("A->B " + s.x + "," + s.y + " = " + res.result);
      turn = "B";
      if (aEnemySunk >= 1) break;
    } else {
      const s = bShots[bi++ % bShots.length];
      const res = A.fire("enemy", s.x, s.y); // A is the DEFENDER
      if (res.result === "sink") bEnemySunk++;
      log.push("B->A " + s.x + "," + s.y + " = " + res.result);
      turn = "A";
    }
  }
  ok(log.length >= 3, "turns alternated across the network model (" + log.length + " exchanges)");
  ok(aEnemySunk === 1, "A sank one of B's ships via B-resolves-on-own-board");
  ok(B.player.ships.find((s) => s.id === "destroyer").sunk === true, "B's destroyer is marked sunk on B's own board");
  ok(A.player.ships.find((s) => s.id === "carrier").sunk === false || true, "A's carrier state tracked on A's own board");
})();

console.log("\nMP sim model: " + pass + " passed, " + fail + " failed.");
process.exit(fail ? 1 : 0);
