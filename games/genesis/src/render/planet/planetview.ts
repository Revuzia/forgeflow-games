// GENESIS — one planet's render objects: the body-frame Group, field textures, chunk LOD with terrain / water / depth
// materials per level, the atmosphere model + LUTs, and the cloud-coverage cube. The Renderer owns one per PlanetView.

import { Group, Matrix3, Matrix4, Quaternion, Vector3, type Frustum, type IUniform, type MeshStandardMaterial, type ShaderMaterial } from 'three';
import type { PlanetView } from '../../client/worldview.ts';
import { AtmosphereModel } from '../sky/atmosphere.ts';
import type { CloudPass } from '../sky/clouds.ts';
import type { SunShadows } from './lights.ts';
import { FieldTextures } from './fieldtex.ts';
import { ChunkLOD } from './chunks.ts';
import { DirFieldCube } from './dirtex.ts';
import { kindCode, makePlanetUniforms, makeTerrainDepthMaterial, makeTerrainMaterial, paletteFor, type PlanetShaderUniforms } from './terrainmat.ts';
import { makeOceanMaterial } from './ocean.ts';
import { Vegetation } from '../life/vegetation.ts';
import { GroundCover } from '../life/groundcover.ts';

export interface PlanetVisualDeps {
  clouds: CloudPass;
  shadows: SunShadows;
  waterScene: Record<string, IUniform>;
}

export interface PlanetFrameContext {
  camWorldInverse: Matrix4;
  frustum: Frustum;
  /** camera position relative to the planet centre, system axes (m) */
  camRel: Vector3;
  sunDirWorld: Vector3;
  sunE: Vector3;
  time: number;
  K: number;
  frame: number;
  budget: number;
  primary: boolean;
  /** vegetation range (m) and density multiplier from the quality preset */
  vegRange: number;
  vegDensity: number;
  shadows: boolean;
  yearFrac: number;
  /** the camera's projection matrix (water SSR reprojection) */
  proj: Matrix4;
  /** near-camera grass and stones (quality) */
  grass: boolean;
}

const _m4 = new Matrix4();
const _m4b = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();

export class PlanetVisual {
  readonly id: number;
  readonly group = new Group();
  readonly fields: FieldTextures;
  readonly lod: ChunkLOD;
  readonly atmo = new AtmosphereModel();
  readonly uniforms: PlanetShaderUniforms;
  readonly terrainMats: MeshStandardMaterial[] = [];
  readonly depthMats: ShaderMaterial[] = [];
  readonly waterMats: ShaderMaterial[] = [];
  cloudCube: DirFieldCube | null = null;
  /** last frame's body → clip transform (water SSR reprojection) */
  private readonly prevBodyToClip = new Matrix4();
  hasClouds = false;
  cloudInner = 0;
  cloudOuter = 0;
  pv: PlanetView;
  private cloudStamp = '';
  private kind = '';
  readonly vegetation: Vegetation;
  readonly groundCover: GroundCover;
  /** camera position in the body frame (m) — updated per frame */
  readonly camBody = new Vector3();
  altitude = 1e9;

