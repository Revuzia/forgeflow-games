import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * ECHO YARDS — gritty industrial freight-yard scenery for Grid Rush.
 *
 * A container port at night: stacked shipping CONTAINERS in blocks, GANTRY CRANES
 * straddling the lanes, FLOODLIGHT towers pooling orange light on the concrete,
 * storage TANKS + pipe runs, a perimeter chain-link FENCE and hazard-striped
 * barriers lining the track. Palette from def (rail = orange #ff6b2b, accent =
 * yellow #ffe566, warm sun/ambient/fog).
 *
 * PERFORMANCE: every repeated prop is a single InstancedMesh. Complex props
 * (crane, floodlight, tank, pipe, fence, barrier) are baked into ONE merged
 * geometry via BufferGeometryUtils and instanced — the whole environment is a
 * couple dozen draw calls, not hundreds of meshes. All randomness comes from
 * ctx.rnd (deterministic). Containers get per-instance colour via instanceColor;
 * multi-tone props (dark corner castings, orange hazard trim) bake vertex colours
 * so one draw call still shows several colours.
 *
 * Interface:  export function buildScene(ctx)
 *   ctx = { group, samples, def, rnd, HALF, totalLength }
 */

const UP = new THREE.Vector3(0, 1, 0);

/* ---------------------------------------------------------------- helpers -- */

const css = (hex) => '#' + (hex >>> 0).toString(16).padStart(6, '0').slice(-6);

// Bake a flat vertex-colour onto a geometry so several colours survive a merge
// (and multiply cleanly against a per-instance instanceColor when used).
function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// Merge painted parts into one geometry, disposing the sources.
function bake(parts) {
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return g;
}

function addInstanced(group, geo, mat, mats, colors) {
  const inst = new THREE.InstancedMesh(geo, mat, mats.length);
  const c = new THREE.Color();
  for (let i = 0; i < mats.length; i++) {
    inst.setMatrixAt(i, mats[i]);
    if (colors) inst.setColorAt(i, c.copy(colors[i]));
  }
  inst.instanceMatrix.needsUpdate = true;
  if (colors && inst.instanceColor) inst.instanceColor.needsUpdate = true;
  inst.frustumCulled = false; // props ring the whole yard; per-batch culling not worth pop risk
  inst.castShadow = inst.receiveShadow = false;
  group.add(inst);
  return inst;
}

/* --------------------------------------------------------------- textures -- */

function concreteTex(rnd, def) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#39332b';
  x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 200; i++) {
    const gx = rnd() * 256, gy = rnd() * 256, r = 5 + rnd() * 44;
    x.globalAlpha = 0.05 + rnd() * 0.13;
    x.fillStyle = rnd() < 0.5 ? '#28231c' : '#4c463b';
    x.beginPath();
    x.arc(gx, gy, r, 0, Math.PI * 2);
    x.fill();
  }
  // oil / grime stains
  for (let i = 0; i < 14; i++) {
    x.globalAlpha = 0.16 + rnd() * 0.14;
    x.fillStyle = '#15110c';
    x.save();
    x.translate(rnd() * 256, rnd() * 256);
    x.scale(1, 0.5 + rnd() * 0.6);
    x.beginPath();
    x.arc(0, 0, 8 + rnd() * 22, 0, Math.PI * 2);
    x.fill();
    x.restore();
  }
  // faint painted yard-bay grid on the tile border
  x.globalAlpha = 0.42;
  x.strokeStyle = css(def.accent);
  x.lineWidth = 2.5;
  x.strokeRect(1, 1, 254, 254);
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function poolTex(def) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 2, 64, 64, 64);
  const a = css(def.sun);
  const b = css(def.rail);
  g.addColorStop(0, a);
  g.addColorStop(0.35, b);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.beginPath();
  x.arc(64, 64, 64, 0, Math.PI * 2);
  x.fill();
  return new THREE.CanvasTexture(c);
}

