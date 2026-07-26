// Colosseum — the building itself.
//
// DRAW-CALL DISCIPLINE (the whole reason this file is shaped the way it is):
// the arena must cost well under 30 draw calls so the ~70 remaining in the
// budget belong to fighters, VFX and UI. The techniques, in order of payoff:
//
//   1. The cavea (54 stepped rows across 4 tiers) is ONE merged BufferGeometry.
//      Built row-by-row as extruded elliptical rings, welded into a single
//      non-indexed buffer. Naively this would be 54 meshes; it is 1.
//   2. The facade's 240 arches are ONE InstancedMesh — a single arch module
//      (pier + voussoir arch + entablature) placed by per-instance matrix.
//   3. Columns, statues and velarium masts are each ONE InstancedMesh.
//   4. The sand, podium, attic and outer wall are merged per-material.
//
// Materials are deliberately few: three travertine variants, one marble, one
// sand, one wood. Fewer materials => fewer state changes => fewer calls.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ARENA, caveaLayout } from "../data/arena_spec.js";
import { TAU, ellipseArcPoints, ellipsePerimeter, mulberry32 } from "../core/util.js";

// ---------------------------------------------------------------------------
// Materials — the stone palette. Travertine is warm and porous; the Colosseum
// reads yellow-cream in sun and grey-brown in shade, so roughness stays high
// and we lean on vertex colour + AO rather than expensive maps.
// ---------------------------------------------------------------------------

