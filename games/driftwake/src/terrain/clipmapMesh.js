/**
 * Builds the nested-ring geometry clipmap as a single static mesh.
 *
 * One vertex buffer, one index buffer, one draw call, built once and never
 * touched again. Vertices carry no position — only `(gridI, ringLevel, gridJ)`.
 * The vertex shader turns that into a world position each frame from `lodCenter`,
 * so the terrain follows the player with zero CPU work and zero uploads.
 *
 * Ring geometry:
 *   level 0      a solid square, the finest spacing (0.085 m, 6.8 m half-extent)
 *   level 1..7   square annuli, spacing doubling each step, out to 870.4 m
 *
 * Each annulus's hole is cut three cells *smaller* than the ring it surrounds, so
 * consecutive rings always overlap slightly and can never open a gap when their
 * independently-snapped origins drift apart. Within the overlap band the inner
 * ring's vertices are fully morphed onto the outer ring's lattice (the CDLOD morph
 * completes at |g| = 68.8, the overlap starts at |g| = 74), so both rings describe
 * the identical surface there and the overlap is invisible.
 *
 * Counts, which a correct port must reproduce exactly (_spec/terrain.md §2.2):
 *   side 161 · verts/level 25,921 · total verts 207,368 (2.49 MB)
 *   quads 166,468 · triangles 332,936 · indices 998,808 Uint32 (4.00 MB)
 *
 * ---------------------------------------------------------------------------
 * HANDEDNESS (ARCHITECTURE.md §6) — this file is where the one chirality
 * decision in the terrain is made, on the CPU, once.
 *
 * The reference emits, for an upward-facing heightfield seen from above:
 *     even quad: (a,b,c) (b,d,c)      odd quad: (a,d,c) (a,b,d)
 * which is front-facing under Babylon's LEFT-handed, clockwise-front convention.
 * Three is RIGHT-handed with counter-clockwise front faces, so **the last two
 * indices of every triangle are swapped** here and the beauty material keeps
 * `side: FrontSide`. _spec/terrain.md §13.1 prefers this over `side: BackSide`
 * because the shadow and prepass materials run double-sided anyway, so only the
 * beauty material's culling is load-bearing and an explicit correct winding is
 * less surprising.
 *
 * NO AXIS IS MIRRORED. Flipping Z would have fixed the winding too, and would
 * have reversed the lee-face asymmetry relative to the sun — the whole look hangs
 * on the wind bearing sitting 70-80 degrees off the sun azimuth.
 *
 * Nothing downstream depends on the winding: the shading normal comes entirely
 * from the heightfield gradient, never from the geometry.
 */

import * as THREE from "three";

/** Quads per side, per ring. Must be divisible by 4. */
export const GRID_N = 160;
/** Number of rings. */
export const LEVELS = 8;
/** Vertex spacing of the innermost ring, metres. */
export const BASE_SPACING = 0.085;

/** How many cells to shrink each hole by, to guarantee overlap. */
const HOLE_SHRINK = 3;

const HALF = GRID_N / 2; // 80

/** Half-extent of the finest ring, metres — used to size the deformation area. */
export const INNER_EXTENT = HALF * BASE_SPACING;                          // 6.8
/** Half-extent of the whole clipmap, metres. */
export const OUTER_EXTENT = HALF * BASE_SPACING * Math.pow(2, LEVELS - 1); // 870.4
export const GRID_HALF_N = HALF;

/**
 * @typedef {Object} ClipmapMesh
 * @property {THREE.BufferGeometry} geometry
 * @property {number} triangles
 * @property {number} vertices
 */

/**
 * Build the static clipmap geometry.
 * @returns {ClipmapMesh}
 */
export function buildClipmapGeometry() {
    const side = GRID_N + 1;
    const vertsPerLevel = side * side;

    const positions = new Float32Array(vertsPerLevel * LEVELS * 3);

    // Count indices exactly so the buffer is allocated once and never grown.
    const holeHalf = HALF / 2 - HOLE_SHRINK;              // 37
    const holeQuads = (holeHalf * 2) * (holeHalf * 2);    // 5,476
    const quadCount =
        GRID_N * GRID_N + (LEVELS - 1) * (GRID_N * GRID_N - holeQuads);

    const indices = new Uint32Array(quadCount * 6);

    let vi = 0;
    let ii = 0;

    for (let level = 0; level < LEVELS; level++) {
        const vBase = level * vertsPerLevel;

        // ---- vertices ----------------------------------------------------
        // Every level emits the full lattice; the annulus is expressed purely
        // through which quads get indices. The unreferenced interior vertices cost
        // 12 bytes each and are never shaded — cheaper than special-casing the
        // emission.
        for (let j = 0; j <= GRID_N; j++) {
            const gj = j - HALF;
            for (let i = 0; i <= GRID_N; i++) {
                positions[vi++] = i - HALF; // gridI
                positions[vi++] = level;    // ringLevel
                positions[vi++] = gj;       // gridJ
            }
        }

        // ---- indices -----------------------------------------------------
        for (let j = 0; j < GRID_N; j++) {
            const gj = j - HALF;
            for (let i = 0; i < GRID_N; i++) {
                const gi = i - HALF;

                if (level > 0) {
                    // Skip quads entirely inside the hole.
                    const maxAbs = Math.max(
                        Math.abs(gi), Math.abs(gi + 1),
                        Math.abs(gj), Math.abs(gj + 1)
                    );
                    if (maxAbs <= holeHalf) continue;
                }

                const a = vBase + j * side + i;
                const b = a + 1;
                const c = a + side;
                const d = c + 1;

                // The diagonal alternates per quad. A uniform diagonal leaves a
                // faint corduroy of shading seams all running the same way across
                // the whole field, and it is visible on lit dune flanks
                // (_spec/terrain.md §14 criterion 14).
                //
                // Winding is the reference's with the last two indices of each
                // triangle swapped — see the handedness note in the file header.
                if (((i + j) & 1) === 0) {
                    indices[ii++] = a; indices[ii++] = c; indices[ii++] = b;
                    indices[ii++] = b; indices[ii++] = c; indices[ii++] = d;
                } else {
                    indices[ii++] = a; indices[ii++] = c; indices[ii++] = d;
                    indices[ii++] = a; indices[ii++] = d; indices[ii++] = b;
                }
            }
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(
        ii === indices.length ? indices : indices.subarray(0, ii), 1
    ));

    // The `position` attribute is not a position, so an auto-computed bounding
    // volume describes a 160-unit cube at the origin and would cull the terrain
    // from most angles — including out of the shadow cascades, where the light
    // frustum is not the camera frustum. Both are overridden with something large
    // enough that nothing recomputes them and nothing rejects the draw.
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    geometry.boundingBox = new THREE.Box3(
        new THREE.Vector3(-1e6, -1e6, -1e6),
        new THREE.Vector3(1e6, 1e6, 1e6)
    );

    return { geometry, triangles: ii / 3, vertices: vertsPerLevel * LEVELS };
}
