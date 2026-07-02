// World tile store — flat typed arrays, no per-tile objects.
// Coordinates: tx, ty in tiles; index = ty * W + tx. (0,0) is top-left.

import { WORLD_W, WORLD_H } from '../config.js';

// ---------------------------------------------------------------------------
// Tile registry. Order matters (IDs are persisted in saves — append only!).
// Mining model (research 03, source-verified): every block = 100 damage points;
// damage per swing = floor(pickPower × mult). mult: 2 soft, 1 default, 0.5 hard.
// pick = minimum pickaxe power % (0 damage below it).
// grassTo = tile id the block converts to when the grass coat is stripped
// (grass costs one full 100-damage cycle before the block underneath takes damage).
// ---------------------------------------------------------------------------
export const T = {}; // name → id
export const TILES = [];
function tile(name, props = {}) {
  const id = TILES.length;
  T[name] = id;
  TILES.push({
    id, name,
    solid: props.solid ?? true,
    platform: props.platform ?? false,   // one-way
    mult: props.mult ?? 1,               // pick damage multiplier
    pick: props.pick ?? 0,               // min pickaxe power %
    grassTo: props.grassTo ?? null,      // grass coat: strips to this tile first
    axe: props.axe ?? false,             // chopped, not mined
    hammer: props.hammer ?? false,       // hammered (background objects)
    drops: 'drops' in props ? props.drops : name, // item key granted on dig (explicit null = nothing)
    lightEmit: props.lightEmit ?? null,  // [r,g,b] 0-1 emission
    lightBlock: props.lightBlock ?? (props.solid ?? true), // attenuates light strongly
    color: props.color ?? '#f0f',        // placeholder/minimap swatch
    merge: props.merge ?? 'soil',        // autotile merge family
    falls: props.falls ?? false,         // sand-style falling tile
    touchDamage: props.touchDamage ?? 0, // hellstone/meteorite style
    station: props.station ?? null,      // crafting station key
    frameStyle: props.frameStyle ?? 'blob', // blob | platform | cross | none
  });
  return id;
}

tile('air',        { solid: false, drops: null, lightBlock: false, color: 'transparent', frameStyle: 'none' });
tile('dirt',       { mult: 2, color: '#8a5a2b' });
tile('grass',      { mult: 2, grassTo: 'dirt', drops: 'dirt', color: '#4caf50' });
tile('stone',      { mult: 1, color: '#7d7d85', merge: 'rock' });
tile('wood',       { mult: 1, color: '#a97c50', merge: 'wood' });      // planks (placed)
tile('treeTrunk',  { solid: false, axe: true, drops: null, color: '#6b4a2a', frameStyle: 'cross' }); // drops handled by tree fell logic
tile('treeLeaves', { solid: false, drops: null, lightBlock: false, color: '#3e8948', frameStyle: 'cross' });
tile('sand',       { mult: 2, falls: true, color: '#d9c07a' });
tile('snow',       { mult: 2, color: '#e8f0f5' });
tile('ice',        { mult: 1, color: '#a8d5e8', merge: 'rock' });
tile('mud',        { mult: 2, color: '#5c4a3a' });
tile('jungleGrass',{ mult: 2, grassTo: 'mud', drops: 'mud', color: '#2e9e3e' });
tile('clay',       { mult: 2, color: '#b0673f' });
tile('ash',        { mult: 2, color: '#44404a' });
tile('hellstone',  { mult: 0.5, pick: 65, touchDamage: 20, lightEmit: [0.9, 0.4, 0.1], color: '#c33', merge: 'rock' });
tile('obsidian',   { mult: 0.5, pick: 55, color: '#241c3a', merge: 'rock' });
tile('copperOre',  { mult: 1, color: '#c87533', merge: 'rock' });
tile('ironOre',    { mult: 1, color: '#b5a642', merge: 'rock' });
tile('silverOre',  { mult: 1, color: '#c0c0c8', merge: 'rock' });
tile('goldOre',    { mult: 1, color: '#e6c34a', merge: 'rock' });
tile('demonite',   { mult: 1, pick: 55, color: '#7a4fd0', merge: 'rock' });
tile('torch',      { solid: false, mult: 100, lightEmit: [1.0, 0.95, 0.8], lightBlock: false, color: '#ffd27a', frameStyle: 'cross' });
tile('platform',   { solid: false, platform: true, mult: 2, color: '#9a7448', frameStyle: 'platform', merge: 'wood' });
tile('workbench',  { solid: false, platform: true, mult: 1.5, station: 'workbench', color: '#8f6b40', frameStyle: 'cross' });
tile('furnace',    { solid: false, mult: 1.5, station: 'furnace', lightEmit: [0.8, 0.5, 0.2], color: '#6e6e78', frameStyle: 'cross' });
tile('anvil',      { solid: false, mult: 1.5, station: 'anvil', color: '#5a5a64', frameStyle: 'cross' });
tile('bottle',     { solid: false, mult: 100, station: 'bottle', lightBlock: false, color: '#9fd0e8', frameStyle: 'cross' });
tile('chest',      { solid: false, mult: 1.5, drops: null, color: '#c9a25a', frameStyle: 'cross' });   // contents handled by chests.js
tile('door',       { solid: true, mult: 1.5, color: '#87643c', frameStyle: 'cross' });
tile('doorOpen',   { solid: false, mult: 1.5, drops: 'door', color: '#87643c', frameStyle: 'cross' });
tile('lifeCrystal',{ solid: false, mult: 1.5, lightEmit: [0.9, 0.2, 0.3], color: '#e83a5a', frameStyle: 'cross' });
tile('cobweb',     { solid: false, mult: 100, drops: 'cobweb', lightBlock: false, color: '#dedede', frameStyle: 'cross' });
tile('pot',        { solid: false, mult: 100, drops: null, color: '#a8825a', frameStyle: 'cross' }); // loot handled by onDig special-case
tile('spawnPoint', { solid: false, mult: 1.5, drops: null, color: '#e8e0c0', frameStyle: 'cross' }); // bed-lite
tile('demonAltar', { solid: false, mult: 0, drops: null, lightEmit: [0.35, 0.1, 0.4], color: '#8a3fa0', frameStyle: 'cross', station: 'altar' }); // unbreakable pre-HM
tile('rubyOre',    { mult: 1, drops: 'ruby', color: '#e03a4e', merge: 'rock' });
tile('diamondOre', { mult: 1, drops: 'diamond', color: '#bfe8f0', merge: 'rock' });
tile('hellforge',  { solid: false, mult: 1.5, station: 'hellforge', drops: 'hellforgeItem', lightEmit: [0.95, 0.45, 0.1], color: '#d2622a', frameStyle: 'cross' });
tile('sapling',    { solid: false, mult: 100, drops: 'acorn', lightBlock: false, color: '#5a8a3a', frameStyle: 'cross' });
tile('ebonstone',  { mult: 0.5, pick: 65, drops: 'stone', color: '#4a4258', merge: 'rock' });
tile('corruptGrass', { mult: 2, grassTo: 'dirt', drops: 'dirt', color: '#7a68a8' });

