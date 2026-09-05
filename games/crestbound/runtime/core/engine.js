/**
 * CRESTBOUND — runtime/core/engine.js
 * ---------------------------------------------------------------------------
 * The renderer spine: WebGL2 context, world scene + camera, the fixed light
 * rig (sun / fill / rim / hemi / ambient), the sun's player-following shadow
 * frustum, the procedural PMREM environment, the frame loop, the fixed-timestep
 * driver the player controller runs on, and honest per-frame stats.
 * CONTRACT §6.
 *
 * Ported from Ascendant. What changed, and why:
 *
 *  - NO overlay scene / viewmodel camera. Crestbound is third-person; the hero
 *    is an ordinary scene object with a real cast shadow.
 *
 *  - THE ENGINE OWNS THE LIGHT RIG. Doctrine §3: "visible-light COUNT is a
 *    shader-permutation key — fixed light pools, never add/remove at runtime".
 *    Ascendant's themes.js built a fresh DirectionalLight trio per theme, which
 *    is a full material recompile on every course load. Here `sun`, `fill`,
 *    `rim`, `hemi` and `ambient` are created ONCE and live in the scene for the
 *    engine's whole life; `setTheme()` only writes colours, intensities and
 *    directions into them (a theme without a rim light gets intensity 0, not a
 *    removed light). themes.js should drive these through `engine.setTheme()`
 *    and add only its sky dome and emissive props on top.
 *
 *  - CSM-lite shadow follow. The sun's orthographic shadow frustum is small
 *    (±`extent` metres — sharp texels) and `followShadow(pos)` slides it with
 *    the hero every frame. The focus is snapped to the shadow-map texel grid IN
 *    LIGHT SPACE, so a gliding frustum does not make every shadow edge shimmer
 *    as the player runs. If nobody calls `followShadow` in a frame, `render()`
 *    follows the camera instead — configured maps with zero visible shadows
 *    (the failure Ascendant shipped for a month) cannot happen here.
 *
 *  - Honest stats. `renderer.info.autoReset = false` + a reset per FRAME so the
 *    draw-call number is the whole composer chain, not the last pass. `frameMs`
 *    is the CPU work per tick (callbacks + game loop + render) and `p99Ms` is
 *    the 99th-percentile frame INTERVAL over a rolling 120-frame window — the
 *    number that shows hitches, which averages hide (doctrine §3). A hitch
 *    also records the shader-program delta so "hitch + programs jumped" can be
 *    attributed to a compile straight from the overlay.
 *
 *  - Renderer is antialias:false ON PURPOSE (MSAA cannot combine with the post
 *    chain's HDR targets; FXAA/SMAA live in post.js), ACESFilmic, sRGB output,
 *    PCFSoft shadows, DPR ≤ 1.5. Frame dt is clamped to 1/20 s so a tab that
 *    was backgrounded for a minute cannot teleport the hero through a wall.
 *
 *  - `setEnvironment()` bakes a PMREM probe from a procedural sky scene. This
 *    is the single biggest lever between "plastic" and "AAA": without an
 *    environment map a metalness-1 material reflects nothing and renders flat
 *    grey. Every theme change re-bakes it, which costs a few ms once.
 */

import * as THREE from 'three';

import { Settings, DPR_CEILING } from './settings.js';
import { Emitter, RollingAverage, clamp, dig, nowMs, numOr } from './util.js';
import { TUNE } from './tuning.js';
import { Post } from '../fx/post.js';

/* ---- module-scope scratch: nothing in an update path may allocate -------- */
const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _v3c = new THREE.Vector3();
const _lRight = new THREE.Vector3();
const _lUp = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const _col = new THREE.Color();

const DEFAULT_FAR = 900;
const DEFAULT_NEAR = 0.05;
const MAX_DT = 1 / 20;
/**
 * Presentation clocks (death, cinematic, veil) run on the WALL delta. The cap
 * is deliberately far above `MAX_DT`: a 1.4 s frame in a VISIBLE tab is a
 * stall, and a stall is precisely what a presentation clock must not stretch —
 * capping at a fraction of a second reintroduced the bug this fixes (a 620 ms
 * death sequence taking 3 s because each frame could only advance it by the
 * cap). One second still bounds a single pathological step.
 */
const MAX_PRESENT_DT = 1.0;

/** rolling window for p99 (doctrine §3: report p99, not averages) */
const P99_WINDOW = 120;
/** a frame interval above this is a hitch (two missed 60 Hz vsyncs) */
const HITCH_MS = 33.4;

/**
 * Map a QUALITY preset's `shadowFilter` onto a three shadow-map type.
 *
 * PCFSoftShadowMap is nine SHADOW TAPS EACH manually bilinear-interpolated —
 * about four times the texture fetches of PCFShadowMap, per fragment, for the
 * one shadow-casting light. `_harness/frameprobe.py` measured -5.29 ms on
 * verdant-1 between PCFSoft and a single tap at 1920x1080. HIGH gets 'pcf',
 * ULTRA keeps 'pcfsoft'.
 *
 * @param {object} q a QUALITY preset
 * @returns {number} a three.js shadow-map type constant
 */
function shadowFilterType(q) {
  const f = q && typeof q.shadowFilter === 'string' ? q.shadowFilter.toLowerCase() : 'pcfsoft';
  if (f === 'basic') return THREE.BasicShadowMap;
  if (f === 'pcf') return THREE.PCFShadowMap;
  return THREE.PCFSoftShadowMap;
}

/** default shadow frustum when a theme does not say (metres, half-extent) */
const SHADOW_DEFAULT = { extent: 40, bias: -0.0006, normalBias: 0.03 };

/* ---------------------------------------------------------------------------
 * SHADOW EDGE FADE — one global ShaderChunk patch, applied once at module load.
 * ---------------------------------------------------------------------------
 * Critic, `_shots/verdant-1/cp3.png` and `vista-ne.png`: "the terrain shadow
 * ends on a straight hard-cut line with a visible brightness step — the
 * cascade/shadow-frustum edge is showing as world geometry."
 *
 * That is exactly what it is. `followShadow()` slides one ortho frustum of
 * +/- `extent` metres with the hero; three's `getShadow()` tests
 * `inFrustum` as a HARD boolean, so every fragment inside the box takes its
 * shadow and every fragment one texel outside takes none. Across an open
 * meadow that boundary is a straight line drawn on the ground.
 *
 * Widening the frustum only moves the line and costs texel density everywhere.
 * The fix is to stop the boundary being a step: fade the shadow term to
 * "unshadowed" over the outer ~7 % of the map on each axis, and over the last
 * slice of depth. A shadow that is already fading out is invisible when it
 * ends. One smoothstep pair per shadow lookup, no extra texture reads, no new
 * uniforms, and it applies to every light and every material in the game
 * because it is patched in the chunk they all share.
 *
 * The replacement asserts: if a three upgrade reshapes `getShadow`, this throws
 * at load instead of silently reverting to the hard edge.
 */
(function patchShadowEdgeFade() {
  const CH = THREE.ShaderChunk;
  const src = CH && CH.shadowmap_pars_fragment;
  const FROM = '\t\treturn mix( 1.0, shadow, shadowIntensity );';
  if (typeof src !== 'string' || src.indexOf(FROM) === -1) {
    throw new Error('[Engine] shadowmap_pars_fragment no longer ends getShadow() with the ' +
      'expected mix() - the shadow edge-fade patch is stale, re-derive it against three.');
  }
  const TO = [
    '\t\t// CRESTBOUND: fade the shadow out at the frustum edge (see engine.js)',
    '\t\tvec2 cbEdge = smoothstep( vec2( 0.0 ), vec2( 0.07 ), shadowCoord.xy )',
    '\t\t            * smoothstep( vec2( 1.0 ), vec2( 0.93 ), shadowCoord.xy );',
    '\t\tfloat cbFade = cbEdge.x * cbEdge.y * smoothstep( 1.0, 0.88, shadowCoord.z );',
    '\t\tshadow = mix( 1.0, shadow, cbFade );',
    FROM,
  ].join('\n');
  CH.shadowmap_pars_fragment = src.replace(FROM, TO);
})();

/* ---------------------------------------------------------------------------
 * HEIGHT FOG + AERIAL PERSPECTIVE — one global ShaderChunk patch (2026-09-04).
 * ---------------------------------------------------------------------------
 * Owner, on `_shots/_before_visual/verdant-1/spawn.png`: "no atmospheric
 * depth (the fort/temple are as sharp as the foreground, distant trees are
 * black cutouts)". three's fog is a function of VIEW DISTANCE only, and every
 * theme's fog colour is the dark band the readability law needs BEHIND a deck
 * (themes.js) — so raising its density to get depth just paints the play space
 * with the band, which is the trade every earlier round lost.
 *
 * The patch splits the two jobs by HEIGHT. Every fogged fragment carries its
 * world Y (`vCbFogY`, recovered in the vertex chunk from the view-space
 * position with the camera's rotation transposed — one dot product, no extra
 * matrix). The fog density is scaled by `exp(-(y - base) * falloff)` above a
 * base that FOLLOWS THE HERO'S FEET (`followShadow` writes it every frame), so
 * the deck the player is judging keeps exactly the density and colour the
 * contrast gate measures, while a fort roof, a temple or a treeline ABOVE the
 * hero thins out and its fog colour slides toward the SKY HORIZON — which is
 * what aerial perspective looks like. Far fragments also lose saturation
 * before they take the fog colour (`uCbFogH.w`), the half of aerial
 * perspective that costs the readability law nothing.
 *
 * Uniforms are two shared Float32Arrays: three's `cloneUniforms` copies every
 * Vector/Color by value but keeps a typed array BY REFERENCE, so one write in
 * `setTheme`/`followShadow` reaches every program in the game without a
 * per-material walk, and `setValueV4f` uploads a typed array directly. They
 * are appended to `UniformsLib.fog` (late merges — materials.js's water) and
 * to every ShaderLib entry that already carries `fogColor`.
 */
