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

// ITER11 LANE E. The owner asked for aiming that is "easy to adjust". A bare
// "×1.00" is not adjustable, it is a guess — so every aim row prints what the
// number BUYS: mouse pixels for a full 360° turn (the genre's cm/360 without
// needing to know the mouse's DPI), and for ADS the effective multiplier the
// player will actually feel once zoom-proportional scaling is folded in.
// Read off the LIVE input instance (input.pxPer360AtSens1), never imported:
// boot loads modules with a `?v=N` query, so a bare import of ../input.js here
// would instantiate a second copy of that module and of the weapon table it
// pulls in. Set once when the panel is created; the fallback is input.js's own
// 2*PI/LOOK_SCALE and is only reached if ctx has no input (tests).
let PX360_AT_1 = (2 * Math.PI) / 0.0022;
const px360 = (sens) => Math.round(PX360_AT_1 / Math.max(1e-6, sens));

const ROWS = [
  { key: "quality", label: "Quality", kind: "seg", options: ["low", "med", "high"] },
  { key: "fov", label: "Field of view", kind: "range", min: 60, max: 90, step: 1, fmt: (v) => `${Math.round(v)}°` }, // R9 vertical
  { key: "sens", label: "Mouse sensitivity", kind: "range", min: 0.05, max: 5.0, step: 0.01,
    fmt: (v) => "×" + Number(v).toFixed(2),
    hint: (v) => `${px360(v)} mouse px per 360° turn` },
  { key: "adsSens", label: "ADS sensitivity", kind: "range", min: 0.2, max: 2.0, step: 0.01,
    fmt: (v) => "×" + Number(v).toFixed(2),
    // 1.00 = combat_spec §2.4 zoom-proportional (aim sweeps the same number of
    // SCREEN pixels down the sights as it does at the hip) — the default.
    hint: (v) => Math.abs(v - 1) < 0.005
      ? "zoom-matched — sights feel like the hip"
      : (v < 1 ? "slower down the sights" : "faster down the sights") },
  { key: "renderScale", label: "Render scale", kind: "range", min: 0.6, max: 1.0, step: 0.05,
    fmt: (v) => Math.round(v * 100) + "%",
    // The smoothness lever, and the only one with the needed magnitude on
    // integrated graphics (dynres.js header: cost(s) = 0.10 + 0.90·s²).
    // 1.00 is native and is the default — nothing softens on its own.
    hint: (v) => v >= 0.999 ? "native — sharpest" : "upscaled — smoother aim, softer image" },
  { key: "bob", label: "Head bob", kind: "range", min: 0, max: 1, step: 0.05, fmt: PCT },
  { key: "music", label: "Music volume", kind: "range", min: 0, max: 1, step: 0.05, fmt: PCT },
  { key: "sfx", label: "SFX volume", kind: "range", min: 0, max: 1, step: 0.05, fmt: PCT },
  { key: "ambience", label: "Ambience volume", kind: "range", min: 0, max: 1, step: 0.05, fmt: PCT },
  // ---- lane PAD (2026-11): look options shared by every device, then the
  // controller block, then keyboard rebinding. Ranges transcribe settings.js.
  { kind: "section", label: "Look & aim assist" },
  { key: "invertY", label: "Invert look Y", kind: "seg", options: ["off", "on"] },
  { key: "aimAssist", label: "Aim assist", kind: "seg", options: ["off", "standard", "focused"],
    hint: (v) => v === "off" ? "no assistance" : v === "focused"
      ? "stronger slowdown + tracking · controller & touch only"
      : "slowdown near targets + light tracking · controller & touch only" },
  { kind: "section", label: "Controller" },
  { key: "padSensX", label: "Look sensitivity · horizontal", kind: "range", min: 0.2, max: 3.0, step: 0.05,
    fmt: (v) => "×" + Number(v).toFixed(2), hint: (v) => `${Math.round(195 * v)}° per second at full push` },
  { key: "padSensY", label: "Look sensitivity · vertical", kind: "range", min: 0.2, max: 3.0, step: 0.05,
    fmt: (v) => "×" + Number(v).toFixed(2), hint: (v) => `${Math.round(137 * v)}° per second at full push` },
  { key: "padAdsSens", label: "ADS sensitivity · controller", kind: "range", min: 0.2, max: 2.0, step: 0.01,
    fmt: (v) => "×" + Number(v).toFixed(2),
    hint: (v) => Math.abs(v - 1) < 0.005 ? "zoom-matched" : (v < 1 ? "slower down the sights" : "faster down the sights") },
  { key: "padCurve", label: "Response curve", kind: "seg", options: ["linear", "standard", "dynamic"],
    hint: (v) => v === "linear" ? "stick travel = turn speed" : v === "dynamic"
      ? "finest near centre, full speed at the rim" : "precise near centre (recommended)" },
  { key: "padAccel", label: "Look acceleration", kind: "range", min: 0, max: 1, step: 0.05, fmt: PCT,
    hint: (v) => v <= 0 ? "off" : `up to +${Math.round(80 * v)}% turn speed when held at full push` },
  { key: "padDeadL", label: "Dead zone · left stick", kind: "range", min: 0, max: 0.4, step: 0.01, fmt: PCT,
    hint: () => "raise if you drift while not touching the stick" },
  { key: "padDeadR", label: "Dead zone · right stick", kind: "range", min: 0, max: 0.4, step: 0.01, fmt: PCT,
    hint: () => "raise if the view creeps on its own" },
  { key: "padTrigger", label: "Trigger threshold", kind: "range", min: 0.05, max: 0.9, step: 0.05, fmt: PCT,
    hint: (v) => v <= 0.15 ? "hair trigger" : "how far to pull before fire / aim" },
  { key: "padSprint", label: "Sprint", kind: "seg", options: ["l3", "auto"],
    hint: (v) => v === "auto" ? "sprints at full forward push" : "click left stick; stopping or aiming ends it" },
  { key: "padCrouch", label: "Crouch button", kind: "seg", options: ["toggle", "hold"] },
  { key: "padRumble", label: "Vibration", kind: "seg", options: ["on", "off"],
    hint: () => "on fire, hits and explosions" },
  { kind: "padmap", label: "Controller layout" },
  { kind: "section", label: "Keyboard" },
  { kind: "binds", label: "Key bindings" },
];

