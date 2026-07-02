// Bosses — King Slime + Eye of Cthulhu + Eater of Worlds
// (research/terraria/05 §7). Implemented as Enemy subclasses with state machines.

import { TILE, PHYS } from '../config.js';
import { moveEntity } from './physics.js';
import { Enemy, ENEMIES } from './enemy.js';
import { isDay } from '../render/background.js';

// register boss stat blocks
ENEMIES.kingSlime = { name: 'King Slime', ai: 'boss', hp: 2000, dmg: 40, def: 10, kbResist: 1, coins: 10000,
  w: 96, h: 72, color: '#4a7ae8', drops: [['gel', 20, 40, 1.0]] };
ENEMIES.eyeOfCthulhu = { name: 'Eye of Cthulhu', ai: 'boss', hp: 2800, dmg: 15, def: 12, kbResist: 1, coins: 30000,
  w: 55, h: 55, color: '#c8404e', drops: [['demonite', 30, 90, 1.0], ['flamingArrow', 20, 50, 1.0]] };
ENEMIES.servant = { name: 'Servant of Cthulhu', ai: 'flyer', hp: 8, dmg: 12, def: 0, kbResist: 0, coins: 0,
  w: 16, h: 16, color: '#a83a48', drops: [] };
ENEMIES.eaterHead = { name: 'Eater of Worlds', ai: 'worm', hp: 150, dmg: 22, def: 2, kbResist: 1, coins: 500,
  w: 22, h: 22, color: '#6a5a8a', segments: 0, drops: [['demonite', 2, 5, 0.5], ['shadowScale', 1, 2, 0.5]] };

export class KingSlime extends Enemy {
  constructor(x, y) {
    super('kingSlime', x, y);
    this.boss = true;
    this.hopPhase = 0;      // 2 normal, 1 low, 1 high
    this.rest = 0;
    this.slimeSpawnAt = this.hp - 150;
  }

  tick(game) {
    this._tick = game.tick;
    this.px = this.x; this.py = this.y;
    const p = game.player;
    // scale ∝ HP (shrinks as damaged)
    const scale = 0.45 + 0.55 * (this.hp / this.def.hp);
    this.w = Math.round(96 * scale); this.h = Math.round(72 * scale);

    // teleport if kited too far
    if (Math.abs(p.x - this.cx) > 40 * TILE && this.grounded) {
      this.x = p.x + (Math.random() < 0.5 ? -1 : 1) * 6 * TILE - this.w / 2;
      this.y = p.py - 12 * TILE;
      this.vx = 0; this.vy = 0;
    }
    if (this.grounded) {
      this.vx *= 0.8;
      if (++this.rest >= 70) {
        this.rest = 0;
        this.hopPhase = (this.hopPhase + 1) % 4;
        const high = this.hopPhase === 3, low = this.hopPhase === 2;
        const dir = Math.sign(p.x - this.cx) || 1;
        this.vy = high ? -11 : low ? -5 : -8;
        this.vx = dir * (high ? 5 : 3.2) * (1 + (1 - scale) * 0.8); // faster when small
        this.facing = dir;
      }
    }
    // spawn blue slimes as damaged
    if (this.hp < this.slimeSpawnAt) {
      this.slimeSpawnAt -= 150;
      const s = new Enemy('blueSlime', this.cx + (Math.random() - 0.5) * this.w, this.y + this.h / 2);
      game.enemies.push(s);
    }
    this.applyGravityAndMove(game);
  }
}

export class EyeOfCthulhu extends Enemy {
  constructor(x, y) {
    super('eyeOfCthulhu', x, y);
    this.boss = true;
    this.state = 'hover';    // hover → charge ×3 → hover; phase2 at 50%
    this.stateTimer = 0;
    this.charges = 0;
    this.servantTimer = 0;
    this.phase = 1;
  }

  contactDamage() { return this.phase === 2 ? 23 : 15; }

  tick(game) {
    this._tick = game.tick;
    this.px = this.x; this.py = this.y;
    const p = game.player;

    // despawn at dawn or on player death: fly away upward
    if (isDay(game.tick) || p.dead) {
      this.y -= 6;
      if (this.y < -400) this.hp = -1;  // removed silently, no drops
      return;
    }
    if (this.phase === 1 && this.hp <= this.def.hp / 2) {
      this.phase = 2;
      this.def = { ...this.def, def: 0 };
      this.state = 'hover'; this.stateTimer = 0;
    }
    const aggressive = this.phase === 2;
    const chainDash = aggressive && this.hp < this.def.hp * 0.25;
    this.stateTimer++;

    if (this.state === 'hover' && !chainDash) {
      // hover above-left/right of player
      const targetX = p.x, targetY = p.py - 14 * TILE;
      this.vx += Math.sign(targetX - this.cx) * (aggressive ? 0.12 : 0.08);
      this.vy += Math.sign(targetY - this.cy) * 0.1;
      const cap = aggressive ? 5 : 4;
      this.vx = Math.max(-cap, Math.min(cap, this.vx));
      this.vy = Math.max(-3, Math.min(3, this.vy));
      // servants in phase 1
      if (this.phase === 1 && ++this.servantTimer >= 140) {
        this.servantTimer = 0;
        for (let i = 0; i < 3; i++) {
          game.enemies.push(new Enemy('servant', this.cx + (Math.random() - 0.5) * 40, this.cy + 20));
        }
      }
      if (this.stateTimer > (aggressive ? 90 : 150)) {
        this.state = 'aim'; this.stateTimer = 0; this.charges = 0;
      }
    } else if (this.state === 'aim' || (chainDash && this.state !== 'charge')) {
      // brief pause, then lock a charge vector at the player
      if (this.stateTimer > (chainDash ? 8 : 25)) {
        const dx = p.x - this.cx, dy = p.y - this.cy;
        const d = Math.hypot(dx, dy) || 1;
        const spd = chainDash ? 11 : aggressive ? 9.5 : 8;
        this.vx = (dx / d) * spd; this.vy = (dy / d) * spd;
        this.state = 'charge'; this.stateTimer = 0;
      } else {
        this.vx *= 0.92; this.vy *= 0.92;
      }
    } else if (this.state === 'charge') {
      // fly straight; end after a short window
      if (this.stateTimer > (chainDash ? 22 : 40)) {
        this.charges++;
        if (!chainDash && this.charges >= 3) { this.state = 'hover'; }
        else this.state = 'aim';
        this.stateTimer = 0;
      }
    }
    // no tile collision — EoC flies through terrain like Terraria
    this.x += this.vx; this.y += this.vy;
    this.facing = Math.sign(this.vx) || 1;
  }

