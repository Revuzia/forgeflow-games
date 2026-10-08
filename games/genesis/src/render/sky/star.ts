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
varying vec3 vViewPos;
void main() {
  vObj = position;
  vN = normalize(position);
  vViewN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
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
uniform float uClose;
varying vec3 vN;
varying vec3 vObj;
varying vec3 vViewN;
varying vec3 vViewPos;
void main() {
#include <logdepthbuf_fragment>
  // μ = cos of the angle between the surface normal and the line of sight. (The view-space normal's z is not it: at
  // the silhouette of a nearby star z = R/d, so a close disc kept half its limb darkening.)
  float mu = clamp(dot(normalize(vViewN), normalize(-vViewPos)), 0.0, 1.0);
  // limb darkening (quadratic law) and limb reddening
  float limb = 1.0 - 0.56 * (1.0 - mu) - 0.2 * (1.0 - mu) * (1.0 - mu);
  // up close the disc is exposed for itself (the renderer's star exposure), where a near-white blackbody would read as
  // a grey moon: the colour is saturated along its own hue (a G star goes gold, an M star orange, an O star blue),
  // the way a filtered photograph of a star reads
  // (the blue cut keeps a G star gold rather than salmon through the AgX curve; blue stars stay blue)
  vec3 own = pow(uColor, vec3(5.0)) * vec3(1.0, 1.0, 0.55);
  own /= max(own.r, max(own.g, own.b));
  vec3 col = mix(uColor, own, uClose) * mix(vec3(1.0, 0.72, 0.5), vec3(1.0), smoothstep(0.0, 0.6, mu));
  // granulation: bright cell centres, dark lanes, slowly boiling
  vec3 p = vN * 38.0;
  vec3 c1 = voronoi3(p + vec3(0.0, uTime * 0.05, uTime * 0.03));
  float gran = smoothstep(0.0, 0.5, c1.y - c1.x);
  float sup = fbm3(vN * 6.0 + uTime * 0.01);
  // sunspots: small dark umbrae inside lighter penumbrae, in activity belts (not continent-sized blotches, which read
  // as a moon's maria)
  float sn = snoise(vN * 9.0 + vec3(uTime * 0.004)) * 0.5 + 0.5;
  float belt = smoothstep(0.6, 0.25, abs(vN.y)) * smoothstep(0.02, 0.12, abs(vN.y));
  float spots = (smoothstep(0.72, 0.8, sn) * 0.55 + smoothstep(0.8, 0.86, sn) * 0.45) * belt * uActivity;
  float fac = smoothstep(0.2, 0.8, sup) * (1.0 - mu) * 0.4;
  float I = limb * (0.8 + 0.3 * gran + 0.08 * sup + fac) * (1.0 - spots * 0.85);
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

const _white = new Color(1, 1, 1);
const _sat = new Color();

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
      uniforms: { uColor: { value: new Color(1, 0.95, 0.9) }, uRadiance: { value: 2000 }, uTime: { value: 0 }, uActivity: { value: 0.2 }, uClose: { value: 0 } },
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

  /** disc radiance (relative units, the shader's uRadiance): the renderer exposes a close-up view from it */
  get radiance(): number { return this.mat.uniforms.uRadiance.value as number; }

  /**
   * place the star at `rel` (star − camera, world) and refresh colour / radiance. `close` (0..1) = how much of the
   * view the disc fills: up close the corona is smaller and fainter, so the disc's limb darkening, granulation and
   * colour read instead of a white flood
   */
  update(star: StarView, rel: Vector3, time: number, close = 0): void {
    this.radius = Math.max(100, star.radius);
    this.group.position.copy(rel);
    this.sphere.scale.setScalar(this.radius);
    // the corona billboard sits in the plane through the star's centre, where the disc's silhouette (the tangent cone
    // from the eye) measures R / sqrt(1 − (R/d)²), not R: sized by R alone, up close its annulus starts inside the
    // disc and its additive glow washes out the limb darkening
    const rd = Math.min(0.995, this.radius / Math.max(1, rel.length()));
    const sil = this.radius / Math.sqrt(1 - rd * rd);
    this.corona.scale.setScalar(sil * (7 - 4 * close));
    this.coronaMat.uniforms.uInner.value = 1 / (7 - 4 * close);
    const bb = blackbody(star.temperature || 5800);
    this.color.setRGB(bb[0], bb[1], bb[2]);
    (this.mat.uniforms.uColor.value as Color).copy(this.color);
    // (up close the corona takes the disc's saturated close-up colour, see STAR_FRAG, instead of a paler white rim)
    const cc = this.coronaMat.uniforms.uColor.value as Color;
    const k = Math.max(bb[0], bb[1], bb[2]);
    const sr = (bb[0] / k) ** 5, sg = (bb[1] / k) ** 5, sb = 0.55 * (bb[2] / k) ** 5, sk = Math.max(sr, sg, sb);
    cc.copy(this.color).lerp(_white, 0.3).lerp(_sat.setRGB(sr / sk, sg / sk, sb / sk), close);
    // disc radiance: illuminance at the reference distance / solid angle, capped for half-float headroom
    const lum = Math.max(0.01, star.luminosity || 1);
    this.mat.uniforms.uRadiance.value = Math.min(22000, 9000 * Math.sqrt(lum));
    this.mat.uniforms.uTime.value = time % 10000;
    this.mat.uniforms.uActivity.value = star.activity ?? 0;
    this.mat.uniforms.uClose.value = close;
    this.coronaMat.uniforms.uTime.value = time % 10000;
    // far away the corona is a glow around a point-like disc; up close (exposed for the disc) it is a thin bright
    // chromosphere-and-corona rim, a fixed fraction of the disc's own radiance so it shows at the close-up exposure
    const far = 40 * Math.sqrt(lum) * (1 + (star.activity ?? 0));
    const near = 0.1 * (this.mat.uniforms.uRadiance.value as number) * (1 + 0.5 * (star.activity ?? 0));
    this.coronaMat.uniforms.uIntensity.value = far + (near - far) * close;
  }
}
