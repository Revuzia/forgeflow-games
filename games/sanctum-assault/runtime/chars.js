// Procedural low-poly chibi characters + weapons
import * as THREE from 'three';

const MAT = (color, emissive = 0x000000, ei = 0) =>
  new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: ei,
    roughness: 0.55,
    metalness: 0.25,
  });

function limb(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  return m;
}

export function createChampionMesh(classId, accentColor) {
  const root = new THREE.Group();
  root.name = 'champion';

  const skin = classId === 'mage' ? 0xe8d5c4 : classId === 'archer' ? 0xd4a574 : 0xc4a484;
  const primary =
    classId === 'warrior' ? 0x8b1e1e : classId === 'archer' ? 0xb86b1e : 0x5b2c8a;
  const secondary = accentColor || 0xf0c14b;

  const bodyMat = MAT(primary);
  const skinMat = MAT(skin);
  const accentMat = MAT(secondary, secondary, 0.25);
  const darkMat = MAT(0x1a1020);

  // Shadow blob
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  root.add(shadow);

  // Legs
  const legL = limb(0.28, 0.55, 0.28, darkMat);
  legL.position.set(-0.18, 0.28, 0);
  const legR = limb(0.28, 0.55, 0.28, darkMat);
  legR.position.set(0.18, 0.28, 0);
  root.add(legL, legR);

  // Body
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.45, 4, 8), bodyMat);
  torso.position.y = 0.95;
  torso.castShadow = true;
  root.add(torso);

  // Head (chibi big)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 12), skinMat);
  head.position.y = 1.65;
  head.castShadow = true;
  root.add(head);

  // Eyes
  const eyeMat = MAT(0x1a1020);
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), eyeMat);
  eyeL.position.set(-0.14, 1.7, 0.35);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.14;
  root.add(eyeL, eyeR);

  // Class headpiece
  if (classId === 'warrior') {
    const helm = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.28, 0.7), accentMat);
    helm.position.y = 1.9;
    root.add(helm);
  } else if (classId === 'archer') {
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.5, 8), bodyMat);
    hood.position.y = 2.0;
    hood.rotation.x = 0.2;
    root.add(hood);
  } else {
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.9, 8), bodyMat);
    hat.position.y = 2.2;
    root.add(hat);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 12), accentMat);
    brim.position.y = 1.9;
    root.add(brim);
  }

  // Arms
  const armL = limb(0.22, 0.55, 0.22, skinMat);
  armL.position.set(-0.52, 1.05, 0);
  const armR = limb(0.22, 0.55, 0.22, skinMat);
  armR.position.set(0.52, 1.05, 0);
  root.add(armL, armR);

  // Weapon mount (right hand-ish)
  const weaponMount = new THREE.Group();
  weaponMount.position.set(0.55, 1.0, 0.15);
  root.add(weaponMount);

  const offhandMount = new THREE.Group();
  offhandMount.position.set(-0.55, 1.0, 0.1);
  root.add(offhandMount);

  root.userData = {
    armL,
    armR,
    legL,
    legR,
    torso,
    head,
    weaponMount,
    offhandMount,
    bodyMat,
    accentMat,
    walkPhase: 0,
  };

  return root;
}

export function buildWeaponSet(classId, modeId) {
  const main = new THREE.Group();
  const off = new THREE.Group();

  if (classId === 'warrior' && modeId === 'twohand') {
    // Greatsword
    const hilt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.35, 6),
      MAT(0x3d2914)
    );
    hilt.position.y = -0.1;
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 1.4, 0.05),
      MAT(0xc0c8d0, 0x88aacc, 0.15)
    );
    blade.position.y = 0.7;
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.12), MAT(0xf0c14b, 0xf0c14b, 0.3));
    guard.position.y = 0.1;
    main.add(hilt, blade, guard);
    main.rotation.z = -0.3;
  } else if (classId === 'warrior') {
    // Sword
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.9, 0.04),
      MAT(0xd0d8e0, 0xaaccff, 0.1)
    );
    blade.position.y = 0.45;
    const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.25, 6), MAT(0x3d2914));
    main.add(blade, hilt);
    main.rotation.z = -0.4;
    // Shield
    const shield = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.45, 0.1, 8),
      MAT(0x8b1e1e, 0xf0c14b, 0.2)
    );
    shield.rotation.x = Math.PI / 2;
    shield.rotation.y = 0.4;
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), MAT(0xf0c14b, 0xf0c14b, 0.5));
    boss.position.z = 0.08;
    off.add(shield, boss);
  } else if (classId === 'archer') {
    const bow = new THREE.Mesh(
      new THREE.TorusGeometry(0.45, 0.04, 6, 16, Math.PI),
      MAT(0x6b3e1e, 0xe67e22, 0.15)
    );
    bow.rotation.y = Math.PI / 2;
    bow.rotation.z = Math.PI / 2;
    main.add(bow);
  } else {
    // Staff
    const staff = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.06, 1.5, 6),
      MAT(0x4a2060)
    );
    staff.position.y = 0.5;
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 10),
      MAT(0xc084fc, 0xaa66ff, 0.9)
    );
    orb.position.y = 1.25;
    main.add(staff, orb);
  }

  return { main, off };
}

