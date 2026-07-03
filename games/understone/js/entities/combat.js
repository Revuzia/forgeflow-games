// Combat glue: melee swings, bow firing, enemy contact damage, deaths → drops,
// floating damage numbers, blood moon event.
// Damage taken by player: floor(atk±15% − defense/2), min 1 (research 05 §2).

import { TILE } from '../config.js';
import { mouse } from '../core/input.js';
import { isDay, segFrac } from '../render/background.js';
import { moveEntity } from './physics.js';

// true if a solid tile sits on the segment a→b (so a melee strike can't reach through a wall).
// One-tile grace at each end so hits that graze a wall corner still land.
function wallBetween(world, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const dist = Math.hypot(dx, dy);
  const steps = Math.ceil(dist / 6);
  if (steps <= 2) return false;
  for (let i = 1; i < steps; i++) {
    const x = ax + dx * (i / steps), y = ay + dy * (i / steps);
    if (world.isSolid(Math.floor(x / TILE), Math.floor(y / TILE))) return true;
  }
  return false;
}

export class Combat {
  constructor(game) {
    this.game = game;
    this.texts = [];              // floating damage numbers
    this.swingHit = new Set();    // enemies hit by the current swing
    this.lastSwingId = 0;
    this.lastNightCheck = -1;
    game.floatText = (x, y, txt, color) => this.texts.push({ x, y, txt: String(txt), color, life: 45, vy: -1.2 });
  }

  // ---- explosives: fused, bouncing, terrain-destroying (Terraria bombs) ------------
  throwBomb(x, y, vx, vy, held) {
    this.bombs = this.bombs ?? [];
    this.bombs.push({ x: x - 5, y: y - 5, w: 10, h: 10, vx, vy, fuse: held.fuse ?? 180, dmg: held.damage ?? 60, blastTiles: held.blastTiles ?? 4, dynamite: held.name === 'Dynamite' });
  }