  constructor(pv: PlanetView, deps: PlanetVisualDeps) {
    this.id = pv.id;
    this.pv = pv;
    this.group.name = `planet-${pv.id}`;
    this.group.matrixAutoUpdate = true;
    this.fields = new FieldTextures(pv);
    this.uniforms = makePlanetUniforms();
    const u = this.uniforms;
    u.uFieldA.value = this.fields.tex.A; u.uFieldN.value = this.fields.tex.N; u.uFieldM0.value = this.fields.tex.M0;
    u.uFieldM1.value = this.fields.tex.M1; u.uFieldV.value = this.fields.tex.V; u.uFieldC.value = this.fields.tex.C;
    u.uFieldS.value = this.fields.tex.S; u.uFieldF.value = this.fields.tex.F; u.uFieldG.value = this.fields.tex.G;
    u.uFieldD.value = this.fields.tex.D;
    // atmosphere, cloud and shadow uniforms are shared by reference
    const atmoU = this.atmo.uniforms as unknown as Record<string, IUniform>;
    for (const k of Object.keys(atmoU)) u[k] = atmoU[k];
    for (const [k, v] of Object.entries(deps.clouds.shared)) u[k] = v as IUniform;
    for (const [k, v] of Object.entries(deps.shadows.uniforms)) u[k] = v as IUniform;
    // a private copy of the shadow switch: only the primary planet samples the cascades
    u.uShadowOn = { value: 0 };
    const sharedRec = u as Record<string, IUniform>;
    const mats = {
      terrain: (level: number) => this.terrainMat(level, sharedRec, deps),
      water: (level: number) => { this.terrainMat(level, sharedRec, deps); return this.waterMats[level]; },
    };
    const self = this;
    this.lod = new ChunkLOD(pv.grid, pv.noise, pv.params.radius, this.group, mats, {
      get surface() { return self.pv.fields.get('surface') ?? null; },
      get grad() { return self.pv.ground.grad ?? null; },
      waterLevel: this.fields.waterLevel,
      waterDepth: this.fields.waterDepth,
      get geomVersion() { return self.fields.geomVersion; },
    });
    this.vegetation = new Vegetation(sharedRec);
    this.group.add(this.vegetation.group);
    this.groundCover = new GroundCover(sharedRec);
    this.group.add(this.groundCover.group);
    this.sync(pv);
  }

  private terrainMat(level: number, shared: Record<string, IUniform>, deps: PlanetVisualDeps): MeshStandardMaterial {
    while (this.terrainMats.length <= level) {
      const L = this.terrainMats.length;
      const m = makeTerrainMaterial(shared, L);
      this.terrainMats.push(m);
      this.depthMats.push(makeTerrainDepthMaterial(shared, m));
      this.waterMats.push(makeOceanMaterial(shared, m.userData.uMorph as IUniform, deps.waterScene));
    }
    return this.terrainMats[level];
  }

  /** pull new snapshot data: field textures, air, palette, cloud cover */
  sync(pv: PlanetView): void {
    this.pv = pv;
    this.fields.update();
    const p = pv.params;
    this.atmo.configure(p.radius, p.atmosphere, p.kind);
    const u = this.uniforms;
    u.uRadius.value = p.radius;
    u.uSeaLevel.value = p.seaLevel;
    // airless worlds get no sky fill at all (hard black shadows, CONTRACT §16.1); with air, a faint night airglow
    if (this.atmo.has) u.uNightAmbient.value.set(0.004, 0.006, 0.012);
    else u.uNightAmbient.value.set(0.0004, 0.0005, 0.0007);
    if (p.kind !== this.kind) {
      this.kind = p.kind;
      u.uKind.value = kindCode(p.kind);
      const pal = paletteFor(p.kind);
      u.uRockA.value.copy(pal.rockA); u.uRockB.value.copy(pal.rockB); u.uSandCol.value.copy(pal.sand); u.uRegolith.value.copy(pal.regolith);
    }
    // clouds exist where there is air and a cloud field with anything in it
    const thick = this.atmo.thickness;
    this.cloudInner = p.radius + thick * 0.3;
    this.cloudOuter = p.radius + thick * 0.7;
    (u.uCloudShell.value as { x: number; y: number }).x = this.cloudInner;
    (u.uCloudShell.value as { x: number; y: number }).y = this.cloudOuter;
    const cloud = pv.fields.get('cloud') ?? null;
    const stamp = `${pv.fieldVersion.get('cloud') ?? 0}|${pv.fieldVersion.get('precip') ?? 0}|${p.cloudiness}`;
    if (this.atmo.has && cloud && stamp !== this.cloudStamp) {
      this.cloudStamp = stamp;
      if (!this.cloudCube) this.cloudCube = new DirFieldCube(pv.grid, 96);
      const precip = pv.fields.get('precip') ?? null;
      // R: coverage (+ global cloudiness bias), G: storm strength from precipitation (mm/h)
      const bias = (p.cloudiness - 0.5) * 0.3;
      this.cloudCube.update([cloud, precip, null, null], [1, 1 / 8, 1, 1], [bias, 0, 0, 0]);
      let any = false;
      for (let i = 0; i < cloud.length; i += 7) if (cloud[i] > 0.05) { any = true; break; }
      this.hasClouds = any || p.cloudiness > 0.6;
      u.uCloudCov.value = this.cloudCube.texture;
    }
    if (!this.atmo.has) this.hasClouds = false;
    u.uCloudOn.value = this.hasClouds ? 1 : 0;
  }

