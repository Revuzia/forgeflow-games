// Player — per-tick pipeline mirrors Terraria's UpdatePlayer order
// (research/terraria/01-physics-collision.md §5.3):
// reset stats → liquid overrides → horizontal → jump → gravity → integrate+collide
// → head bonk → fall damage. Mining/placing live here too (uses held item).

import { TILE, PHYS, REACH, COMBAT, WORLD_H, LAYERS } from '../config.js';
import { T, TILES, WALLS } from '../world/world.js';
import { isDown, wasPressed, mouse } from '../core/input.js';
import { moveEntity, entityLiquid, colFlags } from './physics.js';

export class Player {
  constructor(world) {
    this.world = world;
    this.w = PHYS.playerW; this.h = PHYS.playerH;

    this.hpMax = COMBAT.playerBaseHP; this.hp = this.hpMax;
    this.manaMax = COMBAT.playerBaseMana; this.mana = this.manaMax;

    this.facing = 1;
    this.jump = 0;               // remaining sustain ticks
    this.releaseJump = true;     // jump button seen up since last jump
    this.iFrames = 0;
    this.breathTimer = 0;
    this.respawnTimer = 0;
    this.respawn();              // sets position, fallStartTy, breath, hp — keep LAST

    this.poisonTicks = 0;        // Poisoned debuff (can't drop below 1 HP)
    this.potionCd = 0;           // potion sickness (60 s)
    this.grapple = null;         // {x,y, latched} — kinematic hook (research 01 §8)

    // mining state
    this.swingTimer = 0;         // ticks until next tool hit
    this.miningTile = -1;        // packed tx,ty currently being damaged
    this.miningDamage = 0;       // accumulated 0..100
    this.swinging = 0;           // >0 while tool-swing animation plays

    this.heldItem = null;        // adapter object set each tick from the inventory

    this.onDig = [];             // (tx, ty, tileInfo) subscribers — drops, particles, sfx
    this.onHurt = [];
  }

  // center-x/y in px (camera target interface)
  get x() { return this.px + this.w / 2; }
  get y() { return this.py + this.h / 2; }

  respawn() {
    this.px = this.world.spawnX * TILE - PHYS.playerW / 2;
    this.py = this.world.spawnY * TILE - PHYS.playerH;
    this.ppx = this.px; this.ppy = this.py;
    this.vx = 0; this.vy = 0;
    this.hp = this.hpMax;
    this.dead = false;
    this.fallStartTy = (this.py / TILE) | 0;
    this.breath = PHYS.breathMax;
  }

  grounded() { return this.vy === 0; }

  nearCampfire(game) {
    const ptx = Math.floor(this.x / TILE), pty = Math.floor(this.y / TILE);
    for (let ty = pty - 12; ty <= pty + 12; ty++) {
      for (let tx = ptx - 12; tx <= ptx + 12; tx++) {
        if (this.world.tileAt(tx, ty) === T.campfire) return true;
      }
    }
    return false;
  }

  hurt(dmg, fromX = null) {
    if (this.iFrames > 0 || this.dead) return false;
    this.hp -= Math.max(1, Math.round(dmg));
    this.iFrames = PHYS.hurtIFrames;
    this.recentHurt = 420;                     // pauses natural regen 7 s
    // knockback REPLACES velocity
    const dir = fromX === null ? -this.facing : (this.x < fromX ? -1 : 1);
    this.vx = PHYS.hurtKnockX * dir;
    this.vy = PHYS.hurtKnockY;
    for (const fn of this.onHurt) fn(dmg);
    if (this.hp <= 0) this.die();
    return true;
  }

  die() {
    this.dead = true;
    this.hp = 0;
    this.respawnTimer = COMBAT.respawnTicks;
  }

