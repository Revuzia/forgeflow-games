// World item drops: physics-simulated pickups with magnet attraction.
// Terraria feel: items pop out with a small random velocity, settle on ground,
// fly to the player when close (grab range ~2.5 tiles after a short delay).

import { TILE, PHYS } from '../config.js';
import { moveEntity } from './physics.js';
import { ITEMS } from '../items/items.js';

const GRAB_RANGE = 2.5 * TILE;
const MAGNET_SPEED = 5;
const PICKUP_DELAY = 30;     // ticks before it can be grabbed
const LIFETIME = 60 * 60 * 5; // 5 min despawn

export class Drops {
  constructor(world) {
    this.world = world;
    this.items = [];
    this.onPickup = [];       // fn(itemId, count)
  }

  spawn(itemId, count, px, py, burst = true) {
    if (!ITEMS[itemId] || count <= 0) return;
    this.items.push({
      id: itemId, count,
      x: px - 6, y: py - 6, w: 12, h: 12,
      vx: burst ? (Math.random() - 0.5) * 3 : 0,
      vy: burst ? -2 - Math.random() * 1.5 : 0,
      age: 0,
    });
  }

  // spawn from a dug tile (top-left tile px coords)
  spawnFromTile(tx, ty, itemId, count = 1) {
    this.spawn(itemId, count, tx * TILE + TILE / 2, ty * TILE + TILE / 2);
  }

  tick(player, inventory) {
    const { world } = this;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i];
      d.age++;
      if (d.age > LIFETIME) { this.items.splice(i, 1); continue; }

      const dx = (player.x) - (d.x + d.w / 2);
      const dy = (player.y) - (d.y + d.h / 2);
      const dist = Math.hypot(dx, dy);

      if (!player.dead && d.age > PICKUP_DELAY && dist < GRAB_RANGE) {
        // magnet toward player
        d.vx = (dx / dist) * MAGNET_SPEED;
        d.vy = (dy / dist) * MAGNET_SPEED;
        d.x += d.vx; d.y += d.vy;             // no tile collision while magneting
        if (dist < 14) {
          const leftover = inventory.add(d.id, d.count);
          if (leftover === 0) {
            for (const fn of this.onPickup) fn(d.id, d.count);
            this.items.splice(i, 1);
          } else d.count = leftover;
        }
        continue;
      }

      // normal physics
      d.vy = Math.min(d.vy + PHYS.gravity * 0.7, 7);
      if (Math.abs(d.vx) > 0.02) d.vx *= 0.98; else d.vx = 0;
      moveEntity(world, d, {});
    }
  }

  draw(ctx, camera, alpha) {
    const [ox, oy] = camera.frameOrigin(alpha);
    const z = camera.zoom;
    for (const d of this.items) {
      const sx = (d.x - ox) * z, sy = (d.y - oy) * z;
      const def = ITEMS[d.id];
      // placeholder icon: block items use tile swatch, others a small badge (art pass M7)
      ctx.fillStyle = def.iconColor ?? '#d8c878';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      const bob = Math.sin((d.age + d.x) * 0.05) * 1.5 * z;
      ctx.fillRect(sx, sy + bob, d.w * z, d.h * z);
      ctx.strokeRect(sx + 0.5, sy + bob + 0.5, d.w * z, d.h * z);
      if (d.count > 1) {
        ctx.fillStyle = '#fff';
        ctx.font = `${9 * z}px monospace`;
        ctx.fillText(d.count, sx + 1, sy + bob - 2);
      }
    }
  }
}
