/**
 * royale/storm.js — the shrinking storm. Math lives in sim (SIM.Storm,
 * deterministic from seed); this renders the wall, applies damage ticks,
 * drives warnings, grades the world while the player is inside the storm, and
 * exposes state for HUD/minimap/bots/loot.
 *
 * WALL (plan P1.2, Wave 4). One open cylinder, ONE draw, 192 triangles, scaled to
 * the live radius, with a ShaderMaterial in place of the old additive MeshBasicMaterial:
 *   - PREMULTIPLIED NORMAL blending. The additive wall could only ever ADD light, so it
 *     could not dim or desaturate what stood behind it: measured as a faint magenta cast
 *     (+9 / 255 per channel at 30 m, green actually dropped 6.8 / 255). Normal blending
 *     pulls the scene toward a lilac curtain, which is the look of the reference frames.
 *   - a GROUND REFERENCE: a 360-sample 1D half-float texture of
 *     max(map.heightAt(x, z), waterY) around the live circle, refreshed when the circle
 *     moves. Curtain alpha, the 0-3 m bright band and the streak fade are all measured
 *     from it (height above the ground), never from waterY, so the band hugs hills.
 *   - STREAKS spaced in WORLD metres along the circumference and anti-aliased with
 *     fwidth(), so they stay about 1.7 px wide at any distance and any viewing angle
 *     instead of becoming 15-25 px bands at 30 m; dense far lines dissolve instead of
 *     shimmering. Two layers (2.7 m / 6.4 m) so something is still readable side-on.
 *     A streak is a line where the haze is THINNER (alpha x uStreakAlpha) and that glows
 *     uStreakGain x the curtain's own luminance at that pixel, so the glare bar (<= 2x)
 *     holds by construction (light merely ADDED over the bright sky was squashed by the
 *     tone mapper's highlight compression and could not be seen).
 *   - a dense violet BASE (alpha at the cap up to ~8 m, blending into the lighter curtain
 *     by ~18 m) and a vivid violet BAND in the first 3 m. A pale lilac could not be seen
 *     over this game's bright sky and sand at an alpha the cap allows (attempt 1: +7..10/255).
 *   - an ALPHA CAP (0.40) so a silhouette 20 m behind the wall keeps >= 60 % contrast.
 *   - looking from OUTSIDE the circle the ray crosses the wall twice; the far surface is
 *     drawn at 0.45 strength so two layers still stay near the cap.
 *   - DISTANCE FADE (parity P1-E, LC-72). In circle 1 the wall stands 400-800 m from where
 *     players are, and a 300 m curtain of streaks covered the whole sky (live: streaks over
 *     every sky pixel at t=48 with r=784). Measured from the camera's horizontal distance to
 *     each fragment, the curtain keeps its full 300 m within PAL.farD0 (170 m: every
 *     stormfx_storm view is unchanged) and beyond PAL.farD1 (300 m) its top is capped at
 *     ~3.7 deg of elevation (d x farK, never under farMin = 18 m: 19.5 m at 300 m, 52 m
 *     at 800 m); the streaks follow the top and fade out between streakD0 and streakD1
 *     (200-380 m), the way the fogged terrain behind it sinks into the haze. The dense base
 *     and the ground band (0-18 m) are untouched, so the storm still reads as a violet line
 *     on the horizon.
 *
 * INSIDE THE STORM (playerStormState). scene.fog colour + density, scene.background and the
 * sky dome's top/bot uniforms (the dome is fog:false, so the fog alone never tinted it)
 * ease toward lavender over 0.5 s, and a desaturation + lavender grade is applied in the
 * kernel's output pass (lc_output_pass.js, kernel.setGrade). The base values are captured
 * when the tint starts and written back EXACTLY when it ends. Another module (the underwater
 * fx in player.js) also writes fog/background; a write by anyone else is detected by
 * comparing against the last value THIS module wrote and is adopted as the new base, so the
 * two never fight and the tint never "restores" a stale colour over a newer one.
 *
 * LIGHTNING (reference ref_t22): 6 pooled camera-facing bolt quads in ONE instanced draw,
 * flashing in the storm-side sky (outside the circle, in the camera's half of the sky).
 *
 * CONTRACTS. W.stormU = { cx, cz, r } (C-LOOT-RENDER): one object whose identity never
 * changes, mutated whenever the circle changes; r is 1e9 when there is no storm (practice).
 * W.skyUniforms = { top, bot } (C-SKY) is read feature-detected, with the dome mesh named
 * "sky" as the fallback. warmObjects(W) / disposeMatch(W) (C-WARM) are exported.
 * The wall keeps renderOrder 5 (loot beams/rings/glow draw at >= 6, fx quads at >= 7).
 */
import * as THREE from "three";

let K = null;

