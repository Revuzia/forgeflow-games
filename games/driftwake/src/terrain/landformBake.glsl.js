/**
 * The REALM macro height bake. [TERRAIN — laneE]
 *
 * A second, parameterised twin of `shaders/heightBake.glsl.js`. It exists as a
 * separate program rather than as extra uniforms on the original for one
 * reason, and the reason is a hard requirement: **Cold at boot must stay
 * byte-identical**. Feeding `58.0` in through a uniform instead of writing it as
 * a literal is mathematically the same multiply, but it moves the divide in
 * `windMat`'s `sx / scale` from compile time (where a driver may fold it in
 * double precision and round once) to run time (f32 throughout), and the two can
 * differ by an ulp. An ulp of height is invisible on screen and fatal to a
 * "prove no drift" check. So `Heightfield` keeps the original program and uses
 * it whenever the landform block is Cold's, and only reaches for this one when a
 * realm actually asks for a different shape. Nothing in Cold's path changed.
 *
 * Output is the same RG32F contract as the original:
 *   .r  height in metres — macro landform, basins, rock displacement
 *   .g  rock mask 0..1
 *
 * WHY THE WIND BEARING IS NOT A LANDFORM PARAMETER. Rotating the macro layers
 * per realm is the cheapest possible "different terrain", and it is wrong: the
 * fine sastrugi layer (`lib/terrain`'s `fineField`, evaluated live in the
 * clipmap vertex and snow fragment stages) reads `S.windDirection` every frame
 * and cannot see this bake. Turn the dunes without turning the wind and the
 * ripples run across the drifts they are supposed to have been carved by. The
 * realm therefore changes WAVELENGTH, AMPLITUDE, ANISOTROPY, CREST SHAPE and
 * what else is on the ground — never the bearing.
 *
 * Handedness (ARCHITECTURE.md §6): `p` is world (x, z) in Three's right-handed
 * Y-up frame; `refXZ`/`refWind` from `lib/terrain` convert into the reference
 * frame at each entry point and nowhere else, exactly as the original does.
 */

