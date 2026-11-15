import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * VOLT CANYON — tight industrial gorge scenery module.
 *
 * Theme: a claustrophobic magnetic gorge. Towering warning-striped megastructure
 * walls hug both sides of the narrow track, lattice power pylons stride the rim
 * with sagging cable runs strung between them, transformer stacks and orange
 * glowing vents cling to the wall base, industrial gantries span overhead, and
 * amber sparks/embers drift up through the corridor. Punishing, tall, tight.
 *
 * Palette (from def): rail = amber #ffe566 (primary neon), accent = orange #ff6b2b.
 *
 * Contract:  buildScene(ctx)  — ADD everything to ctx.group (game disposes it).
 *   ctx = { group, samples, def, rnd, HALF, totalLength }
 *
 * Performance: every repeated prop is an InstancedMesh or a single merged mesh.
 * Target ~13 draw calls total for the whole gorge regardless of instance count.
 */
export function buildScene(ctx) {
  const { group, samples, def, rnd, HALF } = ctx;
  const N = samples.length;
  const R = def.radius;

  const UP = new THREE.Vector3(0, 1, 0);
  const railC = new THREE.Color(def.rail);     // amber
  const accentC = new THREE.Color(def.accent); // orange
  const STEEL = 0x0a0e15;                       // near-black industrial steel

  // Reusable scratch objects (avoid per-instance allocation in hot loops).
  const _m = new THREE.Matrix4();
  const _s = new THREE.Vector3();
  const _flat = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const dummy = new THREE.Object3D();

  const smp = (i) => samples[((i % N) + N) % N];
  const flatTan = (t, out) => {
    out.set(t.x, 0, t.z);
    if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
    return out.normalize();
  };
  /** Compose an oriented, scaled, positioned matrix into _m: local x→side, y→up, z→flatTangent. */
  const orient = (side, flat, sx, sy, sz, px, py, pz) => {
    _m.makeBasis(side, UP, flat);
    _m.scale(_s.set(sx, sy, sz));
    _m.setPosition(px, py, pz);
    return _m;
  };
  /** Baked thin cylinder beam (transform pre-applied) — for merging into cable/beam runs. */
  const beamGeo = (a, b, r) => {
    const dir = b.clone().sub(a);
    const len = dir.length() || 0.001;
    const g = new THREE.CylinderGeometry(r, r, len, 5, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(
      a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)
    ));
    return g;
  };

  const gorgeGap = HALF * 2.35; // inner wall face sits ~this far off-centre — tight but drivable

  // ---------------------------------------------------------------------------
  // 1) GROUND — dark metal canyon floor + amber tech grid
  // ---------------------------------------------------------------------------
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(R * 2.9, 64),
    new THREE.MeshStandardMaterial({
      color: 0x05070c, metalness: 0.55, roughness: 0.8,
      emissive: railC, emissiveIntensity: 0.05,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3;
  group.add(floor);

  const grid = new THREE.GridHelper(R * 3.2, 64, def.rail, 0x121820);
  grid.position.y = -2.9;
  grid.material.transparent = true;
  grid.material.opacity = 0.16;
  grid.material.toneMapped = false;
  group.add(grid);

  // ---------------------------------------------------------------------------
  // Collect placements while walking the track. Instanced meshes are built after.
  // ---------------------------------------------------------------------------
  const wallMats = [];                 // canyon wall slabs
  const stripeMats = [];               // warning-stripe bands (amber/orange)
  const stripeCols = [];
  const ventMats = [];                 // orange glowing vents (walls + transformers)
  const xfmrMats = [];                 // transformer stack bodies
  const gantryMats = [];               // overhead spanning beams
  const gantryLampMats = [];           // orange hazard lamps under gantries
  const pylonMats = [];                // lattice power pylons (uniform-scaled)
  const beaconMats = [];               // amber beacon lights atop pylons
  const cableGeos = [];                // sagging cable runs between pylons
  const pylonsBySide = { '-1': [], '1': [] };

  const wallStep = 3;
  const WALL_STEEL = new THREE.MeshStandardMaterial({
    color: STEEL, metalness: 0.7, roughness: 0.5,
    emissive: railC, emissiveIntensity: 0.06,
  });

  for (const sign of [-1, 1]) {
    for (let i = 0; i < N; i += wallStep) {
      const s = smp(i);
      const sNext = smp(i + wallStep);
      const side = s.side;
      flatTan(s.tangent, _flat);

      // Wall distance + dimensions (mild jitter so the gorge reads hand-built).
      const dist = gorgeGap + rnd() * HALF * 0.5;
      const thick = 10 + rnd() * 14;
      const segLen = s.pos.distanceTo(sNext.pos) * 1.18; // overlap to hide curve gaps
      // Height: mostly tall walls, occasional towering megastructure spike.
      let h = 78 + rnd() * 70;
      if (rnd() < 0.22) h += 70 + rnd() * 140;
      const baseY = s.pos.y - 8;

      const px = s.pos.x + side.x * sign * dist;
      const pz = s.pos.z + side.z * sign * dist;
      wallMats.push(orient(side, _flat, thick, h, segLen, px, baseY + h * 0.5, pz).clone());

      // Warning stripes on the inner (track-facing) face, two heights.
      const faceLat = sign * (dist - thick * 0.5 - 0.5);
      const fx = s.pos.x + side.x * faceLat;
      const fz = s.pos.z + side.z * faceLat;
      for (let k = 0; k < 2; k++) {
        const stripeY = baseY + 10 + k * 16 + rnd() * 4;
        stripeMats.push(orient(side, _flat, 0.8, 3.0, segLen * 0.86, fx, stripeY, fz).clone());
        stripeCols.push(((i + k) & 1) ? accentC : railC);
      }

      // Scattered orange vents glowing on the wall face.
      if (rnd() < 0.7) {
        const vy = baseY + 14 + rnd() * (h * 0.55);
        ventMats.push(orient(side, _flat, 0.5, 3 + rnd() * 4, 4 + rnd() * 5, fx, vy, fz).clone());
      }

      // Transformer stack hunkered against the wall base (intermittent).
      if (i % (wallStep * 4) === 0 && rnd() < 0.85) {
        const tLat = sign * (dist - thick * 0.5 - 8);
        const tx = s.pos.x + side.x * tLat;
        const tz = s.pos.z + side.z * tLat;
        const tw = 10 + rnd() * 8, th = 8 + rnd() * 8, td = 8 + rnd() * 6;
        const ty = baseY + th * 0.5 + 1;
        xfmrMats.push(orient(side, _flat, tw, th, td, tx, ty, tz).clone());
        // orange vent panel on the transformer's track-facing face
        const vLat = sign * (tLat - td * 0.5 - 0.3);
        const vx = s.pos.x + side.x * vLat;
        const vz = s.pos.z + side.z * vLat;
        ventMats.push(orient(side, _flat, 0.5, th * 0.55, tw * 0.7, vx, ty, vz).clone());
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 2) CANYON WALL SLABS — one InstancedMesh
  // ---------------------------------------------------------------------------
  addInstanced(new THREE.BoxGeometry(1, 1, 1), WALL_STEEL, wallMats);

  // ---------------------------------------------------------------------------
  // 3) WARNING STRIPES — one InstancedMesh, per-instance amber/orange tint
  // ---------------------------------------------------------------------------
  if (stripeMats.length) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.9, toneMapped: false,
    });
    const inst = new THREE.InstancedMesh(geo, mat, stripeMats.length);
    for (let i = 0; i < stripeMats.length; i++) {
      inst.setMatrixAt(i, stripeMats[i]);
      inst.setColorAt(i, stripeCols[i]);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    group.add(inst);
  }

  // ---------------------------------------------------------------------------
  // 4) ORANGE VENTS (walls + transformers) — one emissive InstancedMesh
  // ---------------------------------------------------------------------------
  addInstanced(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({
      color: accentC, transparent: true, opacity: 0.92, toneMapped: false,
    }),
    ventMats
  );

  // ---------------------------------------------------------------------------
  // 5) TRANSFORMER STACK BODIES — one InstancedMesh
  // ---------------------------------------------------------------------------
  addInstanced(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({
      color: 0x0c1119, metalness: 0.75, roughness: 0.4,
      emissive: accentC, emissiveIntensity: 0.12,
    }),
    xfmrMats
  );

  // ---------------------------------------------------------------------------
  // 6) LATTICE POWER PYLONS + cable runs — pylons instanced, cables merged
  // ---------------------------------------------------------------------------
  const ARM_TOP_Y = 122, ARM_TOP_HALF = 14; // must match buildPylonGeometry top arm
  const pylonGeo = buildPylonGeometry();
  const pylonStep = Math.max(4, Math.round(N / 22)); // ~11 per side
  for (const sign of [-1, 1]) {
    for (let i = 0; i < N; i += pylonStep) {
      const s = smp(i);
      const side = s.side;
      flatTan(s.tangent, _flat);
      const dist = gorgeGap + HALF * 1.3 + rnd() * HALF * 0.6; // just beyond the walls, on the rim
      const sc = 0.95 + rnd() * 0.4;
      const px = s.pos.x + side.x * sign * dist;
      const py = s.pos.y - 6;
      const pz = s.pos.z + side.z * sign * dist;
      pylonMats.push(orient(side, _flat, sc, sc, sc, px, py, pz).clone());

      // Beacon light atop the mast.
      beaconMats.push(new THREE.Matrix4().compose(
        new THREE.Vector3(px, py + 132 * sc, pz),
        new THREE.Quaternion(),
        new THREE.Vector3(1, 1, 1)
      ));

      // Store rim/tip data for cabling: top-arm tips at ±ARM_TOP_HALF along side.
      pylonsBySide[sign].push({
        base: new THREE.Vector3(px, py, pz),
        side: side.clone(), sc,
      });
    }
  }
  // Sagging cables between consecutive same-side pylons (both top-arm tips).
  for (const sign of ['-1', '1']) {
    const list = pylonsBySide[sign];
    for (let i = 0; i + 1 < list.length; i++) {
      const A = list[i], B = list[i + 1];
      for (const sx of [-1, 1]) {
        const tipA = A.base.clone()
          .addScaledVector(A.side, sx * ARM_TOP_HALF * A.sc)
          .add(new THREE.Vector3(0, ARM_TOP_Y * A.sc, 0));
        const tipB = B.base.clone()
          .addScaledVector(B.side, sx * ARM_TOP_HALF * B.sc)
          .add(new THREE.Vector3(0, ARM_TOP_Y * B.sc, 0));
        const span = tipA.distanceTo(tipB);
        const sag = tipA.clone().add(tipB).multiplyScalar(0.5);
        sag.y -= span * 0.11; // catenary droop
        cableGeos.push(beamGeo(tipA, sag, 0.35));
        cableGeos.push(beamGeo(sag, tipB, 0.35));
      }
    }
  }
  addInstanced(
    pylonGeo,
    new THREE.MeshStandardMaterial({
      color: STEEL, metalness: 0.72, roughness: 0.5,
      emissive: railC, emissiveIntensity: 0.09,
    }),
    pylonMats
  );
  if (cableGeos.length) {
    const merged = mergeGeometries(cableGeos, false);
    cableGeos.forEach((g) => g.dispose());
    if (merged) {
      group.add(new THREE.Mesh(
        merged,
        new THREE.MeshBasicMaterial({
          color: railC, transparent: true, opacity: 0.55, toneMapped: false,
        })
      ));
    }
  }
  // Amber beacon lights atop pylons — one InstancedMesh.
  addInstanced(
    new THREE.OctahedronGeometry(1.6, 0),
    new THREE.MeshBasicMaterial({
      color: railC, transparent: true, opacity: 0.9, toneMapped: false,
    }),
    beaconMats
  );

  // ---------------------------------------------------------------------------
  // 7) OVERHEAD GANTRIES — beams spanning the gorge above the track
  // ---------------------------------------------------------------------------
  const gantryStep = Math.max(8, Math.round(N / 9)); // ~9 gantries
  for (let i = Math.floor(gantryStep / 2); i < N; i += gantryStep) {
    const s = smp(i);
    const side = s.side;
    flatTan(s.tangent, _flat);
    const spanW = (gorgeGap + HALF * 1.1) * 2;      // reach past both walls
    const gy = s.pos.y + 40 + rnd() * 20;
    gantryMats.push(orient(side, _flat, spanW, 3, 4.5, s.pos.x, gy, s.pos.z).clone());
    // orange hazard light hanging under the gantry centre
    gantryLampMats.push(orient(side, _flat, 3, 1.2, 3, s.pos.x, gy - 2.5, s.pos.z).clone());
  }
  addInstanced(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({
      color: 0x0b0f17, metalness: 0.7, roughness: 0.45,
      emissive: railC, emissiveIntensity: 0.07,
    }),
    gantryMats
  );
  // Under-gantry hazard lamps (folded into their own tiny emissive instanced mesh).
  addInstanced(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: accentC, toneMapped: false }),
    gantryLampMats
  );

  // ---------------------------------------------------------------------------
  // 8) FAR MEGASTRUCTURES — distant canyon silhouette (depth layering)
  // ---------------------------------------------------------------------------
  const farMats = [];
  const farCols = [];
  const FAR_COUNT = 46;
  for (let i = 0; i < FAR_COUNT; i++) {
    const a = rnd() * Math.PI * 2;
    const r = R * (1.35 + rnd() * 1.35);
    const h = 120 + rnd() * 340;
    const w = 30 + rnd() * 80;
    const d = 30 + rnd() * 80;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    dummy.position.set(x, h * 0.5 - 6, z);
    dummy.rotation.set(0, Math.atan2(z, x) + (rnd() - 0.5) * 0.6, 0);
    dummy.scale.set(w, h, d);
    dummy.updateMatrix();
    farMats.push(dummy.matrix.clone());
    farCols.push(rnd() < 0.5 ? railC : accentC);
  }
  if (farMats.length) {
    const inst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({
        color: 0x06090f, metalness: 0.6, roughness: 0.6,
        emissive: 0xffffff, emissiveIntensity: 0.05,
      }),
      farMats.length
    );
    for (let i = 0; i < farMats.length; i++) {
      inst.setMatrixAt(i, farMats[i]);
      inst.setColorAt(i, farCols[i]); // tints the faint emissive amber/orange
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    group.add(inst);
  }

  // ---------------------------------------------------------------------------
  // 9) SPARKS / EMBERS — drifting instanced Points, animated via onBeforeRender
  // ---------------------------------------------------------------------------
  const EMB = 320;
  const pos = new Float32Array(EMB * 3);
  const col = new Float32Array(EMB * 3);
  const baseX = new Float32Array(EMB);
  const baseZ = new Float32Array(EMB);
  const baseY = new Float32Array(EMB);
  const rangeY = new Float32Array(EMB);
  const speed = new Float32Array(EMB);
  const phase = new Float32Array(EMB);
  const sway = new Float32Array(EMB);
  const cC = new THREE.Color();
  for (let i = 0; i < EMB; i++) {
    const s = smp(Math.floor(rnd() * N));
    const lat = (rnd() * 2 - 1) * gorgeGap * 0.9;
    const along = (rnd() * 2 - 1) * 10;
    baseX[i] = s.pos.x + s.side.x * lat + s.tangent.x * along;
    baseZ[i] = s.pos.z + s.side.z * lat + s.tangent.z * along;
    baseY[i] = s.pos.y + 1 + rnd() * 6;
    rangeY[i] = 20 + rnd() * 40;
    speed[i] = 6 + rnd() * 12;
    phase[i] = rnd() * 1000;
    sway[i] = 1 + rnd() * 3;
    pos[i * 3] = baseX[i];
    pos[i * 3 + 1] = baseY[i];
    pos[i * 3 + 2] = baseZ[i];
    cC.copy(rnd() < 0.55 ? railC : accentC);
    col[i * 3] = cC.r; col[i * 3 + 1] = cC.g; col[i * 3 + 2] = cC.b;
  }
  const embGeo = new THREE.BufferGeometry();
  embGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  embGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const embMat = new THREE.PointsMaterial({
    size: 2.2, sizeAttenuation: true, vertexColors: true,
    transparent: true, opacity: 0.9, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const embers = new THREE.Points(embGeo, embMat);
  embers.frustumCulled = false;
  const embArr = embGeo.attributes.position.array;
  embers.onBeforeRender = () => {
    const t = performance.now() * 0.001;
    for (let i = 0; i < EMB; i++) {
      const rise = (t * speed[i] + phase[i]) % rangeY[i];
      embArr[i * 3] = baseX[i] + Math.sin(t * 0.8 + phase[i]) * sway[i];
      embArr[i * 3 + 1] = baseY[i] + rise;
      embArr[i * 3 + 2] = baseZ[i] + Math.cos(t * 0.7 + phase[i]) * sway[i];
    }
    embGeo.attributes.position.needsUpdate = true;
  };
  group.add(embers);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function addInstanced(geo, mat, mats) {
    if (!mats.length) { geo.dispose(); mat.dispose(); return null; }
    const inst = new THREE.InstancedMesh(geo, mat, mats.length);
    for (let i = 0; i < mats.length; i++) inst.setMatrixAt(i, mats[i]);
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
    return inst;
  }

  /** Merged lattice transmission-pylon geometry (position/normal/uv) built at real scale. */
  function buildPylonGeometry() {
    const geos = [];
    // Tapered central mast.
    const mast = new THREE.CylinderGeometry(1.3, 3.6, 132, 6, 1);
    mast.translate(0, 66, 0);
    geos.push(mast);
    // Three narrowing cross-arms (extend along local X = track side).
    const arms = [[92, 30], [108, 22], [ARM_TOP_Y, ARM_TOP_HALF]];
    for (const [h, half] of arms) {
      const arm = new THREE.BoxGeometry(half * 2, 2.4, 2.4);
      arm.translate(0, h, 0);
      geos.push(arm);
      for (const sx of [-1, 1]) {
        const nub = new THREE.BoxGeometry(1.4, 7, 1.4);
        nub.translate(sx * half, h + 3.5, 0);
        geos.push(nub);
      }
    }
    // Diagonal lattice bracing up the mast (front + back faces) for silhouette.
    for (let k = 0; k < 6; k++) {
      const y = 10 + k * 16;
      for (const s of [1, -1]) {
        for (const zoff of [2.6, -2.6]) {
          const br = new THREE.BoxGeometry(0.9, 20, 0.9);
          const mm = new THREE.Matrix4().makeRotationZ(s * 0.55);
          mm.setPosition(0, y, zoff);
          br.applyMatrix4(mm);
          geos.push(br);
        }
      }
    }
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    return merged || new THREE.BoxGeometry(2, 130, 2);
  }
}