export function equipWeapons(champion, classId, modeId) {
  const { weaponMount, offhandMount } = champion.userData;
  while (weaponMount.children.length) weaponMount.remove(weaponMount.children[0]);
  while (offhandMount.children.length) offhandMount.remove(offhandMount.children[0]);
  const set = buildWeaponSet(classId, modeId);
  weaponMount.add(set.main);
  if (set.off.children.length || set.off.isGroup) offhandMount.add(set.off);
}

export function createEnemyMesh(typeDef) {
  const root = new THREE.Group();
  const bodyMat = MAT(typeDef.color, typeDef.accent, typeDef.elite ? 0.35 : 0.1);
  const accentMat = MAT(typeDef.accent, typeDef.accent, 0.4);
  const s = typeDef.scale || 1;

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.4 * s, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  root.add(shadow);

  if (typeDef.id === 'brute') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.2, 0.9), bodyMat);
    body.position.y = 0.7 * s;
    body.scale.setScalar(s);
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.6), bodyMat);
    head.position.y = 1.5 * s;
    head.scale.setScalar(s);
    root.add(body, head);
  } else if (typeDef.id === 'runner') {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.5, 4, 8), bodyMat);
    body.position.y = 0.7;
    body.scale.setScalar(s);
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), bodyMat);
    head.position.y = 1.25;
    head.scale.setScalar(s);
    root.add(body, head);
  } else if (typeDef.id === 'shaman') {
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.2, 6), bodyMat);
    body.position.y = 0.7;
    body.castShadow = true;
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), accentMat);
    orb.position.set(0.4, 1.0, 0.2);
    root.add(body, orb);
    root.userData.orb = orb;
  } else if (typeDef.id === 'elite') {
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.7, 4, 8), bodyMat);
    body.position.y = 1.0;
    body.castShadow = true;
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.45, 5), accentMat);
    crown.position.y = 1.85;
    const pauldrons = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.25, 0.5), accentMat);
    pauldrons.position.y = 1.35;
    root.add(body, crown, pauldrons);
  } else {
    // grunt
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.4, 4, 8), bodyMat);
    body.position.y = 0.75;
    body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), bodyMat);
    head.position.y = 1.35;
    head.castShadow = true;
    root.add(body, head);
  }

  // HP bar
  const barBg = new THREE.Mesh(
    new THREE.PlaneGeometry(0.9, 0.1),
    new THREE.MeshBasicMaterial({ color: 0x220000, transparent: true, opacity: 0.8 })
  );
  barBg.position.y = 2.1 * s;
  const barFg = new THREE.Mesh(
    new THREE.PlaneGeometry(0.86, 0.07),
    new THREE.MeshBasicMaterial({ color: 0xe63946 })
  );
  barFg.position.y = 2.1 * s;
  barFg.position.z = 0.01;
  root.add(barBg, barFg);
  root.userData.hpBar = barFg;
  root.userData.hpBarBg = barBg;
  root.userData.baseScale = s;

  return root;
}

export function animateWalker(mesh, dt, moving, speed = 1) {
  const ud = mesh.userData;
  if (!ud.legL) return;
  if (moving) {
    ud.walkPhase = (ud.walkPhase || 0) + dt * 10 * speed;
    const s = Math.sin(ud.walkPhase) * 0.35;
    ud.legL.rotation.x = s;
    ud.legR.rotation.x = -s;
    if (ud.armL) {
      ud.armL.rotation.x = -s * 0.6;
      ud.armR.rotation.x = s * 0.6;
    }
  } else {
    ud.walkPhase = 0;
    if (ud.legL) ud.legL.rotation.x *= 0.8;
    if (ud.legR) ud.legR.rotation.x *= 0.8;
  }
}

export function pulseAttackPose(mesh, t) {
  // t 0..1 attack swing
  const ud = mesh.userData;
  if (!ud.armR) return;
  ud.armR.rotation.x = -Math.sin(t * Math.PI) * 1.2;
  if (ud.weaponMount) ud.weaponMount.rotation.x = -Math.sin(t * Math.PI) * 0.8;
}
