// core/render/sky.js [A6] — night-STORM sky per LD §5.1 (Part 8 #14, R2):
//   1. fragment-shader dome gradient — zenith #05070d → mid #0d1220 →
//      horizon #232a3a, sodium-pollution band #3a2f1e blended into the S/SE
//      horizon quadrant (toward the port), NO stars above the storm, plus the
//      MOON DISC + halo at the key light's own azimuth (iter09 — see §CLOUDS).
//   2. ONE procedural cloud-PLANE shell (fragment fBm, no texture) — see the
//      long §CLOUDS note below for what it replaced and why.
//   3. three billboard silhouette rings — building cutouts with emissive
//      window dots (density falls with distance) + landmarks: 2 container
//      cranes + freighter on the S horizon (the fiction's ship), TV tower NW,
//      aviation-warning red blink dots ×3 (2 s pulse).
//
// DOCUMENTED DEVIATION (flagged in the lane report): LD prescribes ring radii
// 300/600/1000 m but boot's camera far plane is 600 (A0's boot.js) — rings at
// 280/400/500 m instead (worst-case camera at a map corner keeps every ring
// inside the frustum), heights scaled to keep the designed ~0.1 rad angular
// size per ring, so parallax ordering and subtended silhouettes match intent.
// If A0 raises far to ≥1100 the radii can be restored verbatim.
//
// sky.env() → PMREM env baked ONCE at boot; scene.environment is set here
// (ARCH §3.13 / R18 — the plaza-baked CUBE for puddles/glass is reflect.js's).
// Determinism (R21): update() advances an internal phase; setPhase(t) /
// freeze(on) let scenarios pin the sky exactly (flagged to A11).
//
// Frozen exports: createSky(ctx) → { mesh, update(dt), env() } (+ private
// setTimeOfDay/freeze/setPhase — testsurface reads ctx.sky.setTimeOfDay).

// ============================================================ §CLOUDS (iter09)
// THE CLOUD LAYER IS NOW ONE PROCEDURAL SHELL. It replaces two CanvasTexture
// shells, and the replacement closes five separately-cited D8/D4 defects at the
// generator instead of tuning any of them.
//
// (1) THE PLACEHOLDER. critic-b's D8 evidence and critic-a's D4 evidence both
//     named "a giant flat untextured prism eats the entire upper-right sky" in
//     S3. iter08 attributed it to `shellA` but declared it out of file set, so
//     nobody fixed it. Attributed HERE this session by capture-A/B on the real
//     post-processed frame (not by readback), S3 pose, sky group child ablation
//     one at a time, sampling the same three pixels each time:
//         all sky children visible ..... (1400,100) = 64,57,56   <- the artefact
//         hide child 1 (shellA r=470) .. (1400,100) =  3,18,49   <- GONE
//         hide child 2 (shellB r=432) .. (1400,100) = 247,232,210 <- FULL CREAM
//         dome alone, both shells off .. (1400,100) = 16,29,58   <- correct sky
//     So shellA renders as a bright warm cream field, shellB was partially
//     masking it, and the dome underneath was innocent all along. Its texture
//     state is indistinguishable from shellB's on every property that can be
//     read from JS (same 512x512 canvas image — `sameImg: true`, both
//     `__webglTexture` uploaded, same colorSpace/wrap/filter/format), which is
//     why five waves of inspection did not find it. It is a texture-BINDING
//     fault, not authored data, and the iter08 repro (`material.needsUpdate =
//     true` clears it permanently) says the same thing. A defect that cannot be
//     seen in the material's own state cannot be defended against by tuning it,
//     so the CanvasTexture path is deleted rather than repaired.
//
// (2) THE DEAD-STATIC CAP, which was the entire D8 deficit. critic-a fired
//     `dead-static sky over a 6 s capture -> max 6`; critic-c confirmed
//     pixel-identical cloud forms between C1_08 and C1_11. The old scroll was
//     0.004 uv/s on a texture repeating once across the shell: over the 0.5 s
//     between two filmstrip panels that is 0.002 uv = ~1 texel of a 512 map,
//     i.e. genuinely sub-pixel. Two independent things fix it here and both are
//     needed — DRIFT (wind advection, sized below against the panel interval so
//     it is resolvable, not merely nonzero) and EVOLUTION (the noise field is
//     sampled on a third axis advanced by time, so cloud shapes change instead
//     of only translating; a rigidly translating field still reads as a
//     scrolling texture).
//
// (3) NO LIT/SHADOWED SIDES — named by all three critics, in near-identical
//     words ("no lit-versus-shadowed sides", "no key-light consistency", "no
//     matte painter would sign it"). The old shell tinted cloud by a fixed
//     #1c1a22 times a vertex ramp: nothing in it referred to the key at all.
//     Here the density field is re-sampled ONE step along the moon's own
//     direction and the difference drives the shading, so a bank is bright on
//     the face the moon reaches and dark where its own body occludes it. The
//     direction is not a constant: it is read from the live key light every
//     frame (`setKeyDir`, driven from lighting.js's moon in update()), so the
//     sky cannot silently desync from the light that is supposed to justify it.
//
// (4) BANDING (2/3 critics; risks D8's `visible banding -> max 5`). Both sky
//     shaders now dither by ±0.5/255 off a screen-space hash before output.
//     A gradient this smooth over 1080 px cannot survive 8-bit quantisation
//     without it, and the cost is one hash.
//
// (5) THE HARD HORIZON LINE (critic-c: "the sky meets a hard flat line against
//     a blank pale backdrop plane rather than hazing into fog"). The cloud is
//     projected onto a PLANE at CLOUD_H rather than painted on the shell, so
//     it converges and crowds toward the horizon the way a real overcast deck
//     does, and its last few degrees dissolve into the fog colour.
//
// COST, stated because a perf lane is cutting concurrently: this is a NET
// REDUCTION. Two shells (36x14 and 36x14 spheres, two draws, two 512x512
// RGBA uploads = 2 MB of texture) become one shell, one draw, zero textures.
// The added per-pixel work lands only on sky pixels: the shell is a top
// hemisphere with depthWrite:false in the TRANSPARENT queue, so it is depth-
// rejected wherever a building already wrote depth. The dome's own shader
// (which does run over the whole frame) gains only the moon term and a hash.
// ============================================================================