  tick(game) {
    this.ppx = this.px; this.ppy = this.py;
    if (this.dead) {
      if (--this.respawnTimer <= 0) this.respawn();
      return;
    }
    if (this.iFrames > 0) this.iFrames--;
    if (this.potionCd > 0) this.potionCd--;
    if (this.recentHurt > 0) this.recentHurt--;
    if (this.manaRegenDelay > 0) this.manaRegenDelay--;
    // mana regen: pauses briefly after casting
    if (this.manaRegenDelay <= 0 && this.mana < this.manaMax && game.tick % 6 === 0) this.mana++;
    // natural life regen (slow; paused 7 s after damage; doubled near a campfire;
    // Band of Regeneration accessory adds +1/s and works even while hurt-paused)
    const accRegen = game.inventory?.accessoryEffects?.().regen ?? 0;
    if (this.hp < this.hpMax && !this.dead) {
      if (accRegen > 0 && game.tick % 60 === 0) this.hp = Math.min(this.hpMax, this.hp + accRegen);
      if (this.recentHurt <= 0) {
        if (game.tick % 60 === 0) this.campfire = this.nearCampfire(game);
        const interval = this.campfire ? 60 : 120;
        if (game.tick % interval === 0) this.hp = Math.min(this.hpMax, this.hp + 1);
      }
    }
    if (this.poisonTicks > 0) {
      this.poisonTicks--;
      if (this.poisonTicks % 30 === 0 && this.hp > 1) {
        this.hp = Math.max(1, this.hp - 1);            // poison never kills
        game.floatText?.(this.x, this.py - 10, 1, '#7ab43a');
      }
      if (game.tick % 5 === 0) game.fx?.spawn(4, this.px + Math.random() * this.w, this.py + Math.random() * this.h, 0, -0.3, 12, 1, '#7ab43a');
    }

    // ---- reset per-tick stats, then liquid overrides -------------------------
    const liquid = entityLiquid(this.world, { x: this.px, y: this.py, w: this.w, h: this.h });
    const wet = liquid >= 1, inLava = liquid === 2;
    let gravity = PHYS.gravity, maxFall = PHYS.maxFall;
    let jumpSpeed = PHYS.jumpSpeed, jumpHold = PHYS.jumpHold;
    let moveFactor = 1;
    if (wet) {
      gravity = PHYS.waterGravity; maxFall = PHYS.waterMaxFall;
      jumpSpeed = PHYS.waterJumpSpeed; jumpHold = PHYS.waterJumpHold;
      moveFactor = PHYS.waterMoveFactor;
      this.fallStartTy = (this.py / TILE) | 0;   // liquids negate fall damage
    }
    // space layer: reduced gravity near world top
    const tyNow = this.py / TILE;
    if (tyNow < WORLD_H * LAYERS.surfaceTop * 0.5) gravity *= 0.5;

    // ---- accessory effects (paper-doll bonuses) ------------------------------
    const acc = game.inventory?.accessoryEffects?.() ?? { moveSpeed: 1, regen: 0, extraJumps: 0, noFallDamage: false };
    const maxRun = PHYS.maxRun * acc.moveSpeed;

    // ---- horizontal movement (§2) --------------------------------------------
    const left = isDown('left'), right = isDown('right');
    const input = (right ? 1 : 0) - (left ? 1 : 0);
    const friction = this.grounded() ? PHYS.runSlow : PHYS.runSlow * 0.5;
    if (input !== 0) {
      if (Math.sign(this.vx) === -input) {
        // turning skid: friction AND accel the same tick (0.28 total)
        this.vx += input * (PHYS.runSlow + PHYS.runAccel);
      } else if (Math.abs(this.vx) < maxRun) {
        this.vx += input * PHYS.runAccel;
        if (Math.abs(this.vx) > maxRun) this.vx = input * maxRun;
      }
      if (this.swinging <= 0) this.facing = input;
    } else {
      if (Math.abs(this.vx) <= friction) this.vx = 0;
      else this.vx -= Math.sign(this.vx) * friction;
    }

    // ---- jump: velocity-pin model (§3) + accessory double-jumps ----------------
    const jumpHeld = isDown('jump');
    if (!jumpHeld) { this.releaseJump = true; this.jump = 0; }
    if (jumpHeld && this.jump > 0) {
      this.vy = -jumpSpeed;       // re-pinned every tick while sustained
      this.jump--;
    } else if (jumpHeld && this.releaseJump && this.grounded()) {
      this.vy = -jumpSpeed;
      this.jump = jumpHold;
      this.releaseJump = false;
      this.airJumpsLeft = acc.extraJumps;   // reset midair jumps on ground jump
    } else if (jumpHeld && this.releaseJump && !this.grounded() && (this.airJumpsLeft ?? 0) > 0) {
      // Cloud in a Bottle-style extra jump
      this.vy = -jumpSpeed;
      this.jump = Math.floor(jumpHold * 0.75);
      this.releaseJump = false;
      this.airJumpsLeft--;
      game.fx?.sparks(this.x, this.py + this.h, '#cfe0ff', 4);
    }
    if (this.grounded()) this.airJumpsLeft = acc.extraJumps;

    // ---- gravity ----------------------------------------------------------------
    this.vy += gravity;
    if (this.vy > maxFall) this.vy = maxFall;

    // ---- grapple override (research 01 §8: velocity fully replaced by clamped pull) ----
    if (this.grapple) {
      const gp = this.grapple;
      if (!gp.latched) {
        // hook in flight
        gp.x += gp.vx; gp.y += gp.vy;
        gp.range -= Math.hypot(gp.vx, gp.vy);
        const tx = Math.floor(gp.x / TILE), ty = Math.floor(gp.y / TILE);
        if (this.world.isSolid(tx, ty)) { gp.latched = true; this.fallStartTy = (this.py / TILE) | 0; }
        else if (gp.range <= 0) this.grapple = null;
      }
      if (this.grapple?.latched) {
        // pull: velocity = clampLength(anchor - center, 11)
        const dx = gp.x - this.x, dy = gp.y - (this.py + this.h / 2);
        const d = Math.hypot(dx, dy);
        if (d < 6) { this.vx = 0; this.vy = 0; }
        else {
          const sp = Math.min(11, d);
          this.vx = (dx / d) * sp;
          this.vy = (dy / d) * sp;
        }
        this.fallStartTy = (this.py / TILE) | 0;      // grapple negates fall damage
        // jump releases with a half-jump (7 ticks)
        if (isDown('jump') && this.releaseJump) {
          this.grapple = null;
          this.vy = -PHYS.jumpSpeed;
          this.jump = Math.floor(PHYS.jumpHold / 2);
          this.releaseJump = false;
        }
      }
    }

    // ---- integrate + collide ------------------------------------------------------
    const e = { x: this.px, y: this.py, vx: this.vx, vy: this.vy, w: this.w, h: this.h };
    const wasFalling = this.vy > 0;
    const flags = moveEntity(this.world, e, { fallThrough: isDown('down'), moveFactor });
    this.px = e.x; this.py = e.y; this.vx = e.vx; this.vy = e.vy;
    if (flags.up) { this.vy = 0.01; this.jump = 0; }        // head bonk

    // ---- fall damage (§4) -----------------------------------------------------------
    const tileY = (this.py / TILE) | 0;
    if (this.jump > 0 || wet || !wasFalling) this.fallStartTy = tileY;
    if (flags.down && this.vy === 0) {
      const fallen = tileY - this.fallStartTy;
      if (fallen > PHYS.safeFallTiles && !acc.noFallDamage) {
        this.hurtNoKb((fallen - PHYS.safeFallTiles) * PHYS.fallDmgPerTile);
      }
      this.fallStartTy = tileY;
    }

    // ---- breath & lava ---------------------------------------------------------------
    const headLiquid = entityLiquid(this.world, { x: this.px, y: this.py, w: this.w, h: 8 });
    if (headLiquid >= 1) {
      if (++this.breathTimer >= PHYS.breathLossEvery) {
        this.breathTimer = 0;
        if (this.breath > 0) this.breath--;
        else this.hurtNoKb(PHYS.drownDmg);
      }
    } else {
      this.breath = Math.min(PHYS.breathMax, this.breath + PHYS.breathRegenPerTick);
      this.breathTimer = 0;
    }
    if (inLava) this.hurt(PHYS.lavaDamage);

    // ---- fishing bobber -------------------------------------------------------------------
    if (this.bobber) {
      const b = this.bobber;
      if (!b.inWater) {
        b.vy += 0.25;
        b.x += b.vx; b.y += b.vy;
        const btx = Math.floor(b.x / TILE), bty = Math.floor(b.y / TILE);
        if (this.world.inBounds(btx, bty) && this.world.liquid[bty * this.world.w + btx] >= 100 && this.world.liquidType[bty * this.world.w + btx] === 0) {
          b.inWater = true;
          b.biteIn = 180 + (Math.random() * 420) | 0;
          game.fx?.splash(b.x, b.y, 0, -1, 0.8);
        } else if (this.world.isSolid(btx, bty) || Math.hypot(b.x - this.x, b.y - this.y) > 340) {
          this.bobber = null;   // hit land / line too long
        }
      } else {
        b.y += Math.sin(game.tick * 0.08) * 0.15;      // gentle float
        if (b.biting > 0) {
          b.biting--;
          if ((game.tick & 3) === 0) game.fx?.bubble(b.x, b.y);
          if (b.biting === 0) b.biteIn = 240 + (Math.random() * 400) | 0;  // missed it
        } else if (b.biteIn > 0) {
          b.biteIn--;
          if (b.biteIn === 0) {
            b.biting = 45;                               // strike window!
            b.y += 4;
            game.fx?.splash(b.x, b.y, 0, -1, 1);
            game.audio?.play('pickup', { volume: 0.9, rate: 0.6 });
          }
        }
      }
    }

    // ---- mining / placing / interacting --------------------------------------------------
    this.updateTool(game);
    this.updateInteract(game);
    if (this.swinging > 0) this.swinging--;
  }

