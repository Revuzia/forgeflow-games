// titan-view lane scratch preview (port 5183). Imports only this lane's modules + three +
// orchestrator files (+ the render-core materials the models use).
//   ?mode=sheet&titan=molo        6-panel contact sheet: hero 3/4, side, front, mid-walk, attack, ability
//   ?mode=lineup[&h=1.2]          all four titans at the game camera angle (yaw 45, pitch 36)
//   ?mode=close&titan=molo&yaw=35&pitch=20&dist=3.2&pose=walk&pt=0.3
//   ?mode=poses&titan=molo        8 panels: walk cycle quarters, attack windup/strike, dash, hurt, grow
//   ?mode=world&titan=molo        REAL World (createWorld + stepWorld) + TitanView, game camera
//   ?mode=portraits               renderPortraits() on a checkerboard
import * as THREE from 'three';
import { buildTitanModel } from '../../../src/titans/models.ts';
import type { TitanModel } from '../../../src/titans/models.ts';
import { TitanAnimator } from '../../../src/titans/anim.ts';
import type { AnimState } from '../../../src/titans/anim.ts';
import { TitanView } from '../../../src/titans/titanview.ts';
import { renderPortraits } from '../../../src/titans/portraits.ts';
import type { TitanId } from '../../../src/core/types.ts';
import { createWorld, stepWorld } from '../../../src/core/world.ts';
import { screenToWorld, cameraDistance } from '../../../src/core/config.ts';
import type { Quality } from '../../../src/render/viewtypes.ts';
import { makeToon } from '../../../src/render/materials.ts';

const q = new URLSearchParams(location.search);
const mode = q.get('mode') ?? 'sheet';
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const W = innerWidth, H = innerHeight;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#9fd8f0');
const camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 2000);

// GRID-EAST day lighting mirroring render/lighting.ts LOOK.day (sun 0.34π, hemi 0.50π, ambient 0.20π,
// fill tinted 12 % toward the palette ambient, sun from BIOMES.grideast.sunDir) so colours read as in game
const sun = new THREE.DirectionalLight('#fff1dc', Math.PI * 0.34);
const sunDir = new THREE.Vector3(0.778, 0.5, -0.38).normalize();
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 1.6;
scene.add(sun, sun.target);
const fillSky = new THREE.Color('#ffffff').lerp(new THREE.Color('#9ec9d9'), 0.12);
const bounce = new THREE.Color('#d9d2c3').lerp(new THREE.Color('#2f7f86'), 0.5);
const bl = Math.max(bounce.r, bounce.g, bounce.b);
const ground = new THREE.Color(bounce.r / bl, bounce.g / bl, bounce.b / bl).lerp(new THREE.Color('#ffffff'), 0.35).multiplyScalar(0.72);
scene.add(new THREE.HemisphereLight(fillSky, ground, Math.PI * 0.5));
scene.add(new THREE.AmbientLight(new THREE.Color('#ffffff').lerp(new THREE.Color('#9ec9d9'), 0.1), Math.PI * 0.2));
if (q.get('light') === 'contrast') { sun.intensity = 2.4; }

