/**
 * Central tuning + toggle store.
 *
 * `S` is a flat plain object read directly by systems every frame — no getters,
 * no proxies, no allocation. `SCHEMA` is metadata the settings overlay builds
 * its widgets from, and `onChange` lets systems react to edits that need work
 * (rebuilding a render target, re-freezing a material) rather than just being
 * sampled next frame.
 *
 * THE ONE EXCEPTION, and why it exists. Three keys — `resolutionScale`,
 * `deformResolution` and `preset` — are STRUCTURAL: the value alone means
 * nothing until something reallocates a render target or resizes the drawing
 * buffer, and that only happens on the `onChange` edge. A plain data property
 * lets `S.resolutionScale = 0.5` succeed, read back as 0.5, and change
 * absolutely nothing — a lever that lies. That is not hypothetical: it shipped,
 * and it went unnoticed through a whole performance sweep because every readback
 * agreed with the write. Those three are accessor properties that route the
 * write through `set()`, so the edge always fires. They are read once per resize
 * and once per overlay repaint, never in the render loop (verified: the only
 * reads are `main.js` `applySize`, `deformation.js` construction + its own
 * `onChange`, and `overlay.js` `_syncPresets`), so the accessor is not on any
 * hot path. Every other key stays a plain data property.
 *
 * Ported verbatim from the WebGPU reference. These numbers *are* the art
 * direction — the exposure/contrast pair, the sun elevation, the wind bearing's
 * offset from the sun bearing — and they were measured against the reference's
 * output, not chosen by eye. Nothing here is a placeholder. If a value looks
 * wrong, report it; do not retune it.
 */

