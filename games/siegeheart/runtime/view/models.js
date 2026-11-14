// Bastion Realms: Stronghold — the complete procedural model library.
// Every tower, enemy, boss and bastion is an original composed build. No model
// files are loaded anywhere in this game.
import * as THREE from 'three';

// ---------- material + part helpers ----------
const matCache = new Map();
export function M(color, { rough = 0.8, metal = 0, emissive = 0, ei = 0.8, flat = true, trans = 0, fog = true } = {}) {
  const key = [color, rough, metal, emissive, ei, flat, trans].join('|');
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: metal, flatShading: flat,
    emissive: emissive || 0x000000, emissiveIntensity: emissive ? ei : 0,
    transparent: trans > 0, opacity: trans > 0 ? trans : 1, fog,
  });
  matCache.set(key, m);
  return m;
}
function mesh(geo, mat, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  return m;
}
const Box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const Cyl = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);
const Cone = (r, h, s = 8) => new THREE.ConeGeometry(r, h, s);
const Sph = (r, s = 10) => new THREE.SphereGeometry(r, s, Math.max(6, s - 2));
const Tor = (r, t, s = 8, ts = 20) => new THREE.TorusGeometry(r, t, s, ts);
const Oct = (r) => new THREE.OctahedronGeometry(r);
const Tet = (r) => new THREE.TetrahedronGeometry(r);

// palettes
const IRON = 0x5a6068, IRON_D = 0x3c4048, BRONZE = 0xb08040, BRONZE_D = 0x7a5626,
  WOOD = 0x7a5a34, WOOD_D = 0x54391e, STONE = 0x9a948a, STONE_D = 0x6f6a60,
  GOLD = 0xd8b04a, CRIMSON = 0xa02a30;

// =====================================================================
// TOWERS
// =====================================================================
function baseSocket(lvl, r = 0.75, color = STONE) {
  const g = new THREE.Group();
  g.add(mesh(Cyl(r * 1.05, r * 1.2, 0.28, 8), M(STONE_D), 0, 0.14, 0));
  g.add(mesh(Cyl(r * 0.92, r * 1.05, 0.42, 8), M(color), 0, 0.48, 0));
  const trim = mesh(Tor(r * 0.9, 0.045, 6, 18), M(lvl === 2 ? GOLD : lvl === 1 ? 0xc0c8d4 : IRON, { metal: 0.8, rough: 0.35 }), 0, 0.7, 0);
  trim.rotation.x = Math.PI / 2;
  g.add(trim);
  return g;
}

