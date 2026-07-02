// Enemies — stats + AI constants from research/terraria/05-combat-enemies-bosses.md
// (decompiled NPC.cs values). Damage formula: floor(atk±15% − def/2), min 1.
// AI archetypes: slime, fighter, flyer, bat, worm, caster.

import { TILE, PHYS, elementMult, ROLLS } from '../config.js';
import { moveEntity, entityLiquid } from './physics.js';
import { character } from '../core/assets.js';

// enemy types with full PixelLab animated characters (walk/attack frames)
const ANIMATED = new Set(['zombie', 'skeleton', 'mummy', 'ghost', 'goblinScout', 'demon', 'iceWolf', 'vulture', 'undeadViking', 'bloodZombie',
  'skeletonArcher', 'spider', 'graniteElemental', 'snatcher', 'wraith']);
const CHAR_NAME = { goblinScout: 'goblin', undeadViking: 'skeleton', bloodZombie: 'zombie', wraith: 'ghost' };

// registry ---------------------------------------------------------------------
export const ENEMIES = {
  greenSlime: { name: 'Green Slime', ai: 'slime', hp: 14, dmg: 6, def: 0, kbResist: -0.2, coins: 3,
    w: 24, h: 18, color: '#7ddc7d', drops: [['gel', 1, 2, 1.0]] },
  blueSlime: { name: 'Blue Slime', ai: 'slime', hp: 25, dmg: 7, def: 2, kbResist: 0, coins: 25,
    w: 24, h: 18, color: '#6da8e8', drops: [['gel', 1, 2, 1.0]] },
  zombie: { name: 'Zombie', ai: 'fighter', hp: 45, dmg: 14, def: 6, kbResist: 0.5, coins: 60,
    w: 18, h: 40, color: '#6a8a5a', drops: [] },
  demonEye: { name: 'Demon Eye', ai: 'flyer', hp: 60, dmg: 18, def: 2, kbResist: 0.2, coins: 75,
    dodge: 0.08, w: 20, h: 20, color: '#c05a5a', drops: [['lens', 1, 1, 0.33]] },
  skeleton: { name: 'Skeleton', ai: 'fighter', hp: 60, dmg: 20, def: 8, kbResist: 0.5, coins: 100,
    w: 18, h: 40, color: '#d8d8c8', drops: [['hook', 1, 1, 0.04]] },
  caveBat: { name: 'Cave Bat', ai: 'bat', hp: 16, dmg: 13, def: 2, kbResist: 0.2, coins: 90,
    dodge: 0.10, w: 18, h: 14, color: '#8a7aa0', drops: [] },
  giantWorm: { name: 'Giant Worm', ai: 'worm', hp: 30, dmg: 8, def: 0, kbResist: 1.0, coins: 40,
    w: 14, h: 14, color: '#b08a6a', segments: 7, drops: [] },
  eaterOfSouls: { name: 'Eater of Souls', ai: 'flyer', hp: 40, dmg: 22, def: 8, kbResist: 0.5, coins: 90,
    w: 24, h: 24, color: '#9a8ab8', drops: [['rottenChunk', 1, 1, 0.33]] },
  fireImp: { name: 'Fire Imp', ai: 'caster', hp: 70, dmg: 30, def: 16, kbResist: 0.5, coins: 350,
    w: 18, h: 36, color: '#e07a3a', element: 'fire', drops: [] },

  // ---- biome roster (stats per research/terraria/08-combat-catalog.md) --------
  ghost: { name: 'Ghost', ai: 'ghost', hp: 60, dmg: 20, def: 10, kbResist: 0.35, coins: 500,
    dodge: 0.08, element: 'shadow', w: 22, h: 32, color: '#cfd8e8', drops: [] },
  mummy: { name: 'Mummy', ai: 'fighter', hp: 90, dmg: 25, def: 8, kbResist: 0.5, coins: 300,
    w: 18, h: 40, color: '#c8b88a', drops: [] },
  vulture: { name: 'Vulture', ai: 'flyer', hp: 40, dmg: 18, def: 4, kbResist: 0.3, coins: 150,
    dodge: 0.08, w: 22, h: 22, color: '#5a4a3a', drops: [] },
  antlion: { name: 'Antlion', ai: 'caster', hp: 45, dmg: 20, def: 8, kbResist: 0.9, coins: 120,
    w: 26, h: 20, color: '#c8a05a', stationary: true, drops: [] },
  iceSlime: { name: 'Ice Slime', ai: 'slime', hp: 30, dmg: 8, def: 4, kbResist: 0, coins: 40,
    element: 'ice', w: 24, h: 18, color: '#a8d5e8', drops: [['gel', 1, 2, 1.0], ['ice', 1, 3, 0.5]] },
  iceWolf: { name: 'Ice Wolf', ai: 'fighter', hp: 55, dmg: 22, def: 6, kbResist: 0.4, coins: 250,
    dodge: 0.08, element: 'ice', speed: 2.2, w: 34, h: 24, color: '#d8e8f0', drops: [] },
  undeadViking: { name: 'Undead Viking', ai: 'fighter', hp: 100, dmg: 26, def: 12, kbResist: 0.6, coins: 400,
    element: 'ice', w: 20, h: 40, color: '#8aa0b8', drops: [] },
  harpy: { name: 'Harpy', ai: 'flyer', hp: 100, dmg: 25, def: 8, kbResist: 0.4, coins: 300,
    dodge: 0.10, w: 24, h: 30, color: '#d8c8e8', drops: [] },
  crab: { name: 'Crab', ai: 'fighter', hp: 50, dmg: 20, def: 6, kbResist: 0.6, coins: 130,
    element: 'water', speed: 0.8, w: 26, h: 18, color: '#e08a6a', drops: [] },
  piranha: { name: 'Piranha', ai: 'swim', hp: 30, dmg: 25, def: 2, kbResist: 0.2, coins: 150,
    element: 'water', w: 22, h: 14, color: '#9ab8a0', drops: [] },
  goblinScout: { name: 'Goblin Scout', ai: 'fighter', hp: 40, dmg: 15, def: 4, kbResist: 0.4, coins: 200,
    w: 16, h: 34, color: '#7aa05a', drops: [['cobweb', 1, 3, 0.3]] },
  bloodZombie: { name: 'Blood Zombie', ai: 'fighter', hp: 60, dmg: 18, def: 8, kbResist: 0.5, coins: 90,
    speed: 1.4, w: 18, h: 40, color: '#a04a4a', drops: [] },
  drippler: { name: 'Drippler', ai: 'flyer', hp: 50, dmg: 20, def: 6, kbResist: 0.2, coins: 90,
    w: 20, h: 20, color: '#c03a3a', drops: [] },
  cursedSkull: { name: 'Cursed Skull', ai: 'flyer', hp: 60, dmg: 32, def: 10, kbResist: 0.3, coins: 450,
    dodge: 0.08, element: 'shadow', w: 20, h: 22, color: '#d8d8e8', drops: [] },
  hellbat: { name: 'Hellbat', ai: 'bat', hp: 28, dmg: 26, def: 6, kbResist: 0.2, coins: 200,
    dodge: 0.10, element: 'fire', w: 18, h: 14, color: '#e05a3a', drops: [] },
  lavaSlime: { name: 'Lava Slime', ai: 'slime', hp: 40, dmg: 22, def: 8, kbResist: 0, coins: 150,
    element: 'fire', w: 24, h: 18, color: '#e06a2a', drops: [['gel', 1, 2, 1.0]] },
  demon: { name: 'Demon', ai: 'caster', hp: 140, dmg: 32, def: 12, kbResist: 0.5, coins: 800,
    element: 'shadow', w: 28, h: 44, color: '#8a4a6a', drops: [['demonite', 1, 3, 0.4]] },
  boneSerpent: { name: 'Bone Serpent', ai: 'worm', hp: 180, dmg: 30, def: 10, kbResist: 1, coins: 900,
    w: 18, h: 18, color: '#d8d0c0', segments: 12, drops: [['demonite', 2, 4, 0.5]] },
  hornet: { name: 'Hornet', ai: 'hornet', hp: 48, dmg: 26, def: 8, kbResist: 0.3, coins: 200,
    dodge: 0.08, w: 22, h: 22, color: '#c8a02a', drops: [['stinger', 1, 2, 0.66]] },
  jungleSlime: { name: 'Jungle Slime', ai: 'slime', hp: 40, dmg: 12, def: 6, kbResist: 0, coins: 60,
    w: 24, h: 18, color: '#5ac83a', drops: [['gel', 1, 2, 1.0]] },

  // ---- v3 roster expansion (→46 types) ----------------------------------------
  motherSlime: { name: 'Mother Slime', ai: 'slime', hp: 90, dmg: 20, def: 7, kbResist: 0.2, coins: 250,
    w: 36, h: 26, color: '#4a5aa8', splitsInto: 'babySlime', drops: [['gel', 3, 6, 1.0]] },
  babySlime: { name: 'Baby Slime', ai: 'slime', hp: 12, dmg: 12, def: 2, kbResist: -0.2, coins: 10,
    w: 14, h: 10, color: '#6a7ac8', drops: [['gel', 1, 1, 0.66]] },
  sandSlime: { name: 'Sand Slime', ai: 'slime', hp: 32, dmg: 12, def: 4, kbResist: 0, coins: 45,
    w: 24, h: 18, color: '#d8bc7a', drops: [['gel', 1, 2, 1.0], ['sand', 2, 5, 0.5]] },
  blackSlime: { name: 'Black Slime', ai: 'slime', hp: 45, dmg: 15, def: 4, kbResist: 0, coins: 70,
    element: 'shadow', w: 24, h: 18, color: '#3a3a44', drops: [['gel', 1, 2, 1.0]] },
  pinky: { name: 'Pinky', ai: 'slime', hp: 150, dmg: 5, def: 5, kbResist: -0.4, coins: 5000,
    dodge: 0.10, w: 12, h: 9, color: '#f0a0c8', drops: [['gel', 1, 1, 1.0]] },
  giantBat: { name: 'Giant Bat', ai: 'bat', hp: 90, dmg: 30, def: 10, kbResist: 0.35, coins: 400,
    dodge: 0.10, w: 26, h: 20, color: '#6a5a88', drops: [] },
  wanderingEye: { name: 'Wandering Eye', ai: 'flyer', hp: 110, dmg: 23, def: 6, kbResist: 0.3, coins: 350,
    dodge: 0.08, w: 28, h: 28, color: '#b06a5a', drops: [['lens', 1, 2, 0.5]] },
  wraith: { name: 'Wraith', ai: 'ghost', hp: 90, dmg: 30, def: 12, kbResist: 0.5, coins: 700,
    dodge: 0.08, element: 'shadow', speed: 1.9, w: 22, h: 34, color: '#2a2a3a', drops: [['shadowScale', 1, 2, 0.4]] },
  devourer: { name: 'Devourer', ai: 'worm', hp: 60, dmg: 20, def: 4, kbResist: 1, coins: 300,
    w: 16, h: 16, color: '#7a5a78', segments: 9, drops: [['rottenChunk', 1, 2, 0.6], ['demonite', 1, 2, 0.3]] },
  skeletonArcher: { name: 'Skeleton Archer', ai: 'archer', hp: 70, dmg: 22, def: 8, kbResist: 0.5, coins: 350,
    w: 18, h: 40, color: '#c8c8b8', drops: [['woodenArrow', 5, 15, 0.8], ['hook', 1, 1, 0.03]] },
  spider: { name: 'Cave Spider', ai: 'fighter', hp: 55, dmg: 22, def: 6, kbResist: 0.35, coins: 300,
    dodge: 0.08, speed: 1.8, poison: true, w: 28, h: 18, color: '#4a3a2a', drops: [['cobweb', 2, 5, 0.8]] },
  graniteElemental: { name: 'Granite Elemental', ai: 'fighter', hp: 130, dmg: 28, def: 14, kbResist: 0.7, coins: 600,
    dodge: 0.10, element: 'lightning', w: 22, h: 42, color: '#3a4a6a', drops: [['diamond', 1, 1, 0.08]] },
  snatcher: { name: 'Snatcher', ai: 'snatcher', hp: 60, dmg: 24, def: 6, kbResist: 1, coins: 150,
    element: 'water', w: 22, h: 22, color: '#3a8a3a', drops: [['vine', 1, 2, 0.7]] },
};