/** @type {Record<string, number|boolean|string>} */
export const S = {
    // ---------------------------------------------------------------- quality
    preset: "ultra",
    resolutionScale: 1.0,
    /**
     * Dynamic resolution. OFF by default and deliberately not part of any
     * preset: a controller that moves the render resolution underneath a
     * screenshot makes the comparison battery irreproducible, and the battery is
     * what this port is judged by. It is a runtime convenience for a machine
     * whose spare GPU time varies, not a quality rung.
     */
    dynamicResolution: false,
    /** Frame rate `dynamicResolution` aims at. Only read while that is on. */
    dynamicTargetFps: 60,

    // ------------------------------------------------------------------- sun
    sunAzimuth: 118, // degrees, compass bearing of the sun
    // Low enough for long raking shadows, high enough that the beam still
    // carries real energy — below ~10 degrees the air mass eats so much of it
    // that the scene goes flat and sky-lit.
    sunElevation: 13.0,
    sunIntensity: 4.2,
    sunTempWarm: 1.0, // 0 = neutral white, 1 = full warm low-sun tint
    ambientIntensity: 1.0,
    ambientBlue: 1.0, // strength of the cool shadow shift

    // ------------------------------------------------------------- atmosphere
    fogDensity: 0.0072,
    fogHeightFalloff: 0.045,
    fogStart: 24,
    aerialStrength: 1.0,
    // Degrees. Drives sastrugi shear and dune orientation. Held 70-80 degrees
    // away from `sunAzimuth`: sastrugi ridges run along the wind, so when the
    // two align the sun rakes down every ridge, lights both flanks identically
    // and the fine structure reads as flat ground.
    windDirection: 42,
    windStrength: 1.0,
    /** Far-field mountain range on the skybox. */
    showMountains: true,
    /** Peak height of that range, metres. */
    mountainHeight: 2150,
    /** Strength of the volumetric shafts spilling past dune crests. */
    shaftStrength: 0.30,

    // ------------------------------------------------------------------- snow
    glintIntensity: 0.55,
    glintGrazing: 0.72, // how hard the grazing-angle gate bites
    sssStrength: 1.0,
    sssRadius: 1.0,
    detailNormalStrength: 1.0,
    macroHeightScale: 1.0,
    sastrugiStrength: 1.0,

    // ----------------------------------------------------------- deformation
    deformDepth: 1.0,
    deformBerm: 1.0,
    refillRate: 1.0,
    deformResolution: 2048,

    // ------------------------------------------------------------- snow-surf
    /** Height of the breaking wall thrown by a carve, as a multiple of 1.45 m. */
    wakeHeight: 1.0,
    /** Density of the plume shed off the wake's lip. */
    wakeSpray: 1.0,
    /** Screen-space speed streaks while surfing. */
    windStreaks: true,
    streakStrength: 1.0,

    // --------------------------------------------------------------- weather
    /** Master toggle for the realm weather sheet (blizzard / sandstorm /
     *  ember-fall). Off hides one mesh and skips one update; the fog boost is
     *  handed back to the sky on the same edge. */
    showWeather: true,
    /**
     * Live particles in the weather sheet. Geometry is allocated once at 4096
     * and this moves a draw range, so it is free to change at any moment and
     * costs no reallocation — which is why it needs no accessor routing the way
     * `resolutionScale` / `deformResolution` do.
     *
     * 3072 is 6,144 triangles, +0.34% of the 1,799,120-triangle Cold baseline,
     * for +1 draw call. At or below 640 the system drops to its lean rung and
     * takes all four of REALM_CONTRACT §4.3's degradations at once: half the
     * velocity-stretch clamp, no ember-glow layer, half the realm's fog boost,
     * and no dust devils. One gated key, four consequences — deliberately, so
     * the rung cannot fall out of step with itself.
     */
    weatherParticles: 3072,
    /**
     * Whether weather particles read the shadow cascades.
     *
     * The look it buys is real — snow inside the rider's own shadow going dark
     * rather than self-illuminated, the same argument `spray.glsl.js:18-20`
     * makes for the plume — but it is a PCSS lookup across weather's whole
     * overdraw budget (~0.36 screens at 1280x720), which is by a wide margin the
     * most expensive thing the system can be asked to do. Off below `high`, and
     * the ONE knob to reach for first if weather ever measures above 0.6 ms.
     */
    weatherShadows: true,

    // ---------------------------------------------------------------- spells
    /** Master toggle. Off cancels everything in flight and hides both meshes. */
    showSpells: true,
    /** Brightness of the dynamic lights the spells emit. */
    spellLight: 1.0,
    /** Density of the spray every spell throws. */
    spellSpray: 1.0,
    /**
     * Artistic scale on the water's absorption path — glacial melt at one end,
     * tap water at the other. The right value depends on the sun elevation, so
     * it is a slider rather than a constant.
     */
    waterDepthTint: 1.0,

    // ------------------------------------------------------------------ post
    taa: true,
    ssr: true,
    dof: true,
    bloom: true,
    grain: true,
    sharpen: true,
    tonemap: "agx", // "agx" | "aces" | "none"
    // Measured, not guessed: sunlit snow here sits around 12 in linear, and at
    // this exposure it lands near AgX normalised 0.79, where the curve's slope
    // is 0.09 per stop. Higher exposures push it into the shoulder, where the
    // slope collapses and every lit slope resolves to the same flat white.
    exposure: 0.105,
    contrast: 1.14,
    bloomStrength: 0.22,
    grainStrength: 0.022,
    sharpenStrength: 0.55,

    // --------------------------------------------------------------- systems
    showTerrain: true,
    showCharacter: true,
    /**
     * Which body renders: true = the rigged GLB rider (meshChar), false = the
     * procedural figure. The figure SIMULATES either way — snowContact stamps
     * from its solved plants and audio keys off the controller — so this only
     * swaps the visual. PORT-ONLY key; the reference has one character.
     */
    meshCharacter: true,
    showWake: true,
    showLightShafts: true,
    wireframe: false,
    freezeTime: false,

    // ----------------------------------------------------------------- debug
    debugView: "beauty", // beauty | deform | normals | depth | cascades | footprint | fineNormals
    /**
     * Per-pass GPU timing through `EXT_disjoint_timer_query_webgl2`, surfaced in
     * the overlay's "GPU passes" block. Off by default and genuinely free when
     * off — see the profile section of `core/perf.js`. While it is on,
     * `stats.gpuMs` is the sum of the timed scopes rather than one whole-frame
     * query, because that extension's timer does not nest.
     */
    debugProfile: false,
    /**
     * Splits the single `beauty` scope into one scope per draw — sky, terrain,
     * character body, cloth, fur, wake, spray, crystals, water. Implies
     * `debugProfile`. More queries per frame, so read it as a breakdown of the
     * beauty pass rather than as an absolute frame cost.
     */
    debugProfileDeep: false,
};

