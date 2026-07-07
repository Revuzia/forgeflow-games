// Level world: textured terrain w/ painted roads + plaza, spawn gates,
// per-world surroundings, inward chevrons. Uses the xAI-generated ground tiles.
import * as THREE from 'three';
import { GRID_W, GRID_H, CELL, CX, CY, cellToWorld } from '../sim/map.js';
import { makeRng } from '../sim/rng.js';
import { M } from './models.js';

const TER_W = 52, TER_H = 38;
const texLoader = new THREE.TextureLoader();
const texCache = new Map();
function groundTexture(name) {
  if (!texCache.has(name)) {
    const t = texLoader.load(`assets/textures/${name}.jpg`);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    texCache.set(name, t);
  }
  return texCache.get(name);
}
function hexCss(n) { return '#' + n.toString(16).padStart(6, '0'); }

export function buildWorld(scene, level) {
  const group = new THREE.Group();
  group.name = 'world';
  const world = level.world;
  const pal = world.palette;
  const rng = makeRng(level.seed ^ 0x7373);

  // ---------- overlay canvas: roads + plaza + grid painted over the xAI tile ----------
  const TW = 1248, TH = 912;
  const px = (wx) => (wx + TER_W / 2) / TER_W * TW;
  const pz = (wz) => (wz + TER_H / 2) / TER_H * TH;
  const cnv = document.createElement('canvas');
  cnv.width = TW; cnv.height = TH;
  const ctx = cnv.getContext('2d');
  ctx.fillStyle = hexCss(pal.ground);
  ctx.fillRect(0, 0, TW, TH);
  // color-wash variation
  for (let i = 0; i < 500; i++) {
    ctx.globalAlpha = 0.04 + rng.next() * 0.06;
    ctx.fillStyle = rng.chance(0.5) ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.arc(rng.next() * TW, rng.next() * TH, 8 + rng.next() * 30, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // subtle build grid
  ctx.strokeStyle = 'rgba(255,255,255,0.055)';
  ctx.lineWidth = 1;
  for (let cx = 0; cx <= GRID_W; cx++) {
    const wx = (cx - GRID_W / 2) * CELL;
    ctx.beginPath(); ctx.moveTo(px(wx), pz(-GRID_H * CELL / 2)); ctx.lineTo(px(wx), pz(GRID_H * CELL / 2)); ctx.stroke();
  }
  for (let cy = 0; cy <= GRID_H; cy++) {
    const wz = (cy - GRID_H / 2) * CELL;
    ctx.beginPath(); ctx.moveTo(px(-GRID_W * CELL / 2), pz(wz)); ctx.lineTo(px(GRID_W * CELL / 2), pz(wz)); ctx.stroke();
  }
  // roads
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const route of level.map.routes) {
    const pts = route.points.slice(0, -6); // stop short of the bastion heart
    ctx.strokeStyle = hexCss(pal.roadEdge);
    ctx.lineWidth = (CELL * 1.0) / TER_W * TW;
    ctx.beginPath();
    ctx.moveTo(px(pts[0][0]), pz(pts[0][1]));
    for (const [x, z] of pts) ctx.lineTo(px(x), pz(z));
    ctx.stroke();
    ctx.strokeStyle = hexCss(pal.road);
    ctx.lineWidth = (CELL * 0.78) / TER_W * TW;
    ctx.stroke();
  }
  // plaza
  ctx.fillStyle = hexCss(pal.plaza);
  ctx.beginPath();
  ctx.arc(px(0), pz(0), (CELL * 2.15) / TER_W * TW, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hexCss(pal.roadEdge);
  ctx.lineWidth = 5;
  ctx.stroke();
  // blocked cells
  for (const [bx, by] of level.map.blocked) {
    const w = cellToWorld(bx, by);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.arc(px(w.x), pz(w.z), (CELL * 0.5) / TER_W * TW, 0, Math.PI * 2);
    ctx.fill();
  }
  const overlay = new THREE.CanvasTexture(cnv);
  overlay.colorSpace = THREE.SRGBColorSpace;

  // detail tile (xAI) multiplied under the overlay via lightMap-style blend:
  // simplest robust approach — two stacked planes: tile below, overlay (with holes) above.
  const tile = groundTexture(world.groundTex);
  tile.repeat.set(7, 5);
  const tilePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(TER_W, TER_H),
    new THREE.MeshStandardMaterial({ map: tile, roughness: 0.95 })
  );
  tilePlane.rotation.x = -Math.PI / 2;
  tilePlane.receiveShadow = true;
  group.add(tilePlane);

  const overlayPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(TER_W, TER_H),
    new THREE.MeshStandardMaterial({ map: overlay, transparent: true, opacity: 0.82, roughness: 0.95, depthWrite: false })
  );
  overlayPlane.rotation.x = -Math.PI / 2;
  overlayPlane.position.y = 0.02;
  overlayPlane.receiveShadow = true;
  overlayPlane.name = 'ground';
  group.add(overlayPlane);

  // island skirt
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(TER_W, 3.4, TER_H), M(pal.roadEdge, { rough: 1 }));
  skirt.position.y = -1.72;
  group.add(skirt);

  // sky + fog
  scene.background = new THREE.Color(pal.sky);
  scene.fog = new THREE.FogExp2(pal.fog, pal.fogDensity);

  // ---------- spawn gates (crimson construct rifts at each road entry) ----------
  const gates = [];
  for (const route of level.map.routes) {
    const p0 = route.points[0];
    const gate = new THREE.Group();
    gate.position.set(p0[0], 0, p0[1]);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.15, 8, 24),
      M(0xd03030, { emissive: 0xd03030, ei: 1.2, rough: 0.4 }));
    ring.position.y = 1.4;
    gate.add(ring);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.02, 22),
      new THREE.MeshBasicMaterial({ color: 0x701818, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    disc.position.y = 1.4;
    gate.add(disc);
    gate.add(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.4, 8), M(0x2a2026)));
    gate.children[gate.children.length - 1].position.y = 0.2;
    gate.userData.ring = ring;
    group.add(gate);
    gates.push(gate);
  }

  // ---------- inward chevrons on every road ----------
  const arrowTex = (() => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const cx2 = c.getContext('2d');
    cx2.strokeStyle = '#ffffff';
    cx2.lineWidth = 10; cx2.lineCap = 'round'; cx2.lineJoin = 'round';
    cx2.beginPath(); cx2.moveTo(16, 12); cx2.lineTo(46, 32); cx2.lineTo(16, 52); cx2.stroke();
    const t = new THREE.CanvasTexture(c);
    return t;
  })();
  const arrows = [];
  for (let ri = 0; ri < level.map.routes.length; ri++) {
    const route = level.map.routes[ri];
    const n = Math.max(4, Math.floor(route.total / 9));
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85),
        new THREE.MeshBasicMaterial({ map: arrowTex, transparent: true, opacity: 0.45, depthWrite: false, fog: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.06;
      m.renderOrder = 10;
      group.add(m);
      arrows.push({ mesh: m, offset: (i / n) * route.total, routeIdx: ri });
    }
  }

  // ---------- decor on blocked cells + fringe, per world ----------
  const decor = new THREE.Group();
  function prop(kind, wx, wz, s = 1) {
    const g = new THREE.Group();
    if (kind === 'column') {
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22 * s, 0.28 * s, 1.8 * s, 8), M(0xcfc4a8)));
      g.children[0].position.y = 0.9 * s;
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.7 * s, 0.16 * s, 0.7 * s), M(0xbfb498)));
      g.children[1].position.y = 1.85 * s;
    } else if (kind === 'brokencolumn') {
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.24 * s, 0.28 * s, 0.9 * s, 8), M(0xbfb498)));
      g.children[0].position.y = 0.45 * s;
    } else if (kind === 'crag') {
      g.add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.7 * s, 0), M(0x4c5058)));
      g.children[0].position.y = 0.5 * s;
    } else if (kind === 'deadtree') {
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06 * s, 0.12 * s, 1.4 * s, 6), M(0x3a3028)));
      g.children[0].position.y = 0.7 * s;
      for (let i = 0; i < 3; i++) {
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * s, 0.05 * s, 0.7 * s, 5), M(0x3a3028));
        br.position.set((i - 1) * 0.2 * s, 1.1 * s, 0);
        br.rotation.z = (i - 1) * 0.9;
        g.add(br);
      }
    } else if (kind === 'cloudrock') {
      g.add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.6 * s, 0), M(0xaebecc)));
      g.children[0].position.y = 0.45 * s;
    } else if (kind === 'crystal') {
      const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.55 * s), M(0x9a7ad8, { emissive: 0xb08aff, ei: 0.6, rough: 0.25 }));
      c.position.y = 0.7 * s;
      c.scale.y = 1.7;
      c.rotation.y = rng.next() * 3;
      g.add(c);
    } else if (kind === 'anvil') {
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5 * s, 0.3 * s, 0.9 * s), M(0x3c4048, { metal: 0.6 })));
      g.children[0].position.y = 0.55 * s;
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.4 * s, 0.4 * s, 0.4 * s), M(0x2e3236)));
      g.children[1].position.y = 0.2 * s;
    } else if (kind === 'lavapool') {
      const pool = new THREE.Mesh(new THREE.CircleGeometry(0.7 * s, 12),
        M(0xff6a14, { emissive: 0xff5a08, ei: 1.6 }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.y = 0.03;
      g.add(pool);
    }
    g.position.set(wx, 0, wz);
    g.rotation.y = rng.next() * Math.PI * 2;
    g.traverse((n) => { if (n.isMesh) n.castShadow = true; });
    decor.add(g);
  }
  const kits = {
    colosseum: ['column', 'brokencolumn', 'brokencolumn'],
    crags: ['crag', 'deadtree', 'crag'],
    skyisles: ['cloudrock', 'column', 'cloudrock'],
    cavern: ['crystal', 'crystal', 'crag'],
    forgehall: ['anvil', 'crag', 'lavapool'],
  }[world.surroundings] || ['crag'];
  for (const [bx, by] of level.map.blocked) {
    const w = cellToWorld(bx, by);
    prop(kits[rng.int(0, kits.length - 1)], w.x, w.z, 0.9 + rng.next() * 0.4);
  }
  // fringe decor outside the grid
  for (let i = 0; i < 26; i++) {
    const side = rng.int(0, 3);
    let wx, wz;
    if (side === 0) { wx = -TER_W / 2 + 1.5 + rng.next() * 2; wz = (rng.next() - 0.5) * (TER_H - 5); }
    else if (side === 1) { wx = TER_W / 2 - 1.5 - rng.next() * 2; wz = (rng.next() - 0.5) * (TER_H - 5); }
    else if (side === 2) { wz = -TER_H / 2 + 1.5 + rng.next() * 2; wx = (rng.next() - 0.5) * (TER_W - 5); }
    else { wz = TER_H / 2 - 1.5 - rng.next() * 2; wx = (rng.next() - 0.5) * (TER_W - 5); }
    prop(kits[rng.int(0, kits.length - 1)], wx, wz, 1 + rng.next() * 0.7);
  }
  group.add(decor);

  // ---------- surroundings beyond the island ----------
  buildSurroundings(group, world, rng);

  scene.add(group);
  return { group, gates, arrows, routeTotals: level.map.routes.map((r) => r.total) };
}

