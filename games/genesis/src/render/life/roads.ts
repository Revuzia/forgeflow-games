// GENESIS — roads (CONTRACT.md §15.6 "Roads"): ribbon meshes along the most-worn edges of the `road` field near the
// camera (render/life/roadnet.ts extracts them), surfaced by the era of the settlement they serve:
//   trail (stone / fire)  → a narrow footpath of trodden earth (no wheel ruts), fading in as feet wear it from
//                           TRAIL wear, so a young camp's ways to the water and the woods read before they are roads
//   dirt (clay … iron)    → a soft-edged rutted earth road with wheel tracks
//   cobble (classical … gunpowder) → rounded setts with kerb stones
//   paved (steam →)       → flagstones (steam) / dark macadam with a painted line (electric and later)
// Each ribbon vertex is draped on the curved ground (groundHeight) at its own across-road offset, lifted a few cm and
// pulled a fraction of its distance toward the camera in the vertex shader (no z-fight under the logarithmic depth
// buffer, where polygon offset does nothing). Stretches inside a building's footprint are left out (a road leads up to
// a door rather than through a house). Rebuilt when the camera has moved ~120 m or the road field changes.
// Street lamps by the settlement's light technology (oil lanterns on posts from the medieval era, gas lamps with the
// steam age, tall electric lamps after) stand along the streets that have houses beside them, alternating sides; at
// night each throws a pool of light on the road surface (in the ribbon shader, matching the posts exactly), its glass
// glows (the building shader's lantern part), and the nearest become point lights (render/life/nightlights.ts).

import {
  BufferGeometry, DoubleSide, DynamicDrawUsage, Float32BufferAttribute, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh,
  MeshStandardMaterial, ShaderMaterial, Uint32BufferAttribute, type IUniform,
} from 'three';
import type { PlanetView } from '../../client/worldview.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import { eraIndex, lightKindForEra, paveTier } from './catalog.ts';
import { lampPostMesh } from '../gen/buildinggen.ts';
import { makeBuildingDepthMaterial, makeBuildingMaterial } from './buildingmat.ts';
import type { LightSource } from './nightlights.ts';
import { extractRoads, roadWidth } from './roadnet.ts';
import { NOISE_GLSL } from '../shaders/noise.glsl.ts';
import { ATMO_PARS, SKY_LOOKUP } from '../shaders/atmosphere.glsl.ts';
import { CLOUD_DENSITY_GLSL } from '../sky/clouds.ts';
import { SHADOW_GLSL } from '../planet/lights.ts';
import { MOON_PARS, moonDirect } from '../shaders/moon.glsl.ts';
import type { Buildings } from './buildings.ts';

const RANGE = 650;
/** wear at which ribbons start: footpaths (the live sim's camps wear 0.2–0.4 in their first weeks) */
const TRAIL = 0.2;
/** how far below TRAIL a drawn way's wear may fall before it stops being drawn */
const TRAIL_HOLD = 0.08;
/** a footpath's width (m) for a wear value — must match the trail branch of halfW in FRAG_SURFACE / FRAG_LAMPS */
function trailWidth(wear: number): number {
  return 0.55 + 0.75 * Math.max(0, Math.min(1, (wear - TRAIL) / 0.5));
}
/** street lamps by light kind: spacing along the street (m) — must match lampSpec() in the ribbon shader */
const LAMP: Record<number, { spacing: number }> = { 2: { spacing: 34 }, 3: { spacing: 24 }, 4: { spacing: 30 } };
const _mat = new Matrix4();

