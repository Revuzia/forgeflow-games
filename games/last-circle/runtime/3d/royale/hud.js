import * as THREE from "three";

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
// Neutral starting skill rating: mid-low, so a brand-new account is challenged
// but not slaughtered, and converges from there within a few matches. Declared
// at module top because loadProgress()/mergeProgressRecords() both read it.
const SKILL_NEUTRAL = 0.35;


let R = {};            // element registry
let K = null;
let feedTimer = [];
// Backing-store scale for the 2D canvases (minimap, compass, big map). They used
// to be sized 1:1 with their CSS box while the WebGL renderer honoured DPR and
// the locker preview supersampled 2x, so the HUD was the blurriest thing on a
// HiDPI screen. Capped at 2 — past that it is fill-rate for nothing.
const HUD_DPR = Math.min((typeof window !== "undefined" && window.devicePixelRatio) || 1, 2);

// ── view size (contract C1) ──────────────────────────────────────────────────
// kernel.viewW/viewH (L3) are the ResizeObserver-cached CSS size. Until that
// lands, hud keeps its own RO cache. stepIndicators read the canvas's
// clientWidth/clientHeight EVERY frame (hud.js:2367) — a forced layout any time
// the HUD had written text since the last frame.
let _vw = 0, _vh = 0, _vro = null;
function viewSize(W) {
  const k = W.kernel;
  if (k && k.viewW > 0 && k.viewH > 0) { _vw = k.viewW; _vh = k.viewH; return; }
  if (!_vro) {
    const el = k.renderer.domElement;
    _vw = el.clientWidth || window.innerWidth; _vh = el.clientHeight || window.innerHeight;   // once
    if (typeof ResizeObserver !== "undefined") {
      _vro = new ResizeObserver((ents) => {
        const r = ents[ents.length - 1].contentRect;
        if (r.width > 0 && r.height > 0) { _vw = r.width; _vh = r.height; }
      });
      _vro.observe(el);
    } else _vro = true;
  }
  if (_vro === true) { const el = k.renderer.domElement; _vw = el.clientWidth; _vh = el.clientHeight; }
}

// ── announcement band geometry ───────────────────────────────────────────────
// The owner-approved top stack does not move: compass (top 4), storm row
// (top 56), then the LVL chip + quest card stack at META_TOP. The big banner
// (DEPLOY / ELIMINATED / LAST ONE STANDING / LEVEL) used to be pinned at top 14%
// — 101 px at 720p, exactly the LVL chip row — so it painted over the chip and
// the quest card in every match (feel-juice-ui G4). It now starts BAND_GAP below
// the stack's measured bottom; storm and pickup lines sit under the band; the
// death card and the indicator ring keep clear of it.
const META_TOP = 94;         // px — the LVL chip + quest card stack
const META_RESERVE = 74;     // chip ~22 + gap 6 + card ~46: held before the card first shows
const BAND_GAP = 12;
const BAND_H = 70;           // banner title (34 px Orbitron) + subtitle
const IND_HALF = 24;         // half-height of the biggest ring cue (34 px damage glyph)
// A phone on its side (touch, <= 520 px tall: TOUCH_CSS's short rules) runs a
// compact top stack — meta at 86 with the quest card off, an 18 px banner
// title — so the band starts right under the LVL row and ends above the
// reticle (375 px tall: band 116..155, reticle from ~160).
const PH_META_TOP = 86, PH_META_RESERVE = 24, PH_BAND_GAP = 8, PH_BAND_H = 41;
function phoneShort() {
  if (!touchOn) return false;
  if (_tW && _tW.kernel) viewSize(_tW);        // C1 cache (no layout read)
  return _vh > 0 && _vh <= 520;
}
function bandH() { return phoneShort() ? PH_BAND_H : BAND_H; }
function bandTop() {
  if (phoneShort()) return Math.max(PH_META_TOP + Math.min(R._metaH || 0, PH_META_RESERVE), PH_META_TOP + PH_META_RESERVE) + PH_BAND_GAP;
  return Math.max(META_TOP + (R._metaH || 0), META_TOP + META_RESERVE) + BAND_GAP;
}
// The death banner takes the announcement band's place while it is up (a dead
// player's announcements are dropped - see announce()), so it sits AT bandTop and
// the storm / pickup lines hang off its measured height instead of the band's.
const DEATH_H0 = 90;         // px - the banner's height until its ResizeObserver reports
function placeBand(force) {
  if (!R.annWrap) return;
  const t = Math.round(bandTop()), bh = bandH();
  const dead = !!R.deathBox, dh = dead ? Math.round(R._deathH || DEATH_H0) : 0;
  const key = t + ":" + dh;
  if (R._bandKey === key && !force) return;
  R._bandKey = key; R._bandTop = t;
  R.annWrap.style.top = t + "px";
  if (dead) R.deathBox.style.top = t + "px";
  const under = dead ? dh + 8 : bh + 6;
  if (R.stormMsg) R.stormMsg.style.top = (t + under) + "px";
  if (R.pickupMsg) R.pickupMsg.style.top = (t + under + 34) + "px";
  // LC-43 HUD scale: the band hangs off the (scaled) top stack, so it scales about the screen's top edge with it
  const hs = R._hs || 1;
  hsEl(R.annWrap, hs, "0px", "-" + t + "px");
  if (dead) hsEl(R.deathBox, hs, "0px", "-" + t + "px");
  hsEl(R.stormMsg, hs, "0px", "-" + (t + under) + "px");
  hsEl(R.pickupMsg, hs, "0px", "-" + (t + under + 34) + "px");
}

const css = (el, o) => { Object.assign(el.style, o); return el; };
function h(tag, styles, text, parent) {
  const el = document.createElement(tag);
  if (styles) css(el, styles);
  if (text != null) el.textContent = text;
  if (parent) parent.appendChild(el);
  return el;
}
const FONT = "'Segoe UI', system-ui, -apple-system, sans-serif";
const FONT_DISPLAY = "'Segoe UI', system-ui, sans-serif";
// Font floor for touch (PLAN L7 phone gate: no text under 12 px on a phone).
// Small labels are written as max(Npx, var(--lc-minfs)): on a desktop the
// variable is unset, so every label keeps its designed size; touch mode sets
// --lc-minfs: 12px on <html> (see TOUCH_CSS), and the same inline style lifts
// to 12 px with no re-render and no layout pass.
const FS = (n) => "max(" + n + "px, var(--lc-minfs, 0px))";
// AAA glass panels — translucent so the live Three.js world reads through
const PANEL = {
  background: "linear-gradient(165deg, rgba(12,24,44,0.72) 0%, rgba(8,16,30,0.82) 100%)",
  border: "1px solid rgba(140,200,255,0.28)",
  borderRadius: "16px",
  boxShadow: "0 12px 48px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 1px rgba(0,0,0,0.25)",
  backdropFilter: "blur(18px) saturate(1.35)",
  WebkitBackdropFilter: "blur(18px) saturate(1.35)",
};
const PANEL_HOT = Object.assign({}, PANEL, {
  border: "1px solid rgba(120,200,255,0.55)",
  boxShadow: "0 12px 48px rgba(0,0,0,0.55), 0 0 32px rgba(60,150,255,0.22), inset 0 1px 0 rgba(255,255,255,0.14)",
});
const BTN = {
  padding: "12px 26px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.08)",
  cursor: "pointer", fontWeight: "800", fontSize: "15px", fontFamily: FONT,
  letterSpacing: "1.2px", textTransform: "uppercase", transition: "transform .12s ease, box-shadow .15s ease, filter .12s",
};
function ensureAAAStyles() {
  if (document.getElementById("lc-aaa-css")) return;
  if (!document.getElementById("lc-font-link")) {
    const link = document.createElement("link");
    link.id = "lc-font-link";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800;900&family=Rajdhani:wght@500;600;700&display=swap";
    document.head.appendChild(link);
  }
  const st = document.createElement("style");
  st.id = "lc-aaa-css";
  st.textContent = `
    @keyframes lcBob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-10px) } }
    @keyframes lcPulse { 0%,100% { opacity: .55 } 50% { opacity: 1 } }
    @keyframes lcShimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }
    @keyframes lcTitleIn { 0% { opacity:0; letter-spacing: 28px; filter: blur(8px) } 100% { opacity:1; letter-spacing: 10px; filter: blur(0) } }
    @keyframes lcPanelIn { 0% { opacity:0; transform: translateY(18px) scale(.97) } 100% { opacity:1; transform: none } }
    @keyframes lcGlow { 0%,100% { box-shadow: 0 0 24px rgba(60,150,255,.35), 0 8px 28px rgba(0,0,0,.45) } 50% { box-shadow: 0 0 40px rgba(90,180,255,.55), 0 8px 28px rgba(0,0,0,.45) } }
    @keyframes lcScan { 0% { transform: translateY(-100%) } 100% { transform: translateY(100%) } }
    .lc-btn-play:hover { transform: translateY(-2px) scale(1.02); filter: brightness(1.08); }
    .lc-btn-play:active { transform: translateY(1px) scale(.99); }
    .lc-mode-card { transition: transform .15s ease, border-color .15s, box-shadow .15s; }
    .lc-mode-card:hover { transform: translateX(4px); border-color: rgba(140,200,255,0.45) !important; }
    .lc-mode-card.sel { transform: translateX(8px); }
    .lc-glass-scan::after {
      content:''; position:absolute; inset:0; pointer-events:none; opacity:.06;
      background: linear-gradient(180deg, transparent, rgba(180,220,255,.4), transparent);
      animation: lcScan 7s linear infinite;
    }
  `;
  document.head.appendChild(st);
}

// ═══ HUD SKIN (P1.9 / P4.3) ══════════════════════════════════════════════════
// The in-match widgets are classed DOM now (one stylesheet, injected once) so the
// phone rules in TOUCH_CSS can reach every part of them. Position and size stay
// INLINE on the signed-off boxes (bottomLeft left 18 / bottom 16 / width 300; the
// slot column right 18 / bottom 54; the storm row top 56) - only what is INSIDE
// them is restyled. No backdrop-filter on any in-match panel: the 3D canvas
// behind them changes every frame, and a blur there is paid every frame.
// Icons are inline SVG (currentColor), never emoji. Static strings, no data in them.
const SVG = (vb, body, extra) => '<svg viewBox="' + vb + '" width="1em" height="1em" aria-hidden="true" focusable="false"' + (extra || "") + '>' + body + '</svg>';
const IC = {
  // the closing circle: a dashed ring around a filled core
  storm: SVG("0 0 24 24", '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-dasharray="4.2 3"/><circle cx="12" cy="12" r="4" fill="currentColor"/>'),
  alive: SVG("0 0 24 24", '<circle cx="9" cy="8" r="3.4" fill="currentColor"/><path fill="currentColor" d="M2.5 20c0-3.8 2.9-6.5 6.5-6.5s6.5 2.7 6.5 6.5z"/><circle cx="17.3" cy="9" r="2.7" fill="currentColor" opacity=".65"/><path fill="currentColor" opacity=".65" d="M16.2 13.7c3.1 0 5.3 2.2 5.3 5.3h-4.4c0-2-.5-3.8-.9-5.3z"/>'),
  skull: SVG("0 0 24 24", '<path fill="currentColor" fill-rule="evenodd" d="M12 2.8c-4.5 0-7.7 3.1-7.7 7.4 0 2.5 1.1 4.1 2.6 5.1V19h2.4v-2h1.4v2h2.6v-2h1.4v2h2.4v-3.7c1.5-1 2.6-2.6 2.6-5.1 0-4.3-3.2-7.4-7.7-7.4zM8.9 8.6a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8zm6.2 0a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8z"/>'),
  shield: SVG("0 0 24 24", '<path fill="currentColor" d="M12 2.4l8 3v6.2c0 4.7-3.2 8.3-8 10-4.8-1.7-8-5.3-8-10V5.4z"/>'),
  shieldO: SVG("0 0 24 24", '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" d="M12 3.2l7 2.6v5.8c0 4.1-2.8 7.2-7 8.8-4.2-1.6-7-4.7-7-8.8V5.8z"/>'),
  bandage: SVG("0 0 24 24", '<g transform="rotate(-42 12 12)"><rect x="1.5" y="8" width="21" height="8" rx="4" fill="currentColor"/><rect x="8.6" y="8" width="6.8" height="8" fill="#fff" opacity=".4"/><circle cx="11" cy="10.6" r=".9" fill="#0b1424"/><circle cx="13" cy="13.4" r=".9" fill="#0b1424"/></g>'),
  medkit: SVG("0 0 24 24", '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M9 7V5.6c0-.9.7-1.6 1.6-1.6h2.8c.9 0 1.6.7 1.6 1.6V7"/><path fill="currentColor" fill-rule="evenodd" d="M5.4 7h13.2A2.4 2.4 0 0 1 21 9.4v8.2a2.4 2.4 0 0 1-2.4 2.4H5.4A2.4 2.4 0 0 1 3 17.6V9.4A2.4 2.4 0 0 1 5.4 7zM11 10.2v2.3H8.7v1.9H11v2.3h2v-2.3h2.3v-1.9H13v-2.3z"/>'),
  rerun: SVG("0 0 24 24", '<path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4.6h-4.6"/>'),
  next: SVG("0 0 24 24", '<path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" d="M4.5 12h14M13 6.5l5.5 5.5-5.5 5.5"/>'),
  // LC-14: the frag - a round body, a lever and a pin ring (the item is built dark in P1; these are its HUD entries)
  // C-SMOKE: the smoke - a canister with a cap, a lever and a vented band
  smoke: SVG("0 0 24 24", '<rect x="7" y="7.4" width="10" height="13.4" rx="2" fill="currentColor"/><rect x="8.6" y="4.2" width="6.8" height="3.6" rx="1" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M15.4 5.2c2.2-.2 3.6.7 4 2.4"/><path fill="none" stroke="#0b1424" stroke-width="1.3" opacity=".55" d="M7.6 11.6h8.8M7.6 14.4h8.8"/>'),
  frag: SVG("0 0 24 24", '<path fill="currentColor" d="M12 7.6c3.7 0 6.4 2.9 6.4 6.6S15.7 21 12 21s-6.4-3.1-6.4-6.8 2.7-6.6 6.4-6.6z"/><rect x="9.6" y="4.6" width="4.8" height="3.4" rx="1" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M14.4 5.6c2.4-.3 4.1.6 4.6 2.6"/><circle cx="7.6" cy="5.4" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path fill="none" stroke="#0b1424" stroke-width="1.1" opacity=".55" d="M7.4 13h9.2M12 9v11"/>'),
};
/** The four consumables, in the order the vitals row shows them. */
const CON_ORDER = ["bandage", "medkit", "mini_shield", "big_shield"];
// The vitals row shows the four heals (CON_ORDER); the frag (LC-14, P1-A's consumable with `throws`) has its icon, colour and name here so the
// slot row, the pickup line and the interact prompt name it properly the day its loot weight goes above 0 (P2-D) - it never joins the heal row.
const CON_ICON = { bandage: IC.bandage, medkit: IC.medkit, mini_shield: IC.shieldO, big_shield: IC.shield, frag: IC.frag, smoke: IC.smoke };
const CON_COLOR = { bandage: "#e8dcc2", medkit: "#ff7b6b", mini_shield: "#7cc4ff", big_shield: "#4aa8ff", frag: "#a9c26a", smoke: "#c7d2de" };
const CON_NAME = { bandage: "BANDAGE", medkit: "MEDKIT", mini_shield: "MINI SHIELD", big_shield: "BIG SHIELD", frag: "FRAG GRENADE", smoke: "SMOKE GRENADE" };
// LC-14 / C-SMOKE: the throwables show at the end of the vitals' consumable row, only while you carry one
const THR_ORDER = ["frag", "smoke"];
/** A consumable you THROW (the frag, the smoke, or any consumable lane sim marks `throws`), by item id or held-weapon id. */
function isThrowable(wid) {
  if (!wid) return false;
  const id = String(wid).startsWith("consumable:") ? String(wid).slice(11) : String(wid);
  if (id === "frag" || id === "smoke") return true;
  const c = K && K.CONSUMABLES && K.CONSUMABLES[id];
  return !!(c && c.throws);
}
const AMMO_NAME = { light: "LIGHT AMMO", medium: "MEDIUM AMMO", shells: "SHELLS", heavy: "HEAVY AMMO", grenades: "GRENADES" };
const MAG_SEGS = 10;         // pooled mag-bar segments (a 30-round mag is 10 x 3 rounds)

function ensureHudStyles() {
  if (typeof document === "undefined" || document.getElementById("lc-hud-css")) return;
  const MINFS = (n) => "max(" + n + "px, var(--lc-minfs, 0px))";
  const st = document.createElement("style");
  st.id = "lc-hud-css";
  st.textContent = `
.lc-gl { background: linear-gradient(165deg, rgba(14,25,46,.80) 0%, rgba(7,14,28,.88) 100%); border: 1px solid rgba(140,200,255,.20);
  box-shadow: 0 6px 22px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.07); box-sizing: border-box; }
.lc-gl svg, .lc-ic svg { display: block; }
/* segmented bars: every segment is a track holding a fill that only ever changes transform */
.lc-sg { flex: 1; height: 8px; border-radius: 2px; background: rgba(255,255,255,.14); overflow: hidden; }
.lc-sf { display: block; width: 100%; height: 100%; background: var(--lc-c, #fff); transform: scaleX(0); transform-origin: 0 50%; transition: transform .15s ease-out; }
/* ---- vitals (bottom-left) ---- */
.lc-vit { padding: 9px 12px 8px; border-radius: 14px; font-family: ${FONT}; }
.lc-vtop { display: flex; align-items: center; gap: 12px; }
.lc-hpn { display: flex; align-items: baseline; gap: 3px; min-width: 74px; font-variant-numeric: tabular-nums; }
.lc-hpn b { font-family: ${FONT}; font-weight: 800; font-size: 36px; line-height: 1; letter-spacing: -1px; color: #fff; text-shadow: 0 2px 8px rgba(0,0,0,.65); }
.lc-hpn i { font-family: ${FONT}; font-weight: 800; font-style: normal; font-size: ${MINFS(11)}; line-height: 1; letter-spacing: 1.2px; color: rgba(255,255,255,.62); }
.lc-hpn.lo b { color: #ffd166; } .lc-hpn.cr b { color: #ff6a58; }
.lc-vbars { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.lc-vb { display: flex; align-items: center; gap: 6px; }
.lc-vs { flex: 1; display: flex; gap: 3px; }
.lc-vb.sh { --lc-c: #4aa8ff; } .lc-vb.hp { --lc-c: #f3f6fb; } .lc-vb.hp.lo { --lc-c: #ffd166; } .lc-vb.hp.cr { --lc-c: #ff5544; }
.lc-vb.hp.cr .lc-sf { animation: lcPulse .55s ease-in-out infinite; }
.lc-flashred .lc-vb.hp.cr .lc-sf { animation: none; }
.lc-vn { width: 22px; flex: none; text-align: right; font-family: ${FONT}; font-weight: 800; font-size: ${MINFS(11)}; line-height: 1; color: #8ec8ff; font-variant-numeric: tabular-nums; }
.lc-cons { display: flex; gap: 12px; margin-top: 7px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,.09); }
.lc-con { display: flex; align-items: center; gap: 4px; font-family: ${FONT}; font-weight: 800; font-size: ${MINFS(12)}; line-height: 14px; color: #eaf2ff; }
.lc-con.z { opacity: .34; }
.lc-con .ci { display: flex; font-size: 15px; }
.lc-kc { font-family: ${FONT}; font-weight: 800; font-size: ${MINFS(10)}; line-height: 13px; padding: 1px 5px; border-radius: 4px; border: 1px solid rgba(255,255,255,.28); background: rgba(255,255,255,.08); color: #dfe9f7; }
/* ---- weapon card (bottom-right, above the slot row) ---- */
/* 316 wide: "GRENADE LAUNCHER" + COMMON + SEMI measured 287 px in a 278 px row at 304 (2026-10-12) */
.lc-wcard { width: 316px; padding: 8px 12px 9px; border-radius: 14px; display: flex; flex-direction: column; gap: 4px; font-family: ${FONT}; }
.lc-wrow1 { display: flex; align-items: center; gap: 8px; white-space: nowrap; min-height: 18px; }
.lc-wname { font-family: ${FONT}; font-weight: 800; font-size: 13px; line-height: 16px; letter-spacing: .8px; text-transform: uppercase; text-shadow: 0 1px 3px rgba(0,0,0,.8); }
.lc-wtag { font-weight: 800; font-size: ${MINFS(10)}; line-height: 12px; letter-spacing: 1px; padding: 2px 6px; border-radius: 4px; border: 1px solid currentColor; text-transform: uppercase; }
.lc-wmode { margin-left: auto; font-weight: 800; font-size: ${MINFS(10)}; line-height: 12px; letter-spacing: 1px; padding: 2px 7px; border-radius: 4px; background: rgba(255,255,255,.10); border: 1px solid rgba(255,255,255,.24); color: #dfe9f7; }
.lc-wrow2 { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 36px; }
.lc-wsil { width: 104px; height: 36px; object-fit: contain; object-position: left center; opacity: .96; filter: drop-shadow(0 2px 3px rgba(0,0,0,.55)); }
.lc-ammo { font-family: ${FONT}; font-weight: 900; font-size: 30px; line-height: 36px; letter-spacing: .5px; color: #fff; font-variant-numeric: tabular-nums; text-shadow: 0 2px 6px rgba(0,0,0,.7); white-space: nowrap; }
.lc-ammo.sm { font-size: 20px; }
.lc-wrow3 { display: flex; align-items: center; gap: 9px; }
.lc-atype { font-weight: 800; font-size: ${MINFS(10)}; line-height: 12px; letter-spacing: 1.4px; color: rgba(255,255,255,.62); white-space: nowrap; }
.lc-mag { flex: 1; display: flex; gap: 2px; --lc-c: #f3f6fb; }
.lc-mag .lc-sg { height: 5px; }
/* ---- storm row (top centre, anchor unchanged) ---- */
.lc-storm { display: flex; align-items: center; gap: 12px; padding: 5px 16px; border-radius: 11px; white-space: nowrap; font-family: ${FONT}; }
.lc-storm > div { display: flex; align-items: center; gap: 6px; }
.lc-st-ic { font-size: 16px; color: #9fb6cc; }
.lc-st-t { font-weight: 800; font-size: 16px; line-height: 20px; min-width: 72px; font-variant-numeric: tabular-nums; }
.lc-st-c { font-weight: 700; font-size: 13px; line-height: 20px; color: #d9c8ff; }
.lc-sep { width: 1px; height: 18px; background: rgba(255,255,255,.22); }
.lc-st-a, .lc-st-k { font-weight: 800; font-size: 16px; line-height: 20px; font-variant-numeric: tabular-nums; }
.lc-st-a .ic, .lc-st-k .ic { display: flex; font-size: 15px; }
.lc-st-a .ic { color: #b79bff; } .lc-st-k .ic { color: #ffb0a0; opacity: .9; }
.lc-circ-s { display: none; }
html.lc-touch .lc-circ-l { display: none; } html.lc-touch .lc-circ-s { display: inline; }
/* ---- kill feed ---- */
.lc-fr { display: flex; align-items: center; gap: 7px; padding: 3px 10px; border-radius: 8px; font-family: ${FONT}; font-weight: 700; font-size: 12px; line-height: 16px; white-space: nowrap; background: rgba(8,14,28,.66); border: 1px solid rgba(140,200,255,.14); }
.lc-fr.me { color: #ffd54a; border-color: rgba(255,213,74,.65); background: rgba(40,30,6,.62); }
.lc-fr .dim { opacity: .62; }
.lc-fr .v { color: #ff9384; }
.lc-fr .w { height: 14px; width: auto; max-width: 46px; display: none; }
/* ---- death banner ---- */
/* max-width: the banner is centred, so it must end before the WIDEST kill feed starts (6 rows of long names + a
   silhouette measured 272 px, right 16): (272 + 16 + 12) x 2 = 600 px off the width. Measured 2026-10-12 with a 14-char killer
   name, 100 HP + 100 shield, Grenade Launcher, HEADSHOT, 1203 m: pill 528 px, recap pill 371 px, so the two share a row
   only from ~1720 px up; below that the recap wraps to a second row, and the metrics here keep that 2-row state <= 115 px
   (the first version was 130 px tall and 816 wide at 1280x720 and ran into the feed) */
.lc-death { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 8px 18px 9px; border-radius: 14px; width: max-content; max-width: max(320px, calc(100vw - 600px)); font-family: ${FONT}; text-align: center; }
.lc-d1 { display: flex; align-items: center; justify-content: center; gap: 14px; flex-wrap: wrap; }
.lc-dt { font-family: Orbitron, ${FONT_DISPLAY}; font-weight: 900; font-size: 22px; line-height: 28px; letter-spacing: 3px; color: #ff7a7a; text-shadow: 0 2px 10px rgba(0,0,0,.8); }
.lc-dn { font-weight: 800; font-size: 22px; line-height: 28px; color: #fff; font-variant-numeric: tabular-nums; }
.lc-dn small { font-size: ${MINFS(13)}; font-weight: 700; opacity: .65; line-height: 1; }
.lc-dbtn { font-family: ${FONT}; font-weight: 800; font-size: 12px; letter-spacing: 1.4px; text-transform: uppercase; padding: 5px 16px; border-radius: 999px; border: 1px solid rgba(255,255,255,.14); background: #57b0ff; color: #fff; cursor: pointer; }
.lc-dbtn:hover { filter: brightness(1.1); }
.lc-d2 { display: flex; align-items: center; justify-content: center; gap: 5px 12px; flex-wrap: wrap; max-width: 100%; }
.lc-dp { display: flex; align-items: center; gap: 8px; padding: 3px 12px; max-width: 100%; box-sizing: border-box; border-radius: 999px; background: rgba(5,10,20,.55); border: 1px solid rgba(140,200,255,.16); font-weight: 700; font-size: ${MINFS(13)}; line-height: 18px; white-space: nowrap; }
.lc-dp .lab { font-size: ${MINFS(10)}; letter-spacing: 1.4px; opacity: .6; text-transform: uppercase; }
.lc-dp b { font-weight: 800; color: #fff; min-width: 0; max-width: 190px; overflow: hidden; text-overflow: ellipsis; }
.lc-dp .w { height: 15px; width: auto; max-width: 48px; display: none; }
.lc-dp .hs { font-size: ${MINFS(10)}; font-weight: 900; letter-spacing: 1px; padding: 2px 7px; border-radius: 4px; background: #ffc83d; color: #1a1204; }
.lc-dp.rc { color: #cfe4ff; }
.lc-dp .lab-s { display: none; }
/* ---- post-match: summary + standings ---- */
.lc-pm { display: flex; flex-wrap: wrap; justify-content: center; align-items: flex-start; gap: 18px; width: min(1000px, calc(100% - 32px)); max-height: calc(100% - 28px); overflow-y: auto; overscroll-behavior: contain; box-sizing: border-box; padding: 4px; }
.lc-pm-sum { flex: 1 1 360px; max-width: 440px; padding: 28px 30px 24px; border-radius: 18px; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; position: relative; overflow: hidden; }
.lc-pm-st { flex: 1.25 1 400px; min-width: 0; border-radius: 18px; padding: 16px 18px 12px; display: flex; flex-direction: column; min-height: 0; }
.lc-pm-h { font-family: Orbitron, ${FONT_DISPLAY}; font-weight: 800; font-size: 17px; letter-spacing: 2px; margin-bottom: 10px; display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.lc-pm-h small { font-family: ${FONT}; font-weight: 700; font-size: ${MINFS(12)}; letter-spacing: 1px; opacity: .6; }
.lc-tiles { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; width: 100%; margin: 4px 0 2px; }
.lc-tile { min-width: 92px; padding: 8px 12px; border-radius: 12px; background: rgba(255,255,255,.05); border: 1px solid rgba(140,200,255,.14); }
.lc-tile .k { font-weight: 800; font-size: ${MINFS(11)}; letter-spacing: 1.6px; opacity: .6; text-transform: uppercase; }
.lc-tile .v { font-weight: 800; font-size: 24px; line-height: 30px; font-variant-numeric: tabular-nums; }
.lc-winner { font-weight: 700; font-size: ${MINFS(13)}; color: #ffd873; letter-spacing: .5px; min-height: 18px; }
.lc-pm-act { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-top: 12px; }
.lc-pbtn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-family: ${FONT}; font-weight: 800; font-size: 15px; letter-spacing: .4px; padding: 12px 22px; border-radius: 999px; cursor: pointer; transition: transform .12s ease, filter .12s; }
.lc-pbtn .ic { display: flex; font-size: 18px; }
.lc-pbtn.pri { background: #f4f7fb; color: #0b1220; border: 1px solid #fff; box-shadow: 0 0 22px rgba(160,210,255,.25); }
.lc-pbtn.sec { background: rgba(255,255,255,.04); color: #eaf2ff; border: 1px solid rgba(255,255,255,.28); }
.lc-pbtn:hover { transform: translateY(-1px); filter: brightness(1.06); }
.lc-pbtn:active { transform: translateY(1px); }
.lc-pm-menu { margin-top: 2px; background: none; border: 0; color: rgba(207,228,255,.7); font-family: ${FONT}; font-weight: 700; font-size: ${MINFS(12)}; letter-spacing: 1.6px; text-transform: uppercase; cursor: pointer; padding: 8px 14px; }
.lc-pm-menu:hover { color: #fff; text-decoration: underline; }
.lc-scroll { position: relative; overflow-y: auto; overscroll-behavior: contain; max-height: min(480px, calc(100vh - 150px)); border-radius: 10px; }
/* every row is EXACTLY --lc-rh tall and the header 28 px (fixed line-heights, no vertical padding, nowrap): the scroller is sized to header + whole rows and scrolled to a
   row boundary (buildStandings), so no row ever sits half under the sticky header - the first version drifted by a fraction of a row and showed a sliver (2026-10-12) */
.lc-tbl { --lc-rh: 35px; width: 100%; border-collapse: separate; border-spacing: 0; font-family: ${FONT}; font-variant-numeric: tabular-nums; }
/* the header is OPAQUE: at .96 the row scrolled under it ghosted through, overlapping "PLAYER" (seen 2026-10-12 at 1280x720) */
.lc-tbl th { position: sticky; top: 0; z-index: 1; background: #0a1020; text-align: left; font-weight: 800; font-size: ${MINFS(11)}; letter-spacing: 1.6px; color: rgba(255,255,255,.5); padding: 0 10px; height: 28px; line-height: 28px; box-sizing: border-box; white-space: nowrap; }
.lc-tbl th.n, .lc-tbl td.n { text-align: right; }
.lc-tbl td { padding: 0 10px; height: var(--lc-rh); line-height: calc(var(--lc-rh) - 1px); box-sizing: border-box; white-space: nowrap; font-weight: 700; font-size: ${MINFS(14)}; border-top: 1px solid rgba(255,255,255,.06); color: #dbe6f6; }
.lc-tbl td.r { width: 44px; color: rgba(255,255,255,.5); font-weight: 800; }
.lc-tbl tr.top td.r { color: #ffd54a; }
.lc-tbl tr.me td { background: rgba(255,213,74,.10); color: #fff; border-top-color: rgba(255,213,74,.28); }
.lc-tbl tr.me td.r { color: #ffd54a; }
.lc-tbl .you { font-size: ${MINFS(11)}; font-weight: 700; opacity: .6; margin-left: 6px; line-height: 1; vertical-align: middle; }
.lc-tbl .live { font-size: ${MINFS(10)}; font-weight: 800; letter-spacing: 1px; color: #7be0a3; margin-left: 8px; line-height: 1; vertical-align: middle; }
/* ---- pings (LC-07): a world pip with its distance, an edge arrow when it is off screen, a compass tick ---- */
.lc-ping { position: absolute; left: 0; top: 0; display: none; pointer-events: none; text-align: center; will-change: transform; --pc: #ffd254; }
.lc-ping .dia { width: 15px; height: 15px; margin: 0 auto; transform: rotate(45deg); background: var(--pc); border: 2px solid rgba(6,10,18,.85); box-shadow: 0 0 10px var(--pc), 0 1px 3px rgba(0,0,0,.8); }
.lc-ping.enemy .dia { border-radius: 2px 50% 2px 50%; }
.lc-ping.pin .dia { width: 17px; height: 17px; box-shadow: 0 0 0 3px rgba(6,10,18,.55), 0 0 14px var(--pc); }
.lc-ping .lbl { margin-top: 6px; font-family: ${FONT}; font-weight: 800; font-size: 13px; line-height: 14px; letter-spacing: .6px; color: var(--pc); white-space: nowrap; text-shadow: 0 1px 3px #000, 0 0 6px rgba(0,0,0,.8); font-variant-numeric: tabular-nums; }
.lc-ping .arr { display: none; width: 0; height: 0; margin: 4px auto 0; border-left: 7px solid transparent; border-right: 7px solid transparent; border-bottom: 11px solid var(--pc); filter: drop-shadow(0 1px 2px rgba(0,0,0,.9)); }
.lc-ping.edge .arr { display: block; }
.lc-ping.edge .dia { width: 10px; height: 10px; }
.lc-cping { position: absolute; top: 3px; width: 9px; height: 9px; margin-left: -6px; transform: rotate(45deg); background: var(--pc, #ffd254); border: 1.5px solid rgba(6,10,18,.9); box-shadow: 0 0 6px var(--pc, #ffd254); display: none; pointer-events: none; }
.lc-cping.edge { opacity: .55; }
`;
  document.head.appendChild(st);
}

export function init(W) {
  K = W.SIM;
  W.randomMap = randomMap;   // net.js uses this for online match starts
  const root = h("div", { position: "absolute", inset: "0", pointerEvents: "none", fontFamily: FONT, zIndex: 40, color: "#eaf2ff", userSelect: "none" });
  root.dataset.lc = "hudroot";
  W.kernel.parent.appendChild(root);
  R = { root };
  wireEvents(W);
  initTouch(W);
  initPingInput(W);          // LC-07: Ping key + middle mouse (window listeners, once)
  applyA11y(W); applyBrightness(W);   // LC-43: the saved colour palette, flash reduction and brightness from the first frame
  W._hudPings = PINGS;       // test surface (read-only by probes): the live pings + counters
}

function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
/** Give the mouse back. Pointer lock routes EVERY mouse event to the locked
 *  canvas, so any overlay the player must click is dead until the lock is
 *  released. It was released in only two places — showMenu and togglePause —
 *  which left the death screen and the post-match screen (the two screens that
 *  end every single match) with unclickable buttons until the player happened
 *  to press Esc. Nothing told them to. */
function releaseCursor(W) {
  try { document.exitPointerLock && document.exitPointerLock(); } catch (e) {}
  try { if (W && W.kernel) W.kernel.renderer.domElement.style.cursor = ""; } catch (e) {}
  // The click that re-grabs the pointer after an INTENTIONAL release (a menu,
  // the map, an end-of-match panel) must not also fire the weapon. Flagging it
  // here — rather than inferring it from pointerLockElement in the mousedown
  // handler — is what makes the suppression precise: see player.js.
  if (W) W._suppressNextShot = true;
}

function layer(name, styles) {
  if (R[name]) { clear(R[name]); R[name].remove(); }
  R[name] = h("div", Object.assign({ position: "absolute", inset: "0", pointerEvents: "none" }, styles || {}), null, R.root);
  return R[name];
}

// ═══ TOUCH MODE (contract C6: hud.setTouchMode(W, on)) ═══════════════════════
// Touch mode is a property of the DEVICE IN USE, not of the match phase: it
// flips on with the first real touch (or at boot on a coarse-only pointer:
// coarse AND not fine, so a touch laptop starts in mouse mode) and off with a real mouse
// press, last input wins. touch.js (lane L10) may also call setTouchMode
// directly; both paths land on the same state. What it changes:
//   * <html class="lc-touch">: TOUCH_CSS lifts every small label to 12 px
//     (--lc-minfs, see FS), every button/input to >= 44 px, swaps the
//     .kbd-hint lines for their .lc-touch-only twins and lays the HUD out
//     around the thumb zones (stick bottom-left, buttons bottom-right).
//   * prompts name the touch control: "HOLD USE · Open chest", "TAP USE · …",
//     "TAP JUMP TO CUT THE CHUTE"; "CLICK TO LOOK AROUND" never shows.
//   * the HUD slots and the minimap are tappable (see hudTap*): a tap on a
//     slot calls W.equipSlot, a tap on the minimap opens the big map.
//   * the rotate overlay covers a portrait screen and pauses a live solo match.
let touchOn = false;
let _tW = null;                  // the W the touch listeners act on (one game per page)
let _touchInit = false;
// A slot / the minimap has no hold action, so a slow press is still a tap:
// the window is generous, and it is measured on the events' own timestamps
// (input time), not handler time — a long frame between the finger landing and
// lifting must not turn a tap into a no-op (seen once under a loaded test box).
const TAP_SLOP = 18, TAP_MS = 1200;
const _tap = { id: null, kind: null, idx: -1, x: 0, y: 0, t: 0, swallowEnd: false, n: 0, last: null };
function coarseOnly() {
  try {
    return !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(pointer: fine)").matches);
  } catch (e) { return false; }
}
/** C6. `on` = the player is using touch. Idempotent; safe before showHUD. */
export function setTouchMode(W, on) {
  on = !!on;
  if (W) _tW = W;
  ensureTouchStyles();
  touchOn = on;
  try { document.documentElement.classList.toggle("lc-touch", on); } catch (e) {}
  if (R.root) R.root.dataset.touch = on ? "1" : "0";
  if (R.lookHint && on && R.lookHint.style.display !== "none") R.lookHint.style.display = "none";
  if (R._hudCache) { R._hudCache.ia = null; R._hudCache.chuteLbl = null; }
  syncTouchPrefs(W || _tW);
  // LC-43: HUD scale and brightness are desktop settings - a switch to touch drops them, a switch back restores them
  if (W || _tW) { applyA11y(W || _tW); applyBrightness(W || _tW); if (R.hud) applyHudScale(W || _tW); }
  placeBand(true);
  updateRotate();
}
export function isTouchMode() { return touchOn; }
/** touch.js reads W.settings.touchScale / touchLeftHanded (lane L10); the HUD
 *  mirrors them as html classes + --lct-s so TOUCH_CSS keeps the HUD out of
 *  the same thumb zones at any button size and on either hand. */
function syncTouchPrefs(W) {
  const st = (W && W.settings) || {};
  let sc = +st.touchScale;
  if (!(sc > 0)) sc = 1;
  sc = Math.max(0.8, Math.min(1.3, sc));
  try {
    const de = document.documentElement;
    de.style.setProperty("--lct-s", String(sc));
    de.classList.toggle("lc-ts-s", sc <= 0.9);
    de.classList.toggle("lc-ts-m", sc > 0.9 && sc <= 1.1);
    de.classList.toggle("lc-ts-l", sc > 1.1);
    de.classList.toggle("lc-lh", st.touchLeftHanded === true);
  } catch (e) {}
}

function initTouch(W) {
  _tW = W;
  ensureTouchStyles();
  // ?touch=1 / ?touch=0 pin the mode (the same flag touch.js honours): a
  // desktop test of the touch HUD, where the mouse plays the finger
  let forced = null;
  try { const m = /[?&]touch=([01])(?:&|$)/.exec(location.search || ""); if (m) forced = m[1] === "1"; } catch (e) {}
  if (forced !== null) setTouchMode(W, forced);
  else if (coarseOnly()) setTouchMode(W, true);
  if (_touchInit) return;
  _touchInit = true;
  // CAPTURE phase on window: these run before ANY element listener, whatever
  // the z-order of the touch layer, so a tap that starts on a HUD slot or the
  // minimap is the HUD's and never also starts a look drag or a FIRE press.
  window.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" || e.pointerType === "pen" || (forced === true && e.pointerType === "mouse")) {
      if (!touchOn && forced !== false) setTouchMode(_tW, true);
      hudTapDown(e);
    } else if (e.pointerType === "mouse" && touchOn && e.isTrusted && forced === null) {
      setTouchMode(_tW, false);          // a real mouse took over (touch laptop)
    }
  }, true);
  window.addEventListener("pointermove", (e) => { if (_tap.id !== null && e.pointerId === _tap.id) e.stopPropagation(); }, true);
  window.addEventListener("pointerup", hudTapUp, true);
  window.addEventListener("pointercancel", (e) => { if (_tap.id !== null && e.pointerId === _tap.id) { _tap.id = null; e.stopPropagation(); } }, true);
  // a HUD tap acts on pointerup; cancelling its touchend stops the browser's
  // synthesized click from landing on whatever that tap just opened (the big
  // map's own "tap anywhere to close" would otherwise shut it in the same tap)
  window.addEventListener("touchend", (e) => {
    if (_tap.swallowEnd) { _tap.swallowEnd = false; if (e.cancelable) e.preventDefault(); }
  }, { capture: true, passive: false });
  // The announcement band - and the death banner that takes its place - hangs at a height that depends on the viewport CLASS (a phone on
  // its side <= 520 px tall: band 118; a tablet / desktop: 180). placeBand() only ran on an announcement, a touch-mode change or a taller
  // quest card, so a viewport change (a tablet rotated, a window resized) left it where the OLD class put it - the death banner sat at 118
  // on a 1180x820 tablet, on top of the LVL stack and the kill feed (hud_checks, 2026-10-12). Re-place it now and once more after the
  // kernel has taken the new size (its view size lands a tick later on some browsers). A resize is rare: no per-frame cost.
  const ro = () => {
    updateRotate();
    placeBand();
    clearTimeout(R._bandRsT);
    R._bandRsT = setTimeout(() => { placeBand(); fitHint(); }, 200);
  };
  window.addEventListener("resize", ro);
  window.addEventListener("orientationchange", ro);
  try { if (window.visualViewport) window.visualViewport.addEventListener("resize", ro); } catch (e) {}
}

function rectHas(el, x, y) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}
/** Which HUD target a touch at (x, y) starts on. Read on a TAP only (never per
 *  frame), so its rect reads cost nothing in the frame budget. */
function hudTapTarget(x, y) {
  const W = _tW;
  if (!W || !R.hud) return null;
  if (R.bigmap) return { kind: "bigmap", idx: -1 };      // the map is up: any tap closes it
  if (W.phase !== "match" && W.phase !== "drop") return null;
  if (R.pause || R.settings || R.post || R.howto || R.career || (R.rotate && R.rotate.style.display !== "none")) return null;
  if (R.mmWrap && rectHas(R.mmWrap, x, y)) return { kind: "map", idx: -1 };
  const me = W.player;
  if (me && me.alive && R.slotsRow && rectHas(R.slotsRow, x, y)) {
    const cells = R.slotsRow.children;
    for (let i = 0; i < cells.length; i++) if (rectHas(cells[i], x, y)) return { kind: "slot", idx: i };
  }
  return null;
}
function hudTapDown(e) {
  if (!touchOn || _tap.id !== null) return;
  const t = hudTapTarget(e.clientX, e.clientY);
  if (!t) return;
  _tap.id = e.pointerId; _tap.kind = t.kind; _tap.idx = t.idx;
  _tap.x = e.clientX; _tap.y = e.clientY; _tap.t = e.timeStamp || performance.now();
  e.stopPropagation();
  if (e.cancelable) e.preventDefault();
}
function hudTapUp(e) {
  if (_tap.id === null || e.pointerId !== _tap.id) return;
  _tap.id = null;
  e.stopPropagation();
  _tap.swallowEnd = true;
  const moved = Math.hypot(e.clientX - _tap.x, e.clientY - _tap.y), held = (e.timeStamp || performance.now()) - _tap.t;
  _tap.n++;
  _tap.last = { kind: _tap.kind, idx: _tap.idx, moved: Math.round(moved), heldMs: Math.round(held), acted: false };
  if (moved > TAP_SLOP || held > TAP_MS) return;
  const W = _tW;
  if (!W) return;
  _tap.last.acted = true;
  if (_tap.kind === "map" || _tap.kind === "bigmap") {
    if (_tap.kind === "bigmap" ? !!R.bigmap : !R.bigmap) { toggleBigMap(W); W.events && W.events.emit("uiClick"); }
  } else if (_tap.kind === "slot") {
    const me = W.player, i = _tap.idx;
    if (!me || !me.alive || !me.inventory || !me.inventory.slots[i] || me.inventory.active === i) return;
    // C6: the slot calls W.equipSlot (weapons.js) — the same equip the 1-5
    // keys reach through input.slot, applied now so the row repaints this frame
    if (W.equipSlot) W.equipSlot(me, i);
    else if (me.input) me.input.slot = i;
  }
}

// rotate overlay: touch + portrait. Same rule as DYEFIELD's CONTRACT_MOBILE M4:
// shown while the page is in touch mode and taller than wide; a live solo
// match pauses under it, and turning back never auto-resumes (the pause card is
// waiting). Online matches cannot pause — the overlay still covers.
let _rotOn = false;
function ensureRotate() {
  if (R.rotate && R.rotate.isConnected) return R.rotate;
  const el = h("div", {
    position: "fixed", inset: "0", zIndex: "2147483000", display: "none",
    alignItems: "center", justifyContent: "center", padding: "24px", boxSizing: "border-box",
    background: "radial-gradient(ellipse at 50% 40%, rgba(16,32,58,0.97) 0%, rgba(3,8,16,0.985) 100%)",
    color: "#eaf2ff", fontFamily: FONT, textAlign: "center", pointerEvents: "auto", touchAction: "none",
  }, null, document.body);
  el.id = "lc-rotate";
  el.dataset.lc = "rotate";
  el.setAttribute("role", "alert");
  const card = h("div", { display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", maxWidth: "320px" }, null, el);
  const ic = h("div", { width: "96px", height: "96px" }, null, card);
  ic.innerHTML = '<svg viewBox="0 0 120 120" width="96" height="96" aria-hidden="true"><g class="lc-rot-ph">'
    + '<rect x="38" y="14" width="44" height="80" rx="9" fill="#0b1830" stroke="#8ec8ff" stroke-width="5"/>'
    + '<rect x="45" y="24" width="30" height="56" rx="3" fill="#2f7fd6"/><circle cx="60" cy="87" r="3" fill="#8ec8ff"/></g>'
    + '<path d="M22 86a42 42 0 0 0 30 22" fill="none" stroke="#eaf2ff" stroke-width="5" stroke-linecap="round"/>'
    + '<path d="M44 100l10 8-12 5" fill="none" stroke="#eaf2ff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  h("div", { fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "18px", fontWeight: "900", letterSpacing: "2px" }, "TURN YOUR PHONE SIDEWAYS", card);
  h("div", { fontFamily: "Rajdhani, " + FONT, fontSize: "15px", fontWeight: "600", opacity: "0.8", lineHeight: "1.45" },
    "Last Circle plays in landscape. A match in progress is paused until you turn back.", card);
  R.rotate = el;
  return el;
}
function updateRotate() {
  if (typeof document === "undefined" || !document.body) return;
  const on = touchOn && window.innerHeight > window.innerWidth;
  if (on === _rotOn && (!on || (R.rotate && R.rotate.isConnected))) return;
  _rotOn = on;
  const el = ensureRotate();
  el.style.display = on ? "flex" : "none";
  if (!on) return;
  const W = _tW;
  if (W && !W.net && !W.paused && (W.phase === "match" || W.phase === "drop") && W.player && W.player.alive) {
    if (R.bigmap) toggleBigMap(W);
    requestPause(W, true);
  }
}

// Phone / touch layout. Inline styles carry the desktop design, so these rules
// use !important to win — and they only ever match under html.lc-touch, so a
// desktop never sees one of them. Short-landscape rules (a phone on its side,
// <= 520 px tall) compact the menu and the HUD's top stack; the HUD's bottom
// widgets move out of the two thumb zones (touch.js, lane L10: the stick
// bottom-left, the button cluster bottom-right) into the bottom centre.
const TOUCH_CSS = `
html.lc-touch { --lc-minfs: 12px; }
html:not(.lc-touch) .lc-touch-only { display: none !important; }
html.lc-touch .kbd-hint { display: none !important; }
html.lc-touch [data-lc=hudroot] button { min-height: 44px; min-width: 44px; touch-action: manipulation; }
html.lc-touch [data-lc=hudroot] input { min-height: 44px; }
html.lc-touch [data-lc=hudroot] [role=button] { min-height: 44px; touch-action: manipulation; }
html.lc-touch [data-lc=swatchrow] { flex-wrap: wrap; justify-content: center; max-width: 290px; gap: 6px !important; }
html.lc-touch [data-lc=swatch] { width: 44px !important; height: 44px !important; }
html.lc-touch [data-lc=strip] { flex-wrap: wrap; justify-content: center; row-gap: 4px; max-width: calc(100vw - 32px); box-sizing: border-box; }
html.lc-touch [data-lc=chutebtn] { display: none !important; }
html.lc-touch [data-lc=lookhint] { display: none !important; }
/* MENU on a phone on its side: the PLAY cards come first (title, then the
   cards + operative side by side), the level strip and the dailies follow,
   and the column scrolls inside itself (menuwrap overflow-y: auto) */
@media (max-height: 520px) {
  html.lc-touch [data-lc=menuwrap] { padding: 50px 12px 12px !important; gap: 10px !important; }
  html.lc-touch [data-lc=titleblock] { display: contents; }
  html.lc-touch [data-lc=wordmark] { font-size: 26px !important; letter-spacing: 6px !important; order: 0; }
  html.lc-touch [data-lc=cols] { order: 1; gap: 12px !important; flex-wrap: nowrap !important; }
  html.lc-touch [data-lc=strip] { order: 2; margin-top: 0 !important; }
  html.lc-touch [data-lc=daily] { order: 3; margin-top: 0 !important; }
  html.lc-touch [data-lc=touchhint], html.lc-touch [data-lc=kbdhint] { order: 4; }
  html.lc-touch [data-lc=leftcol] { min-width: 0 !important; width: 296px; gap: 8px !important; }
  html.lc-touch [data-lc=leftcol] .lc-mode-card { min-width: 0 !important; padding: 9px 12px 9px 10px !important; }
  html.lc-touch [data-lc=leftcol] .lc-mode-card div { letter-spacing: 1px !important; }
  html.lc-touch [data-lc=chiptail] { display: none; }
  html.lc-touch [data-lc=bay] { width: 236px !important; padding: 10px 12px !important; gap: 6px !important; }
  html.lc-touch [data-lc=stage] { width: 132px !important; height: 132px !important; }
  html.lc-touch [data-lc=stage] canvas { width: 100% !important; height: 100% !important; }
  html.lc-touch [data-lc=lobbygrid] { display: none !important; }
}
/* MATCH HUD around touch.js's thumb zones (lane L10's published geometry, CSS
   px x --lct-s, from the safe-area edges): STICK home 34..154 bottom-left;
   cluster bottom-right - RELOAD from W-278, FIRE from W-194 / H-160, USE to
   H-252; PAUSE top-right 10..54. The slot row (5 x 44 + 4 x 4 = 236 px) goes
   in the bottom-centre gap: mode A (wide) on the bottom edge between the stick
   and RELOAD, mode B (narrow, e.g. 667 px) above RELOAD's top between the stick
   and FIRE. Ammo / reload bar / weapon pop stack on the row. HP + shield move
   under the minimap. Thresholds: A needs W >= 432 s + 248 (s = button scale;
   the bucket's largest s is used: S 0.9 -> 637, M 1.1 -> 723, L 1.3 -> 810). */
html.lc-touch {
  --lct-s: 1;
  --lc-sl: env(safe-area-inset-left, 0px); --lc-sr: env(safe-area-inset-right, 0px); --lc-sb: env(safe-area-inset-bottom, 0px);
  --lc-rx: calc(50% + (var(--lc-sl) - var(--lc-sr)) / 2 - var(--lct-s) * 20px - 118px);
  --lc-rb: calc(var(--lc-sb) + var(--lct-s) * 98px + 6px);
  --lc-ab: calc(var(--lc-rb) - 28px);
  --lc-bb: calc(var(--lc-rb) - 40px);
  --lc-pb: calc(var(--lc-rb) + 52px);
}
html.lc-touch.lc-lh { --lc-rx: calc(50% + (var(--lc-sl) - var(--lc-sr)) / 2 + var(--lct-s) * 20px - 118px); }
@media (min-width: 637px) { html.lc-touch.lc-ts-s { --lc-rx: calc(50% + (var(--lc-sl) - var(--lc-sr)) / 2 - var(--lct-s) * 62px - 118px); --lc-rb: calc(var(--lc-sb) + 12px); --lc-ab: calc(var(--lc-rb) + 50px); --lc-bb: calc(var(--lc-rb) + 78px); --lc-pb: calc(var(--lc-rb) + 92px); }
  html.lc-touch.lc-ts-s.lc-lh { --lc-rx: calc(50% + (var(--lc-sl) - var(--lc-sr)) / 2 + var(--lct-s) * 62px - 118px); } }
@media (min-width: 723px) { html.lc-touch.lc-ts-m { --lc-rx: calc(50% + (var(--lc-sl) - var(--lc-sr)) / 2 - var(--lct-s) * 62px - 118px); --lc-rb: calc(var(--lc-sb) + 12px); --lc-ab: calc(var(--lc-rb) + 50px); --lc-bb: calc(var(--lc-rb) + 78px); --lc-pb: calc(var(--lc-rb) + 92px); }
  html.lc-touch.lc-ts-m.lc-lh { --lc-rx: calc(50% + (var(--lc-sl) - var(--lc-sr)) / 2 + var(--lct-s) * 62px - 118px); } }
@media (min-width: 810px) { html.lc-touch.lc-ts-l { --lc-rx: calc(50% + (var(--lc-sl) - var(--lc-sr)) / 2 - var(--lct-s) * 62px - 118px); --lc-rb: calc(var(--lc-sb) + 12px); --lc-ab: calc(var(--lc-rb) + 50px); --lc-bb: calc(var(--lc-rb) + 78px); --lc-pb: calc(var(--lc-rb) + 92px); }
  html.lc-touch.lc-ts-l.lc-lh { --lc-rx: calc(50% + (var(--lc-sl) - var(--lc-sr)) / 2 + var(--lct-s) * 62px - 118px); } }
html.lc-touch [data-lc=slotcol] { display: contents !important; }
html.lc-touch [data-lc=slots] { position: absolute; left: var(--lc-rx); bottom: var(--lc-rb); gap: 4px !important; }
html.lc-touch [data-lc=slots] > div { width: 44px !important; height: 44px !important; }
html.lc-touch [data-lc=slots] img { width: 40px !important; height: 30px !important; }
html.lc-touch [data-lc=ammo] { position: absolute; left: var(--lc-rx); bottom: var(--lc-ab); font-size: 18px !important; line-height: 22px; white-space: nowrap; }
/* the weapon card is just its count on a phone (the card chrome would be a layout change in
   the thumb zones): the wrappers dissolve and the count keeps the rule above */
html.lc-touch [data-lc=wcard], html.lc-touch [data-lc=wrow2] { display: contents !important; }
html.lc-touch [data-lc=wrow1], html.lc-touch [data-lc=wrow3], html.lc-touch [data-lc=wsil] { display: none !important; }
/* the vitals card keeps the number and both bars, in <= 46 px: under the minimap with the
   prompts and the chat below it (the consumables row is the slot row's job on a phone) */
html.lc-touch [data-lc=cons] { display: none !important; }
html.lc-touch .lc-vit { padding: 5px 10px !important; border-radius: 12px !important; }
html.lc-touch .lc-hpn { min-width: 50px !important; }
html.lc-touch .lc-hpn b { font-size: 26px !important; }
html.lc-touch .lc-vbars { gap: 5px !important; }
html.lc-touch .lc-vn { width: 20px !important; }
html.lc-touch [data-lc=reloadbar], html.lc-touch [data-lc=healbar] { left: var(--lc-rx) !important; top: auto !important; bottom: var(--lc-bb) !important; transform: none !important; width: 180px !important; }
html.lc-touch [data-lc=wpnpop] { left: calc(var(--lc-rx) + 118px) !important; bottom: var(--lc-pb) !important; font-size: 14px !important; }
html.lc-touch [data-lc=minimap] { top: calc(env(safe-area-inset-top, 0px) + 12px) !important; left: calc(var(--lc-sl) + 14px) !important; }
html.lc-touch [data-lc=bars] { left: calc(var(--lc-sl) + 14px) !important; bottom: auto !important; top: calc(env(safe-area-inset-top, 0px) + 200px) !important; width: 240px !important; }
html.lc-touch [data-lc=chat] { left: calc(var(--lc-sl) + 14px) !important; bottom: auto !important; top: calc(env(safe-area-inset-top, 0px) + 250px) !important; max-width: 300px !important; }
html.lc-touch [data-lc=feed] { top: 62px !important; right: calc(var(--lc-sr) + 10px) !important; }
html.lc-touch [data-lc=perf] { top: 16px !important; right: calc(var(--lc-sr) + 64px) !important; }
/* a tablet (touch, taller than 520 px): the vitals card sits under the minimap (x 14..254)
   at the death banner's height, so the centred banner keeps 262 px clear on each side
   (measured 2026-10-12 at 1180x820: it reached x 232 and overlapped the card) AND the widest kill feed (272 px,
   right 10): (272 + 10 + 8) x 2 = 580 px off the width. At that width the killer pill (worst case ~480 px)
   no longer fits on a 1024-wide tablet, so the pills stay on ONE line (the killer's name ellipsizes first, the
   long "ELIMINATED BY" label shortens to "BY") instead of wrapping into a banner 197 px tall (measured at 1024x768) */
@media not all and (max-height: 520px) {
  html.lc-touch [data-lc=death] { max-width: calc(100vw - 580px - 2 * max(var(--lc-sl), var(--lc-sr))) !important; }
  html.lc-touch .lc-dp { flex-wrap: nowrap; justify-content: center; white-space: nowrap; gap: 6px; }
  html.lc-touch .lc-dp .lab-l { display: none !important; }
  html.lc-touch .lc-dp .lab-s { display: inline !important; }
}
/* a narrow tablet (<= 1100 px wide): the weapon's NAME stays in the pill, its 15 px silhouette goes (the kill feed keeps it) */
@media (max-width: 1100px) and (min-height: 520.5px) {
  html.lc-touch .lc-dp .w { display: none !important; }
  /* row 1 (title, #N of 50, MATCH STATS at the 44 px touch size) is ~500 px at full size: one row of smaller type, not two rows (1024x768: 171 px -> ~125) */
  html.lc-touch .lc-d1 { flex-wrap: nowrap !important; gap: 10px !important; }
  html.lc-touch [data-lc=deathtitle], html.lc-touch .lc-dn { font-size: 18px !important; letter-spacing: 1.5px !important; }
}
/* a SHORT tablet (521..760 px tall: 1024x600 / 960x600 7-inch, 1133x744, 1024x768): the band
   starts at 180, so the full-size banner (142 px) would reach the reticle at H/2 - 17 (283 on a
   600 px screen). Compact type and pills keep it ~100 px tall: 180..~280 */
@media (min-height: 520.5px) and (max-height: 760px) {
  html.lc-touch [data-lc=death] { padding: 3px 12px 4px !important; gap: 2px !important; border-radius: 12px !important; }
  html.lc-touch [data-lc=deathtitle], html.lc-touch .lc-dn { font-size: 17px !important; line-height: 22px !important; letter-spacing: 1.5px !important; }
  html.lc-touch .lc-d1 { gap: 10px !important; flex-wrap: nowrap !important; }
  html.lc-touch .lc-d2 { gap: 2px 8px !important; }
  html.lc-touch .lc-dp { padding: 0 8px !important; line-height: 18px !important; }
  html.lc-touch .lc-dp .hs { line-height: 14px !important; padding: 1px 5px !important; }
}
/* a phone on its side (<= 520 px tall): a compact top stack, the quest card
   off (dailies still pay out and flash), the left column under the minimap
   carries the prompts so the centre stays on the reticle */
@media (max-height: 520px) {
  html.lc-touch { --lc-ann-fs: 18px; --lc-ann-sub: 12px; }
  html.lc-touch [data-lc=minimap] { width: 104px !important; height: 104px !important; top: calc(env(safe-area-inset-top, 0px) + 8px) !important; left: calc(var(--lc-sl) + 8px) !important; border-radius: 10px !important; }
  html.lc-touch [data-lc=bars] { top: calc(env(safe-area-inset-top, 0px) + 118px) !important; left: calc(var(--lc-sl) + 8px) !important; width: 200px !important; }
  html.lc-touch [data-lc=chat] { top: calc(env(safe-area-inset-top, 0px) + 220px) !important; left: calc(var(--lc-sl) + 8px) !important; max-width: 240px !important; }
  html.lc-touch [data-lc=stormrow] { top: 54px !important; padding: 4px 14px !important; gap: 12px !important; }
  html.lc-touch [data-lc=stormrow] > div { font-size: 15px !important; }
  html.lc-touch [data-lc=meta] { top: 86px !important; width: 300px !important; }
  html.lc-touch [data-lc=quest] { display: none !important; }
  html.lc-touch [data-lc=feed] > :nth-last-child(n+3) { display: none !important; }
  html.lc-touch [data-lc=interact], html.lc-touch [data-lc=chutehint] { left: calc(var(--lc-sl) + 8px) !important; top: calc(env(safe-area-inset-top, 0px) + 166px) !important; transform: none !important; font-size: 13px !important; max-width: calc(45vw - 16px); overflow: hidden; text-overflow: ellipsis; }
  html.lc-touch [data-lc=pickupmsg] { left: calc(var(--lc-sl) + 8px) !important; top: calc(env(safe-area-inset-top, 0px) + 196px) !important; transform: none !important; font-size: 13px !important; }
  html.lc-touch [data-lc=stormmsg] { font-size: 15px !important; }
  /* the death banner takes the announcement band's spot, to the RIGHT of the left column
     (minimap, vitals, prompts: x 8..208) and <= ~50 px tall so it ends above the reticle;
     the button rides the right edge across both rows and the recap pill is dropped */
  html.lc-touch [data-lc=death] { left: 216px !important; transform: none !important; width: calc(100vw - 232px) !important; max-width: none !important; box-sizing: border-box !important;
    padding: 2px 148px 2px 10px !important; gap: 1px !important; border-radius: 10px !important; }
  html.lc-touch [data-lc=deathtitle], html.lc-touch .lc-dn { font-size: 15px !important; line-height: 18px !important; letter-spacing: 1.5px !important; }
  html.lc-touch .lc-d1 { gap: 8px !important; flex-wrap: nowrap !important; }
  html.lc-touch .lc-d2 { flex-wrap: nowrap !important; }
  html.lc-touch .lc-dp { padding: 0 8px !important; line-height: 18px !important; gap: 6px !important; }
  html.lc-touch .lc-dp .hs { line-height: 14px !important; padding: 1px 5px !important; }
  html.lc-touch .lc-dp .lab-l { display: none !important; }
  html.lc-touch .lc-dp .lab-s { display: inline !important; }
  html.lc-touch .lc-dp.rc { display: none !important; }
  html.lc-touch .lc-dbtn { position: absolute !important; right: 6px; top: 50%; transform: translateY(-50%); padding: 0 12px !important; }
  html.lc-touch [data-lc=post] { gap: 10px !important; flex-wrap: nowrap !important; align-items: stretch !important; width: calc(100% - 16px) !important; height: calc(100% - 12px) !important; max-height: none !important; padding: 0 !important; overflow: hidden !important; }
  html.lc-touch [data-lc=postsum] { flex: 0 0 300px !important; max-width: 300px !important; padding: 8px 12px !important; gap: 3px !important; overflow-y: auto !important; }
  html.lc-touch [data-lc=posttitle] { font-size: 20px !important; letter-spacing: 2px !important; }
  html.lc-touch .lc-tiles { flex-wrap: nowrap !important; gap: 6px !important; margin: 2px 0 !important; }
  html.lc-touch .lc-tile { min-width: 0 !important; flex: 1 1 0 !important; padding: 3px 4px !important; }
  html.lc-touch .lc-tile .v { font-size: 17px !important; line-height: 20px !important; }
  html.lc-touch [data-lc=postcareer] { display: none !important; }
  html.lc-touch .lc-pm-act { margin-top: 4px !important; gap: 6px !important; }
  html.lc-touch .lc-pbtn { padding: 0 14px !important; font-size: 14px !important; }
  html.lc-touch [data-lc=standings] { flex: 1 1 0 !important; min-width: 0 !important; padding: 8px 10px !important; }
  html.lc-touch .lc-pm-h { margin-bottom: 6px !important; }
  html.lc-touch .lc-scroll { flex: 1 1 0 !important; min-height: 0 !important; max-height: none !important; }
  html.lc-touch .lc-tbl { --lc-rh: 33px; }
  html.lc-touch .lc-tbl th, html.lc-touch .lc-tbl td { padding: 0 6px !important; }
  html.lc-touch .lc-tbl td.r { width: 30px !important; }
  html.lc-touch .lc-tbl td.nm { max-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  html.lc-touch .lc-tbl .live { display: none !important; }
}
html.lc-touch .lc-dbtn { min-height: 44px; }
@keyframes lcRotPh { 0%, 30% { transform: rotate(0deg) } 60%, 100% { transform: rotate(-90deg) } }
#lc-rotate .lc-rot-ph { transform-origin: 60px 54px; animation: lcRotPh 2.2s ease-in-out infinite alternate; }
@media (prefers-reduced-motion: reduce) { #lc-rotate .lc-rot-ph { animation: none; transform: rotate(-90deg); } }
`;
function ensureTouchStyles() {
  if (typeof document === "undefined" || document.getElementById("lc-touch-css")) return;
  const st = document.createElement("style");
  st.id = "lc-touch-css";
  st.textContent = TOUCH_CSS;
  document.head.appendChild(st);
}

// ═══ MENU ════════════════════════════════════════════════════════════════════
// Maps rotate RANDOMLY every match — no picker (owner direction: "anytime you
// play, it randomly chooses").
export const BATTLE_MAPS = ["isla_viva", "ashgrid", "deepwood"];
// `_nextMap` is the one-shot seam behind the post-match "Run it back": the
// orchestrator's onAgain() calls hudMod.randomMap() synchronously for its map, so
// naming the map just before that call replays the SAME map and mode through the
// SAME teardown path (net leave, loading screen) as "Find a new match". It is
// consumed on first read and cleared again by the caller, so a menu start can
// never inherit it. Everything else still picks at random (no map picker).
let _nextMap = null;
export function randomMap() {
  if (_nextMap) { const m = _nextMap; _nextMap = null; return m; }
  return BATTLE_MAPS[Math.floor(Math.random() * BATTLE_MAPS.length)];
}
const MODE_CARDS = [
  { id: "standard", name: "BATTLE ROYALE", sub: "50 players · random map · last one standing" },
  // LC-82: the quick storm runs 239 s (sim STORM_PHASES.quick) with 1.8x loot and a ground start - the old line promised five minutes and double loot
  { id: "quick", name: "QUICK MATCH", sub: "4-minute storm · extra loot · ground start" },
  { id: "practice", name: "PRACTICE", sub: "No storm · random map · full loadout" },
];

// unlockLevel gives the XP bar something to pay out. Levelling used to grant
// nothing at all: the bar filled, the number went up, and the game handed back
// no reward for it.
export const MENU_SKINS = [
  { key: "soldier", name: "SGT. BRICK", sub: "Commando", unlockLevel: 1 },
  { key: "athlete", name: "DASH", sub: "Track star", unlockLevel: 1 },
  { key: "wraith", name: "NIGHTFALL", sub: "Spec-ops · all black", unlockLevel: 3 },
  { key: "juggernaut", name: "BULWARK", sub: "Heavy armor", unlockLevel: 6 },
  { key: "viper", name: "STINGER", sub: "Venom suit", unlockLevel: 10 },
];
// The reward track ABOVE the skins. MENU_SKINS runs out at level 10 (~32,400
// cumulative XP), and from there the bar still filled and the level still ticked
// but nothing was ever GRANTED again. A reticle colour costs no art, no new
// asset and no pipeline, and it is the one piece of UI a player stares at for
// the whole match.
export const CROSS_COLORS = [
  { name: "WHITE", css: "rgba(255,255,255,0.95)", unlockLevel: 1 },
  { name: "ICE", css: "rgba(120,215,255,0.95)", unlockLevel: 4 },
  { name: "LIME", css: "rgba(150,240,150,0.95)", unlockLevel: 8 },
  { name: "AMBER", css: "rgba(255,198,90,0.95)", unlockLevel: 12 },
  { name: "MAGENTA", css: "rgba(255,120,215,0.95)", unlockLevel: 16 },
  { name: "CRIMSON", css: "rgba(255,86,74,0.95)", unlockLevel: 22 },
];
export function skinUnlocked(W, meta) {
  const lvl = (W && W.progress && W.progress.level) || 1;
  return (meta.unlockLevel || 1) <= lvl;
}
/** Named rank per level, so a level that pays no cosmetic still pays a title.
 *  Above 30 the five-step blocks stop and APEX just counts. Pure — testable
 *  without a built world, like careerGoal/levelUpSub below. */
const RANKS = ["RECRUIT", "OPERATIVE", "VETERAN", "ELITE", "VANGUARD", "WARLORD"];
const ROMAN = ["I", "II", "III", "IV", "V"];
export function rankFor(lvl) {
  if (lvl > 30) return { name: "APEX", step: lvl - 29 };
  return { name: RANKS[Math.min(RANKS.length - 1, Math.floor((lvl - 1) / 5))], step: ((lvl - 1) % 5) + 1 };
}
export function rankLabel(lvl) {
  const r = rankFor(lvl);
  return r.name + " " + (r.step <= ROMAN.length ? ROMAN[r.step - 1] : r.step);
}
/** Every level-gated cosmetic, flattened, so the level-up banner and the "next
 *  unlock" strip read one list instead of only knowing about skins. */
function rewardTable() {
  return MENU_SKINS.map((s) => ({ kind: "SKIN", name: s.name, lvl: s.unlockLevel || 1 }))
    .concat(CROSS_COLORS.map((c) => ({ kind: "RETICLE", name: c.name, lvl: c.unlockLevel || 1 })));
}
/** A stored cosmetic index, but never a locked one — progress can be cleared
 *  while a high-level pick is still saved. Same guard getPlayableSkin applies to
 *  skins, generalised so the reticle table gets it for free. */
function playableColor(table, idx, W) {
  const m = table[idx | 0];
  return (m && (m.unlockLevel || 1) <= ((W && W.progress && W.progress.level) || 1)) ? m : table[0];
}
/** The lifetime goal to chase once every skin is unlocked. The reward track is
 *  five skins and the last one lands at level 10, after which the goal slot on
 *  the menu vanished entirely and the level-up banner just said "RANK UP" —
 *  forever, on the account that had played the most. Reads the career counters
 *  the game already keeps, so it costs no new state. */
export function careerGoal(c) {
  const kills = (c && c.kills) || 0;
  const next = [100, 250, 500, 1000, 2500, 5000].find((n) => kills < n);
  return next ? next + " CAREER KILLS · " + kills + "/" + next : kills + " CAREER KILLS";
}
/** Subtitle for the level-up banner: name the reward when this level pays one
 *  out, otherwise point at the next one. Pure so it is testable without a
 *  built world. */
export function levelUpSub(lvl, career) {
  const tbl = rewardTable();
  const won = tbl.filter((e) => e.lvl === lvl);
  if (won.length) return won.map((e) => e.kind + " UNLOCKED · " + e.name).join("  ·  ");
  // No cosmetic at this level → name the rank, which every level now has. This
  // branch used to be reachable only between skin unlocks; past level 10 it fell
  // straight through to the literal string "MAX RANK", forever, on the account
  // that had played the most.
  const next = tbl.filter((e) => e.lvl > lvl).sort((a, b) => a.lvl - b.lvl)[0];
  if (next) return rankLabel(lvl) + " · NEXT " + next.kind + " " + next.name + " AT LEVEL " + next.lvl;
  return rankLabel(lvl) + " · NEXT: " + careerGoal(career);
}
export function getChosenSkin() { try { return localStorage.getItem("lc_skin"); } catch (e) { return null; } }
/** The stored pick, but never a locked one — progress can be cleared while a
 *  high-level skin is still saved. */
export function getPlayableSkin(W) {
  const stored = getChosenSkin();
  const meta = MENU_SKINS.find((s) => s.key === stored);
  if (meta && skinUnlocked(W, meta)) return stored;
  const first = MENU_SKINS.find((s) => skinUnlocked(W, s)) || MENU_SKINS[0];
  return first.key;
}

// ═══ CINEMATIC MENU WORLD (live Three.js on the main kernel canvas) ══════════
export function teardownMenuWorld(W) {
  if (R._menuStopPv) { try { R._menuStopPv(); } catch (e) {} R._menuStopPv = null; }
  W._menuWorld = null;
  if (W._groups && W._groups.menu3d) {
    const g = W._groups.menu3d;
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose && m.dispose());
        else if (o.material.dispose) o.material.dispose();
      }
    });
    g.clear();
  }
  // DO NOT touch scene.background / fog here — teardown runs AFTER buildMap in
  // the match-start flow, so the old dark-navy "placeholder" (0x0a1622 + 10x
  // fog) was overwriting the map's daytime sky and turning matches pitch black.
  // The map (maps.js) owns the sky; the menu (buildMenuWorld) owns its own.
}

function buildMenuWorld(W) {
  teardownMenuWorld(W);
  const g = W.group("menu3d");
  g.clear();

  // golden-hour tropical sky
  W.scene.background = new THREE.Color(0x6eb8e8);
  if (W.scene.fog) {
    W.scene.fog.color = new THREE.Color(0x8ec8e8);
    W.scene.fog.density = 0.0048;
  }
  if (W.kernel.sun) {
    W.kernel.sun.position.set(60, 48, 28);
    W.kernel.sun.intensity = 1.85;
    W.kernel.sun.color.set(0xfff0d8);
  }
  // Restore the HEMISPHERE light too. The kernel builds it at 0.9 / cool blue /
  // near-black ground and maps.js overwrites it on every match start (1.25 /
  // 0xdcefff / 0x7c8672) — nothing ever put it back, so the diorama was lit by
  // whatever the last map wanted, and by a cold blue sky-fill on first boot,
  // against the golden-hour gradient the sky dome below is authored for.
  let _hemi = null;
  W.scene.traverse((o) => { if (o.isHemisphereLight) _hemi = o; });
  if (_hemi) { _hemi.intensity = 0.8; _hemi.color.setHex(0xffe0b8); _hemi.groundColor.setHex(0x2e3a30); }
  // Restore the TONE MAPPER too, not just the exposure: a match sets
  // NoToneMapping (maps.js) for its bright-daylight look and nothing ever put it
  // back, so from the second visit onward the cinematic menu rendered unlit.
  W.kernel.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  W.kernel.renderer.toneMappingExposure = 1.12;

  // soft sky dome (gradient-ish via large inverted sphere)
  const skyGeo = new THREE.SphereGeometry(420, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x3a8fd4) },
      midColor: { value: new THREE.Color(0x9ed0ef) },
      botColor: { value: new THREE.Color(0xf0c090) },
    },
    vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=normalize(w.xyz); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform vec3 topColor,midColor,botColor; varying vec3 vW; void main(){ float h=clamp(vW.y*0.5+0.5,0.,1.); vec3 c=mix(botColor,midColor,smoothstep(0.,0.45,h)); c=mix(c,topColor,smoothstep(0.4,1.,h)); gl_FragColor=vec4(c,1.); }`,
  });
  g.add(new THREE.Mesh(skyGeo, skyMat));

  // procedural island (vertex-colored)
  const SEG = 96, ISLE = 160;
  const terrGeo = new THREE.PlaneGeometry(ISLE, ISLE, SEG, SEG);
  terrGeo.rotateX(-Math.PI / 2);
  const pos = terrGeo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const d = Math.sqrt(x * x + z * z) / (ISLE * 0.48);
    const mask = Math.max(0, 1 - Math.pow(Math.min(1.15, d), 2.4));
    const n = Math.sin(x * 0.09) * Math.cos(z * 0.08) * 2.2 + Math.sin(x * 0.21 + z * 0.17) * 1.1;
    let hgt = (6 + n * 3.5 + (1 - d) * 9) * mask - 1.2;
    // central ridge
    const ridge = Math.exp(-((x - 8) * (x - 8) + (z + 6) * (z + 6)) / 380);
    hgt += ridge * 14 * mask;
    pos.setY(i, hgt);
    let r, gr, b;
    if (hgt < 0.6) { r = 0.90; gr = 0.84; b = 0.58; }
    else if (hgt < 4) { r = 0.28 + n * 0.02; gr = 0.52; b = 0.26; }
    else if (hgt < 12) { r = 0.22; gr = 0.44; b = 0.22; }
    else { r = 0.48; gr = 0.44; b = 0.40; }
    cols[i * 3] = r; cols[i * 3 + 1] = gr; cols[i * 3 + 2] = b;
  }
  terrGeo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  terrGeo.computeVertexNormals();
  const terrain = new THREE.Mesh(terrGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02 }));
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  g.add(terrain);

  // ocean
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900, 1, 1).rotateX(-Math.PI / 2),
    // no envMapIntensity: nothing in the game ever assigns scene.environment or
    // an envMap, so it multiplied a reflection that does not exist
    new THREE.MeshStandardMaterial({ color: 0x1488b0, transparent: true, opacity: 0.88, roughness: 0.18, metalness: 0.22 })
  );
  water.position.y = 0;
  water.receiveShadow = true;
  g.add(water);

  // storm circle — the brand: purple closing ring around the island
  const stormRing = new THREE.Mesh(
    new THREE.TorusGeometry(72, 0.55, 10, 96),
    new THREE.MeshBasicMaterial({ color: 0xb46cff, transparent: true, opacity: 0.72, toneMapped: false })
  );
  stormRing.rotation.x = Math.PI / 2;
  stormRing.position.y = 3.2;
  g.add(stormRing);
  const stormGlow = new THREE.Mesh(
    new THREE.TorusGeometry(72, 2.4, 8, 64),
    new THREE.MeshBasicMaterial({ color: 0x7a3cff, transparent: true, opacity: 0.18, toneMapped: false, side: THREE.DoubleSide })
  );
  stormGlow.rotation.x = Math.PI / 2;
  stormGlow.position.y = 3.2;
  g.add(stormGlow);

  // floating sky islands
  const floaters = [];
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2 + 0.4;
    const rad = 55 + (i % 3) * 18;
    const fi = new THREE.Group();
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(3.2 + i * 0.4, 0),
      new THREE.MeshStandardMaterial({ color: 0x3a4a3a, roughness: 0.9, flatShading: true })
    );
    rock.scale.set(1.6, 0.55, 1.3);
    rock.castShadow = true;
    fi.add(rock);
    const top = new THREE.Mesh(
      new THREE.CylinderGeometry(2.4, 2.8, 0.5, 8),
      new THREE.MeshStandardMaterial({ color: 0x3d7a42, roughness: 0.85, flatShading: true })
    );
    top.position.y = 0.55;
    fi.add(top);
    // simple tree
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 2.2, 6), new THREE.MeshStandardMaterial({ color: 0x4a3020 }));
    trunk.position.y = 1.5; fi.add(trunk);
    const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.4, 2.6, 7), new THREE.MeshStandardMaterial({ color: 0x2f7a3a, flatShading: true }));
    canopy.position.y = 3.1; fi.add(canopy);
    fi.position.set(Math.cos(ang) * rad, 18 + i * 3.5, Math.sin(ang) * rad);
    fi.userData = { baseY: fi.position.y, phase: i * 1.3, ang, rad };
    g.add(fi);
    floaters.push(fi);
  }

  // island props — procedural palms/rocks (no async wait for menu boot)
  for (let i = 0; i < 28; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 12 + Math.random() * 48;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const d = Math.sqrt(x * x + z * z) / (ISLE * 0.48);
    if (d > 0.92) continue;
    const yy = (6 + Math.sin(x * 0.09) * Math.cos(z * 0.08) * 2.2) * Math.max(0, 1 - d * d) + 0.2;
    if (yy < 1.2) continue;
    const palm = new THREE.Group();
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.35, 4.2 + Math.random(), 6), new THREE.MeshStandardMaterial({ color: 0x6b4a28 }));
    tr.position.y = 2.1; tr.castShadow = true; palm.add(tr);
    for (let k = 0; k < 5; k++) {
      const leaf = new THREE.Mesh(
        new THREE.ConeGeometry(0.15, 2.8, 4),
        new THREE.MeshStandardMaterial({ color: 0x2d8a3e, flatShading: true })
      );
      leaf.position.set(0, 4.0, 0);
      leaf.rotation.z = 0.9;
      leaf.rotation.y = (k / 5) * Math.PI * 2;
      palm.add(leaf);
    }
    palm.position.set(x, yy, z);
    palm.rotation.y = Math.random() * Math.PI;
    palm.scale.setScalar(0.7 + Math.random() * 0.55);
    g.add(palm);
  }

  // atmospheric dust / spark particles
  const N = 420;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(N * 3);
  const pBase = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pBase[i * 3] = (Math.random() - 0.5) * 200;
    pBase[i * 3 + 1] = Math.random() * 55 + 2;
    pBase[i * 3 + 2] = (Math.random() - 0.5) * 200;
    pPos[i * 3] = pBase[i * 3];
    pPos[i * 3 + 1] = pBase[i * 3 + 1];
    pPos[i * 3 + 2] = pBase[i * 3 + 2];
  }
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  const pts = new THREE.Points(pGeo, new THREE.PointsMaterial({
    color: 0xd8ecff, size: 0.55, transparent: true, opacity: 0.55,
    depthWrite: false, sizeAttenuation: true, toneMapped: false,
  }));
  g.add(pts);

  // volumetric-ish god-ray planes
  for (let i = 0; i < 4; i++) {
    const ray = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 55),
      new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.04 + i * 0.01, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })
    );
    ray.position.set(-20 + i * 14, 28, -30 + i * 8);
    ray.rotation.z = -0.35;
    ray.rotation.y = 0.4;
    g.add(ray);
  }

  // soft ground fill light under island
  const fill = new THREE.PointLight(0x57b0ff, 0.55, 120);
  fill.position.set(0, 12, 0);
  g.add(fill);

  W._menuWorld = {
    t0: performance.now() / 1000,
    water, stormRing, stormGlow, floaters, pts, pBase, pPos,
    camR: 92, camH: 34, lookY: 6, speed: 0.065,
  };
  // initial camera pose
  updateMenuWorld(W, 0);
  // optional bloom for that AAA glow on emissive storm ring
  try {
    if (!W.kernel.composer) W.kernel.enableBloom({ strength: 0.45, radius: 0.55, threshold: 0.72 });
    else if (W.kernel.bloom) { W.kernel.bloom.strength = 0.45; W.kernel.bloom.threshold = 0.72; }
  } catch (e) { /* postFX optional */ }

  // decorate with real GLBs if present (async, non-blocking)
  const propUrls = ["palm.glb", "tree.glb", "rocks.glb", "pine.glb"];
  propUrls.forEach(async (name, idx) => {
    try {
      const root = await W.kernel.loadGLTF(W.assetBase + "assets/props/" + name);
      if (!W._menuWorld || W.phase !== "menu") return;
      for (let n = 0; n < 3; n++) {
        const c = root.clone(true);
        const a = (idx * 1.7 + n * 2.1) % (Math.PI * 2);
        const rr = 18 + n * 12 + idx * 4;
        c.position.set(Math.cos(a) * rr, 1.5, Math.sin(a) * rr);
        c.scale.setScalar(name === "rocks.glb" ? 2.2 : 1.4);
        c.rotation.y = a;
        // lift to terrain approx
        const d = Math.sqrt(c.position.x ** 2 + c.position.z ** 2) / (ISLE * 0.48);
        const mask = Math.max(0, 1 - Math.pow(Math.min(1.15, d), 2.4));
        c.position.y = (6 + Math.sin(c.position.x * 0.09) * 2) * mask;
        g.add(c);
      }
    } catch (e) { /* props optional */ }
  });
}

export function updateMenuWorld(W, dt) {
  const M = W._menuWorld;
  if (!M || W.phase !== "menu") return;
  const t = performance.now() / 1000 - M.t0;
  // cinematic orbit — slight elev bob, slow yaw
  const ang = t * M.speed;
  const elev = M.camH + Math.sin(t * 0.35) * 3.5;
  const r = M.camR + Math.sin(t * 0.18) * 6;
  W.camera.position.set(Math.cos(ang) * r, elev, Math.sin(ang) * r);
  W.camera.lookAt(0, M.lookY + Math.sin(t * 0.25) * 1.2, 0);
  W.camera.fov = 42;
  W.camera.updateProjectionMatrix();
  // water breathe
  if (M.water) M.water.position.y = Math.sin(t * 0.7) * 0.18;
  // storm pulse + slow spin
  if (M.stormRing) {
    M.stormRing.rotation.z = t * 0.15;
    M.stormRing.material.opacity = 0.55 + Math.sin(t * 1.4) * 0.2;
    M.stormGlow.rotation.z = -t * 0.08;
    M.stormGlow.material.opacity = 0.12 + Math.sin(t * 1.4) * 0.06;
    const pulse = 1 + Math.sin(t * 0.9) * 0.015;
    M.stormRing.scale.setScalar(pulse);
    M.stormGlow.scale.setScalar(pulse);
  }
  // floating islands bob
  for (const fi of M.floaters) {
    fi.position.y = fi.userData.baseY + Math.sin(t * 0.7 + fi.userData.phase) * 1.4;
    fi.rotation.y = t * 0.12 + fi.userData.phase;
  }
  // dust drift
  if (M.pts) {
    const arr = M.pts.geometry.attributes.position.array;
    for (let i = 0; i < M.pBase.length / 3; i++) {
      arr[i * 3] = M.pBase[i * 3] + Math.sin(t * 0.3 + i) * 2;
      arr[i * 3 + 1] = M.pBase[i * 3 + 1] + Math.sin(t * 0.5 + i * 0.7) * 1.5;
      arr[i * 3 + 2] = M.pBase[i * 3 + 2] + Math.cos(t * 0.25 + i) * 2;
    }
    M.pts.geometry.attributes.position.needsUpdate = true;
  }
}

export function showMenu(W, startMatch) {
  W.phase = "menu";
  W.paused = false;
  if (!W.progress) W.progress = loadProgress();   // the locker needs your level
  W.daily = loadDaily();                          // unconditional — it re-validates against today
  // CLOUD RESTORE (once per page): the save bridge was WRITE-ONLY — the game
  // emitted forgeflow:save but never asked for it back, so cross-device
  // careers never restored (progression refuter's top residual). Ask the
  // portal shell for slot 1; accept the reply ONLY from the parent frame, and
  // adopt the cloud career only when it is AHEAD of local (level, then xp) —
  // a merge must never lose local progress. Guests/standalone no-op.
  if (!W._cloudLoadAsked && window.parent && window.parent !== window) {
    W._cloudLoadAsked = true;
    /* WRITE LOCK. Until the account has actually answered, this device must not
       push: the portal merge preserves KEYS but incoming still wins on VALUES,
       so a fresh machine pushing level 1 would flatten a level 40 account. A
       timeout is not an answer — it only schedules another attempt. */
    W._cloudReadOk = false;
    let attempt = 0, settled = false;

    const settle = (cloudProgress) => {
      if (settled) return;
      settled = true;
      if (cloudProgress && typeof cloudProgress.level === "number") {
        const before = JSON.stringify(W.progress);
        const merged = mergeProgressRecords(W.progress, cloudProgress);
        merged.career = newCareer(merged.career);
        W.progress = merged;
        saveProgress(W.progress);
        if (JSON.stringify(W.progress) !== before) flashMsg("CAREER SYNCED FROM CLOUD");
      }
      W._cloudReadOk = true;   // an EMPTY account is a real answer: safe to write
    };

    const ask = () => {
      attempt++;
      const reqId = "lcload" + attempt;
      const onSaveLoaded = (me) => {
        if (me.source !== window.parent) return;
        const d = me.data;
        if (!d || d.type !== "forgeflow:save_loaded" || d._reqId !== reqId) return;
        window.removeEventListener("message", onSaveLoaded);
        settle(d.data && d.data.progress);
      };
      window.addEventListener("message", onSaveLoaded);
      try {
        window.parent.postMessage({ type: "forgeflow:load", slot: 1, _reqId: reqId }, "*");
      } catch (e) { /* standalone */ }
      setTimeout(() => {
        if (settled) return;
        window.removeEventListener("message", onSaveLoaded);
        if (attempt < 3) ask();          // 12 s, then 12 s, then 12 s
        // after that: no answer, so the session stays READ-ONLY. Local play is
        // still saved to localStorage; the account is simply left alone.
      }, 12000);
    };
    try { ask(); } catch (e) {}
  }
  // player.js reads lc_skin straight out of localStorage, so keep the stored
  // value honest here rather than teaching it about unlocks (and importing hud)
  try {
    const ok = getPlayableSkin(W);
    if (ok !== getChosenSkin()) localStorage.setItem("lc_skin", ok);
  } catch (e) {}
  document.exitPointerLock && document.exitPointerLock();
  W.kernel.renderer.domElement.style.cursor = "";
  hideHUD();
  // Every way back to the menu lands here — MAIN MENU, QUIT, and the
  // orchestrator's failed-match recovery (lane L4: "Couldn't load the match").
  // That last one can arrive with the loading screen (and its creep interval),
  // a pause card, settings or a running lobby countdown still up; the menu
  // must own the screen, and a stale lobby timer must never start a drop.
  hideLoading(W);
  if (R._lobbyCancel) { R._lobbyCancel(); R._lobbyCancel = null; }
  if (R.settings) { W.captureKey = null; R.settings.remove(); R.settings = null; }
  ["pause", "lobby", "dropsel"].forEach((n) => { if (R[n]) { R[n].remove(); R[n] = null; } });
  ensureAAAStyles();
  // Dispose BEFORE clearing. Both disposeMapResources and disposeLootResources
  // derive their work list by traversing these very groups, and Object3D.clear()
  // only unparents — so clearing first made the next _startMatch's disposal walk
  // an empty group and free nothing. Every match entered via MAIN MENU (one of
  // the two post-match buttons) orphaned a whole map's geometry, materials and
  // per-match textures. PLAY AGAIN was unaffected, which is why it survived
  // casual testing.
  try {
    if (W.map && W._disposeMap) W._disposeMap(W);
    if (W._disposeLoot) W._disposeLoot(W);
  } catch (e) {}
  // clear any leftover match geometry so the cinematic diorama owns the frame
  if (W._groups) {
    for (const name of Object.keys(W._groups)) {
      if (name === "menu3d") continue;
      try { W._groups[name].clear(); } catch (e) {}
    }
  }
  buildMenuWorld(W);

  // Glass UI over the live 3D world — NO opaque fill; vignette only
  const L = layer("menu", {
    pointerEvents: "auto", overflow: "hidden",
    background: "radial-gradient(ellipse at 50% 40%, rgba(4,10,20,0.18) 0%, rgba(2,6,14,0.55) 70%, rgba(1,4,10,0.78) 100%)",
  });

  // top chrome bar
  const topBar = h("div", {
    position: "absolute", top: "0", left: "0", right: "0", height: "52px",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "0 28px",
    background: "linear-gradient(180deg, rgba(4,10,22,0.72), transparent)",
    borderBottom: "1px solid rgba(120,180,255,0.08)",
  }, null, L);
  h("div", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "13px", fontWeight: "800",
    letterSpacing: "4px", color: "#8ec8ff", textShadow: "0 0 18px rgba(80,160,255,0.5)",
  }, "LAST CIRCLE", topBar);   // no studio/site branding inside the game itself
  // LC-82: the top bar named a season (number one) the game does not have (no season object, no pass, no reset)
  h("div", { fontSize: "12px", opacity: "0.55", letterSpacing: "2px", fontWeight: "600" }, "FREE TO PLAY", topBar);

  // center stack. A centred column TALLER than the viewport overflows at BOTH
  // ends, and the top end cannot be scrolled to: at 1280x720 the wordmark's top
  // sat at -57 px and at 1366x768 at -33 px (feel-juice-ui G6, measured). Now
  // the column starts at the top and scrolls when it has to; the auto margins on
  // its first and last children still centre it whenever it fits. Short
  // viewports also get a compact layout (tighter gaps, smaller preview stage,
  // no tagline) so the common laptop sizes need little or no scroll.
  // LC-83 MENU FIT. At 1280x720 the reticle swatches were clipped 9 px and the key-hint line sat 36-80 px below the fold; at 1366x768 and
  // 1536x864 the hint was under the fold too (parity audit + p1d_menu probe). On a MOUSE desktop the compact layout now starts below 920 px,
  // and below 800 px a SHORT layout tightens the stack further (smaller wordmark and preview stage, tighter cards and gaps). A touch device
  // keeps exactly the old rule and sizes (its TOUCH_CSS owns the phone layout; phone support is unchanged).
  const IH = window.innerHeight || 900;
  const compact = IH < (touchOn ? 860 : 920);
  const short = !touchOn && IH < 800;
  const wrap = h("div", {
    position: "absolute", inset: "0", display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "flex-start", gap: short ? "8px" : compact ? "12px" : "20px",
    padding: short ? "56px 24px 8px" : compact ? "58px 24px 16px" : "64px 24px 40px", boxSizing: "border-box",
    overflowY: "auto", overflowX: "hidden",
  }, null, L);
  wrap.dataset.lc = "menuwrap";

  // title block
  const titleBlock = h("div", { textAlign: "center", marginTop: "auto", animation: "lcTitleIn .9s cubic-bezier(.2,.8,.2,1) both" }, null, wrap);
  titleBlock.dataset.lc = "titleblock";
  const wordmark = h("div", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: short ? "min(72px, 7vw, 7vh)" : "min(72px, 7vw, 9vh)", fontWeight: "900", lineHeight: "1.15",
    letterSpacing: "10px",
    background: "linear-gradient(180deg, #ffffff 10%, #a8d4ff 55%, #4a9fff 100%)",
    WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
    filter: "drop-shadow(0 0 32px rgba(80,160,255,0.55)) drop-shadow(0 6px 4px rgba(0,0,0,0.55))",
  }, "LAST CIRCLE", titleBlock);
  wordmark.dataset.lc = "wordmark";
  // Level / XP / career on the MENU. All of it existed already but was only ever
  // visible on the one post-match screen, so between sessions the game showed
  // the player no evidence they had ever played it.
  if (!W.progress) W.progress = loadProgress();
  {
    const pr = W.progress, c = pr.career || {};
    const need = xpForLevel(pr.level);
    const strip = h("div", {
      display: "flex", alignItems: "center", gap: "10px", marginTop: short ? "6px" : "10px",
      padding: "6px 14px", borderRadius: "10px", background: "rgba(4,12,24,0.5)",
      border: "1px solid rgba(120,180,255,0.18)", fontFamily: "Rajdhani, " + FONT,
    }, null, titleBlock);
    strip.dataset.lc = "strip";
    h("div", { fontSize: "13px", fontWeight: "900", color: "#ffd873", letterSpacing: "1px" }, "LVL " + pr.level, strip);
    // The rank is what a level MEANS once the skin track has run out at 10.
    // Deliberately not in the kill feed — that line is already name + weapon at
    // 12px and a title makes it unreadable.
    h("div", { fontSize: FS(11), fontWeight: "800", color: "#9fd7ff", letterSpacing: "1.5px", opacity: "0.9" }, rankLabel(pr.level), strip);
    const barW = h("div", { width: "120px", height: "8px", background: "rgba(0,0,0,0.55)", borderRadius: "4px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.15)" }, null, strip);
    h("div", { width: Math.min(100, (pr.xp / need) * 100) + "%", height: "100%", background: "linear-gradient(90deg,#4aa8ff,#7ad0ff)" }, null, barW);
    h("div", { fontSize: FS(11), opacity: "0.75", letterSpacing: "1px" }, pr.xp + " / " + need + " XP", strip);
    if (c.matches) {
      // damage and timeAliveS were accumulated every match and read by NOTHING —
      // two of the seven career fields were write-only. Show them.
      h("div", {
        fontSize: FS(11.5), opacity: "0.8", letterSpacing: "1px", borderLeft: "1px solid rgba(255,255,255,0.18)", paddingLeft: "10px",
      }, c.matches + (c.matches === 1 ? " match · " : " matches · ") + c.wins + (c.wins === 1 ? " win · " : " wins · ") + c.kills + (c.kills === 1 ? " kill" : " kills") + (c.bestPlacement ? " · best #" + c.bestPlacement : "")
         + (c.damage ? " · " + Math.round(c.damage / 1000) + "k dmg" : "") + (c.timeAliveS ? " · " + (c.timeAliveS / 3600).toFixed(1) + "h" : ""), strip);
    }
    // Coming back tomorrow rather than in a month is worth naming.
    if (pr.dayStreak > 1) {
      h("div", { fontSize: FS(11.5), color: "#ffb36a", letterSpacing: "1px", borderLeft: "1px solid rgba(255,255,255,0.18)", paddingLeft: "10px" },
        "🔥 " + pr.dayStreak + "-DAY STREAK", strip);
    }
    // Reads the whole reward table, not just MENU_SKINS: the skins are exhausted
    // at level 10, so a skins-only lookup named no target for anyone past it.
    const nextRw = rewardTable().filter((e) => e.lvl > pr.level).sort((a, b) => a.lvl - b.lvl)[0];
    h("div", { fontSize: FS(11.5), color: "#9fd7ff", letterSpacing: "1px", borderLeft: "1px solid rgba(255,255,255,0.18)", paddingLeft: "10px" },
      nextRw ? "NEXT: " + nextRw.kind + " " + nextRw.name + " @ LVL " + nextRw.lvl : "MAX RANK · NEXT: " + careerGoal(c), strip);
  }
  // DAILIES — the only thing on any screen that is different because it is a new
  // day. Computed once at render: the menu is rebuilt on every entry, so there
  // is no interval here to leak.
  if (W.daily) {
    const dp = h("div", {
      display: "flex", flexDirection: "column", gap: short ? "1px" : "3px", marginTop: short ? "6px" : "8px",
      padding: short ? "6px 14px" : "8px 14px", borderRadius: "10px", background: "rgba(4,12,24,0.5)",
      border: "1px solid rgba(255,190,110,0.22)", fontFamily: "Rajdhani, " + FONT,
      // titleBlock runs lcTitleIn, which ENDS on letter-spacing:10px with
      // fill-mode both — so every descendant inherited 10px tracking and the
      // challenge lines rendered as "G e t   3   e l i m i n a t i o n s".
      // Reset it here; the header below re-asserts its own deliberate spacing.
      letterSpacing: "normal",
    }, null, titleBlock);
    dp.dataset.lc = "daily";
    const mins = Math.max(0, Math.round(msToMidnight() / 60000));
    h("div", { fontSize: FS(10.5), fontWeight: "900", letterSpacing: "2.5px", color: "#ffb36a" },
      "DAILY CHALLENGES  ·  RESETS IN " + Math.floor(mins / 60) + "h " + (mins % 60) + "m", dp);
    for (const c of dailyChallenges(W)) {
      const row = h("div", { display: "flex", gap: "10px", alignItems: "center", fontSize: "12.5px", letterSpacing: "0.2px" }, null, dp);
      h("div", { width: "14px", opacity: c.done ? "1" : "0.75" }, c.done ? "✔" : (CHAL_ICON[c.id] || "🎯"), row);
      h("div", { flex: "1", textAlign: "left", opacity: c.done ? "0.55" : "0.95", textDecoration: c.done ? "line-through" : "none" }, c.label, row);
      h("div", { fontWeight: "900", color: c.done ? "#8fa4bb" : "#ffd873", whiteSpace: "nowrap", marginLeft: "auto" }, "+" + c.xp + " XP", row);
    }
    if (!W.daily.firstWin) h("div", { fontSize: FS(11), opacity: "0.75", color: "#9fd7ff", textAlign: "left", letterSpacing: "0.2px" }, "First win today  ·  +750 XP", dp);
  }
  if (!compact) h("div", {
    fontFamily: "Rajdhani, " + FONT, fontSize: "15px", fontWeight: "600",
    letterSpacing: "6px", color: "#b8d8ff", opacity: "0.85", marginTop: "6px",
    textShadow: "0 2px 12px rgba(0,0,0,0.8)",
  }, "50 DROP  ·  ONE STANDS  ·  THE STORM CLOSES", titleBlock);

  const cols = h("div", {
    display: "flex", gap: "28px", alignItems: "stretch", flexWrap: "wrap",
    justifyContent: "center", animation: "lcPanelIn .7s .15s cubic-bezier(.2,.8,.2,1) both",
  }, null, wrap);
  cols.dataset.lc = "cols";
  const leftCol = h("div", { display: "flex", flexDirection: "column", gap: "10px", justifyContent: "center", minWidth: "300px" }, null, cols);
  leftCol.dataset.lc = "leftcol";

  // A first-time visitor clicks the TOP card, and the top card was the 50-player
  // standard drop: lobby, then a 12 s landing-zone map, then a ~26 s parachute
  // before the first trigger pull. QUICK MATCH is the same game with the transit
  // removed (SIM.MODE.quick: ground drop, startRadiusFrac 0.75, lootMult 1.8,
  // storm phase 1 at 30 s against standard's 80 s). Sort order and a string — no
  // mode added, none removed, map still random.
  const rookie = !(W.progress && W.progress.career && W.progress.career.matches > 0);
  const cards = rookie ? [MODE_CARDS[1], MODE_CARDS[0], MODE_CARDS[2]] : MODE_CARDS;
  let selMode = rookie ? "quick" : (W.mode === "practice" ? "practice" : (W.mode || "standard"));
  const modeIcons = { standard: "⚔", quick: "⚡", practice: "◎" };
  const modeEls = cards.map((m, i) => {
    const c = h("div", Object.assign({
      padding: short ? "10px 20px 10px 16px" : "14px 20px 14px 16px", cursor: "pointer", minWidth: "300px",
      position: "relative", overflow: "hidden", animation: `lcPanelIn .55s ${0.2 + i * 0.06}s both`,
    }, PANEL), null, leftCol);
    c.className = "lc-mode-card lc-glass-scan";
    const row = h("div", { display: "flex", gap: "14px", alignItems: "center" }, null, c);
    h("div", {
      width: "40px", height: "40px", borderRadius: "10px", display: "flex", alignItems: "center",
      justifyContent: "center", fontSize: "18px",
      background: "linear-gradient(145deg, rgba(87,176,255,0.25), rgba(40,90,160,0.15))",
      border: "1px solid rgba(140,200,255,0.25)",
    }, modeIcons[m.id] || "●", row);
    const txt = h("div", { flex: "1" }, null, row);
    h("div", {
      fontFamily: "Orbitron, " + FONT_DISPLAY, fontWeight: "800", fontSize: "14px",
      letterSpacing: "2px", color: "#eaf4ff",
    }, m.name, txt);
    h("div", { fontFamily: "Rajdhani, " + FONT, fontSize: "14px", fontWeight: "500", opacity: "0.72", marginTop: "2px", color: "#b8d0ea" }, m.sub, txt).dataset.sub = "1";
    if (rookie && m.id === "quick") {
      h("div", {
        fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: FS(10), fontWeight: "900",
        letterSpacing: "1.6px", color: "#0a1a2c", background: "linear-gradient(180deg,#8fe0ff,#3fa9e8)",
        borderRadius: "5px", padding: "3px 7px", marginTop: "5px", display: "inline-block",
      }, "START HERE", txt).dataset.lc = "rookiechip";
      // the tail drops on a phone on its side, where the full line wrapped to
      // three lines inside the card
      // LC-82: the chip promised a fight ten seconds after the click, against a measured 26-30 s cold; what IS true is the point of the mode
      h("span", null, " · NO PARACHUTE, STRAIGHT TO THE FIGHT", txt.lastChild).dataset.lc = "chiptail";
    }
    // the card IS the play button — one click launches this mode (no separate DROP IN)
    h("div", {
      fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "16px", fontWeight: "900",
      color: "#8ec8ff", opacity: "0.85", paddingLeft: "6px",
      textShadow: "0 0 14px rgba(80,160,255,0.6)",
    }, "▶", row);
    c.onclick = () => {
      selMode = m.id; W.events.emit("uiClick"); paint();
      teardownMenuWorld(W);
      // C-MODE: the team size rides along as `teamMode` (solo / duo / trio / squad; practice is always solo). `mode` keeps
      // meaning the pace (standard / quick / practice) the orchestrator has always read.
      const team = m.id === "practice" || touchOn ? "solo" : selTeam;
      W.teamMode = team;
      startMatch({ mapId: randomMap(), mode: m.id, teamMode: team, team });   // lane boot reads opts.teamMode (C-MODE)
    };
    // Tab-reachable. SQUAD UP / SETTINGS / HOW TO PLAY and the locker arrows are
    // real <button>s, so the keyboard reached everything on this screen EXCEPT
    // the only three controls that start a match — these cards were plain divs
    // with a mouse handler. (Map stays random; this is focus, not a picker.)
    c.tabIndex = 0;
    c.setAttribute("role", "button");
    c.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); c.onclick(); } };
    return { m, c };
  });
  function paint() {
    modeEls.forEach(({ m, c }) => {
      const on = m.id === selMode;
      c.classList.toggle("sel", on);
      Object.assign(c.style, on ? PANEL_HOT : PANEL);
      c.style.borderLeft = on ? "3px solid #57b0ff" : "1px solid rgba(140,200,255,0.28)";
    });
  }
  paint();

  // (No separate DROP IN button — each mode card above launches on click.)
  // C-MODE (owner OD-4): SOLO / DUOS / TRIOS / SQUADS - the size of YOUR team in BATTLE ROYALE and QUICK MATCH; bots fill it
  // (no ranked). It takes the old "choose a mode" line's place on a mouse desktop (same height, so the menu still fits at
  // 1280x720); a touch device keeps that line (phones unchanged: they play solo).
  let selTeam = TEAM_MODES[W.settings && W.settings.teamMode] ? W.settings.teamMode : "solo";
  ensureTeamStyles();
  const teamRow = h("div", { marginTop: short ? "0px" : "4px", marginBottom: "0px", animation: "lcPanelIn .55s .38s both" }, null, leftCol);
  teamRow.className = "lc-teamrow kbd-hint"; teamRow.dataset.lc = "teamrow";
  h("span", null, "TEAM", teamRow).className = "tl";
  const teamBtns = TEAM_OPTS.map(([id, lbl]) => {
    const b = h("button", null, lbl, teamRow);
    b.dataset.team = id;
    b.title = id === "solo" ? "Every player for themselves" : "You and " + (TEAM_MODES[id] - 1) + " bot teammate" + (TEAM_MODES[id] > 2 ? "s" : "") + " — knocked players can be revived";
    b.onclick = () => { selTeam = id; W.settings.teamMode = id; save(W); W.events.emit("uiClick"); paintTeam(); };
    return b;
  });
  function paintTeam() {
    teamBtns.forEach((b) => b.classList.toggle("on", b.dataset.team === selTeam));
    // the cards' sub-line names the team size (practice stays solo)
    modeEls.forEach(({ m, c }) => {
      const sub = c.querySelector("[data-sub]");
      if (sub) sub.textContent = m.id === "practice" || selTeam === "solo" ? m.sub : m.sub.replace("last one standing", "last team standing");
    });
  }
  paintTeam();
  h("div", {
    fontFamily: "Rajdhani, " + FONT, fontSize: "12px", fontWeight: "700",
    letterSpacing: "2.5px", color: "#9fd0ff", opacity: "0.7", textAlign: "center",
    marginTop: short ? "2px" : "6px", marginBottom: "2px", animation: "lcGlow 3.2s ease-in-out infinite",
  }, "◂  CHOOSE A MODE TO DEPLOY  ▸", leftCol).className = "lc-touch-only";

  const subRow = h("div", { display: "flex", gap: "10px" }, null, leftCol);
  const mkGhost = (label, parent) => h("button", Object.assign({}, BTN, {
    flex: "1", fontSize: "12px", padding: short ? "10px 8px" : "12px 8px",
    background: "rgba(255,255,255,0.06)", color: "#cfe4ff",
    border: "1px solid rgba(140,200,255,0.2)",
    fontFamily: "Rajdhani, " + FONT, fontWeight: "700", letterSpacing: "1.5px",
  }), label, parent);
  const online = mkGhost("🌐  SQUAD UP", subRow);
  online.onclick = () => { W.events.emit("uiClick"); W.events.emit("openOnline", { mode: selMode }); };
  const settings = mkGhost("⚙  SETTINGS", subRow);
  settings.onclick = () => { W.events.emit("uiClick"); showSettings(W); };
  const howTo = mkGhost("❔  HOW TO PLAY", subRow);
  howTo.onclick = () => { W.events.emit("uiClick"); showHowToPlay(W); };
  // Own row: the three above are already ~93px wide inside a 300px column and a
  // fourth would wrap "SQUAD UP" onto two lines.
  const subRow2 = h("div", { display: "flex", gap: "10px" }, null, leftCol);
  const career = mkGhost("📊  CAREER", subRow2);
  career.onclick = () => { W.events.emit("uiClick"); showCareer(W); };
  // First run gets it unprompted. A browser BR is opened cold from a link with
  // no manual and no install — there was no onboarding of ANY kind, and two of
  // the verbs (the emotes) appeared nowhere at all until ?v=67.
  // The handle used to be discarded, so nothing could cancel it: click a mode
  // card inside that 500 ms window and the tutorial opened as a blocking
  // zIndex-70 modal OVER the drop-select — whose 12 s auto-lock kept counting
  // behind it, so a first-run player lost their landing zone to a timer.
  try {
    if (!localStorage.getItem("lc_seen_intro")) R._introT = setTimeout(() => { R._introT = null; showHowToPlay(W); }, 500);
  } catch (e) {}
  // (The "KEYBOARD + MOUSE REQUIRED" first-run card for touch-only visitors is
  // gone: phones have a native touch layer now — royale/touch.js — and go
  // straight to this menu like desktop. Wave 3, after mobile.py passed 48/48.)

  // — SKIN BAY: premium 3D turntable —
  const bay = h("div", Object.assign({
    width: "320px", padding: short ? "10px 18px 10px" : "16px 18px 14px", display: "flex", flexDirection: "column",
    alignItems: "center", gap: "8px", position: "relative", overflow: "hidden",
  }, PANEL), null, cols);
  bay.className = "lc-glass-scan";
  bay.dataset.lc = "bay";
  h("div", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: FS(11), letterSpacing: "3px",
    opacity: "0.7", fontWeight: "800", color: "#9fd0ff",
  }, "OPERATIVE", bay);
  const STG = short ? 168 : compact ? 220 : 280;
  const stage = h("div", {
    position: "relative", width: STG + "px", height: STG + "px", borderRadius: "14px",
    overflow: "hidden",
    background: "radial-gradient(ellipse at 50% 78%, rgba(87,176,255,0.28) 0%, rgba(8,18,36,0.5) 45%, rgba(4,10,20,0.85) 100%)",
    border: "1px solid rgba(120,190,255,0.25)",
    boxShadow: "inset 0 0 40px rgba(40,120,255,0.12), 0 0 24px rgba(40,100,200,0.15)",
  }, null, bay);
  stage.dataset.lc = "stage";
  // chrome corners
  [["0","0","borderTop","borderLeft"], ["0","auto","borderTop","borderRight"], ["auto","0","borderBottom","borderLeft"], ["auto","auto","borderBottom","borderRight"]]
    .forEach(([t, r, a, b], i) => {
      const c = h("div", {
        position: "absolute", width: "18px", height: "18px", top: t === "0" ? "8px" : "auto",
        bottom: t === "auto" ? "8px" : "auto", left: r === "0" ? "8px" : "auto",
        right: r === "auto" ? "8px" : "auto", pointerEvents: "none", zIndex: 2,
      }, null, stage);
      c.style[a] = "2px solid rgba(120,200,255,0.7)";
      c.style[b] = "2px solid rgba(120,200,255,0.7)";
    });
  // Hidden until the operative's first menu clip is playing: the three menu
  // clips are awaited GLB fetches, and until they land the stage showed a
  // T-posed or empty rig (feel-juice-ui G6: T-pose at ~2.5 s, empty at 1366x768).
  const pvCv = h("canvas", { width: STG + "px", height: STG + "px", display: "block", opacity: "0", transition: "opacity .3s ease" }, null, stage);
  pvCv.width = 560; pvCv.height = 560;
  pvCv.dataset.lc = "preview";
  const pvShow = (on) => { pvCv.style.opacity = on ? "1" : "0"; pvCv.dataset.shown = on ? "1" : "0"; };
  pvShow(false);
  const nameEl = h("div", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "18px", fontWeight: "800",
    letterSpacing: "2px", color: "#eef6ff", textShadow: "0 0 16px rgba(100,180,255,0.4)",
  }, "", bay);
  const subEl = h("div", {
    fontFamily: "Rajdhani, " + FONT, fontSize: "14px", fontWeight: "600",
    opacity: "0.7", marginTop: "-2px", color: "#a8c8e8", letterSpacing: "1px",
  }, "", bay);
  const nav = h("div", { display: "flex", gap: "10px", alignItems: "center", marginTop: "4px" }, null, bay);
  const mkArrow = (txt) => h("button", Object.assign({}, BTN, {
    padding: "8px 18px", fontSize: "18px", background: "rgba(255,255,255,0.08)",
    color: "#cfe4ff", border: "1px solid rgba(140,200,255,0.25)",
  }), txt, nav);
  const prev = mkArrow("‹");
  const dots = h("div", { display: "flex", gap: "7px" }, null, nav);
  const dotEls = MENU_SKINS.map(() => h("div", {
    width: "9px", height: "9px", borderRadius: "50%",
    background: "rgba(255,255,255,0.22)", transition: "all .18s",
    boxShadow: "0 0 0 0 rgba(87,176,255,0)",
  }, null, dots));
  const next = mkArrow("›");

  // RETICLE swatches — the level 11-30 reward content. Locked ones stay visible
  // and browsable for the same reason locked skins do: seeing what level 22 buys
  // you is the point of a locker.
  h("div", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: FS(10), letterSpacing: "2.5px",
    opacity: "0.6", fontWeight: "800", color: "#9fd0ff", marginTop: "6px",
  }, "RETICLE", bay);
  const swRow = h("div", { display: "flex", gap: "7px", alignItems: "center" }, null, bay);
  swRow.dataset.lc = "swatchrow";
  const swEls = CROSS_COLORS.map((cc, i) => {
    const b = h("button", {
      width: "26px", height: "26px", borderRadius: "7px", cursor: "pointer", padding: "0",
      background: cc.css, border: "1px solid rgba(255,255,255,0.25)",
    }, null, swRow);
    b.dataset.lc = "swatch";
    b.title = cc.name + ((cc.unlockLevel || 1) > 1 ? " · LVL " + cc.unlockLevel : "");
    b.onclick = () => {
      if ((cc.unlockLevel || 1) > ((W.progress && W.progress.level) || 1)) return;
      W.settings.crossColor = i; save(W);
      R._crossFor = null;        // forces paintCrosshair to rebuild next frame
      W.events.emit("uiClick");
      paintSwatches();
    };
    return b;
  });
  function paintSwatches() {
    const lvl = (W.progress && W.progress.level) || 1;
    const sel = CROSS_COLORS.indexOf(playableColor(CROSS_COLORS, W.settings.crossColor, W));
    swEls.forEach((b, i) => {
      const ok = (CROSS_COLORS[i].unlockLevel || 1) <= lvl;
      b.style.opacity = ok ? "1" : "0.28";
      b.style.cursor = ok ? "pointer" : "not-allowed";
      b.style.border = i === sel ? "2px solid #ffffff" : "1px solid rgba(255,255,255,0.25)";
      b.style.boxShadow = i === sel ? "0 0 10px rgba(255,255,255,0.55)" : "none";
    });
  }
  paintSwatches();

  let skinIdx = Math.max(0, MENU_SKINS.findIndex((s) => s.key === getChosenSkin()));
  let pvRig = null, pvRunning = true, pvBones = null, poseMod = null, pvIdleRelax = false;
  import("./pose.js" + (new URL(import.meta.url).search || "")).then((m) => { poseMod = m; });
  const pvScene = new THREE.Scene();
  const pvCam = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
  pvCam.position.set(0, 1.2, 3.4); pvCam.lookAt(0, 0.95, 0);
  pvScene.add(new THREE.HemisphereLight(0xd8f0ff, 0x1a2838, 1.15));
  const pvKey = new THREE.DirectionalLight(0xfff2e0, 2.4); pvKey.position.set(2.4, 3.6, 2.8); pvScene.add(pvKey);
  const pvRim = new THREE.DirectionalLight(0x57b0ff, 1.8); pvRim.position.set(-2.6, 2.4, -2.2); pvScene.add(pvRim);
  const pvKick = new THREE.DirectionalLight(0xff8866, 0.55); pvKick.position.set(0, 1, -3); pvScene.add(pvKick);
  // reflective stage floor
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(1.05, 1.15, 0.08, 48),
    // metalness 0.65 + envMapIntensity was a claim the renderer could not honour:
    // with no scene.environment a metal surface loses its diffuse and gains no
    // reflection back, so the "reflective" stage disc rendered as a black hole.
    new THREE.MeshStandardMaterial({ color: 0x152a42, roughness: 0.35, metalness: 0.1 })
  );
  disc.position.y = -0.04;
  pvScene.add(disc);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.08, 0.025, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0x57b0ff, transparent: true, opacity: 0.55, toneMapped: false })
  );
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.02;
  pvScene.add(ring);
  // soft ground glow
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(1.4, 32),
    new THREE.MeshBasicMaterial({ color: 0x3a8fff, transparent: true, opacity: 0.12, toneMapped: false })
  );
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.01;
  pvScene.add(glow);

  const pvR = new THREE.WebGLRenderer({ canvas: pvCv, antialias: true, alpha: true, powerPreference: "high-performance" });
  pvR.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  pvR.setSize(560, 560, false);
  pvR.toneMapping = THREE.ACESFilmicToneMapping;
  pvR.toneMappingExposure = 1.15;
  pvR.outputColorSpace = THREE.SRGBColorSpace;

  async function setSkin(i) {
    skinIdx = (i + MENU_SKINS.length) % MENU_SKINS.length;
    pvShow(false);
    const meta = MENU_SKINS[skinIdx];
    // Locked skins stay browsable — seeing what level 10 buys you is the point
    // of a locker — but they are not equipped and not persisted.
    const unlocked = skinUnlocked(W, meta);
    nameEl.textContent = meta.name;
    nameEl.style.opacity = unlocked ? "1" : "0.55";
    subEl.textContent = unlocked ? meta.sub.toUpperCase() : "🔒 LOCKED · REACHES LEVEL " + meta.unlockLevel;
    subEl.style.color = unlocked ? "" : "#ffcc66";
    dotEls.forEach((d, j) => {
      const on = j === skinIdx;
      const jUnlocked = skinUnlocked(W, MENU_SKINS[j]);
      d.style.background = on ? (unlocked ? "#57b0ff" : "#ffcc66") : jUnlocked ? "rgba(255,255,255,0.22)" : "rgba(255,204,102,0.28)";
      d.style.boxShadow = on ? "0 0 10px " + (unlocked ? "rgba(87,176,255,0.8)" : "rgba(255,204,102,0.8)") : "none";
      d.style.transform = on ? "scale(1.25)" : "scale(1)";
    });
    if (unlocked) { try { localStorage.setItem("lc_skin", meta.key); } catch (e) {} }
    try {
      const rig = await W.kernel.loadCharacter(W.assetBase + "assets/chars/meshy/" + meta.key + ".glb");
      if (pvRig) { pvScene.remove(pvRig.scene); W.kernel.disposeMixer(pvRig.mixer); }
      pvRig = rig;
      pvShow(false);          // a slower earlier setSkin may have revealed the old rig meanwhile
      rig.scene.position.set(0, 0, 0);
      pvScene.add(rig.scene);
      // Drive the rig IMMEDIATELY. kernel.loadCharacter() never auto-plays a
      // clip, and the cheer/dance actions below are two awaited GLB fetches away
      // — until they land the preview loop was rendering an undriven SkinnedMesh,
      // which reads as a collapsed ~0.1 m armature (see player.js:231), not a
      // neutral T-pose. The later play() calls crossfade off this one normally.
      if (rig.animations && rig.animations[0]) rig.play(rig.animations[0].name);
      pvBones = poseMod ? poseMod.findArmBones(rig.scene) : null;
      // OWNER 2026-07-28 ("they should be doing emojis, or standing, or posing
      // like they are shooting"): locker flow = rifle-ready pose, then cheer,
      // then dance on loop. All three are Mixamo clips (Mixamo-only directive).
      const menuClips = {};
      for (const c of ["rifle_idle", "cheer", "dance"]) {
        try {
          const g = await W.kernel.loader.loadAsync(W.assetBase + "assets/chars/meshy/" + meta.key + "_" + c + ".glb");
          if (g.animations && g.animations[0]) {
            g.animations[0].name = c + "_menu";
            rig.actions[c + "_menu"] = rig.mixer.clipAction(g.animations[0]);
            menuClips[c] = g.animations[0];
          }
        } catch (e) {}
      }
      if (pvRig !== rig) return;
      pvIdleRelax = !menuClips.rifle_idle && !menuClips.cheer && !menuClips.dance;
      if (menuClips.rifle_idle) rig.play("rifle_idle_menu");
      // first clip resolved (or none exist and the relax pose takes over): the
      // rig is driven now, so it may be seen. With only cheer/dance the reveal
      // waits for that clip's timer below.
      if (menuClips.rifle_idle || pvIdleRelax) pvShow(true);
      const tCheer = menuClips.rifle_idle ? 2400 : 0;
      if (menuClips.cheer) {
        setTimeout(() => {
          if (pvRig !== rig) return;
          rig.play("cheer_menu", { once: true });
          pvShow(true);
          if (menuClips.dance) setTimeout(() => { if (pvRig === rig) rig.play("dance_menu"); }, Math.max(400, menuClips.cheer.duration * 1000 - 250));
        }, tCheer);
      } else if (menuClips.dance) {
        setTimeout(() => { if (pvRig === rig) { rig.play("dance_menu"); pvShow(true); } }, tCheer);
      }
    } catch (e) { pvShow(true); /* still baking — show whatever the stage has rather than an empty box forever */ }
  }
  prev.onclick = () => { W.events.emit("uiClick"); setSkin(skinIdx - 1); };
  next.onclick = () => { W.events.emit("uiClick"); setSkin(skinIdx + 1); };
  setSkin(skinIdx);
  (function pvLoop() {
    if (!pvRunning || !R.menu || !R.menu.isConnected) {
      pvR.dispose();
      if (pvRig) W.kernel.disposeMixer(pvRig.mixer);
      return;
    }
    const t = performance.now() / 1000;
    if (pvRig) {
      pvRig.scene.rotation.y += 0.01;
      if (pvIdleRelax && poseMod) {
        if (!pvBones) pvBones = poseMod.findArmBones(pvRig.scene);
        if (pvBones) poseMod.applyArmPose(pvRig.scene, pvBones, "relax", 1);
      }
    }
    if (ring) ring.material.opacity = 0.4 + Math.sin(t * 2) * 0.15;
    if (glow) glow.material.opacity = 0.08 + Math.sin(t * 1.5) * 0.04;
    pvR.render(pvScene, pvCam);
    requestAnimationFrame(pvLoop);
  })();
  R._menuStopPv = () => { pvRunning = false; };

  // bottom controls strip — the LIVE bindings, not the defaults. This string was
  // hardcoded, so after a rebind (and after switching sprint to HOLD in
  // Settings) the menu confidently taught keys that no longer did anything.
  const mk = (canonical) => { const ph = physFor(W, canonical); return ph ? keyLabel(ph) : "—"; };
  // Two twins, one shown: .kbd-hint (keyboard + mouse) and .lc-touch-only (the
  // touch layer). TOUCH_CSS swaps them on html.lc-touch, so a phone never reads
  // "WASD MOVE · MOUSE AIM" and a desktop never reads "LEFT THUMB".
  const hintStyle = {
    fontFamily: "Rajdhani, " + FONT, fontSize: "13px", fontWeight: "600",
    opacity: "0.6", maxWidth: "820px", textAlign: "center",
    letterSpacing: "0.5px", color: "#c0d4ec", lineHeight: short ? "1.45" : "1.7",
    textShadow: "0 2px 8px rgba(0,0,0,0.9)",
    animation: "lcPanelIn .6s .4s both",
    marginBottom: "auto",       // pairs with the title block's marginTop: auto
  };
  const touchHint = h("div", Object.assign({}, hintStyle, { opacity: "0.75" }),
    "LEFT THUMB MOVE  ·  RIGHT THUMB LOOK  ·  HOLD FIRE  ·  ADS AIMS  ·  JUMP / CHUTE  ·  TAP USE TO LOOT, HOLD FOR CHESTS  ·  TAP A SLOT TO SWITCH  ·  TAP THE MINIMAP FOR THE MAP", null);
  touchHint.className = "lc-touch-only";
  touchHint.dataset.lc = "touchhint";
  const kbdHint = h("div", hintStyle,
  mk("KeyW") + mk("KeyA") + mk("KeyS") + mk("KeyD") + " MOVE  ·  MOUSE AIM/FIRE  ·  RMB ADS  ·  " +
  mk("Space") + " JUMP / CHUTE  ·  " + mk("ShiftLeft") + " SPRINT (" + (W.settings && W.settings.sprintToggle ? "TOGGLE" : "HOLD") + ")  ·  " +
  mk("KeyR") + " RELOAD  ·  " + mk("KeyE") + " LOOT  ·  " + mk("Digit1") + "–" + mk("Digit5") + " WEAPONS  ·  " + mk("KeyM") + " MAP" +
  "  ·  MMB / " + mk(PING_KEY) + " PING" +          // LC-07: the new verb, named where the others are (kept on one line)
  // the two new verbs are invisible without this line — a feature nobody can
  // discover is a feature that doesn't exist
  "  ·  JUMP AT A LEDGE = CLIMB  ·  " + mk("ShiftLeft") + " WHILE SCOPED = HOLD BREATH",
  wrap);
  kbdHint.className = "kbd-hint";
  kbdHint.dataset.lc = "kbdhint";
  // both twins carry the bottom auto-margin that centres the column: the hidden
  // one is display:none, so only the shown one takes part
  wrap.insertBefore(touchHint, kbdHint);

  import("./audio.js" + (new URL(import.meta.url).search || "")).then((m) => m.startMenuMusic(W));
}

export function showLoading(W, text) {
  // a new match must clear every stray screen from the previous one — including
  // the first-run How To Play, which was neither in this list nor cancellable
  if (R._introT) { clearTimeout(R._introT); R._introT = null; }
  ["post", "death", "pause", "settings", "bigmap", "howto", "career", "menu", "hud"].forEach((n) => { if (R[n]) { R[n].remove(); R[n] = null; } });
  teardownMenuWorld(W);
  W.paused = false;
  ensureAAAStyles();
  const L = layer("loading", {
    pointerEvents: "auto", display: "flex", alignItems: "center", justifyContent: "center",
    background: "radial-gradient(ellipse at 50% 40%, rgba(20,40,70,0.55) 0%, rgba(4,10,20,0.92) 70%, rgba(2,6,12,0.97) 100%)",
  });
  const box = h("div", Object.assign({ textAlign: "center", padding: "36px 48px", minWidth: "360px", maxWidth: "min(520px, calc(100vw - 32px))", boxSizing: "border-box" }, PANEL), null, L);
  box.dataset.lc = "loadbox";
  h("div", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "28px", fontWeight: "900", letterSpacing: "6px",
    background: "linear-gradient(180deg,#fff,#7eb8ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
  }, "LAST CIRCLE", box);
  // LC-23: WHERE you are going and HOW, on the screen you stare at for 10-25 s. The orchestrator's text is "Building <map>…"; the map id and
  // mode are on W already (set before showLoading), so the card can name both even when the text is empty (recoverToMenu's blank call).
  const mapLbl = mapLabel(W.mapId);
  if (text && mapLbl) {
    const tmL = W.mode !== "practice" && TEAM_MODES[W.teamMode] > 1 ? "  ·  " + TEAM_WORD[W.teamMode] : "";   // C-MODE
    const modeLbl = (W.mode === "quick" ? "QUICK MATCH" : W.mode === "practice" ? "PRACTICE" : "BATTLE ROYALE") + tmL;
    const ml = h("div", {
      fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "13px", fontWeight: "800", letterSpacing: "3px", color: "#8ec8ff", marginTop: "12px",
    }, mapLbl.toUpperCase() + "  ·  " + modeLbl, box);
    ml.dataset.lc = "loadmap";
  }
  h("div", {
    fontFamily: "Rajdhani, " + FONT, fontSize: "16px", fontWeight: "600", opacity: "0.85",
    marginTop: "10px", letterSpacing: "2px", color: "#b8d4f0",
  }, text || "DEPLOYING…", box);
  const bar = h("div", {
    width: "300px", height: "4px", background: "rgba(255,255,255,0.1)", borderRadius: "2px",
    margin: "22px auto 0", overflow: "hidden", border: "1px solid rgba(120,180,255,0.2)",
  }, null, box);
  // Fill animates with transform: scaleX, not width — a width transition is a
  // layout per frame under the loading screen, the one screen that is already
  // fighting the asset decode for the main thread.
  const fill = h("div", {
    width: "100%", height: "100%", transformOrigin: "0 50%", transform: "scaleX(0.3)",
    background: "linear-gradient(90deg,#2f7fd6,#6ec4ff,#2f7fd6)", backgroundSize: "200% 100%",
    borderRadius: "2px", transition: "transform .4s", animation: "lcShimmer 1.6s linear infinite",
    boxShadow: "0 0 12px rgba(87,176,255,0.6)", willChange: "transform",
  }, null, bar);
  fill.dataset.lc = "loadfill";
  const setFill = (pct) => { fill.style.transform = "scaleX(" + (pct / 100).toFixed(3) + ")"; };
  // The bar was pure animation — seeded at 30% and adding 8% every 300 ms up to a
  // 92% ceiling, tied to nothing — so it always parked at 92% while the real GLB
  // requests were still in flight, which reads as a hang. W.loadProgress is the
  // honest hook; the first real report cancels the creep so the two can never
  // fight over fill.style.width, and the creep survives as the fallback for the
  // case where nothing reports at all. The first 12% is the map build, which
  // reports nothing but only costs a few hundred ms.
  const sub = h("div", {
    fontFamily: "Rajdhani, " + FONT, fontSize: "12px", fontWeight: "600", opacity: "0.6",
    letterSpacing: "1.5px", marginTop: "10px", color: "#9fd0ff",
  }, "BUILDING TERRAIN…", box);
  // LC-23 MONOTONIC. The creep ran to 92 % while the map built, then the first real report reset the fill to 12 + 86 x (1/32) = 15 % - the
  // bar went BACKWARDS (measured: 92 % -> 15 % at 12 s, cold Quick). Now the fill only ever grows: the creep (map build, which reports
  // nothing) eases toward a 55 % ceiling instead of racing to 92, and the real report (operatives loaded / total) fills the rest of the bar
  // FROM wherever the creep had got to. R._loadMax is the high-water mark every write goes through, and a probe reads it.
  R._loadMax = 0;
  const grow = (pct) => { if (pct > R._loadMax) { R._loadMax = pct; setFill(pct); } };
  setFill(0); grow(8);
  let base = null;
  if (R._loadIv) clearInterval(R._loadIv);      // a second showLoading must not orphan the first creep
  R._loadIv = setInterval(() => { grow(R._loadMax + (55 - R._loadMax) * 0.12); }, 300);
  W.loadProgress = (loaded, total) => {
    if (!total) return;
    if (R._loadIv) { clearInterval(R._loadIv); R._loadIv = null; }
    if (base === null) base = R._loadMax;
    const f = Math.min(1, Math.max(0, loaded / total));
    grow(base + (98 - base) * f);
    sub.textContent = f >= 1 ? "GETTING READY TO DROP…" : "LOADING OPERATIVES  " + Math.min(loaded, total) + "/" + total;
  };
  // TIPS: one true line at a time, rotated every 4.5 s while the card is up (the interval dies with the layer)
  const tipEl = h("div", {
    fontFamily: "Rajdhani, " + FONT, fontSize: "14px", fontWeight: "600", lineHeight: "1.45", color: "#cfe2f7", opacity: "0.9",
    marginTop: "18px", paddingTop: "12px", borderTop: "1px solid rgba(140,200,255,0.16)", minHeight: "40px", transition: "opacity .25s",
  }, "", box);
  tipEl.dataset.lc = "loadtip";
  const tips = loadingTips(W);
  let ti = Math.floor(Math.random() * tips.length);
  const showTip = () => { tipEl.textContent = "TIP  ·  " + tips[ti % tips.length]; ti++; };
  showTip();
  if (R._tipIv) clearInterval(R._tipIv);
  R._tipIv = setInterval(() => {
    if (!tipEl.isConnected) { clearInterval(R._tipIv); R._tipIv = null; return; }
    tipEl.style.opacity = "0";
    setTimeout(() => { if (tipEl.isConnected) { showTip(); tipEl.style.opacity = "0.9"; } }, 250);
  }, 4500);
}
/** "isla_viva" -> "Isla Viva" (the three battle maps by name; anything else title-cased from its id). */
function mapLabel(id) {
  if (!id) return "";
  const N = { isla_viva: "Isla Viva", ashgrid: "Ashgrid", deepwood: "Deepwood" };
  return N[id] || String(id).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
/** Loading-screen tips. Every one is true of this build (the keys are the LIVE bindings); a touch player gets the touch wording. */
function loadingTips(W) {
  const k = (c) => { const ph = physFor(W, c); return ph ? keyLabel(ph).toUpperCase() : null; };
  const t = [
    "Shields soak damage before health does. Top them up before you push.",
    "Crouching and standing still both tighten your spread.",
    "Headshots hit harder with every gun but the launcher - the sniper most of all.",
    "Supply drops carry legendary loot, and the map marks where they land.",
    "The storm hurts more as the circles close. The timer at the top says when it moves.",
    "Jump at a low wall or a rooftop edge to climb over it.",
  ];
  if (touchOn) {
    t.push("Push the move stick all the way forward to sprint.");
    t.push("Hold USE at a chest to open it.");
    t.push("Tap the minimap to see the whole map.");
  } else {
    const sh = k("ShiftLeft"), sp = k("Space"), e = k("KeyE"), m = k("KeyM"), z = k(PING_KEY);
    if (sh) t.push(sh + ((W.settings && W.settings.sprintToggle) ? " toggles sprint on and off." : " is sprint - hold it to run."));
    if (sp) t.push("In the air, " + sp + " cuts your chute so you dive faster. " + sp + " again opens it.");
    if (e) t.push("Hold " + e + " at a chest to open it.");
    if (m) t.push(m + " opens the big map. Click it to drop a pin your squad can see.");
    t.push("Middle mouse" + (z ? " or " + z : "") + " pings what you are looking at - a spot, or an enemy.");
  }
  return t;
}

/** Take the loading screen down without showing anything else (lane L4's
 *  failed-match path; feature-detected there): the layer, its creep interval
 *  and the W.loadProgress hook that writes into it. Idempotent. */
export function hideLoading(W) {
  if (R._loadIv) { clearInterval(R._loadIv); R._loadIv = null; }
  if (R._tipIv) { clearInterval(R._tipIv); R._tipIv = null; }
  if (W) W.loadProgress = null;
  if (R.loading) { R.loading.remove(); R.loading = null; }
}

// ═══ LOBBY ═══════════════════════════════════════════════════════════════════
export function showLobby(W, onDone) {
  if (R._loadIv) { clearInterval(R._loadIv); R._loadIv = null; }
  W.loadProgress = null;        // the bar it wrote to is about to be removed
  if (R.loading) { R.loading.remove(); R.loading = null; }
  if (R.menu) { R.menu.remove(); R.menu = null; }
  teardownMenuWorld(W);
  ensureAAAStyles();
  warmIcons(W);                 // the slot thumbnails, one per tick, while the countdown runs (see warmIcons)
  const L = layer("lobby", {
    pointerEvents: "auto",
    background: "radial-gradient(ellipse at 50% 30%, rgba(10,24,48,0.55) 0%, rgba(4,10,20,0.88) 100%)",
  });
  const wrap = h("div", {
    position: "absolute", inset: "0", display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: "18px",
  }, null, L);
  const mapName = (W.map && W.map.K && W.map.K.name) || W.mapId;
  const tmW = teamModeOf(W);
  const modeLabel = (W.mode === "quick" ? "QUICK MATCH" : W.mode === "practice" ? "PRACTICE" : "BATTLE ROYALE") + (W.mode !== "practice" && tmW !== "solo" ? "  ·  " + TEAM_WORD[tmW] : "");
  h("div", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "13px", fontWeight: "800",
    letterSpacing: "4px", color: "#8ec8ff", opacity: "0.85",
  }, "MATCH LOBBY", wrap);
  h("div", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "28px", fontWeight: "900", letterSpacing: "3px",
    textShadow: "0 0 24px rgba(80,160,255,0.4)",
  }, mapName.toUpperCase() + "  ·  " + modeLabel, wrap);
  const count = h("div", {
    fontFamily: "Rajdhani, " + FONT, fontSize: "18px", fontWeight: "600", opacity: "0.9", color: "#c8dff8",
  }, "FILLING LOBBY… 1/" + W.actors.length, wrap);
  const grid = h("div", {
    display: "grid", gridTemplateColumns: "repeat(10, 108px)", gap: "6px", maxWidth: "1180px",
    padding: "16px", borderRadius: "14px",
    background: "rgba(6,14,28,0.55)", border: "1px solid rgba(120,180,255,0.15)",
    boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
  }, null, wrap);
  grid.dataset.lc = "lobbygrid";
  const cells = W.actors.map((a) => {
    const c = h("div", {
      padding: "6px 8px", fontSize: FS(11), borderRadius: "6px",
      background: "rgba(255,255,255,0.04)", color: "transparent",
      overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
      border: "1px solid rgba(255,255,255,0.05)", fontFamily: "Rajdhani, " + FONT, fontWeight: "600",
    }, a.name, grid);
    return c;
  });
  const cd = h("div", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "56px", fontWeight: "900",
    color: "#6ec4ff", minHeight: "64px", textShadow: "0 0 32px rgba(87,176,255,0.55)",
  }, "", wrap);
  if (W.mode === "practice") h("div", { fontSize: "13px", opacity: "0.7", letterSpacing: "1px" }, "SANDBOX — NO STORM · FULL LOADOUT · FIVE RANGE DUMMIES AT 12–80M, DUE SOUTH OF SPAWN", wrap);

  // fill animation then countdown
  let filled = 1;
  cells[0].style.color = "#9fd7ff";
  cells[0].style.background = "rgba(87,176,255,0.22)";
  cells[0].style.borderColor = "rgba(87,176,255,0.45)";
  cells[0].style.boxShadow = "0 0 12px rgba(87,176,255,0.25)";
  // Driven by ELAPSED TIME, not a random 3-7 cells per 140 ms tick. The random
  // step made the lobby's DURATION random (0.98-2.38 s for a 50-slot roster), so
  // online clients left for the drop at different wall-clock times and their
  // match clocks were offset from the first frame. Shortened at the same time:
  // loadActorModels has already resolved (ffg_royale3d.js:291) before showLobby
  // is called at :304, so nothing is loading behind this screen and the fill
  // reads the same at 0.7 s as it did at 1.4 s. The 900 ms countdown below is
  // NOT touched — the 3-count is an audible beat (countdownBeep) and shortening
  // it desyncs the beeps from the numbers.
  const FILL_MS = W.mode === "practice" ? 200 : 700;
  const t0 = performance.now();
  let cdIv = null, ended = false;
  const fillIv = setInterval(() => {
    const want = Math.min(cells.length, 1 + Math.round((cells.length - 1) * (performance.now() - t0) / FILL_MS));
    for (; filled < want; filled++) {
      cells[filled].style.color = "#dfeaff";
      cells[filled].style.background = "rgba(255,255,255,0.07)";
      cells[filled].style.borderColor = "rgba(140,180,220,0.18)";
    }
    count.textContent = (W.net ? "WAITING FOR SQUAD… " : "FILLING LOBBY… ") + filled + "/" + W.actors.length;
    if (filled >= cells.length) {
      clearInterval(fillIv);
      count.textContent = W.actors.length + "/" + W.actors.length + "  —  ALL OPERATIVES READY";
      let n = W.mode === "practice" ? 1 : 3;
      cd.textContent = n;
      W.events.emit("countdownBeep", false);
      cdIv = setInterval(() => {
        n--;
        if (n <= 0) {
          W.events.emit("countdownBeep", true);
          finishLobby();
        } else { cd.textContent = n; W.events.emit("countdownBeep", false); }
      }, 900);
    }
  }, W.mode === "practice" ? 30 : 60);
  // ONE exit point. There used to be none — the natural completion inlined its
  // own teardown and there was no skip handler of any kind, on every single
  // match including a replay.
  function finishLobby() {
    if (ended) return;
    ended = true;
    R._lobbyCancel = null;
    clearInterval(fillIv);
    if (cdIv) clearInterval(cdIv);
    window.removeEventListener("keydown", onKey);
    L.remove(); R.lobby = null;
    onDone();
  }
  // showMenu's way out (a failed / abandoned match): stop the fill and the
  // countdown WITHOUT handing off to the drop
  R._lobbyCancel = () => {
    if (ended) return;
    ended = true;
    clearInterval(fillIv);
    if (cdIv) clearInterval(cdIv);
    window.removeEventListener("keydown", onKey);
  };
  // e.repeat is rejected so a held ENTER cannot double-fire the hand-off. (It
  // originally guarded the drop-select screen's own ENTER listener; that screen
  // is no longer shown — the lobby now hands straight to the drop.)
  const onKey = (e) => { if (!e.repeat && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); finishLobby(); } };
  // Offline ONLY. Online keeps the fixed timer because guests have to leave this
  // screen on the same clock as the host.
  if (!W.net) {
    L.style.cursor = "pointer";
    L.onclick = finishLobby;
    window.addEventListener("keydown", onKey);
    const skipSt = {
      fontFamily: "Rajdhani, " + FONT, fontSize: "12px", fontWeight: "700",
      letterSpacing: "2.5px", opacity: "0.6", color: "#9fd0ff",
    };
    h("div", skipSt, "CLICK OR PRESS ENTER TO DROP IN NOW", wrap).className = "kbd-hint";
    h("div", skipSt, "TAP ANYWHERE TO DROP IN NOW", wrap).className = "lc-touch-only";
  }
}

// ═══ DROP SELECT — DISABLED 2026-09-15 ═══════════════════════════════════════
// NOT CALLED ANY MORE. Owner direction: no landing-zone map, drop straight in.
// ffg_royale3d.js now picks the zone with playerMod.autoDropTarget (the quietest
// POI — the same choice this screen made when its timer ran out). Kept intact so
// the screen can be restored by calling it again from that one branch.
// Every bot picks a named POI to land at (bots.assignDrops runs before the
// lobby) while the human was dumped over a random ground point — the worst loot
// odds on the field, and it skipped the decision every battle royale opens
// with. This is the map screen: pick a spot, read how contested it is from the
// bots' actual declared targets, lock it in. It always auto-locks on the timer
// so online clients advance together.
export function showDropSelect(W, onDone) {
  releaseCursor(W);          // you pick your landing zone by CLICKING the map
  ensureAAAStyles();
  const L = layer("dropsel", {
    pointerEvents: "auto",
    background: "radial-gradient(ellipse at 50% 40%, rgba(10,24,48,0.72) 0%, rgba(3,8,16,0.94) 100%)",
  });
  const wrap = h("div", {
    position: "absolute", inset: "0", display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: "10px",
  }, null, L);
  h("div", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "13px", fontWeight: "800",
    letterSpacing: "4px", color: "#8ec8ff", opacity: "0.85",
  }, "SELECT LANDING ZONE", wrap);

  // contest heat — bots stash their choice on brain.bb.dropTarget, so this is
  // the real inbound count, not a guess
  const pois = (W.map && W.map.pois) || [];
  const heat = pois.map((p) => {
    let n = 0;
    for (const a of W.actors) {
      const t = a.brain && a.brain.bb && a.brain.bb.dropTarget;
      if (!t) continue;
      const dx = t.x - p.x, dz = t.z - p.z;
      if (dx * dx + dz * dz <= (p.r * 1.35) * (p.r * 1.35)) n++;
    }
    return n;
  });
  const heatCol = (n) => (n >= 5 ? "#ff6b5a" : n >= 2 ? "#ffcc66" : n >= 1 ? "#9fd7ff" : "#6fe3a0");
  const heatWord = (n) => (n >= 5 ? "HOT" : n >= 2 ? "CONTESTED" : n >= 1 ? "LIGHT" : "QUIET");

  const size = Math.max(260, Math.min(window.innerHeight * 0.60, window.innerWidth * 0.60));
  const cv = h("canvas", {
    borderRadius: "10px", cursor: "crosshair",
    border: "1px solid rgba(140,200,255,0.35)", boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
  }, null, wrap);
  cv.width = size; cv.height = size;
  cv.style.width = size + "px"; cv.style.height = size + "px";
  const ctx = cv.getContext("2d");
  const S = W.map.size;
  const toPx = (v) => (v / S + 0.5) * size;
  const toWorld = (px) => (px / size - 0.5) * S;

  let pick = null;
  function draw() {
    ctx.clearRect(0, 0, size, size);
    if (W.map.minimap) ctx.drawImage(W.map.minimap, 0, 0, size, size);
    ctx.fillStyle = "rgba(4,10,20,0.22)"; ctx.fillRect(0, 0, size, size);
    ctx.textAlign = "center";
    pois.forEach((p, i) => {
      const x = toPx(p.x), z = toPx(p.z), r = Math.max(10, (p.r / S) * size);
      const c = heatCol(heat[i]);
      ctx.globalAlpha = 0.85; ctx.strokeStyle = c; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(x, z, r, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.12; ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, z, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      // inbound count goes INSIDE the ring — a count under the ring collides
      // with the next POI's name wherever zones sit close together
      ctx.font = "800 13px system-ui";
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillText(heat[i] || "0", x + 1, z + 5);
      ctx.fillStyle = c;
      ctx.fillText(heat[i] || "0", x, z + 4);
      // name on a backing pill so it stays legible over any terrain
      ctx.font = "700 12px system-ui";
      const tw = ctx.measureText(p.name).width, ty = z - r - 7;
      ctx.fillStyle = "rgba(3,10,20,0.74)";
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x - tw/2 - 5, ty - 11, tw + 10, 15, 4); ctx.fill(); }
      else ctx.fillRect(x - tw/2 - 5, ty - 11, tw + 10, 15);
      ctx.fillStyle = "#fff"; ctx.fillText(p.name, x, ty);
    });
    if (pick) {
      const x = toPx(pick.x), z = toPx(pick.z);
      const t = (Date.now() % 900) / 900;
      ctx.strokeStyle = "#6ec4ff"; ctx.lineWidth = 2.4;
      ctx.globalAlpha = 1 - t;
      ctx.beginPath(); ctx.arc(x, z, 7 + t * 12, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(x - 9, z); ctx.lineTo(x + 9, z);
      ctx.moveTo(x, z - 9); ctx.lineTo(x, z + 9); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, z, 4, 0, Math.PI * 2); ctx.fillStyle = "#6ec4ff"; ctx.fill();
    }
  }

  const info = h("div", {
    fontFamily: "Rajdhani, " + FONT, fontSize: "17px", fontWeight: "700",
    letterSpacing: "1px", color: "#c8dff8", minHeight: "22px",
  }, "CLICK THE MAP TO CHOOSE YOUR LANDING ZONE  ·  ENTER DROPS NOW", wrap);

  function choose(wx, wz) {
    let best = -1, bd = 1e9;
    pois.forEach((p, i) => {
      const d = Math.hypot(wx - p.x, wz - p.z);
      if (d < p.r * 1.15 && d < bd) { bd = d; best = i; }
    });
    if (best >= 0) { wx = pois[best].x; wz = pois[best].z; }
    pick = { x: wx, z: wz, name: best >= 0 ? pois[best].name : "OPEN GROUND", poi: best };
    info.textContent = "LZ: " + pick.name + "  ·  " +
      (best >= 0 ? heatWord(heat[best]) + (heat[best] ? " (" + heat[best] + " INBOUND)" : "") : "QUIET · NO LOOT CLUSTER");
    info.style.color = best >= 0 ? heatCol(heat[best]) : "#6fe3a0";
    draw();
  }
  cv.addEventListener("click", (ev) => {
    const b = cv.getBoundingClientRect();
    choose(toWorld((ev.clientX - b.left) * (size / b.width)),
           toWorld((ev.clientY - b.top) * (size / b.height)));
  });

  const row = h("div", { display: "flex", gap: "16px", alignItems: "center", marginTop: "2px" }, null, wrap);
  const timerEl = h("div", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "22px", fontWeight: "900",
    color: "#6ec4ff", letterSpacing: "2px", minWidth: "104px", textAlign: "right",
  }, "", row);
  const go = h("button", {
    fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "15px", fontWeight: "900", letterSpacing: "2px",
    padding: "11px 26px", borderRadius: "9px", cursor: "pointer", color: "#03121f",
    border: "1px solid rgba(140,220,255,0.6)", background: "linear-gradient(180deg,#8fe0ff,#3fa9e8)",
    boxShadow: "0 8px 26px rgba(60,170,235,0.35)",
  }, "DROP  [ENTER]", row);
  const legend = h("div", {
    display: "flex", gap: "15px", alignItems: "center", fontSize: FS(11),
    letterSpacing: "1px", opacity: "0.85", fontFamily: "Rajdhani, " + FONT, fontWeight: "600",
  }, null, wrap);
  [["QUIET", 0], ["LIGHT", 1], ["CONTESTED", 2], ["HOT", 5]].forEach((e) => {
    const it = h("div", { display: "flex", gap: "5px", alignItems: "center" }, null, legend);
    h("span", {
      width: "9px", height: "9px", borderRadius: "50%", display: "inline-block",
      background: heatCol(e[1]), boxShadow: "0 0 7px " + heatCol(e[1]),
    }, null, it);
    h("span", null, e[0], it);
  });
  h("div", {
    fontSize: FS(11), opacity: "0.55", letterSpacing: "1px", fontFamily: "Rajdhani, " + FONT,
  }, "THE NUMBER IN EACH ZONE IS HOW MANY OPERATIVES DECLARED IT. YOU STEER FREELY ON THE WAY DOWN.", wrap);

  let done = false;
  let left = W.mode === "practice" ? 1 : 12;
  timerEl.textContent = "AUTO " + left;
  const anim = setInterval(draw, 90);
  // The 12 s auto-lock exists so online clients leave the screen together, but a
  // solo player who had already picked their zone had no keyboard way out — only
  // a mouse trip to the DROP button. This hands the keyboard that button's
  // existing behaviour; it adds no new early-exit semantics for online play.
  const onKey = (e) => { if (!e.repeat && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); finish(); } };
  window.addEventListener("keydown", onKey);
  function finish() {
    if (done) return;
    done = true;
    // Must come off BEFORE onDone() fires, or the listener outlives this screen
    // and rides into the drop, where SPACE is the chute toggle.
    window.removeEventListener("keydown", onKey);
    clearInterval(anim); clearInterval(iv);
    if (!pick) {
      // never picked → the quietest named zone beats the old random dump
      let q = -1, qn = 1e9;
      heat.forEach((n, i) => { if (n < qn) { qn = n; q = i; } });
      pick = q >= 0
        ? { x: pois[q].x, z: pois[q].z, name: pois[q].name, poi: q }
        : null;
    }
    L.remove(); R.dropsel = null;
    onDone(pick);
  }
  const iv = setInterval(() => {
    left--;
    timerEl.textContent = left > 0 ? "AUTO " + left : "DROPPING";
    if (left <= 0) finish();
  }, 1000);
  go.addEventListener("click", finish);
  draw();
  return { finish };
}

// ═══ progression + challenges (Final Drop-style meta) ════════════════════════
// A persistent level/XP bar + one active in-match challenge card, fed off the
// existing W.match / W.t / W.stats counters. Progress persists in localStorage.
// lifetime career record — the post-match screen already computes every one of
// these numbers and used to throw them away, so nothing accrued between matches.
// placementSum / mapWins / killsByCls feed the CAREER panel: an average
// placement is the one number that says "are you getting better", and the raw
// totals the menu already printed cannot answer it.
const CAREER0 = { matches: 0, wins: 0, kills: 0, damage: 0, bestPlacement: 0, top10s: 0, timeAliveS: 0, placementSum: 0, mapWins: {}, killsByCls: {} };
/** Merge stored career over the defaults. The nested objects MUST be re-created:
 *  a plain Object.assign hands every save the SAME mapWins/killsByCls reference
 *  that lives on CAREER0, so the first recorded win would mutate the default. */
function newCareer(stored) {
  const c = Object.assign({}, CAREER0, stored || {});
  c.mapWins = Object.assign({}, c.mapWins);
  c.killsByCls = Object.assign({}, c.killsByCls);
  return c;
}
/**
 * Merge two career records. NEITHER is authoritative — the account is the
 * player's, not the device's, so this takes the best of each rather than
 * picking a winner and discarding the loser.
 *
 * Counters take the MAX, not the sum: the cloud record already contains what
 * this device contributed on an earlier session, so adding would double-count.
 * bestPlacement is the exception twice over — lower is better, and 0 means
 * "never placed", so it must not win a min().
 */
export function mergeCareers(a, b) {
  const ca = newCareer(a), cb = newCareer(b), out = newCareer(null);
  for (const k of Object.keys(CAREER0)) {
    const va = ca[k], vb = cb[k];
    if (k === "mapWins" || k === "killsByCls") {
      const m = {};
      for (const kk of Object.keys(va || {})) m[kk] = Math.max(va[kk] | 0, (vb && vb[kk]) | 0);
      for (const kk of Object.keys(vb || {})) if (!(kk in m)) m[kk] = vb[kk] | 0;
      out[k] = m;
    } else if (k === "bestPlacement") {
      out[k] = !va ? (vb || 0) : !vb ? va : Math.min(va, vb);
    } else {
      out[k] = Math.max(+va || 0, +vb || 0);
    }
  }
  return out;
}

/**
 * Merge a cloud progress record with the local one.
 *
 * The old rule was "adopt the cloud only when it is AHEAD (level, then xp)",
 * which silently threw away everything the cloud held whenever local happened
 * to be one level further on — map wins and class kills earned on another
 * machine among them. Level and xp still come from whichever record is
 * further along; the career is merged field by field.
 */
export function mergeProgressRecords(local, cloud) {
  if (!cloud) return local;
  if (!local) return cloud;
  const cloudAhead = (cloud.level | 0) > (local.level | 0) ||
    ((cloud.level | 0) === (local.level | 0) && (cloud.xp || 0) > (local.xp || 0));
  const hi = cloudAhead ? cloud : local;
  const out = Object.assign({ level: 1, xp: 0, lastPlayedDay: null, dayStreak: 0 },
    cloudAhead ? local : cloud, hi);
  out.level = Math.max(local.level | 0, cloud.level | 0, 1);
  out.xp = hi.xp || 0;
  out.dayStreak = Math.max(local.dayStreak | 0, cloud.dayStreak | 0);
  // dayKey() is YYYY-MM-DD, so a plain string compare IS a date compare.
  const la = local.lastPlayedDay || "", lb = cloud.lastPlayedDay || "";
  out.lastPlayedDay = (la > lb ? la : lb) || null;
  out.career = mergeCareers(local.career, cloud.career);
  // The skill rating must NOT go through mergeCareers: that merges counters by
  // MAX, and a MAX'd rating only ever ratchets upward — a player who got worse
  // (or was having an off week) would be permanently stuck against the hardest
  // lobbies. Take it from whichever record has actually played more matches.
  const lm = (local.career && local.career.matches) | 0, cm = (cloud.career && cloud.career.matches) | 0;
  const pick = cm > lm ? cloud : local;
  out.skill = typeof pick.skill === "number" ? pick.skill : SKILL_NEUTRAL;
  return out;
}

function loadProgress() {
  try {
    const p = Object.assign({ level: 1, xp: 0, lastPlayedDay: null, dayStreak: 0, skill: SKILL_NEUTRAL }, JSON.parse(localStorage.getItem("lc_progress") || "{}"));
    p.career = newCareer(p.career);
    return p;
  } catch (e) { return { level: 1, xp: 0, lastPlayedDay: null, dayStreak: 0, skill: SKILL_NEUTRAL, career: newCareer(null) }; }
}
/** YYYY-MM-DD in LOCAL time. A UTC stamp rolls the day over mid-evening for
 *  anyone west of Greenwich, which would break the streak of a player who did
 *  nothing wrong. */
function dayKey(d) {
  const t = d || new Date();
  return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
}
function saveProgress(p) { try { localStorage.setItem("lc_progress", JSON.stringify(p)); } catch (e) {} }
// fold a finished match into the lifetime record (best placement = LOWEST number)
// ── HIDDEN SKILL RATING ────────────────────────────────────────────────────
// ONE number per account, 0-1. It picks the bot difficulty band today and is the
// same number that will drive human matchmaking when MP lands — deliberately not
// a bot-only dial, so the MP work does not throw this away.
//
// It is a SERVO, not a skill meter: we choose opponents from it, then re-estimate
// it from how the player did against those opponents. A closed loop like that has
// to be damped, so the update is a bounded sign step toward "finishing mid-pack",
// not a proportional error term. That also makes it robust to one lucky match.

/** Per-match performance, 0-1. Placement dominates — that is what Fortnite's SBMM
 *  keys on, and it is the one signal that cannot be farmed by a lucky third-party
 *  kill. Log-scaled because 5th vs 10th is a far bigger gap in skill than 45th vs
 *  50th. */
function matchPerf(res) {
  const pl = Math.max(1, Math.min(50, res.placement || 50));
  const pn = 1 - Math.log(pl) / Math.log(50);
  const kn = Math.min(1, (res.kills || 0) / 6);
  const dn = Math.min(1, (res.damage || 0) / 900);
  return 0.7 * pn + 0.2 * kn + 0.1 * dn;
}

/** The performance we EXPECT from a correctly-rated player against this lobby.
 *  Single swap point for MP: against humans, expected placement is mid-pack by
 *  definition, so this becomes a constant and nothing else in the servo changes. */
function expectedPerf(W) {
  const r = typeof W.botMixRating === "number" ? W.botMixRating : 0.5;
  // A harder lobby should lower the bar: surviving longer against better
  // opponents is worth more.
  return 0.42 - (r - 0.5) * 0.12;
}

function recordMatch(W, res) {
  if (W.mode === "practice") return null;   // sandbox stats are not a career
  const p = W.progress; if (!p) return null;
  const c = p.career || (p.career = newCareer(null));
  // Skill only moves on OFFLINE matches for now: online placement is decided by
  // other humans, not by the bot band we chose, so folding it in would corrupt
  // the servo. W.matchWasNet is captured at match start, before a host takeover
  // can null W.net.
  if (!W.matchWasNet) {
    const cur = typeof p.skill === "number" ? p.skill : SKILL_NEUTRAL;
    // Step size decays with experience: a new account converges in ~5 matches,
    // a veteran's rating stops twitching on one bad game.
    const g = Math.max(0.03, 0.12 / (1 + c.matches / 4));
    const dir = matchPerf(res) > expectedPerf(W) ? 1 : -1;
    p.skill = Math.max(0.05, Math.min(0.98, cur + dir * g));
  }
  c.matches++;
  if (res.victory) c.wins++;
  c.kills += res.kills || 0;
  c.damage += Math.round(res.damage || 0);
  c.timeAliveS += Math.round(res.timeS || 0);
  const pl = res.placement || 99;
  if (!c.bestPlacement || pl < c.bestPlacement) c.bestPlacement = pl;
  if (pl <= 10) c.top10s++;
  // Old saves come through newCareer with zeros/empties, so these are safe to
  // accumulate blind.
  c.placementSum = (c.placementSum || 0) + pl;
  if (!c.mapWins) c.mapWins = {};
  if (res.victory && W.mapId) c.mapWins[W.mapId] = (c.mapWins[W.mapId] || 0) + 1;
  if (!c.killsByCls) c.killsByCls = {};
  const kbc = (W.stats && W.stats.killsByCls) || null;
  if (kbc) for (const k in kbc) c.killsByCls[k] = (c.killsByCls[k] || 0) + kbc[k];
  // Nothing in the game knew what day it was — no timestamp anywhere in the
  // save — so tomorrow was worth exactly as much as next month. One field.
  const today = dayKey();
  if (p.lastPlayedDay !== today) {
    const y = new Date(); y.setDate(y.getDate() - 1);
    p.dayStreak = p.lastPlayedDay === dayKey(y) ? (p.dayStreak || 0) + 1 : 1;
    p.lastPlayedDay = today;
  }
  saveProgress(p);
  return c;
}
function xpForLevel(lvl) { return 800 + (lvl - 1) * 700; }   // rising curve
function addXP(W, amt) {
  // Practice is a sandbox with a no-death dummy range: damage there is
  // unlimited, so paying XP or challenge rewards for it would make levelling
  // a matter of standing still and holding the trigger.
  if (W.mode === "practice") return;
  const p = W.progress; if (!p || !amt) return;
  p.xp += amt;
  while (p.xp >= xpForLevel(p.level)) { p.xp -= xpForLevel(p.level); p.level++; if (W.events) W.events.emit("levelUp", p.level); }
  saveProgress(p); W._xpDirty = true;
}
// The pool used to be five entries and pickChallenges hardcoded slots 0 and 1,
// so "Survive 3 minutes" and "Get 1 elimination" appeared in EVERY match and the
// third slot only moved when level % 3 changed — a player had seen the whole
// system by their third match. The struct was already generic; this is data.
// Every prog() below reads a counter verified live this session: W.t,
// W.match.kills/damage/aliveCount, and W.stats.shotsHit (weapons.js:576).
const _kills = (W) => (W.match && W.match.kills[W.player.id]) || 0;
const _dmg = (W) => Math.round((W.match && W.match.damage[W.player.id]) || 0);
const CHAL_POOL = [
  { id: "survive", label: "Survive 3 minutes", goal: 180, xp: 150, prog: (W) => Math.floor(W.t) },
  { id: "survive5", label: "Survive 5 minutes", goal: 300, xp: 200, prog: (W) => Math.floor(W.t) },
  { id: "survive8", label: "Survive 8 minutes", goal: 480, xp: 280, prog: (W) => Math.floor(W.t) },
  { id: "elim", label: "Get 1 elimination", goal: 1, xp: 175, prog: _kills },
  { id: "elim2", label: "Get 2 eliminations", goal: 2, xp: 240, prog: _kills },
  { id: "elim3", label: "Get 3 eliminations", goal: 3, xp: 300, prog: _kills },
  { id: "elim5", label: "Get 5 eliminations", goal: 5, xp: 300, prog: _kills },
  { id: "dmg", label: "Deal 300 damage", goal: 300, xp: 140, prog: _dmg },
  { id: "dmg600", label: "Deal 600 damage", goal: 600, xp: 210, prog: _dmg },
  { id: "dmg1000", label: "Deal 1000 damage", goal: 1000, xp: 300, prog: _dmg },
  { id: "top10", label: "Reach the final 10", goal: 1, xp: 200, prog: (W) => (W.match && W.match.aliveCount() <= 10 ? 1 : 0) },
  { id: "top5", label: "Reach the final 5", goal: 1, xp: 260, prog: (W) => (W.match && W.match.aliveCount() <= 5 ? 1 : 0) },
  { id: "hits40", label: "Land 40 shots", goal: 40, xp: 190, prog: (W) => (W.stats && W.stats.shotsHit) || 0 },
  { id: "hits80", label: "Land 80 shots", goal: 80, xp: 290, prog: (W) => (W.stats && W.stats.shotsHit) || 0 },
];
// One icon per id family; the old inline ternary is the fallback for anything
// not listed, so an id added later still renders something sensible.
const CHAL_ICON = { survive: "⏱", survive5: "⏱", survive8: "⏱", dmg: "🔥", dmg600: "🔥", dmg1000: "🔥", top10: "🏆", top5: "🏆", hits40: "🎯", hits80: "🎯" };

// ── DAILIES ─────────────────────────────────────────────────────────────────
// Nothing in the game changed because it was a new day: pickChallenges is called
// from showHUD, i.e. per MATCH, and the only persisted keys were lc_progress,
// lc_skin, lc_seen_intro and lc_settings. These sit ON TOP of the per-match trio
// rather than replacing it — daily-only would leave the 4th match of a day
// paying zero challenge XP, a regression against today.
const DAILY_KEY = "lc_daily";
/** Today's three ids, DERIVED from the date rather than stored — so clearing
 *  lc_daily cannot reroll the day, and yesterday's set stays computable instead
 *  of remembered. */
function dailyIdsFor(dstr) {
  const n = String(dstr).split("-");
  const rnd = K.mulberry32(((+n[0] * 10000 + +n[1] * 100 + +n[2]) >>> 0) ^ 0x9e3779b9);
  const ids = CHAL_POOL.map((c) => c.id);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = ids[i]; ids[i] = ids[j]; ids[j] = t; }
  return ids.slice(0, 3);
}
function saveDaily(d) { try { localStorage.setItem(DAILY_KEY, JSON.stringify(d)); } catch (e) {} }
/** ALWAYS re-validated against today on read (never `if (!W.daily)`), so a tab
 *  left open overnight rolls over instead of replaying yesterday's set. */
function loadDaily() {
  const day = dayKey();
  let d = null;
  try { d = JSON.parse(localStorage.getItem(DAILY_KEY) || "null"); } catch (e) {}
  if (!d || d.day !== day || !Array.isArray(d.ids)) {
    d = { day: day, ids: dailyIdsFor(day), done: {}, firstWin: false };
    saveDaily(d);
  }
  if (!d.done) d.done = {};
  return d;
}
function dailyChallenges(W) {
  const d = W.daily;
  if (!d) return [];
  return d.ids
    .map((id) => CHAL_POOL.find((c) => c.id === id))
    .filter(Boolean)
    .map((c) => Object.assign({}, c, {
      label: c.label, xp: Math.round(c.xp * 2.5), daily: true,
      // pre-set from the stored record so a daily already banked earlier today
      // never pays twice
      done: !!d.done[c.id], awarded: !!d.done[c.id],
    }));
}
/** ms to the next LOCAL midnight — same reason dayKey() is local: a UTC reset
 *  rolls the day over mid-evening for anyone west of Greenwich. */
function msToMidnight() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1).getTime() - n.getTime();
}
/** Seconds from the first wait to the last shrink of this mode's storm (sim STORM_PHASES; standard 920, quick 239). Infinity with no storm. */
function stormTotalS(W) {
  const ph = (K && K.STORM_PHASES && K.STORM_PHASES[W.mode]) || (W.stormCtl && W.stormCtl.storm && W.stormCtl.storm.phases) || [];
  let t = 0;
  for (const x of ph) t += (+x.wait || 0) + (+x.shrink || 0);
  return t > 0 ? t : Infinity;
}
/** LC-19: can this challenge be done in THIS mode? A survive-N-seconds card longer than the storm is impossible to finish where it is offered
 *  (Quick Match offered "Survive 8 minutes" against a 239 s storm). Every other card fits every mode. */
function chalFits(W, c) {
  if (!c || !/^survive/.test(c.id)) return true;
  return c.goal <= stormTotalS(W);
}
function pickChallenges(W) {
  // Three at random per match, EXCLUDING today's dailies so no single action can
  // pay twice and so the `ch.id + ":" + cur` card signature stays unique.
  const skip = (W.daily && W.daily.ids) || [];
  const pool = CHAL_POOL.filter((c) => skip.indexOf(c.id) < 0 && chalFits(W, c));
  const pick = [];
  const bag = pool.slice();
  for (let i = 0; i < 3 && bag.length; i++) pick.push(bag.splice(Math.floor(Math.random() * bag.length), 1)[0]);
  return pick.map((c) => Object.assign({}, c, { done: false, awarded: false }));
}


// ═══ weapon silhouettes (contract C-ART-FX) ══════════════════════════════════
// assets/hud/wpn_<id>.png: white silhouette on transparent, 160x60, one per gun.
// Feature-detected: each id is requested at most once, a failed load marks the
// whole set absent so nothing else is asked for (the contract is all-or-nothing:
// ONE missing-file request per page, never six), and every consumer falls back
// (kill feed -> the weapon's name as text; weapon card -> the rendered 3D thumb).
const _sil = { off: false, all: false, probe: null, st: {} };            // st[id] = "pending" | <url> | "none"
// LC-16: only these six ship a wpn_<id>.png (assets/hud, _tools/art_b_wpn.py). A new gun (DMR, LMG, burst AR: lane sim)
// asking for its file used to cost a FAILED REQUEST and - because onerror reads "the set is missing" - switched EVERY
// silhouette off for the rest of the session. New guns get a runtime silhouette instead (silRuntime: the same look - flat
// white, side view, muzzle right, fitted to 160 x 60 - rendered from the gun's own view model in the icon context).
// Fix round: lane sim shipped wpn_dmr / wpn_lmg / wpn_burst.png (art_b_wpn from the CC0 models) and D8 ships wpn_frag / wpn_smoke.png
// (flat white from the vitals-row frag / smoke icons, F:/lc_p23/hud/fix/make_throw_icons.py): a frag kill shows its silhouette in the
// feed and on the death card instead of the text fallback. Any gun not listed here still gets the runtime silhouette.
const SIL_SHIPPED = { pistol: 1, smg: 1, ar: 1, shotgun: 1, sniper: 1, glauncher: 1, dmr: 1, lmg: 1, burst: 1, frag: 1, smoke: 1 };
function silFor(W, id) {
  if (!id || !K || !K.WEAPONS[id]) return null;
  if (!SIL_SHIPPED[id]) return silRuntime(W || _tW, id);
  if (_sil.off) return null;
  const v = _sil.st[id];
  if (v === "pending" || v === "none") return null;
  if (v) return v;
  // ONE probe in flight until the set is known to exist: if the files are absent that is a
  // single failed request, however many weapons ask in the meantime (they re-ask on repaint)
  if (!_sil.all && _sil.probe && _sil.probe !== id) return null;
  if (!_sil.all) _sil.probe = id;
  _sil.st[id] = "pending";
  const url = (W && W.assetBase ? W.assetBase : "") + "assets/hud/wpn_" + id + ".png";
  const im = new Image();
  im.onload = () => {
    _sil.st[id] = url; silReady(id);
    // the set is there: fetch the other guns now (<= 3 KB each) so a weapon switch or a
    // kill with any gun finds its silhouette decoded already
    if (!_sil.all) { _sil.all = true; for (const k of K.WEAPON_IDS) if (SIL_SHIPPED[k]) silFor(_tW, k); }
  };
  im.onerror = () => {
    _sil.st[id] = "none"; _sil.off = true;
    if (R._wSilFor) paintCardSil(_tW, R._wSilFor);          // the card falls back to the 3D thumb
  };
  im.src = url;
  return null;
}
/** A runtime silhouette for a gun with no shipped PNG (see SIL_SHIPPED). null until it is ready; silReady repaints. */
function silRuntime(W, id) {
  const v = _sil.st[id];
  if (v === "pending" || v === "none") return null;
  if (v) return v;
  if (!W || !W.weaponProto) return null;
  _sil.st[id] = "pending";
  W.weaponProto(id).then((proto) => {
    const url = proto ? renderSil(proto) : null;
    _sil.st[id] = url || "none";
    if (url) silReady(id);
  }).catch(() => { _sil.st[id] = "none"; });
  return null;
}
let _silMat = null, _silCam = null;
function renderSil(proto) {
  try {
    ensureIconRig();
    if (!_silMat) { _silMat = new THREE.MeshBasicMaterial({ color: 0xffffff }); _silCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50); }
    const m = proto.clone();
    m.rotation.set(0, Math.PI / 2, 0);                 // barrel +Z -> +X: side view, muzzle to the RIGHT
    iconScene.add(m);
    m.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(m), c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3());
    m.position.sub(c); m.updateMatrixWorld(true);
    const W0 = 160, H0 = 60, M0 = 4;
    const halfW = Math.max(sz.x / 2 * W0 / (W0 - 2 * M0), sz.y / 2 * H0 / (H0 - 2 * M0) * (W0 / H0));
    _silCam.left = -halfW; _silCam.right = halfW; _silCam.top = halfW * H0 / W0; _silCam.bottom = -halfW * H0 / W0;
    _silCam.position.set(0, 0, Math.max(5, sz.z * 2)); _silCam.lookAt(0, 0, 0); _silCam.updateProjectionMatrix();
    const prevO = iconScene.overrideMaterial;
    iconScene.overrideMaterial = _silMat;
    iconR.setSize(W0, H0);
    iconR.render(iconScene, _silCam);
    const url = iconR.domElement.toDataURL();
    iconScene.overrideMaterial = prevO;
    iconR.setSize(96, 72);
    iconScene.remove(m);
    return url;
  } catch (e) { return null; }
}
/** A silhouette finished loading: repaint whatever was waiting for it. */
function silReady(id) {
  if (R.feed) { const kids = R.feed.children; for (let i = 0; i < kids.length; i++) if (kids[i]._wid === id) feedMode(kids[i]); }
  if (R._wSilFor === id) paintCardSil(_tW, id);
  if (R._dSil && R._dSil.id === id) { R._dSil.el.src = _sil.st[id]; R._dSil.el.style.display = "block"; }
}

// ═══ vitals + weapon card builders (P1.9) ════════════════════════════════════
/** n segment tracks in a row; every fill only ever changes transform (scaleX). */
function mkSegs(parent, n, cls) {
  const wrap = h("div", null, null, parent);
  wrap.className = cls;
  const tracks = [], fills = [];
  for (let i = 0; i < n; i++) {
    const tr = h("span", null, null, wrap); tr.className = "lc-sg";
    const f = h("i", null, null, tr); f.className = "lc-sf";
    tracks.push(tr); fills.push(f);
  }
  return { wrap, tracks, fills };
}
/** Write only the segments whose fill changed. cache[i] holds the last written scale. */
function setSegs(fills, cache, n, v, max) {
  const per = max / n;
  for (let i = 0; i < n; i++) {
    let f = (v - i * per) / per;
    f = f <= 0 ? 0 : f >= 1 ? 1 : Math.round(f * 100) / 100;
    if (cache[i] !== f) { cache[i] = f; fills[i].style.transform = "scaleX(" + f + ")"; }
  }
}
function buildVitals(L) {
  // signed-off anchor: left 18 / bottom 16 / width 300 (inline); the skin is the class
  const box = h("div", { position: "absolute", left: "18px", bottom: "16px", width: "300px" }, null, L);
  box.className = "lc-gl lc-vit";
  box.dataset.lc = "bars";
  R.bars = box;
  const top = h("div", null, null, box); top.className = "lc-vtop";
  const num = h("div", null, null, top); num.className = "lc-hpn"; num.dataset.lc = "hpnum";
  R.hpNum = h("b", null, "100", num);
  h("i", null, "HP", num);
  R.hpNumBox = num;
  const bars = h("div", null, null, top); bars.className = "lc-vbars";
  // shield on top, health under it (ref t84)
  const shRow = h("div", null, null, bars); shRow.className = "lc-vb sh"; shRow.dataset.lc = "shieldbar";
  R.shSegs = mkSegs(shRow, 4, "lc-vs").fills;
  R.shNum = h("span", null, "0", shRow); R.shNum.className = "lc-vn";
  const hpRow = h("div", null, null, bars); hpRow.className = "lc-vb hp"; hpRow.dataset.lc = "hpbar";
  R.hpSegs = mkSegs(hpRow, 4, "lc-vs").fills;
  h("span", null, null, hpRow).className = "lc-vn";                // spacer: the two bars stay the same length
  R.hpRow = hpRow;
  // consumables: icon, how many you carry, the key that selects its slot
  const cons = h("div", null, null, box); cons.className = "lc-cons"; cons.dataset.lc = "cons";
  R.cons = CON_ORDER.map((id) => {
    const el = h("span", null, null, cons); el.className = "lc-con z"; el.title = CON_NAME[id];
    const ci = h("span", { color: CON_COLOR[id] }, null, el); ci.className = "ci"; ci.innerHTML = CON_ICON[id];
    const cn = h("span", null, "0", el);
    const kb = h("kbd", { visibility: "hidden" }, "", el); kb.className = "lc-kc";
    return { id, el, cn, kb, c: -1, k: -2 };
  });
  R.thr = THR_ORDER.map((id) => {
    const el = h("span", { display: "none", marginLeft: id === THR_ORDER[0] ? "auto" : "0" }, null, cons); el.className = "lc-con"; el.title = CON_NAME[id];
    el.dataset.lc = "thr-" + id;
    const ci = h("span", { color: CON_COLOR[id] }, null, el); ci.className = "ci"; ci.innerHTML = CON_ICON[id];
    const cn = h("span", null, "0", el);
    const kb = h("kbd", null, "", el); kb.className = "lc-kc";
    return { id, el, cn, kb, c: 0, k: -2 };
  });
  R._hpS = []; R._shS = []; R._magS = [];
  return box;
}
function buildWeaponCard(parent) {
  const card = h("div", null, null, parent);
  card.className = "lc-gl lc-wcard"; card.dataset.lc = "wcard";
  const r1 = h("div", null, null, card); r1.className = "lc-wrow1"; r1.dataset.lc = "wrow1";
  R.wName = h("span", null, "", r1); R.wName.className = "lc-wname";
  R.wTag = h("span", null, "", r1); R.wTag.className = "lc-wtag";
  R.wMode = h("span", null, "", r1); R.wMode.className = "lc-wmode";
  const r2 = h("div", null, null, card); r2.className = "lc-wrow2"; r2.dataset.lc = "wrow2";
  R.wSil = h("img", { visibility: "hidden" }, null, r2); R.wSil.className = "lc-wsil"; R.wSil.dataset.lc = "wsil"; R.wSil.alt = "";
  R.ammoText = h("div", null, "", r2); R.ammoText.className = "lc-ammo"; R.ammoText.dataset.lc = "ammo";
  const r3 = h("div", null, null, card); r3.className = "lc-wrow3"; r3.dataset.lc = "wrow3";
  R.wAType = h("span", null, "", r3); R.wAType.className = "lc-atype";
  const mg = mkSegs(r3, MAG_SEGS, "lc-mag");
  R.magSegs = mg.fills; R.magTracks = mg.tracks;
  R.wCard = card;
  return card;
}
/** The card's picture: the shipped silhouette when it is there, else the weapon's
 *  own rendered 3D thumb (the one the slot row already makes). */
function paintCardSil(W, id) {
  if (!R.wSil || R._wSilFor !== id) return;
  const u = silFor(W, id);
  if (u) { R.wSil.src = u; R.wSil.style.filter = ""; R.wSil.style.visibility = "visible"; return; }
  if (!_sil.off && _sil.st[id] === "pending") return;      // the file may still answer: silReady repaints
  weaponIcon(W, id).then((url) => {
    if (url && R._wSilFor === id && R.wSil && R.wSil.isConnected) { R.wSil.src = url; R.wSil.style.visibility = "visible"; }
  });
}
/** Consumable counts + the key that reaches each one. Called from paintSlots only
 *  (inventory changed), never per frame. */
function paintCons(W, p) {
  if (!R.cons) return;
  const sl = p.inventory && p.inventory.slots;
  for (let j = 0; j < R.cons.length; j++) {
    const c = R.cons[j];
    let cnt = 0, key = -1;
    if (sl) for (let i = 0; i < sl.length; i++) {
      const s = sl[i];
      if (s && s.kind === "consumable" && s.id === c.id) { cnt += s.count || 0; if (key < 0) key = i + 1; }
    }
    if (c.c !== cnt) { c.c = cnt; c.cn.textContent = String(cnt); c.el.classList.toggle("z", cnt === 0); }
    if (c.k !== key) { c.k = key; c.kb.textContent = key > 0 ? keyOf(W, "Digit" + key) : ""; c.kb.style.visibility = key > 0 ? "visible" : "hidden"; }
  }
  if (R.thr) for (const c of R.thr) {
    let cnt = 0, key = -1;
    if (sl) for (let i = 0; i < sl.length; i++) {
      const s = sl[i];
      if (s && s.kind === "consumable" && s.id === c.id) { cnt += s.count || 0; if (key < 0) key = i + 1; }
    }
    if (c.c !== cnt) { c.c = cnt; c.cn.textContent = String(cnt); c.el.style.display = cnt > 0 ? "" : "none"; }
    if (c.k !== key) { c.k = key; c.kb.textContent = key > 0 ? keyOf(W, "Digit" + key) : ""; }
  }
}
/** Vitals: the numbers and the 4 + 4 segments. Writes only when a value changed. */
function updateVitals(p, C) {
  const hpI = p.hp > 0 ? Math.min(100, Math.ceil(p.hp)) : 0;
  if (C.hpI !== hpI) {
    C.hpI = hpI;
    R.hpNum.textContent = hpI;
    setSegs(R.hpSegs, R._hpS, 4, hpI, 100);
    // "am I one shot from dead" is a state, not a two-digit number to read mid-fight:
    // the number and the bar turn yellow at 40 and red + pulsing at 25
    const st = hpI <= 25 ? 2 : hpI <= 40 ? 1 : 0;
    if (C.hpSt !== st) {
      C.hpSt = st;
      R.hpRow.className = "lc-vb hp" + (st === 2 ? " cr" : st === 1 ? " lo" : "");
      R.hpNumBox.className = "lc-hpn" + (st === 2 ? " cr" : st === 1 ? " lo" : "");
    }
    // Persistent low-HP vignette. Deliberately NOT the lcPulse keyframe: that animates
    // opacity and would override the inline opacity carrying the ramp.
    if (R.lowHpTint) R.lowHpTint.style.opacity = hpI < 35 ? String(Math.min(1, (35 - hpI) / 30) * (R._flashRed ? 0.3 : 0.6)) : "0";
  }
  const shI = p.shield > 0 ? Math.min(100, Math.ceil(p.shield)) : 0;
  if (C.shI !== shI) {
    C.shI = shI;
    R.shNum.textContent = shI;
    setSegs(R.shSegs, R._shS, 4, shI, 100);
  }
}
/** Weapon card: static parts on a weapon / rarity / consumable change, the count and
 *  the mag segments on a count change. Nothing here allocates while nothing changed. */
function updateWeaponCard(W, p, C) {
  const wpn = p.weapon, wid = wpn ? wpn.id : null;
  const glide = !!p.gliding;
  if (C.cGl !== glide) { C.cGl = glide; R.wCard.style.display = glide ? "none" : ""; }
  if (glide) return;
  const isCon = !!wid && wid.startsWith("consumable");
  const def = wid && !isCon ? K.WEAPONS[wid] : null;
  const rar = wpn ? (wpn.rarity | 0) : 0;
  if (C.cWid !== wid || C.cRar !== rar) {
    C.cWid = wid; C.cRar = rar; C.cM = -1; C.cR = -1; C.cTxt = null;
    if (def) {
      const rn = K.RARITY[rar] || "common", rc = K.RARITY_COLOR[rn] || "#dfe7f2";
      R.wName.textContent = K.weaponName(wid); R.wName.style.color = rc;
      R.wTag.textContent = rn; R.wTag.style.color = rc; R.wTag.style.display = "";
      // AUTO / SEMI / BURST: K.fireMode, the rule weapons.js fires by (LC-16)
      R.wMode.textContent = fireLabel(def); R.wMode.style.display = "";
      R.wAType.textContent = AMMO_NAME[def.ammo] || String(def.ammo || "").toUpperCase();
      const n = Math.min(MAG_SEGS, Math.max(1, def.mag | 0));
      C.cN = n;
      for (let i = 0; i < MAG_SEGS; i++) R.magTracks[i].style.display = i < n ? "" : "none";
      R._magS.length = 0;                          // new segment count: write every fill once
      R.magTracks[0].parentNode.style.display = "";
      R.wSil.style.visibility = "hidden";          // never the previous gun's picture while this one loads
      R._wSilFor = wid; paintCardSil(W, wid);
    } else if (isCon) {
      const cid = wid.slice(11);
      R.wName.textContent = CON_NAME[cid] || cid.toUpperCase(); R.wName.style.color = CON_COLOR[cid] || "#dfe7f2";
      R.wTag.style.display = "none"; R.wMode.style.display = "none";
      R.wAType.textContent = isThrowable(wid) ? "FIRE TO THROW" : "FIRE TO USE";
      R.magTracks[0].parentNode.style.display = "none";
      R._wSilFor = null; R.wSil.style.visibility = "hidden";
    } else {
      R.wName.textContent = ""; R.wTag.style.display = "none"; R.wMode.style.display = "none"; R.wAType.textContent = "";
      R.magTracks[0].parentNode.style.display = "none"; R._wSilFor = null; R.wSil.style.visibility = "hidden";
    }
  }
  // the count line: "30 / 150", "RELOADING…", "SWIMMING", or "x3" for a held consumable
  let mag = 0, res = 0, mode = 0;                  // mode: 0 normal, 1 reloading, 2 swimming, 3 consumable
  if (def) {
    mag = wpn.magAmmo | 0; res = (p.inventory && p.inventory.ammo && p.inventory.ammo[def.ammo]) | 0;
    mode = p.swimming ? 2 : wpn.state === "reloading" ? 1 : 0;
  } else if (isCon) { mag = wpn.slotRef ? wpn.slotRef.count | 0 : 0; mode = p.swimming ? 2 : 3; }
  else if (p.swimming) mode = 2;
  if (C.cM !== mag || C.cR !== res || C.cMode !== mode) {
    const was = C.cMode;
    C.cM = mag; C.cR = res; C.cMode = mode;
    R.ammoText.textContent = mode === 2 ? "SWIMMING" : mode === 1 ? "RELOADING…" : mode === 3 ? "x" + mag : def ? mag + " / " + res : "";
    if (was !== mode) R.ammoText.classList.toggle("sm", mode !== 0);
    if (def) setSegs(R.magSegs, R._magS, C.cN, mag, def.mag);
  }
}

// ═══ HUD ═════════════════════════════════════════════════════════════════════
export function showHUD(W) {
  ensureAAAStyles(); ensureHudStyles();
  const L = layer("hud");
  // The scope surround is a 92%-black radial fill over the WHOLE screen. Nothing
  // in the hud layer sets a z-index, so paint order is pure DOM order — created
  // last, it covered health, shields, ammo, the storm clock, the minimap, the
  // kill feed and the damage chevrons. Scoping a sniper blacked out every piece
  // of information you need to decide whether to take the shot. Created FIRST,
  // it sits underneath them all; its own crosshair lines are at screen centre
  // where no widget draws, and R.cross is already hidden while scoped.
  R.scope = h("div", { position: "absolute", inset: "0", display: "none", background: "radial-gradient(circle at center, rgba(0,0,0,0) 26%, rgba(0,0,0,0.92) 27%)", pointerEvents: "none" }, null, L);
  const scLine = h("div", { position: "absolute", left: "50%", top: "50%", width: "40%", height: "1px", background: "rgba(255,255,255,0.5)", transform: "translate(-50%,-50%)" }, null, R.scope);
  h("div", { position: "absolute", left: "50%", top: "50%", width: "1px", height: "40%", background: "rgba(255,255,255,0.5)", transform: "translate(-50%,-50%)" }, null, R.scope);
  // BREATH METER — the how-to card says "watch your lungs" and until this bar
  // there was nothing to watch (sweep finding): a thin vertical gauge just
  // right of the scope centre, cyan draining as you hold, red while WINDED.
  // Lives inside R.scope so it exists exactly when the mechanic does.
  const bWrap = h("div", { position: "absolute", left: "calc(50% + 120px)", top: "50%", width: "7px", height: "90px", transform: "translateY(-50%)", background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: "4px", overflow: "hidden" }, null, R.scope);
  h("div", { position: "absolute", left: "calc(50% + 132px)", top: "calc(50% - 58px)", fontSize: FS(11), fontFamily: "Rajdhani, " + FONT, fontWeight: "700", letterSpacing: "1px", color: "rgba(255,255,255,0.65)", textShadow: "0 1px 3px #000" }, "BREATH", R.scope);
  R.breathFill = h("div", { position: "absolute", left: "0", bottom: "0", width: "100%", height: "100%", background: "#7fd8ff", transition: "height .1s linear" }, null, bWrap);
  // vitals (bottom-left, signed-off anchor): a big HP number beside a 4-segment shield
  // bar over a 4-segment health bar, then the consumables row (buildVitals above)
  buildVitals(L);
  // heal channel
  R.healBar = h("div", { position: "absolute", left: "50%", top: "58%", transform: "translateX(-50%)", width: "220px", height: "10px", background: "rgba(0,0,0,0.5)", borderRadius: "5px", display: "none", overflow: "hidden" }, null, L);
  R.healBar.dataset.lc = "healbar";
  R.healFill = h("div", { width: "0%", height: "100%", background: "#4ade80" }, null, R.healBar);
  // Reload had NO progress UI at all — just the word "RELOADING…" — while both
  // healing and chest-opening show a bar. A 4-second shotgun reload with no
  // sense of how far along you are is the difference between pushing and dying.
  // Stamina bar AND sprint pip removed by owner direction 2026-07-28: sprint is
  // infinite and silent — no meter draining, no "▶ SPRINT" message on screen.

  // top 55%, not 62.5%: the interact hint (top 60%, opaque, ~29px tall, created
  // 53 lines later in the same z-index-free layer so it paints on top) covered
  // the top half of this bar on any viewport under ~1160px — i.e. a maximised
  // 1080p browser — exactly while you stand over loot and reload.
  R.reloadBar = h("div", { position: "absolute", left: "50%", top: "55%", transform: "translateX(-50%)", width: "180px", height: "8px", background: "rgba(0,0,0,0.55)", borderRadius: "4px", display: "none", overflow: "hidden", border: "1px solid rgba(255,255,255,0.15)" }, null, L);
  R.reloadBar.dataset.lc = "reloadbar";
  R.reloadFill = h("div", { width: "0%", height: "100%", background: "#ffd166" }, null, R.reloadBar);

  // slots bottom right. bottom 54, not 16: the portal's fullscreen/mute/pause
  // bar (game_controls.js:306, position:fixed bottom 8 right 8, z 2147483600)
  // paints over y 8..42 at the right edge, and at bottom 16 the ammo count sat
  // UNDER it in every match (feel-juice-ui G5). game_controls.js:955 states the
  // rule for its own buttons: "bottom:54px ... Never overlap it."
  const br = h("div", { position: "absolute", right: "18px", bottom: "54px", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }, null, L);
  br.dataset.lc = "slotcol";
  R.slotCol = br;
  // the weapon card sits ABOVE the slot row (name, rarity, AUTO/SEMI, count, ammo type,
  // mag segments - buildWeaponCard); the count inside it is still data-lc="ammo"
  buildWeaponCard(br);
  R.slotsRow = h("div", { display: "flex", gap: "6px" }, null, br);
  R.slotsRow.dataset.lc = "slots";

  // (The old canvas compass ribbon that used to live here is GONE — owner:
  // "there are 2 compasses, one above the other". The DOM heading strip built
  // further down is the surviving one; it carries the degree readout and
  // cardinal ruler that match the reference.)

  // top center: storm timer + alive
  // top 56, not 28: the compass strip above measures 48 px tall, so at 28 it
  // buried the storm clock, alive count and kill count under the ruler.
  const tc = h("div", { position: "absolute", top: "56px", left: "50%", transform: "translateX(-50%)" }, null, L);
  tc.className = "lc-gl lc-storm";
  tc.dataset.lc = "stormrow";
  R.stormRow = tc;
  R.stormIcon = h("div", null, null, tc); R.stormIcon.className = "lc-st-ic"; R.stormIcon.innerHTML = IC.storm;
  R.stormTimer = h("div", null, "", tc); R.stormTimer.className = "lc-st-t";
  // "Circle N of 8 · X damage a second" - the long form on a desktop, "Circle N/8" on a phone
  R.stormSep = h("div", null, null, tc); R.stormSep.className = "lc-sep";
  R.stormCirc = h("div", null, null, tc); R.stormCirc.className = "lc-st-c"; R.stormCirc.dataset.lc = "stormcirc";
  R.circL = h("span", null, "", R.stormCirc); R.circL.className = "lc-circ-l";
  R.circS = h("span", null, "", R.stormCirc); R.circS.className = "lc-circ-s";
  if (W.mode === "practice") { R.stormSep.style.display = "none"; R.stormCirc.style.display = "none"; }
  h("div", null, null, tc).className = "lc-sep";
  const alv = h("div", null, null, tc); alv.className = "lc-st-a"; alv.title = "players alive";
  const alvI = h("span", null, null, alv); alvI.className = "ic"; alvI.innerHTML = IC.alive;
  R.aliveText = h("span", null, "", alv);
  const kil = h("div", null, null, tc); kil.className = "lc-st-k"; kil.title = "your eliminations";
  const kilI = h("span", null, null, kil); kilI.className = "ic"; kilI.innerHTML = IC.skull;
  R.killsText = h("span", null, "", kil);

  // XP/level bar + active challenge card (Final Drop-style meta), below the storm bar
  if (!W.progress) W.progress = loadProgress();
  // Re-read every match, not once per session: loadDaily re-validates against
  // today, so a tab left open across midnight rolls onto the new set.
  W.daily = loadDaily();
  // LC-19: a daily that cannot be finished in this mode stays on the menu (it can be done in another mode today) but is not shown in this match
  W._challenges = pickChallenges(W).concat(dailyChallenges(W).filter((c) => chalFits(W, c)));
  W._chalIdx = 0; W._xpDirty = true; W._chalXp = 0; W._elimXp = 0;
  const meta = h("div", { position: "absolute", top: META_TOP + "px", left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", width: "352px" }, null, L);
  const xpRow = h("div", { display: "flex", alignItems: "center", gap: "8px", width: "100%", background: "rgba(0,0,0,0.42)", padding: "4px 10px", borderRadius: "8px" }, null, meta);
  xpRow.dataset.lc = "lvl";
  meta.dataset.lc = "meta";
  R.meta = meta;
  // 13px to match R.chalLabel below (owner: "make the lvl 5 the same size as
  // the quests like 'deal 1000 damage'")
  R.xpLevel = h("div", { fontSize: "13px", fontWeight: "900", color: "#ffd873", minWidth: "48px", textShadow: "0 1px 2px #000" }, "LVL 1", xpRow);
  const xpBarWrap = h("div", { flex: "1", height: "10px", background: "rgba(0,0,0,0.55)", borderRadius: "5px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.15)" }, null, xpRow);
  R.xpFill = h("div", { width: "0%", height: "100%", background: "linear-gradient(90deg,#4aa8ff,#7ad0ff)", transition: "width .3s" }, null, xpBarWrap);
  R.xpText = h("div", { fontSize: FS(10), fontWeight: "700", opacity: "0.85", minWidth: "74px", textAlign: "right" }, "", xpRow);
  R.chalCard = h("div", Object.assign({ display: "none", alignItems: "center", gap: "10px", width: "100%", padding: "7px 12px" }, PANEL), null, meta);
  R.chalIcon = h("div", { fontSize: "16px" }, "🎯", R.chalCard);
  const chalMid = h("div", { flex: "1" }, null, R.chalCard);
  R.chalLabel = h("div", { fontSize: "13px", fontWeight: "800" }, "", chalMid);
  const chalBarWrap = h("div", { height: "6px", background: "rgba(0,0,0,0.5)", borderRadius: "3px", overflow: "hidden", marginTop: "4px" }, null, chalMid);
  R.chalFill = h("div", { width: "0%", height: "100%", background: "#4ade80", transition: "width .2s" }, null, chalBarWrap);
  R.chalProg = h("div", { fontSize: FS(11), fontWeight: "800", opacity: "0.8", minWidth: "44px", textAlign: "right" }, "", R.chalCard);
  R.chalXp = h("div", { fontSize: FS(11), fontWeight: "900", color: "#ffd873" }, "", R.chalCard);
  R.chalCard.dataset.lc = "quest";
  // The announcement band hangs off the quest card's MEASURED bottom (see
  // placeBand). A ResizeObserver reports the stack's height whenever the card
  // appears, grows or wraps — no layout read on any frame. The band keeps the
  // tallest bottom seen, so it never jumps up into a card that re-appears.
  R._metaBottom = 0; R._metaH = 0;
  if (R._metaRO) { R._metaRO.disconnect(); R._metaRO = null; }
  if (typeof ResizeObserver !== "undefined") {
    R._metaRO = new ResizeObserver((ents) => {
      const hgt = ents[ents.length - 1].contentRect.height;
      if (hgt > (R._metaH || 0)) { R._metaH = hgt; R._metaBottom = META_TOP + hgt; placeBand(); }
    });
    R._metaRO.observe(meta);
  }

  // minimap top left
  const mmWrap = h("div", { position: "absolute", top: "12px", left: "14px", width: "180px", height: "180px", borderRadius: "12px", overflow: "hidden", border: "2px solid rgba(120,180,255,0.35)", boxShadow: "0 4px 18px rgba(0,0,0,0.5)" }, null, L);
  mmWrap.dataset.lc = "minimap";
  R.mmWrap = mmWrap;              // touch: a tap here opens the big map (hudTapTarget)
  R.mmCanvas = h("canvas", { width: "100%", height: "100%", display: "block" }, null, mmWrap);
  R.mmCanvas.width = Math.round(180 * HUD_DPR); R.mmCanvas.height = Math.round(180 * HUD_DPR);

  // kill feed right
  R.feed = h("div", { position: "absolute", right: "16px", top: "70px", display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-end", fontSize: "12px" }, null, L);
  R.feed.dataset.lc = "feed";

  // crosshair — PER-WEAPON reticles (painted by paintCrosshair)
  // No transition and no scale on this box any more: bloom moves the ARMS (see
  // paintCrosshair / setReticleGap), so the stroke never shrinks below 2 px.
  R.cross = h("div", { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: "56px", height: "56px" }, null, L);
  R.cross.dataset.lc = "reticle";
  R._crossFor = null;
  buildHitMarker(L);

  // ── COMPASS HEADING STRIP (Final Drop parity — owner screenshots) ─────────
  // Top-centre sliding ruler: degree number above, tick strip with cardinals
  // below, centre notch marks the current bearing. North = -Z (the direction
  // yaw 0 faces); turning right increases the heading, compass convention.
  // Built once (720 deg of ticks so the wrap never shows a seam), moved with
  // one transform per frame.
  const COMP_PPD = 2.2;                 // px per degree
  const compWrap = h("div", { position: "absolute", left: "50%", top: "4px", transform: "translateX(-50%)", width: "300px", textAlign: "center", pointerEvents: "none" }, null, L);
  R.compassNum = h("div", { fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "17px", fontWeight: "900", letterSpacing: "1px", textShadow: "0 2px 8px rgba(0,0,0,0.9)" }, "0", compWrap);
  const compBand = h("div", { position: "relative", width: "300px", height: "26px", overflow: "hidden", marginTop: "1px", WebkitMask: "linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent)", mask: "linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent)" }, null, compWrap);
  R.compassRuler = h("div", { position: "absolute", left: "0", top: "0", height: "26px", width: (720 * COMP_PPD) + "px", willChange: "transform" }, null, compBand);
  const CARD = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
  // The 720-degree ruler is 1584 px of DOM boxes; overflow:hidden clips them to
  // the 300 px strip visually, but every off-strip label is still a real box
  // spread across the top of the screen (on a phone, under touch.js's PAUSE
  // button). The ticks live in 24 chunks of 30 degrees and only the chunks the
  // strip can show are displayed (update() flips them when the heading
  // crosses a chunk edge — at most two style writes, never per frame).
  R.compassChunks = [];
  for (let c = 0; c < 24; c++) {
    R.compassChunks.push(h("div", { position: "absolute", left: (c * 30 * COMP_PPD) + "px", top: "0", width: (30 * COMP_PPD) + "px", height: "26px", display: "none" }, null, R.compassRuler));
  }
  R._cc0 = -1; R._cc1 = -1;
  for (let d = 0; d < 720; d += 15) {
    const deg = d % 360, card = CARD[deg];
    const chunk = R.compassChunks[Math.floor(d / 30)];
    const x = (d % 30) * COMP_PPD;
    h("div", { position: "absolute", left: x + "px", top: card ? "14px" : "17px", width: "2px", height: card ? "9px" : "6px", background: card ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.45)", boxShadow: "0 1px 3px rgba(0,0,0,0.8)" }, null, chunk);
    if (card) h("div", { position: "absolute", left: (x - 14) + "px", top: "-1px", width: "30px", textAlign: "center", fontFamily: "Rajdhani, " + FONT, fontSize: "13px", fontWeight: "900", letterSpacing: "1px", textShadow: "0 1px 4px rgba(0,0,0,0.9)" }, card, chunk);
    else if (deg % 45 !== 0 && deg % 30 === 0) h("div", { position: "absolute", left: (x - 14) + "px", top: "1px", width: "30px", textAlign: "center", fontFamily: "Rajdhani, " + FONT, fontSize: FS(11), fontWeight: "700", opacity: "0.55", textShadow: "0 1px 3px rgba(0,0,0,0.9)" }, String(deg), chunk);
  }
  h("div", { position: "absolute", left: "50%", top: "12px", transform: "translateX(-50%)", width: "2px", height: "12px", background: "#ffd254", boxShadow: "0 0 4px rgba(0,0,0,0.9)" }, null, compBand);
  R.compassWrap = compWrap;
  compWrap.dataset.lc = "compass";
  // LC-07 pings: the world pips (own layer, under the menus) and the compass ticks (a box over the ruler, outside its fade mask)
  buildPings(L, compWrap);

  // weapon-switch popup: rarity-coloured name above the hotbar for a beat
  // (Final Drop parity — their hotbar select shows rarity/name)
  R.wpnPop = h("div", { position: "absolute", left: "50%", bottom: "118px", transform: "translateX(-50%)", fontFamily: "Rajdhani, " + FONT, fontSize: "16px", fontWeight: "900", letterSpacing: "1.5px", textShadow: "0 2px 8px rgba(0,0,0,0.95)", opacity: "0", transition: "opacity .18s", pointerEvents: "none", whiteSpace: "nowrap" }, "", L);
  R.wpnPop.dataset.lc = "wpnpop";

  // ── MP TEXT CHAT (ENTER — Final Drop parity, owner screenshots) ──────────
  // Log bottom-left above the bars; input opens on ENTER (online only).
  // Messages ride the ev envelope (net.js "chat") — zero extra billed
  // messages. textContent everywhere: peer names and message bodies are
  // remote strings and must never touch innerHTML.
  R.chatLog = h("div", { position: "absolute", left: "18px", bottom: "128px", display: "flex", flexDirection: "column", gap: "3px", maxWidth: "360px", fontFamily: "Rajdhani, " + FONT, fontSize: "13.5px", pointerEvents: "none" }, null, L);
  R.chatLog.dataset.lc = "chat";
  const chatRow = h("div", { position: "absolute", left: "18px", bottom: "104px", display: "none", pointerEvents: "auto" }, null, L);
  R.chatInput = document.createElement("input");
  Object.assign(R.chatInput.style, { width: "300px", padding: "7px 10px", borderRadius: "8px", border: "1px solid rgba(140,190,255,0.5)", background: "rgba(6,12,20,0.85)", color: "#e6eefc", fontFamily: "Rajdhani, " + FONT, fontSize: "14px", outline: "none" });
  R.chatInput.maxLength = 80; R.chatInput.placeholder = "message your squad…";
  chatRow.appendChild(R.chatInput);
  R.chatRow = chatRow;
  W.pushChat = (name, text, own) => {
    const row = h("div", { background: "rgba(6,10,16,0.55)", padding: "3px 9px", borderRadius: "7px", alignSelf: "flex-start", textShadow: "0 1px 3px rgba(0,0,0,0.9)" }, "", R.chatLog);
    const nm = h("span", { fontWeight: "900", color: own ? "#9fd7ff" : "#ffd254" }, "", row);
    nm.textContent = name + ":  ";
    const tx = h("span", { opacity: "0.95" }, "", row);
    tx.textContent = text;
    while (R.chatLog.children.length > 5) R.chatLog.firstChild.remove();
    setTimeout(() => { if (row.parentNode) row.remove(); }, 9000);
  };
  W.chatOpen = () => {
    if (!W.net || R.chatRow.style.display !== "none") return;
    R.chatRow.style.display = "block";
    R.chatInput.value = "";
    R.chatInput.focus();
  };
  const chatClose = () => { R.chatRow.style.display = "none"; R.chatInput.blur(); };
  R.chatInput.addEventListener("keydown", (ce) => {
    ce.stopPropagation();
    if (ce.code === "Escape") { chatClose(); }
    else if (ce.code === "Enter") {
      const m = R.chatInput.value.trim();
      if (m && W.sendChat && W.sendChat(m)) W.pushChat(W.player ? W.player.name : "you", m, true);
      chatClose();
    }
  });
  W.events.on("chatMsg", (id, m) => {
    const a2 = W.actorById && W.actorById.get(id);
    W.pushChat(a2 ? a2.name : "player", String(m).slice(0, 80), false);
  });

  // world-anchored loot labels (Final Drop parity — owner screenshots show
  // named ground loot + a CHEST tag): a pool of 7 pills projected to the
  // items' screen positions each frame, rarity-coloured, distance-faded
  R.lootLbls = [];
  for (let i = 0; i < 7; i++) {
    R.lootLbls.push(h("div", { position: "absolute", left: "0", top: "0", display: "none", fontFamily: "Rajdhani, " + FONT, fontSize: "12.5px", fontWeight: "800", letterSpacing: "0.8px", background: "rgba(6,10,16,0.55)", padding: "2px 9px", borderRadius: "7px", whiteSpace: "nowrap", pointerEvents: "none", textShadow: "0 1px 3px rgba(0,0,0,0.9)", willChange: "transform" }, "", L));
  }

  // interact hint + chest-open progress ring
  // MOUSE-LOOK PROMPT. Pointer lock is the only look mode in play, and the
  // browser drops it on Esc / tab-out / focus loss with no signal of its own —
  // so an unlocked player used to be left with a camera that simply would not
  // turn (and, in the build before this, one that drifted on its own). Say it
  // plainly instead.
  R.lookHint = h("div", { position: "absolute", left: "50%", top: "46%", transform: "translateX(-50%)",
    background: "rgba(0,0,0,0.62)", padding: "8px 18px", borderRadius: "10px",
    font: "700 14px system-ui", letterSpacing: "0.08em", color: "#dbeaff",
    border: "1px solid rgba(140,190,255,0.35)", display: "none", pointerEvents: "none" }, "CLICK TO LOOK AROUND", L);
  R.lookHint.dataset.lc = "lookhint";
  R.interact = h("div", { position: "absolute", left: "50%", top: "60%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.55)", padding: "6px 14px", borderRadius: "8px", fontSize: "14px", display: "none", whiteSpace: "nowrap" }, "", L);
  R.interact.dataset.lc = "interact";
  R.chestRing = h("div", { position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: "58px", height: "58px", borderRadius: "50%", display: "none", background: "conic-gradient(#ffd254 0deg, rgba(255,255,255,0.15) 0deg)", WebkitMask: "radial-gradient(circle, transparent 22px, #000 23px)", mask: "radial-gradient(circle, transparent 22px, #000 23px)" }, null, L);

  // directional indicators (footsteps / gunfire / damage) on a screen-edge ring
  R.indicators = h("div", { position: "absolute", inset: "0", pointerEvents: "none" }, null, L);
  R.indicators.dataset.lc = "indicators";
  buildIndicatorPool();

  // parachute button indicator during the drop (Final Drop style). bottom 150
  // (was 120): the slot/ammo column moved up to bottom 54 to clear the portal
  // control bar, and its top edge now reaches ~138.
  R.chuteBtn = h("div", { position: "absolute", right: "40px", bottom: "150px", width: "84px", height: "84px", borderRadius: "50%", background: "rgba(10,19,31,0.75)", border: "2px solid rgba(140,190,255,0.6)", display: "none", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", boxShadow: "0 4px 18px rgba(0,0,0,0.5)" }, null, L);
  R.chuteBtn.dataset.lc = "chutebtn";
  R.chuteGlyph = h("div", { fontSize: "26px", lineHeight: "1.1" }, "🪂", R.chuteBtn);
  R.chuteLabel = h("div", { fontSize: FS(10), fontWeight: "900", letterSpacing: "0.5px", marginTop: "2px" }, "[SPACE]", R.chuteBtn);
  // First-drops-only centre hint for the CUT (see the gliding branch in update).
  R.chuteHint = h("div", {
    position: "absolute", left: "50%", top: "58%", transform: "translateX(-50%)",
    fontFamily: "Rajdhani, " + FONT, fontSize: "15px", fontWeight: "700", letterSpacing: "2px",
    color: "#cfe4ff", textShadow: "0 2px 10px rgba(0,0,0,0.9)", display: "none", pointerEvents: "none",
    whiteSpace: "nowrap",
  }, null, L);
  R.chuteHint.dataset.lc = "chutehint";
  h("span", null, "PRESS " + (physFor(W, "Space") ? keyLabel(physFor(W, "Space")) : "SPACE") + " TO CUT THE CHUTE AND DIVE", R.chuteHint).className = "kbd-hint";
  h("span", null, "TAP JUMP TO CUT THE CHUTE AND DIVE", R.chuteHint).className = "lc-touch-only";

  // storm messages center — tops are set by placeBand() (under the banner band)
  R.stormMsg = h("div", { position: "absolute", left: "50%", top: "256px", transform: "translateX(-50%)", fontSize: "22px", fontWeight: "900", letterSpacing: "1px", textShadow: "0 2px 8px #000", opacity: "0", transition: "opacity .4s", color: "#d9b3ff", whiteSpace: "nowrap" }, "", L);
  R.stormMsg.dataset.lc = "stormmsg";
  // Pickups used to share stormMsg with storm warnings and supply alerts, so
  // grabbing loot as the storm warned clobbered whichever fired second. Loot is
  // frequent+low-priority; the storm line is rare+important — separate them.
  R.pickupMsg = h("div", { position: "absolute", left: "50%", top: "290px", transform: "translateX(-50%)", fontSize: "15px", fontWeight: "800", letterSpacing: "1px", textShadow: "0 2px 6px #000", opacity: "0", transition: "opacity .3s", color: "#bfe9d2", whiteSpace: "nowrap" }, "", L);
  R.pickupMsg.dataset.lc = "pickupmsg";
  // BIG match announcements (deploy, alive-count milestones, eliminations, level-up).
  // Band top = the quest card's measured bottom + 12 px (placeBand). nowrap:
  // `left:50%` leaves a shrink-to-fit box only HALF the viewport wide, so a long
  // "ELIMINATED <name>" wrapped onto two lines and grew down into the storm line.
  R.annWrap = h("div", { position: "absolute", left: "50%", top: (META_TOP + META_RESERVE + BAND_GAP) + "px", transform: "translateX(-50%)", textAlign: "center", whiteSpace: "nowrap", opacity: "0", transition: "opacity .35s, transform .35s", pointerEvents: "none" }, null, L);
  R.annWrap.dataset.lc = "ann";
  R.annTitle = h("div", { fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "var(--lc-ann-fs, clamp(20px, 2.9vw, 34px))", fontWeight: "900", letterSpacing: "4px", textShadow: "0 3px 14px #000, 0 0 26px rgba(90,170,255,0.5)" }, "", R.annWrap);
  R.annSub = h("div", { fontSize: "var(--lc-ann-sub, 14px)", fontWeight: "700", letterSpacing: "2px", opacity: "0.85", marginTop: "4px", textShadow: "0 2px 6px #000" }, "", R.annWrap);
  R._annUntil = 0; R._aliveMark = 0; R._annPrio = 0; R._annQ = [];
  R._bandTop = null; R._bandKey = null; R.deathBox = null; R._deathH = 0;
  if (R._deathRO) { R._deathRO.disconnect(); R._deathRO = null; }
  placeBand();
  // stepMarks stores absolute W.t; W.t resets to 0 each match, so a stale match-1
  // time (larger than any match-2 time) made `W.t - last < 1.4` permanently true
  // and the footstep chevrons vanished for the first ~2 min of every later match.
  stepMarks.clear();

  // tints
  R.stormTint = h("div", { position: "absolute", inset: "0", background: "radial-gradient(ellipse at center, rgba(130,60,200,0) 55%, rgba(130,60,200,0.35) 100%)", opacity: "0", transition: "opacity .5s", pointerEvents: "none" }, null, L);
  R.hurtTint = h("div", { position: "absolute", inset: "0", background: "radial-gradient(ellipse at center, rgba(200,30,30,0) 60%, rgba(200,30,30,0.4) 100%)", opacity: "0", transition: "opacity .3s", pointerEvents: "none" }, null, L);
  // Nothing on screen ever said "you are nearly dead". The only low-HP cue was
  // the HP bar going red down in the bottom-left (see the hp branch in update()),
  // which you have to look away from the fight to read. Players carry 100 HP +
  // 100 shield (SIM.PLAYERK), so a persistent tint is the difference between
  // pushing and backing off.
  R.lowHpTint = h("div", { position: "absolute", inset: "0", background: "radial-gradient(ellipse at center, rgba(180,20,20,0) 45%, rgba(180,20,20,0.5) 100%)", opacity: "0", transition: "opacity .45s", pointerEvents: "none" }, null, L);

  R._hudCache = {};
  R.dmgLog = [];            // LC-81: the damage-taken log belongs to this match
  R.knockCause = null;      // (OD-8) the knock causes too (actor ids repeat across matches)
  // C-MODE / C-DBNO / OD-9: teammates (none in solo: nothing below is built), LC-45 hints + the practice guide
  R._mates = null; R._matesFor = null; R._revive = null; R.bleedRow = null; R._bleedK = ""; R._inStorm = false;
  W._supplyMark = null; W._supplyMarks = [];   // LC-28: a new match starts with no crate marks (match 1's last one used to stay on match 2's map)
  buildMates(W); buildDownMarkers(W); buildHints(W); buildGuide(W);
  _slotC.who = null;        // new roster / new HUD: repaint the slot row once
  // perf readout (opt-in): FPS always, plus link freshness when online. This is
  // deliberately NOT labelled "ping" — net.js records lastSeen timestamps, not
  // round-trip time, so calling it ping would be a lie.
  // top 44px, not 96px: the kill feed starts at top 70px and its rows are ~20px
  // + 4px gap, so a 24px chip at 96 painted over almost all of feed row 2 — and
  // the chip is created 38 lines later in the same z-index-free layer, so it won.
  R.perf = h("div", {
    position: "absolute", right: "12px", top: "44px", padding: "4px 9px", borderRadius: "6px",
    fontFamily: "ui-monospace, Consolas, monospace", fontSize: "12px", fontWeight: "700",
    color: "#9fe6c0", background: "rgba(4,10,20,0.55)", border: "1px solid rgba(120,180,255,0.18)",
    letterSpacing: "0.5px", pointerEvents: "none",
    display: W.settings && W.settings.showPerf ? "block" : "none",
  }, "— FPS", L);
  R.perf.dataset.lc = "perf";
  R._fpsAcc = 0; R._fpsFrames = 0; R._fpsShown = 0;
  // who you are watching once you are out, and how to change it
  R.specBar = h("div", {
    position: "absolute", left: "50%", bottom: "84px", transform: "translateX(-50%)",
    padding: "6px 16px", borderRadius: "8px", background: "rgba(4,10,20,0.6)",
    border: "1px solid rgba(140,200,255,0.25)", fontFamily: "Rajdhani, " + FONT,
    fontSize: "13px", fontWeight: "700", letterSpacing: "1.5px", color: "#cfe4ff",
    display: "none", pointerEvents: "none", whiteSpace: "nowrap",
  }, "", L);
  // practice: a live range readout, so the dummies are a measurement and not
  // just something to shoot at
  R.rangePanel = null;
  if (W.mode === "practice") {
    R.rangePanel = h("div", Object.assign({
      position: "absolute", left: "50%", top: "10px", transform: "translateX(-50%)",
      padding: "7px 16px", borderRadius: "8px", fontFamily: "Rajdhani, " + FONT,
      fontSize: "13px", fontWeight: "700", letterSpacing: "1.5px", color: "#cfe6ff",
      whiteSpace: "nowrap",
    }, PANEL), "RANGE — OPEN FIRE", L);
  }
  // deployment beat — the match used to just… start, with no moment marking it
  const tot = W.match ? W.match.totalPlayers : 50;
  if (W.mode === "practice") setTimeout(() => announce("PRACTICE", "FIVE DUMMIES DUE SOUTH · 12–80M", "#9fd7ff", 2600, ANN_PRIO.deploy), 250);
  // LC-82: Quick Match starts ON THE GROUND (SIM.MODE.quick drop "ground"), so "DEPLOY" announced a drop that never happens
  else {
    // C-MODE: a team mode names the size and the team win condition (the title stays FIGHT / DEPLOY)
    const tmD = teamModeOf(W), win = tmD === "solo" ? "LAST ONE STANDING WINS" : TEAM_WORD[tmD] + " · LAST TEAM STANDING WINS";
    if (W.mode === "quick") setTimeout(() => announce("FIGHT", tot + " PLAYERS · GROUND START · " + win, "#9fd7ff", 2600, ANN_PRIO.deploy), 250);
    else setTimeout(() => announce("DEPLOY", tot + " PLAYERS · " + win, "#9fd7ff", 2600, ANN_PRIO.deploy), 250);
  }
  syncTouchPrefs(W);
  applyA11y(W); applyHudScale(W); applyBrightness(W);
}

function bar(parent, color) {
  const wrap = h("div", { width: "100%", height: "14px", background: "rgba(0,0,0,0.5)", borderRadius: "7px", overflow: "hidden", marginTop: "5px", border: "1px solid rgba(255,255,255,0.15)" }, null, parent);
  const fill = h("div", { width: "0%", height: "100%", background: color, transition: "width .15s" }, null, wrap);
  return fill;
}

function hideHUD() {
  ["hud", "death", "post", "bigmap"].forEach((n) => { if (R[n]) { R[n].remove(); R[n] = null; } });
  R.deathBox = null;
  if (R._deathRO) { R._deathRO.disconnect(); R._deathRO = null; }
}

// ═══ hit marker ══════════════════════════════════════════════════════════════
// (feel-juice-ui G2) The old marker was a "✕" rotated 45° — an upright "+", the
// same shape as the pistol/SMG reticle — and the kill confirm never painted:
// weapons.js emits actorDied (kill style) and THEN hitMarker for the same round
// (weapons.js:724/:728), and the hitMarker handler reset it to a 26 px white
// "+" hidden 113 ms later (measured). Now: four diagonal ticks + a ring, a
// 1.38 -> 1 pop on every hit, colour tiers (shield blue / body white / head
// yellow / kill red + ring), and a KILL LATCH that no hitMarker can downgrade
// for 0.5 s. Driven from update() by the frame dt (no setTimeout), so a stepped
// test harness and a throttled tab see the same timeline as a player.
const MK_TIERS = {
  body:   { col: "#ffffff", hold: 0.10, fade: 0.12, base: 1.00, rank: 1 },
  shield: { col: "#57b0ff", hold: 0.10, fade: 0.12, base: 1.00, rank: 2 },
  head:   { col: "#ffd54a", hold: 0.17, fade: 0.14, base: 1.18, rank: 3 },
  kill:   { col: "#ff4d4d", hold: 0.35, fade: 0.20, base: 1.28, rank: 4 },
};
const KILL_LATCH = 0.5, MK_POP = 0.09, MK_POP_AMT = 0.38, MK_BREAK = 0.36;
const MK = { style: null, t: 99, clk: 0, latch: 0, breakT: 99, op: -1, sc: 1, tf: "", col: "", ring: false,
             bop: -1, btf: "", killHeld: 0, kills: 0, hits: 0, blocked: 0, breaks: 0, hurt: null, log: [] };
function mkLog(ev, style) {
  MK.log.push({ clkMs: Math.round(MK.clk * 1000), wall: Math.round(performance.now()), ev, style: style || MK.style });
  if (MK.log.length > 32) MK.log.shift();
}
function buildHitMarker(L) {
  // zero-size box pinned at screen centre: children are laid out around the
  // point, and the pop scales about it
  R.hitmark = h("div", { position: "absolute", left: "50%", top: "50%", width: "0", height: "0", opacity: "0", pointerEvents: "none", willChange: "transform, opacity" }, null, L);
  R.hitmark.dataset.lc = "hitmark";
  R.hitTicks = [];
  for (const deg of [45, 135, 225, 315]) {
    R.hitTicks.push(h("i", {
      position: "absolute", display: "block", left: "-1.5px", top: "-6px", width: "3px", height: "12px",
      borderRadius: "1.5px", background: "#ffffff", boxShadow: "0 0 2px rgba(0,0,0,0.95)",
      transform: "rotate(" + deg + "deg) translateY(-14px)",
    }, null, R.hitmark));
  }
  R.hitRing = h("div", {
    position: "absolute", left: "-24px", top: "-24px", width: "48px", height: "48px", boxSizing: "border-box",
    borderRadius: "50%", border: "2px solid #ff4d4d", boxShadow: "0 0 3px rgba(0,0,0,0.85), inset 0 0 3px rgba(0,0,0,0.85)", opacity: "0",
  }, null, R.hitmark);
  // shield-break ring: its own element so it can expand while ticks pop
  R.hitBreak = h("div", {
    position: "absolute", left: "50%", top: "50%", width: "40px", height: "40px", marginLeft: "-20px", marginTop: "-20px",
    boxSizing: "border-box", borderRadius: "50%", border: "2px solid #57b0ff", boxShadow: "0 0 8px rgba(87,176,255,0.85)",
    opacity: "0", pointerEvents: "none", willChange: "transform, opacity",
  }, null, L);
  R.hitBreak.dataset.lc = "hitbreak";
  Object.assign(MK, { style: null, t: 99, latch: 0, breakT: 99, op: -1, sc: 1, tf: "", col: "#ffffff", ring: false, bop: -1, btf: "", killHeld: 0, hurt: null });
}
function mkShow(style) {
  const T = MK_TIERS[style];
  MK.style = style; MK.t = 0;
  if (style === "kill") { MK.killHeld = 0; MK.kills++; } else MK.hits++;
  if (MK.col !== T.col) { for (const t of R.hitTicks) t.style.background = T.col; MK.col = T.col; }
  const ring = style === "kill";
  if (ring !== MK.ring) { R.hitRing.style.opacity = ring ? "1" : "0"; MK.ring = ring; }
  mkLog("show", style);
  mkPaint();                       // visible in the frame the hit lands, not one later
}
function mkPaint() {
  let op = 0, sc = 1;
  if (MK.style) {
    const T = MK_TIERS[MK.style];
    op = MK.t < T.hold ? 1 : Math.max(0, 1 - (MK.t - T.hold) / T.fade);
    sc = T.base * (1 + MK_POP_AMT * Math.max(0, 1 - MK.t / MK_POP));
  }
  const opq = Math.round(op * 100) / 100;
  if (opq !== MK.op) { R.hitmark.style.opacity = String(opq); MK.op = opq; }
  const tf = "scale(" + sc.toFixed(3) + ")";
  if (tf !== MK.tf) { R.hitmark.style.transform = tf; MK.tf = tf; }
  MK.sc = sc;
  // shield-break ring: 0.7 -> 1.8 scale, fading, once per breaking hit
  let bop = 0, btf = MK.btf;
  if (MK.breakT < MK_BREAK) {
    const k = MK.breakT / MK_BREAK;
    bop = Math.round((1 - k) * 100) / 100;
    btf = "scale(" + (0.7 + 1.1 * k).toFixed(3) + ")";
  }
  if (bop !== MK.bop) { R.hitBreak.style.opacity = String(bop); MK.bop = bop; }
  if (btf !== MK.btf) { R.hitBreak.style.transform = btf; MK.btf = btf; }
}
function mkUpdate(dt) {
  if (!R.hitmark) return;
  MK.clk += dt;
  if (MK.latch > 0) MK.latch = Math.max(0, MK.latch - dt);
  if (MK.breakT < MK_BREAK) MK.breakT += dt;
  if (MK.style) {
    MK.t += dt;
    const T = MK_TIERS[MK.style];
    if (MK.style === "kill" && MK.t <= T.hold) MK.killHeld = MK.t;
    if (MK.t >= T.hold + T.fade) { mkLog("hide"); MK.style = null; }
  }
  mkPaint();
}

// ── reticle arms ─────────────────────────────────────────────────────────────
// (feel-juice-ui G3) Bloom used to SCALE the whole reticle — stroke included —
// so the pistol's 2 px arms rendered ~0.9 px thick and ~3.7 px long at rest
// (scale 0.457, measured): practically invisible. Now the arms keep a fixed
// 2 px stroke and length and only their DISTANCE from the pinned centre follows
// the real spread. Only transforms are written, and only when the rounded gap
// changes.
function setReticleGap(bloom) {
  const r = R._ret;
  if (!r || !r.arms.length) return;
  const gap = Math.max(r.min, Math.round(r.gap0 * bloom));   // px, centre -> inner end of an arm
  if (gap === r.gapPx) return;
  r.gapPx = gap;
  if (r.kind === "cross") {
    const off = gap + r.len / 2;
    for (const a of r.arms) a.el.style.transform = "translate(" + (a.dx * off) + "px," + (a.dy * off) + "px)";
  } else {                                                    // shotgun arcs
    const ex = Math.max(0, gap - r.len);
    for (const a of r.arms) a.el.style.transform = "rotate(" + a.deg + "deg) translateY(" + (-ex) + "px)";
  }
}

// ═══ per-frame update ════════════════════════════════════════════════════════
let mmT = 0, srT = 0;
export function update(W, dt) {
  if (!R.hud || !W.player) return;
  // perf readout: average over ~0.5s so the number is readable, not a strobe
  if (R.perf && W.settings && W.settings.showPerf) {
    if (R.perf.style.display === "none") R.perf.style.display = "block";
    R._fpsAcc += dt; R._fpsFrames++;
    if (R._fpsAcc >= 0.5) {
      const fps = Math.round(R._fpsFrames / R._fpsAcc);
      R._fpsAcc = 0; R._fpsFrames = 0;
      let txt = fps + " FPS";
      if (W.net && W._netStats && W._netStats.lastSeenAgeMs != null) {
        txt += "  ·  SYNC " + Math.round(W._netStats.lastSeenAgeMs) + "ms";
      }
      if (txt !== R._fpsShown) { R.perf.textContent = txt; R._fpsShown = txt; }
      R.perf.style.color = fps >= 50 ? "#9fe6c0" : fps >= 30 ? "#ffd166" : "#ff8a7a";
    }
  } else if (R.perf && R.perf.style.display !== "none") R.perf.style.display = "none";
  // when the local player is dead we SPECTATE — source the HUD from the spectated
  // actor (W._camFocus, set by updateCamera each frame) instead of the corpse,
  // which read HP 0% / shield 0% / empty inventory for the whole spectate phase.
  const p = W._camFocus || W.player;
  const C = R._hudCache;
  // compass: slide the ruler so the viewed bearing sits under the notch.
  // North = -Z (yaw 0); turning right increases heading. The 720-degree ruler
  // plus the d<90 wrap keeps the visible 68-degree half-window inside the
  // built strip at every heading — no seam, no rebuild.
  if (R.compassRuler && p) {
    const hdg = ((-p.yaw * 180 / Math.PI) % 360 + 360) % 360;
    const dd = hdg < 90 ? hdg + 360 : hdg;
    R.compassRuler.style.transform = "translateX(" + (150 - dd * 2.2).toFixed(1) + "px)";
    // the strip shows dd +- 68 degrees: keep exactly the chunks that reach it
    const c0 = Math.max(0, Math.floor((dd - 70) / 30)), c1 = Math.min(23, Math.floor((dd + 70) / 30));
    if (c0 !== R._cc0 || c1 !== R._cc1) {
      for (let c = 0; c < 24; c++) {
        const on = c >= c0 && c <= c1, was = c >= R._cc0 && c <= R._cc1;
        if (on !== was) R.compassChunks[c].style.display = on ? "block" : "none";
      }
      R._cc0 = c0; R._cc1 = c1;
    }
    const n = Math.round(hdg) % 360;
    if (R._compN !== n) { R._compN = n; R.compassNum.textContent = String(n); }
  }

  // LC-07: pings (expiry, world pip / edge arrow, compass tick) - every frame, like the compass
  if (p && R.pingEls) stepPings(W, p, ((-p.yaw * 180 / Math.PI) % 360 + 360) % 360);
  if (p && R.downEls) stepDownMarkers(W, p, ((-p.yaw * 180 / Math.PI) % 360 + 360) % 360);   // C-DBNO: downed teammates
  // OD-11: the name-tag policy for this frame (enemies only up close or under the reticle; teammates far, in their colour)
  stepTagPolicy(W, p, dt);

  // vitals: the number + 4 + 4 segments, written only when a value changed (updateVitals)
  updateVitals(p, C);

  // heal channel
  if (p.healing) {
    R.healBar.style.display = "block";
    const c = K.CONSUMABLES[p.healing.id];
    R.healFill.style.width = (100 * (1 - p.healing.tLeft / c.useS)) + "%";
  } else R.healBar.style.display = "none";

  // (stamina bar + sprint pip removed 2026-07-28 — infinite, silent sprint)

  // reload progress
  if (R.reloadBar) {
    const rw = p.weapon, rdef = rw && K.WEAPONS[rw.id];
    if (rw && rw.state === "reloading" && rdef && rdef.reloadS > 0) {
      R.reloadBar.style.display = "block";
      R.reloadFill.style.width = (100 * (1 - Math.max(0, rw.reloadT) / rdef.reloadS)) + "%";
    } else R.reloadBar.style.display = "none";
  }

  // weapon card (name, rarity, AUTO/SEMI, count, ammo type, mag segments) + slots
  updateWeaponCard(W, p, C);

  // spectated remote actors can have a partial inventory. slotsDirty compares
  // in place — this used to build two joined signature strings (plus a map()
  // array and an Object.values array) EVERY frame just to learn nothing changed.
  if (p.inventory && p.inventory.slots && slotsDirty(p)) paintSlots(W, p);

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
      if (C.stT !== txt) { C.stT = txt; R.stormTimer.textContent = txt; }
      const sc = st.closing ? 1 : 0;
      if (C.stC !== sc) { C.stC = sc; R.stormIcon.style.color = sc ? "#d9b3ff" : "#9fb6cc"; }
      // "Circle N of 8 · X damage a second": N is the circle being waited for / closed,
      // X is the damage per second outside the circle that is in force right now
      if (W.mode !== "practice") {
        const nPh = W.stormCtl.storm.phases ? W.stormCtl.storm.phases.length : 0;
        const ck = st.phase * 100000 + nPh * 1000 + (st.dps || 0) * 10;
        if (C.stK !== ck) {
          C.stK = ck;
          R.circL.textContent = "Circle " + st.phase + " of " + nPh + (st.dps > 0 ? "  ·  " + st.dps + " damage a second" : "  ·  no damage yet");
          R.circS.textContent = "Circle " + st.phase + "/" + nPh;
        }
      }
    }
    expireFeed(performance.now());
    // teams that arrive after showHUD (a net start / rejoin publishing teamIds late) still get their chips; matesOf is cached
    if (!R.mateEls && R.bars && W.player && W.player.teamId != null && matesOf(W, W.player).length) buildMates(W);
    if (R.mateEls || R.bleedRow || (p && p.downed)) updateMates(W, p);     // OD-9 teammate chips + C-DBNO BLEEDING OUT
    const alN = W.match ? W.match.aliveCount() : -1;
    if (C.alN !== alN) { C.alN = alN; R.aliveText.textContent = alN < 0 ? "—" : String(alN); }
    const kiN = W.match ? (W.match.kills[p.id] || 0) : 0;
    if (C.kiN !== kiN) { C.kiN = kiN; R.killsText.textContent = String(kiN); }
    if (R.specBar) {
      const me = W.player;
      if (me && !me.alive && W._camFocus && W._camFocus !== me) {
        const n = W.match ? W.match.aliveCount() : 0;
        R.specBar.style.display = "block";
        // no touch control switches the spectated player, so a touch player is
        // not told to press keys they do not have
        R.specBar.textContent = "SPECTATING  " + W._camFocus.name.toUpperCase() + "   ·   " + n + " ALIVE" + (touchOn ? "" : "   ·   [A] / [D] TO SWITCH");
      } else R.specBar.style.display = "none";
    }
    if (R.rangePanel) {
      const s = W.stats, ds = W.rangeDummies || [];
      let dmg = 0, pops = 0, hs = 0;
      for (const d of ds) { dmg += d.dummyDamage || 0; pops += d.dummyPops || 0; hs += d.dummyHeadshots || 0; }
      const acc = s.shotsFired ? Math.round((s.shotsHit / s.shotsFired) * 100) : 0;
      R.rangePanel.textContent = "RANGE  ·  SHOTS " + s.shotsFired + "  ·  HITS " + s.shotsHit +
        "  ·  ACC " + acc + "%  ·  HEADSHOTS " + hs + "  ·  DMG " + Math.round(dmg) + "  ·  DOWNS " + pops;
    }
    // alive-count milestones — the match had no rising arc, just a flat counter
    if (W.match && W.phase === "match" && W.mode !== "practice") {
      const al = W.match.aliveCount();
      let tier = 0;
      for (const m of [2, 5, 10, 25]) { if (al <= m) { tier = m; break; } }   // tightest first
      if (tier && (!R._aliveMark || tier < R._aliveMark)) {
        R._aliveMark = tier;
        if (tier === 2) announce("FINAL 2", "ONE KILL FROM THE WIN", "#ffd54a", 2800, ANN_PRIO.milestone);
        else announce(al + " REMAIN", tier === 25 ? "THE CIRCLE TIGHTENS" : tier === 10 ? "TOP 10 — STAY SHARP" : "FINAL 5", "#ffd54a", 2400, ANN_PRIO.milestone);
      }
    }
    // hurt tint: CLEAR only. It is set instantly by the actorHurt handler now —
    // driving the "1" from this 4Hz block cost up to 250ms of tick latency on
    // top of the element's own 300ms fade, so the screen took ~550ms to tell you
    // you were being shot, out of a 700ms window.
    if (W.t - p.lastDamageT >= 0.7) { R.hurtTint.style.transition = "opacity .3s"; R.hurtTint.style.opacity = "0"; }

    // XP/level bar (re-rendered when XP changes)
    const pr = W.progress;
    if (pr && R.xpFill && W._xpDirty) {
      const need = xpForLevel(pr.level);
      R.xpLevel.textContent = "LVL " + pr.level;
      R.xpFill.style.width = Math.min(100, 100 * pr.xp / need) + "%";
      R.xpText.textContent = pr.xp + " / " + need + " XP";
      W._xpDirty = false;
    }
    // active challenge card — advance past completed ones, award XP once
    const chs = W._challenges;
    if (chs && R.chalCard) {
      // Evaluate ALL of them, independently. This used to poll only
      // chs[W._chalIdx] and advance that pointer solely when the CURRENT
      // challenge completed — and slot 0 is always "Survive 3 minutes", so a
      // player who died at 2:30 with four kills and 600 damage banked nothing
      // from the other two. The card still shows one at a time.
      // Guarded on being ALIVE: dying does not end the match and W.t keeps
      // running, so a corpse in the spectator seat could otherwise bank
      // "Survive 3 minutes" and "Reach the final 10" without playing.
      if (W.match && W.player && W.player.alive) {
        for (const c of chs) {
          if (c.awarded) continue;
          if (c.prog(W) >= c.goal) {
            c.awarded = true; c.done = true;
            addXP(W, c.xp);
            W._chalXp = (W._chalXp || 0) + c.xp;   // banked here; the post-match screen only knew about `res`
            // A daily is marked spent in localStorage the instant it lands, not
            // at match end — quitting mid-match must not hand it back. NOT in
            // practice: addXP no-ops there (unlimited damage on no-death dummies),
            // so burning the day's card for zero XP would be worse than not
            // offering it.
            if (c.daily && W.daily && W.mode !== "practice") { W.daily.done[c.id] = true; saveDaily(W.daily); }
            flashMsg((c.daily ? "DAILY COMPLETE  +" : "CHALLENGE COMPLETE  +") + c.xp + " XP");
          }
        }
      }
      const ch = chs.find((c) => !c.done) || null;
      // the card steps aside once the match is over: it sat on top of the result card's title
      if (ch && W.match && !W.match.over) {
        const cur = Math.min(ch.goal, ch.prog(W));
        R.chalCard.style.display = "flex";
        const sig = ch.id + ":" + cur;
        if (C.chal !== sig) {
          R.chalIcon.textContent = CHAL_ICON[ch.id] || (ch.id.indexOf("elim") === 0 ? "💀" : "🏆");
          R.chalLabel.textContent = ch.daily ? "★ DAILY — " + ch.label : ch.label;
          R.chalFill.style.width = (100 * cur / ch.goal) + "%";
          R.chalProg.textContent = cur + "/" + ch.goal;
          R.chalXp.textContent = "+" + ch.xp + " XP";
          C.chal = sig;
        }
      } else { R.chalCard.style.display = "none"; }
    }
  }

  // Compass EVERY frame; minimap at 10Hz. These used to share one gate, but the
  // ribbon's whole content is the camera's heading — a per-frame quantity that
  // changes with every mouse move — so sampling it at 10Hz made it judder while
  // you turned. It is a 320x18 canvas with a handful of strokes, next to nothing
  // beside the 180x180 minimap's drawImage of a 512x512 source.
  mmT += dt;
  if (mmT > 0.1) { mmT = 0; drawMinimap(W, R.mmCanvas.getContext("2d"), 180, false); }

  // interact hint + chest channel ring
  // Touch names the on-screen control (USE, from touch.js) instead of a key the
  // player does not have. Written only when the text changes.
  // C-DBNO: a downed teammate within reach turns the interact line into the revive prompt and the chest ring into its
  // progress (green). The player lane may publish the channel as W.interactHint { type: "revive", progress, data: target };
  // without that, the prompt comes from reviveTarget() and the ring from the reviveStart event's clock.
  const hint = W.interactHint;
  let rvT = null, rvP = 0;
  if (hint && hint.type === "revive") { rvT = hint.data || hint.target || null; rvP = +hint.progress || 0; }
  else if (R.mateEls && W.player && W.player.alive && !W.player.downed) {
    rvT = reviveTarget(W);
    if (rvT && R._revive && R._revive.reviver === W.player && R._revive.target === rvT) rvP = reviveFrac(W, R._revive);
  }
  if (rvT || hint) {
    if (C.iaOn !== true) { R.interact.style.display = "block"; C.iaOn = true; }
    const rvN = rvT ? String(rvT.name || "teammate") : "";
    let ia = rvT
      ? (rvP > 0 ? "Reviving " + rvN + "…" : (touchOn ? "HOLD USE  ·  Revive " + rvN : "[HOLD " + keyOf(W, "KeyE") + "] Revive " + rvN))
      : hint.type === "chest"
      ? (hint.progress > 0 ? "Opening…" : (touchOn ? "HOLD USE  ·  Open chest" : "[HOLD " + keyOf(W, "KeyE") + "] Open chest"))
      : interactLabel(W, hint.data);
    if (C.ia !== ia) { R.interact.textContent = ia; C.ia = ia; }
  } else if (C.iaOn !== false) { R.interact.style.display = "none"; C.iaOn = false; }
  const ringP = rvT ? rvP : (hint && hint.type === "chest" ? +hint.progress || 0 : 0);
  if (ringP > 0) {
    R.chestRing.style.display = "block";
    const deg = Math.min(360, Math.round(ringP * 360));
    R.chestRing.style.background = `conic-gradient(${rvT ? "#7cf0a8" : "#ffd254"} ${deg}deg, rgba(255,255,255,0.15) ${deg}deg)`;
  } else R.chestRing.style.display = "none";
  // test surface (read-only by probes); one reused object, no per-frame allocation while a revive is in reach
  if (rvT) { const u = R._reviveUiO || (R._reviveUiO = { target: null, progress: 0 }); u.target = rvT.id; u.progress = Math.round(rvP * 1000) / 1000; R._reviveUi = u; }
  else R._reviveUi = null;

  // parachute button state during the drop
  if (p.gliding) {
    R.chuteBtn.style.display = "flex";
    const open = !!p.chute;
    const cl = (open ? "CUT" : "OPEN") + " [" + keyOf(W, "Space") + "]";
    if (C.chuteLbl !== cl) { R.chuteLabel.textContent = cl; C.chuteLbl = cl; }
    R.chuteBtn.style.borderColor = open ? "rgba(255,190,90,0.8)" : "rgba(140,190,255,0.8)";
    // Teach the cut where the player is actually looking. The CUT [SPACE] button
    // above is correct but it lives at right:40px bottom:120px — the corner — on
    // the one screen where a first-timer is watching the ground rush up. The
    // canopy owns 110 m of a ~245 m descent at 5.5 m/s, the slowest speed in the
    // game, so cutting it is worth ~6.6 s. Stops appearing after three recorded
    // matches.
    if (R.chuteHint) {
      const green = ((W.progress && W.progress.career && W.progress.career.matches) || 0) < 3;
      const want = open && green && !p.chuteToggled;
      if (C.chuteHint !== want) {
        R.chuteHint.style.display = want ? "block" : "none";
        C.chuteHint = want;
      }
    }
  } else if (R.chuteBtn.style.display !== "none") {
    R.chuteBtn.style.display = "none";
    if (R.chuteHint) { R.chuteHint.style.display = "none"; C.chuteHint = false; }
  }

  // directional indicators: fade + footstep scan
  stepIndicators(W, dt);
  // LC-45: one-time hints (2 Hz) and, in practice, the guided basics
  stepHints(W, p, dt);
  if (R._guide) stepGuide(W, p, dt);

  // crosshair: per-weapon reticle, hidden behind the sniper scope, blooms while
  // moving. Without pointer lock it RIDES THE CURSOR (the reticle IS the mouse
  // — the OS arrow is hidden over the canvas during play).
  const wid = p.weapon ? p.weapon.id : null;
  if (R._crossFor !== wid) {
    paintCrosshair(W, wid);
    // rarity-coloured name flash on switch (weapons only, own view only)
    if (R.wpnPop && wid && !wid.startsWith("consumable") && p === W.player && K.WEAPONS[wid]) {
      const rr = p.weapon.rarity || 0;
      R.wpnPop.textContent = (K.RARITY[rr] || "").toUpperCase() + "  ·  " + wid.toUpperCase();
      R.wpnPop.style.color = K.RARITY_COLOR[K.RARITY[rr]] || "#dfe7f2";
      R.wpnPop.style.opacity = "1";
      R._wpnPopT = performance.now();
    }
  }
  if (R._wpnPopT && performance.now() - R._wpnPopT > 1500) { R.wpnPop.style.opacity = "0"; R._wpnPopT = 0; }
  // loot labels: project nearby items/chests to screen (7 projections, cheap)
  if (R.lootLbls) {
    let li = 0;
    if (p && p.alive && W.phase === "match" && W.nearbyLoot && W.kernel && W.kernel.camera) {
      if (!R._lv) R._lv = new p.pos.constructor();
      const near = W.nearbyLoot(p.pos, 9);
      const cam = W.kernel.camera;
      viewSize(W);
      const sw = _vw, sh = _vh;
      // touch: keep the pills off the on-screen controls and the reticle
      const koOn = touchOn && koRefresh(W, sw, sh);
      for (const n of near) {
        if (li >= R.lootLbls.length) break;
        R._lv.set(n.pos.x, n.pos.y + (n.type === "chest" ? 1.0 : 0.55), n.pos.z).project(cam);
        if (R._lv.z > 1 || R._lv.x < -1 || R._lv.x > 1 || R._lv.y < -1 || R._lv.y > 1) continue;
        const isW = n.type === "item" && n.data.kind === "weapon";
        const txt = n.type === "chest" ? "CHEST"
                  : shortName(n.data) + (isW ? " · " + (K.RARITY[n.data.rarity || 0] || "").toUpperCase() : "");
        let lx = (R._lv.x * 0.5 + 0.5) * sw, ly = (-R._lv.y * 0.5 + 0.5) * sh;   // the pill's bottom-centre
        if (koOn) { ly = koPlace(txt, lx, ly); if (ly === null) continue; }    // under a control: not drawn, slot kept
        const el = R.lootLbls[li++];
        if (el._t !== txt) {
          el._t = txt; el.textContent = txt;
          el.style.color = n.type === "chest" ? "#ffd254"
                        : isW ? (K.RARITY_COLOR[K.RARITY[n.data.rarity || 0]] || "#dfe7f2") : "#8fd3a0";
        }
        el.style.transform = "translate(-50%,-100%) translate(" + lx.toFixed(0) + "px," + ly.toFixed(0) + "px)";
        el.style.opacity = (n.d < 3 ? 1 : Math.max(0.3, 1 - (n.d - 3) / 7)).toFixed(2);
        if (el.style.display !== "block") el.style.display = "block";
      }
    }
    for (; li < R.lootLbls.length; li++) if (R.lootLbls[li].style.display !== "none") R.lootLbls[li].style.display = "none";
  }
  R.cross.style.display = (p.input.ads && wid && K.WEAPONS[wid] && K.WEAPONS[wid].scope) ? "none" : "block";
  const locked = W.pointerLocked && W.pointerLocked();
  const dom = W.kernel.renderer.domElement;
  // Show the OS cursor whenever the mouse is NOT captured: a hidden cursor with
  // no pointer lock is the worst of both worlds — you cannot see where the mouse
  // is and the camera will not turn.
  // `p` is W._camFocus — while SPECTATING that is the live player you are
  // watching, not you. Both of these are about YOUR controls, so they read
  // W.player directly: gating them on p.alive left "CLICK TO LOOK AROUND"
  // sitting over the elimination panel of a dead player who cannot look around
  // at all (A/D switches who you watch instead).
  const meAlive = !!(W.player && W.player.alive);
  const wantCursor = meAlive && !W.paused && locked ? "none" : "";
  if (dom.style.cursor !== wantCursor) dom.style.cursor = wantCursor;
  if (R.lookHint) {
    // never in touch mode: a phone has no pointer lock and looks with the
    // right thumb (touch.js), so "CLICK TO LOOK" would be a lie there
    // ...nor over the result card of a match that is over (a winner is still alive there)
    const wantHint = !touchOn && !locked && meAlive && !W.paused && W.phase !== "menu" && !(W.match && W.match.over);
    const d2 = wantHint ? "block" : "none";
    if (R.lookHint.style.display !== d2) R.lookHint.style.display = d2;
  }
  // Reticle pinned to SCREEN CENTER in every mode (owner: "cursor always
  // stays CENTERED") — shots aim through center (weapons.js crosshairPoint),
  // and the unlocked mouse pans the camera instead of dragging the reticle.
  if (R._crossAtCursor) {
    R._crossAtCursor = false;
    R.cross.style.left = "50%"; R.cross.style.top = "50%";
    R.cross.style.transform = "translate(-50%,-50%)";
  }
  // Reticle spread from the ACTUAL spread the next shot will use, not a guess.
  // One scratch query object (this built a fresh literal every frame).
  let spreadNow = 1;
  if (p.weapon && K.WEAPONS[p.weapon.id]) {
    _sq.ads = !!p.input.ads && (p._adsT || 0) >= ((K.WEAPONS[p.weapon.id].adsTimeS) || 0);   // reticle must not promise accuracy fire() won't give
    _sq.speed = Math.hypot(p.vel.x, p.vel.z);
    _sq.airborne = !p.onGround;
    _sq.crouching = !!p.crouching;
    _sq.sinceLastShotS = W.t - (p.lastShotT == null ? -9 : p.lastShotT);   // 0 is a REAL time, not 'missing'
    spreadNow = K.effectiveSpread(p.weapon.id, p.weapon.rarity, _sq);
  }
  const bloom = Math.max(0.4, Math.min(3.2, 0.35 + spreadNow * 0.55));
  if (C.bloom !== bloom) {
    C.bloom = bloom; R._bloom = bloom;
    setReticleGap(bloom);          // arms move; the stroke never scales
  }
  mkUpdate(dt);
}
const _sq = { ads: false, speed: 0, airborne: false, crouching: false, sinceLastShotS: 0 };

// ── touch keep-out for world-anchored labels (Wave 7b C2) ────────────────────
// The loot pills are projected anywhere on screen, so on a phone a chest near
// the landing spot drew "CHEST" under the FIRE button (layoutcheck / hud_checks
// iphone14 + pixel7, Isla Viva at 69 chests). In touch mode every pill is
// tested against the rects of the on-screen controls (data-touch-ui, + the
// portal control bar) and the reticle: over the reticle it is lifted above it,
// over a control it is not drawn (its pool slot goes to the next item). The
// rects are re-read only when the view size or the touch layer's visibility
// changes, and every 10 HUD frames otherwise (the stick floats under the
// thumb): one getBoundingClientRect batch, then plain numbers - nothing is
// allocated per frame. Desktop never enters this path.
const KO_PAD = 3;                        // px of air between a pill and a control
const _ko = { f: 99, vis: null, vw: -1, vh: -1, n: 0, box: new Float64Array(4 * 16), els: null, wid: new Map(), h: 0, rr: 31 };
function koRefresh(W, sw, sh) {
  const k = _ko;
  const vis = !!(W.touch && W.touch.visible);
  const r = R._ret;
  k.rr = Math.max(28, ((r && r.gapPx) || 0) + ((r && r.len) || 0)) + KO_PAD;
  if (++k.f < 10 && vis === k.vis && sw === k.vw && sh === k.vh) return true;
  k.f = 0; k.vis = vis; k.vw = sw; k.vh = sh; k.n = 0;
  const lbls = R.lootLbls;
  // measured pill sizes (by text), from the pills on screen now
  for (let i = 0; i < lbls.length; i++) {
    const el = lbls[i];
    if (el.style.display !== "block" || !el._t) continue;
    const w = el.offsetWidth;
    if (w > 0) { if (k.wid.size > 256) k.wid.clear(); k.wid.set(el._t, w); k.h = el.offsetHeight; }
  }
  if (!vis) return true;
  const host = lbls[0] && lbls[0].parentElement;
  if (!host) return true;
  if (!k.els || !k.els.length || !k.els[0].isConnected) k.els = document.querySelectorAll("[data-touch-ui]");
  const hr = host.getBoundingClientRect();
  const ox = hr.left, oy = hr.top;
  for (let i = 0; i < k.els.length; i++) koPush(k.els[i], ox, oy);
  koPush(document.getElementById("__ff_controls__"), ox, oy);
  return true;
}
function koPush(e, ox, oy) {
  const k = _ko;
  if (!e || k.n >= 16) return;
  const b = e.getBoundingClientRect();
  if (b.width < 1 || b.height < 1) return;            // display:none / hidden layer
  const o = 4 * k.n++;
  k.box[o] = b.left - ox - KO_PAD; k.box[o + 1] = b.top - oy - KO_PAD;
  k.box[o + 2] = b.right - ox + KO_PAD; k.box[o + 3] = b.bottom - oy + KO_PAD;
}
/** the pill's bottom-centre y after the keep-out (lifted over the reticle), or null = not drawn */
function koPlace(txt, x, y) {
  const k = _ko;
  const w = k.wid.get(txt) || (txt.length * 8.6 + 20);
  const h = k.h || 21;
  const x0 = x - w / 2, x1 = x + w / 2;
  const cx = k.vw / 2, cy = k.vh / 2, rr = k.rr;
  if (x1 > cx - rr && x0 < cx + rr && y > cy - rr && y - h < cy + rr) y = cy - rr;
  for (let i = 0, o = 0; i < k.n; i++, o += 4) {
    const b = k.box;
    if (x1 > b[o] && x0 < b[o + 2] && y > b[o + 1] && y - h < b[o + 3]) return null;
  }
  return y;
}
// Dirty check for the slot row, allocation-free: the last painted id / count /
// rarity per slot, the active index, and every ammo pool, compared in place.
const _slotC = { who: null, active: -2, n: -1, ids: [], counts: [], rars: [], ammo: {}, ammoN: -1 };
function slotsDirty(p) {
  const inv = p.inventory, c = _slotC, sl = inv.slots;
  let dirty = c.who !== p || c.active !== inv.active || c.n !== sl.length;
  for (let i = 0; i < sl.length; i++) {
    const s = sl[i];
    const id = s ? s.id : null, cnt = s ? (s.count || 0) : 0, rr = s ? (s.rarity || 0) : 0;
    if (c.ids[i] !== id || c.counts[i] !== cnt || c.rars[i] !== rr) { dirty = true; c.ids[i] = id; c.counts[i] = cnt; c.rars[i] = rr; }
  }
  let an = 0;
  const am = inv.ammo || {};
  for (const k in am) { an++; if (c.ammo[k] !== am[k]) { dirty = true; c.ammo[k] = am[k]; } }
  if (an !== c.ammoN) { dirty = true; c.ammoN = an; }
  c.who = p; c.active = inv.active; c.n = sl.length;
  return dirty;
}

// ═══ directional indicators ══════════════════════════════════════════════════
// Screen-edge cues (industry standard): white footsteps for nearby movement,
// white/gold chevrons for gunfire direction (≤250m), red arcs for damage taken.
// A FIXED pool of IND_POOL nodes per HUD (built by showHUD): every footstep /
// gunshot / hit cue used to createElement a fresh div and remove() it 0.9-1.6 s
// later, so a firefight churned DOM nodes in exactly the frames that matter.
// The pool size is the old live cap (14); when all are live the oldest is reused.
const IND_POOL = 14;
// LC-70: how far a footstep carries, by stance - the same ranges audio.js gives its STEP rows (d: crouch 11, walk 22, sprint 34)
const STEP_HEAR_M = { crouch: 11, walk: 22, sprint: 34 };
const inds = [];      // live cues: {el, ang, t, life, kind}
const indFree = [];   // parked pool entries of the CURRENT HUD
const stepMarks = new Map(); // actorId -> last footstep indicator time
function buildIndicatorPool() {
  inds.length = 0; indFree.length = 0;
  for (let i = 0; i < IND_POOL; i++) {
    const el = h("div", { position: "absolute", left: "50%", top: "50%", display: "none", opacity: "0", willChange: "transform, opacity", fontSize: "20px", fontWeight: "900", textShadow: "0 1px 4px #000" }, null, R.indicators);
    indFree.push({ el, ang: 0, t: 0, life: 1, kind: "" });
  }
}
function parkIndicator(d) {
  d.el.style.display = "none"; d.el.style.opacity = "0"; d._op = 0;
  indFree.push(d);
}
function addIndicator(W, worldX, worldZ, kind) {
  if (!R.indicators || !W.player || (W.settings && W.settings.soundVis === false)) return;
  const p = W.player;
  const ang = Math.atan2(worldX - p.pos.x, worldZ - p.pos.z);   // world bearing
  const d = indFree.pop() || inds.shift();     // pool exhausted: reuse the oldest live cue
  if (!d) return;
  const el = d.el;
  if (d.kind !== kind) {
    const st = el.style;
    if (kind === "footstep") { el.textContent = "👣"; st.filter = "grayscale(1) brightness(2)"; st.fontSize = "17px"; st.color = ""; st.letterSpacing = ""; }
    else if (kind === "shot") { el.textContent = "︿"; st.filter = ""; st.fontSize = "20px"; st.color = "#ffe9a0"; st.letterSpacing = ""; }
    else if (kind === "fall") { el.textContent = "︽"; st.filter = ""; st.fontSize = "30px"; st.color = (R._cbPal || CB_PAL.off).dmg; st.letterSpacing = ""; }
    else { el.textContent = "❮❯"; st.filter = ""; st.fontSize = "34px"; st.color = (R._cbPal || CB_PAL.off).dmg; st.letterSpacing = "-4px"; }
    d.kind = kind;
  }
  d.ang = ang; d.t = 0; d.life = kind === "damage" ? 1.6 : kind === "shot" ? 1.2 : 0.9;
  el.style.opacity = "0"; d._op = 0;   // stepIndicators places it and fades it in this frame (d._op: its last written opacity)
  el.style.display = "block";
  inds.push(d);
}
function stepIndicators(W, dt) {
  if (!R.indicators) return;
  // Turning the ring off mid-match has to clear what is already on screen —
  // otherwise whatever was showing freezes there until it ages out.
  if (W.settings && W.settings.soundVis === false) {
    while (inds.length) parkIndicator(inds.pop());
    return;
  }
  const p = W.player;
  if (!p) return;
  // footstep scan at 3Hz: moving actors you could HEAR (visualized sound). LC-70: it used to be anyone moving within 30 m - a crouched
  // enemy at 25 m showed a footprint audio.js would never play (crouch steps carry 11 m), and every squad-mate walking beside you filled
  // the ring. The radius is now the footstep's own audible range by stance (audio.js STEP: crouch 11 m, walk 22 m, sprint 34 m; a remote
  // actor's sprint arrives with the LC-09 sprint bit), and team-mates are never shown.
  stepIndicators._acc = (stepIndicators._acc || 0) + dt;
  if (stepIndicators._acc > 0.33) {
    stepIndicators._acc = 0;
    const myTeam = p.teamId;
    for (const a of W.actors) {
      if (a === p || !a.alive) continue;
      if (myTeam && a.teamId === myTeam) continue;
      const d = Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z);
      if (d > (a.crouching ? STEP_HEAR_M.crouch : a.sprinting ? STEP_HEAR_M.sprint : STEP_HEAR_M.walk)) continue;
      if (Math.hypot(a.vel.x, a.vel.z) < 2) continue;
      const last = stepMarks.get(a.id) || -9;
      if (W.t - last < 1.4) continue;
      stepMarks.set(a.id, W.t);
      addIndicator(W, a.pos.x, a.pos.z, "footstep");
    }
  }
  // position + fade all live indicators around a screen-centred ring. The view
  // size is the C1 cache (this read clientWidth/Height every frame). A ring of
  // min(w,h)*0.36 put the straight-ahead cue at y 101 on a 720p screen, right on
  // the LVL chip (feel-juice-ui G4), and keeping it only under the band's TOP
  // still left it inside the DEPLOY / ELIMINATED title (y ~204 at 720p). The
  // radius is now derived from the band: the top cue (a 34 px glyph, ~24 px
  // half-height) sits wholly below the band's bottom. A circle, not an ellipse,
  // so a cue's screen angle stays its true bearing.
  if (!inds.length) return;
  viewSize(W);
  const bandBottom = ((R._bandTop || (META_TOP + META_RESERVE + BAND_GAP)) + bandH()) * (R._hs || 1);   // LC-43: the band scales with the top stack
  const RAD = Math.max(64, Math.min(Math.min(_vw, _vh) * 0.36, _vh / 2 - bandBottom - IND_HALF));
  R._ringR = RAD;
  for (let i = inds.length - 1; i >= 0; i--) {
    const d = inds[i];
    d.t += dt;
    if (d.t > d.life) { inds.splice(i, 1); parkIndicator(d); continue; }
    // screen angle relative to the camera facing (0 = up/forward)
    const rel = d.ang - p.yaw + Math.PI;
    // written only when the rounded pixel / degree / opacity step changes (each write built 1-2 strings per cue per frame)
    const sx = Math.round(Math.sin(rel) * RAD), sy = Math.round(-Math.cos(rel) * RAD), dg = Math.round(rel * 180 / Math.PI);
    if (d._sx !== sx || d._sy !== sy || d._dg !== dg) {
      d._sx = sx; d._sy = sy; d._dg = dg;
      d.el.style.transform = `translate(calc(${sx}px - 50%), calc(${sy}px - 50%)) rotate(${dg}deg)`;
    }
    const op = Math.max(0, Math.round((1 - d.t / d.life) * 50)) / 50;
    if (d._op !== op) { d._op = op; d.el.style.opacity = String(op); }
  }
}

// ── slot icons: weapons are RENDERED 3D thumbnails of the actual view models;
// consumables use big legible glyphs ─────────────────────────────────────────
let iconR = null, iconScene = null, iconCam = null;
const iconCache = {};
function ensureIconRig() {
  if (iconR) return;
  iconR = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  iconR.setSize(96, 72);
  iconScene = new THREE.Scene();
  iconScene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.5));
  const d = new THREE.DirectionalLight(0xffffff, 1.8);
  d.position.set(2, 3, 4);
  iconScene.add(d);
  iconCam = new THREE.PerspectiveCamera(28, 96 / 72, 0.01, 20);
}
function renderThumb(proto, cacheKey, tilt) {
  if (!proto) return null;
  if (iconCache[cacheKey]) return iconCache[cacheKey];
  ensureIconRig();
  const m = proto.clone();
  iconScene.add(m);
  const bbox = new THREE.Box3().setFromObject(m);
  const c = bbox.getCenter(new THREE.Vector3());
  const span = bbox.getSize(new THREE.Vector3()).length();
  m.position.sub(c);
  // +PI/2: the proto barrel is +Z, and +90deg about Y maps +Z to +X = muzzle
  // pointing screen-RIGHT — the FD/industry hotbar convention (owner report:
  // every icon faced left; -PI/2 mapped the barrel to -X)
  m.rotation.set(tilt != null ? tilt : 0.2, Math.PI / 2 - 0.45, 0);   // 3/4 profile
  iconCam.position.set(0, span * 0.12, span * 1.35);
  iconCam.lookAt(0, 0, 0);
  iconR.render(iconScene, iconCam);
  const url = iconR.domElement.toDataURL();
  iconScene.remove(m);
  iconCache[cacheKey] = url;
  return url;
}
function weaponIcon(W, id) {
  if (iconCache[id]) return Promise.resolve(iconCache[id]);
  if (!W.weaponProto) return Promise.resolve(null);
  return W.weaponProto(id).then((proto) => renderThumb(proto, id)).catch(() => null);
}
function itemIcon(W, id) {
  const key = "item:" + id;
  if (iconCache[key]) return Promise.resolve(iconCache[key]);
  if (!W.itemProto) return Promise.resolve(null);
  return W.itemProto(id).then((proto) => renderThumb(proto, key, 0.35)).catch(() => null);
}
/** Wave 7 (lane 7F): build every slot thumbnail while the LOBBY is up. The icon renderer is a second WebGL context: creating it, linking its
 *  program and uploading a gun's mesh plus its textures into it all ran on the first frames of the DROP (the starting pistol: getContext 5-7 ms and a
 *  24-62 ms render + readback on drop frame 1) and again on the first pickup of each weapon / item kind (measured: the AR at 66 s, a bandage and a
 *  shield at 85 s) - the same mid-match stall as a late shader program, in a context the main renderer's program census cannot see. iconCache outlives
 *  the match, so this runs once per page; one icon per timer tick (no task longer than one icon); and only while the lobby is still showing - once the
 *  drop starts the lazy path above takes over exactly as before. Cosmetic: any failure leaves the lazy path. */
let _iconWarmRun = 0;
function warmIcons(W) {
  const run = ++_iconWarmRun;
  const jobs = [];
  for (const id of Object.keys(K.WEAPONS || {})) if (!iconCache[id]) jobs.push(() => weaponIcon(W, id));
  // LC-16: the new guns' runtime silhouettes, in the same idle window (never on the drop's first frames)
  for (const id of (K.WEAPON_IDS || [])) if (!SIL_SHIPPED[id] && !_sil.st[id]) jobs.push(() => silRuntime(W, id));
  for (const id of Object.keys(K.CONSUMABLES || {})) if (!iconCache["item:" + id]) jobs.push(() => itemIcon(W, id));
  let i = 0;
  const step = () => {
    if (run !== _iconWarmRun || W.phase !== "lobby" || i >= jobs.length) return;
    try { jobs[i++](); } catch (e) { /* cosmetic only */ }
    setTimeout(step, 50);
  };
  setTimeout(step, 100);
}

// ── per-weapon crosshairs ────────────────────────────────────────────────────
// Each weapon class gets its own reticle shape sized to its real spread/range:
//   pistol/smg = tight 4-line cross · AR = wider cross + dot ·
//   shotgun = pellet-spread ring · sniper = fine dot (scope on ADS) ·
//   grenade launcher = chevron arc pip · consumables = open hands (dot)
function paintCrosshair(W, weaponId) {
  if (!R.cross) return;
  clear(R.cross);
  const CENTER = 28;
  // Reticle colour is a level-gated cosmetic (CROSS_COLORS). The launcher's
  // amber chevron below is deliberately NOT recoloured — that colour is a
  // trajectory hint, not chrome.
  const CC = playableColor(CROSS_COLORS, W.settings && W.settings.crossColor, W).css;
  const mk = (styles) => h("div", Object.assign({ position: "absolute", background: CC, boxShadow: "0 0 2px rgba(0,0,0,0.9)" }, styles), null, R.cross);
  const dot = (r) => mk({ left: (CENTER - r) + "px", top: (CENTER - r) + "px", width: r * 2 + "px", height: r * 2 + "px", borderRadius: "50%" });
  const line = (x, y, w, hh) => mk({ left: (CENTER + x) + "px", top: (CENTER + y) + "px", width: w + "px", height: hh + "px", borderRadius: "1px" });
  // Arms are built CENTRED on the reticle and pushed outward by transform
  // (setReticleGap). g0 = the gap at bloom 1; the stroke (th) and the length
  // never change with spread.
  R._ret = { kind: null, arms: [], gap0: 0, len: 0, th: 0, min: 3, gapPx: -1 };
  const cross4 = (g0, len, th) => {
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const vert = dx === 0, w = vert ? th : len, hh = vert ? len : th;
      const el = mk({ left: (CENTER - w / 2) + "px", top: (CENTER - hh / 2) + "px", width: w + "px", height: hh + "px", borderRadius: "1px" });
      el.dataset.lc = "arm";
      R._ret.arms.push({ el, dx, dy });
    }
    Object.assign(R._ret, { kind: "cross", gap0: g0, len, th, min: 3 });
  };
  const def = K.WEAPONS[weaponId];
  const cls = def ? def.cls : null;
  if (cls === "pistol" || cls === "smg") { cross4(6, 7, 2); dot(1.5); }
  else if (cls === "ar") { cross4(9, 8, 2); dot(1.5); }
  else if (cls === "shotgun") {
    // ring ≈ the real pellet cone at mid-range — now four 2 px quarter-arcs of
    // radius 12 that spread apart with the cone instead of one ring whose stroke
    // scaled with it
    const AR = 12;
    for (const deg of [0, 90, 180, 270]) {
      const el = h("div", {
        position: "absolute", left: (CENTER - AR) + "px", top: (CENTER - AR) + "px", width: AR * 2 + "px", height: AR * 2 + "px",
        boxSizing: "border-box", borderRadius: "50%", border: "2px solid transparent", borderTopColor: CC,
        filter: "drop-shadow(0 0 1px rgba(0,0,0,0.95))", transform: "rotate(" + deg + "deg)",
      }, null, R.cross);
      el.dataset.lc = "arm";
      R._ret.arms.push({ el, deg });
    }
    Object.assign(R._ret, { kind: "arc", gap0: 16, len: AR, th: 2, min: AR });
    dot(1.5);
  }
  else if (cls === "sniper") { dot(2); line(-1, 10, 2, 8); }  // fine dot + drop hint (scope overlay on ADS)
  else if (cls === "dmr") { cross4(7, 7, 2); dot(1.5); line(-1, 12, 2, 5); }     // LC-16: a tight cross + a short drop hint
  else if (cls === "lmg") { cross4(11, 9, 2); dot(1.5); }                         // LC-16: the widest automatic cone
  else if (cls === "launcher" || isThrowable(weaponId)) {      // LC-14: a held frag (or smoke) is lobbed too
    dot(2);
    // arc chevron hinting the lobbed trajectory
    const ch = h("div", { position: "absolute", left: (CENTER - 7) + "px", top: (CENTER + 8) + "px", width: "14px", height: "14px", border: "2px solid rgba(255,200,120,0.95)", borderTop: "none", borderLeft: "none", transform: "rotate(45deg)", boxShadow: "0 0 2px rgba(0,0,0,0.8)" }, null, R.cross);
  }
  else if (def) { cross4(9, 8, 2); dot(1.5); }   // a gun this table does not know yet: a plain cross, never a bare dot
  else { dot(2); } // consumable / fallback
  R._crossFor = weaponId;
  setReticleGap(R._bloom || 1);
}

function paintSlots(W, p) {
  clear(R.slotsRow);
  p.inventory.slots.forEach((s, i) => {
    const active = i === p.inventory.active;
    const cell = h("div", {
      width: "56px", height: "46px", borderRadius: "8px", position: "relative",
      background: active ? "rgba(87,176,255,0.25)" : "rgba(0,0,0,0.45)",
      border: active ? "2px solid #57b0ff" : "1px solid rgba(255,255,255,0.18)",
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: FS(11), fontWeight: "800",
      overflow: "hidden",
    }, null, R.slotsRow);
    if (s) {
      const rc = s.kind === "weapon" ? (K.RARITY_COLOR[K.RARITY[s.rarity || 0]] || "#9da5b4") : "#8fd3a0";
      h("div", { position: "absolute", left: "0", right: "0", bottom: "0", height: "3px", background: rc }, null, cell);
      // Rarity was communicated by HUE ALONE. Add the tier as a numeral so it
      // survives any colour-vision deficiency (and reads faster for everyone).
      if (s.kind === "weapon") {
        h("div", {
          position: "absolute", left: "3px", top: "2px", fontSize: FS(9), fontWeight: "900",
          color: rc, textShadow: "0 1px 2px #000", letterSpacing: "0.5px",
        }, ["I", "II", "III", "IV", "V"][s.rarity || 0], cell);
      }
      if (s.kind === "weapon") {
        const img = h("img", { width: "52px", height: "38px", objectFit: "contain", display: "none" }, null, cell);
        const txt = h("div", {}, shortName(s), cell);
        weaponIcon(W, s.id).then((url) => {
          if (url && img.isConnected) { img.src = url; img.style.display = "block"; txt.remove(); }
        });
        // reserve ammo on the slot (Final Drop style)
        const def = K.WEAPONS[s.id];
        if (def && def.ammo) h("div", { position: "absolute", right: "3px", bottom: "5px", fontSize: FS(10), fontWeight: "900", textShadow: "0 1px 2px #000" }, String(p.inventory.ammo[def.ammo] || 0), cell);
      } else {
        // a dark outline keeps a pale render (the olive frag) readable on a translucent cell over bright grass or sky
        const img = h("img", { width: "40px", height: "36px", objectFit: "contain", display: "none", filter: "drop-shadow(0 0 1px rgba(0,0,0,0.9)) drop-shadow(0 1px 2px rgba(0,0,0,0.7))" }, null, cell);
        const glyph = h("div", { fontSize: "24px", lineHeight: "1", color: CON_COLOR[s.id] || "#8fd3a0", filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,0.85))" }, null, cell);
        glyph.className = "lc-ic"; glyph.innerHTML = CON_ICON[s.id] || IC.shieldO;
        itemIcon(W, s.id).then((url) => {
          if (url && img.isConnected) { img.src = url; img.style.display = "block"; glyph.remove(); }
        });
      }
      if (s.count) h("div", { position: "absolute", right: "3px", top: "1px", fontSize: FS(10), opacity: "0.95", textShadow: "0 1px 2px #000" }, String(s.count), cell);
    }
    h("div", { position: "absolute", left: "3px", top: "1px", fontSize: FS(9), opacity: "0.6" }, String(i + 1), cell);
  });
  paintCons(W, p);       // the vitals row's consumable counts change exactly when the slots do
}
function shortName(s) {
  const M = { pistol: "PSTL", smg: "SMG", ar: "AR", shotgun: "SHTG", sniper: "SNPR", glauncher: "GL", bandage: "BAND", medkit: "MED", mini_shield: "MINI", big_shield: "SHLD", frag: "FRAG",
              // LC-16 roster (lane sim ids) + the smoke (C-SMOKE)
              dmr: "DMR", lmg: "LMG", burst: "BRST", burst_ar: "BRST", bar: "BRST", smoke: "SMKE" };
  if (M[s.id]) return M[s.id];
  const def = K && K.WEAPONS && K.WEAPONS[s.id];
  if (def && def.short) return String(def.short).toUpperCase().slice(0, 5);
  return s.id.slice(0, 4).toUpperCase();
}
/** AUTO / SEMI / BURST for the weapon card (LC-16). The SAME rule weapons.js fires by: K.fireMode (sim) - its `fire` field, else
 *  the class rule - so the card can never disagree with the trigger (the verifier saw LMG SEMI / burst AUTO on a cls-only rule). */
function fireLabel(def) {
  let f = null;
  if (def && K && typeof K.fireMode === "function") { try { f = K.fireMode(def); } catch (e) { f = null; } }
  if (!f) f = def && def.fire;
  if (f === "burst") return "BURST";
  if (f === "auto") return "AUTO";
  if (f === "semi") return "SEMI";
  return def && (def.cls === "smg" || def.cls === "ar" || def.cls === "lmg") ? "AUTO" : "SEMI";
}
function labelFor(d) {
  if (!d) return "Pick up";
  // (a `d.id !== "grenade"` test lived here: no weapon was ever called "grenade", and the frag is a consumable - LC-14 - so it never
  //  reaches this branch. Every weapon names its rarity.)
  if (d.kind === "weapon") return "Pick up " + shortName(d) + " (" + K.RARITY[d.rarity || 0] + ")";
  if (d.kind === "consumable" && (d.id === "frag" || d.id === "smoke" || (K.CONSUMABLES[d.id] && K.CONSUMABLES[d.id].throws))) return "Pick up " + (CON_NAME[d.id] || d.id.toUpperCase()) + (d.count > 1 ? " x" + d.count : "");
  return "Pick up " + shortName(d);
}
/** Guns any actor may CARRY — mirrors GUN_CAP in loot.js, which is module-private
 *  there. Only the wording of this prompt depends on it, so a drift costs a
 *  slightly-off label, never wrong behaviour. */
const HUD_GUN_CAP = 3;
/** The prompt has to name the OUTCOME. E is unconditionally a swap
 *  (loot.js: pickup(..., { swap: true })), and give()'s swap branch DROPS
 *  whatever is in your active slot — but the hint always read "Pick up", so at
 *  five full slots the button that looked like a pickup threw your legendary AR
 *  on the ground for a common pistol you meant to walk past. */
function interactLabel(W, data) {
  const me = W.player, inv = me && me.inventory;
  const E = touchOn ? "TAP USE  ·  " : "[" + keyOf(W, "KeyE") + "] ";
  if (!data || !inv || !W.wouldAcceptItem || W.wouldAcceptItem(me, data)) return E + labelFor(data);
  const what = labelFor(data).replace("Pick up ", "");
  // Three cases where the swap itself is refused by give() and E does nothing:
  // ammo has no swap branch at all, a same-kind consumable stack already at max
  // returns before it reads data.swap, and a weapon swap off a NON-gun slot is
  // refused at the carry cap because it would push you past it.
  const out = inv.slots[inv.active];
  const guns = inv.slots.filter((s) => s && s.kind === "weapon").length;
  const blocked = data.kind === "ammo"
    || (data.kind === "consumable" && inv.slots.some((s) => s && s.kind === "consumable" && s.id === data.id))
    || (data.kind === "weapon" && (!out || out.kind !== "weapon") && guns >= HUD_GUN_CAP);
  if (blocked) return "FULL — no room for " + what;
  return E + "Swap for " + what + (out ? " — drops " + shortName(out) : "");
}
function fmtT(s) {
  s = Math.max(0, Math.ceil(s));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

// ═══ PINGS (parity LC-07) ══════════════════════════════════════════════════════
// The game had no way to point at anything: middle mouse, Z and G added 0 DOM nodes (verify/lc07), so a squad with no voice could not say
// "there" - Apex's ping was designed and play-tested with voice BANNED for exactly this (pcgamer.com, Apex ping system). Now:
//   * MIDDLE MOUSE or the rebindable PING key (canonical "KeyZ", default Z - Settings > Keybinds) marks what the reticle is on: the world point
//     of K.aimRayDist (the same march the bullets use, read-only), or an ENEMY when an enemy body is under the reticle nearer than the world;
//   * the BIG MAP (M): a click drops a map PIN (a waypoint) and the map stays open; right-click clears it;
//   * each ping shows as a pip in the world with its distance (an arrow on the screen edge when it is off screen), a tick on the compass and
//     a diamond on the minimap and the big map;
//   * lifetime 30 s; a location ping and a map pin also end when their owner walks up to them; one world ping and one pin per player, a new
//     one replaces the old;
//   * online, net.js sends it to the squad (W.sendPing: 1 per second, team-filtered on receipt) and squad pings arrive as "netPing";
//   * every placed ping (own and received) emits "pingPlaced" for audio.js to voice (lane P1-B);
//   * touch has no binding (the touch layer and its paths are unchanged).
const PING_LIFE_S = 30;            // a ping's lifetime
const PING_ARRIVE_M = 5;           // a location ping / map pin ends when its owner is this close (horizontal)
const PING_FAR = 600;              // how far the ping ray reaches
const PING_POOL = 10;              // world pips (4 humans x world ping + map pin, with room to spare)
const PING_KEY = "KeyZ";           // the canonical code of the Ping action (ACTIONS); the physical key is whatever Settings bound to it
const PING_COL_ME = "#ffd254", PING_COL_ENEMY = "#ff5a4a";
const PING_COL_MATE = ["#6ec4ff", "#7cf0a8", "#ff9df0", "#c9a6ff"];
const PINGS = { list: [], lastLocal: -1e9, placed: 0, sent: 0, recv: 0, mmDrawn: 0 };
const _pv = new THREE.Vector3(), _pdir = new THREE.Vector3(), _pcols = [];

function pingColor(W, pg) {
  const pal = R._cbPal || CB_PAL.off;                  // LC-43: the colour-vision palette (off = the original colours)
  if (pg.kind === "enemy") return pal.enemy;
  if (W.player && pg.owner === W.player.id) return PING_COL_ME;
  return mateColor(pg.owner);
}
/** A squadmate's colour: the same one on their pings, their minimap blip, their vitals chip and their tag. */
const _mateIdx = new Map();                           // actor id -> palette index (ids never change; no per-call string work)
function mateColor(id) {
  const pal = (R._cbPal || CB_PAL.off).mates;
  let n = _mateIdx.get(id);
  if (n === undefined) { n = parseInt(String(id).slice(1), 10); if (!Number.isFinite(n)) n = 0; _mateIdx.set(id, n); }
  return pal[n % pal.length];
}
/** Add (or replace) a ping. `pg` = { owner, kind: "go" | "enemy" | "pin", src: "w" | "m", x, y, z }. Local pings go to the squad too. */
function addPing(W, pg, local) {
  if (!pg || !Number.isFinite(pg.x) || !Number.isFinite(pg.z)) return null;
  const y = Number.isFinite(pg.y) ? pg.y : (W.map && W.map.heightAt ? W.map.heightAt(pg.x, pg.z) : 0);
  const key = pg.owner + ":" + (pg.src === "m" ? "m" : "w");
  const p = { key, owner: pg.owner, kind: pg.kind, src: pg.src === "m" ? "m" : "w", x: pg.x, y, z: pg.z, born: W.t, local: !!local,
              dist: null, scr: null, cmp: null };
  PINGS.list = PINGS.list.filter((q) => q.key !== key);
  PINGS.list.push(p);
  PINGS.placed++;
  if (local && W.net && W.sendPing && W.sendPing({ k: p.kind, src: p.src, x: p.x, y: p.y, z: p.z })) PINGS.sent++;
  mmT = 1;                                       // the minimap repaints on this frame's HUD tick, not up to 100 ms later
  if (W.events) W.events.emit("pingPlaced", { owner: p.owner, kind: p.kind, src: p.src, x: p.x, y: p.y, z: p.z, own: !!local });
  return p;
}
function clearPing(W, owner, src, local) {
  const key = owner + ":" + (src === "m" ? "m" : "w");
  const had = PINGS.list.length;
  PINGS.list = PINGS.list.filter((q) => q.key !== key);
  if (PINGS.list.length !== had) mmT = 1;
  if (local && W.net && W.sendPing) W.sendPing({ k: "clr", src });
}
/** Can the local player ping right now? Alive, in a live match, on a mouse (touch has no binding), with no menu over the match. */
function pingReady(W) {
  if (touchOn || !R.hud || !W.player || !W.player.alive) return false;
  if (W.phase !== "match" && W.phase !== "drop") return false;
  if (W.paused || R.pause || R.settings || R.howto || R.post || R.career) return false;
  return true;
}
/** What is the reticle on? An enemy body (kind "enemy", at the body), else the first solid point of the camera ray (kind "go"), else
 *  nothing (sky past PING_FAR). Same geometry as weapons.js crosshairPoint: the ray through screen centre, actor capsules, then
 *  K.aimRayDist against the terrain and the colliders from the ray's closest approach to the player's eye. */
function pingTarget(W) {
  const cam = W.camera || (W.kernel && W.kernel.camera);
  const me = W.player;
  if (!cam || !me || !W.map || !K || !K.aimRayDist) return null;
  cam.getWorldDirection(_pdir);
  const o = cam.position;
  let best = PING_FAR, hitA = null;
  const r = ((K.PLAYERK && K.PLAYERK.radius) || 0.45) + 0.5;     // a ping is more forgiving than a bullet
  const denom = _pdir.x * _pdir.x + _pdir.z * _pdir.z;
  const myTeam = me.teamId;
  if (denom > 1e-6) for (const t of W.actors) {
    if (!t.alive || t === me || (myTeam && t.teamId === myTeam)) continue;
    const dx = t.pos.x - o.x, dz = t.pos.z - o.z;
    const u = (dx * _pdir.x + dz * _pdir.z) / denom;
    if (u < 1 || u > best) continue;
    const px = o.x + _pdir.x * u, pz = o.z + _pdir.z * u, py = o.y + _pdir.y * u;
    if ((px - t.pos.x) ** 2 + (pz - t.pos.z) ** 2 > r * r) continue;
    const top = t.pos.y + (K.actorHeight ? K.actorHeight(t) : 1.8) + 0.3;
    if (py < t.pos.y - 0.3 || py > top) continue;
    best = u; hitA = t;
  }
  const ex = me.pos.x, ey = me.pos.y + 1.6, ez = me.pos.z;
  const dEye = (ex - o.x) * _pdir.x + (ey - o.y) * _pdir.y + (ez - o.z) * _pdir.z;
  const d0 = dEye < 0.05 ? 0.05 : dEye > 8 ? 8 : dEye;
  const map = W.map;
  const dist = K.aimRayDist(o.x, o.y, o.z, _pdir.x, _pdir.y, _pdir.z, d0, best,
    (x, z) => map.heightAt(x, z), (x, z, rr, buf) => map.queryColliders(x, z, rr, buf), _pcols);
  if (hitA && dist >= best - 1e-6) return { kind: "enemy", x: hitA.pos.x, y: hitA.pos.y + 1.0, z: hitA.pos.z, actor: hitA.id };
  if (dist >= PING_FAR - 1e-3) return null;     // the sky: nothing to mark
  return { kind: "go", x: o.x + _pdir.x * dist, y: o.y + _pdir.y * dist, z: o.z + _pdir.z * dist };
}
/** The ping key / middle mouse. One ping per second (the same rate the squad receives). */
function placeWorldPing(W) {
  if (!pingReady(W)) return false;
  const nowMs = performance.now();
  if (nowMs - PINGS.lastLocal < 1000) return false;
  const tg = pingTarget(W);
  if (!tg) { flashMsg("NOTHING TO PING"); return false; }
  PINGS.lastLocal = nowMs;
  return !!addPing(W, { owner: W.player.id, kind: tg.kind, src: "w", x: tg.x, y: tg.y, z: tg.z }, true);
}
/** Big map: drop this player's map pin at world (x, z) (the big map turns its click into world space, zoom and pan included). */
function placeMapPin(W, x, z) {
  if (!W.map || !W.player || !Number.isFinite(x) || !Number.isFinite(z)) return false;
  return !!addPing(W, { owner: W.player.id, kind: "pin", src: "m", x, y: W.map.heightAt ? W.map.heightAt(x, z) : 0, z }, true);
}
/** The input listeners (once per page): the Ping key through the same remap canon() player.js applies, and middle mouse. */
let _pingInit = false;
function initPingInput(W) {
  if (_pingInit) return;
  _pingInit = true;
  const canon = (c) => {
    const rm = (W.settings && W.settings.remap) || {};
    if (rm[c]) return rm[c];
    return c;
  };
  window.addEventListener("keydown", (ev) => {
    if (ev.repeat || W.captureKey) return;
    if (ev.target && (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA")) return;
    if (canon(ev.code) !== PING_KEY) return;
    if (placeWorldPing(W)) ev.preventDefault();
  });
  window.addEventListener("mousedown", (ev) => {
    if (ev.button !== 1) return;
    if (!pingReady(W) || R.bigmap) return;
    ev.preventDefault();                          // no autoscroll cursor
    placeWorldPing(W);
  }, true);
  // a received squad ping (net.js, team-filtered + rate-limited there)
  W.events.on("netPing", (d) => {
    if (!d || !R.hud) return;
    PINGS.recv++;
    if (d.k === "clr") { clearPing(W, d.owner, d.src, false); return; }
    addPing(W, { owner: d.owner, kind: d.k, src: d.src, x: d.x, y: d.y, z: d.z }, false);
  });
}
/** Build the pip pool + the compass tick pool for a new HUD (showHUD). */
function buildPings(L, compWrap) {
  PINGS.list = [];
  PINGS.lastLocal = -1e9;
  R.pingEls = [];
  R.pingLayer = h("div", { position: "absolute", inset: "0", pointerEvents: "none" }, null, L);
  R.pingLayer.dataset.lc = "pings";
  for (let i = 0; i < PING_POOL; i++) {
    const el = h("div", null, null, R.pingLayer); el.className = "lc-ping";
    const arr = h("div", null, null, el); arr.className = "arr";
    const dia = h("div", null, null, el); dia.className = "dia";
    const lbl = h("div", null, "", el); lbl.className = "lbl";
    R.pingEls.push({ el, arr, dia, lbl, k: "", t: "", c: "", on: false, edge: null });
  }
  R.cmpPingEls = [];
  const box = h("div", { position: "absolute", left: "0", top: "22px", width: "300px", height: "26px", pointerEvents: "none" }, null, compWrap);
  box.dataset.lc = "compasspings";
  for (let i = 0; i < PING_POOL; i++) {
    const el = h("div", null, null, box); el.className = "lc-cping";
    R.cmpPingEls.push({ el, c: "", on: false, edge: null, x: null });
  }
}
/** Expire, project and paint every ping (update(), every frame; at most PING_POOL projections). `p` = the focus actor. */
function stepPings(W, p, hdg) {
  if (!R.pingEls) return;
  // expiry: lifetime, and arrival for location pings / map pins
  if (PINGS.list.length) {
    const keep = [];
    for (const q of PINGS.list) {
      if (W.t - q.born > PING_LIFE_S) continue;          // every kind, map pins included (PLAN LC-07: 30 s, or on arrival)
      if (q.kind !== "enemy" && W.t - q.born > 1) {
        const ow = W.actorById && W.actorById.get(q.owner);
        if (ow && ow.alive && Math.hypot(ow.pos.x - q.x, ow.pos.z - q.z) <= PING_ARRIVE_M) continue;
      }
      keep.push(q);
    }
    if (keep.length !== PINGS.list.length) { PINGS.list = keep; mmT = 1; }
  }
  const cam = W.camera || (W.kernel && W.kernel.camera);
  viewSize(W);
  const sw = _vw, sh = _vh;
  let i = 0;
  for (const q of PINGS.list) {
    if (i >= R.pingEls.length) break;
    const E = R.pingEls[i], C2 = R.cmpPingEls[i];
    i++;
    const col = pingColor(W, q);
    const d = Math.round(Math.hypot(q.x - p.pos.x, q.y - p.pos.y, q.z - p.pos.z));
    q.dist = d;
    // world pip / edge arrow
    let sx = sw / 2, sy = sh / 2, edge = false, ang = 0;
    if (cam) {
      _pv.set(q.x, q.y + (q.kind === "enemy" ? 1.1 : 0.4), q.z).project(cam);
      const behind = _pv.z > 1;
      let nx = _pv.x, ny = _pv.y;
      if (behind) { nx = -nx; ny = -ny; }
      const M = 0.86;                              // on screen = inside this NDC box
      if (behind || nx < -M || nx > M || ny < -M || ny > M) {
        // OFF SCREEN: an arrow on an ellipse round the reticle (like the sound ring), pointing the way to turn. The screen's own edge was the
        // first try: in the corners that put the arrow on the minimap and the kill feed. rx/ry keep it inside the HUD's free middle band
        // (under the quest card, over the vitals / weapon card) at 720p-1080p.
        edge = true;
        if (behind && Math.abs(nx) < 1e-3 && Math.abs(ny) < 1e-3) ny = -1;
        ang = Math.atan2(nx * sw, ny * sh);         // screen-space direction, 0 = up
        const rx = Math.min(sw * 0.36, sh * 0.62), ry = sh * 0.25;
        sx = sw / 2 + Math.sin(ang) * rx; sy = sh / 2 - Math.cos(ang) * ry;
      } else { sx = (nx * 0.5 + 0.5) * sw; sy = (-ny * 0.5 + 0.5) * sh; }
    }
    q.scr = { x: Math.round(sx), y: Math.round(sy), edge };
    if (!E.on) { E.el.style.display = "block"; E.on = true; }
    if (E.c !== col) { E.el.style.setProperty("--pc", col); E.c = col; }
    const kc = q.kind;
    if (E.k !== kc) { E.el.classList.toggle("enemy", kc === "enemy"); E.el.classList.toggle("pin", kc === "pin"); E.k = kc; }
    const txt = (kc === "enemy" ? "ENEMY  " : "") + d + " m";
    if (E.t !== txt) { E.lbl.textContent = txt; E.t = txt; }
    if (E.edge !== edge) { E.el.classList.toggle("edge", edge); E.edge = edge; }
    E.el.style.transform = "translate(-50%," + (edge ? "-50%" : "-10px") + ") translate(" + sx.toFixed(0) + "px," + sy.toFixed(0) + "px)";
    if (edge) E.arr.style.transform = "rotate(" + (ang * 180 / Math.PI).toFixed(0) + "deg)";
    // compass tick: the bearing in the compass's own convention (north = -Z, heading = -yaw), +-66 deg on the strip, clamped at its ends
    const brg = (Math.atan2(q.x - p.pos.x, -(q.z - p.pos.z)) * 180 / Math.PI + 360) % 360;
    let dl = brg - hdg; dl = ((dl + 540) % 360) - 180;
    const cEdge = Math.abs(dl) > 66;
    const cx = 150 + Math.max(-66, Math.min(66, dl)) * 2.2;
    q.cmp = { x: Math.round(cx), deg: Math.round(brg), edge: cEdge };
    if (!C2.on) { C2.el.style.display = "block"; C2.on = true; }
    if (C2.c !== col) { C2.el.style.setProperty("--pc", col); C2.c = col; }
    if (C2.edge !== cEdge) { C2.el.classList.toggle("edge", cEdge); C2.edge = cEdge; }
    if (C2.x !== q.cmp.x) { C2.el.style.left = q.cmp.x + "px"; C2.x = q.cmp.x; }
  }
  for (; i < R.pingEls.length; i++) {
    const E = R.pingEls[i], C2 = R.cmpPingEls[i];
    if (E.on) { E.el.style.display = "none"; E.on = false; }
    if (C2.on) { C2.el.style.display = "none"; C2.on = false; }
  }
}
/** Minimap / big map diamonds (drawMinimap). `tx`/`tz` map world x / z to canvas px. */
function drawPings(W, ctx, size, big, tx, tz) {
  let n = 0;
  for (const q of PINGS.list) {
    const x = tx(q.x), z = tz(q.z), r = big ? (q.kind === "pin" ? 9 : 7) : (q.kind === "pin" ? 5.5 : 4.5);
    if (!big && (x < -r || z < -r || x > size + r || z > size + r)) { n++; continue; }   // off the local window: on the compass / edge arrow
    ctx.fillStyle = pingColor(W, q);
    ctx.beginPath(); ctx.moveTo(x, z - r); ctx.lineTo(x + r, z); ctx.lineTo(x, z + r); ctx.lineTo(x - r, z); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(6,10,18,0.9)"; ctx.lineWidth = big ? 2 : 1.3; ctx.stroke();
    if (q.kind === "pin") { ctx.beginPath(); ctx.arc(x, z, r + (big ? 4 : 2.5), 0, Math.PI * 2); ctx.strokeStyle = pingColor(W, q); ctx.lineWidth = big ? 1.6 : 1; ctx.stroke(); }
    n++;
  }
  if (!big) PINGS.mmDrawn = n;
}

// ═══ minimap (LC-24) ═════════════════════════════════════════════════════════
// The minimap drew the whole 1600 m map into 180 px (8.9 m/px): a building was a pixel, the next circle a smudge. On a
// mouse desktop it is now a LOCAL map, north up, centred on the actor you are watching, at MM_MPP m per CSS px (2.5:
// 450 m across), with a faint 200 m grid that matches the big map's letters and a line to the next safe zone when you are
// outside it. Touch keeps the whole-map minimap exactly as it was (owner: phones untouched).
// The big map (M) zooms x1 / x2 / x4 (wheel or + / -) about the cursor, pans by dragging, and carries the A-H / 1-8 grid
// (200 m squares) PUBG-style callouts are made from. A click that did not drag drops the pin, as before.
const MM_MPP = 2.5;
const GRID_N = 8;                     // 8 x 8 squares (200 m on the 1600 m maps)
const BIG_ZOOMS = [1, 2, 4];
function mmView(W, size, big) {
  const S = W.map.size;
  if (big) return R._bigView || { cx: 0, cz: 0, span: S, z: 1 };
  if (touchOn) return { cx: 0, cz: 0, span: S, z: 1 };
  const p = W._camFocus || W.player;
  return { cx: p ? p.pos.x : 0, cz: p ? p.pos.z : 0, span: Math.min(S, size * MM_MPP), z: 0 };
}
function drawMinimap(W, ctx, size, big) {
  if (!W.map) return;
  // Backing store is size*dpr; draw in logical px (the 3D renderer honours DPR, so must the 2D HUD)
  const dpr = ctx.canvas.width / size || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const S = W.map.size;
  const vw = mmView(W, size, big);
  const span = vw.span, k = size / span;
  const x0 = vw.cx - span / 2, z0 = vw.cz - span / 2;
  const tx = (x) => (x - x0) * k, tz = (z) => (z - z0) * k;
  const local = span < S - 1e-6;
  if (local) {
    // the source window: W.map.minimap is the whole map at its own resolution; off the map edge is open sea
    ctx.fillStyle = "#0d2436";
    ctx.fillRect(0, 0, size, size);
    const src = W.map.minimap, N = src.width || 512, per = N / S;
    let sx = (x0 + S / 2) * per, sy = (z0 + S / 2) * per, sw = span * per, sh = span * per;
    let dx = 0, dy = 0, dw = size, dh = size;
    // clip the source rect to the image (drawImage with an out-of-bounds source is not portable)
    if (sx < 0) { const c = -sx; dx += c / per * k; dw -= c / per * k; sw -= c; sx = 0; }
    if (sy < 0) { const c = -sy; dy += c / per * k; dh -= c / per * k; sh -= c; sy = 0; }
    if (sx + sw > N) { const c = sx + sw - N; dw -= c / per * k; sw -= c; }
    if (sy + sh > N) { const c = sy + sh - N; dh -= c / per * k; sh -= c; }
    ctx.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
    if (sw > 0 && sh > 0) ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
  } else {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(W.map.minimap, 0, 0, size, size);
  }
  // the grid (200 m squares) - local minimap and big map; letters on the big map's edges
  if (local || big) {
    const cell = S / GRID_N;
    ctx.strokeStyle = big ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < GRID_N; i++) {
      const gx = tx(-S / 2 + i * cell), gz = tz(-S / 2 + i * cell);
      if (gx > 0 && gx < size) { ctx.moveTo(gx, 0); ctx.lineTo(gx, size); }
      if (gz > 0 && gz < size) { ctx.moveTo(0, gz); ctx.lineTo(size, gz); }
    }
    ctx.stroke();
    if (big) {
      ctx.font = "800 12px system-ui";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (let i = 0; i < GRID_N; i++) {
        const cxp = tx(-S / 2 + (i + 0.5) * cell), czp = tz(-S / 2 + (i + 0.5) * cell);
        if (cxp > 8 && cxp < size - 8) { ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillText(String.fromCharCode(65 + i), cxp + 1, 11); ctx.fillStyle = "#cfe4ff"; ctx.fillText(String.fromCharCode(65 + i), cxp, 10); }
        if (czp > 8 && czp < size - 8) { ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillText(String(i + 1), 11, czp + 1); ctx.fillStyle = "#cfe4ff"; ctx.fillText(String(i + 1), 10, czp); }
      }
      ctx.textBaseline = "alphabetic";
    }
  }
  // storm circles
  const me = W._camFocus || W.player;
  if (W.stormCtl && W.mode !== "practice") {
    const st = W.stormCtl.storm.stateAt(W.t);
    ctx.strokeStyle = "rgba(190,120,255,0.95)";
    ctx.lineWidth = big ? 3 : 2;
    ctx.beginPath(); ctx.arc(tx(st.center.x), tz(st.center.z), st.radius * k, 0, Math.PI * 2); ctx.stroke();
    if (st.nextRadius != null && st.nextRadius > 0) {
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(tx(st.nextCenter.x), tz(st.nextCenter.z), st.nextRadius * k, 0, Math.PI * 2); ctx.stroke();
    }
    // dark outside veil
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, size, size);
    ctx.arc(tx(st.center.x), tz(st.center.z), st.radius * k, 0, Math.PI * 2, true);
    ctx.fillStyle = "rgba(90,30,140,0.28)";
    ctx.fill();
    ctx.restore();
    // outside the next safe zone: a dashed line from you to its nearest edge (desktop local map + big map)
    const nc = st.nextRadius != null && st.nextRadius > 0 ? st.nextCenter : st.center, nr = st.nextRadius != null && st.nextRadius > 0 ? st.nextRadius : st.radius;
    if (me && me.alive && (local || big) && nc) {
      const ddx = nc.x - me.pos.x, ddz = nc.z - me.pos.z, dd = Math.hypot(ddx, ddz);
      if (dd > nr + 2) {
        const ex = me.pos.x + ddx / dd * (dd - nr), ez = me.pos.z + ddz / dd * (dd - nr);
        ctx.save();
        ctx.setLineDash(big ? [7, 5] : [4, 3]);
        ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = big ? 2 : 1.4;
        ctx.beginPath(); ctx.moveTo(tx(me.pos.x), tz(me.pos.z)); ctx.lineTo(tx(ex), tz(ez)); ctx.stroke();
        ctx.restore();
      }
    }
  }
  // LC-29 HOT ZONE (loot.js W.lootHotZone {x, z, r, name}): the POI whose guns are uplifted most, marked as a dashed ember ring with a
  // faint fill on the big map ("HOT ZONE" under its name) and on the desktop local minimap when it is in the window. Touch keeps its
  // whole-map minimap and big map exactly as they were (owner: phones untouched), so the mark is desktop-only.
  const hz = !touchOn && W.mode !== "practice" ? W.lootHotZone : null;
  if (hz && Number.isFinite(hz.x) && Number.isFinite(hz.z) && hz.r > 0 && (big || local)) {
    const hx = tx(hz.x), hzz = tz(hz.z), hr = Math.max(big ? 10 : 6, hz.r * k);
    if (hx > -hr && hzz > -hr && hx < size + hr && hzz < size + hr) {
      ctx.save();
      ctx.fillStyle = "rgba(255,110,40,0.13)";
      ctx.beginPath(); ctx.arc(hx, hzz, hr, 0, Math.PI * 2); ctx.fill();
      ctx.setLineDash(big ? [9, 6] : [5, 4]);
      ctx.strokeStyle = "rgba(10,6,4,0.7)"; ctx.lineWidth = big ? 4.2 : 3; ctx.stroke();
      ctx.strokeStyle = "#ff8a3d"; ctx.lineWidth = big ? 2.4 : 1.6; ctx.stroke();
      ctx.restore();
      R._hotDrawn = (R._hotDrawn | 0) + 1;      // test surface (readback): the mark was painted
    }
  }
  // supply drops: hollow ring while it falls, filled diamond once it is down (LC-28: every drop, not only the last one)
  const marks = W._supplyMarks && W._supplyMarks.length ? W._supplyMarks : (W._supplyMark ? [W._supplyMark] : null);
  if (marks) for (const sm of marks) {
    if (sm.opened) continue;
    const sx = tx(sm.x), sz = tz(sm.z), r = big ? 9 : 6;
    const pulse = 0.55 + 0.45 * Math.sin(Date.now() / 260);
    ctx.strokeStyle = "rgba(255,209,102," + pulse.toFixed(2) + ")";
    ctx.lineWidth = big ? 2.6 : 1.8;
    ctx.beginPath(); ctx.arc(sx, sz, r, 0, Math.PI * 2); ctx.stroke();
    if (sm.landed) {
      ctx.fillStyle = "rgba(255,209,102,0.9)";
      ctx.beginPath();
      ctx.moveTo(sx, sz - r * 0.6); ctx.lineTo(sx + r * 0.6, sz);
      ctx.lineTo(sx, sz + r * 0.6); ctx.lineTo(sx - r * 0.6, sz);
      ctx.closePath(); ctx.fill();
    }
  }
  // your chosen landing zone, while you are still falling toward it
  if (W.dropTarget && W.phase === "drop" && !(W.player && W.player.onGround)) {   // not after touchdown: phase stays "drop" ~15 s
    const dx = tx(W.dropTarget.x), dz = tz(W.dropTarget.z), s = big ? 13 : 8;
    ctx.strokeStyle = "#6ec4ff"; ctx.lineWidth = big ? 2.2 : 1.5;
    ctx.beginPath(); ctx.arc(dx, dz, big ? 9 : 5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(dx - s, dz); ctx.lineTo(dx + s, dz);
    ctx.moveTo(dx, dz - s); ctx.lineTo(dx, dz + s); ctx.stroke();
  }
  // POI names on the big map (and on the local minimap when the town is in the window)
  if (big || local) {
    ctx.font = big ? "700 13px system-ui" : "700 10px system-ui";
    ctx.textAlign = "center";
    for (const p of W.map.pois) {
      const px = tx(p.x), pz = tz(p.z);
      if (px < -40 || pz < -10 || px > size + 40 || pz > size + 10) continue;
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillText(p.name, px + 1, pz + 1);
      ctx.fillStyle = big ? "#fff" : "rgba(255,255,255,0.82)";
      ctx.fillText(p.name, px, pz);
      if (hz && (hz.id != null ? hz.id === p.id : (p.x === hz.x && p.z === hz.z))) {
        const t2 = big ? "HOT ZONE" : "HOT", dy = big ? 15 : 11;
        ctx.font = big ? "800 11px system-ui" : "800 9px system-ui";
        ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillText(t2, px + 1, pz + dy + 1);
        ctx.fillStyle = "#ffa463"; ctx.fillText(t2, px, pz + dy);
        ctx.font = big ? "700 13px system-ui" : "700 10px system-ui";
      }
    }
  }
  // Squadmates. Online humans (gated on W.net, as before) AND, in Duos / Trios / Squads, bot teammates - each in its own
  // colour (the one on its pings and its vitals chip); a downed mate is a red cross, a dead one is not drawn. Enemies never.
  const mates = matesOf(W, W.player);
  if (W.net || mates.length) {
    const br2 = big ? 6 : 4;
    if (big) { ctx.font = "700 11px system-ui"; ctx.textAlign = "center"; }
    const drawn = new Set();
    const blip = (a, col) => {
      const ax = tx(a.pos.x), az = tz(a.pos.z);
      if (a.downed) {
        const c = (R._cbPal || CB_PAL.off).down, rr = br2 + 1;
        ctx.strokeStyle = "rgba(0,0,0,0.85)"; ctx.lineWidth = 4.2;
        ctx.beginPath(); ctx.moveTo(ax - rr, az); ctx.lineTo(ax + rr, az); ctx.moveTo(ax, az - rr); ctx.lineTo(ax, az + rr); ctx.stroke();
        ctx.strokeStyle = c; ctx.lineWidth = 2.4; ctx.stroke();
      } else {
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(ax, az, br2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.lineWidth = 1; ctx.stroke();
      }
      if (big) { ctx.fillStyle = "#dfeaff"; ctx.fillText(a.name, ax, az - br2 - 3); }
    };
    for (const a of mates) { if (!a.alive || a === me) continue; blip(a, mateColor(a.id)); drawn.add(a); }
    if (W.net) for (const a of W.actors) {
      if (a.isBot || !a.alive || a === W.player || a === me || drawn.has(a)) continue;
      blip(a, "#6ec4ff");
    }
  }
  // LC-07 pings (own, squad's, map pins), under the player arrow
  if (PINGS.list.length || !big) drawPings(W, ctx, size, big, tx, tz);
  // the arrow of the actor you are watching (you, or the player you spectate), with a faint view cone on the local map
  const pa = me && me.alive ? me : W.player;
  if (pa) {
    const px = tx(pa.pos.x), pz = tz(pa.pos.z);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-pa.yaw);
    if (local) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 46);
      g.addColorStop(0, "rgba(255,255,255,0.22)"); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 46, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.5, 5); ctx.lineTo(-4.5, 5); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }
}
/** Big-map view state: zoom about the canvas point (u, v) in 0..1 and keep the window on the map. */
function bigZoom(W, dir, u, v) {
  const S = W.map.size, vw = R._bigView || { cx: 0, cz: 0, span: S, z: 1 };
  const zi = Math.max(0, Math.min(BIG_ZOOMS.length - 1, BIG_ZOOMS.indexOf(vw.z) + dir));
  const z = BIG_ZOOMS[zi];
  if (z === vw.z) return false;
  const wx = vw.cx + (u - 0.5) * vw.span, wz = vw.cz + (v - 0.5) * vw.span;   // the world point under the cursor stays under it
  const span = S / z;
  R._bigView = bigClamp(W, { cx: wx - (u - 0.5) * span, cz: wz - (v - 0.5) * span, span, z });
  return true;
}
function bigClamp(W, vw) {
  const S = W.map.size, hm = (S - vw.span) / 2;
  vw.cx = Math.max(-hm, Math.min(hm, vw.cx)); vw.cz = Math.max(-hm, Math.min(hm, vw.cz));
  return vw;
}

// ═══ events, pause, death, stats, settings ══════════════════════════════════
function wireEvents(W) {
  wireTeamEvents(W);         // C-DBNO knock / revive cues (team modes only fire these)
  // C-FALL: a hard landing's damage gets its own cue - a red down-chevron under the reticle on the indicator ring, the hurt
  // flash, and a "FALL" line in the death recap (it has no attacker, so the damage-direction arc never showed it).
  W.events.on("fallDamage", (a, dmg, v) => {
    if (a && typeof a === "object" && a.actor && dmg == null) { dmg = a.dmg; a = a.actor; }
    if (!W.player || a !== W.player || !(+dmg > 0) || !R.hud) return;
    // a point BEHIND the player: the ring's bottom, under the reticle (forward is (-sin yaw, -cos yaw), see stepIndicators)
    addIndicator(W, W.player.pos.x + Math.sin(W.player.yaw) * 5, W.player.pos.z + Math.cos(W.player.yaw) * 5, "fall");
    if (R.hurtTint) {
      R.hurtTint.style.transition = "opacity .07s ease-out";
      const hk = (W.settings && W.settings.flashReduce && !touchOn) ? 0.35 : 1;
      R.hurtTint.style.opacity = String(hk * Math.max(0.35, Math.min(1, +dmg / 60)));
    }
    pickupMsg("FALL DAMAGE  −" + Math.round(+dmg), (R._cbPal || CB_PAL.off).dmg);   // damage colour, not the pickup mint
    const L2 = R.dmgLog || (R.dmgLog = []);
    const last = L2[L2.length - 1];
    if (last && last.t === W.t && (last.src === "world" || last.src === "fall") && Math.abs(last.dmg - +dmg) < 0.6) last.src = "fall";
    else { L2.push({ t: W.t, src: "fall", w: null, dmg: +dmg, head: false }); R._fallT = W.t; R._fallDmg = +dmg; }
  });
  // LC-19: W.stats (ffg_royale3d.js) declared heads / chests / heals / stormDmg / legendaries / longestKillM for objectives and read-outs, and
  // nothing ever incremented them. Each is one line on an event that already fires for the local player.
  const st = () => W.stats;
  W.events.on("hitMarker", (owner, target, dmg, isHead) => { if (isHead && owner && owner === W.player && st()) st().heads = (st().heads || 0) + 1; });
  W.events.on("hitMarker", (owner) => { if (R._guide && owner && owner === W.player) { R._guide.hitAny = true; if (W.player.input && W.player.input.ads) R._guide.adsHit = true; } });
  W.events.on("chestOpened", (a) => { if (a && a === W.player && st()) st().chests = (st().chests || 0) + 1; });
  W.events.on("healed", (a) => { if (a && a === W.player && st()) st().heals = (st().heals || 0) + 1; });
  W.events.on("stormTick", (dmg) => { if (st() && +dmg > 0) st().stormDmg = Math.round(((st().stormDmg || 0) + +dmg) * 10) / 10; });
  W.events.on("pickedUp", (a, data) => { if (a && a === W.player && data && data.kind === "weapon" && (data.rarity | 0) >= 4 && st()) st().legendaries = (st().legendaries || 0) + 1; });
  W.events.on("actorDied", (victim, killerId) => {
    if (!st() || !W.player || !victim || victim === W.player || killerId !== W.player.id) return;
    const d = Math.round(Math.hypot(victim.pos.x - W.player.pos.x, victim.pos.y - W.player.pos.y, victim.pos.z - W.player.pos.z));
    if (d > (st().longestKillM || 0)) st().longestKillM = d;
  });
  W.events.on("hitMarker", (owner, target, dmg, isHead) => {
    if (owner !== W.player || !R.hitmark || !R.hitTicks) return;
    // KILL LATCH: weapons.js emits actorDied for the killing round BEFORE this
    // event (weapons.js:724 hurtActor -> actorDied, :728 hitMarker), and a
    // shotgun's later pellets / an SMG's next rounds follow. None of them may
    // downgrade the kill confirm inside KILL_LATCH.
    if (MK.latch > 0) { MK.blocked++; mkLog("blocked", isHead ? "head" : "body"); return; }
    let style = isHead ? "head" : "body";
    if (!isHead) {
      // shield vs body from the actorHurt that fired for THIS round (same call
      // chain, just before). A remote target has no local actorHurt: read its
      // replicated shield instead.
      const hu = MK.hurt;
      if (hu && hu.victim === target) style = hu.toShield > 0 && hu.toShield >= hu.dmg * 0.5 ? "shield" : "body";
      else if (target && target.shield > 0) style = "shield";
    }
    MK.hurt = null;
    // A shotgun blast fires this once per pellet in one frame; a body pellet
    // landing after a head pellet used to overwrite the marker back to plain
    // white, so headshots inside a blast were invisible. Never downgrade a
    // marker that is still inside its hold.
    if (MK.style && MK.t < MK_TIERS[MK.style].hold && MK_TIERS[MK.style].rank > MK_TIERS[style].rank) return;
    mkShow(style);
  });
  // gunfire direction (industry-standard ~250m audible range)
  W.events.on("shotFired", (shooter, weaponId, eye) => {
    if (!W.player || shooter === W.player || !W.player.alive) return;
    const d = Math.hypot(eye.x - W.player.pos.x, eye.z - W.player.pos.z);
    if (d < 12 || d > 250) return;   // too close = obvious; too far = inaudible
    addIndicator(W, eye.x, eye.z, "shot");
  });
  // damage direction (red arc toward the attacker)
  W.events.on("actorHurt", (victim, info) => {
    // Flash the vignette HERE, before the attackerId guard, so a storm tick
    // registers too. The per-frame HUD block only clears it now.
    if (victim === W.player && R.hurtTint) {
      R.hurtTint.style.transition = "opacity .07s ease-out";
      // Binary before: a 5-damage graze and a 105-damage sniper body shot drew
      // the identical screen. info.dmg is the APPLIED amount (player.js:1155
      // passes res.dealt), so it is the right number to read.
      const hk = (W.settings && W.settings.flashReduce && !touchOn) ? 0.35 : 1;   // LC-43 flash reduction
      R.hurtTint.style.opacity = String(hk * Math.max(0.3, Math.min(1, (info.dmg || 0) / 60)));
    }
    // YOUR hit: remember which layer it landed on for the hitMarker that
    // follows in the same call chain, and give the breaking hit its ring
    if (W.player && info.attackerId === W.player.id && victim !== W.player && R.hitmark) {
      MK.hurt = { victim, toShield: info.toShield || 0, dmg: info.dmg || 0 };
      if (info.broke) { MK.breakT = 0; MK.breaks++; mkLog("break", "shield"); mkPaint(); }
    }
    if (victim !== W.player || !info.attackerId) return;
    const att = W.actorById.get(info.attackerId);
    if (att) addIndicator(W, att.pos.x, att.pos.z, "damage");
  });
  // LC-81 DAMAGE LOG: every hit the local player takes (attacker, weapon, amount, headshot) and every storm tick, on the match clock, so the
  // death banner can say who did what in the last 10 s - it only ever named the killer.
  W.events.on("actorHurt", (victim, info) => {
    if (!W.player || victim !== W.player || !info || !(info.dmg > 0)) return;
    const L2 = R.dmgLog || (R.dmgLog = []);
    // C-FALL: the fall's own hurt (no attacker) is already logged by the fallDamage cue of this tick
    const fall = !info.attackerId && (info.weaponId === "fall" || info.cause === "fall" || (R._fallT === W.t && Math.abs((R._fallDmg || 0) - info.dmg) < 0.6));
    if (fall && R._fallT === W.t) return;
    L2.push({ t: W.t, src: fall ? "fall" : (info.attackerId || "world"), w: fall ? null : (info.weaponId || null), dmg: info.dmg, head: !!info.isHead });
    if (L2.length > 96) L2.splice(0, L2.length - 96);
  });
  W.events.on("stormTick", (dmg) => {
    if (!W.player || !(+dmg > 0)) return;
    const L2 = R.dmgLog || (R.dmgLog = []);
    L2.push({ t: W.t, src: "storm", w: "storm", dmg: +dmg, head: false });
    if (L2.length > 96) L2.splice(0, L2.length - 96);
  });
  // (release blockers, OD-8) the cause of a knock, per actor: a fall-knocked player who bleeds out with nobody to credit died of the FALL
  W.events.on("actorDowned", (v, attackerId, weaponId) => { if (v) (R.knockCause || (R.knockCause = new Map())).set(v.id, weaponId || null); });
  W.events.on("actorRevived", (v) => { if (v && R.knockCause) R.knockCause.delete(v.id); });
  W.events.on("actorDied", (victim, killerId, weaponId) => {
    // The killing blow looked identical to chipping someone for 13 — the same
    // white marker. Kill style = red ticks + ring, held, and LATCHED so the
    // hitMarker that weapons.js emits right after this for the same round
    // cannot overwrite it (the bug that kept it from ever painting).
    if (R.hitmark && R.hitTicks && W.player && killerId === W.player.id && victim !== W.player) {
      MK.latch = KILL_LATCH;
      MK.hurt = null;
      mkShow("kill");
    }
    if (!R.feed) return;
    const killer = killerId ? W.actorById.get(killerId) : null;
    feedRow(killer ? killer.name : null, victim.name, weaponId, victim === W.player || killer === W.player, deathCause(victim, killer, weaponId) === "fall");
    if (R.knockCause) R.knockCause.delete(victim.id);
    // YOUR elimination gets a banner + streak escalation (kills used to land silently)
    if (killer === W.player && victim !== W.player) {
      // Bank the elimination's XP NOW. The kills/damage/placement/victory/time
      // formula runs once, inside showPostMatch, so closing the tab at 11:00 of a
      // 12:55 match lost everything except challenge XP. Challenge XP already
      // flows live through this same addXP (which persists on every award), so
      // the incremental pattern is proven here — it was just never used for
      // kills. showPostMatch subtracts W._elimXp so nothing double-counts.
      W._elimXp = (W._elimXp || 0) + 100;
      addXP(W, 100);
      const n = (W.match && W.match.kills[W.player.id]) || 0;
      const streak = n >= 5 ? "RAMPAGE" : n === 4 ? "QUAD KILL" : n === 3 ? "TRIPLE KILL" : n === 2 ? "DOUBLE KILL" : null;
      announce("ELIMINATED " + victim.name.toUpperCase(), streak ? streak + " · " + n + " KILLS" : n + (n === 1 ? " KILL" : " KILLS"), "#ff8f6a", 1900, ANN_PRIO.elim);
    }
  });
  // LEVEL UP — this event was emitted every level and had ZERO listeners, so the
  // bar filled, the level ticked over, and the player was never told.
  W.events.on("levelUp", (lvl) => {
    const won = MENU_SKINS.some((s) => s.unlockLevel === lvl);
    announce("LEVEL " + lvl, levelUpSub(lvl, W.progress && W.progress.career), "#ffd54a", won ? 3600 : 3000, ANN_PRIO.level);
    // Exactly levels 3, 6 and 10 — no new detection logic. LIVE since
    // 2026-07-28: W.hooks.achievement posts to the portal bridge
    // (ffg_royale3d.js) and the registry holds the seeded rows.
    if (won && W.hooks && W.hooks.achievement) W.hooks.achievement("skin_level_" + lvl);
  });
  // Picking something up was silent apart from a blip — you could not tell a
  // legendary from a common without opening the inventory.
  W.events.on("pickedUp", (a, data) => {
    if (a !== W.player || !data) return;
    const RAR = K.RARITY || [];
    if (data.kind === "weapon") {
      const rar = RAR[data.rarity || 0] || "";
      pickupMsg("PICKED UP  " + rar.toUpperCase() + " " + String(data.id).toUpperCase());
    } else if (data.kind === "consumable") {
      pickupMsg("PICKED UP  " + (CON_NAME[data.id] || String(data.id).replace(/_/g, " ").toUpperCase()) + (data.count > 1 ? " x" + data.count : ""));
    } else if (data.kind === "ammo") {
      pickupMsg("PICKED UP  " + String(data.id).toUpperCase() + " AMMO");
    }
  });
  // host gone (tab closed, crash, dead socket): net.js converts the match to a
  // local continuation — the announcement is the difference between "the game
  // broke" and "the host left, keep playing"
  W.events.on("hostLost", (converted) => {
    const sub = "MATCH CONTINUES OFFLINE — " + converted + " PLAYERS NOW BOT-CONTROLLED";
    // A DEAD player (spectating) never saw this: announce() drops everything below victory priority while the death banner owns the band
    // (parity audit: guest spectating, host left, no banner). The news still matters to them - the match they watch just changed hands - so it
    // goes on the line under the death banner (flashMsg, held longer) and into the chat log, where it stays readable.
    if (R.deathBox) {
      flashMsg("HOST LEFT — MATCH CONTINUES OFFLINE", 6000);
      if (W.pushChat) W.pushChat("SQUAD", "The host left. " + sub.charAt(0) + sub.slice(1).toLowerCase() + ".", false);
      R._hostLeftShown = "death";
    } else {
      announce("HOST LEFT", sub, "#ffb36a", 4200, ANN_PRIO.elim);
      R._hostLeftShown = "band";
    }
  });
  W.events.on("stormWarning", () => flashMsg("STORM SHRINKS IN 10 SECONDS"));
  W.events.on("stormClosing", () => flashMsg("THE STORM IS CLOSING"));
  W.events.on("playerStormState", (inStorm) => { R._inStorm = !!inStorm; if (R.stormTint) R.stormTint.style.opacity = inStorm ? "1" : "0"; });
  W.events.on("scopeState", (on) => { if (R.scope) R.scope.style.display = on ? "block" : "none"; });
  // breath gauge follows W._breathT/W._winded (weapons.js sway block) while
  // the scope overlay is up — driven here rather than in update() so it costs
  // nothing when unscoped
  W.kernel.onUpdate(() => {
    if (!R.breathFill || !R.scope || R.scope.style.display === "none") return;
    const t = W._breathT == null ? 5 : W._breathT;
    R.breathFill.style.height = Math.round((t / 5) * 100) + "%";
    R.breathFill.style.background = W._winded ? "#ff6a6a" : "#7fd8ff";
  });
  W.events.on("toggleBigMap", () => toggleBigMap(W));
  W.events.on("escPressed", () => {
    if (R.settings) { closeSettings(W); return; }   // close the topmost modal first
    if (R.bigmap) { toggleBigMap(W); return; }
    if (W.phase === "match" || W.phase === "drop") togglePause(W);
  });
  W.events.on("playerDied", (killerId, weaponId) => showDeath(W, killerId, weaponId));
  // Supply drops are the ONLY source of legendary loot and had no marker, no
  // beacon and no landed cue — a message flashed once and then the single most
  // valuable event in the match was invisible. Track it and draw it.
  // LC-28: up to 3-4 drops a match now (loot lane), each tracked by its own mark (W._supplyMarks; W._supplyMark stays the
  // latest, for older readers). BANNER ORDER: the INBOUND banner could still be queued (or showing) when the drop landed, so
  // a landed crate was announced as inbound afterwards - a landing now drops any queued INBOUND banner for it and, if the
  // INBOUND one is still up, replaces it with LANDED. An opened crate (supplyDropOpened, when the loot lane emits it) loses
  // its marker.
  const supplyMark = (p2, landed) => {
    const L2 = W._supplyMarks || (W._supplyMarks = []);
    const id = p2 && p2.id != null ? p2.id : null;
    let m = id != null ? L2.find((q) => q.id === id) : null;
    if (!m && landed) {
      // a landing without an id: the nearest mark still falling (a crate drifts a few metres from its spawn column)
      let bd = 1e9;
      for (const q of L2) { if (q.landed) continue; const d = Math.hypot(q.x - p2.x, q.z - p2.z); if (d < bd) { bd = d; m = q; } }
      if (bd > 120) m = null;
    }
    if (!m) { m = { id, x: p2.x, z: p2.z, landed: false, opened: false, t: 0 }; L2.push(m); if (L2.length > 8) L2.shift(); }
    m.x = p2.x; m.z = p2.z;
    if (landed) m.landed = true;
    W._supplyMark = m;
    mmT = 1;
    return m;
  };
  W.events.on("supplyDropSpawned", (p2) => {
    if (!p2) return;
    supplyMark(p2, false);
    flashMsg("SUPPLY DROP INBOUND");
    announce("SUPPLY DROP", "LEGENDARY LOOT INBOUND — CHECK YOUR MAP", "#ffd166", 2400, ANN_PRIO.milestone);
    hintFire(W, "supply");
  });
  W.events.on("supplyDropLanded", (p2) => {
    if (!p2) return;
    supplyMark(p2, true);
    if (R._annQ) R._annQ = R._annQ.filter((q) => q.text !== "SUPPLY DROP");
    if (R.annTitle && R.annTitle.textContent === "SUPPLY DROP" && performance.now() < (R._annUntil || 0)) {
      R.annSub.textContent = "THE CRATE HAS LANDED — IT IS ON YOUR MAP";
    }
    flashMsg("SUPPLY DROP HAS LANDED");
  });
  // D6: loot emits ("supplyDropOpened", actor, rec) with rec = { id, x, z, n } (actor null when nobody opened it in person). The
  // first argument used to be read as the record: its id never matched an "sd<n>" mark and an actor has no .x, so opened crates
  // stayed marked. A lone record (an older emitter) is still accepted.
  W.events.on("supplyDropOpened", (a, rec) => {
    const p2 = rec && (rec.id != null || rec.x != null) ? rec : (a && a.id != null && !a.pos ? a : null);
    const L2 = W._supplyMarks; if (!L2 || !p2) return;
    let m = p2.id != null ? L2.find((q) => q.id === p2.id) : null;
    if (!m && Number.isFinite(p2.x) && Number.isFinite(p2.z)) { let bd = 30; for (const q of L2) { const d = Math.hypot(q.x - p2.x, q.z - p2.z); if (d < bd) { bd = d; m = q; } } }
    if (m) { m.opened = true; mmT = 1; }
  });
}

// KILL FEED: six pooled rows per HUD (feel G11 / VERIFY 18). Every death used
// to createElement a row and setTimeout-remove it 6 s later — DOM churn in
// exactly the frames a firefight is busiest. The oldest row is recycled and
// moved to the bottom; rows past their 6 s expire in update()'s 4 Hz block
// (display:none, kept for reuse). Hidden rows are always the oldest, so they
// sit first and the phone rule "last two rows only" still counts right.
const FEED_N = 6, FEED_MS = 6000;
function mkFeedRow() {
  const el = h("div", null, null, R.feed);
  el.className = "lc-fr";
  el._k = h("span", null, "", el);                                   // killer
  el._w = h("img", null, null, el); el._w.className = "w"; el._w.alt = "";   // weapon silhouette (C-ART-FX)
  el._x = h("span", null, "", el); el._x.className = "dim";          // text fallback: the arrow
  el._v = h("span", null, "", el); el._v.className = "v";            // victim (red, as in ref t68)
  el._t = h("span", null, "", el); el._t.className = "dim";          // text fallback: the weapon's name
  el._wid = null; el._wn = "";
  return el;
}
/** killer [silhouette] victim - or "killer > victim . Weapon name" until / unless
 *  the silhouette exists. Written on row reuse and when a silhouette finishes loading. */
function feedMode(el) {
  if (el._fell) { el._w.style.display = "none"; el._x.textContent = ""; el._t.textContent = "fell"; return; }      // "<name> fell" (OD-8)
  const u = el._wid ? silFor(_tW, el._wid) : null;
  if (u) {
    if (el._w.src !== u) el._w.src = u;
    el._w.style.display = "block"; el._x.textContent = ""; el._t.textContent = "";
  } else {
    el._w.style.display = "none"; el._x.textContent = "›"; el._t.textContent = el._wn ? "·  " + el._wn : "";
  }
}
function feedRow(killerName, victimName, weaponId, mine, fell) {
  if (!R.feed) return;
  const kids = R.feed.children;
  const el = kids.length < FEED_N ? mkFeedRow() : kids[0];
  // (release blockers, OD-8) a death nobody is credited with is the storm's - unless it was a FALL: "<name> fell", the victim alone
  el._fell = !!fell;
  el._k.textContent = fell ? "" : (killerName || "the Storm");
  el._k.style.display = fell ? "none" : "";
  el._x.style.display = fell ? "none" : "";
  el._v.textContent = victimName;
  el._wid = !fell && killerName && weaponId ? weaponId : null;     // the storm (and a fall) has no silhouette
  el._wn = el._wid ? K.weaponName(el._wid) : "";
  el.className = mine ? "lc-fr me" : "lc-fr";
  feedMode(el);
  if (el.style.display === "none") el.style.display = "";
  el._exp = performance.now() + FEED_MS;
  if (el !== R.feed.lastChild) R.feed.appendChild(el);
}
/** (release blockers, OD-8) What ended a life nobody is credited with: "fall" when the killing blow was a fall (player.js kills with the
 *  weapon id "fall"), or when a fall-knocked player bled out; else "storm" - the card and the feed read every killer-less death as the
 *  storm, so a fall death said THE STORM GOT YOU. A credited death returns null (the killer is named, as before). */
function deathCause(victim, killer, weaponId) {
  if (killer) return null;
  if (weaponId === "fall") return "fall";
  if (weaponId === "bleed" && victim && R.knockCause && R.knockCause.get(victim.id) === "fall") return "fall";
  return "storm";
}
function expireFeed(now) {
  if (!R.feed) return;
  const kids = R.feed.children;
  for (let i = 0; i < kids.length; i++) {
    const el = kids[i];
    if (el._exp && now > el._exp) { el._exp = 0; el.style.display = "none"; }
  }
}

function flashMsg(text, ms) {
  if (!R.stormMsg) return;
  R.stormMsg.textContent = text;
  R.stormMsg.style.opacity = "1";
  clearTimeout(R._stormMsgT);
  R._stormMsgT = setTimeout(() => { if (R.stormMsg) R.stormMsg.style.opacity = "0"; }, ms || 2600);
}
function pickupMsg(text, color) {
  if (!R.pickupMsg) return;
  R.pickupMsg.textContent = text;
  R.pickupMsg.style.color = color || "#bfe9d2";       // the pickup mint; a damage line (fall) passes its own colour
  R.pickupMsg.style.opacity = "1";
  clearTimeout(R._pickupMsgT);
  R._pickupMsgT = setTimeout(() => { if (R.pickupMsg) R.pickupMsg.style.opacity = "0"; }, 1800);
}
// big centre-screen announcement (deploy / milestones / eliminations / level-up).
// Higher-priority calls override a showing one so the important beat always wins.
// PRIO: victory 3 > elimination / level-up 2 > milestone / deploy 1.
// This was last-write-wins over one node and one timer (R._annUntil was assigned
// and never read). Because match.eliminate() drops the alive count BEFORE the
// actorDied emit, and weapons.update runs before hud.update in the same frame,
// the "ELIMINATED X" banner for the kill that took the lobby to 10 was
// overwritten by "10 REMAIN" before the browser ever painted it — the kill you
// just made was the one beat you never saw.
// Equal-or-lower priority QUEUES rather than dropping: the alive milestone marks
// itself spent (R._aliveMark) before it announces, so a dropped "FINAL 2" is
// gone for the rest of the match.
const ANN_PRIO = { victory: 3, elim: 2, level: 2, milestone: 1, deploy: 1 };
function announce(text, sub, color, ms, prio) {
  if (!R.annWrap) return;
  const p = prio || 0;
  // a dead player's top banner owns the band's spot: milestone / level cues are not
  // theirs to act on (the storm row already carries the alive count), so they are
  // dropped rather than painted over the banner
  if (R.deathBox && p < ANN_PRIO.victory) return;
  const now = performance.now();
  if (now < (R._annUntil || 0)) {
    if (p > (R._annPrio || 0)) { showAnnouncement(text, sub, color, ms, p, now); return; }
    (R._annQ = R._annQ || []).push({ text, sub, color, ms, prio: p });
    if (R._annQ.length > 6) R._annQ.length = 6;   // a 50-kill spree must not queue forever
    return;
  }
  showAnnouncement(text, sub, color, ms, p, now);
}
function showAnnouncement(text, sub, color, ms, p, now) {
  const dur = ms || 2200;
  placeBand();
  R.annTitle.textContent = text;
  R.annTitle.style.color = color || "#eaf2ff";
  R.annSub.textContent = sub || "";
  R.annWrap.style.opacity = "1";
  R.annWrap.style.transform = "translateX(-50%) translateY(0)";
  R._annPrio = p;
  R._annUntil = now + dur;
  clearTimeout(R._annT);
  R._annT = setTimeout(() => {
    if (!R.annWrap) return;
    R.annWrap.style.opacity = "0";
    // a SHORT upward drift: the band sits 12 px under the quest card, and a
    // -12 px exit slid the fading title right back onto it
    R.annWrap.style.transform = "translateX(-50%) translateY(-6px)";
    R._annPrio = 0; R._annUntil = 0;
    const q = R._annQ && R._annQ.shift();
    if (q) setTimeout(() => announce(q.text, q.sub, q.color, q.ms, q.prio), 200);
  }, dur);
}

/** The big map gave the mouse back on open (pin clicks); CLOSING it (M, Esc, a click beside the map, the Pause button) takes it back, so
 *  mouse-look works again at once, as it did before the map released the lock. The release was our own exitPointerLock(), so the browser lets
 *  the page re-lock from this gesture (a key press included); when it refuses anyway (lock denied, focus elsewhere) "CLICK TO LOOK AROUND"
 *  shows at once and the next click re-grabs without firing (releaseCursor's _suppressNextShot stays armed). A successful re-lock disarms
 *  that flag, or the player's first real shot after the map would be swallowed. Mouse only: touch has no pointer lock. */
function regrabCursor(W) {
  if (touchOn || !W || !W.player || !W.player.alive || W.paused || (W.phase !== "match" && W.phase !== "drop")) return;
  if (R.pause || R.settings || R.post || R.death || R.howto || R.career) return;
  const dom = W.kernel && W.kernel.renderer && W.kernel.renderer.domElement;
  if (!dom || !dom.requestPointerLock || document.pointerLockElement === dom) return;
  let done = false;
  const fin = (ok) => {
    if (done) return;
    done = true;
    document.removeEventListener("pointerlockchange", onChange);
    document.removeEventListener("pointerlockerror", onErr);
    if (ok) W._suppressNextShot = false;
    else if (R.lookHint && W.player && W.player.alive) R.lookHint.style.display = "block";
    W._mapRegrab = ok ? "locked" : "hint";        // test surface (read-only by probes)
  };
  const onChange = () => { if (document.pointerLockElement === dom) fin(true); };
  const onErr = () => fin(false);
  document.addEventListener("pointerlockchange", onChange);
  document.addEventListener("pointerlockerror", onErr);
  W._mapRegrab = "asked";
  try { const pr = dom.requestPointerLock(); if (pr && pr.catch) pr.catch(onErr); } catch (e) { onErr(); }
}

function toggleBigMap(W) {
  if (R.bigmap) { R.bigmap.remove(); R.bigmap = null; if (R._bigIv) { clearInterval(R._bigIv); R._bigIv = null; } regrabCursor(W); return; }
  const L = layer("bigmap", { pointerEvents: "auto", background: "rgba(4,8,16,0.9)", display: "flex", alignItems: "center", justifyContent: "center" });
  const size = Math.min(window.innerHeight - (touchOn ? 116 : 100), 640);
  const cv = h("canvas", { borderRadius: "14px", border: "2px solid rgba(120,180,255,0.35)", width: size + "px", height: size + "px" }, null, L);
  cv.width = cv.height = Math.round(size * HUD_DPR);
  // every opening starts on the whole map (zoom x1), as it always did; zoom / pan live until it closes
  R._bigView = W.map ? { cx: 0, cz: 0, span: W.map.size, z: 1 } : null;
  const redraw = () => drawMinimap(W, cv.getContext("2d"), size, true);
  redraw();
  // This overlay is a 90%-opaque full-screen fill over the whole HUD layer, so the storm countdown, the alive count and
  // your HP are repeated on top of it (the sim does not pause).
  const head = h("div", {
    position: "absolute", top: "18px", left: "50%", transform: "translateX(-50%)",
    padding: "8px 22px", borderRadius: "10px", whiteSpace: "nowrap",
    background: "rgba(4,10,20,0.6)", border: "1px solid rgba(140,200,255,0.25)",
    fontFamily: "Rajdhani, " + FONT, fontSize: "15px", fontWeight: "700", letterSpacing: "1.5px",
  }, "", L);
  const paintHead = () => {
    const bits = [];
    if (W.stormCtl && W.mode !== "practice") {
      const st = W.stormCtl.storm.stateAt(W.t);
      bits.push("STORM " + (st.done ? "CLOSED" : (st.phaseState === "waiting" ? "SHRINKS " : "CLOSING ") + fmtT(st.tToNext)));
    }
    if (W.match) bits.push(W.match.aliveCount() + " ALIVE");
    if (W.player) bits.push("HP " + Math.max(0, Math.ceil(W.player.hp)) + "  SHIELD " + Math.max(0, Math.ceil(W.player.shield)));
    // LC-24: the grid square you are in (A-H / 1-8), the way squads call positions
    if (W.player && W.map) {
      const S = W.map.size, gi = Math.floor((W.player.pos.x / S + 0.5) * GRID_N), gj = Math.floor((W.player.pos.z / S + 0.5) * GRID_N);
      if (gi >= 0 && gi < GRID_N && gj >= 0 && gj < GRID_N) bits.push("YOU " + String.fromCharCode(65 + gi) + (gj + 1));
    }
    if (R._bigView && R._bigView.z > 1) bits.push("ZOOM x" + R._bigView.z);
    head.textContent = bits.join("   ·   ");
  };
  paintHead();
  h("div", { position: "absolute", bottom: "26px", fontSize: "13px", opacity: "0.7" }, "CLICK TO DROP A PIN  ·  RIGHT-CLICK TO CLEAR IT  ·  WHEEL OR + / − TO ZOOM  ·  DRAG TO PAN  ·  M / ESC TO CLOSE", L).className = "kbd-hint";
  h("div", { position: "absolute", bottom: "26px", fontSize: "13px", opacity: "0.8" }, "TAP ANYWHERE TO CLOSE", L).className = "lc-touch-only";
  // A touch tap that opened the map is followed by the browser's synthesized click on whatever is under the finger - now
  // this layer. hudTapUp cancels that click at its touchend; this guard is the backstop.
  const openedAt = performance.now();
  // LC-07 MAP PIN + LC-24 ZOOM / PAN (mouse only; touch keeps "tap anywhere to close"). With the pointer locked every click
  // went to the game canvas behind the map, so the mouse is released while the map is up (releaseCursor also stops the
  // click that re-grabs it from firing a shot). A click ON the map (no drag) drops this player's pin there and the map
  // stays open; a right-click clears the pin; a drag pans a zoomed map; the wheel (or + / -) zooms about the cursor; a
  // click beside the map closes it. However the map closes (M, Esc, that click), regrabCursor takes the mouse back.
  let onKey = null;
  if (!touchOn) {
    releaseCursor(W);
    cv.style.cursor = "crosshair";
    cv.dataset.lc = "bigmapcanvas";
    let drag = null;
    const uv = (e) => { const rc = cv.getBoundingClientRect(); return [(e.clientX - rc.left) / rc.width, (e.clientY - rc.top) / rc.height]; };
    cv.addEventListener("mousedown", (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      e.stopPropagation(); e.preventDefault();
      if (e.button === 2) {
        if (W.player && W.player.alive && (W.phase === "match" || W.phase === "drop")) { clearPing(W, W.player.id, "m", true); redraw(); }
        return;
      }
      const [u, v] = uv(e);
      drag = { x: e.clientX, y: e.clientY, u, v, moved: false, cx: R._bigView ? R._bigView.cx : 0, cz: R._bigView ? R._bigView.cz : 0 };
    });
    const onMove = (e) => {
      if (!drag || !R.bigmap) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      const vw = R._bigView;
      if (!vw || vw.z <= 1) return;                           // the whole map does not pan
      const rc = cv.getBoundingClientRect(), mpp = vw.span / rc.width;
      vw.cx = drag.cx - dx * mpp; vw.cz = drag.cz - dy * mpp;
      bigClamp(W, vw);
      cv.style.cursor = "grabbing";
      redraw();
    };
    const onUp = (e) => {
      if (!drag) return;
      const d = drag; drag = null;
      cv.style.cursor = "crosshair";
      if (d.moved) R._bigDragT = performance.now();           // the click that ends a drag must not close the map
      if (d.moved || !R.bigmap) return;
      if (!W.player || !W.player.alive || (W.phase !== "match" && W.phase !== "drop") || !W.map) return;
      const vw = R._bigView || { cx: 0, cz: 0, span: W.map.size };
      placeMapPin(W, vw.cx + (d.u - 0.5) * vw.span, vw.cz + (d.v - 0.5) * vw.span);
      redraw();
    };
    L.addEventListener("mousemove", onMove);
    L.addEventListener("mouseup", onUp);
    cv.addEventListener("wheel", (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!W.map) return;
      const [u, v] = uv(e);
      if (bigZoom(W, e.deltaY < 0 ? 1 : -1, u, v)) { redraw(); paintHead(); }
    }, { passive: false });
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    onKey = (e) => {
      if (!R.bigmap) { window.removeEventListener("keydown", onKey, true); return; }
      const k = e.key;
      if (k === "+" || k === "=" || k === "-" || k === "_" || e.code === "NumpadAdd" || e.code === "NumpadSubtract") {
        const dir = (k === "+" || k === "=" || e.code === "NumpadAdd") ? 1 : -1;
        const vw = R._bigView;
        // keys zoom about the player while the map is whole, else about the window's centre
        let u = 0.5, v = 0.5;
        if (vw && vw.z === 1 && dir > 0 && W.player && W.map) { u = W.player.pos.x / W.map.size + 0.5; v = W.player.pos.z / W.map.size + 0.5; }
        if (bigZoom(W, dir, u, v)) { redraw(); paintHead(); }
        e.preventDefault(); e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
  }
  L.onclick = (e) => {
    if (!touchOn && e && e.target === cv) return;              // a pin click / drag, handled on mousedown / mouseup above
    if (performance.now() - (R._bigDragT || 0) < 300) return;
    if (performance.now() - openedAt > 250) toggleBigMap(W);
  };
  if (R._bigIv) clearInterval(R._bigIv);
  R._bigIv = setInterval(() => {
    if (R.bigmap) { redraw(); paintHead(); }
    else { clearInterval(R._bigIv); R._bigIv = null; if (onKey) window.removeEventListener("keydown", onKey, true); }
  }, 400);
}

/** window.__PAUSE__ is read in three places in game_controls.js (:199 the Pause
 *  button, :229-230 the auto-pause when the player leaves fullscreen) and was
 *  never assigned anywhere in the game, so the always-visible Pause button was
 *  inert on every screen and ESC-out-of-fullscreen mid-firefight left the player
 *  standing in the open. This is the single entry point the shell bridge binds
 *  to; it mirrors the escPressed handler above so the key, the button and the
 *  fullscreen hook can never diverge. forceOn only ever OPENS: the fullscreen
 *  hook must not un-pause a player who paused deliberately a moment earlier. */
export function requestPause(W, forceOn) {
  if (R.settings) { if (!forceOn) closeSettings(W); return; }   // topmost modal first
  if (R.bigmap) { if (!forceOn) toggleBigMap(W); return; }
  if (W.phase !== "match" && W.phase !== "drop") return;
  if (forceOn && R.pause) return;
  togglePause(W);
}

function togglePause(W) {
  // ONLINE: never freeze the sim. W.paused early-returns the whole frame pipeline,
  // which also skips netMod.update — the 12Hz state broadcast stops and the host's
  // silent-guest watchdog swaps you for a bot after 12s, i.e. opening the menu used
  // to EJECT you from a match with friends. Online shows a non-blocking overlay.
  const online = !!W.net;
  if (R.pause) { R.pause.remove(); R.pause = null; if (!online) W.paused = false; return; }
  if (!online) W.paused = true;
  document.exitPointerLock && document.exitPointerLock();
  const L = layer("pause", { pointerEvents: "auto", background: "rgba(4,8,16,0.82)", display: "flex", alignItems: "center", justifyContent: "center" });
  const box = h("div", Object.assign({ padding: "34px 44px", textAlign: "center", display: "flex", flexDirection: "column", gap: "14px", minWidth: "300px" }, PANEL), null, L);
  h("div", { fontSize: "26px", fontWeight: "900", letterSpacing: "2px" }, "PAUSED", box);
  const resume = h("button", Object.assign({}, BTN, { background: "#57b0ff", color: "#fff" }), "RESUME", box);
  resume.onclick = () => togglePause(W);
  const st = h("button", Object.assign({}, BTN, { background: "rgba(255,255,255,0.1)", color: "#cfe4ff" }), "SETTINGS", box);
  st.onclick = () => showSettings(W);
  const quit = h("button", Object.assign({}, BTN, { background: "rgba(255,80,80,0.2)", color: "#ff9f9f" }), "QUIT TO MENU", box);
  quit.dataset.lc = "quit";
  // LC-44: QUIT TO MENU ended the match on ONE click (no confirmation) - one stray click mid-fight and the match was gone. It now asks first,
  // in the same card: LEAVE MATCH ends it exactly as before, STAY goes back to the pause card. (Leaving while alive counts as an elimination:
  // the placement is recorded by the orchestrator's endMatch.)
  quit.onclick = () => {
    clear(box);
    h("div", { fontSize: "22px", fontWeight: "900", letterSpacing: "2px" }, "LEAVE THE MATCH?", box);
    const alive = !!(W.player && W.player.alive) && W.phase !== "over";
    h("div", { fontSize: "13px", opacity: "0.8", lineHeight: "1.5", maxWidth: "300px", alignSelf: "center", fontFamily: "Rajdhani, " + FONT },
      alive ? "You are still in it. Leaving now counts as being eliminated." : "You will go back to the main menu.", box);
    const yes = h("button", Object.assign({}, BTN, { background: "rgba(255,80,80,0.32)", color: "#ffd0d0", border: "1px solid rgba(255,120,120,0.5)" }), "LEAVE MATCH", box);
    yes.dataset.lc = "quityes";
    yes.onclick = () => { if (R.pause) { R.pause.remove(); R.pause = null; } if (!online) W.paused = false; W.endMatch(false); };
    const no = h("button", Object.assign({}, BTN, { background: "#57b0ff", color: "#fff" }), "STAY", box);
    no.dataset.lc = "quitno";
    no.onclick = () => { togglePause(W); togglePause(W); };     // close and reopen: the pause card as it was
  };
  h("div", { fontSize: FS(11), opacity: "0.6" },
    online ? "ONLINE — the match keeps running while this is open. Stay sharp."
           : "Single-player: the match is paused while this is open.", box);
}

/** P4.3: the death card is a banner over the LIVE view now. It takes the announcement
 *  band's place right under the signed-off top stack (placeBand keeps it there and
 *  hangs the storm / pickup lines off its height), stays clear of the reticle, and the
 *  world keeps playing behind it - A / D still switch whom you are watching (the
 *  spectate bar at the bottom owns that line; the banner never repeats it). */
function showDeath(W, killerId, weaponId) {
  releaseCursor(W);          // its MATCH STATS button is otherwise unclickable
  ensureHudStyles();
  const killer = killerId ? W.actorById.get(killerId) : null;
  // the layer stays a full-screen click sink on purpose: a click on the dead player's
  // canvas must not re-grab the pointer and hide the very button this banner carries
  const L = layer("death", { pointerEvents: "auto" });
  const bt = (R._bandTop != null ? R._bandTop : META_TOP + META_RESERVE + BAND_GAP);
  const box = h("div", { position: "absolute", top: bt + "px", left: "50%", transform: "translateX(-50%)" }, null, L);
  box.className = "lc-gl lc-death";
  box.dataset.lc = "death";
  R.deathBox = box; R._deathH = 0;
  if (R.annWrap) {                                   // whatever band is showing hands the spot over
    clearTimeout(R._annT); R._annUntil = 0; R._annPrio = 0; R._annQ = [];
    R.annWrap.style.opacity = "0";
  }
  if (R._deathRO) { R._deathRO.disconnect(); R._deathRO = null; }
  if (typeof ResizeObserver !== "undefined") {
    R._deathRO = new ResizeObserver((ents) => {
      // the border box (the padding differs per layout: desktop 21 px, tablet 7, phone 4);
      // contentRect + the desktop padding where borderBoxSize is missing (Safari < 15.4)
      const e = ents[ents.length - 1], bb = e.borderBoxSize && e.borderBoxSize[0];
      const hgt = bb ? bb.blockSize : e.contentRect.height + 20;
      if (Math.abs(hgt - (R._deathH || 0)) > 1) { R._deathH = hgt; placeBand(); }
    });
    R._deathRO.observe(box);
  }
  placeBand(true);

  // row 1: ELIMINATED  #3 of 50  [MATCH STATS]
  // row 2: ELIMINATED BY <name> [silhouette] <weapon> HEADSHOT 31 m  ·  what you did to them
  const place = W.match.placementOf(W.player.id);
  const d1 = h("div", null, null, box); d1.className = "lc-d1";
  h("div", null, "ELIMINATED", d1).className = "lc-dt";
  d1.firstChild.dataset.lc = "deathtitle";
  const pn = h("div", null, "#" + place, d1); pn.className = "lc-dn";
  h("small", null, " of " + W.match.totalPlayers, pn);
  const btn = h("button", null, "MATCH STATS", d1); btn.className = "lc-dbtn";
  btn.onclick = () => W.endMatch(false);

  const hit = W.player.lastHit;
  const d2 = h("div", null, null, box); d2.className = "lc-d2";
  const p1 = h("div", null, null, d2); p1.className = "lc-dp";
  R._dSil = null;
  if (killer) {
    h("span", null, "ELIMINATED BY", p1).className = "lab lab-l";
    h("span", null, "BY", p1).className = "lab lab-s";
    h("b", null, killer.name, p1);
    if (weaponId && K.WEAPONS[weaponId]) {
      const wi = h("img", null, null, p1); wi.className = "w"; wi.alt = "";
      const u = silFor(W, weaponId);
      if (u) { wi.src = u; wi.style.display = "block"; }
      R._dSil = { id: weaponId, el: wi };
      h("span", null, K.weaponName(weaponId), p1);
    } else if (weaponId) h("span", null, K.weaponName(weaponId), p1);
    const mine = hit && hit.attackerId === killerId;
    if (mine && hit.isHead) h("span", null, "HEADSHOT", p1).className = "hs";
    if (mine && hit.dist != null) h("span", null, hit.dist + " m", p1);
  } else h("span", null, deathCause(W.player, killer, weaponId) === "fall" ? "YOU FELL" : "THE STORM GOT YOU", p1).className = "lab";      // OD-8
  if (killer) {
    // how close you came - the single most-wanted number on a death screen
    const dealt = Math.round((killer.dmgFrom && killer.dmgFrom[W.player.id]) || 0);
    const hpLeft = Math.max(0, Math.round(killer.hp));
    const p2 = h("div", null, null, d2); p2.className = "lc-dp rc";
    h("span", null, "YOU DEALT", p2).className = "lab";
    const dv = h("b", null, dealt + "", p2); if (dealt > 0) dv.style.color = "#9fd7ff";
    h("span", null, "·", p2).className = "lab";
    h("span", null, killer.alive ? "THEY HAD" : "THEY DIED TOO", p2).className = "lab";
    if (killer.alive) {
      const lv = h("b", null, hpLeft + " HP" + (killer.shield > 0 ? " + " + Math.round(killer.shield) + " shield" : ""), p2);
      h("span", null, "LEFT", p2).className = "lab";
      if (killer.hp <= 25 && dealt > 0) { lv.style.color = "#ffd166"; h("span", null, "SO CLOSE", p2).style.color = "#ffd166"; }
    }
  }
  // LC-81: row 3 - EVERY damage source of the last 10 s with its total (Apex's death recap; ours named the killer only). Sorted by damage;
  // at most three pills, the rest folded into "+N more".
  const rec = deathRecap(W, 10);
  if (rec.length) {
    const d3 = h("div", null, null, box); d3.className = "lc-d2"; d3.dataset.lc = "deathrecap";
    const p3 = h("div", null, null, d3); p3.className = "lc-dp rc";
    h("span", null, "LAST 10 S", p3).className = "lab";
    rec.slice(0, 3).forEach((r, i) => {
      if (i) h("span", null, "·", p3).className = "lab";
      const nm = h("b", null, r.name, p3);
      if (r.src === W.player.id) nm.style.color = "#ffb36a";
      h("span", null, r.dmg + (r.what ? " " + r.what : ""), p3);
      if (r.heads) h("span", null, r.heads + " HS", p3).className = "hs";
    });
    if (rec.length > 3) h("span", null, "+" + (rec.length - 3) + " more", p3).className = "lab";
    R._deathRecap = rec;
  } else R._deathRecap = [];
}
/** LC-81: the damage the local player took in the last `win` seconds of the match clock, per source: [{ src, name, dmg, hits, heads, what }],
 *  biggest first. Sources: an attacker id (its name, its weapon if it used one), "storm", or "world" (a fall or a blast with no owner). */
function deathRecap(W, win) {
  const L2 = R.dmgLog || [], t1 = W.t, by = new Map();
  for (const e of L2) {
    if (t1 - e.t > win) continue;
    let r = by.get(e.src);
    if (!r) {
      const a = e.src !== "storm" && e.src !== "world" && e.src !== "fall" && W.actorById ? W.actorById.get(e.src) : null;
      r = { src: e.src, name: e.src === "storm" ? "STORM" : e.src === "fall" ? "FALL" : a ? a.name : e.src === "world" ? "FALL / BLAST" : "UNKNOWN", dmg: 0, hits: 0, heads: 0, weps: new Map() };
      by.set(e.src, r);
    }
    r.dmg += e.dmg; r.hits++; if (e.head) r.heads++;
    if (e.w && e.w !== "storm") r.weps.set(e.w, (r.weps.get(e.w) || 0) + 1);
  }
  const out = [];
  for (const r of by.values()) {
    let what = "";
    if (r.weps.size) {
      const [w, n] = [...r.weps.entries()].sort((a, b) => b[1] - a[1])[0];
      what = "(" + (K && K.weaponName && K.WEAPONS[w] ? K.weaponName(w) : String(w).toUpperCase()) + (r.hits > 1 ? " ×" + r.hits : "") + ")";
    } else if (r.hits > 1 && r.src !== "storm") what = "(×" + r.hits + ")";
    out.push({ src: r.src, name: r.name, dmg: Math.round(r.dmg), hits: r.hits, heads: r.heads, what });
  }
  return out.sort((a, b) => b.dmg - a.dmg);
}

/** The winning kill's banner + feed used to be destroyed in the frame they were
 *  born: endMatch -> showPostMatch -> hideHUD() removed the whole layer. Phase
 *  "over" is already whitelisted in the frame gate and already blocks damage, so
 *  the world can safely hold for a beat first. */
export function announceVictory(W, victory) {
  // a dead player's banner already says ELIMINATED; repeating it over the banner is noise
  if (!victory && R.deathBox) return;
  // "VICTORY ROYALE" is Epic Games' Fortnite phrase; the win title is our own
  // line, promoted from what used to be its subtitle.
  const total = (W && W.match && W.match.totalPlayers) || 50;
  const teamWin = victory && teamModeOf(W) !== "solo";     // C-MODE: a squad wins together
  announce(victory ? (teamWin ? "LAST TEAM STANDING" : "LAST ONE STANDING") : "ELIMINATED",
    victory ? "#1 OF " + total + " · THE CIRCLE IS YOURS" : "BETTER LUCK NEXT DROP",
    victory ? "#ffd54a" : "#ff8f6a", 2600, ANN_PRIO.victory);
}

/** Contract C9 read-back (merged into __LC__.feel() by L4). State only — it
 *  never reads layout, so a gate can call it every stepped frame. */
export function readback(W) {
  const r = R._ret;
  return {
    hud: !!R.hud,
    marker: {
      style: MK.style, opacity: MK.op < 0 ? 0 : MK.op, scale: +MK.sc.toFixed(3),
      ageMs: MK.style ? Math.round(MK.t * 1000) : null, color: MK.col, ring: MK.ring,
      killLatchMs: Math.round(MK.latch * 1000), killHeldMs: Math.round(MK.killHeld * 1000),
      breakRing: MK.bop > 0 ? MK.bop : 0,
      hits: MK.hits, kills: MK.kills, blocked: MK.blocked, breaks: MK.breaks,
      clockMs: Math.round(MK.clk * 1000), log: MK.log.slice(),
    },
    reticle: r ? { weapon: R._crossFor, kind: r.kind, arms: r.arms.length, gapPx: r.gapPx, armLenPx: r.len, armThickPx: r.th, bloom: +(R._bloom || 1).toFixed(3) } : null,
    band: { top: R._bandTop, metaBottom: R._metaBottom, height: bandH() },
    vitals: R.hpNum && R._hudCache ? {
      hp: R._hudCache.hpI, shield: R._hudCache.shI, hpState: R._hudCache.hpSt,
      hpSegs: R._hpS.slice(), shieldSegs: R._shS.slice(),
      cons: R.cons ? R.cons.map((c) => ({ id: c.id, n: c.c, key: c.k })) : null,
    } : null,
    card: R.wCard && R._hudCache ? {
      weapon: R._hudCache.cWid, rarity: R._hudCache.cRar, name: R.wName.textContent, tag: R.wTag.textContent,
      mode: R.wMode.textContent, count: R.ammoText.textContent, ammoType: R.wAType.textContent,
      magSegs: R._magS.slice(0, R._hudCache.cN || 0), hidden: R.wCard.style.display === "none",
      pic: R.wSil && R.wSil.style.visibility === "visible" ? (R.wSil.getAttribute("src") || "").slice(0, 40) : null,
    } : null,
    stormLine: R.circL ? R.circL.textContent : null,
    death: R.deathBox ? { h: Math.round(R._deathH || 0), top: R._bandTop } : null,
    silhouettes: { off: _sil.off, state: Object.assign({}, _sil.st) },
    touch: { on: touchOn, phone: phoneShort(), rotate: _rotOn, taps: _tap.n, lastTap: _tap.last },
    ring: { radius: R._ringR != null ? Math.round(R._ringR) : null, live: inds.length },
    announcement: R.annWrap ? {
      title: R.annTitle.textContent, sub: R.annSub.textContent,
      showing: performance.now() < (R._annUntil || 0), prio: R._annPrio || 0, queued: (R._annQ || []).length,
    } : null,
    view: { w: _vw, h: _vh, c1: !!(W && W.kernel && W.kernel.viewW > 0) },
    // P2-G / P3 read-backs
    hudScale: R._hs || 1, flashReduce: !!R._flashRed,
    minimap: W && W.map ? (() => { const v = mmView(W, 180, false); return { span: Math.round(v.span), mpp: +(v.span / 180).toFixed(2), local: v.span < W.map.size - 1e-6 }; })() : null,
    bigmap: R.bigmap && R._bigView ? { zoom: R._bigView.z, cx: Math.round(R._bigView.cx), cz: Math.round(R._bigView.cz), span: Math.round(R._bigView.span) } : null,
    team: { mode: W ? teamModeOf(W) : "solo", mates: R.mateEls ? R.mateEls.map((m) => ({ id: m.a.id, k: m.k })) : [], bleed: R.bleedRow ? R._bleedK : null, revive: R._reviveUi || null },
    tags: R._tagPol ? { enemyM: R._tagPol.enemyM, aimedId: R._tagPol.aimedId, aimedLeftS: +Math.max(0, R._tagPol.aimedUntil - performance.now() / 1000).toFixed(2) } : null,
    hints: { shown: (R._hintLog || []).slice(), seen: Object.keys(hintSeen()), guide: R._guide ? { idx: R._guide.idx, done: R._guide.done, steps: R._guide.rows.filter((r) => r.done).map((r) => r.id) } : null },
    supply: W && W._supplyMarks ? W._supplyMarks.map((m) => ({ landed: !!m.landed, opened: !!m.opened })) : [],
    hotZone: W && W.lootHotZone && !touchOn ? { id: W.lootHotZone.id, drawn: R._hotDrawn | 0 } : null,
  };
}

/** Contract C8: per-match teardown. The HUD layer itself is rebuilt by
 *  showHUD; this drops what would otherwise leak from one match into the next
 *  (live indicators, queued banners and their timers, the marker latch, the
 *  quest-card observer, cached roster refs). */
export function disposeMatch(W) {
  while (inds.length) parkIndicator(inds.pop());
  stepMarks.clear();
  clearTimeout(R._annT); R._annQ = []; R._annUntil = 0; R._annPrio = 0;
  clearTimeout(R._stormMsgT); clearTimeout(R._pickupMsgT);
  if (R._bigIv) { clearInterval(R._bigIv); R._bigIv = null; }
  if (R._metaRO) { R._metaRO.disconnect(); R._metaRO = null; }
  MK.style = null; MK.latch = 0; MK.hurt = null; MK.breakT = 99;
  _slotC.who = null;
  R.deathBox = null; R._deathH = 0;
  if (R._deathRO) { R._deathRO.disconnect(); R._deathRO = null; }
}

/** Every player's line for the standings table: ranked by final placement, the ones
 *  still in the circle (the player left early) ahead of the dead, ties by kills then
 *  damage. Dead players carry the sim's own placement; a player nobody has placed yet
 *  gets a provisional rank by kills / damage, which is consistent by construction
 *  (the dead are always placed below everyone still alive). */
function standingRows(W) {
  const m = W.match, acts = W.actors;
  if (!m || !acts || W.mode === "practice") return null;
  const rows = [];
  for (let i = 0; i < acts.length; i++) {
    const a = acts[i];
    if (!a || m.kills[a.id] == null) continue;
    const pl = m.placementOf(a.id);
    rows.push({ id: a.id, name: a.name || String(a.id), you: a === W.player, kills: m.kills[a.id] || 0, dmg: Math.round(m.damage[a.id] || 0), pl, live: pl == null && m.alive.has(a.id), rank: pl });
  }
  if (rows.length < 2) return null;
  const unplaced = rows.filter((r) => r.pl == null);
  unplaced.sort((x, y) => (y.kills - x.kills) || (y.dmg - x.dmg));
  unplaced.forEach((r, i) => { r.rank = i + 1; });
  rows.sort((x, y) => ((x.rank || 999) - (y.rank || 999)) || (y.kills - x.kills) || (y.dmg - x.dmg));
  return rows;
}
function buildStandings(W, parent) {
  const rows = standingRows(W);
  if (!rows) return null;
  const card = h("div", null, null, parent); card.className = "lc-gl lc-pm-st"; card.dataset.lc = "standings";
  const head = h("div", null, "STANDINGS", card); head.className = "lc-pm-h";
  h("small", null, rows.length + " players", head);
  const sc = h("div", null, null, card); sc.className = "lc-scroll"; sc.dataset.lc = "standscroll";
  const tb = h("table", null, null, sc); tb.className = "lc-tbl";
  const th = h("thead", null, null, tb), tr0 = h("tr", null, null, th);
  h("th", null, "#", tr0); h("th", null, "PLAYER", tr0);
  h("th", null, "KILLS", tr0).className = "n"; h("th", null, "DAMAGE", tr0).className = "n";
  const body = h("tbody", null, null, tb);
  let meRow = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const tr = h("tr", null, null, body);
    tr.className = (r.you ? "me " : "") + (r.rank === 1 ? "top" : "");
    h("td", null, String(r.rank), tr).className = "r";
    const nm = h("td", null, r.name.length > 22 ? r.name.slice(0, 21) + "…" : r.name, tr); nm.className = "nm";
    if (r.you && r.name !== "You") h("span", null, "(you)", nm).className = "you";   // the default name already says it
    if (r.live) h("span", null, "STILL IN", nm).className = "live";
    h("td", null, String(r.kills), tr).className = "n";
    h("td", null, String(r.dmg), tr).className = "n";
    if (r.you) meRow = tr;
  }
  // Whole rows only. The scroller is made exactly header + a whole number of rows tall and scrolled to a row boundary with the player's own line mid-window, from the rows' REAL
  // positions (rows differ by a pixel here and there, so n x one height drifts: 2026-10-12 a row sat 12 px under the sticky header at the end of the list). At the top, in the
  // middle and at the end of the list no row is ever half under the header. Once, while the screen builds.
  setTimeout(() => {
    if (!sc.isConnected || !body.rows.length) return;
    const R = body.rows, N = R.length, hh = tb.tHead ? tb.tHead.offsetHeight : 0, t0 = tb.getBoundingClientRect().top;
    const y = new Array(N + 1);                               // y[i] = the top of row i in the table's own coordinates; y[N] = the bottom of the last row
    for (let i = 0; i < N; i++) y[i] = R[i].getBoundingClientRect().top - t0;
    y[N] = tb.getBoundingClientRect().height;
    if (!(y[0] > 0) || !(y[N] > y[0])) return;                // not laid out (hidden)
    const avail = sc.clientHeight - hh;
    const fit = (j) => { let n = 0; while (j + n < N && y[j + n + 1] - y[j] <= avail + 0.01) n++; return n; };
    if (fit(0) >= N) return;                                  // everything fits: nothing to scroll
    const mi = meRow ? meRow.sectionRowIndex : 0, n0 = Math.max(1, fit(0));
    const j = Math.max(0, Math.min(N - n0, mi - ((n0 - 1) >> 1)));
    const n = Math.max(1, fit(j));
    sc.style.maxHeight = (hh + y[j + n] - y[j]) + "px";
    sc.scrollTop = y[j] - hh;
  }, 0);
  card._rows = rows;
  return card;
}

/** (release blockers) The victory title fitted to its card: the 34 px title steps down (letter spacing with it) until it fits the card's
 *  content box, at every window size and on every resize while the screen is up; never below 16 px. Touch keeps its own rule
 *  (TOUCH_CSS sets the title's size with !important) and is left alone. */
function fitPostTitle(el, box) {
  if (touchOn) return;
  el.style.maxWidth = "100%";
  const fit = () => {
    if (!el.isConnected) { window.removeEventListener("resize", fit); return; }
    const cs = getComputedStyle(box);
    const avail = box.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    if (!(avail > 0)) return;
    let fs = 34;
    el.style.fontSize = fs + "px"; el.style.letterSpacing = "3px";
    while (fs > 16 && el.scrollWidth > avail + 0.5) {
      fs -= 1;
      el.style.fontSize = fs + "px"; el.style.letterSpacing = (3 * fs / 34).toFixed(2) + "px";
    }
  };
  requestAnimationFrame(fit);
  setTimeout(fit, 0);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);      // Orbitron may land after the first fit
  window.addEventListener("resize", fit);
}
export function showPostMatch(W, res) {
  releaseCursor(W);          // the buttons are otherwise unclickable
  hideHUD();
  ["pause", "death"].forEach((n) => { if (R[n]) { R[n].remove(); R[n] = null; } });
  ensureAAAStyles(); ensureHudStyles();
  const L = layer("post", {
    pointerEvents: "auto", display: "flex", alignItems: "center", justifyContent: "center",
    background: "radial-gradient(ellipse at 50% 35%, rgba(12,28,52,0.5) 0%, rgba(4,8,16,0.92) 100%)",
  });
  // two cards side by side on a desktop (what you did | everyone), stacked and
  // scrolling on a phone: the wrapper is the one scroller, nothing is pinned
  const wrap = h("div", null, null, L); wrap.className = "lc-pm"; wrap.dataset.lc = "post";
  const box = h("div", null, null, wrap);
  box.className = "lc-gl lc-pm-sum lc-glass-scan";
  box.dataset.lc = "postsum";
  const tmPM = teamModeOf(W);
  if (res.victory) {
    // (release blockers) a squad wins together: LAST TEAM STANDING in Duos / Trios / Squads, as the in-match announcement says. The title is
    // fitted to the card (fitPostTitle): at 34 px "LAST ONE STANDING" was wider than the card at 1280 x 720 and clipped at both ends.
    const ttl = h("div", {
      fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "34px", fontWeight: "900", color: "#ffd54a",
      textShadow: "0 0 36px rgba(255,213,74,0.55)", letterSpacing: "3px", whiteSpace: "nowrap",
    }, tmPM !== "solo" ? "LAST TEAM STANDING" : "LAST ONE STANDING", box);   // not "VICTORY ROYALE" — Epic Games' phrase
    ttl.dataset.lc = "posttitle";
    fitPostTitle(ttl, box);
    if (!(W.settings && W.settings.flashReduce)) confetti(L);   // LC-43 flash reduction: no confetti
    if (W.hooks && W.hooks.celebrate) W.hooks.celebrate();
  } else {
    h("div", {
      fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "32px", fontWeight: "900", letterSpacing: "4px",
    }, "MATCH OVER", box).dataset.lc = "posttitle";
  }
  const total = W.match ? W.match.totalPlayers : 50;
  const tiles = h("div", null, null, box); tiles.className = "lc-tiles";
  const tile = (k, v, col) => {
    const t = h("div", null, null, tiles); t.className = "lc-tile";
    h("div", null, k, t).className = "k";
    const vv = h("div", null, String(v), t); vv.className = "v"; if (col) vv.style.color = col;
  };
  tile("Placement", res.placement + " / " + total, res.victory ? "#ffd54a" : "#9fd7ff");
  tile("Kills", res.kills);
  tile("Damage", res.damage);
  const stands = buildStandings(W, wrap);
  // who took it: the winner's line, from the same rows the table prints
  const win = h("div", null, "", box); win.className = "lc-winner";
  if (stands) {
    const top = stands._rows[0];
    if (W.match && W.match.over && top) {
      // (release blockers) in a team mode the winners are a team: "Your squad won with 7 kills" - every member's kills (a dead mate's too)
      const lead = tmPM !== "solo" && W.actorById ? W.actorById.get(top.id) : null;
      if (lead && lead.teamId) {
        let k = 0, mine = false;
        for (const a of W.actors) if (a && a.teamId === lead.teamId && !a.isDummy) { k += W.match.kills[a.id] || 0; if (a === W.player) mine = true; }
        const word = tmPM === "duo" ? "duo" : tmPM === "trio" ? "trio" : "squad";
        win.textContent = (mine ? "Your " + word : top.name + "'s " + word) + " won with " + k + (k === 1 ? " kill" : " kills");
      } else win.textContent = (top.you ? "You" : top.name) + " won with " + top.kills + (top.kills === 1 ? " kill" : " kills");
    }
    else if (W.match) win.textContent = W.match.aliveCount() + " still in the circle";
  }
  const grid = h("div", {
    display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 36px", fontSize: "15px",
    textAlign: "left", margin: "6px auto 0", fontFamily: "Rajdhani, " + FONT, fontWeight: "600", width: "min(280px, 100%)",
  }, null, box);
  stat(grid, "Accuracy", res.accuracy + "%");
  stat(grid, "Survived", fmtT(res.timeS));
  // match XP → progression (kills + damage + placement + survival + victory bonus)
  if (W.mode === "practice") {
    h("div", {
      fontSize: "12.5px", opacity: "0.75", marginTop: "14px", letterSpacing: "1px",
      fontFamily: "Rajdhani, " + FONT, color: "#9fd7ff",
    }, "PRACTICE — NO XP OR CAREER PROGRESS FROM THE SANDBOX", box);
  } else if (W.progress) {
    const raw = (res.kills || 0) * 100 + Math.round((res.damage || 0) * 0.2)
      + Math.max(0, (W.match ? W.match.totalPlayers : 50) - (res.placement || 50)) * 6
      + (res.victory ? 500 : 0) + Math.round((res.timeS || 0) / 4);
    // One formula across a 12:55 mode and a 4:00 mode made the flagship mode the
    // WORST way to progress: standard's storm runs 775 s against quick's 239 s
    // (royale.js STORM_PHASES) but only the timeS/4 term scaled with it, so the
    // 13-minute mode paid ~146 XP/min against quick's ~217. Do not shorten
    // standard — fix the rate.
    const gained = Math.round(raw * (W.mode === "standard" ? 1.6 : 1));
    const lvlBefore = W.progress.level;
    // Eliminations were already paid the instant they landed (see the actorDied
    // handler). `gained` stays the full match value for DISPLAY; only the unpaid
    // remainder is awarded here, so the two numbers differ on purpose.
    addXP(W, Math.max(0, gained - (W._elimXp || 0)));
    stat(grid, "XP earned", "+" + gained);
    // Challenge XP is banked the instant a card completes, in the per-frame HUD
    // loop, so it appeared NOWHERE on this screen — and with the elim3 rotation
    // the three cards are worth 625 XP against a typical ~390 match payout, i.e.
    // most of the session's progress was invisible. Report it; do NOT re-award it.
    const chalXp = W._chalXp || 0;
    if (chalXp) {
      stat(grid, "Challenges", "+" + chalXp);
      stat(grid, "Total XP", "+" + (gained + chalXp));
    }
    // fold into the LIFETIME record (these numbers used to be discarded)
    const c = recordMatch(W, res);
    // First win of the day. The one reason to come back tomorrow that does not
    // depend on any daily card being finishable inside a single match.
    if (res.victory && W.daily && !W.daily.firstWin) {
      W.daily.firstWin = true;
      saveDaily(W.daily);
      addXP(W, 750);
      stat(grid, "First win today", "+750");
    }
    // Bridge CALL SITES, per-method guarded and INERT today: W.hooks
    // (ffg_royale3d.js) currently exposes only the four lifecycle no-ops, so
    // none of these four fire. They exist so the one place a match's result is
    // known does not have to be re-derived later — every value below is already
    // on this screen and nothing is computed twice. Wiring them to anything that
    // leaves the machine is an owner decision, not a parity change.
    if (W.hooks) {
      const total = W.match ? W.match.totalPlayers : 50;
      if (W.hooks.score) {
        W.hooks.score((res.kills || 0) * 100 + Math.round(res.damage || 0)
          + Math.max(0, total - (res.placement || total)) * 25 + (res.victory ? 1000 : 0));
      }
      // Never push before the account has been read — see the WRITE LOCK in
      // showMenu(). Undefined means standalone/not embedded, where save is a no-op.
      if (W.hooks.save && W._cloudReadOk !== false) {
        W.hooks.save({ progress: W.progress, skin: getChosenSkin() });
      }
      if (W.hooks.achievement) {
        if (res.victory) W.hooks.achievement("first_win");
        if ((res.kills || 0) >= 5) W.hooks.achievement("five_kill_game");
        // dayStreak lives on W.progress, NOT on the career object `c`
        if ((W.progress.dayStreak || 0) >= 7) W.hooks.achievement("streak_7");
      }
    }
    if (c) {
      const careerEl = h("div", { fontSize: "12.5px", opacity: "0.8", marginTop: "14px", letterSpacing: "1px", fontFamily: "Rajdhani, " + FONT },
        "CAREER · " + c.matches + (c.matches === 1 ? " match · " : " matches · ") + c.wins + (c.wins === 1 ? " win · " : " wins · ") + c.kills + (c.kills === 1 ? " kill" : " kills") + " · top-10s " + c.top10s + " · best #" + (c.bestPlacement || "—")
        + " · " + Math.round(c.damage / 1000) + "k dmg · " + (c.timeAliveS / 3600).toFixed(1) + "h", box);
      careerEl.dataset.lc = "postcareer";
    }
    if (W.progress.level > lvlBefore) {
      h("div", { fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "17px", fontWeight: "900", color: "#ffd54a", marginTop: "8px", letterSpacing: "2px", textShadow: "0 0 18px rgba(255,213,74,0.5)" },
        "LEVEL UP  →  " + W.progress.level, box);
    }
  }
  // "Run it back" replays the SAME map and mode, "Find a new match" is a fresh match on a
  // RANDOM map (no map picker) - both through the orchestrator's onAgain, so net leave,
  // the loading screen and the world teardown are the one path the old PLAY AGAIN took.
  // Going back to the menu tears the match down, rebuilds the cinematic menu world and
  // re-reads the skin GLBs just to press PLAY again, which is why this is not the default.
  const row = h("div", null, null, box); row.className = "lc-pm-act";
  if (res.onAgain) {
    const again = h("button", null, null, row); again.className = "lc-pbtn pri"; again.dataset.lc = "runitback";
    h("span", null, null, again).className = "ic"; again.firstChild.innerHTML = IC.rerun;
    h("span", null, "Run it back", again);
    again.onclick = () => {
      const m = W.mapId;
      L.remove(); R.post = null;
      _nextMap = m || null;
      try { res.onAgain(); } finally { _nextMap = null; }
    };
    const find = h("button", null, null, row); find.className = "lc-pbtn sec"; find.dataset.lc = "findmatch";
    h("span", null, "Find a new match", find);
    h("span", null, null, find).className = "ic"; find.lastChild.innerHTML = IC.next;
    find.onclick = () => { L.remove(); R.post = null; _nextMap = null; res.onAgain(); };
  }
  const menu = h("button", null, "MAIN MENU", box); menu.className = "lc-pm-menu"; menu.dataset.lc = "mainmenu";
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
  ["Move Forward", "KeyW"], ["Move Back", "KeyS"], ["Move Left", "KeyA"], ["Move Right", "KeyD"],
  ["Jump", "Space"], ["Sprint", "ShiftLeft"], ["Crouch", "KeyC"], ["Loot / Interact", "KeyE"],
  ["Emote — Dance", "KeyB"], ["Emote — Cheer", "KeyN"],
  ["Reload", "KeyR"], ["Map", "KeyM"],
  // LC-07: "KeyZ" is the Ping action's canonical code (hud.js PING_KEY); middle mouse always pings as well
  ["Ping", "KeyZ"],
  // LC-82: Q was hardcoded (player.js reads the canonical KeyQ) and missing here, so "every key can be rebound" was false; remap is applied
  // before player.js sees a key, so listing it makes it rebindable with no player.js change
  ["Drop weapon", "KeyQ"],
  // LC-46: squad chat (online rooms) - player.js reads the canonical "Enter" through the same remap, so listing it makes it rebindable
  ["Chat (online)", "Enter"],
  ["Weapon 1", "Digit1"], ["Weapon 2", "Digit2"], ["Weapon 3", "Digit3"],
  ["Weapon 4", "Digit4"], ["Weapon 5", "Digit5"],
];   // fire/ADS are mouse buttons — not keyboard-rebindable here
// Sentinel parked on an action's DEFAULT key once that key is no longer supposed
// to trigger it. canon() maps physical -> canonical and falls through to
// identity, so without this a rebound action stayed reachable from its old key.
const UNBOUND = "__unbound";
/** The physical key currently driving `canonical`, or null if nothing does. */
function physFor(W, canonical) {
  const rm = (W.settings && W.settings.remap) || {};
  for (const k in rm) if (rm[k] === canonical) return k;
  return rm[canonical] === UNBOUND ? null : canonical;
}
/** First-run controls card. Deliberately NOT a forced tutorial: one screen, the
 *  verbs that are not guessable, and a button. Reachable any time from the menu. */
export function showHowToPlay(W) {
  releaseCursor(W);
  ensureAAAStyles();
  const L = layer("howto", { pointerEvents: "auto", background: "rgba(4,8,16,0.92)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70 });
  // It never scrolled and had no way out but its button: on a short viewport
  // the card ran off the bottom and GOT IT went with it. It fits the dynamic
  // viewport, and only the BODY scrolls: GOT IT sits in a footer outside the
  // scroller, so it is on-screen on every landscape phone (a scrolling card
  // with the button as its last child still put it at y 518-563 on a 375-412
  // px tall phone — VERIFY 17). ESC or a click/tap outside closes it too.
  const box = h("div", Object.assign({
    padding: "24px 32px 16px", width: "min(520px, calc(100vw - 24px))", boxSizing: "border-box",
    maxHeight: "calc(100dvh - 24px)", overflow: "hidden",
    display: "flex", flexDirection: "column", gap: "10px",
  }, PANEL), null, L);
  box.dataset.lc = "howto";
  h("div", { fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "20px", fontWeight: "900", letterSpacing: "3px", flexShrink: "0" }, "HOW TO PLAY", box);
  const body = h("div", {
    flex: "1 1 auto", minHeight: "0", overflowY: "auto", overscrollBehavior: "contain",
    display: "flex", flexDirection: "column", gap: "10px", paddingRight: "4px",
  }, null, box);
  body.dataset.lc = "howtobody";
  h("div", { fontSize: "13px", opacity: "0.8", lineHeight: "1.5", fontFamily: "Rajdhani, " + FONT },
    // LC-82: there is no landing-zone picker (owner 2026-09-15: drop straight in); you steer the glide instead
    "50 drop in, one walks out. Steer your drop, loot a weapon, stay inside the circle.", body);
  const mkGrid = (cls) => {
    const g = h("div", { display: "grid", gridTemplateColumns: "auto 1fr", gap: "5px 16px", marginTop: "6px", fontFamily: "Rajdhani, " + FONT, fontSize: "13px" }, null, body);
    g.className = cls;
    return (k, what) => {
      h("div", { fontWeight: "900", color: "#9fd7ff", letterSpacing: "1px", whiteSpace: "nowrap" }, k, g);
      h("div", { opacity: "0.85" }, what, g);
    };
  };
  // TOUCH section (touch.js, lane L10, contract C6): shown instead of the keys
  // on html.lc-touch. The verbs are the same game; only the hands change.
  const th = h("div", { fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "12px", fontWeight: "800", letterSpacing: "2px", color: "#8ec8ff", marginTop: "4px" }, "TOUCH CONTROLS", body);
  th.className = "lc-touch-only";
  const tc = mkGrid("lc-touch-only");
  tc("LEFT THUMB", "Move — the stick appears where your thumb lands; push it all the way forward to sprint");
  tc("RIGHT THUMB", "Look — drag anywhere on the right side of the screen");
  tc("FIRE", "Hold to fire · drag from the button to keep aiming while you shoot");
  tc("ADS", "Aim down sights — tap on, tap again to lower");
  tc("JUMP", "Jump · in the air, CUT the chute to dive — tap again to re-open · jump at a ledge to climb");
  tc("USE", "Tap to pick up loot · hold at a chest to open it");
  tc("RELOAD", "Reload");
  tc("SLOTS", "Tap a weapon or item slot to equip it");
  tc("MINIMAP", "Tap it for the full map · tap the map to close it");
  tc("PAUSE", "Pause and settings");
  const tn = h("div", { fontSize: "12px", opacity: "0.7", marginTop: "6px", lineHeight: "1.5", fontFamily: "Rajdhani, " + FONT },
    "Play with the phone on its side. Aim assist steadies your aim while you fire (Settings turns it off). The reticle grows when your shots will scatter and tightens when they will not — standing still helps.", body);
  tn.className = "lc-touch-only";
  // KEYBOARD section. Read the LIVE bindings. This card closes with "Every key
  // here can be rebound" (Settings) while printing hardcoded defaults, so the
  // moment anyone took it up on that, the only onboarding screen in the game
  // taught the wrong keys.
  const kb = mkGrid("kbd-hint");
  const kx = (canonical) => { const ph = physFor(W, canonical); return ph ? keyLabel(ph) : "—"; };
  kb(kx("KeyW") + " " + kx("KeyA") + " " + kx("KeyS") + " " + kx("KeyD"), "Move");
  kb(kx("ShiftLeft"), (W.settings && W.settings.sprintToggle) ? "Sprint — a CLICK toggles it on and off" : "Sprint — hold");
  kb(kx("KeyC"), "Crouch — slower, but a much tighter cone");
  // The cut is the move that halves the descent (player.js: -5.5 m/s under the
  // canopy against -20, or -34 sprinting) and this card described the redeploy
  // instead — the only half of the verb that does not help.
  kb(kx("Space"), "Jump · in the air, CUT the chute to dive — tap again to re-open");
  kb("LMB / RMB", "Fire · aim down sights");
  kb(kx("KeyE"), "Loot — hold on a chest to open it");
  kb(kx("KeyR"), "Reload");
  kb(kx("Digit1") + " – " + kx("Digit5"), "Weapon and item slots");
  kb(kx("KeyQ"), "Drop your weapon — hand a gun to a squadmate (keeps its magazine)");
  kb("MMB / " + kx(PING_KEY), "Ping — mark a spot, or an enemy, for your squad · on the map (" + kx("KeyM") + ") click to drop a pin");
  kb(kx("KeyM"), "Map");
  kb(kx("KeyB") + " / " + kx("KeyN"), "Emote — dance · cheer");
  kb(kx("Space") + " at a ledge", "Climb — jump toward a low wall or rooftop edge and you'll pull up over it");
  kb(kx("ShiftLeft") + " scoped", "Hold breath — steadies the sniper sway; watch your lungs, running dry leaves you shaky");
  kb("ESC", "Pause and settings");
  h("div", { fontSize: "12px", opacity: "0.7", marginTop: "6px", lineHeight: "1.5", fontFamily: "Rajdhani, " + FONT },
    // LC-82: ESC and the mouse buttons are fixed, so "every key here" was not true; Q (drop) is in the keybind table now
    "The reticle grows when your shots will scatter and tightens when they will not — standing still and crouching both help. Every key above except ESC and the mouse buttons can be rebound in Settings.", body).className = "kbd-hint";
  const go = h("button", Object.assign({}, BTN, {
    fontFamily: "Orbitron, " + FONT_DISPLAY, background: "linear-gradient(180deg,#6ec4ff,#2f7fd6)",
    color: "#fff", fontSize: "15px", padding: "12px 34px", letterSpacing: "2px", marginTop: "2px", alignSelf: "center",
    flexShrink: "0", minHeight: "44px",
  }), "GOT IT", box);
  const close = () => {
    try { localStorage.setItem("lc_seen_intro", "1"); } catch (e) {}
    window.removeEventListener("keydown", onKey, true);
    if (R.howto === L) R.howto = null;
    L.remove();
  };
  // capture phase + stopPropagation: the Esc that closes the card must not also
  // reach player.js and open the pause menu underneath it
  const onKey = (e) => {
    if (!L.isConnected) { window.removeEventListener("keydown", onKey, true); return; }
    if (e.key === "Escape" || e.code === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
  };
  window.addEventListener("keydown", onKey, true);
  L.addEventListener("click", (e) => { if (e.target === L) close(); });   // tap / click outside the card
  go.onclick = close;
}

/** Lifetime record. Every headline number below was already persisted and merely
 *  never computed — the menu strip prints raw totals but no RATE, so nothing on
 *  any screen told a player whether they were getting better. Same layer/PANEL/
 *  close-button shape as showHowToPlay above. */
export function showCareer(W) {
  releaseCursor(W);
  ensureAAAStyles();
  if (!W.progress) W.progress = loadProgress();
  const p = W.progress, c = p.career || newCareer(null);
  const L = layer("career", { pointerEvents: "auto", background: "rgba(4,8,16,0.92)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 70 });
  const box = h("div", Object.assign({ padding: "26px 34px", width: "520px", maxWidth: "calc(100vw - 92px)", maxHeight: "82vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px" }, PANEL), null, L);
  h("div", { fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "20px", fontWeight: "900", letterSpacing: "3px" }, "CAREER", box);
  h("div", { fontSize: "13px", opacity: "0.8", fontFamily: "Rajdhani, " + FONT, letterSpacing: "1px" },
    "LVL " + p.level + "  ·  " + rankLabel(p.level) + (p.dayStreak > 1 ? "  ·  🔥 " + p.dayStreak + "-DAY STREAK" : ""), box);
  const grid = h("div", { display: "grid", gridTemplateColumns: "1fr auto", gap: "5px 16px", marginTop: "6px", fontFamily: "Rajdhani, " + FONT, fontSize: "13.5px" }, null, box);
  const row = (label, val) => {
    h("div", { opacity: "0.72" }, label, grid);
    h("div", { fontWeight: "800", textAlign: "right" }, String(val), grid);
  };
  const m = c.matches || 0;
  if (!m) {
    // LC-82: there is no ranked mode - this said "ranked"
    h("div", { fontSize: "13px", opacity: "0.75", fontFamily: "Rajdhani, " + FONT }, "No matches yet — practice does not count toward the career record.", box);
  } else {
    row("Matches", m);
    row("Wins", c.wins + "  (" + (100 * c.wins / m).toFixed(1) + "%)");
    // K/D against DEATHS, not matches: a won match is a match you did not die in.
    row("K / D", (c.kills / Math.max(1, m - c.wins)).toFixed(2));
    row("Eliminations", c.kills);
    row("Average placement", c.placementSum ? "#" + (c.placementSum / m).toFixed(1) : "—");
    row("Best placement", c.bestPlacement ? "#" + c.bestPlacement : "—");
    row("Top 10 finishes", c.top10s);
    row("Damage dealt", Math.round(c.damage).toLocaleString());
    row("Time alive", (c.timeAliveS / 3600).toFixed(1) + " h");
    const mw = c.mapWins || {};
    const mapKeys = Object.keys(mw).filter((k) => mw[k] > 0);
    if (mapKeys.length) row("Wins by map", mapKeys.map((k) => k.replace(/_/g, " ") + " " + mw[k]).join("  ·  "));
    const kb = c.killsByCls || {};
    const kbKeys = Object.keys(kb).filter((k) => kb[k] > 0).sort((a, b) => kb[b] - kb[a]);
    // Only rendered when something wrote it — W.stats.killsByCls exists but no
    // increment has landed yet, so an empty map means "not measured", not zero.
    if (kbKeys.length) row("Favourite weapon", kbKeys[0].toUpperCase() + " (" + kb[kbKeys[0]] + " kills)");
  }
  h("div", { fontSize: "12px", opacity: "0.7", marginTop: "6px", fontFamily: "Rajdhani, " + FONT }, careerGoal(c), box);
  const go = h("button", Object.assign({}, BTN, {
    fontFamily: "Orbitron, " + FONT_DISPLAY, background: "linear-gradient(180deg,#6ec4ff,#2f7fd6)",
    color: "#fff", fontSize: "15px", padding: "12px 34px", letterSpacing: "2px", marginTop: "10px", alignSelf: "center",
  }), "CLOSE", box);
  go.onclick = () => { L.remove(); R.career = null; };
}

// ═══ SETTINGS on TOUCH (D9, owner: phones untouched) ═══════════════════════════════════════════════════════════
// A phone builds the settings panel EXACTLY as int-p1 did: the same rows in the same order, the same labels ('Graphics'
// LOW / MEDIUM / HIGH through applyGraphics), the same 560 px box with the DONE button at the end of the scroller. This is the
// int-p1 9aa2b746 showSettings, byte for byte except its name; its own re-renders call showSettings(W), which comes back here
// while the HUD is in touch mode. The tabbed panel below is the desktop one.
function showSettingsTouch(W) {
  releaseCursor(W);
  W.captureKey = null;   // drop any armed keybind capture when (re)rendering the modal
  // Every graphics button, every sprint/ADS toggle, the perf toggle, RESET and
  // each successful rebind re-enter this function, which tears the panel down
  // and builds a fresh scroll container — so the offset went back to the top and
  // the 17-row keybind grid (below the fold at maxHeight 82vh) threw you back up
  // to the volume sliders after every single bind.
  const prevScroll = (R.settings && R.settings.firstChild) ? R.settings.firstChild.scrollTop : 0;
  if (R.settings) { R.settings.remove(); R.settings = null; }
  const L = layer("settings", { pointerEvents: "auto", background: "rgba(4,8,16,0.9)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 });
  const box = h("div", Object.assign({ padding: "28px 36px", width: "560px", maxWidth: "calc(100vw - 96px)", maxHeight: "82vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px" }, PANEL), null, L);
  box.dataset.lc = "settings";
  h("div", { fontSize: "22px", fontWeight: "900", letterSpacing: "2px" }, "SETTINGS", box);

  // Every kill-feed line, the lobby cell and the name tags read actor.name, and
  // playerName has been a settings default since ffg_royale3d.js:420 with NO UI
  // anywhere that writes it — so you were "You" in your own kill feed while the
  // 68 hand-written bot names gave every opponent more identity than the player.
  // net.js papers over it online with "Player-XXX".
  // Wired on `change`/`blur`, never on every keystroke: showSettings rebuilds
  // itself on most interactions, so a per-keystroke re-render would lose focus
  // mid-word. player.js already ignores keydown on INPUT targets, so the field
  // cannot drive the character or steal a keybind capture.
  const nRow = h("div", { display: "flex", gap: "10px", alignItems: "center" }, null, box);
  h("div", { fontSize: "13px", opacity: "0.8", width: "160px" }, "Player name", nRow);
  const nInp = h("input", {
    flex: "1", padding: "7px 10px", borderRadius: "8px", background: "rgba(0,0,0,0.4)",
    border: "1px solid rgba(255,255,255,0.2)", color: "#eaf2ff", fontWeight: "700",
    fontFamily: "Rajdhani, " + FONT,
  }, null, nRow);
  nInp.type = "text"; nInp.maxLength = 14; nInp.placeholder = "You";
  nInp.value = (W.settings.playerName && W.settings.playerName !== "You") ? W.settings.playerName : "";
  const commitName = () => {
    const clean = String(nInp.value).replace(/[^A-Za-z0-9_\-. ]/g, "").replace(/\s+/g, " ").trim().slice(0, 14);
    nInp.value = clean;
    W.settings.playerName = clean || "You";
    save(W);
  };
  nInp.onchange = commitName;
  nInp.onblur = commitName;
  h("div", { fontSize: FS(11), opacity: "0.6", marginTop: "-4px", fontFamily: "Rajdhani, " + FONT },
    // the name is baked into the actor at match start (ffg_royale3d.js: `name:
    // W.settings.playerName || "You"`), so a mid-match change must not look inert
    "Applies from the next match.", box);

  slider(box, "Master volume", W.settings.masterVol, (v) => { W.settings.masterVol = v; applyAudio(W); });
  slider(box, "Music volume", W.settings.musicVol, (v) => { W.settings.musicVol = v; applyAudio(W); });
  slider(box, "SFX volume", W.settings.sfxVol, (v) => { W.settings.sfxVol = v; applyAudio(W); });
  // mouse / keyboard rows are .kbd-hint: hidden while the player is on touch,
  // where the TOUCH CONTROLS rows below take their place
  slider(box, "Mouse sensitivity", W.settings.sensitivity / 2, (v) => { W.settings.sensitivity = v * 2; save(W); }, { min: 0.075 }).className = "kbd-hint";   // never draggable to 0 — that killed mouse-look, and it persisted
  slider(box, "ADS sensitivity", W.settings.adsSensitivity / 2, (v) => { W.settings.adsSensitivity = v * 2; save(W); }, { min: 0.075 }).className = "kbd-hint";

  // TOUCH CONTROLS — the settings touch.js (lane L10) reads, feature-detected
  // there: touchScale, touchLeftHanded, touchSens, touchOpacity, aimAssist,
  // haptics. Shown only in touch mode. A change re-lays the controls out (a
  // resize event, which touch.js listens for) and the HUD (syncTouchPrefs).
  const touchChanged = () => {
    save(W); syncTouchPrefs(W);
    clearTimeout(R._touchRelayT);   // a slider drag fires per pixel: one relayout when it settles
    R._touchRelayT = setTimeout(() => { try { window.dispatchEvent(new Event("resize")); } catch (e) {} }, 150);
    if (W.events) W.events.emit("touchSettings");
  };
  h("div", { fontSize: "15px", fontWeight: "800", marginTop: "4px" }, "TOUCH CONTROLS", box).className = "lc-touch-only";
  const tRow = (label, opts, cur, set) => {
    const row2 = h("div", { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }, null, box);
    row2.className = "lc-touch-only";
    h("div", { fontSize: "13px", opacity: "0.8", width: "160px" }, label, row2);
    opts.forEach((o) => {
      const on = cur === o[1];
      const b = h("button", Object.assign({}, BTN, {
        padding: "7px 16px", fontSize: "13px",
        background: on ? "#57b0ff" : "rgba(255,255,255,0.1)", color: on ? "#fff" : "#cfe4ff",
      }), o[0], row2);
      b.onclick = () => { set(o[1]); touchChanged(); showSettings(W); };
    });
  };
  const tsNow = +W.settings.touchScale > 0 ? +W.settings.touchScale : 1;
  tRow("Button size", [["S", 0.85], ["M", 1], ["L", 1.2]], tsNow <= 0.9 ? 0.85 : tsNow > 1.1 ? 1.2 : 1, (v) => { W.settings.touchScale = v; });
  tRow("Left-handed", [["OFF", false], ["ON", true]], W.settings.touchLeftHanded === true, (v) => { W.settings.touchLeftHanded = v; });
  tRow("Aim assist", [["OFF", false], ["ON", true]], W.settings.aimAssist !== false, (v) => { W.settings.aimAssist = v; });
  tRow("Vibration", [["OFF", false], ["ON", true]], W.settings.haptics !== false, (v) => { W.settings.haptics = v; });
  const tsens = +W.settings.touchSens > 0 ? +W.settings.touchSens : 1;
  slider(box, "Look sensitivity", (Math.max(0.3, Math.min(3, tsens)) - 0.3) / 2.7,
    (v) => { W.settings.touchSens = Math.round((0.3 + v * 2.7) * 100) / 100; touchChanged(); },
    { min: 0, fmt: (v) => (0.3 + v * 2.7).toFixed(1) + "x" }).className = "lc-touch-only";
  const topa = +W.settings.touchOpacity > 0 ? +W.settings.touchOpacity : 0.75;
  slider(box, "Button opacity", (Math.max(0.35, Math.min(1, topa)) - 0.35) / 0.65,
    (v) => { W.settings.touchOpacity = Math.round((0.35 + v * 0.65) * 100) / 100; touchChanged(); },
    { min: 0, fmt: (v) => Math.round((0.35 + v * 0.65) * 100) + "%" }).className = "lc-touch-only";

  // graphics
  const gRow = h("div", { display: "flex", gap: "8px", alignItems: "center" }, null, box);
  h("div", { fontSize: "13px", opacity: "0.8", width: "160px" }, "Graphics", gRow);
  ["low", "medium", "high"].forEach((g2) => {
    const b = h("button", Object.assign({}, BTN, { padding: "7px 16px", fontSize: "13px", background: W.settings.graphics === g2 ? "#57b0ff" : "rgba(255,255,255,0.1)", color: W.settings.graphics === g2 ? "#fff" : "#cfe4ff" }), g2.toUpperCase(), gRow);
    b.onclick = () => { W.settings.graphics = g2; applyGraphics(W); save(W); showSettings(W); };
  });

  // FOV: hardcoded at 57 (70 sprinting) with no control, in a genre where an FOV
  // slider is table stakes AND a motion-sickness accommodation.
  // The label read "20%" for the 57° default (the shared slider printed the
  // 0..1 position): it is an angle, so it says one.
  slider(box, "Field of view", (( W.settings.fov || 57) - 50) / 35, (v) => {
    W.settings.fov = Math.round(50 + v * 35);   // 50–85
    save(W);
  }, { fmt: (v) => Math.round(50 + v * 35) + "°" });
  // Sprint and ADS were hold-only. Toggle is an accessibility need, not a taste.
  // live binding in the label, not a hardcoded SHIFT — Sprint is rebindable
  // four rows down and the label lied after a rebind (sweep finding)
  [["Sprint (" + ((() => { const ph = physFor(W, "ShiftLeft"); return ph ? keyLabel(ph) : "SHIFT"; })()) + ")", "sprintToggle"], ["Aim down sights", "adsToggle"]].forEach((e) => {
    const row2 = h("div", { display: "flex", gap: "8px", alignItems: "center" }, null, box);
    row2.className = "kbd-hint";       // keyboard / mouse behaviour; touch ADS is always a toggle
    h("div", { fontSize: "13px", opacity: "0.8", width: "160px" }, e[0], row2);
    [["HOLD", false], ["TOGGLE", true]].forEach((o) => {
      const on = !!W.settings[e[1]] === o[1];
      const b = h("button", Object.assign({}, BTN, {
        padding: "7px 16px", fontSize: "13px",
        background: on ? "#57b0ff" : "rgba(255,255,255,0.1)", color: on ? "#fff" : "#cfe4ff",
      }), o[0], row2);
      b.onclick = () => { W.settings[e[1]] = o[1]; save(W); showSettings(W); };
    });
  });

  // Screen shake (W.camShake, consumed by the camera in player.js) had no control
  // at all. Motion sensitivity is the same accommodation the FOV slider above
  // answers, and it is the one effect a player cannot opt out of by looking away.
  const shRow = h("div", { display: "flex", gap: "8px", alignItems: "center" }, null, box);
  h("div", { fontSize: "13px", opacity: "0.8", width: "160px" }, "Screen shake", shRow);
  [["OFF", 0], ["HALF", 0.5], ["FULL", 1]].forEach((o) => {
    const on = (W.settings.shake == null ? 1 : W.settings.shake) === o[1];
    const b = h("button", Object.assign({}, BTN, {
      padding: "7px 16px", fontSize: "13px",
      background: on ? "#57b0ff" : "rgba(255,255,255,0.1)", color: on ? "#fff" : "#cfe4ff",
    }), o[0], shRow);
    b.onclick = () => { W.settings.shake = o[1]; save(W); showSettings(W); };
  });

  // Sound indicators — the screen-edge footstep/gunfire/damage ring was hard-on
  // with nothing behind it. Opt-OUT rather than opt-in (Fortnite ships Visualize
  // Sound Effects opt-in) because it has always been on here and removing it by
  // default would be a regression against today.
  const svRow = h("div", { display: "flex", gap: "8px", alignItems: "center" }, null, box);
  h("div", { fontSize: "13px", opacity: "0.8", width: "160px" }, "Sound indicators", svRow);
  [["OFF", false], ["ON", true]].forEach((o) => {
    const on = (W.settings.soundVis !== false) === o[1];
    const b = h("button", Object.assign({}, BTN, {
      padding: "7px 16px", fontSize: "13px",
      background: on ? "#57b0ff" : "rgba(255,255,255,0.1)", color: on ? "#fff" : "#cfe4ff",
    }), o[0], svRow);
    b.onclick = () => { W.settings.soundVis = o[1]; save(W); showSettings(W); };
  });

  // performance readout — a browser game runs on unknown hardware, so "is it me
  // or is it the game" needs an answer the player can read
  const pRow = h("div", { display: "flex", gap: "8px", alignItems: "center" }, null, box);
  h("div", { fontSize: "13px", opacity: "0.8", width: "160px" }, "Performance readout", pRow);
  [["OFF", false], ["ON", true]].forEach((o) => {
    const on = !!W.settings.showPerf === o[1];
    const b = h("button", Object.assign({}, BTN, {
      padding: "7px 16px", fontSize: "13px",
      background: on ? "#57b0ff" : "rgba(255,255,255,0.1)", color: on ? "#fff" : "#cfe4ff",
    }), o[0], pRow);
    b.onclick = () => {
      W.settings.showPerf = o[1];
      if (R.perf) R.perf.style.display = o[1] ? "block" : "none";
      save(W); showSettings(W);
    };
  });

  // keybinds
  h("div", { fontSize: "15px", fontWeight: "800", marginTop: "8px" }, "KEYBINDS (click to rebind)", box).className = "kbd-hint";
  const kGrid = h("div", { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px" }, null, box);
  kGrid.className = "kbd-hint";
  for (const [label, canonical] of ACTIONS) {
    const row = h("div", { display: "flex", justifyContent: "space-between", alignItems: "center" }, null, kGrid);
    h("div", { fontSize: "13px", opacity: "0.8" }, label, row);
    // current physical key for this action — UNBOUND if its default was released
    const phys = physFor(W, canonical);
    const kb = h("button", Object.assign({}, BTN, { padding: "4px 12px", fontSize: "12px", background: "rgba(255,255,255,0.12)", color: phys ? "#dfeaff" : "#ffb3a7", minWidth: "84px" }), phys ? keyLabel(phys) : "—", row);
    kb.onclick = () => {
      kb.textContent = "press key… (Esc = cancel)";
      W.captureKey = (code) => {
        W.captureKey = null;
        const restore = () => { kb.textContent = phys ? keyLabel(phys) : "—"; };
        if (code === "Escape") { restore(); return; }   // cancel, don't bind to Esc
        const rm = W.settings.remap = W.settings.remap || {};
        // Which action does the chosen key drive right now? canon() falls
        // through to identity, so an unmapped key drives its own default.
        const owner = rm[code] !== undefined ? rm[code] : code;
        if (owner !== canonical && owner !== UNBOUND && ACTIONS.some((a) => a[1] === owner)) {
          // Refuse instead of silently stealing it: rebinding Forward onto D used
          // to kill strafe-right while its row still proudly displayed "D".
          const other = ACTIONS.find((a) => a[1] === owner);
          kb.textContent = "already: " + other[0];
          setTimeout(restore, 1400);
          return;
        }
        for (const k3 in rm) if (rm[k3] === canonical) delete rm[k3];
        delete rm[code];
        if (code === canonical) {
          delete rm[canonical];                  // back to its own default
        } else {
          rm[code] = canonical;
          rm[canonical] = UNBOUND;               // RELEASE the old default: without
          // this, canon() identity-mapped it and BOTH keys fired the action
          // (rebind Map to Q and M kept opening the map forever).
        }
        save(W);
        showSettings(W);                          // repaint every row's truth
      };
    };
  }

  const resetRow = h("div", { display: "flex", justifyContent: "flex-end", marginTop: "4px" }, null, box);
  resetRow.className = "kbd-hint";
  const resetB = h("button", Object.assign({}, BTN, { padding: "5px 14px", fontSize: "12px" }), "RESET TO DEFAULTS", resetRow);
  resetB.onclick = () => { W.settings.remap = {}; save(W); showSettings(W); };

  // LOCAL career transfer code. Progress is localStorage-only, so clearing site
  // data wipes the career and nothing crosses browsers. Real cross-device sync
  // needs a backend and is flagged for the owner; a copyable code covers the two
  // cases a browser player actually hits — clearing site data, and moving to
  // another browser on the same machine — with no network call, no account and
  // no identifier generated or transmitted.
  h("div", { fontSize: "15px", fontWeight: "800", marginTop: "8px" }, "CAREER TRANSFER CODE", box);
  const xRow = h("div", { display: "flex", gap: "8px", alignItems: "center" }, null, box);
  const xInp = h("input", {
    flex: "1", padding: "6px 9px", borderRadius: "8px", background: "rgba(0,0,0,0.4)",
    border: "1px solid rgba(255,255,255,0.2)", color: "#cfe4ff", fontSize: FS(11),
    fontFamily: "ui-monospace, Consolas, monospace",
  }, null, xRow);
  xInp.type = "text"; xInp.placeholder = "EXPORT to generate · paste a code and IMPORT to restore";
  const xMsg = h("div", { fontSize: FS(11.5), opacity: "0.75", fontFamily: "Rajdhani, " + FONT, minHeight: "15px" }, "", box);
  const expB = h("button", Object.assign({}, BTN, { padding: "5px 14px", fontSize: "12px" }), "EXPORT", xRow);
  expB.onclick = () => {
    try {
      if (!localStorage.getItem("lc_progress")) { xMsg.textContent = "No career to export yet — finish a match first."; return; }
      xInp.value = btoa(JSON.stringify({
        p: localStorage.getItem("lc_progress"),
        d: localStorage.getItem("lc_daily"),
        s: localStorage.getItem("lc_skin"),
      }));
      xInp.select();
      xMsg.textContent = "Copy this code and keep it somewhere safe.";
    } catch (e) { xMsg.textContent = "This browser would not produce a code."; }
  };
  const impB = h("button", Object.assign({}, BTN, { padding: "5px 14px", fontSize: "12px" }), "IMPORT", xRow);
  impB.onclick = () => {
    // Validate the SHAPE. A bad paste has to produce a message — never a thrown
    // exception, and never a wiped career.
    let blob = null, prog = null;
    try { blob = JSON.parse(atob(String(xInp.value).trim())); } catch (e) { blob = null; }
    try { prog = JSON.parse((blob && blob.p) || "null"); } catch (e) { prog = null; }
    if (!prog || typeof prog.level !== "number" || typeof prog.xp !== "number" || !prog.career || typeof prog.career !== "object") {
      xMsg.textContent = "That is not a Last Circle career code.";
      return;
    }
    try {
      localStorage.setItem("lc_progress", blob.p);
      if (blob.d) localStorage.setItem(DAILY_KEY, blob.d);
      if (blob.s) localStorage.setItem("lc_skin", blob.s);
    } catch (e) { xMsg.textContent = "This browser refused to store the career."; return; }
    W.progress = loadProgress();
    W.daily = loadDaily();      // re-validated, so an imported stale day rolls over
    xMsg.textContent = "Career restored — LVL " + W.progress.level + " · " + rankLabel(W.progress.level) + ". The menu updates when you close settings.";
  };

  const closeB = h("button", Object.assign({}, BTN, { background: "#57b0ff", color: "#fff", marginTop: "10px" }), "DONE", box);
  closeB.onclick = () => closeSettings(W);
  if (prevScroll) box.scrollTop = prevScroll;
}
// ═══ SETTINGS (P2-G: LC-46 tabs + rebinds, C-GFX Video tab, LC-69 Audio tab, LC-43 Accessibility) ═══════════
// One modal, five tabs: GAME / VIDEO / AUDIO / CONTROLS / ACCESSIBILITY. Every panel is BUILT on every render and the
// inactive ones are display:none, so a row's text exists whichever tab is open (layoutcheck reads the FOV row's "57°").
// The 17-row keybind grid used to push the whole modal to 1150 px inside a 588 px box (parity audit LC-46); only the
// CONTROLS tab can scroll now. On TOUCH this panel is never built: showSettingsTouch (above) is the int-p1 panel (D9).
const SET_TABS = [["game", "GAME"], ["video", "VIDEO"], ["audio", "AUDIO"], ["controls", "CONTROLS"], ["access", "ACCESSIBILITY"]];
let _setTab = "game";
function ensureSetStyles() {
  if (document.getElementById("lc-set-css")) return;
  const st = document.createElement("style");
  st.id = "lc-set-css";
  st.textContent = `
.lc-tabs { display: flex; gap: 4px; flex-wrap: wrap; flex-shrink: 0; border-bottom: 1px solid rgba(140,200,255,.16); padding-bottom: 8px; }
.lc-tab { font-family: ${FONT}; font-weight: 800; font-size: 12px; letter-spacing: 1.4px; padding: 7px 13px; border-radius: 9px; cursor: pointer;
  border: 1px solid rgba(140,200,255,.18); background: rgba(255,255,255,.05); color: #cfe4ff; }
.lc-tab:hover { background: rgba(255,255,255,.10); }
.lc-tab.on { background: #57b0ff; color: #fff; border-color: #8fd0ff; }
.lc-setbody { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding-right: 6px; }
.lc-tabp { display: none; flex-direction: column; gap: 9px; }
.lc-tabp.on { display: flex; }
html.lc-touch .lc-tabs { display: none; }
html.lc-touch .lc-tabp { display: flex; margin-bottom: 9px; }
.lc-srow { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.lc-slab { font-size: 13px; opacity: .8; width: 160px; flex-shrink: 0; }
.lc-sopt { padding: 6px 13px !important; font-size: 12.5px !important; }
.lc-shead { font-size: 13px; font-weight: 800; letter-spacing: 1.5px; color: #9fd7ff; margin-top: 2px; }
.lc-snote { font-size: ${FS(11)}; opacity: .62; font-family: Rajdhani, ${FONT}; margin-top: -4px; line-height: 1.35; }
`;
  document.head.appendChild(st);
}
function showSettings(W, tab) {
  if (touchOn) return showSettingsTouch(W);   // D9: phones get the int-p1 panel, unchanged
  releaseCursor(W);
  W.captureKey = null;   // drop any armed keybind capture when (re)rendering the modal
  if (tab && SET_TABS.some((t) => t[0] === tab)) _setTab = tab;
  // Every option button and each successful rebind re-enter this function, which tears the panel down and builds a fresh
  // one, so the scroll offset of the open tab is carried across the rebuild (the keybind grid used to throw you back up).
  const prevScroll = (R.settings && R._setBody && R._setBodyTab === _setTab) ? R._setBody.scrollTop : 0;
  if (R.settings) { R.settings.remove(); R.settings = null; }
  ensureAAAStyles(); ensureSetStyles();
  const L = layer("settings", { pointerEvents: "auto", background: "rgba(4,8,16,0.9)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 });
  const box = h("div", Object.assign({
    // one fixed height for every tab, so switching tabs never makes the card jump (only CONTROLS scrolls inside it)
    padding: "22px 30px 16px", width: "640px", maxWidth: "calc(100vw - 96px)", height: "min(calc(100vh - 48px), 600px)", boxSizing: "border-box",
    display: "flex", flexDirection: "column", gap: "10px",
  }, PANEL), null, L);
  box.dataset.lc = "settings";
  h("div", { fontSize: "22px", fontWeight: "900", letterSpacing: "2px", flexShrink: "0" }, "SETTINGS", box);
  const tabs = h("div", null, null, box); tabs.className = "lc-tabs"; tabs.dataset.lc = "settabs";
  for (const [id, name] of SET_TABS) {
    const b = h("button", null, name, tabs);
    b.className = "lc-tab" + (id === _setTab ? " on" : ""); b.dataset.tab = id;
    b.onclick = () => { W.events && W.events.emit("uiClick"); showSettings(W, id); };
  }
  const body = h("div", null, null, box); body.className = "lc-setbody"; body.dataset.lc = "setbody";
  R._setBody = body; R._setBodyTab = _setTab;
  const P = {};
  for (const [id] of SET_TABS) {
    const p = h("div", null, null, body); p.className = "lc-tabp" + (id === _setTab ? " on" : ""); p.dataset.tab = id;
    P[id] = p;
  }
  const kbd = (el) => { el.className = (el.className ? el.className + " " : "") + "kbd-hint"; return el; };
  const touchOnly = (el) => { el.className = (el.className ? el.className + " " : "") + "lc-touch-only"; return el; };
  const rerender = () => showSettings(W);
  // a row of choice buttons; `cur` is matched with ===
  const optRow = (panel, label, opts, cur, pick, lcName) => {
    const row = h("div", null, null, panel); row.className = "lc-srow";
    if (lcName) row.dataset.lc = "set-" + lcName;
    h("div", null, label, row).className = "lc-slab";
    for (const o of opts) {
      const on = cur === o[1];
      const b = h("button", Object.assign({}, BTN, {
        background: on ? "#57b0ff" : "rgba(255,255,255,0.1)", color: on ? "#fff" : "#cfe4ff",
      }), o[0], row);
      b.classList.add("lc-sopt");
      if (o[2]) b.classList.add(o[2]);
      b.dataset.v = String(o[1]);
      b.onclick = () => { pick(o[1]); };
    }
    return row;
  };
  const head = (panel, text) => h("div", null, text, panel).className = "lc-shead";
  const note = (panel, text) => { const n = h("div", null, text, panel); n.className = "lc-snote"; return n; };
  const gfx = (key, val) => {
    if (!W.setGfx) return false;
    try { W.setGfx(key, val); return true; } catch (e) { R._setMsg = String((e && e.message) || e); return false; }
  };

  // ─── GAME ───────────────────────────────────────────────────────────────────────────────────
  {
    const G = P.game;
    // Every kill-feed line, the lobby cell and the name tags read actor.name; wired on change/blur (never per keystroke:
    // the modal rebuilds itself and would lose focus mid-word). player.js ignores keydown on INPUT targets.
    const nRow = h("div", null, null, G); nRow.className = "lc-srow";
    h("div", null, "Player name", nRow).className = "lc-slab";
    const nInp = h("input", {
      flex: "1", padding: "7px 10px", borderRadius: "8px", background: "rgba(0,0,0,0.4)",
      border: "1px solid rgba(255,255,255,0.2)", color: "#eaf2ff", fontWeight: "700", fontFamily: "Rajdhani, " + FONT,
    }, null, nRow);
    nInp.type = "text"; nInp.maxLength = 14; nInp.placeholder = "You";
    nInp.value = (W.settings.playerName && W.settings.playerName !== "You") ? W.settings.playerName : "";
    const commitName = () => {
      const clean = String(nInp.value).replace(/[^A-Za-z0-9_\-. ]/g, "").replace(/\s+/g, " ").trim().slice(0, 14);
      nInp.value = clean;
      W.settings.playerName = clean || "You";
      save(W);
    };
    nInp.onchange = commitName;
    nInp.onblur = commitName;
    note(G, "Applies from the next match.");   // the name is baked into the actor at match start

    // TOUCH CONTROLS (touch.js, lane L10, reads these) - shown only in touch mode, exactly as before
    const touchChanged = () => {
      save(W); syncTouchPrefs(W);
      clearTimeout(R._touchRelayT);   // a slider drag fires per pixel: one relayout when it settles
      R._touchRelayT = setTimeout(() => { try { window.dispatchEvent(new Event("resize")); } catch (e) {} }, 150);
      if (W.events) W.events.emit("touchSettings");
    };
    touchOnly(h("div", { fontSize: "15px", fontWeight: "800", marginTop: "4px" }, "TOUCH CONTROLS", G));
    const tRow = (label, opts, cur, set) => touchOnly(optRow(G, label, opts, cur, (v) => { set(v); touchChanged(); rerender(); }));
    const tsNow = +W.settings.touchScale > 0 ? +W.settings.touchScale : 1;
    tRow("Button size", [["S", 0.85], ["M", 1], ["L", 1.2]], tsNow <= 0.9 ? 0.85 : tsNow > 1.1 ? 1.2 : 1, (v) => { W.settings.touchScale = v; });
    tRow("Left-handed", [["OFF", false], ["ON", true]], W.settings.touchLeftHanded === true, (v) => { W.settings.touchLeftHanded = v; });
    tRow("Aim assist", [["OFF", false], ["ON", true]], W.settings.aimAssist !== false, (v) => { W.settings.aimAssist = v; });
    tRow("Vibration", [["OFF", false], ["ON", true]], W.settings.haptics !== false, (v) => { W.settings.haptics = v; });
    const tsens = +W.settings.touchSens > 0 ? +W.settings.touchSens : 1;
    touchOnly(slider(G, "Look sensitivity", (Math.max(0.3, Math.min(3, tsens)) - 0.3) / 2.7,
      (v) => { W.settings.touchSens = Math.round((0.3 + v * 2.7) * 100) / 100; touchChanged(); },
      { min: 0, fmt: (v) => (0.3 + v * 2.7).toFixed(1) + "x" }));
    const topa = +W.settings.touchOpacity > 0 ? +W.settings.touchOpacity : 0.75;
    touchOnly(slider(G, "Button opacity", (Math.max(0.35, Math.min(1, topa)) - 0.35) / 0.65,
      (v) => { W.settings.touchOpacity = Math.round((0.35 + v * 0.65) * 100) / 100; touchChanged(); },
      { min: 0, fmt: (v) => Math.round((0.35 + v * 0.65) * 100) + "%" }));

    // the screen-edge footstep / gunfire / damage ring (opt-OUT: it has always been on)
    optRow(G, "Sound indicators", [["OFF", false], ["ON", true]], W.settings.soundVis !== false, (v) => { W.settings.soundVis = v; save(W); rerender(); }, "soundvis");
    // "is it me or is it the game": FPS (+ link freshness online)
    optRow(G, "Performance readout", [["OFF", false], ["ON", true]], !!W.settings.showPerf, (v) => {
      W.settings.showPerf = v;
      if (R.perf) R.perf.style.display = v ? "block" : "none";
      save(W); rerender();
    }, "perf");
    // LC-45: the one-time hints (each shows once ever; RESET brings them back, guided practice included)
    const hr = kbd(optRow(G, "Gameplay tips", [["OFF", false], ["ON", true]], W.settings.hints !== false, (v) => { W.settings.hints = v; save(W); rerender(); }, "hints"));
    const hReset = h("button", Object.assign({}, BTN, { background: "rgba(255,255,255,0.06)", color: "#cfe4ff" }), "SHOW AGAIN", hr);
    hReset.classList.add("lc-sopt"); hReset.dataset.lc = "hintsreset";
    hReset.onclick = () => { hintsReset(); R._setMsg = "Tips and the practice guide will show again."; rerender(); };

    // LOCAL career transfer code (progress is localStorage-only; no network, no account, no identifier)
    h("div", { fontSize: "15px", fontWeight: "800", marginTop: "6px" }, "CAREER TRANSFER CODE", G);
    const xRow = h("div", null, null, G); xRow.className = "lc-srow";
    const xInp = h("input", {
      flex: "1", padding: "6px 9px", borderRadius: "8px", background: "rgba(0,0,0,0.4)",
      border: "1px solid rgba(255,255,255,0.2)", color: "#cfe4ff", fontSize: FS(11), fontFamily: "ui-monospace, Consolas, monospace",
    }, null, xRow);
    xInp.type = "text"; xInp.placeholder = "EXPORT to generate · paste a code and IMPORT to restore";
    const xMsg = h("div", { fontSize: FS(11.5), opacity: "0.75", fontFamily: "Rajdhani, " + FONT, minHeight: "15px" }, "", G);
    const expB = h("button", Object.assign({}, BTN, { padding: "5px 14px", fontSize: "12px" }), "EXPORT", xRow);
    expB.onclick = () => {
      try {
        if (!localStorage.getItem("lc_progress")) { xMsg.textContent = "No career to export yet — finish a match first."; return; }
        xInp.value = btoa(JSON.stringify({ p: localStorage.getItem("lc_progress"), d: localStorage.getItem("lc_daily"), s: localStorage.getItem("lc_skin") }));
        xInp.select();
        xMsg.textContent = "Copy this code and keep it somewhere safe.";
      } catch (e) { xMsg.textContent = "This browser would not produce a code."; }
    };
    const impB = h("button", Object.assign({}, BTN, { padding: "5px 14px", fontSize: "12px" }), "IMPORT", xRow);
    impB.onclick = () => {
      // validate the SHAPE: a bad paste produces a message, never an exception and never a wiped career
      let blob = null, prog = null;
      try { blob = JSON.parse(atob(String(xInp.value).trim())); } catch (e) { blob = null; }
      try { prog = JSON.parse((blob && blob.p) || "null"); } catch (e) { prog = null; }
      if (!prog || typeof prog.level !== "number" || typeof prog.xp !== "number" || !prog.career || typeof prog.career !== "object") {
        xMsg.textContent = "That is not a Last Circle career code.";
        return;
      }
      try {
        localStorage.setItem("lc_progress", blob.p);
        if (blob.d) localStorage.setItem(DAILY_KEY, blob.d);
        if (blob.s) localStorage.setItem("lc_skin", blob.s);
      } catch (e) { xMsg.textContent = "This browser refused to store the career."; return; }
      W.progress = loadProgress();
      W.daily = loadDaily();
      xMsg.textContent = "Career restored — LVL " + W.progress.level + " · " + rankLabel(W.progress.level) + ". The menu updates when you close settings.";
    };
  }

  // ─── VIDEO (C-GFX: every row goes through W.setGfx; LOW / MEDIUM / HIGH / ULTRA presets) ────────────
  {
    const V = P.video;
    const tierNow = W.settings.graphics || "medium";
    const pickTier = (t) => {
      if (W.setGfx) {
        if (!gfx("tier", t)) {
          // ULTRA comes with the renderer lane (C-GFX); a build without it says so instead of throwing
          if (t === "ultra") R._setMsg = "ULTRA is not available in this build — HIGH is the top preset here.";
          rerender(); return;
        }
      } else { W.settings.graphics = t; applyGraphics(W); }
      save(W); rerender();
    };
    optRow(V, "Quality preset", [["LOW", "low"], ["MEDIUM", "medium"], ["HIGH", "high"], ["ULTRA", "ultra", "kbd-hint"]], tierNow, pickTier, "tier");
    const gi = W.getGfx ? (() => { try { return W.getGfx(); } catch (e) { return null; } })() : null;
    const pf = (gi && gi.prefs) || (W.settings.gfx || {});
    if (gi) {
      const ap = gi.applied || {}, lv = gi.live || {};
      const bits = [String(gi.tier || tierNow).toUpperCase()];
      bits.push("AA " + String(lv.aa && lv.aa !== "off" ? lv.aa : (ap.aa || "off")).toUpperCase());
      bits.push("bloom " + (lv.bloom ? "on" : "off"));
      if (lv.dpr) bits.push("resolution " + (+lv.dpr).toFixed(2) + "x");
      if (gi.ladder && gi.ladder.on) bits.push("auto quality step " + (gi.ladder.level || 0));
      if (gi.auto && gi.auto.tier) bits.push("first-run pick " + String(gi.auto.tier).toUpperCase());
      const sl = note(V, "In use: " + bits.join("  ·  "));
      kbd(sl); sl.dataset.lc = "gfxstatus"; sl.style.marginTop = "-2px";
    }
    // boot (ship notes): a tier / AA change MID-MATCH compiles programs (the low route rebuild, the composer / SMAA passes) - one
    // hitch on a deliberate choice, none at a fixed tier. Said here so it never reads as the game breaking.
    { const hn = kbd(note(V, "Changing the preset or anti-aliasing during a match rebuilds the shaders once: expect a short one-time hitch.")); hn.dataset.lc = "gfxhitch"; }
    if (W.setGfx) {
      const sg = (k) => (v) => { gfx(k, v); rerender(); };
      kbd(optRow(V, "Anti-aliasing", [["AUTO", "auto"], ["OFF", "off"], ["FXAA", "fxaa"], ["SMAA", "smaa"]], pf.aa || "auto", sg("aa"), "aa"));
      kbd(optRow(V, "Bloom", [["AUTO", "auto"], ["OFF", "off"], ["ON", "on"]], pf.bloom || "auto", sg("bloom"), "bloom"));
      const dprCur = pf.dpr === "auto" || pf.dpr == null ? "auto" : +pf.dpr;
      // above 150 % only ULTRA renders it (C-GFX: full DPR, cap 2), so the 200 % option shows with that preset
      const dprOpts = [["AUTO", "auto"], ["75%", 0.75], ["100%", 1], ["125%", 1.25], ["150%", 1.5]];
      if ((W.gfxTier || tierNow) === "ultra") dprOpts.push(["200%", 2]);
      kbd(optRow(V, "Resolution scale", dprOpts, dprCur, sg("dpr"), "dpr"));
      kbd(optRow(V, "Auto quality", [["OFF", false], ["ON", true]], pf.autoQuality !== false, sg("autoQuality"), "autoq"));
      kbd(note(V, "Auto quality steps bloom and resolution down in a match when frames run long, and back up when they recover. It never steps up into ULTRA."));
      // rows another lane adds (C-GFX: "every lane that adds a visual feature declares its per-tier behaviour"):
      // W.gfxRows = [{ key, label, opts: [[LABEL, value], ...] }] - each a W.setGfx key; drawn here without a hud change
      if (Array.isArray(W.gfxRows)) for (const gr of W.gfxRows) {
        if (!gr || !gr.key || !Array.isArray(gr.opts)) continue;
        kbd(optRow(V, String(gr.label || gr.key), gr.opts, pf[gr.key] != null ? pf[gr.key] : gr.opts[0][1], sg(gr.key), "x-" + gr.key));
      }
    }
    // FOV: 50-85 (motion-sickness accommodation); the label is an angle
    slider(V, "Field of view", ((W.settings.fov || 57) - 50) / 35, (v) => {
      W.settings.fov = Math.round(50 + v * 35);
      save(W);
    }, { fmt: (v) => Math.round(50 + v * 35) + "°" });
    if (W.setGfx) {
      const ar = kbd(h("div", null, null, V)); ar.classList.add("lc-srow");
      h("div", null, "First-run detection", ar).className = "lc-slab";
      const rb = h("button", Object.assign({}, BTN, { background: "rgba(255,255,255,0.08)", color: "#cfe4ff" }), "DETECT AGAIN", ar);
      rb.classList.add("lc-sopt"); rb.dataset.lc = "gfxredetect";
      rb.onclick = () => { if (gfx("autoTier", "rerun")) R._setMsg = "The game will measure this PC again on the main menu and pick a preset."; rerender(); };
    }
  }

  // ─── AUDIO (P1-B's settings engine: setVolumes / setOutput / setMix / setMono) ────────────────────
  {
    const A = P.audio;
    slider(A, "Master volume", W.settings.masterVol, (v) => { W.settings.masterVol = v; applyAudio(W); });
    slider(A, "Music volume", W.settings.musicVol, (v) => { W.settings.musicVol = v; applyAudio(W); });
    slider(A, "SFX volume", W.settings.sfxVol, (v) => { W.settings.sfxVol = v; applyAudio(W); });
    const au = (fn, v) => { audioMod().then((m) => { if (m && typeof m[fn] === "function") m[fn](v); save(W); }); };
    kbd(optRow(A, "Output", [["HEADPHONES", "headphones"], ["SPEAKERS", "speakers"]], W.settings.audioOutput === "speakers" ? "speakers" : "headphones",
      (v) => { W.settings.audioOutput = v; au("setOutput", v); rerender(); }, "aout"));
    kbd(note(A, "Headphones uses 3D (HRTF) positioning; speakers uses plain stereo panning, which sounds cleaner over two speakers."));
    kbd(optRow(A, "Mix", [["DEFAULT", "default"], ["FOCUSED", "focused"]], W.settings.audioMix === "focused" ? "focused" : "default",
      (v) => { W.settings.audioMix = v; au("setMix", v); rerender(); }, "amix"));
    kbd(note(A, "Focused turns your own gun, music and ambience down and enemy footsteps up."));
    kbd(optRow(A, "Mono audio", [["OFF", false], ["ON", true]], W.settings.audioMono === true,
      (v) => { W.settings.audioMono = v; au("setMono", v); rerender(); }, "amono"));
  }

  // ─── CONTROLS (sensitivity, hold/toggle, invert, the keybind table) ────────────────────────────────
  {
    const C2 = P.controls;
    kbd(slider(C2, "Mouse sensitivity", W.settings.sensitivity / 2, (v) => { W.settings.sensitivity = v * 2; save(W); }, { min: 0.075 }));   // never 0: that killed mouse-look
    kbd(slider(C2, "ADS sensitivity", W.settings.adsSensitivity / 2, (v) => { W.settings.adsSensitivity = v * 2; save(W); }, { min: 0.075 }));
    // the live binding in the label, not a hardcoded SHIFT - Sprint is rebindable below
    const spK = (() => { const ph = physFor(W, "ShiftLeft"); return ph ? keyLabel(ph) : "SHIFT"; })();
    kbd(optRow(C2, "Sprint (" + spK + ")", [["HOLD", false], ["TOGGLE", true]], !!W.settings.sprintToggle, (v) => { W.settings.sprintToggle = v; save(W); rerender(); }, "sprint"));
    kbd(optRow(C2, "Aim down sights", [["HOLD", false], ["TOGGLE", true]], !!W.settings.adsToggle, (v) => { W.settings.adsToggle = v; save(W); rerender(); }, "ads"));
    // LC-65 (read by player.js mouse-look: W.settings.invertY)
    kbd(optRow(C2, "Invert look up/down", [["OFF", false], ["ON", true]], W.settings.invertY === true, (v) => { W.settings.invertY = v; save(W); rerender(); }, "inverty"));
    kbd(h("div", { fontSize: "15px", fontWeight: "800", marginTop: "6px" }, "KEYBINDS (click to rebind)", C2));
    const kGrid = kbd(h("div", { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 20px" }, null, C2));
    kGrid.dataset.lc = "keybinds";
    for (const [label, canonical] of ACTIONS) {
      const row = h("div", { display: "flex", justifyContent: "space-between", alignItems: "center" }, null, kGrid);
      h("div", { fontSize: "13px", opacity: "0.8" }, label, row);
      const phys = physFor(W, canonical);   // the physical key for this action; null if its default was released
      const kb = h("button", Object.assign({}, BTN, { padding: "4px 12px", fontSize: "12px", background: "rgba(255,255,255,0.12)", color: phys ? "#dfeaff" : "#ffb3a7", minWidth: "84px" }), phys ? keyLabel(phys) : "—", row);
      kb.dataset.act = canonical;
      kb.onclick = () => {
        kb.textContent = "press key… (Esc = cancel)";
        W.captureKey = (code) => {
          W.captureKey = null;
          const restore = () => { kb.textContent = phys ? keyLabel(phys) : "—"; };
          if (code === "Escape") { restore(); return; }   // cancel, don't bind to Esc
          const rm = W.settings.remap = W.settings.remap || {};
          // which action does the chosen key drive right now? (canon() falls through to identity)
          const owner = rm[code] !== undefined ? rm[code] : code;
          if (owner !== canonical && owner !== UNBOUND && ACTIONS.some((a) => a[1] === owner)) {
            // refuse instead of silently stealing it
            const other = ACTIONS.find((a) => a[1] === owner);
            kb.textContent = "already: " + other[0];
            setTimeout(restore, 1400);
            return;
          }
          for (const k3 in rm) if (rm[k3] === canonical) delete rm[k3];
          delete rm[code];
          if (code === canonical) delete rm[canonical];      // back to its own default
          else { rm[code] = canonical; rm[canonical] = UNBOUND; }   // RELEASE the old default, or both keys fire the action
          save(W);
          showSettings(W);                                    // repaint every row's truth
        };
      };
    }
    kbd(note(C2, "Fire and aim stay on the left and right mouse buttons; middle mouse always pings. ESC always pauses."));
    const resetRow = kbd(h("div", { display: "flex", justifyContent: "flex-end", marginTop: "2px" }, null, C2));
    const resetB = h("button", Object.assign({}, BTN, { padding: "5px 14px", fontSize: "12px" }), "RESET TO DEFAULTS", resetRow);
    resetB.onclick = () => { W.settings.remap = {}; save(W); showSettings(W); };
  }

  // ─── ACCESSIBILITY (LC-43) ────────────────────────────────────────────────────────────────────
  {
    const X = P.access;
    const pf = (W.getGfx ? (() => { try { return W.getGfx().prefs; } catch (e) { return null; } })() : null) || W.settings.gfx || {};
    if (W.setGfx) {
      const cb = pf.daltonize || "off";
      kbd(optRow(X, "Colour vision", [["OFF", "off"], ["PROTAN", "protan"], ["DEUTAN", "deutan"], ["TRITAN", "tritan"]], cb,
        (v) => { gfx("daltonize", v); save(W); applyA11y(W); rerender(); }, "cvd"));
      kbd(note(X, "Protan: red-weak · Deutan: green-weak · Tritan: blue-weak. Shifts the colours each one confuses into ones it can tell apart, in the world and in the HUD's enemy, damage and squad colours."));
      if (cb !== "off") kbd(slider(X, "Correction strength", pf.daltonizeAmt != null ? +pf.daltonizeAmt : 1, (v) => {
        clearTimeout(R._cbAmtT);
        R._cbAmtT = setTimeout(() => gfx("daltonizeAmt", Math.round(v * 100) / 100), 120);   // one apply when the drag settles
      }));
    }
    kbd(slider(X, "HUD scale", (hudScaleOf(W, true) - 0.8) / 0.5, (v) => {
      W.settings.hudScale = Math.round((0.8 + v * 0.5) * 20) / 20;   // 80 % .. 130 %, 5 % steps
      save(W); applyHudScale(W);
    }, { min: 0, fmt: (v) => Math.round((0.8 + v * 0.5) * 20) * 5 + "%" }));
    kbd(slider(X, "Brightness", (brightnessOf(W, true) - 0.8) / 0.5, (v) => {
      W.settings.brightness = Math.round((0.8 + v * 0.5) * 100) / 100;   // 80 % .. 130 %
      save(W); applyBrightness(W);
    }, { min: 0, fmt: (v) => Math.round((0.8 + v * 0.5) * 100) + "%" }));
    kbd(optRow(X, "Reduce flashes", [["OFF", false], ["ON", true]], W.settings.flashReduce === true,
      (v) => { W.settings.flashReduce = v; save(W); applyA11y(W); rerender(); }, "flash"));
    kbd(note(X, "Softer damage and low-health flashes, no pulsing health bar, no confetti; explosions flash less."));
    // screen shake (W.camShake, player.js camera) - the one effect you cannot look away from
    optRow(X, "Screen shake", [["OFF", 0], ["HALF", 0.5], ["FULL", 1]], W.settings.shake == null ? 1 : W.settings.shake,
      (v) => { W.settings.shake = v; save(W); rerender(); }, "shake");
  }

  // footer: a status line (a refused option says why) + DONE
  const foot = h("div", { display: "flex", alignItems: "center", gap: "12px", flexShrink: "0", marginTop: "2px" }, null, box);
  const msg = h("div", { flex: "1", fontSize: FS(12), color: "#ffd38a", fontFamily: "Rajdhani, " + FONT, minHeight: "16px" }, R._setMsg || "", foot);
  msg.dataset.lc = "setmsg";
  R._setMsg = null;
  const closeB = h("button", Object.assign({}, BTN, { background: "#57b0ff", color: "#fff" }), "DONE", foot);
  closeB.onclick = () => closeSettings(W);
  if (prevScroll) body.scrollTop = prevScroll;
}
let _audioP = null;
function audioMod() {
  if (!_audioP) _audioP = import("./audio.js" + (new URL(import.meta.url).search || "")).catch(() => null);
  return _audioP;
}
function closeSettings(W) {
  W.captureKey = null;                              // never leave a keybind capture armed
  if (R.settings) { R.settings.remove(); R.settings = null; }
  save(W);
}
function keyLabel(code) { return code.replace("Key", "").replace("Digit", "").replace("Left", " L").replace("Control", "CTRL"); }
/** The live key for a canonical action, as a short label ("E", "SPACE"). */
function keyOf(W, canonical) { const ph = physFor(W, canonical); return ph ? keyLabel(ph).toUpperCase() : "—"; }
function slider(box, label, val, onChange, opts) {
  const row = h("div", { display: "flex", gap: "10px", alignItems: "center" }, null, box);
  h("div", { fontSize: "13px", opacity: "0.8", width: "160px" }, label, row);
  const inp = h("input", { flex: "1" }, null, row);
  inp.type = "range"; inp.min = (opts && opts.min != null) ? opts.min : 0; inp.max = 1; inp.step = 0.01; inp.value = val;
  const fmt = (opts && opts.fmt) || ((v) => Math.round(v * 100) + "%");
  const num = h("div", { fontSize: "12px", width: "40px", textAlign: "right" }, fmt(val), row);
  num.dataset.lc = "slider-" + label.toLowerCase().replace(/[^a-z]+/g, "-");
  inp.oninput = () => { const v = parseFloat(inp.value); onChange(v); num.textContent = fmt(v); };
  return row;
}
function applyAudio(W) {
  save(W);
  import("./audio.js" + (new URL(import.meta.url).search || "")).then((m) => m.setVolumes(W));
}
function applyGraphics(W) {
  // Single source of truth lives on W.applyGraphics (ffg_royale3d.js) so the
  // shell-kernel quality key and the LC graphics key stay unified and the tier
  // drives real fidelity (DPR + shadow res + anisotropy), not just DPR.
  if (W.applyGraphics) W.applyGraphics(W.settings.graphics);
}
function save(W) {
  try { localStorage.setItem("lc_settings", JSON.stringify(W.settings)); } catch (e) {}
}

// ═══ ACCESSIBILITY (P2-G LC-43): HUD scale, brightness, flash reduction, colour-vision HUD palette ════════════
// HUD SCALE keeps every signed-off anchor where it is: each anchored widget gets the CSS `scale` property (it composes with,
// and never overwrites, the inline transforms the HUD already writes) with its transform-origin on the SCREEN corner / edge
// it is anchored to - so a corner widget grows away from its corner, the top-centre stack (compass, storm row, LVL + quest,
// the banner band, the death banner) grows down from the top edge as one group, and the bottom-left stack (vitals + chat)
// grows up from the bottom-left corner as one group. At 100 % nothing is written (the anchor gate's 0 moves holds by
// construction). Desktop only: touch keeps its own layout (TOUCH_CSS) untouched.
// BRIGHTNESS is a CSS filter on the 3D canvas only (the HUD stays as designed), written only when it is not 100 % (the
// compositor's filter pass is paid only by a player who asked for it). FLASH REDUCTION softens the HUD's own flashes and is
// published as W.settings.flashReduce for the effects lanes (explosion flash, muzzle flash).
function hudScaleOf(W, raw) {
  if (touchOn && !raw) return 1;
  const v = +(W && W.settings && W.settings.hudScale);
  return v >= 0.8 && v <= 1.3 ? Math.round(v * 100) / 100 : 1;
}
function brightnessOf(W, raw) {
  if (touchOn && !raw) return 1;
  const v = +(W && W.settings && W.settings.brightness);
  return v >= 0.8 && v <= 1.3 ? Math.round(v * 100) / 100 : 1;
}
function hsEl(el, s, ox, oy) {
  if (!el) return;
  if (s === 1) { if (el.style.scale) { el.style.scale = ""; el.style.transformOrigin = ""; } return; }
  const o = ox + " " + oy;
  if (el.style.transformOrigin !== o) el.style.transformOrigin = o;
  el.style.scale = String(s);
}
/** Scale the anchored HUD widgets (showHUD, Settings, setTouchMode). The band elements are re-origined by placeBand. */
function applyHudScale(W) {
  const s = R.hud ? hudScaleOf(W) : 1;
  R._hs = s;
  if (!R.hud) return s;
  hsEl(R.mmWrap, s, "-14px", "-12px");                                   // top-left
  hsEl(R.compassWrap, s, "0px", "-4px");                                 // top centre (translateX(-50%): x origin 0 = the centre stays put)
  hsEl(R.stormRow, s, "0px", "-56px");
  hsEl(R.meta, s, "0px", "-" + META_TOP + "px");
  hsEl(R.rangePanel, s, "0px", "-10px");
  hsEl(R.feed, s, "calc(100% + 16px)", "-70px");                          // top-right
  hsEl(R.perf, s, "calc(100% + 12px)", "-44px");
  hsEl(R.bars, s, "-18px", "calc(100% + 16px)");                          // bottom-left (vitals, teammate rows inside it)
  hsEl(R.chatLog, s, "-18px", "calc(100% + 128px)");
  hsEl(R.chatRow, s, "-18px", "calc(100% + 104px)");
  hsEl(R.slotCol, s, "calc(100% + 18px)", "calc(100% + 54px)");          // bottom-right
  hsEl(R.chuteBtn, s, "calc(100% + 40px)", "calc(100% + 150px)");
  hsEl(R.wpnPop, s, "0px", "calc(100% + 118px)");                         // bottom centre
  hsEl(R.specBar, s, "0px", "calc(100% + 84px)");
  hsEl(R.guideCard, s, "-14px", "-" + GUIDE_TOP + "px");                  // left edge, under the minimap
  R._bandKey = null; placeBand(true);
  fitHint();
  clearTimeout(R._fitT); R._fitT = setTimeout(fitHint, 1200);   // again once the match HUD has laid out (weapon card, mates)
  return s;
}
function applyBrightness(W) {
  const dom = W && W.kernel && W.kernel.renderer && W.kernel.renderer.domElement;
  if (!dom) return 1;
  const b = brightnessOf(W);
  const f = b === 1 ? "" : "brightness(" + b + ")";
  if (dom.style.filter !== f) dom.style.filter = f;
  return b;
}
// HUD colours a colour-vision deficiency confuses: red enemy / damage cues against green-blue allies. The 3D world is
// corrected by the output pass (W.setGfx "daltonize"); these are the DOM / canvas colours the pass never sees.
const CB_PAL = {
  off:    { enemy: "#ff5a4a", dmg: "#ff5544", down: "#ff4d4d", mates: ["#6ec4ff", "#7cf0a8", "#ff9df0", "#c9a6ff"] },
  protan: { enemy: "#ffb000", dmg: "#ffb000", down: "#ffd23f", mates: ["#4aa8ff", "#c9a6ff", "#ffffff", "#7fe3ff"] },
  deutan: { enemy: "#ff9f1c", dmg: "#ff9f1c", down: "#ffd23f", mates: ["#4aa8ff", "#c9a6ff", "#ffffff", "#7fe3ff"] },
  tritan: { enemy: "#ff3d6e", dmg: "#ff3d6e", down: "#ff3d6e", mates: ["#2fd1c8", "#ff9df0", "#ffffff", "#b5f26b"] },
};
function cbPal(W) {
  const m = W && W.settings && W.settings.gfx && W.settings.gfx.daltonize;
  return CB_PAL[m] || CB_PAL.off;
}
function applyA11y(W) {
  const fr = !!(W && W.settings && W.settings.flashReduce) && !touchOn;
  R._flashRed = fr;
  if (R.root) R.root.classList.toggle("lc-flashred", fr);
  R._cbPal = cbPal(W);
  if (R.pingEls) for (const E of R.pingEls) E.c = "";          // repaint ping colours on the next frame
  if (R.cmpPingEls) for (const C2 of R.cmpPingEls) C2.c = "";
}

// ═══ TEAMS (C-MODE menu + OD-9 teammate status) and KNOCK / REVIVE (C-DBNO hud slice) ═════════════════════════
// Modes (C-MODE): W.match.mode in solo / duo / trio / squad (K.TEAM_SIZE), every actor carries a.teamId (solo: unique).
// The menu's TEAM row picks the size for BATTLE ROYALE and QUICK MATCH (bots fill the team, owner OD-4); PRACTICE is solo.
// OD-9: teammate status lives INSIDE the vitals anchor (no new panel): one chip per mate on a row above your own HP.
// C-DBNO (team modes only, owner OD-3): a lethal hit DOWNS (a.downed, a.downedHp bleed pool 100, a.knocks); the vitals show
// BLEEDING OUT in place of the HP row; a teammate within K.REVIVE_RANGE (2 m) holds E for K.REVIVE_S (5 s) - the prompt is
// "[HOLD E] Revive <name>" on the interact line and the progress is the chest ring, in green. Downed mates get a red cross
// in the world (with distance), on the compass, the minimap and the big map. Events: actorDowned(a, src), reviveStart(r, t),
// reviveCancel(r, t), actorRevived(a, by). Every read is guarded: in solo none of these fields or events exist and
// nothing here is built.
const TEAM_MODES = { solo: 1, duo: 2, trio: 3, squad: 4 };
const TEAM_OPTS = [["solo", "SOLO"], ["duo", "DUOS"], ["trio", "TRIOS"], ["squad", "SQUADS"]];
const TEAM_WORD = { solo: "SOLO", duo: "DUOS", trio: "TRIOS", squad: "SQUADS" };
const REVIVE_RANGE_M = 2;
function teamModeOf(W) {
  const m = W && W.match && W.match.mode;
  if (TEAM_MODES[m]) return m;
  // before the orchestrator publishes W.match.mode (or on a build without it): the menu's pick, if teammates really exist
  const t = W && W.teamMode;
  if (!TEAM_MODES[t] || t === "solo") return "solo";
  return W.player && W.player.teamId != null && matesOf(W, W.player).length ? t : (W.phase === "lobby" ? t : "solo");
}
function reviveS() { return (K && +K.REVIVE_S > 0) ? +K.REVIVE_S : 5; }
function reviveRange() { return (K && +K.REVIVE_RANGE > 0) ? +K.REVIVE_RANGE : REVIVE_RANGE_M; }
/** The actors on `me`'s team (not `me`, not range dummies). Cached per match + focus; teams never change mid-match. */
function matesOf(W, me) {
  if (!me || !me.teamId || !W.actors) return _noMates;      // D4: a team id is a non-empty string
  if (R._matesFor === me && R._matesN === W.actors.length && R._mates) return R._mates;
  const out = [];
  for (const a of W.actors) if (a !== me && a.teamId === me.teamId && !a.isDummy) out.push(a);
  R._matesFor = me; R._matesN = W.actors.length; R._mates = out;
  return out;
}
const _noMates = [];
function ensureTeamStyles() {
  if (document.getElementById("lc-team-css")) return;
  const st = document.createElement("style");
  st.id = "lc-team-css";
  st.textContent = `
.lc-mates { display: flex; gap: 6px; margin-bottom: 7px; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,.09); }
.lc-mate { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 3px; font-family: ${FONT}; }
.lc-mate .mt { display: flex; align-items: center; gap: 5px; min-width: 0; font-weight: 800; font-size: ${FS(11)}; line-height: 13px; color: #eaf2ff; white-space: nowrap; }
.lc-mate .md { width: 7px; height: 7px; border-radius: 2px; flex: none; transform: rotate(45deg); background: var(--mc, #6ec4ff); }
.lc-mate .mn { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.lc-mate .ms { margin-left: auto; flex: none; font-size: ${FS(9.5)}; letter-spacing: .8px; font-weight: 900; }
.lc-mate .mb { position: relative; height: 3px; border-radius: 2px; background: rgba(255,255,255,.14); overflow: hidden; }
.lc-mate .mb i { position: absolute; left: 0; top: 0; bottom: 0; width: 100%; transform-origin: 0 50%; transform: scaleX(0); background: var(--bc, #f3f6fb); }
.lc-mate.dn .mt { color: #ffd0c8; } .lc-mate.dn .ms { color: var(--dn, #ff4d4d); }
.lc-mate.dd { opacity: .38; } .lc-mate.dd .ms { color: #cfd6e2; }
.lc-bleed { display: none; flex-direction: column; gap: 5px; min-height: 36px; justify-content: center; font-family: ${FONT}; }
.lc-bleed .bt { display: flex; align-items: baseline; gap: 8px; font-weight: 900; font-size: 15px; line-height: 17px; letter-spacing: 1.6px; color: var(--dn, #ff4d4d); text-shadow: 0 1px 4px rgba(0,0,0,.7); white-space: nowrap; }
.lc-bleed .bt small { font-size: ${FS(10.5)}; letter-spacing: .8px; font-weight: 800; color: rgba(255,255,255,.7); overflow: hidden; text-overflow: ellipsis; }
.lc-bleed .bb { height: 8px; border-radius: 3px; background: rgba(255,255,255,.14); overflow: hidden; }
.lc-bleed .bb i { display: block; height: 100%; transform-origin: 0 50%; transform: scaleX(1); background: var(--dn, #ff4d4d); transition: transform .2s linear; }
.lc-vit.downed .lc-vtop { display: none; }
.lc-vit.downed .lc-bleed { display: flex; }
.lc-vit.downed.rv .lc-bleed .bt { color: #7cf0a8; } .lc-vit.downed.rv .lc-bleed .bb i { background: #7cf0a8; }
.lc-teamrow { display: flex; gap: 6px; align-items: center; justify-content: center; }
.lc-teamrow .tl { font-family: Orbitron, ${FONT_DISPLAY}; font-size: ${FS(10)}; font-weight: 900; letter-spacing: 2px; color: #9fd0ff; opacity: .75; margin-right: 4px; }
.lc-teamrow button { font-family: Rajdhani, ${FONT}; font-weight: 800; font-size: 12px; letter-spacing: 1.6px; padding: 6px 12px; border-radius: 9px; cursor: pointer;
  border: 1px solid rgba(140,200,255,.22); background: rgba(255,255,255,.05); color: #cfe4ff; }
.lc-teamrow button:hover { background: rgba(255,255,255,.10); }
.lc-teamrow button.on { background: rgba(87,176,255,.85); border-color: #9fd7ff; color: #fff; box-shadow: 0 0 14px rgba(87,176,255,.35); }
.lc-ping.down .dia { width: 18px; height: 18px; transform: none; background: none; border: 0; box-shadow: none; position: relative; }
.lc-ping.down .dia::before, .lc-ping.down .dia::after { content: ""; position: absolute; left: 6px; top: 0; width: 6px; height: 18px; border-radius: 2px;
  background: var(--pc); box-shadow: 0 0 0 1.5px rgba(6,10,18,.85), 0 0 10px var(--pc); }
.lc-ping.down .dia::after { transform: rotate(90deg); }
.lc-ping.down.edge .dia { width: 12px; height: 12px; } .lc-ping.down.edge .dia::before, .lc-ping.down.edge .dia::after { left: 4px; width: 4px; height: 12px; }
`;
  document.head.appendChild(st);
}
/** OD-9: the teammate chips, built inside the vitals box at showHUD (only when there are teammates). */
function buildMates(W) {
  R.mateEls = null;
  const me = W.player;
  const mates = matesOf(W, me);
  if (!R.bars || !mates.length) return;
  ensureTeamStyles();
  const row = h("div", null, null, null); row.className = "lc-mates"; row.dataset.lc = "mates";
  R.bars.insertBefore(row, R.bars.firstChild);
  R.mateEls = mates.slice(0, 3).map((a) => {
    const el = h("div", null, null, row); el.className = "lc-mate"; el.style.setProperty("--mc", mateColor(a.id));
    el.dataset.lc = "mate";
    const t = h("div", null, null, el); t.className = "mt";
    h("span", null, null, t).className = "md";
    const nm = h("span", null, a.name || String(a.id), t); nm.className = "mn";
    const stt = h("span", null, "", t); stt.className = "ms";
    const sb = h("div", null, null, el); sb.className = "mb"; const sf = h("i", null, null, sb); sf.style.setProperty("--bc", "#4aa8ff");
    const hb = h("div", null, null, el); hb.className = "mb"; const hf = h("i", null, null, hb);
    return { a, el, stt, sf, hf, k: "" };
  });
}
/** Teammate chips + the BLEEDING OUT row (4 Hz from update; writes only on change). */
function updateMates(W, p) {
  if (R.mateEls) for (const m of R.mateEls) {
    const a = m.a;
    const st = !a.alive ? "dd" : a.downed ? "dn" : "";
    const hp = a.downed ? Math.max(0, Math.round(+a.downedHp || 0)) : Math.max(0, Math.min(100, Math.round(a.hp || 0)));
    const sh = a.downed ? 0 : Math.max(0, Math.min(100, Math.round(a.shield || 0)));
    const k = st + ":" + hp + ":" + sh;
    if (m.k === k) continue;
    m.k = k;
    m.el.className = "lc-mate" + (st ? " " + st : "");
    m.stt.textContent = st === "dd" ? "OUT" : st === "dn" ? "DOWN" : "";
    m.sf.style.transform = "scaleX(" + (sh / 100).toFixed(2) + ")";
    m.hf.style.transform = "scaleX(" + (hp / 100).toFixed(2) + ")";
    m.hf.style.setProperty("--bc", a.downed ? (R._cbPal || CB_PAL.off).down : hp <= 25 ? "#ff5544" : "#f3f6fb");
  }
  // BLEEDING OUT inside the vitals anchor (C-DBNO): in place of the HP row while the watched actor is downed
  if (!R.bars) return;
  const dn = !!(p && p.alive && p.downed);
  if (dn && !R.bleedRow) {
    ensureTeamStyles();
    const row = h("div", null, null, null); row.className = "lc-bleed"; row.dataset.lc = "bleed";
    const vt = R.bars.querySelector(".lc-vtop");
    R.bars.insertBefore(row, vt || R.bars.firstChild);
    const bt = h("div", null, null, row); bt.className = "bt";
    R.bleedTitle = h("span", null, "BLEEDING OUT", bt);
    R.bleedSub = h("small", null, "", bt);
    const bb = h("div", null, null, row); bb.className = "bb";
    R.bleedFill = h("i", null, null, bb);
    R.bleedRow = row; R._bleedK = "";
  }
  if (!R.bleedRow) return;
  const rv = dn && R._revive && R._revive.target === p ? R._revive : null;
  let frac = 0, title = "", sub = "";
  if (dn) {
    if (rv) {
      frac = reviveFrac(W, rv);
      title = "BEING REVIVED"; sub = rv.reviver && rv.reviver.name ? rv.reviver.name.toUpperCase() : "";
    } else {
      frac = Math.max(0, Math.min(1, (+p.downedHp || 0) / 100));
      title = "BLEEDING OUT";
      sub = p === W.player ? (matesOf(W, p).some((m) => m.alive && !m.downed) ? "WAIT FOR A REVIVE" : "NO TEAMMATE LEFT") : (p.name || "").toUpperCase();
    }
  }
  const k = (dn ? 1 : 0) + ":" + (rv ? 1 : 0) + ":" + Math.round(frac * 100) + ":" + sub;
  if (R._bleedK === k) return;
  R._bleedK = k;
  R.bars.classList.toggle("downed", dn);
  R.bars.classList.toggle("rv", !!rv);
  R.bars.style.setProperty("--dn", (R._cbPal || CB_PAL.off).down);
  if (R.wCard) R.wCard.style.opacity = dn ? "0.35" : "";       // a downed player cannot shoot (C-DBNO)
  R.bleedTitle.textContent = title; R.bleedSub.textContent = sub;
  R.bleedFill.style.transform = "scaleX(" + frac.toFixed(3) + ")";
}
/** 0..1 of a revive channel: lane player's W.reviveProgress(reviver) = { target, t: seconds held, of: K.REVIVE_S } when it
 *  exists (exact, pauses with the channel), else the reviveStart event's clock. */
function reviveFrac(W, rv) {
  const q = typeof W.reviveProgress === "function" && rv.reviver ? W.reviveProgress(rv.reviver) : null;
  const f = q && +q.of > 0 ? (+q.t || 0) / +q.of : (W.t - rv.t0) / reviveS();
  return Math.max(0, Math.min(1, f));
}
/** The nearest downed teammate the local player can revive right now (C-DBNO: alive, not downed, within 2 m). */
function reviveTarget(W) {
  const me = W.player;
  if (!me || !me.alive || me.downed) return null;
  const mates = matesOf(W, me);
  if (!mates.length) return null;
  let best = null, bd = reviveRange() + 0.25;
  for (const a of mates) {
    if (!a.alive || !a.downed) continue;
    const d = Math.hypot(a.pos.x - me.pos.x, a.pos.z - me.pos.z);
    if (d < bd && Math.abs(a.pos.y - me.pos.y) < 1.6) { bd = d; best = a; }
  }
  return best;
}
/** C-DBNO events (once per page, from wireEvents). */
function wireTeamEvents(W) {
  W.events.on("reviveStart", (reviver, target) => {
    if (!W.player || (reviver !== W.player && target !== W.player && !(target && matesOf(W, W.player).includes(target)))) return;
    R._revive = { reviver, target, t0: W.t };
  });
  W.events.on("reviveCancel", (reviver, target) => { if (R._revive && (!reviver || R._revive.reviver === reviver) && (!target || R._revive.target === target)) R._revive = null; });
  W.events.on("actorRevived", (a, by) => {
    if (R._revive && R._revive.target === a) R._revive = null;
    if (!W.player || !R.hud) return;
    if (a === W.player) announce("REVIVED", by && by.name ? "BY " + by.name.toUpperCase() : "BACK IN THE FIGHT", "#7cf0a8", 1800, ANN_PRIO.elim);
    else if (matesOf(W, W.player).includes(a)) flashMsg((by === W.player ? "YOU REVIVED " : "REVIVED  ") + (a.name || "").toUpperCase());
  });
  W.events.on("actorDowned", (a, src) => {
    if (!W.player || !R.hud || !a) return;
    const srcId = src && typeof src === "object" ? src.id : src;
    if (a === W.player) {
      if (R.hurtTint) { R.hurtTint.style.transition = "opacity .07s ease-out"; R.hurtTint.style.opacity = (W.settings && W.settings.flashReduce) ? "0.35" : "1"; }
      hintFire(W, "downed");
    } else if (matesOf(W, W.player).includes(a)) {
      flashMsg((a.name || "TEAMMATE").toUpperCase() + " IS DOWN — REVIVE THEM", 3200);
      hintFire(W, "revive");
    } else if (srcId && srcId === W.player.id) {
      // your knock: the kill feed says KNOCKED (the elimination row comes when they bleed out or are finished)
      feedRow(W.player.name, a.name + "  ·  KNOCKED", null, true);
      announce("KNOCKED " + (a.name || "").toUpperCase(), "FINISH THEM OR THEIR TEAM REVIVES THEM", "#ffb36a", 1500, ANN_PRIO.milestone);
    }
  });
}
/** World / compass markers for downed teammates (every frame, at most 3 projections). Uses the ping pip pool's look. */
function stepDownMarkers(W, p, hdg) {
  if (!R.downEls) return;
  const mates = matesOf(W, W.player);
  const cam = W.camera || (W.kernel && W.kernel.camera);
  viewSize(W);
  const sw = _vw, sh = _vh, col = (R._cbPal || CB_PAL.off).down;
  let i = 0;
  for (const a of mates) {
    if (i >= R.downEls.length) break;
    if (!a.alive || !a.downed || a === p) continue;
    const E = R.downEls[i], C2 = R.cmpDownEls[i];
    i++;
    const d = Math.round(Math.hypot(a.pos.x - p.pos.x, a.pos.y - p.pos.y, a.pos.z - p.pos.z));
    let sx = sw / 2, sy = sh / 2, edge = false, ang = 0;
    if (cam) {
      _pv.set(a.pos.x, a.pos.y + 1.1, a.pos.z).project(cam);
      const behind = _pv.z > 1;
      let nx = _pv.x, ny = _pv.y;
      if (behind) { nx = -nx; ny = -ny; }
      if (behind || nx < -0.86 || nx > 0.86 || ny < -0.86 || ny > 0.86) {
        edge = true;
        if (behind && Math.abs(nx) < 1e-3 && Math.abs(ny) < 1e-3) ny = -1;
        ang = Math.atan2(nx * sw, ny * sh);
        const rx = Math.min(sw * 0.36, sh * 0.62), ry = sh * 0.25;
        sx = sw / 2 + Math.sin(ang) * rx; sy = sh / 2 - Math.cos(ang) * ry;
      } else { sx = (nx * 0.5 + 0.5) * sw; sy = (-ny * 0.5 + 0.5) * sh; }
    }
    if (!E.on) { E.el.style.display = "block"; E.on = true; }
    if (E.c !== col) { E.el.style.setProperty("--pc", col); E.c = col; }
    const txt = (a.name || "").toUpperCase().slice(0, 12) + "  " + d + " m";
    if (E.t !== txt) { E.lbl.textContent = txt; E.t = txt; }
    if (E.edge !== edge) { E.el.classList.toggle("edge", edge); E.edge = edge; }
    E.el.style.transform = "translate(-50%," + (edge ? "-50%" : "-10px") + ") translate(" + sx.toFixed(0) + "px," + sy.toFixed(0) + "px)";
    if (edge) E.arr.style.transform = "rotate(" + (ang * 180 / Math.PI).toFixed(0) + "deg)";
    const brg = (Math.atan2(a.pos.x - p.pos.x, -(a.pos.z - p.pos.z)) * 180 / Math.PI + 360) % 360;
    let dl = brg - hdg; dl = ((dl + 540) % 360) - 180;
    const cx = Math.round(150 + Math.max(-66, Math.min(66, dl)) * 2.2);
    if (!C2.on) { C2.el.style.display = "block"; C2.on = true; }
    if (C2.c !== col) { C2.el.style.setProperty("--pc", col); C2.c = col; }
    if (C2.x !== cx) { C2.el.style.left = cx + "px"; C2.x = cx; }
  }
  for (; i < R.downEls.length; i++) {
    const E = R.downEls[i], C2 = R.cmpDownEls[i];
    if (E.on) { E.el.style.display = "none"; E.on = false; }
    if (C2.on) { C2.el.style.display = "none"; C2.on = false; }
  }
}
function buildDownMarkers(W) {
  R.downEls = null; R.cmpDownEls = null;
  if (!R.pingLayer || !matesOf(W, W.player).length) return;
  ensureTeamStyles();
  R.downEls = []; R.cmpDownEls = [];
  const cbox = R.pingLayer && R.compassWrap ? R.compassWrap.querySelector('[data-lc="compasspings"]') : null;
  for (let i = 0; i < 3; i++) {
    const el = h("div", null, null, R.pingLayer); el.className = "lc-ping down"; el.dataset.lc = "downmark";
    const arr = h("div", null, null, el); arr.className = "arr";
    const dia = h("div", null, null, el); dia.className = "dia";
    const lbl = h("div", null, "", el); lbl.className = "lbl";
    R.downEls.push({ el, arr, dia, lbl, t: "", c: "", on: false, edge: null });
    const ce = h("div", { borderRadius: "1px" }, null, cbox || R.pingLayer); ce.className = "lc-cping";
    R.cmpDownEls.push({ el: ce, c: "", on: false, x: null });
  }
}

// ═══ ONE-TIME HINTS + GUIDED PRACTICE (P2-G LC-45) ═══════════════════════════════════════════════════════════
// How To Play is one static card. Fortnite / Apex teach in context instead: the first time a situation comes up, one short
// line names the key for it. Each hint here shows ONCE EVER (localStorage lc_hints; Settings > Gameplay tips turns them off
// or brings them back), one at a time, for HINT_MS, on a line above the hotbar that no signed-off widget uses. Keys are the
// LIVE bindings. Desktop only (a phone has its own touch prompts; phones untouched). Not in practice: practice runs the
// guided sequence below instead.
const HINT_MS = 6500;
// Like the first-run auto-tier (P1-C), the hints and the guide stay out of browser automation (navigator.webdriver) unless
// asked for with ?hints=1: every harness gate boots a fresh profile, and a TIP panel appearing over its screenshots would
// move the pixel gates. ?hints=0 turns them off for a player too.
const HINTS_ON = (() => {
  try {
    const q = new URLSearchParams(location.search).get("hints");
    if (q === "1") return true;
    if (q === "0") return false;
    return !navigator.webdriver;
  } catch (e) { return true; }
})();
const HINT_KEY = "lc_hints";
const GUIDE_KEY = "lc_guide_done";
const GUIDE_TOP = 206;                      // px: the guide card's top, under the minimap (top 12 + 180 + gap)
const HINTS = {
  loot:    (W) => "Press " + keyOf(W, "KeyE") + " to pick up loot — a weapon's colour is its rarity.",
  chest:   (W) => "Hold " + keyOf(W, "KeyE") + " at a chest to open it.",
  heal:    (W, x) => "You carry a " + x + ": press its slot key, then FIRE to use it. Switching away cancels it.",
  storm:   () => "You are in the storm. Follow the dashed line on the minimap to the safe zone.",
  reload:  (W) => keyOf(W, "KeyR") + " reloads. Reload behind cover.",
  map:     (W) => keyOf(W, "KeyM") + " opens the map: click to drop a pin, wheel to zoom, drag to pan.",
  ping:    (W) => "Middle mouse or " + keyOf(W, PING_KEY) + " pings what you are aiming at — your squad sees it.",
  throw:   () => "FIRE throws it — the arc under the reticle shows the lob.",
  revive:  (W) => "Your teammate is down! Stand next to them and hold " + keyOf(W, "KeyE") + " to revive.",
  downed:  (W) => "You are down: crawl to cover. A teammate can hold " + keyOf(W, "KeyE") + " next to you to revive you.",
  supply:  () => "Supply drop inbound — legendary loot. Its marker is on your minimap.",
};
let _hintSeen = null;
function hintSeen() {
  if (_hintSeen) return _hintSeen;
  try { _hintSeen = JSON.parse(localStorage.getItem(HINT_KEY) || "{}") || {}; } catch (e) { _hintSeen = {}; }
  return _hintSeen;
}
function hintsReset() {
  _hintSeen = {};
  try { localStorage.removeItem(HINT_KEY); localStorage.removeItem(GUIDE_KEY); } catch (e) {}
}
/** Show hint `id` if it has never been shown. True when it was shown now. */
function hintFire(W, id, arg) {
  if (!HINTS_ON || touchOn || !R.hud || !R.hintEl || !HINTS[id] || !W || (W.settings && W.settings.hints === false)) return false;
  if (W.mode === "practice") return false;
  const seen = hintSeen();
  if (seen[id]) return false;
  if (R._hintUntil && performance.now() < R._hintUntil) return false;   // one at a time: the next one waits for its own moment
  seen[id] = 1;
  try { localStorage.setItem(HINT_KEY, JSON.stringify(seen)); } catch (e) {}
  R.hintTxt.textContent = HINTS[id](W, arg);
  R.hintEl.dataset.id = id;
  fitHint();
  R.hintEl.style.opacity = "1"; R.hintEl.style.display = "flex";
  R._hintUntil = performance.now() + HINT_MS;
  R._hintN = (R._hintN || 0) + 1;
  (R._hintLog = R._hintLog || []).push(id);
  clearTimeout(R._hintT);
  R._hintT = setTimeout(() => { if (R.hintEl) { R.hintEl.style.opacity = "0"; setTimeout(() => { if (R.hintEl && performance.now() >= (R._hintUntil || 0)) R.hintEl.style.display = "none"; }, 400); } }, HINT_MS);
  return true;
}
function buildHints(W) {
  R.hintEl = h("div", {
    position: "absolute", left: "50%", bottom: "160px", transform: "translateX(-50%)", display: "none", alignItems: "center", gap: "10px",
    padding: "7px 16px 7px 10px", borderRadius: "10px", background: "rgba(6,12,24,0.72)", border: "1px solid rgba(255,210,84,0.45)",
    boxShadow: "0 6px 22px rgba(0,0,0,0.45)", fontFamily: "Rajdhani, " + FONT, fontSize: "15px", fontWeight: "700", letterSpacing: "0.4px",
    color: "#f3f7ff", textShadow: "0 1px 3px rgba(0,0,0,0.8)", whiteSpace: "normal", lineHeight: "1.25", boxSizing: "border-box",
    width: "max-content", pointerEvents: "none", opacity: "0", transition: "opacity .35s",
  }, null, R.hud);
  R.hintEl.dataset.lc = "hint";
  h("span", { fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: FS(10), fontWeight: "900", letterSpacing: "1.6px", color: "#1a1204", background: "#ffd254", padding: "3px 7px", borderRadius: "5px" }, "TIP", R.hintEl);
  R.hintTxt = h("span", null, "", R.hintEl);
  R._hintUntil = 0;
  fitHint();
}
// The hint line is centred at bottom 160 px and is NOT HUD-scaled, while the bottom-left vitals stack and the bottom-right weapon card /
// slot column ARE (80-130 %, about their screen corners). Nowrap, the longest hint (about 640 px) ran into the card at 100 % on a 1280 px
// window and 8 of 11 hints did at 130 % (verifier, fix-first). The line now wraps inside the band the anchored panels leave free: its
// max-width is twice the distance from the centre to the nearest side panel whose height range meets the hint's (less a 12 px gap).
// Measured on a hint, a HUD-scale change and a resize only (never per frame).
const HINT_BOTTOM = 160, HINT_BAND = 96;
function fitHint() {
  const el = R.hintEl;
  if (!el || !R.root || !el.isConnected) return;
  const vw = window.innerWidth || 1280, vh = window.innerHeight || 720, cx = vw / 2;
  const bot = vh - HINT_BOTTOM, top = bot - HINT_BAND;
  let half = cx - 12;
  for (const e of R.root.querySelectorAll("[data-lc]")) {
    if (e === el || el.contains(e) || e.contains(el)) continue;
    let p = e.parentElement, nested = false;
    while (p && p !== R.root) { if (p.dataset && p.dataset.lc) { nested = true; break; } p = p.parentElement; }
    if (nested) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom <= top || r.top >= bot) continue;
    if (r.left < cx && r.right > cx) continue;          // a centred element: not a side panel
    const cs = getComputedStyle(e);
    if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) continue;
    const d = r.right <= cx ? cx - r.right : r.left - cx;
    if (d < half) half = d;
  }
  const mw = Math.max(220, Math.floor(2 * (half - 12)));
  const v = mw + "px";
  if (el.style.maxWidth !== v) el.style.maxWidth = v;
}
/** The situations (2 Hz from update). Each test is cheap and reads state the HUD already has. */
function stepHints(W, p, dt) {
  if (!R.hintEl || touchOn || W.mode === "practice" || (W.settings && W.settings.hints === false)) return;
  R._hintAcc = (R._hintAcc || 0) + dt;
  if (R._hintAcc < 0.5) return;
  R._hintAcc = 0;
  const me = W.player;
  if (!me || !me.alive || p !== me || (W.phase !== "match" && W.phase !== "drop")) return;
  const hint = W.interactHint;
  if (hint && hint.type === "chest") { if (hintFire(W, "chest")) return; }
  else if (hint && hint.type !== "revive" && me.onGround) { if (hintFire(W, "loot")) return; }
  if (R._inStorm && me.onGround) { if (hintFire(W, "storm")) return; }
  const wpn = me.weapon, def = wpn && K.WEAPONS[wpn.id];
  if (def && def.mag > 2 && wpn.state !== "reloading" && (wpn.magAmmo | 0) <= Math.floor(def.mag * 0.25) && ((me.inventory && me.inventory.ammo && me.inventory.ammo[def.ammo]) | 0) > 0) {
    if (hintFire(W, "reload")) return;
  }
  if (wpn && String(wpn.id).startsWith("consumable:")) {
    const cid = wpn.id.slice(11), cd = K.CONSUMABLES && K.CONSUMABLES[cid];
    if (cd && cd.throws && hintFire(W, "throw")) return;
  }
  if (me.hp < 70 && !me.healing && me.inventory && me.inventory.slots) {
    const hs = me.inventory.slots.find((s) => s && s.kind === "consumable" && K.CONSUMABLES[s.id] && !K.CONSUMABLES[s.id].throws && (K.CONSUMABLES[s.id].hp > 0 || /bandage|medkit/.test(s.id)));
    if (hs && hintFire(W, "heal", CON_NAME[hs.id] || hs.id)) return;
  }
  if (me.onGround && W.t > 45 && hintFire(W, "map")) return;
  if (me.onGround && W.t > 75 && matesOf(W, me).length && hintFire(W, "ping")) return;
}

// GUIDED PRACTICE: the first time you open PRACTICE a short checklist teaches the verbs on the live range (move, sprint,
// jump, shoot a dummy, aim down sights and hit, reload, switch slot, ping). Each step ticks itself when you do it; the card
// says BASICS DONE and never comes back (lc_guide_done; Settings > Gameplay tips > SHOW AGAIN restores it). Desktop only.
const GUIDE_STEPS = [
  ["move", (W) => "Move — " + keyOf(W, "KeyW") + keyOf(W, "KeyA") + keyOf(W, "KeyS") + keyOf(W, "KeyD")],
  ["sprint", (W) => "Sprint — " + keyOf(W, "ShiftLeft") + ((W.settings && W.settings.sprintToggle) ? " (toggle)" : " (hold)")],
  ["jump", (W) => "Jump — " + keyOf(W, "Space")],
  ["shoot", () => "Shoot a range dummy — LMB"],
  ["ads", () => "Aim down sights and hit one — hold RMB"],
  ["reload", (W) => "Reload — " + keyOf(W, "KeyR")],
  ["slot", (W) => "Switch weapon — " + keyOf(W, "Digit1") + "–" + keyOf(W, "Digit5")],
  ["ping", (W) => "Ping a spot — middle mouse or " + keyOf(W, PING_KEY)],
];
function guideDone() { try { return localStorage.getItem(GUIDE_KEY) === "1"; } catch (e) { return false; } }
function buildGuide(W) {
  R.guideCard = null; R._guide = null;
  if (!HINTS_ON || touchOn || W.mode !== "practice" || guideDone() || (W.settings && W.settings.hints === false)) return;
  const card = h("div", Object.assign({
    position: "absolute", left: "14px", top: GUIDE_TOP + "px", width: "250px", padding: "10px 14px 11px", borderRadius: "12px",
    display: "flex", flexDirection: "column", gap: "5px", fontFamily: "Rajdhani, " + FONT, pointerEvents: "none",
  }, PANEL, { backdropFilter: "none", WebkitBackdropFilter: "none" }), null, R.hud);
  card.dataset.lc = "guide";
  h("div", { fontFamily: "Orbitron, " + FONT_DISPLAY, fontSize: "12px", fontWeight: "900", letterSpacing: "2px", color: "#9fd7ff" }, "PRACTICE · THE BASICS", card);
  const rows = GUIDE_STEPS.map(([id, txt]) => {
    const r = h("div", { display: "flex", alignItems: "center", gap: "8px", fontSize: "13.5px", fontWeight: "700", lineHeight: "17px", color: "#dfeaff", opacity: "0.55", transition: "opacity .2s, color .2s" }, null, card);
    const box = h("span", { width: "13px", height: "13px", flex: "none", borderRadius: "3px", border: "1.5px solid rgba(255,255,255,0.55)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", lineHeight: "1", color: "#0b1424" }, "", r);
    h("span", null, txt(W), r);
    r.dataset.step = id;
    return { id, r, box, done: false };
  });
  R._guideFoot = h("div", { fontSize: FS(11.5), opacity: "0.7", marginTop: "3px" }, "Do each one — it ticks itself.", card);
  R.guideCard = card;
  const p = W.player;
  R._guide = { rows, idx: 0, x0: p ? p.pos.x : 0, z0: p ? p.pos.z : 0, slot0: p && p.inventory ? p.inventory.active : 0, ping0: PINGS.placed,
               sprintT: 0, hit0: (W.stats && W.stats.shotsHit) || 0, done: false, adsHit: false };
  guidePaint();
}
function guidePaint() {
  const G = R._guide; if (!G) return;
  G.rows.forEach((row, i) => {
    const cur = i === G.idx;
    row.r.style.opacity = row.done ? "0.75" : cur ? "1" : "0.5";
    row.r.style.color = row.done ? "#7cf0a8" : cur ? "#ffffff" : "#dfeaff";
    row.box.textContent = row.done ? "✓" : "";
    row.box.style.background = row.done ? "#7cf0a8" : "transparent";
    row.box.style.borderColor = row.done ? "#7cf0a8" : cur ? "#ffd254" : "rgba(255,255,255,0.55)";
  });
}
/** Per frame in practice while the guide is up: tick the current step (and any later step already done). */
function stepGuide(W, p, dt) {
  const G = R._guide;
  if (!G || G.done || !p || p !== W.player || !p.alive) return;
  const done = (id) => {
    switch (id) {
      case "move": return Math.hypot(p.pos.x - G.x0, p.pos.z - G.z0) > 5;
      case "sprint": if (p.sprinting) G.sprintT += dt; return G.sprintT > 0.6;
      case "jump": return !!G.jumped;
      case "shoot": return ((W.stats && W.stats.shotsHit) || 0) > G.hit0 || !!G.hitAny;
      case "ads": return !!G.adsHit;
      case "reload": return !!(p.weapon && p.weapon.state === "reloading") || !!G.reloaded;
      case "slot": return !!p.inventory && p.inventory.active !== G.slot0;
      case "ping": return PINGS.placed > G.ping0;
    }
    return false;
  };
  if (!p.onGround && (p.vel && p.vel.y > 1.5)) G.jumped = true;
  if (p.weapon && p.weapon.state === "reloading") G.reloaded = true;
  let changed = false;
  for (let i = 0; i < G.rows.length; i++) {
    const row = G.rows[i];
    if (!row.done && done(row.id)) { row.done = true; changed = true; }
  }
  while (G.idx < G.rows.length && G.rows[G.idx].done) { G.idx++; changed = true; }
  if (changed) {
    guidePaint();
    W.events && W.events.emit("uiClick");
    if (G.idx >= G.rows.length) {
      G.done = true;
      try { localStorage.setItem(GUIDE_KEY, "1"); } catch (e) {}
      R._guideFoot.textContent = "BASICS DONE — you are ready for a real drop.";
      R._guideFoot.style.color = "#7cf0a8"; R._guideFoot.style.opacity = "1";
      const c = R.guideCard;
      setTimeout(() => { if (c && c.isConnected) { c.style.transition = "opacity .6s"; c.style.opacity = "0"; setTimeout(() => c.remove(), 700); } }, 3500);
    }
  }
}

// ═══ ENEMY NAME TAGS (owner OD-11, parity LC-42) ═════════════════════════════════════════════════════════════
// The HUD owns the reticle, so it owns "aimed at": every 0.1 s the ray through screen centre is tested against the enemy
// capsules (the ping test's geometry) and, for a candidate, against the world with K.aimRayDist (the bullets' own march,
// read-only) - an enemy behind a wall is NEVER named, however well you aim at it. The answer holds AIM_HOLD_S so a tag does
// not strobe on a moving target. nametags.js applies the policy at pack time (see setPolicy there).
const TAG_ENEMY_M = 28, TAG_MATE_M = 250, AIM_TAG_M = 160, AIM_HOLD_S = 0.8;
let _tagsMod = null;
import("./nametags.js" + (new URL(import.meta.url).search || "")).then((m) => { _tagsMod = m; }).catch(() => {});
const _tagPol = { focus: null, enemyM: TAG_ENEMY_M, mateM: TAG_MATE_M, aimedId: null, aimedUntil: 0, now: 0, colorOf: (a) => mateColor(a.id) };
function stepTagPolicy(W, p, dt) {
  if (!_tagsMod || !_tagsMod.setPolicy) return;
  const now = performance.now() / 1000;
  _tagPol.focus = p || null; _tagPol.now = now;
  // 5 Hz on the SAME clock as the hold (wall time): counted in sim dt, a slow frame rate (the dt clamp) stretched the gap
  // between tests past the 0.8 s hold and an aimed tag blinked off between them
  if (!(now - (R._tagLast || 0) < 0.2)) {           // a 0.2 s tag latency, well inside the 0.8 s hold
    R._tagLast = now;
    const a = aimedEnemy(W, p);
    if (a) { _tagPol.aimedId = a.id; _tagPol.aimedUntil = now + AIM_HOLD_S; }
  }
  _tagsMod.setPolicy(_tagPol);
  R._tagPol = _tagPol;                               // test surface (read-only by probes)
}
const _adir = new THREE.Vector3(), _acols = [];
function aimedEnemy(W, p) {
  const me = W.player;
  if (!me || !me.alive || p !== me || !W.map || !K || !K.aimRayDist) return null;   // a spectator does not aim
  const cam = W.camera || (W.kernel && W.kernel.camera);
  if (!cam) return null;
  cam.getWorldDirection(_adir);
  const o = cam.position;
  const denom = _adir.x * _adir.x + _adir.z * _adir.z;
  if (denom < 1e-6) return null;
  const r = ((K.PLAYERK && K.PLAYERK.radius) || 0.45) + 0.25;
  let best = AIM_TAG_M, hitA = null;
  for (const t of W.actors) {
    if (!t.alive || t === me || t.isDummy || (me.teamId != null && t.teamId === me.teamId)) continue;
    const dx = t.pos.x - o.x, dz = t.pos.z - o.z;
    const u = (dx * _adir.x + dz * _adir.z) / denom;
    if (u < 1 || u > best) continue;
    const px = o.x + _adir.x * u, pz = o.z + _adir.z * u, py = o.y + _adir.y * u;
    if ((px - t.pos.x) ** 2 + (pz - t.pos.z) ** 2 > r * r) continue;
    const top = t.pos.y + (K.actorHeight ? K.actorHeight(t) : 1.8) + 0.15;
    if (py < t.pos.y - 0.1 || py > top) continue;
    best = u; hitA = t;
  }
  if (!hitA) return null;
  // already named by distance: no ray needed
  if (Math.hypot(hitA.pos.x - me.pos.x, hitA.pos.y - me.pos.y, hitA.pos.z - me.pos.z) <= TAG_ENEMY_M) return hitA;
  // the same target still holds for more than half the hold: its tag stays up without another world ray (the ray is the
  // costly part - collider queries + the march - and a held answer is at most AIM_HOLD_S / 2 stale when it is next re-tested)
  if (_tagPol.aimedId === hitA.id && _tagPol.aimedUntil - performance.now() / 1000 > AIM_HOLD_S * 0.5) return null;
  const ex = me.pos.x, ey = me.pos.y + 1.6, ez = me.pos.z;
  const dEye = (ex - o.x) * _adir.x + (ey - o.y) * _adir.y + (ez - o.z) * _adir.z;
  const d0 = dEye < 0.05 ? 0.05 : dEye > 8 ? 8 : dEye;
  if (_aMap !== W.map) {                               // the two world callbacks, built once per map (no per-test closures)
    const map = _aMap = W.map;
    _aH = (x, z) => map.heightAt(x, z); _aQ = (x, z, rr, buf) => map.queryColliders(x, z, rr, buf);
  }
  const dist = K.aimRayDist(o.x, o.y, o.z, _adir.x, _adir.y, _adir.z, d0, best, _aH, _aQ, _acols);
  return dist >= best - 0.6 ? hitA : null;
}
let _aMap = null, _aH = null, _aQ = null;
