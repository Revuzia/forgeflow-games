/**
 * Weather — the analytic billboard vertex stage and the airborne-medium shading.
 * [WEATHER]
 *
 * ONE pipeline for all three realms: Cold blizzard / snowfall, Sand sandstorm +
 * dust devils, Ash ember-fall + smoke drift. The realm changes ~14 uniforms.
 * Nothing here branches on a realm id except the two places where the BEHAVIOUR
 * genuinely differs (the rising smoke population, and the devils), and both of
 * those are driven by a probability uniform that is zero in the realms that do
 * not want them — so there is no realm enum in this file at all.
 *
 * =============================================================================
 * WHY THERE IS NO CPU SIMULATION.
 *
 * `vfx/particles.js` (the surf-wake SprayField) simulates on the CPU because its
 * grains are *events*: they are born somewhere specific, they fly, they land and
 * they die, and their count swings from 0 to 3500 inside a second. Weather is
 * the opposite: it is STATIONARY IN DISTRIBUTION. A flake never dies, it wraps;
 * every flake shares one velocity; the field looks the same at t and at t+10.
 *
 * A distribution that never changes shape needs no state. So the placement here
 * is analytic — a per-index hash for the base point, plus ONE drift vector the
 * CPU integrates and pre-wraps — and the whole per-frame cost is about a dozen
 * uniform writes and zero bytes of bus traffic, against spray's 5120-iteration
 * loop and its 160 KiB data-texture upload. That is also why weather may not use
 * spray's pool: 3072 more slots would push the plume past CAPACITY = 5120
 * (`particles.js:98`) and, because the plume emits first in the frame
 * (`main.js` wake.update -> spray.update), it is the PLUME that would thin at
 * top speed while the weather stayed fat. Exactly backwards.
 *
 * =============================================================================
 * WHY THE QUADS ARE VELOCITY-STRETCHED.
 *
 * The controller tops out at 19.5 m/s (`surfWake.js:95`). At that speed a
 * flake's motion RELATIVE TO THE EYE is dominated by the camera's own velocity,
 * and a round camera-facing billboard degenerates into a static dot field —
 * the classic "why does the snow not move" failure, where a storm reads as
 * confetti glued to the lens. So the quad is stretched along the screen-space
 * projection of (particleVelocity - cameraVelocity), by
 *
 *     k = clamp(1 + STRETCH_BASE * vInPlane / STRETCH_VREF, 1, uWxShape.x)
 *
 * At a standstill k = 1 and a Cold flake is a 12 mm disc. At 19.5 m/s the
 * in-plane relative speed is ~20 m/s, k = 1 + 0.9*20/8 = 3.25, and the same
 * flake draws as a 12 x 39 mm streak leaning into the direction of travel.
 * The stretch uses the IN-PLANE component, not the full 3-D speed: a flake
 * coming straight down the view axis has no apparent motion and must not
 * streak, or the centre of the screen fills with radial spikes.
 *
 * =============================================================================
 * VARYING BUDGET (ARCHITECTURE.md §4.1): three slots, same as spray.
 *     vWorld   (world.xyz, distance to the camera)
 *     vCorner  the UNROTATED billboard corner — the disc test, the edge falloff
 *              and the spherical normal are all built in this frame, so the
 *              shading stays axis-consistent while the geometry is stretched
 *     vState   (kind 0|1|2, seed, alpha, unused)
 *
 * HANDEDNESS (ARCHITECTURE.md §6): nothing here consumes a world basis it did
 * not receive. `camRight` / `camUp` are lifted off the camera's `matrixWorld`
 * columns on the CPU, exactly as `particles.js:335-336` does, and the stretch
 * direction is computed by projecting into that same basis — no cross product
 * and no second matrix anywhere in this file. The wind bearing is converted by
 * `core/bearing.js` on the CPU, the same call the spray, the cirrus, the
 * sastrugi and the deformation sim all make.
 *
 * NOTE FOR EDITORS: this whole file is a JS template literal. A backtick
 * anywhere below — including inside a GLSL comment — terminates it mid-shader.
 * There are none, and there must stay none.
 */

