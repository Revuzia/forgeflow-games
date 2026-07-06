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
  // biome-distinct surface CHARACTER so you're not climbing the same plateau everywhere.
  // Keyed to the same ring bands as step 5 (forest center → graveyard → desert → snow); the
  // safety pass (9.5) later smooths any seam between bands, so exact blending isn't needed.
  const bandW = Math.floor((mid - oceanW) / 4);   // same band width as the step-5 biome ring
  const duneN = valueNoise1D(rand, w, { octaves: 2, amp: h * 0.030, freq: 1 / 210 });  // desert: smooth flowing dunes
  const rollN = valueNoise1D(rand, w, { octaves: 3, amp: h * 0.045, freq: 1 / 70 });   // snow: tall rolling hills
  const jagN = valueNoise1D(rand, w, { octaves: 5, amp: h * 0.030, freq: 1 / 34 });    // graveyard: restless, uneven
  for (let x = oceanW; x < w - oceanW; x++) {
    const d = Math.abs(x - mid);
    if (d <= bandW) continue;                                  // forest: keep the gentle base terrain
    else if (d <= 2 * bandW) surface[x] += Math.round(jagN[x] * 0.7);   // graveyard
    else if (d <= 3 * bandW) surface[x] += Math.round(duneN[x]);        // desert
    else surface[x] += Math.round(rollN[x]);                           // snow
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
  // underground water pools (fishable caves — Terraria's waterLine band)
  for (let i = 0; i < w / 160; i++) {
    const x = 20 + rand() * (w - 40);
    const y = (LAYERS.underground + 0.02 + rand() * (LAYERS.underworld - LAYERS.underground - 0.2)) * h;
    tileRunner(world, rand, x, y, 5 + rand() * 8, 30 + rand() * 50, (tx, ty) => {
      set(tx, ty, T.air);
      if (ty > y) {  // fill the lower half of the pocket
        world.liquid[ty * w + tx] = 255;
        world.liquidType[ty * w + tx] = 0;
      }
    });
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
  // Difficulty RING around the central spawn (spawnX = mid). Forest (easy) hugs the spawn; going out
  // in EITHER direction you cross graveyard → desert → snow (hardest), MIRRORED on both sides so
  // exploring either way ramps up the same. Each band is ~1/4 of the half-world (~6 screens), and the
  // spawn keeps a full forest band of buffer before anything dangerous. Enemies are biome-gated in the
  // spawner (see pickType): forest = slimes only, graveyard = undead, desert = wasps, snow = worst.
  const bw = Math.floor((mid - oceanW) / 4);           // band width in tiles (~233)
  const mkRange = (a, b) => [Math.max(0, a) | 0, b | 0];
  const forestBand = mkRange(mid - bw, mid + bw);
  const gyL = mkRange(mid - 2 * bw, mid - bw), gyR = mkRange(mid + bw, mid + 2 * bw);
  const deL = mkRange(mid - 3 * bw, mid - 2 * bw), deR = mkRange(mid + 2 * bw, mid + 3 * bw);
  const snL = mkRange(oceanW + 11, mid - 3 * bw), snR = mkRange(mid + 3 * bw, w - oceanW - 11);  // clear the ocean margin (spawner classifies ±(oceanW+10) as ocean)
  // each biome is a list of x-intervals (mirrored pairs); forest is the default gap between them
  world.biomes = { forest: [forestBand], graveyard: [gyL, gyR], desert: [deL, deR], snow: [snL, snR], oceanW };
  const inSeg = (x, s) => x >= s[0] && x < s[1];
  for (let x = 0; x < w; x++) {
    const inDesert = inSeg(x, deL) || inSeg(x, deR);
    const inSnow = inSeg(x, snL) || inSeg(x, snR);
    const inGrave = inSeg(x, gyL) || inSeg(x, gyR);
    if (!inDesert && !inSnow && !inGrave) continue;
    const depthLimit = stoneLine + h * 0.06 + noise[x] * 0.3;
    for (let y = surface[x]; y < depthLimit; y++) {
      const cur = get(x, y);
      if (inDesert) {
        if (cur === T.dirt || cur === T.grass) set(x, y, T.sand);
        else if (cur === T.stone && rand() < 0.7) set(x, y, T.sand);
      } else if (inSnow) {
        if (cur === T.dirt || cur === T.grass) set(x, y, T.snow);
        else if (cur === T.stone) set(x, y, T.ice);
      } else if (inGrave) {                              // graveyard: barren gray ash ground
        if (cur === T.dirt || cur === T.grass) set(x, y, T.ash);
        else if (cur === T.stone && rand() < 0.4) set(x, y, T.ash);
      }
    }
  }
  // graveyard atmosphere: sparse cobwebs strung through the shallow ground
  for (const s of [gyL, gyR]) {
    for (let x = s[0]; x < s[1]; x++) {
      for (let y = surface[x]; y < surface[x] + 22 && y < h; y++) {
        if (get(x, y) === T.air && rand() < 0.02) set(x, y, T.cobweb);
      }
    }
  }

  // corruption: 1-2 strips (research 02: 200-600 wide, never near center), evil purple
  const strips = 1 + (rand() < 0.5 ? 1 : 0);
  world.corruption = [];
  for (let s = 0; s < strips; s++) {
    const cw2 = 90 + (rand() * 60) | 0;
    let cx0 = 0, placed = false;
    for (let tries = 0; tries < 60; tries++) {
      cx0 = (oceanW + 20 + rand() * (w - 2 * oceanW - cw2 - 40)) | 0;
      // keep corruption ENTIRELY outside the safe spawn forest — its stronger mobs (eaterOfSouls)
      // must never bleed into the beginner area (graveyard-tier distance from spawn or deeper)
      const clearOfForest = cx0 + cw2 < mid - bw || cx0 > mid + bw;
      const farFromOthers = world.corruption.every(([a, bb]) => cx0 + cw2 < a - 30 || cx0 > bb + 30);
      if (clearOfForest && farFromOthers) { placed = true; break; }
    }
    if (!placed) continue;   // couldn't find a spot clear of the forest — skip this strip, never bleed into spawn
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

  // --- 9.4 settlements: discoverable towns (explore far → find people) --------------------
  // A reusable house builder; registers the chest for loot seeding and returns the door tile.
  world.townNpcs = [];
  const buildHouse = (hx, groundY, hw = 12, hh = 7, furnish = true) => {
    const top = groundY - hh;
    for (let x = hx; x < hx + hw; x++) {
      // level the ground under the house
      for (let y = groundY + 1; y <= groundY + 3; y++) if (get(x, y) === T.air) set(x, y, T.dirt);
      for (let y = top; y <= groundY; y++) {
        const shell = (x === hx || x === hx + hw - 1 || y === top || y === groundY);
        set(x, y, shell ? T.wood : T.air);
        world.walls[y * w + x] = W_.woodWall;
      }
    }
    // 3-tall doorway carved into the left wall
    set(hx, groundY - 1, T.door); set(hx, groundY - 2, T.door); set(hx, groundY - 3, T.door);
    if (furnish) {
      set(hx + 2, groundY - 1, T.torch);
      set(hx + 4, groundY - 1, T.chair);
      set(hx + 6, groundY - 1, T.table);
      if (rand() < 0.6) {
        set(hx + hw - 3, groundY - 1, T.chest);
        world.genChests = world.genChests ?? [];
        world.genChests.push([hx + hw - 3, groundY - 1]);
      } else {
        set(hx + hw - 3, groundY - 1, T.workbench);
      }
    }
    return [hx, groundY - 1];
  };

  // surface outposts at the far ends (abandoned hamlets — ready housing + loot)
  const outposts = [];
  for (const fx of [0.16, 0.84]) {
    const ox2 = (w * fx) | 0;
    if (ox2 < oceanW + 30 || ox2 > w - oceanW - 60) continue;
    const gy = surface[ox2] - 1;
    buildHouse(ox2, gy);
    buildHouse(ox2 + 15, surface[ox2 + 15] - 1, 10, 6);
    outposts.push(ox2);
  }
  // far outposts host residents (reward for traveling): Angler west, Wizard east
  if (outposts.length > 0) {
    world.townNpcs.push({ type: 'angler', x: (outposts[0] + 5) * 16, y: (surface[outposts[0]] - 2) * 16 });
  }
  if (outposts.length > 1) {
    world.townNpcs.push({ type: 'wizard', x: (outposts[1] + 5) * 16, y: (surface[outposts[1]] - 2) * 16 });
  }

  // underground mining town: carved chamber in the cavern with resident traders
  {
    const mx = (w * (0.3 + rand() * 0.4)) | 0;
    const my = ((LAYERS.cavern + 0.05 + rand() * 0.15) * h) | 0;
    const roomW = 46, roomH = 13;
    for (let x = mx; x < mx + roomW; x++) {
      for (let y = my - roomH; y <= my; y++) {
        if (!world.inBounds(x, y)) continue;
        const shell = (y === my || y === my - roomH || x === mx || x === mx + roomW - 1);
        set(x, y, shell ? T.stone : T.air);
        world.walls[y * w + x] = W_.stoneNatural;
      }
    }
    // two cabins inside + lanterns + a walkway
    buildHouse(mx + 4, my - 1, 12, 7);
    buildHouse(mx + 22, my - 1, 12, 7);
    for (let x = mx + 2; x < mx + roomW - 2; x += 6) set(x, my - roomH + 1, T.lantern);
    set(mx + 38, my - 1, T.campfire);
    world.townNpcs.push({ type: 'oldMiner', x: (mx + 9) * 16, y: (my - 1) * 16 });
    world.townNpcs.push({ type: 'deepTrader', x: (mx + 27) * 16, y: (my - 1) * 16 });
    world.miningTown = [mx, my];
  }

  // --- 9.5 surface SAFETY pass: seal EVERY natural fall-through on the walkable surface ---
  // Owner rule: you may fall only through gaps YOU dig — never through natural ground.
  //
  // The traps are steep DOWNWARD drops — sheer cliffs and one-sided bowls where you walk off a
  // ledge and free-fall. We eliminate them by SLOPE-LIMITING the surface heightmap: no column's
  // surface may sit more than STEP tiles below its neighbour on either side. Any steeper drop is
  // ramped up into a walkable staircase (grass crust + dirt beneath) so the player always steps
  // down, never free-falls. Two sweeps (left→right then right→left) each only ever RAISE a
  // column (min y wins), so the result is stable and preserves upward walls you jump UP (those
  // aren't falls) and all gentle terrain — only sheer down-drops are ramped. Surface heights are
  // read from a SNAPSHOT (`orig`) so a raised column never re-anchors the sweep.
  {
    const STEP = 2;        // max tiles the surface may drop per column before we ramp it
    const orig = new Int16Array(w);
    // Treat BUILT structures (house shells/roofs — uniquely backed by woodWall) as transparent to the
    // surface heightmap, so the ramp is computed from NATURAL ground only and never buries an outpost.
    for (let x = 0; x < w; x++) {
      let y = 0;
      while (y < h && (!world.isSolid(x, y) || world.walls[y * w + x] === W_.woodWall)) y++;
      orig[x] = y;
    }
    const surfaceBand = h * (LAYERS.underground + 0.08); // only ramp the near-surface crust
    const safe = new Int16Array(w);
    for (let x = 0; x < w; x++) safe[x] = orig[x];
    // left→right, then right→left: a column can be at most STEP below the higher of its safe
    // neighbours; being far ABOVE a neighbour (an upward wall) is fine and left alone.
    for (let x = 1; x < w; x++) if (orig[x] <= surfaceBand && safe[x] > safe[x - 1] + STEP) safe[x] = safe[x - 1] + STEP;
    for (let x = w - 2; x >= 0; x--) if (orig[x] <= surfaceBand && safe[x] > safe[x + 1] + STEP) safe[x] = safe[x + 1] + STEP;
    for (let x = 0; x < w; x++) {
      if (safe[x] >= orig[x]) continue;
      for (let y = safe[x]; y < orig[x] && y < h - 1; y++) {
        if (world.walls[y * w + x] === W_.woodWall) continue;   // never bury a built structure
        set(x, y, y === safe[x] ? T.grass : T.dirt);
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
