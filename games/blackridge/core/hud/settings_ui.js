// core/hud/settings_ui.js [A10] — the settings overlay.
// Writes through ctx.setSetting (core/settings.js set() — clamped + persisted)
// and mirrors external changes via ctx.onChange so the displayed value can
// never lie.
//
// [lane settings, 2026-11] SIX TABS — Controls · Controller · Graphics · Audio ·
// Interface · Accessibility — reorganising every entry the old single list had
// (nothing dropped: quality, FOV, sens, ADS sens, render scale, head bob, three
// volumes, invert Y, aim assist, the controller block, the pad layout map and
// the 12 key bindings) plus this lane's additions. Each tab has its own "Reset
// tab to defaults"; a description line under the rows explains whichever
// option is hovered / focused (mouse, keyboard focus or the gamepad ring);
// LB / RB (L1 / R1) switch tabs on a controller; the tab strip is a plain
// button row, so touch and the pad's spatial nav both reach it. Export /
// Import copies the whole set (and key bindings) as a short text string.
//
// Also owned here because they are settings plumbing with no better home in
// this lane's file list:
//  - the FPS / frame-time counter overlay (settings.fpsCounter),
//  - keyboard HOLD vs TOGGLE for aim / crouch / sprint (settings.kbAds /
//    kbCrouch / kbSprint): an adapter that listens AFTER input.js's own
//    handlers and re-asserts input.state, so input.js itself is untouched
//    (the clean home for it is input.js — reported),
//  - CSS-level honouring of two settings whose DOM belongs to other lanes:
//    score-popup / XP feed visibility (#ld-score, #br-xpfeed) and the flash
//    grenade whiteout strength (#eq-flash) — style overrides only.
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
const MUL = (v) => "×" + Number(v).toFixed(2);

// ITER11 LANE E: every aim row prints what the number BUYS. Read off the LIVE
// input instance (input.pxPer360AtSens1), never imported (?v=N dual-instance).
let PX360_AT_1 = (2 * Math.PI) / 0.0022;
const px360 = (sens) => Math.round(PX360_AT_1 / Math.max(1e-6, sens));

// The settings.js live handle (presetState / resetKeys / setMany / export).
const live = () => globalThis.__BR_SETTINGS__ || null;

export const TABS = [
  ["controls", "Controls"], ["controller", "Controller"], ["graphics", "Graphics"],
  ["audio", "Audio"], ["interface", "Interface"], ["access", "Accessibility"],
];