// ---------------------------------------------------------------------- vertex

/**
 * Placement + billboard expansion. The mesh carries no geometry at all:
 * `position` is (particleIndex, cornerX, cornerY) and every corner is placed
 * here from a hash of the index. Nothing is fetched from a texture and nothing
 * is uploaded.
 * @type {string}
 */
export const WEATHER_VERTEX = /* glsl */ `
#include "lib/common"

in vec3 position;   // (particle index, cornerX, cornerY) — NOT a position

// ------------------------------------------------------------ the field itself
/// Spawn box half-extents are uWxBox * 0.5; the field is toroidal inside it.
uniform vec3  uWxBox;
/// Offset of the box centre from the camera. Y is positive: the camera sits low
/// in the column, so an origin-centred box would put ~40% of the field under the
/// ground where the depth test throws it away for nothing.
uniform vec3  uWxBoxOff;
/// The two drift vectors, integrated and PRE-WRAPPED on the CPU (see the note in
/// weather.js update()). A is the falling population, B the rising one — Ash
/// smoke. In Cold and Sand uWxRise.x is 0 and B is never selected.
uniform vec3  uWxDriftA;
uniform vec3  uWxDriftB;
/// The two populations' world velocities, m/s. Only used for the stretch.
uniform vec3  uWxVelA;
uniform vec3  uWxVelB;
/// Camera velocity, m/s, differenced from camera.position on the CPU.
uniform vec3  uWxCamVel;
/// x = P(rising population). 0 in Cold and Sand.
uniform vec2  uWxRise;
/// TWO NESTED SHELLS, one draw. x = the fraction of the index range folded into
/// the INNER box, y = that box's extents as a fraction of uWxBox.
///
/// Why: a single 140 x 46 x 140 m box holding 3072 particles is one particle per
/// 285 cubic metres, which is a light flurry, and most of them land far enough
/// away to be sub-pixel — a 12 mm flake at 84 m projects to a tenth of a pixel.
/// All the cost, none of the read. Splitting the same 3072 indices into a dense
/// inner box (0.42x extents, so 1/13th the volume) and a sparse outer one puts
/// half the particles inside 29 m at ~13x the density, where they are two or
/// three pixels across and actually legible as falling snow, while the outer
/// half still fills the middle distance. Both shells are independently uniform
/// and share one drift vector, so both stay stationary in distribution — which
/// is the property the whole no-simulation design rests on. The inner shell's
/// alpha is faded toward its own faces so the density step is not a visible box
/// edge hanging in the air.
uniform vec2  uWxInner;

// ------------------------------------------------------------------------ kinds
/// Radius in metres of (fine, coarse, glow).
uniform vec3  uWxRadii;
/// Opacity scale of (fine, coarse, glow).
uniform vec3  uWxAlpha;
/// x = P(coarse), y = P(glow). The remainder is fine. Glow is 0 outside Ash and
/// 0 on the performance preset, where the ember layer is dropped entirely.
uniform vec2  uWxKindSplit;

// ----------------------------------------------------------------- projection
/// x stretch clamp, y max projected half-height as a fraction of the viewport,
/// z stretch gain, w reference speed (m/s) for the gain.
uniform vec4  uWxShape;
/// x nearFadeLo, y nearFadeHi, z farFadeLo, w farFadeHi — all metres.
uniform vec4  uWxFade;
/// The projection matrix's [1][1] term, for the screen-height clamp. Written
/// from camera.projectionMatrix.elements[5], so it tracks the FOV and the TAA
/// jitter without this file knowing what either is.
uniform float uWxProjY;

// --------------------------------------------------------------- dust devils
/// Live particle count. The LAST uWxDevilCount * uWxDevilIdx indices are lifted
/// out of the sheet and wrapped helically around a devil instead — which is how
/// three columns of spinning dust cost zero extra draw calls and zero extra
/// triangles.
uniform float uWxCount;
uniform vec4  uWxDevilA[3];   // (centreX, centreZ, radius m, height m)
uniform vec4  uWxDevilB[3];   // (spin rev/s, strength 0..1, baseY m, phase)
uniform float uWxDevilCount;  // 0 in Cold and Ash, and on the performance preset
uniform float uWxDevilIdx;    // indices reserved per devil

uniform vec3  camRight;
uniform vec3  camUp;

out vec4 vWorld;    // xyz world position, w distance to the camera
out vec2 vCorner;   // the UNROTATED corner
out vec4 vState;    // (kind, seed, alpha, unused)

/// Dave Hoskins' hash — no trig, no texture, uncorrelated across the three
/// channels. Written locally rather than pulled from lib/noise so the weather
/// VERTEX stage compiles without the noise chunk at all: the only other thing it
/// would want from there is noise2, which is a fragment concern.
vec3 wxHash31(float p) {
    vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xxy + p3.yzz) * p3.zyx);
}

float wxHash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

void main() {
    float fi = position.x;
    vec2 corner = position.yz;

    // ---- deterministic identity ------------------------------------------
    // NEVER Math.random (ARCHITECTURE.md §6) — the same rule particles.js:304
    // and surfWake.js:130 follow. A hash of the index means the field is
    // identical on every machine and across a reload, which is what makes the
    // shot battery reproducible with weather running.
    vec3  h    = wxHash31(fi + 0.5);
    float hk   = wxHash11(fi * 1.7 + 11.3);   // kind roll
    float hr   = wxHash11(fi * 2.3 + 47.1);   // falling / rising roll
    float seed = wxHash11(fi * 0.61803 + 3.7);

    // ---- kind: 0 fine, 1 coarse, 2 glow -----------------------------------
    // Glow owns [0, split.y), coarse owns [split.y, split.y + split.x), fine the
    // rest. Two step() selects rather than a dynamic vector index: ANGLE's D3D11
    // backend is happiest with the arithmetic form, and it is branch-free. The
    // 1e-5 bias is what makes a probability of exactly ZERO mean zero — without
    // it, step(0.0, 0.0) is 1 and the one particle whose hash lands on 0 renders
    // as an ember in a realm that has none.
    float isGlow   = step(hk + 1e-5, uWxKindSplit.y);
    float isCoarse = (1.0 - isGlow)
                   * step(hk + 1e-5, uWxKindSplit.y + uWxKindSplit.x);
    float kind     = isCoarse + isGlow * 2.0;
    float radius   = mix(mix(uWxRadii.x, uWxRadii.y, isCoarse), uWxRadii.z, isGlow);
    float aScale   = mix(mix(uWxAlpha.x, uWxAlpha.y, isCoarse), uWxAlpha.z, isGlow);

    // ---- population: falling or rising ------------------------------------
    // Ash splits 60/40 falling/rising off one hash bit, so a single draw carries
    // two opposite behaviours: embers settling through a column of smoke that is
    // going the other way. uWxRise.x = 0 collapses this to the falling branch.
    float rising = step(hr, uWxRise.x);
    vec3  drift  = mix(uWxDriftA, uWxDriftB, rising);
    vec3  pvel   = mix(uWxVelA,  uWxVelB,  rising);

    // ---- placement: a torus of particles that follows the camera ----------
    // The base point is fixed in the box for the life of the program; the drift
    // moves the whole lattice and the mod() folds it back. Because the fold is
    // around the CAMERA, the field is always full in every direction the player
    // can look, and no particle is ever "off screen and coming" — there is no
    // spawn ring to catch out of the corner of an eye.
    float inner  = step(fi + 0.5, uWxCount * uWxInner.x);
    float bScale = mix(1.0, uWxInner.y, inner);
    vec3  box    = uWxBox * bScale;
    vec3  centre = uCameraPos + uWxBoxOff * bScale;
    vec3  base   = (h - 0.5) * box;
    vec3  rel    = base + drift;
    rel = mod(rel - centre + box * 0.5, box) - box * 0.5;
    vec3 p = centre + rel;

    // Soften the inner shell against its own faces. Without this the density
    // step where the dense box ends is a rectangle you can see, and it follows
    // the camera, which is worse than the thing it was meant to fix.
    vec3  q3 = abs(rel) / (box * 0.5);
    float q  = max(max(q3.x, q3.y), q3.z);
    float shellFade = mix(1.0, 1.0 - smoothstep(0.70, 1.0, q), inner);

    // ---- dust devils ------------------------------------------------------
    // The tail of the index range is lifted out of the sheet. A devil is a cone
    // wider at the top, wrapped helically, spinning on its own clock.
    float tail = uWxCount - uWxDevilCount * uWxDevilIdx;
    if (uWxDevilCount > 0.5 && fi >= tail) {
        int   dk = int(clamp(floor((fi - tail) / uWxDevilIdx), 0.0, 2.0));
        vec4  dA = uWxDevilA[dk];
        vec4  dB = uWxDevilB[dk];
        float u  = fract(seed + uTime * dB.x + dB.w);
        float y  = h.y * dA.w;
        // Cone: 35% of the radius at the foot, full radius at the cap. A
        // straight cylinder reads as a fence post; the flare is the vortex.
        float r  = dA.z * (0.35 + 0.65 * y / max(dA.w, 0.001)) * (0.75 + 0.5 * h.z);
        p = vec3(dA.x + cos(u * TAU) * r, dB.z + y, dA.y + sin(u * TAU) * r);
        // A devil grain is denser and larger than the sheet it came from.
        radius *= 1.0 + 1.6 * dB.y;
        aScale *= 1.0 + 1.1 * dB.y;
        pvel = vec3(-sin(u * TAU), 0.35, cos(u * TAU)) * (6.0 * dB.y) + pvel;
    }

    // ---- distance fades ---------------------------------------------------
    float dist = distance(p, uCameraPos);
    // Near: a flake one metre from the lens is a full-screen blur and reads as a
    // smear on the glass, not as weather. Far: the sheet has to dissolve into
    // the fog rather than end at a hard shell, or the toroid's face is visible
    // as a wall of particles whenever the fog is thin.
    float fade = smoothstep(uWxFade.x, uWxFade.y, dist)
               * (1.0 - smoothstep(uWxFade.z, uWxFade.w, dist));
    float alpha = aScale * fade * shellFade;

    // ---- velocity stretch --------------------------------------------------
    vec3 vRel = pvel - uWxCamVel;
    // Project into the billboard basis. This IS the screen-space direction for
    // anything not at the extreme edge of the frame, it costs two dots instead
    // of a matrix multiply, and it cannot disagree with the basis the corners
    // are expanded in because it is the same basis.
    vec2  sd = vec2(dot(vRel, camRight), dot(vRel, camUp));
    float sl = length(sd);
    vec2  dir = sl > 1e-4 ? sd / sl : vec2(0.0, 1.0);
    float k = clamp(1.0 + uWxShape.z * sl / uWxShape.w, 1.0, uWxShape.x);
    vec2  rc = vec2(-dir.y, dir.x) * corner.x + dir * (corner.y * k);

    // ---- the fill safety valve --------------------------------------------
    // Without this, one particle that wraps in a metre from the near plane
    // rasterises the whole screen and the frame falls off a cliff. The near fade
    // above already makes that unreachable at the shipped radii; this is what
    // stops a hand-set radius from doing it anyway. Half-height in NDC is
    // radius * P[1][1] / viewDist, and NDC spans 2 viewport heights.
    float halfH = radius * k * uWxProjY * 0.5 / max(dist, 0.05);
    radius *= min(1.0, uWxShape.y / max(halfH, 1e-5));

    vec3 world = p + (camRight * rc.x + camUp * rc.y) * radius;

    vWorld  = vec4(world, distance(world, uCameraPos));
    vCorner = corner;
    vState  = vec4(kind, seed, alpha, 0.0);
    gl_Position = uViewProj * vec4(world, 1.0);
}
`;

