/**
 * The shared grid geometry for the three ground-conforming FX pools — the CPU
 * half of `shaders/lib/groundfx.glsl.js`.
 *
 * Each pool slot used to be a single quad (4 corners, 2 triangles) placed
 * flat at the cast point's height, which is the class bug qa_groundfx.py
 * measured: on a grade-0.6 dune the uphill half buried and the downhill half
 * floated. Each slot is now a GRID_N x GRID_N grid of quads whose vertices
 * the vertex stage displaces by the terrain's own GPU height chain
 * (`groundFxHeight`), so the decal drapes the landform.
 *
 * The position attribute is NOT a position (same trick as the old corner
 * encoding, and as the clipmap's grid attribute):
 *
 *     .x  slot index      0 .. slots-1   picks the uniform column
 *     .y  grid X          0 .. GRID_N    lateral corner fraction * GRID_N
 *     .z  grid Z          0 .. GRID_N    downrange corner fraction * GRID_N
 *
 * Built once at construction — one geometry, one mesh, ONE DRAW per pool,
 * exactly as before; a dead slot still collapses to zero area in the vertex
 * stage because its extent multiplies to 0. Allocation per frame: none.
 */

import * as THREE from "three";

/**
 * Grid segments per decal edge. 16 is the design point: cells of ~0.3-1.1 m
 * across the three footprints, which resolves the macro landform and the
 * deform field everywhere while `groundFxLift` covers the unresolved tail of
 * the fine field. Must stay in step with the 1/16 constants in the three
 * vertex stages.
 */
export const GRID_N = 16;

/**
 * Build the indexed grid geometry for a pool of `slots` decals.
 *
 * @param {number} slots pool size (2 for arc/cast rings, 8 for telegraphs)
 * @returns {THREE.BufferGeometry}
 */
export function buildGroundFxGrid(slots) {
    const side = GRID_N + 1;
    const vertsPer = side * side;
    const pos = new Float32Array(slots * vertsPer * 3);
    const idx = new Uint16Array(slots * GRID_N * GRID_N * 6);

    for (let i = 0; i < slots; i++) {
        for (let gz = 0; gz < side; gz++) {
            for (let gx = 0; gx < side; gx++) {
                const v = (i * vertsPer + gz * side + gx) * 3;
                pos[v + 0] = i;
                pos[v + 1] = gx;
                pos[v + 2] = gz;
            }
        }
        let k = i * GRID_N * GRID_N * 6;
        for (let gz = 0; gz < GRID_N; gz++) {
            for (let gx = 0; gx < GRID_N; gx++) {
                const o = i * vertsPer + gz * side + gx;
                idx[k++] = o;
                idx[k++] = o + 1;
                idx[k++] = o + side + 1;
                idx[k++] = o;
                idx[k++] = o + side + 1;
                idx[k++] = o + side;
            }
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geometry.setIndex(new THREE.BufferAttribute(idx, 1));
    return geometry;
}