function hazardTex(def) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#161009';
  x.fillRect(0, 0, 128, 128);
  x.save();
  x.translate(64, 64);
  x.rotate(-Math.PI / 4);
  const w = 22;
  for (let i = -8; i < 8; i++) {
    x.fillStyle = (i & 1) ? css(def.rail) : css(def.accent);
    x.fillRect(i * w, -140, w, 280);
  }
  x.restore();
  // dark top/bottom caps so the stripe band reads like a barrier face
  x.fillStyle = '#0c0906';
  x.fillRect(0, 0, 128, 16);
  x.fillRect(0, 112, 128, 16);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function chainTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 64, 64);
  x.strokeStyle = 'rgba(150,150,140,0.95)';
  x.lineWidth = 3;
  for (let i = -64; i <= 64; i += 16) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 64, 64); x.stroke();
    x.beginPath(); x.moveTo(i, 64); x.lineTo(i + 64, 0); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function signTex(rnd, def) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#0d0906';
  x.fillRect(0, 0, 128, 64);
  x.strokeStyle = css(def.accent);
  x.lineWidth = 4;
  x.strokeRect(3, 3, 122, 58);
  // chevrons pointing one way
  const dir = rnd() < 0.5 ? 1 : -1;
  x.fillStyle = css(def.rail);
  for (let k = 0; k < 3; k++) {
    const bx = 24 + k * 30;
    x.beginPath();
    x.moveTo(bx, 16);
    x.lineTo(bx + dir * 18, 32);
    x.lineTo(bx, 48);
    x.lineTo(bx + dir * 8, 48);
    x.lineTo(bx + dir * 26, 32);
    x.lineTo(bx + dir * 8, 16);
    x.closePath();
    x.fill();
  }
  return new THREE.CanvasTexture(c);
}

function skyTex(def) {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, css(def.skyTop));
  g.addColorStop(0.55, css(def.skyBot));
  g.addColorStop(0.82, css(def.sun));   // warm floodlit haze band near horizon
  g.addColorStop(1.0, css(def.fog));
  x.fillStyle = g;
  x.fillRect(0, 0, 8, 256);
  return new THREE.CanvasTexture(c);
}

/* ------------------------------------------------------------- prop geos -- */

function containerGeo(L) {
  const W = 6.2, H = 6.0;
  const parts = [paint(new THREE.BoxGeometry(L, H, W), 0xffffff)];
  // vertical corrugation ribs on both long faces
  const n = Math.max(3, Math.floor(L / 2.4));
  for (const s of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const rib = new THREE.BoxGeometry(0.5, H * 0.82, 0.42);
      rib.translate(-L / 2 + (i + 0.5) * (L / n), 0, s * (W / 2 + 0.11));
      parts.push(paint(rib, 0xf0f0f0));
    }
  }
  // top & bottom rails
  for (const sy of [-1, 1]) {
    const rail = new THREE.BoxGeometry(L + 0.2, 0.7, W + 0.3);
    rail.translate(0, sy * (H / 2 - 0.05), 0);
    parts.push(paint(rail, 0x5a544b));
  }
  // corner castings (always dark, regardless of instance colour)
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const cc = new THREE.BoxGeometry(1.0, 1.0, 1.0);
    cc.translate(sx * (L / 2 - 0.1), sy * (H / 2 - 0.1), sz * (W / 2 - 0.05));
    parts.push(paint(cc, 0x282521));
  }
  // door hardware on the +X end
  for (const sz of [-1, -0.34, 0.34, 1]) {
    const bar = new THREE.BoxGeometry(0.22, H * 0.8, 0.28);
    bar.translate(L / 2 + 0.03, 0, sz * (W / 2 * 0.82));
    parts.push(paint(bar, 0x3a3733));
  }
  return bake(parts);
}

