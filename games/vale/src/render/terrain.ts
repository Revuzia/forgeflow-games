// VALE render — procedural terrain from the map JSON (CONTRACT §0: terrain, scatter and trim are
// allowed to be procedural). Used when `map.art.scene` is missing or empty, and in dev.
//
// What it builds, all from MapDef (walls, thickets, lanes, bases, structures, camps, pickups, shops):
//   ground   one large quad; a CPU-baked splat (RGBA8, ≤ 0.5 m texels) of DISTANCES — lane centre,
//            clearing edge, wall edge, thicket edge — shaded in the fragment shader: carved flagstone
//            roads (lighter, quieter: L* 62–68), dark mossy Dialwood floor (L* 30–40), dusty
//            clearings (L* 45–50) around camps / bases / structures, wall-foot occlusion and faint
//            carved hour-lines (the Vale is one sundial). Roughness ≥ 0.5 everywhere walkable.
//   cliffs   every wall polygon extruded 2.6–3.4 m with a carved bevel: lit tops (L* 55–62), dark
//            faces (L* 18–25) cut with horizontal courses; an outer rim closes the world.
//   brush    Needlegrass: instanced clumps of SOLID tapered blades (no alpha cards) on a carved curb.
//   scatter  (quality: 0 none · 1 half · 2 full) fan-leaved Dialwood trees of bevelled plates on cliff
//            tops, and stones on the jungle floor. Never inside lanes, clearings or brush.
// Every material is patched with the world chunk (fog of war + edge haze). Deterministic layout.

import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DataTexture, DoubleSide,
  ExtrudeGeometry, Group, IcosahedronGeometry, InstancedMesh, LinearFilter, Matrix4, Mesh,
  MeshStandardMaterial, PlaneGeometry, Quaternion, RGBAFormat, Shape, ShapeUtils, UnsignedByteType, Vector2, Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapDefT } from '../contracts/catalog.ts';
import { NOISE_GLSL } from './glsl.ts';
import { patchWorldMaterial, worldUniforms } from './world_material.ts';

type V2 = readonly [number, number];
type Poly = readonly V2[];

const LANE_HALF = 3.6;
const MARGIN = 60;

// ── deterministic random ───────────────────────────────────────────────────────────────────────
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── geometry helpers ───────────────────────────────────────────────────────────────────────────
export function pointInPolygon(x: number, y: number, poly: Poly): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}
function polyEdgeDist(x: number, y: number, poly: Poly): number {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, segDist(x, y, poly[j][0], poly[j][1], poly[i][0], poly[i][1]));
  return d;
}
interface Box { minX: number; minY: number; maxX: number; maxY: number }
function bbox(poly: Poly): Box {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of poly) { b.minX = Math.min(b.minX, x); b.minY = Math.min(b.minY, y); b.maxX = Math.max(b.maxX, x); b.maxY = Math.max(b.maxY, y); }
  return b;
}
function boxDist(x: number, y: number, b: Box): number {
  const dx = Math.max(b.minX - x, 0, x - b.maxX), dy = Math.max(b.minY - y, 0, y - b.maxY);
  return Math.sqrt(dx * dx + dy * dy);
}
function polyArea(poly: Poly): number { return Math.abs(ShapeUtils.area(poly.map(([x, y]) => new Vector2(x, y)))); }

// ── palette (tokens.json colors.terrain-ref + bible valueLstar), overridable by map.art.terrain ─────
interface TerrainColors { lane: string; laneGrout: string; jungle: string; moss: string; clearing: string; inscription: string;
  cliffTop: string; cliffFace: string; curb: string; grassRoot: string; grassTip: string; leaf: string; trunk: string; stone: string }
const DEFAULT_COLORS: TerrainColors = {
  lane: '#9A927F', laneGrout: '#6A6456', jungle: '#4E5547', moss: '#435040', clearing: '#7A766A', inscription: '#B7B0A0',
  cliffTop: '#8E8979', cliffFace: '#3B3934', curb: '#8A8476', grassRoot: '#2E3A2F', grassTip: '#8C9B80', leaf: '#46624A',
  trunk: '#4A3F36', stone: '#6E6A60',
};
function colorsFrom(terrain: Record<string, unknown> | undefined): TerrainColors {
  const c: TerrainColors = { ...DEFAULT_COLORS };
  const src = (terrain?.colors && typeof terrain.colors === 'object' ? terrain.colors : terrain) as Record<string, unknown> | undefined;
  if (src) for (const k of Object.keys(c) as (keyof TerrainColors)[]) {
    const v = src[k];
    if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) c[k] = v;
  }
  return c;
}

