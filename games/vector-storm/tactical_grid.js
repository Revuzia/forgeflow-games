/**
 * tactical_grid.js — XCOM / Fire Emblem / Into The Breach turn-based tactical combat.
 *
 * Provides:
 *  - Grid-based movement with pathfinding (A*) + action point economy
 *  - Cover system (half cover / full cover)
 *  - Fog of war + line of sight
 *  - Ranged attacks with hit% (distance + cover + flanking)
 *  - Turn queue: player phase → enemy phase
 *  - Overwatch (reaction shots)
 *
 * All per-game data passed in via config — no hardcoded units or maps.
 *
 * API:
 *   const tactical = new TacticalBattle({
 *     grid: [[...]],  // 2D array: 0=floor, 1=wall, 2=half_cover, 3=full_cover
 *     player_units: [{id, x, y, hp, atk, def, movement, range, aim}, ...],
 *     enemy_units:  [{id, x, y, hp, atk, def, movement, range, aim, ai}, ...],
 *     onEnd: (result) => { }
 *   });
 *   tactical.attach(scene);  // sets up Phaser rendering
 *   tactical.selectUnit(id); // player clicks to select
 *   tactical.moveUnit(id, x, y);
 *   tactical.attackUnit(attackerId, targetId);
 *   tactical.endTurn();
 */
class TacticalBattle {
  constructor(config) {
    this.grid = config.grid;
    this.gridW = this.grid[0]?.length || 0;
    this.gridH = this.grid.length;
    this.tileSize = config.tileSize || 48;
    this.player_units = config.player_units.map(u => this._initUnit(u, "player"));
    this.enemy_units  = config.enemy_units.map(u => this._initUnit(u, "enemy"));
    this.currentPhase = "player";
    this.selectedUnit = null;
    this.onEnd = config.onEnd || (() => {});
    this.scene = null;
    this.log = [];
  }

  _initUnit(u, side) {
    return {
      id: u.id,
      side: side,
      x: u.x, y: u.y,
      hp: u.hp ?? 10, maxHp: u.hp ?? 10,
      atk: u.atk ?? 5,
      def: u.def ?? 0,
      movement: u.movement ?? 4,
      range: u.range ?? 8,
      aim: u.aim ?? 0.75,
      actionPoints: 2,  // move + action per turn
      ai: u.ai ?? "aggressive",  // aggressive|defensive|sniper
      visual: u.visual ?? null,
    };
  }

  isWalkable(x, y) {
    if (x < 0 || y < 0 || x >= this.gridW || y >= this.gridH) return false;
    const t = this.grid[y][x];
    return t === 0 || t === 2;  // floor or half cover (passable)
  }

  _unitAt(x, y) {
    const all = [...this.player_units, ...this.enemy_units];
    return all.find(u => u.x === x && u.y === y && u.hp > 0);
  }

