// ONE original icon family (UI.md 3.3): 24 grid, stroke 2, round caps and joins, currentColor, no text glyphs, no icon font, no assets.
// Replaces dom.ts ICONS, the old tool tray's paths, panel.ts cabinetGlyph and meterRing.ts's capsule glyph, and the ad-hoc text glyphs of the audit
// (heart, clock, back chevron, arrow, plus, help, more). Later batches migrate their callers; dom.ts keeps its own copy until then so no
// existing screen changes in B0.
//
// Family rules (checked by probe_app.ts): every path uses only M L H V C S Q T A Z (absolute or relative), every number stays inside the
// 24 grid with 2 px of padding (1..23 for geometry; the strokes bleed to the edge), names are unique, camelCase.
//
// hand / cut / snap are kept verbatim from the old tool tray (the glyphs are pinned in _harness/probe_uikit.ts); split / join are given by UI.md 3.3.

const SVG_NS = 'http://www.w3.org/2000/svg';
const CIRCLE = 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z';

export const ICON_PATHS = {
  // ---- tools (UI.md 4.3) ----
  hand: ['M8 12.5V6.8a1.6 1.6 0 0 1 3.2 0V11', 'M11.2 10.6V5.4a1.6 1.6 0 0 1 3.2 0v5.2', 'M14.4 10.8V6.6a1.6 1.6 0 0 1 3.2 0v6.6c0 4-2.6 6.8-6.2 6.8-2.6 0-4.1-1.3-5.4-3.4l-2-3.4a1.5 1.5 0 0 1 2.5-1.6L8 13'],
  cut: ['M5 19 15.5 8.5', 'M15.5 8.5l2.6-2.6a1.8 1.8 0 0 1 2.5 2.5L18 11', 'M5 19l3.6-.9', 'M9 15.4l2.2 2.2'],
  snap: ['M4 8.5h3l1.6-2.5h6.8L17 8.5h3v10H4z', 'M12 16.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z'],
  split: ['M12 3v18M8 8l-4 4 4 4M16 8l4 4-4 4'],
  join: ['M3 12h7M7 8.5 10.5 12 7 15.5M21 12h-7M17 8.5 13.5 12 17 15.5'],
  stamp: ['M10 4h4v4.2l3.4 3.1c.4.4.6.8.6 1.3V15H6v-2.4c0-.5.2-.9.6-1.3L10 8.2z', 'M5 19h14'],
  roll: ['M7 8.5h10v7H7z', 'M3.5 12H7M17 12h3.5', 'M9 19.5h6'],
  clean: ['M10.5 4.2a8 8 0 0 0 0 15.6', 'M13.5 4.2a8 8 0 0 1 0 15.6'],
  minis: ['M8 5.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z', 'M16.5 8.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z', 'M10.5 14a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z'],
  // ---- HUD and navigation ----
  gear: ['M18.47 10.69 L21.12 10.81 L21.12 13.19 L18.47 13.31 L17.50 15.65 L19.29 17.61 L17.61 19.29 L15.65 17.50 L13.31 18.47 L13.19 21.12 L10.81 21.12 L10.69 18.47 L8.35 17.50 L6.39 19.29 L4.71 17.61 L6.50 15.65 L5.53 13.31 L2.88 13.19 L2.88 10.81 L5.53 10.69 L6.50 8.35 L4.71 6.39 L6.39 4.71 L8.35 6.50 L10.69 5.53 L10.81 2.88 L13.19 2.88 L13.31 5.53 L15.65 6.50 L17.61 4.71 L19.29 6.39 L17.50 8.35Z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  menu: ['M4 7h16M4 12h16M4 17h16'],
  close: ['M6 6l12 12M18 6L6 18'],
  soundOn: ['M4.5 9.5h3.2L12 6v12l-4.3-3.5H4.5z', 'M15.2 9.3a3.6 3.6 0 0 1 0 5.4M17.6 7a7 7 0 0 1 0 10'],
  soundOff: ['M4.5 9.5h3.2L12 6v12l-4.3-3.5H4.5z', 'M15.5 9.5l5 5M20.5 9.5l-5 5'],
  fullscreen: ['M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'],
  fullscreenExit: ['M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5'],
  hoard: ['M5 4h14v16H5z', 'M5 9.5h14M5 15h14', 'M9 7h2M13 12.3h2M9 17.6h2'],
  capsule: ['M12 3.5c3.6 0 6 3.7 6 8.5s-2.4 8.5-6 8.5S6 16.8 6 12 8.4 3.5 12 3.5z', 'M6.2 12h11.6'],
  shelf: ['M3.5 19h17', 'M7.5 12a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z', 'M13.5 19v-6.5h6V19'],
  trophy: ['M8 4h8v5a4 4 0 0 1-8 0z', 'M8 6H5v1.5A3 3 0 0 0 8 10.5M16 6h3v1.5a3 3 0 0 1-3 3', 'M12 13v4M10 17h4M8.5 20h7'],
  gift: ['M4 11h16v9H4z', 'M3 7.5h18V11H3z', 'M12 7.5V20', 'M12 7.5C10 7.5 8 6.5 8 5s2.5-1.5 4 2.5c1.5-4 4-3.5 4-2.5S14 7.5 12 7.5z'],
  today: ['M5 6h14v14H5z', 'M5 10.5h14', 'M9 4v4M15 4v4'],
  lock: ['M7 11h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3', 'M12 14.5v2'],
  book: ['M4 5.5c2.5-1 5.5-1 8 .5 2.5-1.5 5.5-1.5 8-.5V19c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z', 'M12 6v13.5'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4.5 20a7.5 7.5 0 0 1 15 0'],
  star: ['M12 3.5l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.9l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z'],
  heart: ['M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z'],
  clock: [CIRCLE, 'M12 7.5V12l3 2'],
  // ---- arrows and marks ----
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  chevronLeft: ['M14.5 6 8.5 12l6 6'],
  chevronRight: ['M9.5 6l6 6-6 6'],
  chevronUp: ['M6 14.5l6-6 6 6'],
  chevronDown: ['M6 9.5l6 6 6-6'],
  arrowRight: ['M5 12h14M13 6l6 6-6 6'],
  arrowLeft: ['M19 12H5M11 6l-6 6 6 6'],
  more: ['M5 12a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 0 0-2.4 0z', 'M10.8 12a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 0 0-2.4 0z', 'M16.6 12a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 0 0-2.4 0z'],
  help: [CIRCLE, 'M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.8.5-1.2 1-1.2 2', 'M12 16.8h.01'],
  // ---- status (toasts, errors) ----
  info: [CIRCLE, 'M12 11v5.5', 'M12 7.8h.01'],
  success: [CIRCLE, 'M8 12.3l2.8 2.8L16.2 9.5'],
  warning: ['M10.7 4.8 3.6 17.2A1.5 1.5 0 0 0 4.9 19.5h14.2a1.5 1.5 0 0 0 1.3-2.3L13.3 4.8a1.5 1.5 0 0 0-2.6 0z', 'M12 10v4', 'M12 16.8h.01'],
  error: [CIRCLE, 'M9 9l6 6M15 9l-6 6'],
  // ---- actions ----
  save: ['M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14'],
  newTab: ['M14 4h6v6M20 4l-9 9M18 14v5H5V6h5'],
  copy: ['M8 8h11v12H8z', 'M5 16V4h11'],
  sort: ['M7 5v14M4 16l3 3 3-3M17 19V5M14 8l3-3 3 3'],
  filter: ['M4 5h16l-6 7.5V19l-4 1.5v-8z'],
  reset: ['M4.5 12a7.5 7.5 0 1 0 2.4-5.5', 'M4.5 4.5V9H9'],
  play: ['M8 5.5v13l10-6.5z'],
  pause: ['M8.5 5v14M15.5 5v14'],
  skip: ['M5.5 6v12l8-6z', 'M17.5 6v12'],
  // ---- settings ----
  table: ['M4 15h16', 'M7 15v4M17 15v4', 'M8.5 15c0-3 1.6-5.5 3.5-5.5s3.5 2.5 3.5 5.5'],
  float: ['M4 18.5h16', 'M8.5 13c0-3 1.6-5.5 3.5-5.5s3.5 2.5 3.5 5.5z', 'M9 16h6'],
  music: ['M9 18V6l10-2v12', 'M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z', 'M19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z'],
  sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M19 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z'],
  vibrate: ['M9 5h6a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M4.5 9v6M19.5 9v6'],
  calm: ['M5 19c0-8 4-13 14-14 0 9-4 13-12 13', 'M5 19c2-4 5-7 9-9'],
  bolt: ['M13 3 5 13.5h6L10 21l9-11.5h-6z'],
  keyboard: ['M3.5 7h17v10h-17z', 'M7 10.5h.01M10.5 10.5h.01M14 10.5h.01M17 10.5h.01', 'M8.5 14h7'],
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof ICON_PATHS;
export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[];

/** The path strings of an icon (empty for an unknown name, so a typo draws nothing instead of throwing). */
export function iconPaths(name: string): readonly string[] {
  return (ICON_PATHS as Record<string, readonly string[]>)[name] ?? [];
}

export interface IconOpts {
  /** Solid fill (a hearted heart, a played triangle): sets class `k-fill`; the stroke stays. */
  fill?: boolean;
  /** Pixel size; omit to let `.k-icon` (24 px) decide. */
  size?: number;
}

/** A fresh `<svg>` of the icon: decorative (`aria-hidden`), `currentColor`, ready for `.k-icon`. */
export function icon(name: IconName | (string & {}), cls = 'k-icon', o: IconOpts = {}): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(o.size ?? 24));
  svg.setAttribute('height', String(o.size ?? 24));
  svg.setAttribute('class', o.fill ? `${cls} k-fill` : cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of iconPaths(name)) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
