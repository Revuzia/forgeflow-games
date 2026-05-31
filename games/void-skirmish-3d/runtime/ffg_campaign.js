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
        supplies: 0,
        roster,                  // array aligned to deploy slots; entry may be null after a wipe-fill
        kia: [],                 // memorial: {name, cls, rank, mission}
        upgrades: { aim: 0, armor: 0, charge: 0 },
        won: false, lost: false, lastResult: null,
      };
    }

    _newRookie(slot, cls) {
      const fn = FIRST_NAMES[(Math.random() * FIRST_NAMES.length) | 0];
      const cs = CALLSIGNS[(Math.random() * CALLSIGNS.length) | 0];
      return { uid: "s" + slot + "_" + Date.now().toString(36) + ((Math.random() * 1e4) | 0), slot, cls, name: fn + ' "' + cs + '"', rank: 0, xp: 0, kills: 0, missions: 0 };
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
        out.push(Object.assign({}, slot, {
          id: sol.uid,                          // sim unit id == persistent soldier id
          name: sol.name + "  ·  " + RANKS[rank],
          cls,
          hp: (slot.hp || 10) + hpBonus,
          atk: (slot.atk || 5) + rank,
          def: (slot.def || 0) + (up.armor || 0) * 2,
          aim: Math.min(0.97, (slot.aim || 0.75) + aimBonus),
          _soldier: sol.uid,
        }));
      }
      this.save();
      return out;
    }

    // ── Debrief ───────────────────────────────────────────────────────────────
    // survivorIds: ids (== soldier uids) of player units alive at mission end.
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

      let supplies = 0;
      if (won) {
        supplies = 12 + mi * 3 + (casualties === 0 ? 6 : 0); // clean-win bonus
        this.state.supplies += supplies;
        // Doom: rises each mission; a no-casualty win pushes it back.
        this.state.doom += 1; if (casualties === 0) this.state.doom = Math.max(0, this.state.doom - 1);
      } else {
        this.state.doom += 2; // a failed op accelerates the Avatar Project
      }

      const finished = won && this.isFinalMission();
      const doomOut = this.state.doom >= this.state.doomMax;
      this.state.lastResult = { won, mission: mi + 1, casualties, promotions, supplies, doomOut, finished };

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
        <div style="font-size:15px;margin-bottom:14px">${banner}</div>
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
            <div id="ffg-supplies" style="font-size:13px;letter-spacing:2px;opacity:.7;margin-bottom:4px">SUPPLIES · <b style="color:#ffd27a">${st.supplies}</b></div>
            <div id="ffg-upg"></div>
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
              ov.querySelector("#ffg-supplies").innerHTML = 'SUPPLIES · <b style="color:#ffd27a">' + self.state.supplies + "</b>";
              paintUpg();
            }
          };
          upgWrap.appendChild(b);
        });
      }
      paintUpg();

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
