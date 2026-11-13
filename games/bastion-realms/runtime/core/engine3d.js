// Renderer + scene + camera + fixed-step loop host.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createEngine(container, { quality = 'high' } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const dpr = Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 1.5);
  renderer.setPixelRatio(dpr);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = quality !== 'low';
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, container.clientWidth / container.clientHeight, 0.5, 400);
  camera.position.set(0, 30, 24);
  camera.lookAt(0, 0, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 14;
  controls.maxDistance = 52;
  controls.minPolarAngle = 0.32;
  controls.maxPolarAngle = 1.15;
  controls.target.set(0, 0, 0);
  // LEFT-drag pans (click still selects/builds via the drag threshold),
  // RIGHT-drag orbits, MIDDLE + wheel zoom.
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.update();

  // clamp pan target to the map
  const clampTarget = () => {
    controls.target.x = Math.max(-22, Math.min(22, controls.target.x));
    controls.target.z = Math.max(-16, Math.min(16, controls.target.z));
    controls.target.y = 0;
  };

  function onResize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  const eng = {
    renderer, scene, camera, controls,
    // standard level framing — called on level load and via the R key
    resetView() {
      controls.target.set(0, 0, 0);
      camera.position.set(0, 30, 24);
      camera.lookAt(0, 0, 0);
      controls.update();
    },
    setQuality(q) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === 'low' ? 1 : 1.5));
      renderer.shadowMap.enabled = q !== 'low';
      eng.quality = q;
    },
    quality,
    render() {
      controls.update();
      clampTarget();
      renderer.render(scene, camera);
    },
    dispose() {
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
  return eng;
}

// Standard light rig per biome (single shadow dir light per house perf rules).
export function lightRig(scene, biome) {
  const group = new THREE.Group();
  group.name = 'lights';
  const amb = new THREE.AmbientLight(biome.ambient, 0.85);
  const hemi = new THREE.HemisphereLight(biome.sky, biome.ground.dark, 0.5);
  const sun = new THREE.DirectionalLight(biome.sun, biome.sunIntensity);
  sun.position.set(18, 30, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -26; sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -20;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0005;
  group.add(amb, hemi, sun);
  scene.add(group);
  return group;
}