let nextId = 1;

export class Enemy {
  constructor(type, x, y) {
    const def = ENEMIES[type];
    this.id = nextId++;
    this.type = type; this.def = def;
    this.w = def.w; this.h = def.h;
    this.x = x - def.w / 2; this.y = y - def.h;
    this.px = this.x; this.py = this.y;
    this.vx = 0; this.vy = 0;
    this.hp = def.hp;
    this.facing = 1;
    this.aiTimer = 0; this.aiPhase = 0;
    this.grounded = false;
    this.hitCooldown = new Map();     // per-source immunity (piercing: 10 ticks)
    this.despawnTimer = 0;
    this.boss = false;
    // worm segments: array of {x, y} behind the head
    if (def.segments) {
      this.segs = [];
      for (let i = 0; i < def.segments; i++) this.segs.push({ x: this.x, y: this.y });
    }
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  // player attack → damage. Returns:
  //   number > 0 — damage dealt
  //   0          — immune this tick (per-source i-frames), no feedback
  //   'dodge'    — the to-hit roll failed → show a MISS floater
  strike(rawDmg, kb, fromX, sourceKey = 'melee', crit = false, element = null) {
    const now = this._tick ?? 0;
    const until = this.hitCooldown.get(sourceKey) ?? -1;
    if (now < until) return 0;
    this.hitCooldown.set(sourceKey, now + 10);
    // to-hit roll (D&D layer, research 08): only nimble enemies dodge; bosses never;
    // no dodging mid-knockback; pity reroll prevents consecutive dodges.
    const inHitstun = Math.abs(this.vx) > 2 || this.vy < -1;
    const dodge = this.boss || inHitstun || this.justDodged ? 0 : (this.def.dodge ?? ROLLS.defaultDodge);
    if (Math.random() < dodge) {
      this.justDodged = true;
      // afterimage micro-dash away from the attacker
      this.vx += Math.sign(this.cx - fromX) * 1.5;
      return 'dodge';
    }
    this.justDodged = false;
    const variance = 0.85 + Math.random() * 0.3;
    const eMult = elementMult(element, this.def.element);
    let dmg = Math.max(1, Math.floor(rawDmg * variance * eMult - Math.ceil(this.def.def / 2)));
    if (crit) dmg *= ROLLS.critMult;
    this.hp -= dmg;
    this.lastElementMult = eMult;    // combat reads this for "weak/resist" feedback color
    // knockback scaled by resistance (1.0 = immune)
    const resist = Math.max(0, Math.min(1, this.def.kbResist));
    const k = kb * (1 - resist) * (crit ? 1.4 : 1);
    if (k > 0 && this.def.ai !== 'worm') {
      this.vx = Math.sign(this.cx - fromX) * k * 0.6;
      this.vy = -k * 0.45;
    }
    return dmg;
  }

  tick(game) {
    this._tick = game.tick;
    this.px = this.x; this.py = this.y;
    const pl = game.player;
    this.nearPlayer = pl && !pl.dead && Math.abs(pl.x - this.cx) < 30 && Math.abs(pl.y - this.cy) < 40;
    const ai = this.def.ai;
    if (ai === 'slime') this.aiSlime(game);
    else if (ai === 'fighter') this.aiFighter(game);
    else if (ai === 'flyer') this.aiFlyer(game);
    else if (ai === 'bat') this.aiBat(game);
    else if (ai === 'worm') this.aiWorm(game);
    else if (ai === 'caster') this.aiCaster(game);
    else if (ai === 'ghost') this.aiGhost(game);
    else if (ai === 'swim') this.aiSwim(game);
    else if (ai === 'hornet') this.aiHornet(game);
    else if (ai === 'archer') this.aiArcher(game);
    else if (ai === 'snatcher') this.aiSnatcher(game);
  }

  // ---- Skeleton Archer: keeps distance, fires arrows -----------------------------
  aiArcher(game) {
    const p = game.player;
    this.aiTimer++;
    const dist = Math.abs(p.x - this.cx);
    const dir = p.dead ? 0 : dist < 120 ? -Math.sign(p.x - this.cx) : dist > 260 ? Math.sign(p.x - this.cx) : 0;
    if (dir) {
      this.vx += dir * 0.06;
      if (Math.abs(this.vx) > 0.9) this.vx = dir * 0.9;
    } else this.vx *= 0.85;
    this.facing = Math.sign(p.x - this.cx) || 1;
    if (!p.dead && this.aiTimer % 130 === 0 && dist < 450) {
      game.projectiles?.spawnEnemy('arrow', this.cx, this.y + 10, p.x, p.y - 20, 7, this.def.dmg);
      const pr = game.projectiles.list[game.projectiles.list.length - 1];
      if (pr) pr.gravity = 0.07;
    }
    this.applyGravityAndMove(game);
  }

  // ---- Snatcher: anchored plant, lunges on a vine at close range -------------------
  aiSnatcher(game) {
    const p = game.player;
    if (this.anchorX === undefined) { this.anchorX = this.x; this.anchorY = this.y; }
    const dx = p.x - (this.anchorX + this.w / 2), dy = p.y - (this.anchorY + this.h / 2);
    const d = Math.hypot(dx, dy);
    if (!p.dead && d < 90) {
      // spring toward the player
      this.x += (dx / d) * 2.2;
      this.y += (dy / d) * 2.2;
    }
    // vine pulls it back toward the anchor
    this.x += (this.anchorX - this.x) * 0.06;
    this.y += (this.anchorY - this.y) * 0.06;
    this.facing = Math.sign(dx) || 1;
  }

  // ---- Hornet: hovers at range, spits poison stingers ---------------------------
  aiHornet(game) {
    const p = game.player;
    this.aiTimer++;
    if (!p.dead) {
      const dx = p.x - this.cx, dy = (p.y - 30) - this.cy;
      const d = Math.hypot(dx, dy) || 1;
      const want = d > 140 ? 1 : d < 90 ? -1 : 0;   // keep ~6-9 tile standoff
      this.vx += (dx / d) * 0.07 * want;
      this.vy += (dy / d) * 0.05 * want + Math.sin(this.aiTimer * 0.1) * 0.03;
      if (Math.abs(this.vx) > 2.2) this.vx = Math.sign(this.vx) * 2.2;
      if (Math.abs(this.vy) > 1.6) this.vy = Math.sign(this.vy) * 1.6;
      if (this.aiTimer % 110 === 0 && d < 400) {
        game.projectiles?.spawnEnemy('stinger', this.cx, this.cy, p.x, p.y, 5, this.def.dmg * 0.6);
      }
    }
    const e = { x: this.x, y: this.y, vx: this.vx, vy: this.vy, w: this.w, h: this.h };
    moveEntity(game.world, e, {});
    if (e.vx === 0 && this.vx !== 0) e.vx = -this.vx * 0.5;
    if (e.vy === 0 && this.vy !== 0) e.vy = -this.vy * 0.5;
    this.x = e.x; this.y = e.y; this.vx = e.vx; this.vy = e.vy;
    this.facing = Math.sign(p.x - this.cx) || 1;
  }

  // ---- Ghost: drifts straight through terrain toward the player, wispy ----------
  aiGhost(game) {
    const p = game.player;
    if (!p.dead) {
      const dx = p.x - this.cx, dy = (p.y - 10) - this.cy;
      const d = Math.hypot(dx, dy) || 1;
      this.vx += (dx / d) * 0.045;
      this.vy += (dy / d) * 0.045;
    }
    // gentle bob + speed cap
    this.vy += Math.sin((this._tick ?? 0) * 0.06 + this.id) * 0.02;
    const cap = 1.4;
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > cap) { this.vx *= cap / sp; this.vy *= cap / sp; }
    // no tile collision — ghosts phase through everything
    this.x += this.vx;
    this.y += this.vy;
    this.facing = Math.sign(this.vx) || 1;
    this.ethereal = true;   // renderer draws at ~55% alpha
  }