/**
 * Widget metadata. `t`: "f" float slider, "b" bool toggle, "e" enum.
 * @type {{group:string, items:Array<{k:string,l:string,t:string,min?:number,max?:number,step?:number,opts?:string[]}>}[]}
 */
export const SCHEMA = [
    {
        group: "Sun & Sky",
        items: [
            { k: "sunAzimuth", l: "Azimuth", t: "f", min: 0, max: 360, step: 1 },
            { k: "sunElevation", l: "Elevation", t: "f", min: 0.5, max: 45, step: 0.1 },
            { k: "sunIntensity", l: "Intensity", t: "f", min: 0, max: 10, step: 0.05 },
            { k: "sunTempWarm", l: "Warmth", t: "f", min: 0, max: 1, step: 0.01 },
            { k: "ambientIntensity", l: "Ambient", t: "f", min: 0, max: 3, step: 0.01 },
            { k: "ambientBlue", l: "Ambient blue", t: "f", min: 0, max: 2, step: 0.01 },
        ],
    },
    {
        group: "Atmosphere",
        items: [
            { k: "fogDensity", l: "Fog density", t: "f", min: 0, max: 0.03, step: 0.0001 },
            { k: "fogHeightFalloff", l: "Height falloff", t: "f", min: 0, max: 0.3, step: 0.001 },
            { k: "aerialStrength", l: "Aerial persp.", t: "f", min: 0, max: 2, step: 0.01 },
            { k: "windDirection", l: "Wind dir", t: "f", min: 0, max: 360, step: 1 },
            { k: "windStrength", l: "Wind strength", t: "f", min: 0, max: 2, step: 0.01 },
            { k: "showMountains", l: "Far range", t: "b" },
            { k: "mountainHeight", l: "Range height", t: "f", min: 0, max: 2500, step: 10 },
            { k: "showLightShafts", l: "Light shafts", t: "b" },
            { k: "shaftStrength", l: "Shaft amt", t: "f", min: 0, max: 2, step: 0.01 },
        ],
    },
    {
        group: "Snow",
        items: [
            { k: "glintIntensity", l: "Glint", t: "f", min: 0, max: 2, step: 0.01 },
            { k: "glintGrazing", l: "Glint gate", t: "f", min: 0, max: 1, step: 0.01 },
            { k: "sssStrength", l: "SSS strength", t: "f", min: 0, max: 3, step: 0.01 },
            { k: "sssRadius", l: "SSS radius", t: "f", min: 0.1, max: 3, step: 0.01 },
            { k: "detailNormalStrength", l: "Detail normals", t: "f", min: 0, max: 2, step: 0.01 },
            { k: "macroHeightScale", l: "Dune height", t: "f", min: 0, max: 2, step: 0.01 },
            { k: "sastrugiStrength", l: "Sastrugi", t: "f", min: 0, max: 2, step: 0.01 },
        ],
    },
    {
        group: "Deformation",
        items: [
            { k: "deformDepth", l: "Depth", t: "f", min: 0, max: 3, step: 0.01 },
            { k: "deformBerm", l: "Berm mass", t: "f", min: 0, max: 3, step: 0.01 },
            { k: "refillRate", l: "Refill rate", t: "f", min: 0, max: 4, step: 0.01 },
        ],
    },
    {
        group: "Snow-surf",
        items: [
            { k: "wakeHeight", l: "Wake height", t: "f", min: 0, max: 2, step: 0.01 },
            { k: "wakeSpray", l: "Plume density", t: "f", min: 0, max: 2.5, step: 0.01 },
            { k: "windStreaks", l: "Speed streaks", t: "b" },
            { k: "streakStrength", l: "Streak amt", t: "f", min: 0, max: 2, step: 0.01 },
            { k: "showWake", l: "Wake mesh", t: "b" },
        ],
    },
    {
        group: "Weather",
        items: [
            { k: "showWeather", l: "Weather", t: "b" },
            { k: "weatherParticles", l: "Particles", t: "f", min: 0, max: 4096, step: 128 },
            { k: "weatherShadows", l: "Shadowed", t: "b" },
        ],
    },
    {
        group: "Spells",
        items: [
            { k: "showSpells", l: "Spells", t: "b" },
            { k: "spellLight", l: "Spell light", t: "f", min: 0, max: 3, step: 0.01 },
            { k: "spellSpray", l: "Spell spray", t: "f", min: 0, max: 2.5, step: 0.01 },
            { k: "waterDepthTint", l: "Water depth", t: "f", min: 0, max: 3, step: 0.01 },
        ],
    },
    {
        group: "Post",
        items: [
            { k: "taa", l: "TAA", t: "b" },
            { k: "ssr", l: "SSR (ice)", t: "b" },
            { k: "dof", l: "Depth of field", t: "b" },
            { k: "bloom", l: "Bloom", t: "b" },
            { k: "grain", l: "Film grain", t: "b" },
            { k: "sharpen", l: "Sharpen", t: "b" },
            { k: "tonemap", l: "Tonemap", t: "e", opts: ["agx", "aces", "none"] },
            { k: "exposure", l: "Exposure", t: "f", min: 0.01, max: 0.6, step: 0.005 },
            { k: "contrast", l: "Contrast", t: "f", min: 0.5, max: 2, step: 0.01 },
            { k: "bloomStrength", l: "Bloom amt", t: "f", min: 0, max: 1, step: 0.005 },
            { k: "grainStrength", l: "Grain amt", t: "f", min: 0, max: 0.1, step: 0.001 },
            { k: "sharpenStrength", l: "Sharpen amt", t: "f", min: 0, max: 1, step: 0.01 },
        ],
    },
    {
        group: "Systems",
        items: [
            { k: "showTerrain", l: "Terrain", t: "b" },
            { k: "showCharacter", l: "Character", t: "b" },
            { k: "meshCharacter", l: "Rider mesh", t: "b" },
            { k: "wireframe", l: "Wireframe", t: "b" },
            { k: "freezeTime", l: "Freeze time", t: "b" },
            { k: "resolutionScale", l: "Resolution", t: "f", min: 0.5, max: 1.5, step: 0.05 },
            { k: "dynamicResolution", l: "Dynamic res", t: "b" },
            { k: "dynamicTargetFps", l: "· target fps", t: "f", min: 20, max: 144, step: 1 },
            { k: "debugProfile", l: "GPU profile", t: "b" },
            { k: "debugProfileDeep", l: "· per-draw", t: "b" },
            {
                k: "debugView", l: "Debug view", t: "e",
                opts: ["beauty", "deform", "normals", "depth", "cascades", "footprint",
                       "fineNormals", "shadow", "ndotl", "shadowMap", "albedo"],
            },
        ],
    },
];

