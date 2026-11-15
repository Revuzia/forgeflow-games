/**
 * `lib/wake` — the shape of the snow-surf wake. [WAKE]
 *
 * Port of the reference's `src/shaders/lib/wake.wgsl`, function for function and
 * constant for constant. It is included by the beauty vertex stage, both shadow
 * cascade vertex stages, the depth-prepass vertex stage and all three of their
 * fragment stages, and every one of them must evaluate *byte-identical*
 * functions: the beauty pass decides where the wall is and the cascade decides
 * where its shadow is, so any divergence shows up as a shadow that is not quite
 * the shape of the thing casting it — subtle, and impossible to attribute.
 *
 * The wake is a swept surface. Its spine is the path the board has taken,
 * resampled every 30 cm into a 96 x 3 RGBA32F data texture; its cross-section is
 * a breaking wave, *integrated here from a turning tangent* rather than authored
 * as a spline, so a single `curl` parameter takes it continuously from a low
 * heaped bank to a fully overhanging plunging lip.
 *
 * Spine texture layout, one column per sample, column 0 = the bow:
 *
 *   row 0   (x, y, z, distance behind the bow, metres)
 *   row 1   (rightX, rightZ, amplitude left, amplitude right)
 *   row 2   (curl left, curl right, age 0..1, unused)
 *
 * Amplitude and curl are resolved per side on the CPU, because which side of the
 * board is the *outside* of the turn is a question about the carve, not about
 * geometry, and the answer is one number that both sides need.
 *
 * ---------------------------------------------------------------------------
 * PUBLIC SURFACE
 *
 *     vec2 wakeSection(float q, float curl);            // (lateral, up), unit amplitude
 *     vec4 wakeScalars(float u, float side);            // (amp m, curl, dist m, age 0..1)
 *     vec3 wakeSpine(float u);                          // Catmull-Rom spine position
 *     vec3 wakePoint(float u, float q, float side, float t);
 *     vec3 wakePoint(float u, float q, float side);     // ...at `wakeTime`
 *     vec3 wakePoint(float u, float q, float side, out vec3 dPdu, out vec3 dPdv);
 *     bool wakeEroded(float alongDist, float q, float age01, float t);
 *
 * The five-argument form is ARCHITECTURE.md §3.1's signed entry point
 * (`wakePoint(u, v, side, out dPdu, out dPdv)`; the contract's `v` is this
 * file's `q`, the section parameter). It differences the tangents out of the
 * *same* `wakePoint` the geometry uses, which is the whole reason the normal
 * cannot disagree with the surface — see the note on it below.
 *
 * DEVIATION FROM THE REFERENCE, shape only, no number moves: the reference
 * threads `tex` and `count` through every call. Here they are uniforms declared
 * by this chunk — the same choice `lib/shadowLookup` and `lib/atmosphere` made
 * for their blocks — so the contract's texture-free §3.1 signature is
 * expressible at all. `SurfWake` hands the identical uniform objects to all four
 * programs by reference, so they cannot drift.
 *
 * ---------------------------------------------------------------------------
 * HANDEDNESS (ARCHITECTURE.md §6). One line in this file consumes a world
 * direction and it is marked PORT FRAME. The reference is Babylon / left-handed
 * with the character's basis
 *
 *     right = ( cos f, -sin f )      forward = ( -right.z, right.x ) = ( sin f, cos f )
 *
 * This port's world is that world mirrored in z (`core/camera.js`,
 * `character/controller.js`), so the character's basis here is
 *
 *     right = ( cos f,  sin f )      forward = (  right.z, -right.x ) = ( sin f, -cos f )
 *
 * `src/vfx/surfWake.js` writes the port's `right` into row 1 of the data
 * texture, so `wakePoint` rebuilds forward from it with the *port* formula. Get
 * that backwards and the lip's backward shear runs forwards, the plume leaves
 * from ahead of the board, and the wake twists the wrong way through a turn.
 *
 * The one cross product in the subsystem is NOT here — it is in the vertex
 * program, which builds the normal from the two tangents this chunk returns, and
 * the sign flip the mirror demands is documented at that line.
 */

