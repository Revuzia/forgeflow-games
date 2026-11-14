// Falling tiles (sand): when support is removed, the tile becomes a falling entity
// that lands as a tile again. Event-driven via world.onTileChanged — no world scans.

import { TILE, PHYS } from '../config.js';
import { T, TILES } from './world.js';
import { moveEntity } from '../entities/physics.js';

export class FallingTiles {
  constructor(world) {
    this.world = world;
    this.list = [];
    world.onTileChanged.push((tx, ty) => this.checkAbove(tx, ty));
  }

  checkAbove(tx, ty) {
    const { world } = this;
    // if the changed cell is now non-solid, the tile above may fall
    const id = world.tileAt(tx, ty);
    if (id !== T.air && TILES[id].solid) return;
    const aboveId = world.tileAt(tx, ty - 1);
    if (aboveId === T.air || !TILES[aboveId].falls) return;
    world.setTile(tx, ty - 1, T.air);          // triggers cascade check above it
    this.list.push({
      tileId: aboveId,
      x: tx * TILE + 1, y: (ty - 1) * TILE + 1, w: TILE - 2, h: TILE - 2,
      vx: 0, vy: 0.5,
    });
  }

  tick() {
    const { world } = this;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.vy = Math.min(f.vy + PHYS.gravity, PHYS.maxFall);
      const flags = moveEntity(world, f, {});
      if (flags.down) {
        // land: become a tile again at the cell we rest on
        const tx = Math.floor((f.x + f.w / 2) / TILE);
        const ty = Math.floor((f.y + f.h / 2) / TILE);
        this.list.splice(i, 1);
        if (world.tileAt(tx, ty) === T.air) world.setTile(tx, ty, f.tileId);
        else {
          // cell occupied (liquid settled etc.) — try above
          if (world.tileAt(tx, ty - 1) === T.air) world.setTile(tx, ty - 1, f.tileId);
        }
      } else if (f.y > world.h * TILE) {
        this.list.splice(i, 1);
      }
    }
  }

  draw(ctx, camera, alpha, assets) {
    const [ox, oy] = camera.frameOrigin(alpha);
    const z = camera.zoom;
    for (const f of this.list) {
      const info = TILES[f.tileId];
      const tex = assets?.tiles?.[info.name];
      if (tex) ctx.drawImage(tex, 0, 0, 16, 16, (f.x - 1 - ox) * z, (f.y - 1 - oy) * z, TILE * z, TILE * z);
      else { ctx.fillStyle = info.color; ctx.fillRect((f.x - ox) * z, (f.y - oy) * z, f.w * z, f.h * z); }
    }
  }
}