  // ---- Swimmer (piranha): fast in liquid, flops helplessly out of it -------------
  aiSwim(game) {
    const p = game.player;
    const wet = entityLiquid(game.world, this) >= 1;
    if (wet) {
      if (!p.dead) {
        const dx = p.x - this.cx, dy = p.y - this.cy;
        const d = Math.hypot(dx, dy) || 1;
        this.vx += (dx / d) * 0.12;
        this.vy += (dy / d) * 0.08;
      }
      const cap = 3;
      const sp = Math.hypot(this.vx, this.vy);
      if (sp > cap) { this.vx *= cap / sp; this.vy *= cap / sp; }
      const e = { x: this.x, y: this.y, vx: this.vx, vy: this.vy, w: this.w, h: this.h };
      moveEntity(game.world, e, { moveFactor: 1 });   // full speed in water — it's a fish
      this.x = e.x; this.y = e.y; this.vx = e.vx; this.vy = e.vy;
      this.facing = Math.sign(this.vx) || 1;
    } else {
      // out of water: flop
      if (this.grounded && Math.random() < 0.06) { this.vy = -3; this.vx = (Math.random() - 0.5) * 2; }
      this.applyGravityAndMove(game);
    }
  }

  // ---- Slime: rest ~120t, hop-hop-BIGhop cycle (vy −6/−6/−8, vx 2/2/3) -----------
  aiSlime(game) {
    const p = game.player;
    const aggro = Math.abs(p.x - this.cx) < 400 && !p.dead;
    this.aiTimer += aggro ? 2 : 1;
    if (this.grounded) {
      this.vx *= 0.8;                                  // ground friction
      if (this.aiTimer >= 120) {
        this.aiTimer = 0;
        this.aiPhase = (this.aiPhase + 1) % 3;
        const big = this.aiPhase === 2;
        const dir = p.dead ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(p.x - this.cx) || 1;
        this.vy = big ? -8 : -6;
        this.vx = dir * (big ? 3 : 2);
        this.facing = dir;
      }
    }
    this.applyGravityAndMove(game);
  }

