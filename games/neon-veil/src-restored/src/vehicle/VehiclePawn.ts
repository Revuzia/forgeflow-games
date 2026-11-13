import * as THREE from 'three';

/** Selectable ship silhouettes. 'interceptor' reproduces the original craft. */
export type HullType = 'interceptor' | 'gunship' | 'striker';

/** Low-poly hover craft nose visible in cockpit + third-person body for others. */
export class VehiclePawn {
  group = new THREE.Group();
  body: THREE.Group;
  shieldMesh: THREE.Mesh;
  /** Which silhouette this pawn was built with. */
  readonly hullType: HullType;
  private thrusterMats: THREE.MeshBasicMaterial[] = [];

  constructor(color = 0x00f0ff, isLocal = false, hullType: HullType = 'interceptor') {
    this.hullType = hullType;
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

    // Build the chosen silhouette (each returns its shield-bubble radius).
    let shieldRadius: number;
    switch (hullType) {
      case 'gunship':
        shieldRadius = this.buildGunship(hullMat, neonMat, glassMat);
        break;
      case 'striker':
        shieldRadius = this.buildStriker(hullMat, neonMat, glassMat);
        break;
      case 'interceptor':
      default:
        shieldRadius = this.buildInterceptor(hullMat, neonMat, glassMat);
        break;
    }

    // Cockpit hood (only for local — sits just below camera). Shared across hulls.
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

    // Shield bubble (sized to the hull it wraps)
    this.shieldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(shieldRadius, 16, 12),
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

  // ---- Shared low-poly builders -------------------------------------------

  private addThruster(geo: THREE.CylinderGeometry, x: number, y: number, z: number) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xff6622 });
    this.thrusterMats.push(mat);
    const t = new THREE.Mesh(geo, mat);
    t.rotation.x = Math.PI / 2;
    t.position.set(x, y, z);
    this.body.add(t);
  }

  private addCanopy(
    glassMat: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    radius = 0.55
  ) {
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
      glassMat
    );
    canopy.position.set(x, y, z);
    canopy.scale.set(sx, sy, sz);
    this.body.add(canopy);
  }

  // ---- Hull silhouettes ----------------------------------------------------

  /** Original craft — sleek balanced fighter. Default look, unchanged. */
  private buildInterceptor(
    hullMat: THREE.Material,
    neonMat: THREE.Material,
    glassMat: THREE.Material
  ): number {
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
    this.addCanopy(glassMat, 0, 0.25, -0.3, 1.1, 0.7, 1.4, 0.55);

    // Wings
    const wing = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.08, 1.1), hullMat);
    wing.position.set(0, -0.2, 0.4);
    this.body.add(wing);

    // Neon edge strips
    const stripL = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.04, 0.06), neonMat);
    stripL.position.set(0, -0.15, 0.4);
    this.body.add(stripL);

    // Thrusters
    const thrusterGeo = new THREE.CylinderGeometry(0.18, 0.25, 0.4, 8);
    this.addThruster(thrusterGeo, -0.55, -0.1, 1.7);
    this.addThruster(thrusterGeo, 0.55, -0.1, 1.7);

    return 2.4;
  }

  /** Heavy, broad-shouldered assault hull — armored spine, twin cannons, quad engines. */
  private buildGunship(
    hullMat: THREE.Material,
    neonMat: THREE.Material,
    glassMat: THREE.Material
  ): number {
    // Broad heavy hull
    const hull = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.8, 3.2), hullMat);
    hull.position.y = -0.1;
    this.body.add(hull);

    // Raised armored spine for bulk
    const spine = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 2.2), hullMat);
    spine.position.set(0, 0.35, 0.2);
    this.body.add(spine);

    // Blunt short nose
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.85, 1.0, 6), hullMat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, -0.05, -1.9);
    this.body.add(nose);

    // Twin forward cannon barrels with neon muzzle rings
    const barrelGeo = new THREE.CylinderGeometry(0.12, 0.12, 2.0, 6);
    for (const x of [-0.95, 0.95]) {
      const barrel = new THREE.Mesh(barrelGeo, hullMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(x, -0.15, -1.6);
      this.body.add(barrel);

      const ring = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.12), neonMat);
      ring.position.set(x, -0.15, -2.6);
      this.body.add(ring);
    }

    // Cockpit sits up on the spine
    this.addCanopy(glassMat, 0, 0.6, -0.35, 1.2, 0.75, 1.3, 0.6);

    // Heavy stub wing plus outboard engine pods
    const wing = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.18, 1.5), hullMat);
    wing.position.set(0, -0.2, 0.55);
    this.body.add(wing);
    for (const x of [-1.5, 1.5]) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 1.6), hullMat);
      pod.position.set(x, -0.15, 0.6);
      this.body.add(pod);
    }

    // Neon strip along the wing
    const strip = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.05, 0.08), neonMat);
    strip.position.set(0, -0.1, 0.0);
    this.body.add(strip);

    // Four big thrusters (behind the pods)
    const thrusterGeo = new THREE.CylinderGeometry(0.24, 0.32, 0.55, 8);
    for (const x of [-1.5, -0.55, 0.55, 1.5]) {
      this.addThruster(thrusterGeo, x, -0.1, 1.75);
    }

    return 2.9;
  }

  /** Slim, aggressive dart — long needle nose, canards, forward-swept wings. */
  private buildStriker(
    hullMat: THREE.Material,
    neonMat: THREE.Material,
    glassMat: THREE.Material
  ): number {
    // Slim long fuselage
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.42, 3.8), hullMat);
    hull.position.y = -0.1;
    this.body.add(hull);

    // Long sharp needle nose
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.4, 2.0, 6), hullMat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.set(0, -0.08, -2.7);
    this.body.add(nose);

    // Forward canards (swept back)
    for (const x of [-0.8, 0.8]) {
      const canard = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.5), hullMat);
      canard.position.set(x, -0.05, -1.4);
      canard.rotation.y = x < 0 ? 0.35 : -0.35;
      this.body.add(canard);
    }

    // Narrow forward-set canopy
    this.addCanopy(glassMat, 0, 0.18, -0.7, 0.85, 0.6, 1.7, 0.48);

    // Forward-swept main wings, each angled, with a neon leading strip
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.06, 1.0), hullMat);
      wing.position.set(side * 1.15, -0.12, 0.2);
      wing.rotation.y = side * -0.5; // forward sweep
      wing.rotation.z = side * 0.18; // dihedral
      this.body.add(wing);

      const strip = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.05, 0.06), neonMat);
      strip.position.set(side * 1.15, -0.09, -0.15);
      strip.rotation.y = side * -0.5;
      strip.rotation.z = side * 0.18;
      this.body.add(strip);
    }

    // Twin close-set thrusters
    const thrusterGeo = new THREE.CylinderGeometry(0.16, 0.22, 0.45, 8);
    this.addThruster(thrusterGeo, -0.35, -0.08, 1.95);
    this.addThruster(thrusterGeo, 0.35, -0.08, 1.95);

    return 2.6;
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
