import * as THREE from 'three';

interface Explosion {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
}

interface Spark {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
}

export class Effects {
  private scene: THREE.Scene;
  private pool: Explosion[] = [];
  private active: Explosion[] = [];
  private sparks: Spark[] = [];
  private sparkPool: Spark[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    for (let i = 0; i < 28; i++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 8, 8),
        new THREE.MeshBasicMaterial({
          color: 0xff6622,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        })
      );
      mesh.visible = false;
      scene.add(mesh);
      this.pool.push({ mesh, life: 0, maxLife: 0.4 });
    }
    for (let i = 0; i < 64; i++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.25, 0.25, 0.25),
        new THREE.MeshBasicMaterial({
          color: 0xffe566,
          transparent: true,
          opacity: 1,
          depthWrite: false,
        })
      );
      mesh.visible = false;
      scene.add(mesh);
      this.sparkPool.push({ mesh, vel: new THREE.Vector3(), life: 0 });
    }
  }

  explode(pos: THREE.Vector3, scale = 1, color = 0xff6622) {
    const e = this.pool.pop() || this.active.shift();
    if (!e) return;
    e.mesh.visible = true;
    e.mesh.position.copy(pos);
    e.mesh.scale.setScalar(0.5 * scale);
    (e.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    (e.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95;
    e.life = 0.45;
    e.maxLife = 0.45;
    this.active.push(e);
    this.burstSparks(pos, color, Math.min(14, 6 + Math.floor(scale * 4)));
  }

  /** Small impact spark at hit location. */
  hitSpark(pos: THREE.Vector3, color = 0x00f0ff) {
    this.burstSparks(pos, color, 6);
    const e = this.pool.pop();
    if (!e) return;
    e.mesh.visible = true;
    e.mesh.position.copy(pos);
    e.mesh.scale.setScalar(0.35);
    (e.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    (e.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9;
    e.life = 0.18;
    e.maxLife = 0.18;
    this.active.push(e);
  }

  private burstSparks(pos: THREE.Vector3, color: number, n: number) {
    for (let i = 0; i < n; i++) {
      const s = this.sparkPool.pop();
      if (!s) break;
      s.mesh.visible = true;
      s.mesh.position.copy(pos);
      (s.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
      s.vel.set(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).normalize().multiplyScalar(12 + Math.random() * 28);
      s.life = 0.25 + Math.random() * 0.25;
      this.sparks.push(s);
    }
  }

  update(dt: number) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      e.life -= dt;
      const t = 1 - e.life / e.maxLife;
      e.mesh.scale.setScalar((0.5 + t * 4) * (e.maxLife < 0.25 ? 0.6 : 1));
      (e.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t);
      if (e.life <= 0) {
        e.mesh.visible = false;
        this.active.splice(i, 1);
        this.pool.push(e);
      }
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.vel.y -= 18 * dt;
      s.mesh.scale.setScalar(Math.max(0.1, s.life * 3));
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, s.life * 3);
      if (s.life <= 0) {
        s.mesh.visible = false;
        this.sparks.splice(i, 1);
        this.sparkPool.push(s);
      }
    }
  }

  dispose() {
    for (const e of [...this.pool, ...this.active]) {
      this.scene.remove(e.mesh);
      e.mesh.geometry.dispose();
      (e.mesh.material as THREE.Material).dispose();
    }
    for (const s of [...this.sparkPool, ...this.sparks]) {
      this.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    }
  }
}
