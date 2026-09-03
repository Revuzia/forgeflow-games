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
    /* ROUND 1 VISUAL FIX — measured, not guessed. `_shots/verify_keep.png` at
     * exposure 1.05 / envIntensity 0.85 / bloom threshold 1.02 came back at
     * mean luminance 0.640, 13.9 % of pixels over 0.90, 4.5 % clipped over
     * 0.97 and mean saturation 0.111; `_shots/keep/cp4.png` (the courtyard) was
     * worse — 0.762 / 27.2 % / 9.8 % / 0.109, a white milk bath with no detail
     * and no readable parapet edge. A warm stone interior lit by windows sits
     * near 0.34-0.44 mean with under ~1 % clipped, and its colour comes from
     * the AMBER key against the BLUE fill — neither of which can be seen once
     * everything is at the top of the curve, which is exactly why the Keep read
     * "neutral white/grey" instead of "warm stone". The four emitters that were
     * over the ceiling are fixed in keep.js; these are the global ones. */
    /* ROUND 3. 0.84 was an over-correction of round 1's blowout: the critic
     * measured the Keep as "a dim industrial parking garage", `_shots/keep/cp1.png`
     * majority near-black, and contrastcheck read the walked deck at only
     * 2.37:1 over the band behind it. A near-black frame cannot hold 3.5:1,
     * because the +0.05 term in the WCAG ratio dominates once both sides are
     * dark — the way out of a failing ratio at the bottom of the curve is UP,
     * not further down. The blowout itself is fixed where it was made: the
     * strip emitters (builders.js stripeFaces) and the wall albedo below. */
    /* ROUND 5 — THE OVER-CORRECTION. Critic, measured with the HUD cropped:
     * keep/vista-ne mean L 0.132 median 0.093, vista-nw 0.140/0.097,
     * vista-sw 0.127/0.094, vista-se 0.168/0.126, and keep/cp2 with 18.32 % of
     * the frame under 0.06 — "a near-black cut-out of a fort against a dusk
     * band". Round 1 blew the Keep out, round 3 answered by taking the exposure
     * DOWN, and a frame cannot be fixed at either end of the curve: the answer
     * to a blown frame is to fix what is blowing (the strip emitters, in
     * builders.js this round) and then put the exposure back where a lit stone
     * hall belongs. 1.06 is verdant's, which is the right anchor — the Keep is
     * a dim place because its LIGHTS are dim, not because its camera is. */
    exposure: 1.06,
    /* Raised with the sky darkening below: the dome is the Keep's only
     * environment source, so halving its horizon would otherwise take the
     * limestone down with it and leave the contrast ratio where it was. */
    /* 1.10 -> 1.22. At dusk the dome IS the Keep's exterior light, and env is
     * the only term that scales with it; it lifts the deck and the band it is
     * read against together, so the readability ratio is close to invariant
     * under it where a flat ambient is not. */
    envIntensity: 1.22,

    /* Interior fog: short and warm. `near` is deliberately far enough out
     * that the room you stand in is crisp — the haze exists to give the far
     * end of the hall depth and to be the dark ground the decks read against. */
    /* Density 0.0125 put only ~9 % haze on the far end of a 25 m hall, so the
     * 'dark ground the decks read against' this comment promises did not
     * exist: at cp1 the band behind the deck measured [117,95,84] — a fully
     * lit far wall, BRIGHTER than the floor in front of it. 0.030 is what
     * actually makes the depth of the hall recede. */
    /* The fog IS the dark ground the decks read against, so it goes DOWN in
     * value as the exposure goes up — otherwise raising the exposure just moves
     * both sides of the ratio together. Warmer as well as darker: this is the
     * depth of a candle-lit hall, not a grey one. */
    /* ROUND 2 VISUAL — THE FOG WAS ERASING THE BUILDING.
     *
     * Measured on `_shots/keep/vista-sw.png` (an establishing shot of the hub
     * from ~30 m out): frame mean luminance 0.111, 33.5 % of the frame below
     * 0.06, and the Keep's own stone walls rendering at [24,13,16] against a
     * fog colour of [25,18,9] — i.e. the walls were not dark, they were GONE,
     * replaced by fog. The whole hub read as a black paper cut-out with only
     * its trim strips visible.
     *
     * The arithmetic says why. exp2 fog is 1 - exp(-(d*z)^2), so at 0.052 the
     * haze is 91 % at 30 m and 98.6 % at 40 m. That is a defensible number for
     * a 25 m HALL and an impossible one for a hub that also has a courtyard, a
     * tower roof and four establishing shots looking across 40-60 m of it — and
     * the Keep is both. 0.024 keeps a real recession indoors (26 % at 25 m,
     * 47 % at 40 m) while leaving the building a building.
     *
     * The colour comes up and cools a little at the same time. Distant air at
     * dusk is the sky's own value; a near-black soot fog gives distant mass a
     * hole to fall into instead of atmosphere to sit in, and the readability
     * pair still works because the decks are lit and the air is not. */
    /* 0.032 -> 0.022. The comment block above this line argues at length for
     * 0.024 ("0.052 ... is a defensible number for a 25 m HALL and an
     * impossible one for a hub that also has a courtyard, a tower roof and four
     * establishing shots looking across 40-60 m of it") and then the value
     * drifted back up to 0.032, which is 64 % haze at 40 m and is half of why
     * the four establishing shots are a silhouette. 0.022 = 43 % at 40 m. */
    fog: { color: 0x2a2028, near: 10, far: 150, density: 0.018, type: 'exp2' },

    sky: {
      type: 'sanctum',
      params: {
        /* The Keep's courtyard and tower roof look straight at this dome, and
         * at horizon 0xdcd0b4 + glowStrength 0.75 + intensity 0.85 the whole
         * band was brighter than the limestone decks in front of it — the
         * readability law inverted, and `_shots/keep/cp4.png` measured 27 % of
         * the frame over 0.90 luminance. A dusk sanctum sky is a DEEP band
         * with a warm rim, not a cream wall. */
        /* ROUND 2 — R9, THE KEEP'S OUTDOOR FIGURE/GROUND.
         *
         * Measured (contrastcheck, headless Chrome on the real GPU, this
         * session): keep cp4 — the courtyard/tower deck — read
         * deck [162,144,109] against band [165,136,98] = 1.07:1 against a
         * 3.5:1 law. Those are the SAME COLOUR: the parapet edge a player has
         * to judge a jump against is invisible.
         *
         * The cause is structural, not a tint. The theme commits to "dark warm
         * fog -> BRIGHT stone decks", which is right indoors — but the Keep has
         * OUTDOOR stations, and out there the band behind a deck is not the fog,
         * it is THIS DOME. A cream horizon (0x9c9078) with a 0.44 warm glow on
         * top of it is brighter than limestone, so the figure/ground pair
         * inverted the moment the player stepped into the courtyard. Round 1
         * darkened this from 0xdcd0b4 and moved the ratio by 0.01, because the
         * glow, the island rim and the cloud deck were all still sitting on top
         * of it.
         *
         * A DUSK sanctum sky is a deep band with a thin warm rim over a dark
         * sea, which is both the correct reading of `timeOfDay: 'dusk'` and the
         * only shape that puts the decks on the bright side outdoors as well as
         * in. envIntensity is raised alongside it so the decks do not simply
         * follow the sky down. */
        /* ROUND 3: lifted again for the EXTERIOR. The dome is the only light
         * an outdoor Keep wall receives at dusk, and at intensity 0.50 with a
         * 0.11 glow the whole hub rendered as a black silhouette with its new
         * crenellations invisible. The band is still well under the courtyard
         * deck (contrastcheck keep cp4 measures 9.36:1 after this change). */
        top: 0x102a4a, mid: 0x264a70, horizon: 0x3a3026, bottom: 0x222833,
        horizonGlow: 0xe8a868, glowPower: 6.4, glowStrength: 0.20,
        /* sunDir now AGREES with lights.key.dir. It did not, and a sun that
         * is not where the shadows say it is cannot be found in a frame — part
         * of why the critic could not see a disc in any of 25 shots. */
        /* ROUND 5: dir.y 0.42 -> 0.20. This is DUSK — the theme says so — and a
         * 25-degree sun is mid-afternoon. 11.5 deg puts the disc just above the
         * sea in the courtyard and tower stations, which is where a dusk sun
         * belongs, and it is what makes the warm rim on the island ring read as
         * coming from somewhere. The key follows it (lights.key.dir). */
        sunDir: [-0.82, 0.155, 0.38], sunColor: 0xffd8a0,
        /* sunSize in (1 - cos theta): 0.0055 was a 6-degree radius, i.e. a
         * 12-degree smear. 0.00040 = 1.6 deg — a low sun reads slightly larger
         * than a high one, which is also true. */
        sunSize: 0.00040, sunIntensity: 3.4, sunHalo: 0.55,
        /* THE ARC (critic: "a broad ~200 px vertical spectral smear ... renders
         * as a straight prism band with no arc curvature and reads exactly like
         * over-strength chromatic aberration"). The cause is the radius: a
         * rainbow is a 42-degree cone about the ANTI-SOLAR point, i.e.
         * rainbowRadius 0.233 in this shader's units of PI. At 0.42 the cone
         * was 76 degrees wide about a point below the horizon, and the piece of
         * a 76-degree cone you can see from inside it is a near-straight band.
         * Back to the physical radius, with a narrower, softer band. */
        rainbowStrength: 0.15, rainbowRadius: 0.235, rainbowWidth: 0.030,
        islandStrength: 0.50, islandCount: 13.0, islandHeight: 0.058,
        islandColor: 0x121a24, islandGlow: 0xc08850, islandBand: 0.02,
        // the sea and the far shore under the island ring
        // count 6 for the same reason as verdant's 4 — too few cells to populate
        // a horizon once cbRange drops a fifth of them.
        landStrength: 0.70, landCount: 11.0, landHeight: 0.040,
        landNear: 0x14202c, landFar: 0x27333f, landRim: 0xb07c48,
        ringStrength: 0.12, ringColor: 0xa08466,
        cloudStrength: 0.34, cloudScale: 1.5, cloudSpeed: 0.006, cloudCoverage: 0.40,
        cloudLit: 0x8a7f6e, cloudShadow: 0x3a4250,
        starDensity: 0.0, starBrightness: 0.0, dither: 1.0,
        sunPower: 90, haze: 0.32, intensity: 0.78,
      },
    },

    lights: {
      /* THE AMBER/BLUE SPLIT (critic: "no amber-key-vs-blue-fill separation
       * anywhere in frame — the interior is a single warm-grey wash").
       * A split you can SEE needs three things at once: a key that is actually
       * amber rather than pale cream, a fill that is actually blue rather than
       * a desaturated slate, and the flat terms low enough that neither is
       * washed out by light with no direction at all. All three move here. */
      /* dir FOLLOWS sky.params.sunDir (0.20). Indoors this is the raking window
       * light and a LOWER angle is strictly better — it throws the long bars of
       * light across the floor the theme header promises and lines the god-ray
       * planes up with them. */
      key: { color: 0xffb257, intensity: 2.80, dir: [-0.82, 0.155, 0.38] },
      /* Cool bounce off the shadowed wall. It was 0.95 against a 2.65 key AND
       * a 0.42 ambient AND a 0.62 hemi — a 26 % share that clipping then ate
       * entirely, which is why no blue survived into the frame. Against the
       * reduced ambient it is now the second-largest term and legible as a
       * colour, which is the contract's "cool blue fill". */
      /* ROUND 4 — WHERE THE BLUE FILL WAS GOING (critic: "keep/spawn measures
       * mean saturation 0.282, i.e. the amber key and the blue fill still
       * average to neutral on the up-facing floor because lights.hemi.skyColor
       * and lights.fill both hit horizontal surfaces"; and
       * `_shots/keep/vista-sw.png` — "the west and south faces of the hub take
       * the same value, so there is no key/fill modelling on the building at
       * all"). At dir.y 0.46 the fill was a second overhead light: it landed on
       * the same floor the amber key lands on, the two averaged to grey there,
       * and the VERTICAL faces — the ones that model a building — got almost
       * nothing from either. A bounce off a shadowed wall travels sideways, so
       * this one now rakes: dir.y 0.46 -> 0.09. The floor keeps the amber, the
       * wall opposite the key gets the blue, and the two faces of a corner
       * finally differ. */
      fill: { color: 0x5b86d8, intensity: 1.42, dir: [0.78, 0.09, -0.62] },
      // soft warm separation on the far edges of the paintings and pillars
      /* ROUND 4b — THE THIRD LIGHT WAS AIMED AT NOBODY.
       * Measured on the re-shot `_shots/keep/vista-sw.png`: 99.4 % of the frame
       * below 0.06 linear luminance, i.e. the hub is still a silhouette. The
       * arithmetic says why, and it is not the fog. All three of the Keep's
       * directional terms point into the same half of the sky: the key from
       * (-0.82, ., 0.38) and the fill from (0.78, ., -0.62) are opposed on X,
       * fine — but the rim came from the NORTH (dir.z -0.98). Every one of the
       * four establishing shots looks at the hub from OUTSIDE, so the faces in
       * frame are the south and the west, and a south-facing wall scored
       * dot -0.98 against the rim, -0.62 against the fill, and +0.38 against a
       * key that a 25-degree dusk sun puts behind the west parapet. Three
       * lights, none of them landing. The rim swings to the SOUTH-EAST, which
       * is the one direction that was uncovered: the hub now takes amber on the
       * west, blue on the east and a warm separation on the south, so a corner
       * reads as a corner. dir.y stays low (0.16) on purpose — this must model
       * WALLS, not add another term to the floor, where the contrast law is
       * already tight (keep cp1 measures 3.73:1 against a 3.5 floor). */
      rim: { color: 0xffd79a, intensity: 2.45, dir: [0.40, 0.16, 0.90] },
      /* Flat terms are what destroy an interior: they lift the shadows to meet
       * the highlights and the room goes to one value. Halved. */
      /* Flat terms stay small AND take a side: the ambient is the warm bounce
       * off the floor, the hemi's sky half is the COOL window light and its
       * ground half the warm stone, so even the undirected light carries the
       * split instead of averaging it away. */
      ambient: { color: 0x3a2c1e, intensity: 0.30 },
      /* Raised 0.34 -> 0.50: at dusk the Keep's EXTERIOR gets no key at all
       * (the key is the raking window light, which lives indoors), so the whole
       * hub rendered as a black silhouette in three of the four establishing
       * shots. The hemi's sky half is the dusk dome, which is exactly the light
       * an outdoor wall should be receiving. */
      /* The hemi's sky half is what lights every UP-facing surface, and at
       * 0x5f7bb0 it was a second blue source on the floor — the other half of
       * the neutral-floor measurement above. Warmed toward the dusk band it
       * actually stands under, and lifted a little because it is now the only
       * cool-free light the exterior receives from overhead. */
      /* ROUND 5 — THE EXTERIOR TERM. Critic: "the new crenellations, the wall
       * courses and the key/fill corner modelling ... are all invisible at
       * establishing range". Outdoors at dusk the hemi IS the Keep's light, and
       * at 0.50 against a fog that was eating 64 % of a 40 m wall there was
       * nothing left to model. Raised, and the GROUND half warmed and lifted
       * hard, because a hemi's ground half is the only directional-ish term
       * that lands on a VERTICAL face from below — which is exactly the 25-40 m
       * wall the critic says receives nothing. */
      hemi: { skyColor: 0x7d86ac, groundColor: 0x5c4430, intensity: 1.00 },
    },

    /* Warm/cool split lives in the grade too, not only in the lights: gain and
     * tint pull the highlights amber and the shadows blue, and saturation goes
     * up because the measured frame was at 0.111 — a colour-timed stone hall
     * should sit around 0.22-0.30. */
    grade: {
      lift: [0.010, 0.008, 0.014], gamma: [0.99, 1.00, 1.02], gain: [1.10, 1.005, 0.895],
      saturation: 1.32, vignette: 0.44, chroma: 0.0006,
      tint: [1.055, 1.00, 0.925],
    },
    /* Threshold above the diffuse range: the shafts, the painting shimmer and
     * the crest pedestal bloom — the plaster does not. 1.02 was BELOW the lit
     * plaster, so the walls themselves bloomed and the hall went to white. */
    /* Threshold raised again for the HERO, not the plaster: under the
     * courtyard key Nim's head clipped to a flat blown cream disc and bloom
     * then haloed it (critic, `_shots/_vz_herohead.png`). The head's own albedo
     * is pulled down in player/hero.js; this stops the bloom from finding what
     * is left of it. Radius tightened so the pass stops leaving soft round
     * ghosts over the geometry. */
    bloom: { strength: 0.36, radius: 0.42, threshold: 1.52 },

    palette: {
      /* safeEdge is the EMISSIVE lip stripe (builders.js). It was a near-white
       * amber, which at any usable intensity clips all three channels and turns
       * every deck edge into a white bar — see the glare-bar note in
       * builders.js buildPlatform. Saturated, so the bar keeps its hue. */
      safe: 0xb9a888, safeEdge: 0xffc46a,
      /* WINDOW LIGHT, not accent — see buildBuilding's glassMat note. */
      light: 0xffcf92, lightCool: 0xdcebff,
      kill: 0xff3a20, killGlow: 0xff8a5a,
      checkpoint: 0x4a3f34, checkpointOn: 0x7fe0ff,
      crest: 0xffcf4a, sigil: 0xc07bff, coin: 0xffe27a,
      accent: 0xffb45c, deco: 0x6a5a46, water: 0x3f8fb0,
      pad: 0xffb45c, finish: 0xc9a6ff,
      /* Checkpoint-pad self-lift (course.js _buildCheckpoints). The Keep is a
       * candle-lit hall: the pad receives almost no key, so without a lift it
       * is the DARK half of the figure/ground pair contrastcheck measures under
       * the hero's feet (keep cp1 sits at 3.77:1 against a 3.5:1 law even now).
       * The lift is bound to the stone albedo map, so this number is roughly
       * twice the old flat one for the same screen value. */
      /* 2.05 -> 3.10. Binding the lift to the albedo map (course.js) costs a
       * factor of roughly the map's mean value, which for the stone bake is
       * well under a half: measured, 2.05 put the Keep pad at [148,130,100]
       * where the flat 1.14 had put it at [209,192,155], and contrastcheck
       * cp1 fell to 1.57:1. The map stays (it is what gives the disc its
       * grain); the number carries the value back. */
      /* Second measured step: 3.10 gave keep cp1 2.67:1. The pad's response is
       * linear in this number (measured: 2.05 -> [148,130,100], 3.10 ->
       * [173,150,113]), and 3.5:1 over a [97,80,80] band needs the deck near
       * [200,175,132] — which is still BELOW the [209,192,155] the flat 1.14
       * was producing before this round, and warmer. */
      /* 4.55 -> 5.10: cp1 measured 3.59:1 and repeated runs of contrastcheck on
       * an unchanged build drift by up to +-0.4 (the stations animate), so a
       * 0.09 margin is luck, not a pass. This puts the pad at roughly [208,187,
       * 146] — still below the [209,192,155] the pre-round flat lift produced,
       * and warmer. */
      /* ROUND 5, MEASURED. With the Keep's exposure back at 1.06 and its fog
       * down to 0.018, contrastcheck read cp1 at 3.11:1 (deck [205,180,137]
       * over a band of [112,92,89]) against a 3.5:1 law — the band is the hall
       * floor seen 25 m away, so LESS haze lifted it faster than the exposure
       * lifted the deck. The pad lift is the one lever that moves the deck
       * without moving the band (it is bound to the pad's own albedo), and the
       * arithmetic wants the deck near [214,190,148]. */
      padGlow: 6.90,
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
    /* FIGURE / GROUND, IN THE ALBEDO. The Keep's decks are MARBLE and its
     * walls are stone, plaster and brick — so the theme can put the two on
     * opposite sides of the value scale directly, which is the one lever that
     * moves the readability ratio without moving the whole frame. The walls
     * come down to a real warm-stone mid; the marble floor stays near-white.
     * Measured before this change: keep cp1 deck [168,154,125] against a wall
     * band of [100,81,72] = 2.69:1 against a 3.5:1 law. */
    materialOverrides: {
      stone: { tint: 0x9c8768 },
      plaster: { tint: 0xa8957a },
      brick: { tint: 0x9c6f56 },
      /* ROUND 2 VISUAL — "the interior reads neutral white/grey, NOT warm stone
       * with amber window light" (owner). Measured on `_shots/keep/spawn.png`:
       * frame mean saturation 0.247, and the hall floor — the largest single
       * surface in every interior shot — rendering as a cold near-neutral tile
       * grid. 0xf6f1e6 is a NEUTRAL near-white; a marble floor that large sets
       * the colour of the room no matter what the key does, so the amber key
       * was colouring a white sheet and the result averaged to grey. Warmed and
       * dropped ~7 % in value: still the bright half of the figure/ground pair
       * the readability law wants (the walls sit at 0x9c8768), now warm stone
       * rather than vinyl. */
      /* ROUND 2, second pass. contrastcheck keep cp1 measures the band behind
       * the hero at [113,97,96] — that band is THIS FLOOR seen 25 m away, not
       * a wall (darkening the verticals moved it by one count). A near-white
       * floor covering the whole hall is therefore both halves of the
       * readability pair at once, and no lift on the pad can separate them:
       * the deck would have to reach [222,205,175] to hold 3.5:1 over its own
       * material. Pulled down to a warm stone value — which is what the
       * contract asked for in the first place — so the lit pad, the amber
       * trim and the window light all have somewhere to read against. */
      marble: { tint: 0xd2bf96, clearcoatRoughness: 0.06 },
      wood: { tint: 0xc09056 },
      panel: { tint: 0x8a7d64 },
      metal: { tint: 0xb8b0a0, metalness: 0.55, env: 0.55 },
      copper: { tint: 0xffc8a0, env: 0.85 },
      gold: { env: 1.25 },
      grate: { tint: 0x807666 },
      checker: { tint: 0xb0a284 },
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
    /* Grain down from 0.018: the critic read "heavy grain speckle across the
     * whole sky" in the vista crops, and a smooth sky gradient is the one place
     * film grain has nothing to hide behind. */
    effects: { heatShimmer: false, grain: 0.008, snowWind: 0, godRays: true },
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
    /* ROUND 4b, PAYING FOR THE SKY FIX. Moving the cumulus deck BEHIND the
     * distant land in sky.js (correct: clouds are sky, land stands in front of
     * it) made the band of dome just above the horizon materially darker,
     * because white puffs no longer cover the land silhouettes. That band is a
     * large share of the environment map's UPPER hemisphere, so every
     * horizontal surface in the course lost light while vertical faces — which
     * see only half the sky — barely moved. Measured: verdant-1 cp2 went deck
     * [195,191,168] / band [96,90,73] / 3.71:1 to [183,185,162] / [99,92,75] /
     * 3.31:1, i.e. under the 3.5 floor, with the horizontal-to-vertical light
     * ratio falling 5.03 -> 4.38. The compensation therefore has to be
     * up-facing too, or it just moves both sides of the ratio together: env
     * (the sky's own contribution) and the fill, whose dir.y is 0.82. */
    envIntensity: 1.20,

    /* The band a platform is silhouetted against is the treeline shadow. It was
     * a cold slate BLUE, which is why the meadow read as an overcast grey-green
     * afternoon rather than the contract's warm morning: the single largest
     * colour in the frame after the grass was blue haze. Same luminance
     * (0.354 -> 0.334 by hex arithmetic, so contrastcheck can only improve),
     * hue moved to pine. */
    /* AERIAL PERSPECTIVE, the version that survives the readability law.
     *
     * The critic is right that 0.0040 exp2 does nothing at course scale
     * (1 - exp(-(0.004*120)^2) = 0.2 % over a 120 m vista) and that the far
     * side of the island reads the same saturated green as the near side. The
     * first attempt at a fix raised the density to 0.0105 AND warmed the haze
     * to 0x8fae96, and contrastcheck immediately caught the cost: cp3's band
     * went [35,41,32] -> [64,80,62] and the ratio fell 4.56 -> 2.72, because in
     * VERDANT the band a platform is silhouetted against IS the haze, and this
     * theme commits to "deep pine band -> bright sunlit decks". A pale haze
     * inverts that pair.
     *
     * So the depth cue is split: the fog stays the DEEP PINE it has to be and
     * gets a moderate density bump (0.0055 = ~11 % at 60 m, ~35 % at 120 m,
     * which is enough to separate the far hills from the near ones), and the
     * BRIGHT part of aerial perspective — the warm morning band, the distant
     * land — is delivered by the sky backdrop in sky.js, where it sits BEHIND
     * the course instead of on top of it. */
    /* ROUND 4 — AERIAL PERSPECTIVE (critic, `_shots/verdant-1/vista-se.png` and
     * `spawn.png`: "the hills 120 m out are the same saturated green as the
     * hill 8 m out"). Two things move, and only one of them is the density.
     *
     * Density 0.0055 -> 0.0076. exp2 haze is 1 - exp(-(d*z)^2): the far hills
     * at 120 m go from 35 % to 58 %, the mid field at 60 m from 11 % to 19 %,
     * and the near field at 25 m stays at 3.6 % — so depth arrives without the
     * ground the player is standing on picking up any veil at all.
     *
     * Colour 0x33604f -> 0x3a5a54. This is the half the previous round could
     * not do: it kept trying to make the haze BRIGHTER, which inverts the
     * readability pair (in verdant the band a deck is silhouetted against IS
     * the haze). Aerial perspective is not only "lighter with distance", it is
     * "LESS SATURATED and cooler with distance" — and desaturating costs the
     * readability law nothing. By hex arithmetic the relative luminance goes
     * 0.0925 -> 0.0883, i.e. very slightly DARKER, while the green channel's
     * lead over red and blue falls from 45/28 to 32/22. The far hills now lose
     * their green as they recede instead of merely dimming. */
    fog: { color: 0x3a5a54, near: 26, far: 320, density: 0.0076, type: 'exp2' },

    sky: {
      type: 'day',
      params: {
        /* The horizon was 0xc4dcec — a near-white wall that a near-white
         * cumulus deck cannot be seen against, which is why the sky rendered as
         * "only thin wispy cirrus" at cumulusCoverage 0.52: the puffs were
         * being drawn, in white, onto white. */
        top: 0x1d5fae, mid: 0x4f92d8, horizon: 0xaecde2, bottom: 0x475f57,
        horizonGlow: 0xffd8a0, glowPower: 5.5, glowStrength: 0.38,
        // sunDir now AGREES with lights.key.dir (see the keep note above)
        /* ROUND 5 — THE SUN IS LOWER. The vista stations sit above the diorama
         * looking DOWN at it (shots.py places them at bounds-corner + 0.42 of
         * the bounds height and looks at the centre), so with fov 58 the top of
         * a vista frame is only ~14.5 deg above the horizon — measured off
         * `_shots/verdant-1/vista-sw.png`, whose horizon sits at y=240 of 900.
         * A 26-degree sun (dir.y 0.44) is therefore OUT OF FRAME in every wide
         * shot, which is the real reason the critic could not find a disc; the
         * probe that pointed a camera straight down this sunDir found it
         * immediately (`_shots/_probe_sun_verdant-1_pre.png`). 0.36 = 21 deg
         * puts the disc's aureole into the top of the establishing frames and
         * the disc itself into the over-the-shoulder stations, and it is also
         * what "a warm, LOW sun ... long shadows down the hills" (this theme's
         * own header) actually means. The key follows it exactly — a sky sun
         * and a shadow sun that disagree is the round-3 defect. */
        sunDir: [-0.62, 0.36, 0.65], sunColor: 0xfff0d0,
        /* ROUND 4: "no sun disc is resolvable in ANY of the 16 verdant frames
         * despite sunDir/key agreeing". At sunSize 0.0055 the disc's bright
         * core is a 1.3-degree cap — about 25 px on a 1600-wide 70-degree
         * frame — and it sat under the theme's 1.12 bloom threshold once the
         * pale horizon was added under it, so it never became a highlight.
         * A morning sun through thin cloud is a small hot disc with a short
         * scatter skirt: the disc gets bigger AND hotter, and the halo grows
         * just enough to say where it is when the disc itself is off-frame. */
        /* ROUND 5 — SIZE. sunSize is (1 - cos theta), so round 4's 0.0110 is an
         * angular RADIUS of 8.5 deg: a SEVENTEEN-degree cap, photographed in
         * `_shots/_probe_sun_verdant-1_pre.png` as a featureless white bank
         * with a cumulus shadow lying across it. Round 4 read "no disc is
         * resolvable" and enlarged the disc, which is exactly what dissolved
         * it. 0.00024 = 1.26 deg radius — about 45 px across a 1600-wide frame,
         * a stylised sun that is still unmistakably a DISC. The intensity can
         * finally do something now that sky.js writes linear HDR: 4.2 x the
         * disc's 22x core is far over the 1.12 bloom threshold, so it clips and
         * blooms like a sun instead of landing at 232 like everything else. */
        sunSize: 0.00024, sunIntensity: 4.2, sunHalo: 0.62,
        /* procedural cumulus layer baked into the dome (no extra mesh).
         * Shadow side pulled well off the sky value and sharpness dropped, so a
         * cell reads as a lit BILLOW with a shaded underside instead of a flat
         * white cut-out. */
        cumulusStrength: 1.0, cumulusScale: 1.75, cumulusSpeed: 0.0125,
        cumulusCoverage: 0.56, cumulusSharp: 1.6, cumulusHeight: 0.16,
        cumulusLit: 0xfffaf0, cumulusShadow: 0x6a86a8,
        /* THE WORLD BEYOND THE COURSE (critic: "the whole course is a floating
         * slab that simply ends, surrounded by flat white haze"). Two ranges of
         * distant land on the dome, the far one washed almost to the horizon
         * colour — that IS aerial perspective, and it sits behind the course
         * instead of on top of it, so it costs the readability law nothing. */
        /* ROUND 5 — landCount 4 MEANT FOUR RIDGES IN THE WHOLE WORLD.
         * cbRange divides the azimuth into `count` cells and drops ~22 % of
         * them entirely, so at count 4 each cell is a 90-degree block of sky
         * that is either one enormous 7-degree hump or nothing at all — and a
         * vista frame only sees about 70 degrees of azimuth. That is why the
         * critic found "NONE of those ranges renders in any of the four vista
         * frames" while the theme still configured landStrength 1.0: the ranges
         * exist, there are simply four of them around an entire horizon.
         * 13 cells of 28 deg at a third of the height is a RANGE. */
        landStrength: 1.0, landCount: 13.0, landHeight: 0.046,
        /* landFar is the HAZE the far range washes into, and it is also what
         * the new ground grading in sky.js distantLand() uses at the skyline
         * itself, so it has to sit between the horizon colour and the near
         * land rather than being a third value of its own. */
        landNear: 0x3c5a4e, landFar: 0x7e97a4, landRim: 0xffd8a4,
        starDensity: 0.0, starBrightness: 0.0, dither: 1.0,
        sunPower: 110, haze: 0.65, intensity: 1.10,
      },
    },

    lights: {
      /* Morning means a WARM key and a warm bounce off the ground. The hemi
       * ground term was 0x3e5a34 — a dark cold green — and it is the light
       * every up-facing surface in a 140 m meadow receives, so it dragged the
       * whole field toward bottle green (measured on `_shots/verdant-1/cp1.png`:
       * mean sat 0.347 with essentially no warm content). Warmed, and the key
       * pushed a touch more amber. */
      /* ROUND 5 — dir FOLLOWS sky.params.sunDir (now 0.36). A lower sun puts
       * LESS key on horizontal decks (dot 0.44 -> 0.36, -18 %) and slightly
       * more on the vertical faces the deck is read against, which is the wrong
       * direction for the readability law — so the up-facing loss is paid back
       * on the FILL, whose dir.y is 0.82 and which therefore lands on the deck
       * and not on the fort wall behind it. That is the same lever, and the
       * same argument, as the round-4 fill note below. */
      key: { color: 0xffdca4, intensity: 3.45, dir: [-0.62, 0.36, 0.65] },
      /* 1.10 -> 1.30: this is the near-vertical term, so it lands on the
       * courtyard deck (dot 0.82) and not on the fort wall behind it (dot
       * -0.42) — the one lever that restores the deck WITHOUT restoring the
       * band it has to be read against. See the envIntensity note above. */
      /* MEASURED, and the second half is the interesting half. 1.10 -> 1.30
       * took cp2 from 3.31:1 (failing) to 3.52:1. 1.30 -> 1.40 was then tried
       * for more margin and bought NONE: cp2 measured 3.52:1 again, because at
       * that station the sampled band picks up enough up-facing surface to
       * take the same lift the deck does. So the fill lever is spent at ~3.5
       * here and 1.40 is kept only for the slightly brighter frame, not for a
       * margin it does not deliver. Two independent runs both reading 3.52
       * (deck [195,192,171] then [194,192,171]) is at least good evidence that
       * this station's old +-0.2 drift is gone. Anything further has to come
       * off the BAND — the fort's own sunlit wall — not off more light. */
      fill: { color: 0x8fc0ff, intensity: 1.95, dir: [0.42, 0.82, -0.38] },
      rim: { color: 0xfff2d8, intensity: 1.55, dir: [0.66, 0.16, -0.74] },
      /* Flat terms trimmed: they were lighting the shaded fortress WALLS to
       * within 1.85:1 of the sunlit deck in front of them (contrastcheck,
       * verdant-1 cp2). The key carries the deck; the walls may fall away. */
      ambient: { color: 0x7d8a68, intensity: 0.26 },
      hemi: { skyColor: 0x8cbcec, groundColor: 0x5a6338, intensity: 0.46 },
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
      /* saturated for the same reason as the Keep's — see builders.js */
      safe: 0xd8cfae, safeEdge: 0xffdc86,
      /* The verdant fort's arrow slits used to glaze in `accent` (lime) and read
       * as pasted plastic. A morning fort's slits are a dim warm room seen
       * through 0.34 m of stone; the daylight side is the pale sky. */
      light: 0xffd49a, lightCool: 0xd6e6f4,
      kill: 0xff2a3c, killGlow: 0xff7a86,
      checkpoint: 0x4a5a4a, checkpointOn: 0x6fe8c8,
      crest: 0xffcf4a, sigil: 0xb46cff, coin: 0xffe27a,
      accent: 0x8fe05a, deco: 0x6f8a5a, water: 0x4fb0c8,
      pad: 0x8fe05a, finish: 0xc9a6ff,
      /* Checkpoint-pad self-lift. Measured on `_shots/bootcheck.png` at the
       * shared 1.14 flat value: the spawn pad rendered at 0.802 mean luminance
       * in a frame whose mean is 0.313 — a blown white puddle that swallowed
       * Nim's boots — and contrastcheck read 12.57:1 against a 3.5:1 law. A
       * sunlit morning meadow already lights a limestone disc perfectly well;
       * the lift here only has to keep the pad off the grass value, not
       * manufacture the whole of it. */
      /* 0.62 -> 1.05. 0.62 killed the blowout (the pad went from 0.802 mean
       * luminance to 0.44, measured) but it also took verdant-1 cp2 to 3.15:1
       * against a 3.5:1 law, because that station's band is the fort's own lit
       * interior. 1.05 puts the pad near [190,190,170] — 1.6x the frame mean,
       * where the blown version was 2.6x — which clears the law with room and
       * still reads as a lit stone disc rather than a light source. */
      /* 1.05 -> 1.30, for the same margin reason as the Keep's: verdant-1 cp2
       * measured 3.51:1 and drifted between 3.15 and 3.55 across runs of an
       * unchanged build. At 1.30 the pad reads about [200,197,175] — 1.6x the
       * frame mean, where the blown version this round removed was 2.6x. */
      /* ROUND 5, MEASURED. The lower sun (dir.y 0.44 -> 0.36, so the disc can
       * appear in frame at all) takes key off horizontal decks and puts a little
       * on the vertical faces, and contrastcheck caught exactly that: cp2 fell
       * from 3.52:1 to 2.64:1, deck [177,177,154] over band [110,101,81] — the
       * band at that station being the fort's own lit interior wall. The deck
       * needs about +36 % luminance to clear 3.5:1, and the pad lift is the only
       * term that reaches the deck without also reaching the wall. */
      padGlow: 2.45,
    },

    particles: {
      color: 0xdff0b0,
      ambient: [
        /* ROUND 5. Every ambient sprite here is UNLIT by construction, so its
         * spawn colour is its final screen colour — and all three were authored
         * near-white (0xf4f0a8, 0xdff0c8), which is why the critic measured
         * "flat opaque near-white cards" over the meadow. Pollen and motes are
         * BACKLIT specks, so they keep a bright colour but a much lower rate;
         * the leaf is an object with a shaded side, so it takes a shaded green
         * (see the leaves preset in fx/particles.js). */
        { preset: 'pollen', rate: 14, color: 0xe8d888 },
        { preset: 'leaves', rate: 7, color: 0x6f9440 },
        { preset: 'mote', rate: 5, color: 0xbcd49c },
      ],
    },

    /* The walked STONE is sun-bleached limestone — the bright half of the
     * figure/ground pair. The living surfaces (grass, leaves, moss) keep their
     * own colour; they are the world, not the platforms. Reflective decks give
     * up most of their env mirror, which under a 3.05 key was re-painting
     * every walked top with the pale sky regardless of tint. */
    materialOverrides: {
      stone: { tint: 0xf2e8c8 },
      plaster: { tint: 0xfaf3e2 },
      brick: { tint: 0xe8bc9c },
      panel: { tint: 0xdcd0b0 },
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
      light: 0xffb070, lightCool: 0xffd6a8,
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
      light: 0xffe0b4, lightCool: 0xd8ecff,
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
      light: 0xffe2b0, lightCool: 0xdff2ff,
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
  /* DO NOT CACHE THIS PROBE PER THEME — measured, 2026-09-03, load lane.
   *
   * It looks like free money: `buildEnvCubemap` is ~900 ms of a ~2.2 s WARM
   * course load, a ThemeDef is static data, and the whole game only ever needs
   * five probes. Caching it (plus the engine's own `setEnvironment` bake, which
   * this line overwrites microseconds later) does take `applyTheme` from
   * ~1200 ms to ~1.5 ms. It also makes the load SLOWER overall.
   *
   * `_harness/_warmsplit.py`, verdant-1, three consecutive builds on one box:
   *   both probes cached   applyTheme    1.5 ms · warmup render 2126-2194 ms · load 2816-2839 ms
   *   both probes rebaked  applyTheme ~1200 ms · warmup render  352- 384 ms · load 2094-2251 ms
   * The 19 course-owned programs that die with a course and are rebuilt in
   * `Course.warmup` cost ~19 ms each after the bakes and ~110 ms each without
   * them — the bake is doing something for the shader compiler (a warm GL
   * queue, a clocked-up GPU/CPU, or a shader-cache effect) that is worth more
   * than the bake costs. Cause not isolated; the numbers are reproducible.
   *
   * If you want this 900 ms back, take it by killing the PROGRAM CHURN first
   * (keep the course's material clones alive across a load), then re-measure
   * with _warmsplit.py. Caching alone is a net loss. */
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
