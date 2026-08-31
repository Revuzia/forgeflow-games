/**
 * ASCENDANT — runtime/world/themes.js
 * CONTRACT section 9.
 *
 * Five complete dioramas. Each one is a different *place*, not a hue shift: its
 * own key-light direction and colour, its own bounce, its own fog density, its
 * own exposure, grade and bloom curve, its own air (embers / snow / motes) and
 * its own sky shader. Swapping themes should feel like walking outdoors.
 *
 * ---------------------------------------------------------------------------
 * LIGHT DIRECTION CONVENTION
 * ---------------------------------------------------------------------------
 * `lights.*.dir` is the unit vector FROM the scene TOWARD the light, i.e.
 *     light.position = normalize(dir) * distance;  light.target at the focus.
 * So dir[1] > 0 means the light is above you, dir[1] < 0 means it shines UP
 * from below (foundry's lava bounce is the only one that does).
 *
 * ---------------------------------------------------------------------------
 * READABILITY LAW  (CONTRACT section 9) — measured, not asserted
 * ---------------------------------------------------------------------------
 * The law: `palette.safe` must hold >= 3.5:1 relative-luminance contrast against
 * `bg` at 30 m of fog, and `palette.kill` must be unmistakably hot/saturated
 * against everything that means "you can be here".
 *
 * Measured (WCAG relative luminance; safe first blended toward `fog` by that
 * theme's exp2 fog factor at 30 m, then compared with `bg`):
 *
 *   theme     fog@30m   safe@30m vs bg   edge vs safe   cpOn vs cpOff
 *   neon       0.049        4.43:1          3.57:1          7.79:1
 *   foundry    0.206        4.66:1          2.07:1          9.13:1
 *   spire      0.070        5.92:1          5.17:1          4.02:1
 *   temple     0.027        4.12:1          2.25:1          3.40:1
 *   hub        0.032        6.47:1          2.14:1          8.09:1
 *
 * Kill separation. Every `kill` is saturation >= 0.87 in the 330-40 deg hot
 * band, and is >= 45 deg of hue from `safe`, `safeEdge`, `checkpointOn` and
 * `finish` in every theme:
 *   neon 347deg  foundry 15deg  spire 352deg  temple 347deg  hub 0deg
 * Foundry is the one theme whose *decor* shares the hot band — the whole place
 * is orange — so there the discriminator is carried by emission and motion
 * instead: hazards are the only orange things that are self-lit AND animated,
 * and every landable surface there is cold steel wearing a cyan edge stripe.
 *
 * Cross-theme constants, so muscle memory transfers between worlds:
 *   kill          = hot red/orange, always emissive, always moving
 *   checkpointOn  = mint/emerald (149-174 deg from that theme's kill)
 *   finish        = violet, a hue used for nothing else in any theme
 *   safeEdge      = the brightest thing on a landable surface
 * Red/green pairs are never the *only* cue (deuteranopia): kill animates,
 * checkpoints pulse, and their luminances differ by >= 2:1 in every theme.
 */

import * as THREE from 'three';
import { buildSky, buildEnvCubemap } from './sky.js';

/* ========================================================================== *
 * THEME DEFINITIONS                                                          *
 * ========================================================================== */

