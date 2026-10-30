// GENESIS — the sea drawing back before a tsunami (LIVING §3.7: "tsunami: the sea draws back ≥ 30 min before the wave";
// the sim's warning phase, DisasterView.params.warning / .drawback; render hook H5). The sim holds the wave back and
// leaves its water field as it was, so the retreat is drawn here: over the shallow band of the coasts in the wave's
// reach, the water falls away as a contour of depth — what was shallower than the drawn-back depth lies bare: wet,
// glossy sand and mud reflecting the sky, puddles left in its hollows, a ragged line of foam along the new waterline
// far out — and it deepens as the warning goes on. When the wave comes the bare seabed is swallowed again (fades out).
//
// The mesh is built once per tsunami from the sim triangles of the coast round it (some corner under water, some corner
// no deeper than a few metres — or dry land beside deep water, a steep coast), each split into nine and laid on the
// curved ground (the terrain's own height function), carrying the water depth the sea had there (held to SHELF_MAX). Drawn in the FX layer over the composited image (so over the
// water), soft-tested against the opaque scene's depth (the seabed itself).

import { BufferAttribute, BufferGeometry, CustomBlending, Mesh, OneFactor, OneMinusSrcAlphaFactor, ShaderMaterial, Vector3, type IUniform } from 'three';
import type { PlanetView } from '../../client/worldview.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { ATMO_PARS, SKY_LOOKUP } from '../shaders/atmosphere.glsl.ts';
import { FX_DEPTH_GLSL, FX_LAYER } from './fxcommon.ts';

const SUB = 3;
/** the deepest water the drawback ever lays bare (m), and the most triangles of coast it takes */
export const DRAWBACK_MAX = 8;
const MAX_TRIS = 7000;
/**
 * the sim's coarse cells average a coast's shelf away: land often sits next to a 20-50 m deep cell, and laid as a
 * straight line between the two the 8 m drawn back bared a rim 2-3 m wide (fr4d-drawback, punch P08). Such a triangle
 * is taken too, its depths held to SHELF_MAX, and the shader lays bare to SHOW_K × the drawn-back depth.
 */
export const SHELF_MAX = DRAWBACK_MAX * 2.4;
export const SHOW_K = 2.1;

const VERT = /* glsl */ `
${ATMO_PARS}
${SKY_LOOKUP}
uniform vec3 uSunDirBody;
attribute float aDepth;
varying float vDepth;
varying float vZ;
varying vec3 vP;
varying vec3 vLight;
void main() {
  vDepth = aDepth;
  vP = position;
  vec3 up = normalize(position);
  vLight = uSunE * sunTransmittance(length(position), dot(up, uSunDirBody)) * max(0.0, dot(up, uSunDirBody)) * 0.3
         + skyIrradiance(up, up, uSunDirBody) * 0.3;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
${NOISE_GLSL}
${ATMO_PARS}
${SKY_LOOKUP}
${FX_DEPTH_GLSL}
uniform vec3 uSunDirBody;
uniform vec3 uCamB;
uniform float uDw;       // how deep the sea has drawn back (m)
uniform float uK;        // fade (in during the warning, out when the wave comes)
uniform float uShowK;    // how far down the shelf the drawn-back depth reads (SHOW_K)
varying float vDepth;
varying float vZ;
varying vec3 vP;
varying vec3 vLight;
void main() {
  if (vDepth < 0.02) discard;
  float vis = fxSoft(vZ, 1.2);
  if (vis <= 0.0) discard;
  // the waterline wanders with the seabed's own relief (noise on the depth contour)
  float dw = uDw * uShowK;
  float n = fbm3(vP * 0.045);
  float d = vDepth + n * (0.6 + 0.08 * dw);
  float bare = 1.0 - smoothstep(dw - 0.5, dw + 0.1, d);
  // (a broad ragged line of foam along the new waterline, and past it the shallows draining off, brown with silt)
  float fw = 0.3 + 0.05 * dw;
  float foam = exp(-pow((d - dw - fw * 0.5) / fw, 2.0)) * (0.6 + 0.4 * snoise(vP * 0.3 + vec3(0.0, uFxTime * 0.6, 0.0)));
  float silt = (1.0 - smoothstep(dw, dw + 2.0 + 0.6 * dw, d)) * smoothstep(0.3, 1.5, uDw);
  if (bare <= 0.003 && foam <= 0.01 && silt <= 0.01) discard;
  vec3 up = normalize(vP);
  vec3 V = normalize(uCamB - vP);
  // wet sand toward the old shore (darker than dry sand, ribbed by the waves), dark mud and weed farther out
  float n2 = fbm3(vP * 0.13 + 7.0);
  // (paler than the sea it lay under — tan sand by the old shore, grey-brown silt farther out — so the bared band reads
  // against the dark water from the god's height; the weed patches are fewer and lie in the deeper part)
  vec3 sand = mix(vec3(0.3, 0.25, 0.18), vec3(0.2, 0.17, 0.125), smoothstep(0.5, max(1.0, dw), vDepth));
  float rib = 0.86 + 0.14 * sin(dot(vP, vec3(0.83, 0.31, 0.47)) * 2.2 + n2 * 6.0);
  vec3 alb = mix(sand * rib, vec3(0.07, 0.075, 0.05), smoothstep(0.35, 0.7, n2) * smoothstep(0.4, 0.9, vDepth / max(1.0, dw)));
  // pools left in the hollows (a few, small): still water reflecting the sky
  float pud = smoothstep(0.42, 0.52, fbm3(vP * 0.11 - 3.0)) * smoothstep(0.6, 1.8, vDepth);
  vec3 R = reflect(-V, up);
  float fres = 0.04 + 0.96 * pow(1.0 - max(0.0, dot(V, up)), 5.0);
  vec3 sky = skyRadiance(up, R, uSunDirBody);
  // a sun glint off the wet ground
  float gl = pow(max(0.0, dot(R, uSunDirBody)), mix(60.0, 400.0, pud)) * mix(0.4, 2.5, pud);
  vec3 sunC = uSunE * sunTransmittance(length(vP), dot(up, uSunDirBody));
  // (wet: darker than dry sand, a sheen of the sky on it; the puddles mirror it)
  vec3 c = alb * vLight * (1.0 - 0.6 * pud) + sky * mix(0.16, 0.7, pud) * fres + sunC * gl * 0.05;
  vec3 fc = vec3(0.9, 0.92, 0.93) * (vLight * 1.6 + sky * 0.15);
  float a = bare * uK * vis;
  float fa = clamp(foam, 0.0, 1.0) * 0.9 * uK * vis;
  // the draining shallows: a veil of silty water over the seabed showing through, under the sky's sheen
  float sa = silt * (1.0 - bare) * 0.55 * uK * vis;
  vec3 sc = vec3(0.16, 0.14, 0.1) * vLight + sky * 0.3 * fres;
  vec3 col = (c * a + sc * sa * (1.0 - a)) * (1.0 - fa) + fc * fa;
  gl_FragColor = vec4(col, max(max(a, fa), sa));
}
`;