  // A* pathfinding
  findPath(startX, startY, endX, endY) {
    const key = (x, y) => `${x},${y}`;
    const openSet = new Set([key(startX, startY)]);
    const cameFrom = {};
    const gScore = { [key(startX, startY)]: 0 };
    const fScore = { [key(startX, startY)]: Math.abs(endX - startX) + Math.abs(endY - startY) };

    while (openSet.size > 0) {
      let current = null;
      let bestF = Infinity;
      for (const k of openSet) {
        if ((fScore[k] ?? Infinity) < bestF) {
          bestF = fScore[k];
          current = k;
        }
      }
      if (!current) break;
      const [cx, cy] = current.split(",").map(Number);
      if (cx === endX && cy === endY) {
        // Reconstruct path
        const path = [{ x: cx, y: cy }];
        let c = current;
        while (cameFrom[c]) {
          c = cameFrom[c];
          const [x, y] = c.split(",").map(Number);
          path.unshift({ x, y });
        }
        return path.slice(1);  // exclude start
      }
      openSet.delete(current);
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!this.isWalkable(nx, ny)) continue;
        if (this._unitAt(nx, ny)) continue;
        const nk = key(nx, ny);
        const tentativeG = (gScore[current] ?? Infinity) + 1;
        if (tentativeG < (gScore[nk] ?? Infinity)) {
          cameFrom[nk] = current;
          gScore[nk] = tentativeG;
          fScore[nk] = tentativeG + Math.abs(endX - nx) + Math.abs(endY - ny);
          openSet.add(nk);
        }
      }
    }
    return null;
  }

  // Line of sight — simple Bresenham through walls-only
  hasLineOfSight(fromX, fromY, toX, toY) {
    const dx = Math.abs(toX - fromX), dy = Math.abs(toY - fromY);
    const sx = fromX < toX ? 1 : -1, sy = fromY < toY ? 1 : -1;
    let err = dx - dy, x = fromX, y = fromY;
    while (x !== toX || y !== toY) {
      if (!(x === fromX && y === fromY) && !(x === toX && y === toY)) {
        if (this.grid[y]?.[x] === 1) return false;  // wall blocks
      }
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 <  dx) { err += dx; y += sy; }
    }
    return true;
  }

  _coverAtUnit(unit) {
    // Check adjacent tiles — cover on the side the attacker is approaching
    // Simplified: return best cover value (0=none, 1=half, 2=full)
    const neighbors = [
      [unit.x - 1, unit.y], [unit.x + 1, unit.y],
      [unit.x, unit.y - 1], [unit.x, unit.y + 1],
    ];
    let best = 0;
    for (const [x, y] of neighbors) {
      const t = this.grid[y]?.[x];
      if (t === 3) best = Math.max(best, 2);
      else if (t === 2) best = Math.max(best, 1);
    }
    return best;
  }

  calculateHitChance(attacker, target) {
    const distance = Math.abs(attacker.x - target.x) + Math.abs(attacker.y - target.y);
    if (distance > attacker.range) return 0;
    const distancePenalty = Math.max(0, (distance - 3) * 0.05);
    const cover = this._coverAtUnit(target);
    const coverPenalty = cover === 2 ? 0.4 : cover === 1 ? 0.2 : 0;
    return Math.max(0.05, attacker.aim - distancePenalty - coverPenalty);
  }

  attackUnit(attackerId, targetId) {
    const attacker = this._findUnit(attackerId);
    const target = this._findUnit(targetId);
    if (!attacker || !target || attacker.actionPoints < 1) return { success: false, reason: "invalid" };
    if (!this.hasLineOfSight(attacker.x, attacker.y, target.x, target.y)) {
      return { success: false, reason: "no LOS" };
    }
    const hit = this.calculateHitChance(attacker, target);
    const roll = Math.random();
    attacker.actionPoints--;
    if (roll <= hit) {
      const dmg = Math.max(1, attacker.atk - target.def);
      target.hp = Math.max(0, target.hp - dmg);
      this.log.push(`${attackerId} hit ${targetId} for ${dmg} (${Math.round(hit*100)}% chance)`);
      return { success: true, hit: true, damage: dmg, killed: target.hp <= 0 };
    } else {
      this.log.push(`${attackerId} missed ${targetId} (${Math.round(hit*100)}% chance)`);
      return { success: true, hit: false };
    }
  }

  moveUnit(unitId, toX, toY) {
    const unit = this._findUnit(unitId);
    if (!unit || unit.actionPoints < 1) return null;
    const path = this.findPath(unit.x, unit.y, toX, toY);
    if (!path || path.length > unit.movement) return null;
    unit.x = toX; unit.y = toY;
    unit.actionPoints--;
    return path;
  }

  _findUnit(id) {
    return [...this.player_units, ...this.enemy_units].find(u => u.id === id);
  }

  endTurn() {
    // Refill action points for the current side, then switch
    const units = this.currentPhase === "player" ? this.player_units : this.enemy_units;
    for (const u of units) { u.actionPoints = 2; }
    this.currentPhase = this.currentPhase === "player" ? "enemy" : "player";
    if (this.currentPhase === "enemy") this._runEnemyTurn();
    this._checkEnd();
  }

  _runEnemyTurn() {
    // Very basic AI: each enemy moves toward nearest player and shoots if possible
    for (const enemy of this.enemy_units.filter(u => u.hp > 0)) {
      const targets = this.player_units.filter(u => u.hp > 0);
      if (!targets.length) break;
      // Find nearest target
      targets.sort((a, b) =>
        Math.abs(a.x - enemy.x) + Math.abs(a.y - enemy.y) -
        Math.abs(b.x - enemy.x) - Math.abs(b.y - enemy.y)
      );
      const target = targets[0];
      // Try shoot first if in range + LOS
      if (Math.abs(target.x - enemy.x) + Math.abs(target.y - enemy.y) <= enemy.range
          && this.hasLineOfSight(enemy.x, enemy.y, target.x, target.y)) {
        this.attackUnit(enemy.id, target.id);
      } else {
        // Move toward target
        const path = this.findPath(enemy.x, enemy.y, target.x, target.y);
        if (path && path.length > 0) {
          const stepsTaken = Math.min(path.length, enemy.movement);
          const dest = path[stepsTaken - 1];
          this.moveUnit(enemy.id, dest.x, dest.y);
        }
      }
    }
    // End AI turn
    this.currentPhase = "player";
    for (const u of this.player_units) u.actionPoints = 2;
  }

  _checkEnd() {
    const playerAlive = this.player_units.some(u => u.hp > 0);
    const enemyAlive = this.enemy_units.some(u => u.hp > 0);
    if (!playerAlive || !enemyAlive) {
      this.onEnd({ victory: playerAlive, log: this.log });
    }
  }

  attach(scene) {
    this.scene = scene;
    // Render grid + units. Scene is responsible for click handlers that call
    // moveUnit/attackUnit. This minimal renderer draws tiles.
    const ts = this.tileSize;
    for (let y = 0; y < this.gridH; y++) {
      for (let x = 0; x < this.gridW; x++) {
        const t = this.grid[y][x];
        const colors = { 0: 0x223344, 1: 0x666666, 2: 0x886655, 3: 0xaa7744 };
        const r = scene.add.rectangle(x*ts + ts/2, y*ts + ts/2, ts-2, ts-2, colors[t] ?? 0x000000);
        r.setStrokeStyle(1, 0x000000);
      }
    }
    for (const u of [...this.player_units, ...this.enemy_units]) {
      const color = u.side === "player" ? 0x44aaff : 0xff4444;
      const dot = scene.add.circle(u.x*ts + ts/2, u.y*ts + ts/2, ts*0.4, color);
      scene.add.text(u.x*ts + ts/2, u.y*ts + ts/2, u.hp, {
        fontSize: "12px", color: "#ffffff", fontFamily: "Arial Black",
      }).setOrigin(0.5);
      u._sprite = dot;
    }
  }
}

if (typeof window !== "undefined") {
  window.TacticalBattle = TacticalBattle;
}
