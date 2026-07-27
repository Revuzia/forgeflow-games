/**
 * Post-processing — the finishing pass over the raw forward render.
 *
 * Measured before this existed: 1.40 ms/frame GPU-inclusive at 1920x1080 on an
 * RTX A2000 Laptop, against a 16.6 ms budget at 60 Hz. Roughly 15 ms of unused
 * headroom, and the image was reading flat: sunlight on bronze made no bloom,
 * fighters cast a shadow but had no contact darkening tying them to the sand,
 * and a midday desert arena had no atmosphere at the edges of frame.
 *
 * WHY A COMPOSER IS SAFE HERE
 * The one real cost of EffectComposer is losing the driver's MSAA, because you
 * render into an offscreen target instead of the default framebuffer. WebGL2
 * gives that back: a WebGLRenderTarget with `samples` is multisampled, so edge
 * quality is preserved rather than traded for bloom.
 *
 * TONE MAPPING MOVES.
 * Once a composer is in play, ACES must run ONCE, at the very end, on the
 * accumulated HDR result — not on the render pass and again on output. That is
 * exactly what OutputPass does: it reads `renderer.toneMapping` and
 * `toneMappingExposure` and applies them last. boot.js keeps driving
 * `toneMappingExposure` per frame from the sky, and it keeps working, because
 * OutputPass reads that live value. Applying it twice is what turns a sunset
 * into a white page.
 *
 * Everything degrades. `enabled === false` restores a plain
 * `renderer.render(scene, camera)` with no behavioural change, and any pass
 * that fails to construct is skipped rather than taking the frame down — a
 * CDN hiccup on one addon must not cost the player the whole game.
 */

import * as THREE from "three";

// Passes are imported dynamically so a single failed CDN fetch degrades to the
// plain renderer instead of throwing during module evaluation and blanking the
// canvas before the loading overlay has even cleared.
let EffectComposer, RenderPass, UnrealBloomPass, OutputPass, ShaderPass;

async function loadPasses() {
  const base = "three/addons/postprocessing/";
  [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { ShaderPass }] =
    await Promise.all([
      import(base + "EffectComposer.js"),
      import(base + "RenderPass.js"),
      import(base + "UnrealBloomPass.js"),
      import(base + "OutputPass.js"),
      import(base + "ShaderPass.js"),
    ]);
}

/**
 * Grade + vignette, one full-screen triangle's worth of work.
 *
 * Deliberately restrained. The arena is a real place with real reference: warm
 * bounce off ochre sand into the shadow side of everything, and a slight cool
 * fall-off toward the stone. Pushing further than this makes it look like a
 * filter rather than light.
 */