const VERT_PARS = /* glsl */ `
attribute vec4 aRoad;   // along (m), across (−1..1), tier, wear
attribute float aLamp;  // street-lamp kind along this stretch (0 none, 2 oil, 3 gas, 4 electric)
attribute float aEnd;   // metres to a dead end of the chain (capped; junction ends do not count)
varying vec4 vRoad;
varying float vLamp;
varying float vEnd;
varying vec3 vBodyPos;
`;
const FRAG_PARS = /* glsl */ `
${NOISE_GLSL}
${ATMO_PARS}
${SKY_LOOKUP}
${CLOUD_DENSITY_GLSL}
${SHADOW_GLSL}
uniform mat3 uBodyToView;
uniform vec3 uSunDirBody;
uniform vec3 uSunDirView;
${MOON_PARS}uniform samplerCube uCloudCov;
uniform vec2 uCloudShell;
uniform float uCloudOn;
uniform vec3 uNightAmbient;
varying float vEnd;
varying vec4 vRoad;
varying float vLamp;
varying vec3 vBodyPos;
// street lamps: spacing, pool radius and brightness by kind — must match LAMP in roads.ts
// (pools a few metres across, a few times the moonlit ground: wider, brighter pools merged along every street into
// glowing tubes seen from a god camera)
vec3 lampSpec(float k) { return k < 2.5 ? vec3(34.0, 3.2, 0.9) : k < 3.5 ? vec3(24.0, 3.8, 1.25) : vec3(30.0, 4.6, 1.7); }
vec3 lampTint(float k) { return k < 2.5 ? vec3(1.0, 0.6, 0.22) : k < 3.5 ? vec3(1.0, 0.76, 0.46) : vec3(1.0, 0.86, 0.66); }
float roadCloudShadow(vec3 P, vec3 sunB) {
  if (uCloudOn < 0.5) return 1.0;
  float mid = 0.5 * (uCloudShell.x + uCloudShell.y);
  vec2 hit = raySphere(P, sunB, mid);
  if (hit.y < 0.0) return 1.0;
  vec3 q = P + sunB * hit.y;
  vec2 cs = texture(uCloudCov, normalize(q)).rg;
  return max(exp(-cloudDensityAt(q, 0.35, cs.x, cs.y, false) * (uCloudShell.y - uCloudShell.x) * 0.4), 0.3);
}
float rAA(float fw, float f) { return 1.0 - smoothstep(0.15, 0.6, fw / f); }
`;