  /** place the group, update per-frame uniforms, select LOD patches */
  frameUpdate(ctx: PlanetFrameContext): void {
    const pv = this.pv;
    const g = this.group;
    g.quaternion.set(pv.quat[0], pv.quat[1], pv.quat[2], pv.quat[3]);
    g.position.set(-ctx.camRel.x, -ctx.camRel.y, -ctx.camRel.z);
    g.updateMatrixWorld(true);
    _q.copy(g.quaternion).invert();
    this.camBody.copy(ctx.camRel).applyQuaternion(_q);
    this.altitude = this.camBody.length() - pv.params.radius - Math.max(0, pv.params.seaLevel);
    const u = this.uniforms;
    u.uCamBody.value.copy(this.camBody);
    _v.copy(ctx.sunDirWorld).applyQuaternion(_q);
    u.uSunDirBody.value.copy(_v);
    // view-space sun and body → view rotation
    _m4.multiplyMatrices(ctx.camWorldInverse, g.matrixWorld);
    (u.uBodyToView.value as Matrix3).setFromMatrix4(_m4);
    // SSR reprojection: view → body (inverse of this frame's body → view) → last frame's clip; then remember this
    // frame's body → clip for the next one
    (u.uViewToPrevClip.value as Matrix4).copy(this.prevBodyToClip).multiply(_m4b.copy(_m4).invert());
    this.prevBodyToClip.multiplyMatrices(ctx.proj, _m4);
    u.uSunDirView.value.copy(ctx.sunDirWorld).transformDirection(ctx.camWorldInverse);
    this.atmo.setSun(ctx.sunE.x, ctx.sunE.y, ctx.sunE.z);
    u.uTime.value = ctx.time % 3600;
    u.uYearFrac.value = ctx.yearFrac;
    u.uShadowOn.value = ctx.primary && ctx.shadows ? 1 : 0;
    // LOD
    this.lod.setShadowCasting(ctx.primary && ctx.shadows);
    this.lod.select({
      camBody: this.camBody, frustum: ctx.frustum, bodyToWorld: g.matrixWorld, K: ctx.K, frame: ctx.frame, buildBudget: ctx.budget,
    });
    // trees near the camera (primary planet only)
    const veg = this.vegetation;
    veg.range = ctx.vegRange;
    veg.density = ctx.vegDensity;
    veg.enabled = ctx.primary && ctx.vegRange > 0;
    veg.setShadowCasting(ctx.primary && ctx.shadows);
    veg.yearFrac = ctx.yearFrac;
    veg.update(pv, this.camBody, ctx.frame);
    this.groundCover.enabled = ctx.primary && ctx.grass;
    this.groundCover.update(pv, this.camBody, ctx.frame);
    (u.uVegFade.value as { x: number; y: number }).x = veg.group.visible ? veg.fade.value.x : 1e9;
    (u.uVegFade.value as { x: number; y: number }).y = veg.group.visible ? veg.fade.value.y : 1e9 + 1;
    for (let L = 0; L < this.terrainMats.length; L++) {
      const [full, start] = this.lod.morphRange(L, ctx.K);
      const m = this.terrainMats[L].userData.uMorph as IUniform<{ set(x: number, y: number, z: number, w: number): void }>;
      m.value.set(full, start, this.lod.skirtDepth(L), this.lod.silK);
    }
  }

  /** swap the visible casters to / from their depth materials (shadow pass) */
  swapDepth(depth: boolean): void {
    this.vegetation.swapDepth(depth);
    for (const p of this.lod.selected) {
      if (!p.mesh) continue;
      p.mesh.material = depth ? this.depthMats[p.level] : this.terrainMats[p.level];
    }
  }

  dispose(): void {
    this.lod.dispose();
    this.vegetation.dispose();
    this.groundCover.dispose();
    this.fields.dispose();
    this.atmo.dispose();
    this.cloudCube?.dispose();
    for (const m of [...this.terrainMats, ...this.depthMats, ...this.waterMats]) m.dispose();
  }
}
