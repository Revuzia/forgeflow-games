// DOM-based HUD + inventory/crafting panel (crisper than canvas for grids/tooltips).
// Placeholder item icons: color swatch + abbreviation (replaced by sprite icons in art pass).

import { ITEMS } from '../items/items.js';
import { HOTBAR, SLOTS, coinText } from '../items/inventory.js';
import { availableRecipes, nearbyStations, craft } from '../items/crafting.js';
import { TILES, T } from '../world/world.js';

const CSS = `
#hud { color: #e8e8f0; }
.us-panel { position: absolute; pointer-events: auto; user-select: none; }
#us-hearts { top: 10px; right: 14px; display: flex; gap: 3px; flex-wrap: wrap; max-width: 270px; justify-content: flex-end; }
.us-heart { width: 20px; height: 20px; font-size: 18px; line-height: 20px; filter: drop-shadow(0 1px 2px rgba(0,0,0,.7)); }
#us-mana { top: 36px; right: 14px; display: flex; gap: 2px; justify-content: flex-end; }
.us-star { font-size: 14px; filter: drop-shadow(0 1px 2px rgba(0,0,0,.7)); }
#us-hotbar { top: 10px; left: 12px; display: flex; gap: 4px; flex-wrap: wrap; max-width: calc(100vw - 300px); }
.us-slot {
  width: 44px; height: 44px;
  background: url('assets/ui/slot.png'); background-size: 100% 100%; image-rendering: pixelated;
  border: none; border-radius: 6px; position: relative; display: flex; align-items: center; justify-content: center;
  font-family: 'Segoe UI', system-ui, sans-serif;
}
.us-slot.sel { background-image: url('assets/ui/slotSel.png'); box-shadow: 0 0 10px rgba(232,217,160,.6); }
.us-slot .icon.r-uncommon { filter: drop-shadow(0 0 3px rgba(109,232,109,.8)); }
.us-slot .icon.r-rare { filter: drop-shadow(0 0 3px rgba(90,180,255,.85)); }
.us-slot .icon.r-epic { filter: drop-shadow(0 0 4px rgba(185,104,255,.9)); }
.us-slot .icon { width: 30px; height: 30px; border-radius: 4px; display: flex; align-items: center;
  justify-content: center; font-size: 10px; font-weight: 700; color: #101018; text-shadow: 0 0 2px rgba(255,255,255,.35); }
.us-slot .cnt { position: absolute; bottom: 2px; right: 4px; font-size: 11px; color: #fff; text-shadow: 0 1px 2px #000; }
.us-slot .key { position: absolute; top: 1px; left: 4px; font-size: 9px; color: #9aa3c0; }
#us-inv { top: 64px; left: 12px; display: none;
  background: rgba(12,15,28,0.92) url('assets/ui/panel.png'); background-size: 100% 100%;
  image-rendering: pixelated; background-blend-mode: multiply;
  border: 2px solid #3a2f22; border-radius: 10px; padding: 12px; max-width: calc(100vw - 32px);
  max-height: calc(100vh - 90px); overflow: auto; }
#us-inv h3 { color: #f0e6d0 !important; text-shadow: 0 1px 2px rgba(0,0,0,.8); }
#us-inv.open { display: flex; gap: 14px; flex-wrap: wrap; }
#us-inv .grid { display: grid; grid-template-columns: repeat(10, 44px); gap: 4px; }
#us-inv h3 { margin: 0 0 6px; font: 600 12px 'Segoe UI'; color: #9aa3c0; letter-spacing: 1px; text-transform: uppercase; }
#us-craft { width: 240px; max-height: 300px; overflow-y: auto; }
.us-recipe { display: flex; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 6px; cursor: pointer;
  border: 1px solid transparent; font: 12px 'Segoe UI'; }
.us-recipe:hover { background: rgba(60,70,110,0.5); }
.us-recipe.no { opacity: 0.38; cursor: default; }
.us-recipe .icon { width: 24px; height: 24px; border-radius: 4px; flex: none; display: flex; align-items: center;
  justify-content: center; font-size: 8px; font-weight: 700; color: #101018; }
.us-recipe .ing { color: #9aa3c0; font-size: 10px; }
#us-money { top: 64px; right: 14px; font: 600 13px 'Segoe UI'; text-shadow: 0 1px 2px #000; text-align: right;
  display: flex; gap: 8px; align-items: center; justify-content: flex-end; }
#us-money .coin { display: inline-flex; align-items: center; gap: 3px; }
#us-money .coin i { width: 12px; height: 12px; border-radius: 50%; display: inline-block;
  box-shadow: inset -1px -2px 2px rgba(0,0,0,.4), inset 1px 1px 1px rgba(255,255,255,.55), 0 1px 2px rgba(0,0,0,.5); }
#us-held-name { top: 104px; left: 12px; font: 600 14px 'Segoe UI'; color: #e8e8f0;
  text-shadow: 0 1px 3px #000, 0 0 8px rgba(0,0,0,.6); min-height: 18px; }
.us-heart svg { filter: drop-shadow(0 1px 2px rgba(0,0,0,.7)); }
#us-tip { position: absolute; display: none; background: rgba(8,10,20,0.95); border: 1px solid #4a5478;
  padding: 6px 9px; border-radius: 6px; font: 12px 'Segoe UI'; pointer-events: none; z-index: 50; max-width: 240px; }
#us-armor { display: flex; flex-direction: column; gap: 4px; }
`;