  // right-click: doors, chests, altar hint
  updateInteract(game) {
    if (!mouse.rightPressed || game.hud?.open) return;
    const { tx, ty, inReach } = this.targetTile(game);
    if (!inReach) return;
    const world = this.world;
    const id = world.tileAt(tx, ty);
    if (id === T.door) { world.setTile(tx, ty, T.doorOpen); game.audio?.play('doorOpen'); }
    else if (id === T.doorOpen) {
      // don't close a door on top of yourself
      if (!this.overlapsBox(tx * TILE, ty * TILE, TILE, TILE)) { world.setTile(tx, ty, T.door); game.audio?.play('doorClose'); }
    } else if (id === T.chest && game.openChest) game.openChest(tx, ty);
    else if (id === T.spawnPoint || id === T.bed) {
      this.world.spawnX = tx;
      this.world.spawnY = ty - 1;
      game.announce?.('Spawn point set!');
      game.audio?.play('powerup', { volume: 0.6 });
    } else if (game.npcInteract && game.npcInteract(tx, ty)) { /* talked to an NPC */ }
  }

  hurtNoKb(dmg) {
    if (this.iFrames > 0 || this.dead) return;
    this.hp -= Math.max(1, Math.round(dmg));
    this.iFrames = PHYS.hurtIFrames;
    for (const fn of this.onHurt) fn(dmg);
    if (this.hp <= 0) this.die();
  }

