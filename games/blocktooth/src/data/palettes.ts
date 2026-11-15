// BLOCKTOOTH v2 — alternate titan palettes (FEATURES_V2 §8.6). View-only data (w.meta.palette).
//
// Lane L5 owns the data (the §8.6 colour table verbatim); lane L10 renders it (titans/models.ts palette
// param, titans/portraits.ts renderPortrait). Index i here = RunMeta.palette i + 1 (0 = canonical).
// Unlocked by the titan goals in data/goals.ts (palette index 1 / 2).

import type { TitanId, TitanPalette } from '../core/types.ts';

export const TITAN_PALETTES: Record<TitanId, [TitanPalette, TitanPalette]> = {
  molo: [
    { id: 'molo_tidepool', name: 'TIDEPOOL', primary: '#2f9fb0', secondary: '#1d5e70', belly: '#f1dfb0', accent: '#ffd6a0', glow: '#9ff4ff', eye: '#ffd166' },
    { id: 'molo_rust_belt', name: 'RUST BELT', primary: '#b0643a', secondary: '#6e3a22', belly: '#e8c9a0', accent: '#f1e4c8', glow: '#ffcf7a', eye: '#fff27a' },
  ],
  voltkite: [
    { id: 'voltkite_sodium_lamp', name: 'SODIUM LAMP', primary: '#2b2622', secondary: '#16120f', belly: '#6b5a45', accent: '#ffb13b', glow: '#ffc85e', eye: '#fff27a' },
    { id: 'voltkite_sleet', name: 'SLEET', primary: '#dfe6ee', secondary: '#9aa8b8', belly: '#ffffff', accent: '#6ff3ff', glow: '#6ff3ff', eye: '#3b3f9e' },
  ],
  hearthback: [
    { id: 'hearthback_cooled_flow', name: 'COOLED FLOW', primary: '#3a3f47', secondary: '#5d6670', belly: '#8a8f96', accent: '#6fd8ff', glow: '#9ff0ff', eye: '#e9f1ff' },
    { id: 'hearthback_terracotta', name: 'TERRACOTTA', primary: '#8e4a3a', secondary: '#5a2f25', belly: '#c98a5e', accent: '#ffd166', glow: '#ffe39a', eye: '#fff3b0' },
  ],
  briarwick: [
    { id: 'briarwick_autumn_lot', name: 'AUTUMN LOT', primary: '#b8702e', secondary: '#5e3a22', belly: '#e8c07a', accent: '#ff6f5e', glow: '#ffd166', eye: '#fff3b0', extra: '#f1e4c8' },
    { id: 'briarwick_night_garden', name: 'NIGHT GARDEN', primary: '#4a3a78', secondary: '#2a2240', belly: '#9c8fd0', accent: '#7affc9', glow: '#b8ff7a', eye: '#fff3b0', extra: '#d8d0f0' },
  ],
};