// Row: {tab, key?, label, kind, options|min/max/step, fmt?, hint?, desc}
// `desc` = the one-line explanation shown for the focused option.
const ROWS = [
  // ------------------------------------------------------------- CONTROLS
  { tab: "controls", key: "sens", label: "Mouse sensitivity", kind: "range", min: 0.05, max: 5.0, step: 0.01, fmt: MUL,
    hint: (v) => `${px360(v)} mouse px per 360° turn`,
    desc: "How far the view turns per mouse movement. The line under it is the mouse travel for one full turn." },
  { tab: "controls", key: "adsSens", label: "ADS sensitivity", kind: "range", min: 0.2, max: 2.0, step: 0.01, fmt: MUL,
    hint: (v) => Math.abs(v - 1) < 0.005 ? "zoom-matched — sights feel like the hip"
      : (v < 1 ? "slower down the sights" : "faster down the sights"),
    desc: "Multiplier while aiming down sights. 1.00 keeps the same on-screen speed as the hip." },
  { tab: "controls", key: "invertY", label: "Invert look Y", kind: "seg", options: ["off", "on"],
    desc: "Flip vertical look: pushing up looks down. Applies to mouse, stick and touch." },
  { tab: "controls", kind: "section", label: "Key bindings" },
  { tab: "controls", kind: "binds", label: "Key bindings",
    desc: "Click a key, then press the new key. Esc cancels. Digits, Esc and Tab stay fixed." },

  // ----------------------------------------------------------- CONTROLLER
  { tab: "controller", key: "aimAssist", label: "Aim assist", kind: "seg", options: ["off", "standard", "focused"],
    hint: (v) => v === "off" ? "no assistance" : v === "focused"
      ? "stronger slowdown + tracking · controller & touch only"
      : "slowdown near targets + light tracking · controller & touch only",
    desc: "Slows the view over a target and follows it a little. Controller and touch only, never the mouse." },
  { tab: "controller", key: "padSensX", label: "Look sensitivity · horizontal", kind: "range", min: 0.2, max: 3.0, step: 0.05,
    fmt: MUL, hint: (v) => `${Math.round(195 * v)}° per second at full push`, desc: "Horizontal turn speed with the right stick fully pushed." },
  { tab: "controller", key: "padSensY", label: "Look sensitivity · vertical", kind: "range", min: 0.2, max: 3.0, step: 0.05,
    fmt: MUL, hint: (v) => `${Math.round(137 * v)}° per second at full push`, desc: "Vertical turn speed with the right stick fully pushed." },
  { tab: "controller", key: "padAdsSens", label: "ADS sensitivity · controller", kind: "range", min: 0.2, max: 2.0, step: 0.01,
    fmt: MUL, hint: (v) => Math.abs(v - 1) < 0.005 ? "zoom-matched" : (v < 1 ? "slower down the sights" : "faster down the sights"),
    desc: "Stick multiplier while aiming down sights." },
  { tab: "controller", key: "padCurve", label: "Response curve", kind: "seg", options: ["linear", "standard", "dynamic"],
    hint: (v) => v === "linear" ? "stick travel = turn speed" : v === "dynamic"
      ? "finest near centre, full speed at the rim" : "precise near centre (recommended)",
    desc: "How stick travel maps to turn speed." },
  { tab: "controller", key: "padAccel", label: "Look acceleration", kind: "range", min: 0, max: 1, step: 0.05, fmt: PCT,
    hint: (v) => v <= 0 ? "off" : `up to +${Math.round(80 * v)}% turn speed when held at full push`,
    desc: "Extra turn speed that builds while the stick is held at the rim." },
  { tab: "controller", key: "padDeadL", label: "Dead zone · left stick", kind: "range", min: 0, max: 0.4, step: 0.01, fmt: PCT,
    hint: () => "raise if you drift while not touching the stick", desc: "Stick travel ignored around the centre of the move stick." },
  { tab: "controller", key: "padDeadR", label: "Dead zone · right stick", kind: "range", min: 0, max: 0.4, step: 0.01, fmt: PCT,
    hint: () => "raise if the view creeps on its own", desc: "Stick travel ignored around the centre of the look stick." },
  { tab: "controller", key: "padTrigger", label: "Trigger threshold", kind: "range", min: 0.05, max: 0.9, step: 0.05, fmt: PCT,
    hint: (v) => v <= 0.15 ? "hair trigger" : "how far to pull before fire / aim", desc: "How far a trigger must be pulled to fire or aim." },
  { tab: "controller", key: "padSprint", label: "Sprint", kind: "seg", options: ["l3", "auto"],
    hint: (v) => v === "auto" ? "sprints at full forward push" : "click left stick; stopping or aiming ends it",
    desc: "Click the stick to sprint, or sprint automatically at full forward push." },
  { tab: "controller", key: "padCrouch", label: "Crouch button", kind: "seg", options: ["toggle", "hold"],
    desc: "Toggle: press once to crouch, again to stand. Hold: crouch while held." },
  { tab: "controller", key: "padRumble", label: "Vibration", kind: "seg", options: ["on", "off"],
    hint: () => "on fire, hits and explosions", desc: "Controller rumble on firing, being hit and explosions." },
  { tab: "controller", kind: "padmap", label: "Controller layout", desc: "Button layout for the connected controller." },

  // ------------------------------------------------------------- GRAPHICS
  { tab: "graphics", key: "quality", label: "Quality preset", kind: "preset", options: ["low", "med", "high"],
    desc: "Sets the effect toggles below in one go. Changing any of them shows CUSTOM." },
  { tab: "graphics", key: "fov", label: "Field of view", kind: "range", min: 60, max: 90, step: 1, fmt: (v) => `${Math.round(v)}°`,
    desc: "Vertical field of view of the world camera, in degrees." },
  { tab: "graphics", key: "vmFovAdj", label: "Weapon field of view", kind: "range", min: -10, max: 15, step: 1,
    fmt: (v) => v === 0 ? "default" : (v > 0 ? "+" : "") + v + "°",
    desc: "Widens or narrows the camera that draws your weapon and hands. Higher shows less of the gun." },
  { tab: "graphics", key: "renderScale", label: "Render scale", kind: "range", min: 0.6, max: 1.0, step: 0.05,
    fmt: (v) => Math.round(v * 100) + "%",
    hint: (v) => v >= 0.999 ? "native — sharpest" : "upscaled — smoother aim, softer image",
    desc: "Resolution the 3D scene is drawn at. With dynamic resolution on, this is the maximum." },
  { tab: "graphics", key: "dynRes", label: "Dynamic resolution", kind: "seg", options: ["off", "on"],
    hint: (v) => v === "on" ? "drops as low as 60% to hold the target" : "fixed at the render scale",
    desc: "Automatically lowers the render scale under load to hold the target frame rate." },
  { tab: "graphics", key: "dynResTarget", label: "Dynamic resolution target", kind: "seg", options: ["30", "60", "120"],
    fmt: (o) => o + " fps", desc: "Frame rate the dynamic resolution tries to hold." },
  { tab: "graphics", key: "fpsCap", label: "Frame rate limit", kind: "seg", options: ["30", "60", "120", "uncapped"],
    desc: "Caps how often a frame is drawn. Lower caps save power and heat." },
  { tab: "graphics", key: "fpsCounter", label: "Performance counter", kind: "seg", options: ["off", "fps", "full"],
    desc: "Shows frames per second (and frame time, resolution and draw calls on FULL) in the top-right corner." },
  { tab: "graphics", kind: "section", label: "Effects" },
  { tab: "graphics", key: "shadows", label: "Shadows", kind: "seg", options: ["off", "low", "high"],
    desc: "Moonlight shadow quality. Low halves the shadow map; off removes cast shadows." },
  { tab: "graphics", key: "bloom", label: "Bloom", kind: "seg", options: ["on", "off"],
    desc: "Glow around lamps, neon, muzzle flashes and tracers." },
  { tab: "graphics", key: "lampAtmos", label: "Lamp atmosphere", kind: "seg", options: ["on", "off"],
    desc: "Light shafts and fog glow under street lamps." },
  { tab: "graphics", key: "rainDensity", label: "Rain density", kind: "range", min: 0, max: 1, step: 0.05, fmt: PCT,
    desc: "Amount of rain streaks and splashes, relative to the preset." },
  { tab: "graphics", key: "grain", label: "Film grain", kind: "seg", options: ["on", "off"], desc: "Fine animated film noise." },
  { tab: "graphics", key: "vignette", label: "Vignette", kind: "seg", options: ["on", "off"],
    desc: "Darkened screen edges. Low-health and suppression darkening stay on — they carry information." },
  { tab: "graphics", key: "chromAb", label: "Chromatic aberration", kind: "seg", options: ["on", "off"],
    desc: "Colour fringing toward the screen edges and the pulse on nearby explosions." },
  { tab: "graphics", key: "adsBlur", label: "Aim edge blur", kind: "seg", options: ["on", "off"],
    desc: "Softens the edges of the screen while aiming down sights." },

  // ---------------------------------------------------------------- AUDIO
  { tab: "audio", key: "music", label: "Music volume", kind: "range", min: 0, max: 1, step: 0.05, fmt: PCT, desc: "Score volume." },
  { tab: "audio", key: "sfx", label: "Effects volume", kind: "range", min: 0, max: 1, step: 0.05, fmt: PCT,
    desc: "Weapons, footsteps, impacts and interface sounds." },
  { tab: "audio", key: "ambience", label: "Ambience volume", kind: "range", min: 0, max: 1, step: 0.05, fmt: PCT,
    desc: "Rain, wind and city background." },

  // ------------------------------------------------------------ INTERFACE
  { tab: "interface", key: "xhStyle", label: "Crosshair", kind: "seg", options: ["cross", "circle", "dot", "off"],
    desc: "Cross and circle open with your weapon's real spread; dot is a fixed centre point." },
  { tab: "interface", key: "xhDot", label: "Centre dot", kind: "seg", options: ["on", "off"], desc: "Small dot at the centre of the crosshair." },
  { tab: "interface", key: "xhColor", label: "Crosshair colour", kind: "seg", options: ["white", "green", "cyan", "yellow", "magenta"],
    desc: "Crosshair colour. Pick one that stands out against the night streets for you." },
  { tab: "interface", key: "xhSize", label: "Crosshair size", kind: "range", min: 0.5, max: 2, step: 0.05, fmt: MUL,
    desc: "Length and thickness of the crosshair lines." },
  { tab: "interface", key: "xhOpacity", label: "Crosshair opacity", kind: "range", min: 0.2, max: 1, step: 0.05, fmt: PCT,
    desc: "How solid the crosshair is." },
  { tab: "interface", key: "hitmarker", label: "Hit marker", kind: "seg", options: ["on", "off"],
    desc: "The X that flashes on a hit, headshot or kill." },
  { tab: "interface", key: "hudScale", label: "HUD size", kind: "range", min: 0.75, max: 1.25, step: 0.05, fmt: PCT,
    desc: "Size of the compass, ammo, health, killfeed and score readouts." },
  { tab: "interface", key: "hudOpacity", label: "HUD opacity", kind: "range", min: 0.3, max: 1, step: 0.05, fmt: PCT,
    desc: "How solid the HUD readouts are. Damage and flash effects are not affected." },
  { tab: "interface", key: "scoreFeed", label: "Score popups & XP feed", kind: "seg", options: ["on", "off"],
    desc: "The +points popups and the XP feed during play." },
  { tab: "interface", key: "minimap", label: "Minimap", kind: "seg", options: ["on", "off"], desc: "Show the minimap." },
  { tab: "interface", key: "minimapSize", label: "Minimap size", kind: "seg", options: ["small", "medium", "large"], desc: "Minimap size." },
  { tab: "interface", key: "killcam", label: "Kill cam", kind: "seg", options: ["on", "off"],
    desc: "Replay of how you were taken out while you wait to respawn." },
  { tab: "interface", key: "subtitles", label: "Subtitles", kind: "seg", options: ["on", "off"],
    desc: "Text for radio lines and callouts, bottom left." },
  { tab: "interface", key: "subSize", label: "Subtitle size", kind: "seg", options: ["small", "medium", "large"], desc: "Subtitle text size." },

  // -------------------------------------------------------- ACCESSIBILITY
  { tab: "access", key: "colorblind", label: "Colour-blind mode", kind: "seg",
    options: ["off", "protanopia", "deuteranopia", "tritanopia"], fmt: (o) => o === "off" ? "off" : o.slice(0, 6) + ".",
    hint: (v) => v === "off" ? "amber teammates · slate enemies"
      : v === "tritanopia" ? "cyan teammates · coral enemies" : "blue teammates · yellow enemies",
    desc: "Recolours teammate and enemy outlines, score lines and zone markers into a pair that stays distinct for that colour vision." },
  { tab: "access", kind: "swatch", label: "Team colours", desc: "Preview of the current teammate and enemy colours." },
  { tab: "access", key: "shake", label: "Camera shake", kind: "range", min: 0, max: 1, step: 0.05, fmt: PCT,
    desc: "View shake from explosions and taking damage. 0% removes it." },
  { tab: "access", key: "bob", label: "Head bob", kind: "range", min: 0, max: 1, step: 0.05, fmt: PCT,
    desc: "Camera sway while walking and running." },
  { tab: "access", key: "flashIntensity", label: "Flash intensity", kind: "range", min: 0.3, max: 1, step: 0.05, fmt: PCT,
    desc: "Strength of the white-out from flash grenades. Below 100% the blur is also removed." },
  { tab: "access", kind: "section", label: "Keyboard & mouse" },
  { tab: "access", key: "kbAds", label: "Aim down sights", kind: "seg", options: ["hold", "toggle"],
    desc: "Hold the aim button, or click once to aim and again to stop." },
  { tab: "access", key: "kbCrouch", label: "Crouch", kind: "seg", options: ["hold", "toggle"],
    desc: "Hold the crouch key, or press once to crouch and again to stand." },
  { tab: "access", key: "kbSprint", label: "Sprint", kind: "seg", options: ["hold", "toggle"],
    desc: "Hold the sprint key, or press once to sprint. Toggle sprint ends when you stop moving forward or aim." },
];

