// DEWPOINT renderer: owns the WebGL context, scene, lights, follow camera and quality scaling.
// It only READS sim state (interpolating between the last two ticks); it never changes it.
//
// The look ("storybook kiln works", DESIGN-V2.md): cel-lit flat colour with coloured shadows, and
// every outline drawn by one ink pass over the finished picture (ink.js). Light per theme is a
// hemisphere (the shadow colour), one shadow-casting key (the sun or the moon) and - only in the
// Fire themes, where there is darkness for it to show against - the hero's own flickering light.

import * as THREE from '../../vendor/three.module.min.js';
import { Particles, Glows, Prints } from './particles.js';
import { Flames } from './flame.js';
import { createHero } from './hero/index.js';
import { buildWorld, buildBackdrop } from './world.js';
import { resolveTheme } from './themes.js';
import { FADE, FADE_N, withOutlineNormals, hullMaterial } from './geo.js';
import { InkPass, assignLayers } from './ink.js';
import { CameraRig } from './camera.js';                  // the follow camera (pure maths, also run by the Node tests)

// Quality tiers. 'auto' walks between them from measured frame time. The look is the same on all
// three - cel bands, coloured shadows, inked outlines - only its finish changes:
//   dpr       drawing-buffer scale (capped by the device)
//   shadow    size of the key light's shadow map (0: none; the mark under the hero stays)
//   samples   multisampling of the scene buffer the ink pass reads
//   taps      texture taps of the ink pass (4: plain line, 8: rounder, 12: with a soft shoulder)
//   fx        how much of the baked light/atmosphere to draw (0 = only what tells the player
//             something: beacons, zone volumes, airflow; 1 = plus light pools; 2 = plus shafts and haze)
//   contact   contact shades; shimmer: heat ripple in the ink pass; flames: the small extra tongues
//   particles / ambient   particle budget, and the drifting dust / ember / mist
const TIERS = [
  { name: 'low', dpr: 1, shadow: 0, samples: 0, taps: 4, particles: 0.4, fx: 0, contact: false, shimmer: false, flames: false, ambient: 0.35 },
  { name: 'medium', dpr: 1.5, shadow: 1024, samples: 0, taps: 8, particles: 0.8, fx: 1, contact: true, shimmer: true, flames: true, ambient: 0.8 },
  { name: 'high', dpr: 2, shadow: 1536, samples: 4, taps: 12, particles: 1, fx: 2, contact: true, shimmer: true, flames: true, ambient: 1 },
];


const _l = new THREE.Vector3();

