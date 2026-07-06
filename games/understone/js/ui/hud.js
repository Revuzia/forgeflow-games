// DOM-based HUD + inventory. Bottom-center hotbar, paper-doll equipment (armor + accessories
// around a live character preview), pointer drag-and-drop, and a searchable recipe book.

import { ITEMS } from '../items/items.js';
import { HOTBAR, SLOTS, ARMOR_SLOTS, ACCESSORY_SLOTS } from '../items/inventory.js';
import { RECIPES } from '../items/recipes.js';
import { nearbyStations, craft } from '../items/crafting.js';
import { TILES, T } from '../world/world.js';
import { character, toolFallbackSprite } from '../core/assets.js';

const CSS = `
#hud { color: #e8e8f0; font-family: 'Segoe UI', system-ui, sans-serif; }
.us-panel { position: absolute; pointer-events: auto; user-select: none; }
/* --- top-right vitals --- */
#us-hearts { top: 10px; right: 14px; display: flex; gap: 3px; flex-wrap: wrap; max-width: 270px; justify-content: flex-end; }
.us-heart { width: 20px; height: 20px; }
.us-heart svg { filter: drop-shadow(0 1px 2px rgba(0,0,0,.7)); }
#us-mana { top: 36px; right: 14px; display: flex; gap: 2px; justify-content: flex-end; }
#us-money { top: 58px; right: 14px; font: 600 13px 'Segoe UI'; text-shadow: 0 1px 2px #000;
  display: flex; gap: 8px; align-items: center; justify-content: flex-end; }
#us-money .coin { display: inline-flex; align-items: center; gap: 3px; }
#us-money .coin i { width: 12px; height: 12px; border-radius: 50%; display: inline-block;
  box-shadow: inset -1px -2px 2px rgba(0,0,0,.4), inset 1px 1px 1px rgba(255,255,255,.55), 0 1px 2px rgba(0,0,0,.5); }
/* --- bottom-center hotbar --- */
#us-hotbar { bottom: 14px; left: 50%; transform: translateX(-50%); display: flex; gap: 5px; }
#us-held-name { bottom: 68px; left: 50%; transform: translateX(-50%); font: 600 14px 'Segoe UI';
  color: #e8e8f0; text-shadow: 0 1px 3px #000, 0 0 8px rgba(0,0,0,.7); min-height: 18px; text-align: center; }
/* --- slots --- */
.us-slot {
  width: 54px; height: 54px; background: url('assets/ui/slot.png'); background-size: 100% 100%;
  image-rendering: pixelated; position: relative; display: flex; align-items: center; justify-content: center;
}
.us-slot.sel { background-image: url('assets/ui/slotSel.png'); box-shadow: 0 0 12px rgba(232,217,160,.7); transform: translateY(-3px); }
.us-slot.drop-hi { outline: 2px solid #8fd0ff; outline-offset: -2px; }
.us-slot .icon { width: 38px; height: 38px; display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; color: #101018; text-shadow: 0 0 2px rgba(255,255,255,.35); pointer-events: none; }
.us-slot .icon img { width: 100%; height: 100%; image-rendering: pixelated; object-fit: contain; pointer-events: none; }
.us-slot .icon.r-uncommon { filter: drop-shadow(0 0 3px rgba(109,232,109,.85)); }
.us-slot .icon.r-rare { filter: drop-shadow(0 0 3px rgba(90,180,255,.9)); }
.us-slot .icon.r-epic { filter: drop-shadow(0 0 4px rgba(185,104,255,.95)); }
.us-slot .icon.r-legendary { filter: drop-shadow(0 0 5px rgba(255,180,60,1)); }
.us-slot .cnt { position: absolute; bottom: 2px; right: 4px; font-size: 11px; color: #fff; text-shadow: 0 1px 2px #000; pointer-events: none; }
.us-slot .key { position: absolute; top: 1px; left: 4px; font-size: 9px; color: #cdd5ef; text-shadow: 0 1px 1px #000; pointer-events: none; }
.us-slot .eqlabel { font-size: 8px; color: #7480a0; text-transform: uppercase; letter-spacing: .5px; }
/* --- inventory panel --- */
#us-inv { top: 50%; left: 50%; transform: translate(-50%, -50%); display: none;
  background: rgba(10,12,24,0.96) url('assets/ui/panel.png'); background-size: 100% 100%; background-blend-mode: multiply;
  image-rendering: pixelated; border: 2px solid #3a2f22; border-radius: 12px; padding: 16px;
  max-width: calc(100vw - 24px); max-height: calc(100vh - 24px); overflow: auto;
  box-shadow: 0 12px 48px rgba(0,0,0,.6); }
#us-inv.open { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
/* index.html sets "#hud * { pointer-events:none }" — override it with higher specificity so the
   open inventory (and every control inside it) actually receives clicks/drags/scroll instead of
   letting them fall through to the game canvas (which would swing the tool). */
#hud .us-panel { pointer-events: auto; }
#hud #us-inv.open, #hud #us-inv.open * { pointer-events: auto; }
#hud .us-slot { pointer-events: auto; }   /* every slot clickable — incl. the bottom hotbar (was left as pointer-events:none, so items couldn't be dragged out of the toolbar) */
#hud #us-cursor, #hud #us-tip { pointer-events: none !important; }
#us-inv h3 { margin: 0 0 8px; font: 700 12px 'Segoe UI'; color: #d9b98a; letter-spacing: 1.5px; text-transform: uppercase; }
#us-inv .grid { display: grid; grid-template-columns: repeat(10, 54px); gap: 5px; }
/* --- equipment paper-doll --- */
#us-equip-wrap { width: 210px; }
.us-doll { display: flex; gap: 12px; }
.us-doll .col { display: flex; flex-direction: column; gap: 5px; align-items: center; }
.us-preview { width: 84px; height: 128px; background: rgba(0,0,0,0.35); border: 1px solid #3a415c; border-radius: 8px;
  position: relative; align-self: center; overflow: hidden; }
.us-preview canvas { position: absolute; inset: 0; margin: auto; image-rendering: pixelated; }
.us-eqslot-label { font-size: 8px; color: #7480a0; text-transform: uppercase; letter-spacing: .5px; text-align: center; margin-top: -2px; }
#us-hands { display: flex; gap: 14px; justify-content: center; margin-top: 10px; }
/* --- recipe book --- */
#us-craft-wrap { width: 268px; }
#us-search { width: 100%; box-sizing: border-box; padding: 6px 9px; margin-bottom: 8px; border-radius: 6px;
  border: 1px solid #3a415c; background: rgba(0,0,0,0.4); color: #e8e8f0; font: 12px 'Segoe UI'; }
#us-cats { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.us-cat { font: 10px 'Segoe UI'; padding: 3px 8px; border-radius: 10px; border: 1px solid #3a415c;
  background: rgba(30,36,56,0.6); cursor: pointer; color: #b8c0d8; }
.us-cat.on { background: #d9b98a; color: #1a1a22; border-color: #d9b98a; }
#us-craft { max-height: 340px; overflow-y: auto; }
.us-recipe { display: flex; align-items: center; gap: 9px; padding: 5px 6px; border-radius: 7px; cursor: pointer; }
.us-recipe:hover { background: rgba(70,80,120,0.45); }
.us-recipe.no { opacity: 0.42; }
.us-recipe.no:hover { background: rgba(80,40,40,0.3); }
.us-recipe .rc-icon { width: 30px; height: 30px; flex: none; background: url('assets/ui/slot.png'); background-size: 100% 100%;
  display: flex; align-items: center; justify-content: center; border-radius: 4px; }
.us-recipe .rc-icon .icon { width: 24px; height: 24px; }
.us-recipe .rc-name { font: 600 12px 'Segoe UI'; }
.us-recipe .rc-ing { color: #9aa3c0; font-size: 10px; }
.us-recipe .rc-ing .miss { color: #e07a7a; }
.us-recipe .rc-ing .have { color: #8ad48a; }
#us-chest-wrap, #us-shop-wrap { display: none; }
/* --- cursor-held stack + tooltip --- */
#us-cursor { position: fixed; width: 40px; height: 40px; pointer-events: none; z-index: 200; display: none;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,.6)); }
#us-cursor img { width: 100%; height: 100%; image-rendering: pixelated; object-fit: contain; }
#us-cursor .cnt { position: absolute; bottom: -2px; right: 0; font: 11px 'Segoe UI'; color: #fff; text-shadow: 0 1px 2px #000; }
#us-tip { position: fixed; display: none; background: rgba(6,8,16,0.97); border: 1px solid #4a5478;
  padding: 7px 10px; border-radius: 7px; font: 12px 'Segoe UI'; pointer-events: none; z-index: 210; max-width: 240px; }
#us-tip .t-name { font-weight: 700; margin-bottom: 3px; }
#us-tip .t-line { color: #b8c0d8; font-size: 11px; }
`;

