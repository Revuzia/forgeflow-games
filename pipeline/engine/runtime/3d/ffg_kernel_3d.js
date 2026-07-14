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
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SSAOPass } from "three/addons/postprocessing/SSAOPass.js";
// Edge AA + better AO (Tier 3 fidelity post). Static imports resolve from the
// SAME r0.172 CDN the boot uses; construction is still feature-detected +
// try/caught in enableBloom() so a build missing any of these never breaks the
// render loop (it silently falls back to the prior pass set).
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";

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

    // preserveDrawingBuffer:true lets toDataURL()/the vision fidelity gate
    // capture the rendered frame (default false returns a blank canvas for
    // WebGL). Negligible perf cost at our scale; unlocks automated visual QA.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    // Cap DPR at 1.5 — at 2x a hi-DPI display renders ~4x the fragments (a top FPS
    // killer). 1.5 is near-indistinguishable and far cheaper.
    // QUALITY preset (shell settings → ffg_settings.quality): low = 1.0 DPR +
    // no shadows, med = 1.5 + shadows (the old fixed cap), high = 2.0 + shadows.
    const QDPR = { low: 1.0, med: 1.5, high: 2.0 };
    let _q = "med";
    try { _q = (JSON.parse(localStorage.getItem("ffg_settings") || "{}").quality) || "med"; } catch (e) {}
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QDPR[_q] || 1.5));
    this.renderer.shadowMap.enabled = _q !== "low";
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // live-apply hook for the shell's QUALITY buttons
    {
      const kr = this.renderer;
      window.FFG = window.FFG || {};
      window.FFG.applyQuality = function (q) {
        kr.setPixelRatio(Math.min(window.devicePixelRatio || 1, QDPR[q] || 1.5));
        kr.shadowMap.enabled = q !== "low";
        kr.shadowMap.needsUpdate = true;
      };
    }
    // AgX is the modern filmic tonemap (Blender 4.0 default, three r0.160+) — it
    // grades HDR far more naturally than ACES (softer highlight roll-off, no neon
    // clipping). Feature-detected with an ACES fallback for older builds.
    this.renderer.toneMapping = (THREE.AgXToneMapping != null) ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Lights — hemisphere fill + key sun with shadows.
    const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x223344, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(40, 70, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); // 1024 is plenty; 2048 quadruples the shadow-pass cost
    const d = 80;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.far = 250;
    this.scene.add(sun);
    this.sun = sun;

    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.loader = new GLTFLoader();
    this._gltfCache = {};
    this._charCache = {};
    this._mixers = [];
    this._updaters = [];
    this._tweens = [];
    this._running = false;
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
    this._resize();
    window.addEventListener("resize", () => this._resize());
    return this;
  }

  _resize() {
    const w = this.parent.clientWidth || window.innerWidth;
    const h = this.parent.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, true);   // updateStyle:true — canvas CSS must match window, else it displays at drawing-buffer size (DPR×) and overflows/cuts off on HiDPI
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    if (this.composer) this.composer.setSize(w, h);
  }

  // Optional post-processing: HDR bloom over the emissive elements (glowing
  // grids, tracers, hazards, sci-fi trim) for a far more "next-gen" look. Genres
  // opt in via enableBloom(); the render loop then draws through the composer.
  enableBloom(opts) {
    opts = opts || {};
    const w = this.parent.clientWidth || window.innerWidth;
    const h = this.parent.clientHeight || window.innerHeight;
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(this.scene, this.camera));
    // Ambient occlusion (contact shadows) — grounds props + units in their
    // environment, the single biggest "not flat-lit" fidelity jump. PREFER GTAO
    // (ground-truth AO: physically-based horizon-search, far cleaner + less
    // haloing than SSAO) when the addon is present; fall back to SSAO; and if
    // BOTH throw, render bloom-only. Every branch is try/caught so a missing or
    // broken pass can never break the render loop.
    if (opts.ssao || opts.gtao) {
      const wantGTAO = opts.gtao !== false; // default on whenever AO is requested
      let aoAdded = false;
      if (wantGTAO && typeof GTAOPass !== "undefined") {
        try {
          const gtao = new GTAOPass(this.scene, this.camera, w, h);
          // Subtle, tactical AO — readable contact shadows without crushing the
          // moody mid-tones into mud. radius in world units (our tile ~ 2.4u).
          gtao.output = (GTAOPass.OUTPUT && GTAOPass.OUTPUT.Default != null) ? GTAOPass.OUTPUT.Default : 0;
          gtao.blendIntensity = opts.aoIntensity != null ? opts.aoIntensity : 0.9;
          try { gtao.updateGtaoMaterial({ radius: opts.ssaoRadius != null ? opts.ssaoRadius : 1.1, distanceExponent: 1.0, thickness: 1.0, scale: 1.0, samples: 16 }); } catch (e2) {}
          composer.addPass(gtao);
          this.gtao = gtao; aoAdded = true;
        } catch (e) { console.warn("[kernel] GTAO unavailable, trying SSAO:", e && e.message); }
      }
      if (!aoAdded) {
        try {
          const ssao = new SSAOPass(this.scene, this.camera, w, h);
          ssao.kernelRadius = opts.ssaoRadius != null ? opts.ssaoRadius : 1.1;
          ssao.minDistance = opts.ssaoMin != null ? opts.ssaoMin : 0.0015;
          ssao.maxDistance = opts.ssaoMax != null ? opts.ssaoMax : 0.06;
          composer.addPass(ssao);
          this.ssao = ssao;
        } catch (e) { console.warn("[kernel] SSAO unavailable:", e && e.message); }
      }
    }
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h),
      opts.strength != null ? opts.strength : 0.6,
      opts.radius != null ? opts.radius : 0.5,
      opts.threshold != null ? opts.threshold : 0.85);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    // SMAA — sharp morphological edge AA over the FINAL graded frame (after
    // OutputPass tonemap/colorspace). Cleans the stair-stepping on building +
    // unit silhouettes that the renderer's MSAA can't touch through the
    // composer. Last pass, feature-detected + try/caught (falls back to none).
    if (opts.smaa !== false && typeof SMAAPass !== "undefined") {
      try {
        const smaa = new SMAAPass(w, h);
        composer.addPass(smaa);
        this.smaa = smaa;
      } catch (e) { console.warn("[kernel] SMAA unavailable:", e && e.message); }
    }
    this.composer = composer;
    this.bloom = bloom;
    return composer;
  }

  // IMAGE-BASED LIGHTING (IBL): prefilter an equirectangular sky into a PMREM
  // environment map and set it as scene.environment, so EVERY PBR material
  // (MeshStandard/Physical) picks up real sky-tinted ambient + reflections instead
  // of flat fill light. This is the single biggest "not-flat / not-low-poly"
  // fidelity jump in three.js, and it's effectively free at runtime (prefiltered
  // mips, generated once). Pass the scene's sky CanvasTexture; intensity tunes it.
  setEnvironment(equirectTex, intensity) {
    try {
      if (!equirectTex) return null;
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      pmrem.compileEquirectangularShader();
      const env = pmrem.fromEquirectangular(equirectTex).texture;
      this.scene.environment = env;
      if ("environmentIntensity" in this.scene) this.scene.environmentIntensity = intensity != null ? intensity : 1.0;
      pmrem.dispose();
      if (this.env) this.env.dispose();
      this.env = env;
      return env;
    } catch (e) { console.warn("[kernel] IBL environment unavailable:", e && e.message); return null; }
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
    const gltf = await this.loader.loadAsync(url);
    const root = gltf.scene;
    const _lts = [];
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } else if (o.isLight) _lts.push(o); });
    _lts.forEach((l) => l.parent && l.parent.remove(l)); // models must NOT bring their own lights — each extra light recompiles + costs every material (big FPS hit)
    this._gltfCache[url] = root;
    return root.clone(true);
  }

  /** Load a RIGGED + ANIMATED glTF (soldiers, robots). Returns a fresh instance:
   * { scene, mixer, actions, play(name,opts), animations }. Uses SkeletonUtils to
   * clone skinned meshes correctly, wires an AnimationMixer, and registers it for
   * per-frame updates. `play(name)` crossfades to a clip (loops by default). */
  async loadCharacter(url) {
    if (!this._charCache[url]) {
      const gltf = await this.loader.loadAsync(url);
      const _lts = [];
      gltf.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } else if (o.isLight) _lts.push(o); });
      _lts.forEach((l) => l.parent && l.parent.remove(l)); // strip model-embedded lights (FPS: fewer lights = far cheaper shading)
      this._charCache[url] = gltf;
    }
    const gltf = this._charCache[url];
    const scene = skeletonClone(gltf.scene);
    const mixer = new THREE.AnimationMixer(scene);
    this._mixers.push(mixer);
    const actions = {};
    (gltf.animations || []).forEach((clip) => {
      const act = mixer.clipAction(clip);
      actions[clip.name] = act;
      // FBX2glTF exports name clips "<Armature>|Idle"; callers crossfade bare
      // names ("Idle"/"Walk"/"Run"). Alias the part after the last "|" so both
      // forms resolve (additive — never clobbers an existing exact name).
      const bar = clip.name.lastIndexOf("|");
      if (bar >= 0) { const s = clip.name.slice(bar + 1); if (!(s in actions)) actions[s] = act; }
    });
    let current = null;
    function play(name, opts) {
      opts = opts || {};
      const next = actions[name]; if (!next) return null;
      if (current === next && !opts.force) return next;
      next.reset();
      next.setLoop(opts.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = !!opts.once;
      next.enabled = true; next.setEffectiveTimeScale(opts.timeScale || 1); next.setEffectiveWeight(1);
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
    if (this._running) return;
    this._running = true;
    const loop = () => {
      if (!this._running) return;
      const dt = Math.min(0.05, this.clock.getDelta());
      this._stepTweens(dt);
      if (this.world) {
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
      }
      for (let i = 0; i < this._mixers.length; i++) this._mixers[i].update(dt);
      for (const u of this._updaters) u(dt, this.clock.elapsedTime);
      if (this.composer) this.composer.render(dt); else this.renderer.render(this.scene, this.camera);
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() { this._running = false; if (this._raf) cancelAnimationFrame(this._raf); }
}

function _get(obj, path) { return path.split(".").reduce((o, k) => o[k], obj); }
function _set(obj, path, v) {
  const parts = path.split("."); const last = parts.pop();
  parts.reduce((o, k) => o[k], obj)[last] = v;
}

export async function boot3d(content) {
  const builder = genres3d[content.genre];
  if (!builder) { console.error("[FFG3D] no 3D runtime for genre:", content.genre, "have:", Object.keys(genres3d)); return null; }
  const kernel = new Kernel3D(content).mount(content.parent || "game-container");
  const controller = await builder(kernel, content);
  kernel.start();
  window.__FFG3D__ = { kernel, controller, content };
  return controller;
}

// tooling parity
if (typeof window !== "undefined") {
  window.FFG = window.FFG || {};
  window.FFG.genres3d = genres3d;
  window.FFG.boot3d = boot3d;
  window.FFG.VERSION3D = "2.0.0";
}
