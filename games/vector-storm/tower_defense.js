/**
 * tower_defense.js — TD core (Bloons / Kingdom Rush / Plants vs Zombies class).
 * Waves + path + tower placement + upgrades. Per-game map + towers in config.
 *
 * API:
 *   const td = new TowerDefense({path, towerTypes, waves, startGold});
 *   td.placeTower(x, y, typeId);
 *   td.tick(dt);
 */
class TowerDefense {
  constructor(cfg) {
    this.path = cfg.path || [];     // array of {x, y}
    this.towerTypes = cfg.towerTypes || DEFAULT_TOWER_TYPES;
    this.waves = cfg.waves || [];
    this.gold = cfg.startGold ?? 100;
    this.lives = cfg.startLives ?? 20;
    this.wave = 0; this.enemies = []; this.towers = []; this.projectiles = [];
    this.waveSpawnTimer = 0; this.enemySpawnCount = 0;
    this.active = false;
  }
  placeTower(x, y, typeId) {
    const t = this.towerTypes.find(tt => tt.id === typeId);
    if (!t || this.gold < t.cost) return false;
    // Ensure not on path
    for (const p of this.path) if (Math.hypot(p.x - x, p.y - y) < 30) return false;
    this.gold -= t.cost;
    this.towers.push({ id: `t_${Date.now()}_${Math.random()}`, x, y, type: t, level: 1, cooldown: 0, kills: 0 });
    return true;
  }
  startWave() {
    if (this.wave >= this.waves.length) return false;
    this.active = true;
    this.enemySpawnCount = 0;
    return true;
  }
  tick(dt) {
    if (!this.active) return;
    // Spawn enemies
    const wave = this.waves[this.wave];
    if (!wave) return;
    this.waveSpawnTimer -= dt;
    if (this.waveSpawnTimer <= 0 && this.enemySpawnCount < wave.count) {
      const etype = wave.enemyType || { hp: 10, speed: 40, reward: 2 };
      this.enemies.push({
        x: this.path[0].x, y: this.path[0].y, hp: etype.hp, maxHp: etype.hp,
        speed: etype.speed, reward: etype.reward, pathIdx: 0, type: etype,
      });
      this.enemySpawnCount++;
      this.waveSpawnTimer = wave.interval || 1.0;
    }
    // Move enemies
    for (const e of this.enemies) {
      const target = this.path[e.pathIdx + 1];
      if (!target) { this.lives--; e.hp = 0; continue; }
      const dx = target.x - e.x, dy = target.y - e.y;
      const d = Math.hypot(dx, dy);
      if (d < 2) { e.pathIdx++; continue; }
      e.x += (dx / d) * e.speed * dt;
      e.y += (dy / d) * e.speed * dt;
    }
    this.enemies = this.enemies.filter(e => e.hp > 0);
    // Towers fire
    for (const tw of this.towers) {
      tw.cooldown -= dt;
      if (tw.cooldown > 0) continue;
      const inRange = this.enemies.filter(e => Math.hypot(e.x - tw.x, e.y - tw.y) < tw.type.range);
      if (!inRange.length) continue;
      const target = inRange[0];
      this.projectiles.push({ x: tw.x, y: tw.y, tx: target.x, ty: target.y, speed: 300, damage: tw.type.damage, target });
      tw.cooldown = 1.0 / (tw.type.fireRate || 1);
    }
    // Projectile motion + hit
    for (const p of this.projectiles) {
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = Math.hypot(dx, dy);
      if (d < 6) { p.target.hp -= p.damage; if (p.target.hp <= 0) this.gold += p.target.reward; p._done = true; continue; }
      p.x += (dx / d) * p.speed * dt; p.y += (dy / d) * p.speed * dt;
    }
    this.projectiles = this.projectiles.filter(p => !p._done);
    // Wave complete
    if (this.enemySpawnCount >= wave.count && this.enemies.length === 0) {
      this.wave++; this.active = false;
      this.gold += wave.bonusGold || 50;
    }
  }
  isGameOver() { return this.lives <= 0; }
  isVictory() { return this.wave >= this.waves.length && this.enemies.length === 0; }
}
const DEFAULT_TOWER_TYPES = [
  { id: "archer",  cost: 50,  damage: 5,  range: 120, fireRate: 1.5 },
  { id: "cannon",  cost: 100, damage: 20, range: 100, fireRate: 0.6 },
  { id: "mage",    cost: 150, damage: 12, range: 180, fireRate: 1.0 },
  { id: "freeze",  cost: 80,  damage: 2,  range: 100, fireRate: 2.0, slow: 0.5 },
];
if (typeof window !== "undefined") { window.TowerDefense = TowerDefense; window.DEFAULT_TOWER_TYPES = DEFAULT_TOWER_TYPES; }