/** [ baseY, falloff 1/m, heightThin 0..1, distanceDesat 0..1 ] */
const CB_FOG_H = new Float32Array([0, 0.07, 0.6, 0.35]);
/** [ r, g, b, skyMix 0..1 ] — the horizon colour high fog fades toward */
const CB_FOG_SKY = new Float32Array([0.6, 0.7, 0.8, 0.0]);
/**
 * AERIAL PERSPECTIVE band (2026-09-04, image lane) — [ r, g, b, density 1/m ].
 * A second, SLOW, plain-exponential band that starts long before the
 * readability band and tints toward a colour DARKER than the sky horizon, so
 * the mid-ground is graded (owner O3: "the fort on the hill, the hills and the
 * mid-ground sit at one flat value") and a far ridge ends as a silhouette
 * against the dome instead of dissolving into a haze wall (critic C9).
 */
const CB_FOG_AER = new Float32Array([0.5, 0.6, 0.7, 0.0]);
/** [ skyCap 0..1, aerialStrength 0..1, 0, 0 ] — skyCap bounds the altitude term */
const CB_FOG_K = new Float32Array([0.6, 1.0, 0.0, 0.0]);
/** how far below the hero's feet the full-density fog base sits (metres) */
const FOG_BASE_BELOW_DEFAULT = 3.0;

(function patchHeightFog() {
  const CH = THREE.ShaderChunk;
  const pv = CH.fog_pars_vertex, fv = CH.fog_vertex;
  const pf = CH.fog_pars_fragment, ff = CH.fog_fragment;
  const V_FROM = 'vFogDepth = - mvPosition.z;';
  const F_FROM = 'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );';
  if (typeof pv !== 'string' || typeof fv !== 'string' || typeof pf !== 'string' || typeof ff !== 'string' ||
      fv.indexOf(V_FROM) === -1 || ff.indexOf(F_FROM) === -1 ||
      ff.indexOf('float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );') === -1 ||
      ff.indexOf('float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );') === -1) {
    throw new Error('[Engine] three fog chunks no longer match — the height-fog patch is stale, re-derive it.');
  }
  CH.fog_pars_vertex = pv.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying float vCbFogY;');
  CH.fog_vertex = fv.replace(V_FROM, V_FROM +
    '\n\t// CRESTBOUND: world Y from the view-space position (camera rotation transposed), see engine.js' +
    '\n\tvCbFogY = dot( viewMatrix[ 1 ].xyz, mvPosition.xyz ) + cameraPosition.y;');
  CH.fog_pars_fragment = pf.replace('varying float vFogDepth;',
    'varying float vFogDepth;\n\tvarying float vCbFogY;\n\tuniform vec4 uCbFogH;\n\tuniform vec4 uCbFogSky;' +
    '\n\tuniform vec4 uCbFogAer;\n\tuniform vec4 uCbFogK;');
  CH.fog_fragment = ff
    .replace('float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );',
      'float cbFogD = fogDensity * cbFogDens;\n\t\tfloat fogFactor = 1.0 - exp( - cbFogD * cbFogD * vFogDepth * vFogDepth );')
    .replace('float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );',
      'float fogFactor = smoothstep( fogNear, fogFar / max( cbFogDens, 0.05 ), vFogDepth );')
    .replace('#ifdef USE_FOG', '#ifdef USE_FOG' +
      '\n\t// CRESTBOUND height fog: full density at/below the hero, thinning above (engine.js)' +
      '\n\tfloat cbFogHgt = exp( - max( vCbFogY - uCbFogH.x, 0.0 ) * uCbFogH.y );' +
      '\n\tfloat cbFogDens = mix( 1.0, cbFogHgt, uCbFogH.z );')
    .replace(F_FROM,
      // altitude term, CAPPED: a station 30-50 m up must not fog to pure sky
      'vec3 cbFogCol = mix( fogColor, uCbFogSky.rgb, uCbFogSky.a * min( 1.0 - cbFogHgt, uCbFogK.x ) );' +
      // aerial perspective: slow plain-exponential band toward a colour darker than the horizon
      '\n\tfloat cbAer = ( 1.0 - exp( - vFogDepth * uCbFogAer.w ) ) * uCbFogK.y;' +
      '\n\tfloat cbFogL = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );' +
      '\n\tgl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( cbFogL ), uCbFogH.w * max( fogFactor, cbAer ) );' +
      '\n\tgl_FragColor.rgb = mix( gl_FragColor.rgb, uCbFogAer.rgb, cbAer );' +
      '\n\tgl_FragColor.rgb = mix( gl_FragColor.rgb, cbFogCol, fogFactor );');

  const add = (u) => {
    if (!u || !u.fogColor) return;
    if (!u.uCbFogH) u.uCbFogH = { value: CB_FOG_H };
    if (!u.uCbFogSky) u.uCbFogSky = { value: CB_FOG_SKY };
    if (!u.uCbFogAer) u.uCbFogAer = { value: CB_FOG_AER };
    if (!u.uCbFogK) u.uCbFogK = { value: CB_FOG_K };
  };
  add(THREE.UniformsLib.fog);
  const lib = THREE.ShaderLib;
  for (const k in lib) add(lib[k] && lib[k].uniforms);
})();

/* -- render scale (CONTRACT hard rule 4) -----------------------------------
 * The frame on the reference machine is GPU FILL-bound: measured 2026-09-02
 * with the GPU timer query, cost fits T = C + F*pixels with F between 78 and
 * 91 % of the frame, and stacking every non-feature-deleting fill cut still
 * left 40.99 ms (24.4 fps) at native 1920x1080 while the SAME chain at quarter
 * pixels cost 19.71 ms (50.7 fps). Pixels are therefore the only lever with the
 * range to reach the fps target, so the renderer owns an internal render scale
 * -- the same knob as the pre-existing DPR <= 1.5 cap, applied below 1.0.
 * The COMPOSER's targets are allocated at `scale` x the drawing buffer; the
 * drawing buffer itself stays native (2026-09-04, image lane — it used to be
 * the small one, and the browser compositor's bilinear stretch was the last
 * thing the frame went through). `Post`'s PresentPass brings the internal
 * frame up to the canvas with a Catmull-Rom upsample and an RCAS sharpen, and
 * nothing that reads CSS pixels (pointer, DOM HUD, NDC) moves.
 */
/** Floor the dynamic controller may never go below, whatever the tier says. */
const MIN_RENDER_SCALE = 0.45;
/**
 * How far below the tier the controller may wander BEFORE it has to cross the
 * next tier's scale. Kept as the comfort band it always was; it is no longer a
 * hard stop.
 *
 * WHY IT IS NO LONGER A HARD STOP (2026-09-03). The band used to be the whole
 * authority: from `high` (0.85) the controller could reach 0.70 and no further,
 * which on the reference Intel UHD is ~40 fps — still 15 fps under target, with
 * the controller pinned at its floor and out of moves. A wrong STARTING TIER
 * was therefore unrecoverable in play. It now descends across tier boundaries
 * to MIN_RENDER_SCALE, so a machine the detector guessed wrong about converges
 * to a playable scale at the contract's rate limit (0.05/s, never mid-air) and
 * climbs back to its tier value the moment the frame can afford it.
 *
 * The CEILING stays at the tier value on purpose: rendering ABOVE the tier means
 * reallocating every composer target (measured 141/151/179/179/646 ms stalls —
 * see setRenderScale), which is what made this controller unshippable in the
 * first place. Below the tier every step is a uniform write.
 */
const RENDER_SCALE_BAND = 0.15;
/** One step. Combined with STEP_PERIOD this is the "at most 0.05 per second". */
const RENDER_SCALE_STEP = 0.05;
/** Seconds between steps. */
const RENDER_SCALE_STEP_PERIOD = 1.0;
/** Seconds continuously above target before the controller raises again. */
const RENDER_SCALE_RAISE_HOLD = 2.0;
/** fps margin above target a raise needs, so it does not oscillate on the line. */
const RENDER_SCALE_RAISE_MARGIN = 3;
/** Default fps the dynamic controller holds. */
const RENDER_SCALE_TARGET_FPS = 58;

/* ===========================================================================
 * Procedural sky used as the PMREM source
 * ======================================================================== */

const ENV_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  // Raw local position, normalised in the fragment shader: interpolating an
  // already-normalised vector across a cube face bends the sun disc.
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const ENV_FRAG = /* glsl */`
uniform vec3  uZenith;
uniform vec3  uHorizon;
uniform vec3  uGround;
uniform vec3  uSunColor;
uniform vec3  uSunDir;
uniform float uSunSize;
uniform float uSunPower;
uniform float uHaze;
uniform float uIntensity;

varying vec3 vDir;

void main() {
  vec3 d = normalize( vDir );
  float h = d.y;

  vec3 sky = mix( uHorizon, uZenith, pow( clamp( h, 0.0, 1.0 ), 0.55 ) );
  vec3 gnd = mix( uHorizon, uGround, pow( clamp( -h, 0.0, 1.0 ), 0.42 ) );
  vec3 col = h > 0.0 ? sky : gnd;

  // Horizon haze band — gives flat metals a bright line to catch, which is
  // most of what reads as "this surface is polished".
  col += uHorizon * uHaze * exp( -abs( h ) * 8.0 ) * 0.65;

  // Key light as a real disc plus a broad glow, at HDR intensity so the PMREM
  // roughness chain produces a proper specular falloff.
  float cs = max( dot( d, normalize( uSunDir ) ), 0.0 );
  float disc = smoothstep( 1.0 - uSunSize, 1.0 - uSunSize * 0.30, cs );
  float glow = pow( cs, uSunPower );
  col += uSunColor * ( disc * 7.0 + glow * 1.35 );

  gl_FragColor = vec4( col * uIntensity, 1.0 );
}
`;

/* ===========================================================================
 * Engine
 * ======================================================================== */

