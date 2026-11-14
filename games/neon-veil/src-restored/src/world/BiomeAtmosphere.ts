import * as THREE from 'three';
import type { MapDef, MapId } from '../core/types';

export interface HazardHit {
  kind: 'lightning' | 'meteor';
  position: THREE.Vector3;
  damage: number;
  stun: number;
}

interface Meteor {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  alive: boolean;
  life: number;
  radius: number;
}

/**
 * Per-biome sky, weather, and environmental hazards.
 * - Proper sky domes / planet limbs (not empty void)
 * - Sky City: rare lightning that can lightly hit ships
 * - Deep Space: moving meteors with solid collision
 */
export class BiomeAtmosphere {
  group = new THREE.Group();
  private scene: THREE.Scene;
  private mapId: MapId = 'sky-city';
  private sky: THREE.Mesh | null = null;
  private planet: THREE.Mesh | null = null;
  private flashLight: THREE.PointLight | null = null;
  private stormTimer = 0;
  private nextStorm = 18;
  private rain: THREE.Points | null = null;
  private rainVel: Float32Array | null = null;
  private meteors: Meteor[] = [];
  private meteorSpawn = 0;
  private satellites: THREE.Group | null = null;
  private satAngle = 0;
  private aurora: THREE.Mesh | null = null;
  private time = 0;
  private tmp = new THREE.Vector3();
  private hazards: HazardHit[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  build(def: MapDef) {
    this.clear();
    this.mapId = def.id;
    this.time = 0;
    this.stormTimer = 0;
    this.nextStorm = 12 + Math.random() * 20;
    this.meteorSpawn = 0;

    // Always add a full sky dome so no biome is a flat void
    this.sky = makeSkyDome(def.skyTop, def.skyBottom, def.bounds * 2.8);
    this.group.add(this.sky);

    switch (def.style) {
      case 'open':
        this.buildSkyCityWeather(def);
        break;
      case 'clouds':
        this.buildCloudWeather(def);
        break;
      case 'atmo':
        this.buildAtmoSky(def);
        break;
      case 'space':
        this.buildSpaceHazards(def);
        break;
      case 'pit':
        this.buildPitAmbience(def);
        break;
      default:
        break;
    }

    this.scene.add(this.group);
  }

  private buildSkyCityWeather(def: MapDef) {
    // Storm flash light
    this.flashLight = new THREE.PointLight(0xaaccff, 0, def.bounds * 2, 2);
    this.flashLight.position.set(0, 180, 0);
    this.group.add(this.flashLight);

    // Sparse rain streaks (points)
    const count = 900;
    const pos = new Float32Array(count * 3);
    this.rainVel = new Float32Array(count);
    const b = def.bounds;
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * b * 2;
      pos[i * 3 + 1] = Math.random() * 160 + 20;
      pos[i * 3 + 2] = (Math.random() - 0.5) * b * 2;
      this.rainVel[i] = 40 + Math.random() * 55;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0x88aaff,
        size: 0.55,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        fog: false,
      })
    );
    this.rain.visible = false; // only during storms
    this.group.add(this.rain);

    // Distant heat lightning clouds
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const cloud = new THREE.Mesh(
        new THREE.SphereGeometry(1, 8, 6),
        new THREE.MeshBasicMaterial({
          color: 0x2a1040,
          transparent: true,
          opacity: 0.35,
          fog: false,
          depthWrite: false,
        })
      );
      cloud.scale.set(50 + Math.random() * 40, 12 + Math.random() * 10, 40 + Math.random() * 30);
      cloud.position.set(Math.cos(a) * def.bounds * 0.95, 90 + Math.random() * 40, Math.sin(a) * def.bounds * 0.95);
      this.group.add(cloud);
    }
  }

  private buildCloudWeather(def: MapDef) {
    // Soft sun disc through haze
    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(55, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffe8aa,
        fog: false,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      })
    );
    sun.position.set(-120, 80, -def.bounds * 0.85);
    this.group.add(sun);

    // Horizon fog bank
    const bank = new THREE.Mesh(
      new THREE.CylinderGeometry(def.bounds * 1.15, def.bounds * 1.2, 35, 48, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xb8d4f0,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        fog: false,
        depthWrite: false,
      })
    );
    bank.position.y = 15;
    this.group.add(bank);

    // Light volumetric shafts (simple cones)
    for (let i = 0; i < 5; i++) {
      const shaft = new THREE.Mesh(
        new THREE.ConeGeometry(18, 90, 8, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xfff0c8,
          transparent: true,
          opacity: 0.06,
          side: THREE.DoubleSide,
          depthWrite: false,
          fog: false,
        })
      );
      const a = (i / 5) * Math.PI * 2;
      shaft.position.set(Math.cos(a) * 80, 70, Math.sin(a) * 80);
      shaft.rotation.x = Math.PI;
      this.group.add(shaft);
    }
  }

  private buildAtmoSky(def: MapDef) {
    // Planet limb below — reads as upper atmosphere, not empty void
    this.planet = new THREE.Mesh(
      new THREE.SphereGeometry(def.bounds * 1.4, 48, 32),
      new THREE.MeshStandardMaterial({
        color: 0x1a3060,
        emissive: 0x0a1840,
        emissiveIntensity: 0.4,
        metalness: 0.1,
        roughness: 0.9,
        fog: false,
      })
    );
    this.planet.position.set(0, -def.bounds * 1.55, 0);
    this.group.add(this.planet);

    // Atmosphere glow shell
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(def.bounds * 1.42, 48, 24),
      new THREE.MeshBasicMaterial({
        color: 0x4488ff,
        transparent: true,
        opacity: 0.12,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
      })
    );
    glow.position.copy(this.planet.position);
    this.group.add(glow);

    // Thin cloud layer on planet
    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(def.bounds * 1.405, 32, 24),
      new THREE.MeshBasicMaterial({
        color: 0xaaccff,
        transparent: true,
        opacity: 0.15,
        fog: false,
        depthWrite: false,
      })
    );
    clouds.position.copy(this.planet.position);
    this.group.add(clouds);

    // Aurora ribbon
    this.aurora = new THREE.Mesh(
      new THREE.TorusGeometry(def.bounds * 0.55, 8, 8, 64),
      new THREE.MeshBasicMaterial({
        color: 0x44ffaa,
        transparent: true,
        opacity: 0.22,
        fog: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.aurora.rotation.x = Math.PI * 0.4;
    this.aurora.position.y = 40;
    this.group.add(this.aurora);

    // Sun
    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(40, 28),
      new THREE.MeshBasicMaterial({ color: 0xfff0dd, fog: false, side: THREE.DoubleSide })
    );
    sun.position.set(-200, 120, -def.bounds);
    this.group.add(sun);
  }

  private buildSpaceHazards(def: MapDef) {
    // Multi-nebula plates
    const colors = [0xaa2288, 0x2244aa, 0x6622aa, 0x228866];
    for (let i = 0; i < 4; i++) {
      const neb = new THREE.Mesh(
        new THREE.CircleGeometry(def.bounds * (0.5 + Math.random() * 0.4), 28),
        new THREE.MeshBasicMaterial({
          color: colors[i],
          transparent: true,
          opacity: 0.12 + Math.random() * 0.08,
          fog: false,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      const a = (i / 4) * Math.PI * 2;
      neb.position.set(Math.cos(a) * def.bounds * 1.2, (Math.random() - 0.5) * 80, Math.sin(a) * def.bounds * 1.2);
      neb.lookAt(0, 0, 0);
      this.group.add(neb);
    }

    // Orbiting satellites / stations
    this.satellites = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const sat = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(3, 1.2, 1.2),
        new THREE.MeshStandardMaterial({ color: 0x8899aa, metalness: 0.8, roughness: 0.3, emissive: 0x112233, emissiveIntensity: 0.4 })
      );
      sat.add(body);
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(8, 0.08, 2.2),
        new THREE.MeshBasicMaterial({ color: 0x2244aa, toneMapped: false })
      );
      panel.position.y = 0.2;
      sat.add(panel);
      const a = (i / 8) * Math.PI * 2;
      const r = 90 + (i % 3) * 40;
      sat.position.set(Math.cos(a) * r, -20 + (i % 4) * 25, Math.sin(a) * r);
      sat.userData.orbitR = r;
      sat.userData.orbitA = a;
      sat.userData.orbitY = sat.position.y;
      this.satellites.add(sat);
    }
    this.group.add(this.satellites);

    // Meteor pool
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x886655,
      emissive: 0xff4400,
      emissiveIntensity: 0.35,
      roughness: 0.9,
      metalness: 0.15,
    });
    for (let i = 0; i < 24; i++) {
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.visible = false;
      this.group.add(mesh);
      this.meteors.push({
        mesh,
        vel: new THREE.Vector3(),
        alive: false,
        life: 0,
        radius: 2,
      });
    }
  }

  private buildPitAmbience(def: MapDef) {
    // Smoky ceiling dome
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(def.bounds * 1.1, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.45),
      new THREE.MeshBasicMaterial({
        color: 0x1a0820,
        transparent: true,
        opacity: 0.55,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
      })
    );
    dome.position.y = 20;
    this.group.add(dome);

    // Ember particles
    const count = 200;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * def.bounds * 0.7;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = 5 + Math.random() * 80;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xff6622, size: 0.8, transparent: true, opacity: 0.5, depthWrite: false })
    );
    this.group.add(this.rain);
  }

  /**
   * Advance weather / hazards. Returns hazard hits this frame (for Game to apply).
   * @param players positions to test for rare lightning / meteor hits
   */
  update(dt: number, players: Array<{ pos: THREE.Vector3; id: string }>): HazardHit[] {
    this.time += dt;
    this.hazards = [];

    if (this.sky) {
      // Slow sky drift
      this.sky.rotation.y = this.time * 0.008;
    }

    if (this.mapId === 'sky-city') this.updateStorm(dt, players);
    if (this.mapId === 'cloud-sea' && this.sky) {
      // Brightness pulse in clouds
      const m = this.sky.material as THREE.MeshBasicMaterial;
      if (m.map) {
        /* texture static */
      }
    }
    if (this.mapId === 'upper-atmo') {
      if (this.planet) this.planet.rotation.y = this.time * 0.02;
      if (this.aurora) {
        this.aurora.rotation.z = this.time * 0.15;
        (this.aurora.material as THREE.MeshBasicMaterial).opacity = 0.15 + Math.sin(this.time * 1.2) * 0.08;
      }
    }
    if (this.mapId === 'deep-space') this.updateSpace(dt, players);
    if (this.mapId === 'the-pit' && this.rain) {
      const arr = this.rain.geometry.attributes.position.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1] += dt * (8 + (i % 5));
        if (arr[i + 1] > 90) arr[i + 1] = 5;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }

    return this.hazards;
  }

  private updateStorm(dt: number, players: Array<{ pos: THREE.Vector3; id: string }>) {
    this.stormTimer += dt;
    if (this.stormTimer >= this.nextStorm) {
      this.stormTimer = 0;
      this.nextStorm = 14 + Math.random() * 28;
      this.flashLightning(players);
    }

    // Rain only after a recent flash
    if (this.rain && this.flashLight) {
      const raining = this.flashLight.intensity > 0.5 || this.stormTimer < 4;
      this.rain.visible = raining;
      if (raining && this.rainVel) {
        const arr = this.rain.geometry.attributes.position.array as Float32Array;
        const n = this.rainVel.length;
        for (let i = 0; i < n; i++) {
          arr[i * 3 + 1] -= this.rainVel[i] * dt;
          if (arr[i * 3 + 1] < 0) {
            arr[i * 3 + 1] = 140 + Math.random() * 40;
            arr[i * 3] = (Math.random() - 0.5) * 800;
            arr[i * 3 + 2] = (Math.random() - 0.5) * 800;
          }
        }
        this.rain.geometry.attributes.position.needsUpdate = true;
      }
    }

    if (this.flashLight && this.flashLight.intensity > 0) {
      this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 25);
    }
  }

  private flashLightning(players: Array<{ pos: THREE.Vector3; id: string }>) {
    // Visual flash
    if (this.flashLight) {
      this.flashLight.intensity = 40;
      this.flashLight.position.set(
        (Math.random() - 0.5) * 200,
        100 + Math.random() * 80,
        (Math.random() - 0.5) * 200
      );
    }
    // Bolt mesh (brief)
    const bolt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.15, 80, 4),
      new THREE.MeshBasicMaterial({ color: 0xddeeff, toneMapped: false, transparent: true, opacity: 0.95 })
    );
    const bx = (Math.random() - 0.5) * 180;
    const bz = (Math.random() - 0.5) * 180;
    bolt.position.set(bx, 70, bz);
    this.group.add(bolt);
    window.setTimeout(() => {
      this.group.remove(bolt);
      bolt.geometry.dispose();
      (bolt.material as THREE.Material).dispose();
    }, 120);

    // Rare ship strike (~12% of storms, pick one nearby ship)
    if (Math.random() < 0.12 && players.length) {
      const victim = players[Math.floor(Math.random() * players.length)];
      // Move bolt toward victim for drama
      bolt.position.set(victim.pos.x, victim.pos.y + 40, victim.pos.z);
      if (this.flashLight) this.flashLight.position.copy(victim.pos).y += 30;
      this.hazards.push({
        kind: 'lightning',
        position: victim.pos.clone(),
        damage: 8 + Math.random() * 10,
        stun: 0.55 + Math.random() * 0.35,
      });
    }
  }

  private updateSpace(dt: number, players: Array<{ pos: THREE.Vector3; id: string }>) {
    // Orbit satellites
    if (this.satellites) {
      this.satAngle += dt * 0.12;
      for (const sat of this.satellites.children) {
        const r = sat.userData.orbitR as number;
        const a0 = sat.userData.orbitA as number;
        const y = sat.userData.orbitY as number;
        const a = a0 + this.satAngle;
        sat.position.set(Math.cos(a) * r, y + Math.sin(this.time + a0) * 4, Math.sin(a) * r);
        sat.lookAt(0, y, 0);
      }
    }

    // Spawn meteors
    this.meteorSpawn -= dt;
    if (this.meteorSpawn <= 0) {
      this.meteorSpawn = 0.8 + Math.random() * 1.8;
      this.spawnMeteor();
    }

    for (const m of this.meteors) {
      if (!m.alive) continue;
      m.life -= dt;
      m.mesh.position.addScaledVector(m.vel, dt);
      m.mesh.rotation.x += dt * 2;
      m.mesh.rotation.y += dt * 1.5;
      if (m.life <= 0) {
        m.alive = false;
        m.mesh.visible = false;
        continue;
      }
      // Hit players
      for (const p of players) {
        if (p.pos.distanceTo(m.mesh.position) < m.radius + 2.2) {
          this.hazards.push({
            kind: 'meteor',
            position: m.mesh.position.clone(),
            damage: 18 + Math.random() * 22,
            stun: 0.25,
          });
          m.alive = false;
          m.mesh.visible = false;
          break;
        }
      }
    }
  }

  private spawnMeteor() {
    const m = this.meteors.find((x) => !x.alive);
    if (!m) return;
    const a = Math.random() * Math.PI * 2;
    const r = 180 + Math.random() * 120;
    m.mesh.position.set(Math.cos(a) * r, 80 + Math.random() * 100, Math.sin(a) * r);
    // Aim toward arena center with scatter
    this.tmp.set((Math.random() - 0.5) * 60, -40 + (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 60);
    m.vel.copy(this.tmp).sub(m.mesh.position).normalize().multiplyScalar(45 + Math.random() * 50);
    const s = 1.5 + Math.random() * 4;
    m.mesh.scale.setScalar(s);
    m.radius = s * 1.1;
    m.life = 8;
    m.alive = true;
    m.mesh.visible = true;
  }

  /** Extra colliders for satellites (static-ish) — Game can query mesh positions. */
  getSolidSpheres(): Array<{ pos: THREE.Vector3; radius: number }> {
    const out: Array<{ pos: THREE.Vector3; radius: number }> = [];
    if (this.satellites) {
      for (const sat of this.satellites.children) {
        out.push({ pos: sat.position, radius: 4 });
      }
    }
    for (const m of this.meteors) {
      if (m.alive) out.push({ pos: m.mesh.position, radius: m.radius });
    }
    return out;
  }

  clear() {
    if (this.group.parent) this.scene.remove(this.group);
    while (this.group.children.length) {
      const o = this.group.children.pop()!;
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          const mat = m.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else {
            const map = (mat as THREE.MeshBasicMaterial).map;
            if (map) map.dispose();
            mat.dispose();
          }
        }
      });
    }
    this.sky = null;
    this.planet = null;
    this.flashLight = null;
    this.rain = null;
    this.rainVel = null;
    this.meteors = [];
    this.satellites = null;
    this.aurora = null;
  }
}

function makeSkyDome(top: number, bottom: number, radius: number): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  const topC = '#' + top.toString(16).padStart(6, '0');
  const botC = '#' + bottom.toString(16).padStart(6, '0');
  g.addColorStop(0, topC);
  g.addColorStop(0.45, topC);
  g.addColorStop(1, botC);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 24), mat);
  mesh.renderOrder = -10;
  return mesh;
}
