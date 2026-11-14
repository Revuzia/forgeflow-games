// core/hud/loadout_ui.js — CLASS EDITOR (from the PVP mode-select screen) and
// CLASS PICKER (match warm-up + the death/respawn screen). DOM only; every rule
// a class must obey lives in core/sim/classes.js, the saved record in
// core/meta/loadouts.js, the spawn kits in the sim.
//
// Wiring (no boot.js edit): mode_select.js calls getLoadoutUI(ctx) once. This
// module chains ctx.bridge.clear (the same seam menu.js uses for its match
// shell) so its handlers survive every match start, and it writes the chosen
// class into ctx.content.pvpClassSelected — the object boot hands createSim —
// so the next match spawns with it.
//
// Input: mouse/touch tap on every control; keyboard 1-5 picks a class while a
// picker or the editor is open (captured BEFORE input.js so it never doubles as
// a weapon switch), L opens/closes the in-match picker, Esc closes. Locked
// items read progression (ctx.progression / __FPS__.progression; absent =
// everything unlocked) and show the level that unlocks them.

import {
  PRIMARIES, SECONDARIES, LETHALS, TACTICALS, EQUIPMENT_NAMES,
  PERKS, PERKS_BY_TIER, CLASS_COUNT, NAME_MAX,
} from "../sim/classes.js";
import { createLoadouts, STORE_KEY } from "../meta/loadouts.js";
// [gunsmith] attachments + camos (data, stat lines, trade-off text: core/sim/attachments.js)
import {
  SLOTS, SLOT_NAMES, MAX_ATTACH, ATTACHMENTS, CAMOS, CAMO_IDS, slotOptions, factoryPart, attachKey,
  camoKey, attachName, effectiveWeapon, statLine, STAT_KEYS, STAT_NAMES, describeAttachment, attachInSlot,
  gateBuild,
} from "../sim/attachments.js";
import { WEAPONS } from "../weapons/weapon_data.js";
import { applyTuning, getTuning } from "../pvp/pvp_tuning.js";
// the PVP-tuned table: the stat bars show the numbers a match actually fires
const PVP_WEAPONS = applyTuning(WEAPONS, getTuning("pvp"));