export class Engine {
  /**
   * @param {HTMLElement|string} container the element (or its id) the canvas
   *        is appended to. Sized from the element, watched with a
   *        ResizeObserver.
   * @throws {Error} when WebGL 2 is unavailable — #nogpu is revealed first.
   */
  constructor(container) {
    /** @type {HTMLElement} */
    this.container = resolveContainer(container);

    /** general-purpose bus: 'resize'(w,h), 'quality'(preset), 'visibility'(bool), 'theme'(def), 'environment'(tex), 'contextlost', 'contextrestored' */
    this.events = new Emitter();

    /* ---------------------------------------------------------------- gl */
    const canvas = document.createElement('canvas');
    canvas.setAttribute('tabindex', '-1');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.outline = 'none';
    canvas.style.touchAction = 'none';

    const gl = probeWebGL2(canvas);
    if (!gl) {
      revealNoGpu();
      throw new Error('CRESTBOUND requires WebGL 2, which this browser did not provide. ' +
        'Enable hardware acceleration (chrome://settings/system) and reload.');
    }

    this.container.appendChild(canvas);

    /** @type {THREE.WebGLRenderer} */
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      context: gl,
      antialias: false,                 // FXAA / SMAA in the post chain instead
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      alpha: false,
      preserveDrawingBuffer: false,
    });

    /** @type {object} the active QUALITY preset */
    this.quality = Settings.quality();

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = this.quality.shadowMap > 0;
    this.renderer.shadowMap.type = shadowFilterType(this.quality);
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.autoClear = true;
    this.renderer.setClearColor(0x0b0a16, 1);
    // The composer issues several draws per frame; manual reset gives us a
    // whole-frame draw-call number instead of "whatever the last pass did".
    this.renderer.info.autoReset = false;

    /* ------------------------------------------------------------- scene */
    /** @type {THREE.Scene} */
    this.scene = new THREE.Scene();
    this.scene.name = 'world';
    this.scene.matrixWorldAutoUpdate = true;

    /* ------------------------------------------------------------ camera */
    const size = this._measure();
    this.size = { w: size.w, h: size.h };

    /** the resting FOV the follow camera's run/peek kicks are measured against */
    this.baseFov = TUNE.cam.fov;

    /** @type {THREE.PerspectiveCamera} */
    this.camera = new THREE.PerspectiveCamera(this.baseFov, size.w / size.h, DEFAULT_NEAR, DEFAULT_FAR);
    this.camera.name = 'follow';
    this.camera.rotation.order = 'YXZ';   // yaw then pitch: no roll surprises
    this.scene.add(this.camera);

    /* --------------------------------------------------------- pixel size */
    this._pr = Settings.pixelRatio();
    /** @private the quality tier's authored render scale */
    this._tierScale = clamp(numOr(this.quality.renderScale, 1), MIN_RENDER_SCALE, 1);
    /**
     * Fraction of CSS pixels the drawing buffer is allocated at. Read it; set it
     * with `setRenderScale()`. `renderer.getPixelRatio()` stays `_pr` (the
     * canvas is native); the post chain sizes its targets from `_pr` times
     * its internal scale (`Post.internalScale`).
     * @type {number}
     */
    this.renderScale = this._tierScale;
    /**
     * Let the DYNAMIC controller move the scale. DEFAULT ON;
     * `?autoscale=0` turns it off. It shipped OFF until 2026-09-03,
     * for a measured reason that has now been fixed rather than lived with.
     *
     * WHAT THE REASON WAS. `setRenderScale`
     * had to resize the drawing buffer AND the post chain, and
     * `EffectComposer.setSize()` reallocates every render target it owns (two
     * ping-pong targets plus the bloom mip chain plus the AA pass). On the
     * reference machine (Intel UHD / D3D11, 1920x1080, quality high) one step
     * measured **141 / 151 / 179 / 179 / 646 ms** — a stall an order of
     * magnitude worse than the ~4 ms of frame time the 0.05 step buys back, and
     * long enough to swallow a queued input: with the controller on,
     * `camcheck.py` failed its long-jump case twice in a row
     * (`statesSeen: ["jump1","fall"], triggered: false` — the crouch never
     * registered before the jump) and passed with it off
     * (`statesSeen: ["longjump"], committed_s 0.419`).
     *
     * The fix the old comment asked for has landed: the composer targets are
     * allocated ONCE at the tier's size and the SCENE is rendered into a
     * sub-rectangle of them with viewport/scissor, brought back to full size by
     * one blit whose sampling UVs are scaled to match
     * (`Post.setRenderFraction`, `_harness/_subrect.py`). A step is now a
     * uniform write, so the controller ships on. The band runs from the tier
     * DOWNWARD only: above the tier the buffers really would have to grow, and
     * that case still takes the old reallocating path.
     */
    this.renderScaleAuto = !/[?&]autoscale=0/.test(
      typeof location !== 'undefined' && location.search ? location.search : '');
    /** fps the dynamic controller holds. */
    this.renderScaleTargetFps = RENDER_SCALE_TARGET_FPS;
    /**
     * Optional predicate the GAME installs; while it returns true the scale is
     * frozen. game.js hands it "the hero is airborne", because a resolution step
     * mid-jump is the one moment a player can see the switch.
     * @type {(() => boolean)|null}
     */
    this.renderScaleGuard = null;
    this._scaleAccum = 0;
    this._aboveT = 0;
    /** @private has the controller already reported crossing below the band? */
    this._scaleRescued = false;
    /** @private the scale the composer targets are SIZED at (the drawing
     *  buffer is native). Equal to the tier scale except while something has
     *  forced them larger (a quality change, the perf gate's native-1.0 INFO
     *  pass). */
    this._allocScale = this._tierScale;
    this.renderer.setPixelRatio(this._pr);
    this.renderer.setSize(size.w, size.h, true);

    /* --------------------------------------------------------- light rig */
    this._buildLights();

    /* ---------------------------------------------------------------- post */
    /** @type {Post} */
    this.post = new Post(this.renderer, this.scene, this.camera, this.size, this.quality, this._allocScale);
    this._pushSharpen();

    /* ------------------------------------------------------------ timing */
    /** @type {THREE.Clock} */
    this.clock = new THREE.Clock(true);
    /** fixed physics step — the player controller runs on this, not on dt (CONTRACT §11: 1/120) */
    this.fixedStep = 1 / 120;
    /** never run more than this many physics sub-steps in one frame */
    this.maxSubSteps = 8;
    /** interpolation factor left over in the fixed accumulator, 0..1 */
    this.fixedAlpha = 0;
    /** hard clamp on a single frame's dt */
    this.maxDt = MAX_DT;
    /** seconds since start() */
    this.elapsed = 0;
    /** this frame's clamped dt */
    this.dt = 0;
    /**
     * This frame's WALL delta — NOT clamped to `maxDt` (only to `MAX_PRESENT_DT`,
     * which exists so a tab-away cannot teleport an animation). `dt` protects the
     * SIMULATION from a long frame; a presentation clock (a death sequence, a
     * cinematic, a veil tween) must run in real time or a 90 ms frame stretches
     * a 620 ms sequence to 1.4 s. Those read `rawDt` / `rawMs`.
     */
    this.rawDt = 0;
    /** `rawDt` in milliseconds. */
    this.rawMs = 0;
    /** total frames rendered */
    this.frame = 0;
    this.running = false;

    /** @type {Map<string, number>} per-caller fixed-step accumulators */
    this._accs = new Map();
    this._raf = 0;
    this._last = nowMs();
    this._loopFn = null;
    this._loopErrors = 0;

    /** @type {Function[]} */
    this._frameCbs = [];

    /* ------------------------------------------------------------- stats */
    /**
     * fps        rolling mean over 30 frames
     * drawCalls  whole-frame (composer included)
     * tris       whole-frame triangles
     * frameMs    rolling mean CPU work per tick (callbacks + loop + render)
     * renderMs   rolling mean of render() alone
     * p99Ms      99th-percentile frame INTERVAL over the last 120 frames
     * maxMs      worst frame interval in the same window
     * hitches    frames whose interval exceeded 33.4 ms since resetStats()
     * hitchProgramDelta  programs compiled during the most recent hitch
     * @type {{fps:number, drawCalls:number, tris:number, frameMs:number, renderMs:number, p99Ms:number, maxMs:number, hitches:number, hitchProgramDelta:number, programs:number, geometries:number, textures:number}}
     */
    this.stats = {
      fps: 60, drawCalls: 0, tris: 0, frameMs: 0, renderMs: 0, p99Ms: 0, maxMs: 0,
      hitches: 0, hitchProgramDelta: 0, programs: 0, geometries: 0, textures: 0,
    };
    this._fpsAvg = new RollingAverage(30);
    this._msAvg = new RollingAverage(30);
    this._renderAvg = new RollingAverage(30);
    this._intervals = new Float32Array(P99_WINDOW);
    this._intI = 0;
    this._intN = 0;
    this._prevPrograms = 0;

    /* --------------------------------------------------------- environment */
    /** @type {THREE.PMREMGenerator|null} */
    this._pmrem = null;
    /** @type {THREE.WebGLRenderTarget|null} */
    this._envRT = null;
    /** @type {THREE.Scene|null} */
    this._envScene = null;
    this._envSky = null;
    /** @type {THREE.Mesh[]} */
    this._envCards = [];
    this._envCardGeo = null;
    /** @type {THREE.Texture|null} */
    this.envTexture = null;

    /** the ThemeDef last applied */
    this.theme = null;
    this._bg = new THREE.Color(0x0b0a16);

    /* ----------------------------------------------------------- listeners */
    this._resizeQueued = false;
    this._onWinResize = () => this._queueResize();
    this._onVisibility = () => {
      const visible = document.visibilityState !== 'hidden';
      // Reset the frame clock so returning from a background tab does not
      // deliver one enormous dt (it would be clamped, but the clamp itself
      // shows up as a lurch).
      this._last = nowMs();
      this.events.emit('visibility', visible);
    };
    this._onSettings = (s, changed) => this._onSettingsChanged(s, changed);
    this._onContextLost = (e) => {
      e.preventDefault();
      console.error('[Engine] WebGL context lost.');
      this.events.emit('contextlost');
    };
    this._onContextRestored = () => {
      console.warn('[Engine] WebGL context restored — rebuilding post chain and environment.');
      this.post.setQuality(Settings.quality());
      if (this.theme) this.setEnvironment(this.theme);
      this.events.emit('contextrestored');
    };

    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this._queueResize());
      this._ro.observe(this.container);
    } else {
      this._ro = null;
    }
    window.addEventListener('resize', this._onWinResize, { passive: true });
    window.addEventListener('orientationchange', this._onWinResize, { passive: true });
    document.addEventListener('visibilitychange', this._onVisibility);
    canvas.addEventListener('webglcontextlost', this._onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this._onContextRestored, false);
    Settings.on(this._onSettings);

    // One pass now so camera aspect / composer size are exact even if the
    // container was laid out after construction started.
    this.resize();
  }

  /** The EffectComposer, kept live across post-chain rebuilds. */
  get composer() {
    return this.post ? this.post.composer : null;
  }

  /** The canvas element. */
  get domElement() {
    return this.renderer.domElement;
  }

  /* ====================================================================== */
  /* light rig                                                              */
  /* ====================================================================== */

  /** @private Build the fixed light pool once. Nothing here is ever removed. */
  _buildLights() {
    const group = new THREE.Group();
    group.name = 'cb.lights';
    group.frustumCulled = false;

    /** @type {THREE.DirectionalLight} the key light; the only shadow caster */
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.name = 'cb.light.sun';
    this.sun.target.name = 'cb.light.sun.target';

    /** @type {THREE.DirectionalLight} cool fill from the opposite azimuth (no shadow) */
    this.fill = new THREE.DirectionalLight(0x6f8fd0, 0.55);
    this.fill.name = 'cb.light.fill';

    /** @type {THREE.DirectionalLight} rim / back light for silhouette separation (no shadow) */
    this.rim = new THREE.DirectionalLight(0xffffff, 0.6);
    this.rim.name = 'cb.light.rim';

    /** @type {THREE.HemisphereLight} sky/ground bounce */
    this.hemi = new THREE.HemisphereLight(0x8fb4ff, 0x4d3a2a, 0.55);
    this.hemi.name = 'cb.light.hemi';
    this.hemi.position.set(0, 60, 0);

    /** @type {THREE.AmbientLight} flat floor so nothing is ever pitch black */
    this.ambient = new THREE.AmbientLight(0x404860, 0.3);
    this.ambient.name = 'cb.light.ambient';

    group.add(this.sun, this.sun.target, this.fill, this.fill.target, this.rim, this.rim.target, this.hemi, this.ambient);
    this.scene.add(group);
    /** @type {THREE.Group} */
    this.lights = group;

    /** directions TOWARD each light (normalised) */
    this._sunDir = new THREE.Vector3(-0.42, 0.86, 0.30).normalize();
    this._fillDir = new THREE.Vector3(0.42, 0.26, -0.30).normalize();
    this._rimDir = new THREE.Vector3(0.15, 0.35, -0.92).normalize();
    /** the point the rig and the shadow frustum are centred on */
    this._focus = new THREE.Vector3(0, 0, 0);
    /** set by followShadow() each frame; render() falls back to the camera when it is not */
    this._shadowFollowed = false;
    /** metres below the followed position the full-density fog base sits */
    this._fogBelow = FOG_BASE_BELOW_DEFAULT;

    this._shadow = {
      extent: SHADOW_DEFAULT.extent,
      /** the theme's authored half-extent; `extent` is this capped by the tier */
      themeExtent: SHADOW_DEFAULT.extent,
      bias: SHADOW_DEFAULT.bias,
      normalBias: SHADOW_DEFAULT.normalBias,
      mapSize: this.quality.shadowMap | 0,
      texelWorld: 0,
      keyDist: SHADOW_DEFAULT.extent * 2.2,
    };
    this._configureShadow();
    this._placeLights();
  }

  /**
   * @private Push `_shadow` into the sun's shadow camera. Called on theme
   * change (extent/bias) and quality change (map size).
   */
  _configureShadow() {
    const sh = this._shadow;
    const sun = this.sun;
    const size = sh.mapSize | 0;
    /* TIGHT, HERO-FOLLOWING FRUSTUM (2026-09-04). The theme authors a
     * half-extent for the whole diorama (30-50 m); at 1024 that is a 6-10 cm
     * texel and at 512 an 18 cm one, which is why no station shot at the low
     * tier showed a shadow under Nim. The tier's `shadowDistance` now CAPS the
     * half-extent (0.64 x: low 28 -> 18 m, medium 45 -> 29 m, high 70 -> 45 m,
     * ultra 110 -> the theme's own), and because the box follows the hero
     * (`followShadow`, texel-snapped) the play space always has the sharpest
     * texels the map can give. Geometry outside the box is unshadowed and the
     * boundary is faded by the edge patch above, so a smaller box is never a
     * visible line — only a cheaper and sharper one. */
    const cap = numOr(this.quality && this.quality.shadowDistance, 0) * 0.64;
    sh.extent = cap > 8 ? Math.min(sh.themeExtent, Math.max(12, cap)) : sh.themeExtent;
    sun.castShadow = size > 0;
    if (size > 0) {
      if (sun.shadow.mapSize.x !== size || sun.shadow.mapSize.y !== size) {
        sun.shadow.mapSize.set(size, size);
        // A map that was already allocated at the old size has to be dropped
        // or three keeps rendering into the stale texture.
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
      sun.shadow.bias = sh.bias;
      sun.shadow.normalBias = sh.normalBias;
      const cam = sun.shadow.camera;
      cam.near = 1;
      cam.far = sh.extent * 4;
      cam.left = -sh.extent;
      cam.right = sh.extent;
      cam.top = sh.extent;
      cam.bottom = -sh.extent;
      cam.updateProjectionMatrix();
      sh.texelWorld = (sh.extent * 2) / size;
    } else {
      sh.texelWorld = 0;
    }
    sh.keyDist = sh.extent * 2.2;
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** @private Place every light around `_focus`. Allocation-free. */
  _placeLights() {
    const f = this._focus;
    const sh = this._shadow;
    this.sun.position.copy(f).addScaledVector(this._sunDir, sh.keyDist);
    this.sun.target.position.copy(f);
    this.fill.position.copy(f).addScaledVector(this._fillDir, 60);
    this.fill.target.position.copy(f);
    this.rim.position.copy(f).addScaledVector(this._rimDir, 70);
    this.rim.target.position.copy(f);
    this.hemi.position.set(f.x, f.y + 60, f.z);
    // Targets are children of the rig group, so their world matrices update
    // with the scene; the shadow camera reads target.matrixWorld on render.
  }

  /**
   * Slide the sun's shadow frustum (and the whole rig) to follow the hero.
   * Call EVERY FRAME with the hero's position (CONTRACT §6). The focus is
   * snapped to the shadow-map texel grid in light space so a moving frustum
   * does not shimmer every shadow edge. Allocation-free; ~30 flops.
   *
   * @param {{x:number,y:number,z:number}} pos world position (any {x,y,z})
   * @returns {Engine} this
   */
  followShadow(pos) {
    if (!pos) return this;
    _v3a.set(numOr(pos.x, 0), numOr(pos.y, 0), numOr(pos.z, 0));
    // the height-fog base rides a few metres under the hero's feet (see the
    // HEIGHT FOG patch): one typed-array write reaches every fogged program.
    CB_FOG_H[0] = _v3a.y - this._fogBelow;

    const tex = this._shadow.texelWorld;
    if (tex > 0) {
      // Light basis: dir toward the light; right/up span the ortho frustum.
      const d = this._sunDir;
      _lRight.crossVectors(_UP, d);
      if (_lRight.lengthSq() < 1e-6) _lRight.set(1, 0, 0);
      _lRight.normalize();
      _lUp.crossVectors(d, _lRight);
      const pr = _v3a.dot(_lRight);
      const pu = _v3a.dot(_lUp);
      const pd = _v3a.dot(d);
      const qr = Math.round(pr / tex) * tex;
      const qu = Math.round(pu / tex) * tex;
      _v3a.set(0, 0, 0)
        .addScaledVector(_lRight, qr)
        .addScaledVector(_lUp, qu)
        .addScaledVector(d, pd);
    }

    const f = this._focus;
    if (Math.abs(_v3a.x - f.x) > 1e-4 || Math.abs(_v3a.y - f.y) > 1e-4 || Math.abs(_v3a.z - f.z) > 1e-4) {
      f.copy(_v3a);
      this._placeLights();
    }
    this._shadowFollowed = true;
    return this;
  }

  /** The current shadow focus (read-only, do not mutate). */
  get shadowFocus() { return this._focus; }

  /* ====================================================================== */
  /* theme + environment                                                    */
  /* ====================================================================== */

  /**
   * Apply a ThemeDef (CONTRACT §15): background, fog, exposure, environment
   * intensity, colour grade + bloom (post), sun / fill / rim / hemi / ambient
   * colour-intensity-direction, shadow frustum, and the PMREM environment.
   * `themes.js` calls this from `applyTheme()` and then adds its sky dome on
   * top.
   *
   * Every field is optional and defended — a theme missing `fog` gets the
   * engine's default rather than a crash mid-course-load.
   *
   * @param {object} theme ThemeDef
   * @returns {Engine} this
   */
  setTheme(theme) {
    const t = theme || {};
    this.theme = t;

    /* ---- background ------------------------------------------------- */
    const bgSpec = t.bg !== undefined && t.bg !== null ? t.bg : dig(t, 'fog.color', 0x0b0a16);
    readColor(bgSpec, 0x0b0a16, this._bg);
    if (t.bg === null) {
      this.scene.background = null;
    } else {
      this.scene.background = this._bg;
    }
    this.renderer.setClearColor(this._bg, 1);

    /* ---- fog --------------------------------------------------------- */
    const fogSpec = t.fog;
    if (fogSpec === null) {
      this.scene.fog = null;
    } else {
      const fc = readColor(dig(t, 'fog.color', bgSpec), 0x0b0a16, _col);
      const density = numOr(dig(t, 'fog.density', 0), 0);
      const wantExp2 = density > 0 && dig(t, 'fog.type', 'exp2') !== 'linear';
      if (wantExp2) {
        if (!this.scene.fog || !this.scene.fog.isFogExp2) {
          this.scene.fog = new THREE.FogExp2(0x000000, density);
        }
        this.scene.fog.color.copy(fc);          // copy, never round-trip via hex
        this.scene.fog.density = density;
      } else {
        const near = numOr(dig(t, 'fog.near', 22), 22);
        const far = numOr(dig(t, 'fog.far', 340), 340);
        if (!this.scene.fog || !this.scene.fog.isFog) {
          this.scene.fog = new THREE.Fog(0x000000, near, far);
        }
        this.scene.fog.color.copy(fc);
        this.scene.fog.near = near;
        this.scene.fog.far = Math.max(near + 1, far);
      }
    }
    /* ---- height fog + aerial perspective (see the HEIGHT FOG patch) ------
     *   fog.heightBelow   metres under the hero's feet the full-density base sits
     *   fog.heightFalloff 1/m — how fast the density thins above the base
     *   fog.heightThin    0..1 — fraction of the density that thins with height
     *   fog.desat         0..1 — saturation lost by a fully fogged fragment
     *   fog.skyColor      the horizon colour high, far fragments fog toward
     *   fog.skyMix        0..1 — how far the high fog colour goes toward it
     * Defaults keep the theme's authored band at the hero's own height, so the
     * contrast gate's measurement is unchanged by construction. */
    this._fogBelow = clamp(numOr(dig(t, 'fog.heightBelow', FOG_BASE_BELOW_DEFAULT), FOG_BASE_BELOW_DEFAULT), 0, 40);
    CB_FOG_H[1] = clamp(numOr(dig(t, 'fog.heightFalloff', 0.07), 0.07), 0, 2);
    CB_FOG_H[2] = clamp(numOr(dig(t, 'fog.heightThin', 0.6), 0.6), 0, 1);
    CB_FOG_H[3] = clamp(numOr(dig(t, 'fog.desat', 0.35), 0.35), 0, 1);
    CB_FOG_H[0] = this._focus.y - this._fogBelow;
    readColor(dig(t, 'fog.skyColor', dig(t, 'sky.params.horizon', bgSpec)), 0x8fb0c8, _col);
    CB_FOG_SKY[0] = _col.r; CB_FOG_SKY[1] = _col.g; CB_FOG_SKY[2] = _col.b;
    CB_FOG_SKY[3] = fogSpec === null ? 0 : clamp(numOr(dig(t, 'fog.skyMix', 0.7), 0.7), 0, 1);
    /*   fog.skyCap        0..1 — ceiling on the altitude term of the sky mix
     *   fog.aerialColor   the aerial-perspective tint (default: skyColor x 0.78,
     *                     i.e. darker than the horizon so silhouettes hold)
     *   fog.aerialDensity 1/m of the slow band (default 0 = off)
     *   fog.aerialStrength 0..1 — how far the band may go toward its colour */
    CB_FOG_K[0] = clamp(numOr(dig(t, 'fog.skyCap', 1.0), 1.0), 0, 1);
    const aerSpec = dig(t, 'fog.aerialColor', null);
    if (aerSpec !== null && aerSpec !== undefined) readColor(aerSpec, 0x6f8fa4, _col);
    else _col.multiplyScalar(0.78);
    CB_FOG_AER[0] = _col.r; CB_FOG_AER[1] = _col.g; CB_FOG_AER[2] = _col.b;
    CB_FOG_AER[3] = fogSpec === null ? 0 : clamp(numOr(dig(t, 'fog.aerialDensity', 0), 0), 0, 0.2);
    CB_FOG_K[1] = clamp(numOr(dig(t, 'fog.aerialStrength', 1.0), 1.0), 0, 1);

    /* ---- exposure ---------------------------------------------------- */
    this.renderer.toneMappingExposure = clamp(numOr(t.exposure, 1.0), 0.05, 4);

    /* ---- post -------------------------------------------------------- */
    const post = this.post;
    if (post) {
      if (typeof post.setGrade === 'function') post.setGrade(t.grade || {});
      if (typeof post.setBloom === 'function') post.setBloom(t.bloom || {});
      if (typeof post.setHeat === 'function') post.setHeat(numOr(dig(t, 'heat', 0), 0), true);
    }

    /* ---- lights ------------------------------------------------------ */
    const L = readThemeLighting(t);

    this.sun.color.copy(L.keyColor);
    this.sun.intensity = L.keyIntensity;
    this._sunDir.copy(L.keyDir);

    this.fill.color.copy(L.fillColor);
    this.fill.intensity = L.fillIntensity;
    this._fillDir.copy(L.fillDir);

    this.rim.color.copy(L.rimColor);
    this.rim.intensity = L.rimIntensity;
    this._rimDir.copy(L.rimDir);

    this.hemi.color.copy(L.hemiSky);
    this.hemi.groundColor.copy(L.hemiGround);
    this.hemi.intensity = L.hemiIntensity;

    this.ambient.color.copy(L.ambientColor);
    this.ambient.intensity = L.ambientIntensity;

    /* ---- shadow frustum --------------------------------------------- */
    const sh = this._shadow;
    sh.themeExtent = clamp(numOr(dig(t, 'shadow.extent', SHADOW_DEFAULT.extent), SHADOW_DEFAULT.extent), 8, 200);
    sh.bias = clamp(numOr(dig(t, 'shadow.bias', SHADOW_DEFAULT.bias), SHADOW_DEFAULT.bias), -0.01, 0.01);
    sh.normalBias = clamp(numOr(dig(t, 'shadow.normalBias', SHADOW_DEFAULT.normalBias), SHADOW_DEFAULT.normalBias), 0, 0.5);
    this._configureShadow();
    this._placeLights();

    /* ---- environment ------------------------------------------------- */
    this.setEnvironment(t);

    this.events.emit('theme', t);
    return this;
  }

  /**
   * Bake the image-based lighting probe for a theme.
   *
   * Builds a procedural sky (gradient + horizon haze + an HDR sun disc) plus
   * three emissive light cards into an off-screen scene, then runs it through
   * PMREMGenerator so every PBR material in the game has a real, roughness-
   * filtered environment to reflect. Costs a handful of milliseconds and is
   * only ever called on a theme change, never per frame.
   *
   * @param {object} themeDef
   * @returns {THREE.Texture|null} the PMREM texture, also set as scene.environment
   */
  setEnvironment(themeDef) {
    const t = readThemeLighting(themeDef);

    if (this._pmrem === null) {
      this._pmrem = new THREE.PMREMGenerator(this.renderer);
      this._pmrem.compileCubemapShader();
    }

    this._ensureEnvScene();
    this._updateEnvScene(t);

    let rt = null;
    try {
      // sigma 0.035 pre-blurs the very sharp sun disc a touch so mirror-smooth
      // metals do not alias into a hard white dot as the camera turns.
      rt = this._pmrem.fromScene(this._envScene, 0.035, 0.1, 500);
    } catch (err) {
      console.error('[Engine] environment bake failed:', err);
      return this.envTexture;
    }

    if (this._envRT) this._envRT.dispose();
    this._envRT = rt;
    this.envTexture = rt.texture;

    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = t.envIntensity;

    this.events.emit('environment', rt.texture);
    return rt.texture;
  }

  /** @private Build the reusable off-screen environment scene once. */
  _ensureEnvScene() {
    if (this._envScene !== null) return;

    const scene = new THREE.Scene();

    const skyMat = new THREE.ShaderMaterial({
      name: 'CrestboundEnvSky',
      uniforms: {
        uZenith: { value: new THREE.Color(0x4a7fd6) },
        uHorizon: { value: new THREE.Color(0xc9dcf2) },
        uGround: { value: new THREE.Color(0x3d3326) },
        uSunColor: { value: new THREE.Color(0xffffff) },
        uSunDir: { value: new THREE.Vector3(-0.42, 0.86, 0.30) },
        uSunSize: { value: 0.055 },
        uSunPower: { value: 24 },
        uHaze: { value: 0.55 },
        uIntensity: { value: 1 },
      },
      vertexShader: ENV_VERT,
      fragmentShader: ENV_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      fog: false,
    });

    const sky = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), skyMat);
    sky.scale.setScalar(220);
    sky.frustumCulled = false;
    scene.add(sky);

    // Three emissive area cards: key, fill and a ground bounce. They are what
    // turns a flat gradient reflection into something with shape.
    const cardGeo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        toneMapped: false,
        fog: false,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(cardGeo, mat);
      mesh.frustumCulled = false;
      scene.add(mesh);
      this._envCards.push(mesh);
    }

    this._envScene = scene;
    this._envSky = sky;
    this._envCardGeo = cardGeo;
  }

  /** @private Push a normalised theme into the environment scene. */
  _updateEnvScene(t) {
    const u = this._envSky.material.uniforms;
    u.uZenith.value.copy(t.skyTop);
    u.uHorizon.value.copy(t.skyHorizon);
    u.uGround.value.copy(t.skyGround);
    u.uSunColor.value.copy(t.keyColor);
    u.uSunDir.value.copy(t.keyDir);
    u.uSunSize.value = t.sunSize;
    u.uSunPower.value = t.sunPower;
    u.uHaze.value = t.haze;
    u.uIntensity.value = t.skyIntensity;

    const cards = this._envCards;

    // --- key card: a big soft box light where the sun is
    const key = cards[0];
    _v3a.copy(t.keyDir).multiplyScalar(52);
    key.position.copy(_v3a);
    key.lookAt(0, 0, 0);
    key.scale.set(46, 30, 1);
    setHdrColor(key.material.color, t.keyColor, t.keyIntensity * 1.5);

    // --- fill card: opposite azimuth, low and cool
    _v3b.copy(t.fillDir);
    const fill = cards[1];
    fill.position.copy(_v3b).multiplyScalar(48);
    fill.lookAt(0, 0, 0);
    fill.scale.set(62, 34, 1);
    setHdrColor(fill.material.color, t.fillColor, t.fillIntensity * 0.85);

    // --- bounce card: the floor, facing straight up
    const bounce = cards[2];
    bounce.position.set(0, -38, 0);
    bounce.rotation.set(-Math.PI * 0.5, 0, 0);
    bounce.scale.set(130, 130, 1);
    _v3c.set(
      t.skyGround.r * 0.6 + t.hemiGround.r * 0.5,
      t.skyGround.g * 0.6 + t.hemiGround.g * 0.5,
      t.skyGround.b * 0.6 + t.hemiGround.b * 0.5,
    );
    bounce.material.color.setRGB(
      _v3c.x * t.bounceIntensity,
      _v3c.y * t.bounceIntensity,
      _v3c.z * t.bounceIntensity,
    );
  }

  /* ====================================================================== */
  /* camera                                                                 */
  /* ====================================================================== */

  /**
   * Set the world camera's vertical FOV. The follow camera calls this every
   * frame while a run / peek / underwater kick is running.
   * @param {number} f degrees
   * @returns {Engine} this
   */
  setFov(f) {
    const v = clamp(numOr(f, this.baseFov), 30, 120);
    if (Math.abs(this.camera.fov - v) > 1e-4) {
      this.camera.fov = v;
      this.camera.updateProjectionMatrix();
    }
    return this;
  }

  /**
   * Set the resting FOV (the value kicks are measured against). Defaults to
   * TUNE.cam.fov.
   * @param {number} f degrees
   */
  setBaseFov(f) {
    this.baseFov = clamp(numOr(f, TUNE.cam.fov), 30, 120);
    return this;
  }

  /**
   * Adjust the far plane — Rime Spire wants to see further than the Foundry.
   * @param {number} far
   */
  setDrawDistance(far) {
    this.camera.far = clamp(numOr(far, DEFAULT_FAR), 40, 4000);
    this.camera.updateProjectionMatrix();
    return this;
  }

  /* ====================================================================== */
  /* quality                                                                */
  /* ====================================================================== */

  /**
   * Apply a QUALITY preset to the renderer, the sun's shadow map and the post
   * chain.
   * @param {object} [q] defaults to the current Settings preset
   */
  setQuality(q) {
    const preset = q || Settings.quality();
    this.quality = preset;

    this.renderer.shadowMap.enabled = preset.shadowMap > 0;
    this.renderer.shadowMap.type = shadowFilterType(preset);
    this._shadow.mapSize = preset.shadowMap | 0;
    this._configureShadow();

    this._pr = Settings.pixelRatio();
    this._tierScale = clamp(numOr(preset.renderScale, 1), MIN_RENDER_SCALE, 1);
    /* A tier change re-seeds the scale at the tier value: the dynamic
       controller's band is measured from the NEW tier, not carried over. */
    this.renderScale = this._tierScale;
    this._scaleAccum = 0;
    this._aboveT = 0;
    this._scaleRescued = false;
    this._allocScale = this._tierScale;
    this.renderer.setPixelRatio(this._pr);
    this.renderer.setSize(this.size.w, this.size.h, true);

    if (this.post) {
      this.post.setRenderFraction(1);
      this.post.setQuality(preset, this._allocScale);
      this._pushSharpen();
    }

    this.events.emit('quality', preset);
    return this;
  }

  /**
   * @private RCAS strength for the PresentPass, scaled by how far below native
   * the frame is rendered: at the LOW tier's 0.60 the upscale is what turns
   * sign text to mush, and a contrast-adaptive sharpen folded into that same
   * upscale is the cheapest perceived-sharpness the tier can buy. At 1.0 only
   * a whisper remains.
   */
  _pushSharpen() {
    if (!this.post || typeof this.post.setSharpen !== 'function') return;
    /* 0.60 -> 0.46, 0.45 -> 0.60, 0.72 -> 0.35, 1.0 -> 0.08. The earlier
     * 0.12 + (1 - s) * 1.45 put 0.70 on the LOW tier, and at a 1.67x
     * upscale that strength drew the source texel grid onto every edge
     * (`_shots/imgab_keep_sharp_crop.png` vs `_s40_crop.png`, 2026-09-04). */
    this.post.setSharpen(clamp(0.08 + (1 - this.renderScale) * 0.95, 0, 0.62));
  }

  /** @private Settings subscriber. */
  _onSettingsChanged(s, changed) {
    for (let i = 0; i < changed.length; i++) {
      if (changed[i] === 'quality') this.setQuality(Settings.quality());
    }
  }

  /* ====================================================================== */
  /* sizing                                                                 */
  /* ====================================================================== */

  /** @private @returns {{w:number,h:number}} the container's CSS pixel size */
  _measure() {
    const el = this.container;
    let w = el ? el.clientWidth : 0;
    let h = el ? el.clientHeight : 0;
    if (!(w > 0)) w = (typeof innerWidth === 'number' && innerWidth) || 1280;
    if (!(h > 0)) h = (typeof innerHeight === 'number' && innerHeight) || 720;
    return { w: Math.max(1, Math.floor(w)), h: Math.max(1, Math.floor(h)) };
  }

  /** @private Defer the actual resize to the next frame (RO fires in bursts). */
  _queueResize() {
    this._resizeQueued = true;
    if (!this.running) {
      // No frame loop to piggy-back on (title screen before start, or paused
      // with the loop stopped) — do it on the next macrotask instead.
      setTimeout(() => {
        if (this._resizeQueued) { this._resizeQueued = false; this.resize(); }
      }, 0);
    }
  }

  /**
   * Set the internal render scale (CONTRACT hard rule 4).
   *
   * The composer's targets are resized; the drawing buffer and the canvas are
   * NOT — `Post`'s PresentPass upsamples to them. `camera.aspect` is unchanged
   * (it is a ratio of CSS pixels), and every internal pass resizes with the
   * targets because `Post.resize()` reads `renderer.getPixelRatio()` times
   * the internal scale.
   *
   * @param {number} v 0..1 fraction of CSS pixels
   * @returns {Engine} this
   */
  setRenderScale(v) {
    const next = clamp(numOr(v, this.renderScale), MIN_RENDER_SCALE, 1);
    if (Math.abs(next - this.renderScale) < 0.004) return this;
    this.renderScale = next;
    const subrect = !!(this.post && typeof this.post.setRenderFraction === 'function');
    /* FREE PATH. At or below the tier scale the buffers are already big enough:
     * the SCENE moves into a sub-rectangle of them and one blit brings it back
     * up (Post.setRenderFraction). Nothing is allocated, so a step costs a
     * uniform write instead of the measured 141-646 ms of
     * EffectComposer.setSize() -- which is what made this controller
     * unshippable and what made camcheck's long jump drop a queued input. */
    if (subrect && next <= this._tierScale + 0.004) {
      /* If something forced the buffers ABOVE the tier (a quality change, the
       * perf gate's native-1.0 pass), come back to the tier allocation first,
       * or the fraction would be measured against a size nobody ships. */
      if (Math.abs(this._allocScale - this._tierScale) > 0.004) {
        this._allocScale = this._tierScale;
        this.post.setInternalScale(this._tierScale);
      }
      this.post.setRenderFraction(next / this._tierScale);
      this._pushSharpen();
      this.events.emit('renderscale', next);
      return this;
    }
    /* ABOVE the tier: the composer targets really do have to grow.
     * Reallocating path, kept for quality changes and for the perf gate's
     * native-1.0 INFO pass. The drawing buffer is native already. */
    if (subrect) this.post.setRenderFraction(1);
    this._allocScale = next;
    if (this.post) this.post.setInternalScale(next);
    this._pushSharpen();
    this.events.emit('renderscale', next);
    return this;
  }

  /** The tier's authored render scale, before the dynamic controller. */
  get tierRenderScale() { return this._tierScale; }

  /**
   * @private The DYNAMIC controller. Holds `renderScaleTargetFps` by moving the
   * scale within RENDER_SCALE_BAND of the tier value, at most one
   * RENDER_SCALE_STEP per RENDER_SCALE_STEP_PERIOD second, never while the
   * game's guard says hold (airborne), and only raising after
   * RENDER_SCALE_RAISE_HOLD seconds continuously above target.
   *
   * Allocation-free: four numbers and a comparison.
   * @param {number} dt seconds of WALL time
   */
  _autoRenderScale(dt) {
    if (!(dt > 0)) return;
    const fps = this.stats.fps;
    const target = this.renderScaleTargetFps;

    if (fps >= target + RENDER_SCALE_RAISE_MARGIN) this._aboveT += dt;
    else this._aboveT = 0;

    this._scaleAccum += dt;
    if (this._scaleAccum < RENDER_SCALE_STEP_PERIOD) return;

    /* DOWNWARD the controller may cross tier boundaries, all the way to
       MIN_RENDER_SCALE: the starting tier is a GUESS (settings.js detectQuality
       reads the GPU, but an unrecognised renderer is still a guess), and a
       controller that can only reach 0.15 below a wrong guess just sits at its
       floor missing the target. Every step below the tier is free -- the scene
       moves into a sub-rectangle of buffers that are already allocated.

       UPWARD it stops at the tier value. Rendering ABOVE the tier means
       allocating every composer target larger than the tier needs and paying
       that in the post chain on every frame at the tier value -- the one case
       that has to stay free (see setRenderScale). `_tierScale - BAND` is still
       where the controller sits in normal service; past it is the rescue. */
    const lo = MIN_RENDER_SCALE;
    const hi = this._tierScale;
    let want = this.renderScale;
    if (fps < target) want = this.renderScale - RENDER_SCALE_STEP;
    else if (this._aboveT >= RENDER_SCALE_RAISE_HOLD) want = this.renderScale + RENDER_SCALE_STEP;
    if (want < lo) want = lo;
    if (want > hi) want = hi;
    if (Math.abs(want - this.renderScale) < 0.004) return;

    if (this.renderScaleGuard !== null) {
      let hold = false;
      try { hold = !!this.renderScaleGuard(); } catch (err) { hold = false; }
      if (hold) return;   // mid-jump: try again next second
    }

    this._scaleAccum = 0;
    if (want > this.renderScale) this._aboveT = 0;
    this.setRenderScale(want);

    /* Crossing BELOW the comfort band means the starting tier was too high for
       this machine — the one fact the detector could not know. Say it once, so
       a wrong guess is visible in a log instead of only in the frame rate. */
    const comfort = this._tierScale - RENDER_SCALE_BAND;
    if (!this._scaleRescued && this.renderScale < comfort - 0.004) {
      this._scaleRescued = true;
      console.warn('[Engine] render scale ' + this.renderScale.toFixed(2) +
        ' is below the ' + this.quality.id + ' tier band (' + comfort.toFixed(2) +
        '-' + this._tierScale.toFixed(2) + ') — this machine wants a lower quality tier.');
      this.events.emit('renderscale-rescue', this.renderScale);
    }
  }

  /**
   * Re-measure the container and push the new size into the camera, renderer
   * and post chain. Safe to call at any time; a no-op when nothing changed.
   */
  resize() {
    const s = this._measure();
    const pr = Settings.pixelRatio();

    if (s.w === this.size.w && s.h === this.size.h && pr === this._pr) return;

    this.size.w = s.w;
    this.size.h = s.h;
    this._pr = pr;

    const aspect = s.w / s.h;

    // native drawing buffer; the composer's internal scale lives in Post
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(s.w, s.h, true);

    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    if (this.post) this.post.resize(s.w, s.h);

    this.events.emit('resize', s.w, s.h);
  }

  /* ====================================================================== */
  /* frame callbacks                                                        */
  /* ====================================================================== */

  /**
   * Register a per-frame callback. Callbacks run in REGISTRATION ORDER, and
   * they run BEFORE the main loop function each frame — treat them as
   * pre-update hooks (input polling, timers), not as post-render hooks.
   * @param {(dt:number, elapsed:number) => void} fn
   * @returns {Function} fn
   */
  onFrame(fn) {
    if (typeof fn === 'function' && this._frameCbs.indexOf(fn) === -1) this._frameCbs.push(fn);
    return fn;
  }

  /** @param {Function} fn */
  offFrame(fn) {
    const i = this._frameCbs.indexOf(fn);
    if (i !== -1) this._frameCbs.splice(i, 1);
  }

  /* ====================================================================== */
  /* the loop                                                               */
  /* ====================================================================== */

  /**
   * Start the requestAnimationFrame loop.
   *
   * Each frame: flush any pending resize, compute a clamped dt, run the
   * registered frame callbacks in order, then call `loopFn(dt, elapsed)`. The
   * loop function is responsible for calling `engine.render(dt)` — that is
   * deliberate, so the game can update, then render, then do post-render work
   * (HUD) in exactly the order it wants.
   *
   * @param {(dt:number, elapsed:number) => void} loopFn
   */
  start(loopFn) {
    if (this.running) this.stop();
    this._loopFn = typeof loopFn === 'function' ? loopFn : null;
    this._last = nowMs();
    this._loopErrors = 0;
    this.running = true;

    const tick = (ts) => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(tick);

      if (this._resizeQueued) { this._resizeQueued = false; this.resize(); }

      const now = typeof ts === 'number' ? ts : nowMs();
      const rawMs = now - this._last;
      let dt = rawMs / 1000;
      this._last = now;
      if (!(dt > 0)) dt = 0;
      /* Presentation clock first: real elapsed time, capped only against a
         tab-away. Then the simulation clamp. */
      let raw = dt;
      if (raw > MAX_PRESENT_DT) raw = MAX_PRESENT_DT;
      this.rawDt = raw;
      this.rawMs = raw * 1000;
      if (dt > MAX_DT) dt = MAX_DT;

      this.dt = dt;
      this.elapsed += dt;
      this.frame++;
      this._recordInterval(rawMs);

      const t0 = nowMs();
      const cbs = this._frameCbs;
      for (let i = 0; i < cbs.length; i++) {
        try {
          cbs[i](dt, this.elapsed);
        } catch (err) {
          console.error('[Engine] frame callback threw:', err);
        }
      }

      if (this._loopFn !== null) {
        try {
          this._loopFn(dt, this.elapsed);
          this._loopErrors = 0;
        } catch (err) {
          this._loopErrors++;
          console.error('[Engine] game loop threw (' + this._loopErrors + '):', err);
          if (this._loopErrors >= 60) {
            console.error('[Engine] 60 consecutive loop failures — halting the frame loop.');
            this.stop();
          }
        }
      }

      this.stats.frameMs = this._msAvg.push(nowMs() - t0);
      if (dt > 0) this.stats.fps = Math.round(this._fpsAvg.push(1 / dt));
      if (this.renderScaleAuto) this._autoRenderScale(this.rawDt);
    };

    this._raf = requestAnimationFrame(tick);
  }

  /** Stop the rAF loop. `start()` may be called again afterwards. */
  stop() {
    this.running = false;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
  }

  /**
   * @private Record one frame interval into the p99 window and refresh
   * `stats.p99Ms` / `stats.maxMs` / `stats.hitches`. For a 120-sample window
   * the 99th percentile is the SECOND-largest sample, so this is one linear
   * scan and no sort — allocation-free and ~120 comparisons per frame.
   */
  _recordInterval(ms) {
    if (!(ms > 0) || ms > 5000) return;      // first frame / tab return: not a hitch
    const buf = this._intervals;
    buf[this._intI] = ms;
    this._intI = (this._intI + 1) % P99_WINDOW;
    if (this._intN < P99_WINDOW) this._intN++;

    let m1 = 0, m2 = 0;
    const n = this._intN;
    for (let i = 0; i < n; i++) {
      const v = buf[i];
      if (v > m1) { m2 = m1; m1 = v; }
      else if (v > m2) m2 = v;
    }
    const st = this.stats;
    st.maxMs = m1;
    st.p99Ms = n >= 2 ? m2 : m1;

    const programs = this.renderer.info.programs ? this.renderer.info.programs.length : 0;
    if (ms > HITCH_MS) {
      st.hitches++;
      st.hitchProgramDelta = programs - this._prevPrograms;
    }
    this._prevPrograms = programs;
  }

  /** Zero the hitch counter and the p99 window (course load, perfcheck start). */
  resetStats() {
    this._intervals.fill(0);
    this._intI = 0;
    this._intN = 0;
    this._fpsAvg.reset();
    this._msAvg.reset();
    this._renderAvg.reset();
    const st = this.stats;
    st.hitches = 0;
    st.hitchProgramDelta = 0;
    st.p99Ms = 0;
    st.maxMs = 0;
    this._prevPrograms = this.renderer.info.programs ? this.renderer.info.programs.length : 0;
    return this;
  }

  /**
   * Run `fn` in fixed sub-steps of `engine.fixedStep`, carrying the remainder
   * to the next call. This is what makes the player controller identical at
   * 30, 60 and 240 fps.
   *
   *   engine.stepFixed(dt, (h) => player.step(h));
   *
   * Each `key` keeps its own accumulator, so two systems can both use fixed
   * stepping without eating each other's remainder. `engine.fixedAlpha` holds
   * the leftover fraction after the most recent call, for render interpolation.
   *
   * @param {number} dt seconds of real time to consume
   * @param {(h:number) => void} fn called once per sub-step with h = fixedStep
   * @param {string} [key='main'] accumulator id
   * @returns {number} how many sub-steps ran
   */
  stepFixed(dt, fn, key) {
    if (typeof fn !== 'function') return 0;

    const h = this.fixedStep;
    const k = key === undefined ? 'main' : key;

    let acc = this._accs.get(k);
    if (acc === undefined) acc = 0;

    let d = dt;
    if (!(d > 0)) d = 0;
    else if (d > MAX_DT) d = MAX_DT;
    acc += d;

    let steps = 0;
    while (acc >= h && steps < this.maxSubSteps) {
      fn(h);
      acc -= h;
      steps++;
    }

    // Whatever is left over after the sub-step cap is dropped rather than
    // banked: banking it turns one slow frame into a death spiral.
    if (acc >= h) acc %= h;

    this._accs.set(k, acc);
    this.fixedAlpha = acc / h;
    return steps;
  }

  /** Zero a fixed-step accumulator (call on respawn / course load). */
  resetFixed(key) {
    if (key === undefined) this._accs.clear();
    else this._accs.set(key, 0);
    this.fixedAlpha = 0;
  }

  /**
   * Draw one frame through the post chain and refresh `engine.stats`.
   * If nothing called `followShadow()` since the last render, the shadow
   * frustum follows the camera so there is always coverage where the player
   * is looking.
   * @param {number} dt seconds
   */
  render(dt) {
    if (!this._shadowFollowed) {
      _camPos.setFromMatrixPosition(this.camera.matrixWorld);
      this.followShadow(_camPos);
    }
    this._shadowFollowed = false;

    const t0 = nowMs();
    const info = this.renderer.info;
    info.reset();

    if (this.post) this.post.render(dt);
    else this.renderer.render(this.scene, this.camera);

    const stats = this.stats;
    stats.drawCalls = info.render.calls;
    stats.tris = info.render.triangles;
    stats.programs = info.programs ? info.programs.length : 0;
    stats.geometries = info.memory.geometries;
    stats.textures = info.memory.textures;
    stats.renderMs = this._renderAvg.push(nowMs() - t0);
  }

  /**
   * Pre-warm every shader program before frame 1 (doctrine §3): compile once
   * with the post chain's HDR target BOUND, then again against the canvas,
   * because programs are keyed per target-format variant and a canvas-only
   * compile leaves the composer's variants to hitch on first use.
   * Call after the course and hero are in the scene. Resolves when done;
   * never throws (a failed warm-up only costs a hitch later).
   * @returns {Promise<number>} programs after warm-up
   */
  async warmup() {
    const r = this.renderer;
    try {
      let rt = null;
      const c = this.composer;
      if (c && c.renderTarget1) rt = c.renderTarget1;
      if (rt) {
        r.setRenderTarget(rt);
        if (typeof r.compileAsync === 'function') await r.compileAsync(this.scene, this.camera);
        else r.compile(this.scene, this.camera);
        r.setRenderTarget(null);
      }
      if (typeof r.compileAsync === 'function') await r.compileAsync(this.scene, this.camera);
      else r.compile(this.scene, this.camera);
    } catch (err) {
      try { r.setRenderTarget(null); } catch (e) { /* ignore */ }
      console.warn('[Engine] shader warm-up failed:', err);
    }
    const n = r.info.programs ? r.info.programs.length : 0;
    this._prevPrograms = n;
    return n;
  }

  /* ====================================================================== */
  /* teardown                                                               */
  /* ====================================================================== */

  /** Release every listener, GPU resource and DOM node this engine owns. */
  dispose() {
    this.stop();

    Settings.off(this._onSettings);
    window.removeEventListener('resize', this._onWinResize);
    window.removeEventListener('orientationchange', this._onWinResize);
    document.removeEventListener('visibilitychange', this._onVisibility);
    if (this._ro) { try { this._ro.disconnect(); } catch (e) { /* ignore */ } this._ro = null; }

    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this._onContextLost);
    canvas.removeEventListener('webglcontextrestored', this._onContextRestored);

    if (this.post) { this.post.dispose(); this.post = null; }

    if (this._envRT) { this._envRT.dispose(); this._envRT = null; }
    if (this._pmrem) { this._pmrem.dispose(); this._pmrem = null; }
    if (this._envScene) {
      if (this._envSky) {
        this._envSky.geometry.dispose();
        this._envSky.material.dispose();
      }
      for (let i = 0; i < this._envCards.length; i++) this._envCards[i].material.dispose();
      if (this._envCardGeo) this._envCardGeo.dispose();
      this._envCards.length = 0;
      this._envScene = null;
      this._envSky = null;
      this._envCardGeo = null;
    }

    if (this.sun.shadow && this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.sun.dispose(); this.fill.dispose(); this.rim.dispose();
    this.hemi.dispose(); this.ambient.dispose();
    if (this.lights.parent) this.lights.parent.remove(this.lights);

    this.scene.environment = null;
    this.envTexture = null;

    this._frameCbs.length = 0;
    this._accs.clear();
    this.events.clear();

    this.renderer.dispose();
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
  }
}

