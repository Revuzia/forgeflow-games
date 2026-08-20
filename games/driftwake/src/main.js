/**
 * SNOWFLOW — entry point and frame orchestration.
 *
 * Port of `snowflow_demo/src/main.js`. WebGL2 only, by design: `index.html`
 * probes for a context and for `EXT_color_buffer_float` before this module is
 * ever injected, so by the time we run the capability question has already been
 * answered once. `gfx.checkCaps` re-asks it against the renderer's real context
 * and is the richer report — that is the one that gets named in `#nogpu`.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS FOR
 *
 * Two things, and nothing else: the load-time construction order
 * (ARCHITECTURE.md §4) and the per-frame call order (below). Every number, every
 * formula and every material lives in the subsystem that owns it. If something
 * here looks like tuning, it is a bug.
 *
 * ---------------------------------------------------------------------------
 * THE PER-FRAME ORDER, AND WHY EACH CONSTRAINT EXISTS
 *
 * These are not stylistic. Each one is a visible defect if it is broken, and
 * each is transcribed from the reference's own reasoning:
 *
 *   character.update -> figure.update -> contact.update
 *       Footprints are stamped at the boot's ACTUALLY PLANTED position, which
 *       only exists once the figure has been solved. Taking the event from the
 *       controller instead is "close enough", and a print that is close enough
 *       is a print that is not under the boot.
 *
 *   post.update AFTER the rig has moved, BEFORE anything reads the view-proj
 *       It jitters the projection for the temporal resolve. The depth prepass
 *       and the beauty pass must rasterise through the IDENTICAL jittered
 *       matrix, or TAA integrates two different samplings of one surface. This
 *       is also the single place `updateProjectionMatrix()` is called in a
 *       frame — Three has no `freezeProjectionMatrix`, so the discipline is the
 *       freeze.
 *
 *   spells.update AFTER the shadow refit, BEFORE the deformation step
 *       After, so the water and the ice carry THIS frame's cascade matrices.
 *       Before, so every brush a spell writes is in the staging array when the
 *       simulation pass consumes it — the queue is drained per pass, so a late
 *       writer lands a frame behind and fast movement staggers visibly.
 *
 *   deform.update AFTER every brush writer, BEFORE terrain.update
 *       The reference's `Terrain` stepped the field itself; here [DEFORM] owns
 *       it and the integrator steps it (ARCHITECTURE.md §4, per-frame step 1).
 *       It is still the frame's first GPU pass: nothing above it draws. Writers
 *       are contact (feet, body drag, the surf groove) and all five spells.
 *
 *   figure.sync AFTER the shadow refit
 *       Same cascade-matrix reason as the spells. Split from `figure.update`
 *       precisely because the garments must be solved before contact reads the
 *       feet, while the uniforms cannot be written until the camera has moved.
 *       Merging them leaves one of the two a frame stale, and the symptom — a
 *       shadow lagging the figure through a carve — reads as cheap without
 *       being identifiable.
 *
 *   wake.update BEFORE spray.update
 *       The wake sheds grains into the spray pool, and they have to be in the
 *       pool before the pool is uploaded. Emitting after the upload costs a
 *       frame of latency and desynchronises the plume from the crest in a turn.
 *
 * ---------------------------------------------------------------------------
 * HANDEDNESS (ARCHITECTURE.md §6)
 *
 * Nothing in this file builds a direction, a basis or a cross product. The one
 * convention it does carry is that `rig.camera` is Three's right-handed,
 * Y-up camera and every subsystem is handed that same object rather than a
 * position — the billboard basis, the shadow fit, the prepass matrix and the
 * beauty matrix are then all derived from one `matrixWorld`, so they cannot
 * disagree about chirality. `core/camera.js` is where the mirror against the
 * reference's left-handed world is written down.
 *
 * ---------------------------------------------------------------------------
 * ALLOCATION (ARCHITECTURE.md §0.3): the frame closure allocates nothing. The
 * only per-frame object is `_vel`, a module-scope scratch vector.
 */

import * as THREE from "three";

import { registerShaders } from "./shaders/registry.js";
import {
    S, SCHEMA, PRESETS, onChange, set, applyPreset, applyRealmGrade,
} from "./core/settings.js";
import {
    sample, checkSpike, stats, systemMs, mark, installDrawCounter, endFrameDraws,
    gpuBegin, gpuEnd, gpuBeginWide, gpuEndWide, profileDeep, profileScene,
    profileSnapshot, profileReset,
} from "./core/perf.js";
import { initInput, pollInput, endFrame, input } from "./core/input.js";
import { CameraRig } from "./core/camera.js";
import { HitStop } from "./core/hitstop.js";
import { checkCaps, warmUp } from "./core/gfx.js";
import * as loading from "./core/loading.js";

import { Sky } from "./render/sky.js";
import { ShadowSystem } from "./render/shadows.js";
import { DepthPass } from "./render/depthPass.js";
import { DeformationField } from "./terrain/deformation.js";
import { Terrain } from "./terrain/terrain.js";
import { CharacterController } from "./character/controller.js";
import { Character } from "./character/character.js";
import { MeshCharacter } from "./character/meshChar.js";
import { SnowContact } from "./character/snowContact.js";
import { SprayField } from "./vfx/particles.js";
import { SurfWake } from "./vfx/surfWake.js";
import { SpellSystem } from "./spells/spellSystem.js";
import { PostChain } from "./post/postChain.js";
import { Overlay } from "./ui/overlay.js";
import { Crosshair } from "./ui/crosshair.js";
import { SpellBar } from "./ui/spellbar.js";
import { Hud } from "./ui/hud.js";
import { DamageableRegistry } from "./combat/damageable.js";
import * as combatData from "./combat/combatData.js";
import { SpellHits } from "./combat/spellHits.js";
import { Targeting } from "./combat/targeting.js";
import { SpawnShrine } from "./world/shrine.js";
// [laneL] The realm landmark layer (world/landmarks.js) — three procedural
// monument types per realm in one mesh, three draws for the whole layer.
import { Landmarks } from "./world/landmarks.js";
import { Enemies } from "./combat/enemies.js";
import { MeshEnemies } from "./combat/meshEnemies.js";
import { WeatherField } from "./vfx/weather.js";
import { TelegraphRings } from "./vfx/telegraph.js";
import * as realms from "./world/realms.js";
import { Encounters } from "./combat/encounters.js";
// [LANE B] the arena director + the gate a realm boss opens.
import { BossEncounters } from "./combat/bossEncounters.js";
import { RealmPortal } from "./world/portal.js";
// [LANE-M motes] the kill-drop heal economy (COMBAT_DESIGN §1.4).
import { HealthMotes } from "./combat/motes.js";
import { Floaters } from "./ui/floaters.js";
import { EnemyBars } from "./ui/enemybars.js";
import { HurtFx } from "./ui/hurtFx.js";
import { Progression } from "./progression/progression.js";
import { XpHud } from "./progression/xphud.js";
import { Minimap } from "./ui/minimap.js";
import { audio } from "./audio/audio.js";

// ------------------------------------------------------- module-scope scratch
const _vel = new THREE.Vector3();

/** Warm-up frames drawn behind the boot screen before the fade starts. */
const WARM_FRAMES = 3;

/** Longest frame the integrator will integrate, ms. A hitch must not teleport. */
const MAX_FRAME_MS = 100;

