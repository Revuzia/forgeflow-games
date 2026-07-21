/**
 * CHROMA HIDE — runtime/chameleon.js (browser)
 * The playable body: a chunky, upright, cartoon CHAMELEON (rounded belly, a head
 * held up with big side-mounted eye-turrets, a swept-back casque crest, dorsal
 * spikes, stubby legs/arms, a curled tail) — the homage silhouette from the cover,
 * NOT a capsule.
 *
 * The paint system paints ONE mesh via raycast->UV, so the whole creature is a
 * single merged BufferGeometry. To keep painting coherent, each body REGION's UVs
 * are remapped into its own cell of a 3x2 atlas — paint the belly and only the
 * belly changes, paint the tail and only the tail changes. The eye pupils are
 * separate (non-paintable) children so the face still reads once you paint.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const COLS = 3, ROWS = 2; // 6 paint regions: 0 body 1 head 2 crest 3 legs 4 arms 5 tail

function remapUV(geo, region) {
  const col = region % COLS, row = Math.floor(region / COLS);
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) {
    const u = (uv.getX(i) + col) / COLS;
    const v = (uv.getY(i) + row) / ROWS;
    uv.setXY(i, u, v);
  }
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

/** Build the merged chameleon geometry (once per match — cheap ~20 primitives, and
 *  shared across that match's actor meshes). Origin = body centre; feet ~ y=-0.89 so
 *  a mesh placed at y=BODY_Y(0.89) stands on the floor, same as the old capsule.
 *  Not cached across matches on purpose: game.destroy() disposes actor geometries. */
export function makeChameleonGeo() {
  const S = (r, s = 18) => new THREE.SphereGeometry(r, s, s);
  const parts = [];

  // region 0 — body (belly + chest, a mostly-upright egg with a forward belly)
  parts.push(part(S(0.45), 0, { pos: [0, -0.06, 0.03], scale: [1.0, 1.02, 1.06] }));
  parts.push(part(S(0.35), 0, { pos: [0, 0.28, 0.07], scale: [0.95, 0.98, 1.0] }));
  parts.push(part(S(0.24), 0, { pos: [0, 0.47, 0.13] }));  // neck

  // region 1 — head (held up) + downturned snout + big side eye-turrets
  parts.push(part(S(0.30), 1, { pos: [0, 0.63, 0.24] }));
  parts.push(part(S(0.20), 1, { pos: [0, 0.55, 0.47], scale: [0.95, 0.82, 1.0] }));   // snout
  parts.push(part(S(0.19), 1, { pos: [0.30, 0.65, 0.20], scale: [1.15, 1.15, 1.0] })); // L turret bulges out
  parts.push(part(S(0.19), 1, { pos: [-0.30, 0.65, 0.20], scale: [1.15, 1.15, 1.0] })); // R turret

  // region 2 — swept-back casque crest + dorsal spikes down the spine
  parts.push(part(new THREE.ConeGeometry(0.24, 0.48, 14), 2, { pos: [0, 0.88, 0.05], rot: [-0.42, 0, 0] }));
  for (let i = 0; i < 5; i++) {
    const t = i / 5;
    parts.push(part(new THREE.ConeGeometry(0.10 - 0.013 * i, 0.18, 8), 2, { pos: [0, 0.56 - t * 0.55, -0.06 - t * 0.42] }));
  }

  // region 3 — stubby legs + splayed feet (a two-legged stance)
  const leg = () => new THREE.CapsuleGeometry(0.14, 0.34, 5, 10);
  parts.push(part(leg(), 3, { pos: [0.22, -0.56, 0.06], rot: [0.12, 0, 0] }));
  parts.push(part(leg(), 3, { pos: [-0.22, -0.56, 0.06], rot: [0.12, 0, 0] }));
  parts.push(part(S(0.15, 12), 3, { pos: [0.24, -0.80, 0.24], scale: [1, 0.55, 1.5] }));
  parts.push(part(S(0.15, 12), 3, { pos: [-0.24, -0.80, 0.24], scale: [1, 0.55, 1.5] }));

  // region 4 — stubby arms + mitten hands, held forward
  const arm = () => new THREE.CapsuleGeometry(0.10, 0.24, 5, 10);
  parts.push(part(arm(), 4, { pos: [0.44, -0.02, 0.17], rot: [0.55, 0, 0.6] }));
  parts.push(part(arm(), 4, { pos: [-0.44, -0.02, 0.17], rot: [0.55, 0, -0.6] }));
  parts.push(part(S(0.13, 12), 4, { pos: [0.52, -0.20, 0.30] }));
  parts.push(part(S(0.13, 12), 4, { pos: [-0.52, -0.20, 0.30] }));

  // region 5 — curled tail (spiral in the y-z plane behind the body)
  const pts = [];
  for (let i = 0; i <= 22; i++) {
    const t = i / 22;
    const ang = t * Math.PI * 2.7;
    const rad = 0.42 * (1 - t * 0.66);
    pts.push(new THREE.Vector3(0, -0.10 + Math.sin(ang) * rad, -0.5 - Math.cos(ang) * rad));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  parts.push(part(new THREE.TubeGeometry(curve, 44, 0.115, 9, false), 5, {}));

  return mergeGeometries(parts, false); // one group -> one (paint) material
}

const _irisGeo = new THREE.SphereGeometry(0.105, 14, 14);
const _pupilGeo = new THREE.SphereGeometry(0.062, 12, 12);
const _irisMat = new THREE.MeshStandardMaterial({ color: 0xd98a2b, roughness: 0.45, metalness: 0.1 });
const _huntIrisMat = new THREE.MeshStandardMaterial({ color: 0xb83024, roughness: 0.4, emissive: 0x3a0a08, emissiveIntensity: 0.4 });
const _pupilMat = new THREE.MeshStandardMaterial({ color: 0x090909, roughness: 0.18, metalness: 0.1 });

/** Add the two eyes (non-paintable children) — an amber iris + dark pupil on the
 *  front of each turret so the face still reads (and pops) after the body is painted. */
export function addChameleonFace(mesh, { seeker = false } = {}) {
  const irisMat = seeker ? _huntIrisMat : _irisMat;
  for (const sx of [1, -1]) {
    const iris = new THREE.Mesh(_irisGeo, irisMat);
    iris.position.set(sx * 0.36, 0.66, 0.33);
    iris.userData.noPaint = true;
    const pupil = new THREE.Mesh(_pupilGeo, _pupilMat);
    pupil.position.set(sx * 0.02, 0.0, 0.075); // forward on the iris
    iris.add(pupil);
    mesh.add(iris);
  }
  return mesh;
}
