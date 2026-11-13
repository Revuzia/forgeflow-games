/**
 * Frost-arc sector decal — the crisp flash that makes the key-1 arc's glazed
 * sector read INSTANTLY. The durable mark is the deform ice channel (painted
 * by `spellSystem._fireArc`); this is the one-second decal that snaps out over
 * it: a rime wash shaded off a height field, a bright advancing front, and the
 * sector's own boundary — outer arc rim plus the two radial edges — flashing
 * and dying so the player reads exactly the cone the damage pass tested.
 *
 * TECHNIQUE ADAPTED, UNDER MIT, from Mohamed Achref Elouafi's
 * LinearAbiltyCastingThreeJS (src/effects/GroundDecals.js, the FROST decal):
 * everything sampled in the PLANE, never on the angle (an angular lookup
 * hands every radius along a bearing the same lobe value — that draws a star);
 * the ragged reach (`d * (1 - lobes * k)` against a `pow(age, 0.30)` front);
 * the height-field relief shaded by cheap forward differences against the
 * scene's own sun; the stepped-time glints that twinkle rather than crawl;
 * and the advancing lip that stays lit while it travels. The sector gate and
 * the radial edge lines are this port's own — the reference decal is round.
 * See CREDITS.md.
 *
 * Re-expressed from scratch for this port's stack: RawShaderMaterial +
 * GLSL ES 3.00, lib/common + lib/noise, one draw for the pool of two, no
 * textures, no per-frame allocation.
 */

/** Pool size — must match ARC_MAX in vfx/arcDecal.js. */
export const ARC_UNIFORM_MAX = 2;

/**
 * Uniform arrays, one column per decal:
 *
 *   uArcA   (x, y, z, age01)             age01 >= 1 = dead, quad collapses
 *   uArcB   (dirX, dirZ, reach, halfAng) flat aim frame + the tested cone
 *   uArcC   (r, g, b, seed)
 *
 * @type {string}
 */
export const vertex = /* glsl */`
#include "lib/common"
#include "lib/groundfx"

in vec3 position;               // (decalIndex, gridX 0..16, gridZ 0..16)

uniform vec4 uArcA[2];
uniform vec4 uArcB[2];
uniform vec4 uArcC[2];

out vec2 vLocal;                // (lateral, downrange) metres from the caster
out vec4 vAnim;                 // age, reach, halfAng, seed
out vec3 vCol;

void main() {
    int i = int(position.x);

    vec4 a = uArcA[i];
    vec4 b = uArcB[i];
    vec4 c = uArcC[i];

    float live = a.w < 1.0 ? 1.0 : 0.0;
    float reach = b.z;
    // The grid hugs the sector: full reach downrange (plus the lobes' ragged
    // margin), the cone's own sine laterally, a short apron behind the feet.
    float halfW = (reach * sin(b.w) * 1.12 + 0.9) * live;
    float len = (reach * 1.10 + 0.6) * live;

    // Grid corner fractions: lateral -1..1, downrange 0..1 (vfx/groundfxGrid).
    float cx = position.y * (1.0 / 8.0) - 1.0;
    float cz = position.z * (1.0 / 16.0);
    vLocal = vec2(cx * halfW, cz * len - 0.5 * live);

    vec3 fwd = vec3(b.x, 0.0, b.y);
    vec3 rgt = vec3(b.y, 0.0, -b.x);
    vec2 pXZ = a.xz + fwd.xz * vLocal.y + rgt.xz * vLocal.x;

    // THE CLASS FIX (qa_groundfx.py): every grid vertex sits on the drawn
    // snow — the terrain's own macro/fine/deform chain — instead of the whole
    // decal riding flat at a.y. a.y stays the CPU anchor for probes only.
    float cell = max(halfW * 2.0, len) * (1.0 / 16.0);
    float h = groundFxHeight(pXZ, cell) + groundFxLift(cell);

    vAnim = vec4(a.w, reach, b.w, c.w);
    vCol = c.xyz;

    gl_Position = uViewProj * vec4(pXZ.x, h, pXZ.y, 1.0);
}
`;

/** @type {string} */
export const fragment = /* glsl */`
#include "lib/common"
#include "lib/noise"

in vec2 vLocal;
in vec4 vAnim;
in vec3 vCol;

layout(location = 0) out vec4 outColor;

void main() {
    float age = vAnim.x;
    float reach = vAnim.y;
    float half_ = vAnim.z;
    float seed = vAnim.w;

    vec2 p = vLocal;
    float d = length(p);
    // 0 = straight downrange. p.y < 0 (behind the feet) lands past half_ and
    // the sector gate removes it.
    float theta = atan(abs(p.x), p.y);

    // ---- the ragged advancing front (FROST's drift, in metres) ---------
    float lobes = noise2(p * 0.55 + seed) * 0.5 + 0.5;
    float grow = pow(saturate(age * 1.25), 0.30);
    float front = reach * grow;
    float dR = d * (1.0 - lobes * 0.28);
    float cover = smoothstep(front, front - 2.4, dR);

    // ---- the sector gate, edge slightly ragged -------------------------
    float jit = noise2(p * 0.9 + seed * 2.0) * 0.10;
    float sector = smoothstep(half_ + 0.05, half_ - 0.03, theta + jit);
    if (cover * sector < 0.004) discard;

    // ---- rime relief, shaded by the scene's own key ---------------------
    // Forward differences over a two-octave height field; the shallow 0.35
    // slope keeps it powder, not gravel. Snow's shadow goes blue, not black.
    float e = 0.35;
    #define H(q) (noise2((q) * 1.35 + seed) * 0.6 + noise2((q) * 3.3 + seed * 1.7) * 0.4)
    float h  = H(p);
    float hx = H(p + vec2(e, 0.0));
    float hy = H(p + vec2(0.0, e));
    vec3 nrm = normalize(vec3((h - hx) / e * 0.35, 1.0, (h - hy) / e * 0.35));
    float lam = saturate(dot(nrm, uSunDir));
    float shade = 0.40 + 0.60 * pow(lam, 0.8);
    // Body opacity raised 2026-08-13 (owner: decal unreadably faint), then
    // raised again after the terrain-conform fix: measured on the grade-0.6
    // spawn slope (qa_groundfx.py), the additive wash at 0.58 contributed
    // ~119 changed pixels against the rings' ~2800 — it read as terrain
    // shadow, not as a spell. The ink HUE is authored (realm arcInk, final);
    // these are intensity coefficients only.
    float wash = cover * sector * shade * (0.95 + 0.40 * saturate(h + 0.5));

    // ---- glints — stepped in time so they twinkle, not crawl ------------
    float gl = smoothstep(0.90, 1.0,
        noise2(p * 6.5 + floor(uTime * 7.0) * 0.37 + seed) * 0.5 + 0.5);

    // ---- the crisp boundary: outer arc rim + the two radial edges -------
    float flash = pow(saturate(1.0 - age), 0.55);
    float rim = smoothstep(0.30, 0.0, abs(dR - front)) * sector;
    float radial = smoothstep(0.12, 0.0, abs(theta - half_) * max(d, 0.001))
                 * cover * step(0.3, d);

    float alpha = (wash
                 + rim * 1.5 * flash
                 + radial * 1.1 * flash
                 + gl * cover * sector * 0.5 * flash)
                 * (1.0 - age * age * age);
    if (alpha < 0.004) discard;

    vec3 white = mix(vCol, vec3(1.0), 0.35);
    vec3 col = vCol * (wash * 3.6 + rim * 4.2 + radial * 3.2)
             + white * gl * cover * sector * 1.6;
    outColor = vec4(col, saturate(alpha));
}
`;
