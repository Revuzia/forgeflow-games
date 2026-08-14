/**
 * REALMS — the single source of truth for cold / sand / ash.
 *
 * Plain data and pure helpers, in the style of `src/combat/combatData.js`:
 * ZERO imports, no classes, no state, nothing that touches THREE or the DOM.
 * Everything here is diffable, and every consumer (the terrain re-bake, the sky
 * bake, the weather field, the shell accent, the encounter director) reads the
 * same rows rather than carrying its own copy.
 *
 * =============================================================================
 * WHAT A REALM IS
 *
 * A realm is a RE-BAKE OF THE SAME WORLD, not a new world. `WORLD_SIZE` 2048 m,
 * `HEIGHT_RES` 4096 (`src/terrain/heightfield.js:42,44`), `PLAY_RADIUS` 620 m
 * (`heightfield.js:49`) and the whole clipmap geometry are realm-INVARIANT —
 * that is what lets the deformation toroid, the minimap, the shadow cascade
 * splits and the character grounding survive a swap untouched. What changes is
 * the CONTENT of the three bakes (height, aux, grain), the sky LUT, and about
 * forty uniforms. See `_spec/_build/REALM_CONTRACT.md` §0.
 *
 * =============================================================================
 * PROVENANCE OF EVERY NUMBER
 *
 * Cold is the game as it ships today, so every Cold value below is a
 * TRANSCRIPTION with the `file:line` it lives at quoted in the comment. Sand and
 * Ash are the contract's proposals; they are what a builder types in, and where
 * the contract marked something `[derived]` or `[call]` the comment says so.
 * Three tags are used and they mean exactly what they say:
 *
 *   (no tag)     transcribed from the cited file:line, unchanged
 *   [derived]    arithmetic on transcribed values, with the arithmetic shown
 *   [call]       a design decision with no measurement behind it
 *   [fallback]   a value that is never read in this realm (the feature is off)
 *                but is present so the schema is symmetric and no uniform can
 *                land as undefined/NaN if an operator force-enables the feature
 *
 * THE SCHEMA IS SYMMETRIC BY CONTRACT. Every key present on one realm is
 * present on all three, at the same path, with the same type. `_harness`
 * probes assert exactly that, and `realmSchemaDiff()` below is the assertion
 * in code — a swap that reads a key only Cold has is the failure mode this
 * file exists to make impossible.
 *
 * =============================================================================
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 *
 *  - It does not import `src/combat/roster.js`. The enemy roster is referenced
 *    BY REALM TOKEN (`rosterToken`, a string), which is the key into that
 *    module's `BY_REALM` map (`roster.js:605`). Bodies load per realm — 2.961 /
 *    2.731 / 2.748 MiB against a 3.0 MiB budget (`roster.js:50-51`) — and a
 *    static import here would put all three realms' data on the boot path of a
 *    module the shell reads before anything else.
 *  - It does not import `src/core/settings.js`. `realmSettings()` RETURNS a
 *    patch object; the caller writes it through `set()` so the `onChange` edges
 *    fire. A module that wrote `S` directly would bypass every listener.
 *  - It performs no re-bakes. `rebakePlan()` returns the ordered list of steps a
 *    swap needs; each step is separately callable by the integrator, which is
 *    what keeps the free uniform writes out of the stalling GPU work.
 */

/* ------------------------------------------------------------------ *
 * Order and progression
 * ------------------------------------------------------------------ */

/** Play order. `progression.js:171` boots `realmsUnlocked = ["cold"]`. */
export const REALM_ORDER = ["cold", "sand", "ash"];

/** The default / boot realm. */
export const DEFAULT_REALM = "cold";

/* ------------------------------------------------------------------ *
 * REALMS — the §1 parameter table
 * ------------------------------------------------------------------ */

/**
 * @typedef {typeof REALMS.cold} RealmRow
 */