const ICON_COLORS = {
  tool: '#c9c9d8', weapon: '#e88a8a', bow: '#c8e88a', block: null, wall: '#8a8a9a',
  material: '#d8c878', armor: '#8ac8e8', consumable: '#e88ac8', ammo: '#c8e8d8', summon: '#c88ae8',
};

// item icon images live at assets/items/<id>.png (PixelLab-generated).
// We track which exist so missing ones fall back to a color swatch + abbreviation.
const iconAvailable = new Map(); // id → true|false (probed lazily)
function probeIcon(id) {
  if (iconAvailable.has(id)) return;
  iconAvailable.set(id, false);
  const img = new Image();
  img.onload = () => { iconAvailable.set(id, true); document.dispatchEvent(new CustomEvent('us-icons-changed')); };
  img.src = `assets/items/${id}.png`;
}

// raw terrain blocks render THE ACTUAL TILE TEXTURE as their icon (hotbar dirt == placed dirt)
const tileIconCache = new Map();
let gameAssetsRef = null;
export function setIconAssets(assets) { gameAssetsRef = assets; tileIconCache.clear(); }
function tileIconUrl(tileName) {
  if (tileIconCache.has(tileName)) return tileIconCache.get(tileName);
  const tex = gameAssetsRef?.tiles?.[tileName];
  if (!tex) { tileIconCache.set(tileName, null); return null; }
  const c = document.createElement('canvas');
  c.width = 20; c.height = 20;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(tex, 0, 0, 16, 16, 2, 2, 16, 16);
  g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(2, 2, 16, 2);
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(2, 16, 16, 2); g.fillRect(16, 2, 2, 16);
  const url = c.toDataURL();
  tileIconCache.set(tileName, url);
  return url;
}

function rarityClass(def) {
  const v = def.value ?? 0;
  return v >= 15000 ? 'r-epic' : v >= 6000 ? 'r-rare' : v >= 2000 ? 'r-uncommon' : '';
}

function iconFor(id) {
  const def = ITEMS[id];
  const rc = rarityClass(def);
  // terrain blocks: real tile texture beats a generated approximation
  if (def.type === 'block' && def.placeTile && T[def.placeTile] != null && TILES[T[def.placeTile]].frameStyle === 'blob') {
    const url = tileIconUrl(def.placeTile);
    if (url) return `<div class="icon ${rc}" style="background:transparent"><img src="${url}" style="width:100%;height:100%;image-rendering:pixelated" alt=""></div>`;
  }
  probeIcon(id);
  if (iconAvailable.get(id)) {
    return `<div class="icon ${rc}" style="background:transparent"><img src="assets/items/${id}.png" style="width:100%;height:100%;image-rendering:pixelated;object-fit:contain" alt=""></div>`;
  }
  // fallback: tile-color swatch for blocks, class color + abbreviation otherwise
  let bg = ICON_COLORS[def.type] ?? '#d8c878';
  if (def.type === 'block' && def.placeTile && T[def.placeTile] != null) bg = TILES[T[def.placeTile]].color;
  const abbr = def.name.split(' ').map(w => w[0]).join('').slice(0, 3);
  return `<div class="icon ${rc}" style="background:${bg}">${abbr}</div>`;
}