const towerBuilders = {
  ballista(lvl) {
    const g = new THREE.Group();
    g.add(baseSocket(lvl, 0.8));
    g.add(mesh(Cyl(0.5, 0.62, 0.5, 6), M(WOOD_D), 0, 0.95, 0));
    const head = new THREE.Group();
    head.position.y = 1.3;
    head.add(mesh(Box(0.34, 0.22, 1.7), M(WOOD), 0, 0, -0.1));           // stock rail
    for (const s of [-1, 1]) {
      const arm = mesh(Box(0.1, 0.16, 0.95), M(WOOD_D), s * 0.5, 0.05, 0.42);
      arm.rotation.y = s * 0.7;
      head.add(arm);
      head.add(mesh(Cyl(0.05, 0.05, 0.3, 6), M(IRON, { metal: 0.7 }), s * 0.28, 0.02, 0.2));
    }
    // bolt
    head.add(mesh(Cyl(0.045, 0.045, 1.5, 6), M(IRON, { metal: 0.7, rough: 0.4 }), 0, 0.12, 0.1)).children;
    head.children[head.children.length - 1].rotation.x = Math.PI / 2;
    head.add(mesh(Cone(0.09, 0.28, 6), M(lvl === 2 ? GOLD : IRON, { metal: 0.8 }), 0, 0.12, 0.95)).children;
    head.children[head.children.length - 1].rotation.x = Math.PI / 2;
    head.add(mesh(Cyl(0.14, 0.14, 0.4, 8), M(WOOD_D), 0, -0.05, -0.75)); // winch drum
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.12, 1.0);
    head.add(muzzle);
    g.add(head);
    g.userData = { head, muzzle, kind: 'ballista' };
    return g;
  },

  spire(lvl) {
    const g = new THREE.Group();
    g.add(baseSocket(lvl, 0.66, 0x6a5a86));
    const h = 1.7 + lvl * 0.4;
    // twisted crystal column: stacked rotated slabs
    for (let i = 0; i < 5; i++) {
      const s = mesh(Box(0.55 - i * 0.07, h / 5 + 0.05, 0.55 - i * 0.07),
        M(0x7a5ab0, { rough: 0.3, emissive: 0x8a5ae0, ei: 0.25 }), 0, 0.8 + (i + 0.5) * h / 5, 0);
      s.rotation.y = i * 0.5;
      g.add(s);
    }
    const orbY = 1.0 + h;
    const orb = mesh(Oct(0.3 + lvl * 0.05), M(0xc89aff, { emissive: 0xb06ae0, ei: 1.6, rough: 0.2 }), 0, orbY, 0);
    g.add(orb);
    const ring = mesh(Tor(0.5, 0.035, 6, 22), M(GOLD, { metal: 0.85, rough: 0.3 }), 0, orbY - 0.3, 0);
    ring.rotation.x = 1.2;
    g.add(ring);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, orbY, 0);
    g.add(muzzle);
    g.userData = { head: null, muzzle, orb, ring, kind: 'spire' };
    return g;
  },

  cauldron(lvl) {
    const g = new THREE.Group();
    g.add(baseSocket(lvl, 0.78));
    // tripod
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const leg = mesh(Cyl(0.05, 0.07, 1.1, 6), M(IRON_D, { metal: 0.6 }), Math.cos(a) * 0.5, 1.2, Math.sin(a) * 0.5);
      leg.rotation.z = Math.cos(a) * 0.35;
      leg.rotation.x = -Math.sin(a) * 0.35;
      g.add(leg);
    }
    const pot = mesh(Sph(0.52, 12), M(0x2e3236, { metal: 0.5, rough: 0.5 }), 0, 1.55, 0);
    pot.scale.y = 0.78;
    g.add(pot);
    g.add(mesh(Cyl(0.54, 0.5, 0.14, 12), M(0x2e3236, { metal: 0.5 }), 0, 1.78, 0));
    // bubbling oil surface
    const oil = mesh(Cyl(0.46, 0.46, 0.04, 12), M(0xff8c28, { emissive: 0xff6a14, ei: 1.5 }), 0, 1.84, 0, false);
    g.add(oil);
    // coals
    g.add(mesh(Cyl(0.4, 0.5, 0.16, 8), M(0xff5a14, { emissive: 0xff4a08, ei: 1.2 }), 0, 0.85, 0, false));
    if (lvl >= 1) g.add(mesh(Cyl(0.06, 0.06, 0.9, 6), M(WOOD_D), 0.62, 1.75, 0)).children;
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 2.0, 0);
    g.add(muzzle);
    g.userData = { head: null, muzzle, oil, kind: 'cauldron' };
    return g;
  },

  thorn(lvl) {
    const g = new THREE.Group();
    // bramble mound across the road cell
    const mound = mesh(Sph(0.62, 8), M(0x3c5a22), 0, 0.18, 0);
    mound.scale.set(1.25, 0.42, 1.25);
    g.add(mound);
    const n = 7 + lvl * 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (i % 2) * 0.3;
      const r = 0.25 + (i % 3) * 0.22;
      const spike = mesh(Cone(0.07, 0.55 + (i % 3) * 0.25 + lvl * 0.12, 5),
        M(0x5f9c34, { emissive: lvl === 2 ? 0x4a8a20 : 0, ei: 0.4 }),
        Math.cos(a) * r, 0.42, Math.sin(a) * r);
      spike.rotation.z = Math.cos(a) * 0.5;
      spike.rotation.x = -Math.sin(a) * 0.5;
      g.add(spike);
    }
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1;
      g.add(mesh(Box(0.08, 0.5, 0.08), M(WOOD_D), Math.cos(a) * 0.55, 0.25, Math.sin(a) * 0.55));
    }
    g.userData = { head: null, muzzle: null, kind: 'thorn' };
    return g;
  },

  crossbow(lvl) {
    const g = new THREE.Group();
    g.add(baseSocket(lvl, 0.7));
    g.add(mesh(Box(0.5, 0.72, 0.5), M(STONE), 0, 1.05, 0));
    const head = new THREE.Group();
    head.position.y = 1.6;
    head.add(mesh(Box(0.2, 0.16, 1.6), M(WOOD), 0, 0, 0.1));
    // bow limbs
    for (const s of [-1, 1]) {
      const limb = mesh(Box(0.85, 0.09, 0.09), M(0x4a3a24), s * 0.46, 0.04, 0.62);
      limb.rotation.y = -s * 0.35;
      head.add(limb);
    }
    head.add(mesh(Cyl(0.035, 0.035, 1.35, 6), M(IRON, { metal: 0.8 }), 0, 0.1, 0.35)).children;
    head.children[head.children.length - 1].rotation.x = Math.PI / 2;
    head.add(mesh(Box(0.16, 0.2, 0.34), M(lvl === 2 ? GOLD : IRON_D, { metal: 0.6 }), 0, -0.02, -0.6));
    const scope = mesh(Oct(0.09), M(0xff5040, { emissive: 0xff3020, ei: 1.4 }), 0, 0.18, -0.25);
    head.add(scope);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.1, 1.05);
    head.add(muzzle);
    g.add(head);
    g.userData = { head, muzzle, kind: 'crossbow' };
    return g;
  },

  beacon(lvl) {
    const g = new THREE.Group();
    g.add(baseSocket(lvl, 0.68, 0xb0a884));
    const h = 1.5 + lvl * 0.3;
    g.add(mesh(Cyl(0.22, 0.34, h, 8), M(0xd8ccae), 0, 0.8 + h / 2, 0));
    g.add(mesh(Cyl(0.4, 0.26, 0.18, 8), M(GOLD, { metal: 0.8, rough: 0.3 }), 0, 0.86 + h, 0));
    // sun disc halo
    const halo = mesh(Tor(0.42, 0.05, 8, 26), M(GOLD, { metal: 0.9, rough: 0.25, emissive: 0xffd870, ei: 0.8 }), 0, 1.5 + h, 0);
    g.add(halo);
    const sun = mesh(Sph(0.22 + lvl * 0.04, 12), M(0xffe9a0, { emissive: 0xffd860, ei: 2.0 }), 0, 1.5 + h, 0, false);
    g.add(sun);
    // light pillar
    const pillar = mesh(Cyl(0.16, 0.4, 3.4, 10), new THREE.MeshBasicMaterial({
      color: 0xffe9b0, transparent: true, opacity: 0.16, depthWrite: false, fog: false,
    }), 0, 1.4 + h, 0, false);
    g.add(pillar);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 1.5 + h, 0);
    g.add(muzzle);
    g.userData = { head: null, muzzle, halo, sun, pillar, kind: 'beacon' };
    return g;
  },

  rune(lvl) {
    const g = new THREE.Group();
    const disc = mesh(Cyl(0.78, 0.86, 0.12, 10), M(0x3a4a52), 0, 0.06, 0);
    g.add(disc);
    // glowing sigil
    const sigil = mesh(Tor(0.46, 0.05, 6, 20), M(0x4ac8d8, { emissive: 0x3ab8d0, ei: 1.8 }), 0, 0.14, 0);
    sigil.rotation.x = Math.PI / 2;
    g.add(sigil);
    const inner = mesh(Tor(0.2, 0.04, 6, 14), M(0x8ae8f4, { emissive: 0x5ad8e8, ei: 2.0 }), 0, 0.15, 0);
    inner.rotation.x = Math.PI / 2;
    g.add(inner);
    const stones = 3 + lvl;
    for (let i = 0; i < stones; i++) {
      const a = (i / stones) * Math.PI * 2 + 0.4;
      g.add(mesh(Box(0.14, 0.44 + (i % 2) * 0.14, 0.14), M(0x2e3a42), Math.cos(a) * 0.72, 0.24, Math.sin(a) * 0.72));
    }
    g.userData = { head: null, muzzle: null, sigil, inner, kind: 'rune' };
    return g;
  },

  storm(lvl) {
    const g = new THREE.Group();
    g.add(baseSocket(lvl, 0.7, 0x4a5058));
    const h = 1.4 + lvl * 0.35;
    g.add(mesh(Cyl(0.16, 0.3, h, 6), M(0x30343c, { metal: 0.6, rough: 0.4 }), 0, 0.8 + h / 2, 0));
    const orbY = 1.15 + h;
    // gyroscope rings
    const r1 = mesh(Tor(0.5, 0.04, 6, 22), M(0x86c8e8, { metal: 0.7, rough: 0.3 }), 0, orbY, 0);
    const r2 = mesh(Tor(0.38, 0.035, 6, 20), M(0xb8e0f4, { metal: 0.7, rough: 0.3 }), 0, orbY, 0);
    g.add(r1, r2);
    const orb = mesh(Sph(0.2 + lvl * 0.04, 12), M(0xbfe8ff, { emissive: 0x62b8f0, ei: 2.0, rough: 0.2 }), 0, orbY, 0, false);
    g.add(orb);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const prong = mesh(Cyl(0.02, 0.035, 0.6, 5), M(IRON, { metal: 0.8 }), Math.cos(a) * 0.24, orbY + 0.45, Math.sin(a) * 0.24);
      prong.rotation.z = Math.cos(a) * 0.35;
      prong.rotation.x = -Math.sin(a) * 0.35;
      g.add(prong);
    }
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, orbY, 0);
    g.add(muzzle);
    g.userData = { head: null, muzzle, orb, r1, r2, kind: 'storm' };
    return g;
  },
};

