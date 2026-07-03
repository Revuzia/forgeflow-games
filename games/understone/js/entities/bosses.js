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
ENEMIES.queenBee = { name: 'Queen Bee', ai: 'boss', hp: 3400, dmg: 30, def: 8, kbResist: 1, coins: 50000,
  w: 66, h: 44, color: '#d8a02a', element: 'water', drops: [['stinger', 6, 12, 1.0], ['gel', 5, 10, 1.0], ['abeemination', 1, 1, 0.1]] };
ENEMIES.bee = { name: 'Bee', ai: 'bat', hp: 13, dmg: 13, def: 0, kbResist: 0, coins: 0,
  dodge: 0.1, w: 12, h: 10, color: '#e8c02a', drops: [] };
ENEMIES.wallOfFlesh = { name: 'Wall of Flesh', ai: 'boss', hp: 8000, dmg: 50, def: 12, kbResist: 1, coins: 80000,
  w: 60, h: 320, color: '#a03a4a', element: 'fire', drops: [['pwnhammer', 1, 1, 1.0], ['lesserHealingPotion', 5, 10, 1.0], ['hellstoneBar', 5, 12, 1.0]] };

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

// Queen Bee — jungle boss: hover → horizontal dash ×3 → summon bees → repeat
export class QueenBee extends Enemy {
  constructor(x, y) {
    super('queenBee', x, y);
    this.boss = true;
    this.state = 'hover';
    this.stateTimer = 0;
    this.dashes = 0;
  }

  tick(game) {
    this._tick = game.tick;
    this.px = this.x; this.py = this.y;
    const p = game.player;
    if (p.dead) { this.y -= 4; if (this.y < -300) this.hp = -1; return; }
    this.stateTimer++;
    if (this.state === 'hover') {
      const tx = p.x, ty = p.py - 9 * TILE;
      this.vx += Math.sign(tx - this.cx) * 0.12;
      this.vy += Math.sign(ty - this.cy) * 0.1;
      this.vx = Math.max(-4, Math.min(4, this.vx));
      this.vy = Math.max(-2.5, Math.min(2.5, this.vy));
      if (this.stateTimer > 110) {
        this.state = this.dashes < 3 ? 'dash' : 'spawn';
        this.stateTimer = 0;
      }
    } else if (this.state === 'dash') {
      if (this.stateTimer === 1) {
        // align horizontally, then charge across
        this.vy = (p.y - this.cy) * 0.02;
        this.vx = Math.sign(p.x - this.cx) * 9;
        game.audio?.play('swing', { volume: 0.7, rate: 0.7 });
      }
      if (this.stateTimer > 35) { this.dashes++; this.state = 'hover'; this.stateTimer = 0; }
    } else if (this.state === 'spawn') {
      if (this.stateTimer === 1) {
        for (let i = 0; i < 4; i++) {
          game.enemies.push(new Enemy('bee', this.cx + (Math.random() - 0.5) * 40, this.cy + 20));
        }
        game.audio?.play('swing', { volume: 0.5, rate: 1.4 });
      }
      this.vx *= 0.9; this.vy *= 0.9;
      if (this.stateTimer > 50) { this.dashes = 0; this.state = 'hover'; this.stateTimer = 0; }
    }
    this.x += this.vx; this.y += this.vy;      // flies through terrain
    this.facing = Math.sign(this.vx) || 1;
  }
}

// Wall of Flesh — END-GAME: a living wall that sweeps across the underworld.
// Beat it to unlock hardmode (the pre-hardmode victory condition, per research 04 §10).
export class WallOfFlesh extends Enemy {
  constructor(x, y, dir) {
    super('wallOfFlesh', x, y);
    this.boss = true;
    this.dir = dir;               // sweep direction
    this.laserTimer = 0;
    this.h = 320;
    this.y = y - 160;
  }

  contactDamage() { return 50; }

  tick(game) {
    this._tick = game.tick;
    this.px = this.x; this.py = this.y;
    const p = game.player;
    // relentless horizontal sweep, slightly faster as it weakens
    const speed = 0.8 + (1 - this.hp / this.def.hp) * 1.2;
    this.x += this.dir * speed;
    // pin vertical span to the underworld band around the player
    const hellTop = game.world.h * 0.86 * 16;
    this.y = Math.max(hellTop, p.y - 160);
    // eye lasers
    if (++this.laserTimer >= 80 && !p.dead) {
      this.laserTimer = 0;
      for (const eyeFrac of [0.25, 0.7]) {
        game.projectiles?.spawnEnemy('laser', this.cx + this.dir * 20, this.y + this.h * eyeFrac, p.x, p.y, 7, 28);
      }
    }
    // if it sweeps past the world edge, it escapes (fight lost)
    if (this.x < 16 || this.x > (game.world.w - 2) * 16) {
      this.hp = -1;
      game.announce?.('The Wall of Flesh escaped beyond the world…');
    }
  }