export class HUD {
  constructor(game, player, inventory) {
    this.game = game; this.player = player; this.inv = inventory;
    if (game.assets) setIconAssets(game.assets);
    this.open = false;
    this.cursorStack = null;          // stack picked up by mouse in the panel
    this.lastCraftListKey = '';
    const hud = document.getElementById('hud');
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    hud.innerHTML = `
      <div id="us-hearts" class="us-panel"></div>
      <div id="us-mana" class="us-panel"></div>
      <div id="us-money" class="us-panel"></div>
      <div id="us-hotbar" class="us-panel"></div>
      <div id="us-held-name" class="us-panel"></div>
      <div id="us-inv" class="us-panel">
        <div><h3>Inventory</h3><div class="grid" id="us-main"></div></div>
        <div id="us-armor-wrap"><h3>Armor</h3><div id="us-armor"></div></div>
        <div><h3>Crafting</h3><div id="us-craft"></div></div>
        <div id="us-chest-wrap" style="display:none"><h3>Chest</h3><div class="grid" id="us-chest" style="grid-template-columns: repeat(5, 44px)"></div></div>
        <div id="us-shop-wrap" style="display:none; min-width:200px"><h3 id="us-shop-title">Shop</h3><div id="us-shop"></div></div>
      </div>
      <div id="us-tip"></div>`;
    this.els = {
      hearts: hud.querySelector('#us-hearts'),
      mana: hud.querySelector('#us-mana'),
      money: hud.querySelector('#us-money'),
      heldName: hud.querySelector('#us-held-name'),
      hotbar: hud.querySelector('#us-hotbar'),
      inv: hud.querySelector('#us-inv'),
      main: hud.querySelector('#us-main'),
      armor: hud.querySelector('#us-armor'),
      craft: hud.querySelector('#us-craft'),
      chestWrap: hud.querySelector('#us-chest-wrap'),
      chest: hud.querySelector('#us-chest'),
      tip: hud.querySelector('#us-tip'),
    };
    this.openChestSlots = null;   // array ref into Chests map while a chest is open
    this.buildSlots();
    inventory.onChange.push(() => this.refreshSlots());
    hud.addEventListener('mousemove', (e) => this.moveTip(e));
    document.addEventListener('us-icons-changed', () => { this.refreshSlots(); this.lastCraftListKey = ''; });
  }

  toggle(open = !this.open) {
    this.open = open;
    this.game.audio?.play(open ? 'uiOpen' : 'uiClose', { volume: 0.5 });
    this.els.inv.classList.toggle('open', open);
    if (!open) {
      this.closeChest();
      if (this.cursorStack) {
        // drop cursor stack back into inventory
        const left = this.inv.add(this.cursorStack.id, this.cursorStack.count);
        if (left > 0) this.game.drops.spawn(this.cursorStack.id, left, this.player.x, this.player.y);
        this.cursorStack = null;
      }
    }
  }

  openChest(tx, ty) {
    const chests = this.game.world.chests;
    if (!chests) return;
    this.openChestSlots = chests.ensure(tx, ty);
    this.openChestAt = [tx, ty];
    this.els.chestWrap.style.display = '';
    this.buildChestSlots();
    if (!this.open) this.toggle(true);
    else this.refreshSlots();
  }

  closeChest() {
    this.openChestSlots = null;
    this.els.chestWrap.style.display = 'none';
    this.shopOpen = false;
    const shopWrap = document.getElementById('us-shop-wrap');
    if (shopWrap) shopWrap.style.display = 'none';
  }

