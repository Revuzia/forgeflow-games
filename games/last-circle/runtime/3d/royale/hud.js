/**
 * royale/hud.js — every screen and overlay: main menu (map/mode select),
 * lobby fill, in-game HUD (bars, slots, mats, minimap w/ storm rings, kill
 * feed, storm timer, alive count, crosshair, hitmarker, interact hints,
 * scope + storm tints), pause, settings (volumes, sensitivity, graphics,
 * keybind remap), death/spectate, post-match stats, victory.
 *
 * All DOM (crisp text > canvas). Dynamic values only touch the DOM when they
 * change; the minimap canvas redraws at ~10Hz.
 */

let R = {};            // element registry
let K = null;
let feedTimer = [];

const css = (el, o) => { Object.assign(el.style, o); return el; };
function h(tag, styles, text, parent) {
  const el = document.createElement(tag);
  if (styles) css(el, styles);
  if (text != null) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}
const FONT = "system-ui, 'Segoe UI', sans-serif";
const PANEL = { background: "rgba(10,19,31,0.92)", border: "1px solid rgba(120,180,255,0.25)", borderRadius: "14px", boxShadow: "0 8px 40px rgba(0,0,0,0.5)" };
const BTN = { padding: "12px 26px", borderRadius: "10px", border: "none", cursor: "pointer", fontWeight: "800", fontSize: "16px", fontFamily: FONT, letterSpacing: "0.5px" };

export function init(W) {
  K = W.SIM;
  const root = h("div", { position: "absolute", inset: "0", pointerEvents: "none", fontFamily: FONT, zIndex: 40, color: "#eaf2ff", userSelect: "none" });
  W.kernel.parent.appendChild(root);
  R = { root };
  wireEvents(W);
}

function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
function layer(name, styles) {
  if (R[name]) { clear(R[name]); R[name].remove(); }
  R[name] = h("div", Object.assign({ position: "absolute", inset: "0", pointerEvents: "none" }, styles || {}), null, R.root);
  return R[name];
}

// ═══ MENU ════════════════════════════════════════════════════════════════════
const MAP_CARDS = [
  { id: "isla_viva", name: "Isla Viva", sub: "Vibrant tropical island", c1: "#0ea877", c2: "#1a4a66" },
  { id: "ashgrid", name: "Ashgrid", sub: "Urban city ruins", c1: "#7d8489", c2: "#3a2f2c" },
  { id: "deepwood", name: "Deepwood", sub: "Dense forest wilderness", c1: "#2f6b3a", c2: "#14331c" },
];
const MODE_CARDS = [
  { id: "standard", name: "BATTLE ROYALE", sub: "50 players · last one standing · 10–15 min" },
  { id: "quick", name: "QUICK MATCH", sub: "5-minute storm · double loot · hot start" },
  { id: "practice", name: "PRACTICE", sub: "No storm · range, free build, movement course" },
];

