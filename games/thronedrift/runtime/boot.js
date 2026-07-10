// Thronedrift — bootstrap: renderer, asset preload (Meshy heroes +
// creature-library enemies), HUD/Input wiring, main loop.

import * as THREE from "three";
import { Input } from "./core/input.js";
import { HUD } from "./ui/hud.js";
import { Game } from "./sim/game.js";
import { loadHeroes, loadEnemyModels, loadProps } from "./view/chars.js";
import { SFX } from "./core/audio.js";
import { save } from "./core/util.js";
import { Music } from "./core/music.js";

const container = document.getElementById("game-container");
const hudRoot = document.getElementById("hud");

// ---- loading overlay -------------------------------------------------------
const loadEl = document.createElement("div");
loadEl.style.cssText = `position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;
  background:linear-gradient(rgba(10,6,18,.55),rgba(10,6,18,.85)),url(menu_bg.png?v=8) center/cover no-repeat,
  radial-gradient(ellipse at 50% 35%,#2a1038,#0b0710 75%);z-index:10;color:#e8dcc8;font-family:Georgia,serif;`;
loadEl.innerHTML = `
  <div style="font-size:44px;font-weight:900;letter-spacing:3px;
    background:linear-gradient(180deg,#ffe9a8,#e8b83a 50%,#ff6a2a);-webkit-background-clip:text;background-clip:text;color:transparent">THRONEDRIFT</div>
  <div style="width:280px;height:10px;border:2px solid #e8b83a;border-radius:6px;margin-top:26px;overflow:hidden">
    <div id="cf-loadbar" style="width:0%;height:100%;background:linear-gradient(90deg,#7a4dcf,#e8b83a);transition:width .2s"></div></div>
  <div id="cf-loadtxt" style="margin-top:12px;font-size:13px;color:#b89ae0">Forging the realms…</div>`;
container.appendChild(loadEl);
const setProgress = (f, txt) => {
  const bar = loadEl.querySelector("#cf-loadbar");
  if (bar) bar.style.width = `${Math.round(f * 100)}%`;
  if (txt) loadEl.querySelector("#cf-loadtxt").textContent = txt;
};

// ---- renderer ---------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // fps budget on mobile
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(46, container.clientWidth / container.clientHeight, 0.1, 300);

window.addEventListener("resize", () => {
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
});

// ---- assets → game ----------------------------------------------------------
(async () => {
  let heroF = 0, enemyF = 0;
  const upd = () => setProgress(heroF * 0.55 + enemyF * 0.4, heroF < 1 ? "Summoning champions…" : "Rousing the legions…");
  const [heroes, enemies, props] = await Promise.all([
    loadHeroes(["barbarian", "knight", "sorceress", "rogue"], (f) => { heroF = f; upd(); }),
    loadEnemyModels(["imp", "skeleton", "brute", "slime", "bat", "yeti", "spider", "gargoyle", "wisp", "zombie", "skull", "ghost", "orc", "myconid", "cyclops", "demon", "giant", "dragon", "cthulhu", "ninja"], (f) => { enemyF = f; upd(); }),
    loadProps(["bow"]),
  ]);
  setProgress(1, "Ready.");

  const input = new Input();
  input.bindCanvas(renderer.domElement);
  const hud = new HUD(hudRoot, input);
  const game = new Game({ renderer, camera, hud, input, heroes, enemies, props, container });

  // expose numeric eval hooks for automated verification (ffg preview convention)
  window.__FFG3D__ = {
    game, renderer, music: Music,
    stats: () => ({
      state: game.state, hp: game.hp, score: game.score, wave: game.waveIdx + 1,
      enemies: game.enemies ? game.enemies.filter((e) => !e.dead).length : 0,
      combo: game.combo, mult: game.mult, mode: game.modeKeys ? game.modeKey() : null,
      drawCalls: renderer.info.render.calls, tris: renderer.info.render.triangles,
    }),
  };

  SFX.setVolume(save.get("set_vol", 0.5));
  Music.setVolume(save.get("set_vol", 0.5));
  Music.setEnabled(save.get("set_music", true));
  input.invertX = save.get("set_invx", false);
  input.invertY = save.get("set_invy", false);
  // global controls-bar pause button (game_controls.js) drives this hook
  window.__PAUSE__ = {
    toggle: () => game.setPaused(!game.paused),
    pause: () => game.setPaused(true),
  };
  loadEl.remove();
  game.buildMenuShowcase();
  hud.showTitle();
  window.addEventListener("pointerdown", () => { SFX.unlock(); Music.play("menu"); }, { once: true });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    game.update(dt);
    renderer.render(game.scene, camera);
  });
})().catch((err) => {
  console.error("[thronedrift] boot failed:", err);
  setProgress(1, "Failed to load — check console.");
});
