/**
 * CRESTBOUND — runtime/world/themes.js
 * CONTRACT §15.
 *
 * Five complete DIORAMAS: the Keep and the four realms. Each one is a
 * different *place*, not a hue shift — its own key-light direction and colour,
 * its own bounce, its own air, its own fog density, its own exposure, grade
 * and bloom curve, its own sky shader and its own music bed. Walking from the
 * Keep into VERDANT BAILEY should feel like stepping outdoors, and stepping
 * into EMBER FOUNDRY should feel like opening a furnace door.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DOES **NOT** DO (the Ascendant→Crestbound change)
 * ---------------------------------------------------------------------------
 * Ascendant's themes.js constructed a fresh DirectionalLight trio per theme.
 * A changed visible-light COUNT is a shader-permutation key, so that made
 * every course load a full material recompile. In CRESTBOUND the ENGINE owns
 * the rig (engine.js §6: `sun`, `fill`, `rim`, `hemi`, `ambient` are created
 * once and live forever) and `applyTheme()` simply hands the ThemeDef to
 * `engine.setTheme()`, which writes colours / intensities / directions into
 * the existing lights. This file then adds exactly ONE thing on top: the sky
 * dome (plus its optional cloud/sea plane), and it re-bakes the PMREM
 * environment FROM that dome so reflections agree with the backdrop.
 *
 * ---------------------------------------------------------------------------
 * LIGHT DIRECTION CONVENTION
 * ---------------------------------------------------------------------------
 * `lights.*.dir` is the unit vector FROM the scene TOWARD the light, i.e.
 *     light.position = normalize(dir) * distance;  light.target at the focus.
 * `dir[1] > 0` means the light is above you; `dir[1] < 0` means it shines UP
 * from below. EMBER is the only theme whose fill does that — its bounce comes
 * off the lava.
 *
 * ---------------------------------------------------------------------------
 * READABILITY LAW — CONTRACT §15
 * ---------------------------------------------------------------------------
 * The walked surface must hold >= 3.5:1 relative-luminance contrast against
 * the colour that is actually BEHIND a platform at eye level — which is the
 * FOG / horizon band, not the zenith `bg`.
 *
 * **THE ONLY ACCEPTED EVIDENCE IS `python _harness/contrastcheck.py`.**
 * That tool stands the hero at every checkpoint station of every course in
 * every theme, screenshots, samples the next walked top surface and the haze
 * band behind it, and prints per-station WCAG ratios. Nothing else counts:
 * the light rig, the exposure, the grade, the bloom and the sky dome all sit
 * between a hex constant in this file and the pixel a player sees, so
 * constant arithmetic CANNOT testify about the render. Ascendant shipped two
 * consecutive contrast tables in this same comment block that were pure
 * fiction for exactly that reason.
 *
 * What IS asserted here, and what it is worth:
 *   - the palettes below were CHOSEN so that `safe` and `safeEdge` sit on the
 *     opposite side of their theme's fog band by a wide margin in raw WCAG
 *     terms (roughly 3.8:1 – 13:1 by hex arithmetic). That is authoring
 *     INTENT, not a measurement, and it is the starting point contrastcheck
 *     then corrects. Any contrast number ever written into a comment in this
 *     file must be one that tool printed, or it is a lie waiting to be found.
 *   - each theme picks ONE side of the figure/ground pair and commits:
 *       keep    dark warm fog  -> BRIGHT stone decks
 *       verdant deep pine band -> BRIGHT sunlit stone decks
 *       ember   near-black smoke -> BRIGHT cold-steel decks
 *       rime    deep dusk blue -> PALE ice-stone decks
 *       azure   deep teal sea  -> PALE limestone decks
 *     Mixing the two (a mid deck against a mid band) is what produces the
 *     invisible-platform failure, and no amount of tint tweaking rescues it.
 *   - leading-edge stripes are flanked by near-black keylines (builders.js),
 *     so `safeEdge` reads as a DRAWN LINE on any deck value and under any
 *     bloom. That is why `safeEdge` may sit close to `safe` in luminance
 *     while still being unmistakable: the keyline, not the luminance step,
 *     carries the separation at the lip.
 *
 * Kill separation, enforced across all five themes so muscle memory
 * transfers: `kill` is always a saturated hot red/orange, always emissive and
 * always ANIMATED; it sits >= 45 deg of hue from `safe`, `safeEdge`,
 * `checkpointOn` and `crest` in every theme. EMBER is the one place whose
 * decor legitimately shares the hot band, so there the discriminator is
 * carried by emission and motion instead: hazards are the only orange things
 * that are self-lit AND moving, and every landable surface is cold steel
 * wearing a cyan lip.
 *
 * Red/green is never the ONLY cue (deuteranopia): kill animates, checkpoints
 * pulse and change SHAPE (ring + beam), and their luminances differ by >= 2:1.
 *
 * ---------------------------------------------------------------------------
 * ThemeDef shape (CONTRACT §15)
 * ---------------------------------------------------------------------------
 *   { id, name, realmName?, fog:{color, near, far, density, type},
 *     bg, exposure, envIntensity,
 *     sky:{type:'day'|'sunset'|'furnace'|'aurora'|'sanctum', params},
 *     lights:{key, fill, rim, ambient, hemi},
 *     grade:{lift, gamma, gain, saturation, vignette, chroma, tint},
 *     bloom:{strength, radius, threshold},
 *     palette:{safe, safeEdge, kill, killGlow, checkpoint, checkpointOn,
 *              crest, sigil, coin, accent, deco, water, pad, finish},
 *     particles:{color, ambient:[{preset, rate, color?}]},
 *     materialOverrides:{}, music:{key, scale, bpm, mood},
 *     timeOfDay, heat, effects, shadow }
 */

import * as THREE from 'three';
import { buildSky, buildEnvCubemap } from './sky.js';

/* ========================================================================== *
 * THEME DEFINITIONS                                                          *
 * ========================================================================== */

