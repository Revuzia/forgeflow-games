// Enemies — stats + AI constants from research/terraria/05-combat-enemies-bosses.md
// (decompiled NPC.cs values). Damage formula: floor(atk±15% − def/2), min 1.
// AI archetypes: slime, fighter, flyer, bat, worm, caster.

import { TILE, PHYS } from '../config.js';
import { moveEntity, entityLiquid } from './physics.js';

// registry ---------------------------------------------------------------------
export const ENEMIES = {
  greenSlime: { name: 'Green Slime', ai: 'slime', hp: 14, dmg: 6, def: 0, kbResist: -0.2, coins: 3,
    w: 24, h: 18, color: '#7ddc7d', drops: [['gel', 1, 2, 1.0]] },
  blueSlime: { name: 'Blue Slime', ai: 'slime', hp: 25, dmg: 7, def: 2, kbResist: 0, coins: 25,
    w: 24, h: 18, color: '#6da8e8', drops: [['gel', 1, 2, 1.0]] },
  zombie: { name: 'Zombie', ai: 'fighter', hp: 45, dmg: 14, def: 6, kbResist: 0.5, coins: 60,
    w: 18, h: 40, color: '#6a8a5a', drops: [] },
  demonEye: { name: 'Demon Eye', ai: 'flyer', hp: 60, dmg: 18, def: 2, kbResist: 0.2, coins: 75,
    w: 20, h: 20, color: '#c05a5a', drops: [['lens', 1, 1, 0.33]] },
  skeleton: { name: 'Skeleton', ai: 'fighter', hp: 60, dmg: 20, def: 8, kbResist: 0.5, coins: 100,
    w: 18, h: 40, color: '#d8d8c8', drops: [] },
  caveBat: { name: 'Cave Bat', ai: 'bat', hp: 16, dmg: 13, def: 2, kbResist: 0.2, coins: 90,
    w: 18, h: 14, color: '#8a7aa0', drops: [] },
  giantWorm: { name: 'Giant Worm', ai: 'worm', hp: 30, dmg: 8, def: 0, kbResist: 1.0, coins: 40,
    w: 14, h: 14, color: '#b08a6a', segments: 7, drops: [] },
  eaterOfSouls: { name: 'Eater of Souls', ai: 'flyer', hp: 40, dmg: 22, def: 8, kbResist: 0.5, coins: 90,
    w: 24, h: 24, color: '#9a8ab8', drops: [['rottenChunk', 1, 1, 0.33]] },
  fireImp: { name: 'Fire Imp', ai: 'caster', hp: 70, dmg: 30, def: 16, kbResist: 0.5, coins: 350,
    w: 18, h: 36, color: '#e07a3a', drops: [] },
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

  // player attack → damage. Returns actual damage or 0 if immune this tick.
  strike(rawDmg, kb, fromX, sourceKey = 'melee', crit = false) {
    const now = this._tick ?? 0;
    const until = this.hitCooldown.get(sourceKey) ?? -1;
    if (now < until) return 0;
    this.hitCooldown.set(sourceKey, now + 10);
    const variance = 0.85 + Math.random() * 0.3;
    let dmg = Math.max(1, Math.floor(rawDmg * variance - this.def.def / 2));
    if (crit) dmg *= 2;
    this.hp -= dmg;
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
    const ai = this.def.ai;
    if (ai === 'slime') this.aiSlime(game);
    else if (ai === 'fighter') this.aiFighter(game);
    else if (ai === 'flyer') this.aiFlyer(game);
    else if (ai === 'bat') this.aiBat(game);
    else if (ai === 'worm') this.aiWorm(game);
    else if (ai === 'caster') this.aiCaster(game);
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
    const max = 1.0;
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
      // cast fireball
      game.projectiles?.spawnEnemy('fireball', this.cx, this.cy - 6, p.x, p.y - 10, 4.5, this.def.dmg);
      this.aiPhase++;
    }
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
    }[this.type];
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
    const spr = assets?.sprites?.[this.spriteName()];
    const t = this._tick ?? 0;

    if (spr) {
      const flip = this.facing < 0;
      // blue/green slime tint over the shared slime sprite
      const tint = this.type === 'blueSlime' ? 'rgba(70,120,255,0.45)' : null;
      if (this.segs) {
        const dw = this.w * 1.3 * z, dh = this.h * 1.3 * z;
        for (let i = this.segs.length - 1; i >= 0; i--) {
          const s = this.segs[i];
          this.drawSprite(ctx, spr, (s.x + this.w / 2 - ox) * z, (s.y + this.h / 2 - oy) * z, dw * 0.92, dh * 0.92, false);
        }
        const ang = Math.atan2(this.vy, this.vx);
        this.drawSprite(ctx, spr, (ix + this.w / 2 - ox) * z, (iy + this.h / 2 - oy) * z, dw, dh, false, ang);
      } else if (this.def.ai === 'slime' || this.type === 'kingSlime') {
        // squash & stretch by vertical velocity
        const squash = Math.max(0.7, Math.min(1.3, 1 - this.vy * 0.04));
        const dw = this.w * (2 - squash) * z, dh = this.h * squash * z * 1.15;
        this.drawSprite(ctx, spr, (ix + this.w / 2 - ox) * z, (iy + this.h - oy) * z - dh / 2, dw, dh, flip, 0, tint);
      } else if (this.def.ai === 'bat') {
        const flap = 1 + Math.sin(t * 0.5) * 0.25;
        this.drawSprite(ctx, spr, (ix + this.w / 2 - ox) * z, (iy + this.h / 2 - oy) * z, this.w * 1.5 * z, this.h * 1.5 * z * flap, flip);
      } else if (this.def.ai === 'flyer' || this.type === 'eyeOfCthulhu') {
        const rot = Math.atan2(this.vy, Math.abs(this.vx)) * 0.4 * (this.facing < 0 ? -1 : 1);
        this.drawSprite(ctx, spr, (ix + this.w / 2 - ox) * z, (iy + this.h / 2 - oy) * z, this.w * 1.25 * z, this.h * 1.25 * z, flip, rot);
      } else {
        // walkers: slight rock while moving
        const rock = Math.abs(this.vx) > 0.1 && this.grounded ? Math.sin(t * 0.3) * 0.06 : 0;
        const dw = spr.width * (this.h / spr.height) * z, dh = this.h * z;
        this.drawSprite(ctx, spr, (ix + this.w / 2 - ox) * z, (iy + this.h / 2 - oy) * z, dw, dh, flip, rock);
      }
    } else {
      // fallback swatch bodies
      ctx.fillStyle = this.def.color;
      if (this.segs) {
        for (const s of this.segs) ctx.fillRect((s.x - ox) * z, (s.y - oy) * z, this.w * z, this.h * z);
      }
      ctx.fillRect((ix - ox) * z, (iy - oy) * z, this.w * z, this.h * z);
    }

    // hp bar when damaged
    if (this.hp < this.def.hp && this.hp > 0) {
      const frac = Math.max(0, this.hp / this.def.hp);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect((ix - ox) * z, (iy - 7 - oy) * z, this.w * z, 3 * z);
      ctx.fillStyle = frac > 0.5 ? '#6de86d' : frac > 0.25 ? '#e8c86d' : '#e86d6d';
      ctx.fillRect((ix - ox) * z, (iy - 7 - oy) * z, this.w * frac * z, 3 * z);
    }
  }
}
