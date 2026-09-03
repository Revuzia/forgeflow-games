/* ============================================================================
 * CRESTBOUND — runtime/ui/style.js
 * The interface design system: tokens, the injected stylesheet, and the shared
 * widget kit every UI surface (hud / menu / coursecard / transitions) is built
 * from. Ported from ASCENDANT's ui/style.js (same studio) and restyled for
 * CRESTBOUND's STORYBOOK-GLASS look:
 *
 *   - rounded panels of parchment-tinted frosted glass (warm plum ground with a
 *     cream highlight so it reads as glass over a painting, not a debug overlay)
 *   - thin gold rules and octagonal corner marks
 *   - Rajdhani 600/700 for numerals and display lines (shipped WOFF2, @font-face
 *     below); a friendlier rounded body stack for prose
 *   - ONE realm-tinted accent (`--accent`) set live by HUD.setTheme() from
 *     theme.palette.accent, with a readability guard so a dark realm colour can
 *     never produce unreadable UI text
 *
 * Contract §27 does not name this module's exports; everything here is
 * additive and consumed only by ui/*.js. Side-effect free at import: nothing
 * touches the DOM until injectStyles() (or a widget factory) is called, so the
 * module imports cleanly under the Node modulecheck shim.
 *
 * Every button the kit makes carries class `cb-btn` and a `__activate()` so
 * harnesses can drive menus without synthesising pointer events.
 * ==========================================================================*/

import { fmtTime, clamp } from '../core/util.js';

/* ---------------------------------------------------------------------------
 * 1. TOKENS
 * -------------------------------------------------------------------------*/

/** Base (pre-theme) palette. setUITheme() re-tints the accent family live. */
const BASE_PALETTE = {
  accent: '#7fd8a8',       // verdant-ish default until a theme lands
  gold: '#e9c36b',
  goldHot: '#fff1c2',
  goldDim: '#8a6a2c',
  safe: '#8ef0b8',
  danger: '#ff5f4a',
  checkpoint: '#7fe6ff',
  crest: '#ffd166',
  sigil: '#c98bff',
  coin: '#ffcf5c',
  ink: '#f7eedb',
  inkDim: '#cbbca0',
  inkMute: '#8c7f6a',
  void: '#0b0a16',
  parch: '#f3e9d2',
};

export const UI_TOKENS = {
  /** Font stacks. Rajdhani (SIL OFL) ships with the game as WOFF2 (assets/
   *  fonts/, @font-face below) so the display/numeral look never gambles on
   *  the viewer's OS. The BODY stack is deliberately friendlier/rounder than
   *  Ascendant's: storybook prose, not a race telemetry sheet. */
  font: {
    display:
      "'Rajdhani','Bahnschrift SemiCondensed','Bahnschrift','Barlow Condensed'," +
      "'Segoe UI Variable Display','Segoe UI Semibold','Segoe UI',system-ui,sans-serif",
    body:
      "'Segoe UI Variable Text','Segoe UI','Avenir Next','Avenir','Trebuchet MS'," +
      "'Nunito','Quicksand',system-ui,-apple-system,sans-serif",
    num:
      "'Rajdhani','Bahnschrift','Segoe UI Variable Display','Segoe UI','DIN Alternate'," +
      "system-ui,sans-serif",
  },
  /** Type scale (px). */
  type: {
    '2xs': 9, xs: 10.5, sm: 12, base: 14, md: 16, lg: 20,
    xl: 26, '2xl': 34, '3xl': 46, '4xl': 64, '5xl': 92,
  },
  track: { tight: -0.01, normal: 0, wide: 0.08, wider: 0.16, widest: 0.34, mega: 0.5 },
  space: { 0: 0, 1: 2, 2: 4, 3: 6, 4: 8, 5: 12, 6: 16, 7: 22, 8: 30, 9: 40, 10: 56, 11: 76 },
  radius: { xs: 3, sm: 6, md: 10, lg: 16, xl: 22, pill: 999 },
  dur: { flick: 90, fast: 150, base: 220, slow: 380, lazy: 620, card: 900 },
  ease: {
    out: 'cubic-bezier(.16,.84,.34,1)',
    in: 'cubic-bezier(.5,0,.9,.32)',
    inOut: 'cubic-bezier(.62,.02,.24,1)',
    spring: 'cubic-bezier(.2,1.5,.36,1)',
    snap: 'cubic-bezier(.08,.82,.17,1)',
  },
  z: { hud: 1, power: 3, toast: 6, ribbon: 7, flash: 8, clear: 12, card: 20, menu: 30, confirm: 45, trans: 50 },
  palette: BASE_PALETTE,
  /** Course counts, fixed by the contract (§0 names). */
  counts: { crests: 7, sigils: 8, coins: 100 },
  /**
   * RESERVED BOTTOM-RIGHT CORNER, in px. Every ForgeFlow games page loads
   * `game_controls.js`, which pins a fullscreen / mute / pause / bug cluster at
   * `bottom:8px right:8px` OUTSIDE the canvas and outside this design system.
   * Measured: four 26 px chips + 4 px gaps + 5 px padding ≈ 130 x 34, plus its
   * 8 px inset. Nothing the game draws may enter this box — the death badge and
   * the cinematic skip hint both used to sit inside it.
   */
  corner: { w: 152, h: 50 },
};

/* ---------------------------------------------------------------------------
 * 2. COLOUR UTILITIES
 * -------------------------------------------------------------------------*/

const _hexCache = new Map();

/** Accepts 0xRRGGBB, '#rgb', '#rrggbb', 'rgb()', a THREE.Color, or {r,g,b} 0..1. */
export function toRGB(c) {
  if (c == null) return null;
  if (typeof c === 'number' && isFinite(c)) {
    const n = c | 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  if (typeof c === 'string') {
    const s = c.trim();
    if (s[0] === '#') {
      if (s.length === 4) {
        return [parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16), parseInt(s[3] + s[3], 16)];
      }
      if (s.length >= 7) {
        return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
      }
      return null;
    }
    const m = s.match(/rgba?\(([^)]+)\)/i);
    if (m) {
      const p = m[1].split(',').map((v) => parseFloat(v));
      if (p.length >= 3) return [p[0] | 0, p[1] | 0, p[2] | 0];
    }
    return null;
  }
  if (typeof c === 'object') {
    if (typeof c.getHexString === 'function') {
      try { return toRGB('#' + c.getHexString()); } catch (e) { /* fall through */ }
    }
    if (typeof c.r === 'number' && typeof c.g === 'number' && typeof c.b === 'number') {
      const s = c.r <= 1 && c.g <= 1 && c.b <= 1 ? 255 : 1;
      return [Math.round(c.r * s), Math.round(c.g * s), Math.round(c.b * s)];
    }
  }
  return null;
}

function rgbToHex(rgb) {
  const h = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return '#' + h(rgb[0]) + h(rgb[1]) + h(rgb[2]);
}

/** Any colour form -> a css hex string. Falls back to `fb`. */
export function cssColor(c, fb = '#ffffff') {
  if (typeof c === 'string' && c.trim() && c[0] !== '#') {
    const rgb = toRGB(c);
    return rgb ? rgbToHex(rgb) : c;
  }
  const cached = typeof c === 'number' || typeof c === 'string' ? _hexCache.get(c) : null;
  if (cached) return cached;
  const rgb = toRGB(c);
  const out = rgb ? rgbToHex(rgb) : fb;
  if (typeof c === 'number' || typeof c === 'string') _hexCache.set(c, out);
  return out;
}

/** Linear blend of two colours. t=0 -> a, t=1 -> b. */
export function mixColor(a, b, t) {
  const A = toRGB(a) || [255, 255, 255];
  const B = toRGB(b) || [0, 0, 0];
  const k = clamp(t, 0, 1);
  return rgbToHex([A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k]);
}

/** Colour -> rgba() string at alpha `a`. */
export function alphaColor(c, a) {
  const rgb = toRGB(c) || [255, 255, 255];
  return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + clamp(a, 0, 1) + ')';
}