function craneGeo(def) {
  const legHalf = 42, legDepth = 9, legTop = 50, legW = 2.4;
  const steel = 0x33302b, dark = 0x1d1a16;
  const body = [];
  const glow = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.BoxGeometry(legW, legTop, legW);
    leg.translate(sx * legHalf, legTop / 2, sz * legDepth);
    body.push(paint(leg, steel));
    // orange hazard cuff at the foot of each leg
    const cuff = new THREE.BoxGeometry(legW + 0.4, 5, legW + 0.4);
    cuff.translate(sx * legHalf, 3, sz * legDepth);
    body.push(paint(cuff, def.rail));
    // sill beam linking the two legs on each side (along Z)
    if (sz === -1) {
      const sill = new THREE.BoxGeometry(legW, legW, legDepth * 2 + legW);
      sill.translate(sx * legHalf, 1.4, 0);
      body.push(paint(sill, dark));
    }
  }
  // twin top girders + deck
  for (const sz of [-1, 1]) {
    const gir = new THREE.BoxGeometry(legHalf * 2 + legW, 3.2, 3.2);
    gir.translate(0, legTop, sz * legDepth);
    body.push(paint(gir, steel));
  }
  const deck = new THREE.BoxGeometry(legHalf * 2, 1.3, legDepth * 2);
  deck.translate(0, legTop + 2.3, 0);
  body.push(paint(deck, dark));
  // hanging trolley / operator cab
  const cab = new THREE.BoxGeometry(8, 5, legDepth * 2 * 0.7);
  cab.translate(6, legTop - 5, 0);
  body.push(paint(cab, dark));
  // diagonal cross-braces on the near face
  for (const sx of [-1, 1]) {
    const br = new THREE.BoxGeometry(1.4, legTop * 1.15, 1.4);
    br.translate(sx * legHalf, legTop * 0.5, legDepth);
    br.rotateZ(sx * 0.32);
    body.push(paint(br, steel));
  }
  // glow: running-light strip along the girder + lit cab window
  const strip = new THREE.BoxGeometry(legHalf * 2, 0.55, 0.55);
  strip.translate(0, legTop - 1.9, legDepth + 0.4);
  glow.push(paint(strip, def.accent));
  const win = new THREE.BoxGeometry(8.2, 1.4, 0.5);
  win.translate(6, legTop - 4.4, legDepth * 0.7 + 0.5);
  glow.push(paint(win, def.rail));
  return { body: bake(body), glow: bake(glow) };
}

function floodlightGeo(def) {
  const H = 56, steel = 0x2f2b25, dark = 0x18150f;
  const body = [];
  const glow = [];
  const mast = new THREE.CylinderGeometry(1.2, 2.3, H, 8);
  mast.translate(0, H / 2, 0);
  body.push(paint(mast, steel));
  const base = new THREE.BoxGeometry(4.4, 2, 4.4);
  base.translate(0, 1, 0);
  body.push(paint(base, dark));
  const arm = new THREE.BoxGeometry(16, 1.5, 1.7);
  arm.translate(0, H - 1.2, 1.4);
  body.push(paint(arm, steel));
  for (const lx of [-6, 0, 6]) {
    const house = new THREE.BoxGeometry(3.4, 2.4, 3.8);
    house.translate(lx, H - 2.6, 2.4);
    body.push(paint(house, dark));
    const lamp = new THREE.BoxGeometry(2.8, 1.8, 0.4);
    lamp.translate(lx, H - 2.6, 4.4);
    glow.push(paint(lamp, 0xffd9a0)); // hot lamp face
  }
  return { body: bake(body), glow: bake(glow) };
}

