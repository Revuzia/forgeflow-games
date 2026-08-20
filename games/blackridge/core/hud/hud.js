// core/hud/hud.js [A10] — VT §6 verbatim: ONE condensed family (bundled
// Oswald latin subset + "Barlow Semi Condensed"/"Arial Narrow" fallback stack,
// no external font fetch), off-white #e8e8e4 at 85–92%, single amber accent
// #d9a441, red RESERVED for damage/kill/critical. Compass tape, ammo block,
// NO permanent health bar (damage vignette per combat_spec §6), crosshair
// driven by the LIVE effectiveSpread from core/sim/ballistics.js (never a
// second model — §2.5/§4.6), hitmarker + headshot/kill variants (§4.1),
// threat-ring damage direction (§4.3), killfeed with DISPLAY names (R4 —
// never internal ids), Corvus scope overlay, grenade indicator (R6/§5.9),
// radio subtitles (§5.10 honesty: subtitle text; squelch audio is A9's).
//
// Discipline:
//  - DOM-based, one injected <style>, pointer-events:none on the whole HUD.
//  - All gameplay-timed UI (markers, arcs, killfeed TTL, subtitles, toasts)
//    runs on SIM time (sim.state.time) — freezes with pause, deterministic
//    for captures. No setTimeout anywhere in this lane (epoch-safe by
//    construction: zero deferred callbacks).
//  - Per-frame DOM writes are change-gated (cached last-values); event DOM
//    (killfeed rows, markers) is pooled. No allocation-heavy per-frame work.
//  - Parity tallies for the playprobe (harness_plan §2.5): hud.tallies() →
//    {hitmarkers, killfeed} — independent counts the probe compares against
//    sim counters. Hitmarkers count shot events with shooter 'P' and a
//    non-null hit.entity, INCLUDING impactOnly resolutions, EXCLUDING pen
//    events (A1 swept-projectile convention) — 1:1 with sim shotsHit.
//
// Frozen signature: createHud(ctx) → {attach, update, show, hide} (+private).

import { effectiveSpread, playerSpreadState } from "../sim/ballistics.js";

// ---------------------------------------------------------------------------
// Shared shell registry — menu.js / pause.js / settings_ui.js import this so
// the four A10 modules can find each other without touching boot (A0) files.
// globalThis-keyed because boot dynamic-imports every module with `?v=N`
// while static sibling imports (`./hud.js`) resolve WITHOUT the query — two
// module instances of this file coexist by design of the ?v scheme, and a
// module-local object would split the registry between them (measured this
// session: debrief could not find shell.pause/shell.menu).
// ---------------------------------------------------------------------------
export const shell = (globalThis.__A10_SHELL__ = globalThis.__A10_SHELL__ || {
  hud: null, menu: null, pause: null, settingsUI: null,
});

export function isMissionLive(ctx) {
  const sim = ctx && ctx.sim ? ctx.sim() : null;
  if (!sim) return false;
  const ph = sim.state.phase;
  return ph === "infil" || ph === "assault" || ph === "exfil";
}

const DEG = 180 / Math.PI;

export function norm180(a) { return ((a + 540) % 360) - 180; }
export function norm360(a) { return ((a % 360) + 360) % 360; }

// Screen-relative angle to a world position: 0° = dead ahead, +cw (right).
export function relDegTo(sim, pos) {
  const p = sim.state.player;
  const dx = pos[0] - p.pos[0], dz = pos[2] - p.pos[2];
  return norm180((Math.atan2(dx, -dz) + p.yaw) * DEG);
}

// Same for a unit direction vector (e.g. hurt.dir = victim→attacker).
export function relDegDir(sim, dir) {
  return norm180((Math.atan2(dir[0], -dir[2]) + sim.state.player.yaw) * DEG);
}