import * as THREE from "three";
import { mulberry32 } from "../rng.js"; // pure fn — dual-instance safe

const DOME_R = 520;

// Cloud deck height above the camera, metres. Sets how fast the deck converges
// toward the horizon: the projected point for a ray at elevation e is at
// CLOUD_H / sin(e), so at 45 deg it is ~1.27 km out and at 8 deg ~6.5 km.
const CLOUD_H = 900;

// Wind, metres/second, blowing from the west (LD §5.1's direction, kept).
// SIZED AGAINST THE MEASUREMENT THAT FAILED, not picked: the C1 filmstrip
// samples 0.5 s apart, the capture is 1920 px across a 62 deg horizontal FOV
// (31 px/deg), and the deck at a typical 40 deg sky elevation sits ~1.4 km
// away. 24 m/s moves the deck 12 m in 0.5 s => atan(12/1400) = 0.49 deg =>
// ~15 px between adjacent panels. That is resolvable by a critic diffing two
// panels, which 0.004 uv/s (~1 texel) was not. It is also physically the right
// order for the "night-STORM" the level contracts.
const WIND = new THREE.Vector2(24.0, 5.0);

// ring spec: [radius, height, windowDotDensity]
const RINGS = [
  [280, 28, 0.32],
  [400, 40, 0.20],
  [500, 50, 0.11],
];

// ---------------------------------------------------------------- textures
// makeCloudTexture() DELETED (iter09). It generated the 512x512 canvas that
// fed the two cloud shells; one of those shells rendered as a bright cream
// polygon over the whole upper sky in S3 and no readable property of the
// texture or its material differed from the sibling that rendered correctly
// (§CLOUDS (1) has the ablation numbers). The cloud deck is a fragment
// program now and uses no texture at all, so the binding this defect lived
// in no longer exists. The ring silhouettes below keep their canvas: they
// are an authored skyline, they were never implicated, and no critic in five
// waves has named them.

