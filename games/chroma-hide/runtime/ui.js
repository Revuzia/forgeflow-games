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

// ── Shared brand stylesheet (one source of truth for every overlay) ──────────
let _stylesInjected = false;
export function injectChromaStyles() {
  if (_stylesInjected || typeof document === "undefined") return;
  _stylesInjected = true;
  const s = document.createElement("style"); s.id = "ct-styles";
  s.textContent = `
  :root{--ct-teal:#7fe3c4;--ct-violet:#c8a6ff;--ct-ink:#eaf2ff;--ct-dim:rgba(234,242,255,.62);
    --ct-panel:rgba(12,16,24,.55);--ct-brd:rgba(255,255,255,.12);--ct-chip:rgba(255,255,255,.06);
    --ct-grad:linear-gradient(90deg,var(--ct-teal),var(--ct-violet));--ct-font:system-ui,-apple-system,'Segoe UI',sans-serif;}
  .ct-root{position:absolute;inset:0;z-index:60;overflow:hidden;display:grid;place-items:center;pointer-events:auto;font-family:var(--ct-font);color:var(--ct-ink)}
  .ct-bg{position:absolute;inset:-4%;background:#0b0f16 center/cover no-repeat;transform:scale(1.06);animation:ctKen 45s ease-in-out infinite alternate;pointer-events:none}
  @keyframes ctKen{from{transform:scale(1.06) translate3d(0,0,0)}to{transform:scale(1.13) translate3d(-1.5%,-1%,0)}}
  .ct-scrim{position:absolute;inset:0;pointer-events:none;background:
    radial-gradient(120% 85% at 50% 12%,transparent 40%,rgba(6,9,14,.55) 100%),
    linear-gradient(180deg,rgba(6,9,14,.34) 0%,rgba(6,9,14,.12) 42%,rgba(6,9,14,.82) 100%)}
  .ct-blob{position:absolute;border-radius:50%;filter:blur(60px);opacity:.4;z-index:1;pointer-events:none;mix-blend-mode:screen}
  .ct-blob.a{width:340px;height:340px;background:var(--ct-teal);left:-6%;top:16%;animation:ctFloat 15s ease-in-out infinite alternate}
  .ct-blob.b{width:300px;height:300px;background:var(--ct-violet);right:-4%;bottom:4%;animation:ctFloat 19s ease-in-out infinite alternate-reverse}
  @keyframes ctFloat{to{transform:translate3d(4%,-6%,0) scale(1.15)}}
  .ct-content{position:relative;z-index:2;width:min(1120px,92vw);display:grid;grid-template-columns:1.05fr .95fr;gap:clamp(24px,4vw,56px);align-items:center}
  .ct-hero{text-align:left}
  .ct-kicker{font:800 13px/1 var(--ct-font);letter-spacing:.42em;color:var(--ct-teal);opacity:.9;margin-bottom:14px}
  .ct-wordmark{margin:0;font:900 clamp(50px,7.5vw,98px)/.9 var(--ct-font);letter-spacing:-.02em;background:var(--ct-grad);background-size:220% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 6px 30px rgba(127,227,196,.28));animation:ctSheen 8s ease-in-out infinite}
  @keyframes ctSheen{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
  .ct-tag{margin-top:18px;max-width:40ch;line-height:1.5;color:var(--ct-dim);font-size:clamp(14px,1.5vw,17px)}
  .ct-panel{position:relative;padding:clamp(18px,2.2vw,26px);border-radius:18px;background:var(--ct-panel);backdrop-filter:blur(22px) saturate(1.2);-webkit-backdrop-filter:blur(22px) saturate(1.2);border:1px solid var(--ct-brd);box-shadow:0 24px 60px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.08);animation:ctRise .5s cubic-bezier(.2,.7,.2,1) both}
  @keyframes ctRise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
  .ct-label{font:700 11px var(--ct-font);letter-spacing:.16em;text-transform:uppercase;color:var(--ct-dim);margin:14px 0 6px}
  .ct-label:first-child{margin-top:0}
  .ct-seg{display:flex;gap:4px;padding:4px;border-radius:11px;background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.07)}
  .ct-seg.wrap{flex-wrap:wrap}
  .ct-seg button{flex:1;border:0;border-radius:8px;padding:10px 8px;cursor:pointer;background:transparent;color:var(--ct-dim);font:700 13px var(--ct-font);transition:background .15s,color .15s,transform .08s}
  .ct-seg.wrap button{flex:1 1 46%}
  .ct-seg button:hover{color:var(--ct-ink)}
  .ct-seg button:active{transform:scale(.97)}
  .ct-seg button.on-hider{background:var(--ct-teal);color:#04140f}
  .ct-seg button.on-seeker{background:var(--ct-violet);color:#160a2b}
  .ct-seg button.on{background:rgba(127,227,196,.2);color:#eaf2ff;box-shadow:inset 0 0 0 1px rgba(127,227,196,.5)}
  .ct-maps{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
  .ct-map{flex:0 0 118px;text-align:left;cursor:pointer;border-radius:12px;padding:9px;border:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.3);transition:border-color .15s,transform .1s;color:var(--ct-ink)}
  .ct-map:hover{transform:translateY(-2px)}
  .ct-map.on{border-color:var(--ct-teal);box-shadow:0 0 0 1px var(--ct-teal),0 8px 24px rgba(127,227,196,.15)}
  .ct-map .sw{height:44px;border-radius:8px;margin-bottom:7px}
  .ct-map h4{margin:0 0 2px;font:800 12px var(--ct-font)}
  .ct-map p{margin:0;font:400 10.5px/1.35 var(--ct-font);color:var(--ct-dim);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .ct-slrow{display:flex;align-items:center;gap:12px}
  .ct-slider{flex:1;height:6px;border-radius:99px;appearance:none;-webkit-appearance:none;background:linear-gradient(90deg,var(--ct-teal) var(--fill,50%),rgba(255,255,255,.14) var(--fill,50%));outline:none}
  .ct-slider::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.4),0 0 0 4px rgba(127,227,196,.25);cursor:pointer}
  .ct-val{font:800 13px var(--ct-font);color:var(--ct-teal);min-width:74px;text-align:right}
  .ct-actions{display:flex;gap:10px;margin-top:16px}
  .ct-play{flex:1;border:0;border-radius:12px;padding:15px 20px;cursor:pointer;font:800 17px var(--ct-font);color:#04140f;background:var(--ct-grad);background-size:180% 100%;box-shadow:0 10px 30px rgba(127,227,196,.28);transition:transform .1s,box-shadow .2s;animation:ctGrad 6s ease infinite}
  .ct-play:hover{transform:translateY(-2px);box-shadow:0 14px 36px rgba(127,227,196,.4)}
  @keyframes ctGrad{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
  .ct-online{border:1px solid var(--ct-violet);background:rgba(200,166,255,.12);color:var(--ct-violet);border-radius:12px;padding:15px 16px;font:800 14px var(--ct-font);cursor:pointer}
  .ct-online:hover{background:rgba(200,166,255,.2)}
  .ct-foot{display:flex;gap:6px;margin-top:12px;justify-content:center}
  .ct-foot button{background:none;border:0;color:var(--ct-dim);font:600 13px var(--ct-font);cursor:pointer;padding:6px 10px;border-radius:8px}
  .ct-foot button:hover{color:var(--ct-ink);background:rgba(255,255,255,.06)}
  .ct-root :focus-visible{outline:2px solid var(--ct-teal);outline-offset:2px}
  @media (max-width:900px),(max-aspect-ratio:1/1){.ct-content{grid-template-columns:1fr;width:min(560px,92vw);gap:16px;max-height:94vh}.ct-panel{overflow:auto}.ct-hero{text-align:center}}
  @media (prefers-reduced-motion:reduce){.ct-bg,.ct-wordmark,.ct-play,.ct-panel,.ct-blob{animation:none!important}}
  `;
  document.head.appendChild(s);
}
function mapTint(m) {
  const named = { manor: ["#8a5a44", "#3f7d6e"], understage: ["#39424a", "#5a3b2a"], hollow: ["#c9ba52", "#b2a44e"] };
  if (named[m.id]) return `linear-gradient(135deg,${named[m.id][0]},${named[m.id][1]})`;
  let h = 0; for (const c of (m.name || m.id || "x")) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `linear-gradient(135deg,hsl(${h} 45% 45%),hsl(${(h + 40) % 360} 45% 35%))`;
}

