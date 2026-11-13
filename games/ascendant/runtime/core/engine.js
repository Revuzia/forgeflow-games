/**
 * ASCENDANT — runtime/core/engine.js
 * ---------------------------------------------------------------------------
 * The renderer spine: WebGL2 context, main scene + camera, the first-person
 * viewmodel overlay pair, the procedural PMREM environment, the frame loop and
 * the fixed-timestep driver the player controller runs on.
 *
 * Design notes worth knowing before you change anything here:
 *
 *  - The renderer is created with antialias:false ON PURPOSE. MSAA cannot be
 *    combined with the post chain's HDR targets, so SMAA does the job instead
 *    and only above the `medium` quality tier.
 *
 *  - `setEnvironment()` bakes a PMREM probe from a procedural sky scene. This
 *    is the single biggest lever between "plastic" and "AAA": without an
 *    environment map, a metalness-1 material has nothing to reflect and renders
 *    as flat grey. Every theme change re-bakes it, which costs a few ms once.
 *
 *  - There are TWO scene/camera pairs. `scene`/`camera` are the world;
 *    `overlayScene`/`overlayCamera` are the arms. The post chain draws the
 *    overlay with a cleared depth buffer, before bloom, so the viewmodel gets
 *    the same grade and glow as the world but can never intersect it.
 *
 *  - Frame dt is clamped to 1/20 s. A tab that was backgrounded for a minute
 *    must not teleport the player through a wall on the frame it returns.
 */

import * as THREE from 'three';

import { Settings, DPR_CEILING } from './settings.js';
import { Emitter, RollingAverage, clamp, dig, nowMs, numOr } from './util.js';
import { Post } from '../fx/post.js';

/* ---- module-scope scratch: nothing in an update path may allocate -------- */
const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _v3c = new THREE.Vector3();
const _col = new THREE.Color();

