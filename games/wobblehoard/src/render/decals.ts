// The two decals that sit under every body: a soft contact shadow and the coloured light pool (fake caustic) that widens
// and brightens as the body squashes (softer and smaller in float mode). Rarity adds a caustic ring on the table (Epic and up,
// pulsing at 0.25 Hz for Legendary). Both live in the OPAQUE list (custom blending), so the jelly refracts the glow.
import * as THREE from 'three';
import { NOISE_GLSL } from './shaderlib.ts';
import type { Rgb } from './oklch.ts';
import type { TierStyle } from './rarity.ts';

const DECAL_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const SHADOW_FRAG = /* glsl */`
varying vec2 vUv;
uniform float uStrength;
uniform float uSoft;   // 1 = tight contact shadow, 0 = very soft
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r2 = dot(p, p);
  float rr = sqrt(r2);
  float tight = exp(-pow(rr / mix(0.55, 0.8, uSoft), 4.0)) * 0.85;     // dense contact shadow that ends just outside the body
  float wide = exp(-r2 * mix(1.6, 3.2, uSoft)) * 0.3;
  float edge = 1.0 - smoothstep(0.7, 1.0, rr);
  float a = clamp((tight + wide) * uStrength * edge, 0.0, 0.92);
  gl_FragColor = vec4(0.012, 0.004, 0.035, a);
}
`;
const POOL_FRAG = /* glsl */`
varying vec2 vUv;
uniform vec3 uColor;
uniform vec3 uRingCol;     // the caustic ring takes the TIER colour (it is part of the tell), not the body's pool colour
uniform float uStrength;
uniform float uTime;
uniform float uRing;       // soft caustic fringe just outside the shadow edge
uniform float uRing2;      // thin bright caustic ring (Epic and up)
${NOISE_GLSL}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float body = exp(-r * r * 5.0);
  float fringe = exp(-pow((r - 0.62) * 4.2, 2.0)) * uRing;
  float cau = 0.8 + 0.4 * whNoise2(p * 7.0 + vec2(uTime * 0.25, -uTime * 0.18));
  float edge = 1.0 - smoothstep(0.78, 1.0, r);
  // caustic ring (Epic and up): a broken, beaded band of focused light, two thin crossing filaments that slowly crawl, not a neon hoop
  float ring2 = 0.0;
  if (uRing2 > 0.001) {
    float ang = atan(p.y, p.x);
    float n1 = whNoise2(vec2(ang * 5.0 + uTime * 0.11, r * 4.0));
    float n2 = whNoise2(vec2(ang * 9.0 - uTime * 0.07, r * 6.0 + 3.7));
    float beads = pow(clamp(n1 * 0.6 + n2 * 0.6 - 0.15, 0.0, 1.0), 2.0) * 2.2;
    float f1 = exp(-pow((r - 0.79 - 0.025 * (n2 - 0.5)) * 30.0, 2.0));
    float f2 = exp(-pow((r - 0.83 + 0.03 * (n1 - 0.5)) * 38.0, 2.0));
    float glow = exp(-pow((r - 0.81) * 9.0, 2.0)) * 0.22;
    ring2 = ((f1 + 0.7 * f2) * (0.25 + beads) + glow) * uRing2 * (1.0 - smoothstep(0.9, 1.0, r));
  }
  float a = (body * 0.8 + fringe * 0.28) * cau * edge * uStrength;
  gl_FragColor = vec4(uColor * a + uRingCol * ring2 * 0.42, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface Footprint {
  cx: number; cz: number;      // body centre on the table plane
  rx: number; rz: number;      // horizontal half extents of the body
  lowY: number;                // height of the lowest vertex above the table (0 when resting)
  compression: number;         // the renderer's squeeze 0..1
  stretch: number;             // 0..1
}

/** The unit quad shared by every decal (owned and disposed by the stage). */
export function createDecalGeometry(): THREE.PlaneGeometry {
  const quad = new THREE.PlaneGeometry(2, 2);
  quad.rotateX(-Math.PI / 2);
  return quad;
}

export class Decals {
  readonly shadow: THREE.Mesh;
  readonly pool: THREE.Mesh;
  private readonly shadowMat: THREE.ShaderMaterial;
  private readonly poolMat: THREE.ShaderMaterial;
  private poolK = 1;
  /** 0..1 multiplier on both decals (a fading-in object). */
  alphaMul = 1;

  constructor(quad: THREE.BufferGeometry) {
    this.shadowMat = new THREE.ShaderMaterial({
      vertexShader: DECAL_VERT, fragmentShader: SHADOW_FRAG, uniforms: { uStrength: { value: 1 }, uSoft: { value: 1 } },
      transparent: false, depthWrite: false, depthTest: true, toneMapped: false, fog: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    this.shadow = new THREE.Mesh(quad, this.shadowMat);
    this.shadow.renderOrder = -40;
    this.shadow.position.y = 0.002;
    this.shadow.frustumCulled = false;
    this.poolMat = new THREE.ShaderMaterial({
      vertexShader: DECAL_VERT, fragmentShader: POOL_FRAG,
      uniforms: { uColor: { value: new THREE.Color(1, 0.6, 0.3) }, uRingCol: { value: new THREE.Color(1, 0.6, 0.3) }, uStrength: { value: 1 }, uTime: { value: 0 }, uRing: { value: 1 }, uRing2: { value: 0 } },
      transparent: false, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.pool = new THREE.Mesh(quad, this.poolMat);
    this.pool.renderOrder = -39;
    this.pool.position.y = 0.003;
    this.pool.frustumCulled = false;
  }

  setColor(c: Rgb): void { this.poolMat.uniforms.uColor.value.setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace); }
  setRingColor(c: Rgb): void { this.poolMat.uniforms.uRingCol.value.setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace); }
  setVisible(v: boolean): void { this.shadow.visible = v; this.pool.visible = v; }

  update(dt: number, time: number, f: Footprint, floatT: number, style: TierStyle | null, calm: boolean, extraPool = 0): void {
    this.setVisible(true);
    this.poolMat.uniforms.uTime.value = time;
    const h = Math.max(0, f.lowY);
    const lift = 1 / (1 + h * 1.6);                                  // body above the table: shadow thins out
    const fl = floatT;
    const sS = 1.3 + 0.5 * fl + 0.45 * h;
    this.shadow.position.set(f.cx, 0.002, f.cz);
    this.shadow.scale.set(f.rx * sS + 0.05, 1, f.rz * sS + 0.05);
    this.shadowMat.uniforms.uStrength.value = (0.95 - 0.38 * fl) * lift * this.alphaMul;
    this.shadowMat.uniforms.uSoft.value = Math.max(0, 1 - 0.75 * fl - 0.5 * Math.min(1, h * 1.5));
    // light pool: widens and brightens with the squash; softer and smaller while floating
    const squash = Math.min(1, f.compression * 1.2 + f.stretch * 0.15);
    const pS = (1.2 + 0.4 * squash + 0.2 * h) * (1 - 0.1 * fl) * (1 + 0.12 * (style?.ring ?? 0));
    this.poolK += ((0.3 + 0.55 * squash) - this.poolK) * (1 - Math.exp(-dt * 10));
    this.pool.position.set(f.cx, 0.003, f.cz);
    this.pool.scale.set(f.rx * pS + 0.1, 1, f.rz * pS + 0.1);
    const mul = style ? style.poolMul : 1;
    this.poolMat.uniforms.uStrength.value = (this.poolK * mul + extraPool) * (1 - 0.5 * fl) * (0.85 / (1 + h * 0.9)) * this.alphaMul;
    this.poolMat.uniforms.uRing.value = (1 - 0.55 * fl) * (style ? 0.5 + 0.5 * Math.min(1, style.index / 2) : 1);
    // caustic ring on the table: Epic and up; Legendary breathes at 0.25 Hz (never in calm mode)
    let ring2 = style ? style.ring : 0;
    if (ring2 > 0 && style && style.ringPulseHz > 0 && !calm) ring2 *= 0.72 + 0.28 * Math.sin(time * Math.PI * 2 * style.ringPulseHz);
    this.poolMat.uniforms.uRing2.value = ring2 * (1 - 0.6 * fl) / (1 + h * 1.2);
  }

  dispose(): void { this.shadowMat.dispose(); this.poolMat.dispose(); }
}
