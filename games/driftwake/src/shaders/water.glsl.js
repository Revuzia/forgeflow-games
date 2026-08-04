/**
 * The spell-water stage pair — vertex placement and shading.
 *
 * Whole stages, not `lib/` chunks, so they live here as plain string exports and
 * are imported by their owner (`spells/waterBody.js`), per ARCHITECTURE.md §1.
 *
 * VARYING BUDGET (ARCHITECTURE.md §4.1 — 30 vec4s, and the snow shader is the
 * one under pressure, not this). Three slots are used, packed:
 *
 *     vWorldRad    (world.xyz, radius)
 *     vNormalFoam  (normal.xyz, foam)
 *     vMilkAlpha   (milkiness, alpha)
 *
 * Two of the reference's varyings are dropped because its fragment stage never
 * reads them — `vQ` and `vU` are declared and unused in `water.fragment.wgsl`.
 * A third, `vViewDist`, is recomputed in the fragment as
 * `distance(world, uCameraPos)`, which is the identical quantity the vertex
 * stage was interpolating (the reference writes `distance(P, cameraPos)`), for
 * one slot less.
 */

/**
 * Vertex stage.
 *
 * The mesh carries no geometry: `position` is (column, ring, strand) and every
 * vertex is placed here from the strand table. Eight strands share one static
 * buffer and one draw.
 *
 * Normals are DIFFERENCED out of `waterPoint` rather than derived analytically.
 * The surface is a sweep with a per-sample radius, a transported frame, a
 * vertical squash and two octaves of relief on top; the analytic normal for all
 * of that is long and easy to get subtly wrong, and three extra evaluations
 * cannot disagree with the geometry because they *are* the geometry.
 *
 * @type {string}
 */
export const vertex = /* glsl */`
#include "lib/water"

in vec3 position;                  // (column, ring, strand)

uniform sampler2D waterTex;
uniform float waterCols;           // LATTICE_COLS, 176
uniform float waterRings;          // RING, 24
uniform float waterTime;
/// Per strand: (profile, milkiness, alpha, column count).
uniform vec4 strandParams[8];

out vec4 vWorldRad;
out vec4 vNormalFoam;
out vec2 vMilkAlpha;

void main() {
    int strand = int(position.z);
    vec4 sp = strandParams[strand];
    float count = max(sp.w, 2.0);
    int base = strand * 3;

    float u = position.x / max(waterCols - 1.0, 1.0);    // 0..1 along the spine
    float q = position.y / max(waterRings - 1.0, 1.0);   // 0..1 around/up the section
    float tm = waterTime;

    // A dead strand does none of the work below.
    //
    // Every vertex of the lattice runs this shader whether or not its strand is
    // in use, and the eight strands together are 33,792 vertices each evaluating
    // a swept surface four times. Leaving the dead ones to fall out of the maths
    // — radius zero collapses them anyway — measured 1.4 ms a frame in the
    // reference for spline fetches that produce nothing. The branch is perfectly
    // wavefront-coherent, since a strand is thousands of contiguous vertices, and
    // the common case is one strand live out of eight.
    //
    // It also guards the spline indexing: with count 0 the (n-1) arithmetic goes
    // negative, and texelFetch with a negative coordinate is UNDEFINED in GLSL ES
    // 3.00 where it was a clamp in WGSL. Both guards are kept.
    bool alive = sp.z > 0.001 && sp.w >= 2.0;

    vec3 P = vec3(0.0);
    vec3 N = vec3(0.0, 1.0, 0.0);
    float radius = 0.0;
    float foam = 0.0;

    if (alive) {
        P = waterPoint(waterTex, base, count, sp.x, u, q, tm);

        // Central-ish differences, with the offset FLIPPED near either edge of
        // the patch so the pair never straddles a clamp — which would silently
        // return a zero-length tangent and a NaN normal on the boundary column.
        float du = 0.65 / max(waterCols - 1.0, 1.0);
        float dq = 0.65 / max(waterRings - 1.0, 1.0);
        float su = (u > 0.5) ? -1.0 : 1.0;
        float sq = (q > 0.5) ? -1.0 : 1.0;

        vec3 Pu = (waterPoint(waterTex, base, count, sp.x, u + du * su, q, tm) - P) * su;
        vec3 Pq = (waterPoint(waterTex, base, count, sp.x, u, q + dq * sq, tm) - P) * sq;

        vec3 Nn = cross(Pq, Pu);
        float nl = length(Nn);
        Nn = (nl > 1e-7) ? (Nn / max(nl, 1e-8)) : vec3(0.0, 1.0, 0.0);

        // Orient outward. The tube is a closed surface and the sign of a
        // differenced cross product on it depends on which way the transported
        // frame happens to wind — so it is resolved against the one thing that
        // cannot be ambiguous: the vector from the spine to the surface. The same
        // test on a sheet is meaningless, and the fragment stage turns that normal
        // toward the eye instead.
        vec3 axis = P - waterSpine(waterTex, base, count, u);
        vec3 outward = (dot(Nn, axis) < 0.0) ? -Nn : Nn;
        N = (sp.x < 0.5) ? outward : Nn;

        radius = waterRow(waterTex, base, count, u).w;
        foam = waterRow(waterTex, base + 2, count, u).z;
    }

    vWorldRad = vec4(P, radius);
    vNormalFoam = vec4(N, foam);
    vMilkAlpha = vec2(sp.y, alive ? sp.z : 0.0);

    gl_Position = uViewProj * vec4(P, 1.0);
}
`;

