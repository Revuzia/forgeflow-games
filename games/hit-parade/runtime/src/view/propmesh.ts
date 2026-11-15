// HIT PARADE - small procedural objects the view builds itself (lane VIEW, P2): projectile bodies and PRIME TIME stage
// magic. These are FX-scale objects (a thrown brick, a playing card, a football, a trapdoor, a magician's sheet), built
// from real proportions with canvas-painted textures - not hero assets. When lane ASSETS ships a prop GLB with the same
// id (art/gltf/props/<id>.glb: football, brick, card ...) view/props.ts prefers it (see `PropLibrary`).
// Every material here is created once per BoutView and warmed with the scene (no program links mid-bout).

import * as THREE from 'three';

function tex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

let seed = 11;
function rnd(): number { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }

/** a regulation-size football (r 0.11 m) with the classic black-pentagon panels painted in equirect space */
export function footballMesh(): THREE.Mesh {
  const map = tex(1024, 512, (g, w, h) => {
    g.fillStyle = '#f4f2ec'; g.fillRect(0, 0, w, h);
    // icosahedron vertex directions = pentagon centres
    const t = (1 + Math.sqrt(5)) / 2;
    const vs: Array<[number, number, number]> = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
    g.fillStyle = '#16151a';
    for (const [x, y, z] of vs) {
      const l = Math.hypot(x, y, z);
      const lat = Math.asin(y / l), lon = Math.atan2(z, x);
      const cx = (lon / (2 * Math.PI) + 0.5) * w, cy = (0.5 - lat / Math.PI) * h;
      const sx = 0.075 * w / Math.max(0.25, Math.cos(lat)), sy = 0.085 * h;
      for (const off of [-w, 0, w]) {
        g.beginPath();
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
          const px = cx + off + Math.cos(a) * sx * 0.5, py = cy + Math.sin(a) * sy * 0.5;
          if (k) g.lineTo(px, py); else g.moveTo(px, py);
        }
        g.closePath(); g.fill();
      }
    }
    g.strokeStyle = 'rgba(40,40,48,0.28)'; g.lineWidth = 2;               // hexagon seams (a light suggestion)
    for (let k = 0; k < 40; k++) { g.beginPath(); const x = rnd() * w, y = rnd() * h; g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 40); g.stroke(); }
  });
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.45, metalness: 0.0 });
  m.name = 'prop-football';
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 28, 18), m);
  mesh.name = 'football';
  mesh.castShadow = true;
  return mesh;
}

/** a house brick (0.215 x 0.065 x 0.102 m), red clay with speckle, darker arrises and mortar crumbs */
export function brickMesh(): THREE.Mesh {
  const map = tex(512, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, '#9c3b22'); grd.addColorStop(0.5, '#8a3019'); grd.addColorStop(1, '#a4452a');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 2600; k++) {
      const v = rnd();
      g.fillStyle = v < 0.5 ? `rgba(60,18,10,${0.15 + rnd() * 0.25})` : `rgba(210,150,110,${0.1 + rnd() * 0.2})`;
      g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 3);
    }
    g.fillStyle = 'rgba(205,200,190,0.55)';                            // mortar crumbs on the edges
    for (let k = 0; k < 90; k++) { const e = rnd() < 0.5; g.fillRect(e ? rnd() * w : (rnd() < 0.5 ? 0 : w - 8), e ? (rnd() < 0.5 ? 0 : h - 8) : rnd() * h, 4 + rnd() * 10, 3 + rnd() * 6); }
    g.strokeStyle = 'rgba(40,10,6,0.55)'; g.lineWidth = 10; g.strokeRect(0, 0, w, h);
  });
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0.0 });
  m.name = 'prop-brick';
  const geo = new THREE.BoxGeometry(0.215, 0.065, 0.102, 2, 1, 1);
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = 'brick';
  mesh.castShadow = true;
  return mesh;
}

