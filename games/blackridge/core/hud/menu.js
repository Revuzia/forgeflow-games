// core/hud/menu.js [A10 · W6] — title / mode-select / briefing / settings /
// credits screens: full-bleed BLURRED IN-ENGINE frame (the live canvas behind
// a backdrop-filter wash — VT §6) + left-rail vertical nav in caps with the
// amber active tick. Zero ornament (amateur tell #10 guard).
//
// W6 (PVP_BUILD_PLAN Part 4.1, owner amendment A1): the title rail offers
// FOUR entries — CAMPAIGN (the existing mission, unchanged), SKIRMISH,
// CAPTURE THE FLAG, FREE-FOR-ALL — plus Settings/Credits. The three PVP
// entries open the mode-select screen (mode_select.js) preselected; START
// MATCH drives ctx.startMatch({mode, difficulty}) (boot.js W1). A mode whose
// lane has not landed shows COMING ONLINE and cannot start (honest failure,
// never a page error).
//
// menu.js is also the W6 integration point: boot.js imports only createMenu
// from this lane's files, so the match HUD, the scoreboard and the flag view
// are created and bridge-attached HERE. boot.js calls bridge.clear() on every
// mission/match start and re-attaches only its own modules, so this file
// wraps ctx.bridge.clear once to re-register the W6 handlers after every
// clear (the bridge is frozen and attachAll is W1's — this seam is ours).
//
// Shell contract (architecture §3.17 + doctrine §6): unchanged —
//  - menu.screenBefore is ASSIGNED on EVERY navigation (show AND hide).
//  - ESC here acts only while NO mission is live (pause.js owns ESC in-play).
//  - 'settings' opens the shared overlay via cb.onSettings().
//  - DEPLOY drives cb.onStartMission() (campaign, single-flight, honest
//    failure line); boot calls menu.hide() itself when the mission is up.
//
// Frozen signature: createMenu(ctx, cb) → {show(screen), hide(), screenBefore}.

import { shell, isMissionLive, ensureShellStyle } from "./hud.js";
import { MODES, MODE_IDS, registerMode } from "../match/match.js";
import { createMatchHud } from "./match_hud.js";
import { createScoreboard } from "./scoreboard.js";
import { createModeSelect } from "./mode_select.js";
import { createFlagView } from "../match/flagview.js";

// ---------------------------------------------------------------------------
// Mode registration into the registry the SIM actually reads.
// Verified live this session: boot.js imports core/match/match.js with the
// ?v=N suffix and registers landed mode modules THERE, but sim.js imports
// "../match/match.js" bare — a DIFFERENT ES module instance — so makeMatch
// consulted an empty registry and startMatch failed with tdm.js on disk.
// Until W1 unifies the specifiers (reported in the lane report), the match
// shell probes + registers each mode module against the bare instance, which
// is the one this file, mode_select.js and sim.js all share. registerMode is
// an idempotent overwrite, so this composes safely with a later boot.js fix.
// ---------------------------------------------------------------------------
const modeProbe = {}; // id → 'pending' | 'done' (re-probed while unlanded)
async function ensureModeRegistered(id) {
  if (typeof MODES[id] === "function") return true;
  if (modeProbe[id] === "pending") return false;
  modeProbe[id] = "pending";
  try {
    const res = await fetch(`./core/match/modes/${id}.js`, { cache: "no-store" });
    if (res.ok) {
      const mm = await import(`../match/modes/${id}.js`);
      if (mm && mm.createMode && typeof MODES[id] !== "function") {
        registerMode(id, mm.createMode);
        console.log(`[menu] mode '${id}' registered (match shell, bare registry)`);
      }
    }
  } catch (e) {
    console.warn(`[menu] mode '${id}' failed to import:`, e && e.message);
  }
  modeProbe[id] = "done";
  return typeof MODES[id] === "function";
}

const CONTROLS = [
  ["WASD", "move"], ["MOUSE", "look"], ["LMB", "fire"], ["RMB", "aim"],
  ["SHIFT", "sprint (double-tap: tac sprint)"], ["SPACE", "jump / mantle"],
  ["C / CTRL", "crouch · slide while sprinting"], ["R", "reload"],
  ["G", "frag (hold to cook)"], ["F", "interact"], ["1 / 2", "weapons"],
  ["TAB", "scoreboard (hold, in match)"], ["ESC", "pause"],
];

