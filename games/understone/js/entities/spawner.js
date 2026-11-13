// Enemy spawning — research/terraria/05 §1 (wiki + source verified):
// per-tick roll 1/spawnRate; spawn zone 84×47-ish tiles minus a 62×35 no-spawn
// screen zone; despawn on a timer when far off-screen. Rates by depth/time:
// surface day 1/600 (max 5), night 1/360 (6), underground 1/300 (8),
// cavern 1/240 (9), blood moon 1/108 (10).

import { TILE, LAYERS, WORLD_H } from '../config.js';
import { isDay } from '../render/background.js';
import { Enemy, ENEMIES } from './enemy.js';
import { T, WALLS } from '../world/world.js';

// Tuned for our 2× render zoom: Terraria's tile-space spawn ring assumes a ~1× view, so its 62-tile
// safe zone sat WAY outside our ~30-tile half-screen — enemies spawned 62-84 tiles away and despawned
// before they could reach the player. Pulled the ring in so they spawn just off-screen and actually
// arrive, and lengthened the despawn grace so they persist.
const SPAWN_HALF_W = 70, SPAWN_HALF_H = 40;      // spawn rectangle around player (tiles)
const SAFE_HALF_W = 44, SAFE_HALF_H = 26;        // no-spawn zone (just past the visible screen edge)
const DESPAWN_SOFT = 1050;                        // ticks off-screen before removal
const DESPAWN_DIST_X = 252 * TILE, DESPAWN_DIST_Y = 142 * TILE; // instant despawn

export class Spawner {
  constructor(world, enemies) {
    this.world = world;
    this.enemies = enemies;       // shared array on game
  }

  depthBand(ty) {
    const f = ty / WORLD_H;
    if (f >= LAYERS.underworld) return 'underworld';
    if (f >= LAYERS.cavern) return 'cavern';
    if (f >= LAYERS.underground) return 'underground';
    return 'surface';
  }

  rateAndMax(band, tick, bloodMoon) {
    if (band === 'surface') {
      if (bloodMoon) return [70, 14];
      return isDay(tick) ? [150, 10] : [105, 12];  // day/night — was [340,7]/[200,9], still too sparse while exploring
    }
    if (band === 'underground') return [150, 13];
    if (band === 'cavern') return [120, 15];
    return [130, 15]; // underworld
  }

  inCorruption(tx) {
    return (this.world.corruption ?? []).some(([a, b]) => tx >= a && tx <= b);
  }

  // membership test tolerant of both the current shape (list of [x0,x1] intervals, possibly
  // mirrored pairs) and legacy saves (a single [x0,x1] range).
  inRanges(r, tx) {
    if (!r) return false;
    if (typeof r[0] === 'number') return tx >= r[0] && tx <= r[1];
    return r.some((s) => tx >= s[0] && tx <= s[1]);
  }

  biomeAt(tx) {
    const b = this.world.biomes;
    if (!b) return 'forest';
    if (this.inCorruption(tx)) return 'corruption';
    if (tx <= b.oceanW + 10 || tx >= this.world.w - b.oceanW - 10) return 'ocean';
    if (this.inRanges(b.snow, tx)) return 'snow';
    if (this.inRanges(b.desert, tx)) return 'desert';
    if (this.inRanges(b.graveyard, tx)) return 'graveyard';
    if (this.inRanges(b.jungle, tx)) return 'jungle';   // legacy saves only
    return 'forest';
  }

