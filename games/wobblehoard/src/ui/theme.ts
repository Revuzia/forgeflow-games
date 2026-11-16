// The one place the WOBBLEHOARD design tokens live (CONTRACT.md section 7, UI.md section 3). CSS only ever reads var(--wh-*) (and the
// body-level --k-* semantic layer in base.css / a11y.css, which is built from these). Everything here is original: a toy photographed on a
// dark felt play-mat, warm softbox, cool rim light.
//
// Pure TypeScript: no DOM at import time, so the node probe (probe_app.ts) can import it and measure every pair.

export const PALETTE = {
  ink: '#14102a',      // background, deepest; text on gel; the focus-ring halo; glyph outline
  plum: '#2a1744',     // raised surfaces; the base of the glass tone (NOT the jelly "plum": that is DERIVED.plumBright)
  dusk: '#5b3a86',     // borders, quiet fills
  felt: '#2a2150',     // the play-mat
  amber: '#ffb347',    // sodium key light, primary accent
  lagoon: '#59d6e6',   // cold rim light, focus rings, links
  coral: '#ff5a4d',    // ember core, hot accent (ink text only: cream on coral is 2.76)
  cream: '#fff1d6',    // text
} as const;
export type PaletteKey = keyof typeof PALETTE;

/** Derived tones. Kept as literals (not alpha mixes) so contrast can be measured exactly, see probe_app.ts. */
export const DERIVED = {
  creamDim: '#c9bdcf',   // secondary text on ink / plum (>= 4.5:1, measured)
  panel: '#1d1538',      // opaque panel surface: between ink and plum
  panelEdge: '#4a3270',  // hairline border
  track: '#3b2a5f',      // slider track / control fill
  amberDeep: '#e8862a',  // pressed amber; the bottom stop of the gel
  danger: '#ff8a80',     // error text on ink (lighter coral for contrast)
  edge: '#8a67b8',       // control outlines: >= 3:1 on the panel
  // ---- UI v3 (UI.md 3.1, 2026-10-08) ----
  surface2: '#261c48',   // OPAQUE tool / control surface (edge on it 3.51)
  surface3: '#2f2358',   // raised or hovered control surface (edge on it 3.14)
  gelHi: '#ffd592',      // top stop of the gel (ink on it 13.35)
  lip: '#b5611a',        // the gel's bottom lip
  ok: '#7be0a4',         // success
  plumBright: '#b894f2', // UI.md calls this "plum" (ink 7.52, panel 7.03); renamed because PALETTE.plum is the old surface tone
} as const;

