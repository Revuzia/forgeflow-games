// World generation. Pass order mirrors Terraria's structure (simplified):
//   1. surface heightmap  2. soil/stone strata  3. caves (TileRunner walks)
//   4. ore veins  5. biomes (desert/snow strips, underworld)  6. surface grass + trees
//   7. pockets of sand/clay/mud  8. underground cabins + chests  9. life crystals + pots
//   10. spawn point
// Constants tuned per research/terraria/02-world-generation.md; where the doc gives
// Terraria's values for a 4200x1200 small world, we scale to WORLD_W x WORLD_H.

import { LAYERS } from '../config.js';
import { T, W_ } from './world.js';

// --- deterministic PRNG (mulberry32) ---------------------------------------
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 1D value noise with cubic smoothing, few octaves — surface silhouette
function valueNoise1D(rand, n, { octaves = 4, amp = 1, freq = 1 / 96 } = {}) {
  const out = new Float32Array(n);
  for (let o = 0; o < octaves; o++) {
    const f = freq * 2 ** o;
    const a = amp / 2 ** o;
    const period = Math.max(2, Math.round(1 / f));
    const knots = [];
    for (let i = 0; i <= Math.ceil(n / period) + 1; i++) knots.push(rand() * 2 - 1);
    for (let x = 0; x < n; x++) {
      const k = x / period;
      const i = k | 0;
      const t = k - i;
      const s = t * t * (3 - 2 * t);
      out[x] += (knots[i] * (1 - s) + knots[i + 1] * s) * a;
    }
  }
  return out;
}

// --- TileRunner: Terraria's random-walk carver/placer -----------------------
// Walks from (x,y) with a blob of `strength` size for `steps` steps, applying fn.
function tileRunner(world, rand, x, y, strength, steps, fn) {
  let dx = rand() * 2 - 1, dy = rand() * 2 - 1;
  while (steps-- > 0 && strength > 0) {
    const r = Math.max(1, Math.sqrt(strength) * 0.5);
    const x0 = Math.max(1, (x - r) | 0), x1 = Math.min(world.w - 2, (x + r) | 0);
    const y0 = Math.max(1, (y - r) | 0), y1 = Math.min(world.h - 2, (y + r) | 0);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const ddx = tx - x, ddy = ty - y;
        if (ddx * ddx + ddy * ddy <= r * r) fn(tx, ty);
      }
    }
    x += dx; y += dy;
    dx += (rand() * 2 - 1) * 0.5; dy += (rand() * 2 - 1) * 0.5;
    dx = Math.max(-2, Math.min(2, dx));
    dy = Math.max(-2, Math.min(2, dy));
    strength *= 0.99 + rand() * 0.005;
    if (rand() < 0.02) strength *= 0.9;
  }
}