// ── Title / main menu (cover-art layout) ─────────────────────────────────────
/**
 * UI sound. Bound once by delegation on the UI root rather than at twenty call sites, so
 * every button, map card and mode chip — including any added later — speaks automatically.
 * The UI deliberately has its own vocabulary (click/hover/select/back) separate from the
 * gameplay cues, which all share the world's spatial bus.
 */
let _uiAudio = null;
export function setUiAudio(audio, root) {
  _uiAudio = audio;
  if (!root || root.__uiSound) return;
  root.__uiSound = true;
  const hit = (t) => t && t.closest && t.closest("button, .card, .chip, [role=button]");
  root.addEventListener("pointerdown", (e) => {
    if (!_uiAudio || !hit(e.target)) return;
    const el = hit(e.target);
    const back = /back|cancel|close|quit|menu/i.test(el.textContent || "");
    back ? _uiAudio.back() : _uiAudio.click();
  }, true);
  root.addEventListener("pointerover", (e) => {
    const el = hit(e.target);
    if (!_uiAudio || !el || el === root.__lastHover) return;
    root.__lastHover = el; _uiAudio.hover();
  }, true);
  root.addEventListener("change", (e) => {
    const t = e.target;
    if (!_uiAudio || !t) return;
    if (t.type === "checkbox" || t.tagName === "SELECT") _uiAudio.toggle();
  }, true);
}

