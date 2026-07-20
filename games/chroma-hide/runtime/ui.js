/**
 * CHROMA HIDE — runtime/ui.js
 * DOM overlays: title menu, in-match HUD, results screen, pause menu. Kept out of
 * game.js so the same widgets serve single-player (M2), online lobbies (M3), and
 * the settings/polish pass (M5). Brand accent #7fe3c4 on a dark glass panel.
 */
const ACCENT = "#7fe3c4";
const PANEL_BG = "rgba(12,16,24,0.9)";

function el(tag, css, html) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (html != null) e.innerHTML = html;
  return e;
}
function btn(label, on, primary) {
  const b = el("button", [
    "border:none", "border-radius:10px", "padding:12px 20px", "cursor:pointer",
    "font:600 15px system-ui,sans-serif", "transition:transform .1s,background .15s", "margin:5px",
    primary ? `background:${ACCENT};color:#04140f` : "background:rgba(255,255,255,.1);color:#eaf2ff",
  ].join(";"), label);
  b.onmouseenter = () => { b.style.transform = "translateY(-1px)"; b.style.filter = "brightness(1.1)"; };
  b.onmouseleave = () => { b.style.transform = ""; b.style.filter = ""; };
  b.onclick = on;
  return b;
}
const overlayCss = (z) => [
  "position:absolute", "inset:0", `z-index:${z}`, "display:flex", "flex-direction:column",
  "align-items:center", "justify-content:center", "font-family:system-ui,sans-serif",
  "color:#eaf2ff", "pointer-events:auto", "text-align:center",
].join(";");

// ── Title / main menu ────────────────────────────────────────────────────────
export function createTitleMenu(host, cb, maps) {
  const root = el("div", overlayCss(60) + ";background:radial-gradient(ellipse at 50% 30%,rgba(30,50,44,.6),rgba(6,10,14,.94))");
  root.appendChild(el("div", "font:800 15px system-ui;letter-spacing:.4em;color:" + ACCENT + ";opacity:.8", "FORGEFLOW GAMES"));
  root.appendChild(el("h1", "font:800 62px system-ui;letter-spacing:.02em;margin:6px 0 2px;background:linear-gradient(90deg,#7fe3c4,#c8a6ff);-webkit-background-clip:text;background-clip:text;color:transparent", "CHROMA HIDE"));
  root.appendChild(el("div", "opacity:.7;max-width:460px;margin-bottom:24px;line-height:1.5", "Paint your blank body to melt into the room. Hold a pose, hide in plain sight, and outlast the hunt."));

  const roleRow = el("div", "display:flex;gap:8px;margin-bottom:8px");
  let role = "hider";
  const rH = btn("🎨 Play as Hider", () => setRole("hider"), true);
  const rS = btn("🔫 Play as Seeker", () => setRole("seeker"), false);
  function setRole(r) { role = r; rH.style.background = r === "hider" ? ACCENT : "rgba(255,255,255,.1)"; rH.style.color = r === "hider" ? "#04140f" : "#eaf2ff"; rS.style.background = r === "seeker" ? ACCENT : "rgba(255,255,255,.1)"; rS.style.color = r === "seeker" ? "#04140f" : "#eaf2ff"; }
  roleRow.append(rH, rS); root.appendChild(roleRow);

  const modeRow = el("div", "display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-bottom:6px;max-width:520px");
  let mode = "normal";
  const modes = [["normal", "Normal"], ["infection", "Infection"], ["double", "Double"], ["reverse", "Reverse Chicken Race"]];
  const modeBtns = {};
  for (const [id, name] of modes) {
    const b = btn(name, () => { mode = id; for (const k in modeBtns) { modeBtns[k].style.background = k === id ? "rgba(127,227,196,.25)" : "rgba(255,255,255,.07)"; } }, false);
    b.style.padding = "7px 12px"; b.style.font = "600 13px system-ui"; modeBtns[id] = b; modeRow.appendChild(b);
  }
  modeBtns.normal.style.background = "rgba(127,227,196,.25)";
  root.appendChild(modeRow);

  const botRow = el("div", "display:flex;align-items:center;gap:10px;margin:10px 0 18px;opacity:.85");
  botRow.appendChild(el("span", "font-size:13px", "Lobby size"));
  const botSel = el("input", "accent-color:" + ACCENT); botSel.type = "range"; botSel.min = 2; botSel.max = 10; botSel.value = 6;
  const botLbl = el("span", "font:600 13px system-ui;min-width:64px", "6 players");
  botSel.oninput = () => botLbl.textContent = botSel.value + " players";
  botRow.append(botSel, botLbl); root.appendChild(botRow);

  const mapRow = el("div", "display:flex;align-items:center;gap:10px;margin:0 0 6px;opacity:.85");
  mapRow.appendChild(el("span", "font-size:13px", "Stage"));
  const mapSel = el("select", "padding:8px;border-radius:8px;background:rgba(0,0,0,.35);color:#fff;border:1px solid rgba(255,255,255,.15);font-size:13px");
  [{ id: "random", name: "🎲 Random" }].concat(maps || []).forEach((m) => { const o = document.createElement("option"); o.value = m.id; o.textContent = m.name; mapSel.appendChild(o); });
  mapRow.appendChild(mapSel); root.appendChild(mapRow);

  const playRow = el("div", "display:flex;gap:8px;align-items:center;margin-top:10px");
  const play = btn("▶  PLAY", () => cb.onPlay({ role, mode, players: parseInt(botSel.value, 10), mapId: mapSel.value }), true);
  play.style.font = "700 18px system-ui"; play.style.padding = "14px 40px";
  const online = btn("🌐 Play Online", () => cb.onOnline && cb.onOnline());
  online.style.padding = "14px 20px";
  playRow.append(play, online); root.appendChild(playRow);
  const controls = el("div", "display:flex;gap:6px;margin-top:14px");
  controls.appendChild(btn("How to Play", () => cb.onHelp && cb.onHelp()));
  controls.appendChild(btn("Settings", () => cb.onSettings && cb.onSettings()));
  root.appendChild(controls);

  host.appendChild(root); setRole("hider");
  return { el: root, show: () => (root.style.display = "flex"), hide: () => (root.style.display = "none") };
}