export class Drawback {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  /** how many coast triangles it covers (0: nothing near the sea) */
  readonly tris: number;

  constructor(fx: Record<string, IUniform>, shared: Record<string, IUniform>, pv: PlanetView, centre: Vector3, reach: number) {
    const g = pv.grid, R = pv.params.radius;
    const water = pv.fields.get('water');
    const pos: number[] = [], dep: number[] = [], idx: number[] = [];
    let n = 0;
    if (water) {
      const P = g.pos, T = g.tris;
      const cu = centre.clone().normalize();
      const cosR = Math.cos(reach / R);
      for (let t = 0; t < g.triCount && n < MAX_TRIS; t++) {
        const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
        // (near enough: the triangle's first corner within the reach)
        if (P[a * 3] * cu.x + P[a * 3 + 1] * cu.y + P[a * 3 + 2] * cu.z < cosR) continue;
        const wa = water[a], wb = water[b], wc = water[c];
        const lo = Math.min(wa, wb, wc), hi = Math.max(wa, wb, wc);
        // the shallow band: some of it under water and some of it shallow — a corner in the shallows, or a steep coast
        // (dry land beside deep water: the shelf the coarse cells averaged away lies between them)
        if (hi < 0.02 || lo > DRAWBACK_MAX + 1) continue;
        const base = pos.length / 3;
        for (let i = 0; i <= SUB; i++) for (let j = 0; j <= SUB - i; j++) {
          const wB = i / SUB, wC = j / SUB, wA = 1 - wB - wC;
          let x = P[a * 3] * wA + P[b * 3] * wB + P[c * 3] * wC;
          let y = P[a * 3 + 1] * wA + P[b * 3 + 1] * wB + P[c * 3 + 1] * wC;
          let z = P[a * 3 + 2] * wA + P[b * 3 + 2] * wB + P[c * 3 + 2] * wC;
          const l = Math.hypot(x, y, z) || 1;
          x /= l; y /= l; z /= l;
          // (a hand's breadth over the seabed: the soft depth test keeps it on the ground, never under it)
          const h = groundHeight(pv.ground, x, y, z) + 0.25;
          pos.push(x * h, y * h, z * h);
          dep.push(Math.min(SHELF_MAX, wa * wA + wb * wB + wc * wC));
        }
        // the sub-triangles of a row-major barycentric grid
        const id = (i: number, j: number) => base + i * (SUB + 1) - (i * (i - 1)) / 2 + j;
        for (let i = 0; i < SUB; i++) for (let j = 0; j < SUB - i; j++) {
          idx.push(id(i, j), id(i + 1, j), id(i, j + 1));
          if (j < SUB - i - 1) idx.push(id(i + 1, j), id(i + 1, j + 1), id(i, j + 1));
        }
        n++;
      }
    }
    this.tris = n;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('aDepth', new BufferAttribute(new Float32Array(dep), 1));
    geo.setIndex(idx);
    const uniforms: Record<string, IUniform> = { ...fx, uDw: { value: 0 }, uK: { value: 0 }, uShowK: { value: SHOW_K }, uCamB: { value: new Vector3() } };
    for (const k of Object.keys(shared)) if (!(k in uniforms)) uniforms[k] = shared[k];
    this.mat = new ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true, depthTest: false, depthWrite: false,
      blending: CustomBlending, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
    });
    this.mesh = new Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.layers.set(FX_LAYER);
    this.mesh.renderOrder = 2;
    this.mesh.visible = n > 0;
  }

  /** `depth` m of sea drawn back, faded by k, seen from camB */
  update(depth: number, k: number, camB: Vector3): void {
    this.mat.uniforms.uDw.value = depth;
    this.mat.uniforms.uK.value = k;
    (this.mat.uniforms.uCamB.value as Vector3).copy(camB);
    this.mesh.visible = this.tris > 0 && k > 0.005;
  }

  dispose(): void { this.mesh.geometry.dispose(); this.mat.dispose(); }
}
