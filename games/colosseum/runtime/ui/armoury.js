// Colosseum — the Armoury.
//
// A DOM overlay rather than canvas UI, matching the ForgeFlow convention: it
// gets real text rendering, accessibility and hit-testing for free, and it
// composites over the live 3D scene so the PAPER DOLL is the actual fighter
// standing in the actual arena, turning slowly, wearing exactly what you just
// bought. That is the whole point — a purchase has to be visible immediately
// or the gold loop feels like a spreadsheet.
//
// Layout follows the pattern good equipment screens share (Dark Souls' load
// gauge, Kingdom Come's layered kit, Mount & Blade's stat deltas):
//   left   — equipped slots, click to unequip
//   centre — the live fighter + carried-weight gauge
//   right  — the shop list, grouped, with a stat delta on hover
//
// The critical UX rule: NEVER show a bare stat. Show the DELTA against what is
// already worn, because the only question the player is actually asking is
// "is this better than what I have on?"

import { SLOT_ORDER } from "../sim/inventory.js";

const GOLD = "#d8ad4e";
const STONE = "#c9b891";
const BLOOD = "#8e2f22";

const SLOT_LABEL = {
  weapon: "Weapon", shield: "Shield", helmet: "Helm",
  arm: "Arm", legs: "Legs", torso: "Body",
};

const KIND_LABEL = { weapon: "Arms", shield: "Shields", armour: "Armour" };

export class Armoury {
  /**
   * @param {HTMLElement} root  the #hud overlay
   * @param {Inventory} inv
   * @param {object} hooks { onEquip(slot,id), onClose(), onPreviewRotate(bool) }
   */
  constructor(root, inv, hooks = {}) {
    this.root = root;
    this.inv = inv;
    this.hooks = hooks;
    this.open = false;
    this.hovered = null;
    this.el = null;
    this._build();
  }