const GradeShader = {
  uniforms: {
    tDiffuse:   { value: null },
    uVignette:  { value: 0.42 },   // 0 = none
    uWarmth:    { value: 0.055 },  // warm lift in the low end (sand bounce)
    uContrast:  { value: 1.055 },
    uSaturation:{ value: 1.06 },
    uDust:      { value: 0.0 },    // raised during a bout: haze kicked off the sand
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uVignette, uWarmth, uContrast, uSaturation, uDust;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 c = texel.rgb;

      // Warm bounce, weighted into the shadows so highlights stay neutral.
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c += vec3(uWarmth, uWarmth * 0.62, uWarmth * 0.18) * (1.0 - luma);

      // Contrast about mid-grey, then saturation about luma.
      c = (c - 0.5) * uContrast + 0.5;
      c = mix(vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))), c, uSaturation);

      // Airborne dust: lifts the black point slightly and warms it. Driven by
      // the bout so the arena literally gets hazier as the sand is churned.
      c = mix(c, c + vec3(0.055, 0.040, 0.022), uDust);

      // Vignette on a squared radial falloff — cheap, and it pulls the eye to
      // the centre of the sand where the fight is.
      vec2 p = vUv - 0.5;
      float r = dot(p, p);
      c *= 1.0 - uVignette * r * 1.25;

      gl_FragColor = vec4(max(c, 0.0), texel.a);
    }
  `,
};

export class Post {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   * @param {object} opts { quality: "low"|"medium"|"high"|"ultra" }
   */
  constructor(renderer, scene, camera, { quality = "high" } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.quality = quality;
    this.composer = null;
    this.bloom = null;
    this.grade = null;
    this.enabled = false;
    this.ready = false;
    this._dust = 0;
    this._shake = { t: 0, dur: 0, amp: 0 };
  }

  /** Build the chain. Safe to await; never throws. */
  async init() {
    // "low" is an explicit opt-out: the tier exists for machines that are
    // already struggling, and post is the first thing that should go.
    if (this.quality === "low") return false;
    try {
      if (!EffectComposer) await loadPasses();

      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      // WebGL2 multisampled target — this is what buys back the MSAA that a
      // composer would otherwise cost. 4x on high/ultra, 2x on medium.
      const samples = this.quality === "medium" ? 2 : 4;
      const target = new THREE.WebGLRenderTarget(size.x, size.y, {
        type: THREE.HalfFloatType,     // HDR headroom so bloom has something to find
        samples,
      });

      this.composer = new EffectComposer(this.renderer, target);
      this.composer.addPass(new RenderPass(this.scene, this.camera));

      // Bloom: threshold high enough that only genuine speculars and the sun
      // disc bloom. A low threshold makes bright sand glow, which reads as fog.
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(size.x, size.y),
        this.quality === "ultra" ? 0.38 : 0.30,   // strength
        0.55,                                      // radius
        0.86                                       // threshold
      );
      this.composer.addPass(this.bloom);

      this.grade = new ShaderPass(GradeShader);
      this.composer.addPass(this.grade);

      // MUST be last: applies renderer.toneMapping + exposure once, on the
      // accumulated result, then converts to the output colour space.
      this.composer.addPass(new OutputPass());

      this.enabled = true;
      this.ready = true;
      return true;
    } catch (e) {
      console.warn("[post] disabled — falling back to direct render:", e && e.message);
      this.composer = null;
      this.enabled = false;
      return false;
    }
  }

  setQuality(q) {
    this.quality = q;
    if (q === "low") { this.enabled = false; return; }
    if (this.bloom) this.bloom.strength = q === "ultra" ? 0.38 : 0.30;
    this.enabled = !!this.composer;
  }

  setEnabled(on) { this.enabled = !!on && !!this.composer; }

  /**
   * Dust haze, 0..1. The bout raises this as the sand is churned so the arena
   * visibly thickens over a long fight instead of staying pristine.
   */
  setDust(v) { this._dust = Math.max(0, Math.min(1, v)); }

  /**
   * A screen-space impact punch: a brief contrast/vignette bite on the frame.
   *
   * Deliberately NOT a camera shake. CombatCamera.addShake already owns moving
   * the camera, and a second system nudging the same transform would fight the
   * damping it does to keep a fight readable. This is the other half of the
   * effect — the image reacting, not the lens moving — so the two layer
   * instead of competing.
   */
  impact(amp = 1, dur = 0.22) {
    // Strongest wins rather than summing; a flurry should not stack into an
    // unreadable strobe.
    if (amp * dur >= this._shake.amp * Math.max(this._shake.dur - this._shake.t, 0)) {
      this._shake = { t: 0, dur, amp: Math.min(amp, 1.4) };
    }
  }

  resize(w, h) {
    if (this.composer) this.composer.setSize(w, h);
    if (this.bloom && this.bloom.resolution) this.bloom.resolution.set(w, h);
  }

  update(dt) {
    if (!this.grade) return;
    const u = this.grade.uniforms;
    // Ease toward the target so haze builds and clears smoothly.
    u.uDust.value += (this._dust - u.uDust.value) * Math.min(1, dt * 1.6);

    const s = this._shake;
    let punch = 0;
    if (s.dur > 0) {
      s.t += dt;
      if (s.t >= s.dur) this._shake = { t: 0, dur: 0, amp: 0 };
      else { const k = 1 - s.t / s.dur; punch = s.amp * k * k; }
    }
    // Bite the vignette in and lift contrast for the duration of the punch.
    u.uVignette.value = 0.42 + punch * 0.30;
    u.uContrast.value = 1.055 + punch * 0.085;
  }

  /** Draw one frame. Falls back to a plain render whenever post is off. */
  render() {
    if (this.enabled && this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  stats() {
    return {
      enabled: this.enabled, ready: this.ready, quality: this.quality,
      passes: this.composer ? this.composer.passes.length : 0,
      bloomStrength: this.bloom ? this.bloom.strength : null,
      dust: this.grade ? +this.grade.uniforms.uDust.value.toFixed(3) : null,
    };
  }
}