export function createMenu(ctx, cb) {
  ensureShellStyle();

  const fiction = (ctx.content && ctx.content.mission && ctx.content.mission.fiction) || {};
  const opName = fiction.operation || "BLACKRIDGE";
  const tagline = ((fiction.district || "meridian ward") + " · " + (fiction.city || "zarov")).toLowerCase();

  // ---------------------------------------------------------- W6 match shell
  // Created once, attached to the bridge, and re-attached after every
  // bridge.clear() (boot re-registers only its own modules).
  const matchHud = createMatchHud(ctx);
  const scoreboard = createScoreboard(ctx);
  const flagView = createFlagView(ctx);
  shell.matchHud = matchHud;
  shell.scoreboard = scoreboard;

  function attachW6() {
    matchHud.attach(ctx.bridge);
    scoreboard.attach(ctx.bridge);
    flagView.attach(ctx.bridge);
  }
  if (ctx.bridge && !ctx.bridge.__w6Rewire) {
    ctx.bridge.__w6Rewire = true;
    const origClear = ctx.bridge.clear.bind(ctx.bridge);
    ctx.bridge.clear = () => { origClear(); attachW6(); };
  }
  attachW6();

  // probe every mode lane once at creation; unlanded ones re-probe when the
  // mode-select screen opens, so CTF/FFA light up the session they land.
  for (const id of MODE_IDS) {
    ensureModeRegistered(id).then((ok) => {
      if (ok && menu._screen === "modeselect") render("modeselect");
    });
  }

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

  // ------------------------------------------------------------ mode select
  const modeSelect = createModeSelect(ctx, {
    onSelectionChange() { renderNav("modeselect"); },
  });

  // ------------------------------------------------------------------ render
  let deploying = false;      // campaign deploy single-flight
  let matchStarting = false;  // match start single-flight

  function navBtn(action, label, cls = "", on = false) {
    return `<button class="a10-item ${cls}${on ? " on" : ""}" data-a="${action}">${label}</button>`;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function renderNav(screen) {
    if (screen === "title") {
      navEl.innerHTML =
        navBtn("campaign", "Campaign") +
        navBtn("mode:tdm", "Skirmish") +
        navBtn("mode:ctf", "Capture the Flag") +
        navBtn("mode:ffa", "Free-for-All") +
        navBtn("settings", "Settings") +
        navBtn("credits", "Credits");
    } else if (screen === "modeselect") {
      const ok = modeSelect.available(modeSelect.mode);
      navEl.innerHTML =
        navBtn("startmatch",
          matchStarting ? "Starting…" : ok ? "Start match" : "Coming online",
          "", ok) +
        navBtn("back", "Back");
    } else if (screen === "briefing") {
      navEl.innerHTML =
        navBtn("deploy", deploying ? "Deploying…" : "Deploy", "", true) +
        navBtn("back", "Back");
    } else if (screen === "credits") {
      navEl.innerHTML = navBtn("back", "Back");
    } else if (screen === "settings") {
      navEl.innerHTML =
        navBtn("campaign", "Campaign") +
        navBtn("mode:tdm", "Skirmish") +
        navBtn("mode:ctf", "Capture the Flag") +
        navBtn("mode:ffa", "Free-for-All") +
        navBtn("settings", "Settings", "", true) +
        navBtn("credits", "Credits");
    }
  }

  function render(screen) {
    renderNav(screen);
    if (screen === "title" || screen === "settings") {
      panel.innerHTML = "";
    } else if (screen === "modeselect") {
      modeSelect.render(panel);
    } else if (screen === "briefing") {
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

  function startMatch() {
    if (matchStarting) return;
    const mode = modeSelect.mode;
    if (!modeSelect.available(mode)) {
      modeSelect.showError(
        `${modeSelect.displayName(mode)} IS COMING ONLINE — its mode module ` +
        `(core/match/modes/${mode}.js) has not landed yet.`);
      return;
    }
    if (!ctx.startMatch) {
      modeSelect.showError("MATCH ENTRY NOT WIRED — boot has not assigned ctx.startMatch.");
      return;
    }
    matchStarting = true;
    renderNav("modeselect");
    Promise.resolve(ctx.startMatch({ mode, difficulty: modeSelect.difficulty }))
      .then((ok) => {
        matchStarting = false;
        if (!ok && menu._screen === "modeselect") {
          renderNav("modeselect");
          modeSelect.showError(
            "MATCH FAILED TO START — see the console for the driver's reason.");
        }
        // on success boot.js hides the menu itself (same contract as deploy)
      })
      .catch((err) => {
        console.error("[menu] startMatch failed:", err);
        matchStarting = false;
        if (menu._screen === "modeselect") {
          renderNav("modeselect");
          modeSelect.showError("MATCH FAILED TO START — " + String((err && err.message) || err));
        }
      });
  }

  root.addEventListener("click", (e) => {
    const a = e.target && e.target.getAttribute && e.target.getAttribute("data-a");
    if (!a) return;
    if (a === "campaign") menu.show("briefing");
    else if (a.startsWith("mode:")) {
      modeSelect.mode = a.slice(5);
      menu.show("modeselect");
    }
    else if (a === "startmatch") startMatch();
    else if (a === "deploy") deploy();
    else if (a === "back") menu.show(menu.screenBefore === "modeselect" ? "title" : (menu.screenBefore || "title"));
    else if (a === "settings") menu.show("settings");
    else if (a === "credits") menu.show("credits");
  });

  window.addEventListener("keydown", (e) => {
    if (e.code !== "Escape") return;
    if (isMissionLive(ctx)) return;                            // pause.js owns ESC in-play
    if (shell.settingsUI && shell.settingsUI.visible) return;  // settings' handler consumes
    if (scoreboard.endOpen) return;                            // end board owns its exits
    if (root.style.display === "none" || !menu._screen) return;
    if (menu._screen !== "title") menu.show(menu.screenBefore === "modeselect" ? "title" : (menu.screenBefore || "title"));
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
      if (screen === "modeselect") {
        // late-landing mode lanes (W8/W9) light up without a reload
        for (const id of MODE_IDS) {
          if (typeof MODES[id] !== "function") {
            modeProbe[id] = undefined;
            ensureModeRegistered(id).then((ok) => {
              if (ok && menu._screen === "modeselect") render("modeselect");
            });
          }
        }
      }
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
