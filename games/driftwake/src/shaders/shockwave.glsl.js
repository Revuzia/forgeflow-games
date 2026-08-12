/**
 * The impact shockwave ring — one beauty pair, nothing else.
 *
 * A thin, expanding ground ring under every bolt impact and under the Ash
 * fireball's detonation: the pressure front the flash light implies but nothing
 * used to draw. It reads at a glance because both of its curves are the ones an
 * actual front has — the radius runs on pow(age, 0.55), fast out of the gate
 * and slowing as it spends itself, and the brightness dies linearly with age,
 * so the ring is brightest exactly when it is smallest and tightest.
 *
 * TECHNIQUE ADAPTED, UNDER MIT, from Mohamed Achref Elouafi's
 * LinearAbiltyCastingThreeJS (src/effects/GroundDecals.js, the SHOCKWAVE decal:
 * radius = pow(age, 0.55), band = smoothstep(width, 0, abs(d - radius)),
 * alpha = band * (1 - age)) — see CREDITS.md. Re-expressed here from scratch
 * for this port's stack: RawShaderMaterial + GLSL ES 3.00, the lib/common
 * globals block, one draw for the whole pool, and no per-frame allocation.
 * Nothing from Three's stock material path is involved.
 *
 * ONE DRAW FOR THE POOL. Eight quads in one BufferGeometry; each vertex carries
 * (ringIndex, cornerIndex) and fetches its ring's state from two vec4 uniform
 * arrays — the exact upload pattern `spellLights.js` already uses (a flat
 * Float32Array behind a vec4[N] uniform). A dead ring has age >= 1 and the
 * vertex stage collapses its quad to zero area, so the draw call never depends
 * on how many rings are live — the same switch-off `dart.js` and `crystals.js`
 * use for their pools.
 *
 * VARYING BUDGET: two slots and a half.
 *
 *     vLocal   metres from the ring's centre, in the ground plane
 *     vAnim    (age 0..1, endRadius)
 *     vCol     realm tint — the bolt flash colour, so the ring and the flash
 *              light it rides under are the same event in the same colour
 */

/** Pool size — must match RING_MAX in vfx/shockwave.js. */
export const RING_UNIFORM_MAX = 8;

/**
 * Beauty vertex stage.
 *
 * Uniform arrays, one column per ring:
 *
 *   uRingA   (x, y, z, age01)     age01 >= 1 = dead, quad collapses
 *   uRingB   (endRadius, r, g, b) radius the front reaches at age 1 + tint
 *
 * @type {string}
 */
export const vertex = /* glsl */`
#include "lib/common"

in vec3 position;               // (ringIndex, cornerIndex, unused)

uniform vec4 uRingA[8];
uniform vec4 uRingB[8];

out vec2 vLocal;
out vec2 vAnim;
out vec3 vCol;

void main() {
    int i = int(position.x);
    int v = int(position.y);

    vec4 a = uRingA[i];
    vec4 b = uRingB[i];

    // Quad corners, wound 0-1-2-3 anticlockwise seen from above.
    vec2 c = vec2(
        (v == 1 || v == 2) ? 1.0 : -1.0,
        (v >= 2)           ? 1.0 : -1.0
    );

    // Dead ring: zero-area quad, rasteriser skips it, draw count is constant.
    float ext = a.w >= 1.0 ? 0.0 : b.x;

    vLocal = c * ext;
    vAnim = vec2(a.w, b.x);
    vCol = b.yzw;

    vec3 P = a.xyz + vec3(vLocal.x, 0.0, vLocal.y);
    gl_Position = uViewProj * vec4(P, 1.0);
}
`;

/**
 * Beauty fragment stage.
 *
 * The band profile is smoothstep(w, 0, abs(d - radius)) — soft to the band's
 * own centre, so it needs no explicit AA and never aliases while it moves. A
 * faint interior haze trails the front so the ring reads as displaced air
 * rather than as a drawn circle; both die with (1 - age).
 *
 * @type {string}
 */
export const fragment = /* glsl */`
#include "lib/common"

in vec2 vLocal;
in vec2 vAnim;
in vec3 vCol;

layout(location = 0) out vec4 outColor;

void main() {
    float age = vAnim.x;
    float R = vAnim.y;
    float d = length(vLocal);

    // Fast out, easing as it spends itself — the front of a real blast.
    float radius = R * pow(age, 0.55);

    // Band thickness grows a little with the ring's size, so a fireball's
    // front is heavier than a bolt splash's without a second parameter.
    float w = 0.16 + R * 0.06;
    float band = smoothstep(w, 0.0, abs(d - radius));

    // The trailing haze: inside the front, weighted toward it.
    float haze = smoothstep(radius, radius * 0.30, d) * 0.14;

    float fade = 1.0 - age;
    float alpha = (band + haze) * fade;
    if (alpha < 0.004) discard;

    // Additive: colour carries the energy, alpha scales it (SrcAlpha, One).
    // 2.6 compensates the spawn-time saturation square (vfx/shockwave.js).
    outColor = vec4(vCol * (band * 2.6 + haze * 1.1), alpha);
}
`;