const FRAG_SURFACE = /* glsl */ `
  float along = vRoad.x, across = vRoad.y, tier = vRoad.z, wear = vRoad.w;
  float halfW = tier < 0.5 ? (0.55 + 0.75 * clamp((wear - 0.2) / 0.5, 0.0, 1.0)) * 0.5 : max(0.8, 1.6 + clamp((wear - 0.55) / 0.4, 0.0, 1.0) * 4.4) * 0.5;
  vec2 ruv = vec2(along, across * halfW);
  float fw = length(fwidth(ruv));
  vec3 alb;
  float h = 0.0, rgh = 0.9, alpha = 1.0;
  float edge = abs(across);
  float n1 = snoise(vec3(ruv * 0.5, 3.0));
  if (tier < 1.5) {
    // dirt: trodden earth, two wheel ruts (not on a footpath: no wheels yet), grass creeping in from the verges, soft
    // edges; a footpath is fainter where fewer feet have passed
    vec3 earth = vec3(0.16, 0.12, 0.08) * (0.88 + 0.14 * n1);
    float ruts = (1.0 - smoothstep(0.0, 0.18, abs(abs(ruv.y) - halfW * 0.45))) * rAA(fw, 0.2) * step(0.5, tier);
    float grit = snoise(vec3(ruv * 4.0, 7.0)) * rAA(fw, 0.12);
    alb = earth * (0.9 + 0.1 * grit) * (1.0 - 0.18 * ruts);
    float verge = smoothstep(0.55, 1.0, edge + 0.15 * snoise(vec3(ruv * 1.3, 1.0)));
    alb = mix(alb, vec3(0.07, 0.085, 0.035) * (0.9 + 0.2 * n1), verge * 0.6);
    h = -ruts * 0.4 + grit * 0.05;
    alpha = 1.0 - smoothstep(0.7, 1.0, edge + 0.12 * snoise(vec3(ruv * 0.9, 5.0)));
    // a dead end fades into the ground over its last couple of metres
    alpha *= smoothstep(0.0, 2.2, vEnd + 0.7 * snoise(vec3(ruv * 0.8, 11.0)));
    if (tier < 0.5) {
      // a footpath: packed, dusty ground (lighter than a cart road's mud), see-through at its edges and where the grass
      // still wins — a trace over the ground beneath rather than a dark stripe painted on it
      alb = mix(alb, vec3(0.25, 0.205, 0.15) * (0.9 + 0.14 * n1), 0.65);
      alpha *= smoothstep(0.2, 0.42, wear + 0.08 * snoise(vec3(ruv * 0.35, 9.0))) * 0.7;
    }
    rgh = 0.95;
  } else if (tier < 2.5) {
    // cobbles: rounded setts in staggered rows, sand in the joints, a kerb at each edge
    vec2 cuv = ruv / vec2(0.22, 0.18);
    float row = floor(cuv.y);
    cuv.x += fract(row * 0.5);
    vec3 vv = voronoi3(vec3(cuv * 1.1, row * 0.37));
    float stone = smoothstep(0.03, 0.16, vv.y - vv.x);
    float k = rAA(fw, 0.1);
    // (worn, grimy setts: ~0.12–0.18 linear; at 0.3 the street read near-white by day and glowed at night)
    alb = mix(vec3(0.1, 0.09, 0.075), vec3(0.175, 0.165, 0.15) * (0.75 + 0.45 * vv.z), mix(0.85, stone, k));
    h = stone * (1.0 - vv.x) * k;
    alb *= mix(1.0, 0.72, smoothstep(0.5, 0.86, edge) * (0.6 + 0.4 * n1));
    float kerb = smoothstep(0.86, 0.9, edge);
    alb = mix(alb, vec3(0.2, 0.195, 0.185) * (0.9 + 0.15 * n1), kerb);
    rgh = 0.7;
  } else {
    if (tier < 3.5) {
      // flagstones: large rectangular slabs, worn and stained
      vec2 f = ruv / vec2(0.9, 0.6);
      float row = floor(f.y);
      f.x += fract(row * 0.37);
      vec2 cell = floor(f), ff = fract(f);
      float id = gn_hash12(cell);
      vec2 e = min(ff, 1.0 - ff) * vec2(0.9, 0.6);
      float joint = smoothstep(0.0, 0.015, min(e.x, e.y));
      float k = rAA(fw, 0.08);
      alb = vec3(0.165, 0.155, 0.14) * (0.8 + 0.3 * id) * mix(1.0, mix(0.45, 1.0, joint), k) * (0.9 + 0.12 * n1);
      // grime gathers along the kerbs and in the low spots
      alb *= mix(1.0, 0.7, smoothstep(0.55, 0.9, edge) * (0.6 + 0.4 * n1));
      h = joint * 0.4 * k;
      rgh = 0.75;
    } else {
      // macadam: dark fine grain, oil stains, a painted centre line
      float grain = snoise(vec3(ruv * 9.0, 1.0)) * rAA(fw, 0.05);
      alb = vec3(0.055, 0.055, 0.058) * (0.92 + 0.12 * grain + 0.1 * n1);
      float line = (1.0 - smoothstep(0.05, 0.08, abs(ruv.y))) * step(0.4, fract(along / 6.0));
      alb = mix(alb, vec3(0.62, 0.58, 0.45), line * 0.8);
      h = grain * 0.03;
      rgh = 0.82;
    }
    float kerb = smoothstep(0.9, 0.93, edge);
    alb = mix(alb, vec3(0.19, 0.185, 0.175), kerb);
    h += kerb * 0.6;
  }
  // wear: the busiest roads are darker and polished in the middle
  alb *= mix(1.0, 0.85, smoothstep(0.85, 1.0, wear) * (1.0 - edge));
  diffuseColor.rgb = alb;
  // paving stops at a dead end in a broken, crumbling edge (not a cut rectangle)
  if (tier >= 1.5 && vEnd < 2.5 && 0.5 + 0.5 * snoise(vec3(ruv * 1.6, 13.0)) > vEnd / 2.5) discard;
  diffuseColor.a = alpha;
`;

