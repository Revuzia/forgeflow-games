/**
 * Node self-test for sim/chess.js — run with:  node runtime/sim/chess.test.cjs
 * Asserts: starting legal-move counts, illegal-move rejection, capture
 * resolution, en passant, castling (incl. blocked-by-check), promotion,
 * stalemate, and a KNOWN checkmate (Fool's Mate + Scholar's Mate). Exits non-zero
 * on any failure so CI / the build gate can detect a broken sim.
 *
 * The repo's package.json declares "type":"module", so Node loads chess.js as an
 * ES module when require()'d — module.exports stays empty and the UMD wrapper
 * instead publishes onto globalThis.FFG.sim (the same path the browser uses). We
 * require() for that side effect, then read the API off globalThis. This file is
 * .cjs so Node always runs IT as CommonJS regardless of the package type.
 */
require("./chess.js"); // side-effect: populates globalThis.FFG.sim.{Chess,ChessHelpers}
const H = (globalThis.FFG && globalThis.FFG.sim && globalThis.FFG.sim.ChessHelpers) || {};
const ChessGame = (globalThis.FFG && globalThis.FFG.sim && globalThis.FFG.sim.Chess) || H.ChessGame;
const fromAlgebraic = H.fromAlgebraic, algebraic = H.algebraic;
if (!ChessGame || !fromAlgebraic) { console.error("FATAL: chess sim did not load (globalThis.FFG.sim.Chess missing)"); process.exit(2); }

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error("  FAIL:", msg); } }
function eq(a, b, msg) { ok(a === b, `${msg} (expected ${b}, got ${a})`); }
function section(name) { console.log("\n• " + name); }

// ── 1. Starting position: legal move counts ───────────────────────────────────
section("Starting position");
{
  const g = new ChessGame();
  // White has exactly 20 legal first moves (16 pawn + 4 knight)
  eq(g.allLegalMoves("w").length, 20, "white opening has 20 legal moves");
  // each knight has 2 moves; b1 knight = a3,c3
  eq(g.legalMoves(fromAlgebraic("b1")).length, 2, "b1 knight has 2 moves");
  // e2 pawn: e3 + e4
  eq(g.legalMoves(fromAlgebraic("e2")).length, 2, "e2 pawn has 2 moves (one + two step)");
  // a back-rank piece boxed in has 0 moves
  eq(g.legalMoves(fromAlgebraic("a1")).length, 0, "a1 rook is boxed in (0 moves)");
  eq(g.status().turn, "w", "white to move first");
  eq(g.status().inCheck, false, "no check at start");
}

// ── 2. Illegal moves rejected ────────────────────────────────────────────────
section("Illegal move rejection");
{
  const g = new ChessGame();
  ok(g.move("e2", "e5").ok === false, "pawn cannot jump 3 squares");
  ok(g.move("b1", "b3").ok === false, "knight cannot move like a rook");
  ok(g.move("e1", "e2").ok === false, "king cannot move onto own pawn");
  ok(g.move("d2", "d4").ok === true, "legal pawn push accepted");
  // now black to move; white move must be rejected
  ok(g.move("d4", "d5").ok === false, "cannot move white again — not white's turn");
}

// ── 3. Pinned piece cannot expose the king ────────────────────────────────────
section("Absolute pin");
{
  const g = new ChessGame();
  // white K e1, white N e2, black R e8 -> the knight is pinned along the e-file
  g.setPosition([{ sq: "e1", p: "wK" }, { sq: "e2", p: "wN" }, { sq: "e8", p: "bR" }, { sq: "a1", p: "bK" }], "w");
  eq(g.legalMoves(fromAlgebraic("e2")).length, 0, "pinned knight has no legal moves");
  ok(g.inCheck("w") === false, "white not in check (pin only)");
}

// ── 4. Capture resolution ─────────────────────────────────────────────────────
section("Capture resolution");
{
  const g = new ChessGame();
  g.setPosition([{ sq: "e1", p: "wK" }, { sq: "e8", p: "bK" }, { sq: "d4", p: "wP" }, { sq: "e5", p: "bP" }], "w");
  const r = g.move("d4", "e5");
  ok(r.ok, "white pawn captures e5");
  eq(r.captured, "bP", "captured a black pawn");
  eq(g.get(fromAlgebraic("e5")), "wP", "white pawn now on e5");
  eq(g.get(fromAlgebraic("d4")), null, "d4 vacated");
}

