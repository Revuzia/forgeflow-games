import * as THREE from 'three';

/**
 * Procedural original hover chassis — distinct silhouettes, nose = +Z (travel dir).
 * Not Neon Veil starfighters, not Mario karts.
 */
export function buildVehicleMesh(def) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const hull = new THREE.MeshStandardMaterial({
    color: 0x14101c,
    metalness: 0.72,
    roughness: 0.32,
    emissive: def.color,
    emissiveIntensity: 0.22,
  });
  const neon = new THREE.MeshBasicMaterial({ color: def.color, toneMapped: false });
  const accent = new THREE.MeshBasicMaterial({ color: def.accent, toneMapped: false });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x224466,
    metalness: 0.15,
    roughness: 0.12,
    transparent: true,
    opacity: 0.45,
    emissive: def.color,
    emissiveIntensity: 0.18,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x08060e,
    metalness: 0.85,
    roughness: 0.25,
    emissive: def.accent,
    emissiveIntensity: 0.08,
  });

  switch (def.shape) {
    case 'bike': {
      // Slim thruster bike — long spine, outboard engines
      body.add(box(0.55, 0.28, 3.8, hull, 0, 0.28, 0.1));
      body.add(box(0.4, 0.55, 1.1, hull, 0, 0.55, -0.6));
      body.add(box(0.7, 0.1, 1.4, neon, 0, 0.42, 0.4));
      body.add(box(0.45, 0.12, 0.7, glass, 0, 0.72, -1.1));
      // fork nose
      body.add(box(0.25, 0.18, 0.9, accent, 0, 0.35, -1.7));
      for (const x of [-0.72, 0.72]) {
        body.add(cyl(0.14, 1.6, neon, x, 0.18, 0.35, Math.PI / 2));
        body.add(cyl(0.2, 0.35, dark, x, 0.18, 1.55, Math.PI / 2));
      }
      break;
    }
    case 'razor': {
      // Ultra-thin delta wing
      body.add(box(1.5, 0.18, 3.0, hull, 0, 0.28, 0));
      {
        const wingGeo = new THREE.ConeGeometry(0.12, 2.6, 3);
        const w1 = new THREE.Mesh(wingGeo, hull);
        w1.rotation.z = Math.PI / 2;
        w1.rotation.y = 0.25;
        w1.position.set(1.5, 0.28, 0.2);
        body.add(w1);
        const w2 = w1.clone();
        w2.position.x = -1.5;
        w2.rotation.z = -Math.PI / 2;
        body.add(w2);
      }
      body.add(box(0.85, 0.06, 1.4, accent, 0, 0.4, -0.1));
      body.add(box(0.5, 0.2, 0.9, glass, 0, 0.45, -0.85));
      body.add(box(0.15, 0.35, 0.15, neon, 0, 0.55, -1.55));
      break;
    }
    case 'tank': {
      // Heavy mag-drill chassis
      body.add(box(2.5, 0.75, 3.1, hull, 0, 0.4, 0));
      body.add(box(2.7, 0.22, 2.5, dark, 0, 0.12, 0.15));
      body.add(box(1.3, 0.4, 1.15, glass, 0, 0.85, -0.45));
      // drill nose
      const drill = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.4, 8), neon);
      drill.rotation.x = Math.PI / 2;
      drill.position.set(0, 0.35, -1.85);
      body.add(drill);
      for (const x of [-1.15, 1.15]) {
        body.add(cyl(0.32, 0.9, accent, x, 0.22, 1.2, 0));
        body.add(box(0.45, 0.18, 2.2, dark, x, 0.08, 0));
      }
      break;
    }
    case 'wedge': {
      // Angular courier wedge
      const geo = new THREE.ConeGeometry(1.35, 3.6, 4);
      const m = new THREE.Mesh(geo, hull);
      m.rotation.x = Math.PI / 2;
      m.position.set(0, 0.4, 0.1);
      body.add(m);
      body.add(box(1.9, 0.1, 1.7, accent, 0, 0.18, 0.35));
      body.add(box(0.7, 0.25, 0.8, glass, 0, 0.7, -0.5));
      body.add(box(1.2, 0.08, 0.08, neon, 0, 0.55, -1.2));
      break;
    }
    case 'disc': {
      // Spin-stable disc skimmer
      body.add(cyl(1.55, 0.32, hull, 0, 0.28, 0, 0));
      body.add(cyl(0.95, 0.48, glass, 0, 0.5, 0, 0));
      body.add(torus(1.75, 0.09, neon, 0, 0.22, 0));
      body.add(torus(1.15, 0.05, accent, 0, 0.55, 0));
      // directional fin
      body.add(box(0.12, 0.45, 1.2, accent, 0, 0.55, -0.9));
      break;
    }
    case 'sled':
    default: {
      // Balanced prism sled — flat deck, twin rails
      body.add(box(1.95, 0.38, 3.4, hull, 0, 0.3, 0));
      body.add(box(2.45, 0.1, 1.3, hull, 0, 0.18, 0.45));
      body.add(box(1.05, 0.38, 1.15, glass, 0, 0.62, -0.55));
      body.add(box(2.25, 0.06, 0.1, neon, 0, 0.4, 0.15));
      body.add(box(0.12, 0.12, 2.6, accent, 0.95, 0.22, 0));
      body.add(box(0.12, 0.12, 2.6, accent, -0.95, 0.22, 0));
      // prism nose
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 4), neon);
      nose.rotation.x = Math.PI / 2;
      nose.position.set(0, 0.32, -1.85);
      body.add(nose);
      body.add(box(0.35, 0.22, 0.7, accent, 0.85, 0.25, 1.35));
      body.add(box(0.35, 0.22, 0.7, accent, -0.85, 0.25, 1.35));
      break;
    }
  }

  // Rear thrusters (local -Z after face-fix so travel is +Z)
  const thrusterMats = [];
  for (const x of [-0.65, 0.65]) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xff6622, toneMapped: false });
    thrusterMats.push(mat);
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.4, 8), mat);
    t.rotation.x = Math.PI / 2;
    t.position.set(x, 0.14, 1.65);
    body.add(t);
  }
  // center thruster glow
  {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffaa44, toneMapped: false });
    thrusterMats.push(mat);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), mat);
    core.position.set(0, 0.18, 1.75);
    body.add(core);
  }

  // Soft underglow
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(1.15, 12, 8),
    new THREE.MeshBasicMaterial({
      color: def.color,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      toneMapped: false,
    })
  );
  glow.position.y = -0.12;
  glow.scale.set(1.45, 0.32, 1.7);
  group.add(glow);

  // Models are authored with nose toward -Z; flip so nose = +Z = travel
  body.rotation.y = Math.PI;

  group.userData.thrusterMats = thrusterMats;
  group.userData.body = body;
  group.userData.glow = glow;
  group.userData.def = def;
  return group;
}

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

function cyl(r, h, mat, x, y, z, rotX = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), mat);
  m.position.set(x, y, z);
  m.rotation.x = rotX;
  return m;
}

function torus(r, tube, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 24), mat);
  m.position.set(x, y, z);
  m.rotation.x = Math.PI / 2;
  return m;
}

export function setBoostVisual(mesh, amount) {
  for (const m of mesh.userData.thrusterMats || []) {
    m.color.setHSL(0.08, 1, 0.35 + amount * 0.45);
  }
  if (mesh.userData.glow) {
    mesh.userData.glow.material.opacity = 0.1 + amount * 0.18;
  }
}