  draw(ctx, camera, alpha) {
    const [ox, oy] = camera.frameOrigin(alpha);
    const z = camera.zoom;
    const sx = (this.x - ox) * z, sy = (this.y - oy) * z;
    const w2 = this.w * z, h2 = this.h * z;
    // flesh column with sinew bands
    const grad = ctx.createLinearGradient(sx, 0, sx + w2, 0);
    grad.addColorStop(0, '#6a1f2c');
    grad.addColorStop(0.5, '#a03a4a');
    grad.addColorStop(1, '#7a2836');
    ctx.fillStyle = grad;
    ctx.fillRect(sx, sy, w2, h2);
    ctx.fillStyle = 'rgba(60,10,20,0.5)';
    for (let i = 0; i < 10; i++) {
      const yy = sy + (i / 10) * h2 + Math.sin((this._tick ?? 0) * 0.05 + i) * 4 * z;
      ctx.fillRect(sx, yy, w2, 3 * z);
    }
    // eyes + mouth
    for (const f of [0.25, 0.7]) {
      const ey = sy + h2 * f;
      ctx.fillStyle = '#e8e0d0';
      ctx.beginPath(); ctx.ellipse(sx + w2 * (this.dir > 0 ? 0.8 : 0.2), ey, 9 * z, 6 * z, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c03a2a';
      ctx.beginPath(); ctx.arc(sx + w2 * (this.dir > 0 ? 0.85 : 0.15), ey, 3.5 * z, 0, Math.PI * 2); ctx.fill();
    }
    const my = sy + h2 * 0.47;
    ctx.fillStyle = '#3a0a12';
    ctx.beginPath(); ctx.ellipse(sx + w2 * (this.dir > 0 ? 0.82 : 0.18), my, 8 * z, 14 * z, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e8e0d0';
    for (let t = 0; t < 4; t++) ctx.fillRect(sx + w2 * (this.dir > 0 ? 0.78 : 0.14) + t * 3 * z, my - 12 * z, 2 * z, 5 * z);
    this.drawHpBar(ctx, this.x, this.y, ox, oy, z);
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
    if (bossId === 'queenBee') {
      if (game.enemies.some(e => e.boss)) return false;
      const ptx = p.x / 16;
      const d = game.world.biomes?.desert ?? game.world.biomes?.jungle;   // wasps live in the desert now (legacy: jungle)
      const inHive = d && (typeof d[0] === 'number' ? (ptx >= d[0] && ptx <= d[1]) : d.some((s) => ptx >= s[0] && ptx <= s[1]));
      if (!inHive) { game.announce?.('The abeemination hums only in the desert wastes…'); return false; }
      game.enemies.push(new QueenBee(p.x + 15 * TILE, p.py - 12 * TILE));
      game.announce?.('Queen Bee has awoken!');
      return true;
    }
    if (bossId === 'wallOfFlesh') {
      if (game.enemies.some(e => e.boss)) return false;
      if (p.py / 16 < game.world.h * 0.86) { game.announce?.('The doll thirsts for the fires of the underworld…'); return false; }
      const dir = p.x / 16 < game.world.w / 2 ? 1 : -1;
      game.enemies.push(new WallOfFlesh(p.x - dir * 30 * TILE, p.y, dir));
      game.announce?.('The Wall of Flesh has awoken! RUN!');
      game.fx?.addTrauma(0.8);
      return true;
    }
    if (bossId === 'eaterOfWorlds') {
      if (game.enemies.some(e => e.boss)) return false;
      const ptx = p.x / 16;
      const inCorruption = (game.world.corruption ?? []).some(([a, b]) => ptx >= a && ptx <= b);
      if (!inCorruption) { game.announce?.('The worm only stirs beneath corrupted ground…'); return false; }
      spawnEaterOfWorlds(game, p.x + 20 * TILE, p.py + 30 * TILE);
      game.announce?.('Eater of Worlds has awoken!');
      return true;
    }
    return false;
  };
}