function street(size: number): THREE.Group {
  const g = new THREE.Group();
  const road = new THREE.Mesh(new THREE.PlaneGeometry(size, size), makeToon({ color: '#2f7f86' }));
  road.rotation.x = -Math.PI / 2; road.receiveShadow = true; g.add(road);
  const stripeMat = makeToon({ color: '#f6f0e0' }); stripeMat.polygonOffset = true; stripeMat.polygonOffsetFactor = -1; stripeMat.polygonOffsetUnits = -1;
  for (let i = -8; i <= 8; i++) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(size * 0.035, size * 0.16), stripeMat);
    s.rotation.x = -Math.PI / 2; s.position.set(i * size * 0.06, 0.001, 0); s.receiveShadow = true; g.add(s);
  }
  const walk = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.012, size * 0.2), makeToon({ color: '#d9d2c3' }));
  walk.position.set(0, size * 0.006, -size * 0.4); walk.receiveShadow = true; g.add(walk);
  return g;
}
function fitSun(look: THREE.Vector3, sc: number): void {
  sun.position.copy(look).addScaledVector(sunDir, sc * 3);
  sun.target.position.copy(look);
  const cam = sun.shadow.camera as THREE.OrthographicCamera;
  cam.left = -sc; cam.right = sc; cam.top = sc; cam.bottom = -sc; cam.near = 0.1; cam.far = sc * 8;
  cam.updateProjectionMatrix();
  sun.target.updateMatrixWorld();
}
function placeCam(look: THREE.Vector3, yawDeg: number, pitchDeg: number, D: number, aspect: number): void {
  const yaw = (yawDeg * Math.PI) / 180, pitch = (pitchDeg * Math.PI) / 180;
  camera.position.set(look.x + D * Math.cos(pitch) * Math.sin(yaw), look.y + D * Math.sin(pitch), look.z + D * Math.cos(pitch) * Math.cos(yaw));
  camera.aspect = aspect;
  camera.near = Math.max(0.02, D * 0.02); camera.far = D * 6 + 50;
  camera.updateProjectionMatrix();
  camera.lookAt(look);
}

const label = document.getElementById('label')!;
const ids: TitanId[] = ['molo', 'voltkite', 'hearthback', 'briarwick'];
const ATTACK: Record<TitanId, string> = { molo: 'curbBite', voltkite: 'forkArc', hearthback: 'magmaStomp', briarwick: 'vineLash' };
const KIT: Record<TitanId, Record<string, number>> = {
  molo: { vacuumT: 0, headTurn: 0 }, voltkite: { wires: 3 }, hearthback: { stored: 60, cap: 100, stompT: 0.6 }, briarwick: { turrets: 2, sowT: 0 },
};

function st(id: TitanId): AnimState {
  return { speed01: 0, moving: false, turn: 0, attack: null, attackT: -1, dashT: -1, hurtT: -1, abilityT: -1, growT: -1, t: 0, kit: { ...KIT[id] }, speedH: 0, deadT: -1 };
}
/** pose a model deterministically: run the animator `frames` steps at 60 Hz with `set` applied per step */
function pose(m: TitanModel, id: TitanId, kind: string, pt: number): void {
  const an = new TitanAnimator(m, id);
  const s = st(id);
  const dt = 1 / 60;
  let frames = 90;
  const apply = (time: number) => {
    s.t = time;
    switch (kind) {
      case 'walk': s.moving = true; s.speed01 = 0.8; s.speedH = 2.0; break;
      case 'run': s.moving = true; s.speed01 = 1.0; s.speedH = 3.0; break;
      case 'attack': s.attack = ATTACK[id]; s.attackT = Math.max(0, time - (frames * dt - pt)); break;
      case 'ability':
        s.abilityT = Math.max(0, time - (frames * dt - pt));
        if (id === 'molo') s.kit.vacuumT = 1; if (id === 'briarwick') s.kit.sowT = 2; break;
      case 'dash': s.moving = true; s.speed01 = 1; s.speedH = 8; s.dashT = Math.max(0, time - (frames * dt - pt)); break;
      case 'hurt': s.hurtT = Math.max(0, time - (frames * dt - pt)); s.hurtAmt = 1; break;
      case 'grow': s.growT = Math.max(0, time - (frames * dt - pt)); break;
      case 'hero': s.hero = 1; break;
      case 'turn': s.moving = true; s.speed01 = 0.7; s.speedH = 1.6; s.turn = 3; break;
      case 'dead': s.deadT = Math.max(0, time - (frames * dt - pt)); break;
      default: break;
    }
  };
  if (kind === 'walk' || kind === 'run') frames = 60 + Math.round(pt * 60);
  for (let i = 0; i < frames; i++) { apply(i * dt); an.update(s, dt); }
  m.root.updateMatrixWorld(true);
}

