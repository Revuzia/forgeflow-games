// Realm board construction — five mystical arenas
import * as THREE from 'three';
import { ARENA_RADIUS, ARENAS } from './data.js';

function makeRuneTexture(baseHex, accentHex, style) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  const base = '#' + baseHex.toString(16).padStart(6, '0');
  const acc = '#' + accentHex.toString(16).padStart(6, '0');

  // Radial base
  const grad = g.createRadialGradient(256, 256, 20, 256, 256, 256);
  grad.addColorStop(0, acc + '55');
  grad.addColorStop(0.35, base);
  grad.addColorStop(0.75, base);
  grad.addColorStop(1, '#000000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);

  // Noise cracks / tiles
  g.globalAlpha = 0.25;
  for (let i = 0; i < 80; i++) {
    g.strokeStyle = i % 3 === 0 ? acc : '#000';
    g.lineWidth = 1 + Math.random() * 2;
    g.beginPath();
    let x = Math.random() * 512;
    let y = Math.random() * 512;
    g.moveTo(x, y);
    for (let j = 0; j < 4; j++) {
      x += (Math.random() - 0.5) * 60;
      y += (Math.random() - 0.5) * 60;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  g.globalAlpha = 1;

  // Concentric rune rings
  g.strokeStyle = acc;
  g.lineWidth = 3;
  g.globalAlpha = 0.7;
  for (const r of [80, 140, 200, 240]) {
    g.beginPath();
    g.arc(256, 256, r, 0, Math.PI * 2);
    g.stroke();
  }

  // Rune ticks
  g.lineWidth = 2;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r0 = 200;
    const r1 = 200 + (i % 3 === 0 ? 22 : 12);
    g.beginPath();
    g.moveTo(256 + Math.cos(a) * r0, 256 + Math.sin(a) * r0);
    g.lineTo(256 + Math.cos(a) * r1, 256 + Math.sin(a) * r1);
    g.stroke();
  }

  // Center motif
  g.globalAlpha = 0.9;
  g.fillStyle = acc;
  if (style === 'ember') {
    // Flame seal
    g.beginPath();
    g.moveTo(256, 200);
    g.bezierCurveTo(280, 230, 290, 280, 256, 310);
    g.bezierCurveTo(222, 280, 232, 230, 256, 200);
    g.fill();
  } else if (style === 'frost') {
    // Snowflake
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.beginPath();
      g.moveTo(256, 256);
      g.lineTo(256 + Math.cos(a) * 50, 256 + Math.sin(a) * 50);
      g.stroke();
    }
  } else if (style === 'storm') {
    // Lightning bolt
    g.beginPath();
    g.moveTo(270, 200);
    g.lineTo(240, 255);
    g.lineTo(265, 255);
    g.lineTo(242, 320);
    g.lineTo(290, 250);
    g.lineTo(260, 250);
    g.closePath();
    g.fill();
  } else if (style === 'umbral') {
    // Void eye
    g.beginPath();
    g.ellipse(256, 256, 55, 30, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#100818';
    g.beginPath();
    g.arc(256, 256, 16, 0, Math.PI * 2);
    g.fill();
  } else {
    // Sunburst
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(256, 256);
      g.lineTo(256 + Math.cos(a) * 60, 256 + Math.sin(a) * 60);
      g.lineWidth = 4;
      g.stroke();
    }
    g.beginPath();
    g.arc(256, 256, 22, 0, Math.PI * 2);
    g.fill();
  }

  // Soft vignette edge for board readability
  g.globalAlpha = 1;
  const vig = g.createRadialGradient(256, 256, 180, 256, 256, 256);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vig;
  g.fillRect(0, 0, 512, 512);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeRimRing(radius, color, emissive, y = 0.15) {
  const geo = new THREE.TorusGeometry(radius, 0.35, 10, 64);
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: 0.65,
    metalness: 0.55,
    roughness: 0.35,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.y = y;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeOrnatePosts(radius, color, emissive, count = 8) {
  const g = new THREE.Group();
  const postGeo = new THREE.CylinderGeometry(0.18, 0.28, 1.2, 6);
  const capGeo = new THREE.SphereGeometry(0.28, 8, 8);
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: 0.8,
    metalness: 0.4,
    roughness: 0.4,
  });
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const post = new THREE.Mesh(postGeo, mat);
    post.position.set(Math.cos(a) * radius, 0.6, Math.sin(a) * radius);
    post.castShadow = true;
    const cap = new THREE.Mesh(capGeo, mat);
    cap.position.set(Math.cos(a) * radius, 1.3, Math.sin(a) * radius);
    g.add(post, cap);
  }
  return g;
}