  async openShop(npc) {
    const { SHOPS } = await import('../entities/npc.js');
    const stock = SHOPS[npc.type] ?? SHOPS.merchant;
    const wrap = document.getElementById('us-shop-wrap');
    const list = document.getElementById('us-shop');
    document.getElementById('us-shop-title').textContent = npc.name;
    this.shopOpen = true;
    list.innerHTML = '<div class="ing" style="padding:2px 6px 6px">Shift-click your items to sell them</div>';
    for (const [id, price] of stock) {
      const el = document.createElement('div');
      el.className = 'us-recipe';
      const gold = Math.floor(price / 10000), silver = Math.floor((price % 10000) / 100), c = price % 100;
      const priceTxt = [gold && `${gold}g`, silver && `${silver}s`, c && `${c}c`].filter(Boolean).join(' ');
      el.innerHTML = `${iconFor(id)}<div>${ITEMS[id].name}<div class="ing">${priceTxt}</div></div>`;
      el.addEventListener('mousedown', () => {
        if (this.inv.money < price) { this.game.audio?.play('uiClick', { volume: 0.3, rate: 0.7 }); return; }
        this.inv.money -= price;
        this.inv.add(id, 1);
        this.game.audio?.play('coins', { volume: 0.6 });
      });
      list.appendChild(el);
    }
    wrap.style.display = '';
    if (!this.open) this.toggle(true);
  }

  buildChestSlots() {
    this.els.chest.innerHTML = '';
    for (let i = 0; i < this.openChestSlots.length; i++) {
      const el = document.createElement('div');
      el.className = 'us-slot';
      el.dataset.chestSlot = i;
      el.addEventListener('mousedown', (e) => this.chestSlotClick(i, e));
      this.els.chest.appendChild(el);
    }
    this.refreshSlots();
  }

  chestSlotClick(i, e) {
    e.preventDefault();
    if (!this.openChestSlots) return;
    const slots = this.openChestSlots;
    const s = slots[i];
    if (this.cursorStack) {
      if (!s) { slots[i] = this.cursorStack; this.cursorStack = null; }
      else if (s.id === this.cursorStack.id) {
        const max = ITEMS[s.id].stack ?? 9999;
        const take = Math.min(max - s.count, this.cursorStack.count);
        s.count += take; this.cursorStack.count -= take;
        if (this.cursorStack.count <= 0) this.cursorStack = null;
      } else { slots[i] = this.cursorStack; this.cursorStack = s; }
    } else if (s) {
      if (e.shiftKey) {
        // quick-move to inventory
        const left = this.inv.add(s.id, s.count);
        slots[i] = left > 0 ? { id: s.id, count: left } : null;
      } else {
        this.cursorStack = s; slots[i] = null;
      }
    }
    this.game.audio?.play('uiClick', { volume: 0.4 });
    this.inv.changed();
  }

  buildSlots() {
    // hotbar
    for (let i = 0; i < HOTBAR; i++) {
      const el = document.createElement('div');
      el.className = 'us-slot';
      el.innerHTML = `<span class="key">${(i + 1) % 10}</span>`;
      el.dataset.slot = i;
      el.addEventListener('mousedown', (e) => this.slotClick(i, e));
      el.addEventListener('mouseenter', () => this.showTipForSlot(i));
      el.addEventListener('mouseleave', () => this.hideTip());
      this.els.hotbar.appendChild(el);
    }
    // main grid
    for (let i = HOTBAR; i < SLOTS; i++) {
      const el = document.createElement('div');
      el.className = 'us-slot';
      el.dataset.slot = i;
      el.addEventListener('mousedown', (e) => this.slotClick(i, e));
      el.addEventListener('mouseenter', () => this.showTipForSlot(i));
      el.addEventListener('mouseleave', () => this.hideTip());
      this.els.main.appendChild(el);
    }
    // armor
    for (const k of ['head', 'chest', 'legs']) {
      const el = document.createElement('div');
      el.className = 'us-slot';
      el.dataset.armor = k;
      el.addEventListener('mousedown', () => this.armorClick(k));
      this.els.armor.appendChild(el);
    }
    this.refreshSlots();
  }

