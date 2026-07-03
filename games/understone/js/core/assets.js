// Asset loading + textured tile rendering.
// Tiles draw from seamless 64x64 textures (4x4 grid of 16px cells sampled by world
// position, so neighbors vary naturally), with procedural edge shading where a tile
// meets air or a different merge family — the Terraria "chunky outline" look.
// Furniture/torches are hand-drawn pixel sprites on cached canvases.
// Every texture has a color fallback so the game still runs if an image is missing.

import { TILE } from '../config.js';
import { T, TILES, WALLS } from '../world/world.js';

const TILE_TEXTURES = [
  'dirt', 'stone', 'grass', 'wood', 'sand', 'snow', 'ice', 'mud', 'clay', 'ash',
  'obsidian', 'hellstone', 'copperOre', 'ironOre', 'silverOre', 'goldOre',
  'demonite', 'rubyOre', 'diamondOre', 'jungleGrass', 'ebonstone', 'corruptGrass',
];
const WALL_TEXTURES = ['dirtNatural', 'stoneNatural', 'woodWall'];
const SPRITES = ['player', 'slime', 'zombie', 'skeleton', 'demonEye', 'bat', 'fireImp', 'wormSegment', 'eyeOfCthulhu', 'kingSlime'];

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function loadAssets(onProgress = () => {}) {
  const assets = { tiles: {}, walls: {}, sprites: {}, bg: {} };
  const jobs = [];
  for (const name of TILE_TEXTURES) jobs.push(['tiles', name, `assets/tiles/${name}.png`]);
  for (const name of WALL_TEXTURES) jobs.push(['walls', name, `assets/walls/${name}.png`]);
  for (const name of SPRITES) jobs.push(['sprites', name, `assets/entities/${name}.png`]);
  for (const name of ['hills', 'desert', 'snow', 'jungle', 'corruption', 'ocean', 'graveyard']) jobs.push(['bg', name, `assets/bg/${name}.png`]);
  let doneCount = 0;
  await Promise.all(jobs.map(async ([cat, name, src]) => {
    assets[cat][name] = await loadImage(src);
    onProgress(++doneCount / jobs.length);
  }));
  assets.furniture = buildFurnitureSprites();
  return assets;
}

// ---------------------------------------------------------------------------
// Procedural furniture / decoration sprites (16x16 unless noted), cached.
// ---------------------------------------------------------------------------
function px(ctx, x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }

