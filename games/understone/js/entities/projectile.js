// Projectiles: player arrows (gravity arc) + enemy fireballs.
// Model per research 05 §9: {velocity, gravity flag, pierce, lifetime, damage, owner}.

import { TILE } from '../config.js';
import { TILES } from '../world/world.js';

export class Projectiles {
  constructor(world) {
    this.world = world;
    this.list = [];
  }

  // player arrow toward a point
  spawnArrow(x, y, tx, ty, speed, damage, kb, fire = false) {
    const dx = tx - x, dy = ty - y;
    const d = Math.hypot(dx, dy) || 1;
    this.list.push({
      kind: fire ? 'flamingArrow' : 'arrow', owner: 'player',
      x, y, vx: (dx / d) * speed, vy: (dy / d) * speed,
      gravity: 0.07, damage, kb, pierce: 1, life: 600,
      w: 4, h: 4, key: `arrow${Math.random()}`,
    });
  }

  spawnEnemy(kind, x, y, tx, ty, speed, damage) {
    const dx = tx - x, dy = ty - y;
    const d = Math.hypot(dx, dy) || 1;
    this.list.push({
      kind, owner: 'enemy',
      x, y, vx: (dx / d) * speed, vy: (dy / d) * speed,
      gravity: 0, damage, kb: 4, pierce: 1, life: 420,
      w: 8, h: 8, key: `e${Math.random()}`,
    });
  }

  solidAt(px, py) {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    if (!this.world.inBounds(tx, ty)) return true;
    return TILES[this.world.tiles[ty * this.world.w + tx]].solid;
  }

  tick(game) {
    const p = game.player;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const pr = this.list[i];
      pr.life--;
      pr.vy += pr.gravity;
      pr.x += pr.vx; pr.y += pr.vy;
      if (pr.life <= 0 || this.solidAt(pr.x, pr.y)) { this.list.splice(i, 1); continue; }

      if (pr.owner === 'player') {
        for (const e of game.enemies) {
          let hit = false;
          for (const hb of e.hitboxes()) {
            if (pr.x > hb.x && pr.x < hb.x + hb.w && pr.y > hb.y && pr.y < hb.y + hb.h) { hit = true; break; }
          }
          if (hit) {
            const dealt = e.strike(pr.damage, pr.kb, pr.x - pr.vx * 3, pr.key, Math.random() < 0.04);
            if (dealt > 0) {
              game.floatText?.(e.cx, e.y - 8, dealt, '#e8a86d');
              if (--pr.pierce <= 0) { this.list.splice(i, 1); }
            }
            break;
          }
        }
      } else if (!p.dead) {
        if (pr.x > p.px && pr.x < p.px + p.w && pr.y > p.py && pr.y < p.py + p.h) {
          const def = p.getDefense ? p.getDefense() : 0;
          if (p.hurt(Math.max(1, pr.damage - def / 2), pr.x)) this.list.splice(i, 1);
        }
      }
    }
  }

  draw(ctx, camera, alpha) {
    const [ox, oy] = camera.frameOrigin(alpha);
    const z = camera.zoom;
    for (const pr of this.list) {
      const sx = (pr.x - ox) * z, sy = (pr.y - oy) * z;
      if (pr.kind === 'fireball') {
        ctx.fillStyle = '#ff8a3a';
        ctx.beginPath(); ctx.arc(sx, sy, 4 * z, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,200,80,0.5)';
        ctx.beginPath(); ctx.arc(sx - pr.vx * 1.5, sy - pr.vy * 1.5, 3 * z, 0, Math.PI * 2); ctx.fill();
      } else {
        // arrow: short line along velocity
        const d = Math.hypot(pr.vx, pr.vy) || 1;
        ctx.strokeStyle = pr.kind === 'flamingArrow' ? '#ffb45a' : '#d8c8a8';
        ctx.lineWidth = 2 * z;
        ctx.beginPath();
        ctx.moveTo(sx - (pr.vx / d) * 6 * z, sy - (pr.vy / d) * 6 * z);
        ctx.lineTo(sx + (pr.vx / d) * 4 * z, sy + (pr.vy / d) * 4 * z);
        ctx.stroke();
      }
    }
  }
}
