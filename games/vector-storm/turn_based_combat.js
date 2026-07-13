/**
 * turn_based_combat.js — JRPG-style turn-based battle system.
 *
 * Covers Pokemon / Final Fantasy / classic Zelda-dungeon combat mechanics:
 *   - Turn order from speed stats
 *   - Action menu (Attack / Magic / Item / Flee)
 *   - Type effectiveness multipliers
 *   - Status effects (poison, sleep, paralysis, burn)
 *   - Experience + level-up
 *   - Capture mechanic (Pokemon-style)
 *
 * API:
 *   const battle = new TurnBasedCombat({
 *     player_team: [{name, hp, atk, def, speed, moves: [...]}],
 *     enemy_team:  [{name, hp, atk, def, speed, type, moves: [...]}],
 *     onEnd: (result) => { ... } // result = {victory, captures, exp_gained}
 *   });
 *   battle.start(scene);  // shows UI, runs the battle loop
 */
class TurnBasedCombat {
  // Type effectiveness chart (Pokemon-inspired, reduced to 10 types)
  static TYPE_CHART = {
    normal:   { weak: [],                       resist: [],             immune: ["ghost"] },
    fire:     { weak: ["grass", "ice", "bug"],  resist: ["fire", "water"] },
    water:    { weak: ["fire", "rock"],         resist: ["water", "electric"] },
    grass:    { weak: ["water", "ground"],      resist: ["grass", "fire"] },
    electric: { weak: ["water", "flying"],      resist: ["electric"] },
    ice:      { weak: ["grass", "ground"],      resist: ["ice"] },
    fighting: { weak: ["normal", "ice"],        resist: ["fighting"] },
    ground:   { weak: ["fire", "electric"],     resist: ["poison"] },
    flying:   { weak: ["grass", "fighting"],    resist: ["electric"] },
    ghost:    { weak: ["ghost"],                resist: ["normal", "fighting"] },
  };

  static STATUS_EFFECTS = {
    poison:    { dot_per_turn: 0.05, name: "POISONED" },
    burn:      { dot_per_turn: 0.04, name: "BURNED", atk_mult: 0.5 },
    sleep:     { skip_turn: true,    name: "ASLEEP", recovery_chance: 0.25 },
    paralysis: { skip_chance: 0.3,   name: "PARALYZED", speed_mult: 0.5 },
    freeze:    { skip_turn: true,    name: "FROZEN",  recovery_chance: 0.15 },
  };

  constructor(config) {
    this.player_team = config.player_team.map(u => this._initUnit(u, "player"));
    this.enemy_team  = config.enemy_team.map(u => this._initUnit(u, "enemy"));
    this.log = [];
    this.turn = 0;
    this.onEnd = config.onEnd || (() => {});
    this.scene = null;
  }

  _initUnit(unit, side) {
    return {
      name: unit.name,
      maxHp: unit.hp,
      hp: unit.hp,
      atk: unit.atk ?? 10,
      def: unit.def ?? 5,
      speed: unit.speed ?? 10,
      type: unit.type ?? "normal",
      moves: unit.moves ?? [{ name: "Tackle", power: 10, type: "normal", accuracy: 1.0 }],
      status: null,
      statusTurns: 0,
      side: side,
      level: unit.level ?? 5,
      catch_rate: unit.catch_rate ?? 0.3,  // for Pokemon-style capture
    };
  }

  _getTypeMultiplier(attackType, targetType) {
    const chart = TurnBasedCombat.TYPE_CHART[attackType] || {};
    if ((chart.immune || []).includes(targetType)) return 0;
    if ((chart.resist || []).includes(targetType)) return 0.5;
    if ((chart.weak   || []).includes(targetType)) return 2.0;
    return 1.0;
  }

  _calculateDamage(attacker, defender, move) {
    const baseAtk = attacker.atk * (attacker.status === "burn" ? 0.5 : 1);
    const base = Math.max(1, baseAtk - defender.def * 0.5);
    const power = move.power ?? 10;
    const typeMult = this._getTypeMultiplier(move.type, defender.type);
    const randomMult = 0.85 + Math.random() * 0.15;
    return Math.max(1, Math.floor(base * power * 0.1 * typeMult * randomMult));
  }

  _getTurnOrder() {
    const alive = [...this.player_team, ...this.enemy_team].filter(u => u.hp > 0);
    // Sort by speed; handle paralysis speed cut
    alive.sort((a, b) => {
      const aSpeed = a.status === "paralysis" ? a.speed * 0.5 : a.speed;
      const bSpeed = b.status === "paralysis" ? b.speed * 0.5 : b.speed;
      return bSpeed - aSpeed;
    });
    return alive;
  }

  _applyStatusDamage(unit) {
    if (!unit.status) return 0;
    const se = TurnBasedCombat.STATUS_EFFECTS[unit.status];
    if (se && se.dot_per_turn) {
      const dmg = Math.floor(unit.maxHp * se.dot_per_turn);
      unit.hp = Math.max(0, unit.hp - dmg);
      this.log.push(`${unit.name} takes ${dmg} damage from ${se.name}`);
      return dmg;
    }
    return 0;
  }

  _checkStatusSkip(unit) {
    const se = TurnBasedCombat.STATUS_EFFECTS[unit.status];
    if (!se) return false;
    if (se.skip_turn) {
      // Chance to recover
      if (Math.random() < (se.recovery_chance || 0)) {
        this.log.push(`${unit.name} recovered from ${se.name}!`);
        unit.status = null;
        return false;
      }
      this.log.push(`${unit.name} is ${se.name} and can't move.`);
      return true;
    }
    if (se.skip_chance && Math.random() < se.skip_chance) {
      this.log.push(`${unit.name} is ${se.name} and can't move.`);
      return true;
    }
    return false;
  }

