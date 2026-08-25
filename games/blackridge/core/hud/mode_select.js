// core/hud/mode_select.js [W6] — the mode-select surface (PVP_BUILD_PLAN
// Part 4.1 row W6; modes.md §6.1–6.2; owner amendment A1).
//
// Renders the three mode cards (SKIRMISH / CAPTURE THE FLAG / FREE-FOR-ALL),
// the difficulty row (CASUAL / STANDARD / HARD, default STANDARD — C11), the
// per-mode rules card (numbers read from content.modes so the card can never
// drift from what the driver enforces — R9), local W/L/D stats (modes.md
// §6.5), and START MATCH.
//
// Availability is read from the LIVE mode registry (core/match/match.js
// MODES — the bare-specifier instance, which is the one sim.js's makeMatch
// actually consults). A mode whose lane has not landed shows COMING ONLINE
// with its start disabled — the selection surface ships now (A1), the mode
// lights up the moment its module registers.
//
// This file owns only the panel CONTENT; menu.js owns the screen shell, the
// nav rail and the transition into ctx.startMatch.

import { MODES } from "../match/match.js";
import { loadStats } from "./scoreboard.js";

const esc = (s) => String(s).replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function fmtMin(s) {
  const m = Math.round((s || 0) / 60);
  return `${m} MINUTE${m === 1 ? "" : "S"}`;
}

// C12 driver defaults — used only when content.modes is missing a field, so
// the card text always has a number to show.
const FALLBACK_RULES = {
  tdm: { displayName: "SKIRMISH", scoreLimit: 50, timeLimitS: 480, respawnS: 4 },
  ctf: { displayName: "CAPTURE THE FLAG", captureLimit: 3, timeLimitS: 720, respawnS: 5 },
  ffa: { displayName: "FREE-FOR-ALL", scoreLimit: 25, timeLimitS: 480, respawnS: 3 },
};

const PITCH = {
  tdm: "5 v 5 · first team to the kill limit",
  ctf: "5 v 5 · take theirs, get it home",
  ffa: "10 players · everyone is hostile",
};

const DIFFICULTIES = ["casual", "standard", "hard"];

let styleDone = false;
function ensureCardStyle() {
  if (styleDone || typeof document === "undefined") return;
  styleDone = true;
  if (document.getElementById("w6-cards-style")) return;
  const el = document.createElement("style");
  el.id = "w6-cards-style";
  el.textContent = `
.w6-cards{display:flex;flex-wrap:wrap;gap:14px;margin:6px 0 18px;}
.w6-card{flex:1 1 0;border:1px solid rgba(232,232,228,.18);padding:14px 16px;
  cursor:pointer;transition:border-color .15s ease;min-width:150px;}
.w6-card:hover{border-color:rgba(232,232,228,.45);}
.w6-card.on{border-color:var(--a10-amber,#d9a441);}
.w6-card.offline{opacity:.45;cursor:default;}
.w6-card .nm{font-family:var(--a10-hud-font,system-ui);font-size:15px;
  letter-spacing:.18em;margin-bottom:6px;}
.w6-card .pt{font-size:10.5px;letter-spacing:.1em;opacity:.6;line-height:1.5;}
.w6-card .off{font-size:9.5px;letter-spacing:.24em;color:var(--a10-amber,#d9a441);
  margin-top:8px;}
.w6-rules{font-size:11.5px;letter-spacing:.06em;line-height:1.9;opacity:.8;
  border-left:2px solid var(--a10-amber,#d9a441);padding-left:14px;margin:0 0 18px;}
.w6-diff{display:flex;gap:10px;margin:0 0 6px;}
.w6-diff button{background:none;border:1px solid rgba(232,232,228,.22);
  color:rgba(232,232,228,.7);font-family:inherit;font-size:10.5px;
  letter-spacing:.22em;padding:6px 14px;cursor:pointer;text-transform:uppercase;}
.w6-diff button.on{border-color:var(--a10-amber,#d9a441);color:var(--a10-amber,#d9a441);}
.w6-stats{font-size:10px;letter-spacing:.18em;opacity:.45;margin:10px 0 0;}
.w6-err{display:none;color:var(--a10-red,#ff4d4d);font-size:12px;
  letter-spacing:.08em;margin-top:12px;}
`;
  document.head.appendChild(el);
}

