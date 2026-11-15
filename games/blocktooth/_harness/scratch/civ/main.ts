// civ lane scratch gallery: every civilian archetype in a row of poses / option sets (+ LOD row).
//   ?biome=grideast|whitestacks|lockwater  &rows=office,casual  &t=0.4 (frozen time)  &yaw=0 &pitch=30 &dist=9
import * as THREE from 'three';
import { civGallery } from '../../../src/render/civilians.ts';
import { makeToon } from '../../../src/render/materials.ts';
import { BIOMES } from '../../../src/data/biomes.ts';
import type { BiomeId } from '../../../src/core/types.ts';

const q = new URLSearchParams(location.search);
const biome = (q.get('biome') ?? 'grideast') as BiomeId;
const rows = q.get('rows')?.split(',').filter(Boolean);
const num = (k: string, d: number): number => (q.has(k) ? Number(q.get(k)) : d);
const W = innerWidth, H = innerHeight;
const pal = BIOMES[biome].palette;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(pal.fog);
const night = biome === 'lockwater';
const sun = new THREE.DirectionalLight(new THREE.Color(pal.sun), Math.PI * (night ? 0.42 : 0.36));
sun.position.set(-6, 8, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera as THREE.OrthographicCamera;
sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.far = 60;
scene.add(sun, new THREE.HemisphereLight(new THREE.Color(pal.ambient), new THREE.Color(pal.ground), Math.PI * 0.5), new THREE.AmbientLight(new THREE.Color(pal.ambient), Math.PI * (night ? 0.3 : 0.18)));
const g = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), makeToon({ color: pal.sidewalk }));
g.rotation.x = -Math.PI / 2; g.receiveShadow = true; scene.add(g);

const gal = civGallery(biome, rows);
scene.add(gal.group);
const nRows = (rows?.length ?? 10) + 1;

const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 500);
const yaw = num('yaw', 0) * Math.PI / 180, pitch = num('pitch', 30) * Math.PI / 180;
const look = new THREE.Vector3(0, 0.8, -(nRows - 1) * 1.7 / 2);
const D = num('dist', 6 + nRows * 2.2);
camera.position.set(look.x + D * Math.cos(pitch) * Math.sin(yaw), look.y + D * Math.sin(pitch), look.z + D * Math.cos(pitch) * Math.cos(yaw));
camera.lookAt(look);

const fixedT = q.has('t') ? num('t', 0) : null;
let frames = 0;
const t0 = performance.now();
function loop(): void {
  const t = fixedT ?? (performance.now() - t0) / 1000;
  gal.tick(t);
  renderer.render(scene, camera);
  if (++frames > 10) (window as unknown as { __SNAP_READY__: boolean }).__SNAP_READY__ = true;
  requestAnimationFrame(loop);
}
loop();