export default /* glsl */`
#include "lib/noise"

// ------------------------------------------------------------------- uniforms
//
// Shared by reference across the beauty, both cascade and the prepass programs.
// Written once per frame by SurfWake._pushUniforms().

/// 96 x 3 RGBA32F, NEAREST, CLAMP, no mips — see the layout in the header.
/// RGBA32F and not RGBA16F: row 0 holds absolute world coordinates that reach
/// ~870 m on this map, where fp16 quantises to about half a metre.
uniform sampler2D wakeTex;
/// Live spine samples. Fewer than 2 and every fetch clamps onto column 0.
uniform float wakeCount;
uniform float wakeCols;   // 128 — lattice columns along the spine
uniform float wakeRows;   // 18  — lattice rows across the wave section
/// The wake's own clock, seconds. Drives the lump drift and the erosion boil.
uniform float wakeTime;

// ------------------------------------------------------------------ constants

/// Steps in the cross-section integral. Twenty is well past the point where the
/// midpoint rule stops mattering on a curve this smooth, and the cost is a
/// rounding error against the vertex count.
const int WAKE_STEPS = 20;

/// Normalises the integral so the crest lands near 1.0, which is what lets
/// amplitude be one number in metres rather than a per-curl table. It is not
/// exact across the curl range on purpose — a mild bank comes out a little
/// taller and much wider than a plunging one, which is what a mild bank does.
const float WAKE_NORM = 3.35;

/// The section is squashed ACROSS, not scaled uniformly.
///
/// Left to its own proportions the curve is wider than it is tall, and at 2.4 m
/// of amplitude that is a three-metre-wide ramp: legible as terrain, not as
/// something thrown. Steepening it is the difference between a bank and a wave.
const float WAKE_LATERAL = 0.70;

// ------------------------------------------------------------- cross-section

/// Cross-section of a breaking wave, in (lateral, up), unit height.
///
/// The curve is defined by its *tangent angle* rather than by its position: the
/// tangent sweeps from just below horizontal at the base, through vertical
/// partway up the face, to well past 180 degrees at the tip — so the lip hangs
/// back over the face it came off, which is the whole read of a breaking wave
/// and is not something a heightfield can express at all.
///
/// At 'curl' = 1 the sweep reaches 284 degrees and the tip sits at 48.8% of the
/// section's maximum lateral extent and 65.0% of its maximum height, so it
/// genuinely overhangs. Stop short of ~270 and the tip is still outboard of the
/// crest, which reads as a rounded ridge.
///
/// The 1.65 exponent puts most of the arc length into the face and compresses
/// the hook into the last fifth. A linear sweep gives a circle, which reads as a
/// rolled tube of snow rather than as something thrown.
///
/// Midpoint rule, 20 steps over [0, q], evaluated freshly at every vertex — not
/// a prefix sum over a fixed table. Sampling at t = i*dt instead of
/// (i + 0.5)*dt visibly changes the base flare.
vec2 wakeSection(float q, float curl) {
    float th0 = -0.24;                  // base flares outward and slightly down
    float th1 = 1.65 + curl * 3.30;     // 95 deg (heap) .. 284 deg (plunging)
    vec2 p = vec2(0.0);
    float dq = q / float(WAKE_STEPS);
    for (int i = 0; i < WAKE_STEPS; i++) {
        float t = (float(i) + 0.5) * dq;
        float th = th0 + (th1 - th0) * pow(t, 1.65);
        // The section thins as it climbs, so the lip is fine and the base broad.
        // Note this multiplies the step LENGTH, not the angle.
        p += vec2(cos(th), sin(th)) * (1.0 - 0.40 * t) * dq;
    }
    return vec2(p.x * WAKE_LATERAL, p.y) * WAKE_NORM;
}

// ------------------------------------------------------------- spine sampling

/// Per-side scalars at spine parameter 'u', interpolated with a SMOOTHSTEP
/// weight rather than linearly.
///
/// The samples are 0.3 m apart and the amplitude envelope changes by a couple of
/// percent between them, which a linear blend turns into a C0 kink — invisible
/// in the silhouette, plainly visible as a band every 0.3 m once a normal is
/// differenced out of it. Smoothstep costs one multiply and makes the field C1.
///
/// Returns (amplitude m, curl, distance behind bow m, age 0..1).
///
/// WGSL 'select(f, t, cond)' returns its FIRST argument when the condition is
/// false; GLSL's ternary returns its first when true. The two side selects below
/// are written in the GLSL order.
vec4 wakeScalars(float u, float side) {
    float n = max(wakeCount, 2.0);
    float f = clamp(u, 0.0, 1.0) * (n - 1.0);
    int i1 = int(floor(f));
    int i2 = min(i1 + 1, int(n) - 1);
    float s = smoothstep(0.0, 1.0, f - float(i1));

    vec4 b1 = texelFetch(wakeTex, ivec2(i1, 1), 0);
    vec4 b2 = texelFetch(wakeTex, ivec2(i2, 1), 0);
    vec4 c1 = texelFetch(wakeTex, ivec2(i1, 2), 0);
    vec4 c2 = texelFetch(wakeTex, ivec2(i2, 2), 0);
    float d1 = texelFetch(wakeTex, ivec2(i1, 0), 0).w;
    float d2 = texelFetch(wakeTex, ivec2(i2, 0), 0).w;

    bool left = side < 0.0;
    float amp  = left ? mix(b1.z, b2.z, s) : mix(b1.w, b2.w, s);
    float curl = left ? mix(c1.x, c2.x, s) : mix(c1.y, c2.y, s);
    return vec4(amp, curl, mix(d1, d2, s), mix(c1.z, c2.z, s));
}

/// Spine position at 'u', Catmull-Rom through the samples, tension 0.5,
/// endpoints clamped.
///
/// Linear would be geometrically fine — at 19.5 m/s and the controller's turn
/// rate the sagitta over one 0.3 m segment is 1.4 mm — but the surface normal is
/// differenced out of this, and a piecewise-linear spine gives a piecewise
/// CONSTANT tangent, which bands the crest highlight at exactly the sample pitch.
vec3 wakeSpine(float u) {
    float n = max(wakeCount, 2.0);
    float f = clamp(u, 0.0, 1.0) * (n - 1.0);
    int i1 = int(floor(f));
    float fr = f - float(i1);
    int last = int(n) - 1;

    vec3 p0 = texelFetch(wakeTex, ivec2(max(i1 - 1, 0), 0), 0).xyz;
    vec3 p1 = texelFetch(wakeTex, ivec2(i1, 0), 0).xyz;
    vec3 p2 = texelFetch(wakeTex, ivec2(min(i1 + 1, last), 0), 0).xyz;
    vec3 p3 = texelFetch(wakeTex, ivec2(min(i1 + 2, last), 0), 0).xyz;

    float t2 = fr * fr;
    float t3 = t2 * fr;
    return 0.5 * (
        (2.0 * p1)
        + (-p0 + p2) * fr
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
        + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
    );
}

// ----------------------------------------------------------------- the surface

/// The wake surface. 'u' runs 0 (bow) to 1 (tail), 'q' runs 0 (base, against the
/// trench) to 1 (tip of the lip), 'side' is -1 or +1, 't' is the wake clock.
vec3 wakePoint(float u, float q, float side, float t) {
    vec4 sc = wakeScalars(u, side);
    vec3 pos = wakeSpine(u);

    // A TRUNCATION, not a floor-plus-fraction: the right/forward basis is
    // fetched from a SINGLE column, so the frame is piecewise constant per spine
    // segment while position (Catmull-Rom) and scalars (smoothstep-lerped) are
    // both interpolated. That asymmetry is deliberate — interpolating and
    // renormalising the basis changes the wake's twist through a turn.
    int i1 = int(clamp(u, 0.0, 1.0) * (max(wakeCount, 2.0) - 1.0));
    vec2 rgt2 = normalize(texelFetch(wakeTex, ivec2(i1, 1), 0).xy);
    vec3 rgt = vec3(rgt2.x, 0.0, rgt2.y);
    // PORT FRAME (see the header). Three is right-handed Y-up and this world is
    // the reference's mirrored in z, so forward is ( right.z, 0, -right.x ).
    // The reference, being left-handed, writes ( -right.z, 0, right.x ).
    vec3 fwd = vec3(rgt2.y, 0.0, -rgt2.x);

    vec2 sec = wakeSection(q, sc.y);

    // The two walls start close together at the bow and spread behind it, which
    // is what makes the pair read as a bow wave splitting around the board
    // rather than as two unrelated banks. The base also has to clear the berm
    // the groove brush throws at 0.45-0.6 m, or the wall grows out of the inside
    // of its own trench and its first third is buried.
    float l0 = 0.24 + 0.44 * smoothstep(0.3, 2.6, sc.z);

    // Thrown snow is not a ruled surface. A lump field displaced along the
    // section's OWN normal breaks the sweep up into gathered mass, and because
    // it is applied *here* rather than in the fragment shader the vertex normal
    // — differenced out of this very function — picks it up for free, and so
    // does the shadow the wake casts.
    //
    // 1.89 is not a magic number: wakeSection sweeps through
    // (th1 - th0) = (1.65 + 3.30*curl) - (-0.24) = 1.89 + 3.30*curl, so 'thq' IS
    // the section's tangent angle at t = q and 'secN' its left-hand unit normal.
    // Copying 1.65 here instead leaves the normal wrong by up to 13.75 degrees
    // and the lumps shear along the face.
    float thq = -0.24 + (1.89 + sc.y * 3.30) * pow(q, 1.65);
    vec2 secN = vec2(-sin(thq), cos(thq));
    // Three octaves at incommensurate frequencies, all of which vary both up the
    // face (q) and along the spine (dist). A single octave keyed only on
    // distance puts one bump per noise cell in a dead straight line, 0.37 m
    // apart at the same height all the way down the wake, and the wall comes out
    // looking like a caterpillar.
    //   side * 17.3 / 31.7 / 5.3   decorrelate the two walls (side is +/-1, so
    //                              they sample 34.6 / 63.4 / 10.6 units apart)
    //   octaves 1 and 3 drift forward in time, octave 2 backward — a static lump
    //   field on a moving wall is the surface equivalent of painted-on texture
    //   smoothstep(0.12, 0.72, q)  weights it toward the crest: the base is held
    //                              in place by the ground, the top is free to
    //                              gather
    // Amplitude 0.085 is in UNIT-SECTION space, like 'sec' — both are taken to
    // metres by the same sc.x, so a 2.4 m wall gets up to ~0.2 m of lump.
    float lump = (noise2(vec2(sc.z * 1.13 + q * 0.9 + side * 17.3, q * 1.7 + 5.1 + t * 0.30)) * 0.55
                + noise2(vec2(sc.z * 3.31 - q * 1.7 + side * 31.7 - t * 0.45, q * 4.3 + 2.7)) * 0.30
                + noise2(vec2(sc.z * 8.7 + side * 5.3, q * 9.1 + t * 0.9)) * 0.15)
               * 0.085 * smoothstep(0.12, 0.72, q);

    // Asymmetric on purpose: lateral carries WAKE_LATERAL, vertical does not —
    // consistent with 'sec' itself, whose .x was already squashed inside
    // wakeSection and whose .y was not.
    float lat = l0 + (sec.x + secN.x * WAKE_LATERAL * lump) * sc.x;

    // Thrown snow lags the thing that threw it, so the lip trails backward along
    // the spine by up to 0.34 * amplitude metres. Quadratic in q, so the base
    // does not move; a SHEAR rather than an offset, so the surface stays
    // connected.
    float along = -q * q * 0.34 * sc.x;

    // The flat 10 cm sink: the base has to meet a trench floor and a berm crest
    // that the spine's recorded ground height knows nothing about. Vertical is
    // WORLD-vertical, never tilted by the terrain normal.
    return pos
        + rgt * (side * lat)
        + vec3(0.0, (sec.y + secN.y * lump) * sc.x - 0.10, 0.0)
        + fwd * along;
}

/// The same surface at the current wake clock.
vec3 wakePoint(float u, float q, float side) {
    return wakePoint(u, q, side, wakeTime);
}

/**
 * ARCHITECTURE.md §3.1's signed entry point. Returns the surface point and the
 * two tangents FINITE-DIFFERENCED OUT OF THE SAME FUNCTION.
 *
 * Not analytic, and deliberately so. The surface is a sweep with a per-sample
 * amplitude envelope, a backward shear and a lump field on top; the analytic
 * normal for all of that together is long and easy to get subtly wrong. Three
 * wakePoint evaluations cost less than the vertex shader spends on the spine
 * fetch, and they cannot disagree with the geometry because they ARE the
 * geometry.
 *
 * The step is 0.65 lattice cells in both directions — not 1.0, not 0.5 — and its
 * sign FLIPS past the midpoint of the patch, with the difference multiplied by
 * that sign to restore orientation. Without the flip the pair straddles a clamp
 * at the patch boundary, silently returning a zero-length tangent and a NaN
 * normal on the boundary column.
 *
 * The caller builds the normal; see the handedness note at that line.
 */
vec3 wakePoint(float u, float q, float side, out vec3 dPdu, out vec3 dPdv) {
    float tm = wakeTime;
    vec3 P = wakePoint(u, q, side, tm);

    float du = 0.65 / max(wakeCols - 1.0, 1.0);
    float dq = 0.65 / max(wakeRows - 1.0, 1.0);
    float su = (u > 0.5) ? -1.0 : 1.0;
    float sq = (q > 0.5) ? -1.0 : 1.0;

    dPdu = (wakePoint(u + du * su, q, side, tm) - P) * su;
    dPdv = (wakePoint(u, q + dq * sq, side, tm) - P) * sq;
    return P;
}

// -------------------------------------------------------------------- erosion

/// True where the wake has broken up into airborne powder and there is no
/// surface left to draw.
///
/// Two jobs, and only two:
///
///   1. Soften the very top edge, so the lip is not a clean cut across a tube.
///      A narrow band — the top sixth of the section — and lightly.
///   2. Dissolve the whole wall at the end of its life, so it goes to powder
///      rather than shrinking back into the ground or popping out.
///
/// Deliberately NOT a third: tearing the top *half* of the wall into chunks
/// reads as a breaking wave in a still frame and as a mesh with holes in it in
/// motion. Breakup is the plume's job — snow leaving a crest is airborne, and
/// airborne snow is particles, not geometry with bites out of it.
///
/// Called identically from the beauty, cascade and prepass fragment stages, or
/// the wake would cast (and occlude with) a surface it is not drawing.
bool wakeEroded(float alongDist, float q, float age01, float t) {
    float brk = smoothstep(0.84, 1.06, q) * mix(0.34, 0.70, age01)
              + smoothstep(0.68, 1.0, age01) * 0.95;
    if (brk <= 0.001) { return false; }

    // Thirteen cells across the section, not four and a half: any coarser in 'q'
    // and the noise is effectively one-dimensional, so the holes come out as a
    // row of vertical slots — a comb, not a breakup.
    //
    // Both octaves are SHEARED off the axes. Gradient noise has its cell walls
    // aligned to its input, so sampling on (distance, section) directly tears
    // the crest into axis-aligned rectangles, legible as a grid the moment the
    // wave is more than a few metres long.
    //
    // And both drift with time, in OPPOSITE directions, so their sum boils
    // rather than scrolls: holes open, close and migrate in place, roughly three
    // cell crossings a second on the fine octave and one on the coarse. A crest
    // torn by a pure function of position is a crest full of chunks that are
    // permanently about to fall off and never do.
    //
    // 0.72 rather than 0.5 because gradient noise only reaches about +/-0.7, and
    // a threshold that never sees the ends of the range erodes evenly instead of
    // tearing.
    vec2 p = vec2(alongDist, q);
    float a = noise2(vec2(
        p.x * 6.9 + p.y * 3.1 + t * 0.9,
        p.y * 13.0 - p.x * 2.2 - t * 0.6
    )) * 0.72 + 0.5;
    float b = noise2(vec2(
        p.x * 19.0 - p.y * 9.0 + 31.7 - t * 3.1,
        p.y * 31.0 + p.x * 7.0 + t * 2.3
    )) * 0.72 + 0.5;
    return (a * 0.58 + b * 0.42) < brk;
}
`;