const CARD_W = 0.089, CARD_H = 0.127;
function cardFace(back: boolean): THREE.CanvasTexture {
  return tex(256, 360, (g, w, h) => {
    const r = 18;
    g.clearRect(0, 0, w, h);
    g.beginPath(); g.moveTo(r, 0); g.arcTo(w, 0, w, h, r); g.arcTo(w, h, 0, h, r); g.arcTo(0, h, 0, 0, r); g.arcTo(0, 0, w, 0, r); g.closePath();
    g.fillStyle = '#fbf8f0'; g.fill();
    if (back) {
      g.save(); g.clip();
      g.fillStyle = '#a3122c'; g.fillRect(12, 12, w - 24, h - 24);
      g.strokeStyle = 'rgba(255,230,200,0.75)'; g.lineWidth = 3;
      for (let k = -h; k < w + h; k += 16) { g.beginPath(); g.moveTo(k, 12); g.lineTo(k + h, h - 12); g.stroke(); g.beginPath(); g.moveTo(k + h, 12); g.lineTo(k, h - 12); g.stroke(); }
      g.strokeStyle = '#f2d26b'; g.lineWidth = 5; g.strokeRect(20, 20, w - 40, h - 40);
      g.restore();
    } else {
      g.fillStyle = '#c3122f';
      const pip = (x: number, y: number, s: number) => { g.beginPath(); g.moveTo(x, y + s * 0.9); g.bezierCurveTo(x - s * 1.2, y, x - s * 0.6, y - s, x, y - s * 0.35); g.bezierCurveTo(x + s * 0.6, y - s, x + s * 1.2, y, x, y + s * 0.9); g.fill(); };
      pip(w / 2, h / 2 + 10, 58);
      g.font = 'bold 44px Georgia, serif'; g.textAlign = 'center'; g.fillText('A', 30, 52);
      g.save(); g.translate(w - 30, h - 52); g.rotate(Math.PI); g.fillText('A', 0, 0); g.restore();
    }
  });
}

/** a playing card (both faces), `scale` x real size; the card faces +Z */
export function cardMesh(scale = 1, name = 'card'): THREE.Group {
  const grp = new THREE.Group();
  grp.name = name;
  const geo = new THREE.PlaneGeometry(CARD_W * scale, CARD_H * scale);
  const mk = (back: boolean) => {
    const m = new THREE.MeshStandardMaterial({ map: cardFace(back), roughness: 0.55, metalness: 0.0, alphaTest: 0.5 });
    m.name = back ? 'prop-card-back' : 'prop-card-face';
    const mesh = new THREE.Mesh(geo, m);
    if (back) mesh.rotation.y = Math.PI;
    mesh.castShadow = false;
    return mesh;
  };
  grp.add(mk(false), mk(true));
  return grp;
}

/** a taser barb pair (two darts on a spreader), yellow-and-steel */
export function taserMesh(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'taser_bolt';
  const steel = new THREE.MeshStandardMaterial({ color: 0xc8ccd6, roughness: 0.3, metalness: 0.9 });
  steel.name = 'prop-steel';
  const yellow = new THREE.MeshStandardMaterial({ color: 0xffd21a, roughness: 0.5, metalness: 0.1, emissive: 0x5a4600 });
  yellow.name = 'prop-taser';
  for (const dz of [-0.03, 0.03]) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.07, 10), yellow);
    body.rotation.z = Math.PI / 2; body.position.set(-0.01, dz * 0.4, dz);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.04, 8), steel);
    tip.rotation.z = -Math.PI / 2; tip.position.set(0.045, dz * 0.4, dz);
    g.add(body, tip);
  }
  return g;
}