async function boot() {
    const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("view"));

    await loading.phase("creating context", 0.05);

    // `antialias: false` — TAA resolves edges (ARCHITECTURE.md §4), and MSAA on
    // an RGBA16F beauty target would be pure bandwidth for a resolve the post
    // chain then throws away. `stencil: false` for the same reason: nothing here
    // stencils, and the attachment costs depth-buffer layout on every target.
    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        stencil: false,
        depth: true,
        alpha: false,
        powerPreference: "high-performance",
        preserveDrawingBuffer: false,
    });

    const caps = checkCaps(renderer);
    if (!caps.ok) {
        loading.fail("This browser's WebGL2 is missing: " + caps.fatal.join(", "));
        return;
    }

    // Everything is linear until the tonemap pass encodes it (ARCHITECTURE.md
    // §6). Colour management off because every material here is a
    // RawShaderMaterial working in linear-sRGB already: with it on, Three would
    // convert the clear colour out of sRGB and the AgX curve would be applied to
    // values that had already been through a transfer function.
    THREE.ColorManagement.enabled = false;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 1);

    // Must precede any render: it turns `info.autoReset` off, so the counters
    // measure the whole frame's dozen passes rather than the last one, and it
    // opens the GPU timer query if the browser exposes one (ARCHITECTURE §4.2).
    installDrawCounter(renderer);
    registerShaders();

    await loading.phase("building scene", 0.10);

    const scene = new THREE.Scene();
    // No stock lights and no background: every material computes its own
    // lighting, and the sky mesh covers the frame at the far plane.
    scene.background = null;

    const rig = new CameraRig(canvas.clientWidth / Math.max(1, canvas.clientHeight));

    // Hardware scaling, the Three spelling of the reference's
    // `setHardwareScalingLevel(1 / S.resolutionScale)`: the drawing buffer is
    // the CSS size times the scale, and deliberately NOT times
    // `devicePixelRatio` — the comparison battery has to land on a known pixel
    // grid whatever display it runs on.
    /** @type {PostChain|null} assigned below; resize runs before it exists */
    let post = null;
    const applySize = () => {
        const w = Math.max(1, canvas.clientWidth || window.innerWidth);
        const h = Math.max(1, canvas.clientHeight || window.innerHeight);
        renderer.setPixelRatio(S.resolutionScale);
        renderer.setSize(w, h, false); // false: index.html owns the canvas CSS
        rig.setAspect(w / h);
        if (post) {
            const dw = Math.max(1, Math.round(w * S.resolutionScale));
            const dh = Math.max(1, Math.round(h * S.resolutionScale));
            post.setSize(dw, dh);
        }
    };
    applySize();
    onChange("resolutionScale", applySize);
    window.addEventListener("resize", applySize);

    // ------------------------------------------------- dynamic resolution
    //
    // OFF unless `S.dynamicResolution` is set, and not reachable from any
    // preset: a controller that moves the render resolution underneath a
    // screenshot makes the comparison battery irreproducible.
    //
    // Everything below is shaped by one requirement — it must never visibly
    // oscillate — and each part earns its place against that:
    //
    //   A DISCRETE LADDER, not a continuous scale. The controller moves an
    //   index. A continuous corrector settles into a slow creep that is far more
    //   visible than a step, because the eye tracks change, not absolute
    //   sharpness. It also means "settled" is a fixed pixel grid rather than an
    //   asymptote it never quite reaches.
    //
    //   FAST DOWN, SLOW UP. Dropping a rung is one bad window; climbing one
    //   needs `DRS_RISE_WINDOWS` consecutive comfortable windows. The asymmetry
    //   is the whole anti-oscillation argument: a scene that is marginal at rung
    //   n+1 and comfortable at rung n would, under a symmetric rule, alternate
    //   forever. Here it drops once and stays.
    //
    //   A WIDE, ASYMMETRIC DEAD BAND. Down at 1.15x budget, up only under
    //   0.78x. The gap between the two thresholds is larger than the frame-time
    //   change a single rung produces, which is what makes a limit cycle
    //   impossible rather than merely unlikely.
    //
    //   THE WINDOW IS DISCARDED ON EVERY CHANGE. A resize reallocates six render
    //   targets; that frame is a hitch, and feeding a hitch back into the
    //   measurement is how a controller talks itself all the way to the bottom.
    //
    // Allocation (ARCHITECTURE §0.3): the ring and its sort scratch are built
    // here, once. `Float32Array.prototype.sort` is in-place, so the per-frame
    // path allocates nothing.
    const DRS_LADDER = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const DRS_WINDOW = 45;        // frames per decision at a healthy frame rate
    // A window bounded in FRAMES alone is measured in seconds on exactly the
    // machine that needs the controller: 45 frames is 0.75 s at 60 fps but 4.5 s
    // at 10 fps, and four of those before a climb is 18 s — long enough to read
    // as "the setting does nothing". So the window also closes on wall clock,
    // provided enough samples have landed for a median to mean anything.
    const DRS_WINDOW_MS = 1000;
    const DRS_MIN_SAMPLES = 8;
    const DRS_RISE_WINDOWS = 4;   // consecutive comfortable windows before a climb
    const DRS_DOWN = 1.15;        // over budget by this much -> drop a rung
    const DRS_UP = 0.78;          // under budget by this much -> a climb is allowed
    const DRS_SETTLE = 8;         // frames ignored after a resize
    const drsRing = new Float32Array(DRS_WINDOW);
    const drsSort = new Float32Array(DRS_WINDOW);
    let drsIndex = DRS_LADDER.length - 1;
    let drsFill = 0;
    let drsElapsed = 0;
    let drsSettle = 0;
    let drsGood = 0;
    /** Set while the controller is writing, so its own write is not read as a manual one. */
    let drsSelfWrite = false;

    // A manual write — the overlay slider, a preset, a harness — is an override,
    // not an error: the controller re-seats itself on the nearest rung and
    // carries on from there rather than fighting the operator back to its own
    // idea of the right scale on the next window.
    onChange("resolutionScale", () => {
        if (drsSelfWrite) return;
        let best = 0;
        for (let i = 1; i < DRS_LADDER.length; i++) {
            if (Math.abs(DRS_LADDER[i] - S.resolutionScale) <
                Math.abs(DRS_LADDER[best] - S.resolutionScale)) best = i;
        }
        drsIndex = best;
        drsFill = 0;
        drsElapsed = 0;
        drsGood = 0;
        drsSettle = DRS_SETTLE;
    });

    /**
     * One frame of the dynamic-resolution controller.
     * @param {number} dtMs this frame's wall time
     * @returns {void}
     */
    function drsUpdate(dtMs) {
        if (!S.dynamicResolution) {
            // Keep the window empty while off, so switching it on mid-session
            // decides on fresh frames rather than on whatever was in the ring.
            drsFill = 0;
            drsElapsed = 0;
            drsGood = 0;
            return;
        }
        if (drsSettle > 0) { drsSettle--; return; }

        drsRing[drsFill++] = dtMs;
        drsElapsed += dtMs;
        const full = drsFill >= DRS_WINDOW ||
            (drsElapsed >= DRS_WINDOW_MS && drsFill >= DRS_MIN_SAMPLES);
        if (!full) return;
        const n = drsFill;
        drsFill = 0;
        drsElapsed = 0;

        // Median of the first `n` entries without taking a subarray view — that
        // view would be a per-window allocation on the frame path. Padding the
        // tail with +Infinity sorts it past every real sample, so index n>>1 is
        // the median of exactly what was collected. `set`, `fill` and `sort` are
        // all in-place.
        drsSort.set(drsRing);
        if (n < DRS_WINDOW) drsSort.fill(Infinity, n);
        drsSort.sort();
        const med = drsSort[n >> 1];
        const budget = 1000 / Math.max(1, S.dynamicTargetFps);

        let next = drsIndex;
        if (med > budget * DRS_DOWN) {
            // Jump straight to the rung whose pixel count could plausibly fit
            // the budget instead of stepping down one at a time: at 4 fps a
            // one-rung-per-window climb down takes twenty seconds, which is
            // long enough to read as "the setting does nothing".
            const want = Math.sqrt(budget / med);
            while (next > 0 && DRS_LADDER[next] > DRS_LADDER[drsIndex] * want) next--;
            if (next === drsIndex) next = Math.max(0, drsIndex - 1);
            drsGood = 0;
        } else if (med < budget * DRS_UP) {
            // One rung at a time on the way up, and only after several
            // consecutive comfortable windows.
            if (++drsGood >= DRS_RISE_WINDOWS) {
                next = Math.min(DRS_LADDER.length - 1, drsIndex + 1);
                drsGood = 0;
            }
        } else {
            drsGood = 0;
        }

        if (next !== drsIndex) {
            drsIndex = next;
            drsSelfWrite = true;
            set("resolutionScale", DRS_LADDER[drsIndex]);
            drsSelfWrite = false;
            drsSettle = DRS_SETTLE;
        }
    }

    // ------------------------------------------------------------------- sky
    // First, and awaited: the terrain, character, wake, spray, water and crystal
    // materials all take the sky LUT and the SH coefficients as CONSTRUCTION
    // inputs, so nothing else may be built until the solve resolves.
    await loading.phase("integrating atmosphere", 0.20);
    const sky = new Sky(renderer, scene);
    await sky.solve();

    // -------------------------------------------------------------- shadows
    // Before the terrain, because every caster registers itself against these
    // two in its own constructor.
    const shadows = new ShadowSystem(renderer);
    const depthPass = new DepthPass(renderer);

    // --------------------------------------------------------- deformation
    // Zeroed before the snow material first compiles: that compile binds
    // whatever is in the deformation target, and reading uninitialised VRAM as a
    // height can put a NaN into a vertex position.
    await loading.phase("clearing snow state", 0.26);
    const deform = new DeformationField(renderer);
    await deform.warmUp();

    // -------------------------------------------------------------- terrain
    await loading.phase("baking heightfield", 0.34);
    const terrain = new Terrain(renderer, { sky, shadows, depthPass, deform });
    await terrain.build();
    scene.add(terrain.mesh);
    // The spell system reads its brush target as `terrain.deform` (see the
    // SpellContext typedef in spells/spellSystem.js). [TERRAIN] does not publish
    // it — it only consumes `deform.uniforms` — so the integrator wires the two
    // together here, before the spells are constructed.
    terrain.deform = deform;

    await loading.phase("placing character", 0.60);

    const character = new CharacterController(terrain);
    character.position.set(0, 0, 0);
    character.position.y = terrain.heightAt(0, 0);

    // The figure: skeleton, garment simulation, shell fur.
    const figure = new Character(scene, terrain, sky, shadows, character);
    figure.registerPrepass(depthPass);

    // Airborne snow: the footfall kick now, the surf plume and the spell spray
    // later. One pool, one pipeline, one idea of what lit powder looks like.
    const spray = new SprayField(scene, terrain, sky, shadows);

    // Feet and the surf groove write into the terrain state buffer through here.
    // `figure.figure` is the posed skeleton — the only thing that knows where a
    // boot actually planted.
    const contact = new SnowContact(character, deform, figure.figure, spray);

    // The breaking wave, its bow crest and the plume it sheds.
    const wake = new SurfWake(scene, sky, shadows, character, spray, terrain);
    wake.registerPrepass(depthPass);

    // The five spells, the water body they bend and the ice they leave. Every
    // one writes into the same terrain state buffer the feet and the wake do,
    // and lights the snow through the same four-slot pool.
    await loading.phase("preparing spells", 0.70);
    const spells = new SpellSystem(
        scene, sky, shadows, terrain, character, figure.figure, rig, spray
    );
    // Every surface a spell can light. Must precede the warm-up: `addConsumers`
    // installs the pool's uniform boxes, and that has to happen before the
    // material's program is first built.
    spells.addConsumers(
        terrain.material, figure.bodyMat, figure.clothMat,
        wake.material, spray.material
    );
    spells.registerPrepass(depthPass);

    // The rigged GLB rider — the figure's visual replacement. Loaded and
    // registered here, before the warm-up, so its four pipelines compile
    // behind the boot screen with everyone else's. The procedural figure
    // KEEPS SIMULATING whichever body is visible (snowContact stamps from its
    // solved plants; audio keys off the controller); `S.meshCharacter` only
    // decides which of the two renders — see the wiring below the overlay.
    await loading.phase("fitting the rider", 0.74);
    const meshChar = new MeshCharacter(scene, terrain, sky, shadows, character);
    await meshChar.load();
    meshChar.registerShadows();
    meshChar.registerPrepass(depthPass);
    // Another lit surface for the pooled spell lights; must precede the
    // warm-up so the boxes are installed before the program first builds.
    spells.addConsumers(meshChar.material);

    // Which body renders — and which body OWNS the gait. The active body is
    // the footstep authority: mesh on → the clips' measured plant phases emit
    // the footfalls (meshChar._emitFootfalls) and the footprints stamp at the
    // mesh's actual foot bones through snowContact's no-figure branch; mesh
    // off → the procedural figure's solved plants and the controller's
    // distance clock, exactly as before the rider existed. Both listeners
    // fire on `showCharacter` — the figure's own (registered in its
    // constructor) and this one; this one is registered later, so it runs
    // after and owns the final state.
    const applyBodyVisibility = () => {
        const show = S.showCharacter !== false;
        const meshOn = !!S.meshCharacter;
        figure.setVisible(show && !meshOn);
        meshChar.setVisible(show && meshOn);
        character.clipGait = meshOn;
        contact.figure = meshOn ? null : figure.figure;
        // The spell system reads the ACTIVE body's palms: ribbon swirl, cast
        // origins and the idle water play all track the hands the player
        // sees. meshChar.handPosition is figure.handPosition-compatible.
        spells.ctx.figure = meshOn ? meshChar : figure.figure;
    };
    applyBodyVisibility();
    onChange(["showCharacter", "meshCharacter"], applyBodyVisibility);

    // The rig needs ground heights to keep the spring arm above the snow.
    rig.groundAt = (x, z) => terrain.heightAt(x, z);

    // `deform` is read for one boolean — whether anything has ever glazed the
    // ground — which is what lets the reflection pass be skipped outright on a
    // matte frame. See postChain.js, "Bypass".
    post = new PostChain(renderer, rig.camera, { depthPass, sky, deform });
    applySize(); // now that `post` exists, give it the real drawing-buffer size

    const overlay = new Overlay({ rig, character, renderer });
    // The aim reticle. Spells aim along the rig's forward, so screen centre is
    // the aim point whenever the pointer is locked; the crosshair polls its
    // visibility and cast state per frame in `frame()` below. DOM only — it
    // adds nothing to any render pass.
    const crosshair = new Crosshair({ overlay, spells });
    // The spell toolbar shares the reticle's visibility rules and identity.
    const spellbar = new SpellBar({ overlay, spells });
    // Battle-prep HUD: health/mana top-left, terrain minimap bottom-left.
    const hud = new Hud(character);
    hud.attach({ overlay });
    spells.hud = hud;
    const minimap = new Minimap(character, terrain);
    minimap.attach({ overlay });

    // ------------------------------------------------------------- combat
    // The battle stack (_spec/COMBAT_DESIGN §9): registry -> damage pass ->
    // bodies -> director -> presentation. Constructed AFTER the systems it
    // reads (spells, terrain, rig), BEFORE the frame loop closes over it.
    const registry = new DamageableRegistry();
    const spellHits = new SpellHits(spells, registry, character, combatData.combatData);
    // The spawn shrine — the crystal monument every run starts at (owner
    // 2026-08-10). Set dressing only; it replaced the training-dummy arc
    // (removed the same day — real enemies are the only targets now).
    // Placed 7.5 m along the BOOT camera bearing (rig.yaw starts 2.4), so
    // the monument stands in the opening frame.
    const shrine = new SpawnShrine(terrain, spells.crystals, 5.0, 5.5);
    // ---- [LANE B] the realm portal (world/portal.js) --------------------
    // Constructed HERE, beside the shrine, for one reason: its material is a
    // second variant of the crystal pipeline and this is the last point
    // before the warm-up block, so it compiles behind the loading screen with
    // everything else. The gate starts hidden (`mesh.visible = false`) and
    // costs zero draws until a realm boss dies.
    const portal = new RealmPortal(terrain, spells.crystals);
    // ------------------------------------------------ [LANE-L landmarks] BEGIN
    // The realm landmark layer (world/landmarks.js): three procedural monument
    // types per realm — ice henge / frozen crest / glacier gate, sunken
    // colonnade / bleached ribs / watch spire, basalt colonnade / caldera rim /
    // ember vent — 15 instances per realm on a deterministic hashed grid.
    //
    // AFTER the shrine, deliberately: `shrine.positions` are the exclusion
    // anchors (no monument within 120 m of a respawn point). It takes
    // `spells.crystals` for the same reason the shrine does — the merged
    // uniform block (sun, sky LUT, SH, fog, cascades, spell lights) is shared
    // by reference, so this layer adds no per-frame uniform bookkeeping.
    //
    // THREE draw calls total: one beauty plus two shadow cascades. Only the
    // active realm's prisms carry non-zero growth; the other two realms'
    // collapse to a point in the vertex stage, so a realm swap costs no draw.
    const landmarks = new Landmarks(terrain, spells.crystals, shrine);
    // -------------------------------------------------- [LANE-L landmarks] END
    const enemies = new Enemies(scene, terrain, registry, character, combatData, spray);
    // The bodies are the thirty rigged Meshy enemies, not the four placeholder
    // shard constructs `EnemyVis` drew. Same API surface — spawn/free/drive/
    // driveBolt/update/material — so nothing above this line changes.
    //
    // ONE body type is awaited here and the rest stream in behind it. Blocking
    // the boot on all ten of a realm's bodies would add ~6 MB to the critical
    // path for meshes the player cannot meet until the first pack spawns; not
    // blocking on ANY would let the first encounter arrive before its mesh and
    // pop in. `load()` therefore resolves once the realm's first spawnable
    // (the swarm unit, which is what the level-1 gate opens with) is resident.
    const enemyVis = new MeshEnemies(scene, sky, shadows, spells.lights, spells.globals);
    // BEFORE any body loads (its own contract): instances built later join
    // the prepass as they are born. Never being called was one of the two
    // fatal wiring gaps of the 30-body port (audit 2026-08-10) — enemies
    // were absent from the depth prepass and TAA smeared them against the
    // terrain behind.
    enemyVis.registerPrepass(depthPass);
    await loading.phase("waking the drift", 0.78);
    await enemyVis.load("cold");
    enemies.attachVis(enemyVis);
    spells.addConsumers(enemyVis.material);

    // Enemy windup telegraph rings (vfx/telegraph.js) — presentation over the
    // enemies' live flash/reach state, one pooled draw. Constructed here with
    // the combat stack; updated in the frame AFTER enemies.update so the
    // rings carry this frame's flash.
    const fxTelegraph = new TelegraphRings(
        scene, spells.globals, enemies, terrain, spells
    );

    // ------------------------------------------------------------ hit-stop
    // Global impact time-dilation (core/hitstop.js): the frame's dt is
    // multiplied by its envelope, and it drains the registry event ring +
    // the enemies' player-hurt pulse read-only, feeding the camera punch.
    const hitstop = new HitStop(registry, enemies, rig);

    // ------------------------------------------------- [LANE-M motes] BEGIN
    // Health motes (combat/motes.js) — the kill-drop heal economy. It drains
    // the SAME registry event ring hit-stop and the floaters read, so its
    // `update(dt)` sits in that drain window below (after the combat pass,
    // before `registry.endFrame()`), and it uploads its pool before
    // `drawFrame()`. One pooled additive draw; `spells.globals` is the shared
    // `lib/common` uniform block every RawShaderMaterial in the game rides.
    const motes = new HealthMotes(
        scene, registry, character, terrain, spells.globals
    );
    // laneB's boss death edge calls `motes.spawnAt(x, z, 8)` through this.
    // ------------------------------------------------- [LANE-M motes] END

    // ------------------------------------------------------------- weather
    // Shares `spray.globals`, so weather rides the SAME jittered view-projection
    // the wake plume does — two particle systems resolving against different
    // sub-pixel offsets separate visibly in a turn. `groundRef` is the character
    // because dust devils plant on the ground under the player, not under the
    // camera.
    const weather = new WeatherField(scene, sky, shadows, realms.DEFAULT_REALM, {
        globals: spray.globals,
        spellUniforms: spells.spellUniforms,
        groundRef: character,
        // ------------------------------------------ [LANE-E storm edge] START
        // The play-area boundary's storm front. `weather` reads ONE method off
        // this — `terrain.edge01(x, z)` — and ramps its fog boost, its opacity
        // and its population over the last 80 m. Omit it and the field behaves
        // exactly as it did before the band existed.
        terrain,
        // -------------------------------------------- [LANE-E storm edge] END
    });

    /**
     * Enter a realm: ONE call, so a realm can never be half-applied.
     *
     * Order matters. The bodies are fetched FIRST and awaited, because
     * `meshEnemies.load()` is the only step that touches the network — letting
     * the look change before the bodies exist would show the player a sand world
     * populated by cold enemies. Everything after it is a synchronous parameter
     * write.
     *
     * Terrain and Sky are deliberately absent: their realm surface does not exist
     * yet (the ground/sky variants are still to be built), so Sand and Ash
     * currently change weather, spells and roster over the Cold ground rather
     * than pretending to be finished. That is a visible, honest partial state.
     * @param {"cold"|"sand"|"ash"} name
     */
    /** The realm currently in force — the token, for save blobs and the
     *  CONTINUE restore. `realm().name` is a display string. */
    let realmToken = "cold";
    /** TEMP portal re-entrancy latch (see the frame-loop consumer). */
    let realmSwitching = false;

    async function enterRealm(name) {
        // The TOKEN, never `realm().name`. The row's `name` is the display
        // string ("Sand"); every keyed lookup downstream — BY_REALM in the
        // renderer, the encounter tables, the weather rows — is lowercase, and
        // passing the display name throws "no bodies for realm Sand" from
        // inside an async that nothing was awaiting.
        const token = realms.realmToken(name);
        // The OLD realm's field does not follow (audit 2026-08-10: ten cold
        // units stood in the sand until killed). Director bookkeeping first
        // — its despawns are id-keyed — then the runtime sweep.
        encounters.onRealmChange();
        // [LANE B] a boss belongs to its realm: the live event, its arena and
        // the gate all drop here, before the runtime sweep below removes the
        // body underneath them.
        bossEncounters.setRealm(token);
        enemies.clear();
        // [LANE-M motes] the old realm's drops do not follow the player across
        // — same rule the enemy sweep above enforces, same reason.
        motes.clear();
        await enemyVis.load(token);
        // The other nine bodies of the realm walk in behind the priority one
        // — stream() was never called anywhere before the audit, which is
        // why only one body type per realm ever existed in production.
        enemyVis.stream();
        encounters.realm = token;
        weather.setRealm(token);
        if (spells.setRealm) spells.setRealm(token);
        // REALM_CONTRACT §1c fog + §1f tone, into `S`. Class A: every one of the
        // seven keys is already re-read per frame (sky.js `update()` builds uFog
        // from them, postChain.js `_updateComposite()` reads the tone triple), so
        // this is seven writes and no reallocation. `applyRealmGrade` picks ONLY
        // those seven out of the patch — the sun / ambient / mountain / wind keys
        // `realmSettings()` also carries are applied as ratios against Cold by
        // `sky.applyRealm()` and `terrain.applyRealm()` below, and writing them
        // here as well would apply each realm's sun twice.
        applyRealmGrade(realms.realmSettings(token));
        // The panel is a live control and seven of its sliders just moved under
        // it. `ui/overlay.js` resyncs its widgets only on the `preset` edge, so
        // without this it keeps displaying Cold's fog and exposure over Ash's —
        // a readback that disagrees with the setting in force is exactly the
        // "lever that lies" the settings header exists to prevent. RECOMMENDED,
        // for the ui/* owner: a public `Overlay.sync()` subscribed to the graded
        // keys retires this reach-in.
        if (overlay && overlay._syncWidgets) overlay._syncWidgets();
        // The ground and the sky. A plain realm row, never the module: both
        // classes stay constructible by tools that have no realm data. The sky
        // is re-solved rather than debounced, so the first frame of the new
        // realm is already lit by the new LUT and the SH the terrain reads has
        // the new ground bounce in it.
        terrain.applyRealm(realms.realm(token));
        sky.applyRealm(realms.realm(token));
        // The surf wake and kicked spray are MADE of the ground — they
        // wear the realm's authored albedo rows (owner 2026-08-13: the
        // wake stayed snow-white in sand/ash).
        wake.applyRealm(realms.realm(token));
        spray.applyRealm(realms.realm(token));
        // laneC: the hurt vignette red-shifts toward THIS realm's ember hue.
        hurtFx.setRealm(token);
        // ------------------------------ [INTEGRATOR] shrine re-ground/re-tint
        // shrine.js has carried `setRealm(token)` — realm tint plus a
        // 3-frame re-ground countdown, the same mechanism landmarks.js copied
        // — since laneD built the seven-shrine network, and NOTHING has ever
        // called it. It was invisible while every realm stood on Cold's
        // ground; laneE's landform re-bake is what makes it a defect, because
        // the heightfield now genuinely changes under the network. Left
        // unwired the seven shrines keep Cold's heights (buried in Ash,
        // floating in Sand) and `shrine.positions[i].y` goes stale for the
        // minimap blips and `gradeAt`. Placed beside the landmarks call, and
        // for the identical reason: AFTER `terrain.applyRealm` so the
        // re-sample lands on the NEW heightfield.
        shrine.setRealm(token);
        // ---------------------------------------------------- [INTEGRATOR] END
        // [LANE-L landmarks] AFTER terrain.applyRealm, so the re-ground this
        // schedules lands on the NEW heightfield: the old realm's monuments
        // sink, the new realm's rise, and every prism base is re-sampled three
        // frames later once the re-bake has run inside terrain.update().
        landmarks.setRealm(token);
        await sky.solve();
        realmToken = token;
        return token;
    }
    const encounters = new Encounters(enemies, registry, character, combatData, minimap);
    encounters.shrine = shrine;   // the 25 m spawn exclusion anchor
    // TAB target cycle (owner 2026-08-06): nearest -> next -> ... -> none.
    const targeting = new Targeting(registry, character);
    const progression = new Progression(character, registry, null);
    // Two consumers, two channels: the UNLOCK set gates casts in the spell
    // system; the per-level damage multiplier scales hits in the damage
    // pass (QA: attaching only spellSystem left player damage flat forever).
    progression.attach({ spells: spellHits, hud });
    // Auto-save position (owner 2026-08-10): every save — ding, boss flag,
    // the 10 s heartbeat below — carries the exact stand, so CONTINUE
    // resumes where the game last ended rather than at the spawn.
    // ------------------------- [INTEGRATOR] the shrine network -> respawn map
    // `shrine.register(progression)` (shrine.js:357) hands all seven shrines
    // to §8.1 as respawn targets. Its own jsdoc says "main.js calls this
    // once, after Progression is constructed" — and nothing ever did, so
    // `progression.shrines` held only the `cold_spawn: {x:0, z:0}` seed and
    // every death resolved through the `|| this.shrines.cold_spawn` fallback
    // at progression.js:693. Six of the seven shrines were unreachable as
    // respawn points however the run went.
    //
    // Called here rather than at construction because `register` needs a
    // Progression that exists; the shrine itself was built earlier (line 508)
    // as a landmark-exclusion anchor.
    shrine.register(progression);
    // ---------------------------------------------------- [INTEGRATOR] END
    progression._posFor = () => ({
        x: character.position.x, z: character.position.z,
        facing: character.facing || 0, realm: realmToken,
    });
    let autosaveT = 0;
    window.addEventListener("beforeunload", () => progression.save());
    spells.unlocked = progression.unlocked;

    // ------------------------------------------------ [TEST MODE] START
    // Owner 2026-08-16: "for testing I want to be able to use ALL spells, so
    // implement a TEST that limits nothing by levels."
    //
    //   ?test            in the URL turns it on at boot
    //   SNOWFLOW.test()  toggles it live and returns the new state
    //
    // It lifts BOTH gates: `progression._unlockCheck` grants every spell and
    // re-asserts on every ding/CONTINUE/NEW RUN, and the encounter and boss
    // directors read an effective level of TEST_LEVEL so the sand/ash pack
    // tables, the mini boss and the realm boss are all reachable at once. It
    // is never written to the save — `save()` persists only the unlocks the
    // character has actually earned.
    const testBadge = document.createElement("div");
    testBadge.textContent = "TEST MODE - all spells, no level gates";
    testBadge.style.cssText =
        "position:fixed;left:50%;top:8px;transform:translateX(-50%);" +
        "z-index:60;pointer-events:none;display:none;font:600 11px/1 " +
        "system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;" +
        "color:#0b1017;background:#ffd166;padding:5px 12px;border-radius:3px;" +
        "box-shadow:0 2px 10px rgba(0,0,0,.35)";
    document.body.appendChild(testBadge);

    /**
     * Toggle the level limits off for a testing session.
     * @param {boolean} [on] omit to flip the current state
     * @returns {{testMode:boolean, unlocked:number[], level:number}}
     */
    function setTestMode(on) {
        const want = on === undefined ? !progression.testMode : !!on;
        const st = progression.setTestMode(want);
        spells.unlocked = progression.unlocked;
        spellbar.progression = progression;
        testBadge.style.display = want ? "block" : "none";
        console.info("[driftwake] TEST MODE " + (want ? "ON" : "OFF"),
                     JSON.stringify(st));
        return { testMode: st.testMode, unlocked: st.unlocked,
                 level: progression.level };
    }
    // Accept ?test, &test or #test. (The first cut of this line carried a
    // literal 0x08 from an escape mangled in the patch that wrote it, so the
    // regex could never match and the flag silently did nothing.)
    if (/(^|[?&#])test($|[=&#])/i.test(location.search + location.hash + "&")) {
        setTestMode(true);
    }
    // ------------------------------------------------- [TEST MODE] END
    spellbar.progression = progression;
    enemies.progression = progression;
    const floaters = new Floaters(registry, rig);
    floaters.attach({ overlay });
    const enemyBars = new EnemyBars(registry, rig);
    enemyBars.attach({ overlay });
    enemyBars.targeting = targeting;
    // ---- laneC: player hurt feedback (ui/hurtFx.js) — vignette flash,
    // directional tick, low-hp heartbeat. The enemy runtime may report exact
    // hits through `enemies.hurtFx.onPlayerHit(dirX, dirZ, dmg)`; until it
    // does, hurtFx's own health poll covers every damage path.
    const hurtFx = new HurtFx(character, rig, registry);
    hurtFx.attach({ overlay });
    enemies.hurtFx = hurtFx;
    minimap.targeting = targeting;
    const xpHud = new XpHud({ overlay, progression });

    // ---- [LANE B] boss encounters (combat/bossEncounters.js) ------------
    // The SECOND director: `encounters` keeps ambient packs coming, this one
    // runs at most one boss EVENT at a time — arena placement, emergence,
    // phases, the 30 m leash, and the realm portal a realm-boss death opens.
    // Constructed after progression (it gates on level and writes the
    // bossesKilled flags) and after the shrine (arenas keep clear of them).
    const bossEncounters = new BossEncounters(
        enemies, registry, character, combatData, terrain,
        { spray, shockwave: spells.shockwave });
    bossEncounters.progression = progression;
    bossEncounters.shrine = shrine;
    bossEncounters.portal = portal;
    bossEncounters.encounters = encounters;   // a live boss holds pack slot 1
    // The portal's own realm change goes through the ONE enterRealm above, so
    // a gate can never half-apply a realm.
    bossEncounters.enterRealm = (token) => enterRealm(token);
    // ------------------------------- [INTEGRATOR] boss payout: laneB -> laneM
    // `motes.update` deliberately SKIPS TIER.BOSS kills (motes.js:279) so the
    // arena director owns its own payout, and motes.js:23/:230 pins that
    // contract at `spawnAt(x, z, 8)` — the spec sets fodder/elite drop RATES
    // (COMBAT_DESIGN.md:126) but no boss COUNT, so the module contract is the
    // authority and 8 is not invented here.
    //
    // Watched from the frame rather than called from `_onDeath`, because
    // bossEncounters.js is laneB's file and this edge needs no seam inside it:
    // `kills` increments in `_onDeath` and the arena point `ax`/`az` survives
    // it (nothing in `_onDeath` clears them), so the edge is fully readable
    // from the public surface. Two number reads and a compare per frame; the
    // latch lives here so the frame closure allocates nothing.
    let bossKillsSeen = bossEncounters.kills;
    // ---------------------------------------------------- [INTEGRATOR] END

    initInput(canvas, { onToggleOverlay: () => overlay.toggle() });

    // ------------------------------------------------------------- warm-up
    // Everything that can compile, compiles here — behind the loading screen.
    // `compileAsync` alone is not enough: the D3D11 ANGLE backend the harness
    // runs on defers real specialisation until the first draw that binds the
    // VAO, so every pipeline is also DRAWN, with real geometry.
    await loading.phase("compiling pipelines", 0.78);

    shadows.update(rig.camera, sky.sunDir, post.projectionUnjittered);
    sky.render(rig.camera, 0);
    terrain.update(rig.camera, character.position, 0);
    figure.update(0);
    figure.sync(rig.camera);
    meshChar.update(0);
    meshChar.sync(rig.camera);

    // Stand real geometry up in the systems that are empty at rest, so the warm
    // draws rasterise something. Each is undone after the warm frames.
    spray.warmUpSeed();
    spray.update(0, rig.camera);
    wake.warmUpSeed();
    spells.warmUp(character.position.x + 3, character.position.y, character.position.z + 3);
    // [LANE-M motes] one seeded orb so the additive pool rasterises during the
    // warm frames. A dead mote collapses to zero radius in the vertex stage,
    // and a zero-area triangle never specialises the fragment pipeline — the
    // first real drop would then compile mid-fight. `update(0)` uploads
    // without ageing; `motes.clear()` below takes it away before frame one.
    motes.spawnAt(character.position.x + 2, character.position.z + 2, 1);
    motes.update(0);

    // One compile-and-draw over the whole beauty scene. The spell meshes are
    // forced visible for the duration and put back exactly as they were.
    await warmUp(renderer, scene, rig.camera, [
        ...spells.warmUpMeshes, ...figure.warmUpMeshes(), ...meshChar.warmUpMeshes(),
        wake.mesh, spray.mesh, fxTelegraph.mesh,
        motes.mesh,   // [LANE-M motes]
        portal.mesh,  // [LANE B] the gate's crystal variant, compiled hidden
    ]);
    await shadows.warmUp();
    await depthPass.warmUp(rig.camera);
    post.update(0, 0, rig.distance);
    post.warmUp();

    await loading.phase("warming render targets", 0.92);
    // A few real frames so every render target is allocated and every pipeline
    // has actually been bound at least once. Draw only — no `update()` — so the
    // seeded wake spine, spray grains and spell geometry are still standing
    // while those frames rasterise.
    for (let i = 0; i < WARM_FRAMES; i++) {
        drawFrame();
        await loading.nextFrame();
    }
    // Only now: the spell meshes had to be standing THROUGH those frames for
    // their pipelines to exist. Nothing synthetic survives into frame one.
    spells.finishWarmUp();
    motes.clear();   // [LANE-M motes] the seeded warm orb never reaches frame one
    wake.warmUpClear();
    spray.clear();
    post.resetHistory();
    endFrameDraws(); // discard the warm-up's draw counts

    // ------------------------------------------------------------- run loop
    let prev = performance.now();
    let time = 0;

    /**
     * The GPU half of a frame: cascades, prepass, beauty, post. Split out
     * because the warm-up needs the draws without the simulation.
     * @returns {void}
     */
    function drawFrame() {
        shadows.render();
        depthPass.render(rig.camera);

        // GPU profiler (`S.debugProfile`). The cascades, the prepass and every
        // post pass time themselves from inside; the beauty pass is one
        // `renderer.render` over the whole scene, so the scope has to be opened
        // out here. In deep mode the per-draw hooks split it instead, and a
        // wrapping scope would nest — which TIME_ELAPSED_EXT does not allow.
        const coarse = !profileDeep();
        profileScene(scene); // no-op unless deep; keeps late meshes covered

        // Beauty into the HDR target the post chain reads. `autoClear` is on
        // here (and only here), so this is the frame's colour+depth clear.
        if (coarse) gpuBegin("beauty (full)");
        renderer.setRenderTarget(post.sceneTarget);
        renderer.render(scene, rig.camera);
        if (coarse) gpuEnd();
        renderer.setRenderTarget(null);

        post.render();
        post.endFrame();
    }

    function frame() {
        requestAnimationFrame(frame);

        const now = performance.now();
        let dtMs = now - prev;
        prev = now;
        // BEFORE the clamp. `MAX_FRAME_MS` exists so a hitch cannot teleport the
        // integrator, but it also means `dtMs` saturates at 100 ms — and a
        // controller fed the saturated value reads a 4 fps frame as 10 fps and
        // concludes it is already within a 60 fps budget's reach. This machine
        // renders ultra at 5-7 fps, so that is not a corner case here.
        const rawMs = dtMs;
        if (dtMs > MAX_FRAME_MS) dtMs = MAX_FRAME_MS;
        // [HITSTOP] the one dt hook: impact frames dilate the whole clock.
        const dt = S.freezeTime ? 0 : hitstop.scale(dtMs / 1000);
        time += dt;

        pollInput();

        // Per-system CPU timing. The GPU row is a whole-frame timer-query
        // number, so these are not subdivisions of it — the overlay labels them
        // `cpu` for that reason.
        const tFrame = performance.now();

        character.update(dt, rig);
        // ------------------------------------------ [LANE-E storm edge] START
        // The world edge SHOVES before it stops. `edgePush` is exactly 0 outside
        // the last 55 m of the disc — one hypot and an early return over 99% of
        // the play area — and ramps quadratically to 7 m/s at the clamp, which
        // is above the walk speed and below the surf top speed. The hard clamp
        // below is still the backstop; this is what makes it legible.
        // RESISTANCE, NOT A CONVEYOR (owner 2026-08-16: "it stops letting me
        // go forward and pulls me back automatically"). The first cut added
        // `edgePush` straight to the position every frame, so the storm moved
        // the player whether or not the player was moving: measured at r=600
        // a surfer LOST 0.98 m over three seconds of held input, and at r=615
        // lost 2.9 m — a treadmill, which is the exact feel the storm wall was
        // built to replace. It now scrubs only the OUTWARD component of the
        // player's own motion, quadratically with depth into the band: early
        // in the storm you are slowed, at the clamp you cannot gain ground,
        // and standing still moves you nowhere. `terrain.clampToPlayArea`
        // below is still the hard stop. `edgePush` itself is untouched — the
        // weather and the edge probe both read it.
        const ex = character.position.x, ez = character.position.z;
        const e01 = terrain.edge01(ex, ez);
        if (e01 > 0) {
            const ed = Math.hypot(ex, ez);
            if (ed > 1e-4) {
                const uxo = ex / ed, uzo = ez / ed;   // outward radial
                const v = character.velocity;
                const vOut = v.x * uxo + v.z * uzo;
                if (vOut > 0) {
                    const scrub = vOut * e01 * e01;
                    character.position.x -= uxo * scrub * dt;
                    character.position.z -= uzo * scrub * dt;
                    v.x -= uxo * scrub;
                    v.z -= uzo * scrub;
                }
            }
        }
        // A realm swap re-bakes the macro heightfield inside `terrain.update()`,
        // so the ground under the player can move by metres between frames. The
        // controller's grounded snap is an exponential damp (controller.js:335)
        // and would take a visible moment to catch up; this seats it on the new
        // surface the frame the bake lands. Reading the flag clears it.
        if (terrain.consumeGroundDirty()) {
            character.position.y =
                terrain.heightAt(character.position.x, character.position.z);
        }
        // -------------------------------------------- [LANE-E storm edge] END
        terrain.clampToPlayArea(character.position);
        // Pose and simulate before the contact pass: the footprints are stamped
        // at the boot's actual planted position, which only exists once the
        // figure has been solved.
        figure.update(dt);
        // The mesh rider's mixer + pose layer. After the controller, so it
        // reads this frame's motion; before the shadow render, because its
        // skeleton texture is consumed first by the cascades.
        meshChar.update(dt);
        contact.update(dt);
        const tChar = performance.now();

        _vel.copy(character.velocity);
        rig.update(dt, character.position, _vel, character.lean, character.speed01);

        // Jitters the projection and republishes everything the screen-space
        // passes derive from the camera. Must be after the rig has moved and
        // before anything reads the view-projection — which the depth prepass
        // and the beauty pass both do.
        post.update(dt, character.streak01, rig.distance);
        sky.update();
        sky.render(rig.camera, time);
        // The UNJITTERED projection: the jitter is sub-pixel and harmless to the
        // fit, but it adds noise to the cascade radius, which the relative
        // quantisation inside `_fitCascade` exists to reject.
        shadows.update(rig.camera, sky.sunDir, post.projectionUnjittered);
        // After the shadow refit, so the water and the ice carry this frame's
        // cascade matrices; before the deformation step, so the brushes every
        // spell writes are in the staging array when the simulation pass runs.
        spells.update(dt, rig.camera.position, rig.camera);
        // Combat: registry clock, then the damage pass over THIS frame's
        // spell state, then bodies/director (they read the fresh CC state).
        registry.update(dt);
        spellHits.update(dt);
        shrine.update(dt);
        // [LANE-L landmarks] Growth / realm cross-fade / post-swap re-ground.
        // A settled, un-swapped layer is a strict no-op — no upload, no uniform
        // write, no allocation.
        landmarks.update(dt);
        enemies.update(dt);
        // After the bodies: the telegraph rings read this frame's windup
        // flash and positions, before anything renders.
        fxTelegraph.update(dt);
        // [HITSTOP] envelope + event drain, on WALL time. After the combat
        // pass (this frame's kills/hits are in the ring), before
        // registry.endFrame() clears it. Read-only on the registry.
        hitstop.update(dtMs / 1000);
        // [LANE-M motes] same drain window, same reason: this frame's kill
        // events still exist and `registry.endFrame()` has not cleared them.
        // Read-only on the ring; GAME dt, because a mote's drift and its 20 s
        // life dilate with everything else during a hit-stop.
        motes.update(dt);
        encounters.update(dt);
        // [LANE B] the arena director, after the pack director so a boss that
        // arms this frame sees the field the packs just left, and after
        // `enemies.update` so the registry positions its leash reads are this
        // frame's. The gate polls the player on the same clock.
        bossEncounters.update(dt);
        // ---------------------------- [INTEGRATOR] boss payout: laneB -> laneM
        // The death edge, read off the public surface (see the latch above).
        // ONE frame of upload latency by construction: `motes.update` ran at
        // line ~936, inside the registry drain window it must sit in, so a
        // mote dropped here uploads on the next frame. Moving the watcher
        // above `motes.update` does not fix that — `bossEncounters.update`
        // would not have run yet, so the edge would be seen a frame later and
        // land on exactly the same frame. Adjacent to its cause wins.
        if (bossEncounters.kills !== bossKillsSeen) {
            bossKillsSeen = bossEncounters.kills;
            motes.spawnAt(bossEncounters.ax, bossEncounters.az, 8);
        }
        // ------------------------------------------------- [INTEGRATOR] END
        portal.update(dt, character.position.x, character.position.z);
        // AFTER sky.update() rebuilt uFog from S this frame, and before
        // drawFrame() reads it: weather multiplies the realm's fog boost into
        // the live uniform, so the boost lands without compounding across
        // frames. Also after the rig moved, so its billboards face this frame's
        // camera rather than last frame's.
        weather.update(dt, rig.camera);
        // After the bodies moved: the cycle sorts by CURRENT distance and
        // drops a target that died or left range this frame.
        targeting.update(dt);
        // TEMPORARY realm portals (owner 2026-08-13, keys 6/7): switch to the
        // pressed realm, or back to Cold when already there. One switch in
        // flight at a time — enterRealm awaits a body fetch and re-entrant
        // calls would race the roster.
        if (input.realmPortal && !realmSwitching) {
            const want = input.realmPortal === realmToken
                ? "cold" : input.realmPortal;
            realmSwitching = true;
            enterRealm(want).then(
                () => { realmSwitching = false; },
                () => { realmSwitching = false; });
        }
        progression.update(dt);
        // The autosave heartbeat: a crash or tab close costs at most ten
        // seconds of stand. Event saves (dings, boss flags) still fire on
        // their own edges; this one exists for the position ride-along.
        autosaveT += dt;
        if (autosaveT >= 10) {
            autosaveT = 0;
            progression.save();
        }
        const tSpells = performance.now();

        // GPU profiler: on alternate frames one query spans everything below
        // instead of the per-pass ones, so the table can be checked against
        // itself. Opened here because `deform.update` is the frame's first GPU
        // pass; closed immediately after `drawFrame()`, which is its last.
        gpuBeginWide("FRAME (one query)");

        // The frame's first GPU pass: scroll + relax + splat, ping-ponged. Every
        // brush writer above has now run.
        deform.update(dt, character.position);
        // Reads the target written immediately above — a frame late here and
        // every mark staggers under fast movement.
        terrain.update(rig.camera, character.position, time);
        const tTerrain = performance.now();

        // After the shadow refit, so the figure's uniforms carry this frame's
        // cascade matrices rather than last frame's.
        figure.sync(rig.camera);
        meshChar.sync(rig.camera);
        // Before the spray: the grains the wake sheds have to be in the pool
        // before the pool is uploaded.
        wake.update(dt, rig.camera);
        spray.update(dt, rig.camera);
        const tVfx = performance.now();

        drawFrame();
        gpuEndWide();
        const tRender = performance.now();

        mark("cpu character", tChar - tFrame);
        mark("cpu spells", tSpells - tChar);
        mark("cpu terrain", tTerrain - tSpells);
        mark("cpu wake+spray", tVfx - tTerrain);
        mark("cpu submit", tRender - tVfx);
        mark("cpu total", tRender - tFrame);

        // Latches draw calls and triangles for the whole frame and rolls the GPU
        // timer query. Exactly once per frame — `info.autoReset` is off, so
        // skipping it makes the counters grow without bound (ARCHITECTURE §4.2).
        endFrameDraws();

        sample(dtMs);
        checkSpike(dtMs);
        // After `sample`, so the overlay's graph shows the frame that produced a
        // rung change on the same tick the change is made; no-op unless
        // `S.dynamicResolution` is on.
        drsUpdate(rawMs);
        overlay.update(dtMs, renderer);
        // Before `endFrame()`: the cast pulse reads the `spellPressed` edge,
        // which `endFrame()` clears.
        crosshair.update();
        spellbar.update();
        hud.update();
        minimap.update();
        floaters.update();
        enemyBars.update();
        hurtFx.update();
        xpHud.update();
        // Event ring drains ABOVE (floaters/xp read it); clear it last.
        registry.endFrame();

        // Last, and after every `mark()`: the wind bed, the footfalls, the surf
        // hiss and the spell voices are all read off state that is final for the
        // frame, and running here keeps the subsystem out of the CPU marks it
        // would otherwise be attributed to. It is a no-op until the first user
        // gesture creates an AudioContext, so nothing in the shot battery — which
        // dispatches no gesture — ever reaches past the first line of it.
        audio.update(dt, character, spells, rig);

        endFrame();
    }

    /**
     * Build the standard FFG shell (`runtime/ffg_shell.js`) and hand the page to
     * it: title menu, How-to-Play, Settings, Esc pause with Resume/Restart.
     *
     * Everything below is wiring. The shell owns no gameplay and this function
     * owns no tuning — the four quality rungs it offers are `PRESETS`, and the
     * pause is `S.freezeTime`, both of which already exist.
     * @returns {void}
     */
    function startShell() {
        const FFG = globalThis.FFG;
        if (!FFG || !FFG.Shell) {
            // The shell IS the product's front door now, so a missing one is a
            // boot failure and gets said out loud rather than leaving the player
            // staring at a frozen frame with no way into it.
            loading.fail("The game shell failed to load (runtime/ffg_shell.js).");
            return;
        }

        // The shell's QUALITY rungs are this build's presets, verbatim — no
        // mapping table, so the button the player pressed is the preset that
        // runs and the highlighted one is the preset that is running.
        FFG.applyQuality = (q) => applyPreset(q);

        // ── Music ───────────────────────────────────────────────────────────
        //
        // The bed is a real recording: `assets/audio/music/hollow-wave.mp3`, a
        // 60 s seamless loop cut from the owner's own "Hollow Wave" (Atrium
        // Frost / Zenith Echo). It was picked by measurement, not taste — of the
        // seven candidates it puts by far the least energy in 1–4 kHz (0.72 %;
        // the next best is 2.7x that), which is exactly the band the wind bed in
        // `src/audio/` already occupies, and it has the flattest minute in the
        // set (95th–5th percentile level spread of 3.1 dB).
        //
        // Handing the shell a `music` URL is the whole point: it then owns the
        // element, the `loop` flag, the MUSIC slider and — because it builds the
        // element with the `Audio` constructor that `game_controls.js` wrapped —
        // the page Mute button too. None of that is re-implemented here.
        const MUSIC_URL = "./assets/audio/music/hollow-wave.mp3";

        // `runtime/music.js` stays in the tree as the FALLBACK, and as nothing
        // else. Constructing it is free — it opens no AudioContext and builds no
        // graph until `start()` — and `start()` is reachable from exactly one
        // place, `useSynthBed()`, which tears the failed element down before it
        // fires. Two music systems playing at once is two soundtracks, so the
        // choice is made once and `bedLive` makes it unrepeatable.
        const bed = FFG.MusicBed ? new FFG.MusicBed() : null;
        let bedLive = false;
        let musicArmed = false;
        /** @type {string|null} Why the file was abandoned, if it was. */
        let bedReason = null;

        /**
         * Abandon the file and run the synthesised bed instead.
         * @param {string} why Recorded for `FFG.musicStatus()`.
         * @returns {void}
         */
        function useSynthBed(why) {
            if (bedLive) return;
            bedLive = true;
            bedReason = why;
            // Stop the element FIRST. A stalled or half-decoded element that
            // recovers later is the one way this ends up with two beds running;
            // `_stopMusic()` pauses it and drops the shell's reference, so the
            // MUSIC slider and the mute handler hand over to the synth cleanly.
            try { shell._stopMusic(); } catch (e) { /* nothing to stop */ }
            if (bed) { bed.setVolume(shell.musicVolume); bed.start(); }
        }

        /**
         * Decide, once, whether the file is actually playing. Called from the
         * PLAY handler, which the shell invokes immediately AFTER its own
         * `_playMusic()` — so by now the element either exists or never will.
         * @returns {void}
         */
        function armMusic() {
            if (musicArmed) return;
            musicArmed = true;
            const a = shell._music;
            if (!a) { useSynthBed("shell created no audio element"); return; }
            // A 404 or an undecodable file can already have failed by now.
            if (a.error) { useSynthBed("media error " + a.error.code); return; }
            a.addEventListener("error", () => {
                useSynthBed("media error " + (a.error ? a.error.code : "unknown"));
            });
            // Belt and braces for the failure with no event: a stalled element
            // never fires `error` and never reports `paused`, so the honest
            // signal is that it has not decoded a single frame. Six seconds is
            // long after a same-origin 470 kB file should have started.
            setTimeout(() => {
                if (a.readyState < 2 /* HAVE_CURRENT_DATA */) {
                    useSynthBed("nothing decoded after 6 s (readyState " + a.readyState + ")");
                }
            }, 6000);
        }

        // Published next to `FFG.shell` (which the shell sets itself). `FFG.music`
        // stays the MusicBed instance so the existing audio probes keep reading
        // `.ctx` / `.status()`; `FFG.musicStatus()` is the one that answers the
        // question that now matters — WHICH of the two is making the sound.
        FFG.music = bed;
        FFG.musicStatus = () => ({
            source: bedLive ? "synth-fallback" : "file",
            url: MUSIC_URL,
            reason: bedReason,
            element: shell._music
                ? { paused: shell._music.paused, readyState: shell._music.readyState,
                    currentTime: shell._music.currentTime, loop: shell._music.loop,
                    volume: shell._music.volume, muted: shell._music.muted }
                : null,
            bed: bed ? bed.status() : "absent",
        });

        const hint = document.getElementById("hint");
        /** @type {ReturnType<typeof setTimeout>|null} */
        let hintTimer = null;

        /**
         * Pointer lock is what frees the right button for snow-surf, and PLAY
         * and RESUME are both real clicks, so both may ask for it. A refusal is
         * not an error: Chrome enforces a short cooldown after the player exits
         * a lock with Esc, and `core/input.js` re-locks on the next canvas click
         * regardless.
         * @returns {void}
         */
        function lockPointer() {
            try {
                const p = /** @type {any} */ (canvas.requestPointerLock());
                if (p && p.catch) p.catch(() => {});
            } catch (e) { /* see above */ }
        }

        const shell = new FFG.Shell({
            parent: document.body,
            title: "DRIFTWAKE",
            tagline: "Carve your wake across a world of drifting realms",
            // The title plate: xAI key art, fully covering the canvas so the
            // world is never on screen before PLAY/CONTINUE (owner 2026-08-06).
            menuImage: "./assets/ui/keyart.jpg",
            menuOpaque: true,
            // Frost, not the arcade green: the primary button wears the
            // realm's own colour (the crosshair/HUD accent).
            accent: { ink: "#04141d", hi: "#cdefff", lo: "#6cc3ea",
                edge: "#a8dcf5", glow: "rgba(120,205,245,.40)" },
            canContinue: () => progression.hasSave(),
            continueNote: () => progression.saveSummary(),
            onContinue: () => {
                progression.continueRun();
                // Resume the exact stand (v3 `pos`). Realm first — a
                // position means nothing on the wrong ground — then the
                // teleport. A v1/v2 save has no pos and resumes at the
                // shrine spawn, which is also the failure fallback.
                const sp = progression.savedPos;
                if (sp) {
                    const place = () => {
                        character.position.set(
                            sp.x, terrain.heightAt(sp.x, sp.z), sp.z);
                        if (character.velocity) character.velocity.set(0, 0, 0);
                        character.facing = sp.facing;
                        rig.yaw = sp.facing;
                    };
                    if (sp.realm && sp.realm !== realmToken) {
                        enterRealm(sp.realm).then(place, place);
                    } else {
                        place();
                    }
                }
                S.freezeTime = false;
                armMusic();
                if (hint) {
                    hint.classList.add("show");
                    if (hintTimer) clearTimeout(hintTimer);
                    hintTimer = setTimeout(() => hint.classList.remove("show"), 6000);
                }
                lockPointer();
            },
            music: MUSIC_URL,
            // Difficulty is deliberately absent. There is nothing to be harder
            // or easier at, and a control that changes nothing is worse than no
            // control.
            qualities: ["performance", "balanced", "high", "ultra"],
            defaultQuality: S.preset,
            howTo: [
                { h: "The field", p: "The COLD realm: an open plain of wind-carved snow under a sun ten degrees above the horizon. Sand and ash realms follow. Everywhere you step the snow remembers: boots leave trenches with raised berms, and those berms slump, drift in from upwind and soften over about a minute." },
                { h: "Move", p: "<b>WASD</b> to move · <b>mouse</b> to look · <b>SHIFT</b> toggles run (tap again to walk) · <b>wheel</b> to zoom. Click the scene to capture the pointer." },
                { h: "Jump", p: "<b>SPACE</b>. Let go early to cut the rise short. A hard landing punches a crater and throws powder." },
                { h: "Snow-surf", p: "Hold the <b>RIGHT MOUSE BUTTON</b> and the walk becomes a carve. A breaking wave builds off your inside edge and throws nearly all of the snow to the outside of the turn — the harder you turn, the further the lip hangs back over its own face." },
                { h: "Ollie", p: "Tap <b>SPACE</b> mid-carve for a surf ollie — nearly twice the height, carrying your full speed through the air. The wake gaps under you and, if you keep holding <b>RMB</b>, you land straight back into the carve." },
                { h: "Spells", p: "<b>LMB</b> hurls a bolt — hold to keep throwing; it costs nothing. <b>1</b> sweeps a frost arc: everything in front of you takes the hit, the ground glazes over, and whatever is caught is SLOWED. <b>2</b> a ploughing crescent that shoves what it hits · <b>3</b> a targeted eruption · <b>4</b> a spiral of hexagonal ice that stuns · <b>5</b> three helices that lift everything around you. Spells unlock as you level, and every realm re-elements the whole kit — fire in ash, sand in sand." },
                { h: "Fighting", p: "<b>TAB</b> targets the nearest enemy and cycles outward; one more press past the last drops the target. Spells cost mana and run their own cooldowns — the bolt and the arc are free. Fell a whole pack and that ground stays quiet for a while." },
                { h: "Panels", p: "<b>F1</b> settings · <b>F3</b> debug · <b>Esc</b> pause. The settings panel is live: every slider in it moves the running scene, including the sun." },
            ],
            onPlay: () => {
                // PLAY is a NEW RUN: wipe the save and reset to level 1. The
                // shell already made the overwrite deliberate when a run existed.
                progression.newGame();
                S.freezeTime = false;
                armMusic();
                if (hint) {
                    hint.classList.add("show");
                    if (hintTimer) clearTimeout(hintTimer);
                    hintTimer = setTimeout(() => hint.classList.remove("show"), 6000);
                }
                lockPointer();
            },
            // A real freeze, not a hidden HUD: `dt` becomes exactly 0, so the
            // paused frame is pixel-stable rather than slowly drifting.
            //
            // Releasing the pointer is not decoration. While the lock is held
            // the cursor does not exist and every click is delivered to the
            // canvas rather than hit-tested against the DOM, so a pause menu
            // under a live lock is a menu whose buttons cannot be pressed. The
            // browser usually drops the lock itself when Esc is pressed — but
            // NOT in fullscreen, where `game_controls.js` takes a Keyboard Lock
            // on Escape precisely so the tap reaches the game instead of the
            // browser. Measured: pausing without this leaves RESUME dead.
            onPause: () => {
                progression.save();   // pausing is a save point
                S.freezeTime = true;
                try { document.exitPointerLock(); } catch (e) { /* nothing held it */ }
            },
            onResume: () => {
                S.freezeTime = false;
                lockPointer();
            },
            // The shell already drives its own element's `.volume`; this is the
            // hook for the procedural case. Forwarded unconditionally so the
            // synth carries the player's setting even while it is only standing
            // by — if it ever does take over, it opens at the right level.
            onMusicVolume: (v) => { if (bed) bed.setVolume(v); },
        });

        // Whatever rung the player chose last session, applied before the menu
        // is drawn. A no-op on a first visit: `defaultQuality` above is the
        // preset already running.
        if (shell.quality !== S.preset && PRESETS[shell.quality]) applyPreset(shell.quality);
        if (bed) bed.setVolume(shell.musicVolume);

        // Esc while the pointer is locked is consumed by the browser to release
        // the lock — the keydown never reaches the shell's own Escape handler,
        // so binding pause to the key alone gives a pause button that works only
        // when the game is not being played. Losing the lock IS the gesture.
        document.addEventListener("pointerlockchange", () => {
            if (document.pointerLockElement !== canvas && shell.phase === "playing") {
                shell.pause();
            }
        });

        shell.start();
    }

    // ------------------------------------------------------- shell handover
    //
    // The player gets a title menu and the game does not begin until PLAY, so
    // the frame loop starts FROZEN: `S.freezeTime` makes `dt` exactly 0, which
    // draws the scene as a still (that is what makes it the menu's backdrop)
    // while nothing behind it simulates. `onPlay` clears it.
    //
    // WHY AUTOMATION IS EXEMPT. Every harness script — `shoot.py`,
    // `jumpshot.py`, `perfprobe.py`, `sweep.py` and the rest — drives the page
    // with Playwright and none of them dispatches a click, because a real
    // gesture is the one thing a shot battery must not introduce (it would
    // unlock the audio context mid-shot). A menu they cannot dismiss would
    // freeze the simulation under all fourteen comparison shots and every one
    // of them would come out a motionless idle stand. `navigator.webdriver` is
    // the browser's own statement that it is under automation, so the whole
    // harness surface keeps its pre-shell behaviour byte for byte without a
    // single harness file changing. `?menu=1` forces the menu back on under
    // automation, which is how the shell itself is verified.
    const AUTOPLAY = (() => {
        try {
            const q = new URLSearchParams(location.search);
            if (q.has("menu")) return false;
            if (q.has("autoplay")) return true;
            return !!navigator.webdriver;
        } catch (e) {
            return false;
        }
    })();
    if (!AUTOPLAY) S.freezeTime = true;

    requestAnimationFrame(frame);

    // ARCHITECTURE.md §2 — the comparison harness drives the port and the
    // reference through this identical surface. Every member is load-bearing:
    // if one is missing or misnamed, every screenshot comparison silently
    // breaks. `character` is the CONTROLLER and `figure` is the posed body,
    // matching the reference and `_spec/character.md` §8.
    globalThis.SNOWFLOW = {
        renderer, scene, rig, character, figure, contact, spray, wake, spells,
        overlay, terrain, sky, shadows, post, depthPass,
        // The aim reticle. Not in the §2 contract (the reference has none); it
        // is exposed the way `deform` is — so a probe can read its state
        // without reaching into the DOM. `#crosshair` is chrome-hidden by
        // `_harness/shoot.py`, and only shows under `input.locked` anyway,
        // which automation can never produce.
        crosshair,
        // The spell toolbar, exposed the same way for the same probes.
        spellbar,
        hud, minimap,
        // The battle stack, for probes and the test harness.
        // The realm layer, exposed so a probe can drive a realm change the same
        // way the game will. `enterRealm` is async — it awaits the body fetch.
        weather, realms, enterRealm,
        combat: { registry, spellHits, enemies, encounters, targeting,
            // [LANE B] the arena director — `bosses.stats` is the whole event
            // state (arena, phase, leash, kills) and `bosses.spawnBoss(kind)`
            // is the probe's force path.
            bosses: bossEncounters,
            data: combatData },
        // [LANE B] the gate a realm boss opens — `portal.stats` for probes.
        portal,
        // The enemy windup telegraph rings — exposed the way `deform` is, so
        // the FX probe can read its `.stats` and A/B its `enabled` flag.
        fxTelegraph,
        // The spawn monument (world/shrine.js) — set dressing, exposed for
        // probes the way `deform` is. The training dummies it replaced are
        // gone from this surface deliberately: harnesses spawn real enemies.
        shrine,
        // [LANE-L landmarks] The realm monument layer, exposed the way `shrine`
        // and `deform` are. `landmarks.stats` carries the live realm, the draw
        // count, and every visible instance's anchor — which is the whole
        // surface `_harness/qa_landmarks.py` measures spacing and clearance on.
        landmarks,
        // [HITSTOP] impact time-dilation — exposed for the feel probes
        // (`.stats.triggers`, `.stats.scaleNow`).
        hitstop,
        // [LANE-M motes] the kill-drop heal pool — exposed for the feel probe
        // (`.stats.spawned/.picked/.healed/.active`, `.enabled` for A/B) and
        // for laneB's boss payout (`motes.spawnAt(x, z, 8)`).
        motes,
        progression, floaters, enemyBars, hurtFx, xpHud,
        // The deformation field, alongside the other subsystems it sits between.
        // `_harness/probe_deform_skip.py` reads its `stepsRun`/`stepsSkipped`
        // counters and reads the state buffer back through `texture`, which is
        // the only way to show that the identity-step skip changes no snow.
        deform,
        // The rigged GLB rider (`S.meshCharacter` picks it over `figure`'s
        // render; both simulate). Not in the §2 contract — the reference has
        // one character — exposed the way `deform` and `crosshair` are.
        meshChar,
        S, input, perfStats: stats,
        // TEST MODE toggle (owner 2026-08-16). `SNOWFLOW.test()`
        // flips it; `SNOWFLOW.test(true/false)` sets it.
        test: setTestMode,
        // The write half of the settings store. `S` alone is read-only in
        // practice: most of its keys are sampled next frame and a bare write is
        // fine, but the structural ones only mean anything on the `onChange`
        // edge, and nothing outside the module could reach that edge before
        // these two were exported here. That is precisely how
        // `S.resolutionScale = 0.5` came to be a lever that reported success,
        // read back correctly and resized nothing — through a whole performance
        // sweep. `settings.js` now also routes those keys' accessors into
        // `set`, so both spellings work; these are the explicit surface.
        set, applyPreset, PRESETS, SCHEMA,
        // The CPU-side per-system marks the overlay's "Frame budget" block
        // shows. Exposed so a profiling run can put the CPU and GPU halves of
        // the same window side by side — a GPU scope that spans a CPU gap
        // measures the gap too, and this is what identifies it.
        perfSystems: systemMs,
        // Per-pass GPU profile (`S.debugProfile`). `perfProfile()` returns the
        // running mean per scope since `perfProfileReset()`; both are debug
        // entry points and neither is called from the frame.
        perfProfile: profileSnapshot,
        perfProfileReset: profileReset,
    };

    // The product is DRIFTWAKE; the contract is `SNOWFLOW`. An ALIAS, not a
    // rename and not a wrapper: it is the same object, so `DRIFTWAKE.S === S`
    // and anything written through one is visible through the other. The
    // harness, the whole blind-comparison history and the shared shot battery
    // that drives this build and the WebGPU reference from one file all pin the
    // old name, and it stays exactly as it is.
    globalThis.DRIFTWAKE = globalThis.SNOWFLOW;

    await loading.done();

    // The boot blocked on ONE body per meshEnemies §4; the other nine of
    // the realm stream in now that the screen is up. (Fatal audit gap: this
    // call existed nowhere, so 26 of 30 bodies could never load.)
    enemyVis.stream();

    // ---------------------------------------------------------- the FFG shell
    if (!AUTOPLAY) startShell();
    // The boot itself is one long hitch by construction; let a second of real
    // frames go by before the spike counter means anything.
    setTimeout(() => overlay.resetSpikes(), 800);
}

boot().catch((err) => {
    loading.fail("Startup failed: " + (err && err.message ? err.message : String(err)));
    // Rethrown asynchronously so the page-error handler the harness installs
    // still sees the stack — `loading.fail` swallows nothing, but a caught
    // rejection is invisible to `window.onerror`.
    setTimeout(() => { throw err; }, 0);
});