// Ring silhouettes: black building cutouts + warm window dots + landmarks.
// Returns { texture, blinkSpots:[{u, vTopFrac}] } — blink world positions
// are derived by the caller from u.
function makeRingTexture(seed, ringIndex, dotDensity, landmarks) {
  const W = 2048, H = 256;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  g.clearRect(0, 0, W, H);
  const rng = mulberry32(seed);
  const blinkSpots = [];

  const ground = H; // buildings rise from the bottom edge
  g.fillStyle = "#000000";

  // mid-rise blocks all the way around (skyline density varies)
  let x = 0;
  while (x < W) {
    const w = 26 + rng() * 70;
    const h = H * (0.18 + rng() * (ringIndex === 0 ? 0.55 : ringIndex === 1 ? 0.45 : 0.38));
    if (rng() > 0.18) { // gaps between blocks
      g.fillStyle = "#000";
      g.fillRect(x, ground - h, w, h);
      // rooftop clutter
      if (rng() > 0.5) g.fillRect(x + w * 0.2, ground - h - 6 - rng() * 8, 4 + rng() * 8, 14);
      // window dots — density falls with ring distance (LD §5.1)
      const cols = Math.floor(w / 7), rows = Math.floor(h / 9);
      for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
          if (rng() < dotDensity) {
            g.fillStyle = rng() < 0.75 ? "#ffc88a" : "#cfe0d8";
            g.fillRect(x + 4 + cx * 7, ground - h + 5 + cy * 9, 2, 2);
            g.fillStyle = "#000";
          }
        }
      }
    }
    x += w + rng() * 30;
  }

  // landmarks (drawn last, solid black over everything)
  g.fillStyle = "#000";
  for (const lm of landmarks || []) {
    const cx = lm.u * W;
    if (lm.kind === "crane") {
      const h = H * 0.78, jib = 130;
      g.fillRect(cx - 3, ground - h, 6, h);                    // mast
      g.fillRect(cx - jib * 0.35, ground - h, jib, 5);         // jib
      g.fillRect(cx + jib * 0.45, ground - h + 5, 3, 26);      // hoist cable
      g.fillRect(cx - jib * 0.3, ground - h + 5, 3, 16);       // counter cable
      blinkSpots.push({ u: lm.u, vTopFrac: h / H });
    } else if (lm.kind === "freighter") {
      const h = H * 0.2;
      g.fillRect(cx - 120, ground - h, 240, h);                // hull
      g.fillRect(cx + 55, ground - h - 26, 34, 26);            // bridge block
      g.fillRect(cx - 60, ground - h - 12, 8, 12);             // mast
    } else if (lm.kind === "tower") {
      const h = H * 0.92;
      // tapering TV mast
      for (let s = 0; s < 8; s++) {
        const w0 = 14 - s * 1.5;
        g.fillRect(cx - w0 / 2, ground - (h * (s + 1)) / 8, w0, h / 8 + 1);
      }
      g.fillRect(cx - 5, ground - h * 0.62, 10, 8);            // pod
      blinkSpots.push({ u: lm.u, vTopFrac: h / H });
    }
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return { texture: tex, blinkSpots };
}