export default /* glsl */`
#include "lib/terrain"

in vec2 vUv;

uniform vec2  worldOrigin;   // (-1024, -1024)
uniform float worldSize;     // 2048 m
uniform float windAngle;     // S.windDirection in radians
uniform float heightAmp;     // realm landform.heightScale

// x wavelength m, y amplitude m, z along-wind anisotropy, w crest ridge 0..1
uniform vec4 uLfDune;
// x wavelength m, y amplitude m, z anisotropy, w domain warp metres
uniform vec4 uLfSwell;
// x wavelength m, y amplitude m, z anisotropy, w lee shear
uniform vec4 uLfDrift;
// x cell m, y depth m, z radius m, w cull threshold (0 = no basins)
uniform vec4 uLfBasin;
// x cell m, y cull threshold, z base height m, w height variance m
uniform vec4 uLfRock;
// x radius min m, y radius variance m, z roughness wavelength m, w roughness mix
uniform vec4 uLfRock2;

layout(location = 0) out vec4 outColor;

/**
 * The realm landform. Structurally the original \`terrainMacro\`, with every
 * authored constant lifted to a uniform and two shaping stages added.
 */
float lfMacro(vec2 pPort, float wPort, float amp) {
    vec2  p = refXZ(pPort);
    float w = refWind(wPort);

    // --- domain warp -------------------------------------------------------
    // A very long-wavelength push on the sample point, BEFORE any layer reads
    // it, so every layer bends together. This is what stops a high-anisotropy
    // realm reading as corrugated iron: the ridge lines wander instead of
    // running dead straight to the horizon. Cold's warp is 0 and the whole
    // stage is branched over.
    float warp = uLfSwell.w;
    if (warp > 0.0) {
        mat2 mw = windMat(w, 1.0, 1.0, 340.0);
        vec3 wa = fbmd(mw * p + vec2(11.7, -4.3), 2, 2.0, 0.5);
        vec3 wb = fbmd(mw * p + vec2(-31.4, 27.9), 2, 2.0, 0.5);
        p += vec2(wa.x, wb.x) * warp;
    }

    // --- broad dunes -------------------------------------------------------
    mat2 m1 = windMat(w, uLfDune.z, 1.0, uLfDune.x);
    vec3 broad = fbmDamped(m1 * p, 5, 2.03, 0.5, 0.9);
    float b = broad.x;

    // --- crest ridge fold --------------------------------------------------
    // \`sabs\` and not \`abs\`: a hard fold puts a C0 kink along every crest, which
    // the aux bake differentiates into a one-texel black line — a razor seam
    // that reads as a rendering bug rather than as a sharp ridge. The remap
    // keeps the folded field on roughly the same range as the unfolded one, so
    // the amplitude below still means metres of the same size.
    float rg = uLfDune.w;
    if (rg > 0.0) b = mix(b, (0.30 - sabs(b, 0.055)) * 1.35, rg);

    float h = b * uLfDune.y;

    // --- long swell --------------------------------------------------------
    mat2 m0 = windMat(w, uLfSwell.z, 1.0, uLfSwell.x);
    vec3 swell = fbmDamped(m0 * p, 3, 2.11, 0.55, 0.3);
    h += swell.x * uLfSwell.y;

    // --- medium drifts and wind lobes --------------------------------------
    // Sheared along the wind by the broad height (post-fold, so a ridged realm
    // shears off its own crests), which steepens lee faces.
    mat2 m2 = windMat(w, uLfDrift.z, 1.0, uLfDrift.x);
    vec2 q2 = m2 * p;
    q2.x += b * uLfDrift.w;
    vec3 med = fbmDamped(q2, 4, 2.07, 0.48, 1.7);

    float shelter = clamp(0.5 - b * 0.75, 0.15, 1.0);
    h += med.x * uLfDrift.y * shelter;

    return h * amp;
}

/**
 * Blast basins — a jittered grid of bowls with raised rims. Ash's signature
 * landform and the one thing a dune field cannot fake: a NEGATIVE feature.
 * Returns metres, already signed (mostly down).
 */
float lfBasin(vec2 pPort) {
    float depth = uLfBasin.y;
    if (depth <= 0.0) return 0.0;

    vec2  p = refXZ(pPort);
    float cell = uLfBasin.x;
    vec2  gi = floor(p / cell);
    float sum = 0.0;

    for (int dy = -1; dy <= 1; ++dy) {
        for (int dx = -1; dx <= 1; ++dx) {
            vec2 id = gi + vec2(float(dx), float(dy));
            vec2 r = hash22(id + 19.7);
            vec2 r2 = hash22(id - 5.1);

            if (r2.x > uLfBasin.w) { continue; }

            vec2 centre = (id + 0.2 + r * 0.6) * cell;
            float rad = uLfBasin.z * (0.55 + r2.y * 0.9);
            float d = length(p - centre);
            if (d > rad) { continue; }

            float t = clamp(1.0 - d / rad, 0.0, 1.0);
            // Bowl down, plus a rim that peaks just inside the lip (t ~ 0.2).
            float bowl = t * t * (3.0 - 2.0 * t);
            float rim = smoothstep(0.0, 0.22, t) * (1.0 - smoothstep(0.10, 0.42, t));
            sum += (rim * 0.45 - bowl) * depth * (0.6 + r.y * 0.8);
        }
    }
    return sum;
}

/**
 * The realm's exposed rock. The original \`rockField\` with cell size, cull rate,
 * height and radius lifted out — the difference between Cold's sparse boulders
 * and Ash's crowded basalt.
 */
vec2 lfRock(vec2 pPort, float wPort) {
    vec2  p = refXZ(pPort);
    float w = refWind(wPort);

    float cell = uLfRock.x;
    vec2 gi = floor(p / cell);

    float hSum = 0.0;
    float mask = 0.0;

    for (int dy = -1; dy <= 1; ++dy) {
        for (int dx = -1; dx <= 1; ++dx) {
            vec2 id = gi + vec2(float(dx), float(dy));
            vec2 r = hash22(id);
            vec2 r2 = hash22(id + 71.3);

            if (r2.x > uLfRock.y) { continue; }

            vec2 centre = (id + 0.15 + r * 0.7) * cell;
            float radius = uLfRock2.x + r2.y * uLfRock2.y;
            float d = length(p - centre);
            if (d > radius * 1.6) { continue; }

            float t = clamp(1.0 - d / radius, 0.0, 1.0);
            float dome = t * t * (3.0 - 2.0 * t);
            mat2 mr = windMat(w, 1.0, 1.0, uLfRock2.z);
            float rough = ridgedd(mr * (p - centre), 3, 2.17, 0.55).x;
            float hgt = uLfRock.z + r2.y * uLfRock.w;

            hSum += dome * hgt * (0.62 + uLfRock2.w * rough);
            mask = max(mask, dome * dome);
        }
    }
    return vec2(hSum, mask);
}

void main() {
    vec2 p = worldOrigin + vUv * worldSize;

    float h = lfMacro(p, windAngle, heightAmp);
    // Basins carve AFTER the amplitude scale: a crater is a fixed depth in
    // metres, not a fraction of the dune relief, or it would vanish on the
    // realm with the lowest \`heightScale\` — which is exactly the realm that
    // has the craters.
    h += lfBasin(p);

    vec2 rock = lfRock(p, windAngle);
    h += rock.x;

    outColor = vec4(h, rock.y, 0.0, 1.0);
}
`;