  tickBombs(g) {
    if (!this.bombs?.length) return;
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.fuse--;
      b.vy = Math.min(b.vy + 0.3, 9);
      b.vx *= 0.995;
      const preVx = b.vx, preVy = b.vy;
      moveEntity(g.world, b, {});
      if (b.vx === 0 && Math.abs(preVx) > 0.5) b.vx = -preVx * 0.4;   // bounce
      if (b.vy === 0 && Math.abs(preVy) > 1) b.vy = -preVy * 0.45;
      // fuse sparks
      if (b.fuse % 4 === 0) g.fx?.sparks(b.x + 5, b.y - 2, '#ffd75a', 1);
      if (b.fuse <= 0) {
        this.bombs.splice(i, 1);
        this.explode(g, b.x + 5, b.y + 5, b.blastTiles, b.dmg);
      }
    }
  }

  explode(g, x, y, blastTiles, dmg) {
    const w = g.world;
    const ctx2 = Math.floor(x / 16), cty = Math.floor(y / 16);
    const r = blastTiles;
    const loot = new Map();
    for (let ty = cty - r; ty <= cty + r; ty++) {
      for (let tx = ctx2 - r; tx <= ctx2 + r; tx++) {
        if (!w.inBounds(tx, ty)) continue;
        if ((tx - ctx2) ** 2 + (ty - cty) ** 2 > r * r) continue;
        const id = w.tileAt(tx, ty);
        if (id === 0) continue;
        const info = g.TILES[id];
        if ((info.pick ?? 0) >= 65 || info.name === 'chest' || info.name === 'demonAltar') continue; // blast-proof
        w.setTile(tx, ty, 0);
        if (info.drops && g.ITEMS[info.drops]) loot.set(info.drops, (loot.get(info.drops) ?? 0) + 1);
      }
    }
    // drop the rubble as consolidated stacks
    for (const [itemId, n] of loot) g.drops.spawn(itemId, n, x, y);
    // damage entities by proximity
    const blastPx = r * 16;
    for (const e of g.enemies) {
      const d = Math.hypot(e.cx - x, e.cy - y);
      if (d < blastPx + 20) {
        e._tick = g.tick;
        const dealt = e.strike(dmg * (1 - d / (blastPx + 40)), 8, x, `boom${g.tick}`, false, 'fire');
        if (typeof dealt === 'number' && dealt > 0) g.floatText(e.cx, e.y - 8, dealt, '#ffb45a');
      }
    }
    const p = g.player;
    const pd = Math.hypot(p.x - x, p.y - y);
    if (pd < blastPx + 10 && !p.dead) {
      p.hurt(Math.max(10, Math.round(dmg * 0.6 * (1 - pd / (blastPx + 30)))), x);
    }
    // spectacle
    for (let k = 0; k < 20; k++) g.fx?.fire(x + (Math.random() - 0.5) * blastPx, y + (Math.random() - 0.5) * blastPx, 1, 20);
    for (let k = 0; k < 8; k++) g.fx?.smoke(x + (Math.random() - 0.5) * blastPx, y + (Math.random() - 0.5) * blastPx);
    g.fx?.sparks(x, y, '#ffd75a', 12);
    g.fx?.hitStop(4);
    g.fx?.addTrauma(0.55);
    g.audio?.play('boom', { volume: 1 });
  }

  drawBombs(ctx, camera, alpha) {
    if (!this.bombs?.length) return;
    const [ox, oy] = camera.frameOrigin(alpha);
    const z = camera.zoom;
    for (const b of this.bombs) {
      ctx.fillStyle = b.dynamite ? '#c03a3a' : '#3a3a44';
      if (b.dynamite) ctx.fillRect((b.x - ox) * z, (b.y - oy) * z, 6 * z, 12 * z);
      else { ctx.beginPath(); ctx.arc((b.x + 5 - ox) * z, (b.y + 5 - oy) * z, 5 * z, 0, Math.PI * 2); ctx.fill(); }
      // fuse
      ctx.strokeStyle = '#c8a05a';
      ctx.lineWidth = z;
      ctx.beginPath();
      ctx.moveTo((b.x + 5 - ox) * z, (b.y - 2 - oy) * z);
      ctx.lineTo((b.x + 7 - ox) * z, (b.y - 5 - oy) * z);
      ctx.stroke();
    }
  }

  // chain lightning (research 10 §2e): nearest-enemy jumps, 30% falloff, 6-tile range
  chainLightning(g, from, baseDmg) {
    const hit = new Set([from.id]);
    let cur = from, dmg = baseDmg;
    for (let jump = 0; jump < 3; jump++) {
      let best = null, bestD = 96;
      for (const e of g.enemies) {
        if (hit.has(e.id)) continue;
        const d = Math.hypot(e.cx - cur.cx, e.cy - cur.cy);
        if (d < bestD) { best = e; bestD = d; }
      }
      if (!best) break;
      g.fx?.boltStrike(cur.cx, cur.cy, best.cx, best.cy);
      dmg = Math.max(1, Math.floor(dmg * 0.7));
      best._tick = g.tick;
      const r = best.strike(dmg, 2, cur.cx, `chain${g.tick}${jump}`, false, 'lightning');
      if (typeof r === 'number' && r > 0) g.floatText(best.cx, best.y - 8, r, '#cfd8ff');
      hit.add(best.id);
      cur = best;
    }
  }

  // shared feedback for any player→enemy strike result (melee + projectiles)
  hitFeedback(g, e, result, crit, element = null, proc = null) {
    if (result === 'dodge') {
      g.floatText(e.cx, e.y - 8, 'MISS', '#a8a8b8');
      g.audio?.play('swing', { volume: 0.25, rate: 1.4 });
      return;
    }
    if (result <= 0) return;
    const eMult = e.lastElementMult ?? 1;
    const color = crit ? '#ffd24a' : eMult > 1 ? '#8ae8a0' : eMult < 1 ? '#8a9ab8' : '#e8a86d';
    g.floatText(e.cx, e.y - 8, crit ? `${result}!` : result, color);
    g.audio?.play(e.def.ai === 'slime' ? 'slimeHit' : 'hit', { volume: 0.7 });
    g.fx?.sparks(e.cx, e.cy, element === 'fire' ? '#ff9a3c' : element === 'ice' ? '#a8e6ff'
      : element === 'lightning' ? '#cfd8ff' : element === 'shadow' ? '#b968ff' : '#ffd75a', crit ? 7 : 4);
    if (element === 'fire') e.burnTicks = Math.max(e.burnTicks ?? 0, 180);        // On Fire! 3s
    if (element === 'ice') e.chillTicks = Math.max(e.chillTicks ?? 0, 120);       // slow 2s
    if (element === 'water') g.fx?.splash(e.cx, e.y, 0, -1, 1);
    if (proc === 'chainLightning' && Math.random() < 0.3) this.chainLightning(g, e, Math.max(4, result));
    if (crit) { g.fx?.hitStop(element === 'lightning' ? 4 : 3); g.fx?.addTrauma(0.12); }
  }

  tick() {
    const g = this.game, p = g.player;
    this.tickBombs(g);

    // ---- blood moon roll at nightfall (1/9 if player > 120 max HP) --------------
    const night = !isDay(g.tick);
    const nightIndex = Math.floor(g.tick / (54000 + 32400));
    if (night && this.lastNightCheck !== nightIndex) {
      this.lastNightCheck = nightIndex;
      g.bloodMoon = p.hpMax > 120 && Math.random() < 1 / 9;
      if (g.bloodMoon) g.announce?.('The Blood Moon is rising…');
    }
    if (!night) g.bloodMoon = false;

    // ---- melee swing --------------------------------------------------------------
    const held = p.heldItem;
    if (held?.weapon === 'sword' && mouse.left && !p.dead) {
      if (p.swingTimer <= 0) {
        p.swingTimer = held.useTime;
        p.swinging = held.useTime;
        this.lastSwingId++;
        this.swingHit.clear();
        g.audio?.play('swing', { volume: 0.5 });
      }
    }
    if (held?.weapon === 'sword' && p.swinging > held.useTime * 0.3) {
      // active swing window: arc box in front + above
      const reach = 42, up = 30;
      const bx = p.facing > 0 ? p.px + p.w - 6 : p.px - reach + 6;
      const box = { x: bx, y: p.py - up + 8, w: reach, h: p.h + up - 10 };
      // elemental trail along the blade arc (research 10 recipes)
      if (held.element && g.fx) {
        const prog = 1 - p.swinging / held.useTime;               // 0→1 over the swing
        const ang = (-1.9 + prog * 2.4) * p.facing;               // overhead → forward arc
        const bxp = p.x + Math.cos(ang) * reach * 0.8 * p.facing;
        const byp = p.py + 10 + Math.sin(ang) * reach * 0.55;
        if (held.element === 'fire') g.fx.fireTrail(bxp, byp, p.facing);
        else if (held.element === 'ice' && (g.tick & 1)) g.fx.mist(bxp, byp);
        else if (held.element === 'lightning' && Math.random() < 0.4) g.fx.sparks(bxp, byp, '#cfd8ff', 1);
        else if (held.element === 'shadow') g.fx.shadowWisp(bxp, byp);
        else if (held.element === 'water' && (g.tick & 1)) g.fx.bubble(bxp, byp);
      }
      for (const e of g.enemies) {
        if (this.swingHit.has(e.id)) continue;
        if (wallBetween(g.world, p.x, p.py + p.h * 0.4, e.cx, e.cy)) continue;  // no hitting through walls
        for (const hb of e.hitboxes()) {
          if (box.x < hb.x + hb.w && box.x + box.w > hb.x && box.y < hb.y + hb.h && box.y + box.h > hb.y) {
            const crit = Math.random() < 0.04 + (held.critBonus ?? 0);
            const result = e.strike(held.damage, held.knockback ?? 4, p.x, `swing${this.lastSwingId}`, crit, held.element);
            this.hitFeedback(g, e, result, crit, held.element, held.proc);
            if (result !== 0) this.swingHit.add(e.id);
            break;
          }
        }
      }
    }

    // ---- spear: extend-and-retract thrust, hits through its arc (research 08) ----------
    if (held?.weapon === 'spear' && mouse.left && !p.dead && p.swingTimer <= 0) {
      p.swingTimer = held.useTime;
      p.swinging = held.useTime;
      const [wx, wy] = g.camera.screenToWorld(
        mouse.x * (g.canvas.width / g.canvas.clientWidth),
        mouse.y * (g.canvas.height / g.canvas.clientHeight));
      const dx = wx - p.x, dy = wy - p.y;
      const d = Math.hypot(dx, dy) || 1;
      this.spear = { dirX: dx / d, dirY: dy / d, total: held.useTime, id: ++this.lastSwingId, held };
      g.audio?.play('swing', { volume: 0.5 });
    }
    if (this.spear) {
      const s = this.spear;
      const prog = 1 - p.swinging / s.total;
      if (p.swinging <= 0) this.spear = null;
      else {
        const ext = Math.sin(prog * Math.PI) * (s.short ? 42 : 78);  // shortsword stab vs 5-tile spear
        const tipX = p.x + s.dirX * ext, tipY = p.y + s.dirY * ext;
        s.tipX = tipX; s.tipY = tipY; s.ext = ext;
        for (const e of g.enemies) {
          if (wallBetween(g.world, p.x, p.py + p.h * 0.4, e.cx, e.cy)) continue;  // no thrusting through walls
          for (const hb of e.hitboxes()) {
            if (tipX > hb.x - 6 && tipX < hb.x + hb.w + 6 && tipY > hb.y - 6 && tipY < hb.y + hb.h + 6) {
              const crit = Math.random() < 0.04;
              const r = e.strike(s.held.damage, s.held.knockback ?? 6, p.x, `spear${s.id}`, crit, s.held.element);
              this.hitFeedback(g, e, r, crit, s.held.element, s.held.proc);
              break;
            }
          }
        }
      }
    }

    // ---- flail: thrown ball on a chain, out then back, infinite pierce -------------------
    if (held?.weapon === 'flail' && mouse.left && !p.dead && !this.flail && p.swingTimer <= 0) {
      p.swingTimer = held.useTime;
      const [wx, wy] = g.camera.screenToWorld(
        mouse.x * (g.canvas.width / g.canvas.clientWidth),
        mouse.y * (g.canvas.height / g.canvas.clientHeight));
      const dx = wx - p.x, dy = wy - p.y;
      const d = Math.hypot(dx, dy) || 1;
      this.flail = { x: p.x, y: p.y, vx: (dx / d) * 9, vy: (dy / d) * 9, out: true, id: ++this.lastSwingId, held };
      g.audio?.play('swing', { volume: 0.6 });
    }
    if (this.flail) {
      const f = this.flail;
      if (f.out) {
        f.x += f.vx; f.y += f.vy;
        const tx = Math.floor(f.x / 16), ty = Math.floor(f.y / 16);
        const hitTile = g.world.isSolid(tx, ty);
        if (hitTile || Math.hypot(f.x - p.x, f.y - p.y) > 110) f.out = false;
      } else {
        const dx = p.x - f.x, dy = p.y - f.y;
        const d = Math.hypot(dx, dy) || 1;
        f.x += (dx / d) * 11; f.y += (dy / d) * 11;
        if (d < 14) this.flail = null;
      }
      if (this.flail) {
        for (const e of g.enemies) {
          for (const hb of e.hitboxes()) {
            if (f.x > hb.x - 8 && f.x < hb.x + hb.w + 8 && f.y > hb.y - 8 && f.y < hb.y + hb.h + 8) {
              const crit = Math.random() < 0.04;
              const r = e.strike(f.held.damage, f.held.knockback ?? 7, f.x, `flail${f.id}-${Math.floor(g.tick / 10)}`, crit, f.held.element);
              this.hitFeedback(g, e, r, crit, f.held.element, f.held.proc);
              break;
            }
          }
        }
        if (f.held.element === 'shadow' && (g.tick & 1)) g.fx?.shadowWisp(f.x, f.y);
      }
    }

    // ---- magic weapons: mana-gated bolts (gem staves, Vilethorn, Water Bolt…) -----------
    if (held?.weapon === 'magic' && mouse.left && !p.dead && p.swingTimer <= 0) {
      if (p.mana < (held.mana ?? 5)) {
        if (g.tick % 30 === 0) g.floatText(p.x, p.py - 12, 'no mana', '#6a8ac8');
      } else {
        p.mana -= held.mana ?? 5;
        p.manaRegenDelay = 45;                       // casting pauses regen
        p.swingTimer = held.useTime;
        p.swinging = held.useTime;
        const [wx, wy] = g.camera.screenToWorld(
          mouse.x * (g.canvas.width / g.canvas.clientWidth),
          mouse.y * (g.canvas.height / g.canvas.clientHeight));
        if (held.bolt === 'thorn') {
          // Vilethorn: through-wall thorn spike along the aim line
          const dx = wx - p.x, dy = wy - p.y;
          const d = Math.hypot(dx, dy) || 1;
          this.thorn = { dirX: dx / d, dirY: dy / d, total: held.useTime, id: ++this.lastSwingId, held };
        } else {
          g.projectiles.spawnMagic(held, p.x, p.py + 10, wx, wy);
        }
        g.audio?.play('swing', { volume: 0.4, rate: 1.3 });
      }
    }
    if (this.thorn) {
      const th = this.thorn;
      const prog = 1 - p.swinging / th.total;
      if (p.swinging <= 0) this.thorn = null;
      else {
        const ext = Math.sin(prog * Math.PI) * 150;   // ~9 tiles, pierces terrain
        th.ext = ext;
        for (let seg = 0.3; seg <= 1; seg += 0.35) {
          const tx2 = p.x + th.dirX * ext * seg, ty2 = p.y + th.dirY * ext * seg;
          for (const e of g.enemies) {
            for (const hb of e.hitboxes()) {
              if (tx2 > hb.x - 6 && tx2 < hb.x + hb.w + 6 && ty2 > hb.y - 6 && ty2 < hb.y + hb.h + 6) {
                const crit = Math.random() < 0.04;
                const r = e.strike(th.held.damage, 2, p.x, `thorn${th.id}`, crit, th.held.element);
                this.hitFeedback(g, e, r, crit, th.held.element);
                break;
              }
            }
          }
          if ((g.tick & 1)) g.fx?.shadowWisp(tx2, ty2);
        }
      }
    }

    // ---- boomerang: out, spin, return, catch ---------------------------------------------
    if (held?.weapon === 'boomerang' && mouse.left && !p.dead && !this.boomerang && p.swingTimer <= 0) {
      p.swingTimer = held.useTime;
      const [wx, wy] = g.camera.screenToWorld(
        mouse.x * (g.canvas.width / g.canvas.clientWidth),
        mouse.y * (g.canvas.height / g.canvas.clientHeight));
      const dx = wx - p.x, dy = wy - p.y;
      const d = Math.hypot(dx, dy) || 1;
      this.boomerang = { x: p.x, y: p.py + 10, vx: (dx / d) * 10, vy: (dy / d) * 10, out: true, id: ++this.lastSwingId, held, spin: 0 };
      g.audio?.play('swing', { volume: 0.6 });
    }
    if (this.boomerang) {
      const bm = this.boomerang;
      bm.spin += 0.5;
      if (bm.out) {
        bm.x += bm.vx; bm.y += bm.vy;
        bm.vx *= 0.96; bm.vy *= 0.96;
        const tx2 = Math.floor(bm.x / 16), ty2 = Math.floor(bm.y / 16);
        if (g.world.isSolid(tx2, ty2) || Math.hypot(bm.vx, bm.vy) < 3) bm.out = false;
      } else {
        const dx = p.x - bm.x, dy = p.y - bm.y;
        const d = Math.hypot(dx, dy) || 1;
        bm.x += (dx / d) * 11; bm.y += (dy / d) * 11;
        if (d < 16) this.boomerang = null;    // caught
      }
      if (this.boomerang) {
        for (const e of g.enemies) {
          for (const hb of e.hitboxes()) {
            if (bm.x > hb.x - 8 && bm.x < hb.x + hb.w + 8 && bm.y > hb.y - 8 && bm.y < hb.y + hb.h + 8) {
              const crit = Math.random() < 0.04;
              const r = e.strike(bm.held.damage, bm.held.knockback ?? 8, bm.x, `bmr${bm.id}-${Math.floor(g.tick / 10)}`, crit, bm.held.element);
              this.hitFeedback(g, e, r, crit, bm.held.element);
              if (bm.out) bm.out = false;      // bounce back on hit
              break;
            }
          }
        }
      }
    }

    // ---- shortsword: quick stab (short spear mechanic, research 08 useStyle 13) -----------
    if (held?.weapon === 'shortsword' && mouse.left && !p.dead && p.swingTimer <= 0) {
      p.swingTimer = held.useTime;
      p.swinging = held.useTime;
      const [wx, wy] = g.camera.screenToWorld(
        mouse.x * (g.canvas.width / g.canvas.clientWidth),
        mouse.y * (g.canvas.height / g.canvas.clientHeight));
      const dx = wx - p.x, dy = wy - p.y;
      const d = Math.hypot(dx, dy) || 1;
      this.spear = { dirX: dx / d, dirY: dy / d, total: held.useTime, id: ++this.lastSwingId, held, short: true };
      g.audio?.play('swing', { volume: 0.45, rate: 1.3 });
    }

    // ---- bow firing ------------------------------------------------------------------
    if (held?.weapon === 'bow' && mouse.left && !p.dead && p.swingTimer <= 0) {
      const ammo = g.inventory.firstAmmo('arrow');
      if (ammo) {
        p.swingTimer = held.useTime;
        p.swinging = held.useTime;
        const [wx, wy] = g.camera.screenToWorld(
          mouse.x * (g.canvas.width / g.canvas.clientWidth),
          mouse.y * (g.canvas.height / g.canvas.clientHeight));
        const ammoDef = g.ITEMS[ammo.id];
        g.projectiles.spawnArrow(p.x, p.py + 12, wx, wy, 9,
          held.damage + (ammoDef.damage ?? 0), held.knockback ?? 2,
          held.element ?? (ammoDef.fire ? 'fire' : null), held.proc);
        g.inventory.consumeAmmo(ammo);
      }
    }

    // ---- enemy ticks, contact damage, deaths --------------------------------------------
    const defStat = p.getDefense ? p.getDefense() : 0;
    for (let i = g.enemies.length - 1; i >= 0; i--) {
      const e = g.enemies[i];
      // elemental debuffs
      if (e.burnTicks > 0) {
        e.burnTicks--;
        if (e.burnTicks % 30 === 0) { e.hp -= 2; g.floatText(e.cx, e.y - 8, 2, '#ff9a3c'); } // ~4 dps
        g.fx?.burning(e);
      }
      if (e.chillTicks > 0) {
        e.chillTicks--;
        e.vx *= 0.6;
        if (g.tick % 4 === 0) g.fx?.mist(e.x + Math.random() * e.w, e.y + Math.random() * e.h);
      }
      e.tick(g);
      // contact damage
      if (!p.dead && p.iFrames <= 0) {
        for (const hb of e.hitboxes()) {
          if (p.px < hb.x + hb.w && p.px + p.w > hb.x && p.py < hb.y + hb.h && p.py + p.h > hb.y) {
            const raw = e.contactDamage ? e.contactDamage() : e.def.dmg;
            const variance = 0.85 + Math.random() * 0.3;
            const dmg = Math.max(1, Math.floor(raw * variance - Math.ceil(defStat / 2)));
            if (p.hurt(dmg, hb.x + hb.w / 2)) {
              g.floatText(p.x, p.py - 10, dmg, '#e86d6d');
              if (e.def.poison) p.poisonTicks = Math.max(p.poisonTicks ?? 0, 480);
            }
            break;
          }
        }
      }
      // death
      if (e.hp <= 0) {
        g.enemies.splice(i, 1);
        if (e.hp === -1) continue;        // silent despawn (EoC at dawn)
        // mother slime splits into babies
        if (e.def.splitsInto) {
          const EnemyC = e.constructor;
          for (let k = 0; k < 2 + (Math.random() < 0.5 ? 1 : 0); k++) {
            const b = new EnemyC(e.def.splitsInto, e.cx + (Math.random() - 0.5) * 20, e.y + e.h);
            b.vy = -4; b.vx = (Math.random() - 0.5) * 3;
            g.enemies.push(b);
          }
        }
        const def = e.def;
        g.inventory.money += def.coins;
        if (def.coins > 0) g.audio?.play('coins', { volume: 0.5 });
        for (const [itemId, lo, hi, chance] of def.drops ?? []) {
          if (Math.random() < chance) {
            const n = lo + Math.floor(Math.random() * (hi - lo + 1));
            g.drops.spawn(itemId, n, e.cx, e.cy);
          }
        }
        if (e.boss) {
          g.progress = g.progress ?? {};
          g.progress.bossKills = (g.progress.bossKills ?? 0) + 1;
          g.announce?.(`${def.name} has been defeated!`);
          if (def.name === 'Wall of Flesh' && !g.progress.hardmode) {
            g.progress.hardmode = true;
            setTimeout(() => g.announce?.('⚔ The ancient spirits of light and dark have been released. You have conquered the underworld! ⚔'), 4000);
            g.audio?.music('victory');
            g.fx?.addTrauma(0.6);
          }
          if (def.name === 'Eater of Worlds' && e.segs) {
            // every segment drops materials (research 05: 2-5 demonite + 1-2 scales @50% each)
            for (const s of e.segs) {
              if (Math.random() < 0.5) g.drops.spawn('demonite', 2 + (Math.random() * 4 | 0), s.x + e.w / 2, s.y + e.h / 2);
              if (Math.random() < 0.5) g.drops.spawn('shadowScale', 1 + (Math.random() * 2 | 0), s.x + e.w / 2, s.y + e.h / 2);
            }
          }
        }
      }
    }

    // ---- floating texts ---------------------------------------------------------------------
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.y += t.vy; t.life--;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
  }

  draw(ctx, camera, alpha) {
    const [ox, oy] = camera.frameOrigin(alpha);
    const z = camera.zoom;
    const p = this.game.player;
    this.drawBombs(ctx, camera, alpha);
    // spear shaft
    if (this.spear?.ext > 2) {
      const s = this.spear;
      ctx.strokeStyle = '#8a6238';
      ctx.lineWidth = 3 * z;
      ctx.beginPath();
      ctx.moveTo((p.x - ox) * z, (p.y - oy) * z);
      ctx.lineTo((s.tipX - ox) * z, (s.tipY - oy) * z);
      ctx.stroke();
      ctx.fillStyle = s.held.element === 'water' ? '#7db7e8' : '#c9ccd8';
      ctx.beginPath();
      ctx.arc((s.tipX - ox) * z, (s.tipY - oy) * z, 3.5 * z, 0, Math.PI * 2);
      ctx.fill();
    }
    // vilethorn spike
    if (this.thorn?.ext > 4) {
      const th = this.thorn;
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = '#7a2bd9';
      ctx.lineWidth = 3 * z;
      ctx.beginPath();
      ctx.moveTo((p.x - ox) * z, (p.y - oy) * z);
      ctx.lineTo((p.x + th.dirX * th.ext - ox) * z, (p.y + th.dirY * th.ext - oy) * z);
      ctx.stroke();
      ctx.strokeStyle = '#efe0ff';
      ctx.lineWidth = 1 * z;
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    // boomerang
    if (this.boomerang) {
      const bm = this.boomerang;
      ctx.save();
      ctx.translate((bm.x - ox) * z, (bm.y - oy) * z);
      ctx.rotate(bm.spin);
      ctx.fillStyle = '#8ab4e8';
      ctx.fillRect(-6 * z, -1.5 * z, 12 * z, 3 * z);
      ctx.fillRect(-1.5 * z, -6 * z, 3 * z, 12 * z);
      ctx.restore();
    }
    // flail chain + ball
    if (this.flail) {
      const f = this.flail;
      ctx.strokeStyle = '#9a9aa8';
      ctx.lineWidth = 1.5 * z;
      ctx.setLineDash([3 * z, 2 * z]);
      ctx.beginPath();
      ctx.moveTo((p.x - ox) * z, (p.y - oy) * z);
      ctx.lineTo((f.x - ox) * z, (f.y - oy) * z);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = f.held.element === 'shadow' ? '#5a3a7a' : '#6a6a74';
      ctx.beginPath();
      ctx.arc((f.x - ox) * z, (f.y - oy) * z, 6 * z, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#b968ff';
      for (let a = 0; a < 6; a++) {
        const ang = a * Math.PI / 3 + this.game.tick * 0.2;
        ctx.fillRect((f.x - ox) * z + Math.cos(ang) * 7 * z - z, (f.y - oy) * z + Math.sin(ang) * 7 * z - z, 2 * z, 2 * z);
      }
    }
    ctx.font = `bold ${11 * z}px 'Segoe UI', sans-serif`;
    for (const t of this.texts) {
      ctx.globalAlpha = Math.min(1, t.life / 20);
      ctx.fillStyle = '#000';
      ctx.fillText(t.txt, (t.x - ox) * z + 1, (t.y - oy) * z + 1);
      ctx.fillStyle = t.color;
      ctx.fillText(t.txt, (t.x - ox) * z, (t.y - oy) * z);
    }
    ctx.globalAlpha = 1;
  }
}