const FRAG_LIGHT = /* glsl */ `
  {
    float rP = length(vBodyPos);
    vec3 upB = vBodyPos / rP;
    float sh = sunShadow(-vViewPosition, normal);
    vec3 sunCol = uSunE * sunTransmittance(rP, dot(upB, uSunDirBody)) * sh * roadCloudShadow(vBodyPos, uSunDirBody);
    IncidentLight sunL;
    sunL.direction = uSunDirView;
    sunL.color = sunCol;
    sunL.visible = true;
    RE_Direct(sunL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
    ${moonDirect('vBodyPos', '1.0')}
  }
`;
const FRAG_LAMPS = /* glsl */ `
  if (vLamp > 1.5) {
    float night = smoothstep(0.08, -0.1, dot(normalize(vBodyPos), uSunDirBody));
    if (night > 0.0) {
      vec3 ls = lampSpec(floor(vLamp + 0.5));
      float halfW2 = vRoad.z < 0.5 ? (0.55 + 0.75 * clamp((vRoad.w - 0.2) / 0.5, 0.0, 1.0)) * 0.5 : max(0.8, 1.6 + clamp((vRoad.w - 0.55) / 0.4, 0.0, 1.0) * 4.4) * 0.5;
      float n0 = floor(vRoad.x / ls.x);
      float acrossM = vRoad.y * halfW2;
      float pool = 0.0;
      for (int j = -1; j <= 1; j++) {
        float n = n0 + float(j);
        float side = mod(n, 2.0) < 0.5 ? 1.0 : -1.0;
        vec2 dd = vec2(vRoad.x - (n + 0.5) * ls.x, acrossM - side * (halfW2 + 0.45));
        pool += exp(-dot(dd, dd) / (ls.y * ls.y));
      }
      // only the pools under the lamps (a constant glow along every lamp-lit stretch made streets read as neon tubes)
      totalEmissiveRadiance += lampTint(floor(vLamp + 0.5)) * diffuseColor.rgb * pool * ls.z * night * clamp(vLamp - 1.5, 0.0, 1.0);
    }
  }
`;

const FRAG_AMBIENT = /* glsl */ `
  {
    vec3 upB = normalize(vBodyPos);
    vec3 nB = normalize(transpose(uBodyToView) * normal);
    iblIrradiance += skyIrradiance(upB, nB, uSunDirBody) + uNightAmbient;
  }
`;