/**
 * Quality presets. Only the keys that differ from `ultra` need listing — `ultra`
 * *is* the authored default of `S`, which is why it is empty.
 *
 * Transcribed verbatim from the reference (`src/core/settings.js`) and
 * `_spec/post-core.md` §13.3, including the fact that `high` currently restates
 * the `ultra` values rather than sitting between `ultra` and `balanced`. That is
 * the reference's data and ARCHITECTURE §0.4 forbids re-tuning it here; it is
 * reported rather than changed.
 */
export const PRESETS = {
    ultra: {},
    high: { deformResolution: 2048, resolutionScale: 1.0, ssr: true, dof: true },
    balanced: {
        deformResolution: 1024, resolutionScale: 0.85,
        ssr: false, dof: false,
        // Half the sheet, and the cascade lookup off. 1536 particles is 3,072
        // triangles (+0.17% of baseline) and still one draw call. `ultra` and
        // `high` are absent from this key on purpose: PRESET_KEYS is the union
        // of every key any preset touches and PRESET_BASELINE captures the boot
        // value, so stepping down to `balanced` and back to `ultra` lands on
        // 3072 / true again without either preset naming them.
        weatherParticles: 1536, weatherShadows: false,
    },
    /**
     * PORT-ONLY. The reference has no fourth rung; this one is not transcribed
     * from it and §0.4 therefore does not apply — it is new data, not a re-tune
     * of the three above, which stay verbatim.
     *
     * Every key here is an existing schema toggle switched off, chosen by
     * MEASURED cost on the verification machine (Intel Iris Xe, ANGLE/D3D11,
     * 1280x720) rather than by which effects sound expensive:
     *
     *   showMountains      8.27 ms   the far-range raymarch, 93% of the sky draw.
     *                                By far the biggest single toggle in the
     *                                build, and the reason this preset exists.
     *   resolutionScale    the frame is fill-bound: quartering the pixels
     *                      measured a 3.3x speedup on the beauty pass.
     *   deformResolution   the sim is 4.15 ms at 2048² and does NOT scale with
     *                      output pixels, so a resolution drop alone cannot
     *                      touch it; 512² is 1/16 the texels.
     *   dof                1.29 ms   ssr 0.87 ms   bloom 0.36 ms
     *   sharpen            0.31 ms   showLightShafts 0.15 ms
     *
     * TAA and grain stay ON deliberately. TAA is 1.76 ms at full res and under
     * 0.5 ms at half, and at `resolutionScale` 0.5 it is the only thing holding
     * the edges together — switching it off here would buy a fraction of a
     * millisecond and cost more image than everything else in this list
     * combined.
     *
     * WHAT IT COSTS TO LOOK AT: no distant mountain range on the horizon, no
     * god rays past the dune crests, half-resolution image (soft, and the
     * sastrugi detail the port is judged on is materially reduced), no ice
     * reflections, no depth of field, no bloom on the glints, and footprints /
     * carve berms quantised to a 512² field so their edges are visibly coarser.
     * This is a different-looking demo, not a cheaper-looking one. Nothing here
     * touches the default: `S.preset` boots at "ultra".
     */
    performance: {
        deformResolution: 512, resolutionScale: 0.5,
        ssr: false, dof: false, bloom: false, sharpen: false,
        showMountains: false, showLightShafts: false, windStreaks: false,
        // 512 particles = 1,024 triangles, +0.06% of baseline, still one draw.
        // Below the 640 lean threshold, so this same line also halves the
        // stretch clamp, drops the ember-glow layer, halves the realm fog boost
        // and switches the dust devils off. Combined with resolutionScale 0.5 —
        // a quarter of the fragments per particle — weather's fill cost here is
        // 1/24th of `ultra`'s (6x fewer particles x 4x fewer pixels each).
        weatherParticles: 512, weatherShadows: false,
    },
};

