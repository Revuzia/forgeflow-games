// The 50-species REST CONTACT SHEET (physics round 2): every catalog species (template genome: its recipe shape and its material family),
// settled 1.5 s on the table, the SIM mesh flat-shaded in its body hue, seen from the game camera's side (front = +z, the face).
// 10 x 5 tiles of 160 x 240 px; each label: index, id, family, and the worst rest fold (degrees). window.__PV__ is the harness hook.
import * as THREE from 'three';
import { SoftBody } from '../../src/physics/softbody.ts';
import { CATALOG, speciesTemplateGenome } from '../../src/data/catalog.ts';

const W = 1600, Hh = 1200, TW = 160, TH = 240, COLS = 10;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, Hh, false);
renderer.setScissorTest(true);
renderer.setClearColor(0x14102a);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffe2c0, 0x33224d, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 2.0); key.position.set(2, 4, 3); scene.add(key);
const rim = new THREE.DirectionalLight(0x59d6e6, 0.8); rim.position.set(-3, 2, -2); scene.add(rim);
const table = new THREE.Mesh(new THREE.CircleGeometry(3.5, 64), new THREE.MeshBasicMaterial({ color: 0x2a2150 }));
table.rotation.x = -Math.PI / 2; scene.add(table);
const labels = document.getElementById('labels') as HTMLDivElement;
const cam = new THREE.PerspectiveCamera(30, TW / TH, 0.05, 50);
let worstRest = 0;
const t0 = performance.now();
CATALOG.forEach((d, idx) => {
  const g = speciesTemplateGenome(d.id);
  const b = new SoftBody(g);
  for (let i = 0; i < 90; i++) b.step(1 / 60);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(b.positions), 3));
  geo.setIndex(new THREE.BufferAttribute(b.indices, 1));
  geo.computeVertexNormals();
  const col = new THREE.Color().setHSL((((g.hue + 28) % 360) / 360), 0.55, 0.6);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: col, flatShading: true, roughness: 0.6 }));
  const wire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x000000, wireframe: true, transparent: true, opacity: 0.1 }));
  scene.add(mesh); scene.add(wire);
  // frame the body: its bounding box from a 3/4 front view
  let top = 0, rad = 0;
  for (let i = 0; i < b.vertexCount; i++) { top = Math.max(top, b.positions[i * 3 + 1]); rad = Math.max(rad, Math.hypot(b.positions[i * 3] - b.center.x, b.positions[i * 3 + 2] - b.center.z)); }
  // the tile is narrow (160 x 240): fit the height in the vertical field of view and the width in the horizontal one
  const hHalf = Math.atan(Math.tan((15 * Math.PI) / 180) * (TW / TH));
  const tgt = new THREE.Vector3(b.center.x, top * 0.45, b.center.z), dist = Math.max((top * 0.6) / Math.tan((15 * Math.PI) / 180), (rad * 1.05) / Math.tan(hHalf)) * 1.08;
  const yaw = (20 * Math.PI) / 180, pitch = (14 * Math.PI) / 180;
  cam.position.set(tgt.x + dist * Math.sin(yaw) * Math.cos(pitch), tgt.y + dist * Math.sin(pitch), tgt.z + dist * Math.cos(yaw) * Math.cos(pitch));
  cam.lookAt(tgt);
  const cx = (idx % COLS) * TW, cy = Hh - (Math.floor(idx / COLS) + 1) * TH;
  renderer.setViewport(cx, cy, TW, TH); renderer.setScissor(cx, cy, TW, TH);
  renderer.render(scene, cam);
  scene.remove(mesh); scene.remove(wire); geo.dispose();
  // worst rest dihedral
  const P = b.positions, I = b.indices, first = new Map<number, number>(), nrm: number[] = [];
  for (let t = 0; t < I.length / 3; t++) {
    const a = I[t * 3] * 3, c = I[t * 3 + 1] * 3, e = I[t * 3 + 2] * 3;
    const ux = P[c] - P[a], uy = P[c + 1] - P[a + 1], uz = P[c + 2] - P[a + 2], vx = P[e] - P[a], vy = P[e + 1] - P[a + 1], vz = P[e + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    nrm.push(nx / l, ny / l, nz / l);
  }
  let mn = 1;
  for (let t = 0; t < I.length / 3; t++) for (let k = 0; k < 3; k++) {
    const a = I[t * 3 + k], c = I[t * 3 + ((k + 1) % 3)], keyE = a < c ? a * 65536 + c : c * 65536 + a, o = first.get(keyE);
    if (o === undefined) first.set(keyE, t); else mn = Math.min(mn, nrm[o * 3] * nrm[t * 3] + nrm[o * 3 + 1] * nrm[t * 3 + 1] + nrm[o * 3 + 2] * nrm[t * 3 + 2]);
  }
  const rest = (Math.acos(Math.max(-1, mn)) * 180) / Math.PI;
  worstRest = Math.max(worstRest, rest);
  const lab = document.createElement('div');
  lab.style.left = `${(idx % COLS) * TW}px`; lab.style.top = `${Math.floor(idx / COLS) * TH}px`;
  lab.textContent = `${idx} ${d.id}\n${d.family}\nrest fold ${rest.toFixed(0)}`;
  labels.appendChild(lab);
});
declare global { interface Window { __PV__?: unknown } }
window.__PV__ = { ready: true, frames: [], log: [{ t: 0, vol: 1, top: 1, cy: 0.5, comp: 0, stretch: 0, foot: 0, cx: 0, cz: 0, fold: worstRest, inward: 0 }], events: [], simMs: performance.now() - t0, stateHash: 0, safetyResets: 0, restTop: 1 };