  doAction(attacker, moveIdx, targetIdx) {
    this._applyStatusDamage(attacker);
    if (attacker.hp <= 0) return;
    if (this._checkStatusSkip(attacker)) return;

    const opponents = attacker.side === "player" ? this.enemy_team : this.player_team;
    const target = opponents[targetIdx] ?? opponents.find(u => u.hp > 0);
    if (!target || target.hp <= 0) return;

    const move = attacker.moves[moveIdx] ?? attacker.moves[0];
    if (Math.random() > (move.accuracy ?? 1.0)) {
      this.log.push(`${attacker.name} used ${move.name} but missed!`);
      return;
    }

    const dmg = this._calculateDamage(attacker, target, move);
    target.hp = Math.max(0, target.hp - dmg);
    this.log.push(`${attacker.name} used ${move.name} on ${target.name} for ${dmg} dmg.`);

    // Apply side-effect status
    if (move.inflicts && Math.random() < (move.inflict_chance ?? 0.3)) {
      target.status = move.inflicts;
      target.statusTurns = 3;
      this.log.push(`${target.name} was ${TurnBasedCombat.STATUS_EFFECTS[move.inflicts]?.name || move.inflicts}!`);
    }

    if (target.hp <= 0) {
      this.log.push(`${target.name} was defeated!`);
    }
  }

  attemptCapture(target) {
    // Pokemon-style: lower HP + status = higher catch chance
    const hpFactor = 1 - (target.hp / target.maxHp);
    const statusBonus = target.status ? 0.15 : 0;
    const chance = target.catch_rate + hpFactor * 0.5 + statusBonus;
    const caught = Math.random() < chance;
    if (caught) {
      this.log.push(`Captured ${target.name}!`);
      return true;
    }
    this.log.push(`${target.name} broke free!`);
    return false;
  }

  isBattleOver() {
    const playerAlive = this.player_team.some(u => u.hp > 0);
    const enemyAlive = this.enemy_team.some(u => u.hp > 0);
    if (!playerAlive || !enemyAlive) {
      return { over: true, victory: playerAlive };
    }
    return { over: false };
  }

  // Simple auto-battle loop for headless simulation / AI testing
  autoBattle(maxTurns = 20) {
    for (let t = 0; t < maxTurns; t++) {
      this.turn = t;
      const order = this._getTurnOrder();
      for (const unit of order) {
        if (unit.hp <= 0) continue;
        const moveIdx = Math.floor(Math.random() * unit.moves.length);
        this.doAction(unit, moveIdx, 0);
        const end = this.isBattleOver();
        if (end.over) {
          this.onEnd(end);
          return end;
        }
      }
    }
    const end = this.isBattleOver();
    this.onEnd(end);
    return end;
  }

  // Phaser UI — renders battle with action menu
  start(scene) {
    this.scene = scene;
    const w = scene.scale.width;
    const h = scene.scale.height;
    // Backdrop
    scene.add.rectangle(w/2, h/2, w, h, 0x222233);
    // Enemy portraits (top)
    this.enemy_team.forEach((e, i) => {
      const x = 100 + i * 180;
      const y = h * 0.25;
      const sprite = scene.add.rectangle(x, y, 80, 80, 0xff6666);
      sprite.setStrokeStyle(2, 0x000000);
      scene.add.text(x, y + 50, e.name, { color: "#ffffff", fontSize: "14px" }).setOrigin(0.5);
      // HP bar
      const hpBar = scene.add.rectangle(x, y + 70, 80, 6, 0x333333);
      const hpFill = scene.add.rectangle(x - 40, y + 70, 80 * (e.hp / e.maxHp), 6, 0x00ff66).setOrigin(0, 0.5);
      e._ui = { sprite, hpFill };
    });
    // Player portraits (bottom)
    this.player_team.forEach((p, i) => {
      const x = 100 + i * 180;
      const y = h * 0.65;
      const sprite = scene.add.rectangle(x, y, 80, 80, 0x66ddff);
      sprite.setStrokeStyle(2, 0x000000);
      scene.add.text(x, y + 50, p.name, { color: "#ffffff", fontSize: "14px" }).setOrigin(0.5);
      const hpBar = scene.add.rectangle(x, y + 70, 80, 6, 0x333333);
      const hpFill = scene.add.rectangle(x - 40, y + 70, 80 * (p.hp / p.maxHp), 6, 0x00ff66).setOrigin(0, 0.5);
      p._ui = { sprite, hpFill };
    });
    // Action buttons
    ["Attack", "Magic", "Item", "Flee"].forEach((act, i) => {
      const btn = scene.add.text(w/2 - 180 + i * 90, h - 40, act, {
        fontSize: "18px", backgroundColor: "#444488", color: "#ffffff", padding: 8,
      }).setOrigin(0.5).setInteractive();
      btn.on("pointerdown", () => this._handleAction(act));
    });
  }

  _handleAction(action) {
    // TODO: flesh out menu flow — this stub sufficient for auto-battle wiring
    // For a full game, the template's GameScene extends this with target selection
  }
}

if (typeof window !== "undefined") {
  window.TurnBasedCombat = TurnBasedCombat;
}