export interface TerrainBuild {
  group: Group;
  /** cliff tops / props: heights of every wall polygon, for picking and VFX */
  wallHeights: number[];
  setScatter(level: 0 | 1 | 2): void;
  update(time: number): void;
  dispose(): void;
}

interface Clearing { x: number; y: number; r: number }

export function buildTerrain(map: MapDefT): TerrainBuild {
  const group = new Group();
  group.name = 'vale_terrain';
  const [SX, SY] = map.size;
  const colors = colorsFrom(map.art.terrain as Record<string, unknown>);
  const rand = mulberry(0x5eed ^ Math.round(SX * 131 + SY * 17));
  const walls: Poly[] = map.walls.map((w) => w.map((p) => [p[0], p[1]] as V2));
  const thickets: Poly[] = (map.thickets ?? []).map((w) => w.map((p) => [p[0], p[1]] as V2));
  const wallBoxes = walls.map(bbox);
  const thicketBoxes = thickets.map(bbox);
  const lanes = map.lanes.map((l) => l.path.map((p) => [p[0], p[1]] as V2));

  // clearings: bases, shops, structures, camps, pickups, spawns
  const clearings: Clearing[] = [];
  for (const b of map.bases) {
    clearings.push({ x: b.fountain.at[0], y: b.fountain.at[1], r: b.fountain.radius + 3.5 });
    clearings.push({ x: b.shop.at[0], y: b.shop.at[1], r: b.shop.radius + 1.5 });
    clearings.push({ x: b.spawn[0], y: b.spawn[1], r: 3 });
  }
  for (const s of map.structures ?? []) clearings.push({ x: s.at[0], y: s.at[1], r: 4.5 });
  for (const c of map.camps ?? []) {
    let cx = 0, cy = 0;
    for (const u of c.units) { cx += u.at[0]; cy += u.at[1]; }
    cx /= Math.max(1, c.units.length); cy /= Math.max(1, c.units.length);
    let r = 0;
    for (const u of c.units) r = Math.max(r, Math.hypot(u.at[0] - cx, u.at[1] - cy));
    clearings.push({ x: cx, y: cy, r: r + (c.objective ? 6 : 4.5) });
  }
  for (const p of map.pickups ?? []) clearings.push({ x: p.at[0], y: p.at[1], r: 2.2 });
  for (const s of map.spawns ?? []) clearings.push({ x: s[0], y: s[1], r: 2.6 });
  for (const s of map.shops ?? []) clearings.push({ x: s.at[0], y: s.at[1], r: s.radius + 1.5 });

  // ── splat (distance fields) ──────────────────────────────────────────────────────────────────
  const texel = Math.max(0.5, Math.max(SX, SY) / 384);
  const W = Math.ceil(SX / texel) + 1, H = Math.ceil(SY / texel) + 1;
  const splat = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    const y = j * texel;
    for (let i = 0; i < W; i++) {
      const x = i * texel;
      let ld = 16;
      for (const l of lanes) for (let k = 1; k < l.length; k++) ld = Math.min(ld, segDist(x, y, l[k - 1][0], l[k - 1][1], l[k][0], l[k][1]));
      let cd = 16;
      for (const c of clearings) cd = Math.min(cd, Math.hypot(x - c.x, y - c.y) - c.r);
      let wd = 8;
      for (let k = 0; k < walls.length; k++) {
        if (boxDist(x, y, wallBoxes[k]) >= wd) continue;
        if (pointInPolygon(x, y, walls[k])) { wd = 0; break; }
        wd = Math.min(wd, polyEdgeDist(x, y, walls[k]));
      }
      let td = 4;
      for (let k = 0; k < thickets.length; k++) {
        if (boxDist(x, y, thicketBoxes[k]) >= td) continue;
        const e = polyEdgeDist(x, y, thickets[k]);
        td = Math.min(td, pointInPolygon(x, y, thickets[k]) ? -e : e);
      }
      const o = (j * W + i) * 4;
      splat[o] = Math.round(Math.min(1, ld / 16) * 255);
      splat[o + 1] = Math.round(Math.min(1, Math.max(0, (cd + 8) / 24)) * 255);
      splat[o + 2] = Math.round(Math.min(1, wd / 8) * 255);
      splat[o + 3] = Math.round(Math.min(1, Math.max(0, (td + 4) / 8)) * 255);
    }
  }
  const splatTex = new DataTexture(splat, W, H, RGBAFormat, UnsignedByteType);
  splatTex.magFilter = LinearFilter; splatTex.minFilter = LinearFilter; splatTex.generateMipmaps = false;
  splatTex.needsUpdate = true;

  const disposables: { dispose(): void }[] = [splatTex];
  const lin = (hex: string): Color => new Color().setStyle(hex);

  // ── ground ───────────────────────────────────────────────────────────────────────────────────
  const groundGeo = new PlaneGeometry(SX + MARGIN * 2, SY + MARGIN * 2, 1, 1);
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate(SX / 2, 0, SY / 2);
  const groundMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  const gu = {
    uSplat: { value: splatTex },
    uSplatScale: { value: new Vector2(1 / (W * texel), 1 / (H * texel)) },
    uLaneHalf: { value: LANE_HALF },
    uLane: { value: lin(colors.lane) }, uGrout: { value: lin(colors.laneGrout) }, uJungle: { value: lin(colors.jungle) },
    uMoss: { value: lin(colors.moss) }, uClearing: { value: lin(colors.clearing) }, uInscription: { value: lin(colors.inscription) },
    uThicketFloor: { value: lin(colors.grassRoot) },
    uCenter: { value: new Vector2(SX / 2, SY / 2) },
  };
  groundMat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, gu);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGroundW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vGroundW;
