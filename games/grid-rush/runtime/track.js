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
      const y = 4 + Math.sin(t * waves) * def.heightAmp + Math.cos(t * 2) * (def.heightAmp * 0.35);
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
    const roadMat = new THREE.MeshStandardMaterial({
      color: 0x0c0a16,
      metalness: 0.55,
      roughness: 0.45,
      emissive: def.rail,
      emissiveIntensity: 0.08,
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
      opacity: 0.55,
      toneMapped: false,
    });

    for (let i = 0; i < N; i++) {
      const s0 = this.samples[i];
      const s1 = this.samples[(i + 1) % N];
      const corners = [
        s0.pos.clone().addScaledVector(s0.side, -half),
        s0.pos.clone().addScaledVector(s0.side, half),
        s1.pos.clone().addScaledVector(s1.side, half),
        s1.pos.clone().addScaledVector(s1.side, -half),
      ];
      for (const c of corners) c.y += 0.02;
      const geo = new THREE.BufferGeometry();
      const verts = new Float32Array([
        ...corners[0].toArray(),
        ...corners[1].toArray(),
        ...corners[2].toArray(),
        ...corners[0].toArray(),
        ...corners[2].toArray(),
        ...corners[3].toArray(),
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, roadMat);
      this.group.add(mesh);
      this.roadMeshes.push(mesh);

      for (const sign of [-1, 1]) {
        const a = s0.pos.clone().addScaledVector(s0.side, sign * half);
        const b = s1.pos.clone().addScaledVector(s1.side, sign * half);
        a.y += 0.35;
        b.y += 0.35;
        const rail = this.makeBeam(a, b, 0.2, edgeMat);
        this.group.add(rail);
      }
      if (i % 3 === 0) {
        const mid0 = s0.pos.clone();
        mid0.y += 0.06;
        const mid1 = s0.pos.clone().addScaledVector(s0.tangent, 2.2);
        mid1.y += 0.06;
        this.group.add(this.makeBeam(mid0, mid1, 0.12, stripeMat));
      }
    }

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
    const padCount = 10;
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
    for (let i = 0; i < 14; i++) {
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

  buildScenery(def, rnd) {
    for (let i = 0; i < 36; i++) {
      const a = rnd() * Math.PI * 2;
      const r = def.radius * (1.35 + rnd() * 1.1);
      const h = 18 + rnd() * 90;
      const tower = new THREE.Mesh(
        new THREE.BoxGeometry(5 + rnd() * 10, h, 5 + rnd() * 10),
        new THREE.MeshStandardMaterial({
          color: 0x0c0614,
          metalness: 0.55,
          roughness: 0.45,
          emissive: rnd() < 0.5 ? def.rail : def.accent,
          emissiveIntensity: 0.1 + rnd() * 0.12,
        })
      );
      tower.position.set(Math.cos(a) * r, h * 0.45, Math.sin(a) * r);
      this.group.add(tower);
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

    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2;
      const r = def.radius * (1.15 + rnd() * 0.35);
      const h = 12 + rnd() * 28;
      const board = new THREE.Mesh(
        new THREE.BoxGeometry(8 + rnd() * 10, 3 + rnd() * 4, 0.4),
        new THREE.MeshBasicMaterial({
          color: rnd() < 0.5 ? def.rail : def.accent,
          transparent: true,
          opacity: 0.55,
          toneMapped: false,
        })
      );
      board.position.set(Math.cos(a) * r, h, Math.sin(a) * r);
      board.lookAt(0, h, 0);
      this.group.add(board);
    }
    for (let i = 0; i < 6; i++) {
      const idx = Math.floor((i / 6) * this.samples.length) % this.samples.length;
      const s = this.samples[idx];
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(TRACK_HALF_WIDTH * 1.15, 0.12, 6, 36),
        new THREE.MeshBasicMaterial({
          color: def.accent,
          transparent: true,
          opacity: 0.35,
          toneMapped: false,
        })
      );
      ring.position.copy(s.pos);
      ring.position.y += 6;
      ring.lookAt(s.pos.clone().add(s.tangent));
      this.group.add(ring);
    }

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
