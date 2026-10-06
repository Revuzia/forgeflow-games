// The one place the WOBBLEHOARD palette lives (CONTRACT.md section 7). styles.css only ever reads var(--wh-*).
// Everything here is original: a toy photographed on a dark felt play-mat, warm softbox, cool rim light.

export const PALETTE = {
  ink: '#14102a',      // background, deepest
  plum: '#2a1744',     // raised surfaces
  dusk: '#5b3a86',     // borders, quiet fills
  felt: '#2a2150',     // the play-mat
  amber: '#ffb347',    // sodium key light, primary accent
  lagoon: '#59d6e6',   // cold rim light, focus rings, links
  coral: '#ff5a4d',    // ember core, hot accent
  cream: '#fff1d6',    // text
} as const;
export type PaletteKey = keyof typeof PALETTE;

/** Derived tones. Kept as literals (not alpha mixes) so contrast can be measured exactly, see probe_app.ts. */
export const DERIVED = {
  creamDim: '#c9bdcf',   // secondary text on ink / plum (>= 4.5:1, measured)
  panel: '#1d1538',      // opaque panel surface: between ink and plum
  panelEdge: '#4a3270',  // hairline border
  track: '#3b2a5f',      // slider track / control fill
  amberDeep: '#e8862a',  // pressed amber
  danger: '#ff8a80',     // error text on ink (lighter coral for contrast)
  edge: '#8a67b8',       // control outlines: >= 3:1 on the panel
} as const;

/** Foreground / background pairs the UI actually uses. probe_app.ts asserts every one is >= its minimum ratio. */
export const CONTRAST_PAIRS: ReadonlyArray<{ name: string; fg: string; bg: string; min: number }> = [
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
];

/** CSS custom properties, kebab-cased: ink -> --wh-ink, creamDim -> --wh-cream-dim. */
export function themeVars(): Record<string, string> {
  const out: Record<string, string> = {};
  const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
  for (const [k, v] of Object.entries(PALETTE)) out[`--wh-${kebab(k)}`] = v;
  for (const [k, v] of Object.entries(DERIVED)) out[`--wh-${kebab(k)}`] = v;
  return out;
}

/** Install the tokens on :root (idempotent). Call before the stylesheet paints anything. */
export function installTheme(root: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(themeVars())) root.style.setProperty(k, v);
  root.style.colorScheme = 'dark';
}

// ---- contrast maths (WCAG 2.x relative luminance), pure so the node probe can use it ----
const hex = (h: string): [number, number, number] => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lin = (c: number): number => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
export function luminance(h: string): number {
  const [r, g, b] = hex(h);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
