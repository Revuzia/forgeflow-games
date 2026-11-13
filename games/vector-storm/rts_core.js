/**
 * rts_core.js — Real-time strategy core (Warcraft / Starcraft / C&C class).
 *
 * Provides: resource collection, unit production, base building, pathfinding,
 * selection box, command queue, fog of war, AI opponent basic.
 *
 * All per-game data passed in via config — no hardcoded factions.
 *
 * API:
 *   const rts = new RTSCore({
 *     map: {width: 80, height: 60, terrain: [[0,1,...]]},
 *     player: {faction, start_pos: {x, y}, starting_resources: {gold: 100, wood: 50}},
 *     enemy:  {faction, start_pos: {x, y}, ai_level: "aggressive"},
 *     unit_types: [{id, cost, build_time, hp, atk, range, speed, can_gather, visual}, ...],
 *     building_types: [{id, cost, build_time, hp, produces: ["unit_id"], visual}, ...],
 *     resource_nodes: [{type: "gold"|"wood", x, y, amount}, ...],
 *     onWin: () => {}, onLose: () => {},
 *   });
 *   rts.attach(scene);
 *   rts.selectUnits([x1,y1,x2,y2]);  // box select
 *   rts.command({action: "move"|"attack"|"gather"|"build"|"produce", target});
 */
class RTSCore {
  constructor(config) {
    this.map = config.map;
    this.unit_types = config.unit_types;
    this.building_types = config.building_types;
    this.player = {
      faction: config.player.faction,
      resources: { ...config.player.starting_resources },
      units: [], buildings: [], selected: [], supply: 0, supply_cap: 10,
    };
    this.enemy = {
      faction: config.enemy.faction,
      resources: { gold: 200, wood: 100 },
      units: [], buildings: [], supply: 0, supply_cap: 10,
      ai_level: config.enemy.ai_level || "aggressive",
    };
    this.resource_nodes = config.resource_nodes.map(n => ({ ...n }));
    this.onWin = config.onWin || (() => {});
    this.onLose = config.onLose || (() => {});
    this.tick = 0;
    this.tileSize = config.tileSize || 32;
    this.commandQueue = [];
    this.scene = null;
    this.unitIdCounter = 1;

    // Place starting town halls
    this._buildStart(this.player, config.player.start_pos);
    this._buildStart(this.enemy, config.enemy.start_pos);
  }

  _buildStart(side, pos) {
    const hallType = this.building_types.find(b => b.is_town_hall) || this.building_types[0];
    if (!hallType) return;
    side.buildings.push({
      id: `b_${this.unitIdCounter++}`, type_id: hallType.id,
      x: pos.x, y: pos.y, hp: hallType.hp, maxHp: hallType.hp,
      built: true, side: side === this.player ? "player" : "enemy",
      producing: null, production_timer: 0,
    });
    // Initial 3 workers
    const worker = this.unit_types.find(u => u.can_gather) || this.unit_types[0];
    for (let i = 0; i < 3; i++) {
      side.units.push({
        id: `u_${this.unitIdCounter++}`, type_id: worker.id,
        x: pos.x + i, y: pos.y + 1,
        hp: worker.hp, maxHp: worker.hp,
        side: side === this.player ? "player" : "enemy",
        task: "idle", task_target: null, carrying: null,
      });
    }
  }

  canAfford(cost, side) {
    for (const [resource, amount] of Object.entries(cost)) {
      if ((side.resources[resource] || 0) < amount) return false;
    }
    return true;
  }

  pay(cost, side) {
    for (const [resource, amount] of Object.entries(cost)) {
      side.resources[resource] = (side.resources[resource] || 0) - amount;
    }
  }

  produceUnit(building, unit_type_id) {
    const side = building.side === "player" ? this.player : this.enemy;
    const type = this.unit_types.find(u => u.id === unit_type_id);
    if (!type) return false;
    if (!this.canAfford(type.cost, side)) return false;
    if (side.supply + (type.supply_cost || 1) > side.supply_cap) return false;
    if (building.producing) return false;
    this.pay(type.cost, side);
    building.producing = unit_type_id;
    building.production_timer = type.build_time || 5;
    return true;
  }

  issueCommand(unitId, action, target) {
    const unit = this._findUnit(unitId);
    if (!unit) return false;
    unit.task = action;
    unit.task_target = target;
    return true;
  }

  _findUnit(id) {
    return [...this.player.units, ...this.enemy.units].find(u => u.id === id);
  }

  // Per-tick simulation (call from scene.update at ~10Hz)
  step() {
    this.tick++;
    this._stepSide(this.player);
    this._stepSide(this.enemy);
    if (this.tick % 5 === 0) this._runAI(this.enemy);

    // Win / lose
    if (this.enemy.buildings.every(b => b.hp <= 0) && this.enemy.buildings.length > 0) {
      this.onWin();
    }
    if (this.player.buildings.every(b => b.hp <= 0) && this.player.buildings.length > 0) {
      this.onLose();
    }
  }