  draw(ctx, camera, alpha, assets = null) {
    if (assets?.sprites?.eyeOfCthulhu) {
      super.draw(ctx, camera, alpha, assets);
      return;
    }
    const [ox, oy] = camera.frameOrigin(alpha);
    const z = camera.zoom;
    const ix = this.px + (this.x - this.px) * alpha, iy = this.py + (this.y - this.py) * alpha;
    const cx = (ix + this.w / 2 - ox) * z, cy = (iy + this.h / 2 - oy) * z;
    const r = this.w / 2 * z;
    // iris/mouth form — placeholder shapes (art pass M7)
    ctx.fillStyle = this.phase === 2 ? '#8a2432' : '#d8d8e0';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    if (this.phase === 1) {
      ctx.fillStyle = '#3a68c8';
      ctx.beginPath(); ctx.arc(cx + this.facing * r * 0.35, cy, r * 0.45, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#101018';
      ctx.beginPath(); ctx.arc(cx + this.facing * r * 0.5, cy, r * 0.2, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#2a0a10';
      ctx.beginPath(); ctx.arc(cx + this.facing * r * 0.4, cy, r * 0.4, 0, Math.PI); ctx.fill();
      ctx.fillStyle = '#e8e0d0';
      for (let i = -2; i <= 2; i++) {
        ctx.fillRect(cx + this.facing * r * 0.4 + i * 5 * z - 1.5 * z, cy, 3 * z, 6 * z);
      }
    }
    // tendrils
    ctx.strokeStyle = this.phase === 2 ? '#6a1a26' : '#a84a58';
    ctx.lineWidth = 3 * z;
    for (let i = 0; i < 5; i++) {
      const a = Math.PI * (0.65 + i * 0.18) * -this.facing;
      const wig = Math.sin((this._tick ?? 0) * 0.15 + i) * 6;
      ctx.beginPath();
      ctx.moveTo(cx - this.facing * r * 0.8, cy + (i - 2) * r * 0.3);
      ctx.lineTo(cx - this.facing * (r * 1.6 + wig), cy + (i - 2) * r * 0.45 + wig);
      ctx.stroke();
    }
    // hp bar
    if (this.hp < this.def.hp) {
      const frac = Math.max(0, this.hp / this.def.hp);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(cx - r, cy - r - 10 * z, r * 2, 4 * z);
      ctx.fillStyle = '#e86d6d';
      ctx.fillRect(cx - r, cy - r - 10 * z, r * 2 * frac, 4 * z);
    }
  }
}

// Eater of Worlds — v1 simplification: one long worm with a shared HP pool
// (~40 segments × 150 HP ⇒ 6000; true splitting mechanic deferred, flagged deviation).
export function spawnEaterOfWorlds(game, x, y) {
  const worm = new Enemy('eaterHead', x, y);
  worm.boss = true;
  worm.hp = 6000;
  worm.def = { ...worm.def, hp: 6000 };
  worm.segs = [];
  for (let i = 0; i < 40; i++) worm.segs.push({ x: worm.x, y: worm.y });
  game.enemies.push(worm);
  return worm;
}

export function summonBossFactory(game) {
  return (bossId) => {
    const p = game.player;
    if (bossId === 'kingSlime') {
      if (game.enemies.some(e => e.boss)) return false;
      game.enemies.push(new KingSlime(p.x + (Math.random() < 0.5 ? -1 : 1) * 20 * TILE, p.py - 8 * TILE));
      game.announce?.('King Slime has awoken!');
      return true;
    }
    if (bossId === 'eyeOfCthulhu') {
      if (isDay(game.tick)) { game.announce?.('The eye only answers at night…'); return false; }
      if (game.enemies.some(e => e.boss)) return false;
      game.enemies.push(new EyeOfCthulhu(p.x - 30 * TILE, p.py - 20 * TILE));
      game.announce?.('Eye of Cthulhu has awoken!');
      return true;
    }
    if (bossId === 'eaterOfWorlds') {
      if (game.enemies.some(e => e.boss)) return false;
      spawnEaterOfWorlds(game, p.x + 20 * TILE, p.py + 30 * TILE);
      game.announce?.('Eater of Worlds has awoken!');
      return true;
    }
    return false;
  };
}