export function tabKeys(tab) { return ROWS.filter((r) => r.tab === tab && r.key).map((r) => r.key); }

const UI_CSS = `
#settings-overlay .a10-panel.br-set{padding:0 2px;width:min(620px,62vw);}
#settings-overlay .br-tabs{position:sticky;top:0;z-index:2;display:flex;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;gap:2px;padding:8px 0 10px;
  background:linear-gradient(rgba(8,10,14,.96),rgba(8,10,14,.86));}
#settings-overlay .br-tabs button{font-family:var(--a10-hud-font);font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;
  flex:0 0 auto;padding:7px 10px;background:rgba(232,232,228,.05);color:rgba(232,232,228,.6);border:1px solid var(--a10-hair);cursor:pointer;}
#settings-overlay .br-tabs button.on{color:#0a0c10;background:var(--a10-amber);border-color:var(--a10-amber);}
#settings-overlay .br-tabs .lb{flex:0 0 auto;font-size:9.5px;opacity:.55;padding:7px 4px;border:none;background:none;cursor:default;align-self:center;}
#settings-overlay .br-foot{position:sticky;bottom:0;z-index:2;padding:10px 0 8px;
  background:linear-gradient(rgba(8,10,14,.86),rgba(8,10,14,.97));border-top:1px solid var(--a10-hair);}
#settings-overlay .br-desc{font-size:12px;line-height:1.5;letter-spacing:.03em;color:rgba(232,232,228,.78);min-height:36px;margin-bottom:8px;}
#settings-overlay .br-acts{display:flex;flex-wrap:wrap;gap:6px;}
#settings-overlay .br-acts button,#settings-overlay .br-io button{font-family:inherit;font-size:10.5px;letter-spacing:.18em;
  padding:6px 12px;background:rgba(232,232,228,.06);color:rgba(232,232,228,.7);border:1px solid var(--a10-hair);
  cursor:pointer;text-transform:uppercase;}
#settings-overlay .br-acts button:hover,#settings-overlay .br-io button:hover{color:var(--a10-ink);border-color:var(--a10-amber);}
#settings-overlay .br-io{display:none;margin-top:8px;}
#settings-overlay .br-io textarea{width:100%;height:64px;box-sizing:border-box;background:rgba(0,0,0,.45);color:#e8e8e4;
  border:1px solid var(--a10-hair);font:11px/1.4 ui-monospace,Consolas,monospace;resize:vertical;}
#settings-overlay .br-io .msg{font-size:11px;letter-spacing:.06em;margin:4px 0;color:rgba(232,232,228,.7);}
#settings-overlay .a10-row.br-hot{background:rgba(217,164,65,.07);}
#settings-overlay .a10-seg{flex-wrap:wrap;justify-content:flex-end;}
#settings-overlay .a10-seg button.cust{cursor:default;opacity:.35;}
#settings-overlay .a10-seg button.cust.on{opacity:1;background:rgba(217,164,65,.25);color:var(--a10-ink);}
#settings-overlay .br-sw{display:inline-flex;gap:10px;align-items:center;font-size:11px;letter-spacing:.14em;text-transform:uppercase;}
#settings-overlay .br-sw i{display:inline-block;width:22px;height:12px;vertical-align:-2px;margin-right:6px;}
@media (max-height:520px){
  #settings-overlay .a10-panel.br-set{width:min(620px,66vw);right:3vw;max-height:94vh;}
  #settings-overlay .a10-rail{left:3vw;}
  #settings-overlay .br-tabs{padding:4px 0 6px;}
  #settings-overlay .br-tabs button{padding:5px 7px;font-size:9.5px;letter-spacing:.1em;}
  #settings-overlay .br-foot{padding:6px 0 4px;}
  #settings-overlay .br-acts button{padding:5px 8px;font-size:9.5px;letter-spacing:.1em;}
  #settings-overlay .br-desc{min-height:0;font-size:11px;margin-bottom:4px;}
  #settings-overlay .a10-row input[type=range]{width:140px;}
  #settings-overlay .a10-seg button{padding:5px 9px;}
}
#br-fpsc{position:fixed;right:8px;top:6px;z-index:55;pointer-events:none;display:none;
  font:11px/1.35 ui-monospace,Consolas,monospace;color:#e8e8e4;text-align:right;
  background:rgba(0,0,0,.45);padding:3px 7px;letter-spacing:.04em;}
#br-fpsc b{font-weight:400;color:#7dff9c;}
#br-fpsc b.mid{color:#ffd23f;} #br-fpsc b.bad{color:#ff6b5a;}
`;