/** @type {Object<string, object>} */
export const THEMES = {

  /* ------------------------------------------------------------------ KEEP */
  /* THE KEEP — a warm stone hall at late afternoon. The whole room is lit by
   * three tall lancet windows down one wall: an AMBER key rakes in through
   * them at a low angle (so every column throws a long bar of light across the
   * floor and the god-ray planes from sky.js line up with it), a COOL BLUE
   * fill comes off the opposite wall's shadow, and a soft warm rim separates
   * the paintings from the plaster. The air is thick with dust motes turning
   * in the shafts. Through the windows you can see the SANCTUM sky — the same
   * sky as AZURE, because the Keep looks out over the same sea, which is the
   * one visual promise the hub makes about where you are going.
   *
   * Figure/ground: a DARK warm fog band (the depth of the hall) with BRIGHT
   * limestone decks in front of it.                                         */
  keep: {
    id: 'keep',
    name: 'THE KEEP',
    realmName: 'THE KEEP',
    timeOfDay: 'dusk',
    bg: 0x1a140e,
    exposure: 1.05,
    envIntensity: 0.85,

    /* Interior fog: short and warm. `near` is deliberately far enough out
     * that the room you stand in is crisp — the haze exists to give the far
     * end of the hall depth and to be the dark ground the decks read against. */
    fog: { color: 0x2a2118, near: 14, far: 150, density: 0.0125, type: 'exp2' },

    sky: {
      type: 'sanctum',
      params: {
        top: 0x1f4f86, mid: 0x4f8cbe, horizon: 0xdcd0b4, bottom: 0x6f7f86,
        horizonGlow: 0xffc98a, glowPower: 4.2, glowStrength: 0.75,
        sunDir: [-0.82, 0.22, 0.52], sunColor: 0xffe6bc,
        sunSize: 0.0026, sunIntensity: 2.4, sunHalo: 0.35,
        // the sanctum's signature: a faint rainbow arc + a ring of far islands
        rainbowStrength: 0.30, rainbowRadius: 0.42, rainbowWidth: 0.055,
        islandStrength: 0.75, islandCount: 22.0, islandHeight: 0.055,
        islandColor: 0x2d3a4a, islandGlow: 0xffc07a, islandBand: 0.02,
        ringStrength: 0.22, ringColor: 0xffe0b0,
        cloudStrength: 0.35, cloudScale: 1.5, cloudSpeed: 0.006, cloudCoverage: 0.40,
        starDensity: 0.0, starBrightness: 0.0, dither: 1.0,
        sunPower: 90, haze: 0.80, intensity: 0.85,
      },
    },

    lights: {
      // the window key: low, raking, warm — this IS the shafts
      key: { color: 0xffcf94, intensity: 2.65, dir: [-0.82, 0.42, 0.38] },
      // cool bounce off the shadowed wall, so nothing goes brown-on-brown
      fill: { color: 0x7096d6, intensity: 0.95, dir: [0.70, 0.46, -0.55] },
      // soft warm separation on the far edges of the paintings and pillars
      rim: { color: 0xffe0b8, intensity: 1.35, dir: [0.18, 0.30, -0.94] },
      ambient: { color: 0x3a2f26, intensity: 0.42 },
      hemi: { skyColor: 0x54463a, groundColor: 0x1a1410, intensity: 0.62 },
    },

    grade: {
      lift: [0.012, 0.007, 0.002], gamma: [0.99, 1.00, 1.02], gain: [1.05, 1.00, 0.95],
      saturation: 1.06, vignette: 0.34, chroma: 0.0009,
      tint: [1.03, 1.00, 0.96],
    },
    /* Threshold above the diffuse range: the shafts, the painting shimmer and
     * the crest pedestal bloom — the plaster does not. */
    bloom: { strength: 0.55, radius: 0.62, threshold: 1.02 },

    palette: {
      safe: 0xb9a888, safeEdge: 0xffdca0,
      kill: 0xff3a20, killGlow: 0xff8a5a,
      checkpoint: 0x4a3f34, checkpointOn: 0x7fe0ff,
      crest: 0xffcf4a, sigil: 0xc07bff, coin: 0xffe27a,
      accent: 0xffb45c, deco: 0x6a5a46, water: 0x3f8fb0,
      pad: 0xffb45c, finish: 0xc9a6ff,
    },

    particles: {
      color: 0xffe0b0,
      ambient: [
        { preset: 'mote', rate: 30, color: 0xffe6c0 },
        { preset: 'haze', rate: 6, color: 0xffd8a8 },
      ],
    },

    /* The Keep is stone, plaster, oak and gold leaf. Tints are close to
     * neutral because the raking amber key does the colouring — double-warming
     * a warm room is how you get one flat brown frame. */
    materialOverrides: {
      stone: { tint: 0xd8c8a8 },
      plaster: { tint: 0xf0e2c8 },
      brick: { tint: 0xd8b090 },
      marble: { tint: 0xf4efe4, clearcoatRoughness: 0.06 },
      wood: { tint: 0xc09056 },
      panel: { tint: 0xb0a184 },
      metal: { tint: 0xb8b0a0, metalness: 0.55, env: 0.55 },
      copper: { tint: 0xffc8a0, env: 0.85 },
      gold: { env: 1.25 },
      grate: { tint: 0xa89c88 },
      checker: { tint: 0xcabb9c },
      rope: { tint: 0xe0c89c },
      cloth: { tint: 0xc8d8e8 },
      moss: { tint: 0x9ab08a },
      glass: { tint: 0xffeacc },
      ice: { tint: 0xdceaf4 },
      crystal: { emissive: 0xffc07a, attenuationColor: 0x8a5a20 },
      neon: { emissive: 0xffc07a, emissiveIntensity: 1.9 },
      emissive: { emissive: 0xffb45c, emissiveIntensity: 2.3 },
      hazard: { emissive: 0xff3a20, emissiveIntensity: 2.0 },
      conveyor: { emissive: 0xffb45c },
      lava: { emissiveIntensity: 2.6 },
      painting: { emissiveIntensity: 1.15 },
      water: { shallow: 0x4f9fb8, deep: 0x123a4e, foam: 0xfff0d8, opacity: 0.82 },
      grass: { tint: 0xb8c890 },
      dirt: { tint: 0xd0b898 },
      sand: { tint: 0xe0cca8 },
      snow: { tint: 0xf0ecec },
      leaves: { tint: 0xb8c890 },
      bark: { tint: 0xc0a888 },
      cloud: { tint: 0xffe8cc },
      rubber: { tint: 0x9a9084 },
      obsidian: { tint: 0x6a5f52 },
    },

    heat: 0,
    music: { key: 'G', scale: 'ionian', bpm: 72, mood: 'explore' },
    effects: { heatShimmer: false, grain: 0.018, snowWind: 0, godRays: true },
    shadow: { mapSize: 2048, extent: 30, bias: -0.00050, normalBias: 0.030 },
  },

  /* --------------------------------------------------------------- VERDANT */
  /* VERDANT BAILEY — early morning over meadow and fortress. A warm, LOW sun
   * from behind-left throws long shadows down the hills and lights the grass
   * from behind, which is exactly what the grass material's subsurface rim
   * term is for. A big cool sky-fill keeps the shadow side alive. The air
   * carries a soft haze plus pollen and drifting leaves.
   *
   * Figure/ground: the fog band is the DEEP PINE SHADOW at the treeline, and
   * the sunlit stone decks are the bright side. (The far sky above that band
   * is bright blue — the band itself is the dark ridge under it, which is what
   * a platform at eye level is actually silhouetted against.)              */
  verdant: {
    id: 'verdant',
    name: 'VERDANT BAILEY',
    realmName: 'VERDANT BAILEY',
    timeOfDay: 'morning',
    bg: 0x5f9ad0,
    exposure: 1.06,
    envIntensity: 1.15,

    fog: { color: 0x3a6178, near: 26, far: 320, density: 0.0040, type: 'exp2' },

    sky: {
      type: 'day',
      params: {
        top: 0x1d5fae, mid: 0x4f92d8, horizon: 0xc4dcec, bottom: 0x5f7a70,
        horizonGlow: 0xffd8a0, glowPower: 5.5, glowStrength: 0.55,
        sunDir: [-0.62, 0.26, 0.74], sunColor: 0xfff0d0,
        sunSize: 0.0030, sunIntensity: 2.6, sunHalo: 0.40,
        // procedural cumulus layer baked into the dome (no extra mesh)
        cumulusStrength: 0.95, cumulusScale: 2.05, cumulusSpeed: 0.0125,
        cumulusCoverage: 0.46, cumulusSharp: 2.5, cumulusHeight: 0.16,
        cumulusLit: 0xfffaf0, cumulusShadow: 0x7f96b4,
        starDensity: 0.0, starBrightness: 0.0, dither: 1.0,
        sunPower: 110, haze: 0.65, intensity: 1.10,
      },
    },

    lights: {
      key: { color: 0xffe0b4, intensity: 3.05, dir: [-0.62, 0.44, 0.65] },
      fill: { color: 0x8fc0ff, intensity: 1.20, dir: [0.42, 0.82, -0.38] },
      rim: { color: 0xfff2d8, intensity: 1.55, dir: [0.66, 0.16, -0.74] },
      ambient: { color: 0x6f8a76, intensity: 0.40 },
      hemi: { skyColor: 0x86b6e8, groundColor: 0x3e5a34, intensity: 0.85 },
    },

    grade: {
      lift: [0.004, 0.006, 0.004], gamma: [1.00, 1.00, 1.00], gain: [1.02, 1.02, 0.99],
      saturation: 1.10, vignette: 0.24, chroma: 0.0007,
      tint: [1.01, 1.02, 0.99],
    },
    /* Morning is bright: only the sun, the crest gold and the trims may bloom.
     * A threshold under the lit-grass plateau turns the whole meadow into one
     * green wash. */
    bloom: { strength: 0.32, radius: 0.58, threshold: 1.12 },

    palette: {
      safe: 0xd8cfae, safeEdge: 0xfff0b4,
      kill: 0xff2a3c, killGlow: 0xff7a86,
      checkpoint: 0x4a5a4a, checkpointOn: 0x6fe8c8,
      crest: 0xffcf4a, sigil: 0xb46cff, coin: 0xffe27a,
      accent: 0x8fe05a, deco: 0x6f8a5a, water: 0x4fb0c8,
      pad: 0x8fe05a, finish: 0xc9a6ff,
    },

    particles: {
      color: 0xdff0b0,
      ambient: [
        { preset: 'pollen', rate: 26, color: 0xf4f0a8 },
        { preset: 'leaves', rate: 7, color: 0x9fc86a },
        { preset: 'mote', rate: 12, color: 0xdff0c8 },
      ],
    },

    /* The walked STONE is sun-bleached limestone — the bright half of the
     * figure/ground pair. The living surfaces (grass, leaves, moss) keep their
     * own colour; they are the world, not the platforms. Reflective decks give
     * up most of their env mirror, which under a 3.05 key was re-painting
     * every walked top with the pale sky regardless of tint. */
    materialOverrides: {
      stone: { tint: 0xe8dcbc },
      plaster: { tint: 0xf4ecd8 },
      brick: { tint: 0xe0b494 },
      panel: { tint: 0xd4c8a8 },
      metal: { tint: 0xc8c4b0, metalness: 0.30, env: 0.30 },
      grate: { tint: 0xbcb49c },
      checker: { tint: 0xdcd0b0 },
      wood: { tint: 0xd8a868 },
      bark: { tint: 0xb09878 },
      leaves: { tint: 0xa8d878 },
      grass: { tint: 0xc8e89a },
      dirt: { tint: 0xc8a884 },
      moss: { tint: 0x9fd88a },
      rope: { tint: 0xe8d0a4 },
      cloth: { tint: 0xc8dcec },
      marble: { tint: 0xf0f0e8 },
      gold: { env: 1.30 },
      copper: { tint: 0xd8c0a8 },
      sand: { tint: 0xe8d8b0 },
      snow: { tint: 0xf4f8ff },
      ice: { tint: 0xdcf0ff, transmission: 0.20, env: 0.25 },
      glass: { tint: 0xe8f4ff, env: 0.35 },
      obsidian: { tint: 0x5a6058, env: 0.30, clearcoat: 0.30, clearcoatRoughness: 0.42 },
      crystal: { emissive: 0x8fe0ff, attenuationColor: 0x2f7ab0 },
      neon: { emissive: 0x8fe05a, emissiveIntensity: 2.1 },
      emissive: { emissive: 0x8fe05a, emissiveIntensity: 2.2 },
      hazard: { emissive: 0xff2a3c, emissiveIntensity: 2.4 },
      conveyor: { emissive: 0x8fe05a },
      lava: { emissiveIntensity: 3.0 },
      water: { shallow: 0x5fd0c8, deep: 0x0d4258, foam: 0xf4ffff, opacity: 0.80, depthFade: 3.4 },
      cloud: { tint: 0xffffff },
      rubber: { tint: 0xa8a898 },
      painting: { emissiveIntensity: 0.85 },
    },

    heat: 0,
    music: { key: 'D', scale: 'lydian', bpm: 96, mood: 'explore' },
    effects: { heatShimmer: false, grain: 0.016, snowWind: 0, windStrength: 0.35 },
    shadow: { mapSize: 2048, extent: 46, bias: -0.00060, normalBias: 0.030 },
  },

  /* ----------------------------------------------------------------- EMBER */
  /* EMBER FOUNDRY — inside a working furnace. The LAVA is the fill: a
   * saturated red-orange bounce coming from BELOW (dir.y < 0) plus a
   * hemisphere whose GROUND colour is molten rock, so every underside and
   * every chin is lit from the floor. The key is a cold blue-white vent
   * directly overhead, so the two colours meet on every edge — that hot/cold
   * collision is the whole look, and it is also the readability system: every
   * landable surface here is COLD steel wearing a cyan lip, and the only
   * orange things are self-lit AND moving.
   *
   * Figure/ground: near-black smoke band, BRIGHT cold decks.               */
  ember: {
    id: 'ember',
    name: 'EMBER FOUNDRY',
    realmName: 'EMBER FOUNDRY',
    timeOfDay: 'furnace',
    bg: 0x120705,
    exposure: 1.00,
    envIntensity: 0.70,

    /* Thin enough that EVERY LANDING IS VISIBLE FROM ITS TAKE-OFF: a platform
     * 30 m out must still silhouette against the molten sea. */
    fog: { color: 0x2a100a, near: 10, far: 110, density: 0.0090, type: 'exp2' },

    sky: {
      type: 'furnace',
      params: {
        top: 0x080503, mid: 0x160907, horizon: 0x461409, bottom: 0x0c0403,
        horizonGlow: 0xff4a10, glowPower: 5.0, glowStrength: 0.60,
        smokeColor: 0x3a231b, smokeDark: 0x060302,
        smokeScale: 2.4, smokeSpeed: 0.022, smokeWarp: 0.35, smokeContrast: 1.85,
        glowColor: 0xff6a1a, glowHeight: 0.26, furnace: 0.26,
        seaStrength: 0.80, seaScale: 5.0, seaSpeed: 0.010,
        emberGlow: 0xffa04a, sparkStrength: 0.55,
        sunDir: [0.24, 0.30, -0.94], sunColor: 0xff8a3c, sunSize: 0.0, sunIntensity: 0.0,
        starDensity: 0.0, starBrightness: 0.0, dither: 1.0,
        sunPower: 40, haze: 1.15, intensity: 0.85,
      },
    },

    lights: {
      key: { color: 0xcfe2ff, intensity: 2.15, dir: [0.22, 0.95, -0.22] },
      // THE LAVA — a bounce light from under the floor
      fill: { color: 0xff5a12, intensity: 1.95, dir: [0.08, -1.00, 0.16] },
      rim: { color: 0xffb060, intensity: 2.25, dir: [-0.58, 0.28, -0.76] },
      ambient: { color: 0x2e1509, intensity: 0.40 },
      hemi: { skyColor: 0x2b1a12, groundColor: 0xff4a0a, intensity: 0.90 },
    },

    grade: {
      lift: [0.020, 0.008, 0.002], gamma: [0.98, 1.00, 1.03], gain: [1.08, 1.00, 0.94],
      saturation: 1.14, vignette: 0.46, chroma: 0.0024,
      // gentle warm push, eased on blue so the cyan lips survive the grade
      tint: [1.04, 0.99, 0.95],
    },
    /* Threshold well ABOVE the fogged lava plateau. The sea legitimately fills
     * half the frame at a luma the bright-pass would otherwise integrate into
     * an additive veil that no walked albedo can read through; only the vein
     * cores, the rims and the true emitters may bloom. */
    bloom: { strength: 0.55, radius: 0.62, threshold: 2.60 },

    palette: {
      safe: 0x93a7b8, safeEdge: 0x8ff0ff,
      kill: 0xff4a10, killGlow: 0xffb04a,
      checkpoint: 0x2f3a48, checkpointOn: 0x6fe0ff,
      crest: 0xffd04a, sigil: 0xb46cff, coin: 0xffe27a,
      accent: 0xffb44a, deco: 0x2a2320, water: 0x3a6f80,
      // pad deliberately does NOT follow accent: an amber self-lit pulsing pad
      // sits 20 deg from kill and would read as a hazard.
      pad: 0x9fe0ff, finish: 0xc9a6ff,
    },

    particles: {
      color: 0xff8a2a,
      ambient: [
        { preset: 'ember', rate: 55, color: 0xff8a2e },
        { preset: 'spark', rate: 12, color: 0xffc46a },
        { preset: 'haze', rate: 8, color: 0x6a3a24 },
      ],
    },

    /* CHARCOAL STEEL, not warm near-white. Under a 2.15 white key plus a 2.25
     * warm rim, a "neutral steel" tint renders cream and dissolves into the
     * molten haze. Here the haze band is the BRIGHT side, so the decks read by
     * silhouetting against it — and the reflective ones give up their
     * grazing-angle env mirror, which was repainting every tile top with the
     * fogged sea regardless of albedo. */
    materialOverrides: {
      stone: { tint: 0x8a94a0 },
      panel: { tint: 0x8892a0 },
      metal: { tint: 0x98a4b0, metalness: 0.22, env: 0.18 },
      grate: { tint: 0x8c98a4, metalness: 0.18, env: 0.15 },
      checker: { tint: 0x9aa4b0 },
      brick: { tint: 0x7a5a4c },
      plaster: { tint: 0x9a8f80 },
      marble: { tint: 0xa8aab0, clearcoat: 0.35, clearcoatRoughness: 0.35 },
      rubber: { tint: 0x6a707a },
      wood: { tint: 0x6a5240 },
      bark: { tint: 0x584434 },
      copper: { tint: 0xffb890, env: 0.55 },
      gold: { env: 1.05 },
      rope: { tint: 0x8a7458 },
      cloth: { tint: 0x9fb4c4 },
      obsidian: { tint: 0x2e2a28, env: 0.14, clearcoat: 0.18,
                  clearcoatRoughness: 0.58, specularIntensity: 0.12 },
      ice: { tint: 0xffd6b8, transmission: 0.18, env: 0.20 },
      glass: { tint: 0xffd8bc, env: 0.35 },
      crystal: { emissive: 0xff9a3c, attenuationColor: 0x8a2a00 },
      neon: { emissive: 0x9fe0ff, emissiveIntensity: 1.9 },
      emissive: { emissive: 0xffb44a, emissiveIntensity: 3.0 },
      hazard: { emissive: 0xff4a10, emissiveIntensity: 2.5 },
      // clamped to where the hue survives ACES: orange that glows and moves
      // must stay ORANGE, not clip to cream.
      conveyor: { emissive: 0xff9a3c, emissiveIntensity: 0.9 },
      lava: { emissiveIntensity: 2.5 },
      sand: { tint: 0x8a8070 },
      dirt: { tint: 0x6a5244 },
      grass: { tint: 0x6a7050 },
      moss: { tint: 0x5a6a50 },
      leaves: { tint: 0x7a7a50 },
      snow: { tint: 0xd8c8bc },
      cloud: { tint: 0xd8a888 },
      water: { shallow: 0x4a8a98, deep: 0x0a2630, foam: 0xffd8b8, opacity: 0.88 },
      painting: { emissiveIntensity: 1.0 },
    },

    heat: 0.38,
    music: { key: 'D', scale: 'phrygian', bpm: 104, mood: 'danger' },
    effects: { heatShimmer: true, heatStrength: 0.38, grain: 0.042, snowWind: 0 },
    shadow: { mapSize: 2048, extent: 38, bias: -0.00050, normalBias: 0.040 },
  },

  /* ------------------------------------------------------------------ RIME */
  /* RIME SPIRE — a mountain at dusk under an aurora. A COLD, high key
   * (blue-white, almost lunar), a PINK rim from the last of the sun on the far
   * ridge, dense low fog and constant snowfall. High contrast between the
   * pale ice-stone the course is cut from and the deep blue air behind it.
   *
   * Figure/ground: deep dusk-blue band, PALE ice-stone decks.              */
  rime: {
    id: 'rime',
    name: 'RIME SPIRE',
    realmName: 'RIME SPIRE',
    timeOfDay: 'dusk',
    bg: 0x15243c,
    exposure: 1.04,
    envIntensity: 1.05,

    /* Dense — this is the theme where you cannot see the whole mountain — but
     * still thin enough that the next three landings silhouette. */
    fog: { color: 0x28374f, near: 16, far: 190, density: 0.0072, type: 'exp2' },

    sky: {
      type: 'aurora',
      params: {
        top: 0x0d1a34, mid: 0x1e3560, horizon: 0x4a6084, bottom: 0x1a2436,
        horizonGlow: 0xff9fb4, glowPower: 6.5, glowStrength: 0.55,
        sunDir: [0.76, 0.06, -0.64], sunColor: 0xffb0c0,
        sunSize: 0.0022, sunIntensity: 1.5, sunHalo: 0.28,
        auroraA: 0x4affc8, auroraB: 0x7f9cff,
        auroraSpeed: 0.055, auroraHeight: 0.42, auroraStrength: 0.85, auroraBands: 3.0,
        starDensity: 0.70, starBrightness: 0.60, dither: 1.0,
        sunPower: 70, haze: 0.75, intensity: 0.95,
      },
    },

    lights: {
      key: { color: 0xcfe4ff, intensity: 2.35, dir: [0.24, 0.90, 0.36] },
      fill: { color: 0x5f88c8, intensity: 1.05, dir: [-0.40, 0.48, -0.78] },
      // the last pink light on the ridge — the one warm thing in the theme
      rim: { color: 0xffa8c0, intensity: 2.05, dir: [0.76, 0.10, -0.64] },
      ambient: { color: 0x2c3d55, intensity: 0.44 },
      hemi: { skyColor: 0x486a96, groundColor: 0x9fb0c4, intensity: 0.72 },
    },

    grade: {
      lift: [-0.004, -0.002, 0.006], gamma: [1.02, 1.01, 0.99], gain: [0.99, 1.00, 1.06],
      saturation: 1.06, vignette: 0.34, chroma: 0.0011,
      tint: [0.98, 1.00, 1.05],
    },
    /* The snow is legitimately bright; a threshold under it turns the whole
     * mountain into a white wash. Only the aurora, the sun and the trims. */
    bloom: { strength: 0.40, radius: 0.60, threshold: 1.14 },

    palette: {
      safe: 0x7c93a8, safeEdge: 0xffe9a8,
      kill: 0xff2040, killGlow: 0xff7a90,
      checkpoint: 0x39516a, checkpointOn: 0x7fe2ff,
      crest: 0xffd04a, sigil: 0xc07bff, coin: 0xffe27a,
      accent: 0x5ac8f0, deco: 0x8fa8c0, water: 0x4a9fc8,
      pad: 0x5ac8f0, finish: 0xc9a6ff,
    },

    particles: {
      color: 0xeaf6ff,
      ambient: [
        { preset: 'snow', rate: 85, color: 0xeaf6ff },
        { preset: 'aurora', rate: 4, color: 0x6fffd0 },
        { preset: 'mote', rate: 10, color: 0xcfe4ff },
      ],
    },

    /* Walked ice/stone stays PALE (the bright half against the deep blue air),
     * but the reflective family gives up transmission and most of its env
     * mirror: a full-gloss walked ice slab draws a sun-glint streak down its
     * own middle and mirrors the sky at grazing incidence, which is how an
     * "obviously bright" deck still measures 1.2:1. The frost sparkle and the
     * fracture normals carry the ice read instead. */
    materialOverrides: {
      stone: { tint: 0xc0d0e0 },
      panel: { tint: 0xb8c8da },
      metal: { tint: 0xc0ccdc, metalness: 0.22, env: 0.20 },
      grate: { tint: 0xb0bece },
      checker: { tint: 0xc4d2e2 },
      snow: { tint: 0xffffff },
      ice: { tint: 0xa8ccdf, transmission: 0.06, iridescence: 0.24, env: 0.12,
             clearcoat: 0.22, clearcoatRoughness: 0.48, specularIntensity: 0.18 },
      glass: { tint: 0xb8d4e8, transmission: 0.10, env: 0.14,
               clearcoat: 0.18, clearcoatRoughness: 0.50, specularIntensity: 0.16 },
      marble: { tint: 0xdce8f4 },
      plaster: { tint: 0xd0dae4 },
      brick: { tint: 0x9a8a88 },
      wood: { tint: 0x8a7a70 },
      bark: { tint: 0x6a6058 },
      leaves: { tint: 0x7a9a88 },
      grass: { tint: 0x8aa89a },
      moss: { tint: 0x7a9a86 },
      dirt: { tint: 0x8a8480 },
      sand: { tint: 0xa8aab0 },
      rope: { tint: 0xbcae94 },
      cloth: { tint: 0xc4d8ec },
      copper: { tint: 0xc4d0cc, env: 0.65 },
      gold: { env: 1.15 },
      obsidian: { tint: 0x4a5a68 },
      rubber: { tint: 0x8a94a0 },
      crystal: { emissive: 0x9fe8ff, attenuationColor: 0x2f74b0 },
      neon: { emissive: 0x7fe2ff, emissiveIntensity: 2.3 },
      emissive: { emissive: 0x5ac8f0, emissiveIntensity: 2.3 },
      hazard: { emissive: 0xff2040, emissiveIntensity: 2.5 },
      conveyor: { emissive: 0x7fe2ff },
      lava: { emissiveIntensity: 3.4 },
      water: { shallow: 0x64c8dc, deep: 0x0a2c46, foam: 0xf4feff, opacity: 0.84,
               ripple: 0.40, crestFoam: 0.70 },
      cloud: { tint: 0xe8f2ff },
      painting: { emissiveIntensity: 1.1 },
    },

    heat: 0,
    music: { key: 'E', scale: 'aeolian', bpm: 84, mood: 'explore' },
    effects: { heatShimmer: false, grain: 0.020, snowWind: 0.45 },
    shadow: { mapSize: 2048, extent: 44, bias: -0.00060, normalBias: 0.032 },
  },

  /* ----------------------------------------------------------------- AZURE */
  /* AZURE SANCTUM — noon over an open sea. The brightest, cleanest theme: a
   * near-overhead white-gold sun, a strong CYAN BOUNCE off the water into
   * every underside (the hemisphere's ground colour is the sea, which is the
   * cheapest way to make floating architecture look like it is actually over
   * water), thin air, spray and motes. The sky is the SANCTUM dome: a faint
   * rainbow arc and a ring of floating-island silhouettes on the horizon — the
   * same sky the Keep's windows look out on, which is the payoff of that
   * promise.
   *
   * Figure/ground: deep teal sea band, PALE limestone decks.               */
  azure: {
    id: 'azure',
    name: 'AZURE SANCTUM',
    realmName: 'AZURE SANCTUM',
    timeOfDay: 'noon',
    bg: 0x2a7fb4,
    exposure: 1.03,
    envIntensity: 1.25,

    fog: { color: 0x1b4d61, near: 34, far: 380, density: 0.0034, type: 'exp2' },

    sky: {
      type: 'sanctum',
      params: {
        top: 0x1a5fa8, mid: 0x3f92d4, horizon: 0xbfe4ee, bottom: 0x1b5c74,
        horizonGlow: 0xa8f0ff, glowPower: 5.0, glowStrength: 0.60,
        sunDir: [0.18, 0.92, -0.35], sunColor: 0xfffaf0,
        sunSize: 0.0026, sunIntensity: 3.0, sunHalo: 0.45,
        rainbowStrength: 0.55, rainbowRadius: 0.46, rainbowWidth: 0.070,
        islandStrength: 1.0, islandCount: 26.0, islandHeight: 0.070,
        islandColor: 0x24506a, islandGlow: 0x9fe8ff, islandBand: 0.024,
        ringStrength: 0.42, ringColor: 0xbfeaff,
        cloudStrength: 0.55, cloudScale: 1.8, cloudSpeed: 0.009, cloudCoverage: 0.34,
        starDensity: 0.0, starBrightness: 0.0, dither: 1.0,
        sunPower: 140, haze: 0.55, intensity: 1.20,
      },
    },

    lights: {
      key: { color: 0xfff4dc, intensity: 3.20, dir: [0.18, 0.94, -0.30] },
      // the sea bounce: strong, cyan, from low and to the side
      fill: { color: 0x5fd8e8, intensity: 1.45, dir: [-0.55, 0.12, 0.82] },
      rim: { color: 0xdff6ff, intensity: 1.60, dir: [-0.22, 0.24, -0.95] },
      ambient: { color: 0x5f96a8, intensity: 0.44 },
      hemi: { skyColor: 0x8fd0f0, groundColor: 0x2f9fb8, intensity: 0.95 },
    },

    grade: {
      lift: [0.000, 0.004, 0.008], gamma: [1.00, 1.00, 1.00], gain: [1.00, 1.02, 1.04],
      saturation: 1.12, vignette: 0.22, chroma: 0.0006,
      tint: [0.99, 1.01, 1.04],
    },
    /* Noon over water is the brightest scene in the game. Threshold above the
     * lit-limestone plateau AND above the sea's own specular field, or the
     * bright-pass integrates the whole sea into an additive veil. */
    bloom: { strength: 0.34, radius: 0.56, threshold: 1.30 },

    palette: {
      safe: 0xb8a67e, safeEdge: 0xffd166,
      kill: 0xff2a4a, killGlow: 0xff7a92,
      checkpoint: 0x3f6274, checkpointOn: 0x7fffd8,
      crest: 0xffcf4a, sigil: 0xc07bff, coin: 0xffe27a,
      accent: 0x3fe0d8, deco: 0x8fb8c8, water: 0x3fd2c8,
      pad: 0x3fe0d8, finish: 0xc9a6ff,
    },

    particles: {
      color: 0xc8f4ff,
      ambient: [
        { preset: 'spray', rate: 22, color: 0xd8fbff },
        { preset: 'mote', rate: 16, color: 0xdff6ff },
        { preset: 'haze', rate: 5, color: 0xa8dcec },
      ],
    },

    /* Warm sand-limestone decks under a cold sky: the warm/cool split IS the
     * separation, and it survives the grade because the grade's blue push is
     * gentle. Reflective decks cut their env hard — at noon over water, a
     * grazing-incidence mirror repaints every walked top with the sky. */
    materialOverrides: {
      stone: { tint: 0xe4d0a8 },
      sand: { tint: 0xf0dcb0 },
      plaster: { tint: 0xf4e8cc },
      marble: { tint: 0xf8f4ea, clearcoat: 0.70, clearcoatRoughness: 0.10 },
      brick: { tint: 0xe0b08c },
      panel: { tint: 0xd4c4a0 },
      metal: { tint: 0xc8c8bc, metalness: 0.28, env: 0.26 },
      grate: { tint: 0xbcbcb0 },
      checker: { tint: 0xdcd0b4 },
      wood: { tint: 0xd0a070 },
      bark: { tint: 0xb09880 },
      leaves: { tint: 0x9fd8a8 },
      grass: { tint: 0xb4e0b0 },
      moss: { tint: 0x8fd0b0 },
      dirt: { tint: 0xd0b490 },
      rope: { tint: 0xe8d4a8 },
      cloth: { tint: 0xb8e4ec },
      copper: { tint: 0xa8e0d0, env: 0.85 },
      gold: { env: 1.45 },
      ice: { tint: 0xd8f4ff, transmission: 0.22, env: 0.22 },
      glass: { tint: 0xdcf6ff, env: 0.40 },
      obsidian: { tint: 0x4a5a5a, env: 0.20, clearcoat: 0.30, clearcoatRoughness: 0.40 },
      crystal: { emissive: 0x7ffde8, attenuationColor: 0x1f8a9a },
      neon: { emissive: 0x3fe0d8, emissiveIntensity: 2.2 },
      emissive: { emissive: 0x3fe0d8, emissiveIntensity: 2.3 },
      hazard: { emissive: 0xff2a4a, emissiveIntensity: 2.5 },
      conveyor: { emissive: 0x3fe0d8 },
      lava: { emissiveIntensity: 3.2 },
      snow: { tint: 0xf4fbff },
      rubber: { tint: 0xa0a49c },
      cloud: { tint: 0xffffff },
      water: { shallow: 0x4fe4d4, deep: 0x063a56, foam: 0xf4ffff,
               opacity: 0.80, depthFade: 6.0, shoreWidth: 1.8, crestFoam: 0.65 },
      painting: { emissiveIntensity: 0.9 },
    },

    heat: 0,
    music: { key: 'A', scale: 'mixolydian', bpm: 88, mood: 'explore' },
    effects: { heatShimmer: false, grain: 0.014, snowWind: 0, windStrength: 0.25 },
    shadow: { mapSize: 2048, extent: 50, bias: -0.00065, normalBias: 0.028 },
  },
};