// ── In-match HUD ─────────────────────────────────────────────────────────────
export function createHUD(host) {
  const wrap = el("div", "position:absolute;inset:0;z-index:30;pointer-events:none;font-family:system-ui,sans-serif;color:#fff");
  // top-centre: phase + timer
  const top = el("div", "position:absolute;top:14px;left:50%;transform:translateX(-50%);text-align:center");
  const phase = el("div", "font:700 13px system-ui;letter-spacing:.2em;opacity:.9;text-shadow:0 1px 4px #000", "PREP");
  const timer = el("div", "font:800 34px system-ui;text-shadow:0 2px 8px #000;line-height:1", "1:30");
  top.append(phase, timer); wrap.appendChild(top);
  // top-left: role
  const role = el("div", "position:absolute;top:14px;left:16px;font:700 16px system-ui;text-shadow:0 1px 4px #000");
  wrap.appendChild(role);
  // top-right: ammo (seeker) or score (hider)
  const stat = el("div", "position:absolute;top:14px;right:16px;font:700 18px system-ui;text-align:right;text-shadow:0 1px 4px #000");
  wrap.appendChild(stat);
  // bottom-centre: hint
  const hint = el("div", "position:absolute;bottom:14px;left:50%;transform:translateX(-50%);font:500 12px system-ui;opacity:.7;text-shadow:0 1px 3px #000");
  wrap.appendChild(hint);
  // crosshair (seeker)
  const cross = el("div", "position:absolute;top:50%;left:50%;width:18px;height:18px;transform:translate(-50%,-50%);display:none");
  cross.innerHTML = '<div style="position:absolute;top:8px;left:0;width:18px;height:2px;background:rgba(255,255,255,.8)"></div><div style="position:absolute;left:8px;top:0;height:18px;width:2px;background:rgba(255,255,255,.8)"></div>';
  wrap.appendChild(cross);
  // toast
  const toast = el("div", "position:absolute;top:40%;left:50%;transform:translate(-50%,-50%);font:800 26px system-ui;opacity:0;transition:opacity .3s;text-shadow:0 2px 10px #000;pointer-events:none");
  wrap.appendChild(toast);

  host.appendChild(wrap);
  let toastTimer = null;
  return {
    el: wrap,
    setPhase: (t) => (phase.textContent = t),
    setTimer: (sec) => { const m = Math.floor(sec / 60), s = Math.max(0, Math.floor(sec % 60)); timer.textContent = m + ":" + (s < 10 ? "0" : "") + s; timer.style.color = sec <= 10 ? "#ff6b6b" : "#fff"; },
    setRole: (r) => { role.textContent = r === "seeker" ? "🔫 SEEKER" : "🎨 HIDER"; role.style.color = r === "seeker" ? "#ff9d6b" : ACCENT; },
    setAmmo: (a, max) => { stat.innerHTML = "🔫 " + "▮".repeat(Math.max(0, a)) + "<span style='opacity:.3'>" + "▮".repeat(Math.max(0, max - a)) + "</span>"; },
    setScore: (n) => (stat.textContent = "★ " + Math.round(n)),
    setHint: (t) => (hint.innerHTML = t),
    showCrosshair: (on) => (cross.style.display = on ? "block" : "none"),
    toast: (t, color) => { toast.textContent = t; toast.style.color = color || "#fff"; toast.style.opacity = "1"; clearTimeout(toastTimer); toastTimer = setTimeout(() => (toast.style.opacity = "0"), 1400); },
    show: () => (wrap.style.display = "block"), hide: () => (wrap.style.display = "none"),
  };
}

