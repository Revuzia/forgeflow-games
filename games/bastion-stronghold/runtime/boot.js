// Boot: texture preload, engine/ui/audio/game wiring, menu backdrop, test hooks.
import * as THREE from 'three';
import { createEngine, lightRig } from './core/engine3d.js';
import { createUI } from './ui/ui.js';
import { createAudio } from './core/audio.js';
import { createGame } from './game.js';
import { loadProfile, saveProfile, resetProfile } from './core/save.js';
import { WORLDS } from './data/worlds.js';
import { ENEMIES } from './data/enemies.js';
import { loadModel } from './core/assets.js';
import { levelDef } from './data/levels.js';
import { buildWorld } from './view/world3d.js';
import { buildBastion } from './view/models.js';
import { DT } from './sim/sim.js';

const container = document.getElementById('game-container');

const loader = document.createElement('div');
loader.style.cssText = `position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at 50% 40%,#2a2018,#0c0906);z-index:100;font-family:Georgia,serif;color:#e8dcc0;transition:opacity .5s`;
loader.innerHTML = `
  <div style="font-size:42px;font-weight:700;letter-spacing:0.12em;color:#f0e2c0;text-shadow:0 0 30px rgba(192,48,64,0.55)">BASTION REALMS</div>
  <div style="font-size:15px;letter-spacing:0.55em;color:#c03040;margin:4px 0 30px">STRONGHOLD</div>
  <div style="width:min(420px,70vw);height:10px;background:#14100c;border:1px solid rgba(192,120,64,0.4);border-radius:4px;overflow:hidden">
    <div id="bs-loadbar" style="height:100%;width:0%;background:linear-gradient(90deg,#6a2830,#c03040);transition:width .2s"></div>
  </div>
  <div id="bs-loadtxt" style="font-size:12px;color:#8a7a60;margin-top:10px;letter-spacing:0.1em">raising the walls…</div>`;
container.appendChild(loader);
const loadBar = loader.querySelector('#bs-loadbar');
const loadTxt = loader.querySelector('#bs-loadtxt');

const GLTF_MODELS = new Set(['cyclops', 'forgemech']); // shipped as .gltf + sibling files
async function preloadAssets() {
  const texLoader = new THREE.TextureLoader();
  const texJobs = WORLDS.map((w) => w.groundTex);
  const modelJobs = [...new Set(Object.values(ENEMIES).map((d) => d.model))]
    .filter((m) => m !== 'primeprism'); // procedural boss
  const totalJobs = texJobs.length + modelJobs.length;
  let done = 0;
  const tick = () => { done++; loadBar.style.width = Math.round(done / totalJobs * 100) + '%'; loadTxt.textContent = `provisions ${done}/${totalJobs}`; };
  await Promise.allSettled([
    ...texJobs.map((name) => new Promise((res) => {
      texLoader.load(`assets/textures/${name}.jpg`, () => { tick(); res(); }, undefined, () => { tick(); res(); });
    })),
    ...modelJobs.map((m) => {
      const url = GLTF_MODELS.has(m) ? `assets/models/enemies/${m}/${m}.gltf` : `assets/models/enemies/${m}.glb`;
      return loadModel(url, m).then(tick, (e) => { console.warn('[BS] model failed', m, e); tick(); });
    }),
  ]);
}

let backdrop = null;
function makeBackdrop(engine) {
  destroyBackdrop(engine);
  const lv = levelDef(0, 2);
  const pal = lv.world.palette;
  const lights = lightRig(engine.scene, {
    ambient: pal.ambient, sky: pal.sky, ground: { dark: pal.roadEdge },
    sun: pal.sun, sunIntensity: pal.sunIntensity,
  });
  const world = buildWorld(engine.scene, lv);
  const bastion = buildBastion(lv.world.bastion);
  engine.scene.add(bastion.group);
  engine.controls.autoRotate = true;
  engine.controls.autoRotateSpeed = 0.5;
  backdrop = { lights, world, bastion };
}
function destroyBackdrop(engine) {
  if (!backdrop) return;
  engine.scene.remove(backdrop.lights);
  engine.scene.remove(backdrop.world.group);
  engine.scene.remove(backdrop.bastion.group);
  engine.controls.autoRotate = false;
  backdrop = null;
}

(async function boot() {
  const profile = loadProfile();
  const engine = createEngine(container, { quality: profile.settings.quality });
  const audio = createAudio(profile.settings);

  const env = {
    engine, audio,
    resetProfile: () => { resetProfile(); location.reload(); },
    onSceneBusy: () => destroyBackdrop(engine),
    onSceneIdle: () => makeBackdrop(engine),
  };
  const gameRef = { current: null };
  const ui = createUI(container, new Proxy({}, {
    get: (_, prop) => (...args) => gameRef.current?.handlers?.[prop]?.(...args),
  }));
  env.ui = ui;
  const game = createGame(env);
  gameRef.current = game;

  await preloadAssets();

  window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
  window.addEventListener('keydown', () => audio.unlock(), { once: true });

  loader.style.opacity = '0';
  setTimeout(() => loader.remove(), 550);

  makeBackdrop(engine);
  ui.showMenu();

  let last = performance.now();
  function tick() {
    requestAnimationFrame(tick);
    const now = performance.now();
    const rdt = Math.min(0.1, (now - last) / 1000);
    last = now;
    game.frame(rdt);
    if (backdrop) backdrop.bastion.animate(now / 1000);
    engine.render();
  }
  tick();

  window.__TD_TEST__ = {
    game, engine, ui, audio,
    get sim() { return game.sim; },
    loadLevel: (wi, li, endless = false) => { destroyBackdrop(engine); game.loadLevel(wi, li, !!endless); },
    state() {
      const s = game.sim;
      if (!s) return { running: false };
      return {
        running: game.running, phase: s.phase, wave: s.waveIdx + 1, waveTotal: s.waveTotal,
        gold: s.gold, bastionHp: Math.round(s.bastionHp), tier: s.bastionTier(),
        time: +s.time.toFixed(2),
        enemies: s.enemies.length, towers: s.towers.length, zones: s.zones.length,
        stats: { ...s.stats },
      };
    },
    ff(sec) {
      const s = game.sim;
      if (!s) return null;
      const steps = Math.round(sec / DT);
      for (let i = 0; i < steps; i++) {
        s.step(DT);
        if (s.phase === 'won' || s.phase === 'lost') break;
      }
      game.frame(0.001);
      return window.__TD_TEST__.state();
    },
    place: (type, cx, cy) => game.sim?.placeTower(type, cx, cy),
    upgrade: (id) => game.sim?.upgradeTower(id),
    sell: (id) => game.sim?.sellTower(id),
    start: () => game.sim?.startWave(),
    speed: (n) => { game.speed = n; },
    gold: (n) => { if (game.sim) game.sim.gold += n; },
    winsAll() {
      const p = loadProfile();
      for (let wi = 0; wi < 5; wi++) for (let li = 0; li < 9; li++) { p.wins[wi + ':' + li] = true; p.stars[wi + ':' + li] = Math.max(p.stars[wi + ':' + li] || 0, 1); }
      saveProfile();
      return 'unlocked';
    },
  };
})().catch((err) => {
  console.error('[BS] boot failed', err);
  loadTxt && (loadTxt.textContent = 'BOOT ERROR: ' + err.message);
});