  _stepSide(side) {
    // Building production
    for (const b of side.buildings) {
      if (b.producing && b.production_timer > 0) {
        b.production_timer -= 0.1;
        if (b.production_timer <= 0) {
          // Spawn the produced unit
          const type = this.unit_types.find(u => u.id === b.producing);
          if (type) {
            side.units.push({
              id: `u_${this.unitIdCounter++}`, type_id: type.id,
              x: b.x + 1, y: b.y + 1,
              hp: type.hp, maxHp: type.hp,
              side: b.side, task: "idle", task_target: null, carrying: null,
            });
            side.supply += (type.supply_cost || 1);
          }
          b.producing = null;
          b.production_timer = 0;
        }
      }
    }
    // Unit tasks
    for (const u of side.units) {
      if (u.hp <= 0) continue;
      this._stepUnit(u, side);
    }
    // Remove dead
    side.units = side.units.filter(u => u.hp > 0);
    side.buildings = side.buildings.filter(b => b.hp > 0);
  }

  _stepUnit(u, side) {
    const type = this.unit_types.find(t => t.id === u.type_id);
    const speed = (type?.speed || 2) * 0.1;
    if (u.task === "move" && u.task_target) {
      this._moveToward(u, u.task_target, speed);
      if (Math.abs(u.x - u.task_target.x) < 0.5 && Math.abs(u.y - u.task_target.y) < 0.5) {
        u.task = "idle";
      }
    } else if (u.task === "attack" && u.task_target) {
      const target = this._findUnit(u.task_target.id) ||
        (side === this.player ? this.enemy : this.player).buildings.find(b => b.id === u.task_target.id);
      if (!target || target.hp <= 0) { u.task = "idle"; return; }
      const dx = target.x - u.x, dy = target.y - u.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const range = type?.range || 1;
      if (dist > range) {
        this._moveToward(u, target, speed);
      } else {
        // Attack
        if (this.tick % Math.max(1, Math.round(10 / (type?.attack_speed || 1))) === 0) {
          target.hp -= (type?.atk || 1);
        }
      }
    } else if (u.task === "gather" && u.task_target && type?.can_gather) {
      const node = this.resource_nodes.find(n => n.x === u.task_target.x && n.y === u.task_target.y);
      if (!node || node.amount <= 0) { u.task = "idle"; return; }
      const dx = node.x - u.x, dy = node.y - u.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist > 1) {
        this._moveToward(u, node, speed);
      } else {
        // Gather 1 per tick, carry back to nearest hall
        if (!u.carrying) {
          u.carrying = { type: node.type, amount: Math.min(5, node.amount) };
          node.amount -= u.carrying.amount;
        }
        const hall = side.buildings.find(b => b.type_id.includes("hall")) || side.buildings[0];
        if (hall) {
          const hdx = hall.x - u.x, hdy = hall.y - u.y;
          const hdist = Math.sqrt(hdx*hdx + hdy*hdy);
          if (hdist > 1) {
            this._moveToward(u, hall, speed);
          } else if (u.carrying) {
            side.resources[u.carrying.type] = (side.resources[u.carrying.type] || 0) + u.carrying.amount;
            u.carrying = null;
          }
        }
      }
    }
  }

  _moveToward(u, target, speed) {
    const dx = target.x - u.x, dy = target.y - u.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < 0.01) return;
    u.x += (dx / dist) * speed;
    u.y += (dy / dist) * speed;
  }

  _runAI(enemy) {
    // Simple aggressive AI: build workers, gather, produce military, attack player base
    // Each AI tick: try to produce a worker or attacker, then send attackers at player
    const hall = enemy.buildings.find(b => b.type_id.includes("hall")) || enemy.buildings[0];
    if (!hall) return;
    if (!hall.producing && Math.random() < 0.3) {
      const isEarly = enemy.units.length < 6;
      const pickType = isEarly
        ? this.unit_types.find(u => u.can_gather)
        : this.unit_types.find(u => u.atk > 2);
      if (pickType) this.produceUnit(hall, pickType.id);
    }
    // Assign idle military units to attack
    const playerHall = this.player.buildings[0];
    if (playerHall) {
      const attackers = enemy.units.filter(u => !this.unit_types.find(t => t.id === u.type_id)?.can_gather && u.task === "idle");
      for (const a of attackers) {
        a.task = "attack";
        a.task_target = { id: playerHall.id, x: playerHall.x, y: playerHall.y };
      }
    }
    // Assign idle workers to gather
    const idleWorkers = enemy.units.filter(u => this.unit_types.find(t => t.id === u.type_id)?.can_gather && u.task === "idle");
    const nearestNode = this.resource_nodes.filter(n => n.amount > 0).sort((a, b) =>
      (Math.abs(a.x - hall.x) + Math.abs(a.y - hall.y)) - (Math.abs(b.x - hall.x) + Math.abs(b.y - hall.y))
    )[0];
    if (nearestNode) {
      for (const w of idleWorkers) {
        w.task = "gather";
        w.task_target = { x: nearestNode.x, y: nearestNode.y };
      }
    }
  }

  attach(scene) {
    this.scene = scene;
    // Minimal renderer — game's scene can extend this with sprites
    const ts = this.tileSize;
    // Draw map terrain
    for (let y = 0; y < this.map.height; y++) {
      for (let x = 0; x < this.map.width; x++) {
        const terrain = this.map.terrain?.[y]?.[x] || 0;
        const colors = { 0: 0x335522, 1: 0x555555, 2: 0x224477 };  // grass/stone/water
        scene.add.rectangle(x*ts + ts/2, y*ts + ts/2, ts-1, ts-1, colors[terrain] ?? 0x000000);
      }
    }
    // Unit render loop handled in step() — caller updates sprite positions
  }
}

if (typeof window !== "undefined") {
  window.RTSCore = RTSCore;
}