export const REALMS = {

    // =====================================================================
    // COLD — the game as it ships today. Every value transcribed.
    // =====================================================================
    cold: {
        token: "cold",
        name: "Cold",
        label: "The Rime Shelf",
        order: 0,
        /** Next realm in the chain; null at the end. */
        next: "sand",

        /** Shell / HUD / crosshair accent. `main.js:874-876`. */
        accent: {
            ink: "#04141d", hi: "#cdefff", lo: "#6cc3ea",
            edge: "#a8dcf5", glow: "rgba(120,205,245,.40)",
        },

        // ------------------------------------------------- §1g band + roster
        /** `combatData.js:645` SCALING.bands.cold. */
        band: [1, 10],
        /** `encounters.js:95` ALIVE_CAP.cold. */
        aliveCap: 6,
        /** Key into `roster.js:605` BY_REALM. A STRING, never an import. */
        rosterToken: "cold",
        /** 10 bodies, 2.961 MiB — `assets/enemies/manifest.json` per the contract §1g. */
        meshBudgetMiB: 2.961,
        /** Spell-set token. The 18 identities live in the D1 spell contract; this
         *  is the selector the spell system keys its per-realm uniform swap on. */
        spellSet: "frost",

        bosses: {
            /** `roster.js:144` bossKey `glacierIcewall`, arena 1200 on #02 Glacier
             *  Brute. `roster.js:142`: "MINIBOSS The Icewall 1200 — mid-realm;
             *  does NOT open Sand." combatData's cold miniboss row is
             *  `shrinebreaker` hp 760 (`combatData.js:544-546`) — see the note on
             *  `realmBoss` below; the two disagree and the roster is right. */
            miniboss: { key: "glacierIcewall", bodySlug: "02_cold_glacier_brute",
                arenaHp: 1200, arenaStance: 160 },
            /** ⚑ RECONCILIATION FINDING (contract §5.3). combatData.js gives Cold's
             *  realmBoss to `moraineElder` / base `moraineColossus`
             *  (`combatData.js:554-556`, hp 2000, fixedLevel 10) — and
             *  `assets/enemies/manifest.json` HAS NO `moraineColossus` MESH, so as
             *  the tree stands that boss is unrenderable and the realm gate would
             *  fire on a body the player can never see.
             *  `roster.js:216,218` is the authority: the Cold realm boss is the
             *  Frost Golem (mesh #61, `61_v3_cold_frost_golem.glb`), bossKey
             *  `shrinebreaker`, arenaHp 2000, "Kill opens Sand."
             *  `roster_reconciled.json:4468` on Moraine: "Design park only — Sand
             *  gate is #61 Frost Golem / Shrinebreaker".
             *  THIS FILE ENCODES THE ROSTER'S ANSWER. Correcting `combatData.js`'s
             *  BOSSES row is a data change outside this module's write scope and is
             *  reported, not made. */
            realmBoss: { key: "shrinebreaker", bodySlug: "61_v3_cold_frost_golem",
                arenaHp: 2000, arenaStance: 0, fixedLevel: 10,
                /** `roster_reconciled.json:4960-4967`: ttkAtL10_s 74.9, verdict
                 *  "OUTLIER - over 60 s at the L10 anchor". [derived] 2000 × 60/74.9
                 *  = 1602 → recommend 1600. NOT applied here: it is a combatData
                 *  number and the recommendation is reported, not taken. */
                recommendedArenaHp: 1600, ttkAtL10s: 74.9 },
        },

        // ---------------------------------------------------------- §1a sky
        sky: {
            sunAzimuth: 118,            // settings.js:48
            sunElevation: 13.0,         // settings.js:52
            sunIntensity: 4.2,          // settings.js:53  (× SUN_SCALE_BASE 5.5, sky.js:76)
            sunTempWarm: 1.0,           // settings.js:54
            ambientIntensity: 1.0,      // settings.js:55
            ambientBlue: 1.0,           // settings.js:56 — declared, NOT read by the sky
            showMountains: true,        // settings.js:70
            mountainHeight: 2150,       // settings.js:72
            shaftStrength: 0.30,        // settings.js:74
            cloudAmount: 0.55,          // sky.js:263 — hard-coded there today
            cirrusColor: [0.52, 0.60, 0.74],          // sky.glsl.js:660
            // Bake constants — hard-coded in skyBake.glsl.js today; the contract
            // §6 Builder B turns each into a bake-pass uniform.
            betaMie: [21e-6, 21e-6, 21e-6],           // skyBake.glsl.js:52
            mieG: 0.76,                               // skyBake.glsl.js:54
            betaRayleigh: [5.8e-6, 13.5e-6, 33.1e-6], // skyBake.glsl.js:51
            hMie: 1200,                               // skyBake.glsl.js:46 — aerosol scale height, m
            msBoost: 1.5,                             // skyBake.glsl.js:58
            /**
             * BEAM EXTINCTION, relative to Cold — the aerosol the bake does not
             * carry yet, folded onto the beam by `sky.js` `applyRealm()`.
             *
             * `sunIntensity` above is a PRE-extinction number: a realm with heavy
             * aerosol is given a stronger sun precisely because it eats most of
             * its own beam. Until `betaMie` / `hMie` are real bake uniforms
             * (§6 Builder B) nothing eats it, and the ratio alone would make Ash
             * the BRIGHTEST realm. This is that missing factor, from the optical
             * depth beta_M x H_Mie crossed at the sun's air mass:
             *
             *   cold  21e-6 x 1200 = 0.0252, air mass 4.30 at 13.0 deg -> 0.897
             *   sand  73e-6 x  900 = 0.0657, air mass 2.65 at 22.0 deg -> 0.840
             *   ash  133e-6 x 2600 = 0.346,  air mass 5.60 at  9.5 deg -> 0.144
             *
             * relative to Cold: 1.0 / 0.936 / 0.161. [derived] Cold is the
             * identity by construction. DELETE this field the day the bake takes
             * betaMie/hMie as uniforms — it exists only because it does not.
             */
            beamExtinction: 1.0,
            grazeTint: [0.97, 1.0, 1.06],             // skyBake.glsl.js:252
            /** Feeds `_updateGroundBounce()` (sky.js:498-502) → the nadir rows of
             *  the LUT → skyIrradiance everywhere. Cold's blue-weighted bounce is
             *  the single largest source of blue in the frame. sky.js:79. */
            groundAlbedo: [0.83, 0.86, 0.91],
            farSnowAlbedo: [0.855, 0.885, 0.945],     // sky.glsl.js:541
            farRockAlbedo: [0.052, 0.055, 0.066],     // sky.glsl.js:540
            farSnowLineGate: [0.46, 0.80],            // sky.glsl.js:538 smoothstep(lo, hi, steep)
        },

        // ------------------------------------------------------- §1b ground
        ground: {
            albedo: [0.855, 0.885, 0.945],  // snow.glsl.js:342 — B/R ratio 1.105
            roughness: 0.62,                // snow.glsl.js:343
            f0: 0.028,                      // snow.glsl.js:344
            thickness: 1.0,                 // snow.glsl.js:345
            sssShallow: [0.94, 0.965, 1.0], // shading.glsl.js:212 (also sky.glsl.js:264)
            sssDeep: [0.55, 0.72, 1.0],     // shading.glsl.js:213 (also sky.glsl.js:265)
            /** shading.glsl.js:22-25 calls this term "doing most of the work of
             *  making this read as snow at all" — the single biggest not-snow lever. */
            sssStrength: 1.0,               // settings.js:79
            sssRadius: 1.0,                 // settings.js:80
            caveTint: [0.55, 0.72, 1.0],    // snow.glsl.js:541, wake.glsl.js:346
            /** [loose, compressed] ends of mix(0.62, 0.15, max(compression,
             *  rockExposed)) — snow.glsl.js:434. Snow's mean free path is
             *  millimetres so light wraps past the terminator (shading.glsl.js:173-176). */
            wrapAmount: [0.62, 0.15],
            bounceCoef: 0.28,               // snow.glsl.js:473
            compressCol: [0.62, 0.665, 0.755], // snow.glsl.js:348, mixed at ×0.85
            compressRough: 0.34,            // snow.glsl.js:349
            compressThick: 0.35,            // snow.glsl.js:350
            /** The "ice" channel. Repurposed per realm, never removed: SSR is
             *  gated on `deform.iceEverBrushed` (deformation.js:148). */
            iceCol: [0.42, 0.56, 0.70],     // snow.glsl.js:353, at ×0.8
            iceRough: 0.07,                 // snow.glsl.js:354
            iceF0: 0.045,                   // snow.glsl.js:355
            iceThick: 0.15,                 // snow.glsl.js:356
            /** Berm colour. Invariant (_spec/snow-shading.md:735): a berm must read
             *  brighter than the surround and must not read warmer or greyer. */
            looseCol: [0.895, 0.920, 0.965], // snow.glsl.js:391, at ×0.55
            looseRough: 0.78,               // snow.glsl.js:392
            rockColA: [0.055, 0.058, 0.068], // snow.glsl.js:363
            rockColB: [0.115, 0.112, 0.118], // snow.glsl.js:363
            rockGate: [0.32, 0.66],         // snow.glsl.js:360 smoothstep(lo, hi, 1 - N.y)
            wakeAlbedo: [0.895, 0.920, 0.965], // wake.glsl.js:221 — tracks looseCol
            wakeRough: 0.80,                // wake.glsl.js:222
        },

        // --------------------------------------------------- §1b grain map
        /** 1024² RGBA8, three tiling scales. Cold's grain is "a jam of rounded
         *  crystals with deep, dark crevices between them — spheres, not noise
         *  bumps" (detailBake.glsl.js:44-46). */
        grain: {
            cells: [26, 61, 137],           // detailBake.glsl.js:79-81
            heightWeights: [1.0, 0.42, 0.17], // detailBake.glsl.js:83
            cavityWeights: [0.55, 0.30, 0.15], // detailBake.glsl.js:84
            /** [base, jitter] of `0.30 + r2.x * 0.26` — detailBake.glsl.js:66. */
            radius: [0.30, 0.26],
            /** Dome profile selector. 0 = sqrt(1 - d*d), the spherical cap at
             *  detailBake.glsl.js:67. 1 = pow(1 - d*d, 0.72). 2 = 1 - d*d*d. */
            domeMode: 0,
            /** `1 - (1-d)*X` — detailBake.glsl.js:69. */
            cavityDepth: 0.5,
            grainScale: 0.013,              // terrain.js:78 GRAIN_SCALE
            detailScales: [7.5, 1.7, 0.31], // snow.glsl.js:310,315,320 — m⁻¹
        },

        // ------------------------------------------------ §1b micro-relief
        /** Sastrugi. The STRUCTURE (which noise, which windMat sx/sy, ridge-up vs
         *  crack-down) is a shader branch selected by `mode` in BOTH twins of
         *  lib/terrain.glsl.js — `terrainFine()` :264-313 and
         *  `terrainFineFiltered()` :328-373, which "must produce the same surface"
         *  (terrain.glsl.js:243-245). Only the numbers below cross as data. */
        fine: {
            /** 0 sastrugi · 1 dune ripples · 2 crust cracks. Becomes `uFineMode`. */
            mode: 0,
            amplitude: 0.125,               // terrain.glsl.js:282
            exposureFade: [0.45, 1.0],      // terrain.glsl.js:282 mix(lo, hi, exposure)
            scourFreq: 0.021,               // terrain.glsl.js:281 noise2(p * f)
            fragFade: [0.35, 1.6],          // terrain.glsl.js:339 1 - smoothstep(lo, hi, fp)
            /** windMat(w + wl.x, sx, sy, scale) — terrain.glsl.js:279. Cold's
             *  sx = 1.0 ALONG the wind, sy = wl.y ∈ [2.3, 4.7] ACROSS it
             *  (terrain.glsl.js:253), so the ridges streak along the wind. */
            primaryScale: 2.3,
            rippleAmp: 0.024,               // terrain.glsl.js:297
            rippleScale: 0.42,              // terrain.glsl.js:295 windMat(..., 0.42)
            grainAmp: 0.0075,               // terrain.glsl.js:306
            grainWindScale: 0.115,          // terrain.glsl.js:304
        },

        // ----------------------------------------------------- §1b sparkle
        /** snowGlints() — shading.glsl.js:293-337, called from snow.glsl.js:514-519.
         *  Cold's sparkle is SPECULAR; Sand's is specular-but-wider; Ash's is
         *  EMISSIVE (an ember in the shade still glows). */
        glint: {
            cells: [0.052, 0.185],          // shading.glsl.js:323,329
            sharpness: [780.0, 1500.0],     // shading.glsl.js:326,332
            /** Facet survival cull: `r2.x > X` rejects. shading.glsl.js:265. */
            facetCull: 0.62,
            /** [base, jitter] of `0.10 + r2.y * 0.26` — shading.glsl.js:277. */
            facetTilt: [0.10, 0.26],
            intensity: 0.55,                // settings.js:77
            grazing: 0.72,                  // settings.js:78
            /** [derived] mix(1.5, 5.0, grazing) — shading.glsl.js:309. */
            grazingExp: 4.02,
            tint: [1.0, 1.0, 1.0],          // implicit today: sunRadiance * g * shadow
            /** 0 = specular (sunRadiance × shadow). > 0 = emissive: NO sunRadiance,
             *  NO shadow, NdotL gate bypassed. snow.glsl.js:518, :511-513. */
            emissive: 0.0,
        },

        // ---------------------------------------------------------- §1c fog
        /** One vec4 shared by every material that includes lib/atmosphere
         *  (atmosphere.glsl.js:110), written every frame by Sky.update()
         *  (sky.js:414-416). Weather SCALES these; it does not replace them. */
        fog: {
            density: 0.0072,                // settings.js:59  — /m
            heightFalloff: 0.045,           // settings.js:60  — /m
            /** [derived] 1/heightFalloff = 22.2 m — stated at atmosphere.glsl.js:214. */
            scaleHeightM: 22.2,
            start: 24,                      // settings.js:61  — m
            aerialStrength: 1.0,            // settings.js:62  — exponent on transmittance
            nearSkyTilt: 0.42,              // atmosphere.glsl.js:246
            nearSkyMip: 3.0,                // atmosphere.glsl.js:247
            forwardG: 0.62,                 // atmosphere.glsl.js:274 phaseMie(mu, g)
            forwardGain: 5.5,               // atmosphere.glsl.js:274
            forwardMix: 0.16,               // atmosphere.glsl.js:275
        },

        // --------------------------------------------------------- §1d wind
        /** HARD CONSTRAINT (settings.js:64-66): `windDirection` is held 70-80°
         *  away from `sunAzimuth`, because sastrugi ridges run along the wind and
         *  when the two align the sun rakes down every ridge, lights both flanks
         *  identically and the fine structure reads as flat ground. All three
         *  realms hold exactly 76°. Any edit to sunAzimuth MUST move this with it;
         *  `sunSeparation()` below is the check. */
        wind: {
            direction: 42,                  // settings.js:67 — compass degrees
            strength: 1.0,                  // settings.js:68
            sastrugiStrength: 1.0,          // settings.js:83
            macroHeightScale: 1.0,          // settings.js:82
        },

        // ------------------------------------------------------ §1e weather
        /** Blizzard / snowfall. Consumed by `src/vfx/weather.js`. The fog boost is
         *  what actually sells the storm: 3072 flakes over a 140 m box is one
         *  flake per 285 m³, which is a light flurry — the FOG is the blizzard
         *  (REALM_CONTRACT §3.2, "Fog / visibility coupling"). */
        weather: {
            /** 0 blizzard · 1 sandstorm · 2 ember-fall. Diagnostic/branch selector. */
            mode: 0,
            fallSpeed: 1.6,                 // m/s, + is down
            /** The alternate (index-hashed) population. Cold has none, so it
             *  matches `fallSpeed` and `altFrac` is 0 — one draw either way. */
            fallSpeedAlt: 1.6,
            altFrac: 0.0,
            /** × the spray's own `2.4 * S.windStrength` base (particles.js:363-364),
             *  so the storm, the plume, the cloth, the fur, the sastrugi and the
             *  cirrus all stay in one register. */
            windGain: 1.00,
            gustAmp: 0.45,
            box: [140, 46, 140],            // m — spawn box, centred on the camera
            /** [fine, coarse, glow] billboard RADIUS in metres. Cold has no glow
             *  layer, so its glow radius is 0. */
            radius: [0.012, 0.028, 0.0],
            alpha: [0.30, 0.42, 0.0],
            tint: [0.94, 0.96, 1.00],
            glowTint: [1.0, 1.0, 1.0],      // [fallback] — no glow layer in Cold
            glowEmissive: 0.0,
            /** [call] Population split [fine, coarse, glow]; must sum to 1. The
             *  contract specifies "two hash bits off the index select fine /
             *  coarse / glow" but not the mix. */
            kindMix: [0.62, 0.38, 0.0],
            /** Velocity-stretch ceiling. At 19.5 m/s (surfWake.js:95 top speed)
             *  [derived] k = 1 + 0.9 × 20/8 = 3.25, so a 0.012 m flake draws as a
             *  0.012 × 0.039 m streak; standing still k → 1 and it is a round
             *  flake. That term is the difference between weather and confetti. */
            stretchClamp: 6.0,
            /** Multiplier folded into S.fogDensity. [derived] ×1.90 takes 0.0072
             *  to 0.0137, which halves visible range across the whole frame. */
            fogBoost: 1.90,
            /** Multiplier on S.fogHeightFalloff. Left at 1 for all three: the
             *  falloff INVERSION (dust settles, smoke rises) is already realm
             *  data in `fog.heightFalloff`, and boosting it too would double-count. */
            fogFalloffBoost: 1.0,
            /** Dust devils. Cold and Ash 0, which returns the reserved lattice
             *  indices to the sheet. */
            devils: 0,
            /** Lighting of the flake itself. Mirrors the realm's spray numbers
             *  (§1f) so airborne snow reads the same whether the wake threw it or
             *  the sky did. */
            wrap: 0.75,                     // mirrors spray wrap, spray.glsl.js:193
            phaseG: 0.55,                   // mirrors spray.glsl.js:206
            phaseGain: 0.85,                // mirrors spray.glsl.js:206
        },

        // ------------------------------------------------- §1f ambient VFX
        /** The spray pool, the speed streaks and the post chain — what every
         *  realm's spells share. Per-spell FX colours belong to the D1 contract. */
        vfx: {
            sprayAlbedo: [0.92, 0.94, 0.98], // spray.glsl.js:192
            sprayWrap: 0.75,                // spray.glsl.js:193 wrapDiffuse(dot(N,L), w)
            sprayForwardG: 0.55,            // spray.glsl.js:206 phaseMie(mu, g)
            sprayForwardGain: 0.85,         // spray.glsl.js:206
            sprayEdgeAlpha: [0.36, 0.55],   // spray.glsl.js:172 mix(a, b, kind)
            streakTint: [0.88, 0.94, 1.06], // post/tonemap.glsl.js:158
            streakAmount: 0.16,             // post/tonemap.glsl.js:158
            /** settings.js:124-126: picked because "sunlit snow here sits around 12
             *  in linear, and at this exposure it lands near AgX normalised 0.79,
             *  where the curve's slope is 0.09 per stop." */
            exposure: 0.105,                // settings.js:126
            contrast: 1.14,                 // settings.js:127
            bloomStrength: 0.22,            // settings.js:129
        },
    },

    // =====================================================================
    // SAND — proposals from REALM_CONTRACT §1. Nothing here is measured
    // against a running Sand build, because none exists yet.
    // =====================================================================
    sand: {
        token: "sand",
        name: "Sand",
        label: "The Sundered Gate",
        order: 1,
        next: "ash",

        /** [call] The Cold accent's structure, rotated to a low warm ochre. */
        accent: {
            ink: "#1d1405", hi: "#ffeccd", lo: "#eac06c",
            edge: "#f5dca8", glow: "rgba(245,205,120,.40)",
        },

        band: [8, 20],                      // combatData.js:645
        aliveCap: 8,                        // encounters.js:95
        rosterToken: "sand",                // roster.js:605
        meshBudgetMiB: 2.731,
        spellSet: "grit",

        bosses: {
            /** combatData.js:563-565 — hp 1500, stance 220, on base `duneBrute`. */
            miniboss: { key: "gatekeeperOfBrass", bodySlug: "12_sand_dune_brute",
                arenaHp: 1500, arenaStance: 220 },
            /** combatData.js:571-573 and roster.js:334 AGREE here (unlike Cold):
             *  duneWarden, hp 2400, fixedLevel 20, on #50 Dune Warden. */
            realmBoss: { key: "duneWarden", bodySlug: "50_v2_sand_dune_warden",
                arenaHp: 2400, arenaStance: 220, fixedLevel: 20,
                /** In-guard already: roster_reconciled has Gatekeeper at 56.2 s
                 *  against the 60 s anchor, so no reduction is recommended. */
                recommendedArenaHp: 2400, ttkAtL10s: null },
        },

        sky: {
            /** [derived] |206 − 130| = 76 — holds the settings.js:64-66 constraint. */
            sunAzimuth: 206,
            /** Higher, or dune slip-faces read as one flat ochre sheet. */
            sunElevation: 22.0,
            sunIntensity: 5.4,
            /** 0.72 keeps the higher sun from going orange; sunTempWarm only scales
             *  the Rayleigh half of the beam attenuation (sky.js:394-396). */
            sunTempWarm: 0.72,
            /** Sand's bright ground bounces hard. */
            ambientIntensity: 1.15,
            ambientBlue: 1.0,               // not read by the sky; left alone
            showMountains: true,
            mountainHeight: 1750,           // eroded plateau range, lower and flatter
            shaftStrength: 0.22,
            cloudAmount: 0.12,              // almost no cirrus — dust does that job
            cirrusColor: [0.72, 0.63, 0.50],
            /** Dust is MIE, not Rayleigh. This single change is what stops Sand
             *  reading as "Cold with a colour grade". */
            betaMie: [78e-6, 74e-6, 66e-6],
            /** Bigger particles scatter harder forward → a huge sun-side aureole,
             *  which is the sandstorm read. */
            mieG: 0.84,
            betaRayleigh: [5.8e-6, 13.5e-6, 33.1e-6],  // unchanged from Cold
            /** THE INVERSION THAT MATTERS: dust settles, so a SHALLOWER aerosol
             *  scale height than Cold's 1200 m. Ash goes the other way. */
            hMie: 900,
            msBoost: 1.5,
            /** [derived] exp(-0.0657 x 2.65) / cold's 0.897 = 0.936 — see the
             *  cold row. Sand's higher sun (air mass 2.65 against 4.30) very
             *  nearly pays for its own thicker aerosol, so the beam barely
             *  dims and the realm reads BRIGHT and hazy rather than dark. */
            beamExtinction: 0.936,
            grazeTint: [1.06, 1.00, 0.90],
            /** [derived] mean 0.437; the bounce solve compounds by ~albedo³
             *  (sky.js:448-452, 497-502), so 0.0835 against Cold's 0.652. */
            groundAlbedo: [0.55, 0.45, 0.31],
            farSnowAlbedo: [0.60, 0.50, 0.36],
            farRockAlbedo: [0.19, 0.155, 0.115],
            /** Sand sheds off steeper faces than snow does. */
            farSnowLineGate: [0.30, 0.62],
        },

        ground: {
            /** [derived] B/R ratio 0.556 against Cold's 1.105 — the ratio inversion
             *  is the point, not the hue. */
            albedo: [0.620, 0.505, 0.345],
            roughness: 0.86,
            f0: 0.035,                      // quartz > ice
            thickness: 0.45,                // sand transmits a little at a dune lip
            sssShallow: [1.0, 0.96, 0.86],
            sssDeep: [0.92, 0.66, 0.38],
            sssStrength: 0.18,
            sssRadius: 0.55,
            caveTint: [0.82, 0.62, 0.42],   // a sand hollow goes warm-brown
            wrapAmount: [0.24, 0.10],       // sand has a hard terminator
            bounceCoef: 0.16,
            compressCol: [0.44, 0.355, 0.235], // packed sand darkens and warms
            compressRough: 0.52,
            compressThick: 0.20,
            iceCol: [0.74, 0.62, 0.40],     // the ice channel becomes fulgurite / glassed sand
            iceRough: 0.11,
            iceF0: 0.050,
            iceThick: 0.10,
            looseCol: [0.700, 0.585, 0.415],
            looseRough: 0.90,
            rockColA: [0.30, 0.24, 0.17],
            rockColB: [0.42, 0.34, 0.24],
            rockGate: [0.22, 0.52],         // sand slides off shallower faces than snow
            wakeAlbedo: [0.700, 0.585, 0.415],
            wakeRough: 0.90,
        },

        /** Sand's grains are SMALLER, FLATTER, HARDER-EDGED — quartz sand is
         *  sub-angular and packs tighter than snow. */
        grain: {
            cells: [44, 103, 221],
            heightWeights: [1.0, 0.55, 0.30],
            cavityWeights: [0.42, 0.34, 0.24],
            radius: [0.22, 0.18],
            domeMode: 1,                    // pow(1 - d*d, 0.72) — flatter, sub-angular
            cavityDepth: 0.34,
            grainScale: 0.021,
            detailScales: [11.0, 2.4, 0.44],
        },

        /** DUNE RIPPLES. Real aeolian ripples run TRANSVERSE — crests
         *  perpendicular to the flow — which is the exact opposite of sastrugi, so
         *  mode 1's windMat has sx/sy SWAPPED against Cold's.
         *  ⚑ SAND'S ACCEPTANCE CRITERION IS THE NEGATION OF COLD'S: in a Sand
         *  screenshot the broad dune ridges and the fine ripples MUST run the same
         *  way. terrain.glsl.js:19-23 states the Cold invariant that this inverts;
         *  write it in the shot notes or the first reviewer files it as a bug. */
        fine: {
            mode: 1,
            amplitude: 0.055,
            exposureFade: [0.30, 1.0],
            scourFreq: 0.021,
            /** [derived] Cold's ratios rescaled to the new wavelength so filtering
             *  behaves identically: 0.35/2.3 = 0.152, 1.6/2.3 = 0.696;
             *  0.9 × 0.152 = 0.137 ≈ 0.14 and 0.9 × 0.696 = 0.626 ≈ 0.62. */
            fragFade: [0.14, 0.62],
            primaryScale: 0.9,
            rippleAmp: 0.011,
            rippleScale: 0.17,
            grainAmp: 0.0042,
            grainWindScale: 0.070,
        },

        /** MICA. Flat cleavage planes: rarer, wider, softer than snow glints. */
        glint: {
            cells: [0.100, 0.340],
            sharpness: [260.0, 520.0],
            facetCull: 0.86,
            facetTilt: [0.06, 0.15],
            intensity: 0.30,
            grazing: 0.25,
            grazingExp: 2.375,              // [derived] mix(1.5, 5.0, 0.25)
            tint: [1.00, 0.94, 0.74],       // pale gold
            emissive: 0.0,                  // still specular: sunRadiance × shadow
        },

        fog: {
            density: 0.0115,
            /** THE INVERSION: dust settles, so a STEEPER falloff than Cold's. */
            heightFalloff: 0.070,
            /** [derived] 1/0.070 = 14.3 m — the haze sits below the dune crests. */
            scaleHeightM: 14.3,
            start: 18,
            aerialStrength: 1.15,
            nearSkyTilt: 0.30,
            nearSkyMip: 3.0,
            forwardG: 0.80,
            forwardGain: 7.5,
            forwardMix: 0.22,
        },

        wind: {
            direction: 130,                 // [derived] |206 − 130| = 76 ✓
            strength: 1.45,
            sastrugiStrength: 1.35,
            macroHeightScale: 1.25,
        },

        /** SANDSTORM / DUST DEVILS. */
        weather: {
            mode: 1,
            fallSpeed: 0.35,                // grit barely falls; the wind carries it
            fallSpeedAlt: 0.35,
            altFrac: 0.0,
            windGain: 2.60,
            gustAmp: 0.70,
            box: [150, 40, 150],
            radius: [0.008, 0.020, 0.0],
            alpha: [0.26, 0.38, 0.0],
            tint: [0.74, 0.63, 0.44],
            glowTint: [1.0, 1.0, 1.0],      // [fallback] — no glow layer in Sand
            glowEmissive: 0.0,
            kindMix: [0.70, 0.30, 0.0],     // [call] — finer-weighted than Cold
            stretchClamp: 6.0,
            fogBoost: 2.40,
            fogFalloffBoost: 1.0,
            /** Three devils, placed helically in the LAST reserved lattice indices
             *  so they cost zero extra draw calls (REALM_CONTRACT §3.2). Marked
             *  [call] there: shipping with 0 is a valid fallback and needs no
             *  structural change. */
            devils: 3,
            wrap: 0.55,                     // mirrors §1f sand spray wrap
            phaseG: 0.68,
            phaseGain: 1.10,
        },

        vfx: {
            sprayAlbedo: [0.72, 0.62, 0.46],
            sprayWrap: 0.55,
            sprayForwardG: 0.68,
            sprayForwardGain: 1.10,
            sprayEdgeAlpha: [0.30, 0.50],
            streakTint: [1.04, 0.94, 0.78],
            streakAmount: 0.20,
            /** [derived] mean albedo 0.490 against Cold's 0.895 = 1.83× darker,
             *  so naïvely 0.105 × 1.83 = 0.192; 0.170 lands close, the rest coming
             *  back from the brighter sky. */
            exposure: 0.170,
            contrast: 1.10,
            bloomStrength: 0.18,
        },
    },

    // =====================================================================
    // ASH — proposals from REALM_CONTRACT §1.
    // =====================================================================
    ash: {
        token: "ash",
        name: "Ash",
        label: "The Volcanic Plate",
        order: 2,
        /** End of the chain. `nextRealm("ash")` returns null. */
        next: null,

        /** [call] The Cold accent's structure, rotated to cinder. */
        accent: {
            ink: "#1d0a04", hi: "#ffd3cd", lo: "#ea7a4c",
            edge: "#f5b3a0", glow: "rgba(245,140,90,.42)",
        },

        band: [18, 30],                     // combatData.js:645
        aliveCap: 8,                        // encounters.js:95
        rosterToken: "ash",                 // roster.js:605
        meshBudgetMiB: 2.748,
        spellSet: "cinder",

        bosses: {
            /** combatData.js:579-581 — hp 2200, stance 260. */
            miniboss: { key: "furnaceGuardian", bodySlug: "88_v3_ash_furnace_guardian",
                arenaHp: 2200, arenaStance: 260 },
            /** combatData.js:588-590 and roster.js:484 AGREE: volcanicPlateKnight,
             *  hp 3000, fixedLevel 30, on #86. The finale — `next` is null, so no
             *  unlock fires on this kill. */
            realmBoss: { key: "volcanicPlateKnight", bodySlug: "86_v3_ash_volcanic_plate_knight",
                arenaHp: 3000, arenaStance: 300, fixedLevel: 30,
                recommendedArenaHp: 3000, ttkAtL10s: null },
        },

        sky: {
            sunAzimuth: 74,                 // [derived] |74 − 150| = 76 ✓
            /** Lower, so the smoke column is lit edge-on. 9.5 → 11.0 (owner
             *  2026-08-13 readability round): at 9.5° the camera-side dune
             *  faces were fully shadowed almost everywhere; 11° keeps the
             *  ember-lit low sun while shrinking the pure-shadow fraction. */
            sunElevation: 11.0,
            /** Higher pre-extinction, because Ash's beam is eaten by Mie below. */
            sunIntensity: 5.6,
            sunTempWarm: 1.0,
            /** Ash's near-black ground bounces almost nothing. Raised 0.80 →
             *  1.15 with the exposure (owner 2026-08-10: the shadow floor sat
             *  at pure black), then 1.15 → 1.40 (owner 2026-08-13, second
             *  complaint: measured shadow-floor p10 was 0.4–3.7/255). The
             *  ambient is realm-tinted, so the lift stays sooty rather than
             *  turning the hollows blue. */
            ambientIntensity: 1.50,
            ambientBlue: 1.0,
            /** The far range is buried in smoke at fogDensity 0.0155 anyway, and
             *  switching it off buys back the 8.27 ms the raymarch costs
             *  (settings.js:300-305 — 93% of the sky draw). */
            showMountains: false,
            mountainHeight: 0,
            /** God rays through smoke ARE the look of this realm. 0.55 →
             *  0.85 (owner 2026-08-13 readability round): the playable views
             *  here are contre-jour into the low sun, so every visible dune
             *  face is sun-away — the shafts are the additive fill that
             *  reaches those faces without brightening the sun side. */
            shaftStrength: 0.85,
            /** A soot ceiling. 0.85 → 0.72 (owner 2026-08-13): at 0.85 the
             *  ceiling kept drifting across the low sun and swung the whole
             *  frame's light ±5% minute to minute — the readability measure
             *  flickered around its bar on cloud luck alone. 0.72 still
             *  reads as a ceiling; the frame stops gambling on it. */
            cloudAmount: 0.72,
            cirrusColor: [0.20, 0.18, 0.17],
            /** Soot is Mie. The largest coefficients of the three. */
            betaMie: [150e-6, 132e-6, 118e-6],
            mieG: 0.88,
            /** −20% so the blue dome cannot survive above the soot. */
            betaRayleigh: [4.6e-6, 10.8e-6, 26.5e-6],
            /** THE OTHER HALF OF THE INVERSION: smoke is buoyant, so a DEEPER
             *  aerosol scale height than Cold's 1200 m. */
            hMie: 2600,
            /** Multiple scattering is what fills Cold's shadows blue
             *  (skyBake.glsl.js:189-205). Ash originally ran 1.15 for dark
             *  shadows, but 1.15 + contrast 1.22 together crushed the shadow
             *  floor to p10 0.4–3.7/255 (owner 2026-08-13, second complaint).
             *  1.5 matches Cold/Sand; the fill is realm-tinted, so the
             *  hollows lift sooty-orange, not blue — the "dark shadows" read
             *  now comes from the low ground albedo alone. */
            msBoost: 1.5,
            /**
             * [derived] mean betaMie 133e-6 x hMie 2600 = 0.346 optical depth,
             * crossed at air mass 5.24 (11.0 deg) -> exp(-1.81) = 0.163, which
             * is 0.182 of Cold's 0.897 (re-derived with the 2026-08-13
             * sunElevation change; the 9.5 deg number was 0.161).
             * THE PHYSICAL NUMBER, not a tempered one:
             * `sky.js` used to run Ash at 0.45 because `S.exposure` was Cold's
             * 0.105 everywhere and 0.161 rendered near-black. `vfx.exposure`
             * 0.300 below is what pays for it now — 2.86x Cold's, against a beam
             * 6.2x weaker. Ash is lit by what glows in it, not by its sun.
             */
            beamExtinction: 0.182,
            grazeTint: [1.02, 0.96, 0.92],
            /** [derived] mean 0.071; the bounce solve compounds by ~albedo³, so
             *  0.00036 against Cold's 0.652 — a factor of ~1800 in how much the
             *  ground lights the sky. That is the mechanism that makes an ash
             *  plain feel like a pit rather than a bright field. Re-derived
             *  +25% with the ground rows (owner 2026-08-13 readability cap):
             *  the bounce solve must see the albedo the terrain actually
             *  renders, or the SH lies about the ground. */
            groundAlbedo: [0.094, 0.088, 0.085],
            /** [fallback] — `showMountains: false`, so the far range never
             *  rasterises. Set to the ash ground/rock values rather than left as
             *  Cold's so that force-enabling the range from the overlay produces a
             *  dark horizon rather than a snowline. */
            farSnowAlbedo: [0.082, 0.076, 0.074],
            farRockAlbedo: [0.030, 0.028, 0.028],
            /** [fallback] mirrors `ground.rockGate` — ash sticks to almost nothing. */
            farSnowLineGate: [0.10, 0.34],
        },

        ground: {
            /** [derived] B/R ratio 0.902 — held. The magnitude carries the
             *  +25% readability cap (owner 2026-08-13) like the loose/rock
             *  rows below: measured base [0.082,0.076,0.074]. */
            albedo: [0.102, 0.095, 0.092],
            roughness: 0.93,
            f0: 0.040,                      // slag glass > quartz
            thickness: 0.12,                // ash transmits nothing
            /** Ash's "transmission" is a cinder GLOW, not translucency. */
            sssShallow: [1.0, 0.72, 0.46],
            sssDeep: [0.55, 0.19, 0.08],
            sssStrength: 0.10,
            sssRadius: 0.30,
            /** Was [0.34,0.24,0.20] "an ash hollow goes nearly black" — but the
             *  grain cavity channel (cavityWeights 0.70, cavityDepth 0.78)
             *  multiplies this into EVERY micro-crevice, and the product read
             *  as black lace across the whole near field (owner 2026-08-13,
             *  second complaint; measured p10 0.4–7.5/255). Lifted warm, still
             *  ~40% of Cold's luminance, so a hollow reads sooty, not void. */
            caveTint: [0.52, 0.40, 0.34],
            /** Volcanic ash is porous fluff — a little terminator wrap is
             *  physical; raised [0.12,0.06] → [0.30,0.10] for the same
             *  shadow-floor reason as caveTint. Still under snow's 0.62.
             *  Measured driver: the sun-away dune faces were the last spot
             *  failing the 2026-08-13 readability bar (mean 0.46 x Cold). */
            wrapAmount: [0.34, 0.11],
            bounceCoef: 0.24,               // was 0.05; Cold 0.28 — same driver
            compressCol: [0.060, 0.055, 0.054], // packed ash goes to soot (+25% cap)
            compressRough: 0.66,
            compressThick: 0.05,
            iceCol: [0.16, 0.075, 0.055],   // the ice channel becomes cooled slag
            iceRough: 0.14,
            iceF0: 0.055,
            iceThick: 0.04,
            /** +25% (the sanctioned readability cap, owner 2026-08-13) off the
             *  measured [0.135,0.125,0.120] base — fresh ash fluff, unpacked,
             *  scatters more than the packed plate it sits on. */
            looseCol: [0.169, 0.156, 0.150],
            looseRough: 0.95,
            rockColA: [0.030, 0.028, 0.028],
            rockColB: [0.094, 0.078, 0.070], // +25%, same cap as looseCol
            /** Ash sticks to almost nothing, so an ash realm is MOSTLY BARE. */
            rockGate: [0.10, 0.34],
            wakeAlbedo: [0.169, 0.156, 0.150], // tracks looseCol
            wakeRough: 0.95,
        },

        /** Ash's grains are LARGER, SOFTER, DEEPER-CAVITIED — volcanic ash is a
         *  low-density fluff full of voids, and the cavity channel doing 70% of
         *  the work is what makes it read as absorbent rather than granular. */
        grain: {
            cells: [19, 47, 109],
            heightWeights: [1.0, 0.34, 0.11],
            /** Was [0.70,0.20,0.10] / depth 0.78 — the cavity channel "doing
             *  70% of the work". Measured (owner 2026-08-13, second
             *  complaint): that stamped a near-black micro-lattice over the
             *  whole near field — p10 of the lower half sat at 8/255 with
             *  every macro lever at cap. 0.58/0.60 keeps cavity-led absorbent
             *  ash (Cold is 0.55/0.50) without the lattice going to zero. */
            cavityWeights: [0.58, 0.27, 0.15],
            radius: [0.34, 0.40],
            domeMode: 2,                    // 1 - d*d*d — broad, soft, no rim highlight
            cavityDepth: 0.60,
            grainScale: 0.009,
            detailScales: [6.0, 1.35, 0.25],
        },

        /** CRUST CRACKS. Cracks are channels DOWN, not ridges up, and a mud/ash
         *  polygon network has no wind direction — mode 2's near-isotropic windMat
         *  is what kills the corduroy read on its own. The shader branch is
         *  `crk = pow(clamp(cr.x,0,1), 2.6); h -= crk * a;` with the derivative
         *  chained through `2.6 * pow(c, 1.6)` (REALM_CONTRACT §1b). */
        fine: {
            mode: 2,
            amplitude: 0.045,
            /** Cracks do not care about wind shelter, so the exposure fade barely
             *  bites. */
            exposureFade: [0.85, 1.0],
            scourFreq: 0.014,               // ~71 m plates
            fragFade: [0.24, 1.10],
            primaryScale: 1.6,
            rippleAmp: 0.014,
            rippleScale: 0.30,
            grainAmp: 0.0090,
            grainWindScale: 0.145,
        },

        /** EMBER SPECKS. The whole trick is dropping `sunRadiance` and `shadow`
         *  from the term: an ember in the shade still glows, and that is what
         *  stops it reading as glitter on black sand. snow.glsl.js:511-513 already
         *  adds the term as radiance rather than modulating it into the BRDF, so
         *  the emissive variant needs no structural change. */
        glint: {
            cells: [0.220, 0.480],
            sharpness: [90.0, 140.0],
            facetCull: 0.93,                // rarest of the three
            facetTilt: [0.30, 0.50],        // no facet at all — it is a blob
            /** 0.18 → 0.24 / emissive 3.4 → 4.2 (owner 2026-08-13): the
             *  ember bed is the one light source that reaches a fully
             *  sun-shadowed dune face (emissive bypasses shadow), so it is
             *  the mood-native way to carry those faces over the readability
             *  bar. Safe from the old "glitter on black sand" failure now the
             *  shadow floor itself sits at p10 30+/255, not 1. */
            intensity: 0.24,
            grazing: 0.0,
            grazingExp: 1.5,                // [derived] mix(1.5, 5.0, 0.0)
            tint: [1.00, 0.42, 0.11],       // cinder
            /** > 0 ⇒ emissive: no sunRadiance, no shadow, NdotL gate bypassed. */
            emissive: 4.2,
        },

        fog: {
            /** 0.0155 → 0.0200 with start 12 → 8 (owner 2026-08-13): the
             *  smoke inscatter is the only light a fully sun-shadowed dune
             *  face has here, and it needed to arrive sooner and thicker —
             *  the +60 m sight-line (a whole frame of sun-away faces) was the
             *  last spot under the readability bar, swinging with cloud noise
             *  around 0.55 x Cold until this notch. */
            density: 0.0200,
            /** Smoke rises, so a SHALLOWER falloff than Cold's — the opposite of
             *  Sand. */
            heightFalloff: 0.026,
            /** [derived] 1/0.026 = 38.5 m — the haze fills the whole column. */
            scaleHeightM: 38.5,
            start: 8,
            /** 1.30 → 1.45 (owner 2026-08-13 readability round): the smoke
             *  filling the basin is the mood-consistent way to lift the
             *  sun-away dune faces, which otherwise have only the tiny ash
             *  SH to live on. */
            aerialStrength: 1.45,
            /** What fills a SHORT path. In smoke the answer is the horizon band,
             *  not the dome — hence the low tilt and the blurrier mip. */
            nearSkyTilt: 0.12,
            nearSkyMip: 4.0,
            forwardG: 0.86,
            forwardGain: 9.0,
            forwardMix: 0.26,
        },

        wind: {
            direction: 150,                 // [derived] |74 − 150| = 76 ✓
            strength: 0.75,
            sastrugiStrength: 0.70,
            macroHeightScale: 0.65,
        },

        /** EMBER-FALL / SMOKE DRIFT. The one realm with TWO populations in ONE
         *  draw: index-hashed 60/40 between falling embers (+0.90 m/s) and rising
         *  smoke (−0.45 m/s). */
        weather: {
            mode: 2,
            fallSpeed: 0.90,                // falling embers, + is down
            fallSpeedAlt: -0.45,            // rising smoke
            altFrac: 0.40,                  // 60/40 split, index-hashed
            windGain: 0.55,
            gustAmp: 0.30,
            box: [120, 60, 120],            // taller box: the column is the look
            radius: [0.014, 0.032, 0.020],  // fine, coarse, GLOW
            alpha: [0.22, 0.34, 0.85],
            tint: [0.30, 0.28, 0.27],
            glowTint: [1.00, 0.40, 0.10],
            /** A bright rgb at a low alpha behaves additively under premultiplied
             *  NormalBlending, which is how the ember layer costs no second pass. */
            glowEmissive: 2.8,
            kindMix: [0.46, 0.36, 0.18],    // [call] — 18% glow embers
            /** Lower than Cold/Sand: an ember is a point of light and a long
             *  streak reads as a tracer round. */
            stretchClamp: 3.5,
            fogBoost: 1.35,
            fogFalloffBoost: 1.0,
            devils: 0,
            wrap: 0.35,                     // mirrors §1f ash spray wrap
            phaseG: 0.45,
            phaseGain: 0.30,
        },

        vfx: {
            sprayAlbedo: [0.28, 0.26, 0.25],
            sprayWrap: 0.35,
            sprayForwardG: 0.45,
            sprayForwardGain: 0.30,
            sprayEdgeAlpha: [0.24, 0.42],
            streakTint: [1.06, 0.72, 0.46],
            streakAmount: 0.14,
            /** [call] [derived] mean albedo 0.077 = 11.6× darker than Cold, so
             *  naïvely 0.105 × 11.6 = 1.22 — which is OUTSIDE the slider's 0.6
             *  maximum (settings.js:245) and would flatten the sun into AgX's toe.
             *  Ash takes 0.300 and makes the difference up through the emissive
             *  ember specks (glint.emissive 3.4), bloom 0.34 and shafts 0.55: the
             *  ash realm is lit by what glows in it, not by the sun. */
            /** 0.300 shipped near-unplayable (owner 2026-08-10): the ember
             *  dots carried the frame alone. 0.44 was still not enough (owner
             *  2026-08-13, second complaint — measured foreground mean 26–55
             *  against Cold's 122–144, ratio 0.21–0.38). 0.76 is where the
             *  measured bar (mean >= 0.55 x Cold, shadow-floor p10 >= 18/255,
             *  at spawn / +60 m / a dune hollow) was finally met — tuned WITH
             *  sky.js SKY_GRADE.ash gain 0.76, ambientIntensity/msBoost above,
             *  the fog/caveTint/wrap/bounce rows, and the +25%-capped ground
             *  albedo rows. NOTE: above the exposure WIDGET's 0.6 max
             *  (settings.js GRADE_GRID) — legal, because `applyRealmGrade`
             *  writes the realm literal through unclamped at offset 1; only an
             *  operator-dragged offset snaps to the widget grid. */
            exposure: 0.78,
            /** 1.22 pushed the AgX toe down exactly where the ash floor
             *  lives; with the realm this dark, contrast >1 buys nothing but
             *  a clipped floor — neutral 1.00 leaves the ember specks + bloom
             *  to carry the punch. */
            contrast: 1.00,
            bloomStrength: 0.34,
        },
    },
};