/** @type {Object<string, object>} */
export const THEMES = {

  /* ------------------------------------------------------------------ NEON */
  /* Deep indigo-black void. A magenta key rakes in from the LOW LEFT so every
   * platform gets a long coloured shadow; a cyan fill lifts the shadow side and
   * a hot cyan rim separates silhouettes from the black. Tight exp2 fog, heavy
   * bloom, an infinite grid horizon and slow floating motes.                 */
  neon: {
    id: 'neon',
    name: 'NEON DOJO',
    bg: 0x05060f,
    exposure: 1.06,
    envIntensity: 0.90,

    fog: { color: 0x090b1e, near: 14, far: 165, density: 0.0075, type: 'exp2' },

    sky: {
      type: 'grid',
      params: {
        top: 0x05060f, mid: 0x0b0d24, horizon: 0x1a1040, bottom: 0x02030a,
        horizonGlow: 0xff3fa8, glowPower: 5.5, glowStrength: 0.85,
        sunDir: [-0.62, 0.14, 0.42], sunColor: 0xff5fc0, sunSize: 0.0, sunIntensity: 0.0,
        starDensity: 0.22, starBrightness: 0.35, dither: 1.0,
        // read by engine.js readThemeLighting() for its own PMREM probe
        sunPower: 60, haze: 0.55, intensity: 1.00,
        gridColor: 0x22d3ee, gridY: -26, gridSpacing: 4.0, gridLine: 0.030,
        gridFade: 520, gridGlow: 0.60,
        scanColor: 0x9ffcff, scanSpeed: 0.085, scanWidth: 0.028,
        cityColor: 0x0e0824, cityGlow: 0xff3fa8, cityHeight: 0.26,
        cityDensity: 34.0, cityBand: 0.09,
      },
    },

    lights: {
      key: { color: 0xff3fa8, intensity: 2.35, dir: [-0.62, 0.30, 0.42] },
      fill: { color: 0x1fd0ff, intensity: 1.05, dir: [0.55, 0.62, -0.30] },
      rim: { color: 0x7ffcff, intensity: 2.60, dir: [0.10, 0.28, -0.94] },
      ambient: { color: 0x1b1f3c, intensity: 0.35 },
      hemi: { skyColor: 0x2a2f66, groundColor: 0x0a0a16, intensity: 0.55 },
    },

    grade: {
      lift: [0.008, 0.004, 0.030], gamma: [1.00, 1.00, 0.97], gain: [1.03, 1.00, 1.08],
      saturation: 1.18, vignette: 0.38, chroma: 0.0016,
      tint: 0x8fb8ff, tintRGB: [0.94, 0.97, 1.06],
    },
    bloom: { strength: 1.05, radius: 0.78, threshold: 0.60 },

    palette: {
      safe: 0x5d7f9c, safeEdge: 0xc9f7ff,
      kill: 0xff1f4e, killGlow: 0xff6f96,
      checkpoint: 0x2b4668, checkpointOn: 0x7dffc4,
      finish: 0xc9a6ff, accent: 0x22d3ee, deco: 0x241a4a,
    },

    particles: { type: 'mote', rate: 26, color: 0x7fe6ff, size: 0.055, drift: [0.06, 0.16, 0.02] },

    materialOverrides: {
      stone: { tint: 0x93a8cc, rough: 0.02 },
      panel: { tint: 0x9ec4f0 },
      metal: { tint: 0xb6cde8 },
      grate: { tint: 0x9fb4d0 },
      checker: { tint: 0xa8cbe8 },
      ice: { tint: 0xbfe6ff },
      glass: { tint: 0xbfe4ff },
      obsidian: { tint: 0xb0a8ff },
      crystal: { emissive: 0x22d3ee, attenuationColor: 0x1a6fa0 },
      neon: { emissive: 0x22d3ee, emissiveIntensity: 3.8 },
      emissive: { emissive: 0x22d3ee, emissiveIntensity: 3.0 },
      hazard: { emissive: 0xff2b5e, emissiveIntensity: 2.2 },
      conveyor: { emissive: 0x22d3ee },
      lava: { emissiveIntensity: 3.0 },
      rubber: { tint: 0xa8b0d0 },
      wood: { tint: 0x9fb0d8 },
      sand: { tint: 0xa8b6d8 },
      cloud: { tint: 0x9fbce0 },
    },

    heat: 0,   // -> Post.setHeat() via engine.setTheme()
    music: { key: 'A', scale: 'minor', bpm: 126, mood: 'driving synthwave' },
    effects: { heatShimmer: false, grain: 0.030, snowWind: 0 },
    shadow: { mapSize: 2048, extent: 40, bias: -0.00055, normalBias: 0.035 },
  },

  /* --------------------------------------------------------------- FOUNDRY */
  /* Near-black smoke. The LAVA is the fill: a saturated orange bounce coming
   * from BELOW (dir.y < 0) plus a hemisphere whose *ground* colour is molten
   * rock. The key is a cold blue-white furnace vent directly overhead, so the
   * two colours meet on every edge. Dense warm fog, rising embers, shimmer.  */
  foundry: {
    id: 'foundry',
    name: 'LAVA FOUNDRY',
    bg: 0x0a0605,
    exposure: 1.00,
    envIntensity: 0.70,

    fog: { color: 0x2a0f06, near: 8, far: 95, density: 0.0160, type: 'exp2' },

    sky: {
      type: 'ember',
      params: {
        top: 0x080503, mid: 0x140806, horizon: 0x40120a, bottom: 0x0a0403,
        horizonGlow: 0xff4a10, glowPower: 3.2, glowStrength: 0.85,
        smokeColor: 0x2e1c15, smokeDark: 0x070403,
        smokeScale: 2.4, smokeSpeed: 0.022, smokeWarp: 0.35, smokeContrast: 1.35,
        /* furnace 0.60 lit the ENTIRE below-horizon dome at full strength (the
         * shader's underside term saturates for any downward ray), which is
         * most of the frame in a stage of floating platforms — the place read
         * bright orange, not near-black smoke. Halved, the underside glow still
         * reads as the lava sea's bounce without owning the atmosphere. */
        glowColor: 0xff6a1a, glowHeight: 0.26, furnace: 0.30,
        emberGlow: 0xffa04a, dither: 1.0,
        sunDir: [0.24, 0.30, -0.94], sunColor: 0xff8a3c, sunSize: 0.0, sunIntensity: 0.0,
        starDensity: 0.0, starBrightness: 0.0,
        sunPower: 40, haze: 1.15, intensity: 0.85,
      },
    },

    lights: {
      key: { color: 0xcfe2ff, intensity: 2.05, dir: [0.24, 0.94, -0.24] },
      fill: { color: 0xff5a12, intensity: 1.85, dir: [0.08, -1.00, 0.16] },
      rim: { color: 0xffb060, intensity: 2.20, dir: [-0.58, 0.30, -0.76] },
      ambient: { color: 0x2a1409, intensity: 0.42 },
      hemi: { skyColor: 0x2b1a12, groundColor: 0xff4a0a, intensity: 0.85 },
    },

    grade: {
      lift: [0.020, 0.008, 0.002], gamma: [0.98, 1.00, 1.03], gain: [1.08, 1.00, 0.94],
      saturation: 1.10, vignette: 0.46, chroma: 0.0022,
      tint: 0xffb27a, tintRGB: [1.06, 0.96, 0.88],
    },
    /* strength 1.25 / threshold 0.52 was tuned against a near-black scene, but
     * the lava sea legitimately covers half the frame at luma 2..12: at that
     * threshold the WHOLE floor is bright-pass input and the frame floods white
     * (2026-08-31 forensics: bloom off took the frame from 60.8 % to 1.2 % pure
     * white). Threshold above the fogged-crust plateau, moderate strength: only
     * the vein cores, rims and bulbs bloom, which is the industrial look. */
    bloom: { strength: 0.55, radius: 0.62, threshold: 0.85 },

    palette: {
      safe: 0x8b94a4, safeEdge: 0xa8e6ff,
      kill: 0xff4a10, killGlow: 0xffb04a,
      checkpoint: 0x2f3a48, checkpointOn: 0x56ffd0,
      finish: 0xc9a6ff, accent: 0xffb44a, deco: 0x2a2320,
    },

    particles: { type: 'ember', rate: 60, color: 0xff8a2a, size: 0.070, drift: [0.05, 0.85, 0.03] },

    materialOverrides: {
      stone: { tint: 0xffb488, rough: 0.03 },
      panel: { tint: 0xe8c0a0 },
      metal: { tint: 0xffc9a0, rough: 0.05 },
      grate: { tint: 0xffbe94 },
      checker: { tint: 0xf0c4a0 },
      ice: { tint: 0xffd6b8, transmission: 0.20 },
      glass: { tint: 0xffd8bc },
      obsidian: { tint: 0xffa878 },
      crystal: { emissive: 0xff9a3c, attenuationColor: 0x8a2a00 },
      neon: { emissive: 0x9fe0ff, emissiveIntensity: 3.2 },
      emissive: { emissive: 0xffb44a, emissiveIntensity: 3.0 },
      hazard: { emissive: 0xff4a10, emissiveIntensity: 2.4 },
      conveyor: { emissive: 0xffb44a },
      lava: { emissiveIntensity: 4.0 },
      rubber: { tint: 0xe0b096 },
      wood: { tint: 0xffb890 },
      sand: { tint: 0xffc79c },
      cloud: { tint: 0xd8a888 },
    },

    heat: 0.55,   // -> Post.setHeat() via engine.setTheme()
    music: { key: 'D', scale: 'phrygian', bpm: 96, mood: 'industrial dread' },
    effects: { heatShimmer: true, heatStrength: 0.55, grain: 0.045, snowWind: 0 },
    shadow: { mapSize: 2048, extent: 36, bias: -0.00050, normalBias: 0.040 },
  },

  /* ----------------------------------------------------------------- SPIRE */
  /* High-altitude twilight. Pale cyan-white at the horizon (that pale band is
   * `bg` — it is what sits behind the stages, and what the contrast law is
   * measured against) deepening to a star-bearing blue-violet zenith. A high
   * cold key, a strong blue sky-fill, and a warm low sun rim that catches the
   * ice edges. Distance haze, falling snow, low bloom, high contrast.        */
  spire: {
    id: 'spire',
    name: 'FROZEN SPIRE',
    bg: 0xcfe2f2,
    /* 1.14 + 0.0090 fog painted the whole mid-distance solid white (measured
     * 6.9-10.7 % pure-white pixels; a platform 30 m out had no silhouette).
     * Bright-lit but never blown: exposure trimmed, fog thinned and a step
     * deeper than the 245-white cut so distance reads as pale blue, not paper. */
    exposure: 1.05,
    envIntensity: 1.20,

    fog: { color: 0xbfd6e9, near: 20, far: 260, density: 0.0055, type: 'exp2' },

    sky: {
      type: 'aurora',
      params: {
        /* horizon 0xe8f2fb was 4 counts from pure white before the glow, fog
         * and bloom even stacked — the measured 8-11 % blown band lived here.
         * One step deeper keeps the pale-band identity below the blowout line. */
        top: 0x2c4a86, mid: 0x7fa8d2, horizon: 0xd8e7f4, bottom: 0xc6daec,
        horizonGlow: 0xffd6a8, glowPower: 8.0, glowStrength: 0.38,
        /* the one blob still blowing out after the band fix was the sun itself:
         * disc + halo + fog scatter + bloom covered ~3 % of the frame. A low
         * winter sun should be a tight glint, not a searchlight. */
        sunDir: [-0.78, 0.10, -0.61], sunColor: 0xffd8a8, sunSize: 0.013, sunIntensity: 1.0,
        sunHalo: 0.10,
        auroraA: 0x4affc8, auroraB: 0x7f9cff,
        auroraSpeed: 0.055, auroraHeight: 0.34, auroraStrength: 0.55, auroraBands: 3.0,
        starDensity: 0.55, starBrightness: 0.28, dither: 1.0,
        sunPower: 90, haze: 0.85, intensity: 1.25,
      },
    },

    lights: {
      key: { color: 0xf2fbff, intensity: 2.60, dir: [0.28, 0.93, 0.24] },
      fill: { color: 0x7fb6ff, intensity: 1.30, dir: [-0.35, 0.55, -0.75] },
      rim: { color: 0xffcf9a, intensity: 2.10, dir: [-0.78, 0.10, -0.61] },
      ambient: { color: 0xbcd6ea, intensity: 0.62 },
      hemi: { skyColor: 0xd8ecff, groundColor: 0x6f8ea6, intensity: 0.95 },
    },

    grade: {
      lift: [-0.006, -0.004, 0.004], gamma: [1.02, 1.01, 0.99], gain: [0.98, 1.00, 1.05],
      saturation: 1.05, vignette: 0.30, chroma: 0.0009,
      tint: 0xdceffc, tintRGB: [0.97, 1.00, 1.05],
    },
    /* threshold 0.86 sat below the pale scene's own haze (~0.9-1.5 linear), so
     * bloom lifted the whole bright half of the frame over the white line
     * (measured: bloom off took 4.5 % blown pixels to 0.1 %). In a bright-key
     * theme only true HDR sources — sun, stripes, aurora — may bloom. */
    bloom: { strength: 0.35, radius: 0.60, threshold: 1.10 },

    palette: {
      safe: 0x2f4a5a, safeEdge: 0xffc94a,
      kill: 0xd6001c, killGlow: 0xff5a3c,
      checkpoint: 0x46606e, checkpointOn: 0x00e59c,
      finish: 0x6a3cd6, accent: 0x5ac8f0, deco: 0x8fb4cc,
    },

    particles: { type: 'snow', rate: 90, color: 0xeaf6ff, size: 0.045, drift: [0.35, -0.55, 0.10] },

    materialOverrides: {
      stone: { tint: 0xc8dcf0, rough: -0.04 },
      panel: { tint: 0xcfe4f8 },
      metal: { tint: 0xd8ecff, rough: -0.05 },
      grate: { tint: 0xc8dcf0 },
      checker: { tint: 0xcfe2f2 },
      ice: { tint: 0xffffff, transmission: 0.42, iridescence: 0.40 },
      glass: { tint: 0xe6f6ff },
      obsidian: { tint: 0xb8d0e8 },
      crystal: { emissive: 0x9fe8ff, attenuationColor: 0x2f74b0 },
      neon: { emissive: 0xffcf5c, emissiveIntensity: 3.2 },
      emissive: { emissive: 0x6fd8ff, emissiveIntensity: 2.6 },
      hazard: { emissive: 0xd6001c, emissiveIntensity: 2.4 },
      conveyor: { emissive: 0x6fd8ff },
      lava: { emissiveIntensity: 3.6 },
      rubber: { tint: 0xb0c4d8 },
      wood: { tint: 0xc0cfe0 },
      sand: { tint: 0xd8e6f2 },
      cloud: { tint: 0xf2fbff },
    },

    heat: 0,   // -> Post.setHeat() via engine.setTheme()
    music: { key: 'E', scale: 'aeolian', bpm: 84, mood: 'glacial ambient' },
    effects: { heatShimmer: false, grain: 0.020, snowWind: 0.35 },
    shadow: { mapSize: 2048, extent: 44, bias: -0.00060, normalBias: 0.030 },
  },

  /* ---------------------------------------------------------------- TEMPLE */
  /* Golden hour above a cloud sea. A low warm key from behind-left throws long
   * shadows down the colonnades; a big soft blue sky-fill keeps the shadow side
   * alive rather than black. Bright sun disc with a soft halo, thin haze,
   * drifting pollen. Gentlest grade of the five — nothing here should feel
   * processed.                                                               */
  temple: {
    id: 'temple',
    name: 'SKY TEMPLE',
    bg: 0x1d4472,
    /* exposure 1.10 + cream fog 0xd9c7a8 was half of the cream-on-cream washout
     * (the other half was bloom, see the bloom block). Golden hour, not cream:
     * slightly deeper amber fog, a touch thinner, neutral-plus exposure. */
    exposure: 1.04,
    envIntensity: 1.15,

    fog: { color: 0xccb28b, near: 30, far: 340, density: 0.0046, type: 'exp2' },

    sky: {
      type: 'cloudsea',
      params: {
        top: 0x14356a, mid: 0x2f6bb0, horizon: 0xf0cd9a, bottom: 0xd8bc94,
        horizonGlow: 0xffb85c, glowPower: 3.0, glowStrength: 1.00,
        sunDir: [-0.56, 0.19, 0.60], sunColor: 0xfff0cc, sunSize: 0.030,
        sunIntensity: 3.2, sunHalo: 0.55,
        cloudY: -62, cloudScale: 0.018, cloudSpeed: 0.010, cloudCoverage: 0.52,
        cloudLit: 0xfff2dc, cloudShadow: 0x8fa4c4, cloudFade: 700, cloudSharp: 2.2,
        starDensity: 0.0, starBrightness: 0.0, dither: 1.0,
        sunPower: 120, haze: 0.70, intensity: 1.15,
      },
    },

    lights: {
      key: { color: 0xffd08a, intensity: 3.10, dir: [-0.56, 0.40, 0.60] },
      fill: { color: 0x8fc0ff, intensity: 1.35, dir: [0.30, 0.86, -0.40] },
      rim: { color: 0xfff0d0, intensity: 1.50, dir: [0.72, 0.14, -0.68] },
      ambient: { color: 0xb79a72, intensity: 0.48 },
      hemi: { skyColor: 0x74a8e0, groundColor: 0xd8b98a, intensity: 1.00 },
    },

    grade: {
      lift: [0.010, 0.006, 0.000], gamma: [1.00, 1.00, 1.01], gain: [1.05, 1.01, 0.96],
      saturation: 1.08, vignette: 0.26, chroma: 0.0007,
      tint: 0xffe6bf, tintRGB: [1.04, 1.00, 0.93],
    },
    /* 0.75 @ 0.72 dissolved the whole golden scene into cream haze: the bright
     * fog band + near-white safeEdge trim sat above the threshold, so bloom +
     * fog + emissives merged into one wash (measured 30 % pure-white pixels;
     * bloom off alone recovered it to 0.1 %). Golden hour needs the SUN to
     * bloom, not the architecture. */
    bloom: { strength: 0.40, radius: 0.60, threshold: 0.88 },

    palette: {
      safe: 0xbfa273, safeEdge: 0xfff8e6,
      kill: 0xff1044, killGlow: 0xff5a7a,
      checkpoint: 0x6d5c46, checkpointOn: 0x18d69a,
      finish: 0xd9b6ff, accent: 0xffc35c, deco: 0xa88f66,
    },

    particles: { type: 'mote', rate: 34, color: 0xffe6b0, size: 0.050, drift: [0.10, 0.05, 0.06] },

    materialOverrides: {
      stone: { tint: 0xffe2b4, rough: -0.02 },
      panel: { tint: 0xf0d8ae },
      metal: { tint: 0xffdca8, rough: -0.06, metal: 0.03 },
      grate: { tint: 0xf0d0a0 },
      checker: { tint: 0xffe6c0 },
      ice: { tint: 0xdff0ff },
      glass: { tint: 0xfff0d8 },
      obsidian: { tint: 0xd8b890 },
      crystal: { emissive: 0xffd08a, attenuationColor: 0xb06a1a },
      neon: { emissive: 0xffe0a0, emissiveIntensity: 2.8 },
      emissive: { emissive: 0xffc35c, emissiveIntensity: 2.6 },
      hazard: { emissive: 0xff1044, emissiveIntensity: 2.2 },
      conveyor: { emissive: 0xffc35c },
      lava: { emissiveIntensity: 3.2 },
      rubber: { tint: 0xc8ac88 },
      wood: { tint: 0xffd8a8 },
      sand: { tint: 0xffe4b8 },
      cloud: { tint: 0xffffff },
    },

    heat: 0,   // -> Post.setHeat() via engine.setTheme()
    music: { key: 'C', scale: 'lydian', bpm: 72, mood: 'serene choral' },
    effects: { heatShimmer: false, grain: 0.018, snowWind: 0 },
    shadow: { mapSize: 2048, extent: 48, bias: -0.00065, normalBias: 0.028 },
  },

  /* ------------------------------------------------------------------- HUB */
  /* A calm neutral observatory. Balanced three-point light, a subtle
   * blue-violet fill, low fog, still air. Deliberately the least dramatic
   * theme: it is the room you stand in to choose where to go, so nothing in it
   * competes with the world portals.                                         */
  hub: {
    id: 'hub',
    name: 'OBSERVATORY',
    bg: 0x0e111a,
    exposure: 1.04,
    envIntensity: 1.00,

    fog: { color: 0x161c2a, near: 22, far: 220, density: 0.0060, type: 'exp2' },

    sky: {
      type: 'gradient',
      params: {
        top: 0x070912, mid: 0x101526, horizon: 0x1c2340, bottom: 0x05070c,
        horizonGlow: 0x7f6fd0, glowPower: 6.0, glowStrength: 0.45,
        sunDir: [0.40, 0.30, 0.35], sunColor: 0x9a7dff, sunSize: 0.0, sunIntensity: 0.0,
        starDensity: 0.42, starBrightness: 0.40, dither: 1.0,
        sunPower: 50, haze: 0.45, intensity: 0.95,
      },
    },

    lights: {
      key: { color: 0xdfe8ff, intensity: 1.75, dir: [0.40, 0.85, 0.35] },
      fill: { color: 0x8f7fd6, intensity: 0.85, dir: [-0.60, 0.40, -0.55] },
      rim: { color: 0x7fd8ff, intensity: 1.10, dir: [-0.10, 0.22, -0.97] },
      ambient: { color: 0x232a44, intensity: 0.48 },
      hemi: { skyColor: 0x2c3557, groundColor: 0x0b0d15, intensity: 0.65 },
    },

    grade: {
      lift: [0.004, 0.004, 0.012], gamma: [1.00, 1.00, 1.00], gain: [1.00, 1.00, 1.03],
      saturation: 1.04, vignette: 0.32, chroma: 0.0006,
      tint: 0xc9d4ff, tintRGB: [0.98, 0.99, 1.04],
    },
    bloom: { strength: 0.60, radius: 0.70, threshold: 0.70 },

    palette: {
      safe: 0x8e9cb5, safeEdge: 0xbfeaff,
      kill: 0xff2020, killGlow: 0xff6a4a,
      checkpoint: 0x39415a, checkpointOn: 0x6effc8,
      finish: 0xc9a6ff, accent: 0x9a7dff, deco: 0x2b3350,
    },

    particles: { type: 'mote', rate: 18, color: 0xa9b8ff, size: 0.045, drift: [0.02, 0.03, 0.02] },

    materialOverrides: {
      stone: { tint: 0xc4cee8 },
      panel: { tint: 0xc8d4f0 },
      metal: { tint: 0xd0dcf4 },
      grate: { tint: 0xbcc8e0 },
      checker: { tint: 0xc8d2e8 },
      ice: { tint: 0xdce8ff },
      glass: { tint: 0xe0ecff },
      obsidian: { tint: 0xb0a8e0 },
      crystal: { emissive: 0xb49aff, attenuationColor: 0x4a3a9a },
      neon: { emissive: 0x9a7dff, emissiveIntensity: 3.0 },
      emissive: { emissive: 0x9a7dff, emissiveIntensity: 2.4 },
      hazard: { emissive: 0xff2020, emissiveIntensity: 2.0 },
      conveyor: { emissive: 0x9a7dff },
      lava: { emissiveIntensity: 2.8 },
      rubber: { tint: 0xa8b0c8 },
      wood: { tint: 0xc0c4e0 },
      sand: { tint: 0xccd2e8 },
      cloud: { tint: 0xdfe8ff },
    },

    heat: 0,   // -> Post.setHeat() via engine.setTheme()
    music: { key: 'G', scale: 'dorian', bpm: 64, mood: 'calm observatory' },
    effects: { heatShimmer: false, grain: 0.022, snowWind: 0 },
    shadow: { mapSize: 2048, extent: 34, bias: -0.00050, normalBias: 0.032 },
  },
};