export function createArenaSystem(scene) {
  let group = null;
  let ambientParticles = [];
  let lights = null;
  let def = null;
  let time = 0;
  let flashLight = null;

  function clear() {
    if (group) {
      scene.remove(group);
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
          else {
            if (o.material.map) o.material.map.dispose();
            o.material.dispose();
          }
        }
      });
      group = null;
    }
    if (lights) {
      scene.remove(lights);
      lights = null;
    }
    ambientParticles = [];
    flashLight = null;
  }

  function build(arenaIndex) {
    clear();
    def = ARENAS[arenaIndex] || ARENAS[0];
    group = new THREE.Group();
    group.name = 'arena';

    scene.background = new THREE.Color(def.sky);
    scene.fog = new THREE.FogExp2(def.fog, 0.018);

    // Lights
    lights = new THREE.Group();
    lights.name = 'arenaLights';
    const amb = new THREE.AmbientLight(def.ambient, def.ambientIntensity);
    const hemi = new THREE.HemisphereLight(def.hemiSky, def.hemiGround, 0.55);
    const sun = new THREE.DirectionalLight(def.sun, def.sunIntensity);
    sun.position.set(12, 28, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -20;
    sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 20;
    sun.shadow.camera.bottom = -20;
    sun.shadow.camera.far = 80;
    sun.shadow.bias = -0.0005;
    flashLight = new THREE.PointLight(def.rimEmissive, 0, 30, 2);
    flashLight.position.set(0, 6, 0);
    lights.add(amb, hemi, sun, flashLight);
    scene.add(lights);

    // Floating under-platform (shadow disc)
    const under = new THREE.Mesh(
      new THREE.CylinderGeometry(ARENA_RADIUS + 1.5, ARENA_RADIUS + 0.5, 1.2, 48),
      new THREE.MeshStandardMaterial({
        color: 0x1a1020,
        metalness: 0.3,
        roughness: 0.85,
        emissive: def.rimEmissive,
        emissiveIntensity: 0.08,
      })
    );
    under.position.y = -0.7;
    under.receiveShadow = true;
    group.add(under);

    // Play floor
    const floorTex = makeRuneTexture(def.floor, def.floorAccent, def.id);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(ARENA_RADIUS, 64),
      new THREE.MeshStandardMaterial({
        map: floorTex,
        color: 0xffffff,
        roughness: 0.72,
        metalness: 0.15,
        emissive: def.floorAccent,
        emissiveIntensity: 0.12,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.02;
    floor.receiveShadow = true;
    group.add(floor);

    // Raised center seal (collectible-board motif)
    const seal = new THREE.Mesh(
      new THREE.CircleGeometry(2.4, 48),
      new THREE.MeshStandardMaterial({
        color: def.floorAccent,
        emissive: def.rimEmissive,
        emissiveIntensity: 0.35,
        metalness: 0.45,
        roughness: 0.4,
        transparent: true,
        opacity: 0.55,
      })
    );
    seal.rotation.x = -Math.PI / 2;
    seal.position.y = 0.05;
    group.add(seal);
    const sealRing = new THREE.Mesh(
      new THREE.RingGeometry(2.35, 2.65, 48),
      new THREE.MeshBasicMaterial({
        color: def.rim,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      })
    );
    sealRing.rotation.x = -Math.PI / 2;
    sealRing.position.y = 0.06;
    group.add(sealRing);

    // Inner glow ring
    const inner = new THREE.Mesh(
      new THREE.RingGeometry(ARENA_RADIUS - 1.2, ARENA_RADIUS - 0.85, 64),
      new THREE.MeshBasicMaterial({
        color: def.rim,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
      })
    );
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.04;
    group.add(inner);

    // Ornate rim
    group.add(makeRimRing(ARENA_RADIUS + 0.15, def.rim, def.rimEmissive, 0.25));
    group.add(makeRimRing(ARENA_RADIUS + 0.55, 0x2a1a10, def.rimEmissive, 0.1));
    group.add(makeOrnatePosts(ARENA_RADIUS + 0.35, def.rim, def.rimEmissive, 8));

    // Floating debris
    const debrisMat = new THREE.MeshStandardMaterial({
      color: def.floorAccent,
      emissive: def.rimEmissive,
      emissiveIntensity: 0.4,
      metalness: 0.3,
      roughness: 0.5,
    });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = ARENA_RADIUS + 2 + Math.random() * 4;
      const size = 0.15 + Math.random() * 0.35;
      const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), debrisMat);
      mesh.position.set(Math.cos(a) * r, 1 + Math.random() * 3, Math.sin(a) * r);
      mesh.userData.baseY = mesh.position.y;
      mesh.userData.phase = Math.random() * Math.PI * 2;
      mesh.userData.spin = 0.3 + Math.random() * 0.8;
      group.add(mesh);
      ambientParticles.push(mesh);
    }

    // Ambient particle field
    const pCount = 120;
    const positions = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * ARENA_RADIUS * 0.95;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = 0.3 + Math.random() * 4;
      positions[i * 3 + 2] = Math.sin(a) * r;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const pMat = new THREE.PointsMaterial({
      color: def.rim,
      size: 0.12,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(pGeo, pMat);
    points.userData.kind = def.particle;
    points.userData.positions = positions;
    group.add(points);
    ambientParticles.push(points);

    // Soft edge wall (invisible collision visual hint)
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(ARENA_RADIUS + 0.05, ARENA_RADIUS + 0.05, 0.4, 64, 1, true),
      new THREE.MeshBasicMaterial({
        color: def.rim,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
      })
    );
    wall.position.y = 0.2;
    group.add(wall);

    scene.add(group);
    return def;
  }

  function update(dt) {
    if (!group) return;
    time += dt;
    for (const o of ambientParticles) {
      if (o.isPoints) {
        const pos = o.userData.positions;
        const kind = o.userData.kind;
        for (let i = 0; i < pos.length; i += 3) {
          if (kind === 'sparks' || kind === 'gold') {
            pos[i + 1] += dt * (0.8 + (i % 5) * 0.1);
            if (pos[i + 1] > 5) pos[i + 1] = 0.2;
          } else if (kind === 'snow') {
            pos[i + 1] -= dt * 0.6;
            pos[i] += Math.sin(time + i) * dt * 0.3;
            if (pos[i + 1] < 0.1) pos[i + 1] = 4.5;
          } else if (kind === 'wind') {
            pos[i] += dt * 1.5;
            pos[i + 2] += Math.sin(time * 2 + i) * dt * 0.4;
            if (pos[i] > ARENA_RADIUS) pos[i] = -ARENA_RADIUS;
          } else {
            // void
            pos[i + 1] += Math.sin(time + i) * dt * 0.4;
            pos[i] += Math.cos(time * 0.5 + i) * dt * 0.2;
          }
        }
        o.geometry.attributes.position.needsUpdate = true;
      } else if (o.userData.baseY != null) {
        o.position.y = o.userData.baseY + Math.sin(time * o.userData.spin + o.userData.phase) * 0.35;
        o.rotation.y += dt * o.userData.spin;
        o.rotation.x += dt * 0.2;
      }
    }
    // Stormspire: occasional lightning flash for atmosphere
    if (def?.id === 'storm' && flashLight) {
      if (!flashLight.userData.nextBolt) flashLight.userData.nextBolt = 2.5 + Math.random() * 3;
      flashLight.userData.nextBolt -= dt;
      if (flashLight.userData.nextBolt <= 0) {
        flashLight.intensity = 4 + Math.random() * 3;
        flashLight.userData.nextBolt = 2.2 + Math.random() * 4.5;
      }
    }
    if (flashLight && flashLight.intensity > 0) {
      flashLight.intensity = Math.max(0, flashLight.intensity - dt * 8);
    }
  }

  function pulseFlash(intensity = 2) {
    if (flashLight) flashLight.intensity = intensity;
  }

  function spawnPortalTint() {
    return def ? def.portal : 0xff5522;
  }

  return {
    build,
    clear,
    update,
    pulseFlash,
    spawnPortalTint,
    get def() {
      return def;
    },
    get radius() {
      return ARENA_RADIUS;
    },
  };
}