/* ===========================================================================
 * helpers
 * ======================================================================== */

/**
 * @param {HTMLElement|string} c
 * @returns {HTMLElement}
 */
function resolveContainer(c) {
  if (typeof c === 'string') {
    const el = document.getElementById(c) || document.querySelector(c);
    if (el) return el;
    throw new Error('Engine: no element matched "' + c + '"');
  }
  if (c && c.appendChild) return c;
  const fallback = document.getElementById('game-container');
  if (fallback) return fallback;
  throw new Error('Engine: a container element is required');
}

/**
 * Create the WebGL2 context ourselves so the failure is a clean, explainable
 * one rather than a three.js internal throw, and so the renderer reuses this
 * exact context instead of burning a second one.
 * @param {HTMLCanvasElement} canvas
 * @returns {WebGL2RenderingContext|null}
 */
function probeWebGL2(canvas) {
  try {
    return canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: false,
      desynchronized: false,
    });
  } catch (e) {
    return null;
  }
}

/** Reveal the static #nogpu panel authored in index.html and hide the boot screen. */
function revealNoGpu() {
  try {
    const el = document.getElementById('nogpu');
    if (el) el.style.display = 'flex';
    const boot = document.getElementById('boot');
    if (boot) boot.classList.add('gone');
  } catch (e) { /* nothing left to do */ }
}

