import * as THREE from 'three';
import { TRACK_HALF_WIDTH } from './config.js';
import { mulberry32 } from './math.js';

/**
 * Closed ribbon track with sampled centerline, gates, item pads, hazards.
 * Road is TRACK_HALF_WIDTH (widened for roomier racing lines).
 */
export class Track {
  constructor(scene, def) {
    this.scene = scene;
    this.def = def;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.samples = [];
    this.totalLength = 0;
    this.checkpoints = [];
    this.itemPads = [];
    this.hazards = [];
    this.roadMeshes = [];
    this.build();
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose(); // frees instanceMatrix / instanceColor buffers
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
  }

  build() {
    const def = this.def;
    const rnd = mulberry32(def.seed);
    const N = 220;
    const pts = [];

    for (let i = 0; i < N; i++) {
      const t = (i / N) * Math.PI * 2;
      // Harmonics MUST be integers or the loop won't close (f(0) !== f(2pi)),
      // leaving a position/height cliff at the start/finish seam. Round waves and
      // use an integer height harmonic so the parametric curve is 2pi-periodic.
      const waves = Math.round(def.waves) || 1;
      const r =
        def.radius *
        (0.82 + 0.18 * Math.sin(t * waves + def.seed * 0.01) + 0.06 * Math.sin(t * 5));
      const x = Math.cos(t) * r + Math.sin(t * 2) * (def.radius * 0.1);
      const z = Math.sin(t) * r * 0.72 + Math.cos(t * 3) * (def.radius * 0.07);
      let y = 4 + Math.sin(t * waves) * def.heightAmp + Math.cos(t * 2) * (def.heightAmp * 0.35);
      if (def.id === 'null_spire') {
        // NULL SPIRE finally lives up to its "vertical figure-eight": extra INTEGER
        // harmonics (2·waves and 4) stack towering climbs and dives onto the base
        // loop, upward-biased via (1 - cos). Integer harmonics keep f(0) === f(2pi),
        // so the start/finish seam stays perfectly closed (no height cliff).
        y +=
          Math.sin(t * 2 * waves) * def.heightAmp * 0.35 +
          (1 - Math.cos(t * 4)) * def.heightAmp * 0.6;
      }
      pts.push(new THREE.Vector3(x, y, z));
    }

    // Build arc-length samples
    this.samples = [];
    let len = 0;
    for (let i = 0; i < N; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % N];
      const seg = a.distanceTo(b);
      const tangent = b.clone().sub(a).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      let side = new THREE.Vector3().crossVectors(up, tangent);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      const normal = new THREE.Vector3().crossVectors(tangent, side).normalize();
      this.samples.push({
        pos: a.clone(),
        tangent,
        side,
        normal,
        s: len,
        index: i,
      });
      len += seg;
    }
    this.totalLength = len;