/** stable ordering for menus / stage select */
export const THEME_ORDER = ['hub', 'neon', 'foundry', 'spire', 'temple'];

/* ========================================================================== *
 * applyTheme                                                                 *
 * ========================================================================== */

/** one live rig per engine — swapping themes tears the old one down first */
const _rigs = new WeakMap();

/* hoisted scratch: applyTheme runs on stage load, but setShadowFocus runs
 * per-frame from game code, so nothing here may allocate. */
const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();

function placeLight(light, dir, distance, target) {
  _dir.set(dir[0], dir[1], dir[2]);
  if (_dir.lengthSq() < 1e-9) _dir.set(0, 1, 0);
  _dir.normalize();
  light.position.copy(target).addScaledVector(_dir, distance);
  light.target.position.copy(target);
  light.target.updateMatrixWorld();
  light.updateMatrixWorld();
}

function makeDirectional(spec, name) {
  const l = new THREE.DirectionalLight(spec.color, spec.intensity);
  l.name = 'asc.light.' + name;
  l.userData.ascRole = name;
  l.userData.ascDir = spec.dir;
  l.castShadow = false;
  return l;
}

/**
 * Build (or rebuild) the whole look of `engine` for `themeId`:
 * background + fog + tone-mapping exposure + post grade/bloom (via the engine
 * when it exposes setTheme, directly otherwise), the three-point light rig,
 * the sky dome, and a PMREM environment rendered FROM that sky so reflections
 * agree with what you can see.
 *
 * Returns the rig:
 *   {theme, group, key, fill, rim, ambient, hemi, sky, env,
 *    update(dt), setShadowFocus(x,y,z), dispose()}
 * The rig is also stored per-engine, so calling applyTheme again disposes it.
 */