/**
 * The union of every key any preset touches, resolved once at module load.
 *
 * Presets are *differential* data but must behave *totally*: applying `balanced`
 * and then `ultra` has to land back on the ultra values. Iterating only the named
 * preset's own keys cannot do that — `PRESETS.ultra` is `{}`, so it would restore
 * nothing and `S.preset` would read "ultra" over balanced settings. A silent
 * label-vs-state divergence like that makes the shot battery irreproducible,
 * which is exactly the "scaled by accident" ARCHITECTURE §4.1 rules out.
 *
 * Deliberately the union and not every key in `S`: clicking a preset must not
 * also reset the exposure slider or `debugView` that the operator just set.
 */
const PRESET_KEYS = (() => {
    /** @type {Set<string>} */
    const keys = new Set();
    for (const name in PRESETS) for (const k in PRESETS[name]) keys.add(k);
    return Array.from(keys);
})();

/**
 * Boot values of those keys — the `ultra` baseline, captured before anything can
 * write to `S`. Read from `S` rather than duplicated as a literal so the two can
 * never drift.
 * @type {Record<string, number|boolean|string>}
 */
const PRESET_BASELINE = (() => {
    /** @type {Record<string, number|boolean|string>} */
    const b = {};
    for (let i = 0; i < PRESET_KEYS.length; i++) b[PRESET_KEYS[i]] = S[PRESET_KEYS[i]];
    return b;
})();