// ----------------------------------------------------------------------------
export function generateWorld(world, onProgress = () => {}) {
  const rand = rng(world.seed);
  const { w, h } = world;
  const set = (tx, ty, id) => { world.tiles[ty * w + tx] = id; };
  const get = (tx, ty) => world.tiles[ty * w + tx];

  // --- 1. surface heightmap --------------------------------------------------
  onProgress(0.05, 'Raising mountains…');
  const surfaceAvg = h * LAYERS.surfaceTop + h * 0.06;
  const noise = valueNoise1D(rand, w, { octaves: 5, amp: h * 0.05, freq: 1 / 110 });
  const surface = world.surface;
  for (let x = 0; x < w; x++) surface[x] = Math.round(surfaceAvg + noise[x]);
  // flatten spawn area (center ±25)
  const mid = (w / 2) | 0;
  const midY = surface[mid];
  for (let x = mid - 25; x <= mid + 25; x++) {
    const t = Math.min(1, Math.abs(x - mid) / 25);
    surface[x] = Math.round(midY * (1 - t) + surface[x] * t);
  }
  // oceans: scoop both edges below waterline
  const oceanW = (w * 0.055) | 0;
  for (let x = 0; x < oceanW; x++) {
    const t = 1 - x / oceanW; // 1 at edge → 0 inland
    surface[x] += Math.round(t * t * h * 0.045);
    surface[w - 1 - x] += Math.round(t * t * h * 0.045);
  }

  // --- 2. strata: dirt above stone, with dithered transition ------------------
  onProgress(0.15, 'Laying strata…');
  const stoneLine = h * LAYERS.underground;
  for (let x = 0; x < w; x++) {
    const s = surface[x];
    const localStone = stoneLine + noise[x] * 0.4 + (rand() - 0.5) * 6;
    for (let y = s; y < h; y++) {
      let id;
      if (y < localStone) id = T.dirt;
      else id = T.stone;
      // dithered dirt/stone boundary band
      if (Math.abs(y - localStone) < 5 && rand() < 0.35) id = id === T.dirt ? T.stone : T.dirt;
      set(x, y, id);
    }
    // natural walls behind everything just below the surface (cave mouths read as
    // dirt-backed caves, not black holes — matches Terraria's surface readability)
    for (let y = s + 1; y < h - 1; y++) {
      world.walls[y * w + x] = y < localStone + 4 ? W_.dirtNatural : W_.stoneNatural;
    }
  }

  // --- 3. caves ---------------------------------------------------------------
  onProgress(0.3, 'Hollowing caves…');
  const carve = (tx, ty) => {
    set(tx, ty, T.air);
  };
  const caveCount = Math.round(w * h / 9000);
  for (let i = 0; i < caveCount; i++) {
    const x = 10 + rand() * (w - 20);
    const yFrac = LAYERS.underground + rand() * (LAYERS.underworld - LAYERS.underground);
    const y = yFrac * h;
    tileRunner(world, rand, x, y, 4 + rand() * 14, 40 + rand() * 160, carve);
  }
  // surface cave entrances
  for (let i = 0; i < w / 140; i++) {
    const x = (20 + rand() * (w - 40)) | 0;
    tileRunner(world, rand, x, surface[x] + 2, 3 + rand() * 4, 60 + rand() * 80, carve);
  }
  // small worm tunnels connecting
  for (let i = 0; i < caveCount * 1.5; i++) {
    const x = 10 + rand() * (w - 20);
    const y = (LAYERS.underground + rand() * (LAYERS.underworld - LAYERS.underground)) * h;
    tileRunner(world, rand, x, y, 2 + rand() * 3, 80 + rand() * 120, carve);
  }

  // --- 4. ore veins ------------------------------------------------------------
  onProgress(0.45, 'Seeding ores…');
  const ore = (id, minFrac, maxFrac, countPer10k, strength, steps) => {
    const y0 = minFrac * h, y1 = maxFrac * h;
    const count = Math.round((w * (y1 - y0)) / 10000 * countPer10k);
    for (let i = 0; i < count; i++) {
      const x = rand() * w, y = y0 + rand() * (y1 - y0);
      tileRunner(world, rand, x, y, strength, steps, (tx, ty) => {
        const cur = get(tx, ty);
        if (cur === T.stone || cur === T.dirt) set(tx, ty, id);
      });
    }
  };
  // depth bands per research 02 (scaled): copper shallow → gold deep
  ore(T.copperOre, LAYERS.surfaceTop, LAYERS.cavern + 0.1, 9, 5, 6);
  ore(T.ironOre,   LAYERS.surfaceTop + 0.05, LAYERS.cavern + 0.2, 8, 5, 6);
  ore(T.silverOre, LAYERS.underground, LAYERS.underworld, 6, 4, 6);
  ore(T.goldOre,   LAYERS.cavern, LAYERS.underworld, 5, 4, 5);
  ore(T.demonite,  LAYERS.cavern + 0.1, LAYERS.underworld, 1.6, 3, 4);

  // clay pockets near surface, mud in lower cavern
  ore(T.clay, LAYERS.surfaceTop, LAYERS.underground + 0.05, 6, 5, 5);
  ore(T.mud,  LAYERS.cavern, LAYERS.underworld, 5, 7, 7);
  // gems (small rare pockets, cavern)
  ore(T.rubyOre,    LAYERS.cavern, LAYERS.underworld, 0.8, 2, 3);
  ore(T.diamondOre, LAYERS.cavern + 0.1, LAYERS.underworld, 0.6, 2, 3);

  // --- 5. biomes ----------------------------------------------------------------
  onProgress(0.6, 'Painting biomes…');
  // desert strip on one side, snow on the other (random which)
  const desertLeft = rand() < 0.5;
  const desertX0 = desertLeft ? w * 0.12 : w * 0.62;
  const desertX1 = desertX0 + w * 0.14;
  const snowX0 = desertLeft ? w * 0.62 : w * 0.12;
  const snowX1 = snowX0 + w * 0.16;
  const jungleX0 = w * 0.32, jungleX1 = w * 0.44;   // band clear of desert/snow/spawn
  world.biomes = { desert: [desertX0 | 0, desertX1 | 0], snow: [snowX0 | 0, snowX1 | 0], jungle: [jungleX0 | 0, jungleX1 | 0], oceanW };
  for (let x = 0; x < w; x++) {
    const inDesert = x >= desertX0 && x < desertX1;
    const inSnow = x >= snowX0 && x < snowX1;
    const inJungle = x >= jungleX0 && x < jungleX1;
    if (!inDesert && !inSnow && !inJungle) continue;
    const depthLimit = stoneLine + h * (inJungle ? 0.1 : 0.06) + noise[x] * 0.3;
    for (let y = surface[x]; y < depthLimit; y++) {
      const cur = get(x, y);
      if (inDesert) {
        if (cur === T.dirt) set(x, y, T.sand);
        else if (cur === T.stone && rand() < 0.7) set(x, y, T.sand);
      } else if (inSnow) {
        if (cur === T.dirt) set(x, y, T.snow);
        else if (cur === T.stone) set(x, y, T.ice);
      } else if (inJungle) {
        if (cur === T.dirt) set(x, y, T.mud);
        else if (cur === T.stone && rand() < 0.4) set(x, y, T.mud);
      }
    }
    if (inJungle && get(x, surface[x]) === T.mud) set(x, surface[x], T.jungleGrass);
  }

  // corruption: 1-2 strips (research 02: 200-600 wide, never near center), evil purple
  const strips = 1 + (rand() < 0.5 ? 1 : 0);
  world.corruption = [];
  for (let s = 0; s < strips; s++) {
    let cx0;
    for (let tries = 0; tries < 50; tries++) {
      cx0 = (w * 0.08 + rand() * w * 0.8) | 0;
      const farFromCenter = Math.abs(cx0 + 60 - mid) > 200;
      const farFromOthers = world.corruption.every(([a]) => Math.abs(a - cx0) > 300);
      if (farFromCenter && farFromOthers) break;
    }
    const cw2 = 90 + (rand() * 60) | 0;
    world.corruption.push([cx0, cx0 + cw2]);
    const depthTo = stoneLine + h * 0.1;
    for (let x = cx0; x < cx0 + cw2 && x < w; x++) {
      for (let y = surface[x]; y < depthTo; y++) {
        const cur = get(x, y);
        if (cur === T.grass) set(x, y, T.corruptGrass);
        else if (cur === T.stone) set(x, y, T.ebonstone);
        else if (cur === T.sand) set(x, y, T.ebonstone);
      }
    }
    // chasms: 2-3 narrow vertical clefts
    for (let c2 = 0; c2 < 2 + (rand() * 2 | 0); c2++) {
      const chx = cx0 + 10 + rand() * (cw2 - 20);
      tileRunner(world, rand, chx, surface[chx | 0] + 4, 3 + rand() * 2, 60 + rand() * 50, (tx2, ty2) => {
        if (ty2 > surface[tx2] + 2) set(tx2, ty2, T.air);
      });
    }
  }

  // underworld: ash + hellstone + lava pools
  const hellY = (h * LAYERS.underworld) | 0;
  for (let x = 0; x < w; x++) {
    for (let y = hellY; y < h; y++) {
      const cur = get(x, y);
      if (cur === T.stone || cur === T.dirt) {
        set(x, y, rand() < 0.06 ? T.hellstone : T.ash);
      }
    }
  }
  // big hell caverns with lava
  for (let i = 0; i < w / 90; i++) {
    const x = rand() * w;
    const y = hellY + rand() * (h - hellY) * 0.7;
    tileRunner(world, rand, x, y, 8 + rand() * 12, 60 + rand() * 90, (tx, ty) => {
      set(tx, ty, T.air);
      if (ty > hellY + (h - hellY) * 0.45) {
        world.liquid[ty * w + tx] = 255;
        world.liquidType[ty * w + tx] = 1;
      }
    });
  }
  // guaranteed lava sea band (research 02: lava sea near the bottom in every world)
  const seaTop = (hellY + (h - hellY) * 0.62) | 0;
  const seaBottom = (hellY + (h - hellY) * 0.82) | 0;
  for (let x = 4; x < w - 4; x++) {
    const wobble = Math.round(Math.sin(x * 0.05) * 2 + (rand() - 0.5) * 2);
    for (let y = seaTop + wobble; y < seaBottom; y++) {
      if (!world.inBounds(x, y)) continue;
      set(x, y, T.air);
      world.liquid[y * w + x] = 255;
      world.liquidType[y * w + x] = 1;
    }
  }

  // ocean water fill
  for (let x = 0; x < oceanW + 8; x++) {
    for (const xx of [x, w - 1 - x]) {
      const waterTop = surfaceAvg + 2;
      for (let y = waterTop | 0; y < surface[xx]; y++) {
        if (get(xx, y) === T.air) {
          world.liquid[y * w + xx] = 255;
          world.liquidType[y * w + xx] = 0;
        }
      }
      // sandy ocean floor
      for (let y = surface[xx]; y < surface[xx] + 12 && y < h; y++) {
        if (get(xx, y) !== T.air) set(xx, y, T.sand);
      }
    }
  }

  // --- 6. grass + trees -----------------------------------------------------------
  onProgress(0.75, 'Growing the forest…');
  for (let x = 0; x < w; x++) {
    const y = surface[x];
    if (get(x, y) === T.dirt) set(x, y, T.grass);
  }
  let lastTree = -10;
  for (let x = 8; x < w - 8; x++) {
    if (x - lastTree < 4) continue;
    if (Math.abs(x - mid) < 8) continue; // keep spawn clear-ish
    const y = surface[x];
    if (get(x, y) !== T.grass && get(x, y) !== T.snow && get(x, y) !== T.jungleGrass) continue;
    if (get(x, y - 1) !== T.air) continue;
    if (rand() > 0.28) continue;
    const height = 6 + (rand() * 8) | 0;
    let ok = true;
    for (let t = 1; t <= height + 2 && ok; t++) if (get(x, y - t) !== T.air) ok = false;
    if (!ok) continue;
    for (let t = 1; t <= height; t++) set(x, y - t, T.treeTrunk);
    // leaf crown
    for (let ly = -2; ly <= 1; ly++) for (let lx = -2; lx <= 2; lx++) {
      const ty = y - height - 1 + ly, tx = x + lx;
      if (Math.abs(lx) + Math.abs(ly) <= 3 && get(tx, ty) === T.air) set(tx, ty, T.treeLeaves);
    }
    lastTree = x;
  }

  // --- 8. underground cabins + chests ----------------------------------------------
  onProgress(0.85, 'Furnishing lost cabins…');
  const cabins = [];
  const cabinCount = Math.round(w / 130);
  for (let i = 0; i < cabinCount; i++) {
    const cx = (30 + rand() * (w - 60)) | 0;
    const cy = ((LAYERS.underground + 0.03 + rand() * (LAYERS.underworld - LAYERS.underground - 0.1)) * h) | 0;
    const cw = 8 + (rand() * 5) | 0, ch = 5 + (rand() * 2) | 0;
    // hollow room with wood shell + wood walls
    for (let y = cy - ch; y <= cy; y++) for (let x = cx - (cw / 2 | 0); x <= cx + (cw / 2 | 0); x++) {
      if (!world.inBounds(x, y)) continue;
      const isShell = y === cy - ch || y === cy || x === cx - (cw / 2 | 0) || x === cx + (cw / 2 | 0);
      set(x, y, isShell ? T.wood : T.air);
      world.walls[y * w + x] = W_.woodWall;
    }
    // chest + torch inside
    const chestX = cx - (cw / 2 | 0) + 2;
    set(chestX, cy - 1, T.chest);
    set(cx + 1, cy - 1, T.torch);
    cabins.push([chestX, cy - 1]);
  }
  world.genChests = cabins; // chests.js seeds loot from these

  // demon altars in cavern caves + hellforges in the underworld
  let altars = 0;
  for (let tries = 0; tries < 4000 && altars < Math.round(w / 250); tries++) {
    const x = (10 + rand() * (w - 20)) | 0;
    const y = ((LAYERS.cavern + rand() * (LAYERS.underworld - LAYERS.cavern - 0.05)) * h) | 0;
    if (get(x, y) === T.air && world.isSolid(x, y + 1) && get(x, y - 1) === T.air) {
      set(x, y, T.demonAltar);
      altars++;
    }
  }
  let forges = 0;
  for (let tries = 0; tries < 4000 && forges < Math.round(w / 300); tries++) {
    const x = (10 + rand() * (w - 20)) | 0;
    const y = (hellY + 5 + rand() * (h - hellY - 10)) | 0;
    if (get(x, y) === T.air && world.isSolid(x, y + 1) && world.liquid[y * w + x] === 0) {
      set(x, y, T.hellforge);
      forges++;
    }
  }

  // pots in caves
  const pots = Math.round(w * h / 14000);
  for (let i = 0; i < pots; i++) {
    const x = (5 + rand() * (w - 10)) | 0;
    const y = ((LAYERS.underground * h) + rand() * (h * LAYERS.underworld - LAYERS.underground * h)) | 0;
    if (get(x, y) === T.air && get(x, y + 1) !== T.air && world.isSolid(x, y + 1)) set(x, y, T.pot);
  }

  // --- 9. life crystals ---------------------------------------------------------------
  const crystals = Math.round(w / 110);
  for (let i = 0; i < crystals; i++) {
    for (let tries = 0; tries < 40; tries++) {
      const x = (10 + rand() * (w - 20)) | 0;
      const y = ((LAYERS.cavern + rand() * (LAYERS.underworld - LAYERS.cavern)) * h) | 0;
      if (get(x, y) === T.air && world.isSolid(x, y + 1)) { set(x, y, T.lifeCrystal); break; }
    }
  }

  // --- 9.5 surface readability pass: no invisible pinhole shafts -------------------------
  // 1-tile-wide vertical shafts on the walk surface are fall-through traps the player
  // can't see. Widen them to 2 tiles so cave mouths read clearly.
  {
    const groundOf = (x) => {
      let y = 0;
      while (y < h && !world.isSolid(x, y)) y++;
      return y;
    };
    const ground = new Int16Array(w);
    for (let x = 0; x < w; x++) ground[x] = groundOf(x);
    for (let x = 2; x < w - 2; x++) {
      const l = ground[x - 1], c = ground[x], r = ground[x + 1];
      if (c - l > 5 && c - r > 5) {
        // pinhole: carve the shallower neighbor down a few tiles to widen the mouth
        const side = l <= r ? x - 1 : x + 1;
        const from = Math.min(l, r);
        for (let y = from; y < from + 6 && y < h; y++) {
          const id = get(side, y);
          if (id !== T.air) set(side, y, T.air);
        }
        ground[side] = groundOf(side);
      }
    }
  }

  // --- 10. spawn ------------------------------------------------------------------------
  world.spawnX = mid;
  world.spawnY = surface[mid] - 3;
  onProgress(1, 'World ready');
  // everything is dirty once
  world.dirty.clear();
  const CH = 32;
  for (let cy = 0; cy < Math.ceil(h / CH); cy++)
    for (let cx = 0; cx < Math.ceil(w / CH); cx++)
      world.dirty.add(cy * 4096 + cx);
}