interface Panel { kind: string; pt: number; yaw: number; pitch: number; dist: number; ly: number; lz: number; text: string }
function drawPanels(id: TitanId, panels: Panel[], cols: number): void {
  const m = buildTitanModel(id);
  scene.add(m.root);
  const tile = street(10);
  scene.add(tile);
  const rows = Math.ceil(panels.length / cols);
  const pw = Math.floor(W / cols), ph = Math.floor(H / rows);
  renderer.autoClear = false;
  renderer.setScissorTest(true);
  renderer.clear();
  const texts: string[] = [];
  panels.forEach((p, i) => {
    const cx = i % cols, cy = Math.floor(i / cols);
    const x = cx * pw, y = H - (cy + 1) * ph;
    pose(m, id, p.kind, p.pt);
    const look = new THREE.Vector3(0, p.ly, p.lz);
    placeCam(look, p.yaw, p.pitch, p.dist, pw / ph);
    fitSun(look, 3);
    renderer.setViewport(x, y, pw, ph);
    renderer.setScissor(x, y, pw, ph);
    renderer.clear();
    renderer.render(scene, camera);
    texts.push(`<div style="position:absolute;left:${x + 6}px;top:${cy * ph + 4}px">${p.text}</div>`);
  });
  label.style.background = 'none'; label.style.left = '0'; label.style.top = '0'; label.style.padding = '0';
  label.innerHTML = texts.join('') + `<div style="position:absolute;left:${W / 2 - 60}px;top:${H - 20}px">${id}</div>`;
}

