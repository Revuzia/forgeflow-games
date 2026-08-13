/**
 * Impact burst shells — dissolving noise-displaced spheres on the three big
 * detonations (wave/fireball landing, bloom eruption, spikes detonation).
 *
 * TECHNIQUE ADAPTED, UNDER MIT, from Mohamed Achref Elouafi's
 * LinearAbiltyCastingThreeJS (src/effects/BurstSphere.js): a pooled icosphere
 * whose vertices billow along their normals on scrolling noise, expanding on an
 * outQuint ease, with a heat-keyed dissolve mask eating the shell away and a
 * fresnel rim carrying most of the late-life read. The elemental modes (FROST's
 * crystallising plates, FIRE's burning tear-line, EARTH's dense heat-mixed
 * ball) are folded into two continuous parameters — `plates` and `ember` — fed
 * from the realm palette instead of compile-time `#define` modes, so ONE
 * program serves all three realms. See CREDITS.md.
 *
 * Re-expressed from scratch for this port's stack: RawShaderMaterial +
 * GLSL ES 3.00, the lib/common globals block, lib/noise for the displacement,
 * one draw for the whole pool (six icospheres in one BufferGeometry, per-shell
 * state in vec4 uniform arrays — the shockwave pool's exact upload pattern),
 * and no per-frame allocation. A dead shell has age01 >= 1 and the vertex
 * stage collapses it to zero radius, so the draw never depends on how many
 * shells are live.
 *
 * VARYING BUDGET: vNrm/vView for the fresnel, vHeat (the vertex stage's own
 * displacement noise, reused as the dissolve/plate mask exactly as the
 * reference reuses it), vAnim (age, seed, plates, ember), vColA/vColB tints.
 */

/** Pool size — must match BURST_MAX in vfx/burst.js. */
export const BURST_UNIFORM_MAX = 6;

/**
 * Uniform arrays, one column per shell:
 *
 *   uBurstA   (x, y, z, age01)               age01 >= 1 = dead, shell collapses
 *   uBurstB   (endRadius, coreR, coreG, coreB)
 *   uBurstC   (seed, plates, ember, squash)  plates = realm ice row,
 *                                            ember = realm emits (ash), squash
 *                                            flattens a ground burst into a dome
 *   uBurstD   (deepR, deepG, deepB, startRadius)
 *
 * @type {string}
 */
export const vertex = /* glsl */`
#include "lib/common"
#include "lib/noise"

in vec3 position;               // unit icosphere
in vec3 normal;
in float aShell;

uniform vec4 uBurstA[6];
uniform vec4 uBurstB[6];
uniform vec4 uBurstC[6];
uniform vec4 uBurstD[6];

out vec3 vNrm;
out vec3 vView;
out float vHeat;
out vec4 vAnim;
out vec3 vColA;
out vec3 vColB;

void main() {
    int i = int(aShell);
    vec4 A = uBurstA[i];
    vec4 B = uBurstB[i];
    vec4 C = uBurstC[i];
    vec4 D = uBurstD[i];

    float age = clamp(A.w, 0.0, 1.0);
    float live = A.w < 1.0 ? 1.0 : 0.0;

    // outQuint: the classic explosion silhouette — fast out of the gate,
    // easing as it spends itself (the reference's expansion curve).
    float k = 1.0 - pow(1.0 - age, 5.0);
    float R = mix(D.w, B.x, k) * live;

    // Billowing surface: two octaves of noise pushed along the normal,
    // scrolling as the burst expands. Computed ONCE here and reused by the
    // fragment stage as the dissolve/plate mask — the reference's own trick.
    vec3 np = normal * (1.7 + age * 1.5) + vec3(C.x) - vec3(0.0, uTime * 0.6, 0.0);
    float n = noise3(np) * 0.68 + noise3(np * 2.3 + vec3(C.x * 1.3)) * 0.32;
    vHeat = n * 0.5 + 0.5;

    float amount = 0.32 + age * 0.55;
    vec3 pos = position * (1.0 + n * amount);

    vec3 world = A.xyz + vec3(pos.x * R, pos.y * R * C.w, pos.z * R);

    vNrm = normal;
    vView = uCameraPos - world;
    vColA = B.yzw;
    vColB = D.xyz;
    vAnim = vec4(A.w, C.x, C.y, C.z);

    gl_Position = uViewProj * vec4(world, 1.0);
}
`;

/**
 * Beauty fragment stage: fresnel rim + heat gradient + dissolve, with the
 * FROST plates and the FIRE tear-line as continuous parameters.
 * @type {string}
 */
export const fragment = /* glsl */`
#include "lib/common"
#include "lib/noise"

in vec3 vNrm;
in vec3 vView;
in float vHeat;
in vec4 vAnim;
in vec3 vColA;
in vec3 vColB;

layout(location = 0) out vec4 outColor;

void main() {
    float age = vAnim.x;
    float seed = vAnim.y;
    float plates = vAnim.z;
    float ember = vAnim.w;

    vec3 N = normalize(vNrm);
    vec3 V = normalize(vView);
    float fres = pow(1.0 - abs(dot(N, V)), 2.2);

    float heat = saturate(vHeat);

    // The dissolve front eats the shell from its low-heat troughs outward as
    // it ages; the tear-line is the band the front is currently burning
    // through — bright in ash (ember 1), quiet in cold.
    float dEdge = heat - (age * 1.30 - 0.12);
    float body = smoothstep(0.0, 0.22, dEdge);
    float tear = smoothstep(0.20, 0.0, abs(dEdge - 0.06));

    // FROST plates: the shell crystallises in patches and stays glassy
    // between them (the reference's FROST mode, driven by the ice row).
    float cells = noise3(N * 7.0 + vec3(seed * 3.7)) * 0.5 + 0.5;
    float plate = smoothstep(0.35, 0.80, cells) * plates;

    vec3 col = mix(vColB, vColA, heat);
    col = mix(col, vColA * 1.5, plate * 0.8);
    col += vColA * fres * (0.9 + plates * 0.7);
    col += vColA * tear * ember * 2.6;

    float fade = 1.0 - age;
    float alpha =
        fade * (0.16 + fres * 0.80 + plate * 0.45 + tear * ember * 0.5) * body;
    if (alpha < 0.004) discard;

    // Additive: colour carries the energy (SrcAlpha, One). 2.1 compensates
    // the spawn-time channel squaring in vfx/burst.js.
    outColor = vec4(col * 2.1 * fade, saturate(alpha));
}
`;
