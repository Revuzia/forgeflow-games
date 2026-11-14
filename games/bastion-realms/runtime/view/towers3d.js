// Procedural tower models — composed multi-part builds per type + upgrade level.
// No naked primitives: every tower is a layered assembly with materials, trim and emissives.
import * as THREE from 'three';
import { TOWERS } from '../data/towers.js';

const M = {
  stoneD: new THREE.MeshStandardMaterial({ color: 0x6b6f78, roughness: 0.95 }),
  stone: new THREE.MeshStandardMaterial({ color: 0x8b8f98, roughness: 0.9 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x7a5230, roughness: 0.85 }),
  woodD: new THREE.MeshStandardMaterial({ color: 0x5a3c22, roughness: 0.9 }),
  iron: new THREE.MeshStandardMaterial({ color: 0x4a4e58, roughness: 0.5, metalness: 0.7 }),
  copper: new THREE.MeshStandardMaterial({ color: 0xb0703c, roughness: 0.35, metalness: 0.8 }),
  gold: new THREE.MeshStandardMaterial({ color: 0xd8b04a, roughness: 0.3, metalness: 0.85 }),
  silver: new THREE.MeshStandardMaterial({ color: 0xb8c0cc, roughness: 0.3, metalness: 0.8 }),
};
const trimFor = (lvl) => (lvl === 0 ? M.iron : lvl === 1 ? M.silver : M.gold);

function emissiveMat(color, intensity = 1.2, base = null) {
  return new THREE.MeshStandardMaterial({
    color: base ?? color, emissive: color, emissiveIntensity: intensity, roughness: 0.4,
  });
}

function mesh(geo, mat, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  return m;
}

// Common stone base with per-level rim trim.
function baseDrum(lvl, radius = 0.72) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(radius * 1.08, radius * 1.22, 0.3, 8), M.stoneD, 0, 0.15, 0));
  g.add(mesh(new THREE.CylinderGeometry(radius, radius * 1.08, 0.5, 8), M.stone, 0, 0.55, 0));
  g.add(mesh(new THREE.TorusGeometry(radius * 0.98, 0.05, 8, 16), trimFor(lvl), 0, 0.82, 0)).children;
  g.children[g.children.length - 1].rotation.x = Math.PI / 2;
  return g;
}

