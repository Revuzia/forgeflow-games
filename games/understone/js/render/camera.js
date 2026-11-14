// Camera: world-px focus point, zoom, clamped to world bounds, smoothed follow.

import { TILE, ZOOM_DEFAULT } from '../config.js';

export class Camera {
  constructor(world, canvas) {
    this.world = world;
    this.canvas = canvas;
    this.x = world.spawnX * TILE;   // world px, center of view
    this.y = world.spawnY * TILE;
    this.px = this.x; this.py = this.y; // previous tick (for render interpolation)
    this.zoom = ZOOM_DEFAULT;           // screen px per world px (device-px aware at render)
    this.target = null;                 // entity with x,y (px, center)
  }

  follow(target) { this.target = target; }

  tick() {
    this.px = this.x; this.py = this.y;
    if (this.target) {
      // critically-damped-ish lerp; snappy but soft
      this.x += (this.target.x - this.x) * 0.25;
      this.y += (this.target.y - this.y) * 0.25;
    }
    this.clamp();
  }

  clamp() {
    const vw = this.viewW(), vh = this.viewH();
    const maxX = this.world.w * TILE - vw / 2, maxY = this.world.h * TILE - vh / 2;
    this.x = Math.min(Math.max(this.x, vw / 2), Math.max(vw / 2, maxX));
    this.y = Math.min(Math.max(this.y, vh / 2), Math.max(vh / 2, maxY));
  }

  // view size in world px
  viewW() { return this.canvas.width / this.zoom; }
  viewH() { return this.canvas.height / this.zoom; }

  // interpolated top-left of view in world px for this frame (+screenshake)
  frameOrigin(alpha) {
    const cx = this.px + (this.x - this.px) * alpha;
    const cy = this.py + (this.y - this.py) * alpha;
    return [cx - this.viewW() / 2 + (this.shakeX ?? 0), cy - this.viewH() / 2 + (this.shakeY ?? 0)];
  }

  // screen(device px) → world px
  screenToWorld(sx, sy, alpha = 1) {
    const [ox, oy] = this.frameOrigin(alpha);
    return [ox + sx / this.zoom, oy + sy / this.zoom];
  }

  visibleTileRange(alpha = 1, pad = 2) {
    const [ox, oy] = this.frameOrigin(alpha);
    const x0 = Math.max(0, ((ox / TILE) | 0) - pad);
    const y0 = Math.max(0, ((oy / TILE) | 0) - pad);
    const x1 = Math.min(this.world.w - 1, (((ox + this.viewW()) / TILE) | 0) + pad);
    const y1 = Math.min(this.world.h - 1, (((oy + this.viewH()) / TILE) | 0) + pad);
    return [x0, y0, x1, y1];
  }
}