// -------------------------------------------------------------------- fragment

/**
 * The airborne-medium fragment stage.
 *
 * Three appearances out of one program, selected by `vState.x`:
 *
 *   fine    a soft gaussian disc. Snow crystal / dust grain / ash fleck. Almost
 *           transparent on its own — density comes from overlap, exactly as it
 *           does for the plume (`spray.glsl.js:169-172`).
 *   coarse  a harder rim. The clumps and clods a real storm carries.
 *   glow    Ash only. A tight emissive core with no sun term and no shadow term
 *           at all: an ember in shade still glows, and that is the whole trick
 *           that stops it reading as glitter on black sand. Same argument
 *           REALM_CONTRACT §1b makes for the ground-level ember specks.
 *
 * PREMULTIPLIED OUTPUT, and this is load-bearing. The blend is (ONE,
 * ONE_MINUS_SRC_ALPHA). A translucent flake emits rgb*a with a real a and
 * composites normally; an ember emits a bright rgb with a ~ 0.1 and therefore
 * behaves ADDITIVELY through the same blend, with the same state, in the same
 * draw. A design that needed a second additive pass would breach the +1 draw
 * call cap in REALM_CONTRACT §4.2 — this is how it is avoided.
 *
 * @param {{shadow?: boolean}} [opts] compile the cascade lookup in at all. Off
 *   drops `lib/shadowLookup` from the program entirely rather than multiplying
 *   by a uniform 1.0, which is the difference between a dead uniform and a dead
 *   texture fetch per fragment.
 * @returns {string}
 */
