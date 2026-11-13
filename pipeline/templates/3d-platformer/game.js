/**
 * ForgeFlow Games — Three.js 3D Platformer Template
 *
 * Pre-built modules:
 * - Third-person camera with smooth follow
 * - 3D character controller with gravity, jump, double-jump, dash
 * - Platform generation (static + moving)
 * - Enemy AI (walker, chaser)
 * - Collectibles with spin + glow
 * - Particle effects
 * - window.__TEST__ hooks for QA
 *
 * Pipeline fills {{PLACEHOLDERS}} and extends via patches.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
const CONFIG = {
  title: "{{GAME_TITLE}}",
  gravity: -25,
  player: {
    speed: 8,
    jumpForce: 12,
    doubleJumpForce: 10,
    dashSpeed: 20,
    dashDuration: 0.15,
    coyoteTime: 0.1,
    maxLives: 3,
  },
  camera: {
    distance: 8,
    height: 5,
    smoothing: 0.06,
    lookAhead: 2,
  },
  levels: {{LEVEL_DATA}},
  colors: {
    sky: 0x1a2a4a,
    fog: 0x1a2a4a,
    ground: 0x44aa44,
    platform: 0x886633,
    coin: 0xffcc00,
    enemy: 0xcc3333,
    player: 0x4488ff,
  },
};

// ═══════════════════════════════════════════════════════════════
// ENGINE
// ═══════════════════════════════════════════════════════════════
let scene, camera, renderer, clock;
let gameState = 'menu';
let score = 0, lives = 3, currentLevel = 0;

// Player
let player = null;
let playerVelocity = new THREE.Vector3();
let isGrounded = false;
let canDoubleJump = true;
let coyoteTimer = 0;
let isDashing = false;
let dashTimer = 0;

// World
let platforms = [];
let coins = [];
let enemies = [];
let particles = [];
let goalMesh = null;

// Input
const keys = {};

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.colors.sky);
  scene.fog = new THREE.Fog(CONFIG.colors.fog, 30, 80);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 5, 8);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.appendChild(renderer.domElement);

  clock = new THREE.Clock();

  // Lighting
  const ambient = new THREE.AmbientLight(0x6688aa, 0.6);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffee, 1.0);
  sun.position.set(10, 20, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 60;
  sun.shadow.camera.left = -25;
  sun.shadow.camera.right = 25;
  sun.shadow.camera.top = 25;
  sun.shadow.camera.bottom = -25;
  scene.add(sun);

  const fill = new THREE.HemisphereLight(0x88bbff, 0x445522, 0.4);
  scene.add(fill);

  // Input
  window.addEventListener('keydown', e => { keys[e.code] = true; e.preventDefault(); });
  window.addEventListener('keyup', e => { keys[e.code] = false; });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ═══════════════════════════════════════════════════════════════
// MODULE: PLAYER
// ═══════════════════════════════════════════════════════════════
function createPlayer(x, y, z) {
  const group = new THREE.Group();
  const loader = new GLTFLoader();
  const modelPath = CONFIG.playerModel || 'assets/models/hero.gltf';

  // Load 3D character model
  loader.load(modelPath, (gltf) => {
    const model = gltf.scene;
    model.scale.setScalar(CONFIG.playerModelScale || 0.6);
    model.traverse(child => {
      if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
    });
    group.add(model);

    // Animations
    if (gltf.animations?.length > 0) {
      player.mixer = new THREE.AnimationMixer(model);
      player.animations = {};
      for (const clip of gltf.animations) {
        player.animations[clip.name.toLowerCase()] = player.mixer.clipAction(clip);
      }
      const idle = player.animations['idle'] || Object.values(player.animations)[0];
      if (idle) idle.play();
    }
    console.log('[player] 3D model loaded:', modelPath);
  }, undefined, (err) => {
    // Try alternatives
    const alts = ['assets/models/hero.glb', 'assets/models/character.glb'];
    for (const alt of alts) {
      loader.load(alt, (gltf) => {
        const model = gltf.scene;
        model.scale.setScalar(0.6);
        model.traverse(child => { if (child.isMesh) child.castShadow = true; });
        group.add(model);
      }, undefined, () => {});
    }
    // Red error marker if nothing loads
    setTimeout(() => {
      if (group.children.length <= 1) {
        console.error('[player] NO MODEL — needs assets/models/hero.gltf');
        group.add(new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 1.5, 0.5),
          new THREE.MeshBasicMaterial({ color: 0xff0000 })
        ));
      }
    }, 3000);
  });

  group.position.set(x, y, z);
  scene.add(group);

  player = { mesh: group, body, radius: 0.35, height: 1.4 };
  playerVelocity.set(0, 0, 0);
  isGrounded = false;
  canDoubleJump = true;
  lives = CONFIG.player.maxLives;
  return player;
}

function updatePlayer(dt) {
  if (!player) return;
  if (player.mixer) player.mixer.update(dt);
  const pos = player.mesh.position;
  const cfg = CONFIG.player;

  // Gravity
  if (!isDashing) {
    playerVelocity.y += CONFIG.gravity * dt;
  }

  // Movement
  const moveDir = new THREE.Vector3();
  if (keys['KeyW'] || keys['ArrowUp']) moveDir.z -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) moveDir.z += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) moveDir.x -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) moveDir.x += 1;

  if (!isDashing) {
    if (moveDir.length() > 0) {
      moveDir.normalize();
      playerVelocity.x = moveDir.x * cfg.speed;
      playerVelocity.z = moveDir.z * cfg.speed;
      // Face movement direction
      player.mesh.rotation.y = Math.atan2(moveDir.x, moveDir.z);
      // Bob animation
      player.body.position.y = 0.7 + Math.sin(clock.elapsedTime * 10) * 0.05;
    } else {
      playerVelocity.x *= 0.85;
      playerVelocity.z *= 0.85;
    }
  }

  // Coyote time
  if (isGrounded) {
    coyoteTimer = cfg.coyoteTime;
    canDoubleJump = true;
  } else {
    coyoteTimer = Math.max(0, coyoteTimer - dt);
  }

  // Jump
  if (keys['Space'] && !keys['_jumpUsed']) {
    keys['_jumpUsed'] = true;
    if (coyoteTimer > 0) {
      playerVelocity.y = cfg.jumpForce;
      isGrounded = false;
      coyoteTimer = 0;
      spawnParticles(pos.x, pos.y, pos.z, 5, 0xffffff);
      playSound('jump');
    } else if (canDoubleJump) {
      playerVelocity.y = cfg.doubleJumpForce;
      canDoubleJump = false;
      spawnParticles(pos.x, pos.y, pos.z, 8, 0x88aaff);
      playSound('jump');
    }
  }
  if (!keys['Space']) keys['_jumpUsed'] = false;

  // Variable jump height
  if (!keys['Space'] && playerVelocity.y > 2) {
    playerVelocity.y *= 0.9;
  }

  // Dash
  if (keys['ShiftLeft'] && !isDashing && dashTimer <= 0) {
    isDashing = true;
    dashTimer = cfg.dashDuration;
    const dashDir = moveDir.length() > 0 ? moveDir.normalize() : new THREE.Vector3(0, 0, -1).applyQuaternion(player.mesh.quaternion);
    playerVelocity.set(dashDir.x * cfg.dashSpeed, 0, dashDir.z * cfg.dashSpeed);
    spawnParticles(pos.x, pos.y + 0.5, pos.z, 10, 0x88ccff);
  }
  if (isDashing) {
    dashTimer -= dt;
    if (dashTimer <= 0) { isDashing = false; dashTimer = 0.5; }
  } else if (dashTimer > 0) {
    dashTimer -= dt;
  }

  // Apply velocity
  pos.x += playerVelocity.x * dt;
  pos.y += playerVelocity.y * dt;
  pos.z += playerVelocity.z * dt;

  // Platform collision
  isGrounded = false;
  for (const plat of platforms) {
    if (checkPlatformCollision(pos, plat)) {
      isGrounded = true;
    }
  }

  // Fall death
  if (pos.y < -10) {
    playerDie();
  }

  // Coin collection
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    if (pos.distanceTo(c.mesh.position) < 1.2) {
      score += c.value;
      spawnParticles(c.mesh.position.x, c.mesh.position.y, c.mesh.position.z, 8, 0xffcc00);
      scene.remove(c.mesh);
      coins.splice(i, 1);
      playSound('coin');
      updateHUD();
    }
  }

  // Enemy collision
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (!e.alive) continue;
    const dist = pos.distanceTo(e.mesh.position);
    if (dist < 1.2) {
      if (playerVelocity.y < -1 && pos.y > e.mesh.position.y + 0.3) {
        // Stomp
        e.alive = false;
        scene.remove(e.mesh);
        playerVelocity.y = cfg.jumpForce * 0.6;
        score += 100;
        spawnParticles(e.mesh.position.x, e.mesh.position.y, e.mesh.position.z, 12, 0xff3333);
        playSound('enemy_die');
        shakeScreen(0.1);
        updateHUD();
      } else {
        playerDie();
      }
    }
  }

  // Goal check
  if (goalMesh && pos.distanceTo(goalMesh.position) < 2) {
    nextLevel();
  }

  updateHUD();
}

function checkPlatformCollision(playerPos, platform) {
  const p = platform.mesh.position;
  const s = platform.size;
  const pr = 0.35; // player radius

  // Check if player is above platform and falling
  if (playerVelocity.y <= 0 &&
      playerPos.x > p.x - s.x/2 - pr && playerPos.x < p.x + s.x/2 + pr &&
      playerPos.z > p.z - s.z/2 - pr && playerPos.z < p.z + s.z/2 + pr &&
      playerPos.y > p.y + s.y/2 - 0.3 && playerPos.y < p.y + s.y/2 + 0.5) {
    playerPos.y = p.y + s.y/2;
    playerVelocity.y = 0;
    return true;
  }
  return false;
}

function playerDie() {
  lives--;
  spawnParticles(player.mesh.position.x, player.mesh.position.y, player.mesh.position.z, 15, 0xff3366);
  shakeScreen(0.2);
  playSound('hit');

  if (lives <= 0) {
    gameState = 'gameover';
    document.getElementById('gameover').style.display = 'flex';
    document.getElementById('go-score').textContent = score;
  } else {
    // Respawn
    const level = CONFIG.levels[currentLevel];
    const spawn = level?.playerSpawn || { x: 0, y: 3, z: 0 };
    player.mesh.position.set(spawn.x, spawn.y, spawn.z);
    playerVelocity.set(0, 0, 0);
  }
  updateHUD();
}

function nextLevel() {
  currentLevel++;
  score += 500;
  playSound('level_complete');

  if (currentLevel >= CONFIG.levels.length) {
    gameState = 'win';
    // Show win screen
    const div = document.createElement('div');
    div.innerHTML = `<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(10,14,26,0.9);z-index:50"><h1 style="font-size:48px;color:#00ff88;font-weight:900">YOU WIN!</h1><p style="color:#fff;font-size:20px;margin:12px">Score: ${score}</p><button onclick="location.reload()" style="padding:16px 48px;font-size:20px;font-weight:700;border:none;border-radius:14px;cursor:pointer;background:#ff8800;color:#fff;margin-top:12px">Play Again</button></div>`;
    document.body.appendChild(div);
  } else {
    loadLevel(currentLevel);
  }
  updateHUD();

  // Notify parent for ad break
  try { window.parent.postMessage({ type: 'forgeflow:level_complete', level: currentLevel, score }, '*'); } catch(e) {}
}

// ═══════════════════════════════════════════════════════════════
// MODULE: LEVEL LOADING
// ═══════════════════════════════════════════════════════════════
function loadLevel(idx) {
  // Clear old level
  for (const p of platforms) scene.remove(p.mesh);
  for (const c of coins) scene.remove(c.mesh);
  for (const e of enemies) scene.remove(e.mesh);
  if (goalMesh) scene.remove(goalMesh);
  platforms = []; coins = []; enemies = [];

  const level = CONFIG.levels[idx];
  if (!level) return;

  document.getElementById('level-label').textContent = level.name || `Level ${idx + 1}`;

  // Create platforms
  for (const p of (level.platforms || [])) {
    createPlatform(p.x, p.y, p.z, p.w || 4, p.h || 0.5, p.d || 4, p.color, p.moving);
  }

  // Create coins
  for (const c of (level.coins || [])) {
    createCoin(c.x, c.y, c.z, c.value || 10);
  }

  // Create enemies
  for (const e of (level.enemies || [])) {
    createEnemy(e.x, e.y, e.z, e.type || 'walker', e.range || 4);
  }

  // Goal
  if (level.goal) {
    const goalGeo = new THREE.CylinderGeometry(0.3, 0.3, 3, 8);
    const goalMat = new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 0.5 });
    goalMesh = new THREE.Mesh(goalGeo, goalMat);
    goalMesh.position.set(level.goal.x, level.goal.y + 1.5, level.goal.z);
    scene.add(goalMesh);

    const goalLight = new THREE.PointLight(0x00ff88, 1, 8);
    goalLight.position.copy(goalMesh.position);
    scene.add(goalLight);
  }

  // Player spawn
  const spawn = level.playerSpawn || { x: 0, y: 3, z: 0 };
  if (player) {
    player.mesh.position.set(spawn.x, spawn.y, spawn.z);
    playerVelocity.set(0, 0, 0);
  } else {
    createPlayer(spawn.x, spawn.y, spawn.z);
  }
}

function createPlatform(x, y, z, w, h, d, color, moving) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({
    color: color || CONFIG.colors.platform,
    roughness: 0.7,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  const plat = { mesh, size: { x: w, y: h, z: d }, moving: moving || null, startPos: new THREE.Vector3(x, y, z) };
  platforms.push(plat);
  return plat;
}

function createCoin(x, y, z, value) {
  const geo = new THREE.TorusGeometry(0.3, 0.1, 8, 16);
  const mat = new THREE.MeshStandardMaterial({ color: CONFIG.colors.coin, emissive: 0xffaa00, emissiveIntensity: 0.3, metalness: 0.8, roughness: 0.2 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  scene.add(mesh);

  const light = new THREE.PointLight(0xffcc00, 0.3, 3);
  light.position.set(x, y + 0.5, z);
  scene.add(light);

  coins.push({ mesh, value, light, bobPhase: Math.random() * Math.PI * 2 });
}

// Monster model names from Ultimate Monsters Bundle
const PLATFORMER_MONSTERS = [
  'Bunny.glb', 'Green Blob.glb', 'Mushroom.glb', 'Pink Slime.glb',
  'Cactoro.glb', 'Birb.glb', 'Armabee.glb', 'Alpaking.glb',
];

function createEnemy(x, y, z, type, range) {
  const group = new THREE.Group();
  group.position.set(x, y + 0.4, z);
  scene.add(group);

  // Load a random monster GLB
  const loader = new GLTFLoader();
  const modelFile = PLATFORMER_MONSTERS[Math.floor(Math.random() * PLATFORMER_MONSTERS.length)];
  loader.load(`assets/models/monsters/${modelFile}`, (gltf) => {
    const model = gltf.scene;
    model.scale.setScalar(0.6);
    model.traverse(child => { if (child.isMesh) child.castShadow = true; });
    group.add(model);
    // Play animation
    if (gltf.animations?.length > 0) {
      const mixer = new THREE.AnimationMixer(model);
      mixer.clipAction(gltf.animations[0]).play();
      const enemy = enemies.find(e => e.mesh === group);
      if (enemy) enemy.mixer = mixer;
    }
  }, undefined, () => {
    // Try alternatives
    for (const alt of PLATFORMER_MONSTERS.slice(0, 3)) {
      loader.load(`assets/models/monsters/${alt}`, (gltf) => {
        if (group.children.length > 0) return;
        const model = gltf.scene;
        model.scale.setScalar(0.6);
        model.traverse(child => { if (child.isMesh) child.castShadow = true; });
        group.add(model);
      }, undefined, () => {});
    }
    // Error marker if nothing loads
    setTimeout(() => {
      if (group.children.length === 0) {
        group.add(new THREE.Mesh(
          new THREE.BoxGeometry(0.4, 0.8, 0.4),
          new THREE.MeshBasicMaterial({ color: 0xff0000 })
        ));
      }
    }, 3000);
  });

  enemies.push({
    mesh: group, type, alive: true, range,
    startX: x, dir: 1, speed: type === 'chaser' ? 5 : 3,
    mixer: null,
  });
}

function updateEnemies(dt) {
  for (const e of enemies) {
    if (!e.alive) continue;
    if (e.mixer) e.mixer.update(dt);

    if (e.type === 'walker') {
      e.mesh.position.x += e.dir * e.speed * dt;
      if (Math.abs(e.mesh.position.x - e.startX) > e.range) e.dir *= -1;
    } else if (e.type === 'chaser' && player) {
      const dist = e.mesh.position.distanceTo(player.mesh.position);
      if (dist < 10) {
        const dir = player.mesh.position.clone().sub(e.mesh.position).normalize();
        dir.y = 0;
        e.mesh.position.addScaledVector(dir, e.speed * dt);
      } else {
        // Patrol
        e.mesh.position.x += e.dir * 2 * dt;
        if (Math.abs(e.mesh.position.x - e.startX) > e.range) e.dir *= -1;
      }
    }

    // Bob
    e.mesh.position.y = e.mesh.position.y + Math.sin(clock.elapsedTime * 3 + e.startX) * 0.002;
  }
}

function updateMovingPlatforms(dt) {
  for (const p of platforms) {
    if (!p.moving) continue;
    const m = p.moving;
    const t = clock.elapsedTime * (m.speed || 1);
    if (m.axis === 'x') p.mesh.position.x = p.startPos.x + Math.sin(t) * (m.range || 3);
    if (m.axis === 'y') p.mesh.position.y = p.startPos.y + Math.sin(t) * (m.range || 2);
    if (m.axis === 'z') p.mesh.position.z = p.startPos.z + Math.sin(t) * (m.range || 3);
  }
}

function updateCoins(dt) {
  for (const c of coins) {
    c.mesh.rotation.y += dt * 2;
    c.mesh.position.y += Math.sin(clock.elapsedTime * 2 + c.bobPhase) * 0.003;
  }
}

// ═══════════════════════════════════════════════════════════════
// MODULE: EFFECTS
// ═══════════════════════════════════════════════════════════════
function spawnParticles(x, y, z, count, color) {
  for (let i = 0; i < count; i++) {
    const geo = new THREE.SphereGeometry(0.08, 4, 4);
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    scene.add(mesh);
    particles.push({
      mesh,
      velocity: new THREE.Vector3((Math.random()-0.5)*6, Math.random()*5+2, (Math.random()-0.5)*6),
      life: 0.5 + Math.random() * 0.5,
    });
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.mesh.position.addScaledVector(p.velocity, dt);
    p.velocity.y -= 15 * dt;
    p.life -= dt;
    p.mesh.scale.setScalar(Math.max(0, p.life * 2));
    if (p.life <= 0) {
      scene.remove(p.mesh);
      particles.splice(i, 1);
    }
  }
}

let shakeAmount = 0;
function shakeScreen(amount) { shakeAmount = amount; }

// ═══════════════════════════════════════════════════════════════
// MODULE: CAMERA
// ═══════════════════════════════════════════════════════════════
function updateCamera() {
  if (!player) return;
  const target = player.mesh.position;
  const cfg = CONFIG.camera;
  const desired = new THREE.Vector3(
    target.x,
    target.y + cfg.height,
    target.z + cfg.distance
  );
  camera.position.lerp(desired, cfg.smoothing);
  camera.lookAt(target.x, target.y + 1, target.z - cfg.lookAhead);

  if (shakeAmount > 0) {
    camera.position.x += (Math.random() - 0.5) * shakeAmount * 5;
    camera.position.y += (Math.random() - 0.5) * shakeAmount * 5;
    shakeAmount *= 0.9;
    if (shakeAmount < 0.005) shakeAmount = 0;
  }
}

// ═══════════════════════════════════════════════════════════════
// MODULE: HUD + AUDIO
// ═══════════════════════════════════════════════════════════════
function updateHUD() {
  document.getElementById('lives-text').textContent = lives;
  document.getElementById('score-text').textContent = score;
}

function playSound(name) {
  try {
    const snd = new Audio(`assets/audio/sfx_${name}.ogg`);
    snd.volume = 0.5;
    snd.play().catch(() => {});
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════════
// MODULE: TEST API
// ═══════════════════════════════════════════════════════════════
function exposeTestAPI() {
  window.__TEST__ = {
    getPlayer: () => player ? {
      x: player.mesh.position.x, y: player.mesh.position.y, z: player.mesh.position.z,
      velocityY: playerVelocity.y, lives, alive: lives > 0, onGround: isGrounded,
    } : null,
    getScore: () => score,
    getLives: () => lives,
    getEnemies: () => enemies.filter(e => e.alive).map(e => ({
      x: e.mesh.position.x, y: e.mesh.position.y, z: e.mesh.position.z,
      type: e.type, alive: e.alive,
    })),
    getCollectibles: () => coins.map(c => ({
      x: c.mesh.position.x, y: c.mesh.position.y, z: c.mesh.position.z,
      value: c.value,
    })),
    getCurrentScene: () => gameState,
    getLevel: () => currentLevel,
  };
  window.__GAME__ = { scene, camera, renderer };
}

// ═══════════════════════════════════════════════════════════════
// GAME FLOW
// ═══════════════════════════════════════════════════════════════
function startGame() {
  document.getElementById('menu-screen').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  gameState = 'playing';
  loadLevel(0);
  exposeTestAPI();

  // Start music
  try {
    const music = new Audio('assets/audio/music_level.ogg');
    music.volume = 0.2; music.loop = true;
    music.play().catch(() => {});
  } catch(e) {}
}

function gameLoop() {
  requestAnimationFrame(gameLoop);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (gameState === 'playing') {
    updatePlayer(dt);
    updateEnemies(dt);
    updateMovingPlatforms(dt);
    updateCoins(dt);
    updateParticles(dt);
    updateCamera();

    // Rotate goal
    if (goalMesh) goalMesh.rotation.y += dt;
  }

  renderer.render(scene, camera);
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
init();
gameLoop();

document.getElementById('play-btn').addEventListener('click', startGame);

window.addEventListener('message', e => {
  if (e.data?.type === 'forgeflow:pause') gameState = 'paused';
  if (e.data?.type === 'forgeflow:resume') gameState = 'playing';
});
