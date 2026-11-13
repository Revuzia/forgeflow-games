// Colosseum — the Armoury, the Smith and the Training Ground.
//
// One overlay, three tabs, because they share the same context: your purse,
// your body, and the trade-off you are about to make. Splitting them into
// separate screens would mean re-rendering the paper doll three times and
// making the player navigate to compare a purchase against a repair bill.
//
// The paper doll is the LIVE fighter standing in the arena, turning slowly,
// wearing exactly what you just bought — a purchase has to be visible
// immediately or the gold loop feels like a spreadsheet.
//
// The UX rule that governs all three tabs: NEVER show a bare number. Show the
// DELTA against what you have now, because that is the only question the player
// is actually asking.

import { SLOT_ORDER } from "../sim/inventory.js";
import { REINFORCEMENTS, conditionOf } from "../sim/blacksmith.js";
import { REGIMENS, ATTRIBUTES, ATTR_IDS, SLOTS_PER_MATCH, FATIGUE_SOFT } from "../sim/attributes.js";

const GOLD = "#d8ad4e";
const STONE = "#c9b891";
const DIM = "#9c8760";
const FAINT = "#6f6047";
const BLOOD = "#8e2f22";
const GREEN = "#7d9c60";

const SLOT_LABEL = {
  weapon: "Weapon", shield: "Shield", helmet: "Helm",
  arm: "Arm", legs: "Legs", torso: "Body",
};
const KIND_LABEL = { weapon: "Arms", shield: "Shields", armour: "Armour" };

export const TAB = { ARMS: "arms", SMITH: "smith", TRAINING: "training" };

export class Armoury {
  constructor(root, inv, hooks = {}) {
    this.root = root;
    this.inv = inv;
    this.hooks = hooks;
    this.open = false;
    this.tab = TAB.ARMS;
    this.el = null;
    this._build();
  }

