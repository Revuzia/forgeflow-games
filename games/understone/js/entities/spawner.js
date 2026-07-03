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
      // Biome roster keys off the PLAYER's biome, not the spawn tile's — this is how Terraria
      // works, and it keeps jungle hornets etc. from leaking into the forest when the player is
      // just outside a biome edge (spawn zone is 84 tiles wide, wider than the buffer between them).
      let type = this.pickType(band, game.tick, game.bloodMoon, ptx);
      // sky layer: harpies rule the heights
      if (ty < this.world.h * 0.08 && Math.random() < 0.7) type = 'harpy';
      const def = ENEMY_SIZE[type] ?? { w: 20, h: 40 };
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

const ENEMY_SIZE = {
  greenSlime: { w: 24, h: 18 }, blueSlime: { w: 24, h: 18 }, zombie: { w: 18, h: 40 },
  demonEye: { w: 20, h: 20 }, skeleton: { w: 18, h: 40 }, caveBat: { w: 18, h: 14 },
  giantWorm: { w: 14, h: 14 }, eaterOfSouls: { w: 24, h: 24 }, fireImp: { w: 18, h: 36 },
  ghost: { w: 22, h: 32 }, mummy: { w: 18, h: 40 }, vulture: { w: 22, h: 22 },
  antlion: { w: 26, h: 20 }, iceSlime: { w: 24, h: 18 }, iceWolf: { w: 34, h: 24 },
  undeadViking: { w: 20, h: 40 }, harpy: { w: 24, h: 30 }, crab: { w: 26, h: 18 },
  piranha: { w: 22, h: 14 }, goblinScout: { w: 16, h: 34 }, bloodZombie: { w: 18, h: 40 },
  drippler: { w: 20, h: 20 }, cursedSkull: { w: 20, h: 22 }, hellbat: { w: 18, h: 14 },
  lavaSlime: { w: 24, h: 18 }, demon: { w: 28, h: 44 }, boneSerpent: { w: 18, h: 18 },
  hornet: { w: 22, h: 22 }, jungleSlime: { w: 24, h: 18 },
  motherSlime: { w: 36, h: 26 }, babySlime: { w: 14, h: 10 }, sandSlime: { w: 24, h: 18 },
  blackSlime: { w: 24, h: 18 }, pinky: { w: 12, h: 9 }, giantBat: { w: 26, h: 20 },
  wanderingEye: { w: 28, h: 28 }, wraith: { w: 22, h: 34 }, devourer: { w: 16, h: 16 },
  skeletonArcher: { w: 18, h: 40 }, spider: { w: 28, h: 18 }, graniteElemental: { w: 22, h: 42 },
  snatcher: { w: 22, h: 22 },
};
