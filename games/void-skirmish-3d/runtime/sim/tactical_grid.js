/**
 * FFG runtime — sim/tactical_grid.js
 * Pure simulation core for grid tactics (XCOM / Fire Emblem / Into the Breach).
 * NO rendering here — rendering + input + feel live in ffg_tactics.js.
 *
 * Deterministic when given a seeded rng (config.rng), so the signature gate can
 * drive it headlessly in Node and assert the defining mechanics actually work.
 *
 * Grid tile codes: 0=floor, 1=wall(blocks move+LOS), 2=half_cover(passable),
 *                  3=full_cover(blocks move, grants cover), 4=hazard(passable, dmg).
 *
 * Dual export: Node `require()` (gates) and browser `window.FFG.sim.TacticalBattle`.
 */
(function (root) {
  "use strict";

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class TacticalBattle {
    constructor(config) {
      this.grid = config.grid;
      this.gridW = (this.grid[0] && this.grid[0].length) || 0;
      this.gridH = this.grid.length;
      this.rng = config.rng || (typeof config.seed === "number" ? mulberry32(config.seed) : Math.random);
      this.player_units = (config.player_units || []).map((u) => this._initUnit(u, "player"));
      this.enemy_units = (config.enemy_units || []).map((u) => this._initUnit(u, "enemy"));
      this.currentPhase = "player";
      this.turnNumber = 1;
      this.selectedUnit = null;
      this.onEnd = config.onEnd || function () {};
      this.onEvent = config.onEvent || function () {}; // (type, payload) for the renderer
      this.ended = false;
      this.log = [];
    }

    _initUnit(u, side) {
      return {
        id: u.id,
        name: u.name || u.id,
        side: side,
        x: u.x, y: u.y,
        hp: u.hp != null ? u.hp : 10,
        maxHp: u.hp != null ? u.hp : 10,
        atk: u.atk != null ? u.atk : 5,
        def: u.def != null ? u.def : 0,
        movement: u.movement != null ? u.movement : 4,
        range: u.range != null ? u.range : 8,
        aim: u.aim != null ? u.aim : 0.75,
        actionPoints: 2,
        maxAP: 2,
        ai: u.ai || "aggressive",
        sprite: u.sprite || null,
        tint: u.tint != null ? u.tint : null,
      };
    }

    // ── Queries ────────────────────────────────────────────────────────────
    inBounds(x, y) { return x >= 0 && y >= 0 && x < this.gridW && y < this.gridH; }

    isWalkable(x, y) {
      if (!this.inBounds(x, y)) return false;
      const t = this.grid[y][x];
      return t === 0 || t === 2 || t === 4; // floor / half-cover / hazard
    }

    unitAt(x, y) {
      return this.allUnits().find((u) => u.x === x && u.y === y && u.hp > 0) || null;
    }

    getUnit(id) { return this.allUnits().find((u) => u.id === id) || null; }
    allUnits() { return this.player_units.concat(this.enemy_units); }
    aliveAllies() { return this.player_units.filter((u) => u.hp > 0); }
    aliveEnemies() { return this.enemy_units.filter((u) => u.hp > 0); }

    /**
     * Tiles a unit can reach this action, respecting movement budget, walls, and
     * other units. Returns [{x,y,cost}]. Used for the move-range highlight AND
     * as the signature-mechanic assertion (movement is genuinely path-constrained).
     */
    reachableTiles(unit) {
      const out = [];
      const seen = {};
      const start = unit.x + "," + unit.y;
      seen[start] = 0;
      let frontier = [{ x: unit.x, y: unit.y, cost: 0 }];
      while (frontier.length) {
        const next = [];
        for (const node of frontier) {
          for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = node.x + d[0], ny = node.y + d[1];
            const cost = node.cost + 1;
            if (cost > unit.movement) continue;
            if (!this.isWalkable(nx, ny)) continue;
            if (this.unitAt(nx, ny)) continue;
            const k = nx + "," + ny;
            if (seen[k] != null && seen[k] <= cost) continue;
            seen[k] = cost;
            out.push({ x: nx, y: ny, cost: cost });
            next.push({ x: nx, y: ny, cost: cost });
          }
        }
        frontier = next;
      }
      return out;
    }

    // A* (orthogonal, unit-blocking). Returns path excluding the start tile.
    findPath(sx, sy, ex, ey) {
      const key = (x, y) => x + "," + y;
      const open = new Set([key(sx, sy)]);
      const cameFrom = {};
      const g = { [key(sx, sy)]: 0 };
      const f = { [key(sx, sy)]: Math.abs(ex - sx) + Math.abs(ey - sy) };
      while (open.size) {
        let cur = null, best = Infinity;
        for (const k of open) { const v = f[k] != null ? f[k] : Infinity; if (v < best) { best = v; cur = k; } }
        if (!cur) break;
        const parts = cur.split(",");
        const cx = +parts[0], cy = +parts[1];
        if (cx === ex && cy === ey) {
          const path = [{ x: cx, y: cy }];
          let c = cur;
          while (cameFrom[c]) { c = cameFrom[c]; const p = c.split(","); path.unshift({ x: +p[0], y: +p[1] }); }
          return path.slice(1);
        }
        open.delete(cur);
        for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + d[0], ny = cy + d[1];
          if (!this.isWalkable(nx, ny)) continue;
          if (this.unitAt(nx, ny) && !(nx === ex && ny === ey)) continue;
          const nk = key(nx, ny);
          const tg = (g[cur] != null ? g[cur] : Infinity) + 1;
          if (tg < (g[nk] != null ? g[nk] : Infinity)) {
            cameFrom[nk] = cur; g[nk] = tg;
            f[nk] = tg + Math.abs(ex - nx) + Math.abs(ey - ny);
            open.add(nk);
          }
        }
      }
      return null;
    }

    // Bresenham LOS; walls (1) and full cover (3) block sight.
    hasLineOfSight(fromX, fromY, toX, toY) {
      const dx = Math.abs(toX - fromX), dy = Math.abs(toY - fromY);
      const sx = fromX < toX ? 1 : -1, sy = fromY < toY ? 1 : -1;
      let err = dx - dy, x = fromX, y = fromY;
      while (x !== toX || y !== toY) {
        const isEndpoint = (x === fromX && y === fromY) || (x === toX && y === toY);
        if (!isEndpoint) {
          const t = this.grid[y] && this.grid[y][x];
          if (t === 1 || t === 3) return false;
        }
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
      }
      return true;
    }

    // Best cover value protecting `unit` (0 none, 1 half, 2 full). A cover tile
    // adjacent to the unit only protects against an attacker approaching FROM
    // that side: cover to my east shields me from attackers to my east.
    coverAt(unit, fromX, fromY) {
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      let best = 0;
      for (const d of dirs) {
        const dx = d[0], dy = d[1];
        const nx = unit.x + dx, ny = unit.y + dy;
        const t = this.grid[ny] && this.grid[ny][nx];
        const cv = t === 3 ? 2 : t === 2 ? 1 : 0;
        if (cv === 0) continue;
        if (fromX != null) {
          const ax = Math.sign(fromX - unit.x), ay = Math.sign(fromY - unit.y);
          const shields = (dx !== 0 && dx === ax) || (dy !== 0 && dy === ay);
          if (!shields) continue;
        }
        best = Math.max(best, cv);
      }
      return best;
    }

    calculateHitChance(attacker, target) {
      const dist = Math.abs(attacker.x - target.x) + Math.abs(attacker.y - target.y);
      if (dist > attacker.range) return 0;
      const distancePenalty = Math.max(0, (dist - 3) * 0.05);
      const cover = this.coverAt(target, attacker.x, attacker.y);
      const coverPenalty = cover === 2 ? 0.4 : cover === 1 ? 0.2 : 0;
      const flank = cover === 0 ? 0.1 : 0; // open target = slight bonus
      return Math.max(0.05, Math.min(0.99, attacker.aim - distancePenalty - coverPenalty + flank));
    }

    // ── Actions ──────────────────────────────────────────────────────────────
    moveUnit(unitId, toX, toY) {
      const u = this.getUnit(unitId);
      if (!u || u.hp <= 0 || u.actionPoints < 1) return null;
      const path = this.findPath(u.x, u.y, toX, toY);
      if (!path || path.length === 0 || path.length > u.movement) return null;
      if (this.unitAt(toX, toY)) return null;
      u.x = toX; u.y = toY;
      u.actionPoints--;
      // Hazard tile damage
      if (this.grid[toY][toX] === 4) { u.hp = Math.max(0, u.hp - 2); this.log.push(u.id + " took 2 hazard dmg"); }
      this.onEvent("move", { unit: u, path: path });
      this._checkEnd();
      return path;
    }

    attackUnit(attackerId, targetId) {
      const a = this.getUnit(attackerId), t = this.getUnit(targetId);
      if (!a || !t || a.hp <= 0 || t.hp <= 0) return { success: false, reason: "invalid" };
      if (a.actionPoints < 1) return { success: false, reason: "no AP" };
      if (!this.hasLineOfSight(a.x, a.y, t.x, t.y)) return { success: false, reason: "no LOS" };
      const chance = this.calculateHitChance(a, t);
      if (chance <= 0) return { success: false, reason: "out of range" };
      a.actionPoints--;
      const roll = this.rng();
      if (roll <= chance) {
        const dmg = Math.max(1, a.atk - t.def);
        t.hp = Math.max(0, t.hp - dmg);
        this.log.push(a.id + " hit " + t.id + " for " + dmg + " (" + Math.round(chance * 100) + "%)");
        this.onEvent("attack", { attacker: a, target: t, hit: true, damage: dmg, chance: chance, killed: t.hp <= 0 });
        this._checkEnd();
        return { success: true, hit: true, damage: dmg, killed: t.hp <= 0, chance: chance };
      }
      this.log.push(a.id + " missed " + t.id + " (" + Math.round(chance * 100) + "%)");
      this.onEvent("attack", { attacker: a, target: t, hit: false, chance: chance });
      this._checkEnd();
      return { success: true, hit: false, chance: chance };
    }

    endTurn() {
      if (this.ended) return;
      const side = this.currentPhase === "player" ? this.player_units : this.enemy_units;
      for (const u of side) u.actionPoints = u.maxAP;
      if (this.currentPhase === "player") {
        this.currentPhase = "enemy";
        this.onEvent("phase", { phase: "enemy", turn: this.turnNumber });
        this._runEnemyTurn();
        if (!this.ended) {
          this.currentPhase = "player";
          this.turnNumber++;
          for (const u of this.player_units) u.actionPoints = u.maxAP;
          this.onEvent("phase", { phase: "player", turn: this.turnNumber });
        }
      }
    }

    _runEnemyTurn() {
      for (const e of this.aliveEnemies()) {
        if (this.ended) return;
        let targets = this.aliveAllies();
        if (!targets.length) break;
        targets = targets.slice().sort((p, q) =>
          (Math.abs(p.x - e.x) + Math.abs(p.y - e.y)) - (Math.abs(q.x - e.x) + Math.abs(q.y - e.y)));
        // Try to shoot, otherwise advance, then maybe shoot again.
        let guard = 0;
        while (e.actionPoints > 0 && guard++ < 6) {
          const tgt = targets[0];
          const dist = Math.abs(tgt.x - e.x) + Math.abs(tgt.y - e.y);
          if (dist <= e.range && this.hasLineOfSight(e.x, e.y, tgt.x, tgt.y)) {
            this.attackUnit(e.id, tgt.id);
          } else {
            const path = this.findPath(e.x, e.y, tgt.x, tgt.y);
            if (!path || !path.length) break;
            const steps = Math.min(path.length, e.movement);
            const dest = path[steps - 1];
            // don't step onto the target's tile
            if (dest.x === tgt.x && dest.y === tgt.y && steps > 1) { const d2 = path[steps - 2]; this.moveUnit(e.id, d2.x, d2.y); }
            else if (!(dest.x === tgt.x && dest.y === tgt.y)) this.moveUnit(e.id, dest.x, dest.y);
            else break;
          }
        }
      }
    }

    _checkEnd() {
      if (this.ended) return;
      const allies = this.aliveAllies().length;
      const enemies = this.aliveEnemies().length;
      if (allies === 0 || enemies === 0) {
        this.ended = true;
        const victory = allies > 0;
        this.onEvent("end", { victory: victory });
        this.onEnd({ victory: victory, log: this.log, turns: this.turnNumber });
      }
    }
  }

  const api = { TacticalBattle: TacticalBattle, mulberry32: mulberry32 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FFG = root.FFG || {};
  root.FFG.sim = root.FFG.sim || {};
  root.FFG.sim.TacticalBattle = TacticalBattle;
  root.FFG.sim.mulberry32 = mulberry32;
})(typeof window !== "undefined" ? window : globalThis);
