/**
 * shmup_core.js — Shoot-em-up bullet patterns + waves (Gradius, Touhou, Ikaruga).
 * Bullet hell patterns as data — sine, spread, spiral, ring, aimed. Per-game waves in config.
 *
 * API:
 *   const shmup = new ShmupSystem({player, waves, bulletPatterns});
 *   shmup.tick(dt);
 *   shmup.playerFire(type);
 */
class ShmupSystem {
  constructor(cfg = {}) {
    this.player = { x: 400, y: 500, hp: 3, power: 1, bomb: 3, ...(cfg.player || {}) };
    this.playerBullets = []; this.enemyBullets = []; this.enemies = [];
    this.waves = cfg.waves || [];
    this.currentWave = 0; this.waveTimer = 0;
    this.spawnIdx = 0;
    this.score = 0;
  }
  tick(dt) {
    const wave = this.waves[this.currentWave];
    if (wave) {
      this.waveTimer += dt;
      while (this.spawnIdx < wave.spawns.length && this.waveTimer >= wave.spawns[this.spawnIdx].time) {
        const s = wave.spawns[this.spawnIdx];
        this.enemies.push({ x: s.x, y: s.y, hp: s.hp ?? 3, type: s.type ?? "grunt", timer: 0, pattern: s.pattern ?? "straight", vx: 0, vy: 40 });
        this.spawnIdx++;
      }
      if (this.spawnIdx >= wave.spawns.length && this.enemies.length === 0) { this.currentWave++; this.waveTimer = 0; this.spawnIdx = 0; }
    }
    // Enemies movement + firing
    for (const e of this.enemies) {
      e.timer += dt;
      if (e.type === "grunt") { e.y += e.vy * dt; }
      else if (e.type === "zigzag") { e.x += Math.sin(e.timer * 3) * 120 * dt; e.y += 40 * dt; }
      else if (e.type === "boss") { e.x += Math.sin(e.timer) * 60 * dt; }
      // Fire bullet patterns
      if (e.timer % 1.0 < dt) this._fireEnemyPattern(e);
    }
    // Bullets
    this.playerBullets.forEach(b => { b.x += b.vx * dt; b.y += b.vy * dt; });
    this.enemyBullets.forEach(b => { b.x += b.vx * dt; b.y += b.vy * dt; });
    this.playerBullets = this.playerBullets.filter(b => b.y > -20 && b.y < 620 && b.x > -20 && b.x < 820);
    this.enemyBullets = this.enemyBullets.filter(b => b.y > -20 && b.y < 620 && b.x > -20 && b.x < 820);
    // Collisions
    for (const b of this.playerBullets) {
      for (const e of this.enemies) {
        if (Math.hypot(b.x - e.x, b.y - e.y) < 20) { e.hp -= 1; b._dead = true; if (e.hp <= 0) { this.score += e.type === "boss" ? 1000 : 100; e._dead = true; } break; }
      }
    }
    this.playerBullets = this.playerBullets.filter(b => !b._dead);
    this.enemies = this.enemies.filter(e => !e._dead && e.y < 620);
    // Enemy bullets → player
    for (const b of this.enemyBullets) {
      if (Math.hypot(b.x - this.player.x, b.y - this.player.y) < 8) { this.player.hp--; b._dead = true; }
    }
    this.enemyBullets = this.enemyBullets.filter(b => !b._dead);
  }
  playerFire(type = "normal") {
    const p = this.player;
    if (type === "normal") {
      for (let i = 0; i < p.power; i++) {
        const offset = (i - (p.power - 1) / 2) * 14;
        this.playerBullets.push({ x: p.x + offset, y: p.y - 20, vx: 0, vy: -600, damage: 1 });
      }
    } else if (type === "spread") {
      for (let i = -2; i <= 2; i++) this.playerBullets.push({ x: p.x, y: p.y - 20, vx: i * 120, vy: -500, damage: 1 });
    }
  }
  bomb() {
    if (this.player.bomb <= 0) return false;
    this.player.bomb--;
    this.enemyBullets = []; // clear screen
    for (const e of this.enemies) e.hp -= 3;
    return true;
  }
  _fireEnemyPattern(e) {
    const patterns = {
      aimed:  () => { const dx = this.player.x - e.x, dy = this.player.y - e.y; const d = Math.hypot(dx, dy) || 1; this.enemyBullets.push({ x: e.x, y: e.y, vx: dx/d*200, vy: dy/d*200 }); },
      ring:   () => { for (let a = 0; a < 12; a++) { const ang = a * Math.PI / 6; this.enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(ang)*180, vy: Math.sin(ang)*180 }); } },
      spread: () => { for (let i = -2; i <= 2; i++) this.enemyBullets.push({ x: e.x, y: e.y + 10, vx: i*60, vy: 220 }); },
      spiral: () => { const ang = e.timer * 3; this.enemyBullets.push({ x: e.x, y: e.y, vx: Math.cos(ang)*200, vy: Math.sin(ang)*200 }); },
      straight:()=>{ this.enemyBullets.push({ x: e.x, y: e.y + 20, vx: 0, vy: 220 }); },
    };
    (patterns[e.pattern] || patterns.straight)();
  }
}
if (typeof window !== "undefined") window.ShmupSystem = ShmupSystem;