function buildFurnitureSprites() {
  const make = (draw, w = 16, h = 16) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'));
    return c;
  };
  return {
    torch: make((c) => {
      px(c, 7, 6, 2, 9, '#7a5230');
      px(c, 6, 14, 4, 1, '#5a3a20');
      px(c, 6, 3, 4, 4, '#ffb43a');
      px(c, 7, 2, 2, 2, '#ffe08a');
      px(c, 7, 4, 2, 2, '#ff7a2a');
    }),
    workbench: make((c) => {
      px(c, 0, 6, 16, 3, '#8a6238');
      px(c, 0, 6, 16, 1, '#a87c4c');
      px(c, 1, 9, 2, 7, '#6e4c28');
      px(c, 13, 9, 2, 7, '#6e4c28');
      px(c, 3, 10, 4, 2, '#6e4c28');
    }),
    furnace: make((c) => {
      px(c, 1, 4, 14, 12, '#6a6a74');
      px(c, 2, 5, 12, 10, '#54545e');
      px(c, 4, 9, 8, 6, '#2a2a30');
      px(c, 5, 10, 6, 4, '#ff8a2a');
      px(c, 6, 11, 4, 2, '#ffcf5a');
      px(c, 3, 1, 3, 3, '#54545e');
    }),
    anvil: make((c) => {
      px(c, 2, 5, 12, 3, '#8a8a96');
      px(c, 12, 5, 3, 2, '#8a8a96');
      px(c, 6, 8, 4, 3, '#5e5e68');
      px(c, 4, 11, 8, 3, '#6e6e78');
      px(c, 2, 5, 12, 1, '#b8b8c4');
    }),
    bottle: make((c) => {
      px(c, 6, 8, 4, 7, '#9fd0e8');
      px(c, 7, 5, 2, 3, '#9fd0e8');
      px(c, 7, 4, 2, 1, '#d8b46a');
      px(c, 6, 9, 1, 4, '#d8ecf5');
    }),
    chest: make((c) => {
      px(c, 1, 5, 14, 10, '#8a6238');
      px(c, 1, 5, 14, 4, '#a87c4c');
      px(c, 1, 8, 14, 1, '#5e4224');
      px(c, 7, 8, 2, 3, '#e8c95a');
      px(c, 0, 14, 16, 1, '#5e4224');
    }),
    door: make((c) => {
      px(c, 4, 0, 8, 16, '#87643c');
      px(c, 5, 1, 6, 14, '#9a744a');
      px(c, 6, 2, 4, 5, '#7a5a34');
      px(c, 6, 9, 4, 5, '#7a5a34');
      px(c, 10, 8, 1, 2, '#e8c95a');
    }),
    doorOpen: make((c) => {
      px(c, 12, 0, 4, 16, '#87643c');
      px(c, 13, 1, 2, 14, '#9a744a');
    }),
    lifeCrystal: make((c) => {
      px(c, 5, 4, 6, 9, '#c42a4e');
      px(c, 6, 3, 4, 2, '#e84a6a');
      px(c, 6, 5, 2, 4, '#ff8aa0');
      px(c, 4, 12, 8, 2, '#8a8a96');
    }),
    cobweb: make((c) => {
      c.strokeStyle = 'rgba(230,230,240,0.8)';
      c.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        c.beginPath(); c.moveTo(8, 8); c.lineTo(2 + i * 6, 0); c.stroke();
        c.beginPath(); c.moveTo(8, 8); c.lineTo(2 + i * 6, 16); c.stroke();
      }
      c.beginPath(); c.arc(8, 8, 4, 0, Math.PI * 2); c.stroke();
    }),
    pot: make((c) => {
      px(c, 4, 6, 8, 9, '#a8825a');
      px(c, 3, 8, 10, 4, '#a8825a');
      px(c, 5, 4, 6, 2, '#8a6a48');
      px(c, 5, 7, 2, 5, '#c09a6e');
      px(c, 4, 14, 8, 1, '#7a5c3e');
    }),
    sapling: make((c) => {
      px(c, 7, 9, 2, 6, '#6b4a2a');
      px(c, 5, 5, 6, 5, '#4a9a3a');
      px(c, 6, 3, 4, 3, '#5ab44a');
    }),
    demonAltar: make((c) => {
      px(c, 2, 9, 12, 6, '#5a3a6a');
      px(c, 4, 6, 8, 3, '#7a4a94');
      px(c, 6, 3, 4, 3, '#a05ac0');
      px(c, 7, 1, 2, 2, '#e8a0ff');
    }),
    hellforge: make((c) => {
      px(c, 1, 5, 14, 11, '#7a4030');
      px(c, 2, 6, 12, 9, '#5e3024');
      px(c, 4, 9, 8, 6, '#2a1410');
      px(c, 5, 10, 6, 4, '#ff6a1a');
      px(c, 6, 11, 4, 2, '#ffd75a');
      px(c, 3, 2, 4, 3, '#5e3024');
      px(c, 9, 2, 4, 3, '#5e3024');
    }),
    spawnPoint: make((c) => {
      px(c, 1, 8, 14, 4, '#c8b890');
      px(c, 1, 6, 4, 4, '#e8e0c0');
      px(c, 1, 12, 2, 3, '#8a6a48');
      px(c, 13, 12, 2, 3, '#8a6a48');
    }),
    treeLeaves: make((c) => {
      px(c, 1, 1, 14, 14, '#3e8948');
      px(c, 3, 0, 10, 16, '#3e8948');
      px(c, 0, 3, 16, 10, '#3e8948');
      px(c, 2, 2, 5, 4, '#54a85e');
      px(c, 9, 8, 5, 4, '#2e6e38');
    }),
    chair: make((c) => {
      px(c, 4, 3, 2, 12, '#8a6238');
      px(c, 4, 8, 8, 2, '#a87c4c');
      px(c, 10, 10, 2, 5, '#8a6238');
      px(c, 4, 3, 2, 5, '#a87c4c');
    }),
    table: make((c) => {
      px(c, 1, 7, 14, 2, '#a87c4c');
      px(c, 1, 7, 14, 1, '#c09a6e');
      px(c, 2, 9, 2, 6, '#8a6238');
      px(c, 12, 9, 2, 6, '#8a6238');
    }),
    campfire: make((c) => {
      px(c, 2, 12, 12, 3, '#6b4a2a');
      px(c, 4, 13, 8, 2, '#8a6238');
      px(c, 5, 6, 6, 6, '#ff8a2a');
      px(c, 6, 4, 4, 4, '#ffcf5a');
      px(c, 7, 2, 2, 3, '#ffe08a');
    }),
    lantern: make((c) => {
      px(c, 7, 0, 2, 3, '#8a8a96');
      px(c, 5, 3, 6, 9, '#b8935a');
      px(c, 6, 4, 4, 7, '#ffe08a');
      px(c, 5, 12, 6, 2, '#8a6a3a');
    }),
    candle: make((c) => {
      px(c, 5, 12, 6, 3, '#b8935a');
      px(c, 7, 6, 2, 6, '#f0e6d0');
      px(c, 7, 3, 2, 3, '#ffcf5a');
      px(c, 7, 2, 2, 2, '#ffe08a');
    }),
    sawmill: make((c) => {
      px(c, 1, 8, 14, 7, '#7a5c36');
      px(c, 2, 9, 12, 5, '#8a6a42');
      c.strokeStyle = '#c9ccd8'; c.lineWidth = 1;
      c.beginPath(); c.arc(8, 7, 4, 0, Math.PI * 2); c.stroke();
      px(c, 7, 3, 2, 2, '#c9ccd8');
    }),
    loom: make((c) => {
      px(c, 2, 3, 2, 12, '#8a6238');
      px(c, 12, 3, 2, 12, '#8a6238');
      px(c, 2, 3, 12, 2, '#a87c4c');
      for (let i = 0; i < 5; i++) px(c, 4 + i * 2, 5, 1, 9, '#e8e0d0');
      px(c, 3, 9, 10, 1, '#c05a5a');
    }),
    bed: make((c) => {
      px(c, 1, 9, 14, 4, '#b04a5a');
      px(c, 1, 8, 5, 3, '#f0e6d0');
      px(c, 1, 13, 2, 2, '#8a6238');
      px(c, 13, 13, 2, 2, '#8a6238');
      px(c, 1, 9, 14, 1, '#d06a7a');
    }),
  };
}

