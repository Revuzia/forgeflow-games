// Liquid simulation — faithful port of Terraria's Liquid.cs rules
// (research/terraria/03-tiles-digging-lighting.md §8, source-verified):
// byte amounts 0-255, sparse active set, each active cell updates ~once per 10 ticks,
// lava skips 5 updates between moves; fall → snap>250 → spread ±1..3 window averaging;
// thin puddles (<3) evaporate; kill after 4 no-op updates; water+lava(≥32) → obsidian.

import { T, TILES } from './world.js';

const FULL = 255, SNAP = 250, EVAP_THRESHOLD = 3;
const CYCLES = 10;          // each active cell updates once per this many ticks
const LAVA_SKIP = 5;        // lava moves 1/6 water speed

export class Liquids {
  constructor(world) {
    this.world = world;
    this.active = [];                          // packed indices, processed round-robin
    this.inActive = new Uint8Array(world.w * world.h);
    this.kill = new Uint8Array(world.w * world.h);
    this.delay = new Uint8Array(world.w * world.h);
    this.cursor = 0;
    world.onTileChanged.push((tx, ty) => this.wakeArea(tx, ty));
  }

  blocksLiquid(tx, ty) {
    const { world } = this;
    if (!world.inBounds(tx, ty)) return true;
    const info = TILES[world.tiles[ty * world.w + tx]];
    return info.solid && !info.platform;       // platforms don't hold liquids
  }

  wake(tx, ty) {
    const { world } = this;
    if (!world.inBounds(tx, ty)) return;
    const i = ty * world.w + tx;
    if (world.liquid[i] === 0) return;
    this.kill[i] = 0;                    // re-energize even if already queued
    if (this.inActive[i]) return;        // invariant: at most one queue entry per cell
    this.inActive[i] = 1;
    this.active.push(i);
  }

