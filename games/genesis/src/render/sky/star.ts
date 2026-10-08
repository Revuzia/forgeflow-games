// GENESIS — the star (CONTRACT.md §15.3): an emissive sphere with limb darkening (Eddington, u ≈ 0.6), animated
// granulation (cellular convection cells drifting on the photosphere), faculae and activity-driven sunspots, colour
// from temperature; plus a camera-facing corona with streamers. Radiance is HDR (capped below half-float range) so the
// bloom, god rays and lens flare in the post chain read it as a real light source.

import {
  AdditiveBlending, Color, Group, Mesh, PlaneGeometry, ShaderMaterial, SphereGeometry, Vector3,
} from 'three';
import type { StarView } from '../../sim/types.ts';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { blackbody } from '../../client/orbits.ts';

const STAR_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vN;
varying vec3 vObj;
varying vec3 vViewN;
void main() {
  vObj = position;
  vN = normalize(position);
  vViewN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}
`;

const STAR_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
uniform vec3 uColor;
uniform float uRadiance;
uniform float uTime;
uniform float uActivity;
varying vec3 vN;
varying vec3 vObj;
varying vec3 vViewN;
void main() {
#include <logdepthbuf_fragment>
  float mu = clamp(abs(vViewN.z), 0.0, 1.0);
  // limb darkening (quadratic law) and limb reddening
  float limb = 1.0 - 0.56 * (1.0 - mu) - 0.2 * (1.0 - mu) * (1.0 - mu);
  vec3 col = uColor * mix(vec3(1.0, 0.72, 0.5), vec3(1.0), smoothstep(0.0, 0.6, mu));
  // granulation: bright cell centres, dark lanes, slowly boiling
  vec3 p = vN * 38.0;
  vec3 c1 = voronoi3(p + vec3(0.0, uTime * 0.05, uTime * 0.03));
  float gran = smoothstep(0.0, 0.5, c1.y - c1.x);
  float sup = fbm3(vN * 6.0 + uTime * 0.01);
  float spots = smoothstep(0.55, 0.75, snoise(vN * 3.5 + vec3(uTime * 0.004)) * 0.5 + 0.5) * uActivity;
  float fac = smoothstep(0.2, 0.8, sup) * (1.0 - mu) * 0.4;
  float I = limb * (0.86 + 0.18 * gran + 0.08 * sup + fac) * (1.0 - spots * 0.85);
  gl_FragColor = vec4(col * I * uRadiance, 1.0);
}
`;

const CORONA_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv * 2.0 - 1.0;
  // billboard: keep the quad facing the camera
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(modelMatrix[0].xyz);
  mv.xy += position.xy * s;
  gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}
`;

const CORONA_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${NOISE_GLSL}
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform float uInner;
varying vec2 vUv;
void main() {
#include <logdepthbuf_fragment>
  float r = length(vUv);
  if (r < uInner * 0.98 || r > 1.0) discard;
  float a = atan(vUv.y, vUv.x);
  float x = (r - uInner) / (1.0 - uInner);
  float streak = 0.55 + 0.45 * snoise(vec3(cos(a) * 3.0, sin(a) * 3.0, uTime * 0.02 + r * 2.0));
  streak *= 0.7 + 0.3 * pow(abs(sin(a * 7.0 + snoise(vec3(a, 0.0, uTime * 0.03)) * 2.0)), 3.0);
  float fall = exp(-x * 9.0) * 0.9 + exp(-x * 3.0) * 0.12 * streak;
  fall *= smoothstep(1.0, 0.7, r);
  gl_FragColor = vec4(uColor * fall * uIntensity, 1.0);
}
`;

export class StarVisual {
  readonly group = new Group();
  private sphere: Mesh;
  private corona: Mesh;
  private mat: ShaderMaterial;
  private coronaMat: ShaderMaterial;
  readonly color = new Color(1, 1, 1);
  radius = 10000;

  constructor() {
    this.mat = new ShaderMaterial({
      vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
      uniforms: { uColor: { value: new Color(1, 0.95, 0.9) }, uRadiance: { value: 2000 }, uTime: { value: 0 }, uActivity: { value: 0.2 } },
    });
    this.sphere = new Mesh(new SphereGeometry(1, 96, 64), this.mat);
    this.sphere.frustumCulled = false;
    this.coronaMat = new ShaderMaterial({
      vertexShader: CORONA_VERT, fragmentShader: CORONA_FRAG,
      uniforms: { uColor: { value: new Color(1, 0.9, 0.8) }, uIntensity: { value: 60 }, uTime: { value: 0 }, uInner: { value: 1 / 7 } },
      transparent: true, depthWrite: false, blending: AdditiveBlending,
    });
    this.corona = new Mesh(new PlaneGeometry(2, 2), this.coronaMat);
    this.corona.frustumCulled = false;
    this.corona.renderOrder = 10;
    this.group.add(this.sphere, this.corona);
  }

  /** place the star at `rel` (star − camera, world) and refresh colour / radiance */
  update(star: StarView, rel: Vector3, time: number): void {
    this.radius = Math.max(100, star.radius);
    this.group.position.copy(rel);
    this.sphere.scale.setScalar(this.radius);
    this.corona.scale.setScalar(this.radius * 7);
    const bb = blackbody(star.temperature || 5800);
    this.color.setRGB(bb[0], bb[1], bb[2]);
    (this.mat.uniforms.uColor.value as Color).copy(this.color);
    (this.coronaMat.uniforms.uColor.value as Color).copy(this.color).lerp(new Color(1, 1, 1), 0.3);
    // disc radiance: illuminance at the reference distance / solid angle, capped for half-float headroom
    const lum = Math.max(0.01, star.luminosity || 1);
    this.mat.uniforms.uRadiance.value = Math.min(22000, 9000 * Math.sqrt(lum));
    this.mat.uniforms.uTime.value = time % 10000;
    this.mat.uniforms.uActivity.value = star.activity ?? 0;
    this.coronaMat.uniforms.uTime.value = time % 10000;
    this.coronaMat.uniforms.uIntensity.value = 40 * Math.sqrt(lum) * (1 + (star.activity ?? 0));
  }
}
