/**
 * The sky bake — a Nishita single-scattering integration written into an
 * equirectangular LUT.
 *
 * Port of `src/shaders/skyBake.fragment.wgsl` plus `nishitaSky` out of
 * `src/shaders/lib/atmosphere.wgsl`. The reference kept the integral in the
 * shared include; here it lives with its only caller, because every material in
 * the scene includes `lib/atmosphere` and none of them evaluate this.
 *
 * Run four times per solve (three bounce iterations plus a final bake so the LUT
 * reflects the converged snow bounce), into both LUTs — the 512x256 RGBA16F the
 * scene samples and the 64x32 RGBA32F the CPU reads back for the SH fit. Same
 * shader, same uniforms, two resolutions, so the two are byte-identical content.
 * Never per frame; the cost is not in the frame budget.
 *
 * `vUv` comes from `gfx.js`'s fullscreen triangle: vUv.y = 0 at the framebuffer's
 * bottom row. The bake writes zenith at v = 0 and `gl.readPixels` returns rows
 * bottom-to-top, so both ends agree that row 0 is the zenith — but that is a
 * driver-observable fact rather than a guaranteed one, so `sky.js` measures it
 * off the first bake instead of trusting it (see PORT-6 and `_detectRowOrder`).
 *
 * NO SOLAR DISC HERE. The disc and aureole are added afterwards, in the sky
 * material only, so the IBL projection can use this same LUT without a 100000x
 * spike blowing out the SH fit.
 */

