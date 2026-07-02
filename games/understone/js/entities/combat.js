// Combat glue: melee swings, bow firing, enemy contact damage, deaths → drops,
// floating damage numbers, blood moon event.
// Damage taken by player: floor(atk±15% − defense/2), min 1 (research 05 §2).

import { TILE } from '../config.js';
import { mouse } from '../core/input.js';
import { isDay, segFrac } from '../render/background.js';

export class Combat {
  constructor(game) {
    this.game = game;
    this.texts = [];              // floating damage numbers
    this.swingHit = new Set();    // enemies hit by the current swing
    this.lastSwingId = 0;
    this.lastNightCheck = -1;
    game.floatText = (x, y, txt, color) => this.texts.push({ x, y, txt: String(txt), color, life: 45, vy: -1.2 });
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
        for (const hb of e.hitboxes()) {
          if (box.x < hb.x + hb.w && box.x + box.w > hb.x && box.y < hb.y + hb.h && box.y + box.h > hb.y) {
            const crit = Math.random() < 0.04;
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
        const ext = Math.sin(prog * Math.PI) * 78;          // ~5 tiles out and back
        const tipX = p.x + s.dirX * ext, tipY = p.y + s.dirY * ext;
        s.tipX = tipX; s.tipY = tipY; s.ext = ext;
        for (const e of g.enemies) {
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
            p.hurt(dmg, hb.x + hb.w / 2);
            g.floatText(p.x, p.py - 10, dmg, '#e86d6d');
            break;
          }
        }
      }
      // death
      if (e.hp <= 0) {
        g.enemies.splice(i, 1);
        if (e.hp === -1) continue;        // silent despawn (EoC at dawn)
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
          g.announce?.(`${def.name} has been defeated!`);
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
