// Lighting engine — faithful to Terraria's doColors() structure
// (research/terraria/03-tiles-digging-lighting.md §6, source-verified constants):
//   seed (sky color + emitters) → 4 directional max-carry sweeps × 2 iterations.
// Decay: ×0.91 air, ×0.56 solid, water per-channel (0.88/0.96/1.015)×0.91.
// Cutoff 0.0185 (torch range ≈ 42 air tiles, ≈ 7 through rock).
// Render: 1px-per-tile canvas, bilinear-upscaled, multiply-blended over the scene.

import { TILE } from '../config.js';
import { TILES, T } from './world.js';
import { sunlight } from '../render/background.js';

const DECAY_AIR = 0.91, DECAY_SOLID = 0.56, CUTOFF = 0.0185;
const MARGIN = 21; // tiles beyond the view, per Terraria
const LAVA_EMIT = [0.30, 0.13, 0.03]; // derived from wiki 29-30 tile range ([T] channel split)

export class Lighting {
  constructor(world) {
    this.world = world;
    this.rw = 0; this.rh = 0; this.rx = 0; this.ry = 0;
    this.light = null;           // Float32Array rw*rh*3
    this.decay = null;           // Float32Array rw*rh*3 (per-channel decay per cell)
    this.canvas = document.createElement('canvas');
    this.cctx = this.canvas.getContext('2d');
    this.img = null;
    // sky exposure cache: first solid tile per column (recomputed when tiles change)
    this.skyTop = new Int16Array(world.w).fill(-1);
    this.lastTick = -1;
    this.tilesChanged = true;
    world.onTileChanged.push((tx) => { this.skyTopDirty(tx); this.tilesChanged = true; });
  }

  skyTopDirty(tx) { this.skyTop[tx] = -1; }

  skyTopAt(tx) {
    let v = this.skyTop[tx];
    if (v >= 0) return v;
    const { world } = this;
    let y = 0;
    for (; y < world.h; y++) {
      const id = world.tiles[y * world.w + tx];
      if (id !== T.air && TILES[id].lightBlock) break;
    }
    this.skyTop[tx] = y;
    return y;
  }

  ensureRegion(w, h) {
    if (this.rw === w && this.rh === h) return;
    this.rw = w; this.rh = h;
    this.light = new Float32Array(w * h * 3);
    this.decay = new Float32Array(w * h * 3);
    this.canvas.width = w; this.canvas.height = h;
    this.img = this.cctx.createImageData(w, h);
  }

