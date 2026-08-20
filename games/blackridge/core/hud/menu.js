// core/hud/menu.js [A10] — title / briefing / settings / credits screens:
// full-bleed BLURRED IN-ENGINE frame (the live canvas behind a backdrop-filter
// wash — VT §6 "blurred/darkened mission still") + left-rail vertical nav in
// caps with the amber active tick. Zero ornament: no panel borders, no corner
// brackets, no scan-lines (amateur tell #10 guard).
//
// Shell contract (architecture §3.17 + doctrine §6):
//  - menu.screenBefore is ASSIGNED on EVERY navigation (show AND hide) — the
//    stranded-Back-button lesson.
//  - ESC here acts only while NO mission is live (pause.js owns ESC in-play;
//    settings' own handler consumes the press while its overlay is up).
//  - 'settings' is a menu screen by contract; it opens the shared settings
//    overlay via cb.onSettings() (boot → settingsUI.show()); Back lands on
//    menu.screenBefore through settings_ui's default back path.
//  - DEPLOY drives cb.onStartMission() (boot's real startMission incl. the
//    soldiers.ready gate) — single-flight, with an honest failure line; boot
//    calls menu.hide() itself when the mission is up.
//
// Frozen signature: createMenu(ctx, cb) → {show(screen), hide(), screenBefore}.

import { shell, isMissionLive, ensureShellStyle } from "./hud.js";

const CONTROLS = [
  ["WASD", "move"], ["MOUSE", "look"], ["LMB", "fire"], ["RMB", "aim"],
  ["SHIFT", "sprint (double-tap: tac sprint)"], ["SPACE", "jump / mantle"],
  ["C / CTRL", "crouch · slide while sprinting"], ["R", "reload"],
  ["G", "frag (hold to cook)"], ["F", "interact"], ["1 / 2", "weapons"],
  ["ESC", "pause"],
];