export function createSettingsUI(ctx) {
  ensureShellStyle();
  if (ctx.input && ctx.input.pxPer360AtSens1 > 0) PX360_AT_1 = ctx.input.pxPer360AtSens1;
  if (!document.getElementById("br-settings-ui-style")) {
    const st = document.createElement("style");
    st.id = "br-settings-ui-style";
    st.textContent = UI_CSS;
    document.head.appendChild(st);
  }

  let visible = false;
  let onBack = null;
  let tab = "controls";
  try { const t = sessionStorage.getItem("br.settings.tab"); if (TABS.some(([k]) => k === t)) tab = t; } catch (e) { /* none */ }

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
  panel.className = "a10-panel br-set";
  const refs = {}; // key → {valEl, inputEl|btns, hintEl}
  const hintSpan = (key) => `<span class="hint" data-h="${key}" style="font-size:10.5px;letter-spacing:.08em;` +
    `text-transform:none;color:rgba(232,232,228,.36)"></span>`;
  const lblHtml = (r) => r.hint
    ? `<span style="display:flex;flex-direction:column;gap:4px"><span class="lbl">${r.label}</span>${hintSpan(r.key)}</span>`
    : `<span class="lbl">${r.label}</span>`;
  const descAttr = (d) => d ? ` data-desc="${String(d).replace(/"/g, "&quot;")}"` : "";

  let html = `<div class="br-tabs">` +
    `<span class="lb" data-pad-only="tactical">LB</span>` +
    TABS.map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join("") +
    `<span class="lb" data-pad-only="grenade">RB</span></div><div class="br-body">`;
  for (const [tk] of TABS) {
    html += `<div class="br-tab" data-tabbody="${tk}" style="display:none">`;
    for (const r of ROWS.filter((x) => x.tab === tk)) {
      if (r.kind === "section") {
        html += `<h2 style="margin:22px 0 4px">${r.label}</h2>`;
      } else if (r.kind === "padmap") {
        html += `<div class="a10-row" style="align-items:flex-start"${descAttr(r.desc)}><span class="lbl">${r.label}</span>` +
          `<span data-padmap style="font-size:11px;letter-spacing:.06em;line-height:1.65;text-align:right;` +
          `color:rgba(232,232,228,.62);text-transform:none"></span></div>`;
      } else if (r.kind === "swatch") {
        html += `<div class="a10-row"${descAttr(r.desc)}><span class="lbl">${r.label}</span><span class="br-sw" data-swatch></span></div>`;
      } else if (r.kind === "binds") {
        const acts = (ctx.input && ctx.input.keyActions) || [];
        html += acts.map(([a, , lbl]) =>
          `<div class="a10-row"${descAttr(r.desc)}><span class="lbl">${lbl}</span>` +
          `<span class="a10-seg"><button data-bind="${a}" style="min-width:92px"></button></span></div>`).join("");
        if (!acts.length) html += `<div class="a10-row"><span class="lbl">no rebindable keys on this device</span></div>`;
      } else if (r.kind === "seg" || r.kind === "preset") {
        const fmt = r.fmt || ((o) => o);
        html += `<div class="a10-row"${descAttr(r.desc)}>${lblHtml(r)}` +
          `<span class="a10-seg" data-k="${r.key}">` +
          r.options.map((o) => `<button data-o="${o}">${fmt(o)}</button>`).join("") +
          (r.kind === "preset" ? `<button class="cust" data-cust="1" tabindex="-1" disabled>custom</button>` : "") +
          `</span></div>`;
      } else {
        html += `<div class="a10-row"${descAttr(r.desc)}>${lblHtml(r)}` +
          `<span style="display:flex;align-items:center;gap:14px;flex:0 0 auto">` +
          `<input type="range" data-k="${r.key}" min="${r.min}" max="${r.max}" step="${r.step}"/>` +
          `<span class="val" data-v="${r.key}"></span></span></div>`;
      }
    }
    html += `</div>`;
  }
  html += `</div><div class="br-foot"><div class="br-desc"></div>` +
    `<div class="br-acts"><button data-act="reset">Reset tab to defaults</button>` +
    `<button data-act="export">Export settings</button><button data-act="import">Import settings</button></div>` +
    `<div class="br-io"><div class="msg"></div><textarea spellcheck="false"></textarea>` +
    `<div style="display:flex;gap:6px;margin-top:6px"><button data-act="apply">Apply</button>` +
    `<button data-act="copy">Copy</button><button data-act="closeio">Close</button></div></div></div>`;
  panel.innerHTML = html;
  root.appendChild(panel);
  document.body.appendChild(root);

  const descEl = panel.querySelector(".br-desc");
  const ioEl = panel.querySelector(".br-io");
  const ioMsg = ioEl.querySelector(".msg");
  const ioText = ioEl.querySelector("textarea");
  const swatchEl = panel.querySelector("[data-swatch]");
  const custBtn = panel.querySelector("button[data-cust]");

  const VALUE_ROWS = ROWS.filter((r) => r.key);
  for (const r of VALUE_ROWS) {
    if (r.kind === "seg" || r.kind === "preset") {
      refs[r.key] = { btns: Array.from(panel.querySelectorAll(`.a10-seg[data-k="${r.key}"] button[data-o]`)),
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
    if (!ref) return;
    if (r.kind === "seg" || r.kind === "preset") {
      const custom = r.kind === "preset" && live() && live().presetState() === "custom";
      for (const b of ref.btns) b.classList.toggle("on", !custom && b.getAttribute("data-o") === v);
      if (r.kind === "preset" && custBtn) custBtn.classList.toggle("on", custom);
      if (ref.hintEl && r.hint) ref.hintEl.textContent = r.hint(v);
    } else {
      if (Math.abs(Number(ref.inputEl.value) - v) > (r.step || 0.01) / 2) ref.inputEl.value = v;
      ref.valEl.textContent = r.fmt ? r.fmt(v) : String(v);
      if (ref.hintEl && r.hint) ref.hintEl.textContent = r.hint(v);
    }
  }
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
      PAD_ROWS.map(([v, t]) => `<b style="color:#e8e8e4;font-weight:400">${inp.padGlyph(v)}</b> ${t}`).join("<br>");
  }
  function syncSwatch() {
    if (!swatchEl) return;
    const h = live();
    const cb = h && h.teamColors ? h.teamColors() : null;
    const f = (cb && cb.friend) || "#d9a441", e = (cb && cb.enemy) || "#7c9fd0";
    swatchEl.innerHTML = `<span><i style="background:${f}"></i>team</span><span><i style="background:${e}"></i>enemy</span>`;
  }
  function syncTabs() {
    for (const b of panel.querySelectorAll("button[data-tab]")) b.classList.toggle("on", b.getAttribute("data-tab") === tab);
    for (const d of panel.querySelectorAll("[data-tabbody]")) d.style.display = d.getAttribute("data-tabbody") === tab ? "" : "none";
    const padNow = ctx.input && ctx.input.lastDevice === "pad";
    // LB / RB (L1 / R1 on PlayStation) hints beside the strip, controller only
    for (const s of panel.querySelectorAll("[data-pad-only]")) {
      s.style.display = padNow ? "" : "none";
      if (ctx.input && ctx.input.padGlyph) s.textContent = ctx.input.padGlyph(s.getAttribute("data-pad-only"));
    }
  }
  function syncAll() { for (const r of VALUE_ROWS) syncRow(r); syncBinds(); syncPadMap(); syncSwatch(); syncTabs(); }
  window.addEventListener("br:inputdevice", () => { if (visible) { syncPadMap(); syncTabs(); } });

  // Mirror external writes (quality presets from code, harness set()s, imports …).
  const GFX_TOGGLE_KEYS = ["bloom", "grain", "vignette", "adsBlur", "chromAb"];
  for (const r of VALUE_ROWS) ctx.onChange(r.key, () => { syncRow(r); if (r.key === "colorblind") syncSwatch(); });
  for (const k of GFX_TOGGLE_KEYS) ctx.onChange(k, () => { const q = ROWS.find((x) => x.key === "quality"); if (q) syncRow(q); });

  function setTab(t) {
    if (!TABS.some(([k]) => k === t)) return;
    tab = t;
    try { sessionStorage.setItem("br.settings.tab", t); } catch (e) { /* none */ }
    closeIO();
    syncTabs();
    panel.scrollTop = 0;
    setDesc(null);
  }
  function cycleTab(dir) {
    const i = TABS.findIndex(([k]) => k === tab);
    setTab(TABS[(i + dir + TABS.length) % TABS.length][0]);
    const b = panel.querySelector(`button[data-tab="${tab}"]`);
    if (b && ctx.input && ctx.input.lastDevice === "pad") {
      // keep the pad ring on the new tab button (input_gamepad nav reads .br-padfocus)
      const old = document.querySelector(".br-padfocus");
      if (old) old.classList.remove("br-padfocus");
    }
  }

  // ------------------------------------------------------- focused description
  let hotRow = null;
  function setDesc(row) {
    if (hotRow && hotRow !== row) hotRow.classList.remove("br-hot");
    hotRow = row;
    if (row) row.classList.add("br-hot");
    const d = row && row.getAttribute("data-desc");
    const t = TABS.find(([k]) => k === tab);
    descEl.textContent = d || `${t ? t[1] : ""} — hover or select an option to see what it does.`;
  }
  const rowOf = (el) => el && el.closest ? el.closest(".a10-row") : null;
  panel.addEventListener("mouseover", (e) => { const r = rowOf(e.target); if (r && r !== hotRow) setDesc(r); });
  panel.addEventListener("focusin", (e) => { const r = rowOf(e.target); if (r) setDesc(r); });

  // Gamepad: LB/RB switch tabs; the spatial-nav ring (.br-padfocus, set by
  // input_gamepad.js) drives the description line. Polled only while open.
  let pollId = 0;
  const padPrev = { lb: false, rb: false };
  function poll() {
    const f = document.querySelector("#settings-overlay .br-padfocus");
    if (f) { const r = rowOf(f); if (r && r !== hotRow) setDesc(r); }
    let pads = [];
    try { pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : []; } catch (e) { pads = []; }
    let lb = false, rb = false;
    for (const g of pads) { lb = lb || !!(g.buttons[4] && g.buttons[4].pressed); rb = rb || !!(g.buttons[5] && g.buttons[5].pressed); }
    if (lb && !padPrev.lb) cycleTab(-1);
    if (rb && !padPrev.rb) cycleTab(1);
    padPrev.lb = lb; padPrev.rb = rb;
  }

  // ---------------------------------------------------------- export / import
  function currentBinds() {
    const inp = ctx.input;
    const o = {};
    if (inp && inp.keyActions && inp.getBind) for (const [a, def] of inp.keyActions) if (inp.getBind(a) !== def) o[a] = inp.getBind(a);
    return o;
  }
  let ioMode = "";
  function openIO(mode) {
    ioMode = mode;
    ioEl.style.display = "block";
    ioEl.querySelector('[data-act="apply"]').style.display = mode === "import" ? "" : "none";
    ioEl.querySelector('[data-act="copy"]').style.display = mode === "export" ? "" : "none";
    if (mode === "export") {
      import_settings().then((M) => {
        ioText.value = M ? M.exportText(ctx.settings, currentBinds()) : "";
        ioMsg.textContent = "Copy this text to keep or share your settings (key bindings included).";
        ioText.focus(); ioText.select();
      });
    } else {
      ioText.value = "";
      ioMsg.textContent = "Paste settings text, then Apply.";
      ioText.focus();
    }
  }
  function closeIO() { ioMode = ""; ioEl.style.display = "none"; }
  // settings.js pure helpers: through the SAME versioned URL boot loaded
  // (ctx.V) so no second live instance is created; the helpers are pure.
  let modP = null;
  function import_settings() {
    if (!modP) modP = import(`../settings.js${ctx.V || ""}`).catch(() => null);
    return modP;
  }
  function applyImport() {
    import_settings().then((M) => {
      if (!M) { ioMsg.textContent = "Import unavailable."; return; }
      const r = M.parseImport(ioText.value);
      if (!r.ok) { ioMsg.textContent = "Not applied — " + r.error + "."; return; }
      const h = live();
      if (h && h.setMany) h.setMany(r.values);
      else for (const [k, v] of Object.entries(r.values)) ctx.setSetting(k, v);
      let nb = 0;
      const inp = ctx.input;
      if (inp && inp.rebind && r.binds) {
        if (inp.resetBinds) inp.resetBinds();
        for (const [a, c] of Object.entries(r.binds)) { try { inp.rebind(a, c); nb++; } catch (e) { /* skip */ } }
      }
      syncAll();
      ioMsg.textContent = `Applied ${r.count} settings` + (nb ? ` and ${nb} key bindings.` : ".");
    });
  }

  function resetTab() {
    const h = live();
    const keys = tabKeys(tab);
    if (h && h.resetKeys) h.resetKeys(keys);
    if (tab === "controls" && ctx.input && ctx.input.resetBinds) ctx.input.resetBinds();
    syncAll();
    descEl.textContent = `${(TABS.find(([k]) => k === tab) || [])[1]} reset to defaults.`;
  }

  // ------------------------------------------------------------------ input
  panel.addEventListener("input", (e) => {
    const k = e.target && e.target.getAttribute && e.target.getAttribute("data-k");
    if (!k) return;
    ctx.setSetting(k, Number(e.target.value));
  });

  panel.addEventListener("click", (e) => {
    const t = e.target && e.target.closest ? e.target.closest("button") : null;
    if (!t) return;
    const tb = t.getAttribute("data-tab");
    if (tb) { setTab(tb); return; }
    const act = t.getAttribute("data-act");
    if (act === "reset") { resetTab(); return; }
    if (act === "export") { openIO("export"); return; }
    if (act === "import") { openIO("import"); return; }
    if (act === "apply") { applyImport(); return; }
    if (act === "closeio") { closeIO(); return; }
    if (act === "copy") {
      ioText.select();
      const done = () => { ioMsg.textContent = "Copied."; };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ioText.value).then(done, () => { document.execCommand("copy"); done(); });
        else { document.execCommand("copy"); done(); }
      } catch (err) { ioMsg.textContent = "Select the text and copy it manually."; }
      return;
    }
    const bindA = t.getAttribute("data-bind");
    if (bindA && ctx.input && ctx.input.captureNextKey) {
      capturing = bindA; syncBinds();
      ctx.input.captureNextKey((code) => {
        if (code) ctx.input.rebind(bindA, code);
        capturing = null; syncBinds();
      });
      return;
    }
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
    if (capturing) return; // the bind capture consumes Escape as "cancel"
    if (ioMode) { closeIO(); return; }
    api.back();
  });

  // ------------------------------------------------------------------ api
  const api = {
    show(opts = {}) {
      onBack = typeof opts.onBack === "function" ? opts.onBack : null;
      visible = true;
      syncAll();
      setDesc(null);
      root.style.display = "block";
      clearInterval(pollId);
      pollId = setInterval(poll, 90);
    },
    hide() {
      visible = false;
      root.style.display = "none";
      clearInterval(pollId); pollId = 0;
      closeIO();
    },
    back() {
      const f = onBack;
      api.hide();
      if (f) { f(); return; }
      if (shell.pause && shell.pause.active) return;
      if (!isMissionLive(ctx) && shell.menu) {
        shell.menu.show(shell.menu.screenBefore || "title");
      }
    },
    setTab, // harness / deep link
    get tab() { return tab; },
    get visible() { return visible; },
  };

  installFpsCounter(ctx);
  installKbToggles(ctx);
  installCssSettings(ctx);

  shell.settingsUI = api;
  return api;
}