/* ------------------------------------------------------------------ *
 * Helpers — pure, allocation-light, no imports
 * ------------------------------------------------------------------ */

/**
 * Coerce anything realm-ish to a valid token.
 *
 * Accepts a token string, a row out of `REALMS`, or the `Realm` instance the
 * contract's §2.2 API describes (anything with `.token` or `.name`). Unknown
 * input falls back to `DEFAULT_REALM` rather than throwing: a realm token
 * arrives from a save blob and a corrupt save must boot into Cold, not a stack
 * trace.
 *
 * @param {string|{token?:string,name?:string}|null|undefined} r
 * @returns {"cold"|"sand"|"ash"}
 */
export function realmToken(r) {
    if (typeof r === "string") {
        return Object.prototype.hasOwnProperty.call(REALMS, r)
            ? /** @type {"cold"|"sand"|"ash"} */ (r)
            : DEFAULT_REALM;
    }
    if (r && typeof r === "object") {
        const t = r.token || (typeof r.name === "string" ? r.name.toLowerCase() : "");
        if (Object.prototype.hasOwnProperty.call(REALMS, t)) {
            return /** @type {"cold"|"sand"|"ash"} */ (t);
        }
    }
    return DEFAULT_REALM;
}

/**
 * The realm row. Never returns undefined — see `realmToken`.
 * @param {string|{token?:string,name?:string}} r
 * @returns {RealmRow}
 */