/**
 * Read a colour from a theme field: hex number, '#rrggbb', [r,g,b] or a
 * THREE.Color. Colour-managed (sRGB -> working space) because these ARE
 * colours, unlike the post-chain tint multiplier.
 * @param {*} v @param {number} fallbackHex @param {THREE.Color} out
 * @returns {THREE.Color} out
 */
function readColor(v, fallbackHex, out) {
  try {
    if (v === undefined || v === null) return out.setHex(fallbackHex);
    if (typeof v === 'number' && isFinite(v)) return out.setHex(v | 0);
    if (typeof v === 'string') return out.setStyle(v.trim());
    if (Array.isArray(v)) return out.setRGB(numOr(v[0], 0), numOr(v[1], 0), numOr(v[2], 0));
    if (typeof v === 'object' && typeof v.r === 'number') return out.setRGB(v.r, v.g, v.b);
  } catch (e) { /* fall through */ }
  return out.setHex(fallbackHex);
}

/**
 * Write `src * intensity` into `dst`, allowing HDR values above 1. Colour
 * objects are unclamped floats, and the environment bake renders to a
 * half-float target, so >1 survives all the way into the PMREM chain.
 * @param {THREE.Color} dst @param {THREE.Color} src @param {number} intensity
 */
function setHdrColor(dst, src, intensity) {
  const k = intensity > 0 ? intensity : 0;
  dst.setRGB(src.r * k, src.g * k, src.b * k);
}

