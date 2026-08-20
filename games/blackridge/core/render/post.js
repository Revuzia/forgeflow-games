// core/render/post.js [A6] — the VT §2 post stack, VERBATIM:
//   scene render (HDR RGBA16F) → HALF-RES selective UnrealBloom (threshold
//   ≈1.0 — only authored-HDR emissives bloom: muzzle flashes, practicals,
//   neon, tracers) → ONE composite ShaderPass doing AgX tonemap + vignette +
//   luminance-weighted animated grain + radial CA + lift/gamma/gain grade +
//   contrast-adaptive sharpen + sRGB encode, in a single fragment shader.
// GTAO / TAA / motion blur / DOF / SSR are BANNED (VT §2 skip list, measured
// 28–30 fps in the reference project). Post OWNS tonemapping — gfx.js sets
// renderer.toneMapping NONE and outputColorSpace LinearSRGB; the composite
// shader applies AgX + the sRGB OETF itself.
//
// Grade identity (VT §2): lifted cool shadows (floor never pure black),
// neutral mids, desaturated highlights, global saturation ~0.9 — the frame
// reads COLD with warm sodium islands punching through.
//
// setQuality('low') = tonemap-only (bloom off, film stages skipped) per
// ARCH §3.13. Auto-resizes to the drawing buffer every frame — capture()
// (A11) and dynres both change the buffer without calling resize().
// Must not touch renderer.info (A0's reset discipline) — it doesn't.
//
// Frozen exports: createPost(ctx) → { render(scene,camera), resize(w,h),
// setQuality(q) }.

import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

// AgX from the vendored three's own chunk — declares toneMappingExposure and
// AgXToneMapping(vec3). Single source: the kernel's implementation, not a copy.
const AGX_GLSL = THREE.ShaderChunk.tonemapping_pars_fragment;

const CompositeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1920, 1080) },
    toneMappingExposure: { value: 1.12 },
    uVignette: { value: 0.30 },   // VT: 0.25–0.35, felt not seen
    uVigBoost: { value: 0 },      // deepens during ADS / low hp
    uGrain: { value: 0.024 },     // VT: 0.02–0.035, luminance-weighted
    uCA: { value: 1.0 },          // px at extreme corners (≤1.5)
    uCABoost: { value: 1 },       // ×3 for 150 ms on explosions (hook)
    uSharpen: { value: 0.2 },
    uSat: { value: 0.9 },
    uTier: { value: 2 },          // 0 = tonemap only, 1/2 = full film stages
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uRes;
    uniform float uVignette, uVigBoost, uGrain, uCA, uCABoost, uSharpen, uSat;
    uniform int uTier;
    ${AGX_GLSL}

    float brHash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    vec3 sRGB(vec3 c) {
      return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
                 step(vec3(0.0031308), c));
    }

    void main() {
      vec2 uv = vUv;
      vec2 px = 1.0 / uRes;
      vec2 fromC = uv - 0.5;
      float r2 = dot(fromC, fromC);

      vec3 hdr;
      if (uTier == 0) {
        hdr = texture2D(tDiffuse, uv).rgb;
      } else {
        // ---- chromatic aberration: radial, ZERO at centre, <=1.5 px corners
        vec2 caOff = fromC * r2 * 4.0 * uCA * uCABoost * px;
        hdr.r = texture2D(tDiffuse, uv + caOff).r;
        hdr.g = texture2D(tDiffuse, uv).g;
        hdr.b = texture2D(tDiffuse, uv - caOff).b;

        // ---- contrast-adaptive sharpen (4 cross taps, HDR domain)
        vec3 n1 = texture2D(tDiffuse, uv + vec2(px.x, 0.0)).rgb;
        vec3 n2 = texture2D(tDiffuse, uv - vec2(px.x, 0.0)).rgb;
        vec3 n3 = texture2D(tDiffuse, uv + vec2(0.0, px.y)).rgb;
        vec3 n4 = texture2D(tDiffuse, uv - vec2(0.0, px.y)).rgb;
        vec3 blur = (n1 + n2 + n3 + n4) * 0.25;
        vec3 hi = hdr - blur;
        // adapt: back off where local contrast is already high (no halos)
        float adapt = 1.0 / (1.0 + 4.0 * dot(abs(hi), vec3(0.333)));
        hdr += hi * uSharpen * adapt;
      }

      // ---- exposure + AgX (three's own kernel implementation)
      vec3 col = AgXToneMapping(hdr);

      if (uTier > 0) {
        // ---- grade: lifted cool shadows, desaturated highlights, sat 0.9
        float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(luma), col, uSat);
        // shadow lift, slightly blue — the floor never crushes to pure black
        col += vec3(0.010, 0.012, 0.020) * (1.0 - smoothstep(0.0, 0.35, luma));
        // desaturate + gently roll highlights
        float hi2 = smoothstep(0.7, 1.0, luma);
        col = mix(col, vec3(luma), hi2 * 0.25);

        // ---- vignette: wide smooth falloff, felt not seen
        float vig = 1.0 - (uVignette + uVigBoost) * smoothstep(0.15, 0.75, r2);
        col *= vig;

        // ---- film grain: animated, luminance-weighted (stronger in shadows)
        float g = brHash(uv * uRes + vec2(fract(uTime * 13.7) * 191.0,
                                          fract(uTime * 7.3) * 127.0)) - 0.5;
        col += g * uGrain * (1.0 - luma * 0.72);
      }

      gl_FragColor = vec4(sRGB(clamp(col, 0.0, 1.0)), 1.0);
    }`,
};

export function createPost(ctx) {
  const { renderer } = ctx;
  const gl = renderer.getContext();

  let composer = null;
  let renderPass = null;
  let bloomPass = null;
  let compositePass = null;
  let curW = 0, curH = 0, curPR = 1;
  let quality = ctx.settings.quality || "med";
  let time = 0;
  let caBoostT = 0;

  function build(w, h, pr) {
    // full teardown — rebuilds happen on capture/dynres size changes and the
    // bloom pass owns a mip chain of render targets that composer.dispose()
    // does not reach (leak caught in review).
    if (bloomPass && bloomPass.dispose) bloomPass.dispose();
    if (compositePass && compositePass.material) compositePass.material.dispose();
    if (composer) composer.dispose();
    curW = w; curH = h; curPR = pr;

    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, {
      type: THREE.HalfFloatType, // the HDR chain (EXT_color_buffer_float gated)
      depthBuffer: true,
      samples: 0,
    });
    composer = new EffectComposer(renderer, rt);
    composer.setPixelRatio(pr);
    composer.setSize(w, h);

    renderPass = new RenderPass(ctx.scene, ctx.camera);
    composer.addPass(renderPass);

    // HALF-RES selective bloom: threshold 1.0 → only authored >1.0 emissives
    // (practicals, neon, muzzle, tracers). VT: strength 0.25–0.4, radius 0.5–0.7.
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.max(2, Math.floor((w * pr) / 2)), Math.max(2, Math.floor((h * pr) / 2))),
      0.32, 0.58, 1.0,
    );
    bloomPass.enabled = quality !== "low";
    composer.addPass(bloomPass);

    compositePass = new ShaderPass({
      uniforms: THREE.UniformsUtils.clone(CompositeShader.uniforms),
      vertexShader: CompositeShader.vertexShader,
      fragmentShader: CompositeShader.fragmentShader,
    });
    compositePass.renderToScreen = true;
    composer.addPass(compositePass);

    applyQuality(quality);
  }

  function applyQuality(q) {
    quality = q;
    if (!compositePass) return;
    if (q === "low") {
      if (bloomPass) bloomPass.enabled = false;
      compositePass.uniforms.uTier.value = 0; // tonemap only (ARCH §3.13)
    } else {
      if (bloomPass) bloomPass.enabled = true;
      compositePass.uniforms.uTier.value = q === "high" ? 2 : 1;
    }
  }

  const api = {
    render(scene, camera) {
      // auto-track the drawing buffer: capture() and dynres change it without
      // calling resize() (capture's ctx.post fallback predates this module).
      const size = renderer.getSize(_v2);
      const pr = renderer.getPixelRatio();
      if (!composer || size.x !== curW || size.y !== curH || pr !== curPR) {
        build(size.x, size.y, pr);
      }
      renderPass.scene = scene;
      renderPass.camera = camera;

      time += 1 / 60; // grain phase; monotonic is all it needs
      const u = compositePass.uniforms;
      u.uTime.value = time;
      u.uRes.value.set(gl.drawingBufferWidth, gl.drawingBufferHeight);

      // vignette breathing: deepens during ADS + at critical hp (VT §2/§6)
      let boost = 0;
      const sim = ctx.sim && ctx.sim();
      if (sim && sim.state && sim.state.player) {
        const p = sim.state.player;
        if (p.weapon && typeof p.weapon.adsT === "number") boost += 0.05 * p.weapon.adsT;
        if (typeof p.hp === "number" && p.hp < 35) boost += 0.04 * (1 - p.hp / 35);
      }
      u.uVigBoost.value = boost;

      // CA kick decay (×3 for ~150 ms — explosions hook via api.caKick())
      if (caBoostT > 0) {
        caBoostT = Math.max(0, caBoostT - 1 / 60);
        u.uCABoost.value = 1 + 2 * (caBoostT / 0.15);
      } else {
        u.uCABoost.value = 1;
      }

      composer.render();
    },

    resize(w, h) {
      if (!composer) return;
      build(w, h, renderer.getPixelRatio());
    },

    setQuality(q) { applyQuality(q); },

    // ---- private additions ----
    caKick() { caBoostT = 0.15; }, // fx hook: explosion CA pulse (VT §2)
    setExposure(v) { if (compositePass) compositePass.uniforms.toneMappingExposure.value = v; },
  };

  const _v2 = new THREE.Vector2();

  // initial build + a prewarm hook: prewarm(renderer, scene, camera, extras)
  // has no ctx (frozen signature) — it invokes this global after its canvas
  // pass so the bloom/composite programs are compiled inside the baseline.
  build(window.innerWidth, window.innerHeight, renderer.getPixelRatio());
  globalThis.__BR_POST_WARM__ = () => {
    try { api.render(ctx.scene, ctx.camera); } catch (e) {
      console.warn("[post] warm render failed:", e && e.message);
    }
  };

  ctx.onChange("quality", (q) => applyQuality(q));
  ctx.post = api; // A11's capture() resize fallback reads ctx.post
  return api;
}