const builders = {
  bolt(lvl) {
    const g = new THREE.Group();
    g.add(baseDrum(lvl));
    const h = 1.0 + lvl * 0.25;
    g.add(mesh(new THREE.CylinderGeometry(0.42, 0.5, h, 6), M.wood, 0, 0.8 + h / 2, 0));
    const head = new THREE.Group();
    head.position.y = 0.95 + h;
    const box = mesh(new THREE.BoxGeometry(0.66, 0.4, 0.9), M.woodD, 0, 0, 0);
    head.add(box);
    const arms = lvl === 2 ? [-0.18, 0.18] : [0];
    for (const off of arms) {
      head.add(mesh(new THREE.BoxGeometry(0.9, 0.08, 0.1), M.iron, 0, 0.12, off - 0.12));
      head.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6), trimFor(lvl), 0, 0.12, off - 0.1, false)).children;
      const bolt = head.children[head.children.length - 1];
      bolt.rotation.x = Math.PI / 2;
    }
    head.add(mesh(new THREE.ConeGeometry(0.09, 0.3, 6), trimFor(lvl), 0, 0.12, 0.55));
    head.children[head.children.length - 1].rotation.x = Math.PI / 2;
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.12, 0.6);
    head.add(muzzle);
    g.userData = { head, muzzle, kind: 'bolt' };
    g.add(head);
    return g;
  },

  sniper(lvl) {
    const g = new THREE.Group();
    g.add(baseDrum(lvl, 0.62));
    const h = 1.7 + lvl * 0.45;
    g.add(mesh(new THREE.CylinderGeometry(0.3, 0.44, h, 6), M.stone, 0, 0.8 + h / 2, 0));
    // spiral trim
    g.add(mesh(new THREE.TorusGeometry(0.36, 0.035, 6, 14), trimFor(lvl), 0, 0.8 + h * 0.45, 0));
    g.children[g.children.length - 1].rotation.x = Math.PI / 2;
    const head = new THREE.Group();
    head.position.y = 0.95 + h;
    head.add(mesh(new THREE.SphereGeometry(0.3, 10, 8), M.iron, 0, 0, 0));
    head.add(mesh(new THREE.CylinderGeometry(0.06, 0.09, 1.5, 8), M.iron, 0, 0.06, 0.65));
    head.children[head.children.length - 1].rotation.x = Math.PI / 2;
    head.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 8), trimFor(lvl), 0, 0.06, 1.3));
    head.children[head.children.length - 1].rotation.x = Math.PI / 2;
    // scope crystal
    head.add(mesh(new THREE.OctahedronGeometry(0.12), emissiveMat(0x7fd4ff, 0.9), 0, 0.28, 0.2));
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.06, 1.42);
    head.add(muzzle);
    g.userData = { head, muzzle, kind: 'sniper' };
    g.add(head);
    return g;
  },

  storm(lvl) {
    const g = new THREE.Group();
    g.add(baseDrum(lvl, 0.66));
    const stem = 0.9 + lvl * 0.3;
    g.add(mesh(new THREE.CylinderGeometry(0.24, 0.36, stem, 8), new THREE.MeshStandardMaterial({ color: 0x2c2c38, roughness: 0.6 }), 0, 0.8 + stem / 2, 0));
    const coils = 2 + lvl;
    for (let i = 0; i < coils; i++) {
      const t = mesh(new THREE.TorusGeometry(0.34 - i * 0.05, 0.055, 8, 18), M.copper, 0, 0.95 + stem + i * 0.17, 0);
      t.rotation.x = Math.PI / 2;
      g.add(t);
    }
    const orbY = 1.1 + stem + coils * 0.17;
    const orb = mesh(new THREE.SphereGeometry(0.24 + lvl * 0.05, 14, 12), emissiveMat(0x54c8f0, 1.6, 0x1c3c50), 0, orbY, 0);
    g.add(orb);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, orbY, 0);
    g.add(muzzle);
    g.userData = { head: null, muzzle, orb, kind: 'storm' };
    return g;
  },

  ember(lvl) {
    const g = new THREE.Group();
    g.add(baseDrum(lvl, 0.7));
    g.add(mesh(new THREE.CylinderGeometry(0.5, 0.34, 0.5, 8), M.stoneD, 0, 1.05, 0));
    // bowl
    const bowl = mesh(new THREE.CylinderGeometry(0.58, 0.42, 0.3, 10), M.iron, 0, 1.4, 0);
    g.add(bowl);
    // coals
    g.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 10), emissiveMat(0xff5a14, 1.8, 0x501800), 0, 1.53, 0, false));
    // flame cone (animated)
    const flame = mesh(new THREE.ConeGeometry(0.32, 0.85 + lvl * 0.25, 8),
      new THREE.MeshBasicMaterial({ color: 0xff8c2a, transparent: true, opacity: 0.85 }), 0, 2.05 + lvl * 0.12, 0, false);
    g.add(flame);
    const inner = mesh(new THREE.ConeGeometry(0.16, 0.55 + lvl * 0.2, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd76a, transparent: true, opacity: 0.95 }), 0, 2.0 + lvl * 0.12, 0, false);
    g.add(inner);
    // side braziers at L3
    if (lvl === 2) {
      for (const sx of [-0.62, 0.62]) {
        g.add(mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.5, 6), M.iron, sx, 1.0, 0));
        g.add(mesh(new THREE.SphereGeometry(0.12, 8, 6), emissiveMat(0xff7031, 1.6), sx, 1.32, 0, false));
      }
    }
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 1.9, 0);
    g.add(muzzle);
    g.userData = { head: null, muzzle, flame, inner, kind: 'ember' };
    return g;
  },

  frost(lvl) {
    const g = new THREE.Group();
    g.add(baseDrum(lvl, 0.64));
    const iceMat = new THREE.MeshStandardMaterial({
      color: 0xa8e4ff, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85,
      emissive: 0x2a7cb0, emissiveIntensity: 0.5,
    });
    const h = 1.3 + lvl * 0.4;
    const spire = mesh(new THREE.ConeGeometry(0.4, h, 6), iceMat, 0, 0.8 + h / 2, 0);
    g.add(spire);
    const shards = 3 + lvl * 2;
    for (let i = 0; i < shards; i++) {
      const a = (i / shards) * Math.PI * 2;
      const s = mesh(new THREE.ConeGeometry(0.12, 0.5 + (i % 2) * 0.2, 5), iceMat,
        Math.cos(a) * 0.5, 0.95, Math.sin(a) * 0.5);
      s.rotation.z = Math.cos(a) * 0.5;
      s.rotation.x = -Math.sin(a) * 0.5;
      g.add(s);
    }
    const tip = mesh(new THREE.OctahedronGeometry(0.16 + lvl * 0.04), emissiveMat(0x86dcff, 1.4), 0, 0.9 + h, 0);
    g.add(tip);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.9 + h, 0);
    g.add(muzzle);
    g.userData = { head: null, muzzle, tip, kind: 'frost' };
    return g;
  },

  venom(lvl) {
    const g = new THREE.Group();
    g.add(baseDrum(lvl, 0.68));
    // mossy planter
    g.add(mesh(new THREE.CylinderGeometry(0.52, 0.6, 0.35, 8), new THREE.MeshStandardMaterial({ color: 0x4c5a2c, roughness: 0.95 }), 0, 0.97, 0));
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x5c7a30, roughness: 0.8 });
    const stemH = 0.8 + lvl * 0.25;
    const stem = mesh(new THREE.CylinderGeometry(0.12, 0.2, stemH, 7), stemMat, 0, 1.1 + stemH / 2, 0);
    stem.rotation.z = 0.08;
    g.add(stem);
    // bulb head
    const bulbMat = emissiveMat(0x8fd435, 0.7, 0x3c5c18);
    const bulb = mesh(new THREE.SphereGeometry(0.34 + lvl * 0.07, 10, 8), bulbMat, 0.05, 1.35 + stemH, 0);
    bulb.scale.y = 1.25;
    g.add(bulb);
    // petals
    const petalMat = new THREE.MeshStandardMaterial({ color: 0x6e3a7a, roughness: 0.7, side: THREE.DoubleSide });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const p = mesh(new THREE.ConeGeometry(0.13, 0.4, 5), petalMat,
        0.05 + Math.cos(a) * 0.3, 1.4 + stemH, Math.sin(a) * 0.3, false);
      p.rotation.z = Math.cos(a) * 1.2; p.rotation.x = -Math.sin(a) * 1.2;
      g.add(p);
    }
    // drip pods at L3
    if (lvl === 2) {
      for (const [sx, sz] of [[-0.5, 0.3], [0.5, -0.25], [0.1, 0.55]]) {
        g.add(mesh(new THREE.SphereGeometry(0.11, 8, 6), bulbMat, sx, 0.95, sz, false));
      }
    }
    const muzzle = new THREE.Object3D(); muzzle.position.set(0.05, 1.5 + stemH, 0);
    g.add(muzzle);
    g.userData = { head: null, muzzle, bulb, kind: 'venom' };
    return g;
  },

  cannon(lvl) {
    const g = new THREE.Group();
    g.add(baseDrum(lvl, 0.78));
    // blockhouse
    g.add(mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.7, 8), M.stone, 0, 1.1, 0));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      g.add(mesh(new THREE.BoxGeometry(0.16, 0.2, 0.16), M.stoneD, Math.cos(a) * 0.62, 1.55, Math.sin(a) * 0.62));
    }
    const head = new THREE.Group();
    head.position.y = 1.55;
    const barrelLen = 1.0 + lvl * 0.2;
    const barrels = lvl === 2 ? [-0.18, 0.18] : [0];
    for (const off of barrels) {
      const b = mesh(new THREE.CylinderGeometry(0.16, 0.2, barrelLen, 10), M.iron, off, 0.1, barrelLen / 2 - 0.1);
      b.rotation.x = Math.PI / 2;
      head.add(b);
      const band = mesh(new THREE.TorusGeometry(0.19, 0.035, 6, 12), trimFor(lvl), off, 0.1, barrelLen * 0.55);
      head.add(band);
    }
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.1, barrelLen);
    head.add(muzzle);
    g.userData = { head, muzzle, kind: 'cannon' };
    g.add(head);
    return g;
  },

  banner(lvl) {
    const g = new THREE.Group();
    g.add(baseDrum(lvl, 0.56));
    const poleH = 2.2 + lvl * 0.3;
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, poleH, 7), M.wood, 0, 0.8 + poleH / 2, 0));
    g.add(mesh(new THREE.SphereGeometry(0.09, 8, 6), M.gold, 0, 0.85 + poleH, 0));
    // waving flag: plane with segments, animated in update
    const flagGeo = new THREE.PlaneGeometry(1.15, 0.68, 10, 4);
    const cols = [0xc84a3a, 0xd8842a, 0xd8b04a];
    const flagMat = new THREE.MeshStandardMaterial({ color: cols[lvl], roughness: 0.8, side: THREE.DoubleSide });
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.set(0.62, 0.42 + poleH, 0);
    flag.castShadow = true;
    g.add(flag);
    // drum + horn ornament at L3
    if (lvl >= 1) {
      g.add(mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.3, 8), M.woodD, 0.5, 0.95, 0.3));
    }
    if (lvl === 2) {
      const horn = mesh(new THREE.TorusGeometry(0.2, 0.06, 8, 14, Math.PI * 1.4), M.gold, -0.5, 1.0, 0.2);
      horn.rotation.z = 0.8;
      g.add(horn);
    }
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.9 + poleH, 0);
    g.add(muzzle);
    g.userData = { head: null, muzzle, flag, flagGeo, kind: 'banner' };
    return g;
  },
};