/** stable ordering for menus / realm select (the Keep first — it is the hub) */
export const THEME_ORDER = ['keep', 'verdant', 'ember', 'rime', 'azure'];

/** theme id -> realm id (the Keep is its own thing and maps to null) */
export const THEME_REALM = {
  keep: null, verdant: 'verdant', ember: 'ember', rime: 'rime', azure: 'azure',
};

/* ========================================================================== *
 * applyTheme                                                                 *
 * ========================================================================== */

/** one live rig per engine — swapping themes tears the old one down first */
const _rigs = new WeakMap();

/** hoisted scratch: the rig's per-frame path must not allocate */
const _camW = new THREE.Vector3();

/**
 * Look a ThemeDef up by id, tolerating a ThemeDef being passed straight in.
 * @param {string|object} idOrDef
 * @returns {object} a ThemeDef (never null — falls back to the Keep)
 */
export function themeDef(idOrDef) {
  if (idOrDef && typeof idOrDef === 'object' && idOrDef.id) return idOrDef;
  const id = String(idOrDef);
  return THEMES[id] || THEMES.keep;
}

/**
 * Build (or rebuild) the whole look of `engine` for `themeId`.
 *
 * Order matters:
 *  1. tear down the previous rig (its sky mesh, its env texture),
 *  2. `engine.setTheme(def)` — background, fog, exposure, post grade + bloom,
 *     the FIXED light rig's colours/intensities/directions, the shadow
 *     frustum, and the engine's own fallback PMREM probe,
 *  3. add the sky dome (`sky.js`) — one mesh, plus at most one ground plane,
 *  4. replace the environment with a probe rendered FROM that dome, so a
 *     polished crest reflects the actual sky it is standing under rather than
 *     a generic studio card. Pass `{skyEnvironment:false}` to keep the
 *     engine's probe (cheaper; used by the harnesses that measure load time).
 *
 * The returned rig is stored per-engine and is also what `currentTheme()`
 * reads.
 *
 * @param {object} engine
 * @param {string} themeId
 * @param {object} [opts] {skyEnvironment:boolean, envSize:number}
 * @returns {object|null} {theme, themeId, group, sky, env, update(dt), dispose()}
 */