  // cursor target tile + Terraria reach test (measured from hitbox EDGES, research 03 §3)
  targetTile(game) {
    const [wx, wy] = game.camera.screenToWorld(
      mouse.x * (game.canvas.width / game.canvas.clientWidth),
      mouse.y * (game.canvas.height / game.canvas.clientHeight),
    );
    const tx = Math.floor(wx / TILE), ty = Math.floor(wy / TILE);
    const inReach =
      (this.px / TILE) - REACH.tilesX <= tx &&
      (this.px + this.w) / TILE + REACH.tilesX - 1 >= tx &&
      (this.py / TILE) - REACH.tilesY <= ty &&
      (this.py + this.h) / TILE + REACH.tilesY - 2 >= ty;
    return { tx, ty, inReach };
  }

  updateTool(game) {
    if (this.swingTimer > 0) this.swingTimer--;
    // while the inventory/crafting panel is open, clicks belong to the UI — never swing/mine/place
    if (game.hud?.open) { this.miningTile = -1; this.miningDamage = 0; return; }
    const held = this.heldItem;
    if (!held || !mouse.left) { this.miningTile = -1; this.miningDamage = 0; return; }

    // ---- consumables & boss summons (no tile target needed) --------------------
    if (held.use || held.boss) {
      if (this.swingTimer > 0) return;
      this.swingTimer = held.useTime ?? 30;
      this.swinging = held.useTime ?? 30;
      if (held.use === 'lifeCrystal' && this.hpMax < 400) {
        this.hpMax += 20; this.hp = Math.min(this.hpMax, this.hp + 20);
        game.audio?.play('powerup');
        held.consume?.();
      } else if (held.use === 'manaCrystal' && this.manaMax < 200) {
        this.manaMax += 20; this.mana = Math.min(this.manaMax, this.mana + 20);
        game.audio?.play('powerup');
        held.consume?.();
      } else if (held.use === 'magicMirror') {
        // teleport home; resets fall damage; not consumed
        this.px = this.world.spawnX * TILE - this.w / 2;
        this.py = this.world.spawnY * TILE - this.h;
        this.vx = 0; this.vy = 0;
        this.grapple = null;
        this.fallStartTy = (this.py / TILE) | 0;
        game.audio?.play('powerup');
      } else if (held.use === 'heal') {
        if (this.potionCd > 0 || this.hp >= this.hpMax) return;
        const amount = held.heal ?? 50;
        this.hp = Math.min(this.hpMax, this.hp + amount);
        this.potionCd = 3600;                          // potion sickness: 60 s
        game.floatText?.(this.x, this.py - 12, `+${amount}`, '#6de86d');
        game.audio?.play('powerup');
        held.consume?.();
      } else if (held.use === 'mana') {
        if (this.mana >= this.manaMax) return;
        this.mana = Math.min(this.manaMax, this.mana + (held.mana ?? 50));
        game.floatText?.(this.x, this.py - 12, `+mana`, '#6a9ae8');
        game.audio?.play('powerup', { rate: 1.2 });
        held.consume?.();
      } else if (held.use === 'fish') {
        if (this.bobber) {
          // reel in
          if (this.bobber.biting > 0) {
            const roll = Math.random();
            const caught = roll < 0.55 ? ['fish', 1] : roll < 0.73 ? ['crate', 1] : roll < 0.85 ? ['goldenCarp', 1] : ['cobweb', 2];
            game.inventory.add(caught[0], caught[1]);
            game.floatText?.(this.x, this.py - 12, `${game.ITEMS[caught[0]].name}!`, '#9ecbff');
            game.audio?.play('pickup', { volume: 0.8 });
            game.fx?.splash(this.bobber.x, this.bobber.y, 0, -1, 1.5);
            game.progress = game.progress ?? {};
            game.progress.fishCaught = (game.progress.fishCaught ?? 0) + 1;
          }
          this.bobber = null;
        } else {
          const [wx, wy] = game.camera.screenToWorld(
            mouse.x * (game.canvas.width / game.canvas.clientWidth),
            mouse.y * (game.canvas.height / game.canvas.clientHeight));
          const dx = wx - this.x, dy = wy - this.py;
          const d = Math.hypot(dx, dy) || 1;
          this.bobber = { x: this.x, y: this.py + 4, vx: (dx / d) * 6, vy: (dy / d) * 6 - 1.5, inWater: false, biteIn: -1, biting: 0 };
          game.audio?.play('swing', { volume: 0.35 });
        }
      } else if (held.use === 'crate') {
        // crack open a fishing crate
        const LOOT = [['ironBar', 3, 6], ['silverBar', 2, 4], ['goldBar', 1, 3], ['bomb', 2, 4], ['lesserHealingPotion', 2, 3], ['torch', 5, 12]];
        const [id, lo, hi] = LOOT[(Math.random() * LOOT.length) | 0];
        const n = lo + (Math.random() * (hi - lo + 1) | 0);
        game.inventory.add(id, n);
        if (Math.random() < 0.08) game.inventory.add('lifeCrystal', 1);
        game.floatText?.(this.x, this.py - 12, `${game.ITEMS[id].name} (${n})`, '#e8c86d');
        game.audio?.play('craft');
        held.consume?.();
      } else if (held.use === 'throw') {
        // bombs & dynamite: lobbed with a lit fuse
        const [wx, wy] = game.camera.screenToWorld(
          mouse.x * (game.canvas.width / game.canvas.clientWidth),
          mouse.y * (game.canvas.height / game.canvas.clientHeight));
        const dx = wx - this.x, dy = wy - (this.py + 8);
        const d = Math.hypot(dx, dy) || 1;
        const sp = Math.min(9, 4 + d / 60);
        game.combat?.throwBomb(this.x, this.py + 8, (dx / d) * sp, (dy / d) * sp - 1.5, held);
        game.audio?.play('swing', { volume: 0.5 });
        held.consume?.();
      } else if (held.use === 'grapple') {
        // fire hook toward cursor (or release if latched)
        if (this.grapple?.latched) { this.grapple = null; return; }
        const [wx, wy] = game.camera.screenToWorld(
          mouse.x * (game.canvas.width / game.canvas.clientWidth),
          mouse.y * (game.canvas.height / game.canvas.clientHeight));
        const dx = wx - this.x, dy = wy - (this.py + this.h / 2);
        const d = Math.hypot(dx, dy) || 1;
        this.grapple = { x: this.x, y: this.py + this.h / 2, vx: (dx / d) * 12, vy: (dy / d) * 12, latched: false, range: 25 * TILE };
        game.audio?.play('swing', { volume: 0.4 });
      } else if (held.boss && game.summonBoss) {
        if (game.summonBoss(held.boss)) held.consume?.();
      }
      return;
    }

    const { tx, ty, inReach } = this.targetTile(game);
    if (!inReach || this.swingTimer > 0) return;
    const world = this.world;
    const id = world.tileAt(tx, ty);

    // ---- placeable item (block/wall/torch) -----------------------------------
    if (held.placeTile != null) {
      if (id !== T.air) return;
      if (!this.canPlaceAt(tx, ty, held.placeTile)) return;
      // never place a solid block inside any entity (incl. self)
      if (TILES[held.placeTile].solid && this.overlapsBox(tx * TILE, ty * TILE, TILE, TILE)) return;
      this.swingTimer = held.useTime;
      this.swinging = held.useTime;
      world.setTile(tx, ty, held.placeTile);
      game.audio?.play('place', { volume: 0.6 });
      if (held.consume) held.consume();
      return;
    }
    if (held.placeWall != null) {
      if (world.wallAt(tx, ty) !== 0) return;
      // wall anchoring: adjacent wall or block
      if (!this.hasWallAnchor(tx, ty)) return;
      this.swingTimer = held.useTime;
      world.setWall(tx, ty, held.placeWall);
      game.audio?.play('place', { volume: 0.6 });
      if (held.consume) held.consume();
      return;
    }

    // ---- tools -----------------------------------------------------------------
    if (held.type !== 'pickaxe' && held.type !== 'axe' && held.type !== 'hammer') return;
    if (id === T.air) {
      // hammer removes player-placed walls (100 HP, power ×1.5, half useTime)
      if (held.type === 'hammer' && world.wallAt(tx, ty) !== 0) {
        const wallInfo = WALLS[world.wallAt(tx, ty)];
        if (wallInfo.natural) return;               // natural walls are permanent
        this.swingTimer = Math.floor(held.useTime / 2);
        this.swinging = held.useTime;
        const packed = -(ty * world.w + tx) - 1;    // negative-space key for walls
        if (this.miningTile !== packed) { this.miningTile = packed; this.miningDamage = 0; }
        this.miningDamage += Math.floor((held.hammerPower ?? 0) * 1.5);
        if (this.miningDamage >= 100) {
          this.miningTile = -1; this.miningDamage = 0;
          world.setWall(tx, ty, 0);
          for (const fn of this.onDig) fn(tx, ty, wallInfo, { wall: true });
        }
      }
      return;
    }

    const info = TILES[id];
    // tool-class gating
    if (info.axe ? held.type !== 'axe' : info.hammer ? held.type !== 'hammer' : held.type !== 'pickaxe') return;

    this.swingTimer = held.useTime;
    this.swinging = held.useTime;

    // damage per swing (research 03): pick = floor(power × mult), axe = floor(power% × 24)
    let dmg = 0;
    if (info.axe) dmg = Math.floor((held.axePower ?? 0) / 100 * 24);
    else if ((held.pickPower ?? 0) >= (info.pick ?? 0)) dmg = Math.floor((held.pickPower ?? 0) * info.mult);
    if (dmg <= 0) return;

    const packed = ty * world.w + tx;
    if (this.miningTile !== packed) { this.miningTile = packed; this.miningDamage = 0; }
    this.miningDamage += dmg;
    if (this.miningDamage >= 100) {
      this.miningDamage = 0;
      if (info.grassTo) {
        // stripping the grass coat costs one full cycle; block underneath starts fresh
        world.setTile(tx, ty, T[info.grassTo]);
      } else {
        this.miningTile = -1;
        this.digTile(tx, ty, info);
      }
    }
  }

