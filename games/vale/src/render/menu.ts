// VALE render — the menu world (STYLE_BIBLE "Menu mood": one live 3D scene, the Rim at the Split
// Hour; every screen is a camera position in it).
//
//   * client.menuScene.model (GLB) when the art exists; its empties `cam_<station>` / `tgt_<station>`
//     are the camera stations (position / look-at). Until then a backdrop is built from the first
//     team map's procedural terrain under the menu sky, with stations generated around it.
//   * sky: client.menuScene.sky → PMREM env + background; grade: client.menuScene.lut.
//   * light: tokens `grade.maps.menu` — low warm sun from the left (18°), whose shadow edge creeps 1° a
//     minute; environment 0.8.
//   * setStation(name): 720 ms camera move with the `dawn` ease (0.16, 1, 0.3, 1); reduced motion cuts.
//   * a fighter can stand on the station's plinth (setShowcase) playing `idle_lobby`.
//   * budget: the renderer caps the menu at 30 fps after 4 s without a station change.

import { Color, Group, type Object3D, PerspectiveCamera, Scene, Vector3 } from 'three';
import type { CatalogT, MapDefT } from '../contracts/catalog.ts';
import { Actor, type ModelLibrary } from './actors.ts';
import type { Assets } from './assets.ts';
import { Sun } from './lighting.ts';
import { Sky } from './sky.ts';
import { buildTerrain, TERRAIN_TEX_ROLES, type TerrainBuild, type TerrainTexRole } from './terrain.ts';
import { patchWorldMaterial } from './world_material.ts';

/** tokens.json grade.maps.menu (design tokens, not content) */
const MENU_SUN = { dir: [-0.8937, 0.309, 0.3253] as [number, number, number], color: '#FFC27E', intensity: 2.4, env: 0.8 };
const MOVE_MS = 720;

function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number): number => ((ay * t + by) * t + cy) * t;
  return (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) { const dx = sx(t) - x; const d = (3 * ax * t + 2 * bx) * t + cx; if (Math.abs(dx) < 1e-5 || Math.abs(d) < 1e-6) break; t -= dx / d; }
    return sy(Math.max(0, Math.min(1, t)));
  };
}
const DAWN = bezier(0.16, 1, 0.3, 1);

interface Station { pos: Vector3; target: Vector3 }

export class MenuWorld {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(32, 16 / 9, 0.5, 3000);
  readonly sun = new Sun();
  private readonly sky: Sky;
  private terrain: TerrainBuild | null = null;
  private model: Object3D | null = null;
  private readonly stations = new Map<string, Station>();
  private readonly from = { pos: new Vector3(), target: new Vector3() };
  private readonly to = { pos: new Vector3(), target: new Vector3() };
  private readonly target = new Vector3();
  private moveT = 1;
  private elapsed = 0;
  station = 'home';
  reduceMotion = false;
  /** seconds since the last station change (the renderer's idle cap) */
  idle = 0;
  private showcase: Actor | null = null;
  private showcaseKey = '';
  private readonly showcaseRoot = new Group();
  private map: MapDefT | null = null;
  lut: string | null = null;
  private built = false;

  constructor(renderer: import('three').WebGLRenderer) {
    this.sky = new Sky(renderer);
    this.scene.add(this.sun.light, this.sun.target, this.showcaseRoot);
    this.scene.name = 'vale_menu';
  }