  slotClick(i, e) {
    e.preventDefault();
    if (!this.open && i >= HOTBAR) return;
    const inv = this.inv;
    if (!this.open) { inv.selected = i; this.refreshSlots(); return; }
    const s = inv.slots[i];
    if (this.cursorStack) {
      if (!s) { inv.slots[i] = this.cursorStack; this.cursorStack = null; }
      else if (s.id === this.cursorStack.id) {
        const max = ITEMS[s.id].stack ?? 9999;
        const take = Math.min(max - s.count, this.cursorStack.count);
        s.count += take; this.cursorStack.count -= take;
        if (this.cursorStack.count <= 0) this.cursorStack = null;
      } else { inv.slots[i] = this.cursorStack; this.cursorStack = s; }
    } else if (s) {
      // shift-click with a shop open: SELL the stack (Terraria rate: value/5)
      if (e.shiftKey && this.shopOpen) {
        const unit = Math.max(1, Math.floor((ITEMS[s.id].value ?? 0) / 5));
        inv.money += unit * s.count;
        inv.slots[i] = null;
        this.game.audio?.play('coins', { volume: 0.7 });
        inv.changed();
        return;
      }
      // shift-click: equip armor / quick actions
      if (e.shiftKey && ITEMS[s.id].type === 'armor') { this.equipFrom(i); return; }
      this.cursorStack = s; inv.slots[i] = null;
    }
    inv.changed();
  }

  equipFrom(i) {
    const inv = this.inv;
    const s = inv.slots[i];
    const slot = ITEMS[s.id].bodySlot;
    const prev = inv.armor[slot];
    inv.armor[slot] = s;
    inv.slots[i] = prev ?? null;
    inv.changed();
  }

  armorClick(k) {
    if (!this.open) return;
    const inv = this.inv;
    const cur = inv.armor[k];
    if (this.cursorStack && ITEMS[this.cursorStack.id].bodySlot === k) {
      inv.armor[k] = this.cursorStack;
      this.cursorStack = cur;
    } else if (!this.cursorStack && cur) {
      this.cursorStack = cur;
      inv.armor[k] = null;
    }
    inv.changed();
  }

  refreshSlots() {
    const inv = this.inv;
    const slotEls = [...this.els.hotbar.children, ...this.els.main.children];
    slotEls.forEach((el) => {
      const i = +el.dataset.slot;
      const s = inv.slots[i];
      el.classList.toggle('sel', i === inv.selected);
      const key = el.querySelector('.key')?.outerHTML ?? '';
      el.innerHTML = key + (s ? `${iconFor(s.id)}${s.count > 1 ? `<span class="cnt">${s.count}</span>` : ''}` : '');
    });
    [...this.els.armor.children].forEach((el) => {
      const s = inv.armor[el.dataset.armor];
      el.innerHTML = s ? iconFor(s.id) : `<span style="font-size:9px;color:#586080">${el.dataset.armor}</span>`;
    });
    if (this.openChestSlots) {
      [...this.els.chest.children].forEach((el) => {
        const s = this.openChestSlots[+el.dataset.chestSlot];
        el.innerHTML = s ? `${iconFor(s.id)}${s.count > 1 ? `<span class="cnt">${s.count}</span>` : ''}` : '';
      });
    }
    // coins: Terraria-style denominations with coin dots (zero denominations hidden)
    const gold = Math.floor(inv.money / 10000), silver = Math.floor((inv.money % 10000) / 100), copper = inv.money % 100;
    const coin = (n, color, label) => n > 0 || label === 'copper'
      ? `<span class="coin" title="${label} coins"><i style="background:${color}"></i>${n}</span>` : '';
    this.els.money.innerHTML =
      coin(gold, 'linear-gradient(135deg,#ffe08a,#c8952a)', 'gold') +
      coin(silver, 'linear-gradient(135deg,#f0f0f5,#8a8a9a)', 'silver') +
      coin(copper, 'linear-gradient(135deg,#e8a06a,#8a5028)', 'copper');
    // hotbar selected-item name (Terraria shows it under the hotbar)
    const held = inv.held();
    this.els.heldName.textContent = held ? ITEMS[held.id].name : '';
  }

  showTipForSlot(i) {
    const s = this.inv.slots[i];
    if (!s) return this.hideTip();
    const def = ITEMS[s.id];
    const lines = [`<b>${def.name}</b>`];
    if (def.damage) lines.push(`${def.damage} damage`);
    if (def.pickPower) lines.push(`${def.pickPower}% pickaxe power`);
    if (def.axePower) lines.push(`${def.axePower}% axe power`);
    if (def.hammerPower) lines.push(`${def.hammerPower}% hammer power`);
    if (def.defense) lines.push(`${def.defense} defense`);
    if (def.placeTile || def.placeWall) lines.push('Can be placed');
    this.els.tip.innerHTML = lines.join('<br>');
    this.els.tip.style.display = 'block';
  }