// ---- colour maths (WCAG 2.x relative luminance), pure so the node probe can use it ----
const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const lin = (c: number): number => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
export function luminance(h: string): number {
  const [r, g, b] = hex(h);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Linear sRGB-space-free mix in plain sRGB (what CSS `color-mix(in srgb)` does): t = share of `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hex(a), [br, bg, bb] = hex(b);
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}
/** `fg` at opacity `a` painted over the opaque `bg`, as an opaque hex (to measure translucent surfaces exactly). */
export const overHex = (fg: string, a: number, bg: string): string => mixHex(bg, fg, a);
/** `rgba(r, g, b, a)` of a palette hex. */
export function rgba(h: string, a: number): string { const [r, g, b] = hex(h); return `rgba(${r}, ${g}, ${b}, ${a})`; }

const WHITE = '#ffffff';
export const GLASS_ALPHA = 0.86;
export const SCRIM_ALPHA = 0.62;

/** Computed colours (derived from the tokens above by the formulas in UI.md 3.1; measured in CONTRAST_PAIRS). */
export const COMPUTED = {
  selTint: mixHex(DERIVED.surface3, PALETTE.amber, 0.1),       // selected control: a warm plum (amber 10% into surface3); the amber ring does the work
  glass: rgba(PALETTE.plum, GLASS_ALPHA),                     // containers only (top group, dock, info row, toast); solid in Quality low / contrast-more
  scrim: rgba(PALETTE.ink, SCRIM_ALPHA),                      // behind a modal or a title-screen scene
  ring: PALETTE.lagoon,                                       // focus ring colour
  ringHalo: PALETTE.ink,                                      // the 2 px halo outside the ring (lagoon vs white is only 1.72)
  // the coral gel (destructive confirm): ink text on every stop; the lip is a darker coral
  coralHi: mixHex(PALETTE.coral, WHITE, 0.3),
  coralLo: mixHex(PALETTE.coral, PALETTE.ink, 0.1),
  coralLip: mixHex(PALETTE.coral, PALETTE.ink, 0.5),
  // white washes: hover overlay on a gel, the specular band on its top half
  wash: 'rgba(255, 255, 255, .14)',
  gloss: 'rgba(255, 255, 255, .5)',
  rim: 'rgba(255, 255, 255, .08)',                              // the 1 px top highlight of a glass-family surface
} as const;

// ---- tiers: rarity frames (moved here from core/rarity.ts frameHex / tellHex; B5 deletes the copies there) and achievement medals ----
export type TierId = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
export interface TierColors { frame: string; tell: string; prism?: readonly string[] }
export const TIERS: Readonly<Record<TierId, TierColors>> = {
  common: { frame: PALETTE.cream, tell: '#ffe6b8' },
  uncommon: { frame: PALETTE.lagoon, tell: PALETTE.lagoon },
  rare: { frame: DERIVED.edge, tell: '#a07be0' },
  epic: { frame: PALETTE.coral, tell: PALETTE.coral },
  legendary: { frame: PALETTE.amber, tell: PALETTE.amber },
  mythic: { frame: '#e9f4ff', tell: '#d8c8ff', prism: [PALETTE.lagoon, '#a07be0', '#ff8fb0', '#ffd27a'] },
};
export const TIER_IDS: readonly TierId[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

/** Achievement tiers (UI.md 3.1): rank pips + gem + word always accompany the colour. */
export type MedalId = 'bronze' | 'silver' | 'gold' | 'diamond';
export const MEDALS: Readonly<Record<MedalId, string>> = { bronze: '#e0955a', silver: '#d0d0d8', gold: '#ffd23f', diamond: '#b9f2ff' };
export const MEDAL_IDS: readonly MedalId[] = ['bronze', 'silver', 'gold', 'diamond'];

// ---- jelly tones (UI.md 5): the display type paints each tone with a gradient top -> body -> shade ----
export type JellyTone = 'amber' | 'cream' | 'coral' | 'lagoon' | 'plum';
export interface ToneStops { top: string; body: string; shade: string }
function hslOf(h: string): [number, number, number] {
  const [r, g, b] = hex(h).map((v) => v / 255) as [number, number, number];
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const hue = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hue * 60, s, l];
}
function fromHsl(hh: number, s: number, l: number): string {
  const f = (n: number): number => { const k = (n + hh / 30) % 12; return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return toHex(f(0) * 255, f(8) * 255, f(4) * 255);
}
/** The three stops of a jelly body: a soft top, the tone, and a darker SATURATED shade (mixing with ink would turn amber to mud). */
export function toneStops(body: string): ToneStops {
  const [h, s, l] = hslOf(body);
  return { top: mixHex(body, WHITE, 0.4), body, shade: fromHsl(h, Math.min(1, s * 0.78), Math.max(0.14, l * 0.64)) };
}
export const JELLY_BODIES: Readonly<Record<JellyTone, string>> = {
  amber: PALETTE.amber, cream: PALETTE.cream, coral: PALETTE.coral, lagoon: PALETTE.lagoon, plum: DERIVED.plumBright,
};
/** Every colour the jelly alphabet can wear: 5 tones, 6 rarity tiers, 4 medals. */
const buildJelly = (): Record<JellyTone | TierId | MedalId, ToneStops> => ({
  ...Object.fromEntries(Object.entries(JELLY_BODIES).map(([k, v]) => [k, toneStops(v)])),
  ...Object.fromEntries(TIER_IDS.map((k) => [k, toneStops(TIERS[k].frame)])),
  ...Object.fromEntries(MEDAL_IDS.map((k) => [k, toneStops(MEDALS[k])])),
} as Record<JellyTone | TierId | MedalId, ToneStops>);
// PURE: the game does not read JELLY until B2, so the bundler may drop it (and toneStops, hslOf, fromHsl) from first play
export const JELLY: Readonly<Record<JellyTone | TierId | MedalId, ToneStops>> = /* @__PURE__ */ buildJelly();

// ---- type, space, shape, depth, motion (UI.md 3.2) ----
export const FONT_STACK = 'ui-rounded, "SF Pro Rounded", "Segoe UI Variable Text", "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif';
export const MONO_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
/** Font sizes in px. Weights are 600 and 800 only (audit W3). Labels are caps with +.08em tracking. */
export const TYPE = { label: 12, small: 14, body: 16, lead: 18, h3: 22, h2: 28, h1: 36 } as const;
export const WEIGHT = { mid: 600, bold: 800 } as const;
export const LEADING = { body: 1.4, tight: 1.15 } as const;
export const TRACKING_LABEL = '.08em';
/** token key (without --wh-) -> [weight, size, line-height ('body' = LEADING.body, else a literal)]; the 9 `font` shorthands the stylesheets repeat most (the sheets that probes pin to explicit --wh-fs-* tokens, screens.css / photo.css / the .hint rule, keep the long form) */
export const FONT_COMBOS: Record<string, readonly ['mid' | 'bold', keyof typeof TYPE, string]> = {
  'fb-body': ['bold', 'body', '1.2'], 'fb-label': ['bold', 'label', '1'], 'fm-body': ['mid', 'body', 'body'], 'fb-small': ['bold', 'small', '1.25'],
  'fb-small-3': ['bold', 'small', '1.3'], 'fb-small-11': ['bold', 'small', '1.1'], 'fm-small': ['mid', 'small', '1.3'], 'fb-lead': ['bold', 'lead', '1.2'], 'fb-small-1': ['bold', 'small', '1'],
};
/** Cap heights of the jelly display type (px; xl is fluid). */
export const JELLY_CAPS = { sm: 24, md: 36, lg: 56, xl: 'clamp(64px, 12vw, 120px)' } as const;
export const SPACE = [4, 8, 12, 16, 24, 32, 48] as const;
export const GUTTER = 16;
export const GUTTER_NARROW = 12; // at <= 380 px wide
export const RADII = { kbd: 6, chip: 10, btn: 16, card: 20, panel: 28, pill: 999 } as const;
/** Hit and component sizes in px. Every focusable target is >= HIT (WCAG 2.5.8 target; K02). */
export const SIZES = { hit: 44, btnH: 48, ctaH: 64, chipH: 32, switchW: 56, switchH: 32, trackH: 10, thumb: 28 } as const;
const SHADOW_RGB = '8, 4, 20';
export const ELEV = {
  e1: `0 2px 6px rgba(${SHADOW_RGB}, .35)`,
  e2: `0 8px 20px rgba(${SHADOW_RGB}, .45)`,
  e3: `0 24px 60px rgba(${SHADOW_RGB}, .6)`,
  lip: `0 4px 0 ${DERIVED.lip}`,
  lipPressed: `0 1px 0 ${DERIVED.lip}`,
} as const;
/** Milliseconds. Calm collapses the MOVE durations to ~0 and sets every FADE to 140 (a11y.css). */
export const MOTION = { t1: 80, t2: 140, t3: 220, t4: 360, set: 900 } as const;
export const EASE = { out: 'cubic-bezier(.2, .8, .2, 1)', spring: 'cubic-bezier(.34, 1.56, .64, 1)' } as const;
export const Z = { play: 2, hud: 3, bar: 5, dock: 6, panel: 7, modal: 10, toast: 15, fatal: 20, boot: 30 } as const;
export const RING = { width: 3, offset: 2, halo: 2 } as const;

/** Foreground / background pairs the UI actually uses. probe_app.ts asserts every one is >= its minimum ratio. */
type ContrastPair = { name: string; fg: string; bg: string; min: number };
const buildPairs = (): ContrastPair[] => [
  { name: 'body text on ink', fg: PALETTE.cream, bg: PALETTE.ink, min: 4.5 },
  { name: 'body text on panel', fg: PALETTE.cream, bg: DERIVED.panel, min: 4.5 },
  { name: 'dim text on ink', fg: DERIVED.creamDim, bg: PALETTE.ink, min: 4.5 },
  { name: 'dim text on panel', fg: DERIVED.creamDim, bg: DERIVED.panel, min: 4.5 },
  { name: 'dim text on track', fg: DERIVED.creamDim, bg: DERIVED.track, min: 4.5 },
  { name: 'cream on track', fg: PALETTE.cream, bg: DERIVED.track, min: 4.5 },
  { name: 'button text (ink) on amber', fg: PALETTE.ink, bg: PALETTE.amber, min: 4.5 },
  { name: 'button text (ink) on coral', fg: PALETTE.ink, bg: PALETTE.coral, min: 4.5 },
  { name: 'button text (ink) on amberDeep', fg: PALETTE.ink, bg: DERIVED.amberDeep, min: 4.5 },
  { name: 'accent text (amber) on panel', fg: PALETTE.amber, bg: DERIVED.panel, min: 4.5 },
  { name: 'focus ring (lagoon) on ink', fg: PALETTE.lagoon, bg: PALETTE.ink, min: 3 },
  { name: 'focus ring (lagoon) on panel', fg: PALETTE.lagoon, bg: DERIVED.panel, min: 3 },
  { name: 'error text on ink', fg: DERIVED.danger, bg: PALETTE.ink, min: 4.5 },
  { name: 'control edge on panel', fg: DERIVED.edge, bg: DERIVED.panel, min: 3 },
  { name: 'control edge on track', fg: DERIVED.edge, bg: DERIVED.track, min: 1.5 },
  // the Hoard (SHELL-2b, COLLECTION 9.10 / U09): plinth and gift counts in amber on the ink plinths, links in lagoon on the panel,
  // the tier gem frames and copy tags on the plinths and swatches
  { name: 'Hoard: count text (amber) on ink plinth', fg: PALETTE.amber, bg: PALETTE.ink, min: 4.5 },
  { name: 'Hoard: link text (lagoon) on panel', fg: PALETTE.lagoon, bg: DERIVED.panel, min: 4.5 },
  { name: 'Hoard: dim name of an unowned plinth (cream-dim) on panel', fg: DERIVED.creamDim, bg: DERIVED.panel, min: 4.5 },
  { name: 'Hoard: tag text (cream-dim) on ink', fg: DERIVED.creamDim, bg: PALETTE.ink, min: 4.5 },
  { name: 'Hoard: plinth frame (edge) on ink', fg: DERIVED.edge, bg: PALETTE.ink, min: 3 },

  // ---- UI v3 B0 (UI.md 3.1; every new pair joins here) ----
  // opaque tool and control surfaces (decision: glass only on containers; a tool is OPAQUE surface2 + edge)
  { name: 'UI: body text on surface2', fg: PALETTE.cream, bg: DERIVED.surface2, min: 4.5 },
  { name: 'UI: body text on surface3', fg: PALETTE.cream, bg: DERIVED.surface3, min: 4.5 },
  { name: 'UI: dim text on surface2', fg: DERIVED.creamDim, bg: DERIVED.surface2, min: 4.5 },
  { name: 'UI: dim text on surface3', fg: DERIVED.creamDim, bg: DERIVED.surface3, min: 4.5 },
  { name: 'UI: body text on selected tint', fg: PALETTE.cream, bg: COMPUTED.selTint, min: 4.5 },
  { name: 'UI: accent text (amber) on surface2', fg: PALETTE.amber, bg: DERIVED.surface2, min: 4.5 },
  { name: 'UI: accent text (amber) on selected tint', fg: PALETTE.amber, bg: COMPUTED.selTint, min: 4.5 },
  { name: 'UI: link / ring (lagoon) on surface2', fg: PALETTE.lagoon, bg: DERIVED.surface2, min: 4.5 },
  { name: 'UI: link / ring (lagoon) on surface3', fg: PALETTE.lagoon, bg: DERIVED.surface3, min: 4.5 },
  { name: 'UI: control edge on surface2 (the weakest edge: 3.51)', fg: DERIVED.edge, bg: DERIVED.surface2, min: 3 },
  { name: 'UI: control edge on surface3 (hovered tool)', fg: DERIVED.edge, bg: DERIVED.surface3, min: 3 },
  { name: 'UI: selected ring (amber) on selected tint', fg: PALETTE.amber, bg: COMPUTED.selTint, min: 3 },
  { name: 'UI: hot edge (amber) on surface2', fg: PALETTE.amber, bg: DERIVED.surface2, min: 3 },
  // the gel: ink text on all three stops (the weakest is the bottom, 6.92) and on the lip-lit coral / plum variants
  { name: 'UI: gel text (ink) on gel top', fg: PALETTE.ink, bg: DERIVED.gelHi, min: 4.5 },
  { name: 'UI: gel text (ink) on lagoon', fg: PALETTE.ink, bg: PALETTE.lagoon, min: 4.5 },
  { name: 'UI: coral gel text (ink) on the top stop', fg: PALETTE.ink, bg: COMPUTED.coralHi, min: 4.5 },
  { name: 'UI: coral gel text (ink) on the bottom stop', fg: PALETTE.ink, bg: COMPUTED.coralLo, min: 4.5 },
  { name: 'UI: text (ink) on plum-bright', fg: PALETTE.ink, bg: DERIVED.plumBright, min: 4.5 },
  { name: 'UI: text (ink) on ok', fg: PALETTE.ink, bg: DERIVED.ok, min: 4.5 },
  { name: 'UI: text (ink) on danger', fg: PALETTE.ink, bg: DERIVED.danger, min: 4.5 },
  // state colours as text and icons
  { name: 'UI: plum-bright text on panel', fg: DERIVED.plumBright, bg: DERIVED.panel, min: 4.5 },
  { name: 'UI: plum-bright text on ink', fg: DERIVED.plumBright, bg: PALETTE.ink, min: 4.5 },
  { name: 'UI: plum-bright text on surface2', fg: DERIVED.plumBright, bg: DERIVED.surface2, min: 4.5 },
  { name: 'UI: success text (ok) on panel', fg: DERIVED.ok, bg: DERIVED.panel, min: 4.5 },
  { name: 'UI: success text (ok) on surface2', fg: DERIVED.ok, bg: DERIVED.surface2, min: 4.5 },
  { name: 'UI: error text (danger) on panel', fg: DERIVED.danger, bg: DERIVED.panel, min: 4.5 },
  { name: 'UI: error text (danger) on surface2', fg: DERIVED.danger, bg: DERIVED.surface2, min: 4.5 },
  { name: 'UI: error edge / icon (coral) on panel', fg: PALETTE.coral, bg: DERIVED.panel, min: 3 },
  { name: 'UI: error edge / icon (coral) on surface2', fg: PALETTE.coral, bg: DERIVED.surface2, min: 3 },
  // the focus ring: lagoon alone is 1.72 on white, so it sits inside a 2 px ink halo (ring 3 + halo vs white)
  { name: 'UI: focus ring (lagoon) on surface2', fg: COMPUTED.ring, bg: DERIVED.surface2, min: 3 },
  { name: 'UI: focus ring (lagoon) against its ink halo', fg: COMPUTED.ring, bg: COMPUTED.ringHalo, min: 3 },
  { name: 'UI: focus ring halo (ink) over a white scene', fg: COMPUTED.ringHalo, bg: WHITE, min: 3 },
  // translucent containers measured on the worst backdrop (white): glass 0.86 over white, scrim 0.62 over white
  { name: 'UI: text on glass over white', fg: PALETTE.cream, bg: overHex(PALETTE.plum, GLASS_ALPHA, WHITE), min: 4.5 },
  { name: 'UI: dim text on glass over white', fg: DERIVED.creamDim, bg: overHex(PALETTE.plum, GLASS_ALPHA, WHITE), min: 4.5 },
  { name: 'UI: text on scrim over white (modal backdrop caption)', fg: PALETTE.cream, bg: overHex(PALETTE.ink, SCRIM_ALPHA, WHITE), min: 4.5 },
  // jelly tones (body vs the ink outline and the panel) and tier / medal colours (vs ink and panel, >= 3: UI.md 3.1)
  ...(Object.keys(JELLY_BODIES) as JellyTone[]).flatMap((k) => [
    { name: `UI: jelly tone ${k} on ink`, fg: JELLY_BODIES[k], bg: PALETTE.ink, min: 3 },
    { name: `UI: jelly tone ${k} on panel`, fg: JELLY_BODIES[k], bg: DERIVED.panel, min: 3 },
  ]),
  ...TIER_IDS.flatMap((k) => [
    { name: `UI: rarity frame ${k} on ink`, fg: TIERS[k].frame, bg: PALETTE.ink, min: 3 },
    { name: `UI: rarity frame ${k} on panel`, fg: TIERS[k].frame, bg: DERIVED.panel, min: 3 },
  ]),
  ...MEDAL_IDS.flatMap((k) => [
    { name: `UI: medal ${k} on ink`, fg: MEDALS[k], bg: PALETTE.ink, min: 3 },
    { name: `UI: medal ${k} on panel`, fg: MEDALS[k], bg: DERIVED.panel, min: 3 },
  ]),
  // ---- UI v3 B6b: the Trophies screen. The trophy / lock icon (ink) sits on the medal plate (three gradient stops), and an earned card's text sits on a 12 % tint of its tier colour ----
  ...MEDAL_IDS.flatMap((k) => [
    { name: `UI: trophy icon (ink) on the ${k} plate`, fg: PALETTE.ink, bg: MEDALS[k], min: 3 },
    { name: `UI: trophy icon (ink) on the ${k} plate's bright stop`, fg: PALETTE.ink, bg: mixHex(MEDALS[k], PALETTE.cream, 0.52), min: 3 },
    { name: `UI: trophy icon (ink) on the ${k} plate's dark stop`, fg: PALETTE.ink, bg: mixHex(MEDALS[k], PALETTE.ink, 0.2), min: 3 },
    { name: `UI: text on an earned ${k} card's tint`, fg: PALETTE.cream, bg: mixHex(DERIVED.surface2, MEDALS[k], 0.12), min: 4.5 },
    { name: `UI: dim text on an earned ${k} card's tint`, fg: DERIVED.creamDim, bg: mixHex(DERIVED.surface2, MEDALS[k], 0.12), min: 4.5 },
    { name: `UI: "Earned" tick (ok) on an earned ${k} card's tint`, fg: DERIVED.ok, bg: mixHex(DERIVED.surface2, MEDALS[k], 0.12), min: 4.5 },
  ]),
];
// PURE: only probes read the table, so the bundler drops it (and its computed rows) from the game
export const CONTRAST_PAIRS: ReadonlyArray<ContrastPair> = /* @__PURE__ */ buildPairs();

