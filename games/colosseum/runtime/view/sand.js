// Colosseum — the harena: sand surface, rake marks, footprints and blood.
//
// The arena floor is the most-looked-at surface in the game. A flat untextured
// plane reads as a placeholder no matter how good the building around it is,
// and it is also where the fight's history should accumulate: drag marks,
// scuffed sand where someone turned hard, and blood that stays.
//
// The whole thing costs ONE draw call and ONE extra texture:
//
//   * The surface detail (grain, rake furrows, patchiness) is procedural in the
//     fragment shader — no texture fetch, no download, resolution-independent.
//   * The damage (blood, scuffs, drag trails) lives in a single 1024x1024
//     render target that is drawn into on demand and sampled by the sand
//     shader. Persisting 500 blood pools costs the same as persisting one.
//
// Why a render target instead of decal meshes: decals are a draw call each and
// they z-fight on an undulating surface. Compositing into a texture that the
// ground material already samples is free at render time and never z-fights.

import * as THREE from "three";
import { ARENA } from "../data/arena_spec.js";

// ---------------------------------------------------------------------------
// Damage layer
// ---------------------------------------------------------------------------

/**
 * A persistent RGBA texture covering the arena ellipse.
 *   .r = blood amount      .g = scuff/disturbance     .b = wetness/darkness
 * Splats are drawn as additive quads through an orthographic camera.
 */
class DamageLayer {
  constructor(renderer, { size = 1024 } = {}) {
    this.renderer = renderer;
    this.size = size;

    this.rt = new THREE.WebGLRenderTarget(size, size, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });

    // Unit-square ortho space: (0,0)..(1,1) maps to the arena bounding box.
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
    this.scene = new THREE.Scene();

    this.splatMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Vector4(1, 0, 0, 1) },
        uHardness: { value: 0.45 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform vec4 uColor;
        uniform float uHardness;
        // Cheap value noise so a splat has a ragged edge rather than reading as
        // an airbrushed dot.
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
                     mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
        }
        void main() {
          vec2 d = vUv - 0.5;
          float r = length(d) * 2.0;
          float n = noise(vUv * 9.0) * 0.42 + noise(vUv * 23.0) * 0.22;
          float a = smoothstep(1.0, uHardness, r + n * 0.45);
          if (a <= 0.003) discard;
          gl_FragColor = vec4(uColor.rgb, uColor.a * a);
        }
      `,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,       // splats accumulate, never wash out
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.splatMat);
    this.scene.add(this.quad);

    this.clear();
  }

  /** Arena world XZ -> 0..1 texture space. */
  static uvFor(x, z, a = ARENA.floor.a, b = ARENA.floor.b) {
    return [(x / a) * 0.5 + 0.5, (z / b) * 0.5 + 0.5];
  }

  clear() {
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.rt);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, false, false);
    this.renderer.setRenderTarget(prev);
    this.splats = 0;
  }

  /**
   * Stamp one splat.
   * @param {number} x world X
   * @param {number} z world Z
   * @param {number} radius metres
   * @param {'blood'|'scuff'|'wet'} kind
   * @param {number} strength 0..1
   */
  splat(x, z, radius, kind = "blood", strength = 1) {
    const [u, v] = DamageLayer.uvFor(x, z);
    if (u < -0.05 || u > 1.05 || v < -0.05 || v > 1.05) return false;

    // Radius in texture space differs per axis because the arena is an ellipse
    // mapped to a square — a circular pool must become an ellipse in UV or it
    // comes out stretched on the ground.
    const ru = radius / (ARENA.floor.a * 2);
    const rv = radius / (ARENA.floor.b * 2);

    const c = this.splatMat.uniforms.uColor.value;
    if (kind === "blood") c.set(strength, 0, strength * 0.35, 1);
    else if (kind === "scuff") c.set(0, strength, 0, 1);
    else c.set(0, strength * 0.4, strength, 1);
    this.splatMat.uniforms.uHardness.value = kind === "scuff" ? 0.15 : 0.45;

    this.quad.position.set(u, v, 0);
    this.quad.scale.set(ru * 2, rv * 2, 1);

    const prev = this.renderer.getRenderTarget();
    const prevAuto = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prev);
    this.renderer.autoClear = prevAuto;
    this.splats++;
    return true;
  }

  /** A drag trail — a body being hauled to the Porta Libitinaria. */
  trail(x0, z0, x1, z1, radius = 0.35, kind = "blood", strength = 0.7) {
    const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (radius * 0.6)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.splat(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, radius * (0.75 + 0.4 * Math.random()), kind, strength);
    }
  }

  get texture() { return this.rt.texture; }

  dispose() {
    this.rt.dispose();
    this.quad.geometry.dispose();
    this.splatMat.dispose();
  }
}

// ---------------------------------------------------------------------------
// Sand material
// ---------------------------------------------------------------------------

const SAND_PARS = /* glsl */ `
  uniform sampler2D uDamage;
  uniform vec2  uArena;          // semi-axes
  uniform float uTime;
  varying vec3 vWorldPos;

  float sHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float sNoise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(sHash(i), sHash(i + vec2(1,0)), f.x),
               mix(sHash(i + vec2(0,1)), sHash(i + vec2(1,1)), f.x), f.y);
  }
  float sFbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * sNoise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