export function buildTowerMesh(type, level) {
  const g = towerBuilders[type](level);
  g.traverse((n) => { if (n.isMesh) n.castShadow = true; });
  g.scale.setScalar(1 + level * 0.13);
  if (level >= 1) {
    const gemMat = M(level === 2 ? 0xffd76a : 0xc8d4e0, { emissive: level === 2 ? 0xffc840 : 0x9ab0c4, ei: 1.4, rough: 0.25 });
    const gems = new THREE.Group();
    const n = level + 1;
    for (let i = 0; i < n; i++) {
      const gem = mesh(Oct(0.09), gemMat, 0, 0, 0, false);
      gem.userData.orbitA = (i / n) * Math.PI * 2;
      gems.add(gem);
    }
    gems.position.y = 1.0;
    g.userData.gems = gems;
    g.add(gems);
  }
  return g;
}

export function animateTower(g, t) {
  const u = g.userData;
  if (!u) return;
  if (u.gems) {
    u.gems.rotation.y = t * 1.6;
    u.gems.children.forEach((gem) => {
      const a = gem.userData.orbitA;
      gem.position.set(Math.cos(a) * 0.8, Math.sin(t * 2.2 + a) * 0.12, Math.sin(a) * 0.8);
      gem.rotation.y = t * 3;
    });
  }
  switch (u.kind) {
    case 'spire': if (u.orb) { u.orb.rotation.y = t * 2; u.ring.rotation.z = t * 1.3; } break;
    case 'cauldron': if (u.oil) u.oil.position.y = 1.84 + Math.sin(t * 6) * 0.015; break;
    case 'beacon':
      if (u.halo) u.halo.rotation.y = t * 1.2;
      if (u.sun) u.sun.scale.setScalar(1 + Math.sin(t * 3.2) * 0.08);
      if (u.pillar) u.pillar.material.opacity = 0.12 + 0.06 * Math.sin(t * 2.2);
      break;
    case 'rune':
      if (u.sigil) u.sigil.rotation.z = t * 0.8;
      if (u.inner) u.inner.rotation.z = -t * 1.4;
      break;
    case 'storm':
      if (u.r1) { u.r1.rotation.x = t * 2.1; u.r1.rotation.y = t * 0.7; }
      if (u.r2) { u.r2.rotation.y = t * 2.9; u.r2.rotation.z = t * 1.1; }
      if (u.orb) u.orb.scale.setScalar(1 + Math.sin(t * 5) * 0.07);
      break;
  }
}
export function aimTower(g, wx, wz) {
  const u = g.userData;
  if (!u?.head) return;
  const p = new THREE.Vector3();
  g.getWorldPosition(p);
  u.head.rotation.y = Math.atan2(wx - p.x, wz - p.z);
}

// =====================================================================
// ENEMY CONSTRUCTS — parameterized family builders
// Each returns {group, anim} where anim(t, walkPhase) drives gait.
// =====================================================================
function bipedBase({ body, trim, glow, h = 1.0, wide = 0.5, headR = 0.17, shield = false, sword = false, robe = false }) {
  const g = new THREE.Group();
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = mesh(Box(0.13, 0.42, 0.16), M(trim, { metal: 0.4 }), s * wide * 0.32, 0.21, 0);
    g.add(leg);
    legs.push(leg);
  }
  const torso = robe
    ? mesh(Cone(wide * 0.72, h * 0.85, 6), M(body, { metal: 0.3 }), 0, 0.42 + h * 0.42, 0)
    : mesh(Box(wide, h * 0.62, 0.34), M(body, { metal: 0.5, rough: 0.5 }), 0, 0.42 + h * 0.31, 0);
  g.add(torso);
  // glowing core seam
  g.add(mesh(Box(0.1, 0.14, 0.06), M(glow, { emissive: glow, ei: 1.8 }), 0, 0.42 + h * 0.34, robe ? wide * 0.4 : 0.19, false));
  const head = mesh(Sph(headR, 8), M(trim, { metal: 0.5 }), 0, 0.5 + h * 0.66 + headR, 0);
  g.add(head);
  g.add(mesh(Box(headR * 1.6, headR * 0.5, headR * 0.5), M(glow, { emissive: glow, ei: 1.6 }), 0, 0.52 + h * 0.66 + headR, headR * 0.7, false));
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = mesh(Box(0.11, 0.4, 0.14), M(trim, { metal: 0.4 }), s * (wide * 0.62), 0.44 + h * 0.42, 0);
    g.add(arm);
    arms.push(arm);
  }
  if (shield) {
    const sh = mesh(Box(0.09, 0.62, 0.5), M(trim, { metal: 0.6, rough: 0.35 }), -(wide * 0.78), 0.5 + h * 0.36, 0.05);
    g.add(sh);
  }
  if (sword) {
    const sw = mesh(Box(0.05, 0.55, 0.12), M(0xd8dce4, { metal: 0.9, rough: 0.2 }), wide * 0.72, 0.62 + h * 0.42, 0.12);
    sw.rotation.x = 0.5;
    g.add(sw);
  }
  return {
    group: g,
    anim(t, ph) {
      legs[0].rotation.x = Math.sin(ph) * 0.6;
      legs[1].rotation.x = Math.sin(ph + Math.PI) * 0.6;
      arms[0].rotation.x = Math.sin(ph + Math.PI) * 0.45;
      arms[1].rotation.x = Math.sin(ph) * 0.45;
    },
  };
}

