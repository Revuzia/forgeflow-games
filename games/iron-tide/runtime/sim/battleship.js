/**
 * FFG runtime — sim/battleship.js
 * Pure simulation for salvo naval combat (Battleship-type). NO rendering — the
 * 3D cinematic lives in ffg_battleship_3d.js. Deterministic with a seeded rng so
 * the signature gate can headlessly assert the defining mechanics.
 *
 * Two boards (player + AI). Each fires one shot per turn at the opponent's board;
 * hit/miss/sink resolved; a side loses when its whole fleet is sunk.
 *
 * The AI is a real HUNT/TARGET solver (the signature-mechanic depth): it fires on
 * a parity grid while hunting, and once it lands a hit it works the adjacent cells
 * and follows the ship's axis until the ship sinks — i.e. it actually plays well,
 * not randomly.
 *
 * Dual export: Node require() and browser window.FFG.sim.Battleship.
 */
(function (root) {
  "use strict";

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Cell states on a shot-tracking board.
  var UNKNOWN = 0, MISS = 1, HIT = 2;

  function makeBoard(size) {
    // ships: [{id,name,len,cells:[{x,y}],hits:0,sunk:false,horizontal}]
    // grid[y][x] = shipId or -1
    var grid = [];
    for (var y = 0; y < size; y++) { grid.push(new Array(size).fill(-1)); }
    return { size: size, grid: grid, ships: [], shots: shotsGrid(size) };
  }
  function shotsGrid(size) {
    var g = []; for (var y = 0; y < size; y++) g.push(new Array(size).fill(UNKNOWN)); return g;
  }

  class Battleship {
    /**
     * config: { size, fleet:[{id,name,len}], rng|seed,
     *           player_placements? , enemy_placements? }  // optional fixed placements
     */
    constructor(config) {
      this.size = config.size || 10;
      this.fleet = config.fleet || [
        { id: "carrier", name: "Carrier", len: 5 },
        { id: "battleship", name: "Battleship", len: 4 },
        { id: "cruiser", name: "Cruiser", len: 3 },
        { id: "submarine", name: "Submarine", len: 3 },
        { id: "destroyer", name: "Destroyer", len: 2 },
      ];
      this.rng = config.rng || mulberry32(typeof config.seed === "number" ? config.seed : 1234);
      this.player = makeBoard(this.size);
      this.enemy = makeBoard(this.size);
      this._place(this.player, config.player_placements);
      this._place(this.enemy, config.enemy_placements);
      this.turn = "player";
      this.turnNumber = 1;
      this.ended = false;
      this.winner = null;
      this.log = [];
      this.onEvent = config.onEvent || function () {};
      // Difficulty tunes the AI: easy = no parity + sometimes abandons a wounded
      // ship (gives the player breathing room); normal = parity hunt + target;
      // hard = parity + relentless target work. Default normal.
      this.difficulty = config.difficulty || "normal";
      // AI hunt/target memory (the AI fires at the PLAYER board)
      this._ai = { mode: "hunt", queue: [], hits: [], parity: 0 };
    }

    _place(board, placements) {
      if (placements && placements.length) {
        for (var i = 0; i < placements.length; i++) {
          var p = placements[i];
          var spec = this.fleet.find((f) => f.id === p.id) || this.fleet[i];
          this._placeShip(board, spec, p.x, p.y, p.horizontal !== false);
        }
        return;
      }
      // random legal placement
      for (var f = 0; f < this.fleet.length; f++) {
        var spec2 = this.fleet[f];
        var placed = false, guard = 0;
        while (!placed && guard++ < 500) {
          var horiz = this.rng() < 0.5;
          var x = Math.floor(this.rng() * this.size);
          var y = Math.floor(this.rng() * this.size);
          placed = this._placeShip(board, spec2, x, y, horiz);
        }
      }
    }

    // Interactive placement support (player positions their own fleet).
    resetPlayerBoard() { this.player = makeBoard(this.size); }
    placePlayerShip(specId, x, y, horizontal) {
      var spec = null;
      for (var i = 0; i < this.fleet.length; i++) if (this.fleet[i].id === specId) spec = this.fleet[i];
      if (!spec) return false;
      return this._placeShip(this.player, spec, x, y, horizontal);
    }

    _placeShip(board, spec, x, y, horizontal) {
      var cells = [];
      for (var i = 0; i < spec.len; i++) {
        var cx = horizontal ? x + i : x;
        var cy = horizontal ? y : y + i;
        if (cx < 0 || cy < 0 || cx >= this.size || cy >= this.size) return false;
        if (board.grid[cy][cx] !== -1) return false;
        cells.push({ x: cx, y: cy });
      }
      var ship = { id: spec.id, name: spec.name, len: spec.len, cells: cells, hits: 0, sunk: false, horizontal: horizontal };
      board.ships.push(ship);
      for (var c = 0; c < cells.length; c++) board.grid[cells[c].y][cells[c].x] = board.ships.length - 1;
      return true;
    }

    // ── Queries ──────────────────────────────────────────────────────────────
    boardOf(side) { return side === "player" ? this.player : this.enemy; }
    fleetStatus(side) {
      var b = this.boardOf(side);
      return b.ships.map((s) => ({ id: s.id, name: s.name, len: s.len, hits: s.hits, sunk: s.sunk }));
    }
    alive(side) { return this.boardOf(side).ships.filter((s) => !s.sunk).length; }

    // ── Fire ───────────────────────────────────────────────────────────────────
    /** A side fires at the opponent. Returns {result:'miss'|'hit'|'sink'|'invalid', ship?, x,y, win?} */
    fire(bySide, x, y) {
      if (this.ended) return { result: "invalid", reason: "ended" };
      var target = bySide === "player" ? this.enemy : this.player;
      if (x < 0 || y < 0 || x >= this.size || y >= this.size) return { result: "invalid", reason: "oob" };
      if (target.shots[y][x] !== UNKNOWN) return { result: "invalid", reason: "repeat" };
      var shipIdx = target.grid[y][x];
      if (shipIdx === -1) {
        target.shots[y][x] = MISS;
        this.log.push(bySide + " miss (" + x + "," + y + ")");
        var rMiss = { result: "miss", x: x, y: y, by: bySide };
        this.onEvent("shot", rMiss);
        return rMiss;
      }
      target.shots[y][x] = HIT;
      var ship = target.ships[shipIdx];
      ship.hits++;
      var out = { result: "hit", x: x, y: y, by: bySide, ship: ship.id };
      if (ship.hits >= ship.len) {
        ship.sunk = true;
        out.result = "sink";
        out.shipCells = ship.cells.slice();
        this.log.push(bySide + " SANK " + ship.name);
      } else {
        this.log.push(bySide + " hit " + ship.name + " (" + x + "," + y + ")");
      }
      if (this.alive(bySide === "player" ? "enemy" : "player") === 0) {
        this.ended = true; this.winner = bySide; out.win = true;
        this.onEvent("shot", out); this.onEvent("end", { winner: bySide });
        return out;
      }
      this.onEvent("shot", out);
      return out;
    }

    /** Player fires, then (if game continues) AI takes its turn. Returns {player, ai?}. */
    playerFire(x, y) {
      var pr = this.fire("player", x, y);
      if (pr.result === "invalid") return { player: pr };
      var resp = { player: pr };
      if (!this.ended) {
        this.turn = "enemy";
        resp.ai = this._aiTurn();
        if (!this.ended) { this.turn = "player"; this.turnNumber++; }
      }
      return resp;
    }

    /** Player fires at SEVERAL cells (an ability — salvo/barrage), then the AI
     * takes ONE turn. Returns {player:[results], ai?, multi:true}. */
    playerMultiFire(cells) {
      var results = [];
      for (var i = 0; i < cells.length; i++) {
        if (this.ended) break;
        var r = this.fire("player", cells[i].x, cells[i].y);
        if (r.result !== "invalid") results.push(r);
      }
      var resp = { player: results, multi: true };
      if (!this.ended && results.length) {
        this.turn = "enemy";
        resp.ai = this._aiTurn();
        if (!this.ended) { this.turn = "player"; this.turnNumber++; }
      }
      return resp;
    }

    // ── AI: hunt/target ──────────────────────────────────────────────────────
    _aiPick() {
      var b = this.player; // AI shoots the player's board
      var size = this.size;
      // TARGET mode: work the queue of promising cells around known hits
      while (this._ai.queue.length) {
        var c = this._ai.queue.shift();
        if (c.x >= 0 && c.y >= 0 && c.x < size && c.y < size && b.shots[c.y][c.x] === UNKNOWN) return c;
      }
      this._ai.mode = "hunt";
      // HARD: probability-density hunt — fire where the smallest remaining ship
      // can fit the most ways (the strong Battleship-AI technique). Uses only
      // fair info (shot grid + fleet lengths + which ships were announced sunk).
      if (this.difficulty === "hard") {
        var dp = this._densityPick(b, size);
        if (dp) return dp;
      }
      // HUNT mode: parity grid (can't hide a length>=2 ship from parity) on
      // normal; easy fires fully at random (much less efficient).
      var useParity = this.difficulty !== "easy";
      var candidates = [];
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) {
          if (b.shots[y][x] !== UNKNOWN) continue;
          if (!useParity || ((x + y) % 2) === this._ai.parity) candidates.push({ x: x, y: y });
        }
      }
      if (!candidates.length) {
        for (var yy = 0; yy < size; yy++) for (var xx = 0; xx < size; xx++) if (b.shots[yy][xx] === UNKNOWN) candidates.push({ x: xx, y: yy });
      }
      return candidates[Math.floor(this.rng() * candidates.length)];
    }

    // HARD hunt: pick the unknown cell where the smallest still-floating ship
    // could be placed the most ways (probability density). Fair info only.
    _densityPick(b, size) {
      var minLen = 99;
      for (var i = 0; i < this.player.ships.length; i++) if (!this.player.ships[i].sunk) minLen = Math.min(minLen, this.player.ships[i].len);
      if (minLen === 99) minLen = 2;
      var best = null, bestv = -1;
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) {
          if (b.shots[y][x] !== UNKNOWN) continue;
          var count = 0, off, k, ok;
          for (off = 0; off < minLen; off++) { // horizontal placements covering (x,y)
            var sx = x - off; if (sx < 0 || sx + minLen > size) continue;
            ok = true; for (k = 0; k < minLen; k++) if (b.shots[y][sx + k] === MISS) { ok = false; break; }
            if (ok) count++;
          }
          for (off = 0; off < minLen; off++) { // vertical
            var sy = y - off; if (sy < 0 || sy + minLen > size) continue;
            ok = true; for (k = 0; k < minLen; k++) if (b.shots[sy + k][x] === MISS) { ok = false; break; }
            if (ok) count++;
          }
          if (count > bestv) { bestv = count; best = { x: x, y: y }; }
        }
      }
      return best;
    }

    _aiTurn() {
      // Easy AI sometimes loses the scent of a wounded ship (forgets its
      // target queue), so the player isn't relentlessly finished off.
      if (this.difficulty === "easy" && this._ai.mode === "target" && this.rng() < 0.35) {
        this._ai.queue = []; this._ai.hits = []; this._ai.mode = "hunt";
      }
      var pick = this._aiPick();
      if (!pick) return null;
      var r = this.fire("enemy", pick.x, pick.y);
      if (r.result === "hit") {
        this._ai.mode = "target";
        this._ai.hits.push({ x: pick.x, y: pick.y });
        // enqueue orthogonal neighbors; if we have 2+ collinear hits, prefer the axis
        var neigh = [{ x: pick.x + 1, y: pick.y }, { x: pick.x - 1, y: pick.y }, { x: pick.x, y: pick.y + 1 }, { x: pick.x, y: pick.y - 1 }];
        var axisFirst = this._axisCells(pick);
        this._ai.queue = axisFirst.concat(neigh).concat(this._ai.queue);
      } else if (r.result === "sink") {
        // ship dead — reset target memory, back to hunt
        this._ai.mode = "hunt"; this._ai.queue = []; this._ai.hits = [];
      }
      return r;
    }

    // If two known hits share a row/col, extend along that axis first.
    _axisCells(latest) {
      var hits = this._ai.hits;
      var out = [];
      for (var i = 0; i < hits.length; i++) {
        var h = hits[i];
        if (h.x === latest.x && h.y !== latest.y) {
          var ys = [latest.y + 1, latest.y - 1, h.y + 1, h.y - 1];
          for (var a = 0; a < ys.length; a++) out.push({ x: latest.x, y: ys[a] });
        } else if (h.y === latest.y && h.x !== latest.x) {
          var xs = [latest.x + 1, latest.x - 1, h.x + 1, h.x - 1];
          for (var b2 = 0; b2 < xs.length; b2++) out.push({ x: xs[b2], y: latest.y });
        }
      }
      return out;
    }
  }

  var api = { Battleship: Battleship, mulberry32: mulberry32, UNKNOWN: UNKNOWN, MISS: MISS, HIT: HIT };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FFG = root.FFG || {};
  root.FFG.sim = root.FFG.sim || {};
  root.FFG.sim.Battleship = Battleship;
})(typeof window !== "undefined" ? window : globalThis);
