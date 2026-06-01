/**
 * FFG runtime — sim/chess.js  (pure logic, Node-requireable + browser-global)
 * Full legal chess move generation for Warboard Chess (3D battle-chess).
 *
 * Board model: a 64-entry array, index = rank*8 + file, file 0..7 = a..h,
 * rank 0..7 = 1..8 (so index 0 = a1, index 63 = h8). White starts on ranks 1-2
 * (indices 0..15), Black on ranks 7-8 (indices 48..63). This matches the
 * renderer's grid (x = file, y = rank) so cell(x,y) maps straight to a square.
 *
 * A piece is a 2-char string: side ("w"/"b") + type ("P","N","B","R","Q","K"),
 * e.g. "wP", "bK". Empty squares are null.
 *
 * Implements: pawn (incl. two-step + en passant + promotion-to-queen), knight,
 * bishop, rook, queen, king + castling (king/queen side, with the standard
 * legality checks). Turn order, check detection, checkmate, stalemate, draw
 * (50-move + insufficient material), capture resolution.
 *
 * Public API (matches the brief):
 *   new ChessGame()                 — fresh standard start position
 *   legalMoves(square)              — array of destination squares (indices) for the piece on `square`
 *   legalMovesDetailed(square)      — array of {from,to,flags...} move objects
 *   allLegalMoves(side?)            — every legal move for the side to move (or given side)
 *   move(from, to, optsOrPromo)     — apply a move; returns {ok, captured?, check?, mate?, ...}
 *   status()                        — {turn, inCheck, checkmate, stalemate, result, fullmove, ...}
 *   aiMove(opts)                    — pick + apply a move for the side to move (1-2 ply negamax)
 *
 * Squares are integer indices 0..63 throughout. Helpers fileOf/rankOf/sq/algebraic
 * convert to/from file/rank and algebraic ("e4").
 *
 * No DOM, no three.js — safe to `require()` in Node for the self-test.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = mod;       // Node
  if (root) { root.FFG = root.FFG || {}; root.FFG.sim = root.FFG.sim || {}; root.FFG.sim.Chess = mod.ChessGame; root.FFG.sim.ChessHelpers = mod; } // browser
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this), function () {
  "use strict";

  // ── square helpers ──────────────────────────────────────────────────────────
  const fileOf = (s) => s & 7;          // 0..7  (a..h)
  const rankOf = (s) => s >> 3;         // 0..7  (1..8)
  const sq = (f, r) => r * 8 + f;       // file,rank -> index
  const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
  const FILES = "abcdefgh";
  function algebraic(s) { return FILES[fileOf(s)] + (rankOf(s) + 1); }
  function fromAlgebraic(a) {
    const f = FILES.indexOf(a[0]); const r = parseInt(a.slice(1), 10) - 1;
    return onBoard(f, r) ? sq(f, r) : -1;
  }
  const sideOf = (p) => (p ? p[0] : null);
  const typeOf = (p) => (p ? p[1] : null);
  const opp = (c) => (c === "w" ? "b" : "w");

  // sliding directions (file-delta, rank-delta)
  const DIR_ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DIR_BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const DIR_KING = DIR_ROOK.concat(DIR_BISHOP);
  const KNIGHT_D = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

  // material values (centipawns) for the AI eval
  const VALUE = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

  // piece-square tables (white POV; mirrored for black) — give the AI a sense of
  // development / centre control so it isn't purely material-greedy.
  const PST = {
    P: [0,0,0,0,0,0,0,0, 5,10,10,-20,-20,10,10,5, 5,-5,-10,0,0,-10,-5,5, 0,0,0,20,20,0,0,0, 5,5,10,25,25,10,5,5, 10,10,20,30,30,20,10,10, 50,50,50,50,50,50,50,50, 0,0,0,0,0,0,0,0],
    N: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,5,5,0,-20,-40, -30,5,10,15,15,10,5,-30, -30,0,15,20,20,15,0,-30, -30,5,15,20,20,15,5,-30, -30,0,10,15,15,10,0,-30, -40,-20,0,0,0,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
    B: [-20,-10,-10,-10,-10,-10,-10,-20, -10,5,0,0,0,0,5,-10, -10,10,10,10,10,10,10,-10, -10,0,10,10,10,10,0,-10, -10,5,5,10,10,5,5,-10, -10,0,5,10,10,5,0,-10, -10,0,0,0,0,0,0,-10, -20,-10,-10,-10,-10,-10,-10,-20],
    R: [0,0,0,5,5,0,0,0, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 5,10,10,10,10,10,10,5, 0,0,0,0,0,0,0,0],
    Q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,5,0,0,0,0,-10, -10,5,5,5,5,5,0,-10, 0,0,5,5,5,5,0,-5, -5,0,5,5,5,5,0,-5, -10,0,5,5,5,5,0,-10, -10,0,0,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
    K: [20,30,10,0,0,10,30,20, 20,20,0,0,0,0,20,20, -10,-20,-20,-20,-20,-20,-20,-10, -20,-30,-30,-40,-40,-30,-30,-20, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30],
  };

  function ChessGame(opts) {
    opts = opts || {};
    this.board = new Array(64).fill(null);
    this.turn = "w";                    // side to move
    this.castling = { wK: true, wQ: true, bK: true, bQ: true }; // castling rights
    this.enPassant = -1;                // index of square that can be captured en passant, or -1
    this.halfmove = 0;                  // 50-move counter (plies since pawn move/capture)
    this.fullmove = 1;
    this.history = [];                  // applied moves (move objects)
    this._undoStack = [];               // matching undo records (for undo())
    this.allowCastling = opts.allowCastling !== false;
    this.allowEnPassant = opts.allowEnPassant !== false;
    this.reset();
  }

  ChessGame.prototype.reset = function () {
    const b = this.board; b.fill(null);
    const back = ["R", "N", "B", "Q", "K", "B", "N", "R"];
    for (let f = 0; f < 8; f++) {
      b[sq(f, 0)] = "w" + back[f];
      b[sq(f, 1)] = "wP";
      b[sq(f, 6)] = "bP";
      b[sq(f, 7)] = "b" + back[f];
    }
    this.turn = "w";
    this.castling = { wK: true, wQ: true, bK: true, bQ: true };
    this.enPassant = -1;
    this.halfmove = 0; this.fullmove = 1; this.history = []; this._undoStack = [];
    return this;
  };

  // Load a position from a compact array spec (used by tests):
  //   setPosition([{sq:"e1", p:"wK"}, ...], "w", {castling, enPassant})
  ChessGame.prototype.setPosition = function (pieces, turn, extra) {
    this.board.fill(null);
    (pieces || []).forEach((it) => {
      const s = typeof it.sq === "string" ? fromAlgebraic(it.sq) : it.sq;
      if (s >= 0) this.board[s] = it.p;
    });
    this.turn = turn || "w";
    extra = extra || {};
    this.castling = extra.castling || { wK: false, wQ: false, bK: false, bQ: false };
    this.enPassant = extra.enPassant != null ? (typeof extra.enPassant === "string" ? fromAlgebraic(extra.enPassant) : extra.enPassant) : -1;
    this.halfmove = 0; this.fullmove = 1; this.history = []; this._undoStack = [];
    return this;
  };

  ChessGame.prototype.get = function (s) { return this.board[s]; };
  ChessGame.prototype.kingSquare = function (side) {
    for (let s = 0; s < 64; s++) if (this.board[s] === side + "K") return s;
    return -1;
  };

  // ── attack test: is square `s` attacked by `bySide`? (ignores pins/turn) ─────
  ChessGame.prototype.isAttacked = function (s, bySide) {
    const b = this.board, f = fileOf(s), r = rankOf(s);
    // pawns: a white pawn on (f±1, r-1) attacks s; a black pawn on (f±1, r+1) attacks s
    const pr = bySide === "w" ? -1 : 1;
    for (const df of [-1, 1]) {
      const af = f + df, ar = r + pr;
      if (onBoard(af, ar) && b[sq(af, ar)] === bySide + "P") return true;
    }
    // knights
    for (const [df, dr] of KNIGHT_D) {
      const af = f + df, ar = r + dr;
      if (onBoard(af, ar) && b[sq(af, ar)] === bySide + "N") return true;
    }
    // king
    for (const [df, dr] of DIR_KING) {
      const af = f + df, ar = r + dr;
      if (onBoard(af, ar) && b[sq(af, ar)] === bySide + "K") return true;
    }
    // sliders: rook/queen orthogonally, bishop/queen diagonally
    for (const [df, dr] of DIR_ROOK) {
      let af = f + df, ar = r + dr;
      while (onBoard(af, ar)) {
        const p = b[sq(af, ar)];
        if (p) { if (sideOf(p) === bySide && (typeOf(p) === "R" || typeOf(p) === "Q")) return true; break; }
        af += df; ar += dr;
      }
    }
    for (const [df, dr] of DIR_BISHOP) {
      let af = f + df, ar = r + dr;
      while (onBoard(af, ar)) {
        const p = b[sq(af, ar)];
        if (p) { if (sideOf(p) === bySide && (typeOf(p) === "B" || typeOf(p) === "Q")) return true; break; }
        af += df; ar += dr;
      }
    }
    return false;
  };

  ChessGame.prototype.inCheck = function (side) {
    side = side || this.turn;
    const k = this.kingSquare(side);
    return k >= 0 ? this.isAttacked(k, opp(side)) : false;
  };

  // ── pseudo-legal move generation for a single piece (no self-check filter) ───
  ChessGame.prototype._pseudoMoves = function (s) {
    const b = this.board, p = b[s]; if (!p) return [];
    const side = sideOf(p), t = typeOf(p), f = fileOf(s), r = rankOf(s);
    const out = [];
    const add = (to, flags) => out.push(Object.assign({ from: s, to: to, piece: p }, flags || {}));

    if (t === "P") {
      const dir = side === "w" ? 1 : -1;           // white pawns move up (rank+)
      const startR = side === "w" ? 1 : 6;
      const promoR = side === "w" ? 7 : 0;
      // single push
      if (onBoard(f, r + dir) && !b[sq(f, r + dir)]) {
        const one = sq(f, r + dir);
        if (r + dir === promoR) add(one, { promotion: "Q", isPromo: true });
        else add(one, {});
        // two-step from start (both squares empty)
        if (r === startR && !b[sq(f, r + 2 * dir)]) add(sq(f, r + 2 * dir), { double: true });
      }
      // captures (incl. en passant)
      for (const df of [-1, 1]) {
        const cf = f + df, cr = r + dir;
        if (!onBoard(cf, cr)) continue;
        const to = sq(cf, cr), tp = b[to];
        if (tp && sideOf(tp) !== side) {
          if (cr === promoR) add(to, { promotion: "Q", isPromo: true, capture: true });
          else add(to, { capture: true });
        } else if (this.allowEnPassant && to === this.enPassant && !tp) {
          add(to, { capture: true, enPassant: true });
        }
      }
    } else if (t === "N") {
      for (const [df, dr] of KNIGHT_D) {
        const af = f + df, ar = r + dr;
        if (!onBoard(af, ar)) continue;
        const to = sq(af, ar), tp = b[to];
        if (!tp) add(to, {}); else if (sideOf(tp) !== side) add(to, { capture: true });
      }
    } else if (t === "K") {
      for (const [df, dr] of DIR_KING) {
        const af = f + df, ar = r + dr;
        if (!onBoard(af, ar)) continue;
        const to = sq(af, ar), tp = b[to];
        if (!tp) add(to, {}); else if (sideOf(tp) !== side) add(to, { capture: true });
      }
      // castling — pseudo-legal here; the legality filter verifies the king
      // doesn't pass through / land on an attacked square. Squares between must be
      // empty and rights intact, with the rook on its home square.
      if (this.allowCastling) {
        const homeR = side === "w" ? 0 : 7;
        if (r === homeR && f === 4 && !this.inCheck(side)) {
          if (this.castling[side + "K"] && !b[sq(5, homeR)] && !b[sq(6, homeR)] && b[sq(7, homeR)] === side + "R") {
            add(sq(6, homeR), { castle: "K" });
          }
          if (this.castling[side + "Q"] && !b[sq(1, homeR)] && !b[sq(2, homeR)] && !b[sq(3, homeR)] && b[sq(0, homeR)] === side + "R") {
            add(sq(2, homeR), { castle: "Q" });
          }
        }
      }
    } else {
      // sliding pieces
      const dirs = t === "R" ? DIR_ROOK : t === "B" ? DIR_BISHOP : DIR_KING;
      for (const [df, dr] of dirs) {
        let af = f + df, ar = r + dr;
        while (onBoard(af, ar)) {
          const to = sq(af, ar), tp = b[to];
          if (!tp) { add(to, {}); }
          else { if (sideOf(tp) !== side) add(to, { capture: true }); break; }
          af += df; ar += dr;
        }
      }
    }
    return out;
  };

  // Apply a move object to the board WITHOUT legality checks, returning an undo
  // record. Used internally by move() and by the legality filter / AI search.
  ChessGame.prototype._apply = function (m) {
    const b = this.board, side = sideOf(m.piece), t = typeOf(m.piece);
    const undo = {
      m, from: m.from, to: m.to,
      movedPiece: b[m.from], capturedPiece: b[m.to], capturedSquare: m.to,
      enPassant: this.enPassant, castling: Object.assign({}, this.castling),
      halfmove: this.halfmove, fullmove: this.fullmove, turn: this.turn,
      rookFrom: -1, rookTo: -1,
    };

    // en passant capture removes the pawn behind the destination
    if (m.enPassant) {
      const capSq = sq(fileOf(m.to), rankOf(m.to) + (side === "w" ? -1 : 1));
      undo.capturedPiece = b[capSq]; undo.capturedSquare = capSq;
      b[capSq] = null;
    }

    // move the piece (promote if flagged)
    b[m.to] = (m.promotion && m.isPromo) ? side + m.promotion : b[m.from];
    b[m.from] = null;

    // castling: also move the rook
    if (m.castle) {
      const homeR = rankOf(m.to);
      if (m.castle === "K") { undo.rookFrom = sq(7, homeR); undo.rookTo = sq(5, homeR); }
      else { undo.rookFrom = sq(0, homeR); undo.rookTo = sq(3, homeR); }
      b[undo.rookTo] = b[undo.rookFrom]; b[undo.rookFrom] = null;
    }

    // update castling rights
    if (t === "K") { this.castling[side + "K"] = false; this.castling[side + "Q"] = false; }
    if (t === "R") {
      const homeR = side === "w" ? 0 : 7;
      if (m.from === sq(0, homeR)) this.castling[side + "Q"] = false;
      if (m.from === sq(7, homeR)) this.castling[side + "K"] = false;
    }
    // a capture on a rook's home square also kills that castling right
    const oppSide = opp(side), oppHome = oppSide === "w" ? 0 : 7;
    if (undo.capturedPiece && typeOf(undo.capturedPiece) === "R") {
      if (undo.capturedSquare === sq(0, oppHome)) this.castling[oppSide + "Q"] = false;
      if (undo.capturedSquare === sq(7, oppHome)) this.castling[oppSide + "K"] = false;
    }

    // en passant target: set only on a double pawn push
    this.enPassant = m.double ? sq(fileOf(m.from), rankOf(m.from) + (side === "w" ? 1 : -1)) : -1;

    // clocks
    if (t === "P" || undo.capturedPiece) this.halfmove = 0; else this.halfmove++;
    if (side === "b") this.fullmove++;
    this.turn = oppSide;
    return undo;
  };

  ChessGame.prototype._undo = function (undo) {
    const b = this.board;
    b[undo.from] = undo.movedPiece;
    b[undo.to] = null;
    if (undo.capturedPiece) b[undo.capturedSquare] = undo.capturedPiece;
    if (undo.rookFrom >= 0) { b[undo.rookFrom] = b[undo.rookTo]; b[undo.rookTo] = null; }
    this.enPassant = undo.enPassant;
    this.castling = undo.castling;
    this.halfmove = undo.halfmove; this.fullmove = undo.fullmove; this.turn = undo.turn;
  };

  // legality filter: a pseudo-legal move is legal iff it doesn't leave OWN king
  // in check. Castling additionally requires the king not to pass through an
  // attacked transit square (start square safety already verified: not in check;
  // landing square safety is covered by the generic king-in-check test below).
  ChessGame.prototype._isLegal = function (m) {
    const side = sideOf(m.piece);
    if (m.castle) {
      const homeR = rankOf(m.from);
      const transit = m.castle === "K" ? sq(5, homeR) : sq(3, homeR);
      if (this.isAttacked(transit, opp(side))) return false;
    }
    const undo = this._apply(m);
    const bad = this.inCheck(side);
    this._undo(undo);
    return !bad;
  };

  // ── public move generation ───────────────────────────────────────────────────
  ChessGame.prototype.legalMovesDetailed = function (s) {
    if (typeof s === "string") s = fromAlgebraic(s);
    const p = this.board[s]; if (!p || sideOf(p) !== this.turn) return [];
    return this._pseudoMoves(s).filter((m) => this._isLegal(m));
  };
  // brief's `legalMoves(square)` -> array of destination square indices
  ChessGame.prototype.legalMoves = function (s) {
    return this.legalMovesDetailed(s).map((m) => m.to);
  };
  ChessGame.prototype.allLegalMoves = function (side) {
    side = side || this.turn;
    const saved = this.turn; this.turn = side;
    const out = [];
    for (let s = 0; s < 64; s++) {
      const p = this.board[s];
      if (p && sideOf(p) === side) {
        const ms = this._pseudoMoves(s).filter((m) => this._isLegal(m));
        for (const m of ms) out.push(m);
      }
    }
    this.turn = saved;
    return out;
  };

  // ── apply a move (by from/to indices or algebraic), with capture/check/mate ──
  ChessGame.prototype.move = function (from, to, optsOrPromo) {
    if (typeof from === "string") from = fromAlgebraic(from);
    if (typeof to === "string") to = fromAlgebraic(to);
    const promo = typeof optsOrPromo === "string" ? optsOrPromo : (optsOrPromo && optsOrPromo.promotion);
    const candidates = this.legalMovesDetailed(from);
    let m = candidates.find((c) => c.to === to && (!c.isPromo || !promo || c.promotion === promo));
    if (!m) m = candidates.find((c) => c.to === to); // any matching dest (default promo = Q)
    if (!m) return { ok: false, illegal: true };

    // capture identity must be read BEFORE applying (en passant target differs)
    const capturedPieceBefore = m.enPassant
      ? this.board[sq(fileOf(m.to), rankOf(m.to) + (sideOf(m.piece) === "w" ? -1 : 1))]
      : this.board[m.to];
    const mover = sideOf(m.piece);
    const san = this._san(m, capturedPieceBefore);
    const undo = this._apply(m);
    this.history.push(m); this._undoStack.push(undo);

    const result = {
      ok: true,
      from, to,
      piece: m.piece,
      san,
      captured: capturedPieceBefore || null,
      capturedType: capturedPieceBefore ? typeOf(capturedPieceBefore) : null,
      capturedSquare: m.enPassant ? sq(fileOf(m.to), rankOf(m.to) + (mover === "w" ? -1 : 1)) : (capturedPieceBefore ? m.to : -1),
      enPassant: !!m.enPassant,
      castle: m.castle || null,
      castleRook: m.castle ? { from: undo.rookFrom, to: undo.rookTo } : null,
      promotion: (m.promotion && m.isPromo) ? m.promotion : null,
      mover,
    };
    // status of the side now to move
    const st = this.status();
    result.check = st.inCheck;
    result.checkmate = st.checkmate;
    result.stalemate = st.stalemate;
    result.mate = st.checkmate;
    result.draw = st.draw;
    result.gameOver = st.gameOver;
    result.result = st.result;
    return result;
  };

  // minimal SAN (for logs/HUD; pawn captures show file, no full disambiguation)
  ChessGame.prototype._san = function (m, captured) {
    if (m.castle === "K") return "O-O";
    if (m.castle === "Q") return "O-O-O";
    const t = typeOf(m.piece);
    const dest = algebraic(m.to);
    let s;
    if (t === "P") s = (captured || m.enPassant) ? (FILES[fileOf(m.from)] + "x" + dest) : dest;
    else s = t + (captured ? "x" : "") + dest;
    if (m.promotion && m.isPromo) s += "=" + m.promotion;
    return s;
  };

  ChessGame.prototype.undo = function () {
    if (!this._undoStack.length) return false;
    this._undo(this._undoStack.pop());
    this.history.pop();
    return true;
  };

  // ── status: turn / check / checkmate / stalemate / draw ──────────────────────
  ChessGame.prototype.status = function () {
    const side = this.turn;
    const moves = this.allLegalMoves(side);
    const inCheck = this.inCheck(side);
    const checkmate = inCheck && moves.length === 0;
    const stalemate = !inCheck && moves.length === 0;
    const fiftyMove = this.halfmove >= 100;
    const insufficient = this._insufficientMaterial();
    const draw = stalemate || fiftyMove || insufficient;
    let result = null;
    if (checkmate) result = side === "w" ? "0-1" : "1-0";   // side to move is mated -> other side wins
    else if (draw) result = "1/2-1/2";
    return {
      turn: side, inCheck, checkmate, stalemate, draw,
      fiftyMove, insufficient, result,
      legalCount: moves.length, fullmove: this.fullmove,
      gameOver: checkmate || draw,
    };
  };

  ChessGame.prototype._insufficientMaterial = function () {
    const pieces = [];
    for (let s = 0; s < 64; s++) if (this.board[s]) pieces.push(this.board[s]);
    const nonKings = pieces.filter((p) => typeOf(p) !== "K");
    if (nonKings.length === 0) return true;                          // K vs K
    if (nonKings.length === 1 && (typeOf(nonKings[0]) === "B" || typeOf(nonKings[0]) === "N")) return true; // K+minor vs K
    return false;
  };

  // ── AI: negamax with alpha-beta, depth-limited (1-2 ply default) ─────────────
  // Picks + APPLIES the best move for the side to move. Returns the move result
  // (same shape as move()), or null if no legal move. Captures + PST guide it.
  // A small random tie-break among equal-best roots keeps games from repeating.
  ChessGame.prototype.aiMove = function (opts) {
    opts = opts || {};
    const depth = Math.max(1, opts.depth != null ? opts.depth : 2);
    const moves = this.allLegalMoves(this.turn);
    if (!moves.length) return null;
    moves.sort((a, b) => this._moveOrder(b) - this._moveOrder(a));
    let bestScore = -Infinity; const best = [];
    for (const m of moves) {
      const undo = this._apply(m);
      const score = -this._negamax(depth - 1, -Infinity, Infinity);
      this._undo(undo);
      if (score > bestScore + 0.0001) { bestScore = score; best.length = 0; best.push(m); }
      else if (Math.abs(score - bestScore) <= 0.0001) best.push(m);
    }
    const pick = best[(Math.random() * best.length) | 0] || moves[0];
    return this.move(pick.from, pick.to, pick.promotion);
  };

  ChessGame.prototype._negamax = function (depth, alpha, beta) {
    const side = this.turn;
    const moves = this.allLegalMoves(side);
    if (moves.length === 0) {
      if (this.inCheck(side)) return -100000 - depth;   // being mated is worst (deeper mates less bad)
      return 0;                                          // stalemate = neutral
    }
    if (depth <= 0) return this._evalFor(side);
    moves.sort((a, b) => this._moveOrder(b) - this._moveOrder(a));
    let best = -Infinity;
    for (const m of moves) {
      const undo = this._apply(m);
      const score = -this._negamax(depth - 1, -beta, -alpha);
      this._undo(undo);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break; // cutoff
    }
    return best;
  };

  ChessGame.prototype._moveOrder = function (m) {
    let v = 0;
    if (m.capture || m.enPassant) {
      const victim = m.enPassant ? "P" : (this.board[m.to] ? typeOf(this.board[m.to]) : "P");
      v += (VALUE[victim] || 100) - (VALUE[typeOf(m.piece)] || 100) / 10; // MVV-LVA-ish
    }
    if (m.isPromo) v += 800;
    if (m.castle) v += 30;
    return v;
  };

  // static eval from the perspective of `side` (positive = good for side)
  ChessGame.prototype._evalFor = function (side) {
    let score = 0;
    for (let s = 0; s < 64; s++) {
      const p = this.board[s]; if (!p) continue;
      const t = typeOf(p), mine = sideOf(p) === side;
      let v = VALUE[t] || 0;
      const pst = PST[t];
      if (pst) { const idx = sideOf(p) === "w" ? s : sq(fileOf(s), 7 - rankOf(s)); v += pst[idx]; }
      score += mine ? v : -v;
    }
    return score;
  };

  // expose helpers for the renderer / tests
  ChessGame.fileOf = fileOf; ChessGame.rankOf = rankOf; ChessGame.sq = sq;
  ChessGame.algebraic = algebraic; ChessGame.fromAlgebraic = fromAlgebraic;
  ChessGame.sideOf = sideOf; ChessGame.typeOf = typeOf;

  return { ChessGame, fileOf, rankOf, sq, algebraic, fromAlgebraic, sideOf, typeOf, VALUE };
});