  // ---- Fighter: walk at player (accel 0.07, max 1.0), jump ladder at obstacles ----
  aiFighter(game) {
    const p = game.player;
    const dir = p.dead ? this.facing : (Math.sign(p.x - this.cx) || 1);
    this.facing = dir;
    const max = this.def.speed ?? 1.0;
    this.vx += dir * 0.07;
    if (Math.abs(this.vx) > max) this.vx = dir * max;
    if (this.grounded) {
      // obstacle ahead? jump ladder −5/−6/−7/−8 by height
      const aheadX = dir > 0 ? this.x + this.w + 2 : this.x - 2;
      const tx = Math.floor(aheadX / TILE);
      const footTy = Math.floor((this.y + this.h - 1) / TILE);
      let height = 0;
      for (let i = 0; i < 4; i++) {
        if (game.world.isSolid(tx, footTy - i)) height = i + 1;
      }
      if (height > 0 && game.world.isSolid(tx, footTy)) {
        this.vy = [-5, -6, -7, -8][Math.min(3, height - 1)];
      } else {
        // gap ahead → hop across if player is beyond
        const gapTy = footTy + 1;
        if (!game.world.isSolid(tx, gapTy) && !game.world.isSolid(tx, gapTy + 1) && Math.abs(p.x - this.cx) > 60) {
          this.vy = -8; this.vx = dir * Math.min(3, Math.abs(this.vx) * 1.5 + 1);
        }
      }
    }
    this.applyGravityAndMove(game);
  }