/** a show trapdoor: hazard-striped frame, black pit, and a hinged lid (`lid` rotates about the hinge on -x) */
export function trapdoorMesh(): { group: THREE.Group; lid: THREE.Object3D; pit: THREE.Mesh } {
  const g = new THREE.Group();
  g.name = 'trapdoor';
  const S = 0.95;
  const pitMap = tex(256, 256, (c, w, h) => {
    const gr = c.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.62);
    gr.addColorStop(0, '#000'); gr.addColorStop(0.7, '#050407'); gr.addColorStop(1, '#1a1512');
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
    c.save(); c.lineWidth = 22; c.strokeStyle = '#ffcc00'; c.strokeRect(11, 11, w - 22, h - 22);
    c.beginPath(); c.rect(0, 0, w, h); c.rect(22, 22, w - 44, h - 44); c.clip('evenodd');
    c.strokeStyle = '#141414'; c.lineWidth = 12;
    for (let k = -h; k < w + h; k += 34) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + h, h); c.stroke(); }
    c.restore();
  });
  const pm = new THREE.MeshBasicMaterial({ map: pitMap, fog: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  pm.name = 'prop-trap-pit';
  const pit = new THREE.Mesh(new THREE.PlaneGeometry(S, S), pm);
  pit.rotation.x = -Math.PI / 2;
  pit.position.y = 0.008;
  pit.renderOrder = 4;
  const woodMap = tex(256, 256, (c, w, h) => {
    c.fillStyle = '#5a3a22'; c.fillRect(0, 0, w, h);
    for (let k = 0; k < 8; k++) { c.fillStyle = k % 2 ? '#654127' : '#50331d'; c.fillRect(0, k * 32, w, 30); }
    c.strokeStyle = 'rgba(20,10,4,0.5)'; for (let k = 0; k < 60; k++) { c.lineWidth = 1 + rnd() * 2; c.beginPath(); const y = rnd() * h; c.moveTo(0, y); c.bezierCurveTo(w * 0.3, y + 6, w * 0.6, y - 6, w, y + 3); c.stroke(); }
    c.fillStyle = '#ffcc00'; c.fillRect(0, 0, w, 14); c.fillRect(0, h - 14, w, 14);
  });
  const lm = new THREE.MeshStandardMaterial({ map: woodMap, roughness: 0.85 });
  lm.name = 'prop-trap-lid';
  const hinge = new THREE.Group();
  hinge.position.set(-S / 2, 0.02, 0);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(S, 0.035, S), lm);
  lid.position.set(S / 2, 0, 0);
  lid.castShadow = true;
  hinge.add(lid);
  g.add(pit, hinge);
  return { group: g, lid: hinge, pit };
}

/** the magician's sheet: a draped bell of striped silk, 1 m tall before scaling (scale y to the victim's height) */
export function sheetMesh(): THREE.Mesh {
  const pts: THREE.Vector2[] = [];
  const prof: Array<[number, number]> = [[0.56, 0], [0.5, 0.06], [0.44, 0.2], [0.4, 0.45], [0.36, 0.66], [0.3, 0.8], [0.2, 0.9], [0.1, 0.97], [0.0, 1.0]];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, 36);
  // hem ripple: a gentle wave on the lower rim so it reads as cloth, not a cone
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), x = pos.getX(i), z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const k = Math.max(0, 1 - y / 0.5) * 0.06 * Math.sin(a * 7);
    pos.setXYZ(i, x * (1 + k), y, z * (1 + k));
  }
  geo.computeVertexNormals();
  const map = tex(512, 256, (g, w, h) => {
    for (let k = 0; k < 16; k++) { g.fillStyle = k % 2 ? '#b0102a' : '#7a0a1f'; g.fillRect(k * w / 16, 0, w / 16 + 1, h); }
    g.fillStyle = '#f5cf55';
    for (let k = 0; k < 26; k++) {
      const cx = rnd() * w, cy = rnd() * h * 0.8 + h * 0.1, s = 6 + rnd() * 8;
      g.beginPath();
      for (let j = 0; j < 10; j++) { const a = (j / 10) * Math.PI * 2 - Math.PI / 2, r = j % 2 ? s * 0.45 : s; if (j) g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
      g.closePath(); g.fill();
    }
    g.fillStyle = '#f5cf55'; g.fillRect(0, h - 18, w, 18);                   // gold hem
  });
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.62, metalness: 0.05, side: THREE.DoubleSide });
  m.name = 'prop-sheet';
  const mesh = new THREE.Mesh(geo, m);
  mesh.name = 'magician_sheet';
  mesh.castShadow = true;
  return mesh;
}

/** a big spinning saw-card (Zambini's GRAND ILLUSION): a giant card with a steel saw rim behind it */
export function sawCardMesh(): THREE.Group {
  const g = cardMesh(4.2, 'saw_card');
  const n = 24, r0 = 0.3, r1 = 0.36;
  const shape = new THREE.Shape();
  for (let k = 0; k <= n * 2; k++) {
    const a = (k / (n * 2)) * Math.PI * 2, r = k % 2 ? r0 : r1;
    if (k) shape.lineTo(Math.cos(a) * r, Math.sin(a) * r); else shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const hole = new THREE.Path(); hole.absarc(0, 0, 0.22, 0, Math.PI * 2, true); shape.holes.push(hole);
  const steel = new THREE.MeshStandardMaterial({ color: 0xd8dde6, roughness: 0.25, metalness: 0.95, side: THREE.DoubleSide });
  steel.name = 'prop-saw';
  const saw = new THREE.Mesh(new THREE.ShapeGeometry(shape), steel);
  saw.position.z = -0.01;
  saw.name = 'saw_rim';
  g.add(saw);
  return g;
}