export function realm(r) {
    return REALMS[realmToken(r)];
}

/** @param {string} r @returns {[number, number]} the [min, max] level band. */
export function levelBand(r) {
    return REALMS[realmToken(r)].band;
}

/**
 * The roster selector for a realm — the STRING key into `roster.js`'s `BY_REALM`
 * (`roster.js:605`), not the roster itself. Bodies load per realm and this
 * module must stay import-free; the caller does
 * `import("../combat/roster.js").then(m => m.BY_REALM[rosterFor(name)])`.
 * @param {string} r
 * @returns {string}
 */
export function rosterFor(r) {
    return REALMS[realmToken(r)].rosterToken;
}

/**
 * The spell-set token. The 18 per-realm spell identities and their FX
 * parameters belong to the D1 spell contract; this is only the selector.
 * @param {string} r
 * @returns {string}
 */
export function spellSetFor(r) {
    return REALMS[realmToken(r)].spellSet;
}

/**
 * [derived] Separation between the sun bearing and the wind bearing, degrees,
 * folded into [0, 180].
 *
 * settings.js:64-66 holds this at 70-80°: sastrugi ridges run along the wind, so
 * when the two align the sun rakes down every ridge, lights both flanks
 * identically and the fine structure reads as flat ground. All three realms are
 * authored at exactly 76. This function is the check, not a computation anything
 * consumes — call it from a probe, not from a frame.
 * @param {string} r
 * @returns {number} degrees, 0..180
 */
