/**
 * GRID RUSH — scenery module: GLASS HARBOR
 * "Flagship reflective water harbor" — a large animated three.js Water sea beneath
 * an elevated neon track, a distant coastal skyline across the water, floating
 * buoys + billboards, low drifting fog, calm reflective dusk mood.
 *
 * Interface: export function buildScene(ctx) — add all meshes to ctx.group.
 *   ctx = { group, samples, def, rnd, HALF, totalLength }
 *
 * PERFORMANCE
 *   - ONE big Water plane (its reflection pass is the only per-frame scene re-render).
 *   - Every repeated prop is a single InstancedMesh (skyline towers, neon strips,
 *     buoys, buoy lamps, billboards, track pylons, mist banks) → ~10 draw calls total.
 *   - Stars are a single THREE.Points cloud (1 draw call).
 *   - Deterministic: ALL randomness is ctx.rnd (never Math.random).
 *   - Self-contained: only imports 'three' and 'three/addons/objects/Water.js'.
 *     The water normal map + mist alpha disc are procedural in-module DataTextures.
 */

import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';

const TAU = Math.PI * 2;

export function buildScene(ctx) {
  const { group, samples, def, rnd, HALF } = ctx;
  const R = def.radius; // ~1034 for glass_harbor — BIG
  const rail = def.rail; // mint 0x39ff88
  const accent = def.accent; // cyan 0x00f0ff
  const WATER_Y = -7; // just below the lowest road dip (~-4.1) → track skims the sea

  // ------------------------------------------------------------------ palette
  const railCol = new THREE.Color(rail);
  const accentCol = new THREE.Color(accent);
  const fogCol = new THREE.Color(def.fog);

  // =====================================================================
  // 1) THE SEA — one large animated reflective three.js Water plane
  // =====================================================================
  const waterNormals = _makeWaterNormals(rnd);
  const seaSize = R * 12; // ~12400 — fades into fog long before the edge shows
  const waterGeo = new THREE.PlaneGeometry(seaSize, seaSize);
  const sunDir = new THREE.Vector3(-0.35, 0.09, -0.93).normalize(); // low dusk angle

  const water = new Water(waterGeo, {
    textureWidth: 512,
    textureHeight: 512,
    waterNormals,
    sunDirection: sunDir,
    sunColor: def.sun, // warm dusk glint (0xfff0c8)
    waterColor: 0x0a2f38, // deep cyan-teal harbor water
    distortionScale: 2.6, // calm, not choppy
    fog: true, // respect the scene's harbor fog so the sea meets the misty horizon
    alpha: 1.0,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  // A little more ripple density than the default across this enormous plane.
  water.material.uniforms['size'].value = 4.5;
  // Drive the ripple animation (and drifting mist, below) from the water's own
  // per-render callback — the module has no other update hook. During Water's
  // reflection pass the plane is hidden, so this fires exactly once per frame.
  const _clock = { t: 0 };
  const _origOBR = water.onBeforeRender;
  group.add(water);

  // =====================================================================
  // 2) DISTANT COASTAL NEON SKYLINE — across the water, on the far shore
  //    towers (dark, faintly lit) + one bright neon vertical per tower.
  // =====================================================================
  const TOWERS = 140;
  const towerGeo = new THREE.BoxGeometry(1, 1, 1);
  const towerMat = new THREE.MeshStandardMaterial({
    color: 0x0b1420,
    metalness: 0.6,
    roughness: 0.5,
    emissive: 0x0a1a22,
    emissiveIntensity: 0.5,
  });
  const towers = new THREE.InstancedMesh(towerGeo, towerMat, TOWERS);

  // Thin, tall emissive edge-strips give the skyline its crisp neon reflection.
  const stripGeo = new THREE.BoxGeometry(1, 1, 1);
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const strips = new THREE.InstancedMesh(stripGeo, stripMat, TOWERS);

  const dummy = new THREE.Object3D();
  const tmpCol = new THREE.Color();
  for (let i = 0; i < TOWERS; i++) {
    const a = rnd() * TAU;
    const rad = R * (2.1 + rnd() * 1.1); // far-shore ring
    const cx = Math.cos(a) * rad;
    const cz = Math.sin(a) * rad * 0.9;
    const w = 14 + rnd() * 34;
    const d = 14 + rnd() * 34;
    const h = 40 + rnd() * 150 * (0.5 + 0.5 * rnd());
    const baseY = WATER_Y + 1; // rises straight out of the far water
    // tower body
    dummy.position.set(cx, baseY + h * 0.5, cz);
    dummy.rotation.set(0, a + Math.PI * 0.5, 0);
    dummy.scale.set(w, h, d);
    dummy.updateMatrix();
    towers.setMatrixAt(i, dummy.matrix);
    towers.setColorAt(i, tmpCol.copy(rnd() < 0.5 ? railCol : accentCol).multiplyScalar(0.28));
    // one bright neon vertical strip on the water-facing edge
    const stripCol = rnd() < 0.55 ? railCol : accentCol;
    const edge = w * 0.5 * (rnd() < 0.5 ? -1 : 1);
    dummy.position.set(cx - Math.sin(a) * edge, baseY + h * 0.5, cz + Math.cos(a) * edge);
    dummy.rotation.set(0, a + Math.PI * 0.5, 0);
    dummy.scale.set(0.9, h * (0.55 + rnd() * 0.4), 0.9);
    dummy.updateMatrix();
    strips.setMatrixAt(i, dummy.matrix);
    strips.setColorAt(i, tmpCol.copy(stripCol));
  }
  towers.instanceMatrix.needsUpdate = true;
  if (towers.instanceColor) towers.instanceColor.needsUpdate = true;
  strips.instanceMatrix.needsUpdate = true;
  if (strips.instanceColor) strips.instanceColor.needsUpdate = true;
  group.add(towers);
  group.add(strips);

  // =====================================================================
  // 3) TRACK SUPPORT PYLONS — thin lit columns dropping from the road into
  //    the sea, so the elevated ribbon reads as supported over water.
  // =====================================================================
  const pylonStep = 5;
  const pylonList = [];
  for (let i = 0; i < samples.length; i += pylonStep) pylonList.push(samples[i]);
  const pylonGeo = new THREE.CylinderGeometry(1, 1.25, 1, 8);
  const pylonMat = new THREE.MeshStandardMaterial({
    color: 0x08121a,
    metalness: 0.7,
    roughness: 0.4,
    emissive: rail,
    emissiveIntensity: 0.22,
  });
  const pylons = new THREE.InstancedMesh(pylonGeo, pylonMat, pylonList.length);
  const PYLON_FOOT = WATER_Y - 9; // plunge below the surface
  for (let i = 0; i < pylonList.length; i++) {
    const s = pylonList[i];
    const sign = i % 2 === 0 ? -1 : 1;
    const px = s.pos.x + s.side.x * HALF * sign;
    const pz = s.pos.z + s.side.z * HALF * sign;
    const topY = s.pos.y - 0.4;
    const height = topY - PYLON_FOOT;
    dummy.position.set(px, PYLON_FOOT + height * 0.5, pz);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1.1, height, 1.1);
    dummy.updateMatrix();
    pylons.setMatrixAt(i, dummy.matrix);
  }
  pylons.instanceMatrix.needsUpdate = true;
  group.add(pylons);

  // =====================================================================
  // 4) FLOATING BUOYS — scattered across the harbor between track & shore.
  //    body (dark, standard) + emissive lamp (basic) that reflects in the water.
  // =====================================================================
  const BUOYS = 46;
  const buoyGeo = new THREE.CylinderGeometry(1.1, 1.9, 4.2, 7);
  const buoyMat = new THREE.MeshStandardMaterial({
    color: 0x0c1a1e,
    metalness: 0.4,
    roughness: 0.6,
    emissive: 0x0a2028,
    emissiveIntensity: 0.4,
  });
  const buoys = new THREE.InstancedMesh(buoyGeo, buoyMat, BUOYS);
  const lampGeo = new THREE.OctahedronGeometry(1.15, 0);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, BUOYS);
  for (let i = 0; i < BUOYS; i++) {
    const a = rnd() * TAU;
    const rad = R * (1.15 + rnd() * 0.95); // harbor water, outside the track band
    const bx = Math.cos(a) * rad;
    const bz = Math.sin(a) * rad * 0.85;
    dummy.rotation.set(0, rnd() * TAU, 0);
    dummy.position.set(bx, WATER_Y + 1.6, bz);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    buoys.setMatrixAt(i, dummy.matrix);
    dummy.position.set(bx, WATER_Y + 4.4, bz);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    lamps.setMatrixAt(i, dummy.matrix);
    lamps.setColorAt(i, tmpCol.copy(rnd() < 0.5 ? railCol : accentCol));
  }
  buoys.instanceMatrix.needsUpdate = true;
  lamps.instanceMatrix.needsUpdate = true;
  if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
  group.add(buoys);
  group.add(lamps);

  // =====================================================================
  // 5) FLOATING BILLBOARDS — neon signage drifting over the harbor.
  // =====================================================================
  const BOARDS = 26;
  const boardGeo = new THREE.BoxGeometry(1, 1, 0.5);
  const boardMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.6,
    toneMapped: false,
  });
  const boards = new THREE.InstancedMesh(boardGeo, boardMat, BOARDS);
  for (let i = 0; i < BOARDS; i++) {
    const a = rnd() * TAU;
    const rad = R * (1.25 + rnd() * 0.7);
    const bx = Math.cos(a) * rad;
    const bz = Math.sin(a) * rad * 0.9;
    const h = 16 + rnd() * 40;
    dummy.position.set(bx, h, bz);
    dummy.scale.set(10 + rnd() * 16, 4 + rnd() * 6, 1);
    dummy.lookAt(0, h, 0);
    dummy.updateMatrix();
    boards.setMatrixAt(i, dummy.matrix);
    boards.setColorAt(i, tmpCol.copy(rnd() < 0.5 ? railCol : accentCol));
  }
  boards.instanceMatrix.needsUpdate = true;
  if (boards.instanceColor) boards.instanceColor.needsUpdate = true;
  group.add(boards);

  // =====================================================================
  // 6) LOW DRIFTING FOG — soft mist banks lying flat over the water.
  //    Alpha comes from a procedural radial disc so each card reads as vapor,
  //    not a rectangle. Slowly drifts via the water's per-frame callback.
  // =====================================================================
  const MIST = 34;
  const mistTex = _makeSoftDisc();
  const mistGroup = new THREE.Group();
  const mistGeo = new THREE.PlaneGeometry(1, 1);
  const mistMat = new THREE.MeshBasicMaterial({
    map: mistTex,
    color: fogCol,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.NormalBlending,
  });
  const mist = new THREE.InstancedMesh(mistGeo, mistMat, MIST);
  for (let i = 0; i < MIST; i++) {
    const a = rnd() * TAU;
    const rad = R * (0.4 + rnd() * 1.8);
    const mx = Math.cos(a) * rad;
    const mz = Math.sin(a) * rad * 0.9;
    const sc = 220 + rnd() * 420;
    dummy.position.set(mx, WATER_Y + 2 + rnd() * 5, mz);
    dummy.rotation.set(-Math.PI / 2, 0, rnd() * TAU);
    dummy.scale.set(sc, sc, 1);
    dummy.updateMatrix();
    mist.setMatrixAt(i, dummy.matrix);
  }
  mist.instanceMatrix.needsUpdate = true;
  mist.frustumCulled = false;
  mistGroup.add(mist);
  group.add(mistGroup);

  // =====================================================================
  // 7) STARFIELD — faint dusk stars high overhead (single Points draw call).
  // =====================================================================
  const STARS = 380;
  const starPos = new Float32Array(STARS * 3);
  const starCol = new Float32Array(STARS * 3);
  for (let i = 0; i < STARS; i++) {
    const a = rnd() * TAU;
    const rad = R * (2.5 + rnd() * 4);
    const y = 220 + rnd() * 900;
    starPos[i * 3] = Math.cos(a) * rad;
    starPos[i * 3 + 1] = y;
    starPos[i * 3 + 2] = Math.sin(a) * rad;
    const c = rnd() < 0.5 ? railCol : accentCol;
    const b = 0.5 + rnd() * 0.5;
    starCol[i * 3] = 0.7 * b + c.r * 0.3;
    starCol[i * 3 + 1] = 0.7 * b + c.g * 0.3;
    starCol[i * 3 + 2] = 0.8 * b + c.b * 0.3;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
  const starMat = new THREE.PointsMaterial({
    size: 7,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    toneMapped: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  group.add(stars);

  // ------------------------------------------------------------------ animate
  // Wrap Water's own onBeforeRender: advance ripple time + drift the mist a
  // little each frame. (Water hides itself during its reflection pass, so this
  // runs once per real frame, not during the mirror render.)
  water.onBeforeRender = function (renderer, scene, camera, geometry, material, grp) {
    _clock.t += 1 / 60;
    water.material.uniforms['time'].value = _clock.t;
    mistGroup.position.x = Math.sin(_clock.t * 0.05) * 60;
    mistGroup.position.z = Math.cos(_clock.t * 0.037) * 60;
    _origOBR.call(this, renderer, scene, camera, geometry, material, grp);
  };
}

// ============================================================================
// Procedural in-module textures (no external files)
// ============================================================================

/**
 * Tileable water normal map as a DataTexture. Height = sum of a few sine waves
 * with INTEGER wave numbers (so it tiles seamlessly); normals come from the
 * analytic derivatives. Seeded via ctx.rnd → deterministic.
 */
function _makeWaterNormals(rnd) {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const nWaves = 7;
  const waves = [];
  for (let i = 0; i < nWaves; i++) {
    const kx = (1 + Math.floor(rnd() * 6)) * (rnd() < 0.5 ? -1 : 1);
    const ky = (1 + Math.floor(rnd() * 6)) * (rnd() < 0.5 ? -1 : 1);
    waves.push({ kx, ky, amp: 0.65 / (1 + i * 0.55), phase: rnd() * TAU });
  }
  const bump = 1.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let dhdu = 0;
      let dhdv = 0;
      for (let w = 0; w < nWaves; w++) {
        const wv = waves[w];
        const ph = TAU * (wv.kx * u + wv.ky * v) + wv.phase;
        const c = Math.cos(ph);
        dhdu += wv.amp * TAU * wv.kx * c;
        dhdv += wv.amp * TAU * wv.ky * c;
      }
      let nx = -dhdu * bump;
      let ny = -dhdv * bump;
      let nz = 1.0;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      const o = (y * size + x) * 4;
      data[o] = (nx * 0.5 + 0.5) * 255;
      data[o + 1] = (ny * 0.5 + 0.5) * 255;
      data[o + 2] = (nz * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Soft radial alpha disc for mist cards (white RGB, feathered alpha). */
function _makeSoftDisc() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c;
      const dy = (y - c) / c;
      const r = Math.min(1, Math.hypot(dx, dy));
      const a = Math.pow(1 - r, 1.8); // feathered edge
      const o = (y * size + x) * 4;
      data[o] = 255;
      data[o + 1] = 255;
      data[o + 2] = 255;
      data[o + 3] = a * 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