// ---------------------------------------------------------------------------
// FPS / frame-time counter (settings.fpsCounter off | fps | full). Its own
// fixed element (visible over menus too), refreshed 4x a second from the live
// perf counters — never per frame, never inside the render loop.
// ---------------------------------------------------------------------------
function installFpsCounter(ctx) {
  const el = document.createElement("div");
  el.id = "br-fpsc";
  document.body.appendChild(el);
  let id = 0;
  function tick() {
    const F = window.__FPS__;
    const mode = ctx.settings.fpsCounter;
    if (!F || !F.perf || mode === "off") return;
    const l = F.perf.live || {};
    const ms = l.frameMs || 0;
    // smooth over the perf window when available (one frame is noisy)
    let fps = l.fps || 0, p95 = null;
    try { const s = F.perf.stats(); if (s && s.fps) fps = s.fps; p95 = s && s.p95; } catch (e) { /* first frames */ }
    const cls = fps >= 55 ? "" : fps >= 30 ? "mid" : "bad";
    let txt = `<b class="${cls}">${Math.round(fps)}</b> FPS`;
    if (mode === "full") {
      const dr = globalThis.__BR_DYNRES__;
      const dpr = dr && dr.dpr ? dr.dpr() : (F.renderer ? F.renderer.getPixelRatio() : 1);
      const gl = F.renderer && F.renderer.getContext ? F.renderer.getContext() : null;
      const cap = ctx.settings.fpsCap && ctx.settings.fpsCap !== "uncapped" ? ` · cap ${ctx.settings.fpsCap}` : "";
      // p95 over the perf window; a suspended/hidden tab leaves multi-second
      // gaps in it, so only a plausible value is shown
      txt += `<br>${ms.toFixed(1)} ms` + (p95 > 0 && p95 < 1000 ? ` · p95 ${Number(p95).toFixed(1)}` : "") +
        `<br>${gl ? gl.drawingBufferWidth + "×" + gl.drawingBufferHeight : "?"} @ ${Math.round(dpr * 100)}%` +
        (ctx.settings.dynRes === "on" ? " dyn" : "") + cap +
        `<br>${l.drawCalls || 0} draws · ${Math.round((l.triangles || 0) / 1000)}k tris`;
    }
    el.innerHTML = txt;
  }
  function apply() {
    const on = ctx.settings.fpsCounter && ctx.settings.fpsCounter !== "off";
    el.style.display = on ? "block" : "none";
    clearInterval(id); id = 0;
    if (on) { tick(); id = setInterval(tick, 250); }
  }
  ctx.onChange("fpsCounter", apply);
  apply();
  ctx.fpsCounterTick = tick; // harness: refresh without waiting for the timer
}