  // ---- Flyer (Demon Eye): asymmetric accel → swooping (0.1/0.04, max 4.0/1.5) -----
  aiFlyer(game) {
    const p = game.player;
    if (!p.dead) {
      const dx = p.x - this.cx, dy = (p.y - 20) - this.cy;
      this.vx += Math.sign(dx) * 0.1;
      this.vy += Math.sign(dy) * 0.04;
      if (Math.abs(this.vx) > 4) this.vx = Math.sign(this.vx) * 4;
      if (Math.abs(this.vy) > 1.5) this.vy = Math.sign(this.vy) * 1.5;
    }
    this.facing = Math.sign(this.vx) || 1;
    const e = { x: this.x, y: this.y, vx: this.vx, vy: this.vy, w: this.w, h: this.h };
    moveEntity(game.world, e, {});
    // wall bounce −0.5×
    if (e.vx === 0 && this.vx !== 0) e.vx = -this.vx * 0.5;
    if (e.vy === 0 && this.vy !== 0) e.vy = -this.vy * 0.5;
    this.x = e.x; this.y = e.y; this.vx = e.vx; this.vy = e.vy;
  }

  // ---- Bat: erratic flutter toward player ------------------------------------------
  aiBat(game) {
    const p = game.player;
    if (game.tick % 8 === 0) {
      this.vx += (Math.random() - 0.5) * 1.6;
      this.vy += (Math.random() - 0.5) * 1.2;
    }
    if (!p.dead) {
      this.vx += Math.sign(p.x - this.cx) * 0.06;
      this.vy += Math.sign(p.y - this.cy) * 0.04;
    }
    const cap = 2.4;
    if (Math.abs(this.vx) > cap) this.vx = Math.sign(this.vx) * cap;
    if (Math.abs(this.vy) > cap) this.vy = Math.sign(this.vy) * cap;
    const e = { x: this.x, y: this.y, vx: this.vx, vy: this.vy, w: this.w, h: this.h };
    moveEntity(game.world, e, {});
    if (e.vx === 0 && this.vx !== 0) e.vx = -this.vx * 0.7;
    if (e.vy === 0 && this.vy !== 0) e.vy = -this.vy * 0.7;
    this.x = e.x; this.y = e.y; this.vx = e.vx; this.vy = e.vy;
    this.facing = Math.sign(this.vx) || 1;
  }