// ── 5. En passant ─────────────────────────────────────────────────────────────
section("En passant");
{
  const g = new ChessGame();
  // White pawn e5, black plays d7-d5 -> white e5xd6 e.p.
  g.setPosition([{ sq: "e1", p: "wK" }, { sq: "e8", p: "bK" }, { sq: "e5", p: "wP" }, { sq: "d7", p: "bP" }], "b");
  ok(g.move("d7", "d5").ok, "black double-pushes d7-d5");
  eq(algebraic(g.enPassant), "d6", "en passant target is d6");
  const ep = g.move("e5", "d6");
  ok(ep.ok && ep.enPassant, "white captures en passant e5xd6");
  eq(ep.captured, "bP", "en passant captured the black pawn");
  eq(g.get(fromAlgebraic("d5")), null, "the d5 pawn was removed (behind the capture square)");
  eq(g.get(fromAlgebraic("d6")), "wP", "white pawn lands on d6");
}

// ── 6. Castling (king-side + queen-side + blocked by check) ───────────────────
section("Castling");
{
  const g = new ChessGame();
  g.setPosition(
    [{ sq: "e1", p: "wK" }, { sq: "h1", p: "wR" }, { sq: "a1", p: "wR" }, { sq: "e8", p: "bK" }],
    "w", { castling: { wK: true, wQ: true, bK: false, bQ: false } });
  const dests = g.legalMoves(fromAlgebraic("e1")).map(algebraic).sort();
  ok(dests.includes("g1"), "king-side castle available (Kg1)");
  ok(dests.includes("c1"), "queen-side castle available (Kc1)");
  const r = g.move("e1", "g1");
  ok(r.ok && r.castle === "K", "king-side castle executes");
  eq(g.get(fromAlgebraic("g1")), "wK", "king on g1");
  eq(g.get(fromAlgebraic("f1")), "wR", "rook hopped to f1");

  // cannot castle THROUGH check: black rook on f8 attacks f1 transit square
  const g2 = new ChessGame();
  g2.setPosition(
    [{ sq: "e1", p: "wK" }, { sq: "h1", p: "wR" }, { sq: "f8", p: "bR" }, { sq: "e8", p: "bK" }],
    "w", { castling: { wK: true, wQ: false, bK: false, bQ: false } });
  ok(!g2.legalMoves(fromAlgebraic("e1")).map(algebraic).includes("g1"), "cannot castle through an attacked square (f1)");

  // cannot castle WHILE in check
  const g3 = new ChessGame();
  g3.setPosition(
    [{ sq: "e1", p: "wK" }, { sq: "h1", p: "wR" }, { sq: "e7", p: "bR" }, { sq: "a8", p: "bK" }],
    "w", { castling: { wK: true, wQ: false, bK: false, bQ: false } });
  ok(!g3.legalMoves(fromAlgebraic("e1")).map(algebraic).includes("g1"), "cannot castle out of check");
}

// ── 7. Promotion ──────────────────────────────────────────────────────────────
section("Promotion");
{
  const g = new ChessGame();
  g.setPosition([{ sq: "e1", p: "wK" }, { sq: "a8", p: "bK" }, { sq: "h7", p: "wP" }], "w");
  const r = g.move("h7", "h8");
  ok(r.ok && r.promotion === "Q", "pawn promotes to queen on h8");
  eq(g.get(fromAlgebraic("h8")), "wQ", "queen now on h8");
}

// ── 8. Stalemate ──────────────────────────────────────────────────────────────
section("Stalemate");
{
  // Classic: black Kh8, white Qg6, white Kg... place a clean stalemate.
  // Black king a8, white queen c7? No. Use the canonical: bK h8, wK f7, wQ g6 -> black to move, no legal move, not in check.
  const g = new ChessGame();
  g.setPosition([{ sq: "h8", p: "bK" }, { sq: "f7", p: "wK" }, { sq: "g6", p: "wQ" }], "b");
  const st = g.status();
  ok(st.stalemate, "black is stalemated (no legal move, not in check)");
  ok(!st.checkmate, "stalemate is NOT checkmate");
  eq(st.result, "1/2-1/2", "stalemate scored as a draw");
}