/** @type {Map<string, Set<(v:any, k:string) => void>>} */
const listeners = new Map();

/**
 * Subscribe to a settings key. Returns an unsubscribe function.
 * @param {string|string[]} keys
 * @param {(v:any, k:string) => void} fn
 * @returns {() => void}
 */
export function onChange(keys, fn) {
    const list = typeof keys === "string" ? [keys] : keys;
    for (let i = 0; i < list.length; i++) {
        let set = listeners.get(list[i]);
        if (!set) {
            set = new Set();
            listeners.set(list[i], set);
        }
        set.add(fn);
    }
    return () => {
        for (let i = 0; i < list.length; i++) listeners.get(list[i])?.delete(fn);
    };
}

/**
 * Backing store for the routed keys (see the file header). A `Map` and not a
 * second object literal so `_route` cannot accidentally be given a key that is
 * also still a data property on `S` — membership here IS the routing flag, and
 * `set` reads it to decide which store to write.
 * @type {Map<string, number|boolean|string>}
 */
const routed = new Map();

/**
 * Notify a key's subscribers. Split out of `set` because `applyPreset` fires
 * the `preset` edge itself, after the whole batch has landed.
 * @param {string} k
 * @param {number|boolean|string} v
 * @returns {void}
 */
function notify(k, v) {
    const subs = listeners.get(k);
    if (subs) for (const fn of subs) fn(v, k);
}

/**
 * Write a settings value and notify subscribers. Never called from the render
 * loop — only from the overlay, preset application and debug entry points.
 *
 * `preset` is not a value, it is a command: writing it applies the preset. That
 * is the only reading under which `S.preset` can be trusted to describe the
 * settings actually in force, which the shot battery's reproducibility depends
 * on.
 *
 * @param {string} k
 * @param {number|boolean|string} v
 * @returns {void}
 */
export function set(k, v) {
    if (k === "preset") {
        applyPreset(/** @type {keyof typeof PRESETS} */ (v));
        return;
    }
    if (routed.has(k)) {
        if (routed.get(k) === v) return;
        routed.set(k, v); // NOT `S[k] = v` — that re-enters the accessor
    } else {
        if (S[k] === v) return;
        S[k] = v;
    }
    // A hand write to a realm-graded key redefines the operator's offset from
    // the realm base. See `applyRealmGrade`. No-ops for every other key, and the
    // unchanged-value early-outs above mean an idempotent write cannot move it.
    noteGradeEdit(k, v);
    notify(k, v);
}

/**
 * Apply a quality preset. Total, not differential: every key any preset touches
 * is written on every call — from the preset if it names it, otherwise from the
 * boot baseline — so stepping down and back up is lossless and `S.preset` always
 * describes the settings actually in force.
 *
 * `set()` no-ops on an identical write, so the keys that did not really change
 * fire no listeners and rebuild no render targets.
 *
 * @param {keyof typeof PRESETS} name
 * @returns {void}
 */