function quadBase({ body, trim, glow, len = 0.9, h = 0.5 }) {
  const g = new THREE.Group();
  const legs = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = mesh(Box(0.1, 0.36, 0.12), M(trim, { metal: 0.4 }), sx * 0.24, 0.18, sz * len * 0.36);
    g.add(leg);
    legs.push(leg);
  }
  const torso = mesh(Box(0.5, 0.34, len), M(body, { metal: 0.5, rough: 0.5 }), 0, 0.44 + h * 0.2, 0);
  g.add(torso);
  const head = mesh(Box(0.3, 0.26, 0.34), M(trim, { metal: 0.5 }), 0, 0.52 + h * 0.25, len * 0.55);
  g.add(head);
  g.add(mesh(Box(0.22, 0.06, 0.06), M(glow, { emissive: glow, ei: 1.8 }), 0, 0.54 + h * 0.27, len * 0.72, false));
  const tail = mesh(Cone(0.06, 0.4, 5), M(trim), 0, 0.5, -len * 0.55);
  tail.rotation.x = 1.2;
  g.add(tail);
  return {
    group: g,
    anim(t, ph) {
      legs[0].rotation.x = Math.sin(ph) * 0.7;
      legs[3].rotation.x = Math.sin(ph) * 0.7;
      legs[1].rotation.x = Math.sin(ph + Math.PI) * 0.7;
      legs[2].rotation.x = Math.sin(ph + Math.PI) * 0.7;
    },
  };
}

function wheelerBase({ body, trim, glow, len = 1.1, wheels = 2, cover = false, scythes = false, drill = false, ramLog = false, armThrow = false }) {
  const g = new THREE.Group();
  const wheelMeshes = [];
  const wheelR = 0.28;
  const positions = wheels === 2 ? [[0, 0]] : [[-1, -len * 0.32], [1, len * 0.32]];
  for (const [_, z] of positions) {
    for (const s of [-1, 1]) {
      const wheel = mesh(Cyl(wheelR, wheelR, 0.1, 10), M(WOOD_D), s * 0.42, wheelR, z);
      wheel.rotation.z = Math.PI / 2;
      g.add(wheel);
      wheelMeshes.push(wheel);
      g.add(mesh(Cyl(0.06, 0.06, 0.12, 6), M(trim, { metal: 0.7 }), s * 0.48, wheelR, z)).children;
      g.children[g.children.length - 1].rotation.z = Math.PI / 2;
    }
  }
  const carriage = mesh(Box(0.66, 0.3, len), M(body, { metal: 0.35, rough: 0.6 }), 0, wheelR + 0.24, 0);
  g.add(carriage);
  if (cover) {
    const roof = mesh(Box(0.72, 0.2, len * 0.9), M(trim, { metal: 0.5 }), 0, wheelR + 0.5, 0);
    g.add(roof);
  }
  g.add(mesh(Box(0.14, 0.08, 0.08), M(glow, { emissive: glow, ei: 1.8 }), 0, wheelR + 0.3, len * 0.52, false));
  if (scythes) {
    for (const s of [-1, 1]) {
      const sc = mesh(Box(0.5, 0.04, 0.1), M(0xd8dce4, { metal: 0.9, rough: 0.2 }), s * 0.62, wheelR, 0.2);
      g.add(sc);
    }
  }
  let spinner = null;
  if (drill) {
    spinner = mesh(Cone(0.26, 0.62, 8), M(0xd8b04a, { metal: 0.85, rough: 0.3 }), 0, wheelR + 0.24, len * 0.62);
    spinner.rotation.x = Math.PI / 2;
    g.add(spinner);
  }
  if (ramLog) {
    const log = mesh(Cyl(0.14, 0.14, len * 1.1, 8), M(WOOD_D), 0, wheelR + 0.5, 0);
    log.rotation.x = Math.PI / 2;
    g.add(log);
    g.add(mesh(Cone(0.16, 0.3, 8), M(IRON, { metal: 0.8 }), 0, wheelR + 0.5, len * 0.62)).children;
    g.children[g.children.length - 1].rotation.x = Math.PI / 2;
  }
  let arm = null;
  if (armThrow) {
    arm = mesh(Box(0.1, 0.08, 1.3), M(WOOD), 0, wheelR + 0.6, -0.1);
    arm.rotation.x = -0.7;
    g.add(arm);
    g.add(mesh(Sph(0.12, 8), M(STONE_D), 0, wheelR + 1.05, -0.62));
  }
  return {
    group: g,
    anim(t, ph) {
      for (const w of wheelMeshes) w.rotation.x = ph * 1.6;
      if (spinner) spinner.rotation.z = t * 14;
    },
  };
}