export function buildTowerMesh(type, level) {
  const g = builders[type](level);
  g.traverse((n) => { if (n.isMesh) n.castShadow = true; });

  // ---- upgrade dressing: unmistakable level identity ----
  const accent = TOWERS[type]?.color ?? 0xd8b04a;
  g.scale.setScalar(1 + level * 0.13);           // L2/L3 visibly larger
  if (level >= 1) {
    // orbiting gems: 2 silver at L2, 3 gold at L3
    const gemMat = emissiveMat(level === 2 ? 0xffd76a : 0xc8d4e0, 1.5);
    const gems = new THREE.Group();
    const n = level + 1;
    for (let i = 0; i < n; i++) {
      const gem = mesh(new THREE.OctahedronGeometry(0.1), gemMat, 0, 0, 0, false);
      gem.userData.orbitA = (i / n) * Math.PI * 2;
      gems.add(gem);
    }
    gems.position.y = 1.15;
    g.userData.gems = gems;
    g.add(gems);
  }
  if (level === 2) {
    // max level: glowing accent ring at the base
    const ring = mesh(
      new THREE.RingGeometry(0.95, 1.18, 28),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false, fog: false }),
      0, 0.06, 0, false
    );
    ring.rotation.x = -Math.PI / 2;
    g.userData.maxRing = ring;
    g.add(ring);
  }
  return g;
}

