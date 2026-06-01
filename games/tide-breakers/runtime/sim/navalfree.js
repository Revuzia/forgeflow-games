/**
 * FFG runtime — sim/navalfree.js
 * Pure simulation for FREE-MOVEMENT, turn-based naval skirmish ("Tide Breakers").
 * NO grid: ships live in continuous open water (x,y in world units, heading in
 * radians). Each turn a side acts with one or more ships; a ship can DRIVE
 * (translate along/around its heading within a movement budget + turn within a
 * turn-rate) and FIRE its gun (range + firing arc + line-of-sight). Enemies are
 * always VISIBLE (no fog). A ship sinks at hp<=0; a side wins when the other has
 * no ships left. Deterministic with a seeded rng so the signature gate can
 * headlessly assert the defining mechanics.
 *
 * NO rendering here — the 3D cinematic lives in ffg_navalfree3d.js. This is the
 * single source of truth for rules; the renderer only animates what the sim
 * resolves.
 *
 * Dual export: Node require() and browser window.FFG.sim.NavalFree.
 */
(function (root) {
  "use strict";

  // Deterministic PRNG (same family iron-tide uses) so a seed reproduces a match.
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── geometry helpers ───────────────────────────────────────────────────────
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function dist(ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return Math.sqrt(dx * dx + dy * dy); }
  // Smallest signed angle (radians) from a to b, in (-PI, PI].
  function angDelta(a, b) {
    var d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d <= -Math.PI) d += Math.PI * 2;
    return d;
  }
  function norm(a) {
    a = a % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return a;
  }

  /**
   * config: {
   *   width, height,                       // arena bounds (world units)
   *   seed | rng,
   *   ships: [ { id, side, x, y, heading, hp, speed, turnRate, gun:{range,arc,dmg} } ],
   *   firstSide,                           // which side moves first (default "player")
   *   actionsPerTurn,                      // actions each ship gets per turn (default 2)
   *   onEvent,
   * }
   *
   * Action economy (per ship, per turn): a ship gets `actionsLeft` actions. A
   * MOVE consumes one action; a FIRE consumes one action; a pure ROTATE consumes
   * one action. With the default of 2, a ship can move-then-fire, fire-then-move,
   * double-move, etc. Heading change DURING a move is free (it's part of driving,
   * capped by turnRate). A side's turn ends when endTurn() is called (the renderer
   * drives this); the sim then refreshes the OTHER side's ships' actions and flips
   * `turn`.
   */
  function NavalFree(config) {
    config = config || {};
    this.width = config.width || 220;
    this.height = config.height || 220;
    this.rng = config.rng || mulberry32(typeof config.seed === "number" ? config.seed : 1337);
    this.actionsPerTurn = config.actionsPerTurn != null ? config.actionsPerTurn : 2;
    this.onEvent = config.onEvent || function () {};
    this.ships = [];
    var spawn = config.ships || NavalFree.defaultFleet(this.width, this.height);
    for (var i = 0; i < spawn.length; i++) this._addShip(spawn[i]);
    this.turn = config.firstSide || "player";
    this.turnNumber = 1;
    this.ended = false;
    this.winner = null;
    this.log = [];
    this._refreshActions(this.turn);
  }

  // A FLEET OF 5 per side, facing off across the arena. STRONGER ships shoot
  // FURTHER (range tracks strength); weaker ships are faster + turn quicker.
  // (range: battleship 140 → gunboat 60.) Used when no explicit fleet is provided.
  NavalFree.defaultFleet = function (w, h) {
    function gun(range, arc, dmg) { return { range: range, arc: arc * Math.PI / 180, dmg: dmg }; }
    var CLASSES = [
      { k: "battleship", hp: 150, speed: 22, turnRate: 50,  g: gun(140, 58, 34) },
      { k: "cruiser",    hp: 110, speed: 30, turnRate: 68,  g: gun(112, 68, 26) },
      { k: "destroyer",  hp: 85,  speed: 40, turnRate: 88,  g: gun(90,  80, 20) },
      { k: "frigate",    hp: 68,  speed: 48, turnRate: 104, g: gun(74,  86, 16) },
      { k: "gunboat",    hp: 48,  speed: 56, turnRate: 120, g: gun(60,  96, 12) },
    ];
    var xs = [0.16, 0.33, 0.5, 0.67, 0.84], ships = [];
    for (var i = 0; i < CLASSES.length; i++) {
      var c = CLASSES[i];
      // fresh gun object per ship (difficulty tweaks mutate s.gun — no shared refs)
      ships.push({ id: "P-" + c.k, side: "player", x: w * xs[i], y: h - 40, heading: -Math.PI / 2, hp: c.hp, speed: c.speed, turnRate: c.turnRate, gun: { range: c.g.range, arc: c.g.arc, dmg: c.g.dmg } });
      ships.push({ id: "E-" + c.k, side: "enemy",  x: w * xs[CLASSES.length - 1 - i], y: 40, heading: Math.PI / 2, hp: c.hp, speed: c.speed, turnRate: c.turnRate, gun: { range: c.g.range, arc: c.g.arc, dmg: c.g.dmg } });
    }
    return ships;
  };

  NavalFree.prototype._addShip = function (s) {
    var gun = s.gun || { range: 90, arc: 80 * Math.PI / 180, dmg: 22 };
    var ship = {
      id: s.id,
      side: s.side,
      x: s.x, y: s.y,
      heading: s.heading != null ? s.heading : 0,
      hp: s.hp != null ? s.hp : 100,
      maxHp: s.maxHp != null ? s.maxHp : (s.hp != null ? s.hp : 100),
      speed: s.speed != null ? s.speed : 30,        // movement budget (units per move action)
      turnRate: (s.turnRate != null ? s.turnRate : 80) * Math.PI / 180, // max radians turned per move/rotate action
      gun: {
        range: gun.range != null ? gun.range : 90,
        arc: gun.arc != null ? gun.arc : (80 * Math.PI / 180),  // total cone width in radians
        dmg: gun.dmg != null ? gun.dmg : 22,
      },
      radius: s.radius != null ? s.radius : 6,        // hull radius (collision + LOS blocker)
      actionsLeft: 0,
      sunk: false,
    };
    this.ships.push(ship);
    return ship;
  };

  // ── queries ─────────────────────────────────────────────────────────────────
  NavalFree.prototype.shipById = function (id) {
    for (var i = 0; i < this.ships.length; i++) if (this.ships[i].id === id) return this.ships[i];
    return null;
  };
  NavalFree.prototype.shipsOf = function (side) { return this.ships.filter(function (s) { return s.side === side && !s.sunk; }); };
  NavalFree.prototype.alive = function (side) { return this.shipsOf(side).length; };
  NavalFree.prototype.enemiesOf = function (side) { return this.ships.filter(function (s) { return s.side !== side && !s.sunk; }); };

  // public snapshot (renderer/AI read this; never mutate ship state directly)
  NavalFree.prototype.state = function () {
    return {
      turn: this.turn, turnNumber: this.turnNumber, ended: this.ended, winner: this.winner,
      width: this.width, height: this.height,
      ships: this.ships.map(function (s) {
        return {
          id: s.id, side: s.side, x: s.x, y: s.y, heading: s.heading, hp: s.hp, maxHp: s.maxHp,
          speed: s.speed, turnRate: s.turnRate, gun: { range: s.gun.range, arc: s.gun.arc, dmg: s.gun.dmg },
          radius: s.radius, actionsLeft: s.actionsLeft, sunk: s.sunk,
        };
      }),
    };
  };

  NavalFree.prototype._refreshActions = function (side) {
    for (var i = 0; i < this.ships.length; i++) {
      var s = this.ships[i];
      s.actionsLeft = (s.side === side && !s.sunk) ? this.actionsPerTurn : 0;
    }
  };

  // ── line of sight ─────────────────────────────────────────────────────────────
  // A shot is blocked if ANOTHER ship's hull circle straddles the segment from
  // shooter to target (closest point on the segment is within that ship's radius).
  // The target itself and the shooter never block. Friendly + enemy hulls block.
  NavalFree.prototype._losClear = function (shooter, tx, ty, ignoreId) {
    var ax = shooter.x, ay = shooter.y;
    var dx = tx - ax, dy = ty - ay;
    var segLen2 = dx * dx + dy * dy;
    if (segLen2 < 1e-6) return true;
    for (var i = 0; i < this.ships.length; i++) {
      var o = this.ships[i];
      if (o.sunk) continue;
      if (o.id === shooter.id || o.id === ignoreId) continue;
      // project o onto the segment, clamped to [0,1]
      var t = ((o.x - ax) * dx + (o.y - ay) * dy) / segLen2;
      t = clamp(t, 0, 1);
      var px = ax + t * dx, py = ay + t * dy;
      var d = dist(px, py, o.x, o.y);
      if (d < o.radius) return false; // hull straddles the line of fire
    }
    return true;
  };

  // Is target point within shooter's gun range AND firing arc AND has LOS?
  // Returns { ok, reason, range, bearing } so callers can show WHY a shot fails.
  NavalFree.prototype.canFireAt = function (shooterId, tx, ty, ignoreLosId) {
    var s = this.shipById(shooterId);
    if (!s || s.sunk) return { ok: false, reason: "no-ship" };
    var r = dist(s.x, s.y, tx, ty);
    if (r > s.gun.range) return { ok: false, reason: "range", range: r };
    var bearingToTarget = Math.atan2(ty - s.y, tx - s.x);
    var off = Math.abs(angDelta(s.heading, bearingToTarget));
    if (off > s.gun.arc / 2) return { ok: false, reason: "arc", range: r, off: off };
    // The ship sitting AT the aim point must never block the shot to itself —
    // auto-ignore it for LOS in addition to any caller-supplied ignore, so callers
    // don't have to know to pass the target id.
    var autoIgnore = ignoreLosId;
    if (!autoIgnore) {
      for (var i = 0; i < this.ships.length; i++) {
        var o = this.ships[i];
        if (o.sunk || o.id === s.id) continue;
        if (dist(o.x, o.y, tx, ty) <= o.radius) { autoIgnore = o.id; break; }
      }
    }
    if (!this._losClear(s, tx, ty, autoIgnore)) return { ok: false, reason: "los", range: r };
    return { ok: true, range: r, bearing: bearingToTarget };
  };

  // ── MOVE ────────────────────────────────────────────────────────────────────
  // Move a ship toward a destination point, capped by its speed budget, and turn
  // its heading toward the travel direction (capped by turnRate). Costs 1 action.
  // Returns { ok, reason, x, y, heading, moved }. Stays in-bounds; stops short of
  // colliding with another hull (won't overlap). dx/dy form also accepted.
  NavalFree.prototype.moveShip = function (id, arg1, arg2) {
    var s = this.shipById(id);
    if (!s || s.sunk) return { ok: false, reason: "no-ship" };
    if (this.turn !== s.side) return { ok: false, reason: "not-your-turn" };
    if (s.actionsLeft <= 0) return { ok: false, reason: "no-actions" };

    var destX, destY;
    if (arg1 && typeof arg1 === "object") { destX = arg1.x; destY = arg1.y; }       // moveShip(id, {x,y})
    else { destX = s.x + arg1; destY = s.y + arg2; }                                 // moveShip(id, dx, dy)

    var dx = destX - s.x, dy = destY - s.y;
    var want = Math.sqrt(dx * dx + dy * dy);
    var travel = Math.min(want, s.speed);                 // cap to budget
    var ux = want > 1e-6 ? dx / want : Math.cos(s.heading);
    var uy = want > 1e-6 ? dy / want : Math.sin(s.heading);

    // Turn the heading toward the travel direction, capped by turnRate.
    if (want > 1e-6) {
      var desired = Math.atan2(uy, ux);
      var dHead = angDelta(s.heading, desired);
      var applied = clamp(dHead, -s.turnRate, s.turnRate);
      s.heading = norm(s.heading + applied);
    }

    // Candidate landing point, clamped to arena bounds (keep the hull inside).
    var nx = clamp(s.x + ux * travel, s.radius, this.width - s.radius);
    var ny = clamp(s.y + uy * travel, s.radius, this.height - s.radius);

    // Collision: don't overlap another hull — back off so circles just touch.
    for (var i = 0; i < this.ships.length; i++) {
      var o = this.ships[i];
      if (o.sunk || o.id === s.id) continue;
      var dd = dist(nx, ny, o.x, o.y);
      var minD = s.radius + o.radius;
      if (dd < minD) {
        // pull the landing point back along travel direction to the contact ring
        var bx = o.x - ux * minD, by = o.y - uy * minD;
        nx = bx; ny = by;
      }
    }

    var moved = dist(s.x, s.y, nx, ny);
    s.x = nx; s.y = ny;
    s.actionsLeft--;
    this.log.push(s.id + " move -> (" + nx.toFixed(1) + "," + ny.toFixed(1) + ") h=" + (s.heading * 180 / Math.PI).toFixed(0));
    var out = { ok: true, x: s.x, y: s.y, heading: s.heading, moved: moved, actionsLeft: s.actionsLeft };
    this.onEvent("move", { id: s.id, x: s.x, y: s.y, heading: s.heading, moved: moved });
    return out;
  };

  // Pure rotation (no translation). Costs 1 action. dHeading in radians, capped
  // by turnRate. Returns { ok, heading }.
  NavalFree.prototype.rotateShip = function (id, dHeading) {
    var s = this.shipById(id);
    if (!s || s.sunk) return { ok: false, reason: "no-ship" };
    if (this.turn !== s.side) return { ok: false, reason: "not-your-turn" };
    if (s.actionsLeft <= 0) return { ok: false, reason: "no-actions" };
    var applied = clamp(dHeading, -s.turnRate, s.turnRate);
    s.heading = norm(s.heading + applied);
    s.actionsLeft--;
    this.onEvent("rotate", { id: s.id, heading: s.heading });
    return { ok: true, heading: s.heading, actionsLeft: s.actionsLeft };
  };

  // ── FIRE ──────────────────────────────────────────────────────────────────────
  // Fire from `shooterId` at either a target ship id (string) or a point {x,y}/
  // (x,y). Resolves range + arc + LOS; on a clear shot, applies damage to the
  // ship at/under the impact (the named target, or the nearest enemy within a
  // small splash radius of an aimed point). Costs 1 action.
  // Returns { result:'hit'|'miss'|'sink'|'invalid', reason?, x,y, target?, dmg?, win? }.
  NavalFree.prototype.fireAt = function (shooterId, target, maybeY) {
    if (this.ended) return { result: "invalid", reason: "ended" };
    var s = this.shipById(shooterId);
    if (!s || s.sunk) return { result: "invalid", reason: "no-ship" };
    if (this.turn !== s.side) return { result: "invalid", reason: "not-your-turn" };
    if (s.actionsLeft <= 0) return { result: "invalid", reason: "no-actions" };

    var tx, ty, namedTarget = null;
    if (typeof target === "string") {
      namedTarget = this.shipById(target);
      if (!namedTarget || namedTarget.sunk) return { result: "invalid", reason: "no-target" };
      tx = namedTarget.x; ty = namedTarget.y;
    } else if (target && typeof target === "object") {
      tx = target.x; ty = target.y;
    } else {
      tx = target; ty = maybeY;
    }

    var chk = this.canFireAt(shooterId, tx, ty, namedTarget ? namedTarget.id : null);
    if (!chk.ok) {
      // A blocked/out-of-arc/out-of-range shot still BURNS the action (you fired).
      s.actionsLeft--;
      this.log.push(s.id + " fire FAILED (" + chk.reason + ")");
      var inv = { result: "invalid", reason: chk.reason, x: tx, y: ty, by: s.id, range: chk.range, actionsLeft: s.actionsLeft };
      this.onEvent("fire", inv);
      return inv;
    }

    s.actionsLeft--;

    // Resolve the hit. A named target that passed canFireAt is hit. An aimed point
    // hits the nearest enemy hull whose circle the impact lands in (splash).
    var victim = namedTarget;
    if (!victim) {
      var best = null, bestD = Infinity;
      for (var i = 0; i < this.ships.length; i++) {
        var o = this.ships[i];
        if (o.sunk || o.side === s.side) continue;
        var d = dist(tx, ty, o.x, o.y);
        if (d <= o.radius + 4 && d < bestD) { bestD = d; best = o; }   // 4u splash forgiveness
      }
      victim = best;
    }

    if (!victim) {
      this.log.push(s.id + " miss (" + tx.toFixed(1) + "," + ty.toFixed(1) + ")");
      var miss = { result: "miss", x: tx, y: ty, by: s.id, actionsLeft: s.actionsLeft };
      this.onEvent("fire", miss);
      return miss;
    }

    // Damage. Optional gentle range falloff: full damage to 60% of range, then
    // tapering to 55% at max range — rewards closing distance without being swingy.
    var rangeFrac = chk.range / s.gun.range;
    var falloff = rangeFrac <= 0.6 ? 1 : (1 - 0.45 * ((rangeFrac - 0.6) / 0.4));
    var dmg = Math.max(1, Math.round(s.gun.dmg * falloff));
    victim.hp -= dmg;

    var out = { result: "hit", x: victim.x, y: victim.y, by: s.id, target: victim.id, dmg: dmg, range: chk.range, actionsLeft: s.actionsLeft };
    if (victim.hp <= 0) {
      victim.hp = 0; victim.sunk = true;
      out.result = "sink";
      this.log.push(s.id + " SANK " + victim.id);
    } else {
      this.log.push(s.id + " hit " + victim.id + " for " + dmg + " (hp " + victim.hp + ")");
    }

    // Win check.
    var foeSide = s.side === "player" ? "enemy" : "player";
    if (this.alive(foeSide) === 0) {
      this.ended = true; this.winner = s.side; out.win = true;
      this.onEvent("fire", out); this.onEvent("end", { winner: s.side });
      return out;
    }
    this.onEvent("fire", out);
    return out;
  };

  // ── turn flow ───────────────────────────────────────────────────────────────
  // End the active side's turn; refresh the other side's actions and flip `turn`.
  NavalFree.prototype.endTurn = function () {
    if (this.ended) return { ended: true, winner: this.winner };
    var next = this.turn === "player" ? "enemy" : "player";
    this.turn = next;
    if (next === "player") this.turnNumber++;
    this._refreshActions(next);
    this.onEvent("turn", { side: next, turnNumber: this.turnNumber });
    return { turn: this.turn, turnNumber: this.turnNumber };
  };

  // True if the active side has no ship with actions left (renderer can offer/auto
  // "End Turn").
  NavalFree.prototype.sideExhausted = function (side) {
    side = side || this.turn;
    var list = this.shipsOf(side);
    for (var i = 0; i < list.length; i++) if (list[i].actionsLeft > 0) return false;
    return true;
  };

  // ── basic AI ────────────────────────────────────────────────────────────────
  // A simple but real opponent: for each of its ships, pick the nearest living
  // enemy; if a shot is already legal, fire; otherwise steer toward a firing
  // solution (close distance + turn to bear) and fire if it opens up. Spends all
  // actions, then the caller (or aiTakeTurn) ends the turn. Returns a list of the
  // actions taken (so the renderer can animate them in sequence).
  NavalFree.prototype.aiPlan = function () {
    var acts = [];
    if (this.ended || this.turn !== "enemy") return acts;
    var mine = this.shipsOf("enemy");
    for (var i = 0; i < mine.length; i++) {
      var s = mine[i];
      var guard = 0;
      while (s.actionsLeft > 0 && !this.ended && guard++ < 8) {
        var foe = this._nearestEnemy(s);
        if (!foe) break;
        var chk = this.canFireAt(s.id, foe.x, foe.y, foe.id);
        if (chk.ok) {
          var r = this.fireAt(s.id, foe.id);
          acts.push({ kind: "fire", id: s.id, target: foe.id, result: r });
          continue;
        }
        // Not a clean shot — maneuver. Aim a point that closes range and lines us
        // up: a spot just inside our gun range along the bearing to the foe.
        var bearing = Math.atan2(foe.y - s.y, foe.x - s.x);
        var standoff = s.gun.range * 0.7;
        var destX = foe.x - Math.cos(bearing) * standoff;
        var destY = foe.y - Math.sin(bearing) * standoff;
        var mv = this.moveShip(s.id, { x: destX, y: destY });
        acts.push({ kind: "move", id: s.id, result: mv });
        if (!mv.ok) break;
      }
    }
    return acts;
  };

  // Convenience: plan + end turn in one call (headless tests / simple drivers).
  NavalFree.prototype.aiTakeTurn = function () {
    var acts = this.aiPlan();
    if (!this.ended) this.endTurn();
    return acts;
  };

  NavalFree.prototype._nearestEnemy = function (s) {
    var foes = this.enemiesOf(s.side), best = null, bestD = Infinity;
    for (var i = 0; i < foes.length; i++) {
      var d = dist(s.x, s.y, foes[i].x, foes[i].y);
      if (d < bestD) { bestD = d; best = foes[i]; }
    }
    return best;
  };

  // exports ----------------------------------------------------------------------
  var api = { NavalFree: NavalFree, mulberry32: mulberry32 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FFG = root.FFG || {};
  root.FFG.sim = root.FFG.sim || {};
  root.FFG.sim.NavalFree = NavalFree;
})(typeof window !== "undefined" ? window : globalThis);