function floaterBase({ core, glow, shards = 3, wings = false, manta = false, twin = false, rotor = false, boat = false, size = 0.5 }) {
  const g = new THREE.Group();
  const parts = { wings: [], shards: [] };
  if (boat) {
    const hull = mesh(Box(0.5, 0.28, 1.2), M(WOOD), 0, 0.9, 0);
    g.add(hull);
    g.add(mesh(Box(0.4, 0.1, 0.6), M(WOOD_D), 0, 1.06, -0.1));
    const balloon = mesh(Sph(0.42, 10), M(core, { rough: 0.6 }), 0, 1.65, 0);
    balloon.scale.z = 1.5;
    g.add(balloon);
    g.add(mesh(Box(0.1, 0.1, 0.1), M(glow, { emissive: glow, ei: 1.8 }), 0, 0.95, 0.55, false));
  } else if (manta) {
    const body = mesh(Sph(size, 8), M(core, { rough: 0.5 }), 0, 1.1, 0);
    body.scale.set(1.1, 0.4, 1.3);
    g.add(body);
    for (const s of [-1, 1]) {
      const wing = mesh(Box(size * 1.6, 0.06, size * 1.1), M(core, { rough: 0.6 }), s * size * 1.2, 1.1, 0);
      g.add(wing);
      parts.wings.push(wing);
    }
    g.add(mesh(Sph(size * 0.25, 6), M(glow, { emissive: glow, ei: 2 }), 0, 1.1, size * 0.9, false));
  } else {
    const orb = mesh(Sph(size, 10), M(core, { emissive: glow, ei: 0.7, rough: 0.35 }), 0, 1.15, 0);
    g.add(orb);
    parts.orb = orb;
    if (twin) {
      const orb2 = mesh(Sph(size * 0.7, 8), M(core, { emissive: glow, ei: 0.7 }), size * 1.1, 1.35, 0);
      g.add(orb2);
      parts.orb2 = orb2;
    }
    if (wings) {
      for (const s of [-1, 1]) {
        const wing = mesh(Box(size * 1.5, 0.05, size * 0.8), M(0x8a8f9a, { trans: 0.8 }), s * size * 1.3, 1.25, 0);
        g.add(wing);
        parts.wings.push(wing);
      }
    }
    for (let i = 0; i < shards; i++) {
      const sh = mesh(Tet(size * 0.28), M(glow, { emissive: glow, ei: 1.4 }), 0, 1.15, 0, false);
      sh.userData.a = (i / shards) * Math.PI * 2;
      g.add(sh);
      parts.shards.push(sh);
    }
  }
  if (rotor) {
    const blade = mesh(Box(1.1, 0.03, 0.12), M(IRON, { metal: 0.7 }), 0, 1.78, 0);
    g.add(blade);
    parts.rotor = blade;
    g.add(mesh(Cyl(0.04, 0.04, 0.25, 6), M(IRON_D), 0, 1.62, 0));
  }
  return {
    group: g,
    anim(t, ph) {
      g.position.y = Math.sin(t * 2.4 + ph) * 0.12;
      for (const w of parts.wings) w.rotation.z = Math.sin(t * 9 + ph) * 0.45 * Math.sign(w.position.x);
      for (const sh of parts.shards) {
        const a = sh.userData.a + t * 2.2;
        sh.position.set(Math.cos(a) * 0.75, 1.15 + Math.sin(t * 3 + a) * 0.15, Math.sin(a) * 0.75);
        sh.rotation.y = t * 4;
      }
      if (parts.rotor) parts.rotor.rotation.y = t * 16;
      if (parts.orb2) parts.orb2.position.y = 1.35 + Math.sin(t * 3.4 + 1) * 0.1;
    },
  };
}

function crystalBase({ color, glow, legs = 0, big = false, geode = false, stack = false }) {
  const g = new THREE.Group();
  const parts = { legs: [] };
  if (stack) {
    for (let i = 0; i < 3; i++) {
      const s = mesh(Oct(0.36 - i * 0.08), M(color, { emissive: glow, ei: 0.5, rough: 0.25 }), 0, 0.5 + i * 0.5, 0);
      s.rotation.y = i * 0.6;
      g.add(s);
    }
  } else if (geode) {
    const rock = mesh(Sph(0.55, 7), M(0x5a5464), 0, 0.55, 0);
    g.add(rock);
    g.add(mesh(Oct(0.3), M(color, { emissive: glow, ei: 1.2, rough: 0.2 }), 0, 0.85, 0.2, false));
  } else {
    const body = mesh(Oct(big ? 0.55 : 0.34), M(color, { emissive: glow, ei: 0.6, rough: 0.25 }), 0, big ? 0.9 : 0.62, 0);
    body.scale.y = 1.4;
    g.add(body);
    parts.body = body;
  }
  for (let i = 0; i < legs; i++) {
    const a = (i / legs) * Math.PI * 2 + Math.PI / legs;
    const leg = mesh(Cyl(0.03, 0.05, 0.5, 5), M(color, { rough: 0.3 }), Math.cos(a) * 0.34, 0.25, Math.sin(a) * 0.34);
    leg.rotation.z = Math.cos(a) * 0.6;
    leg.rotation.x = -Math.sin(a) * 0.6;
    g.add(leg);
    parts.legs.push({ m: leg, a });
  }
  return {
    group: g,
    anim(t, ph) {
      for (let i = 0; i < parts.legs.length; i++) {
        const L = parts.legs[i];
        L.m.rotation.z = Math.cos(L.a) * 0.6 + Math.sin(ph + i) * 0.25;
      }
      if (parts.body) parts.body.rotation.y = t * 1.2;
    },
  };
}