const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const px = (n: number): string => `${n}px`;
const ms = (n: number): string => `${n}ms`;

/** CSS custom properties, kebab-cased: ink -> --wh-ink, creamDim -> --wh-cream-dim, plumBright -> --wh-plum-bright. */
export function themeVars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(PALETTE)) out[`--wh-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(DERIVED)) out[`--wh-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(COMPUTED)) out[`--wh-${kebab(k)}`] = v;
  for (const id of TIER_IDS) out[`--wh-tier-${id}`] = TIERS[id].frame;
  for (const id of MEDAL_IDS) out[`--wh-medal-${id}`] = MEDALS[id];
  // type
  out['--wh-font-ui'] = FONT_STACK;
  out['--wh-font-mono'] = MONO_STACK;
  // the `font` shorthands the sheets repeat, as ready-made tokens (weight size/line-height family): one short name instead of ~55 characters each time (the K05 byte cap counts them)
  for (const [k, [w, s, lh]] of Object.entries(FONT_COMBOS)) out[`--wh-${k}`] = `${WEIGHT[w]} ${px(TYPE[s])}/${lh === 'body' ? LEADING.body : lh} ${FONT_STACK}`;
  for (const [k, v] of Object.entries(TYPE)) out[`--wh-fs-${k}`] = px(v);
  out['--wh-w-mid'] = String(WEIGHT.mid);
  out['--wh-w-bold'] = String(WEIGHT.bold);
  out['--wh-lh-body'] = String(LEADING.body);
  out['--wh-lh-tight'] = String(LEADING.tight);
  out['--wh-track-label'] = TRACKING_LABEL;
  for (const [k, v] of Object.entries(JELLY_CAPS)) out[`--wh-cap-${k}`] = typeof v === 'number' ? px(v) : v;
  // space, shape, size
  // (the spacing tokens are --wh-s1..--wh-s6: the most repeated custom property in the sheets, so the name is kept short; the K05 byte cap counts every character)
  SPACE.forEach((v, i) => { out[`--wh-s${i + 1}`] = px(v); });
  out['--wh-gutter'] = px(GUTTER);
  out['--wh-gutter-narrow'] = px(GUTTER_NARROW);
  for (const [k, v] of Object.entries(RADII)) out[`--wh-r-${k}`] = px(v);
  for (const [k, v] of Object.entries(SIZES)) out[`--wh-${kebab(k)}`] = px(v);
  // depth
  for (const [k, v] of Object.entries(ELEV)) out[`--wh-${k === 'lip' ? 'lip-shadow' : kebab(k)}`] = v;
  // motion
  for (const [k, v] of Object.entries(MOTION)) out[`--wh-t-${k.replace(/^t/, '')}`] = ms(v);
  out['--wh-ease'] = EASE.out;
  out['--wh-ease-spring'] = EASE.spring;
  // stacking
  for (const [k, v] of Object.entries(Z)) out[`--wh-z-${k}`] = String(v);
  // focus ring geometry (the halo shadow is composed in base.css so it can sit beside a component's own shadow)
  out['--wh-ring-w'] = px(RING.width);
  out['--wh-ring-off'] = px(RING.offset);
  out['--wh-ring-halo-spread'] = px(RING.width + RING.offset + RING.halo);
  return out;
}

/** Install the tokens on :root (idempotent). Call before the stylesheet paints anything. */
export function installTheme(root: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(themeVars())) root.style.setProperty(k, v);
  root.style.colorScheme = 'dark';
}