export function showMenu(W, startMatch) {
  W.phase = "menu";
  document.exitPointerLock && document.exitPointerLock();
  hideHUD();
  const L = layer("menu", { pointerEvents: "auto", background: "radial-gradient(1200px 700px at 50% 20%, rgba(30,60,110,0.55), rgba(6,12,22,0.95))" });
  const wrap = h("div", { position: "absolute", inset: "0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "22px" }, null, L);

  h("div", { fontSize: "62px", fontWeight: "900", letterSpacing: "6px", textShadow: "0 0 30px rgba(80,160,255,0.7), 0 4px 0 rgba(0,0,0,0.5)" }, "LAST CIRCLE", wrap);
  h("div", { fontSize: "15px", opacity: "0.75", marginTop: "-16px", letterSpacing: "3px" }, "50 DROP · ONE STANDS", wrap);

  // mode select
  const modeRow = h("div", { display: "flex", gap: "14px" }, null, wrap);
  let selMode = W.mode === "practice" ? "practice" : W.mode;
  let selMap = W.mapId;
  const modeEls = MODE_CARDS.map((m) => {
    const c = h("div", Object.assign({ padding: "14px 20px", cursor: "pointer", textAlign: "center", minWidth: "200px", transition: "transform .12s" }, PANEL), null, modeRow);
    h("div", { fontWeight: "900", fontSize: "17px", letterSpacing: "1px" }, m.name, c);
    h("div", { fontSize: "12px", opacity: "0.7", marginTop: "4px" }, m.sub, c);
    c.onclick = () => { selMode = m.id; W.events.emit("uiClick"); paint(); };
    return { m, c };
  });
  // map select
  const mapRow = h("div", { display: "flex", gap: "14px" }, null, wrap);
  const mapEls = MAP_CARDS.map((m) => {
    const c = h("div", Object.assign({ width: "190px", height: "110px", cursor: "pointer", overflow: "hidden", position: "relative", transition: "transform .12s" }, PANEL, { background: `linear-gradient(145deg, ${m.c1}, ${m.c2})` }), null, mapRow);
    h("div", { position: "absolute", left: "12px", bottom: "26px", fontWeight: "900", fontSize: "19px", textShadow: "0 2px 6px rgba(0,0,0,0.7)" }, m.name, c);
    h("div", { position: "absolute", left: "12px", bottom: "9px", fontSize: "11px", opacity: "0.85" }, m.sub, c);
    c.onclick = () => { selMap = m.id; W.events.emit("uiClick"); paint(); };
    return { m, c };
  });
  function paint() {
    modeEls.forEach(({ m, c }) => { c.style.outline = m.id === selMode ? "2px solid #57b0ff" : "none"; c.style.transform = m.id === selMode ? "scale(1.04)" : "scale(1)"; });
    mapEls.forEach(({ m, c }) => { c.style.outline = m.id === selMap ? "2px solid #57b0ff" : "none"; c.style.transform = m.id === selMap ? "scale(1.04)" : "scale(1)"; });
  }
  paint();

  const btnRow = h("div", { display: "flex", gap: "14px", alignItems: "center" }, null, wrap);
  const play = h("button", Object.assign({}, BTN, { fontSize: "22px", padding: "16px 60px", background: "linear-gradient(180deg,#57b0ff,#2f7fd6)", color: "#fff", boxShadow: "0 6px 24px rgba(60,140,255,0.45)" }), "PLAY", btnRow);
  play.onclick = () => { W.events.emit("uiClick"); startMatch({ mapId: selMap, mode: selMode }); };
  const online = h("button", Object.assign({}, BTN, { background: "rgba(255,255,255,0.1)", color: "#cfe4ff" }), "🌐 PLAY WITH FRIENDS", btnRow);
  online.onclick = () => { W.events.emit("uiClick"); W.events.emit("openOnline", { mapId: selMap, mode: selMode }); };
  const settings = h("button", Object.assign({}, BTN, { background: "rgba(255,255,255,0.1)", color: "#cfe4ff" }), "⚙ SETTINGS", btnRow);
  settings.onclick = () => { W.events.emit("uiClick"); showSettings(W); };

  h("div", { fontSize: "12px", opacity: "0.55", maxWidth: "760px", textAlign: "center", lineHeight: "1.6" },
    "WASD move · Mouse aim/fire · RMB aim · SPACE jump · CTRL crouch · SHIFT sprint · E interact · R reload · Z/X/C/V build wall/floor/ramp/stair · B material · G edit · T quick heal · 1–5 slots · M map", wrap);
  import("./audio.js" + (new URL(import.meta.url).search || "")).then((m) => m.startMenuMusic(W));
}

export function showLoading(W, text) {
  // a new match must clear every stray screen from the previous one
  ["post", "death", "pause", "settings", "bigmap", "menu", "hud"].forEach((n) => { if (R[n]) { R[n].remove(); R[n] = null; } });
  W.paused = false;
  const L = layer("loading", { pointerEvents: "auto", background: "rgba(6,12,22,0.96)", display: "flex", alignItems: "center", justifyContent: "center" });
  const box = h("div", { textAlign: "center" }, null, L);
  h("div", { fontSize: "30px", fontWeight: "900", letterSpacing: "3px" }, "LAST CIRCLE", box);
  h("div", { fontSize: "16px", opacity: "0.8", marginTop: "12px" }, text || "Loading…", box);
  const bar = h("div", { width: "280px", height: "6px", background: "rgba(255,255,255,0.12)", borderRadius: "3px", margin: "18px auto 0", overflow: "hidden" }, null, box);
  const fill = h("div", { width: "30%", height: "100%", background: "#57b0ff", borderRadius: "3px", transition: "width .4s" }, null, bar);
  let p = 30;
  R._loadIv = setInterval(() => { p = Math.min(92, p + 8); fill.style.width = p + "%"; }, 300);
}

// ═══ LOBBY ═══════════════════════════════════════════════════════════════════
export function showLobby(W, onDone) {
  if (R._loadIv) { clearInterval(R._loadIv); R._loadIv = null; }
  if (R.loading) { R.loading.remove(); R.loading = null; }
  if (R.menu) { R.menu.remove(); R.menu = null; }
  const L = layer("lobby", { pointerEvents: "auto", background: "rgba(6,12,22,0.88)" });
  const wrap = h("div", { position: "absolute", inset: "0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px" }, null, L);
  const mapName = (W.map && W.map.K && W.map.K.name) || W.mapId;
  h("div", { fontSize: "26px", fontWeight: "900", letterSpacing: "2px" }, mapName.toUpperCase() + " — " + (W.mode === "quick" ? "QUICK MATCH" : W.mode === "practice" ? "PRACTICE" : "BATTLE ROYALE"), wrap);
  const count = h("div", { fontSize: "16px", opacity: "0.85" }, "Filling lobby… 1/" + W.actors.length, wrap);
  const grid = h("div", { display: "grid", gridTemplateColumns: "repeat(10, 110px)", gap: "5px", maxWidth: "1180px" }, null, wrap);
  const cells = W.actors.map((a, i) => {
    const c = h("div", { padding: "5px 7px", fontSize: "10px", borderRadius: "6px", background: "rgba(255,255,255,0.05)", color: "transparent", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", border: "1px solid rgba(255,255,255,0.06)" }, a.name, grid);
    return c;
  });
  const cd = h("div", { fontSize: "42px", fontWeight: "900", color: "#57b0ff", minHeight: "52px" }, "", wrap);
  if (W.mode === "practice") h("div", { fontSize: "13px", opacity: "0.7" }, "Sandbox — no storm. Range targets south, build lot west, movement course east.", wrap);

  // fill animation then countdown
  let filled = 1;
  cells[0].style.color = "#9fd7ff"; cells[0].style.background = "rgba(87,176,255,0.18)";
  const fillIv = setInterval(() => {
    const step = 3 + Math.floor(Math.random() * 5);
    for (let i = 0; i < step && filled < cells.length; i++, filled++) {
      cells[filled].style.color = "#dfeaff";
    }
    count.textContent = (W.net ? "Waiting for friends… " : "Filling lobby… ") + filled + "/" + W.actors.length;
    if (filled >= cells.length) {
      clearInterval(fillIv);
      count.textContent = W.actors.length + "/" + W.actors.length + " — ready";
      let n = W.mode === "practice" ? 1 : 3;
      cd.textContent = n;
      W.events.emit("countdownBeep", false);
      const cdIv = setInterval(() => {
        n--;
        if (n <= 0) {
          clearInterval(cdIv);
          W.events.emit("countdownBeep", true);
          L.remove(); R.lobby = null;
          onDone();
        } else { cd.textContent = n; W.events.emit("countdownBeep", false); }
      }, 900);
    }
  }, W.mode === "practice" ? 30 : 140);
}

// ═══ HUD ═════════════════════════════════════════════════════════════════════
export function showHUD(W) {
  const L = layer("hud");
  const bottomLeft = h("div", { position: "absolute", left: "18px", bottom: "16px", width: "300px" }, null, L);
  // hp/shield
  R.shieldBar = bar(bottomLeft, "#57b0ff");
  R.hpBar = bar(bottomLeft, "#4ade80");
  R.hpText = h("div", { fontSize: "13px", fontWeight: "700", marginTop: "3px", textShadow: "0 1px 3px #000" }, "", bottomLeft);
  // heal channel
  R.healBar = h("div", { position: "absolute", left: "50%", top: "58%", transform: "translateX(-50%)", width: "220px", height: "10px", background: "rgba(0,0,0,0.5)", borderRadius: "5px", display: "none", overflow: "hidden" }, null, L);
  R.healFill = h("div", { width: "0%", height: "100%", background: "#4ade80" }, null, R.healBar);

  // slots + mats bottom right
  const br = h("div", { position: "absolute", right: "18px", bottom: "16px", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }, null, L);
  R.matsRow = h("div", { display: "flex", gap: "10px", fontSize: "13px", fontWeight: "800", textShadow: "0 1px 3px #000" }, null, br);
  R.slotsRow = h("div", { display: "flex", gap: "6px" }, null, br);
  R.ammoText = h("div", { fontSize: "22px", fontWeight: "900", textShadow: "0 2px 4px #000" }, "", br);
  R.buildHint = h("div", { fontSize: "12px", opacity: "0.9", background: "rgba(0,0,0,0.4)", padding: "4px 10px", borderRadius: "6px", display: "none" }, "", br);

  // top center: storm timer + alive
  const tc = h("div", { position: "absolute", top: "12px", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "18px", alignItems: "center", background: "rgba(0,0,0,0.4)", padding: "6px 18px", borderRadius: "10px" }, null, L);
  R.stormIcon = h("div", { fontSize: "15px" }, "⛈", tc);
  R.stormTimer = h("div", { fontSize: "17px", fontWeight: "800", minWidth: "72px" }, "", tc);
  h("div", { width: "1px", height: "18px", background: "rgba(255,255,255,0.25)" }, null, tc);
  R.aliveText = h("div", { fontSize: "17px", fontWeight: "800" }, "", tc);
  R.killsText = h("div", { fontSize: "15px", fontWeight: "700", opacity: "0.85" }, "", tc);

  // minimap top left
  const mmWrap = h("div", { position: "absolute", top: "12px", left: "14px", width: "180px", height: "180px", borderRadius: "12px", overflow: "hidden", border: "2px solid rgba(120,180,255,0.35)", boxShadow: "0 4px 18px rgba(0,0,0,0.5)" }, null, L);
  R.mmCanvas = h("canvas", { width: "180px", height: "180px" }, null, mmWrap);
  R.mmCanvas.width = 180; R.mmCanvas.height = 180;

  // kill feed right
  R.feed = h("div", { position: "absolute", right: "16px", top: "70px", display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-end", fontSize: "12px" }, null, L);

  // crosshair
  R.cross = h("div", { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", fontSize: "18px", fontWeight: "400", color: "rgba(255,255,255,0.9)", textShadow: "0 1px 2px #000" }, "+", L);
  R.hitmark = h("div", { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%) rotate(45deg)", fontSize: "26px", color: "#fff", opacity: "0", transition: "opacity .18s" }, "✕", L);

  // interact hint
  R.interact = h("div", { position: "absolute", left: "50%", top: "60%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.55)", padding: "6px 14px", borderRadius: "8px", fontSize: "14px", display: "none" }, "", L);

  // storm messages center
  R.stormMsg = h("div", { position: "absolute", left: "50%", top: "22%", transform: "translateX(-50%)", fontSize: "22px", fontWeight: "900", letterSpacing: "1px", textShadow: "0 2px 8px #000", opacity: "0", transition: "opacity .4s", color: "#d9b3ff" }, "", L);

  // tints
  R.stormTint = h("div", { position: "absolute", inset: "0", background: "radial-gradient(ellipse at center, rgba(130,60,200,0) 55%, rgba(130,60,200,0.35) 100%)", opacity: "0", transition: "opacity .5s", pointerEvents: "none" }, null, L);
  R.hurtTint = h("div", { position: "absolute", inset: "0", background: "radial-gradient(ellipse at center, rgba(200,30,30,0) 60%, rgba(200,30,30,0.4) 100%)", opacity: "0", transition: "opacity .3s", pointerEvents: "none" }, null, L);
  R.scope = h("div", { position: "absolute", inset: "0", display: "none", background: "radial-gradient(circle at center, rgba(0,0,0,0) 26%, rgba(0,0,0,0.92) 27%)", pointerEvents: "none" }, null, L);
  const scLine = h("div", { position: "absolute", left: "50%", top: "50%", width: "40%", height: "1px", background: "rgba(255,255,255,0.5)", transform: "translate(-50%,-50%)" }, null, R.scope);
  h("div", { position: "absolute", left: "50%", top: "50%", width: "1px", height: "40%", background: "rgba(255,255,255,0.5)", transform: "translate(-50%,-50%)" }, null, R.scope);

  R._hudCache = {};
}

function bar(parent, color) {
  const wrap = h("div", { width: "100%", height: "14px", background: "rgba(0,0,0,0.5)", borderRadius: "7px", overflow: "hidden", marginTop: "5px", border: "1px solid rgba(255,255,255,0.15)" }, null, parent);
  const fill = h("div", { width: "0%", height: "100%", background: color, transition: "width .15s" }, null, wrap);
  return fill;
}

function hideHUD() {
  ["hud", "death", "post", "bigmap"].forEach((n) => { if (R[n]) { R[n].remove(); R[n] = null; } });
}

// ═══ per-frame update ════════════════════════════════════════════════════════
let mmT = 0, srT = 0;
export function update(W, dt) {
  if (!R.hud || !W.player) return;
  const p = W.player;
  const C = R._hudCache;

  const hpPct = Math.max(0, p.hp) + "%";
  if (C.hp !== hpPct) { R.hpBar.style.width = hpPct; C.hp = hpPct; }
  const shPct = Math.max(0, p.shield) + "%";
  if (C.sh !== shPct) { R.shieldBar.style.width = shPct; C.sh = shPct; }
  const hpT = Math.ceil(Math.max(0, p.hp)) + " HP  ·  " + Math.ceil(p.shield) + " SHIELD";
  if (C.hpT !== hpT) { R.hpText.textContent = hpT; C.hpT = hpT; }

  // heal channel
  if (p.healing) {
    R.healBar.style.display = "block";
    const c = K.CONSUMABLES[p.healing.id];
    R.healFill.style.width = (100 * (1 - p.healing.tLeft / c.useS)) + "%";
  } else R.healBar.style.display = "none";

  // ammo + slots
  const wpn = p.weapon;
  let ammoT = "";
  if (wpn && !wpn.id.startsWith("consumable")) {
    const def = K.WEAPONS[wpn.id];
    if (wpn.id === "pickaxe") ammoT = "⛏";
    else if (wpn.id === "grenade") ammoT = "🧨 " + p.inventory.grenades;
    else if (def) ammoT = wpn.state === "reloading" ? "RELOADING…" : wpn.magAmmo + " / " + (p.inventory.ammo[def.ammo] || 0);
  }
  if (C.ammo !== ammoT) { R.ammoText.textContent = ammoT; C.ammo = ammoT; }

  const matsT = "🪵 " + p.inventory.mats.wood + "   🧱 " + p.inventory.mats.brick + "   🔩 " + p.inventory.mats.metal;
  if (C.mats !== matsT) {
    R.matsRow.innerHTML = "";
    const parts2 = [["#d9a05f", "WOOD " + p.inventory.mats.wood], ["#d97b5f", "BRICK " + p.inventory.mats.brick], ["#9fb2c4", "METAL " + p.inventory.mats.metal]];
    for (const [c2, t2] of parts2) h("div", { color: c2 }, t2, R.matsRow);
    C.mats = matsT;
  }

  const slotSig = p.inventory.slots.map((s, i) => (s ? s.id + (s.count || "") + (s.rarity || 0) : "-") + (i === p.inventory.active ? "*" : "")).join("|");
  if (C.slots !== slotSig) { paintSlots(W, p); C.slots = slotSig; }

  // build hint
  if (p.input.buildPiece) {
    R.buildHint.style.display = "block";
    R.buildHint.textContent = "BUILD: " + p.input.buildPiece.toUpperCase() + " · " + p.buildMat.toUpperCase() + " (B) · scroll to cycle";
  } else R.buildHint.style.display = "none";

  // storm timer + alive
  srT += dt;
  if (srT > 0.25) {
    srT = 0;
    if (W.stormCtl) {
      const st = W.stormCtl.storm.stateAt(W.t);
      let txt;
      if (W.mode === "practice") txt = "∞";
      else if (st.done) txt = "CLOSED";
      else txt = (st.phaseState === "waiting" ? "shrinks " : "closing ") + fmtT(st.tToNext);
      R.stormTimer.textContent = txt;
      R.stormIcon.style.color = st.closing ? "#d9b3ff" : "#9fb6cc";
    }
    R.aliveText.textContent = "👥 " + (W.match ? W.match.aliveCount() : "—");
    R.killsText.textContent = "☠ " + (W.match ? (W.match.kills[p.id] || 0) : 0);
    // hurt tint decay
    R.hurtTint.style.opacity = W.t - p.lastDamageT < 0.7 ? "1" : "0";
  }

  // minimap 10Hz
  mmT += dt;
  if (mmT > 0.1) { mmT = 0; drawMinimap(W, R.mmCanvas.getContext("2d"), 180, false); }

  // interact hint
  const hint = W.interactHint;
  if (hint) {
    R.interact.style.display = "block";
    R.interact.textContent = hint.type === "chest" ? "[E] Open chest" : "[E] " + labelFor(hint.data);
  } else R.interact.style.display = "none";

  // crosshair spread feel
  R.cross.style.display = (p.input.ads && p.weapon && K.WEAPONS[p.weapon.id] && K.WEAPONS[p.weapon.id].scope) ? "none" : "block";
}

function paintSlots(W, p) {
  clear(R.slotsRow);
  p.inventory.slots.forEach((s, i) => {
    const active = i === p.inventory.active;
    const cell = h("div", {
      width: "52px", height: "44px", borderRadius: "8px", position: "relative",
      background: active ? "rgba(87,176,255,0.25)" : "rgba(0,0,0,0.45)",
      border: active ? "2px solid #57b0ff" : "1px solid rgba(255,255,255,0.18)",
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "800",
    }, null, R.slotsRow);
    if (s) {
      const rc = s.kind === "weapon" ? (K.RARITY_COLOR[K.RARITY[s.rarity || 0]] || "#9da5b4") : "#8fd3a0";
      h("div", { position: "absolute", left: "0", right: "0", bottom: "0", height: "3px", background: rc }, null, cell);
      cell.appendChild(document.createTextNode(shortName(s)));
      if (s.count) h("div", { position: "absolute", right: "3px", top: "1px", fontSize: "10px", opacity: "0.9" }, String(s.count), cell);
    }
    h("div", { position: "absolute", left: "3px", top: "1px", fontSize: "9px", opacity: "0.6" }, String(i + 1), cell);
  });
}
function shortName(s) {
  const M = { pickaxe: "PICK", pistol: "PSTL", smg: "SMG", ar: "AR", shotgun: "SHTG", sniper: "SNPR", rocket: "RPG", grenade: "NADE", bandage: "BAND", medkit: "MED", mini_shield: "MINI", big_shield: "SHLD" };
  return M[s.id] || s.id.slice(0, 4).toUpperCase();
}
function labelFor(d) {
  if (!d) return "Pick up";
  if (d.kind === "weapon") return "Pick up " + shortName(d) + (d.id !== "grenade" ? " (" + K.RARITY[d.rarity || 0] + ")" : "");
  return "Pick up " + shortName(d);
}
function fmtT(s) {
  s = Math.max(0, Math.ceil(s));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

// ═══ minimap ═════════════════════════════════════════════════════════════════
function drawMinimap(W, ctx, size, big) {
  if (!W.map) return;
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(W.map.minimap, 0, 0, size, size);
  const S = W.map.size;
  const toPx = (x) => (x / S + 0.5) * size;
  // storm circles
  if (W.stormCtl && W.mode !== "practice") {
    const st = W.stormCtl.storm.stateAt(W.t);
    ctx.strokeStyle = "rgba(190,120,255,0.95)";
    ctx.lineWidth = big ? 3 : 2;
    ctx.beginPath(); ctx.arc(toPx(st.center.x), toPx(st.center.z), (st.radius / S) * size, 0, Math.PI * 2); ctx.stroke();
    if (st.nextRadius != null && st.nextRadius > 0) {
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(toPx(st.nextCenter.x), toPx(st.nextCenter.z), (st.nextRadius / S) * size, 0, Math.PI * 2); ctx.stroke();
    }
    // dark outside veil
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, size, size);
    ctx.arc(toPx(st.center.x), toPx(st.center.z), (st.radius / S) * size, 0, Math.PI * 2, true);
    ctx.fillStyle = "rgba(90,30,140,0.28)";
    ctx.fill();
    ctx.restore();
  }
  // POI names on big map
  if (big) {
    ctx.font = "700 13px system-ui";
    ctx.textAlign = "center";
    for (const p of W.map.pois) {
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillText(p.name, toPx(p.x) + 1, toPx(p.z) + 1);
      ctx.fillStyle = "#fff";
      ctx.fillText(p.name, toPx(p.x), toPx(p.z));
    }
  }
  // player arrow
  const p = W.player;
  if (p) {
    const px = toPx(p.pos.x), pz = toPx(p.pos.z);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-p.yaw);
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }
}

// ═══ events, pause, death, stats, settings ══════════════════════════════════
function wireEvents(W) {
  W.events.on("hitMarker", (owner) => {
    if (owner !== W.player || !R.hitmark) return;
    R.hitmark.style.opacity = "1";
    setTimeout(() => { if (R.hitmark) R.hitmark.style.opacity = "0"; }, 120);
  });
  W.events.on("actorDied", (victim, killerId, weaponId) => {
    if (!R.feed) return;
    const killer = killerId ? W.actorById.get(killerId) : null;
    const el = h("div", { background: "rgba(0,0,0,0.5)", padding: "3px 10px", borderRadius: "6px" },
      (killer ? killer.name + " ⚔ " : "⛈ ") + victim.name, R.feed);
    if (victim === W.player || killer === W.player) el.style.color = "#ffd54a";
    setTimeout(() => el.remove(), 6000);
    while (R.feed.children.length > 6) R.feed.firstChild.remove();
  });
  W.events.on("stormWarning", () => flashMsg("STORM SHRINKS IN 10 SECONDS"));
  W.events.on("stormClosing", () => flashMsg("THE STORM IS CLOSING"));
  W.events.on("playerStormState", (inStorm) => { if (R.stormTint) R.stormTint.style.opacity = inStorm ? "1" : "0"; });
  W.events.on("scopeState", (on) => { if (R.scope) R.scope.style.display = on ? "block" : "none"; });
  W.events.on("toggleBigMap", () => toggleBigMap(W));
  W.events.on("escPressed", () => {
    if (R.bigmap) { toggleBigMap(W); return; }
    if (W.phase === "match" || W.phase === "drop") togglePause(W);
  });
  W.events.on("playerDied", (killerId, weaponId) => showDeath(W, killerId, weaponId));
  W.events.on("supplyDropSpawned", () => flashMsg("SUPPLY DROP INBOUND"));
}

function flashMsg(text) {
  if (!R.stormMsg) return;
  R.stormMsg.textContent = text;
  R.stormMsg.style.opacity = "1";
  setTimeout(() => { if (R.stormMsg) R.stormMsg.style.opacity = "0"; }, 2600);
}

function toggleBigMap(W) {
  if (R.bigmap) { R.bigmap.remove(); R.bigmap = null; return; }
  const L = layer("bigmap", { pointerEvents: "auto", background: "rgba(4,8,16,0.9)", display: "flex", alignItems: "center", justifyContent: "center" });
  const size = Math.min(window.innerHeight - 100, 640);
  const cv = h("canvas", { borderRadius: "14px", border: "2px solid rgba(120,180,255,0.35)" }, null, L);
  cv.width = cv.height = size;
  drawMinimap(W, cv.getContext("2d"), size, true);
  h("div", { position: "absolute", bottom: "26px", fontSize: "13px", opacity: "0.7" }, "M / ESC to close", L);
  L.onclick = () => toggleBigMap(W);
  R._bigIv = setInterval(() => { if (R.bigmap) drawMinimap(W, cv.getContext("2d"), size, true); else clearInterval(R._bigIv); }, 400);
}

function togglePause(W) {
  if (R.pause) { R.pause.remove(); R.pause = null; W.paused = false; return; }
  W.paused = true;
  document.exitPointerLock && document.exitPointerLock();
  const L = layer("pause", { pointerEvents: "auto", background: "rgba(4,8,16,0.82)", display: "flex", alignItems: "center", justifyContent: "center" });
  const box = h("div", Object.assign({ padding: "34px 44px", textAlign: "center", display: "flex", flexDirection: "column", gap: "14px", minWidth: "300px" }, PANEL), null, L);
  h("div", { fontSize: "26px", fontWeight: "900", letterSpacing: "2px" }, "PAUSED", box);
  const resume = h("button", Object.assign({}, BTN, { background: "#57b0ff", color: "#fff" }), "RESUME", box);
  resume.onclick = () => togglePause(W);
  const st = h("button", Object.assign({}, BTN, { background: "rgba(255,255,255,0.1)", color: "#cfe4ff" }), "SETTINGS", box);
  st.onclick = () => showSettings(W);
  const quit = h("button", Object.assign({}, BTN, { background: "rgba(255,80,80,0.2)", color: "#ff9f9f" }), "QUIT TO MENU", box);
  quit.onclick = () => { R.pause.remove(); R.pause = null; W.paused = false; W.endMatch(false); };
  h("div", { fontSize: "11px", opacity: "0.6" }, "Note: the match keeps running in a real BR — here it pauses (single-player).", box);
}

function showDeath(W, killerId, weaponId) {
  const killer = killerId ? W.actorById.get(killerId) : null;
  const L = layer("death", { pointerEvents: "auto" });
  const box = h("div", { position: "absolute", top: "14%", left: "50%", transform: "translateX(-50%)", textAlign: "center" }, null, L);
  h("div", { fontSize: "38px", fontWeight: "900", color: "#ff7a7a", textShadow: "0 3px 12px #000", letterSpacing: "3px" }, "ELIMINATED", box);
  const place = W.match.placementOf(W.player.id);
  h("div", { fontSize: "17px", marginTop: "8px", textShadow: "0 2px 6px #000" },
    "#" + place + " of " + W.match.totalPlayers + (killer ? "  ·  by " + killer.name + " (" + (weaponId || "?") + ")" : "  ·  the storm got you"), box);
  const row = h("div", { display: "flex", gap: "12px", justifyContent: "center", marginTop: "16px" }, null, box);
  if (killer && killer.alive) h("div", { fontSize: "13px", opacity: "0.8", alignSelf: "center" }, "Spectating " + killer.name, row);
  const btn = h("button", Object.assign({}, BTN, { background: "#57b0ff", color: "#fff" }), "MATCH STATS", row);
  btn.onclick = () => W.endMatch(false);
}

export function showPostMatch(W, res) {
  hideHUD();
  ["pause", "death"].forEach((n) => { if (R[n]) { R[n].remove(); R[n] = null; } });
  const L = layer("post", { pointerEvents: "auto", background: "rgba(4,8,16,0.9)", display: "flex", alignItems: "center", justifyContent: "center" });
  const box = h("div", Object.assign({ padding: "40px 60px", textAlign: "center", display: "flex", flexDirection: "column", gap: "8px", minWidth: "420px" }, PANEL), null, L);
  if (res.victory) {
    h("div", { fontSize: "44px", fontWeight: "900", color: "#ffd54a", textShadow: "0 0 30px rgba(255,213,74,0.5)", letterSpacing: "3px" }, "VICTORY ROYALE", box);
    confetti(L);
  } else {
    h("div", { fontSize: "36px", fontWeight: "900", letterSpacing: "3px" }, "MATCH OVER", box);
  }
  h("div", { fontSize: "20px", fontWeight: "800", color: "#9fd7ff", marginBottom: "10px" }, "#" + res.placement + " OF " + (W.match ? W.match.totalPlayers : 50), box);
  const grid = h("div", { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 30px", fontSize: "15px", textAlign: "left", margin: "0 auto" }, null, box);
  stat(grid, "Eliminations", res.kills);
  stat(grid, "Damage dealt", res.damage);
  stat(grid, "Accuracy", res.accuracy + "%");
  stat(grid, "Survived", fmtT(res.timeS));
  const row = h("div", { display: "flex", gap: "12px", justifyContent: "center", marginTop: "22px" }, null, box);
  const again = h("button", Object.assign({}, BTN, { background: "#57b0ff", color: "#fff" }), "PLAY AGAIN", row);
  again.onclick = res.onAgain;
  const menu = h("button", Object.assign({}, BTN, { background: "rgba(255,255,255,0.1)", color: "#cfe4ff" }), "MAIN MENU", row);
  menu.onclick = () => { L.remove(); R.post = null; res.onMenu(); };
}
function stat(grid, label, val) {
  h("div", { opacity: "0.7" }, label, grid);
  h("div", { fontWeight: "800", textAlign: "right" }, String(val), grid);
}
function confetti(L) {
  for (let i = 0; i < 60; i++) {
    const c = h("div", {
      position: "absolute", left: Math.random() * 100 + "%", top: "-20px",
      width: "8px", height: "12px", background: ["#ffd54a", "#57b0ff", "#4ade80", "#ff7ab8"][i % 4],
      transform: "rotate(" + Math.random() * 360 + "deg)",
      transition: "top " + (2 + Math.random() * 2.5) + "s linear, transform 3s",
    }, null, L);
    setTimeout(() => { c.style.top = "110%"; c.style.transform = "rotate(" + (360 + Math.random() * 720) + "deg)"; }, 50 + Math.random() * 800);
    setTimeout(() => c.remove(), 5000);
  }
}

// ═══ settings ════════════════════════════════════════════════════════════════
const ACTIONS = [
  ["Jump", "Space"], ["Crouch", "ControlLeft"], ["Sprint", "ShiftLeft"], ["Interact", "KeyE"],
  ["Reload", "KeyR"], ["Wall", "KeyZ"], ["Floor", "KeyX"], ["Ramp", "KeyC"], ["Stair", "KeyV"],
  ["Edit", "KeyG"], ["Material", "KeyB"], ["Quick heal", "KeyT"], ["Map", "KeyM"],
];
function showSettings(W) {
  if (R.settings) { R.settings.remove(); R.settings = null; }
  const L = layer("settings", { pointerEvents: "auto", background: "rgba(4,8,16,0.9)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 });
  const box = h("div", Object.assign({ padding: "28px 36px", width: "560px", maxHeight: "82vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" }, PANEL), null, L);
  h("div", { fontSize: "22px", fontWeight: "900", letterSpacing: "2px" }, "SETTINGS", box);

  slider(box, "Master volume", W.settings.masterVol, (v) => { W.settings.masterVol = v; applyAudio(W); });
  slider(box, "Music volume", W.settings.musicVol, (v) => { W.settings.musicVol = v; applyAudio(W); });
  slider(box, "SFX volume", W.settings.sfxVol, (v) => { W.settings.sfxVol = v; applyAudio(W); });
  slider(box, "Mouse sensitivity", W.settings.sensitivity / 2, (v) => { W.settings.sensitivity = v * 2; save(W); });
  slider(box, "ADS sensitivity", W.settings.adsSensitivity / 2, (v) => { W.settings.adsSensitivity = v * 2; save(W); });

  // graphics
  const gRow = h("div", { display: "flex", gap: "8px", alignItems: "center" }, null, box);
  h("div", { fontSize: "13px", opacity: "0.8", width: "160px" }, "Graphics", gRow);
  ["low", "medium", "high"].forEach((g2) => {
    const b = h("button", Object.assign({}, BTN, { padding: "7px 16px", fontSize: "13px", background: W.settings.graphics === g2 ? "#57b0ff" : "rgba(255,255,255,0.1)", color: W.settings.graphics === g2 ? "#fff" : "#cfe4ff" }), g2.toUpperCase(), gRow);
    b.onclick = () => { W.settings.graphics = g2; applyGraphics(W); save(W); showSettings(W); };
  });

  // keybinds
  h("div", { fontSize: "15px", fontWeight: "800", marginTop: "8px" }, "KEYBINDS (click to rebind)", box);
  const kGrid = h("div", { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px" }, null, box);
  for (const [label, canonical] of ACTIONS) {
    const row = h("div", { display: "flex", justifyContent: "space-between", alignItems: "center" }, null, kGrid);
    h("div", { fontSize: "13px", opacity: "0.8" }, label, row);
    // find current physical key for this canonical
    let phys = canonical;
    for (const k2 in (W.settings.remap || {})) if (W.settings.remap[k2] === canonical) phys = k2;
    const kb = h("button", Object.assign({}, BTN, { padding: "4px 12px", fontSize: "12px", background: "rgba(255,255,255,0.12)", color: "#dfeaff", minWidth: "84px" }), keyLabel(phys), row);
    kb.onclick = () => {
      kb.textContent = "press key…";
      W.captureKey = (code) => {
        W.captureKey = null;
        W.settings.remap = W.settings.remap || {};
        for (const k3 in W.settings.remap) if (W.settings.remap[k3] === canonical) delete W.settings.remap[k3];
        if (code !== canonical) W.settings.remap[code] = canonical;
        save(W);
        kb.textContent = keyLabel(code);
      };
    };
  }

  const closeB = h("button", Object.assign({}, BTN, { background: "#57b0ff", color: "#fff", marginTop: "10px" }), "DONE", box);
  closeB.onclick = () => { L.remove(); R.settings = null; save(W); };
}
function keyLabel(code) { return code.replace("Key", "").replace("Digit", "").replace("Left", " L").replace("Control", "CTRL"); }
function slider(box, label, val, onChange) {
  const row = h("div", { display: "flex", gap: "10px", alignItems: "center" }, null, box);
  h("div", { fontSize: "13px", opacity: "0.8", width: "160px" }, label, row);
  const inp = h("input", { flex: "1" }, null, row);
  inp.type = "range"; inp.min = 0; inp.max = 1; inp.step = 0.01; inp.value = val;
  const num = h("div", { fontSize: "12px", width: "40px", textAlign: "right" }, Math.round(val * 100) + "%", row);
  inp.oninput = () => { onChange(parseFloat(inp.value)); num.textContent = Math.round(inp.value * 100) + "%"; };
}
function applyAudio(W) {
  save(W);
  import("./audio.js" + (new URL(import.meta.url).search || "")).then((m) => m.setVolumes(W));
}
function applyGraphics(W) {
  const r = W.kernel.renderer;
  if (W.settings.graphics === "low") { r.setPixelRatio(1); r.shadowMap.enabled = false; }
  else if (W.settings.graphics === "high") { r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); r.shadowMap.enabled = true; }
  else { r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); r.shadowMap.enabled = true; }
  W.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
}
function save(W) {
  try { localStorage.setItem("lc_settings", JSON.stringify(W.settings)); } catch (e) {}
}
