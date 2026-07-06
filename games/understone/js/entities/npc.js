// Town NPCs — Guide + Merchant. Housing rules per research/terraria/05 §6 (simplified):
// enclosed room 30-750 tiles, ≥40% backing walls, light source, comfort item (chair),
// flat-surface item (workbench), and a door. Merchant arrives at ≥50 silver + valid house.

import { TILE, PHYS } from '../config.js';
import { T, TILES, WALLS } from '../world/world.js';
import { moveEntity } from './physics.js';
import { character } from '../core/assets.js';

const GUIDE_TIPS = [
  'Chop trees for wood, then craft a Work Bench — it unlocks most early recipes.',
  'Torches need wood and gel. Slimes are full of gel. Coincidence?',
  'Build a Furnace from stone, then smelt ore into bars at it.',
  'An Anvil made of iron bars unlocks metal tools and weapons.',
  'Life Crystals hide underground. Use them — bosses respect a full health bar.',
  'The corruption is purple, hungry, and full of treasure. Bring a strong pickaxe.',
  'Hold Space while jumping to jump higher. Hold S on a platform to drop through.',
  'A Bedroll lets you set your spawn point. Sleep tight.',
  'Demon Altars in the caverns craft boss summons. Six lenses make a wicked eye…',
  'Water beats fire, fire beats ice, lightning beats water. Choose your blade wisely.',
];

export const SHOPS = {
  merchant: [['torch', 50], ['woodenArrow', 5], ['lesserHealingPotion', 300], ['lesserManaPotion', 100], ['bottle', 20], ['fishingRod', 500], ['bedroll', 800]],
  demolitionist: [['bomb', 750], ['dynamite', 2500], ['torch', 50]],
  armsDealer: [['woodenArrow', 5], ['flamingArrow', 15], ['woodenBow', 200], ['silverBow', 4800], ['rangerHood', 12000], ['rangerJerkin', 20000], ['rangerLeggings', 16000]],
  wizard: [['lesserManaPotion', 100], ['manaCrystal', 5000], ['vilethorn', 18000], ['jungleHat', 12000], ['jungleShirt', 20000], ['junglePants', 16000]],
  dryad: [['acorn', 100], ['vine', 800], ['stinger', 400], ['grass_placeholder', 0]].filter(([id]) => id !== 'grass_placeholder'),
  oldMiner: [['torch', 40], ['bomb', 600], ['lanternItemPlaceholder', 0]].filter(([id]) => id !== 'lanternItemPlaceholder').concat([['lantern', 250]]),
  deepTrader: [['demonite', 1600], ['diamond', 8000], ['ruby', 6000], ['silk', 400], ['obsidian', 40], ['hellstoneBarPlaceholder', 0]].filter(([id]) => id !== 'hellstoneBarPlaceholder'),
};
export const SHOP = SHOPS.merchant; // legacy alias

// weapon reforge modifiers (Blacksmith service, Terraria's Goblin Tinkerer analogue)
export const MODIFIERS = [
  { name: 'Sharp', dmg: 1.10, weight: 3 },
  { name: 'Swift', speed: 0.88, weight: 3 },
  { name: 'Deadly', dmg: 1.08, crit: 0.04, weight: 2 },
  { name: 'Heavy', dmg: 1.12, kb: 1.3, speed: 1.1, weight: 2 },
  { name: 'Keen', crit: 0.08, weight: 2 },
  { name: 'Bulky', dmg: 1.05, weight: 3 },
  { name: 'Dull', dmg: 0.92, weight: 1 },              // reforging gambles!
  { name: 'Legendary', dmg: 1.15, speed: 0.9, crit: 0.05, weight: 1 },
];
export function rollModifier() {
  const total = MODIFIERS.reduce((a, m) => a + m.weight, 0);
  let r = Math.random() * total;
  for (const m of MODIFIERS) { r -= m.weight; if (r <= 0) return m; }
  return MODIFIERS[0];
}