function buildSurroundings(group, world, rng) {
  const kind = world.surroundings;
  if (kind === 'colosseum') {
    // encircling arena stands
    const standMat = M(0xd8c8a0, { rough: 0.9 });
    const standMatD = M(0xb8a880, { rough: 0.95 });
    for (let tier = 0; tier < 3; tier++) {
      const r = 34 + tier * 5;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r + 2.6, r, 3 + tier * 1.4, 42, 1, true),
        tier % 2 ? standMat : standMatD);
      ring.position.y = 1 + tier * 2.2;
      ring.material.side = THREE.DoubleSide;
      group.add(ring);
    }
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 9, 8), M(0xcfc0a0));
      col.position.set(Math.cos(a) * 47, 4.5, Math.sin(a) * 47);
      group.add(col);
    }
    // crowd shimmer dots
    const N = 500, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = rng.next() * Math.PI * 2, r = 35 + rng.next() * 12;
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = 2.5 + rng.next() * 5; pos[i * 3 + 2] = Math.sin(a) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    group.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x8a6a4a, size: 0.5 })));
  } else if (kind === 'crags') {
    const sea = new THREE.Mesh(new THREE.CircleGeometry(400, 40), M(0x141a28, { rough: 1 }));
    sea.rotation.x = -Math.PI / 2; sea.position.y = -12;
    group.add(sea);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + rng.next() * 0.2;
      const d = 55 + rng.next() * 40, h = 12 + rng.next() * 26;
      const peak = new THREE.Mesh(new THREE.ConeGeometry(6 + rng.next() * 8, h, 5), M(0x2c3440, { rough: 1 }));
      peak.position.set(Math.cos(a) * d, -12 + h / 2, Math.sin(a) * d);
      group.add(peak);
    }
    // broken moon
    const moon = new THREE.Mesh(new THREE.SphereGeometry(7, 18, 14), M(0xcfd8ea, { emissive: 0x9fb4dc, ei: 0.6 }));
    moon.position.set(-60, 42, -80);
    group.add(moon);
  } else if (kind === 'skyisles') {
    // cloud sea
    const clouds = new THREE.Mesh(new THREE.CircleGeometry(400, 40),
      new THREE.MeshStandardMaterial({ color: 0xe8f2fa, roughness: 1 }));
    clouds.rotation.x = -Math.PI / 2; clouds.position.y = -11;
    group.add(clouds);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + rng.next() * 0.3;
      const d = 45 + rng.next() * 45;
      const isle = new THREE.Group();
      const rock = new THREE.Mesh(new THREE.ConeGeometry(3 + rng.next() * 3, 6 + rng.next() * 4, 6), M(0x8a9aac));
      rock.rotation.x = Math.PI;
      isle.add(rock);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(3 + rng.next() * 2.6, 2.4, 1, 8), M(0xaec8dc));
      top.position.y = 3.4;
      isle.add(top);
      isle.position.set(Math.cos(a) * d, -4 - rng.next() * 6, Math.sin(a) * d);
      isle.userData.bobPhase = rng.next() * Math.PI * 2;
      isle.name = 'skyisle';
      group.add(isle);
    }
  } else if (kind === 'cavern') {
    // cavern walls + giant crystals
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + rng.next() * 0.15;
      const d = 48 + rng.next() * 26, h = 16 + rng.next() * 22;
      const wall = new THREE.Mesh(new THREE.ConeGeometry(5 + rng.next() * 6, h, 5), M(0x38305a, { rough: 1 }));
      wall.position.set(Math.cos(a) * d, h / 2 - 8, Math.sin(a) * d);
      group.add(wall);
      if (i % 3 === 0) {
        const c = new THREE.Mesh(new THREE.OctahedronGeometry(2 + rng.next() * 2.4),
          M(0x9a7ad8, { emissive: 0xb08aff, ei: 0.7, rough: 0.25 }));
        c.position.set(Math.cos(a) * (d - 9), 2 + rng.next() * 6, Math.sin(a) * (d - 9));
        c.scale.y = 1.8;
        group.add(c);
      }
    }
    // stalactites
    for (let i = 0; i < 16; i++) {
      const a = rng.next() * Math.PI * 2, d = 20 + rng.next() * 40;
      const st = new THREE.Mesh(new THREE.ConeGeometry(1 + rng.next() * 1.6, 6 + rng.next() * 8, 5), M(0x2e2850));
      st.rotation.x = Math.PI;
      st.position.set(Math.cos(a) * d, 26, Math.sin(a) * d);
      group.add(st);
    }
  } else { // forgehall
    const lava = new THREE.Mesh(new THREE.CircleGeometry(400, 40), M(0x4a1408, { emissive: 0xff4a10, ei: 0.5 }));
    lava.rotation.x = -Math.PI / 2; lava.position.y = -12;
    group.add(lava);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const d = 42 + (i % 2) * 10;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 34, 8), M(0x3c342e, { rough: 1 }));
      pillar.position.set(Math.cos(a) * d, 5, Math.sin(a) * d);
      group.add(pillar);
      if (i % 3 === 0) {
        const fall = new THREE.Mesh(new THREE.BoxGeometry(1.1, 22, 0.4),
          M(0xff6a14, { emissive: 0xff5208, ei: 1.6 }));
        fall.position.set(Math.cos(a) * (d - 3.4), 0, Math.sin(a) * (d - 3.4));
        fall.lookAt(0, 0, 0);
        group.add(fall);
      }
    }
  }
}
