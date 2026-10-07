// HaloQuad: a camera-facing additive glow billboard (the core halo, the rarity aura rings). It lives in the OPAQUE list
// (so the jelly refracts it), depth-tested, and fades with height above the table: the table plane would otherwise slice the
// sprite along a hard straight line (the "seam" seen on the low tier, where nothing blurs it).
import * as THREE from 'three';

/**
 * ADDITIVE light for an object in the OPAQUE list (the jelly refracts it through the transmission pass): the colour is added as usual, the destination ALPHA is left alone.
 * three's AdditiveBlending adds the source alpha (1.0 here) to the destination alpha too, and the transmission render target is HALF FLOAT: it does not clamp, so inside the rect of
 * a halo / pool quad it held alpha 2 instead of 1, and a transmissive object standing there (the waiting capsule beside a Rare-or-better body, inside its aura quad) read that alpha
 * as "clear": an empty glass hoop instead of the frosted capsule (VERIFY_RENDER_B B-m7: capsule box luma 61.7 -> 105.6 once this was held at 1; the canvas is alpha-opaque anyway).
 * Every fragment shader using this writes alpha 1.0, so the colour term is src.rgb x 1, i.e. identical to AdditiveBlending.
 */
export const ADD_KEEP_ALPHA = {
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
} as const;

const VERT = /* glsl */`
varying vec2 vP;
varying float vWY;
uniform vec3 uCenter;
uniform float uSize;
void main() {
  vP = position.xy;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = uCenter + (right * position.x + up * position.y) * uSize;
  vWY = wp.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const FRAG = /* glsl */`
varying vec2 vP;
varying float vWY;
uniform vec3 uColor;
uniform float uStrength;
uniform float uRing;       // 0 = solid glow, 1 = a soft ring hugging the silhouette
uniform float uFadeH;      // height above the table over which the sprite fades in
void main() {
  float r = length(vP);
  float solid = exp(-r * r * 5.0) * (1.0 - smoothstep(0.55, 1.0, r));
  float ring = exp(-pow((r - 0.62) * 8.0, 2.0)) * (1.0 - smoothstep(0.72, 0.9, r));
  float a = mix(solid, ring, uRing) * uStrength * smoothstep(0.0, uFadeH, vWY);
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class HaloQuad {
  readonly mesh: THREE.Mesh;
  readonly center = new THREE.Vector3();
  private readonly geo = new THREE.PlaneGeometry(2, 2);
  private readonly mat: THREE.ShaderMaterial;

  constructor(opts: { ring?: number; fadeH?: number; renderOrder?: number } = {}) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, fog: false,
      uniforms: {
        uCenter: { value: this.center }, uSize: { value: 1 }, uColor: { value: new THREE.Color(1, 0.6, 0.3) },
        uStrength: { value: 0 }, uRing: { value: opts.ring ?? 0 }, uFadeH: { value: opts.fadeH ?? 0.2 },
      },
      transparent: false, depthWrite: false, depthTest: true, ...ADD_KEEP_ALPHA,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opts.renderOrder ?? -19;
  }

  set(cx: number, cy: number, cz: number, size: number, strength: number): void {
    this.center.set(cx, cy, cz);
    this.mat.uniforms.uSize.value = size;
    this.mat.uniforms.uStrength.value = strength;
    this.mesh.visible = strength > 0.002;
  }
  setColor(r: number, g: number, b: number): void { this.mat.uniforms.uColor.value.setRGB(r, g, b, THREE.LinearSRGBColorSpace); }
  setRing(k: number): void { this.mat.uniforms.uRing.value = k; }
  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}
