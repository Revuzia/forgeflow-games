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

  // ── D&D-style combat tuning (all inspectable / easy to retune) ───────────────
  // TO-HIT: roll a d20 vs a target number. The number rises with firing RANGE and
  // the target's EVASION + DEFEND stance; a nat 1 always misses, a nat 20 always
  // hits AND crits. Point-blank at an undefended battleship needs 4+ (~85%).
  var TOHIT_BASE   = 3;    // floor target number (point-blank, no evasion -> ~90% hit)
  var TOHIT_RANGE  = 6;    // spread across the range band (0 at muzzle -> +6 at max range)
  var TOHIT_DEFEND = 4;    // a DEFENDing target is +4 harder to hit (on top of ½ damage)
  var TOHIT_MIN = 2, TOHIT_MAX = 19;          // keep a ~5% miss floor and hit ceiling
  // DAMAGE: each hit rolls within a band around the gun's nominal dmg (the "dice"),
  // bell-weighted toward the average. Strong guns keep bigger numbers + wider bands.
  var DMG_SPREAD = 0.30;   // ± fraction of nominal dmg (battleship 34 -> ~24..44)
  var CRIT_MULT  = 1.5;    // natural-20 critical-hit multiplier

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
    // Extra actions granted to ENEMY ships each turn (single-player HARD edge). Stays
    // 0 for online/mirror play so both deterministic sims match exactly.
    this.enemyActionsBonus = config.enemyActionsBonus != null ? config.enemyActionsBonus : 0;
    // AI persona ("easy" | "normal" | "hard") — tunes how aggressively the planner
    // focus-fires, kites, and positions. Deterministic (no rng in planning).
    this.aiSkill = config.aiSkill || "normal";
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
    // ev = EVASION (added to the attacker's to-hit target number): small, fast
    // ships are slippery (gunboat +4), big ships are easy to hit (battleship +0).
    var CLASSES = [
      { k: "battleship", hp: 150, speed: 22, turnRate: 50,  g: gun(140, 58, 34), ev: 0 },
      { k: "cruiser",    hp: 110, speed: 30, turnRate: 68,  g: gun(112, 68, 26), ev: 1 },
      { k: "destroyer",  hp: 85,  speed: 40, turnRate: 88,  g: gun(90,  80, 20), ev: 2 },
      { k: "frigate",    hp: 68,  speed: 48, turnRate: 104, g: gun(74,  86, 16), ev: 3 },
      { k: "gunboat",    hp: 48,  speed: 56, turnRate: 120, g: gun(60,  96, 12), ev: 4 },
    ];
    var xs = [0.16, 0.33, 0.5, 0.67, 0.84], ships = [];
    for (var i = 0; i < CLASSES.length; i++) {
      var c = CLASSES[i];
      // fresh gun object per ship (difficulty tweaks mutate s.gun — no shared refs)
      ships.push({ id: "P-" + c.k, side: "player", x: w * xs[i], y: h - 40, heading: -Math.PI / 2, hp: c.hp, speed: c.speed, turnRate: c.turnRate, evasion: c.ev, gun: { range: c.g.range, arc: c.g.arc, dmg: c.g.dmg } });
      ships.push({ id: "E-" + c.k, side: "enemy",  x: w * xs[CLASSES.length - 1 - i], y: 40, heading: Math.PI / 2, hp: c.hp, speed: c.speed, turnRate: c.turnRate, evasion: c.ev, gun: { range: c.g.range, arc: c.g.arc, dmg: c.g.dmg } });
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
      evasion: s.evasion != null ? s.evasion : 0,   // to-hit penalty this ship imposes on attackers (0..4)
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
          speed: s.speed, turnRate: s.turnRate, evasion: s.evasion, gun: { range: s.gun.range, arc: s.gun.arc, dmg: s.gun.dmg },
          radius: s.radius, actionsLeft: s.actionsLeft, sunk: s.sunk, defending: s.defending, overwatch: s.overwatch,
        };
      }),
    };
  };

  NavalFree.prototype._refreshActions = function (side) {
    for (var i = 0; i < this.ships.length; i++) {
      var s = this.ships[i];
      var base = (s.side === side && !s.sunk) ? this.actionsPerTurn : 0;
      // Enemy ships get the single-player HARD action bonus when it's their turn.
      if (base > 0 && side === "enemy") base += this.enemyActionsBonus;
      s.actionsLeft = base;
      // A DEFEND (overwatch) stance lasts through the OTHER side's turn and clears
      // when this side becomes active again (its reaction shots are spent).
      if (s.side === side) { s.defending = false; s.overwatch = false; s._reacted = false; }
    }
  };

  // OVERWATCH reaction shot — a DEFENDING ship fires at an enemy that moved into its
  // range + arc + LOS, WITHOUT spending an action (it committed its turn to defend).
  // Same hit/falloff/sink/win resolution as fireAt. Returns { ok, result, dmg?, sunk? }.
  NavalFree.prototype.reactionFire = function (shooterId, targetId) {
    if (this.ended) return { ok: false, reason: "ended" };
    var s = this.shipById(shooterId), t = this.shipById(targetId);
    if (!s || s.sunk || !t || t.sunk || s.side === t.side) return { ok: false, reason: "invalid" };
    var chk = this.canFireAt(shooterId, t.x, t.y, t.id);
    if (!chk.ok) return { ok: false, reason: chk.reason };
    // Roll to-hit — a reaction shot can miss too.
    var atk = this._attackRoll(s, t, chk.range);
    if (!atk.hit) {
      this.log.push(s.id + " OVERWATCH MISSED " + t.id + " (d20 " + atk.d20 + " vs " + atk.toHit + ")");
      var rmiss = { ok: true, result: "miss", x: t.x, y: t.y, by: s.id, target: t.id, d20: atk.d20, toHit: atk.toHit, range: chk.range, reaction: true };
      this.onEvent("fire", rmiss);
      return rmiss;
    }
    var dmg = this._damageRoll(s, atk.crit, t.defending);
    t.hp -= dmg;
    var out = { ok: true, result: "hit", x: t.x, y: t.y, by: s.id, target: t.id, dmg: dmg, crit: atk.crit, d20: atk.d20, toHit: atk.toHit, range: chk.range, reaction: true };
    if (t.hp <= 0) { t.hp = 0; t.sunk = true; out.result = "sink"; out.sunk = true; this.log.push(s.id + " OVERWATCH SANK " + t.id + (atk.crit ? " (CRIT)" : "")); }
    else { this.log.push(s.id + " OVERWATCH " + (atk.crit ? "CRIT " : "hit ") + t.id + " for " + dmg + " (hp " + t.hp + ")"); }
    var foeSide = s.side === "player" ? "enemy" : "player";
    if (this.alive(foeSide) === 0) { this.ended = true; this.winner = s.side; out.win = true; this.onEvent("fire", out); this.onEvent("end", { winner: s.side }); return out; }
    this.onEvent("fire", out);
    return out;
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

  // The NEAREST ship (excluding the shooter + the aim-point's own ship) whose hull
  // the shot path shooter->(tx,ty) crosses — i.e. the FIRST thing a cannonball hits.
  // Used to redirect a line-of-sight-blocked shot onto the blocker (FRIENDLY FIRE if
  // it's one of yours) instead of the shot just fizzling. Natural physics.
  NavalFree.prototype._firstObstacle = function (shooter, tx, ty, ignoreId) {
    var ax = shooter.x, ay = shooter.y, dx = tx - ax, dy = ty - ay;
    var segLen2 = dx * dx + dy * dy;
    if (segLen2 < 1e-6) return null;
    var best = null, bestT = Infinity;
    for (var i = 0; i < this.ships.length; i++) {
      var o = this.ships[i];
      if (o.sunk || o.id === shooter.id || o.id === ignoreId) continue;
      var t = ((o.x - ax) * dx + (o.y - ay) * dy) / segLen2;
      if (t <= 0.001 || t > 1.05) continue;           // behind the muzzle / past the aim point
      var tc = clamp(t, 0, 1), px = ax + tc * dx, py = ay + tc * dy;
      if (dist(px, py, o.x, o.y) < o.radius && t < bestT) { bestT = t; best = o; }
    }
    return best;
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

  // SWIPE MOVE: drive the ship ALONG a swiped polyline, consuming up to its speed
  // budget (still 1 action). Lets the player trace diagonals / L-shapes / curves
  // instead of a single straight hop. Heading turns toward the final travel
  // direction (capped by turnRate, same as a normal move). Returns the traveled
  // `path` (sim coords, starting at the ship) so the renderer can trace it on screen.
  NavalFree.prototype.moveShipPath = function (id, points) {
    var s = this.shipById(id);
    if (!s || s.sunk) return { ok: false, reason: "no-ship" };
    if (this.turn !== s.side) return { ok: false, reason: "not-your-turn" };
    if (s.actionsLeft <= 0) return { ok: false, reason: "no-actions" };
    if (!points || !points.length) return { ok: false, reason: "no-path" };
    var budget = s.speed, path = [{ x: s.x, y: s.y }];
    var prevX = s.x, prevY = s.y, cx = s.x, cy = s.y;
    var lastUx = Math.cos(s.heading), lastUy = Math.sin(s.heading);
    for (var i = 0; i < points.length && budget > 1e-3; i++) {
      var p = points[i];
      if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
      var segdx = p.x - prevX, segdy = p.y - prevY, seglen = Math.sqrt(segdx * segdx + segdy * segdy);
      if (seglen < 1e-4) continue;
      var ux = segdx / seglen, uy = segdy / seglen, step = Math.min(seglen, budget);
      var nx = clamp(prevX + ux * step, s.radius, this.width - s.radius);
      var ny = clamp(prevY + uy * step, s.radius, this.height - s.radius);
      for (var k = 0; k < this.ships.length; k++) {                 // don't overlap a hull
        var o = this.ships[k]; if (o.sunk || o.id === s.id) continue;
        var dd = dist(nx, ny, o.x, o.y), minD = s.radius + o.radius;
        if (dd < minD) { nx = o.x + (nx - o.x) / (dd || 1) * minD; ny = o.y + (ny - o.y) / (dd || 1) * minD; }
      }
      cx = nx; cy = ny; path.push({ x: cx, y: cy });
      lastUx = ux; lastUy = uy; budget -= step; prevX = cx; prevY = cy;
      if (step < seglen - 1e-6) break;                              // budget exhausted mid-segment
    }
    var desired = Math.atan2(lastUy, lastUx);
    s.heading = norm(s.heading + clamp(angDelta(s.heading, desired), -s.turnRate, s.turnRate));
    var moved = dist(s.x, s.y, cx, cy);
    s.x = cx; s.y = cy; s.actionsLeft--;
    this.log.push(s.id + " swipe -> (" + cx.toFixed(1) + "," + cy.toFixed(1) + ") via " + path.length + " pts, moved " + moved.toFixed(1));
    this.onEvent("move", { id: s.id, x: s.x, y: s.y, heading: s.heading, moved: moved, path: path });
    return { ok: true, x: s.x, y: s.y, heading: s.heading, moved: moved, path: path, actionsLeft: s.actionsLeft };
  };

  // ── dice resolution (D&D-style) ─────────────────────────────────────────────
  // All rolls draw from the seeded rng, so a (seed + action order) reproduces a
  // match exactly — the headless gate and online mirror both rely on this.

  // Roll an integer in [1, sides] from the seeded rng.
  NavalFree.prototype._d = function (sides) { return 1 + Math.floor(this.rng() * sides); };

  // The to-hit TARGET NUMBER a shot must meet on a d20: rises with firing range,
  // the target's evasion, and a DEFEND stance. Deterministic (no rng) so the AI
  // and a UI preview can read it. Clamped so nat-1 misses / nat-20 hits always hold.
  NavalFree.prototype._toHit = function (s, victim, range) {
    var rangeFrac = clamp(range / Math.max(1, s.gun.range), 0, 1);
    var n = TOHIT_BASE + Math.round(TOHIT_RANGE * rangeFrac)
          + (victim.evasion || 0) + (victim.defending ? TOHIT_DEFEND : 0);
    return clamp(n, TOHIT_MIN, TOHIT_MAX);
  };

  // Deterministic hit-probability ESTIMATE (no rng) — for AI planning + UI preview.
  NavalFree.prototype._hitChance = function (s, victim, range) {
    var p = (21 - this._toHit(s, victim, range)) / 20;   // P(d20 >= toHit)
    return clamp(p, 0.05, 0.95);                          // nat-1 floor / nat-20 ceiling
  };

  // Roll the d20 to hit. Returns { hit, crit, d20, toHit }.
  NavalFree.prototype._attackRoll = function (s, victim, range) {
    var toHit = this._toHit(s, victim, range);
    var d20 = this._d(20);
    return {
      d20: d20, toHit: toHit,
      hit: d20 === 20 || (d20 !== 1 && d20 >= toHit),
      crit: d20 === 20,
    };
  };

  // Roll damage within ±DMG_SPREAD of the gun's nominal dmg, bell-weighted toward
  // the average (mean of two rolls). Crit multiplies; a DEFENDing victim halves.
  NavalFree.prototype._damageRoll = function (s, crit, defending) {
    var nom = s.gun.dmg;
    var lo = nom * (1 - DMG_SPREAD), hi = nom * (1 + DMG_SPREAD);
    var dmg = lo + ((this.rng() + this.rng()) / 2) * (hi - lo);
    if (crit) dmg *= CRIT_MULT;
    if (defending) dmg *= 0.5;
    return Math.max(1, Math.round(dmg));
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

    var intendedId = namedTarget ? namedTarget.id : null;
    var chk = this.canFireAt(shooterId, tx, ty, intendedId);
    var victim = null, redirected = false, rangeToVictim;

    if (!chk.ok) {
      // LINE OF FIRE BLOCKED -> natural physics: the cannonball strikes the FIRST
      // hull in its path (friend or foe) instead of fizzling. Out-of-range / out-of-
      // arc still can't fire at all.
      if (chk.reason === "los") {
        var blocker = this._firstObstacle(s, tx, ty, intendedId);
        if (blocker) { victim = blocker; redirected = true; rangeToVictim = dist(s.x, s.y, blocker.x, blocker.y); }
      }
      if (!victim) {
        s.actionsLeft--;
        this.log.push(s.id + " fire FAILED (" + chk.reason + ")");
        var inv = { result: "invalid", reason: chk.reason, x: tx, y: ty, by: s.id, range: chk.range, actionsLeft: s.actionsLeft };
        this.onEvent("fire", inv);
        return inv;
      }
      s.actionsLeft--;
    } else {
      s.actionsLeft--;
      // Clear shot: the named target, or for an aimed point the nearest enemy hull
      // the impact lands in (splash).
      victim = namedTarget;
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
      rangeToVictim = chk.range;
    }

    var friendlyFire = victim.side === s.side;

    // D&D resolution: roll a d20 to hit (range + the target's evasion + DEFEND set
    // the number), then roll dice damage against the ACTUAL victim (the blocker, on a
    // redirected shot). Nat-20 crits. A clean shot can still miss on the roll.
    var atk = this._attackRoll(s, victim, rangeToVictim);
    if (!atk.hit) {
      this.log.push(s.id + " MISSED " + victim.id + " (d20 " + atk.d20 + " vs " + atk.toHit + ")");
      var rolledMiss = { result: "miss", x: victim.x, y: victim.y, by: s.id, target: victim.id, intendedTarget: intendedId, redirected: redirected, friendlyFire: friendlyFire, d20: atk.d20, toHit: atk.toHit, range: rangeToVictim, actionsLeft: s.actionsLeft };
      this.onEvent("fire", rolledMiss);
      return rolledMiss;
    }
    var dmg = this._damageRoll(s, atk.crit, victim.defending);
    victim.hp -= dmg;

    // result stays "hit"/"sink" (so existing renderer checks keep working); `crit`,
    // `friendlyFire`, `redirected`, `intendedTarget` are flags the renderer reads.
    var out = { result: "hit", x: victim.x, y: victim.y, by: s.id, target: victim.id, intendedTarget: intendedId, redirected: redirected, friendlyFire: friendlyFire, dmg: dmg, crit: atk.crit, d20: atk.d20, toHit: atk.toHit, range: rangeToVictim, actionsLeft: s.actionsLeft };
    if (victim.hp <= 0) {
      victim.hp = 0; victim.sunk = true;
      out.result = "sink"; out.sunk = true;
      this.log.push(s.id + (friendlyFire ? " FRIENDLY-FIRE SANK " : " SANK ") + victim.id + (atk.crit ? " (CRIT)" : ""));
    } else {
      this.log.push(s.id + (friendlyFire ? " FRIENDLY-FIRE hit " : (atk.crit ? " CRIT " : " hit ")) + victim.id + " for " + dmg + " (hp " + victim.hp + ")");
    }

    // End check — friendly fire can sink your OWN last ship, so whichever side hits 0
    // loses (not just the shooter's foe).
    if (this.alive("player") === 0 || this.alive("enemy") === 0) {
      this.ended = true;
      this.winner = this.alive("player") > 0 ? "player" : (this.alive("enemy") > 0 ? "enemy" : s.side);
      out.win = (this.winner === s.side);
      this.onEvent("fire", out); this.onEvent("end", { winner: this.winner });
      return out;
    }
    this.onEvent("fire", out);
    return out;
  };

  // ── ONLINE: apply a pre-rolled shot (no re-roll) ─────────────────────────────
  // Dice now consume the rng, so two clients calling fireAt() independently would
  // DESYNC. Instead the shooter is authoritative: it rolls locally and relays the
  // outcome, and the remote applies it verbatim here (same hp/sink on both sims,
  // regardless of each client's rng stream). Mirrors fireAt's bookkeeping + events.
  NavalFree.prototype.applyFireResult = function (shooterId, targetId, res) {
    res = res || {};
    var s = this.shipById(shooterId), t = this.shipById(targetId);
    if (s && s.actionsLeft > 0) s.actionsLeft--;          // mirror the action spend
    if (!t || t.sunk) { var nt = { result: "miss", by: shooterId, target: targetId, reaction: !!res.reaction }; this.onEvent("fire", nt); return nt; }
    if (res.result === "miss" || res.dmg == null) {
      var miss = { result: "miss", x: t.x, y: t.y, by: shooterId, target: targetId, d20: res.d20, toHit: res.toHit, reaction: !!res.reaction };
      this.onEvent("fire", miss); return miss;
    }
    var dmg = Math.max(1, Math.round(res.dmg));
    t.hp -= dmg;
    var out = { result: "hit", x: t.x, y: t.y, by: shooterId, target: targetId, dmg: dmg, crit: !!res.crit, d20: res.d20, toHit: res.toHit, reaction: !!res.reaction };
    if (t.hp <= 0 || res.sunk) { t.hp = 0; t.sunk = true; out.result = "sink"; out.sunk = true; this.log.push(shooterId + " (relayed) SANK " + targetId); }
    else { this.log.push(shooterId + " (relayed) hit " + targetId + " for " + dmg + " (hp " + t.hp + ")"); }
    if (s) {
      var foeSide = s.side === "player" ? "enemy" : "player";
      if (this.alive(foeSide) === 0) { this.ended = true; this.winner = s.side; out.win = true; this.onEvent("fire", out); this.onEvent("end", { winner: s.side }); return out; }
    }
    this.onEvent("fire", out); return out;
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

  // ── AI ──────────────────────────────────────────────────────────────────────
  // A REAL opponent (deterministic — no rng in planning). For each ship it:
  //   • picks a target by THREAT, biased to FINISH low-HP ships (focus fire) and to
  //     prefer the most dangerous (longest-ranged / highest-value) and in-arc foes;
  //   • KITES by range: if it out-ranges the target it holds near its OWN max range
  //     (stay outside the foe's reach); if out-ranged it closes hard to its own
  //     effective range; it lines the standoff so the bearing lands inside its arc;
  //   • fires whenever a clean shot exists, spending every action on shoot/maneuver.
  // Returns the action list so the renderer animates them in sequence.

  // Effective gun reach used for kiting decisions (full-damage band ~ chk falloff).
  NavalFree.prototype._effRange = function (s) { return s.gun.range; };

  // AI RANDOMNESS "temperature" — how much the planner varies its picks/paths so it
  // doesn't replay the SAME game every match. Drawn from the seeded rng (single-player
  // only; online is PvP and never plans), so a match still reproduces from its seed.
  // HARD = focused (low temp, subtle variety); EASY = erratic (high temp).
  NavalFree.prototype._aiTemp = function () {
    var s = this.aiSkill || "normal";
    return s === "hard" ? 0.35 : s === "easy" ? 1.0 : 0.6;
  };

  // Threat/priority score for `s` choosing among living enemies. Higher = better
  // target. Deterministic; ties broken by id for stability.
  NavalFree.prototype._aiPickTarget = function (s) {
    var foes = this.enemiesOf(s.side);
    if (!foes.length) return null;
    var skill = this.aiSkill || "normal";
    var best = null, bestScore = -Infinity;
    for (var i = 0; i < foes.length; i++) {
      var f = foes[i];
      var d = dist(s.x, s.y, f.x, f.y);
      var inRange = d <= s.gun.range;
      var bearing = Math.atan2(f.y - s.y, f.x - s.x);
      var off = Math.abs(angDelta(s.heading, bearing));
      var inArc = off <= s.gun.arc / 2;
      var canHitNow = inRange && inArc && this._losClear(s, f.x, f.y, f.id);
      var hc = this._hitChance(s, f, d);                   // P(hit) at this range/evasion
      var expDmg = Math.max(1, s.gun.dmg * hc);            // expected damage per salvo
      var score = 0;
      // 1) FINISH: fewer EXPECTED salvos to sink it = prioritise hard.
      var shotsToKill = Math.max(1, Math.ceil(f.hp / expDmg));
      score += (6 - Math.min(6, shotsToKill)) * 14;        // fewer shots-to-kill = far better
      if (canHitNow && f.hp <= s.gun.dmg * (1 + DMG_SPREAD)) score += 60;  // a good roll finishes it now
      // 2) Low absolute HP (focus the wounded).
      score += (1 - f.hp / Math.max(1, f.maxHp)) * 30;
      // 3) Threat value: longer-ranged + harder-hitting foes are more dangerous.
      score += (f.gun.range / 140) * 12 + (f.gun.dmg / 34) * 10;
      // 4) Reachability now / soon: in-arc & in-range shots are cheap to take.
      if (canHitNow) score += 28; else if (inRange) score += 10;
      // 4b) Hit probability: prefer targets we can actually land shots on (a fast,
      //     evasive, or DEFENDing ship at long range is a poor use of a salvo).
      score += hc * 18;
      // 5) Distance: gentle pull toward nearer foes so ships don't all chase one far away.
      score += (1 - Math.min(1, d / (this.width + this.height))) * 8;
      // Easy AI: flatten the smarts toward "nearest", so it plays softer.
      if (skill === "easy") score = (1 - Math.min(1, d / (this.width + this.height))) * 10 + (canHitNow ? 5 : 0);
      // VARIETY: a temperature-scaled jitter so the AI doesn't always lock onto the
      // single optimal target — it picks among the strong candidates differently each
      // match. Bounded so it never chooses an obviously bad target (esp. on hard).
      score += (this.rng() - 0.5) * 45 * this._aiTemp();
      // stable tiebreak
      score += (f.id < s.id ? 0.001 : 0);
      if (score > bestScore || (score === bestScore && (!best || f.id < best.id))) { bestScore = score; best = f; }
    }
    return best;
  };

  // Plan + execute the acting SIDE's whole turn (defaults to this.turn). Used by
  // the live enemy turn (aiPlan) AND by autoResolve to drive BOTH fleets.
  NavalFree.prototype.aiPlanSide = function (side) {
    side = side || this.turn;
    var acts = [];
    if (this.ended) return acts;
    var skill = this.aiSkill || "normal";
    var temp = this._aiTemp();
    var mine = this.shipsOf(side);
    for (var i = 0; i < mine.length; i++) {
      var s = mine[i];
      // Pick the target ONCE per ship (jittered) so a ship commits to a coherent plan
      // for its turn instead of re-jittering between its two actions; re-pick if it sinks.
      var foe = this._aiPickTarget(s) || this._nearestEnemy(s);
      var guard = 0;
      while (s.actionsLeft > 0 && !this.ended && guard++ < 10) {
        if (!foe || foe.sunk) { foe = this._aiPickTarget(s) || this._nearestEnemy(s); if (!foe) break; }
        // 1) Clean shot available now? Take it (focus fire / finish).
        var chk = this.canFireAt(s.id, foe.x, foe.y, foe.id);
        if (chk.ok) {
          var r = this.fireAt(s.id, foe.id);
          acts.push({ kind: "fire", id: s.id, target: foe.id, result: r });
          if (r && r.result === "sink") foe = null; // target down — re-pick next loop
          continue;
        }
        // 2) No shot — maneuver to a firing solution that respects KITING.
        var bearing = Math.atan2(foe.y - s.y, foe.x - s.x);
        var d = dist(s.x, s.y, foe.x, foe.y);
        var myR = this._effRange(s), foeR = this._effRange(foe);
        // DEFENSIVE STANCES — the enemy GUARDS + OVERWATCHES too. Now PROBABILISTIC (a
        // wounded ship usually braces, a healthy one often holds overwatch) so the enemy
        // doesn't make the identical stance call every time. Higher skill = more reliable.
        if (skill !== "easy" && s.actionsLeft <= 1) {
          var guardProb = skill === "hard" ? 0.85 : 0.65;
          var owProb = skill === "hard" ? 0.7 : 0.55;
          if (s.hp <= s.maxHp * 0.35 && this.rng() < guardProb) { s.defending = true; s.overwatch = false; s.actionsLeft = 0; acts.push({ kind: "defend", id: s.id }); break; }
          if (d > myR && d <= myR * 1.5 && this.rng() < owProb) { s.overwatch = true; s._reacted = false; s.actionsLeft = 0; acts.push({ kind: "overwatch", id: s.id }); break; }
        }
        // Desired standoff distance from the foe (kiting logic), then JITTER it so the
        // engagement range — and thus the path — differs each match (bounded; still kites).
        var standoff;
        if (myR > foeR + 4) standoff = Math.min(myR * 0.95, Math.max(foeR + 8, myR * 0.8));
        else if (foeR > myR + 4) standoff = myR * (skill === "hard" ? 0.6 : 0.7);
        else standoff = myR * (skill === "hard" ? 0.78 : 0.82);
        if (skill === "easy") standoff = myR * 0.7; // simpler closing behaviour
        standoff *= (1 + (this.rng() - 0.5) * 0.30 * temp);
        // Aim a point at `standoff` from the foe, on the bearing line toward us, with a
        // lateral FLANK offset so the approach isn't a dead-straight charge every time.
        var lat = (this.rng() - 0.5) * standoff * 0.6 * temp;
        var destX = foe.x - Math.cos(bearing) * standoff + Math.cos(bearing + Math.PI / 2) * lat;
        var destY = foe.y - Math.sin(bearing) * standoff + Math.sin(bearing + Math.PI / 2) * lat;
        // If we're already roughly at standoff but just need to TURN to bear, aim a
        // point straight ahead toward the foe so moveShip rotates us onto target.
        var off = Math.abs(angDelta(s.heading, bearing));
        if (Math.abs(d - standoff) < s.speed * 0.5 && off > s.gun.arc / 2) {
          destX = s.x + Math.cos(bearing) * Math.min(s.speed, 6);
          destY = s.y + Math.sin(bearing) * Math.min(s.speed, 6);
        }
        var mv = this.moveShip(s.id, { x: destX, y: destY });
        acts.push({ kind: "move", id: s.id, result: mv });
        if (!mv.ok || mv.moved < 0.05) {
          // Couldn't make progress (blocked/at-bound). Try a pure rotate to bring
          // guns to bear so the next action can fire; else bail to avoid spinning.
          if (s.actionsLeft > 0 && off > s.gun.arc / 2) {
            var rot = this.rotateShip(s.id, angDelta(s.heading, bearing));
            acts.push({ kind: "move", id: s.id, result: { ok: rot.ok, x: s.x, y: s.y, heading: s.heading, moved: 0 } });
            if (!rot.ok) break;
          } else break;
        }
      }
    }
    return acts;
  };

  // Live enemy turn: plan the ENEMY side (guarded so clicks/tests can't mis-fire it).
  NavalFree.prototype.aiPlan = function () {
    if (this.ended || this.turn !== "enemy") return [];
    return this.aiPlanSide("enemy");
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