const DEFAULT_FAR = 900;
const DEFAULT_NEAR = 0.05;
const OVERLAY_FOV = 55;
const OVERLAY_NEAR = 0.01;
const OVERLAY_FAR = 6;
const MAX_DT = 1 / 20;

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

    /** general-purpose bus: 'resize'(w,h), 'quality'(preset), 'visibility'(bool), 'theme'(def) */
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
      throw new Error('ASCENDANT requires WebGL 2, which this browser did not provide. ' +
        'Enable hardware acceleration (chrome://settings/system) and reload.');
    }

    this.container.appendChild(canvas);

    /** @type {THREE.WebGLRenderer} */
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      context: gl,
      antialias: false,                 // SMAA in the post chain instead
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
    this.renderer.shadowMap.enabled = !!this.quality.shadowMap;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = true;
    this.renderer.autoClear = true;
    this.renderer.setClearColor(0x05070d, 1);
    // The composer issues several draws per frame; manual reset gives us a
    // whole-frame draw-call number instead of "whatever the last pass did".
    this.renderer.info.autoReset = false;

    /* ------------------------------------------------------------- scene */
    /** @type {THREE.Scene} */
    this.scene = new THREE.Scene();
    this.scene.name = 'world';
    this.scene.matrixWorldAutoUpdate = true;

    /** @type {THREE.Scene} first-person viewmodel overlay */
    this.overlayScene = new THREE.Scene();
    this.overlayScene.name = 'viewmodel';

    /* ------------------------------------------------------------ camera */
    const st = Settings.get();
    const size = this._measure();
    this.size = { w: size.w, h: size.h };

    /** @type {THREE.PerspectiveCamera} */
    this.camera = new THREE.PerspectiveCamera(st.fov, size.w / size.h, DEFAULT_NEAR, DEFAULT_FAR);
    this.camera.name = 'player';
    this.camera.rotation.order = 'YXZ';   // yaw then pitch: no roll surprises
    this.scene.add(this.camera);

    /** @type {THREE.PerspectiveCamera} narrow FOV so arms keep their volume */
    this.overlayCamera = new THREE.PerspectiveCamera(OVERLAY_FOV, size.w / size.h, OVERLAY_NEAR, OVERLAY_FAR);
    this.overlayCamera.name = 'viewmodelCam';
    this.overlayScene.add(this.overlayCamera);

    /** the base FOV before any sprint / bounce kick from FPCamera */
    this.baseFov = st.fov;

    /* --------------------------------------------------------- pixel size */
    this._pr = Settings.pixelRatio();
    this.renderer.setPixelRatio(this._pr);
    this.renderer.setSize(size.w, size.h, true);

    /* ---------------------------------------------------------------- post */
    /** @type {Post} */
    this.post = new Post(
      this.renderer, this.scene, this.camera,
      this.size, Settings.quality(),
      { scene: this.overlayScene, camera: this.overlayCamera },
    );

    /* ------------------------------------------------------------ timing */
    /** @type {THREE.Clock} */
    this.clock = new THREE.Clock(true);
    /** fixed physics step — the player controller runs on this, not on dt */
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
    /** @type {{fps:number, drawCalls:number, tris:number, frameMs:number, programs:number, geometries:number, textures:number}} */
    this.stats = {
      fps: 60, drawCalls: 0, tris: 0, frameMs: 0,
      programs: 0, geometries: 0, textures: 0,
    };
    this._fpsAvg = new RollingAverage(30);
    this._msAvg = new RollingAverage(30);

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
    this._bg = new THREE.Color(0x05070d);

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
  /* theme + environment                                                    */
  /* ====================================================================== */

  /**
   * Apply a ThemeDef: fog, background, exposure, colour grade, bloom and the
   * PMREM environment. `themes.js` calls this from `applyTheme()` and then adds
   * its own lights and sky dome on top.
   *
   * Every field is optional and defended — a theme missing `fog` gets the
   * engine's default rather than a crash mid-level-load.
   *
   * @param {object} theme ThemeDef
   * @returns {Engine} this
   */
  setTheme(theme) {
    const t = theme || {};
    this.theme = t;

    /* ---- background ------------------------------------------------- */
    const bgSpec = t.bg !== undefined && t.bg !== null ? t.bg : dig(t, 'fog.color', 0x05070d);
    readColor(bgSpec, 0x05070d, this._bg);
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
      const fc = readColor(dig(t, 'fog.color', bgSpec), 0x05070d, _col);
      const density = numOr(dig(t, 'fog.density', 0), 0);
      if (density > 0) {
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
        this.scene.fog.far = far;
      }
    }

    /* ---- exposure ---------------------------------------------------- */
    this.renderer.toneMappingExposure = clamp(numOr(t.exposure, 1.0), 0.05, 4);

    /* ---- post -------------------------------------------------------- */
    if (this.post) {
      this.post.setGrade(t.grade || {});
      this.post.setBloom(t.bloom || {});
      this.post.setHeat(numOr(dig(t, 'heat', 0), 0), true);
    }

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
    // The gloves sit right in front of the lens; a touch more probe keeps them
    // from reading darker than the world they are held up against.
    this.overlayScene.environment = rt.texture;
    this.overlayScene.environmentIntensity = t.envIntensity * 1.15;

    this.events.emit('environment', rt.texture);
    return rt.texture;
  }

  /** @private Build the reusable off-screen environment scene once. */
  _ensureEnvScene() {
    if (this._envScene !== null) return;

    const scene = new THREE.Scene();

    const skyMat = new THREE.ShaderMaterial({
      name: 'AscendantEnvSky',
      uniforms: {
        uZenith: { value: new THREE.Color(0x101c33) },
        uHorizon: { value: new THREE.Color(0x1d2f4d) },
        uGround: { value: new THREE.Color(0x05070d) },
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
    _v3b.set(-t.keyDir.x, Math.max(0.12, t.keyDir.y * 0.30), -t.keyDir.z).normalize();
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
      t.skyGround.r * 0.6 + t.ambientColor.r * 0.5,
      t.skyGround.g * 0.6 + t.ambientColor.g * 0.5,
      t.skyGround.b * 0.6 + t.ambientColor.b * 0.5,
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
   * Set the world camera's vertical FOV. FPCamera calls this every frame while
   * a sprint or bounce kick is running; the overlay camera deliberately does
   * NOT follow, so the arms keep a constant apparent size.
   * @param {number} f degrees
   * @returns {Engine} this
   */
  setFov(f) {
    const v = clamp(numOr(f, this.baseFov), 40, 130);
    if (Math.abs(this.camera.fov - v) > 1e-4) {
      this.camera.fov = v;
      this.camera.updateProjectionMatrix();
    }
    return this;
  }

  /**
   * Set the resting FOV (the value sprint/bounce kicks are measured against).
   * @param {number} f degrees
   */
  setBaseFov(f) {
    this.baseFov = clamp(numOr(f, 82), 40, 130);
    return this;
  }

  /**
   * Adjust the far plane — the Frozen Spire wants to see further than the
   * Foundry does.
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
   * Apply a QUALITY preset to the renderer and the post chain.
   * @param {object} [q] defaults to the current Settings preset
   */
  setQuality(q) {
    const preset = q || Settings.quality();
    this.quality = preset;

    this.renderer.shadowMap.enabled = !!preset.shadowMap;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // A shadow map that was already built at the old size has to be told.
    this.renderer.shadowMap.needsUpdate = true;

    this._pr = Settings.pixelRatio();
    this.renderer.setPixelRatio(this._pr);
    this.renderer.setSize(this.size.w, this.size.h, true);

    if (this.post) this.post.setQuality(preset);

    this.events.emit('quality', preset);
    return this;
  }

  /** @private Settings subscriber. */
  _onSettingsChanged(s, changed) {
    for (let i = 0; i < changed.length; i++) {
      const k = changed[i];
      if (k === 'quality') {
        this.setQuality(Settings.quality());
      } else if (k === 'fov') {
        this.setBaseFov(s.fov);
        this.setFov(s.fov);
      } else if (k === 'showViewmodel') {
        if (this.post) this.post.setViewmodelEnabled(s.showViewmodel);
      }
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

    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(s.w, s.h, true);

    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    this.overlayCamera.aspect = aspect;
    this.overlayCamera.updateProjectionMatrix();

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
      let dt = (now - this._last) / 1000;
      this._last = now;
      if (!(dt > 0)) dt = 0;
      else if (dt > MAX_DT) dt = MAX_DT;

      this.dt = dt;
      this.elapsed += dt;
      this.frame++;

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

  /** Zero a fixed-step accumulator (call on respawn / stage load). */
  resetFixed(key) {
    if (key === undefined) this._accs.clear();
    else this._accs.set(key, 0);
    this.fixedAlpha = 0;
  }

  /**
   * Draw one frame through the post chain and refresh `engine.stats`.
   * @param {number} dt seconds
   */
  render(dt) {
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
    stats.frameMs = this._msAvg.push(nowMs() - t0);
    if (dt > 0) stats.fps = Math.round(this._fpsAvg.push(1 / dt));
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

    this.scene.environment = null;
    this.overlayScene.environment = null;
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
 * always returns a NORMALISED copy in `out`.
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
 * the environment bake needs. Every read is defended: a theme is data from
 * another module and must never be able to throw inside a level load.
 *
 * @param {object} themeDef
 * @returns {object}
 */
function readThemeLighting(themeDef) {
  const t = themeDef || {};
  const out = readThemeLighting._out || (readThemeLighting._out = {
    skyTop: new THREE.Color(), skyHorizon: new THREE.Color(), skyGround: new THREE.Color(),
    keyColor: new THREE.Color(), fillColor: new THREE.Color(), ambientColor: new THREE.Color(),
    keyDir: new THREE.Vector3(),
    keyIntensity: 1, fillIntensity: 1, bounceIntensity: 1, envIntensity: 1,
    sunSize: 0.055, sunPower: 24, haze: 0.55, skyIntensity: 1,
  });

  const bg = t.bg !== undefined && t.bg !== null ? t.bg : dig(t, 'fog.color', 0x0a1020);

  readColor(dig(t, 'sky.params.top', dig(t, 'sky.params.zenith', bg)), 0x101c33, out.skyTop);
  readColor(dig(t, 'sky.params.horizon', dig(t, 'fog.color', bg)), 0x1d2f4d, out.skyHorizon);
  readColor(dig(t, 'sky.params.bottom', dig(t, 'sky.params.ground', 0x05070d)), 0x05070d, out.skyGround);

  readColor(dig(t, 'lights.key.color', 0xffffff), 0xffffff, out.keyColor);
  readColor(dig(t, 'lights.fill.color', dig(t, 'lights.rim.color', 0x6f8fd0)), 0x6f8fd0, out.fillColor);
  readColor(dig(t, 'lights.ambient.color', dig(t, 'lights.hemi.color', 0x404860)), 0x404860, out.ambientColor);

  readDir(dig(t, 'lights.key.dir', null), out.keyDir, -0.42, 0.86, 0.30);

  out.keyIntensity = clamp(numOr(dig(t, 'lights.key.intensity', 2.2), 2.2), 0, 20);
  out.fillIntensity = clamp(numOr(dig(t, 'lights.fill.intensity', 0.55), 0.55), 0, 20);
  out.bounceIntensity = clamp(numOr(dig(t, 'lights.ambient.intensity', 0.6), 0.6), 0, 20);
  out.envIntensity = clamp(numOr(t.envIntensity, 1.0), 0, 6);

  out.sunSize = clamp(numOr(dig(t, 'sky.params.sunSize', 0.055), 0.055), 0.004, 0.5);
  out.sunPower = clamp(numOr(dig(t, 'sky.params.sunPower', 24), 24), 1, 400);
  out.haze = clamp(numOr(dig(t, 'sky.params.haze', 0.55), 0.55), 0, 4);
  out.skyIntensity = clamp(numOr(dig(t, 'sky.params.intensity', 1), 1), 0, 8);

  return out;
}

/** Re-exported so callers do not have to reach into settings.js for the cap. */
export { DPR_CEILING };
