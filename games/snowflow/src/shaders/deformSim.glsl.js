/**
 * deformSim — the terrain state buffer's one and only simulation pass.
 *
 * One full-screen fragment pass per frame, ping-ponged between two RGBA16F
 * targets. It does four jobs in a single dispatch, in this order:
 *
 *   1. scroll   the window follows the player toroidally; texels that just came
 *               into view are zeroed rather than showing whatever was there half
 *               a field away.
 *   2. relax    diffusion + wind infill + berm slump + four slow decays. This is
 *               the "refill": trails soften and eventually heal, but slowly
 *               enough that a run is still obviously there a minute later.
 *   3. splat    every brush written this frame — footfalls, the surf wake, every
 *               spell — accumulated additively.
 *   4. clamp    depression bottoms out (you hit packed snow), berms cap.
 *
 * Channels:
 *   R  depression depth, metres, positive = pushed down
 *   G  displaced mass,   metres, positive = piled up. This is the channel that
 *      separates a trail with berms from a flat footprint decal.
 *   B  compression 0..1 — denser, darker, tighter specular, scatters less
 *   A  ice 0..1 — refrozen, smooth and reflective
 *
 * PORTING NOTES (WGSL -> GLSL ES 3.00), each one load-bearing:
 *
 *  · UV comes from `gl_FragCoord.xy / res`, NOT from the interpolated `vUv`.
 *    On any frame with dt = 0 — the common case, since the relax block fires at
 *    2.5 Hz while this pass runs at frame rate — the pass reduces to "copy
 *    prevTex, then splat", and that copy is lossless only if the sample lands
 *    exactly on a texel centre, (i + 0.5) / res. `gl_FragCoord.xy` is exactly
 *    (i + 0.5, j + 0.5) at fragment centres, so this is exact by construction.
 *    Get it half a texel wrong and the buffer bilinearly blurs itself into
 *    nothing within a second or two, which looks like "the decay is far too
 *    fast" and sends you hunting in the wrong file.
 *
 *  · Belt and braces on the same point: the centre and the four Laplacian
 *    neighbours are `texelFetch`ed with explicit toroidal wrapping (`% R`)
 *    rather than sampled, so no filtering is involved at all. The upwind tap
 *    stays a filtered `textureLod` — its 1.6-texel offset is deliberately
 *    fractional and its bilinear interpolation is part of the advection scheme.
 *
 *  · `round()` is replaced by `floor(x + 0.5)`. WGSL rounds half to even; GLSL's
 *    `round` is implementation-defined at .5, and in `texelWorld` and the seam
 *    wrap the ties fall exactly on the window boundary — a flickering seam texel
 *    is a nasty bug to chase. (The CPU uses `Math.round`, ties toward +inf; the
 *    two agree everywhere except a measure-zero set.)
 *
 *  · The noise is a local, prefixed copy of the reference's `hash21`/`grad2`/
 *    `noised` rather than an `#include "lib/noise"`. It is used only for the rim
 *    wobble and the berm granularity, in brush space, and therefore has nothing
 *    it must agree with — unlike `lib/deform`, which five programs share
 *    precisely because they must agree. Keeping this pass self-contained means
 *    the deformation subsystem boots without waiting on TERRAIN's chunk, and the
 *    `df` prefix means it cannot collide if `lib/noise` is pulled in later.
 *
 * Handedness (ARCHITECTURE §6): every vector in this file is a world-XZ 2-vector
 * or a UV — no cross products, no bases, nothing to flip. The wind direction is
 * the one line with a convention baked in and it is commented at its use.
 *
 * Requires the define MAX_BRUSHES (the brush texture's width), supplied by
 * `deformation.js` so the loop bound is a compile-time constant.
 */

