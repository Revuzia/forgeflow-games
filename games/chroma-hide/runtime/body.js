/**
 * CHROMA HIDE — runtime/body.js  (browser)
 * The playable body: a smooth, featureless WHITE HUMANOID MANNEQUIN — a blank
 * artist's-dummy figure, which is what the genre actually uses. A neutral form is
 * the point: you paint it to impersonate a picture frame, a brick, a laundry pile.
 * (An earlier build modelled a literal chameleon off the cover art — wrong: the
 * chameleon is the game's mascot/title, not the avatar.)
 *
 * The paint system paints ONE mesh via raycast->UV, so the whole figure is a single
 * merged BufferGeometry. Each body REGION's UVs are remapped into its own cell of a
 * 3x2 atlas, so painting the torso doesn't smear onto the legs.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const COLS = 3, ROWS = 2; // regions: 0 torso 1 head 2 arms 3 legs 4 extremities 5 spare

function remapUV(geo, region) {
  const col = region % COLS, row = Math.floor(region / COLS);
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + col) / COLS, (uv.getY(i) + row) / ROWS);
  uv.needsUpdate = true;
  return geo;
}

function part(geo, region, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  geo.scale(scale[0], scale[1], scale[2]);
  if (rot[0]) geo.rotateX(rot[0]);
  if (rot[1]) geo.rotateY(rot[1]);
  if (rot[2]) geo.rotateZ(rot[2]);
  geo.translate(pos[0], pos[1], pos[2]);
  return remapUV(geo, region);
}

/** Merged mannequin geometry. Origin = body centre; feet ~y=-0.89 so a mesh placed at
 *  y=BODY_Y(0.89) stands on the floor. Not cached across matches (destroy disposes). */
export function makeBodyGeo() {
  const S = (r, s = 18) => new THREE.SphereGeometry(r, s, s);
  const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 5, 12);
  const p = [];

  // region 0 — torso: hips -> waist -> chest, gently tapered, slightly flattened
  p.push(part(S(0.235), 0, { pos: [0, -0.11, 0], scale: [1.12, 0.78, 0.82] }));   // hips
  p.push(part(S(0.205), 0, { pos: [0, 0.10, 0], scale: [1.02, 1.0, 0.76] }));     // waist
  p.push(part(S(0.245), 0, { pos: [0, 0.33, 0], scale: [1.18, 1.02, 0.78] }));    // chest
  p.push(part(S(0.105, 14), 0, { pos: [0.255, 0.44, 0] }));                        // L shoulder
  p.push(part(S(0.105, 14), 0, { pos: [-0.255, 0.44, 0] }));                       // R shoulder

  // region 1 — neck + smooth featureless head (no face: it's a blank)
  p.push(part(new THREE.CylinderGeometry(0.078, 0.09, 0.12, 14), 1, { pos: [0, 0.55, 0] }));
  p.push(part(S(0.198), 1, { pos: [0, 0.72, 0.005], scale: [1.0, 1.08, 1.0] }));

  // region 2 — arms hanging at the sides
  p.push(part(cap(0.076, 0.24), 2, { pos: [0.295, 0.25, 0], rot: [0, 0, 0.08] }));
  p.push(part(cap(0.076, 0.24), 2, { pos: [-0.295, 0.25, 0], rot: [0, 0, -0.08] }));
  p.push(part(cap(0.069, 0.24), 2, { pos: [0.315, -0.05, 0.01] }));
  p.push(part(cap(0.069, 0.24), 2, { pos: [-0.315, -0.05, 0.01] }));

  // region 3 — legs
  p.push(part(cap(0.108, 0.26), 3, { pos: [0.125, -0.36, 0] }));
  p.push(part(cap(0.108, 0.26), 3, { pos: [-0.125, -0.36, 0] }));
  p.push(part(cap(0.093, 0.26), 3, { pos: [0.128, -0.68, 0] }));
  p.push(part(cap(0.093, 0.26), 3, { pos: [-0.128, -0.68, 0] }));

  // region 4 — hands + feet
  p.push(part(S(0.082, 12), 4, { pos: [0.318, -0.245, 0.015], scale: [1, 1.25, 0.85] }));
  p.push(part(S(0.082, 12), 4, { pos: [-0.318, -0.245, 0.015], scale: [1, 1.25, 0.85] }));
  p.push(part(S(0.105, 12), 4, { pos: [0.128, -0.845, 0.05], scale: [1, 0.62, 1.55] }));
  p.push(part(S(0.105, 12), 4, { pos: [-0.128, -0.845, 0.05], scale: [1, 0.62, 1.55] }));

  return mergeGeometries(p, false); // one group -> one (paint) material
}

/** The mannequin is featureless by design — seekers get a subtle visor band so the
 *  hunter role reads at a glance. Hiders get nothing (a blank body is the point). */
const _bandGeo = new THREE.BoxGeometry(0.30, 0.055, 0.21);
const _bandMat = new THREE.MeshStandardMaterial({ color: 0xff8a4a, emissive: 0x5a2408, emissiveIntensity: 0.55, roughness: 0.4 });

export function addBodyFeatures(mesh, { seeker = false } = {}) {
  if (!seeker) return mesh;
  const band = new THREE.Mesh(_bandGeo, _bandMat);
  band.position.set(0, 0.735, 0.155);
  band.userData.noPaint = true;
  mesh.add(band);
  return mesh;
}
