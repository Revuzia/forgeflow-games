// BLOCKTOOTH v2 — per-biome cinematic-opening variants (FEATURES_V2 §11.3). View data (no three import).
//
// ── L0 SKELETON STUB ── the §11.3 table as starting values; lane L10 owns and tunes it (the stub
// render/cinecam.ts plan() returns null, so the legacy slate plays).

import type { BiomeId } from '../core/types.ts';

/** data/cine.ts CINE: Record<BiomeId, CineBiome> (the snippet's CineBiome, FEATURES_V2 APP-SIDE section). */
export interface CineBiome {
  streetDistH: number; streetCamH: number;          // S1 distance / camera height in titan heights
  yawTriesDeg: number[];                            // heading offsets tried in order (camera safety, §11.2)
  foreground: 'parkedCar' | 'snowbank' | 'hull';    // S1 foreground element (never a street sign)
  grade: { tint: string; alpha: number };           // CSS grade layer
  lens: 'clean' | 'frost' | 'rain';
  bob: { rollDeg: number; hz: number; yH: number } | null;
  breath: boolean;                                  // breath puffs at the snarl (WHITE STACKS)
  sub: string;                                      // lower-third sub-line
}

export const CINE: Record<BiomeId, CineBiome> = {
  grideast: {
    streetDistH: 3, streetCamH: 0.2, yawTriesDeg: [0, 30, -30, 60, -60],
    foreground: 'parkedCar', grade: { tint: '#ffe9c9', alpha: 0.08 }, lens: 'clean', bob: null, breath: false,
    sub: 'PARKING ENFORCEMENT HAS BEEN NOTIFIED',
  },
  whitestacks: {
    streetDistH: 3, streetCamH: 0.3, yawTriesDeg: [0, 30, -30, 60, -60],
    foreground: 'snowbank', grade: { tint: '#dcecff', alpha: 0.08 }, lens: 'frost', bob: null, breath: true,
    sub: '',
  },
  lockwater: {
    streetDistH: 3, streetCamH: 0.25, yawTriesDeg: [0, 30, -30, 60, -60],
    foreground: 'hull', grade: { tint: '#ff4fd8', alpha: 0.06 }, lens: 'rain', bob: { rollDeg: 1.5, hz: 0.4, yH: 0.03 }, breath: false,
    sub: '',
  },
};