export function createSettingsUI(ctx) {
  ensureShellStyle();
  if (ctx.input && ctx.input.pxPer360AtSens1 > 0) PX360_AT_1 = ctx.input.pxPer360AtSens1;

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
  const hintSpan = (key) => `<span class="hint" data-h="${key}" style="font-size:10.5px;letter-spacing:.08em;` +
    `text-transform:none;color:rgba(232,232,228,.36)"></span>`;
  for (const r of ROWS) {
    if (r.kind === "section") {
      html += `<h2 style="margin:26px 0 6px">${r.label}</h2>`;
    } else if (r.kind === "padmap") {
      html += `<div class="a10-row" style="align-items:flex-start"><span class="lbl">${r.label}</span>` +
        `<span data-padmap style="font-size:11px;letter-spacing:.06em;line-height:1.65;text-align:right;` +
        `color:rgba(232,232,228,.62);text-transform:none"></span></div>`;
    } else if (r.kind === "binds") {
      const acts = (ctx.input && ctx.input.keyActions) || [];
      html += acts.map(([a, , lbl]) =>
        `<div class="a10-row"><span class="lbl">${lbl}</span>` +
        `<span class="a10-seg"><button data-bind="${a}" style="min-width:92px"></button></span></div>`).join("");
      if (acts.length) {
        html += `<div class="a10-row"><span class="lbl">${r.label}</span>` +
          `<span class="a10-seg"><button data-bindreset="1">reset to default</button></span></div>`;
      }
    } else if (r.kind === "seg") {
      const lbl = r.hint
        ? `<span style="display:flex;flex-direction:column;gap:4px"><span class="lbl">${r.label}</span>${hintSpan(r.key)}</span>`
        : `<span class="lbl">${r.label}</span>`;
      html +=
        `<div class="a10-row">${lbl}` +
        `<span class="a10-seg" data-k="${r.key}">` +
        r.options.map((o) => `<button data-o="${o}">${o}</button>`).join("") +
        `</span></div>`;
    } else {
      // `hint` rows carry a second, quieter line under the label saying what
      // the number buys (LANE E "easy to adjust"). Inline styles only — the
      // shared .a10-* sheet lives in hud.js and is not this lane's file.
      const lbl = r.hint
        ? `<span style="display:flex;flex-direction:column;gap:4px">` +
          `<span class="lbl">${r.label}</span>` +
          `<span class="hint" data-h="${r.key}" style="font-size:10.5px;letter-spacing:.08em;` +
          `text-transform:none;color:rgba(232,232,228,.36)"></span></span>`
        : `<span class="lbl">${r.label}</span>`;
      html +=
        `<div class="a10-row">${lbl}` +
        `<span style="display:flex;align-items:center;gap:14px;flex:0 0 auto">` +
        `<input type="range" data-k="${r.key}" min="${r.min}" max="${r.max}" step="${r.step}"/>` +
        `<span class="val" data-v="${r.key}"></span></span></div>`;
    }
  }
  panel.innerHTML = html;
  root.appendChild(panel);
  document.body.appendChild(root);

  const VALUE_ROWS = ROWS.filter((r) => r.key);
  for (const r of VALUE_ROWS) {
    if (r.kind === "seg") {
      refs[r.key] = { btns: Array.from(panel.querySelectorAll(`.a10-seg[data-k="${r.key}"] button`)),
        hintEl: panel.querySelector(`.hint[data-h="${r.key}"]`) };
    } else {
      refs[r.key] = {
        inputEl: panel.querySelector(`input[data-k="${r.key}"]`),
        valEl: panel.querySelector(`.val[data-v="${r.key}"]`),
        hintEl: panel.querySelector(`.hint[data-h="${r.key}"]`),
      };
    }
  }

  // ------------------------------------------------------------------ sync
  function syncRow(r) {
    const v = ctx.settings[r.key];
    const ref = refs[r.key];
    if (r.kind === "seg") {
      for (const b of ref.btns) b.classList.toggle("on", b.getAttribute("data-o") === v);
      if (ref.hintEl && r.hint) ref.hintEl.textContent = r.hint(v);
    } else {
      // Don't fight the user's drag: only push when materially different.
      if (Math.abs(Number(ref.inputEl.value) - v) > (r.step || 0.01) / 2) ref.inputEl.value = v;
      ref.valEl.textContent = r.fmt(v);
      if (ref.hintEl && r.hint) ref.hintEl.textContent = r.hint(v);
    }
  }
  // lane PAD: key-binding buttons + the controller map (glyphs follow the
  // connected pad's layout — Xbox or PlayStation wording).
  const bindBtns = Array.from(panel.querySelectorAll("button[data-bind]"));
  const padMapEl = panel.querySelector("[data-padmap]");
  let capturing = null;
  function syncBinds() {
    const inp = ctx.input;
    if (!inp || !inp.getBind) return;
    for (const b of bindBtns) {
      const a = b.getAttribute("data-bind");
      b.textContent = capturing === a ? "press a key…" : inp.keyLabel(inp.getBind(a));
      b.classList.toggle("on", capturing === a);
    }
  }
  const PAD_ROWS = [["fire", "fire"], ["ads", "aim down sights"], ["jump", "jump"], ["crouch", "crouch · slide"],
    ["reload", "reload (hold: interact)"], ["swap", "swap weapon"], ["grenade", "lethal (hold to cook)"],
    ["tactical", "tactical"],
    ["sprint", "sprint"], ["streak", "call-ins (↓ sweep · ↑ mortar · → airstrike · ← orbital)"], ["inspect", "inspect"],
    ["score", "scoreboard"], ["pause", "pause"]];
  function syncPadMap() {
    const inp = ctx.input;
    if (!padMapEl || !inp || !inp.padGlyph) return;
    padMapEl.innerHTML =
      (inp.padConnected ? "" : `<span style="opacity:.6">no controller detected — connect one and press any button</span><br>`) +
      PAD_ROWS.map(([v, t]) => `<b style="color:#e8e8e4;font-weight:400">${inp.padGlyph(v)}</b> ${t}`).join("<br>") +
      "";
  }
  function syncAll() { for (const r of VALUE_ROWS) syncRow(r); syncBinds(); syncPadMap(); }
  window.addEventListener("br:inputdevice", () => { if (visible) syncPadMap(); });

  // Mirror external writes (quality presets from code, harness set()s, …).
  for (const r of VALUE_ROWS) ctx.onChange(r.key, () => syncRow(r));

  // ------------------------------------------------------------------ input
  panel.addEventListener("input", (e) => {
    const k = e.target && e.target.getAttribute && e.target.getAttribute("data-k");
    if (!k) return;
    ctx.setSetting(k, Number(e.target.value));
  });

  panel.addEventListener("click", (e) => {
    const t = e.target;
    if (!t || !t.getAttribute) return;
    const bindA = t.getAttribute("data-bind");
    if (bindA && ctx.input && ctx.input.captureNextKey) {
      capturing = bindA; syncBinds();
      ctx.input.captureNextKey((code) => {
        if (code) ctx.input.rebind(bindA, code);
        capturing = null; syncBinds();
      });
      return;
    }
    if (t.getAttribute("data-bindreset") && ctx.input && ctx.input.resetBinds) { ctx.input.resetBinds(); syncBinds(); return; }
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