function golemBase({ body, trim, glow, scale = 1, shoulderCannons = false }) {
  const g = new THREE.Group();
  const legs = [], arms = [];
  for (const s of [-1, 1]) {
    const leg = mesh(Box(0.22 * scale, 0.5 * scale, 0.26 * scale), M(trim), s * 0.22 * scale, 0.25 * scale, 0);
    g.add(leg); legs.push(leg);
  }
  g.add(mesh(Box(0.72 * scale, 0.62 * scale, 0.45 * scale), M(body, { rough: 0.7 }), 0, 0.78 * scale, 0));
  g.add(mesh(Box(0.2 * scale, 0.2 * scale, 0.08), M(glow, { emissive: glow, ei: 2 }), 0, 0.84 * scale, 0.24 * scale, false));
  g.add(mesh(Box(0.3 * scale, 0.26 * scale, 0.3 * scale), M(trim), 0, 1.24 * scale, 0));
  for (const s of [-1, 1]) {
    const arm = mesh(Box(0.18 * scale, 0.62 * scale, 0.2 * scale), M(trim), s * 0.52 * scale, 0.82 * scale, 0);
    g.add(arm); arms.push(arm);
    if (shoulderCannons) {
      g.add(mesh(Cyl(0.08 * scale, 0.1 * scale, 0.4 * scale, 6), M(IRON_D, { metal: 0.7 }), s * 0.42 * scale, 1.2 * scale, 0.1)).children;
      const c = g.children[g.children.length - 1];
      c.rotation.x = Math.PI / 2;
    }
  }
  return {
    group: g,
    anim(t, ph) {
      legs[0].rotation.x = Math.sin(ph) * 0.45;
      legs[1].rotation.x = Math.sin(ph + Math.PI) * 0.45;
      arms[0].rotation.x = Math.sin(ph + Math.PI) * 0.35;
      arms[1].rotation.x = Math.sin(ph) * 0.35;
    },
  };
}

// ---- the roster --------------------------------------------------------
const enemyBuilders = {
  // W1 Colosseum
  legionnaire: () => bipedBase({ body: BRONZE, trim: BRONZE_D, glow: 0xffb840, sword: true }),
  hound: () => quadBase({ body: BRONZE, trim: BRONZE_D, glow: 0xff8040 }),
  phalanx: () => bipedBase({ body: BRONZE_D, trim: IRON, glow: 0xffb840, shield: true, wide: 0.6 }),
  wisp: () => floaterBase({ core: 0xe8d890, glow: 0xf0d060, shards: 3, size: 0.34 }),
  chariot: () => wheelerBase({ body: BRONZE, trim: BRONZE_D, glow: 0xff8040, scythes: true }),
  colossus: () => golemBase({ body: BRONZE, trim: BRONZE_D, glow: 0xffb030, scale: 1.6 }),

  // W2 Gothic
  ram: () => wheelerBase({ body: WOOD_D, trim: IRON_D, glow: 0xa03040, wheels: 4, cover: true, ramLog: true, len: 1.4 }),
  ratling: () => quadBase({ body: 0x4a4046, trim: 0x322a30, glow: 0xc03040, len: 0.6, h: 0.3 }),
  knight: () => bipedBase({ body: IRON, trim: IRON_D, glow: 0xc03040, sword: true, shield: true }),
  gargoyle: () => floaterBase({ core: 0x6a6470, glow: 0xc05060, wings: true, size: 0.4 }),
  trebuchet: () => wheelerBase({ body: WOOD_D, trim: IRON_D, glow: 0xc03040, wheels: 4, armThrow: true, len: 1.4 }),
  siegetitan: () => golemBase({ body: IRON_D, trim: IRON, glow: 0xd04050, scale: 1.7, shoulderCannons: true }),

  // W3 Sky
  skiff: () => floaterBase({ core: 0x7ab0d8, glow: 0x9adcf0, boat: true }),
  ray: () => floaterBase({ core: 0x9ac4e0, glow: 0x62b8f0, manta: true, size: 0.5 }),
  zephyr: () => floaterBase({ core: 0xcfe8f4, glow: 0x86d8f0, twin: true, shards: 2, size: 0.36 }),
  herald: () => bipedBase({ body: 0x5a7a9a, trim: 0x3c5a78, glow: 0x86d8f0, robe: true, h: 1.2 }),
  leviathan: () => {
    // segmented sky serpent
    const g = new THREE.Group();
    const segs = [];
    for (let i = 0; i < 5; i++) {
      const s = mesh(Sph(0.5 - i * 0.06, 9), M(0x6a94b8, { rough: 0.5 }), 0, 1.4, -i * 0.7);
      g.add(s); segs.push(s);
    }
    g.add(mesh(Box(0.5, 0.2, 0.3), M(0x9adcf0, { emissive: 0x62b8f0, ei: 1.8 }), 0, 1.45, 0.4, false));
    for (const s of [-1, 1]) {
      const fin = mesh(Box(0.9, 0.05, 0.5), M(0x86b8d8, { trans: 0.85 }), s * 0.7, 1.5, -0.3);
      fin.rotation.z = s * 0.3;
      g.add(fin);
    }
    return { group: g, anim(t, ph) { segs.forEach((s, i) => { s.position.y = 1.4 + Math.sin(t * 2.4 + i * 0.8) * 0.18; }); } };
  },

  // W4 Crystal
  skitterer: () => crystalBase({ color: 0x9a6ee0, glow: 0xc89aff, legs: 4 }),
  prismgolem: () => golemBase({ body: 0x7a5ab0, trim: 0x5a4088, glow: 0xd8b0ff, scale: 1.15 }),
  moth: () => floaterBase({ core: 0xd8c4f4, glow: 0xc89aff, wings: true, size: 0.38 }),
  refractor: () => crystalBase({ color: 0x8a6ec8, glow: 0xd8b0ff, stack: true }),
  geode: () => crystalBase({ color: 0xb08ae8, glow: 0xd8b0ff, geode: true }),
  primeprism: () => {
    const g = new THREE.Group();
    const core = mesh(Oct(0.85), M(0xb08ae8, { emissive: 0xc89aff, ei: 0.9, rough: 0.2 }), 0, 1.5, 0);
    core.scale.y = 1.5;
    g.add(core);
    const shards = [];
    for (let i = 0; i < 6; i++) {
      const sh = mesh(Oct(0.2), M(0xd8b0ff, { emissive: 0xd8b0ff, ei: 1.5 }), 0, 1.5, 0, false);
      sh.userData.a = (i / 6) * Math.PI * 2;
      g.add(sh); shards.push(sh);
    }
    return {
      group: g,
      anim(t, ph) {
        core.rotation.y = t * 1.4;
        for (const sh of shards) {
          const a = sh.userData.a + t * 1.8;
          sh.position.set(Math.cos(a) * 1.3, 1.5 + Math.sin(t * 2 + a * 2) * 0.3, Math.sin(a) * 1.3);
        }
      },
      phaseTarget: core,
    };
  },

  // W5 Dwarven
  drill: () => wheelerBase({ body: IRON, trim: IRON_D, glow: 0xe07828, wheels: 4, drill: true, cover: true }),
  keg: () => {
    const g = new THREE.Group();
    const legs = [];
    for (const s of [-1, 1]) {
      const leg = mesh(Box(0.09, 0.3, 0.12), M(IRON_D), s * 0.16, 0.15, 0);
      g.add(leg); legs.push(leg);
    }
    const barrel = mesh(Cyl(0.3, 0.34, 0.62, 10), M(0x8a5a2e), 0, 0.65, 0);
    g.add(barrel);
    for (const y of [0.45, 0.85]) g.add(mesh(Tor(0.325, 0.03, 6, 14), M(IRON_D, { metal: 0.7 }), 0, y, 0)).children;
    g.children[g.children.length - 1].rotation.x = Math.PI / 2;
    g.children[g.children.length - 2].rotation.x = Math.PI / 2;
    const fuse = mesh(Sph(0.07, 6), M(0xffd050, { emissive: 0xff9020, ei: 2.4 }), 0.1, 1.05, 0, false);
    g.add(fuse);
    return {
      group: g,
      anim(t, ph) {
        legs[0].rotation.x = Math.sin(ph) * 0.8;
        legs[1].rotation.x = Math.sin(ph + Math.PI) * 0.8;
        fuse.scale.setScalar(1 + Math.sin(t * 12) * 0.3);
      },
    };
  },
  oregolem: () => golemBase({ body: 0x6a5a4a, trim: 0x4c4038, glow: 0xff8028, scale: 1.3 }),
  gyro: () => floaterBase({ core: 0xa08858, glow: 0xffb040, rotor: true, size: 0.4 }),
  sentinel: () => golemBase({ body: 0x4c5058, trim: 0x34383e, glow: 0xff7020, scale: 1.35, shoulderCannons: true }),
  forgeengine: () => {
    const g = new THREE.Group();
    const wheels = [];
    for (const z of [-0.9, 0, 0.9]) for (const s of [-1, 1]) {
      const w = mesh(Cyl(0.34, 0.34, 0.12, 10), M(IRON_D, { metal: 0.6 }), s * 0.55, 0.34, z);
      w.rotation.z = Math.PI / 2;
      g.add(w); wheels.push(w);
    }
    g.add(mesh(Box(0.9, 0.6, 2.4), M(0x3c3430, { rough: 0.6, metal: 0.4 }), 0, 0.75, 0));
    g.add(mesh(Cyl(0.3, 0.35, 0.8, 8), M(IRON_D), 0, 1.4, -0.6));
    g.add(mesh(Box(0.5, 0.3, 0.4), M(0xff6a14, { emissive: 0xff5a08, ei: 1.8 }), 0, 0.8, 1.15, false));
    g.add(mesh(Cone(0.3, 0.5, 8), M(0xd8b04a, { metal: 0.85 }), 0, 0.8, 1.45)).children;
    g.children[g.children.length - 1].rotation.x = Math.PI / 2;
    const stack = mesh(Cyl(0.12, 0.16, 0.5, 8), M(IRON_D), 0.25, 1.55, 0.3);
    g.add(stack);
    return { group: g, anim(t, ph) { for (const w of wheels) w.rotation.x = ph * 1.4; } };
  },
};