/**
 * Read a direction from a theme field. Accepts [x,y,z], {x,y,z} or a Vector3,
 * always returns a NORMALISED copy in `out`. Directions point TOWARD the light.
 * @param {*} v @param {THREE.Vector3} out @param {number} dx @param {number} dy @param {number} dz
 * @returns {THREE.Vector3} out
 */
function readDir(v, out, dx, dy, dz) {
  if (Array.isArray(v) && v.length >= 3) out.set(numOr(v[0], dx), numOr(v[1], dy), numOr(v[2], dz));
  else if (v && typeof v === 'object' && typeof v.x === 'number') out.set(v.x, v.y, v.z);
  else out.set(dx, dy, dz);
  if (out.lengthSq() < 1e-8) out.set(dx, dy, dz);
  return out.normalize();
}

/**
 * Normalise whatever shape `themes.js` hands us into the exact set of values
 * the light rig and the environment bake need. Every read is defended: a
 * theme is data from another module and must never be able to throw inside a
 * course load. Returns a module-scope scratch object (no allocation after the
 * first call).
 *
 * ThemeDef lights (CONTRACT §15): {key:{color,intensity,dir}, fill:{…},
 * rim:{…}, ambient:{color,intensity}, hemi:{skyColor|color, groundColor,
 * intensity}}. A missing fill/rim gives intensity 0 (the light stays in the
 * pool so the shader permutation never changes).
 *
 * @param {object} themeDef
 * @returns {object}
 */