  compute(camera, tick, alpha) {
    // recompute at most once per tick, and skip odd ticks unless something changed
    if (tick === this.lastTick) return;
    if (!this.tilesChanged && tick - this.lastTick < 2) return;
    this.lastTick = tick;
    this.tilesChanged = false;
    const { world } = this;
    const [vx0, vy0, vx1, vy1] = camera.visibleTileRange(alpha, 0);
    const x0 = Math.max(0, vx0 - MARGIN), y0 = Math.max(0, vy0 - MARGIN);
    const x1 = Math.min(world.w - 1, vx1 + MARGIN), y1 = Math.min(world.h - 1, vy1 + MARGIN);
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    this.ensureRegion(w, h);
    this.rx = x0; this.ry = y0;
    const L = this.light, D = this.decay;
    const sun = sunlight(tick);
    // warm sky tint at low sun ([T] approximation of the §7 bgColor ramps)
    const skyR = sun, skyG = sun * (0.92 + 0.08 * sun), skyB = sun * (0.82 + 0.18 * sun);

    // ---- seed + decay classification ------------------------------------------
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = ((y - y0) * w + (x - x0)) * 3;
        const wi = y * world.w + x;
        const id = world.tiles[wi];
        const info = TILES[id];
        const liq = world.liquid[wi];
        const isWater = liq >= 32 && world.liquidType[wi] === 0;
        const isLava = liq >= 32 && world.liquidType[wi] === 1;

        // per-channel decay
        if (info.lightBlock && info.solid) {
          D[i] = DECAY_SOLID; D[i + 1] = DECAY_SOLID; D[i + 2] = DECAY_SOLID;
        } else if (isWater) {
          D[i] = 0.88 * DECAY_AIR; D[i + 1] = 0.96 * DECAY_AIR; D[i + 2] = Math.min(1, 1.015 * DECAY_AIR);
        } else {
          D[i] = DECAY_AIR; D[i + 1] = DECAY_AIR; D[i + 2] = DECAY_AIR;
        }

        // seed
        let r = 0, g = 0, b = 0;
        if (y < this.skyTopAt(x) && world.walls[wi] === 0) { r = skyR; g = skyG; b = skyB; }
        // surface ambient floor: the near-surface band is never pure black, so a HOLE
        // reads as a distinct dark gap against lit terrain (you can't mistake it for dirt).
        // Fades to 0 by ~34 tiles below the surface so deep caves stay dark (torches matter).
        const surfDepth = y - this.skyTopAt(x);
        if (surfDepth >= 0 && surfDepth < 34) {
          const amb = 0.11 * (1 - surfDepth / 34) * Math.max(0.35, sun);
          if (amb > r) r = amb; if (amb > g) g = amb; if (amb * 1.05 > b) b = amb * 1.05;
        }
        const e = info.lightEmit;
        if (e) { r = Math.max(r, e[0]); g = Math.max(g, e[1]); b = Math.max(b, e[2]); }
        if (isLava) { r = Math.max(r, LAVA_EMIT[0]); g = Math.max(g, LAVA_EMIT[1]); b = Math.max(b, LAVA_EMIT[2]); }
        L[i] = r; L[i + 1] = g; L[i + 2] = b;
      }
    }

    // ---- held light: a torch/lantern carried by the player lights the tunnels ---
    const hl = world.heldLight;
    if (hl) {
      const ltx = Math.floor(hl.x / TILE), lty = Math.floor(hl.y / TILE);
      if (ltx >= x0 && ltx <= x1 && lty >= y0 && lty <= y1) {
        const i = ((lty - y0) * w + (ltx - x0)) * 3;
        L[i] = Math.max(L[i], hl.rgb[0]); L[i + 1] = Math.max(L[i + 1], hl.rgb[1]); L[i + 2] = Math.max(L[i + 2], hl.rgb[2]);
      }
    }

    // ---- 4 directional sweeps × 2 iterations -----------------------------------
    for (let iter = 0; iter < 2; iter++) {
      // vertical sweeps per column
      for (let x = 0; x < w; x++) {
        this.sweep(x, 0, 0, 1, w, h);
        this.sweep(x, h - 1, 0, -1, w, h);
      }
      // horizontal sweeps per row
      for (let y = 0; y < h; y++) {
        this.sweep(0, y, 1, 0, w, h);
        this.sweep(w - 1, y, -1, 0, w, h);
      }
    }
    this.buildImage();
  }

  sweep(sx, sy, dx, dy, w, h) {
    const L = this.light, D = this.decay;
    let cr = 0, cg = 0, cb = 0;
    let x = sx, y = sy;
    while (x >= 0 && x < w && y >= 0 && y < h) {
      const i = (y * w + x) * 3;
      // pick up brighter cell or deposit carried light
      if (L[i] > cr) cr = L[i]; else if (cr > CUTOFF) L[i] = cr;
      if (L[i + 1] > cg) cg = L[i + 1]; else if (cg > CUTOFF) L[i + 1] = cg;
      if (L[i + 2] > cb) cb = L[i + 2]; else if (cb > CUTOFF) L[i + 2] = cb;
      cr *= D[i]; if (cr < CUTOFF) cr = 0;
      cg *= D[i + 1]; if (cg < CUTOFF) cg = 0;
      cb *= D[i + 2]; if (cb < CUTOFF) cb = 0;
      x += dx; y += dy;
    }
  }

  buildImage() {
    const { world } = this;
    const w = this.rw, h = this.rh;
    const L = this.light;
    const data = this.img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        const o = (y * w + x) * 4;
        const wx = this.rx + x, wy = this.ry + y;
        const wi = wy * world.w + wx;
        // open sky (no tile, no wall, above first solid): keep the drawn sky visible
        if (world.tiles[wi] === T.air && world.walls[wi] === 0 && wy < this.skyTopAt(wx)) {
          data[o] = 255; data[o + 1] = 255; data[o + 2] = 255; data[o + 3] = 255;
          continue;
        }
        data[o] = Math.min(255, L[i] * 255) | 0;
        data[o + 1] = Math.min(255, L[i + 1] * 255) | 0;
        data[o + 2] = Math.min(255, L[i + 2] * 255) | 0;
        data[o + 3] = 255;
      }
    }
    this.cctx.putImageData(this.img, 0, 0);
  }

  // draw multiply overlay across the visible world area (cheap blit per frame)
  draw(ctx, camera, alpha) {
    if (!this.rw) return;
    const [ox, oy] = camera.frameOrigin(alpha);
    const z = camera.zoom;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.imageSmoothingEnabled = this.smooth !== false; // bilinear = smooth; off = crisp/retro (Settings › Video)
    ctx.drawImage(
      this.canvas,
      (this.rx * TILE - ox) * z, (this.ry * TILE - oy) * z,
      this.rw * TILE * z, this.rh * TILE * z,
    );
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
  }

  // light value at a tile (for spawn logic etc.)
  lightAt(tx, ty) {
    if (!this.light || tx < this.rx || ty < this.ry || tx >= this.rx + this.rw || ty >= this.ry + this.rh) return 0;
    const i = ((ty - this.ry) * this.rw + (tx - this.rx)) * 3;
    return (this.light[i] + this.light[i + 1] + this.light[i + 2]) / 3;
  }
}