// ── tuning (every glare number is the START-LOW first pass; see the gate's probe) ──
const WALL_H = 320, WALL_Y = 120;           // unit cylinder: y from -40 to 280
const LUT_N = 360;                          // ground-reference samples around the circle
const LUT_MOVE_M = 2.0;                     // refresh when centre or radius moved this far...
const LUT_MIN_DT = 0.25;                    // ...but never more often than this (sim seconds)
const TINT_RAMP_S = 0.5;                    // inside-the-storm fade in / out
const TINT_FOG = 0x8a74b8;                  // plan: ~#8a74b8
const TINT_SKY_BOT = 0x8a74b8;
const TINT_SKY_TOP = 0x7662a6;              // a touch deeper overhead, the same family
const TINT_FOG_DENS_K = 1.5, TINT_FOG_DENS_ADD = 0.0006;   // FogExp2 density: base * k + add at full tint
const N_BOLTS = 6;
const ALPHA_CAP = 0.40;                     // a silhouette 20 m behind the wall keeps >= 60 % of its contrast
// Wall palette. base = the dense violet layer hugging the ground (alpha at the cap up to baseH0 m, blending
// into the curtain by baseH1 m); band = the 0-bandH m line where the wall meets the ground; streak = the hue
// of the falling streaks, whose BRIGHTNESS is streakGain x the curtain luminance under them (glare bar <= 2x).
const PAL = {
  base: 0x5e4a9e, curtain: 0xbe96e6, band: 0xc878fa, streak: 0xe8e0ff,
  baseA: 0.40, curtainA: 0.36, bandA: 0.40, streakGain: 1.8, streakAlpha: 0.45,
  baseH0: 8, baseH1: 18, bodyMin: 0.6, bodyH: 160, bandH: 3.0,
  // P1-E (LC-72) distance fade: within farD0 m of the camera the wall is exactly as before (every stormfx_storm view); beyond
  // farD1 m its top is capped by ELEVATION, d x farK (~3.7 deg), never under farMin m; between the two it blends. Streaks follow
  // the top and also fade out between streakD0 and streakD1 m.
  farD0: 170, farD1: 300, farK: 0.065, farMin: 18, streakD0: 200, streakD1: 380,
};

// ── session state (the storm module has one wall at a time) ──────────────────
const T = {
  amt: 0,                                   // 0..1 linear ramp (0.5 s)
  applied: false,                           // true while this module's tint values are in the scene
  base: { fog: new THREE.Color(), bg: new THREE.Color(), top: new THREE.Color(), bot: new THREE.Color(), dens: 0 },
  last: { fog: new THREE.Color(), bg: new THREE.Color(), top: new THREE.Color(), bot: new THREE.Color(), dens: 0 },
  have: { fogc: false, dens: false, bg: false, top: false, bot: false },
  skyRefs: null,                            // { top: Color, bot: Color } resolved lazily per match
  skyTried: false,
  grade: 0,
  foreign: 0,                               // count of foreign writes adopted (read-back)
};
const _tFog = new THREE.Color(TINT_FOG), _tBot = new THREE.Color(TINT_SKY_BOT), _tTop = new THREE.Color(TINT_SKY_TOP);
const _tmp = new THREE.Color();
let _clock = 0;                             // visual seconds (kernel dt accumulated)

// ── shaders ──────────────────────────────────────────────────────────────────
const WALL_VS = /* glsl */`
varying vec2 vUv;
varying vec3 vW;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4( position, 1.0 );
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const WALL_FS = /* glsl */`
uniform sampler2D tGround;
uniform float uTime;
uniform float uCirc;
uniform float uCamInside;
uniform vec3 uBaseCol;      // the dense storm base hugging the ground (deeper violet)
uniform vec3 uCurtainCol;   // the curtain above it (lavender-violet grey)
uniform vec3 uBandCol;      // the band where the wall meets the ground
uniform vec3 uStreakCol;    // hue of the falling streaks (their brightness comes from uStreakGain)
uniform float uBaseA;
uniform float uCurtainA;
uniform float uBandA;
uniform float uStreakGain;  // streak luminance as a multiple of the curtain's own luminance under it (glare bar: <= 2)
uniform float uStreakAlpha; // the haze is this much thinner along a streak (alpha multiplier, < 1)
uniform float uAlphaCap;
uniform float uBaseH0;      // metres: the base holds up to here...
uniform float uBaseH1;      // ...and has become the curtain by here
uniform float uBodyMin;     // curtain strength at height, as a fraction of the ground strength
uniform float uBodyH;       // metres over which it falls
uniform float uBandH;       // metres of the brighter band at the ground
uniform vec4 uFar;          // P1-E distance fade: x, y = camera distance (m) of the near -> far blend; z = far top slope (m per m); w = far top floor (m)
uniform vec2 uStreakFar;    // P1-E: camera distance (m) where the streaks start / finish fading out
varying vec2 vUv;
varying vec3 vW;

float hash11( float p ) { p = fract( p * 0.1031 ); p *= p + 33.33; p *= p + p; return fract( p ); }

// One layer of thin vertical streaks. s = arc length along the wall in METRES, so the
// spacing is a world distance; fwidth( sx ) is the cell-units-per-pixel footprint, which
// keeps the line ~1.7 px wide at every distance and angle (anti-aliased, never a fat band).
float streakLayer( float s, float h, float spacing, float seed, float hS, float hE ) {
  float sx = s / spacing;
  float fw = max( fwidth( sx ), 1e-5 );
  float cell = floor( sx );
  float r  = hash11( cell * 1.7 + seed );
  float r2 = hash11( cell * 3.1 + seed * 2.3 + 11.0 );
  float centre = 0.15 + 0.7 * r;
  float d = abs( fract( sx ) - centre );
  float halfW = max( 0.025 / spacing, 0.85 * fw );
  float cov = clamp( ( halfW - d ) / fw + 0.5, 0.0, 1.0 );
  float present = step( 0.32, r2 );                                   // ~2 in 3 cells carry a streak
  float dense = 1.0 - smoothstep( 0.22, 0.50, fw );                   // sub-3 px spacing dissolves, never shimmers
  float ph = h * 0.025 + uTime * ( 0.45 + 0.5 * r2 ) + r * 9.0;       // brightness runs DOWN the line
  float pat = 0.72 + 0.28 * sin( ph * 6.2831853 );
  float vfade = 1.0 - smoothstep( hS, hE, h );                       // height fade (lower when the wall is far: P1-E)
  return cov * present * dense * pat * vfade * ( 0.75 + 0.25 * r2 );
}

