// Tile collision — faithful port of Terraria's Collision.TileCollision
// (research/terraria/01-physics-collision.md §5). Velocity-CLAMPING, not ejection:
// returns adjusted velocity; caller integrates position += vel (× liquid factor).
// Axis choice is decided by OLD-position side tests with corner tie-breaks.

import { TILE, PHYS } from '../config.js';
import { TILES } from '../world/world.js';

// static flags mirroring Collision.up / Collision.down (read after each call)
export const colFlags = { up: false, down: false };

export function tileCollision(world, px, py, vx, vy, w, h, fallThrough = false, ignorePlats = false) {
  colFlags.up = false; colFlags.down = false;
  let outX = vx, outY = vy;
  const nx = px + vx, ny = py + vy;
  let bestFloorY = Infinity;
  let hCol = -1, hRow = -1, vCol = -1, vRow = -1;

  const tx0 = Math.floor(px / TILE) - 1, tx1 = Math.floor((px + w) / TILE) + 2;
  const ty0 = Math.floor(py / TILE) - 1, ty1 = Math.floor((py + h) / TILE) + 2;

  for (let tx = tx0; tx < tx1; tx++) {
    for (let ty = ty0; ty < ty1; ty++) {
      let solid, platform;
      if (!world.inBounds(tx, ty)) { solid = true; platform = false; }
      else {
        const info = TILES[world.tiles[ty * world.w + tx]];
        solid = info.solid; platform = info.platform;
      }
      if (!solid && !platform) continue;

      const tileX = tx * TILE, tileY = ty * TILE, tileH = TILE;
      // projected AABB overlap test
      if (nx + w <= tileX || nx >= tileX + TILE || ny + h <= tileY || ny >= tileY + tileH) continue;

      if (py + h <= tileY) {
        // ---- came from above: landing
        if (platform && fallThrough && (vy <= 1 || ignorePlats)) continue;
        if (tileY < bestFloorY) {
          bestFloorY = tileY;
          vCol = tx; vRow = ty;
          if (vCol !== hCol) { outY = tileY - (py + h); colFlags.down = true; }
        }
      } else if (!platform && px + w <= tileX) {
        // ---- wall on the right
        hCol = tx; hRow = ty;
        if (hRow !== vRow) outX = tileX - (px + w);
        if (vCol === hCol) outY = vy;               // corner tie-break
      } else if (!platform && px >= tileX + TILE) {
        // ---- wall on the left
        hCol = tx; hRow = ty;
        if (hRow !== vRow) outX = tileX + TILE - px;
        if (vCol === hCol) outY = vy;
      } else if (!platform && py >= tileY + tileH) {
        // ---- came from below: head bonk
        colFlags.up = true;
        vCol = tx; vRow = ty;
        outY = tileY + tileH - py + 0.01;
        if (vRow === hRow) outX = vx;
      }
    }
  }
  return [outX, outY];
}

// Depenetration: velocity-clamping alone can leave an entity OVERLAPPING a solid tile (e.g.
// a tile placed on it, a tight corner, a narrow shaft). If we never push it back out it gets
// STUCK — no axis of movement is free. This ejects the entity along the minimum-translation
// axis of the tile it overlaps most, a few iterations, so it can never be trapped inside solid.
function depenetrate(world, e) {
  for (let iter = 0; iter < 4; iter++) {
    const tx0 = Math.floor((e.x + 0.5) / TILE), tx1 = Math.floor((e.x + e.w - 0.5) / TILE);
    const ty0 = Math.floor((e.y + 0.5) / TILE), ty1 = Math.floor((e.y + e.h - 0.5) / TILE);
    let best = null;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (world.inBounds(tx, ty) && !TILES[world.tiles[ty * world.w + tx]].solid) continue;
        const ox = Math.min(e.x + e.w, tx * TILE + TILE) - Math.max(e.x, tx * TILE);
        const oy = Math.min(e.y + e.h, ty * TILE + TILE) - Math.max(e.y, ty * TILE);
        if (ox <= 0.5 || oy <= 0.5) continue;
        const pen = Math.min(ox, oy);
        if (!best || pen > best.pen) best = { tx, ty, pen };
      }
    }
    if (!best) return;
    const { tx, ty } = best;
    const leftPen = (e.x + e.w) - tx * TILE, rightPen = (tx * TILE + TILE) - e.x;      // out the left / right
    const upPen = (e.y + e.h) - ty * TILE, downPen = (ty * TILE + TILE) - e.y;          // out the top / bottom
    const hx = Math.min(leftPen, rightPen), hy = Math.min(upPen, downPen);
    if (hx <= hy) { e.x += leftPen < rightPen ? -leftPen : rightPen; e.vx = 0; }
    else { e.y += upPen < downPen ? -upPen : downPen; e.vy = 0; }
  }
}

// Integrate an entity { x, y (top-left px), vx, vy, w, h } against the tile grid,
// with anti-tunnel sub-stepping and liquid position-factor.
// Returns { up, down } collision flags aggregated across sub-steps.
export function moveEntity(world, e, { fallThrough = false, ignorePlats = false, moveFactor = 1 } = {}) {
  let up = false, down = false;
  const speed = Math.hypot(e.vx, e.vy);
  const steps = speed > PHYS.maxSubStep ? Math.ceil(speed / PHYS.maxSubStep) : 1;
  let vx = e.vx / steps, vy = e.vy / steps;
  for (let i = 0; i < steps; i++) {
    const [cx, cy] = tileCollision(world, e.x, e.y, vx, vy, e.w, e.h, fallThrough, ignorePlats);
    // axis clamped by collision moves the FULL clamped amount even in liquid
    // (so you land exactly on floors underwater); free axes scale by moveFactor.
    e.x += cx !== vx ? cx : cx * moveFactor;
    e.y += cy !== vy ? cy : cy * moveFactor;
    if (colFlags.up) up = true;
    if (colFlags.down) down = true;
    if (cx !== vx) { e.vx = 0; vx = 0; }
    if (cy !== vy) {
      // preserve Terraria head-bonk: caller sets vy = 0.01 on `up`
      e.vy = 0; vy = 0;
    }
  }
  depenetrate(world, e);  // never leave the entity stuck inside solid tiles
  return { up, down };
}

// liquid sampling helpers ------------------------------------------------------
export function liquidAt(world, px, py) {
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  if (!world.inBounds(tx, ty)) return 0;
  const amt = world.liquid[ty * world.w + tx];
  if (amt < 32) return 0;
  return world.liquidType[ty * world.w + tx] === 1 ? 2 : 1; // 1=water 2=lava
}

// entity wetness: sample center + feet
export function entityLiquid(world, e) {
  const cx = e.x + e.w / 2;
  return Math.max(
    liquidAt(world, cx, e.y + e.h * 0.5),
    liquidAt(world, cx, e.y + e.h - 1),
  );
}
