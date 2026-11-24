// Inline SVG icons (no icon fonts, no image files). All use currentColor, except the three hero
// portraits (drop, cinder, dab), which carry their own colours.

import { ELEMENT_UI, UI_ELEMENT_ORDER } from './elements.js';

const svg = (body, vb = '0 0 48 48') => `<svg viewBox="${vb}" width="100%" height="100%" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  // --- water forms
  liquid: svg('<path d="M24 5C30 15 37 22 37 30a13 13 0 0 1-26 0C11 22 18 15 24 5Z" fill="currentColor"/><ellipse cx="18.5" cy="29" rx="2.6" ry="4.6" fill="#fff" opacity=".55" transform="rotate(18 18.5 29)"/>'),
  ice: svg('<path d="M24 5 40 14v20L24 43 8 34V14Z" fill="currentColor"/><path d="M24 5v38M8 14l32 20M40 14 8 34" stroke="#fff" stroke-opacity=".5" stroke-width="2" fill="none"/>'),
  steam: svg('<circle cx="17" cy="28" r="9" fill="currentColor"/><circle cx="29" cy="24" r="11" fill="currentColor"/><circle cx="33" cy="33" r="7" fill="currentColor"/><circle cx="21" cy="17" r="6" fill="currentColor" opacity=".8"/><path d="M14 43c2-2 2-4 0-6M24 44c2-2 2-4 0-6M34 43c2-2 2-4 0-6" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".7"/>'),
  film: svg('<path d="M5 30c5-5 9-5 13-2s9 3 13 0 8-3 12 2c-3 6-9 9-19 9S8 36 5 30Z" fill="currentColor"/><path d="M11 30c4-2 7-1 10 1s8 2 12-1" stroke="#fff" stroke-opacity=".55" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M24 8v12m-5-5 5 5 5-5" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".7"/>'),
  // --- fire forms
  // ember: a squat glowing coal (cracks of light across it)
  ember: svg('<path d="M9 30c0-8 5-13 9-14 3-4 9-4 12 0 5 1 9 6 9 14 0 7-6 11-15 11S9 37 9 30Z" fill="currentColor"/><path d="M15 31l5-4 3 5 5-6 5 5" stroke="#fff" stroke-opacity=".6" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  // blaze: a tall flame with a hot core
  blaze: svg('<path d="M25 3c2 8 11 13 11 24a12.500 13 0 0 1-25 1c0-6 3-9 5-13 1 4 3 5 4 6 0-7 2-13 5-18Z" fill="currentColor"/><path d="M24 22c3 4 6 6 6 11a6 6.500 0 0 1-12 0c0-4 4-6 6-11Z" fill="#fff" opacity=".6"/>'),
  // smoke: a curl rising to a flat ceiling
  smoke: svg('<path d="M6 8h36" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".55"/><path d="M14 13h20a6 6 0 0 1 0 12h-3a6.500 6.500 0 0 1 0 13H19a6 6 0 0 1-1-12h-2a6.500 6.500 0 0 1-2-13Z" fill="currentColor"/><path d="M24 44c-3-2-3-4 0-6" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" opacity=".7"/>'),
  // spark: a bolt
  spark: svg('<path d="M28 3 10 27h11l-3 18 20-26H26Z" fill="currentColor"/><path d="M24 14l-7 10h7" stroke="#fff" stroke-opacity=".6" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  // --- clay forms
  clay: svg('<path d="M10 33c-2-9 3-18 11-21 8-3 17 2 19 11 1 6 0 11-3 14-4 4-22 5-25 1-1-1-2-3-2-5Z" fill="currentColor"/><path d="M19 20c3-3 8-3 11 0" stroke="#000" stroke-opacity=".3" stroke-width="2.5" fill="none" stroke-linecap="round"/>'),
  slip: svg('<path d="M6 34c0-5 8-8 18-8s18 3 18 8-8 8-18 8S6 39 6 34Z" fill="currentColor"/><path d="M24 5c3 5 6 8 6 12a6 6 0 0 1-12 0c0-4 3-7 6-12Z" fill="currentColor" opacity=".8"/><path d="M13 33c4-2 8-2 11-1" stroke="#fff" stroke-opacity=".5" stroke-width="2" fill="none" stroke-linecap="round"/>'),
  stone: svg('<path d="M14 9h18l10 13-5 18H11L6 22Z" fill="currentColor"/><path d="M14 9l6 13-9 18M32 9l-4 13 9 18M6 22h36" stroke="#000" stroke-opacity=".28" stroke-width="2" fill="none"/>'),
  dust: svg('<g fill="currentColor"><circle cx="14" cy="18" r="5"/><circle cx="27" cy="13" r="6"/><circle cx="36" cy="22" r="4.500"/><circle cx="20" cy="27" r="4"/><circle cx="31" cy="31" r="3.500"/><circle cx="14" cy="35" r="2.600"/><circle cx="24" cy="39" r="2.200"/><circle cx="36" cy="40" r="1.800"/></g>'),
  // --- controls
  jump: svg('<path d="M24 8 39 25h-9v15H18V25H9Z" fill="currentColor"/>'),
  pause: svg('<rect x="12" y="10" width="9" height="28" rx="3" fill="currentColor"/><rect x="27" y="10" width="9" height="28" rx="3" fill="currentColor"/>'),
  // --- collectibles: water glaze shard, fire glow-stone, clay maker's mark
  shard: svg('<path d="M24 4 37 22 24 44 11 22Z" fill="currentColor"/><path d="M24 4v40M11 22h26" stroke="#000" stroke-opacity=".25" stroke-width="2"/>'),
  shardEmpty: svg('<path d="M24 6 35.500 22 24 41.500 12.500 22Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>'),
  stoneGlow: svg('<circle cx="24" cy="25" r="13" fill="currentColor"/><path d="M24 3v6M24 41v5M4 25h5M39 25h5M9.500 10.500l4 4M38.500 10.500l-4 4" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M17 23c1-4 4-6 8-6" stroke="#fff" stroke-opacity=".7" stroke-width="2.5" fill="none" stroke-linecap="round"/>'),
  stoneGlowEmpty: svg('<circle cx="24" cy="25" r="12" fill="none" stroke="currentColor" stroke-width="3"/>'),
  mark: svg('<circle cx="24" cy="24" r="17" fill="currentColor"/><path d="M15 24h18M24 15v18M17.500 17.500l13 13" stroke="#000" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/>'),
  markEmpty: svg('<circle cx="24" cy="24" r="16" fill="none" stroke="currentColor" stroke-width="3"/>'),
  // --- gauges
  heat: svg('<path d="M25 3c2 8 11 13 11 24a12.500 13 0 0 1-25 1c0-6 3-9 5-13 1 4 3 5 4 6 0-7 2-13 5-18Z" fill="currentColor"/>'),
  moisture: svg('<path d="M24 5C30 15 37 22 37 30a13 13 0 0 1-26 0C11 22 18 15 24 5Z" fill="currentColor"/>'),
  // --- chrome
  lock: svg('<rect x="11" y="21" width="26" height="20" rx="4" fill="currentColor"/><path d="M16 21v-5a8 8 0 0 1 16 0v5" stroke="currentColor" stroke-width="4" fill="none"/>'),
  check: svg('<path d="M9 25l10 10 20-22" stroke="currentColor" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  back: svg('<path d="M29 9 14 24l15 15" stroke="currentColor" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  close: svg('<path d="M12 12l24 24M36 12 12 36" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>'),
  play: svg('<path d="M15 8l24 16-24 16Z" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>'),
  next: svg('<path d="M8 24h28M25 11l13 13-13 13" stroke="currentColor" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  levels: svg('<path d="M24 44V8" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M24 9h15l5 6-5 6H24Z M24 25H10l-5 6 5 6h14Z" fill="currentColor"/>'),
  gear: svg('<path d="M24 4l4 1 1 5 4 2 5-2 3 4-3 4 1 4 5 2v5l-5 2-1 4 3 4-3 4-5-2-4 2-1 5-4 1-4-1-1-5-4-2-5 2-3-4 3-4-1-4-5-2v-5l5-2 1-4-3-4 3-4 5 2 4-2 1-5Z" fill="currentColor"/><circle cx="24" cy="26" r="7" fill="#000" fill-opacity=".35"/>'),
  restart: svg('<path d="M38 24a14 14 0 1 1-5-10.700" stroke="currentColor" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M36 4v12H24" stroke="currentColor" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  flag: svg('<path d="M12 44V6" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M12 8h26l-7 9 7 9H12Z" fill="currentColor"/>'),
  home: svg('<path d="M6 24 24 7l18 17v17a2 2 0 0 1-2 2H29V30H19v13H8a2 2 0 0 1-2-2Z" fill="currentColor"/>'),
  clock: svg('<circle cx="24" cy="26" r="16" fill="none" stroke="currentColor" stroke-width="6"/><path d="M24 16v10l7 5M18 5h12" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round"/>'),
  // --- hero portraits: flat colour, an ink outline, eyes with a ring - the same language as the game's own heroes
  // Mote, the drop
  drop: svg('<path d="M32 5C42 21 55 31 55 43a23 22 0 0 1-46 0C9 31 22 21 32 5Z" fill="#2fb4f0" stroke="#12303f" stroke-width="4" stroke-linejoin="round"/><path d="M15 50a23 22 0 0 0 38-2c-6 8-22 12-38 2Z" fill="#1668c9"/><path d="M20 31c2-6 5-10 9-15" stroke="#fff" stroke-width="4.500" fill="none" stroke-linecap="round"/><circle cx="18" cy="38" r="2.500" fill="#fff"/><ellipse cx="24.500" cy="44" rx="6" ry="7.500" fill="#fff" stroke="#12303f" stroke-width="2.500"/><ellipse cx="40.500" cy="44" rx="6" ry="7.500" fill="#fff" stroke="#12303f" stroke-width="2.500"/><ellipse cx="26" cy="45.500" rx="3" ry="4.200" fill="#0b1c44"/><ellipse cx="42" cy="45.500" rx="3" ry="4.200" fill="#0b1c44"/><circle cx="27.300" cy="43.600" r="1.300" fill="#fff"/><circle cx="43.300" cy="43.600" r="1.300" fill="#fff"/>', '0 0 64 68'),
  // Cinder: a coal with a face, standing in its own flame - red rim, orange, a yellow heart
  cinder: svg('<path d="M33 3c2 9 14 14 15 29 3-3 4-6 4-9 6 9 7 19 3 27-4 9-13 15-23 15S13 59 9 50c-4-8-2-17 3-24 0 4 2 7 5 9-2-13 7-16 9-24 2 3 3 5 3 8 3-4 4-9 4-16Z" fill="#ff5a14" stroke="#7a1206" stroke-width="4" stroke-linejoin="round"/><path d="M32 22c2 6 9 9 10 18 3 9-3 19-10 19s-13-8-11-18c1-5 4-7 6-11 1 3 2 4 3 5 0-5 1-9 2-13Z" fill="#ffb52e"/><path d="M14 51c0-8 7-13 18-13s18 5 18 13-7 12-18 12-18-4-18-12Z" fill="#33141a" stroke="#170a08" stroke-width="3.500"/><path d="M19 56l5-3 3 4M40 57l4-4 3 2" stroke="#ff8a1c" stroke-width="2.500" fill="none" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="25.500" cy="48" rx="5.500" ry="6.800" fill="#fffbe6" stroke="#170a08" stroke-width="2.500"/><ellipse cx="39.500" cy="48" rx="5.500" ry="6.800" fill="#fffbe6" stroke="#170a08" stroke-width="2.500"/><ellipse cx="26.800" cy="49.300" rx="2.700" ry="3.800" fill="#2a0c02"/><ellipse cx="40.800" cy="49.300" rx="2.700" ry="3.800" fill="#2a0c02"/><circle cx="28" cy="47.600" r="1.200" fill="#fff"/><circle cx="42" cy="47.600" r="1.200" fill="#fff"/>', '0 0 64 68'),
  // Dab, the thumb of clay: a soft pressed lump with a thumbprint and two pushed-in eyes
  dab: svg('<path d="M11 47c-3-15 2-29 13-34 7-3 14-2 19 3 9 8 13 23 9 35-3 9-11 14-21 14S14 58 11 47Z" fill="#e08e63" stroke="#3a2a22" stroke-width="4" stroke-linejoin="round"/><path d="M14 52c5 8 26 12 38-2-3 9-11 14-21 14-8 0-14-5-17-12Z" fill="#b5613a"/><path d="M22 23c4-5 13-5 17 0M25 28c3-3 8-3 11 0" stroke="#fbd9bd" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="25" cy="43" rx="5.500" ry="6.800" fill="#fff8ea" stroke="#3a2a22" stroke-width="2.500"/><ellipse cx="40" cy="43" rx="5.500" ry="6.800" fill="#fff8ea" stroke="#3a2a22" stroke-width="2.500"/><ellipse cx="26.200" cy="44.300" rx="2.700" ry="3.800" fill="#3a2a22"/><ellipse cx="41.200" cy="44.300" rx="2.700" ry="3.800" fill="#3a2a22"/><circle cx="27.300" cy="42.700" r="1.200" fill="#fff"/><circle cx="42.300" cy="42.700" r="1.200" fill="#fff"/>', '0 0 64 68'),
};

/** Portrait icon of each element's hero. */
export const HERO_ICONS = { water: ICONS.drop, fire: ICONS.cinder, clay: ICONS.dab };
/** Collectible icons (full / empty outline) per element. */
export const COLLECTIBLE_ICONS = {
  water: [ICONS.shard, ICONS.shardEmpty],
  fire: [ICONS.stoneGlow, ICONS.stoneGlowEmpty],
  clay: [ICONS.mark, ICONS.markEmpty],
};
/** Gauge icon per element (water has no separate meter). */
export const GAUGE_ICONS = { water: ICONS.steam, fire: ICONS.heat, clay: ICONS.moisture };

// Key cap and label of every form of every element (keyboard 1-4 in button order).
export const FORM_KEYS = {};
export const FORM_LABELS = {};
for (const id of UI_ELEMENT_ORDER) ELEMENT_UI[id].forms.forEach((f, i) => { FORM_KEYS[f.id] = String(i + 1); FORM_LABELS[f.id] = f.label; });
