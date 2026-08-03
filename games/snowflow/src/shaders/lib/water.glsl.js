/**
 * `lib/water` [SPELLS] — the shape of a bent water body.
 *
 * Every spell that moves a coherent mass of water is one or more *strands*: a
 * swept surface along a spine, exactly the construction the snow-surf wake uses,
 * for exactly the same reason. Nothing is generated at runtime; the mesh is a
 * static lattice of (column, ring, strand) and the vertex shader places every
 * vertex from a small data texture. A ribbon nine metres long and a ribbon two
 * metres long cost the same buffer and the same upload.
 *
 * Two properties this construction exists to produce:
 *
 *   * an unbroken arc with mass. Bent water is never a sheet of particles — it
 *     is a body, with a leading edge, a trailing edge and a thickness you can
 *     see through.
 *   * momentum. It lags the hand that threw it and keeps going after the hand
 *     stops, which falls out of the spine being a *record of where the head has
 *     been* rather than a shape recomputed each frame.
 *
 * Data texture, three rows per strand (strand s occupies rows 3s..3s+2):
 *
 *   row 0   (x, y, z, radius m)
 *   row 1   (rightX, rightY, rightZ, twist)  reference frame, parallel-transported
 *   row 2   (distance along m, age 0..1, foam 0..1, flatten)
 *
 * `flatten` squashes the section vertically, which is what lets one strand be a
 * round airborne tube at its head and a wide shallow sheet where it lies over
 * the snow, with no second code path.
 *
 * Per-strand constants arrive as a uniform rather than in the texture, since
 * they do not vary along the spine:
 *
 *   strandParams[s] = (profile, milkiness, alpha, column count)
 *
 * profile 0 is a closed tube, profile 1 is an open breaking sheet borrowed whole
 * from the wake's own section integral.
 *
 * ---------------------------------------------------------------------------
 * PORT NOTE — `wakeSection` is defined HERE, not included from `lib/wake`.
 *
 * ARCHITECTURE.md §3.1 signs `lib/wake` with `wakePoint()` alone; the section
 * integral the SHEET profile needs is not part of that published surface, and
 * `_spec/spells.md` §4.6 reproduces it in full precisely because Sweep depends
 * on it and it does not live in the spells directory. Including `lib/wake` from
 * here would also make this chunk fail to resolve for as long as [WAKE] has not
 * registered, taking the whole page down with it.
 *
 * So it is duplicated, byte-for-byte against §4.6 / §17.4, behind an include
 * guard: no shader in the project includes both chunks, and if one ever does the
 * guard is what stops a redefinition error. If [WAKE] later publishes
 * `wakeSection` as part of `lib/wake`, delete the guarded block and include the
 * chunk instead — the constants are identical and the shape will not move.
 * ---------------------------------------------------------------------------
 *
 * HANDEDNESS. Two cross products appear below, in `waterPoint`'s frame
 * construction. Both are written right-handed — Three's world convention — and
 * both were right-handed in the reference as well, since Babylon's left-handed
 * *world* changes how a cross product is read, not what it computes. Neither
 * sign is observable here: `up = cross(tangent, rgt)` only orients a closed
 * elliptical section swept about the tangent, and mirroring that section maps it
 * onto itself (the same set of surface points, traversed the other way round).
 * The winding that reversal implies is resolved downstream — the vertex stage
 * orients the tube's normal against the spine-to-surface vector and the fragment
 * stage turns it toward the eye — so nothing here needs a flip.
 */