export function sunSeparation(r) {
    const R = REALMS[realmToken(r)];
    let d = Math.abs(R.sky.sunAzimuth - R.wind.direction) % 360;
    if (d > 180) d = 360 - d;
    return d;
}

/* ------------------------------- progression ------------------------------ */

/**
 * The progression rule, stated once: KILLING A REALM'S BOSS OPENS THE NEXT.
 * cold → sand → ash. Ash's `next` is null, so its boss opens nothing.
 *
 * `progression.js:171, 404` boots `realmsUnlocked = ["cold"]` and NOTHING in the
 * tree writes a second entry today — the array is a read-only artefact
 * (REALM_CONTRACT §5.1, §7.2). The writer belongs on the same `bossesKilled`
 * edge that already pays `XP.objectivePct.realmBossFirstKill = 35`
 * (`combatData.js:635`), so there is exactly one place a realm can unlock.
 *
 * @param {string} r the realm whose boss just died
 * @returns {string|null} the realm token this kill unlocks, or null
 */
export function nextRealm(r) {
    return REALMS[realmToken(r)].next;
}

/**
 * The realm whose boss must die to open `r`. Inverse of `nextRealm`.
 * @param {string} r
 * @returns {string|null} null for Cold, which is unlocked from boot
 */
export function prevRealm(r) {
    const t = realmToken(r);
    for (let i = 0; i < REALM_ORDER.length; i++) {
        if (REALMS[REALM_ORDER[i]].next === t) return REALM_ORDER[i];
    }
    return null;
}

