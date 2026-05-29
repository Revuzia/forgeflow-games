/**
 * FFG runtime — sim/turn_based_combat.js
 * Pure simulation for JRPG / monster-catcher turn battles (Pokemon / FF / classic
 * Zelda-dungeon combat). NO rendering. Deterministic with a seeded rng so the
 * signature gate can headlessly assert: turn order by speed, type effectiveness,
 * status DoT, and a battle that actually resolves to victory/defeat.
 *
 * Dual export: Node require() and browser window.FFG.sim.TurnBasedCombat.
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

  var TYPE_CHART = {
    normal: { weak: [], resist: [], immune: ["ghost"] },
    fire: { weak: ["grass", "ice", "bug"], resist: ["fire", "water"] },
    water: { weak: ["fire", "rock"], resist: ["water", "electric"] },
    grass: { weak: ["water", "ground"], resist: ["grass", "fire"] },
    electric: { weak: ["water", "flying"], resist: ["electric"] },
    ice: { weak: ["grass", "ground"], resist: ["ice"] },
    fighting: { weak: ["normal", "ice"], resist: ["fighting"] },
    ground: { weak: ["fire", "electric"], resist: ["poison"] },
    flying: { weak: ["grass", "fighting"], resist: ["electric"] },
    ghost: { weak: ["ghost"], resist: ["normal", "fighting"] },
  };

  var STATUS = {
    poison: { dot: 0.05, name: "POISONED" },
    burn: { dot: 0.04, name: "BURNED", atkMult: 0.5 },
    sleep: { skip: true, name: "ASLEEP", recover: 0.25 },
    paralysis: { skipChance: 0.3, name: "PARALYZED", speedMult: 0.5 },
    freeze: { skip: true, name: "FROZEN", recover: 0.15 },
  };

  class TurnBasedCombat {
    constructor(config) {
      this.rng = config.rng || (typeof config.seed === "number" ? mulberry32(config.seed) : Math.random);
      this.player_team = (config.player_team || []).map((u) => this._init(u, "player"));
      this.enemy_team = (config.enemy_team || []).map((u) => this._init(u, "enemy"));
      this.log = [];
      this.turn = 0;
      this.ended = false;
      this.onEvent = config.onEvent || function () {};
      this.onEnd = config.onEnd || function () {};
    }
    _init(u, side) {
      return {
        name: u.name, maxHp: u.hp, hp: u.hp,
        atk: u.atk != null ? u.atk : 10, def: u.def != null ? u.def : 5,
        speed: u.speed != null ? u.speed : 10, type: u.type || "normal",
        moves: u.moves || [{ name: "Strike", power: 10, type: "normal", accuracy: 1.0 }],
        status: null, statusTurns: 0, side: side, level: u.level || 5,
      };
    }
    _typeMult(atkType, defType) {
      var c = TYPE_CHART[atkType] || {};
      if ((c.immune || []).indexOf(defType) >= 0) return 0;
      if ((c.resist || []).indexOf(defType) >= 0) return 0.5;
      if ((c.weak || []).indexOf(defType) >= 0) return 2.0;
      return 1.0;
    }
    _damage(a, d, move) {
      var baseAtk = a.atk * (a.status === "burn" ? 0.5 : 1);
      var base = Math.max(1, baseAtk - d.def * 0.5);
      var mult = this._typeMult(move.type, d.type);
      var rnd = 0.85 + this.rng() * 0.15;
      return Math.max(1, Math.floor(base * (move.power || 10) * 0.1 * mult * rnd));
    }
    turnOrder() {
      return [].concat(this.player_team, this.enemy_team).filter((u) => u.hp > 0).sort((a, b) => {
        var as = a.status === "paralysis" ? a.speed * 0.5 : a.speed;
        var bs = b.status === "paralysis" ? b.speed * 0.5 : b.speed;
        return bs - as;
      });
    }
    doAction(attacker, moveIdx, targetIdx) {
      if (attacker.status && STATUS[attacker.status] && STATUS[attacker.status].dot) {
        var dot = Math.floor(attacker.maxHp * STATUS[attacker.status].dot);
        attacker.hp = Math.max(0, attacker.hp - dot);
        this.log.push(attacker.name + " takes " + dot + " from " + STATUS[attacker.status].name);
      }
      if (attacker.hp <= 0) return;
      var opp = attacker.side === "player" ? this.enemy_team : this.player_team;
      var target = opp[targetIdx] || opp.find((u) => u.hp > 0);
      if (!target || target.hp <= 0) return;
      var move = attacker.moves[moveIdx] || attacker.moves[0];
      if (this.rng() > (move.accuracy != null ? move.accuracy : 1.0)) {
        this.log.push(attacker.name + " used " + move.name + " — missed!");
        this.onEvent("miss", { attacker: attacker, target: target, move: move });
        return;
      }
      var dmg = this._damage(attacker, target, move);
      target.hp = Math.max(0, target.hp - dmg);
      this.log.push(attacker.name + " used " + move.name + " on " + target.name + " for " + dmg);
      this.onEvent("hit", { attacker: attacker, target: target, move: move, damage: dmg, killed: target.hp <= 0 });
      if (move.inflicts && this.rng() < (move.inflict_chance || 0.3)) { target.status = move.inflicts; target.statusTurns = 3; }
    }
    isOver() {
      var p = this.player_team.some((u) => u.hp > 0);
      var e = this.enemy_team.some((u) => u.hp > 0);
      if (!p || !e) return { over: true, victory: p };
      return { over: false };
    }
    // Headless resolution for the signature gate.
    autoBattle(maxTurns) {
      maxTurns = maxTurns || 30;
      for (var t = 0; t < maxTurns; t++) {
        this.turn = t;
        var order = this.turnOrder();
        for (var i = 0; i < order.length; i++) {
          var u = order[i];
          if (u.hp <= 0) continue;
          this.doAction(u, Math.floor(this.rng() * u.moves.length), 0);
          var end = this.isOver();
          if (end.over) { this.ended = true; this.onEnd(end); return end; }
        }
      }
      var fin = this.isOver(); this.ended = true; this.onEnd(fin); return fin;
    }
  }

  var api = { TurnBasedCombat: TurnBasedCombat, TYPE_CHART: TYPE_CHART, mulberry32: mulberry32 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FFG = root.FFG || {};
  root.FFG.sim = root.FFG.sim || {};
  root.FFG.sim.TurnBasedCombat = TurnBasedCombat;
})(typeof window !== "undefined" ? window : globalThis);
