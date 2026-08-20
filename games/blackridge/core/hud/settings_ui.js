// core/hud/settings_ui.js [A10] — quality / FOV / sensitivity / bob / volume
// panel. Clean rows with hairline dividers (VT §6), writes through
// ctx.setSetting (core/settings.js set() — clamped + persisted) and mirrors
// external changes via ctx.onChange so the displayed value can never lie.
//
// R9: FOV is VERTICAL degrees, player range 60–90 (settings.js SCHEMA is the
// single clamp authority; the rows below transcribe its ranges).
//
// One shared overlay serves BOTH hosts: opened from the menu ('settings'
// screen → cb.onSettings → show()) and from the pause rail (shell.pause).
// Back/ESC default: pause overlay beneath → just close; menu context →
// return to menu.screenBefore. ESC ordering across the lane: pause and menu
// handlers skip while this overlay is visible; this module's handler
// (registered last — boot creates settingsUI after pause and menu) consumes
// the press. One press = one action.
//
// Frozen signature: createSettingsUI(ctx) → panel {show, hide (+back,
// visible)}.

import { shell, isMissionLive, ensureShellStyle } from "./hud.js";

const PCT = (v) => Math.round(v * 100) + "%";

const ROWS = [
  { key: "quality", label: "Quality", kind: "seg", options: ["low", "med", "high"] },
  { key: "fov", label: "Field of view", kind: "range", min: 60, max: 90, step: 1, fmt: (v) => `${Math.round(v)}°` }, // R9 vertical
  { key: "sens", label: "Mouse sensitivity", kind: "range", min: 0.2, max: 3.0, step: 0.05, fmt: (v) => "×" + Number(v).toFixed(2) },
  { key: "bob", label: "Head bob", kind: "range", min: 0, max: 1, step: 0.05, fmt: PCT },
  { key: "music", label: "Music volume", kind: "range", min: 0, max: 1, step: 0.05, fmt: PCT },
  { key: "sfx", label: "SFX volume", kind: "range", min: 0, max: 1, step: 0.05, fmt: PCT },
  { key: "ambience", label: "Ambience volume", kind: "range", min: 0, max: 1, step: 0.05, fmt: PCT },
];

export function createSettingsUI(ctx) {
  ensureShellStyle();

  let visible = false;
  let onBack = null;

  // ------------------------------------------------------------------ DOM
  const root = document.createElement("div");
  root.id = "settings-overlay";
  root.className = "a10-overlay";
  root.style.display = "none";
  root.style.zIndex = "60"; // above menu (50) and pause (40)

  const wash = document.createElement("div");
  wash.className = "wash";
  root.appendChild(wash);

  const rail = document.createElement("div");
  rail.className = "a10-rail";
  rail.innerHTML =
    `<div class="tag">options</div>` +
    `<div class="wm">SETTINGS</div>` +
    `<button class="a10-item" data-a="back">Back</button>`;
  root.appendChild(rail);

  const panel = document.createElement("div");
  panel.className = "a10-panel";
  const refs = {}; // key → {valEl, inputEl|btns}
  let html = "";
  for (const r of ROWS) {
    if (r.kind === "seg") {
      html +=
        `<div class="a10-row"><span class="lbl">${r.label}</span>` +
        `<span class="a10-seg" data-k="${r.key}">` +
        r.options.map((o) => `<button data-o="${o}">${o}</button>`).join("") +
        `</span></div>`;
    } else {
      html +=
        `<div class="a10-row"><span class="lbl">${r.label}</span>` +
        `<span style="display:flex;align-items:center;gap:14px">` +
        `<input type="range" data-k="${r.key}" min="${r.min}" max="${r.max}" step="${r.step}"/>` +
        `<span class="val" data-v="${r.key}"></span></span></div>`;
    }
  }
  panel.innerHTML = html;
  root.appendChild(panel);
  document.body.appendChild(root);

  for (const r of ROWS) {
    if (r.kind === "seg") {
      refs[r.key] = { btns: Array.from(panel.querySelectorAll(`.a10-seg[data-k="${r.key}"] button`)) };
    } else {
      refs[r.key] = {
        inputEl: panel.querySelector(`input[data-k="${r.key}"]`),
        valEl: panel.querySelector(`.val[data-v="${r.key}"]`),
      };
    }
  }

  // ------------------------------------------------------------------ sync
  function syncRow(r) {
    const v = ctx.settings[r.key];
    const ref = refs[r.key];
    if (r.kind === "seg") {
      for (const b of ref.btns) b.classList.toggle("on", b.getAttribute("data-o") === v);
    } else {
      // Don't fight the user's drag: only push when materially different.
      if (Math.abs(Number(ref.inputEl.value) - v) > (r.step || 0.01) / 2) ref.inputEl.value = v;
      ref.valEl.textContent = r.fmt(v);
    }
  }
  function syncAll() { for (const r of ROWS) syncRow(r); }

  // Mirror external writes (quality presets from code, harness set()s, …).
  for (const r of ROWS) ctx.onChange(r.key, () => syncRow(r));

  // ------------------------------------------------------------------ input
  panel.addEventListener("input", (e) => {
    const k = e.target && e.target.getAttribute && e.target.getAttribute("data-k");
    if (!k) return;
    ctx.setSetting(k, Number(e.target.value));
  });

  panel.addEventListener("click", (e) => {
    const t = e.target;
    if (!t || !t.getAttribute) return;
    const o = t.getAttribute("data-o");
    if (o == null) return;
    const seg = t.closest(".a10-seg");
    if (seg) ctx.setSetting(seg.getAttribute("data-k"), o);
  });

  rail.addEventListener("click", (e) => {
    const a = e.target && e.target.getAttribute && e.target.getAttribute("data-a");
    if (a === "back") api.back();
  });

  window.addEventListener("keydown", (e) => {
    if (e.code !== "Escape" || !visible) return;
    api.back();
  });

  // ------------------------------------------------------------------ api
  const api = {
    show(opts = {}) {
      onBack = typeof opts.onBack === "function" ? opts.onBack : null;
      visible = true;
      syncAll();
      root.style.display = "block";
    },
    hide() {
      visible = false;
      root.style.display = "none";
    },
    back() {
      const f = onBack;
      api.hide();
      if (f) { f(); return; }
      // Default hosts: pause overlay is still beneath (nothing to do);
      // menu context returns to the screen the player came from.
      if (shell.pause && shell.pause.active) return;
      if (!isMissionLive(ctx) && shell.menu) {
        shell.menu.show(shell.menu.screenBefore || "title");
      }
    },
    get visible() { return visible; },
  };

  shell.settingsUI = api;
  return api;
}