/**
 * Fragment stage.
 *
 * Four things have to be true at once or it reads as a blue plastic tube, and
 * they pull against each other:
 *
 *   transparent      you see the field through it, *displaced*, and the
 *                    displacement is what says "lens" rather than "coloured
 *                    surface".
 *   coloured by what
 *   it absorbs       not by an albedo. Water's colour is the shortfall of the
 *                    light that made it through — red first, then green — so the
 *                    tint follows the path length.
 *   mirror-bright    at a 13-degree sun a wet surface returns almost all of a
 *                    grazing view; Fresnel does most of the work of making it
 *                    look wet.
 *   scattering
 *   inside           a body of water thrown through the air is full of bubbles
 *                    and entrained snow, and that internal scatter is what keeps
 *                    the shadowed side of an arc alive.
 *
 * REFRACTION WITHOUT A SCENE COPY. The obvious implementation samples the
 * framebuffer behind the surface, which means rendering the opaque pass twice or
 * copying a bound target mid-frame. Neither is necessary, because of what is
 * actually behind the water: sky, or snow, and nothing else. The sky LUT holds
 * both — the Nishita bake writes the iteratively-solved snow bounce into every
 * direction below the horizon — so one lookup along the refracted ray is a
 * physically-derived estimate of what is behind the body in *any* direction, at
 * the cost of one texture fetch. Three fetches at three indices of refraction
 * give the chromatic dispersion.
 *
 * @type {string}
 */