// ---------------------------------------------------------------------------
// Style — injected once, shared by all four A10 modules.
// ---------------------------------------------------------------------------
let styleDone = false;
export function ensureStyle() {
  if (styleDone || typeof document === "undefined") return;
  styleDone = true;
  // DOM-idempotent across the duplicate ?v / query-less module instances.
  if (document.getElementById("a10-style")) return;
  const el = document.createElement("style");
  el.id = "a10-style";
  el.textContent = `
@font-face{
  font-family:'Oswald';font-style:normal;font-weight:400;font-display:swap;
  src:url('./assets/fonts/oswald-400-latin.woff2') format('woff2');
  unicode-range:U+0000-00FF,U+2013-2014,U+2022,U+00D7;
}
:root{
  --a10-ink:#e8e8e4; --a10-amber:#d9a441; --a10-red:#ff4d4d; --a10-kill:#ff3b30;
  --a10-hud-font:'Oswald','Barlow Semi Condensed','Arial Narrow',system-ui,sans-serif;
  --a10-ui-font:ui-sans-serif,'Inter','Segoe UI',system-ui,sans-serif;
  --a10-hair:rgba(232,232,228,.14);
}
#hud{position:fixed;inset:0;z-index:30;pointer-events:none;overflow:hidden;
  font-family:var(--a10-hud-font);color:var(--a10-ink);
  text-shadow:0 1px 2px rgba(0,0,0,.6);
  -webkit-user-select:none;user-select:none;}
#hud *{box-sizing:border-box;}

/* ------------------------------------------------------------- compass */
#compass{position:absolute;top:18px;left:50%;transform:translateX(-50%);
  width:min(560px,42vw);height:44px;opacity:.55;
  -webkit-mask-image:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent);
  mask-image:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent);}
#compass .a10-tape{position:absolute;top:6px;left:50%;height:20px;will-change:transform;}
#compass .a10-tk{position:absolute;top:0;width:1px;height:6px;background:var(--a10-ink);opacity:.8;}
#compass .a10-tk.card{height:9px;width:1.5px;}
#compass .a10-tl{position:absolute;top:9px;transform:translateX(-50%);
  font-size:11px;letter-spacing:.08em;opacity:.85;}
#compass .a10-tl.card{font-size:13px;top:10px;letter-spacing:.12em;}
#compass .a10-cursor{position:absolute;top:2px;left:50%;transform:translateX(-50%);
  width:1.5px;height:10px;background:var(--a10-amber);}
#compass .a10-pip{position:absolute;top:26px;transform:translateX(-50%);
  text-align:center;color:var(--a10-amber);will-change:transform;}
#compass .a10-pip .d{display:block;font-size:9px;letter-spacing:.06em;opacity:.9;margin-top:1px;}
#compass .a10-pip svg{display:block;margin:0 auto;}
#compass .a10-wedge{position:absolute;top:0;width:10px;height:4px;transform:translateX(-50%);
  background:var(--a10-red);opacity:0;}

/* ----------------------------------------------------------- crosshair */
#crosshair{position:absolute;left:50%;top:50%;width:0;height:0;}
#crosshair .a10-x{position:absolute;left:0;top:0;background:var(--a10-ink);
  box-shadow:0 0 2px rgba(0,0,0,.7);will-change:transform;}
#crosshair .a10-xv{width:1.5px;height:7px;margin-left:-0.75px;}
#crosshair .a10-xh{width:7px;height:1.5px;margin-top:-0.75px;}
#crosshair .a10-dot{position:absolute;left:-1px;top:-1px;width:2px;height:2px;
  background:var(--a10-ink);border-radius:50%;}
#a10-reload{position:absolute;left:50%;top:50%;transform:translate(-50%,26px);opacity:0;}
#a10-reload svg{display:block;}
#a10-dry{position:absolute;left:50%;top:50%;transform:translate(-50%,26px);
  width:14px;height:14px;border:1.5px solid var(--a10-red);border-radius:50%;opacity:0;}

/* ---------------------------------------------------------- hitmarker */
#hitmarker{position:absolute;left:50%;top:50%;width:0;height:0;opacity:0;will-change:transform,opacity;}
#hitmarker .a10-hm{position:absolute;width:2px;background:var(--a10-ink);
  left:-1px;top:0;transform-origin:50% 0;}
#hitmarker.kill .a10-hm{background:var(--a10-kill);}
#hitmarker .a10-notch{position:absolute;left:-1px;top:-3px;width:2px;height:0;
  background:var(--a10-ink);}
#hitmarker.head .a10-notch{height:3px;}

/* --------------------------------------------------------- threat ring */
#a10-threat{position:absolute;left:50%;top:50%;width:0;height:0;}
#a10-threat .a10-arc{position:absolute;left:-60px;top:-60px;width:120px;height:120px;
  opacity:0;will-change:transform,opacity;}

/* ------------------------------------------------------ grenade warning */
#a10-grenade{position:absolute;left:50%;top:58%;transform:translateX(-50%);
  text-align:center;color:var(--a10-red);opacity:0;}
#a10-grenade .rot{display:block;margin:0 auto;will-change:transform;}
#a10-grenade .d{font-size:11px;letter-spacing:.14em;margin-top:2px;}

/* ---------------------------------------------------------------- ammo */
/* bottom 64px keeps the FRAG pips clear of the FFG portal controls that sit
   in the page's bottom-right corner (collision measured in the wave-2 probe) */
#ammo{position:absolute;right:34px;bottom:64px;text-align:right;}
#ammo .a10-wname{font-size:13px;letter-spacing:.22em;opacity:.85;text-transform:uppercase;}
#ammo .a10-row{display:flex;align-items:baseline;justify-content:flex-end;gap:8px;margin-top:2px;}
#ammo .a10-mode{font-size:10px;letter-spacing:.2em;opacity:.6;}
#ammo .a10-mag{font-size:44px;font-weight:700;line-height:1;
  font-variant-numeric:tabular-nums;color:var(--a10-ink);opacity:.92;}
#ammo .a10-mag.low{color:var(--a10-amber);animation:a10pulse 1.1s ease-in-out infinite;}
#ammo .a10-mag.crit{color:var(--a10-red);animation:a10pulse .7s ease-in-out infinite;}
#ammo .a10-res{font-size:18px;font-weight:400;opacity:.6;font-variant-numeric:tabular-nums;}
#ammo .a10-low{font-size:10px;letter-spacing:.3em;color:var(--a10-amber);
  margin-top:3px;visibility:hidden;}
#ammo .a10-nades{margin-top:6px;font-size:11px;letter-spacing:.18em;opacity:.7;}
#ammo .a10-nades .off{opacity:.25;}
@keyframes a10pulse{0%,100%{opacity:.92}50%{opacity:.55}}

/* ------------------------------------------------------------ killfeed */
#killfeed{position:absolute;right:34px;top:64px;text-align:right;font-size:12.5px;
  letter-spacing:.06em;}
#killfeed .a10-kr{margin-bottom:5px;opacity:0;white-space:nowrap;
  color:rgba(232,232,228,.88);}
#killfeed .a10-kr svg{vertical-align:-2px;margin:0 7px;opacity:.7;}
#killfeed .a10-kr .me{color:var(--a10-amber);}

/* ---------------------------------------------------- objective + banner */
#objective{position:absolute;left:50%;bottom:24%;transform:translateX(-50%);
  text-align:center;opacity:0;}
#objective .t{font-size:11px;letter-spacing:.32em;color:var(--a10-amber);}
#objective .l{font-size:16px;letter-spacing:.14em;margin-top:4px;text-transform:uppercase;}
#objective .u{height:1px;background:var(--a10-amber);margin:7px auto 0;width:0;}
#a10-banner{position:absolute;left:50%;bottom:31%;transform:translateX(-50%);
  font-size:14px;letter-spacing:.2em;opacity:0;white-space:nowrap;}
#a10-banner .x{color:var(--a10-kill);margin-right:8px;}

/* ------------------------------------------------------------ subtitles */
#a10-subtitle{position:absolute;left:50%;bottom:12%;transform:translateX(-50%);
  max-width:min(760px,72vw);text-align:center;font-size:15px;line-height:1.5;
  letter-spacing:.04em;opacity:0;font-family:var(--a10-ui-font);
  text-shadow:0 1px 3px rgba(0,0,0,.85);}
#a10-subtitle .sp{color:var(--a10-amber);font-family:var(--a10-hud-font);
  letter-spacing:.14em;margin-right:.6em;}

/* ------------------------------------------------- vignette / fade / fx */
#a10-vignette{position:absolute;inset:0;opacity:0;will-change:opacity;
  background:radial-gradient(ellipse at center,rgba(255,45,45,0) 46%,rgba(210,20,20,.85) 100%);}
#a10-vigdir{position:absolute;inset:0;opacity:0;will-change:opacity;}
#a10-desat{position:absolute;inset:0;display:none;backdrop-filter:saturate(.8);}
#a10-flash{position:absolute;inset:0;opacity:0;
  background:radial-gradient(ellipse at center,rgba(255,244,224,.5) 0%,rgba(255,244,224,0) 70%);}
#a10-fade{position:absolute;inset:0;background:#000;opacity:0;}

/* --------------------------------------------------------------- scope */
#a10-scope{position:absolute;inset:0;display:none;}
#a10-scope .hole{position:absolute;left:50%;top:50%;width:76vmin;height:76vmin;
  transform:translate(-50%,-50%);border-radius:50%;
  box-shadow:0 0 0 9999px rgba(2,3,4,.985),inset 0 0 90px rgba(0,0,0,.9);
  border:1px solid rgba(0,0,0,.9);}
#a10-scope .cx{position:absolute;left:50%;top:50%;background:rgba(10,10,10,.92);}
#a10-scope .cxh{width:76vmin;height:1px;transform:translate(-50%,-0.5px);}
#a10-scope .cxv{width:1px;height:76vmin;transform:translate(-0.5px,-50%);}
#a10-scope .mil{position:absolute;left:50%;top:50%;background:rgba(10,10,10,.85);}
#a10-scope .drift{position:absolute;inset:0;will-change:transform;}

/* -------------------------------------------------------------- debrief */
#a10-debrief{position:fixed;inset:0;z-index:65;display:none;pointer-events:auto;
  font-family:var(--a10-ui-font);color:var(--a10-ink);
  background:linear-gradient(90deg,rgba(4,6,10,.88),rgba(4,6,10,.55) 60%,rgba(4,6,10,.35));
  backdrop-filter:blur(14px) brightness(.7);}
#a10-debrief .in{position:absolute;left:8vw;top:50%;transform:translateY(-50%);min-width:340px;}
#a10-debrief .rt{font-size:11px;letter-spacing:.34em;opacity:.55;}
#a10-debrief h1{font-family:var(--a10-hud-font);font-weight:400;font-size:34px;
  letter-spacing:.3em;margin:10px 0 4px;}
#a10-debrief h1.lost{color:var(--a10-red);}
#a10-debrief .sub{font-size:12.5px;letter-spacing:.08em;opacity:.6;margin-bottom:26px;}
#a10-debrief .grid{display:grid;grid-template-columns:auto auto;gap:7px 34px;
  font-size:13px;letter-spacing:.1em;margin-bottom:32px;}
#a10-debrief .grid .k{opacity:.55;text-transform:uppercase;font-size:11px;letter-spacing:.22em;}
#a10-debrief .grid .v{text-align:right;font-family:var(--a10-hud-font);
  font-variant-numeric:tabular-nums;}
`;
  document.head.appendChild(el);
}

