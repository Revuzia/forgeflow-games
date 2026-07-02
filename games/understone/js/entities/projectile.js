// Projectiles: player arrows (gravity arc) + enemy fireballs.
// Model per research 05 §9: {velocity, gravity flag, pierce, lifetime, damage, owner}.

import { TILE } from '../config.js';
import { TILES } from '../world/world.js';
import { K } from '../render/fx.js';

export class Projectiles {
  constructor(world) {
    this.world = world;
    this.list = [];
  }

  // player arrow toward a point
  spawnArrow(x, y, tx, ty, speed, damage, kb, element = null, proc = null) {
    const dx = tx - x, dy = ty - y;
    const d = Math.hypot(dx, dy) || 1;
    this.list.push({
      kind: element === 'fire' ? 'flamingArrow' : 'arrow', owner: 'player', element, proc,
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
      // elemental flight trails
      if (pr.element && game.fx) {
        if (pr.element === 'fire') game.fx.fireTrail(pr.x, pr.y, Math.sign(pr.vx));
        else if (pr.element === 'ice' && (pr.life & 1)) game.fx.spawn(K.FROST, pr.x, pr.y, 0, 0, 10, 1);
        else if (pr.element === 'lightning' && Math.random() < 0.3) game.fx.sparks(pr.x, pr.y, '#cfd8ff', 1);
        else if (pr.element === 'shadow') game.fx.shadowWisp(pr.x, pr.y);
      }

      if (pr.owner === 'player') {
        for (const e of game.enemies) {
          let hit = false;
          for (const hb of e.hitboxes()) {
            if (pr.x > hb.x && pr.x < hb.x + hb.w && pr.y > hb.y && pr.y < hb.y + hb.h) { hit = true; break; }
          }
          if (hit) {
            const crit = Math.random() < 0.04;
            const result = e.strike(pr.damage, pr.kb, pr.x - pr.vx * 3, pr.key, crit, pr.element);
            game.combat?.hitFeedback(game, e, result, crit, pr.element, pr.proc);
            if (result !== 0 && result !== 'dodge') {
              if (--pr.pierce <= 0) { this.list.splice(i, 1); }
            }
            break;
          }
        }
      } else if (!p.dead) {
        if (pr.x > p.px && pr.x < p.px + p.w && pr.y > p.py && pr.y < p.py + p.h) {
          const def = p.getDefense ? p.getDefense() : 0;
          if (p.hurt(Math.max(1, pr.damage - Math.ceil(def / 2)), pr.x)) {
            if (pr.kind === 'stinger') p.poisonTicks = Math.max(p.poisonTicks ?? 0, 600); // Poisoned 10s
            this.list.splice(i, 1);
          }
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
      } else if (pr.kind === 'stinger') {
        const d = Math.hypot(pr.vx, pr.vy) || 1;
        ctx.strokeStyle = '#a8d43a';
        ctx.lineWidth = 2 * z;
        ctx.beginPath();
        ctx.moveTo(sx - (pr.vx / d) * 4 * z, sy - (pr.vy / d) * 4 * z);
        ctx.lineTo(sx + (pr.vx / d) * 3 * z, sy + (pr.vy / d) * 3 * z);
        ctx.stroke();
      } else if (pr.kind === 'sand') {
        ctx.fillStyle = '#d9c07a';
        ctx.fillRect(sx - 2 * z, sy - 2 * z, 4 * z, 4 * z);
        ctx.fillStyle = 'rgba(217,192,122,0.4)';
        ctx.fillRect(sx - pr.vx * 1.2 - z, sy - pr.vy * 1.2 - z, 2 * z, 2 * z);
      } else if (pr.kind === 'scythe') {
        // spinning purple crescent
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(pr.life * 0.3);
        ctx.strokeStyle = '#b968ff';
        ctx.lineWidth = 2.5 * z;
        ctx.beginPath(); ctx.arc(0, 0, 5 * z, 0.4, Math.PI * 1.4); ctx.stroke();
        ctx.strokeStyle = '#efe0ff';
        ctx.lineWidth = 1 * z;
        ctx.beginPath(); ctx.arc(0, 0, 5 * z, 0.6, Math.PI * 1.2); ctx.stroke();
        ctx.restore();
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