export default /* glsl */`
#include "lib/common"
#include "lib/noise"

// ---------------------------------------------------- the borrowed wake section
#ifndef SNOWFLOW_WAKE_SECTION
#define SNOWFLOW_WAKE_SECTION

const int   WAKE_STEPS   = 20;
const float WAKE_NORM    = 3.35;
const float WAKE_LATERAL = 0.70;

/**
 * The breaking-wave cross-section, defined by its TURNING TANGENT rather than by
 * its position. The tangent sweeps from just below horizontal at the base
 * (th0 = -0.24, so the foot flares outward and slightly down), through vertical
 * partway up the face, to well past 180 degrees at the tip — so the lip hangs
 * *back* over the face it came off. At curl = 1 the sweep reaches 284 degrees:
 * the tip sits at 47% of the crest's lateral offset and 65% of its height, so it
 * genuinely overhangs. Stop short of ~270 and the tip is still outboard of the
 * crest, which reads as a rounded ridge rather than a wave.
 *
 * The 1.65 exponent puts most of the arc length into the face and compresses the
 * hook into the last fifth; a linear sweep gives a circle, which reads as a
 * rolled tube rather than as something thrown. WAKE_NORM normalises so the crest
 * lands near 1.0, which lets amplitude be one number in metres. WAKE_LATERAL
 * squashes the section *across* rather than uniformly — steepening it is the
 * difference between a bank and a wave.
 *
 * 'q' runs 0 at the base against the trench to 1 at the tip of the lip.
 * Returns (lateral, vertical), to be scaled by the strand radius.
 */
vec2 wakeSection(float q, float curl) {
    float th0 = -0.24;
    float th1 = 1.65 + curl * 3.30;
    vec2  p = vec2(0.0);
    float dt = q / float(WAKE_STEPS);
    for (int i = 0; i < WAKE_STEPS; i++) {
        float t = (float(i) + 0.5) * dt;     // midpoint rule
        float th = th0 + (th1 - th0) * pow(t, 1.65);
        p += vec2(cos(th), sin(th)) * (1.0 - 0.40 * t) * dt;   // thins as it climbs
    }
    return vec2(p.x * WAKE_LATERAL, p.y) * WAKE_NORM;
}
#endif

// ------------------------------------------------------------- strand fetches

/// One texel of the strand table. Note the argument order is (row, col) while
/// the texel coordinate is (col, row) — that is the reference's shape, kept so
/// the call sites read the same.
vec4 waterTexel(sampler2D tex, int row, int col) {
    return texelFetch(tex, ivec2(col, row), 0);
}

/**
 * Interpolated row, Catmull-Rom through the samples.
 *
 * Not linear, and not smoothstep either. Smoothstep is C1, which is why the wake
 * uses it, but its derivative is *zero at every knot*. Difference a normal out of
 * a surface whose radius is interpolated that way and the shading picks up a
 * ripple at exactly the sample pitch — one horizontal ring per spine sample, so a
 * column reads as a stack of discs.
 *
 * Catmull-Rom is C1 as well and has no such flat spot: the tangent at a knot is
 * the chord through its neighbours, so the interpolant carries straight through
 * it. Same basis as the spine, so the two cannot disagree about 'u'.
 *
 * End knots are CLAMPED (duplicated), not wrapped. The explicit max/min on the
 * texel indices is load-bearing in GLSL in a way it was not in WGSL: texelFetch
 * with an out-of-range coordinate is undefined here, where textureLoad clamps.
 */
vec4 waterRow(sampler2D tex, int row, float count, float u) {
    float n = max(count, 2.0);
    float f = clamp(u, 0.0, 1.0) * (n - 1.0);
    int i1 = int(floor(f));
    float fr = f - float(i1);
    int last = int(n) - 1;

    vec4 p0 = waterTexel(tex, row, max(i1 - 1, 0));
    vec4 p1 = waterTexel(tex, row, i1);
    vec4 p2 = waterTexel(tex, row, min(i1 + 1, last));
    vec4 p3 = waterTexel(tex, row, min(i1 + 2, last));

    float t2 = fr * fr;
    float t3 = t2 * fr;
    return 0.5 * (
        (2.0 * p1)
        + (-p0 + p2) * fr
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
        + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
    );
}

/**
 * Spine position, Catmull-Rom through the samples.
 *
 * A held ribbon is drawn as an arc through the air and read at two metres, so
 * the piecewise-linear spine a linear blend gives is not good enough: the
 * tangent is piecewise constant, and the specular highlight running along the
 * top of the tube bands at exactly the sample pitch.
 */
vec3 waterSpine(sampler2D tex, int base, float count, float u) {
    float n = max(count, 2.0);
    float f = clamp(u, 0.0, 1.0) * (n - 1.0);
    int i1 = int(floor(f));
    float fr = f - float(i1);
    int last = int(n) - 1;

    vec3 p0 = waterTexel(tex, base, max(i1 - 1, 0)).xyz;
    vec3 p1 = waterTexel(tex, base, i1).xyz;
    vec3 p2 = waterTexel(tex, base, min(i1 + 1, last)).xyz;
    vec3 p3 = waterTexel(tex, base, min(i1 + 2, last)).xyz;

    float t2 = fr * fr;
    float t3 = t2 * fr;
    return 0.5 * (
        (2.0 * p1)
        + (-p0 + p2) * fr
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
        + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
    );
}

/**
 * Analytic tangent of the spine — the exact derivative of 'waterSpine'.
 *
 * Not a finite difference. Sampling the spline a fraction of a *knot spacing*
 * away gives a chord rather than a tangent, and the error in a chord depends on
 * where inside the knot span it starts — so the frame wobbles with a period of
 * exactly one spine sample, and sweeping that frame along a tube scallops it at
 * every knot. Catmull-Rom's derivative is a quadratic in the local parameter and
 * is continuous across knots, so this has no such structure at all.
 *
 * The (n-1) chain factor is omitted: irrelevant after normalisation.
 *
 * Degenerate only where the spine has collapsed — the tail of a strand that is
 * being retired, and the frames right after a spell ends.
 */
vec3 waterSpineTangent(sampler2D tex, int base, float count, float u) {
    float n = max(count, 2.0);
    float f = clamp(u, 0.0, 1.0) * (n - 1.0);
    int i1 = int(floor(f));
    float fr = f - float(i1);
    int last = int(n) - 1;

    vec3 p0 = waterTexel(tex, base, max(i1 - 1, 0)).xyz;
    vec3 p1 = waterTexel(tex, base, i1).xyz;
    vec3 p2 = waterTexel(tex, base, min(i1 + 1, last)).xyz;
    vec3 p3 = waterTexel(tex, base, min(i1 + 2, last)).xyz;

    vec3 d = 0.5 * (
        (-p0 + p2)
        + 2.0 * (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * fr
        + 3.0 * (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * fr * fr
    );
    float l = length(d);
    return (l > 1e-7) ? (d / l) : vec3(0.0, 1.0, 0.0);
}

// -------------------------------------------------------------- surface relief

/**
 * Surface relief on the body of the water. Water under this much acceleration is
 * not smooth, and a perfectly smooth tube is the single thing that gives a swept
 * mesh away.
 *
 * **The frequencies are in cycles per strand, not per metre.** The lattice
 * carries a fixed number of vertices along the spine and around the section
 * whatever the strand is doing, so what a displacement field may contain is
 * fixed in *parameter* space too. Keying it to world distance means the
 * frequency in samples depends on how long the strand happens to be, and a six
 * metre column at 13 cells per metre lands at half a sample per cell — far past
 * Nyquist, where the field does not produce fine detail, it produces a beat.
 * Detail above this belongs in the fragment shader, where the sampling rate is
 * the pixel; it is there, as three counter-drifting ripple octaves on the normal.
 *
 * **Section frequencies are HIGHER than spine frequencies.** Gradient noise
 * sampled with a fast first coordinate and a slow second is nearly
 * one-dimensional in the first, so relief that varies quickly along the spine and
 * slowly around the section produces a ring bulge at every cell — a string of
 * beads. Water varies far more across a stream than along one.
 *
 * **Sampled around a CIRCLE, not along theta.** A tube is closed: the first and
 * last rings are the same point at theta and theta + 2*PI, and plain 2D noise is
 * not periodic, so feeding the angle in directly gives two different answers
 * there — a hairline crease running the whole length of every tube. Walking a
 * circle through the field makes the function periodic by construction. The
 * circle radii set how many features fit around the section: radius r gives
 * 2*PI*r noise cells of circumference, so 0.85 is about five features and 1.50
 * about nine. The 'u' offset slides the circle through the field, which is what
 * makes the pattern travel along the strand.
 */
float waterRelief(float u, float theta, float t) {
    vec2 c = vec2(cos(theta), sin(theta));
    return noise2(c * 0.85 + vec2(u * 4.0 - t * 1.6, u * 2.3)) * 0.60
         + noise2(c * 1.50 + vec2(u * 7.5 + 11.3, -u * 5.1 - t * 3.1)) * 0.40;
}

/// The same field for an *open* section, where there is no seam to close and the
/// section parameter is a plain coordinate rather than an angle.
float waterReliefOpen(float u, float v, float t) {
    return noise2(vec2(u * 4.0 - t * 1.6, v * 2.60)) * 0.60
         + noise2(vec2(u * 7.5 - t * 3.1, v * 4.40 + 11.3)) * 0.40;
}

// --------------------------------------------------------------- the surface

/**
 * A point on the strand surface.
 *
 * 'u' runs 0 (head) to 1 (tail). 'q' means different things per profile: around
 * the section for a tube (q in 0..1 maps to theta in 0..2*PI), up the face for a
 * sheet (0 at the base against the trench, 1 at the tip of the lip).
 *
 * Called from the vertex shader four times per vertex — once for the position
 * and three more for the differenced normal.
 */
vec3 waterPoint(
    sampler2D tex, int base, float count, float profile, float u, float q, float t
) {
    vec4 r0 = waterRow(tex, base, count, u);
    vec4 r1 = waterRow(tex, base + 1, count, u);
    vec4 r2 = waterRow(tex, base + 2, count, u);

    vec3 pos = waterSpine(tex, base, count, u);
    float radius = r0.w;
    float flatten = max(r2.w, 0.02);      // floor: never fully degenerate

    // Exact spline tangent — a finite difference here is what scalloped every
    // tube at its sample pitch.
    vec3 tangent = waterSpineTangent(tex, base, count, u);

    // The stored right vector is parallel-transported on the CPU, which is what
    // stops the section spinning as the spine curves. Re-orthogonalised here,
    // because interpolating between two transported frames does not preserve the
    // right angle exactly.
    vec3 rgt = r1.xyz - tangent * dot(r1.xyz, tangent);
    float rlen = length(rgt);
    rgt = (rlen > 1e-5)
        ? (rgt / max(rlen, 1e-8))
        : normalize(cross(tangent, vec3(0.0, 0.0, 1.0)) + vec3(1e-5, 0.0, 0.0));
    // Right-handed cross, Three world frame. See the handedness note in the
    // header: the sign is unobservable on a closed swept section.
    vec3 up = cross(tangent, rgt);

    // One initialised local and one exit rather than a return in each branch:
    // the D3D/ANGLE HLSL backend flattens a two-return function into a temporary
    // it then reports as "potentially uninitialized" (warning X4000), and
    // ARCHITECTURE.md §7.1 wants the console clean, not merely error-free.
    vec3 P = pos;

    if (profile < 0.5) {
        // ---- closed tube --------------------------------------------------
        float theta = q * 6.28318530718 + r1.w;      // twist rolls the section
        // Relief scaled BY the radius, so a thin trailing wisp is not covered in
        // the same centimetre-scale lumps as a metre-wide column.
        float rel = waterRelief(clamp(u, 0.0, 1.0), theta, t);
        float rr = radius * (1.0 + rel * 0.22);
        P = pos + rgt * (cos(theta) * rr) + up * (sin(theta) * rr * flatten);
    } else {
        // ---- open breaking sheet ------------------------------------------
        // 'right' is the outward radial and the section stands in the VERTICAL
        // PLANE containing it — world +Y, not the transported 'up'. That is what
        // makes a Sweep crescent lie on the ground correctly however the frame was
        // transported. r1.w is CURL here, not twist.
        vec2 sec = wakeSection(q, r1.w);
        float rel = waterReliefOpen(clamp(u, 0.0, 1.0), q * 3.0, t)
                  * 0.13 * smoothstep(0.1, 0.7, q);
        P = pos
          + rgt * ((sec.x + rel) * radius)
          + vec3(0.0, (sec.y + rel * 0.5) * radius * flatten, 0.0);
    }

    return P;
}
`;
