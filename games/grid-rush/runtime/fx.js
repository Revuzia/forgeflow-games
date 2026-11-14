import * as THREE from 'three';

/** Particle / flash VFX for Grid Rush */
export class RaceFX {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.rings = [];
    this.shake = 0;
    // Shared geometries for the repeated particle types (trail fires ~25x/s PER
    // racer). Reusing one GPU vertex buffer each — instead of allocating+freeing
    // a BufferGeometry every spawn — removes the per-frame create/dispose churn
    // that was a primary cause of the driving stutter. Tagged so _disposeMesh
    // never frees them.
    this._geoTrail = new THREE.SphereGeometry(0.22, 6, 6);
    this._geoBurst = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    this._geoSpark = new THREE.SphereGeometry(0.08, 4, 4);
    for (const g of [this._geoTrail, this._geoBurst, this._geoSpark]) g.__shared = true;
  }

  clear() {
    for (const p of this.particles) this._disposeMesh(p.mesh);
    for (const r of this.rings) this._disposeMesh(r.mesh);
    this.particles = [];
    this.rings = [];
    this.shake = 0;
  }

  _disposeMesh(mesh) {
    if (!mesh) return;
    this.scene.remove(mesh);
    if (mesh.geometry && !mesh.geometry.__shared) mesh.geometry.dispose();
    if (mesh.material) {
      if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
      else mesh.material.dispose();
    }
  }

  burst(pos, color = 0x00f0ff, count = 14, speed = 12) {
    const col = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        this._geoBurst,
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95, toneMapped: false })
      );
      mesh.position.copy(pos);
      mesh.position.y += 0.4;
      this.scene.add(mesh);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * speed,
        Math.random() * speed * 0.7,
        (Math.random() - 0.5) * speed
      );
      this.particles.push({ mesh, vel, life: 0.45 + Math.random() * 0.35, max: 0.8 });
    }
  }

  sparks(pos, forward, color = 0xffe566, count = 6) {
    const col = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        this._geoSpark,
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, toneMapped: false })
      );
      mesh.position.copy(pos);
      mesh.position.y += 0.15;
      this.scene.add(mesh);
      const vel = forward
        .clone()
        .multiplyScalar(-4 - Math.random() * 8)
        .add(new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6));
      this.particles.push({ mesh, vel, life: 0.25 + Math.random() * 0.2, max: 0.5 });
    }
  }

  trail(pos, color = 0xff6622) {
    const mesh = new THREE.Mesh(
      this._geoTrail,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        toneMapped: false,
      })
    );
    mesh.position.copy(pos);
    mesh.position.y += 0.2;
    this.scene.add(mesh);
    this.particles.push({
      mesh,
      vel: new THREE.Vector3(0, 0.4, 0),
      life: 0.28,
      max: 0.28,
      scaleDown: true,
    });
  }

  empRing(pos, color = 0xff2bd6) {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(1.2, 0.12, 6, 32),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        toneMapped: false,
        depthWrite: false,
      })
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(pos);
    mesh.position.y += 0.6;
    this.scene.add(mesh);
    this.rings.push({ mesh, life: 0.55, max: 0.55, grow: 28 });
  }

  lashBolt(from, to, color = 0xffe566) {
    const mid = from.clone().lerp(to, 0.5);
    mid.y += 1.5;
    const dir = to.clone().sub(from);
    const len = dir.length();
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, Math.max(0.5, len), 5),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, toneMapped: false })
    );
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.position.y += 0.8;
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    this.scene.add(mesh);
    this.particles.push({ mesh, vel: new THREE.Vector3(0, 2, 0), life: 0.18, max: 0.18 });
    this.burst(to, color, 10, 10);
  }

  addShake(amount = 0.35) {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.y -= 6 * dt;
      const t = Math.max(0, p.life / p.max);
      p.mesh.material.opacity = t * 0.95;
      if (p.scaleDown) p.mesh.scale.setScalar(0.4 + t * 0.9);
      if (p.life <= 0) {
        this._disposeMesh(p.mesh);
        this.particles.splice(i, 1);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const t = 1 - r.life / r.max;
      const s = 1 + t * r.grow;
      r.mesh.scale.set(s, s, s);
      r.mesh.material.opacity = Math.max(0, 1 - t);
      if (r.life <= 0) {
        this._disposeMesh(r.mesh);
        this.rings.splice(i, 1);
      }
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }

  applyCameraShake(camera) {
    if (this.shake <= 0) return;
    const a = this.shake * 0.35;
    camera.position.x += (Math.random() - 0.5) * a;
    camera.position.y += (Math.random() - 0.5) * a * 0.6;
  }
}
