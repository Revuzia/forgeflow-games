// The glowing core: an emissive ember blob inside the body (oriented by body.frame, squeezed and brightened with the
// compression) plus a soft additive halo billboard. Both live in the OPAQUE list on purpose: three renders them into
// its transmission target, so the jelly refracts and blurs them (the glow you see through the body). The jelly shader
// adds an analytic halo on top, which also covers the low tier (no transmission).
import * as THREE from 'three';
import type { SoftBodyLike } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import type { JellyPalette } from './oklch.ts';
import { NOISE_GLSL } from './shaderlib.ts';

const BLOB_VERT = /* glsl */`
varying vec3 vN;
varying vec3 vV;
varying vec3 vL;
void main() {
  vL = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;
const BLOB_FRAG = /* glsl */`
varying vec3 vN;
varying vec3 vV;
varying vec3 vL;
uniform vec3 uColor;
uniform vec3 uHot;
uniform float uIntensity;
uniform float uTime;
${NOISE_GLSL}
void main() {
  float ndv = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  float hot = pow(ndv, 2.4);
  float mott = 0.84 + 0.3 * whNoise3(vL * 2.6 + vec3(0.0, uTime * 0.35, uTime * 0.2));
  vec3 c = mix(uColor, uHot, 0.3 * hot * hot) * (0.5 + 0.7 * hot) * mott * uIntensity;
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const HALO_VERT = /* glsl */`
varying vec2 vP;
uniform vec3 uCenter;
uniform float uSize;
void main() {
  vP = position.xy;
  vec4 mv = viewMatrix * vec4(uCenter, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}
`;
const HALO_FRAG = /* glsl */`
varying vec2 vP;
uniform vec3 uColor;
uniform float uStrength;
void main() {
  float r = length(vP);
  float a = exp(-r * r * 5.0) * (1.0 - smoothstep(0.55, 1.0, r)) * uStrength;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Core {
  readonly group = new THREE.Group();
  /** World centre and a 0..~2 glow amount for the jelly shader's analytic halo. */
  readonly center = new THREE.Vector3();
  amount = 1;
  private readonly blob: THREE.Mesh;
  private readonly halo: THREE.Mesh;
  private readonly blobMat: THREE.ShaderMaterial;
  private readonly haloMat: THREE.ShaderMaterial;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly radius: number;
  private readonly glow: number;
  private comp = 0;

  constructor(genome: Genome, palette: JellyPalette, scale: number) {
    this.radius = 0.17 * scale;
    this.glow = genome.coreGlow;
    const blobGeo = new THREE.SphereGeometry(1, 28, 18);
    const haloGeo = new THREE.PlaneGeometry(2, 2);
    this.geos.push(blobGeo, haloGeo);
    const col = new THREE.Color().setRGB(palette.core[0], palette.core[1], palette.core[2], THREE.LinearSRGBColorSpace);
    const hot = new THREE.Color().setRGB(palette.coreHot[0], palette.coreHot[1], palette.coreHot[2], THREE.LinearSRGBColorSpace);
    this.blobMat = new THREE.ShaderMaterial({
      vertexShader: BLOB_VERT, fragmentShader: BLOB_FRAG, fog: false,
      uniforms: { uColor: { value: col }, uHot: { value: hot }, uIntensity: { value: 2 }, uTime: { value: 0 } },
    });
    this.haloMat = new THREE.ShaderMaterial({
      vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, fog: false,
      uniforms: { uCenter: { value: this.center }, uSize: { value: this.radius * 4 }, uColor: { value: col.clone() }, uStrength: { value: 0.6 } },
      transparent: false, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    });
    this.blob = new THREE.Mesh(blobGeo, this.blobMat);
    this.blob.renderOrder = -20;
    this.blob.frustumCulled = false;
    this.halo = new THREE.Mesh(haloGeo, this.haloMat);
    this.halo.renderOrder = -19;
    this.halo.frustumCulled = false;
    this.group.add(this.blob, this.halo);
  }

  /** `squeeze` is the renderer's 0..1 compression (global metric or deepest local dent). */
  update(body: SoftBodyLike, dt: number, time: number, squeeze: number): void {
    const c = body.center, q = body.frame;
    this.center.set(c.x, c.y, c.z);
    this.comp += (squeeze - this.comp) * (1 - Math.exp(-dt * 12));
    const k = this.comp;
    const sy = 1 - 0.42 * k, sxz = 1 + 0.2 * k;
    this.blob.position.set(c.x, c.y, c.z);
    this.blob.quaternion.set(q.x, q.y, q.z, q.w);
    this.blob.scale.set(this.radius * sxz, this.radius * sy, this.radius * sxz);
    const pulse = 1 + 0.06 * this.glow * Math.sin(time * 2.3);
    this.amount = (1.2 + 0.9 * this.glow) * (1 + 1.5 * k) * pulse;
    this.blobMat.uniforms.uIntensity.value = (1.0 + 1.2 * this.glow) * (1 + 1.4 * k) * pulse;
    this.blobMat.uniforms.uTime.value = time;
    this.haloMat.uniforms.uStrength.value = (0.28 + 0.4 * this.glow) * (1 + 0.7 * k);
    this.haloMat.uniforms.uSize.value = this.radius * (3.4 + 0.3 * k);
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    this.blobMat.dispose(); this.haloMat.dispose();
  }
}