export function applyTheme(engine, themeId, opts) {
  const def = THEMES[themeId] || THEMES[String(themeId)] || THEMES.hub;
  const wantSkyEnv = !!(opts && opts.skyEnvironment);
  if (!engine || !engine.scene) {
    console.warn('[themes] applyTheme called without an engine');
    return null;
  }
  const scene = engine.scene;
  const renderer = engine.renderer || null;

  const prev = _rigs.get(engine);
  if (prev) prev.dispose();

  /* ---- background / fog / exposure / post -------------------------------- */
  let engineHandled = false;
  if (typeof engine.setTheme === 'function') {
    try { engine.setTheme(def); engineHandled = true; }
    catch (e) { console.warn('[themes] engine.setTheme threw, applying directly', e); }
  }
  if (!engineHandled) {
    scene.background = new THREE.Color(def.bg);
    scene.fog = (def.fog.type === 'linear')
      ? new THREE.Fog(def.fog.color, def.fog.near, def.fog.far)
      : new THREE.FogExp2(def.fog.color, def.fog.density);
    if (renderer) renderer.toneMappingExposure = def.exposure;
    const post = engine.post;
    if (post) {
      if (typeof post.setGrade === 'function') post.setGrade(def.grade);
      if (typeof post.setBloom === 'function') post.setBloom(def.bloom);
    }
  }

  /* ---- light rig --------------------------------------------------------- */
  const group = new THREE.Group();
  group.name = 'asc.theme.' + def.id;
  group.frustumCulled = false;

  const focus = new THREE.Vector3(0, 0, 0);
  const sh = def.shadow || { mapSize: 2048, extent: 40, bias: -0.0006, normalBias: 0.03 };

  /* The quality preset owns the shadow map SIZE, not just the on/off switch.
   * Every theme here asks for 2048; engine.js was toggling
   * renderer.shadowMap.enabled from QUALITY[*].shadowMap while this rig went on
   * allocating and filling a 2048 map at every preset, so MEDIUM (preset: 1024)
   * was paying full price and LOW (preset: 0) still built the map. Take the
   * smaller of the two: HIGH and ULTRA are unchanged at 2048, so the shipped
   * look does not move; MEDIUM gets the 1024 it always asked for and LOW stops
   * rendering the shadow pass at all. Measured on Intel UHD, neon-1, post off:
   * 2048 -> 1024 is -1.0 ms/frame, and dropping the pass is -1.9 ms/frame. */
  const qShadow = (engine.quality && typeof engine.quality.shadowMap === 'number')
    ? engine.quality.shadowMap
    : null;
  const mapSize = (qShadow === null) ? sh.mapSize : Math.min(sh.mapSize, qShadow);

  const key = makeDirectional(def.lights.key, 'key');
  key.castShadow = mapSize > 0;
  if (key.castShadow) {
    key.shadow.mapSize.set(mapSize, mapSize);
    key.shadow.bias = sh.bias;
    key.shadow.normalBias = sh.normalBias;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = sh.extent * 4;
    key.shadow.camera.left = -sh.extent;
    key.shadow.camera.right = sh.extent;
    key.shadow.camera.top = sh.extent;
    key.shadow.camera.bottom = -sh.extent;
    key.shadow.camera.updateProjectionMatrix();
  }

  const fill = makeDirectional(def.lights.fill, 'fill');
  const rim = makeDirectional(def.lights.rim, 'rim');

  const ambient = new THREE.AmbientLight(def.lights.ambient.color, def.lights.ambient.intensity);
  ambient.name = 'asc.light.ambient';
  const hemi = new THREE.HemisphereLight(
    def.lights.hemi.skyColor, def.lights.hemi.groundColor, def.lights.hemi.intensity);
  hemi.name = 'asc.light.hemi';
  hemi.position.set(0, 60, 0);

  const keyDist = sh.extent * 2.2;
  placeLight(key, def.lights.key.dir, keyDist, focus);
  placeLight(fill, def.lights.fill.dir, 60, focus);
  placeLight(rim, def.lights.rim.dir, 70, focus);

  group.add(key, key.target, fill, fill.target, rim, rim.target, ambient, hemi);

  /* ---- sky --------------------------------------------------------------- */
  const sky = buildSky(def);
  group.add(sky);
  scene.add(group);

  /* ---- environment ------------------------------------------------------- *
   * Engine.setTheme() already bakes a PMREM probe (gradient + sun + three
   * emissive light cards) and owns scene.environment, so when the engine
   * handled the theme we leave the probe alone — two modules baking the same
   * slot is how you get a probe that flips on every context restore.
   *
   * We only render our own probe FROM THE ACTUAL SKY when either
   *   (a) there is no engine.setTheme to own it, or
   *   (b) the caller explicitly asks: applyTheme(engine, id, {skyEnvironment:true}),
   * which trades the light cards for true backdrop fidelity — the neon city
   * glow, the aurora and the cloud sea all show up in reflections.
   * ------------------------------------------------------------------------ */
  const prevEnv = scene.environment;
  let env = null;
  if (renderer && (!engineHandled || wantSkyEnv)) {
    env = buildEnvCubemap(renderer, def);
    if (env) {
      scene.environment = env;
      if (typeof scene.environmentIntensity === 'number') scene.environmentIntensity = def.envIntensity;
      if (engine.overlayScene) {
        engine.overlayScene.environment = env;
        if (typeof engine.overlayScene.environmentIntensity === 'number') {
          engine.overlayScene.environmentIntensity = def.envIntensity * 1.15;
        }
      }
    }
  }

  /* ---- rig --------------------------------------------------------------- */
  let disposed = false;
  const onFrame = (dt) => { if (!disposed) sky.update(dt); };

  const rig = {
    theme: def,
    themeId: def.id,
    group, key, fill, rim, ambient, hemi, sky, env, focus,

    /** advance the sky; wired to engine.onFrame when the engine offers it */
    update(dt) { if (!disposed) sky.update(dt); },

    /**
     * Slide the shadow frustum (and the whole light rig) to follow the player
     * down a long stage. Allocation-free — call it every frame if you like.
     */
    setShadowFocus(x, y, z) {
      if (disposed) return;
      _v.set(x, y, z);
      focus.copy(_v);
      placeLight(key, def.lights.key.dir, keyDist, focus);
      placeLight(fill, def.lights.fill.dir, 60, focus);
      placeLight(rim, def.lights.rim.dir, 70, focus);
      hemi.position.set(x, y + 60, z);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (typeof engine.offFrame === 'function') { try { engine.offFrame(onFrame); } catch (e) { /* not registered */ } }
      if (group.parent) group.parent.remove(group);
      sky.dispose();
      if (key.shadow && key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
      key.dispose(); fill.dispose(); rim.dispose();
      if (env) {
        // hand the slot back to whoever owned it before we took it
        if (scene.environment === env) scene.environment = prevEnv || null;
        if (engine.overlayScene && engine.overlayScene.environment === env) {
          engine.overlayScene.environment = prevEnv || null;
        }
        env.dispose();
      }
      if (_rigs.get(engine) === rig) _rigs.delete(engine);
    },
  };

  if (typeof engine.onFrame === 'function') {
    try { engine.onFrame(onFrame); } catch (e) { console.warn('[themes] engine.onFrame unavailable', e); }
  }

  _rigs.set(engine, rig);
  return rig;
}

/** the live rig for an engine, or null */
export function currentTheme(engine) {
  const r = _rigs.get(engine);
  return r ? r.theme : null;
}

export default THEMES;
