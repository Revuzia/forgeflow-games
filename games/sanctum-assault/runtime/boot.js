// Entry — renderer + rAF loop
import * as THREE from 'three';
import { createGame } from './main.js';

const container = document.getElementById('game-container');

function createEngine(container) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
  });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  // Insert canvas behind HUD
  container.insertBefore(renderer.domElement, container.firstChild);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    42,
    container.clientWidth / Math.max(1, container.clientHeight),
    0.5,
    200
  );
  camera.position.set(0, 22, 16);
  camera.lookAt(0, 0, 0);

  function onResize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  return {
    renderer,
    scene,
    camera,
    container,
    dispose() {
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

const engine = createEngine(container);
const game = createGame(engine);

let last = performance.now();
function frame(now) {
  const raw = (now - last) / 1000;
  last = now;
  const dt = Math.min(0.05, raw);
  try {
    game.update(dt);
  } catch (err) {
    console.error('[SanctumAssault]', err);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Debug hook
window.__SANCTUM__ = { engine, game };

console.info('%c[Sanctum Assault] ready', 'color:#f0c14b;font-weight:bold');