  /** build once (async parts resolve later); never throws */
  build(catalog: CatalogT, assets: Assets): void {
    if (this.built) return;
    this.built = true;
    const ms = catalog.client.menuScene;
    this.lut = ms.lut;
    this.sun.configure({ sunDir: MENU_SUN.dir, sunColor: MENU_SUN.color, sunIntensity: MENU_SUN.intensity });
    const sc = new Color().setStyle(MENU_SUN.color);
    this.sky.makeFallback(MENU_SUN.dir, sc, new Color(0.18, 0.26, 0.42), new Color(0.75, 0.62, 0.5));
    this.sky.apply(this.scene, null, MENU_SUN.env);
    assets.hdr(ms.sky).then((t) => { if (t) this.sky.apply(this.scene, t, MENU_SUN.env); });
    // backdrop: a team map's terrain (procedural), replaced by the menu GLB when it exists
    const map = catalog.maps.find((m) => m.lanes.length >= 3) ?? catalog.maps.find((m) => m.lanes.length > 0) ?? catalog.maps[0];
    this.map = map ?? null;
    if (map) {
      this.terrain = buildTerrain(map);
      const refs = ((map.art.terrain ?? {}) as { textures?: Record<string, string> }).textures ?? {};
      const roles = TERRAIN_TEX_ROLES.filter((r) => typeof refs[r] === 'string');
      const terrain = this.terrain;
      void Promise.all(roles.map((r) => assets.texture(refs[r]).then((t) => [r, t] as const))).then((pairs) => {
        const set: Partial<Record<TerrainTexRole, import('three').Texture>> = {};
        for (const [r, t] of pairs) if (t) set[r] = t;
        terrain.setTextures(set);
      });
      this.scene.add(this.terrain.group);
      this.generateStations(map);
    }
    assets.model(ms.model).then((m) => {
      if (!m?.renderable) return;
      const root = m.gltf.scene;
      root.traverse((o) => {
        const mesh = o as import('three').Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true; mesh.receiveShadow = true;
          for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) patchWorldMaterial(mat, { fog: false });
        }
      });
      const found = new Map<string, Partial<Station>>();
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        const n = o.name;
        const m2 = /^(cam|tgt)_(.+)$/.exec(n);
        if (!m2) return;
        const st = found.get(m2[2]) ?? {};
        const p = new Vector3().setFromMatrixPosition(o.matrixWorld);
        if (m2[1] === 'cam') st.pos = p; else st.target = p;
        found.set(m2[2], st);
      });
      if (this.terrain) { this.scene.remove(this.terrain.group); this.terrain.dispose(); this.terrain = null; }
      this.model = root;
      this.scene.add(root);
      if (found.size) {
        this.stations.clear();
        for (const [k, v] of found) if (v.pos && v.target) this.stations.set(k, { pos: v.pos, target: v.target });
      }
      this.setStation(this.station, true);
    });
    this.setStation(this.station, true);
  }

  private generateStations(map: MapDefT): void {
    const [SX, SY] = map.size;
    const cx = SX / 2, cy = SY / 2;
    // a terrace on the rim looking across the dial; screens orbit clockwise (forward = clockwise)
    const names = ['home', 'play', 'queue', 'lobby', 'draft', 'loadout', 'loading', 'postgame', 'collection', 'shop', 'profile', 'settings', 'practice', 'custom'];
    names.forEach((n, i) => {
      const a = -Math.PI * 0.62 + (i / names.length) * Math.PI * 0.9;
      const r = Math.max(SX, SY) * 0.5 + 6;
      const pos = new Vector3(cx + Math.cos(a) * r * 0.62, 7 + (i % 3) * 1.2, cy + Math.sin(a) * r * 0.62 + SY * 0.42);
      const target = new Vector3(cx + Math.cos(a) * r * 0.05, 1.5, cy - SY * 0.05);
      this.stations.set(n, { pos, target });
    });
  }

  private stationOf(name: string): Station | null {
    const s = this.stations.get(name) ?? this.stations.get('home') ?? this.stations.values().next().value ?? null;
    if (s) return s;
    if (!this.map) return null;
    return { pos: new Vector3(this.map.size[0] / 2, 12, this.map.size[1] + 10), target: new Vector3(this.map.size[0] / 2, 0, this.map.size[1] / 2) };
  }

  setStation(name: string, cut = false): void {
    this.station = name;
    this.idle = 0;
    const s = this.stationOf(name);
    if (!s) return;
    this.from.pos.copy(this.camera.position);
    this.from.target.copy(this.target);
    this.to.pos.copy(s.pos);
    this.to.target.copy(s.target);
    if (cut || this.reduceMotion || this.camera.position.lengthSq() === 0) {
      this.camera.position.copy(s.pos); this.target.copy(s.target); this.moveT = 1;
      this.camera.lookAt(this.target);
    } else this.moveT = 0;
  }

  /** a fighter on the plinth (null clears) */
  setShowcase(lib: ModelLibrary | null, fighter: string | null, skin: string | null): void {
    const key = `${fighter ?? ''}:${skin ?? ''}`;
    if (key === this.showcaseKey) return;
    this.showcaseKey = key;
    if (this.showcase) { this.showcase.dispose(); this.showcase = null; }
    if (!lib || !fighter) return;
    const def = lib.fighter(fighter);
    if (!def) return;
    const a = new Actor({ id: -1, kind: 'fighter', def: fighter, team: 0, owner: -1, x: 0, y: 0, facing: Math.PI / 2, radius: 0.5, height: 0 } as unknown as import('../contracts/sim.ts').EntityView);
    a.configureFighter(def);
    this.showcase = a;
    this.showcaseRoot.add(a.root);
    lib.fighterTemplate(fighter, skin ?? undefined).then((t) => { if (this.showcase === a) a.attach(t, def.art.scale, def.art.accentMaterial); });
  }

  setAspect(aspect: number): void { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  update(dt: number): void {
    this.elapsed += dt;
    this.idle += dt;
    if (this.moveT < 1) {
      this.moveT = Math.min(1, this.moveT + (dt * 1000) / MOVE_MS);
      const k = DAWN(this.moveT);
      this.camera.position.lerpVectors(this.from.pos, this.to.pos, k);
      this.target.lerpVectors(this.from.target, this.to.target, k);
      this.idle = 0;
    }
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    // the shadow edge creeps 1° a minute
    const a = (this.elapsed / 60) * (Math.PI / 180);
    const [x, y, z] = MENU_SUN.dir;
    const c = Math.cos(a), s = Math.sin(a);
    this.sun.configure({ sunDir: [x * c - z * s, y, x * s + z * c], sunColor: MENU_SUN.color, sunIntensity: MENU_SUN.intensity });
    this.sun.fit(this.camera);
    this.terrain?.update(this.elapsed);
    if (this.showcase) {
      // stand on the plinth in front of the station's look-at point, facing the camera
      const t = this.target;
      const toCam = new Vector3().subVectors(this.camera.position, t).setY(0).normalize();
      this.showcase.root.position.set(t.x + toCam.x * 2, 0, t.z + toCam.z * 2);
      this.showcase.root.rotation.y = Math.atan2(toCam.x, toCam.z);
      this.showcase.pose('idle_lobby', dt);
    }
  }

  setScatter(level: 0 | 1 | 2): void { this.terrain?.setScatter(level); }

  dispose(): void {
    this.showcase?.dispose();
    this.terrain?.dispose();
    this.sky.dispose();
  }
}