function readThemeLighting(themeDef) {
  const t = themeDef || {};
  const out = readThemeLighting._out || (readThemeLighting._out = {
    skyTop: new THREE.Color(), skyHorizon: new THREE.Color(), skyGround: new THREE.Color(),
    keyColor: new THREE.Color(), fillColor: new THREE.Color(), rimColor: new THREE.Color(),
    ambientColor: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(),
    keyDir: new THREE.Vector3(), fillDir: new THREE.Vector3(), rimDir: new THREE.Vector3(),
    keyIntensity: 1, fillIntensity: 1, rimIntensity: 0, ambientIntensity: 0.3, hemiIntensity: 0.5,
    bounceIntensity: 1, envIntensity: 1,
    sunSize: 0.055, sunPower: 24, haze: 0.55, skyIntensity: 1,
  });

  const bg = t.bg !== undefined && t.bg !== null ? t.bg : dig(t, 'fog.color', 0x4a7fd6);

  readColor(dig(t, 'sky.params.top', dig(t, 'sky.params.zenith', bg)), 0x4a7fd6, out.skyTop);
  readColor(dig(t, 'sky.params.horizon', dig(t, 'fog.color', bg)), 0xc9dcf2, out.skyHorizon);
  readColor(dig(t, 'sky.params.bottom', dig(t, 'sky.params.ground', 0x3d3326)), 0x3d3326, out.skyGround);

  readColor(dig(t, 'lights.key.color', 0xffffff), 0xffffff, out.keyColor);
  readColor(dig(t, 'lights.fill.color', dig(t, 'lights.rim.color', 0x6f8fd0)), 0x6f8fd0, out.fillColor);
  readColor(dig(t, 'lights.rim.color', 0xffffff), 0xffffff, out.rimColor);
  readColor(dig(t, 'lights.ambient.color', 0x404860), 0x404860, out.ambientColor);
  readColor(dig(t, 'lights.hemi.skyColor', dig(t, 'lights.hemi.color', out.skyTop)), 0x8fb4ff, out.hemiSky);
  readColor(dig(t, 'lights.hemi.groundColor', out.skyGround), 0x4d3a2a, out.hemiGround);

  readDir(dig(t, 'lights.key.dir', null), out.keyDir, -0.42, 0.86, 0.30);
  // default fill: opposite azimuth to the key, low
  readDir(dig(t, 'lights.fill.dir', null), out.fillDir, -out.keyDir.x, Math.max(0.12, out.keyDir.y * 0.30), -out.keyDir.z);
  // default rim: behind and above relative to the key's azimuth
  readDir(dig(t, 'lights.rim.dir', null), out.rimDir, out.keyDir.z, 0.35, -out.keyDir.x);

  out.keyIntensity = clamp(numOr(dig(t, 'lights.key.intensity', 2.2), 2.2), 0, 20);
  out.fillIntensity = clamp(numOr(dig(t, 'lights.fill.intensity', 0.55), 0.55), 0, 20);
  out.rimIntensity = clamp(numOr(dig(t, 'lights.rim.intensity', 0), 0), 0, 20);
  out.ambientIntensity = clamp(numOr(dig(t, 'lights.ambient.intensity', 0.3), 0.3), 0, 20);
  out.hemiIntensity = clamp(numOr(dig(t, 'lights.hemi.intensity', 0.5), 0.5), 0, 20);
  out.bounceIntensity = clamp(numOr(dig(t, 'lights.ambient.intensity', 0.6), 0.6), 0, 20) + 0.3;
  out.envIntensity = clamp(numOr(t.envIntensity, 1.0), 0, 6);

  out.sunSize = clamp(numOr(dig(t, 'sky.params.sunSize', 0.055), 0.055), 0.004, 0.5);
  out.sunPower = clamp(numOr(dig(t, 'sky.params.sunPower', 24), 24), 1, 400);
  out.haze = clamp(numOr(dig(t, 'sky.params.haze', 0.55), 0.55), 0, 4);
  out.skyIntensity = clamp(numOr(dig(t, 'sky.params.intensity', 1), 1), 0, 8);

  return out;
}

/** Re-exported so callers do not have to reach into settings.js for the cap. */
export { DPR_CEILING };