const ICON_COLORS = {
  tool: '#c9c9d8', weapon: '#e88a8a', bow: '#c8e88a', block: null, wall: '#8a8a9a',
  material: '#d8c878', armor: '#8ac8e8', accessory: '#e8c88a', consumable: '#e88ac8', ammo: '#c8e8d8', summon: '#c88ae8',
};

const iconAvailable = new Map();
function probeIcon(id) {
  if (iconAvailable.has(id)) return;
  iconAvailable.set(id, false);
  const img = new Image();
  img.onload = () => { iconAvailable.set(id, true); document.dispatchEvent(new CustomEvent('us-icons-changed')); };
  img.src = `assets/items/${id}.png`;
}

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
  return v >= 20000 ? 'r-legendary' : v >= 12000 ? 'r-epic' : v >= 5000 ? 'r-rare' : v >= 1500 ? 'r-uncommon' : '';
}

const toolIconCache = new Map();
const MAT_TINT = { molten: '#ff7a3c', nightmare: '#b06adf', gold: '#ffd75a', silver: '#dfe4ec', iron: '#c9ccd8', copper: '#d08a4a', wood: '#a9793f' };
// tools/weapons without a bespoke PNG fall back to a drawn sprite (never a bare initials box)
function toolFallbackUrl(id, def) {
  if (toolIconCache.has(id)) return toolIconCache.get(id);
  const kind = def.tool ?? (def.weapon === 'bow' ? 'bow' : (def.weapon === 'sword' || def.weapon === 'shortsword') ? 'sword' : null);
  if (!kind) { toolIconCache.set(id, null); return null; }
  const mat = Object.keys(MAT_TINT).find(m => id.toLowerCase().startsWith(m));
  const url = toolFallbackSprite(kind, MAT_TINT[mat] ?? '#c9ccd8').toDataURL();
  toolIconCache.set(id, url);
  return url;
}