  // ---- Worm: head moves THROUGH tiles toward player; segments follow ----------------
  aiWorm(game) {
    const p = game.player;
    const inGround = game.world.isSolid(Math.floor(this.cx / TILE), Math.floor(this.cy / TILE));
    const maxSpd = 6;
    if (inGround) {
      // steer toward player
      const dx = p.x - this.cx, dy = p.y - this.cy;
      const d = Math.hypot(dx, dy) || 1;
      this.vx += (dx / d) * 0.18;
      this.vy += (dy / d) * 0.18;
    } else {
      // airborne: arc under gravity 0.11, steer weakly
      this.vy += 0.11;
      this.vx *= 0.995;
    }
    const spd = Math.hypot(this.vx, this.vy);
    if (spd > maxSpd) { this.vx *= maxSpd / spd; this.vy *= maxSpd / spd; }
    // no tile collision: worms pass through everything
    this.x += this.vx; this.y += this.vy;
    // segments hard-follow at fixed spacing
    let leadX = this.cx, leadY = this.cy;
    for (const s of this.segs) {
      const dx = leadX - (s.x + this.w / 2), dy = leadY - (s.y + this.h / 2);
      const d = Math.hypot(dx, dy);
      const space = this.w * 0.9;
      if (d > space) {
        s.x += dx * ((d - space) / d);
        s.y += dy * ((d - space) / d);
      }
      leadX = s.x + this.w / 2; leadY = s.y + this.h / 2;
    }
  }

  // ---- Caster (Fire Imp): 3 casts then teleport --------------------------------------
  aiCaster(game) {
    const p = game.player;
    this.aiTimer++;
    this.facing = Math.sign(p.x - this.cx) || 1;
    if (this.aiTimer % 90 === 60 && !p.dead && Math.abs(p.x - this.cx) < 600) {
      const kind = this.type === 'antlion' ? 'sand' : this.type === 'demon' ? 'scythe' : 'fireball';
      game.projectiles?.spawnEnemy(kind, this.cx, this.cy - 6, p.x, p.y - 10, kind === 'sand' ? 5.5 : 4.5, this.def.dmg);
      this.aiPhase++;
    }
    if (this.def.stationary) { this.applyGravityAndMove(game); return; }   // antlion: turret, never teleports
    if (this.aiPhase >= 3 || (this.hpDropped && this.aiTimer > 30)) {
      // teleport near player onto solid ground
      for (let tries = 0; tries < 30; tries++) {
        const tx = Math.floor(p.x / TILE) + ((Math.random() * 24) | 0) - 12;
        const ty = Math.floor(p.y / TILE) + ((Math.random() * 12) | 0) - 6;
        if (!game.world.isSolid(tx, ty) && !game.world.isSolid(tx, ty - 1) && game.world.isSolid(tx, ty + 1)) {
          this.x = tx * TILE; this.y = (ty + 1) * TILE - this.h;
          break;
        }
      }
      this.aiPhase = 0; this.aiTimer = 0; this.hpDropped = false;
    }
    this.applyGravityAndMove(game);
  }

