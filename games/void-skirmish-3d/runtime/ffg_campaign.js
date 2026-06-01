/**
 * FFG runtime — ffg_campaign.js  (ES module, side-effect: window.FFG.Campaign)
 * Strategic meta-layer for the tactics genre (XCOM 2 "campaign" wrapper).
 *
 * Wraps the one-off tactical battles into a persistent campaign:
 *   - PERSISTENT ROSTER of 5 class slots, saved to localStorage per game slug.
 *   - PERMADEATH: a soldier that dies in a mission is gone for good; a fresh
 *     rookie of the same class fills the empty slot for the next deployment.
 *   - RANKS + XP: survivors earn XP (kills + survival), rank up Rookie ->
 *     Squaddie -> Corporal -> Sergeant -> Lieutenant -> Captain, each rank a
 *     small stat bump on top of the mission's base loadout.
 *   - DOOM CLOCK (the "Avatar Project"): rises each mission; a clean win pushes
 *     it back. Max out -> campaign lost. Final mission win -> campaign won.
 *   - SUPPLIES + UPGRADES: win supplies, spend them between missions on
 *     squad-wide upgrades (aim / armor / extra ability charge).
 *   - BARRACKS / DEBRIEF screen between missions, then page-reload into the
 *     next mission (fresh scene; roster carried via localStorage).
 *
 * The tactical renderer stays the source of truth for a single fight; the
 * campaign only decides WHO deploys and what happens AFTER the dust settles.
 */
