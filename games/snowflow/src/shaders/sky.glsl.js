/**
 * The skybox — LUT lookup, raymarched far range, solar disc, aureole, cirrus.
 *
 * Port of `src/shaders/sky.vertex.wgsl`, `src/shaders/sky.fragment.wgsl` and
 * `src/shaders/lib/ridge.wgsl`. Drawn first, before the terrain, depth-write off
 * and clamped to the far plane, so it fills exactly whatever the rest of the
 * scene does not.
 *
 * ---------------------------------------------------------------------------
 * WHY THE NOISE IS PRIVATE HERE
 *
 * The reference's `ridge.wgsl` pulls `noised`/`fbmd`/`ridgedd`/`rot2` out of the
 * shared `noise.wgsl`. In this port `lib/noise` is owned by TERRAIN and carries
 * no signature in ARCHITECTURE.md 3.1 — there is nothing contracted to code
 * against, and a far range that fails to compile because a neighbouring
 * subsystem spelled `ridgedd` differently takes the whole page down. So the four
 * functions the range and the cirrus need are transcribed here, verbatim from
 * `src/shaders/lib/noise.wgsl`, under an `sn` prefix that cannot collide if this
 * stage ever does include `lib/noise`.
 *
 * They are used by nothing else: the ridge field is a self-contained far-field
 * feature at 5.5-40 km, and no other subsystem evaluates it. If TERRAIN's
 * `lib/noise` later publishes these under a contracted signature, delete the
 * block below and include it — the formulas are identical and the visual result
 * must not move.
 *
 * ---------------------------------------------------------------------------
 * HANDEDNESS (ARCHITECTURE.md 6)
 *
 * Every direction here is raw world XYZ in Three's right-handed Y-up frame, and
 * every formula is transcribed unchanged from the left-handed reference per
 * PORT-11. Two places would break if that were done inconsistently, and both are
 * marked at the line:
 *
 *  - the ridge normal `normalize(vec3(-dH/dx, 1.0, -dH/dz))`, which is a
 *    gradient-to-normal identity for a height function y = H(x, z) and holds in
 *    either handedness (it is not a cross product);
 *  - the cirrus rotation `rot2(atan(windDir.x, windDir.y))`, which turns the
 *    streaks into the wind bearing and shares its convention with the terrain's
 *    sastrugi — the sastrugi look depends on the wind sitting 70-80 degrees off
 *    the sun, so if one of the two is mirrored and the other is not, the fine
 *    structure flattens.
 */

/**
 * Skybox vertex stage. A unit cube pinned to the camera, depth-clamped to the
 * far plane.
 *
 * The box is built at size 2, so `position` is exactly +/-1 and `vDir` is a raw
 * cube direction — deliberately NOT normalised, the fragment does that. At
 * skyScale = 2100 the cube's half-extent is 2100 m, well inside the 4200 m far
 * plane; the depth clamp is what actually parks it at the far plane.
 *
 * `clip.z = clip.w * 0.999999` ports verbatim but for a different reason than in
 * WebGPU: NDC z there is [0, 1] and here it is [-1, 1], and either way z/w just
 * inside 1.0 lands just inside the far plane.
 */
export const vertex = /* glsl */`
#include "lib/common"

in vec3 position;

uniform float uSkyScale;

out vec3 vDir;

void main() {
    vec3 world = position * uSkyScale + uCameraPos;
    vDir = position;

    vec4 clip = uViewProj * vec4(world, 1.0);
    clip.z = clip.w * 0.999999;
    gl_Position = clip;
}
`;

/**
 * Skybox fragment stage.
 *
 * Order matters and is the reference's: LUT, then the far range (so a peak
 * replaces the sky it stands in front of), then the disc and aureole (so a
 * massif in front of the sun still picks up its glow), then cirrus (so a cloud
 * can dim the sun and drift in front of a peak).
 */