  applyGravityAndMove(game) {
    this.vy += PHYS.gravity;
    if (this.vy > PHYS.maxFall) this.vy = PHYS.maxFall;
    const wet = entityLiquid(game.world, this) >= 1;
    const e = { x: this.x, y: this.y, vx: this.vx, vy: this.vy, w: this.w, h: this.h };
    const flags = moveEntity(game.world, e, { moveFactor: wet ? 0.5 : 1 });
    this.x = e.x; this.y = e.y; this.vx = e.vx; this.vy = e.vy;
    this.grounded = flags.down && this.vy === 0;
  }

  // all AABBs that can hit/be hit (worm = head + segments)
  hitboxes() {
    if (!this.segs) return [{ x: this.x, y: this.y, w: this.w, h: this.h }];
    return [{ x: this.x, y: this.y, w: this.w, h: this.h },
      ...this.segs.map(s => ({ x: s.x, y: s.y, w: this.w, h: this.h }))];
  }

  spriteName() {
    return {
      greenSlime: 'slime', blueSlime: 'slime', zombie: 'zombie', skeleton: 'skeleton',
      demonEye: 'demonEye', caveBat: 'bat', fireImp: 'fireImp',
      giantWorm: 'wormSegment', eaterHead: 'wormSegment', eaterOfSouls: 'demonEye',
      kingSlime: 'kingSlime', eyeOfCthulhu: 'eyeOfCthulhu', servant: 'demonEye',
      // biome roster: PixelLab characters where they exist, tinted archetypes otherwise
      ghost: 'ghost', mummy: 'mummy', vulture: 'vulture', iceWolf: 'iceWolf',
      goblinScout: 'goblin', demon: 'demon', undeadViking: 'skeleton',
      iceSlime: 'slime', lavaSlime: 'slime', hellbat: 'bat',
      bloodZombie: 'zombie', drippler: 'demonEye', cursedSkull: 'skeleton',
      boneSerpent: 'wormSegment',
      motherSlime: 'slime', babySlime: 'slime', sandSlime: 'slime', blackSlime: 'slime',
      pinky: 'slime', jungleSlime: 'slime', giantBat: 'bat', wanderingEye: 'demonEye',
      wraith: 'ghost', devourer: 'wormSegment', skeletonArcher: 'skeletonArcher',
      spider: 'spider', graniteElemental: 'graniteElemental', snatcher: 'snatcher',
      hornet: 'hornet',
    }[this.type];
  }

  tintFor() {
    return {
      blueSlime: 'rgba(70,120,255,0.45)', iceSlime: 'rgba(160,220,255,0.55)',
      lavaSlime: 'rgba(255,110,30,0.55)', hellbat: 'rgba(255,80,30,0.5)',
      bloodZombie: 'rgba(200,30,30,0.45)', drippler: 'rgba(220,30,30,0.5)',
      undeadViking: 'rgba(90,140,200,0.35)', cursedSkull: 'rgba(140,110,220,0.4)',
      boneSerpent: 'rgba(230,225,200,0.45)',
      motherSlime: 'rgba(60,80,200,0.5)', babySlime: 'rgba(110,130,230,0.5)',
      sandSlime: 'rgba(216,188,122,0.55)', blackSlime: 'rgba(30,30,40,0.6)',
      pinky: 'rgba(240,150,200,0.6)', jungleSlime: 'rgba(70,200,60,0.5)',
      giantBat: 'rgba(90,70,140,0.45)', wanderingEye: 'rgba(180,90,70,0.4)',
      wraith: 'rgba(15,15,30,0.55)', devourer: 'rgba(122,90,120,0.5)',
    }[this.type] ?? null;
  }