export function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    // No "already on this preset" early-out: re-applying is how an operator
    // discards hand-tweaked sliders and gets back to a known rung. `set` no-ops
    // per key, so the keys that really did not move rebuild nothing.
    //
    // The label goes straight into the backing store, past its own accessor:
    // going through `set` would land back in here and recurse.
    routed.set("preset", name);
    for (let i = 0; i < PRESET_KEYS.length; i++) {
        const k = PRESET_KEYS[i];
        set(k, k in p ? p[k] : PRESET_BASELINE[k]);
    }
    // Last, so a `preset` subscriber (the overlay's button highlight and widget
    // resync) reads the finished state rather than a half-applied one.
    notify("preset", name);
}

/* --------------------------------------------------------------- realm grade */

/**
 * The `S` keys a REALM owns: REALM_CONTRACT §1c's fog vec4 and §1f's tone
 * triple. Both blocks are Class A in §2.1 — already re-read every frame by
 * `sky.js` `update()` and `postChain.js` `_updateComposite()` — so a realm swap
 * is a plain write here with no reallocation behind it.
 *
 * Deliberately NOT the whole of `realms.js` `realmSettings()`. That patch also
 * carries `sunIntensity`, `ambientIntensity`, `mountainHeight`, the wind pair and
 * the snow group, every one of which is ALREADY applied as a ratio against Cold
 * by `Sky.applyRealm()` / `Terrain.applyRealm()`; writing them here as well would
 * apply each realm's sun twice. `applyRealmGrade` therefore takes an arbitrary
 * patch object and picks only these seven out of it, so realms.js may keep
 * returning the full row without this becoming a double-application.
 */
export const REALM_GRADE_KEYS = [
    "fogDensity", "fogHeightFalloff", "fogStart", "aerialStrength",
    "exposure", "contrast", "bloomStrength",
];

/**
 * Slider bounds for the graded keys, read out of `SCHEMA` rather than
 * duplicated, so the two cannot drift. `fogStart` has no widget and therefore no
 * entry — it is unclamped, which is correct: nothing can type a value into it.
 * @type {Record<string, [number, number]>}
 */
const GRADE_BOUNDS = (() => {
    /** @type {Record<string, [number, number]>} */
    const b = {};
    for (let g = 0; g < SCHEMA.length; g++) {
        const items = SCHEMA[g].items;
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (it.t === "f" && REALM_GRADE_KEYS.indexOf(it.k) >= 0
                && typeof it.min === "number" && typeof it.max === "number") {
                b[it.k] = [it.min, it.max];
            }
        }
    }
    return b;
})();

/**
 * THE REALM BASE — what the realm says the key is worth. Seeded from the
 * authored literals above, which ARE Cold's values (`realms.js` cold row cites
 * these same line numbers), so Cold at boot is bit-exact unchanged: base ==
 * literal, offset == 1, and `applyRealmGrade({...cold})` writes each key its own
 * current value, which `set()` no-ops on.
 * @type {Record<string, number>}
 */
const gradeBase = {};

/**
 * THE OPERATOR'S OFFSET, as a RATIO of the base in force when they moved the
 * slider. This is the answer to "a realm write must not fight the user":
 *
 *   - the panel stays a live control. `set("exposure", v)` still writes `S`
 *     immediately and still fires `onChange` — nothing here intercepts or
 *     rejects it. What it additionally does is record WHAT the operator asked
 *     for RELATIVE to the realm: dragging Cold's 0.105 to 0.126 means "+20%".
 *   - a realm swap re-bases rather than overwrites: Sand's 0.170 base with a
 *     1.2 offset lands 0.204, so the operator's intent survives the swap
 *     instead of being silently discarded by it.
 *   - untouched sliders hold offset 1 and therefore land exactly on the realm's
 *     authored number, which is what makes the shot battery reproducible.
 *
 * Ratio and not delta because every key here is a scale (a density, an
 * exposure, a contrast slope); +0.02 means something different at 0.0072 than
 * at 0.0155, ×1.2 does not.
 * @type {Record<string, number>}
 */
