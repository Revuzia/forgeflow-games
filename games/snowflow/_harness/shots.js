/**
 * SNOWFLOW comparison shot battery.
 *
 * These run identically against the WebGPU reference and the Three.js port,
 * because both expose the same `globalThis.SNOWFLOW` surface:
 *
 *   SNOWFLOW.S                       settings object (mutable in place)
 *   SNOWFLOW.rig                     { yaw, pitch, distance, distanceTarget }
 *   SNOWFLOW.character               { position, velocity, surfActive, yaw }
 *   SNOWFLOW.terrain.heightAt(x,z)   ground height, metres
 *   SNOWFLOW.spells.cast(n)          n = 1..5
 *   SNOWFLOW.spells.holdRibbon(b)
 *   SNOWFLOW.input                   { surf, ... } live input state
 *
 * Each shot is { name, desc, tests, pose(SF), settle }.
 *  - pose()  runs once, synchronously, before the settle wait.
 *  - settle  seconds of real time to let TAA converge / sim advance.
 *  - hold()  optional, runs every 100ms during settle (for held inputs).
 */

// A fixed spot on the dune field with good macro relief in frame. Chosen once
// so every shot in the battery is comparable run to run.
const SPOT = { x: 0, z: 0 };

function place(SF, x, z) {
    SF.character.position.x = x;
    SF.character.position.z = z;
    SF.character.position.y = SF.terrain.heightAt(x, z);
    SF.character.velocity.x = 0;
    SF.character.velocity.y = 0;
    SF.character.velocity.z = 0;
}

function look(SF, yaw, pitch, dist) {
    SF.rig.yaw = yaw;
    SF.rig.pitch = pitch;
    SF.rig.distance = dist;
    SF.rig.distanceTarget = dist;
}

/** Press/release a real key the way the page's own listeners expect. */
function key(code, down) {
    window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { code, bubbles: true }));
}

/**
 * Pin a held-input flag on.
 *
 * A plain write loses: the demo's `mouseup` handler clears `input.surf`
 * unconditionally (no pointer-lock guard), and `_dispatch` re-reads
 * `spellHeld2` every frame. Both are real held inputs that only a locked
 * pointer can produce, and pointer lock needs a user gesture we cannot forge.
 * Redefining the property as a constant getter is the one write nothing else
 * in the page can undo.
 */
function pin(obj, prop, value) {
    Object.defineProperty(obj, prop, {
        get: () => value, set: () => {}, configurable: true,
    });
}