  drawSprite(ctx, spr, cx, cy, dw, dh, flip, rot = 0, tint = null) {
    ctx.save();
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(rot);
    ctx.scale(flip ? -1 : 1, 1);
    ctx.drawImage(spr, -dw / 2, -dh / 2, dw, dh);
    if (tint) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = tint;
      ctx.fillRect(-dw / 2, -dh / 2, dw, dh);
    }
    ctx.restore();
  }

  draw(ctx, camera, alpha, assets = null) {
    const [ox, oy] = camera.frameOrigin(alpha);
    const z = camera.zoom;
    const ix = this.px + (this.x - this.px) * alpha, iy = this.py + (this.y - this.py) * alpha;
    const t = this._tick ?? 0;
    if (this.ethereal) ctx.globalAlpha = 0.55;

    // PixelLab animated character takes priority when its frames are loaded
    if (ANIMATED.has(this.type)) {
      const rec = character(CHAR_NAME[this.type] ?? this.type);
      if (rec) {
        const moving = Math.abs(this.vx) > 0.15 || Math.abs(this.vy) > 0.15;
        const walkF = rec.anims.walk ?? rec.anims['fast-walk'] ?? rec.anims.running;
        const idleF = rec.anims['breathing-idle'] ?? rec.anims.idle;
        const atkF = rec.anims.attack ?? rec.anims['attack-right'] ?? rec.anims['cross-punch'] ?? rec.anims.angry ?? rec.anims.bark;
        const frames = (this.nearPlayer ? atkF : null) ?? (moving ? walkF : null) ?? idleF ?? walkF;
        const img = frames?.length ? frames[Math.floor(t * 0.18) % frames.length] : rec.base;
        if (img) {
          // content-box scaling: opaque figure matches hitbox height, feet on the ground
          let dw, dh, cy;
          if (rec.content) {
            const scale = (this.h * 1.08) / rec.content.h;
            dh = img.height * scale * z;
            dw = img.width * scale * z;
            const bottomFrac = (rec.content.y + rec.content.h) / img.height;
            cy = (iy + this.h - oy) * z - dh * bottomFrac + dh / 2;
          } else {
            dh = this.h * 1.5 * z;
            dw = img.width * (dh / img.height);
            cy = (iy + this.h / 2 - oy) * z - 2 * z;
          }
          this.drawSprite(ctx, img, (ix + this.w / 2 - ox) * z, cy, dw, dh, this.facing < 0, 0, this.tintFor());
          ctx.globalAlpha = 1;
          this.drawHpBar(ctx, ix, iy, ox, oy, z);
          return;
        }
      }
    }

    const spr = assets?.sprites?.[this.spriteName()];
    if (spr) {
      const flip = this.facing < 0;
      const tint = this.tintFor();
      if (this.segs) {
        const dw = this.w * 1.3 * z, dh = this.h * 1.3 * z;
        for (let i = this.segs.length - 1; i >= 0; i--) {
          const s = this.segs[i];
          this.drawSprite(ctx, spr, (s.x + this.w / 2 - ox) * z, (s.y + this.h / 2 - oy) * z, dw * 0.92, dh * 0.92, false, 0, tint);
        }
        const ang = Math.atan2(this.vy, this.vx);
        this.drawSprite(ctx, spr, (ix + this.w / 2 - ox) * z, (iy + this.h / 2 - oy) * z, dw, dh, false, ang, tint);
      } else if (this.def.ai === 'slime' || this.type === 'kingSlime') {
        // squash & stretch by vertical velocity
        const squash = Math.max(0.7, Math.min(1.3, 1 - this.vy * 0.04));
        const dw = this.w * (2 - squash) * z, dh = this.h * squash * z * 1.15;
        this.drawSprite(ctx, spr, (ix + this.w / 2 - ox) * z, (iy + this.h - oy) * z - dh / 2, dw, dh, flip, 0, tint);
      } else if (this.def.ai === 'bat') {
        const flap = 1 + Math.sin(t * 0.5) * 0.25;
        this.drawSprite(ctx, spr, (ix + this.w / 2 - ox) * z, (iy + this.h / 2 - oy) * z, this.w * 1.5 * z, this.h * 1.5 * z * flap, flip, 0, tint);
      } else if (this.def.ai === 'flyer' || this.def.ai === 'ghost' || this.def.ai === 'swim' || this.type === 'eyeOfCthulhu') {
        const rot = Math.atan2(this.vy, Math.abs(this.vx)) * 0.4 * (this.facing < 0 ? -1 : 1);
        this.drawSprite(ctx, spr, (ix + this.w / 2 - ox) * z, (iy + this.h / 2 - oy) * z, this.w * 1.25 * z, this.h * 1.25 * z, flip, rot, tint);
      } else {
        // walkers: slight rock while moving
        const rock = Math.abs(this.vx) > 0.1 && this.grounded ? Math.sin(t * 0.3) * 0.06 : 0;
        const dw = spr.width * (this.h / spr.height) * z, dh = this.h * z;
        this.drawSprite(ctx, spr, (ix + this.w / 2 - ox) * z, (iy + this.h / 2 - oy) * z, dw, dh, flip, rock, tint);
      }
    } else {
      // fallback swatch bodies
      ctx.fillStyle = this.def.color;
      if (this.segs) {
        for (const s of this.segs) ctx.fillRect((s.x - ox) * z, (s.y - oy) * z, this.w * z, this.h * z);
      }
      ctx.fillRect((ix - ox) * z, (iy - oy) * z, this.w * z, this.h * z);
    }

    ctx.globalAlpha = 1;
    this.drawHpBar(ctx, ix, iy, ox, oy, z);
  }

  drawHpBar(ctx, ix, iy, ox, oy, z) {
    if (this.hp >= this.def.hp || this.hp <= 0) return;
    const frac = Math.max(0, this.hp / this.def.hp);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect((ix - ox) * z, (iy - 7 - oy) * z, this.w * z, 3 * z);
    ctx.fillStyle = frac > 0.5 ? '#6de86d' : frac > 0.25 ? '#e8c86d' : '#e86d6d';
    ctx.fillRect((ix - ox) * z, (iy - 7 - oy) * z, this.w * frac * z, 3 * z);
  }
}