// Idle/aim animation per frame.
export function animateTower(g, t, dt) {
  const u = g.userData;
  if (!u) return;
  if (u.gems) {
    u.gems.rotation.y = t * 1.6;
    u.gems.children.forEach((gem, i) => {
      const a = gem.userData.orbitA;
      gem.position.set(Math.cos(a) * 0.85, Math.sin(t * 2.2 + a) * 0.12, Math.sin(a) * 0.85);
      gem.rotation.y = t * 3;
    });
  }
  if (u.maxRing) u.maxRing.material.opacity = 0.3 + 0.15 * Math.sin(t * 2.8);
  if (u.kind === 'storm' && u.orb) {
    u.orb.scale.setScalar(1 + Math.sin(t * 5.2) * 0.07);
  } else if (u.kind === 'ember' && u.flame) {
    u.flame.scale.set(1 + Math.sin(t * 9.1) * 0.12, 1 + Math.sin(t * 7.3 + 1) * 0.18, 1 + Math.cos(t * 8.2) * 0.12);
    u.inner.scale.copy(u.flame.scale);
  } else if (u.kind === 'frost' && u.tip) {
    u.tip.rotation.y = t * 1.4;
  } else if (u.kind === 'venom' && u.bulb) {
    u.bulb.scale.y = 1.25 + Math.sin(t * 3.1) * 0.06;
  } else if (u.kind === 'banner' && u.flag) {
    const pos = u.flagGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setZ(i, Math.sin(x * 4.5 + t * 6) * 0.06 * (x + 0.58));
    }
    pos.needsUpdate = true;
    u.flagGeo.computeVertexNormals();
  }
}

// Rotate head toward a world point (bolt/sniper/cannon).
export function aimTower(g, wx, wz) {
  const u = g.userData;
  if (!u?.head) return;
  const p = new THREE.Vector3();
  g.getWorldPosition(p);
  u.head.rotation.y = Math.atan2(wx - p.x, wz - p.z);
}
