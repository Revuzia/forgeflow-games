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
  PRIMARIES, SECONDARIES, LETHALS, EQUIPMENT_COMING, EQUIPMENT_NAMES,
  PERKS, PERKS_BY_TIER, CLASS_COUNT, NAME_MAX,
} from "../sim/classes.js";
import { createLoadouts } from "../meta/loadouts.js";

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
.lo-chip{position:fixed;left:12px;top:12px;z-index:57;cursor:pointer;font-family:var(--a10-ui-font,system-ui);
  font-size:10.5px;letter-spacing:.24em;padding:8px 12px;background:rgba(6,8,12,.6);
  border:1px solid rgba(232,232,228,.25);color:rgba(232,232,228,.85);}
@media (max-width:720px){
  .lo-ed{flex-direction:column;gap:14px;padding:14px 16px;}
  .lo-list{flex:0 0 auto;flex-direction:row;flex-wrap:wrap;}
  .lo-tab{flex:1 1 120px;}
  .lo-cards{flex-wrap:wrap;}
  .lo-card{flex:1 1 30%;}
  .lo-opt{min-width:0;flex:1 1 40%;}
}
@media (max-height:520px){
  .lo-pick{top:56px;}
  .lo-card .p{display:none;}
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

  function classSummary(i) {
    const k = store.kitFor(i, prog());
    const perks = k.perks.filter(Boolean).map((id) => PERKS[id].name);
    return {
      name: k.name,
      weapons: [k.primary, k.secondary].filter(Boolean).map((w) => WNAME[w] || w.toUpperCase()).join(" · ") +
        (k.lethal ? " · " + (EQUIPMENT_NAMES[k.lethal] || k.lethal.toUpperCase()) : ""),
      perks: perks.length ? perks.join(" · ") : "NO PERKS UNLOCKED",
      kit: k,
    };
  }

  // ======================================================== the CLASS EDITOR
  let edRoot = null, edIdx = 0, edOnClose = null, edDesc = "";

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

  function renderEditor() {
    if (!edRoot) return;
    const classes = store.classes();
    const sel = store.selected();
    const c = classes[edIdx];
    const tabs = classes.map((x, i) => {
      const s = classSummary(i);
      return `<button class="lo-tab${i === edIdx ? " on" : ""}" data-tab="${i}">` +
        `<span class="k">${i + 1}</span><span><span class="n">${esc(x.name)}</span>` +
        `<span class="w">${esc(WNAME[s.kit.primary] || "")}</span></span>` +
        (i === sel ? `<span class="act">ACTIVE</span>` : "") + `</button>`;
    }).join("");
    const prim = PRIMARIES.map((w) => optBtn("primary", w, WNAME[w], WROLE[w], c.primary === w, "weapon:" + w)).join("");
    const sec = SECONDARIES.map((w) => optBtn("secondary", w, WNAME[w], WROLE[w], c.secondary === w, "weapon:" + w)).join("");
    const leth = Object.keys(LETHALS).map((id) => optBtn("lethal", id, EQUIPMENT_NAMES[id], "x" + LETHALS[id].count, c.lethal === id, "equip:" + id))
      .concat(EQUIPMENT_COMING.map((id) => optBtn("soon", id, EQUIPMENT_NAMES[id] || id, "", false, null, true))).join("");
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

    edRoot.querySelector(".lo-ed").innerHTML =
      `<div class="lo-list"><h2>Classes</h2>${tabs}</div>` +
      `<div class="lo-det">` +
      `<input class="lo-name" maxlength="${NAME_MAX}" value="${esc(c.name)}" aria-label="Class name" spellcheck="false">` +
      `<div class="lo-sec">Primary</div><div class="lo-opts">${prim}</div>` +
      `<div class="lo-sec">Secondary</div><div class="lo-opts">${sec}</div>` +
      `<div class="lo-sec">Lethal</div><div class="lo-opts">${leth}</div>` +
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
    if (act === "use") { store.select(edIdx); renderEditor(); return; }
    if (act === "reset") { store.reset(edIdx); edDesc = ""; renderEditor(); return; }
    if (act === "done") { closeEditor(); return; }
    const k = t.getAttribute("data-k"), id = t.getAttribute("data-id");
    if (!k) return;
    if (k === "soon") { edDesc = (EQUIPMENT_NAMES[id] || id) + " — not in service yet."; renderEditor(); return; }
    const key = k === "primary" || k === "secondary" ? "weapon:" + id : k === "lethal" ? "equip:" + id : "perk:" + id;
    if (k.startsWith("perk")) edDesc = PERKS[id].name + " — " + PERKS[id].desc;
    else if (k === "lethal") edDesc = LETHALS[id].name + " — " + LETHALS[id].desc;
    else edDesc = WNAME[id] + " — " + WROLE[id];
    if (!unlocked(key)) {
      const lv = unlockLv(key);
      edDesc += lv != null ? `  (unlocks at level ${lv})` : "  (locked)";
      renderEditor();
      return;
    }
    if (k.startsWith("perk")) store.update(edIdx, { perk: { tier: +k.slice(4), id } });
    else store.update(edIdx, { [k]: id });
    renderEditor();
  }

  function openEditor(onClose) {
    edOnClose = onClose || null;
    edIdx = store.selected();
    edDesc = "";
    if (!edRoot) {
      edRoot = document.createElement("div");
      edRoot.className = "lo-ov";
      edRoot.id = "lo-editor";
      edRoot.innerHTML = `<div class="lo-wash"></div><div class="lo-ed" role="dialog" aria-label="Class editor"></div>`;
      edRoot.addEventListener("click", onEditorClick);
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
      cards.push(`<button class="lo-card${on ? (pend ? " next" : " on") : ""}" data-pick="${i}">` +
        `<div class="k">${i + 1}${i === sel ? " · SAVED" : ""}</div><div class="n">${esc(sm.name)}</div>` +
        `<div class="w">${esc(sm.weapons)}</div><div class="p">${esc(sm.perks)}</div></button>`);
    }
    const sub = pkMode === "start"
      ? "warm-up · <b>your pick deploys now</b>"
      : pend ? `next life: <b>${esc(pend.name)}</b>` : "applies when you redeploy";
    pkRoot.innerHTML =
      `<div class="hd"><span class="ti">SELECT CLASS</span><span class="sub">${sub}</span>` +
      `<span class="sub" style="margin-left:auto">1-5 choose · L close</span></div>` +
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
    renderPicker();
    return true;
  }
  function closePicker() { if (pkRoot) pkRoot.style.display = "none"; pkMode = null; }
  const pickerOpen = () => !!(pkRoot && pkRoot.style.display !== "none");

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
    const show = touch && classMatch() && matchPhase() !== "ended";
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
        if (digit) { edIdx = +digit[1] - 1; edDesc = ""; renderEditor(); e.preventDefault(); e.stopPropagation(); }
        else if (e.code === "Escape") { closeEditor(); e.preventDefault(); e.stopPropagation(); }
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
    bridge.register("death", (d) => { if (d && d.victim === "P" && classMatch() && matchPhase() !== "ended") openPicker("respawn"); });
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
  };
}