uniform sampler2D uSplat; uniform vec2 uSplatScale; uniform float uLaneHalf;
uniform vec3 uLane, uGrout, uJungle, uMoss, uClearing, uInscription, uThicketFloor; uniform vec2 uCenter;
float gHeight; float gRough;
${NOISE_GLSL}
// running-bond flagstones in world space: returns (stone value jitter, grout mask, cell hash)
vec3 valeFlags( vec2 p ) {
  vec2 sz = vec2( 1.7, 1.15 );
  float row = floor( p.y / sz.y );
  vec2 q = vec2( p.x / sz.x + 0.5 * mod( row, 2.0 ) + 0.13 * valeHash12( vec2( row, 7.0 ) ), p.y / sz.y );
  vec2 id = floor( q ); vec2 f = fract( q );
  vec2 e = min( f, 1.0 - f ) * sz;
  float edge = min( e.x, e.y );
  float grout = 1.0 - smoothstep( 0.025, 0.06, edge );
  float h = valeHash12( id + row * 3.1 );
  return vec3( h, grout, edge );
}`)
      .replace('#include <map_fragment>', `
{
  vec2 p = vGroundW.xz;
  vec4 s = texture( uSplat, p * uSplatScale );
  float laneD = s.r * 16.0, clearD = s.g * 24.0 - 8.0, wallD = s.b * 8.0, thickD = s.a * 8.0 - 4.0;
  float n1 = valeFbm( p * 0.21 ), n2 = valeNoise( p * 1.9 ), n3 = valeNoise( p * 7.3 ), n4 = valeFbm( p * 0.06 + 3.7 );
  float wob = ( n1 - 0.5 ) * 1.1 + ( n2 - 0.5 ) * 0.35;
  float lane = 1.0 - smoothstep( uLaneHalf - 0.08, uLaneHalf + 0.08, laneD + wob * 0.55 );
  float clearing = 1.0 - smoothstep( -0.6, 0.9, clearD + wob * 1.4 );
  // Dialwood floor: dark, mossy, quiet
  vec3 jungle = uJungle * ( 0.78 + 0.34 * n1 + 0.10 * ( n3 - 0.5 ) );
  jungle = mix( jungle, uMoss * ( 0.85 + 0.2 * n2 ), smoothstep( 0.52, 0.7, n4 ) * 0.7 );
  // clearings: packed dust with scattered grit
  vec3 clearC = uClearing * ( 0.9 + 0.16 * ( n1 - 0.5 ) + 0.08 * ( n3 - 0.5 ) );
  // carved road: flagstones, worn toward the centre line
  vec3 fl = valeFlags( p );
  float wear = 1.0 - smoothstep( 0.0, uLaneHalf, laneD );
  vec3 laneC = uLane * ( 0.92 + 0.11 * ( fl.x - 0.5 ) + 0.06 * ( n3 - 0.5 ) + 0.05 * wear );
  laneC = mix( laneC, uGrout, fl.y * 0.85 );
  // carved road edge: a slim darker kerb line just inside the edge
  float kerb = smoothstep( uLaneHalf - 0.55, uLaneHalf - 0.35, laneD + wob * 0.55 ) * ( 1.0 - smoothstep( uLaneHalf - 0.2, uLaneHalf, laneD + wob * 0.55 ) );
  laneC = mix( laneC, uGrout * 0.9, kerb * 0.6 );
  vec3 col = mix( jungle, clearC, clearing );
  col = mix( col, laneC, lane );
  // carved hour-lines radiating from the dial's centre (quiet inscription)
  vec2 rc = p - uCenter; float rr = length( rc );
  float ang = atan( rc.x, -rc.y );
  float seg = 6.2831853 / 12.0;
  float al = abs( mod( ang + seg * 0.5, seg ) - seg * 0.5 ) * rr;
  float hour = ( 1.0 - smoothstep( 0.06, 0.11, al ) ) * smoothstep( 7.0, 12.0, rr );
  col = mix( col, uInscription * ( 0.9 + 0.1 * n2 ), hour * mix( 0.22, 0.45, lane ) );
  // wall-foot occlusion and brush floor
  col *= mix( 0.58, 1.0, smoothstep( 0.0, 1.8, wallD ) );
  float brush = 1.0 - smoothstep( -0.3, 0.25, thickD );
  col = mix( col, uThicketFloor * ( 0.85 + 0.3 * n2 ), brush * 0.85 );
  diffuseColor.rgb *= col;
  gHeight = mix( ( n2 - 0.5 ) * 0.03 + ( n3 - 0.5 ) * 0.015, -fl.y * 0.03 + ( n3 - 0.5 ) * 0.006, lane ) - hour * 0.012;
  gRough = mix( mix( 0.94, 0.88, clearing ), 0.74 + 0.08 * fl.x, lane );
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = valeBump( -vViewPosition, normal, gHeight, 1.0 );');
  };
  groundMat.customProgramCacheKey = () => 'vale_ground_v2';
  patchWorldMaterial(groundMat);
  const ground = new Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  ground.name = 'vale_ground';
  group.add(ground);
  disposables.push(groundGeo, groundMat);

  // ── cliffs ───────────────────────────────────────────────────────────────────────────────────
  const wallHeights: number[] = [];
  const cliffGeos: BufferGeometry[] = [];
  const shapeOf = (poly: Poly, inset = 0): Shape => {
    let pts = poly.map(([x, y]) => new Vector2(x, -y));
    if (ShapeUtils.isClockWise(pts)) pts = pts.reverse();
    if (inset !== 0) pts = insetPolygon(pts, inset);
    return new Shape(pts);
  };
  walls.forEach((poly, i) => {
    const area = polyArea(poly);
    const b = wallBoxes[i];
    const minSide = Math.min(b.maxX - b.minX, b.maxY - b.minY);
    const h = 2.6 + 0.8 * ((Math.sin(i * 12.9898 + area) * 43758.5453) % 1 + 1) % 1;
    wallHeights.push(h);
    const bevel = Math.min(0.35, minSide * 0.18);
    const geo = new ExtrudeGeometry(shapeOf(poly), {
      depth: Math.max(0.2, h - bevel), steps: 1, bevelEnabled: bevel > 0.05, bevelThickness: bevel, bevelSize: bevel,
      bevelOffset: -bevel, bevelSegments: 2, curveSegments: 1,
    });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, bevel > 0.05 ? 0 : 0, 0);
    // ExtrudeGeometry has uv; drop it to merge cleanly
    geo.deleteAttribute('uv');
    cliffGeos.push(geo.toNonIndexed());
    geo.dispose();
  });
  // outer rim: a carved wall all around the playable plate
  const RIM = 14, RH = 3.4;
  const rimPolys: Poly[] = [
    [[-RIM, -RIM], [SX + RIM, -RIM], [SX + RIM, 0], [-RIM, 0]],
    [[-RIM, SY], [SX + RIM, SY], [SX + RIM, SY + RIM], [-RIM, SY + RIM]],
    [[-RIM, 0], [0, 0], [0, SY], [-RIM, SY]],
    [[SX, 0], [SX + RIM, 0], [SX + RIM, SY], [SX, SY]],
  ];
  for (const poly of rimPolys) {
    const geo = new ExtrudeGeometry(shapeOf(poly), { depth: RH - 0.4, bevelEnabled: true, bevelThickness: 0.4, bevelSize: 0.4, bevelOffset: -0.4, bevelSegments: 2 });
    geo.rotateX(-Math.PI / 2);
    geo.deleteAttribute('uv');
    cliffGeos.push(geo.toNonIndexed());
    geo.dispose();
  }
  const cliffGeo = mergeGeometries(cliffGeos, false);
  for (const g of cliffGeos) g.dispose();
  const cliffMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0 });
  const cu = { uTop: { value: lin(colors.cliffTop) }, uFace: { value: lin(colors.cliffFace) }, uMossC: { value: lin(colors.moss) } };
  cliffMat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, cu);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCliffW; varying vec3 vCliffN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCliffW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz; vCliffN = normalize( mat3( modelMatrix ) * objectNormal );');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vCliffW; varying vec3 vCliffN; uniform vec3 uTop, uFace, uMossC; float cH;
