import * as THREE from 'three';

/**
 * Procedural original hover chassis — distinct silhouettes, nose = +Z (travel dir).
 * Not Neon Veil starfighters, not Mario karts.
 *
 * Each of the six shapes reads clearly from its own outline:
 *   sled  — long flat deck, twin full-length rails, faceted prism nose
 *   bike  — narrow spine, big outboard nacelles, forward prong
 *   razor — ultra-thin swept delta blade, needle nose
 *   tank  — heavy armored hull, twin tread pods, segmented drill
 *   wedge — angular courier arrow, side cargo pods
 *   disc  — saucer hull, dome cockpit, neon spin rings, radial vents
 *
 * Neon language: dark metal hull + emissive edge lines (def.color), bright
 * accent strips, additive underglow bar, and the shared rear thruster glow.
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
  // Emissive neon edge lines traced along the faceted hull pieces.
  const lineMain = new THREE.LineBasicMaterial({ color: def.color, toneMapped: false });
  const lineAcc = new THREE.LineBasicMaterial({ color: def.accent, toneMapped: false });

  switch (def.shape) {
    case 'bike': {
      // Volt runner — slim central spine, big outboard engines, forward prong
      body.add(eBox(0.5, 0.3, 3.6, hull, lineMain, 0, 0.32, 0.1));       // spine
      body.add(box(0.6, 0.09, 2.6, neon, 0, 0.46, 0.1));                 // dorsal light strip
      body.add(eBox(0.44, 0.5, 1.0, hull, lineMain, 0, 0.58, 0.7));      // rear cowl
      body.add(eBox(0.4, 0.16, 0.7, glass, lineAcc, 0, 0.74, 0.1));      // canopy slit
      // forward fork prong
      body.add(eCone(0.16, 1.3, 4, accent, lineAcc, 0, 0.36, -2.15, -Math.PI / 2));
      body.add(box(0.2, 0.14, 1.0, neon, 0, 0.36, -1.55));              // prong rail
      // twin outboard engine nacelles on thin arms
      for (const x of [-0.8, 0.8]) {
        body.add(box(0.62, 0.06, 0.5, dark, x * 0.55, 0.3, 0.2));       // connecting arm
        body.add(cyl(0.2, 1.7, hull, x, 0.22, 0.3, Math.PI / 2));       // nacelle
        body.add(cyl(0.23, 0.28, neon, x, 0.22, 1.28, Math.PI / 2));    // intake glow ring
        body.add(box(0.06, 0.34, 1.3, neon, x, 0.44, 0.2));            // stabilizer fin
      }
      break;
    }
    case 'razor': {
      // Glass phantom — ultra-thin swept delta blade
      body.add(eBox(0.7, 0.12, 3.0, hull, lineMain, 0, 0.3, 0));         // center spine
      for (const s of [-1, 1]) {                                         // swept wings
        body.add(eBox(1.8, 0.06, 1.5, hull, lineMain, s * 1.02, 0.3, 0.45, [0, s * -0.42, 0]));
        body.add(box(0.06, 0.26, 0.85, neon, s * 1.82, 0.42, 0.72));    // wingtip fin
      }
      body.add(box(2.6, 0.04, 0.12, neon, 0, 0.34, 0.98));              // trailing-edge glow
      body.add(box(1.5, 0.05, 1.1, accent, 0, 0.34, 0.2));             // upper blade accent
      body.add(eBox(0.42, 0.2, 0.9, glass, lineAcc, 0, 0.46, -0.4));    // low canopy
      body.add(eCone(0.18, 1.5, 3, accent, lineAcc, 0, 0.32, -1.95, -Math.PI / 2)); // needle nose
      break;
    }
    case 'tank': {
      // Mag-drill — heavy armored hull, twin tread pods, segmented drill
      body.add(eBox(2.3, 0.7, 2.9, hull, lineMain, 0, 0.46, 0.1));       // core hull
      body.add(eBox(2.5, 0.2, 2.4, dark, lineAcc, 0, 0.14, 0.15));       // skirt
      body.add(box(2.0, 0.07, 2.2, neon, 0, 0.11, 0.15));               // under-skirt glow
      body.add(eBox(1.4, 0.42, 1.1, glass, lineAcc, 0, 0.92, -0.35));    // cockpit
      // twin mag-tread pods
      for (const x of [-1.28, 1.28]) {
        body.add(eBox(0.5, 0.55, 2.6, dark, lineAcc, x, 0.34, 0.1));
        body.add(box(0.55, 0.09, 2.4, accent, x, 0.63, 0.1));          // tread glow strip
      }
      // big segmented drill nose (two stacked cones + collar)
      body.add(eCone(0.52, 1.0, 8, hull, lineMain, 0, 0.42, -1.65, -Math.PI / 2));
      body.add(eCone(0.36, 0.95, 8, neon, lineMain, 0, 0.42, -2.2, -Math.PI / 2));
      body.add(cyl(0.54, 0.36, accent, 0, 0.42, -1.3, Math.PI / 2));    // drill collar
      break;
    }
    case 'wedge': {
      // Echo wedge — angular courier arrow with side cargo pods
      body.add(eCone(1.25, 3.6, 4, hull, lineMain, 0, 0.42, 0.05, -Math.PI / 2));
      body.add(box(1.7, 0.08, 1.9, accent, 0, 0.16, 0.5));             // belly plate
      body.add(box(0.14, 0.16, 2.8, neon, 0, 0.62, 0.1));              // dorsal spine glow
      body.add(eBox(0.72, 0.26, 0.8, glass, lineAcc, 0, 0.66, -0.4));   // canopy
      for (const x of [-1.0, 1.0]) {                                    // side cargo pods
        body.add(eBox(0.5, 0.4, 1.4, dark, lineAcc, x, 0.3, 0.65));
        body.add(box(0.54, 0.06, 1.3, neon, x, 0.51, 0.65));          // pod light strip
      }
      body.add(box(1.3, 0.05, 2.0, neon, 0, 0.08, 0.3));              // underglow bar
      break;
    }
    case 'disc': {
      // Nova disc — saucer hull, dome cockpit, neon spin rings, radial vents
      body.add(cyl(1.5, 0.24, hull, 0, 0.3, 0, 0));                    // lower saucer
      body.add(cyl(1.14, 0.34, hull, 0, 0.5, 0, 0));                   // upper saucer
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.6, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        glass
      );
      dome.position.set(0, 0.6, 0);
      body.add(dome);
      body.add(torus(1.62, 0.1, neon, 0, 0.3, 0));                     // outer spin ring
      body.add(torus(1.18, 0.05, accent, 0, 0.56, 0));                 // inner ring
      body.add(torus(1.36, 0.06, neon, 0, 0.1, 0));                    // low underglow ring
      for (let i = 0; i < 6; i++) {                                    // radial vents
        const a = (i / 6) * Math.PI * 2;
        const spoke = box(0.09, 0.07, 0.82, neon, Math.sin(a) * 0.96, 0.45, Math.cos(a) * 0.96);
        spoke.rotation.y = a;
        body.add(spoke);
      }
      body.add(box(0.14, 0.46, 1.0, accent, 0, 0.56, -1.0));          // direction fin (nose)
      break;
    }
    case 'sled':
    default: {
      // Prism sled — long low deck, twin full-length rails, faceted prism nose
      body.add(eBox(1.7, 0.3, 2.8, hull, lineMain, 0, 0.34, 0.15));     // main deck
      body.add(eBox(2.2, 0.12, 1.4, hull, lineMain, 0, 0.2, 0.7));      // flared rear deck
      for (const x of [-1.0, 1.0]) {                                    // full-length side rails
        body.add(eBox(0.16, 0.22, 3.0, dark, lineMain, x, 0.27, 0));
        body.add(box(0.2, 0.05, 3.0, neon, x, 0.4, 0));               // bright rail cap
      }
      body.add(box(0.14, 0.12, 2.0, accent, 0, 0.52, 0.05));          // spine ridge
      body.add(eBox(0.86, 0.32, 1.0, glass, lineAcc, 0, 0.6, -0.5));   // canopy
      body.add(eCone(0.66, 1.7, 4, hull, lineMain, 0, 0.36, -1.95, -Math.PI / 2)); // prism nose
      body.add(box(0.12, 0.14, 1.1, neon, 0, 0.5, -1.55));           // nose ridge accent
      body.add(box(1.3, 0.05, 2.3, neon, 0, 0.08, 0.15));           // underglow bar
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

/**
 * Box with emissive neon edge lines traced along it.
 * `rot` (optional) is an [x, y, z] Euler triple for angled panels (e.g. swept wings).
 */
function eBox(w, h, d, mat, lineMat, x, y, z, rot) {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(w, h, d);
  g.add(new THREE.Mesh(geo, mat));
  if (lineMat) g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), lineMat));
  g.position.set(x, y, z);
  if (rot) g.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  return g;
}

/**
 * Faceted cone with emissive edge lines; `rotX` orients the axis
 * (-Math.PI/2 points the tip toward -Z = the authored nose direction).
 */
function eCone(r, h, seg, mat, lineMat, x, y, z, rotX = 0) {
  const g = new THREE.Group();
  const geo = new THREE.ConeGeometry(r, h, seg);
  g.add(new THREE.Mesh(geo, mat));
  if (lineMat) g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), lineMat));
  g.position.set(x, y, z);
  g.rotation.x = rotX;
  return g;
}

export function setBoostVisual(mesh, amount) {
  for (const m of mesh.userData.thrusterMats || []) {
    m.color.setHSL(0.08, 1, 0.35 + amount * 0.45);
  }
  if (mesh.userData.glow) {
    mesh.userData.glow.material.opacity = 0.1 + amount * 0.18;
  }
}