// Shared button/rail CSS for menu/pause/settings — kept here so one style
// tag serves the whole lane.
export function ensureShellStyle() {
  ensureStyle();
  if (typeof document === "undefined" || document.getElementById("a10-shell-style")) return;
  const el = document.createElement("style");
  el.id = "a10-shell-style";
  el.textContent = `
.a10-overlay{position:fixed;inset:0;font-family:var(--a10-ui-font);
  color:var(--a10-ink);pointer-events:auto;-webkit-user-select:none;user-select:none;}
.a10-overlay .wash{position:absolute;inset:0;
  background:linear-gradient(90deg,rgba(4,6,10,.86),rgba(4,6,10,.42) 55%,rgba(4,6,10,.18));
  backdrop-filter:blur(18px) saturate(.9) brightness(.75);}
.a10-rail{position:absolute;left:8vw;top:50%;transform:translateY(-50%);}
.a10-rail .wm{font-family:var(--a10-hud-font);font-weight:400;font-size:40px;
  letter-spacing:.42em;margin-bottom:6px;}
.a10-rail .tag{font-size:10.5px;letter-spacing:.34em;text-transform:uppercase;
  opacity:.5;margin-bottom:46px;}
.a10-item{display:block;position:relative;padding:9px 0 9px 18px;cursor:pointer;
  font-size:14px;letter-spacing:.3em;text-transform:uppercase;
  color:rgba(232,232,228,.68);background:none;border:none;text-align:left;
  font-family:inherit;transition:color .15s ease,transform .15s ease;}
.a10-item:hover,.a10-item.on{color:var(--a10-ink);transform:translateX(4px);}
.a10-item::before{content:"";position:absolute;left:0;top:50%;width:2px;height:0;
  background:var(--a10-amber);transform:translateY(-50%);transition:height .15s ease;}
.a10-item:hover::before,.a10-item.on::before{height:60%;}
.a10-item.danger:hover{color:var(--a10-red);}
.a10-item:disabled{opacity:.45;cursor:default;}
.a10-vmark{position:absolute;left:8vw;bottom:26px;font-size:10px;
  letter-spacing:.24em;opacity:.4;text-transform:uppercase;}
.a10-panel{position:absolute;right:8vw;top:50%;transform:translateY(-50%);
  width:min(560px,60vw);max-height:74vh;overflow:auto;padding:6px 2px;}
.a10-panel h2{font-family:var(--a10-hud-font);font-weight:400;font-size:15px;
  letter-spacing:.34em;opacity:.85;margin:0 0 18px;text-transform:uppercase;}
.a10-panel .body{font-size:13.5px;line-height:1.8;letter-spacing:.03em;
  color:rgba(232,232,228,.8);}
.a10-panel .body .amber{color:var(--a10-amber);}
.a10-panel pre{white-space:pre-wrap;font-size:11.5px;line-height:1.7;
  font-family:ui-monospace,Consolas,monospace;color:rgba(232,232,228,.7);}
.a10-row{display:flex;align-items:center;justify-content:space-between;
  padding:13px 2px;border-bottom:1px solid var(--a10-hair);}
.a10-row .lbl{font-size:11px;letter-spacing:.26em;text-transform:uppercase;
  color:rgba(232,232,228,.62);}
.a10-row .val{font-family:var(--a10-hud-font);font-size:13px;min-width:44px;
  text-align:right;font-variant-numeric:tabular-nums;color:var(--a10-ink);}
.a10-row input[type=range]{width:200px;accent-color:var(--a10-amber);
  background:transparent;cursor:pointer;}
.a10-seg{display:flex;gap:2px;}
.a10-seg button{font-family:inherit;font-size:10.5px;letter-spacing:.2em;
  padding:6px 14px;background:rgba(232,232,228,.06);color:rgba(232,232,228,.6);
  border:1px solid var(--a10-hair);cursor:pointer;text-transform:uppercase;}
.a10-seg button.on{color:#0a0c10;background:var(--a10-amber);border-color:var(--a10-amber);}
`;
  document.head.appendChild(el);
}