export default /* glsl */`
#include "lib/atmosphere"

in vec2 vUv;
layout(location = 0) out vec4 outColor;

/// Shared radiometric scale for the sun and the sky: S.sunIntensity * 5.5.
/// Note this is the *scale*, not the raw slider — the reference uploads
/// sunScale into a uniform it happens to call sunIntensity.
uniform float uSunScale;
/// Radiance leaving the snow field, solved on the CPU by iterating the bounce
/// against this very LUT until it converges. Zero on the first pass.
uniform vec3  uGroundBounce;

// --------------------------------------------------------- planet constants

const float EARTH_R     = 6360000.0;   // m
const float ATMOS_R     = 6420000.0;   // m, a 60 km shell
const float H_RAYLEIGH  = 8000.0;      // m, scale height
const float H_MIE       = 1200.0;      // m, scale height

// Sea-level scattering coefficients, per metre. These are exactly consistent
// with the CPU beam attenuation in sky.js: 5.8e-6 * 8000 = 0.0464 = tauR.r, and
// so on, so the sun's own colour and the sky it hangs in cannot disagree.
const vec3  BETA_R = vec3(5.8e-6, 13.5e-6, 33.1e-6);
const vec3  BETA_M = vec3(21e-6, 21e-6, 21e-6);
const float MIE_G  = 0.76;

/// Strength of the isotropic multiple-scattering approximation, relative to
/// single-scattered Rayleigh. Tuned so the diffuse sky irradiance lands near
/// 15% of direct-normal solar, which is where a real clear sky sits.
const float MS_BOOST = 1.5;

/// Distance to the far intersection of a ray with a sphere centred on the
/// origin. Returns -1 when the ray misses. Assumes a unit-length dir (no 'a'
/// term); both callers pass normalised vectors.
///
/// b*b - c with b ~ 6.36e6 is ~4e13 — inside f32 range but only about seven
/// significant digits. The reference lives with that; stabilising the quadratic
/// would shift the horizon's position.
float raySphereFar(vec3 origin, vec3 dir, float radius) {
    float b = dot(origin, dir);
    float c = dot(origin, origin) - radius * radius;
    float d = b * b - c;
    if (d < 0.0) return -1.0;
    return -b + sqrt(d);
}

/// Full single-scattering sky radiance for a view direction.
/// sunDir points *toward* the sun. Result is linear, unnormalised radiance.
vec3 nishitaSky(vec3 rayDir, vec3 sunDir, float sunIntensity, vec3 groundBounce) {
    // Stand just above the surface so the horizon resolves cleanly. At 800 m the
    // geometric horizon dip is 0.9086 degrees, i.e. dir.y = -0.015857, which is
    // where the ground-bounce handover below is centred.
    vec3 origin = vec3(0.0, EARTH_R + 800.0, 0.0);

    float atmosDist = raySphereFar(origin, rayDir, ATMOS_R);
    if (atmosDist < 0.0) return vec3(0.0);

    // Rays heading into the planet are clipped at the surface, which is what
    // produces the dark, dense band right below the horizon.
    float groundDist = raySphereFar(origin, rayDir, EARTH_R);
    float bIn = dot(origin, rayDir);
    float cIn = dot(origin, origin) - EARTH_R * EARTH_R;
    float discr = bIn * bIn - cIn;
    float march = atmosDist;
    if (discr > 0.0) {
        float nearT = -bIn - sqrt(discr);
        if (nearT > 0.0) march = nearT;
    }

    const int STEPS = 32;
    const int LIGHT_STEPS = 8;

    // View samples are distributed by a power law, not uniformly, and this is
    // the single most important line in the integral.
    //
    // Density falls off exponentially with height, so almost all of the
    // scattering along any ray happens in the first few kilometres. A uniform
    // march does not know that, and near the horizon it fails outright: a ray at
    // zero elevation travels roughly 450 km before it leaves the atmosphere, so
    // sixteen even steps put the *first* sample 14 km out and 15 km up — past
    // essentially all of the air that matters. Measured off a readback of the
    // reference LUT along the anti-sun azimuth, that produced 1.86 at +3.5
    // degrees, 0.84 at 0, 1.29 at -0.5: a one-stop dark notch, one to two degrees
    // wide, wrapped around the whole horizon. Nothing downstream can fix it,
    // because it is a hole in the source data.
    //
    // t^2.5 puts the first of thirty-two samples 60 m out on that same grazing
    // ray and still reaches the top of the atmosphere.
    const float DIST_POWER = 2.5;

    float mu = dot(rayDir, sunDir);
    float pr = phaseRayleigh(mu);
    float pm = phaseMie(mu, MIE_G);

    vec3 sumR = vec3(0.0);
    vec3 sumM = vec3(0.0);
    /// The same two sums over the samples with no *direct* view of the sun.
    vec3 shadR = vec3(0.0);
    vec3 shadM = vec3(0.0);
    float odR = 0.0;   // accumulated optical depth along the view ray
    float odM = 0.0;

    float tPrev = 0.0;
    for (int i = 0; i < STEPS; i++) {
        // Sample *positions* follow the power law; the sample *point* is the
        // segment midpoint, and stepLen is the segment's true width — both the
        // optical depth and the scattering weight are integrated over it, so the
        // quadrature stays correct under the non-uniform spacing.
        float tNext = march * pow(float(i + 1) / float(STEPS), DIST_POWER);
        float stepLen = tNext - tPrev;
        vec3 p = origin + rayDir * (tPrev + stepLen * 0.5);
        tPrev = tNext;
        float h = length(p) - EARTH_R;

        float dR = exp(-h / H_RAYLEIGH) * stepLen;
        float dM = exp(-h / H_MIE) * stepLen;
        // Accumulated *before* the light march, so the sample's own segment is
        // included in its view-path extinction. A half-step bias, and part of
        // the tuned result.
        odR += dR;
        odM += dM;

        // Optical depth from this sample toward the sun. Eight uniform steps,
        // midpoint-sampled, no power law.
        float lightDist = raySphereFar(p, sunDir, ATMOS_R);
        float lStep = lightDist / float(LIGHT_STEPS);
        float lR = 0.0;
        float lM = 0.0;
        bool occluded = false;

        for (int j = 0; j < LIGHT_STEPS; j++) {
            vec3 lp = p + sunDir * (lStep * (float(j) + 0.5));
            float lh = length(lp) - EARTH_R;
            if (lh < 0.0) { occluded = true; break; }
            lR += exp(-lh / H_RAYLEIGH) * lStep;
            lM += exp(-lh / H_MIE) * lStep;
        }

        if (occluded) {
            // Not thrown away. This sample sits in the planet's own shadow, so
            // it receives no direct sun — but it is still inside a lit
            // atmosphere, and multiply-scattered light reaches it. Attenuate
            // along the *view* path only and keep it for the isotropic pass.
            vec3 attenV = exp(-(BETA_R * odR + BETA_M * 1.1 * odM));
            shadR += attenV * dR;
            shadM += attenV * dM;
            continue;
        }

        // 1.1 is Mie *extinction* over Mie *scattering* — a stand-in for
        // absorption in the aerosol. It appears in the optical depth only,
        // never in the scattering weight.
        vec3 tau = BETA_R * (odR + lR) + BETA_M * 1.1 * (odM + lM);
        vec3 atten = exp(-tau);
        sumR += atten * dR;
        sumM += atten * dM;
    }

    vec3 col = sunIntensity * (sumR * BETA_R * pr + sumM * BETA_M * pm);

    // --- multiple scattering ------------------------------------------------
    // Single scattering alone underestimates a clear sky by roughly a factor of
    // three, and it underestimates blue the most, because a blue photon is the
    // one most likely to scatter again rather than to be absorbed. Left
    // uncorrected the sky is too dim to fill shadows, the warm ground bounce
    // wins the ambient, and snow shadows come out beige instead of blue — the
    // opposite of the whole look.
    //
    // The shadowed samples enter *here* and nowhere else, at half weight. At a
    // 13-degree sun most of a grazing anti-sun path lies in the planet's own
    // shadow, so most of its samples took the early-out and single scattering
    // had almost nothing left to integrate: without this the model drew a dark
    // stripe a degree or two above the horizon, brown once the grazing
    // desaturation had had its say. Real skies do darken there — it is the base
    // of the Earth's shadow — but they darken smoothly. Half weight because it
    // is scattered light arriving indirectly, not a second sun.
    const float SHADOW_FILL = 0.5;
    float msPhase = 1.0 / (4.0 * PI);
    col += sunIntensity * (
              (sumR + shadR * SHADOW_FILL) * BETA_R * MS_BOOST
            + (sumM + shadM * SHADOW_FILL) * BETA_M * 0.4
          ) * msPhase;

    // --- the snow below the horizon -----------------------------------------
    // Snow reflects ~85% of what lands on it, so in a snow field the ground is
    // one of the brightest sources in the scene, and it is what fills shadows
    // with bright blue-white light instead of leaving them black. Omitting it —
    // as a naive sky model does — is precisely why untuned snow renders come out
    // with dead, crushed shadows. These rows are also what the water and crystal
    // shaders sample along a refracted ray, which is why neither needs a copy of
    // the scene behind it.
    //
    // The handover has to be *fast*: 1.43 degrees, from -0.030 to -0.005 in
    // dir.y, centred on the 800 m observer's -0.9086 degree horizon. Run it
    // wider and the band holds mostly the clipped march, which is dark for an
    // artefactual reason — a ray angled into the planet is cut short and
    // accumulates almost no single scattering.
    if (discr > 0.0 && groundDist > 0.0) {
        // Ascending edges: smoothstep is undefined when edge0 > edge1.
        float downT = 1.0 - smoothstep(-0.030, -0.005, rayDir.y);
        col = mix(col, groundBounce, downT);
    }

    // --- the optically thick horizon ----------------------------------------
    // A horizontal path through the atmosphere is hundreds of kilometres long,
    // and single scattering treats that as a coloured filter: blue extinguished
    // outright, green mostly, leaving a saturated olive band between the blue
    // dome and the warm sun. No real sky does that. A path that thick is not a
    // filter, it is fog, and high-order scattering inside it drives the result
    // toward the achromatic.
    //
    // So the last dozen degrees are pulled toward their own luminance —
    // symmetrically about the horizon, so the top of the ground-bounce band
    // whitens too. Widened from 0.20/0.62 once the aerial perspective started
    // converging distant surfaces onto this band rather than onto the cool dome
    // above it: what had been a thin strip hidden behind terrain became a tan
    // wash across a quarter of the frame on the anti-sun side.
    //
    // (0.30, 0.42, 0.28) is hand-tuned and sums to 1.0 — deliberately not
    // Rec.709 — and the result is tinted slightly cool. The sun's warmth is
    // untouched: disc, aureole and forward lobe are all added after this LUT.
    float grazing = 1.0 - smoothstep(0.0, 0.26, abs(rayDir.y));
    float pale = dot(col, vec3(0.30, 0.42, 0.28));
    col = mix(col, vec3(pale) * vec3(0.97, 1.0, 1.06), grazing * 0.82);

    return col;
}

void main() {
    vec3 dir = latLongToDir(vUv);
    vec3 col = nishitaSky(dir, uSunDir, uSunScale, uGroundBounce);
    // .a is written as 1.0 and never read.
    outColor = vec4(col, 1.0);
}
`;
