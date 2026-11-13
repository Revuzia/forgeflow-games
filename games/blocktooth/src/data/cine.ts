// BLOCKTOOTH v2 — per-biome cinematic-opening variants: the WARD-7 STREET CAM (FEATURES_V2 §11.3).
// View data (no three import). Lane L10 owns and tunes it; render/cinecam.ts plans the shots from it,
// ui/cine.ts reads the grade / lens / sub-line.
//
// Units: distances and heights are in TITAN HEIGHTS (H, the Size I body height at the opening), angles
// in degrees.
//
// yawTriesDeg — where the S1 street camera may stand, as an AZIMUTH OFFSET FROM THE TITAN'S FACING
// (0 = straight in front of its face, +30 = 30° toward its left). The spec (§11.2) writes the same
// list as the camera's LOOK heading, [+150°, −150°, 180°, +120°, −120°] from the titan's heading: a
// camera that looks along heading+150° stands at heading−30° → the two lists are the same five poses,
// in the same order (front three-quarters first, then head-on, then the wider profiles). The planner
// takes the first camera-safe one (plus the per-biome foreground bonus, see render/cinecam.ts).

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
  // GRID-EAST (day): bumper height across the zebra, past a parked car; clean lens, warm grade
  grideast: {
    streetDistH: 7, streetCamH: 0.2, yawTriesDeg: [30, -30, 0, 60, -60],
    foreground: 'parkedCar', grade: { tint: '#ffe9c9', alpha: 0.08 }, lens: 'clean', bob: null, breath: false,
    sub: 'PARKING ENFORCEMENT HAS BEEN NOTIFIED',
  },
  // WHITE STACKS (overcast): from behind a snowbank; frost vignette, cool grade, breath at the snarl
  whitestacks: {
    streetDistH: 7, streetCamH: 0.3, yawTriesDeg: [30, -30, 0, 60, -60],
    foreground: 'snowbank', grade: { tint: '#dcecff', alpha: 0.1 }, lens: 'frost', bob: null, breath: true,
    sub: 'PLOW CREWS ADVISED TO KEEP THEIR DISTANCE',
  },
  // LOCKWATER (night): over a boat's gunwale, bobbing; rain on the lens, magenta/cyan rim
  lockwater: {
    streetDistH: 7, streetCamH: 0.25, yawTriesDeg: [30, -30, 0, 60, -60],
    foreground: 'hull', grade: { tint: '#ff4fd8', alpha: 0.06 }, lens: 'rain', bob: { rollDeg: 1.5, hz: 0.4, yH: 0.03 }, breath: false,
    sub: 'HARBOR PATROL IS MONITORING THE SITUATION',
  },
};

/** Shot-list timing (s) per variant (§11.2). `street` is absent from SHORT / REDUCED. */
export const CINE_TIMING = {
  full: { signal: 0.35, street: 2.0, closeup: 2.5, crane: 1.6, handoff: 0.4 },   // 6.85 s
  short: { closeup: 1.5, crane: 1.2, handoff: 0.3 },                                // 3.0 s
  reduced: { closeup: 2.0, handoff: 0.4 },                                          // 2.4 s (no crane)
} as const;

/** Camera and performance beats (§11.2), in seconds from the START OF THE CLOSE-UP (S2). */
export const CINE_BEATS = {
  full: { look: 0.05, blink: 0.55, snarl: 1.35, lowerThird: 0.25 },
  short: { look: 0.0, blink: 0.3, snarl: 0.8, lowerThird: 0.15 },
  reduced: { look: 0.05, blink: 0.5, snarl: 1.0, lowerThird: 0.15 },
} as const;

/** S1 / S2 / S3 camera constants (§11.2). */
export const CINE_CAM = {
  streetFov: 40, streetZoomFov: 24, crashZoomAt: 1.25, crashZoomS: 0.25,     // crash zoom 1.25 s into S1 (t = 1.6 s)
  handheldDeg: 0.6, handheldHz: 1.3, jitterM: 0.01,
  closeYawDeg: 50, closeDistH: 2.4, closeCamH: 0.35, closeFov: 30, closeOrbitDeg: 4,
  // §11.2 asks for 35° off the head's forward axis; measured on the four heads (scratch/l10 shots) 35° still
  // reads as a centred head-on face (the eyes sit on the sides of wide skulls), so the three-quarter starts at 50°
  closeYawAlt: [50, 42, 58, 35],                   // tried in order on each side (camera safety)
  closeDistAlt: [2.4, 2.1, 2.8],
  /** lead room: the S2 aim point moves this far (× H) along the head's forward, so the face sits off-centre */
  closeLeadH: 0.3,
  craneBackH: 3, craneUpH: 2,
  near: 0.05, far: 2000,
  /** skip: blend to the gameplay pose (s) */
  skipS: 0.25,
  /** camera clearance from any building AABB (m) */
  clearM: 0.5,
} as const;