const gradeOffset = {};

for (let i = 0; i < REALM_GRADE_KEYS.length; i++) {
    const k = REALM_GRADE_KEYS[i];
    gradeBase[k] = /** @type {number} */ (S[k]);
    gradeOffset[k] = 1;
}

/** True only inside `applyRealmGrade`, so its own writes do not re-derive the
 *  offset from the value they just computed from it. Without this a clamped
 *  write would quietly redefine the operator's intent as the clamp. */
let inGradeApply = false;

/**
 * Record a hand edit to a graded key as an offset from the realm base.
 * @param {string} k
 * @param {number|boolean|string} v
 * @returns {void}
 */
function noteGradeEdit(k, v) {
    if (inGradeApply) return;
    if (!(k in gradeBase) || typeof v !== "number") return;
    const base = gradeBase[k];
    gradeOffset[k] = base !== 0 ? v / base : 1;
}

/**
 * Re-base the graded keys onto a realm.
 *
 * Takes the flat patch `realms.js` `realmSettings()` returns (or any object with
 * the same key names) and applies ONLY `REALM_GRADE_KEYS` from it, through
 * `set()` so every `onChange` edge fires exactly as it does for a slider drag.
 * Keys the patch omits, or gives a non-finite value, keep the base they have.
 *
 * PRESETS are untouched by this and untouched BY this: not one of these seven
 * keys is in `PRESET_KEYS` (the union of every key any preset names), so
 * clicking a rung neither resets a realm's fog nor is reset by a realm swap. The
 * preset's authority over this data stays where it already is and where it can
 * be measured — `performance` switching `bloom` off zeroes the bloom amount in
 * `postChain.js:562` whatever `bloomStrength` says, and the lean weather rung
 * halves the realm's fog BOOST in `weather.js`, which multiplies the base
 * written here rather than replacing it.
 *
 * @param {Record<string, number|boolean|string>} [patch]
 * @returns {Record<string, number>|null} what actually landed in `S`
 */
export function applyRealmGrade(patch) {
    if (!patch) return null;
    /** @type {Record<string, number>} */
    const out = {};
    inGradeApply = true;
    try {
        for (let i = 0; i < REALM_GRADE_KEYS.length; i++) {
            const k = REALM_GRADE_KEYS[i];
            const base = patch[k];
            if (typeof base !== "number" || !isFinite(base)) continue;
            gradeBase[k] = base;
            let v = base * gradeOffset[k];
            const bd = GRADE_BOUNDS[k];
            if (bd) v = Math.min(bd[1], Math.max(bd[0], v));
            set(k, v);
            out[k] = v;
        }
    } finally {
        inGradeApply = false;
    }
    return out;
}

/**
 * The base/offset pair, copied. Exists so a probe can prove the two halves of
 * the model rather than inferring them from `S` — `S.exposure` alone cannot
 * distinguish "the realm said 0.170" from "the operator dragged it there".
 * @returns {{base: Record<string, number>, offset: Record<string, number>}}
 */
export function realmGradeState() {
    return {
        base: Object.assign({}, gradeBase),
        offset: Object.assign({}, gradeOffset),
    };
}

/**
 * Install the accessors for the structural keys. Runs once, at module load,
 * AFTER `PRESET_BASELINE` has been captured — the baseline reads `S[k]` and must
 * see the authored literal, not an accessor over an unseeded store.
 *
 * `enumerable` and `configurable` stay true so `S` still behaves exactly like
 * the plain object it is documented as: `for...in`, `Object.assign` and
 * `JSON.stringify` are unchanged.
 */
for (const k of ["resolutionScale", "deformResolution", "preset"]) {
    routed.set(k, S[k]);
    Object.defineProperty(S, k, {
        enumerable: true,
        configurable: true,
        get: () => routed.get(k),
        set: (v) => set(k, v),
    });
}