  _build() {
    const el = document.createElement("div");
    el.id = "armoury";
    el.style.cssText = `position:absolute;inset:0;display:none;pointer-events:auto;
      font-family:Georgia,'Times New Roman',serif;color:${STONE};z-index:40;
      background:linear-gradient(90deg,rgba(12,8,5,.94) 0%,rgba(12,8,5,.55) 32%,rgba(12,8,5,.55) 62%,rgba(12,8,5,.94) 100%);`;
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:300px 1fr 380px;height:100%;gap:0">

        <!-- worn -->
        <div style="padding:22px 18px;overflow-y:auto;border-right:1px solid rgba(216,173,78,.22)">
          <div style="font-size:11px;letter-spacing:5px;color:#8a7a5e">ARMOURY</div>
          <div id="am-title" style="font-size:27px;color:${GOLD};margin:2px 0 4px">Your Kit</div>
          <div id="am-armatura" style="font-size:12px;color:#9c8760;font-style:italic;margin-bottom:16px"></div>
          <div id="am-slots"></div>
          <div id="am-mob" style="margin-top:20px;padding-top:14px;border-top:1px solid rgba(216,173,78,.2);font-size:12px;line-height:1.85"></div>
        </div>

        <!-- paper doll (the live 3D fighter shows through) -->
        <div style="position:relative;pointer-events:none">
          <div style="position:absolute;top:20px;left:0;right:0;text-align:center">
            <div id="am-rank" style="font-size:12px;letter-spacing:4px;color:#9c8760"></div>
          </div>
          <div style="position:absolute;bottom:22px;left:0;right:0;text-align:center">
            <div id="am-weight" style="font-size:12px;color:#9c8760"></div>
            <div style="width:280px;height:7px;margin:8px auto 0;background:#1d150d;border:1px solid rgba(216,173,78,.35)">
              <div id="am-weightbar" style="height:100%;width:0%;background:linear-gradient(90deg,#4e7a3a,#c8a03a 60%,${BLOOD})"></div>
            </div>
            <div style="font-size:10px;color:#6f6047;margin-top:5px;letter-spacing:2px">MOBILITY &nbsp;&mdash;&nbsp; PROTECTION</div>
          </div>
        </div>

        <!-- shop -->
        <div style="padding:22px 18px;overflow-y:auto;border-left:1px solid rgba(216,173,78,.22)">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <div style="font-size:11px;letter-spacing:5px;color:#8a7a5e">MERCATOR</div>
            <div id="am-gold" style="font-size:20px;color:${GOLD}"></div>
          </div>
          <div id="am-shop" style="margin-top:14px"></div>
        </div>
      </div>

      <div id="am-tip" style="position:absolute;pointer-events:none;display:none;
        background:rgba(8,6,4,.97);border:1px solid ${GOLD};padding:11px 13px;
        font-size:12px;line-height:1.65;max-width:290px;z-index:60"></div>

      <div style="position:absolute;top:16px;right:22px;pointer-events:auto">
        <button id="am-close" style="background:none;border:1px solid rgba(216,173,78,.5);
          color:${GOLD};padding:7px 17px;font-family:inherit;font-size:12px;
          letter-spacing:2px;cursor:pointer">CLOSE  [TAB]</button>
      </div>`;
    this.root.appendChild(el);
    this.el = el;

    el.querySelector("#am-close").onclick = () => this.hide();
    this.tip = el.querySelector("#am-tip");
  }

  show() {
    this.open = true;
    this.el.style.display = "block";
    this.render();
    if (this.hooks.onPreviewRotate) this.hooks.onPreviewRotate(true);
  }

  hide() {
    this.open = false;
    this.el.style.display = "none";
    this._hideTip();
    if (this.hooks.onPreviewRotate) this.hooks.onPreviewRotate(false);
    if (this.hooks.onClose) this.hooks.onClose();
  }

  toggle() { this.open ? this.hide() : this.show(); }

  // -- rendering ----------------------------------------------------------

  render() {
    if (!this.open) return;
    const inv = this.inv;
    const mob = inv.mobility();
    const rank = inv.rank();
    const arm = inv.matchedArmatura();

    this.el.querySelector("#am-gold").textContent = `${inv.gold} aurei`;
    this.el.querySelector("#am-rank").textContent = `${rank.name.toUpperCase()} — ${rank.title.toUpperCase()}`;
    this.el.querySelector("#am-armatura").textContent = arm
      ? `Fighting as a ${arm.name} — ${arm.desc}`
      : "A kit of your own devising.";

    // --- worn slots -----------------------------------------------------
    const slots = this.el.querySelector("#am-slots");
    slots.innerHTML = "";
    for (const slot of SLOT_ORDER) {
      const id = inv.equipped[slot];
      const item = id && id !== "none" ? this._itemDef(slot, id) : null;
      const row = document.createElement("div");
      row.style.cssText = `display:flex;justify-content:space-between;align-items:center;
        padding:9px 11px;margin-bottom:6px;border:1px solid rgba(216,173,78,${item ? ".38" : ".14"});
        background:rgba(${item ? "50,36,18,.5" : "20,15,10,.35"});cursor:${item ? "pointer" : "default"}`;
      row.innerHTML = `
        <span style="font-size:10px;letter-spacing:2px;color:#8a7a5e;width:52px">${SLOT_LABEL[slot].toUpperCase()}</span>
        <span style="flex:1;text-align:right;color:${item ? STONE : "#584c3a"};font-size:13px">${item ? item.name : "—"}</span>`;
      if (item) {
        row.onclick = () => { this._equip(slot, null); };
        row.title = "Click to remove";
      }
      slots.appendChild(row);
    }

    // --- mobility readout ------------------------------------------------
    this.el.querySelector("#am-mob").innerHTML = `
      ${this._stat("Carrying", `${mob.weight} kg`)}
      ${this._stat("Speed", `${mob.moveSpeed} m/s`)}
      ${this._stat("Stamina", `${mob.staminaMax}`)}
      ${this._stat("Recovery", `${mob.staminaRegen}/s`)}
      ${this._stat("Dodge", `${mob.dodgeDistance} m`)}`;

    const loadPct = Math.min(100, (mob.weight / 26) * 100);
    this.el.querySelector("#am-weightbar").style.width = `${loadPct}%`;
    this.el.querySelector("#am-weight").textContent =
      `${mob.weight} kg carried · ${mob.moveSpeed} m/s`;

