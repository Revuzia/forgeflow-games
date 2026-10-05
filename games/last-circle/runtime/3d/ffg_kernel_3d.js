/**
 * FFG runtime — 3d/ffg_kernel_3d.js  (ES module)
 * Genre-agnostic three.js substrate: renderer, scene, camera, lights, render
 * loop, GLTF loader (cached), raycaster input, a DOM HUD overlay, a tiny tween
 * helper, and a genre registry. Fixed + versioned — NOT regenerated per game.
 *
 * 3D games are ES modules (three r172 ships ESM-only), so this is imported, not
 * loaded as a window-global. It still mirrors register/boot onto window.FFG for
 * tooling parity.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// Shared once per module: character bases are Draco-compressed (mesh only;
// textures stay 512 JPEG). Without this, GLTFLoader throws
// "No DRACOLoader instance provided" and every skin fails to load.
const _lcDraco = new DRACOLoader();
_lcDraco.setDecoderPath("assets/vendor/three/examples/jsm/libs/draco/");
_lcDraco.setDecoderConfig({ type: "js" });

// This module's own ?v= build tag: sibling runtime modules are imported WITH it,
// or a deploy would serve the new kernel against a CDN-cached stale sibling.
const _V = (() => { try { return new URL(import.meta.url).search; } catch (e) { return ""; } })();

/** Frame budgets (contract C3; BLOCKTOOTH config.ts BUDGET). dprMax is ENFORCED
 * by setDpr; drawCallsMax / p99Ms are reported by the profiler as information. */
export const BUDGET = Object.freeze({ drawCallsMax: 450, p99Ms: 22, dprMax: 1.5 });

/** Per-asset load timeout (ms). A GLB whose request never settles used to wedge
 * the match-start await forever (boot-robustness: 4/4 runs with every GLB aborted
 * left exactly one loadAsync promise unsettled — "BUILDING TERRAIN..." for good). */
export const LOAD_TIMEOUT_MS = 30000;

// Frame profiler: `?prof=1` only. Without the flag the module is never fetched
// and the render loop makes no profiler call at all (kernel.prof = NOOP_PROF).
const _PROF_ON = (() => { try { return new URLSearchParams(location.search).get("prof") === "1"; } catch (e) { return false; } })();
let _profMod = null;
if (_PROF_ON) {
  try { _profMod = await import("./ffg_frameprof.js" + _V); }
  catch (e) { console.warn("[FFG3D] ?prof=1 but ffg_frameprof.js failed to load:", e); }
}
const NOOP_PROF = (_profMod && _profMod.NOOP_PROF) || Object.freeze({
  enabled: false, gpuSupported: false,
  begin() {}, end() {}, mark() {}, skip() {}, gpuBegin() {}, gpuEnd() {},
  annotate() {}, resync() {}, reset() {}, frameBegin() {}, frameEnd() {},
  dump() { return { enabled: false, frames: 0 }; },
});