  // biome-aware spawn tables (research 08 roster). Weighted picks.
  pickType(band, tick, bloodMoon, tx = 0) {
    const day = isDay(tick);
    const roll = Math.random();
    const biome = this.biomeAt(tx);

    if (band === 'surface') {
      if (bloodMoon) return roll < 0.45 ? 'bloodZombie' : roll < 0.7 ? 'drippler' : roll < 0.9 ? 'zombie' : 'demonEye';
      if (biome === 'corruption') return roll < 0.75 ? 'eaterOfSouls' : 'zombie';
      if (biome === 'ocean') return roll < 0.6 ? 'crab' : 'piranha';
      // ---- difficulty ring: forest (easy) → graveyard → desert → snow (hardest) ----
      if (biome === 'graveyard') {           // tier 2 — the undead: ghosts, zombies, skeletons (no wraith; that's tier 4)
        if (day) return roll < 0.4 ? 'zombie' : roll < 0.72 ? 'skeleton' : roll < 0.9 ? 'demonEye' : 'ghost';
        return roll < 0.36 ? 'ghost' : roll < 0.64 ? 'skeleton' : 'zombie';
      }
      if (biome === 'desert') {              // tier 3 — wasps (hornets) + tougher desert mobs
        if (day) return roll < 0.35 ? 'hornet' : roll < 0.6 ? 'antlion' : roll < 0.8 ? 'vulture' : 'sandSlime';
        return roll < 0.3 ? 'hornet' : roll < 0.55 ? 'mummy' : roll < 0.8 ? 'vulture' : 'demonEye';
      }
      if (biome === 'snow') {                // tier 4 — the hardest: vikings, ice wolves, archers, wraiths
        if (day) return roll < 0.35 ? 'iceWolf' : roll < 0.6 ? 'undeadViking' : roll < 0.82 ? 'skeletonArcher' : 'iceSlime';
        return roll < 0.3 ? 'undeadViking' : roll < 0.55 ? 'iceWolf' : roll < 0.8 ? 'wraith' : 'skeletonArcher';
      }
      // tier 1 — forest (spawn): EASY. Slimes by day; nights stay gentle (slimes + a few weak eyes /
      // a lone zombie). No ghosts, wraiths, or hornets anywhere near spawn.
      if (day) return roll < 0.5 ? 'greenSlime' : roll < 0.8 ? 'blueSlime' : roll < 0.94 ? 'jungleSlime' : 'pinky';
      if (roll < 0.42) return 'greenSlime';
      if (roll < 0.68) return 'blueSlime';
      if (roll < 0.85) return 'demonEye';
      return 'zombie';
    }
    if (band === 'underground') {
      if (biome === 'snow') return roll < 0.5 ? 'iceSlime' : roll < 0.8 ? 'caveBat' : 'undeadViking';
      if (biome === 'jungle') return roll < 0.45 ? 'giantBat' : roll < 0.8 ? 'hornet' : 'snatcher';
      if (biome === 'corruption') return roll < 0.55 ? 'devourer' : 'eaterOfSouls';
      if (roll < 0.3) return 'blueSlime';
      if (roll < 0.45) return 'motherSlime';
      if (roll < 0.68) return 'caveBat';
      if (roll < 0.82) return 'spider';
      return roll < 0.94 ? 'giantWorm' : 'ghost';
    }
    if (band === 'cavern') {
      if (biome === 'jungle') return roll < 0.4 ? 'giantBat' : roll < 0.75 ? 'snatcher' : 'hornet';
      if (biome === 'corruption') return roll < 0.55 ? 'devourer' : 'eaterOfSouls';
      if (roll < 0.28) return 'skeleton';
      if (roll < 0.42) return 'skeletonArcher';
      if (roll < 0.58) return 'caveBat';
      if (roll < 0.68) return 'spider';
      if (roll < 0.76) return 'blackSlime';
      if (roll < 0.84) return 'graniteElemental';
      if (roll < 0.9) return 'giantWorm';
      return roll < 0.95 ? 'ghost' : roll < 0.99 ? 'cursedSkull' : 'pinky';
    }
    // underworld
    if (roll < 0.3) return 'fireImp';
    if (roll < 0.55) return 'hellbat';
    if (roll < 0.78) return 'lavaSlime';
    return roll < 0.94 ? 'demon' : 'boneSerpent';
  }

  activeCount() {
    return this.enemies.filter(e => !e.boss).length;
  }