// ── Results screen ───────────────────────────────────────────────────────────
export function createResults(host, cb) {
  const root = el("div", overlayCss(55) + ";background:rgba(6,10,14,.86);display:none");
  const card = el("div", `background:${PANEL_BG};border-radius:16px;padding:28px 34px;min-width:360px;max-width:520px;box-shadow:0 10px 40px rgba(0,0,0,.5)`);
  const title = el("h2", "font:800 34px system-ui;margin:0 0 4px"); card.appendChild(title);
  const reason = el("div", "opacity:.7;margin-bottom:16px"); card.appendChild(reason);
  const board = el("div", "text-align:left;margin-bottom:18px;max-height:230px;overflow:auto"); card.appendChild(board);
  const row = el("div", "display:flex;gap:8px;justify-content:center");
  row.appendChild(btn("↻ Rematch", () => cb.onRematch(), true));
  row.appendChild(btn("Menu", () => cb.onMenu()));
  card.appendChild(row); root.appendChild(card); host.appendChild(root);
  return {
    el: root,
    show: (data) => {
      title.textContent = data.winner === "seekers" ? "🔫 Seekers win" : "🎨 Hiders win";
      title.style.color = data.winner === "seekers" ? "#ff9d6b" : ACCENT;
      reason.textContent = ({ all_found: "Every hider was found.", time_survived: "A hider survived the hunt.", seekers_out_of_ammo: "The seekers ran out of ammo." })[data.reason] || "";
      board.innerHTML = "";
      const sorted = data.scores.slice().sort((a, b) => b.score - a.score);
      for (const p of sorted) {
        const r = el("div", "display:flex;justify-content:space-between;padding:6px 8px;border-radius:7px;margin:2px 0;" + (p.isLocal ? "background:rgba(127,227,196,.14)" : ""));
        r.innerHTML = `<span>${p.isLocal ? "★ " : ""}${p.name} <span style="opacity:.5;font-size:12px">${p.role}${p.caught ? " · caught" : p.role === "hider" ? " · survived" : ""}</span></span><b>${Math.round(p.score)}</b>`;
        board.appendChild(r);
      }
      root.style.display = "flex";
    },
    hide: () => (root.style.display = "none"),
  };
}