// ── 9. KNOWN CHECKMATE: Fool's Mate (fastest mate) ────────────────────────────
section("Fool's Mate (the required known checkmate)");
{
  const g = new ChessGame();
  // 1. f3 e5  2. g4 Qh4#
  ok(g.move("f2", "f3").ok, "1. f3");
  ok(g.move("e7", "e5").ok, "1... e5");
  ok(g.move("g2", "g4").ok, "2. g4");
  const r = g.move("d8", "h4");
  ok(r.ok, "2... Qh4");
  ok(r.check, "Qh4 gives check");
  ok(r.checkmate, "Qh4 is CHECKMATE (Fool's Mate detected)");
  ok(r.mate === true, "result.mate flag set");
  // Black delivered mate; it is now White's turn and White is checkmated, so
  // Black wins. In PGN result notation Black winning is "0-1".
  eq(g.status().result, "0-1", "Black wins by checkmate -> 0-1");
  eq(g.allLegalMoves("w").length, 0, "white has zero legal replies");
}

// ── 10. KNOWN CHECKMATE: Scholar's Mate (second independent mate) ─────────────
section("Scholar's Mate");
{
  const g = new ChessGame();
  // 1. e4 e5  2. Bc4 Nc6  3. Qh5 Nf6??  4. Qxf7#
  ok(g.move("e2", "e4").ok, "1. e4");
  ok(g.move("e7", "e5").ok, "1... e5");
  ok(g.move("f1", "c4").ok, "2. Bc4");
  ok(g.move("b8", "c6").ok, "2... Nc6");
  ok(g.move("d1", "h5").ok, "3. Qh5");
  ok(g.move("g8", "f6").ok, "3... Nf6??");
  const r = g.move("h5", "f7");
  ok(r.ok, "4. Qxf7");
  eq(r.captured, "bP", "Qxf7 captures the f7 pawn");
  ok(r.checkmate, "Qxf7 is CHECKMATE (Scholar's Mate detected)");
}

// ── 11. AI sanity: legal move chosen, prefers a free capture ──────────────────
section("AI behaviour");
{
  const g = new ChessGame();
  // White to move with a hanging black queen on d5 reachable by Nxd5? Use a
  // simpler test: a free pawn capture should be taken by the greedy/minimax AI.
  g.setPosition([{ sq: "e1", p: "wK" }, { sq: "e8", p: "bK" }, { sq: "d4", p: "wP" }, { sq: "e5", p: "bP" }, { sq: "h2", p: "wP" }], "w");
  const before = g.allLegalMoves("w").length;
  ok(before > 0, "AI position has legal moves");
  const r = g.aiMove({ depth: 2 });
  ok(r && r.ok, "AI made a legal move");
  ok(r.captured === "bP", "AI took the free pawn capture (d4xe5)");

  // AI plays a full self-game without crashing or producing an illegal move
  const g2 = new ChessGame();
  let plies = 0, gameOver = false;
  while (plies < 120) {
    const res = g2.aiMove({ depth: 1 });
    if (!res) { gameOver = true; break; }          // no legal move => mate/stalemate
    if (res.gameOver) { gameOver = true; break; }
    plies++;
  }
  ok(plies > 4, `AI vs AI ran ${plies} plies without an illegal move`);
}

// ── 12. legalMoves(square) returns indices; move(from,to) round-trips ─────────
section("API shape");
{
  const g = new ChessGame();
  const lm = g.legalMoves(fromAlgebraic("g1"));
  ok(Array.isArray(lm) && lm.every((x) => Number.isInteger(x) && x >= 0 && x < 64), "legalMoves returns integer square indices");
  const st = g.status();
  ok(typeof st.turn === "string" && "inCheck" in st && "checkmate" in st && "stalemate" in st, "status() has the documented shape");
}

console.log(`\n${"=".repeat(48)}`);
console.log(`Chess sim self-test: ${pass} passed, ${fail} failed.`);
console.log("=".repeat(48));
process.exit(fail === 0 ? 0 : 1);
