/* ============================================================================
 * ASCENDANT — runtime/ui/style.js
 * The interface design system: tokens, injected stylesheet, and the shared
 * widget kit every UI surface (hud / menu / stageselect) is built from.
 *
 * Contract §20 requires: export function injectStyles(); export const UI_TOKENS.
 * Everything else exported here is additive and consumed only by ui/*.js.
 *
 * Side-effect free at import. Nothing touches the DOM until injectStyles()
 * (or a widget factory) is called.
 * ==========================================================================*/

import { fmtTime, clamp } from '../core/util.js';

/* ---------------------------------------------------------------------------
 * 1. TOKENS
 * -------------------------------------------------------------------------*/

/** Base (pre-theme) palette. setUITheme() re-tints the accent family live. */
const BASE_PALETTE = {
  accent: '#4fd7ff',
  safe: '#7cf0c4',
  danger: '#ff5546',
  checkpoint: '#67f0a8',
  finish: '#ffcf5c',
  gold: '#ffd464',
  silver: '#cfdcea',
  bronze: '#d9915a',
  ink: '#e9f2ff',
  inkDim: '#9db3cc',
  inkMute: '#5d7290',
  void: '#05070d',
};

export const UI_TOKENS = {
  /** Font stacks. Rajdhani (SIL OFL) ships with the game as WOFF2
   *  (assets/fonts/, @font-face below) so the condensed-display look no
   *  longer gambles on the viewer's OS. The rest of the stack is the
   *  fallback chain: Bahnschrift (Windows 10+), Segoe UI Variable,
   *  system-ui. */
  font: {
    display:
      "'Rajdhani','Barlow Condensed','Bahnschrift SemiCondensed','Bahnschrift'," +
      "'Oswald','Segoe UI Variable Display','Segoe UI Semibold','Segoe UI',system-ui,sans-serif",
    ui:
      "'Rajdhani','Barlow','Bahnschrift','Segoe UI Variable Text','Segoe UI'," +
      "system-ui,-apple-system,sans-serif",
    num:
      "'Rajdhani','Bahnschrift','Segoe UI Variable Display','Segoe UI'," +
      "'DIN Alternate',system-ui,sans-serif",
  },
  /** Type scale (px, fluid where it matters). */
  type: {
    '2xs': 9, xs: 10.5, sm: 12, base: 14, md: 16, lg: 20,
    xl: 26, '2xl': 34, '3xl': 46, '4xl': 64, '5xl': 92,
  },
  /** Letter-spacing scale (em). */
  track: { tight: -0.01, normal: 0, wide: 0.08, wider: 0.16, widest: 0.34, mega: 0.5 },
  /** Spacing scale (px) — 4pt grid with a couple of half steps. */
  space: { 0: 0, 1: 2, 2: 4, 3: 6, 4: 8, 5: 12, 6: 16, 7: 22, 8: 30, 9: 40, 10: 56, 11: 76 },
  radius: { xs: 2, sm: 4, md: 7, lg: 12, xl: 18, pill: 999 },
  /** Motion. */
  dur: { flick: 90, fast: 150, base: 220, slow: 380, lazy: 620, card: 900 },
  ease: {
    out: 'cubic-bezier(.16,.84,.34,1)',
    in: 'cubic-bezier(.5,0,.9,.32)',
    inOut: 'cubic-bezier(.62,.02,.24,1)',
    spring: 'cubic-bezier(.2,1.5,.36,1)',
    snap: 'cubic-bezier(.08,.82,.17,1)',
  },
  z: { hud: 1, danger: 4, toast: 6, flash: 8, card: 12, menu: 30, select: 40, modal: 50 },
  palette: BASE_PALETTE,
  /** Medal thresholds as a multiplier of a stage's `par`. */
  medal: { gold: 1.0, silver: 1.25, bronze: 1.6 },
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

/** Any colour form -> a css string. Falls back to `fb`. */
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

function rgbToHex(rgb) {
  const h = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return '#' + h(rgb[0]) + h(rgb[1]) + h(rgb[2]);
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

/** Relative luminance 0..1 (for the readability guard on generated tints). */
export function luminance(c) {
  const rgb = toRGB(c) || [0, 0, 0];
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

/** Force a colour bright enough to read as UI text on the dark HUD ground. */
function readable(c, min = 0.34) {
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

/** Medal tier from a finish time against the stage par. */
export function medalFor(timeMs, par) {
  if (!par || !isFinite(par) || timeMs == null || !isFinite(timeMs)) return null;
  const m = UI_TOKENS.medal;
  if (timeMs <= par * m.gold) return 'gold';
  if (timeMs <= par * m.silver) return 'silver';
  if (timeMs <= par * m.bronze) return 'bronze';
  return null;
}

/* ---------------------------------------------------------------------------
 * 4. THE STYLESHEET
 * -------------------------------------------------------------------------*/

const STYLE_ID = 'asc-ui-style';
let _injected = false;

const CSS = `
/* ===== shipped display face ============================================ */
/* Rajdhani — SIL Open Font License. Latin subset, ~15 KB per weight.
   font-display:swap keeps first paint instant on a cold cache. */
@font-face{
  font-family:'Rajdhani'; font-style:normal; font-weight:400; font-display:swap;
  src:url('assets/fonts/rajdhani-400-latin.woff2') format('woff2');
}
@font-face{
  font-family:'Rajdhani'; font-style:normal; font-weight:600; font-display:swap;
  src:url('assets/fonts/rajdhani-600-latin.woff2') format('woff2');
}
@font-face{
  font-family:'Rajdhani'; font-style:normal; font-weight:700; font-display:swap;
  src:url('assets/fonts/rajdhani-700-latin.woff2') format('woff2');
}

/* ===== custom properties ============================================== */
:root{
  --f-display:${UI_TOKENS.font.display};
  --f-ui:${UI_TOKENS.font.ui};
  --f-num:${UI_TOKENS.font.num};

  --accent:${BASE_PALETTE.accent};
  --accent-dim:#1d5f7c;
  --accent-hot:#c7f3ff;
  --accent-glow:rgba(79,215,255,.5);
  --accent-ink:#031420;
  --safe:${BASE_PALETTE.safe};
  --danger:${BASE_PALETTE.danger};
  --cp:${BASE_PALETTE.checkpoint};
  --finish:${BASE_PALETTE.finish};
  --ahead:#5ce39c;
  --behind:#ff6a5a;
  --gold:${BASE_PALETTE.gold};
  --silver:${BASE_PALETTE.silver};
  --bronze:${BASE_PALETTE.bronze};

  --ink:${BASE_PALETTE.ink};
  --ink-dim:${BASE_PALETTE.inkDim};
  --ink-mute:${BASE_PALETTE.inkMute};
  --ink-ghost:rgba(233,242,255,.30);
  --void:${BASE_PALETTE.void};

  --glass:linear-gradient(157deg,rgba(24,34,52,.74) 0%,rgba(10,15,25,.86) 62%,rgba(7,11,19,.90) 100%);
  --glass-flat:rgba(9,14,23,.78);
  --stroke:rgba(255,255,255,.085);
  --stroke-hi:rgba(255,255,255,.17);
  --hair:rgba(255,255,255,.055);

  --r-xs:${UI_TOKENS.radius.xs}px; --r-sm:${UI_TOKENS.radius.sm}px; --r-md:${UI_TOKENS.radius.md}px;
  --r-lg:${UI_TOKENS.radius.lg}px; --r-xl:${UI_TOKENS.radius.xl}px; --r-pill:${UI_TOKENS.radius.pill}px;

  --e-out:${UI_TOKENS.ease.out};
  --e-in:${UI_TOKENS.ease.in};
  --e-io:${UI_TOKENS.ease.inOut};
  --e-spring:${UI_TOKENS.ease.spring};
  --e-snap:${UI_TOKENS.ease.snap};

  --hud-scale:1;
  --ui-fade:1;
}

/* ===== shared base ===================================================== */
.asc-ui,.asc-hud{
  font-family:var(--f-ui); color:var(--ink);
  -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale;
  font-variant-numeric:tabular-nums lining-nums;
  font-feature-settings:'tnum' 1,'lnum' 1,'ss01' 1;
  letter-spacing:.02em;
}
.asc-ui *,.asc-hud *{ box-sizing:border-box; }
.asc-ui [data-nav]:focus,.asc-ui [data-nav]:focus-visible,
.asc-ui button:focus,.asc-ui button:focus-visible{ outline:none; }
.asc-num{ font-family:var(--f-num); font-variant-numeric:tabular-nums lining-nums;
  font-feature-settings:'tnum' 1,'lnum' 1; }
.asc-disp{ font-family:var(--f-display); font-weight:600; text-transform:uppercase; }
.asc-hidden{ display:none !important; }
.asc-gone{ opacity:0 !important; pointer-events:none !important; }

/* ===== glass ============================================================ */
.asc-glass{
  position:relative;
  background:var(--glass);
  backdrop-filter:blur(16px) saturate(1.3);
  -webkit-backdrop-filter:blur(16px) saturate(1.3);
  border:1px solid var(--stroke);
  border-radius:var(--r-lg);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.15),
    inset 0 -1px 0 rgba(0,0,0,.42),
    0 22px 60px -18px rgba(0,0,0,.78),
    0 0 0 1px rgba(0,0,0,.30),
    0 0 46px -14px var(--accent-glow);
}
.asc-glass::before{
  content:''; position:absolute; inset:0; border-radius:inherit; pointer-events:none;
  background:linear-gradient(180deg,rgba(255,255,255,.07),transparent 34%);
}
.asc-glass.asc-scan::after{
  content:''; position:absolute; inset:0; border-radius:inherit; pointer-events:none;
  background:repeating-linear-gradient(to bottom,rgba(190,225,255,.055) 0 1px,transparent 1px 3px);
  mix-blend-mode:overlay; opacity:.55;
}
.asc-edge{
  position:absolute; left:0; right:0; height:1px; pointer-events:none;
  background:linear-gradient(90deg,transparent,var(--accent),transparent);
  opacity:.55;
}
.asc-edge.top{ top:-1px } .asc-edge.bot{ bottom:-1px }

/* ===== label / caption ================================================== */
.asc-label{
  font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:600;
  letter-spacing:.34em; text-transform:uppercase; color:var(--ink-mute);
}
.asc-cap{ font-size:${UI_TOKENS.type.xs}px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-dim); }

/* ===== buttons ========================================================== */
.asc-btn{
  position:relative; display:flex; align-items:center; gap:12px;
  padding:11px 20px 11px 16px; min-height:44px;
  font-family:var(--f-display); font-size:${UI_TOKENS.type.md}px; font-weight:600;
  letter-spacing:.20em; text-transform:uppercase; color:var(--ink-dim);
  background:linear-gradient(100deg,rgba(255,255,255,.030),rgba(255,255,255,.008));
  border:1px solid var(--hair); border-left:2px solid rgba(255,255,255,.10);
  border-radius:var(--r-sm); cursor:pointer; user-select:none; white-space:nowrap;
  transition:color .16s var(--e-out), background .16s var(--e-out),
             border-color .16s var(--e-out), transform .12s var(--e-snap),
             box-shadow .2s var(--e-out), letter-spacing .2s var(--e-out);
  outline:none; -webkit-tap-highlight-color:transparent;
}
.asc-btn .asc-btn-mark{
  width:6px; height:6px; flex:0 0 6px; border-radius:1px; background:var(--ink-mute);
  transform:rotate(45deg); transition:background .16s var(--e-out), transform .24s var(--e-spring),
    box-shadow .2s var(--e-out);
}
.asc-btn .asc-btn-sub{
  margin-left:auto; font-family:var(--f-num); font-size:${UI_TOKENS.type.xs}px;
  letter-spacing:.10em; color:var(--ink-mute); opacity:.8;
}
.asc-btn:hover,.asc-btn.is-focus{
  color:var(--ink); background:linear-gradient(100deg,rgba(255,255,255,.075),rgba(255,255,255,.012));
  border-color:var(--stroke-hi); border-left-color:var(--accent);
  transform:translateX(4px); letter-spacing:.235em;
  box-shadow:-10px 0 26px -18px var(--accent), inset 0 1px 0 rgba(255,255,255,.10);
}
.asc-btn:hover .asc-btn-mark,.asc-btn.is-focus .asc-btn-mark{
  background:var(--accent); transform:rotate(45deg) scale(1.35);
  box-shadow:0 0 12px var(--accent-glow);
}
.asc-btn:active{ transform:translateX(4px) scale(.985); }
.asc-btn.is-primary{
  color:var(--ink); border-left-color:var(--accent);
  background:linear-gradient(100deg,rgba(79,215,255,.14),rgba(79,215,255,.02));
}
.asc-btn.is-primary .asc-btn-mark{ background:var(--accent); box-shadow:0 0 10px var(--accent-glow); }
.asc-btn.is-primary:hover,.asc-btn.is-primary.is-focus{
  background:linear-gradient(100deg,rgba(79,215,255,.24),rgba(79,215,255,.05));
}
.asc-btn.is-danger:hover,.asc-btn.is-danger.is-focus{ border-left-color:var(--danger);
  box-shadow:-10px 0 26px -18px var(--danger); }
.asc-btn.is-danger:hover .asc-btn-mark,.asc-btn.is-danger.is-focus .asc-btn-mark{
  background:var(--danger); box-shadow:0 0 12px rgba(255,85,70,.6); }
.asc-btn[disabled],.asc-btn.is-disabled{
  opacity:.32; pointer-events:none; filter:grayscale(.6);
}
.asc-btn.compact{ padding:8px 14px; min-height:34px; font-size:${UI_TOKENS.type.sm}px; letter-spacing:.16em; }

/* ===== rows / controls ================================================== */
.asc-row{
  display:grid; grid-template-columns:1fr 254px; align-items:center; gap:18px;
  padding:10px 14px; border-radius:var(--r-sm); border:1px solid transparent;
  transition:background .15s var(--e-out), border-color .15s var(--e-out);
}
.asc-row + .asc-row{ margin-top:2px; }
.asc-row .asc-row-name{ font-size:${UI_TOKENS.type.base}px; letter-spacing:.10em;
  text-transform:uppercase; color:var(--ink-dim); font-family:var(--f-display); font-weight:600; }
.asc-row .asc-row-hint{ display:block; font-family:var(--f-ui); font-weight:400;
  font-size:${UI_TOKENS.type.xs}px; letter-spacing:.04em; text-transform:none; color:var(--ink-mute);
  margin-top:2px; }
.asc-row:hover,.asc-row.is-focus{ background:rgba(255,255,255,.045); border-color:var(--hair); }
.asc-row.is-focus .asc-row-name{ color:var(--ink); }
.asc-row.is-focus{ box-shadow:inset 2px 0 0 var(--accent); }

.asc-seg{ display:flex; gap:2px; padding:2px; border-radius:var(--r-sm);
  background:rgba(0,0,0,.40); border:1px solid var(--hair); }
.asc-seg > b{
  flex:1; text-align:center; padding:7px 4px; border-radius:3px; cursor:pointer;
  font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:700;
  letter-spacing:.09em; text-transform:uppercase; color:var(--ink-mute); white-space:nowrap;
  transition:color .15s var(--e-out), background .15s var(--e-out), box-shadow .2s var(--e-out);
}
.asc-seg > b:hover{ color:var(--ink-dim); background:rgba(255,255,255,.05); }
.asc-seg > b.is-on{
  color:var(--accent-ink); background:var(--accent);
  box-shadow:0 0 18px -4px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,.4);
}

.asc-slider{ display:flex; align-items:center; gap:12px; cursor:ew-resize; touch-action:none; }
.asc-slider .asc-sl-track{
  position:relative; flex:1; height:18px; display:flex; align-items:center;
}
.asc-slider .asc-sl-track::before{
  content:''; position:absolute; left:0; right:0; top:50%; margin-top:-1.5px;
  height:3px; border-radius:2px;
  background:rgba(0,0,0,.55); box-shadow:inset 0 1px 1px rgba(0,0,0,.6);
}
.asc-slider .asc-sl-fill{
  position:absolute; left:0; top:50%; margin-top:-1.5px; width:100%;
  height:3px; border-radius:2px; transform-origin:left center; transform:scaleX(0);
  background:linear-gradient(90deg,var(--accent-dim),var(--accent));
  box-shadow:0 0 12px -2px var(--accent-glow);
}
.asc-slider .asc-sl-knob{
  position:absolute; left:0; top:50%; width:12px; height:12px;
  margin-left:-6px; margin-top:-6px; border-radius:2px;
  background:var(--ink); transform:rotate(45deg);
  box-shadow:0 0 0 1px rgba(0,0,0,.6), 0 0 14px -2px var(--accent-glow);
  transition:box-shadow .18s var(--e-out), background .18s var(--e-out);
}
.asc-slider:hover .asc-sl-knob,.is-focus .asc-slider .asc-sl-knob{
  background:var(--accent-hot); box-shadow:0 0 0 1px rgba(0,0,0,.6), 0 0 20px 0 var(--accent-glow);
}
.asc-slider .asc-sl-val{
  min-width:52px; text-align:right; font-family:var(--f-num); font-size:${UI_TOKENS.type.sm}px;
  letter-spacing:.06em; color:var(--ink-dim);
}

.asc-toggle{
  position:relative; width:52px; height:24px; border-radius:var(--r-pill,999px); cursor:pointer;
  background:rgba(0,0,0,.5); border:1px solid var(--hair);
  transition:background .2s var(--e-out), border-color .2s var(--e-out), box-shadow .2s var(--e-out);
}
.asc-toggle i{
  position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:50%;
  background:var(--ink-mute); transition:transform .22s var(--e-spring), background .2s var(--e-out);
}
.asc-toggle.is-on{ background:rgba(79,215,255,.20); border-color:var(--accent);
  box-shadow:0 0 20px -6px var(--accent-glow); }
.asc-toggle.is-on i{ transform:translateX(28px); background:var(--accent); }
.asc-toggle-wrap{ display:flex; justify-content:flex-end; }

/* ===== keycap =========================================================== */
.asc-kbd{
  display:inline-flex; align-items:center; justify-content:center;
  min-width:30px; height:26px; padding:0 8px;
  font-family:var(--f-num); font-size:${UI_TOKENS.type.xs}px; font-weight:600;
  letter-spacing:.08em; text-transform:uppercase; color:var(--ink);
  background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.02));
  border:1px solid var(--stroke); border-bottom-color:rgba(0,0,0,.6);
  border-radius:var(--r-sm);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.18), 0 2px 0 rgba(0,0,0,.35);
}
.asc-kbd.is-listening{
  color:var(--accent-ink); background:var(--accent); border-color:var(--accent);
  animation:asc-blink .7s steps(2,end) infinite;
}
.asc-kbd.is-empty{ color:var(--ink-mute); opacity:.5; }

/* ===== difficulty dots / medals ========================================= */
.asc-dots{ display:flex; gap:3px; align-items:center; }
.asc-dots i{ width:5px; height:5px; border-radius:50%; background:rgba(255,255,255,.14); }
.asc-dots i.on{ background:var(--accent); box-shadow:0 0 6px var(--accent-glow); }
.asc-dots i.hot{ background:var(--danger); box-shadow:0 0 6px rgba(255,85,70,.6); }

.asc-medal{
  width:16px; height:16px; flex:0 0 16px; border-radius:50%;
  background:conic-gradient(from 210deg,#fff6,#0000 40%,#fff3 70%,#0000),var(--m,var(--silver));
  box-shadow:inset 0 0 0 1px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.55),
    0 0 12px -3px var(--m,var(--silver));
}
.asc-medal.gold{ --m:var(--gold) } .asc-medal.silver{ --m:var(--silver) } .asc-medal.bronze{ --m:var(--bronze) }
.asc-medal.none{ background:none; box-shadow:inset 0 0 0 1px rgba(255,255,255,.12); }

/* ===== keyframes ======================================================== */
@keyframes asc-sheen{ 0%{background-position:-180% 0} 55%{background-position:280% 0} 100%{background-position:280% 0} }
@keyframes asc-blink{ 0%,100%{opacity:1} 50%{opacity:.35} }
@keyframes asc-spin{ to{ transform:rotate(360deg) } }
@keyframes asc-shake{
  0%{transform:translate3d(0,0,0)} 12%{transform:translate3d(-4px,1px,0)}
  26%{transform:translate3d(3px,-1px,0)} 42%{transform:translate3d(-3px,0,0)}
  58%{transform:translate3d(2px,1px,0)} 74%{transform:translate3d(-1px,0,0)}
  100%{transform:translate3d(0,0,0)}
}
@keyframes asc-in-up{ from{opacity:0;transform:translate3d(0,14px,0)} to{opacity:1;transform:none} }
@keyframes asc-in-left{ from{opacity:0;transform:translate3d(-16px,0,0)} to{opacity:1;transform:none} }
@keyframes asc-pop{ 0%{opacity:0;transform:scale(.86)} 60%{opacity:1;transform:scale(1.03)} 100%{transform:scale(1)} }
@keyframes asc-rule{
  0%{transform:scaleX(0);opacity:0} 30%{opacity:1} 100%{transform:scaleX(1);opacity:1}
}
@keyframes asc-ruleglow{ 0%,100%{opacity:.35} 50%{opacity:1} }
@keyframes asc-dangerpulse{ 0%,100%{opacity:.5} 50%{opacity:1} }
@keyframes asc-coinspin{ 0%{transform:rotateY(0)} 100%{transform:rotateY(360deg)} }
@keyframes asc-lockshake{ 0%,100%{transform:none} 20%{transform:translateX(-5px)} 40%{transform:translateX(5px)} 60%{transform:translateX(-3px)} 80%{transform:translateX(3px)} }
@keyframes asc-drift{ 0%{transform:translate3d(0,0,0)} 100%{transform:translate3d(0,-26px,0)} }

@media (prefers-reduced-motion: reduce){
  .asc-ui *,.asc-hud *{ animation-duration:.01ms !important; animation-iteration-count:1 !important;
    transition-duration:.06s !important; }
}
`;

/* ---------------------------------------------------------------------------
 * 4b. GAME-OVERLAY BRIDGE
 * game.js owns the #asc-intro / #asc-prompt / #asc-cont nodes and carries its
 * own fallback styling (GAME_CSS, its private --asc-* tokens at weight 200).
 * The design system re-skins those surfaces here so the whole game reads as
 * ONE type system: tokens, display weights, and the live per-world --accent
 * that setUITheme() re-tints. Selectors are deliberately over-specified
 * (div#…) so they beat GAME_CSS's #id .class rules regardless of which
 * <style> tag lands in <head> first.
 * -------------------------------------------------------------------------*/
const BRIDGE_CSS = `
/* ===== stage-intro card ================================================= */
/* Readability scrim: the card sits over raw sky in bright worlds (Sky
   Temple), so a soft radial pool of dark backs the whole lockup. It lives on
   #asc-intro itself and therefore fades with the card's own opacity. */
div#asc-intro{
  background:radial-gradient(52% 46% at 50% 38%,
    rgba(2,5,10,.58), rgba(2,5,10,.30) 55%, rgba(2,5,10,0) 76%);
}
div#asc-intro .asc-intro-world{
  font:600 11px/1 var(--f-display); letter-spacing:.44em; margin-left:.44em;
  color:var(--accent); text-transform:uppercase; opacity:1;
  text-shadow:0 1px 12px rgba(0,0,0,.85), 0 0 1px rgba(0,0,0,.9);
}
div#asc-intro .asc-intro-name{
  font:700 clamp(34px,6vw,72px)/1 var(--f-display); letter-spacing:.05em;
  margin-left:.05em; text-transform:uppercase;
  background:linear-gradient(180deg,#ffffff 16%,#e8f3fd 50%,var(--accent-hot) 112%);
  -webkit-background-clip:text; background-clip:text; color:transparent;
  filter:drop-shadow(0 2px 6px rgba(0,0,0,.85)) drop-shadow(0 10px 30px rgba(0,0,0,.55));
}
div#asc-intro .asc-intro-sub{
  font:600 12px/1.5 var(--f-ui); letter-spacing:.24em; margin-left:.24em;
  color:var(--ink-dim); text-transform:uppercase;
  text-shadow:0 1px 10px rgba(0,0,0,.85), 0 0 1px rgba(0,0,0,.9);
}
div#asc-intro .asc-intro-inner::before,
div#asc-intro .asc-intro-inner::after{
  background:linear-gradient(90deg,transparent,var(--accent),transparent);
}
div#asc-intro .asc-diff-label{
  font:600 9px/1 var(--f-display); letter-spacing:.36em; color:var(--ink-mute);
  text-shadow:0 1px 8px rgba(0,0,0,.8);
}
div#asc-intro .asc-pips u.on{ background:var(--accent); box-shadow:0 0 8px var(--accent-glow); }

/* Hub intro de-dupe: game.js hardcodes the kicker to the hub's own name,
   stacking "THE SANCTUM" over "THE SANCTUM". The hub is the only intro whose
   difficulty row is inline display:none — key on that and swap the kicker
   text for the brand. STOPGAP: the durable fix is the kicker string in
   game.js _startIntro (not this module's file). Degrades to the old
   duplicate where :has() is unsupported. */
div#asc-intro:has(.asc-intro-diff[style*="none"]) .asc-intro-world{
  font-size:0; letter-spacing:0; margin-left:0;
}
div#asc-intro:has(.asc-intro-diff[style*="none"]) .asc-intro-world::before{
  content:'ASCENDANT'; font:600 11px/1 var(--f-display);
  letter-spacing:.44em; margin-left:.44em;
}

/* ===== prompt + continue line =========================================== */
div#asc-prompt .asc-prompt-text{
  font:600 13px/1 var(--f-display); letter-spacing:.2em; margin-left:.2em;
  color:var(--ink); text-transform:uppercase;
}
div#asc-prompt .asc-prompt-sub{
  font:600 10px/1 var(--f-ui); letter-spacing:.3em; color:var(--ink-mute);
}
div#asc-prompt .asc-key{
  background:var(--accent); color:var(--accent-ink);
  box-shadow:0 2px 0 var(--accent-dim), 0 0 16px var(--accent-glow);
}
div#asc-cont span{
  font:600 11px/1 var(--f-display); letter-spacing:.42em; margin-left:.42em;
  color:var(--ink-dim);
}
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
  tag.textContent = CSS + HUD_CSS + MENU_CSS + SELECT_CSS + BRIDGE_CSS;
  _injected = true;
}

/* ---------------------------------------------------------------------------
 * 5. LIVE THEME TINT  — one call re-tints every surface
 * -------------------------------------------------------------------------*/

let _themeKey = null;

/**
 * Re-tint the whole interface from a ThemeDef (or a bare palette object).
 * Sets --accent / --accent-dim / --accent-hot / --accent-glow / --accent-ink,
 * --safe, --danger, --cp, --finish on :root. Cheap + deduped.
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
  st.setProperty('--accent-dim', mixColor(acc, '#050a12', 0.58));
  st.setProperty('--accent-hot', mixColor(acc, '#ffffff', 0.62));
  st.setProperty('--accent-glow', alphaColor(acc, 0.5));
  st.setProperty('--accent-ink', luminance(acc) > 0.42 ? '#04101a' : '#f2fbff');
  st.setProperty('--safe', readable(cssColor(p.safeEdge ?? p.safe ?? BASE_PALETTE.safe), 0.36));
  st.setProperty('--danger', readable(cssColor(p.killGlow ?? p.kill ?? BASE_PALETTE.danger), 0.26));
  st.setProperty('--cp', readable(cssColor(p.checkpointOn ?? p.checkpoint ?? BASE_PALETTE.checkpoint), 0.36));
  st.setProperty('--finish', readable(cssColor(p.finish ?? BASE_PALETTE.finish), 0.42));
}

/** Cause -> HUD colour for death flashes / labels. */
export const CAUSE = {
  lava: { color: '#ff6a2a', label: 'INCINERATED' },
  void: { color: '#7f9bff', label: 'FELL' },
  spike: { color: '#ff4f6d', label: 'IMPALED' },
  laser: { color: '#ff3d6e', label: 'VAPORISED' },
  crush: { color: '#ffa63d', label: 'CRUSHED' },
  saw: { color: '#ff5546', label: 'SHREDDED' },
  manual: { color: '#8fa6c4', label: 'RESET' },
};
export function causeInfo(cause) {
  return CAUSE[cause] || { color: 'var(--danger)', label: String(cause || 'ELIMINATED').toUpperCase() };
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
    const a = node.animate(frames, Object.assign({ fill: 'both', easing: UI_TOKENS.ease.out }, opts));
    return a;
  } catch (e) { return null; }
}

const ICONS = {
  skull:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 2.6c-4.4 0-7.6 3-7.6 7.1 0 2.4 1 4 2.3 5 .5.4.8 1 .8 1.6v1.3c0 .8.6 1.4 1.4 1.4h6.2c.8 0 1.4-.6 1.4-1.4v-1.3c0-.6.3-1.2.8-1.6 1.3-1 2.3-2.6 2.3-5 0-4.1-3.2-7.1-7.6-7.1Z"/>' +
    '<circle cx="9.1" cy="10.4" r="1.7" fill="currentColor" stroke="none"/><circle cx="14.9" cy="10.4" r="1.7" fill="currentColor" stroke="none"/>' +
    '<path d="M11 14.6h2M10.4 19v2.4M13.6 19v2.4"/></svg>',
  coin:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">' +
    '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="5.3" opacity=".55"/>' +
    '<path d="M12 8.4v7.2M10.2 10h3.2a1.6 1.6 0 0 1 0 3.2h-2.8a1.6 1.6 0 0 0 0 3.2h3.4" stroke-linecap="round"/></svg>',
  lock:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' +
    '<rect x="4.6" y="10.4" width="14.8" height="10.4" rx="2.2"/><path d="M8.2 10.4V7.6a3.8 3.8 0 0 1 7.6 0v2.8"/>' +
    '<path d="M12 14.6v2.6"/></svg>',
  tick:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4.6 12.6 9.6 17.6 19.4 6.6"/></svg>',
  flag:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M6 21V4.2M6 4.6c4-2 7 2 11 0v8.6c-4 2-7-2-11 0"/></svg>',
  chevron:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M9 5.5 16 12l-7 6.5"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
    '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.2V12l3.2 2"/></svg>',
  pad:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="2.6" y="7" width="18.8" height="10" rx="4.4"/><path d="M7 10.4v3.2M5.4 12h3.2"/>' +
    '<circle cx="16.2" cy="11" r="1"/><circle cx="18.4" cy="13.2" r="1"/></svg>',
  warn:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 3.4 21.6 20H2.4Z"/><path d="M12 9.6v4.6M12 17.2h.01"/></svg>',
};

/** Inline SVG icon markup (currentColor driven). */
export function icon(name) { return ICONS[name] || ''; }

/* ---------------------------------------------------------------------------
 * 7. WIDGET KIT
 * -------------------------------------------------------------------------*/

/** Menu-style button. Returns the element (with .setSub / .setDisabled). */
export function makeButton(label, opts) {
  const o = opts || {};
  const b = el('button', 'asc-btn' + (o.cls ? ' ' + o.cls : ''));
  b.type = 'button';
  b.setAttribute('data-nav', '1');
  const mark = el('span', 'asc-btn-mark');
  const txt = el('span', 'asc-btn-label');
  txt.textContent = label;
  b.appendChild(mark); b.appendChild(txt);
  let sub = null;
  b.setSub = (s) => {
    if (!s) { if (sub) { sub.remove(); sub = null; } return; }
    if (!sub) { sub = el('span', 'asc-btn-sub'); b.appendChild(sub); }
    sub.textContent = s;
  };
  b.setLabel = (s) => { txt.textContent = s; };
  b.setDisabled = (v) => { b.classList.toggle('is-disabled', !!v); b.disabled = !!v; };
  if (o.sub) b.setSub(o.sub);
  if (o.primary) b.classList.add('is-primary');
  if (o.danger) b.classList.add('is-danger');
  if (o.onClick) b.addEventListener('click', (e) => { e.preventDefault(); o.onClick(e); });
  b.__activate = () => { if (!b.disabled && o.onClick) o.onClick(); };
  return b;
}

/** Segmented control. opts:{options:[{v,label}], value, onChange} */
export function makeSegmented(opts) {
  const o = opts || {};
  const wrap = el('div', 'asc-seg');
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

/** Custom slider (pointer + keyboard). opts:{min,max,step,value,format,onChange} */
export function makeSlider(opts) {
  const o = opts || {};
  const min = o.min != null ? o.min : 0;
  const max = o.max != null ? o.max : 1;
  const step = o.step || 0.01;
  const fmt = o.format || ((v) => v.toFixed(2));
  let value = clamp(o.value != null ? o.value : min, min, max);

  const wrap = el('div', 'asc-slider');
  const track = el('div', 'asc-sl-track');
  const fill = el('div', 'asc-sl-fill');
  const knob = el('div', 'asc-sl-knob');
  const val = el('div', 'asc-sl-val');
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
  const outer = el('div', 'asc-toggle-wrap');
  const t = el('div', 'asc-toggle');
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
  const row = el('div', 'asc-row');
  row.setAttribute('data-nav', '1');
  row.tabIndex = -1;
  const l = el('div', 'asc-row-name');
  l.appendChild(document.createTextNode(name));
  if (hint) { const h = el('span', 'asc-row-hint'); h.textContent = hint; l.appendChild(h); }
  row.appendChild(l);
  const holder = el('div', 'asc-row-ctl');
  holder.appendChild(control);
  row.appendChild(holder);
  row.__control = control;
  row.__activate = () => { if (control.__activate) control.__activate(); };
  row.__adjust = (d) => { if (control.__adjust) control.__adjust(d); };
  return row;
}

/* ---------------------------------------------------------------------------
 * Difficulty bands (chart-obby convention: named bands over the raw 1..10)
 * -------------------------------------------------------------------------*/
const DIFF_BANDS = [
  { max: 2, label: 'EASY', cls: 'easy' },
  { max: 4, label: 'MEDIUM', cls: 'medium' },
  { max: 6, label: 'HARD', cls: 'hard' },
  { max: 8, label: 'EXPERT', cls: 'expert' },
  { max: 10, label: 'INSANE', cls: 'insane' },
];

/**
 * Named difficulty band for a 1..10 difficulty value.
 * @param {number} level
 * @returns {{label:string, cls:string}|null} null for a non-positive level
 */
export function diffBand(level) {
  const lv = clamp(level | 0, 0, 10);
  if (lv <= 0) return null;
  for (const b of DIFF_BANDS) if (lv <= b.max) return { label: b.label, cls: b.cls };
  return { label: 'INSANE', cls: 'insane' };
}

/** A small pill label for a difficulty band ("HARD"), for grids and cards. */
export function makeBandLabel(level) {
  const b = diffBand(level);
  const n = el('span', 'asc-dband' + (b ? ' db-' + b.cls : ''));
  n.textContent = b ? b.label : '';
  if (!b) n.style.display = 'none';
  return n;
}

/** Difficulty dots (1..10, the top third burns red). */
export function makeDots(level, max) {
  const n = max || 10;
  const d = el('div', 'asc-dots');
  const lv = clamp(level | 0, 0, n);
  for (let i = 0; i < n; i++) {
    const dot = el('i');
    if (i < lv) dot.classList.add(i >= Math.ceil(n * 0.7) ? 'hot' : 'on');
    d.appendChild(dot);
  }
  return d;
}

export function makeMedal(tier) {
  return el('div', 'asc-medal ' + (tier || 'none'));
}

/* ---------------------------------------------------------------------------
 * 8. KEYBOARD NAVIGATION
 * -------------------------------------------------------------------------*/

/**
 * Roving-focus list over `[data-nav]` descendants of `container`.
 * handleKey(e) returns true when it consumed the event.
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
      n.getAttribute('data-nav-skip') !== '1');
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
    if (k === 'ArrowDown' || k === 'Down' || (cols === 1 && (k === 's' || k === 'S'))) {
      this.move(cols); return true;
    }
    if (k === 'ArrowUp' || k === 'Up' || (cols === 1 && (k === 'w' || k === 'W'))) {
      this.move(-cols); return true;
    }
    if (k === 'ArrowRight' || k === 'Right') {
      if (cols > 1) { this.move(1); return true; }
      return this.adjust(1);
    }
    if (k === 'ArrowLeft' || k === 'Left') {
      if (cols > 1) { this.move(-1); return true; }
      return this.adjust(-1);
    }
    if (k === 'Tab') { this.move(e.shiftKey ? -1 : 1); return true; }
    if (k === 'Enter' || k === ' ' || k === 'Spacebar') return this.activate();
    if (k === 'Home') { this.focusIndex(0); return true; }
    if (k === 'End') { this.focusIndex(this.items.length - 1); return true; }
    return false;
  }
}

/* ---------------------------------------------------------------------------
 * 9. ROLLING NUMBER  (digit-column odometer)
 * -------------------------------------------------------------------------*/

/**
 * Digits roll vertically when they change; static glyphs (: . / −) are plain.
 * Cheap: only the columns whose glyph actually changed are re-animated.
 */
export class RollingNumber {
  constructor(cls) {
    this.el = el('span', 'asc-roll ' + (cls || ''));
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
      const wrap = el('span', 'asc-roll-col');
      const cur = el('span', 'asc-roll-g');
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
        const next = el('span', 'asc-roll-g');
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
 * without game.js having to wire the trio together under specific field names.
 */
export const UIRegistry = { hud: null, menu: null, stageSelect: null };

/** input is not a named Game field in the contract — resolve it defensively. */
export function resolveInput(game) {
  if (!game) return null;
  return game.input || (game.player && game.player.input) || game.__input || null;
}

/** Fire a UI sound if the game has audio wired. */
export function uiSfx(game, name) {
  try { const a = game && game.audio; if (a && typeof a.sfx === 'function') a.sfx(name); } catch (e) { /* silent */ }
}

/**
 * How many UI surfaces are currently up. A POINTER-LOCK hint only.
 *
 * This counter used to also own `input.suspended`, in parallel with
 * Game._suspendInput — two writers, no reconciliation. An unbalanced push left
 * it above zero permanently, and from then on every popCapture returned early
 * without clearing the flag, so input stayed suspended: the player could still
 * walk (movement recomputes each frame) but could never jump again (jump is
 * hard-gated per frame). Game.update now DERIVES suspension from the live UI
 * every frame (Game._uiOwnsInput), which is the single source of truth. Do not
 * write input.suspended from here — a drifted count must not be able to take
 * the controls away.
 */
let _capture = 0;

/** Menus claim input capture; the HUD/game resume when the last one closes. */
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
      try { f.call(game, arg); } catch (e) { console.warn('[ascendant.ui] action "' + names[i] + '" threw', e); }
      return true;
    }
  }
  return false;
}

/**
 * Central UI action router.
 * game.uiAction(action, payload) — if defined and it returns true — wins over
 * everything below. Otherwise we call the closest Game method in the contract.
 */
export function uiAction(game, action, payload) {
  if (game && typeof game.uiAction === 'function') {
    try { if (game.uiAction(action, payload) === true) return true; } catch (e) { /* fall through */ }
  }
  const menu = UIRegistry.menu;
  const sel = UIRegistry.stageSelect;
  switch (action) {
    case 'play':
      if (menu) menu.close();
      return callFirst(game, ['startRun', 'newRun', 'beginRun', 'returnToHub'], payload);
    case 'continue':
      if (menu) menu.close();
      if (payload && payload.stageId && callFirst(game, ['loadStage'], payload.stageId)) return true;
      return callFirst(game, ['continueRun', 'returnToHub'], payload);
    case 'resume':
      if (menu) menu.close();
      return callFirst(game, ['resume', 'unpause'], payload);
    case 'restartStage':
      if (menu) menu.close();
      return callFirst(game, ['restartStage'], payload);
    case 'restartRun':
      if (menu) menu.close();
      return callFirst(game, ['restartRun'], payload);
    case 'nextStage':
      return callFirst(game, ['nextStage'], payload);
    case 'loadStage':
      if (menu) menu.close();
      if (sel) sel.close();
      return callFirst(game, ['loadStage'], payload);
    case 'hub':
      if (menu) menu.close();
      if (sel) sel.close();
      return callFirst(game, ['returnToHub'], payload);
    case 'title':
      if (sel) sel.close();
      if (callFirst(game, ['quitToTitle', 'toTitle'], payload)) return true;
      if (menu) { menu.open('title'); return true; }
      return false;
    case 'stageSelect':
      if (sel) { sel.open(payload); return true; }
      return callFirst(game, ['openStageSelect'], payload);
    case 'settings':
      if (menu) { menu.open('settings'); return true; }
      return false;
    case 'controls':
      if (menu) { menu.open('controls'); return true; }
      return false;
    case 'credits':
      if (menu) { menu.open('credits'); return true; }
      return false;
    case 'pause':
      if (menu) { menu.open('pause'); return true; }
      return false;
    case 'closeMenu':
      if (menu) { menu.close(); return true; }
      return false;
    default:
      return false;
  }
}

/* ---------------------------------------------------------------------------
 * 11. SURFACE-SPECIFIC CSS
 *     (kept beside the tokens so one <style> tag carries the whole system)
 * -------------------------------------------------------------------------*/

const HUD_CSS = `
/* ===== HUD =============================================================== */
.asc-hud{
  position:absolute; inset:0; pointer-events:none; overflow:hidden;
  contain:layout style;
}
/* Only the in-game readouts fade during the death sequence — the flash
   layers and the finish card are siblings so they stay visible. */
.ah-play{
  position:absolute; inset:0; pointer-events:none;
  opacity:1; transition:opacity .2s var(--e-out);
}
.ah-play.is-off{ opacity:0; }
.ah-scrim{
  position:absolute; inset:0; pointer-events:none;
  background:
    linear-gradient(158deg,rgba(0,0,0,.46),rgba(0,0,0,0) 24%),
    linear-gradient(202deg,rgba(0,0,0,.46),rgba(0,0,0,0) 24%),
    linear-gradient(0deg,rgba(0,0,0,.40),rgba(0,0,0,0) 20%),
    linear-gradient(180deg,rgba(0,0,0,.22),rgba(0,0,0,0) 12%);
}
.asc-hud .ah-cluster{ position:absolute; will-change:transform; }

/* --- top-left: world / stage ---------------------------------------- */
.ah-tl{ top:22px; left:26px; transform-origin:top left; transform:scale(var(--hud-scale)); }
.ah-world{
  font-family:var(--f-display); font-size:${UI_TOKENS.type.xs}px; font-weight:600;
  letter-spacing:.42em; text-transform:uppercase; color:var(--accent);
  text-shadow:0 0 18px var(--accent-glow); margin-bottom:3px;
  display:flex; align-items:center; gap:9px;
}
.ah-world::before{
  content:''; width:14px; height:1px; background:var(--accent); opacity:.85;
  box-shadow:0 0 8px var(--accent-glow);
}
.ah-stage{
  font-family:var(--f-display); font-size:${UI_TOKENS.type['2xl']}px; font-weight:700;
  letter-spacing:.055em; line-height:.94; text-transform:uppercase; color:#fff;
  text-shadow:0 2px 22px rgba(0,0,0,.85), 0 0 1px rgba(0,0,0,.9);
}
.ah-stagenum{
  margin-top:6px; display:flex; align-items:center; gap:8px;
  font-family:var(--f-num); font-size:${UI_TOKENS.type.xs}px; letter-spacing:.26em;
  text-transform:uppercase; color:var(--ink-dim);
  text-shadow:0 1px 10px rgba(0,0,0,.75), 0 0 1px rgba(0,0,0,.8);
}
.ah-stagenum b{ color:var(--ink-dim); font-weight:600; }
.ah-diff{ display:flex; gap:3px; margin-left:2px; }
.ah-diff i{ width:4px; height:4px; border-radius:50%; background:rgba(255,255,255,.16); }
.ah-diff i.on{ background:var(--accent); box-shadow:0 0 5px var(--accent-glow); }
.ah-diff i.hot{ background:var(--danger); box-shadow:0 0 5px rgba(255,85,70,.55); }

/* named difficulty band next to the pips (chart-obby convention) + the shared
   pill used on stage-select tiles */
.ah-diffband, .asc-dband{
  font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:700;
  letter-spacing:.22em; line-height:1; text-transform:uppercase;
  padding:2px 5px 1px 6px; border-radius:3px;
  color:var(--ink-dim); background:rgba(255,255,255,.07);
  border:1px solid rgba(255,255,255,.10);
}
.ah-diffband:empty{ display:none; }
.db-easy{ color:var(--cp); border-color:rgba(103,240,168,.35); background:rgba(103,240,168,.10); }
.db-medium{ color:var(--accent); border-color:rgba(79,215,255,.35); background:rgba(79,215,255,.10); }
.db-hard{ color:var(--finish); border-color:rgba(255,207,92,.38); background:rgba(255,207,92,.10); }
.db-expert{ color:#ff9a4d; border-color:rgba(255,154,77,.4); background:rgba(255,154,77,.10); }
.db-insane{ color:var(--danger); border-color:rgba(255,85,70,.45); background:rgba(255,85,70,.12); }

/* --- top-centre: progress ------------------------------------------- */
.ah-tc{ top:26px; left:50%; width:min(460px,42vw); transform-origin:top center;
  transform:translateX(-50%) scale(var(--hud-scale)); }
.ah-prog{ position:relative; height:34px; }
.ah-prog-rail{
  position:absolute; left:0; right:0; top:9px; height:4px; border-radius:2px;
  background:linear-gradient(180deg,rgba(0,0,0,.62),rgba(0,0,0,.42));
  box-shadow:inset 0 1px 2px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.055);
  overflow:visible;
}
.ah-prog-fill{
  position:absolute; left:0; top:0; height:100%; width:100%; border-radius:2px;
  transform:scaleX(0); transform-origin:left center;
  background:linear-gradient(90deg,var(--accent-dim),var(--accent) 72%,var(--accent-hot));
  box-shadow:0 0 14px -1px var(--accent-glow);
  transition:transform .10s linear;
}
.ah-prog-head{
  position:absolute; top:-3px; width:2px; height:10px; margin-left:-1px; border-radius:1px;
  background:var(--accent-hot); box-shadow:0 0 10px 1px var(--accent-glow);
  transition:left .10s linear;
}
.ah-ghost{
  position:absolute; top:-6px; width:0; height:0; margin-left:-4px;
  border-left:4px solid transparent; border-right:4px solid transparent;
  border-top:6px solid var(--ink-ghost);
  transition:left .18s var(--e-out), opacity .3s var(--e-out);
  filter:drop-shadow(0 0 4px rgba(255,255,255,.35));
}
.ah-pip{
  position:absolute; top:5px; width:12px; height:12px; margin-left:-6px; border-radius:50%;
  background:rgba(6,10,17,.9); border:1.5px solid rgba(255,255,255,.20);
  transition:background .3s var(--e-out), border-color .3s var(--e-out),
             box-shadow .3s var(--e-out), transform .3s var(--e-spring);
}
.ah-pip::after{
  content:''; position:absolute; inset:2.5px; border-radius:50%; background:transparent;
  transition:background .3s var(--e-out);
}
.ah-pip.is-on{ border-color:var(--cp); box-shadow:0 0 12px -1px var(--cp); transform:scale(1.06); }
.ah-pip.is-on::after{ background:var(--cp); }
.ah-pip.is-finish{ border-radius:2px; transform:rotate(45deg) scale(.92); border-color:rgba(255,255,255,.34); }
.ah-pip.is-finish.is-on{ border-color:var(--finish); box-shadow:0 0 14px -1px var(--finish);
  transform:rotate(45deg) scale(1.02); }
.ah-pip.is-finish.is-on::after{ background:var(--finish); }
.ah-prog-legend{
  position:absolute; left:0; right:0; top:23px;
  display:flex; justify-content:space-between;
  font-family:var(--f-num); font-size:${UI_TOKENS.type['2xs']}px; letter-spacing:.28em;
  text-transform:uppercase; color:var(--ink-dim);
  text-shadow:0 1px 10px rgba(0,0,0,.75), 0 0 1px rgba(0,0,0,.8);
}
.ah-prog-legend span:last-child{ margin-right:-2px; }

/* --- top-right: timers ---------------------------------------------- */
.ah-tr{ top:22px; right:26px; text-align:right; transform-origin:top right;
  transform:scale(var(--hud-scale)); }
.ah-timer{
  font-family:var(--f-num); font-weight:700; line-height:.92; color:#fff;
  display:flex; align-items:baseline; justify-content:flex-end;
  text-shadow:0 2px 20px rgba(0,0,0,.8);
}
.ah-timer .big{ font-size:${UI_TOKENS.type['2xl']}px; letter-spacing:.01em; }
.ah-timer .ms{ font-size:${UI_TOKENS.type.lg}px; font-weight:400; color:var(--ink-dim);
  letter-spacing:.01em; margin-left:1px; }
.ah-split{
  margin-top:2px; font-family:var(--f-num); font-size:${UI_TOKENS.type.base}px; font-weight:600;
  letter-spacing:.10em; opacity:0; transition:opacity .2s var(--e-out), color .2s var(--e-out);
  color:var(--ink-dim); min-height:17px;
}
.ah-split.ahead{ color:var(--ahead); text-shadow:0 0 14px rgba(92,227,156,.4); opacity:1; }
.ah-split.behind{ color:var(--behind); text-shadow:0 0 14px rgba(255,106,90,.35); opacity:1; }
.ah-total{
  margin-top:5px; font-family:var(--f-num); font-size:${UI_TOKENS.type.xs}px;
  letter-spacing:.20em; text-transform:uppercase; color:var(--ink-mute);
}
.ah-total b{ color:var(--ink-dim); font-weight:600; margin-left:6px; }
.ah-best{
  margin-top:2px; font-family:var(--f-num); font-size:${UI_TOKENS.type['2xs']}px;
  letter-spacing:.22em; text-transform:uppercase; color:rgba(157,179,204,.5);
}

/* --- bottom-left: deaths / coins ------------------------------------- */
.ah-bl{ bottom:26px; left:26px; display:flex; gap:22px; align-items:flex-end;
  transform-origin:bottom left; transform:scale(var(--hud-scale)); }
.ah-stat{ display:flex; align-items:center; gap:9px; }
.ah-stat svg{ width:20px; height:20px; opacity:.62; }
.ah-stat .n{ font-family:var(--f-num); font-size:${UI_TOKENS.type.xl}px; font-weight:700;
  line-height:1; color:#fff; text-shadow:0 2px 16px rgba(0,0,0,.8); }
.ah-stat .of{ font-family:var(--f-num); font-size:${UI_TOKENS.type.base}px; color:var(--ink-mute);
  align-self:flex-end; margin-bottom:1px; }
.ah-stat.deaths svg{ color:var(--danger); }
.ah-stat.coins svg{ color:var(--finish); }
.ah-stat.deaths.is-hit{ animation:asc-shake .34s var(--e-out); }
.ah-stat.deaths.is-hit svg{ color:var(--danger); filter:drop-shadow(0 0 10px rgba(255,85,70,.7)); opacity:1; }
.ah-stat.coins.is-hit svg{ animation:asc-coinspin .5s var(--e-out); opacity:1; }

/* --- centre: crosshair ----------------------------------------------- */
.ah-cross{
  position:absolute; left:50%; top:50%; width:26px; height:26px; margin:-13px 0 0 -13px;
  transform-origin:center; transform:scale(var(--hud-scale));
}
.ah-cross i{
  position:absolute; left:50%; top:50%; width:4px; height:4px; margin:-2px 0 0 -2px;
  border-radius:50%; background:rgba(255,255,255,.9);
  box-shadow:0 0 0 1px rgba(0,0,0,.55), 0 0 8px rgba(255,255,255,.35);
  transition:transform .13s var(--e-out), opacity .13s var(--e-out), background .2s var(--e-out);
}
.ah-cross::after{
  content:''; position:absolute; left:50%; top:50%; width:16px; height:16px; margin:-8px 0 0 -8px;
  border-radius:50%; border:1px solid rgba(255,255,255,.24);
  transform:scale(.55); opacity:0;
  transition:transform .18s var(--e-out), opacity .18s var(--e-out);
}
.ah-cross.air i{ transform:scale(.72); opacity:.85; }
.ah-cross.air::after{ transform:scale(1); opacity:.5; }
.ah-cross.hide{ opacity:0; }

/* --- bottom-centre: prompts ------------------------------------------ */
.ah-bc{
  position:absolute; left:50%; bottom:120px; transform:translateX(-50%);
  display:flex; flex-direction:column-reverse; align-items:center; gap:8px;
  width:min(560px,72vw);
}
.ah-toast{
  display:flex; align-items:center; gap:12px; max-width:100%;
  padding:9px 18px 9px 14px; border-radius:var(--r-md);
  background:linear-gradient(150deg,rgba(16,24,38,.80),rgba(7,11,19,.86));
  backdrop-filter:blur(10px) saturate(1.2); -webkit-backdrop-filter:blur(10px) saturate(1.2);
  border:1px solid var(--stroke); border-left:2px solid var(--accent);
  box-shadow:0 14px 34px -16px rgba(0,0,0,.9), inset 0 1px 0 rgba(255,255,255,.10);
  will-change:transform,opacity;
}
.ah-toast .tx{ min-width:0; }
.ah-toast .t1{
  font-family:var(--f-display); font-size:${UI_TOKENS.type.base}px; font-weight:600;
  letter-spacing:.14em; text-transform:uppercase; color:#fff; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis;
}
.ah-toast .t2{
  font-size:${UI_TOKENS.type.xs}px; letter-spacing:.05em; color:var(--ink-dim); margin-top:2px;
}
.ah-toast .ic{ width:18px; height:18px; flex:0 0 18px; color:var(--accent); opacity:.9; }
.ah-toast .ic svg{ width:100%; height:100%; }
.ah-toast.k-good{ border-left-color:var(--safe); } .ah-toast.k-good .ic{ color:var(--safe); }
.ah-toast.k-warn{ border-left-color:var(--finish); } .ah-toast.k-warn .ic{ color:var(--finish); }
.ah-toast.k-bad{ border-left-color:var(--danger); } .ah-toast.k-bad .ic{ color:var(--danger); }

/* --- danger meter ----------------------------------------------------- */
.ah-danger{
  position:absolute; left:50%; bottom:62px; transform:translateX(-50%) translateY(14px);
  width:min(420px,54vw); opacity:0; pointer-events:none;
  transition:opacity .3s var(--e-out), transform .3s var(--e-out);
}
.ah-danger.on{ opacity:1; transform:translateX(-50%) translateY(0); }
.ah-danger .dg-head{
  display:flex; align-items:center; justify-content:center; gap:9px; margin-bottom:6px;
  font-family:var(--f-display); font-size:${UI_TOKENS.type.xs}px; font-weight:700;
  letter-spacing:.34em; text-transform:uppercase; color:var(--danger);
  text-shadow:0 0 18px rgba(255,85,70,.55);
  animation:asc-dangerpulse 1.1s var(--e-io) infinite;
  animation-duration:calc(1.25s - var(--dg,0) * .95s);
}
.ah-danger .dg-head svg{ width:15px; height:15px; }
.ah-danger .dg-rail{
  position:relative; height:5px; border-radius:3px; overflow:hidden;
  background:rgba(0,0,0,.6); box-shadow:inset 0 1px 2px rgba(0,0,0,.75), 0 0 0 1px rgba(255,90,70,.22);
}
.ah-danger .dg-fill{
  position:absolute; inset:0; transform-origin:left center; transform:scaleX(0);
  background:linear-gradient(90deg,#7a2a1c,var(--danger) 62%,#ffd0a0);
  box-shadow:0 0 18px 0 rgba(255,85,70,.5);
  transition:transform .12s linear;
}
.ah-danger .dg-chev{
  position:absolute; inset:0; opacity:.35;
  background:repeating-linear-gradient(115deg,rgba(0,0,0,.55) 0 6px,transparent 6px 12px);
}

/* --- flashes ---------------------------------------------------------- */
.ah-ring{
  position:absolute; left:50%; top:50%; width:100px; height:100px; margin:-50px 0 0 -50px;
  border-radius:50%; pointer-events:none; opacity:0;
  border:3px solid var(--cp);
  box-shadow:0 0 60px 6px var(--cp), inset 0 0 40px 2px var(--cp);
}
.ah-vig{
  position:absolute; inset:-2px; pointer-events:none; opacity:0;
  background:radial-gradient(115% 88% at 50% 50%, transparent 34%, var(--vc,var(--danger)) 128%);
  mix-blend-mode:screen;
}
.ah-word{
  position:absolute; left:50%; top:44%; transform:translate(-50%,-50%);
  font-family:var(--f-display); font-weight:700; text-transform:uppercase;
  font-size:${UI_TOKENS.type['3xl']}px; letter-spacing:.30em; margin-left:.30em;
  color:#fff; opacity:0; pointer-events:none; white-space:nowrap;
  text-shadow:0 0 40px var(--wc,var(--cp)), 0 4px 30px rgba(0,0,0,.7);
}
.ah-word .sub{
  display:block; margin-top:10px; font-size:${UI_TOKENS.type.sm}px; font-weight:600;
  letter-spacing:.38em; margin-left:.38em; color:var(--wc,var(--cp)); opacity:.9;
}

/* --- finish card ------------------------------------------------------ */
.ah-finish{
  position:absolute; inset:0; display:none; align-items:center; justify-content:center;
  pointer-events:auto; z-index:${UI_TOKENS.z.card};
  background:radial-gradient(120% 100% at 50% 46%,rgba(6,10,18,.30),rgba(3,5,10,.86) 78%);
  backdrop-filter:blur(7px) saturate(1.05); -webkit-backdrop-filter:blur(7px) saturate(1.05);
}
.ah-finish.on{ display:flex; }
.ah-fcard{
  width:min(560px,88vw); padding:34px 38px 26px; border-radius:var(--r-xl);
  text-align:center; will-change:transform,opacity;
}
.ah-fk{
  font-family:var(--f-display); font-size:${UI_TOKENS.type.xs}px; font-weight:700;
  letter-spacing:.52em; margin-left:.52em; text-transform:uppercase; color:var(--ahead);
  text-shadow:0 0 24px rgba(92,227,156,.5);
}
.ah-fname{
  margin-top:8px; font-family:var(--f-display); font-size:${UI_TOKENS.type['3xl']}px; font-weight:700;
  letter-spacing:.04em; line-height:.96; text-transform:uppercase; color:#fff;
}
.ah-fworld{ margin-top:6px; font-size:${UI_TOKENS.type.xs}px; letter-spacing:.34em;
  text-transform:uppercase; color:var(--ink-mute); }
.ah-frule{
  height:1px; margin:20px auto 18px; width:100%; transform-origin:center;
  background:linear-gradient(90deg,transparent,var(--accent),transparent); opacity:.7;
}
.ah-ftime{
  display:flex; align-items:baseline; justify-content:center; gap:2px;
  font-family:var(--f-num); font-weight:700; color:#fff; line-height:1;
}
.ah-ftime .big{ font-size:${UI_TOKENS.type['4xl']}px; letter-spacing:.005em; }
.ah-ftime .ms{ font-size:${UI_TOKENS.type.xl}px; font-weight:400; color:var(--ink-dim); }
.ah-fsplit{
  margin-top:8px; font-family:var(--f-num); font-size:${UI_TOKENS.type.md}px; font-weight:600;
  letter-spacing:.12em; color:var(--ink-dim); min-height:20px;
}
.ah-fsplit.ahead{ color:var(--ahead); } .ah-fsplit.behind{ color:var(--behind); }
.ah-frecord{
  display:inline-flex; align-items:center; gap:10px; margin-top:12px;
  padding:6px 16px; border-radius:var(--r-pill,999px);
  font-family:var(--f-display); font-size:${UI_TOKENS.type.sm}px; font-weight:700;
  letter-spacing:.34em; margin-left:.34em; text-transform:uppercase;
  color:#08131c; background:linear-gradient(100deg,var(--finish),#fff3c4 55%,var(--finish));
  background-size:220% 100%; animation:asc-sheen 2.6s var(--e-io) infinite;
  box-shadow:0 0 34px -6px var(--finish);
}
.ah-fgrid{
  display:grid; grid-template-columns:repeat(4,1fr); gap:1px; margin-top:24px;
  background:var(--hair); border:1px solid var(--hair); border-radius:var(--r-md); overflow:hidden;
}
.ah-fcell{ padding:12px 6px 11px; background:rgba(8,12,20,.55); }
.ah-fcell .k{ font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:600;
  letter-spacing:.28em; text-transform:uppercase; color:var(--ink-mute); }
.ah-fcell .v{ margin-top:6px; font-family:var(--f-num); font-size:${UI_TOKENS.type.lg}px;
  font-weight:700; color:#fff; display:flex; align-items:center; justify-content:center; gap:7px; }
.ah-fcell .v small{ font-size:${UI_TOKENS.type.sm}px; font-weight:400; color:var(--ink-mute); }
.ah-fcell .v .asc-medal{ width:19px; height:19px; flex:0 0 19px; }
.ah-fcell .v .mt{ font-family:var(--f-display); font-size:${UI_TOKENS.type.base}px;
  letter-spacing:.16em; text-transform:uppercase; }
.ah-fbtns{ display:flex; gap:10px; margin-top:22px; }
.ah-fbtns .asc-btn{ flex:1; justify-content:center; padding-left:14px; }
.ah-fbtns .asc-btn .asc-btn-mark{ display:none; }
.ah-fhint{
  display:flex; align-items:center; justify-content:center; gap:7px;
  margin-top:16px; font-size:${UI_TOKENS.type['2xs']}px; letter-spacing:.26em;
  text-transform:uppercase; color:var(--ink-mute); opacity:.7;
}
.ah-fhint .asc-kbd{ min-width:24px; height:21px; font-size:${UI_TOKENS.type['2xs']}px; }
.ah-fhint i{ font-style:normal; opacity:.4; margin:0 4px; }

/* --- rolling digits --------------------------------------------------- */
.asc-roll{ display:inline-flex; align-items:baseline; }
.asc-roll-col{ position:relative; display:inline-block; overflow:hidden; height:1em; line-height:1;
  vertical-align:baseline; }
.asc-roll-col.is-sep{ width:auto; }
.asc-roll-g{ display:block; }
.asc-roll-col > .asc-roll-g:not(:first-child){ position:absolute; left:0; top:0; }

@media (max-width:900px){
  .ah-stage{ font-size:${UI_TOKENS.type.xl}px; }
  .ah-timer .big{ font-size:${UI_TOKENS.type.xl}px; }
  .ah-timer .ms{ font-size:${UI_TOKENS.type.md}px; }
  .ah-tc{ width:52vw; }
  .ah-word{ font-size:${UI_TOKENS.type['2xl']}px; }
}
`;

const MENU_CSS = `
/* ===== MENU ============================================================= */
.asc-menu{
  position:absolute; inset:0; display:none; pointer-events:auto;
  z-index:${UI_TOKENS.z.menu}; opacity:0;
  transition:opacity .26s var(--e-out);
}
.asc-menu.on{ display:block; opacity:1; }
.asc-menu .am-scrim{
  position:absolute; inset:0;
  background:
    radial-gradient(130% 105% at 26% 34%,rgba(10,16,28,.28),rgba(3,5,10,.90) 76%),
    linear-gradient(105deg,rgba(3,6,12,.72),rgba(3,6,12,.30) 52%,rgba(3,6,12,.78));
  backdrop-filter:blur(18px) saturate(.86) brightness(.72);
  -webkit-backdrop-filter:blur(18px) saturate(.86) brightness(.72);
}
/* The title stages the live 3D scene as its backdrop: a horizontal gradient
   protects only the left menu column and the blur drops to a whisper so the
   right ~60% of the frame is the game, not near-black. */
.asc-menu.is-title .am-scrim{
  background:linear-gradient(94deg,
    rgba(3,6,12,.88) 0%, rgba(3,6,12,.68) 26%, rgba(3,6,12,.26) 50%,
    rgba(3,6,12,.06) 68%, rgba(3,6,12,.34) 100%);
  backdrop-filter:blur(2.5px) saturate(1.08) brightness(.88);
  -webkit-backdrop-filter:blur(2.5px) saturate(1.08) brightness(.88);
}
.asc-menu .am-grain{
  position:absolute; inset:0; pointer-events:none; opacity:.5;
  background:repeating-linear-gradient(to bottom,rgba(160,200,255,.030) 0 1px,transparent 1px 3px);
  mix-blend-mode:overlay;
}
.asc-menu .am-vig{
  position:absolute; inset:0; pointer-events:none;
  background:radial-gradient(120% 96% at 50% 50%,transparent 42%,rgba(0,0,0,.72) 100%);
}
.am-page{ position:absolute; inset:0; display:none; }
.am-page.on{ display:block; }

/* --- title ------------------------------------------------------------- */
.am-title-wrap{
  position:absolute; left:clamp(38px,8vw,132px); top:50%; transform:translateY(-50%);
  max-width:min(1040px,76vw);
}
.am-eyebrow{
  display:flex; align-items:center; gap:12px; margin-bottom:16px;
  font-family:var(--f-display); font-size:${UI_TOKENS.type.xs}px; font-weight:600;
  letter-spacing:.46em; text-transform:uppercase; color:var(--accent);
}
.am-eyebrow::before{ content:''; width:38px; height:1px; background:var(--accent);
  box-shadow:0 0 10px var(--accent-glow); }
.am-wordmark{
  font-family:var(--f-display); font-weight:700; text-transform:uppercase;
  display:inline-block; width:max-content; max-width:100%; padding-right:.12em;
  font-size:clamp(44px,7.3vw,116px); line-height:.86; letter-spacing:.055em;
  background:linear-gradient(96deg,#7f9ec2 0%,#ffffff 26%,#dff4ff 40%,#7fb6d8 62%,#4d6d92 100%);
  background-size:260% 100%;
  -webkit-background-clip:text; background-clip:text; color:transparent;
  filter:drop-shadow(0 8px 34px rgba(0,0,0,.75));
  animation:asc-sheen 7.5s var(--e-io) infinite;
}
.am-sub{
  margin-top:10px; font-family:var(--f-display); font-size:clamp(12px,1.5vw,17px); font-weight:600;
  letter-spacing:.44em; margin-left:.44em; text-transform:uppercase; color:var(--ink-dim);
}
.am-rule{
  position:relative; height:2px; margin:26px 0 30px; width:min(420px,52vw);
  transform-origin:left center; animation:asc-rule .9s var(--e-out) both;
}
.am-rule::before{
  content:''; position:absolute; inset:0;
  background:linear-gradient(90deg,var(--accent),rgba(255,255,255,0) 88%);
}
.am-rule::after{
  content:''; position:absolute; left:0; top:-2px; width:64px; height:6px;
  background:linear-gradient(90deg,var(--accent-hot),transparent);
  filter:blur(4px); opacity:.9; animation:asc-ruleglow 3.4s var(--e-io) infinite;
}
.am-menu-list{ display:flex; flex-direction:column; gap:5px; width:min(360px,46vw); }
.am-version{
  position:absolute; left:clamp(38px,8vw,132px); bottom:34px;
  font-family:var(--f-num); font-size:${UI_TOKENS.type['2xs']}px; letter-spacing:.28em;
  text-transform:uppercase; color:var(--ink-mute); opacity:.75;
  text-shadow:0 1px 10px rgba(0,0,0,.8);
}
.am-version b{ color:var(--ink-dim); font-weight:600; }
.am-title-stats{
  position:absolute; right:clamp(38px,7vw,96px); bottom:34px; text-align:right;
  display:flex; gap:30px;
  text-shadow:0 1px 12px rgba(0,0,0,.85), 0 0 1px rgba(0,0,0,.8);
}
.am-tstat .k{ font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:600;
  letter-spacing:.30em; text-transform:uppercase; color:var(--ink-mute); }
.am-tstat .v{ margin-top:4px; font-family:var(--f-num); font-size:${UI_TOKENS.type.lg}px;
  font-weight:700; color:var(--ink); }

/* --- panel pages (pause/settings/controls/credits) --------------------- */
.am-panel{
  position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
  width:min(760px,90vw); max-height:min(86vh,880px);
  display:flex; flex-direction:column; padding:0; overflow:hidden;
}
.am-panel.wide{ width:min(880px,92vw); }
.am-head{
  display:flex; align-items:flex-end; justify-content:space-between; gap:20px;
  padding:24px 30px 16px; border-bottom:1px solid var(--hair);
}
.am-head .h-l{ min-width:0; }
.am-head .h-eyebrow{
  font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:600;
  letter-spacing:.42em; text-transform:uppercase; color:var(--accent); margin-bottom:5px;
}
.am-head h2{
  font-family:var(--f-display); font-size:${UI_TOKENS.type['2xl']}px; font-weight:700;
  letter-spacing:.07em; text-transform:uppercase; color:#fff; line-height:1;
}
.am-head .h-r{ text-align:right; display:flex; gap:24px; flex:0 0 auto; }
.am-hstat .k{ font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:600;
  letter-spacing:.26em; text-transform:uppercase; color:var(--ink-mute); }
.am-hstat .v{ margin-top:3px; font-family:var(--f-num); font-size:${UI_TOKENS.type.md}px;
  font-weight:700; color:var(--ink); display:flex; align-items:center; gap:6px; justify-content:flex-end; }
.am-body{ padding:18px 24px 28px; overflow-y:auto; overflow-x:hidden; flex:1 1 auto;
  scrollbar-width:thin; scrollbar-color:rgba(255,255,255,.18) transparent; }
.am-body::-webkit-scrollbar{ width:8px }
.am-body::-webkit-scrollbar-thumb{ background:rgba(255,255,255,.16); border-radius:4px }
.am-foot{
  display:flex; align-items:center; justify-content:space-between; gap:16px;
  padding:12px 30px 16px; border-top:1px solid var(--hair);
  font-size:${UI_TOKENS.type['2xs']}px; letter-spacing:.24em; text-transform:uppercase;
  color:var(--ink-mute);
}
.am-foot .keys{ display:flex; gap:14px; align-items:center; }
.am-foot .keys span{ display:flex; gap:6px; align-items:center; }
.am-group-title{
  margin:16px 12px 6px; font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px;
  font-weight:600; letter-spacing:.34em; text-transform:uppercase; color:var(--accent); opacity:.85;
}
.am-group-title:first-child{ margin-top:4px; }
.am-list{ display:flex; flex-direction:column; gap:5px; padding:4px 6px; }

/* --- controls page ----------------------------------------------------- */
.am-ctlhead{
  display:grid; grid-template-columns:1fr 150px 150px; gap:14px; padding:6px 14px 8px;
  font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:600;
  letter-spacing:.30em; text-transform:uppercase; color:var(--ink-mute);
  border-bottom:1px solid var(--hair); margin-bottom:6px;
}
.am-ctlrow{
  display:grid; grid-template-columns:1fr 150px 150px; gap:14px; align-items:center;
  padding:8px 14px; border-radius:var(--r-sm); border:1px solid transparent; cursor:pointer;
  transition:background .15s var(--e-out), box-shadow .15s var(--e-out);
}
.am-ctlrow:hover,.am-ctlrow.is-focus{ background:rgba(255,255,255,.045);
  box-shadow:inset 2px 0 0 var(--accent); }
.am-ctlrow .nm{ font-family:var(--f-display); font-size:${UI_TOKENS.type.base}px; font-weight:600;
  letter-spacing:.12em; text-transform:uppercase; color:var(--ink-dim); }
.am-ctlrow.is-focus .nm{ color:var(--ink); }
.am-ctlrow .keys{ display:flex; gap:6px; flex-wrap:wrap; }
.am-ctlrow .pad{ display:flex; gap:6px; align-items:center; color:var(--ink-mute);
  font-family:var(--f-num); font-size:${UI_TOKENS.type.xs}px; letter-spacing:.10em; }
.am-ctlrow .pad .asc-kbd{ background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.01));
  color:var(--ink-mute); }
.am-ctlrow.is-listening{ background:rgba(79,215,255,.10); box-shadow:inset 2px 0 0 var(--accent); }

/* --- credits ----------------------------------------------------------- */
.am-credits{ padding:10px 20px 20px; }
.am-credits .c-block{ margin-bottom:22px; }
.am-credits .c-k{ font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:600;
  letter-spacing:.34em; text-transform:uppercase; color:var(--accent); margin-bottom:7px; }
.am-credits .c-v{ font-size:${UI_TOKENS.type.base}px; color:var(--ink-dim); line-height:1.7;
  letter-spacing:.03em; }
.am-credits .c-v b{ color:var(--ink); font-weight:600; }
`;

const SELECT_CSS = `
/* ===== STAGE SELECT ===================================================== */
.asc-select{
  position:absolute; inset:0; display:none; pointer-events:auto;
  z-index:${UI_TOKENS.z.select}; opacity:0; transition:opacity .26s var(--e-out);
}
.asc-select.on{ display:block; opacity:1; }
.asc-select .as-scrim{
  position:absolute; inset:0;
  background:radial-gradient(125% 100% at 50% 30%,rgba(10,17,29,.42),rgba(3,5,10,.93) 78%);
  backdrop-filter:blur(20px) saturate(.9) brightness(.66);
  -webkit-backdrop-filter:blur(20px) saturate(.9) brightness(.66);
}
.as-wrap{
  position:absolute; inset:0; display:flex; flex-direction:column;
  padding:clamp(20px,3.4vh,42px) clamp(24px,5vw,74px);
}
.as-head{ display:flex; align-items:flex-end; justify-content:space-between; gap:24px;
  padding-bottom:14px; border-bottom:1px solid var(--hair); flex:0 0 auto; }
.as-head .eyebrow{ font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:600;
  letter-spacing:.44em; text-transform:uppercase; color:var(--accent); margin-bottom:6px; }
.as-head h2{ font-family:var(--f-display); font-size:${UI_TOKENS.type['2xl']}px; font-weight:700;
  letter-spacing:.08em; text-transform:uppercase; color:#fff; line-height:1; }
.as-head .totals{ display:flex; gap:28px; text-align:right; flex:0 0 auto; }
.as-tot .k{ font-family:var(--f-display); font-size:${UI_TOKENS.type['2xs']}px; font-weight:600;
  letter-spacing:.20em; text-transform:uppercase; color:var(--ink-mute); white-space:nowrap; }
.as-tot .v{ margin-top:3px; font-family:var(--f-num); font-size:${UI_TOKENS.type.lg}px; font-weight:700;
  color:var(--ink); }
.as-body{ flex:1 1 auto; overflow-y:auto; overflow-x:hidden; padding:18px 2px 8px;
  scrollbar-width:thin; scrollbar-color:rgba(255,255,255,.18) transparent; }
.as-body::-webkit-scrollbar{ width:8px }
.as-body::-webkit-scrollbar-thumb{ background:rgba(255,255,255,.16); border-radius:4px }
.as-foot{ flex:0 0 auto; display:flex; align-items:center; justify-content:space-between;
  padding-top:12px; border-top:1px solid var(--hair);
  font-size:${UI_TOKENS.type['2xs']}px; letter-spacing:.24em; text-transform:uppercase;
  color:var(--ink-mute); }
.as-foot .keys{ display:flex; gap:16px; align-items:center; }
.as-foot .keys span{ display:flex; gap:6px; align-items:center; }

.as-world{
  margin-bottom:14px; border-radius:var(--r-lg); overflow:hidden;
  border:1px solid var(--stroke);
  background:linear-gradient(150deg,rgba(20,29,45,.62),rgba(8,12,20,.76));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.09), 0 16px 44px -26px rgba(0,0,0,.9);
  transition:border-color .25s var(--e-out), box-shadow .25s var(--e-out);
}
.as-world.is-open{ border-color:var(--wc,var(--accent));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.12), 0 0 0 1px rgba(255,255,255,.03),
             0 26px 60px -30px var(--wg,var(--accent-glow)); }
.as-world.is-locked{ opacity:.62; }
.as-whead{
  display:flex; align-items:center; gap:18px; padding:16px 22px; cursor:pointer;
  position:relative; transition:background .2s var(--e-out);
}
.as-whead:hover,.as-world.is-focus > .as-whead{ background:rgba(255,255,255,.045); }
.as-world.is-focus > .as-whead{ box-shadow:inset 3px 0 0 var(--wc,var(--accent)); }
.as-whead .glyph{
  width:44px; height:44px; flex:0 0 44px; border-radius:var(--r-md); position:relative;
  background:linear-gradient(150deg,var(--wc,var(--accent)),rgba(0,0,0,.2));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.4), 0 0 26px -6px var(--wg,var(--accent-glow));
  display:flex; align-items:center; justify-content:center;
  font-family:var(--f-display); font-size:${UI_TOKENS.type.lg}px; font-weight:700;
  color:#04101a; letter-spacing:.02em;
}
.as-world.is-locked .as-whead .glyph{ background:rgba(255,255,255,.06); color:var(--ink-mute);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.10); }
.as-world.is-locked .as-whead .glyph svg{ width:20px; height:20px; }
.as-whead .wt{ min-width:0; flex:1 1 auto; }
.as-whead .wname{
  font-family:var(--f-display); font-size:${UI_TOKENS.type.xl}px; font-weight:700;
  letter-spacing:.11em; text-transform:uppercase; color:#fff; line-height:1.05;
}
.as-whead .wmeta{
  margin-top:5px; display:flex; align-items:center; gap:14px; flex-wrap:wrap;
  font-family:var(--f-num); font-size:${UI_TOKENS.type.xs}px; letter-spacing:.16em;
  text-transform:uppercase; color:var(--ink-mute);
}
/* The unlock condition is a sentence, not a chip: let it use the row and wrap
   on words. Without flex:1 1 auto it collapsed to one word per line. */
.as-whead .wmeta .req{ color:var(--finish); letter-spacing:.14em;
  flex:1 1 auto; min-width:0; line-height:1.5; }
/* Narrow panes (the portal embed at phone width): stack the progress bar under
   the world name so the lock sentence keeps the full width. */
@media (max-width: 640px){
  .as-whead{ flex-wrap:wrap; gap:10px 14px; padding:14px 16px; }
  .as-whead .wt{ flex:1 1 140px; }
  .as-wprog{ flex:1 1 100%; width:auto; order:4; }
  .as-wprog .lbl{ text-align:left; }
}
.as-wprog{ width:120px; flex:0 0 120px; }
.as-wprog .bar{ height:3px; border-radius:2px; background:rgba(0,0,0,.55); overflow:hidden; }
.as-wprog .bar i{ display:block; height:100%; transform-origin:left center;
  background:linear-gradient(90deg,var(--wc,var(--accent)),#fff); box-shadow:0 0 12px -2px var(--wg); }
.as-wprog .lbl{ margin-top:6px; text-align:right; font-family:var(--f-num);
  font-size:${UI_TOKENS.type['2xs']}px; letter-spacing:.22em; color:var(--ink-mute); }
.as-whead .caret{ width:18px; height:18px; flex:0 0 18px; color:var(--ink-mute);
  transition:transform .28s var(--e-spring), color .2s var(--e-out); }
.as-world.is-open .as-whead .caret{ transform:rotate(90deg); color:var(--wc,var(--accent)); }

.as-grid-wrap{
  display:grid; grid-template-rows:0fr;
  transition:grid-template-rows .34s var(--e-io);
}
.as-world.is-open .as-grid-wrap{ grid-template-rows:1fr; }
.as-grid-inner{ overflow:hidden; }
.as-grid{
  display:grid; grid-template-columns:repeat(auto-fit,minmax(238px,1fr)); gap:12px;
  padding:6px 18px 20px;
}

.as-tile{
  position:relative; border-radius:var(--r-md); overflow:hidden; cursor:pointer;
  background:linear-gradient(165deg,rgba(18,26,41,.86),rgba(7,11,19,.92));
  border:1px solid var(--stroke); text-align:left;
  transition:transform .2s var(--e-snap), border-color .2s var(--e-out),
             box-shadow .24s var(--e-out);
  opacity:0; animation:asc-in-up .34s var(--e-out) both;
}
.as-tile:hover,.as-tile.is-focus{
  transform:translateY(-3px); border-color:var(--wc,var(--accent));
  box-shadow:0 18px 40px -22px #000, 0 0 0 1px rgba(255,255,255,.05),
             0 0 34px -12px var(--wg,var(--accent-glow));
}
.as-tile canvas{ display:block; width:100%; height:104px; background:#05080e;
  border-bottom:1px solid var(--hair); image-rendering:auto; }
.as-tile .tbody{ padding:10px 12px 12px; }
.as-tile .tname{
  font-family:var(--f-display); font-size:${UI_TOKENS.type.md}px; font-weight:700;
  letter-spacing:.10em; text-transform:uppercase; color:#fff; line-height:1.1;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.as-tile .tstages{
  margin-top:3px; font-family:var(--f-num); font-size:${UI_TOKENS.type['2xs']}px;
  font-weight:600; letter-spacing:.22em; text-transform:uppercase; color:var(--ink-mute);
}
.as-tile .tstages b{ color:var(--wc,var(--accent)); font-weight:700; }
.as-tile .tstages.is-locked{ color:var(--finish); letter-spacing:.14em; white-space:normal;
  line-height:1.45; }
.as-tile .tlock{
  position:absolute; top:6px; right:8px; width:18px; height:18px; color:var(--finish);
  filter:drop-shadow(0 0 8px rgba(0,0,0,.85));
}
.as-tile.locked .tlock{ opacity:1; }
.as-tile .trow{
  margin-top:8px; display:flex; align-items:center; justify-content:space-between; gap:8px;
}
.as-tile .tbest{ font-family:var(--f-num); font-size:${UI_TOKENS.type.sm}px; font-weight:600;
  color:var(--ink-dim); letter-spacing:.06em; display:flex; align-items:center; gap:7px; }
/* Every readout on a tile carries its own word — no bare "1 / 3" anywhere. */
.as-tile .tbest b{ font-size:${UI_TOKENS.type['2xs']}px; font-weight:700; letter-spacing:.20em;
  color:var(--ink-mute); }
.as-tile .tstats b{ font-size:${UI_TOKENS.type['2xs']}px; font-weight:700; letter-spacing:.18em;
  color:var(--ink-mute); opacity:.85; }
.as-tile .tbest.none{ color:var(--ink-mute); opacity:.65; }
.as-tile .tstats{
  margin-top:7px; display:flex; align-items:center; gap:14px;
  font-family:var(--f-num); font-size:${UI_TOKENS.type.xs}px; letter-spacing:.10em;
  color:var(--ink-mute);
}
.as-tile .tstats span{ display:flex; align-items:center; gap:5px; }
.as-tile .tstats svg{ width:13px; height:13px; opacity:.7; }
.as-tile .tno{
  position:absolute; top:8px; left:9px; font-family:var(--f-num); font-size:${UI_TOKENS.type['2xs']}px;
  font-weight:700; letter-spacing:.20em; color:rgba(255,255,255,.75);
  text-shadow:0 1px 6px rgba(0,0,0,.9);
}
.as-tile .tclear{
  position:absolute; top:6px; right:8px; width:19px; height:19px; color:var(--safe);
  filter:drop-shadow(0 0 8px rgba(124,240,196,.6));
}
.as-tile.locked{ cursor:not-allowed; opacity:.52; filter:grayscale(.7); }
.as-tile.locked .tlock{ filter:none; }
.as-tile.locked:hover{ transform:none; animation:asc-lockshake .4s var(--e-out); }
.as-tile .tload{
  position:absolute; inset:0 0 auto 0; height:104px; display:flex; align-items:center;
  justify-content:center; color:var(--ink-mute);
}
.as-tile .tload i{
  width:16px; height:16px; border-radius:50%; border:2px solid rgba(255,255,255,.14);
  border-top-color:var(--accent); animation:asc-spin .8s linear infinite;
}
`;