const WNAME = {
  warden: "M-72 WARDEN", vesper: "KS-23 VESPER", breaker: "B-12 BREAKER",
  corvus: "LR-1 CORVUS", pike: "GS-9 PIKE",
};
const WROLE = {
  warden: "assault rifle", vesper: "submachine gun", breaker: "pump shotgun",
  corvus: "marksman rifle", pike: "sidearm",
};
const TIER_LABEL = ["PERK 1", "PERK 2", "PERK 3"];

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function ensureStyle() {
  if (typeof document === "undefined" || document.getElementById("lo-style")) return;
  const el = document.createElement("style");
  el.id = "lo-style";
  el.textContent = `
.lo-ov{position:fixed;inset:0;z-index:60;font-family:var(--a10-ui-font,system-ui);
  color:var(--a10-ink,#e8e8e4);-webkit-user-select:none;user-select:none;}
.lo-ov .lo-wash{position:absolute;inset:0;background:rgba(4,6,10,.78);
  backdrop-filter:blur(6px) saturate(.9);}
.lo-ed{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  width:min(980px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;
  display:flex;gap:28px;padding:22px 24px;box-sizing:border-box;}
.lo-ed h2{font-family:var(--a10-hud-font,system-ui);font-weight:400;font-size:15px;
  letter-spacing:.34em;opacity:.85;margin:0 0 14px;text-transform:uppercase;}
.lo-list{flex:0 0 210px;display:flex;flex-direction:column;gap:6px;}
.lo-tab{display:flex;align-items:baseline;gap:10px;text-align:left;cursor:pointer;
  background:rgba(232,232,228,.04);border:1px solid rgba(232,232,228,.14);
  color:rgba(232,232,228,.75);font-family:inherit;padding:10px 12px;}
.lo-tab .k{font-size:10px;opacity:.5;letter-spacing:.1em;}
.lo-tab .n{font-family:var(--a10-hud-font,system-ui);font-size:14px;letter-spacing:.2em;}
.lo-tab .w{display:block;font-size:10px;letter-spacing:.14em;opacity:.55;margin-top:3px;}
.lo-tab.on{border-color:var(--a10-amber,#d9a441);color:var(--a10-ink,#e8e8e4);}
.lo-tab .act{margin-left:auto;font-size:9px;letter-spacing:.24em;color:var(--a10-amber,#d9a441);}
.lo-tab:focus-visible,.lo-opt:focus-visible,.lo-btn:focus-visible,.lo-card:focus-visible{
  outline:2px solid var(--a10-amber,#d9a441);outline-offset:1px;}
.lo-det{flex:1 1 auto;min-width:0;}
.lo-sec{font-size:10px;letter-spacing:.26em;opacity:.55;margin:14px 0 6px;text-transform:uppercase;}
.lo-opts{display:flex;flex-wrap:wrap;gap:6px;}
.lo-opt{position:relative;cursor:pointer;text-align:left;font-family:inherit;
  background:rgba(232,232,228,.05);border:1px solid rgba(232,232,228,.18);
  color:rgba(232,232,228,.8);padding:7px 11px;min-width:118px;}
.lo-opt .t{font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;}
.lo-opt .d{font-size:9.5px;letter-spacing:.06em;opacity:.55;margin-top:2px;}
.lo-opt.on{border-color:var(--a10-amber,#d9a441);color:var(--a10-ink,#e8e8e4);
  background:rgba(217,164,65,.12);}
.lo-opt.lock,.lo-opt.soon{opacity:.42;cursor:default;padding-right:52px;}
.lo-opt .lv{position:absolute;right:7px;top:6px;font-size:9px;letter-spacing:.14em;
  color:var(--a10-amber,#d9a441);}
.lo-desc{font-size:11.5px;line-height:1.6;opacity:.72;min-height:18px;margin-top:8px;max-width:620px;}
.lo-name{background:transparent;border:none;border-bottom:1px solid rgba(232,232,228,.3);
  color:var(--a10-ink,#e8e8e4);font-family:var(--a10-hud-font,system-ui);font-size:22px;
  letter-spacing:.24em;width:min(360px,100%);padding:2px 0;outline:none;text-transform:uppercase;}
.lo-name:focus{border-bottom-color:var(--a10-amber,#d9a441);}
.lo-foot{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px;align-items:center;}
.lo-btn{cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:.24em;
  text-transform:uppercase;padding:9px 16px;background:none;
  border:1px solid rgba(232,232,228,.3);color:rgba(232,232,228,.85);}
.lo-btn.pri{border-color:var(--a10-amber,#d9a441);color:var(--a10-amber,#d9a441);}
.lo-hint{font-size:10px;letter-spacing:.18em;opacity:.45;margin-left:auto;}
.lo-warn{font-size:10.5px;letter-spacing:.1em;color:var(--a10-amber,#d9a441);margin-top:6px;}
/* in-match picker: a strip under the compass + score line, clear of the centre
   kill-cam / respawn readout, the warm-up rules card, and the bottom HUD
   (controls hint, streak tray, ammo) */
.lo-pick{position:fixed;left:50%;top:96px;transform:translateX(-50%);z-index:58;
  width:min(940px,calc(100vw - 32px));font-family:var(--a10-ui-font,system-ui);
  color:var(--a10-ink,#e8e8e4);pointer-events:auto;}
.lo-pick .hd{display:flex;align-items:baseline;gap:14px;margin-bottom:8px;}
.lo-pick .hd .ti{font-family:var(--a10-hud-font,system-ui);font-size:14px;letter-spacing:.32em;}
.lo-pick .hd .sub{font-size:10px;letter-spacing:.2em;opacity:.6;text-transform:uppercase;}
.lo-pick .hd .sub b{color:var(--a10-amber,#d9a441);font-weight:400;}
.lo-cards{display:flex;gap:8px;}
.lo-card{flex:1 1 0;min-width:0;cursor:pointer;text-align:left;font-family:inherit;
  background:rgba(6,8,12,.72);border:1px solid rgba(232,232,228,.16);
  color:rgba(232,232,228,.82);padding:9px 11px;}
.lo-card .k{font-size:9.5px;opacity:.5;letter-spacing:.14em;}
.lo-card .n{font-family:var(--a10-hud-font,system-ui);font-size:14px;letter-spacing:.18em;
  margin:2px 0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.lo-card .w{font-size:10px;letter-spacing:.1em;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.lo-card .p{font-size:9px;letter-spacing:.1em;opacity:.55;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.lo-card.on{border-color:var(--a10-amber,#d9a441);color:var(--a10-ink,#e8e8e4);}
.lo-card.next{border-style:dashed;border-color:var(--a10-amber,#d9a441);}
.lo-card .p b.lk{font-weight:400;color:var(--a10-amber,#d9a441);opacity:1;}
.lo-card.focus{outline:2px solid var(--a10-amber,#d9a441);outline-offset:2px;}
/* [polish v149] the warm-up / death picker sits where the Stronghold zone chips
   and the Reclaim / Outpost / Ascent chip live: while it is open they step aside */
body.lo-pick-open #a10-modes .md-chip,body.lo-pick-open #a10-modes .md-next,body.lo-pick-open #a10-modes .md-rung,
body.lo-pick-open #a10-dom .dm-chips{visibility:hidden;}
/* [polish v149] death / kill-cam hint: how to change class for the coming respawn */
.lo-hint{position:fixed;left:50%;bottom:24%;transform:translateX(-50%);z-index:61;display:none;
  font-family:var(--a10-ui-font,system-ui);font-size:11px;letter-spacing:.24em;text-transform:uppercase;
  padding:7px 14px;background:rgba(6,8,12,.62);border:1px solid rgba(232,232,228,.22);color:rgba(232,232,228,.9);
  cursor:pointer;pointer-events:auto;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.8);}
.lo-hint kbd{font:inherit;color:var(--a10-amber,#d9a441);border:1px solid rgba(217,164,65,.55);padding:1px 6px;margin-right:8px;letter-spacing:.1em;}
.lo-hint b{font-weight:400;color:var(--a10-amber,#d9a441);}
body.br-touch .lo-hint{bottom:auto;top:41%;padding:10px 16px;}   /* touch: clear of the bottom-centre ammo block */
.lo-chip{position:fixed;left:calc(108px + env(safe-area-inset-left));top:calc(12px + env(safe-area-inset-top));z-index:57;cursor:pointer;font-family:var(--a10-ui-font,system-ui);
  font-size:10.5px;letter-spacing:.24em;padding:8px 12px;background:rgba(6,8,12,.6);
  border:1px solid rgba(232,232,228,.25);color:rgba(232,232,228,.85);}
/* [gunsmith] */
.lo-gsl{display:flex;align-items:center;gap:10px;margin-top:6px;cursor:pointer;text-align:left;font-family:inherit;
  background:rgba(232,232,228,.03);border:1px dashed rgba(232,232,228,.22);color:rgba(232,232,228,.78);
  padding:6px 10px;font-size:10.5px;letter-spacing:.14em;width:100%;box-sizing:border-box;}
.lo-gsl b{font-weight:400;color:var(--a10-amber,#d9a441);letter-spacing:.24em;}
.lo-gsl:focus-visible{outline:2px solid var(--a10-amber,#d9a441);outline-offset:1px;}
.lo-gs{display:flex;gap:22px;align-items:flex-start;}
.lo-gs .col1{flex:1 1 auto;min-width:0;}
.lo-gs .col2{flex:0 0 268px;}
.lo-gs .hd{display:flex;align-items:baseline;gap:12px;margin-bottom:4px;}
.lo-gs .hd .ti{font-family:var(--a10-hud-font,system-ui);font-size:19px;letter-spacing:.24em;}
.lo-gs .hd .cnt{font-size:10px;letter-spacing:.2em;opacity:.65;margin-left:auto;}
.lo-gs .row{display:flex;align-items:stretch;gap:6px;margin-top:6px;}
.lo-gs .row .sl{flex:0 0 96px;font-size:9.5px;letter-spacing:.22em;opacity:.55;padding-top:9px;}
.lo-gs .row .lo-opt{min-width:0;flex:0 1 auto;padding:6px 10px;}
.lo-gs .row .lo-opt.lock{padding-right:10px;}
.lo-gs .row .lo-opt .lv{position:static;display:block;margin-top:2px;}
.lo-gs .lo-opt .t{font-size:10.5px;}
.lo-sw{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}
.lo-sw .lo-opt{min-width:0;width:84px;padding:5px 6px 6px;}
.lo-sw .lo-opt.lock{padding-right:6px;}
.lo-sw .lo-opt .lv{position:static;display:block;margin-top:2px;}
.lo-sw .chip{display:block;height:20px;margin-bottom:4px;border:1px solid rgba(0,0,0,.5);}
.lo-st{margin-top:2px;}
.lo-st .lo-sr{display:grid;grid-template-columns:78px 1fr;gap:3px 8px;align-items:center;margin-top:7px;line-height:1.2;}
.lo-st .lo-sn{font-size:9.5px;letter-spacing:.2em;opacity:.6;}
.lo-st .lo-sb{position:relative;height:6px;background:rgba(232,232,228,.10);}
.lo-st .lo-sb i{position:absolute;top:0;bottom:0;left:0;background:rgba(232,232,228,.72);}
.lo-st .lo-sb i.up{background:#6fd08a;}
.lo-st .lo-sb i.dn{background:#e0644f;}
.lo-st .lo-sv{grid-column:2;font-size:9.5px;letter-spacing:.08em;opacity:.7;}
.lo-st .lo-sv .up{color:#6fd08a;}
.lo-st .lo-sv .dn{color:#e0644f;}
.lo-gsd{font-size:11px;line-height:1.55;margin-top:14px;min-height:96px;opacity:.85;}
.lo-gsd .nm{font-family:var(--a10-hud-font,system-ui);letter-spacing:.2em;font-size:12px;}
.lo-gsd .bl{opacity:.75;margin:3px 0 5px;}
.lo-gsd .pro{color:#6fd08a;}
.lo-gsd .con{color:#e0644f;}
@media (max-width:720px){
  .lo-gs{flex-direction:column;}
  .lo-gs .col2{flex:1 1 auto;width:100%;}
  .lo-gs .row{flex-wrap:wrap;}
  .lo-gs .row .sl{flex:1 1 100%;padding-top:2px;}
}
@media (max-width:720px){
  .lo-ed{flex-direction:column;gap:14px;padding:14px 16px;}
  .lo-list{flex:0 0 auto;flex-direction:row;flex-wrap:wrap;}
  .lo-tab{flex:1 1 120px;}
  .lo-cards{flex-wrap:wrap;}
  .lo-card{flex:1 1 30%;}
  .lo-opt{min-width:0;flex:1 1 40%;}
}
@media (max-height:520px){
  .lo-pick{top:72px;}
  .lo-card .p{display:none;}
  /* [polish v149] phone landscape: the picker and the warm-up rules card cannot
     share 375 px — while the picker is up only the count stays, below it */
  body.lo-pick-open #mh-warmup .mode,body.lo-pick-open #mh-warmup .rules{display:none;}
  body.lo-pick-open #mh-warmup{top:64%;}
  body.lo-pick-open #mh-warmup .count{margin-top:0;}
  .lo-pick .hd .sub:nth-child(2){display:none;}   /* ran into the match clock */
}
`;
  document.head.appendChild(el);
}

