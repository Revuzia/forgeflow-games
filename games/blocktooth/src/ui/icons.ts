// BLOCKTOOTH v2 — procedural SVG glyphs for cards, the ability bar, markers and toasts (FEATURES_V2 §4.3). UI.
//
// ── L0 SKELETON STUB ── exact exports; every glyph is an empty string, iconFor → 'star'. Lane L8 draws
// the 58 glyphs and the family / rarity mapping.

import type { UpgradeDef } from '../core/types.ts';
import type { GlyphId } from '../v2types.ts';

const IDS: readonly GlyphId[] = [
  'heart', 'plate', 'drip', 'thorn', 'fang', 'brick', 'halo', 'bandage',
  'boot', 'dash', 'hourglass',
  'arrowUp', 'star', 'dice', 'cycle', 'magnet', 'reach',
  'claw', 'tempo', 'reticle', 'burst', 'bullseye', 'exclaim', 'fist', 'links', 'chunk', 'wreck',
  'foot', 'ripple', 'bolt',
  'hook', 'megaphone',
  'jaw', 'vortex', 'fork', 'wire', 'dome', 'lava', 'turret', 'spore', 'vine',
  'flame', 'meteor', 'snow',
  'plus', 'lock', 'banish', 'evo', 'overload', 'annex', 'trafficLight', 'notice', 'rush', 'coin',
  'ribbon', 'swatch', 'key', 'till',
];

/** SVG path data (viewBox 0 0 24 24) per glyph. STUB: all empty. */
export const GLYPHS: Record<GlyphId, string> = Object.fromEntries(IDS.map((id) => [id, ''])) as Record<GlyphId, string>;

export function iconFor(_u: UpgradeDef): GlyphId { return 'star'; }

/** An inline <svg> string. STUB: an empty svg of the requested size. */
export function glyphSvg(id: GlyphId, fill: string, sizePx = 24): string {
  return `<svg viewBox="0 0 24 24" width="${sizePx}" height="${sizePx}" aria-hidden="true"><path d="${GLYPHS[id] ?? ''}" fill="${fill}"/></svg>`;
}

export function rarityFrameClass(u: UpgradeDef): string { return 'bt-frame-' + u.rarity; }

export function familyColor(_u: UpgradeDef): string { return '#f1e4c8'; }
