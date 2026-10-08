// GENESIS — vegetation near the camera (CONTRACT.md §15.6): deterministic client-side scatter of real 3D trees and
// shrubs from the sim's `tree` / `shrub` / `burnt` fields, drawn as InstancedMeshes per (kind, variant, LOD).
//
//   * Placement: per sim cell, a fixed set of hashed candidates (cell id, index) inside the cell's footprint; a
//     candidate stands if a hash is below the INTERPOLATED cover at its point, so forest edges follow the field
//     smoothly. Height comes from groundHeight() — the sim's own ground function — so trunks meet the drawn ground.
//     Kind from climate (cold → conifer, hot + wet → tropical, burnt → dead), size from a hash. Cached per cell;
//     the cache drops when the fields change.
//   * LOD: three meshes per kind by distance; past the range the terrain's canopy shading takes over (the terrain
//     material receives the same range), and instances dither-dissolve across the hand-over band: nothing pops.
//   * Shading: three's physical BRDF with this planet's sun (transmittance, cascaded + cloud shadows), sky ambient,
//     leaf translucency when the sun is behind the crown, wind sway (gusting, per-tree phase). Trees cast shadows.

import {
  Color, DoubleSide, DynamicDrawUsage, Group, InstancedMesh, Matrix4, MeshStandardMaterial, ShaderMaterial, Vector3, type IUniform,
} from 'three';
import type { PlanetView } from '../../client/worldview.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import { hash32, hashFloat } from '../../sim/core/rng.ts';
import { treeGeometry, type TreeKind } from '../gen/treegen.ts';
import { leafClusterTexture } from '../gen/leaftex.ts';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { ATMO_PARS, SKY_LOOKUP } from '../shaders/atmosphere.glsl.ts';
import { CLOUD_DENSITY_GLSL } from '../sky/clouds.ts';
import { SHADOW_GLSL } from '../planet/lights.ts';

const KINDS: TreeKind[] = ['conifer', 'broadleaf', 'tropical', 'dead', 'shrub'];
const VARIANTS = 3;
const LODS = 3;
/** floats per cached plant: dir xyz, ground radius, yaw, height (m), kind, variant */
const REC = 8;

const VEG_VERT_PARS = /* glsl */ `
attribute float aWind;
attribute vec2 aLeafUv;
attribute float aCard;
uniform float uTime;
uniform vec3 uWindDir;
varying vec3 vBodyPos;
varying float vLeaf;
varying vec2 vLeafUv;
varying float vCard;
`;
/** alpha test for leaf cards, with Golus-style alpha sharpening so edges stay crisp at any mip */
const LEAF_ALPHA = /* glsl */ `
  if (vCard > 0.5) {
    vec4 lt = texture(uLeafTex, vLeafUv);
    float la = (lt.a - 0.45) / max(fwidth(lt.a), 1e-4) + 0.5;
    if (la < 0.5) discard;
  }
`;
const VEG_WIND = /* glsl */ `
  vec3 transformed = vec3(position);
  {
    vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    float ph = dot(ip, vec3(0.071, 0.113, 0.097));
    float gust = 0.55 + 0.45 * sin(uTime * 0.37 + ph * 0.2);
    float sway = (sin(uTime * 1.6 + ph) * 0.6 + sin(uTime * 2.9 + ph * 1.7) * 0.25) * gust;
    vec3 wl = vec3(dot(uWindDir, vec3(1.0, 0.0, 0.0)), 0.0, dot(uWindDir, vec3(0.0, 0.0, 1.0)));
    transformed += (wl * sway * 0.035 + vec3(sin(uTime * 4.1 + ph * 3.0 + position.y * 9.0), 0.0, cos(uTime * 3.7 + ph * 2.0)) * 0.006) * aWind * aWind;
  }
`;