export const SHOTS = [
    {
        name: "01-hero",
        desc: "Default spawn framing: low sun over the dune field, character mid-frame.",
        tests: "overall art direction, tonemap, exposure, macro dune silhouette, aerial haze",
        settle: 3.0,
        pose(SF) {
            place(SF, SPOT.x, SPOT.z);
            look(SF, 2.4, 0.17, 6.2);
        },
    },
    {
        name: "02-snow-grazing",
        desc: "Camera dropped low and aimed across the slope at a grazing angle.",
        tests: "sastrugi + ripple normals, three tiled detail scales, view-dependent glints, grazing gate",
        settle: 3.0,
        pose(SF) {
            place(SF, SPOT.x, SPOT.z);
            // Sun bearing is 118deg; look roughly back into it across the ridges.
            look(SF, 2.06, -0.06, 3.0);
        },
    },
    {
        name: "03-shadow-penumbra",
        desc: "Character shadow raking away down a clean slope.",
        tests: "PCSS blocker search, penumbra widening with distance, cascade blend, contact hardness",
        settle: 3.0,
        pose(SF) {
            place(SF, SPOT.x, SPOT.z);
            look(SF, 5.5, 0.42, 7.5);
        },
    },
    {
        name: "04-backlit-sss",
        desc: "Sun low behind the crest ahead — the snow is lit from behind.",
        tests: "back-scatter subsurface, depth-dependent blue tint, wrapped diffuse, rim on the crest",
        settle: 3.0,
        pose(SF) {
            place(SF, SPOT.x, SPOT.z);
            // Face the sun bearing (118deg -> yaw ~2.06 rad) with the crest between.
            look(SF, 2.06, 0.05, 5.0);
        },
    },
    {
        name: "05-trail-berms",
        desc: "Walked a line then turned to look back down it.",
        tests: "deformation buffer: trench depth, raised berms, berm self-shadowing, silhouette break",
        settle: 2.0,
        pose(SF) {
            place(SF, SPOT.x, SPOT.z);
            look(SF, 2.4, 0.30, 6.2);
            key("KeyW", true);
        },
        // Walk out, then turn and look back at the trail we just cut.
        after(SF) {
            key("KeyW", false);
            SF.rig.yaw += Math.PI;
            SF.rig.pitch = 0.46;
            SF.rig.distance = SF.rig.distanceTarget = 5.4;
        },
        walk: 7.0,
    },
    {
        name: "06-surf-wake",
        desc: "Mid-carve on the snow-surf, wake wall at full height.",
        tests: "swept wake mesh, breaking-wave cross-section, curl/overhang, two spray populations, streaks",
        settle: 1.2,
        pose(SF) {
            place(SF, SPOT.x, SPOT.z);
            look(SF, 2.4, 0.20, 7.6);
            pin(SF.input, "surf", true);
            key("KeyW", true);
            key("KeyD", true);
        },
        walk: 5.0,
        after(SF) {
            // Frame the standing wall from the side. Surf stays pinned, so it
            // does not collapse before the shutter.
            SF.rig.yaw -= 1.15;
            SF.rig.pitch = 0.24;
        },
    },
    {
        name: "07-spell-sweep",
        desc: "Spell 1 — crescent of slush ploughing outward.",
        tests: "swept water surface, foam channel, refraction/dispersion, ploughed channel + thrown berms",
        settle: 1.1,
        pose(SF) {
            place(SF, SPOT.x, SPOT.z);
            look(SF, 2.4, 0.28, 7.2);
            SF.spells.cast(1);
        },
    },
    {
        name: "08-spell-ribbon",
        desc: "Spell 2 — held stream drawing precessing figure-eights.",
        tests: "parallel-transported frame, ribbon continuity, thin scored lines in the snow, dynamic light",
        settle: 1.0,
        pose(SF) {
            place(SF, SPOT.x, SPOT.z);
            look(SF, 2.4, 0.22, 7.2);
            // The system polls `spellHeld2` every frame, so pin that rather
            // than calling holdRibbon() — a direct call is released next frame.
            pin(SF.input, "spellHeld2", true);
            SF.spells.holdRibbon(true);
        },
        walk: 2.2,
    },
    {
        name: "09-spell-bloom",
        desc: "Spell 3 — targeted eruption, column at full extension.",
        tests: "crater + raised rim, waisted column, fallout curtain lit from below, 4-slot light pool",
        settle: 0.9,
        pose(SF) {
            place(SF, SPOT.x, SPOT.z);
            look(SF, 2.4, 0.30, 8.4);
            SF.spells.cast(3);
        },
    },
    {
        name: "10-spell-crystallize",
        desc: "Spell 4 — hexagonal prisms grown on a golden-angle spiral.",
        tests: "flat hard facets from screen-space derivatives, alpha-blend + depth-write ordering, SSR on ice",
        settle: 1.6,
        pose(SF) {
            place(SF, SPOT.x, SPOT.z);
            look(SF, 2.4, 0.26, 6.6);
            SF.spells.cast(4);
        },
    },
    {
        name: "11-spell-vortex",
        desc: "Spell 5 — three helices of lifted snow winding around the player.",
        tests: "helix geometry, airborne mass at tangential velocity, negative depression under the player",
        settle: 1.4,
        pose(SF) {
            place(SF, SPOT.x, SPOT.z);
            look(SF, 2.4, 0.18, 7.0);
            SF.spells.cast(5);
        },
    },
    {
        name: "12-far-range",
        desc: "Horizon framing — the raymarched far range behind the snow field.",
        tests: "raymarched ridges occluding ridges, sun-march self-shadow, haze match between near and far",
        settle: 3.0,
        pose(SF) {
            place(SF, SPOT.x, SPOT.z);
            look(SF, 2.9, -0.10, 9.5);
        },
    },
    {
        name: "13-char-closeup",
        desc: "Spring arm pulled to minimum — the figure fills the frame.",
        tests: "cloth folds in the rest shape, hem riding the snow, shell fur at hood rim + cuffs, fabric weave",
        settle: 3.0,
        pose(SF) {
            place(SF, SPOT.x, SPOT.z);
            look(SF, 0.9, 0.12, 2.6);
        },
    },
    {
        name: "14-sky-sun",
        desc: "Aimed up into the sun over a crest.",
        tests: "Nishita gradient, sun disc, bloom threshold in exposed units, volumetric shafts past the crest",
        settle: 3.0,
        pose(SF) {
            place(SF, SPOT.x, SPOT.z);
            look(SF, 2.06, -0.40, 6.2);
        },
    },
];

globalThis.__SNOWFLOW_SHOTS__ = SHOTS;