  overlapsBox(bx, by, bw, bh) {
    return this.px < bx + bw && this.px + this.w > bx && this.py < by + bh && this.py + this.h > by;
  }

  // block anchoring (research 03 §5): cardinal adjacent block/platform OR background wall
  canPlaceAt(tx, ty, placeId) {
    const world = this.world;
    if (world.wallAt(tx, ty) !== 0) return true;
    const sides = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (const [dx, dy] of sides) {
      const n = world.tileAt(tx + dx, ty + dy);
      if (n !== T.air && (TILES[n].solid || TILES[n].platform)) return true;
    }
    return false;
  }

  hasWallAnchor(tx, ty) {
    const world = this.world;
    const sides = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    for (const [dx, dy] of sides) {
      if (world.wallAt(tx + dx, ty + dy) !== 0) return true;
      const n = world.tileAt(tx + dx, ty + dy);
      if (n !== T.air && TILES[n].solid) return true;
    }
    return false;
  }

  digTile(tx, ty, info) {
    const world = this.world;
    // chests must be emptied before they break (Terraria rule)
    if (info.name === 'chest') {
      if (world.chests && !world.chests.isEmpty(tx, ty)) return;
      world.chests?.remove(tx, ty);
      world.setTile(tx, ty, T.air);
      for (const fn of this.onDig) fn(tx, ty, { ...info, drops: 'chest' }, null);
      return;
    }
    // trees fall as a unit: chop trunk → collect trunk column + leaves
    if (info.name === 'treeTrunk') {
      let top = ty;
      while (world.tileAt(tx, top - 1) === T.treeTrunk) top--;
      let count = 0;
      for (let y = ty; y >= top; y--) { world.setTile(tx, y, T.air); count++; }
      // clear leaf crown around the top
      for (let ly = -3; ly <= 1; ly++) for (let lx = -3; lx <= 3; lx++) {
        if (world.tileAt(tx + lx, top + ly) === T.treeLeaves) world.setTile(tx + lx, top + ly, T.air);
      }
      for (const fn of this.onDig) fn(tx, ty, info, { wood: count * 2 });
      return;
    }
    world.setTile(tx, ty, T.air);
    for (const fn of this.onDig) fn(tx, ty, info, null);
  }

  // render interpolated position (px, top-left)
  renderPos(alpha) {
    return [this.ppx + (this.px - this.ppx) * alpha, this.ppy + (this.py - this.ppy) * alpha];
  }
}
