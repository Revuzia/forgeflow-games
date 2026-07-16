import * as THREE from 'three';

/** Low-poly hover craft nose visible in cockpit + third-person body for others. */
export class VehiclePawn {
  group = new THREE.Group();
  body: THREE.Group;
  shieldMesh: THREE.Mesh;
  private thrusterMats: THREE.MeshBasicMaterial[] = [];

  constructor(color = 0x00f0ff, isLocal = false) {
    this.body = new THREE.Group();
    this.group.add(this.body);

    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x1a1028,
      metalness: 0.7,
      roughness: 0.35,
      emissive: color,
      emissiveIntensity: 0.15,
    });
    const neonMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x224466,
      metalness: 0.2,
      roughness: 0.1,
      transparent: true,
      opacity: 0.45,
      emissive: 0x113355,
      emissiveIntensity: 0.3,
    });

    // Main hull
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.55, 3.4), hullMat);
    hull.position.y = -0.15;
    this.body.add(hull);

    // Nose
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.4, 6), hullMat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, -0.1, -2.1);
    this.body.add(nose);

    // Cockpit canopy
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), glassMat);
    canopy.position.set(0, 0.25, -0.3);
    canopy.scale.set(1.1, 0.7, 1.4);
    this.body.add(canopy);

    // Wings
    const wingGeo = new THREE.BoxGeometry(3.6, 0.08, 1.1);
    const wing = new THREE.Mesh(wingGeo, hullMat);
    wing.position.set(0, -0.2, 0.4);
    this.body.add(wing);

    // Neon edge strips
    const stripGeo = new THREE.BoxGeometry(3.5, 0.04, 0.06);
    const stripL = new THREE.Mesh(stripGeo, neonMat);
    stripL.position.set(0, -0.15, 0.4);
    this.body.add(stripL);

    // Thrusters
    const thrusterGeo = new THREE.CylinderGeometry(0.18, 0.25, 0.4, 8);
    for (const x of [-0.55, 0.55]) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xff6622 });
      this.thrusterMats.push(mat);
      const t = new THREE.Mesh(thrusterGeo, mat);
      t.rotation.x = Math.PI / 2;
      t.position.set(x, -0.1, 1.7);
      this.body.add(t);
    }

    // Cockpit hood (only for local — sits just below camera)
    if (isLocal) {
      const hood = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 0.12, 1.2),
        new THREE.MeshStandardMaterial({
          color: 0x12081c,
          metalness: 0.8,
          roughness: 0.3,
          emissive: color,
          emissiveIntensity: 0.2,
        })
      );
      hood.position.set(0, -0.55, -0.9);
      this.group.add(hood);

      const dash = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 0.08, 0.5),
        new THREE.MeshBasicMaterial({ color: 0x00aacc })
      );
      dash.position.set(0, -0.48, -0.5);
      this.group.add(dash);

      // Hide full body for local cockpit (keep thrusters feeling)
      this.body.visible = false;
      hood.visible = true;
      dash.visible = true;
    }

    // Shield bubble
    this.shieldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(2.4, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.18,
        wireframe: true,
        depthWrite: false,
      })
    );
    this.shieldMesh.visible = false;
    this.group.add(this.shieldMesh);
  }

  setTransform(pos: THREE.Vector3, quat: THREE.Quaternion) {
    this.group.position.copy(pos);
    this.group.quaternion.copy(quat);
  }

  setBoost(amount: number) {
    for (const m of this.thrusterMats) {
      m.color.setHSL(0.08, 1, 0.4 + amount * 0.4);
    }
  }

  setShield(active: boolean) {
    this.shieldMesh.visible = active;
    if (active) {
      const mat = this.shieldMesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.22 + Math.sin(performance.now() * 0.01) * 0.05;
    }
  }

  setColor(hex: number) {
    this.body.traverse((c) => {
      if ((c as THREE.Mesh).isMesh) {
        const m = (c as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (m.emissive) m.emissive.setHex(hex);
      }
    });
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        const mat = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat.dispose();
      }
    });
  }
}
