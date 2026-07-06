// Static level world: terrain w/ painted path, decor props, hazard markers, sky.
import * as THREE from 'three';
import { GRID_W, GRID_H, CELL, cellToWorld } from '../sim/path.js';
import { makeRng } from '../sim/rng.js';
import { instantiate, canvasTexture } from '../core/assets.js';

const TERRAIN_W = 46, TERRAIN_H = 32;

function hexCss(n) { return '#' + n.toString(16).padStart(6, '0'); }

export function buildWorld(scene, level) {
  const group = new THREE.Group();
  group.name = 'world';
  const biome = level.biome;
  const rng = makeRng(level.seed ^ 0x5151);

  // ---------- terrain texture ----------
  const TW = 1104, TH = 768; // px
  const px = (wx) => (wx + TERRAIN_W / 2) / TERRAIN_W * TW;
  const pz = (wz) => (wz + TERRAIN_H / 2) / TERRAIN_H * TH;

  const emissiveCanvas = document.createElement('canvas');
  emissiveCanvas.width = TW; emissiveCanvas.height = TH;
  const ectx = emissiveCanvas.getContext('2d');
  ectx.fillStyle = '#000'; ectx.fillRect(0, 0, TW, TH);

  const tex = canvasTexture(TW, TH, (ctx) => {
    // base
    ctx.fillStyle = hexCss(biome.ground.base);
    ctx.fillRect(0, 0, TW, TH);
    // noise blotches
    for (let i = 0; i < 900; i++) {
      const x = rng.next() * TW, y = rng.next() * TH;
      const r = 6 + rng.next() * 26;
      ctx.fillStyle = rng.chance(0.5) ? hexCss(biome.ground.dark) : hexCss(biome.ground.light);
      ctx.globalAlpha = 0.05 + rng.next() * 0.1;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // volcanic lava veins / astral runes on emissive
    if (biome.id === 'volcanic') {
      for (let i = 0; i < 14; i++) {
        let x = rng.next() * TW, y = rng.next() * TH;
        ectx.strokeStyle = 'rgba(255,90,20,0.9)';
        ectx.lineWidth = 2 + rng.next() * 3;
        ectx.beginPath(); ectx.moveTo(x, y);
        for (let s = 0; s < 6; s++) {
          x += (rng.next() - 0.5) * 90; y += (rng.next() - 0.5) * 90;
          ectx.lineTo(x, y);
        }
        ectx.stroke();
      }
    } else if (biome.id === 'astral') {
      ectx.fillStyle = 'rgba(140,110,255,0.5)';
      for (let i = 0; i < 60; i++) {
        ectx.beginPath();
        ectx.arc(rng.next() * TW, rng.next() * TH, 1 + rng.next() * 2.5, 0, Math.PI * 2);
        ectx.fill();
      }
    }

    // subtle build grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let cx = 0; cx <= GRID_W; cx++) {
      const wx = (cx - GRID_W / 2) * CELL;
      ctx.beginPath(); ctx.moveTo(px(wx), pz(-GRID_H * CELL / 2)); ctx.lineTo(px(wx), pz(GRID_H * CELL / 2)); ctx.stroke();
    }
    for (let cy = 0; cy <= GRID_H; cy++) {
      const wz = (cy - GRID_H / 2) * CELL;
      ctx.beginPath(); ctx.moveTo(px(-GRID_W * CELL / 2), pz(wz)); ctx.lineTo(px(GRID_W * CELL / 2), pz(wz)); ctx.stroke();
    }

    // path ribbon (rounded joins) + edge
    const pts = level.route.points;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = hexCss(biome.ground.pathEdge);
    ctx.lineWidth = (CELL * 0.98) / TERRAIN_W * TW;
    ctx.beginPath();
    ctx.moveTo(px(pts[0][0]), pz(pts[0][1]));
    for (const [x, z] of pts) ctx.lineTo(px(x), pz(z));
    ctx.stroke();
    ctx.strokeStyle = hexCss(biome.ground.path);
    ctx.lineWidth = (CELL * 0.78) / TERRAIN_W * TW;
    ctx.stroke();
    // wear speckles on path
    for (let i = 0; i < 260; i++) {
      const d = rng.next() * level.route.total;
      let lo = 0;
      const cum = level.route.cum;
      for (let j = 1; j < cum.length; j++) { if (cum[j] >= d) { lo = j - 1; break; } }
      const t = (d - cum[lo]) / (cum[lo + 1] - cum[lo] || 1);
      const x = pts[lo][0] + (pts[lo + 1][0] - pts[lo][0]) * t + (rng.next() - 0.5) * 1.1;
      const z = pts[lo][1] + (pts[lo + 1][1] - pts[lo][1]) * t + (rng.next() - 0.5) * 1.1;
      ctx.fillStyle = rng.chance(0.5) ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.arc(px(x), pz(z), 1.5 + rng.next() * 3, 0, Math.PI * 2); ctx.fill();
    }

    // blocked cells: darker patches
    for (const [bx, by] of level.blocked) {
      const w = cellToWorld(bx, by);
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.beginPath();
      ctx.arc(px(w.x), pz(w.z), (CELL * 0.5) / TERRAIN_W * TW, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  const emissiveTex = new THREE.CanvasTexture(emissiveCanvas);
  emissiveTex.colorSpace = THREE.SRGBColorSpace;

  const groundMat = new THREE.MeshStandardMaterial({
    map: tex, roughness: 0.95, metalness: 0,
    emissive: biome.id === 'volcanic' ? 0xff5a14 : biome.id === 'astral' ? 0x8c6eff : 0x000000,
    emissiveMap: (biome.id === 'volcanic' || biome.id === 'astral') ? emissiveTex : null,
    emissiveIntensity: biome.id === 'volcanic' ? 0.9 : 0.5,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(TERRAIN_W, TERRAIN_H), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);

  // cliff skirt (island platform look)
  const skirtMat = new THREE.MeshStandardMaterial({ color: biome.ground.dark, roughness: 1 });
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(TERRAIN_W, 3.2, TERRAIN_H), skirtMat);
  skirt.position.y = -1.62;
  group.add(skirt);

  // sky + fog
  scene.background = new THREE.Color(biome.sky);
  scene.fog = new THREE.FogExp2(biome.fogColor, biome.fogDensity);
  if (biome.id === 'astral') {
    // starfield dome
    const starGeo = new THREE.BufferGeometry();
    const N = 700, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const th = rng.next() * Math.PI * 2, ph = Math.acos(rng.next() * 0.9);
      const r = 150 + rng.next() * 60;
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.cos(ph) * 0.6 + 8;
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfc4ff, size: 0.9, sizeAttenuation: true, fog: false }));
    stars.name = 'stars';
    group.add(stars);
  }

  // ---------- decor ----------
  const decorGroup = new THREE.Group();
  decorGroup.name = 'decor';
  const pathSet = new Set(level.cells.map(([x, y]) => x + ',' + y));
  const blockedSet = new Set(level.blocked.map(([x, y]) => x + ',' + y));
  const weighted = [];
  for (const d of biome.decor) for (let i = 0; i < d.weight; i++) weighted.push(d);

  // Props have arbitrary native sizes — normalize so d.scale means TARGET HEIGHT (world units).
  const propNorm = new Map();
  function normScale(model, targetH) {
    if (!propNorm.has(model)) {
      const inst = instantiate(model, { castShadow: false });
      if (!inst) return 1;
      const box = new THREE.Box3().setFromObject(inst.obj);
      propNorm.set(model, Math.max(0.001, box.max.y - box.min.y));
    }
    return targetH / propNorm.get(model);
  }

  function placeDecor(d, wx, wz, big = false) {
    const inst = instantiate(d.model, { castShadow: true });
    if (!inst) return;
    const targetH = (d.scale[0] + rng.next() * (d.scale[1] - d.scale[0])) * (big ? 1.25 : 1);
    inst.obj.scale.setScalar(normScale(d.model, targetH));
    inst.obj.position.set(wx, 0, wz);
    inst.obj.rotation.y = rng.next() * Math.PI * 2;
    if (d.glow) {
      inst.obj.traverse((n) => {
        if (n.isMesh && n.material?.emissive && n.material.color) {
          n.material.emissive.copy(n.material.color);
          n.material.emissiveIntensity = 0.55;
        }
      });
    }
    decorGroup.add(inst.obj);
  }

  // fringe ring (outside the grid, on the terrain)
  const fringe = [];
  for (let i = 0; i < 46; i++) {
    const side = rng.int(0, 3);
    let wx, wz;
    if (side === 0) { wx = -TERRAIN_W / 2 + 1.4 + rng.next() * 2.2; wz = (rng.next() - 0.5) * (TERRAIN_H - 4); }
    else if (side === 1) { wx = TERRAIN_W / 2 - 1.4 - rng.next() * 2.2; wz = (rng.next() - 0.5) * (TERRAIN_H - 4); }
    else if (side === 2) { wz = -TERRAIN_H / 2 + 1.4 + rng.next() * 2.0; wx = (rng.next() - 0.5) * (TERRAIN_W - 4); }
    else { wz = TERRAIN_H / 2 - 1.4 - rng.next() * 2.0; wx = (rng.next() - 0.5) * (TERRAIN_W - 4); }
    fringe.push([wx, wz]);
  }
  for (const [wx, wz] of fringe) {
    placeDecor(weighted[rng.int(0, weighted.length - 1)], wx, wz, rng.chance(0.2));
  }
  // blocked-cell decor (inside the grid)
  const interiorDecor = biome.decor.filter((d) => !d.fringeOnly);
  for (const [bx, by] of level.blocked) {
    const w = cellToWorld(bx, by);
    const d = interiorDecor[rng.int(0, interiorDecor.length - 1)];
    placeDecor(d, w.x + (rng.next() - 0.5) * 0.5, w.z + (rng.next() - 0.5) * 0.5);
  }
  group.add(decorGroup);

  // ---------- path endpoints: spawn portal + keep gate ----------
  const spawnP = level.route.points[0];
  const endP = level.route.points[level.route.points.length - 1];
  const portal = makePortal(biome, false); portal.position.set(spawnP[0], 0, spawnP[1]);
  const gate = makePortal(biome, true); gate.position.set(endP[0], 0, endP[1]);
  group.add(portal, gate);

  // ---------- path direction chevrons (march from spawn -> gate) ----------
  const arrowTex = canvasTexture(64, 64, (ctx) => {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(16, 12); ctx.lineTo(46, 32); ctx.lineTo(16, 52);
    ctx.stroke();
  });
  const arrows = [];
  const N_ARROWS = Math.max(6, Math.floor(level.route.total / 9));
  for (let i = 0; i < N_ARROWS; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.9),
      new THREE.MeshBasicMaterial({ map: arrowTex, transparent: true, opacity: 0.5, depthWrite: false, fog: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = 0.08;
    m.renderOrder = 10;
    group.add(m);
    arrows.push({ mesh: m, offset: (i / N_ARROWS) * level.route.total });
  }

  // ---------- hazard markers ----------
  const hazardGroup = new THREE.Group();
  hazardGroup.name = 'hazards';
  if (level.hazard?.id === 'lavaVent') {
    // vent cell cracks — actual cells come from sim (mirror the calc via sim at bind time)
    // marker added later by game.js (needs sim.ventCells)
  }
  group.add(hazardGroup);

  scene.add(group);
  return { group, hazardGroup, ground, portal, gate, arrows, routeTotal: level.route.total };
}

// Floating icon label (skull / shield) that always faces the camera.
function labelSprite(text, color, sub) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '64px "Segoe UI Emoji", sans-serif';
  ctx.fillText(text, 128, 40);
  if (sub) {
    ctx.font = 'bold 26px "Segoe UI", sans-serif';
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 6;
    ctx.strokeText(sub, 128, 96);
    ctx.fillStyle = color;
    ctx.fillText(sub, 128, 96);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(3.4, 1.7, 1);
  spr.renderOrder = 40;
  return spr;
}

function makePortal(biome, isGate) {
  const g = new THREE.Group();
  g.name = isGate ? 'gate' : 'portal';

  if (isGate) {
    // ---- the KEEP GATE you defend: stone gatehouse + golden shield ----
    const stone = new THREE.MeshStandardMaterial({ color: 0x8b8f98, roughness: 0.9 });
    const stoneD = new THREE.MeshStandardMaterial({ color: 0x6b6f78, roughness: 0.95 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd8b04a, roughness: 0.35, metalness: 0.8, emissive: 0xd8b04a, emissiveIntensity: 0.25 });
    for (const sx of [-1.35, 1.35]) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 3.2, 8), stone);
      t.position.set(sx, 1.6, 0); t.castShadow = true;
      g.add(t);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.35, 8), stoneD);
      cap.position.set(sx, 3.35, 0); cap.castShadow = true;
      g.add(cap);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.8, 8), gold);
      cone.position.set(sx, 3.9, 0); cone.castShadow = true;
      g.add(cone);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.55, 0.9), stone);
    lintel.position.y = 2.9; lintel.castShadow = true;
    g.add(lintel);
    // glowing golden barrier the enemies try to breach
    const barrier = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.4),
      new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })
    );
    barrier.position.y = 1.4;
    g.add(barrier);
    const label = labelSprite('🛡️', '#ffd76a', 'DEFEND');
    label.position.y = 5.2;
    g.add(label);
    g.userData.spin = barrier; // gentle shimmer target
    g.userData.isGate = true;
  } else {
    // ---- the ENEMY SPAWN: menacing crimson rift ----
    const c1 = 0xd03030;
    const ringMat = new THREE.MeshStandardMaterial({
      color: c1, emissive: c1, emissiveIntensity: 1.1, roughness: 0.4, metalness: 0.3,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.18, 10, 28), ringMat);
    ring.position.y = 1.5;
    g.add(ring);
    const spikes = new THREE.MeshStandardMaterial({ color: 0x2a1414, roughness: 0.9 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const s = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 5), spikes);
      s.position.set(Math.cos(a) * 1.5, 0.4, Math.sin(a) * 1.5);
      s.rotation.z = Math.cos(a) * 0.4; s.rotation.x = -Math.sin(a) * 0.4;
      s.castShadow = true;
      g.add(s);
    }
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.25, 0.5, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a2026, roughness: 0.9 }));
    base.position.y = 0.25;
    g.add(base);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.16, 24),
      new THREE.MeshBasicMaterial({ color: 0x801818, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
    );
    disc.position.y = 1.5;
    g.add(disc);
    const label = labelSprite('☠️', '#ff8a7a', 'ENEMIES');
    label.position.y = 4.4;
    g.add(label);
    g.userData.spin = ring;
  }
  return g;
}