  _build() {
    const el = document.createElement("div");
    el.id = "armoury";
    el.style.cssText = `position:absolute;inset:0;display:none;pointer-events:auto;
      font-family:Georgia,'Times New Roman',serif;color:${STONE};z-index:40;
      background:linear-gradient(90deg,rgba(12,8,5,.95) 0%,rgba(12,8,5,.55) 30%,rgba(12,8,5,.55) 64%,rgba(12,8,5,.95) 100%);`;
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:308px 1fr 400px;height:100%">
        <!-- left: worn + vitals -->
        <div id="am-left" style="padding:20px 18px;overflow-y:auto;border-right:1px solid rgba(216,173,78,.22)"></div>
        <!-- centre: the live fighter -->
        <div style="position:relative;pointer-events:none">
          <div style="position:absolute;top:18px;left:0;right:0;text-align:center">
            <div id="am-rank" style="font-size:12px;letter-spacing:4px;color:${DIM}"></div>
          </div>
          <div style="position:absolute;bottom:20px;left:0;right:0;text-align:center">
            <div id="am-weight" style="font-size:12px;color:${DIM}"></div>
            <div style="width:290px;height:7px;margin:8px auto 0;background:#1d150d;border:1px solid rgba(216,173,78,.35)">
              <div id="am-weightbar" style="height:100%;width:0%;background:linear-gradient(90deg,#4e7a3a,#c8a03a 60%,${BLOOD})"></div>
            </div>
            <div style="font-size:10px;color:${FAINT};margin-top:5px;letter-spacing:2px">MOBILITY &nbsp;—&nbsp; PROTECTION</div>
          </div>
        </div>
        <!-- right: the active tab -->
        <div style="display:flex;flex-direction:column;border-left:1px solid rgba(216,173,78,.22)">
          <div id="am-tabs" style="display:flex;border-bottom:1px solid rgba(216,173,78,.22)"></div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;padding:14px 18px 0">
            <div id="am-tabname" style="font-size:11px;letter-spacing:5px;color:${FAINT}"></div>
            <div id="am-gold" style="font-size:20px;color:${GOLD}"></div>
          </div>
          <div id="am-body" style="padding:12px 18px 20px;overflow-y:auto;flex:1"></div>
        </div>
      </div>
      <div id="am-tip" style="position:absolute;pointer-events:none;display:none;
        background:rgba(8,6,4,.97);border:1px solid ${GOLD};padding:11px 13px;
        font-size:12px;line-height:1.65;max-width:300px;z-index:60"></div>
      <div style="position:absolute;top:14px;right:20px;pointer-events:auto">
        <button id="am-close" style="background:none;border:1px solid rgba(216,173,78,.5);
          color:${GOLD};padding:7px 17px;font-family:inherit;font-size:12px;
          letter-spacing:2px;cursor:pointer">CLOSE  [TAB]</button>
      </div>`;
    this.root.appendChild(el);
    this.el = el;
    this.q = (s) => el.querySelector(s);
    this.tip = this.q("#am-tip");
    this.q("#am-close").onclick = () => this.hide();
  }

  // -- lifecycle -----------------------------------------------------------

  show(tab) {
    this.open = true;
    if (tab && Object.values(TAB).includes(tab)) this.tab = tab;
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

  _sfx(cue) { if (this.hooks.onSound) this.hooks.onSound(cue); }

  // -- shared chrome -------------------------------------------------------

  render() {
    if (!this.open) return;
    const inv = this.inv;
    const mob = inv.mobility();
    const rank = inv.rank();

    this.q("#am-gold").textContent = `${inv.gold} aurei`;
    this.q("#am-rank").textContent = `${rank.name.toUpperCase()} — ${rank.title.toUpperCase()}`;
    this.q("#am-weight").textContent = `${inv.weight()} kg carried · ${mob.moveSpeed} m/s`;
    this.q("#am-weightbar").style.width = `${Math.min(100, (inv.weight() / 26) * 100)}%`;

    this._renderTabs();
    this._renderLeft();
    const body = this.q("#am-body");
    body.innerHTML = "";
    this.q("#am-tabname").textContent =
      { arms: "MERCATOR", smith: "FABER", training: "LUDUS MAGISTER" }[this.tab];
    ({ arms: () => this._tabArms(body), smith: () => this._tabSmith(body), training: () => this._tabTraining(body) })[this.tab]();
  }

  _renderTabs() {
    const bar = this.q("#am-tabs");
    bar.innerHTML = "";
    for (const [id, label] of [[TAB.ARMS, "ARMS"], [TAB.SMITH, "SMITH"], [TAB.TRAINING, "TRAINING"]]) {
      const b = document.createElement("button");
      const on = this.tab === id;
      b.style.cssText = `flex:1;padding:13px 0;background:${on ? "rgba(58,42,20,.85)" : "transparent"};
        border:none;border-bottom:2px solid ${on ? GOLD : "transparent"};
        color:${on ? GOLD : DIM};font-family:inherit;font-size:11px;letter-spacing:3px;cursor:pointer`;
      b.textContent = label;
      b.onclick = () => { this.tab = id; this._sfx("click"); this.render(); };
      bar.appendChild(b);
    }
  }

  _renderLeft() {
    const inv = this.inv;
    const mob = inv.mobility();
    const arm = inv.matchedArmatura();
    const a = inv.attrs;
    const left = this.q("#am-left");
    left.innerHTML = `
      <div style="font-size:11px;letter-spacing:5px;color:#8a7a5e">YOUR KIT</div>
      <div style="font-size:13px;color:${DIM};font-style:italic;margin:6px 0 14px">${
        arm ? `Fighting as a ${arm.name}` : "A kit of your own devising."}</div>`;

    for (const slot of SLOT_ORDER) {
      const id = inv.equipped[slot];
      const item = id && id !== "none" ? this._itemDef(slot, id) : null;
      const row = document.createElement("div");
      const cond = item ? this.inv.smithy.describe(id) : null;
      row.style.cssText = `display:flex;justify-content:space-between;align-items:center;
        padding:8px 10px;margin-bottom:5px;border:1px solid rgba(216,173,78,${item ? ".36" : ".13"});
        background:rgba(${item ? "50,36,18,.5" : "20,15,10,.35"});cursor:${item ? "pointer" : "default"}`;
      row.innerHTML = `
        <span style="font-size:10px;letter-spacing:2px;color:#8a7a5e;width:50px">${SLOT_LABEL[slot].toUpperCase()}</span>
        <span style="flex:1;text-align:right">
          <span style="color:${item ? STONE : "#584c3a"};font-size:13px">${item ? item.name : "—"}</span>
          ${cond && cond.frac < 0.999 ? `<div style="font-size:10px;color:${cond.frac < 0.45 ? BLOOD : FAINT}">${cond.condition}</div>` : ""}
        </span>`;
      if (item) {
        row.onclick = () => { this._equip(slot, null); };
        row.title = "Click to remove";
      }
      left.appendChild(row);
    }

    const stats = document.createElement("div");
    stats.style.cssText = `margin-top:16px;padding-top:12px;border-top:1px solid rgba(216,173,78,.2);font-size:12px;line-height:1.8`;
    stats.innerHTML =
      this._stat("Carrying", `${inv.weight()} kg`) +
      this._stat("Speed", `${mob.moveSpeed} m/s`) +
      this._stat("Stamina", `${mob.staminaMax}`) +
      this._stat("Recovery", `${mob.staminaRegen}/s`) +
      this._stat("Dodge", `${mob.dodgeDistance} m`) +
      `<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(216,173,78,.14)"></div>` +
      ATTR_IDS.map((id) => this._stat(ATTRIBUTES[id].name, `${a.levels[id]}`)).join("") +
      this._stat("Fatigue", `<span style="color:${a.fatigue > FATIGUE_SOFT ? "#c46a2c" : STONE}">${Math.round(a.fatigue)}</span>`);
    left.appendChild(stats);
  }