function tankGeo(def) {
  const R0 = 9, Ht = 22, steel = 0x4a453d, band = 0x2b2620;
  const parts = [];
  const wall = new THREE.CylinderGeometry(R0, R0, Ht, 18, 1, true);
  wall.translate(0, Ht / 2, 0);
  parts.push(paint(wall, steel));
  const top = new THREE.SphereGeometry(R0, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  top.scale(1, 0.5, 1);
  top.translate(0, Ht, 0);
  parts.push(paint(top, steel));
  const floor = new THREE.CircleGeometry(R0, 18);
  floor.rotateX(-Math.PI / 2);
  floor.translate(0, 0.05, 0);
  parts.push(paint(floor, band));
  for (const hy of [Ht * 0.3, Ht * 0.6, Ht * 0.88]) {
    const ring = new THREE.CylinderGeometry(R0 + 0.25, R0 + 0.25, 0.7, 18, 1, true);
    ring.translate(0, hy, 0);
    parts.push(paint(ring, band));
  }
  // side ladder
  for (const ry of [3, 6, 9, 12, 15, 18]) {
    const rung = new THREE.BoxGeometry(1.6, 0.25, 0.25);
    rung.translate(0, ry, R0 + 0.2);
    parts.push(paint(rung, band));
  }
  for (const rx of [-0.7, 0.7]) {
    const rail = new THREE.BoxGeometry(0.25, Ht, 0.25);
    rail.translate(rx, Ht / 2, R0 + 0.2);
    parts.push(paint(rail, band));
  }
  return bake(parts);
}

function pipeGeo(def) {
  const len = 26, steel = 0x3a352d, dark = 0x201c16;
  const parts = [];
  const pipe = new THREE.CylinderGeometry(0.85, 0.85, len, 10);
  pipe.rotateZ(Math.PI / 2);
  pipe.translate(0, 5, 0);
  parts.push(paint(pipe, steel));
  const pipe2 = new THREE.CylinderGeometry(0.55, 0.55, len, 8);
  pipe2.rotateZ(Math.PI / 2);
  pipe2.translate(0, 6.8, 0.9);
  parts.push(paint(pipe2, steel));
  for (const sx of [-1, 1]) {
    const leg = new THREE.BoxGeometry(1.0, 5.4, 1.0);
    leg.translate(sx * len * 0.4, 2.7, 0);
    parts.push(paint(leg, dark));
    const flange = new THREE.CylinderGeometry(1.15, 1.15, 0.5, 10);
    flange.rotateZ(Math.PI / 2);
    flange.translate(sx * len * 0.5, 5, 0);
    parts.push(paint(flange, dark));
  }
  return bake(parts);
}

function fenceFrameGeo(W, Hf) {
  const steel = 0x2c2822;
  const parts = [];
  for (const sx of [-1, 1]) {
    const post = new THREE.BoxGeometry(0.9, Hf, 0.9);
    post.translate(sx * W / 2, Hf / 2, 0);
    parts.push(paint(post, steel));
  }
  for (const hy of [Hf - 0.4, 0.6]) {
    const rail = new THREE.CylinderGeometry(0.4, 0.4, W, 8);
    rail.rotateZ(Math.PI / 2);
    rail.translate(0, hy, 0);
    parts.push(paint(rail, steel));
  }
  return bake(parts);
}

function barrierGeo() {
  // jersey-style concrete barrier: wide base tapering to a narrower top band
  const parts = [
    new THREE.BoxGeometry(9, 1.1, 1.7),
    new THREE.BoxGeometry(9, 1.4, 1.0),
  ];
  parts[0].translate(0, 0.55, 0);
  parts[1].translate(0, 1.65, 0);
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return g;
}

/* ------------------------------------------------------------- buildScene -- */

export function buildScene(ctx) {
  const { group, samples, def, rnd, HALF } = ctx;
  const R = def.radius;
  const GY = -10;                    // sunken yard floor (below the elevated track)
  const mul = Math.max(1, R / 750);  // density scales with circuit size
  const dummy = new THREE.Object3D();
  const tmpV = new THREE.Vector3();

  // squish placement z the same way the track squishes (z uses r*0.72) so blocks
  // hug the loop shape instead of a plain circle.
  const place = (ang, rad) => tmpV.set(Math.cos(ang) * rad, GY, Math.sin(ang) * rad * 0.82);

  const CONTAINER_COLORS = [
    0x9c3a24, 0x2a5a9c, 0x2f6b3a, 0xb5591f, 0x6a6f74, 0x1f6b6b,
    0xb08a2a, 0x7a2a2a, 0x8a857b, 0x24506e, 0x3a6b4a, 0x8f8377,
  ];
  const pickColor = () =>
    new THREE.Color(CONTAINER_COLORS[(rnd() * CONTAINER_COLORS.length) | 0]);

  /* ---- ground ------------------------------------------------------------ */
  const concrete = concreteTex(rnd, def);
  concrete.repeat.set((R * 3) / 40, (R * 3) / 40);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(R * 3.0, 64),
    new THREE.MeshStandardMaterial({
      map: concrete,
      color: 0x6b6357,
      metalness: 0.05,
      roughness: 0.94,
      emissive: def.fog,
      emissiveIntensity: 0.25,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = GY;
  ground.receiveShadow = false;
  group.add(ground);

  /* ---- sky dome + stars -------------------------------------------------- */
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(R * 2.75, 24, 16),
    new THREE.MeshBasicMaterial({
      map: skyTex(def),
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
      toneMapped: false,
    })
  );
  dome.position.y = GY;
  group.add(dome);

  {
    const N = 520;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const warm = new THREE.Color(def.sun);
    const cool = new THREE.Color(0xbfc8ff);
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const a = rnd() * Math.PI * 2;
      const el = 0.12 + rnd() * 0.8;                 // upper hemisphere bias
      const rad = R * (1.6 + rnd() * 0.9);
      pos[i * 3] = Math.cos(a) * rad * Math.cos(el * 1.2);
      pos[i * 3 + 1] = GY + Math.sin(el * (Math.PI / 2)) * R * 1.6 + 40;
      pos[i * 3 + 2] = Math.sin(a) * rad * Math.cos(el * 1.2);
      c.copy(rnd() < 0.4 ? warm : cool).multiplyScalar(0.4 + rnd() * 0.5);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const stars = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size: 5.5, vertexColors: true, fog: false, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false })
    );
    stars.frustumCulled = false;
    group.add(stars);
  }

  /* ---- shipping containers (blocks + track-side rows) -------------------- */
  const geo40 = containerGeo(20);
  const geo20 = containerGeo(10);
  const containerMat = new THREE.MeshStandardMaterial({
    vertexColors: true, metalness: 0.32, roughness: 0.62,
  });
  const m40 = [], c40 = [], m20 = [], c20 = [];
  const CW = 6.2, CH = 6.0;

  const stackCol = (center, along, across, i, rows, j, bays, k, L, is20) => {
    dummy.position.copy(center)
      .addScaledVector(along, (i - (rows - 1) / 2) * (L + 1.4))
      .addScaledVector(across, (j - (bays - 1) / 2) * (CW + 1.0));
    dummy.position.y = GY + CH / 2 + k * (CH + 0.08);
    dummy.rotation.set(0, Math.atan2(along.x, along.z) + (rnd() - 0.5) * 0.03, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    (is20 ? m20 : m40).push(dummy.matrix.clone());
    (is20 ? c20 : c40).push(pickColor());
  };

  const along = new THREE.Vector3();
  const across = new THREE.Vector3();
  const blocks = Math.round(24 * mul);
  for (let b = 0; b < blocks; b++) {
    const ba = rnd() * Math.PI * 2;
    const br = R * (1.12 + rnd() * 1.2);
    const center = place(ba, br).clone();
    const yaw = (rnd() < 0.5 ? ba + Math.PI / 2 : ba) + (rnd() - 0.5) * 0.25;
    along.set(Math.cos(yaw), 0, Math.sin(yaw));
    across.set(-Math.sin(yaw), 0, Math.cos(yaw));
    const rows = 2 + ((rnd() * 4) | 0);
    const bays = 1 + ((rnd() * 3) | 0);
    const maxStack = 2 + ((rnd() * 3) | 0);
    const is20 = rnd() < 0.32;
    const L = is20 ? 10 : 20;
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < bays; j++) {
        const stack = Math.max(1, maxStack - ((rnd() * 2) | 0));
        for (let k = 0; k < stack; k++) stackCol(center, along, across, i, rows, j, bays, k, L, is20);
      }
  }

  // track-side stacks: line the elevated lane with container walls (on the yard
  // floor, rising toward road level) for an immersive corridor.
  const railStacks = Math.round(34 * mul);
  for (let n = 0; n < railStacks; n++) {
    const s = samples[(rnd() * samples.length) | 0];
    const sign = rnd() < 0.5 ? -1 : 1;
    const lat = sign * (HALF + 9 + rnd() * 46);
    const cx = s.pos.x + s.side.x * lat;
    const cz = s.pos.z + s.side.z * lat;
    const center = new THREE.Vector3(cx, GY, cz);
    // align along the track tangent (horizontal component)
    const yaw = Math.atan2(s.tangent.x, s.tangent.z);
    along.set(Math.cos(yaw), 0, Math.sin(yaw));
    across.set(-Math.sin(yaw), 0, Math.cos(yaw));
    const rows = 1 + ((rnd() * 3) | 0);
    const stack = 1 + ((rnd() * 4) | 0);
    const is20 = rnd() < 0.4;
    const L = is20 ? 10 : 20;
    for (let i = 0; i < rows; i++)
      for (let k = 0; k < stack; k++) stackCol(center, along, across, i, rows, 0, 1, k, L, is20);
  }

  if (m40.length) addInstanced(group, geo40, containerMat, m40, c40); else geo40.dispose();
  if (m20.length) addInstanced(group, geo20, containerMat, m20, c20); else geo20.dispose();

  /* ---- gantry cranes ----------------------------------------------------- */
  const crane = craneGeo(def);
  const craneBodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.5 });
  const craneGlowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const craneM = [];
  const craneCount = Math.max(6, Math.round(7 * mul));
  const sideH = new THREE.Vector3();
  const zAx = new THREE.Vector3();
  for (let i = 0; i < craneCount; i++) {
    const s = samples[Math.floor((i + 0.5) / craneCount * samples.length) % samples.length];
    sideH.set(s.side.x, 0, s.side.z).normalize();
    if (sideH.lengthSq() < 1e-4) sideH.set(1, 0, 0);
    zAx.crossVectors(sideH, UP).normalize();
    const m = new THREE.Matrix4().makeBasis(sideH, UP, zAx);
    m.setPosition(s.pos.x, GY, s.pos.z);
    craneM.push(m);
  }
  // a few background cranes standing over the yard
  const bgCranes = Math.round(4 * mul);
  for (let i = 0; i < bgCranes; i++) {
    const a = rnd() * Math.PI * 2;
    const p = place(a, R * (1.3 + rnd() * 0.9)).clone();
    dummy.position.copy(p);
    dummy.rotation.set(0, rnd() * Math.PI * 2, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    craneM.push(dummy.matrix.clone());
  }
  addInstanced(group, crane.body, craneBodyMat, craneM);
  addInstanced(group, crane.glow, craneGlowMat, craneM);

  /* ---- floodlight towers + ground light pools ---------------------------- */
  const flood = floodlightGeo(def);
  const floodBodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.5 });
  const floodGlowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: true });
  const floodM = [];
  const poolM = [];
  const poolPlane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const floodCount = Math.round(22 * mul);
  for (let i = 0; i < floodCount; i++) {
    const a = rnd() * Math.PI * 2;
    const rad = R * (1.1 + rnd() * 1.15);
    const p = place(a, rad).clone();
    // face roughly toward the loop centre so lamps light the yard interior
    const facing = Math.atan2(-p.z, -p.x);
    dummy.position.copy(p);
    dummy.rotation.set(0, facing - Math.PI / 2, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    floodM.push(dummy.matrix.clone());
    // pool in front of the tower
    const inward = new THREE.Vector3(-p.x, 0, -p.z).normalize();
    dummy.position.set(p.x + inward.x * 22, GY + 0.15, p.z + inward.z * 22);
    dummy.rotation.set(0, rnd() * Math.PI, 0);
    const ps = 46 + rnd() * 46;
    dummy.scale.set(ps, 1, ps);
    dummy.updateMatrix();
    poolM.push(dummy.matrix.clone());
  }
  // extra scattered pools for pooled-light variety on the concrete
  const extraPools = Math.round(24 * mul);
  for (let i = 0; i < extraPools; i++) {
    const p = place(rnd() * Math.PI * 2, R * (1.15 + rnd() * 1.2));
    dummy.position.set(p.x, GY + 0.12, p.z);
    dummy.rotation.set(0, rnd() * Math.PI, 0);
    const ps = 34 + rnd() * 50;
    dummy.scale.set(ps, 1, ps);
    dummy.updateMatrix();
    poolM.push(dummy.matrix.clone());
  }
  addInstanced(group, flood.body, floodBodyMat, floodM);
  addInstanced(group, flood.glow, floodGlowMat, floodM);
  const poolMat = new THREE.MeshBasicMaterial({
    map: poolTex(def), transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false, opacity: 0.85,
  });
  addInstanced(group, poolPlane, poolMat, poolM);

  /* ---- storage tanks + pipe runs ----------------------------------------- */
  const tankGeom = tankGeo(def);
  const tankMat = new THREE.MeshStandardMaterial({
    vertexColors: true, metalness: 0.55, roughness: 0.5, emissive: def.rail, emissiveIntensity: 0.05,
  });
  const pipeGeom = pipeGeo(def);
  const pipeMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.55 });
  const tankM = [];
  const pipeM = [];
  const tankFarms = Math.max(2, Math.round(2 * mul));
  for (let f = 0; f < tankFarms; f++) {
    const fa = rnd() * Math.PI * 2;
    const fr = R * (1.25 + rnd() * 0.95);
    const fc = place(fa, fr).clone();
    const cols = 3 + ((rnd() * 2) | 0);
    const rowsT = 2 + ((rnd() * 2) | 0);
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rowsT; j++) {
        if (rnd() < 0.12) continue; // occasional gap
        dummy.position.set(fc.x + (i - (cols - 1) / 2) * 26, GY, fc.z + (j - (rowsT - 1) / 2) * 26);
        dummy.rotation.set(0, 0, 0);
        const sc = 0.8 + rnd() * 0.5;
        dummy.scale.set(sc, sc, sc);
        dummy.updateMatrix();
        tankM.push(dummy.matrix.clone());
      }
    // pipe runs threading between the tanks
    const nPipes = 6 + ((rnd() * 6) | 0);
    for (let p = 0; p < nPipes; p++) {
      dummy.position.set(fc.x + (rnd() - 0.5) * cols * 26, GY, fc.z + (rnd() - 0.5) * rowsT * 26);
      dummy.rotation.set(0, rnd() < 0.5 ? 0 : Math.PI / 2, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      pipeM.push(dummy.matrix.clone());
    }
  }
  if (tankM.length) addInstanced(group, tankGeom, tankMat, tankM); else tankGeom.dispose();
  if (pipeM.length) addInstanced(group, pipeGeom, pipeMat, pipeM); else pipeGeom.dispose();

  /* ---- perimeter chain-link fence ---------------------------------------- */
  const fenceW = 46, fenceH = 10;
  const fenceRad = R * 2.35;
  const fenceFrame = fenceFrameGeo(fenceW, fenceH);
  const fenceFrameMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.55 });
  const fenceMeshGeo = new THREE.PlaneGeometry(fenceW - 1.8, fenceH - 1.4).translate(0, fenceH / 2 - 0.2, 0);
  const chain = chainTex();
  chain.repeat.set(6, 1.3);
  const fenceMeshMat = new THREE.MeshStandardMaterial({
    map: chain, color: 0x8a8578, side: THREE.DoubleSide,
    transparent: false, alphaTest: 0.35, metalness: 0.5, roughness: 0.6, depthWrite: true,
  });
  const fenceM = [];
  const panels = Math.round((Math.PI * 2 * fenceRad) / fenceW);
  for (let i = 0; i < panels; i++) {
    const a = (i / panels) * Math.PI * 2;
    const p = new THREE.Vector3(Math.cos(a) * fenceRad, GY, Math.sin(a) * fenceRad * 0.82);
    dummy.position.copy(p);
    dummy.rotation.set(0, -a + Math.PI / 2, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    fenceM.push(dummy.matrix.clone());
  }
  addInstanced(group, fenceFrame, fenceFrameMat, fenceM);
  addInstanced(group, fenceMeshGeo, fenceMeshMat, fenceM);

  /* ---- hazard barriers lining the track ---------------------------------- */
  const barGeo = barrierGeo();
  const hazard = hazardTex(def);
  const barMat = new THREE.MeshStandardMaterial({
    map: hazard, emissiveMap: hazard, emissive: 0xffffff, emissiveIntensity: 0.5,
    metalness: 0.1, roughness: 0.7,
  });
  const barM = [];
  for (let i = 0; i < samples.length; i += 2) {
    if (rnd() < 0.45) continue; // leave gaps — never wall the lane in
    const s = samples[i];
    const sign = rnd() < 0.5 ? -1 : 1;
    const lat = sign * (HALF + 2.4);
    dummy.position.set(
      s.pos.x + s.side.x * lat,
      s.pos.y + 0.6,
      s.pos.z + s.side.z * lat
    );
    dummy.rotation.set(0, Math.atan2(s.tangent.x, s.tangent.z), 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    barM.push(dummy.matrix.clone());
  }
  if (barM.length) addInstanced(group, barGeo, barMat, barM); else barGeo.dispose();

  /* ---- glowing yard signage --------------------------------------------- */
  const signGeo = new THREE.PlaneGeometry(9, 4.5);
  const signMat = new THREE.MeshBasicMaterial({
    map: signTex(rnd, def), transparent: true, toneMapped: false, side: THREE.DoubleSide, depthWrite: false,
  });
  const signM = [];
  const signCount = Math.round(16 * mul);
  for (let i = 0; i < signCount; i++) {
    const a = rnd() * Math.PI * 2;
    const p = place(a, R * (1.12 + rnd() * 0.6));
    dummy.position.set(p.x, GY + 8 + rnd() * 14, p.z);
    dummy.lookAt(0, dummy.position.y, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    signM.push(dummy.matrix.clone());
  }
  addInstanced(group, signGeo, signMat, signM);
}
