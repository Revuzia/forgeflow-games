import * as THREE from 'three';
import type { MapDef } from '../core/types';

export interface BuildingCollider {
  min: THREE.Vector3;
  max: THREE.Vector3;
  center: THREE.Vector3;
  half: THREE.Vector3;
}

/** Dense neon city + alternate biome geometries. Uses InstancedMesh + spatial hash for FPS. */
export class CityGenerator {
  group = new THREE.Group();
  colliders: BuildingCollider[] = [];
  buildingCount = 0;
  groundCollide = true;
  private ground: THREE.Mesh | null = null;
  private spatial = new Map<string, number[]>();
  private spatialCell = 40;

  build(map: MapDef) {
    this.clear();
    this.groundCollide = map.hasGround !== false && map.style !== 'space' && map.style !== 'atmo';
    switch (map.style) {
      case 'pit':
        this.buildPit(map);
        break;
      case 'clouds':
        this.buildCloudSea(map);
        break;
      case 'atmo':
        this.buildUpperAtmo(map);
        break;
      case 'space':
        this.buildDeepSpace(map);
        break;
      default:
        this.buildSkyCity(map);
        break;
    }
    this.rebuildSpatial();
  }

  private buildSkyCity(map: MapDef) {
    const bounds = map.bounds;
    this.addCityFloor(bounds);
    this.addSunset(map);
    this.addMountains(bounds, 24);

    // Full coverage grid — no early-exit bias that left half the map empty.
    const cell = 15;
    const halfCells = Math.floor(bounds / cell);
    const candidates: Array<{ gx: number; gz: number; roll: number }> = [];

    for (let gx = -halfCells; gx <= halfCells; gx++) {
      for (let gz = -halfCells; gz <= halfCells; gz++) {
        // Primary avenues (cross) + secondary every 5 cells for flight lanes
        if (gx === 0 || gz === 0) continue;
        if (Math.abs(gx) % 5 === 0 || Math.abs(gz) % 5 === 0) continue;
        // Spawn plaza
        if (Math.abs(gx) < 2 && Math.abs(gz) < 2) continue;
        const roll = hash2(gx, gz);
        // Outer ring slightly sparser, core dense
        const dist = Math.hypot(gx, gz) / halfCells;
        const skipChance = dist > 0.85 ? 0.28 : dist > 0.55 ? 0.12 : 0.04;
        if (roll < skipChance) continue;
        candidates.push({ gx, gz, roll });
      }
    }

    // Cap for GPU; shuffle-by-hash keeps even coverage across the arena
    const maxTowers = 520;
    candidates.sort((a, b) => a.roll - b.roll);
    const pick = candidates.length > maxTowers ? candidates.slice(0, maxTowers) : candidates;

    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a1030,
      metalness: 0.45,
      roughness: 0.62,
      emissive: 0x220033,
      emissiveIntensity: 0.28,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, pick.length);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;

    // Two neon bands per tower (was 3) — same look, fewer instances
    const bandGeo = new THREE.BoxGeometry(1.02, 0.07, 1.02);
    const bandMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const bands = new THREE.InstancedMesh(bandGeo, bandMat, pick.length * 2);
    bands.frustumCulled = true;