export function getLoadoutUI(ctx) {
  if (typeof window !== "undefined" && window.__BR_LOADOUT_UI__) return window.__BR_LOADOUT_UI__;
  const ui = createLoadoutUI(ctx);
  if (typeof window !== "undefined") window.__BR_LOADOUT_UI__ = ui;
  return ui;
}

export function createLoadoutUI(ctx) {
  ensureStyle();
  const store = createLoadouts();
  const prog = () => (ctx && ctx.progression) ||
    (typeof window !== "undefined" && window.__FPS__ && window.__FPS__.progression) || null;
  const sim = () => (typeof window !== "undefined" && window.__FPS__ && window.__FPS__.sim) || null;
  const unlocked = (key) => {
    const p = prog();
    if (!p || typeof p.isUnlocked !== "function") return true;
    try { return !!p.isUnlocked(key); } catch (e) { return true; }
  };
  const unlockLv = (key) => {
    const p = prog();
    if (!p || typeof p.unlockLevel !== "function") return null;
    try { return p.unlockLevel(key); } catch (e) { return null; }
  };

  // keep the NEXT match's spec on the shared content object (boot passes it to createSim)
  function publishSpec() {
    if (!ctx || !ctx.content) return;
    ctx.content.pvpClassSelected = store.matchSpec(prog());
  }
  publishSpec();
  store.onChange(publishSpec);

  // [equipment lane] the TACTICAL slot. meta/loadouts.js update() copies only
  // name/primary/secondary/lethal/perks from a patch, so a tactical change that
  // the store ignores is written through the store's own record + reload (the
  // record is re-validated by classes.validateClass on that load). Once the
  // store copies `tactical` itself, the first branch does the whole job.
  function setTactical(i, id) {
    store.update(i, { tactical: id });
    const cur = store.get(i);
    if (cur && cur.tactical === id) return true;
    try {
      const rec = store.record();
      if (!rec.classes[i]) return false;
      rec.classes[i].tactical = id;
      localStorage.setItem(STORE_KEY, JSON.stringify(rec));
      store.reload();
      publishSpec();
      const c2 = store.get(i);
      return !!(c2 && c2.tactical === id);
    } catch (e) { return false; }
  }

  function classSummary(i) {
    const k = store.kitFor(i, prog());
    const perks = k.perks.filter(Boolean).map((id) => PERKS[id].name);
    const nAtt = (w) => (k.builds && k.builds[w] ? k.builds[w].attach.length : 0); // [gunsmith]
    return {
      name: k.name,
      weapons: [k.primary, k.secondary].filter(Boolean).map((w) => (WNAME[w] || w.toUpperCase()) + (nAtt(w) ? " +" + nAtt(w) : "")).join(" · ") +
        (k.lethal ? " · " + (EQUIPMENT_NAMES[k.lethal] || k.lethal.toUpperCase()) : "") +
        (k.tactical ? " · " + (EQUIPMENT_NAMES[k.tactical] || k.tactical.toUpperCase()) : ""),
      perks: perks.length ? perks.join(" · ") : "NO PERKS UNLOCKED",
      // [polish v149] a fresh profile saw five identical cards (locked primaries
      // fall back to the Warden): name what this class becomes, and when
      lock: lockedPrimaryNote(i, k),
      kit: k,
    };
  }
  function lockedPrimaryNote(i, k) {
    const c = store.get(i);
    if (!c || !c.primary || c.primary === k.primary) return "";
    const lv = unlockLv("weapon:" + c.primary);
    return (WNAME[c.primary] || c.primary.toUpperCase()) + (lv ? " AT LEVEL " + lv : " LOCKED");
  }

  // ======================================================== the CLASS EDITOR
  let edRoot = null, edIdx = 0, edOnClose = null, edDesc = "";
  let edGs = null;          // [gunsmith] weapon id while the gunsmith panel is open
  let gsFocus = null;       // [gunsmith] attachment / camo id the description panel shows
  let gsNote = "";          // [gunsmith] one-line refusal ("4 max", "unlocks at ...")

  function lockBadge(key) {
    if (unlocked(key)) return "";
    const lv = unlockLv(key);
    return `<span class="lv">${lv != null ? "LV " + lv : "LOCKED"}</span>`;
  }

  function optBtn(kind, id, title, desc, on, key, soon) {
    const lock = key && !unlocked(key);
    const cls = "lo-opt" + (on ? " on" : "") + (lock ? " lock" : "") + (soon ? " soon" : "");
    const badge = soon ? `<span class="lv">COMING</span>` : (key ? lockBadge(key) : "");
    return `<button class="${cls}" data-k="${kind}" data-id="${esc(id)}"${lock || soon ? ' aria-disabled="true"' : ""}>` +
      badge + `<div class="t">${esc(title)}</div>` + (desc ? `<div class="d">${esc(desc)}</div>` : "") + `</button>`;
  }

  // ---------------------------------------------------------------- gunsmith
  const buildOf = (c, w) => (c.builds && c.builds[w]) || { attach: [], camo: null };
  // unlock badge: attachment + weapon-camo keys ride the WEAPON's level
  function gsBadge(key) {
    if (!key || unlocked(key)) return "";
    const lv = unlockLv(key);
    const wpn = /^attach:|^camo:[a-z]+:/.test(key);
    return `<span class="lv">${lv != null ? (wpn ? "WPN LV " : "LV ") + lv : "LOCKED"}</span>`;
  }
  function gsLine(c, w) {
    const b = buildOf(c, w);
    const parts = b.attach.map((id) => ATTACHMENTS[id] ? ATTACHMENTS[id].short : id);
    const camo = b.camo && CAMOS[b.camo] ? CAMOS[b.camo].name : null;
    return `<button class="lo-gsl" data-gs="${esc(w)}"><b>GUNSMITH</b><span>${esc(WNAME[w] || w)}</span>` +
      `<span style="opacity:.75">${esc(parts.length ? parts.join(" · ") : "FACTORY")}${camo ? " · " + esc(camo) : ""}</span>` +
      `<span style="margin-left:auto;opacity:.5">${parts.length}/${MAX_ATTACH}</span></button>`;
  }
  function gsDescHTML(w, id) {
    if (id && ATTACHMENTS[id]) {
      const a = ATTACHMENTS[id];
      const lines = describeAttachment(w, id, PVP_WEAPONS[w]);
      const key = attachKey(w, id);
      const lock = key && !unlocked(key) ? `<div class="con">Unlocks at ${esc(WNAME[w])} level ${unlockLv(key)}</div>` : "";
      return `<div class="nm">${esc(a.name)}</div><div class="bl">${esc(a.blurb)}</div>` +
        lines.map((l) => `<div class="${l.neutral ? "" : l.good ? "pro" : "con"}">${l.neutral ? "· " : l.good ? "+ " : "- "}${esc(l.text)}</div>`).join("") + lock;
    }
    if (id && id.indexOf("camo:") === 0) {
      const cid = id.slice(5), cm = CAMOS[cid];
      if (!cm) return "";
      const key = camoKey(w, cid);
      const how = cm.scope === "weapon" ? `${WNAME[w]} level ${unlockLv(key)}` : `player level ${unlockLv(key)}`;
      return `<div class="nm">${esc(cm.name)} CAMO</div><div class="bl">${cm.scope === "weapon" ? "Weapon mastery finish." : "Career finish, any weapon."}</div>` +
        (unlocked(key) ? `<div class="pro">Unlocked</div>` : `<div class="con">Unlocks at ${esc(how)}</div>`);
    }
    if (id && id.indexOf("stock:") === 0) {
      const f = id.slice(6);
      return f ? `<div class="nm">${esc(attachName(f))}</div><div class="bl">The part this weapon ships with. Always available, never counts toward the ${MAX_ATTACH}.</div>`
        : `<div class="nm">EMPTY</div><div class="bl">Nothing mounted in this slot.</div>`;
    }
    return `<div class="nm">${esc(WNAME[w])}</div><div class="bl">${esc(WROLE[w])}. Up to ${MAX_ATTACH} attachments; factory parts are free. ` +
      `Every attachment trades something away: the bars show what changes.</div>`;
  }
  function gsStatsHTML(w, b) {
    const base = PVP_WEAPONS[w];
    // the bars show what DEPLOYS: a saved-but-locked part is not on the gun in a match
    const eff = effectiveWeapon(base, w, gateBuild(w, b, unlocked).attach);
    const sb = statLine(base), se = statLine(eff);
    return STAT_KEYS.map((k) => {
      const bv = sb[k].v, ev = se[k].v;
      const lo = Math.min(bv, ev) * 100, hi = Math.max(bv, ev) * 100;
      const dir = ev > bv + 1e-4 ? "up" : ev < bv - 1e-4 ? "dn" : "";
      const was = dir && sb[k].label !== se[k].label ? ` <span class="${dir}">(${esc(sb[k].label)})</span>` : "";
      return `<div class="lo-sr"><span class="lo-sn">${STAT_NAMES[k]}</span><span class="lo-sb"><i style="width:${lo.toFixed(1)}%"></i>` +
        (dir ? `<i class="${dir}" style="left:${lo.toFixed(1)}%;width:${(hi - lo).toFixed(1)}%"></i>` : "") +
        `</span><span class="lo-sv">${esc(se[k].label)}${was}</span></div>`;
    }).join("") + `<div class="lo-sr"><span class="lo-sn">FIRE RATE</span><span class="lo-sv" style="grid-column:2">${esc(se.rpm.label)}` +
      (se.rpm.raw !== sb.rpm.raw ? ` <span class="up">(${esc(sb.rpm.label)})</span>` : "") + `</span></div>`;
  }
  function renderGunsmith(c) {
    const w = edGs;
    const b = buildOf(c, w);
    const rows = SLOTS.map((slot) => {
      const opts = slotOptions(w, slot);
      const f = factoryPart(w, slot);
      const cur = attachInSlot(b, slot);
      if (!opts.length) {
        return `<div class="row"><div class="sl">${SLOT_NAMES[slot]}</div><button class="lo-opt soon" data-k="gsnone" data-id="" aria-disabled="true"><div class="t">NO MOUNT</div></button></div>`;
      }
      const btns = [];
      btns.push(`<button class="lo-opt${!cur ? " on" : ""}" data-k="gsslot" data-id="${slot}:" data-f="stock:${esc(f || "")}">` +
        `<div class="t">${esc(f ? attachName(f) : "NONE")}</div>${f ? `<div class="d">FACTORY</div>` : ""}</button>`);
      for (const id of opts) {
        if (id === f) continue;
        const key = attachKey(w, id);
        const lock = key && !unlocked(key);
        btns.push(`<button class="lo-opt${cur === id ? " on" : ""}${lock ? " lock" : ""}" data-k="gsslot" data-id="${slot}:${id}" data-f="${id}"${lock ? ' aria-disabled="true"' : ""}>` +
          gsBadge(key) + `<div class="t">${esc(ATTACHMENTS[id].name)}</div></button>`);
      }
      return `<div class="row"><div class="sl">${SLOT_NAMES[slot]}</div>${btns.join("")}</div>`;
    }).join("");
    const sw = [`<button class="lo-opt${!b.camo ? " on" : ""}" data-k="gscamo" data-id="" data-f="">` +
      `<span class="chip" style="background:linear-gradient(135deg,#2a2c2f,#151618)"></span><div class="t">FACTORY</div></button>`];
    for (const cid of CAMO_IDS) {
      const cm = CAMOS[cid], key = camoKey(w, cid), lock = !unlocked(key);
      const g = `linear-gradient(135deg,${cm.colors[0]} 0 38%,${cm.colors[1]} 38% 68%,${cm.colors[2]} 68%)`;
      sw.push(`<button class="lo-opt${b.camo === cid ? " on" : ""}${lock ? " lock" : ""}" data-k="gscamo" data-id="${cid}" data-f="camo:${cid}"${lock ? ' aria-disabled="true"' : ""}>` +
        `<span class="chip" style="background:${g}"></span><div class="t">${esc(cm.name)}</div>${gsBadge(key)}</button>`);
    }
    edRoot.querySelector(".lo-ed").innerHTML =
      `<div class="lo-det"><div class="lo-gs"><div class="col1">` +
      `<div class="hd"><span class="ti">${esc(WNAME[w])}</span><span class="cnt">${esc(c.name)} · ${b.attach.length}/${MAX_ATTACH} ATTACHMENTS</span></div>` +
      rows +
      `<div class="lo-sec">Camo</div><div class="lo-sw">${sw.join("")}</div>` +
      (gsNote ? `<div class="lo-warn">${esc(gsNote)}</div>` : "") +
      `</div><div class="col2"><div class="lo-sec" style="margin-top:4px">Stats</div><div class="lo-st">${gsStatsHTML(w, b)}</div>` +
      `<div class="lo-gsd">${gsDescHTML(w, gsFocus)}</div></div></div>` +
      `<div class="lo-foot"><button class="lo-btn pri" data-act="gsback">Back to class</button>` +
      `<button class="lo-btn" data-act="gsclear">Strip to factory</button>` +
      `<span class="lo-hint">Tab / arrows · Enter fit · Esc back</span></div></div>`;
  }
  function gsSetDesc(id) {
    if (!edRoot || !edGs) return;
    gsFocus = id || null;
    const d = edRoot.querySelector(".lo-gsd");
    if (d) d.innerHTML = gsDescHTML(edGs, gsFocus);
  }
  function gsClick(t) {
    const c = store.get(edIdx);
    const w = edGs;
    const b = buildOf(c, w);
    const k = t.getAttribute("data-k"), id = t.getAttribute("data-id") || "";
    gsNote = "";
    if (k === "gsslot") {
      const [slot, att] = id.split(":");
      if (att) {
        const key = attachKey(w, att);
        gsFocus = att;
        if (key && !unlocked(key)) { gsNote = `${ATTACHMENTS[att].name} unlocks at ${WNAME[w]} level ${unlockLv(key)}`; renderEditor(); return; }
      } else gsFocus = t.getAttribute("data-f") || null;
      const next = b.attach.filter((x) => !(ATTACHMENTS[x] && ATTACHMENTS[x].slot === slot));
      if (att) next.push(att);
      if (next.length > MAX_ATTACH) { gsNote = `${MAX_ATTACH} attachments max: clear a slot first`; renderEditor(); return; }
      store.update(edIdx, { build: { weapon: w, attach: next } });
    } else if (k === "gscamo") {
      gsFocus = id ? "camo:" + id : null;
      if (id && !unlocked(camoKey(w, id))) { gsNote = `${CAMOS[id].name} is locked`; renderEditor(); return; }
      store.update(edIdx, { build: { weapon: w, camo: id || null } });
    }
    renderEditor();
  }
  // arrow keys walk the gunsmith grid (rows = slots / camo strip); the pad's spatial
  // focus walks the same buttons
  function gsArrow(code) {
    const all = Array.from(edRoot.querySelectorAll(".lo-gs button, .lo-foot button"));
    const cur = document.activeElement && all.indexOf(document.activeElement) >= 0 ? document.activeElement : null;
    if (!cur) { const f = edRoot.querySelector(".lo-gs .lo-opt.on") || all[0]; if (f) f.focus(); return; }
    const r0 = cur.getBoundingClientRect();
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    let best = null, bd = Infinity;
    for (const el of all) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const dx = x - cx, dy = y - cy;
      const ok = code === "ArrowRight" ? dx > 4 && Math.abs(dy) < r0.height : code === "ArrowLeft" ? dx < -4 && Math.abs(dy) < r0.height
        : code === "ArrowDown" ? dy > 4 : dy < -4;
      if (!ok) continue;
      const d = code === "ArrowDown" || code === "ArrowUp" ? Math.abs(dy) + Math.abs(dx) * 0.35 : Math.abs(dx) + Math.abs(dy) * 3;
      if (d < bd) { bd = d; best = el; }
    }
    if (best) { best.focus(); if (best.scrollIntoView) best.scrollIntoView({ block: "nearest" }); }
  }

  function renderEditor() {
    if (!edRoot) return;
    const classes = store.classes();
    const sel = store.selected();
    const c = classes[edIdx];
    if (edGs && c.primary !== edGs && c.secondary !== edGs) edGs = null;
    if (edGs) { renderGunsmith(c); return; }
    const tabs = classes.map((x, i) => {
      const s = classSummary(i);
      return `<button class="lo-tab${i === edIdx ? " on" : ""}" data-tab="${i}">` +
        `<span class="k">${i + 1}</span><span><span class="n">${esc(x.name)}</span>` +
        `<span class="w">${esc(WNAME[s.kit.primary] || "")}</span></span>` +
        (i === sel ? `<span class="act">ACTIVE</span>` : "") + `</button>`;
    }).join("");
    const prim = PRIMARIES.map((w) => optBtn("primary", w, WNAME[w], WROLE[w], c.primary === w, "weapon:" + w)).join("");
    const sec = SECONDARIES.map((w) => optBtn("secondary", w, WNAME[w], WROLE[w], c.secondary === w, "weapon:" + w)).join("");
    const leth = Object.keys(LETHALS).map((id) => optBtn("lethal", id, EQUIPMENT_NAMES[id], "x" + LETHALS[id].count, c.lethal === id, "equip:" + id)).join("");
    const tact = Object.keys(TACTICALS).map((id) => optBtn("tactical", id, EQUIPMENT_NAMES[id], "x" + TACTICALS[id].count, c.tactical === id, "equip:" + id)).join("");
    const perkRows = PERKS_BY_TIER.map((ids, ti) =>
      `<div class="lo-sec">${TIER_LABEL[ti]}</div><div class="lo-opts">` +
      ids.map((id) => optBtn("perk" + (ti + 1), id, PERKS[id].name, "", c.perks[ti] === id, "perk:" + id)).join("") +
      `</div>`).join("");
    // what the match will actually issue (locks resolved), if it differs
    const kit = store.kitFor(edIdx, prog());
    const lockedOut = [];
    if (kit.primary !== c.primary) lockedOut.push(WNAME[c.primary] + " → " + (WNAME[kit.primary] || "none"));
    c.perks.forEach((p, ti) => { if (p && kit.perks[ti] !== p) lockedOut.push(PERKS[p].name + " → " + (kit.perks[ti] ? PERKS[kit.perks[ti]].name : "empty")); });
    if (c.lethal && kit.lethal !== c.lethal) lockedOut.push((EQUIPMENT_NAMES[c.lethal] || c.lethal) + " → none");
    if (c.tactical && kit.tactical !== c.tactical) lockedOut.push((EQUIPMENT_NAMES[c.tactical] || c.tactical) + " → none");
    for (const w of [kit.primary, kit.secondary]) {          // [gunsmith] locked parts deploy without them
      if (!w) continue;
      const want = buildOf(c, w), got = (kit.builds && kit.builds[w]) || { attach: [], camo: null };
      for (const id of want.attach) if (got.attach.indexOf(id) < 0) lockedOut.push(attachName(id) + " → removed");
      if (want.camo && got.camo !== want.camo) lockedOut.push(CAMOS[want.camo].name + " camo → factory");
    }

    edRoot.querySelector(".lo-ed").innerHTML =
      `<div class="lo-list"><h2>Classes</h2>${tabs}</div>` +
      `<div class="lo-det">` +
      `<input class="lo-name" maxlength="${NAME_MAX}" value="${esc(c.name)}" aria-label="Class name" spellcheck="false">` +
      `<div class="lo-sec">Primary</div><div class="lo-opts">${prim}</div>${gsLine(c, c.primary)}` +
      `<div class="lo-sec">Secondary</div><div class="lo-opts">${sec}</div>${gsLine(c, c.secondary)}` +
      `<div class="lo-sec">Lethal</div><div class="lo-opts">${leth}</div>` +
      `<div class="lo-sec">Tactical</div><div class="lo-opts">${tact}</div>` +
      perkRows +
      `<div class="lo-desc">${esc(edDesc)}</div>` +
      (lockedOut.length ? `<div class="lo-warn">LOCKED — DEPLOYS AS: ${esc(lockedOut.join(" · "))}</div>` : "") +
      `<div class="lo-foot">` +
      `<button class="lo-btn pri" data-act="use">${edIdx === sel ? "Active class" : "Set active"}</button>` +
      `<button class="lo-btn" data-act="reset">Reset class</button>` +
      `<button class="lo-btn" data-act="done">Done</button>` +
      `<span class="lo-hint">1-5 class · Tab / Enter · Esc done</span>` +
      `</div></div>`;
    const nm = edRoot.querySelector(".lo-name");
    nm.addEventListener("change", () => { store.update(edIdx, { name: nm.value }); renderEditor(); });
    nm.addEventListener("keydown", (e) => { if (e.key === "Enter") nm.blur(); e.stopPropagation(); });
  }

  function onEditorClick(e) {
    const t = e.target && e.target.closest ? e.target.closest("button") : null;
    if (!t || !edRoot.contains(t)) return;
    if (t.hasAttribute("data-tab")) { edIdx = +t.getAttribute("data-tab"); edDesc = ""; renderEditor(); return; }
    const act = t.getAttribute("data-act");
    // [gunsmith]
    if (t.hasAttribute("data-gs")) { edGs = t.getAttribute("data-gs"); gsFocus = null; gsNote = ""; renderEditor(); focusGs(); return; }
    if (act === "gsback") { gsBack(); return; }
    if (act === "gsclear") { store.update(edIdx, { build: { weapon: edGs, attach: [], camo: null } }); gsFocus = null; gsNote = ""; renderEditor(); return; }
    if (edGs && /^gs/.test(t.getAttribute("data-k") || "")) { gsClick(t); focusGs(t.getAttribute("data-k"), t.getAttribute("data-id")); return; }
    if (act === "use") { store.select(edIdx); renderEditor(); return; }
    if (act === "reset") { store.reset(edIdx); edDesc = ""; renderEditor(); return; }
    if (act === "done") { closeEditor(); return; }
    const k = t.getAttribute("data-k"), id = t.getAttribute("data-id");
    if (!k) return;
    const key = k === "primary" || k === "secondary" ? "weapon:" + id : k === "lethal" || k === "tactical" ? "equip:" + id : "perk:" + id;
    if (k.startsWith("perk")) edDesc = PERKS[id].name + " — " + PERKS[id].desc;
    else if (k === "lethal") edDesc = LETHALS[id].name + " — " + LETHALS[id].desc;
    else if (k === "tactical") edDesc = TACTICALS[id].name + " — " + TACTICALS[id].desc;
    else edDesc = WNAME[id] + " — " + WROLE[id];
    if (!unlocked(key)) {
      const lv = unlockLv(key);
      edDesc += lv != null ? `  (unlocks at level ${lv})` : "  (locked)";
      renderEditor();
      return;
    }
    if (k.startsWith("perk")) store.update(edIdx, { perk: { tier: +k.slice(4), id } });
    else if (k === "tactical") setTactical(edIdx, id);
    else store.update(edIdx, { [k]: id });
    renderEditor();
  }

  function focusGs(k, id) {
    const el = (k && edRoot.querySelector(`[data-k="${k}"][data-id="${id}"]`)) || edRoot.querySelector(".lo-gs .lo-opt.on") || edRoot.querySelector(".lo-gs .lo-opt");
    if (el && el.focus) el.focus();
  }
  function gsBack() {
    const w = edGs; edGs = null; renderEditor();
    const b = edRoot.querySelector(`[data-gs="${w}"]`);
    if (b && b.focus) b.focus();
  }
  function onEditorHover(e) {
    if (!edGs) return;
    const t = e.target && e.target.closest ? e.target.closest("[data-f]") : null;
    if (t && edRoot.contains(t)) gsSetDesc(t.getAttribute("data-f"));
  }

  function openEditor(onClose) {
    edOnClose = onClose || null;
    edIdx = store.selected();
    edDesc = "";
    edGs = null;
    if (!edRoot) {
      edRoot = document.createElement("div");
      edRoot.className = "lo-ov";
      edRoot.id = "lo-editor";
      edRoot.innerHTML = `<div class="lo-wash"></div><div class="lo-ed" role="dialog" aria-label="Class editor"></div>`;
      edRoot.addEventListener("click", onEditorClick);
      edRoot.addEventListener("mouseover", onEditorHover);   // [gunsmith] description follows the pointer
      edRoot.addEventListener("focusin", onEditorHover);     // ... and keyboard / pad focus
      document.body.appendChild(edRoot);
    }
    edRoot.style.display = "block";
    renderEditor();
    const first = edRoot.querySelector(".lo-tab.on");
    if (first && first.focus) first.focus();
  }
  function closeEditor() {
    if (!edRoot || edRoot.style.display === "none") return;
    edRoot.style.display = "none";
    const cb = edOnClose; edOnClose = null;
    if (cb) cb();
  }
  const editorOpen = () => !!(edRoot && edRoot.style.display !== "none");

  // ======================================================== the CLASS PICKER
  let pkRoot = null, pkMode = null, chip = null;
  let pkFocus = -1; // [polish v149] controller focus inside the picker

  function classMatch() {
    const s = sim();
    return !!(s && s.match && s.classes && s.classes.on);
  }
  function matchPhase() {
    const s = sim();
    return s && s.state && s.state.match ? s.state.match.phase : null;
  }

  function renderPicker() {
    if (!pkRoot) return;
    const s = sim();
    const curName = s && s.classes && s.classes.playerKit ? s.classes.playerKit.classId : null;
    const pend = s && s.classes ? s.classes.pendingKit : null;
    const sel = store.selected();
    const cards = [];
    for (let i = 0; i < CLASS_COUNT; i++) {
      const sm = classSummary(i);
      const on = pend ? pend.classId === i : curName === i;
      cards.push(`<button class="lo-card${on ? (pend ? " next" : " on") : ""}${pkFocus === i ? " focus" : ""}" data-pick="${i}">` +
        `<div class="k">${i + 1}${i === sel ? " · SAVED" : ""}</div><div class="n">${esc(sm.name)}</div>` +
        `<div class="w">${esc(sm.weapons)}</div><div class="p">${sm.lock ? `<b class="lk">${esc(sm.lock)}</b>` : esc(sm.perks)}</div></button>`);
    }
    const sub = pkMode === "start"
      ? "warm-up · <b>your pick deploys now</b>"
      : pend ? `next life: <b>${esc(pend.name)}</b>` : "applies when you redeploy";
    const dev = (ctx && ctx.input && ctx.input.lastDevice) === "pad" ? "pad"
      : (typeof document !== "undefined" && document.body.classList.contains("br-touch")) ? "touch"
      : ctx && ctx.input && ctx.input.lastDevice;
    const keysHint = dev === "pad" ? "◀ ▶ choose · A select · B close" : dev === "touch" ? "tap a class" : "1-5 choose · L close";
    pkRoot.innerHTML =
      `<div class="hd"><span class="ti">SELECT CLASS</span><span class="sub">${sub}</span>` +
      `<span class="sub" style="margin-left:auto">${keysHint}</span></div>` +
      `<div class="lo-cards">${cards.join("")}</div>`;
  }

  function openPicker(mode) {
    if (!classMatch()) return false;
    pkMode = mode || (matchPhase() === "warmup" ? "start" : "respawn");
    if (!pkRoot) {
      pkRoot = document.createElement("div");
      pkRoot.className = "lo-pick";
      pkRoot.id = "lo-picker";
      pkRoot.addEventListener("click", (e) => {
        const t = e.target && e.target.closest ? e.target.closest("[data-pick]") : null;
        if (t) pick(+t.getAttribute("data-pick"));
      });
      document.body.appendChild(pkRoot);
    }
    pkRoot.style.display = "block";
    if (typeof document !== "undefined") document.body.classList.add("lo-pick-open");
    if (pkFocus < 0) pkFocus = store.selected();
    renderPicker();
    syncHint();
    return true;
  }
  function closePicker() {
    if (pkRoot) pkRoot.style.display = "none"; pkMode = null; pkFocus = -1;
    if (typeof document !== "undefined") document.body.classList.remove("lo-pick-open");
    syncHint();
  }
  const pickerOpen = () => !!(pkRoot && pkRoot.style.display !== "none");

  // [polish v149] the kill cam now runs right up to the respawn, so the picker
  // that used to open after it was only reachable by skipping the replay. While
  // you are down, a hint names the key / button for the device in hand (a
  // tappable button on touch); the pick becomes the coming respawn's class.
  let hintEl = null, hintSig = "";
  function playerDown() {
    const s = sim();
    return !!(s && s.state && s.state.player && !s.state.player.alive);
  }
  function syncHint() {
    if (typeof document === "undefined") return;
    const ph = matchPhase();
    const show = classMatch() && playerDown() && !pickerOpen() && (ph === "live" || ph === "overtime");
    if (!show) { if (hintEl && hintEl.style.display !== "none") hintEl.style.display = "none"; return; }
    if (!hintEl) {
      hintEl = document.createElement("button");
      hintEl.className = "lo-hint";
      hintEl.type = "button";
      hintEl.addEventListener("click", (e) => { e.preventDefault(); openPicker("respawn"); });
      document.body.appendChild(hintEl);
    }
    const s = sim();
    const pend = s && s.classes ? s.classes.pendingKit : null;
    const inp = ctx && ctx.input;
    const dev = inp && inp.lastDevice === "pad" ? "pad" : document.body.classList.contains("br-touch") ? "touch" : inp && inp.lastDevice;
    const key = dev === "pad" ? (inp.glyph ? inp.glyph("swap") : "Y") : dev === "touch" ? "" : "L";
    const sig = dev + "|" + key + "|" + (pend ? pend.name : "");
    if (sig !== hintSig) {
      hintSig = sig;
      hintEl.innerHTML = (key ? `<kbd>${esc(key)}</kbd>` : "") +
        (dev === "touch" ? "TAP — CHANGE CLASS" : "CHANGE CLASS") +
        (pend ? ` · next life <b>${esc(pend.name)}</b>` : "");
    }
    hintEl.style.display = "block";
  }
  if (typeof setInterval === "function") setInterval(syncHint, 200); // wall clock: rAF may be paused

  // controller access (input_gamepad.js): Y while down toggles the picker;
  // while it is open the D-pad moves the focus, A picks, B closes
  function stepFocus(d) {
    if (!pickerOpen()) return;
    pkFocus = ((pkFocus < 0 ? store.selected() : pkFocus) + d + CLASS_COUNT) % CLASS_COUNT;
    renderPicker();
  }
  globalThis.__BR_CLASSPICK__ = {
    available: () => classMatch() && matchPhase() !== "ended",
    down: playerDown,
    isOpen: pickerOpen,
    toggle() { if (pickerOpen()) closePicker(); else openPicker(); },
    step: stepFocus,
    confirm() { if (pickerOpen()) pick(pkFocus < 0 ? store.selected() : pkFocus); },
    close: closePicker,
  };

  function pick(i) {
    if (!(i >= 0 && i < CLASS_COUNT)) return null;
    store.select(i); // persists + republishes the next match's spec
    const s = sim();
    let kit = null;
    if (s && typeof s.setPlayerClass === "function" && s.classes && s.classes.on) {
      const immediate = matchPhase() === "warmup" && s.state.player.alive;
      kit = s.setPlayerClass(store.kitFor(i, prog()), { classId: i, immediate });
      if (immediate) { closePicker(); return kit; }
    }
    renderPicker();
    return kit;
  }

  function syncChip() {
    const touch = !!(ctx && ctx.touch) || (typeof matchMedia === "function" && matchMedia("(pointer:coarse)").matches);
    // [polish v149] warm-up only: while you are down the CHANGE CLASS hint is the
    // tap target, and mid-fight the top-left belongs to pause / score / call-ins
    const show = touch && classMatch() && matchPhase() === "warmup";
    if (show && !chip) {
      chip = document.createElement("button");
      chip.className = "lo-chip";
      chip.textContent = "CLASS";
      chip.addEventListener("click", () => (pickerOpen() ? closePicker() : openPicker()));
      document.body.appendChild(chip);
    }
    if (chip) chip.style.display = show ? "block" : "none";
  }

  // keyboard — capture phase on window, so a digit that picks a class never
  // ALSO reaches input.js as a weapon switch
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", (e) => {
      const tgt = e.target;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA")) return;
      const digit = /^Digit([1-5])$/.exec(e.code);
      if (editorOpen()) {
        if (digit) { edIdx = +digit[1] - 1; edDesc = ""; edGs = null; renderEditor(); e.preventDefault(); e.stopPropagation(); }
        else if (e.code === "Escape" && edGs) { gsBack(); e.preventDefault(); e.stopPropagation(); }   // [gunsmith] back first
        else if (e.code === "Escape") { closeEditor(); e.preventDefault(); e.stopPropagation(); }
        else if (edGs && /^Arrow(Up|Down|Left|Right)$/.test(e.code)) { gsArrow(e.code); e.preventDefault(); e.stopPropagation(); }
        return;
      }
      if (e.code === "KeyL" && classMatch() && matchPhase() !== "ended") {
        if (pickerOpen()) closePicker(); else openPicker();
        e.preventDefault(); e.stopPropagation();
        return;
      }
      if (!pickerOpen()) return;
      if (digit) { pick(+digit[1] - 1); e.preventDefault(); e.stopPropagation(); }
      else if (e.code === "Escape") { closePicker(); e.preventDefault(); e.stopPropagation(); }
    }, true);
  }

  // bridge: warm-up opens the picker, going live closes it; your death opens
  // it, your respawn closes it
  function attach(bridge) {
    if (!bridge) return;
    bridge.register("match:state", (d) => {
      syncChip();
      if (!d) return;
      if (d.phase === "warmup") openPicker("start");
      else if (d.phase === "live" && pkMode === "start") closePicker();
      else if (d.phase === "ended") closePicker();
    });
    bridge.register("death", (d) => {
      if (!(d && d.victim === "P" && classMatch() && matchPhase() !== "ended")) return;
      // [integration v146] wait for the killcam replay; poll on wall clock (rAF may be paused)
      const kc = () => { try { return window.__FPS__ && window.__FPS__.killcam && window.__FPS__.killcam.isReplaying(); } catch (e) { return false; } };
      let tries = 0;
      const tick = () => {
        if (matchPhase() === "ended") return;
        const st = ctx.sim && ctx.sim() && ctx.sim().state;
        if (st && st.player && st.player.alive) return;          // already respawned
        if (kc() && tries++ < 60) { setTimeout(tick, 150); return; }
        openPicker("respawn");
      };
      setTimeout(tick, 200);
    });
    bridge.register("respawn", (d) => { if (d && d.who === "P" && pkMode === "respawn") closePicker(); syncChip(); });
    bridge.register("mission:start", () => syncChip());
    bridge.register("mission:end", () => { closePicker(); syncChip(); });
  }
  if (ctx && ctx.bridge && !ctx.bridge.__loadoutRewire) {
    ctx.bridge.__loadoutRewire = true;
    const prevClear = ctx.bridge.clear.bind(ctx.bridge);
    ctx.bridge.clear = () => { prevClear(); closePicker(); attach(ctx.bridge); };
    attach(ctx.bridge);
  }

  return {
    store, openEditor, closeEditor, editorOpen, openPicker, closePicker, pickerOpen, pick,
    classSummary, publishSpec,
    // [gunsmith] open the editor straight on a weapon's gunsmith panel (tests / deep links)
    openGunsmith(weaponId, classIdx) {
      openEditor(); if (classIdx != null) edIdx = classIdx | 0;
      edGs = weaponId; gsFocus = null; gsNote = ""; renderEditor(); focusGs();
    },
  };
}