function makeMaterials(quality) {
  const travertine = new THREE.MeshStandardMaterial({
    color: 0xc9b891, roughness: 0.94, metalness: 0.0, vertexColors: true,
    name: "travertine",
  });
  const travertineDark = new THREE.MeshStandardMaterial({
    color: 0x8f8068, roughness: 0.96, metalness: 0.0, vertexColors: true,
    name: "travertine_shade",
  });
  const marble = new THREE.MeshStandardMaterial({
    color: 0xe6e0d0, roughness: 0.55, metalness: 0.0, vertexColors: true,
    name: "marble",
  });
  const wood = new THREE.MeshStandardMaterial({
    color: 0x6d5236, roughness: 0.9, metalness: 0.0, name: "wood",
  });
  const iron = new THREE.MeshStandardMaterial({
    color: 0x3a3632, roughness: 0.62, metalness: 0.75, name: "iron",
  });
  const bronze = new THREE.MeshStandardMaterial({
    color: 0x8c6a35, roughness: 0.42, metalness: 0.85, name: "bronze",
  });
  // Sand gets its own shader-extended material so blood decals can be composited
  // into it from a persistent render target (see decals.js) at zero draw cost.
  const sand = new THREE.MeshStandardMaterial({
    color: 0xd9c9a3, roughness: 1.0, metalness: 0.0, name: "sand",
  });
  return { travertine, travertineDark, marble, wood, iron, bronze, sand, quality };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Paint a whole geometry one colour (so merged parts keep readable tone). */
function tint(geo, hex, jitter = 0, rnd = Math.random) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = jitter ? 1 + (rnd() - 0.5) * jitter : 1;
    arr[i * 3] = c.r * j;
    arr[i * 3 + 1] = c.g * j;
    arr[i * 3 + 2] = c.b * j;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * An elliptical ring prism: the workhorse for every course of stone in the
 * building. Sweeps a rectangular cross-section (inner->outer, bottom->top)
 * around an ellipse. Returns a non-indexed geometry ready to merge.
 */
function ellipseRing(innerA, innerB, outerA, outerB, y0, y1, segments) {
  const pos = [];
  const nor = [];
  const seg = segments;
  const P = (a, b, t, y) => [a * Math.cos(t), y, b * Math.sin(t)];

  for (let i = 0; i < seg; i++) {
    const t0 = (i / seg) * TAU;
    const t1 = ((i + 1) / seg) * TAU;

    const i0 = P(innerA, innerB, t0, 0), i1 = P(innerA, innerB, t1, 0);
    const o0 = P(outerA, outerB, t0, 0), o1 = P(outerA, outerB, t1, 0);

    // top face (y1)
    quad(pos, nor, [i0[0], y1, i0[2]], [o0[0], y1, o0[2]], [o1[0], y1, o1[2]], [i1[0], y1, i1[2]], [0, 1, 0]);
    // outer face
    const on = [Math.cos(t0), 0, Math.sin(t0)];
    quad(pos, nor, [o0[0], y0, o0[2]], [o1[0], y0, o1[2]], [o1[0], y1, o1[2]], [o0[0], y1, o0[2]], on);
    // inner face (riser) — faces the arena
    const inn = [-Math.cos(t0), 0, -Math.sin(t0)];
    quad(pos, nor, [i1[0], y0, i1[2]], [i0[0], y0, i0[2]], [i0[0], y1, i0[2]], [i1[0], y1, i1[2]], inn);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

function quad(pos, nor, a, b, c, d, n) {
  pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (let i = 0; i < 6; i++) nor.push(...n);
}

/**
 * One arcade module, designed to TILE: it carries a full arch opening plus ONE
 * pier's worth of stone, split as a half-pier at each end. Butt two modules
 * together and the half-piers form a whole pier, so N modules around the
 * ellipse give N arches separated by N piers — which is what an arcade is.
 *
 * (The earlier version subtracted two full piers from a one-pier module, which
 * left a 1.8 m slot instead of a 4.2 m arch — the facade read as scattered
 * blocks rather than arcading.)
 *
 * Local frame: x spans -w/2..+w/2 tangentially, y is 0..h+entablature,
 * z is the wall thickness, +z pointing outward.
 *
 * @param {number} w      module width = clear span + one pier
 * @param {number} clear  clear span of the arch opening
 * @param {number} h      height to the top of the entablature's architrave
 * @param {number} pierW  full pier width (half appears at each end)
 * @param {number} depth  wall thickness
 */
function archModule(w, clear, h, pierW, depth) {
  const parts = [];
  const r = clear / 2;                 // arch radius
  const springline = h - r - 0.9;      // impost height: arch springs from here
  const halfPier = pierW / 2;

  // --- half-piers at each end -------------------------------------------
  for (const sx of [-1, 1]) {
    const p = new THREE.BoxGeometry(halfPier, springline, depth);
    p.translate(sx * (w / 2 - halfPier / 2), springline / 2, 0);
    parts.push(p);
  }

  // --- impost blocks the arch springs from -------------------------------
  for (const sx of [-1, 1]) {
    const im = new THREE.BoxGeometry(halfPier * 1.25, 0.28, depth * 1.06);
    im.translate(sx * (w / 2 - halfPier / 2), springline + 0.14, 0);
    parts.push(im);
  }

  // --- voussoir arch ------------------------------------------------------
  // A ring of wedge blocks rather than a smooth torus: the radial joints catch
  // the sun and give the facade its characteristic dotted-arch reading at
  // distance, which a smooth surface completely loses.
  const BLOCKS = 13;
  const vThick = 0.62;
  for (let i = 0; i < BLOCKS; i++) {
    const tm = Math.PI * ((i + 0.5) / BLOCKS);
    const arcLen = (Math.PI * (r + vThick / 2)) / BLOCKS;
    const b = new THREE.BoxGeometry(arcLen * 1.08, vThick, depth);
    const m = new THREE.Matrix4()
      .makeRotationZ(tm + Math.PI / 2)
      .setPosition(-Math.cos(tm) * (r + vThick / 2), springline + Math.sin(tm) * (r + vThick / 2), 0);
    b.applyMatrix4(m);
    parts.push(b);
  }

  // --- spandrels: the stone triangles between arch shoulder and cornice ---
  const spandrelY = springline + r;
  const spandrelH = Math.max(0.35, h - spandrelY);
  for (const sx of [-1, 1]) {
    const sp = new THREE.BoxGeometry(w / 2 - r * 0.72, spandrelH, depth * 0.97);
    sp.translate(sx * (w / 2 - (w / 2 - r * 0.72) / 2), spandrelY + spandrelH / 2, 0);
    parts.push(sp);
  }

  // --- entablature: architrave + projecting cornice ------------------------
  const arch = new THREE.BoxGeometry(w, 0.55, depth * 1.03);
  arch.translate(0, h + 0.275, 0);
  parts.push(arch);
  const corn = new THREE.BoxGeometry(w, 0.42, depth * 1.2);
  corn.translate(0, h + 0.55 + 0.21, 0);
  parts.push(corn);

  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

/** An engaged half-column with a simple capital — Tuscan/Ionic/Corinthian-ish. */
function columnGeometry(height, radius, order) {
  const parts = [];
  const base = new THREE.CylinderGeometry(radius * 1.25, radius * 1.35, height * 0.045, 10);
  base.translate(0, height * 0.0225, 0);
  parts.push(base);

  const shaftH = height * 0.86;
  const shaft = new THREE.CylinderGeometry(radius * 0.88, radius, shaftH, order === "tuscan" ? 10 : 14);
  shaft.translate(0, height * 0.045 + shaftH / 2, 0);
  parts.push(shaft);

  const capH = height * 0.095;
  if (order === "corinthian") {
    // flared bell + abacus
    const bell = new THREE.CylinderGeometry(radius * 1.32, radius * 0.9, capH * 0.72, 12);
    bell.translate(0, height * 0.905 + capH * 0.36, 0);
    parts.push(bell);
    const ab = new THREE.BoxGeometry(radius * 2.9, capH * 0.3, radius * 2.9);
    ab.translate(0, height * 0.905 + capH * 0.86, 0);
    parts.push(ab);
  } else if (order === "ionic") {
    const ech = new THREE.CylinderGeometry(radius * 1.12, radius * 0.9, capH * 0.5, 12);
    ech.translate(0, height * 0.905 + capH * 0.25, 0);
    parts.push(ech);
    // volutes as two small cylinders either side
    for (const sx of [-1, 1]) {
      const v = new THREE.CylinderGeometry(radius * 0.42, radius * 0.42, radius * 0.5, 10);
      v.rotateZ(Math.PI / 2);
      v.translate(sx * radius * 1.05, height * 0.905 + capH * 0.62, 0);
      parts.push(v);
    }
    const ab = new THREE.BoxGeometry(radius * 2.6, capH * 0.28, radius * 2.6);
    ab.translate(0, height * 0.905 + capH * 0.85, 0);
    parts.push(ab);
  } else {
    const ech = new THREE.CylinderGeometry(radius * 1.18, radius * 0.92, capH * 0.55, 10);
    ech.translate(0, height * 0.905 + capH * 0.28, 0);
    parts.push(ech);
    const ab = new THREE.BoxGeometry(radius * 2.5, capH * 0.35, radius * 2.5);
    ab.translate(0, height * 0.905 + capH * 0.78, 0);
    parts.push(ab);
  }

  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return g;
}

/**
 * A blocky standing figure for the arcade statues. Deliberately low-poly and
 * slightly abstract: at 20-40 m through an arch the silhouette is all that
 * survives, and a crisp silhouette beats a mushy detailed mesh.
 */
function statueGeometry(h = 2.6) {
  const parts = [];
  const plinth = new THREE.BoxGeometry(h * 0.42, h * 0.14, h * 0.34);
  plinth.translate(0, h * 0.07, 0);
  parts.push(plinth);

  const legs = new THREE.CylinderGeometry(h * 0.11, h * 0.14, h * 0.42, 8);
  legs.translate(0, h * 0.14 + h * 0.21, 0);
  parts.push(legs);

  const torso = new THREE.CylinderGeometry(h * 0.155, h * 0.13, h * 0.3, 8);
  torso.translate(0, h * 0.56 + h * 0.15, 0);
  parts.push(torso);

  // draped arm across the chest
  const arm = new THREE.CylinderGeometry(h * 0.05, h * 0.05, h * 0.26, 6);
  arm.rotateZ(Math.PI * 0.32);
  arm.translate(h * 0.1, h * 0.72, h * 0.06);
  parts.push(arm);

  const head = new THREE.SphereGeometry(h * 0.085, 10, 8);
  head.translate(0, h * 0.92, 0);
  parts.push(head);

  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return g;
}

// ---------------------------------------------------------------------------
// The Colosseum
// ---------------------------------------------------------------------------

export class Colosseum {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.scene
   * @param {string} opts.quality  'low' | 'medium' | 'high' | 'ultra'
   * @param {number} opts.seed     deterministic stone jitter / statue placement
   */
  constructor({ scene, quality = "high", seed = 1337, spec = ARENA } = {}) {
    this.scene = scene;
    this.spec = spec;
    this.quality = quality;
    this.rnd = mulberry32(seed);
    this.mat = makeMaterials(quality);
    this.group = new THREE.Group();
    this.group.name = "colosseum";
    this.parts = {};
    this.disposables = [];

    // Segment counts scale with quality. The ellipse needs enough segments that
    // the podium curve reads smooth at 8 m (the closest a fighter ever gets).
    this.seg = { low: 72, medium: 108, high: 144, ultra: 192 }[quality] || 144;

    scene.add(this.group);
  }

  /** Build everything. Returns `this` so callers can chain. */
  build() {
    this._buildGround();
    this._buildSand();
    this._buildPodium();
    this._buildCavea();
    this._buildFacade();
    this._buildSubstructure();
    this._buildAttic();
    this._buildVelarium();
    return this;
  }

  // -- the sand -------------------------------------------------------------
  _buildSand() {
    const { floor } = this.spec;
    // A dense-ish disc so the sand can take a subtle height ripple and so
    // decals projected onto it do not swim. 1 draw call.
    const g = new THREE.CircleGeometry(1, 128);
    g.rotateX(-Math.PI / 2);
    g.scale(floor.a, 1, floor.b);

    // Gentle undulation — raked sand is never dead flat, and the varying normal
    // is what makes the low sun rake across it convincingly.
    const p = g.attributes.position;
    const rnd = this.rnd;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const h =
        Math.sin(x * 0.19 + z * 0.11) * 0.045 +
        Math.sin(x * 0.07 - z * 0.23) * 0.035 +
        (rnd() - 0.5) * 0.012;
      p.setY(i, h);
    }
    g.computeVertexNormals();

    const mesh = new THREE.Mesh(g, this.mat.sand);
    mesh.name = "arena_sand";
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.group.add(mesh);
    this.parts.sand = mesh;
    this.disposables.push(g);

    // Substructure lip so you never see under the sand from a low camera.
    const lip = ellipseRing(
      floor.a - 0.05, floor.b - 0.05, floor.a + 0.3, floor.b + 0.3,
      -floor.sandDepth - 1.2, 0.02, this.seg
    );
    tint(lip, 0x8a7a63, 0);
    const lipMesh = new THREE.Mesh(lip, this.mat.travertineDark);
    lipMesh.name = "sand_lip";
    lipMesh.receiveShadow = true;
    this.group.add(lipMesh);
    this.disposables.push(lip);
  }

  // -- podium wall ----------------------------------------------------------
  _buildPodium() {
    const { floor, podium } = this.spec;
    const parts = [];

    const a0 = floor.a + 0.3, b0 = floor.b + 0.3;
    const a1 = a0 + podium.thickness, b1 = b0 + podium.thickness;

    // rough base course
    const base = ellipseRing(a0, b0, a1, b1, 0, podium.baseBand, this.seg);
    tint(base, 0xa8977a, 0.06, this.rnd);
    parts.push(base);

    // smooth marble facing above it
    const face = ellipseRing(a0 + 0.06, b0 + 0.06, a1, b1, podium.baseBand, podium.height - 0.35, this.seg);
    tint(face, 0xe2dac6, 0.05, this.rnd);
    parts.push(face);

    // capping cornice that overhangs the arena — casts the hard shadow line
    // fighters fight under, and stops anything climbing out.
    const cap = ellipseRing(a0 - 0.35, b0 - 0.35, a1 + 0.25, b1 + 0.25, podium.height - 0.35, podium.height, this.seg);
    tint(cap, 0xd6cdb6, 0.04, this.rnd);
    parts.push(cap);

    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    const mesh = new THREE.Mesh(merged, this.mat.marble);
    mesh.name = "podium";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.parts.podium = mesh;
    this.disposables.push(merged);
  }

  // -- cavea (the seating) --------------------------------------------------
  _buildCavea() {
    const layout = caveaLayout(this.spec);
    this.caveaLayout = layout;
    const parts = [];

    for (const tier of layout) {
      for (let r = 0; r < tier.rows; r++) {
        const innerA = tier.startA + r * tier.run;
        const innerB = tier.startB + r * tier.run;
        const y0 = tier.startY + r * tier.rise;
        const y1 = y0 + tier.rise;
        // Each row is a step: the tread the spectators' feet rest on plus the
        // riser their seat backs against.
        const ring = ellipseRing(innerA, innerB, innerA + tier.run, innerB + tier.run, y0, y1, this.seg);
        tint(ring, tier.seatColor, 0.09, this.rnd);
        parts.push(ring);
      }
      // praecinctio — the flat walkway between tiers
      if (tier.gap > 0) {
        const walk = ellipseRing(tier.endA, tier.endB, tier.endA + tier.gap, tier.endB + tier.gap,
          tier.endY - 0.22, tier.endY, this.seg);
        tint(walk, 0xb3a894, 0.05, this.rnd);
        parts.push(walk);
      }
    }

    // ONE mesh for all 54 rows + walkways.
    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    const mesh = new THREE.Mesh(merged, this.mat.travertine);
    mesh.name = "cavea";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.parts.cavea = mesh;
    this.disposables.push(merged);

    const last = layout[layout.length - 1];
    this.caveaTop = { a: last.endA, b: last.endB, y: last.endY };
  }

  // -- the arcaded facade ---------------------------------------------------
  _buildFacade() {
    const f = this.spec.facade;
    const top = this.caveaTop;

    // The outer shell sits just beyond the top of the seating.
    const outerA = top.a + 3.0;
    const outerB = top.b + 3.0;
    this.outer = { a: outerA, b: outerB };

    // Module width is derived from the actual perimeter so the 80 modules butt
    // edge-to-edge into a continuous wall. Deriving it from nominal arch+pier
    // widths instead leaves gaps (or overlaps) that read as a broken facade.
    const perim = ellipsePerimeter(outerA, outerB);
    const w = perim / f.arches;
    const clear = Math.max(2.4, w - f.pierWidth);
    const depth = 2.2;
    // Architrave top sits so that architrave+cornice (0.97 m) exactly fills the
    // storey pitch — storeys then stack flush with no seam.
    const geo = archModule(w, clear, f.storeyHeight - 0.97, f.pierWidth, depth);
    tint(geo, 0xc9b891, 0.1, this.rnd);
    this.disposables.push(geo);
    this.facadeModule = { w, clear, depth };

    const pts = ellipseArcPoints(outerA, outerB, f.arches);
    const total = f.arches * f.storeys;
    const inst = new THREE.InstancedMesh(geo, this.mat.travertine, total);
    inst.name = "facade_arches";
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3(1, 1, 1);

    let i = 0;
    for (let s = 0; s < f.storeys; s++) {
      const y = s * f.storeyHeight;
      // Upper storeys step very slightly inward, as the real building does.
      const shrink = 1 - s * 0.006;
      for (const p of pts) {
        // Face the arch outward: rotate so its local +z points along the normal.
        const yaw = Math.atan2(p.nx, p.nz);
        q.setFromAxisAngle(up, yaw);
        pos.set(p.x * shrink, y, p.z * shrink);
        m.compose(pos, q, scl);
        inst.setMatrixAt(i++, m);
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false; // the ring always straddles the frustum
    this.group.add(inst);
    this.parts.arches = inst;

    // Engaged columns flanking each arch, one order per storey. One InstancedMesh
    // per order (3 total) because the geometry genuinely differs.
    this.parts.columns = [];
    for (let s = 0; s < f.storeys; s++) {
      const order = f.orders[s] || "tuscan";
      const cg = columnGeometry(f.storeyHeight * 0.86, 0.52, order);
      tint(cg, 0xd2c19a, 0.08, this.rnd);
      this.disposables.push(cg);
      const ci = new THREE.InstancedMesh(cg, this.mat.travertine, f.arches);
      ci.name = `columns_${order}`;
      ci.castShadow = true;
      ci.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      const shrink = 1 - s * 0.006;
      let k = 0;
      for (const p of pts) {
        const yaw = Math.atan2(p.nx, p.nz);
        q.setFromAxisAngle(up, yaw);
        // push the column outboard of the pier face
        pos.set(p.x * shrink + p.nx * (depth * 0.55), s * f.storeyHeight, p.z * shrink + p.nz * (depth * 0.55));
        m.compose(pos, q, scl);
        ci.setMatrixAt(k++, m);
      }
      ci.instanceMatrix.needsUpdate = true;
      ci.frustumCulled = false;
      this.group.add(ci);
      this.parts.columns.push(ci);
    }

    // Statues in the 2nd and 3rd storey arches. One InstancedMesh, ~160 figures.
    const sg = statueGeometry(2.7);
    tint(sg, 0xd8d0bc, 0.12, this.rnd);
    this.disposables.push(sg);
    const count = f.statueStoreys.length * f.arches;
    const si = new THREE.InstancedMesh(sg, this.mat.marble, count);
    si.name = "arch_statues";
    si.castShadow = true;
    si.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    let sidx = 0;
    for (const s of f.statueStoreys) {
      const shrink = 1 - s * 0.006;
      for (const p of pts) {
        // Statues stood IN the arch openings, on the storey floor and set back
        // into the wall thickness — not perched on top of the cornice.
        const yaw = Math.atan2(p.nx, p.nz);
        q.setFromAxisAngle(up, yaw + (this.rnd() - 0.5) * 0.22);
        pos.set(
          p.x * shrink - p.nx * depth * 0.15,
          s * f.storeyHeight + 0.15,
          p.z * shrink - p.nz * depth * 0.15
        );
        m.compose(pos, q, scl);
        si.setMatrixAt(sidx++, m);
      }
    }
    si.instanceMatrix.needsUpdate = true;
    si.frustumCulled = false;
    this.group.add(si);
    this.parts.statues = si;
  }

  // -- attic storey ---------------------------------------------------------
  // The fourth storey is solid wall rather than arcade, which is why it reads
  // as a blank band unless it gets its rhythm back: Corinthian pilasters at
  // every second arch bay, small square windows between them, and the ring of
  // gilded bronze shields (clipei) that hung below the cornice.
  _buildAttic() {
    const f = this.spec.facade;
    const y0 = f.storeys * f.storeyHeight;
    const a = this.outer.a, b = this.outer.b;
    const parts = [];

    const wall = ellipseRing(a - 1.1, b - 1.1, a + 1.1, b + 1.1, y0, y0 + f.atticHeight, this.seg);
    tint(wall, 0xc4b28c, 0.07, this.rnd);
    parts.push(wall);

    // base moulding + crowning cornice
    const plinth = ellipseRing(a - 1.4, b - 1.4, a + 1.5, b + 1.5, y0, y0 + 0.6, this.seg);
    tint(plinth, 0xbfae88, 0.05, this.rnd);
    parts.push(plinth);
    const cor = ellipseRing(a - 1.5, b - 1.5, a + 1.9, b + 1.9, y0 + f.atticHeight, y0 + f.atticHeight + 0.9, this.seg);
    tint(cor, 0xd6c6a2, 0.05, this.rnd);
    parts.push(cor);

    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    const mesh = new THREE.Mesh(merged, this.mat.travertine);
    mesh.name = "attic";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.parts.attic = mesh;
    this.disposables.push(merged);
    this.atticTop = y0 + f.atticHeight + 0.9;

    // --- pilasters (every second bay) ---------------------------------------
    const pts = ellipseArcPoints(a + 1.1, b + 1.1, f.arches);
    const pilCount = Math.floor(f.arches / 2);
    const pg = new THREE.BoxGeometry(1.5, f.atticHeight - 0.8, 0.55);
    pg.translate(0, (f.atticHeight - 0.8) / 2, 0);
    const pgn = pg.toNonIndexed(); pg.dispose();
    tint(pgn, 0xd0bf98, 0.06, this.rnd);
    this.disposables.push(pgn);
    const pi = new THREE.InstancedMesh(pgn, this.mat.travertine, pilCount);
    pi.name = "attic_pilasters";
    pi.castShadow = true;
    pi.frustumCulled = false;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < pilCount; i++) {
      const p = pts[i * 2];
      q.setFromAxisAngle(up, Math.atan2(p.nx, p.nz));
      pos.set(p.x + p.nx * 0.5, y0 + 0.6, p.z + p.nz * 0.5);
      m.compose(pos, q, one);
      pi.setMatrixAt(i, m);
    }
    pi.instanceMatrix.needsUpdate = true;
    this.group.add(pi);
    this.parts.pilasters = pi;

    // --- bronze shields between the pilasters -------------------------------
    const sg = new THREE.CylinderGeometry(1.15, 1.15, 0.22, 16);
    sg.rotateX(Math.PI / 2);
    const sgn = sg.toNonIndexed(); sg.dispose();
    this.disposables.push(sgn);
    const shi = new THREE.InstancedMesh(sgn, this.mat.bronze, pilCount);
    shi.name = "attic_shields";
    shi.castShadow = false;
    shi.frustumCulled = false;
    for (let i = 0; i < pilCount; i++) {
      const p = pts[i * 2 + 1] || pts[0];
      q.setFromAxisAngle(up, Math.atan2(p.nx, p.nz));
      pos.set(p.x + p.nx * 0.6, y0 + f.atticHeight * 0.62, p.z + p.nz * 0.6);
      m.compose(pos, q, one);
      shi.setMatrixAt(i, m);
    }
    shi.instanceMatrix.needsUpdate = true;
    this.group.add(shi);
    this.parts.shields = shi;
  }

  // -- substructure ---------------------------------------------------------
  // The arcade is an open screen. Without something behind it you look clean
  // through the building and out the far side, which instantly reads as a
  // cardboard model. In the real building the arcades front a ring of vaulted
  // ambulatories whose inner wall carries the cavea; that inner wall is what
  // this is. Set back by one corridor depth so the arches keep their reveal
  // and the eye reads real space inside them.
  _buildSubstructure() {
    const f = this.spec.facade;
    const corridor = 6.0;
    const a = this.outer.a - corridor;
    const b = this.outer.b - corridor;
    const yTop = f.storeys * f.storeyHeight;   // up to the attic base
    const parts = [];

    const wall = ellipseRing(a - 1.6, b - 1.6, a, b, -0.1, yTop, this.seg);
    tint(wall, 0x7d6f57, 0.08, this.rnd);
    parts.push(wall);

    // Floor slabs at each storey — seen through the arches as horizontal bands,
    // which is what makes the corridor read as inhabited depth rather than a
    // flat dark panel.
    for (let s = 0; s <= f.storeys; s++) {
      const y = s * f.storeyHeight;
      const slab = ellipseRing(a - 1.6, b - 1.6, this.outer.a, this.outer.b, y - 0.35, y, Math.floor(this.seg * 0.75));
      tint(slab, 0x9a8a6c, 0.06, this.rnd);
      parts.push(slab);
    }

    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    const mesh = new THREE.Mesh(merged, this.mat.travertineDark);
    mesh.name = "substructure";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.parts.substructure = mesh;
    this.disposables.push(merged);
  }

  // -- ground ---------------------------------------------------------------
  // Without this the building floats in the sky from any exterior angle. It is
  // also what the facade's shadow lands on, which is most of what sells the
  // mass of the thing.
  _buildGround() {
    // An ANNULUS, not a disc: a full disc at ground level would poke up through
    // the arena sand (which dips to -0.045 where it undulates) and z-fight it.
    // The inner radius sits under the seating, where it can never be seen.
    const g = new THREE.RingGeometry(60, 1400, 64, 1);
    g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xa2906f, roughness: 1.0, metalness: 0, name: "ground",
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = "ground";
    mesh.position.y = -0.02;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.group.add(mesh);
    this.parts.ground = mesh;
    this.disposables.push(g, mat);
  }

  // -- velarium -------------------------------------------------------------
  _buildVelarium() {
    const v = this.spec.velarium;
    const a = this.outer.a, b = this.outer.b;
    const y = this.atticTop;

    // masts — one InstancedMesh
    const mg = new THREE.CylinderGeometry(0.16, 0.22, v.mastHeight, 6);
    mg.translate(0, v.mastHeight / 2, 0);
    this.disposables.push(mg);
    const mi = new THREE.InstancedMesh(mg, this.mat.wood, v.masts);
    mi.name = "velarium_masts";
    mi.castShadow = true;
    const pts = ellipseArcPoints(a + 0.4, b + 0.4, v.masts);
    const m = new THREE.Matrix4();
    pts.forEach((p, i) => {
      m.makeTranslation(p.x, y, p.z);
      mi.setMatrixAt(i, m);
    });
    mi.instanceMatrix.needsUpdate = true;
    mi.frustumCulled = false;
    this.group.add(mi);
    this.parts.masts = mi;

    // The sail: a partially-drawn ring of canvas leaving the centre open. This
    // is the single most recognisable silhouette element from inside the arena,
    // and it also gives us the moving dappled shade over the sand.
    const sail = this._velariumSail(a + 0.6, b + 0.6, v.innerRatio, y + v.mastHeight * 0.86, v.coverage);
    const smat = new THREE.MeshStandardMaterial({
      color: 0xd8c9ad, roughness: 0.95, metalness: 0,
      side: THREE.DoubleSide, transparent: true, opacity: 0.92,
      name: "velarium_canvas",
    });
    const mesh = new THREE.Mesh(sail, smat);
    mesh.name = "velarium";
    mesh.castShadow = true;
    this.group.add(mesh);
    this.parts.velarium = mesh;
    this.velariumMat = smat;
    this.disposables.push(sail);
  }

  /** Ring of canvas panels, sagging toward the inner edge. */
  _velariumSail(a, b, innerRatio, y, coverage) {
    const SEGS = 96;
    const used = Math.floor(SEGS * coverage);
    const pos = [];
    const nor = [];
    const ia = a * innerRatio, ib = b * innerRatio;
    for (let i = 0; i < used; i++) {
      const t0 = (i / SEGS) * TAU;
      const t1 = ((i + 1) / SEGS) * TAU;
      // sag: the inner edge hangs below the outer anchor
      const sag = 2.2;
      const o0 = [a * Math.cos(t0), y, b * Math.sin(t0)];
      const o1 = [a * Math.cos(t1), y, b * Math.sin(t1)];
      const n0 = [ia * Math.cos(t0), y - sag, ib * Math.sin(t0)];
      const n1 = [ia * Math.cos(t1), y - sag, ib * Math.sin(t1)];
      quad(pos, nor, o0, o1, n1, n0, [0, 1, 0]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.computeVertexNormals();
    return g;
  }

  // -- public API -----------------------------------------------------------

  /** World-space anchor for a gate, on the podium ellipse. */
  gateAnchor(theta) {
    const { floor, podium } = this.spec;
    const a = floor.a + 0.3 + podium.thickness;
    const b = floor.b + 0.3 + podium.thickness;
    return new THREE.Vector3(a * Math.cos(theta), 0, b * Math.sin(theta));
  }

  /** Count the draw calls this building contributes (for the perf HUD). */
  drawCallEstimate() {
    let n = 0;
    this.group.traverse((o) => { if (o.isMesh || o.isInstancedMesh) n++; });
    return n;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose && d.dispose());
    Object.values(this.mat).forEach((m) => m && m.dispose && m.dispose());
    this.scene.remove(this.group);
  }
}