/**
 * The realm-boss key whose first kill unlocks `r`, for the `bossesKilled` edge.
 * @param {string} r
 * @returns {string|null}
 */
export function unlockKeyFor(r) {
    const p = prevRealm(r);
    return p === null ? null : REALMS[p].bosses.realmBoss.key;
}

/**
 * Apply the unlock rule to a `realmsUnlocked` array.
 *
 * Pure: returns a NEW array when something changed and the SAME array when
 * nothing did, so a caller can cheaply test `out !== unlocked` to decide whether
 * to write the save. Never reorders and never removes.
 *
 * @param {string[]} unlocked current `progression.realmsUnlocked`
 * @param {string} bossRealm the realm of the realm-boss that just died
 * @returns {string[]}
 */
export function unlockAfterBoss(unlocked, bossRealm) {
    const nxt = nextRealm(bossRealm);
    if (nxt === null) return unlocked;
    if (unlocked.indexOf(nxt) >= 0) return unlocked;
    return unlocked.concat(nxt);
}

/**
 * Is `r` reachable given the save's unlock list? Cold is always reachable.
 * @param {string[]} unlocked
 * @param {string} r
 * @returns {boolean}
 */
export function canEnter(unlocked, r) {
    const t = realmToken(r);
    if (t === DEFAULT_REALM) return true;
    return Array.isArray(unlocked) && unlocked.indexOf(t) >= 0;
}

