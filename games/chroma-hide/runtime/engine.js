/**
 * CHROMA HIDE — runtime/engine.js
 * Lean bespoke three.js substrate (renderer, scene, camera, lights, render loop,
 * resize, raycaster). Standalone (not the genre kernel) because this game's loop
 * — paint mode, FPS seeker, hide/seek phases — is too bespoke for the registry.
 * Renderer budget mirrors the shared ffg_kernel_3d: quality preset from
 * localStorage `ffg_settings.quality`, ACES tonemapping, PCFSoft shadows.
 */
import * as THREE from "three";

const QDPR = { low: 1.0, med: 1.5, high: 2.0 };

export class Engine {
  constructor(container) {
    this.container = container;
    this.THREE = THREE;

    let q = "med";
    try { q = (JSON.parse(localStorage.getItem("ffg_settings") || "{}").quality) || "med"; } catch (e) {}
    this.quality = q;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#0c1016");

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 500);
    this.camera.position.set(0, 3, 7);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QDPR[q] || 1.5));
    this.renderer.shadowMap.enabled = q !== "low";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";

    // Base light rig — a map may add/replace via setLighting().
    this.hemi = new THREE.HemisphereLight(0xdfe9ff, 0x2a2f38, 0.95);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    // steep & mostly overhead so the 5-tall room walls cast only short shadows and
    // every open-top room floor gets even key light (rooms were dim from a low sun).
    this.sun.position.set(9, 44, 7);
    this.sun.castShadow = q !== "low";
    this.sun.shadow.mapSize.set(1024, 1024);
    const d = 40;
    this.sun.shadow.camera.left = -d; this.sun.shadow.camera.right = d;
    this.sun.shadow.camera.top = d; this.sun.shadow.camera.bottom = -d;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 120;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun);

    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(0, 0); // NDC of the cursor
    this._updaters = [];
    this._running = false;

    this._onResize = this._resize.bind(this);
    window.addEventListener("resize", this._onResize);
    // The module can run before the container has its final layout size (canvas
    // would lock to 0×0). A ResizeObserver re-sizes as soon as real dimensions
    // arrive and on every pane resize thereafter.
    if (typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(container);
    }
    this.renderer.domElement.addEventListener("pointermove", (e) => this._trackPointer(e));
    this._resize();
  }

  _resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _trackPointer(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  /** Apply the shared quality preset live (settings menu hook). */
  applyQuality(q) {
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QDPR[q] || 1.5));
    const on = q !== "low";
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    // The sun is static and the map never moves, so the shadow map is identical every
    // frame. Rendering the whole scene into it 60 times a second was pure waste; draw it
    // once and re-arm only when the scene actually changes (see invalidateShadows()).
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** Re-render the shadow map once on the next frame. Call after anything that changes
   *  what casts shadows — a map built, a prop's GLB swapping in, actors spawning. */
  invalidateShadows() { this.renderer.shadowMap.needsUpdate = true; }

  add(obj) { this.scene.add(obj); return obj; }
  remove(obj) { this.scene.remove(obj); }

  /** Register a per-frame callback fn(dt, elapsed). Returns an unsubscribe fn. */
  onFrame(fn) {
    this._updaters.push(fn);
    return () => { const i = this._updaters.indexOf(fn); if (i >= 0) this._updaters.splice(i, 1); };
  }

  /** Cast a ray from the current pointer NDC into `objects` (recursive). */
  raycastPointer(objects, recursive = true) {
    this.camera.updateMatrixWorld(); // cheap guard: camera may have moved this frame
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(objects, recursive);
  }

  /** Cast a ray from a world origin+dir (seeker gun, occlusion tests). */
  raycast(origin, dir, objects, far = 500) {
    this.raycaster.set(origin, dir.clone().normalize());
    this.raycaster.far = far;
    const hits = this.raycaster.intersectObjects(objects, true);
    this.raycaster.far = Infinity;
    return hits;
  }

  start() {
    if (this._running) return;
    this._running = true;
    const loop = () => {
      if (!this._running) return;
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const el = this.clock.elapsedTime;
      for (let i = 0; i < this._updaters.length; i++) {
        try { this._updaters[i](dt, el); } catch (e) { console.error("[chroma] frame err", e); }
      }
      this.renderer.render(this.scene, this.camera);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() { this._running = false; if (this._raf) cancelAnimationFrame(this._raf); }

  dispose() {
    this.stop();
    window.removeEventListener("resize", this._onResize);
    if (this._ro) { try { this._ro.disconnect(); } catch (e) {} }
    try { this.renderer.dispose(); } catch (e) {}
    if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
  }
}