function _withTimeout(promise, ms, url) {
  if (!(ms > 0)) return promise;
  let to = 0;
  const timer = new Promise((_, rej) => { to = setTimeout(() => rej(new Error("timed out loading " + url)), ms); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(to));
}

export const genres3d = {};
export function register3d(name, builder) { genres3d[name] = builder; }

export class Kernel3D {
  constructor(content) {
    this.content = content || {};
    const view = this.content.view || {};
    this.bg = view.background || "#0a1622";
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.bg);
    this.scene.fog = new THREE.FogExp2(this.bg, view.fog != null ? view.fog : 0.012);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
    this.camera.position.set(0, 26, 30);
    this.camera.lookAt(0, 0, 0);

    // PORTRAIT CAMERA FIT — a PerspectiveCamera's `fov` is the VERTICAL field of
    // view, so the textbook resize (`camera.aspect = w/h`) holds the vertical
    // view fixed and lets the HORIZONTAL view collapse as the viewport narrows.
    // Every 3D game here is framed in a landscape desktop window, so on a phone
    // held in portrait (~9:19.5) the scene is cropped left and right: checkers
    // showed about a THIRD of its 8x8 board — you could not see the game you
    // were playing. Fix: treat the authored fov as correct at a DESIGN aspect
    // and, when the viewport is narrower than that, widen the vertical fov by
    // exactly the amount that keeps the HORIZONTAL fov equal to the design one.
    // At or above the design aspect nothing is touched, so desktop framing is
    // bit-for-bit what it always was. See applyCameraFit() / setCameraFit().
    this._camFit = {
      enabled: view.cameraFit !== false,                                 // content.view.cameraFit:false -> classic fixed-vertical-fov behaviour
      designAspect: view.designAspect > 0 ? view.designAspect : 16 / 9,  // 16:9 — the window games are authored + QA'd in
      maxVFov: view.maxVFov > 0 ? view.maxVFov : 85,                     // past ~85 deg vertical the perspective smears and the near plane starts eating geometry
      authoredFov: this.camera.fov,  // source of truth; NEVER overwritten by a computed value or repeated resizes would ratchet the view open
      appliedFov: this.camera.fov,   // what we last wrote to camera.fov — how we notice a genre re-authoring the framing
      active: false,                 // true while a widened fov is in force
    };

    // preserveDrawingBuffer:true lets toDataURL()/the vision fidelity gate
    // capture the rendered frame (default false returns a blank canvas for
    // WebGL). Negligible perf cost at our scale; unlocks automated visual QA.
    // antialias:false because the scene never reaches the default framebuffer:
    // hud.js enables the bloom composer on the menu and it stays up for the
    // whole session, so RenderPass draws into EffectComposer's own
    // WebGLRenderTarget (built with no `samples`, i.e. single-sampled) and the
    // only thing the MSAA backbuffer ever received was OutputPass's fullscreen
    // quad — a quad has no interior edges, so the 4x buffer was allocated and
    // resolved every frame for zero pixels of coverage. Output is identical.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    // HONEST COUNTERS: with the default autoReset, every render() call zeroes
    // renderer.info, so after a composer frame `info.render.calls` showed only
    // the LAST pass (OutputPass's one quad) — the shadow and bloom passes were
    // invisible. The frame body resets once per frame instead (see _frame).
    this.renderer.info.autoReset = false;

    // DPR BUDGET CAP. effectiveDpr = max(0.5, min(devicePixelRatio, tier, BUDGET.dprMax)).
    // The frame is vertex/skinning-bound, so DPR 2.0 at the high tier bought 1.78x
    // the pixels for nothing measurable. The cap is enforced AT THE RENDERER:
    // renderer.setPixelRatio is routed through setDpr, so a caller that still sets
    // the ratio directly (applyGraphics, the shell's QUALITY buttons) is capped too
    // and the composer's render targets follow the ratio (EffectComposer only
    // reads the renderer's ratio once, at construction).
    this.dpr = 0;
    this._tierDpr = 1.5;
    this._devDpr = 0;
    this._rawSetPixelRatio = this.renderer.setPixelRatio;
    this.renderer.setPixelRatio = (v) => { this.setDpr(v); };
    // QUALITY preset (shell settings → ffg_settings.quality): low = 1.0 DPR +
    // no shadows, med = 1.5 + shadows, high = 2.0 requested (capped to 1.5) + shadows.
    const QDPR = { low: 1.0, med: 1.5, high: 2.0 };
    let _q = "med";
    try { _q = (JSON.parse(localStorage.getItem("ffg_settings") || "{}").quality) || "med"; } catch (e) {}
    this.setDpr(QDPR[_q] || 1.5);
    this.renderer.shadowMap.enabled = _q !== "low";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // live-apply hook for the shell's QUALITY buttons
    {
      const kr = this.renderer;
      const k = this;
      window.FFG = window.FFG || {};
      window.FFG.applyQuality = function (q) {
        k.setDpr(QDPR[q] || 1.5);
        kr.shadowMap.enabled = q !== "low";
        kr.shadowMap.needsUpdate = true;
      };
    }
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // Lights — hemisphere fill + key sun with shadows.
    const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x223344, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(40, 70, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const d = 80;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.far = 250;
    this.scene.add(sun);
    this.sun = sun;

    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    // BROWSER-CACHE BUST: GLBs are fetched lazily (after page load), so even a
    // hard refresh serves them from the browser's HTTP cache — asset updates
    // never reached returning players (owner saw week-old emote clips). Append
    // this module's own ?v= build tag to every relative asset URL: new build →
    // new URL → fresh fetch. The CDN worker ignores query strings, so its own
    // cache is unaffected.
    const buildV = (new URL(import.meta.url).search || "").replace(/^\?/, "");
    const mgr = new THREE.LoadingManager();
    if (buildV) mgr.setURLModifier((u) => /^(data:|blob:|https?:)/.test(u) ? u : u + (u.includes("?") ? "&" : "?") + buildV);
    this.loadingManager = mgr;
    this.loader = new GLTFLoader(mgr);
    this.loader.setDRACOLoader(_lcDraco);
    this._gltfCache = {};
    this._charCache = {};
    // Parked PROMISES for URLs still loading — see loadGLTF for why the result
    // caches above are not enough on their own.
    this._gltfInflight = {};
    this._charInflight = {};
    this._mixers = [];
    this._updaters = [];
    this._tweens = [];
    this._running = false;
    this._raf = 0;
    this.frameNo = 0;                 // frames run (rAF or stepFrame)
    this._lastFrameT = 0;             // rAF timestamp of the previous frame (profiler rAF gap)
    this._mixerPhase = 0;             // hands each rate-limited mixer its own stagger slot
    this.loadTimeoutMs = LOAD_TIMEOUT_MS;
    this.budget = BUDGET;
    // C1: the container's CSS size, cached by a ResizeObserver (see mount). The
    // frame never reads clientWidth / clientHeight, which forced a style + layout
    // flush whenever the HUD had dirtied the DOM earlier in the frame.
    this.viewW = 0;
    this.viewH = 0;
    this._viewDirty = false;
    this._sizeW = -1;                 // what setSize last applied
    this._sizeH = -1;
    // C2: frame / context-loss errors (see onError)
    this._errorHandlers = [];
    this.lastError = null;
    this.contextLost = false;
    this._lostReported = false;       // this loss already reached the handlers (one card per loss)
    this._lostHandled = false;
    this.onContextRestored = null;    // default on restore: location.reload()
    // C3: frame profiler, `?prof=1` only
    this.prof = NOOP_PROF;
    this._profOn = false;
    if (_profMod && _profMod.FrameProf) {
      try { this.prof = new _profMod.FrameProf(this.renderer, { budget: BUDGET }); this._profOn = true; }
      catch (e) { console.warn("[FFG3D] frame profiler unavailable:", e); }
    }
    // physics (cannon-es) — created lazily via initPhysics()
    this.world = null;
    this.CANNON = null;
    this._phys = [];
  }

  // ── Real physics (cannon-es, rigid-body) ──────────────────────────────────
  // Optional: only genres that call this load cannon-es (dynamic import keeps it
  // out of non-physics 3D games). Bodies linked to meshes are synced each frame.
  async initPhysics(opts = {}) {
    const CANNON = await import("cannon-es");
    this.CANNON = CANNON;
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, opts.gravity != null ? opts.gravity : -20, 0) });
    this.world.allowSleep = true;
    return CANNON;
  }

  addPhysicsBody(o) {
    const C = this.CANNON;
    const body = new C.Body({ mass: o.mass != null ? o.mass : 1, shape: o.shape });
    if (o.position) body.position.set(o.position.x, o.position.y, o.position.z);
    if (o.velocity) body.velocity.set(o.velocity.x, o.velocity.y, o.velocity.z);
    if (o.angularVelocity) body.angularVelocity.set(o.angularVelocity.x, o.angularVelocity.y, o.angularVelocity.z);
    if (o.linearDamping != null) body.linearDamping = o.linearDamping;
    this.world.addBody(body);
    this._phys.push({ body, mesh: o.mesh || null, die: o.despawnAfter != null ? this.clock.elapsedTime + o.despawnAfter : null, removeMesh: !!o.removeMesh });
    return body;
  }

  mount(parentId) {
    this.parent = document.getElementById(parentId || "game-container") || document.body;
    this.parent.appendChild(this.renderer.domElement);
    // DOM HUD overlay (sharp text, never blurry — the shroud-font lesson)
    this.hudEl = document.createElement("div");
    Object.assign(this.hudEl.style, {
      position: "absolute", inset: "0", pointerEvents: "none",
      fontFamily: "monospace", color: "#dfeaff", textShadow: "0 1px 3px #000",
    });
    this.parent.style.position = this.parent.style.position || "relative";
    this.parent.appendChild(this.hudEl);
    this._measure();
    this._resize();
    // C1: the container's CSS box, cached by a ResizeObserver (port of
    // blocktooth renderer.ts:105-124). The observer fires after layout, before
    // paint, on ANY size change (window resize, fullscreen, a CSS change) and
    // only caches: the next frame applies it right before it draws, so setSize
    // never clears a drawing buffer that is about to be presented (no blank frame).
    if (typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver((entries) => {
        for (const e of entries) {
          const box = e.contentBoxSize && e.contentBoxSize[0];
          // clientWidth/clientHeight round the content box; keep that rounding so sizes match the old read
          const w = Math.round(box ? box.inlineSize : e.contentRect.width);
          const h = Math.round(box ? box.blockSize : e.contentRect.height);
          if (w > 0 && h > 0 && (w !== this.viewW || h !== this.viewH)) { this.viewW = w; this.viewH = h; this._viewDirty = true; }
        }
      });
      this._ro.observe(this.parent);
    }
    // Event-time reads stay (a forced layout per EVENT is fine; per frame is not).
    window.addEventListener("resize", () => { this._measure(); this._resize(); });
    // An orientation flip (and mobile browser chrome sliding in/out) does not
    // reliably fire a window resize, and when it does the container's box has
    // not settled yet — so the canvas keeps the pre-rotation size and the fit
    // above is computed from a stale aspect. visualViewport reports the real
    // visible area, and the two delayed re-reads catch the box after the
    // rotation animation lands (the 120/420ms pattern crestbound's boot uses).
    // _resize() is idempotent, so the extra calls cost one setSize and nothing.
    const reread = () => { this._measure(); this._resize(); };
    const nudge = () => { setTimeout(reread, 120); setTimeout(reread, 420); };
    window.addEventListener("orientationchange", nudge, false);
    if (window.visualViewport && window.visualViewport.addEventListener) window.visualViewport.addEventListener("resize", nudge);
    // Context loss (phones, backgrounded tabs, driver resets). three's own
    // listener already preventDefault()s so a restore is possible; we stop the
    // loop — rendering into a lost context is a grey dead canvas under a live
    // HUD — tell the player, and reload on restore (every GPU resource is gone,
    // and the match state is bound to them).
    const cv = this.renderer.domElement;
    cv.addEventListener("webglcontextlost", (e) => {
      try { e.preventDefault(); } catch (err) {}
      this.stop();
      this.contextLost = true;
      this.onError(new Error("WebGL context lost"), { kind: "contextlost" });
    }, false);
    cv.addEventListener("webglcontextrestored", () => {
      this.contextLost = false;
      this._lostReported = false;        // a later loss gets its own card
      if (typeof this.onContextRestored === "function") this.onContextRestored();
      else location.reload();
    }, false);
    return this;
  }

  /** Read the container's CSS box now (event-time only — never per frame). */
  _measure() {
    const w = this.parent ? this.parent.clientWidth : 0;
    const h = this.parent ? this.parent.clientHeight : 0;
    this.viewW = w > 0 ? w : (window.innerWidth || 1280);
    this.viewH = h > 0 ? h : (window.innerHeight || 720);
    this._viewDirty = false;
  }

  _resize() {
    this._viewDirty = false;
    const w = Math.max(1, this.viewW || window.innerWidth || 1);
    const h = Math.max(1, this.viewH || window.innerHeight || 1);
    if (w !== this._sizeW || h !== this._sizeH) {
      this.renderer.setSize(w, h, true);   // canvas CSS must match window (HiDPI overflow fix)
      if (this.composer) this.composer.setSize(w, h);
      this._sizeW = w; this._sizeH = h;
    }
    this.camera.aspect = w / h;
    this.applyCameraFit();               // vertical fov follows the aspect on narrow viewports; strict no-op at/above designAspect
    this.camera.updateProjectionMatrix();
  }

  /** Tier DPR -> effective DPR = max(0.5, min(devicePixelRatio, tierDpr, BUDGET.dprMax)).
   * Applied to the renderer AND the composer's render targets. Returns the
   * effective ratio. renderer.setPixelRatio(v) is routed here too (see the
   * constructor), so `v` is always treated as the REQUESTED ratio. */
  setDpr(tierDpr) {
    const req = Number.isFinite(+tierDpr) && +tierDpr > 0 ? +tierDpr : 1;
    const dev = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    this._tierDpr = req;
    this._devDpr = dev;
    const eff = Math.max(0.5, Math.min(dev, req, BUDGET.dprMax));
    if (eff !== this.dpr) {
      this._rawSetPixelRatio.call(this.renderer, eff);
      if (this.composer && this.composer.setPixelRatio) this.composer.setPixelRatio(eff);
      this.dpr = eff;
    }
    return eff;
  }

  /** Re-derive the camera's VERTICAL fov for the CURRENT aspect from the
   * AUTHORED fov. Runs on every resize, once after the genre builder returns,
   * and on start(). Idempotent — safe to call at any time. Returns the fit state
   * ({enabled, designAspect, maxVFov, authoredFov, appliedFov, active}).
   *
   * Why the authored fov is tracked instead of just read off the camera: genres
   * author their framing AFTER mount() (`kernel.camera.fov = 40` is the
   * board-game idiom), and a widened fov must never become the input to the next
   * widening. So we remember what WE last wrote — if camera.fov differs from
   * that, a genre re-authored it and that value becomes the new source of truth.
   */
  applyCameraFit() {
    const cam = this.camera, f = this._camFit;
    if (!f || !cam || !cam.isPerspectiveCamera) return null;
    // A genre re-authored the framing — adopt it, don't stomp it. EXACT compare:
    // appliedFov is the exact double we wrote, and this now runs every frame
    // (start()'s loop, after the updaters). A tolerance let a per-frame lerp that
    // had settled to within 1e-6 of the last value be overwritten by that stale
    // value — visually nothing, but no longer bit-identical at 16:9.
    if (cam.fov !== f.appliedFov) f.authoredFov = cam.fov;
    const aspect = cam.aspect > 0 ? cam.aspect : 1;
    let vfov = f.authoredFov;
    if (f.enabled && aspect < f.designAspect) {
      // Hold the horizontal fov the game was authored with:
      //   hFov = 2*atan(tan(authoredFov/2) * designAspect)   <- what a 16:9 desktop shows
      //   vFov = 2*atan(tan(hFov/2) / aspect)                <- what THIS viewport needs to show that same width
      const halfH = Math.atan(Math.tan((f.authoredFov * Math.PI) / 360) * f.designAspect);
      vfov = (2 * Math.atan(Math.tan(halfH) / aspect) * 180) / Math.PI;
      // A portrait phone asks for ~109 deg at the board-game fov of 40. Clamped
      // to maxVFov it still opens the horizontal angle ~2.4x — the difference
      // between a third of the board and all of it. Unclamped, the perspective
      // smears and geometry starts clipping through the near plane.
      vfov = Math.min(vfov, f.maxVFov);
      if (vfov < f.authoredFov) vfov = f.authoredFov;   // never NARROWER than authored
    }
    f.active = Math.abs(vfov - f.authoredFov) > 1e-6;
    f.appliedFov = vfov;
    if (cam.fov !== vfov) { cam.fov = vfov; cam.updateProjectionMatrix(); }
    return f;
  }

  /** Tune or disable the portrait fit — every key optional, applied at once:
   *    designAspect : aspect the authored fov is correct at   (default 16/9)
   *    maxVFov      : vertical fov ceiling, degrees           (default 85)
   *    enabled      : false = classic fixed-vertical-fov, authored fov restored
   * Content-level equivalent, for games that never touch the kernel directly:
   * content.view.cameraFit / .designAspect / .maxVFov. Call with no arguments to
   * read the current state back. */
  setCameraFit(opts) {
    opts = opts || {};
    const f = this._camFit;
    if (!f) return null;
    if (opts.designAspect > 0) f.designAspect = opts.designAspect;
    if (opts.maxVFov > 0) f.maxVFov = opts.maxVFov;
    if (opts.enabled != null) f.enabled = !!opts.enabled;
    return this.applyCameraFit();   // disabling puts the authored fov back — it never freezes a widened one
  }

  // Optional post-processing: HDR bloom over the emissive elements (glowing
  // grids, tracers, hazards, sci-fi trim) for a far more "next-gen" look. Genres
  // opt in via enableBloom(); the render loop then draws through the composer.
  enableBloom(opts) {
    opts = opts || {};
    const w = this.viewW || window.innerWidth;
    const h = this.viewH || window.innerHeight;
    const composer = new EffectComposer(this.renderer);   // takes the renderer's (capped) DPR; setDpr keeps it in step afterwards
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h),
      opts.strength != null ? opts.strength : 0.6,
      opts.radius != null ? opts.radius : 0.5,
      opts.threshold != null ? opts.threshold : 0.85);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.bloom = bloom;
    return composer;
  }

  hud(html) { if (this.hudEl) this.hudEl.innerHTML = html; }

  // Orbit camera — scroll to zoom; rotate on a configurable mouse button;
  // optional WASD panning to survey the whole scene. Clamped so the player can't
  // flip under the world. Returns the controls.
  //   opts.rotateButton: "left" (default) | "right"  — which drag rotates
  //   opts.wasdPan: true  — W/A/S/D glide the camera across the ground plane
  enableOrbit(opts) {
    opts = opts || {};
    var c = new OrbitControls(this.camera, this.renderer.domElement);
    c.enableDamping = true; c.dampingFactor = 0.08;
    c.rotateSpeed = 0.6; c.zoomSpeed = 0.8;
    c.minDistance = opts.minDistance != null ? opts.minDistance : 20;
    c.maxDistance = opts.maxDistance != null ? opts.maxDistance : 200;
    c.minPolarAngle = opts.minPolarAngle != null ? opts.minPolarAngle : 0.15;
    c.maxPolarAngle = opts.maxPolarAngle != null ? opts.maxPolarAngle : Math.PI * 0.49; // stay above the horizon
    c.enablePan = !!opts.enablePan;
    // Map rotate to the right mouse button when asked, leaving the LEFT button
    // free for in-world clicks (e.g. firing). Right-drag then rotates the view.
    if (opts.rotateButton === "right") {
      c.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
      var dom = this.renderer.domElement;
      dom.addEventListener("contextmenu", function (e) { e.preventDefault(); }); // no menu on right-drag
    }
    if (opts.target) c.target.set(opts.target.x, opts.target.y, opts.target.z);
    if (opts.autoRotate) { c.autoRotate = true; c.autoRotateSpeed = opts.autoRotateSpeed || 0.6; }
    c.update();
    this.controls = c;
    this.onUpdate(function () { c.update(); });

    // WASD glide-pan across the ground plane (forward = toward the look target).
    if (opts.wasdPan) {
      var cam = this.camera, keys = {}, speed = opts.panSpeed != null ? opts.panSpeed : 26;
      var tag = function (down) { return function (e) {
        var k = (e.key || "").toLowerCase();
        if (k === "w" || k === "a" || k === "s" || k === "d") { keys[k] = down; if (down) e.preventDefault(); }
      }; };
      window.addEventListener("keydown", tag(true));
      window.addEventListener("keyup", tag(false));
      var fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), mv = new THREE.Vector3();
      this.onUpdate(function (dt) {
        if (opts.autoRotate && c.autoRotate) return; // don't pan while the menu auto-rotates
        mv.set(0, 0, 0);
        fwd.subVectors(c.target, cam.position); fwd.y = 0;
        if (fwd.lengthSq() < 1e-4) return;
        fwd.normalize(); right.crossVectors(fwd, up).normalize();
        if (keys.w) mv.add(fwd);
        if (keys.s) mv.sub(fwd);
        if (keys.d) mv.add(right);
        if (keys.a) mv.sub(right);
        if (mv.lengthSq() > 0) {
          mv.normalize().multiplyScalar(speed * Math.min(0.05, dt || 0.016));
          cam.position.add(mv); c.target.add(mv);
        }
      });
    }
    return c;
  }

  // Simple SFX: a fresh HTMLAudio per call (allows overlap). Browser autoplay
  // policy means sound starts after the player's first interaction — fine for
  // a click-driven game; no-ops safely if the url is missing/blocked.
  playSound(url, vol = 0.6) {
    if (!url) return;
    // Scale by the shell's SFX volume setting (window.FFG.sfxVolume), so the
    // Settings slider controls effects without per-genre wiring.
    const mul = (typeof window !== "undefined" && window.FFG && window.FFG.sfxVolume != null) ? window.FFG.sfxVolume : 1;
    const v = Math.max(0, Math.min(1, vol * mul));
    if (v <= 0) return;
    try { const a = new Audio(url); a.volume = v; const p = a.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  }

  // Looping background music (one track). Call from a user gesture (e.g. Play)
  // so autoplay is permitted. Safe to call repeatedly.
  playMusic(url, vol = 0.35) {
    if (!url) return;
    try {
      if (this._music) { this._music.pause(); this._music = null; }
      var a = new Audio(url); a.loop = true; a.volume = vol;
      var p = a.play(); if (p && p.catch) p.catch(() => {});
      this._music = a;
    } catch (e) {}
  }
  stopMusic() { try { if (this._music) { this._music.pause(); this._music = null; } } catch (e) {} }

  async loadGLTF(url) {
    if (this._gltfCache[url]) return this._gltfCache[url].clone(true);
    // The cache above is only written AFTER the await, so N callers hitting one
    // COLD url in the same tick all missed and each ran its own loadAsync — N
    // parses and N independent THREE.Source objects for the same image. Measured
    // in the running game: five concurrent loadGLTF() calls on a cold url gave 5
    // distinct Sources, five sequential calls on the warm url gave 1. A live
    // match ended up with 202 unique Sources against 46 cached models — 156
    // duplicates, ~200 MB of texture residency where ~65 MB covers it. Callers
    // do the same pre-await check one level up (loot.js:39 W.itemProto), which
    // is why the loot group alone carried 134 of them. Park the PROMISE, not
    // just the result, so concurrent callers share one parse and one upload.
    // TIMEOUT: a request that never settles rejects after loadTimeoutMs with
    // "timed out loading <url>", so a match start can fail loudly instead of
    // hanging on its loading screen. The inflight slot clears either way, so a
    // later call starts a fresh loadAsync. (three's FileLoader joins a fetch of
    // the same URL that is STILL pending, so a request that is truly hung is not
    // re-sent: the retry times out again, loudly, instead of hanging.)
    if (!this._gltfInflight[url]) {
      this._gltfInflight[url] = _withTimeout(this.loader.loadAsync(url), this.loadTimeoutMs, url).then((gltf) => {
        const root = gltf.scene;
        const _lts = [];
        root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } else if (o.isLight) _lts.push(o); });
        _lts.forEach((l) => l.parent && l.parent.remove(l)); // PERF: drop model-embedded lights
        this._gltfCache[url] = root;
        return root;
      }).finally(() => { delete this._gltfInflight[url]; });
    }
    const root = await this._gltfInflight[url];
    return root.clone(true);
  }

  /** Load a RIGGED + ANIMATED glTF (soldiers, robots). Returns a fresh instance:
   * { scene, mixer, actions, play(name,opts), animations }. Uses SkeletonUtils to
   * clone skinned meshes correctly, wires an AnimationMixer, and registers it for
   * per-frame updates. `play(name)` crossfades to a clip (loops by default). */
  async loadCharacter(url) {
    if (!this._charCache[url]) {
      // Same cold-cache stampede as loadGLTF (see the note there): the actor
      // group carried 57 unique texture Sources for 5 distinct skins because
      // every concurrent spawn on a cold url ran its own loadAsync before the
      // first one could fill the cache. All callers await one shared promise.
      if (!this._charInflight[url]) {
        this._charInflight[url] = _withTimeout(this.loader.loadAsync(url), this.loadTimeoutMs, url).then((g) => {   // same timeout as loadGLTF
          const _lts = [];
          g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } else if (o.isLight) _lts.push(o); });
          _lts.forEach((l) => l.parent && l.parent.remove(l)); // PERF: drop model-embedded lights
          this._charCache[url] = g;
          return g;
        }).finally(() => { delete this._charInflight[url]; });
      }
      await this._charInflight[url];
    }
    const gltf = this._charCache[url];
    const scene = skeletonClone(gltf.scene);
    const mixer = new THREE.AnimationMixer(scene);
    this._mixers.push(mixer);
    const actions = {};
    (gltf.animations || []).forEach((clip) => { actions[clip.name] = mixer.clipAction(clip); });
    let current = null;
    function play(name, opts) {
      opts = opts || {};
      const next = actions[name]; if (!next) return null;
      if (current === next && !opts.force) return next;
      next.reset();
      next.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = !!opts.once;
      next.enabled = true;
      // `|| 1` swallowed an explicit timeScale of 0 (falsy), so "freeze this
      // clip on a pose" played at full speed instead — a crouching player
      // marched in place. Only bit when the clip CHANGED, which is exactly
      // when you crouch from standing.
      next.setEffectiveTimeScale(opts.timeScale != null ? opts.timeScale : 1);
      next.setEffectiveWeight(1);
      if (current && current !== next) { next.crossFadeFrom(current, opts.fade != null ? opts.fade : 0.2, false); }
      next.play(); current = next; return next;
    }
    return { scene, mixer, actions, play, animations: gltf.animations || [] };
  }

  disposeMixer(mixer) { const i = this._mixers.indexOf(mixer); if (i >= 0) this._mixers.splice(i, 1); }

  /** Screen pointer (clientX/Y) -> intersections against `objects`. */
  raycast(clientX, clientY, objects) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(objects, true);
  }

  onUpdate(fn) { this._updaters.push(fn); }

  /** Minimal tween: lerps numeric props of obj.<path> to `to` over duration s. */
  tween(opts) {
    const t = {
      from: {}, to: opts.to || {}, target: opts.target,
      dur: opts.duration || 0.5, t: 0,
      ease: opts.ease || ((x) => x * x * (3 - 2 * x)), // smoothstep
      onUpdate: opts.onUpdate, onComplete: opts.onComplete,
    };
    for (const k in t.to) t.from[k] = _get(t.target, k);
    this._tweens.push(t);
    return t;
  }

  _stepTweens(dt) {
    for (let i = this._tweens.length - 1; i >= 0; i--) {
      const tw = this._tweens[i];
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const e = tw.ease(tw.t);
      for (const k in tw.to) _set(tw.target, k, tw.from[k] + (tw.to[k] - tw.from[k]) * e);
      if (tw.onUpdate) tw.onUpdate(e);
      if (tw.t >= 1) { if (tw.onComplete) tw.onComplete(); this._tweens.splice(i, 1); }
    }
  }

  start() {
    if (this._running || this.contextLost) return;
    this._running = true;
    this.applyCameraFit();   // genres author their fov after mount() — fit the FINAL value before the first frame
    this.clock.getDelta();   // a restart (after stop / an error card) must not hand the first frame the whole pause
    const loop = (now) => {
      if (!this._running) return;
      // Schedule the NEXT frame FIRST. The old loop requested it on its last
      // line, so one throw anywhere in the frame (any updater, any render) froze
      // the game for good, silently, with `running` still true (boot-robustness
      // G4: frame counter 195 -> 195 -> 195 over 5 s). Now a throw cancels this
      // request, stops the loop and reaches onError (C2) — a card, never a freeze.
      this._raf = requestAnimationFrame(loop);
      const t = typeof now === "number" ? now : performance.now();
      const raw = this._lastFrameT ? t - this._lastFrameT : 0;
      this._lastFrameT = t;
      try {
        this._frame(Math.min(0.05, this.clock.getDelta()), true, raw);
      } catch (e) {
        cancelAnimationFrame(this._raf);
        this._raf = 0;
        this._running = false;
        this.onError(e, { kind: "frame" });
      }
    };
    loop(performance.now());
  }

  stop() { this._running = false; if (this._raf) cancelAnimationFrame(this._raf); this._raf = 0; this._lastFrameT = 0; }

  /** Run ONE frame synchronously (tests / harness: the hidden or headless tab
   * throttles rAF, so gates step frames instead of waiting on it). Same body as
   * the rAF loop — tweens -> physics -> mixers -> updaters -> camera fit ->
   * render — but a throw propagates to the caller instead of the error card.
   * `render` false skips only the draw. Returns the frame number. */
  stepFrame(dt, render) {
    const d = dt > 0 ? dt : 1 / 60;
    this.clock.getDelta();   // keep the live loop's next dt small after a burst of stepped frames
    this._frame(d, render !== false, d * 1000);
    return this.frameNo;
  }

  /** The frame body. Section order is the contract the royale pipeline and the
   * probes rely on: tweens -> physics -> mixers -> updaters -> camera fit -> render. */
  _frame(dt, render, raw) {
    const P = this._profOn ? this.prof : null;
    if (P) P.frameBegin();
    this.frameNo++;
    // ONE counter reset per frame (autoReset is off): everything drawn in this
    // frame — shadow pass, RenderPass, bloom mips, OutputPass, and any updater's
    // own render — lands in renderer.info.render.{calls,triangles}.
    this.renderer.info.reset();
    // C1: apply a size the ResizeObserver cached, right before this frame draws.
    if (this._viewDirty) this._resize();
    // A DPR change (window dragged to another monitor, browser zoom) re-derives
    // the effective ratio. Reading devicePixelRatio forces no layout.
    if (window.devicePixelRatio !== this._devDpr) this.setDpr(this._tierDpr);

    if (P) P.begin("tweens");
    this._stepTweens(dt);
    if (P) P.end("tweens");
    if (this.world) {
      if (P) P.begin("physics");
      this.world.step(1 / 60, dt, 3);
      for (let i = this._phys.length - 1; i >= 0; i--) {
        const r = this._phys[i];
        if (r.mesh) { r.mesh.position.copy(r.body.position); r.mesh.quaternion.copy(r.body.quaternion); }
        if (r.die != null && this.clock.elapsedTime > r.die) {
          this.world.removeBody(r.body);
          if (r.mesh && r.removeMesh) this.scene.remove(r.mesh);
          this._phys.splice(i, 1);
        }
      }
      if (P) P.end("physics");
    }

    // C4 MIXER POLICY (flags set by the genre, e.g. player.js per actor):
    //   m._ffgSkip === true -> not evaluated at all this frame. timeScale 0 is
    //     NOT a skip: three r172 still runs every action's _update and every
    //     binding's apply at timeScale 0 (the old far-bot "LOD" paid full price).
    //   m._ffgRate 2 | 4    -> evaluated every 2nd / 4th frame with the dt it
    //     accumulated, on a per-mixer stagger slot so the reduced-rate crowd
    //     spreads across frames instead of spiking together.
    // A skipped mixer drops its accumulator: when it resumes it continues from
    // its own clock rather than jumping by the whole skipped span.
    if (P) P.begin("mixers");
    const mixers = this._mixers;
    for (let i = 0; i < mixers.length; i++) {
      const m = mixers[i];
      if (m._ffgSkip === true) { m._ffgAcc = 0; continue; }
      const rate = m._ffgRate === 2 || m._ffgRate === 4 ? m._ffgRate : 1;
      if (rate === 1) {
        const acc = m._ffgAcc || 0;
        m._ffgAcc = 0;
        m.update(dt + acc);
        continue;
      }
      if (m._ffgSlot === undefined) m._ffgSlot = this._mixerPhase++;
      const acc = (m._ffgAcc || 0) + dt;
      if ((this.frameNo + m._ffgSlot) % rate !== 0) { m._ffgAcc = acc; continue; }
      m._ffgAcc = 0;
      m.update(acc);
    }
    if (P) P.end("mixers");

    if (P) P.begin("updaters");
    const el = this.clock.elapsedTime;
    for (const u of this._updaters) u(dt, el);
    if (P) P.end("updaters");

    // PORTRAIT CAMERA FIT, every frame, AFTER the updaters: the royale menu
    // (hud.js updateMenuWorld) and the match camera (player.js updateCamera)
    // both write camera.fov every frame, so a fit applied only on resize survived
    // at most one frame. applyCameraFit adopts the value the game just wrote as
    // the authored fov and widens it on narrow viewports; at or above 16:9 it
    // writes nothing (the game's own value is drawn, bit for bit).
    this.applyCameraFit();

    if (render) {
      if (P) { P.begin("render"); P.gpuBegin(); }
      if (this.composer) this.composer.render(dt); else this.renderer.render(this.scene, this.camera);
      if (P) { P.gpuEnd(); P.end("render"); }
    }
    if (P) P.frameEnd(raw || 0, this.renderer.info);
  }

  /** C2 — frame / context-loss errors.
   *   kernel.onError(fn)        register a handler fn(err, info) (info.kind: "frame" |
   *                             "contextlost" | ...); returns an unsubscribe function.
   *                             Registered handlers REPLACE the default card; if every
   *                             handler throws, the default card still shows.
   *   kernel.onError(err, info) dispatch (what the loop's catch calls). While the GL
   *                             context is lost every dispatch is kind "contextlost"
   *                             (the original kind kept as info.cause), once per loss.
   * The default: console.error + window.__LC_BOOT__.fail(title, detail, actions)
   * when the boot guard is present, else (or if that painted nothing) a minimal
   * inline card with RELOAD. Pointer lock is released first either way — a card
   * the cursor cannot reach is not a card. */
  onError(arg, info) {
    if (typeof arg === "function") {
      const fn = arg;
      this._errorHandlers.push(fn);
      return () => { const i = this._errorHandlers.indexOf(fn); if (i >= 0) this._errorHandlers.splice(i, 1); };
    }
    const err = arg instanceof Error ? arg : new Error(String(arg));
    const inf = Object.assign({ kind: "error" }, info || {}, { kernel: this });
    // A context loss usually reaches us FIRST as whatever throws on the dead
    // context: loseContext() / a GPU reset is asynchronous, and a frame that runs
    // before webglcontextlost is delivered can throw inside three (a lost context
    // returns null shader logs: "Cannot read properties of null (reading 'trim')").
    // That is a context loss, not a game bug — report it as one (the RELOAD-only
    // card, reload on restore), keep the original kind as info.cause, and stop
    // the loop. One card per loss: the event that follows does not dispatch again.
    if (inf.kind !== "contextlost" && (this.contextLost || this._glLost())) {
      inf.cause = inf.kind;
      inf.kind = "contextlost";
      this.stop();
      this.contextLost = true;
    }
    if (inf.kind === "contextlost") {
      if (this._lostReported) return this._lostHandled;
      this._lostReported = true;
    }
    this.lastError = { message: err.message, stack: err.stack || "", kind: inf.kind, cause: inf.cause || null, t: Math.round(performance.now()) };
    console.error("[FFG3D] " + inf.kind + " error:", err);
    try { if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock(); } catch (e) {}
    let handled = false;
    for (const h of this._errorHandlers.slice()) {
      try { h(err, inf); handled = true; } catch (e) { console.error("[FFG3D] onError handler threw:", e); }
    }
    if (!handled) this._defaultErrorCard(err, inf);
    if (inf.kind === "contextlost") this._lostHandled = handled;
    return handled;
  }

  /** True when the renderer's GL context reports itself lost (never throws). */
  _glLost() {
    try {
      const gl = this.renderer && this.renderer.getContext && this.renderer.getContext();
      return !!(gl && typeof gl.isContextLost === "function" && gl.isContextLost());
    } catch (e) { return false; }
  }

  _defaultErrorCard(err, info) {
    const lost = info.kind === "contextlost";
    const title = lost ? "Graphics were interrupted" : "Something went wrong";
    const detail = lost
      ? "The browser reset the graphics (this happens on phones and in background tabs). The game reloads when they come back, or press RELOAD."
      : "The game stopped on an error: " + (err && err.message ? err.message : String(err)) + ". Press RELOAD to start again.";
    const reload = () => { try { location.reload(); } catch (e) {} };
    const B = window.__LC_BOOT__;
    if (B && typeof B.fail === "function") {
      try { B.fail(title, detail, [{ label: "RELOAD", onClick: reload }]); } catch (e) { console.error("[FFG3D] __LC_BOOT__.fail threw:", e); }
    }
    // Paint our own card unless the boot guard visibly put this title on screen
    // (a guard may treat fail() after its handoff as a no-op, or paint async).
    const check = () => {
      if (document.getElementById("ffg-kernel-error")) return;
      let shown = false;
      try { shown = (document.body.innerText || "").indexOf(title) >= 0; } catch (e) {}
      if (!shown) this._paintErrorCard(title, detail, reload);
    };
    setTimeout(check, 60);
  }

  _paintErrorCard(title, detail, reload) {
    const host = document.body;
    const card = document.createElement("div");
    card.id = "ffg-kernel-error";
    card.setAttribute("role", "alertdialog");
    card.style.cssText = "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;background:rgba(8,19,31,0.92);font:14px/1.6 system-ui,sans-serif;color:#cfe3f5;z-index:2147483600;pointer-events:auto";
    const box = document.createElement("div");
    box.style.cssText = "max-width:380px";
    const h = document.createElement("div");
    h.style.cssText = "font:700 18px/1.3 system-ui,sans-serif;color:#e8f4ff;margin-bottom:10px";
    h.textContent = title;
    const p = document.createElement("div");
    p.style.cssText = "margin-bottom:18px;word-break:break-word";
    p.textContent = detail;
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "RELOAD";
    b.style.cssText = "padding:11px 22px;border:0;border-radius:8px;background:#2f9e6e;color:#04140d;font:700 14px system-ui,sans-serif;cursor:pointer";
    b.addEventListener("click", reload);
    box.appendChild(h); box.appendChild(p); box.appendChild(b);
    card.appendChild(box);
    host.appendChild(card);
    return card;
  }

  /** C7 convenience: `await kernel.warmup({extras})` == ffg_warmup.warmup(kernel, {extras}).
   * The module is loaded on first use, with this kernel's ?v= tag. */
  async warmup(opts) {
    const mod = await import("./ffg_warmup.js" + _V);
    return mod.warmup(this, opts);
  }
}

