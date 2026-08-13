/**
 * Player cast rings — the AoE promise under a scheduled cast: the bloom's
 * eruption footprint at its captured target, and the vortex's DoT ring under
 * the player, drawn from the keypress to the strike and snapping out on
 * release.
 *
 * TECHNIQUE ADAPTED, UNDER MIT, from Mohamed Achref Elouafi's
 * LinearAbiltyCastingThreeJS (src/effects/AimIndicator.js and
 * ZoneIndicator.js): the signed-distance boundary band evaluated in metres
 * with a hard liner on its inside lip (the line the player measures against),
 * tick marks stepping the boundary, the trailing rotating sweep, a
 * rim-weighted interior wash — and the SNAP-OUT reveal, the reference's whole
 * personality: on release the radius overshoots on `sin(pi * t^1.7)` and
 * settles back while it flashes and fades, so the circle reads as something
 * the caster DID rather than a UI element. The animation curves run on the
 * CPU (vfx/castRing.js) and this stage stays dumb. See CREDITS.md.
 *
 * Re-expressed from scratch for this port's stack: RawShaderMaterial +
 * GLSL ES 3.00, lib/common, one draw for the pool of two, no per-frame
 * allocation.
 */

/** Pool size — must match CAST_MAX in vfx/castRing.js. */
export const CAST_UNIFORM_MAX = 2;

/**
 * Uniform arrays, one column per ring:
 *
 *   uCastA   (x, y, z, alpha01)      alpha01 < 0 = dead, quad collapses
 *   uCastB   (drawnRadius, r, g, b)  radius INCLUDING the CPU snap overshoot
 *   uCastC   (hot, seed, baseRadius, 0)  hot = the release flash impulse;
 *                                    baseRadius sizes the quad so the
 *                                    overshoot never clips its own edge
 *
 * @type {string}
 */
export const vertex = /* glsl */`
#include "lib/common"

in vec3 position;               // (ringIndex, cornerIndex, unused)

uniform vec4 uCastA[2];
uniform vec4 uCastB[2];
uniform vec4 uCastC[2];

out vec2 vLocal;
out vec4 vAnim;                 // alpha, drawnRadius, hot, seed
out vec3 vCol;

void main() {
    int i = int(position.x);
    int v = int(position.y);

    vec4 a = uCastA[i];
    vec4 b = uCastB[i];
    vec4 c = uCastC[i];

    vec2 k = vec2(
        (v == 1 || v == 2) ? 1.0 : -1.0,
        (v >= 2)           ? 1.0 : -1.0
    );

    float ext = a.w < 0.0 ? 0.0 : c.z * 1.30 + 0.5;

    vLocal = k * ext;
    vAnim = vec4(max(a.w, 0.0), b.x, c.x, c.y);
    vCol = b.yzw;

    vec3 P = a.xyz + vec3(vLocal.x, 0.0, vLocal.y);
    gl_Position = uViewProj * vec4(P, 1.0);
}
`;

/** @type {string} */
export const fragment = /* glsl */`
#include "lib/common"

in vec2 vLocal;
in vec4 vAnim;
in vec3 vCol;

layout(location = 0) out vec4 outColor;

void main() {
    float gate = vAnim.x;
    float R = max(vAnim.y, 0.02);
    float hot = vAnim.z;
    float d = length(vLocal);
    float aa = fwidth(d) + 0.010;

    // ---- the band, and the inside liner the player measures against ----
    float band = smoothstep(0.13 + aa, 0.0, abs(d - R));
    float liner = smoothstep(0.035 + aa, 0.0, abs(d - (R - 0.22)));
    float interior = smoothstep(R + aa, R - aa, d);

    // ---- rim-weighted wash: a volume standing in the ring, not a decal --
    float wash = pow(saturate(d / R), 2.0) * interior * 0.20;

    // ---- ticks + the trailing sweep ------------------------------------
    float ang = atan(vLocal.y, vLocal.x) * INV_PI * 0.5 + 0.5;
    float tick = 1.0 - smoothstep(0.08, 0.14, abs(fract(ang * 24.0 + 0.5) - 0.5));
    tick *= smoothstep(R - 0.34, R - 0.10, d) * smoothstep(R + 0.05, R - 0.05, d);

    float sw = fract(ang - uTime * 0.40 - vAnim.w);
    float sweep = pow(1.0 - sw, 6.0) * smoothstep(0.0, 0.05, sw) * interior;

    float alpha = (band * 0.9 + liner * 0.5 + tick * 0.45 + sweep * 0.40 + wash)
                * gate * (1.0 + hot * 1.6);
    if (alpha < 0.004) discard;

    vec3 white = mix(vCol, vec3(1.0), 0.7);
    vec3 col = vCol * (band * 2.2 + tick * 1.5 + sweep * 1.0 + wash * 0.9)
             + white * (liner * 1.2 + hot * (band * 2.5 + wash * 2.0));
    outColor = vec4(col, saturate(alpha));
}
`;
