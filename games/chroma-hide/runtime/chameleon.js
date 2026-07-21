/**
 * CHROMA HIDE — runtime/chameleon.js (browser)
 * The playable body: a rounded, friendly cartoon CHAMELEON — a chunky upright body,
 * a rounded head with two FORWARD-facing eyes (not odd side-stalks), a gentle snout,
 * a soft low crest, stubby legs/arms and a curled tail. Reads as a cute mascot, not
 * a blob or a bug.
 *
 * The paint system paints ONE mesh via raycast->UV, so the whole creature is a single
 * merged BufferGeometry. Each body REGION's UVs are remapped into its own cell of a
 * 3x2 atlas so painting stays coherent (paint the belly -> only the belly). The eyes
 * (amber iris + dark pupil) are separate, non-paintable children.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const COLS = 3, ROWS = 2; // 6 paint regions: 0 body 1 head 2 crest 3 legs 4 arms 5 tail

function remapUV(geo, region) {
  const col = region % COLS, row = Math.floor(region / COLS);
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) + col) / COLS, (uv.getY(i) + row) / ROWS);
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

/** Build the merged chameleon geometry (once per match — cheap, shared across that
 *  match's actor meshes). Origin = body centre; feet ~ y=-0.89 so a mesh placed at
 *  y=BODY_Y(0.89) stands on the floor. Not module-cached (destroy disposes geo). */
export function makeChameleonGeo() {
  const S = (r, s = 18) => new THREE.SphereGeometry(r, s, s);
  const parts = [];

  // region 0 — body: a smooth upright pear (wide belly, narrower chest)
  parts.push(part(S(0.44), 0, { pos: [0, -0.08, 0.02], scale: [1.02, 1.06, 1.06] }));
  parts.push(part(S(0.36), 0, { pos: [0, 0.26, 0.05], scale: [0.96, 0.98, 1.0] }));
  parts.push(part(S(0.26), 0, { pos: [0, 0.44, 0.10] })); // neck

  // region 1 — rounded head + gentle snout + eyelid bumps around FORWARD eyes
  parts.push(part(S(0.31), 1, { pos: [0, 0.58, 0.22], scale: [1.05, 1.0, 1.02] }));
  parts.push(part(S(0.20), 1, { pos: [0, 0.46, 0.44], scale: [1.0, 0.82, 1.0] }));   // snout
  parts.push(part(S(0.145, 14), 1, { pos: [0.165, 0.60, 0.34] }));  // L eyelid bump (forward)
  parts.push(part(S(0.145, 14), 1, { pos: [-0.165, 0.60, 0.34] })); // R eyelid bump

  // region 2 — soft low crest + a couple of gentle back nubs (subtle, not a spike)
  parts.push(part(new THREE.ConeGeometry(0.17, 0.24, 16), 2, { pos: [0, 0.80, 0.08], rot: [-0.35, 0, 0] }));
  for (let i = 0; i < 3; i++) {
    const t = i / 3;
    parts.push(part(new THREE.SphereGeometry(0.08 - 0.015 * i, 10, 10), 2, { pos: [0, 0.56 - t * 0.42, -0.10 - t * 0.4], scale: [0.7, 1.1, 1.0] }));
  }

  // region 3 — stubby legs + splayed feet
  const leg = () => new THREE.CapsuleGeometry(0.15, 0.32, 5, 10);
  parts.push(part(leg(), 3, { pos: [0.21, -0.56, 0.06], rot: [0.12, 0, 0] }));
  parts.push(part(leg(), 3, { pos: [-0.21, -0.56, 0.06], rot: [0.12, 0, 0] }));
  parts.push(part(S(0.15, 12), 3, { pos: [0.23, -0.80, 0.22], scale: [1, 0.55, 1.5] }));
  parts.push(part(S(0.15, 12), 3, { pos: [-0.23, -0.80, 0.22], scale: [1, 0.55, 1.5] }));

  // region 4 — stubby arms + rounded hands, held forward
  const arm = () => new THREE.CapsuleGeometry(0.105, 0.22, 5, 10);
  parts.push(part(arm(), 4, { pos: [0.43, -0.02, 0.16], rot: [0.5, 0, 0.65] }));
  parts.push(part(arm(), 4, { pos: [-0.43, -0.02, 0.16], rot: [0.5, 0, -0.65] }));
  parts.push(part(S(0.135, 12), 4, { pos: [0.50, -0.19, 0.28] }));
  parts.push(part(S(0.135, 12), 4, { pos: [-0.50, -0.19, 0.28] }));

  // region 5 — curled tail (spiral in the y-z plane behind the body)
  const pts = [];
  for (let i = 0; i <= 22; i++) {
    const t = i / 22;
    const ang = t * Math.PI * 2.7;
    const rad = 0.42 * (1 - t * 0.66);
    pts.push(new THREE.Vector3(0, -0.10 + Math.sin(ang) * rad, -0.48 - Math.cos(ang) * rad));
  }
  parts.push(part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 44, 0.12, 9, false), 5, {}));

  return mergeGeometries(parts, false); // one group -> one (paint) material
}

const _irisGeo = new THREE.SphereGeometry(0.10, 14, 14);
const _pupilGeo = new THREE.SphereGeometry(0.055, 12, 12);
const _hiliteGeo = new THREE.SphereGeometry(0.022, 8, 8);
const _irisMat = new THREE.MeshStandardMaterial({ color: 0xcf8a34, roughness: 0.4, metalness: 0.05 });
const _huntIrisMat = new THREE.MeshStandardMaterial({ color: 0xb33025, roughness: 0.38, emissive: 0x360908, emissiveIntensity: 0.4 });
const _pupilMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.15 });
const _hiliteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.7 });

/** Two forward-facing eyes (amber iris + dark pupil + tiny highlight) as non-paint
 *  children, so the face reads friendly and stays visible after the body is painted. */
export function addChameleonFace(mesh, { seeker = false } = {}) {
  const irisMat = seeker ? _huntIrisMat : _irisMat;
  for (const sx of [1, -1]) {
    const iris = new THREE.Mesh(_irisGeo, irisMat);
    iris.position.set(sx * 0.165, 0.605, 0.45);
    iris.userData.noPaint = true;
    const pupil = new THREE.Mesh(_pupilGeo, _pupilMat);
    pupil.position.set(0, 0, 0.06);
    iris.add(pupil);
    const hi = new THREE.Mesh(_hiliteGeo, _hiliteMat);
    hi.position.set(-0.03, 0.035, 0.088);
    iris.add(hi);
    mesh.add(iris);
  }
  return mesh;
}