/**
 * The realm a player of this level belongs in — the LAST realm in play order
 * whose band contains the level, so the overlaps resolve forward.
 *
 * The band overlap is deliberate (REALM_CONTRACT §5.2): a player leaves Cold at
 * level 10 because its boss is fixed there, arrives in Sand's `[8, 20]` at the
 * BOTTOM of a twelve-level band, and grinds to 20 where Sand's boss waits. Same
 * shape into Ash. Nothing needs re-tuning.
 *
 * @param {number} level
 * @returns {string}
 */
export function realmForLevel(level) {
    let out = REALM_ORDER[0];
    for (let i = 0; i < REALM_ORDER.length; i++) {
        const b = REALMS[REALM_ORDER[i]].band;
        if (level >= b[0] && level <= b[1]) out = REALM_ORDER[i];
    }
    return out;
}

/* ------------------------------ uniform blocks ---------------------------- */

/**
 * The `lib/realm` uniform block — the ONLY interface between this module and the
 * shaders, as fixed by REALM_CONTRACT §6. Eighteen names, flat, uniform-friendly:
 * plain JS numbers and plain arrays, so the caller does
 * `u.uGroundAlbedo.value.fromArray(block.uGroundAlbedo)` with no allocation.
 *
 * ONE SWAP = ONE PASS OVER THIS OBJECT. The block is shared BY REFERENCE with
 * the snow, wake, spray, sky and crystal materials exactly as `sky.uniforms` and
 * `deform.uniforms` are (sky.js:199-207, deformation.js:173-179), so a single
 * write reaches every program. That is what makes a realm's LOOK a Class-A (free)
 * change in the §2.1 cost table.
 *
 * ⚑ INTERFACE GAP, reported not invented: the contract's `uSurfaceParams.w` is a
 * single `wrapAmount` scalar, but `snow.glsl.js:434` is a two-ended
 * `mix(0.62, 0.15, max(compression, rockExposed))`. This function emits the LOOSE
 * end (Cold 0.62 / Sand 0.24 / Ash 0.12); the compressed end is available as
 * `REALMS[r].ground.wrapAmount[1]` and needs a 19th uniform, or a hard-coded
 * per-mode ratio in the shader, before the compressed terminator is realm-correct.
 *
 * @param {string|{token?:string,name?:string}} r
 * @returns {Record<string, number|number[]>}
 */
export function realmUniformBlock(r) {
    const R = REALMS[realmToken(r)];
    const g = R.ground;
    return {
        uGroundAlbedo: g.albedo,
        uCompressCol: g.compressCol,
        uIceCol: g.iceCol,
        uLooseCol: g.looseCol,
        uRockColA: g.rockColA,
        uRockColB: g.rockColB,
        uSssShallow: g.sssShallow,
        uSssDeep: g.sssDeep,
        uCaveTint: g.caveTint,
        uGlintTint: R.glint.tint,
        uSprayAlbedo: R.vfx.sprayAlbedo,
        // x roughness, y f0, z thickness, w wrapAmount (loose end — see the note)
        uSurfaceParams: [g.roughness, g.f0, g.thickness, g.wrapAmount[0]],
        // x roughness, y thickness, z iceRough, w iceThick
        uCompressParams: [g.compressRough, g.compressThick, g.iceRough, g.iceThick],
        // x gateLo, y gateHi, z looseRough, w bounceCoef
        uRockParams: [g.rockGate[0], g.rockGate[1], g.looseRough, g.bounceCoef],
        uGlintCells: R.glint.cells,
        uGlintSharp: R.glint.sharpness,
        uGlintEmissive: R.glint.emissive,
        uFineMode: R.fine.mode,
    };
}

/** The 18 `lib/realm` uniform names, in declaration order. Probe surface. */
export const REALM_UNIFORM_NAMES = Object.keys(realmUniformBlock(DEFAULT_REALM));

/**
 * The flat `S`-key patch a realm swap writes.
 *
 * RETURNED, never applied: the caller must push each entry through
 * `settings.set()` so the `onChange` edges fire (`settings.js:423-436`). Writing
 * `S` directly from here would be exactly the "lever that lies" the settings
 * header (`settings.js:10-21`) exists to prevent.
 *
 * Every key here is Class A in the §2.1 cost table — already re-read every frame
 * by `terrain.js:446-456` or `sky.js:413-416` — EXCEPT `macroHeightScale`, which
 * changes the measured relief and therefore the shadow cascade volume. That is
 * handled for free because `_rebake` already calls `_applyHeightBounds()` right
 * after `bake()` (`terrain.js:430-431`), so it just has to land before the
 * heightfield step of `rebakePlan()`.
 *
 * @param {string|{token?:string,name?:string}} r
 * @returns {Record<string, number|boolean|string>}
 */