function makeRoadMaterial(shared: Record<string, IUniform>, transparent: boolean): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ roughness: 0.9, metalness: 0, transparent, depthWrite: !transparent, side: DoubleSide });
  mat.onBeforeCompile = (shader) => {
    for (const k of Object.keys(shared)) shader.uniforms[k] = shared[k];
    shader.vertexShader = shader.vertexShader
      .replace('#include <clipping_planes_pars_vertex>', `#include <clipping_planes_pars_vertex>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
  // pull toward the camera by a sliver of the distance: drawn over the terrain at any range, never floating
  mvPosition.xyz *= 0.9985;
  gl_Position = projectionMatrix * mvPosition;
  vRoad = aRoad;
  vLamp = aLamp;
  vEnd = aEnd;
  vBodyPos = position;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_SURFACE}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = rgh;')
      .replace('#include <normal_fragment_maps>', `{
    vec3 sx = dFdx(-vViewPosition); vec3 sy = dFdy(-vViewPosition);
    vec2 dh = vec2(dFdx(h * 0.02), dFdy(h * 0.02));
    vec3 r1 = cross(sy, normal); vec3 r2 = cross(normal, sx);
    float det = dot(sx, r1);
    vec3 bn = abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2);
    float bl = length(bn);
    if (bl > 1e-20 && !isnan(bl)) normal = bn / bl;
  }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_LAMPS}`)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>\n${FRAG_LIGHT}`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${FRAG_AMBIENT}`);
  };
  mat.customProgramCacheKey = () => `genesis-road-v3-${transparent ? 't' : 'o'}`;
  return mat;
}

export class Roads {
  readonly group = new Group();
  private dirt: Mesh;
  private paved: Mesh;
  private lastCam: [number, number, number] = [1e9, 0, 0];
  private stamp = '';
  private builtAt = -1e9;
  enabled = true;
  stats = { chains: 0, verts: 0, lamps: 0 };
  /** street lamps as light sources (the nearest become point lights at night) */
  lampLights: LightSource[] = [];
  lampVersion = 0;
  private lampMat: MeshStandardMaterial;
  private lampDepth: ShaderMaterial;
  /** lamp posts per light kind (index kind − 2) */
  private posts: { mesh: InstancedMesh; state: InstancedBufferAttribute; info: InstancedBufferAttribute; cap: number; geo: BufferGeometry; head: [number, number, number] }[] = [];
  private castShadows = false;
  /** hysteresis: the cells the drawn ways ran through last time, and the road field as the extraction sees it */
  private wasRoad = new Set<number>();
  private roadBuf: Float32Array | null = null;

  constructor(shared: Record<string, IUniform>) {
    this.group.name = 'roads';
    this.group.matrixAutoUpdate = false;
    this.dirt = new Mesh(new BufferGeometry(), makeRoadMaterial(shared, true));
    this.paved = new Mesh(new BufferGeometry(), makeRoadMaterial(shared, false));
    for (const m of [this.dirt, this.paved]) { m.frustumCulled = false; m.matrixAutoUpdate = false; m.visible = false; this.group.add(m); }
    this.dirt.renderOrder = 1;
    this.lampMat = makeBuildingMaterial(shared);
    this.lampDepth = makeBuildingDepthMaterial(shared);
    for (let kind = 2; kind <= 4; kind++) {
      const { geo, head } = lampPostMesh(kind, 0);
      this.posts.push(this.makePosts(geo, 64, head));
    }
  }

  private makePosts(geo: BufferGeometry, cap: number, head: [number, number, number]): Roads['posts'][number] {
    const state = new InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    const info = new InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    state.setUsage(DynamicDrawUsage);
    info.setUsage(DynamicDrawUsage);
    geo.setAttribute('iState', state);
    geo.setAttribute('iInfo', info);
    const mesh = new InstancedMesh(geo, this.lampMat, cap);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    if (this.castShadows) mesh.layers.enable(1);
    this.group.add(mesh);
    return { mesh, state, info, cap, geo, head };
  }

  setShadowCasting(on: boolean): void {
    if (on === this.castShadows) return;
    this.castShadows = on;
    for (const p of this.posts) { if (on) p.mesh.layers.enable(1); else p.mesh.layers.disable(1); }
  }

  /** the shadow pass draws the posts with the building depth material */
  swapDepth(depth: boolean): void {
    for (const p of this.posts) p.mesh.material = depth ? this.lampDepth : this.lampMat;
  }

  update(pv: PlanetView, camX: number, camY: number, camZ: number, buildings: Buildings): void {
    this.group.visible = this.enabled;
    if (!this.enabled) return;
    const road = pv.fields.get('road');
    const R = pv.params.radius;
    const rc = Math.hypot(camX, camY, camZ);
    const alt = rc - R - Math.max(0, pv.maxSurface * 0.5);
    // out of range (or no roads): nothing drawn, and the next approach rebuilds
    const off = !road || alt > RANGE * 1.4;
    for (const p of this.posts) if (off) p.mesh.visible = false; else p.mesh.visible = p.mesh.count > 0;
    if (off || !road) { this.dirt.visible = this.paved.visible = false; this.stamp = ''; if (this.lampLights.length) { this.lampLights = []; this.lampVersion++; } return; }
    this.dirt.visible = this.dirt.geometry.index !== null;
    this.paved.visible = this.paved.geometry.index !== null;
    const fieldStamp = `${pv.fieldVersion.get('road') ?? 0}|${pv.fieldVersion.get('surface') ?? 0}|${pv.settlements.length}`;
    const stamp = `${fieldStamp}|${buildings.layoutVersion}`;
    const moved = Math.hypot(camX - this.lastCam[0], camY - this.lastCam[1], camZ - this.lastCam[2]);
    if (stamp === this.stamp && moved < 120) return;
    // a living settlement lays out new building sites every few seconds: those alone re-route at most every 2.5 s
    const now = performance.now();
    if (this.stamp.startsWith(`${fieldStamp}|`) && moved < 120 && now - this.builtAt < 2500) return;
    this.builtAt = now;
    this.stamp = stamp;
    this.lastCam = [camX, camY, camZ];
    const dx = camX / rc, dy = camY / rc, dz = camZ / rc;
    const cells = pv.grid.cellsWithin(dx, dy, dz, RANGE / R).slice();
    // a way already drawn stays drawn until its wear falls a margin below the threshold: wear flickering about it
    // (a fire, a hard winter) broke streets into floating strips
    const buf = this.roadBuf && this.roadBuf.length === road.length ? this.roadBuf : (this.roadBuf = new Float32Array(road.length));
    for (const c of cells) buf[c] = this.wasRoad.has(c) ? Math.min(1, road[c] + TRAIL_HOLD) : road[c];
    const chains = extractRoads(pv.grid, buf, cells, R, TRAIL, 2);
    this.wasRoad.clear();
    for (const ch of chains) for (const c of ch.cells) this.wasRoad.add(c);
    // the era a chain is paved by: the nearest settlement within reach
    let chainEra = -1;
    const tierAt = (ux: number, uy: number, uz: number): number => {
      let best = -1, bd = 900 / R;
      for (const s of pv.settlements) {
        const d = Math.acos(Math.min(1, ux * s.pos[0] + uy * s.pos[1] + uz * s.pos[2]));
        if (d < bd) { bd = d; best = eraIndex(s.era); }
      }
      chainEra = best;
      // stone- and fire-age peoples (and ways nobody lives by) wear footpaths; roads come with the clay age's carts
      return best < 0 ? 0 : paveTier(best) + (best >= 9 ? 1 : 0);
    };
    // houses near a point (lamps light the streets that have houses beside them)
    const housed = (x: number, y: number, z: number, r: number): boolean => {
      for (const f of foot) {
        const ddx = x - f[0], ddy = y - f[1], ddz = z - f[2];
        if (ddx * ddx + ddy * ddy + ddz * ddz < (r + f[3]) * (r + f[3])) return true;
      }
      return false;
    };
    const lamps: { kind: number; m: number[]; seed: number }[] = [];
    const foot = buildings.footprints();
    const inside = (x: number, y: number, z: number): boolean => {
      for (const f of foot) {
        const ddx = x - f[0], ddy = y - f[1], ddz = z - f[2];
        if (ddx * ddx + ddy * ddy + ddz * ddz < f[3] * f[3]) return true;
      }
      return false;
    };
    const geo = {
      dirt: { p: [] as number[], n: [] as number[], a: [] as number[], l: [] as number[], e: [] as number[], i: [] as number[] },
      paved: { p: [] as number[], n: [] as number[], a: [] as number[], l: [] as number[], e: [] as number[], i: [] as number[] },
    };
    const ACROSS = [-1, -0.45, 0, 0.45, 1];
    const waterF = pv.fields.get('water') ?? null;
    // dead ends: a chain end no other chain meets (junction ends run on into the next chain)
    const ends = new Map<number, number>();
    for (const ch of chains) if (!ch.loop && ch.cells.length) for (const c of [ch.cells[0], ch.cells[ch.cells.length - 1]]) ends.set(c, (ends.get(c) ?? 0) + 1);
    // the highest of the ground under a ribbon vertex and half-way to its neighbours (detail relief between the
    // samples poked through the paving), plus a few centimetres
    const groundMax = (px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number => {
      let g = groundHeight(pv.ground, px, py, pz);
      for (const [qx, qy, qz] of [[ax, ay, az], [bx, by, bz]]) {
        let mx = (px + qx) * 0.5, my = (py + qy) * 0.5, mz = (pz + qz) * 0.5;
        const ml = Math.hypot(mx, my, mz) || 1;
        mx /= ml; my /= ml; mz /= ml;
        g = Math.max(g, groundHeight(pv.ground, mx, my, mz));
      }
      return g;
    };
    for (const ch of chains) {
      const np = ch.pts.length / 3;
      if (np < 2) continue;
      let total = 0;
      for (let i = 1; i < np; i++) total += Math.hypot(ch.pts[i * 3] - ch.pts[(i - 1) * 3], ch.pts[i * 3 + 1] - ch.pts[(i - 1) * 3 + 1], ch.pts[i * 3 + 2] - ch.pts[(i - 1) * 3 + 2]) * R;
      const dead0 = !ch.loop && ends.get(ch.cells[0]) === 1, dead1 = !ch.loop && ends.get(ch.cells[ch.cells.length - 1]) === 1;
      const mid = Math.floor(np / 2);
      const tier = tierAt(ch.pts[mid * 3], ch.pts[mid * 3 + 1], ch.pts[mid * 3 + 2]);
      const out = tier >= 2 ? geo.paved : geo.dirt;
      // street lamps from the medieval era (oil lanterns), gas with steam, electric after
      const lampKind = chainEra >= 6 ? lightKindForEra(chainEra) : 0;
      const spacing = LAMP[lampKind]?.spacing ?? 1e9;
      let along = 0;
      let prevRow = -1;
      let nextLamp = 0.5 * spacing, lampN = 0;
      for (let i = 0; i < np; i++) {
        const ux = ch.pts[i * 3], uy = ch.pts[i * 3 + 1], uz = ch.pts[i * 3 + 2];
        const j = Math.min(np - 1, i + 1), k = Math.max(0, i - 1);
        let tx = ch.pts[j * 3] - ch.pts[k * 3], ty = ch.pts[j * 3 + 1] - ch.pts[k * 3 + 1], tz = ch.pts[j * 3 + 2] - ch.pts[k * 3 + 2];
        const td = tx * ux + ty * uy + tz * uz;
        tx -= ux * td; ty -= uy * td; tz -= uz * td;
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        // side = up × tangent
        const sx = uy * tz - uz * ty, sy = uz * tx - ux * tz, sz = ux * ty - uy * tx;
        if (i > 0) along += Math.hypot(ux - ch.pts[(i - 1) * 3], uy - ch.pts[(i - 1) * 3 + 1], uz - ch.pts[(i - 1) * 3 + 2]) * R;
        const wear = ch.wear[i];
        // below a road's threshold, a road-era settlement's way is still only a path
        const tierHere = tier === 1 && wear < 0.5 ? 0 : tier;
        // a dead end narrows to a rounded tip over its last metres
        const endDist = Math.min(dead0 ? along : 1e3, dead1 ? total - along : 1e3);
        const tt = Math.min(1, endDist / 2.5);
        const half = (tierHere === 0 ? trailWidth(wear) : roadWidth(wear)) * 0.5 * (0.45 + 0.55 * tt * tt * (3 - 2 * tt));
        const g0 = groundHeight(pv.ground, ux, uy, uz);
        // the lamp kind here: only where houses line the street
        const lampHere = lampKind && housed(ux * g0, uy * g0, uz * g0, 26) ? lampKind : 0;
        while (lampKind && along >= nextLamp) {
          const side = lampN % 2 === 0 ? 1 : -1;
          const off = (half + 0.45) * side;
          let lx = ux + (sx * off) / R, ly = uy + (sy * off) / R, lz = uz + (sz * off) / R;
          const ll = Math.hypot(lx, ly, lz);
          lx /= ll; ly /= ll; lz /= ll;
          const gl = groundHeight(pv.ground, lx, ly, lz);
          if (lampHere && !inside(lx * gl, ly * gl, lz * gl)) {
            // local frame: Y up, +Z toward the road (−side), X = Y × Z
            const zx = -sx * side, zy = -sy * side, zz = -sz * side;
            const xx = ly * zz - lz * zy, xy = lz * zx - lx * zz, xz = lx * zy - ly * zx;
            lamps.push({ kind: lampKind, m: [xx, xy, xz, lx, ly, lz, zx, zy, zz, lx * gl, ly * gl, lz * gl], seed: (lampN * 0.618 + along * 0.013) % 1 });
          }
          lampN++;
          nextLamp += spacing;
        }
        // no ribbon under a building, nor through standing water (a road ran on under a pool, its caustics over it)
        // (judged on the nearest cell: an interpolated sample picks up the sea next to every coastal street)
        if (inside(ux * g0, uy * g0, uz * g0) || (waterF && waterF[pv.grid.nearestCell(ux, uy, uz)] > 0.25)) { prevRow = -1; continue; }
        const base = out.p.length / 3;
        // the along-neighbours (half a step either way bounds the relief between ribbon rows)
        const ip = Math.max(0, i - 1), inx = Math.min(np - 1, i + 1);
        for (const a of ACROSS) {
          const off = (a * half) / R;
          let px = ux + sx * off, py = uy + sy * off, pz = uz + sz * off;
          const pl = Math.hypot(px, py, pz);
          px /= pl; py /= pl; pz /= pl;
          // a cambered road: the crown a few cm higher than the shoulders, over the highest ground about the vertex
          const g = groundMax(px, py, pz, ch.pts[ip * 3] + sx * off, ch.pts[ip * 3 + 1] + sy * off, ch.pts[ip * 3 + 2] + sz * off,
            ch.pts[inx * 3] + sx * off, ch.pts[inx * 3 + 1] + sy * off, ch.pts[inx * 3 + 2] + sz * off) + 0.04 + (1 - a * a) * (tier >= 2 ? 0.06 : 0.02);
          out.p.push(px * g, py * g, pz * g);
          out.a.push(along, a, tierHere, wear);
          out.l.push(lampHere);
          out.e.push(Math.min(endDist, 50));
        }
        if (prevRow >= 0) {
          for (let c = 0; c < ACROSS.length - 1; c++) {
            const a0 = prevRow + c, a1 = prevRow + c + 1, b0 = base + c, b1 = base + c + 1;
            out.i.push(a0, b0, b1, a0, b1, a1);
          }
        }
        prevRow = base;
      }
    }
    const put = (m: Mesh, g: { p: number[]; n: number[]; a: number[]; l: number[]; e: number[]; i: number[] }) => {
      m.geometry.dispose();
      const bg = new BufferGeometry();
      if (g.i.length) {
        bg.setAttribute('position', new Float32BufferAttribute(g.p, 3));
        bg.setAttribute('aRoad', new Float32BufferAttribute(g.a, 4));
        bg.setAttribute('aLamp', new Float32BufferAttribute(g.l, 1));
        bg.setAttribute('aEnd', new Float32BufferAttribute(g.e, 1));
        bg.setIndex(new Uint32BufferAttribute(g.i, 1));
        // the ribbon's own normals (it follows the slopes), wound upward
        bg.computeVertexNormals();
      }
      m.geometry = bg;
      m.visible = g.i.length > 0;
    };
    put(this.dirt, geo.dirt);
    put(this.paved, geo.paved);
    this.placeLamps(lamps);
    this.stats.chains = chains.length;
    this.stats.verts = (geo.dirt.p.length + geo.paved.p.length) / 3;
  }

  private placeLamps(lamps: { kind: number; m: number[]; seed: number }[]): void {
    const counts = [0, 0, 0];
    for (const l of lamps) counts[l.kind - 2]++;
    for (let k = 0; k < 3; k++) {
      let p = this.posts[k];
      if (counts[k] > p.cap) {
        let cap = p.cap;
        while (cap < counts[k]) cap *= 2;
        this.group.remove(p.mesh);
        p.mesh.dispose();
        p = this.posts[k] = this.makePosts(p.geo, cap, p.head);
      }
      p.mesh.count = 0;
    }
    this.lampLights = [];
    for (const l of lamps) {
      const p = this.posts[l.kind - 2];
      const i = p.mesh.count++;
      const m = l.m;
      _mat.set(m[0], m[3], m[6], m[9], m[1], m[4], m[7], m[10], m[2], m[5], m[8], m[11], 0, 0, 0, 1);
      p.mesh.setMatrixAt(i, _mat);
      // iState: complete, intact, lit, light kind at full level; iInfo: height, half extents, seed
      p.state.setXYZW(i, 1, 0, 128, l.kind * 256 + 255);
      p.info.setXYZW(i, 7, 0.3, 0.3, l.seed);
      const h = p.head;
      this.lampLights.push({ x: m[9] + m[3] * h[1] + m[6] * h[2], y: m[10] + m[4] * h[1] + m[7] * h[2], z: m[11] + m[5] * h[1] + m[8] * h[2], kind: 12, power: l.kind === 4 ? 1.6 : l.kind === 3 ? 1.0 : 0.6, seed: l.seed });
    }
    for (const p of this.posts) {
      p.mesh.visible = p.mesh.count > 0;
      p.mesh.instanceMatrix.needsUpdate = true;
      p.state.needsUpdate = true;
      p.info.needsUpdate = true;
    }
    this.stats.lamps = lamps.length;
    this.lampVersion++;
  }

  dispose(): void {
    for (const m of [this.dirt, this.paved]) { m.geometry.dispose(); (m.material as MeshStandardMaterial).dispose(); }
    for (const p of this.posts) { p.geo.dispose(); p.mesh.dispose(); }
    this.lampMat.dispose();
    this.lampDepth.dispose();
  }
}