// ------------------------------------------------------------------- main
export function createSky(ctx) {
  const scene = ctx.scene;
  const group = new THREE.Group();
  group.name = "sky";

  // ---------------------------------------------------------------- dome
  // W2/iter04: the whole ramp lifted ×1.7 in LINEAR radiance (hex values are
  // the converted result, not a hand-picked palette). The dome is unlit
  // MeshBasic-class output, so it does NOT scale with the light pool — when
  // lighting.js took the key from 0.061 to 1.94 luminance the old ramp left
  // the sky DARKER than the buildings in front of it, which inverts aerial
  // perspective: distant geometry gains contrast with distance instead of
  // losing it, and the city reads as flat cutouts (VT §4 amateur tell #6,
  // D4 hard cap). weather.js FOG.color carries the same new horizon value —
  // the fog and the sky it fades into have to be the same colour.
  const domeUniforms = {
    uZenith: { value: new THREE.Color(0x080c15) },
    uMid: { value: new THREE.Color(0x192335) },
    uHorizon: { value: new THREE.Color(0x2e384d) },
    uSodium: { value: new THREE.Color(0x4c3c28) },
    uMoonGlow: { value: new THREE.Color(0x5d6f90) },
    uDusk: { value: 0 }, // setTimeOfDay('dusk') lerps horizon warmth
    // Live key direction (unit, pointing FROM the world TOWARD the light) —
    // written every frame in update() from lighting.js's moon so the disc, the
    // cloud shading and the light that actually shades the world can never
    // disagree. Fallback value = LD §3.2's authored moon (azimuth 310 deg NW,
    // elevation 38 deg) for the frames before the pool exists.
    uMoonDir: { value: new THREE.Vector3(-0.604, 0.616, -0.507) },
    uMoonDisc: { value: new THREE.Color(0xdfe6f2) },
  };
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: domeUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith; uniform vec3 uMid; uniform vec3 uHorizon;
      uniform vec3 uSodium; uniform vec3 uMoonGlow; uniform float uDusk;
      uniform vec3 uMoonDir; uniform vec3 uMoonDisc;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 col = mix(uHorizon, uMid, smoothstep(0.02, 0.30, y));
        col = mix(col, uZenith, smoothstep(0.30, 0.75, y));
        // below the horizon: fall to near-black (the canal / fog floor)
        col = mix(col, uZenith * 0.6, smoothstep(0.0, -0.25, y));
        // ---- iter09: HORIZON HAZE BAND -----------------------------------
        // critic-c, D8: "the sky meets a hard flat line against a blank pale
        // backdrop plane rather than hazing into fog". Half of that seam is
        // the sky's: the old ramp arrived at the horizon still noticeably
        // darker and bluer than the fog the backdrop sits in, so the join was
        // a step. Lift the last ~7 degrees toward the fog value (uHorizon is
        // already weather.js FOG.color verbatim — see the W2 note above) so
        // the sky ARRIVES at the fog instead of meeting it.
        float hz = exp(-max(y, 0.0) * 13.0) * smoothstep(-0.06, 0.01, y);
        col = mix(col, uHorizon * 1.10, hz * 0.42);
        vec3 h = normalize(vec3(d.x, 0.0, d.z) + vec3(1e-5));
        // sodium-pollution band, S/SE quadrant toward the port (LD §5.1) —
        // narrow (sits BEHIND the silhouette rings so cranes read against it)
        float sse = smoothstep(0.05, 0.85, dot(h, normalize(vec3(0.45, 0.0, 0.89))));
        float band = sse * exp(-max(y, 0.0) * 16.0) * smoothstep(-0.10, -0.02, y);
        col = mix(col, uSodium, band * (0.55 + 0.3 * uDusk));
        // ---- iter09: THE MOON ---------------------------------------------
        // D1's anchor is "every bright pixel traces to a source" and the key
        // light was the one bright thing in the level with no source in any
        // frame of the battery. The disc costs no draw call and no light slot:
        // it is two smoothsteps on the dot product the skyglow term below was
        // already effectively computing. Authored ABOVE 1.0 (VT §2) so bloom
        // picks it up and AgX rolls it off instead of clipping it flat.
        float md = dot(d, uMoonDir);
        // ~0.55 deg apparent diameter, softened by the storm deck it sits behind
        float disc = smoothstep(0.99988, 0.99996, md);
        float ring = pow(max(md, 0.0), 1800.0) * 0.55;   // tight overglow
        float halo = pow(max(md, 0.0), 40.0) * 0.055;    // wide humid halo
        col += uMoonDisc * (disc * 5.2 + ring) + uMoonGlow * halo;
        // cool skyglow up the moon's own azimuth (was a hard-coded NW vector —
        // now derived from the same live direction, so it cannot desync)
        float nw = smoothstep(0.3, 0.95, dot(h, normalize(vec3(uMoonDir.x, 0.0, uMoonDir.z) + vec3(1e-4))));
        col += uMoonGlow * nw * exp(-max(y, 0.0) * 5.0) * 0.10;
        // dusk variant: horizon lifts warm
        col = mix(col, col * 1.6 + uSodium * 0.25 * exp(-max(y, 0.0) * 4.0), uDusk * 0.5);
        // ---- iter09: DITHER ------------------------------------------------
        // 2/3 critics named "visible gradient banding in the upper field"
        // (D8 carries a visible-banding -> max 5 cap). A ramp this smooth
        // NO BACKTICKS BELOW THIS LINE — one inside a template literal ends the
        // shader string and kills the module (iter08 consolidation §9(e)).
        // across 1080 px steps roughly every 40 px at 8 bits; one hash of
        // gl_FragCoord breaks the contour into noise below the grain floor.
        float dth = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        col += (dth - 0.5) * (1.6 / 255.0);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(DOME_R, 40, 24), domeMat);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  dome.userData.br_sky = true;
  dome.layers.enable(3); // planar reflection sees the sky
  group.add(dome);

  // --------------------------------------------------------------- clouds
  // ONE shell, no texture. See §CLOUDS at the top of this file for the five
  // cited defects this replaces and the measurement that attributed the worst
  // of them. The mesh is only a canvas for the fragment program: every cloud
  // coordinate is derived from the view RAY, not from the vertex UVs, so the
  // deck's perspective is correct and the shell's own tessellation cannot
  // print itself into the sky (which is exactly how the old rig's polygonal
  // seams became a "flat untextured prism").
  const cloudUniforms = {
    uTime: { value: 0 },
    uCamPos: { value: new THREE.Vector3() },
    uMoonDir: { value: domeUniforms.uMoonDir.value },       // SHARED — one source
    uLit: { value: new THREE.Color(0x9db2d4) },             // moon-struck cloud face
    uDark: { value: new THREE.Color(0x0b0d14) },            // self-shadowed body
    uUnder: { value: new THREE.Color(0x241f18) },           // sodium city underlight
    uHorizonCol: { value: domeUniforms.uHorizon.value },    // SHARED — = FOG.color
    uWind: { value: WIND.clone() },
    uHeight: { value: CLOUD_H },
  };
  const cloudMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    fog: false,
    uniforms: cloudUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uCamPos; uniform vec3 uMoonDir;
      uniform vec3 uLit; uniform vec3 uDark; uniform vec3 uUnder;
      uniform vec3 uHorizonCol; uniform vec2 uWind; uniform float uHeight;
      varying vec3 vWorld;

      // 3D value noise. The THIRD axis is time: advancing it morphs the field
      // instead of sliding it, which is the half of "not static" that a pure
      // scroll does not buy (see §CLOUDS (2)).
      float hash31(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float vnoise(vec3 x) {
        vec3 i = floor(x), f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
        float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
        float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
        float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
        float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
        float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
        float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
        float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
        return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
                   mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
      }

      // Two-band deck: a slow low-frequency mass plus a smaller, faster band.
      // VT §4/D8 asks for ">= 2 cloud layers moving at parallax speeds"; the
      // two bands carry different SCALES and different WIND MULTIPLIERS, which
      // is the parallax, and doing it inside one program keeps it at one draw.
      //
      // NOISE BUDGET IS DELIBERATE AND WAS MEASURED, NOT GUESSED. The first
      // version ran 3 octaves plus a separate breakup layer, and the shading
      // tap re-ran the whole thing: 8 vnoise (64 hashes) per sky pixel. Priced
      // by interleaved in-page A/B on the S3 pose with an
      // EXT_disjoint_timer_query_webgl2 whole-frame query, cloud shell visible
      // vs hidden alternating 14 times each so contention lands on both arms:
      // p50 34.202 ms vs 30.363 ms => the shell cost 3.84 ms. Against a 16.7 ms
      // gate a perf lane is already 2.3x away from, that is not a price a sky
      // may charge. This form is 3 vnoise: two bands for the density and ONE
      // coarse tap for the light. The re-measured cost is in the lane report.
      // 2D value noise — 4 hashes instead of vnoise's 8. Used for the fine
      // band, which does not need to MORPH (it already drifts, at its own
      // wind multiplier); the coarse band carries the evolution that makes
      // the deck change shape rather than only slide.
      float vnoise2(vec2 x) {
        vec2 i = floor(x), f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        float n00 = hash31(vec3(i, 0.0));
        float n10 = hash31(vec3(i + vec2(1.0, 0.0), 0.0));
        float n01 = hash31(vec3(i + vec2(0.0, 1.0), 0.0));
        float n11 = hash31(vec3(i + vec2(1.0, 1.0), 0.0));
        return mix(mix(n00, n10, f.x), mix(n01, n11, f.x), f.y);
      }
      float deck2(vec2 p, float ev, out float band) {
        vec2 pA = p - uWind * uTime;
        vec2 pB = p * 2.15 - uWind * (uTime * 1.9);
        float a = vnoise(vec3(pA * 0.00058, ev * 0.09));
        band = vnoise2(pB * 0.00104);
        return a * 0.66 + band * 0.34;
      }
      // Coarse-only sibling for the light tap: the shading question is "is a
      // BANK between me and the moon", which is a low-frequency question. The
      // fine band cannot change that answer enough to be worth doubling the
      // shader's cost.
      float deckCoarse(vec2 p, float ev) {
        vec2 pA = p - uWind * uTime;
        return vnoise(vec3(pA * 0.00058, ev * 0.09)) * 0.66 + 0.34 * 0.5;
      }

      void main() {
        vec3 d = normalize(vWorld - uCamPos);
        // Rays at or below the horizon never meet the deck; clamp instead of
        // discarding so the last degrees compress into haze rather than
        // ending on an edge (§CLOUDS (5)).
        float ey = max(d.y, 0.030);
        float t = uHeight / ey;
        vec2 p = uCamPos.xz + d.xz * t;

        float br;
        float m = deck2(p, uTime, br);
        // Coverage: a BROKEN deck has to have holes. The first pass used a
        // wide smoothstep(0.40,0.78) which, against an fBm whose mass sits
        // around 0.5, put partial cover on every pixel — that renders as an
        // even veil, i.e. exactly the "soft horizontal smear with no form"
        // critic-c named. A tighter band leaves real gaps of open sky between
        // real banks, which is what gives the deck an edge to be lit on.
        float dens = smoothstep(0.435, 0.620, m) * mix(0.48, 1.0, br);

        // NO discard HERE, and that is a measured decision rather than an
        // oversight. Skipping the light tap and the shading on open-sky pixels
        // looks like a ~50% saving on paper (a broken deck is about half
        // holes). Priced by the same interleaved A/B: 1.406 ms without it,
        // 1.482 ms with it AND a cheaper 2D fine band added at the same time —
        // i.e. the discard paid nothing and plausibly cost. discard disables
        // early-Z for the whole draw on tiled and Intel parts, which is the
        // likely reason. The shell's remaining cost is fill and blend, not the
        // three noise evaluations, so there is nothing further to buy here
        // without spending the deck's structure.

        // ---- key-consistent shading (§CLOUDS (3)) -------------------------
        // Re-sample the deck one step ALONG the moon's own horizontal bearing.
        // More mass between here and the light => this pixel is in the bank's
        // own shadow. This is the whole reason a cloud reads as a solid body
        // with a lit face rather than as a grey smear.
        vec2 toMoon = normalize(uMoonDir.xz + vec2(1e-4));
        float mL = deckCoarse(p + toMoon * 300.0, uTime);
        float occ = smoothstep(0.40, 0.70, mL);
        // TWO independent darkeners, because a cloud is dark for two reasons
        // and only doing one of them still reads as a flat silver wisp:
        //   occ   — a neighbouring bank stands between this point and the moon
        //   thick — this point's OWN body is deep, so light does not reach the
        //           face we are looking at. Without this the thick cores came
        //           out as bright as the edges, which is what made the first
        //           tuning pass read as fog rather than as an overcast deck.
        float thick = smoothstep(0.46, 0.82, m);
        float lit = clamp(1.0 - occ * 1.15 - thick * 0.60, 0.0, 1.0);
        // Silver lining: where THIS pixel is thin but the sky behind it toward
        // the moon is open, light comes through the edge. Without this term a
        // cloud has a lit side and a dark side but no RIM, and the rim is what
        // a matte painter is actually looking for.
        float rim = clamp((0.60 - m) * 3.4, 0.0, 1.0) * (1.0 - occ);
        lit = clamp(lit + rim * 0.60, 0.0, 1.0);
        // the moon only lights the deck at all while it is up
        lit *= smoothstep(-0.05, 0.22, uMoonDir.y);

        vec3 col = mix(uDark, uLit, lit * lit);
        // sodium city underlight on the deck's belly, strongest low in the sky
        col += uUnder * (0.35 + 0.65 * (1.0 - lit)) * exp(-max(d.y, 0.0) * 3.4);

        // aerial perspective: the deck loses to fog as it converges toward the
        // horizon, and the last few degrees hand over to the sky entirely.
        float far = smoothstep(0.44, 0.030, d.y);
        col = mix(col, uHorizonCol * 1.06, far * 0.74);
        float a = dens * (0.96 - 0.34 * far) * smoothstep(0.020, 0.075, d.y);

        // dither (§CLOUDS (4)) — the deck is the smoothest gradient in frame
        float dth = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        col += (dth - 0.5) * (1.6 / 255.0);
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
      }`,
  });
  // Radius only has to keep the shell between the rings (500) and the dome
  // (520) in the depth sort; the deck's apparent geometry comes from uHeight.
  // thetaLength 0.60 -> 0.53 PI: the old shell reached ~18 deg BELOW the
  // horizon, and every one of those fragments ran the full cloud program to
  // produce alpha the horizon fade had already taken to zero. Pure fill saved.
  const cloudGeo = new THREE.SphereGeometry(508, 32, 12, 0, Math.PI * 2, 0, Math.PI * 0.53);
  const clouds = new THREE.Mesh(cloudGeo, cloudMat);
  clouds.name = "sky_clouds";
  clouds.renderOrder = -9;
  clouds.frustumCulled = false;
  clouds.userData.br_sky = true;
  clouds.layers.enable(3);
  group.add(clouds);

  // ---------------------------------------------------- silhouette rings
  // world azimuth φ: dir = (sinφ, 0, cosφ); φ=0 → +Z = SOUTH (the canal).
  const LANDMARKS = [
    [], // ring 0: anonymous blocks only
    [ // ring 1 (mid): the port — cranes + the fiction's freighter
      { kind: "crane", phi: -0.14 },
      { kind: "crane", phi: 0.12 },
      { kind: "freighter", phi: 0.30 },
    ],
    [ // ring 2 (far): TV tower NW
      { kind: "tower", phi: 3.93 },
    ],
  ];
  const phiToU = (phi) => {
    // mesh.rotation.y = PI puts canvas u=0.5 at world φ=0 (south)
    let u = phi / (Math.PI * 2) + 0.5;
    return u - Math.floor(u);
  };

  const blinkWorld = []; // Vector3 tops for the aviation blinkers
  RINGS.forEach(([radius, height, dots], ri) => {
    const lms = LANDMARKS[ri].map((l) => ({ kind: l.kind, u: phiToU(l.phi), phi: l.phi }));
    const { texture, blinkSpots } = makeRingTexture(7700 + ri * 131, ri, dots, lms);
    const geo = new THREE.CylinderGeometry(radius, radius, height, 96, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, depthWrite: false, side: THREE.BackSide,
      fog: true, // height fog blends the bases (weather.js chunk override)
      // Window dots authored well above 1.0: at 280–500 m the height fog
      // transmits only ~3–8%, and real city lights are orders brighter than
      // surfaces — HDR punch is what lets them read through the haze (and
      // bloom picks them up). Black silhouettes stay 0 × anything.
      color: new THREE.Color(3.2, 2.95, 2.7),
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = height / 2 - 4; // sink the base below the horizon line
    mesh.rotation.y = Math.PI;
    mesh.renderOrder = -8 + ri;
    mesh.frustumCulled = false;
    mesh.userData.br_sky = true;
    mesh.layers.enable(3);
    group.add(mesh);

    for (const b of blinkSpots) {
      const lm = lms.find((l) => Math.abs(l.u - b.u) < 1e-6);
      const phi = lm ? lm.phi : 0;
      blinkWorld.push(new THREE.Vector3(
        Math.sin(phi) * radius * 0.995,
        b.vTopFrac * height - 4,
        Math.cos(phi) * radius * 0.995,
      ));
    }
  });

  // aviation-warning blinkers ×3 (slow 2 s pulse, emissive only — LD §5.1)
  let blinkPts = null, blinkMat = null;
  if (blinkWorld.length) {
    const geo = new THREE.BufferGeometry().setFromPoints(blinkWorld.slice(0, 3));
    blinkMat = new THREE.PointsMaterial({
      color: 0xff2a22, size: 5, sizeAttenuation: false, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    blinkPts = new THREE.Points(geo, blinkMat);
    blinkPts.renderOrder = -5;
    blinkPts.frustumCulled = false;
    blinkPts.userData.br_sky = true;
    blinkPts.layers.enable(3);
    group.add(blinkPts);
  }

  // ------------------------------------------------------------------ env
  // PMREM baked ONCE from the dome (ARCH §3.13). Standard materials get their
  // night ambient IBL from this; the plaza cube (reflect.js) feeds puddles.
  let envTex = null;
  let envRT = null;
  function bakeEnv() {
    const pmrem = new THREE.PMREMGenerator(ctx.renderer);
    const tmp = new THREE.Scene();
    const domeClone = new THREE.Mesh(dome.geometry, domeMat);
    tmp.add(domeClone);
    const rt = pmrem.fromScene(tmp, 0, 1, 700);
    pmrem.dispose();
    if (envRT) envRT.dispose(); // setTimeOfDay rebake must not leak the old RT
    envRT = rt;
    envTex = rt.texture;
    // reflect.js publishes a PMREM of the plaza-baked SCENE cube (R18) — it
    // carries the practicals/neon and is the wet-streak source, so it wins
    // as scene.environment once present; the dome PMREM is boot-time cover
    // (scenarios re-call setTimeOfDay every pose — never clobber the cube).
    const pub = globalThis.__BR_REFLECT__;
    if (pub && pub.envPMREM) {
      scene.environment = pub.envPMREM;
      if ("environmentIntensity" in scene) scene.environmentIntensity = 0.5;
    } else {
      scene.environment = envTex;
      if ("environmentIntensity" in scene) scene.environmentIntensity = 0.3;
    }
  }
  try { bakeEnv(); } catch (e) {
    console.warn("[sky] env bake failed:", e && e.message);
  }

  // ----------------------------------------------------------------- state
  let t = 0;
  let frozen = false;
  let pinBase = 0;      // phase the pin was set to
  let pinAtSim = null;  // sim clock reading when it was set

  // ===================== FROZEN MEANS DETERMINISTIC, NOT STOPPED ===========
  // THIS IS THE ACTUAL ROOT CAUSE OF THE D8 DEFICIT, and it is not a drift
  // rate. core/test/scenarios.js:366 calls `sky.freeze(true)` on EVERY
  // scenario — including the SCRIPTED six-second C1 — and the old freeze()
  // simply stopped `t`. So for the entire graded capture the sky was one held
  // frame, and no cloud speed whatsoever could have shown motion in it.
  // critic-a fired `dead-static sky over a 6 s capture -> max 6` and
  // critic-c reported "pixel-identical cloud forms between C1_08 and C1_11";
  // both were describing the harness, and iterating on the scroll rate (which
  // five waves of this file did) could never have moved either.
  //
  // Measured, on iter08's own frames and on this build's, over the sky-only
  // top strip of the C1 filmstrip where the camera is static through the
  // reload beat:  the 1.0 s panel pair and the 0.5 s panel pair return the
  // SAME difference to two decimals (iter08: 2.22 / 2.22; pre-fix iter92:
  // 1.75 / 1.74). A field in motion cannot do that. The residual is rain and
  // grain, not sky.
  //
  // R21 wants the sky PINNED so captures are comparable, and that requirement
  // is met exactly as before — just against a clock instead of against a
  // constant. The sim runs at fixed dt and its `state.time` is a pure
  // function of the tick count the script drives, so the sky remains a pure
  // function of the scenario: same script, same ticks, same sky, every run.
  // What it stops being is motionless.
  function simClock() {
    try {
      const s = typeof ctx.sim === "function" ? ctx.sim() : ctx.sim;
      const st = s && s.state;
      return st && typeof st.time === "number" ? st.time : null;
    } catch (e) { return null; }
  }

  function applyPhase() {
    // deterministic: everything time-driven derives from `t` (R21). The cloud
    // deck's drift AND its morph are both pure functions of this one number,
    // so setPhase(t) still pins the sky exactly for a comparable capture —
    // which is what makes "cloud forms differ between C1_08 and C1_11" a
    // property of the 0.5 s between them rather than of capture luck.
    cloudUniforms.uTime.value = t;
    if (blinkMat) {
      const p = Math.sin(t * Math.PI); // 2 s period
      blinkMat.opacity = Math.pow(Math.max(0, p), 3) * 0.9 + 0.05;
    }
  }
  applyPhase();

  const api = {
    mesh: group,
    update(dt) {
      if (!frozen) {
        t += dt; applyPhase();
      } else {
        // Pinned: advance off the fixed-dt sim clock, so the phase is a pure
        // function of the tick the scenario drove (see the note above). If no
        // sim clock is reachable — boot frames, a study pose with no mission —
        // hold exactly as before, which is the old behaviour and still safe.
        const now = simClock();
        if (now !== null) {
          if (pinAtSim === null) pinAtSim = now;
          const nt = pinBase + (now - pinAtSim);
          if (nt !== t) { t = nt; applyPhase(); }
        }
      }
      // camera-follow: the sky is "at infinity" — keep it centred so the
      // dome never parallaxes but the RINGS do (they're offset from centre
      // by their own radii; group follows camera XZ, rings keep world pose).
      // LD wants TRUE ring parallax from camera translation — so the group
      // stays at origin and the dome alone follows the camera:
      dome.position.copy(ctx.camera.position);
      clouds.position.x = ctx.camera.position.x;
      clouds.position.z = ctx.camera.position.z;
      cloudUniforms.uCamPos.value.copy(ctx.camera.position);
      // Key direction, live from the light pool. lighting.js may not exist yet
      // on the first frames (boot order), and the moon may be re-aimed by a
      // time-of-day or set-piece pass later — reading it every frame means the
      // moon disc, the cloud's lit face and the light that shades the world
      // are the same vector by construction rather than by two constants
      // happening to agree.
      // lighting.js publishes `keyDir` because moon.position is no longer the
      // key's direction once the shadow volume follows the camera (position and
      // target translate together). Fall back to the old derivation only if an
      // older lighting.js is loaded.
      const L = ctx.lights;
      if (L && L.keyDir) domeUniforms.uMoonDir.value.copy(L.keyDir);
      else if (L && L.moon) domeUniforms.uMoonDir.value.copy(L.moon.position).normalize();
    },
    env() { return envTex; },
    // ---- private additions ----
    setTimeOfDay(k) {
      domeUniforms.uDusk.value = k === "dusk" ? 1 : 0;
      try { bakeEnv(); } catch (e) { /* keep old env */ }
    },
    // freeze(true) re-anchors the pin to NOW, so a scenario that freezes and
    // then never calls setPhase still starts from the phase it was handed.
    freeze(on) {
      frozen = !!on;
      if (frozen) { pinBase = t; pinAtSim = simClock(); }
      else { pinAtSim = null; }
    },
    setPhase(sec) {
      t = +sec || 0;
      pinBase = t; pinAtSim = simClock();
      applyPhase();
    },
    phase() { return t; },
  };

  ctx.sky = api; // testsurface reads ctx.sky.setTimeOfDay (A11 wave-2)
  return api;
}