export function realmSettings(r) {
    const R = REALMS[realmToken(r)];
    return {
        realm: R.token,
        // §1a sun / sky
        sunAzimuth: R.sky.sunAzimuth,
        sunElevation: R.sky.sunElevation,
        sunIntensity: R.sky.sunIntensity,
        sunTempWarm: R.sky.sunTempWarm,
        ambientIntensity: R.sky.ambientIntensity,
        ambientBlue: R.sky.ambientBlue,
        showMountains: R.sky.showMountains,
        mountainHeight: R.sky.mountainHeight,
        shaftStrength: R.sky.shaftStrength,
        // §1b snow group
        glintIntensity: R.glint.intensity,
        glintGrazing: R.glint.grazing,
        sssStrength: R.ground.sssStrength,
        sssRadius: R.ground.sssRadius,
        macroHeightScale: R.wind.macroHeightScale,
        sastrugiStrength: R.wind.sastrugiStrength,
        // §1c fog
        fogDensity: R.fog.density,
        fogHeightFalloff: R.fog.heightFalloff,
        fogStart: R.fog.start,
        aerialStrength: R.fog.aerialStrength,
        // §1d wind
        windDirection: R.wind.direction,
        windStrength: R.wind.strength,
        // §1f post
        exposure: R.vfx.exposure,
        contrast: R.vfx.contrast,
        bloomStrength: R.vfx.bloomStrength,
    };
}

/**
 * The weather dial block, flat, for `src/vfx/weather.js`.
 *
 * Returns the row itself (not a copy): weather reads it once per `setRealm()`
 * and never mutates it, and copying here would allocate on every swap for no
 * benefit. Treat it as frozen.
 * @param {string|{token?:string,name?:string}} r
 * @returns {RealmRow["weather"]}
 */
export function weatherParams(r) {
    return REALMS[realmToken(r)].weather;
}

/**
 * The shell / HUD / crosshair accent. `main.js:875-876` hard-codes Cold's today,
 * and `src/ui/hud.js:50` and `src/progression/xphud.js:83` duplicate the same
 * palette — three sites that should read this one row (REALM_CONTRACT §7.7).
 * @param {string|{token?:string,name?:string}} r
 * @returns {RealmRow["accent"]}
 */
export function accentFor(r) {
    return REALMS[realmToken(r)].accent;
}

/* -------------------------------- the swap -------------------------------- */

/**
 * Swap cost classes, from REALM_CONTRACT §2.1. Exported so the integrator's
 * loading loop and a probe agree on what a step costs without re-deriving it.
 *
 *   A — free. A uniform write into a block something already re-reads per frame.
 *   B — a debounced GPU re-bake. For a swap, do NOT use the debounce path:
 *       `await sky.solve()` directly inside the loading phase, so the first frame
 *       of the new realm is already lit by the new LUT. (`Sky.solve()`,
 *       sky.js:441-466, is 8 fullscreen bakes + 4 async readbacks.)
 *   C — a synchronous stall. MUST be behind a loading screen.
 */
export const SWAP_COST = { FREE: "A", REBAKE: "B", STALL: "C" };

/**
 * The ordered re-bake plan for a swap. SEPARATED AND INDIVIDUALLY CALLABLE by
 * design: the free uniform writes must not be trapped behind the stalling GPU
 * work, and a probe or a hot-reload that only changed a look value must be able
 * to run step 0 alone.
 *
 * Each entry is `{ id, cost, call, why }`. `call` is the exact call the
 * integrator makes — this module never performs any of them, because it holds no
 * references and importing terrain/sky here would put the whole render stack on
 * the boot path of a data module.
 *
 * `from === to` returns ONLY the free step, which is what makes re-applying a
 * realm (an overlay slider reset, a preset re-apply) cost nothing.
 *
 * @param {string} from realm token currently in force
 * @param {string} to realm token being entered
 * @returns {{id:string, cost:string, call:string, why:string}[]}
 */
export function rebakePlan(from, to) {
    const a = realmToken(from);
    const b = realmToken(to);
    /** @type {{id:string, cost:string, call:string, why:string}[]} */
    const plan = [{
        id: "uniforms", cost: SWAP_COST.FREE,
        call: "write realmSettings(to) through settings.set(), then realmUniformBlock(to) into the shared lib/realm block",
        why: "Class A — every key is already re-read per frame (terrain.js:446-456, sky.js:413-416)",
    }];
    if (a === b) return plan;

    plan.push({
        id: "sky", cost: SWAP_COST.REBAKE,
        call: "sky.setRealm(to); await sky.solve()",
        why: "bake constants (BETA_M, MIE_G, H_MIE, MS_BOOST, BETA_R, graze tint, ground albedo) change the LUT; solve() not _markDirty(), so frame one is lit correctly",
    });
    plan.push({
        id: "grain", cost: SWAP_COST.STALL,
        call: "terrain.setRealm(to) → _detailPass.render(detailRT) (terrain.js:387)",
        why: "1024² pass, [derived] 135 cell evaluations per pixel (detailBake.glsl.js:54-55, 79-81, 92-96) plus an RGBA8 mip-chain regen",
    });
    plan.push({
        id: "heightfield", cost: SWAP_COST.STALL,
        call: "heightfield.bake() then terrain._applyHeightBounds() (terrain.js:393, 398-405)",
        why: "4096² RG32F + 2048² RGBA16F bakes and a SYNCHRONOUS readback the code puts at 268 MB of transfer (heightfield.js:56-59); terrain.js:389-391 calls the pair 'a few hundred milliseconds'",
    });
    plan.push({
        id: "deform", cost: SWAP_COST.STALL,
        call: "await deform.warmUp()",
        why: "~8 ms (two _step passes at S.deformResolution², sim quoted 4.15 ms at 2048², settings.js:307) — mandatory: the old realm's carved trench must not survive",
    });
    plan.push({
        id: "vfx", cost: SWAP_COST.FREE,
        call: "weather.setRealm(to); spray.clear() (particles.js:454); wake.warmUpClear() (surfWake.js:884)",
        why: "Class A for weather (uniform writes only); the two clears are O(CAPACITY) loops, not GPU work",
    });
    plan.push({
        id: "combat", cost: SWAP_COST.FREE,
        call: "encounters.setRealm(to); enemies.setRealm(to) — the 10-body GLB set for rosterFor(to)",
        why: "bodies load per realm, 2.7-3.0 MiB (roster.js:50-51); PACKS today has only cold rows (encounters.js:132-146) so sand/ash spawn NOTHING until they are authored",
    });
    plan.push({
        id: "shell", cost: SWAP_COST.FREE,
        call: "shell.setAccent(accentFor(to))",
        why: "the accent is Cold-frost hard-coded at main.js:875-876 and duplicated at hud.js:50 and xphud.js:83",
    });
    return plan;
}

/* -------------------------------- schema check ---------------------------- */

/**
 * Schema symmetry check. Walks all three realms and reports every key path that
 * exists on one and not on another, and every path whose JS type or array length
 * disagrees.
 *
 * This is the invariant the whole module rests on: a swap that reads a key only
 * Cold has produces `undefined` in a uniform, which lands as NaN in a shader and
 * blacks out a material with no error anywhere. Pure — call it from a probe.
 *
 * @returns {string[]} empty when the schema is symmetric
 */
export function realmSchemaDiff() {
    /** @type {string[]} */
    const out = [];
    const ref = REALM_ORDER[0];

    /**
     * @param {any} a @param {any} b @param {string} path
     * @param {string} ta @param {string} tb
     */
    const walk = (a, b, path, ta, tb) => {
        const kindA = Array.isArray(a) ? "array" : (a === null ? "null" : typeof a);
        const kindB = Array.isArray(b) ? "array" : (b === null ? "null" : typeof b);
        // null is the documented "no value in this realm" marker (e.g. ttkAtL10s);
        // it is type-compatible with anything, so only structural kinds are compared.
        if (kindA !== kindB && kindA !== "null" && kindB !== "null") {
            out.push(`${path}: ${ta} is ${kindA}, ${tb} is ${kindB}`);
            return;
        }
        if (kindA === "array" && kindB === "array") {
            if (a.length !== b.length) {
                out.push(`${path}: ${ta} has ${a.length} entries, ${tb} has ${b.length}`);
            }
            return;
        }
        if (kindA !== "object" || kindB !== "object") return;
        for (const k in a) {
            if (!(k in b)) { out.push(`${path}.${k}: present in ${ta}, MISSING in ${tb}`); continue; }
            walk(a[k], b[k], `${path}.${k}`, ta, tb);
        }
        for (const k in b) {
            if (!(k in a)) out.push(`${path}.${k}: present in ${tb}, MISSING in ${ta}`);
        }
    };

    for (let i = 1; i < REALM_ORDER.length; i++) {
        const t = REALM_ORDER[i];
        walk(REALMS[ref], REALMS[t], t, ref, t);
    }
    return out;
}
