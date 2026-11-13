/**
 * Enemy windup telegraphs — SDF ground rings at a winding enemy's feet, the
 * band drawn at the attack's TRUE tested reach, with an interior fill that
 * expands with the windup flash and meets the boundary exactly when the
 * strike lands. This is the readability feature: the player is never guessing
 * where the edge of the hit is or when it arrives.
 *
 * TECHNIQUE ADAPTED, UNDER MIT, from Mohamed Achref Elouafi's
 * LinearAbiltyCastingThreeJS (src/effects/ZoneIndicator.js): a signed-distance
 * ring evaluated in METRES from the quad's own centre — so the boundary band
 * keeps its 0.15 m thickness whatever the footprint radius, which is the
 * entire point of drawing it — plus its tick marks stepping around the
 * boundary and its trailing rotating sweep (`pow(1 - phase, 6)` feathered at
 * the wrap so it reads as rotation, not a wedge). The reference arms its ring
 * from the player's cast; here it is armed from `enemies.js`'s per-slot
 * windup flash, and the fill front is that flash. See CREDITS.md.
 *
 * Re-expressed from scratch for this port's stack: RawShaderMaterial +
 * GLSL ES 3.00, lib/common, one draw for the whole pool (eight quads, vec4
 * uniform arrays, dead quads collapse in the vertex stage), no per-frame
 * allocation, no textures.
 */

/** Pool size — must match TELE_MAX in vfx/telegraph.js. */
export const TELE_UNIFORM_MAX = 8;

/**
 * Uniform arrays, one column per ring:
 *
 *   uTeleA   (x, y, z, fill01)      fill01 < 0 = dead, quad collapses
 *   uTeleB   (radius, r, g, b)      the attack's tested reach + warning tint
 *
 * @type {string}
 */
export const vertex = /* glsl */`
#include "lib/common"
#include "lib/groundfx"

in vec3 position;               // (ringIndex, gridX 0..16, gridZ 0..16)

uniform vec4 uTeleA[8];
uniform vec4 uTeleB[8];

out vec2 vLocal;
out vec2 vAnim;
out vec3 vCol;

void main() {
    int i = int(position.x);

    vec4 a = uTeleA[i];
    vec4 b = uTeleB[i];

    // Grid corner fractions -1..1 on both axes (vfx/groundfxGrid).
    vec2 c = vec2(position.y, position.z) * (1.0 / 8.0) - 1.0;

    // Dead ring: zero-area grid, the pool's constant-draw switch-off.
    float ext = a.w < 0.0 ? 0.0 : b.x + 0.55;

    vLocal = c * ext;
    vAnim = vec2(max(a.w, 0.0), b.x);
    vCol = b.yzw;

    // THE CLASS FIX (qa_groundfx.py): the ring drapes the drawn snow via the
    // terrain's own macro/fine/deform chain instead of riding flat at a.y —
    // uphill of a winding enemy the old quad was buried, downhill it floated.
    vec2 pXZ = a.xz + vLocal;
    float cell = ext * (2.0 / 16.0);
    float h = groundFxHeight(pXZ, cell) + groundFxLift(cell);

    gl_Position = uViewProj * vec4(pXZ.x, h, pXZ.y, 1.0);
}
`;

/** @type {string} */
export const fragment = /* glsl */`
#include "lib/common"

in vec2 vLocal;
in vec2 vAnim;
in vec3 vCol;

layout(location = 0) out vec4 outColor;

void main() {
    float fill = vAnim.x;
    float R = vAnim.y;
    float d = length(vLocal);
    float aa = fwidth(d) + 0.012;

    // ---- the band that IS the reach -----------------------------------
    float band = smoothstep(0.15 + aa, 0.0, abs(d - R));
    float interior = smoothstep(R + aa, R - aa, d);

    // ---- the fill front, synced to the windup -------------------------
    // Full exactly when the flash saturates — which enemies.js ramps to 1
    // exactly at the strike. The front liner is the moving edge the player
    // actually reads the timing from.
    float rf = R * fill;
    float wash = smoothstep(rf, rf - 0.7, d) * interior;
    float front = smoothstep(0.10 + aa, 0.0, abs(d - rf)) * step(0.02, fill);

    // ---- boundary furniture -------------------------------------------
    float ang = atan(vLocal.y, vLocal.x) * INV_PI * 0.5 + 0.5;
    float tick = 1.0 - smoothstep(0.10, 0.16, abs(fract(ang * 12.0 + 0.5) - 0.5));
    tick *= smoothstep(R - 0.42, R - 0.12, d) * smoothstep(R + 0.06, R - 0.06, d);

    // Trailing sweep, feathered at the wrap — reads as rotating, i.e. armed.
    float sw = fract(ang - uTime * 0.55);
    float sweep = pow(1.0 - sw, 6.0) * smoothstep(0.0, 0.05, sw) * interior;

    // Urgency: everything brightens as the strike arrives.
    float urg = 0.55 + 0.45 * fill * fill;

    float alpha = (band * (0.5 + 0.5 * fill)
                 + wash * (0.10 + 0.24 * fill)
                 + front * 0.85
                 + tick * 0.40
                 + sweep * 0.35) * urg;
    if (alpha < 0.004) discard;

    vec3 col = vCol * (band * 2.4 + wash * 1.1 + tick * 1.4 + sweep * 0.8)
             + mix(vCol, vec3(1.0), 0.65) * front * 2.2;
    outColor = vec4(col, saturate(alpha));
}
`;