    const half = TRACK_HALF_WIDTH;
    // Road must read as a clearly SOLID lane, not a near-black void between the
    // glowing edge rails (that made it feel see-through / hard to drive). Lighter
    // slate surface + a faint rail-tinted glow so the drivable lane is obvious.
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x2b2850,
      metalness: 0.35,
      roughness: 0.6,
      emissive: def.rail,
      emissiveIntensity: 0.3,
    });
    const edgeMat = new THREE.MeshBasicMaterial({
      color: def.rail,
      transparent: true,
      opacity: 0.85,
      toneMapped: false,
    });
    const stripeMat = new THREE.MeshBasicMaterial({
      color: def.accent,
      transparent: true,
      opacity: 0.85,
      toneMapped: false,
    });

    // PERF: build the whole road ribbon as ONE merged BufferGeometry, and merge
    // every rail beam and centerline stripe into a single mesh each. This collapses
    // ~730 per-segment draw calls (road quad + 2 rails + 1/3 stripe, per segment)
    // down to 3 — with pixel-identical geometry: same corner positions, and
    // computeVertexNormals on the (non-shared-vertex) ribbon yields the same flat
    // per-quad normals the old per-quad geometries had.
    const roadPos = new Float32Array(N * 18);
    const railGeos = [];
    const stripeGeos = [];
    const c0 = new THREE.Vector3();
    const c1 = new THREE.Vector3();
    const c2 = new THREE.Vector3();
    const c3 = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const s0 = this.samples[i];
      const s1 = this.samples[(i + 1) % N];
      c0.copy(s0.pos).addScaledVector(s0.side, -half);
      c1.copy(s0.pos).addScaledVector(s0.side, half);
      c2.copy(s1.pos).addScaledVector(s1.side, half);
      c3.copy(s1.pos).addScaledVector(s1.side, -half);
      c0.y += 0.02;
      c1.y += 0.02;
      c2.y += 0.02;
      c3.y += 0.02;
      const o = i * 18;
      roadPos[o] = c0.x; roadPos[o + 1] = c0.y; roadPos[o + 2] = c0.z;
      roadPos[o + 3] = c1.x; roadPos[o + 4] = c1.y; roadPos[o + 5] = c1.z;
      roadPos[o + 6] = c2.x; roadPos[o + 7] = c2.y; roadPos[o + 8] = c2.z;
      roadPos[o + 9] = c0.x; roadPos[o + 10] = c0.y; roadPos[o + 11] = c0.z;
      roadPos[o + 12] = c2.x; roadPos[o + 13] = c2.y; roadPos[o + 14] = c2.z;
      roadPos[o + 15] = c3.x; roadPos[o + 16] = c3.y; roadPos[o + 17] = c3.z;

      for (const sign of [-1, 1]) {
        const a = s0.pos.clone().addScaledVector(s0.side, sign * half);
        const b = s1.pos.clone().addScaledVector(s1.side, sign * half);
        a.y += 0.35;
        b.y += 0.35;
        railGeos.push(this._beamGeo(a, b, 0.2));
      }
      if (i % 3 === 0) {
        const mid0 = s0.pos.clone();
        mid0.y += 0.06;
        const mid1 = s0.pos.clone().addScaledVector(s0.tangent, 2.2);
        mid1.y += 0.06;
        stripeGeos.push(this._beamGeo(mid0, mid1, 0.12));
      }
    }

    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.BufferAttribute(roadPos, 3));
    roadGeo.computeVertexNormals();
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    this.group.add(roadMesh);
    this.roadMeshes.push(roadMesh);

    const railMesh = new THREE.Mesh(this._mergePositions(railGeos), edgeMat);
    this.group.add(railMesh);
    this.roadMeshes.push(railMesh);

    const stripeMesh = new THREE.Mesh(this._mergePositions(stripeGeos), stripeMat);
    this.group.add(stripeMesh);
    this.roadMeshes.push(stripeMesh);

    // Gates scaled to wider road
    const gateR = half * 0.95;
    const cpCount = 12;
    for (let c = 0; c < cpCount; c++) {
      const idx = Math.floor((c / cpCount) * N) % N;
      const s = this.samples[idx];
      const gate = this.makeGate(def, c === 0, gateR);
      gate.position.copy(s.pos);
      gate.position.y += 3.2;
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), s.tangent);
      gate.quaternion.copy(q);
      this.group.add(gate);
      this.checkpoints.push({
        index: c,
        sampleIndex: idx,
        s: s.s,
        pos: s.pos.clone(),
        tangent: s.tangent.clone(),
        mesh: gate,
      });
    }

    // Item pads — wider lane spread
    // Scale item pads with track length so a 60-90s lap isn't item-starved.
    const padCount = Math.max(10, Math.round(this.totalLength / 200));
    const laneSpread = half * 0.45;
    for (let i = 0; i < padCount; i++) {
      const idx = Math.floor(((i + 0.5) / padCount) * N) % N;
      const s = this.samples[idx];
      const lane = (i % 3) - 1;
      const p = s.pos.clone().addScaledVector(s.side, lane * laneSpread);
      p.y += 1.4;
      const pad = this.makeItemPad(def.accent);
      pad.position.copy(p);
      this.group.add(pad);
      this.itemPads.push({
        mesh: pad,
        pos: p.clone(),
        alive: true,
        respawn: 0,
        sampleIndex: idx,
      });
    }

    // Hazards: edge pillars + short side spinners — never block the full road
    const hazardCount = Math.max(14, Math.round(this.totalLength / 180));
    for (let i = 0; i < hazardCount; i++) {
      const idx = Math.floor(rnd() * N);
      const s = this.samples[idx];
      const kind = rnd();
      if (kind < 0.6) {
        const sign = rnd() < 0.5 ? -1 : 1;
        // Sit just inside edge rail so you can dodge to center
        const lat = sign * (half * 0.72 + rnd() * half * 0.12);
        const p = s.pos.clone().addScaledVector(s.side, lat);
        p.y += 2;
        const pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.85, 1.1, 5, 8),
          new THREE.MeshStandardMaterial({
            color: 0x14081c,
            metalness: 0.6,
            roughness: 0.35,
            emissive: def.accent,
            emissiveIntensity: 0.25,
          })
        );
        pillar.position.copy(p);
        this.group.add(pillar);
        this.hazards.push({
          type: 'static',
          mesh: pillar,
          radius: 1.45,
          pos: p.clone(),
          knock: 1,
        });
      } else {
        // Short bar near one side — not a full-width gate
        const sign = rnd() < 0.5 ? -1 : 1;
        const lat = sign * (half * 0.4 + rnd() * half * 0.15);
        const p = s.pos.clone().addScaledVector(s.side, lat);
        p.y += 2.2;
        const spin = new THREE.Group();
        const barLen = half * 0.55;
        const bar = new THREE.Mesh(
          new THREE.BoxGeometry(barLen, 0.4, 0.4),
          new THREE.MeshStandardMaterial({
            color: 0x1a1020,
            emissive: def.rail,
            emissiveIntensity: 0.4,
            metalness: 0.5,
            roughness: 0.4,
          })
        );
        spin.add(bar);
        spin.position.copy(p);
        this.group.add(spin);
        this.hazards.push({
          type: 'spin',
          mesh: spin,
          len: barLen,
          radius: barLen * 0.42,
          pos: p.clone(),
          speed: 1.1 + rnd() * 1.6,
          knock: 1.15,
        });
      }
    }

    this.buildScenery(def, rnd);
  }

  makeBeam(a, b, radius, mat) {
    const dir = b.clone().sub(a);
    const len = dir.length();
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 6), mat);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    return mesh;
  }

  makeGate(def, isStart, halfW) {
    const g = new THREE.Group();
    const col = isStart ? 0x39ff88 : def.rail;
    const mat = new THREE.MeshBasicMaterial({
      color: col,
      transparent: true,
      opacity: 0.85,
      toneMapped: false,
    });
    const R = halfW;
    const arch = new THREE.Mesh(new THREE.TorusGeometry(R, 0.28, 8, 28, Math.PI), mat);
    arch.rotation.y = Math.PI / 2;
    arch.rotation.z = Math.PI;
    g.add(arch);
    for (const x of [-R, R]) {
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.45, R, 0.45),
        new THREE.MeshStandardMaterial({ color: 0x12081c, emissive: col, emissiveIntensity: 0.35 })
      );
      post.position.set(x, -R * 0.5, 0);
      g.add(post);
    }
    if (isStart) {
      const banner = new THREE.Mesh(
        new THREE.BoxGeometry(Math.min(8, R * 0.7), 0.7, 0.15),
        new THREE.MeshBasicMaterial({ color: 0x39ff88 })
      );
      banner.position.set(0, 1.2, 0);
      g.add(banner);
    }
    return g;
  }

  makeItemPad(color) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.85, 0),
      new THREE.MeshStandardMaterial({
        color: 0x101020,
        emissive: color,
        emissiveIntensity: 0.7,
        metalness: 0.4,
        roughness: 0.3,
        transparent: true,
        opacity: 0.95,
      })
    );
    g.add(core);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.15, 0.08, 6, 20),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, toneMapped: false })
    );
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    g.userData.core = core;
    g.userData.ring = ring;
    return g;
  }

  /** Baked cylinder beam geometry (transform pre-applied) — ready to be merged. */
  _beamGeo(a, b, radius) {
    const dir = b.clone().sub(a);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(radius, radius, len, 6);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir.normalize()
    );
    const m = new THREE.Matrix4().compose(
      a.clone().add(b).multiplyScalar(0.5),
      q,
      new THREE.Vector3(1, 1, 1)
    );
    geo.applyMatrix4(m);
    return geo;
  }

  /**
   * Merge an array of position-bearing geometries (basic-material beams — no
   * lighting, so positions are all we need) into one non-indexed BufferGeometry.
   * Source geometries are disposed as they are consumed. No BufferGeometryUtils
   * dependency: the import map exposes only "three".
   */
  _mergePositions(geos) {
    let total = 0;
    const parts = geos.map((g) => {
      const ng = g.index ? g.toNonIndexed() : g;
      if (ng !== g) g.dispose();
      total += ng.attributes.position.count;
      return ng;
    });
    const arr = new Float32Array(total * 3);
    let off = 0;
    for (const g of parts) {
      arr.set(g.attributes.position.array, off);
      off += g.attributes.position.array.length;
      g.dispose();
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return merged;
  }

  /** Per-track scenery density + feature flags — makes each circuit read distinct. */
  _sceneryProfile(def) {
    const base = {
      towerCount: 36,
      towerW: 5,
      towerWRand: 10,
      towerH: 18,
      towerHRand: 90,
      spreadMin: 1.35,
      spreadRange: 1.1,
      boardCount: 14,
      ringCount: 6,
      spire: false,
    };
    let prof;
    switch (def.id) {
      case 'prism_boulevard': // dense downtown wall of glass towers
        prof = { ...base, towerCount: 52, towerH: 22, towerHRand: 95, spreadMin: 1.25, spreadRange: 1.05, boardCount: 16 }; break;
      case 'volt_canyon': // tight gorge — few, very tall towers hugging the track
        prof = { ...base, towerCount: 22, towerW: 6, towerWRand: 7, towerH: 44, towerHRand: 70, spreadMin: 1.1, spreadRange: 0.5, boardCount: 8, ringCount: 8 }; break;
      case 'glass_harbor': // wide, sparse, low — more billboards drifting over the fog
        prof = { ...base, towerCount: 18, towerW: 6, towerWRand: 12, towerH: 10, towerHRand: 34, spreadMin: 1.5, spreadRange: 1.6, boardCount: 22, ringCount: 5 }; break;
      case 'null_spire': // dead antenna — thin vertical masts + a towering central spire
        prof = { ...base, towerCount: 34, towerW: 3, towerWRand: 5, towerH: 40, towerHRand: 120, spreadMin: 1.2, spreadRange: 0.75, boardCount: 8, ringCount: 7, spire: true }; break;
      case 'echo_yards': // industrial freight — stocky cargo blocks + many cargo ghosts
        prof = { ...base, towerCount: 46, towerW: 8, towerWRand: 9, towerH: 12, towerHRand: 40, spreadMin: 1.2, spreadRange: 0.9, boardCount: 26, ringCount: 5 }; break;
      default:
        prof = base;
    }
    // Scale scenery density with circuit size (baseline radius ~150) so the now
    // ~5x-longer 60-90s circuits stay full of things to see, not sparse.
    const mul = Math.max(1, def.radius / 150);
    prof.towerCount = Math.round(prof.towerCount * mul);
    prof.boardCount = Math.round(prof.boardCount * mul);
    prof.ringCount = Math.round(prof.ringCount * mul);
    return prof;
  }

  /** NULL SPIRE centerpiece: the towering dead antenna the circuit loops around. */
  _buildSpire(def) {
    const g = new THREE.Group();
    const mastMat = new THREE.MeshStandardMaterial({
      color: 0x0a0612,
      metalness: 0.6,
      roughness: 0.4,
      emissive: def.rail,
      emissiveIntensity: 0.12,
    });
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 7, 210, 10), mastMat);
    mast.position.y = 105;
    g.add(mast);
    const ringMat = new THREE.MeshBasicMaterial({
      color: def.accent,
      transparent: true,
      opacity: 0.55,
      toneMapped: false,
    });
    for (let i = 0; i < 8; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(6 - i * 0.4, 0.5, 6, 24), ringMat);
      ring.position.y = 30 + i * 22;
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
    }
    const strutMat = new THREE.MeshBasicMaterial({
      color: def.rail,
      transparent: true,
      opacity: 0.5,
      toneMapped: false,
    });
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      const foot = new THREE.Vector3(Math.cos(a) * 34, 0, Math.sin(a) * 34);
      g.add(this.makeBeam(foot, new THREE.Vector3(0, 150, 0), 0.4, strutMat));
    }
    const beacon = new THREE.Mesh(
      new THREE.OctahedronGeometry(4, 0),
      new THREE.MeshBasicMaterial({ color: def.rail, transparent: true, opacity: 0.85, toneMapped: false })
    );
    beacon.position.y = 214;
    g.add(beacon);
    return g;
  }

  buildScenery(def, rnd) {
    const prof = this._sceneryProfile(def);
    const dummy = new THREE.Object3D();

    // Towers — one InstancedMesh per emissive bucket (rail / accent). A shared unit
    // box is scaled per instance, so N towers cost 2 draw calls instead of N meshes.
    // (Per-tower emissiveIntensity jitter is dropped in favor of a fixed 0.16 — an
    // imperceptible change on distant background props, and this scenery is being
    // re-densified per track anyway.)
    const towerGeo = new THREE.BoxGeometry(1, 1, 1);
    const towerMats = {
      rail: new THREE.MeshStandardMaterial({ color: 0x0c0614, metalness: 0.55, roughness: 0.45, emissive: def.rail, emissiveIntensity: 0.16 }),
      accent: new THREE.MeshStandardMaterial({ color: 0x0c0614, metalness: 0.55, roughness: 0.45, emissive: def.accent, emissiveIntensity: 0.16 }),
    };
    const railT = [];
    const accentT = [];
    for (let i = 0; i < prof.towerCount; i++) {
      const a = rnd() * Math.PI * 2;
      const r = def.radius * (prof.spreadMin + rnd() * prof.spreadRange);
      const h = prof.towerH + rnd() * prof.towerHRand;
      const w = prof.towerW + rnd() * prof.towerWRand;
      const d = prof.towerW + rnd() * prof.towerWRand;
      dummy.position.set(Math.cos(a) * r, h * 0.45, Math.sin(a) * r);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(w, h, d);
      dummy.updateMatrix();
      (rnd() < 0.5 ? railT : accentT).push(dummy.matrix.clone());
    }
    for (const [key, mats] of [['rail', railT], ['accent', accentT]]) {
      if (!mats.length) {
        towerMats[key].dispose();
        continue;
      }
      const inst = new THREE.InstancedMesh(towerGeo, towerMats[key], mats.length);
      mats.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.instanceMatrix.needsUpdate = true;
      this.group.add(inst);
    }

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(def.radius * 2.6, 56),
      new THREE.MeshStandardMaterial({
        color: 0x07040e,
        metalness: 0.3,
        roughness: 0.9,
        emissive: 0x12081c,
        emissiveIntensity: 0.2,
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    this.group.add(ground);

    // Billboards — one InstancedMesh. Per-instance instanceColor lets a single white
    // MeshBasicMaterial render both rail- and accent-tinted boards (white × tint).
    if (prof.boardCount > 0) {
      const boardGeo = new THREE.BoxGeometry(1, 1, 0.4);
      const boardMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, toneMapped: false });
      const boards = new THREE.InstancedMesh(boardGeo, boardMat, prof.boardCount);
      const col = new THREE.Color();
      for (let i = 0; i < prof.boardCount; i++) {
        const a = rnd() * Math.PI * 2;
        const r = def.radius * (1.15 + rnd() * 0.35);
        const h = 12 + rnd() * 28;
        dummy.position.set(Math.cos(a) * r, h, Math.sin(a) * r);
        dummy.scale.set(8 + rnd() * 10, 3 + rnd() * 4, 1);
        dummy.lookAt(0, h, 0);
        dummy.updateMatrix();
        boards.setMatrixAt(i, dummy.matrix);
        boards.setColorAt(i, col.setHex(rnd() < 0.5 ? def.rail : def.accent));
      }
      boards.instanceMatrix.needsUpdate = true;
      if (boards.instanceColor) boards.instanceColor.needsUpdate = true;
      this.group.add(boards);
    }

    // Floating accent rings over the centerline — one InstancedMesh.
    if (prof.ringCount > 0) {
      const ringGeo = new THREE.TorusGeometry(TRACK_HALF_WIDTH * 1.15, 0.12, 6, 36);
      const ringMat = new THREE.MeshBasicMaterial({ color: def.accent, transparent: true, opacity: 0.35, toneMapped: false });
      const rings = new THREE.InstancedMesh(ringGeo, ringMat, prof.ringCount);
      const look = new THREE.Vector3();
      for (let i = 0; i < prof.ringCount; i++) {
        const idx = Math.floor((i / prof.ringCount) * this.samples.length) % this.samples.length;
        const s = this.samples[idx];
        dummy.position.copy(s.pos);
        dummy.position.y += 6;
        dummy.scale.set(1, 1, 1);
        dummy.lookAt(look.copy(s.pos).add(s.tangent));
        dummy.updateMatrix();
        rings.setMatrixAt(i, dummy.matrix);
      }
      rings.instanceMatrix.needsUpdate = true;
      this.group.add(rings);
    }

    // NULL SPIRE's signature feature: the dead antenna the circuit loops around.
    if (prof.spire) this.group.add(this._buildSpire(def));

    const grid = new THREE.GridHelper(def.radius * 3.5, 48, def.rail, 0x1a0a28);
    grid.position.y = -1.9;
    grid.material.opacity = 0.22;
    grid.material.transparent = true;
    this.group.add(grid);
  }

  update(dt, time) {
    for (const h of this.hazards) {
      if (h.type === 'spin') h.mesh.rotation.y += h.speed * dt;
    }
    for (const pad of this.itemPads) {
      if (!pad.alive) {
        pad.respawn -= dt;
        pad.mesh.visible = false;
        if (pad.respawn <= 0) {
          pad.alive = true;
          pad.mesh.visible = true;
        }
      } else {
        pad.mesh.rotation.y += dt * 1.8;
        pad.mesh.position.y = pad.pos.y + Math.sin(time * 3 + pad.sampleIndex) * 0.25;
      }
    }
  }

  sampleAt(s) {
    const L = this.totalLength;
    let u = ((s % L) + L) % L;
    let i = 0;
    while (i < this.samples.length - 1 && this.samples[i + 1].s <= u) i++;
    const a = this.samples[i];
    const b = this.samples[(i + 1) % this.samples.length];
    const segLen = b.s >= a.s ? b.s - a.s : L - a.s + b.s;
    const t = segLen > 1e-6 ? (u - a.s) / segLen : 0;
    const tt = Math.max(0, Math.min(1, t));
    return {
      pos: a.pos.clone().lerp(b.pos, tt),
      tangent: a.tangent.clone().lerp(b.tangent, tt).normalize(),
      side: a.side.clone().lerp(b.side, tt).normalize(),
      normal: a.normal.clone().lerp(b.normal, tt).normalize(),
      s: u,
      index: i,
    };
  }

  project(worldPos) {
    let bestI = 0;
    let bestD = Infinity;
    const step = 4;
    for (let i = 0; i < this.samples.length; i += step) {
      const d = this.samples[i].pos.distanceToSquared(worldPos);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    for (let k = -6; k <= 6; k++) {
      const i = (bestI + k + this.samples.length) % this.samples.length;
      const d = this.samples[i].pos.distanceToSquared(worldPos);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    const s = this.samples[bestI];
    const rel = worldPos.clone().sub(s.pos);
    const lateral = rel.dot(s.side);
    const along = rel.dot(s.tangent);
    return {
      sampleIndex: bestI,
      s: s.s + along,
      lateral,
      onTrack: Math.abs(lateral) < TRACK_HALF_WIDTH + 1.2,
      sample: s,
    };
  }

  startPose(gridIndex, total) {
    const start = this.checkpoints[0];
    const back = 8 + Math.floor(gridIndex / 2) * 5.5;
    const lane = (gridIndex % 2 === 0 ? -1 : 1) * (TRACK_HALF_WIDTH * 0.28);
    const s = start.s - back;
    const samp = this.sampleAt(s);
    const pos = samp.pos.clone().addScaledVector(samp.side, lane);
    pos.y += 1.15;
    return { pos, tangent: samp.tangent.clone(), s, lateral: lane };
  }

  /** 2D outline samples for menu/minimap previews */
  outline2D(count = 48) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const s = this.samples[Math.floor((i / count) * this.samples.length) % this.samples.length];
      out.push({ x: s.pos.x, z: s.pos.z });
    }
    return out;
  }
}