export function createMenu(ctx, cb) {
  ensureShellStyle();

  const fiction = (ctx.content && ctx.content.mission && ctx.content.mission.fiction) || {};
  const opName = fiction.operation || "BLACKRIDGE";
  const tagline = ((fiction.district || "meridian ward") + " · " + (fiction.city || "zarov")).toLowerCase();

  // ------------------------------------------------------------------ DOM
  const root = document.createElement("div");
  root.id = "menu";
  root.className = "a10-overlay";
  root.style.display = "none";
  root.style.zIndex = "50";

  const wash = document.createElement("div");
  wash.className = "wash";
  root.appendChild(wash);

  const rail = document.createElement("div");
  rail.className = "a10-rail";
  rail.innerHTML =
    `<div class="wm">BLACKRIDGE</div>` +
    `<div class="tag">${tagline}</div>` +
    `<div class="nav"></div>`;
  root.appendChild(rail);
  const navEl = rail.querySelector(".nav");

  const panel = document.createElement("div");
  panel.className = "a10-panel";
  root.appendChild(panel);

  const vmark = document.createElement("div");
  vmark.className = "a10-vmark";
  vmark.textContent = `BLACKRIDGE ${ctx.version || ""}`;
  root.appendChild(vmark);

  document.body.appendChild(root);

  // ------------------------------------------------------------------ render
  let deploying = false;

  function navBtn(action, label, cls = "", on = false) {
    return `<button class="a10-item ${cls}${on ? " on" : ""}" data-a="${action}">${label}</button>`;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function render(screen) {
    if (screen === "title") {
      navEl.innerHTML =
        navBtn("start", "Start mission") +
        navBtn("settings", "Settings") +
        navBtn("credits", "Credits");
      panel.innerHTML = "";
    } else if (screen === "briefing") {
      navEl.innerHTML =
        navBtn("deploy", deploying ? "Deploying…" : "Deploy", "", true) +
        navBtn("back", "Back");
      const rows = CONTROLS.map(([k, v]) =>
        `<div class="a10-row"><span class="lbl">${k}</span><span class="val" style="min-width:0;font-size:11.5px;letter-spacing:.08em;opacity:.75">${v}</span></div>`).join("");
      panel.innerHTML =
        `<h2>Briefing — Operation ${esc(opName)}</h2>` +
        `<div class="body">` +
        `<div style="margin-bottom:16px">${esc(fiction.premise || "")}</div>` +
        `<div style="font-size:11px;letter-spacing:.22em;opacity:.55;margin-bottom:4px">CALLSIGN ` +
        `<span class="amber">${esc(fiction.playerCallsign || "RAVEN 2-1")}</span>` +
        ` — OPFOR <span class="amber">${esc(fiction.enemy || "")}</span></div>` +
        `<div class="a10-err" style="display:none;color:var(--a10-red);font-size:12px;` +
        `letter-spacing:.08em;margin:10px 0"></div>` +
        `<div style="margin-top:18px">${rows}</div>` +
        `</div>`;
    } else if (screen === "credits") {
      navEl.innerHTML = navBtn("back", "Back");
      panel.innerHTML =
        `<h2>Credits</h2>` +
        `<div class="body">` +
        `An original ForgeFlow Games mission. All fiction, places, factions and ` +
        `weapons are invented for this project.` +
        `<pre style="margin-top:18px">three.js (MIT)
Oswald typeface — SIL Open Font License 1.1
Gun/impact one-shots — Free Firearm Sound Library + Kenney (CC0)
Footsteps — Kenney impact-sounds / Antifon pack (CC0)
Environment kits — Kenney / Quaternius (CC0) · Poly Haven (CC0)
Character bodies — Meshy-generated for ForgeFlow Games
Score — procedural Web-Audio, unique to BLACKRIDGE
Full per-asset provenance: CREDITS.md</pre></div>`;
    } else if (screen === "settings") {
      // The shared settings overlay covers this screen; keep the rail state
      // honest for when it closes back onto us.
      navEl.innerHTML =
        navBtn("start", "Start mission") +
        navBtn("settings", "Settings", "", true) +
        navBtn("credits", "Credits");
      panel.innerHTML = "";
    }
  }

  // ------------------------------------------------------------------ actions
  function deploy() {
    if (deploying) return;
    deploying = true;
    render("briefing");
    Promise.resolve(cb && cb.onStartMission ? cb.onStartMission() : null)
      .catch((err) => {
        console.error("[menu] deploy failed:", err);
        deploying = false;
        if (menu._screen === "briefing") {
          render("briefing");
          const e = panel.querySelector(".a10-err");
          if (e) {
            e.style.display = "block";
            e.textContent = "DEPLOY FAILED — " + String((err && err.message) || err);
          }
        }
      })
      .then(() => { deploying = false; });
  }

  root.addEventListener("click", (e) => {
    const a = e.target && e.target.getAttribute && e.target.getAttribute("data-a");
    if (!a) return;
    if (a === "start") menu.show("briefing");
    else if (a === "deploy") deploy();
    else if (a === "back") menu.show(menu.screenBefore || "title");
    else if (a === "settings") menu.show("settings");
    else if (a === "credits") menu.show("credits");
  });

  window.addEventListener("keydown", (e) => {
    if (e.code !== "Escape") return;
    if (isMissionLive(ctx)) return;                            // pause.js owns ESC in-play
    if (shell.settingsUI && shell.settingsUI.visible) return;  // settings' handler consumes
    if (root.style.display === "none" || !menu._screen) return;
    if (menu._screen !== "title") menu.show(menu.screenBefore || "title");
  });

  // ------------------------------------------------------------------ api
  const menu = {
    screenBefore: null,
    _screen: null,
    show(screen = "title") {
      menu.screenBefore = menu._screen; // assigned on EVERY navigation (doctrine §6)
      menu._screen = screen;
      root.style.display = "block";
      render(screen);
      if (screen === "settings" && cb && cb.onSettings) cb.onSettings();
    },
    hide() {
      menu.screenBefore = menu._screen;
      menu._screen = null;
      root.style.display = "none";
    },
  };

  shell.menu = menu;
  return menu;
}