export class Renderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    // No multisampling on the canvas itself: the scene is drawn into the ink pass's own buffer.
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.NoToneMapping;       // flat colour: what is painted is what is shown
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.info.autoReset = false;   // reset by hand so every pass of a frame is counted in draw calls

    this.theme = resolveTheme(null);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(this.theme.fog, this.theme.fogNear, this.theme.fogFar);
    this.gl.setClearColor(this.theme.fog, 1);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.15, 900);
    this.ink = new InkPass(this.gl);
    this.outlineMode = 'post';        // 'post' (the ink pass) | 'hull' | 'none': the last two only for measuring against it

    // lights: a hemisphere (what a face shows in shadow), the key (the one shadow caster) and the
    // hero's own glow. Everything else that glows is baked into light pools (fx.js), not real lights.
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, Math.PI);
    this.key = new THREE.DirectionalLight(0xffffff, Math.PI);
    this.key.castShadow = true;
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.03;
    this.keyDir = new THREE.Vector3(-0.45, 1, 0.38).normalize();
    this.scene.add(this.hemi, this.key, this.key.target);
    this.moteLight = new THREE.PointLight(0x5fe6ff, 14, 10, 1.5);
    this.scene.add(this.moteLight);

    this.particles = new Particles(opts.maxParticles || 900);
    this.glows = new Glows(192);
    this.prints = new Prints(48);
    this.flames = new Flames(220);
    // the hero: one view per element, built the first time a level of that element is shown
    this.heroes = {};
    this.hero = this._heroFor('water');
    this.scene.add(this.prints.mesh, ...this.hero.sceneObjects, this.glows.mesh, this.flames.mesh, this.particles.mesh);
    assignLayers(this.scene);
    this.hulls = [];
    this.lightCtx = { rm: false, time: 0 };

    this.world = null; this.backdrop = null; this.sim = null;

    // the camera rig (camera.js): yaw, pitch, distance, the point it follows, the walls it cuts away
    this.cam = new CameraRig();
    this.portrait = false;
    this.reducedMotion = false;
    this.mode = 'play';        // 'play' | 'attract' (slow orbit behind menus)
    this.time = 0;
    this.ambAcc = 0;

    // quality
    this.qualitySetting = 'auto';
    this.tier = opts.startTier === undefined ? 2 : opts.startTier;
    this.autoCeil = 2;
    this.maxDpr = Math.min(2, opts.deviceDpr || 1);
    this.frameAvg = 16.7; this.fpsAvg = 60; this.cpuAvg = 0;
    this.winSum = 0; this.winN = 0; this.goodFor = 0; this.cooldown = 3; this.upgrades = 0;
    this.width = 1; this.height = 1; this.pixelRatio = 1;
    this.lastCalls = 0; this.lastTris = 0;
    this._applyTier();
  }

  /** The hero view of an element (Mote for water, Cinder for fire ...), created on first use. */
  _heroFor(element) {
    if (!this.heroes[element]) { this.heroes[element] = createHero(element, this.particles, this.prints, this.flames); this.flames.pin(); }
    return this.heroes[element];
  }
  /** The hero on screen. (`mote` is its old name, kept for tools that poke at the renderer.) */
  get mote() { return this.hero; }

  // ------------------------------------------------------------------ level
  setLevel(sim) {
    if (this.world) { this.scene.remove(this.world.group); this.world.dispose(); }
    this.flames.clear();
    const hero = this._heroFor(sim.element.id);
    if (hero !== this.hero) {
      this.scene.remove(...this.hero.sceneObjects);
      this.hero.hide();
      this.hero = hero;
      this.scene.add(...hero.sceneObjects);
    }
    if (this.backdrop) { this.scene.remove(this.backdrop.group); this.backdrop.dispose(); }
    this.particles.clear(); this.glows.clear(); this.prints.clear();
    this.sim = sim;
    // thin static walls and slabs: seen between the camera and the hero they are cut away (camera.js) rather than shortening the view
    this.cam.setLevel(sim);
    FADE.uniforms.uFadeN.value = 0;
    this._applyTheme(resolveTheme(sim.level));
    const pr = hero.cfg.print;
    if (pr) this.prints.setLook(pr.inner, pr.rim, pr.glow || 0);
    this.world = buildWorld(sim, { particles: this.particles, glows: this.glows, flames: this.flames, theme: this.theme, sunDir: this.keyDir });
    this.backdrop = buildBackdrop(sim.level.bounds, this.theme, this.keyDir);
    this.scene.add(this.backdrop.group, this.world.group);
    assignLayers(this.scene);
    this._hulls();
    this._applyTierToWorld();
    this._warmFade();
    this.snap();
  }

  /** The 'hull' comparison mode: a pushed-out, back-face copy of every outlined mesh. Off in the game. */
  _hulls() {
    for (const h of this.hulls) h.parent && h.parent.remove(h);
    this.hulls.length = 0;
    if (this.outlineMode !== 'hull' || !this.world) return;
    const add = (m) => {
      const h = m.isInstancedMesh ? new THREE.InstancedMesh(withOutlineNormals(m.geometry), hullMaterial(), m.count) : new THREE.Mesh(withOutlineNormals(m.geometry), hullMaterial());
      if (m.isInstancedMesh) { h.instanceMatrix = m.instanceMatrix; h.frustumCulled = false; }
      h.layers.set(0);
      m.add(h); this.hulls.push(h);
    };
    for (const m of this.world.outlined) add(m);
    this.hero.group.traverse((o) => { if (o.isMesh && !o.material.transparent && o.geometry.attributes.normal && !this.hulls.includes(o) && o.material !== hullMaterial()) add(o); });
  }

  /**
   * Compile the cut-away ("fade") variants of the wall materials now, so the first wall that fades
   * does not hitch the frame - and ONLY those.
   *
   * An earlier version compiled the whole scene up front (renderer.compile(scene)). That links a
   * program for every material in the level, drawn or not, and a level's own materials are disposed
   * when the next level loads. A program that was linked but never drawn with is then deleted while
   * the browser's link-completion bookkeeping still names it, and Chrome logs
   * "GL_INVALID_VALUE: glGetProgramiv: Program object expected" for each (about four per level
   * change; once the id has been reused, "Expected a program name, but found a shader name").
   * Measured: no up-front compile, clean console; whole-scene compile, the warnings.
   * So: the fade variants are the only thing compiled ahead of use, through a throwaway scene that
   * holds just them (lit as the real scene is), and every one of them is a material that lives for
   * the whole page (geo.js matCache, world.js decorFade), so its program is never deleted at all.
   * Everything else compiles when it is first drawn, as before.
   */
  _warmFade() {
    const warm = new THREE.Scene(), seen = new Set();
    for (const v of this.world.fadeVariants) {
      if (seen.has(v.fade)) continue;
      seen.add(v.fade);
      const m = v.mesh.isInstancedMesh ? new THREE.InstancedMesh(v.mesh.geometry, v.fade, 1) : new THREE.Mesh(v.mesh.geometry, v.fade);
      m.receiveShadow = v.mesh.receiveShadow;
      warm.add(m);
    }
    if (!seen.size) return;
    // (into the ink pass's buffer: a program is specific to what it draws into)
    try { this.gl.setRenderTarget(this.ink.rt); this.gl.compile(warm, this.camera, this.scene); } catch (e) { /* then they compile at first use instead */ }
    this.gl.setRenderTarget(null);
  }

  _applyTheme(t) {
    this.theme = t;
    this.scene.fog.color.set(t.fog); this.scene.fog.near = t.fogNear; this.scene.fog.far = t.fogFar;
    this.gl.setClearColor(t.fog, 1);
    this.hemi.color.setRGB(t.hemi[0][0], t.hemi[0][1], t.hemi[0][2]); this.hemi.groundColor.setRGB(t.hemi[1][0], t.hemi[1][1], t.hemi[1][2]);
    this.key.color.setRGB(t.key[0][0], t.key[0][1], t.key[0][2]);
    this.keyDir.set(t.sun[0], t.sun[1], t.sun[2]).normalize();
    // the hero's light only exists where there is darkness for it to show against (a light fewer in every shader by day)
    this.moteLight.visible = t.moteLight > 0;
    this.ink.setTheme(t);
    hullMaterial().uniforms.uInkCol.value.set(t.ink);
    this.particles.solidBright = 0.7 * (1 - t.dark);
    this.particles.setFog(t.fogNear, t.fogFar); this.glows.setFog(t.fogNear, t.fogFar); this.flames.uniforms.uFogNF.value.set(t.fogNear, t.fogFar);
    this.glows.gain = t.glowK;
    this.flames.uniforms.uSolid.value = 0.92 - 0.4 * t.dark;
  }

  /** Jump the camera and Mote view straight to the sim state (level start, respawn, teleport). */
  snap() {
    if (!this.sim) return;
    const p = this.sim.player;
    this.mote.snap(this.sim);
    this.cam.snap(p);
  }

  onEvent(e) {
    if (!this.sim) return;
    this.mote.onEvent(e, this.sim);
    this.world.onEvent(e);
    if (e.type === 'respawn') {
      // follow quickly rather than cutting: keeps orientation, avoids a long pan
      this.cam.follow(this.sim.player);
    }
  }

  // ------------------------------------------------------------------ camera input
  /** Orbit by a pointer delta in CSS pixels. */
  orbit(dxPx, dyPx, sensitivity = 1, invertY = false) { this.cam.orbit(dxPx, dyPx, sensitivity, invertY); }
  /** Orbit at a rate (gamepad right stick), radians-ish per second. */
  orbitRate(rx, ry, dt, sensitivity = 1, invertY = false) { this.cam.orbitRate(rx, ry, dt, sensitivity, invertY); }

  get yaw() { return this.cam.yaw; }
  /** The yaw the stick is read against this frame (camera.js steer): the camera's own yaw, caught while a direction is held. */
  get controlYaw() { return this.cam.controlYaw; }
  /** The merged camera-space stick, once per frame before the sim steps. */
  steer(x, y) { this.cam.steer(x, y); }
  // the rig reads these (they are set by main.js and resize())
  get mode() { return this.cam.mode; }
  set mode(v) { this.cam.mode = v; }
  get portrait() { return this.cam.portrait; }
  set portrait(v) { this.cam.portrait = v; }
  get reducedMotion() { return this.cam.reducedMotion; }
  set reducedMotion(v) { this.cam.reducedMotion = v; }

  _updateCamera(dt, moveX) {
    const c = this.cam;
    c.update(dt, moveX, this.mote.pos);
    this.camera.position.set(c.pos.x, c.pos.y, c.pos.z);
    this.camera.lookAt(c.look.x, c.look.y - 0.25, c.look.z);
    this._updateFade();
    // behind the title menu, the picture slides up so the hero sits in the clear upper part of the screen;
    // in portrait play, down a touch so more of the way ahead is in view (the rig eases c.lookDrop)
    if (Math.abs(c.lookDrop) > 0.002) this.camera.setViewOffset(this.width, this.height, 0, this.height * c.lookDrop, this.width, this.height);
    else if (this.camera.view) this.camera.clearViewOffset();
  }

  /**
   * Occluder fading: the rig (camera.js) picks the walls between the camera and the hero and how far
   * each is cut away; the most cut FADE_N of them go to the cut-away shader.
   */
  _updateFade() {
    const f = this.cam.fades, u = FADE.uniforms;
    let n = 0;
    if (f.size) {
      const list = [...f.entries()].sort((a, b) => b[1].a - a[1].a);
      for (const [s, e] of list) {
        if (n >= FADE_N) break;
        u.uFade.value[n * 2].set(s.x0, s.y0, s.z0, e.a); u.uFade.value[n * 2 + 1].set(s.x1, s.y1, s.z1, 0);
        n++;
      }
      const P = this.camera.position, m = this.mote.pos;
      u.uFadeA.value.set(P.x, P.y, P.z, 0); u.uFadeB.value.set(m.x, m.y + 0.55, m.z, 0);
    }
    u.uFadeN.value = n;
    this.world.setFade(n > 0);            // only while a wall is being cut do the wall meshes pay for the cut-away shader
  }

  // ------------------------------------------------------------------ ambience
  _ambient(dt) {
    const P = this.particles, t = this.cam.target, th = this.theme, kind = th.ambient;
    const rate = (this.reducedMotion ? 0.5 : 1) * TIERS[this.tier].ambient * (kind === 'dust' ? 12 : kind === 'embers' ? 10 : kind === 'mist' ? 5 : 4);
    this.ambAcc += dt * rate;
    while (this.ambAcc > 1) {
      this.ambAcc -= 1;
      const x = t.x + (P.rnd() - 0.5) * 22, z = t.z + (P.rnd() - 0.5) * 22;
      if (kind === 'dust') {
        // motes drifting in the light
        P.spawn({ x, y: t.y - 1 + P.rnd() * 7, z, vx: 0.12 + (P.rnd() - 0.5) * 0.1, vy: (P.rnd() - 0.5) * 0.08, vz: (P.rnd() - 0.5) * 0.12, life: 4 + P.rnd() * 3, size: 0.04 + P.rnd() * 0.035, color: [1, 0.97, 0.82], alpha: 0.7 });
      } else if (kind === 'embers') {
        P.spawn({ x, y: t.y - 3 + P.rnd() * 2, z, vx: (P.rnd() - 0.5) * 0.5, vy: 0.9 + P.rnd() * 1.1, vz: (P.rnd() - 0.5) * 0.5, life: 3 + P.rnd() * 2, size: 0.05 + P.rnd() * 0.04, color: P.rnd() < 0.3 ? [1, 0.85, 0.4] : [1, 0.45, 0.12], alpha: 0.95, drag: 0.1, solid: 0.3 });
      } else if (kind === 'mist') {
        // dawn in the slip room: low white mist, and now and then a drip from above
        if (P.rnd() < 0.25) P.spawn({ x, y: t.y + 5 + P.rnd() * 2, z, vy: -1, life: 1.1, size: 0.045, color: [0.75, 0.95, 1], alpha: 0.9, gravity: 9 });
        else P.spawn({ x, y: t.y - 1.2 + P.rnd() * 0.8, z, vx: 0.14, life: 5, size: 1.3, grow: 0.2, color: [1, 0.97, 0.93], alpha: 0.2, solid: 1 });
      } else {
        // the pilot gallery: drips from the pipes, and cold mist along the floor
        if (P.rnd() < 0.55) P.spawn({ x, y: t.y + 5 + P.rnd() * 2, z, vy: -1, life: 1.1, size: 0.04, color: [0.6, 0.9, 1], alpha: 0.8, gravity: 9 });
        else P.spawn({ x, y: t.y - 0.8 + P.rnd() * 0.4, z, vx: 0.1, life: 4, size: 0.9, grow: 0.15, color: [0.42, 0.44, 0.7], alpha: 0.16, solid: 1 });
      }
    }
  }

  // ------------------------------------------------------------------ frame
  /**
   * Draw one frame. alpha = fraction of a sim tick since the last step (interpolation),
   * dt = real seconds since the previous frame, moveX = camera-space strafe input (-1..1).
   */
  render(alpha, dt, moveX = 0) {
    const sim = this.sim;
    if (!sim) return;
    this.time += dt;
    const time = this.time;
    this._updateCamera(dt, moveX);
    this.camera.updateMatrixWorld();

    // key light follows the action so one modest shadow map covers what the player sees
    const t = this.cam.target;
    this.key.target.position.set(t.x, t.y - 0.9, t.z);
    this.key.position.copy(this.key.target.position).addScaledVector(this.keyDir, 40);

    // The hero's own light (Fire themes only): a moving fire that flickers on the walls around it.
    // One light, never a shadow caster; the hero says its colour and power.
    const p = sim.player, mp = this.mote.pos;
    this.lightCtx.rm = this.reducedMotion; this.lightCtx.time = time;
    if (this.moteLight.visible) {
      const lt = this.hero.light(p.form, p, this.lightCtx), fc = lt.color;
      this.moteLight.color.setRGB(fc[0], fc[1], fc[2]);
      this.moteLight.position.set(mp.x, mp.y + 0.7, mp.z);
      this.moteLight.distance = lt.range || 10;
      this.moteLight.intensity = lt.power * this.mote.pop * this.theme.moteLight * (1 + this.mote.flash * 1.5);
    }

    _l.copy(this.keyDir).transformDirection(this.camera.matrixWorldInverse);
    this.mote.reduced = this.reducedMotion;
    this.mote.update(sim, alpha, dt, time, _l, this.camera, this.world);
    this.world.update(dt, alpha, time, t.x, t.z, this.camera.position.x, this.camera.position.z);
    if (this.mode === 'play' || this.mode === 'attract') this._ambient(dt);
    this.particles.update(dt);
    this.prints.update(dt);
    this.glows.update(time);
    this.flames.update(time, this.reducedMotion);
    if (this.backdrop) { this.backdrop.sky.position.copy(this.camera.position); this.backdrop.update(time, this.camera); }

    // heat shimmer: the hero's, and the two hottest things nearest the middle of the picture
    const sh = this.ink.shim; sh.length = 0;
    if (TIERS[this.tier].shimmer && !this.reducedMotion) {
      const hs = this.hero.shimmer ? this.hero.shimmer(p.form) : null;
      if (hs && this.mote.pop > 0.5) sh.push({ x: mp.x, y: mp.y + hs.y, z: mp.z, r: hs.r, k: hs.k });
      const list = this.world.shimmers;
      let a = null, b = null, da = 1e9, db = 1e9;
      for (let i = 0; i < list.length; i++) {
        const s = list[i]; if (!(s.k > 0.05)) continue;
        const d = (s.x - t.x) * (s.x - t.x) + (s.z - t.z) * (s.z - t.z);
        if (d < da) { b = a; db = da; a = s; da = d; } else if (d < db) { b = s; db = d; }
      }
      if (a && da < 900) sh.push(a);
      if (b && db < 900) sh.push(b);
    }

    this.gl.info.reset();
    this._draw(time);
    this.lastCalls = this.gl.info.render.calls;
    this.lastTris = this.gl.info.render.triangles;
  }

  /** One picture: the inked pipeline (or, for measuring against it, straight to the screen). */
  _draw(time) {
    if (this.outlineMode === 'post') this.ink.render(this.scene, this.camera, time);
    else this.ink.renderDirect(this.scene, this.camera);
  }

  // ------------------------------------------------------------------ sizing & quality
  resize(width, height, deviceDpr) {
    this.width = Math.max(1, width); this.height = Math.max(1, height);
    if (deviceDpr) this.maxDpr = Math.min(2, deviceDpr);
    const was = this.portrait;
    this.portrait = height > width * 1.05;
    if (was !== this.portrait && this.cam.manualT > 3) this.cam.pitch = this.cam.defaultPitch(this.sim && this.sim.player.form);
    this.camera.aspect = this.width / this.height;
    // keep a comfortable horizontal view on tall phones
    this.camera.fov = this.portrait ? 68 : 55;
    this.camera.updateProjectionMatrix();
    this._applyTier();
  }

  setQuality(setting) {
    this.qualitySetting = setting;
    if (setting === 'low') this.tier = 0;
    else if (setting === 'high') this.tier = 2;
    else { this.tier = Math.min(this.tier, this.autoCeil); this.cooldown = 2; this.goodFor = 0; this.winSum = 0; this.winN = 0; }
    this._applyTier();
  }

  _applyTier() {
    const t = TIERS[this.tier];
    this.pixelRatio = Math.min(t.dpr, this.maxDpr);
    this.gl.setPixelRatio(this.pixelRatio);
    this.gl.setSize(this.width, this.height, false);
    const bw = Math.max(1, Math.floor(this.width * this.pixelRatio)), bh = Math.max(1, Math.floor(this.height * this.pixelRatio));
    this.ink.configure(bw, bh, this.forceSamples === undefined ? t.samples : this.forceSamples, this.forceTaps === undefined ? t.taps : this.forceTaps);
    hullMaterial().uniforms.uPx.value.set(this.ink.uniforms.uRadius.value / bw, this.ink.uniforms.uRadius.value / bh);
    const shadows = t.shadow > 0;
    if (this.key.castShadow !== shadows) {
      this.key.castShadow = shadows;
      this.gl.shadowMap.needsUpdate = true;
      // materials need a recompile when the shadow-receiving state changes
      this.scene.traverse((o) => { if (o.material && o.material.isMeshToonMaterial) o.material.needsUpdate = true; });
    }
    if (shadows && this.key.shadow.mapSize.x !== t.shadow) {
      this.key.shadow.mapSize.set(t.shadow, t.shadow);
      if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; }
    }
    const sc = this.key.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 5; sc.far = 90;
    sc.updateProjectionMatrix();
    this.particles.budget = t.particles;
    this.flames.minor = t.flames;
    this._applyTierToWorld();
    // point sprites are sized in device pixels: scale with the drawing-buffer height and fov
    const px = this.height * this.pixelRatio / (2 * Math.tan(this.camera.fov * Math.PI / 360));
    this.particles.setPixelScale(px); this.glows.setPixelScale(px);
  }

  /** The parts of a level that a tier can leave out: baked light bands, contact shades. */
  _applyTierToWorld() {
    const t = TIERS[this.tier], w = this.world;
    if (!w) return;
    w.setTier(t.fx, t.contact);
  }

  /** Feed real frame time; in 'auto' this is what moves the quality tier. cpuMs = time spent in our frame callback. */
  measure(frameMs, cpuMs) {
    this.frameAvg += (frameMs - this.frameAvg) * 0.05;
    this.cpuAvg += (cpuMs - this.cpuAvg) * 0.05;
    this.fpsAvg = 1000 / Math.max(1, this.frameAvg);
    if (this.qualitySetting !== 'auto') return;
    if (frameMs > 250) return;                      // tab switch / hitch: not evidence
    if (this.cooldown > 0) { this.cooldown -= frameMs / 1000; this.winSum = 0; this.winN = 0; return; }
    this.winSum += frameMs; this.winN++;
    if (this.winN < 75) return;
    const avg = this.winSum / this.winN;
    this.winSum = 0; this.winN = 0;
    if (avg > 21.5 && this.tier > 0) {
      this.tier--; this.autoCeil = Math.min(this.autoCeil, this.tier + (this.upgrades < 1 ? 1 : 0));
      this.cooldown = 2.5; this.goodFor = 0;
      this._applyTier();
    } else if (avg < 12.5 && this.tier < this.autoCeil) {
      this.goodFor += avg * 75 / 1000;
      if (this.goodFor > 9) { this.tier++; this.upgrades++; this.goodFor = 0; this.cooldown = 4; this._applyTier(); }
    } else this.goodFor = 0;
  }

  /**
   * Honest render cost: draw n frames back to back, forcing the GPU to finish each one, and
   * return the mean milliseconds per frame. Unlike fps this does not depend on how often the
   * browser chooses to call requestAnimationFrame (a hidden or background tab throttles it).
   */
  bench(n = 60) {
    if (!this.sim) return null;
    const gl = this.gl.getContext();
    const px = new Uint8Array(4);
    this._draw(this.time);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      this.gl.info.reset();
      this._draw(this.time);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);   // blocks until the frame is really drawn
    }
    const ms = (performance.now() - t0) / n;
    return { frames: n, msPerFrame: Math.round(ms * 100) / 100, fpsCeiling: Math.round(1000 / ms), drawCalls: this.gl.info.render.calls, triangles: this.gl.info.render.triangles, pixelRatio: this.pixelRatio, quality: TIERS[this.tier].name, outline: this.outlineMode };
  }

  stats() {
    return {
      fps: Math.round(this.fpsAvg * 10) / 10,
      frameMs: Math.round(this.frameAvg * 100) / 100,
      cpuMs: Math.round(this.cpuAvg * 100) / 100,
      drawCalls: this.lastCalls,
      triangles: this.lastTris,
      quality: TIERS[this.tier].name,
      qualitySetting: this.qualitySetting,
      pixelRatio: this.pixelRatio,
      width: this.width, height: this.height,
      shadows: TIERS[this.tier].shadow,
      particles: this.particles.count,
      flames: this.flames.count || 0,
      theme: this.theme.name,
      outline: this.outlineMode, inkTaps: this.ink.taps, samples: this.ink.samples,
      areas: this.world ? this.world.chunkCount : 0, areasDrawn: this.world ? this.world.chunksDrawn : 0,
    };
  }
}
