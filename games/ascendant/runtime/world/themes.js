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
 * READABILITY LAW  (CONTRACT section 9) — measured on what the renderer SHOWS
 * ---------------------------------------------------------------------------
 * The law: the WALKED SURFACE (the materialOverride tints the decks actually
 * wear — palette.safe declares the same colour) must hold >= 3.5:1 relative-
 * luminance contrast against the colour that is actually BEHIND a platform at
 * eye level, which is the FOG/horizon band, not the zenith `bg`. A previous
 * version of this table was computed on palette.safe (which no shipped surface
 * wore) against `bg` (which is never behind a platform at eye level) — it
 * claimed 5.92:1 for spire while the frames measured 1.07:1. Numbers below are
 * raw WCAG contrast of the shipped tints; the shot battery (_shots/*.png) is
 * the ground truth they are re-checked against.
 *
 *   theme     stone vs fog   panel vs fog   edge vs keyline   cpOn vs cpOff
 *   neon         8.08:1         10.77:1         16.9:1            6.91:1
 *   foundry     10.38:1         10.67:1         14.3:1            7.57:1
 *   spire        4.40:1          4.60:1         12.7:1            4.50:1
 *   temple       3.69:1          3.95:1         18.4:1            4.41:1
 *   hub         10.81:1         11.46:1         15.2:1            6.08:1
 *
 * "edge vs keyline": every leading-edge stripe is flanked by 0.03 m near-black
 * keylines (builders.js) so the stripe reads as a drawn line on ANY deck value
 * and under any bloom — edge-vs-deck alone was 1.2-2.1:1 in the bright-deck
 * themes and unfixable there without dimming the stripes themselves.
 * Temple trades away zenith contrast (dark deck vs dark sky ~1.3:1) for the
 * eye-level read; its undersides carry the accent spine line for the look-up.
 *
 * Kill separation. Every `kill` is saturation >= 0.87 in the 330-40 deg hot
 * band, and is >= 45 deg of hue from `safe`, `safeEdge`, `checkpointOn` and
 * `finish` in every theme:
 *   neon 347deg  foundry 15deg  spire 352deg  temple 347deg  hub 0deg
 * Foundry is the one theme whose *decor* shares the hot band — the whole place
 * is orange — so there the discriminator is carried by emission and motion
 * instead: hazards are the only orange things that are self-lit AND animated,
 * and every landable surface there is cold steel wearing a cyan edge stripe.
 * ENFORCED, not assumed: builders.js remaps any stage-authored landable glow
 * that sits in the kill hue band (or reads as checkpointOn off a checkpoint)
 * to the theme accent — data cannot ship a red pad you must stand on.
 *
 * Cross-theme constants, so muscle memory transfers between worlds:
 *   kill          = hot red/orange, always emissive, always moving
 *   checkpointOn  = that WORLD's bright pad identity (round 2, 2026-08-31:
 *                   the old universal mint rendered one identical pad in all
 *                   five worlds — the critic's "universal mint pad". The armed
 *                   signal is now the SHAPE language: ring + glyph + beam +
 *                   pulse, wearing the world's colour; hue stays >= 45 deg
 *                   from that theme's kill and cpOn-vs-cpOff >= 4.4:1)
 *   pad           = the jump/speed-pad family identity (foundry cyan-on-steel,
 *                   neon cyan, spire ice blue, temple gold, hub violet);
 *                   builders.js reads it for pads so no world defaults to mint
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
        /* The backdrop grid must never share the landable identity. 0x22d3ee
         * was palette.accent verbatim — the same family as every platform
         * stripe — and at gridGlow 0.60 the lower half of every frame read as
         * a crisp landable floor (players died steering for it mid-fall).
         * Magenta is the neon HORIZON identity (horizonGlow/cityGlow), used by
         * nothing landable in any theme; dimmed so it reads as atmosphere. */
        gridColor: 0xff3fa8, gridY: -26, gridSpacing: 4.0, gridLine: 0.030,
        gridFade: 520, gridGlow: 0.22,
        scanColor: 0xff9fd6, scanSpeed: 0.085, scanWidth: 0.028,
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
      /* tint is the value post.js actually multiplies by (colorRatio). The old
       * hex 0x8fb8ff decoded to x[0.56,0.72,1.00] — a heavy blue filter nobody
       * intended; the gentle push lived in a `tintRGB` field nothing read.
       * (2026-08-31 critic pass, all five themes.) */
      tint: [0.94, 0.97, 1.06],
    },
    /* 1.05 @ 0.60 flooded the near field: the start pad's trim (emissive ~2.4+
     * linear) filled the bottom third of the frame with one blown cyan wash and
     * swallowed the gloves (neon-1_0/1_2, plain_neon-1_high). Threshold above
     * diffuse range so only true emitters bloom; strength down to a halo, not
     * a fog. The trim itself also came down (materialOverrides.neon). */
    bloom: { strength: 0.70, radius: 0.62, threshold: 0.95 },

    palette: {
      safe: 0x5d7f9c, safeEdge: 0xc9f7ff,
      kill: 0xff1f4e, killGlow: 0xff6f96,
      /* checkpointOn was the universal mint 0x7dffc4 — identical in all five
       * worlds (round-2 critic). Neon's armed pads are now turquoise-cyan, the
       * world's own family; 6.91:1 vs off, 175 deg from kill. */
      checkpoint: 0x2b4668, checkpointOn: 0x4df2dc,
      finish: 0xc9a6ff, accent: 0x22d3ee, deco: 0x241a4a,
      pad: 0x22d3ee,
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
      /* 3.8/3.0 under the old 0.60-threshold bloom was the near-field flood;
       * 2.5/2.3 still clears the 0.95 threshold, so strips glow with a halo
       * instead of erasing the bottom of the frame. */
      neon: { emissive: 0x22d3ee, emissiveIntensity: 2.5 },
      emissive: { emissive: 0x22d3ee, emissiveIntensity: 2.3 },
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

    /* density 0.0160 hid the far lip of a 3 m gap from its own take-off point
     * (house rule: EVERY LANDING IS VISIBLE FROM ITS TAKE-OFF). Thinned until
     * the next platform silhouettes from CP0; the near haze band still reads.
     * Round 2: 0.0125 still merged everything past the current deck into one
     * orange wall in the re-shots (foundry-1_1 showed zero course geometry
     * ahead) — 0.0095 keeps a platform at 30 m under 8 % fogged so the next
     * three jumps silhouette against the molten sea; the readability owner's
     * contrast work sits on top of this floor. */
    fog: { color: 0x2a0f06, near: 8, far: 95, density: 0.0095, type: 'exp2' },

    sky: {
      type: 'ember',
      params: {
        top: 0x080503, mid: 0x140806, horizon: 0x40120a, bottom: 0x0a0403,
        /* glowPower 3.2 / strength 0.85 spread the horizon band over most of
         * the dome; summed with the furnace term it read as one featureless
         * orange gradient and the smoke churn never survived it (foundry-1_0,
         * 2026-08-31 critic pass). Narrower and dimmer: the horizon burns, the
         * upper dome stays near-black churning smoke. */
        horizonGlow: 0xff4a10, glowPower: 5.0, glowStrength: 0.60,
        smokeColor: 0x36211a, smokeDark: 0x060302,
        smokeScale: 2.4, smokeSpeed: 0.022, smokeWarp: 0.35, smokeContrast: 1.85,
        /* furnace 0.60 lit the ENTIRE below-horizon dome at full strength (the
         * shader's underside term saturates for any downward ray), which is
         * most of the frame in a stage of floating platforms — the place read
         * bright orange, not near-black smoke. Halved, the underside glow still
         * reads as the lava sea's bounce without owning the atmosphere. */
        glowColor: 0xff6a1a, glowHeight: 0.26, furnace: 0.24,
        /* the lava SEA itself: dark crust plates threaded by glowing channels
         * on the below-horizon dome (sky.js FRAG_EMBER) — looking down or out
         * now shows molten ground instead of a blank gradient. */
        /* round 2: at 1.0 the sea's bright band behind the course was the wall
         * the thinner fog now has to read against — 0.8 keeps the molten floor
         * alive while giving mid-course silhouettes a darker backdrop. */
        seaStrength: 0.8, seaScale: 5.0, seaSpeed: 0.010,
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
      /* the old hex tint 0xffb27a decoded to x[1.00,0.70,0.48] — a heavy orange
       * filter that yellowed the cyan edge stripes (the theme's own hot/cold
       * discriminator) and re-warmed the already-orange world. The gentle warm
       * push the tintRGB note documented is now what actually applies, eased
       * further on blue so cyan survives the grade. */
      tint: [1.04, 0.99, 0.95],
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
      /* was mint 0x56ffd0 (round-2 critic: same pad in every world). Icy cyan
       * enforces this theme's own law — every landable identity is COLD; only
       * hazards are orange + self-lit + moving. 7.57:1 vs off, 178 deg from
       * kill. `pad` deliberately does NOT follow accent (amber sits 20 deg
       * from kill — an amber self-lit pulsing pad would read as a hazard). */
      checkpoint: 0x2f3a48, checkpointOn: 0x6fe0ff,
      finish: 0xc9a6ff, accent: 0xffb44a, deco: 0x2a2320,
      pad: 0x9fe0ff,
    },

    particles: { type: 'ember', rate: 60, color: 0xff8a2a, size: 0.070, drift: [0.05, 0.85, 0.03] },

    /* The walked materials were warm near-white multipliers (0xffb488 steel!)
     * on top of an orange key/fill/hemi rig — the fire was being counted twice,
     * and every deck lip blew out to a yellow-white blob at grazing angles.
     * The theme's own doctrine is "cold steel wearing a cyan edge stripe": the
     * tints below are neutral steel (palette.safe 0x8b94a4 family) and the
     * LIGHTS do all the warming. */
    materialOverrides: {
      stone: { tint: 0x9098a4, rough: 0.03 },
      panel: { tint: 0x8a94a2 },
      /* mirror-metal at grazing angle reflected the 2.05 white furnace key
       * straight into bloom — tread fields and pad tops (hazMat 'metal') read
       * as one blown slab. `rough` deltas are no-ops here (base scalar is
       * already 1.0; the maps carry the value), so the specular is tamed the
       * only way this material allows: absolute metalness + env cut. */
      metal: { tint: 0x9aa6b4, metalness: 0.40, env: 0.55 },
      grate: { tint: 0x8791a0, metalness: 0.45, env: 0.60 },
      checker: { tint: 0x939ca8 },
      ice: { tint: 0xffd6b8, transmission: 0.20 },
      glass: { tint: 0xffd8bc },
      obsidian: { tint: 0x554c48 },
      crystal: { emissive: 0xff9a3c, attenuationColor: 0x8a2a00 },
      neon: { emissive: 0x9fe0ff, emissiveIntensity: 3.2 },
      emissive: { emissive: 0xffb44a, emissiveIntensity: 3.0 },
      hazard: { emissive: 0xff4a10, emissiveIntensity: 2.4 },
      /* Both mechanic surfaces were losing their hue to ACES clipping: the belt
       * rendered as a featureless yellow-white slab (its chevrons invisible at
       * 9 m) and the lava rendered cream. Emission clamped to where the hue
       * survives tone-mapping; "orange that glows and moves" stays orange. */
      conveyor: { emissive: 0xff9a3c, emissiveIntensity: 0.8 },
      lava: { emissiveIntensity: 2.4 },
      rubber: { tint: 0x6e6c74 },
      wood: { tint: 0x8a7a6a },
      sand: { tint: 0x9a927e },
      cloud: { tint: 0xd8a888 },
    },

    heat: 0.55,   // -> Post.setHeat() via engine.setTheme()
    music: { key: 'D', scale: 'phrygian', bpm: 96, mood: 'industrial dread' },
    /* heatStrength 0.55 smeared the 20-40 m band the thinner fog just opened
     * up — the shimmer was un-drawing the silhouettes the fog change bought
     * (round 2). 0.38 keeps the furnace air without erasing the course. */
    effects: { heatShimmer: true, heatStrength: 0.38, grain: 0.045, snowWind: 0 },
    shadow: { mapSize: 2048, extent: 36, bias: -0.00050, normalBias: 0.040 },
  },

  /* ----------------------------------------------------------------- SPIRE */
  /* High-altitude twilight. Pale cyan-white at the horizon (that pale band is
   * what sits behind the stages at eye level — the contrast law is measured
   * against the fog colour, and the COURSE is dark glacial slate so it can
   * hold 3.5:1 against that pale air) deepening to a star-bearing blue-violet
   * zenith. A high cold key, a strong blue sky-fill, and a warm low sun rim
   * that catches the ice edges. Distance haze, falling snow, low bloom.      */
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

    /* 0.0055 still dissolved the 40-90 m course into the pale band even after
     * the surfaces went dark; a touch thinner keeps the next three landings
     * silhouetted while the far spire still fades into altitude haze. */
    fog: { color: 0xbfd6e9, near: 20, far: 260, density: 0.0044, type: 'exp2' },

    sky: {
      type: 'aurora',
      params: {
        /* horizon 0xe8f2fb was 4 counts from pure white before the glow, fog
         * and bloom even stacked — the measured 8-11 % blown band lived here.
         * One step deeper keeps the pale-band identity below the blowout line. */
        /* mid/bottom deepened one stop: the dome was a near-white field from
         * 15 deg up, so the aurora and stars were invisible in every capture
         * and any bright patch went straight over the bloom threshold (the
         * unexplained left-edge blowout was an aurora fold over the pale mid
         * band, bloomed — 2026-08-31 toggle probe: bloom off removed it). */
        top: 0x243e74, mid: 0x5f88b8, horizon: 0xc8dcec, bottom: 0xa8c2d8,
        horizonGlow: 0xffd6a8, glowPower: 8.0, glowStrength: 0.38,
        /* sunIntensity 1.0 with a 0.013 disc sat BELOW the 1.10 bloom threshold
         * — a paper sticker, no glare (spire-1_0). But 0.014 @ 2.6 was the
         * round-2 REJECT: acos(1-0.014) is a ~10 deg disc, and at 2.6x every
         * pixel of it fed bloom — the sun rendered as a blown white BALL at
         * the horizon (sunprobe 2026-08-31, sun faced: 1.074 % pure-white
         * pixels; uSunIntensity=0 -> 0.092 %, so the sun IS the source; bloom
         * off -> 0.132 %, so the flood is disc x bloom). 0.0022 is a ~3.8 deg
         * disc: a compact winter sun whose core alone crosses the 1.10
         * threshold for a tight glint + soft halo, never a frame flood. */
        sunDir: [-0.78, 0.10, -0.61], sunColor: 0xffd8a8, sunSize: 0.0022, sunIntensity: 1.8,
        sunHalo: 0.30,
        auroraA: 0x4affc8, auroraB: 0x7f9cff,
        /* ribbons lifted into the dark zenith band where they can actually
         * read; over the pale mid band they were a white smear + bloom blob. */
        auroraSpeed: 0.055, auroraHeight: 0.50, auroraStrength: 0.70, auroraBands: 3.0,
        starDensity: 0.55, starBrightness: 0.50, dither: 1.0,
        sunPower: 90, haze: 0.85, intensity: 1.10,
      },
    },

    lights: {
      key: { color: 0xf2fbff, intensity: 2.60, dir: [0.28, 0.93, 0.24] },
      fill: { color: 0x7fb6ff, intensity: 1.15, dir: [-0.35, 0.55, -0.75] },
      rim: { color: 0xffcf9a, intensity: 2.10, dir: [-0.78, 0.10, -0.61] },
      /* ambient+hemi trimmed so the key's shadows survive the fill instead of
       * being flat-lit away (shadow-visibility pass, 2026-08-31). */
      ambient: { color: 0xbcd6ea, intensity: 0.50 },
      hemi: { skyColor: 0xd8ecff, groundColor: 0x6f8ea6, intensity: 0.80 },
    },

    grade: {
      lift: [-0.006, -0.004, 0.004], gamma: [1.02, 1.01, 0.99], gain: [0.98, 1.00, 1.05],
      saturation: 1.05, vignette: 0.30, chroma: 0.0009,
      /* hex 0xdceffc decoded to x[0.86,0.94,0.99] — an unintended darkening
       * filter; the documented gentle cool push now actually applies. */
      tint: [0.97, 1.00, 1.05],
    },
    /* threshold 0.86 sat below the pale scene's own haze (~0.9-1.5 linear), so
     * bloom lifted the whole bright half of the frame over the white line
     * (measured: bloom off took 4.5 % blown pixels to 0.1 %). In a bright-key
     * theme only true HDR sources — sun, stripes, aurora — may bloom. */
    bloom: { strength: 0.35, radius: 0.60, threshold: 1.10 },

    palette: {
      safe: 0x466074, safeEdge: 0xffc94a,
      kill: 0xd6001c, killGlow: 0xff5a3c,
      /* was emerald 0x00e59c (round-2 critic: universal mint pad). Spire's
       * armed pads are now ice blue — the world identity. 4.50:1 vs off,
       * 158 deg from kill. */
      checkpoint: 0x46606e, checkpointOn: 0x7fe2ff,
      finish: 0x6a3cd6, accent: 0x5ac8f0, deco: 0x8fb4cc,
      pad: 0x5ac8f0,
    },

    particles: { type: 'snow', rate: 90, color: 0xeaf6ff, size: 0.045, drift: [0.35, -0.55, 0.10] },

    /* The walked materials were 0xc8dcf0..0xffffff — white streaks in white fog
     * (screenshot-measured 1.07-1.50:1 against the fog band; the course past
     * the current platform's far edge was literally invisible). Frozen Spire's
     * course is now dark glacial slate under pale air: figure dark, ground
     * bright. Tints below clear 3.8:1+ raw against fog 0xbfd6e9; palette.safe
     * declares the same slate the stone actually renders. Decorative ice stays
     * pale — the course is the dark thing with the gold edge. */
    materialOverrides: {
      stone: { tint: 0x466074, rough: -0.04 },
      panel: { tint: 0x435d72 },
      metal: { tint: 0x4c6a82, rough: -0.05 },
      grate: { tint: 0x3c5265 },
      checker: { tint: 0x445e72 },
      /* env 0.35: clearcoat ice mirroring a white sky was re-whitening itself
       * no matter how dark the tint went — the shelf measured 1.08:1 vs fog. */
      ice: { tint: 0x47708c, transmission: 0.16, iridescence: 0.40, env: 0.35 },
      glass: { tint: 0xe6f6ff },
      obsidian: { tint: 0x3a4e60 },
      crystal: { emissive: 0x9fe8ff, attenuationColor: 0x2f74b0 },
      neon: { emissive: 0xffcf5c, emissiveIntensity: 3.2 },
      emissive: { emissive: 0x6fd8ff, emissiveIntensity: 2.6 },
      hazard: { emissive: 0xd6001c, emissiveIntensity: 2.4 },
      conveyor: { emissive: 0x6fd8ff },
      lava: { emissiveIntensity: 3.6 },
      rubber: { tint: 0x6c8496 },
      wood: { tint: 0x465c6c },
      sand: { tint: 0x4a6478 },
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

    fog: { color: 0xc2a67b, near: 30, far: 340, density: 0.0042, type: 'exp2' },

    sky: {
      type: 'cloudsea',
      params: {
        /* horizon/bottom deepened from 0xf0cd9a/0xd8bc94: the band read as one
         * dead cream stripe; amber keeps golden-hour and leaves headroom for
         * the sun to own the top of the range. */
        top: 0x14356a, mid: 0x2f6bb0, horizon: 0xe4ba82, bottom: 0xc6a578,
        horizonGlow: 0xffb85c, glowPower: 3.0, glowStrength: 1.00,
        sunDir: [-0.56, 0.19, 0.60], sunColor: 0xfff0cc, sunSize: 0.030,
        sunIntensity: 3.2, sunHalo: 0.55,
        /* deeper shadow tone + more coverage + longer fade: the cloud sea was
         * invisible under the fog band (temple-1_0) — lit tops against a
         * genuinely darker floor is what makes the plane read at distance. */
        cloudY: -62, cloudScale: 0.018, cloudSpeed: 0.010, cloudCoverage: 0.60,
        cloudLit: 0xfff2dc, cloudShadow: 0x74889f, cloudFade: 950, cloudSharp: 2.2,
        starDensity: 0.0, starBrightness: 0.0, dither: 1.0,
        sunPower: 120, haze: 0.70, intensity: 1.15,
      },
    },

    lights: {
      key: { color: 0xffd08a, intensity: 3.10, dir: [-0.56, 0.40, 0.60] },
      fill: { color: 0x8fc0ff, intensity: 1.20, dir: [0.30, 0.86, -0.40] },
      rim: { color: 0xfff0d0, intensity: 1.50, dir: [0.72, 0.14, -0.68] },
      /* ambient+hemi trimmed: at 0.48/1.00 the fill floor sat so high the low
       * key's long colonnade shadows read as barely-darker paint. */
      ambient: { color: 0xb79a72, intensity: 0.40 },
      hemi: { skyColor: 0x74a8e0, groundColor: 0xd8b98a, intensity: 0.82 },
    },

    grade: {
      lift: [0.010, 0.006, 0.000], gamma: [1.00, 1.00, 1.01], gain: [1.05, 1.01, 0.96],
      saturation: 1.08, vignette: 0.26, chroma: 0.0007,
      /* hex 0xffe6bf decoded to x[1.00,0.90,0.75] — a QUARTER of the blue
       * removed, which is most of why every hue in the frame converged to the
       * same cream. The gentle golden push now applies, with more blue kept. */
      tint: [1.03, 1.00, 0.96],
    },
    /* 0.75 @ 0.72 dissolved the whole golden scene into cream haze: the bright
     * fog band + near-white safeEdge trim sat above the threshold, so bloom +
     * fog + emissives merged into one wash (measured 30 % pure-white pixels;
     * bloom off alone recovered it to 0.1 %). Golden hour needs the SUN to
     * bloom, not the architecture. */
    bloom: { strength: 0.36, radius: 0.60, threshold: 0.95 },

    palette: {
      /* safeEdge was 0xfff8e6 — the trim, the sign strip, the fog band and the
       * sun halo were all the same near-white, so nothing anchored a highlight
       * hierarchy. Deep gold trim: the SUN is now the only white thing in the
       * frame, trim reads gold, fog reads amber. */
      safe: 0x665134, safeEdge: 0xffd98c,
      kill: 0xff1044, killGlow: 0xff5a7a,
      /* was emerald 0x18d69a (round-2 critic: universal mint pad). Temple's
       * armed pads are now bright gold — the world identity. 4.41:1 vs off,
       * 53 deg of hue from kill (the closest pair of the five, so the shape
       * language — pulse, ring, beam — carries extra weight here). */
      checkpoint: 0x6d5c46, checkpointOn: 0xffcf70,
      finish: 0xd9b6ff, accent: 0xffc35c, deco: 0xa88f66,
      pad: 0xffc35c,
    },

    particles: { type: 'mote', rate: 34, color: 0xffe6b0, size: 0.050, drift: [0.10, 0.05, 0.06] },

    /* Sand platforms, sand fog, sand decor — one colour, three meanings
     * (screenshot-measured 1.38-1.68:1 platform-vs-fog). The course is now
     * deep bronzed stone under the cream air: every walked tint clears 3.6:1+
     * raw against fog 0xccb28b, ivory edges and gold trim burn on top of it,
     * and decor keeps the pale palette.deco so it recedes into the haze
     * instead of impersonating a deck. palette.safe = the rendered stone. */
    materialOverrides: {
      stone: { tint: 0x665134, rough: -0.02 },
      panel: { tint: 0x5c4e3c },
      metal: { tint: 0x66502f, rough: -0.06, metal: 0.03 },
      grate: { tint: 0x54462f },
      checker: { tint: 0x63533a },
      ice: { tint: 0xdff0ff },
      glass: { tint: 0xfff0d8 },
      obsidian: { tint: 0x4a3d2e },
      crystal: { emissive: 0xffd08a, attenuationColor: 0xb06a1a },
      neon: { emissive: 0xffe0a0, emissiveIntensity: 2.8 },
      emissive: { emissive: 0xffc35c, emissiveIntensity: 2.6 },
      hazard: { emissive: 0xff1044, emissiveIntensity: 2.2 },
      conveyor: { emissive: 0xffc35c },
      lava: { emissiveIntensity: 3.2 },
      rubber: { tint: 0x6a5840 },
      wood: { tint: 0x655031 },
      sand: { tint: 0x615033 },
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
      /* hex 0xc9d4ff decoded to x[0.79,0.83,1.00] — a heavy blue filter; the
       * documented gentle push now applies. */
      tint: [0.98, 0.99, 1.04],
    },
    /* 0.60 @ 0.70 turned the launch-pad ring into a solid white parallelogram
     * with zero internal gradient (hub_0/hub_1). Threshold above the diffuse
     * range: the ring keeps its violet gradient and blooms only at its core. */
    bloom: { strength: 0.50, radius: 0.65, threshold: 0.92 },

    palette: {
      safe: 0x8e9cb5, safeEdge: 0xbfeaff,
      kill: 0xff2020, killGlow: 0xff6a4a,
      /* was mint 0x6effc8 (round-2 critic: universal mint pad). The hub's
       * armed pads are now observatory blue; 6.08:1 vs off, 155 deg from
       * kill. `pad` follows the violet accent. */
      checkpoint: 0x39415a, checkpointOn: 0x8fd0ff,
      finish: 0xc9a6ff, accent: 0x9a7dff, deco: 0x2b3350,
      pad: 0x9a7dff,
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
      /* the hub's primary dressing read as unlit purple blobs (hub_0): give the
       * cores real internal light and let the sky-based env probe (applyTheme
       * default) hand the transmission something to refract. */
      crystal: { emissive: 0xb49aff, emissiveIntensity: 2.2, attenuationColor: 0x4a3a9a },
      neon: { emissive: 0x9a7dff, emissiveIntensity: 2.6 },
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

/* hoisted scratch: applyTheme runs on stage load, but setShadowFocus and the
 * rig's camera-follow run per-frame, so nothing here may allocate. */
const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _camW = new THREE.Vector3();
const _lRight = new THREE.Vector3();
const _lUp = new THREE.Vector3();
const _lDir = new THREE.Vector3();
const _UP_HINT = new THREE.Vector3(0, 1, 0);

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
  /* Sky-environment is the DEFAULT (2026-08-31 critic pass): the shipped caller
   * (game.js:789) passes no opts, so the old opt-in meant the true-sky probe
   * had zero callers and every reflective surface mirrored the engine's generic
   * studio cards instead of the neon city / aurora / cloud sea it stood under.
   * Pass {skyEnvironment:false} to keep the engine's card probe. */
  const wantSkyEnv = !(opts && opts.skyEnvironment === false);
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
   * Engine.setTheme() bakes its generic PMREM probe (gradient + sun + three
   * emissive light cards) first; unless the caller opts OUT with
   * {skyEnvironment:false} we then replace it with a probe rendered FROM THE
   * ACTUAL SKY DOME, so the neon city glow, the aurora and the cloud sea all
   * show up in reflections — obsidian's clearcoat mirrors the world it stands
   * in, not a studio card. dispose() hands the slot back to the engine probe.
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

  /**
   * Re-place the whole light rig around (x,y,z), snapping the shadow focus to
   * the shadow-map texel grid IN LIGHT SPACE so a gliding frustum does not make
   * every shadow edge shimmer. Allocation-free.
   */
  const texelWorld = mapSize > 0 ? (sh.extent * 2) / mapSize : 0;
  function moveFocus(x, y, z) {
    _v.set(x, y, z);
    if (texelWorld > 0) {
      // light basis: dir toward the light; right/up span the ortho frustum
      _lDir.set(def.lights.key.dir[0], def.lights.key.dir[1], def.lights.key.dir[2]).normalize();
      _lRight.crossVectors(_UP_HINT, _lDir);
      if (_lRight.lengthSq() < 1e-6) _lRight.set(1, 0, 0);
      _lRight.normalize();
      _lUp.crossVectors(_lDir, _lRight);
      const pr = _v.dot(_lRight);
      const pu = _v.dot(_lUp);
      const pd = _v.dot(_lDir);
      const qr = Math.round(pr / texelWorld) * texelWorld;
      const qu = Math.round(pu / texelWorld) * texelWorld;
      _v.set(0, 0, 0)
        .addScaledVector(_lRight, qr)
        .addScaledVector(_lUp, qu)
        .addScaledVector(_lDir, pd);
    }
    focus.copy(_v);
    placeLight(key, def.lights.key.dir, keyDist, focus);
    placeLight(fill, def.lights.fill.dir, 60, focus);
    placeLight(rim, def.lights.rim.dir, 70, focus);
    hemi.position.set(x, y + 60, z);
  }

  /* Follow the camera every frame. game.js never calls setShadowFocus, and a
   * fixed frustum around the origin left every station past ~extent metres
   * (most of a 150 m+ course — the 2026-08-31 critic pass measured player
   * x=180 on temple-1) with NO shadow coverage at all: configured maps, zero
   * visible shadows. The rig owns the problem now: it slides itself. */
  const onFrame = (dt) => {
    if (disposed) return;
    sky.update(dt);
    const cam = engine.camera;
    if (cam && key.castShadow) {
      _camW.setFromMatrixPosition(cam.matrixWorld);
      if (Math.abs(_camW.x - focus.x) > 0.5 ||
          Math.abs(_camW.y - focus.y) > 0.5 ||
          Math.abs(_camW.z - focus.z) > 0.5) {
        moveFocus(_camW.x, _camW.y, _camW.z);
      }
    }
  };

  const rig = {
    theme: def,
    themeId: def.id,
    group, key, fill, rim, ambient, hemi, sky, env, focus,

    /** advance the sky; wired to engine.onFrame when the engine offers it */
    update(dt) { if (!disposed) sky.update(dt); },

    /**
     * Slide the shadow frustum (and the whole light rig) to follow the player
     * down a long stage. Allocation-free — call it every frame if you like.
     * (The rig also follows engine.camera on its own each frame; this remains
     * for callers that want a different focus, e.g. a cinematic.)
     */
    setShadowFocus(x, y, z) {
      if (disposed) return;
      moveFocus(x, y, z);
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