// ---------------------------------------------------------------------------
// Keyboard & mouse HOLD vs TOGGLE (settings.kbAds / kbCrouch / kbSprint).
// input.js sets input.state.ads/crouch/sprint true on press and false on
// release. These listeners are registered AFTER input.js's (boot creates the
// settings UI last), on the same targets, so for a "toggle" verb they run
// second and re-assert the toggled value: press flips it, release puts it
// back. Rebinds are honoured through input.getBind(); bind capture stops
// propagation before reaching here. Toggles clear on focus loss, on the
// setting going back to "hold", and (sprint) when forward is released or
// aim starts — the genre convention for toggle sprint.
// ---------------------------------------------------------------------------
function installKbToggles(ctx) {
  const inp = ctx.input;
  if (!inp || !inp.state || typeof window === "undefined") return;
  const S = ctx.settings;
  const tog = { ads: false, crouch: false, sprint: false };
  const bind = (a, d) => (inp.getBind ? inp.getBind(a) : d) || d;
  const isCrouch = (c) => c === bind("crouch", "KeyC") || c === "ControlLeft" || c === "ControlRight";
  const isSprint = (c) => { const b = bind("sprint", "ShiftLeft"); return c === b || (b === "ShiftLeft" && c === "ShiftRight"); };
  const isFwd = (c) => c === bind("forward", "KeyW");
  function clear(k) { if (tog[k]) { tog[k] = false; inp.state[k] = false; } }
  window.addEventListener("keydown", (e) => {
    if (e.repeat || !inp.enabled) return;
    if (S.kbCrouch === "toggle" && isCrouch(e.code)) { tog.crouch = !tog.crouch; inp.state.crouch = tog.crouch; }
    if (S.kbSprint === "toggle" && isSprint(e.code)) { tog.sprint = !tog.sprint; inp.state.sprint = tog.sprint; }
  });
  window.addEventListener("keyup", (e) => {
    if (S.kbCrouch === "toggle" && isCrouch(e.code)) inp.state.crouch = tog.crouch;
    if (S.kbSprint === "toggle" && isSprint(e.code)) inp.state.sprint = tog.sprint;
    if (isFwd(e.code)) clear("sprint");
  });
  let designateAtDown = 0;
  const cv = ctx.canvas;
  if (cv) {
    // capture phase: runs BEFORE input.js's own mousedown (which clears designate)
    cv.addEventListener("mousedown", () => { designateAtDown = inp.designate || 0; }, true);
    cv.addEventListener("mousedown", (e) => {
      if (e.button !== 2 || S.kbAds !== "toggle" || designateAtDown || !inp.enabled) return;
      tog.ads = !tog.ads; inp.state.ads = tog.ads;
      if (tog.ads) clear("sprint");
    });
  }
  window.addEventListener("mouseup", (e) => { if (e.button === 2 && S.kbAds === "toggle") inp.state.ads = tog.ads; });
  window.addEventListener("blur", () => { tog.ads = tog.crouch = tog.sprint = false; });
  for (const [k, sk] of [["ads", "kbAds"], ["crouch", "kbCrouch"], ["sprint", "kbSprint"]]) {
    ctx.onChange(sk, (v) => { if (v !== "toggle") clear(k); });
  }
  ctx.kbToggles = tog; // harness read-back
}