    // Mid-height window strips (cheap emissive accents)
    const winGeo = new THREE.BoxGeometry(1.01, 0.35, 1.01);
    const winMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.35,
      toneMapped: false,
    });
    const windows = new THREE.InstancedMesh(winGeo, winMat, pick.length);
    windows.frustumCulled = true;

    const dummy = new THREE.Object3D();
    const colors = [0x00f0ff, 0xff2bd6, 0xffe566, 0x39ff88, 0xff6b2b, 0xaa66ff];
    let bi = 0;
    let placed = 0;

    for (const { gx, gz, roll } of pick) {
      const jitter = (roll - 0.5) * 5;
      const x = gx * cell + jitter;
      const z = gz * cell + ((hash2(gz, gx) - 0.5) * 5);
      const dist = Math.hypot(gx, gz) / halfCells;

      // Downtown towers taller; outer mid-rise
      const coreBoost = dist < 0.35 ? 50 + roll * 40 : dist < 0.65 ? 15 : 0;
      const w = 7 + roll * 12 + (1 - dist) * 4;
      const d = 7 + hash2(gx + 3, gz) * 12 + (1 - dist) * 4;
      const h = 18 + roll * 70 + coreBoost + (hash2(gx, gz + 9) < 0.12 ? 55 : 0);

      dummy.position.set(x, h / 2, z);
      dummy.scale.set(w, h, d);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);

      const bandColor = colors[placed % colors.length];
      for (let k = 0; k < 2; k++) {
        const by = h * (0.3 + k * 0.35);
        dummy.position.set(x, by, z);
        dummy.scale.set(w, 1, d);
        dummy.updateMatrix();
        bands.setMatrixAt(bi, dummy.matrix);
        bands.setColorAt(bi, new THREE.Color(bandColor));
        bi++;
      }

      // Single window band mid-body
      dummy.position.set(x, h * 0.55, z);
      dummy.scale.set(w, 1, d);
      dummy.updateMatrix();
      windows.setMatrixAt(placed, dummy.matrix);

      this.colliders.push(this.makeCollider(x, h / 2, z, w / 2, h / 2, d / 2));
      placed++;
    }

    mesh.count = placed;
    bands.count = bi;
    windows.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    bands.instanceMatrix.needsUpdate = true;
    windows.instanceMatrix.needsUpdate = true;
    if (bands.instanceColor) bands.instanceColor.needsUpdate = true;

    this.group.add(mesh);
    this.group.add(bands);
    this.group.add(windows);
    this.buildingCount = placed;

    this.addPads(18, bounds * 0.42, 28, 95);
    this.addStreetLightsInstanced(bounds);
    this.addBillboards(pick.length > 80 ? 40 : 20, bounds * 0.7);
  }

  private buildPit(map: MapDef) {
    const bounds = map.bounds;
    this.addGround(bounds, 0x0c0614);

    const wallCount = 48;
    const stackCount = 55;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x181028,
      metalness: 0.5,
      roughness: 0.55,
      emissive: 0x331144,
      emissiveIntensity: 0.3,
    });
    const walls = new THREE.InstancedMesh(geo, mat, wallCount + stackCount);
    const neon = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.05, 0.12, 1.05),
      new THREE.MeshBasicMaterial({ color: 0xff2bd6, toneMapped: false }),
      wallCount
    );
    const dummy = new THREE.Object3D();
    const R = bounds * 0.72;

    for (let i = 0; i < wallCount; i++) {
      const a = (i / wallCount) * Math.PI * 2;
      const x = Math.cos(a) * R;
      const z = Math.sin(a) * R;
      const h = 50 + hash2(i, 1) * 40;
      const w = 14 + hash2(i, 2) * 10;
      dummy.position.set(x, h / 2, z);
      dummy.scale.set(w, h, w);
      dummy.lookAt(0, h / 2, 0);
      dummy.updateMatrix();
      walls.setMatrixAt(i, dummy.matrix);

      dummy.position.set(x, h * 0.6, z);
      dummy.scale.set(w, 1, w);
      dummy.updateMatrix();
      neon.setMatrixAt(i, dummy.matrix);

      this.colliders.push(this.makeCollider(x, h / 2, z, w / 2, h / 2, w / 2));
    }

    let stacks = 0;
    for (let i = 0; i < stackCount * 2 && stacks < stackCount; i++) {
      const a = hash2(i, 7) * Math.PI * 2;
      const r = hash2(i, 8) * R * 0.55;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.hypot(x, z) < 25) continue;
      const h = 15 + hash2(i, 9) * 45;
      const w = 6 + hash2(i, 10) * 10;
      dummy.position.set(x, h / 2, z);
      dummy.scale.set(w, h, w);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      walls.setMatrixAt(wallCount + stacks, dummy.matrix);
      this.colliders.push(this.makeCollider(x, h / 2, z, w / 2, h / 2, w / 2));
      stacks++;
    }
    walls.count = wallCount + stacks;
    neon.count = wallCount;
    walls.instanceMatrix.needsUpdate = true;
    neon.instanceMatrix.needsUpdate = true;
    this.group.add(walls);
    this.group.add(neon);
    this.buildingCount = wallCount + stacks;

    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(22, 24, 3, 12),
      new THREE.MeshStandardMaterial({
        color: 0x221133,
        emissive: 0x00f0ff,
        emissiveIntensity: 0.2,
        metalness: 0.6,
        roughness: 0.4,
      })
    );
    pad.position.y = 1.5;
    this.group.add(pad);
    this.colliders.push(this.makeCollider(0, 1.5, 0, 22, 1.5, 22));

    this.addPitFloor(bounds);
    this.addSunset(map);
  }

  private buildCloudSea(map: MapDef) {
    const bounds = map.bounds;
    // Polished cloud-sea floor — ocean + mist, no debug grid
    this.addCloudSeaFloor(bounds);
    // Soft under-cloud fluff near surface
    this.addCloudLayer(bounds, 40, 8, 22, 0xb8d8f8, 0.5);

    // Floating cloud puffs — instanced soft boxes / spheres look
    const n = 180;
    const geo = new THREE.SphereGeometry(1, 8, 6);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xddeeff,
      emissive: 0x4466aa,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.72,
      roughness: 1,
      metalness: 0,
    });
    const clouds = new THREE.InstancedMesh(geo, mat, n);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const a = hash2(i, 1) * Math.PI * 2;
      const r = hash2(i, 2) * bounds * 0.95;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = 25 + hash2(i, 3) * 90;
      const s = 8 + hash2(i, 4) * 22;
      dummy.position.set(x, y, z);
      dummy.scale.set(s * 1.6, s * 0.55, s * 1.2);
      dummy.updateMatrix();
      clouds.setMatrixAt(i, dummy.matrix);
    }
    clouds.instanceMatrix.needsUpdate = true;
    this.group.add(clouds);

    // Sky platforms / runways
    this.addPads(28, bounds * 0.55, 40, 110);
    // Neon pillars between clouds
    const pillars = 40;
    const pGeo = new THREE.CylinderGeometry(0.8, 1.2, 1, 6);
    const pMat = new THREE.MeshBasicMaterial({ color: 0x66eeff, toneMapped: false });
    const pMesh = new THREE.InstancedMesh(pGeo, pMat, pillars);
    for (let i = 0; i < pillars; i++) {
      const a = (i / pillars) * Math.PI * 2;
      const r = 40 + (i % 5) * 35;
      const h = 30 + hash2(i, 5) * 50;
      dummy.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
      dummy.scale.set(1, h, 1);
      dummy.updateMatrix();
      pMesh.setMatrixAt(i, dummy.matrix);
      this.colliders.push(
        this.makeCollider(Math.cos(a) * r, h / 2, Math.sin(a) * r, 1.2, h / 2, 1.2)
      );
    }
    pMesh.instanceMatrix.needsUpdate = true;
    this.group.add(pMesh);
    this.buildingCount = n + pillars;
    this.addCloudLayer(bounds, 70, 40, 100, 0xffffff, 0.4);
    this.addSunset(map);
  }

  private buildUpperAtmo(map: MapDef) {
    const bounds = map.bounds;
    // Soft stratosphere haze layers (no hard grid / tech floor)
    const haze = new THREE.Mesh(
      new THREE.CircleGeometry(bounds * 1.35, 64),
      new THREE.MeshBasicMaterial({
        color: 0x1a3a70,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        fog: false,
        depthWrite: false,
      })
    );
    haze.rotation.x = -Math.PI / 2;
    haze.position.y = -35;
    this.group.add(haze);

    const hazeSoft = new THREE.Mesh(
      new THREE.CircleGeometry(bounds * 0.85, 48),
      new THREE.MeshBasicMaterial({
        color: 0x4488cc,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        fog: false,
        depthWrite: false,
      })
    );
    hazeSoft.rotation.x = -Math.PI / 2;
    hazeSoft.position.y = -28;
    this.group.add(hazeSoft);

    // High-altitude platform ring
    const ringGeo = new THREE.TorusGeometry(bounds * 0.35, 3, 8, 48);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x445566,
      metalness: 0.7,
      roughness: 0.35,
      emissive: 0x223344,
      emissiveIntensity: 0.4,
    });
    const orbitRing = new THREE.Mesh(ringGeo, ringMat);
    orbitRing.rotation.x = Math.PI / 2;
    orbitRing.position.y = 60;
    this.group.add(orbitRing);

    // Orbital stations
    const n = 70;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x334466,
      metalness: 0.7,
      roughness: 0.35,
      emissive: 0x112244,
      emissiveIntensity: 0.4,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const neon = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.05, 0.1, 1.05),
      new THREE.MeshBasicMaterial({ color: 0x88aaff, toneMapped: false }),
      n
    );
    const dummy = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const a = hash2(i, 1) * Math.PI * 2;
      const r = 30 + hash2(i, 2) * bounds * 0.7;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = 20 + hash2(i, 3) * 140;
      const w = 4 + hash2(i, 4) * 14;
      const h = 3 + hash2(i, 5) * 10;
      const d = 4 + hash2(i, 6) * 14;
      dummy.position.set(x, y, z);
      dummy.scale.set(w, h, d);
      dummy.rotation.set(hash2(i, 7) * 0.4, hash2(i, 8) * Math.PI, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      dummy.scale.set(w, 1, d);
      dummy.updateMatrix();
      neon.setMatrixAt(i, dummy.matrix);
      this.colliders.push(this.makeCollider(x, y, z, w / 2, h / 2, d / 2));
    }
    mesh.instanceMatrix.needsUpdate = true;
    neon.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.group.add(neon);
    this.buildingCount = n;

    this.addPads(20, bounds * 0.55, 40, 140);
    this.addStarfield(1200, bounds * 2.8, 0.55);
  }

  private buildDeepSpace(map: MapDef) {
    const bounds = map.bounds;
    this.addStarfield(2200, bounds * 3.2, 1);

    // Dense asteroid field (static) — meteors handled by atmosphere
    const n = 180;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x554466,
      metalness: 0.25,
      roughness: 0.85,
      emissive: 0x110022,
      emissiveIntensity: 0.15,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const a = hash2(i, 1) * Math.PI * 2;
      const r = 25 + hash2(i, 2) * bounds * 0.85;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = (hash2(i, 3) - 0.5) * bounds * 0.6;
      const s = 2 + hash2(i, 4) * 12;
      dummy.position.set(x, y, z);
      dummy.scale.set(s, s * (0.6 + hash2(i, 5) * 0.8), s);
      dummy.rotation.set(hash2(i, 6) * 6, hash2(i, 7) * 6, hash2(i, 8) * 6);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      this.colliders.push(this.makeCollider(x, y, z, s, s, s));
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.buildingCount = n;

    // Dock platforms
    this.addPads(14, bounds * 0.45, -50, 90);

    // Gate ring structure
    const gate = new THREE.Mesh(
      new THREE.TorusGeometry(28, 2.2, 10, 40),
      new THREE.MeshBasicMaterial({ color: 0xaa66ff, toneMapped: false })
    );
    gate.position.set(0, 20, -80);
    this.group.add(gate);
    this.colliders.push(this.makeCollider(0, 20, -80, 30, 4, 4));
  }

  private addCloudLayer(
    bounds: number,
    count: number,
    yMin: number,
    yMax: number,
    color: number,
    opacity: number
  ) {
    const geo = new THREE.SphereGeometry(1, 7, 5);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.15,
      transparent: true,
      opacity,
      roughness: 1,
      metalness: 0,
      depthWrite: false,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const a = hash2(i, 50) * Math.PI * 2;
      const r = hash2(i, 51) * bounds * 0.9;
      dummy.position.set(Math.cos(a) * r, yMin + hash2(i, 52) * (yMax - yMin), Math.sin(a) * r);
      const s = 10 + hash2(i, 53) * 28;
      dummy.scale.set(s * 1.8, s * 0.45, s * 1.4);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  private addStarfield(count: number, radius: number, opacity: number) {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = hash2(i, 11);
      const v = hash2(i, 12);
      const theta = u * Math.PI * 2;
      const phi = Math.acos(2 * v - 1);
      const r = radius * (0.55 + hash2(i, 13) * 0.45);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi) * 0.6;
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.2,
      sizeAttenuation: true,
      transparent: true,
      opacity,
      depthWrite: false,
      fog: false,
    });
    this.group.add(new THREE.Points(geo, mat));
  }

  private addBillboards(n: number, spread: number) {
    const geo = new THREE.PlaneGeometry(8, 4);
    const colors = [0x00f0ff, 0xff2bd6, 0xffe566];
    const mats = colors.map(
      (c) =>
        new THREE.MeshBasicMaterial({
          color: c,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
          toneMapped: false,
        })
    );
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, mats[i % mats.length]);
      const a = hash2(i, 20) * Math.PI * 2;
      const r = 40 + hash2(i, 21) * spread;
      m.position.set(Math.cos(a) * r, 25 + hash2(i, 22) * 60, Math.sin(a) * r);
      m.rotation.y = a + Math.PI / 2;
      this.group.add(m);
    }
  }

  private addGround(
    bounds: number,
    color: number,
    opts?: {
      metalness?: number;
      roughness?: number;
      emissive?: number;
      emissiveIntensity?: number;
      y?: number;
      scale?: number;
    }
  ) {
    const scale = opts?.scale ?? 2.4;
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(bounds * scale, bounds * scale, 1, 1),
      new THREE.MeshStandardMaterial({
        color,
        metalness: opts?.metalness ?? 0.15,
        roughness: opts?.roughness ?? 0.92,
        emissive: opts?.emissive ?? 0x000000,
        emissiveIntensity: opts?.emissiveIntensity ?? 0,
      })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = opts?.y ?? 0;
    this.ground.receiveShadow = true;
    this.group.add(this.ground);
  }

  /** Sky City asphalt + a few intentional neon avenues (not a debug GridHelper). */
  private addCityFloor(bounds: number) {
    this.addGround(bounds, 0x0e0a18, {
      metalness: 0.35,
      roughness: 0.88,
      emissive: 0x1a0830,
      emissiveIntensity: 0.12,
      scale: 2.5,
    });

    // Soft city-glow disc under the core
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(bounds * 0.55, 48),
      new THREE.MeshBasicMaterial({
        color: 0xff2bd6,
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
        toneMapped: false,
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.04;
    this.group.add(glow);

    // Primary avenues (match empty building lanes) — dark strips + thin neon edge
    const avenueHalf = bounds * 0.95;
    const roadW = 14;
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x0a0614,
      metalness: 0.4,
      roughness: 0.75,
      emissive: 0x140820,
      emissiveIntensity: 0.15,
    });
    const edgeMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.55,
      toneMapped: false,
    });

    const placeAvenue = (alongX: boolean) => {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(alongX ? avenueHalf * 2 : roadW, alongX ? roadW : avenueHalf * 2), roadMat);
      road.rotation.x = -Math.PI / 2;
      road.position.y = 0.06;
      this.group.add(road);

      for (const side of [-1, 1]) {
        const edge = new THREE.Mesh(
          new THREE.PlaneGeometry(alongX ? avenueHalf * 2 : 0.35, alongX ? 0.35 : avenueHalf * 2),
          edgeMat
        );
        edge.rotation.x = -Math.PI / 2;
        edge.position.y = 0.08;
        if (alongX) edge.position.z = side * (roadW * 0.48);
        else edge.position.x = side * (roadW * 0.48);
        this.group.add(edge);
      }
    };
    placeAvenue(true); // X-axis avenue
    placeAvenue(false); // Z-axis avenue

    // Secondary ring road (single torus, not a lattice)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(bounds * 0.38, bounds * 0.38 + 10, 64),
      new THREE.MeshBasicMaterial({
        color: 0xff2bd6,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.07;
    this.group.add(ring);

    // Center plaza
    const plaza = new THREE.Mesh(
      new THREE.CircleGeometry(22, 32),
      new THREE.MeshStandardMaterial({
        color: 0x1a1030,
        metalness: 0.55,
        roughness: 0.45,
        emissive: 0x00f0ff,
        emissiveIntensity: 0.18,
      })
    );
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.y = 0.09;
    this.group.add(plaza);
  }

  /** The Pit — dark industrial deck, heat rings, no grid. */
  private addPitFloor(bounds: number) {
    // Base already added by buildPit; layer polish on top
    const deck = new THREE.Mesh(
      new THREE.CircleGeometry(bounds * 0.78, 48),
      new THREE.MeshStandardMaterial({
        color: 0x120818,
        metalness: 0.55,
        roughness: 0.55,
        emissive: 0x2a0840,
        emissiveIntensity: 0.22,
      })
    );
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = 0.05;
    this.group.add(deck);

    for (let i = 0; i < 3; i++) {
      const r0 = 28 + i * 32;
      const r1 = r0 + 1.4;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r0, r1, 48),
        new THREE.MeshBasicMaterial({
          color: i % 2 === 0 ? 0xff2bd6 : 0x00f0ff,
          transparent: true,
          opacity: 0.28 - i * 0.06,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.08 + i * 0.01;
      this.group.add(ring);
    }
  }

  /** Cloud Sea — continuous ocean + mist veil (no wire grid). */
  private addCloudSeaFloor(bounds: number) {
    // Deep water
    this.addGround(bounds, 0x0c2848, {
      metalness: 0.72,
      roughness: 0.22,
      emissive: 0x0a2038,
      emissiveIntensity: 0.2,
      scale: 2.8,
    });

    // Soft fog/mist sheet just above water
    const mist = new THREE.Mesh(
      new THREE.PlaneGeometry(bounds * 2.6, bounds * 2.6),
      new THREE.MeshBasicMaterial({
        color: 0xc8e0f8,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    mist.rotation.x = -Math.PI / 2;
    mist.position.y = 1.2;
    this.group.add(mist);

    // Horizon glow ring
    const horizon = new THREE.Mesh(
      new THREE.RingGeometry(bounds * 0.9, bounds * 1.05, 64),
      new THREE.MeshBasicMaterial({
        color: 0xa8d0f0,
        transparent: true,
        opacity: 0.2,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      })
    );
    horizon.rotation.x = -Math.PI / 2;
    horizon.position.y = 0.4;
    this.group.add(horizon);

    // Central bright pool (sun path)
    const pool = new THREE.Mesh(
      new THREE.CircleGeometry(bounds * 0.25, 40),
      new THREE.MeshBasicMaterial({
        color: 0xe8f4ff,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.15;
    this.group.add(pool);
  }

  private addSunset(map: MapDef) {
    const b = map.bounds;
    const sun = new THREE.Mesh(
      new THREE.CircleGeometry(48, 32),
      new THREE.MeshBasicMaterial({ color: map.sunColor, fog: false, transparent: true, opacity: 0.95 })
    );
    sun.position.set(-180, 40, -b * 0.9);
    this.group.add(sun);

    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(70, 32),
      new THREE.MeshBasicMaterial({ color: 0xff4488, fog: false, transparent: true, opacity: 0.25 })
    );
    glow.position.copy(sun.position);
    glow.position.z += 1;
    this.group.add(glow);
  }

  private addMountains(bounds: number, count: number) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x2a1040, transparent: true, opacity: 0.75 });
    const geo = new THREE.ConeGeometry(1, 1, 5);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const r = bounds * 1.12;
      const h = 45 + hash2(i, 30) * 90;
      const rad = 28 + hash2(i, 31) * 40;
      dummy.position.set(Math.cos(a) * r, h * 0.35, Math.sin(a) * r);
      dummy.scale.set(rad, h, rad);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  private addPads(n: number, spread: number, yMin: number, yMax: number) {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a2030,
      emissive: 0x00f0ff,
      emissiveIntensity: 0.35,
      metalness: 0.5,
      roughness: 0.4,
    });
    const geo = new THREE.CylinderGeometry(6, 7, 1.2, 8);
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const x = (hash2(i, 40) - 0.5) * spread * 2;
      const z = (hash2(i, 41) - 0.5) * spread * 2;
      const y = yMin + hash2(i, 42) * (yMax - yMin);
      dummy.position.set(x, y, z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      this.colliders.push(this.makeCollider(x, y, z, 6, 0.6, 6));
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  private addStreetLightsInstanced(bounds: number) {
    const positions: Array<[number, number, number]> = [];
    for (let i = -bounds; i <= bounds; i += 36) {
      for (const s of [-14, 14]) {
        positions.push([s, 8, i], [i, 8, s]);
      }
    }
    const geo = new THREE.SphereGeometry(0.55, 5, 5);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe566, toneMapped: false });
    const mesh = new THREE.InstancedMesh(geo, mat, positions.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < positions.length; i++) {
      dummy.position.set(positions[i][0], positions[i][1], positions[i][2]);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  private makeCollider(x: number, y: number, z: number, hx: number, hy: number, hz: number): BuildingCollider {
    const center = new THREE.Vector3(x, y, z);
    const half = new THREE.Vector3(hx, hy, hz);
    return {
      center,
      half,
      min: new THREE.Vector3(x - hx, y - hy, z - hz),
      max: new THREE.Vector3(x + hx, y + hy, z + hz),
    };
  }

  private rebuildSpatial() {
    this.spatial.clear();
    const cs = this.spatialCell;
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      const x0 = Math.floor(c.min.x / cs);
      const x1 = Math.floor(c.max.x / cs);
      const z0 = Math.floor(c.min.z / cs);
      const z1 = Math.floor(c.max.z / cs);
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const key = `${x},${z}`;
          let bucket = this.spatial.get(key);
          if (!bucket) {
            bucket = [];
            this.spatial.set(key, bucket);
          }
          bucket.push(i);
        }
      }
    }
  }

  /**
   * Sphere vs AABB buildings. On hit: writes push normal and depenetrates `pos`
   * so the sphere sits fully outside the solid (no tunneling leftovers).
   */
  collideSphere(pos: THREE.Vector3, radius: number, outNormal: THREE.Vector3): boolean {
    const cs = this.spatialCell;
    const x0 = Math.floor((pos.x - radius) / cs) - 1;
    const x1 = Math.floor((pos.x + radius) / cs) + 1;
    const z0 = Math.floor((pos.z - radius) / cs) - 1;
    const z1 = Math.floor((pos.z + radius) / cs) + 1;
    const seen = new Set<number>();
    let hit = false;
    let bestPen = 0;

    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const bucket = this.spatial.get(`${x},${z}`);
        if (!bucket) continue;
        for (const idx of bucket) {
          if (seen.has(idx)) continue;
          seen.add(idx);
          const c = this.colliders[idx];
          // Skip thin pads for solid body collision (still collide pads with hy >= 0.5 lightly)
          const cx = THREE.MathUtils.clamp(pos.x, c.min.x, c.max.x);
          const cy = THREE.MathUtils.clamp(pos.y, c.min.y, c.max.y);
          const cz = THREE.MathUtils.clamp(pos.z, c.min.z, c.max.z);
          const dx = pos.x - cx;
          const dy = pos.y - cy;
          const dz = pos.z - cz;
          const d2 = dx * dx + dy * dy + dz * dz;

          // Center inside AABB (common when tunneling)
          const inside =
            pos.x >= c.min.x &&
            pos.x <= c.max.x &&
            pos.y >= c.min.y &&
            pos.y <= c.max.y &&
            pos.z >= c.min.z &&
            pos.z <= c.max.z;

          if (inside) {
            const penL = pos.x - c.min.x;
            const penR = c.max.x - pos.x;
            const penD = pos.y - c.min.y;
            const penU = c.max.y - pos.y;
            const penB = pos.z - c.min.z;
            const penF = c.max.z - pos.z;
            let axis = 0; // 0=x 1=y 2=z
            let sign = 1;
            let pen = penL;
            if (penR < pen) {
              pen = penR;
              sign = -1;
            }
            if (penD < pen) {
              pen = penD;
              axis = 1;
              sign = 1;
            }
            if (penU < pen) {
              pen = penU;
              axis = 1;
              sign = -1;
            }
            if (penB < pen) {
              pen = penB;
              axis = 2;
              sign = 1;
            }
            if (penF < pen) {
              pen = penF;
              axis = 2;
              sign = -1;
            }
            outNormal.set(0, 0, 0);
            if (axis === 0) outNormal.x = -sign;
            else if (axis === 1) outNormal.y = -sign;
            else outNormal.z = -sign;
            // Push fully clear of box + radius
            const push = pen + radius + 0.08;
            pos.addScaledVector(outNormal, push);
            hit = true;
            bestPen = Math.max(bestPen, push);
            continue;
          }

          if (d2 < radius * radius && d2 > 1e-10) {
            const d = Math.sqrt(d2);
            outNormal.set(dx / d, dy / d, dz / d);
            const push = radius - d + 0.06;
            pos.addScaledVector(outNormal, push);
            hit = true;
            bestPen = Math.max(bestPen, push);
          }
        }
      }
    }

    if (this.groundCollide && pos.y - radius < 0) {
      outNormal.set(0, 1, 0);
      pos.y = radius;
      hit = true;
    }
    return hit;
  }

  /**
   * Iterate collision until clear or max passes — stops ships sliding through towers.
   * Returns true if any hit occurred.
   */
  resolveSolid(pos: THREE.Vector3, radius: number, outNormal: THREE.Vector3, maxIter = 6): boolean {
    let any = false;
    for (let i = 0; i < maxIter; i++) {
      if (!this.collideSphere(pos, radius, outNormal)) break;
      any = true;
    }
    return any;
  }

  /**
   * True if the segment from→to is not blocked by building AABBs.
   * Used to hide enemy rings/radar when rivals are behind homes.
   */
  lineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 2) return true;

    const steps = Math.min(28, Math.max(6, Math.ceil(len / 10)));
    const cs = this.spatialCell;
    const seen = new Set<number>();
    // Shrink sample inset so we don't false-block at ship hulls near towers
    for (let i = 2; i <= steps - 2; i++) {
      const t = i / steps;
      const x = from.x + dx * t;
      const y = from.y + dy * t;
      const z = from.z + dz * t;
      const gx = Math.floor(x / cs);
      const gz = Math.floor(z / cs);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const bucket = this.spatial.get(`${gx + ox},${gz + oz}`);
          if (!bucket) continue;
          for (const idx of bucket) {
            if (seen.has(idx)) continue;
            seen.add(idx);
            const c = this.colliders[idx];
            // Ignore flat pads / short props (height half < 4)
            if (c.half.y < 4) continue;
            if (x >= c.min.x && x <= c.max.x && y >= c.min.y && y <= c.max.y && z >= c.min.z && z <= c.max.z) {
              return false;
            }
          }
        }
      }
    }
    return true;
  }

  clear() {
    while (this.group.children.length) {
      const o = this.group.children.pop()!;
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          const mat = m.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else mat.dispose();
        }
      });
    }
    this.colliders = [];
    this.spatial.clear();
    this.buildingCount = 0;
    this.ground = null;
  }
}

/** Deterministic 0–1 hash for stable layouts (no Math.random flicker on rebuild). */
function hash2(a: number, b: number): number {
  let n = (a * 374761393 + b * 668265263) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  n = n ^ (n >>> 16);
  return (n >>> 0) / 4294967295;
}