const VEG_FRAG_PARS = /* glsl */ `
${NOISE_GLSL}
${ATMO_PARS}
${SKY_LOOKUP}
${CLOUD_DENSITY_GLSL}
${SHADOW_GLSL}
uniform mat3 uBodyToView;
uniform vec3 uSunDirBody;
uniform vec3 uSunDirView;
uniform vec2 uFade;          // (start, end) of the dissolve band, metres from the camera
uniform samplerCube uCloudCov;
uniform vec2 uCloudShell;
uniform float uCloudOn;
uniform vec3 uNightAmbient;
uniform sampler2D uLeafTex;
varying vec3 vBodyPos;
varying float vLeaf;
varying vec2 vLeafUv;
varying float vCard;
float vegCloudShadow(vec3 P, vec3 sunB) {
  if (uCloudOn < 0.5) return 1.0;
  float mid = 0.5 * (uCloudShell.x + uCloudShell.y);
  vec2 hit = raySphere(P, sunB, mid);
  if (hit.y < 0.0) return 1.0;
  vec3 q = P + sunB * hit.y;
  vec2 cs = texture(uCloudCov, normalize(q)).rg;
  return max(exp(-cloudDensityAt(q, 0.35, cs.x, cs.y, false) * (uCloudShell.y - uCloudShell.x) * 0.55), 0.12);
}
`;

const VEG_LIGHT = /* glsl */ `
  {
    float rP = length(vBodyPos);
    vec3 upB = vBodyPos / rP;
    float sh = sunShadow(-vViewPosition, normal);
    vec3 sunCol = uSunE * sunTransmittance(rP, dot(upB, uSunDirBody)) * sh * vegCloudShadow(vBodyPos, uSunDirBody);
    IncidentLight sunL;
    sunL.direction = uSunDirView;
    sunL.color = sunCol;
    sunL.visible = true;
    RE_Direct(sunL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
    // leaves let light through: a forward-scattering glow when the sun is behind the crown
    float back = pow(max(dot(-geometryViewDir, uSunDirView), 0.0), 3.0);
    float wrap = max(0.0, dot(-geometryNormal, uSunDirView) * 0.5 + 0.5);
    reflectedLight.directDiffuse += sunCol * diffuseColor.rgb * vec3(0.9, 1.15, 0.45) * (back * 0.9 + wrap * 0.18) * vLeaf;
  }
`;
const VEG_AMBIENT = /* glsl */ `
  {
    vec3 upB = normalize(vBodyPos);
    vec3 nB = normalize(transpose(uBodyToView) * normal);
    vec3 e = skyIrradiance(upB, nB, uSunDirBody) + uNightAmbient;
    irradiance += e;
    iblIrradiance += e;
  }
`;

function makeVegMaterial(shared: Record<string, IUniform>, fade: IUniform<{ x: number; y: number }>, leafTex: IUniform): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side: DoubleSide });
  mat.onBeforeCompile = (shader) => {
    for (const k of Object.keys(shared)) shader.uniforms[k] = shared[k];
    shader.uniforms.uFade = fade;
    shader.uniforms.uLeafTex = leafTex;
    shader.vertexShader = shader.vertexShader
      .replace('#include <clipping_planes_pars_vertex>', `#include <clipping_planes_pars_vertex>\n${VEG_VERT_PARS}`)
      .replace('#include <begin_vertex>', VEG_WIND)
      .replace('#include <project_vertex>', `#include <project_vertex>\n  vBodyPos = (instanceMatrix * vec4(transformed, 1.0)).xyz;\n  vLeaf = max(smoothstep(0.35, 0.55, aWind), aCard);\n  vLeafUv = aLeafUv;\n  vCard = aCard;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${VEG_FRAG_PARS}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n  { float fd = length(vViewPosition); float keep = 1.0 - smoothstep(uFade.x, uFade.y, fd); if (ign(gl_FragCoord.xy) >= keep) discard; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
${LEAF_ALPHA}
  if (vCard > 0.5) diffuseColor.rgb *= texture(uLeafTex, vLeafUv).rgb * 1.7;
  // leaf clusters: cellular light / dark speckle on foliage (fading with distance), bark furrows on trunks
  float vegFw = length(fwidth(vBodyPos));
  vec3 lv = voronoi3(vBodyPos * 2.2);
  float leafAA = 1.0 - smoothstep(0.08, 0.35, vegFw * 2.2);
  float leafTex = mix(0.92, 0.62 + 0.62 * (1.0 - lv.x) * (0.7 + 0.6 * lv.z), leafAA);
  float barkTex = 0.8 + 0.3 * abs(snoise(vec3(vBodyPos.x * 9.0, vBodyPos.y * 0.8, vBodyPos.z * 9.0)));
  diffuseColor.rgb *= vCard > 0.5 ? 1.0 : mix(barkTex, leafTex, vLeaf);
  float vegBump = mix(0.0, (1.0 - lv.x) * 0.25 * leafAA, vLeaf);`)
      .replace('#include <normal_fragment_maps>', `{
    vec3 sx = dFdx(-vViewPosition); vec3 sy = dFdy(-vViewPosition);
    vec2 dh = vec2(dFdx(vegBump), dFdy(vegBump));
    vec3 r1 = cross(sy, normal); vec3 r2 = cross(normal, sx);
    float det = dot(sx, r1);
    normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2));
  }`)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>\n${VEG_LIGHT}`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${VEG_AMBIENT}`);
  };
  mat.customProgramCacheKey = () => 'genesis-veg-v1';
  return mat;
}