`;

const SAND_FRAG = /* glsl */ `
  vec2 wp = vWorldPos.xz;

  // --- raked furrows -------------------------------------------------------
  // The harena was raked between bouts. Concentric arcs following the ellipse
  // read as deliberate grooming and give the eye scale on an otherwise
  // featureless plane.
  float ring = length(wp / uArena);
  float rake = sin(ring * 96.0) * 0.5 + 0.5;
  rake = pow(rake, 2.2) * 0.055;

  // --- grain ---------------------------------------------------------------
  float grain  = sFbm(wp * 3.1) * 0.12;
  float coarse = sFbm(wp * 0.34) * 0.16;      // broad patchiness, damp vs dry

  // Warm ochre harena. Kept saturated — a desaturated sand reads as concrete
  // under ACES tonemapping.
  vec3 dry  = vec3(0.780, 0.648, 0.452);
  vec3 damp = vec3(0.512, 0.408, 0.288);
  vec3 col  = mix(dry, damp, clamp(coarse * 1.4, 0.0, 1.0));
  col *= (0.94 + grain);
  col -= rake;

  // --- accumulated damage --------------------------------------------------
  vec2 duv = wp / (uArena * 2.0) + 0.5;
  vec4 dmg = texture2D(uDamage, duv);

  // Scuffed sand is turned over: slightly darker and less even, not a stain.
  float scuff = clamp(dmg.g, 0.0, 1.0);
  col = mix(col, damp * 0.92, scuff * 0.45);

  // Blood soaks INTO sand rather than pooling on it, so it is a deep matte
  // oxide brown-red, not a liquid surface. It must never be the brightest
  // thing on the ground.
  float blood = clamp(dmg.r, 0.0, 1.0);
  vec3 bloodCol = mix(vec3(0.230, 0.052, 0.038), vec3(0.092, 0.017, 0.014), blood);
  col = mix(col, bloodCol, smoothstep(0.04, 0.75, blood) * 0.95);

  diffuseColor.rgb = col;
`;

const SAND_ROUGH = /* glsl */ `
  // Blood-soaked sand is only SLIGHTLY less rough than dry sand.
  //
  // Dropping roughness to 0.45 here turned every pool into a mirror: the sun's
  // specular lobe blew out through ACES and the blood rendered as a glowing
  // gold puddle — brighter than the sand it was staining. Soaked sand is damp
  // granular material, not standing liquid, so it stays firmly matte.
  vec2 duv2 = vWorldPos.xz / (uArena * 2.0) + 0.5;
  vec4 dmg2 = texture2D(uDamage, duv2);
  roughnessFactor = clamp(1.0 - dmg2.r * 0.14 - dmg2.b * 0.10, 0.78, 1.0);
`;

/**
 * Build the sand material and its damage layer.
 * @returns {{material: THREE.Material, damage: DamageLayer}}
 */
export function makeSand(renderer, { size = 1024 } = {}) {
  const damage = new DamageLayer(renderer, { size });

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1.0, metalness: 0.0, name: "harena",
  });

  mat.userData.uniforms = {
    uDamage: { value: damage.texture },
    uArena: { value: new THREE.Vector2(ARENA.floor.a, ARENA.floor.b) },
    uTime: { value: 0 },
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorldPos;")
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\n  vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;"
      );
    // worldpos_vertex only emits when the material needs it; make sure we always
    // have a world position to work from.
    if (!shader.vertexShader.includes("vWorldPos =")) {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n  vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;"
      );
    }
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + SAND_PARS)
      .replace("#include <map_fragment>", "#include <map_fragment>\n" + SAND_FRAG)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\n" + SAND_ROUGH);
    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => "colosseum_harena_v1";

  return { material: mat, damage };
}

export { DamageLayer };