export function buildEnemyMesh(modelKey, { tint = null, scale = 1 } = {}) {
  const b = enemyBuilders[modelKey];
  if (!b) throw new Error('unknown enemy model ' + modelKey);
  const built = b();
  built.group.scale.setScalar(scale);
  if (tint != null) {
    built.group.traverse((n) => {
      if (n.isMesh && n.material?.color) {
        n.material = n.material.clone();
        n.material.color.lerp(new THREE.Color(tint), 0.4);
      }
    });
  }
  built.group.traverse((n) => { if (n.isMesh) n.castShadow = true; });
  return built;
}

// =====================================================================
// BASTIONS — themed keeps with 4 visible damage tiers
// =====================================================================
function banner(color, x, y, z) {
  const g = new THREE.Group();
  g.add(mesh(Cyl(0.03, 0.04, 1.3, 6), M(WOOD_D), 0, 0.65, 0));
  const cloth = mesh(Box(0.04, 0.62, 0.34), M(color, { rough: 0.8 }), 0, 0.9, 0.19);
  g.add(cloth);
  g.position.set(x, y, z);
  g.userData.cloth = cloth;
  return g;
}

function keepCore({ stone = STONE, stoneD = STONE_D, accent = CRIMSON, style }) {
  const g = new THREE.Group();
  const breakables = [];   // hidden progressively with damage
  const cracks = [];       // shown progressively
  const banners = [];

  // ground plaza disc
  g.add(mesh(Cyl(3.4, 3.6, 0.22, 24), M(stoneD), 0, 0.11, 0, false));

  if (style === 'colosseum') {
    // ringed arena keep
    g.add(mesh(Cyl(2.4, 2.7, 1.1, 16), M(stone), 0, 0.75, 0));
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      g.add(mesh(Box(0.3, 1.1, 0.3), M(stoneD), Math.cos(a) * 2.5, 0.75, Math.sin(a) * 2.5));
    }
    g.add(mesh(Cyl(1.7, 2.0, 1.0, 12), M(stone), 0, 1.75, 0));
    const crown = mesh(Cyl(1.1, 1.4, 0.9, 10), M(stone), 0, 2.7, 0);
    g.add(crown); breakables.push(crown);
    const awning = mesh(Cone(1.5, 0.6, 10), M(accent), 0, 3.4, 0);
    g.add(awning); breakables.push(awning);
  } else if (style === 'gothic') {
    g.add(mesh(Box(3.0, 1.6, 3.0), M(stone), 0, 0.9, 0));
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      g.add(mesh(Cyl(0.45, 0.5, 2.6, 8), M(stoneD), sx * 1.45, 1.3, sz * 1.45));
      const spire = mesh(Cone(0.55, 1.1, 8), M(0x3c4458), sx * 1.45, 3.1, sz * 1.45);
      g.add(spire); breakables.push(spire);
    }
    const keep = mesh(Box(1.6, 1.6, 1.6), M(stone), 0, 2.4, 0);
    g.add(keep); breakables.push(keep);
    const roof = mesh(Cone(1.35, 1.2, 4), M(0x3c4458), 0, 3.8, 0);
    roof.rotation.y = Math.PI / 4;
    g.add(roof); breakables.push(roof);
  } else if (style === 'sky') {
    g.add(mesh(Cyl(2.0, 2.6, 1.0, 12), M(0xe8eef4), 0, 0.7, 0));
    g.add(mesh(Cyl(1.2, 1.6, 1.6, 10), M(0xdde8f0), 0, 1.9, 0));
    const spire = mesh(Cone(0.9, 2.2, 10), M(0xcfdeeb), 0, 3.7, 0);
    g.add(spire); breakables.push(spire);
    const halo = mesh(Tor(1.5, 0.07, 8, 28), M(GOLD, { metal: 0.9, rough: 0.25, emissive: 0xffd870, ei: 0.7 }), 0, 3.1, 0);
    halo.rotation.x = 0.3;
    g.add(halo); breakables.push(halo);
  } else if (style === 'crystal') {
    g.add(mesh(Cyl(2.2, 2.6, 0.8, 10), M(0x6a5898), 0, 0.6, 0));
    const c1 = mesh(Oct(1.5), M(0x9a7ad8, { emissive: 0xb08aff, ei: 0.5, rough: 0.2 }), 0, 2.3, 0);
    c1.scale.y = 1.8;
    g.add(c1); breakables.push(c1);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const c = mesh(Oct(0.55), M(0x8a6ec8, { emissive: 0xb08aff, ei: 0.5, rough: 0.2 }),
        Math.cos(a) * 1.7, 1.2, Math.sin(a) * 1.7);
      c.scale.y = 1.7;
      g.add(c);
      if (i % 2) breakables.push(c);
    }
  } else { // forge
    g.add(mesh(Box(3.2, 1.3, 2.8), M(0x5a5048), 0, 0.75, 0));
    const mouth = mesh(Box(1.1, 0.8, 0.2), M(0xff6a14, { emissive: 0xff5a08, ei: 1.8 }), 0, 0.75, 1.45, false);
    g.add(mouth);
    g.add(mesh(Box(2.0, 1.1, 1.8), M(0x4c443c), 0, 1.9, -0.2));
    for (const sx of [-0.9, 0.9]) {
      const chim = mesh(Cyl(0.22, 0.3, 1.6, 8), M(0x3c3630), sx, 2.9, -0.6);
      g.add(chim); breakables.push(chim);
    }
    const gear = mesh(Tor(0.55, 0.12, 6, 10), M(0xd8b04a, { metal: 0.8, rough: 0.35 }), 1.3, 1.9, 0.8);
    g.add(gear); breakables.push(gear);
  }

  // banners (all styles)
  for (const a of [0.6, 2.2, 3.9, 5.4]) {
    const b = banner(accent, Math.cos(a) * 2.9, 0.2, Math.sin(a) * 2.9);
    g.add(b); banners.push(b);
  }

  // crack decals (hidden at tier 0)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.2;
    const crack = mesh(Box(0.08, 1.0 + (i % 3) * 0.4, 0.04), M(0x1a1612), Math.cos(a) * 2.1, 0.9, Math.sin(a) * 2.1, false);
    crack.rotation.z = (i % 2 ? 1 : -1) * 0.3;
    crack.rotation.y = -a;
    crack.visible = false;
    g.add(crack); cracks.push(crack);
  }
  // rubble ring (tier 3)
  const rubble = new THREE.Group();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    rubble.add(mesh(new THREE.DodecahedronGeometry(0.16 + (i % 3) * 0.1, 0), M(stoneD),
      Math.cos(a) * (2.6 + (i % 2) * 0.5), 0.15, Math.sin(a) * (2.6 + (i % 2) * 0.5)));
  }
  rubble.visible = false;
  g.add(rubble);

  return { group: g, breakables, cracks, rubble, banners };
}