const VEG_DEPTH_VERT = /* glsl */ `
#include <common>
${VEG_VERT_PARS}
#include <logdepthbuf_pars_vertex>
void main() {
${VEG_WIND}
#include <project_vertex>
  vLeafUv = aLeafUv;
  vCard = aCard;
#include <logdepthbuf_vertex>
}
`;
const VEG_DEPTH_FRAG = /* glsl */ `
uniform sampler2D uLeafTex;
varying vec2 vLeafUv;
varying float vCard;
#include <logdepthbuf_pars_fragment>
void main() {
#include <logdepthbuf_fragment>
${LEAF_ALPHA}
  gl_FragColor = vec4(1.0);
}
`;

interface Bucket { mesh: InstancedMesh; depth: ShaderMaterial; count: number; kind: number; variant: number; lod: number }

const _m = new Matrix4();
const _c = new Color();
const _v = new Vector3();

export class Vegetation {
  readonly group = new Group();
  private buckets: Bucket[] = [];
  private cache = new Map<number, Float32Array>();
  private stamp = '';
  private lastCam = new Vector3(1e9, 0, 0);
  private lastFrame = -1e9;
  private material: MeshStandardMaterial;
  readonly fade: IUniform<{ x: number; y: number }> = { value: { x: 300, y: 400 } };
  /** metres: full-detail range (the terrain canopy shading takes over beyond) */
  range = 380;
  density = 1;
  enabled = true;
  castShadows = false;
  stats = { instances: 0, cells: 0 };
  private shared: Record<string, IUniform>;

  constructor(shared: Record<string, IUniform>) {
    this.shared = shared;
    this.group.name = 'vegetation';
    this.group.matrixAutoUpdate = false;
    const leafTex: IUniform = { value: leafClusterTexture() };
    this.material = makeVegMaterial(shared, this.fade, leafTex);
    const depthUniforms = { uTime: shared.uTime, uWindDir: shared.uWindDir, uLeafTex: leafTex };
    for (let k = 0; k < KINDS.length; k++) {
      for (let v = 0; v < VARIANTS; v++) {
        for (let l = 0; l < LODS; l++) {
          const geo = treeGeometry(KINDS[k], l, v);
          const cap = l === 0 ? 1200 : l === 1 ? 3000 : 6000;
          const mesh = new InstancedMesh(geo, this.material, cap);
          mesh.instanceMatrix.setUsage(DynamicDrawUsage);
          mesh.count = 0;
          mesh.frustumCulled = false;
          mesh.matrixAutoUpdate = false;
          const depth = new ShaderMaterial({ vertexShader: VEG_DEPTH_VERT, fragmentShader: VEG_DEPTH_FRAG, uniforms: depthUniforms, colorWrite: false, side: DoubleSide });
          this.buckets.push({ mesh, depth, count: 0, kind: k, variant: v, lod: l });
          this.group.add(mesh);
        }
      }
    }
  }

  setShadowCasting(on: boolean): void {
    if (on === this.castShadows) return;
    this.castShadows = on;
    for (const b of this.buckets) { if (on) b.mesh.layers.enable(1); else b.mesh.layers.disable(1); }
  }

  swapDepth(depth: boolean): void {
    for (const b of this.buckets) b.mesh.material = depth ? b.depth : this.material;
  }