export const fragment = /* glsl */`
#include "lib/atmosphere"

in vec3 vDir;
layout(location = 0) out vec4 outColor;

/// Normalised hue of the beam, max channel = 1. Used by the disc, the aureole
/// and the cirrus tint — NOT by the far range, which is lit by uSunColor
/// (the premultiplied radiance) exactly as the snow field is.
uniform vec3  uSunTint;
/// The shared radiometric scale, S.sunIntensity * 5.5. 23.1 at defaults.
uniform float uSunScale;
uniform vec2  uWindDir;
uniform float uCloudAmount;
/// Peak height of the far range, metres. Zero switches it off entirely.
uniform float uRidgeAmp;

// ===========================================================================
// Noise — transcribed from src/shaders/lib/noise.wgsl. See the file header for
// why it is private rather than #included.
// ===========================================================================

float snHash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

/// Unit-length 2D gradient vector for a lattice point.
vec2 snGrad2(vec2 i) {
    float a = snHash21(i) * 6.28318530718;
    return vec2(cos(a), sin(a));
}

/// Perlin-style gradient noise with analytic derivatives (Inigo Quilez's
/// formulation). Returns vec3(value, d/dx, d/dy); value range roughly [-1, 1].
/// Quintic fade, so the derivatives are smooth too — which is what lets the far
/// range be shaded without a single finite difference.
vec3 snNoised(vec2 p) {
    vec2 i = floor(p);
    vec2 f = p - i;

    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);

    vec2 ga = snGrad2(i + vec2(0.0, 0.0));
    vec2 gb = snGrad2(i + vec2(1.0, 0.0));
    vec2 gc = snGrad2(i + vec2(0.0, 1.0));
    vec2 gd = snGrad2(i + vec2(1.0, 1.0));

    float va = dot(ga, f - vec2(0.0, 0.0));
    float vb = dot(gb, f - vec2(1.0, 0.0));
    float vc = dot(gc, f - vec2(0.0, 1.0));
    float vd = dot(gd, f - vec2(1.0, 1.0));

    float k0 = va;
    float k1 = vb - va;
    float k2 = vc - va;
    float k3 = va - vb - vc + vd;

    float value = k0 + k1 * u.x + k2 * u.y + k3 * u.x * u.y;

    vec2 deriv = ga
        + u.x * (gb - ga)
        + u.y * (gc - ga)
        + u.x * u.y * (ga - gb - gc + gd)
        + du * (vec2(u.y, u.x) * k3 + vec2(k1, k2));

    return vec3(value, deriv);
}

/// Column-major, col0 = (c, -s), col1 = (s, c) — identical to the reference's
/// mat2x2f(c, -s, s, c).
mat2 snRot2(float a) {
    float c = cos(a);
    float s = sin(a);
    return mat2(c, -s, s, c);
}

/// Plain fBm with chain-ruled derivatives. Start amplitude 0.5, start frequency
/// 1.0, per-octave domain rotation of 0.517 rad to kill raw Perlin's
/// axis-aligned grid signature.
vec3 snFbmd(vec2 p0, int octaves, float lacunarity, float gain) {
    vec2 p = p0;
    float amp = 0.5;
    float freq = 1.0;
    float sum = 0.0;
    vec2 deriv = vec2(0.0);

    mat2 m = snRot2(0.517);
    mat2 xform = mat2(1.0, 0.0, 0.0, 1.0);

    for (int i = 0; i < octaves; i++) {
        vec3 n = snNoised(p * freq);
        sum += amp * n.x;
        // d/dp0 = amp * freq * (dn/dp * accumulated rotation). Row-vector times
        // matrix, which means the same thing in GLSL as in WGSL.
        deriv += amp * freq * (n.yz * xform);
        amp *= gain;
        freq *= lacunarity;
        p = m * p;
        xform = m * xform;
    }
    return vec3(sum, deriv);
}

/// Ridged noise with derivatives — sharp crests, smooth valleys. Built as
/// 1 - |n|, whose derivative is -sign(n) * dn; squared to sharpen the crest, and
/// prev couples octaves so ridges align rather than interfering.
vec3 snRidgedd(vec2 p0, int octaves, float lacunarity, float gain) {
    vec2 p = p0;
    float amp = 0.5;
    float freq = 1.0;
    float sum = 0.0;
    vec2 deriv = vec2(0.0);
    float prev = 1.0;

    mat2 m = snRot2(0.717);
    mat2 xform = mat2(1.0, 0.0, 0.0, 1.0);

    for (int i = 0; i < octaves; i++) {
        vec3 n = snNoised(p * freq);
        float s = sign(n.x);
        float r = 1.0 - abs(n.x);
        float r2 = r * r;
        float dr2 = -2.0 * r * s;

        sum += amp * r2 * prev;
        deriv += amp * prev * freq * (dr2 * n.yz * xform);
        prev = mix(1.0, r2, 0.65);

        amp *= gain;
        freq *= lacunarity;
        p = m * p;
        xform = m * xform;
    }
    return vec3(sum, deriv);
}

// ===========================================================================
// Shading helpers — transcribed from src/shaders/lib/shading.wgsl.
//
// ARCHITECTURE.md 3.1 signs lib/shading's snowSubsurface as five arguments
// (L, V, N, lightColor, thickness). shadeRidge needs the reference's seven —
// it passes strength = snowMask and radius = 1.0, and the snow mask is the whole
// point of the term on a range that is part rock. Rather than invent a
// convention for a chunk another subsystem owns, both functions are transcribed
// here under an sn prefix. Same formulas, same constants; if lib/shading ever
// publishes the seven-argument form, delete these and include it.
// ===========================================================================

float snWrapDiffuse(float NdotL, float w) {
    float denom = (1.0 + w) * (1.0 + w);
    return max(0.0, (NdotL + w) / denom);
}

float snBackScatter(vec3 N, vec3 L, vec3 V, float distortion, float power, float thickness) {
    vec3 H = normalize(L + N * distortion);
    float vh = pow(clamp(dot(V, -H), 0.0, 1.0), power);
    return vh * thickness;
}

/// Snow is translucent, and a mountain of snow with the sun behind it *glows*
/// rather than going to a dark silhouette.
///
/// Sign is critical: L points from the surface *toward* the sun, and the lobe is
/// measured against -H. Building H from -L inverts the whole term — it would
/// then peak with the sun behind the camera, which is exactly backwards.
vec3 snSnowSubsurface(
    vec3 N, vec3 L, vec3 V, vec3 lightColor,
    float thickness, float strength, float radius
) {
    vec3 shallowTint = vec3(0.94, 0.965, 1.0);
    vec3 deepTint    = vec3(0.55, 0.72, 1.0);
    vec3 tint = mix(shallowTint, deepTint, clamp(thickness * radius, 0.0, 1.0));

    float back = snBackScatter(
        N, L, V, 0.28 * radius,
        mix(3.0, 9.0, thickness),   // lobe power: thin = broad (3), deep = tight (9)
        mix(1.0, 0.30, thickness)   // amplitude:  thin = bright (1), deep = dim (0.30)
    );

    return lightColor * tint * back * strength;
}

// ===========================================================================
// The far range — a heightfield raymarched on the skybox.
//
// The constraint is that the range must never read as flat, and that rules out
// both cheap answers. A silhouette cut out of the sky reads as a sticker. A band
// of noise shaded by its own azimuth gradient reads as corrugated cardboard,
// because a ridge's *form* comes from slopes facing toward and away from the
// sun, and a one-dimensional profile has no such thing.
//
// So this marches a real two-dimensional heightfield, in world space. It costs
// nothing in geometry, it is behind everything by construction, and because the
// field is real: ridges occlude ridges, the normal is analytic, a second short
// march gives the range its own cast shadows, and extinction is integrated per
// pixel over the true distance so nearer massifs sit in front of hazier ones
// with no hand-placed layers.
// ===========================================================================

/// Tallest a peak can be, metres. The march's early-out depends on this being a
/// true bound, so it is derived from the amplitude rather than guessed.
float ridgeCeiling(float amp) {
    return amp * 1.05;
}

/// Earth curvature drop at a horizontal distance, metres. 2.4 m at 5.5 km, 50 m
/// at 25 km, 126 m at 40 km — small, but it is what sinks the farthest massifs'
/// feet below the horizon and lets the near ones stand in front of them.
float ridgeDrop(float d) {
    return d * d / 12742000.0;
}

/// Height of the range at a world XZ, metres, with its analytic gradient.
/// Returns vec3(height, dH/dx, dH/dz).
vec3 ridgeField(vec2 p, float amp) {
    // Kilometres. The whole range is authored at this scale.
    vec2 q = p * 0.001;
    float kq = 0.001;   // d(km)/d(m), for the chain rule

    // ---- the bowl ---------------------------------------------------------
    // The range is excluded from a seven-kilometre disc centred on the origin,
    // and the player is confined to a 620 m play radius inside it, so the field
    // is guaranteed empty everywhere the march begins.
    //
    // Not decoration — it is what makes the march correct. Without it a massif
    // can start closer than the near plane, the ray begins *inside* the rock,
    // every such ray clamps to the same distance, and the near faces draw as
    // flat-topped vertical slabs. They looked like buildings on the horizon.
    float rad = length(p);
    float bt = clamp((rad - 7000.0) / 6000.0, 0.0, 1.0);
    float bowl = bt * bt * (3.0 - 2.0 * bt);
    if (bowl <= 0.0) return vec3(0.0);
    // WGSL select(false, true, cond) -> GLSL cond ? true : false. Reversing this
    // zeroes the gradient exactly where the field is ramping.
    vec2 dbowl = (bt > 0.0 && bt < 1.0)
        ? (p / max(rad, 1.0)) * (6.0 * bt * (1.0 - bt) / 6000.0)
        : vec2(0.0);

    // ---- where there is a range at all -------------------------------------
    // A slow massif field, so the horizon gets massifs, gaps and long low
    // saddles instead of an unbroken row of triangles.
    vec3 massif = snFbmd(q * 0.10 + vec2(11.3, 4.7), 2, 2.13, 0.52);
    float mk = 0.10 * kq;
    float t = clamp((massif.x + 0.34) / 0.70, 0.0, 1.0);
    float env = t * t * (3.0 - 2.0 * t);
    // QUIRK-3, reproduced as written: the envelope's width is 0.70 in the value
    // and 0.62 in the derivative, so the gradient is ~13% too steep wherever the
    // envelope ramps. It only perturbs shading normals on massif flanks at
    // 10-45 km, and the look was tuned around it.
    vec2 denv = (t > 0.0 && t < 1.0)
        ? massif.yz * mk * (6.0 * t * (1.0 - t) / 0.62)
        : vec2(0.0);

    // ---- domain warp -------------------------------------------------------
    // The single largest difference between "ridged noise" and "mountains". An
    // unwarped ridged field runs its crests in straight, roughly parallel lines
    // because the lattice underneath it does, and the eye reads that as
    // procedural immediately however many octaves are stacked on it.
    //
    // The gradient below ignores this warp's Jacobian, so the normals are
    // rotated slightly against the true surface. On a matte 10-45 km away that
    // is not resolvable, and carrying the chain rule through two extra fields
    // would cost more than the shading error is worth.
    vec3 w1 = snNoised(q * 0.26 + vec2(2.7, 8.1));
    vec3 w2 = snNoised(q * 0.26 + vec2(19.4, 3.6));
    vec2 qw = q + vec2(w1.x, w2.x) * 1.35;   // 1.35 km of displacement

    // ---- the peaks ---------------------------------------------------------
    // Four octaves, not three. At three the lowest octave dominates and the
    // range reads as smooth meringue mounds: no crest line anywhere, and a
    // mountain without a crest line has no scale. The second, finer stack is at
    // an incommensurate scale so the peaks do not all share one profile.
    vec3 r = snRidgedd(qw * 0.30, 4, 2.09, 0.50);
    float rk = 0.30 * kq;
    vec3 s = snRidgedd(qw * 1.05 + vec2(31.0, 17.0), 3, 2.11, 0.50);
    float sk = 1.05 * kq;

    float raw = r.x * 0.78 + s.x * 0.22;
    vec2 draw = r.yz * (0.78 * rk) + s.yz * (0.22 * sk);

    // Sharpen the crests and widen the valleys. Ridged noise squares its ridge
    // term, which rounds the top — right for sastrugi, wrong for a mountain.
    float peaks = raw * raw * raw * 0.55 + raw * 0.45;
    vec2 dpeaks = draw * (3.0 * raw * raw * 0.55 + 0.45);

    // A *small* floor under the envelope: low foothills in the gaps rather than
    // absolute nothing, which reads as a cut-out. Small is the operative word —
    // at 0.22 this was a continuous four-hundred-metre barrier at the near edge
    // of the range, and since every horizon ray meets it immediately the result
    // was a flat-topped vertical wall wrapped right around the field.
    float e = 0.06 + 0.94 * env;
    float h = peaks * e;
    vec2 dh = dpeaks * e + peaks * denv * 0.94;
    return vec3(h * bowl * amp, (dh * bowl + h * dbowl) * amp);
}

struct RidgeHit {
    bool  hit;
    float dist;     // horizontal metres to the hit
    float height;   // world Y of the surface there, ridgeDrop already applied
    vec3  normal;
    vec2  pos;      // world XZ of the hit
};

/// March the range along a view ray.
///
/// Steps grow geometrically, which is the right distribution for a field whose
/// features subtend a roughly constant angle: a fixed step wastes most of its
/// samples in the far half where a kilometre is a pixel.
///
/// Ridge-occludes-ridge falls out for free — the march returns the *first*
/// crossing, so a nearer massif hides everything behind it.
RidgeHit ridgeMarch(vec3 camPos, vec3 dir, float amp) {
    RidgeHit res;
    res.hit = false;
    res.dist = 0.0;
    res.height = 0.0;
    res.normal = vec3(0.0, 1.0, 0.0);
    res.pos = vec2(0.0);

    float hl = length(dir.xz);
    if (hl < 1e-4) return res;   // straight up or down: no hit

    vec2 stepXZ = dir.xz / hl;   // unit horizontal advance
    float slope = dir.y / hl;    // metres of rise per metre of ground

    // Where the range starts. Set by how large a massif should read, not by
    // taste: a 1.8 km peak at 9 km subtends 11 degrees, which is about what a
    // real range does across a frame.
    const float D_NEAR = 5500.0;
    // The growth anchor, not the reach — the eighteenth sample lands at 40.0 km.
    const float D_FAR = 45000.0;
    const int STEPS = 18;

    // A ray already above the tallest possible peak and still climbing can never
    // hit. This is the branch the sky above the range takes, and it is why the
    // whole effect costs a few per cent of the frame.
    float ceiling = ridgeCeiling(amp);
    if (camPos.y + slope * D_NEAR > ceiling && slope >= 0.0) return res;

    float growth = pow(D_FAR / D_NEAR, 1.0 / float(STEPS));   // 1.1238637

    // Prime the crossing state from a real sample rather than a constant. A ray
    // at the horizon meets the near face of a massif on the *first* step, and
    // with prevGap initialised to a made-up 1.0 the interpolation below returned
    // a distance somewhere between the near plane and nothing in particular. It
    // showed up as vertical striping down the whole range, which looks like a
    // shading bug and is arithmetic.
    float prevD = D_NEAR;
    float prevGap = camPos.y + slope * D_NEAR
                  - (ridgeField(camPos.xz + stepXZ * D_NEAR, amp).x - ridgeDrop(D_NEAR));

    if (prevGap < 0.0) {
        // Started inside the near face. That is a legitimate hit, at D_NEAR.
        res.dist = D_NEAR;
        res.pos = camPos.xz + stepXZ * D_NEAR;
        vec3 f = ridgeField(res.pos, amp);
        res.height = f.x - ridgeDrop(D_NEAR);
        // Gradient-to-normal for y = H(x, z). Not a cross product, so it is the
        // same expression in a left- and a right-handed frame.
        res.normal = normalize(vec3(-f.y, 1.0, -f.z));
        res.hit = true;
        return res;
    }

    float d = D_NEAR * growth;

    for (int i = 1; i < STEPS; i++) {
        vec2 p = camPos.xz + stepXZ * d;
        float h = ridgeField(p, amp).x - ridgeDrop(d);
        float rayY = camPos.y + slope * d;
        float gap = rayY - h;

        if (gap < 0.0) {
            // Interpolate the crossing rather than accepting the step. At 12%
            // growth a step is hundreds of metres wide out here, and taking its
            // far end would quantise every silhouette into visible terraces.
            float t = 0.5;
            if (prevGap - gap > 1e-5) t = prevGap / (prevGap - gap);
            res.dist = mix(prevD, d, clamp(t, 0.0, 1.0));
            res.pos = camPos.xz + stepXZ * res.dist;

            vec3 f = ridgeField(res.pos, amp);
            res.height = f.x - ridgeDrop(res.dist);
            res.normal = normalize(vec3(-f.y, 1.0, -f.z));
            res.hit = true;
            return res;
        }

        // Climbed clear of the tallest possible peak: nothing ahead can be hit.
        if (rayY > ceiling && slope > 0.0) return res;

        prevGap = gap;
        prevD = d;
        d *= growth;
    }

    return res;
}

/// Fraction of the sun reaching a point on the range — 0 or 1.
///
/// Four steps and a hard result. A soft edge would cost four times the samples
/// to describe a penumbra that, at twenty kilometres, is a fraction of a pixel,
/// and what this term is actually for is the large-scale read of which flank of
/// a massif is in the shade of the one in front of it.
///
/// ridgeDrop is deliberately NOT applied here, unlike in ridgeMarch, while the
/// height passed in *is* drop-corrected. Over the 7.4 km this reaches the drop
/// is 4.3 m, negligible against 2 km peaks; the omission is reproduced as
/// written.
float ridgeShadow(vec2 pos, float height, vec3 sunDir, float amp) {
    float hl = length(sunDir.xz);
    if (hl < 1e-3 || sunDir.y <= 0.0) return 1.0;

    vec2 stepXZ = sunDir.xz / hl;
    float slope = sunDir.y / hl;

    float d = 420.0;
    for (int i = 0; i < 4; i++) {
        float h = ridgeField(pos + stepXZ * d, amp).x;
        if (h > height + slope * d) return 0.0;
        d *= 2.6;   // 420, 1092, 2839.2, 7381.9 m
    }
    return 1.0;
}

/// Shade a point on the far range.
///
/// Deliberately the *snow field's* material logic, not a separate one: the same
/// wrapped diffuse, the same SH ambient, the same near-white albedo that is
/// never 1.0. A distant mountain rendered with its own ad-hoc lighting is the
/// classic way a matte painting announces itself.
vec3 shadeRidge(RidgeHit hit, vec3 dir) {
    vec3 N = hit.normal;
    vec3 L = uSunDir;   // toward the sun, world space

    // Snow almost everywhere, rock only on the faces too steep to hold it. This
    // is a polar range, not an alpine one: there is no snow line to speak of,
    // and the first version's 120-460 m altitude ramp put rock across the whole
    // visible band and turned the horizon into a dark smear. Rock is here for
    // the *break* it gives a white massif, not as a ground cover.
    float steep = 1.0 - N.y;
    float snowMask = clamp(1.0 - smoothstep(0.46, 0.80, steep), 0.0, 1.0);

    vec3 rock = vec3(0.052, 0.055, 0.066);
    vec3 snow = vec3(0.855, 0.885, 0.945);
    vec3 albedo = mix(rock, snow, snowMask);

    float shadow = ridgeShadow(hit.pos, hit.height, L, uRidgeAmp);

    // uSunColor is the sun's radiance at the ground, on the same scale the LUT
    // stores radiance in — the identical number the snow field is lit by.
    float diff = snWrapDiffuse(dot(N, L), mix(0.15, 0.62, snowMask));
    vec3 col = albedo * INV_PI * uSunColor * diff * shadow;

    // The term the first version left out, and the reason the range read as a
    // different material from the field it stands behind. Without it the range
    // came out as dark warm shapes against bright warm haze, which is the one
    // combination that reads as dirt — and it was most visible in exactly the
    // framing where a range should look its best, looking into a low sun.
    // Note it survives at half strength even in full cast shadow.
    vec3 V = -dir;   // from the surface toward the camera, as the ground uses
    col += snSnowSubsurface(N, L, V, uSunColor, 0.45, snowMask, 1.0)
         * albedo * mix(0.5, 1.0, shadow);

    // Sky fill. At this distance it is most of what is left after extinction,
    // and it is the reason distant snow reads blue rather than grey.
    col += albedo * INV_PI * skyIrradiance(N);

    // Bounce off the range's own snow, exactly as the field does off itself. A
    // white massif is lit from every direction by the rest of the massif, and
    // leaving it out is what makes shaded faces read as too dark by a stop.
    // (The snow field uses 0.28 for the same term; the range uses 0.30.)
    col += albedo * INV_PI * skyIrradiance(vec3(0.0, 1.0, 0.0))
         * 0.30 * clamp(-N.y * 0.5 + 0.5, 0.0, 1.0) * snowMask;

    // ---- aerial perspective -----------------------------------------------
    // The scene's own, not a second atmosphere of the range's — and that is most
    // of what makes the range sit *in* the landscape rather than behind it. A
    // physically-real atmosphere integrated over the true kilometres gives the
    // frame two atmospheres, and the seam lands exactly where the eye is looking.
    //
    // Inlined rather than applyAerial() so dir — the skybox ray — is the view
    // direction; the result is arithmetically identical.
    vec3 hitPos = vec3(hit.pos.x, hit.height, hit.pos.y);
    float t = aerialTransmittance(uCameraPos, hitPos, uFog.x, uFog.y, uFog.z);
    float ext = clamp(1.0 - pow(t, uFog.w), 0.0, 1.0);

    // The identical inscatter the ground converges to. At full extinction it is
    // the plain sky lookup, which is what this shader draws where the march
    // missed — so a fully hazed massif and the sky beside it are literally the
    // same value, and there is nothing left to draw an edge with.
    vec3 inscatter = aerialInscatterSky(dir, L, uSunColor, ext);

    return mix(col, inscatter, ext);
}

void main() {
    vec3 dir = normalize(vDir);
    vec3 col = skySample(dir);

    // ------------------------------------------------------- far-field range
    // Above the band the march's ceiling test rejects immediately, so the upper
    // bound is only there to skip the call.
    //
    // The lower bound reaches well *below* the horizon on purpose. Fading the
    // range out at a fixed elevation angle drew a dead straight horizontal line
    // under the whole massif — a ruler across the frame, which is the one thing
    // a landscape never has. A real range's feet are hidden by the land in front
    // of it, and here that happens for free: the clipmap is drawn after the sky
    // and covers everything below its own silhouette. A ray at -0.05 from eye
    // height meets the ground inside eighty metres.
    if (uRidgeAmp > 1.0 && dir.y < 0.230 && dir.y > -0.050) {
        RidgeHit hit = ridgeMarch(uCameraPos, dir, uRidgeAmp);
        if (hit.hit) {
            col = shadeRidge(hit, dir);
        }
    }

    // ----------------------------------------------------------- solar disc
    // ~0.53 degrees across with limb darkening, so the edge is ~59% of the
    // centre: a visible, soft-edged disc rather than a flat white dot. The glow
    // around it is the aureole — forward-scattered light in the first few
    // degrees, which at this sun elevation is a large part of why the horizon
    // reads warm. Two lobes, half-max at 1.80 and 8.42 degrees.
    //
    // Added over the whole hemisphere the sun is in, with no gate, so a massif
    // standing in front of the sun still picks up its glow. Uses uSunTint (the
    // normalised hue) times the shared scale, not the radiance.
    float mu = dot(dir, uSunDir);
    float discCos = cos(0.0046);
    if (mu > discCos) {
        float r = sqrt(max(0.0, 1.0 - mu * mu)) / 0.0046;
        float limb = pow(max(0.0, 1.0 - r * r * 0.72), 0.42);
        col += uSunTint * uSunScale * 42.0 * limb;
    }
    float aureole = pow(max(0.0, mu), 1400.0) * 5.5 + pow(max(0.0, mu), 64.0) * 0.28;
    col += uSunTint * uSunScale * aureole * 0.5;

    // -------------------------------------------------------------- cirrus
    // Thin, high, wind-aligned. Restrained on purpose: the reference skies are
    // mostly clean gradient, and clouds here exist to stop the upper sky from
    // being a flat wash, not to become subject matter. Maximum blend is
    // 0.62 * cloudAmount = 34%.
    if (uCloudAmount > 0.001 && dir.y > 0.0) {
        // Project onto a high plane so bands converge at the horizon.
        float planeY = 1.0 / max(0.06, dir.y);
        vec2 cp = dir.xz * planeY * 0.5 + uWindDir * uTime * 0.004;

        // Stretch across the wind so the streaks run with it. uWindDir is
        // (sin(bearing), cos(bearing)) in the same world frame the terrain's
        // sastrugi use — see the handedness note in this file's header.
        float a = atan(uWindDir.x, uWindDir.y);
        cp = snRot2(a) * cp;
        cp.x *= 0.28;

        float n = snFbmd(cp, 4, 2.13, 0.52).x;
        float cloud = smoothstep(0.06, 0.34, n);
        // Fade out at the horizon and at the zenith.
        cloud *= smoothstep(0.0, 0.22, dir.y) * (1.0 - smoothstep(0.55, 1.0, dir.y) * 0.45);
        cloud *= uCloudAmount;

        // Lit from below-ish by a low sun, so the underside catches warmth.
        float sunLit = pow(max(0.0, mu * 0.5 + 0.5), 3.0);
        vec3 cloudCol = mix(vec3(0.52, 0.60, 0.74), uSunTint * 1.35, sunLit * 0.75);
        col = mix(col, cloudCol * (0.55 + uSunScale * 0.06), cloud * 0.62);
    }

    outColor = vec4(col, 1.0);
}
`;