// ---------------------------------------------------------------------------
// Textured tile drawer — plugs into TileRenderer.drawTileHook
// ---------------------------------------------------------------------------
export function makeTileDrawer(world, assets) {
  const mergeOf = (id) => id === T.air ? null : TILES[id].merge;
  const FURN_BY_NAME = {
    torch: 'torch', workbench: 'workbench', furnace: 'furnace', anvil: 'anvil',
    bottle: 'bottle', chest: 'chest', door: 'door', doorOpen: 'doorOpen',
    lifeCrystal: 'lifeCrystal', cobweb: 'cobweb', pot: 'pot', sapling: 'sapling',
    demonAltar: 'demonAltar', hellforge: 'hellforge', spawnPoint: 'spawnPoint',
    treeLeaves: 'treeLeaves',
    chair: 'chair', table: 'table', campfire: 'campfire', lantern: 'lantern',
    candle: 'candle', sawmill: 'sawmill', loom: 'loom', bed: 'bed',
  };

  return function drawTile(ctx, tx, ty, info, px, py) {
    // furniture / cross-style sprites
    const furn = FURN_BY_NAME[info.name];
    if (furn && assets.furniture[furn]) {
      ctx.drawImage(assets.furniture[furn], px, py, TILE, TILE);
      return;
    }
    if (info.name === 'treeTrunk') {
      const tex = assets.tiles.wood;
      if (tex) {
        ctx.drawImage(tex, ((tx % 4) + 4) % 4 * 16, ((ty % 4) + 4) % 4 * 16, 16, 16, px + 3, py, 10, TILE);
        ctx.fillStyle = 'rgba(40,22,8,0.45)';
        ctx.fillRect(px + 3, py, 2, TILE);
        ctx.fillRect(px + 11, py, 2, TILE);
      } else {
        ctx.fillStyle = info.color; ctx.fillRect(px + 3, py, 10, TILE);
      }
      return;
    }
    if (info.platform) {
      const tex = assets.tiles.wood;
      if (tex) {
        ctx.drawImage(tex, ((tx % 4) + 4) % 4 * 16, 0, 16, 6, px, py, TILE, 6);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(px, py + 5, TILE, 1);
      } else { ctx.fillStyle = info.color; ctx.fillRect(px, py, TILE, 6); }
      return;
    }

    const tex = assets.tiles[info.name];
    if (!tex) {
      // color fallback with simple bevel
      ctx.fillStyle = info.color;
      ctx.fillRect(px, py, TILE, TILE);
    } else {
      const sx = ((tx % 4) + 4) % 4 * 16, sy = ((ty % 4) + 4) % 4 * 16;
      ctx.drawImage(tex, sx, sy, 16, 16, px, py, TILE, TILE);
    }

    // procedural edging vs air / different merge family
    const my = info.merge;
    const nUp = world.tileAt(tx, ty - 1), nDown = world.tileAt(tx, ty + 1);
    const nLeft = world.tileAt(tx - 1, ty), nRight = world.tileAt(tx + 1, ty);
    const openUp = nUp === T.air || (!TILES[nUp].solid && !TILES[nUp].platform);
    const openDown = nDown === T.air || (!TILES[nDown].solid && !TILES[nDown].platform);
    const openLeft = nLeft === T.air || (!TILES[nLeft].solid && !TILES[nLeft].platform);
    const openRight = nRight === T.air || (!TILES[nRight].solid && !TILES[nRight].platform);
    const diffUp = !openUp && mergeOf(nUp) !== my;
    const diffDown = !openDown && mergeOf(nDown) !== my;
    const diffLeft = !openLeft && mergeOf(nLeft) !== my;
    const diffRight = !openRight && mergeOf(nRight) !== my;

    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    if (openUp) ctx.fillRect(px, py, TILE, 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    if (openDown) ctx.fillRect(px, py + TILE - 2, TILE, 2);
    if (openLeft) ctx.fillRect(px, py, 2, TILE);
    if (openRight) ctx.fillRect(px + TILE - 2, py, 2, TILE);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    if (diffUp) ctx.fillRect(px, py, TILE, 1);
    if (diffDown) ctx.fillRect(px, py + TILE - 1, TILE, 1);
    if (diffLeft) ctx.fillRect(px, py, 1, TILE);
    if (diffRight) ctx.fillRect(px + TILE - 1, py, 1, TILE);

    // grass lip: green overhang onto open sides
    if (info.name === 'grass' || info.name === 'jungleGrass' || info.name === 'corruptGrass') {
      const gc = info.name === 'grass' ? '#4caf50' : info.name === 'corruptGrass' ? '#7a68a8' : '#2e9e3e';
      ctx.fillStyle = gc;
      if (openLeft) ctx.fillRect(px, py, 3, TILE);
      if (openRight) ctx.fillRect(px + TILE - 3, py, 3, TILE);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      if (openUp) ctx.fillRect(px, py, TILE, 2);
      // ambient grass tufts above (research 07 P1: living surface), hash-seeded
      if (openUp) {
        const hsh = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
        if (hsh % 3 !== 0) {
          ctx.fillStyle = gc;
          const n = 2 + (hsh % 3);
          for (let b = 0; b < n; b++) {
            const bx = px + 2 + ((hsh >> (b * 3)) % 12);
            const bh = 2 + ((hsh >> (b * 2 + 1)) % 4);
            ctx.fillRect(bx, py - bh, 1, bh);
          }
          if (hsh % 7 === 0) { // occasional flower
            ctx.fillStyle = ['#e8d05a', '#e87a9a', '#8ab4e8'][hsh % 3];
            ctx.fillRect(px + 4 + (hsh % 8), py - 5, 2, 2);
          }
        }
      }
    }
    // stalactites under stone ceilings, hash-seeded
    if (info.merge === 'rock' && openDown) {
      const hsh = ((tx * 83492791) ^ (ty * 2654435761)) >>> 0;
      if (hsh % 4 === 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        const sxp = px + 4 + (hsh % 8);
        const sh = 3 + (hsh % 5);
        ctx.fillStyle = info.color;
        ctx.fillRect(sxp, py + TILE, 2, sh);
        ctx.fillRect(sxp, py + TILE + sh, 1, 2);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Animated characters (PixelLab): assets/entities/<name>/meta.json +
// <anim>/frame_XXX.png (east-facing; west is mirrored at draw time).
// Loaded lazily; callers get null until ready and fall back to static sprites.
// ---------------------------------------------------------------------------
const charCache = new Map();  // name → {base, anims:{name:[Image]}} | 'loading' | 'missing'
export function character(name) {
  const c = charCache.get(name);
  if (c === 'loading' || c === 'missing') return null;
  if (c) return c;
  charCache.set(name, 'loading');
  (async () => {
    try {
      const res = await fetch(`assets/entities/${name}/meta.json`);
      if (!res.ok) { charCache.set(name, 'missing'); return; }
      const meta = await res.json();
      const rec = { meta, anims: {} };
      rec.base = await loadImage(`assets/entities/${name}/base.png`);
      // measure the opaque content box of the base frame (PixelLab pads canvases ~40%)
      if (rec.base) {
        const mc = document.createElement('canvas');
        mc.width = rec.base.width; mc.height = rec.base.height;
        const mg = mc.getContext('2d', { willReadFrequently: true });
        mg.drawImage(rec.base, 0, 0);
        const d = mg.getImageData(0, 0, mc.width, mc.height).data;
        let minX = mc.width, minY = mc.height, maxX = 0, maxY = 0;
        for (let y = 0; y < mc.height; y++) {
          for (let x = 0; x < mc.width; x++) {
            if (d[(y * mc.width + x) * 4 + 3] > 40) {
              if (x < minX) minX = x; if (x > maxX) maxX = x;
              if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
          }
        }
        rec.content = maxX >= minX
          ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
          : { x: 0, y: 0, w: mc.width, h: mc.height };
      }
      await Promise.all(Object.entries(meta.animations ?? {}).map(async ([anim, info]) => {
        const frames = [];
        for (let f = 0; f < info.frames; f++) {
          frames.push(loadImage(`assets/entities/${name}/${anim}/frame_${String(f).padStart(3, '0')}.png`));
        }
        rec.anims[anim] = (await Promise.all(frames)).filter(Boolean);
      }));
      charCache.set(name, rec);
    } catch { charCache.set(name, 'missing'); }
  })();
  return null;
}

// ---------------------------------------------------------------------------
// Item sprites (held-in-hand + inventory). PixelLab icons at assets/items/<id>.png;
// procedural tool silhouettes as fallback so the hand is never empty.
// ---------------------------------------------------------------------------
const itemIconCache = new Map();   // id → Image | 'missing' | 'loading'
export function itemIcon(id) {
  const c = itemIconCache.get(id);
  if (c === 'loading' || c === 'missing') return null;
  if (c) return c;
  itemIconCache.set(id, 'loading');
  const img = new Image();
  img.onload = () => itemIconCache.set(id, img);
  img.onerror = () => itemIconCache.set(id, 'missing');
  img.src = `assets/items/${id}.png`;
  return null;
}

const toolFallbackCache = new Map();
export function toolFallbackSprite(kind, tint = '#c9ccd8') {
  const key = `${kind}:${tint}`;
  if (toolFallbackCache.has(key)) return toolFallbackCache.get(key);
  const c = document.createElement('canvas');
  c.width = 16; c.height = 16;
  const g = c.getContext('2d');
  const wood = '#8a6238';
  if (kind === 'pickaxe') {
    px(g, 3, 12, 10, 2, wood);                     // handle (diagonal-ish)
    g.save(); g.translate(8, 8); g.rotate(-0.7);
    px(g, -7, -2, 14, 3, tint);                    // pick head
    g.restore();
  } else if (kind === 'axe') {
    px(g, 7, 4, 2, 11, wood);
    px(g, 4, 2, 8, 5, tint);
    px(g, 3, 3, 3, 3, tint);
  } else if (kind === 'hammer') {
    px(g, 7, 5, 2, 10, wood);
    px(g, 3, 1, 10, 5, tint);
  } else if (kind === 'sword') {
    g.save(); g.translate(8, 8); g.rotate(0.78);
    px(g, -1, -8, 2, 12, tint);                    // blade
    px(g, -3, 3, 6, 2, '#a8862a');                 // guard
    px(g, -1, 5, 2, 3, wood);                      // grip
    g.restore();
  } else if (kind === 'bow') {
    g.strokeStyle = wood; g.lineWidth = 2;
    g.beginPath(); g.arc(6, 8, 6, -1.2, 1.2); g.stroke();
    g.strokeStyle = '#d8d8e0'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(8, 2.5); g.lineTo(8, 13.5); g.stroke();
  } else {
    px(g, 5, 5, 6, 6, tint);
  }
  toolFallbackCache.set(key, c);
  return c;
}

// pre-rendered swing arc flash (research 10 §5a): quarter annulus, per element tint
const arcCache = new Map();
export function arcSprite(radius, tint = '#ffffff') {
  const key = `${radius}:${tint}`;
  if (arcCache.has(key)) return arcCache.get(key);
  const size = radius * 2 + 4;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  g.translate(size / 2, size / 2);
  for (const [rOut, alpha] of [[radius, 0.9], [radius - 3, 0.45]]) {
    g.globalAlpha = alpha;
    g.strokeStyle = tint;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, rOut - 2, -Math.PI * 0.55, Math.PI * 0.15);
    g.stroke();
  }
  arcCache.set(key, c);
  return c;
}

// wall drawer used by renderer (behind tiles)
export function makeWallDrawer(assets) {
  return function drawWall(ctx, tx, ty, wallInfo, px, py) {
    const tex = assets.walls[wallInfo.name];
    if (tex) {
      const sx = ((tx % 4) + 4) % 4 * 16, sy = ((ty % 4) + 4) % 4 * 16;
      ctx.drawImage(tex, sx, sy, 16, 16, px, py, TILE, TILE);
    } else {
      ctx.fillStyle = wallInfo.color;
      ctx.fillRect(px, py, TILE, TILE);
    }
  };
}