  tick(game) {
    const p = game.player;
    if (p.dead) return;
    const ptx = Math.floor(p.x / TILE), pty = Math.floor(p.y / TILE);
    const band = this.depthBand(pty);
    const [rate, maxSpawns] = this.rateAndMax(band, game.tick, game.bloodMoon);
    // Spawn ring adapts to the ACTUAL visible screen (varies with monitor size + zoom): keep the
    // no-spawn zone just past the screen edge so enemies appear right off-screen and can reach you,
    // instead of a fixed ring that (at 2× zoom, small screens) spawned them too far to ever arrive.
    const cam = game.camera;
    const safeW = cam ? Math.ceil(cam.viewW() / TILE / 2) + 5 : SAFE_HALF_W;
    const safeH = cam ? Math.ceil(cam.viewH() / TILE / 2) + 4 : SAFE_HALF_H;
    const spawnW = safeW + 30, spawnH = safeH + 20;
    if (this.activeCount() < maxSpawns && Math.random() < 1 / rate) {
      this.trySpawn(game, ptx, pty, band, safeW, safeH, spawnW, spawnH);
    }
    // despawn far enemies
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.boss) continue;
      const dx = Math.abs(e.cx - p.x), dy = Math.abs(e.cy - p.y);
      if (dx > DESPAWN_DIST_X || dy > DESPAWN_DIST_Y) { this.enemies.splice(i, 1); continue; }
      const offscreen = dx > safeW * TILE || dy > safeH * TILE;
      e.despawnTimer = offscreen ? e.despawnTimer + 1 : 0;
      if (e.despawnTimer > DESPAWN_SOFT) this.enemies.splice(i, 1);
    }
  }

  trySpawn(game, ptx, pty, band, safeW = SAFE_HALF_W, safeH = SAFE_HALF_H, spawnW = SPAWN_HALF_W, spawnH = SPAWN_HALF_H) {
    const { world } = this;
    for (let attempt = 0; attempt < 60; attempt++) {
      const tx = ptx + ((Math.random() * spawnW * 2) | 0) - spawnW;
      const ty = pty + ((Math.random() * spawnH * 2) | 0) - spawnH;
      if (Math.abs(tx - ptx) < safeW && Math.abs(ty - pty) < safeH) continue; // no-spawn zone (just past screen edge)
      if (!world.inBounds(tx, ty) || world.tileAt(tx, ty) !== T.air) continue;
      // player-placed walls block spawns (natural walls don't)
      const wallId = world.wallAt(tx, ty);
      if (wallId !== 0 && !WALLS[wallId].natural) continue;
      // Biome roster keys off the PLAYER's biome, not the spawn tile's — this is how Terraria
      // works, and it keeps jungle hornets etc. from leaking into the forest when the player is
      // just outside a biome edge (spawn zone is 84 tiles wide, wider than the buffer between them).
      let type = this.pickType(band, game.tick, game.bloodMoon, ptx);
      // sky layer: harpies rule the heights
      if (ty < this.world.h * 0.08 && Math.random() < 0.7) type = 'harpy';
      const def = ENEMIES[type] ?? { w: 20, h: 40 };   // single source of truth for hitbox size
      // swimmers spawn only in water
      if (type === 'piranha') {
        if (world.liquid[ty * world.w + tx] < 128 || world.liquidType[ty * world.w + tx] !== 0) continue;
        this.spawnAt(type, tx * TILE + TILE / 2, ty * TILE + TILE);
        return true;
      }
      // need standing room: air for body, solid floor for grounded types
      const needsFloor = !['demonEye', 'caveBat', 'giantWorm', 'eaterOfSouls', 'ghost',
        'harpy', 'cursedSkull', 'drippler', 'hellbat', 'vulture', 'boneSerpent', 'hornet',
        'devourer', 'giantBat', 'wanderingEye'].includes(type);   // flyers + all worms skip floor-clearance
      const bodyTiles = Math.ceil(def.h / TILE);
      let ok = true;
      for (let i = 0; i < bodyTiles; i++) if (world.isSolid(tx, ty - i)) ok = false;
      if (!ok) continue;
      if (needsFloor) {
        let floorY = ty;
        let found = false;
        for (let i = 0; i < 8; i++) {
          if (world.isSolid(tx, floorY + 1)) { found = true; break; }
          floorY++;
        }
        if (!found) continue;
        this.spawnAt(type, tx * TILE + TILE / 2, (floorY + 1) * TILE);
      } else if (type === 'giantWorm' || type === 'boneSerpent' || type === 'devourer') {
        // worms spawn inside ground
        let gy = ty;
        for (let i = 0; i < 10 && !world.isSolid(tx, gy); i++) gy++;
        if (!world.isSolid(tx, gy)) continue;
        this.spawnAt(type, tx * TILE + TILE / 2, gy * TILE + TILE * 2);
      } else {
        this.spawnAt(type, tx * TILE + TILE / 2, ty * TILE + TILE);
      }
      return true;
    }
    return false;
  }

  spawnAt(type, x, y) {
    this.enemies.push(new Enemy(type, x, y));
  }
}

// (enemy hitbox sizes now come straight from ENEMIES in enemy.js — one source of truth)