export function applyTheme(engine, themeId, opts) {
  const def = themeDef(themeId);
  const wantSkyEnv = !(opts && opts.skyEnvironment === false);

  if (!engine || !engine.scene) {
    console.warn('[themes] applyTheme called without an engine');
    return null;
  }
  const scene = engine.scene;
  const renderer = engine.renderer || null;

  const prev = _rigs.get(engine);
  if (prev) prev.dispose();

  /* ---- 2. everything the engine owns ------------------------------------ */
  let engineHandled = false;
  if (typeof engine.setTheme === 'function') {
    try { engine.setTheme(def); engineHandled = true; }
    catch (e) { console.warn('[themes] engine.setTheme threw, applying what we can directly', e); }
  }
  if (!engineHandled) {
    // Minimal fallback so a stripped engine (or a unit test) still gets a look.
    scene.background = new THREE.Color(def.bg);
    scene.fog = (def.fog && def.fog.type === 'linear')
      ? new THREE.Fog(def.fog.color, def.fog.near, def.fog.far)
      : new THREE.FogExp2(def.fog ? def.fog.color : 0x000000, def.fog ? def.fog.density : 0.01);
    if (renderer) renderer.toneMappingExposure = def.exposure || 1;
    const post = engine.post;
    if (post) {
      if (typeof post.setGrade === 'function') post.setGrade(def.grade || {});
      if (typeof post.setBloom === 'function') post.setBloom(def.bloom || {});
      if (typeof post.setHeat === 'function') post.setHeat(def.heat || 0, true);
    }
  }

  /* ---- 3. the sky ------------------------------------------------------- */
  const group = new THREE.Group();
  group.name = 'cb.theme.' + def.id;
  group.frustumCulled = false;
  group.matrixAutoUpdate = false;      // it never moves; the dome self-places

  const sky = buildSky(def);
  group.add(sky);
  scene.add(group);

  /* ---- 4. the environment ---------------------------------------------- */
  const prevEnv = scene.environment;
  let env = null;
  if (renderer && wantSkyEnv) {
    env = buildEnvCubemap(renderer, def, (opts && opts.envSize) || 128);
    if (env) {
      scene.environment = env;
      if (typeof scene.environmentIntensity === 'number') {
        scene.environmentIntensity = (typeof def.envIntensity === 'number') ? def.envIntensity : 1;
      }
    }
  }

  /* ---- the rig ---------------------------------------------------------- */
  let disposed = false;

  /* The sky dome re-centres itself on the camera in onBeforeRender, so the
   * only per-frame work here is advancing its clock. The SHADOW focus is the
   * engine's job (`engine.followShadow(playerPos)` from game.js) — this file
   * deliberately does not touch it, because the hero, not the camera, is what
   * the frustum must track in a third-person game. */
  const onFrame = (dt) => {
    if (disposed) return;
    sky.update(dt);
  };

  const rig = {
    theme: def,
    themeId: def.id,
    group,
    sky,
    env,

    /** advance the sky (also wired to engine.onFrame when the engine has it) */
    update(dt) { if (!disposed) sky.update(dt); },

    /**
     * Re-point the sky's sun without rebuilding anything — for a course that
     * wants a slightly different hour than its realm's default.
     * @param {number} x @param {number} y @param {number} z
     */
    setSunDir(x, y, z) {
      if (disposed) return;
      if (typeof sky.setSunDir === 'function') sky.setSunDir(x, y, z);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (typeof engine.offFrame === 'function') {
        try { engine.offFrame(onFrame); } catch (e) { /* was never registered */ }
      }
      if (group.parent) group.parent.remove(group);
      sky.dispose();
      if (env) {
        // hand the slot back to whoever owned it before we took it
        if (scene.environment === env) scene.environment = prevEnv || null;
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

/** the live ThemeDef for an engine, or null */
export function currentTheme(engine) {
  const r = _rigs.get(engine);
  return r ? r.theme : null;
}

/** the live rig for an engine, or null (sky, env, update, dispose) */
export function currentRig(engine) {
  return _rigs.get(engine) || null;
}

/**
 * Read a palette colour for a theme with a guaranteed fallback — every UI and
 * builder path that wants a tint should come through here rather than
 * indexing `THEMES[x].palette.y` and crashing on a typo.
 * @param {string|object} idOrDef
 * @param {string} key  'safe'|'safeEdge'|'kill'|…
 * @param {number} [fallback]
 * @returns {number} hex
 */
export function paletteColor(idOrDef, key, fallback) {
  const d = themeDef(idOrDef);
  const p = d && d.palette;
  const v = p ? p[key] : undefined;
  return (typeof v === 'number') ? v : (typeof fallback === 'number' ? fallback : 0xffffff);
}

export default THEMES;