// ---------------------------------------------------------------------------
// Small SVG builders (procedural HUD art — Part 4: no icon-font/CC-BY deps).
// ---------------------------------------------------------------------------
const GLYPHS = { // per weapon class, tiny original silhouettes for the killfeed
  ar: "M0 4h13V2h4l1 2h8v2h-7l-1 3h-3l1-3H0z",
  smg: "M2 4h9V2h4l1 2h6v2h-5l-1 3h-3l1-3H2z",
  dmr: "M0 4h11l1-2h3v2h13v2h-9l-1 3h-3l1-3H0zM13 0h5v1h-5z",
  pistol: "M6 2h14v2h-7l-1 4h-4l1-4H6z",
};
function weaponGlyphSvg(cls) {
  const d = GLYPHS[cls] || GLYPHS.ar;
  return `<svg width="27" height="10" viewBox="0 0 27 10" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
}

// ---------------------------------------------------------------------------
// createHud
// ---------------------------------------------------------------------------
export function createHud(ctx) {
  ensureStyle();
  const W = ctx.weapons || {};
  const content = ctx.content || {};
  const callsign =
    (content.mission && content.mission.fiction && content.mission.fiction.playerCallsign) || "RAVEN 2-1";
  const archLabel = (a) =>
    ((content.archetypes && content.archetypes[a] && content.archetypes[a].label) || a || "HOSTILE");
  const wName = (id) => (W[id] && W[id].name) || id || "";
  const wClass = (id) => (W[id] && W[id].class) || "ar";

  // ------------------------------------------------------------------ DOM
  const root = document.createElement("div");
  root.id = "hud";
  root.style.display = "none";

  // compass ------------------------------------------------------------
  const PX_PER_DEG = 4.4; // ~90° visible in a 560px window before the mask
  const compass = document.createElement("div");
  compass.id = "compass";
  const tape = document.createElement("div");
  tape.className = "a10-tape";
  const CARD = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
  let tapeHtml = "";
  for (let d = -360; d < 720; d += 15) {
    const b = norm360(d);
    const card = CARD[b] != null;
    const x = d * PX_PER_DEG;
    tapeHtml += `<div class="a10-tk${card ? " card" : ""}" style="left:${x}px"></div>`;
    tapeHtml += `<div class="a10-tl${card ? " card" : ""}" style="left:${x}px">${
      card ? CARD[b] : String(b).padStart(3, "0")}</div>`;
  }
  tape.innerHTML = tapeHtml;
  compass.appendChild(tape);
  const cursor = document.createElement("div");
  cursor.className = "a10-cursor";
  compass.appendChild(cursor);
  const pips = [];
  for (let i = 0; i < 3; i++) {
    const p = document.createElement("div");
    p.className = "a10-pip";
    p.style.display = "none";
    p.innerHTML = `<svg width="9" height="6" viewBox="0 0 9 6" fill="currentColor"><path d="M4.5 0L9 6H0z"/></svg><span class="d"></span>`;
    compass.appendChild(p);
    pips.push({ el: p, dEl: null, shown: false, lastX: 1e9, lastTxt: "" });
    pips[i].dEl = p.querySelector(".d");
  }
  const wedges = [];
  for (let i = 0; i < 4; i++) {
    const w = document.createElement("div");
    w.className = "a10-wedge";
    compass.appendChild(w);
    wedges.push({ el: w, t: -9, bearing: 0 });
  }
  root.appendChild(compass);

  // crosshair ------------------------------------------------------------
  const cross = document.createElement("div");
  cross.id = "crosshair";
  cross.innerHTML =
    `<div class="a10-x a10-xv" data-k="t"></div><div class="a10-x a10-xv" data-k="b"></div>` +
    `<div class="a10-x a10-xh" data-k="l"></div><div class="a10-x a10-xh" data-k="r"></div>` +
    `<div class="a10-dot"></div>`;
  root.appendChild(cross);
  const xT = cross.children[0], xB = cross.children[1], xL = cross.children[2], xR = cross.children[3];
  const xDot = cross.children[4];

  // reload ring + dry flash ----------------------------------------------
  const RING_R = 7, RING_C = 2 * Math.PI * RING_R;
  const reloadEl = document.createElement("div");
  reloadEl.id = "a10-reload";
  reloadEl.innerHTML =
    `<svg width="18" height="18" viewBox="0 0 18 18">` +
    `<circle cx="9" cy="9" r="${RING_R}" fill="none" stroke="rgba(232,232,228,.25)" stroke-width="1.5"/>` +
    `<circle class="p" cx="9" cy="9" r="${RING_R}" fill="none" stroke="#e8e8e4" stroke-width="1.5"` +
    ` stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}" transform="rotate(-90 9 9)"/></svg>`;
  root.appendChild(reloadEl);
  const ringP = reloadEl.querySelector(".p");
  const dryEl = document.createElement("div");
  dryEl.id = "a10-dry";
  root.appendChild(dryEl);

  // hitmarker --------------------------------------------------------------
  const hm = document.createElement("div");
  hm.id = "hitmarker";
  hm.innerHTML =
    `<div class="a10-hm" style="transform:rotate(45deg) translateY(5px)"></div>` +
    `<div class="a10-hm" style="transform:rotate(135deg) translateY(5px)"></div>` +
    `<div class="a10-hm" style="transform:rotate(225deg) translateY(5px)"></div>` +
    `<div class="a10-hm" style="transform:rotate(315deg) translateY(5px)"></div>` +
    `<div class="a10-notch"></div>`;
  root.appendChild(hm);
  const hmArms = hm.querySelectorAll(".a10-hm");

  // threat ring -------------------------------------------------------------
  const threat = document.createElement("div");
  threat.id = "a10-threat";
  const ARC_R = 48, ARC_HALF = 35 * Math.PI / 180; // 70° wide (§4.3)
  const ax0 = 60 - ARC_R * Math.sin(ARC_HALF), ay0 = 60 - ARC_R * Math.cos(ARC_HALF);
  const ax1 = 60 + ARC_R * Math.sin(ARC_HALF);
  const arcPath = `M${ax0.toFixed(1)} ${ay0.toFixed(1)} A${ARC_R} ${ARC_R} 0 0 1 ${ax1.toFixed(1)} ${ay0.toFixed(1)}`;
  const arcs = [];
  for (let i = 0; i < 4; i++) {
    const a = document.createElement("div");
    a.className = "a10-arc";
    a.innerHTML = `<svg width="120" height="120" viewBox="0 0 120 120">` +
      `<path d="${arcPath}" fill="none" stroke="#ff4d4d" stroke-width="4" stroke-linecap="round"/></svg>`;
    threat.appendChild(a);
    arcs.push({ el: a, t: -9, deg: 0, live: false, dir: null });
  }
  root.appendChild(threat);

  // grenade warning ----------------------------------------------------------
  const nadeWarn = document.createElement("div");
  nadeWarn.id = "a10-grenade";
  nadeWarn.innerHTML =
    `<span class="rot"><svg width="26" height="26" viewBox="0 0 26 26" fill="currentColor">` +
    `<path d="M13 2l4 7h-8z"/><circle cx="13" cy="16" r="6" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<rect x="11" y="8" width="4" height="3"/></svg></span><div class="d">GRENADE</div>`;
  root.appendChild(nadeWarn);
  const nadeRot = nadeWarn.querySelector(".rot");

  // ammo block ----------------------------------------------------------------
  const ammo = document.createElement("div");
  ammo.id = "ammo";
  ammo.innerHTML =
    `<div class="a10-wname"></div>` +
    `<div class="a10-row"><span class="a10-mode"></span><span class="a10-mag">0</span><span class="a10-res">/ 0</span></div>` +
    `<div class="a10-low">LOW AMMO</div><div class="a10-nades"></div>`;
  root.appendChild(ammo);
  const amName = ammo.querySelector(".a10-wname"), amMode = ammo.querySelector(".a10-mode");
  const amMag = ammo.querySelector(".a10-mag"), amRes = ammo.querySelector(".a10-res");
  const amLow = ammo.querySelector(".a10-low"), amNades = ammo.querySelector(".a10-nades");

  // killfeed ---------------------------------------------------------------
  const killfeed = document.createElement("div");
  killfeed.id = "killfeed";
  const feedRows = [];
  for (let i = 0; i < 4; i++) {
    const r = document.createElement("div");
    r.className = "a10-kr";
    killfeed.appendChild(r);
    feedRows.push({ el: r, t: -9, live: false });
  }
  root.appendChild(killfeed);

  // objective toast + kill banner ---------------------------------------------
  const objEl = document.createElement("div");
  objEl.id = "objective";
  objEl.innerHTML = `<div class="t"></div><div class="l"></div><div class="u"></div>`;
  root.appendChild(objEl);
  const objT = objEl.querySelector(".t"), objL = objEl.querySelector(".l"), objU = objEl.querySelector(".u");
  const banner = document.createElement("div");
  banner.id = "a10-banner";
  banner.innerHTML = `<span class="x">⨯</span><span class="n"></span>`;
  root.appendChild(banner);
  const bannerN = banner.querySelector(".n");

  // subtitles ------------------------------------------------------------------
  const subEl = document.createElement("div");
  subEl.id = "a10-subtitle";
  subEl.innerHTML = `<span class="sp"></span><span class="ln"></span>`;
  root.appendChild(subEl);
  const subSp = subEl.querySelector(".sp"), subLn = subEl.querySelector(".ln");

  // vignette / desat / flash / fade ---------------------------------------------
  const vig = document.createElement("div"); vig.id = "a10-vignette"; root.appendChild(vig);
  const vigDir = document.createElement("div"); vigDir.id = "a10-vigdir"; root.appendChild(vigDir);
  const desat = document.createElement("div"); desat.id = "a10-desat"; root.appendChild(desat);
  const flash = document.createElement("div"); flash.id = "a10-flash"; root.appendChild(flash);
  const fade = document.createElement("div"); fade.id = "a10-fade"; root.appendChild(fade);

  // Corvus scope overlay ----------------------------------------------------------
  const scope = document.createElement("div");
  scope.id = "a10-scope";
  scope.innerHTML =
    `<div class="drift"><div class="cx cxh"></div><div class="cx cxv"></div>` +
    `<div class="mil" style="width:1px;height:10px;transform:translate(-0.5px,60px)"></div>` +
    `<div class="mil" style="width:1px;height:10px;transform:translate(-0.5px,130px)"></div>` +
    `<div class="mil" style="width:10px;height:1px;transform:translate(60px,-0.5px)"></div>` +
    `<div class="mil" style="width:10px;height:1px;transform:translate(-70px,-0.5px)"></div>` +
    `<div class="mil" style="width:1px;height:10px;transform:translate(-0.5px,-70px)"></div></div>` +
    `<div class="hole"></div>`;
  root.appendChild(scope);
  const scopeDrift = scope.querySelector(".drift");

  // debrief (interactive — sits OUTSIDE the pointer-events:none hud root) ----------
  const debrief = document.createElement("div");
  debrief.id = "a10-debrief";
  debrief.innerHTML =
    `<div class="in"><div class="rt">AFTER-ACTION REPORT</div><h1></h1><div class="sub"></div>` +
    `<div class="grid"></div>` +
    `<button class="a10-item" data-a="redeploy">Redeploy</button>` +
    `<button class="a10-item" data-a="base">Return to base</button>` +
    `<div style="position:absolute;visibility:hidden"></div></div>`;
  const dbTitle = debrief.querySelector("h1"), dbSub = debrief.querySelector(".sub");
  const dbGrid = debrief.querySelector(".grid");

  document.body.appendChild(root);
  document.body.appendChild(debrief);

  // ------------------------------------------------------------------ state
  const st = {
    // hitmarker
    hmT: -9, hmKind: "hit",
    // dry flash / reload
    dryT: -9, reloadDur: 0,
    // banner / objective toast
    bannerT: -9, objToastT: -9,
    // killfeed
    lastHitWeapon: {},
    // grenade warn
    nade: null, // {pos:[3]}
    // explosion flash
    flashT: -9,
    // subtitles
    subQ: [], subUntil: -9, subShown: false,
    // vig direction
    vigDirT: -9, vigDirDeg: 0,
    // debrief
    debriefOpen: false,
    // tallies (playprobe parity — harness_plan §2.5)
    tallies: { hitmarkers: 0, killfeed: 0 },
    // change-gates
    lastGap: -1, lastBearing: 1e9, lastMag: -1, lastRes: -1, lastWname: "",
    lastMode: "", lastNades: -1, lastVig: -1, lastFade: -1, lastCrossA: -1,
    hintWasShown: false,
  };

  function simNow() { const s = ctx.sim(); return s ? s.state.time : 0; }

  function resetTransient() {
    st.hmT = st.dryT = st.bannerT = st.objToastT = st.flashT = st.vigDirT = -9;
    st.nade = null;
    st.subQ.length = 0; st.subUntil = -9;
    st.lastHitWeapon = {};
    st.tallies.hitmarkers = 0; st.tallies.killfeed = 0;
    for (const r of feedRows) { r.live = false; r.el.style.opacity = "0"; }
    for (const a of arcs) a.live = false;
    hideDebrief();
  }

  // ------------------------------------------------------------------ events
  function onShot(d) {
    if (!d || d.pen) return;                       // pen FX events carry no entity
    if (d.shooter !== "P" || !d.hit || d.hit.entity == null) return;
    st.tallies.hitmarkers++;
    st.hmT = simNow();
    st.hmKind = d.hit.part === "head" ? "head" : "hit";
    if (d.hit.entity !== "P") st.lastHitWeapon[d.hit.entity] = d.weaponId;
  }

  function onHurt(d) {
    if (!d || d.victim !== "P") return;
    const sim = ctx.sim(); if (!sim) return;
    const deg = relDegDir(sim, d.dir || [0, 0, 1]);
    const t = simNow();
    // threat arc: reuse an arc for the same-ish direction, else oldest slot
    let slot = null;
    for (const a of arcs) if (a.live && Math.abs(norm180(a.deg - deg)) < 25) { slot = a; break; }
    if (!slot) { slot = arcs[0]; for (const a of arcs) if (a.t < slot.t) slot = a; }
    slot.live = true; slot.t = t; slot.deg = deg; slot.dir = d.dir ? d.dir.slice() : null;
    // directional vignette bias (§4.3 — red creeps 12% further from hit side)
    st.vigDirT = t; st.vigDirDeg = deg;
    // compass ping wedge
    let wslot = wedges[0];
    for (const w of wedges) if (w.t < wslot.t) wslot = w;
    wslot.t = t;
    wslot.bearing = norm360((Math.atan2((d.dir || [0, 0, 1])[0], -(d.dir || [0, 0, 1])[2])) * DEG);
  }

  function onDeath(d) {
    const t = simNow();
    const sim = ctx.sim(); if (!sim || !d) return;
    // kill hitmarker overrides the latch (§4.1)
    if (d.attacker === "P") {
      st.hmT = t; st.hmKind = "kill";
      st.bannerT = t;
      bannerN.textContent = "ELIMINATED — " + nameOf(d.victim).toUpperCase();
    }
    // killfeed row (display names — R4)
    const kName = nameOf(d.attacker), vName = nameOf(d.victim);
    const wid = d.attacker === "P"
      ? (st.lastHitWeapon[d.victim] || sim.state.player.weapon.id)
      : botWeaponId(d.attacker);
    // shift rows up, newest last
    let slot = null;
    for (const r of feedRows) if (!r.live) { slot = r; break; }
    if (!slot) { // evict oldest
      slot = feedRows[0];
      for (const r of feedRows) if (r.t < slot.t) slot = r;
    }
    slot.live = true; slot.t = t;
    slot.el.innerHTML =
      `<span class="${d.attacker === "P" ? "me" : ""}">${esc(kName)}</span>` +
      weaponGlyphSvg(wClass(wid)) +
      `<span class="${d.victim === "P" ? "me" : ""}">${esc(vName)}</span>`;
    st.tallies.killfeed++;
    reflowFeed();
  }

  function onObjective(d) {
    if (!d) return;
    st.objToastT = simNow();
    objT.textContent = d.state === "done" ? "OBJECTIVE COMPLETE" : "NEW OBJECTIVE";
    objL.textContent = d.label || d.id;
  }

  function onReload(d) {
    if (!d || d.who !== "P") return;
    if (d.phase === "start") st.reloadDur = d.duration || 0;
    else st.reloadDur = 0; // done or canceled — spinner clears
  }

  function onEmpty(d) { if (d && d.who === "P") st.dryT = simNow(); }

  function onGrenade(d) {
    if (!d) return;
    if (d.who === "P") return; // warning is for ENEMY frags (§5.9 telegraph)
    if (d.phase === "detonate") { st.nade = null; return; }
    st.nade = { pos: d.pos.slice() };
  }

  function onExplosion(d) {
    if (!d) return;
    const sim = ctx.sim(); if (!sim) return;
    const p = sim.state.player.pos;
    const dist = Math.hypot(d.pos[0] - p[0], d.pos[2] - p[2]);
    if (dist <= 8) st.flashT = simNow();
    if (st.nade) st.nade = null;
  }

  function onMissionStart() {
    resetTransient();
    // A fresh mission must never start frozen behind a stale pause overlay
    // (bridge.clear() dropped pause's visibility hooks; close it here).
    if (shell.pause && shell.pause.closeSilent) shell.pause.closeSilent();
  }

  function onMissionEnd(d) {
    showDebrief(d && d.result === "won", (d && d.stats) || null);
  }

  function nameOf(who) {
    if (who === "P" || who == null) return callsign;
    const sim = ctx.sim();
    const b = sim && sim.state.bots.find((b) => b.id === who);
    return b ? archLabel(b.archetype) : "HOSTILE";
  }
  function botWeaponId(who) {
    const sim = ctx.sim();
    const b = sim && sim.state.bots.find((b) => b.id === who);
    return b ? b.weapon.id : "warden";
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function reflowFeed() {
    // stack live rows: oldest first (top), newest last
    const live = feedRows.filter((r) => r.live).sort((a, b) => a.t - b.t);
    let i = 0;
    for (const r of live) { r.el.style.order = String(i++); }
    for (const r of feedRows) killfeed.appendChild(r.el); // order via DOM re-append
    for (const r of live) killfeed.appendChild(r.el);
  }

  // ------------------------------------------------------------------ debrief
  function showDebrief(won, stats) {
    st.debriefOpen = true;
    dbTitle.textContent = won ? "MISSION COMPLETE" : "MISSION FAILED";
    dbTitle.classList.toggle("lost", !won);
    dbSub.textContent = won
      ? "CINDERLOCK secured. Extraction confirmed — good effect on target."
      : "Raven 2-1 is combat ineffective. CINDERLOCK remains with Vektor Ancile.";
    const sim = ctx.sim();
    const c = stats || (sim ? sim.state.counters : {});
    const acc = c.shotsFired ? Math.round((c.shotsHit / c.shotsFired) * 100) : 0;
    const time = sim ? sim.state.time : 0;
    const mm = Math.floor(time / 60), ss = Math.floor(time % 60);
    const rows = [
      ["Eliminations", c.kills ?? 0], ["Headshots", c.headshots ?? 0],
      ["Accuracy", acc + "%"], ["Damage dealt", Math.round(c.damageDealt ?? 0)],
      ["Damage taken", Math.round(c.damageTaken ?? 0)], ["Deaths", c.deaths ?? 0],
      ["Mission time", `${mm}:${String(ss).padStart(2, "0")}`],
    ];
    dbGrid.innerHTML = rows.map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join("");
    debrief.style.display = "block";
    // hotkey gate: nothing fires behind the report
    ctx.input.enabled = false;
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* no-op */ }
    if (shell.pause && shell.pause.closeSilent) shell.pause.closeSilent();
  }
  function hideDebrief() { st.debriefOpen = false; debrief.style.display = "none"; }

  debrief.addEventListener("click", (e) => {
    const a = e.target && e.target.getAttribute && e.target.getAttribute("data-a");
    if (!a) return;
    hideDebrief();
    if (a === "redeploy") {
      Promise.resolve(ctx.startMission ? ctx.startMission({}) : null)
        .catch((err) => console.error("[hud] redeploy failed:", err));
    } else {
      hud.hide();
      if (shell.menu) shell.menu.show("title");
    }
  });

  // ------------------------------------------------------------------ update
  function update(dt) {
    const sim = ctx.sim();
    // debrief lives outside show/hide (mission over ⇒ hud may be hidden)
    if (!sim) return;
    const visible = root.style.display !== "none";
    if (!visible) return;
    const S = sim.state, p = S.player;
    const t = S.time;
    const vh = window.innerHeight || 1080;

    // ---- crosshair: THE live effectiveSpread (§2.5 shared model, §4.6 px map)
    const weapon = W[p.weapon.id];
    let crossAlpha = 0.9;
    if (weapon) {
      const spread = effectiveSpread(weapon, playerSpreadState(sim));
      const fovRad = (ctx.camera ? ctx.camera.fov : 74) * Math.PI / 180;
      let gap = Math.tan(spread) / Math.tan(fovRad / 2) * (vh / 2);
      gap = Math.min(240, Math.max(2.5, gap));
      if (Math.abs(gap - st.lastGap) > 0.2) {
        st.lastGap = gap;
        const g = gap.toFixed(1);
        xT.style.transform = `translate(0,${-(+g + 7)}px)`;
        xB.style.transform = `translate(0,${g}px)`;
        xL.style.transform = `translate(${-(+g + 7)}px,0)`;
        xR.style.transform = `translate(${g}px,0)`;
      }
    }
    // ADS: crosshair fades out entirely (§4.6); hidden while dead too
    crossAlpha = 0.9 * (1 - (p.weapon.adsT || 0));
    if (!p.alive) crossAlpha = 0;
    if (Math.abs(crossAlpha - st.lastCrossA) > 0.02) {
      st.lastCrossA = crossAlpha;
      cross.style.opacity = crossAlpha.toFixed(2);
    }

    // ---- reload spinner (matches reloadS exactly — progress from sim stateT)
    if (p.weapon.state === "reloading" && st.reloadDur > 0) {
      const prog = Math.min(1, p.weapon.stateT / st.reloadDur);
      reloadEl.style.opacity = "0.9";
      ringP.style.strokeDashoffset = (RING_C * (1 - prog)).toFixed(1);
    } else if (reloadEl.style.opacity !== "0") {
      reloadEl.style.opacity = "0";
    }
    const dryAge = t - st.dryT;
    dryEl.style.opacity = dryAge >= 0 && dryAge < 0.3 ? String(0.9 * (1 - dryAge / 0.3)) : "0";

    // ---- hitmarker (§4.1 — sim-time driven, deterministic)
    const hmAge = t - st.hmT;
    const hmLife = st.hmKind === "kill" ? 0.32 : 0.22;
    if (hmAge >= 0 && hmAge < hmLife) {
      const spawn = st.hmKind === "kill" ? 1.35 : 1.15;
      const scale = 1 + (spawn - 1) * Math.max(0, 1 - hmAge / 0.06);
      const alpha = hmAge < hmLife - 0.06 ? 0.9 : 0.9 * (hmLife - hmAge) / 0.06;
      hm.style.opacity = alpha.toFixed(2);
      hm.style.transform = `scale(${scale.toFixed(3)})`;
      hm.className = st.hmKind === "kill" ? "kill" : st.hmKind === "head" ? "head" : "";
      const armLen = st.hmKind === "head" ? 8.4 : 7; // headshot +20% (§4.1)
      for (const a of hmArms) a.style.height = armLen + "px";
    } else if (hm.style.opacity !== "0") hm.style.opacity = "0";

    // ---- threat arcs (§4.3): live-update 200 ms, then frozen; fade 600 ms
    for (const a of arcs) {
      if (!a.live) { if (a.el.style.opacity !== "0") a.el.style.opacity = "0"; continue; }
      const age = t - a.t;
      if (age > 0.8) { a.live = false; a.el.style.opacity = "0"; continue; }
      if (age < 0.2 && a.dir) a.deg = relDegDir(sim, a.dir);
      const alpha = 0.85 * (1 - Math.max(0, age - 0.2) / 0.6);
      a.el.style.opacity = alpha.toFixed(2);
      a.el.style.transform = `rotate(${a.deg.toFixed(1)}deg)`;
    }

    // ---- grenade warning (§5.9: icon + direction arrow within 6 m)
    if (st.nade) {
      const d = Math.hypot(st.nade.pos[0] - p.pos[0], st.nade.pos[2] - p.pos[2]);
      if (d <= 6) {
        nadeWarn.style.opacity = "0.95";
        nadeRot.style.transform = `rotate(${relDegTo(sim, st.nade.pos).toFixed(1)}deg)`;
      } else nadeWarn.style.opacity = "0";
    } else if (nadeWarn.style.opacity !== "0") nadeWarn.style.opacity = "0";

    // ---- ammo block
    const mag = p.weapon.mag, res = p.weapon.reserve;
    const wid = p.weapon.id;
    if (wid + (weapon ? "" : "?") !== st.lastWname) {
      st.lastWname = wid + (weapon ? "" : "?");
      amName.textContent = wName(wid);
      amMode.textContent = weapon ? (weapon.auto ? "AUTO" : "SEMI") : "";
    }
    if (mag !== st.lastMag) {
      st.lastMag = mag;
      amMag.textContent = String(mag);
      const magSize = weapon ? weapon.mag : 30;
      const frac = magSize ? mag / magSize : 1;
      amMag.className = "a10-mag" + (frac <= 0.10 ? " crit" : frac <= 0.25 ? " low" : "");
      amLow.style.visibility = frac < 0.25 ? "visible" : "hidden";
    }
    if (res !== st.lastRes) { st.lastRes = res; amRes.textContent = "/ " + res; }
    const nades = p.grenades | 0;
    if (nades !== st.lastNades) {
      st.lastNades = nades;
      amNades.innerHTML = `FRAG <span${nades < 1 ? ' class="off"' : ""}>●</span> <span${nades < 2 ? ' class="off"' : ""}>●</span>`;
    }

    // ---- compass tape + pips + wedges
    const bearing = norm360(-p.yaw * DEG);
    if (Math.abs(norm180(bearing - st.lastBearing)) > 0.05) {
      st.lastBearing = bearing;
      tape.style.transform = `translateX(${(-bearing * PX_PER_DEG).toFixed(1)}px)`;
    }
    const cw = compass.clientWidth || 560;
    const halfDeg = (cw / 2) / PX_PER_DEG;
    // objective pips: active objectives with a resolvable world point
    let pi = 0;
    const objs = (content.mission && content.mission.objectives) || [];
    for (let i = 0; i < S.objectives.length && pi < pips.length; i++) {
      if (S.objectives[i].state !== "active") continue;
      const def = objs.find((o) => o.id === S.objectives[i].id);
      if (!def) continue;
      const pos = def.pos || (def.node && sim.colliders.nodes[def.node]);
      if (!pos) continue;
      const rel = relDegTo(sim, pos);
      const clamped = Math.max(-halfDeg, Math.min(halfDeg, rel));
      const x = cw / 2 + clamped * PX_PER_DEG;
      const dist = Math.round(Math.hypot(pos[0] - p.pos[0], pos[2] - p.pos[2]));
      const pip = pips[pi++];
      pip.el.style.display = "block";
      if (Math.abs(x - pip.lastX) > 0.5) {
        pip.lastX = x;
        pip.el.style.left = x.toFixed(1) + "px";
        pip.el.style.opacity = Math.abs(rel) > halfDeg ? "0.55" : "1";
      }
      const txt = dist + "m";
      if (txt !== pip.lastTxt) { pip.lastTxt = txt; pip.dEl.textContent = txt; }
    }
    for (; pi < pips.length; pi++) if (pips[pi].el.style.display !== "none") pips[pi].el.style.display = "none";
    for (const w of wedges) {
      const age = t - w.t;
      if (age < 0 || age > 4) { if (w.el.style.opacity !== "0") w.el.style.opacity = "0"; continue; }
      const rel = norm180(w.bearing - bearing);
      if (Math.abs(rel) > halfDeg) { w.el.style.opacity = "0"; continue; }
      w.el.style.left = (cw / 2 + rel * PX_PER_DEG).toFixed(1) + "px";
      w.el.style.opacity = (0.8 * (1 - age / 4)).toFixed(2);
    }

    // ---- objective toast (amber underline sweep, never a blocking banner)
    const oAge = t - st.objToastT;
    if (oAge >= 0 && oAge < 3.2) {
      objEl.style.opacity = oAge < 2.6 ? "1" : String((3.2 - oAge) / 0.6);
      objU.style.width = `${Math.min(1, oAge / 0.45) * 100}%`;
    } else if (objEl.style.opacity !== "0") objEl.style.opacity = "0";

    // ---- kill banner (§4.4: 1.4 s)
    const bAge = t - st.bannerT;
    banner.style.opacity = bAge >= 0 && bAge < 1.4 ? (bAge < 1.1 ? "0.95" : String(0.95 * (1.4 - bAge) / 0.3)) : "0";

    // ---- killfeed TTL (6 s, §4.4)
    for (const r of feedRows) {
      if (!r.live) continue;
      const age = t - r.t;
      if (age > 6) { r.live = false; r.el.style.opacity = "0"; continue; }
      r.el.style.opacity = age > 5.4 ? String(0.95 * (6 - age) / 0.6) : "0.95";
    }

    // ---- subtitles (mission radio — private drains until the A0 amendment)
    drainRadioInto(sim);
    if (st.subQ.length && t >= st.subUntil) {
      const s = st.subQ.shift();
      subSp.textContent = s.speaker ? s.speaker + ":" : "";
      subLn.textContent = s.line || "";
      st.subUntil = t + Math.min(5.5, Math.max(2.4, (s.line || "").length * 0.055));
      st.subShown = true;
      subEl.style.opacity = "0.95";
    } else if (st.subShown && t >= st.subUntil && !st.subQ.length) {
      st.subShown = false;
      subEl.style.opacity = "0";
    }

    // ---- damage vignette (combat_spec §6 curve — never a health bar)
    let a = Math.pow(1 - p.hp / 100, 1.6) * 0.55;
    if (p.hp < 30) a += 0.12 * Math.sin(2 * Math.PI * 1.2 * t) * (p.hp > 0 ? 1 : 0);
    a = Math.max(0, Math.min(0.85, a));
    if (Math.abs(a - st.lastVig) > 0.005) {
      st.lastVig = a;
      vig.style.opacity = a.toFixed(3);
      // regen "inward wipe": the ring relaxes outward as hp returns
      vig.style.transform = `scale(${(1 + 0.18 * a).toFixed(3)})`;
    }
    desat.style.display = p.hp < 25 && p.alive ? "block" : "none";
    // directional bias (§4.3): red creeps 12% further in from the hit side
    const vdAge = t - st.vigDirT;
    if (vdAge >= 0 && vdAge < 0.5) {
      const rad = (st.vigDirDeg - 90) * Math.PI / 180;
      const bx = 50 + Math.cos(rad) * 46, by = 50 + Math.sin(rad) * 46;
      vigDir.style.background =
        `radial-gradient(circle at ${bx.toFixed(0)}% ${by.toFixed(0)}%,rgba(230,30,30,.34),rgba(230,30,30,0) 42%)`;
      vigDir.style.opacity = String((1 - vdAge / 0.5) * (0.12 + a));
    } else if (vigDir.style.opacity !== "0") vigDir.style.opacity = "0";

    // ---- explosion tinnitus flash (§6: near-explosion ring; visual half)
    const fAge = t - st.flashT;
    flash.style.opacity = fAge >= 0 && fAge < 0.35 ? String(0.8 * (1 - fAge / 0.35)) : "0";

    // ---- death fade (R22: 1.2 s fade → checkpoint; we ride player.alive)
    const target = p.alive ? 0 : 0.9;
    let f = st.lastFade < 0 ? 0 : st.lastFade;
    f += (target - f) * Math.min(1, dt * (p.alive ? 3 : 4.5));
    if (Math.abs(f - st.lastFade) > 0.004) { st.lastFade = f; fade.style.opacity = f.toFixed(3); }

    // ---- Corvus scope overlay (§4.6 — ADS hides crosshair, scope is the reticle)
    const scoped = wid === "corvus" && p.weapon.ads && (p.weapon.adsT || 0) >= 0.95 && p.alive;
    if (scoped) {
      if (scope.style.display !== "block") scope.style.display = "block";
      // cosmetic micro-drift (visual echo of §2.6 sway; aim itself is sim truth)
      const dx = Math.sin(t * 2 * Math.PI * 0.9) * 2.2 + Math.sin(t * 2 * Math.PI * 1.7) * 1.3;
      const dy = Math.cos(t * 2 * Math.PI * 1.1) * 1.8 + Math.sin(t * 2 * Math.PI * 0.7) * 1.2;
      scopeDrift.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px)`;
    } else if (scope.style.display !== "none") scope.style.display = "none";
  }

  function drainRadioInto(sim) {
    // Pending the A0 freeze amendment (radio/setpiece events), radio lines sit
    // on PRIVATE mission drains. boot's started mission instance is not in ctx
    // yet (needsElsewhere → A0: expose `mission()` on ctx, or adopt A1's
    // sim.mission simplification); both candidate drains are polled so the
    // subtitles go live the moment either wiring lands.
    const missions = [];
    if (typeof ctx.mission === "function") missions.push(ctx.mission());
    if (sim.mission) missions.push(sim.mission);
    for (const m of missions) {
      if (!m || typeof m.drainRadio !== "function") continue;
      const q = m.drainRadio();
      for (const r of q) {
        if (st.subQ.length >= 6) break;
        st.subQ.push(r);
        // combat_spec §5.10 honesty rule: subtitle + radio squelch, never a
        // fake recorded-VO claim (A9 needsElsewhere — squelch per line).
        const F = typeof window !== "undefined" && window.__FPS__;
        if (F && F.audio && typeof F.audio.radioSquelch === "function") {
          try { F.audio.radioSquelch(); } catch (e) { /* audio not unlocked yet */ }
        }
      }
    }
  }

  // ------------------------------------------------------------------ api
  const hud = {
    attach(bridge) {
      bridge.register("shot", onShot);
      bridge.register("hurt", onHurt);
      bridge.register("death", onDeath);
      bridge.register("objective", onObjective);
      bridge.register("reload", onReload);
      bridge.register("empty", onEmpty);
      bridge.register("grenade", onGrenade);
      bridge.register("explosion", onExplosion);
      bridge.register("mission:start", onMissionStart);
      bridge.register("mission:end", onMissionEnd);
    },
    update,
    show() {
      root.style.display = "block";
      // the page controls hint reads as clutter over a live mission HUD;
      // restore it when the HUD hides (menu/title state).
      const hint = document.getElementById("hint");
      if (hint) { st.hintWasShown = hint.classList.contains("show"); hint.classList.remove("show"); }
    },
    hide() {
      root.style.display = "none";
      const hint = document.getElementById("hint");
      if (hint && st.hintWasShown) hint.classList.add("show");
    },
    // ---- private additions (freeze permits)
    tallies() { return { hitmarkers: st.tallies.hitmarkers, killfeed: st.tallies.killfeed }; },
    // v2.2: playprobe's parity hook (A11 needsElsewhere) — killfeedRows and
    // ammoShown mirror what the DOM currently displays.
    counts() {
      return {
        hitmarkers: st.tallies.hitmarkers,
        killfeedRows: st.tallies.killfeed,
        ammoShown: typeof st.lastMag === "number" && st.lastMag >= 0 ? st.lastMag : null,
      };
    },
    get debriefOpen() { return st.debriefOpen; },
    _root: root,
  };

  shell.hud = hud;
  return hud;
}