void main() {
  float g = texture2D( tGround, vec2( vUv.x, 0.5 ) ).r;               // ground (or waterline) under this column
  float h = vW.y - g;                                                 // metres above it
  float hA = max( h, 0.0 );
  float above = smoothstep( -1.5, 0.0, h );                           // nothing below the ground / the waterline
  float bodyLo = mix( 1.0, uBodyMin, smoothstep( 0.0, uBodyH, hA ) );   // strength falls with height, streaks follow it
  // P1-E (LC-72): DISTANCE FADE. Up close the curtain stands 300 m tall; far away (circle 1, the wall 400-800 m off) a 300 m
  // curtain covered most of the sky in streaks. Like the terrain behind it, the far wall sinks into the haze: its top comes
  // down to a few degrees above the horizon and its streaks fade out, while the dense base and the ground band (0-18 m) stay,
  // so the storm's position still reads on the horizon. Measured from the camera's horizontal distance to this fragment.
  // Near (within uFar.x) the curtain is the full 300 m wall exactly as before; far (beyond uFar.y) its top is an ELEVATION
  // cap, max( uFar.w, d x uFar.z ) (~3.7 deg: a violet band on the horizon); between the two it blends.
  float dC = length( vW.xz - cameraPosition.xz );
  float far = smoothstep( uFar.x, uFar.y, dC );
  float topE = mix( 300.0, max( uFar.w, dC * uFar.z ), far );
  float body = bodyLo * ( 1.0 - smoothstep( mix( 160.0, topE * 0.45, far ), topE, hA ) );
  float up = smoothstep( uBaseH0, uBaseH1, hA );                       // 0 in the dense base, 1 in the curtain above
  float band = ( 1.0 - smoothstep( 0.0, uBandH, hA ) ) * above;       // the brighter band at the ground

  // From INSIDE the circle the wall you see is its back face; from OUTSIDE it is the front
  // face, and the far side of the cylinder is a SECOND layer on the same ray: weaken it.
  bool nearSurf = ( uCamInside > 0.5 ) ? !gl_FrontFacing : gl_FrontFacing;
  float face = nearSurf ? 1.0 : 0.45;

  vec3 col = mix( uBaseCol, uCurtainCol, up );
  float a = mix( uBaseA, uCurtainA, up ) * body;
  col = mix( col, uBandCol, band );
  a = max( a, uBandA * band );
  a = min( a * above * face, uAlphaCap );                             // contrast cap: a silhouette behind keeps >= 60 %
  vec3 rgb = col * a;                                                 // premultiplied curtain / base / band

  // STREAKS. Light ADDED over this game's bright sky is squashed by the tone mapper's highlight
  // compression (measured: a 2x streak read as +0..1 / 255 over the sky), so a streak is a line where
  // the haze is THINNER (alpha x uStreakAlpha: more of the bright scene shows through, and a silhouette
  // behind keeps even more contrast) and that glows uStreakGain x the curtain's own luminance at that
  // pixel, never more: the glare bar (streaks <= 2x the curtain) holds by construction, on the base,
  // the band and all the way up the wall.
  float s = vUv.x * uCirc;
  float sHs = mix( 120.0, topE * 0.5, far ), sHe = topE;
  float sk = max( streakLayer( s, hA, 2.7, 1.0, sHs, sHe ), streakLayer( s, hA, 6.4, 7.0, sHs, sHe ) );
  sk *= 1.0 - smoothstep( uStreakFar.x, uStreakFar.y, dC );           // and streaks fade out with distance
  const vec3 LUM = vec3( 0.2126, 0.7152, 0.0722 );
  vec3 sRgb = uStreakCol * ( uStreakGain * dot( rgb, LUM ) / max( dot( uStreakCol, LUM ), 1e-4 ) );
  rgb = mix( rgb, sRgb, sk );
  a = mix( a, a * mix( 1.0, uStreakAlpha, up ), sk );                 // the dense base stays dense: streaks there only glow
  gl_FragColor = vec4( rgb, a );                                      // premultiplied
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const BOLT_VS = /* glsl */`
attribute vec4 iB;        // x: variant (0..2), y: intensity (0..1), z: flip (+-1), w: unused
varying vec2 vUv;
varying float vVar;
varying float vInt;
void main() {
  vec3 c = instanceMatrix[3].xyz;
  float wd = length( instanceMatrix[0].xyz );
  float ht = length( instanceMatrix[1].xyz );
  vec3 toCam = cameraPosition - c;
  vec3 fh = vec3( toCam.x, 0.0, toCam.z );
  float fl = length( fh );
  fh = fl > 1e-4 ? fh / fl : vec3( 0.0, 0.0, 1.0 );
  vec3 right = normalize( cross( vec3( 0.0, 1.0, 0.0 ), fh ) );     // cylindrical billboard: stays upright
  vec3 wp = c + right * ( position.x * wd * iB.z ) + vec3( 0.0, 1.0, 0.0 ) * ( ( position.y + 0.5 ) * ht );
  vUv = uv;
  vVar = iB.x;
  vInt = iB.y;
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}`;

const BOLT_FS = /* glsl */`
uniform sampler2D map;
uniform vec3 uCore;
uniform vec3 uHalo;
varying vec2 vUv;
varying float vVar;
varying float vInt;
void main() {
  vec2 uv = vec2( ( vVar + vUv.x ) / 3.0, vUv.y );
  float t = texture2D( map, uv ).a;
  vec3 col = mix( uHalo, uCore, smoothstep( 0.35, 0.95, t ) );
  float a = t * vInt;
  gl_FragColor = vec4( col * a, 0.0 );                                // alpha 0 under premultiplied blending = additive
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ── lightning texture: three jagged bolt variants side by side (procedural) ──
function makeBoltTexture() {
  const VW = 128, VH = 512;
  const cv = document.createElement("canvas");
  cv.width = VW * 3; cv.height = VH;
  const c = cv.getContext("2d");
  // fixed seed: the three shapes are the same on every machine
  let sd = 0x5eed1234;
  const rnd = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
  for (let v = 0; v < 3; v++) {
    const ox = v * VW;
    const pts = [];
    let x = VW * (0.42 + rnd() * 0.16);
    for (let y = 0; y <= VH; y += 16 + rnd() * 18) {
      pts.push([ox + x, VH - y]);   // canvas y runs down, the texture's v runs up: the bolt's top is at v = 1
      x += (rnd() - 0.5) * 34;
      x = Math.max(18, Math.min(VW - 18, x));
    }
    const path = (arr) => { c.beginPath(); c.moveTo(arr[0][0], arr[0][1]); for (let i = 1; i < arr.length; i++) c.lineTo(arr[i][0], arr[i][1]); };
    // branches off the main stroke
    const branches = [];
    for (let k = 0; k < 4; k++) {
      const i0 = 2 + Math.floor(rnd() * (pts.length - 6));
      const b = [pts[i0]];
      let bx = pts[i0][0], by = pts[i0][1];
      const dir = rnd() < 0.5 ? -1 : 1;
      const n = 3 + Math.floor(rnd() * 3);
      for (let j = 0; j < n; j++) { bx += dir * (8 + rnd() * 16); by += 14 + rnd() * 22; b.push([Math.max(ox + 6, Math.min(ox + VW - 6, bx)), Math.min(VH - 2, by)]); }
      branches.push(b);
    }
    c.lineJoin = "round"; c.lineCap = "round";
    for (const [w, a] of [[16, 0.10], [9, 0.20], [4.5, 0.45]]) {      // soft halo passes
      c.strokeStyle = "rgba(255,255,255," + a + ")"; c.lineWidth = w;
      path(pts); c.stroke();
      for (const b of branches) { c.lineWidth = w * 0.55; path(b); c.stroke(); }
    }
    c.strokeStyle = "rgba(255,255,255,1)"; c.lineWidth = 2.2;
    path(pts); c.stroke();
    c.lineWidth = 1.2;
    for (const b of branches) { path(b); c.stroke(); }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

// ── module API ───────────────────────────────────────────────────────────────
export function init(W) {
  K = W.SIM;
  // C-LOOT-RENDER: ONE object, identity stable for the session (loot may cache the reference),
  // mutated in place. r is huge until a storm exists so nothing fades by accident.
  if (!W.stormU) W.stormU = { cx: 0, cz: 0, r: 1e9 };
}

export function createStorm(W) {
  const storm = new K.Storm({ seed: W.seed, mode: W.mode, half: W.map.half });
  const g = W.group("storm");
  g.clear();

  // ground reference: 360 x 1 half-float, filtered + wrapped (u = angle / 2pi, the cylinder's own u)
  const lutData = new Uint16Array(LUT_N);
  const lut = new THREE.DataTexture(lutData, LUT_N, 1, THREE.RedFormat, THREE.HalfFloatType);
  lut.minFilter = THREE.LinearFilter; lut.magFilter = THREE.LinearFilter;
  lut.wrapS = THREE.RepeatWrapping; lut.wrapT = THREE.ClampToEdgeWrapping;
  lut.generateMipmaps = false;
  const h0 = THREE.DataUtils.toHalfFloat(0);
  for (let i = 0; i < LUT_N; i++) lutData[i] = h0;
  lut.needsUpdate = true;

  const wallGeo = new THREE.CylinderGeometry(1, 1, WALL_H, 96, 1, true);
  const wallMat = new THREE.ShaderMaterial({
    uniforms: {
      tGround: { value: lut },
      uTime: { value: 0 },
      uCirc: { value: 2 * Math.PI * 100 },
      uCamInside: { value: 1 },
      // violet palette (sRGB hex -> linear working space by Color). A pale lilac cannot be seen over this
      // game's bright sky and sand at an alpha the contrast cap allows (measured: +7..10 / 255); a DEEPER
      // violet base and a lavender-violet grey curtain move the scene behind toward the reference's
      // purple-grey while the luminance of far scenery stays within 0.85-1.15 (see the gate).
      uBaseCol: { value: new THREE.Color(PAL.base) },
      uCurtainCol: { value: new THREE.Color(PAL.curtain) },
      uBandCol: { value: new THREE.Color(PAL.band) },
      uStreakCol: { value: new THREE.Color(PAL.streak) },
      uBaseA: { value: PAL.baseA },
      uCurtainA: { value: PAL.curtainA },
      uBandA: { value: PAL.bandA },
      uStreakGain: { value: PAL.streakGain },
      uStreakAlpha: { value: PAL.streakAlpha },
      uAlphaCap: { value: ALPHA_CAP },
      uBaseH0: { value: PAL.baseH0 },
      uBaseH1: { value: PAL.baseH1 },
      uBodyMin: { value: PAL.bodyMin },
      uBodyH: { value: PAL.bodyH },
      uBandH: { value: PAL.bandH },
      uFar: { value: new THREE.Vector4(PAL.farD0, PAL.farD1, PAL.farK, PAL.farMin) },
      uStreakFar: { value: new THREE.Vector2(PAL.streakD0, PAL.streakD1) },
    },
    vertexShader: WALL_VS, fragmentShader: WALL_FS,
    transparent: true, premultipliedAlpha: true, blending: THREE.NormalBlending,
    side: THREE.DoubleSide, depthWrite: false, depthTest: true, fog: false,
  });
  wallMat.name = "StormWall";
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.position.y = WALL_Y;
  wall.renderOrder = 5;
  wall.frustumCulled = false;                 // scaled to the live radius; the unit sphere would be wrong
  wall.visible = storm.phases.length > 0;     // practice mode has no storm
  g.add(wall);

  // lightning: one instanced draw of N_BOLTS pooled quads
  const boltGeo = new THREE.PlaneGeometry(1, 1);
  const iB = new THREE.InstancedBufferAttribute(new Float32Array(N_BOLTS * 4), 4);
  iB.setUsage(THREE.DynamicDrawUsage);
  boltGeo.setAttribute("iB", iB);
  const boltTex = makeBoltTexture();
  const boltMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: boltTex }, uCore: { value: new THREE.Color(0xf4ecff) }, uHalo: { value: new THREE.Color(0x9b6bff) } },
    vertexShader: BOLT_VS, fragmentShader: BOLT_FS,
    transparent: true, premultipliedAlpha: true, blending: THREE.NormalBlending,
    depthWrite: false, depthTest: true, side: THREE.DoubleSide, fog: false,
  });
  boltMat.name = "StormBolt";
  const bolts = new THREE.InstancedMesh(boltGeo, boltMat, N_BOLTS);
  bolts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bolts.frustumCulled = false;
  bolts.renderOrder = 4;                      // behind the wall (5): the curtain veils what is beyond it
  bolts.visible = false;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < N_BOLTS; i++) bolts.setMatrixAt(i, zero);
  g.add(bolts);

  const ctl = {
    storm, wall, bolts, tex: lut, lut, lutData, wallMat, boltMat, boltTex, boltGeo, wallGeo,
    lutT: -99, lutCx: 1e9, lutCz: 1e9, lutR: -1, lutRefreshes: 0,
    lastPhase: 0, tickAcc: 0, warned: {},
    bolt: [], boltCount: 0,
    camInside: true,
    _disposed: false,
    state: () => storm.stateAt(W.t),
  };
  for (let i = 0; i < N_BOLTS; i++) ctl.bolt.push({ t0: -99, dur: 0, x: 0, z: 0, y: 0, w: 1, h: 1, v: 0, flip: 1, next: 0.5 + i * 0.9, seq: 0 });
  syncStormU(W, storm.stateAt(W.t), storm.phases.length > 0);
  // The storm's VISUAL layer (tint ramp, wall time, camera-inside flag, lightning) runs on the render
  // dt, once per frame, and is registered HERE, per match, on purpose: kernel updaters run in
  // registration order, and by now the map's own updaters (altitude-scaled fog density, the sky dome
  // follow) and the main loop's player.frame (underwater fog) are already in the list. Running after
  // them means the tint is laid over whatever they wrote this frame, so it is what the renderer
  // sees; an updater registered at boot would be overwritten every frame. disposeMatch removes it.
  ctl._upd = (dt) => viewUpdate(W, dt);
  W.kernel.onUpdate(ctl._upd);
  return ctl;
}

function syncStormU(W, st, active) {
  const u = W.stormU;
  if (!u) return;
  if (!active) { u.cx = 0; u.cz = 0; u.r = 1e9; return; }
  u.cx = st.center.x; u.cz = st.center.z; u.r = st.radius;
}

/** Refill the 360-sample ground reference around (cx, cz, R): max(heightAt, waterY). */
function fillGround(W, ctl, cx, cz, R) {
  const hy = W.map.heightAt, wy = W.map.waterY;
  const d = ctl.lutData;
  for (let i = 0; i < LUT_N; i++) {
    const a = ((i + 0.5) / LUT_N) * Math.PI * 2;
    const x = cx + Math.sin(a) * R, z = cz + Math.cos(a) * R;   // CylinderGeometry: x = sin(theta), z = cos(theta), u = theta / 2pi
    let h = hy(x, z);
    if (!(h > wy)) h = wy;
    if (!(h > -500)) h = 0;                                       // no water + a hole in the height function: flat
    d[i] = THREE.DataUtils.toHalfFloat(h < -60000 ? -60000 : h > 60000 ? 60000 : h);
  }
  ctl.tex.needsUpdate = true;
  ctl.lutT = W.t; ctl.lutCx = cx; ctl.lutCz = cz; ctl.lutR = R;
  ctl.lutRefreshes++;
}

export function update(W, dt) {
  const ctl = W.stormCtl;
  if (!ctl || ctl._disposed) return;
  if (!ctl.storm.phases.length) { ctl.wall.visible = false; syncStormU(W, null, false); return; }
  const st = ctl.storm.stateAt(W.t);
  syncStormU(W, st, true);

  // wall follows the live circle — hidden while the pre-shrink super-circle
  // still surrounds the whole map (a wall past the coastline just reads as
  // white streaks on the horizon everywhere)
  if (st.radius > 0.5 && st.radius < W.map.half * 1.02) {
    ctl.wall.visible = true;
    ctl.wall.position.x = st.center.x;
    ctl.wall.position.z = st.center.z;
    ctl.wall.scale.set(st.radius, 1, st.radius);
    ctl.wallMat.uniforms.uCirc.value = 2 * Math.PI * st.radius;
    // ground reference: refresh when the circle has moved, rate limited
    if (ctl.lutR < 0 || (W.t - ctl.lutT >= LUT_MIN_DT &&
        (Math.abs(st.radius - ctl.lutR) > LUT_MOVE_M || Math.hypot(st.center.x - ctl.lutCx, st.center.z - ctl.lutCz) > LUT_MOVE_M))) {
      fillGround(W, ctl, st.center.x, st.center.z, st.radius);
    }
  } else {
    ctl.wall.visible = false;
  }

  // phase transitions → warnings
  if (st.phase !== ctl.lastPhase || (st.closing && !ctl.warned["c" + st.phase])) {
    if (st.closing) { W.events.emit("stormClosing", st); ctl.warned["c" + st.phase] = true; }
    else if (st.phase !== ctl.lastPhase) W.events.emit("stormPhase", st);
    ctl.lastPhase = st.phase;
  }
  // 10s-to-close warning
  if (st.phaseState === "waiting" && st.tToNext < 10 && !ctl.warned["w" + st.phase]) {
    ctl.warned["w" + st.phase] = true;
    W.events.emit("stormWarning", st);
  }

  // damage ticks (1 Hz)
  if (st.dps > 0 && W.phase === "match") {
    ctl.tickAcc += dt;
    while (ctl.tickAcc >= 1) {
      ctl.tickAcc -= 1;
      for (const a of W.actors) {
        if (!a.alive || a.netRemote) continue;
        const d = Math.hypot(a.pos.x - st.center.x, a.pos.z - st.center.z);
        if (d > st.radius) {
          // RAMPING damage: the longer you soak, the harder each tick hits
          // (owner: "it shouldn't stay 1/tick") — +50% per 6s in the storm,
          // capped at 3×; resets after 3s back inside the circle
          a._stormT = (a._stormT || 0) + 1;
          const dmg = st.dps * Math.min(3, 1 + Math.floor(a._stormT / 6) * 0.5);
          // storm ignores shield (classic BR): hp only
          a.hp -= dmg;
          a.lastDamageT = W.t;
          if (a === W.player) W.events.emit("stormTick", dmg);
          if (a.hp <= 0) {
            W.events.emit("stormKill", a);
            // credit a recent attacker (within 8s) if any, else the storm
            const credit = a.lastAttacker && W.t - (a.lastHurtByActorT || -99) < 8 ? a.lastAttacker : null;
            W.killActor(a, credit, "storm");
          }
        } else if (a._stormT) {
          // safe inside: soak decays instead of vanishing (dip-outs still sting)
          a._stormT = Math.max(0, a._stormT - 2);
        }
      }
    }
  }
  // player in-storm state for HUD tint + audio
  const p = W.player;
  if (p) {
    const d = Math.hypot(p.pos.x - st.center.x, p.pos.z - st.center.z);
    const inStorm = st.dps > 0 && d > st.radius;
    if (inStorm !== W._playerInStorm) { W._playerInStorm = inStorm; W.events.emit("playerStormState", inStorm); }
  }
}

// ── inside-the-storm tint ────────────────────────────────────────────────────
/** The sky dome's top / bot Colors: the C-SKY contract first, the dome mesh named "sky" as the fallback. */
function resolveSky(W) {
  const su = W.skyUniforms;
  if (su && su.top && su.bot && su.top.value && su.top.value.isColor && su.bot.value && su.bot.value.isColor) {
    return { top: su.top.value, bot: su.bot.value, src: "W.skyUniforms" };
  }
  if (!T.skyTried) {
    T.skyTried = true;
    let m = W.skyDome || null;
    if (!m && W.scene) m = W.scene.getObjectByName("sky");
    const u = m && m.material && m.material.uniforms;
    if (u && u.top && u.bot && u.top.value && u.top.value.isColor && u.bot.value && u.bot.value.isColor) {
      T.skyRefs = { top: u.top.value, bot: u.bot.value, src: "mesh:sky" };
    } else T.skyRefs = null;
  }
  return T.skyRefs;
}

function sameRGB(a, b) { return a.r === b.r && a.g === b.g && a.b === b.b; }

/** Write the tint at strength k (0..1] into fog / background / dome. Every channel is tracked on its own: a channel somebody
 *  else wrote since this module's last write (the map's altitude fog density, the underwater fog colour...) has that value
 *  adopted as the new base and the tint is laid over it. */
function applyTint(W, k) {
  const sc = W.scene, fog = sc.fog, bg = sc.background;
  const sky = resolveSky(W);
  const fresh = !T.applied;
  if (fresh) { T.have.fogc = T.have.dens = T.have.bg = T.have.top = T.have.bot = false; }
  if (fog) {
    if (fresh || !sameRGB(fog.color, T.last.fog)) { if (!fresh) T.foreign++; T.base.fog.copy(fog.color); }
    if (fresh || fog.density !== T.last.dens) { if (!fresh) T.foreign++; T.base.dens = fog.density; }
    fog.color.lerpColors(T.base.fog, _tFog, k);
    fog.density = T.base.dens + (T.base.dens * TINT_FOG_DENS_K + TINT_FOG_DENS_ADD - T.base.dens) * k;
    T.last.fog.copy(fog.color); T.last.dens = fog.density;
    T.have.fogc = T.have.dens = true;
  }
  if (bg && bg.isColor) {
    if (fresh || !sameRGB(bg, T.last.bg)) { if (!fresh) T.foreign++; T.base.bg.copy(bg); }
    bg.lerpColors(T.base.bg, _tFog, k);
    T.last.bg.copy(bg);
    T.have.bg = true;
  }
  if (sky) {
    if (fresh || !sameRGB(sky.top, T.last.top)) { if (!fresh) T.foreign++; T.base.top.copy(sky.top); }
    if (fresh || !sameRGB(sky.bot, T.last.bot)) { if (!fresh) T.foreign++; T.base.bot.copy(sky.bot); }
    sky.top.lerpColors(T.base.top, _tTop, k); sky.bot.lerpColors(T.base.bot, _tBot, k);
    T.last.top.copy(sky.top); T.last.bot.copy(sky.bot);
    T.have.top = T.have.bot = true;
  }
  T.applied = true;
}

/** Put every channel this module changed back EXACTLY, channel by channel, and only where nobody has written it since. */
function restoreTint(W) {
  if (!T.applied) return;
  const sc = W.scene, fog = sc.fog, bg = sc.background;
  const sky = resolveSky(W);
  if (fog && T.have.fogc && sameRGB(fog.color, T.last.fog)) fog.color.copy(T.base.fog);
  if (fog && T.have.dens && fog.density === T.last.dens) fog.density = T.base.dens;
  if (bg && bg.isColor && T.have.bg && sameRGB(bg, T.last.bg)) bg.copy(T.base.bg);
  if (sky && T.have.top && sameRGB(sky.top, T.last.top)) sky.top.copy(T.base.top);
  if (sky && T.have.bot && sameRGB(sky.bot, T.last.bot)) sky.bot.copy(T.base.bot);
  T.applied = false;
  T.have.fogc = T.have.dens = T.have.bg = T.have.top = T.have.bot = false;
}

function setGrade(W, v) {
  const g = v > 0 ? (v < 1 ? v : 1) : 0;
  if (g === T.grade) return;
  T.grade = g;
  const k = W.kernel;
  if (k && typeof k.setGrade === "function") k.setGrade(g);
}

// ── lightning ────────────────────────────────────────────────────────────────
const _bm = new THREE.Matrix4();
function boltRand(ctl) { ctl._rs = (ctl._rs == null ? 0x2545f491 : ctl._rs); ctl._rs = (ctl._rs * 1664525 + 1013904223) >>> 0; return ctl._rs / 4294967296; }

function updateBolts(W, ctl, st, dt) {
  const bolts = ctl.bolts;
  const iB = bolts.geometry.getAttribute("iB");
  const cam = W.camera;
  let any = false, writeM = false;
  const active = st && ctl.wall.visible && W.phase !== "menu";
  for (let i = 0; i < N_BOLTS; i++) {
    const b = ctl.bolt[i];
    const age = _clock - b.t0;
    let inten = 0;
    if (b.dur > 0 && age >= 0 && age < b.dur) {
      // sharp strike, a dim gap, a second strike, then a fast decay (reads as real forked lightning)
      const u = age / b.dur;
      inten = u < 0.06 ? u / 0.06 : u < 0.20 ? 0.45 : u < 0.30 ? 0.95 : Math.pow(1 - (u - 0.30) / 0.70, 2.2);
    } else if (b.dur > 0) { b.dur = 0; writeM = true; }
    if (active && b.dur === 0 && _clock >= b.next) {
      // a new strike: in the camera's half of the sky, outside the circle. The camera looks down
      // its local -Z, i.e. the NEGATIVE of matrixWorld column 2 (elements 8 and 10 in x / z).
      const me = cam.matrixWorld.elements;
      let fx = -me[8], fz = -me[10];
      const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
      const turn = (boltRand(ctl) - 0.5) * 1.7, ct = Math.cos(turn), sn = Math.sin(turn);
      const dist = 380 + boltRand(ctl) * 520;
      let x = cam.position.x + (fx * ct - fz * sn) * dist, z = cam.position.z + (fx * sn + fz * ct) * dist;
      const dx = x - st.center.x, dz = z - st.center.z, dd = Math.hypot(dx, dz) || 1;
      const need = st.radius + 70 + boltRand(ctl) * 160;
      if (dd < need) { x = st.center.x + dx / dd * need; z = st.center.z + dz / dd * need; }   // push it out beyond the wall
      b.x = x; b.z = z;
      b.h = 190 + boltRand(ctl) * 110; b.w = b.h * (0.34 + boltRand(ctl) * 0.12);
      b.y = Math.max(W.map.waterY, 0) + 35 + boltRand(ctl) * 45;
      b.v = Math.floor(boltRand(ctl) * 3) % 3; b.flip = boltRand(ctl) < 0.5 ? -1 : 1;
      b.t0 = _clock; b.dur = 0.55 + boltRand(ctl) * 0.35;
      b.next = _clock + b.dur + 1.6 + boltRand(ctl) * 4.2;
      b.seq++;
      _bm.makeScale(b.w, b.h, 1); _bm.setPosition(b.x, b.y, b.z);
      bolts.setMatrixAt(i, _bm); writeM = true;
      inten = 0;
    }
    if (inten > 0) any = true;
    iB.setXYZW(i, b.v, inten * (active ? 1 : 0), b.flip, 0);
  }
  iB.needsUpdate = true;
  if (writeM) bolts.instanceMatrix.needsUpdate = true;
  bolts.visible = any;
}

// ── per-frame VISUAL update (render dt) ──────────────────────────────────────
function viewUpdate(W, dt) {
  _clock += dt;
  const ctl = W.stormCtl;
  const live = ctl && !ctl._disposed && ctl.storm.phases.length > 0 && W.phase !== "menu";
  if (!live) {
    // no storm to draw (menu, practice, between matches): everything neutral, nothing left applied
    if (T.amt > 0 || T.applied) { T.amt = 0; restoreTint(W); }
    setGrade(W, 0);
    if (ctl && !ctl._disposed && ctl.bolts) ctl.bolts.visible = false;
    return;
  }
  const st = ctl.storm.stateAt(W.t);
  const u = ctl.wallMat.uniforms;
  u.uTime.value = _clock;
  const cam = W.camera;
  if (cam) {
    const inside = Math.hypot(cam.position.x - st.center.x, cam.position.z - st.center.z) < st.radius;
    if (inside !== ctl.camInside) { ctl.camInside = inside; }
    u.uCamInside.value = inside ? 1 : 0;
  }

  // tint ramp: 0.5 s in, 0.5 s out, driven by playerStormState
  const target = W._playerInStorm ? 1 : 0;
  if (T.amt < target) T.amt = Math.min(target, T.amt + dt / TINT_RAMP_S);
  else if (T.amt > target) T.amt = Math.max(target, T.amt - dt / TINT_RAMP_S);
  if (T.amt > 0) {
    let k = T.amt * T.amt * (3 - 2 * T.amt);   // smoothstep
    // submerged: the water's own fog colour owns the screen (player.js underwaterFx), so the storm
    // tint yields to it by the same 0..1 amount instead of painting lavender over the sea
    const uw = W._uw > 0 ? (W._uw < 1 ? W._uw : 1) : 0;
    applyTint(W, k * (1 - uw));
    setGrade(W, k);
  } else {
    if (T.applied) restoreTint(W);
    setGrade(W, 0);
  }

  if (cam && W.stormCtl === ctl) updateBolts(W, ctl, st, dt);
}

/** Contract C-WARM: the objects whose programs must exist before the first drop frame (the wall and the bolt pool). */
export function warmObjects(W) {
  const ctl = W && W.stormCtl;
  if (!ctl || ctl._disposed) return [];
  const g = W.group("storm");
  const out = [];
  if (ctl.wall) { if (!ctl.wall.parent) g.add(ctl.wall); out.push(ctl.wall); }
  if (ctl.bolts) { if (!ctl.bolts.parent) g.add(ctl.bolts); out.push(ctl.bolts); }
  return out;
}

/** Contract C-WARM / C8: free this match's wall (geometry, material, ground texture, bolt texture) and leave the world neutral. */
export function disposeMatch(W) {
  const ctl = W && W.stormCtl;
  // a tint left applied would leak into the next map's fog / sky; restore (exactly) before anything else
  T.amt = 0;
  restoreTint(W);
  T.skyTried = false; T.skyRefs = null;
  setGrade(W, 0);
  if (W) { W._playerInStorm = false; if (W.stormU) { W.stormU.cx = 0; W.stormU.cz = 0; W.stormU.r = 1e9; } }
  if (!ctl || ctl._disposed) return { storm: "none" };
  ctl._disposed = true;
  try { const ups = W.kernel && W.kernel._updaters; if (ups && ctl._upd) { const i = ups.indexOf(ctl._upd); if (i >= 0) ups.splice(i, 1); } } catch (e) { /* teardown must never block the next match */ }
  let n = 0;
  try {
    if (ctl.wall && ctl.wall.parent) ctl.wall.parent.remove(ctl.wall);
    if (ctl.bolts && ctl.bolts.parent) ctl.bolts.parent.remove(ctl.bolts);
    if (ctl.wallGeo) { ctl.wallGeo.dispose(); n++; }
    if (ctl.wallMat) { ctl.wallMat.dispose(); n++; }
    if (ctl.tex) { ctl.tex.dispose(); n++; }
    if (ctl.boltGeo) { ctl.boltGeo.dispose(); n++; }
    if (ctl.boltMat) { ctl.boltMat.dispose(); n++; }
    if (ctl.boltTex) { ctl.boltTex.dispose(); n++; }
    if (ctl.bolts && ctl.bolts.dispose) ctl.bolts.dispose();
  } catch (e) { /* teardown must never block the next match */ }
  return { storm: "disposed", resources: n };
}

/** Test / probe read-back (no DOM reads, no allocation worth mentioning). */
export function readback(W) {
  const ctl = W && W.stormCtl;
  return {
    tint: { amt: +T.amt.toFixed(3), applied: T.applied, grade: +T.grade.toFixed(3), foreignWrites: T.foreign, skySrc: T.skyRefs ? T.skyRefs.src : (W && W.skyUniforms ? "W.skyUniforms" : null) },
    wall: ctl && !ctl._disposed ? { visible: ctl.wall.visible, lutRefreshes: ctl.lutRefreshes, lutR: +ctl.lutR.toFixed(1), camInside: ctl.camInside } : null,
    bolts: ctl && !ctl._disposed ? { visible: ctl.bolts.visible, n: N_BOLTS } : null,
    stormU: W && W.stormU ? { cx: W.stormU.cx, cz: W.stormU.cz, r: W.stormU.r } : null,
  };
}