// ── Online lobby (Create / Join / Quick + waiting room) ──────────────────────
export function createOnlineLobby(host, cb, maps) {
  const root = el("div", overlayCss(57) + ";background:radial-gradient(ellipse at 50% 30%,rgba(20,40,50,.7),rgba(6,10,14,.95));display:none");
  const card = el("div", `background:${PANEL_BG};border-radius:16px;padding:26px 30px;min-width:340px;max-width:440px;box-shadow:0 10px 40px rgba(0,0,0,.5)`);
  card.appendChild(el("h2", "font:800 26px system-ui;margin:0 0 4px;color:" + ACCENT, "Play Online"));
  const sub = el("div", "opacity:.65;font-size:13px;margin-bottom:18px", "Match with a friend, or quick-match a public lobby. Empty slots fill with bots.");
  card.appendChild(sub);

  // — choose view —
  const choose = el("div", "display:flex;flex-direction:column;gap:8px");
  choose.appendChild(btn("⚡ Quick Match", () => cb.onQuick(), true));
  choose.appendChild(btn("＋ Create Room", () => cb.onCreate(), false));
  const joinRow = el("div", "display:flex;gap:6px;align-items:center");
  const codeIn = el("input", "flex:1;padding:11px;border-radius:9px;border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.3);color:#fff;font:600 15px monospace;letter-spacing:.15em;text-transform:uppercase");
  codeIn.placeholder = "CODE"; codeIn.maxLength = 4;
  const joinBtn = btn("Join", () => { const c = codeIn.value.trim().toUpperCase(); if (c.length === 4) cb.onJoin(c); });
  joinRow.append(codeIn, joinBtn); choose.appendChild(joinRow);
  card.appendChild(choose);

  // — waiting room —
  const wait = el("div", "display:none;flex-direction:column;gap:10px;align-items:center");
  const codeBox = el("div", "text-align:center");
  const codeLabel = el("div", "opacity:.6;font-size:12px", "ROOM CODE");
  const codeVal = el("div", "font:800 40px monospace;letter-spacing:.25em;color:" + ACCENT);
  codeBox.append(codeLabel, codeVal); wait.appendChild(codeBox);
  const peers = el("div", "font-size:14px;opacity:.85", "Players: 1"); wait.appendChild(peers);
  const hostOpts = el("div", "display:none;flex-direction:column;gap:8px;width:100%");
  const modeSel = el("select", "padding:9px;border-radius:8px;background:rgba(0,0,0,.3);color:#fff;border:1px solid rgba(255,255,255,.15)");
  [["normal", "Normal"], ["infection", "Infection"], ["double", "Double"], ["reverse", "Reverse Chicken Race"]].forEach(([v, n]) => { const o = document.createElement("option"); o.value = v; o.textContent = n; modeSel.appendChild(o); });
  const mapSel = el("select", "padding:9px;border-radius:8px;background:rgba(0,0,0,.3);color:#fff;border:1px solid rgba(255,255,255,.15)");
  [{ id: "random", name: "🎲 Random stage" }].concat(maps || []).forEach((m) => { const o = document.createElement("option"); o.value = m.id; o.textContent = m.name; mapSel.appendChild(o); });
  const sizeRow = el("label", "display:flex;align-items:center;gap:8px;font-size:13px;opacity:.85");
  const sizeIn = el("input", "flex:1;accent-color:" + ACCENT); sizeIn.type = "range"; sizeIn.min = 2; sizeIn.max = 10; sizeIn.value = 6;
  const sizeLbl = el("span", "min-width:64px;font-weight:600", "6 players"); sizeIn.oninput = () => sizeLbl.textContent = sizeIn.value + " players";
  sizeRow.append(el("span", "", "Lobby"), sizeIn, sizeLbl); hostOpts.append(modeSel, mapSel, sizeRow);
  const startBtn = btn("▶ Start Match", () => cb.onStart({ mode: modeSel.value, mapId: mapSel.value, lobbySize: parseInt(sizeIn.value, 10) }), true);
  hostOpts.appendChild(startBtn); wait.appendChild(hostOpts);
  const guestMsg = el("div", "display:none;opacity:.7;font-style:italic", "Waiting for the host to start…"); wait.appendChild(guestMsg);
  card.appendChild(wait);

  const err = el("div", "color:#ff8080;font-size:13px;margin-top:10px;min-height:16px"); card.appendChild(err);
  const back = btn("← Back", () => cb.onBack()); back.style.marginTop = "12px"; card.appendChild(back);
  root.appendChild(card); host.appendChild(root);

  return {
    el: root,
    show: () => { root.style.display = "flex"; choose.style.display = "flex"; wait.style.display = "none"; err.textContent = ""; codeIn.value = ""; },
    hide: () => (root.style.display = "none"),
    showWaiting: ({ host: isHost, code, searching }) => {
      choose.style.display = "none"; wait.style.display = "flex"; err.textContent = "";
      codeVal.textContent = searching ? "…" : (code || "—");
      codeLabel.textContent = searching ? "SEARCHING" : "ROOM CODE";
      hostOpts.style.display = isHost ? "flex" : "none";
      guestMsg.style.display = isHost ? "none" : "block";
    },
    updatePeers: (n) => (peers.textContent = "Players: " + n),
    setError: (m) => (err.textContent = m || ""),
  };
}

// ── Pause menu (wired to window.__PAUSE__ so the control bar's ⏸ works) ───────
export function createPauseMenu(host, cb) {
  const root = el("div", overlayCss(58) + ";background:rgba(6,10,14,.8);display:none");
  const card = el("div", `background:${PANEL_BG};border-radius:16px;padding:26px 34px;text-align:center`);
  card.appendChild(el("h2", "font:800 26px system-ui;margin:0 0 16px", "Paused"));
  const resume = btn("Resume", () => api.resume(), true);
  card.append(resume, btn("Settings", () => cb.onSettings && cb.onSettings()), btn("Quit to Menu", () => { api.resume(); cb.onQuit(); }));
  root.appendChild(card); host.appendChild(root);
  let paused = false;
  const api = {
    el: root,
    isPaused: () => paused,
    pause: () => { paused = true; root.style.display = "flex"; cb.onPause && cb.onPause(); },
    resume: () => { paused = false; root.style.display = "none"; cb.onResume && cb.onResume(); },
    toggle: () => (paused ? api.resume() : api.pause()),
  };
  window.__PAUSE__ = api; // control bar ⏸ + ESC
  return api;
}