export function weatherFragment(opts) {
    const shadow = !!(opts && opts.shadow);

    return /* glsl */ `
#include "lib/atmosphere"
${shadow
        ? '#include "lib/shadowLookup"'
        : "// cascades not compiled in — see WeatherField's shadow note"}

in vec4 vWorld;
in vec2 vCorner;
in vec4 vState;

uniform vec3  camRight;
uniform vec3  camUp;

/// Albedo of the fine and coarse kinds.
uniform vec3  uWxTint;
/// Emissive colour of the glow kind. Ash only.
uniform vec3  uWxGlowTint;
/// x wrap amount, y Mie asymmetry g, z forward-lobe gain, w glow emissive scale.
uniform vec4  uWxLight;
/// 0..1. Multiplies the cascade lookup so the same program can be handed a
/// realm that wants no shadowing without a recompile.
uniform float uWxShadowAmt;

layout(location = 0) out vec4 outColor;

/// Wrapped diffuse, transcribed from lib/shading:173-176 rather than included:
/// pulling lib/shading would drag lib/noise into this program for one four-line
/// function, and the weather fragment is the most fill-bound thing in the frame.
/// The (1+w)^2 denominator is normalisation — a wrap redistributes light, it
/// does not brighten the medium.
float wxWrap(float NdotL, float w) {
    float denom = (1.0 + w) * (1.0 + w);
    return max(0.0, (NdotL + w) / denom);
}

void main() {
    float r2 = dot(vCorner, vCorner);
    if (r2 > 1.0) { discard; }

    float kind  = vState.x;
    float seed  = vState.y;
    float isGlow   = step(1.5, kind);
    float isCoarse = step(0.5, kind) * (1.0 - isGlow);

    // Break the rim. A perfectly circular billboard is the tell that gives the
    // technique away. An analytic three-lobe wobble and not a noise2 fetch:
    // 3072 stretched quads at ~108 fragments each is 331k fragments a frame, and
    // a gradient-noise lookup per fragment there costs more than every other
    // term in this shader put together. At a 12 mm flake the two are
    // indistinguishable.
    float ang = atan(vCorner.y, vCorner.x);
    float wob = 1.0 + 0.22 * sin(ang * 3.0 + seed * 41.0)
                    + 0.10 * sin(ang * 7.0 - seed * 17.0);
    float r = sqrt(r2) / wob;
    if (r > 1.0) { discard; }

    // Soft for fine, hard-rimmed for coarse, tight core for an ember.
    float soft  = pow(clamp(1.0 - r * r, 0.0, 1.0), 1.7);
    float hard  = smoothstep(1.0, 0.62, r);
    float core  = pow(clamp(1.0 - r * r, 0.0, 1.0), 3.2);
    float edge  = mix(mix(soft, hard, isCoarse), core, isGlow);

    float alpha = vState.z * edge;
    if (alpha < 0.004) { discard; }

    vec3 world = vWorld.xyz;
    vec3 V = normalize(uCameraPos - world);
    vec3 L = uSunDir;   // toward the sun, world space, right-handed Y-up

    // Spherical normal in the billboard's own frame: nz = sqrt(1 - r^2)
    // reconstructs a hemisphere normal, so a grain has a lit side and a dark
    // side instead of being a flat chip. Built from the UNROTATED corner, which
    // is why the stretch does not shear the lighting.
    float nz = sqrt(max(0.0, 1.0 - r2));
    vec3 N = normalize(camRight * vCorner.x + camUp * vCorner.y + V * nz);

    ${shadow ? /* glsl */ `
    // The cascades. Gated by a uniform as well as by the compile flag so a realm
    // can turn it off without a program rebuild.
    float shadow = 1.0;
    if (uWxShadowAmt > 0.002) {
        float noiseRot = shadowIGN(gl_FragCoord.xy) * TAU;
        shadow = mix(1.0, sunShadow(world, N, vWorld.w, noiseRot), uWxShadowAmt);
    }
    ` : /* glsl */ `
    // No cascade lookup in this build. See the shadow note in WeatherField: a
    // 12 mm flake cannot resolve a shadow the player can identify, and a PCSS
    // fetch across half a screen of overdraw is the single largest cost weather
    // could add to the frame.
    float shadow = 1.0;
    `}

    vec3 sun = uSunColor;
    vec3 albedo = uWxTint;

    // Surface scatter. The medium is nearly isotropic at the grain surface...
    vec3 color = albedo * INV_PI * sun * wxWrap(dot(N, L), uWxLight.x) * shadow;

    // ...and strongly forward through the volume, which is the term that makes a
    // sunlit squall brighter than the ground behind it and a down-sun one a dim
    // grey. The coefficient is small on purpose: a phase function is normalised
    // over the sphere, so using it as a bare multiplier on radiance overstates
    // the peak by an order of magnitude. Same argument, same shape, as
    // spray.glsl.js:196-206.
    float mu = dot(-V, L);
    color += sun * albedo * phaseMie(mu, uWxLight.y) * uWxLight.z
           * mix(0.25, 1.0, shadow) * (1.0 - isCoarse * 0.5);

    // Sky, which is what fills the unlit side. skyIrradiance() folds
    // uAmbientIntensity in already.
    color += albedo * INV_PI * skyIrradiance(N);

    // The ember. No sun, no shadow, no sky — it is its own light source, and
    // the tight core plus a low alpha is what lets one blend mode carry both an
    // absorbing flake and an emitting cinder.
    color = mix(color, uWxGlowTint * uWxLight.w, isGlow);

    // Aerial perspective LAST, exactly as every other hazed surface applies it,
    // so a flake sixty metres out sits in the same haze as the ground under it.
    color = aerial(color, world);

    // Premultiplied: see the block comment above.
    outColor = vec4(color * alpha, alpha);
}
`;
}