function _get(obj, path) { return path.split(".").reduce((o, k) => o[k], obj); }
function _set(obj, path, v) {
  const parts = path.split("."); const last = parts.pop();
  parts.reduce((o, k) => o[k], obj)[last] = v;
}

export async function boot3d(content) {
  const builder = genres3d[content.genre];
  // THROW, never `return null`: the boot module awaited a null, took it as
  // success, removed the splash and left a blank page (boot-robustness G11).
  // A throw reaches its catch and paints the failure.
  if (!builder) throw new Error("[FFG3D] no 3D runtime for genre: " + content.genre + " (have: " + Object.keys(genres3d).join(", ") + ")");
  const kernel = new Kernel3D(content).mount(content.parent || "game-container");
  const controller = await builder(kernel, content);
  // The builder is where a genre authors its framing, which lands AFTER
  // mount()'s resize — refit to the real viewport now, so a portrait phone is
  // correct on the FIRST frame instead of only after some later resize event.
  kernel.applyCameraFit();
  kernel.start();
  window.__FFG3D__ = { kernel, controller, content };
  return controller;
}

// tooling parity
if (typeof window !== "undefined") {
  window.FFG = window.FFG || {};
  window.FFG.genres3d = genres3d;
  window.FFG.boot3d = boot3d;
  window.FFG.VERSION3D = "2.2.0";   // 2.2: rAF-first loop + onError, ResizeObserver view size, per-frame camera fit, honest counters, ?prof=1, mixer policy, DPR cap, load timeouts, warmup
}