  /** plants of one cell (cached) */
  private cellPlants(pv: PlanetView, c: number): Float32Array {
    let rec = this.cache.get(c);
    if (rec) return rec;
    const g = pv.grid;
    const R = pv.params.radius;
    const tree = pv.fields.get('tree'), shrub = pv.fields.get('shrub'), burnt = pv.fields.get('burnt');
    const water = pv.fields.get('water'), temp = pv.fields.get('temperature'), moist = pv.fields.get('moisture');
    const snow = pv.fields.get('snow'), crop = pv.fields.get('crop'), road = pv.fields.get('road'), sand = pv.fields.get('sand');
    const tc = tree ? tree[c] : 0, sc = shrub ? shrub[c] : 0;
    const out: number[] = [];
    if ((tc > 0.02 || sc > 0.02) && !(water && water[c] > 1)) {
      const area = g.area[c] * R * R;
      const spacing = Math.sqrt(area);
      const P = g.pos;
      const cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2];
      // tangent frame of the cell
      let ex = cz, ez = -cx;
      const el = Math.hypot(ex, ez) || 1;
      ex /= el; ez /= el;
      const nx = cy * ez, ny = cz * ex - cx * ez, nz = -cy * ex;
      const nTree = Math.ceil((area / 55) * this.density * Math.min(1, tc * 1.3 + 0.05));
      const nShrub = Math.ceil((area / 70) * this.density * Math.min(1, sc * 1.4 + 0.05));
      const place = (i: number, salt: number, isShrub: boolean): void => {
        const h1 = hashFloat(c, i, salt), h2 = hashFloat(c, i, salt + 1), h3 = hashFloat(c, i, salt + 2);
        const a = h1 * Math.PI * 2;
        const rr = Math.sqrt(h2) * spacing * 0.62;
        const ox = (Math.cos(a) * ex + Math.sin(a) * nx) * rr / R;
        const oy = (Math.sin(a) * ny) * rr / R;
        const oz = (Math.cos(a) * ez + Math.sin(a) * nz) * rr / R;
        let dx = cx + ox, dy = cy + oy, dz = cz + oz;
        const l = Math.hypot(dx, dy, dz);
        dx /= l; dy /= l; dz /= l;
        const hit = g.locate(dx, dy, dz);
        const at = (f: Float32Array | undefined) => (f ? f[hit.a] * hit.wa + f[hit.b] * hit.wb + f[hit.c] * hit.wc : 0);
        const cover = isShrub ? at(shrub) : at(tree);
        if (h3 > cover) return;
        if (at(water) > 0.05 || at(road) > 0.45 || at(crop) > 0.4 || at(snow) > 1.2 || at(sand) > 0.5) return;
        const t = at(temp), m = at(moist), b = at(burnt);
        let kind: number;
        if (isShrub) kind = 4;
        else if (b > 0.5) kind = 3;
        else if (t < 3 + hashFloat(c, i, 9) * 6) kind = 0;
        else if (t > 23 && m > 0.7) kind = 2;
        else kind = 1;
        const hs = hashFloat(c, i, salt + 3);
        const height = kind === 0 ? 8 + hs * hs * 16 : kind === 1 ? 7 + hs * hs * 12 : kind === 2 ? 14 + hs * 12 : kind === 3 ? 6 + hs * 8 : 1.1 + hs * 1.8;
        const gr = groundHeight(pv.ground, dx, dy, dz);
        out.push(dx, dy, dz, gr, hashFloat(c, i, salt + 4) * Math.PI * 2, height, kind, hash32(c, i, salt + 5) % VARIANTS);
      };
      for (let i = 0; i < nTree; i++) place(i, 11, false);
      for (let i = 0; i < nShrub; i++) place(i, 71, true);
    }
    rec = Float32Array.from(out);
    this.cache.set(c, rec);
    return rec;
  }

  /**
   * Refresh instances around the camera. `camBody` is the camera in the body frame (m); returns quickly when the
   * camera has not moved much (instances stay valid: they live in the body frame).
   */
  update(pv: PlanetView, camBody: Vector3, frame: number): void {
    const stamp = `${pv.fieldVersion.get('tree') ?? 0}|${pv.fieldVersion.get('shrub') ?? 0}|${pv.fieldVersion.get('surface') ?? 0}|${pv.fieldVersion.get('burnt') ?? 0}|${this.density}`;
    if (stamp !== this.stamp) { this.stamp = stamp; this.cache.clear(); this.lastFrame = -1e9; }
    const R = pv.params.radius;
    const rc = camBody.length();
    const alt = rc - R - Math.max(0, pv.maxSurface * 0.5);
    const range = this.range;
    this.fade.value.x = range * 0.72;
    this.fade.value.y = range;
    const visible = this.enabled && alt < range * 1.2;
    this.group.visible = visible;
    if (!visible) { this.stats.instances = 0; return; }
    const moved = camBody.distanceTo(this.lastCam);
    if (moved < range * 0.04 && frame - this.lastFrame < 240) return;
    this.lastCam.copy(camBody);
    this.lastFrame = frame;
    // gather from the cells around the point under the camera
    const dx = camBody.x / rc, dy = camBody.y / rc, dz = camBody.z / rc;
    const cells = pv.grid.cellsWithin(dx, dy, dz, (range + 60) / R);
    for (const b of this.buckets) b.count = 0;
    const lod0 = range * 0.16, lod1 = range * 0.42;
    let total = 0;
    for (const c of cells) {
      const rec = this.cellPlants(pv, c);
      for (let i = 0; i < rec.length; i += REC) {
        const gr = rec[i + 3];
        _v.set(rec[i] * gr, rec[i + 1] * gr, rec[i + 2] * gr);
        const d = _v.distanceTo(camBody);
        const kind = rec[i + 6];
        const maxD = kind === 4 ? range * 0.45 : range;
        if (d > maxD) continue;
        const lod = d < lod0 ? 0 : d < lod1 ? 1 : 2;
        const b = this.buckets[(kind * VARIANTS + rec[i + 7]) * LODS + lod];
        if (b.count >= b.mesh.instanceMatrix.count) continue;
        // basis: up = surface normal direction, yaw about it, uniform scale = height
        const ux = rec[i], uy = rec[i + 1], uz = rec[i + 2];
        let ex = uz, ez = -ux;
        const el = Math.hypot(ex, ez) || 1;
        ex /= el; ez /= el;
        const nx = uy * ez, ny = uz * ex - ux * ez, nz = -uy * ex;
        const cy = Math.cos(rec[i + 4]), sy = Math.sin(rec[i + 4]);
        const ax = ex * cy + nx * sy, ay = ny * sy, az = ez * cy + nz * sy;
        // right-handed: Z = X × Y (a mirrored basis would flip the winding and cull every tree)
        const bx = ay * uz - az * uy, by = az * ux - ax * uz, bz = ax * uy - ay * ux;
        const s = rec[i + 5];
        const sx = s * (0.9 + 0.2 * ((i * 0.618) % 1));
        _m.set(
          ax * sx, ux * s, bx * sx, _v.x - ux * 0.25,
          ay * sx, uy * s, by * sx, _v.y - uy * 0.25,
          az * sx, uz * s, bz * sx, _v.z - uz * 0.25,
          0, 0, 0, 1,
        );
        // per-tree tint: brightness and a yellow-green ↔ blue-green shift, so a forest is never one colour
        const th = hashFloat(i, Math.floor(rec[i] * 1e5), 3);
        const tb = 0.72 + 0.5 * hashFloat(i, Math.floor(rec[i + 2] * 1e5), 5);
        _c.setRGB(tb * (0.92 + 0.22 * th), tb, tb * (1.08 - 0.25 * th));
        b.mesh.setColorAt(b.count, _c);
        b.mesh.setMatrixAt(b.count++, _m);
        total++;
      }
    }
    for (const b of this.buckets) {
      b.mesh.count = b.count;
      if (b.count) {
        b.mesh.instanceMatrix.needsUpdate = true;
        if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
      }
    }
    this.stats.instances = total;
    this.stats.cells = cells.length;
  }

  dispose(): void {
    for (const b of this.buckets) { b.mesh.dispose(); b.depth.dispose(); }
    this.material.dispose();
  }
}