/** Relative luminance 0..1 (readability guard on generated tints). */
export function luminance(c) {
  const rgb = toRGB(c) || [0, 0, 0];
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

/** Force a colour bright enough to read as UI text on the glass ground. */
export function readable(c, min = 0.34) {
  let out = cssColor(c);
  let guard = 0;
  while (luminance(out) < min && guard++ < 8) out = mixColor(out, '#ffffff', 0.22);
  return out;
}

/* ---------------------------------------------------------------------------
 * 3. TIME / NUMBER FORMATTING
 * -------------------------------------------------------------------------*/

const DASH_TIME = '—:——.———';

/** ms -> "M:SS.mmm" (delegates to core/util fmtTime so the whole game agrees). */
export function fmtMs(ms) {
  if (ms == null || !isFinite(ms)) return DASH_TIME;
  try {
    const s = fmtTime(Math.max(0, ms) / 1000);
    if (typeof s === 'string' && s.length) return s;
  } catch (e) { /* fall through to local */ }
  const t = Math.max(0, ms | 0);
  const m = Math.floor(t / 60000);
  const sec = Math.floor((t % 60000) / 1000);
  const mil = t % 1000;
  return m + ':' + String(sec).padStart(2, '0') + '.' + String(mil).padStart(3, '0');
}

/** ms -> "H:MM:SS" / "M:SS" (session clock, no millis). */
export function fmtClock(ms) {
  if (ms == null || !isFinite(ms)) return '—:——';
  const t = Math.max(0, ms | 0);
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  return (h > 0 ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
}

/** Split a formatted clock into the big part and the small fractional part. */
export function splitTime(ms) {
  const s = fmtMs(ms);
  const i = s.lastIndexOf('.');
  if (i < 0) return { main: s, frac: '' };
  return { main: s.slice(0, i), frac: s.slice(i) };
}

/** ms delta -> "+1.204" / "−0.512" (true minus sign, tabular safe). */
export function fmtSplit(ms) {
  if (ms == null || !isFinite(ms)) return '';
  const neg = ms < 0;
  const t = Math.round(Math.abs(ms));
  const sec = Math.floor(t / 1000);
  const mil = t % 1000;
  const m = Math.floor(sec / 60);
  const body = (m > 0 ? m + ':' + String(sec % 60).padStart(2, '0') : String(sec)) +
    '.' + String(mil).padStart(3, '0');
  return (neg ? '−' : '+') + body;
}

/* ---------------------------------------------------------------------------
 * 4. THE STYLESHEET
 * -------------------------------------------------------------------------*/

const STYLE_ID = 'cb-ui-style';
let _injected = false;

/** The octagon used everywhere a crest is drawn (pips, slots, emblems). */
export const OCT_CLIP = 'polygon(29% 0,71% 0,100% 29%,100% 71%,71% 100%,29% 100%,0 71%,0 29%)';

const CSS = `
/* ===== shipped display face ============================================ */
@font-face{ font-family:'Rajdhani'; font-style:normal; font-weight:400; font-display:swap;
  src:url('./assets/fonts/rajdhani-400-latin.woff2') format('woff2'); }
@font-face{ font-family:'Rajdhani'; font-style:normal; font-weight:600; font-display:swap;
  src:url('./assets/fonts/rajdhani-600-latin.woff2') format('woff2'); }
@font-face{ font-family:'Rajdhani'; font-style:normal; font-weight:700; font-display:swap;
  src:url('./assets/fonts/rajdhani-700-latin.woff2') format('woff2'); }

/* ===== custom properties ============================================== */
:root{
  --f-display:${UI_TOKENS.font.display};
  --f-body:${UI_TOKENS.font.body};
  --f-num:${UI_TOKENS.font.num};

  --accent:${BASE_PALETTE.accent};
  --accent-dim:#2e6a4c;
  --accent-hot:#d6ffe9;
  --accent-glow:rgba(127,216,168,.5);
  --accent-ink:#08170f;

  --gold:${BASE_PALETTE.gold};
  --gold-hot:${BASE_PALETTE.goldHot};
  --gold-dim:${BASE_PALETTE.goldDim};
  --gold-glow:rgba(233,195,107,.45);
  --gold-ink:#2a1d08;

  --safe:${BASE_PALETTE.safe};
  --danger:${BASE_PALETTE.danger};
  --cp:${BASE_PALETTE.checkpoint};
  --crest:${BASE_PALETTE.crest};
  --sigil:${BASE_PALETTE.sigil};
  --coin:${BASE_PALETTE.coin};
  --ahead:#8ef0b8;
  --behind:#ff7a66;

  --ink:${BASE_PALETTE.ink};
  --ink-dim:${BASE_PALETTE.inkDim};
  --ink-mute:${BASE_PALETTE.inkMute};
  --ink-ghost:rgba(247,238,219,.30);
  --void:${BASE_PALETTE.void};
  --parch:${BASE_PALETTE.parch};

  /* parchment-tinted frosted glass: a warm plum ground so text reads over any
     realm, with a cream lift at the top edge so it reads as glass on paper */
  --glass:linear-gradient(162deg,rgba(84,66,74,.62) 0%,rgba(46,34,56,.74) 46%,rgba(30,22,42,.82) 100%);
  --glass-flat:rgba(40,30,48,.76);
  --glass-lift:linear-gradient(180deg,rgba(243,233,210,.16),rgba(243,233,210,.03) 38%,transparent 60%);
  --stroke:rgba(233,195,107,.34);
  --stroke-hi:rgba(233,195,107,.62);
  --hair:rgba(243,233,210,.10);
  --hair-soft:rgba(243,233,210,.06);

  --r-xs:${UI_TOKENS.radius.xs}px; --r-sm:${UI_TOKENS.radius.sm}px; --r-md:${UI_TOKENS.radius.md}px;
  --r-lg:${UI_TOKENS.radius.lg}px; --r-xl:${UI_TOKENS.radius.xl}px; --r-pill:${UI_TOKENS.radius.pill}px;

  --e-out:${UI_TOKENS.ease.out};
  --e-in:${UI_TOKENS.ease.in};
  --e-io:${UI_TOKENS.ease.inOut};
  --e-spring:${UI_TOKENS.ease.spring};
  --e-snap:${UI_TOKENS.ease.snap};

  --oct:${OCT_CLIP};
  --hud-scale:1;
  --ui-fade:1;
}

/* ===== shared base ===================================================== */
.cb-ui,.cb-hud{
  font-family:var(--f-body); color:var(--ink);
  -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;
  font-variant-numeric:tabular-nums lining-nums;
  font-feature-settings:'tnum' 1,'lnum' 1;
  letter-spacing:.01em;
}
.cb-ui *,.cb-hud *{ box-sizing:border-box; }
.cb-ui [data-nav]:focus,.cb-ui [data-nav]:focus-visible,
.cb-ui button:focus,.cb-ui button:focus-visible{ outline:none; }
.cb-num{ font-family:var(--f-num); font-weight:600; font-variant-numeric:tabular-nums lining-nums;
  font-feature-settings:'tnum' 1,'lnum' 1; }
.cb-disp{ font-family:var(--f-display); font-weight:700; text-transform:uppercase; }
.cb-hidden{ display:none !important; }
.cb-gone{ opacity:0 !important; pointer-events:none !important; }

/* ===== storybook glass ================================================== */
.cb-glass{
  position:relative;
  background:var(--glass);
  backdrop-filter:blur(18px) saturate(1.25);
  -webkit-backdrop-filter:blur(18px) saturate(1.25);
  border:1px solid var(--stroke);
  border-radius:var(--r-lg);
  box-shadow:
    inset 0 1px 0 rgba(255,244,214,.28),
    inset 0 0 0 1px rgba(243,233,210,.05),
    inset 0 -1px 0 rgba(0,0,0,.40),
    0 26px 70px -22px rgba(0,0,0,.80),
    0 0 0 1px rgba(0,0,0,.28),
    0 0 52px -16px var(--accent-glow);
}
.cb-glass::before{
  content:''; position:absolute; inset:0; border-radius:inherit; pointer-events:none;
  background:var(--glass-lift);
}
/* thin gold inner rule, inset 6px, the storybook "plate" */
.cb-glass.cb-plate::after{
  content:''; position:absolute; inset:6px; border-radius:calc(var(--r-lg) - 5px); pointer-events:none;
  border:1px solid rgba(233,195,107,.22);
}
/* octagonal gold corner marks for the large panels */
.cb-corners{ position:absolute; inset:0; pointer-events:none; border-radius:inherit; }
.cb-corners i{
  position:absolute; width:9px; height:9px; clip-path:var(--oct);
  background:linear-gradient(150deg,var(--gold-hot),var(--gold) 55%,var(--gold-dim));
  box-shadow:0 0 10px var(--gold-glow); opacity:.9;
}
.cb-corners i:nth-child(1){ left:9px; top:9px; }
.cb-corners i:nth-child(2){ right:9px; top:9px; }
.cb-corners i:nth-child(3){ left:9px; bottom:9px; }
.cb-corners i:nth-child(4){ right:9px; bottom:9px; }

.cb-rule{
  position:relative; height:1px; pointer-events:none;
  background:linear-gradient(90deg,transparent,var(--gold) 22%,var(--gold-hot) 50%,var(--gold) 78%,transparent);
  opacity:.75;
}
.cb-rule::after{
  content:''; position:absolute; left:50%; top:-3px; width:7px; height:7px; margin-left:-3.5px;
  clip-path:var(--oct); background:var(--gold-hot); box-shadow:0 0 8px var(--gold-glow);
}
.cb-edge{
  position:absolute; left:0; right:0; height:1px; pointer-events:none;
  background:linear-gradient(90deg,transparent,var(--accent),transparent); opacity:.55;
}
.cb-edge.top{ top:-1px } .cb-edge.bot{ bottom:-1px }

/* ===== label / caption ================================================== */
.cb-label{
  font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:700;
  letter-spacing:.34em; text-transform:uppercase; color:var(--ink-mute);
}
.cb-eyebrow{
  font-family:var(--f-display); font-size:${UI_TOKENS.type.xs}px; font-weight:700;
  letter-spacing:.40em; text-transform:uppercase; color:var(--accent);
  display:flex; align-items:center; gap:9px;
}
.cb-eyebrow::before{ content:''; width:16px; height:1px; background:var(--gold); opacity:.9;
  box-shadow:0 0 8px var(--gold-glow); }
.cb-cap{ font-size:${UI_TOKENS.type.xs}px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-dim); }

/* ===== buttons (class cb-btn — harness contract) ======================== */
.cb-btn{
  position:relative; display:flex; align-items:center; gap:12px;
  padding:11px 20px 11px 16px; min-height:44px;
  font-family:var(--f-display); font-size:${UI_TOKENS.type.md}px; font-weight:700;
  letter-spacing:.18em; text-transform:uppercase; color:var(--ink-dim);
  background:linear-gradient(100deg,rgba(243,233,210,.075),rgba(243,233,210,.015));
  border:1px solid var(--hair); border-radius:var(--r-md);
  cursor:pointer; user-select:none; white-space:nowrap;
  transition:color .16s var(--e-out), background .16s var(--e-out),
             border-color .16s var(--e-out), transform .12s var(--e-snap),
             box-shadow .2s var(--e-out), letter-spacing .2s var(--e-out);
  outline:none; -webkit-tap-highlight-color:transparent; -webkit-appearance:none; appearance:none;
}
.cb-btn .cb-btn-mark{
  width:8px; height:8px; flex:0 0 8px; clip-path:var(--oct); background:var(--ink-mute);
  transition:background .16s var(--e-out), transform .24s var(--e-spring), box-shadow .2s var(--e-out);
}
.cb-btn .cb-btn-sub{
  margin-left:auto; padding-left:14px; font-family:var(--f-num); font-size:${UI_TOKENS.type.xs}px;
  font-weight:600; letter-spacing:.10em; color:var(--ink-mute); opacity:.85;
}
.cb-btn:hover,.cb-btn.is-focus{
  color:var(--ink); background:linear-gradient(100deg,rgba(243,233,210,.14),rgba(243,233,210,.03));
  border-color:var(--stroke-hi);
  transform:translateX(4px); letter-spacing:.215em;
  box-shadow:0 0 0 1px rgba(233,195,107,.18), -12px 0 28px -20px var(--gold), inset 0 1px 0 rgba(255,244,214,.18);
}
.cb-btn:hover .cb-btn-mark,.cb-btn.is-focus .cb-btn-mark{
  background:var(--gold); transform:scale(1.4); box-shadow:0 0 12px var(--gold-glow);
}
.cb-btn:active{ transform:translateX(4px) scale(.985); }
.cb-btn.is-primary{
  color:var(--gold-ink); border-color:var(--gold);
  background:linear-gradient(180deg,var(--gold-hot),var(--gold) 58%,#d3a54a);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.55), 0 6px 22px -10px var(--gold);
}
.cb-btn.is-primary .cb-btn-mark{ background:var(--gold-ink); opacity:.8; }
.cb-btn.is-primary:hover,.cb-btn.is-primary.is-focus{
  color:var(--gold-ink); background:linear-gradient(180deg,#fff8dd,var(--gold-hot) 40%,var(--gold));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.7), 0 0 0 1px var(--gold-hot), 0 10px 30px -10px var(--gold);
}
.cb-btn.is-primary:hover .cb-btn-mark,.cb-btn.is-primary.is-focus .cb-btn-mark{ background:var(--gold-ink); box-shadow:none; }
.cb-btn.is-danger:hover,.cb-btn.is-danger.is-focus{ border-color:var(--danger);
  box-shadow:0 0 0 1px rgba(255,95,74,.25), -12px 0 28px -20px var(--danger); }
.cb-btn.is-danger:hover .cb-btn-mark,.cb-btn.is-danger.is-focus .cb-btn-mark{
  background:var(--danger); box-shadow:0 0 12px rgba(255,95,74,.6); }
.cb-btn[disabled],.cb-btn.is-disabled{ opacity:.32; pointer-events:none; filter:grayscale(.6); }
.cb-btn.compact{ padding:8px 14px; min-height:34px; font-size:${UI_TOKENS.type.sm}px; letter-spacing:.16em; }
.cb-btn.centered{ justify-content:center; padding-left:20px; }
.cb-btn.centered .cb-btn-mark{ display:none; }

/* ===== rows / controls ================================================== */
.cb-row{
  display:grid; grid-template-columns:1fr 254px; align-items:center; gap:18px;
  padding:10px 14px; border-radius:var(--r-md); border:1px solid transparent;
  transition:background .15s var(--e-out), border-color .15s var(--e-out);
}
.cb-row + .cb-row{ margin-top:2px; }
.cb-row .cb-row-name{ font-size:${UI_TOKENS.type.base}px; letter-spacing:.10em;
  text-transform:uppercase; color:var(--ink-dim); font-family:var(--f-display); font-weight:700; }
.cb-row .cb-row-hint{ display:block; font-family:var(--f-body); font-weight:400;
  font-size:${UI_TOKENS.type.xs}px; letter-spacing:.02em; text-transform:none; color:var(--ink-mute);
  margin-top:2px; }
.cb-row:hover,.cb-row.is-focus{ background:rgba(243,233,210,.06); border-color:var(--hair); }
.cb-row.is-focus .cb-row-name{ color:var(--ink); }
.cb-row.is-focus{ box-shadow:inset 2px 0 0 var(--gold); }

.cb-seg{ display:flex; gap:2px; padding:2px; border-radius:var(--r-sm);
  background:rgba(0,0,0,.36); border:1px solid var(--hair); }
.cb-seg > b{
  flex:1; text-align:center; padding:7px 4px; border-radius:4px; cursor:pointer;
  font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:700;
  letter-spacing:.09em; text-transform:uppercase; color:var(--ink-mute); white-space:nowrap;
  transition:color .15s var(--e-out), background .15s var(--e-out), box-shadow .2s var(--e-out);
}
.cb-seg > b:hover{ color:var(--ink-dim); background:rgba(243,233,210,.06); }
.cb-seg > b.is-on{
  color:var(--gold-ink); background:linear-gradient(180deg,var(--gold-hot),var(--gold));
  box-shadow:0 0 18px -4px var(--gold-glow), inset 0 1px 0 rgba(255,255,255,.5);
}

.cb-slider{ display:flex; align-items:center; gap:12px; cursor:ew-resize; touch-action:none; }
.cb-slider .cb-sl-track{ position:relative; flex:1; height:18px; display:flex; align-items:center; }
.cb-slider .cb-sl-track::before{
  content:''; position:absolute; left:0; right:0; top:50%; margin-top:-1.5px;
  height:3px; border-radius:2px; background:rgba(0,0,0,.5); box-shadow:inset 0 1px 1px rgba(0,0,0,.6);
}
.cb-slider .cb-sl-fill{
  position:absolute; left:0; top:50%; margin-top:-1.5px; width:100%;
  height:3px; border-radius:2px; transform-origin:left center; transform:scaleX(0);
  background:linear-gradient(90deg,var(--gold-dim),var(--gold));
  box-shadow:0 0 12px -2px var(--gold-glow);
}
.cb-slider .cb-sl-knob{
  position:absolute; left:0; top:50%; width:13px; height:13px;
  margin-left:-6.5px; margin-top:-6.5px; clip-path:var(--oct);
  background:var(--ink); transition:background .18s var(--e-out);
}
.cb-slider:hover .cb-sl-knob,.is-focus .cb-slider .cb-sl-knob{ background:var(--gold-hot); }
.cb-slider .cb-sl-val{
  min-width:52px; text-align:right; font-family:var(--f-num); font-weight:600;
  font-size:${UI_TOKENS.type.sm}px; letter-spacing:.06em; color:var(--ink-dim);
}

.cb-toggle{
  position:relative; width:52px; height:24px; border-radius:var(--r-pill); cursor:pointer;
  background:rgba(0,0,0,.45); border:1px solid var(--hair);
  transition:background .2s var(--e-out), border-color .2s var(--e-out), box-shadow .2s var(--e-out);
}
.cb-toggle i{
  position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:50%;
  background:var(--ink-mute); transition:transform .22s var(--e-spring), background .2s var(--e-out);
}
.cb-toggle.is-on{ background:rgba(233,195,107,.22); border-color:var(--gold);
  box-shadow:0 0 20px -6px var(--gold-glow); }
.cb-toggle.is-on i{ transform:translateX(28px); background:var(--gold); }
.cb-toggle-wrap{ display:flex; justify-content:flex-end; }

/* ===== keycap + gamepad glyph =========================================== */
.cb-kbd{
  display:inline-flex; align-items:center; justify-content:center;
  min-width:30px; height:26px; padding:0 8px;
  font-family:var(--f-num); font-size:${UI_TOKENS.type.xs}px; font-weight:700;
  letter-spacing:.08em; text-transform:uppercase; color:var(--ink);
  background:linear-gradient(180deg,rgba(243,233,210,.14),rgba(243,233,210,.03));
  border:1px solid var(--hair); border-bottom-color:rgba(0,0,0,.6);
  border-radius:var(--r-sm);
  box-shadow:inset 0 1px 0 rgba(255,244,214,.2), 0 2px 0 rgba(0,0,0,.35);
}
.cb-kbd.is-listening{
  color:var(--gold-ink); background:var(--gold); border-color:var(--gold);
  animation:cb-blink .7s steps(2,end) infinite;
}
.cb-kbd.is-empty{ color:var(--ink-mute); opacity:.5; }
.cb-pad{
  display:inline-flex; align-items:center; justify-content:center;
  min-width:24px; height:24px; padding:0 7px; border-radius:var(--r-pill);
  font-family:var(--f-num); font-size:${UI_TOKENS.type.xs}px; font-weight:700; letter-spacing:.04em;
  color:var(--ink); background:rgba(0,0,0,.42); border:1px solid rgba(243,233,210,.22);
  box-shadow:inset 0 1px 0 rgba(255,244,214,.14);
}
.cb-pad.a{ color:#9fe7a6; } .cb-pad.b{ color:#ff8a7a; } .cb-pad.x{ color:#8fc7ff; } .cb-pad.y{ color:#ffe07a; }
.cb-pad.stick{ min-width:30px; }
.cb-glyphs{ display:inline-flex; gap:5px; align-items:center; flex-wrap:wrap; }
.cb-glyphs .plus{ color:var(--ink-mute); font-size:${UI_TOKENS.type.xs}px; margin:0 1px; }

/* ===== pips ============================================================= */
.cb-dots{ display:flex; gap:4px; align-items:center; }
.cb-dots i{ width:7px; height:7px; clip-path:var(--oct); background:rgba(243,233,210,.16); }
.cb-dots i.on{ background:var(--gold); box-shadow:0 0 6px var(--gold-glow); }
.cb-dots i.hot{ background:var(--danger); box-shadow:0 0 6px rgba(255,95,74,.6); }

/* crest pip — octagon, hollow until collected, then gold with a glint */
.cb-crestpip{
  position:relative; width:18px; height:18px; flex:0 0 18px;
  display:inline-flex; align-items:center; justify-content:center;
}
.cb-crestpip::before{
  content:''; position:absolute; inset:0; clip-path:var(--oct);
  background:rgba(243,233,210,.22);
  transition:background .3s var(--e-out);
}
.cb-crestpip::after{
  content:''; position:absolute; inset:1.5px; clip-path:var(--oct);
  background:rgba(20,14,30,.85);
  transition:background .3s var(--e-out), transform .35s var(--e-spring);
}
.cb-crestpip i{
  position:absolute; inset:5px; clip-path:var(--oct); background:transparent; z-index:1;
  transition:background .3s var(--e-out), transform .35s var(--e-spring), box-shadow .3s var(--e-out);
}
.cb-crestpip.is-got::before{ background:var(--gold-hot); }
.cb-crestpip.is-got::after{ background:linear-gradient(160deg,var(--gold-hot),var(--gold) 50%,var(--gold-dim)); }
.cb-crestpip.is-got i{ background:rgba(255,255,255,.92); transform:scale(.55); box-shadow:0 0 10px var(--gold-hot); }
.cb-crestpip.is-got{ filter:drop-shadow(0 0 7px var(--gold-glow)); }
.cb-crestpip.is-pop{ animation:cb-pippop .55s var(--e-spring); }

/* sigil pip — small diamond, violet when collected */
.cb-sigpip{
  width:9px; height:9px; transform:rotate(45deg); border-radius:1.5px;
  background:rgba(243,233,210,.16); border:1px solid rgba(243,233,210,.10);
  transition:background .25s var(--e-out), box-shadow .25s var(--e-out), transform .3s var(--e-spring);
}
.cb-sigpip.is-got{ background:var(--sigil); border-color:#f0dcff;
  box-shadow:0 0 9px -1px var(--sigil); transform:rotate(45deg) scale(1.08); }
.cb-sigpip.is-pop{ animation:cb-sigpop .5s var(--e-spring); }

/* hearts (warden) */
.cb-heart{ width:20px; height:20px; color:rgba(243,233,210,.22); transition:color .2s var(--e-out), transform .3s var(--e-spring); }
.cb-heart svg{ width:100%; height:100%; display:block; }
.cb-heart.on{ color:var(--danger); filter:drop-shadow(0 0 8px rgba(255,95,74,.6)); }
.cb-heart.is-hit{ animation:cb-heartbreak .45s var(--e-out); }

/* ===== keyframes ======================================================== */
@keyframes cb-sheen{ 0%{background-position:-180% 0} 55%{background-position:280% 0} 100%{background-position:280% 0} }
@keyframes cb-blink{ 0%,100%{opacity:1} 50%{opacity:.35} }
@keyframes cb-spin{ to{ transform:rotate(360deg) } }
@keyframes cb-shake{
  0%{transform:translate3d(0,0,0)} 12%{transform:translate3d(-4px,1px,0)}
  26%{transform:translate3d(3px,-1px,0)} 42%{transform:translate3d(-3px,0,0)}
  58%{transform:translate3d(2px,1px,0)} 74%{transform:translate3d(-1px,0,0)}
  100%{transform:translate3d(0,0,0)}
}
@keyframes cb-in-up{ from{opacity:0;transform:translate3d(0,14px,0)} to{opacity:1;transform:none} }
@keyframes cb-in-left{ from{opacity:0;transform:translate3d(-16px,0,0)} to{opacity:1;transform:none} }
@keyframes cb-pop{ 0%{opacity:0;transform:scale(.86)} 60%{opacity:1;transform:scale(1.03)} 100%{transform:scale(1)} }
@keyframes cb-rule{ 0%{transform:scaleX(0);opacity:0} 30%{opacity:1} 100%{transform:scaleX(1);opacity:1} }
@keyframes cb-ruleglow{ 0%,100%{opacity:.35} 50%{opacity:1} }
@keyframes cb-pulse{ 0%,100%{opacity:.55} 50%{opacity:1} }
@keyframes cb-coinspin{ 0%{transform:rotateY(0)} 100%{transform:rotateY(360deg)} }
@keyframes cb-pippop{ 0%{transform:scale(1)} 40%{transform:scale(1.55) rotate(22deg)} 100%{transform:scale(1) rotate(0)} }
@keyframes cb-sigpop{ 0%{transform:rotate(45deg) scale(1)} 45%{transform:rotate(135deg) scale(1.7)} 100%{transform:rotate(45deg) scale(1.08)} }
@keyframes cb-heartbreak{ 0%{transform:scale(1)} 30%{transform:scale(1.4) rotate(-12deg)} 60%{transform:scale(.8) rotate(8deg)} 100%{transform:scale(1)} }
@keyframes cb-racered{ 0%,100%{color:#fff;text-shadow:0 0 22px rgba(255,95,74,.35)} 50%{color:var(--danger);text-shadow:0 0 36px rgba(255,95,74,.95)} }
@keyframes cb-drift{ 0%{transform:translate3d(0,0,0)} 100%{transform:translate3d(0,-26px,0)} }
@keyframes cb-streak{ 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
@keyframes cb-emblemspin{ 0%{transform:rotate(0)} 100%{transform:rotate(360deg)} }
@keyframes cb-glint{ 0%{transform:translateX(-160%) skewX(-18deg);opacity:0} 20%{opacity:1} 100%{transform:translateX(260%) skewX(-18deg);opacity:0} }

/* Settings.reduceMotion (class on <html>) + the OS preference */
html.cb-reduce .cb-ui *,html.cb-reduce .cb-hud *,html.cb-reduce .cb-trans *{
  animation-duration:.01ms !important; animation-iteration-count:1 !important;
  transition-duration:.06s !important; }
@media (prefers-reduced-motion: reduce){
  .cb-ui *,.cb-hud *{ animation-duration:.01ms !important; animation-iteration-count:1 !important;
    transition-duration:.06s !important; }
}
`;

/* ---------------------------------------------------------------------------
 * 4b. SURFACE-SPECIFIC CSS  (HUD / MENU / CARD / TRANSITIONS)
 *     Kept beside the tokens so ONE <style> tag carries the whole system.
 * -------------------------------------------------------------------------*/

const HUD_CSS = `
/* ===== HUD =============================================================== */
.cb-hud{ position:absolute; inset:0; pointer-events:none; overflow:hidden; contain:layout style; }
.ch-play{ position:absolute; inset:0; pointer-events:none; opacity:1; transition:opacity .22s var(--e-out); }
.ch-play.is-off{ opacity:0; }
.ch-play.is-dim{ opacity:.35; }
.ch-scrim{
  position:absolute; inset:0; pointer-events:none;
  background:
    linear-gradient(158deg,rgba(8,4,16,.40),rgba(0,0,0,0) 24%),
    linear-gradient(202deg,rgba(8,4,16,.40),rgba(0,0,0,0) 24%),
    linear-gradient(0deg,rgba(8,4,16,.36),rgba(0,0,0,0) 20%);
}
.cb-hud .ch-cluster{ position:absolute; will-change:transform; }

/* a small glass chip shared by the readouts */
.ch-chip{
  display:inline-flex; align-items:center; gap:9px;
  padding:7px 13px 7px 11px; border-radius:var(--r-md);
  background:var(--glass-flat);
  backdrop-filter:blur(12px) saturate(1.2); -webkit-backdrop-filter:blur(12px) saturate(1.2);
  border:1px solid var(--hair); box-shadow:inset 0 1px 0 rgba(255,244,214,.16), 0 10px 30px -18px rgba(0,0,0,.9);
}

/* --- top-left: realm / course / crests -------------------------------- */
.ch-tl{ top:22px; left:26px; transform-origin:top left; transform:scale(var(--hud-scale)); pointer-events:none; }
.ch-realm{ margin-bottom:4px; text-shadow:0 1px 12px rgba(0,0,0,.8); }
.ch-course{
  font-family:var(--f-display); font-size:${UI_TOKENS.type['2xl']}px; font-weight:700;
  letter-spacing:.05em; line-height:.94; text-transform:uppercase; color:#fff;
  text-shadow:0 2px 22px rgba(0,0,0,.85), 0 0 1px rgba(0,0,0,.9);
}
.ch-tally{
  margin-top:9px; pointer-events:auto; cursor:default;
  display:inline-flex; flex-direction:column; align-items:flex-start;
}
.ch-tally .ch-pips{ display:flex; gap:5px; align-items:center; }
.ch-tally .ch-pips .ch-tally-k{
  font-family:var(--f-display); font-weight:700; font-size:${UI_TOKENS.type['2xs']}px; letter-spacing:.30em;
  text-transform:uppercase; color:var(--ink-dim); text-shadow:0 1px 8px rgba(0,0,0,.8);
}
.ch-tally .ch-pips .ch-tally-k + .ch-tally-n{ margin-left:10px; }
.ch-tally .ch-pips .ch-tally-n{
  margin-left:8px; font-family:var(--f-num); font-weight:700; font-size:${UI_TOKENS.type.sm}px;
  letter-spacing:.14em; color:var(--gold); text-shadow:0 1px 8px rgba(0,0,0,.8);
}
.ch-tally .ch-names{
  display:grid; grid-template-rows:0fr; transition:grid-template-rows .3s var(--e-io), opacity .25s var(--e-out);
  opacity:0; margin-top:0;
}
.ch-tally:hover .ch-names,.ch-tally.is-open .ch-names{ grid-template-rows:1fr; opacity:1; margin-top:7px; }
.ch-tally .ch-names > div{ overflow:hidden; }
.ch-tally .ch-names ul{ list-style:none; margin:0; padding:6px 10px 7px; min-width:220px; border-radius:var(--r-md);
  background:var(--glass-flat); border:1px solid var(--hair);
  backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); }
.ch-tally .ch-names li{
  display:flex; align-items:center; gap:9px; padding:3px 0;
  font-family:var(--f-display); font-size:${UI_TOKENS.type.xs}px; font-weight:700; letter-spacing:.14em;
  text-transform:uppercase; color:var(--ink-mute);
}
.ch-tally .ch-names li .cb-crestpip{ width:12px; height:12px; flex-basis:12px; }
.ch-tally .ch-names li .cb-crestpip i{ inset:3.5px; }
.ch-tally .ch-names li.is-got{ color:var(--ink); }

/* --- top-centre: race timer / warden hearts --------------------------- */
.ch-tc{ top:24px; left:50%; transform-origin:top center; transform:translateX(-50%) scale(var(--hud-scale));
  display:flex; flex-direction:column; align-items:center; gap:10px; }
.ch-race{
  display:none; flex-direction:column; align-items:center;
  padding:8px 26px 10px; border-radius:var(--r-lg);
}
.ch-race.on{ display:flex; }
.ch-race .k{ font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:700; letter-spacing:.42em;
  margin-left:.42em; text-transform:uppercase; color:var(--gold); }
.ch-race .v{ margin-top:2px; font-family:var(--f-num); font-weight:700; font-size:${UI_TOKENS.type['3xl']}px; line-height:1;
  color:#fff; text-shadow:0 2px 22px rgba(0,0,0,.8); display:flex; align-items:baseline; }
.ch-race .v .ms{ font-size:${UI_TOKENS.type.lg}px; font-weight:600; color:var(--ink-dim); }
.ch-race.is-low{ border-color:rgba(255,95,74,.55); }
.ch-race.is-low .v{ animation:cb-racered .5s var(--e-io) infinite; }
.ch-race.is-low .k{ color:var(--danger); }
.ch-warden{ display:none; align-items:center; gap:10px; padding:7px 16px; }
.ch-warden.on{ display:inline-flex; }
.ch-warden .k{ font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:700; letter-spacing:.36em;
  text-transform:uppercase; color:var(--danger); margin-right:2px; }
.ch-warden .hearts{ display:flex; gap:5px; }

/* --- top-right: timers + deaths --------------------------------------- */
.ch-tr{ top:22px; right:26px; text-align:right; transform-origin:top right; transform:scale(var(--hud-scale));
  display:flex; flex-direction:column; align-items:flex-end; gap:6px; }
/* The timer used to be bare type. Over a white sky — or a celebration pulse —
   white-on-white is unreadable, so it sits on its own plate like every other
   readout. No backdrop blur here: this is the one panel that is on screen every
   frame, and a flat translucent ground buys the same contrast for nothing. */
.ch-timers{
  display:inline-flex; flex-direction:column; align-items:flex-end; gap:2px;
  padding:6px 12px 7px; border-radius:var(--r-md);
  background:linear-gradient(180deg,rgba(20,14,30,.56),rgba(12,8,20,.66));
  border:1px solid var(--hair); box-shadow:inset 0 1px 0 rgba(255,244,214,.14), 0 10px 30px -18px rgba(0,0,0,.9);
}
.ch-timer{
  font-family:var(--f-num); font-weight:700; line-height:.92; color:#fff;
  display:flex; align-items:baseline; justify-content:flex-end;
  text-shadow:0 2px 20px rgba(0,0,0,.8);
}
.ch-timer .big{ font-size:${UI_TOKENS.type['2xl']}px; letter-spacing:.01em; }
.ch-timer .ms{ font-size:${UI_TOKENS.type.lg}px; font-weight:600; color:var(--ink-dim); margin-left:1px; }
.ch-session{ font-family:var(--f-num); font-weight:600; font-size:${UI_TOKENS.type.xs}px; letter-spacing:.22em;
  text-transform:uppercase; color:var(--ink-mute); text-shadow:0 1px 10px rgba(0,0,0,.8); }
.ch-session b{ color:var(--ink-dim); font-weight:700; margin-left:6px; }
.ch-timers.is-off{ display:none; }
.ch-deaths{ margin-top:2px; }
.ch-deaths svg{ width:17px; height:17px; color:var(--danger); opacity:.85; }
.ch-deaths .n{ font-family:var(--f-num); font-weight:700; font-size:${UI_TOKENS.type.lg}px; line-height:1; color:#fff; }
.ch-deaths.is-hit{ animation:cb-shake .34s var(--e-out); }
.ch-deaths.is-hit svg{ filter:drop-shadow(0 0 10px rgba(255,95,74,.8)); opacity:1; }

/* --- bottom-left: coins / sigils / checkpoint ------------------------- */
.ch-bl{ bottom:26px; left:26px; display:flex; flex-direction:column; gap:8px; align-items:flex-start;
  transform-origin:bottom left; transform:scale(var(--hud-scale)); }
.ch-coins svg{ width:22px; height:22px; color:var(--coin); filter:drop-shadow(0 0 6px rgba(255,207,92,.45)); }
.ch-coins .n{ font-family:var(--f-num); font-weight:700; font-size:${UI_TOKENS.type.xl}px; line-height:1; color:#fff; }
.ch-coins .of{ font-family:var(--f-num); font-weight:600; font-size:${UI_TOKENS.type.sm}px; color:var(--ink-mute);
  align-self:flex-end; margin-bottom:2px; margin-left:-3px; }
.ch-coins.is-hit svg{ animation:cb-coinspin .5s var(--e-out); }
.ch-coins.is-full{ border-color:var(--gold); box-shadow:inset 0 1px 0 rgba(255,244,214,.16), 0 0 26px -8px var(--gold); }
.ch-coins.is-full .n{ color:var(--gold-hot); }
.ch-sigils{ gap:11px; }
.ch-sigils svg{ width:16px; height:16px; color:var(--sigil); }
.ch-sigils .pips{ display:flex; gap:7px; padding:0 3px; }
.ch-sigils.is-full{ border-color:var(--sigil); box-shadow:inset 0 1px 0 rgba(255,244,214,.16), 0 0 26px -8px var(--sigil); }
.ch-cp{ gap:8px; }
.ch-cp .pip{ width:11px; height:11px; border-radius:50%; background:rgba(243,233,210,.16);
  border:1.5px solid rgba(243,233,210,.22); transition:background .3s var(--e-out), box-shadow .3s var(--e-out); }
.ch-cp.on .pip{ background:var(--cp); border-color:#e6fbff; box-shadow:0 0 10px -1px var(--cp); }
.ch-cp .t{ font-family:var(--f-display); font-weight:700; font-size:${UI_TOKENS.type['2xs']}px; letter-spacing:.30em;
  text-transform:uppercase; color:var(--ink-mute); }
.ch-cp .n{ font-family:var(--f-num); font-weight:700; font-size:${UI_TOKENS.type.sm}px; letter-spacing:.10em; color:var(--ink-dim); }
.ch-cp.on .t{ color:var(--cp); }

/* --- speed streaks ---------------------------------------------------- */
.ch-speed{
  position:absolute; inset:0; pointer-events:none; opacity:0;
  transition:opacity .18s var(--e-out);
}
.ch-speed .rib{
  position:absolute; left:26px; bottom:16px; width:158px; height:3px; border-radius:2px;
  background:rgba(243,233,210,.08); overflow:hidden;
  transform-origin:bottom left; transform:scale(var(--hud-scale));
}
.ch-speed .rib i{ display:block; height:100%; width:100%; transform:scaleX(0); transform-origin:left center;
  background:linear-gradient(90deg,var(--accent-dim),var(--accent) 70%,var(--gold-hot));
  box-shadow:0 0 10px -2px var(--accent-glow); transition:transform .09s linear; }
.ch-speed .streaks{ position:absolute; inset:0; overflow:hidden; opacity:var(--stk,0); }
.ch-speed .streaks i{
  position:absolute; height:1px; width:200%; left:0;
  background:repeating-linear-gradient(90deg,transparent 0 62%,rgba(255,244,214,.55) 62% 70%,transparent 70% 100%);
  background-size:38% 100%; animation:cb-streak .38s linear infinite; opacity:.55;
  mask-image:linear-gradient(90deg,rgba(0,0,0,.9),transparent 22%,transparent 78%,rgba(0,0,0,.9));
  -webkit-mask-image:linear-gradient(90deg,rgba(0,0,0,.9),transparent 22%,transparent 78%,rgba(0,0,0,.9));
}
.ch-speed .streaks i:nth-child(1){ top:18%; animation-duration:.42s; }
.ch-speed .streaks i:nth-child(2){ top:31%; animation-duration:.36s; opacity:.4; }
.ch-speed .streaks i:nth-child(3){ top:66%; animation-duration:.40s; }
.ch-speed .streaks i:nth-child(4){ top:80%; animation-duration:.34s; opacity:.4; }

/* --- bottom-centre: power bar + toasts -------------------------------- */
.ch-bc{
  position:absolute; left:50%; bottom:110px; transform:translateX(-50%) scale(var(--hud-scale));
  transform-origin:bottom center;
  display:flex; flex-direction:column-reverse; align-items:center; gap:8px; width:min(560px,72vw);
}
.ch-power{
  display:none; flex-direction:column; align-items:stretch; gap:6px; width:min(320px,60vw);
  padding:9px 16px 11px; border-radius:var(--r-md); z-index:${UI_TOKENS.z.power};
}
.ch-power.on{ display:flex; }
.ch-power .h{ display:flex; align-items:baseline; justify-content:space-between; }
.ch-power .h .k{ font-family:var(--f-display); font-weight:700; font-size:${UI_TOKENS.type.xs}px; letter-spacing:.36em;
  text-transform:uppercase; color:var(--accent); }
.ch-power .h .v{ font-family:var(--f-num); font-weight:700; font-size:${UI_TOKENS.type.sm}px; letter-spacing:.10em; color:var(--ink-dim); }
.ch-power .rail{ position:relative; height:5px; border-radius:3px; overflow:hidden; background:rgba(0,0,0,.5);
  box-shadow:inset 0 1px 2px rgba(0,0,0,.7); }
.ch-power .rail i{ position:absolute; inset:0; transform-origin:left center; transform:scaleX(1);
  background:linear-gradient(90deg,var(--accent-dim),var(--accent) 60%,var(--accent-hot));
  box-shadow:0 0 14px 0 var(--accent-glow); transition:transform .12s linear; }
.ch-power.is-low .h .k{ color:var(--danger); animation:cb-pulse .5s var(--e-io) infinite; }
.ch-power.is-low .rail i{ background:linear-gradient(90deg,#7a2a1c,var(--danger)); }

.ch-toast{
  display:flex; align-items:center; gap:12px; max-width:100%;
  padding:9px 18px 9px 14px; border-radius:var(--r-md);
  background:var(--glass-flat);
  backdrop-filter:blur(12px) saturate(1.2); -webkit-backdrop-filter:blur(12px) saturate(1.2);
  border:1px solid var(--hair); border-left:2px solid var(--accent);
  box-shadow:0 14px 34px -16px rgba(0,0,0,.9), inset 0 1px 0 rgba(255,244,214,.14);
  will-change:transform,opacity;
}
.ch-toast .tx{ min-width:0; }
.ch-toast .t1{
  font-family:var(--f-display); font-size:${UI_TOKENS.type.base}px; font-weight:700;
  letter-spacing:.14em; text-transform:uppercase; color:#fff; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis;
}
.ch-toast .t2{ font-size:${UI_TOKENS.type.xs}px; letter-spacing:.03em; color:var(--ink-dim); margin-top:2px; }
.ch-toast .ic{ width:18px; height:18px; flex:0 0 18px; color:var(--accent); opacity:.9; }
.ch-toast .ic svg{ width:100%; height:100%; }
.ch-toast.k-good{ border-left-color:var(--safe); } .ch-toast.k-good .ic{ color:var(--safe); }
.ch-toast.k-warn{ border-left-color:var(--gold); } .ch-toast.k-warn .ic{ color:var(--gold); }
.ch-toast.k-bad{ border-left-color:var(--danger); } .ch-toast.k-bad .ic{ color:var(--danger); }
.ch-toast.k-crest{ border-left-color:var(--crest); } .ch-toast.k-crest .ic{ color:var(--crest); }
.ch-toast.k-sigil{ border-left-color:var(--sigil); } .ch-toast.k-sigil .ic{ color:var(--sigil); }

/* --- crest ribbon (big centred reveal) -------------------------------- */
/* The centre stage holds ONE reveal (hud.js _announce). Off-stage it is
   display:none, so an idle layer can neither paint nor be read off the page. */
.ch-ribbon{
  position:absolute; left:50%; top:38%; transform:translate(-50%,-50%);
  display:none; flex-direction:column; align-items:center; opacity:0; pointer-events:none;
  z-index:${UI_TOKENS.z.ribbon}; width:min(760px,92vw);
}
.ch-ribbon.is-on{ display:flex; }
.ch-ribbon .emblem{ position:relative; width:64px; height:64px; margin-bottom:10px; }
.ch-ribbon .emblem::before{ content:''; position:absolute; inset:0; clip-path:var(--oct);
  background:linear-gradient(160deg,var(--gold-hot),var(--gold) 50%,var(--gold-dim)); }
.ch-ribbon .emblem::after{ content:''; position:absolute; inset:6px; clip-path:var(--oct);
  background:rgba(20,14,30,.9); }
.ch-ribbon .emblem i{ position:absolute; inset:16px; clip-path:var(--oct);
  background:linear-gradient(160deg,#fff,var(--gold-hot)); z-index:1; box-shadow:0 0 14px var(--gold-hot); }
.ch-ribbon .emblem .halo{ position:absolute; inset:-30px; border-radius:50%; clip-path:none;
  background:radial-gradient(circle,rgba(233,195,107,.28),transparent 62%); z-index:0; }
.ch-ribbon .band{
  position:relative; padding:12px 44px 14px; text-align:center;
  background:linear-gradient(90deg,transparent,rgba(40,30,48,.86) 14%,rgba(40,30,48,.86) 86%,transparent);
  border-top:1px solid rgba(233,195,107,.55); border-bottom:1px solid rgba(233,195,107,.55);
}
.ch-ribbon .band::before,.ch-ribbon .band::after{
  content:''; position:absolute; top:-1px; bottom:-1px; width:14%;
}
.ch-ribbon .band::before{ left:0; background:linear-gradient(90deg,transparent,rgba(233,195,107,.0)); }
.ch-ribbon .k{ font-family:var(--f-display); font-weight:700; font-size:${UI_TOKENS.type.sm}px; letter-spacing:.52em;
  margin-left:.52em; text-transform:uppercase; color:var(--gold); text-shadow:0 0 20px var(--gold-glow); }
.ch-ribbon .n{
  margin-top:6px; font-family:var(--f-display); font-weight:700; text-transform:uppercase;
  font-size:clamp(22px,3.6vw,${UI_TOKENS.type['3xl']}px); letter-spacing:.10em; margin-left:.10em; line-height:1.05;
  background:linear-gradient(180deg,#fff 20%,var(--gold-hot) 60%,var(--gold) 110%);
  -webkit-background-clip:text; background-clip:text; color:transparent;
  filter:drop-shadow(0 2px 8px rgba(0,0,0,.8)) drop-shadow(0 10px 30px rgba(0,0,0,.5));
}
.ch-ribbon .s{ margin-top:7px; font-family:var(--f-num); font-weight:700; font-size:${UI_TOKENS.type.sm}px;
  letter-spacing:.34em; margin-left:.34em; color:var(--ink-dim); }

/* --- flashes ---------------------------------------------------------- */
.ch-ring{
  position:absolute; left:50%; top:50%; width:100px; height:100px; margin:-50px 0 0 -50px;
  border-radius:50%; pointer-events:none; opacity:0;
  border:3px solid var(--cp); box-shadow:0 0 60px 6px var(--cp), inset 0 0 40px 2px var(--cp);
  z-index:${UI_TOKENS.z.flash};
}
.ch-vig{
  position:absolute; inset:-2px; pointer-events:none; opacity:0; z-index:${UI_TOKENS.z.flash};
  background:radial-gradient(115% 88% at 50% 50%, transparent 34%, var(--vc,var(--danger)) 128%);
  mix-blend-mode:screen;
}
.ch-word{
  position:absolute; left:50%; top:44%; transform:translate(-50%,-50%);
  font-family:var(--f-display); font-weight:700; text-transform:uppercase;
  font-size:${UI_TOKENS.type['3xl']}px; letter-spacing:.30em; margin-left:.30em;
  color:#fff; opacity:0; pointer-events:none; white-space:nowrap; z-index:${UI_TOKENS.z.flash};
  text-shadow:0 0 40px var(--wc,var(--cp)), 0 4px 30px rgba(0,0,0,.7); text-align:center;
  display:none;
}
.ch-word.is-on{ display:block; }
.ch-word .sub{
  display:block; margin-top:10px; font-size:${UI_TOKENS.type.sm}px; font-weight:700;
  letter-spacing:.38em; margin-left:.38em; color:var(--wc,var(--cp)); opacity:.9;
}

/* --- course clear panel ------------------------------------------------ */
.ch-clear{
  position:absolute; inset:0; display:none; align-items:center; justify-content:center;
  pointer-events:auto; z-index:${UI_TOKENS.z.clear};
  background:radial-gradient(120% 100% at 50% 46%,rgba(12,8,20,.22),rgba(6,4,12,.80) 78%);
  backdrop-filter:blur(6px) saturate(1.05); -webkit-backdrop-filter:blur(6px) saturate(1.05);
}
.ch-clear.on{ display:flex; }
.ch-ccard{ width:min(600px,90vw); padding:34px 40px 26px; border-radius:var(--r-xl); text-align:center; will-change:transform,opacity; }
.ch-ck{ font-family:var(--f-display); font-size:${UI_TOKENS.type.xs}px; font-weight:700; letter-spacing:.52em; margin-left:.52em;
  text-transform:uppercase; color:var(--gold); text-shadow:0 0 24px var(--gold-glow); }
.ch-cname{ margin-top:8px; font-family:var(--f-display); font-size:clamp(24px,3.4vw,${UI_TOKENS.type['3xl']}px); font-weight:700;
  letter-spacing:.05em; line-height:1; text-transform:uppercase; color:#fff; }
.ch-crealm{ margin-top:7px; }
.ch-crealm .cb-eyebrow{ justify-content:center; }
.ch-crealm .cb-eyebrow::before{ display:none; }
.ch-crule{ margin:18px auto 16px; }
.ch-cpips{ display:flex; justify-content:center; gap:9px; }
.ch-cpips .cb-crestpip{ width:22px; height:22px; flex-basis:22px; }
.ch-cpips .cb-crestpip i{ inset:6px; }
.ch-ctime{ margin-top:16px; display:flex; align-items:baseline; justify-content:center; gap:2px;
  font-family:var(--f-num); font-weight:700; color:#fff; line-height:1; }
.ch-ctime .big{ font-size:${UI_TOKENS.type['4xl']}px; letter-spacing:.005em; }
.ch-ctime .ms{ font-size:${UI_TOKENS.type.xl}px; font-weight:600; color:var(--ink-dim); }
.ch-csplit{ margin-top:8px; font-family:var(--f-num); font-size:${UI_TOKENS.type.md}px; font-weight:700;
  letter-spacing:.12em; color:var(--ink-dim); min-height:20px; }
.ch-csplit.ahead{ color:var(--ahead); } .ch-csplit.behind{ color:var(--behind); }
.ch-crecord{
  display:inline-flex; align-items:center; gap:10px; margin-top:12px; padding:6px 16px; border-radius:var(--r-pill);
  font-family:var(--f-display); font-size:${UI_TOKENS.type.sm}px; font-weight:700; letter-spacing:.34em; margin-left:.34em;
  text-transform:uppercase; color:var(--gold-ink);
  background:linear-gradient(100deg,var(--gold),#fff3c4 55%,var(--gold)); background-size:220% 100%;
  animation:cb-sheen 2.6s var(--e-io) infinite; box-shadow:0 0 34px -6px var(--gold);
}
.ch-cgrid{ display:grid; grid-template-columns:repeat(4,1fr); gap:1px; margin-top:22px;
  background:var(--hair); border:1px solid var(--hair); border-radius:var(--r-md); overflow:hidden; }
.ch-ccell{ padding:12px 6px 11px; background:rgba(20,14,30,.45); }
.ch-ccell .k{ font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:700; letter-spacing:.28em;
  text-transform:uppercase; color:var(--ink-mute); }
.ch-ccell .v{ margin-top:6px; font-family:var(--f-num); font-size:${UI_TOKENS.type.lg}px; font-weight:700; color:#fff;
  display:flex; align-items:baseline; justify-content:center; gap:5px; }
.ch-ccell .v small{ font-size:${UI_TOKENS.type.sm}px; font-weight:600; color:var(--ink-mute); }
.ch-cbtns{ display:flex; gap:10px; margin-top:22px; }
.ch-cbtns .cb-btn{ flex:1; }
.ch-chint{ display:flex; align-items:center; justify-content:center; gap:7px; margin-top:16px;
  font-size:${UI_TOKENS.type['2xs']}px; letter-spacing:.26em; text-transform:uppercase; color:var(--ink-mute); opacity:.75; }
.ch-chint .cb-kbd{ min-width:24px; height:21px; font-size:${UI_TOKENS.type['2xs']}px; }
.ch-chint i{ font-style:normal; opacity:.4; margin:0 4px; }

/* --- rolling digits --------------------------------------------------- */
.cb-roll{ display:inline-flex; align-items:baseline; }
.cb-roll-col{ position:relative; display:inline-block; overflow:hidden; height:1em; line-height:1; vertical-align:baseline; }
.cb-roll-col.is-sep{ width:auto; }
.cb-roll-g{ display:block; }
.cb-roll-col > .cb-roll-g:not(:first-child){ position:absolute; left:0; top:0; }

@media (max-width:900px){
  .ch-course{ font-size:${UI_TOKENS.type.xl}px; }
  .ch-timer .big{ font-size:${UI_TOKENS.type.xl}px; }
  .ch-timer .ms{ font-size:${UI_TOKENS.type.md}px; }
  .ch-word{ font-size:${UI_TOKENS.type['2xl']}px; }
  .ch-race .v{ font-size:${UI_TOKENS.type['2xl']}px; }
}
`;

const MENU_CSS = `
/* ===== MENU ============================================================= */
.cb-menu{ position:absolute; inset:0; display:none; pointer-events:auto; z-index:${UI_TOKENS.z.menu}; opacity:0;
  transition:opacity .26s var(--e-out); }
.cb-menu.on{ display:block; opacity:1; }
.cb-menu .cm-scrim{
  position:absolute; inset:0;
  background:
    radial-gradient(130% 105% at 26% 34%,rgba(40,28,52,.30),rgba(8,5,14,.88) 76%),
    linear-gradient(105deg,rgba(8,5,14,.70),rgba(8,5,14,.30) 52%,rgba(8,5,14,.76));
  backdrop-filter:blur(16px) saturate(.9) brightness(.74);
  -webkit-backdrop-filter:blur(16px) saturate(.9) brightness(.74);
}
/* the title stages the live render: a soft left column only */
.cb-menu.is-title .cm-scrim{
  background:linear-gradient(94deg,rgba(8,5,14,.86) 0%,rgba(8,5,14,.66) 26%,rgba(8,5,14,.24) 50%,
    rgba(8,5,14,.04) 68%,rgba(8,5,14,.30) 100%);
  backdrop-filter:blur(2px) saturate(1.08) brightness(.9);
  -webkit-backdrop-filter:blur(2px) saturate(1.08) brightness(.9);
}
.cb-menu.is-confirm .cm-scrim{ background:rgba(8,5,14,.55); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); }
.cb-menu .cm-grain{ position:absolute; inset:0; pointer-events:none; opacity:.35;
  background:repeating-linear-gradient(to bottom,rgba(243,233,210,.028) 0 1px,transparent 1px 3px); mix-blend-mode:overlay; }
.cb-menu .cm-vig{ position:absolute; inset:0; pointer-events:none;
  background:radial-gradient(120% 96% at 50% 50%,transparent 42%,rgba(0,0,0,.66) 100%); }
.cm-page{ position:absolute; inset:0; display:none; }
.cm-page.on{ display:block; }

/* --- title ------------------------------------------------------------- */
.cm-title-wrap{ position:absolute; left:clamp(38px,8vw,132px); top:50%; transform:translateY(-50%); max-width:min(1040px,76vw); }
.cm-eyebrow{ margin-bottom:14px; }
.cm-logo{ display:flex; align-items:center; gap:22px; }
.cm-logo .emb{ position:relative; width:clamp(64px,7.6vw,112px); height:clamp(64px,7.6vw,112px); flex:0 0 auto;
  filter:drop-shadow(0 10px 30px rgba(0,0,0,.7)); }
.cm-logo .emb svg{ width:100%; height:100%; display:block; }
.cm-logo .emb .spin{ position:absolute; inset:-8%; animation:cb-emblemspin 40s linear infinite; opacity:.55; }
.cm-wordmark{
  font-family:var(--f-display); font-weight:700; text-transform:uppercase;
  display:inline-block; width:max-content; max-width:100%; padding-right:.12em;
  font-size:clamp(44px,7.3vw,116px); line-height:.86; letter-spacing:.06em;
  background:linear-gradient(96deg,#c9a14f 0%,#fff6dc 24%,#ffd166 42%,#f7b955 60%,#8a5a22 100%);
  background-size:260% 100%;
  -webkit-background-clip:text; background-clip:text; color:transparent;
  filter:drop-shadow(0 8px 34px rgba(0,0,0,.75));
  animation:cb-sheen 8s var(--e-io) infinite;
}
.cm-sub{ margin-top:10px; font-family:var(--f-display); font-size:clamp(12px,1.5vw,17px); font-weight:700;
  letter-spacing:.44em; margin-left:.44em; text-transform:uppercase; color:var(--ink-dim); }
.cm-rule{ position:relative; height:2px; margin:26px 0 30px; width:min(420px,52vw);
  transform-origin:left center; animation:cb-rule .9s var(--e-out) both; }
.cm-rule::before{ content:''; position:absolute; inset:0; background:linear-gradient(90deg,var(--gold),rgba(255,255,255,0) 88%); }
.cm-rule::after{ content:''; position:absolute; left:0; top:-2px; width:64px; height:6px;
  background:linear-gradient(90deg,var(--gold-hot),transparent); filter:blur(4px); opacity:.9;
  animation:cb-ruleglow 3.4s var(--e-io) infinite; }
.cm-menu-list{ display:flex; flex-direction:column; gap:6px; width:min(360px,46vw); }
.cm-version{ position:absolute; left:clamp(38px,8vw,132px); bottom:34px; font-family:var(--f-num); font-weight:600;
  font-size:${UI_TOKENS.type['2xs']}px; letter-spacing:.28em; text-transform:uppercase; color:var(--ink-mute); opacity:.75;
  text-shadow:0 1px 10px rgba(0,0,0,.8); }
.cm-version b{ color:var(--ink-dim); font-weight:700; }
.cm-title-stats{ position:absolute; right:clamp(38px,7vw,96px); bottom:34px; text-align:right; display:flex; gap:30px;
  text-shadow:0 1px 12px rgba(0,0,0,.85), 0 0 1px rgba(0,0,0,.8); }
.cm-tstat .k{ font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:700; letter-spacing:.30em;
  text-transform:uppercase; color:var(--ink-mute); }
.cm-tstat .v{ margin-top:4px; font-family:var(--f-num); font-size:${UI_TOKENS.type.lg}px; font-weight:700; color:var(--ink);
  display:flex; align-items:center; justify-content:flex-end; gap:6px; }
.cm-tstat .v .cb-crestpip{ width:14px; height:14px; flex-basis:14px; }
.cm-tstat .v .cb-crestpip i{ inset:4px; }

/* --- panel pages -------------------------------------------------------- */
.cm-panel{ position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:min(760px,90vw);
  max-height:min(86vh,880px); display:flex; flex-direction:column; padding:0; overflow:hidden; }
.cm-panel.wide{ width:min(900px,92vw); }
.cm-panel.narrow{ width:min(520px,88vw); }
.cm-head{ display:flex; align-items:flex-end; justify-content:space-between; gap:20px; padding:24px 30px 16px;
  border-bottom:1px solid var(--hair); position:relative; z-index:1; }
.cm-head .h-l{ min-width:0; }
.cm-head .h-eyebrow{ margin-bottom:6px; }
.cm-head h2{ font-family:var(--f-display); font-size:${UI_TOKENS.type['2xl']}px; font-weight:700; letter-spacing:.07em;
  text-transform:uppercase; color:#fff; line-height:1; margin:0; }
.cm-head .h-r{ text-align:right; display:flex; gap:24px; flex:0 0 auto; }
.cm-hstat .k{ font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:700; letter-spacing:.26em;
  text-transform:uppercase; color:var(--ink-mute); }
.cm-hstat .v{ margin-top:3px; font-family:var(--f-num); font-size:${UI_TOKENS.type.md}px; font-weight:700; color:var(--ink);
  display:flex; align-items:center; gap:6px; justify-content:flex-end; }
.cm-body{ padding:18px 24px 28px; overflow-y:auto; overflow-x:hidden; flex:1 1 auto; position:relative; z-index:1;
  scrollbar-width:thin; scrollbar-color:rgba(243,233,210,.18) transparent; }
.cm-body::-webkit-scrollbar{ width:8px }
.cm-body::-webkit-scrollbar-thumb{ background:rgba(243,233,210,.16); border-radius:4px }
/* A page's own action buttons live OUTSIDE the scrolling body, between it and
   the footer legend. Inside .cm-body the last button is clipped by the scroll
   viewport's bottom edge and reads as a control sliced in half by the footer
   bar (credits' BACK). flex:0 0 auto keeps this row whole at every height. */
.cm-actions{ flex:0 0 auto; display:flex; gap:12px; padding:12px 24px 4px; position:relative; z-index:1;
  border-top:1px solid var(--hair); }
.cm-actions .cb-btn{ flex:1 1 auto; }
.cm-foot{ display:flex; align-items:center; justify-content:space-between; gap:16px; padding:12px 30px 16px;
  border-top:1px solid var(--hair); font-size:${UI_TOKENS.type['2xs']}px; letter-spacing:.24em; text-transform:uppercase;
  color:var(--ink-mute); position:relative; z-index:1; font-family:var(--f-display); font-weight:700; }
.cm-foot .keys{ display:flex; gap:14px; align-items:center; }
.cm-foot .keys span{ display:flex; gap:6px; align-items:center; }
.cm-foot .brand{ color:var(--gold); opacity:.8; letter-spacing:.34em; }
.cm-group-title{ margin:16px 12px 6px; font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:700;
  letter-spacing:.34em; text-transform:uppercase; color:var(--gold); opacity:.9; display:flex; align-items:center; gap:10px; }
.cm-group-title::after{ content:''; flex:1; height:1px; background:linear-gradient(90deg,rgba(233,195,107,.35),transparent); }
.cm-group-title:first-child{ margin-top:4px; }
.cm-list{ display:flex; flex-direction:column; gap:5px; padding:4px 6px; }

/* --- controls page ----------------------------------------------------- */
.cm-ctlhead{ display:grid; grid-template-columns:1.1fr 1.3fr 150px; gap:14px; padding:6px 14px 8px;
  font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:700; letter-spacing:.30em;
  text-transform:uppercase; color:var(--ink-mute); border-bottom:1px solid var(--hair); margin-bottom:6px; }
.cm-ctlrow{ display:grid; grid-template-columns:1.1fr 1.3fr 150px; gap:14px; align-items:center; padding:8px 14px;
  border-radius:var(--r-md); border:1px solid transparent; cursor:default;
  transition:background .15s var(--e-out), box-shadow .15s var(--e-out); }
.cm-ctlrow[data-nav]{ cursor:pointer; }
.cm-ctlrow:hover,.cm-ctlrow.is-focus{ background:rgba(243,233,210,.06); box-shadow:inset 2px 0 0 var(--gold); }
.cm-ctlrow .nm{ font-family:var(--f-display); font-size:${UI_TOKENS.type.base}px; font-weight:700; letter-spacing:.12em;
  text-transform:uppercase; color:var(--ink-dim); }
.cm-ctlrow .nm small{ display:block; font-family:var(--f-body); font-weight:400; font-size:${UI_TOKENS.type.xs}px;
  letter-spacing:.02em; text-transform:none; color:var(--ink-mute); margin-top:2px; }
.cm-ctlrow.is-focus .nm{ color:var(--ink); }
.cm-ctlrow .keys{ display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
.cm-ctlrow .keys .how{ font-family:var(--f-body); font-size:${UI_TOKENS.type.xs}px; color:var(--ink-mute); letter-spacing:.02em; }
.cm-ctlrow .pad{ display:flex; gap:5px; align-items:center; flex-wrap:wrap; }
.cm-ctlrow.is-listening{ background:rgba(233,195,107,.12); box-shadow:inset 2px 0 0 var(--gold); }

/* --- credits ----------------------------------------------------------- */
.cm-credits{ padding:10px 20px 20px; }
.cm-credits .c-block{ margin-bottom:22px; }
.cm-credits .c-k{ font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:700; letter-spacing:.34em;
  text-transform:uppercase; color:var(--gold); margin-bottom:7px; }
.cm-credits .c-v{ font-size:${UI_TOKENS.type.base}px; color:var(--ink-dim); line-height:1.7; letter-spacing:.01em; }
.cm-credits .c-v b{ color:var(--ink); font-weight:600; }

/* --- confirm ------------------------------------------------------------ */
.cm-confirm-text{ padding:8px 12px 18px; font-size:${UI_TOKENS.type.md}px; line-height:1.55; color:var(--ink); text-align:center; }
.cm-confirm-btns{ display:flex; gap:10px; padding:0 6px 4px; }
.cm-confirm-btns .cb-btn{ flex:1; }
`;

const CARD_CSS = `
/* ===== COURSE CARD (painting frame) ===================================== */
.cb-card{ position:absolute; inset:0; display:none; align-items:center; justify-content:center; pointer-events:auto;
  z-index:${UI_TOKENS.z.card}; opacity:0; transition:opacity .24s var(--e-out);
  background:radial-gradient(120% 100% at 50% 50%,rgba(12,8,20,.18),rgba(6,4,12,.78) 80%);
  backdrop-filter:blur(5px) saturate(1.05); -webkit-backdrop-filter:blur(5px) saturate(1.05); }
.cb-card.on{ display:flex; opacity:1; }
.cc-frame{
  position:relative; width:min(640px,92vw); padding:14px; border-radius:var(--r-lg);
  background:
    linear-gradient(135deg,#5a3d17,#b58a3c 18%,#f1d68a 30%,#b58a3c 44%,#6a4a1c 58%,#c9a04a 74%,#f1d68a 86%,#5a3d17);
  box-shadow:0 40px 90px -30px rgba(0,0,0,.95), 0 0 0 1px rgba(0,0,0,.5), inset 0 0 0 2px rgba(255,240,200,.28);
  will-change:transform,opacity;
}
.cc-frame::before{ content:''; position:absolute; inset:5px; border-radius:calc(var(--r-lg) - 4px); pointer-events:none;
  border:2px solid rgba(60,36,10,.55); box-shadow:inset 0 0 0 1px rgba(255,240,200,.35); }
.cc-frame::after{ content:''; position:absolute; inset:0; border-radius:inherit; pointer-events:none;
  background:repeating-linear-gradient(135deg,rgba(255,255,255,.06) 0 2px,transparent 2px 9px); mix-blend-mode:overlay; }
.cc-frame .cc-orn{ position:absolute; width:26px; height:26px; pointer-events:none; z-index:2;
  background:radial-gradient(circle at 50% 50%,var(--gold-hot) 0 22%,#8a5a22 24% 34%,transparent 36%),
    conic-gradient(from 0deg,var(--gold),#7a4e18,var(--gold-hot),#7a4e18,var(--gold));
  clip-path:var(--oct); box-shadow:0 2px 6px rgba(0,0,0,.6); }
.cc-frame .cc-orn.tl{ left:-4px; top:-4px; } .cc-frame .cc-orn.tr{ right:-4px; top:-4px; }
.cc-frame .cc-orn.bl{ left:-4px; bottom:-4px; } .cc-frame .cc-orn.br{ right:-4px; bottom:-4px; }
.cc-plate{ position:relative; border-radius:var(--r-md); overflow:hidden;
  background:linear-gradient(170deg,rgba(38,28,48,.96),rgba(22,16,32,.98)); border:1px solid rgba(0,0,0,.6); }
.cc-paint{ position:relative; height:190px; overflow:hidden; }
.cc-paint canvas{ display:block; width:100%; height:100%; }
/* The scrim is a pseudo-element, so it paints LAST — over the lockup, which is
   what turned a #fff title into mid-grey and let the painted landmark cut
   through it. It belongs UNDER the type: z-index 1 for the scrim, 2 for the
   text. The second stop is a tighter band right behind the lockup, so the
   silhouette behind the title is darkened rather than the title itself. */
.cc-paint::after{ content:''; position:absolute; inset:0; pointer-events:none; z-index:1;
  background:linear-gradient(180deg,rgba(0,0,0,0) 28%,rgba(22,16,32,.62) 62%,rgba(16,11,25,.94) 100%),
             radial-gradient(120% 90% at 50% 34%,transparent 46%,rgba(0,0,0,.38)); }
.cc-paint .cc-glint{ position:absolute; top:-20%; bottom:-20%; width:30%; left:0; pointer-events:none;
  background:linear-gradient(90deg,transparent,rgba(255,244,214,.18),transparent); animation:cb-glint 3.8s var(--e-io) infinite; }
.cc-paint .cc-title{ position:absolute; left:26px; right:150px; bottom:16px; z-index:2; }
.cc-paint .cc-realm{ text-shadow:0 1px 10px rgba(0,0,0,.9); }
.cc-paint .cc-name{ margin-top:5px; font-family:var(--f-display); font-weight:700; text-transform:uppercase;
  font-size:clamp(24px,3.6vw,38px); letter-spacing:.06em; line-height:1; color:#fff;
  text-shadow:0 2px 22px rgba(6,4,12,.98), 0 1px 3px rgba(6,4,12,.95), 0 0 1px rgba(6,4,12,.9); }
.cc-paint .cc-subtitle{ margin-top:6px; font-family:var(--f-body); font-size:${UI_TOKENS.type.sm}px; color:var(--ink-dim);
  letter-spacing:.02em; text-shadow:0 1px 8px rgba(0,0,0,.9); }
/* DIFFICULTY sat unplated on the painted hill and vanished. Its own chip. */
.cc-paint .cc-diff{ position:absolute; right:22px; bottom:16px; z-index:2;
  display:flex; flex-direction:column; align-items:flex-end; gap:5px;
  padding:6px 10px 7px; border-radius:var(--r-sm);
  background:rgba(14,9,24,.62); border:1px solid var(--hair); }
.cc-paint .cc-diff .k{ font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:700; letter-spacing:.3em;
  text-transform:uppercase; color:var(--ink-dim); text-shadow:0 1px 8px rgba(0,0,0,.9); }
.cc-paint .cc-diff .cb-dots i{ background:rgba(243,233,210,.30); box-shadow:inset 0 0 0 1px rgba(243,233,210,.22); }
.cc-paint .cc-diff .cb-dots i.on{ background:var(--gold); box-shadow:0 0 6px var(--gold-glow); }
.cc-paint .cc-diff .cb-dots i.hot{ background:var(--danger); box-shadow:0 0 6px rgba(255,95,74,.6); }
.cc-body{ padding:16px 24px 18px; }
.cc-crests{ display:grid; grid-template-columns:repeat(7,1fr); gap:6px; }
.cc-slot{ display:flex; flex-direction:column; align-items:center; gap:7px; padding:9px 4px 8px; border-radius:var(--r-md);
  background:rgba(243,233,210,.04); border:1px solid var(--hair-soft); min-height:72px; }
.cc-slot .cb-crestpip{ width:22px; height:22px; flex-basis:22px; }
.cc-slot .cb-crestpip i{ inset:6px; }
.cc-slot .nm{ font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:700; letter-spacing:.10em;
  text-transform:uppercase; color:var(--ink-mute); text-align:center; line-height:1.25; }
.cc-slot.is-got{ background:rgba(233,195,107,.09); border-color:rgba(233,195,107,.32); }
.cc-slot.is-got .nm{ color:var(--ink); }
.cc-slot .best{ font-family:var(--f-num); font-weight:600; font-size:${UI_TOKENS.type['2xs']}px; letter-spacing:.06em; color:var(--gold); }
.cc-stats{ display:grid; grid-template-columns:repeat(3,1fr); gap:1px; margin-top:12px; background:var(--hair);
  border:1px solid var(--hair); border-radius:var(--r-md); overflow:hidden; }
.cc-stat{ padding:10px 6px 9px; background:rgba(20,14,30,.5); text-align:center; }
.cc-stat .k{ font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:700; letter-spacing:.28em;
  text-transform:uppercase; color:var(--ink-mute); }
.cc-stat .v{ margin-top:5px; font-family:var(--f-num); font-size:${UI_TOKENS.type.lg}px; font-weight:700; color:#fff;
  display:flex; align-items:baseline; justify-content:center; gap:4px; }
.cc-stat .v small{ font-size:${UI_TOKENS.type.sm}px; font-weight:600; color:var(--ink-mute); }
.cc-stat .v.gold{ color:var(--gold); }
.cc-btns{ display:flex; gap:10px; margin-top:16px; }
.cc-btns .cb-btn{ flex:1; }
.cc-hint{ display:flex; align-items:center; justify-content:center; gap:7px; margin-top:12px;
  font-family:var(--f-display); font-weight:700; font-size:${UI_TOKENS.type['2xs']}px; letter-spacing:.26em;
  text-transform:uppercase; color:var(--ink-mute); opacity:.75; }
.cc-hint .cb-kbd{ min-width:24px; height:21px; font-size:${UI_TOKENS.type['2xs']}px; }
.cc-hint i{ font-style:normal; opacity:.4; margin:0 4px; }
@media (max-width:640px){ .cc-crests{ grid-template-columns:repeat(4,1fr); } .cc-paint{ height:150px; } }
`;

const TRANS_CSS = `
/* ===== TRANSITIONS ====================================================== */
.cb-trans{ position:absolute; inset:0; pointer-events:none; z-index:${UI_TOKENS.z.trans}; overflow:hidden; contain:strict; }
.cb-trans > div{ position:absolute; inset:0; pointer-events:none; }
.ct-fade{ opacity:0; background:var(--tc,#0b0a16); will-change:opacity; }
/* IRIS. A clip-path circle paints only what is INSIDE it, which is the wrong way
   round for a storybook iris (the screen must stay covered EXCEPT for a shrinking
   hole on the hero). So the layer is transparent and the child <i> is a circle
   whose enormous box-shadow spread fills everything outside it; scaling the child
   scales the hole AND its shadow, so the screen is covered at scale 0 and clear
   at full scale — one compositor-only transform, no clip-path interpolation. */
.ct-iris{ background:none; opacity:0; }
.ct-iris.is-on{ opacity:1; }
.ct-iris i{
  position:absolute; left:50%; top:50%; width:200px; height:200px; margin:-100px 0 0 -100px;
  border-radius:50%; background:transparent; transform:scale(0); will-change:transform;
  box-shadow:0 0 0 9999px var(--tc,#0b0a16), inset 0 0 26px 10px var(--tc,#0b0a16);
}
.ct-iris u{
  position:absolute; left:50%; top:50%; width:200px; height:200px; margin:-100px 0 0 -100px;
  border-radius:50%; transform:scale(0); will-change:transform; pointer-events:none;
  border:2px solid rgba(233,195,107,.55); box-shadow:0 0 22px rgba(233,195,107,.35);
}
.ct-wipe{ transform:translateX(-102%); will-change:transform; opacity:0;
  background:linear-gradient(100deg,var(--tc,#0b0a16) 0%,var(--tc,#0b0a16) 88%,rgba(233,195,107,.85) 92%,transparent 100%); }
.ct-wipe.is-on{ opacity:1; }
.ct-rewind{ opacity:0; will-change:opacity;
  background:
    radial-gradient(110% 85% at 50% 50%,transparent 38%,rgba(60,42,20,.55) 80%,rgba(20,12,4,.92) 120%),
    repeating-linear-gradient(to bottom,rgba(255,236,190,.06) 0 2px,transparent 2px 5px);
  mix-blend-mode:normal; }
.ct-rewind .rw-lines{ position:absolute; inset:0; overflow:hidden; opacity:.55; }
.ct-rewind .rw-lines i{ position:absolute; left:-10%; width:120%; height:1px;
  background:linear-gradient(90deg,transparent,rgba(255,236,190,.65),transparent); }
.ct-rewind .rw-lines i:nth-child(1){ top:22%; } .ct-rewind .rw-lines i:nth-child(2){ top:47%; }
.ct-rewind .rw-lines i:nth-child(3){ top:71%; } .ct-rewind .rw-lines i:nth-child(4){ top:88%; }
.ct-rewind.is-on .rw-lines i{ animation:cb-drift .5s linear infinite reverse; }
/* BOTTOM-CENTRE, not bottom-right: the page's own control cluster
   (game_controls.js — fullscreen / mute / pause) is fixed at bottom:8px
   right:8px on every ForgeFlow game page, and the badge was drawn straight on
   top of it. The corner belongs to that cluster; the game keeps the centre. */
.ct-rewind .rw-glyph{ position:absolute; left:0; right:0; bottom:${UI_TOKENS.corner.h + 6}px;
  display:flex; align-items:center; justify-content:center; gap:8px;
  font-family:var(--f-display); font-weight:700; font-size:${UI_TOKENS.type.xs}px; letter-spacing:.42em;
  text-transform:uppercase; color:rgba(255,236,190,.85); text-shadow:0 1px 10px rgba(0,0,0,.9); }
.ct-rewind .rw-glyph svg{ width:16px; height:16px; }
`;

/** Idempotent. Injects the whole design system into a single <style> tag. */
export function injectStyles() {
  if (_injected && document.getElementById(STYLE_ID)) return;
  let tag = document.getElementById(STYLE_ID);
  if (!tag) {
    tag = document.createElement('style');
    tag.id = STYLE_ID;
    document.head.appendChild(tag);
  }
  tag.textContent = CSS + HUD_CSS + MENU_CSS + CARD_CSS + TRANS_CSS;
  _injected = true;
}

/* ---------------------------------------------------------------------------
 * 5. LIVE THEME TINT  — one call re-tints every surface
 * -------------------------------------------------------------------------*/

let _themeKey = null;

/**
 * Re-tint the whole interface from a ThemeDef (or a bare palette object).
 * Sets --accent / --accent-dim / --accent-hot / --accent-glow / --accent-ink,
 * --safe, --danger, --cp, --crest, --sigil, --coin on :root. Cheap + deduped.
 */
export function setUITheme(theme, key) {
  if (!theme) return;
  const k = key || theme.id || theme.name || null;
  if (k && k === _themeKey) return;
  _themeKey = k;
  const p = theme.palette || theme;
  const st = document.documentElement.style;
  const acc = readable(cssColor(p.accent ?? p.checkpointOn ?? BASE_PALETTE.accent), 0.30);
  st.setProperty('--accent', acc);
  st.setProperty('--accent-dim', mixColor(acc, '#120a1c', 0.58));
  st.setProperty('--accent-hot', mixColor(acc, '#ffffff', 0.62));
  st.setProperty('--accent-glow', alphaColor(acc, 0.5));
  st.setProperty('--accent-ink', luminance(acc) > 0.42 ? '#0a1410' : '#f6fff9');
  st.setProperty('--safe', readable(cssColor(p.safeEdge ?? p.safe ?? BASE_PALETTE.safe), 0.36));
  st.setProperty('--danger', readable(cssColor(p.killGlow ?? p.kill ?? BASE_PALETTE.danger), 0.26));
  st.setProperty('--cp', readable(cssColor(p.checkpointOn ?? p.checkpoint ?? BASE_PALETTE.checkpoint), 0.36));
  st.setProperty('--crest', readable(cssColor(p.crest ?? BASE_PALETTE.crest), 0.42));
  st.setProperty('--sigil', readable(cssColor(p.sigil ?? BASE_PALETTE.sigil), 0.30));
  st.setProperty('--coin', readable(cssColor(p.coin ?? BASE_PALETTE.coin), 0.42));
}

/** Cause -> HUD colour + wordmark for death flashes. */
export const CAUSE = {
  lava: { color: '#ff6a2a', label: 'INCINERATED' },
  void: { color: '#8f9fff', label: 'FELL' },
  spike: { color: '#ff4f6d', label: 'IMPALED' },
  crush: { color: '#ffa63d', label: 'CRUSHED' },
  saw: { color: '#ff5546', label: 'SHREDDED' },
  toxic: { color: '#a7ff5a', label: 'POISONED' },
  gnasher: { color: '#ff7a3d', label: 'GNASHED' },
  warden: { color: '#ff4f4f', label: 'FLATTENED' },
  drown: { color: '#5fb8ff', label: 'DROWNED' },
  fall: { color: '#8f9fff', label: 'FELL' },
  laser: { color: '#ff3d6e', label: 'VAPORISED' },
  beam: { color: '#ff3d6e', label: 'VAPORISED' },
  manual: { color: '#b9a98a', label: 'RESET' },
};
export function causeInfo(cause) {
  return CAUSE[cause] || { color: 'var(--danger)', label: String(cause || 'LOST').toUpperCase() };
}

/* ---------------------------------------------------------------------------
 * 6. DOM HELPERS
 * -------------------------------------------------------------------------*/

/** el('div','cls','<b>html</b>') */
export function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

/** A cached text node inside `parent` — write via node.nodeValue (no node churn). */
export function textNode(parent, initial) {
  const t = document.createTextNode(initial == null ? '' : initial);
  parent.appendChild(t);
  return t;
}

/** Restart-safe one-shot animation via WAAPI (no forced reflow). */
export function animateOnce(node, frames, opts) {
  if (!node || typeof node.animate !== 'function') return null;
  try {
    return node.animate(frames, Object.assign({ fill: 'both', easing: UI_TOKENS.ease.out }, opts));
  } catch (e) { return null; }
}

/** Retrigger a CSS class animation (remove → reflow → add) with a cleanup timer. */
export function pulseClass(node, cls, ms) {
  if (!node) return;
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
  setTimeout(() => node.classList.remove(cls), ms || 500);
}

const ICONS = {
  skull:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 2.6c-4.4 0-7.6 3-7.6 7.1 0 2.4 1 4 2.3 5 .5.4.8 1 .8 1.6v1.3c0 .8.6 1.4 1.4 1.4h6.2c.8 0 1.4-.6 1.4-1.4v-1.3c0-.6.3-1.2.8-1.6 1.3-1 2.3-2.6 2.3-5 0-4.1-3.2-7.1-7.6-7.1Z"/>' +
    '<circle cx="9.1" cy="10.4" r="1.7" fill="currentColor" stroke="none"/><circle cx="14.9" cy="10.4" r="1.7" fill="currentColor" stroke="none"/>' +
    '<path d="M11 14.6h2M10.4 19v2.4M13.6 19v2.4"/></svg>',
  coin:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">' +
    '<circle cx="12" cy="12" r="8.6" fill="currentColor" fill-opacity=".18"/><circle cx="12" cy="12" r="5.4" opacity=".7"/>' +
    '<path d="M12 8.6v6.8" stroke-linecap="round"/></svg>',
  sigil:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round">' +
    '<path d="M12 2.8 21.2 12 12 21.2 2.8 12Z" fill="currentColor" fill-opacity=".16"/><path d="M12 7.6 16.4 12 12 16.4 7.6 12Z"/></svg>',
  crest:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">' +
    '<path d="M8.2 2.8h7.6l5.4 5.4v7.6l-5.4 5.4H8.2l-5.4-5.4V8.2Z" fill="currentColor" fill-opacity=".16"/>' +
    '<path d="M12 7.4l1.5 3.1 3.4.5-2.45 2.4.6 3.4L12 15.2l-3.05 1.6.6-3.4L7.1 11l3.4-.5Z" fill="currentColor"/></svg>',
  heart:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.4-4.6-9.6-9.2C1 8.6 2.9 4.8 6.6 4.4c2-.2 3.8.7 5.4 2.4 1.6-1.7 3.4-2.6 5.4-2.4 3.7.4 5.6 4.2 4.2 7.4C19.4 16.4 12 21 12 21Z"/></svg>',
  flag:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M6 21V4.2M6 4.6c4-2 7 2 11 0v8.6c-4 2-7-2-11 0"/></svg>',
  chevron:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5.5 16 12l-7 6.5"/></svg>',
  tick:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.6 12.6 9.6 17.6 19.4 6.6"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="8.4"/><path d="M12 7.2V12l3.2 2"/></svg>',
  lock:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' +
    '<rect x="4.6" y="10.4" width="14.8" height="10.4" rx="2.2"/><path d="M8.2 10.4V7.6a3.8 3.8 0 0 1 7.6 0v2.8"/><path d="M12 14.6v2.6"/></svg>',
  warn:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.4 21.6 20H2.4Z"/><path d="M12 9.6v4.6M12 17.2h.01"/></svg>',
  keep:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">' +
    '<path d="M4 21V9l2-2V4h3v3h2V4h2v3h2V4h3v3l2 2v12Z"/><path d="M10 21v-5h4v5"/></svg>',
  rewind:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 6v12L2.5 12ZM21 6v12l-8.5-6Z"/></svg>',
  wing:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 19c-5-1-8-5-9.5-11 4 .5 6.5 2.5 9.5 6 3-3.5 5.5-5.5 9.5-6C20 14 17 18 12 19Z"/><path d="M12 14v5"/></svg>',
  pad:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="2.6" y="7" width="18.8" height="10" rx="4.4"/><path d="M7 10.4v3.2M5.4 12h3.2"/><circle cx="16.2" cy="11" r="1"/><circle cx="18.4" cy="13.2" r="1"/></svg>',
};

/** Inline SVG icon markup (currentColor driven). */
export function icon(name) { return ICONS[name] || ''; }

/** The CRESTBOUND emblem: nested gold octagons + an eight-point star. */
export function emblemSVG(size) {
  const s = size || 96;
  return '<svg viewBox="0 0 100 100" width="' + s + '" height="' + s + '">' +
    '<defs><linearGradient id="cbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1c2"/><stop offset=".5" stop-color="#e9c36b"/><stop offset="1" stop-color="#8a5a22"/></linearGradient></defs>' +
    '<polygon points="29,3 71,3 97,29 97,71 71,97 29,97 3,71 3,29" fill="url(#cbg)"/>' +
    '<polygon points="32,9 68,9 91,32 91,68 68,91 32,91 9,68 9,32" fill="#1a1230"/>' +
    '<polygon points="35,15 65,15 85,35 85,65 65,85 35,85 15,65 15,35" fill="none" stroke="#e9c36b" stroke-width="1.2" opacity=".7"/>' +
    '<path d="M50 24l6 17 17 6-17 6-6 17-6-17-17-6 17-6Z" fill="url(#cbg)"/>' +
    '<circle cx="50" cy="50" r="5" fill="#1a1230"/><circle cx="50" cy="50" r="2.4" fill="#fff1c2"/></svg>';
}

/* ---------------------------------------------------------------------------
 * 7. WIDGET KIT
 * -------------------------------------------------------------------------*/

/** Menu-style button (class cb-btn). Returns the element (.setSub / .setLabel / .setDisabled / __activate). */
export function makeButton(label, opts) {
  const o = opts || {};
  const b = el('button', 'cb-btn' + (o.cls ? ' ' + o.cls : ''));
  b.type = 'button';
  b.setAttribute('data-nav', '1');
  const mark = el('span', 'cb-btn-mark');
  const txt = el('span', 'cb-btn-label');
  txt.textContent = label;
  b.appendChild(mark); b.appendChild(txt);
  let sub = null;
  b.setSub = (s) => {
    if (!s) { if (sub) { sub.remove(); sub = null; } return; }
    if (!sub) { sub = el('span', 'cb-btn-sub'); b.appendChild(sub); }
    sub.textContent = s;
  };
  b.setLabel = (s) => { txt.textContent = s; };
  b.setDisabled = (v) => { b.classList.toggle('is-disabled', !!v); b.disabled = !!v; };
  if (o.sub) b.setSub(o.sub);
  if (o.primary) b.classList.add('is-primary');
  if (o.danger) b.classList.add('is-danger');
  if (o.centered) b.classList.add('centered');
  if (o.onClick) b.addEventListener('click', (e) => { e.preventDefault(); o.onClick(e); });
  b.__activate = () => { if (!b.disabled && o.onClick) o.onClick(); };
  return b;
}

/** Segmented control. opts:{options:[{v,label}], value, onChange} */
export function makeSegmented(opts) {
  const o = opts || {};
  const wrap = el('div', 'cb-seg');
  const cells = [];
  let value = o.value;
  (o.options || []).forEach((op) => {
    const c = el('b');
    c.textContent = op.label != null ? op.label : String(op.v).toUpperCase();
    c.addEventListener('click', () => set(op.v, true));
    cells.push({ v: op.v, node: c });
    wrap.appendChild(c);
  });
  function paint() { for (const c of cells) c.node.classList.toggle('is-on', c.v === value); }
  function set(v, fire) {
    if (v === value) return;
    value = v; paint();
    if (fire && o.onChange) o.onChange(v);
  }
  function step(dir) {
    const i = cells.findIndex((c) => c.v === value);
    const n = clamp((i < 0 ? 0 : i) + dir, 0, cells.length - 1);
    if (cells[n]) set(cells[n].v, true);
  }
  paint();
  wrap.__adjust = step;
  wrap.__activate = () => step(1);
  wrap.set = (v) => set(v, false);
  wrap.get = () => value;
  return wrap;
}

/** Custom slider (pointer + keyboard + wheel). opts:{min,max,step,value,format,onChange} */
export function makeSlider(opts) {
  const o = opts || {};
  const min = o.min != null ? o.min : 0;
  const max = o.max != null ? o.max : 1;
  const step = o.step || 0.01;
  const fmt = o.format || ((v) => v.toFixed(2));
  let value = clamp(o.value != null ? o.value : min, min, max);

  const wrap = el('div', 'cb-slider');
  const track = el('div', 'cb-sl-track');
  const fill = el('div', 'cb-sl-fill');
  const knob = el('div', 'cb-sl-knob');
  const val = el('div', 'cb-sl-val');
  track.appendChild(fill); track.appendChild(knob);
  wrap.appendChild(track); wrap.appendChild(val);

  function paint() {
    const t = (value - min) / (max - min || 1);
    fill.style.transform = 'scaleX(' + t.toFixed(4) + ')';
    knob.style.left = (t * 100).toFixed(3) + '%';
    val.textContent = fmt(value);
  }
  function set(v, fire) {
    const q = clamp(Math.round(v / step) * step, min, max);
    const r = Math.abs(q) < 1e-9 ? 0 : q;
    if (Math.abs(r - value) < 1e-9) { paint(); return; }
    value = r; paint();
    if (fire && o.onChange) o.onChange(value);
  }
  function fromEvent(e) {
    const r = track.getBoundingClientRect();
    if (r.width <= 0) return;
    set(min + ((e.clientX - r.left) / r.width) * (max - min), true);
  }
  let dragging = false;
  track.addEventListener('pointerdown', (e) => {
    dragging = true;
    try { track.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    fromEvent(e); e.preventDefault();
  });
  track.addEventListener('pointermove', (e) => { if (dragging) fromEvent(e); });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    try { track.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
  wrap.addEventListener('wheel', (e) => { e.preventDefault(); set(value - Math.sign(e.deltaY) * step, true); }, { passive: false });

  paint();
  wrap.__adjust = (dir) => set(value + dir * step, true);
  wrap.set = (v) => set(v, false);
  wrap.get = () => value;
  return wrap;
}

/** Toggle switch. opts:{value,onChange} */
export function makeToggle(opts) {
  const o = opts || {};
  let value = !!o.value;
  const outer = el('div', 'cb-toggle-wrap');
  const t = el('div', 'cb-toggle');
  t.appendChild(el('i'));
  outer.appendChild(t);
  function paint() { t.classList.toggle('is-on', value); }
  function set(v, fire) {
    v = !!v;
    if (v === value) return;
    value = v; paint();
    if (fire && o.onChange) o.onChange(value);
  }
  t.addEventListener('click', () => set(!value, true));
  paint();
  outer.__activate = () => set(!value, true);
  outer.__adjust = (dir) => set(dir > 0, true);
  outer.set = (v) => set(v, false);
  outer.get = () => value;
  return outer;
}

/** A settings row: label (+hint) on the left, a control on the right. */
export function makeRow(name, hint, control) {
  const row = el('div', 'cb-row');
  row.setAttribute('data-nav', '1');
  row.tabIndex = -1;
  const l = el('div', 'cb-row-name');
  l.appendChild(document.createTextNode(name));
  if (hint) { const h = el('span', 'cb-row-hint'); h.textContent = hint; l.appendChild(h); }
  row.appendChild(l);
  const holder = el('div', 'cb-row-ctl');
  holder.appendChild(control);
  row.appendChild(holder);
  row.__control = control;
  row.__activate = () => { if (control.__activate) control.__activate(); };
  row.__adjust = (d) => { if (control.__adjust) control.__adjust(d); };
  return row;
}

/** Difficulty pips (1..max, default 5; the top pip burns red at max). */
export function makeDots(level, max) {
  const n = max || 5;
  const d = el('div', 'cb-dots');
  const lv = clamp(level | 0, 0, n);
  for (let i = 0; i < n; i++) {
    const dot = el('i');
    if (i < lv) dot.classList.add(lv >= n && i === n - 1 ? 'hot' : 'on');
    d.appendChild(dot);
  }
  return d;
}

/** One octagonal crest pip. `.set(got, pop)` flips it; returns the node. */
export function makeCrestPip(got) {
  const p = el('div', 'cb-crestpip');
  p.appendChild(el('i'));
  p.__got = false;
  p.set = (g, pop) => {
    g = !!g;
    if (g === p.__got) return;
    p.__got = g;
    p.classList.toggle('is-got', g);
    if (g && pop) pulseClass(p, 'is-pop', 600);
  };
  p.set(got, false);
  return p;
}

/** One sigil pip (diamond). `.set(got, pop)`. */
export function makeSigilPip(got) {
  const p = el('div', 'cb-sigpip');
  p.__got = false;
  p.set = (g, pop) => {
    g = !!g;
    if (g === p.__got) return;
    p.__got = g;
    p.classList.toggle('is-got', g);
    if (g && pop) pulseClass(p, 'is-pop', 520);
  };
  p.set(got, false);
  return p;
}

/** Gamepad glyph badge: 'A','B','X','Y','LB','RB','LT','RT','LS','RS','≡','L','R' etc. */
export function makePadGlyph(label) {
  const s = String(label);
  const b = el('b', 'cb-pad ' + (s === 'A' ? 'a' : s === 'B' ? 'b' : s === 'X' ? 'x' : s === 'Y' ? 'y' : '') +
    (s.length > 2 ? ' stick' : ''));
  b.textContent = s;
  return b;
}

/**
 * A row of glyphs joined by "+" (e.g. crouch + jump).
 * `parts` = ['kbd:CTRL','pad:A','how:free text', …]; a bare '/' is an OR
 * separator and suppresses the "+" on BOTH sides of itself, so
 * ['pad:LS','/','pad:D-PAD'] reads "LS / D-PAD", never "LS / + D-PAD".
 */
export function makeGlyphs(parts) {
  const w = el('span', 'cb-glyphs');
  let prevWasSep = false;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === '/') {
      const sl = el('i', 'plus'); sl.textContent = '/'; w.appendChild(sl);
      prevWasSep = true;
      continue;
    }
    if (i > 0 && !prevWasSep) { const plus = el('i', 'plus'); plus.textContent = '+'; w.appendChild(plus); }
    prevWasSep = false;
    if (p.startsWith('pad:')) w.appendChild(makePadGlyph(p.slice(4)));
    else if (p.startsWith('how:')) { const h = el('span', 'how'); h.textContent = p.slice(4); w.appendChild(h); }
    else { const k = el('b', 'cb-kbd'); k.textContent = p.startsWith('kbd:') ? p.slice(4) : p; w.appendChild(k); }
  }
  return w;
}

/* ---------------------------------------------------------------------------
 * 8. KEYBOARD + GAMEPAD NAVIGATION
 * -------------------------------------------------------------------------*/

/**
 * Roving-focus list over `[data-nav]` descendants of `container`.
 * handleKey(e) / handleNav(name) return true when they consumed the event.
 */
export class FocusList {
  constructor(container, opts) {
    this.container = container;
    this.opts = opts || {};
    this.items = [];
    this.index = -1;
    this.columns = this.opts.columns || 1;
  }

  refresh(preserve) {
    const prev = preserve && this.index >= 0 ? this.items[this.index] : null;
    this.items = this.container ? Array.from(this.container.querySelectorAll('[data-nav]')) : [];
    this.items = this.items.filter((n) => !n.classList.contains('is-disabled') && !n.hidden &&
      n.getAttribute('data-nav-skip') !== '1' && n.style.display !== 'none');
    if (prev) {
      const i = this.items.indexOf(prev);
      this.index = i >= 0 ? i : Math.min(this.index, this.items.length - 1);
    } else if (this.index >= this.items.length) {
      this.index = this.items.length - 1;
    }
    this._paint();
  }

  _paint() {
    for (let i = 0; i < this.items.length; i++) this.items[i].classList.toggle('is-focus', i === this.index);
  }

  focusIndex(i, silent) {
    if (!this.items.length) return;
    const n = this.opts.wrap === false
      ? clamp(i, 0, this.items.length - 1)
      : ((i % this.items.length) + this.items.length) % this.items.length;
    if (n === this.index) return;
    this.index = n;
    this._paint();
    const node = this.items[n];
    if (node) {
      if (typeof node.focus === 'function') { try { node.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      if (typeof node.scrollIntoView === 'function') {
        try { node.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) { /* ignore */ }
      }
    }
    if (!silent && this.opts.onMove) this.opts.onMove(node, n);
  }

  move(delta) { this.focusIndex((this.index < 0 ? (delta > 0 ? -1 : 0) : this.index) + delta); }

  get current() { return this.index >= 0 ? this.items[this.index] : null; }

  activate() {
    const n = this.current;
    if (!n) return false;
    if (typeof n.__activate === 'function') { n.__activate(); return true; }
    if (typeof n.click === 'function') { n.click(); return true; }
    return false;
  }

  adjust(dir) {
    const n = this.current;
    if (n && typeof n.__adjust === 'function') { n.__adjust(dir); return true; }
    return false;
  }

  /** Bind hover -> focus so mouse and keyboard share one highlight. */
  bindHover() {
    if (!this.container || this._hoverBound) return;
    this._hoverBound = true;
    this.container.addEventListener('pointerover', (e) => {
      const t = e.target && e.target.closest ? e.target.closest('[data-nav]') : null;
      if (!t) return;
      const i = this.items.indexOf(t);
      if (i >= 0) this.focusIndex(i);
    });
  }

  handleKey(e) {
    const k = e.key;
    const cols = this.columns;
    if (k === 'ArrowDown' || k === 'Down' || (cols === 1 && (k === 's' || k === 'S'))) { this.move(cols); return true; }
    if (k === 'ArrowUp' || k === 'Up' || (cols === 1 && (k === 'w' || k === 'W'))) { this.move(-cols); return true; }
    if (k === 'ArrowRight' || k === 'Right' || (cols > 1 && (k === 'd' || k === 'D'))) {
      if (cols > 1) { this.move(1); return true; }
      return this.adjust(1);
    }
    if (k === 'ArrowLeft' || k === 'Left' || (cols > 1 && (k === 'a' || k === 'A'))) {
      if (cols > 1) { this.move(-1); return true; }
      return this.adjust(-1);
    }
    if (k === 'Tab') { this.move(e.shiftKey ? -1 : 1); return true; }
    if (k === 'Enter' || k === ' ' || k === 'Spacebar') return this.activate();
    if (k === 'Home') { this.focusIndex(0); return true; }
    if (k === 'End') { this.focusIndex(this.items.length - 1); return true; }
    return false;
  }

  /** Gamepad nav event ('up','down','left','right','confirm'). */
  handleNav(name) {
    const cols = this.columns;
    switch (name) {
      case 'down': this.move(cols); return true;
      case 'up': this.move(-cols); return true;
      case 'right': if (cols > 1) { this.move(1); return true; } return this.adjust(1);
      case 'left': if (cols > 1) { this.move(-1); return true; } return this.adjust(-1);
      case 'confirm': return this.activate();
      default: return false;
    }
  }
}

/* Standard-mapping gamepad indices. */
const PAD_BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const PAD_REPEAT_FIRST = 0.38;   // s before the first auto-repeat of a held direction
const PAD_REPEAT = 0.12;         // s between repeats
const PAD_DEAD = 0.5;            // stick threshold for a menu step

/**
 * One shared gamepad poller for every menu surface. Surfaces `acquire(handler)`
 * while open and `release(handler)` when closed; only the TOP handler receives
 * events, and the rAF poll runs only while at least one surface is up (zero
 * cost during play). Events: 'up' 'down' 'left' 'right' 'confirm' 'back' 'start'.
 * The state record is hoisted and reused — no per-poll allocation.
 */
class PadNavigator {
  constructor() {
    this.stack = [];
    this._raf = 0;
    this._last = 0;
    this._st = { dx: 0, dy: 0, hold: 0, rep: 0, a: false, b: false, start: false, x: false, y: false };
    this._tick = (now) => this._poll(now);
  }
  acquire(handler) {
    const i = this.stack.indexOf(handler);
    if (i >= 0) this.stack.splice(i, 1);
    this.stack.push(handler);
    if (!this._raf) { this._last = 0; this._raf = requestAnimationFrame(this._tick); }
  }
  release(handler) {
    const i = this.stack.indexOf(handler);
    if (i >= 0) this.stack.splice(i, 1);
    if (!this.stack.length && this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
  }
  get active() { return this.stack.length ? this.stack[this.stack.length - 1] : null; }
  _emit(name) { const h = this.active; if (h) { try { h(name); } catch (e) { /* surface bug must not kill the poll */ } } }
  _poll(now) {
    this._raf = this.stack.length ? requestAnimationFrame(this._tick) : 0;
    const dt = this._last ? Math.min(0.1, (now - this._last) / 1000) : 0;
    this._last = now;
    let pads = null;
    try { pads = navigator.getGamepads ? navigator.getGamepads() : null; } catch (e) { pads = null; }
    if (!pads) return;
    let gp = null;
    for (let i = 0; i < pads.length; i++) { if (pads[i] && pads[i].connected) { gp = pads[i]; break; } }
    if (!gp) return;
    const b = gp.buttons, ax = gp.axes, st = this._st;
    const pressed = (i) => !!(b[i] && (b[i].pressed || b[i].value > 0.5));
    let dx = 0, dy = 0;
    if (pressed(PAD_BTN.LEFT) || (ax[0] || 0) < -PAD_DEAD) dx = -1;
    else if (pressed(PAD_BTN.RIGHT) || (ax[0] || 0) > PAD_DEAD) dx = 1;
    if (pressed(PAD_BTN.UP) || (ax[1] || 0) < -PAD_DEAD) dy = -1;
    else if (pressed(PAD_BTN.DOWN) || (ax[1] || 0) > PAD_DEAD) dy = 1;

    if (dx !== st.dx || dy !== st.dy) {
      st.dx = dx; st.dy = dy; st.hold = 0; st.rep = 0;
      if (dy < 0) this._emit('up'); else if (dy > 0) this._emit('down');
      if (dx < 0) this._emit('left'); else if (dx > 0) this._emit('right');
    } else if (dx || dy) {
      st.hold += dt;
      if (st.hold >= PAD_REPEAT_FIRST) {
        st.rep += dt;
        if (st.rep >= PAD_REPEAT) {
          st.rep = 0;
          if (dy < 0) this._emit('up'); else if (dy > 0) this._emit('down');
          if (dx < 0) this._emit('left'); else if (dx > 0) this._emit('right');
        }
      }
    }
    const a = pressed(PAD_BTN.A), bb = pressed(PAD_BTN.B), s = pressed(PAD_BTN.START);
    const x = pressed(PAD_BTN.X), y = pressed(PAD_BTN.Y);
    if (a && !st.a) this._emit('confirm');
    if (bb && !st.b) this._emit('back');
    if (s && !st.start) this._emit('start');
    if (x && !st.x) this._emit('x');
    if (y && !st.y) this._emit('y');
    st.a = a; st.b = bb; st.start = s; st.x = x; st.y = y;
  }
}

export const padNav = new PadNavigator();

/* ---------------------------------------------------------------------------
 * 9. ROLLING NUMBER  (digit-column odometer — the coin roll-up)
 * -------------------------------------------------------------------------*/

/**
 * Digits roll vertically when they change; static glyphs (: . / −) are plain.
 * Cheap: only the columns whose glyph actually changed are re-animated.
 */
export class RollingNumber {
  constructor(cls) {
    this.el = el('span', 'cb-roll ' + (cls || ''));
    this.cols = [];
    this.value = '';
  }

  set(str, animate) {
    str = str == null ? '' : String(str);
    if (str === this.value) return;
    const prev = this.value;
    this.value = str;
    const n = str.length;
    while (this.cols.length > n) { const c = this.cols.pop(); c.wrap.remove(); }
    while (this.cols.length < n) {
      const wrap = el('span', 'cb-roll-col');
      const cur = el('span', 'cb-roll-g');
      wrap.appendChild(cur);
      this.el.appendChild(wrap);
      this.cols.push({ wrap, cur, ch: '' });
    }
    for (let i = 0; i < n; i++) {
      const c = this.cols[i];
      const ch = str[i];
      if (c.ch === ch) continue;
      const wasDigit = prev[i] >= '0' && prev[i] <= '9';
      const isDigit = ch >= '0' && ch <= '9';
      c.ch = ch;
      c.wrap.classList.toggle('is-sep', !isDigit);
      if (animate !== false && isDigit && wasDigit) {
        const old = c.cur;
        const next = el('span', 'cb-roll-g');
        next.textContent = ch;
        c.wrap.appendChild(next);
        c.cur = next;
        animateOnce(next, [{ transform: 'translateY(88%)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
          { duration: 220, easing: UI_TOKENS.ease.out });
        const a = animateOnce(old, [{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-88%)', opacity: 0 }],
          { duration: 220, easing: UI_TOKENS.ease.out });
        if (a) a.onfinish = () => old.remove(); else old.remove();
      } else {
        c.cur.textContent = ch;
      }
    }
  }
}

/** Count-up tween that drives a formatter. Returns a cancel fn. */
export function countUp(from, to, ms, onValue, ease) {
  const t0 = performance.now();
  const e = ease || ((t) => 1 - Math.pow(1 - t, 3));
  let raf = 0;
  let cancelled = false;
  const tick = (now) => {
    if (cancelled) return;
    const t = ms <= 0 ? 1 : clamp((now - t0) / ms, 0, 1);
    onValue(from + (to - from) * e(t), t);
    if (t < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { cancelled = true; if (raf) cancelAnimationFrame(raf); };
}

/* ---------------------------------------------------------------------------
 * 10. UI REGISTRY + ACTION ROUTER
 * -------------------------------------------------------------------------*/

/**
 * Surfaces register themselves here so any of them can drive the others
 * without game.js having to wire the quartet together under specific names.
 * `anyOpen()` is derived from LIVE flags (never a counter) — the game should
 * use it each frame to decide `input.suspended` (see uiOwnsInput below).
 */
export const UIRegistry = {
  hud: null, menu: null, card: null, transitions: null,
  anyOpen() {
    return !!((this.menu && this.menu.isOpen) || (this.card && this.card.isOpen) ||
      (this.hud && this.hud.clearOpen));
  },
};

/** True while any UI surface owns input (menus, course card, clear panel). */
export function uiOwnsInput() { return UIRegistry.anyOpen(); }

/** Input is a named Game field in this contract (§28) — but resolve defensively. */
export function resolveInput(game) {
  if (!game) return null;
  return game.input || (game.player && game.player.input) || game.__input || null;
}

/** Fire a UI sound if the game has audio wired. */
export function uiSfx(game, name) {
  try { const a = game && game.audio; if (a && typeof a.sfx === 'function') a.sfx(name); } catch (e) { /* silent */ }
}

/** Gamepad rumble through Input (honours Settings.gamepadVibrate inside Input). */
export function uiRumble(game, strong, weak, ms) {
  try {
    const inp = resolveInput(game);
    const gp = inp && inp.gamepad;
    if (gp && typeof gp.rumble === 'function') gp.rumble(strong, weak, ms);
  } catch (e) { /* silent */ }
}

/**
 * Pointer-lock hint counter only. UI never writes `input.suspended` (an
 * unbalanced count once took the controls away for good in Ascendant); the
 * game derives suspension from UIRegistry.anyOpen() every frame instead.
 */
let _capture = 0;

export function pushCapture(game) {
  _capture++;
  const inp = resolveInput(game);
  if (inp && typeof inp.releaseLock === 'function') {
    try { inp.releaseLock(); } catch (e) { /* ignore */ }
  }
}

export function popCapture(game, relock) {
  _capture = Math.max(0, _capture - 1);
  if (_capture > 0) return;
  const inp = resolveInput(game);
  if (inp && relock && typeof inp.requestLock === 'function') {
    try { inp.requestLock(); } catch (e) { /* ignore */ }
  }
}

export function captureCount() { return _capture; }

function callFirst(game, names, arg) {
  if (!game) return false;
  for (let i = 0; i < names.length; i++) {
    const f = game[names[i]];
    if (typeof f === 'function') {
      try {
        const r = f.call(game, arg);
        if (r && typeof r.catch === 'function') r.catch((e) => console.warn('[crestbound.ui] action "' + names[i] + '" rejected', e));
      } catch (e) { console.warn('[crestbound.ui] action "' + names[i] + '" threw', e); }
      return true;
    }
  }
  return false;
}

/**
 * Central UI action router.
 * game.uiAction(action, payload) — if defined and it returns true — wins over
 * everything below. Otherwise we call the closest Game method in contract §28.
 */
export function uiAction(game, action, payload) {
  if (game && typeof game.uiAction === 'function') {
    try { if (game.uiAction(action, payload) === true) return true; } catch (e) { /* fall through */ }
  }
  const menu = UIRegistry.menu;
  switch (action) {
    case 'newGame':
      if (menu) menu.close();
      return callFirst(game, ['newGame', 'startNewGame', 'restartSession', 'returnToKeep'], payload);
    case 'continue':
      if (menu) menu.close();
      return callFirst(game, ['continueGame', 'continueRun', 'returnToKeep'], payload);
    case 'resume':
      if (menu) menu.close();
      return callFirst(game, ['resume', 'unpause'], payload);
    case 'restartCourse':
      if (menu) menu.close();
      return callFirst(game, ['restartCourse'], payload);
    case 'keep':
      if (menu) menu.close();
      return callFirst(game, ['returnToKeep'], payload);
    case 'loadCourse':
      if (menu) menu.close();
      return callFirst(game, ['loadCourse'], payload);
    case 'stay':
      return callFirst(game, ['stayInCourse', 'afterClear', 'resume'], payload);
    case 'title':
      if (callFirst(game, ['quitToTitle', 'toTitle'], payload)) return true;
      if (menu) { menu.open('title'); return true; }
      return false;
    case 'settings': if (menu) { menu.open('settings'); return true; } return false;
    case 'controls': if (menu) { menu.open('controls'); return true; } return false;
    case 'credits': if (menu) { menu.open('credits'); return true; } return false;
    case 'pause': if (menu) { menu.open('pause'); return true; } return false;
    case 'closeMenu': if (menu) { menu.close(); return true; } return false;
    default: return false;
  }
}

/** Realm display name from an id, without importing data (the surfaces pass REALMS in). */
export function prettyId(id) {
  return String(id || '').replace(/[-_]/g, ' ').toUpperCase();
}