  hideTip() { this.els.tip.style.display = 'none'; }
  moveTip(e) {
    this.els.tip.style.left = `${e.clientX + 14}px`;
    this.els.tip.style.top = `${e.clientY + 10}px`;
  }

  refreshCrafting() {
    const stations = nearbyStations(this.game.world, this.player);
    const list = availableRecipes(this.inv, stations);
    const key = list.map(r => `${r.recipe.out}${r.canCraft ? 1 : 0}`).join(',');
    if (key === this.lastCraftListKey) return;
    this.lastCraftListKey = key;
    this.els.craft.innerHTML = '';
    for (const { recipe, canCraft } of list) {
      const el = document.createElement('div');
      el.className = `us-recipe ${canCraft ? '' : 'no'}`;
      const ing = Object.entries(recipe.ing).map(([id, n]) => `${n} ${ITEMS[id].name}`).join(', ');
      el.innerHTML = `${iconFor(recipe.out)}<div>${ITEMS[recipe.out].name}${recipe.n > 1 ? ` ×${recipe.n}` : ''}<div class="ing">${ing}</div></div>`;
      if (canCraft) {
        el.addEventListener('mousedown', () => {
          const res = craft(this.inv, recipe);
          if (res && res.leftover) this.game.drops.spawn(recipe.out, res.leftover, this.player.x, this.player.y);
          this.game.audio?.play('craft', { volume: 0.6 });
          this.lastCraftListKey = '';
          this.refreshCrafting();
        });
      }
      this.els.craft.appendChild(el);
    }
  }

  heartSvg(frac, i) {
    // Terraria-style heart: red fill, gold rim; empty hearts show dark socket
    const gid = `us-hg-${i}`;
    const fill = frac >= 1 ? '#d5223a' : frac > 0 ? `url(#${gid})` : '#3a2030';
    const grad = frac > 0 && frac < 1
      ? `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="${frac}" stop-color="#d5223a"/><stop offset="${frac}" stop-color="#3a2030"/>
        </linearGradient></defs>` : '';
    return `<span class="us-heart"><svg width="20" height="20" viewBox="0 0 16 16">${grad}
      <path d="M8 14 L2.5 8.5 Q0.5 6.5 1.5 4 Q2.5 1.5 5 2 Q7 2.5 8 4.5 Q9 2.5 11 2 Q13.5 1.5 14.5 4 Q15.5 6.5 13.5 8.5 Z"
        fill="${fill}" stroke="#e8b84a" stroke-width="1.1"/></svg></span>`;
  }

  tick() {
    const p = this.player;
    // hearts: 1 per 20 max HP, partial fill on the current heart
    const hearts = Math.ceil(p.hpMax / 20);
    const full = p.hp / 20;
    let html = '';
    for (let i = 0; i < hearts; i++) {
      const frac = Math.max(0, Math.min(1, full - i));
      html += this.heartSvg(frac, i);
    }
    if (this._lastHearts !== html) { this.els.hearts.innerHTML = html; this._lastHearts = html; }
    // mana stars
    const stars = Math.ceil(p.manaMax / 20);
    const manaFrac = p.mana / p.manaMax;
    let mhtml = '';
    for (let i = 0; i < stars; i++) {
      const on = (i + 1) / stars <= manaFrac + 0.001;
      mhtml += `<span class="us-star" style="opacity:${on ? 1 : 0.3}"><svg width="15" height="15" viewBox="0 0 16 16">
        <path d="M8 1 L10 6 L15 6.2 L11 9.6 L12.4 15 L8 11.8 L3.6 15 L5 9.6 L1 6.2 L6 6 Z"
          fill="#5ac8f0" stroke="#2a6a9a" stroke-width="1"/></svg></span>`;
    }
    if (this._lastMana !== mhtml) { this.els.mana.innerHTML = mhtml; this._lastMana = mhtml; }
    if (this.open) this.refreshCrafting();
  }
}
