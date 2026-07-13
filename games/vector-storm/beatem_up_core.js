/**
 * beatem_up_core.js — 2D brawler (Streets of Rage, Final Fight, River City).
 * 2.5D plane movement + combo attacks + enemy waves.
 *
 * API:
 *   const bu = new BeatemUpSystem({player, enemyTypes});
 *   bu.update(dt, input);
 *   bu.spawnWave(enemies);
 */
class BeatemUpSystem {
  constructor(cfg) {
    this.player = this._initUnit(cfg.player || { x: 100, y: 200, hp: 100 }, true);
    this.enemies = [];
    this.enemyTypes = cfg.enemyTypes || DEFAULT_BU_ENEMIES;
    this.combos = cfg.combos || { punch: ["jab", "jab", "kick"], special: ["jump", "kick"] };
    this.comboBuffer = [];
    this.comboTimer = 0;
    this.score = 0;
  }
  _initUnit(u, isPlayer = false) {
    return { ...u, vx: 0, vy: 0, facing: 1, state: "idle", stateTimer: 0, attackCooldown: 0, isPlayer, comboHits: 0 };
  }
  spawnWave(specs) {
    for (const s of specs) this.enemies.push(this._initUnit({ ...s }, false));
  }
  update(dt, input) {
    // Player input
    const p = this.player;
    if (p.state === "attack" || p.state === "hitstun") {
      p.stateTimer -= dt;
      if (p.stateTimer <= 0) p.state = "idle";
    } else {
      p.vx = (input.h || 0) * 140; p.vy = (input.v || 0) * 80;
      if (input.attack && p.attackCooldown <= 0) {
        p.state = "attack"; p.stateTimer = 0.25; p.attackCooldown = 0.35;
        this.comboBuffer.push("jab"); this.comboTimer = 0.6;
        this._applyHit(p, 12);
      }
      if (input.kick && p.attackCooldown <= 0) {
        p.state = "attack"; p.stateTimer = 0.3; p.attackCooldown = 0.4;
        this.comboBuffer.push("kick"); this.comboTimer = 0.6;
        this._applyHit(p, 18);
      }
      if (input.jump && p.stateTimer <= 0) { p.state = "jump"; p.stateTimer = 0.6; p.comboHits = 0; }
    }
    p.attackCooldown = Math.max(0, p.attackCooldown - dt);
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (Math.abs(p.vx) > 0.01) p.facing = Math.sign(p.vx);
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.comboBuffer = [];
    // Enemy AI + attacks
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      if (e.state === "hitstun") { e.stateTimer -= dt; if (e.stateTimer <= 0) e.state = "idle"; continue; }
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
      if (d > 40) {
        e.vx = Math.sign(dx) * (e.speed || 60);
        e.vy = Math.sign(dy) * (e.speed || 60) * 0.6;
      } else { e.vx = 0; e.vy = 0;
        if (e.attackCooldown <= 0 && p.state !== "hitstun") {
          p.hp -= e.damage || 8; p.state = "hitstun"; p.stateTimer = 0.3; e.attackCooldown = 1.5;
        }
      }
      e.attackCooldown = Math.max(0, (e.attackCooldown || 0) - dt);
      e.x += e.vx * dt; e.y += e.vy * dt;
    }
    this.enemies = this.enemies.filter(e => e.hp > 0);
  }
  _applyHit(attacker, baseDamage) {
    const hitboxX = attacker.x + attacker.facing * 40;
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      if (Math.hypot(e.x - hitboxX, e.y - attacker.y) < 40) {
        let dmg = baseDamage;
        // Combo matches the special?
        if (this.comboBuffer.slice(-this.combos.special.length).join(",") === this.combos.special.join(",")) dmg *= 2.5;
        e.hp -= dmg; e.state = "hitstun"; e.stateTimer = 0.25;
        attacker.comboHits++;
        this.score += Math.floor(dmg * (1 + attacker.comboHits * 0.1));
        if (e.hp <= 0) this.score += 50;
      }
    }
  }
}
const DEFAULT_BU_ENEMIES = [
  { id: "punk",   hp: 30,  speed: 60,  damage: 8 },
  { id: "brute",  hp: 80,  speed: 30,  damage: 16 },
  { id: "ninja",  hp: 40,  speed: 110, damage: 10 },
  { id: "boss",   hp: 240, speed: 50,  damage: 22 },
];
if (typeof window !== "undefined") { window.BeatemUpSystem = BeatemUpSystem; window.DEFAULT_BU_ENEMIES = DEFAULT_BU_ENEMIES; }