// --- walls ---
export const W_ = {}; // name → wall id
export const WALLS = [];
function wall(name, props = {}) {
  const id = WALLS.length;
  W_[name] = id;
  WALLS.push({
    id, name,
    natural: props.natural ?? false,  // natural walls: enemies can spawn, not player-removable bonus
    drops: props.drops ?? (props.natural ? null : name),
    color: props.color ?? '#333',
  });
  return id;
}
wall('none',       { natural: true, color: 'transparent' });
wall('dirtNatural',{ natural: true, color: '#4a2f17' });
wall('stoneNatural',{ natural: true, color: '#3c3c42' });
wall('dirtWall',   { color: '#553a1e' });
wall('stoneWall',  { color: '#46464e' });
wall('woodWall',   { color: '#5e4326' });

// ---------------------------------------------------------------------------
// World state
// ---------------------------------------------------------------------------
export class World {
  constructor(w = WORLD_W, h = WORLD_H, seed = (Math.random() * 2 ** 31) | 0) {
    this.w = w; this.h = h; this.seed = seed;
    this.tiles = new Uint16Array(w * h);       // tile ids (0 = air)
    this.walls = new Uint16Array(w * h);       // wall ids (0 = none)
    this.liquid = new Uint8Array(w * h);       // 0-255 amount
    this.liquidType = new Uint8Array(w * h);   // 0=water 1=lava
    this.spawnX = (w / 2) | 0;                 // tile coords, set by worldgen
    this.spawnY = 0;
    this.surface = new Int16Array(w);          // surface height per column (worldgen fills)
    this.dirty = new Set();                    // chunk keys needing re-render
    this.onTileChanged = [];                   // fn(tx,ty) subscribers (lighting, liquids, autotile)
  }
  idx(tx, ty) { return ty * this.w + tx; }
  inBounds(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }

  tileAt(tx, ty) { return this.inBounds(tx, ty) ? this.tiles[ty * this.w + tx] : T.air; }
  wallAt(tx, ty) { return this.inBounds(tx, ty) ? this.walls[ty * this.w + tx] : 0; }
  infoAt(tx, ty) { return TILES[this.tileAt(tx, ty)]; }

  isSolid(tx, ty) {
    if (!this.inBounds(tx, ty)) return true;   // world border is solid
    return TILES[this.tiles[ty * this.w + tx]].solid;
  }
  isPlatform(tx, ty) {
    if (!this.inBounds(tx, ty)) return false;
    return TILES[this.tiles[ty * this.w + tx]].platform;
  }

  setTile(tx, ty, id, { silent = false } = {}) {
    if (!this.inBounds(tx, ty)) return;
    const i = ty * this.w + tx;
    if (this.tiles[i] === id) return;
    this.tiles[i] = id;
    if (!silent) this.notifyChanged(tx, ty);
  }
  setWall(tx, ty, id, { silent = false } = {}) {
    if (!this.inBounds(tx, ty)) return;
    this.walls[ty * this.w + tx] = id;
    if (!silent) this.notifyChanged(tx, ty);
  }

  notifyChanged(tx, ty) {
    // mark 3x3 of chunks around the tile dirty (autotile frames of neighbors change too)
    this.markDirty(tx, ty);
    for (const fn of this.onTileChanged) fn(tx, ty);
  }
  markDirty(tx, ty) {
    // Mark the chunk containing each of the 3x3 neighbor tiles (autotile frames of
    // adjacent tiles change too; Set dedupes when they share a chunk).
    const CH = 32;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx, y = ty + dy;
      if (!this.inBounds(x, y)) continue;
      this.dirty.add(((y / CH) | 0) * 4096 + ((x / CH) | 0));
    }
  }
}