export function createModeSelect(ctx, cb) {
  ensureCardStyle();

  const state = {
    mode: "tdm",
    difficulty: "standard",
    panel: null,
  };

  function contentRules(id) {
    const c = ctx.content && ctx.content.modes && ctx.content.modes[id];
    return Object.assign({}, FALLBACK_RULES[id], c || {});
  }

  function available(id) {
    return typeof MODES[id] === "function";
  }

  function rulesLines(id) {
    const r = contentRules(id);
    if (id === "tdm") return [
      `First team to ${r.scoreLimit} kills wins · ${fmtMin(r.timeLimitS)}`,
      `Respawn in ${r.respawnS}s · no friendly fire`,
      `Tie → overtime: no respawns, first death loses it for their team`,
    ];
    if (id === "ctf") return [
      `First team to ${r.captureLimit} captures wins · ${fmtMin(r.timeLimitS)}`,
      `Your own flag must be at your stand to score`,
      `Carriers: no tac-sprint, no grenades, no regen · 8s carry reveals you`,
      `A dropped flag returns in 30s — instantly if a defender touches it`,
    ];
    return [
      `First to ${r.scoreLimit} kills wins · ${fmtMin(r.timeLimitS)} · everyone is hostile`,
      `Respawn in ${r.respawnS}s`,
      `Reach 15 kills or a 5-kill lead and everyone can see you`,
    ];
  }

  function statsLine(id) {
    const s = loadStats();
    const r = s.modes && s.modes[id];
    if (!r || !r.matches) return "NO MATCHES YET";
    return `PLAYED ${r.matches} · W ${r.w} / L ${r.l} / D ${r.d}` +
      (r.bestStreak ? ` · BEST STREAK ${r.bestStreak}` : "");
  }

  function render(panel) {
    state.panel = panel || state.panel;
    if (!state.panel) return;
    const cards = ["tdm", "ctf", "ffa"].map((id) => {
      const r = contentRules(id);
      const on = state.mode === id;
      const ok = available(id);
      return `<div class="w6-card${on ? " on" : ""}${ok ? "" : " offline"}" data-mode="${id}">` +
        `<div class="nm">${esc(r.displayName || id.toUpperCase())}</div>` +
        `<div class="pt">${esc(PITCH[id] || "")}</div>` +
        (ok ? "" : `<div class="off">COMING ONLINE</div>`) +
        `</div>`;
    }).join("");

    const diff = DIFFICULTIES.map((d) =>
      `<button data-diff="${d}" class="${state.difficulty === d ? "on" : ""}">${d}</button>`).join("");

    state.panel.innerHTML =
      `<h2>Mode select</h2>` +
      `<div class="body">` +
      `<div class="w6-cards">${cards}</div>` +
      `<div class="w6-rules">${rulesLines(state.mode).map(esc).join("<br>")}</div>` +
      `<div style="font-size:10px;letter-spacing:.24em;opacity:.5;margin-bottom:6px">DIFFICULTY</div>` +
      `<div class="w6-diff">${diff}</div>` +
      `<div class="w6-stats">${esc(statsLine(state.mode))}</div>` +
      `<div class="w6-err"></div>` +
      `</div>`;

    state.panel.querySelectorAll(".w6-card").forEach((c) => {
      c.addEventListener("click", () => {
        state.mode = c.getAttribute("data-mode");
        render();
        if (cb && cb.onSelectionChange) cb.onSelectionChange(state.mode, available(state.mode));
      });
    });
    state.panel.querySelectorAll(".w6-diff button").forEach((b) => {
      b.addEventListener("click", () => {
        state.difficulty = b.getAttribute("data-diff");
        render();
      });
    });
  }

  return {
    render,
    available,
    showError(msg) {
      const e = state.panel && state.panel.querySelector(".w6-err");
      if (e) { e.style.display = "block"; e.textContent = msg; }
    },
    get mode() { return state.mode; },
    set mode(id) { if (FALLBACK_RULES[id]) state.mode = id; },
    get difficulty() { return state.difficulty; },
    displayName(id) { return contentRules(id).displayName || id.toUpperCase(); },
  };
}