const BASTION_STYLES = {
  colosseumKeep: { style: 'colosseum', accent: 0xb03a2a },
  gothicKeep: { style: 'gothic', accent: 0x8a2a3a, stone: 0x7a8290, stoneD: 0x565e6a },
  skySpire: { style: 'sky', accent: 0x3a78b0 },
  crystalPalace: { style: 'crystal', accent: 0xc86ae0, stone: 0x8a78b8, stoneD: 0x5a4a88 },
  forgeHold: { style: 'forge', accent: 0xe07828 },
};

// fire anchor points for the fx layer per damage tier
export function buildBastion(kind) {
  const conf = BASTION_STYLES[kind] || BASTION_STYLES.gothicKeep;
  const core = keepCore(conf);
  const g = core.group;
  g.traverse((n) => { if (n.isMesh) n.castShadow = true; });
  let tier = 0;
  const api = {
    group: g,
    fireAnchors: [
      new THREE.Vector3(1.4, 1.6, 0.8), new THREE.Vector3(-1.2, 2.0, -0.9),
      new THREE.Vector3(0.4, 2.8, 0.2), new THREE.Vector3(-0.8, 1.2, 1.3),
    ],
    setTier(t2) {
      if (t2 === tier) return;
      tier = t2;
      core.cracks.forEach((c, i) => { c.visible = t2 >= 1 && i < t2 * 2; });
      core.breakables.forEach((b, i) => { b.visible = !(t2 >= 2 && i % 2 === 0) && !(t2 >= 3 && i % 2 === 1); });
      core.rubble.visible = t2 >= 3;
    },
    get tier() { return tier; },
    animate(t) {
      for (const b of core.banners) {
        if (b.userData.cloth) b.userData.cloth.rotation.y = Math.sin(t * 2.4 + b.position.x) * 0.2;
      }
    },
  };
  return api;
}