async function main(): Promise<void> {
  if (mode === 'sheet') {
    const id = (q.get('titan') ?? 'molo') as TitanId;
    const d = num('dist', 4.6);
    drawPanels(id, [
      { kind: 'hero', pt: 0, yaw: 38, pitch: 16, dist: d, ly: 0.45, lz: 0, text: 'hero 3/4' },
      { kind: 'idle', pt: 0, yaw: 90, pitch: 6, dist: d, ly: 0.45, lz: -0.2, text: 'side' },
      { kind: 'idle', pt: 0, yaw: 0, pitch: 10, dist: d * 0.8, ly: 0.45, lz: 0, text: 'front' },
      { kind: 'walk', pt: 0.3, yaw: 60, pitch: 22, dist: d, ly: 0.45, lz: 0, text: 'walk' },
      { kind: 'attack', pt: num('at', 0.1), yaw: 50, pitch: 18, dist: d, ly: 0.45, lz: 0.1, text: 'attack' },
      { kind: 'ability', pt: num('ab', 0.3), yaw: 45, pitch: 36, dist: d * 1.1, ly: 0.45, lz: 0, text: 'ability (game angle)' },
    ], 3);
  } else if (mode === 'poses') {
    const id = (q.get('titan') ?? 'molo') as TitanId;
    const d = num('dist', 4.6);
    const P = (kind: string, pt: number, text: string, yaw = 70, pitch = 14): Panel => ({ kind, pt, yaw, pitch, dist: d, ly: 0.45, lz: 0, text });
    drawPanels(id, [
      P('walk', 0.0, 'walk 0'), P('walk', 0.12, 'walk .12'), P('walk', 0.24, 'walk .24'), P('run', 0.3, 'run'),
      P('attack', 0.05, 'atk .05'), P('attack', num('at', 0.12), 'atk strike'), P('dash', 0.1, 'dash'), P('hurt', 0.05, 'hurt'),
      P('grow', 0.2, 'grow .2'), P('grow', 0.6, 'grow .6 roar'), P('turn', 0.3, 'turn'), P('dead', 1.2, 'dead'),
    ], 4);
  } else if (mode === 'lineup') {
    scene.add(street(60));
    const h = num('h', 1.2);
    const gap = [0, 3.3, 2.4, 2.4];
    let x = -4.0 * h;
    ids.forEach((id, i) => {
      x += gap[i] * h;
      const m = buildTitanModel(id);
      pose(m, id, q.get('pose') ?? 'idle', num('pt', 0.3));
      m.root.position.set(x, 0, 0);
      m.root.rotation.y = num('heading', 0.5);
      m.root.scale.setScalar(h);
      scene.add(m.root);
      m.root.updateMatrixWorld(true);
    });
    const look = new THREE.Vector3(0, h * 0.45, 0);
    placeCam(look, num('yaw', 45), num('pitch', 36), num('dist', cameraDistance(h, 0)), W / H);
    fitSun(look, 10 * h);
    renderer.render(scene, camera);
    label.textContent = 'lineup · game camera yaw 45 pitch 36 · D ' + camera.position.distanceTo(look).toFixed(1);
  } else if (mode === 'close') {
    scene.add(street(12));
    const id = (q.get('titan') ?? 'molo') as TitanId;
    const m = buildTitanModel(id);
    scene.add(m.root);
    m.root.rotation.y = (num('heading', 0) * Math.PI) / 180;
    pose(m, id, q.get('pose') ?? 'idle', num('pt', 0.1));
    const look = new THREE.Vector3(0, num('ly', 0.45), num('lz', 0));
    placeCam(look, num('yaw', 35), num('pitch', 20), num('dist', 4.2), W / H);
    fitSun(look, 3);
    renderer.render(scene, camera);
    label.textContent = id + ' · ' + (q.get('pose') ?? 'idle');
  } else if (mode === 'world') {
    // REAL sim: build a World, mount TitanView, walk the titan with real input, render at the game camera
    const id = (q.get('titan') ?? 'molo') as TitanId;
    const w = createWorld({ titan: id, biome: 'grideast', seed: num('seed', 7) });
    const quality: Quality = { dpr: 1, shadows: true, level: 2, reduceFlashing: false, screenShake: true };
    const view = new TitanView({ renderer, scene, camera, quality });
    view.mount(w);
    const tile = street(40);
    scene.add(tile);
    const ticks = num('ticks', 45);
    const mv = screenToWorld(num('ix', 1), num('iy', 0.4));
    const evs: unknown[] = [];
    for (let i = 0; i < ticks; i++) {
      stepWorld(w, { mx: mv.mx, mz: mv.mz, ability: i === num('abilityAt', -1), abilityHeld: false, dash: i === num('dashAt', -1) });
      for (const e of w.events) evs.push(e);
    }
    tile.position.set(w.titan.x, 0, w.titan.z);
    let frame = 0;
    const T = w.titan;
    const h = T.height;
    renderer.setAnimationLoop(() => {
      frame++;
      const events = frame === 1 ? (evs as never[]) : [];
      view.update(w, { alpha: 1, dt: 1 / 60, time: frame / 60, events, camDist: 17, frozen: false });
      const look = new THREE.Vector3(T.x, h * 0.45, T.z);
      placeCam(look, 45, 36, num('dist', cameraDistance(h, T.rank)), W / H);
      fitSun(look, 4 * h + 2);
      renderer.render(scene, camera);
      if (frame === 20) {
        label.textContent = `world · ${id} tick ${w.tick} x ${T.x.toFixed(1)} z ${T.z.toFixed(1)} h ${h.toFixed(2)} speed ${T.speed.toFixed(2)} ev ${evs.length}`;
        (window as unknown as { __SNAP_READY__: boolean }).__SNAP_READY__ = true;
      }
    });
    return;
  } else if (mode === 'portraits') {
    const t0 = performance.now();
    const imgs = await renderPortraits(renderer, num('size', 256));
    const box = document.getElementById('portraits')!;
    box.style.display = 'flex';
    for (const id of ids) {
      const im = document.createElement('img');
      im.src = imgs[id];
      box.appendChild(im);
    }
    // prove renderer state was restored: draw a frame to the canvas afterwards
    renderer.render(scene, camera);
    label.textContent = `portraits ${(performance.now() - t0).toFixed(0)} ms · target restored: ${renderer.getRenderTarget() === null}`;
  }
  (window as unknown as { __SNAP_READY__: boolean }).__SNAP_READY__ = true;
}
main().catch((e) => { label.textContent = 'ERROR ' + String(e); console.error(e); });