// ── Settings ─────────────────────────────────────────────────────────────────
export function createSettings(host, cb) {
  const root = el("div", overlayCss(59) + ";background:rgba(6,10,14,.85);display:none");
  const card = el("div", `background:${PANEL_BG};border-radius:16px;padding:26px 30px;min-width:340px;text-align:left`);
  card.appendChild(el("h2", "font:800 26px system-ui;margin:0 0 16px;text-align:center;color:" + ACCENT, "Settings"));
  const loadS = () => { try { return JSON.parse(localStorage.getItem("ffg_settings") || "{}"); } catch (e) { return {}; } };
  const saveS = (patch) => { const s = Object.assign(loadS(), patch); try { localStorage.setItem("ffg_settings", JSON.stringify(s)); } catch (e) {} return s; };

  // Quality
  card.appendChild(el("div", "font-size:13px;opacity:.7;margin-bottom:6px", "Graphics quality"));
  const qRow = el("div", "display:flex;gap:6px;margin-bottom:16px");
  const cur = loadS().quality || "med";
  const qBtns = {};
  [["low", "Low"], ["med", "Medium"], ["high", "High"]].forEach(([v, n]) => {
    const b = btn(n, () => { saveS({ quality: v }); cb.onQuality && cb.onQuality(v); for (const k in qBtns) qBtns[k].style.background = k === v ? ACCENT : "rgba(255,255,255,.1)"; for (const k in qBtns) qBtns[k].style.color = k === v ? "#04140f" : "#eaf2ff"; });
    b.style.flex = "1"; qBtns[v] = b; qRow.appendChild(b);
  });
  qBtns[cur] && (qBtns[cur].style.background = ACCENT, qBtns[cur].style.color = "#04140f");
  card.appendChild(qRow);

  const slider = (label, key, min, max, def, fmt, on) => {
    const wrap = el("div", "margin-bottom:14px");
    const head = el("div", "display:flex;justify-content:space-between;font-size:13px;opacity:.85;margin-bottom:4px");
    const lbl = el("span", "", label); const val = el("span", "font-weight:700");
    head.append(lbl, val); wrap.appendChild(head);
    const i = el("input", "width:100%;accent-color:" + ACCENT); i.type = "range"; i.min = min; i.max = max; i.step = (max - min) / 100;
    let stored = def; try { const v = parseFloat(localStorage.getItem(key)); if (!isNaN(v)) stored = v; } catch (e) {}
    i.value = stored; val.textContent = fmt(stored);
    i.oninput = () => { const v = parseFloat(i.value); val.textContent = fmt(v); try { localStorage.setItem(key, String(v)); } catch (e) {} on(v); };
    wrap.appendChild(i); return wrap;
  };
  card.appendChild(slider("Mouse sensitivity", "chroma_sens", 0.3, 2.5, 1.0, (v) => v.toFixed(2) + "×", (v) => cb.onSensitivity && cb.onSensitivity(v)));
  card.appendChild(slider("Master volume", "chroma_vol", 0, 1, 0.5, (v) => Math.round(v * 100) + "%", (v) => cb.onVolume && cb.onVolume(v)));

  // Colour-blind assist (adds outline to hider beacons — a mild aid)
  const cbRow = el("label", "display:flex;align-items:center;gap:8px;font-size:13px;opacity:.85;margin-bottom:16px;cursor:pointer");
  const cbChk = el("input"); cbChk.type = "checkbox"; cbChk.checked = !!loadS().colorAssist; cbChk.style.accentColor = ACCENT;
  cbChk.onchange = () => { saveS({ colorAssist: cbChk.checked }); cb.onColorAssist && cb.onColorAssist(cbChk.checked); };
  cbRow.append(cbChk, el("span", "", "Colour-blind assist")); card.appendChild(cbRow);

  card.appendChild(btn("Close", () => cb.onClose(), true));
  root.appendChild(card); host.appendChild(root);
  return { el: root, show: () => (root.style.display = "flex"), hide: () => (root.style.display = "none") };
}
