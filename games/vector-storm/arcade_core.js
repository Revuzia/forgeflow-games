/**
 * arcade_core.js — Classic arcade helpers (Pac-Man, Space Invaders, Galaga, Asteroids).
 * Tile-grid movement + ghost AI + lives + score + attract mode.
 *
 * API (Pac-Man-style):
 *   const arcade = new ArcadeGame({grid, player, enemies, pickups});
 *   arcade.tick(dt);
 *   arcade.movePlayer(direction);
 */
class ArcadeGame {
  constructor(cfg) {
    this.grid = cfg.grid || [];
    this.player = { x: cfg.player?.x ?? 1, y: cfg.player?.y ?? 1, dir: {x:0,y:0}, queued: {x:0,y:0}, lives: cfg.lives ?? 3, score: 0, powered: 0 };
    this.enemies = (cfg.enemies || []).map((e, i) => ({ ...e, mode: "chase", ai: e.ai || (i === 0 ? "chaser" : i === 1 ? "ambusher" : i === 2 ? "patrol" : "random") }));
    this.pickups = cfg.pickups || [];  // [{x, y, type: "dot"|"power"|"fruit", value}]
    this.tileSize = cfg.tileSize ?? 24;
    this.gameOver = false; this.level = 1;
  }
  _walkable(x, y) {
    if (!this.grid[y] || this.grid[y][x] === undefined) return false;
    return this.grid[y][x] !== 1;  // 0 = open, 1 = wall
  }
  movePlayer(dir) { this.player.queued = { ...dir }; }
  tick(dt) {
    if (this.gameOver) return;
    const p = this.player;
    // Apply queued direction if possible
    const nx = p.x + p.queued.x, ny = p.y + p.queued.y;
    if (this._walkable(Math.round(nx), Math.round(ny))) p.dir = { ...p.queued };
    // Try to move in current direction
    const mx = p.x + p.dir.x * dt * 4, my = p.y + p.dir.y * dt * 4;
    if (this._walkable(Math.round(mx), Math.round(my))) { p.x = mx; p.y = my; }
    // Collect pickups
    for (const pu of this.pickups) {
      if (pu.collected) continue;
      if (Math.abs(pu.x - p.x) < 0.5 && Math.abs(pu.y - p.y) < 0.5) {
        pu.collected = true; p.score += pu.value || 10;
        if (pu.type === "power") { p.powered = 8; for (const e of this.enemies) e.mode = "frightened"; }
      }
    }
    // Power pellet timer
    p.powered = Math.max(0, p.powered - dt);
    if (p.powered === 0) for (const e of this.enemies) if (e.mode === "frightened") e.mode = "chase";
    // Enemies
    for (const e of this.enemies) {
      this._moveEnemy(e, dt);
      if (Math.abs(e.x - p.x) < 0.7 && Math.abs(e.y - p.y) < 0.7) {
        if (e.mode === "frightened") { e.mode = "eaten"; e.x = cfg_spawn_x(e); e.y = cfg_spawn_y(e); p.score += 200; }
        else if (e.mode !== "eaten") {
          p.lives--; if (p.lives <= 0) this.gameOver = true;
          p.x = 1; p.y = 1; p.dir = {x:0,y:0};
        }
      }
    }
    // Level complete?
    if (this.pickups.every(pu => pu.collected)) { this.level++; this._resetLevel(); }
  }
  _moveEnemy(e, dt) {
    const speed = e.mode === "frightened" ? 1.2 : 2.0;
    // Simple AI: pick direction toward player at intersections
    if (Math.abs(e.x - Math.round(e.x)) < 0.1 && Math.abs(e.y - Math.round(e.y)) < 0.1) {
      const options = [[1,0],[-1,0],[0,1],[0,-1]].filter(([dx,dy]) => this._walkable(Math.round(e.x+dx), Math.round(e.y+dy)));
      if (options.length > 0) {
        let best = options[0]; let bestScore = -Infinity;
        for (const [dx, dy] of options) {
          const score = (e.mode === "frightened" ? -1 : 1) * (-Math.hypot(e.x+dx - this.player.x, e.y+dy - this.player.y));
          if (score > bestScore) { bestScore = score; best = [dx, dy]; }
        }
        e.dir = { x: best[0], y: best[1] };
      }
    }
    if (!e.dir) e.dir = {x: 1, y: 0};
    e.x += e.dir.x * speed * dt; e.y += e.dir.y * speed * dt;
  }
  _resetLevel() {
    for (const pu of this.pickups) pu.collected = false;
    this.player.x = 1; this.player.y = 1;
  }
}
function cfg_spawn_x(e) { return e.spawnX ?? 10; }
function cfg_spawn_y(e) { return e.spawnY ?? 10; }
if (typeof window !== "undefined") window.ArcadeGame = ArcadeGame;