// modeInfo is PASSED IN rather than imported: ui.js deliberately has zero imports so
// every module can be loaded with a ?v= cache-buster, and a static import here would
// ship an uncacheable second copy of match_core.
export function createTitleMenu(host, cb, maps, modeInfo) {
  injectChromaStyles();
  const root = el("div", "", ""); root.className = "ct-root";
  const bg = el("div", "", ""); bg.className = "ct-bg"; bg.style.backgroundImage = "url('thumbnail.png')";
  const scrim = el("div", "", ""); scrim.className = "ct-scrim";
  const blobA = el("div", "", ""); blobA.className = "ct-blob a";
  const blobB = el("div", "", ""); blobB.className = "ct-blob b";
  root.append(bg, scrim, blobA, blobB);

  const content = el("div", "", ""); content.className = "ct-content";
  const hero = el("div", "", `<div class="ct-kicker">FORGEFLOW GAMES</div><h1 class="ct-wordmark">CHROMA&nbsp;HIDE</h1><p class="ct-tag">Paint your blank‑white body to melt into the room, hold a pose, and hide in plain sight — while seekers hunt with a gun and limited ammo.</p>`);
  hero.className = "ct-hero";
  const panel = el("div", "", ""); panel.className = "ct-panel";

  let role = "hider", mode = "normal", mapId = "depot";

  let bodySize = 1.4;   // metres-ish scale; BODY_SIZES in match_core

  // Role segmented control
  panel.appendChild(el("div", "", "Play as")).className = "ct-label";
  const roleSeg = el("div", "", ""); roleSeg.className = "ct-seg";
  const roleBtns = {};
  for (const [id, lbl] of [["hider", "🎨 Hider"], ["seeker", "🔫 Seeker"]]) {
    const b = el("button", "", lbl); b.onclick = () => { role = id; syncRole(); };
    roleBtns[id] = b; roleSeg.appendChild(b);
  }
  function syncRole() { for (const k in roleBtns) roleBtns[k].className = k === role ? ("on-" + k) : ""; }
  panel.appendChild(roleSeg);

  // Mode segmented control
  panel.appendChild(el("div", "", "Mode")).className = "ct-label";
  const modeSeg = el("div", "", ""); modeSeg.className = "ct-seg wrap";
  const modeBtns = {};
  // The map cards below render a blurb each; the modes rendered four bare words, so three
  // of the four were never explained anywhere in the game even though MODE_INFO has had
  // the text all along.
  const MI = modeInfo || {};
  const blurbFor = (id) => {
    const m = MI[id]; if (!m) return "";
    // Double and Reverse put EVERYONE in hiding first, silently overriding the Play-as
    // control directly above — say so rather than letting the player discover it.
    return m.blurb + (m.everyoneHides ? " Everyone hides first, so your Play-as pick doesn't apply." : "");
  };
  for (const [id, name] of [["normal", "Normal"], ["infection", "Infection"], ["double", "Double"], ["reverse", "Reverse Chicken Race"]]) {
    const b = el("button", "", name);
    b.title = blurbFor(id);
    b.onclick = () => { mode = id; for (const k in modeBtns) modeBtns[k].className = k === id ? "on" : ""; modeDesc.textContent = blurbFor(id); };
    modeBtns[id] = b; modeSeg.appendChild(b);
  }
  panel.appendChild(modeSeg);
  const modeDesc = el("div", "", blurbFor("normal"));
  modeDesc.style.cssText = "margin:6px 2px 0;font:400 11.5px/1.45 system-ui,-apple-system,sans-serif;color:#8b97a8;min-height:2.6em";
  panel.appendChild(modeDesc);

  // Body size. A real trade, not a cosmetic: a small body tucks behind cover a large one
  // cannot use, but hiders score for time spent in a seeker's sight without being caught,
  // and a big body banks those points far faster.
  panel.appendChild(el("div", "", "Body")).className = "ct-label";
  const sizeSeg = el("div", "", ""); sizeSeg.className = "ct-seg";
  const sizeBtns = {};
  for (const [v, name] of [["1", "Small · hides easily"], ["1.4", "Standard"], ["1.7", "Large · scores faster"]]) {
    const b = el("button", "", name);
    b.onclick = () => { bodySize = parseFloat(v); for (const k in sizeBtns) sizeBtns[k].className = k === v ? "on" : ""; };
    sizeBtns[v] = b; sizeSeg.appendChild(b);
  }
  sizeBtns["1.4"].className = "on";
  panel.appendChild(sizeSeg);

  // Stage cards
  panel.appendChild(el("div", "", "Stage")).className = "ct-label";
  const mapWrap = el("div", "", ""); mapWrap.className = "ct-maps";
  const mapCards = {};
  const allMaps = [{ id: "random", name: "🎲 Random", blurb: "A surprise stage each match." }].concat(maps || []);
  for (const m of allMaps) {
    const card = el("div", "", `<div class="sw"></div><h4>${m.name}</h4><p>${m.blurb || ""}</p>`);
    card.className = "ct-map"; card.querySelector(".sw").style.background = m.id === "random" ? "var(--ct-grad)" : mapTint(m);
    card.onclick = () => { mapId = m.id; for (const k in mapCards) mapCards[k].classList.toggle("on", k === mapId); };
    mapCards[m.id] = card; mapWrap.appendChild(card);
  }
  panel.appendChild(mapWrap);

  // Lobby size
  panel.appendChild(el("div", "", "Lobby size")).className = "ct-label";
  const slRow = el("div", "", ""); slRow.className = "ct-slrow";
  const slider = el("input", ""); slider.type = "range"; slider.min = 2; slider.max = 10; slider.value = 6; slider.className = "ct-slider";
  const valEl = el("span", "", "6 players"); valEl.className = "ct-val";
  const setFill = () => { slider.style.setProperty("--fill", ((slider.value - 2) / 8 * 100) + "%"); valEl.textContent = slider.value + " players"; };
  slider.oninput = setFill; slRow.append(slider, valEl); panel.appendChild(slRow);

  // Actions
  const actions = el("div", "", ""); actions.className = "ct-actions";
  const play = el("button", "", "▶  PLAY"); play.className = "ct-play";
  play.onclick = () => cb.onPlay({ role, mode, players: parseInt(slider.value, 10), mapId, bodySize });
  const online = el("button", "", "🌐 Online"); online.className = "ct-online";
  online.onclick = () => cb.onOnline && cb.onOnline();
  actions.append(play, online); panel.appendChild(actions);

  const foot = el("div", "", ""); foot.className = "ct-foot";
  const help = el("button", "", "How to Play"); help.onclick = () => cb.onHelp && cb.onHelp();
  const settings = el("button", "", "Settings"); settings.onclick = () => cb.onSettings && cb.onSettings();
  foot.append(help, settings); panel.appendChild(foot);

  content.append(hero, panel); root.appendChild(content);
  host.appendChild(root);
  syncRole(); modeBtns.normal.className = "on"; (mapCards.depot || mapCards.random).classList.add("on"); setFill();
  return { el: root, show: () => (root.style.display = "grid"), hide: () => (root.style.display = "none") };
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