  wakeArea(tx, ty) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) this.wake(tx + dx, ty + dy);
  }

  // call once at world load: settle everything quickly
  settleAll(iterations = 40) {
    const { world } = this;
    for (let i = 0; i < world.liquid.length; i++) {
      if (world.liquid[i] > 0 && !this.inActive[i]) { this.inActive[i] = 1; this.active.push(i); }
    }
    for (let it = 0; it < iterations; it++) {
      const snapshot = this.active.slice();
      for (const idx of snapshot) this.updateCell(idx, true);
      this.compact();
      if (this.active.length === 0) break;
    }
    // repaint all chunks once after bulk settle
    const CH = 32;
    for (let cy = 0; cy < Math.ceil(world.h / CH); cy++)
      for (let cx = 0; cx < Math.ceil(world.w / CH); cx++)
        world.dirty.add(cy * 4096 + cx);
  }

  compact() {
    const { world } = this;
    const next = [];
    for (const i of this.active) {
      if (this.inActive[i] && world.liquid[i] > 0 && this.kill[i] <= 4) next.push(i);
      else this.inActive[i] = 0;
    }
    this.active = next;
    if (this.cursor >= this.active.length) this.cursor = 0;
  }

  tick() {
    const n = this.active.length;
    if (n === 0) return;
    const budget = Math.max(1, Math.ceil(n / CYCLES));
    for (let k = 0; k < budget; k++) {
      if (this.active.length === 0) break;
      if (this.cursor >= this.active.length) { this.cursor = 0; this.compact(); if (!this.active.length) break; }
      this.updateCell(this.active[this.cursor], false);
      this.cursor++;
    }
    // periodic compaction
    if ((this.cursor === 0 || this.cursor >= this.active.length) && this.active.length > 0) this.compact();
  }

  // NOTE invariant: inActive[i] === 1 ⇔ index i is in the active array exactly once.
  // ONLY compact() may clear inActive / remove entries — updateCell never does, or
  // re-wakes would duplicate entries and the list grows without bound.
  updateCell(i, bulk) {
    const { world } = this;
    const w = world.w;
    const tx = i % w, ty = (i / w) | 0;
    let amt = world.liquid[i];
    if (amt === 0) return;               // compact() will drop it
    const type = world.liquidType[i];

    // solid block now occupies the cell → liquid is destroyed
    if (this.blocksLiquid(tx, ty)) {
      world.liquid[i] = 0;
      world.markDirty(tx, ty);
      return;
    }

    // lava is slow (skip updates), except during bulk settle
    if (!bulk && type === 1) {
      if (this.delay[i] < LAVA_SKIP) { this.delay[i]++; return; }
      this.delay[i] = 0;
    }
    if (type === 1) this.lavaContactCheck(tx, ty);

    amt = world.liquid[i];               // may have changed via obsidian
    if (amt === 0) return;
    const before = amt;

    // ---- fall ---------------------------------------------------------------
    const belowI = i + w;
    if (ty + 1 < world.h && !this.blocksLiquid(tx, ty + 1)) {
      const belowType = world.liquidType[belowI];
      const belowAmt = world.liquid[belowI];
      if (belowAmt === 0 || belowType === type) {
        if (belowAmt < FULL) {
          const move = Math.min(FULL - belowAmt, amt);
          world.liquid[belowI] = belowAmt + move;
          world.liquidType[belowI] = type;
          amt -= move;
          if (amt > SNAP) amt = FULL;    // surface-tension top-off
          world.liquid[i] = amt;
          this.wake(tx, ty + 1);
          this.wake(tx - 1, ty); this.wake(tx + 1, ty);
          world.markDirty(tx, ty); world.markDirty(tx, ty + 1);
        }
      } else if (belowType !== type) {
        // falling onto a foreign liquid: water onto lava / lava onto water
        this.crossContact(tx, ty, tx, ty + 1);
      }
    }

    // ---- spread -------------------------------------------------------------
    if (amt > 0) {
      const openSide = (ddx) => {
        const nx = tx + ddx;
        if (this.blocksLiquid(nx, ty)) return false;
        const ni = ty * w + nx;
        const nt = world.liquidType[ni];
        return world.liquid[ni] === 0 || nt === type;
      };
      const leftOpen = openSide(-1), rightOpen = openSide(1);
      const evap = amt < EVAP_THRESHOLD ? -1 : 0;

      if (leftOpen && rightOpen) {
        // widen window where neighbors are open AND already hold some liquid
        let x0 = tx - 1, x1 = tx + 1;
        for (let e = 2; e <= 3; e++) {
          if (openSide(-e) && world.liquid[ty * w + (tx - e + 1)] > 0) x0 = tx - e; else break;
        }
        for (let e = 2; e <= 3; e++) {
          if (openSide(e) && world.liquid[ty * w + (tx + e - 1)] > 0) x1 = tx + e; else break;
        }
        let sum = 0, count = 0;
        for (let x = x0; x <= x1; x++) { sum += world.liquid[ty * w + x]; count++; }
        const v = Math.max(0, Math.round((sum + evap) / count));
        for (let x = x0; x <= x1; x++) {
          const ni = ty * w + x;
          if (world.liquid[ni] !== v) {
            world.liquid[ni] = v;
            world.liquidType[ni] = type;
            this.wake(x, ty);
            world.markDirty(x, ty);
          } else { world.liquidType[ni] = type; }
        }
        amt = v;
      } else if (leftOpen || rightOpen) {
        const nx = leftOpen ? tx - 1 : tx + 1;
        const ni = ty * w + nx;
        const v = Math.max(0, Math.round((amt + world.liquid[ni] + evap) / 2 + 0.001));
        if (world.liquid[ni] !== v || amt !== v) {
          world.liquid[ni] = v;
          world.liquidType[ni] = type;
          world.liquid[i] = v;
          amt = v;
          this.wake(nx, ty);
          world.markDirty(tx, ty); world.markDirty(nx, ty);
        }
      }
      world.liquid[i] = amt;
    }

    // ---- settle bookkeeping ---------------------------------------------------
    if (world.liquid[i] !== before) {
      this.kill[i] = 0;
      this.wake(tx, ty - 1);
    } else if (this.kill[i] <= 4) {
      this.kill[i]++;            // kill > 4 → compact() removes it
    }
  }

  // water adjacent to lava → obsidian at the lava cell (≥32 foreign amount)
  lavaContactCheck(tx, ty) {
    const { world } = this;
    const w = world.w;
    const i = ty * w + tx;
    let foreign = 0;
    const sides = [[0, -1], [-1, 0], [1, 0], [0, 1]];
    for (const [dx, dy] of sides) {
      const nx = tx + dx, ny = ty + dy;
      if (!world.inBounds(nx, ny)) continue;
      const ni = ny * w + nx;
      if (world.liquid[ni] >= 1 && world.liquidType[ni] === 0) foreign += world.liquid[ni];
    }
    if (foreign >= 32) {
      // consume adjacent water (one tile's worth) and petrify this lava cell
      for (const [dx, dy] of sides) {
        const nx = tx + dx, ny = ty + dy;
        if (!world.inBounds(nx, ny)) continue;
        const ni = ny * w + nx;
        if (world.liquid[ni] >= 1 && world.liquidType[ni] === 0) { world.liquid[ni] = 0; break; }
      }
      world.liquid[i] = 0;
      world.setTile(tx, ty, T.obsidian);
    }
  }

  crossContact(tx1, ty1, tx2, ty2) {
    const { world } = this;
    const i1 = ty1 * world.w + tx1, i2 = ty2 * world.w + tx2;
    const lavaFirst = world.liquidType[i1] === 1;
    const lavaI = lavaFirst ? i1 : i2, waterI = lavaFirst ? i2 : i1;
    const lavaTx = lavaFirst ? tx1 : tx2, lavaTy = lavaFirst ? ty1 : ty2;
    if (world.liquid[waterI] >= 32) {
      world.liquid[waterI] = 0;
      world.liquid[lavaI] = 0;
      world.setTile(lavaTx, lavaTy, T.obsidian);
    } else {
      world.liquid[waterI] = 0;
      world.markDirty(tx2, ty2);
    }
  }
}
