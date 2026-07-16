import * as THREE from 'three';
import { MAPS } from '../core/config';
import type { MapDef, MapId } from '../core/types';
import { CityGenerator } from './CityGenerator';
import { PortalSystem, type PortalDef } from './Portals';
import { BiomeAtmosphere, type HazardHit } from './BiomeAtmosphere';

export class ArenaMap {
  def: MapDef;
  city = new CityGenerator();
  portals = new PortalSystem();
  atmosphere: BiomeAtmosphere;
  private scene: THREE.Scene;
  private hemi: THREE.HemisphereLight | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private ambient: THREE.AmbientLight | null = null;

  constructor(scene: THREE.Scene, mapId: MapId = 'sky-city') {
    this.scene = scene;
    this.def = MAPS[mapId];
    this.atmosphere = new BiomeAtmosphere(scene);
  }

  load(mapId: MapId) {
    this.def = MAPS[mapId];
    this.clearLights();
    this.city.clear();
    this.portals.clear();
    this.atmosphere.clear();
    if (this.city.group.parent) this.scene.remove(this.city.group);
    if (this.portals.group.parent) this.scene.remove(this.portals.group);

    // Flat color under dome (atmosphere adds real sky sphere)
    this.scene.background = new THREE.Color(this.def.skyTop);
    this.scene.fog = new THREE.FogExp2(this.def.fogColor, this.def.fogDensity);

    this.hemi = new THREE.HemisphereLight(this.def.skyTop, this.def.skyBottom, 0.65);
    this.ambient = new THREE.AmbientLight(this.def.ambient, 0.7);
    this.sun = new THREE.DirectionalLight(this.def.sunColor, this.def.sunIntensity);
    this.sun.position.set(-80, 60, -100);
    this.scene.add(this.hemi, this.ambient, this.sun);

    this.atmosphere.build(this.def);
    this.city.build(this.def);
    this.scene.add(this.city.group);

    this.portals.buildForMap(mapId, this.def.bounds);
    this.scene.add(this.portals.group);
  }

  update(dt: number, playerPositions: Array<{ pos: THREE.Vector3; id: string }>): HazardHit[] {
    this.portals.update(dt);
    return this.atmosphere.update(dt, playerPositions);
  }

  checkPortal(pos: THREE.Vector3): PortalDef | null {
    return this.portals.checkEnter(pos);
  }

  getSpawn(index: number): THREE.Vector3 {
    const pts = this.def.spawnPoints;
    const p = pts[index % pts.length];
    return new THREE.Vector3(p[0], p[1], p[2]);
  }

  randomSpawn(): THREE.Vector3 {
    const i = Math.floor(Math.random() * this.def.spawnPoints.length);
    const base = this.getSpawn(i);
    base.x += (Math.random() - 0.5) * 8;
    base.z += (Math.random() - 0.5) * 8;
    return base;
  }

  private clearLights() {
    for (const l of [this.hemi, this.sun, this.ambient]) {
      if (l) this.scene.remove(l);
    }
    this.hemi = this.sun = this.ambient = null;
  }

  dispose() {
    this.clearLights();
    this.city.clear();
    this.portals.clear();
    this.atmosphere.clear();
    this.scene.remove(this.city.group);
    this.scene.remove(this.portals.group);
  }
}