    // --- shop -------------------------------------------------------------
    const shop = this.el.querySelector("#am-shop");
    shop.innerHTML = "";
    const cat = inv.catalogue();
    for (const kind of ["weapon", "shield", "armour"]) {
      const items = cat.filter((c) => c.kind === kind);
      if (!items.length) continue;
      const h = document.createElement("div");
      h.style.cssText = "font-size:10px;letter-spacing:3px;color:#8a7a5e;margin:16px 0 7px";
      h.textContent = KIND_LABEL[kind].toUpperCase();
      shop.appendChild(h);
      for (const it of items) shop.appendChild(this._shopRow(it));
    }
  }

  _stat(k, v) {
    return `<div style="display:flex;justify-content:space-between">
      <span style="color:#8a7a5e">${k}</span><span style="color:${STONE}">${v}</span></div>`;
  }

  _itemDef(slot, id) {
    return this.inv.catalogue().find((c) => c.id === id && c.slot === slot) || { name: id };
  }

  _shopRow(it) {
    const row = document.createElement("div");
    const state = it.equipped ? "equipped" : it.owned ? "owned" : it.affordable ? "buy" : "poor";
    const border = { equipped: GOLD, owned: "rgba(216,173,78,.4)", buy: "rgba(216,173,78,.25)", poor: "rgba(120,100,70,.15)" }[state];
    const nameCol = state === "poor" ? "#6b5c46" : STONE;

    row.style.cssText = `display:flex;justify-content:space-between;align-items:center;
      padding:9px 11px;margin-bottom:5px;border:1px solid ${border};
      background:rgba(${it.equipped ? "62,45,20,.55" : "18,13,9,.5"});
      cursor:${state === "poor" ? "not-allowed" : "pointer"}`;

    const right = it.equipped ? `<span style="color:${GOLD};font-size:10px;letter-spacing:2px">WORN</span>`
      : it.owned ? `<span style="color:#7d9c60;font-size:10px;letter-spacing:2px">EQUIP</span>`
      : `<span style="color:${it.affordable ? GOLD : "#6b5c46"};font-size:13px">${it.price}</span>`;

    row.innerHTML = `<span style="color:${nameCol};font-size:13px">${it.name}</span>${right}`;

    row.onmouseenter = (e) => this._showTip(e, it);
    row.onmousemove = (e) => this._moveTip(e);
    row.onmouseleave = () => this._hideTip();
    row.onclick = () => {
      if (state === "poor") return;
      if (!it.owned) {
        const r = this.inv.buy(it.kind, it.id);
        if (!r.ok) return;
      }
      this._equip(it.slot, it.id);
    };
    return row;
  }

  _equip(slot, id) {
    const r = this.inv.equip(slot, id);
    if (!r.ok) return;
    // Push the change into the 3D fighter immediately — this is what makes a
    // purchase feel real rather than bookkeeping.
    if (this.hooks.onEquip) this.hooks.onEquip(slot, id, this.inv);
    this.inv.save();
    this.render();
  }

  // -- tooltip ------------------------------------------------------------

  _showTip(e, it) {
    const t = this.tip;
    let rows = Object.entries(it.stats || {})
      .map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:18px">
        <span style="color:#8a7a5e">${k}</span><span>${v}</span></div>`).join("");

    // The delta against what is currently worn — the only comparison that
    // actually answers the player's question.
    if (!it.equipped) {
      const p = this.inv.previewEquip(it.slot, it.id);
      const fmt = (v, unit = "", goodIsUp = true) => {
        if (Math.abs(v) < 0.005) return `<span style="color:#6f6047">—</span>`;
        const good = goodIsUp ? v > 0 : v < 0;
        return `<span style="color:${good ? "#7d9c60" : "#b5563f"}">${v > 0 ? "+" : ""}${v}${unit}</span>`;
      };
      rows += `<div style="margin-top:9px;padding-top:8px;border-top:1px solid rgba(216,173,78,.22)">
        <div style="display:flex;justify-content:space-between;gap:18px"><span style="color:#8a7a5e">Speed</span>${fmt(p.delta.moveSpeed, " m/s")}</div>
        <div style="display:flex;justify-content:space-between;gap:18px"><span style="color:#8a7a5e">Stamina</span>${fmt(p.delta.staminaMax)}</div>
        <div style="display:flex;justify-content:space-between;gap:18px"><span style="color:#8a7a5e">Recovery</span>${fmt(p.delta.staminaRegen, "/s")}</div>
        <div style="display:flex;justify-content:space-between;gap:18px"><span style="color:#8a7a5e">Load</span>${fmt(p.delta.weight, " kg", false)}</div>
      </div>`;
    }

    t.innerHTML = `<div style="color:${GOLD};font-size:14px;margin-bottom:5px">${it.name}</div>
      <div style="color:#9c8760;font-style:italic;margin-bottom:8px;font-size:11.5px">${it.desc}</div>${rows}`;
    t.style.display = "block";
    this._moveTip(e);
  }

  _moveTip(e) {
    const t = this.tip;
    const pad = 16;
    const w = t.offsetWidth || 280;
    let x = e.clientX - w - pad;
    if (x < pad) x = e.clientX + pad;
    t.style.left = `${x}px`;
    t.style.top = `${Math.min(e.clientY + 12, window.innerHeight - (t.offsetHeight || 160) - pad)}px`;
  }

  _hideTip() { if (this.tip) this.tip.style.display = "none"; }

  dispose() { if (this.el) this.el.remove(); }
}