// ---------------------------------------------------------------------------
// CSS-level settings for DOM owned by other lanes (style overrides only):
//  - scoreFeed off → hide the +score popups (#ld-score, loadout_hud.js) and
//    the XP feed (#br-xpfeed, after_action.js);
//  - flashIntensity < 1 → the flash whiteout (#eq-flash, equipment_fx.js,
//    opacity driven inline by flashLevel) gets a background alpha of k, so
//    the visible whiteout is k × its scripted level, and loses its blur.
//    !important outranks the inline backdrop-filter; inline opacity is left
//    alone, so the scripted fade curve is unchanged, only its ceiling.
// ---------------------------------------------------------------------------
function installCssSettings(ctx) {
  const el = document.createElement("style");
  el.id = "br-settings-css";
  document.head.appendChild(el);
  function apply() {
    const S = ctx.settings;
    let css = "";
    if (S.scoreFeed === "off") css += "#ld-score,#br-xpfeed{display:none !important;}\n";
    const k = Number(S.flashIntensity);
    if (k < 0.999) {
      css += `#eq-flash{background:rgba(255,253,246,${Math.max(0, Math.min(1, k)).toFixed(3)}) !important;` +
        `backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}\n`;
    }
    el.textContent = css;
  }
  ctx.onChange("scoreFeed", apply);
  ctx.onChange("flashIntensity", apply);
  apply();
}
