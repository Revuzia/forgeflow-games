// Enemy spawning — research/terraria/05 §1 (wiki + source verified):
// per-tick roll 1/spawnRate; spawn zone 84×47-ish tiles minus a 62×35 no-spawn
// screen zone; despawn on a timer when far off-screen. Rates by depth/time:
// surface day 1/600 (max 5), night 1/360 (6), underground 1/300 (8),
// cavern 1/240 (9), blood moon 1/108 (10).

import { TILE, LAYERS, WORLD_H } from '../config.js';
import { isDay } from '../render/background.js';
import { Enemy } from './enemy.js';
import { T, WALLS } from '../world/world.js';

const SPAWN_HALF_W = 84, SPAWN_HALF_H = 47;      // spawn rectangle around player (tiles)
const SAFE_HALF_W = 62, SAFE_HALF_H = 35;        // no-spawn zone (roughly one screen)
const DESPAWN_SOFT = 750;                         // ticks off-screen before removal
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
      if (bloodMoon) return [108, 10];
      return isDay(tick) ? [600, 5] : [360, 6];
    }
    if (band === 'underground') return [300, 8];
    if (band === 'cavern') return [240, 9];
    return [240, 10]; // underworld
  }

  pickType(band, tick, bloodMoon, biome) {
    const day = isDay(tick);
    const roll = Math.random();
    if (band === 'surface') {
      if (day && !bloodMoon) return roll < 0.75 ? 'greenSlime' : 'blueSlime';
      // night: zombies + demon eyes (+ extra zombies on blood moon)
      if (roll < (bloodMoon ? 0.65 : 0.5)) return 'zombie';
      return roll < 0.85 ? 'demonEye' : 'blueSlime';
    }
    if (band === 'underground') {
      if (roll < 0.4) return 'blueSlime';
      if (roll < 0.7) return 'caveBat';
      return 'giantWorm';
    }
    if (band === 'cavern') {
      if (roll < 0.4) return 'skeleton';
      if (roll < 0.7) return 'caveBat';
      return roll < 0.85 ? 'giantWorm' : 'blueSlime';
    }
    return 'fireImp'; // underworld
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
    if (this.activeCount() < maxSpawns && Math.random() < 1 / rate * 60 / 60 * 1) {
      // (1/rate per tick)
      this.trySpawn(game, ptx, pty, band);
    }
    // despawn far enemies
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.boss) continue;
      const dx = Math.abs(e.cx - p.x), dy = Math.abs(e.cy - p.y);
      if (dx > DESPAWN_DIST_X || dy > DESPAWN_DIST_Y) { this.enemies.splice(i, 1); continue; }
      const offscreen = dx > SAFE_HALF_W * TILE || dy > SAFE_HALF_H * TILE;
      e.despawnTimer = offscreen ? e.despawnTimer + 1 : 0;
      if (e.despawnTimer > DESPAWN_SOFT) this.enemies.splice(i, 1);
    }
  }

  trySpawn(game, ptx, pty, band) {
    const { world } = this;
    for (let attempt = 0; attempt < 50; attempt++) {
      const tx = ptx + ((Math.random() * SPAWN_HALF_W * 2) | 0) - SPAWN_HALF_W;
      const ty = pty + ((Math.random() * SPAWN_HALF_H * 2) | 0) - SPAWN_HALF_H;
      if (Math.abs(tx - ptx) < SAFE_HALF_W && Math.abs(ty - pty) < SAFE_HALF_H) continue; // no-spawn zone
      if (!world.inBounds(tx, ty) || world.tileAt(tx, ty) !== T.air) continue;
      // player-placed walls block spawns (natural walls don't)
      const wallId = world.wallAt(tx, ty);
      if (wallId !== 0 && !WALLS[wallId].natural) continue;
      const type = this.pickType(band, game.tick, game.bloodMoon);
      const def = ENEMY_SIZE[type] ?? { w: 20, h: 40 };
      // need standing room: air for body, solid floor for grounded types
      const needsFloor = !['demonEye', 'caveBat', 'giantWorm', 'eaterOfSouls'].includes(type);
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
      } else if (type === 'giantWorm') {
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

const ENEMY_SIZE = {
  greenSlime: { w: 24, h: 18 }, blueSlime: { w: 24, h: 18 }, zombie: { w: 18, h: 40 },
  demonEye: { w: 20, h: 20 }, skeleton: { w: 18, h: 40 }, caveBat: { w: 18, h: 14 },
  giantWorm: { w: 14, h: 14 }, eaterOfSouls: { w: 24, h: 24 }, fireImp: { w: 18, h: 36 },
};