const NPC_NAMES = {
  guide: 'Rowan the Guide', merchant: 'Sela the Merchant',
  nurse: 'Mira the Nurse', demolitionist: 'Boris the Demolitionist',
  blacksmith: 'Hilda the Blacksmith', armsDealer: 'Dex the Arms Dealer',
  wizard: 'Alaric the Wizard', dryad: 'Fenna the Dryad',
  oldMiner: 'Grim the Old Miner', deepTrader: 'Vex the Deep Trader',
  angler: 'Finn the Angler',
};
const NPC_TINTS = {
  guide: 'rgba(90,180,90,0.35)', merchant: 'rgba(220,180,60,0.35)',
  nurse: 'rgba(230,90,120,0.35)', demolitionist: 'rgba(200,90,40,0.4)',
  blacksmith: 'rgba(90,90,110,0.45)', armsDealer: 'rgba(150,110,60,0.4)',
  wizard: 'rgba(110,90,220,0.4)', dryad: 'rgba(60,160,80,0.45)',
  oldMiner: 'rgba(200,160,70,0.45)', deepTrader: 'rgba(60,160,160,0.45)',
  angler: 'rgba(70,140,200,0.45)',
};

export class NPC {
  constructor(type, x, y) {
    this.type = type;                       // guide | merchant | nurse | demolitionist
    this.name = NPC_NAMES[type] ?? type;
    this.w = 18; this.h = 40;
    this.x = x - 9; this.y = y - 40;
    this.px = this.x; this.py = this.y;
    this.vx = 0; this.vy = 0;
    this.facing = 1;
    this.wanderTimer = 0;
    this.homeX = x;
    this.tipIndex = 0;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  tick(game) {
    this.px = this.x; this.py = this.y;
    // gentle wander around home
    if (--this.wanderTimer <= 0) {
      this.wanderTimer = 120 + Math.random() * 240;
      const drift = this.cx - this.homeX;
      this.dir = Math.abs(drift) > 90 ? -Math.sign(drift) : (Math.random() < 0.4 ? 0 : Math.random() < 0.5 ? -1 : 1);
    }
    if (this.dir) {
      this.vx += this.dir * 0.05;
      if (Math.abs(this.vx) > 0.7) this.vx = this.dir * 0.7;
      this.facing = this.dir;
      // hop 1-tile ledges
      const aheadX = this.dir > 0 ? this.x + this.w + 2 : this.x - 2;
      const ftx = Math.floor(aheadX / TILE), fty = Math.floor((this.y + this.h - 1) / TILE);
      if (this.vy === 0 && game.world.isSolid(ftx, fty) && !game.world.isSolid(ftx, fty - 1)) this.vy = -5;
    } else {
      this.vx *= 0.8;
    }
    this.vy = Math.min(this.vy + PHYS.gravity, PHYS.maxFall);
    const e = { x: this.x, y: this.y, vx: this.vx, vy: this.vy, w: this.w, h: this.h };
    moveEntity(game.world, e, {});
    this.x = e.x; this.y = e.y; this.vx = e.vx; this.vy = e.vy;
  }

  interact(game) {
    if (this.type === 'guide') {
      game.announce?.(`${this.name}: “${GUIDE_TIPS[this.tipIndex++ % GUIDE_TIPS.length]}”`);
      game.audio?.play('uiClick', { volume: 0.5 });
      return true;
    }
    if (this.type === 'blacksmith') {
      // reforge the held weapon: pay value/3, reroll its modifier
      const inv = game.inventory;
      const slot = inv.held();
      const def = slot ? game.ITEMS[slot.id] : null;
      if (!def || !def.weapon) {
        game.announce?.(`${this.name}: “Hold the weapon you want reforged, then talk to me.”`);
        return true;
      }
      const cost = Math.max(100, Math.floor((def.value ?? 500) / 3));
      if (inv.money < cost) {
        game.announce?.(`${this.name}: “Reforging that costs ${Math.floor(cost / 100)}s ${cost % 100}c.”`);
        return true;
      }
      inv.money -= cost;
      slot.mod = rollModifier();
      inv.changed();
      game.announce?.(`${this.name}: “Behold — the ${slot.mod.name} ${def.name}!”`);
      game.audio?.play('craft');
      game.fx?.sparks(this.cx, this.y + 10, '#ffd75a', 8);
      return true;
    }
    if (this.type === 'dryad') {
      const evil = (game.world.corruption ?? []).length;
      game.announce?.(`${this.name}: “The world bears ${evil} corruption scar${evil === 1 ? '' : 's'}. Tend the grass, plant acorns, and it will heal.”`);
      game.hud?.openShop(this);
      return true;
    }
    if (this.type === 'oldMiner') {
      // ore tip: direction of the nearest gold/demonite from the player
      const w = game.world, p = game.player;
      const ptx = Math.floor(p.x / 16), pty = Math.floor(p.y / 16);
      let best = null, bestD = Infinity;
      for (let r = 4; r < 120 && !best; r += 8) {
        for (let ty = Math.max(1, pty - r); ty < Math.min(w.h, pty + r); ty += 2) {
          for (let tx = Math.max(1, ptx - r); tx < Math.min(w.w, ptx + r); tx += 2) {
            const id = w.tileAt(tx, ty);
            if (id === game.T.goldOre || id === game.T.demonite || id === game.T.diamondOre) {
              const d = Math.hypot(tx - ptx, ty - pty);
              if (d < bestD) { bestD = d; best = [tx, ty, id]; }
            }
          }
        }
      }
      if (best) {
        const dir = `${best[1] > pty ? 'below' : 'above'} you, to the ${best[0] > ptx ? 'east' : 'west'}`;
        const what = best[2] === game.T.goldOre ? 'gold' : best[2] === game.T.demonite ? 'demonite' : 'gems';
        game.announce?.(`${this.name}: “These old bones smell ${what} about ${Math.round(bestD)} tiles ${dir}.”`);
      } else {
        game.announce?.(`${this.name}: “Picked this stretch clean already, have ye?”`);
      }
      game.hud?.openShop(this);
      return true;
    }
    if (this.type === 'angler') {
      // repeatable fishing quest: 3 Bass per in-game day (Terraria's Angler, simplified)
      const g2 = game;
      g2.progress = g2.progress ?? {};
      const day = Math.floor(g2.tick / 86400);
      if (g2.progress.anglerDay === day) {
        game.announce?.(`${this.name}: “Come back tomorrow — the fish need time to forget my tricks.”`);
        return true;
      }
      const have = g2.inventory.count('fish');
      if (have >= 3) {
        g2.inventory.remove('fish', 3);
        g2.inventory.money += 5000;
        g2.inventory.add('bomb', 2);
        g2.progress.anglerDay = day;
        g2.inventory.changed();
        game.announce?.(`${this.name}: “Three bass! Here's 50 silver and a little something that goes boom.”`);
        game.audio?.play('coins');
      } else {
        game.announce?.(`${this.name}: “Bring me 3 Bass and I'll make it worth your while. (${have}/3 — craft a Fishing Rod: 8 wood)”`);
      }
      return true;
    }
    if (this.type === 'nurse') {
      const p = game.player;
      const missing = p.hpMax - p.hp;
      if (missing <= 0 && p.poisonTicks <= 0) {
        game.announce?.(`${this.name}: “You look perfectly healthy to me.”`);
        return true;
      }
      const cost = missing * 2 + (p.poisonTicks > 0 ? 100 : 0);
      if (game.inventory.money < cost) {
        game.announce?.(`${this.name}: “Healing costs ${Math.floor(cost / 100)}s ${cost % 100}c. Come back with coin.”`);
        return true;
      }
      game.inventory.money -= cost;
      p.hp = p.hpMax;
      p.poisonTicks = 0;
      game.inventory.changed();
      game.floatText?.(p.x, p.py - 12, `+${missing}`, '#6de86d');
      game.announce?.(`${this.name}: “Good as new!”`);
      game.audio?.play('powerup');
      return true;
    }
    game.hud?.openShop(this);
    return true;
  }

  draw(ctx, camera, alpha, assets) {
    const [ox, oy] = camera.frameOrigin(alpha);
    const z = camera.zoom;
    const ix = this.px + (this.x - this.px) * alpha, iy = this.py + (this.y - this.py) * alpha;
    // Prefer a distinct PixelLab NPC character; fall back to a properly RECOLORED hero
    // (offscreen tint so ONLY the character is colored — never a box over the terrain).
    const rec = character(NPC_CHAR[this.type]) ?? character('hero');
    const usingOwnSprite = !!character(NPC_CHAR[this.type]);
    if (rec?.base) {
      const frames = Math.abs(this.vx) > 0.1 ? (rec.anims.walk ?? rec.anims['fast-walk']) : (rec.anims['breathing-idle'] ?? rec.anims.idle);
      const img = frames?.length ? frames[Math.floor((this._t = (this._t ?? 0) + 1) * 0.15) % frames.length] : rec.base;
      const src = usingOwnSprite ? img : tintedFrame(img, this.type);   // recolor only for shared hero
      const scale = rec.content ? (this.h * 1.06) / rec.content.h : this.h / img.height;
      const dh = img.height * scale * z, dw = img.width * scale * z;
      const bottomFrac = rec.content ? (rec.content.y + rec.content.h) / img.height : 1;
      const cy = (iy + this.h - oy) * z - dh * bottomFrac + dh / 2;
      ctx.save();
      ctx.translate((ix + this.w / 2 - ox) * z, cy);
      ctx.scale(this.facing < 0 ? -1 : 1, 1);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
      // distinct silhouette accessory (hat/hair) so each NPC reads differently even on the shared body
      if (!usingOwnSprite) this.drawAccessory(ctx, (ix + this.w / 2 - ox) * z, cy - dh * bottomFrac + dh * 0.06, dw, z);
    } else {
      ctx.fillStyle = NPC_BODY[this.type] ?? '#8a8a9a';
      ctx.fillRect((ix - ox) * z, (iy - oy) * z, this.w * z, this.h * z);
    }
    // name label
    ctx.font = `${9 * z}px 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(this.name, (ix + this.w / 2 - ox) * z + 1, (iy - 10 - oy) * z + 1);
    ctx.fillStyle = '#e8e8f0';
    ctx.fillText(this.name, (ix + this.w / 2 - ox) * z, (iy - 10 - oy) * z);
    ctx.textAlign = 'left';
  }

  // simple per-NPC headgear drawn over the recolored hero so they don't all look alike
  drawAccessory(ctx, cx, topY, dw, z) {
    const a = NPC_ACCESSORY[this.type];
    if (!a) return;
    ctx.save();
    ctx.fillStyle = a.color;
    const hw = dw * 0.42, hx = cx - hw / 2, hy = topY;
    if (a.kind === 'wideHat') { ctx.fillRect(hx - dw * 0.12, hy + 4 * z, hw + dw * 0.24, 3 * z); ctx.fillRect(hx + hw * 0.2, hy - 4 * z, hw * 0.6, 8 * z); }
    else if (a.kind === 'pointyHat') { ctx.beginPath(); ctx.moveTo(cx, hy - 10 * z); ctx.lineTo(hx, hy + 5 * z); ctx.lineTo(hx + hw, hy + 5 * z); ctx.closePath(); ctx.fill(); }
    else if (a.kind === 'cap') { ctx.fillRect(hx, hy, hw, 5 * z); ctx.fillStyle = '#fff'; ctx.fillRect(cx - 1.5 * z, hy + 1 * z, 3 * z, 3 * z); } // nurse: white cap + red cross accent below
    else if (a.kind === 'hood') { ctx.beginPath(); ctx.arc(cx, hy + 3 * z, hw * 0.55, Math.PI, 0); ctx.fill(); }
    else if (a.kind === 'helmet') { ctx.fillRect(hx, hy, hw, 6 * z); }
    else if (a.kind === 'crown') { ctx.fillRect(hx, hy + 2 * z, hw, 3 * z); for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(hx + hw * (i * 0.4), hy + 2 * z); ctx.lineTo(hx + hw * (i * 0.4 + 0.2), hy - 3 * z); ctx.lineTo(hx + hw * (i * 0.4 + 0.4), hy + 2 * z); ctx.fill(); } }
    ctx.restore();
  }
}

// --- NPC appearance tables --------------------------------------------------
// Each NPC gets a distinct PixelLab character when available; until then a recolored
// hero body + distinct headgear so no two NPCs (or the player) look identical.
const NPC_CHAR = {
  guide: 'npcGuide', merchant: 'npcMerchant', nurse: 'npcNurse', demolitionist: 'npcDemolitionist',
  blacksmith: 'npcBlacksmith', armsDealer: 'npcArmsDealer', wizard: 'npcWizard', dryad: 'npcDryad',
  oldMiner: 'npcOldMiner', deepTrader: 'npcDeepTrader',
};
const NPC_BODY = {
  guide: '#5a8a4a', merchant: '#b8933c', nurse: '#e8c0c8', demolitionist: '#b85a3a',
  blacksmith: '#6a6a78', armsDealer: '#8a7048', wizard: '#6a4ab0', dryad: '#4a9a5a',
  oldMiner: '#c8a050', deepTrader: '#3aa0a0', angler: '#4a80b0',
};
const NPC_ACCESSORY = {
  guide: { kind: 'hood', color: '#4a7a3a' },
  merchant: { kind: 'wideHat', color: '#8a6a2a' },
  nurse: { kind: 'cap', color: '#ffffff' },
  demolitionist: { kind: 'helmet', color: '#c85a2a' },
  blacksmith: { kind: 'helmet', color: '#4a4a56' },
  armsDealer: { kind: 'wideHat', color: '#6a5030' },
  wizard: { kind: 'pointyHat', color: '#5a3aa0' },
  dryad: { kind: 'hood', color: '#3a8a4a' },
  oldMiner: { kind: 'helmet', color: '#d8a840' },
  deepTrader: { kind: 'hood', color: '#2a8a8a' },
  angler: { kind: 'wideHat', color: '#365a80' },
};

// offscreen recolor cache: multiply-tint a hero frame so ONLY the sprite pixels are
// colored (source-atop on an offscreen canvas that contains just the sprite → no box).
const _tintCache = new Map();
function tintedFrame(img, type) {
  if (!img) return img;
  const key = `${type}:${img.src ?? img.__id ?? (img.__id = Math.random())}`;
  if (_tintCache.has(key)) return _tintCache.get(key);
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-atop';   // affects only the sprite already drawn here
  g.fillStyle = (NPC_BODY[type] ?? '#8a8a9a');
  g.globalAlpha = 0.5;
  g.fillRect(0, 0, c.width, c.height);
  _tintCache.set(key, c);
  return c;
}

// ---------------------------------------------------------------------------
// Housing check (simplified Terraria rules). Flood-fills the air region around
// a door; returns {valid, reason} — reasons help the player fix the house.
// ---------------------------------------------------------------------------
export function checkHousing(world, doorTx, doorTy) {
  // start inside: try both sides of the door
  for (const side of [1, -1]) {
    const sx = doorTx + side, sy = doorTy;
    if (world.isSolid(sx, sy)) continue;
    const seen = new Set();
    const queue = [[sx, sy]];
    let cells = 0, hasLight = false, hasChair = false, hasSurface = false, walls = 0, leaked = false;
    while (queue.length && cells <= 800) {
      const [tx, ty] = queue.pop();
      const key = ty * world.w + tx;
      if (seen.has(key)) continue;
      seen.add(key);
      const id = world.tileAt(tx, ty);
      const info = TILES[id];
      // boundary: solid tiles, and doors in EITHER state (a doorway seals the room)
      if (info.solid || id === T.door || id === T.doorOpen) continue;
      cells++;
      if (ty < 2 || ty > world.h - 2) { leaked = true; break; }
      if (id === T.torch || (info.lightEmit && !info.solid)) hasLight = true;
      if (id === T.chair) hasChair = true;
      if (id === T.workbench || id === T.platform) hasSurface = true;
      const wallId = world.wallAt(tx, ty);
      if (wallId !== 0 && !WALLS[wallId].natural) walls++;
      queue.push([tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]);
    }
    if (leaked || cells > 750) continue;                  // not enclosed
    if (cells < 30) return { valid: false, reason: 'room too small' };
    if (walls < cells * 0.4) return { valid: false, reason: 'needs more background walls' };
    if (!hasLight) return { valid: false, reason: 'needs a light source' };
    if (!hasChair) return { valid: false, reason: 'needs a chair' };
    if (!hasSurface) return { valid: false, reason: 'needs a table or work bench' };
    return { valid: true, x: sx, y: sy };
  }
  return { valid: false, reason: 'not enclosed' };
}

export class NPCManager {
  constructor(game) {
    this.game = game;
    this.npcs = [];
    this.doors = new Set();
    this.merchantHome = null;
    game.world.onTileChanged.push((tx, ty) => {
      const id = game.world.tileAt(tx, ty);
      const key = ty * game.world.w + tx;
      if (id === T.door || id === T.doorOpen) this.doors.add(key); else this.doors.delete(key);
    });
  }

  spawnGuide() {
    const w = this.game.world;
    this.npcs.push(new NPC('guide', (w.spawnX + 4) * TILE, w.spawnY * TILE + 48));
  }

  // find a valid house whose door isn't already claimed by another NPC
  findFreeHouse(g) {
    for (const key of this.doors) {
      if (this.npcs.some(n => n.doorKey === key)) continue;
      const tx = key % g.world.w, ty = (key / g.world.w) | 0;
      const res = checkHousing(g.world, tx, ty);
      if (res.valid) return { ...res, key };
    }
    return null;
  }

  tick() {
    const g = this.game;
    for (const n of this.npcs) n.tick(g);
    if (g.tick % 600 !== 0) return;
    // arrivals (Terraria-style conditions), one per check
    const arrivals = [
      ['merchant', () => g.inventory.money >= 5000, 'Sela the Merchant has moved in!'],
      ['nurse', () => g.player.hpMax > 100, 'Mira the Nurse has moved in!'],
      ['demolitionist', () => g.inventory.count('bomb') > 0 || g.inventory.count('dynamite') > 0, 'Boris the Demolitionist has moved in!'],
      ['blacksmith', () => g.inventory.money >= 20000, 'Hilda the Blacksmith has moved in! She reforges weapons.'],
      ['armsDealer', () => ['woodenBow', 'copperBow', 'ironBow', 'silverBow', 'goldBow'].some(b => g.inventory.count(b) > 0) && g.inventory.money >= 2500, 'Dex the Arms Dealer has moved in!'],
      ['wizard', () => g.player.manaMax >= 60, 'Alaric the Wizard has moved in!'],
      ['dryad', () => (g.progress?.bossKills ?? 0) > 0, 'Fenna the Dryad has moved in!'],
    ];
    for (const [type, cond, msg] of arrivals) {
      if (this.npcs.some(n => n.type === type) || !cond()) continue;
      const house = this.findFreeHouse(g);
      if (!house) return;
      const m = new NPC(type, house.x * TILE + 8, (house.y + 1) * TILE);
      m.homeX = house.x * TILE;
      m.doorKey = house.key;
      this.npcs.push(m);
      g.announce?.(msg);
      g.audio?.play('powerup');
      return;
    }
  }

  // right-click hook: returns true if an NPC was under the cursor tile
  interactAt(tx, ty) {
    for (const n of this.npcs) {
      const bx = tx * TILE + 8, by = ty * TILE + 8;
      if (bx > n.x - 8 && bx < n.x + n.w + 8 && by > n.y - 8 && by < n.y + n.h + 8) {
        return n.interact(this.game);
      }
    }
    return false;
  }

  draw(ctx, camera, alpha, assets) {
    for (const n of this.npcs) n.draw(ctx, camera, alpha, assets);
  }
}
