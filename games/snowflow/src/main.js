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
import { S, onChange } from "./core/settings.js";
import {
    sample, checkSpike, stats, mark, installDrawCounter, endFrameDraws,
} from "./core/perf.js";
import { initInput, pollInput, endFrame, input } from "./core/input.js";
import { CameraRig } from "./core/camera.js";
import { checkCaps, warmUp } from "./core/gfx.js";
import * as loading from "./core/loading.js";

import { Sky } from "./render/sky.js";
import { ShadowSystem } from "./render/shadows.js";
import { DepthPass } from "./render/depthPass.js";
import { DeformationField } from "./terrain/deformation.js";
import { Terrain } from "./terrain/terrain.js";
import { CharacterController } from "./character/controller.js";
import { Character } from "./character/character.js";
import { SnowContact } from "./character/snowContact.js";
import { SprayField } from "./vfx/particles.js";
import { SurfWake } from "./vfx/surfWake.js";
import { SpellSystem } from "./spells/spellSystem.js";
import { PostChain } from "./post/postChain.js";
import { Overlay } from "./ui/overlay.js";

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

    // The rig needs ground heights to keep the spring arm above the snow.
    rig.groundAt = (x, z) => terrain.heightAt(x, z);

    post = new PostChain(renderer, rig.camera, { depthPass, sky });
    applySize(); // now that `post` exists, give it the real drawing-buffer size

    const overlay = new Overlay({ rig, character, renderer });
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

    // Stand real geometry up in the systems that are empty at rest, so the warm
    // draws rasterise something. Each is undone after the warm frames.
    spray.warmUpSeed();
    spray.update(0, rig.camera);
    wake.warmUpSeed();
    spells.warmUp(character.position.x + 3, character.position.y, character.position.z + 3);

    // One compile-and-draw over the whole beauty scene. The spell meshes are
    // forced visible for the duration and put back exactly as they were.
    await warmUp(renderer, scene, rig.camera, [
        ...spells.warmUpMeshes, ...figure.warmUpMeshes(), wake.mesh, spray.mesh,
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

        // Beauty into the HDR target the post chain reads. `autoClear` is on
        // here (and only here), so this is the frame's colour+depth clear.
        renderer.setRenderTarget(post.sceneTarget);
        renderer.render(scene, rig.camera);
        renderer.setRenderTarget(null);

        post.render();
        post.endFrame();
    }

    function frame() {
        requestAnimationFrame(frame);

        const now = performance.now();
        let dtMs = now - prev;
        prev = now;
        if (dtMs > MAX_FRAME_MS) dtMs = MAX_FRAME_MS;
        const dt = S.freezeTime ? 0 : dtMs / 1000;
        time += dt;

        pollInput();

        // Per-system CPU timing. The GPU row is a whole-frame timer-query
        // number, so these are not subdivisions of it — the overlay labels them
        // `cpu` for that reason.
        const tFrame = performance.now();

        character.update(dt, rig);
        terrain.clampToPlayArea(character.position);
        // Pose and simulate before the contact pass: the footprints are stamped
        // at the boot's actual planted position, which only exists once the
        // figure has been solved.
        figure.update(dt);
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
        const tSpells = performance.now();

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
        // Before the spray: the grains the wake sheds have to be in the pool
        // before the pool is uploaded.
        wake.update(dt, rig.camera);
        spray.update(dt, rig.camera);
        const tVfx = performance.now();

        drawFrame();
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
        overlay.update(dtMs, renderer);

        endFrame();
    }

    requestAnimationFrame(frame);

    // ARCHITECTURE.md §2 — the comparison harness drives the port and the
    // reference through this identical surface. Every member is load-bearing:
    // if one is missing or misnamed, every screenshot comparison silently
    // breaks. `character` is the CONTROLLER and `figure` is the posed body,
    // matching the reference and `_spec/character.md` §8.
    globalThis.SNOWFLOW = {
        renderer, scene, rig, character, figure, contact, spray, wake, spells,
        overlay, terrain, sky, shadows, post, depthPass,
        S, input, perfStats: stats,
    };

    await loading.done();
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
