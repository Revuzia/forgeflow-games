/**
 * The garments' three vertex stages.
 *
 * Port of `snowflow_demo/src/shaders/cloth.vertex.wgsl`,
 * `clothDepth.vertex.wgsl` and `clothPrepass.vertex.wgsl`.
 *
 * `position` carries no position at all — it is `(u, v, panelIndex)`. Everything
 * spatial comes out of `sampleCloth` in `lib/charSkin`, which is why a 36x12
 * Verlet solve can be drawn as a 72x32 surface with no visible faceting, and why
 * the simulation cost is completely independent of how finely the garment is
 * tessellated.
 *
 * All three include the SAME reconstruction from the SAME chunk. That is not
 * tidiness, it is the requirement in ARCHITECTURE.md §5: a robe that casts the
 * shape of its bind pose while drawing the shape of its simulation is worse than
 * no shadow at all. There is no automatic depth path that could get this right,
 * because there is no CPU geometry matching what is drawn.
 *
 * The beauty stage emits the identical five varyings `char.vertex` does, so the
 * body and the garments share one fragment shader (`charFragment`).
 *
 * `panelParams[i]` is `(nodeRow, cols, rows, unused)` for panel i, uploaded by
 * `character/character.js`. Six slots declared, four used — the reference's
 * spare capacity, kept.
 *
 * HANDEDNESS: none of these three lines of arithmetic has an opinion. The one
 * place the z mirror reaches the garments is the column order of the simulated
 * grid, which is applied on the CPU in `character/cloth.js` and paid off by
 * `cross(pv, pu)` inside `sampleCloth`; both are documented at length there.
 */

import { PREPASS_VS_VARYINGS, PREPASS_EMIT } from "./prepass.glsl.js";
import { CHAR_VS_VARYINGS } from "./char.glsl.js";

/**
 * Beauty pass. `s.tanU` is computed by `sampleCloth` and deliberately not used —
 * the fabric fragment shader derives its anisotropy direction from screen-space
 * derivatives instead, so both the body and the garments get a tangent frame
 * without either carrying an authored one.
 * @type {string}
 */
export const CLOTH_VERTEX = /* glsl */`
#include "lib/charSkin"

in vec3 position;   // (u, v, panel index)
in vec2 uv;         // weave coordinates, metres of surface
in vec2 aux;        // (material id, baked occlusion)

uniform mat4 uViewProj;
uniform vec3 uCameraPos;
/// Per panel: (first row in the transform texture, cols, rows, unused).
uniform vec4 panelParams[6];

${CHAR_VS_VARYINGS}

void main() {
    vec4 pp = panelParams[int(position.z)];
    ClothSample s = sampleCloth(int(pp.x), int(pp.y), int(pp.z), position.x, position.y);

    vWorld = s.pos;
    vNormal = s.nrm;
    vUV = uv;
    vAux = aux;
    vViewDist = distance(s.pos, uCameraPos);
    gl_Position = uViewProj * vec4(s.pos, 1.0);
}
`;

/**
 * Shadow-cascade stage. Same include, same reconstruction, by construction —
 * which is what puts the simulated pleats into the garment's cast shadow.
 * @type {string}
 */
export const CLOTH_DEPTH_VERTEX = /* glsl */`
#include "lib/charSkin"

in vec3 position;   // (u, v, panel index)

uniform mat4 lightViewProjection;
uniform vec4 panelParams[6];

void main() {
    vec4 pp = panelParams[int(position.z)];
    ClothSample s = sampleCloth(int(pp.x), int(pp.y), int(pp.z), position.x, position.y);
    gl_Position = lightViewProjection * vec4(s.pos, 1.0);
}
`;

/**
 * Depth prepass. `vViewZ = clip.w` is LINEAR view depth carried as a varying,
 * not `gl_FragCoord.z`; `vMask = 0` because the garments contribute no
 * specular/SSR mask.
 * @type {string}
 */
export const CLOTH_PREPASS_VERTEX = /* glsl */`
#include "lib/charSkin"

in vec3 position;   // (u, v, panel index)

uniform mat4 viewProjection;
uniform vec4 panelParams[6];

${PREPASS_VS_VARYINGS}
${PREPASS_EMIT}

void main() {
    vec4 pp = panelParams[int(position.z)];
    ClothSample s = sampleCloth(int(pp.x), int(pp.y), int(pp.z), position.x, position.y);
    prepassEmit(viewProjection * vec4(s.pos, 1.0), 0.0);
}
`;