function iconInner(id) {
  const def = ITEMS[id];
  const rc = rarityClass(def);
  if (def.type === 'block' && def.placeTile && T[def.placeTile] != null && TILES[T[def.placeTile]].frameStyle === 'blob') {
    const url = tileIconUrl(def.placeTile);
    if (url) return `<div class="icon ${rc}"><img src="${url}" alt=""></div>`;
  }
  probeIcon(id);
  if (iconAvailable.get(id)) return `<div class="icon ${rc}"><img src="assets/items/${id}.png" alt=""></div>`;
  const tfu = toolFallbackUrl(id, def);
  if (tfu) return `<div class="icon ${rc}"><img src="${tfu}" alt=""></div>`;
  let bg = ICON_COLORS[def.type] ?? '#d8c878';
  if (def.type === 'block' && def.placeTile && T[def.placeTile] != null) bg = TILES[T[def.placeTile]].color;
  const abbr = def.name.split(' ').map(w => w[0]).join('').slice(0, 3);
  return `<div class="icon ${rc}" style="background:${bg};border-radius:4px">${abbr}</div>`;
}
function iconFor(id) { return iconInner(id); }

// icon as a bare <img>/<div> src for the cursor element
function iconImgHTML(id) {
  const def = ITEMS[id];
  if (def.type === 'block' && def.placeTile && T[def.placeTile] != null) {
    const url = tileIconUrl(def.placeTile);
    if (url) return `<img src="${url}">`;
  }
  if (iconAvailable.get(id)) return `<img src="assets/items/${id}.png">`;
  return `<div style="width:100%;height:100%;background:${ICON_COLORS[def.type] ?? '#d8c878'};border-radius:4px;display:flex;align-items:center;justify-content:center;font:700 9px sans-serif;color:#101018">${def.name.slice(0, 3)}</div>`;
}

const CATEGORIES = [
  ['all', 'All'], ['tool', 'Tools'], ['weapon', 'Weapons'], ['armor', 'Armor'],
  ['accessory', 'Accessories'], ['block', 'Blocks'], ['station', 'Stations'],
  ['consumable', 'Potions'], ['material', 'Materials'],
];

export class HUD {
  constructor(game, player, inventory) {
    this.game = game; this.player = player; this.inv = inventory;
    if (game.assets) setIconAssets(game.assets);
    this.open = false;
    this.cursorStack = null;
    this.dragging = false;
    this.category = 'all';
    this.search = '';
    this.lastCraftKey = '';
    this.openChestSlots = null;
    this.shopOpen = false;

    const hud = document.getElementById('hud');
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    hud.innerHTML = `
      <div id="us-hearts" class="us-panel"></div>
      <div id="us-mana" class="us-panel"></div>
      <div id="us-money" class="us-panel"></div>
      <div id="us-held-name" class="us-panel"></div>
      <div id="us-hotbar" class="us-panel"></div>
      <div id="us-inv" class="us-panel">
        <div>
          <h3>Inventory</h3>
          <div class="grid" id="us-main"></div>
          <div id="us-chest-wrap"><h3 style="margin-top:14px">Chest</h3><div class="grid" id="us-chest" style="grid-template-columns:repeat(10,54px)"></div></div>
        </div>
        <div id="us-equip-wrap">
          <h3>Equipment</h3>
          <div class="us-doll">
            <div class="col" id="us-armor"></div>
            <div class="us-preview"><canvas id="us-doll-canvas" width="84" height="128"></canvas></div>
            <div class="col" id="us-acc"></div>
          </div>
          <div id="us-hands"></div>
          <div id="us-stats" style="margin-top:10px;font:11px 'Segoe UI';color:#b8c0d8;line-height:1.6"></div>
        </div>
        <div id="us-craft-wrap">
          <h3>Recipe Book</h3>
          <input id="us-search" placeholder="Search recipes…" autocomplete="off">
          <div id="us-cats"></div>
          <div id="us-craft"></div>
        </div>
        <div id="us-shop-wrap" style="min-width:210px"><h3 id="us-shop-title">Shop</h3><div id="us-shop"></div></div>
      </div>
      <div id="us-cursor"></div>
      <div id="us-tip"></div>`;

    this.els = {
      hearts: hud.querySelector('#us-hearts'), mana: hud.querySelector('#us-mana'),
      money: hud.querySelector('#us-money'), heldName: hud.querySelector('#us-held-name'),
      hotbar: hud.querySelector('#us-hotbar'), inv: hud.querySelector('#us-inv'),
      main: hud.querySelector('#us-main'), armor: hud.querySelector('#us-armor'),
      acc: hud.querySelector('#us-acc'), craft: hud.querySelector('#us-craft'),
      cats: hud.querySelector('#us-cats'), search: hud.querySelector('#us-search'),
      stats: hud.querySelector('#us-stats'), chestWrap: hud.querySelector('#us-chest-wrap'),
      chest: hud.querySelector('#us-chest'), cursor: hud.querySelector('#us-cursor'),
      tip: hud.querySelector('#us-tip'), dollCanvas: hud.querySelector('#us-doll-canvas'),
      hands: hud.querySelector('#us-hands'),
    };
    this.buildSlots();
    this.buildCategories();
    this.els.search.addEventListener('input', (e) => { this.search = e.target.value.toLowerCase(); this.lastCraftKey = ''; this.refreshCrafting(); });
    inventory.onChange.push(() => this.refreshSlots());
    document.addEventListener('us-icons-changed', () => { this.refreshSlots(); this.lastCraftKey = ''; });

    // global pointer tracking for drag + cursor stack
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
  }