  _stat(k, v) {
    return `<div style="display:flex;justify-content:space-between">
      <span style="color:#8a7a5e">${k}</span><span style="color:${STONE}">${v}</span></div>`;
  }

  _itemDef(slot, id) {
    return this.inv.catalogue().find((c) => c.id === id && c.slot === slot) || { name: id };
  }

  // -- TAB: arms -----------------------------------------------------------

  _tabArms(body) {
    const cat = this.inv.catalogue();
    for (const kind of ["weapon", "shield", "armour"]) {
      const items = cat.filter((c) => c.kind === kind);
      if (!items.length) continue;
      const h = document.createElement("div");
      h.style.cssText = `font-size:10px;letter-spacing:3px;color:#8a7a5e;margin:14px 0 7px`;
      h.textContent = KIND_LABEL[kind].toUpperCase();
      body.appendChild(h);
      for (const it of items) body.appendChild(this._shopRow(it));
    }
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
      : it.owned ? `<span style="color:${GREEN};font-size:10px;letter-spacing:2px">EQUIP</span>`
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
        this._sfx("coin");
      } else this._sfx("equip");
      this._equip(it.slot, it.id);
    };
    return row;
  }

  // -- TAB: smith ----------------------------------------------------------

  _tabSmith(body) {
    const inv = this.inv;
    const owned = [
      ...inv.owned.weapon.map((id) => ({ id, kind: "weapon" })),
      ...inv.owned.shield.filter((i) => i !== "none").map((id) => ({ id, kind: "shield" })),
      ...inv.owned.armour.map((id) => ({ id, kind: "armour" })),
    ];

    const intro = document.createElement("div");
    intro.style.cssText = `font-size:12px;color:${DIM};font-style:italic;line-height:1.6;margin-bottom:12px`;
    intro.textContent = "Steel does not last. Every reinforcement buys you one thing and costs you another — there is no free improvement here.";
    body.appendChild(intro);

    if (!owned.length) {
      const none = document.createElement("div");
      none.style.cssText = `color:${FAINT};font-size:13px`;
      none.textContent = "You own nothing worth working.";
      body.appendChild(none);
      return;
    }

    for (const { id } of owned) {
      const def = inv.catalogue().find((c) => c.id === id);
      const d = inv.smithy.describe(id);
      const c = conditionOf(d.frac);

      const card = document.createElement("div");
      card.style.cssText = `border:1px solid rgba(216,173,78,.26);background:rgba(18,13,9,.55);
        padding:11px 12px;margin-bottom:10px`;
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span style="color:${STONE};font-size:14px">${def ? def.name : id}</span>
          <span style="font-size:11px;color:${d.frac < 0.45 ? BLOOD : d.frac < 0.7 ? "#c46a2c" : GREEN}">${c.name}</span>
        </div>
        <div style="height:5px;margin:6px 0;background:#1d150d;border:1px solid rgba(216,173,78,.2)">
          <div style="height:100%;width:${(d.frac * 100).toFixed(0)}%;
            background:${d.frac < 0.45 ? BLOOD : d.frac < 0.7 ? "#c46a2c" : GREEN}"></div></div>
        <div style="font-size:11px;color:${FAINT};font-style:italic">${c.note}</div>
        ${d.reinforcements.length ? `<div style="font-size:11px;color:${GOLD};margin-top:4px">${d.reinforcements.join(" · ")}</div>` : ""}`;

      // repair
      if (d.repairCost > 0) {
        const canPay = inv.gold >= d.repairCost;
        const rb = document.createElement("button");
        rb.style.cssText = `width:100%;margin-top:8px;padding:7px;background:rgba(24,17,10,.8);
          border:1px solid ${canPay ? GOLD : "rgba(120,100,70,.3)"};color:${canPay ? GOLD : "#6b5c46"};
          font-family:inherit;font-size:12px;cursor:${canPay ? "pointer" : "not-allowed"};letter-spacing:1px`;
        rb.textContent = `Repair — ${d.repairCost} aurei`;
        if (canPay) rb.onclick = () => {
          const r = inv.smithy.repair(id, inv.gold, (n) => { inv.gold -= n; });
          if (r.ok) { this._sfx("equip"); inv.save(); this.render(); }
        };
        card.appendChild(rb);
      }

      // reinforcement paths — each shows exactly what it costs you
      const opts = inv.smithy.optionsFor(id);
      for (const o of opts) {
        const canPay = inv.gold >= o.cost && !o.maxed && d.frac >= 0.45;
        const b = document.createElement("button");
        b.style.cssText = `width:100%;margin-top:5px;padding:7px 9px;text-align:left;
          background:rgba(24,17,10,.6);border:1px solid ${canPay ? "rgba(216,173,78,.35)" : "rgba(120,100,70,.18)"};
          color:${canPay ? STONE : "#6b5c46"};font-family:inherit;font-size:12px;
          cursor:${canPay ? "pointer" : "not-allowed"}`;
        b.innerHTML = `<div style="display:flex;justify-content:space-between">
            <span>${o.name}${o.tier ? ` <span style="color:${GOLD}">${"I".repeat(o.tier)}</span>` : ""}</span>
            <span style="color:${o.maxed ? FAINT : canPay ? GOLD : "#6b5c46"}">${o.maxed ? "MAX" : o.cost}</span>
          </div>
          <div style="font-size:10.5px;color:${FAINT};margin-top:2px">${o.blurb}</div>`;
        if (canPay) b.onclick = () => {
          const r = inv.smithy.applyReinforcement(id, o.id, inv.gold, (n) => { inv.gold -= n; });
          if (r.ok) {
            this._sfx("equip");
            inv.save();
            if (this.hooks.onEquip) this.hooks.onEquip(null, null, inv);
            this.render();
          }
        };
        card.appendChild(b);
      }
      body.appendChild(card);
    }
  }

  // -- TAB: training -------------------------------------------------------

  _tabTraining(body) {
    const inv = this.inv;
    const a = inv.attrs;
    const rank = inv.rank();
    const cap = a.cap(rank.id);

    const head = document.createElement("div");
    head.style.cssText = "margin-bottom:12px";
    head.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
        <span style="font-size:13px;color:${STONE}">${a.slots} of ${SLOTS_PER_MATCH} sessions left</span>
        <span style="font-size:12px;color:${a.fatigue > FATIGUE_SOFT ? "#c46a2c" : DIM}">fatigue ${Math.round(a.fatigue)}</span>
      </div>
      <div style="height:6px;background:#1d150d;border:1px solid rgba(216,173,78,.25)">
        <div style="height:100%;width:${a.fatigue}%;background:linear-gradient(90deg,${GREEN},#c8a03a 55%,${BLOOD})"></div></div>
      <div style="font-size:11px;color:${FAINT};font-style:italic;margin-top:6px">
        ${a.fatigue > FATIGUE_SOFT
          ? "You are carrying fatigue onto the sand. Trained strength you cannot use is worth nothing — rest before a hard bout."
          : "Fresh. Train hard, but leave something in the tank."}</div>`;
    body.appendChild(head);

    // attribute progress
    const attrs = document.createElement("div");
    attrs.style.cssText = "padding:10px 0;border-top:1px solid rgba(216,173,78,.18);border-bottom:1px solid rgba(216,173,78,.18);margin-bottom:12px";
    for (const id of ATTR_IDS) {
      const p = a.progress(id);
      const atCap = a.levels[id] >= cap;
      const eff = a.effective(id);
      const row = document.createElement("div");
      row.style.cssText = "margin-bottom:7px";
      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;font-size:12px">
          <span style="color:${DIM}">${ATTRIBUTES[id].name} <span style="color:${FAINT};font-style:italic">${ATTRIBUTES[id].latin}</span></span>
          <span style="color:${STONE}">${a.levels[id]}${eff < a.levels[id] - 0.05 ? ` <span style="color:#c46a2c">→ ${eff.toFixed(1)}</span>` : ""}
            <span style="color:${FAINT};font-size:10.5px"> / ${cap}</span></span>
        </div>
        <div style="height:4px;margin-top:3px;background:#1d150d">
          <div style="height:100%;width:${atCap ? 100 : (p.frac * 100).toFixed(0)}%;background:${atCap ? FAINT : GOLD}"></div></div>
        <div style="font-size:10.5px;color:${FAINT};margin-top:2px">${ATTRIBUTES[id].effect}</div>`;
      attrs.appendChild(row);
    }
    if (ATTR_IDS.every((id) => a.levels[id] >= cap)) {
      const note = document.createElement("div");
      note.style.cssText = `font-size:11px;color:#c46a2c;font-style:italic;margin-top:4px`;
      note.textContent = `Everything is at the ceiling for a ${rank.name}. Win bouts to raise it.`;
      attrs.appendChild(note);
    }
    body.appendChild(attrs);

    // regimens
    for (const r of Object.values(REGIMENS)) {
      const affordable = inv.gold >= r.gold;
      const hasSlot = a.slots > 0;
      const gainsAtCap = Object.keys(r.gives).length > 0 &&
        Object.keys(r.gives).every((k) => a.levels[k] >= cap);
      const usable = affordable && hasSlot && !gainsAtCap;

      const b = document.createElement("button");
      b.style.cssText = `display:block;width:100%;text-align:left;padding:10px 11px;margin-bottom:7px;
        background:rgba(${r.fatigue < 0 ? "20,30,18,.6" : "18,13,9,.55"});
        border:1px solid ${usable ? "rgba(216,173,78,.34)" : "rgba(120,100,70,.16)"};
        color:${usable ? STONE : "#6b5c46"};font-family:inherit;font-size:13px;
        cursor:${usable ? "pointer" : "not-allowed"}`;

      const gains = Object.entries(r.gives)
        .map(([k, v]) => `${ATTRIBUTES[k].name} ${v >= 1 ? "●●●" : v >= 0.6 ? "●●" : "●"}`).join("  ");
      b.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:baseline">
          <span>${r.name} <span style="color:${FAINT};font-size:11px;font-style:italic">${r.latin}</span></span>
          <span style="color:${affordable ? GOLD : "#6b5c46"};font-size:12px">${r.gold ? `${r.gold}` : "free"}</span>
        </div>
        <div style="font-size:11px;color:${FAINT};font-style:italic;margin:3px 0 4px">${r.desc}</div>
        <div style="display:flex;justify-content:space-between;font-size:11px">
          <span style="color:${GREEN}">${gains || "—"}</span>
          <span style="color:${r.fatigue < 0 ? GREEN : "#c46a2c"}">${r.fatigue < 0 ? `${r.fatigue} fatigue` : `+${r.fatigue} fatigue`}</span>
        </div>
        ${gainsAtCap ? `<div style="font-size:10.5px;color:#c46a2c;margin-top:3px">At your rank's ceiling</div>` : ""}`;

      if (usable) b.onclick = () => {
        const res = a.train(r.id, { gold: inv.gold, rankId: rank.id, spend: (n) => { inv.gold -= n; } });
        if (!res.ok) return;
        this._sfx(res.levelUps && res.levelUps.length ? "coin" : "click");
        inv.save();
        if (this.hooks.onEquip) this.hooks.onEquip(null, null, inv);   // stats changed -> refresh
        this.render();
      };
      body.appendChild(b);
    }
  }

  // -- actions -------------------------------------------------------------

  _equip(slot, id) {
    const r = this.inv.equip(slot, id);
    if (!r.ok) return;
    if (this.hooks.onEquip) this.hooks.onEquip(slot, id, this.inv);
    this.inv.save();
    this.render();
  }

  // -- tooltip -------------------------------------------------------------

  _showTip(e, it) {
    const t = this.tip;
    let rows = Object.entries(it.stats || {})
      .map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:18px">
        <span style="color:#8a7a5e">${k}</span><span>${v}</span></div>`).join("");
    if (!it.equipped) {
      const p = this.inv.previewEquip(it.slot, it.id);
      const fmt = (v, unit = "", goodIsUp = true) => {
        if (Math.abs(v) < 0.005) return `<span style="color:${FAINT}">—</span>`;
        const good = goodIsUp ? v > 0 : v < 0;
        return `<span style="color:${good ? GREEN : "#b5563f"}">${v > 0 ? "+" : ""}${v}${unit}</span>`;
      };
      rows += `<div style="margin-top:9px;padding-top:8px;border-top:1px solid rgba(216,173,78,.22)">
        <div style="display:flex;justify-content:space-between;gap:18px"><span style="color:#8a7a5e">Speed</span>${fmt(p.delta.moveSpeed, " m/s")}</div>
        <div style="display:flex;justify-content:space-between;gap:18px"><span style="color:#8a7a5e">Stamina</span>${fmt(p.delta.staminaMax)}</div>
        <div style="display:flex;justify-content:space-between;gap:18px"><span style="color:#8a7a5e">Recovery</span>${fmt(p.delta.staminaRegen, "/s")}</div>
        <div style="display:flex;justify-content:space-between;gap:18px"><span style="color:#8a7a5e">Load</span>${fmt(p.delta.weight, " kg", false)}</div>
      </div>`;
    }
    t.innerHTML = `<div style="color:${GOLD};font-size:14px;margin-bottom:5px">${it.name}</div>
      <div style="color:${DIM};font-style:italic;margin-bottom:8px;font-size:11.5px">${it.desc}</div>${rows}`;
    t.style.display = "block";
    this._moveTip(e);
  }

  _moveTip(e) {
    const t = this.tip;
    const pad = 16;
    const w = t.offsetWidth || 290;
    let x = e.clientX - w - pad;
    if (x < pad) x = e.clientX + pad;
    t.style.left = `${x}px`;
    t.style.top = `${Math.min(e.clientY + 12, window.innerHeight - (t.offsetHeight || 170) - pad)}px`;
  }

  _hideTip() { if (this.tip) this.tip.style.display = "none"; }

  dispose() { if (this.el) this.el.remove(); }
}