export default /* glsl */`

layout(location = 0) out vec4 outColor;

uniform sampler2D prevTex;   // the other ping-pong target: REPEAT + LINEAR

/// Brush parameters for this frame. Width = MAX_BRUSHES, height = 3 rows:
///   row 0: (worldX, worldZ, radius, elongation)
///   row 1: (cos yaw, sin yaw, depression amount, berm amount)
///   row 2: (compression, ice, edge roughness, seed)
///
/// A texture rather than a uniform array: it sidesteps uniform-array packing
/// entirely, costs one 4.5 KiB upload per frame, and scales past the point where
/// a uniform block would stop fitting. RGBA32F is mandatory — row 0 carries
/// absolute world metres up to +/-620, where a half float's ULP is 0.5 m.
uniform sampler2D brushTex;

uniform vec2  center;       // window centre this frame, texel-snapped (x = X, y = Z)
uniform vec2  prevCenter;   // window centre last frame
uniform float size;         // window coverage in metres
uniform float res;          // texels across

/// Seconds of relaxation to apply THIS DISPATCH — not the frame time.
///
/// Zero on most frames. See the note above the decay block: a half-float target
/// cannot represent a per-frame decay this slow, so the relaxation is banked on
/// the CPU and spent in steps large enough to survive the round trip. Every term
/// below is an exact no-op at dt = 0, which is what makes that safe.
uniform float dt;

uniform float brushCount;
uniform float refillRate;
uniform float maxDepth;
uniform float maxBerm;
uniform float windAngle;

// ---------------------------------------------------------------------- noise
// Transcribed 1:1 from the reference's lib/noise (hash21, grad2, noised), value
// only — nothing here needs the analytic derivatives.

float dfHash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

/// Unit-length 2D gradient vector for a lattice point.
vec2 dfGrad2(vec2 i) {
    float a = dfHash21(i) * 6.28318530718;
    return vec2(cos(a), sin(a));
}

/// Perlin-style gradient noise, roughly [-1, 1].
float dfNoise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = p - i;

    // Quintic fade: C2 continuous.
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

    vec2 ga = dfGrad2(i + vec2(0.0, 0.0));
    vec2 gb = dfGrad2(i + vec2(1.0, 0.0));
    vec2 gc = dfGrad2(i + vec2(0.0, 1.0));
    vec2 gd = dfGrad2(i + vec2(1.0, 1.0));

    float va = dot(ga, f - vec2(0.0, 0.0));
    float vb = dot(gb, f - vec2(1.0, 0.0));
    float vc = dot(gc, f - vec2(0.0, 1.0));
    float vd = dot(gd, f - vec2(1.0, 1.0));

    float k0 = va;
    float k1 = vb - va;
    float k2 = vc - va;
    float k3 = va - vb - vc + vd;

    return k0 + k1 * u.x + k2 * u.y + k3 * u.x * u.y;
}

// ----------------------------------------------------------------- addressing

/// Round half away from zero on the positive side; deterministic at ties, which
/// GLSL's own round() is not. Every wrap in this file goes through it.
vec2 dfRound(vec2 v) { return floor(v + 0.5); }

/// Recover the world position a texel stands for.
///
/// \`uv * size\` only pins the position modulo the window, so the correct branch
/// is the one nearest the window centre — which, by construction, is the only one
/// inside the window at all. Exact inverse of deformUV on the window.
vec2 texelWorld(vec2 uv, vec2 centre, float sz) {
    vec2 base = uv * sz;
    return base + sz * dfRound((centre - base) / sz);
}

void main() {
    // Exactly (i + 0.5) / res at every fragment centre. See the header.
    vec2 uv = gl_FragCoord.xy / res;
    vec2 world = texelWorld(uv, center, size);

    float dep  = 0.0;
    float berm = 0.0;
    float comp = 0.0;
    float ice  = 0.0;

    // ------------------------------------------------------------------ scroll
    // Inside last frame's window? If not, this texel just wrapped in from the
    // trailing edge and holds state from the far side of the field.
    //
    // The accumulators above are already zero, so a texel that fails this test is
    // cleared BY OMISSION — same pass, no branch cost beyond the one already
    // here, no separate clear, no copy, no scroll. That is the whole scroll
    // implementation, and warmUp() reuses it by placing prevCenter a million
    // metres away so every texel fails and the buffer zeroes itself.
    bool wasInside = all(lessThanEqual(abs(world - prevCenter), vec2(size * 0.5)));

    if (wasInside) {
        float t = 1.0 / res;

        // texelFetch with manual wrapping: identical to a REPEAT bilinear sample
        // at a texel centre, but exactly so, with no dependence on the sampler
        // landing where we think it does.
        int R = int(res);
        ivec2 P = ivec2(gl_FragCoord.xy);
        vec4 c  = texelFetch(prevTex, P, 0);
        vec4 xl = texelFetch(prevTex, ivec2((P.x + R - 1) % R, P.y), 0);
        vec4 xr = texelFetch(prevTex, ivec2((P.x + 1) % R,     P.y), 0);
        vec4 zd = texelFetch(prevTex, ivec2(P.x, (P.y + R - 1) % R), 0);
        vec4 zu = texelFetch(prevTex, ivec2(P.x, (P.y + 1) % R    ), 0);

        dep  = c.r;
        berm = c.g;
        comp = c.b;
        ice  = c.a;

        // --- diffusion -------------------------------------------------------
        // Explicit five-point Laplacian, so the coefficient has to stay under
        // 0.25 or it goes unstable and the buffer rings.
        //
        // These coefficients are PER SECOND and tiny on purpose. Diffusion
        // spreads as sqrt(2*D*t), so over a minute the depression's rim softens
        // by 0.69 texels (2.7 cm) and the berm's by 1.20 texels (4.7 cm).
        //
        // Loose piled snow slumps faster than a compacted trench floor, so the
        // berm channel gets exactly three times the depression's rate. That 3:1
        // ratio is the mechanism behind "a trail softens from its edges inward":
        // the crest rounds off while the floor stays a floor.
        //
        // Only R and G diffuse. Compression and glaze do not creep sideways.
        //
        // k saturates at 1, so at the top of the refillRate slider (4) the
        // effective diffusion is 2.4x base, not 4x — while the slump term below
        // uses refillRate directly and does scale linearly. That asymmetry is
        // shipped behaviour.
        float k = clamp(refillRate * dt, 0.0, 1.0);
        // The caps are never binding for the shipped constants (0.012 * 1 < 0.22);
        // they are the stability guard for anyone who changes RELAX_STEP.
        float kDep  = min(0.22, 0.004 * k);
        float kBerm = min(0.22, 0.012 * k);

        float lapDep  = (xl.r + xr.r + zd.r + zu.r) - 4.0 * dep;
        float lapBerm = (xl.g + xr.g + zd.g + zu.g) - 4.0 * berm;
        dep  += lapDep  * kDep;
        berm += lapBerm * kBerm;

        // --- wind infill ------------------------------------------------------
        // Drift blows into the trench from upwind, so pull a little of the upwind
        // neighbour's state across. Asymmetric on purpose: a trail filling evenly
        // from both sides looks like a blur, filling from one side looks like
        // weather.
        //
        // (sin, cos) — a COMPASS BEARING in world XZ, not a maths angle: X = sin,
        // Z = cos. The FORMULA is the reference's, unchanged; the ANGLE fed into
        // it is not. deformation.js passes bearingRad(S.windDirection) = PI - deg,
        // the port's z-mirror of a Babylon bearing (see core/bearing.js). Since
        // sin(PI - t) = sin t and cos(PI - t) = -cos t, that is exactly the
        // z-negation the port applies to every world bearing, which is why this
        // line still reads as written while naming the mirrored direction.
        // TERRAIN's heightfield bake, the sastrugi shear and the spray all take
        // the same bearingRad, so drift and ridges stay agreed — do not
        // 'restore' a raw deg*PI/180 here without changing all four.
        vec2 wdir = vec2(sin(windAngle), cos(windAngle));
        // 1.6 texels — deliberately fractional, so this tap MUST be filtered.
        vec2 upwind = uv - wdir * (t * 1.6);
        vec4 uw = textureLod(prevTex, upwind, 0.0);
        float kAdv = min(0.2, 0.002 * k);
        dep  = mix(dep,  uw.r, kAdv * 0.6);
        berm = mix(berm, uw.g, kAdv);

        // --- slump ------------------------------------------------------------
        // Piled mass falls back into the hole it came out of. Taking the min
        // keeps it mass-conserving and means an isolated berm with no adjacent
        // depression does not evaporate — it has to diffuse away instead. (The
        // surf wake's two thrown-mass brushes write zero depression precisely so
        // that they land in this case.)
        //
        // Per second, like the diffusion above — but off refillRate * dt directly
        // rather than the clamped k, so it scales linearly to the slider's top.
        float slump = min(berm, dep) * min(0.6, 0.002 * refillRate * dt);
        dep  -= slump;
        berm -= slump;

        // --- decay ------------------------------------------------------------
        // Time constants, seconds, at refillRate = 1.
        //
        // The reason dt is banked rather than per-frame lives here.
        //
        // A 400-second time constant is a per-frame multiply by 0.999985 at
        // 165 FPS. Half float carries an 11-bit significand, so one ULP near 0.5
        // is a relative 4.9e-4 — thirty times LARGER than the 1.5e-5 the decay is
        // trying to subtract. Every store therefore lands between two
        // representable values, and because the product is always slightly below
        // the input it consistently resolves to the lower one: the buffer loses a
        // full ULP per frame instead of the sliver it asked for.
        //
        // That is a decay of 2^-11 per frame — about 8% per second, a ten-second
        // half-life, entirely independent of the constants written here and
        // proportional to frame rate. Banking the time on the CPU and spending it
        // in steps of ~0.4 s puts each multiply two ULPs clear of the noise floor,
        // and the constants below then mean what they say.
        float r = refillRate;
        dep  *= exp(-dt * r / 400.0);
        berm *= exp(-dt * r / 250.0);
        comp *= exp(-dt * r / 300.0);
        // Ice is the one thing here meant to feel permanent within a session — a
        // spell that "permanently alters the surface" should not visibly melt
        // while the player watches it.
        ice  *= exp(-dt * r / 900.0);
    }

    // ------------------------------------------------------------------- splat
    // Outside the wasInside branch on purpose: a brush written onto a
    // just-exposed texel still lands, accumulating on top of the zeros.
    int n = int(brushCount);
    for (int i = 0; i < MAX_BRUSHES; ++i) {
        if (i >= n) break;

        vec4 a = texelFetch(brushTex, ivec2(i, 0), 0);
        vec4 b = texelFetch(brushTex, ivec2(i, 1), 0);
        vec4 c = texelFetch(brushTex, ivec2(i, 2), 0);

        float radius = a.z;
        if (radius <= 0.0) continue;

        // Wrap the offset too, so a brush written near the seam still reaches the
        // texels on the far side of it — the same minimum-image convention as
        // texelWorld.
        vec2 p = world - a.xy;
        p -= size * dfRound(p / size);

        // Cheap reject before the trig, as an axis-aligned box on the UNROTATED
        // offset — conservative for any yaw. The berm ring lives out to ~1.35 and
        // the edge wobble can push it a little past that.
        float reach = radius * max(a.w, 1.0) * 1.6;
        if (abs(p.x) > reach || abs(p.y) > reach) continue;

        // Into brush space: rotate by the brush yaw, then squash the long axis.
        // b.x = cos(yaw), b.y = sin(yaw); written out as dot products, so there is
        // no matrix and therefore no column-order hazard to port. The divisors
        // say which is which: radius is the SHORT-axis radius in metres and a.w
        // (elongation) is the long-axis multiple of it.
        vec2 q = vec2(
            ( p.x * b.x + p.y * b.y) / (radius * a.w),
            (-p.x * b.y + p.y * b.x) / radius
        );
        float d = length(q);
        if (d > 1.55) continue;

        // Contact detail. A clean analytic bevel at the trail edge is the tell
        // that reads as "decal"; breaking the rim radius with angular noise and
        // granulating the berm is what gives it the chunky displaced look.
        //
        // Amplitude 0.22 -> the rim radius varies by +/-22% at edge = 1.
        // Frequency 2.7 -> a circle of circumference 2*pi*2.7 ~ 17 noise cells,
        // so about 17 lobes around the rim. c.w is the position-hash seed, which
        // decorrelates one brush from the next.
        float ang = atan(q.y, q.x);
        float wob = 1.0 + c.z * 0.22 * dfNoise2(vec2(cos(ang), sin(ang)) * 2.7 + c.w);
        float dn = d / wob;

        // Depression: flat-ish floor out to 0.42, then a fast shoulder to zero at
        // 1.0. Not a Gaussian — a boot compresses a floor, it does not dimple.
        float core = 1.0 - smoothstep(0.42, 1.0, dn);

        // Berm: a Gaussian ring just outside the depression rim, where the
        // displaced mass actually ends up. Peak at 1.04 radii, sigma 0.208 radii,
        // still at 4.9% of peak where the d > 1.55 reject truncates it.
        float ringD = (dn - 1.04) * 3.4;
        float ring = exp(-ringD * ringD);
        // A multiplier in [0.72, 1.28] with mean 1, at ~7.5 cells per unit of
        // brush space — about 1.3 cm granules for a boot.
        float grain = 0.72 + 0.56 * (dfNoise2(q * 7.5 + c.w * 3.1) * 0.5 + 0.5);

        dep  += b.z * core;
        berm += b.w * ring * grain;
        comp += c.x * core;
        // Max, not add: glaze does not stack, which is why repeated Ribbon passes
        // over the same ground never saturate the snow into a mirror.
        ice = max(ice, c.y * core);
    }

    // ------------------------------------------------------------------- clamp
    // Depression bottoms out: below about half a metre you are on packed snow and
    // nothing more moves. Without this, standing still while surfing would dig an
    // unbounded pit.
    //
    // The lower bound of 0 on R is load-bearing in the other direction: Vortex
    // writes a NEGATIVE depression while its snow falls back, and that negative
    // can only ever cancel existing depression, never mound the ground through R.
    // Mounding is G's job, and Vortex accordingly also writes a positive berm on
    // the give-back.
    dep  = clamp(dep,  0.0, maxDepth);
    berm = clamp(berm, 0.0, maxBerm);
    comp = clamp(comp, 0.0, 1.0);
    ice  = clamp(ice,  0.0, 1.0);

    outColor = vec4(dep, berm, comp, ice);
}
`;