${NOISE_GLSL}`)
      .replace('#include <map_fragment>', `
{
  vec3 n = normalize( vCliffN );
  float top = smoothstep( 0.55, 0.92, n.y );
  vec2 hp = vCliffW.xz + vec2( vCliffW.y * 0.37 );
  float along = dot( vCliffW.xz, normalize( vec2( n.z, -n.x ) + 1e-4 ) );
  float n1 = valeFbm( vCliffW.xz * 0.35 ), n2 = valeNoise( vec2( along * 0.9, vCliffW.y * 3.0 ) ), n3 = valeNoise( hp * 6.0 );
  // carved courses: horizontal grooves every ~0.55 m with jittered block joints
  float course = fract( vCliffW.y / 0.55 + 0.15 );
  float groove = 1.0 - smoothstep( 0.0, 0.07, min( course, 1.0 - course ) );
  float block = fract( along / 1.3 + floor( vCliffW.y / 0.55 ) * 0.5 );
  float joint = 1.0 - smoothstep( 0.0, 0.03, min( block, 1.0 - block ) );
  vec3 face = uFace * ( 0.85 + 0.3 * n2 + 0.08 * ( n3 - 0.5 ) );
  face *= mix( 0.62, 1.0, smoothstep( 0.0, 1.6, vCliffW.y ) );
  face = mix( face, face * 0.55, max( groove, joint * 0.7 ) );
  vec3 topC = uTop * ( 0.86 + 0.22 * n1 + 0.08 * ( n3 - 0.5 ) );
  topC = mix( topC, uMossC * 1.15, smoothstep( 0.6, 0.78, valeFbm( vCliffW.xz * 0.18 + 9.0 ) ) * 0.45 );
  diffuseColor.rgb *= mix( face, topC, top );
  cH = ( 1.0 - top ) * ( -max( groove, joint * 0.7 ) * 0.035 + ( n2 - 0.5 ) * 0.02 ) + top * ( n3 - 0.5 ) * 0.01;
}`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = valeBump( -vViewPosition, normal, cH, 1.0 );');
  };
  cliffMat.customProgramCacheKey = () => 'vale_cliff_v2';
  patchWorldMaterial(cliffMat);
  const cliffs = new Mesh(cliffGeo, cliffMat);
  cliffs.castShadow = true; cliffs.receiveShadow = true; cliffs.name = 'vale_cliffs';
  group.add(cliffs);
  disposables.push(cliffGeo, cliffMat);

  // ── Needlegrass (brush) + curb ───────────────────────────────────────────────────────────────
  const clump = needlegrassClump(lin(colors.grassRoot), lin(colors.grassTip));
  const grassMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, side: DoubleSide });
  const grassU = { uWindT: worldUniforms.valeTime };
  grassMat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, grassU);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  #ifdef USE_INSTANCING
  vec2 base = vec2( instanceMatrix[3][0], instanceMatrix[3][2] );
  #else
  vec2 base = vec2( 0.0 );
  #endif
  float hf = clamp( position.y / 1.25, 0.0, 1.0 );
  float ph = base.x * 0.37 + base.y * 0.53;
  // T0 ambient: slow sway, 0.35 Hz (bible cap 0.5 Hz)
  float sway = sin( uWindT * 2.2 + ph ) * 0.05 + sin( uWindT * 1.3 + ph * 1.7 ) * 0.03;
  transformed.x += sway * hf * hf;
  transformed.z += sway * 0.6 * hf * hf;
}`);
  };
  grassMat.customProgramCacheKey = () => 'vale_grass_v1';
  patchWorldMaterial(grassMat);
  const grassPts: { x: number; y: number }[] = [];
  thickets.forEach((poly, k) => {
    const b = thicketBoxes[k];
    const step = 0.5;
    for (let y = b.minY + step / 2; y < b.maxY; y += step) {
      for (let x = b.minX + step / 2; x < b.maxX; x += step) {
        const jx = x + (rand() - 0.5) * step * 0.9, jy = y + (rand() - 0.5) * step * 0.9;
        if (!pointInPolygon(jx, jy, poly)) continue;
        if (polyEdgeDist(jx, jy, poly) < 0.18) continue;
        grassPts.push({ x: jx, y: jy });
      }
    }
  });
  if (grassPts.length > 0) {
    const grass = new InstancedMesh(clump, grassMat, grassPts.length);
    const m = new Matrix4(), q = new Quaternion(), s = new Vector3(), pos = new Vector3(), up = new Vector3(0, 1, 0);
    grassPts.forEach((p, i) => {
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      const k = 0.8 + rand() * 0.45;
      s.set(k, 0.85 + rand() * 0.35, k);
      pos.set(p.x, 0, p.y);
      m.compose(pos, q, s);
      grass.setMatrixAt(i, m);
    });
    grass.castShadow = true; grass.receiveShadow = true; grass.name = 'vale_needlegrass';
    grass.computeBoundingSphere();
    group.add(grass);
    disposables.push(grass);
  }
  disposables.push(clump, grassMat);
  // curb: thin carved stone band along every brush outline
  const curbGeos: BufferGeometry[] = [];
  for (const poly of thickets) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const ax = poly[j][0], ay = poly[j][1], bx = poly[i][0], by = poly[i][1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.05) continue;
      const g = new BoxGeometry(len + 0.22, 0.16, 0.22);
      g.rotateY(-Math.atan2(by - ay, bx - ax));
      g.translate((ax + bx) / 2, 0.08, (ay + by) / 2);
      g.deleteAttribute('uv');
      curbGeos.push(g);
    }
  }
  if (curbGeos.length) {
    const curbGeo = mergeGeometries(curbGeos, false);
    for (const g of curbGeos) g.dispose();
    const curbMat = new MeshStandardMaterial({ color: lin(colors.curb), roughness: 0.8 });
    patchWorldMaterial(curbMat);
    const curb = new Mesh(curbGeo, curbMat);
    curb.receiveShadow = true; curb.castShadow = true; curb.name = 'vale_curb';
    group.add(curb);
    disposables.push(curbGeo, curbMat);
  }

  // ── scatter (quality dependent) ─────────────────────────────────────────────────────────────
  const scatterGroup = new Group();
  scatterGroup.name = 'vale_scatter';
  group.add(scatterGroup);
  const treeSpots: { x: number; y: number; h: number; s: number; r: number; tint: number }[] = [];
  walls.forEach((poly, i) => {
    const b = wallBoxes[i];
    const step = 3.2;
    for (let y = b.minY + step / 2; y < b.maxY; y += step) {
      for (let x = b.minX + step / 2; x < b.maxX; x += step) {
        const jx = x + (rand() - 0.5) * step * 0.8, jy = y + (rand() - 0.5) * step * 0.8;
        if (!pointInPolygon(jx, jy, poly) || polyEdgeDist(jx, jy, poly) < 1.4) continue;
        if (jx < 0 || jy < 0 || jx > SX || jy > SY) continue;
        treeSpots.push({ x: jx, y: jy, h: wallHeights[i], s: 0.75 + rand() * 0.5, r: rand() * Math.PI * 2, tint: rand() });
      }
    }
  });
  const stoneSpots: { x: number; y: number; s: number; r: number }[] = [];
  const nStones = Math.round(SX * SY * 0.02);
  for (let k = 0; k < nStones; k++) {
    const x = rand() * SX, y = rand() * SY;
    let ok = true;
    for (const l of lanes) for (let i = 1; i < l.length && ok; i++) if (segDist(x, y, l[i - 1][0], l[i - 1][1], l[i][0], l[i][1]) < LANE_HALF + 1.2) ok = false;
    for (const c of clearings) if (ok && Math.hypot(x - c.x, y - c.y) < c.r + 0.8) ok = false;
    for (let w = 0; w < walls.length && ok; w++) if (boxDist(x, y, wallBoxes[w]) < 0.6 && (pointInPolygon(x, y, walls[w]) || polyEdgeDist(x, y, walls[w]) < 0.6)) ok = false;
    for (let t = 0; t < thickets.length && ok; t++) if (boxDist(x, y, thicketBoxes[t]) < 0.5 && pointInPolygon(x, y, thickets[t])) ok = false;
    if (ok) stoneSpots.push({ x, y, s: 0.12 + Math.pow(rand(), 2.2) * 0.5, r: rand() * Math.PI * 2 });
  }
  const trunkGeo = new CylinderGeometry(0.11, 0.2, 1, 6, 1);
  trunkGeo.translate(0, 0.5, 0);
  const canopyGeo = fanCanopy();
  const stoneGeo = new IcosahedronGeometry(1, 0);
  stoneGeo.scale(1, 0.55, 1);
  const leafMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0 });
  const trunkMat = new MeshStandardMaterial({ color: lin(colors.trunk), roughness: 0.85 });
  const stoneMat = new MeshStandardMaterial({ color: lin(colors.stone), roughness: 0.9, flatShading: true });
  for (const mt of [leafMat, trunkMat, stoneMat]) patchWorldMaterial(mt);
  disposables.push(trunkGeo, canopyGeo, stoneGeo, leafMat, trunkMat, stoneMat);
  const leafBase = lin(colors.leaf);
  let scatterMeshes: InstancedMesh[] = [];
  const setScatter = (level: 0 | 1 | 2): void => {
    for (const m of scatterMeshes) { scatterGroup.remove(m); m.dispose(); }
    scatterMeshes = [];
    if (level === 0) return;
    const keep = level === 1 ? 0.5 : 1;
    const trees = treeSpots.filter((_, i) => (i * 0.618034) % 1 < keep);
    const stones = stoneSpots.filter((_, i) => (i * 0.618034) % 1 < keep);
    const m = new Matrix4(), q = new Quaternion(), s = new Vector3(), pos = new Vector3(), up = new Vector3(0, 1, 0), c = new Color();
    if (trees.length) {
      const trunks = new InstancedMesh(trunkGeo, trunkMat, trees.length);
      const canopies = new InstancedMesh(canopyGeo, leafMat, trees.length);
      trees.forEach((t, i) => {
        const th = 1.1 + t.s * 0.9;
        q.setFromAxisAngle(up, t.r);
        s.set(t.s, th, t.s); pos.set(t.x, t.h, t.y);
        m.compose(pos, q, s); trunks.setMatrixAt(i, m);
        s.set(t.s * 1.15, t.s * 1.0, t.s * 1.15); pos.set(t.x, t.h + th * 0.92, t.y);
        m.compose(pos, q, s); canopies.setMatrixAt(i, m);
        c.copy(leafBase).multiplyScalar(0.8 + t.tint * 0.4);
        canopies.setColorAt(i, c);
      });
      for (const im of [trunks, canopies]) { im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); scatterGroup.add(im); scatterMeshes.push(im); }
    }
    if (stones.length) {
      const st = new InstancedMesh(stoneGeo, stoneMat, stones.length);
      stones.forEach((p, i) => {
        q.setFromAxisAngle(up, p.r); s.set(p.s, p.s, p.s * 0.8); pos.set(p.x, p.s * 0.12, p.y);
        m.compose(pos, q, s); st.setMatrixAt(i, m);
      });
      st.castShadow = true; st.receiveShadow = true; st.computeBoundingSphere();
      scatterGroup.add(st); scatterMeshes.push(st);
    }
  };
  setScatter(2);

  return {
    group,
    wallHeights,
    setScatter,
    update(time: number): void { worldUniforms.valeTime.value = time; },
    dispose(): void {
      for (const m of scatterMeshes) m.dispose();
      for (const d of disposables) d.dispose();
    },
  };
}

