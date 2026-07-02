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
  width: 44px; height: 44px; background: rgba(20,24,40,0.75); border: 2px solid #3a415c;
  border-radius: 6px; position: relative; display: flex; align-items: center; justify-content: center;
  font-family: 'Segoe UI', system-ui, sans-serif;
}
.us-slot.sel { border-color: #e8d9a0; box-shadow: 0 0 8px rgba(232,217,160,.5); }
.us-slot .icon { width: 30px; height: 30px; border-radius: 4px; display: flex; align-items: center;
  justify-content: center; font-size: 10px; font-weight: 700; color: #101018; text-shadow: 0 0 2px rgba(255,255,255,.35); }
.us-slot .cnt { position: absolute; bottom: 2px; right: 4px; font-size: 11px; color: #fff; text-shadow: 0 1px 2px #000; }
.us-slot .key { position: absolute; top: 1px; left: 4px; font-size: 9px; color: #9aa3c0; }
#us-inv { top: 64px; left: 12px; display: none; background: rgba(12,15,28,0.92);
  border: 2px solid #3a415c; border-radius: 10px; padding: 12px; max-width: calc(100vw - 32px);
  max-height: calc(100vh - 90px); overflow: auto; }
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
#us-money { top: 62px; right: 14px; font: 12px monospace; text-shadow: 0 1px 2px #000; text-align: right; }
#us-tip { position: absolute; display: none; background: rgba(8,10,20,0.95); border: 1px solid #4a5478;
  padding: 6px 9px; border-radius: 6px; font: 12px 'Segoe UI'; pointer-events: none; z-index: 50; max-width: 240px; }
#us-armor { display: flex; flex-direction: column; gap: 4px; }
`;

const ICON_COLORS = {
  tool: '#c9c9d8', weapon: '#e88a8a', bow: '#c8e88a', block: null, wall: '#8a8a9a',
  material: '#d8c878', armor: '#8ac8e8', consumable: '#e88ac8', ammo: '#c8e8d8', summon: '#c88ae8',
};

function iconFor(id) {
  const def = ITEMS[id];
  let bg = ICON_COLORS[def.type] ?? '#d8c878';
  if (def.type === 'block' && def.placeTile && T[def.placeTile] != null) bg = TILES[T[def.placeTile]].color;
  const abbr = def.name.split(' ').map(w => w[0]).join('').slice(0, 3);
  return `<div class="icon" style="background:${bg}">${abbr}</div>`;
}

export class HUD {
  constructor(game, player, inventory) {
    this.game = game; this.player = player; this.inv = inventory;
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
      <div id="us-inv" class="us-panel">
        <div><h3>Inventory</h3><div class="grid" id="us-main"></div></div>
        <div id="us-armor-wrap"><h3>Armor</h3><div id="us-armor"></div></div>
        <div><h3>Crafting</h3><div id="us-craft"></div></div>
        <div id="us-chest-wrap" style="display:none"><h3>Chest</h3><div class="grid" id="us-chest" style="grid-template-columns: repeat(5, 44px)"></div></div>
      </div>
      <div id="us-tip"></div>`;
    this.els = {
      hearts: hud.querySelector('#us-hearts'),
      mana: hud.querySelector('#us-mana'),
      money: hud.querySelector('#us-money'),
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
    this.els.money.textContent = coinText(inv.money);
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

  tick() {
    const p = this.player;
    // hearts: 1 per 20 max HP
    const hearts = Math.ceil(p.hpMax / 20);
    const full = p.hp / 20;
    let html = '';
    for (let i = 0; i < hearts; i++) {
      const frac = Math.max(0, Math.min(1, full - i));
      html += `<span class="us-heart" style="opacity:${0.25 + 0.75 * frac}">❤️</span>`;
    }
    if (this.els.hearts.innerHTML !== html) this.els.hearts.innerHTML = html;
    // mana
    const stars = Math.ceil(p.manaMax / 20);
    let mhtml = '';
    for (let i = 0; i < stars; i++) mhtml += `<span class="us-star">⭐</span>`;
    if (this.els.mana.innerHTML !== mhtml) this.els.mana.innerHTML = mhtml;
    if (this.open) this.refreshCrafting();
  }
}