  // ---- open/close --------------------------------------------------------------
  toggle(open = !this.open, focus = null) {
    this.open = open;
    this.game.audio?.play(open ? 'uiOpen' : 'uiClose', { volume: 0.5 });
    this.els.inv.classList.toggle('open', open);
    if (open) {
      this.refreshSlots(); this.lastCraftKey = ''; this.refreshCrafting(); this.drawDoll();
      if (focus === 'craft') this.els.search.focus();
    } else {
      this.closeChest();
      this.returnCursorStack();
    }
  }

  returnCursorStack() {
    if (!this.cursorStack) return;
    const left = this.inv.add(this.cursorStack.id, this.cursorStack.count);
    if (left > 0) this.game.drops.spawn(this.cursorStack.id, left, this.player.x, this.player.y);
    this.cursorStack = null;
    this.dragging = false;
    this.els.cursor.style.display = 'none';
    this.inv.changed();
  }

  // ---- slot construction -------------------------------------------------------
  buildSlots() {
    for (let i = 0; i < HOTBAR; i++) this.els.hotbar.appendChild(this.makeSlot({ hotbar: i }, `<span class="key">${(i + 1) % 10}</span>`));
    for (let i = HOTBAR; i < SLOTS; i++) this.els.main.appendChild(this.makeSlot({ inv: i }));
    for (const k of ARMOR_SLOTS) {
      const el = this.makeSlot({ armor: k });
      el.title = k;
      this.els.armor.appendChild(el);
      const lbl = document.createElement('div'); lbl.className = 'us-eqslot-label'; lbl.textContent = k;
      this.els.armor.appendChild(lbl);
    }
    for (let i = 0; i < ACCESSORY_SLOTS; i++) this.els.acc.appendChild(this.makeSlot({ acc: i }));
    // main-hand (weapon/tool) + off-hand (torch = light in your tunnels / shield)
    for (const [hand, label] of [['mainhand', 'Main Hand'], ['offhand', 'Off Hand']]) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px';
      wrap.appendChild(this.makeSlot({ hand }));
      const lbl = document.createElement('div'); lbl.className = 'us-eqslot-label'; lbl.textContent = label;
      wrap.appendChild(lbl);
      this.els.hands.appendChild(wrap);
    }
    this.refreshSlots();
  }

  makeSlot(kind, extraHTML = '') {
    const el = document.createElement('div');
    el.className = 'us-slot';
    el.dataset.kind = JSON.stringify(kind);
    if (extraHTML) el.innerHTML = extraHTML;
    el.addEventListener('pointerdown', (e) => this.onSlotDown(e, kind));
    el.addEventListener('pointerenter', () => { this.hoverSlot = kind; this.showTip(kind); });
    el.addEventListener('pointerleave', () => { this.hoverSlot = null; this.hideTip(); });
    return el;
  }

  buildCategories() {
    for (const [key, label] of CATEGORIES) {
      const el = document.createElement('div');
      el.className = 'us-cat' + (key === 'all' ? ' on' : '');
      el.textContent = label;
      el.addEventListener('click', () => {
        this.category = key;
        [...this.els.cats.children].forEach(c => c.classList.toggle('on', c === el));
        this.lastCraftKey = ''; this.refreshCrafting();
      });
      this.els.cats.appendChild(el);
    }
  }

  // ---- read/write a slot by kind ------------------------------------------------
  getSlot(kind) {
    if (kind.hotbar != null) return this.inv.slots[kind.hotbar];
    if (kind.inv != null) return this.inv.slots[kind.inv];
    if (kind.armor != null) return this.inv.armor[kind.armor];
    if (kind.acc != null) return this.inv.accessories[kind.acc];
    // main hand MIRRORS the selected hotbar item (what you're wielding); off hand is real storage
    if (kind.hand === 'mainhand') return this.inv.held();
    if (kind.hand != null) return this.inv.hands[kind.hand];
    if (kind.chest != null) return this.openChestSlots?.[kind.chest];
    return null;
  }
  setSlot(kind, val) {
    if (kind.hotbar != null) this.inv.slots[kind.hotbar] = val;
    else if (kind.inv != null) this.inv.slots[kind.inv] = val;
    else if (kind.armor != null) this.inv.armor[kind.armor] = val;
    else if (kind.acc != null) this.inv.accessories[kind.acc] = val;
    else if (kind.hand === 'mainhand') this.inv.slots[this.inv.selected] = val;  // mirror → write the held slot
    else if (kind.hand != null) this.inv.hands[kind.hand] = val;
    else if (kind.chest != null && this.openChestSlots) this.openChestSlots[kind.chest] = val;
  }
  // can this stack go into this slot kind?
  accepts(kind, stack) {
    if (!stack) return true;
    if (kind.armor != null) return this.inv.slotAccepts(kind.armor, stack.id);
    if (kind.acc != null) return this.inv.slotAccepts('accessory', stack.id);
    if (kind.hand != null) return this.inv.slotAccepts(kind.hand, stack.id);
    return true;
  }

  // ---- pointer drag & drop ------------------------------------------------------
  onSlotDown(e, kind) {
    e.preventDefault();
    // selecting a hotbar slot when the panel is closed
    if (!this.open) {
      if (kind.hotbar != null) { this.inv.selected = kind.hotbar; this.inv.changed(); }
      return;
    }
    // main hand is a read-only mirror of the selected hotbar slot — press 1-0 to change it
    if (kind.hand === 'mainhand') { e.preventDefault(); return; }
    const stack = this.getSlot(kind);
    // shift-click: quick actions (equip / sell / stash) — but not while carrying a cursor stack
    if (e.shiftKey && stack && !this.cursorStack) { this.quickMove(kind, stack); return; }
    // right-click: pick up half (or place one from cursor)
    if (e.button === 2) { this.rightClick(kind); return; }

    if (this.cursorStack) {
      // placing the held stack into this slot
      this.placeCursorInto(kind);
    } else if (stack) {
      // pick up → start drag
      if (!this.accepts({}, stack)) return;
      this.cursorStack = stack; this.setSlot(kind, null);
      this.dragging = true;
      this.updateCursorEl(e.clientX, e.clientY);
    }
    this.inv.changed();
  }

  placeCursorInto(kind) {
    const cur = this.cursorStack;
    if (!this.accepts(kind, cur)) return;   // wrong equip slot: reject silently
    const target = this.getSlot(kind);
    if (!target) {
      this.setSlot(kind, cur); this.cursorStack = null;
    } else if (target.id === cur.id && kind.armor == null && kind.acc == null && kind.hand == null) {
      const max = ITEMS[target.id].stack ?? 9999;
      const take = Math.min(max - target.count, cur.count);
      target.count += take; cur.count -= take;
      if (cur.count <= 0) this.cursorStack = null;
    } else {
      // swap (only if target fits where cursor came from — for equip slots target is armor/acc,
      // and cursor must be that type, which accepts() already checked)
      if ((kind.armor != null || kind.acc != null || kind.hand != null) && !this.accepts(kind, cur)) return;
      this.setSlot(kind, cur); this.cursorStack = target;
    }
    this.dragging = !!this.cursorStack;   // a swap leaves the old item on the cursor — keep dragging it
    if (!this.cursorStack) this.els.cursor.style.display = 'none';
    this.game.audio?.play('uiClick', { volume: 0.35 });
  }

  rightClick(kind) {
    const stack = this.getSlot(kind);
    if (this.cursorStack && (!stack || stack.id === this.cursorStack.id)) {
      if (!this.accepts(kind, this.cursorStack)) return;   // don't deposit into an equip slot that rejects this item
      // drop one from cursor
      if (stack) stack.count++; else this.setSlot(kind, { id: this.cursorStack.id, count: 1 });
      if (--this.cursorStack.count <= 0) { this.cursorStack = null; this.els.cursor.style.display = 'none'; }
    } else if (stack && !this.cursorStack) {
      // pick up half
      const half = Math.ceil(stack.count / 2);
      this.cursorStack = { id: stack.id, count: half };
      stack.count -= half;
      if (stack.count <= 0) this.setSlot(kind, null);
      this.dragging = true;
    }
    this.inv.changed();
  }

  quickMove(kind, stack) {
    const def = ITEMS[stack.id];
    // to/from chest if open
    if (this.openChestSlots && kind.chest == null) {
      // stash into chest
      for (let i = 0; i < this.openChestSlots.length; i++) {
        if (!this.openChestSlots[i]) { this.openChestSlots[i] = stack; this.setSlot(kind, null); this.inv.changed(); return; }
      }
    }
    if (kind.chest != null) { // take from chest
      const left = this.inv.add(stack.id, stack.count);
      this.setSlot(kind, left > 0 ? { id: stack.id, count: left } : null); this.inv.changed(); return;
    }
    // sell if shop open
    if (this.shopOpen) {
      const unit = Math.max(1, Math.floor((def.value ?? 0) / 5));
      this.inv.money += unit * stack.count; this.setSlot(kind, null);
      this.game.audio?.play('coins', { volume: 0.7 }); this.inv.changed(); return;
    }
    // equip armor
    if (def.type === 'armor') { this.autoEquip(kind, stack, def.bodySlot); return; }
    if (def.type === 'accessory') { this.autoEquipAcc(kind, stack); return; }
    this.game.audio?.play('uiClick', { volume: 0.3 });
  }

  autoEquip(fromKind, stack, bodySlot) {
    const prev = this.inv.armor[bodySlot];
    this.inv.armor[bodySlot] = stack; this.setSlot(fromKind, prev ?? null);
    this.game.audio?.play('powerup', { volume: 0.4 }); this.inv.changed(); this.drawDoll();
  }
  autoEquipAcc(fromKind, stack) {
    const idx = this.inv.accessories.findIndex(a => !a);
    if (idx < 0) { this.game.audio?.play('uiClick', { volume: 0.3 }); return; }   // all 5 slots full — leave it in the bag
    const prev = this.inv.accessories[idx];
    this.inv.accessories[idx] = stack; this.setSlot(fromKind, prev ?? null);
    this.game.audio?.play('powerup', { volume: 0.4 }); this.inv.changed();
  }

  onPointerMove(e) {
    if (this.cursorStack) this.updateCursorEl(e.clientX, e.clientY);
    if (this.els.tip.style.display === 'block') { this.els.tip.style.left = `${e.clientX + 16}px`; this.els.tip.style.top = `${e.clientY + 12}px`; }
    // drop-highlight
    if (this.dragging) {
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest('.us-slot');
      [...document.querySelectorAll('.us-slot.drop-hi')].forEach(s => s.classList.remove('drop-hi'));
      if (under) under.classList.add('drop-hi');
    }
  }

  onPointerUp(e) {
    [...document.querySelectorAll('.us-slot.drop-hi')].forEach(s => s.classList.remove('drop-hi'));
    if (!this.dragging || !this.cursorStack) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const under = el?.closest('.us-slot');
    if (under) {
      const kind = JSON.parse(under.dataset.kind);
      this.placeCursorInto(kind);
      this.inv.changed();
    } else if (el?.closest('#game')) {
      // released over the GAME canvas (not over any HUD panel/vitals) → drop item into the world
      this.game.drops.spawn(this.cursorStack.id, this.cursorStack.count, this.player.x, this.player.y);
      this.cursorStack = null; this.els.cursor.style.display = 'none';
      this.inv.changed();
    }
    // released over other HUD chrome (vitals, etc.) → keep the item on the cursor, don't lose it
    this.dragging = false;
    if (!this.cursorStack) this.els.cursor.style.display = 'none';
  }

  updateCursorEl(x, y) {
    const c = this.els.cursor;
    c.style.display = 'block';
    c.style.left = `${x - 20}px`;
    c.style.top = `${y - 20}px`;
    c.innerHTML = iconImgHTML(this.cursorStack.id) + (this.cursorStack.count > 1 ? `<span class="cnt">${this.cursorStack.count}</span>` : '');
  }

  // ---- chest / shop -------------------------------------------------------------
  openChest(tx, ty) {
    const chests = this.game.world.chests; if (!chests) return;
    this.openChestSlots = chests.ensure(tx, ty);
    this.els.chestWrap.style.display = '';
    this.els.chest.innerHTML = '';
    for (let i = 0; i < this.openChestSlots.length; i++) this.els.chest.appendChild(this.makeSlot({ chest: i }));
    if (!this.open) this.toggle(true); else this.refreshSlots();
  }

  closeChest() {
    this.openChestSlots = null;
    this.els.chestWrap.style.display = 'none';
    this.shopOpen = false;
    const sw = document.getElementById('us-shop-wrap'); if (sw) sw.style.display = 'none';
  }

  async openShop(npc) {
    const { SHOPS } = await import('../entities/npc.js');
    const stock = SHOPS[npc.type] ?? SHOPS.merchant;
    const wrap = document.getElementById('us-shop-wrap');
    const list = document.getElementById('us-shop');
    document.getElementById('us-shop-title').textContent = npc.name;
    this.shopOpen = true;
    list.innerHTML = `<div class="rc-ing" style="padding:0 4px 8px">Shift-click your items to sell (⅕ value)</div>`;
    for (const [id, price] of stock) {
      const el = document.createElement('div');
      el.className = 'us-recipe';
      const g = Math.floor(price / 10000), s = Math.floor((price % 10000) / 100), c = price % 100;
      const p = [g && `${g}g`, s && `${s}s`, c && `${c}c`].filter(Boolean).join(' ');
      el.innerHTML = `<div class="rc-icon">${iconFor(id)}</div><div><div class="rc-name">${ITEMS[id].name}</div><div class="rc-ing">${p}</div></div>`;
      el.addEventListener('mousedown', () => {
        if (this.inv.money < price) { this.game.audio?.play('uiClick', { volume: 0.3, rate: 0.7 }); return; }
        this.inv.money -= price; this.inv.add(id, 1); this.game.audio?.play('coins', { volume: 0.6 });
      });
      list.appendChild(el);
    }
    wrap.style.display = '';
    if (!this.open) this.toggle(true);
  }

  // ---- rendering ---------------------------------------------------------------
  refreshSlots() {
    const fill = (el) => {
      const kind = JSON.parse(el.dataset.kind);
      const s = this.getSlot(kind);
      const key = el.querySelector('.key')?.outerHTML ?? '';
      if (kind.hotbar != null) el.classList.toggle('sel', kind.hotbar === this.inv.selected);
      if ((kind.armor != null || kind.acc != null || kind.hand != null) && !s) {
        const ph = kind.armor != null ? ({ head: '🪖', chest: '🛡️', legs: '👖', feet: '🥾' }[kind.armor])
          : kind.hand === 'mainhand' ? '⚔️' : kind.hand === 'offhand' ? '🔦' : '💍';
        el.innerHTML = `<span class="icon" style="background:transparent;color:#4a5478;font-size:14px">${ph}</span>`;
        return;
      }
      el.innerHTML = key + (s ? `${iconFor(s.id)}${s.count > 1 ? `<span class="cnt">${s.count}</span>` : ''}` : '');
    };
    [...this.els.hotbar.children].forEach(fill);
    [...this.els.main.children].forEach(fill);
    [...this.els.armor.children].filter(c => c.classList.contains('us-slot')).forEach(fill);
    [...this.els.acc.children].forEach(fill);
    [...this.els.hands.querySelectorAll('.us-slot')].forEach(fill);
    if (this.openChestSlots) [...this.els.chest.children].forEach(fill);

    // coins
    const g = Math.floor(this.inv.money / 10000), s = Math.floor((this.inv.money % 10000) / 100), c = this.inv.money % 100;
    const coin = (n, col, lab) => (n > 0 || lab === 'copper') ? `<span class="coin" title="${lab}"><i style="background:${col}"></i>${n}</span>` : '';
    this.els.money.innerHTML = coin(g, 'linear-gradient(135deg,#ffe08a,#c8952a)', 'gold') +
      coin(s, 'linear-gradient(135deg,#f0f0f5,#8a8a9a)', 'silver') + coin(c, 'linear-gradient(135deg,#e8a06a,#8a5028)', 'copper');
    const held = this.inv.held();
    this.els.heldName.textContent = held ? ITEMS[held.id].name : '';
    if (this.open) { this.drawDoll(); this.updateStats(); }
  }

  updateStats() {
    const def = this.inv.defense();
    const acc = this.inv.accessoryEffects();
    const cb = this.inv.classBonus();
    const bits = [`<b style="color:#8ac8e8">Defense ${def}</b>`];
    if (acc.moveSpeed > 1) bits.push(`+${Math.round((acc.moveSpeed - 1) * 100)}% speed`);
    if (acc.regen) bits.push(`+${acc.regen} HP/s regen`);
    if (acc.extraJumps) bits.push(`+${acc.extraJumps} jump`);
    if (acc.noFallDamage) bits.push(`no fall damage`);
    if (acc.critBonus) bits.push(`+${Math.round(acc.critBonus * 100)}% crit`);
    if (cb.meleeDmg > 1) bits.push(`+${Math.round((cb.meleeDmg - 1) * 100)}% melee (set)`);
    if (cb.rangedDmg > 1) bits.push(`+${Math.round((cb.rangedDmg - 1) * 100)}% ranged (set)`);
    if (cb.magicDmg > 1) bits.push(`+${Math.round((cb.magicDmg - 1) * 100)}% magic (set)`);
    if (cb.meleeSpeed < 1) bits.push(`+${Math.round((1 - cb.meleeSpeed) * 100)}% swing speed (set)`);
    this.els.stats.innerHTML = bits.join('<br>');
  }

  drawDoll() {
    const cvs = this.els.dollCanvas; if (!cvs) return;
    const ctx = cvs.getContext('2d');
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    // pick the armored hero variant matching the equipped chest
    const VAR = { copper: 'heroCopper', iron: 'heroIron', silver: 'heroSilver', gold: 'heroGold', shadow: 'heroShadow', molten: 'heroMolten' };
    let name = 'hero';
    const chest = this.inv.armor.chest;
    if (chest) { const p = chest.id.replace(/(Chainmail|Breastplate|Scalemail|Shirt|Jerkin).*/, ''); if (VAR[p]) name = VAR[p]; }
    const rec = character(name) ?? character('hero');
    const img = rec?.anims?.['breathing-idle']?.[0] ?? rec?.base;
    ctx.imageSmoothingEnabled = false;
    if (img) {
      const c = rec.content ?? { x: 0, y: 0, w: img.width, h: img.height };
      const scale = 108 / c.h;
      const dw = img.width * scale, dh = img.height * scale;
      ctx.drawImage(img, (cvs.width - dw) / 2, (cvs.height - dh) / 2 + 6, dw, dh);
    } else {
      // silhouette fallback
      ctx.fillStyle = '#3a6ea5'; ctx.fillRect(30, 40, 24, 44);
      ctx.fillStyle = '#c8956c'; ctx.fillRect(32, 20, 20, 20);
      ctx.fillStyle = '#2d4739'; ctx.fillRect(32, 84, 8, 28); ctx.fillRect(44, 84, 8, 28);
    }
  }

  refreshCrafting() {
    const stations = nearbyStations(this.game.world, this.player);
    // recipe book shows ALL recipes; craftable-and-in-reach are bright, others dimmed
    let list = RECIPES.filter(r => {
      const def = ITEMS[r.out];
      if (this.search && !def.name.toLowerCase().includes(this.search)) return false;
      if (this.category !== 'all') {
        if (this.category === 'station') return !!TILES[T[def.placeTile]]?.station;
        if (this.category === 'weapon') return def.type === 'weapon';
        if (this.category === 'block') return def.type === 'block' && !TILES[T[def.placeTile]]?.station;
        return def.type === this.category;
      }
      return true;
    }).map(r => {
      const stationOk = !r.station || stations.has(r.station);
      const hasAll = Object.entries(r.ing).every(([id, n]) => this.inv.count(id) >= n);
      return { r, canCraft: stationOk && hasAll, stationOk };
    });
    list.sort((a, b) => (b.canCraft ? 1 : 0) - (a.canCraft ? 1 : 0));
    const key = this.category + '|' + this.search + '|' + list.map(x => x.r.out + (x.canCraft ? 1 : 0) + (x.stationOk ? 1 : 0)).join(',');
    if (key === this.lastCraftKey) return;
    this.lastCraftKey = key;
    this.els.craft.innerHTML = list.length ? '' : `<div class="rc-ing" style="padding:8px">No recipes match.</div>`;
    for (const { r, canCraft, stationOk } of list.slice(0, 120)) {
      const el = document.createElement('div');
      el.className = `us-recipe ${canCraft ? '' : 'no'}`;
      const ing = Object.entries(r.ing).map(([id, n]) => {
        const have = this.inv.count(id);
        return `<span class="${have >= n ? 'have' : 'miss'}">${have}/${n} ${ITEMS[id].name}</span>`;
      }).join(', ');
      const stationTag = r.station && !stationOk ? ` <span class="miss">(needs ${r.station})</span>` : '';
      el.innerHTML = `<div class="rc-icon">${iconFor(r.out)}</div><div><div class="rc-name">${ITEMS[r.out].name}${r.n > 1 ? ` ×${r.n}` : ''}</div><div class="rc-ing">${ing}${stationTag}</div></div>`;
      if (canCraft) el.addEventListener('mousedown', () => {
        const res = craft(this.inv, r);
        if (res && res.leftover) this.game.drops.spawn(r.out, res.leftover, this.player.x, this.player.y);
        this.game.audio?.play('craft', { volume: 0.6 });
        this.lastCraftKey = ''; this.refreshCrafting();
      });
      this.els.craft.appendChild(el);
    }
  }

  // ---- tooltip -----------------------------------------------------------------
  showTip(kind) {
    const s = this.getSlot(kind);
    if (!s) return this.hideTip();
    const def = ITEMS[s.id];
    const rc = rarityClass(def);
    const rcColor = { 'r-uncommon': '#6de86d', 'r-rare': '#5ab4ff', 'r-epic': '#b968ff', 'r-legendary': '#ffb43c' }[rc] ?? '#e8e8f0';
    const lines = [];
    if (def.damage) lines.push(`${def.damage} damage${def.element ? ` · ${def.element}` : ''}`);
    if (def.mana) lines.push(def.use === 'mana' ? `restores ${def.mana} mana` : `${def.mana} mana`);
    if (def.pickPower) lines.push(`${def.pickPower}% pickaxe power`);
    if (def.axePower) lines.push(`${def.axePower}% axe power`);
    if (def.hammerPower) lines.push(`${def.hammerPower}% hammer power`);
    if (def.defense) lines.push(`${def.defense} defense`);
    if (def.bodySlot) lines.push(`Equip: ${def.bodySlot}`);
    if (def.accessory) {
      const a = def.accessory;
      if (a.moveSpeed) lines.push(`+${Math.round((a.moveSpeed - 1) * 100)}% movement speed`);
      if (a.regen) lines.push(`+${a.regen} life regen`);
      if (a.extraJumps) lines.push(`+${a.extraJumps} extra jump`);
      if (a.defense) lines.push(`+${a.defense} defense`);
      if (a.critBonus) lines.push(`+${Math.round(a.critBonus * 100)}% crit`);
      if (a.noFallDamage) lines.push(`immune to fall damage`);
    }
    if (def.heal) lines.push(`heals ${def.heal} HP`);
    if (def.placeTile || def.placeWall) lines.push('Can be placed');
    if (s.mod) lines.unshift(`<span style="color:#ffd75a">${s.mod.name}</span> modifier`);
    this.els.tip.innerHTML = `<div class="t-name" style="color:${rcColor}">${def.name}</div>` + lines.map(l => `<div class="t-line">${l}</div>`).join('');
    this.els.tip.style.display = 'block';
  }
  hideTip() { this.els.tip.style.display = 'none'; }

  // ---- vitals tick -------------------------------------------------------------
  heartSvg(frac, i) {
    const gid = `us-hg-${i}`;
    const fill = frac >= 1 ? '#d5223a' : frac > 0 ? `url(#${gid})` : '#3a2030';
    const grad = frac > 0 && frac < 1
      ? `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="${frac}" stop-color="#d5223a"/><stop offset="${frac}" stop-color="#3a2030"/></linearGradient></defs>` : '';
    return `<span class="us-heart"><svg width="20" height="20" viewBox="0 0 16 16">${grad}<path d="M8 14 L2.5 8.5 Q0.5 6.5 1.5 4 Q2.5 1.5 5 2 Q7 2.5 8 4.5 Q9 2.5 11 2 Q13.5 1.5 14.5 4 Q15.5 6.5 13.5 8.5 Z" fill="${fill}" stroke="#e8b84a" stroke-width="1.1"/></svg></span>`;
  }

  tick() {
    const p = this.player;
    const hearts = Math.ceil(p.hpMax / 20), full = p.hp / 20;
    let html = '';
    for (let i = 0; i < hearts; i++) html += this.heartSvg(Math.max(0, Math.min(1, full - i)), i);
    if (this._lastHearts !== html) { this.els.hearts.innerHTML = html; this._lastHearts = html; }
    const stars = Math.ceil(p.manaMax / 20), manaFrac = p.mana / p.manaMax;
    let mhtml = '';
    for (let i = 0; i < stars; i++) {
      const on = (i + 1) / stars <= manaFrac + 0.001;
      mhtml += `<span class="us-star" style="opacity:${on ? 1 : 0.3}"><svg width="15" height="15" viewBox="0 0 16 16"><path d="M8 1 L10 6 L15 6.2 L11 9.6 L12.4 15 L8 11.8 L3.6 15 L5 9.6 L1 6.2 L6 6 Z" fill="#5ac8f0" stroke="#2a6a9a" stroke-width="1"/></svg></span>`;
    }
    if (this._lastMana !== mhtml) { this.els.mana.innerHTML = mhtml; this._lastMana = mhtml; }
    if (this.open) this.refreshCrafting();
  }
}