(function (root) {
  "use strict";

  const RANKS = ["Rookie", "Squaddie", "Corporal", "Sergeant", "Lieutenant", "Captain"];
  const XP_FOR_RANK = [0, 2, 4, 7, 11, 16]; // cumulative XP -> rank index
  const FIRST_NAMES = ["Vega", "Kane", "Reyes", "Okonkwo", "Petrov", "Hase", "Lindqvist", "Maro", "Tanaka", "Cruz", "Adeyemi", "Novak", "Salihu", "Bauer", "Costa", "Iqbal", "Mwangi", "Sorensen", "Park", "Rossi"];
  const CALLSIGNS = ["Reaper", "Wraith", "Stalker", "Ghost", "Patch", "Hammer", "Vortex", "Cinder", "Echo", "Rook", "Hex", "Slate", "Tundra", "Vapor"];

  // ── Engineering catalog ─────────────────────────────────────────────────────
  // Craft gear with SUPPLIES + ALLOYS (salvaged from kills) + ELERIUM (rare, late
  // ops). Crafted items enter the shared INVENTORY; assign them to soldiers in
  // the Loadout. Three equip slots per soldier: weapon / armor / item. Equipped
  // gear modifies the deployed unit's stats (a beam rifle really hits harder).
  const ITEM_DEFS = {
    // ── WEAPONS — three tech tiers × four classes (XCOM conventional→mag→beam). ──
    // CONVENTIONAL (starting kit, cheap)
    rifle_conv:    { type: "weapon", name: "Assault Rifle",    atk: 6,  aim: 0.00, cost: { supplies: 0 } },
    shotgun_conv:  { type: "weapon", name: "Combat Shotgun",   atk: 8,  aim: -0.04, cost: { supplies: 10 } },
    sniper_conv:   { type: "weapon", name: "Sniper Rifle",     atk: 7,  aim: 0.10, cost: { supplies: 14 } },
    cannon_conv:   { type: "weapon", name: "Heavy Cannon",     atk: 9,  aim: -0.05, cost: { supplies: 16 } },
    // MAGNETIC (mid)
    rifle_mag:     { type: "weapon", name: "Magnetic Rifle",   atk: 8,  aim: 0.05, cost: { supplies: 25, alloys: 4 } },
    lance_mag:     { type: "weapon", name: "Mag Lance",        atk: 13, aim: 0.07, cost: { supplies: 32, alloys: 5 } },
    stormgun:      { type: "weapon", name: "Storm Cannon",     atk: 11, aim: 0.03, cost: { supplies: 28, alloys: 4 } },
    sniper_mag:    { type: "weapon", name: "Mag Sniper",       atk: 14, aim: 0.12, cost: { supplies: 34, alloys: 5 } },
    // BEAM / PLASMA (late)
    rifle_beam:    { type: "weapon", name: "Beam Rifle",       atk: 16, aim: 0.08, cost: { supplies: 50, alloys: 8, elerium: 4 } },
    shotgun_beam:  { type: "weapon", name: "Plasma Shotgun",   atk: 18, aim: 0.02, cost: { supplies: 52, alloys: 8, elerium: 5 } },
    cannon_beam:   { type: "weapon", name: "Plasma Cannon",    atk: 20, aim: -0.04, cost: { supplies: 58, alloys: 10, elerium: 6 } },
    // ── ARMOR — HP + defence (helmet/plates are cosmetic-optional) ──
    armor_plated:  { type: "armor",  name: "Plated Armor",     hp: 25, def: 3, cost: { supplies: 30, alloys: 6 } },
    armor_powered: { type: "armor",  name: "Powered Armor",    hp: 50, def: 5, cost: { supplies: 60, alloys: 10, elerium: 6 } },
    // ── UTILITY / PERCEPTION — one item slot ──
    nanovest:      { type: "item",   name: "Nanofiber Vest",   hp: 14, cost: { supplies: 18, alloys: 2 } },
    scope:         { type: "item",   name: "Targeting Scope",  aim: 0.07, cost: { supplies: 20, alloys: 2 } },
    combat_scope:  { type: "item",   name: "Combat Scope",     aim: 0.10, loot: true, cost: { supplies: 24, alloys: 3 } },
    night_optics:  { type: "item",   name: "Night Optics",     aim: 0.03, loot: true, perk: "nightvision", cost: { supplies: 22, alloys: 3 } },
    battle_scanner:{ type: "item",   name: "Battle Scanner",   loot: true, perk: "scan", cost: { supplies: 18, alloys: 2 } },
    medkit:        { type: "item",   name: "Combat Medkit",    hp: 8, cost: { supplies: 15 } },
    fragpack:      { type: "item",   name: "Frag Pack",        atk: 3, cost: { supplies: 14 } },
    ap_rounds:     { type: "item",   name: "AP Rounds",        atk: 2, loot: true, cost: { supplies: 12 } },
    // ── SALVAGE MATERIALS (loot only; grant resources, don't equip) ──
    alloy_plating: { type: "mat",    name: "Alloy Plating",    grant: { alloys: 3 }, loot: true },
    elerium_core:  { type: "mat",    name: "Elerium Core",     grant: { elerium: 2 }, loot: true },
  };
  const ITEM_ORDER = ["rifle_conv", "shotgun_conv", "sniper_conv", "cannon_conv", "rifle_mag", "lance_mag", "stormgun", "sniper_mag", "rifle_beam", "shotgun_beam", "cannon_beam", "armor_plated", "armor_powered", "nanovest", "scope", "combat_scope", "night_optics", "battle_scanner", "medkit", "fragpack", "ap_rounds"];
  const SLOT_OF = { weapon: "weapon", armor: "armor", item: "item" };

  function rankIndexForXp(xp) {
    let r = 0;
    for (let i = 0; i < XP_FOR_RANK.length; i++) if (xp >= XP_FOR_RANK[i]) r = i;
    return r;
  }

  class Campaign {
    constructor(slug, missions) {
      this.slug = slug || "tactics";
      this.missions = missions || [];
      this.key = "ffg_campaign_" + this.slug;
      this.state = this._load() || this._fresh();
    }

    _fresh() {
      // One persistent soldier per mission-0 deploy slot, seeded from that
      // slot's class so abilities + balance line up with the hand-authored loadout.
      const slots = (this.missions[0] && this.missions[0].player_units) || [];
      const roster = slots.map((s, i) => this._newRookie(i, (s.cls || s.class || "soldier")));
      return {
        v: 1, active: true, mission: 0,
        doom: 0, doomMax: Math.max(4, this.missions.length + 1),
        supplies: 0, alloys: 0, elerium: 0,
        inventory: [],           // owned gear: {id, def, equippedBy:uid|null}
        roster,                  // array aligned to deploy slots; entry may be null after a wipe-fill
        kia: [],                 // memorial: {name, cls, rank, mission}
        upgrades: { aim: 0, armor: 0, charge: 0 },
        won: false, lost: false, lastResult: null,
      };
    }

    _newRookie(slot, cls) {
      const fn = FIRST_NAMES[(Math.random() * FIRST_NAMES.length) | 0];
      const cs = CALLSIGNS[(Math.random() * CALLSIGNS.length) | 0];
      return { uid: "s" + slot + "_" + Date.now().toString(36) + ((Math.random() * 1e4) | 0), slot, cls, name: fn + ' "' + cs + '"', rank: 0, xp: 0, kills: 0, missions: 0, equip: { weapon: null, armor: null, item: null } };
    }

    _load() { try { const s = JSON.parse(root.localStorage.getItem(this.key)); return (s && s.v === 1) ? s : null; } catch (e) { return null; } }
    save() { try { root.localStorage.setItem(this.key, JSON.stringify(this.state)); } catch (e) {} }
    reset() { try { root.localStorage.removeItem(this.key); } catch (e) {} this.state = this._fresh(); this.save(); }

    isActive() { return !!this.state.active && this.missions.length > 0; }
    currentMission() { return Math.max(0, Math.min(this.state.mission, this.missions.length - 1)); }
    isFinalMission() { return this.currentMission() >= this.missions.length - 1; }

    // ── Deployment ────────────────────────────────────────────────────────────
    // Overlay the persistent roster onto the mission's deploy slots: keep each
    // slot's spawn position + base loadout, stamp the soldier's identity, then
    // add rank + purchased-upgrade bonuses. Empty/dead slots get a fresh rookie.
    rosterForMission(mission) {
      const slots = mission.player_units || [];
      const up = this.state.upgrades || {};
      const out = [];
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        let sol = this.state.roster[i];
        const cls = (slot.cls || slot.class || "soldier");
        if (!sol || sol.cls !== cls) { sol = this._newRookie(i, cls); this.state.roster[i] = sol; }
        const rank = rankIndexForXp(sol.xp);
        sol.rank = rank;
        const hpBonus = rank * 8 + (up.armor || 0) * 10;
        const aimBonus = rank * 0.02 + (up.aim || 0) * 0.04;
        const eb = this._equipBonus(sol);     // equipped weapon/armor/item bonuses
        out.push(Object.assign({}, slot, {
          id: sol.uid,                          // sim unit id == persistent soldier id
          name: sol.name + "  ·  " + RANKS[rank],
          cls,
          hp: (slot.hp || 10) + hpBonus + eb.hp,
          atk: (slot.atk || 5) + rank + eb.atk,
          def: (slot.def || 0) + (up.armor || 0) * 2 + eb.def,
          aim: Math.min(0.97, (slot.aim || 0.75) + aimBonus + eb.aim),
          _soldier: sol.uid,
          _loadout: this._loadoutNames(sol),  // for HUD/tooltip
        }));
      }
      this.save();
      return out;
    }

    // ── Debrief ───────────────────────────────────────────────────────────────
    // survivorIds: ids (== soldier uids) of player units alive at mission end.
    // Field loot recovered in a mission → permanent campaign gear/resources.
    // Equippable items land in the inventory; salvage materials grant resources.
    addSalvage(salvage) {
      if (!salvage || !salvage.length) return [];
      const added = [];
      for (const s of salvage) {
        const id = s && s.item && s.item.id; const def = id && ITEM_DEFS[id]; if (!def) continue;
        if (def.type === "mat" && def.grant) {
          for (const k in def.grant) this.state[k] = (this.state[k] || 0) + def.grant[k];
        } else {
          this.state.inventory.push({ id: "loot_" + this.state.inventory.length + "_" + id, def: id, equippedBy: null });
        }
        added.push(def.name || id);
      }
      this.save();
      return added;
    }

    recordMissionResult(allPlayerUnits, won) {
      const survivors = new Set((allPlayerUnits || []).filter((u) => u.hp > 0).map((u) => u.id));
      const kills = {}; (allPlayerUnits || []).forEach((u) => { kills[u.id] = u._kills || 0; });
      const mi = this.currentMission();
      let casualties = 0, promotions = [];
      for (let i = 0; i < this.state.roster.length; i++) {
        const sol = this.state.roster[i]; if (!sol) continue;
        const deployedId = sol.uid;
        if (won && !survivors.has(deployedId)) {
          // KIA in a winning mission (or wiped): permadeath.
          this.state.kia.push({ name: sol.name, cls: sol.cls, rank: RANKS[sol.rank || 0], mission: mi + 1 });
          this.state.roster[i] = null; casualties++;
          continue;
        }
        if (won) {
          const before = sol.rank || 0;
          sol.kills += (kills[deployedId] || 0);
          sol.missions += 1;
          sol.xp += 1 + (kills[deployedId] || 0); // survival + kills
          const after = rankIndexForXp(sol.xp);
          if (after > before) promotions.push({ name: sol.name, from: RANKS[before], to: RANKS[after] });
          sol.rank = after;
        }
      }
      // Refill empty slots with rookies so the next deployment is full.
      const slots = (this.missions[mi] && this.missions[mi].player_units) || [];
      for (let i = 0; i < this.state.roster.length; i++) {
        if (!this.state.roster[i]) this.state.roster[i] = this._newRookie(i, (slots[i] && (slots[i].cls || slots[i].class)) || "soldier");
      }

      let supplies = 0, loot = [];
      if (won) {
        supplies = 12 + mi * 3 + (casualties === 0 ? 6 : 0); // clean-win bonus
        this.state.supplies += supplies;
        this._awardResources(mi, casualties === 0);          // alloys + elerium salvage
        loot = this.dropLoot(mi);                            // a finished item or two
        // Doom: rises each mission; a no-casualty win pushes it back.
        this.state.doom += 1; if (casualties === 0) this.state.doom = Math.max(0, this.state.doom - 1);
      } else {
        this.state.doom += 2; // a failed op accelerates the Avatar Project
      }

      const finished = won && this.isFinalMission();
      const doomOut = this.state.doom >= this.state.doomMax;
      this.state.lastResult = { won, mission: mi + 1, casualties, promotions, supplies, loot, doomOut, finished };

      if (finished) { this.state.won = true; this.state.active = false; }
      else if (doomOut) { this.state.lost = true; this.state.active = false; }
      else if (won) { this.state.mission = Math.min(mi + 1, this.missions.length - 1); }
      // a loss that isn't doom-out: replay the same mission with the refilled squad

      this.save();
      return this.state.lastResult;
    }

    buyUpgrade(id) {
      const COST = { aim: 30, armor: 35, charge: 45 };
      const MAX = { aim: 3, armor: 3, charge: 1 };
      if (!(id in COST)) return false;
      if ((this.state.upgrades[id] || 0) >= MAX[id]) return false;
      if (this.state.supplies < COST[id]) return false;
      this.state.supplies -= COST[id];
      this.state.upgrades[id] = (this.state.upgrades[id] || 0) + 1;
      this.save();
      return true;
    }

    // ── Inventory / engineering / loadout ───────────────────────────────────────
    _itemDef(invItem) { return invItem && ITEM_DEFS[invItem.def]; }
    _equipBonus(sol) {
      const b = { hp: 0, atk: 0, def: 0, aim: 0 };
      if (!sol || !sol.equip) return b;
      const inv = this.state.inventory || [];
      for (const slot of ["weapon", "armor", "item"]) {
        const id = sol.equip[slot]; if (!id) continue;
        const it = inv.find((x) => x.id === id); const d = this._itemDef(it); if (!d) continue;
        b.hp += d.hp || 0; b.atk += d.atk || 0; b.def += d.def || 0; b.aim += d.aim || 0;
      }
      return b;
    }
    _loadoutNames(sol) {
      const inv = this.state.inventory || [], out = {};
      for (const slot of ["weapon", "armor", "item"]) {
        const id = sol && sol.equip && sol.equip[slot];
        const it = id && inv.find((x) => x.id === id); out[slot] = it ? ITEM_DEFS[it.def].name : null;
      }
      return out;
    }
    canAfford(cost) { return ["supplies", "alloys", "elerium"].every((r) => (this.state[r] || 0) >= ((cost || {})[r] || 0)); }
    craftItem(defId) {
      const d = ITEM_DEFS[defId]; if (!d) return null;
      if (!this.canAfford(d.cost)) return null;
      for (const r of ["supplies", "alloys", "elerium"]) this.state[r] = (this.state[r] || 0) - ((d.cost || {})[r] || 0);
      const id = "i_" + defId + "_" + Date.now().toString(36) + ((Math.random() * 1e4) | 0);
      this.state.inventory.push({ id, def: defId, equippedBy: null });
      this.save(); return id;
    }
    equipItem(uid, itemId) {
      const sol = this.state.roster.find((s) => s && s.uid === uid); if (!sol) return false;
      const inv = this.state.inventory || [];
      const it = inv.find((x) => x.id === itemId); const d = this._itemDef(it); if (!d) return false;
      if (!sol.equip) sol.equip = { weapon: null, armor: null, item: null };
      const slot = SLOT_OF[d.type]; if (!slot) return false;
      // free whatever this soldier currently has in that slot
      const prev = sol.equip[slot]; if (prev) { const p = inv.find((x) => x.id === prev); if (p) p.equippedBy = null; }
      // steal the item from any other soldier holding it
      if (it.equippedBy && it.equippedBy !== uid) {
        const owner = this.state.roster.find((s) => s && s.uid === it.equippedBy);
        if (owner && owner.equip) for (const k of ["weapon", "armor", "item"]) if (owner.equip[k] === itemId) owner.equip[k] = null;
      }
      sol.equip[slot] = itemId; it.equippedBy = uid; this.save(); return true;
    }
    unequipSlot(uid, slot) {
      const sol = this.state.roster.find((s) => s && s.uid === uid); if (!sol || !sol.equip) return false;
      const id = sol.equip[slot]; if (!id) return false;
      const it = (this.state.inventory || []).find((x) => x.id === id); if (it) it.equippedBy = null;
      sol.equip[slot] = null; this.save(); return true;
    }
    _awardResources(mi, clean) {
      this.state.alloys = (this.state.alloys || 0) + 3 + mi;                       // salvage from the field
      if (mi >= 2 || clean) this.state.elerium = (this.state.elerium || 0) + (mi >= 4 ? 2 : 1); // rare crystal, later ops / clean wins
    }
    // A winning op sometimes yields a finished item straight to the stash (loot).
    dropLoot(mi) {
      const pool = ITEM_ORDER.filter((id) => mi >= 3 ? true : !(ITEM_DEFS[id].cost.elerium));
      const out = [], n = 1 + (mi >= 3 ? 1 : 0);
      for (let k = 0; k < n; k++) if (Math.random() < 0.6) {
        const defId = pool[(Math.random() * pool.length) | 0];
        const id = "i_" + defId + "_" + Date.now().toString(36) + ((Math.random() * 1e4) | 0) + k;
        this.state.inventory.push({ id, def: defId, equippedBy: null });
        out.push(ITEM_DEFS[defId].name);
      }
      return out;
    }

    // ── Barracks / debrief screen ───────────────────────────────────────────────
    renderBarracks(parent, opts) {
      opts = opts || {};
      const st = this.state, res = st.lastResult || {};
      const ov = document.createElement("div");
      Object.assign(ov.style, {
        position: "absolute", inset: "0", zIndex: "200", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "flex-start", overflowY: "auto",
        background: "radial-gradient(120% 90% at 50% 0%, #122236 0%, #070d16 70%)",
        color: "#dce8f5", fontFamily: "'Segoe UI',system-ui,monospace", padding: "26px 18px",
      });
      const doomPct = Math.round(st.doom / st.doomMax * 100);
      const promo = (res.promotions || []).map((p) => `${p.name}: ${p.from} → <b style="color:#9dffb6">${p.to}</b>`).join("<br>");
      const rosterRows = st.roster.map((s) => s ? `
        <div style="display:flex;justify-content:space-between;gap:12px;padding:6px 10px;background:rgba(10,20,34,.6);border-left:3px solid #3a5e7e;border-radius:5px;margin:3px 0">
          <span><b>${s.name}</b> <span style="opacity:.6">· ${s.cls}</span></span>
          <span style="opacity:.85">${RANKS[rankIndexForXp(s.xp)]} · ${s.kills} kills · XP ${s.xp}</span>
        </div>` : "").join("");
      const kiaRows = st.kia.length ? st.kia.slice(-6).map((k) => `<div style="opacity:.6;font-size:12px;padding:2px 0">✝ ${k.name} — ${k.cls}, ${k.rank} (Op ${k.mission})</div>`).join("") : `<div style="opacity:.4;font-size:12px">No casualties. Keep it that way.</div>`;

      const banner = res.finished ? `<span style="color:#9dffb6">CAMPAIGN VICTORY — the Avatar Project is broken.</span>`
        : res.doomOut ? `<span style="color:#ff6a5a">CAMPAIGN LOST — the Avatar Project completed.</span>`
        : res.won ? `<span style="color:#9dffb6">OPERATION ${res.mission} — SUCCESS</span>`
        : `<span style="color:#ffb454">OPERATION ${res.mission} — FAILED. Regroup and redeploy.</span>`;

      ov.innerHTML = `
        <div style="font-size:30px;font-weight:800;letter-spacing:4px;margin-bottom:2px">BARRACKS</div>
        <div style="font-size:15px;margin-bottom:4px">${banner}</div>
        ${res.won ? `<div style="font-size:12px;opacity:.8;margin-bottom:12px">+${res.supplies} supplies · +${3 + (res.mission - 1)} alloys${(res.loot && res.loot.length) ? ` · <span style="color:#9dffb6">recovered ${res.loot.join(", ")}</span>` : ""}</div>` : `<div style="margin-bottom:10px"></div>`}
        <div style="display:flex;gap:18px;flex-wrap:wrap;justify-content:center;max-width:920px;width:100%">
          <div style="flex:1;min-width:320px">
            <div style="font-size:13px;letter-spacing:2px;opacity:.7;margin-bottom:4px">SQUAD</div>
            ${rosterRows}
            <div style="font-size:13px;letter-spacing:2px;opacity:.7;margin:12px 0 4px">MEMORIAL</div>
            ${kiaRows}
            ${promo ? `<div style="font-size:13px;letter-spacing:2px;opacity:.7;margin:12px 0 4px">PROMOTIONS</div><div style="font-size:13px;line-height:1.6">${promo}</div>` : ""}
          </div>
          <div style="flex:0 0 300px;min-width:280px">
            <div style="font-size:13px;letter-spacing:2px;opacity:.7;margin-bottom:4px">AVATAR PROJECT</div>
            <div style="background:#0a141f;border:1px solid #3a2030;border-radius:6px;height:18px;overflow:hidden;margin-bottom:4px">
              <div style="height:100%;width:${doomPct}%;background:linear-gradient(90deg,#ff7a3c,#ff3a3a)"></div>
            </div>
            <div style="font-size:12px;opacity:.7;margin-bottom:14px">Doom ${st.doom} / ${st.doomMax} — win clean to push it back.</div>
            <div id="ffg-res" style="font-size:13px;letter-spacing:.5px;margin-bottom:8px">SUPPLIES <b style="color:#ffd27a">${st.supplies}</b> &nbsp;·&nbsp; ALLOYS <b style="color:#bfe6ff">${st.alloys || 0}</b> &nbsp;·&nbsp; ELERIUM <b style="color:#c9a6ff">${st.elerium || 0}</b></div>
            <div style="font-size:13px;letter-spacing:2px;opacity:.7;margin-bottom:4px">SQUAD UPGRADES</div>
            <div id="ffg-upg"></div>
          </div>
        </div>
        <div style="display:flex;gap:18px;flex-wrap:wrap;justify-content:center;max-width:920px;width:100%;margin-top:16px">
          <div style="flex:1;min-width:320px">
            <div style="font-size:13px;letter-spacing:2px;opacity:.7;margin-bottom:6px">⚙ ENGINEERING — craft gear</div>
            <div id="ffg-eng" style="display:grid;grid-template-columns:1fr 1fr;gap:6px"></div>
          </div>
          <div style="flex:1;min-width:320px">
            <div style="font-size:13px;letter-spacing:2px;opacity:.7;margin-bottom:6px">🎖 LOADOUT — assign gear to squad</div>
            <div id="ffg-loadout" style="display:flex;flex-direction:column;gap:6px"></div>
          </div>
        </div>
        <div id="ffg-bar-actions" style="margin-top:20px;display:flex;gap:10px"></div>
      `;
      parent.appendChild(ov);

      // upgrade buttons
      const upgWrap = ov.querySelector("#ffg-upg");
      const UPG = [
        { id: "aim", label: "Combat Optics", desc: "+4% squad aim", cost: 30, max: 3 },
        { id: "armor", label: "Plated Vests", desc: "+10 HP, +2 DEF squad-wide", cost: 35, max: 3 },
        { id: "charge", label: "Munitions Cache", desc: "(reserved) +1 ability charge", cost: 45, max: 1 },
      ];
      const self = this;
      function paintUpg() {
        upgWrap.innerHTML = "";
        UPG.forEach((u) => {
          const lvl = self.state.upgrades[u.id] || 0;
          const maxed = lvl >= u.max;
          const can = !maxed && self.state.supplies >= u.cost;
          const b = document.createElement("button");
          b.innerHTML = `${u.label} <span style="opacity:.6">${lvl}/${u.max}</span><br><span style="font-size:11px;opacity:.7">${u.desc} · ${maxed ? "MAX" : u.cost + " supplies"}</span>`;
          Object.assign(b.style, { display: "block", width: "100%", textAlign: "left", margin: "4px 0", padding: "8px 11px", borderRadius: "6px", cursor: can ? "pointer" : "not-allowed", color: can ? "#e8f2ff" : "#5b6b7e", background: can ? "rgba(20,38,58,.9)" : "rgba(16,24,34,.7)", border: "1px solid " + (can ? "#3a5e7e" : "#26303d"), font: "600 13px 'Segoe UI',monospace" });
          b.onclick = () => {
            if (can && self.buyUpgrade(u.id)) {
              paintRes();
              paintUpg();
            }
          };
          upgWrap.appendChild(b);
        });
      }
      paintUpg();

      // live resource line (shared by upgrades + engineering)
      function paintRes() {
        const el = ov.querySelector("#ffg-res");
        if (el) el.innerHTML = `SUPPLIES <b style="color:#ffd27a">${self.state.supplies}</b> &nbsp;·&nbsp; ALLOYS <b style="color:#bfe6ff">${self.state.alloys || 0}</b> &nbsp;·&nbsp; ELERIUM <b style="color:#c9a6ff">${self.state.elerium || 0}</b>`;
      }
      function _costStr(cost) { return ["supplies", "alloys", "elerium"].filter((r) => cost[r]).map((r) => `${cost[r]} ${r.slice(0, 3)}`).join(" + "); }
      function _statStr(d) {
        const p = [];
        if (d.atk) p.push(`+${d.atk} dmg`); if (d.aim) p.push(`+${Math.round(d.aim * 100)}% aim`);
        if (d.hp) p.push(`+${d.hp} HP`); if (d.def) p.push(`+${d.def} DEF`);
        return p.join(", ");
      }
      // ENGINEERING — craft buttons
      function paintEng() {
        const wrap = ov.querySelector("#ffg-eng"); if (!wrap) return; wrap.innerHTML = "";
        ITEM_ORDER.forEach((id) => {
          const d = ITEM_DEFS[id], can = self.canAfford(d.cost);
          const tc = d.type === "weapon" ? "#ff9a6a" : d.type === "armor" ? "#7ad0ff" : "#c9a6ff";
          const b = document.createElement("button");
          b.innerHTML = `<span style="color:${tc};font-weight:700">${d.name}</span> <span style="opacity:.5;font-size:10px">${d.type}</span><br><span style="font-size:11px;opacity:.85">${_statStr(d)}</span><br><span style="font-size:10px;opacity:.6">${_costStr(d.cost)}</span>`;
          Object.assign(b.style, { textAlign: "left", padding: "7px 9px", borderRadius: "6px", cursor: can ? "pointer" : "not-allowed", color: can ? "#e8f2ff" : "#56657a", background: can ? "rgba(20,38,58,.9)" : "rgba(16,24,34,.65)", border: "1px solid " + (can ? "#3a5e7e" : "#26303d"), font: "600 12px 'Segoe UI',monospace", lineHeight: "1.4" });
          b.onclick = () => { if (self.canAfford(d.cost) && self.craftItem(id)) { paintRes(); paintEng(); paintLoadout(); } };
          wrap.appendChild(b);
        });
      }
      // LOADOUT — per-soldier weapon/armor/item selects
      function paintLoadout() {
        const wrap = ov.querySelector("#ffg-loadout"); if (!wrap) return; wrap.innerHTML = "";
        const inv = self.state.inventory || [];
        (self.state.roster || []).forEach((sol) => {
          if (!sol) return;
          if (!sol.equip) sol.equip = { weapon: null, armor: null, item: null };
          const row = document.createElement("div");
          Object.assign(row.style, { background: "rgba(10,20,34,.6)", border: "1px solid #2a4458", borderRadius: "6px", padding: "7px 9px" });
          const eb = self._equipBonus(sol);
          const bonus = (eb.hp || eb.atk || eb.def || eb.aim) ? ` <span style="opacity:.7;font-size:10px;color:#9dffb6">${[eb.atk ? "+" + eb.atk + "dmg" : "", eb.hp ? "+" + eb.hp + "hp" : "", eb.def ? "+" + eb.def + "def" : "", eb.aim ? "+" + Math.round(eb.aim * 100) + "%aim" : ""].filter(Boolean).join(" ")}</span>` : "";
          row.innerHTML = `<div style="margin-bottom:5px;font-size:12px"><b>${sol.name}</b> <span style="opacity:.55">· ${sol.cls}</span>${bonus}</div>`;
          const slots = document.createElement("div"); slots.style.cssText = "display:flex;gap:5px";
          ["weapon", "armor", "item"].forEach((slot) => {
            const sel = document.createElement("select");
            Object.assign(sel.style, { flex: "1", minWidth: "0", background: "#0c1726", color: "#cfe0f2", border: "1px solid #2a4458", borderRadius: "4px", padding: "4px", font: "11px 'Segoe UI',monospace" });
            const none = document.createElement("option"); none.value = ""; none.textContent = slot + ": —"; sel.appendChild(none);
            inv.filter((it) => { const d = ITEM_DEFS[it.def]; return d && d.type === slot && (!it.equippedBy || it.equippedBy === sol.uid); })
              .forEach((it) => { const o = document.createElement("option"); o.value = it.id; o.textContent = ITEM_DEFS[it.def].name; if (sol.equip[slot] === it.id) o.selected = true; sel.appendChild(o); });
            sel.onchange = () => { if (sel.value) self.equipItem(sol.uid, sel.value); else self.unequipSlot(sol.uid, slot); paintLoadout(); };
            slots.appendChild(sel);
          });
          row.appendChild(slots); wrap.appendChild(row);
        });
        if (!(self.state.inventory || []).length) wrap.innerHTML = `<div style="opacity:.45;font-size:12px">No gear yet — craft weapons & armor in Engineering, or win ops to recover loot.</div>`;
      }
      paintEng(); paintLoadout();

      // actions
      const actions = ov.querySelector("#ffg-bar-actions");
      const mkBtn = (label, primary, fn) => {
        const b = document.createElement("button");
        b.textContent = label;
        Object.assign(b.style, { font: "bold 14px 'Segoe UI',monospace", letterSpacing: "1px", padding: "12px 26px", borderRadius: "8px", cursor: "pointer", color: "#06101c", background: primary ? "linear-gradient(#9dffb6,#4fe084)" : "linear-gradient(#bfe6ff,#5fb0e0)", border: "1px solid " + (primary ? "#7CFC9A" : "#9fd0ff") });
        b.onclick = fn; actions.appendChild(b); return b;
      };
      if (st.active) {
        mkBtn("DEPLOY — OPERATION " + (this.currentMission() + 1), true, () => { try { root.sessionStorage.setItem("ffg_autostart_" + self.slug, "1"); } catch (e) {} root.location.reload(); });
      } else {
        mkBtn("NEW CAMPAIGN", true, () => { self.reset(); try { root.sessionStorage.removeItem("ffg_autostart_" + self.slug); } catch (e) {} root.location.reload(); });
      }
      return ov;
    }
  }

  root.FFG = root.FFG || {};
  root.FFG.Campaign = Campaign;
  if (typeof module !== "undefined" && module.exports) module.exports = { Campaign };
})(typeof window !== "undefined" ? window : globalThis);
