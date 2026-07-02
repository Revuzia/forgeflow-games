// Chunked tile renderer.
// Each 32x32-tile chunk renders into an offscreen canvas once, then blits per frame.
// A chunk re-renders only when world.dirty contains its key or lighting there changed.
// M1: tiles draw as palette swatches + simple edge shading; M7 swaps in autotile sheets
// via drawTile() without touching the chunk machinery.

import { TILE, CHUNK } from '../config.js';
import { TILES, WALLS, T } from '../world/world.js';

const chunkKey = (cx, cy) => cy * 4096 + cx;

export class TileRenderer {
  constructor(world) {
    this.world = world;
    this.chunks = new Map();  // key → {canvas, ctx}
    this.cw = Math.ceil(world.w / CHUNK);
    this.ch = Math.ceil(world.h / CHUNK);
    this.drawTileHook = null; // (ctx, tx, ty, tileInfo, px, py) — art pass replaces default
    this.drawWallHook = null; // (ctx, tx, ty, wallInfo, px, py)
    this.lightSampler = null; // (tx, ty) → [r,g,b] 0-1 — wired by lighting module
  }

  getChunk(cx, cy) {
    const key = chunkKey(cx, cy);
    let c = this.chunks.get(key);
    if (!c) {
      const canvas = document.createElement('canvas');
      canvas.width = CHUNK * TILE;
      canvas.height = CHUNK * TILE;
      c = { canvas, ctx: canvas.getContext('2d'), rendered: false };
      this.chunks.set(key, c);
    }
    return c;
  }

  renderChunk(cx, cy) {
    const { world } = this;
    const c = this.getChunk(cx, cy);
    const ctx = c.ctx;
    ctx.clearRect(0, 0, CHUNK * TILE, CHUNK * TILE);
    const tx0 = cx * CHUNK, ty0 = cy * CHUNK;
    for (let dy = 0; dy < CHUNK; dy++) {
      const ty = ty0 + dy;
      if (ty >= world.h) break;
      for (let dx = 0; dx < CHUNK; dx++) {
        const tx = tx0 + dx;
        if (tx >= world.w) break;
        const px = dx * TILE, py = dy * TILE;
        const wallId = world.walls[ty * world.w + tx];
        const tileId = world.tiles[ty * world.w + tx];
        // wall behind
        if (wallId !== 0 && (tileId === T.air || !TILES[tileId].solid)) {
          if (this.drawWallHook) this.drawWallHook(ctx, tx, ty, WALLS[wallId], px, py);
          else {
            ctx.fillStyle = WALLS[wallId].color;
            ctx.fillRect(px, py, TILE, TILE);
          }
        }
        if (tileId !== T.air) {
          const info = TILES[tileId];
          if (this.drawTileHook) {
            this.drawTileHook(ctx, tx, ty, info, px, py);
          } else {
            ctx.fillStyle = info.color;
            if (info.platform) {
              ctx.fillRect(px, py, TILE, TILE / 2.5);
            } else {
              ctx.fillRect(px, py, TILE, TILE);
              // cheap depth cue: darken bottom-right edge, lighten top edge
              ctx.fillStyle = 'rgba(0,0,0,0.18)';
              ctx.fillRect(px, py + TILE - 2, TILE, 2);
              ctx.fillRect(px + TILE - 2, py, 2, TILE);
              ctx.fillStyle = 'rgba(255,255,255,0.10)';
              ctx.fillRect(px, py, TILE, 2);
            }
          }
        }
        // liquid overlay
        const liq = world.liquid[ty * world.w + tx];
        if (liq > 0) {
          const frac = liq / 255;
          ctx.fillStyle = world.liquidType[ty * world.w + tx] === 1
            ? 'rgba(255,90,20,0.82)' : 'rgba(40,90,200,0.55)';
          ctx.fillRect(px, py + TILE * (1 - frac), TILE, TILE * frac);
        }
      }
    }
    c.rendered = true;
  }

  // main per-frame draw
  draw(ctx, camera, alpha) {
    const { world } = this;
    // flush dirty chunks (budget: all — chunk renders are cheap at 512px)
    if (world.dirty.size) {
      for (const key of world.dirty) {
        const cx = key % 4096, cy = (key / 4096) | 0;
        if (cx < this.cw && cy < this.ch) this.renderChunk(cx, cy);
      }
      world.dirty.clear();
    }
    const [ox, oy] = camera.frameOrigin(alpha);
    const zoom = camera.zoom;
    const c0x = Math.max(0, (ox / (CHUNK * TILE)) | 0);
    const c0y = Math.max(0, (oy / (CHUNK * TILE)) | 0);
    const c1x = Math.min(this.cw - 1, ((ox + camera.viewW()) / (CHUNK * TILE)) | 0);
    const c1y = Math.min(this.ch - 1, ((oy + camera.viewH()) / (CHUNK * TILE)) | 0);
    ctx.imageSmoothingEnabled = false;
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const c = this.getChunk(cx, cy);
        if (!c.rendered) this.renderChunk(cx, cy);
        const sx = Math.round((cx * CHUNK * TILE - ox) * zoom);
        const sy = Math.round((cy * CHUNK * TILE - oy) * zoom);
        ctx.drawImage(c.canvas, sx, sy, Math.ceil(CHUNK * TILE * zoom), Math.ceil(CHUNK * TILE * zoom));
      }
    }
    // darkness / light overlay is applied by lighting module after this
  }

  // free far-away chunk canvases to bound memory (call occasionally)
  evictOutside(c0x, c0y, c1x, c1y, margin = 4) {
    for (const [key, _] of this.chunks) {
      const cx = key % 4096, cy = (key / 4096) | 0;
      if (cx < c0x - margin || cx > c1x + margin || cy < c0y - margin || cy > c1y + margin) {
        this.chunks.delete(key);
      }
    }
  }
}