/** a clump of 7 solid, V-folded, tapered blades (no alpha), root dark → tip light */
function needlegrassClump(root: Color, tip: Color): BufferGeometry {
  const pos: number[] = [], col: number[] = [], nor: number[] = [];
  const rand = mulberry(77);
  const SEG = 3;
  for (let b = 0; b < 7; b++) {
    const a = (b / 7) * Math.PI * 2 + rand() * 0.6;
    const r0 = b === 0 ? 0 : 0.05 + rand() * 0.12;
    const bx = Math.cos(a) * r0, bz = Math.sin(a) * r0;
    const lean = 0.18 + rand() * 0.3;
    const h = 0.85 + rand() * 0.45;
    const w = 0.055 + rand() * 0.03;
    const dirx = Math.cos(a + 0.3), dirz = Math.sin(a + 0.3);
    const px = -dirz, pz = dirx; // blade width axis
    const ring: [number, number, number][][] = [];
    for (let k = 0; k <= SEG; k++) {
      const t = k / SEG;
      const cx = bx + dirx * lean * t * t * h, cz = bz + dirz * lean * t * t * h, cy = h * t;
      const ww = w * (1 - t * 0.92);
      // V fold: centre ridge raised toward the blade's outward side
      ring.push([[cx - px * ww, cy, cz - pz * ww], [cx + dirx * ww * 0.35, cy, cz + dirz * ww * 0.35], [cx + px * ww, cy, cz + pz * ww]]);
    }
    for (let k = 0; k < SEG; k++) {
      const t0 = k / SEG, t1 = (k + 1) / SEG;
      for (let side = 0; side < 2; side++) {
        const a0 = ring[k][side], a1 = ring[k][side + 1], b0 = ring[k + 1][side], b1 = ring[k + 1][side + 1];
        const tris = [a0, a1, b1, a0, b1, b0];
        const ts = [t0, t0, t1, t0, t1, t1];
        for (let v = 0; v < 6; v++) {
          pos.push(...tris[v]);
          const c = root.clone().lerp(tip, Math.pow(ts[v], 0.8));
          col.push(c.r, c.g, c.b);
          // normals biased upward for a soft top-lit read
          nor.push(dirx * 0.35 * (side ? 1 : -1) + px * 0.2, 0.9, dirz * 0.35 + pz * 0.2);
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  const n = new Float32Array(nor);
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]); n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  g.setAttribute('normal', new BufferAttribute(n, 3));
  return g;
}

/** Dialwood canopy: 5 lacquered fan plates (bevel-ish boxes) radiating from the trunk top */
function fanCanopy(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const rand = mulberry(1234);
  for (let i = 0; i < 5; i++) {
    const g = new BoxGeometry(1.25, 0.09, 0.62, 1, 1, 1);
    g.translate(0.62, 0, 0);
    g.rotateZ(0.32 + rand() * 0.35);
    g.rotateY((i / 5) * Math.PI * 2 + rand() * 0.4);
    g.translate(0, rand() * 0.25, 0);
    g.deleteAttribute('uv');
    parts.push(g.toNonIndexed());
    g.dispose();
  }
  const cap = new BoxGeometry(0.7, 0.12, 0.7);
  cap.rotateY(0.4); cap.translate(0, 0.3, 0); cap.deleteAttribute('uv');
  parts.push(cap.toNonIndexed());
  cap.dispose();
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return g;
}

/** naive polygon inset (for convex-ish wall shapes) */
function insetPolygon(pts: Vector2[], d: number): Vector2[] {
  const n = pts.length;
  const out: Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const e0 = p1.clone().sub(p0).normalize(), e1 = p2.clone().sub(p1).normalize();
    const n0 = new Vector2(-e0.y, e0.x), n1 = new Vector2(-e1.y, e1.x);
    const bis = n0.add(n1).normalize();
    out.push(p1.clone().addScaledVector(bis, d));
  }
  return out;
}