export const fragment = /* glsl */`
#include "lib/noise"
#include "lib/shading"
#include "lib/spellLights"
#include "lib/atmosphere"
// After the includes above and this stage's own uniforms, matching the
// reference's order: the cascade lookup needs nothing from here but is a large
// chunk and reads better last.
#include "lib/shadowLookup"

in vec4 vWorldRad;      // xyz world, w radius m
in vec4 vNormalFoam;    // xyz geometric normal, w foam 0..1
in vec2 vMilkAlpha;     // milkiness, strand alpha

uniform float waterTime;
/// Artistic scale on the absorption coefficients. One slider for "how deep does
/// this water read", which is the single most-tuned number in the material.
uniform float waterDepthTint;

layout(location = 0) out vec4 outColor;

/**
 * Absorption per metre of path, exaggerated well past real water.
 *
 * Clear water absorbs about 0.45/m in red and 0.05/m in blue, which over the ten
 * to forty centimetres a spell body is actually thick produces a tint of a few
 * percent — invisible. These coefficients put the same tint at a tenth of the
 * path length: glacial melt full of entrained snow, not a swimming pool.
 */
const vec3 WATER_ABSORB = vec3(3.40, 0.72, 0.34);

void main() {
    float vAlpha = vMilkAlpha.y;
    float vRadius = vWorldRad.w;
    if (vAlpha <= 0.003 || vRadius <= 0.0005) { discard; }

    vec3 world = vWorldRad.xyz;
    float vFoam = vNormalFoam.w;
    float vMilk = vMilkAlpha.x;

    vec3 V = normalize(uCameraPos - world);
    // uSunDir points TOWARD the sun (lib/common), which is the sense every
    // transmission term below depends on.
    vec3 L = uSunDir;

    // Both faces of the body are visible — it is transparent, and the sheet
    // profile is genuinely open — so winding says nothing. Turn the normal toward
    // the eye, exactly as the wake and the garments do.
    vec3 Ng = normalize(vNormalFoam.xyz);
    vec3 N = (dot(Ng, V) >= 0.0) ? Ng : -Ng;
    vec3 geoN = N;                       // the shadow lookup uses THIS, pre-ripple

    // ---- ripple normals ----------------------------------------------------
    // Sliced along two oblique WORLD directions rather than the XZ plane: the
    // body is as often vertical as horizontal, and a planar lookup bands it into
    // horizontal stripes on the vertical parts — the one pattern that reads as a
    // rendering error.
    //
    // All of the fine surface detail lives here and it has to: the mesh carries a
    // fixed vertex count whatever the strand is doing, so anything finer than
    // that in the geometry is aliasing, not detail. Here the sampling rate is the
    // pixel, so three octaves are affordable and the footprint fade switches each
    // one off before it can shimmer.
    vec3 ddxW = dFdx(world);
    vec3 ddyW = dFdy(world);
    float footprint = max(length(vec2(length(ddxW.xz), length(ddyW.xz))), 1e-4);
    vec2 fp = vec2(
        dot(world, vec3(0.88, 0.31, -0.36)),
        dot(world, vec3(0.24, 0.79, 0.56))
    );

    vec3 upRef = (abs(N.y) > 0.99) ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    // Right-handed (T, B, N), Three's world frame. Only used to perturb a normal
    // by a symmetric noise gradient, so the chirality is not observable.
    vec3 T = normalize(cross(upRef, N));
    vec3 B = cross(N, T);

    float t = waterTime;
    float rippleFade = 1.0 - smoothstep(0.03, 0.22, footprint);
    if (rippleFade > 0.002) {
        vec3 g1 = noised(fp * 8.5 + vec2(t * 0.7, -t * 0.5));
        vec3 g2 = noised(fp * 21.0 + vec2(-t * 1.6, t * 1.1));
        N = normalize(N + (T * (g1.y * 0.085 + g2.y * 0.055)
                         + B * (g1.z * 0.085 + g2.z * 0.055)) * rippleFade);
    }
    float fineFade = 1.0 - smoothstep(0.006, 0.045, footprint);
    if (fineFade > 0.002) {
        vec3 g3 = noised(fp * 62.0 + vec2(t * 3.1, t * 2.2));
        N = normalize(N + (T * g3.y + B * g3.z) * 0.030 * fineFade);
    }

    float NdotV = clamp(dot(N, V), 1e-4, 1.0);
    float NdotL = dot(N, L);
    float viewDist = distance(world, uCameraPos);
    float noiseRot = ign(gl_FragCoord.xy) * TAU;
    float shadow = sunShadow(world, geoN, viewDist, noiseRot);

    vec3 sun = uSunColor;                // linear radiance, premultiplied

    // ---- how far the light travelled through the body ----------------------
    // Grazing views cut a long chord, head-on views a short one. That single
    // relationship is most of what makes a tube of water look like a volume
    // rather than like a shell: the silhouette is always the deepest part of it.
    //
    // The constant term matters as much as the grazing one. Keying the path
    // purely off view angle puts *all* of the colour at the silhouette — which is
    // also exactly where Fresnel is strongest, so the reflection replaces the
    // tint precisely where it exists and the body comes out white. A floor
    // proportional to the radius means a fat body is coloured all the way across.
    float path = clamp(
        vRadius * (1.25 + 1.9 * (1.0 - NdotV)) * waterDepthTint,
        0.01, 3.0
    );
    vec3 transmit = exp(-WATER_ABSORB * path);

    // ---- refraction, with dispersion ---------------------------------------
    // Three indices, one channel taken from each fetch. The spread is small —
    // real dispersion in water is about half a percent across the visible band —
    // but on a surface this curved the ray fans far enough to put a visible
    // fringe on the rim, which is exactly where the eye looks for it.
    vec3 rr = refract(-V, N, 1.0 / 1.3300);
    vec3 rg = refract(-V, N, 1.0 / 1.3330);
    vec3 rb = refract(-V, N, 1.0 / 1.3400);
    // Total internal reflection returns a zero vector in GLSL exactly as in WGSL;
    // fall back to the mirror direction there, which is what actually happens.
    vec3 mirror = reflect(-V, N);
    vec3 dr = (dot(rr, rr) > 0.5) ? rr : mirror;
    vec3 dg = (dot(rg, rg) > 0.5) ? rg : mirror;
    vec3 db = (dot(rb, rb) > 0.5) ? rb : mirror;

    // A mid mip: the body is rippled, so a mirror-sharp background through it
    // would alias, and a little blur is what a centimetre of moving water does to
    // what is behind it anyway.
    vec3 behind = vec3(
        textureLod(uSkyLUT, dirToLatLong(dr), 1.6).r,
        textureLod(uSkyLUT, dirToLatLong(dg), 1.6).g,
        textureLod(uSkyLUT, dirToLatLong(db), 1.6).b
    );
    vec3 color = behind * transmit;

    // ---- internal scatter ---------------------------------------------------
    // Light that entered the body, bounced off entrained air and snow, and came
    // back out toward the eye. Peaks looking into the sun through the thin parts,
    // so the arc lights up from the inside where the sun is behind it. Tinted by
    // what the water did NOT absorb on the way in and out, so the glow is teal at
    // depth and near-white at the edges, for free.
    //
    // The INV_PI is not decoration. A scattering lobe is a distribution, and
    // multiplying radiance by one without the 1/PI in front of it overstates the
    // peak threefold — which on a term already fed by a 17:13:6 sun put the body
    // several times brighter than sunlit snow, clipped to flat white along its
    // whole length, and let no tinting underneath show through.
    float inScatter = backScatter(N, L, V, 0.55, 2.6, 1.0);
    vec3 scatterTint = mix(vec3(0.40, 0.80, 1.0), vec3(0.72, 0.94, 1.0),
                           exp(-path * 1.6));
    color += sun * INV_PI * scatterTint * inScatter
           * (0.55 + 1.3 * vMilk) * sssStrength
           * mix(0.30, 1.0, shadow);

    // Sky filling the body from above. Without this the shadowed side of an arc
    // has nothing in it but the refraction and goes dead.
    //
    // PORT: skyIrradiance() already folds in uAmbientIntensity (lib/atmosphere),
    // so the reference's explicit '* ambientIntensity' is NOT repeated here.
    color += skyIrradiance(N) * INV_PI * scatterTint * (0.35 + 0.5 * vMilk);

    // ---- slush --------------------------------------------------------------
    // 'milkiness' is what a spell dials to move between clear bent water and the
    // snow it tore out of the ground on the way up. It is not a colour: it is an
    // opaque diffuse population *inside* the body, so it fills in behind the
    // transparency rather than tinting it, and the two coexist the way real slush
    // does. Note the 0.85 mix cap: even at milk 1 the refraction survives at 15%.
    if (vMilk > 0.002) {
        vec3 slushAlbedo = vec3(0.86, 0.90, 0.96);
        float d = wrapDiffuse(NdotL, 0.62);
        vec3 slush = slushAlbedo * INV_PI * sun * d * shadow;
        slush += slushAlbedo * INV_PI * skyIrradiance(N);
        slush += snowSubsurface(N, L, V, sun, 0.45, sssStrength * 0.8, 1.2)
               * slushAlbedo * mix(0.35, 1.0, shadow);
        color = mix(color, slush, vMilk * 0.85);
    }

    // ---- foam ---------------------------------------------------------------
    // The leading edge, where the body is tearing itself apart against the air
    // and the snow. Two counter-drifting octaves on the same oblique slice break
    // it into a froth rather than a painted band. 'foam' is modulated in place —
    // the shaded value feeds the Fresnel gate, the GGX roughness and the alpha.
    float foam = vFoam;
    if (foam > 0.002) {
        float fn2 = noise2(fp * 22.0 + vec2(t * 1.7, -t * 1.1)) * 0.5 + 0.5;
        float fn3 = noise2(fp * 61.0 - vec2(t * 3.3, t * 2.1)) * 0.5 + 0.5;
        foam = clamp(foam * (0.35 + 1.5 * fn2 * (0.5 + 0.7 * fn3)), 0.0, 1.0);
        vec3 foamAlbedo = vec3(0.93, 0.955, 0.99);
        vec3 fc = foamAlbedo * INV_PI * sun * wrapDiffuse(NdotL, 0.72) * shadow;
        fc += foamAlbedo * INV_PI * skyIrradiance(N);
        fc += snowSubsurface(N, L, V, sun, 0.25, sssStrength, 1.4)
            * foamAlbedo * mix(0.4, 1.0, shadow);
        color = mix(color, fc, foam);
    }

    // ---- reflection ---------------------------------------------------------
    // Applied AFTER the body terms because it sits *on* the surface: what it
    // returns never went through the water and is therefore never tinted by it.
    //
    // Capped at 0.72 rather than run to the full Schlick 1.0 at grazing. A flat
    // sea does go to a perfect mirror at the horizon, but that limit assumes a
    // surface you cannot see the far side of. This body is a decimetre through
    // and lit from inside, so letting the reflection reach unity deletes the
    // volume exactly at the silhouette — the one place the eye reads the material
    // from.
    //
    // Milkiness has to take the SURFACE out as well as filling the body in. A
    // vortex at 0.88 milk still returning a third of the sky at grazing came out
    // looking like moulded plastic: opaque, which was right, and polished, which
    // was not. A mass of ice crystals in air has no specular surface at all.
    vec3 F = min(fresnelSchlick(NdotV, vec3(0.02)), vec3(0.72));
    vec3 skyRefl = textureLod(uSkyLUT, dirToLatLong(mirror), 0.7).rgb;
    color = mix(color, skyRefl, F * (1.0 - foam * 0.7) * (1.0 - vMilk * 0.88));

    // Sun glint. A tight lobe, because water is smooth: this is the highlight
    // that runs along the top of an arc and sells its curvature. 0.055 for clear
    // water out to 0.68 for foam and slush.
    if (NdotL > 0.0) {
        vec3 H = normalize(V + L);
        float rough = mix(0.055, 0.68, max(foam * 0.55, vMilk));
        float D = distributionGGX(clamp(dot(N, H), 0.0, 1.0), rough);
        float Vis = visSmithGGXCorrelated(NdotV, NdotL, rough);
        vec3 Fs = fresnelSchlick(clamp(dot(V, H), 0.0, 1.0), vec3(0.02));
        color += sun * D * Vis * Fs * NdotL * shadow;
    }

    // Shed droplets on the outer skin catch the sun as points. The snow's own
    // glint field, on the same oblique slice and gated the same way, so the
    // sparkle on the water and the sparkle on the field are one effect.
    if (glintIntensity > 0.001) {
        float g = snowGlints(
            fp, N, V, L, footprint,
            glintIntensity * (0.6 + 0.8 * max(foam, vMilk)),
            glintGrazing
        );
        color += sun * g * shadow * 0.7;
    }

    // ---- spell light --------------------------------------------------------
    // A spell body lit by its own emitter. This is why a Bloom's column glows
    // from inside instead of being a dark shape against a lit crater.
    if (spellLightCount > 0.5) {
        color += spellLightingSurface(
            world, N, V, mix(vec3(0.35, 0.62, 0.78), vec3(0.9), vMilk),
            vec3(0.02), 0.12, 0.55
        );
    }

    // ---- opacity ------------------------------------------------------------
    //
    // Nearly opaque, which is the opposite of the obvious answer and is the
    // single change that made this read as water rather than as frosted glass.
    //
    // Running the alpha off Fresnel — transparent face-on, mirror at grazing,
    // which is what clear water does — comes out pale and washed, because the
    // background is then counted TWICE: once through the refracted sky lookup,
    // which is the physically-placed, dispersed, absorbed version of it, and
    // again through the blend, which is the undistorted version at full
    // brightness. Over a snow field the second one is white and it wins. A high
    // alpha deletes the duplicate and leaves the refraction as the only path the
    // background takes through the body.
    //
    // What is left for the alpha to do is the ends. The radius tapers to nothing
    // there, so keying opacity to the radius closes the tube on a soft point
    // rather than on a ring of visible section. That is also why nothing fades in
    // 'u': u means "along the spine" and cannot tell a ribbon's trailing wisp from
    // the symmetric horn of a crescent wave.
    float taper = clamp(vRadius / 0.055, 0.0, 1.0);
    float clearAlpha = taper * mix(0.74, 0.97, 1.0 - NdotV);
    float alpha = mix(clearAlpha, taper, max(foam, vMilk * 0.9)) * vAlpha;
    if (alpha < 0.004) { discard; }

    // Aerial perspective, last. aerial() is exactly the reference's applyAerial
    // with viewDir = normalize(world - camera) = -V and sunColor = sunRadiance.
    color = aerial(color, world);

    outColor = vec4(color, alpha);
}
`;
