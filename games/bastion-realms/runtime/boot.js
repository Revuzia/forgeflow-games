// Boot: preload assets, build engine/ui/audio/game, menu backdrop, rAF loop, test hooks.
import * as THREE from 'three';
import { createEngine, lightRig } from './core/engine3d.js';
import { createUI } from './ui/ui.js';
import { createAudio } from './core/audio.js';
import { createGame } from './game.js';
import { loadModel } from './core/assets.js';
import { loadProfile, saveProfile, resetProfile } from './core/save.js';
import { ENEMIES } from './data/enemies.js';
import { BIOMES } from './data/biomes.js';
import { levelDef } from './data/levels.js';
import { buildWorld } from './view/world.js';
import { DT } from './sim/sim.js';

const container = document.getElementById('game-container');

// ---------- loading screen ----------
const loader = document.createElement('div');
loader.style.cssText = `position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at 50% 40%,#16223a,#070c16);z-index:100;font-family:'Segoe UI',sans-serif;color:#e8e4d8;transition:opacity .5s`;
loader.innerHTML = `
  <div style="font-size:44px;font-weight:800;letter-spacing:0.14em;color:#f0e6c8;text-shadow:0 0 30px rgba(216,176,74,0.5)">BASTION REALMS</div>
  <div style="font-size:13px;letter-spacing:0.4em;color:#d8b04a;margin:8px 0 30px">FORGING THE REALMS</div>
  <div style="width:min(420px,70vw);height:10px;background:#0a1220;border:1px solid rgba(216,176,74,0.4);border-radius:6px;overflow:hidden">
    <div id="br-loadbar" style="height:100%;width:0%;background:linear-gradient(90deg,#7a5f1e,#d8b04a);transition:width .2s"></div>
  </div>
  <div id="br-loadtxt" style="font-size:12px;color:#6a7690;margin-top:10px;letter-spacing:0.1em">loading…</div>`;
container.appendChild(loader);
const loadBar = loader.querySelector('#br-loadbar');
const loadTxt = loader.querySelector('#br-loadtxt');

async function preloadModels() {
  const enemyModels = [...new Set(Object.values(ENEMIES).map((d) => d.model))];
  const propModels = [...new Set(BIOMES.flatMap((b) => b.decor.map((d) => d.model)))];
  const jobs = [
    ...enemyModels.map((m) => ({ url: `assets/models/enemies/${m}.glb`, name: m })),
    ...propModels.map((m) => ({ url: `assets/models/props/${m}.glb`, name: m })),
  ];
  let done = 0;
  const results = await Promise.allSettled(jobs.map((j) =>
    loadModel(j.url, j.name).then(() => {
      done++;
      loadBar.style.width = Math.round((done / jobs.length) * 100) + '%';
      loadTxt.textContent = `assets ${done}/${jobs.length}`;
    })
  ));
  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) console.warn('[BR] some models failed to load:', failed.length);
}

// ---------- backdrop (menu scene) ----------
let backdrop = null;
function makeBackdrop(engine) {
  destroyBackdrop(engine);
  const lv = levelDef(0, 2);
  const lights = lightRig(engine.scene, lv.biome);
  const world = buildWorld(engine.scene, lv);
  engine.controls.autoRotate = true;
  engine.controls.autoRotateSpeed = 0.55;
  backdrop = { lights, world };
}
function destroyBackdrop(engine) {
  if (!backdrop) return;
  engine.scene.remove(backdrop.lights);
  engine.scene.remove(backdrop.world.group);
  engine.controls.autoRotate = false;
  backdrop = null;
}

// ---------- boot ----------
(async function boot() {
  const profile = loadProfile();
  const engine = createEngine(container, { quality: profile.settings.quality });
  const audio = createAudio(profile.settings);
  audio.preload(); // don't block boot on audio

  const env = {
    engine, audio,
    resetProfile: () => { resetProfile(); location.reload(); },
    onSceneBusy: () => destroyBackdrop(engine),
    onSceneIdle: () => makeBackdrop(engine),
  };
  const uiRef = { current: null };
  // game needs ui; ui needs handlers from game — two-phase init
  const gameRef = { current: null };
  const ui = createUI(container, new Proxy({}, {
    get: (_, prop) => (...args) => gameRef.current?.handlers?.[prop]?.(...args),
  }));
  uiRef.current = ui;
  env.ui = ui;
  const game = createGame(env);
  gameRef.current = game;

  await preloadModels();

  // unlock audio on any interaction
  window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
  window.addEventListener('keydown', () => audio.unlock(), { once: true });

  loader.style.opacity = '0';
  setTimeout(() => loader.remove(), 550);

  makeBackdrop(engine);
  ui.showMenu();

  // ---------- main loop ----------
  let last = performance.now();
  function tick() {
    requestAnimationFrame(tick);
    const now = performance.now();
    const rdt = Math.min(0.1, (now - last) / 1000);
    last = now;
    game.frame(rdt);
    engine.render();
  }
  tick();

  // ---------- test hooks ----------
  window.__TD_TEST__ = {
    game, engine, ui, audio,
    get sim() { return game.sim; },
    loadLevel: (bi, li, endless = false) => { destroyBackdrop(engine); game.loadLevel(bi, li, !!endless); },
    state() {
      const s = game.sim;
      if (!s) return { running: false };
      return {
        running: game.running, phase: s.phase, wave: s.waveIdx + 1, waveTotal: s.waveTotal,
        gold: s.gold, lives: s.lives, time: +s.time.toFixed(2),
        enemies: s.enemies.length, towers: s.towers.length, projectiles: s.projectiles.length,
        stats: { ...s.stats, dmgByType: undefined },
      };
    },
    ff(sec) { // synchronous fast-forward (rAF-freeze proof)
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
    mode: (id, m) => game.sim?.setTargetMode(id, m),
    start: () => game.sim?.startWave(),
    speed: (n) => { game.speed = n; },
    gold: (n) => { if (game.sim) game.sim.gold += n; },
    winsAll() { // unlock everything (test)
      const p = loadProfile();
      for (let bi = 0; bi < 5; bi++) for (let li = 0; li < 9; li++) { p.wins[bi + ':' + li] = true; p.stars[bi + ':' + li] = Math.max(p.stars[bi + ':' + li] || 0, 1); }
      saveProfile();
      return 'unlocked';
    },
  };
})().catch((err) => {
  console.error('[BR] boot failed', err);
  loadTxt && (loadTxt.textContent = 'BOOT ERROR: ' + err.message);
});
